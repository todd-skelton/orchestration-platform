import { execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { onTestFinished } from "vitest";

type Phase = "control" | "setup" | "queue" | "proof" | "cleanup";
export type PhaseTiming = { phase(next: Phase): void };
const phases: Phase[] = ["control", "setup", "queue", "proof", "cleanup"];
const execute = promisify(execFile);
const cases = {
  source4: {
    file: "test/dogfood/queue-adapter.test.ts",
    name: "ISS-187 uses native accounting and terminal hold: source4",
  },
  unpark: {
    file: "test/dogfood/queue.test.ts",
    name: "unparks only attempt 4 with current guidance, full diff, history and fresh review",
  },
};

type Child = {
  id: number;
  phase: Phase;
  family: string;
  created: number;
  start?: number;
  end?: number;
  spawn?: number;
  exit?: number;
  close?: number;
  code?: number | null;
  signal?: string | null;
};
type Sample = {
  phases: { phase: Phase; start: number; end: number }[];
  children: Child[];
  errors: string[];
  pending: number;
};

// No argv, cwd, environment, output or stack is retained. Read spawnargs only
// after 'spawn'; the constructor-time channel has not initialized it yet.
function family(args: string[]) {
  const file = basename(args[0]!).toLowerCase();
  if (file === "node" || file === "node.exe") return "Node launcher";
  if (file === "which" || file === "where.exe") return "executable lookup";
  if (file !== "git" && file !== "git.exe") return "other";
  let i = 1;
  while (args[i]?.startsWith("-") && args[i] !== "--version") {
    i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i]!) ? 2 : 1;
  }
  const command = args[i] ?? "";
  return command === "--version" || /^[a-z][a-z-]{0,39}$/.test(command)
    ? `git ${command}`
    : "git other";
}

export function validateTiming(sample: Sample) {
  if (sample.errors.length) throw new Error(`ISS212 ${sample.errors[0]}`);
  for (const phase of phases)
    if (!sample.phases.some((row) => row.phase === phase))
      throw new Error(`ISS212 missing-phase:${phase}`);
  if (sample.pending) throw new Error("ISS212 pending-children");
  for (const row of sample.children) {
    if (
      row.start === undefined ||
      row.end === undefined ||
      row.spawn === undefined ||
      row.exit === undefined ||
      row.close === undefined ||
      !(
        row.created <= row.start &&
        row.start <= row.end &&
        row.end <= row.spawn &&
        row.spawn <= row.exit &&
        row.exit <= row.close
      )
    )
      throw new Error(`ISS212 incomplete-child:${row.id}`);
  }
  const control = sample.children.filter((row) => row.phase === "control");
  if (control.length !== 1 || control[0]!.family !== "git --version" || control[0]!.code !== 0)
    throw new Error("ISS212 live-count-control");
}

// ISS-212 adapts the manifest-verified ISS-204 observer: tracing start/end,
// child close, one-child control and complete identity-set reconciliation.
// The constructor census additionally catches a dropped entire tracing pair.
export function createTimingCapture(gitExecutable = "git") {
  const sample: Sample = { phases: [], children: [], errors: [], pending: 0 };
  const pending = new Map<ChildProcess, Child>();
  const origin = performance.now();
  const now = () => performance.now() - origin;
  let phase: Phase = "control";
  let mark = 0;
  let closed = false;
  const error = (text: string) => {
    if (!sample.errors.length) sample.errors.push(text);
  };
  const stamp = (row: Child, event: "start" | "end" | "spawn" | "exit" | "close") => {
    if (row[event] !== undefined) error(`duplicate-${event}`);
    row[event] = now();
  };
  const census = (message: unknown) => {
    const child = (message as { process: ChildProcess }).process;
    if (sample.children.length >= 2048) {
      error("child-bound");
      return;
    }
    const row: Child = { id: sample.children.length + 1, phase, family: "unknown", created: now() };
    sample.children.push(row);
    if (pending.has(child)) error("duplicate-child");
    pending.set(child, row);
    child.once("spawn", () => {
      stamp(row, "spawn");
      row.family = family(child.spawnargs);
    });
    child.once("error", () => error("child-error"));
    child.once("exit", () => stamp(row, "exit"));
    child.once("close", (code, signal) => {
      stamp(row, "close");
      row.code = code;
      row.signal = signal;
      pending.delete(child);
    });
  };
  const trace = (event: "start" | "end") => (message: unknown) => {
    const row = pending.get((message as { process: ChildProcess }).process);
    if (row) stamp(row, event);
    else error(`unmatched-${event}`);
  };
  const listeners = [
    ["child_process", census],
    ["tracing:child_process.spawn:start", trace("start")],
    ["tracing:child_process.spawn:end", trace("end")],
  ] as const;
  for (const [name, listener] of listeners) subscribe(name, listener);
  const markPhase = (next: Phase) => {
    if (closed) throw new Error("ISS212 capture-closed");
    const end = now();
    if (sample.phases.length < 256) sample.phases.push({ phase, start: mark, end });
    else error("phase-bound");
    phase = next;
    mark = end;
  };
  return {
    phase: markPhase,
    async control() {
      const { stdout } = await execute(gitExecutable, ["--version"]);
      // execFile's callback follows close; all of this control's listeners have run.
      if (sample.children.length !== 1 || pending.size !== 0)
        throw new Error("ISS212 live-count-control");
      const version = stdout.trim();
      if (!/^git version [\w.+-]{1,80}$/.test(version)) throw new Error("ISS212 git-version");
      return version;
    },
    finish() {
      markPhase(phase);
      closed = true;
      for (const [name, listener] of listeners) unsubscribe(name, listener);
      sample.pending = pending.size;
      return sample;
    },
  };
}

export type CaseTiming = ReturnType<typeof createTimingCapture>;

export async function startCaseTiming(key: keyof typeof cases) {
  const output = process.env.ISS212_TIMING;
  if (!output) return undefined; // Default gates do no probes, subscriptions or writes.
  if (!isAbsolute(output)) throw new Error("ISS212 output must be absolute and outside checkout");
  const root = process.cwd();
  if (resolve(output).startsWith(root + "/") || resolve(output).startsWith(root + "\\"))
    throw new Error("ISS212 output must be outside checkout");
  const head = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
  const gitExecutable = (
    await execute(platform() === "win32" ? "where.exe" : "which", ["git"])
  ).stdout
    .trim()
    .split(/\r?\n/)[0]!;
  const inputs = [
    ...Object.values(cases).map(({ file }) => file),
    "test/dogfood/fixtures/source-failure.ts",
    "test/dogfood/fixtures/prerequisite.ts",
    "test/dogfood/fixtures/iss212-timing.ts",
    "vitest.config.ts",
    "package.json",
    "pnpm-lock.yaml",
  ];
  const hashes = Object.fromEntries(
    await Promise.all(
      inputs.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(resolve(root, file)))
          .digest("hex"),
      ]),
    ),
  );
  const config = (await import("../../../vitest.config.js")).default.test!;
  const identity = {
    head,
    inputs: hashes,
    case: cases[key],
    utc: new Date().toISOString(),
    node: process.version,
    nodeExecutable: process.execPath,
    gitExecutable,
    platform: platform(),
    release: release(),
    arch: arch(),
    profile: {
      source: "vitest.config.ts; CLI command retained by the diagnostic caller",
      fileParallelism: config.fileParallelism,
      workers: config.fileParallelism === false ? 1 : config.maxWorkers,
      concurrent: config.sequence?.concurrent,
      testTimeout: config.testTimeout,
      hookTimeout: config.hookTimeout,
    },
  };
  const capture = createTimingCapture(gitExecutable);
  let git: string | undefined;
  // Runs after ALL afterEach hooks. Cleanup has its own phase in the owning files.
  onTestFinished(async (context) => {
    const sample = capture.finish();
    validateTiming(sample);
    if (context.task.result?.state !== "pass") throw new Error("ISS212 case-not-passed");
    const json = JSON.stringify({ identity: { ...identity, git }, ...sample });
    if (Buffer.byteLength(json) > 1_000_000) throw new Error("ISS212 record-bound");
    await writeFile(output, json + "\n", { flag: "wx" });
  });
  git = await capture.control();
  return capture;
}

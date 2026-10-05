import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";

// ISS-221: test-only observation. No argv, cwd, environment, output or error
// messages enter this stream. The caller retains the command/checkout identity.
// Each side fits 512 KiB (384 timing + 64 log + 64 identity/summary).
// Thus the complete baseline/candidate pair stays below 1 MiB per named case.
export const TIMING_LIMIT = 384 * 1024;
export const BASE = "1feb3df8a17c2aae4d5ebef67052e7db036e8388";
export const MEASURED_FILES = [
  "test/dogfood/refresh.test.ts",
  "test/dogfood/queue.test.ts",
  "test/dogfood/integration-continuation.test.ts",
  "test/dogfood/fixtures/source-failure.ts",
  "test/dogfood/fixtures/continuation.ts",
];
const PATCH_FILE = "test/dogfood/fixtures/iss221-baseline.patch";
const HELPER_FILE = "test/dogfood/fixtures/iss221-timing.ts";
export const cases = {
  pending: {
    shard: "refresh",
    name: "reconciles pending publication before saved-stop recovery and preserves the same forward lease",
  },
  published: {
    shard: "refresh",
    name: "reconciles published publication before saved-stop recovery and preserves the same forward lease",
  },
  remote: {
    shard: "refresh",
    name: "reconciles wrong-remote publication before saved-stop recovery and preserves the same forward lease",
  },
  lease: {
    shard: "refresh",
    name: "reconciles lease-moved publication before saved-stop recovery and preserves the same forward lease",
  },
  evidence: {
    shard: "refresh",
    name: "requires new exact-head host evidence after main refresh while reviewing the full implementation",
  },
  candidate: {
    shard: "queue",
    name: "ISS-229 executor recovery refreshed=true afterMirror=true control=candidate retains one native lineage through admission, review, attribution and terminal replay",
  },
  reentry: {
    shard: "queue",
    name: "ISS-229 executor recovery refreshed=false afterMirror=true control=published retains one native lineage through admission, review, attribution and terminal replay",
  },
  unpark: {
    shard: "queue",
    name: "unparks only attempt 4 with current guidance, full diff, history and fresh review",
  },
  integration: {
    shard: "remainder",
    name: "runs native integration delivery: 'published-reentry', spent=true",
  },
} as const;
export type CaseKey = keyof typeof cases;
export function casePattern(key: CaseKey) {
  return cases[key].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
}
type Phase =
  "setup" | "hook-1" | "hook-2" | "body" | "lifecycle" | "re-entry" | "assertion" | "cleanup";
type Child = {
  id: number;
  phase: Phase | "control";
  operation: string;
  created: number;
  start?: number;
  end?: number;
  spawn?: number;
  exit?: number;
  close?: number;
  code?: number | null;
  signal?: string | null;
};

function operation(args: string[]) {
  const file = basename(args[0] ?? "").toLowerCase();
  if (file === "node" || file === "node.exe") return "node";
  if (file === "where.exe" || file === "which") return "lookup";
  if (file !== "git" && file !== "git.exe") return "other";
  let i = 1;
  while (args[i]?.startsWith("-") && args[i] !== "--version")
    i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i]!) ? 2 : 1;
  // An allowlist avoids retaining arbitrary arguments mistaken for subcommands.
  const command = args[i];
  return command &&
    [
      "--version",
      "init",
      "config",
      "add",
      "commit",
      "rev-parse",
      "clone",
      "remote",
      "fetch",
      "worktree",
      "checkout",
      "status",
      "diff",
      "merge",
      "merge-base",
      "rebase",
      "rev-list",
      "ls-tree",
      "show",
      "cat-file",
      "update-ref",
      "push",
      "branch",
      "reset",
      "for-each-ref",
      "log",
    ].includes(command)
    ? `git ${command}`
    : "git other";
}

type Interval = { phase: string; start: number; end: number };
type RecordRow = Record<string, any>;
const requiredPhases = ["control", "setup", "lifecycle", "re-entry", "assertion", "cleanup"];

function encode(row: RecordRow) {
  if (row.event === "created") return [row.event, row.id, row.at, row.phase];
  if (row.event === "spawn") return [row.event, row.id, row.at, row.operation];
  if (row.event === "start" || row.event === "end") return [row.event, row.id, row.at];
  if (row.event === "exit" || row.event === "close")
    return [row.event, row.id, row.at, row.code, row.signal];
  return row;
}
function decode(row: RecordRow | any[]): RecordRow {
  if (!Array.isArray(row)) return row;
  const [event, id, at, value, signal] = row;
  return {
    event,
    id,
    at,
    ...(event === "created"
      ? { phase: value }
      : event === "spawn"
        ? { operation: value }
        : { code: value, signal }),
  };
}
export function parseCaptureStream(bytes: string) {
  return bytes
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return decode(JSON.parse(line));
      } catch {
        return { event: "incomplete", reason: "truncated-record" };
      }
    });
}

// The same reducer handles completed and interrupted streams. Partial evidence
// retains observed durations/counts but never acquires a completeness verdict.
export function summarizeCapture(records: RecordRow[]) {
  const children = new Map<number, Child>();
  const phases: Interval[] = [];
  const windows: Interval[] = [];
  const errors = new Set<string>();
  let outcome = "unknown";
  let wallMs = 0;
  let finished = false;
  for (const raw of records) {
    const row = decode(raw);
    if (typeof row.at === "number") wallMs = Math.max(wallMs, row.at);
    if (row.event === "created") {
      if (children.has(row.id)) errors.add("duplicate-child");
      children.set(row.id, { id: row.id, created: row.at, phase: row.phase, operation: "unknown" });
    } else if (["start", "end", "spawn", "exit", "close"].includes(row.event)) {
      const child = children.get(row.id);
      if (!child) {
        errors.add("unmatched-event");
        continue;
      }
      const name = row.event as "start" | "end" | "spawn" | "exit" | "close";
      if (child[name] !== undefined) errors.add("duplicate-" + name);
      child[name] = row.at;
      if (name === "spawn") child.operation = row.operation;
      if (name === "close") {
        child.code = row.code;
        child.signal = row.signal;
      }
    } else if (row.event === "phase" || row.event === "window") {
      const target = row.event === "phase" ? phases : windows;
      target.push({ phase: row.phase, start: row.start, end: row.at });
    } else if (row.event === "finished") {
      if (finished) errors.add("duplicate-finish");
      finished = true;
      outcome = row.outcome;
      if (row.records !== records.length || row.children !== children.size)
        errors.add("dropped-records");
    } else if (row.event === "overflow" || row.event === "incomplete") {
      errors.add(row.reason ?? "overflow");
    }
  }
  if (!finished) errors.add("missing-finish");
  for (const required of requiredPhases)
    if (!phases.some((row) => row.phase === required)) errors.add("missing-phase:" + required);
  const rows = [...children.values()];
  const pending = rows.filter((row) => row.close === undefined).length;
  if (pending) errors.add("pending-children");
  for (const row of rows) {
    const times = [row.created, row.start, row.end, row.spawn, row.exit, row.close];
    if (times.some((time, i) => time === undefined || (i > 0 && time < times[i - 1]!)))
      errors.add("incomplete-child");
  }
  const operations = [...new Set(rows.map((row) => row.phase + ":" + row.operation))].map((key) => {
    const matching = rows.filter((row) => row.phase + ":" + row.operation === key);
    const { phase, operation } = matching[0]!;
    const durations = matching
      .filter((row) => row.close !== undefined)
      .map((row) => row.close! - row.created)
      .sort((a, b) => a - b);
    const n = durations.length;
    return {
      phase,
      operation,
      count: matching.length,
      completed: n,
      summedChildMs: durations.reduce((a, b) => a + b, 0),
      medianChildMs: n
        ? (durations[Math.floor((n - 1) / 2)]! + durations[Math.floor(n / 2)]!) / 2
        : null,
      maxChildMs: durations.at(-1) ?? null,
      exits: matching.reduce<Record<string, number>>((counts, row) => {
        const key = row.close === undefined ? "pending" : String(row.signal ?? row.code);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    };
  });
  const control = rows.filter((row) => row.phase === "control");
  if (control.length !== 1 || control[0]?.operation !== "git --version" || control[0]?.code !== 0)
    errors.add("live-count-control");
  return {
    outcome,
    wallMs,
    phases,
    windows,
    childCount: rows.length,
    operations,
    pending,
    errors: [...errors],
    completeness: errors.size ? "unknown" : "complete",
  };
}

export function createCapture(output: string, identity: unknown, limit = TIMING_LIMIT) {
  const origin = performance.now();
  const now = () => Math.round((performance.now() - origin) * 1000) / 1000;
  const records: RecordRow[] = [];
  const pending = new Map<ChildProcess, number>();
  let phase = "control";
  let window = "timing-hook";
  let mark = 0;
  let windowMark = 0;
  let bytes = 0;
  let buffer = "";
  let closed = false;
  let overflow = false;
  let count = 0;
  let boundaries = 0;
  writeFileSync(output, "", { flag: "wx" });
  function flush() {
    if (buffer) {
      appendFileSync(output, buffer);
      buffer = "";
    }
  }
  function record(value: RecordRow) {
    if (closed || overflow) return;
    const line = JSON.stringify(encode(value)) + "\n";
    if (bytes + Buffer.byteLength(line) > limit - 128) {
      overflow = true;
      const marker = { event: "overflow", completeness: "unknown" };
      records.push(marker);
      buffer += JSON.stringify(marker) + "\n";
      flush();
      return;
    }
    records.push(value);
    bytes += Buffer.byteLength(line);
    buffer += line;
    if (Buffer.byteLength(buffer) >= 8192) flush();
  }
  record({ event: "identity", identity });
  flush();
  const timer = setInterval(flush, 250);
  timer.unref();
  const census = (message: unknown) => {
    const child = (message as { process: ChildProcess }).process;
    if (++count > 2048) {
      if (count === 2049) record({ event: "incomplete", reason: "child-bound" });
      return;
    }
    const id = count;
    if (pending.has(child)) record({ event: "incomplete", reason: "duplicate-child" });
    pending.set(child, id);
    record({ event: "created", id, phase, at: now() });
    child.once("spawn", () =>
      record({ event: "spawn", id, at: now(), operation: operation(child.spawnargs) }),
    );
    child.once("error", () => record({ event: "incomplete", reason: "child-error", id }));
    child.once("exit", (code, signal) => record({ event: "exit", id, at: now(), code, signal }));
    child.once("close", (code, signal) => {
      record({ event: "close", id, at: now(), code, signal });
      pending.delete(child);
    });
  };
  const trace = (name: "start" | "end") => (message: unknown) => {
    const id = pending.get((message as { process: ChildProcess }).process);
    if (id) record({ event: name, id, at: now() });
    else record({ event: "incomplete", reason: "unmatched-" + name });
  };
  const listeners = [
    ["child_process", census],
    ["tracing:child_process.spawn:start", trace("start")],
    ["tracing:child_process.spawn:end", trace("end")],
  ] as const;
  for (const [name, listener] of listeners) subscribe(name, listener);
  const boundary = (next: Phase) => {
    if (closed) return;
    const at = now();
    if (++boundaries > 256) {
      if (boundaries === 257) record({ event: "incomplete", reason: "phase-bound" });
      return;
    }
    // Hook/body windows are independent of semantic phases, so nested
    // lifecycle markers cannot hide time spent in either existing hook.
    if (["hook-1", "hook-2", "body", "cleanup"].includes(next)) {
      record({ event: "window", phase: window, start: windowMark, at });
      window = next;
      windowMark = at;
    }
    if (!["hook-1", "hook-2", "body"].includes(next)) {
      record({ event: "phase", phase, start: mark, at, next, pending: pending.size });
      phase = next;
      mark = at;
    }
    flush();
  };
  return {
    phase: boundary,
    async control() {
      await promisify(execFile)("git", ["--version"]);
      const spawnRows = records.filter((row) => row.event === "spawn");
      if (count !== 1 || pending.size || spawnRows[0]?.operation !== "git --version")
        record({ event: "incomplete", reason: "live-count-control" });
      boundary("setup");
    },
    finish(outcome: string) {
      const at = now();
      record({ event: "phase", phase, start: mark, at });
      record({ event: "window", phase: window, start: windowMark, at });
      record({ event: "finished", outcome, at, children: count, records: records.length + 1 });
      closed = true;
      clearInterval(timer);
      for (const [name, listener] of listeners) unsubscribe(name, listener);
      flush();
      return summarizeCapture(records);
    },
  };
}
let active: ReturnType<typeof createCapture> | undefined;
export function iss221Phase(phase: Phase) {
  active?.phase(phase);
}

export async function installIss221Timing() {
  const output = process.env.ISS221_TIMING;
  if (!output) return; // No hooks, children, timers, subscriptions or writes by default.
  const rel = relative(process.cwd(), output);
  if (!isAbsolute(output) || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error("ISS221 timing output must be outside checkout");
  const key = process.env.ISS221_CASE as CaseKey;
  if (!Object.hasOwn(cases, key)) throw new Error("ISS221 unknown case");
  const { beforeEach, onTestFinished } = await import("vitest");
  beforeEach(async (context) => {
    let task: typeof context.task | typeof context.task.suite = context.task;
    const names: string[] = [];
    while (task) {
      names.unshift(task.name);
      task = task.suite;
    }
    if (!names.join(" ").endsWith(cases[key].name)) throw new Error("ISS221 wrong case selection");
    active = createCapture(output, {
      case: key,
      test: cases[key].name,
      utc: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
    });
    const capture = active;
    onTestFinished((finished) => {
      active = undefined;
      // Persist first, including failed/timed-out cases. Capture errors never
      // replace the test result in the artifact, and can never establish PASS.
      const sample = capture.finish(finished.task.result?.state ?? "unknown");
      if (sample.completeness !== "complete")
        throw new Error(`ISS221 incomplete capture: ${sample.errors.join(",")}`);
    });
    await capture.control();
  });
}

// The committed patch is independent of the candidate remedy. Its only
// executable additions are these inert observation calls in the three tests.
function diagnosticLine(line: string) {
  return /^\s*(?:$|import \{ installIss221Timing, iss221Phase \} from "\.\/fixtures\/iss221-timing\.js";|await installIss221Timing\(\);|iss221Phase\("(?:setup|hook-1|hook-2|body|lifecycle|re-entry|assertion|cleanup)"\);)$/.test(
    line,
  );
}
export function diagnosticOnlyPatch(patch: string) {
  const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
  if (files.length !== 3 || files.some((file) => !MEASURED_FILES.slice(0, 3).includes(file!)))
    throw new Error("ISS221 baseline patch file inventory");
  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-")) throw new Error("ISS221 baseline patch removes source");
    if (line.startsWith("+") && !diagnosticLine(line.slice(1)))
      throw new Error("ISS221 baseline patch contains non-diagnostic work");
  }
}
export function hasFixtureRemedy(diff: string) {
  return diff
    .split("\n")
    .some(
      (line) =>
        !line.startsWith("---") &&
        !line.startsWith("+++") &&
        (line.startsWith("+") || line.startsWith("-")) &&
        !diagnosticLine(line.slice(1)),
    );
}

// Opt-in reporter in this same helper: retain actual Vitest counts and final
// outcomes without logging arbitrary assertion values, paths or error text.
export default class Iss221Reporter implements Reporter {
  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: readonly unknown[],
    reason: TestRunEndReason,
  ) {
    const tests = modules.flatMap((module) => [...module.children.allTests()]);
    const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
    for (const test of tests) counts[test.result().state]++;
    const executed = tests.filter((test) => test.result().state !== "skipped");
    const key = process.env.ISS221_CASE as CaseKey;
    const result = {
      reason,
      unhandledErrors: errors.length,
      files: modules.length,
      total: tests.length,
      counts,
      selected: executed.map((test) => ({
        matches: test.fullName.replaceAll(" > ", " ").endsWith(cases[key].name),
        state: test.result().state,
        diagnostic: test.diagnostic(),
        failures: (test.result().errors ?? []).map((error) =>
          /Hook timed out/.test(error.message ?? "")
            ? "hook-timeout"
            : /Test timed out/.test(error.message ?? "")
              ? "test-timeout"
              : "failure",
        ),
      })),
      // Numeric module metrics distinguish import/collection from test work.
      modules: modules.map((module) => {
        const {
          environmentSetupDuration,
          prepareDuration,
          collectDuration,
          setupDuration,
          duration,
        } = module.diagnostic();
        return {
          state: module.state(),
          environmentSetupDuration,
          prepareDuration,
          collectDuration,
          setupDuration,
          duration,
        };
      }),
    };
    const bytes = JSON.stringify(result) + "\n";
    if (Buffer.byteLength(bytes) > 16 * 1024) throw new Error("ISS221 reporter overflow");
    writeFileSync(process.env.ISS221_TIMING + ".result.json", bytes, { flag: "wx" });
  }
}
type TestReport = {
  reason: string;
  unhandledErrors: number;
  files: number;
  total: number;
  counts: { passed: number; failed: number; skipped: number; pending: number };
  selected: { matches: boolean; state: string }[];
};
function reportObserved(report: TestReport | null) {
  return (
    report !== null &&
    ["passed", "failed"].includes(report.reason) &&
    report.unhandledErrors === 0 &&
    report.files === 1 &&
    report.counts.pending === 0 &&
    report.counts.passed + report.counts.failed === 1 &&
    report.selected.length === 1 &&
    report.selected[0]?.matches === true &&
    ["passed", "failed"].includes(report.selected[0].state)
  );
}
export function reportPassed(report: TestReport | null) {
  return (
    reportObserved(report) &&
    report?.reason === "passed" &&
    report.unhandledErrors === 0 &&
    report.files === 1 &&
    report.counts.passed === 1 &&
    report.counts.failed === 0 &&
    report.counts.pending === 0 &&
    report.selected.length === 1 &&
    report.selected[0]?.matches === true &&
    report.selected[0].state === "passed"
  );
}

type ProcessResult = {
  code: number | null;
  signal: string | null;
  launchError: boolean;
  timedOut: boolean;
  overflow: boolean;
  stdout: string;
};
export const PAIR_BUDGET_MS = 14 * 60 * 1000;
export const PAIR_WALL_LIMIT_MS = PAIR_BUDGET_MS + 20_000; // teardown/I/O, still below the step
// Own only the process tree launched for this diagnostic command. On Windows,
// killing just Node would leave Vitest children competing with the ordinary gate.
export async function boundedProcess(
  executable: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; deadline: number; capture?: boolean },
): Promise<ProcessResult> {
  const remaining = options.deadline - performance.now();
  if (remaining <= 0) throw new Error("ISS221 shard wall budget exhausted");
  return new Promise((done, reject) => {
    let stdout = "";
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    let launchError = false;
    let stopping: Promise<void> | undefined;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", options.capture ? "pipe" : "ignore", "ignore"],
    });
    function stop() {
      if (stopping) return;
      stopping = (async () => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          // taskkill closes the complete owned tree; never a SID/PGID census.
          await promisify(execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            timeout: 10_000,
            windowsHide: true,
          });
        } else {
          child.kill("SIGKILL"); // cheap local controls have no grandchildren
        }
      })();
      // Attach immediately; close awaits it too. Failed teardown is not success.
      void stopping.catch(reject);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, remaining);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) {
        overflow = true;
        stop();
      } else stdout += chunk;
    });
    child.once("error", () => {
      launchError = true;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      void (async () => {
        await stopping;
        done({ code, signal, launchError, timedOut, overflow, stdout });
      })().catch(reject);
    });
  });
}

export function pairAccepted(
  remedy: boolean,
  candidates: {
    code: number | null;
    signal: string | null;
    launchError: boolean;
    timedOut: boolean;
    overflow: boolean;
    capture: ReturnType<typeof summarizeCapture> | null;
  }[],
  expected: number,
) {
  return (
    remedy &&
    candidates.length === expected &&
    candidates.every(
      (result) =>
        result.code === 0 &&
        !result.signal &&
        !result.launchError &&
        !result.timedOut &&
        !result.overflow &&
        result.capture?.outcome === "pass" &&
        result.capture.completeness === "complete",
    )
  );
}

// Runs only in the committed PR branch-name opt-in, once per existing shard.
// No repository variables, artifact retrieval, retries or controller changes.
async function diagnosticPairs(shard: string) {
  if (!["refresh", "queue", "remainder"].includes(shard)) throw new Error("ISS221 invalid shard");
  if (process.platform !== "win32" || !process.env.RUNNER_TEMP)
    throw new Error("ISS221 pairs belong to hosted Windows");
  const deadline = performance.now() + PAIR_BUDGET_MS;
  const cwd = process.cwd();
  const root = resolve(process.env.RUNNER_TEMP, "iss221-" + shard);
  const evidence = resolve(root, "evidence");
  await mkdir(root);
  await mkdir(evidence);
  const git = async (args: string[], directory = cwd) => {
    const result = await boundedProcess("git", ["-C", directory, ...args], {
      cwd,
      deadline,
      capture: true,
    });
    if (
      result.code !== 0 ||
      result.signal ||
      result.timedOut ||
      result.launchError ||
      result.overflow
    )
      throw new Error("ISS221 diagnostic Git command failed");
    return result.stdout;
  };
  const head = (await git(["rev-parse", "HEAD"])).trim();
  if (head !== process.env.ISS221_CANDIDATE_HEAD)
    throw new Error("ISS221 candidate checkout differs from the published head");
  const tree = (await git(["rev-parse", "HEAD^{tree}"])).trim();
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  // Read exact committed blobs, never synthesize the baseline patch from the
  // candidate diff. Both sides load the same test-only observer.
  const patch = await git(["show", head + ":" + PATCH_FILE]);
  diagnosticOnlyPatch(patch);
  const helper = await git(["show", head + ":" + HELPER_FILE]);
  const patchSha256 = hash(patch);
  const helperSha256 = hash(helper);
  const plumbingSha256 = hash(patch + "\0" + helper);
  const diff = await git([
    "diff",
    "--no-ext-diff",
    "--no-color",
    BASE,
    head,
    "--",
    ...MEASURED_FILES,
  ]);
  const remedy = hasFixtureRemedy(diff);
  await writeFile(resolve(evidence, "diagnostic.patch"), patch);
  await writeFile(resolve(evidence, "iss221-timing.ts"), helper);
  for (const file of ["package.json", "pnpm-lock.yaml", "vitest.config.ts"])
    if (
      (await git(["rev-parse", BASE + ":" + file])) !==
      (await git(["rev-parse", head + ":" + file]))
    )
      throw new Error("ISS221 changed measurement settings");
  const baseline = resolve(root, "baseline");
  await git(["clone", "--no-hardlinks", "--no-checkout", cwd, baseline]);
  await git(["-c", "core.autocrlf=false", "checkout", "--detach", BASE], baseline);
  await git(["apply", "--check", resolve(evidence, "diagnostic.patch")], baseline);
  await git(["apply", "--whitespace=nowarn", resolve(evidence, "diagnostic.patch")], baseline);
  await writeFile(resolve(baseline, HELPER_FILE), helper);
  // Only frozen-installed dependencies are shared. Each test retains its own
  // native mutable fixture repositories and records; no seed/cache is introduced.
  await symlink(resolve(cwd, "node_modules"), resolve(baseline, "node_modules"), "junction");
  const selectedCases = Object.entries(cases).filter(([, row]) => row.shard === shard);
  const candidateResults = [];
  let baselineEvidenceAvailable = true;
  for (const [key, selected] of selectedCases) {
    for (const [side, directory, revision] of [
      ["baseline", baseline, BASE],
      ["candidate", cwd, head],
    ] as const) {
      const output = resolve(evidence, key + "-" + side);
      await mkdir(output);
      const file = selected.shard === "remainder" ? "integration-continuation" : selected.shard;
      const testFile = "test/dogfood/" + file + ".test.ts";
      const pattern = casePattern(key as CaseKey);
      const args = [
        resolve(directory, "node_modules/vitest/vitest.mjs"),
        "run",
        testFile,
        "-t",
        pattern,
        "--no-color",
        "--reporter=" + resolve(directory, HELPER_FILE),
      ];
      const timing = resolve(output, "timing.jsonl");
      const identity = {
        case: key,
        test: selected.name,
        side,
        base: BASE,
        head: revision,
        tree: side === "candidate" ? tree : (await git(["rev-parse", BASE + "^{tree}"])).trim(),
        patchSha256,
        helperSha256,
        plumbingSha256,
        // Tokenized roots keep argv useful without publishing host paths.
        command: {
          executable: "node",
          args: [
            "<checkout>/node_modules/vitest/vitest.mjs",
            ...args.slice(1, -1),
            "--reporter=<checkout>/" + HELPER_FILE,
          ],
          cwd: "<checkout>",
        },
        started: new Date().toISOString(),
        node: process.version,
        run: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        job: process.env.GITHUB_JOB,
        event: process.env.GITHUB_EVENT_NAME,
        requestedHead: process.env.ISS221_CANDIDATE_HEAD,
        settings: { testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, workers: 1 },
      };
      await writeFile(resolve(output, "invocation.json"), JSON.stringify(identity) + "\n");
      console.log("ISS221 invocation " + JSON.stringify(identity));
      const wallStart = performance.now();
      const terminal = await boundedProcess(process.execPath, args, {
        cwd: directory,
        deadline,
        env: { ...process.env, ISS212_TIMING: "", ISS221_TIMING: timing, ISS221_CASE: key },
      });
      let capture: ReturnType<typeof summarizeCapture> | null = null;
      try {
        const bytes = await readFile(timing, "utf8");
        capture = summarizeCapture(parseCaptureStream(bytes));
      } catch {
        // Missing or interrupted writes remain unknown; no result is inferred.
      }
      const { stdout: _stdout, ...exit } = terminal;
      let report: TestReport | null = null;
      try {
        report = JSON.parse(await readFile(timing + ".result.json", "utf8"));
      } catch {
        /* Missing reporter completion stays unknown. */
      }
      const result = {
        ...exit,
        ended: new Date().toISOString(),
        fileWallMs: performance.now() - wallStart,
        capture,
        report,
      };
      const summary = JSON.stringify({ identity, ...result }) + "\n";
      if (Buffer.byteLength(summary) + Buffer.byteLength(JSON.stringify(identity)) > 112 * 1024)
        throw new Error("ISS221 summary overflow");
      await writeFile(resolve(output, "terminal.json"), summary);
      // This is the worker evidence channel: delivery fetches --log-failed,
      // never artifacts. Incomplete and failed captures are printed as well.
      console.log("ISS221 result " + summary.trimEnd());
      if (side === "candidate")
        candidateResults.push({
          ...result,
          capture: reportPassed(report) ? capture : null,
        });
      // A baseline timeout may leave phases/children unknown. Retain that red
      // without requiring a baseline PASS or inventing missing durations.
      if (
        side === "baseline" &&
        (!capture ||
          !reportObserved(report) ||
          capture.errors.includes("missing-finish") ||
          capture.errors.includes("overflow") ||
          terminal.code === null ||
          terminal.launchError ||
          terminal.timedOut ||
          terminal.overflow ||
          terminal.signal)
      )
        baselineEvidenceAvailable = false;
      if (terminal.timedOut) throw new Error("ISS221 shard wall budget exhausted");
    }
  }
  const accepted = pairAccepted(remedy, candidateResults, selectedCases.length);
  const disposition = {
    shard,
    remedy,
    baselineEvidenceAvailable,
    accepted,
    candidates: candidateResults.length,
  };
  await writeFile(resolve(evidence, "disposition.json"), JSON.stringify(disposition) + "\n");
  console.log("ISS221 disposition " + JSON.stringify(disposition));
  if (!accepted || !baselineEvidenceAvailable)
    throw new Error(
      remedy
        ? "ISS221 candidate red or incomplete pair evidence"
        : "ISS221 diagnostic-only stage 1: no fixture remedy; retained pairs require the next author",
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Also bound filesystem/setup stalls, when there is no child deadline to fire.
  const watchdog = setTimeout(() => {
    console.error("ISS221 runner wall budget exhausted; partial evidence remains unknown");
    process.exit(1);
  }, PAIR_WALL_LIMIT_MS);
  try {
    await diagnosticPairs(process.argv[2] ?? "");
  } catch (error) {
    // Only our fixed diagnostic messages are published, never raw child output,
    // host paths, argv from fixtures, environment or arbitrary error messages.
    const message =
      error instanceof Error && error.message.startsWith("ISS221 ")
        ? error.message
        : "ISS221 diagnostic setup or evidence I/O failed";
    console.error(message);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
}

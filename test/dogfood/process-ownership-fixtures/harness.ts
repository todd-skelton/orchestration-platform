// Composition harness for ISS-219. It runs the real run-loop.sh entry, the real
// process-ownership wrapper and collector, the real codexAdapter(...).git and
// launchObserver/observe-process.mjs paths, with absolute inert executables and
// named-pipe barriers. ORCHESTRATION_CGROUP_ROOT injects a plain directory: the
// wrapper records its own enrollment there and `standIn` is the only place a
// descendant is added, and only after the first child's ordering witness
// passed. This is composition evidence; kernel inheritance is host-qualified.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, constants, createReadStream, openSync, writeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import type {
  OwnershipBinding,
  ProcessIdentity,
} from "../../../scripts/dogfood/process-ownership.mjs";

export const repository = resolve(import.meta.dirname, "../../..");
export const fixtures = import.meta.dirname;
export type Event = {
  name: string;
  event: string;
  identity: ProcessIdentity;
  sentinel?: string;
  argv?: string[];
  forbiddenPresent?: boolean;
  stdout?: string;
};
export type Witness = {
  enrolled: boolean;
  published: boolean;
  prepared: boolean;
  firstChildPid: number;
  binding: OwnershipBinding | null;
};
const PEERS = [
  "supervisor",
  "helper",
  "helper-grandchild",
  "worker",
  "worker-grandchild",
  "same-group-outsider",
  "other-group-outsider",
];

// Independent oracle read from the real process, never from the collector.
export async function procIdentity(pid: number): Promise<ProcessIdentity> {
  const text = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = text
    .slice(text.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  return {
    pid,
    starttime: fields[19]!,
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    state: fields[0]!,
  };
}

const executable = async (path: string, source: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, { mode: 0o700 });
};

export async function ownershipHarness(
  run = "owned",
  options: { launcher?: string; root?: string; exitCode?: number } = {},
) {
  const root = options.root ?? (await mkdtemp(resolve(tmpdir(), "iss219-")));
  const home = resolve(root, run);
  const task = resolve(home, "task");
  const stateRoot = resolve(root, "state");
  const config = resolve(home, "loop.json");
  const cgroupRoot = resolve(root, "cgroups");
  const address = resolve(home, "pipes");
  const packet = resolve(home, "packet.json");
  const request = resolve(home, "request.json");
  const worktree = resolve(home, "worktree");
  await mkdir(address, { recursive: true });
  await mkdir(worktree);
  for (const name of [
    "events",
    ...PEERS,
    "zombie-child",
    "zombie-parent",
    "zombie-release",
    "zombie-parent-release",
    "zombie-life",
  ]) {
    const child = spawn("/usr/bin/mkfifo", [resolve(address, name)], { stdio: "ignore" });
    await new Promise<void>((done, reject) =>
      child.once("exit", (code) => (code === 0 ? done() : reject(new Error(`mkfifo ${code}`)))),
    );
  }
  // The harness keeps read/write ends of every command pipe open, so no peer
  // blocks on open and no writer sees EPIPE.
  const eventFd = openSync(resolve(address, "events"), constants.O_RDWR);
  const events: Event[] = [];
  const live = new Set<string>();
  const waiters: Array<{ name: string; event: string; done: (row: Event) => void }> = [];
  const input = createReadStream(resolve(address, "events"), { fd: eventFd });
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const row = JSON.parse(buffer.slice(0, end)) as Event;
      buffer = buffer.slice(end + 1);
      if (row.event === "close-pipe") {
        input.destroy();
        return;
      }
      if (row.event === "ready") live.add(row.name);
      if (row.event === "exiting") live.delete(row.name);
      const index = waiters.findIndex((w) => w.name === row.name && w.event === row.event);
      if (index >= 0) waiters.splice(index, 1)[0]!.done(row);
      else events.push(row);
    }
  });
  const take = (name: string, event = "ready") => {
    const index = events.findIndex((row) => row.name === name && row.event === event);
    return index >= 0
      ? Promise.resolve(events.splice(index, 1)[0]!)
      : new Promise<Event>((done) => waiters.push({ name, event, done }));
  };
  const send = (name: string, message: string) => {
    const fd = openSync(resolve(address, name), constants.O_RDWR);
    try {
      writeSync(fd, `${JSON.stringify(message)}\n`);
    } finally {
      closeSync(fd);
    }
  };
  const node = resolve(task, "tools/node-v24.15.0-linux-x64/bin/node");
  await mkdir(dirname(node), { recursive: true });
  await symlink(process.execPath, node);
  await mkdir(resolve(task, "repo"));
  await mkdir(resolve(task, "codex-home"));
  await writeFile(resolve(task, "codex-home/config.toml"), 'base_url = "http://1.2.3.4:8317/v1"\n');
  const actor = resolve(fixtures, "actor.mjs");
  const gitExecutable = resolve(home, "inert-git");
  await executable(
    gitExecutable,
    `#!${process.execPath}\nawait import(${JSON.stringify(actor)});\n`,
  );
  const entry = resolve(fixtures, "launcher.mjs");
  const stub = (mode: string) =>
    `#!${process.execPath}\nprocess.argv = [process.execPath, ${JSON.stringify(entry)}, ${JSON.stringify(mode)}, ${JSON.stringify(packet)}];\nawait import(${JSON.stringify(entry)});\n`;
  await executable(resolve(home, "bin/ip"), stub("ip"));
  await executable(resolve(task, "tools/cli/node_modules/.bin/pnpm"), stub("supervisor"));
  await writeFile(resolve(home, "stdin"), "");
  await writeFile(
    request,
    JSON.stringify({
      executable: process.execPath,
      args: [actor, "worker", address, "worker"],
      stdin: resolve(home, "stdin"),
      stdout: resolve(home, "worker-trace.jsonl"),
      stderr: resolve(home, "worker-err.log"),
      identity: resolve(home, "process.json"),
      done: resolve(home, "exit.json"),
    }),
  );
  await writeFile(
    packet,
    JSON.stringify({
      address,
      worktree,
      request,
      gitExecutable,
      exitCode: options.exitCode ?? 0,
      adapter: resolve(repository, "scripts/dogfood/dispatch-adapter.ts"),
    }),
  );
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: "dogfood-loop/v1",
      run,
      stateRoot,
      repository: "fixture/inert",
      adapter: "self",
    }),
  );
  const launcher = options.launcher ?? resolve(repository, "scripts/executor/run-loop.sh");
  const records = resolve(stateRoot, run, "process-ownership");
  const witnesses: string[] = [];
  const env = {
    PATH: `${resolve(home, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    TASK_ROOT: task,
    ORCHESTRATION_CGROUP_ROOT: cgroupRoot,
    BASH_ENV: resolve(fixtures, "first-child.sh"),
    OWNERSHIP_TEST_RECORDS: records,
    // bash skips BASH_ENV for a level-1 `bash -c` whose stdin it takes for a
    // network connection (a sandbox refusing getpeername looks like one). The
    // canonical start is never level 1 either; SHLVL keeps the witness honest.
    SHLVL: "1",
  };
  const children: ChildProcess[] = [];
  const launch = () => {
    const witness = resolve(home, `witness-${witnesses.length + 1}.json`);
    witnesses.push(witness);
    const child = spawn("/bin/bash", [launcher, config], {
      env: { ...env, OWNERSHIP_TEST_WITNESS: witness },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
    const completion = new Promise<{
      code: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
    }>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => done({ code, signal, stdout, stderr }));
    });
    return { child, completion, witness };
  };
  const witness = async (index = witnesses.length): Promise<Witness> =>
    JSON.parse(await readFile(witnesses[index - 1]!, "utf8"));
  const bindings = async () =>
    Promise.all(
      (await readdir(records))
        .sort()
        .map(
          async (name) =>
            JSON.parse(
              await readFile(resolve(records, name, "binding.json"), "utf8"),
            ) as OwnershipBinding,
        ),
    );
  // The declared kernel stand-in and the ONLY inheritance assumption: it adds
  // independently captured descendants to the injected membership after the
  // first child witnessed enrollment and publication. Nothing is derived from
  // parent chains, SID/PGID or argv.
  const standIn = async (members: ProcessIdentity[], binding?: OwnershipBinding) => {
    const seen = await witness();
    if (!seen.enrolled || !seen.published || !seen.binding)
      throw new Error("first-child-ordering-witness-failed");
    const leaf = (binding ?? seen.binding).cgroupPath;
    await writeFile(resolve(leaf, "cgroup.procs"), members.map((row) => `${row.pid}\n`).join(""));
  };
  const outsider = (name: string, detached: boolean) => {
    const child = spawn(node, [actor, "held", address, name], {
      detached,
      stdio: "ignore",
      env: { PATH: env.PATH },
    });
    children.push(child);
    return child;
  };
  let closed = false;
  const close = async (remove = true) => {
    if (closed) return;
    closed = true;
    // Ask each individually identified live peer to exit, then reap only the
    // processes this harness spawned. No group signal, no inferred child.
    await Promise.all(
      [...live].map((name) => {
        send(name, "exit");
        return take(name, "exiting");
      }),
    );
    // The harness is the last writer: a sentinel line ends the blocking read.
    const drained = new Promise<void>((done) => input.once("close", done));
    const sentinel = openSync(resolve(address, "events"), constants.O_RDWR);
    writeSync(sentinel, `${JSON.stringify({ event: "close-pipe" })}\n`);
    closeSync(sentinel);
    await drained;
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exit = new Promise<void>((done) => child.once("exit", () => done()));
      child.kill("SIGTERM");
      await exit;
    }
    // The detached observer may still be writing its exit receipt.
    if (remove) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return {
    root,
    run,
    stateRoot,
    config,
    cgroupRoot,
    records,
    address,
    worktree,
    actor,
    env,
    launch,
    witness,
    bindings,
    standIn,
    outsider,
    take,
    send,
    close,
  };
}

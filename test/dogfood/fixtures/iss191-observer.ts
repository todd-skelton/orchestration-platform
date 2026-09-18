// ISS-191 throwaway evidence only. Never land this file or its callers' hooks.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

export function sanitize(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/"'<>]+/gi, "scheme://[authority-redacted]")
    .replace(/\b[^\s/@:]+@[^\s/:]+:/g, "[authority-redacted]:")
    .replace(
      /[^\r\n]*(?:authorization|password|passwd|token|secret|credential|extraheader)[^\r\n]*/gi,
      "[credential-bearing text redacted]",
    );
}

function safeArgv(argv: string[]) {
  return argv.map((value, index) =>
    index > 0 &&
    /authorization|password|passwd|token|secret|credential|extraheader/i.test(argv[index - 1]!)
      ? "[credential argument redacted]"
      : sanitize(value),
  );
}

type Command = {
  id: number;
  executable: string;
  argv: string[];
  cwd: string;
  gitC: string | null;
  pid: number | null;
  start: number;
  spawn: number | null;
  exit: number | null;
  close: number | null;
};
type SpawnContext = {
  process: ChildProcess;
  options: { file: string; args: string[]; cwd?: string | Buffer | null };
};

const output = process.env.ISS191_EVENTS;
const enabled = Boolean(output);
const commands = new Map<ChildProcess, Command>();
let root: string | undefined;
let started: number | undefined;
let bodySettled = false;
let cleanupSettled = false;
let spanRecorded = false;
let observed25 = false;
let incomplete = false;
let overheadMs = 0;
let records = 0;
const fixtureCalls = { source: 0, repair: 0 };
let timer: ReturnType<typeof setTimeout> | undefined;

function record(event: string, fields: Record<string, unknown> = {}) {
  if (!output) return;
  const before = performance.now();
  try {
    // Fields are constructed below, never process.env, spawn options or Config.Env.
    const line = JSON.stringify({ n: ++records, event, at: before, ...fields });
    appendFileSync(output, line + "\n");
    process.stderr.write(`ISS191_EVENT ${line}\n`);
  } catch {
    incomplete = true;
  } finally {
    overheadMs += performance.now() - before;
  }
}

function unresolved() {
  return [...commands.values()].filter((command) => command.close === null);
}

export function beginCase(name: string) {
  if (!enabled) return;
  if (started !== undefined) incomplete = true;
  started = performance.now();
  record("case-entry", {
    name: sanitize(name),
    node: process.version,
    pid: process.pid,
    timeOrigin: performance.timeOrigin,
  });
  timer = setTimeout(() => observe25("timer"), 25_000);
  timer.unref();
}

function observe25(trigger: string) {
  if (started === undefined || observed25) return;
  observed25 = true;
  const observed = performance.now();
  record("observation-25s", {
    trigger,
    elapsedMs: observed - started,
    latenessMs: observed - started - 25_000,
    ownedCount: commands.size,
    bodySettled,
    cleanupSettled,
  });
  for (const command of commands.values()) {
    record("observation-owned-child", {
      ...command,
      observedAt: observed,
      elapsedMs: (command.close ?? observed) - command.start,
    });
  }
}

export function phase(name: string) {
  if (started === undefined) return;
  if (name === "body:settled") bodySettled = true;
  if (name === "source-fixture:entry") fixtureCalls.source++;
  if (name === "repair-fixture:entry") fixtureCalls.repair++;
  record("phase", { name });
  finishSpan();
}

export function ownRoot(path: string) {
  if (started === undefined) return;
  if (root !== undefined) incomplete = true;
  root = path;
  record("fixture-root", { root: sanitize(path) });
}

export function finishCleanup() {
  if (started === undefined) return;
  cleanupSettled = true;
  phase("cleanup:settled");
}

function finishSpan() {
  if (started === undefined || !bodySettled || !cleanupSettled || spanRecorded) return;
  spanRecorded = true;
  if (performance.now() - started >= 25_000) observe25("settlement-before-timer-delivery");
  record("complete-case-span", { elapsedMs: performance.now() - started });
  clearTimeout(timer);
}

export function finishFile() {
  if (!enabled) return;
  if (started !== undefined && performance.now() - started >= 25_000) {
    observe25("file-completion-before-timer-delivery");
  }
  clearTimeout(timer);
  record("worker-terminal", {
    complete:
      started !== undefined &&
      bodySettled &&
      cleanupSettled &&
      !incomplete &&
      commands.size > 0 &&
      [...commands.values()].every(
        (c) => c.pid !== null && c.spawn !== null && c.exit !== null && c.close !== null,
      ),
    observerIncomplete: incomplete,
    bodySettled,
    cleanupSettled,
    unresolved: unresolved(),
    commandCount: commands.size,
    fixtureCalls,
    overheadMs,
    overheadScope: "event persistence and spawn callback only; not total timing perturbation",
    uninstrumentedMs: null,
  });
}

function inside(path: string) {
  if (!root) return false;
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}

// Node >=24.15 documented context: { process, options }. PID is not yet set
// at tracing-end. Only the ordinary spawn event supplies the actual PID.
if (enabled) {
  channel("tracing:child_process.spawn:start").subscribe((message) => {
    const before = performance.now();
    const previousOverhead = overheadMs;
    try {
      const { process: child, options } = message as SpawnContext;
      const cwd = options.cwd == null ? process.cwd() : resolve(String(options.cwd));
      const argv = options.args.slice(1);
      let gitC: string | null = null;
      if (/^git(?:\.exe)?$/i.test(basename(options.file))) {
        gitC = cwd;
        for (let i = 0; i < argv.length; i++) {
          if (argv[i] === "-C" && argv[i + 1] !== undefined) {
            const directory = argv[++i]!;
            if (directory) gitC = resolve(gitC, directory);
          } else if (!argv[i]!.startsWith("-")) {
            break;
          }
        }
      }
      if (!inside(cwd) && !(gitC && inside(gitC))) return;
      const command: Command = {
        id: commands.size + 1,
        executable: sanitize(options.file),
        argv: safeArgv(argv),
        cwd: sanitize(cwd),
        gitC: gitC === null ? null : sanitize(gitC),
        pid: null,
        start: performance.now(),
        spawn: null,
        exit: null,
        close: null,
      };
      commands.set(child, command);
      record("command-start", { ...command });
      child.once("spawn", () => {
        command.pid = child.pid ?? null;
        command.spawn = performance.now();
        record("command-spawn", { id: command.id, pid: command.pid });
      });
      child.once("exit", (code, signal) => {
        command.exit = performance.now();
        record("command-exit", { id: command.id, code, signal });
      });
      child.once("close", (code, signal) => {
        command.close = performance.now();
        record("command-close", {
          ...command,
          code,
          signal,
          elapsedMs: command.close - command.start,
        });
      });
      // Do not attach an error handler that could swallow an otherwise unhandled
      // child error. The documented tracing error event marks incomplete below.
    } catch {
      incomplete = true;
      record("observer-error");
    } finally {
      overheadMs = previousOverhead + performance.now() - before;
    }
  });
  channel("tracing:child_process.spawn:end").subscribe((message) => {
    const command = commands.get((message as SpawnContext).process);
    if (command) record("command-launch-return", { id: command.id });
  });
  channel("tracing:child_process.spawn:error").subscribe((message) => {
    const command = commands.get((message as SpawnContext).process);
    if (command) {
      incomplete = true;
      record("spawn-tracing-error", { id: command.id });
    }
  });
}

// Same Vitest file/worker and promisify(execFile) path as the real fixture.
// These controls are selected instead of, never injected into, measured cases.
if (enabled && process.env.ISS191_CONTROL) {
  const { it, expect } = await import("vitest");
  const mode = process.env.ISS191_CONTROL;
  it("ISS191 synthetic plumbing", async (context) => {
    beginCase("ISS191 synthetic plumbing");
    const directory = await realpath(
      await mkdtemp(resolve(process.env.RUNNER_TEMP!, "iss191-control-")),
    );
    ownRoot(directory);
    const execute = promisify(execFile);
    const result = await execute(
      process.execPath,
      ["-e", "process.stdout.write('iss191-synthetic')"],
      {
        cwd: directory,
      },
    );
    expect(result.stdout).toBe("iss191-synthetic");
    const gitExecutable = (await execute("where.exe", ["git"])).stdout.trim().split(/\r?\n/)[0]!;
    await execute(gitExecutable, ["-C", directory, "--version"]);
    const observed = [...commands.values()];
    expect(observed).toHaveLength(2);
    expect(observed.every((c) => c.pid !== null && c.close !== null)).toBe(true);
    expect(observed[0]!.cwd).toBe(sanitize(directory));
    expect(observed[0]!.executable).toBe(sanitize(process.execPath));
    expect(observed[0]!.argv).toEqual(["-e", "process.stdout.write('iss191-synthetic')"]);
    expect(observed[1]!.gitC).toBe(sanitize(directory));
    let held: ChildProcess | undefined;
    if (mode === "held") {
      held = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
        cwd: directory,
        stdio: ["pipe", "ignore", "ignore"],
      });
      await once(held, "spawn");
    }
    context.onTestFinished(async () => {
      record("synthetic-result", { state: context.task.result?.state, open: unresolved().length });
      if (held) {
        const closed = once(held, "close");
        held.stdin!.end(); // EOF permits natural exit; no kill, sleep or detach.
        await closed;
      }
      if (mode === "unresolved") {
        incomplete = true; // Deliberately unresolved observer, not an orphan process.
        record("synthetic-unresolved-observer");
      }
      await rm(directory, { recursive: true, force: true });
    });
    phase("body:settled");
  });
}

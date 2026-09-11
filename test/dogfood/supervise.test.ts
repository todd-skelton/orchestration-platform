import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
let runOrdinal = 0;
const command = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const hook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");

async function fixture(
  mode: "blocked-count-unavailable" | "complete" | "composition-blocked" | "wait" = "complete",
) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "supervise-command-fixture-")));
  roots.push(root);
  roots.push(root);
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([stateRoot, worktreeRoot].map((path) => mkdir(path)));
  const config = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-command-run",
    repository: "fixture/repository",
    stableExecutorRoot: resolve(import.meta.dirname, "../.."),
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "gpt-5.6-sol", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable: process.execPath,
    exitReceiptWindowMs: 30_000,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  const request = resolve(root, "loop.json");
  const runState = resolve(stateRoot, config.run);
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    mkdir(runState, { recursive: true }).then(async () => {
      await Promise.all([
        writeFile(
          resolve(runState, "command-controls.json"),
          `${JSON.stringify({
            mode,
            main: "a".repeat(40),
            interruptComment: mode === "composition-blocked",
          })}\n`,
        ),
        writeFile(
          resolve(runState, "command-issue.json"),
          `${JSON.stringify({
            state: "OPEN",
            key: "ISS-105",
            labels: ["ready"],
            comments: [],
          })}\n`,
        ),
      ]);
    }),
  ]);
  return { request, runState };
}

async function run(request: string) {
  const token = `command-${++runOrdinal}`;
  const stdoutPath = resolve(dirname(request), `${token}.stdout`);
  const stderrPath = resolve(dirname(request), `${token}.stderr`);
  const [stdoutFile, stderrFile] = await Promise.all([
    open(stdoutPath, "w"),
    open(stderrPath, "w"),
  ]);
  let code: number;
  try {
    code = await new Promise<number>((done, reject) => {
      let timedOut = false;
      const child = spawn(
        process.execPath,
        ["--import", pathToFileURL(hook).href, command, request],
        {
          windowsHide: true,
          stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
        },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 25_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (status) => {
        clearTimeout(timer);
        done(timedOut ? 124 : (status ?? 1));
      });
    });
  } finally {
    await Promise.all([stdoutFile.close(), stderrFile.close()]);
  }
  return {
    code,
    stdout: await readFile(stdoutPath, "utf8"),
    stderr: await readFile(stderrPath, "utf8"),
  };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it("accepts one compact loop config through an observed wait to completion", async () => {
  const current = await fixture("wait");
  const result = await run(current.request);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([
    { status: "observing-author", cursor: 0 },
    { status: "complete", cursor: 1, participants: 2 },
    { status: "idle", run: "synthetic-command-run" },
  ]);
}, 30_000);

it("restarts a completed compact config without repeating component effects", async () => {
  const current = await fixture();
  const first = await run(current.request);
  expect(first.code, first.stderr).toBe(0);
  expect(
    first.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([{ status: "complete", participants: 2 }, { status: "idle" }]);
  const callsPath = resolve(current.runState, "command-calls.json");
  const calls = await readFile(callsPath, "utf8");
  expect(JSON.parse(calls)).toEqual({ setup: 1, source: 1, delivery: 1 });
  const completionPath = resolve(current.runState, "iss-105-queue", "item-1-complete.json");
  const completionBytes = await readFile(completionPath, "utf8");

  const restarted = await run(current.request);
  expect(restarted.code).toBe(0);
  expect(JSON.parse(restarted.stdout)).toMatchObject({ status: "idle" });
  expect(await readFile(callsPath, "utf8")).toBe(calls);
  expect(await readFile(completionPath, "utf8")).toBe(completionBytes);
}, 30_000);

it("finishes the queue after merge closed the issue before item completion", async () => {
  const current = await fixture();
  const first = await run(current.request);
  expect(first.code, first.stderr).toBe(0);
  const callsPath = resolve(current.runState, "command-calls.json");
  const calls = await readFile(callsPath, "utf8");
  await Promise.all([
    rm(resolve(current.runState, "cycle-1-complete.json")),
    rm(resolve(current.runState, "iss-105-queue", "item-1-complete.json")),
    rm(resolve(current.runState, "iss-105-queue", "queue-complete.json")),
  ]);

  const restarted = await run(current.request);
  expect(restarted.code).toBe(0);
  expect(
    restarted.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([{ status: "complete", participants: 2 }, { status: "idle" }]);
  expect(await readFile(callsPath, "utf8")).toBe(calls);
}, 30_000);

it("finishes the queue after item completion but before queue completion", async () => {
  const current = await fixture();
  const first = await run(current.request);
  expect(first.code, first.stderr).toBe(0);
  const callsPath = resolve(current.runState, "command-calls.json");
  const calls = await readFile(callsPath, "utf8");
  await Promise.all([
    rm(resolve(current.runState, "cycle-1-complete.json")),
    rm(resolve(current.runState, "iss-105-queue", "queue-complete.json")),
  ]);

  const restarted = await run(current.request);
  expect(restarted.code).toBe(0);
  expect(
    restarted.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([{ status: "complete", participants: 2 }, { status: "idle" }]);
  expect(await readFile(callsPath, "utf8")).toBe(calls);
}, 30_000);

it("rejects an invalid run before reading selection state", async () => {
  const current = await fixture();
  const config = JSON.parse(await readFile(current.request, "utf8"));
  config.run = "..";
  await writeFile(current.request, `${JSON.stringify(config)}\n`);
  const result = await run(current.request);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toEqual({ status: "blocked", reason: "invalid-run" });
  expect(result.stdout).toBe("");
});

it("preserves the stop reason when the candidate count is unavailable", async () => {
  const current = await fixture("blocked-count-unavailable");
  const result = await run(current.request);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toEqual({
    status: "blocked",
    reason: "typecheck-failed-after-retry",
  });
  const issue = JSON.parse(await readFile(resolve(current.runState, "command-issue.json"), "utf8"));
  expect(issue.labels).toContain("ready");
  expect(issue.comments).toHaveLength(1);
  expect(issue.comments[0]).toContain("implementation-attempt count unavailable");
  expect(issue.comments[0]).toContain("saved typecheck gate record");
});

it("finishes an intent-only learning note before resuming queue work", async () => {
  const current = await fixture("blocked-count-unavailable");
  const stopped = await run(current.request);
  expect(stopped.code).toBe(1);
  await rm(resolve(current.runState, "cycle-1-stop-1-complete.json"));
  await writeFile(
    resolve(current.runState, "command-issue.json"),
    `${JSON.stringify({ state: "OPEN", key: "ISS-105", labels: [], comments: [] })}\n`,
  );
  await writeFile(
    resolve(current.runState, "command-controls.json"),
    `${JSON.stringify({ mode: "complete" })}\n`,
  );

  const restarted = await run(current.request);
  expect(restarted.code, restarted.stderr).toBe(0);
  const issue = JSON.parse(await readFile(resolve(current.runState, "command-issue.json"), "utf8"));
  expect(issue.state).toBe("CLOSED");
  expect(issue.comments).toHaveLength(1);
  expect(issue.comments[0]).toContain("typecheck-failed-after-retry");
});

it("reconciles an interrupted composition stop against the original selection", async () => {
  const current = await fixture("composition-blocked");
  const stopped = await run(current.request);
  expect(stopped.code).toBe(1);
  expect(JSON.parse(stopped.stderr)).toMatchObject({
    status: "blocked",
    reason: "setup-dependency-failed",
  });
  const selectedPath = resolve(current.runState, "cycle-1-selected.json");
  const original = await readFile(selectedPath, "utf8");
  const issueAfterStop = JSON.parse(
    await readFile(resolve(current.runState, "command-issue.json"), "utf8"),
  );
  expect(issueAfterStop.labels).toContain("ready");
  expect(issueAfterStop.comments).toHaveLength(1);
  await writeFile(
    resolve(current.runState, "command-controls.json"),
    `${JSON.stringify({ mode: "complete", main: "d".repeat(40) })}\n`,
  );

  const restarted = await run(current.request);
  expect(restarted.code, restarted.stderr).toBe(0);
  expect(await readFile(selectedPath, "utf8")).toBe(original);
  expect(JSON.parse(original)).toMatchObject({ key: "ISS-105", base: "a".repeat(40) });
  const issue = JSON.parse(await readFile(resolve(current.runState, "command-issue.json"), "utf8"));
  expect(issue.state).toBe("CLOSED");
  expect(issue.comments).toHaveLength(1);
  expect(issue.comments[0]).toContain("setup-dependency-failed");
});

it("keeps selection and queue composition in the supervisor entrypoint", async () => {
  const entry = await readFile(command, "utf8");
  const queue = await readFile(resolve("scripts/dogfood/queue.ts"), "utf8");
  expect(entry).toContain('from "./queue.ts"');
  expect(entry).toContain('from "./supervision.ts"');
  expect(entry).not.toContain("queue-adapter");
  expect(queue).toContain("export function repositoryQueueAdapter");
  expect(queue).toContain('from "./setup.mjs"');
  expect(queue).toContain('from "./repair.mjs"');
  expect(queue).toContain('from "./delivery.mjs"');
});

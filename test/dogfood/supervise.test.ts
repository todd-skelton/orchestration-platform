import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const execute = promisify(execFile);
const roots: string[] = [];
const command = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const hook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");

async function fixture(mode: "complete" | "wait" = "complete") {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "supervise-command-fixture-")));
  roots.push(root);
  roots.push(root);
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([stateRoot, worktreeRoot].map((path) => mkdir(path)));
  const config = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-command-run",
    issue: { key: "ISS-104", number: 361 },
    repository: "fixture/repository",
    stableExecutorRoot: resolve(import.meta.dirname, "../.."),
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "gpt-5.6-sol", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable: process.execPath,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  const request = resolve(root, "loop.json");
  const runState = resolve(stateRoot, config.run);
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    mkdir(runState, { recursive: true }).then(() =>
      writeFile(resolve(runState, "command-controls.json"), `${JSON.stringify({ mode })}\n`),
    ),
  ]);
  return { request, runState };
}

async function run(request: string) {
  try {
    const { stdout, stderr } = await execute(
      process.execPath,
      ["--import", pathToFileURL(hook).href, command, request],
      { timeout: 25_000, windowsHide: true },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
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
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([
    { status: "observing-author", cursor: 0 },
    { status: "complete", cursor: 1, participants: 2 },
  ]);
}, 30_000);

it("restarts a completed compact config without repeating component effects", async () => {
  const current = await fixture();
  const first = await run(current.request);
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ status: "complete", participants: 2 });
  const callsPath = resolve(current.runState, "command-calls.json");
  const calls = await readFile(callsPath, "utf8");
  expect(JSON.parse(calls)).toEqual({ setup: 1, source: 1, delivery: 1 });
  const completionPath = resolve(current.runState, "queue", "item-1-complete.json");
  const completionBytes = await readFile(completionPath, "utf8");

  const restarted = await run(current.request);
  expect(restarted.code).toBe(0);
  expect(JSON.parse(restarted.stdout)).toMatchObject({ status: "complete", participants: 2 });
  expect(await readFile(callsPath, "utf8")).toBe(calls);
  expect(await readFile(completionPath, "utf8")).toBe(completionBytes);
}, 30_000);

it("keeps the command-to-component trace within three non-test files", async () => {
  const entry = await readFile(command, "utf8");
  const queue = await readFile(resolve("scripts/dogfood/queue.ts"), "utf8");
  expect(entry).toContain('from "./queue.ts"');
  expect(entry).not.toContain("queue-adapter");
  expect(queue).toContain("export function repositoryQueueAdapter");
  expect(queue).toContain('from "./setup.mjs"');
  expect(queue).toContain('from "./repair.mjs"');
  expect(queue).toContain('from "./delivery.mjs"');
});

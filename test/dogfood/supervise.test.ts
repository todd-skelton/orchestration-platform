import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  itemAuthority,
  participantIdentity,
  queueDigest,
  type QueueConfig,
  type QueueItem,
} from "../../scripts/dogfood/queue.js";

const execute = promisify(execFile);
const roots: string[] = [];
const command = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const hook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");

async function fixture(controllerRoot: string, mode: "complete" | "wait" = "complete") {
  const root = await realpath(
    await mkdtemp(resolve(tmpdir(), "supervise-command-fixture-")),
  );
  roots.push(root);
  const paths = {
    queue: resolve(root, "queue"),
    setup: resolve(root, "setup"),
    source: resolve(root, "source"),
    repair: resolve(root, "repair"),
    repository: resolve(root, "repository"),
    pilot: resolve(root, "pilot"),
    author: resolve(root, "author"),
    review: resolve(root, "review"),
  };
  await Promise.all(Object.values(paths).map((path) => mkdir(path)));
  const base = "a".repeat(40);
  const stable = "5".repeat(40);
  const source = {
    owner: "synthetic-controller",
    run: "synthetic-command-item",
    issue: "fixture-338",
    pilotRevision: stable,
    base,
    worktree: paths.author,
    reviewWorktree: paths.review,
    stateDirectory: paths.source,
    allowedPaths: ["scripts/dogfood/queue.ts"],
    repository: "fixture/repository",
    requiredChecks: ["linux", "windows", "macos"],
    author: { model: "author", effort: "high", promptFile: resolve(root, "author.md") },
    reviewer: { model: "reviewer", effort: "high", promptFile: resolve(root, "reviewer.md") },
    adapter: { kind: "codex-exec" as const, executable: resolve(root, "codex") },
  };
  const item = {
    id: "synthetic-338",
    issue: source.issue,
    base,
    implementationAttempt: 1,
    setup: {
      run: source.run,
      issue: source.issue,
      repository: source.repository,
      repositoryRoot: paths.repository,
      controllerRoot,
      controllerRevision: stable,
      pilotRevision: stable,
      base,
      baseBranch: "main",
      sourceBranch: "codex/synthetic-338",
      pilotWorktree: paths.pilot,
      sourceWorktree: paths.author,
      reviewWorktree: paths.review,
      stateDirectory: paths.setup,
      authority: {
        schemaVersion: "dogfood-setup-authority/v1",
        controller: source.owner,
        run: source.run,
        issue: source.issue,
        repository: source.repository,
        controllerRevision: stable,
        pilotRevision: stable,
        base,
        baseBranch: "main",
        sourceBranch: "codex/synthetic-338",
        repositoryRoot: paths.repository,
        controllerRoot,
        pilotWorktree: paths.pilot,
        sourceWorktree: paths.author,
        reviewWorktree: paths.review,
        stateDirectory: paths.setup,
        actions: ["worktrees", "dependencies"],
      },
    },
    source,
    repair: {
      stateDirectory: paths.repair,
      sourcePaths: ["scripts/dogfood/queue.ts"],
      acceptanceCriteria: ["preserve the bounded queue contract"],
      author: { model: "repair", effort: "high", promptFile: resolve(root, "repair.md") },
      reviewer: { model: "review", effort: "high", promptFile: resolve(root, "review.md") },
    },
    delivery: { requiredChecks: [...source.requiredChecks], policy: { kind: "fixture" } },
  } as QueueItem;
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-request/v1",
    run: "synthetic-command-queue",
    controllerRoot,
    controllerRevision: stable,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: 8,
    initialHistory: [],
    items: [item],
    authority: undefined as never,
  };
  config.authority = {
    schemaVersion: "dogfood-bounded-queue-authority/v1",
    controller: source.owner,
    run: config.run,
    controllerRoot,
    controllerRevision: stable,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: 8,
    lineageDigest: queueDigest(config.initialHistory.map(participantIdentity)),
    itemsDigest: queueDigest([itemAuthority(item)]),
    actions: ["setup", "source", "repair", "delivery"],
  };
  const request = resolve(paths.queue, "queue-request.json");
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    writeFile(resolve(root, "command-controls.json"), `${JSON.stringify({ mode })}\n`),
  ]);
  return { root, request };
}

async function run(request: string, mocked = true) {
  try {
    const { stdout, stderr } = await execute(
      process.execPath,
      [...(mocked ? ["--import", hook] : []), command, request],
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
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    ),
  );
});

it("invokes the hosted command and refuses a mismatched executing root", async () => {
  const wrongController = await mkdtemp(resolve(tmpdir(), "supervise-wrong-controller-"));
  roots.push(wrongController);
  const current = await fixture(wrongController);
  const result = await run(current.request, false);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toEqual({
    status: "blocked",
    reason: "controller-executor-mismatch",
  });
  expect(result.stdout).toBe("");
}, 30_000);

it("invokes the hosted command through an observed wait to completion", async () => {
  const current = await fixture(
    await realpath(resolve(import.meta.dirname, "../..")),
    "wait",
  );
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

it("invokes completion and a completed restart without repeating component effects", async () => {
  const current = await fixture(await realpath(resolve(import.meta.dirname, "../..")));
  const first = await run(current.request);
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ status: "complete", participants: 2 });
  const calls = await readFile(resolve(current.root, "command-calls.json"), "utf8");

  const restarted = await run(current.request);
  expect(restarted.code).toBe(0);
  expect(JSON.parse(restarted.stdout)).toMatchObject({ status: "complete", participants: 2 });
  expect(await readFile(resolve(current.root, "command-calls.json"), "utf8")).toBe(calls);
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
  const engine = queue.slice(
    queue.indexOf("export async function queueStep"),
    queue.indexOf("// The repository adapter is co-located"),
  );
  expect(engine).not.toMatch(/setupStep|\bstep\(|repairStep|deliveryStep/);
});

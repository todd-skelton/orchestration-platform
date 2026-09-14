import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  ACCEPTED_REPLAN,
  currentCandidateAttempt,
  queueConfigFromLoop,
  repositoryQueueAdapter,
  queueStep,
  validateLoopExecutor,
  validateLoopConfig,
  validateQueueConfig,
  type LoopConfig,
  type QueueAdapter,
  type QueueConfig,
  type QueueDeliveryResult,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import type { Adapter, Attempt } from "../../scripts/dogfood/flow.js";
import { workerPrompt } from "../../scripts/dogfood/flow.js";
import * as selfAdapter from "../../adapters/self.mjs";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import { setupStep } from "../../scripts/dogfood/setup.js";
import { nextCycle, persistCycle } from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];
const repositoryPolicy: RepositoryAdapter = {
  selectCandidates: () => [],
  issueContext: async ({ key, executorRoot }) => {
    const body = await readFile(resolve(executorRoot, `planning/drafts/${key}.md`), "utf8");
    const section = /\n## Done when\s*\n([\s\S]*?)(?=\n## |$)/.exec(body)?.[1]?.trim() ?? body;
    return {
      title: /^title:\s*"([^"]+)"\s*$/m.exec(body)?.[1] ?? key,
      body,
      acceptanceCriteria: [section],
      rules: await readFile(resolve(executorRoot, "docs/loop.md"), "utf8"),
    };
  },
  branchName: ({ key, attempt }) =>
    `codex/${key.toLowerCase()}${attempt === 1 ? "" : `-attempt-${attempt}`}`,
  pullRequest: async () => {
    throw new Error("unused pullRequest");
  },
  requiredChecks: () => [
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest",
  ],
  park: () => "add the `ready` label after acting on the note",
  mergeMethod: () => ({ method: "squash" }),
  afterMerge: () => {},
};
const execute = promisify(execFile);
const unavailable = { status: "unavailable" as const };
const usage = (input: number, output: number) => ({
  inputTokens: { status: "known" as const, value: input },
  outputTokens: { status: "known" as const, value: output },
  costUsd: unavailable,
});

function participant(
  ordinal: number,
  item: string,
  stage: "source" | "repair",
  role: "author" | "reviewer",
  outcome: QueueParticipant["outcome"],
): QueueParticipant {
  return {
    ordinal,
    id: `${item}-${stage}-${role}`,
    item,
    stage,
    role,
    outcome,
    usage: usage(ordinal, 1),
  };
}

function deliveryCompletion(
  item: QueueItem,
  head: string,
  reviewId: string,
  number = 1,
  branch = `codex/${item.id}`,
): Extract<QueueDeliveryResult, { status: "complete" }> {
  return {
    status: "complete",
    run: item.source.run,
    issue: item.issue,
    head,
    reviewId,
    publication: {
      number,
      url: item.delivery.refresh?.url ?? `https://example.test/pull/${number}`,
    },
    checks: item.delivery.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: `https://example.test/check/${name}`,
    })),
    mergeCommit: "d".repeat(40),
    cleanup: { status: "confirmed", branch },
    retries: 0,
  };
}

async function fixture(itemCount = 1) {
  const root = await mkdtemp(resolve(tmpdir(), "bounded-queue-fixture-"));
  roots.push(root);
  const stateDirectory = resolve(root, "queue");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(stateDirectory));
  const items = Array.from({ length: itemCount }, (_, index) => {
    const id = `synthetic-${index + 1}`;
    const base = String(index + 1).repeat(40);
    const run = `synthetic-item-run-${index + 1}`;
    const requiredChecks = ["linux", "windows", "macos"];
    const controller = "synthetic-controller";
    const controllerRoot = resolve(root, "controller");
    const sourceWorktree = resolve(root, `${id}-source-worktree`);
    const reviewWorktree = resolve(root, `${id}-review-worktree`);
    return {
      id,
      issue: `fixture-${index + 1}`,
      base,
      implementationAttempt: index + 1,
      implementationAttemptCeiling: 4,
      setup: {
        controller,
        run,
        issue: `fixture-${index + 1}`,
        repository: "fixture/repository",
        repositoryRoot: controllerRoot,
        controllerRoot,
        controllerRevision: "a".repeat(40),
        pilotRevision: "a".repeat(40),
        base,
        baseBranch: "main",
        sourceBranch: `codex/${id}`,
        pilotWorktree: resolve(root, `${id}-pilot`),
        sourceWorktree,
        reviewWorktree,
        stateDirectory: resolve(root, `${id}-setup`),
      },
      source: {
        owner: controller,
        run,
        issue: `fixture-${index + 1}`,
        pilotRevision: "a".repeat(40),
        base,
        worktree: sourceWorktree,
        reviewWorktree,
        stateDirectory: resolve(root, `${id}-source`),
        allowedPaths: ["scripts/dogfood/queue.ts"],
        repository: "fixture/repository",
        requiredChecks,
        author: { model: "author-model", effort: "high", prompt: "author prompt" },
        reviewer: { model: "reviewer-model", effort: "high", prompt: "reviewer prompt" },
        adapter: { kind: "codex-exec", executable: process.execPath },
      },
      repair: {
        stateDirectory: resolve(root, `${id}-repair`),
        acceptanceCriteria: ["one preserved criterion"],
        author: { model: "author-model", effort: "high", prompt: "author prompt" },
        reviewer: {
          model: "reviewer-model",
          effort: "high",
          prompt: "reviewer prompt",
        },
      },
      delivery: { requiredChecks: [...requiredChecks], policy: { kind: "fixture" } },
    } as unknown as QueueItem;
  });
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-config/v1",
    controller: "synthetic-controller",
    run: "synthetic-bounded-queue",
    controllerRoot: resolve(root, "controller"),
    controllerRevision: "a".repeat(40),
    stateDirectory,
    limit: itemCount,
    nativeLaunchCeiling: 8,
    initialHistory: [],
    items,
  };
  return { root, stateDirectory, config, items };
}

async function loopFixture(withRuntime = false) {
  const root = await mkdtemp(resolve(tmpdir(), "loop-config-fixture-"));
  roots.push(root);
  const repository = resolve(root, "repository");
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  const acceptanceCriteria =
    "- One file drives the run.\n- Preserve the Markdown list.\n  Keep this continuation intact.";
  await Promise.all([
    mkdir(resolve(repository, "docs"), { recursive: true }),
    mkdir(resolve(repository, "planning/drafts"), { recursive: true }),
    ...(withRuntime
      ? [
          cp(resolve(import.meta.dirname, "../../scripts"), resolve(repository, "scripts"), {
            recursive: true,
          }),
        ]
      : []),
  ]);
  await Promise.all([
    writeFile(resolve(repository, ".gitignore"), "node_modules/\n"),
    writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nKeep it small.\n"),
    writeFile(
      resolve(repository, "planning/roadmap.json"),
      JSON.stringify({
        repository: "fixture/repository",
        issues: [{ key: "ISS-104", file: "planning/drafts/ISS-104.md" }],
      }),
    ),
    writeFile(
      resolve(repository, "planning/drafts/ISS-104.md"),
      `---\nkey: ISS-104\ntitle: "One config"\n---\n\n## Done when\n\n${acceptanceCriteria}\n\n## Out of scope\n`,
    ),
  ]);
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const gitExecutable = (await execute(finder, ["git"])).stdout.trim().split(/\r?\n/)[0]!;
  await execute(gitExecutable, ["init", "-b", "main", repository]);
  await execute(gitExecutable, ["-C", repository, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", repository, "config", "user.email", "fixture@example.test"]);
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "fixture"]);
  const base = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  const loop = {
    schemaVersion: "dogfood-loop/v1" as const,
    run: "iss-104-run",
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: repository,
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "gpt-5.6-sol", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  return {
    repository,
    stateRoot,
    loop,
    gitExecutable,
    acceptanceCriteria,
    selected: { key: "ISS-104", number: 361, base },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function acceptedReplanFixture() {
  const f = await loopFixture();
  const git = async (args: string[]) =>
    (await execute(f.gitExecutable, ["-C", f.repository, ...args])).stdout.trim();
  await git(["checkout", "-b", "codex/7766-jpeg-g4"]);
  await writeFile(resolve(f.repository, "jpeg.txt"), "preserved JPEG implementation\n");
  await git(["add", "."]);
  await git(["commit", "-m", "rejected candidate"]);
  const head = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  const loop: LoopConfig = {
    ...f.loop,
    run: ACCEPTED_REPLAN.run,
    adapter: "chase-sets",
    repository: "chase-sets/chase-sets",
    targetMilestone: 158,
    acceptedReplan: ACCEPTED_REPLAN.id,
    nativeLaunchCeiling: 16,
  };
  const selected = { ...f.selected, key: "cs-7766", number: 7766 };
  const policy: RepositoryAdapter = {
    ...repositoryPolicy,
    issueContext: () => ({
      title: "JPEG",
      body: "Repair JPEG",
      acceptanceCriteria: ["JPEG"],
      rules: "Keep scope",
    }),
    branchName: ({ attempt }) => `codex/7766-jpeg-g${attempt}`,
    requiredChecks: () => ["PR Required"],
  };
  const history = [
    participant(1, "cs-7766:1", "source", "author", "passed"),
    participant(2, "cs-7766:1", "source", "reviewer", "failed"),
    participant(3, "cs-7766:1", "repair", "author", "passed"),
    participant(4, "cs-7766:1", "repair", "reviewer", "failed"),
    participant(5, "cs-7766:3", "source", "author", "passed"),
    participant(6, "cs-7766:3", "source", "reviewer", "passed"),
    { ...participant(7, "cs-7766:4", "source", "author", "dead"), id: "dead-author" },
    participant(8, "cs-7766:4", "source", "author", "passed"),
    participant(9, "cs-7766:4", "source", "reviewer", "passed"),
  ];
  const priorDirectory = resolve(loop.stateRoot, ACCEPTED_REPLAN.priorRun, "cs-7766-attempt-4");
  const priorSource = resolve(priorDirectory, "source");
  await mkdir(priorSource, { recursive: true });
  const prior = {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "failed",
    run: ACCEPTED_REPLAN.priorRun,
    index: 0,
    item: "cs-7766:4",
    issue: "https://github.com/chase-sets/chase-sets/issues/7766",
    base: selected.base,
    candidateAttempt: 4,
    head,
    reviewId: history[8]!.id,
    findings: [
      { file: "PR Required", line: 1, severity: "blocking", text: "route-collision inventory" },
    ],
    history,
    retries: 1,
    acceptedStage: null,
    stateDirectory: null,
  };
  const publication = {
    number: 8005,
    url: "https://github.com/chase-sets/chase-sets/pull/8005",
    head,
    repository: loop.repository,
    sourceBranch: "codex/7766-jpeg-g4",
  };
  const preserved = new Map<string, string>([
    [resolve(priorDirectory, "attempt.json"), JSON.stringify(prior)],
    [resolve(priorSource, "publication.json"), JSON.stringify(publication)],
    [resolve(priorSource, "config.json"), JSON.stringify({ config: { mainBase: selected.base } })],
    [
      resolve(priorSource, "hosted-failure.log"),
      "Original failed run: route-collision inventory\n",
    ],
  ]);
  // The fresh run already stopped in setup, while old attempt-1 worktrees exist.
  const freshAttempt = resolve(loop.stateRoot, loop.run, "cs-7766-attempt-1", "attempt.json");
  await mkdir(resolve(freshAttempt, ".."), { recursive: true });
  preserved.set(
    freshAttempt,
    JSON.stringify({
      ...prior,
      phase: "setup",
      run: loop.run,
      candidateAttempt: 1,
      head: selected.base,
      history: [],
      findings: [],
    }),
  );
  for (const [path, value] of preserved) await writeFile(path, value);
  for (const role of ["pilot", "source", "review"]) {
    const path = resolve(loop.worktreeRoot, `cs-7766-attempt-1-${role}`);
    await git(["worktree", "add", "--detach", path, selected.base]);
  }
  const oldSource = resolve(loop.worktreeRoot, "cs-7766-attempt-4-source");
  await git(["worktree", "add", oldSource, publication.sourceBranch]);
  const compose = (config = loop) => queueConfigFromLoop(config, f.repository, selected, policy);
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  return { ...f, loop, selected, head, history, preserved, oldSource, git, compose, setup };
}

it("admits only the accepted replan beside preserved workspaces and refuses renewal by run name", async () => {
  const f = await acceptedReplanFixture();
  const { acceptedReplan: _accepted, ...absent } = f.loop;
  await expect(f.compose(absent)).rejects.toThrow("accepted-replan-required");
  await expect(f.compose({ ...f.loop, run: "another-fresh-run" })).rejects.toThrow(
    "invalid-accepted-replan",
  );
  await expect(f.compose({ ...f.loop, targetMilestone: 155 })).rejects.toThrow(
    "invalid-accepted-replan",
  );
  const queue = await f.compose();
  validateQueueConfig(queue);
  const item = queue.items[0]!;
  expect(item).toMatchObject({
    implementationAttempt: 5,
    implementationAttemptCeiling: 5,
    base: f.head,
    source: { base: f.head, mainBase: f.selected.base },
    delivery: {
      refresh: { number: 8005, head: f.head, localBranch: "codex/7766-jpeg-g5" },
      policy: { sourceBranch: "codex/7766-jpeg-g4" },
    },
  });
  expect(queue.initialHistory).toEqual(f.history);
  for (const actor of [item.source.author, item.source.reviewer]) {
    expect(actor.prompt).toContain("route-collision inventory");
    expect(actor.prompt).toContain("hosted-failure.log");
    expect(actor.prompt).toContain("5665159522");
    expect(actor.prompt).toContain("cs-7766-attempt-4");
  }
  await expect(setupStep(item.setup, f.setup, f.repository)).resolves.toMatchObject({
    status: "ready",
  });
  expect(await f.compose()).toEqual(queue);
  for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  expect(await f.git(["rev-parse", "codex/7766-jpeg-g4"])).toBe(f.head);
  expect(await readFile(resolve(item.source.worktree, "jpeg.txt"), "utf8")).toBe(
    "preserved JPEG implementation\n",
  );
  expect(await f.git(["status", "--porcelain"])).toBe("");
}, 30_000);

it.each(["pilot", "source", "review", "branch"])(
  "refuses an unrelated accepted-replan %s collision",
  async (role) => {
    const f = await acceptedReplanFixture();
    const item = (await f.compose()).items[0]!;
    if (role === "branch") await f.git(["branch", item.setup.sourceBranch, f.head]);
    else {
      const path =
        role === "pilot"
          ? item.setup.pilotWorktree
          : role === "source"
            ? item.source.worktree
            : item.source.reviewWorktree;
      await mkdir(path, { recursive: true });
      await writeFile(resolve(path, "unrelated.txt"), "preserve me\n");
    }
    await expect(setupStep(item.setup, f.setup, f.repository)).rejects.toThrow(
      `worktree-collision:${role === "branch" ? "source" : role}`,
    );
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it("stops accepted correction before setup when its original failed log is unavailable", async () => {
  const f = await acceptedReplanFixture();
  const evidence = [...f.preserved.keys()].find((path) => path.endsWith("hosted-failure.log"))!;
  await rm(evidence);
  await expect(f.compose()).rejects.toThrow("hosted-failure-evidence-unavailable");
  await expect(
    readFile(resolve(f.loop.stateRoot, f.loop.run, ACCEPTED_REPLAN.slug, "attempt.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const { acceptedReplan: _accepted, ...absent } = f.loop;
  await expect(
    f.compose({ ...absent, stateRoot: resolve(f.loop.stateRoot, "new-state") }),
  ).rejects.toThrow("accepted-replan-required");
}, 30_000);

it.each([false, true])(
  "retains accepted lineage on external closure (current participants: %s)",
  async (launched) => {
    const f = await acceptedReplanFixture();
    const cycle = { selection: { ...f.selected, cycle: 1 }, initialHistory: [] };
    await persistCycle(f.loop, cycle);
    const queue = await f.compose();
    const history = launched
      ? [
          ...f.history,
          participant(10, queue.items[0]!.id, "source", "author", "passed"),
          participant(11, queue.items[0]!.id, "source", "reviewer", "failed"),
        ]
      : f.history;
    if (launched)
      for (const value of history)
        await writeFile(
          resolve(queue.stateDirectory, `participant-${value.ordinal}-terminal.json`),
          JSON.stringify(value),
        );
    const adapter = {
      async issue() {
        return { number: 7766, key: "cs-7766", state: "CLOSED" as const, labels: [], comments: [] };
      },
      async currentMain(): Promise<string> {
        throw new Error("No successor");
      },
      async removeReady() {
        throw new Error("Already closed");
      },
      async close() {
        throw new Error("Already closed");
      },
      async comment() {
        throw new Error("No stop");
      },
    };
    const policy = { ...repositoryPolicy, selectCandidates: () => [] };
    await expect(nextCycle(f.loop, f.repository, adapter, policy)).resolves.toBeUndefined();
    await expect(nextCycle(f.loop, f.repository, adapter, policy)).resolves.toBeUndefined();
    const completed = JSON.parse(
      await readFile(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-complete.json"), "utf8"),
    );
    expect(completed.history).toEqual(history);
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it.each(["review-failure", "hosted-failure", "complete"])(
  "consumes one accepted correction through %s and restart",
  async (outcome) => {
    const f = await acceptedReplanFixture();
    const queue = await f.compose();
    const history = structuredClone(f.history);
    const calls: string[] = [];
    let observing = true;
    const findings = [
      { file: "jpeg.txt", line: 1, severity: "blocking" as const, text: "Fix route inventory" },
    ];
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return history;
      },
      async setup() {
        calls.push("setup");
        return { status: "ready" };
      },
      async source(item) {
        if (observing) return { status: "observing-author" };
        calls.push("current-author-and-review");
        history.push(
          participant(10, item.id, "source", "author", "passed"),
          participant(
            11,
            item.id,
            "source",
            "reviewer",
            outcome === "review-failure" ? "failed" : "passed",
          ),
        );
        return outcome === "review-failure"
          ? { status: "fixable-review", head: "b".repeat(40), reviewId: history[10]!.id, findings }
          : {
              status: "accepted",
              head: "b".repeat(40),
              reviewId: history[10]!.id,
              stateDirectory: item.source.stateDirectory,
            };
      },
      async repair() {
        throw new Error("No second correction authorized");
      },
      async delivery(item, accepted) {
        calls.push("current-delivery");
        return outcome === "hosted-failure"
          ? { status: "failed", head: accepted.head, reviewId: accepted.reviewId, findings }
          : deliveryCompletion(
              item,
              accepted.head,
              accepted.reviewId,
              8005,
              item.setup.sourceBranch,
            );
      },
    };
    await expect(queueStep(queue, adapter)).resolves.toMatchObject({ status: "observing-author" });
    expect(calls).toEqual(["setup"]);
    observing = false;
    const finish = async () => queueStep(await f.compose(), adapter);
    if (outcome === "complete") {
      await expect(finish()).resolves.toMatchObject({ status: "complete", participants: 11 });
      await expect(finish()).resolves.toMatchObject({ status: "complete", participants: 11 });
    } else {
      await expect(finish()).rejects.toThrow("implementation-attempt-ceiling-exhausted");
      await expect(finish()).rejects.toThrow("implementation-attempt-ceiling-exhausted");
    }
    expect(calls).toEqual([
      "setup",
      "current-author-and-review",
      ...(outcome === "review-failure" ? [] : ["current-delivery"]),
    ]);
    const saved = JSON.parse(await readFile(resolve(queue.stateDirectory, "attempt.json"), "utf8"));
    expect(saved.candidateAttempt).toBe(5);
    expect(saved.history.slice(0, 9)).toEqual(f.history);
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it("validates an optional Chase Sets milestone number and keeps self runs unscoped", async () => {
  const { loop } = await loopFixture();
  expect(() => validateLoopConfig(loop)).not.toThrow();
  expect(() =>
    validateLoopConfig({ ...loop, adapter: "chase-sets", targetMilestone: 155 }),
  ).not.toThrow();
  for (const targetMilestone of [
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "155",
    null,
  ]) {
    expect(() =>
      validateLoopConfig({
        ...loop,
        adapter: "chase-sets",
        targetMilestone,
      } as unknown as LoopConfig),
    ).toThrow("invalid-target-milestone");
  }
  expect(() => validateLoopConfig({ ...loop, targetMilestone: 155 })).toThrow(
    "target-milestone-unsupported-adapter",
  );
});

it("validates and carries the provider outage ceiling into worker configuration", async () => {
  const { loop, repository, selected } = await loopFixture();
  for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => validateLoopConfig({ ...loop, providerOutageCeilingMs: value })).toThrow(
      "invalid-provider-outage-ceiling",
    );
  }
  const queue = await queueConfigFromLoop(
    { ...loop, providerOutageCeilingMs: 12_345 },
    repository,
    selected,
    repositoryPolicy,
  );
  expect(queue.items[0]!.source.providerOutageCeilingMs).toBe(12_345);
});

it("binds a refresh to a later attempt whose exact prior head is its source base", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttempt = 1;
  item.delivery.refresh = {
    number: 341,
    url: "https://example.test/pull/341",
    head: item.base,
  };
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");

  item.implementationAttempt = 2;
  expect(() => validateQueueConfig(current.config)).not.toThrow();

  item.delivery.refresh.head = "f".repeat(40);
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");
});

it("admits repository-wide source scope without a pre-authored repair path list", async () => {
  const current = await fixture();
  current.items[0]!.source.allowedPaths = ["."];
  expect(() => validateQueueConfig(current.config)).not.toThrow();
});

it("derives the complete internal queue from one compact loop config and selected issue", async () => {
  const { loop, repository, stateRoot, selected } = await loopFixture();
  await expect(
    queueConfigFromLoop({ ...loop, run: ".." }, repository, selected, repositoryPolicy),
  ).rejects.toThrow("invalid-run");
  const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);

  expect(queue.items).toHaveLength(1);
  expect(queue.controller).toBe(`loop:${loop.run}`);
  expect(queue.items[0]).toMatchObject({
    id: "ISS-104:1",
    implementationAttempt: 1,
    implementationAttemptCeiling: 4,
    source: {
      allowedPaths: ["."],
      author: { model: "gpt-5.6-sol", effort: "high" },
      reviewer: { model: "gpt-5.6-sol", effort: "high" },
    },
    delivery: {
      policy: {
        key: "ISS-104",
        number: 361,
        title: "One config",
      },
    },
  });
  expect(queue.stateDirectory).toBe(
    resolve(await realpath(stateRoot), loop.run, "iss-104-attempt-1"),
  );
  expect(queue.items[0]!.setup.stateDirectory).toBe(resolve(queue.stateDirectory, "setup"));
  expect(queue.items[0]!.source.stateDirectory).toBe(resolve(queue.stateDirectory, "source"));
  expect(queue.items[0]!.repair.stateDirectory).toBe(resolve(queue.stateDirectory, "repair"));
  expect(queue.items[0]!.source.author.prompt).toContain("Keep it small.");
  expect(queue.items[0]!.source.author.prompt).toContain("One file drives the run.");
  expect(queue.items[0]!.repair).not.toHaveProperty("sourcePaths");
}, 30_000);

it("keeps the real self adapter's configured author gates mandatory before reporting", async () => {
  const { loop, repository, selected } = await loopFixture();
  const queue = await queueConfigFromLoop(
    { ...loop, repository: "todd-skelton/orchestration-platform" },
    repository,
    selected,
    selfAdapter,
  );
  const source = queue.items[0]!.source;
  expect(source.localGates).toEqual(["typecheck", "format:check", "test"]);
  const prompt = workerPrompt(source, "author", source.base, source.author.prompt);
  expect(prompt).toContain(
    "Before reporting, run `pnpm typecheck`, `pnpm format:check` and `pnpm test` in this worktree, and fix what fails.",
  );
  expect(prompt).not.toContain("are not prerequisites for your source report");
  const { localGates: _gates, ...implicitDefaults } = source;
  expect(prompt).toBe(workerPrompt(implicitDefaults, "author", source.base, source.author.prompt));
});

it("recomposes a polled attempt and resumes its recorded phase", async () => {
  const { loop, repository, selected } = await loopFixture();
  const first = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const history: QueueParticipant[] = [];
  let setupCalls = 0;
  let sourceCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      setupCalls += 1;
      return { status: "ready" };
    },
    async source(item) {
      sourceCalls += 1;
      if (sourceCalls === 1) return { status: "observing-author" };
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId, 1, "codex/iss-104");
    },
  };

  await expect(queueStep(first, adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  const restarted = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  expect(restarted.stateDirectory).toBe(first.stateDirectory);
  await expect(queueStep(restarted, adapter)).resolves.toMatchObject({
    status: "complete",
  });
  expect({ setupCalls, sourceCalls }).toEqual({ setupCalls: 1, sourceCalls: 2 });
}, 30_000);

it("counts dead launches while excluding them from the accepted author-review pair", async () => {
  const current = await fixture();
  current.config.nativeLaunchCeiling = 4;
  const item = current.config.items[0]!;
  const history = [
    { ...participant(1, item.id, "source", "author", "dead"), id: "dead-author" },
    participant(2, item.id, "source", "author", "passed"),
    { ...participant(3, item.id, "source", "reviewer", "dead"), id: "dead-reviewer" },
    participant(4, item.id, "source", "reviewer", "passed"),
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source() {
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: item.source.stateDirectory,
        retries: 1,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(_item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId);
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 4,
  });
});

it("runs the composed self-repository setup through the real Git adapter", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const setup = queue.items[0]!.setup;
  expect(setup.repositoryRoot).toBe(setup.controllerRoot);

  const adapter = gitSetupAdapter({
    gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  await expect(setupStep(setup, adapter, repository)).resolves.toMatchObject({
    status: "ready",
    phase: "complete",
  });
  await expect(
    execute(gitExecutable, ["-C", setup.sourceWorktree, "rev-parse", "HEAD"]),
  ).resolves.toMatchObject({ stdout: `${selected.base}\n` });
}, 30_000);

it("derives and prepares a repository cycle without modifying the controller repository", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  const controller = resolve(repository, "..", "controller");
  await mkdir(controller);
  await execute(gitExecutable, ["init", "-b", "main", controller]);
  await execute(gitExecutable, ["-C", controller, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", controller, "config", "user.email", "fixture@example.test"]);
  await writeFile(resolve(controller, "controller.txt"), "platform controller\n");
  await execute(gitExecutable, ["-C", controller, "add", "."]);
  await execute(gitExecutable, ["-C", controller, "commit", "-m", "controller"]);
  const controllerRevision = (
    await execute(gitExecutable, ["-C", controller, "rev-parse", "HEAD"])
  ).stdout.trim();
  const [canonicalController, canonicalRepository] = await Promise.all([
    realpath(controller),
    realpath(repository),
  ]);

  const validated = await validateLoopExecutor(loop, controller);
  const queue = await queueConfigFromLoop(
    loop,
    controller,
    selected,
    repositoryPolicy,
    [],
    validated,
  );
  const setup = queue.items[0]!.setup;
  expect(queue).toMatchObject({ controllerRoot: canonicalController, controllerRevision });
  expect(setup).toMatchObject({
    controllerRoot: canonicalController,
    repositoryRoot: canonicalRepository,
    controllerRevision,
    pilotRevision: selected.base,
    base: selected.base,
  });

  await setupStep(
    setup,
    gitSetupAdapter({
      gitExecutable,
      async install(_launcher, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
        return "succeeded";
      },
    }),
    controller,
  );
  const repositoryWorktrees = (
    await execute(gitExecutable, ["-C", repository, "worktree", "list", "--porcelain"])
  ).stdout;
  const controllerWorktrees = (
    await execute(gitExecutable, ["-C", controller, "worktree", "list", "--porcelain"])
  ).stdout;
  const comparablePath = (path: string) => {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  const worktreePaths = (output: string) =>
    output
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => comparablePath(line.slice(9)));
  expect(worktreePaths(repositoryWorktrees)).toContain(comparablePath(setup.sourceWorktree));
  expect(worktreePaths(repositoryWorktrees)).toContain(comparablePath(setup.reviewWorktree));
  expect(worktreePaths(controllerWorktrees)).not.toContain(comparablePath(setup.sourceWorktree));
  expect(await execute(gitExecutable, ["-C", controller, "status", "--porcelain"])).toMatchObject({
    stdout: "",
  });
  expect(
    (await execute(gitExecutable, ["-C", controller, "rev-parse", "HEAD"])).stdout.trim(),
  ).toBe(controllerRevision);
  for (const [field, path] of [
    ["stateRoot", resolve(controller, "runtime-state")],
    ["worktreeRoot", resolve(controller, "runtime-worktrees")],
    ["stateRoot", resolve(repository, "runtime-state")],
    ["worktreeRoot", resolve(repository, "runtime-worktrees")],
  ] as const)
    await expect(validateLoopExecutor({ ...loop, [field]: path }, controller)).rejects.toThrow(
      "loop-roots-overlap",
    );
}, 30_000);

it("preserves registered multiline criteria through the genuine repository repair path", async () => {
  const { loop, repository, gitExecutable, acceptanceCriteria, selected } = await loopFixture(true);
  const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const item = queue.items[0]!;
  const fixtureQueue = (await import(
    /* @vite-ignore */ pathToFileURL(resolve(repository, "scripts/dogfood/queue.ts")).href
  )) as { repositoryQueueAdapter: typeof repositoryQueueAdapter };
  let repairPrompt = "";
  let pid = 1;
  const native: Adapter = {
    async preflight() {},
    async git(worktree, args) {
      const result = await execute(gitExecutable, ["-C", worktree, ...args]);
      return args.includes("-z") ? result.stdout : result.stdout.trim();
    },
    async launch(role, config, prompt): Promise<Attempt> {
      const repair = config.stateDirectory === item.repair.stateDirectory;
      if (repair) repairPrompt = prompt;
      else if (role === "author")
        await writeFile(resolve(config.worktree, "repair-target.txt"), "repair me\n");
      return {
        id: `${repair ? "repair" : "source"}-${role}`,
        pid: pid++,
        trace: resolve(queue.stateDirectory, `${repair ? "repair" : "source"}-${role}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, config, attempt) {
      if (config.stateDirectory === item.repair.stateDirectory)
        return { status: "running", id: attempt.id, head: config.base };
      if (role === "author") return { status: "passed", id: attempt.id, head: config.base };
      const head = await native.git(config.reviewWorktree, ["rev-parse", "HEAD"]);
      return {
        status: "failed",
        id: attempt.id,
        head,
        summary: JSON.stringify({
          run: config.run,
          role: "reviewer",
          head,
          verdict: "FAIL",
          findings: [
            {
              file: "repair-target.txt",
              line: 1,
              severity: "blocking",
              text: "Repair the recorded source defect.",
            },
          ],
          g0: "The source line requires this repair.",
        }),
      };
    },
    async checks() {
      return { head: selected.base, checks: [] };
    },
  };
  const adapter = fixtureQueue.repositoryQueueAdapter(queue, repository, {
    gitExecutable,
    native,
    setup: gitSetupAdapter({
      gitExecutable,
      async install(_launcher, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
        return "succeeded";
      },
    }),
  });

  await expect(queueStep(queue, adapter)).resolves.toMatchObject({ status: "observing-author" });
  expect(item.repair.acceptanceCriteria).toEqual([acceptanceCriteria]);
  const encodedCriteria = repairPrompt
    .split("Preserve these acceptance criteria verbatim: ")[1]
    ?.split(". Authorized exact review paths are ")[0];
  expect(encodedCriteria).toBeDefined();
  expect(JSON.parse(encodedCriteria!)).toEqual(item.repair.acceptanceCriteria);
}, 30_000);

it.each(["author", "reviewer"] as const)(
  "resumes a running %s retry through the composed queue without recording a stale dead terminal",
  async (deadRole) => {
    const { loop, repository, gitExecutable, selected } = await loopFixture(true);
    const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
    const item = queue.items[0]!;
    const fixtureQueue = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(repository, "scripts/dogfood/queue.ts")).href
    )) as { repositoryQueueAdapter: typeof repositoryQueueAdapter };
    const launches = { author: 0, reviewer: 0 };
    let retryRunning = true;
    const native: Adapter = {
      async preflight() {},
      async git(worktree, args) {
        const result = await execute(gitExecutable, ["-C", worktree, ...args]);
        return args.includes("-z") ? result.stdout : result.stdout.trim();
      },
      async launch(role, config) {
        launches[role] += 1;
        if (role === "author")
          await writeFile(resolve(config.worktree, "change.txt"), "candidate change\n");
        return {
          id: `${role}-${launches[role]}`,
          pid: launches.author + launches.reviewer,
          trace: resolve(queue.stateDirectory, `${role}-${launches[role]}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        if (role === deadRole && attempt.id === `${role}-1`)
          return { id: attempt.id, status: "dead", summary: "provider disconnected" };
        if (role === deadRole && retryRunning) return { id: attempt.id, status: "running" };
        const head =
          role === "author"
            ? config.base
            : await native.git(config.reviewWorktree, ["rev-parse", "HEAD"]);
        return {
          id: attempt.id,
          status: "passed",
          head,
          ...(role === "reviewer"
            ? {
                summary: JSON.stringify({
                  run: config.run,
                  role,
                  head,
                  verdict: "PASS",
                  findings: [],
                  g0: "The change is already minimal.",
                }),
              }
            : {}),
        };
      },
      async checks() {
        return { head: selected.base, checks: [] };
      },
    };
    const compose = () => ({
      ...fixtureQueue.repositoryQueueAdapter(queue, repository, {
        gitExecutable,
        native,
        setup: gitSetupAdapter({
          gitExecutable,
          async install(_launcher, _args, cwd) {
            await mkdir(resolve(cwd, "node_modules"), { recursive: true });
            await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
            return "succeeded";
          },
        }),
      }),
      async delivery(current: QueueItem, accepted: { head: string; reviewId: string }) {
        return deliveryCompletion(current, accepted.head, accepted.reviewId);
      },
    });
    const adapter = compose();
    await expect(queueStep(queue, adapter)).resolves.toMatchObject({
      status: `observing-${deadRole}`,
    });
    const readState = async (name: string) =>
      JSON.parse(
        await readFile(resolve(item.source.stateDirectory, `${deadRole}-${name}.json`), "utf8"),
      );
    expect(await readState("attempt")).toMatchObject({ id: `${deadRole}-2`, retries: 1 });
    expect(await readState("terminal")).toMatchObject({ id: `${deadRole}-1`, status: "dead" });
    expect((await adapter.history()).map(({ id, outcome }) => ({ id, outcome }))).toEqual([
      ...(deadRole === "reviewer" ? [{ id: "author-1", outcome: "passed" }] : []),
      { id: `${deadRole}-1`, outcome: "dead" },
    ]);

    retryRunning = false;
    const resumed = compose();
    await expect(queueStep(queue, resumed)).resolves.toMatchObject({
      status: "complete",
      participants: 3,
    });
    expect((await resumed.history()).map(({ id, outcome }) => ({ id, outcome }))).toEqual(
      deadRole === "author"
        ? [
            { id: "author-1", outcome: "dead" },
            { id: "author-2", outcome: "passed" },
            { id: "reviewer-1", outcome: "passed" },
          ]
        : [
            { id: "author-1", outcome: "passed" },
            { id: "reviewer-1", outcome: "dead" },
            { id: "reviewer-2", outcome: "passed" },
          ],
    );
    expect(launches).toEqual(
      deadRole === "author" ? { author: 2, reviewer: 1 } : { author: 1, reviewer: 2 },
    );
  },
  30_000,
);

it("keeps the executor pinned while starting a cycle from the selected main commit", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  await execute(gitExecutable, ["-C", repository, "checkout", "-b", "fresh-main"]);
  await writeFile(resolve(repository, "fresh.txt"), "next cycle\n");
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "next cycle"]);
  const fresh = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await execute(gitExecutable, ["-C", repository, "checkout", "main"]);
  const inherited = [participant(1, "ISS-100:1", "source", "author", "passed")];

  const queue = await queueConfigFromLoop(
    loop,
    repository,
    { ...selected, base: fresh },
    repositoryPolicy,
    inherited,
  );
  expect(queue.controllerRevision).toBe(selected.base);
  expect(queue.items[0]).toMatchObject({
    base: fresh,
    setup: { controllerRevision: selected.base, pilotRevision: selected.base, base: fresh },
    source: { pilotRevision: selected.base, base: fresh },
  });
  expect(queue.initialHistory).toEqual(inherited);
  await expect(
    gitSetupAdapter({ gitExecutable }).assertExecutor(queue.items[0]!.setup, repository),
  ).resolves.toBeUndefined();
}, 15_000);

it("counts a genuine repair as the next candidate without a new counter", async () => {
  const current = await fixture();
  current.items[0]!.implementationAttempt = 2;
  await expect(currentCandidateAttempt(current.config)).resolves.toBe(2);
  const item = current.items[0]!;
  await writeFile(
    resolve(current.stateDirectory, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "repair",
      run: current.config.run,
      index: 0,
      item: item.id,
      issue: item.issue,
      base: item.base,
      candidateAttempt: 3,
      head: "b".repeat(40),
      reviewId: "source-reviewer",
      findings: [],
      history: [],
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );
  await expect(currentCandidateAttempt(current.config)).resolves.toBe(3);
});

it.each([false, true])(
  "rebased attempt 3 (changed: %s)",
  async (correctiveChanges) => {
    const { loop, repository, stateRoot, gitExecutable, selected } = await loopFixture();
    await execute(gitExecutable, ["-C", repository, "checkout", "-b", "rejected"]);
    await writeFile(resolve(repository, "rejected.txt"), "candidate two\n");
    await execute(gitExecutable, ["-C", repository, "add", "."]);
    await execute(gitExecutable, ["-C", repository, "commit", "-m", "candidate two"]);
    const rejectedHead = (
      await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
    ).stdout.trim();
    await execute(gitExecutable, ["-C", repository, "checkout", "main"]);
    const remote = resolve(repository, "..", "remote.git");
    const updater = resolve(repository, "..", "updater");
    await execute(gitExecutable, ["clone", "--bare", repository, remote]);
    await execute(gitExecutable, ["-C", repository, "remote", "add", "origin", remote]);
    await execute(gitExecutable, ["clone", remote, updater]);
    await execute(gitExecutable, ["-C", updater, "config", "user.name", "Fixture"]);
    await execute(gitExecutable, ["-C", updater, "config", "user.email", "fixture@example.test"]);
    await writeFile(resolve(updater, "main.txt"), "new main\n");
    await execute(gitExecutable, ["-C", updater, "add", "."]);
    await execute(gitExecutable, ["-C", updater, "commit", "-m", "advance main"]);
    await execute(gitExecutable, ["-C", updater, "push", "origin", "main"]);
    const currentMain = (
      await execute(gitExecutable, ["-C", updater, "rev-parse", "HEAD"])
    ).stdout.trim();
    const main = (
      await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
    ).stdout.trim();
    const prescribed = [
      {
        file: "scripts/dogfood/queue.ts",
        line: 1,
        severity: "blocking" as const,
        text: "Preserve the rejected candidate and apply this exact fix.",
      },
    ];
    const firstHistory = [
      participant(1, "ISS-104:1", "source", "author", "passed"),
      participant(2, "ISS-104:1", "source", "reviewer", "failed"),
      participant(3, "ISS-104:1", "repair", "author", "passed"),
      participant(4, "ISS-104:1", "repair", "reviewer", "failed"),
    ];
    const queueState = resolve(stateRoot, loop.run, "iss-104-attempt-1");
    await mkdir(queueState, { recursive: true });
    await writeFile(
      resolve(queueState, "attempt.json"),
      `${JSON.stringify({
        schemaVersion: "dogfood-bounded-queue-attempt/v1",
        phase: "failed",
        run: loop.run,
        index: 0,
        item: "ISS-104:1",
        issue: "https://github.com/fixture/repository/issues/361",
        base: main,
        candidateAttempt: 2,
        head: rejectedHead,
        reviewId: firstHistory[3]!.id,
        findings: prescribed,
        history: firstHistory,
        retries: 0,
        acceptedStage: null,
        stateDirectory: null,
      })}\n`,
    );
    const third = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
    const rebasedBase = third.items[0]!.base;
    expect(third.items[0]).toMatchObject({
      id: "ISS-104:3",
      base: rebasedBase,
      implementationAttempt: 3,
      source: { base: rebasedBase, mainBase: currentMain, pilotRevision: main },
      setup: { base: rebasedBase },
    });
    expect(rebasedBase).not.toBe(rejectedHead);
    await expect(
      execute(gitExecutable, [
        "-C",
        repository,
        "merge-base",
        "--is-ancestor",
        currentMain,
        rebasedBase,
      ]),
    ).resolves.toMatchObject({ stdout: "" });
    await expect(
      execute(gitExecutable, ["-C", repository, "show", `${rebasedBase}:rejected.txt`]),
    ).resolves.toMatchObject({ stdout: "candidate two\n" });
    await expect(
      readFile(resolve(queueState, "attempt.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({ head: rejectedHead, rebasedBase, rebasedMainBase: currentMain });
    expect(third.initialHistory).toEqual(firstHistory);
    expect(third.stateDirectory).toContain("iss-104-attempt-3");
    expect(third.items[0]!.source.author.prompt).toContain(rejectedHead);
    expect(third.items[0]!.source.author.prompt).toContain(JSON.stringify(prescribed));
    await expect(
      gitSetupAdapter({ gitExecutable }).assertExecutor(third.items[0]!.setup, repository),
    ).resolves.toBeUndefined();
    expect(await queueConfigFromLoop(loop, repository, selected, repositoryPolicy)).toEqual(third);
    const item = third.items[0]!;
    await setupStep(
      item.setup,
      gitSetupAdapter({
        gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      repository,
    );
    const failedRecord = await readFile(resolve(queueState, "attempt.json"), "utf8");
    const launches: string[] = [];
    let passReview = false;
    let reviewedHead = rebasedBase;
    const native: Adapter = {
      async preflight() {},
      async git(tree, args) {
        return (await execute(gitExecutable, ["-C", tree, ...args])).stdout.trim();
      },
      async launch(role, config, prompt) {
        launches.push(role);
        if (role === "author" && correctiveChanges)
          await writeFile(resolve(config.worktree, "correction.txt"), "new corrective work\n");
        if (role === "reviewer") {
          expect(prompt).toContain(`Delivery main base: ${currentMain}`);
          expect(prompt).toContain("Selected author attempt continued-author");
          reviewedHead = (
            await execute(gitExecutable, ["-C", config.worktree, "rev-parse", "HEAD"])
          ).stdout.trim();
        }
        return {
          id: `continued-${role}`,
          pid: launches.length,
          trace: resolve(config.stateDirectory, `${role}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        if (role === "author") return { status: "passed", id: attempt.id, head: config.base };
        return {
          status: passReview ? "passed" : "running",
          id: attempt.id,
          head: reviewedHead,
          summary: JSON.stringify({
            run: config.run,
            role,
            head: reviewedHead,
            verdict: "PASS",
            findings: [],
            g0: "No source churn is needed.",
          }),
        };
      },
      async checks() {
        throw new Error("source must not publish");
      },
    };
    const sourceAdapter = repositoryQueueAdapter(third, repository, { native, gitExecutable });
    await sourceAdapter.assertExecutor();
    await expect(sourceAdapter.source(item)).resolves.toMatchObject({
      status: "observing-reviewer",
    });
    expect(reviewedHead === rebasedBase).toBe(!correctiveChanges);
    expect(
      JSON.parse(await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8")),
    ).toEqual({
      head: reviewedHead,
      changed: correctiveChanges ? ["correction.txt", "rejected.txt"] : ["rejected.txt"],
    });
    passReview = true;
    const resumed = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
    await expect(
      repositoryQueueAdapter(resumed, repository, { native }).source(resumed.items[0]!),
    ).resolves.toMatchObject({
      status: "accepted",
      head: reviewedHead,
      reviewId: "continued-reviewer",
    });
    expect(launches).toEqual(["author", "reviewer"]);
    expect(await currentCandidateAttempt(resumed)).toBe(3);
    expect(
      (await repositoryQueueAdapter(resumed, repository, { native }).history()).map(
        (row) => row.outcome,
      ),
    ).toEqual(["passed", "failed", "passed", "failed", "passed", "passed"]);
    expect(await readFile(resolve(queueState, "attempt.json"), "utf8")).toBe(failedRecord);
  },
  30_000,
);

it("stops with rebase-conflict before launching the next author", async () => {
  const { loop, repository, stateRoot, gitExecutable, selected } = await loopFixture();
  const remote = resolve(repository, "..", "remote.git");
  const updater = resolve(repository, "..", "updater");
  await execute(gitExecutable, ["clone", "--bare", repository, remote]);
  await execute(gitExecutable, ["-C", repository, "remote", "add", "origin", remote]);

  await execute(gitExecutable, ["-C", repository, "checkout", "-b", "rejected"]);
  await writeFile(resolve(repository, "docs/loop.md"), "# The rejected loop\n");
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "rejected change"]);
  const rejectedHead = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await execute(gitExecutable, ["-C", repository, "checkout", "main"]);

  await execute(gitExecutable, ["clone", remote, updater]);
  await execute(gitExecutable, ["-C", updater, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", updater, "config", "user.email", "fixture@example.test"]);
  await writeFile(resolve(updater, "docs/loop.md"), "# The current loop\n");
  await execute(gitExecutable, ["-C", updater, "add", "."]);
  await execute(gitExecutable, ["-C", updater, "commit", "-m", "current main change"]);
  await execute(gitExecutable, ["-C", updater, "push", "origin", "main"]);

  const history = [
    participant(1, "ISS-104:1", "source", "author", "passed"),
    participant(2, "ISS-104:1", "source", "reviewer", "failed"),
  ];
  const queueState = resolve(stateRoot, loop.run, "iss-104-attempt-1");
  await mkdir(queueState, { recursive: true });
  await writeFile(
    resolve(queueState, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "failed",
      run: loop.run,
      index: 0,
      item: "ISS-104:1",
      issue: "https://github.com/fixture/repository/issues/361",
      base: selected.base,
      candidateAttempt: 1,
      head: rejectedHead,
      reviewId: history[1]!.id,
      findings: [{ file: "linux", line: 1, severity: "blocking", text: "fix the hosted failure" }],
      history,
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );

  await expect(queueConfigFromLoop(loop, repository, selected, repositoryPolicy)).rejects.toThrow(
    "rebase-conflict",
  );
  await expect(
    readFile(resolve(queueState, "attempt.json"), "utf8").then(JSON.parse),
  ).resolves.not.toHaveProperty("rebasedBase");
}, 15_000);

it("advances every finite item and completed restart repeats no effects", async () => {
  const current = await fixture(2);
  const first = current.items[0]!;
  const priorHistory = [
    {
      ...participant(1, first.id, "source", "author", "passed"),
      id: "prior-source-author",
    },
    {
      ...participant(2, first.id, "source", "reviewer", "failed"),
      id: "prior-source-reviewer",
      usage: {
        inputTokens: { status: "known" as const, value: 8 },
        outputTokens: { status: "known" as const, value: 3 },
        costUsd: { status: "known" as const, value: 1.25 },
      },
    },
  ];
  first.implementationAttempt = 2;
  first.delivery.refresh = {
    number: 341,
    url: "https://example.test/pull/341",
    head: first.base,
  };
  current.config.initialHistory = priorHistory;
  const history: QueueParticipant[] = structuredClone(priorHistory);
  const calls: string[] = [];
  const deliveryEffects = new Set<string>();
  const adapter: QueueAdapter = {
    async assertExecutor() {
      calls.push("executor");
    },
    async history() {
      return [...history];
    },
    async setup(item) {
      calls.push(`setup:${item.id}`);
      return { status: "ready" };
    },
    async source(item) {
      calls.push(`source:${item.id}`);
      history.push(
        participant(history.length + 1, item.id, "source", "author", "passed"),
        participant(history.length + 2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: item.id === "synthetic-1" ? "e".repeat(40) : "c".repeat(40),
        reviewId: `${item.id}-source-reviewer`,
        stateDirectory: resolve(current.root, `${item.id}-source`),
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      calls.push(`delivery:${item.id}`);
      deliveryEffects.add(item.id);
      return deliveryCompletion(
        item,
        accepted.head,
        accepted.reviewId,
        item.delivery.refresh?.number ?? Number(item.id.at(-1)),
      );
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toEqual({
    status: "complete",
    run: current.config.run,
    cursor: 2,
    items: 2,
    participants: 6,
  });
  expect(calls).toEqual([
    "executor",
    "setup:synthetic-1",
    "source:synthetic-1",
    "delivery:synthetic-1",
    "setup:synthetic-2",
    "source:synthetic-2",
    "delivery:synthetic-2",
  ]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  const firstComplete = await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8");

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 6,
  });
  expect(calls.slice(7)).toEqual(["executor"]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  expect(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")).toBe(
    firstComplete,
  );
  expect(JSON.parse(firstComplete).history.slice(0, 2)).toEqual(priorHistory);
});

it.each([
  [
    "an unsupported top-level field",
    (result: Record<string, any>) => (result.syntheticExtra = true),
  ],
  [
    "an unsupported publication field",
    (result: Record<string, any>) => (result.publication.syntheticExtra = true),
  ],
  [
    "an unsupported cleanup field",
    (result: Record<string, any>) => (result.cleanup.syntheticExtra = true),
  ],
  ["malformed cleanup", (result: Record<string, any>) => (result.cleanup.branch = "")],
])("rejects a delivery completion result with %s before completion", async (_name, mutate) => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let deliveryCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      deliveryCalls += 1;
      const result = deliveryCompletion(item, accepted.head, accepted.reviewId) as Record<
        string,
        any
      >;
      mutate(result);
      return result as Extract<QueueDeliveryResult, { status: "complete" }>;
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow("malformed-delivery-completion");
  expect(deliveryCalls).toBe(1);
  await expect(
    readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
  ).resolves.toContain('"phase": "delivery"');
});

it("hands a genuine failed source review to repair without losing participants or usage", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  const calls: string[] = [];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings: [
          {
            file: "scripts/dogfood/queue.ts",
            line: 1,
            severity: "blocking",
            text: "repair this",
          },
        ],
      };
    },
    async repair(item) {
      calls.push("repair");
      expect(
        JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
      ).toMatchObject({
        phase: "repair",
        history: [
          {
            ordinal: 1,
            outcome: "passed",
            usage: {
              inputTokens: { status: "known", value: 1 },
              costUsd: { status: "unavailable" },
            },
          },
          { ordinal: 2, outcome: "failed" },
        ],
      });
      history.push(
        participant(3, item.id, "repair", "author", "passed"),
        participant(4, item.id, "repair", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: item.repair.stateDirectory,
      };
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId, 1, "codex/repair");
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 4,
  });
  expect(calls).toEqual(["repair"]);
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "complete",
    head: "c".repeat(40),
    history: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }, { ordinal: 4 }],
  });
});

it.each([
  [1, 1],
  [4, 4],
])(
  "stops candidate %i at ceiling %i without launching another author",
  async (attempt, ceiling) => {
    const current = await fixture();
    const item = current.items[0]!;
    item.implementationAttempt = attempt;
    item.implementationAttemptCeiling = ceiling;
    const history: QueueParticipant[] = [];
    let sourceCalls = 0;
    let repairCalls = 0;
    const findings = [
      {
        file: "scripts/dogfood/queue.ts",
        line: 1,
        severity: "blocking" as const,
        text: "source remains blocked",
      },
    ];
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return [...history];
      },
      async setup() {
        return { status: "ready" };
      },
      async source(selected) {
        sourceCalls += 1;
        history.push(
          participant(1, selected.id, "source", "author", "passed"),
          participant(2, selected.id, "source", "reviewer", "failed"),
        );
        return {
          status: "fixable-review",
          head: "b".repeat(40),
          reviewId: history[1]!.id,
          findings,
        };
      },
      async repair() {
        repairCalls += 1;
        throw new Error("repair must not run");
      },
      async delivery() {
        throw new Error("delivery must not run");
      },
    };

    await expect(queueStep(current.config, adapter)).rejects.toThrow(
      "implementation-attempt-ceiling-exhausted",
    );
    expect({ sourceCalls, repairCalls }).toEqual({ sourceCalls: 1, repairCalls: 0 });
    expect(
      JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
    ).toMatchObject({ candidateAttempt: attempt, head: "b".repeat(40), findings });
    await expect(queueStep(current.config, adapter)).rejects.toThrow(
      "implementation-attempt-ceiling-exhausted",
    );
    expect({ sourceCalls, repairCalls }).toEqual({ sourceCalls: 1, repairCalls: 0 });
  },
);

it("counts a failed genuine repair as candidate two and stops at ceiling two", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttemptCeiling = 2;
  const history: QueueParticipant[] = [];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "repair remains blocked",
    },
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(selected) {
      history.push(
        participant(1, selected.id, "source", "author", "passed"),
        participant(2, selected.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings,
      };
    },
    async repair(selected) {
      history.push(
        participant(3, selected.id, "repair", "author", "passed"),
        participant(4, selected.id, "repair", "reviewer", "failed"),
      );
      return {
        status: "failed",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        findings,
      };
    },
    async delivery() {
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow(
    "implementation-attempt-ceiling-exhausted",
  );
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ candidateAttempt: 2, head: "c".repeat(40), findings });
});

it("keeps a gate correction on repaired candidate two and stops at that ceiling", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttemptCeiling = 2;
  const history: QueueParticipant[] = [];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "gate correction remains blocked",
    },
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(selected) {
      history.push(
        participant(1, selected.id, "source", "author", "passed"),
        participant(2, selected.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings,
      };
    },
    async repair(selected) {
      history.push(
        participant(3, selected.id, "repair", "author", "passed"),
        participant(4, selected.id, "repair", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: selected.repair.stateDirectory,
      };
    },
    async delivery(selected) {
      history.push(
        { ...participant(5, selected.id, "repair", "author", "passed"), id: "gate-author" },
        { ...participant(6, selected.id, "repair", "reviewer", "failed"), id: "gate-reviewer" },
      );
      return {
        status: "failed",
        head: "e".repeat(40),
        reviewId: "gate-reviewer",
        findings,
      };
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow(
    "implementation-attempt-ceiling-exhausted",
  );
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ candidateAttempt: 2, head: "e".repeat(40), reviewId: "gate-reviewer" });
});

it("restarts a persisted candidate-two failure by advancing to candidate three", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  const history = [
    participant(1, item.id, "source", "author", "passed"),
    participant(2, item.id, "source", "reviewer", "failed"),
    participant(3, item.id, "repair", "author", "passed"),
    participant(4, item.id, "repair", "reviewer", "failed"),
  ];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "apply this on candidate three",
    },
  ];
  await writeFile(
    resolve(current.stateDirectory, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "failed",
      run: current.config.run,
      index: 0,
      item: item.id,
      issue: item.issue,
      base: item.base,
      candidateAttempt: 2,
      head: "c".repeat(40),
      reviewId: history[3]!.id,
      findings,
      history,
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      throw new Error("setup must not repeat");
    },
    async source() {
      throw new Error("source must not repeat");
    },
    async repair() {
      throw new Error("repair must not repeat");
    },
    async delivery() {
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "advancing-attempt",
    cursor: 2,
  });
});

it("retains an interrupted wait target and refuses a moved delivery identity", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let sourceCalls = 0;
  let setupCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      setupCalls += 1;
      return { status: "ready" };
    },
    async source(item) {
      sourceCalls += 1;
      if (sourceCalls === 1) return { status: "observing-author" };
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("unexpected repair");
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, "c".repeat(40), accepted.reviewId, 1, "codex/moved");
    },
  };
  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "observing-author",
    cursor: 0,
  });
  expect(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")).toContain(
    '"phase": "source"',
  );
  await expect(queueStep(current.config, adapter)).rejects.toThrow("delivery-identity-drift");
  expect(setupCalls).toBe(1);
  await expect(
    readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
  ).resolves.toContain('"phase": "delivery"');
});

it("binds an accepted review identity to the exact stage history before delivery", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let deliveryCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: "forged-review",
        stateDirectory: resolve(current.root, "source"),
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery() {
      deliveryCalls += 1;
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow("item-review-history-mismatch");
  expect(deliveryCalls).toBe(0);
  await expect(
    readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
  ).resolves.toContain('"phase": "source"');
});

it.each([
  [
    "malformed controller",
    (config: QueueConfig) => {
      config.controller = "   ";
    },
    "malformed-queue-config",
  ],
  [
    "drifted item base",
    (config: QueueConfig) => {
      config.items[0]!.base = "e".repeat(40);
    },
    "queue-base-drift",
  ],
  [
    "exhausted finite input",
    (config: QueueConfig) => {
      config.limit = 0;
    },
    "invalid-queue-limit",
  ],
  [
    "wrong controller revision",
    (config: QueueConfig) => {
      config.controllerRevision = "f".repeat(40);
    },
    "queue-executor-drift",
  ],
  [
    "drifted item run binding",
    (config: QueueConfig) => {
      config.items[0]!.source.run = "synthetic-substituted-run";
    },
    "queue-run-drift",
  ],
  [
    "drifted item issue binding",
    (config: QueueConfig) => {
      config.items[0]!.source.issue = "synthetic-substituted-issue";
    },
    "queue-issue-drift",
  ],
  [
    "drifted hosted-check binding",
    (config: QueueConfig) => {
      config.items[0]!.source.requiredChecks = ["linux", "windows", "synthetic-other-check"];
    },
    "queue-hosted-check-drift",
  ],
])("fails closed for %s", async (_name, mutate, reason) => {
  const current = await fixture();
  mutate(current.config);
  let adapterEntries = 0;
  const adapter = {
    assertExecutor: async () => {
      adapterEntries += 1;
    },
    history: async () => [],
    setup: async () => ({ status: "ready" as const }),
    source: async () => ({ status: "observing-author" as const }),
    repair: async () => ({ status: "observing-author" as const }),
    delivery: async () => ({
      status: "observing-hosted-checks" as const,
      head: "b".repeat(40),
      reviewId: "review",
    }),
  };
  await expect(queueStep(current.config, adapter)).rejects.toThrow(reason);
  expect(adapterEntries).toBe(0);
});

it("stores an inline gate retry count in the single attempt record", async () => {
  const current = await fixture();
  const item = current.config.items[0]!;
  const acceptedHead = "b".repeat(40);
  const history = [
    participant(1, item.id, "source", "author", "passed"),
    participant(2, item.id, "source", "reviewer", "passed"),
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source() {
      return {
        status: "accepted",
        head: acceptedHead,
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery() {
      history.push(participant(3, item.id, "source", "author", "passed"));
      return { ...deliveryCompletion(item, "c".repeat(40), history[1]!.id), retries: 1 };
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({ status: "complete" });
  expect(
    JSON.parse(await readFile(resolve(current.config.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ phase: "complete", retries: 1 });
});

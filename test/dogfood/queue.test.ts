import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  currentCandidateAttempt,
  queueConfigFromLoop,
  repositoryQueueAdapter,
  queueStep,
  validateQueueConfig,
  type QueueAdapter,
  type QueueConfig,
  type QueueDeliveryResult,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import type { Adapter, Attempt } from "../../scripts/dogfood/flow.js";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import { setupStep } from "../../scripts/dogfood/setup.js";

const roots: string[] = [];
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
  outcome: "passed" | "failed",
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
        exitReceiptWindowMs: 30_000,
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
    repository: "fixture/repository",
    stableExecutorRoot: repository,
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "gpt-5.6-sol", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable,
    exitReceiptWindowMs: 30_000,
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
  await expect(queueConfigFromLoop({ ...loop, run: ".." }, repository, selected)).rejects.toThrow(
    "invalid-run",
  );
  const queue = await queueConfigFromLoop(loop, repository, selected);

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
        planningKey: "ISS-104",
        planningIssue: 361,
        pullRequestTitle: "[ISS-104] One config",
      },
    },
  });
  expect(queue.stateDirectory).toBe(resolve(stateRoot, loop.run, "iss-104-attempt-1"));
  expect(queue.items[0]!.setup.stateDirectory).toBe(resolve(queue.stateDirectory, "setup"));
  expect(queue.items[0]!.source.stateDirectory).toBe(resolve(queue.stateDirectory, "source"));
  expect(queue.items[0]!.repair.stateDirectory).toBe(resolve(queue.stateDirectory, "repair"));
  expect(queue.items[0]!.source.author.prompt).toContain("Keep it small.");
  expect(queue.items[0]!.source.author.prompt).toContain("One file drives the run.");
  expect(queue.items[0]!.repair).not.toHaveProperty("sourcePaths");
}, 30_000);

it("recomposes a polled attempt and resumes its recorded phase", async () => {
  const { loop, repository, selected } = await loopFixture();
  const first = await queueConfigFromLoop(loop, repository, selected);
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
  const restarted = await queueConfigFromLoop(loop, repository, selected);
  expect(restarted.stateDirectory).toBe(first.stateDirectory);
  await expect(queueStep(restarted, adapter)).resolves.toMatchObject({
    status: "complete",
  });
  expect({ setupCalls, sourceCalls }).toEqual({ setupCalls: 1, sourceCalls: 2 });
}, 30_000);

it("runs the composed self-repository setup through the real Git adapter", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  const queue = await queueConfigFromLoop(loop, repository, selected);
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

it("preserves registered multiline criteria through the genuine repository repair path", async () => {
  const { loop, repository, gitExecutable, acceptanceCriteria, selected } = await loopFixture(true);
  const queue = await queueConfigFromLoop(loop, repository, selected);
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

it("starts candidate three at the rejected candidate two with its prescription verbatim", async () => {
  const { loop, repository, stateRoot, gitExecutable, selected } = await loopFixture();
  await execute(gitExecutable, ["-C", repository, "checkout", "-b", "rejected"]);
  await writeFile(resolve(repository, "rejected.txt"), "candidate two\n");
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "candidate two"]);
  const rejectedHead = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await execute(gitExecutable, ["-C", repository, "checkout", "main"]);
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
  const third = await queueConfigFromLoop(loop, repository, selected);
  expect(third.items[0]).toMatchObject({
    id: "ISS-104:3",
    base: rejectedHead,
    implementationAttempt: 3,
    source: { base: rejectedHead },
    setup: { base: rejectedHead },
  });
  expect(third.initialHistory).toEqual(firstHistory);
  expect(third.stateDirectory).toContain("iss-104-attempt-3");
  expect(third.items[0]!.source.author.prompt).toContain(JSON.stringify(prescribed));
  await expect(
    gitSetupAdapter({ gitExecutable }).assertExecutor(third.items[0]!.setup, repository),
  ).resolves.toBeUndefined();
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
      return history;
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
    "candidate-as-executor-selection",
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

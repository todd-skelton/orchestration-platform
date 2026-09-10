import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  itemAuthority,
  participantIdentity,
  queueConfigFromLoop,
  queueDigest,
  reconcileCompletedQueue,
  queueStep,
  validateQueueConfig,
  type QueueAdapter,
  type QueueConfig,
  type QueueDeliveryResult,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";

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
    return {
      id,
      issue: `fixture-${index + 1}`,
      base,
      implementationAttempt: index + 1,
      implementationAttemptCeiling: 4,
      setup: { run, issue: `fixture-${index + 1}`, base },
      source: {
        run,
        issue: `fixture-${index + 1}`,
        base,
        stateDirectory: resolve(root, `${id}-source`),
        allowedPaths: ["scripts/dogfood/queue.ts"],
        requiredChecks,
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
    run: "synthetic-bounded-queue",
    controllerRoot: resolve(root, "controller"),
    controllerRevision: "a".repeat(40),
    stateDirectory,
    limit: itemCount,
    nativeLaunchCeiling: 8,
    initialHistory: [],
    items,
    authority: undefined as never,
  };
  config.authority = {
    schemaVersion: "dogfood-bounded-queue-authority/v1",
    controller: "synthetic-controller",
    run: config.run,
    controllerRoot: config.controllerRoot,
    controllerRevision: config.controllerRevision,
    stateDirectory,
    limit: config.limit,
    nativeLaunchCeiling: config.nativeLaunchCeiling,
    lineageDigest: queueDigest(config.initialHistory.map(participantIdentity)),
    itemsDigest: queueDigest(items.map(itemAuthority)),
    actions: ["setup", "source", "repair", "delivery"],
  };
  return { root, stateDirectory, config, items };
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
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");

  item.implementationAttempt = 2;
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  expect(() => validateQueueConfig(current.config)).not.toThrow();

  item.delivery.refresh.head = "f".repeat(40);
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");
});

it("admits repository-wide source scope without a pre-authored repair path list", async () => {
  const current = await fixture();
  current.items[0]!.source.allowedPaths = ["."];
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  expect(() => validateQueueConfig(current.config)).not.toThrow();
});

it("derives the complete internal queue from one compact loop config", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "loop-config-fixture-"));
  roots.push(root);
  const repository = resolve(root, "repository");
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([
    mkdir(resolve(repository, "docs"), { recursive: true }),
    mkdir(resolve(repository, "planning/drafts"), { recursive: true }),
  ]);
  await Promise.all([
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
      '---\nkey: ISS-104\ntitle: "One config"\n---\n\n## Done when\n\n- One file drives the run.\n\n## Out of scope\n',
    ),
  ]);
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const gitExecutable = (await execute(finder, ["git"])).stdout.trim().split(/\r?\n/)[0]!;
  await execute(gitExecutable, ["init", "-b", "main", repository]);
  await execute(gitExecutable, ["-C", repository, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", repository, "config", "user.email", "fixture@example.test"]);
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "fixture"]);

  const queue = await queueConfigFromLoop(
    {
      schemaVersion: "dogfood-loop/v1",
      run: "iss-104-run",
      issue: { key: "ISS-104", number: 361 },
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
    },
    repository,
  );

  expect(queue.items).toHaveLength(1);
  expect(queue.authority.itemsDigest).toBe(queueDigest(queue.items.map(itemAuthority)));
  expect(queue.authority.lineageDigest).toBe(
    queueDigest(queue.initialHistory.map(participantIdentity)),
  );
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
  expect(queue.items[0]!.source.author.prompt).toContain("Keep it small.");
  expect(queue.items[0]!.source.author.prompt).toContain("One file drives the run.");
  expect(queue.items[0]!.repair).not.toHaveProperty("sourcePaths");
});

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
  current.config.authority.lineageDigest = queueDigest(priorHistory.map(participantIdentity));
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  const history: QueueParticipant[] = structuredClone(priorHistory);
  const calls: string[] = [];
  const deliveryEffects = new Set<string>();
  const adapter: QueueAdapter = {
    async assertAuthority() {
      calls.push("authority");
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
    "authority",
    "setup:synthetic-1",
    "source:synthetic-1",
    "delivery:synthetic-1",
    "setup:synthetic-2",
    "source:synthetic-2",
    "delivery:synthetic-2",
  ]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  const firstComplete = await readFile(
    resolve(current.stateDirectory, "item-1-complete.json"),
    "utf8",
  );

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 6,
  });
  expect(calls.slice(7)).toEqual(["authority"]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  expect(await readFile(resolve(current.stateDirectory, "item-1-complete.json"), "utf8")).toBe(
    firstComplete,
  );
  expect(JSON.parse(firstComplete).history.slice(0, 2)).toEqual(priorHistory);
});

it.each([
  ["wrong delivery run", (receipt: Record<string, any>) => (receipt.run = "synthetic-wrong-run")],
  ["wrong completed head", (receipt: Record<string, any>) => (receipt.head = "f".repeat(40))],
  [
    "wrong hosted check identity",
    (receipt: Record<string, any>) => (receipt.checks[0].name = "synthetic-unrelated-check"),
  ],
  ["unsupported extra field", (receipt: Record<string, any>) => (receipt.extra = true)],
  ["missing run", (receipt: Record<string, any>) => delete receipt.run],
  ["missing checks", (receipt: Record<string, any>) => delete receipt.checks],
  ["missing required check", (receipt: Record<string, any>) => receipt.checks.pop()],
  ["substituted publication", (receipt: Record<string, any>) => (receipt.publication.number = 351)],
  [
    "changed reviewer",
    (receipt: Record<string, any>) => (receipt.reviewId = "synthetic-other-reviewer"),
  ],
  [
    "changed participant history",
    (receipt: Record<string, any>) => (receipt.history[1].id = "synthetic-other-reviewer"),
  ],
  ["malformed checks collection", (receipt: Record<string, any>) => (receipt.checks = {})],
  [
    "incompatible completion state",
    (receipt: Record<string, any>) => (receipt.status = "observing-hosted-checks"),
  ],
])("read-only reconciliation rejects historical completion with %s", async (_name, mutate) => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttempt = 2;
  item.delivery.refresh = {
    number: 350,
    url: "https://example.test/pull/350",
    head: item.base,
  };
  current.config.authority.itemsDigest = queueDigest(current.items.map(itemAuthority));
  const history: QueueParticipant[] = [];
  const effects: string[] = [];
  const adapter: QueueAdapter = {
    async assertAuthority() {
      effects.push("authority");
    },
    async history() {
      return [...history];
    },
    async setup() {
      effects.push("setup");
      return { status: "ready" };
    },
    async source(selected) {
      effects.push("source");
      history.push(
        participant(1, selected.id, "source", "author", "passed"),
        participant(2, selected.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: selected.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(selected, accepted) {
      effects.push("delivery");
      return deliveryCompletion(selected, accepted.head, accepted.reviewId, 350);
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({ status: "complete" });
  const immutablePaths = [
    "item-1-accepted.json",
    "item-1-complete.json",
    "queue-complete.json",
  ].map((name) => resolve(current.stateDirectory, name));
  const originalBytes = await Promise.all(immutablePaths.map((path) => readFile(path, "utf8")));
  const beforeReadOnly = effects.length;
  await expect(
    reconcileCompletedQueue(current.config, { history: adapter.history }),
  ).resolves.toMatchObject({ status: "complete", participants: 2 });
  expect(effects).toHaveLength(beforeReadOnly);
  expect(await Promise.all(immutablePaths.map((path) => readFile(path, "utf8")))).toEqual(
    originalBytes,
  );

  const completion = JSON.parse(originalBytes[1]!) as Record<string, any>;
  mutate(completion);
  await writeFile(immutablePaths[1]!, `${JSON.stringify(completion, null, 2)}\n`);
  await expect(
    reconcileCompletedQueue(current.config, { history: adapter.history }),
  ).rejects.toBeInstanceOf(Error);
  expect(effects).toHaveLength(beforeReadOnly);
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
    async assertAuthority() {},
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
    readFile(resolve(current.stateDirectory, "item-1-complete.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(resolve(current.stateDirectory, "queue-complete.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("hands a genuine failed source review to repair without losing participants or usage", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  const calls: string[] = [];
  const adapter: QueueAdapter = {
    async assertAuthority() {},
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
      return { status: "fixable-review", head: "b".repeat(40), reviewId: history[1]!.id };
    },
    async repair(item) {
      calls.push("repair");
      expect(
        JSON.parse(
          await readFile(resolve(current.stateDirectory, "item-1-source-failure.json"), "utf8"),
        ),
      ).toMatchObject({
        status: "fixable-review",
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
    JSON.parse(await readFile(resolve(current.stateDirectory, "item-1-complete.json"), "utf8")),
  ).toMatchObject({
    stage: "delivery",
    head: "c".repeat(40),
    history: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }, { ordinal: 4 }],
  });
});

it("retains an interrupted wait target and refuses a moved delivery identity", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let sourceCalls = 0;
  let setupCalls = 0;
  const adapter: QueueAdapter = {
    async assertAuthority() {},
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
  expect(
    await readFile(resolve(current.stateDirectory, "item-1-source-intent.json"), "utf8"),
  ).toContain(current.items[0]!.id);
  await expect(queueStep(current.config, adapter)).rejects.toThrow("delivery-identity-drift");
  expect(setupCalls).toBe(1);
  await expect(
    readFile(resolve(current.stateDirectory, "item-1-complete.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("binds an accepted review identity to the exact stage history before delivery", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let deliveryCalls = 0;
  const adapter: QueueAdapter = {
    async assertAuthority() {},
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
    readFile(resolve(current.stateDirectory, "item-1-delivery-intent.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses an orphan queue completion before item component effects", async () => {
  const current = await fixture();
  await writeFile(
    resolve(current.stateDirectory, "queue-complete.json"),
    `${JSON.stringify({
      status: "complete",
      run: current.config.run,
      cursor: 1,
      items: 1,
      participants: 0,
    })}\n`,
  );
  const componentCalls: string[] = [];
  const adapter: QueueAdapter = {
    async assertAuthority() {},
    async history() {
      return [];
    },
    async setup() {
      componentCalls.push("setup");
      return { status: "ready" };
    },
    async source() {
      componentCalls.push("source");
      return { status: "observing-author" };
    },
    async repair() {
      componentCalls.push("repair");
      return { status: "observing-author" };
    },
    async delivery() {
      componentCalls.push("delivery");
      return {
        status: "observing-hosted-checks",
        head: "b".repeat(40),
        reviewId: "review",
      };
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow("malformed-queue-complete");
  expect(componentCalls).toEqual([]);
});

it("refuses conflicting completion metrics before repeating a completed item", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  const history = [
    participant(1, item.id, "source", "author", "passed"),
    participant(2, item.id, "source", "reviewer", "passed"),
  ];
  const common = {
    schemaVersion: "dogfood-bounded-queue-stage/v1",
    item: item.id,
    issue: item.issue,
    base: item.base,
    history,
  };
  await Promise.all([
    writeFile(
      resolve(current.stateDirectory, "item-1-accepted.json"),
      `${JSON.stringify({
        ...common,
        stage: "source",
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      })}\n`,
    ),
    writeFile(
      resolve(current.stateDirectory, "item-1-complete.json"),
      `${JSON.stringify({
        ...common,
        stage: "delivery",
        status: "complete",
        run: item.source.run,
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        publication: { number: 1, url: "https://example.test/1" },
        checks: item.delivery.requiredChecks.map((name) => ({
          name,
          bucket: "pass",
          link: `https://example.test/check/${name}`,
        })),
        mergeCommit: "c".repeat(40),
        cleanup: { status: "confirmed", branch: "codex/synthetic-1" },
      })}\n`,
    ),
    writeFile(
      resolve(current.stateDirectory, "queue-complete.json"),
      `${JSON.stringify({
        status: "complete",
        run: current.config.run,
        cursor: 1,
        items: 1,
        participants: 3,
      })}\n`,
    ),
  ]);
  const componentCalls: string[] = [];
  const adapter: QueueAdapter = {
    async assertAuthority() {},
    async history() {
      return history;
    },
    async setup() {
      componentCalls.push("setup");
      return { status: "ready" };
    },
    async source() {
      componentCalls.push("source");
      return { status: "observing-author" };
    },
    async repair() {
      componentCalls.push("repair");
      return { status: "observing-author" };
    },
    async delivery() {
      componentCalls.push("delivery");
      return {
        status: "observing-hosted-checks",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
      };
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow("malformed-queue-complete");
  expect(componentCalls).toEqual([]);
});

it.each([
  [
    "drifted item authority",
    (config: QueueConfig) => {
      config.items[0]!.base = "e".repeat(40);
    },
    "unauthorized-queue",
  ],
  [
    "substituted issue",
    (config: QueueConfig) => {
      const item = config.items[0]!;
      item.issue = "fixture-substitution";
      item.source.issue = item.issue;
      item.setup.issue = item.issue;
    },
    "unauthorized-queue",
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
    "unauthorized-queue",
  ],
  [
    "drifted item run binding",
    (config: QueueConfig) => {
      config.items[0]!.source.run = "synthetic-substituted-run";
      config.authority.itemsDigest = queueDigest(config.items.map(itemAuthority));
    },
    "queue-run-drift",
  ],
  [
    "drifted item issue binding",
    (config: QueueConfig) => {
      config.items[0]!.source.issue = "synthetic-substituted-issue";
      config.authority.itemsDigest = queueDigest(config.items.map(itemAuthority));
    },
    "queue-issue-drift",
  ],
  [
    "drifted hosted-check binding",
    (config: QueueConfig) => {
      config.items[0]!.source.requiredChecks = ["linux", "windows", "synthetic-other-check"];
      config.authority.itemsDigest = queueDigest(config.items.map(itemAuthority));
    },
    "queue-hosted-check-drift",
  ],
])("fails closed for %s", async (_name, mutate, reason) => {
  const current = await fixture();
  mutate(current.config);
  let adapterEntries = 0;
  const adapter = {
    assertAuthority: async () => {
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

it("does not advance through a forged completion receipt", async () => {
  const current = await fixture();
  await writeFile(
    resolve(current.stateDirectory, "item-1-complete.json"),
    JSON.stringify({
      item: current.items[0]!.id,
      issue: current.items[0]!.issue,
      base: current.items[0]!.base,
      stage: "delivery",
      status: "complete",
      head: "not-a-head",
      reviewId: "review",
      history: [],
    }),
  );
  const adapter = {
    assertAuthority: async () => {},
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
  await expect(queueStep(current.config, adapter)).rejects.toThrow("malformed-completed-item");
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  itemAuthority,
  participantIdentity,
  queueDigest,
  queueStep,
  type QueueAdapter,
  type QueueConfig,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";

const roots: string[] = [];
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

async function fixture(itemCount = 1) {
  const root = await mkdtemp(resolve(tmpdir(), "bounded-queue-fixture-"));
  roots.push(root);
  const stateDirectory = resolve(root, "queue");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(stateDirectory));
  const items = Array.from({ length: itemCount }, (_, index) => {
    const id = `synthetic-${index + 1}`;
    const base = String(index + 1).repeat(40);
    return {
      id,
      issue: `fixture-${index + 1}`,
      base,
      implementationAttempt: index + 1,
      setup: { issue: `fixture-${index + 1}`, base },
      source: { issue: `fixture-${index + 1}`, base },
      repair: {
        stateDirectory: resolve(root, `${id}-repair`),
        sourcePaths: ["scripts/dogfood/queue.ts"],
        acceptanceCriteria: ["one preserved criterion"],
        author: { model: "author-model", effort: "high", promptFile: resolve(root, "author.md") },
        reviewer: {
          model: "reviewer-model",
          effort: "high",
          promptFile: resolve(root, "reviewer.md"),
        },
      },
      delivery: { requiredChecks: ["linux", "windows", "macos"], policy: { kind: "fixture" } },
    } as unknown as QueueItem;
  });
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-request/v1",
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

it("advances every finite item and completed restart repeats no effects", async () => {
  const current = await fixture(2);
  const history: QueueParticipant[] = [];
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
        head: item.id === "synthetic-1" ? "b".repeat(40) : "c".repeat(40),
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
      return {
        status: "complete",
        head: accepted.head,
        reviewId: accepted.reviewId,
        publication: {
          number: Number(item.id.at(-1)),
          url: `https://example.test/${item.id}`,
        },
        mergeCommit: "d".repeat(40),
        cleanup: { status: "confirmed", branch: `codex/${item.id}` },
      };
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toEqual({
    status: "complete",
    run: current.config.run,
    cursor: 2,
    items: 2,
    participants: 4,
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
    participants: 4,
  });
  expect(calls.slice(7)).toEqual(["authority", "delivery:synthetic-1", "delivery:synthetic-2"]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  expect(await readFile(resolve(current.stateDirectory, "item-1-complete.json"), "utf8")).toBe(
    firstComplete,
  );
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
    async delivery(_item, accepted) {
      return {
        status: "complete",
        head: accepted.head,
        reviewId: accepted.reviewId,
        publication: { number: 1, url: "https://example.test/1" },
        mergeCommit: "d".repeat(40),
        cleanup: { status: "confirmed", branch: "codex/repair" },
      };
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
        stateDirectory: resolve(current.root, "source"),
      };
    },
    async repair() {
      throw new Error("unexpected repair");
    },
    async delivery(_item, accepted) {
      return {
        status: "complete",
        head: "c".repeat(40),
        reviewId: accepted.reviewId,
        publication: { number: 1, url: "https://example.test/1" },
        mergeCommit: "d".repeat(40),
        cleanup: { status: "confirmed", branch: "codex/moved" },
      };
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
      config.items[0]!.issue = "fixture-substitution";
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
])("fails closed for %s", async (_name, mutate, reason) => {
  const current = await fixture();
  mutate(current.config);
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
  await expect(queueStep(current.config, adapter)).rejects.toThrow(reason);
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

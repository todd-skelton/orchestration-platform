import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { DeliveryConfig } from "./delivery.mjs";
import type { Config as SourceConfig } from "./flow.js";
import type { RepairActor } from "./repair-policy.mjs";
import type { SetupConfig } from "./setup.mjs";

export const QUEUE_AUTHORITY_SCHEMA = "dogfood-bounded-queue-authority/v1" as const;
export const QUEUE_REQUEST_SCHEMA = "dogfood-bounded-queue-request/v1" as const;
const ACTIONS = ["setup", "source", "repair", "delivery"] as const;
const SHA = /^[a-f0-9]{40}$/;
const ABSENT = Symbol("absent");

export type QueueMeasure = { status: "known"; value: number } | { status: "unavailable" };
export type QueueUsage = {
  inputTokens: QueueMeasure;
  outputTokens: QueueMeasure;
  costUsd: QueueMeasure;
};

export interface QueueParticipant {
  ordinal: number;
  id: string;
  item: string;
  stage: "source" | "repair";
  role: "author" | "reviewer";
  outcome: "passed" | "failed" | "unknown";
  usage: QueueUsage;
}

export interface QueueItem {
  id: string;
  issue: string;
  base: string;
  implementationAttempt: number;
  setup: SetupConfig;
  source: SourceConfig;
  repair: {
    stateDirectory: string;
    sourcePaths: string[];
    acceptanceCriteria: string[];
    author: RepairActor;
    reviewer: RepairActor;
  };
  delivery: { requiredChecks: string[]; policy: DeliveryConfig["policy"] };
}

export interface QueueAuthority {
  schemaVersion: typeof QUEUE_AUTHORITY_SCHEMA;
  controller: string;
  run: string;
  controllerRoot: string;
  controllerRevision: string;
  stateDirectory: string;
  limit: number;
  nativeLaunchCeiling: number;
  lineageDigest: string;
  itemsDigest: string;
  actions: (typeof ACTIONS)[number][];
}

export interface QueueConfig {
  schemaVersion: typeof QUEUE_REQUEST_SCHEMA;
  run: string;
  controllerRoot: string;
  controllerRevision: string;
  stateDirectory: string;
  limit: number;
  nativeLaunchCeiling: number;
  initialHistory: QueueParticipant[];
  items: QueueItem[];
  authority: QueueAuthority;
}

export type QueueSourceResult =
  | { status: "observing-author" | "observing-reviewer" }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string }
  | { status: "fixable-review"; head: string; reviewId: string };
export type QueueRepairResult =
  | { status: "observing-author" | "observing-reviewer" }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string };
export type QueueDeliveryResult =
  | { status: "observing-hosted-checks"; head: string; reviewId: string }
  | {
      status: "complete";
      head: string;
      reviewId: string;
      publication: { number: number; url: string };
      mergeCommit: string;
      cleanup: { status: "confirmed"; branch: string };
    };

export interface QueueAdapter {
  assertAuthority(config: QueueConfig): Promise<void>;
  history(): Promise<QueueParticipant[]>;
  setup(item: QueueItem): Promise<{ status: "ready" | "incomplete"; reason?: string }>;
  source(item: QueueItem): Promise<QueueSourceResult>;
  repair(item: QueueItem): Promise<QueueRepairResult>;
  delivery(
    item: QueueItem,
    accepted: { head: string; reviewId: string; stateDirectory: string },
  ): Promise<QueueDeliveryResult>;
}

export type QueueResult =
  | {
      status: "observing-author" | "observing-reviewer" | "observing-hosted-checks";
      run: string;
      item: string;
      issue: string;
      cursor: number;
    }
  | { status: "complete"; run: string; cursor: number; items: number; participants: number };

export class QueueBlocked extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new QueueBlocked(reason);
}
const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export const queueDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function participantIdentity(participant: QueueParticipant) {
  return {
    ordinal: participant.ordinal,
    id: participant.id,
    item: participant.item,
    stage: participant.stage,
    role: participant.role,
    outcome: participant.outcome,
  };
}
export function itemAuthority(item: QueueItem) {
  return {
    id: item.id,
    issue: item.issue,
    base: item.base,
    implementationAttempt: item.implementationAttempt,
    setup: item.setup,
    source: item.source,
    repair: item.repair,
    delivery: item.delivery,
  };
}

function validMeasure(candidate: unknown, integer: boolean) {
  return (
    (exactKeys(candidate, ["status"]) && candidate.status === "unavailable") ||
    (exactKeys(candidate, ["status", "value"]) &&
      candidate.status === "known" &&
      typeof candidate.value === "number" &&
      Number.isFinite(candidate.value) &&
      candidate.value >= 0 &&
      (!integer || Number.isSafeInteger(candidate.value)))
  );
}
function validUsage(value: unknown): value is QueueUsage {
  return (
    exactKeys(value, ["inputTokens", "outputTokens", "costUsd"]) &&
    validMeasure(value.inputTokens, true) &&
    validMeasure(value.outputTokens, true) &&
    validMeasure(value.costUsd, false)
  );
}
export function validateHistory(history: QueueParticipant[], ceiling: number) {
  demand(Array.isArray(history) && history.length <= ceiling, "native-launch-ceiling-exhausted");
  const identities = new Set<string>();
  for (const [index, participant] of history.entries()) {
    demand(
      exactKeys(participant, ["ordinal", "id", "item", "stage", "role", "outcome", "usage"]) &&
        participant.ordinal === index + 1 &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(participant.id) &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(participant.item) &&
        ["source", "repair"].includes(participant.stage) &&
        ["author", "reviewer"].includes(participant.role) &&
        ["passed", "failed", "unknown"].includes(participant.outcome),
      "malformed-participant-history",
    );
    demand(!identities.has(participant.id), "reused-participant-identity");
    identities.add(participant.id);
  }
}

export function validateQueueConfig(config: QueueConfig) {
  demand(
    exactKeys(config, [
      "schemaVersion",
      "run",
      "controllerRoot",
      "controllerRevision",
      "stateDirectory",
      "limit",
      "nativeLaunchCeiling",
      "initialHistory",
      "items",
      "authority",
    ]) && config.schemaVersion === QUEUE_REQUEST_SCHEMA,
    "malformed-queue-config",
  );
  demand(/^[\w.-]{1,80}$/.test(config.run), "invalid-run");
  demand(
    isAbsolute(config.controllerRoot) && isAbsolute(config.stateDirectory),
    "invalid-queue-path",
  );
  demand(SHA.test(config.controllerRevision), "invalid-controller-revision");
  demand(
    Number.isSafeInteger(config.limit) && config.limit > 0 && config.limit <= 32,
    "invalid-queue-limit",
  );
  demand(
    Number.isSafeInteger(config.nativeLaunchCeiling) &&
      config.nativeLaunchCeiling > 0 &&
      config.nativeLaunchCeiling <= 64,
    "invalid-native-launch-ceiling",
  );
  validateHistory(config.initialHistory, config.nativeLaunchCeiling);
  demand(
    Array.isArray(config.items) && config.items.length > 0 && config.items.length <= config.limit,
    "closed-finite-input-required",
  );
  const itemIds = new Set<string>();
  for (const item of config.items) {
    demand(
      exactKeys(item, [
        "id",
        "issue",
        "base",
        "implementationAttempt",
        "setup",
        "source",
        "repair",
        "delivery",
      ]) &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(item.id) &&
        typeof item.issue === "string" &&
        item.issue.length > 0 &&
        SHA.test(item.base) &&
        Number.isSafeInteger(item.implementationAttempt) &&
        item.implementationAttempt > 0 &&
        item.implementationAttempt <= 4 &&
        exactKeys(item.repair, [
          "stateDirectory",
          "sourcePaths",
          "acceptanceCriteria",
          "author",
          "reviewer",
        ]) &&
        isAbsolute(item.repair.stateDirectory) &&
        Array.isArray(item.repair.sourcePaths) &&
        item.repair.sourcePaths.length > 0 &&
        Array.isArray(item.repair.acceptanceCriteria) &&
        item.repair.acceptanceCriteria.length > 0 &&
        exactKeys(item.delivery, ["requiredChecks", "policy"]) &&
        Array.isArray(item.delivery.requiredChecks) &&
        item.delivery.requiredChecks.length >= 3,
      "malformed-queue-item",
    );
    demand(!itemIds.has(item.id), "duplicate-queue-item");
    itemIds.add(item.id);
  }
  const authority = config.authority;
  demand(
    exactKeys(authority, [
      "schemaVersion",
      "controller",
      "run",
      "controllerRoot",
      "controllerRevision",
      "stateDirectory",
      "limit",
      "nativeLaunchCeiling",
      "lineageDigest",
      "itemsDigest",
      "actions",
    ]) &&
      authority.schemaVersion === QUEUE_AUTHORITY_SCHEMA &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(authority.controller) &&
      authority.run === config.run &&
      authority.controllerRoot === config.controllerRoot &&
      authority.controllerRevision === config.controllerRevision &&
      authority.stateDirectory === config.stateDirectory &&
      authority.limit === config.limit &&
      authority.nativeLaunchCeiling === config.nativeLaunchCeiling &&
      authority.lineageDigest === queueDigest(config.initialHistory.map(participantIdentity)) &&
      authority.itemsDigest === queueDigest(config.items.map(itemAuthority)) &&
      Array.isArray(authority.actions) &&
      authority.actions.length === ACTIONS.length &&
      ACTIONS.every((action, index) => authority.actions[index] === action),
    "unauthorized-queue",
  );
}

export async function assertQueueRequest(config: QueueConfig, requestPath: string) {
  validateQueueConfig(config);
  demand(isAbsolute(requestPath), "request-path-not-absolute");
  const [request, directory] = await Promise.all([
    realpath(requestPath),
    realpath(config.stateDirectory),
  ]);
  demand(
    dirname(request) === directory && basename(request) === "queue-request.json",
    "request-outside-queue-state",
  );
}

async function optionalRecord(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new QueueBlocked(`malformed-queue-record:${name}`);
  }
}
async function record(directory: string, name: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(resolve(directory, `${name}.json`), bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    demand(
      (await readFile(resolve(directory, `${name}.json`), "utf8")) === bytes,
      `conflicting-queue-record:${name}`,
    );
  }
}

async function assertQueueStateCensus(config: QueueConfig, directory: string) {
  const allowed = new Set([
    "queue-request.json",
    "queue-config.json",
    "queue-adapter-authority.json",
    "queue-complete.json",
  ]);
  for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1)
    for (const suffix of ["intent", "attempt", "terminal"])
      allowed.add(`participant-${ordinal}-${suffix}.json`);
  for (const index of config.items.keys())
    for (const suffix of [
      "cursor",
      "setup-intent",
      "setup",
      "source-intent",
      "source-failure",
      "repair-intent",
      "accepted",
      "delivery-intent",
      "complete",
    ])
      allowed.add(`item-${index + 1}-${suffix}.json`);
  const entries = await readdir(directory, { withFileTypes: true });
  demand(
    entries.every((entry) => entry.isFile() && allowed.has(entry.name)),
    "unexpected-queue-state",
  );
}
function stageRecord(item: QueueItem, stage: string, history: QueueParticipant[], value: object) {
  const unavailable: QueueMeasure = { status: "unavailable" };
  return {
    schemaVersion: "dogfood-bounded-queue-stage/v1",
    item: item.id,
    issue: item.issue,
    base: item.base,
    stage,
    history: history.map((participant) => ({
      ...participantIdentity(participant),
      usage: validUsage(participant.usage)
        ? participant.usage
        : { inputTokens: unavailable, outputTokens: unavailable, costUsd: unavailable },
    })),
    ...value,
  };
}
function assertHistoryPrefix(config: QueueConfig, history: QueueParticipant[]) {
  validateHistory(history, config.nativeLaunchCeiling);
  demand(history.length >= config.initialHistory.length, "participant-history-truncated");
  demand(
    config.initialHistory.every(
      (participant, index) =>
        JSON.stringify(participantIdentity(participant)) ===
        JSON.stringify(participantIdentity(history[index]!)),
    ),
    "participant-history-drift",
  );
}

function assertHistorySnapshot(
  config: QueueConfig,
  snapshot: QueueParticipant[],
  current: QueueParticipant[],
) {
  assertHistoryPrefix(config, snapshot);
  assertHistoryPrefix(config, current);
  demand(snapshot.length <= current.length, "participant-history-truncated");
  demand(
    snapshot.every(
      (participant, index) =>
        JSON.stringify(participantIdentity(participant)) ===
        JSON.stringify(participantIdentity(current[index]!)),
    ),
    "participant-history-drift",
  );
}

function assertItemReviewHistory(history: QueueParticipant[], item: QueueItem, repaired: boolean) {
  const source = history.filter(
    (participant) => participant.item === item.id && participant.stage === "source",
  );
  const repair = history.filter(
    (participant) => participant.item === item.id && participant.stage === "repair",
  );
  demand(
    source.length === 2 &&
      source[0]!.role === "author" &&
      source[0]!.outcome === "passed" &&
      source[1]!.role === "reviewer" &&
      source[1]!.outcome === (repaired ? "failed" : "passed") &&
      (repaired
        ? repair.length === 2 &&
          repair[0]!.role === "author" &&
          repair[0]!.outcome === "passed" &&
          repair[1]!.role === "reviewer" &&
          repair[1]!.outcome === "passed"
        : repair.length === 0),
    "item-review-history-mismatch",
  );
}

function assertSourceFailureHistory(history: QueueParticipant[], item: QueueItem) {
  const source = history.filter(
    (participant) => participant.item === item.id && participant.stage === "source",
  );
  const repair = history.filter(
    (participant) => participant.item === item.id && participant.stage === "repair",
  );
  demand(
    source.length === 2 &&
      source[0]!.role === "author" &&
      source[0]!.outcome === "passed" &&
      source[1]!.role === "reviewer" &&
      source[1]!.outcome === "failed" &&
      repair.length === 0,
    "malformed-source-failure-stage",
  );
}

export async function queueStep(config: QueueConfig, adapter: QueueAdapter): Promise<QueueResult> {
  validateQueueConfig(config);
  const directory = await realpath(config.stateDirectory);
  await adapter.assertAuthority(config);
  await assertQueueStateCensus(config, directory);
  const fingerprint = queueDigest({
    ...config,
    initialHistory: config.initialHistory.map(participantIdentity),
  });
  await record(directory, "queue-config", { fingerprint, authority: config.authority });

  let incompleteSeen = false;
  for (const index of config.items.keys()) {
    const complete = await optionalRecord(directory, `item-${index + 1}-complete`);
    if (complete === ABSENT) incompleteSeen = true;
    else demand(!incompleteSeen, "queue-cursor-gap");
  }

  for (const [index, item] of config.items.entries()) {
    const prefix = `item-${index + 1}`;
    const completed = await optionalRecord(directory, `${prefix}-complete`);
    if (completed !== ABSENT) {
      demand(
        completed.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
          completed.item === item.id &&
          completed.issue === item.issue &&
          completed.base === item.base &&
          completed.stage === "delivery" &&
          completed.status === "complete" &&
          SHA.test(completed.head) &&
          typeof completed.reviewId === "string" &&
          Array.isArray(completed.history),
        "malformed-completed-item",
      );
      assertItemReviewHistory(
        completed.history,
        item,
        completed.history.some(
          (participant: QueueParticipant) =>
            participant.item === item.id && participant.stage === "repair",
        ),
      );
      assertHistorySnapshot(config, completed.history, await adapter.history());
      const accepted = await optionalRecord(directory, `${prefix}-accepted`);
      demand(
        accepted !== ABSENT &&
          accepted.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
          accepted.item === item.id &&
          accepted.issue === item.issue &&
          accepted.base === item.base &&
          accepted.status === "accepted" &&
          SHA.test(accepted.head) &&
          typeof accepted.reviewId === "string" &&
          ((accepted.stage === "source" &&
            accepted.stateDirectory === item.source.stateDirectory) ||
            (accepted.stage === "repair" &&
              accepted.stateDirectory === item.repair.stateDirectory)),
        "malformed-completed-item",
      );
      const observed = await adapter.delivery(item, {
        head: accepted.head,
        reviewId: accepted.reviewId,
        stateDirectory: accepted.stateDirectory,
      });
      demand(
        observed.status === "complete" &&
          observed.head === completed.head &&
          observed.reviewId === completed.reviewId &&
          JSON.stringify(observed.publication) === JSON.stringify(completed.publication) &&
          observed.mergeCommit === completed.mergeCommit &&
          JSON.stringify(observed.cleanup) === JSON.stringify(completed.cleanup),
        "completed-delivery-drift",
      );
      continue;
    }
    await record(directory, `${prefix}-cursor`, {
      schemaVersion: "dogfood-bounded-queue-cursor/v1",
      index,
      item: item.id,
      issue: item.issue,
      base: item.base,
      itemDigest: queueDigest(itemAuthority(item)),
    });

    const setupReceipt = await optionalRecord(directory, `${prefix}-setup`);
    if (setupReceipt === ABSENT) {
      await record(directory, `${prefix}-setup-intent`, { item: item.id, base: item.base });
      const setup = await adapter.setup(item);
      demand(setup.status === "ready", setup.reason ?? "setup-incomplete");
      const history = await adapter.history();
      assertHistoryPrefix(config, history);
      await record(directory, `${prefix}-setup`, stageRecord(item, "setup", history, setup));
    } else {
      demand(
        setupReceipt.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
          setupReceipt.item === item.id &&
          setupReceipt.issue === item.issue &&
          setupReceipt.base === item.base &&
          setupReceipt.stage === "setup" &&
          setupReceipt.status === "ready" &&
          Array.isArray(setupReceipt.history),
        "malformed-setup-stage",
      );
      if ((await optionalRecord(directory, `${prefix}-source-intent`)) === ABSENT) {
        const setup = await adapter.setup(item);
        demand(setup.status === "ready", setup.reason ?? "setup-incomplete");
      }
      assertHistorySnapshot(config, setupReceipt.history, await adapter.history());
    }

    let accepted = await optionalRecord(directory, `${prefix}-accepted`);
    if (accepted === ABSENT) {
      const sourceFailure = await optionalRecord(directory, `${prefix}-source-failure`);
      if (sourceFailure === ABSENT) {
        await record(directory, `${prefix}-source-intent`, { item: item.id, base: item.base });
        const source = await adapter.source(item);
        const history = await adapter.history();
        assertHistoryPrefix(config, history);
        if (source.status === "observing-author" || source.status === "observing-reviewer")
          return {
            status: source.status,
            run: config.run,
            item: item.id,
            issue: item.issue,
            cursor: index,
          };
        if (source.status === "fixable-review")
          await record(
            directory,
            `${prefix}-source-failure`,
            stageRecord(item, "source", history, source),
          );
        else {
          accepted = stageRecord(item, "source", history, source);
          await record(directory, `${prefix}-accepted`, accepted);
        }
      } else
        demand(
          sourceFailure.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
            sourceFailure.item === item.id &&
            sourceFailure.issue === item.issue &&
            sourceFailure.base === item.base &&
            sourceFailure.stage === "source" &&
            sourceFailure.status === "fixable-review" &&
            SHA.test(sourceFailure.head) &&
            typeof sourceFailure.reviewId === "string" &&
            Array.isArray(sourceFailure.history),
          "malformed-source-failure-stage",
        );
      if (sourceFailure !== ABSENT) {
        assertSourceFailureHistory(sourceFailure.history, item);
      }
      if (accepted === ABSENT) {
        await record(directory, `${prefix}-repair-intent`, { item: item.id, base: item.base });
        const repair = await adapter.repair(item);
        const history = await adapter.history();
        assertHistoryPrefix(config, history);
        if (repair.status === "observing-author" || repair.status === "observing-reviewer")
          return {
            status: repair.status,
            run: config.run,
            item: item.id,
            issue: item.issue,
            cursor: index,
          };
        accepted = stageRecord(item, "repair", history, repair);
        await record(directory, `${prefix}-accepted`, accepted);
      }
    }

    demand(
      object(accepted) &&
        accepted.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
        accepted.item === item.id &&
        accepted.issue === item.issue &&
        accepted.base === item.base &&
        ["source", "repair"].includes(accepted.stage) &&
        accepted.status === "accepted" &&
        SHA.test(accepted.head) &&
        typeof accepted.reviewId === "string" &&
        ((accepted.stage === "source" && accepted.stateDirectory === item.source.stateDirectory) ||
          (accepted.stage === "repair" &&
            accepted.stateDirectory === item.repair.stateDirectory)) &&
        Array.isArray(accepted.history),
      "malformed-accepted-stage",
    );
    assertHistoryPrefix(config, accepted.history);
    assertItemReviewHistory(accepted.history, item, accepted.stage === "repair");
    await record(directory, `${prefix}-delivery-intent`, {
      item: item.id,
      head: accepted.head,
      reviewId: accepted.reviewId,
      stateDirectory: accepted.stateDirectory,
    });
    const delivery = await adapter.delivery(item, {
      head: accepted.head,
      reviewId: accepted.reviewId,
      stateDirectory: accepted.stateDirectory,
    });
    const history = await adapter.history();
    assertHistoryPrefix(config, history);
    demand(
      delivery.head === accepted.head && delivery.reviewId === accepted.reviewId,
      "delivery-identity-drift",
    );
    if (delivery.status === "observing-hosted-checks")
      return {
        status: delivery.status,
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: index,
      };
    await record(directory, `${prefix}-complete`, stageRecord(item, "delivery", history, delivery));
  }

  const history = await adapter.history();
  assertHistoryPrefix(config, history);
  const complete = {
    status: "complete" as const,
    run: config.run,
    cursor: config.items.length,
    items: config.items.length,
    participants: history.length,
  };
  await record(directory, "queue-complete", complete);
  return complete;
}

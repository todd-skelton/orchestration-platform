import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assertControllerExecutor, githubDeliveryAdapter } from "./delivery-adapter.mjs";
import {
  DeliveryBlocked,
  deliveryStep,
  type CheckEvidence,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DeliveryResult,
  type DeliveryPolicyAdapter,
  type PublicationRefresh,
} from "./delivery.mjs";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { codexAdapter } from "./dispatch-adapter.ts";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { step } from "./flow.ts";
import type { Adapter, Attempt, Config as SourceConfig, Role } from "./flow.js";
import {
  ReviewRecoveryBlocked,
  reviewedReviewRecoveryAdapter,
  selectedSourceReview,
  type ReviewRecoveryAdapter,
} from "./review-recovery-adapter.mjs";
import {
  reviewedRepairAdapter,
  sourceReviewerReportPrompt,
  validDogfoodReviewPath,
} from "./repair-adapter.mjs";
import { repairStep, type RepairAdapter } from "./repair.mjs";
import {
  RepairBlocked,
  classifyReview,
  parseReview,
  repairDigest,
  repairPolicy,
  type ParticipantHistory,
  type RepairActor,
  type RepairConfig,
  type RepairPolicy,
  validRepairReviewPath,
} from "./repair-policy.mjs";
import { selfDeliveryPolicy } from "./self-delivery-policy.mjs";
import { gitSetupAdapter } from "./setup-adapter.mjs";
import { SetupBlocked, setupStep, type SetupAdapter, type SetupConfig } from "./setup.mjs";

export const QUEUE_AUTHORITY_SCHEMA = "dogfood-bounded-queue-authority/v1" as const;
export const QUEUE_REQUEST_SCHEMA = "dogfood-bounded-queue-request/v1" as const;
const ACTIONS = ["setup", "source", "repair", "delivery"] as const;
const SHA = /^[a-f0-9]{40}$/;
const ABSENT = Symbol("absent");
const exec = promisify(execFile);

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
  outcome: "passed" | "failed" | "unknown" | "malformed";
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
  delivery: {
    requiredChecks: string[];
    policy: DeliveryConfig["policy"];
    refresh?: PublicationRefresh;
  };
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
  | Extract<DeliveryResult, { status: "complete" }>;

export interface CompletedQueueReader {
  history(): Promise<QueueParticipant[]>;
}

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

function validRepositoryRepairTemplate(item: QueueItem) {
  const allowedPaths: unknown = item.source.allowedPaths;
  return (
    Array.isArray(allowedPaths) &&
    item.repair.sourcePaths.length <= 32 &&
    item.repair.sourcePaths.every(
      (path) =>
        validRepairReviewPath(path) && allowedPaths.includes(path) && validDogfoodReviewPath(path),
    ) &&
    new Set(item.repair.sourcePaths).size === item.repair.sourcePaths.length
  );
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
        ["passed", "failed", "unknown", "malformed"].includes(participant.outcome) &&
        validUsage(participant.usage),
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
        exactKeys(item.delivery, [
          "requiredChecks",
          "policy",
          ...(object(item.delivery) && Object.hasOwn(item.delivery, "refresh") ? ["refresh"] : []),
        ]) &&
        Array.isArray(item.delivery.requiredChecks) &&
        item.delivery.requiredChecks.length >= 3 &&
        item.delivery.requiredChecks.every((name) => typeof name === "string" && name.length > 0) &&
        new Set(item.delivery.requiredChecks).size === item.delivery.requiredChecks.length,
      "malformed-queue-item",
    );
    demand(
      object(item.setup) &&
        object(item.source) &&
        typeof item.source.run === "string" &&
        /^[\w.-]{1,64}$/.test(item.source.run) &&
        item.setup.run === item.source.run,
      "queue-run-drift",
    );
    demand(
      item.issue === item.source.issue && item.issue === item.setup.issue,
      "queue-issue-drift",
    );
    demand(validRepositoryRepairTemplate(item), "incompatible-repair-template");
    demand(
      Array.isArray(item.source.requiredChecks) &&
        item.source.requiredChecks.length === item.delivery.requiredChecks.length &&
        item.source.requiredChecks.every(
          (name, index) => name === item.delivery.requiredChecks[index],
        ),
      "queue-hosted-check-drift",
    );
    if (Object.hasOwn(item.delivery, "refresh"))
      demand(
        exactKeys(item.delivery.refresh, ["number", "url", "head"]) &&
          Number.isSafeInteger(item.delivery.refresh.number) &&
          item.delivery.refresh.number > 0 &&
          typeof item.delivery.refresh.url === "string" &&
          item.delivery.refresh.url.startsWith("https://") &&
          SHA.test(item.delivery.refresh.head) &&
          item.delivery.refresh.head === item.base &&
          item.implementationAttempt > 1,
        "malformed-publication-refresh",
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

function validCompletedChecks(item: QueueItem, checks: unknown): checks is CheckEvidence[] {
  return (
    Array.isArray(checks) &&
    checks.length === item.delivery.requiredChecks.length &&
    checks.every(
      (check, index) =>
        exactKeys(check, ["name", "bucket", "link"]) &&
        check.name === item.delivery.requiredChecks[index] &&
        check.bucket === "pass" &&
        typeof check.link === "string" &&
        check.link.startsWith("https://"),
    )
  );
}

function validCompletedDeliveryFields(item: QueueItem, delivery: Record<string, any>) {
  return (
    delivery.status === "complete" &&
    delivery.run === item.source.run &&
    delivery.issue === item.issue &&
    typeof delivery.head === "string" &&
    SHA.test(delivery.head) &&
    typeof delivery.reviewId === "string" &&
    exactKeys(delivery.publication, ["number", "url"]) &&
    Number.isSafeInteger(delivery.publication.number) &&
    delivery.publication.number > 0 &&
    typeof delivery.publication.url === "string" &&
    delivery.publication.url.startsWith("https://") &&
    (!item.delivery.refresh ||
      (delivery.publication.number === item.delivery.refresh.number &&
        delivery.publication.url === item.delivery.refresh.url)) &&
    validCompletedChecks(item, delivery.checks) &&
    typeof delivery.mergeCommit === "string" &&
    SHA.test(delivery.mergeCommit) &&
    exactKeys(delivery.cleanup, ["status", "branch"]) &&
    delivery.cleanup.status === "confirmed" &&
    typeof delivery.cleanup.branch === "string" &&
    delivery.cleanup.branch.length > 0
  );
}

function validCompletedDeliveryResult(
  item: QueueItem,
  delivery: unknown,
): delivery is Extract<QueueDeliveryResult, { status: "complete" }> {
  return (
    exactKeys(delivery, [
      "status",
      "run",
      "issue",
      "head",
      "reviewId",
      "publication",
      "checks",
      "mergeCommit",
      "cleanup",
    ]) && validCompletedDeliveryFields(item, delivery)
  );
}

function completedStageRecord(
  item: QueueItem,
  history: QueueParticipant[],
  delivery: Extract<QueueDeliveryResult, { status: "complete" }>,
) {
  return stageRecord(item, "delivery", history, {
    status: delivery.status,
    run: delivery.run,
    head: delivery.head,
    reviewId: delivery.reviewId,
    publication: delivery.publication,
    checks: delivery.checks,
    mergeCommit: delivery.mergeCommit,
    cleanup: delivery.cleanup,
  });
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

function assertItemReviewHistory(
  history: QueueParticipant[],
  item: QueueItem,
  repaired: boolean,
  reviewId: string,
  priorParticipants: number,
) {
  const source = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "source",
  );
  const repair = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "repair",
  );
  const selectedSource = source.at(-1);
  const validSource =
    [2, 3].includes(source.length) &&
    source[0]!.role === "author" &&
    source[0]!.outcome === "passed" &&
    source.slice(1).every((participant) => participant.role === "reviewer") &&
    (source.length === 2 || source[1]!.outcome === "malformed") &&
    selectedSource!.outcome === (repaired ? "failed" : "passed") &&
    selectedSource!.id === (repaired ? source.at(-1)!.id : reviewId);
  demand(
    validSource &&
      (repaired
        ? repair.length === 2 &&
          repair[0]!.role === "author" &&
          repair[0]!.outcome === "passed" &&
          repair[1]!.role === "reviewer" &&
          repair[1]!.outcome === "passed" &&
          repair[1]!.id === reviewId
        : repair.length === 0),
    "item-review-history-mismatch",
  );
}

function assertSourceFailureHistory(
  history: QueueParticipant[],
  item: QueueItem,
  reviewId: string,
  priorParticipants: number,
) {
  const source = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "source",
  );
  const repair = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "repair",
  );
  demand(
    [2, 3].includes(source.length) &&
      source[0]!.role === "author" &&
      source[0]!.outcome === "passed" &&
      source.slice(1).every((participant) => participant.role === "reviewer") &&
      (source.length === 2 || source[1]!.outcome === "malformed") &&
      source.at(-1)!.outcome === "failed" &&
      source.at(-1)!.id === reviewId &&
      repair.length === 0,
    "malformed-source-failure-stage",
  );
}

async function completedItemReceipt(
  config: QueueConfig,
  directory: string,
  prefix: string,
  item: QueueItem,
  currentHistory: QueueParticipant[],
) {
  const completed = await optionalRecord(directory, `${prefix}-complete`);
  if (completed === ABSENT) return ABSENT;
  demand(
    exactKeys(completed, [
      "schemaVersion",
      "item",
      "issue",
      "base",
      "stage",
      "history",
      "status",
      "run",
      "head",
      "reviewId",
      "publication",
      "checks",
      "mergeCommit",
      "cleanup",
    ]) &&
      completed.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
      completed.item === item.id &&
      completed.issue === item.issue &&
      completed.base === item.base &&
      completed.stage === "delivery" &&
      validCompletedDeliveryFields(item, completed) &&
      Array.isArray(completed.history),
    "malformed-completed-item",
  );
  assertItemReviewHistory(
    completed.history,
    item,
    completed.history.some(
      (participant: QueueParticipant) =>
        participant.ordinal > config.initialHistory.length &&
        participant.item === item.id &&
        participant.stage === "repair",
    ),
    completed.reviewId,
    config.initialHistory.length,
  );
  assertHistorySnapshot(config, completed.history, currentHistory);
  const accepted = await optionalRecord(directory, `${prefix}-accepted`);
  demand(
    accepted !== ABSENT &&
      exactKeys(accepted, [
        "schemaVersion",
        "item",
        "issue",
        "base",
        "stage",
        "history",
        "status",
        "head",
        "reviewId",
        "stateDirectory",
      ]) &&
      accepted.schemaVersion === "dogfood-bounded-queue-stage/v1" &&
      accepted.item === item.id &&
      accepted.issue === item.issue &&
      accepted.base === item.base &&
      accepted.status === "accepted" &&
      accepted.head === completed.head &&
      accepted.reviewId === completed.reviewId &&
      ((accepted.stage === "source" && accepted.stateDirectory === item.source.stateDirectory) ||
        (accepted.stage === "repair" && accepted.stateDirectory === item.repair.stateDirectory)) &&
      Array.isArray(accepted.history),
    "malformed-completed-item",
  );
  assertItemReviewHistory(
    accepted.history,
    item,
    accepted.stage === "repair",
    accepted.reviewId,
    config.initialHistory.length,
  );
  assertHistorySnapshot(config, accepted.history, currentHistory);
  demand(
    accepted.history.length === completed.history.length &&
      accepted.history.every(
        (participant: QueueParticipant, index: number) =>
          JSON.stringify(participantIdentity(participant)) ===
          JSON.stringify(participantIdentity(completed.history[index])),
      ),
    "completed-item-history-drift",
  );
  return completed;
}

function queueFingerprint(config: QueueConfig) {
  return queueDigest({
    ...config,
    initialHistory: config.initialHistory.map(participantIdentity),
  });
}

async function assertQueueConfigRecord(config: QueueConfig, directory: string) {
  const pinned = await optionalRecord(directory, "queue-config");
  demand(
    pinned !== ABSENT &&
      exactKeys(pinned, ["fingerprint", "authority"]) &&
      pinned.fingerprint === queueFingerprint(config) &&
      JSON.stringify(pinned.authority) === JSON.stringify(config.authority),
    "malformed-queue-config-record",
  );
}

async function completedQueueState(
  config: QueueConfig,
  directory: string,
  currentHistory: QueueParticipant[],
) {
  const queueComplete = await optionalRecord(directory, "queue-complete");
  const completedItems: (typeof ABSENT | Record<string, any>)[] = [];
  let incompleteSeen = false;
  for (const [index, item] of config.items.entries()) {
    const complete = await completedItemReceipt(
      config,
      directory,
      `item-${index + 1}`,
      item,
      currentHistory,
    );
    completedItems.push(complete);
    if (complete === ABSENT) incompleteSeen = true;
    else demand(!incompleteSeen, "queue-cursor-gap");
  }
  if (queueComplete !== ABSENT)
    demand(
      exactKeys(queueComplete, ["status", "run", "cursor", "items", "participants"]) &&
        queueComplete.status === "complete" &&
        queueComplete.run === config.run &&
        queueComplete.cursor === config.items.length &&
        queueComplete.items === config.items.length &&
        queueComplete.participants === currentHistory.length &&
        !incompleteSeen,
      "malformed-queue-complete",
    );
  return { queueComplete, completedItems };
}

// External promotion may authorize this closed, read-only view of an older
// executor's terminal state. It validates the original authority and receipts
// but deliberately has no adapter authority or component-effect capability.
export async function reconcileCompletedQueue(
  config: QueueConfig,
  reader: CompletedQueueReader,
): Promise<Extract<QueueResult, { status: "complete" }>> {
  validateQueueConfig(config);
  const directory = await realpath(config.stateDirectory);
  await assertQueueStateCensus(config, directory);
  await assertQueueConfigRecord(config, directory);
  const currentHistory = await reader.history();
  assertHistoryPrefix(config, currentHistory);
  const { queueComplete } = await completedQueueState(config, directory, currentHistory);
  demand(queueComplete !== ABSENT, "incomplete-queue-reconciliation");
  return queueComplete as Extract<QueueResult, { status: "complete" }>;
}

export async function queueStep(config: QueueConfig, adapter: QueueAdapter): Promise<QueueResult> {
  validateQueueConfig(config);
  const directory = await realpath(config.stateDirectory);
  await adapter.assertAuthority(config);
  await assertQueueStateCensus(config, directory);
  const fingerprint = queueFingerprint(config);
  await record(directory, "queue-config", { fingerprint, authority: config.authority });

  const currentHistory = await adapter.history();
  assertHistoryPrefix(config, currentHistory);
  const { queueComplete, completedItems } = await completedQueueState(
    config,
    directory,
    currentHistory,
  );
  if (queueComplete !== ABSENT) {
    return queueComplete as QueueResult;
  }

  for (const [index, item] of config.items.entries()) {
    const prefix = `item-${index + 1}`;
    const completed = completedItems[index]!;
    if (completed !== ABSENT) {
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
        demand("reviewId" in source, "unexpected-source-flow-status");
        if (source.status === "fixable-review") {
          assertSourceFailureHistory(history, item, source.reviewId, config.initialHistory.length);
          await record(
            directory,
            `${prefix}-source-failure`,
            stageRecord(item, "source", history, source),
          );
        } else {
          assertItemReviewHistory(
            history,
            item,
            false,
            source.reviewId,
            config.initialHistory.length,
          );
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
        assertSourceFailureHistory(
          sourceFailure.history,
          item,
          sourceFailure.reviewId,
          config.initialHistory.length,
        );
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
        demand("reviewId" in repair, "unexpected-repair-status");
        assertItemReviewHistory(history, item, true, repair.reviewId, config.initialHistory.length);
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
    assertItemReviewHistory(
      accepted.history,
      item,
      accepted.stage === "repair",
      accepted.reviewId,
      config.initialHistory.length,
    );
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
    demand(validCompletedDeliveryResult(item, delivery), "malformed-delivery-completion");
    await record(directory, `${prefix}-complete`, completedStageRecord(item, history, delivery));
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
// The repository adapter is co-located with the queue engine module so an
// entry-to-component trace crosses only the command, this module and the
// accepted component. The queue engine above remains policy-independent: its
// only effect surface is QueueAdapter.
function samePath(left: string, right: string) {
  return relative(left, right) === "";
}

function outside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function canonicalSelectedPath(path: string) {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(await realpath(dirname(path)), basename(path));
  }
}

async function json(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch {
    throw new QueueBlocked(`malformed-component-record:${name}`);
  }
}

async function adapterOptional(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new QueueBlocked(`malformed-queue-record:${name}`);
  }
}

async function adapterRecord(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(path, bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    demand((await readFile(path, "utf8")) === bytes, `conflicting-queue-record:${name}`);
  }
}

function unavailable(): QueueUsage["inputTokens"] {
  return { status: "unavailable" };
}

function measured(value: unknown, integer: boolean): QueueUsage["inputTokens"] {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    (!integer || Number.isSafeInteger(value))
    ? { status: "known", value }
    : unavailable();
}

export function queueUsage(value: unknown): QueueUsage {
  const canonical = (measure: unknown, integer: boolean) =>
    exactKeys(measure, ["status", "value"]) && measure.status === "known"
      ? measured(measure.value, integer)
      : unavailable();
  if (exactKeys(value, ["inputTokens", "outputTokens", "costUsd"]))
    return {
      inputTokens: canonical(value.inputTokens, true),
      outputTokens: canonical(value.outputTokens, true),
      costUsd: canonical(value.costUsd, false),
    };
  if (!object(value))
    return { inputTokens: unavailable(), outputTokens: unavailable(), costUsd: unavailable() };
  return {
    inputTokens: measured(value.input_tokens ?? value.inputTokens, true),
    outputTokens: measured(value.output_tokens ?? value.outputTokens, true),
    costUsd: measured(value.cost_usd ?? value.costUsd, false),
  };
}

function sameParticipantIdentity(left: QueueParticipant, right: QueueParticipant) {
  return (
    left.ordinal === right.ordinal &&
    left.id === right.id &&
    left.item === right.item &&
    left.stage === right.stage &&
    left.role === right.role &&
    left.outcome === right.outcome
  );
}

export interface RepositoryQueueAdapterOptions {
  native?: Adapter;
  setup?: SetupAdapter;
  repair?: RepairAdapter;
  delivery?: DeliveryAdapter;
  deliveryPolicy?: DeliveryPolicyAdapter;
  repairPolicy?: RepairPolicy;
  reviewRecovery?: ReviewRecoveryAdapter;
  assertExecutor?: (config: DeliveryConfig, executingRoot: string) => Promise<void>;
}

function repairHistory(history: QueueParticipant[]): ParticipantHistory[] {
  return history.map((participant) => {
    const usage = participant.usage;
    return {
      ordinal: participant.ordinal,
      id: participant.id,
      role: participant.role,
      outcome: participant.outcome,
      usage: [usage.inputTokens, usage.outputTokens, usage.costUsd].every(
        (measure) => measure.status === "unavailable",
      )
        ? { status: "unavailable" as const }
        : usage.inputTokens.status === "known" &&
            usage.outputTokens.status === "known" &&
            usage.costUsd.status === "known"
          ? {
              status: "known" as const,
              inputTokens: usage.inputTokens.value,
              outputTokens: usage.outputTokens.value,
              costUsd: usage.costUsd.value,
            }
          : usage,
    };
  });
}

export function repositoryQueueAdapter(
  config: QueueConfig,
  executingRoot: string,
  options: RepositoryQueueAdapterOptions = {},
): QueueAdapter {
  const native = options.native ?? codexAdapter();
  const setupAdapter = options.setup ?? gitSetupAdapter();
  const deliveryAdapter = options.delivery ?? githubDeliveryAdapter();
  const deliveryPolicy = options.deliveryPolicy ?? selfDeliveryPolicy();
  const selectedRepairPolicy = options.repairPolicy ?? repairPolicy();
  const assertExecutor = options.assertExecutor ?? assertControllerExecutor;
  const state = config.stateDirectory;

  const readHistory = async () => {
    const history: QueueParticipant[] = [];
    let gap = false;
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const participant = await adapterOptional(state, `participant-${ordinal}-terminal`);
      if (participant === ABSENT) {
        gap = true;
        continue;
      }
      demand(!gap, "participant-history-gap");
      const normalized = {
        ...(participant as QueueParticipant),
        usage: queueUsage((participant as QueueParticipant).usage),
      };
      if (ordinal > config.initialHistory.length) {
        const [intent, attempt] = await Promise.all([
          adapterOptional(state, `participant-${ordinal}-intent`),
          adapterOptional(state, `participant-${ordinal}-attempt`),
        ]);
        demand(
          intent !== ABSENT &&
            attempt !== ABSENT &&
            intent.schemaVersion === "dogfood-bounded-queue-participant-intent/v1" &&
            attempt.schemaVersion === "dogfood-bounded-queue-participant/v1" &&
            intent.ordinal === ordinal &&
            attempt.ordinal === ordinal &&
            intent.item === normalized.item &&
            attempt.item === normalized.item &&
            intent.stage === normalized.stage &&
            attempt.stage === normalized.stage &&
            intent.role === normalized.role &&
            attempt.role === normalized.role &&
            attempt.id === normalized.id,
          "participant-history-unobserved",
        );
      }
      history.push(normalized);
    }
    validateHistory(history, config.nativeLaunchCeiling);
    return history;
  };

  const seedHistory = async () => {
    for (const participant of config.initialHistory) {
      const name = `participant-${participant.ordinal}-terminal`;
      const existing = await adapterOptional(state, name);
      if (existing === ABSENT)
        await adapterRecord(state, name, { ...participant, usage: queueUsage(participant.usage) });
      else
        demand(
          object(existing) && sameParticipantIdentity(existing as QueueParticipant, participant),
          "participant-history-drift",
        );
    }
  };

  const nextOrdinal = async () => {
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const intent = await adapterOptional(state, `participant-${ordinal}-intent`);
      const terminal = await adapterOptional(state, `participant-${ordinal}-terminal`);
      if (intent === ABSENT && terminal === ABSENT) return ordinal;
      if (intent === ABSENT && terminal !== ABSENT) continue;
      const attempt = await adapterOptional(state, `participant-${ordinal}-attempt`);
      demand(attempt !== ABSENT, "native-launch-identity-unknown-reconcile");
    }
    throw new QueueBlocked("native-launch-ceiling-exhausted");
  };

  const boundedNative = (item: QueueItem, stage: "source" | "repair"): Adapter => ({
    ...native,
    async launch(role: Role, current: SourceConfig, prompt: string): Promise<Attempt> {
      const priorHistory = await readHistory();
      const ordinal = await nextOrdinal();
      const context = {
        schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
        ordinal,
        item: item.id,
        issue: item.issue,
        stage,
        role,
        model: current[role].model,
        effort: current[role].effort,
      };
      await adapterRecord(state, `participant-${ordinal}-intent`, context);
      const repairCompatiblePrompt =
        stage === "source" && role === "reviewer"
          ? `${prompt}\n\n${sourceReviewerReportPrompt(item.repair.sourcePaths)}\n`
          : prompt;
      const attempt = await native.launch(role, current, repairCompatiblePrompt);
      demand(
        typeof attempt.id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(attempt.id),
        "invalid-participant-identity",
      );
      demand(
        !priorHistory.some((participant) => participant.id === attempt.id),
        "reused-participant-identity",
      );
      await adapterRecord(state, `participant-${ordinal}-attempt`, {
        schemaVersion: "dogfood-bounded-queue-participant/v1",
        ordinal,
        id: attempt.id,
        item: item.id,
        stage,
        role,
      });
      return attempt;
    },
  });

  const syncParticipant = async (
    item: QueueItem,
    stage: "source" | "repair",
    role: Role,
    attempt: any,
    terminal: any,
  ) => {
    if (attempt === ABSENT || terminal === ABSENT || terminal.status === "running") return;
    let matchedOrdinal: number | undefined;
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const saved = await adapterOptional(state, `participant-${ordinal}-attempt`);
      if (saved !== ABSENT && saved.id === attempt.id) {
        demand(
          saved.item === item.id && saved.stage === stage && saved.role === role,
          "participant-context-drift",
        );
        matchedOrdinal = ordinal;
        break;
      }
    }
    demand(matchedOrdinal !== undefined, "participant-attempt-unreserved");
    const outcome: QueueParticipant["outcome"] = ["passed", "failed", "malformed"].includes(
      terminal.status,
    )
      ? terminal.status
      : "unknown";
    const participant: QueueParticipant = {
      ordinal: matchedOrdinal,
      id: attempt.id,
      item: item.id,
      stage,
      role,
      outcome,
      usage: queueUsage(terminal.usage),
    };
    const existing = await adapterOptional(state, `participant-${matchedOrdinal}-terminal`);
    if (existing === ABSENT)
      await adapterRecord(state, `participant-${matchedOrdinal}-terminal`, participant);
    else
      demand(
        sameParticipantIdentity(existing as QueueParticipant, participant),
        "participant-terminal-drift",
      );
  };

  const syncParticipants = async (
    item: QueueItem,
    stage: "source" | "repair",
    directory: string,
  ) => {
    for (const role of ["author", "reviewer"] as const) {
      const attempt = await adapterOptional(directory, `${role}-attempt`);
      let terminal = await adapterOptional(directory, `${role}-terminal`);
      if (
        stage === "source" &&
        role === "reviewer" &&
        terminal !== ABSENT &&
        ["passed", "failed"].includes(terminal.status)
      ) {
        const candidate = await adapterOptional(directory, "candidate");
        if (
          candidate !== ABSENT &&
          SHA.test(candidate.head) &&
          classifyReview(terminal.summary, item.source.run, candidate.head).disposition ===
            "malformed"
        )
          terminal = { ...terminal, status: "malformed" };
      }
      await syncParticipant(item, stage, role, attempt, terminal);
    }
  };

  const sourceReviewDisposition = async (item: QueueItem) => {
    const [candidate, terminal] = await Promise.all([
      adapterOptional(item.source.stateDirectory, "candidate"),
      adapterOptional(item.source.stateDirectory, "reviewer-terminal"),
    ]);
    if (candidate === ABSENT || terminal === ABSENT || !SHA.test(candidate.head)) return undefined;
    if (terminal.status === "malformed") return "malformed" as const;
    if (!["passed", "failed"].includes(terminal.status)) return undefined;
    return classifyReview(terminal.summary, item.source.run, candidate.head).disposition;
  };

  const acceptedPair = async (
    item: QueueItem,
    stage: "source" | "repair",
    reviewerOutcome: "passed" | "failed",
  ) => {
    const pair = (await readHistory()).filter(
      (participant) =>
        participant.ordinal > config.initialHistory.length &&
        participant.item === item.id &&
        participant.stage === stage,
    );
    const last = pair.at(-1);
    const validLength =
      stage === "repair"
        ? pair.length === 2
        : [2, 3].includes(pair.length) && (pair.length === 2 || pair[1]!.outcome === "malformed");
    demand(
      validLength &&
        pair[0]!.role === "author" &&
        pair[0]!.outcome === "passed" &&
        pair.slice(1).every((participant) => participant.role === "reviewer") &&
        last!.outcome === reviewerOutcome &&
        new Set(pair.map((participant) => participant.id)).size === pair.length,
      "participant-stage-history-mismatch",
    );
  };

  const passingSourceReview = async (item: QueueItem) => {
    const [candidate, selected] = await Promise.all([
      json(item.source.stateDirectory, "candidate"),
      selectedSourceReview(item.source),
    ]);
    demand(
      selected.terminal.status === "passed" && selected.terminal.head === candidate.head,
      "source-review-state-unknown",
    );
    let review;
    try {
      review = parseReview(selected.terminal.summary, item.source.run, candidate.head);
    } catch (error) {
      throw new QueueBlocked(
        error instanceof RepairBlocked ? error.reason : "source-review-report-unknown",
      );
    }
    demand(
      review.verdict === "PASS" && review.findings.every((finding) => finding.severity === "note"),
      "source-review-not-accepted",
    );
    return { candidate, selected };
  };

  const assertItem = (item: QueueItem) => {
    demand(
      item.issue === item.source.issue && item.issue === item.setup.issue,
      "queue-issue-drift",
    );
    demand(item.setup.run === item.source.run, "queue-run-drift");
    demand(item.base === item.source.base && item.base === item.setup.base, "queue-base-drift");
    demand(item.source.owner === config.authority.controller, "queue-controller-drift");
    demand(
      item.source.pilotRevision === config.controllerRevision,
      "candidate-as-executor-selection",
    );
    demand(
      item.setup.controllerRoot === config.controllerRoot &&
        item.setup.controllerRevision === config.controllerRevision &&
        item.setup.pilotRevision === config.controllerRevision &&
        item.setup.authority.controller === config.authority.controller,
      "queue-executor-drift",
    );
    demand(
      item.setup.sourceWorktree === item.source.worktree &&
        item.setup.reviewWorktree === item.source.reviewWorktree &&
        item.setup.pilotWorktree !== item.source.worktree &&
        item.setup.pilotWorktree !== item.source.reviewWorktree,
      "queue-worktree-drift",
    );
    demand(item.source.repository === item.setup.repository, "queue-repository-drift");
    demand(
      item.setup.authority.actions.includes("worktrees") && validRepositoryRepairTemplate(item),
      "queue-policy-drift",
    );
    for (const actor of [item.repair.author, item.repair.reviewer])
      demand(
        exactKeys(actor, ["model", "effort", "promptFile"]) &&
          [actor.model, actor.effort].every(
            (value) => typeof value === "string" && value.length > 0,
          ) &&
          isAbsolute(actor.promptFile),
        "queue-policy-drift",
      );
    demand(
      JSON.stringify(item.delivery.requiredChecks) === JSON.stringify(item.source.requiredChecks),
      "queue-hosted-check-drift",
    );
  };

  const buildRepair = async (item: QueueItem): Promise<RepairConfig> => {
    const [pinned, candidate, authorAttempt, selected] = await Promise.all([
      json(item.source.stateDirectory, "config"),
      json(item.source.stateDirectory, "candidate"),
      json(item.source.stateDirectory, "author-attempt"),
      selectedSourceReview(item.source),
    ]);
    const reviewerAttempt = selected.attempt;
    demand(SHA.test(candidate.head), "source-candidate-mismatch");
    const history = await readHistory();
    const baseline = history.filter(
      (participant) => !(participant.item === item.id && participant.stage === "repair"),
    );
    demand(baseline.length + 2 <= config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
    const projected = repairHistory(baseline);
    const admission = {
      consumed: projected.length,
      ceiling: projected.length + 2,
      reservations: [
        { role: "author" as const, ordinal: projected.length + 1 },
        { role: "reviewer" as const, ordinal: projected.length + 2 },
      ] as [{ role: "author"; ordinal: number }, { role: "reviewer"; ordinal: number }],
    };
    const partial = {
      schemaVersion: "dogfood-repair-request/v1" as const,
      run: item.source.run,
      issue: item.issue,
      repository: item.source.repository,
      controllerRoot: config.controllerRoot,
      controllerRevision: config.controllerRevision,
      mainBase: item.base,
      repairBase: candidate.head,
      worktree: item.source.worktree,
      reviewWorktree: item.source.reviewWorktree,
      stateDirectory: item.repair.stateDirectory,
      sourceStateDirectory: item.source.stateDirectory,
      allowedPaths: item.source.allowedPaths,
      sourcePaths: item.repair.sourcePaths,
      acceptanceCriteria: item.repair.acceptanceCriteria,
      requiredChecks: item.source.requiredChecks,
      history: projected,
      implementationAttempts: item.implementationAttempt,
      implementationAttemptCeiling: 4,
      admission,
      author: item.repair.author,
      reviewer: item.repair.reviewer,
      adapter: item.source.adapter,
    };
    return {
      ...partial,
      authority: {
        schemaVersion: "dogfood-repair-authority/v1",
        controller: config.authority.controller,
        run: partial.run,
        issue: partial.issue,
        repository: partial.repository,
        controllerRoot: partial.controllerRoot,
        controllerRevision: partial.controllerRevision,
        mainBase: partial.mainBase,
        repairBase: partial.repairBase,
        worktree: partial.worktree,
        reviewWorktree: partial.reviewWorktree,
        stateDirectory: partial.stateDirectory,
        sourceStateDirectory: partial.sourceStateDirectory,
        allowedPaths: partial.allowedPaths,
        sourcePaths: partial.sourcePaths,
        acceptanceCriteria: partial.acceptanceCriteria,
        requiredChecks: partial.requiredChecks,
        source: {
          owner: item.source.owner,
          run: item.source.run,
          pilotRevision: item.source.pilotRevision,
          requiredChecks: item.source.requiredChecks,
          author: item.source.author,
          reviewer: item.source.reviewer,
          adapter: item.source.adapter,
          configFingerprint: pinned.fingerprint,
          candidateHead: candidate.head,
          authorAttempt: authorAttempt.id,
          reviewerAttempt: reviewerAttempt.id,
          reviewId: reviewerAttempt.id,
          disposition: "BLOCK_FIXABLE",
        },
        author: partial.author,
        reviewer: partial.reviewer,
        adapter: partial.adapter,
        implementationAttempts: partial.implementationAttempts,
        implementationAttemptCeiling: partial.implementationAttemptCeiling,
        admission,
        historyDigest: repairDigest(projected),
        actions: ["validate-source-review", "dispatch-author", "dispatch-delta-review"],
      },
    };
  };

  return {
    async assertAuthority(current) {
      demand(current === config, "queue-adapter-config-drift");
      demand(isAbsolute(executingRoot), "controller-executor-unverified");
      const [executor, ...roots] = await Promise.all(
        [
          executingRoot,
          config.controllerRoot,
          config.stateDirectory,
          ...config.items.flatMap((item) => [
            item.setup.stateDirectory,
            item.source.stateDirectory,
            item.repair.stateDirectory,
          ]),
        ].map((path) => realpath(path)),
      );
      demand(executor !== undefined, "controller-executor-unverified");
      demand(
        roots.every((root, index) =>
          roots.every((other, otherIndex) => index === otherIndex || outside(root, other)),
        ),
        "queue-state-overlap",
      );
      const controller = roots[0]!;
      const queueState = roots[1]!;
      demand(samePath(executor, controller), "controller-executor-mismatch");
      const selectedRoots = await Promise.all(
        config.items
          .flatMap((item) => [
            item.setup.repositoryRoot,
            item.setup.controllerRoot,
            item.setup.pilotWorktree,
            item.setup.sourceWorktree,
            item.setup.reviewWorktree,
          ])
          .map(canonicalSelectedPath),
      );
      demand(
        outside(controller, queueState) &&
          outside(queueState, controller) &&
          selectedRoots.every((root) => outside(root, queueState) && outside(queueState, root)),
        "queue-state-inside-checkout",
      );
      const git = async (args: string[]) =>
        (
          await exec("git", ["-C", executor, ...args], {
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          })
        ).stdout.trim();
      try {
        demand(
          samePath(await realpath(await git(["rev-parse", "--show-toplevel"])), executor),
          "controller-executor-not-repository-root",
        );
        demand(
          (await git(["rev-parse", "HEAD"])) === config.controllerRevision,
          "controller-executor-revision-moved",
        );
        demand((await git(["status", "--porcelain"])) === "", "dirty-controller-executor");
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked("controller-executor-unverified");
      }
      config.items.forEach(assertItem);
      await seedHistory();
      const authorityFingerprint = queueDigest({
        authority: config.authority,
        lineage: config.initialHistory.map(({ usage: _usage, ...identity }) => identity),
      });
      await adapterRecord(state, "queue-adapter-authority", { fingerprint: authorityFingerprint });
    },
    history: readHistory,
    async setup(item) {
      assertItem(item);
      try {
        return await setupStep(item.setup, setupAdapter, executingRoot);
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof SetupBlocked ? error.reason : "setup-state-unknown",
        );
      }
    },
    async source(item): Promise<QueueSourceResult> {
      assertItem(item);
      demand(
        (await adapterOptional(item.source.stateDirectory, "publication")) === ABSENT,
        "source-cannot-publish",
      );
      try {
        const result = await step(
          item.source,
          boundedNative(item, "source"),
          item.setup.pilotWorktree,
        );
        if ((await sourceReviewDisposition(item)) === "malformed")
          throw new Error("reviewer-malformed");
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return { status: result.status };
        demand(result.status === "awaiting-publication", "unexpected-source-flow-status");
        await acceptedPair(item, "source", "passed");
        const { candidate, selected } = await passingSourceReview(item);
        return {
          status: "accepted",
          head: candidate.head,
          reviewId: selected.attempt.id,
          stateDirectory: item.source.stateDirectory,
        };
      } catch (error) {
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (error instanceof QueueBlocked) throw error;
        const reason =
          (await sourceReviewDisposition(item)) === "malformed"
            ? "reviewer-malformed"
            : error instanceof Error
              ? error.message
              : "";
        if (reason === "reviewer-malformed") {
          const recovery =
            options.reviewRecovery ?? reviewedReviewRecoveryAdapter(boundedNative(item, "source"));
          let selected;
          try {
            selected = await recovery.recover(item.source);
          } catch (recoveryError) {
            throw new QueueBlocked(
              recoveryError instanceof ReviewRecoveryBlocked
                ? recoveryError.reason
                : "review-recovery-state-unknown",
            );
          }
          if (selected.status === "observing-reviewer") return { status: selected.status };
          await syncParticipant(item, "source", "reviewer", selected.attempt, selected.terminal);
          await acceptedPair(item, "source", selected.terminal.status);
          if (selected.terminal.status === "passed") {
            await passingSourceReview(item);
            return {
              status: "accepted",
              head: selected.terminal.head,
              reviewId: selected.attempt.id,
              stateDirectory: item.source.stateDirectory,
            };
          }
          return {
            status: "fixable-review",
            head: selected.terminal.head,
            reviewId: selected.attempt.id,
          };
        }
        demand(reason === "reviewer-failed", "source-flow-state-unknown");
        const [candidate, reviewer, terminal] = await Promise.all([
          json(item.source.stateDirectory, "candidate"),
          json(item.source.stateDirectory, "reviewer-attempt"),
          json(item.source.stateDirectory, "reviewer-terminal"),
        ]);
        demand(
          terminal.status === "failed" &&
            terminal.id === reviewer.id &&
            terminal.head === candidate.head,
          "source-review-state-unknown",
        );
        await acceptedPair(item, "source", "failed");
        return { status: "fixable-review", head: candidate.head, reviewId: reviewer.id };
      }
    },
    async repair(item): Promise<QueueRepairResult> {
      assertItem(item);
      try {
        const repair = await buildRepair(item);
        const result = await repairStep(
          repair,
          options.repair ?? reviewedRepairAdapter(boundedNative(item, "repair")),
          selectedRepairPolicy,
        );
        await syncParticipants(item, "repair", item.repair.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return { status: result.status };
        demand(result.status === "awaiting-delivery", "unexpected-repair-status");
        await acceptedPair(item, "repair", "passed");
        const reviewer = await json(item.repair.stateDirectory, "reviewer-attempt");
        return {
          status: "accepted",
          head: result.head,
          reviewId: reviewer.id,
          stateDirectory: item.repair.stateDirectory,
        };
      } catch (error) {
        try {
          await syncParticipants(item, "repair", item.repair.stateDirectory);
        } catch (historyError) {
          if (historyError instanceof QueueBlocked) throw historyError;
          throw new QueueBlocked("repair-history-state-unknown");
        }
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof RepairBlocked ? error.reason : "repair-state-unknown",
        );
      }
    },
    async delivery(item, accepted): Promise<QueueDeliveryResult> {
      assertItem(item);
      const delivery: DeliveryConfig = {
        run: item.source.run,
        issue: item.issue,
        repository: item.source.repository,
        controllerRoot: config.controllerRoot,
        controllerRevision: config.controllerRevision,
        worktree: item.source.worktree,
        reviewWorktree: item.source.reviewWorktree,
        stateDirectory: accepted.stateDirectory,
        candidateHead: accepted.head,
        ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
        requiredChecks: item.delivery.requiredChecks,
        authority: {
          schemaVersion: "dogfood-delivery-authority/v1",
          controller: config.authority.controller,
          run: item.source.run,
          repository: item.source.repository,
          controllerRevision: config.controllerRevision,
          head: accepted.head,
          ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
          actions: ["gates", "mirror", "publish", "merge", "cleanup"],
        },
        policy: item.delivery.policy,
      };
      try {
        await assertExecutor(delivery, executingRoot);
        const result = await deliveryStep(delivery, deliveryAdapter, deliveryPolicy);
        demand(
          result.head === accepted.head && result.reviewId === accepted.reviewId,
          "delivery-source-drift",
        );
        if (result.status === "observing-hosted-checks")
          return { status: result.status, head: result.head, reviewId: result.reviewId };
        return result;
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof DeliveryBlocked ? error.reason : "delivery-state-unknown",
        );
      }
    },
  };
}

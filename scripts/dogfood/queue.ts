import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
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
import { gateCorrectionStep, selectedSourceReview, step } from "./flow.ts";
import type { Adapter, Attempt, Config as SourceConfig, Role } from "./flow.js";
import { reviewedRepairAdapter, sourceReviewerReportPrompt } from "./repair-adapter.mjs";
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
  type ReviewFinding,
  type RepairPolicy,
} from "./repair-policy.mjs";
import { selfDeliveryPolicy } from "./self-delivery-policy.mjs";
import { gitSetupAdapter } from "./setup-adapter.mjs";
import { SetupBlocked, setupStep, type SetupAdapter, type SetupConfig } from "./setup.mjs";

export const QUEUE_AUTHORITY_SCHEMA = "dogfood-bounded-queue-authority/v1" as const;
export const QUEUE_CONFIG_SCHEMA = "dogfood-bounded-queue-config/v1" as const;
export const LOOP_CONFIG_SCHEMA = "dogfood-loop/v1" as const;
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
  implementationAttemptCeiling: number;
  setup: SetupConfig;
  source: SourceConfig;
  repair: {
    stateDirectory: string;
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
  schemaVersion: typeof QUEUE_CONFIG_SCHEMA;
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

export interface LoopConfig {
  schemaVersion: typeof LOOP_CONFIG_SCHEMA;
  run: string;
  repository: string;
  stableExecutorRoot: string;
  stateRoot: string;
  worktreeRoot: string;
  author: { model: string; effort: string };
  reviewer: { model: string; effort: string };
  codexExecutable: string;
  gitExecutable: string;
  exitReceiptWindowMs: number;
  nativeLaunchCeiling: number;
  attemptCeiling: number;
}

export const ACTIONABLE_STOP_REASONS = [
  "completed-issue-state-unknown",
  "issue-observation-unavailable",
  "selected-base-unavailable",
  "current-main-unavailable",
  "gate-retry-exhausted:typecheck",
  "gate-retry-exhausted:format:check",
  "reviewer-retry-exhausted",
  "exit-receipt-timeout",
  "native-launch-ceiling-exhausted",
  "implementation-attempt-ceiling-exhausted",
  "author-temp-unavailable",
  "author-offline-pnpm-unavailable",
] as const;
export type ActionableStopReason = (typeof ACTIONABLE_STOP_REASONS)[number];

export interface SelectedLoopIssue {
  key: string;
  number: number;
  base: string;
}

export type QueueSourceResult =
  | { status: "observing-author" | "observing-reviewer" }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string }
  | { status: "fixable-review"; head: string; reviewId: string; findings: ReviewFinding[] };
export type QueueRepairResult =
  | { status: "observing-author" | "observing-reviewer" }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string }
  | { status: "failed"; head: string; reviewId: string; findings: ReviewFinding[] };
export type QueueDeliveryResult =
  | { status: "observing-author" | "observing-reviewer" }
  | { status: "failed"; head: string; reviewId: string; findings: ReviewFinding[] }
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
  | {
      status: "advancing-attempt";
      run: string;
      item: string;
      issue: string;
      cursor: number;
    }
  | { status: "complete"; run: string; cursor: number; items: number; participants: number };

export class QueueBlocked extends Error {
  readonly reason: string;
  readonly diagnostics: string | undefined;
  constructor(reason: string, diagnostics?: string) {
    super(reason);
    this.reason = reason;
    this.diagnostics = diagnostics;
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
    implementationAttemptCeiling: item.implementationAttemptCeiling,
    setup: item.setup,
    source: item.source,
    repair: item.repair,
    delivery: item.delivery,
  };
}

export function validateLoopConfig(config: LoopConfig) {
  demand(
    exactKeys(config, [
      "schemaVersion",
      "run",
      "repository",
      "stableExecutorRoot",
      "stateRoot",
      "worktreeRoot",
      "author",
      "reviewer",
      "codexExecutable",
      "gitExecutable",
      "exitReceiptWindowMs",
      "nativeLaunchCeiling",
      "attemptCeiling",
    ]) && config.schemaVersion === LOOP_CONFIG_SCHEMA,
    "malformed-loop-config",
  );
  demand(/^[\w.-]{1,64}$/.test(config.run) && ![".", ".."].includes(config.run), "invalid-run");
  demand(
    Number.isSafeInteger(config.exitReceiptWindowMs) &&
      config.exitReceiptWindowMs >= 0 &&
      config.exitReceiptWindowMs <= 300_000,
    "invalid-exit-receipt-window",
  );
  demand(/^[^/\s]+\/[^/\s]+$/.test(config.repository), "invalid-repository");
  for (const name of [
    "stableExecutorRoot",
    "stateRoot",
    "worktreeRoot",
    "codexExecutable",
    "gitExecutable",
  ] as const)
    demand(typeof config[name] === "string" && isAbsolute(config[name]), `invalid-${name}`);
  for (const role of ["author", "reviewer"] as const)
    demand(
      exactKeys(config[role], ["model", "effort"]) &&
        [config[role].model, config[role].effort].every(
          (value) => typeof value === "string" && value.length > 0,
        ),
      `invalid-${role}`,
    );
  demand(
    Number.isSafeInteger(config.nativeLaunchCeiling) &&
      config.nativeLaunchCeiling > 0 &&
      config.nativeLaunchCeiling <= 64,
    "invalid-native-launch-ceiling",
  );
  demand(
    Number.isSafeInteger(config.attemptCeiling) &&
      config.attemptCeiling > 0 &&
      config.attemptCeiling <= 4,
    "invalid-attempt-ceiling",
  );
}

function draftTitle(draft: string) {
  const title = /^title:\s*"([^"]+)"\s*$/m.exec(draft)?.[1];
  demand(title, "selected-issue-title-missing");
  return title;
}

function doneWhen(draft: string) {
  const section = /\n## Done when\s*\n([\s\S]*?)(?=\n## |$)/.exec(draft)?.[1]?.trim();
  demand(section, "selected-issue-criteria-missing");
  return [section];
}

interface FailedAttemptReceipt {
  schemaVersion: "dogfood-bounded-queue-attempt-failure/v1";
  run: string;
  item: string;
  issue: string;
  base: string;
  candidateAttempt: number;
  head: string;
  reviewer: string;
  findings: ReviewFinding[];
  history: QueueParticipant[];
}

function validateFailedAttempt(
  value: unknown,
  sourceAttempt: number,
  attemptCeiling: number,
): asserts value is FailedAttemptReceipt {
  demand(
    exactKeys(value, [
      "schemaVersion",
      "run",
      "item",
      "issue",
      "base",
      "candidateAttempt",
      "head",
      "reviewer",
      "findings",
      "history",
    ]) &&
      value.schemaVersion === "dogfood-bounded-queue-attempt-failure/v1" &&
      Number.isSafeInteger(value.candidateAttempt) &&
      [sourceAttempt, sourceAttempt + 1].includes(value.candidateAttempt) &&
      value.candidateAttempt <= attemptCeiling &&
      SHA.test(value.head) &&
      typeof value.reviewer === "string" &&
      Array.isArray(value.findings) &&
      Array.isArray(value.history),
    "malformed-failed-attempt",
  );
}

export async function validateLoopExecutor(config: LoopConfig, executingRoot: string) {
  validateLoopConfig(config);
  const [executor, configured] = await Promise.all([
    realpath(executingRoot),
    realpath(config.stableExecutorRoot),
  ]);
  demand(samePath(executor, configured), "controller-executor-mismatch");
  await Promise.all([
    mkdir(config.stateRoot, { recursive: true }),
    mkdir(config.worktreeRoot, { recursive: true }),
  ]);
  const [stateRoot, worktreeRoot] = await Promise.all([
    realpath(config.stateRoot),
    realpath(config.worktreeRoot),
  ]);
  demand(
    outside(executor, stateRoot) &&
      outside(stateRoot, executor) &&
      outside(executor, worktreeRoot) &&
      outside(worktreeRoot, executor) &&
      outside(stateRoot, worktreeRoot) &&
      outside(worktreeRoot, stateRoot),
    "loop-roots-overlap",
  );
  const git = async (args: string[]) =>
    (
      await exec(config.gitExecutable, ["-C", executor, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  const [controllerRevision, branch, status, version] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["branch", "--show-current"]),
    git(["status", "--porcelain"]),
    exec(config.gitExecutable, ["--version"], { windowsHide: true }).then((result) =>
      result.stdout.trim(),
    ),
  ]);
  demand(SHA.test(controllerRevision) && branch === "main" && status === "", "unstable-executor");
  if (process.platform === "win32") {
    const match = /git version (\d+)\.(\d+)/.exec(version);
    demand(
      match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 53)),
      "incompatible-git",
    );
  }
  return { executor, stateRoot, worktreeRoot, controllerRevision };
}

export async function queueConfigFromLoop(
  config: LoopConfig,
  executingRoot: string,
  selected: SelectedLoopIssue,
  priorHistory: QueueParticipant[] = [],
) {
  validateLoopConfig(config);
  demand(
    exactKeys(selected, ["key", "number", "base"]) &&
      /^ISS-\d{3}$/.test(selected.key) &&
      Number.isSafeInteger(selected.number) &&
      selected.number > 0 &&
      SHA.test(selected.base),
    "invalid-selected-issue",
  );
  validateHistory(priorHistory, config.nativeLaunchCeiling);
  const { executor, stateRoot, worktreeRoot, controllerRevision } = await validateLoopExecutor(
    config,
    executingRoot,
  );
  const git = async (args: string[]) =>
    (
      await exec(config.gitExecutable, ["-C", executor, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  const [selectedBase, planning, loopRules] = await Promise.all([
    git(["rev-parse", "--verify", `${selected.base}^{commit}`]),
    readFile(resolve(executor, "planning/roadmap.json"), "utf8").then(JSON.parse),
    readFile(resolve(executor, "docs/loop.md"), "utf8"),
  ]);
  demand(selectedBase === selected.base, "selected-base-unavailable");
  const registered = planning?.issues?.find((issue: any) => issue.key === selected.key);
  demand(registered?.file === `planning/drafts/${selected.key}.md`, "selected-issue-unregistered");
  demand(planning.repository === config.repository, "planning-repository-mismatch");
  const draft = await readFile(resolve(executor, registered.file), "utf8");
  const title = draftTitle(draft);
  const issueUrl = `https://github.com/${config.repository}/issues/${selected.number}`;
  const promptContext = `Repository loop rules:\n\n${loopRules.trim()}\n\nSelected issue ${selected.key} (#${selected.number}):\n\n${draft.trim()}`;
  const baseSourcePrompt = `Implement the selected issue completely. Keep the loop smaller and stay within the issue scope.\n\n${promptContext}`;
  const reviewerPrompt = `Review the selected issue implementation independently against every stated criterion.\n\n${promptContext}`;
  const runState = resolve(stateRoot, config.run);
  let sourceAttempt = 1;
  let attemptBase = selected.base;
  let initialHistory: QueueParticipant[] = [...priorHistory];
  let prescribedFindings: ReviewFinding[] | undefined;
  for (;;) {
    const priorSlug = `${selected.key.toLowerCase()}-attempt-${sourceAttempt}`;
    const priorQueue = resolve(runState, priorSlug, "queue");
    const failed = await optionalRecord(priorQueue, "item-1-failed");
    if (failed === ABSENT) break;
    validateFailedAttempt(failed, sourceAttempt, config.attemptCeiling);
    demand(
      failed.candidateAttempt < config.attemptCeiling,
      "implementation-attempt-ceiling-exhausted",
    );
    sourceAttempt = failed.candidateAttempt + 1;
    attemptBase = failed.head;
    initialHistory = failed.history;
    prescribedFindings = failed.findings;
  }
  const slug = `${selected.key.toLowerCase()}-attempt-${sourceAttempt}`;
  const paths = {
    queue: resolve(runState, slug, "queue"),
    setup: resolve(runState, slug, "setup"),
    source: resolve(runState, slug, "source"),
    repair: resolve(runState, slug, "repair"),
    pilot: resolve(worktreeRoot, `${slug}-pilot`),
    sourceWorktree: resolve(worktreeRoot, `${slug}-source`),
    reviewWorktree: resolve(worktreeRoot, `${slug}-review`),
  };
  await Promise.all(
    [paths.queue, paths.setup, paths.source, paths.repair].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  const controller = `loop:${config.run}`;
  const sourceBranch = `codex/${selected.key.toLowerCase()}${
    sourceAttempt === 1 ? "" : `-attempt-${sourceAttempt}`
  }`;
  const sourcePrompt = prescribedFindings
    ? `${baseSourcePrompt}\n\nStart from rejected candidate ${attemptBase}. Apply these reviewer-prescribed fixes verbatim: ${JSON.stringify(prescribedFindings)}`
    : baseSourcePrompt;
  const setupWithoutAuthority = {
    run: config.run,
    issue: issueUrl,
    repository: config.repository,
    repositoryRoot: executor,
    controllerRoot: executor,
    controllerRevision,
    pilotRevision: controllerRevision,
    base: attemptBase,
    baseBranch: "main",
    sourceBranch,
    pilotWorktree: paths.pilot,
    sourceWorktree: paths.sourceWorktree,
    reviewWorktree: paths.reviewWorktree,
    stateDirectory: paths.setup,
  };
  const setup: SetupConfig = {
    ...setupWithoutAuthority,
    authority: {
      schemaVersion: "dogfood-setup-authority/v1",
      controller,
      ...setupWithoutAuthority,
      actions: ["worktrees", "dependencies"],
    },
  };
  const source: SourceConfig = {
    owner: controller,
    run: config.run,
    issue: issueUrl,
    pilotRevision: controllerRevision,
    base: attemptBase,
    worktree: paths.sourceWorktree,
    reviewWorktree: paths.reviewWorktree,
    stateDirectory: paths.source,
    allowedPaths: ["."],
    repository: config.repository,
    requiredChecks: [
      "Node 24 / ubuntu-latest",
      "Node 24 / windows-latest",
      "Node 24 / macos-latest",
    ],
    exitReceiptWindowMs: config.exitReceiptWindowMs,
    author: { ...config.author, prompt: sourcePrompt },
    reviewer: { ...config.reviewer, prompt: reviewerPrompt },
    adapter: { kind: "codex-exec", executable: config.codexExecutable },
  };
  const item: QueueItem = {
    id: `${selected.key}:${sourceAttempt}`,
    issue: issueUrl,
    base: attemptBase,
    implementationAttempt: sourceAttempt,
    implementationAttemptCeiling: config.attemptCeiling,
    setup,
    source,
    repair: {
      stateDirectory: paths.repair,
      acceptanceCriteria: doneWhen(draft),
      author: { ...config.author, prompt: sourcePrompt },
      reviewer: { ...config.reviewer, prompt: reviewerPrompt },
    },
    delivery: {
      requiredChecks: [...source.requiredChecks],
      policy: {
        kind: "orchestration-platform-self/v1",
        planningKey: selected.key,
        planningIssue: selected.number,
        sourceBranch,
        baseBranch: "main",
        pullRequestTitle: `[${selected.key}] ${title}`,
        pullRequestBody: `Closes #${selected.number}`,
      },
    },
  };
  const queue: QueueConfig = {
    schemaVersion: QUEUE_CONFIG_SCHEMA,
    run: config.run,
    controllerRoot: executor,
    controllerRevision,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: config.nativeLaunchCeiling,
    initialHistory,
    items: [item],
    authority: undefined as never,
  };
  queue.authority = {
    schemaVersion: QUEUE_AUTHORITY_SCHEMA,
    controller,
    run: queue.run,
    controllerRoot: queue.controllerRoot,
    controllerRevision: queue.controllerRevision,
    stateDirectory: queue.stateDirectory,
    limit: queue.limit,
    nativeLaunchCeiling: queue.nativeLaunchCeiling,
    lineageDigest: queueDigest(queue.initialHistory.map(participantIdentity)),
    itemsDigest: queueDigest(queue.items.map(itemAuthority)),
    actions: ["setup", "source", "repair", "delivery"],
  };
  validateQueueConfig(queue);
  return queue;
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
    ]) &&
      config.schemaVersion === QUEUE_CONFIG_SCHEMA &&
      /^[\w.-]{1,80}$/.test(config.run) &&
      isAbsolute(config.controllerRoot) &&
      isAbsolute(config.stateDirectory) &&
      SHA.test(config.controllerRevision),
    "malformed-queue-config",
  );
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
        "implementationAttemptCeiling",
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
        Number.isSafeInteger(item.implementationAttemptCeiling) &&
        item.implementationAttemptCeiling > 0 &&
        item.implementationAttemptCeiling <= 4 &&
        item.implementationAttempt <= item.implementationAttemptCeiling,
      "malformed-queue-item",
    );
    demand(!itemIds.has(item.id), "duplicate-queue-item");
    itemIds.add(item.id);
    demand(item.setup.run === item.source.run, "queue-run-drift");
    demand(
      item.issue === item.source.issue && item.issue === item.setup.issue,
      "queue-issue-drift",
    );
    demand(
      JSON.stringify(item.source.requiredChecks) === JSON.stringify(item.delivery.requiredChecks),
      "queue-hosted-check-drift",
    );
    if (item.delivery.refresh)
      demand(
        item.delivery.refresh.head === item.base &&
          item.implementationAttempt > 1 &&
          Number.isSafeInteger(item.delivery.refresh.number) &&
          item.delivery.refresh.number > 0 &&
          typeof item.delivery.refresh.url === "string" &&
          item.delivery.refresh.url.startsWith("https://"),
        "malformed-publication-refresh",
      );
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

async function optionalRecord(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new QueueBlocked(`malformed-queue-record:${name}`);
  }
}

export async function currentCandidateAttempt(config: QueueConfig) {
  const item = config.items[0];
  demand(item, "missing-queue-item");
  const repaired = (await optionalRecord(config.stateDirectory, "item-1-repair-intent")) !== ABSENT;
  return Math.min(item.implementationAttempt + Number(repaired), item.implementationAttemptCeiling);
}

export async function hasStartedDelivery(config: QueueConfig) {
  validateQueueConfig(config);
  const [intent, itemComplete, queueComplete] = await Promise.all([
    optionalRecord(config.stateDirectory, "item-1-delivery-intent"),
    optionalRecord(config.stateDirectory, "item-1-complete"),
    optionalRecord(config.stateDirectory, "queue-complete"),
  ]);
  return intent !== ABSENT || itemComplete !== ABSENT || queueComplete !== ABSENT;
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
      "failed",
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

function participantGroups(participants: QueueParticipant[], reason: string) {
  const groups: QueueParticipant[][] = [];
  for (const participant of participants) {
    if (participant.role === "author") groups.push([participant]);
    else {
      const group = groups.at(-1);
      demand(group && group[0]!.role === "author", reason);
      group.push(participant);
    }
  }
  for (const group of groups)
    demand(
      [2, 3].includes(group.length) &&
        group[0]!.role === "author" &&
        group[0]!.outcome === "passed" &&
        group.slice(1).every((participant) => participant.role === "reviewer") &&
        (group.length === 2 || group[1]!.outcome === "malformed") &&
        new Set(group.map((participant) => participant.id)).size === group.length,
      reason,
    );
  return groups;
}

function assertItemReviewHistory(
  history: QueueParticipant[],
  item: QueueItem,
  repaired: boolean,
  reviewId: string,
  priorParticipants: number,
) {
  const sourceHistory = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "source",
  );
  const repairHistory = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "repair",
  );
  const source = participantGroups(sourceHistory, "item-review-history-mismatch");
  const repair = participantGroups(repairHistory, "item-review-history-mismatch");
  const sourceReview = source[0]?.at(-1);
  const baseRepair = repair[0]?.at(-1);
  const gate = source[1] ?? repair[1];
  const selected = gate?.at(-1) ?? (repaired ? baseRepair : sourceReview);
  demand(
    source.length >= 1 &&
      source.length <= 2 &&
      repair.length <= 2 &&
      sourceReview?.outcome === (repaired ? "failed" : "passed") &&
      (repaired ? repair.length >= 1 && baseRepair?.outcome === "passed" : repair.length === 0) &&
      !(source.length === 2 && repair.length === 2) &&
      selected?.outcome === "passed" &&
      selected.id === reviewId,
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
  const groups = participantGroups(source, "malformed-source-failure-stage");
  demand(
    groups.length === 1 &&
      groups[0]!.at(-1)!.outcome === "failed" &&
      groups[0]!.at(-1)!.id === reviewId &&
      repair.length === 0,
    "malformed-source-failure-stage",
  );
}

function assertRepairFailureHistory(
  history: QueueParticipant[],
  item: QueueItem,
  reviewId: string,
  priorParticipants: number,
) {
  const repair = history.filter(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "repair",
  );
  const groups = participantGroups(repair, "malformed-repair-failure-stage");
  demand(
    groups.length === 1 &&
      groups[0]!.at(-1)!.outcome === "failed" &&
      groups[0]!.at(-1)!.id === reviewId,
    "malformed-repair-failure-stage",
  );
}

async function failedItemReceipt(directory: string, prefix: string, item: QueueItem) {
  const failed = await optionalRecord(directory, `${prefix}-failed`);
  if (failed === ABSENT) return ABSENT;
  validateFailedAttempt(failed, item.implementationAttempt, item.implementationAttemptCeiling);
  return failed;
}

function attemptFailureRecord(
  config: QueueConfig,
  item: QueueItem,
  candidateAttempt: number,
  review: { head: string; reviewId: string; findings: ReviewFinding[] },
  history: QueueParticipant[],
): FailedAttemptReceipt {
  return {
    schemaVersion: "dogfood-bounded-queue-attempt-failure/v1",
    run: config.run,
    item: item.id,
    issue: item.issue,
    base: item.base,
    candidateAttempt,
    head: review.head,
    reviewer: review.reviewId,
    findings: review.findings,
    history,
  };
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
  for (const [index, item] of config.items.entries()) {
    const failed = await failedItemReceipt(directory, `item-${index + 1}`, item);
    if (failed === ABSENT) continue;
    demand(
      failed.candidateAttempt < item.implementationAttemptCeiling,
      "implementation-attempt-ceiling-exhausted",
    );
    return {
      status: "advancing-attempt",
      run: config.run,
      item: item.id,
      issue: item.issue,
      cursor: failed.candidateAttempt,
    };
  }
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
        const failedSource = await optionalRecord(directory, `${prefix}-source-failure`);
        demand(failedSource !== ABSENT, "malformed-source-failure-stage");
        if (item.implementationAttempt >= item.implementationAttemptCeiling) {
          const history = await adapter.history();
          assertHistoryPrefix(config, history);
          await record(
            directory,
            `${prefix}-failed`,
            attemptFailureRecord(config, item, item.implementationAttempt, failedSource, history),
          );
          throw new QueueBlocked("implementation-attempt-ceiling-exhausted");
        }
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
        if (repair.status === "failed") {
          assertRepairFailureHistory(history, item, repair.reviewId, config.initialHistory.length);
          await record(
            directory,
            `${prefix}-failed`,
            attemptFailureRecord(config, item, item.implementationAttempt + 1, repair, history),
          );
          demand(
            item.implementationAttempt + 1 < item.implementationAttemptCeiling,
            "implementation-attempt-ceiling-exhausted",
          );
          return {
            status: "advancing-attempt",
            run: config.run,
            item: item.id,
            issue: item.issue,
            cursor: item.implementationAttempt + 1,
          };
        }
        assertItemReviewHistory(history, item, true, repair.reviewId, config.initialHistory.length);
        accepted = stageRecord(item, "repair", history, repair);
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
    const delivery = await adapter.delivery(item, {
      head: accepted.head,
      reviewId: accepted.reviewId,
      stateDirectory: accepted.stateDirectory,
    });
    const history = await adapter.history();
    assertHistoryPrefix(config, history);
    if (delivery.status === "observing-author" || delivery.status === "observing-reviewer")
      return {
        status: delivery.status,
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: index,
      };
    if (delivery.status === "failed") {
      const candidateAttempt = item.implementationAttempt + (accepted.stage === "repair" ? 1 : 0);
      await record(
        directory,
        `${prefix}-failed`,
        attemptFailureRecord(config, item, candidateAttempt, delivery, history),
      );
      demand(
        candidateAttempt < item.implementationAttemptCeiling,
        "implementation-attempt-ceiling-exhausted",
      );
      return {
        status: "advancing-attempt",
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: candidateAttempt,
      };
    }
    demand("head" in delivery && "reviewId" in delivery, "delivery-identity-drift");
    assertItemReviewHistory(
      history,
      item,
      accepted.stage === "repair",
      delivery.reviewId,
      config.initialHistory.length,
    );
    demand(
      (delivery.head === accepted.head && delivery.reviewId === accepted.reviewId) ||
        history.length > accepted.history.length,
      "delivery-identity-drift",
    );
    accepted = stageRecord(item, accepted.stage, history, {
      status: "accepted",
      head: delivery.head,
      reviewId: delivery.reviewId,
      stateDirectory: accepted.stateDirectory,
    });
    await record(directory, `${prefix}-accepted`, accepted);
    await record(directory, `${prefix}-delivery-intent`, {
      item: item.id,
      head: accepted.head,
      reviewId: accepted.reviewId,
      stateDirectory: accepted.stateDirectory,
    });
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
  gitExecutable?: string;
  native?: Adapter;
  setup?: SetupAdapter;
  repair?: RepairAdapter;
  delivery?: DeliveryAdapter;
  deliveryPolicy?: DeliveryPolicyAdapter;
  repairPolicy?: RepairPolicy;
  assertExecutor?: (
    config: DeliveryConfig,
    executingRoot: string,
    gitExecutable?: string,
  ) => Promise<void>;
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
  const gitExecutable = options.gitExecutable ?? "git";
  const native = options.native ?? codexAdapter(gitExecutable);
  const setupAdapter = options.setup ?? gitSetupAdapter({ gitExecutable });
  const deliveryAdapter = options.delivery ?? githubDeliveryAdapter(undefined, gitExecutable);
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
          ? `${prompt}\n\n${sourceReviewerReportPrompt(
              (await json(item.source.stateDirectory, "candidate")).changed,
            )}\n`
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
    recordPrefix = "",
  ) => {
    for (const role of ["author", "reviewer"] as const) {
      const attempt = await adapterOptional(directory, `${recordPrefix}${role}-attempt`);
      let terminal = await adapterOptional(directory, `${recordPrefix}${role}-terminal`);
      if (
        recordPrefix === "" &&
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
      if (role === "reviewer") {
        await syncParticipant(
          item,
          stage,
          role,
          await adapterOptional(directory, `${recordPrefix}reviewer-retry-attempt`),
          await adapterOptional(directory, `${recordPrefix}reviewer-retry-terminal`),
        );
      }
    }
  };

  const sourceReviewDisposition = async (item: QueueItem) => {
    const [candidate, original, retry] = await Promise.all([
      adapterOptional(item.source.stateDirectory, "candidate"),
      adapterOptional(item.source.stateDirectory, "reviewer-terminal"),
      adapterOptional(item.source.stateDirectory, "reviewer-retry-terminal"),
    ]);
    const terminal = retry === ABSENT ? original : retry;
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
    const groups = participantGroups(pair, "participant-stage-history-mismatch");
    const selected = groups[0]?.at(-1);
    demand(
      groups.length === 1 && selected?.outcome === reviewerOutcome,
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

  const blockingReview = (
    candidate: Record<string, any>,
    reviewer: Record<string, any>,
    terminal: Record<string, any>,
    run: string,
    reason: string,
  ) => {
    demand(
      terminal.status === "failed" &&
        terminal.id === reviewer.id &&
        terminal.head === candidate.head &&
        SHA.test(candidate.head),
      reason,
    );
    let review;
    try {
      review = parseReview(terminal.summary, run, candidate.head);
    } catch (error) {
      throw new QueueBlocked(error instanceof RepairBlocked ? error.reason : reason);
    }
    demand(
      review.verdict === "FAIL" &&
        review.findings.some((finding) => finding.severity === "blocking"),
      reason,
    );
    return { head: candidate.head, reviewId: reviewer.id, findings: review.findings };
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
    demand(item.setup.authority.actions.includes("worktrees"), "queue-policy-drift");
    for (const actor of [item.repair.author, item.repair.reviewer])
      demand(
        exactKeys(actor, ["model", "effort", "prompt"]) &&
          [actor.model, actor.effort].every(
            (value) => typeof value === "string" && value.length > 0,
          ) &&
          typeof actor.prompt === "string" &&
          actor.prompt.length > 0,
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
    demand(
      SHA.test(candidate.head) &&
        Array.isArray(candidate.changed) &&
        candidate.changed.length > 0 &&
        candidate.changed.length <= 512 &&
        candidate.changed.every(
          (path: unknown) =>
            typeof path === "string" &&
            path.length > 0 &&
            !path.startsWith("/") &&
            !path.includes("\\") &&
            !path.split("/").includes(".."),
        ),
      "source-candidate-mismatch",
    );
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
      sourcePaths: candidate.changed,
      acceptanceCriteria: item.repair.acceptanceCriteria,
      requiredChecks: item.source.requiredChecks,
      exitReceiptWindowMs: item.source.exitReceiptWindowMs,
      history: projected,
      implementationAttempts: item.implementationAttempt + 1,
      implementationAttemptCeiling: item.implementationAttemptCeiling,
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
        exitReceiptWindowMs: partial.exitReceiptWindowMs,
        source: {
          owner: item.source.owner,
          run: item.source.run,
          pilotRevision: item.source.pilotRevision,
          requiredChecks: item.source.requiredChecks,
          exitReceiptWindowMs: item.source.exitReceiptWindowMs,
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
          await exec(gitExecutable, ["-C", executor, ...args], {
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
      if ((await adapterOptional(item.source.stateDirectory, "gate-retry")) !== ABSENT) {
        await syncParticipants(item, "source", item.source.stateDirectory);
        const { candidate, selected } = await passingSourceReview(item);
        return {
          status: "accepted",
          head: candidate.head,
          reviewId: selected.attempt.id,
          stateDirectory: item.source.stateDirectory,
        };
      }
      try {
        const result = await step(
          item.source,
          boundedNative(item, "source"),
          item.setup.pilotWorktree,
        );
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
        const reason = error instanceof Error ? error.message : "";
        if (
          [
            "reviewer-retry-exhausted",
            "exit-receipt-timeout",
            "author-temp-unavailable",
            "author-offline-pnpm-unavailable",
          ].includes(reason)
        )
          throw new QueueBlocked(reason);
        demand(reason === "reviewer-failed", "source-flow-state-unknown");
        const [candidate, selected] = await Promise.all([
          json(item.source.stateDirectory, "candidate"),
          selectedSourceReview(item.source),
        ]);
        const reviewer = selected.attempt;
        const terminal = selected.terminal;
        demand(
          terminal.status === "failed" &&
            terminal.id === reviewer.id &&
            terminal.head === candidate.head,
          "source-review-state-unknown",
        );
        await acceptedPair(item, "source", "failed");
        return {
          status: "fixable-review",
          ...blockingReview(
            candidate,
            reviewer,
            terminal,
            item.source.run,
            "source-review-state-unknown",
          ),
        };
      }
    },
    async repair(item): Promise<QueueRepairResult> {
      assertItem(item);
      if ((await adapterOptional(item.repair.stateDirectory, "gate-retry")) !== ABSENT) {
        await syncParticipants(item, "repair", item.repair.stateDirectory);
        const [completed, selected] = await Promise.all([
          json(item.repair.stateDirectory, "repair-complete"),
          selectedSourceReview({ stateDirectory: item.repair.stateDirectory }),
        ]);
        const review = parseReview(selected.terminal.summary, item.source.run, completed.head);
        demand(
          selected.terminal.status === "passed" &&
            selected.terminal.head === completed.head &&
            review.verdict === "PASS",
          "repair-review-state-unknown",
        );
        return {
          status: "accepted",
          head: completed.head,
          reviewId: selected.attempt.id,
          stateDirectory: item.repair.stateDirectory,
        };
      }
      try {
        const repair = await buildRepair(item);
        const result = await repairStep(
          repair,
          options.repair ?? reviewedRepairAdapter(boundedNative(item, "repair"), gitExecutable),
          selectedRepairPolicy,
        );
        await syncParticipants(item, "repair", item.repair.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return { status: result.status };
        demand(result.status === "awaiting-delivery", "unexpected-repair-status");
        await acceptedPair(item, "repair", "passed");
        const reviewer = (
          await selectedSourceReview({ stateDirectory: item.repair.stateDirectory })
        ).attempt;
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
        const reason =
          error instanceof RepairBlocked
            ? error.reason
            : error instanceof Error
              ? error.message
              : "";
        if (["delta-review-failed", "reviewer-failed"].includes(reason)) {
          const [candidate, selected] = await Promise.all([
            json(item.repair.stateDirectory, "candidate"),
            selectedSourceReview({ stateDirectory: item.repair.stateDirectory }),
          ]);
          await acceptedPair(item, "repair", "failed");
          return {
            status: "failed",
            ...blockingReview(
              candidate,
              selected.attempt as unknown as Record<string, any>,
              selected.terminal as unknown as Record<string, any>,
              item.source.run,
              "repair-review-state-unknown",
            ),
          };
        }
        throw new QueueBlocked(
          error instanceof RepairBlocked ? error.reason : "repair-state-unknown",
        );
      }
    },
    async delivery(item, accepted): Promise<QueueDeliveryResult> {
      assertItem(item);
      const stage = samePath(accepted.stateDirectory, item.source.stateDirectory)
        ? "source"
        : "repair";
      const deliveryConfig = (current: typeof accepted): DeliveryConfig => ({
        run: item.source.run,
        issue: item.issue,
        repository: item.source.repository,
        controllerRoot: config.controllerRoot,
        controllerRevision: config.controllerRevision,
        worktree: item.source.worktree,
        reviewWorktree: item.source.reviewWorktree,
        stateDirectory: current.stateDirectory,
        candidateHead: current.head,
        ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
        requiredChecks: item.delivery.requiredChecks,
        authority: {
          schemaVersion: "dogfood-delivery-authority/v1",
          controller: config.authority.controller,
          run: item.source.run,
          repository: item.source.repository,
          controllerRevision: config.controllerRevision,
          head: current.head,
          ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
          actions: ["gates", "mirror", "publish", "merge", "cleanup"],
        },
        policy: item.delivery.policy,
      });
      try {
        let current = accepted;
        let retry = await adapterOptional(accepted.stateDirectory, "gate-retry");
        const deliveryPrepared =
          (await adapterOptional(accepted.stateDirectory, "delivery-config")) !== ABSENT;
        let result;
        if (retry === ABSENT) {
          const delivery = deliveryConfig(current);
          await assertExecutor(delivery, executingRoot, gitExecutable);
          result = await deliveryStep(delivery, deliveryAdapter, deliveryPolicy);
          if (result.status === "correcting-gate") retry = result;
        }
        if (retry !== ABSENT) {
          const gateConfig: SourceConfig = {
            ...item.source,
            base: retry.head,
            stateDirectory: accepted.stateDirectory,
            author: {
              ...item.source.author,
              prompt: `${item.source.author.prompt}\n\nCorrect the ${retry.gate} gate failure on this same branch. The gate output was:\n${retry.output}`,
            },
          };
          if (!deliveryPrepared) {
            try {
              const correction = await gateCorrectionStep(
                gateConfig,
                boundedNative(item, stage),
                item.setup.pilotWorktree,
              );
              await syncParticipants(item, stage, accepted.stateDirectory, "gate-retry-");
              if (
                correction.status === "observing-author" ||
                correction.status === "observing-reviewer"
              )
                return { status: correction.status };
              demand(correction.status === "awaiting-publication", "gate-correction-state-unknown");
            } catch (error) {
              await syncParticipants(item, stage, accepted.stateDirectory, "gate-retry-");
              const reason = error instanceof Error ? error.message : "";
              if (
                [
                  "reviewer-retry-exhausted",
                  "exit-receipt-timeout",
                  "author-temp-unavailable",
                  "author-offline-pnpm-unavailable",
                ].includes(reason)
              )
                throw new QueueBlocked(reason);
              demand(reason === "reviewer-failed", "gate-correction-state-unknown");
              const [candidate, selected] = await Promise.all([
                json(accepted.stateDirectory, "gate-retry-candidate"),
                selectedSourceReview(gateConfig, "gate-retry-"),
              ]);
              return {
                status: "failed",
                ...blockingReview(
                  candidate,
                  selected.attempt as unknown as Record<string, any>,
                  selected.terminal as unknown as Record<string, any>,
                  item.source.run,
                  "gate-review-state-unknown",
                ),
              };
            }
          }
          const [candidate, selected] = await Promise.all([
            json(accepted.stateDirectory, "gate-retry-candidate"),
            selectedSourceReview(gateConfig, "gate-retry-"),
          ]);
          current = {
            head: candidate.head,
            reviewId: selected.attempt.id,
            stateDirectory: accepted.stateDirectory,
          };
          const delivery = deliveryConfig(current);
          await assertExecutor(delivery, executingRoot, gitExecutable);
          result = await deliveryStep(delivery, deliveryAdapter, deliveryPolicy);
        }
        demand(result !== undefined, "delivery-state-unknown");
        demand(result.status !== "correcting-gate", "gate-retry-state-unknown");
        demand(
          result.head === current.head && result.reviewId === current.reviewId,
          "delivery-source-drift",
        );
        if (result.status === "observing-hosted-checks")
          return { status: result.status, head: result.head, reviewId: result.reviewId };
        return result;
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof DeliveryBlocked ? error.reason : "delivery-state-unknown",
          error instanceof DeliveryBlocked ? error.diagnostics : undefined,
        );
      }
    },
  };
}

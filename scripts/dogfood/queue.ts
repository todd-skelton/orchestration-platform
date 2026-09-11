import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
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
import { correctGate, QueueBlocked, step } from "./flow.ts";
import type { Adapter, Attempt, Config as SourceConfig, Role } from "./flow.js";
export { QueueBlocked };
import {
  reviewedRepairAdapter,
  sourceReviewerReportPrompt,
  type RepairAdapter,
  type RepairConfig,
  type RepairHandoff,
} from "./repair-adapter.mjs";
import {
  RepairBlocked,
  parseReview,
  type ReviewFinding,
  type ValidatedReview,
  validateLocations,
} from "./repair-policy.mjs";
import { selfDeliveryPolicy } from "./self-delivery-policy.mjs";
import { gitSetupAdapter } from "./setup-adapter.mjs";
import { SetupBlocked, setupStep, type SetupAdapter, type SetupConfig } from "./setup.mjs";

export const QUEUE_CONFIG_SCHEMA = "dogfood-bounded-queue-config/v1" as const;
export const LOOP_CONFIG_SCHEMA = "dogfood-loop/v1" as const;
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
    author: SourceConfig["author"];
    reviewer: SourceConfig["reviewer"];
  };
  delivery: {
    requiredChecks: string[];
    policy: DeliveryConfig["policy"];
    refresh?: PublicationRefresh;
  };
}

export interface QueueConfig {
  schemaVersion: typeof QUEUE_CONFIG_SCHEMA;
  controller: string;
  run: string;
  controllerRoot: string;
  controllerRevision: string;
  stateDirectory: string;
  limit: number;
  nativeLaunchCeiling: number;
  initialHistory: QueueParticipant[];
  items: QueueItem[];
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
  "reviewer-malformed",
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
  | { status: "observing-author" | "observing-reviewer"; retries?: number }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string; retries?: number }
  | {
      status: "fixable-review";
      head: string;
      reviewId: string;
      findings: ReviewFinding[];
      retries?: number;
    };
export type QueueRepairResult =
  | { status: "observing-author" | "observing-reviewer"; retries?: number }
  | { status: "accepted"; head: string; reviewId: string; stateDirectory: string; retries?: number }
  | {
      status: "failed";
      head: string;
      reviewId: string;
      findings: ReviewFinding[];
      retries?: number;
    };
export type QueueDeliveryResult =
  | { status: "observing-author" | "observing-reviewer"; retries?: number }
  | { status: "failed"; head: string; reviewId: string; findings: ReviewFinding[] }
  | { status: "observing-hosted-checks"; head: string; reviewId: string; retries?: number }
  | Extract<DeliveryResult, { status: "complete" }>;

export interface QueueAdapter {
  assertExecutor(): Promise<void>;
  history(): Promise<QueueParticipant[]>;
  setup(item: QueueItem): Promise<{ status: "ready" | "incomplete"; reason?: string }>;
  source(item: QueueItem): Promise<QueueSourceResult>;
  repair(item: QueueItem): Promise<QueueRepairResult>;
  delivery(
    item: QueueItem,
    accepted: { head: string; reviewId: string; stateDirectory: string; retries?: number },
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

function participantWithoutUsage(participant: QueueParticipant) {
  return {
    ordinal: participant.ordinal,
    id: participant.id,
    item: participant.item,
    stage: participant.stage,
    role: participant.role,
    outcome: participant.outcome,
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
      "nativeLaunchCeiling",
      "attemptCeiling",
    ]) && config.schemaVersion === LOOP_CONFIG_SCHEMA,
    "malformed-loop-config",
  );
  demand(/^[\w.-]{1,64}$/.test(config.run) && ![".", ".."].includes(config.run), "invalid-run");
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
  schemaVersion: "dogfood-bounded-queue-attempt/v1";
  phase: "failed";
  run: string;
  index: number;
  item: string;
  issue: string;
  base: string;
  candidateAttempt: number;
  head: string;
  reviewId: string;
  findings: ReviewFinding[];
  history: QueueParticipant[];
  retries: number;
  acceptedStage: null;
  stateDirectory: null;
}

function validateFailedAttempt(
  value: unknown,
  sourceAttempt: number,
  attemptCeiling: number,
): asserts value is FailedAttemptReceipt {
  demand(
    exactKeys(value, [
      "schemaVersion",
      "phase",
      "run",
      "index",
      "item",
      "issue",
      "base",
      "candidateAttempt",
      "head",
      "reviewId",
      "findings",
      "history",
      "retries",
      "acceptedStage",
      "stateDirectory",
    ]) &&
      value.schemaVersion === "dogfood-bounded-queue-attempt/v1" &&
      value.phase === "failed" &&
      value.index === 0 &&
      Number.isSafeInteger(value.candidateAttempt) &&
      [sourceAttempt, sourceAttempt + 1].includes(value.candidateAttempt) &&
      value.candidateAttempt <= attemptCeiling &&
      SHA.test(value.head) &&
      typeof value.reviewId === "string" &&
      Array.isArray(value.findings) &&
      Array.isArray(value.history) &&
      Number.isSafeInteger(value.retries) &&
      value.retries >= 0 &&
      value.acceptedStage === null &&
      value.stateDirectory === null,
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
  validatedExecutor?: Awaited<ReturnType<typeof validateLoopExecutor>>,
) {
  demand(
    exactKeys(selected, ["key", "number", "base"]) &&
      /^ISS-\d{3}$/.test(selected.key) &&
      Number.isSafeInteger(selected.number) &&
      selected.number > 0 &&
      SHA.test(selected.base),
    "invalid-selected-issue",
  );
  validateHistory(priorHistory, config.nativeLaunchCeiling);
  const { executor, stateRoot, worktreeRoot, controllerRevision } =
    validatedExecutor ?? (await validateLoopExecutor(config, executingRoot));
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
    const priorQueue = resolve(runState, priorSlug);
    const attempt = await optionalRecord(priorQueue, "attempt");
    if (attempt === ABSENT || attempt.phase !== "failed") break;
    validateFailedAttempt(attempt, sourceAttempt, config.attemptCeiling);
    demand(
      attempt.candidateAttempt < config.attemptCeiling,
      "implementation-attempt-ceiling-exhausted",
    );
    sourceAttempt = attempt.candidateAttempt + 1;
    attemptBase = attempt.head;
    initialHistory = attempt.history;
    prescribedFindings = attempt.findings;
  }
  const slug = `${selected.key.toLowerCase()}-attempt-${sourceAttempt}`;
  const paths = {
    queue: resolve(runState, slug),
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
  const setup: SetupConfig = {
    controller,
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
    controller,
    run: config.run,
    controllerRoot: executor,
    controllerRevision,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: config.nativeLaunchCeiling,
    initialHistory,
    items: [item],
  };
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
      "controller",
      "run",
      "controllerRoot",
      "controllerRevision",
      "stateDirectory",
      "limit",
      "nativeLaunchCeiling",
      "initialHistory",
      "items",
    ]) &&
      config.schemaVersion === QUEUE_CONFIG_SCHEMA &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(config.controller) &&
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
    demand(item.base === item.source.base && item.base === item.setup.base, "queue-base-drift");
    demand(item.source.owner === config.controller, "queue-controller-drift");
    demand(
      item.source.pilotRevision === config.controllerRevision,
      "candidate-as-executor-selection",
    );
    demand(
      item.setup.controllerRoot === config.controllerRoot &&
        item.setup.controllerRevision === config.controllerRevision &&
        item.setup.pilotRevision === config.controllerRevision &&
        item.setup.controller === config.controller,
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
  const attempt = await optionalRecord(config.stateDirectory, "attempt");
  return attempt === ABSENT ? item.implementationAttempt : attempt.candidateAttempt;
}

export async function hasStartedDelivery(config: QueueConfig) {
  const attempt = await optionalRecord(config.stateDirectory, "attempt");
  return attempt !== ABSENT && ["delivery", "complete"].includes(attempt.phase);
}
async function record(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const temporary = `${path}.tmp`;
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(temporary, bytes, { flush: true });
  await rename(temporary, path);
}

type AttemptPhase = "setup" | "source" | "repair" | "delivery" | "failed" | "complete";
interface AttemptRecord {
  schemaVersion: "dogfood-bounded-queue-attempt/v1";
  phase: AttemptPhase;
  run: string;
  index: number;
  item: string;
  issue: string;
  base: string;
  candidateAttempt: number;
  head: string;
  reviewId: string | null;
  findings: ReviewFinding[];
  history: QueueParticipant[];
  retries: number;
  acceptedStage: "source" | "repair" | null;
  stateDirectory: string | null;
}

function initialAttempt(
  config: QueueConfig,
  item: QueueItem,
  index: number,
  history = config.initialHistory,
): AttemptRecord {
  return {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "setup",
    run: config.run,
    index,
    item: item.id,
    issue: item.issue,
    base: item.base,
    candidateAttempt: item.implementationAttempt,
    head: item.base,
    reviewId: null,
    findings: [],
    history,
    retries: 0,
    acceptedStage: null,
    stateDirectory: null,
  };
}

function validateAttempt(value: unknown, config: QueueConfig): asserts value is AttemptRecord {
  demand(
    object(value) &&
      value.schemaVersion === "dogfood-bounded-queue-attempt/v1" &&
      ["setup", "source", "repair", "delivery", "failed", "complete"].includes(value.phase) &&
      value.run === config.run &&
      Number.isSafeInteger(value.index) &&
      value.index >= 0 &&
      value.index < config.items.length &&
      value.item === config.items[value.index]?.id &&
      value.issue === config.items[value.index]?.issue &&
      value.base === config.items[value.index]?.base &&
      Number.isSafeInteger(value.candidateAttempt) &&
      SHA.test(value.head) &&
      (value.reviewId === null || typeof value.reviewId === "string") &&
      Array.isArray(value.findings) &&
      Array.isArray(value.history) &&
      Number.isSafeInteger(value.retries) &&
      value.retries >= 0 &&
      (["source", "repair", null] as unknown[]).includes(value.acceptedStage) &&
      (value.stateDirectory === null || typeof value.stateDirectory === "string"),
    "malformed-attempt-record",
  );
}

function advance(
  attempt: AttemptRecord,
  history: QueueParticipant[],
  fields: Partial<AttemptRecord>,
): AttemptRecord {
  return { ...attempt, ...fields, history };
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
      "retries",
    ]) && validCompletedDeliveryFields(item, delivery)
  );
}

function assertHistoryPrefix(config: QueueConfig, history: QueueParticipant[]) {
  validateHistory(history, config.nativeLaunchCeiling);
  demand(history.length >= config.initialHistory.length, "participant-history-truncated");
  demand(
    config.initialHistory.every(
      (participant, index) =>
        JSON.stringify(participantWithoutUsage(participant)) ===
        JSON.stringify(participantWithoutUsage(history[index]!)),
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
      [1, 2, 3].includes(group.length) &&
        group[0]!.role === "author" &&
        group[0]!.outcome === "passed" &&
        group.slice(1).every((participant) => participant.role === "reviewer") &&
        (group.length < 3 || group[1]!.outcome === "malformed") &&
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
  const selected = gate?.length === 2 ? gate.at(-1) : repaired ? baseRepair : sourceReview;
  demand(
    source.length >= 1 &&
      source.length <= 3 &&
      repair.length <= 3 &&
      sourceReview?.outcome === (repaired ? "failed" : "passed") &&
      (repaired ? repair.length >= 1 && baseRepair?.outcome === "passed" : repair.length === 0) &&
      !(source.length > 1 && repair.length > 1) &&
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

function attemptFailureRecord(
  config: QueueConfig,
  item: QueueItem,
  candidateAttempt: number,
  review: { head: string; reviewId: string; findings: ReviewFinding[] },
  history: QueueParticipant[],
  retries: number,
): FailedAttemptReceipt {
  return {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "failed",
    run: config.run,
    index: config.items.indexOf(item),
    item: item.id,
    issue: item.issue,
    base: item.base,
    candidateAttempt,
    head: review.head,
    reviewId: review.reviewId,
    findings: review.findings,
    history,
    retries,
    acceptedStage: null,
    stateDirectory: null,
  };
}

export async function queueStep(config: QueueConfig, adapter: QueueAdapter): Promise<QueueResult> {
  validateQueueConfig(config);
  const directory = await realpath(config.stateDirectory);
  await adapter.assertExecutor();
  const entryHistory = await adapter.history();
  assertHistoryPrefix(config, entryHistory);
  const saved = await optionalRecord(directory, "attempt");
  let attempt =
    saved === ABSENT ? initialAttempt(config, config.items[0]!, 0) : (saved as AttemptRecord);
  if (saved === ABSENT) await record(directory, "attempt", attempt);
  else validateAttempt(attempt, config);

  for (;;) {
    const item = config.items[attempt.index]!;
    if (attempt.phase === "failed") {
      demand(
        attempt.candidateAttempt < item.implementationAttemptCeiling,
        "implementation-attempt-ceiling-exhausted",
      );
      return {
        status: "advancing-attempt",
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: attempt.candidateAttempt,
      };
    }
    if (attempt.phase === "complete")
      return {
        status: "complete",
        run: config.run,
        cursor: config.items.length,
        items: config.items.length,
        participants: attempt.history.length,
      };

    if (attempt.phase === "setup") {
      const setup = await adapter.setup(item);
      demand(setup.status === "ready", setup.reason ?? "setup-incomplete");
      const history = await adapter.history();
      attempt = advance(attempt, history, { phase: "source" });
      await record(directory, "attempt", attempt);
      continue;
    }

    if (attempt.phase === "source") {
      const source = await adapter.source(item);
      const history = await adapter.history();
      if (source.status === "observing-author" || source.status === "observing-reviewer") {
        attempt = advance(attempt, history, {
          retries: Math.max(attempt.retries, source.retries ?? 0),
        });
        await record(directory, "attempt", attempt);
        return {
          status: source.status,
          run: config.run,
          item: item.id,
          issue: item.issue,
          cursor: attempt.index,
        };
      }
      if (source.status === "fixable-review") {
        assertSourceFailureHistory(history, item, source.reviewId, config.initialHistory.length);
        if (item.implementationAttempt >= item.implementationAttemptCeiling) {
          await record(
            directory,
            "attempt",
            attemptFailureRecord(
              config,
              item,
              item.implementationAttempt,
              source,
              history,
              Math.max(attempt.retries, source.retries ?? 0),
            ),
          );
          throw new QueueBlocked("implementation-attempt-ceiling-exhausted");
        }
        attempt = advance(attempt, history, {
          phase: "repair",
          candidateAttempt: item.implementationAttempt + 1,
          head: source.head,
          reviewId: source.reviewId,
          findings: source.findings,
          retries: Math.max(attempt.retries, source.retries ?? 0),
        });
        await record(directory, "attempt", attempt);
        continue;
      }
      demand(source.status === "accepted", "unexpected-source-flow-status");
      assertItemReviewHistory(history, item, false, source.reviewId, config.initialHistory.length);
      attempt = advance(attempt, history, {
        phase: "delivery",
        head: source.head,
        reviewId: source.reviewId,
        findings: [],
        acceptedStage: "source",
        stateDirectory: source.stateDirectory,
        retries: Math.max(attempt.retries, source.retries ?? 0),
      });
      await record(directory, "attempt", attempt);
      continue;
    }

    if (attempt.phase === "repair") {
      const repair = await adapter.repair(item);
      const history = await adapter.history();
      if (repair.status === "observing-author" || repair.status === "observing-reviewer") {
        attempt = advance(attempt, history, {
          retries: Math.max(attempt.retries, repair.retries ?? 0),
        });
        await record(directory, "attempt", attempt);
        return {
          status: repair.status,
          run: config.run,
          item: item.id,
          issue: item.issue,
          cursor: attempt.index,
        };
      }
      if (repair.status === "failed") {
        assertRepairFailureHistory(history, item, repair.reviewId, config.initialHistory.length);
        await record(
          directory,
          "attempt",
          attemptFailureRecord(
            config,
            item,
            attempt.candidateAttempt,
            repair,
            history,
            Math.max(attempt.retries, repair.retries ?? 0),
          ),
        );
        demand(
          attempt.candidateAttempt < item.implementationAttemptCeiling,
          "implementation-attempt-ceiling-exhausted",
        );
        return {
          status: "advancing-attempt",
          run: config.run,
          item: item.id,
          issue: item.issue,
          cursor: attempt.candidateAttempt,
        };
      }
      demand(repair.status === "accepted", "unexpected-repair-status");
      assertItemReviewHistory(history, item, true, repair.reviewId, config.initialHistory.length);
      attempt = advance(attempt, history, {
        phase: "delivery",
        head: repair.head,
        reviewId: repair.reviewId,
        findings: [],
        acceptedStage: "repair",
        stateDirectory: repair.stateDirectory,
        retries: Math.max(attempt.retries, repair.retries ?? 0),
      });
      await record(directory, "attempt", attempt);
      continue;
    }

    demand(
      attempt.phase === "delivery" &&
        attempt.reviewId !== null &&
        attempt.acceptedStage !== null &&
        attempt.stateDirectory !== null,
      "malformed-attempt-record",
    );
    const delivery = await adapter.delivery(item, {
      head: attempt.head,
      reviewId: attempt.reviewId,
      stateDirectory: attempt.stateDirectory,
      retries: attempt.retries,
    });
    const history = await adapter.history();
    if (delivery.status === "observing-author" || delivery.status === "observing-reviewer") {
      attempt = advance(attempt, history, {});
      await record(directory, "attempt", attempt);
      return {
        status: delivery.status,
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: attempt.index,
      };
    }
    if (delivery.status === "failed") {
      await record(
        directory,
        "attempt",
        attemptFailureRecord(
          config,
          item,
          attempt.candidateAttempt,
          delivery,
          history,
          attempt.retries,
        ),
      );
      demand(
        attempt.candidateAttempt < item.implementationAttemptCeiling,
        "implementation-attempt-ceiling-exhausted",
      );
      return {
        status: "advancing-attempt",
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: attempt.candidateAttempt,
      };
    }
    demand("head" in delivery && "reviewId" in delivery, "delivery-identity-drift");
    assertItemReviewHistory(
      history,
      item,
      attempt.acceptedStage === "repair",
      delivery.reviewId,
      config.initialHistory.length,
    );
    demand(
      (delivery.head === attempt.head && delivery.reviewId === attempt.reviewId) ||
        history.length > attempt.history.length,
      "delivery-identity-drift",
    );
    attempt = advance(attempt, history, {
      head: delivery.head,
      reviewId: delivery.reviewId,
      retries: delivery.retries ?? attempt.retries,
    });
    await record(directory, "attempt", attempt);
    if (delivery.status === "observing-hosted-checks")
      return {
        status: delivery.status,
        run: config.run,
        item: item.id,
        issue: item.issue,
        cursor: attempt.index,
      };
    demand(validCompletedDeliveryResult(item, delivery), "malformed-delivery-completion");
    const next = config.items[attempt.index + 1];
    attempt = next
      ? initialAttempt(config, next, attempt.index + 1, history)
      : advance(attempt, history, { phase: "complete" });
    await record(directory, "attempt", attempt);
    if (!next)
      return {
        status: "complete",
        run: config.run,
        cursor: config.items.length,
        items: config.items.length,
        participants: history.length,
      };
  }
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
  assertExecutor?: (
    config: DeliveryConfig,
    executingRoot: string,
    gitExecutable?: string,
  ) => Promise<void>;
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
  const deliveryPolicy = options.deliveryPolicy ?? selfDeliveryPolicy(gitExecutable);
  const assertExecutor = options.assertExecutor ?? assertControllerExecutor;
  const state = config.stateDirectory;

  const readHistory = async () => {
    const history: QueueParticipant[] = [];
    let gap = false;
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const participant = await optionalRecord(state, `participant-${ordinal}-terminal`);
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
        demand(normalized.ordinal === ordinal, "participant-history-unobserved");
      }
      history.push(normalized);
    }
    validateHistory(history, config.nativeLaunchCeiling);
    return history;
  };

  const seedHistory = async () => {
    for (const participant of config.initialHistory) {
      const name = `participant-${participant.ordinal}-terminal`;
      const existing = await optionalRecord(state, name);
      if (existing === ABSENT)
        await record(state, name, { ...participant, usage: queueUsage(participant.usage) });
      else
        demand(
          object(existing) && sameParticipantIdentity(existing as QueueParticipant, participant),
          "participant-history-drift",
        );
    }
  };

  const malformedReview = (summary: unknown, run: string, head: string) => {
    try {
      parseReview(summary, run, head);
      return false;
    } catch (error) {
      if (error instanceof RepairBlocked) return true;
      throw error;
    }
  };

  const boundedNative = (item: QueueItem, stage: "source" | "repair"): Adapter => ({
    ...native,
    async launch(role: Role, current: SourceConfig, prompt: string): Promise<Attempt> {
      const priorHistory = await readHistory();
      demand(priorHistory.length < config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
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
      return attempt;
    },
    async observe(role: Role, current: SourceConfig, attempt: Attempt) {
      const terminal = await native.observe(role, current, attempt);
      if (terminal.status !== "running") {
        const observed =
          role === "reviewer" &&
          ["passed", "failed"].includes(terminal.status) &&
          terminal.head &&
          malformedReview(terminal.summary, current.run, terminal.head)
            ? { ...terminal, status: "malformed" }
            : terminal;
        await syncParticipant(item, stage, role, attempt, observed);
      }
      return terminal;
    },
  });

  async function syncParticipant(
    item: QueueItem,
    stage: "source" | "repair",
    role: Role,
    attempt: any,
    terminal: any,
  ) {
    if (attempt === ABSENT || terminal === ABSENT || terminal.status === "running") return;
    const history = await readHistory();
    const existingParticipant = history.find((participant) => participant.id === attempt.id);
    const outcome: QueueParticipant["outcome"] = ["passed", "failed", "malformed"].includes(
      terminal.status,
    )
      ? terminal.status
      : "unknown";
    const participant: QueueParticipant = {
      ordinal: existingParticipant?.ordinal ?? history.length + 1,
      id: attempt.id,
      item: item.id,
      stage,
      role,
      outcome,
      usage: queueUsage(terminal.usage),
    };
    if (existingParticipant)
      demand(
        sameParticipantIdentity(existingParticipant, participant),
        "participant-terminal-drift",
      );
    else {
      demand(history.length < config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
      await record(state, `participant-${participant.ordinal}-terminal`, participant);
    }
  }

  const syncParticipants = async (
    item: QueueItem,
    stage: "source" | "repair",
    directory: string,
  ) => {
    for (const role of ["author", "reviewer"] as const) {
      const attempt = await optionalRecord(directory, `${role}-attempt`);
      let terminal = await optionalRecord(directory, `${role}-terminal`);
      if (
        stage === "source" &&
        role === "reviewer" &&
        terminal !== ABSENT &&
        ["passed", "failed"].includes(terminal.status)
      ) {
        const candidate = await optionalRecord(directory, "candidate");
        if (
          candidate !== ABSENT &&
          SHA.test(candidate.head) &&
          malformedReview(terminal.summary, item.source.run, candidate.head)
        )
          terminal = { ...terminal, status: "malformed" };
      }
      await syncParticipant(item, stage, role, attempt, terminal);
    }
  };

  const reviewPair = async (directory: string) => ({
    attempt: await json(directory, "reviewer-attempt"),
    terminal: await json(directory, "reviewer-terminal"),
  });

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

  const lineCount = (text: string) => {
    if (text.length === 0) return 0;
    const lines = text.split(/\r?\n/);
    return lines.at(-1) === "" ? lines.length - 1 : lines.length;
  };

  const checkLocations = async (
    item: QueueItem,
    candidate: Record<string, any>,
    review: ValidatedReview,
  ) => {
    try {
      const files = [...new Set(review.findings.map((finding) => finding.file))];
      const counts = await Promise.all(
        files.map(
          async (file) =>
            [
              file,
              lineCount(
                await native.git(item.source.worktree, ["show", "-z", `${candidate.head}:${file}`]),
              ),
            ] as const,
        ),
      );
      validateLocations(review, candidate as { changed: string[] }, Object.fromEntries(counts));
    } catch (error) {
      if (error instanceof RepairBlocked) throw new QueueBlocked(error.reason);
      throw new QueueBlocked("source-finding-location-outside-candidate");
    }
  };

  const passingReview = async (item: QueueItem, directory: string, reason: string) => {
    const [candidate, selected] = await Promise.all([
      json(directory, "candidate"),
      reviewPair(directory),
    ]);
    demand(
      selected.terminal.status === "passed" &&
        selected.terminal.id === selected.attempt.id &&
        selected.terminal.head === candidate.head &&
        SHA.test(candidate.head),
      reason,
    );
    let review;
    try {
      review = parseReview(selected.terminal.summary, item.source.run, candidate.head);
    } catch (error) {
      throw new QueueBlocked(error instanceof RepairBlocked ? error.reason : reason);
    }
    demand(
      review.verdict === "PASS" && review.findings.every((finding) => finding.severity === "note"),
      reason,
    );
    await checkLocations(item, candidate, review);
    return { candidate, selected, review };
  };

  const blockingReview = async (
    item: QueueItem,
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
    await checkLocations(item, candidate, review);
    return { head: candidate.head, reviewId: reviewer.id, findings: review.findings };
  };

  const buildRepair = async (
    item: QueueItem,
  ): Promise<{ repair: RepairConfig; handoff: RepairHandoff }> => {
    const [candidate, selected] = await Promise.all([
      json(item.source.stateDirectory, "candidate"),
      reviewPair(item.source.stateDirectory),
    ]);
    const source = await blockingReview(
      item,
      candidate,
      selected.attempt,
      selected.terminal,
      item.source.run,
      "source-review-state-unknown",
    );
    const history = await readHistory();
    const baseline = history.filter(
      (participant) => !(participant.item === item.id && participant.stage === "repair"),
    );
    demand(baseline.length + 2 <= config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
    const repair: RepairConfig = {
      ...item.source,
      base: candidate.head,
      stateDirectory: item.repair.stateDirectory,
      author: item.repair.author,
      reviewer: item.repair.reviewer,
    };
    return {
      repair,
      handoff: {
        mainBase: item.base,
        correctiveBase: candidate.head,
        failedReview: { findings: source.findings },
        predecessorCompleteSweep: source.reviewId,
        implementation: {
          attempts: item.implementationAttempt + 1,
          ceiling: item.implementationAttemptCeiling,
        },
        sourcePaths: candidate.changed,
        acceptanceCriteria: item.repair.acceptanceCriteria,
      },
    };
  };

  return {
    async assertExecutor() {
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
      const [controller, attemptState, ...componentStates] = roots;
      demand(
        controller !== undefined && attemptState !== undefined,
        "controller-executor-unverified",
      );
      demand(
        outside(controller, attemptState) &&
          outside(attemptState, controller) &&
          componentStates.every(
            (root, index) =>
              !outside(attemptState, root) &&
              componentStates.every(
                (other, otherIndex) => index === otherIndex || outside(root, other),
              ),
          ),
        "queue-state-overlap",
      );
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
        selectedRoots.every((root) => outside(root, attemptState) && outside(attemptState, root)),
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
      await seedHistory();
    },
    history: readHistory,
    async setup(item) {
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
      demand(
        (await optionalRecord(item.source.stateDirectory, "publication")) === ABSENT,
        "source-cannot-publish",
      );
      try {
        const result = await step(
          item.source,
          boundedNative(item, "source"),
          item.setup.pilotWorktree,
        );
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return {
            status: result.status,
            ...(result.retries ? { retries: result.retries } : {}),
          };
        demand(result.status === "awaiting-publication", "unexpected-source-flow-status");
        await acceptedPair(item, "source", "passed");
        const { candidate, selected } = await passingReview(
          item,
          item.source.stateDirectory,
          "source-review-not-accepted",
        );
        return {
          status: "accepted",
          head: candidate.head,
          reviewId: selected.attempt.id,
          stateDirectory: item.source.stateDirectory,
          ...(result.retries ? { retries: result.retries } : {}),
        };
      } catch (error) {
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (!(error instanceof QueueBlocked) || error.reason !== "reviewer-failed") {
          if (error instanceof QueueBlocked) throw error;
          throw new QueueBlocked("source-flow-state-unknown");
        }
        const [candidate, selected] = await Promise.all([
          json(item.source.stateDirectory, "candidate"),
          reviewPair(item.source.stateDirectory),
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
          ...(error.retries ? { retries: error.retries } : {}),
          ...(await blockingReview(
            item,
            candidate,
            reviewer,
            terminal,
            item.source.run,
            "source-review-state-unknown",
          )),
        };
      }
    },
    async repair(item): Promise<QueueRepairResult> {
      try {
        const { repair, handoff } = await buildRepair(item);
        const result = await (
          options.repair ??
          reviewedRepairAdapter(boundedNative(item, "repair"), config.controllerRoot)
        ).dispatch(repair, handoff);
        await syncParticipants(item, "repair", item.repair.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return {
            status: result.status,
            ...(result.retries ? { retries: result.retries } : {}),
          };
        demand(result.status === "awaiting-publication", "unexpected-repair-status");
        await acceptedPair(item, "repair", "passed");
        const { candidate, selected } = await passingReview(
          item,
          item.repair.stateDirectory,
          "repair-review-state-unknown",
        );
        return {
          status: "accepted",
          head: candidate.head,
          reviewId: selected.attempt.id,
          stateDirectory: item.repair.stateDirectory,
          ...(result.retries ? { retries: result.retries } : {}),
        };
      } catch (error) {
        try {
          await syncParticipants(item, "repair", item.repair.stateDirectory);
        } catch (historyError) {
          if (historyError instanceof QueueBlocked) throw historyError;
          throw new QueueBlocked("repair-history-state-unknown");
        }
        if (error instanceof QueueBlocked && error.reason !== "reviewer-failed") throw error;
        const reason =
          error instanceof QueueBlocked
            ? error.reason
            : error instanceof RepairBlocked
              ? error.reason
              : "";
        if (reason === "reviewer-failed") {
          const [candidate, selected] = await Promise.all([
            json(item.repair.stateDirectory, "candidate"),
            reviewPair(item.repair.stateDirectory),
          ]);
          await acceptedPair(item, "repair", "failed");
          return {
            status: "failed",
            ...(error instanceof QueueBlocked && error.retries ? { retries: error.retries } : {}),
            ...(await blockingReview(
              item,
              candidate,
              selected.attempt as unknown as Record<string, any>,
              selected.terminal as unknown as Record<string, any>,
              item.source.run,
              "repair-review-state-unknown",
            )),
          };
        }
        throw new QueueBlocked(
          error instanceof RepairBlocked ? error.reason : "repair-state-unknown",
        );
      }
    },
    async delivery(item, accepted): Promise<QueueDeliveryResult> {
      const stage = samePath(accepted.stateDirectory, item.source.stateDirectory)
        ? "source"
        : "repair";
      const reviewerAttempt = await optionalRecord(accepted.stateDirectory, "reviewer-attempt");
      const flowRetries = reviewerAttempt !== ABSENT && reviewerAttempt.retries === 1 ? 1 : 0;
      let savedAttempt = await optionalRecord(state, "attempt");
      if (savedAttempt !== ABSENT) validateAttempt(savedAttempt, config);
      let gateRetryCounted =
        savedAttempt !== ABSENT &&
        savedAttempt.phase === "delivery" &&
        savedAttempt.item === item.id &&
        savedAttempt.retries > flowRetries;
      let retries = savedAttempt === ABSENT ? (accepted.retries ?? 0) : savedAttempt.retries;
      const persistDeliveryAttempt = async (fields: Partial<AttemptRecord>) => {
        if (savedAttempt === ABSENT) return;
        demand(
          savedAttempt.phase === "delivery" &&
            savedAttempt.item === item.id &&
            savedAttempt.reviewId === accepted.reviewId &&
            savedAttempt.stateDirectory === accepted.stateDirectory,
          "delivery-source-drift",
        );
        savedAttempt = advance(savedAttempt, await readHistory(), fields);
        await record(state, "attempt", savedAttempt);
      };
      const delivery: DeliveryConfig = {
        controller: config.controller,
        run: item.source.run,
        issue: item.issue,
        repository: item.source.repository,
        controllerRoot: config.controllerRoot,
        controllerRevision: config.controllerRevision,
        worktree: item.source.worktree,
        reviewWorktree: item.source.reviewWorktree,
        stateDirectory: accepted.stateDirectory,
        candidateHead: accepted.head,
        retries: accepted.retries ?? 0,
        ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
        requiredChecks: item.delivery.requiredChecks,
        policy: item.delivery.policy,
      };
      const correctionNative = boundedNative(item, stage);
      const inlineDelivery: DeliveryAdapter = {
        ...deliveryAdapter,
        async source(current) {
          const reviewed = await optionalRecord(accepted.stateDirectory, "candidate");
          const source = await deliveryAdapter.source(
            reviewed !== ABSENT && SHA.test(reviewed.head)
              ? { ...current, candidateHead: reviewed.head }
              : current,
          );
          return { ...source, head: current.candidateHead };
        },
        async verifyWorkspace(current, head) {
          return (
            (await deliveryAdapter.verifyWorkspace(current, head)) ||
            (gateRetryCounted && head === current.candidateHead)
          );
        },
        async correctGate(current, gate, output) {
          const resuming = gateRetryCounted;
          if (!gateRetryCounted) {
            retries = (accepted.retries ?? 0) + 1;
            await persistDeliveryAttempt({ retries });
            gateRetryCounted = true;
          }
          const correctionBase = resuming
            ? await correctionNative.git(current.worktree, ["rev-parse", "HEAD"])
            : current.candidateHead;
          const correction = await correctGate(
            {
              ...item.source,
              base: correctionBase,
              stateDirectory: accepted.stateDirectory,
            },
            correctionNative,
            item.setup.pilotWorktree,
            gate,
            output,
            resuming,
          );
          await syncParticipant(item, stage, "author", correction.attempt, correction.terminal);
          await persistDeliveryAttempt({ head: correction.head, retries });
          return { head: correction.head, retries };
        },
      };
      try {
        await assertExecutor(delivery, executingRoot, gitExecutable);
        const result = await deliveryStep(delivery, inlineDelivery, deliveryPolicy);
        demand(
          result.reviewId === accepted.reviewId && result.retries >= (accepted.retries ?? 0),
          "delivery-source-drift",
        );
        if (result.status === "observing-hosted-checks")
          return {
            status: result.status,
            head: result.head,
            reviewId: result.reviewId,
            retries: result.retries,
          };
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

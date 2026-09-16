import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
<<<<<<< HEAD
import { mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
=======
import { mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
>>>>>>> 0a21eb5a446f30f921bfeca11d6a463e99700d50
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { continuationSlug, validateAcceptedReplan } from "./continuation.ts";
import type { AcceptedReplan } from "./continuation.js";
export { continuationSlug };
import { resolveRouting, validateRoutingRow, type RoutingRow } from "./routing.mjs";
import { assertControllerExecutor, githubDeliveryAdapter } from "./delivery-adapter.mjs";
import {
  DeliveryBlocked,
  LocalGateFailure,
  deliveryStep,
  hostedFailureEvidence,
  hostedFailurePrompt,
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
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { currentMain, rebaseOnto, refreshDelivery } from "./refresh.ts";
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
import { repositoryDeliveryPolicy, type RepositoryAdapter } from "./repository-adapter.mjs";
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
  routing?: import("./routing.mjs").RoutingSelection;
  models?: { author: string; reviewer: string | null };
  placement?: import("./routing.mjs").ModelPlacement;
  ordinal: number;
  id: string;
  item: string;
  stage: "source" | "repair" | "refresh";
  role: "author" | "reviewer";
  outcome: "passed" | "failed" | "unknown" | "malformed" | "dead";
  usage: QueueUsage;
}

export interface QueueItem {
  acceptedReplan?: AcceptedReplan;
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
    localBranch?: string;
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
  adapter: string;
  repository: string;
  stableExecutorRoot: string;
  stateRoot: string;
  worktreeRoot: string;
  author?: { model: string; effort: string };
  reviewer?: { model: string; effort: string };
  routingRows?: RoutingRow[];
  codexExecutable: string;
  gitExecutable: string;
  nativeLaunchCeiling: number;
  attemptCeiling: number;
  providerOutageCeilingMs?: number;
  targetMilestone?: number;
  acceptedReplan?: AcceptedReplan;
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
  "provider-unavailable",
  "native-launch-ceiling-exhausted",
  "implementation-attempt-ceiling-exhausted",
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
      "adapter",
      "repository",
      "stableExecutorRoot",
      "stateRoot",
      "worktreeRoot",
      ...(config.author === undefined ? [] : ["author"]),
      ...(config.reviewer === undefined ? [] : ["reviewer"]),
      ...(config.routingRows === undefined ? [] : ["routingRows"]),
      "codexExecutable",
      "gitExecutable",
      "nativeLaunchCeiling",
      "attemptCeiling",
      ...(config.providerOutageCeilingMs === undefined ? [] : ["providerOutageCeilingMs"]),
      ...(config.targetMilestone === undefined ? [] : ["targetMilestone"]),
      ...(config.acceptedReplan === undefined ? [] : ["acceptedReplan"]),
    ]) && config.schemaVersion === LOOP_CONFIG_SCHEMA,
    "malformed-loop-config",
  );
  demand(/^[\w.-]{1,64}$/.test(config.run) && ![".", ".."].includes(config.run), "invalid-run");
  if (config.acceptedReplan !== undefined) {
    validateAcceptedReplan(config.acceptedReplan);
    demand(
      config.run === config.acceptedReplan.targetRun &&
        config.repository === config.acceptedReplan.repository &&
        config.attemptCeiling === 4,
      "invalid-accepted-replan",
    );
    demand(
      resolve(config.acceptedReplan.priorAttemptDirectory, "..") ===
        resolve(config.stateRoot, config.acceptedReplan.priorRun),
      "invalid-accepted-replan",
    );
    if (config.acceptedReplan.preReviewEvidence) {
      const workerTemporaryRoot = resolve(
        config.stateRoot,
        config.run,
        config.acceptedReplan.attemptSlug,
        "source",
        "author-temp",
      );
      demand(
        Object.values(config.acceptedReplan.preReviewEvidence.bundle).every(
          (path) => outside(config.worktreeRoot, path) && outside(workerTemporaryRoot, path),
        ),
        "invalid-accepted-replan-evidence",
      );
    }
  }
  demand(
    config.providerOutageCeilingMs === undefined ||
      (Number.isSafeInteger(config.providerOutageCeilingMs) && config.providerOutageCeilingMs > 0),
    "invalid-provider-outage-ceiling",
  );
  demand(/^[a-z0-9][a-z0-9-]*$/.test(config.adapter), "invalid-repository-adapter");
  demand(
    config.targetMilestone === undefined ||
      (Number.isSafeInteger(config.targetMilestone) && config.targetMilestone > 0),
    "invalid-target-milestone",
  );
  demand(
    config.targetMilestone === undefined || config.adapter === "chase-sets",
    "target-milestone-unsupported-adapter",
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
  demand(config.adapter === "self" || Array.isArray(config.routingRows), "routing-table-required");
  if (config.routingRows !== undefined) {
    demand(Array.isArray(config.routingRows), "invalid-routing-table");
    const keys = new Set();
    for (const row of config.routingRows) {
      validateRoutingRow(row);
      demand(
        (row.row === "self" || (Number.isSafeInteger(row.row) && Number(row.row) > 0)) &&
          (row.row === "self" || [11, 12].includes(row.review!)),
        "invalid-routing-row",
      );
      const key = `${row.row}:${row.review}`;
      demand(!keys.has(key), "duplicate-routing-row");
      keys.add(key);
    }
  }
  for (const role of ["author", "reviewer"] as const) {
    const placement = config[role];
    if (placement === undefined) continue;
    demand(
      exactKeys(placement, ["model", "effort"]) &&
        [placement.model, placement.effort].every(
          (value) => typeof value === "string" && value.length > 0,
        ),
      `invalid-${role}`,
    );
  }
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

interface FailedAttemptReceipt {
  routing?: import("./routing.mjs").RoutingSelection;
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
  rebasedBase?: string;
  rebasedMainBase?: string;
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
      ...(object(value) && Object.hasOwn(value, "rebasedBase") ? ["rebasedBase"] : []),
      ...(object(value) && Object.hasOwn(value, "rebasedMainBase") ? ["rebasedMainBase"] : []),
      ...(object(value) && Object.hasOwn(value, "routing") ? ["routing"] : []),
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
      value.stateDirectory === null &&
      (value.rebasedBase === undefined || SHA.test(value.rebasedBase)) &&
      (value.rebasedMainBase === undefined || SHA.test(value.rebasedMainBase)) &&
      value.findings.every(
        (finding: unknown) =>
          exactKeys(finding, ["file", "line", "severity", "text"]) &&
          typeof finding.file === "string" &&
          finding.file.length > 0 &&
          finding.file.length <= 500 &&
          Number.isSafeInteger(finding.line) &&
          finding.line > 0 &&
          ["blocking", "note"].includes(finding.severity as string) &&
          typeof finding.text === "string" &&
          finding.text.length > 0 &&
          finding.text.length <= 4_000,
      ),
    "malformed-failed-attempt",
  );
}

export async function validateLoopExecutor(config: LoopConfig, executingRoot: string) {
  validateLoopConfig(config);
  const [controllerRoot, repositoryRoot] = await Promise.all([
    realpath(executingRoot),
    realpath(config.stableExecutorRoot),
  ]);
  await Promise.all([
    mkdir(config.stateRoot, { recursive: true }),
    mkdir(config.worktreeRoot, { recursive: true }),
  ]);
  const [stateRoot, worktreeRoot] = await Promise.all([
    realpath(config.stateRoot),
    realpath(config.worktreeRoot),
  ]);
  demand(
    [controllerRoot, repositoryRoot].every(
      (root) =>
        outside(root, stateRoot) &&
        outside(stateRoot, root) &&
        outside(root, worktreeRoot) &&
        outside(worktreeRoot, root),
    ) &&
      (samePath(controllerRoot, repositoryRoot) ||
        (outside(controllerRoot, repositoryRoot) && outside(repositoryRoot, controllerRoot))) &&
      outside(stateRoot, worktreeRoot) &&
      outside(worktreeRoot, stateRoot),
    "loop-roots-overlap",
  );
  const git = async (root: string, args: string[]) =>
    (
      await exec(config.gitExecutable, ["-C", root, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  const [
    controllerTop,
    controllerRevision,
    controllerStatus,
    repositoryTop,
    repositoryRevision,
    repositoryBranch,
    repositoryStatus,
    version,
  ] = await Promise.all([
    git(controllerRoot, ["rev-parse", "--show-toplevel"]),
    git(controllerRoot, ["rev-parse", "HEAD"]),
    git(controllerRoot, ["status", "--porcelain"]),
    git(repositoryRoot, ["rev-parse", "--show-toplevel"]),
    git(repositoryRoot, ["rev-parse", "HEAD"]),
    git(repositoryRoot, ["branch", "--show-current"]),
    git(repositoryRoot, ["status", "--porcelain"]),
    exec(config.gitExecutable, ["--version"], { windowsHide: true }).then((result) =>
      result.stdout.trim(),
    ),
  ]);
  demand(
    samePath(await realpath(controllerTop), controllerRoot) &&
      SHA.test(controllerRevision) &&
      controllerStatus === "",
    "unstable-executor",
  );
  demand(
    samePath(await realpath(repositoryTop), repositoryRoot) &&
      SHA.test(repositoryRevision) &&
      repositoryBranch === "main" &&
      repositoryStatus === "",
    "unstable-executor",
  );
  if (process.platform === "win32") {
    const match = /git version (\d+)\.(\d+)/.exec(version);
    demand(
      match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 53)),
      "incompatible-git",
    );
  }
  return {
    controllerRoot,
    repositoryRoot,
    stateRoot,
    worktreeRoot,
    controllerRevision,
    repositoryRevision,
  };
}

export async function queueConfigFromLoop(
  config: LoopConfig,
  executingRoot: string,
  selected: SelectedLoopIssue,
  repositoryAdapter: RepositoryAdapter,
  priorHistory: QueueParticipant[] = [],
  validatedExecutor?: Awaited<ReturnType<typeof validateLoopExecutor>>,
) {
  validateLoopConfig(config);
  demand(
    exactKeys(selected, ["key", "number", "base"]) &&
      /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(selected.key) &&
      Number.isSafeInteger(selected.number) &&
      selected.number > 0 &&
      SHA.test(selected.base),
    "invalid-selected-issue",
  );
  validateHistory(priorHistory, config.nativeLaunchCeiling);
  const {
    controllerRoot,
    repositoryRoot,
    stateRoot,
    worktreeRoot,
    controllerRevision,
    repositoryRevision,
  } = validatedExecutor ?? (await validateLoopExecutor(config, executingRoot));
  const git = async (args: string[]) =>
    (
      await exec(config.gitExecutable, ["-C", repositoryRoot, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  const gitAt = async (cwd: string, args: string[]) =>
    (
      await exec(config.gitExecutable, ["-C", cwd, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  const [selectedBase, issueContext] = await Promise.all([
    git(["rev-parse", "--verify", `${selected.base}^{commit}`]),
    repositoryAdapter.issueContext({
      repository: config.repository,
      key: selected.key,
      number: selected.number,
      executorRoot: repositoryRoot,
      ...(config.targetMilestone === undefined ? {} : { targetMilestone: config.targetMilestone }),
    }),
  ]);
  demand(selectedBase === selected.base, "selected-base-unavailable");
  demand(
    exactKeys(issueContext, [
      "title",
      "body",
      "acceptanceCriteria",
      "rules",
      ...(issueContext.routing ? ["routing"] : []),
    ]) &&
      typeof issueContext.title === "string" &&
      issueContext.title.length > 0 &&
      typeof issueContext.body === "string" &&
      issueContext.body.length > 0 &&
      Array.isArray(issueContext.acceptanceCriteria) &&
      issueContext.acceptanceCriteria.length > 0 &&
      issueContext.acceptanceCriteria.every(
        (criterion) => typeof criterion === "string" && criterion.length > 0,
      ) &&
      typeof issueContext.rules === "string" &&
      issueContext.rules.length > 0,
    "malformed-issue-context",
  );
  const issueUrl = `https://github.com/${config.repository}/issues/${selected.number}`;
  const routing = resolveRouting(config.adapter, issueContext.routing, config.routingRows);
  const author = routing?.author ?? config.author;
  const reviewer = routing?.reviewer ?? config.reviewer;
  demand(author && reviewer, "routing-row-unconfigured");
  demand(
    author.model !== reviewer.model && !/fable|terra/i.test(reviewer.model),
    "routing-reviewer-not-independent",
  );
  const promptContext = `Repository loop rules:\n\n${issueContext.rules.trim()}\n\nSelected issue ${selected.key} (#${selected.number}):\n\n${issueContext.body.trim()}`;
  const baseSourcePrompt = `Implement the selected issue completely and stay within its scope.\n\n${promptContext}`;
  let reviewerPrompt = `Review the selected issue implementation independently against every stated criterion.\n\n${promptContext}`;
  const runState = resolve(stateRoot, config.run);
  if (!config.acceptedReplan) {
    // A fresh run cannot renew an exhausted lineage already recorded on this host.
    for (const run of await readdir(stateRoot, { withFileTypes: true })) {
      if (!run.isDirectory() || run.name === config.run) continue;
      for (const sourceAttempt of [3, 4]) {
        const prior = await optionalRecord(
          resolve(stateRoot, run.name, `${selected.key.toLowerCase()}-attempt-${sourceAttempt}`),
          "attempt",
        );
        demand(
          prior === ABSENT ||
            prior.issue !== issueUrl ||
            prior.phase !== "failed" ||
            prior.candidateAttempt < 4,
          "accepted-replan-required",
        );
      }
    }
  }
  let sourceAttempt = 1;
  let attemptBase = selected.base;
  let mainBase = selected.base;
  let initialHistory: QueueParticipant[] = [...priorHistory];
  let prescribedFindings: ReviewFinding[] | undefined;
  let rejectedHead: string | undefined;
  let replan:
    | {
        publication: AcceptedReplan["publication"];
        prompt: string;
      }
    | undefined;
  let pendingRebase: { directory: string; slug: string; attempt: FailedAttemptReceipt } | undefined;
  if (config.acceptedReplan) {
    const packet = config.acceptedReplan;
    const priorReplanDirectory = packet.priorAttemptDirectory;
    demand(
      selected.key === packet.issueKey && issueUrl === packet.issueUrl,
      "accepted-replan-issue-mismatch",
    );
    const prior = await optionalRecord(priorReplanDirectory, "attempt");
    demand(prior !== ABSENT, "accepted-replan-history-unavailable");
    const priorSourceAttempt = Number(prior.item?.split(":").at(-1));
    demand(
      [packet.priorAbsoluteAttempt - 1, packet.priorAbsoluteAttempt].includes(priorSourceAttempt),
      "accepted-replan-history-unavailable",
    );
    validateFailedAttempt(prior, priorSourceAttempt, packet.priorAbsoluteAttempt);
    const priorSource = resolve(
      priorReplanDirectory,
      priorSourceAttempt < packet.priorAbsoluteAttempt ? "repair" : "source",
    );
    const publication = await optionalRecord(priorSource, "publication");
    const original = await optionalRecord(priorSource, "config");
    demand(
      prior.run === packet.priorRun &&
        prior.issue === issueUrl &&
        prior.item === `${packet.issueKey}:${priorSourceAttempt}` &&
        prior.candidateAttempt === packet.priorAbsoluteAttempt &&
        prior.head === packet.candidateHead &&
        queueDigest(prior.history) === packet.priorHistoryDigest &&
        prior.history.length > 0 &&
        prior.history.at(-1)?.item === prior.item &&
        prior.history.at(-1)?.id === prior.reviewId &&
        original !== ABSENT &&
        original.config?.repository === config.repository &&
        original.config.issue === issueUrl &&
        !original.config.correctionPaths &&
        SHA.test(original.config?.mainBase),
      "accepted-replan-history-unavailable",
    );
    if (packet.publication) {
      demand(
        publication !== ABSENT &&
          publication.repository === config.repository &&
          Object.entries(packet.publication).every(([key, value]) => publication[key] === value),
        "accepted-replan-publication-mismatch",
      );
    } else demand(publication === ABSENT, "accepted-replan-publication-mismatch");
    for (const path of packet.allowedPaths) {
      demand(
        (await git(["--literal-pathspecs", "ls-tree", "-z", packet.candidateHead, "--", path]))
          .split("\0")
          .some((line) => line.startsWith("100") && line.endsWith(`\t${path}`)),
        "accepted-replan-path-widened",
      );
    }
    // Keep the rejected head as an ancestor so the existing PR refresh is forward-only.
    demand(
      (await git(["rev-parse", "--verify", `${prior.head}^{commit}`])) === prior.head,
      "selected-base-unavailable",
    );
    const evidence = resolve(priorSource, "hosted-failure.log");
    if (packet.publication) {
      let log: string;
      try {
        log = await readFile(evidence, "utf8");
      } catch {
        throw new QueueBlocked("hosted-failure-evidence-unavailable");
      }
      demand(log.trim().length > 0, "hosted-failure-evidence-unavailable");
    }
    initialHistory = prior.history;
    demand(
      priorHistory.length === 0 || queueDigest(priorHistory) === queueDigest(initialHistory),
      "accepted-replan-history-unavailable",
    );
    validateHistory(initialHistory, config.nativeLaunchCeiling);
    sourceAttempt = packet.nextAbsoluteAttempt;
    attemptBase = prior.head;
    mainBase = original.config.mainBase;
    const prompt = `Closed continuation authorized by ${packet.authorityUrl}. Exactly one final correction at absolute attempt ${sourceAttempt}, ceiling ${packet.absoluteCeiling}, from ${prior.head}. Change only these exact files: ${JSON.stringify(packet.allowedPaths)}. Preserve product contracts and all prior implementation; do not redesign or expand scope. Read prior findings ${JSON.stringify(prior.findings)}, attempt ${resolve(priorReplanDirectory, "attempt.json")}, and source records/traces in ${priorSource}. All accumulated participants remain charged. Prior PASS is not current review authority. All local, review, hosted, merge and deployment gates remain mandatory. No further implementation or repair is authorized; any work failure parks terminally. ${packet.preReviewEvidence ? `After author PASS the executor pauses for exact-head host verification of workspace ${packet.preReviewEvidence.workspace}, gate ${packet.preReviewEvidence.gate}, before review. The reviewer must inspect only the retained snapshot linked at launch.` : ""}\n${packet.publication ? hostedFailurePrompt(evidence) : "No prior publication exists; do not infer delivery authority."}`;
    // Reserve the lineage outside both runs. Changing the packet or run cannot spend it twice.
    const claimName = `accepted-replan-${queueDigest({ repository: packet.repository, issue: packet.issueKey })}`;
    const claim = await optionalRecord(stateRoot, claimName);
    demand(
      claim === ABSENT || queueDigest(claim) === queueDigest(packet),
      "accepted-replan-already-consumed",
    );
    if (claim === ABSENT)
      await writeFile(resolve(stateRoot, `${claimName}.json`), JSON.stringify(packet), {
        flag: "wx",
        flush: true,
      });
    replan = {
      publication: packet.publication,
      prompt: `${prompt}\nAuthorized correction scope: ${packet.scope}`,
    };
    reviewerPrompt += `\n\n${replan.prompt}`;
  }
  demand(!config.acceptedReplan || replan, "accepted-replan-issue-mismatch");
  while (!replan) {
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
    rejectedHead = attempt.head;
    attemptBase = attempt.rebasedBase ?? attempt.head;
    mainBase = attempt.rebasedMainBase ?? selected.base;
    pendingRebase = attempt.rebasedBase
      ? undefined
      : { directory: priorQueue, slug: priorSlug, attempt };
    initialHistory = attempt.history;
    prescribedFindings = attempt.findings;
  }
  if (pendingRebase) {
    mainBase = await currentMain(git);
    const rebaseWorktree = resolve(worktreeRoot, `${pendingRebase.slug}-rebase-${process.pid}`);
    let added = false;
    try {
      await git(["worktree", "add", "--detach", rebaseWorktree, pendingRebase.attempt.head]);
      added = true;
      attemptBase = await rebaseOnto((args: string[]) => gitAt(rebaseWorktree, args), mainBase);
      demand(SHA.test(attemptBase), "rebase-conflict");
    } finally {
      if (added)
        try {
          await git(["worktree", "remove", "--force", rebaseWorktree]);
        } catch {}
    }
    await record(pendingRebase.directory, "attempt", {
      ...pendingRebase.attempt,
      rebasedBase: attemptBase,
      rebasedMainBase: mainBase,
    });
  }
  const slug = replan
    ? continuationSlug(config.acceptedReplan!)
    : `${selected.key.toLowerCase()}-attempt-${sourceAttempt}`;
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
  const publishedBranch = await repositoryAdapter.branchName({
    key: selected.key,
    number: selected.number,
    title: issueContext.title,
    attempt: sourceAttempt,
  });
  // ISS-151: preserve saved setup names, including attempts created before run scoping.
  const savedSetup = await optionalRecord(paths.setup, "setup-plan");
  const sourceBranch =
    savedSetup !== ABSENT
      ? savedSetup.sourceBranch
      : replan
        ? publishedBranch
        : `codex/run-${createHash("sha256").update(config.run).digest("hex")}/${slug}`;
  const [hostedChecks, localGates] = await Promise.all([
    repositoryAdapter.requiredChecks({ repository: config.repository }),
    repositoryAdapter.localGates
      ? repositoryAdapter.localGates({ repository: config.repository })
      : Promise.resolve(undefined),
  ]);
  const sourcePrompt = replan
    ? `${baseSourcePrompt}\n\n${replan.prompt}`
    : prescribedFindings
      ? `${baseSourcePrompt}\n\nStart from rejected candidate ${rejectedHead}. Apply these reviewer-prescribed fixes verbatim: ${JSON.stringify(prescribedFindings)}`
      : baseSourcePrompt;
  const setup: SetupConfig = {
    controller,
    run: config.run,
    issue: issueUrl,
    repository: config.repository,
    repositoryRoot,
    controllerRoot,
    controllerRevision,
    pilotRevision: repositoryRevision,
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
    pilotRevision: repositoryRevision,
    base: attemptBase,
    ...(sourceAttempt > 1 ? { mainBase } : {}),
    worktree: paths.sourceWorktree,
    reviewWorktree: paths.reviewWorktree,
    stateDirectory: paths.source,
    allowedPaths: ["."],
    ...(config.acceptedReplan ? { correctionPaths: config.acceptedReplan.allowedPaths } : {}),
    ...(config.acceptedReplan?.preReviewEvidence
      ? { preReviewEvidence: config.acceptedReplan.preReviewEvidence }
      : {}),
    repository: config.repository,
    requiredChecks: hostedChecks,
    ...(localGates ? { localGates } : {}),
    ...(config.providerOutageCeilingMs === undefined
      ? {}
      : { providerOutageCeilingMs: config.providerOutageCeilingMs }),
    routing: routing
      ? { row: routing.row, ...(routing.review ? { review: routing.review } : {}) }
      : { row: "self" },
    author: { ...(sourceAttempt > 1 ? (routing?.repair ?? author) : author), prompt: sourcePrompt },
    reviewer: { ...reviewer, prompt: reviewerPrompt },
    adapter: { kind: "codex-exec", executable: config.codexExecutable },
  };
  const item: QueueItem = {
    ...(replan ? { acceptedReplan: config.acceptedReplan } : {}),
    id: replan ? slug.replace(/-attempt-(\d+)$/, ":$1") : `${selected.key}:${sourceAttempt}`,
    issue: issueUrl,
    base: attemptBase,
    implementationAttempt: sourceAttempt,
    implementationAttemptCeiling: config.acceptedReplan?.absoluteCeiling ?? config.attemptCeiling,
    setup,
    source,
    repair: {
      stateDirectory: paths.repair,
      acceptanceCriteria: issueContext.acceptanceCriteria,
      author: { ...(routing?.repair ?? author), prompt: sourcePrompt },
      reviewer: { ...reviewer, prompt: reviewerPrompt },
    },
    delivery: {
      ...(sourceBranch !== publishedBranch && !replan?.publication
        ? { localBranch: sourceBranch }
        : {}),
      ...(replan?.publication
        ? {
            refresh: {
              number: replan.publication.number,
              url: replan.publication.url,
              head: replan.publication.head,
              localBranch: sourceBranch,
            },
          }
        : {}),
      requiredChecks: [...source.requiredChecks],
      policy: {
        key: selected.key,
        number: selected.number,
        title: issueContext.title,
        sourceBranch: replan?.publication?.sourceBranch ?? publishedBranch,
      },
    },
  };
  const queue: QueueConfig = {
    schemaVersion: QUEUE_CONFIG_SCHEMA,
    controller,
    run: config.run,
    controllerRoot,
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
      object(participant) &&
        participant.ordinal === index + 1 &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(participant.id) &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(participant.item) &&
        ["source", "repair", "refresh"].includes(participant.stage) &&
        ["author", "reviewer"].includes(participant.role) &&
        ["passed", "failed", "unknown", "malformed", "dead"].includes(participant.outcome) &&
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
        ...(item.acceptedReplan === undefined ? [] : ["acceptedReplan"]),
      ]) &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(item.id) &&
        typeof item.issue === "string" &&
        item.issue.length > 0 &&
        SHA.test(item.base) &&
        Number.isSafeInteger(item.implementationAttempt) &&
        item.implementationAttempt > 0 &&
        Number.isSafeInteger(item.implementationAttemptCeiling) &&
        item.implementationAttemptCeiling > 0 &&
        (item.acceptedReplan
          ? config.run === item.acceptedReplan.targetRun &&
            item.implementationAttempt === item.acceptedReplan.nextAbsoluteAttempt &&
            item.implementationAttemptCeiling === item.acceptedReplan.absoluteCeiling
          : item.acceptedReplan === undefined && item.implementationAttemptCeiling <= 4) &&
        item.implementationAttempt <= item.implementationAttemptCeiling,
      "malformed-queue-item",
    );
    if (item.acceptedReplan) {
      validateAcceptedReplan(item.acceptedReplan);
      demand(
        item.issue === item.acceptedReplan.issueUrl &&
          item.source.repository === item.acceptedReplan.repository &&
          item.base === item.acceptedReplan.candidateHead &&
          queueDigest(item.source.correctionPaths) ===
            queueDigest(item.acceptedReplan.allowedPaths) &&
          queueDigest(item.source.preReviewEvidence ?? null) ===
            queueDigest(item.acceptedReplan.preReviewEvidence),
        "accepted-replan-binding-mismatch",
      );
    }
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
    demand(item.source.pilotRevision === item.setup.pilotRevision, "candidate-as-pilot-selection");
    demand(
      item.setup.controllerRoot === config.controllerRoot &&
        item.setup.controllerRevision === config.controllerRevision &&
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
        object(actor) &&
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

export async function readQueueHistory(
  config: Pick<QueueConfig, "stateDirectory" | "nativeLaunchCeiling" | "initialHistory">,
) {
  const history: QueueParticipant[] = [];
  let gap = false;
  for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
    const participant = await optionalRecord(
      config.stateDirectory,
      `participant-${ordinal}-terminal`,
    );
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
  routing?: import("./routing.mjs").RoutingSelection;
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
    ...(item.source.routing ? { routing: item.source.routing } : {}),
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
    // ISS-127 still charges dead processes to the native ceiling, but they did
    // not produce author/reviewer evidence for a logical review pair.
    if (participant.outcome === "dead") continue;
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
  const refresh = history.findLast(
    (participant) =>
      participant.ordinal > priorParticipants &&
      participant.item === item.id &&
      participant.stage === "refresh",
  );
  const selected =
    refresh ?? (gate?.length === 2 ? gate.at(-1) : repaired ? baseRepair : sourceReview);
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
    ...(item.source.routing ? { routing: item.source.routing } : {}),
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

  const finalStep = async <T>(item: QueueItem, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (
        item.acceptedReplan &&
        error instanceof QueueBlocked &&
        ([
          "author-failed",
          "author-malformed",
          "author-wrong-head",
          "author-head-moved",
          "missing-candidate-commit",
          "dirty-author",
          "outside-footprint",
          "reviewer-failed",
          "reviewer-malformed",
          "reviewer-wrong-head",
          "reviewer-modified-worktree",
          "source-finding-location-outside-candidate",
          "launcher-failed",
          "operator-evidence-failed",
          "continuation-repair-not-authorized",
          "refresh-review-failed",
          "gate-correction-not-authorized",
          "conflict-resolution-failed",
          "conflict-resolution-exhausted",
          "conflict-resolution-scope-escape",
          "conflict-resolution-unsupported",
          "deploy-not-verified",
        ].includes(error.reason) ||
          error.reason.startsWith("gate-failed:") ||
          error.reason.startsWith("gate-base-failed:") ||
          error.reason.startsWith("hosted-check-failed:"))
      ) {
        const candidate = await optionalRecord(item.source.stateDirectory, "candidate");
        const refreshed =
          attempt.phase === "delivery"
            ? await optionalRecord(item.source.stateDirectory, "native-refresh")
            : ABSENT;
        const failedHead =
          refreshed !== ABSENT && SHA.test(refreshed.head)
            ? refreshed.head
            : candidate === ABSENT
              ? attempt.head
              : candidate.head;
        await record(
          directory,
          "attempt",
          attemptFailureRecord(
            config,
            item,
            item.implementationAttempt,
            {
              head: failedHead,
              reviewId: attempt.reviewId ?? "",
              findings: [
                {
                  file: item.acceptedReplan.allowedPaths[0]!,
                  line: 1,
                  severity: "blocking",
                  text: `${error.reason}: ${error.diagnostics ?? ""}`,
                },
              ],
            },
            await adapter.history(),
            Math.max(attempt.retries, error.retries),
          ),
        );
        throw new QueueBlocked(
          error.reason === "operator-evidence-failed" ? error.reason : "continuation-failed",
          error.message + (error.diagnostics ? `: ${error.diagnostics}` : ""),
        );
      }
      throw error;
    }
  };

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
      const source = await finalStep(item, () => adapter.source(item));
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
      demand(!item.acceptedReplan, "continuation-repair-not-authorized");
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
    const delivery = await finalStep(item, () =>
      adapter.delivery(item, {
        head: attempt.head,
        reviewId: attempt.reviewId!,
        stateDirectory: attempt.stateDirectory!,
        retries: attempt.retries,
      }),
    );
    const history = await adapter.history();
    if (delivery.status === "observing-author" || delivery.status === "observing-reviewer") {
      attempt = advance(attempt, history, {
        retries: Math.max(attempt.retries, delivery.retries ?? 0),
      });
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
  repository?: RepositoryAdapter;
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
  const deliveryPolicy =
    options.deliveryPolicy ??
    (options.repository
      ? repositoryDeliveryPolicy(options.repository, gitExecutable)
      : {
          async plan() {
            throw new DeliveryBlocked("repository-adapter-unavailable");
          },
        });
  const assertExecutor = options.assertExecutor ?? assertControllerExecutor;
  const state = config.stateDirectory;

  const readHistory = () => readQueueHistory(config);

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

  const correctiveEvidence = async (item: QueueItem) => {
    const predecessor = config.initialHistory.findLast(
      (participant) => participant.role === "reviewer" && participant.item !== item.id,
    );
    if (!predecessor) return "";
    const priorDirectory = resolve(
      config.stateDirectory,
      "..",
      predecessor.item.toLowerCase().replace(/:(\d+)$/, "-attempt-$1"),
    );
    const prior = await optionalRecord(priorDirectory, "attempt");
    if (prior === ABSENT || prior.phase !== "failed" || prior.issue !== item.issue) return "";
    for (const stage of ["source", "repair"]) {
      const originalDirectory = resolve(priorDirectory, stage);
      const correction = await optionalRecord(originalDirectory, "gate-correction-result");
      const acceptedDirectory =
        correction === ABSENT ? originalDirectory : resolve(originalDirectory, "gate-correction");
      const refreshed = await optionalRecord(acceptedDirectory, "native-refresh");
      const directory = refreshed === ABSENT ? acceptedDirectory : refreshed.directory;
      const publication = await optionalRecord(directory, "publication");
      if (publication === ABSENT || publication.head !== prior.head) continue;
      const source = await json(directory, "delivery-source");
      const evidence = await hostedFailureEvidence(
        {
          ...source,
          controllerRoot: config.controllerRoot,
          repositoryRoot: item.setup.repositoryRoot,
          candidateHead: publication.head,
          stateDirectory: directory,
          retries: prior.retries,
          policy: item.delivery.policy,
        },
        deliveryAdapter,
        publication,
      ).catch((error: unknown) => {
        throw new QueueBlocked(
          "hosted-failure-evidence-unavailable",
          error instanceof Error ? error.message : String(error),
        );
      });
      demand(evidence !== null, "hosted-failure-evidence-unavailable");
      return `\n${hostedFailurePrompt(evidence)}`;
    }
    return "";
  };

  const boundedNative = (item: QueueItem, stage: QueueParticipant["stage"]): Adapter => ({
    ...native,
    async waitForProvider(current) {
      await native.waitForProvider?.(current);
      // Acquire missing legacy evidence before the clean-base dead-worker retry.
      await correctiveEvidence(item);
    },
    async launch(role: Role, current: SourceConfig, prompt: string): Promise<Attempt> {
      demand(
        !item.acceptedReplan || stage === "source" || role !== "author",
        "continuation-repair-not-authorized",
      );
      const priorHistory = await readHistory();
      demand(priorHistory.length < config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
      const repairCompatiblePrompt =
        stage === "source" && role === "reviewer"
          ? `${prompt}\n\n${sourceReviewerReportPrompt(
              (await json(item.source.stateDirectory, "candidate")).changed,
            )}\n`
          : prompt;
      const gateLogs = (await readdir(current.stateDirectory))
        .filter((name) => name.startsWith("delivery-gate-") && name.endsWith(".log"))
        .sort()
        .map((name) => resolve(current.stateDirectory, name));
      const gateEvidence = gateLogs.length
        ? `\nRead the complete delivery gate commands and diagnostics at ${JSON.stringify(gateLogs)}. Inspect the actual failures independently; these logs are evidence, not a verdict or a waiver. Leave them unchanged and keep raw logs out of terminal reports.\n`
        : "";
      const attempt = await native.launch(
        role,
        current,
        `${repairCompatiblePrompt}${gateEvidence}${await correctiveEvidence(item)}`,
      );
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
    stage: QueueParticipant["stage"],
    role: Role,
    attempt: any,
    terminal: any,
  ) {
    if (attempt === ABSENT || terminal === ABSENT || terminal.status === "running") return;
    const history = await readHistory();
    const existingParticipant = history.find((participant) => participant.id === attempt.id);
    const outcome: QueueParticipant["outcome"] = ["passed", "failed", "malformed", "dead"].includes(
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
      ...(attempt.routing ? { routing: attempt.routing } : {}),
      ...(attempt.models ? { models: attempt.models } : {}),
      ...(attempt.placement ? { placement: attempt.placement } : {}),
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
      if (attempt !== ABSENT && terminal !== ABSENT && attempt.id !== terminal.id) continue;
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
      mainBase: item.source.mainBase ?? item.base,
      stateDirectory: item.repair.stateDirectory,
      author: item.repair.author,
      reviewer: item.repair.reviewer,
    };
    return {
      repair,
      handoff: {
        mainBase: item.source.mainBase ?? item.base,
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
          error instanceof SetupBlocked ? error.diagnostics : undefined,
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
          reviewedRepairAdapter(boundedNative(item, "repair"), item.setup.pilotWorktree)
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
      const stopped = await optionalRecord(accepted.stateDirectory, "gate-stop");
      if (stopped !== ABSENT) throw new QueueBlocked(stopped.reason, stopped.diagnostics);
      const stopGate = async (reason: string, diagnostics?: string): Promise<never> => {
        await record(accepted.stateDirectory, "gate-stop", {
          reason,
          ...(diagnostics ? { diagnostics } : {}),
        });
        throw new QueueBlocked(reason, diagnostics);
      };
      const flowAttempts = await Promise.all(
        ["author", "reviewer"].map((role) =>
          optionalRecord(accepted.stateDirectory, `${role}-attempt`),
        ),
      );
      const flowRetries = flowAttempts.some(
        (attempt) => attempt !== ABSENT && attempt.retries === 1,
      )
        ? 1
        : 0;
      const savedAttempt = await optionalRecord(state, "attempt");
      if (savedAttempt !== ABSENT) validateAttempt(savedAttempt, config);
      const previousRefresh = await optionalRecord(accepted.stateDirectory, "native-refresh");
      const legacyCorrectionUsed =
        savedAttempt !== ABSENT &&
        savedAttempt.retries >
          Math.max(flowRetries, previousRefresh !== ABSENT && previousRefresh.flowRetried ? 1 : 0);
      const correctionRecord = await optionalRecord(accepted.stateDirectory, "gate-correction");
      let delivery: DeliveryConfig = {
        controller: config.controller,
        run: item.source.run,
        issue: item.issue,
        repository: item.source.repository,
        controllerRoot: config.controllerRoot,
        repositoryRoot: item.setup.repositoryRoot,
        controllerRevision: config.controllerRevision,
        worktree: item.source.worktree,
        reviewWorktree: item.source.reviewWorktree,
        stateDirectory: accepted.stateDirectory,
        candidateHead: accepted.head,
        retries: accepted.retries ?? 0,
        ...(item.delivery.localBranch ? { localBranch: item.delivery.localBranch } : {}),
        ...(item.delivery.refresh ? { refresh: item.delivery.refresh } : {}),
        requiredChecks: item.delivery.requiredChecks,
        policy: item.delivery.policy,
      };
      // The accepted source stays immutable. Each refreshed head owns new gate/review records.
      const originalCandidate = await json(accepted.stateDirectory, "candidate");
      await assertExecutor(delivery, executingRoot, gitExecutable);
      const originalConfig = await json(accepted.stateDirectory, "config");
      const originalEvidence = await deliveryAdapter.source({
        ...delivery,
        candidateHead: originalCandidate.head,
      });
      let sourceConfig: SourceConfig = originalConfig.config;
      let sourceEvidence = originalEvidence;
      delivery.candidateHead = originalCandidate.head;
      if (correctionRecord !== ABSENT) {
        const correction = correctionRecord;
        let completed = await optionalRecord(accepted.stateDirectory, "gate-correction-result");
        if (completed === ABSENT) {
          let result;
          try {
            result = await correctGate(
              correction.source,
              boundedNative(item, "refresh"),
              item.setup.pilotWorktree,
              correction.gate,
              correction.context,
            );
          } catch (error) {
            if (
              error instanceof QueueBlocked &&
              ["author-failed", "reviewer-failed"].includes(error.reason)
            )
              return stopGate(
                error.reason === "author-failed"
                  ? "gate-correction-failed"
                  : "gate-correction-review-failed",
                error.diagnostics,
              );
            if (
              error instanceof QueueBlocked &&
              [
                "native-launch-ceiling-exhausted",
                "provider-model-refused",
                "launcher-failed",
                "reviewer-malformed",
              ].includes(error.reason)
            )
              return stopGate(error.reason, error.diagnostics);
            throw error;
          }
          if (result.status === "observing-author" || result.status === "observing-reviewer")
            return { status: result.status, retries: correction.delivery.retries + 1 };
          demand(result.status === "awaiting-publication", "gate-correction-failed");
          const pair = await passingReview(
            item,
            correction.directory,
            "gate-correction-review-failed",
          );
          demand(
            pair.candidate.head !== correction.failedHead &&
              (await native.git(delivery.worktree, [
                "merge-base",
                correction.failedHead,
                pair.candidate.head,
              ])) === correction.failedHead,
            "gate-correction-failed",
          );
          completed = {
            head: pair.candidate.head,
            reviewId: pair.selected.attempt.id,
            retries: correction.delivery.retries + 1 + (result.retries && !flowRetries ? 1 : 0),
          };
          await record(accepted.stateDirectory, "gate-correction-result", completed);
        }
        delivery = {
          ...correction.delivery,
          controllerRevision: config.controllerRevision,
          stateDirectory: correction.directory,
          candidateHead: completed.head,
          retries: completed.retries,
        };
        sourceConfig = (await json(correction.directory, "config")).config;
        sourceEvidence = await deliveryAdapter.source(delivery);
        demand(
          sourceEvidence.reviewId === completed.reviewId &&
            sourceEvidence.reviewId !== correction.previousReview,
          "gate-correction-review-failed",
        );
      }
      const refreshed = await refreshDelivery(
        delivery,
        sourceConfig,
        sourceEvidence,
        boundedNative(item, "refresh"),
        item.setup.pilotWorktree,
        flowRetries,
        deliveryAdapter,
        previousRefresh !== ABSENT && previousRefresh.resolutionUsed === true,
      );
      if (refreshed.status !== "ready") return refreshed;
      delivery = refreshed.config;
      const refreshedSource = refreshed.evidence;
      if (
        delivery.stateDirectory !== accepted.stateDirectory &&
        (await optionalRecord(delivery.stateDirectory, "cleanup")) === ABSENT
      )
        await passingReview(item, delivery.stateDirectory, "refresh-review-not-accepted");
      const inlineDelivery: DeliveryAdapter = {
        ...deliveryAdapter,
        async source() {
          return refreshedSource;
        },
      };
      try {
        await assertExecutor(delivery, executingRoot, gitExecutable);
        const result = await deliveryStep(delivery, inlineDelivery, deliveryPolicy);
        demand(result.reviewId === refreshedSource.reviewId, "delivery-source-drift");
        if (result.status === "failed") return result;
        demand(result.retries >= (accepted.retries ?? 0), "delivery-source-drift");
        if (result.status === "observing-hosted-checks")
          return {
            status: result.status,
            head: result.head,
            reviewId: result.reviewId,
            retries: result.retries,
          };
        if (options.repository)
          await options.repository.afterMerge({
            config: { ...delivery, candidateHead: result.head, retries: result.retries },
            delivery: result,
          });
        return result;
      } catch (error) {
        if (error instanceof LocalGateFailure) {
          const failure = error.evidence;
          if (!failure || failure.cause !== "diagnostic" || !deliveryAdapter.attributeGate)
            return stopGate(error.reason, error.diagnostics);
          const currentSource = (await json(delivery.stateDirectory, "config"))
            .config as SourceConfig;
          const main = currentSource.mainBase ?? currentSource.base;
          let attribution = await optionalRecord(delivery.stateDirectory, "gate-attribution");
          if (attribution === ABSENT) {
            attribution = {
              ...(await deliveryAdapter.attributeGate(delivery, error.gate, failure, main)),
              head: delivery.candidateHead,
              gate: error.gate,
              evidence: failure,
            };
            await record(delivery.stateDirectory, "gate-attribution", attribution);
          }
          if (attribution.cause !== "candidate")
            return stopGate(
              `gate-${attribution.cause === "base" ? "base-failed" : attribution.cause === "host" ? "host-failed" : "attribution-unknown"}:${error.gate}`,
              `Failed head ${delivery.candidateHead}, delivery main ${main}; diagnostics ${failure.log}; control ${attribution.log}`,
            );
          if (correctionRecord !== ABSENT || legacyCorrectionUsed)
            return stopGate(`gate-correction-exhausted:${error.gate}`, failure.log);
          if (item.acceptedReplan) return stopGate("gate-correction-not-authorized", failure.log);
          const directory = resolve(accepted.stateDirectory, "gate-correction");
          const context = `Failed exact reviewed head: ${delivery.candidateHead}; delivery main base: ${main}; predecessor complete review: ${refreshedSource.reviewId}. Exact failed command: ${JSON.stringify(failure.command)}. Full diagnostic artifact: ${failure.log}; failing identities/diagnostics: ${JSON.stringify(failure.diagnostics)}. Base control and attribution: ${resolve(delivery.stateDirectory, "gate-attribution.json")}. Original acceptance and preserved author/reviewer records and captured traces: ${accepted.stateDirectory}; predecessor delivery and review records: ${delivery.stateDirectory}. Read both directories' config, candidate, author/reviewer attempt and terminal files and the trace paths they name. Start from the failed head, retain the full implementation diff against main, and correct only this failure and its direct causes. All original acceptance criteria remain mandatory.`;
          await mkdir(directory, { recursive: true });
          await record(accepted.stateDirectory, "gate-correction", {
            failedHead: delivery.candidateHead,
            main,
            previousReview: refreshedSource.reviewId,
            gate: error.gate,
            directory,
            context,
            delivery,
            source: {
              ...currentSource,
              base: delivery.candidateHead,
              mainBase: main,
              stateDirectory: directory,
              author: { ...item.source.author, ...item.repair.author },
              reviewer: {
                ...item.source.reviewer,
                ...(await json(delivery.stateDirectory, "reviewer-attempt")).placement,
              },
            },
          });
          return { status: "observing-author", retries: delivery.retries + 1 };
        }

        if (error instanceof DeliveryBlocked && error.reason === "published-candidate-conflict") {
          if ((await optionalRecord(delivery.stateDirectory, "publication-conflict")) === ABSENT)
            await record(delivery.stateDirectory, "publication-conflict", {
              head: delivery.candidateHead,
            });
          return {
            status: "observing-hosted-checks",
            head: delivery.candidateHead,
            reviewId: refreshedSource.reviewId,
            retries: delivery.retries,
          };
        }
        if (
          error instanceof DeliveryBlocked &&
          (error.reason.startsWith("gate-host-failed:") ||
            error.reason.startsWith("gate-attribution-unknown:"))
        )
          return stopGate(error.reason, error.diagnostics);
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof DeliveryBlocked ? error.reason : "delivery-state-unknown",
          error instanceof DeliveryBlocked ? error.diagnostics : undefined,
        );
      }
    },
  };
}

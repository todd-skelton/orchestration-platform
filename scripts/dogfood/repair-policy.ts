import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export const MAX_REVIEW_SUMMARY_LENGTH = 2_000;

const SHA = /^[a-f0-9]{40}$/;
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const REPORT_KEYS = ["run", "role", "head", "verdict", "findings", "g0"];

export class RepairBlocked extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new RepairBlocked(reason);
}
const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const bounded = (value: unknown, maximum: number) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\u0000-\u001f\u007f]/.test(value);
const strings = (value: unknown, maximumItems: number, maximumLength: number) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= maximumItems &&
  value.every((item) => bounded(item, maximumLength)) &&
  new Set(value).size === value.length;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const repairDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface RepairActor {
  model: string;
  effort: string;
  prompt: string;
}
export interface ParticipantHistory {
  ordinal: number;
  id: string;
  role: "author" | "reviewer";
  outcome: "passed" | "failed" | "unknown" | "malformed";
  usage:
    | { status: "unavailable" }
    | { status: "known"; inputTokens: number; outputTokens: number; costUsd: number }
    | {
        inputTokens: { status: "unavailable" } | { status: "known"; value: number };
        outputTokens: { status: "unavailable" } | { status: "known"; value: number };
        costUsd: { status: "unavailable" } | { status: "known"; value: number };
      };
}
export interface RepairConfig {
  schemaVersion: "dogfood-repair-request/v1";
  controller: string;
  run: string;
  issue: string;
  repository: string;
  controllerRoot: string;
  controllerRevision: string;
  mainBase: string;
  repairBase: string;
  worktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  sourceStateDirectory: string;
  allowedPaths: string[];
  sourcePaths: string[];
  acceptanceCriteria: string[];
  requiredChecks: string[];
  history: ParticipantHistory[];
  implementationAttempts: number;
  implementationAttemptCeiling: number;
  admission: {
    consumed: number;
    ceiling: number;
    reservations: [{ role: "author"; ordinal: number }, { role: "reviewer"; ordinal: number }];
  };
  author: RepairActor;
  reviewer: RepairActor;
  adapter: { kind: "codex-exec"; executable: string };
}

export interface SourceReviewArtifacts {
  configRecord: { fingerprint: string; config: Record<string, any>; host: string };
  candidate: { head: string; changed: string[] };
  authorAttempt: { id: string; pid: number; trace: string; launchedAt: number };
  reviewerAttempt: { id: string; pid: number; trace: string; launchedAt: number };
  terminal: Record<string, any>;
  changedFiles: string[];
  lineCounts: Record<string, number>;
  sourceHead: string;
  reviewHead: string;
  sourceClean: boolean;
  reviewClean: boolean;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "blocking" | "note";
  text: string;
}
export interface ValidatedReview {
  run: string;
  role: "reviewer";
  head: string;
  verdict: "PASS" | "FAIL";
  findings: ReviewFinding[];
  g0: string;
}
export type ReviewReportClassification =
  { disposition: "complete"; report: ValidatedReview } | { disposition: "malformed" };
export interface RepairHandoff {
  schemaVersion: "dogfood-repair-handoff/v1";
  run: string;
  issue: string;
  repository: string;
  controller: string;
  controllerRevision: string;
  mainBase: string;
  correctiveBase: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  sourcePaths: string[];
  failedReview: {
    run: string;
    head: string;
    reviewId: string;
    authorAttempt: string;
    reviewerAttempt: string;
    disposition: "BLOCK_FIXABLE";
    verdict: "FAIL";
    g0: ValidatedReview["g0"];
    findings: ReviewFinding[];
  };
  predecessorCompleteSweep: string;
  history: ParticipantHistory[];
  implementation: { attempts: number; ceiling: number; consumedByRepair: 1 };
  admission: RepairConfig["admission"];
  author: { model: string; effort: string };
  reviewer: { model: string; effort: string };
}

function validPath(path: unknown) {
  return (
    bounded(path, 500) &&
    !(path as string).startsWith("/") &&
    !(path as string).includes("\\") &&
    !(path as string).split("/").includes("..")
  );
}

export function validRepairReviewPath(path: unknown) {
  return validPath(path) && !(path as string).endsWith("/");
}

function inFootprint(allowedPaths: string[], path: string) {
  return allowedPaths.some(
    (allowed) =>
      allowed === "." || path === allowed || (allowed.endsWith("/") && path.startsWith(allowed)),
  );
}

function validActor(actor: unknown) {
  return (
    object(actor) &&
    exactKeys(actor, ["model", "effort", "prompt"]) &&
    bounded(actor.model, 128) &&
    bounded(actor.effort, 32) &&
    typeof actor.prompt === "string" &&
    actor.prompt.length > 0 &&
    actor.prompt.length <= 50_000 &&
    !actor.prompt.includes("\0")
  );
}

function validAdapter(adapter: unknown) {
  return (
    object(adapter) &&
    exactKeys(adapter, ["kind", "executable"]) &&
    adapter.kind === "codex-exec" &&
    bounded(adapter.executable, 1_000)
  );
}

export function validateRepairConfig(config: RepairConfig) {
  demand(
    exactKeys(config, [
      "schemaVersion",
      "controller",
      "run",
      "issue",
      "repository",
      "controllerRoot",
      "controllerRevision",
      "mainBase",
      "repairBase",
      "worktree",
      "reviewWorktree",
      "stateDirectory",
      "sourceStateDirectory",
      "allowedPaths",
      "sourcePaths",
      "acceptanceCriteria",
      "requiredChecks",
      "history",
      "implementationAttempts",
      "implementationAttemptCeiling",
      "admission",
      "author",
      "reviewer",
      "adapter",
    ]) && config.schemaVersion === "dogfood-repair-request/v1",
    "malformed-repair-config",
  );
  demand(IDENTITY.test(config.controller), "malformed-repair-config");
  demand(/^[\w.-]{1,64}$/.test(config.run), "malformed-repair-config");
  demand(
    [config.issue, config.repository].every((value) => bounded(value, 300)),
    "malformed-repair-config",
  );
  demand(
    SHA.test(config.controllerRevision) && SHA.test(config.mainBase) && SHA.test(config.repairBase),
    "malformed-repair-config",
  );
  demand(config.mainBase !== config.repairBase, "conflated-main-and-repair-base");
  demand(
    [
      config.controllerRoot,
      config.worktree,
      config.reviewWorktree,
      config.stateDirectory,
      config.sourceStateDirectory,
    ].every((path) => typeof path === "string" && isAbsolute(path)),
    "malformed-repair-paths",
  );
  demand(
    new Set([
      config.controllerRoot,
      config.worktree,
      config.reviewWorktree,
      config.stateDirectory,
      config.sourceStateDirectory,
    ]).size === 5,
    "overlapping-repair-paths",
  );
  demand(
    strings(config.allowedPaths, 64, 500) && config.allowedPaths.every(validPath),
    "malformed-repair-footprint",
  );
  demand(
    strings(config.sourcePaths, 512, 500) &&
      config.sourcePaths.every(validRepairReviewPath) &&
      new Set(config.sourcePaths).size === config.sourcePaths.length,
    "malformed-source-footprint",
  );
  demand(
    config.sourcePaths.every((path) => inFootprint(config.allowedPaths, path)),
    "malformed-source-footprint",
  );
  demand(strings(config.requiredChecks, 16, 160), "malformed-required-checks");
  demand(validAdapter(config.adapter), "unsupported-repair-adapter");
  for (const actor of [config.author, config.reviewer])
    demand(validActor(actor), "malformed-repair-actor");
  demand(
    Number.isSafeInteger(config.implementationAttempts) &&
      config.implementationAttempts > 0 &&
      config.implementationAttemptCeiling > 0 &&
      config.implementationAttemptCeiling <= 4 &&
      config.implementationAttempts <= config.implementationAttemptCeiling,
    "implementation-attempt-ceiling-exhausted",
  );
  demand(
    exactKeys(config.admission, ["consumed", "ceiling", "reservations"]) &&
      Number.isSafeInteger(config.admission.consumed) &&
      config.admission.consumed >= 0 &&
      config.admission.ceiling === config.admission.consumed + 2 &&
      Array.isArray(config.admission.reservations) &&
      config.admission.reservations.length === 2 &&
      exactKeys(config.admission.reservations[0], ["role", "ordinal"]) &&
      exactKeys(config.admission.reservations[1], ["role", "ordinal"]) &&
      config.admission.reservations[0].role === "author" &&
      config.admission.reservations[0].ordinal === config.admission.consumed + 1 &&
      config.admission.reservations[1].role === "reviewer" &&
      config.admission.reservations[1].ordinal === config.admission.consumed + 2,
    "repair-admission-exhausted",
  );
  demand(
    Array.isArray(config.history) &&
      config.history.length === config.admission.consumed &&
      config.history.length <= 64,
    "malformed-participant-history",
  );
  const identities = new Set<string>();
  for (const [index, participant] of config.history.entries()) {
    demand(
      exactKeys(participant, ["ordinal", "id", "role", "outcome", "usage"]) &&
        participant.ordinal === index + 1 &&
        IDENTITY.test(participant.id) &&
        ["author", "reviewer"].includes(participant.role) &&
        ["passed", "failed", "unknown", "malformed"].includes(participant.outcome),
      "malformed-participant-history",
    );
    demand(!identities.has(participant.id), "reused-participant-identity");
    identities.add(participant.id);
    const usage: unknown = participant.usage;
    const validMeasure = (measure: unknown, integer: boolean) => {
      if (!object(measure)) return false;
      if (exactKeys(measure, ["status"])) return measure.status === "unavailable";
      return (
        exactKeys(measure, ["status", "value"]) &&
        measure.status === "known" &&
        typeof measure.value === "number" &&
        Number.isFinite(measure.value) &&
        measure.value >= 0 &&
        (!integer || Number.isSafeInteger(measure.value))
      );
    };
    const usageRecord = object(usage) ? usage : {};
    demand(
      (exactKeys(usageRecord, ["status"]) && usageRecord.status === "unavailable") ||
        (exactKeys(usageRecord, ["status", "inputTokens", "outputTokens", "costUsd"]) &&
          usageRecord.status === "known" &&
          [usageRecord.inputTokens, usageRecord.outputTokens].every(
            (value) => Number.isSafeInteger(value) && value >= 0,
          ) &&
          typeof usageRecord.costUsd === "number" &&
          Number.isFinite(usageRecord.costUsd) &&
          usageRecord.costUsd >= 0) ||
        (exactKeys(usageRecord, ["inputTokens", "outputTokens", "costUsd"]) &&
          validMeasure(usageRecord.inputTokens, true) &&
          validMeasure(usageRecord.outputTokens, true) &&
          validMeasure(usageRecord.costUsd, false)),
      "malformed-participant-usage",
    );
  }
}

export function parseReview(summary: unknown, expectedRun: string, expectedHead: string) {
  demand(
    typeof summary === "string" && summary.length <= MAX_REVIEW_SUMMARY_LENGTH,
    "source-review-summary-out-of-bounds",
  );
  let report: unknown;
  try {
    report = JSON.parse(summary);
  } catch {
    throw new RepairBlocked("malformed-source-review-report");
  }
  const parsed = report as Record<string, any>;
  demand(
    exactKeys(parsed, REPORT_KEYS) &&
      parsed.run === expectedRun &&
      parsed.role === "reviewer" &&
      parsed.head === expectedHead &&
      ["PASS", "FAIL"].includes(parsed.verdict) &&
      Array.isArray(parsed.findings) &&
      bounded(parsed.g0, MAX_REVIEW_SUMMARY_LENGTH),
    "malformed-source-review-report",
  );
  for (const finding of parsed.findings)
    demand(
      exactKeys(finding, ["file", "line", "severity", "text"]) &&
        validPath(finding.file) &&
        Number.isSafeInteger(finding.line) &&
        finding.line > 0 &&
        ["blocking", "note"].includes(finding.severity) &&
        bounded(finding.text, MAX_REVIEW_SUMMARY_LENGTH),
      "malformed-source-finding",
    );
  const blocking = parsed.findings.some(
    (finding: ReviewFinding) => finding.severity === "blocking",
  );
  demand(parsed.verdict === (blocking ? "FAIL" : "PASS"), "inconsistent-source-review-verdict");
  return parsed as unknown as ValidatedReview;
}

export function classifyReview(
  summary: unknown,
  expectedRun: string,
  expectedHead: string,
): ReviewReportClassification {
  try {
    return { disposition: "complete", report: parseReview(summary, expectedRun, expectedHead) };
  } catch (error) {
    if (!(error instanceof RepairBlocked)) throw error;
    return { disposition: "malformed" };
  }
}

function validateLocations(
  config: RepairConfig,
  artifacts: SourceReviewArtifacts,
  review: ValidatedReview,
) {
  const changed = new Set(artifacts.changedFiles);
  demand(
    artifacts.changedFiles.length > 0 &&
      artifacts.changedFiles.every((path) => inFootprint(config.allowedPaths, path)) &&
      same(artifacts.candidate.changed, artifacts.changedFiles),
    "candidate-footprint-drift",
  );
  for (const row of review.findings)
    demand(
      config.sourcePaths.includes(row.file) &&
        changed.has(row.file) &&
        Number.isSafeInteger(artifacts.lineCounts[row.file]) &&
        row.line <= artifacts.lineCounts[row.file]!,
      "source-finding-location-outside-candidate",
    );
}

export function repairPolicy() {
  return {
    prepare(
      config: RepairConfig,
      artifacts: SourceReviewArtifacts,
      requireCurrentCandidate = true,
    ): RepairHandoff {
      validateRepairConfig(config);
      demand(
        exactKeys(artifacts.configRecord, ["fingerprint", "config", "host"]) &&
          typeof artifacts.configRecord.host === "string" &&
          object(artifacts.configRecord.config),
        "source-config-mismatch",
      );
      const prior = artifacts.configRecord.config;
      demand(
        exactKeys(prior, [
          "owner",
          "run",
          "issue",
          "pilotRevision",
          "base",
          "worktree",
          "reviewWorktree",
          "stateDirectory",
          "allowedPaths",
          "repository",
          "requiredChecks",
          "author",
          "reviewer",
          "adapter",
        ]) &&
          prior.run === config.run &&
          prior.owner === config.controller &&
          prior.issue === config.issue &&
          prior.pilotRevision === config.controllerRevision &&
          prior.repository === config.repository &&
          prior.base === config.mainBase &&
          prior.worktree === config.worktree &&
          prior.reviewWorktree === config.reviewWorktree &&
          prior.stateDirectory === config.sourceStateDirectory &&
          same(prior.allowedPaths, config.allowedPaths) &&
          same(prior.requiredChecks, config.requiredChecks) &&
          validActor(prior.author) &&
          validActor(prior.reviewer) &&
          validAdapter(prior.adapter),
        "source-config-mismatch",
      );
      demand(
        exactKeys(artifacts.candidate, ["head", "changed"]) &&
          artifacts.candidate.head === config.repairBase &&
          Array.isArray(artifacts.candidate.changed),
        "source-candidate-mismatch",
      );
      if (requireCurrentCandidate)
        demand(
          artifacts.sourceHead === config.repairBase &&
            artifacts.reviewHead === config.repairBase &&
            artifacts.sourceClean &&
            artifacts.reviewClean,
          "source-workspace-not-clean-at-candidate",
        );
      demand(
        exactKeys(artifacts.authorAttempt, ["id", "pid", "trace", "launchedAt"]) &&
          exactKeys(artifacts.reviewerAttempt, ["id", "pid", "trace", "launchedAt"]) &&
          [artifacts.authorAttempt, artifacts.reviewerAttempt].every(
            (attempt) =>
              Number.isSafeInteger(attempt.pid) &&
              attempt.pid > 0 &&
              Number.isFinite(attempt.launchedAt) &&
              attempt.launchedAt > 0 &&
              typeof attempt.trace === "string" &&
              isAbsolute(attempt.trace),
          ) &&
          IDENTITY.test(artifacts.authorAttempt.id) &&
          IDENTITY.test(artifacts.reviewerAttempt.id) &&
          artifacts.authorAttempt.id !== artifacts.reviewerAttempt.id,
        "source-participant-mismatch",
      );
      const sourceAuthor = config.history.find(
        (participant) => participant.id === artifacts.authorAttempt.id,
      );
      const sourceReviewer = config.history.find(
        (participant) => participant.id === artifacts.reviewerAttempt.id,
      );
      demand(
        sourceAuthor?.role === "author" &&
          sourceAuthor.outcome === "passed" &&
          sourceReviewer?.role === "reviewer" &&
          sourceReviewer.outcome === "failed",
        "source-history-mismatch",
      );
      demand(
        object(artifacts.terminal) &&
          ["status", "id", "head", "summary"].every((key) =>
            Object.hasOwn(artifacts.terminal, key),
          ) &&
          Object.keys(artifacts.terminal).every((key) =>
            ["status", "id", "head", "summary", "usage"].includes(key),
          ) &&
          artifacts.terminal.status === "failed" &&
          artifacts.terminal.id === artifacts.reviewerAttempt.id &&
          artifacts.terminal.head === config.repairBase,
        "source-terminal-mismatch",
      );
      const review = parseReview(artifacts.terminal.summary, config.run, config.repairBase);
      demand(
        review.verdict === "FAIL" &&
          review.findings.some((finding) => finding.severity === "blocking"),
        "source-review-not-fixable-failure",
      );
      validateLocations(config, artifacts, review);
      return {
        schemaVersion: "dogfood-repair-handoff/v1",
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controller: config.controller,
        controllerRevision: config.controllerRevision,
        mainBase: config.mainBase,
        correctiveBase: config.repairBase,
        acceptanceCriteria: config.acceptanceCriteria,
        allowedPaths: config.allowedPaths,
        sourcePaths: config.sourcePaths,
        failedReview: {
          run: config.run,
          head: config.repairBase,
          reviewId: artifacts.reviewerAttempt.id,
          authorAttempt: artifacts.authorAttempt.id,
          reviewerAttempt: artifacts.reviewerAttempt.id,
          disposition: "BLOCK_FIXABLE",
          verdict: "FAIL",
          g0: review.g0,
          findings: review.findings,
        },
        predecessorCompleteSweep: artifacts.reviewerAttempt.id,
        history: config.history,
        implementation: {
          attempts: config.implementationAttempts,
          ceiling: config.implementationAttemptCeiling,
          consumedByRepair: 1,
        },
        admission: config.admission,
        author: { model: config.author.model, effort: config.author.effort },
        reviewer: { model: config.reviewer.model, effort: config.reviewer.effort },
      };
    },
    acceptDelta(
      config: RepairConfig,
      handoff: RepairHandoff,
      artifacts: SourceReviewArtifacts & { launchContext: Record<string, any> },
    ) {
      demand(
        object(artifacts.terminal) &&
          ["status", "id", "head", "summary"].every((key) =>
            Object.hasOwn(artifacts.terminal, key),
          ) &&
          Object.keys(artifacts.terminal).every((key) =>
            ["status", "id", "head", "summary", "usage"].includes(key),
          ) &&
          artifacts.terminal.status === "passed",
        "delta-review-failed",
      );
      demand(
        exactKeys(artifacts.candidate, ["head", "changed"]) &&
          SHA.test(artifacts.candidate.head) &&
          artifacts.candidate.head !== config.repairBase &&
          artifacts.sourceHead === artifacts.candidate.head &&
          artifacts.reviewHead === artifacts.candidate.head &&
          artifacts.sourceClean &&
          artifacts.reviewClean,
        "delta-workspace-not-clean-at-candidate",
      );
      demand(
        exactKeys(artifacts.authorAttempt, ["id", "pid", "trace", "launchedAt"]) &&
          exactKeys(artifacts.reviewerAttempt, ["id", "pid", "trace", "launchedAt"]) &&
          artifacts.terminal.id === artifacts.reviewerAttempt.id &&
          artifacts.terminal.head === artifacts.candidate.head &&
          artifacts.authorAttempt.id !== artifacts.reviewerAttempt.id &&
          !config.history.some((participant) =>
            [artifacts.authorAttempt.id, artifacts.reviewerAttempt.id].includes(participant.id),
          ),
        "delta-participant-mismatch",
      );
      demand(
        exactKeys(artifacts.launchContext, [
          "schemaVersion",
          "run",
          "role",
          "ordinal",
          "head",
          "model",
          "effort",
          "predecessorReviewId",
        ]) &&
          artifacts.launchContext.schemaVersion === "dogfood-repair-launch-context/v1" &&
          artifacts.launchContext.run === config.run &&
          artifacts.launchContext.role === "reviewer" &&
          artifacts.launchContext.ordinal === config.admission.reservations[1].ordinal &&
          artifacts.launchContext.head === artifacts.candidate.head &&
          artifacts.launchContext.model === config.reviewer.model &&
          artifacts.launchContext.effort === config.reviewer.effort &&
          artifacts.launchContext.predecessorReviewId === handoff.predecessorCompleteSweep,
        "delta-predecessor-mismatch",
      );
      const review = parseReview(artifacts.terminal.summary, config.run, artifacts.candidate.head);
      demand(
        review.verdict === "PASS" &&
          review.findings.every((finding) => finding.severity === "note"),
        "delta-review-not-accepted",
      );
      validateLocations(config, artifacts, review);
      return {
        review,
        head: artifacts.candidate.head,
        reviewerAttempt: artifacts.reviewerAttempt.id,
      };
    },
  };
}

export type RepairPolicy = ReturnType<typeof repairPolicy>;

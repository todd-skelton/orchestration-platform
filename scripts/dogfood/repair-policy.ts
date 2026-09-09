import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export const QUALITY_KEYS = [
  "SCOPE",
  "ROBUSTNESS",
  "DEPTH",
  "READABILITY",
  "TESTS",
  "OBSERVABILITY",
  "SECURITY",
  "PERFORMANCE",
  "ROLLOUT",
  "CONSISTENCY",
  "EXPERIENCE",
  "LANGUAGE",
] as const;
export const QUALITY_WEIGHTS = [
  "High",
  "High",
  "High",
  "Med",
  "High",
  "High",
  "High",
  "Low",
  "High",
  "High",
  "Low",
  "High",
] as const;
export const MAX_REVIEW_SUMMARY_LENGTH = 2_000;

const SHA = /^[a-f0-9]{40}$/;
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const ACTIONS = ["validate-source-review", "dispatch-author", "dispatch-delta-review"];
const REPORT_KEYS = [
  "v",
  "head",
  "complete",
  "scope",
  "profile",
  "g0",
  "pairs",
  "findings",
  "notes",
];

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
  promptFile: string;
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
export interface RepairAuthority {
  schemaVersion: "dogfood-repair-authority/v1";
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
  source: {
    owner: string;
    run: string;
    pilotRevision: string;
    requiredChecks: string[];
    author: RepairActor;
    reviewer: RepairActor;
    adapter: { kind: "codex-exec"; executable: string };
    configFingerprint: string;
    candidateHead: string;
    authorAttempt: string;
    reviewerAttempt: string;
    reviewId: string;
    disposition: "BLOCK_FIXABLE";
  };
  author: RepairActor;
  reviewer: RepairActor;
  adapter: { kind: "codex-exec"; executable: string };
  implementationAttempts: number;
  implementationAttemptCeiling: number;
  admission: {
    consumed: number;
    ceiling: number;
    reservations: [{ role: "author"; ordinal: number }, { role: "reviewer"; ordinal: number }];
  };
  historyDigest: string;
  actions: string[];
}
export interface RepairConfig {
  schemaVersion: "dogfood-repair-request/v1";
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
  admission: RepairAuthority["admission"];
  author: RepairActor;
  reviewer: RepairActor;
  adapter: { kind: "codex-exec"; executable: string };
  authority: RepairAuthority;
}

export interface SourceReviewArtifacts {
  configRecord: { fingerprint: string; config: Record<string, any>; host: string };
  candidate: { head: string; changed: string[] };
  authorAttempt: { id: string; pid: number; trace: string };
  reviewerAttempt: { id: string; pid: number; trace: string };
  terminal: Record<string, any>;
  changedFiles: string[];
  lineCounts: Record<string, number>;
  sourceHead: string;
  reviewHead: string;
  sourceClean: boolean;
  reviewClean: boolean;
}

export interface SourceReviewArtifactsWithPrompts extends SourceReviewArtifacts {
  promptContents: [string, string];
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "P0" | "P1" | "P2";
  defect: string;
  verification: string;
}
export interface ReviewNote {
  file: string;
  line: number;
  remedy: string;
}
export interface ValidatedReview {
  head: string;
  scope: "complete" | "delta";
  profile: "contract";
  g0: ["PASS" | "BLOCK_REPLAN", string];
  pairs: [string, string, string][];
  findings: ReviewFinding[];
  notes: ReviewNote[];
}
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
    verdict: "failed";
    complete: true;
    scope: "complete";
    profile: "contract";
    g0: ValidatedReview["g0"];
    pairs: ValidatedReview["pairs"];
    findings: ReviewFinding[];
    notes: ReviewNote[];
  };
  predecessorCompleteSweep: string;
  history: ParticipantHistory[];
  implementation: { attempts: number; ceiling: number; consumedByRepair: 0 };
  admission: RepairAuthority["admission"];
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
    (allowed) => path === allowed || (allowed.endsWith("/") && path.startsWith(allowed)),
  );
}

function validActor(actor: unknown) {
  return (
    object(actor) &&
    exactKeys(actor, ["model", "effort", "promptFile"]) &&
    bounded(actor.model, 128) &&
    bounded(actor.effort, 32) &&
    typeof actor.promptFile === "string" &&
    isAbsolute(actor.promptFile)
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
      "authority",
    ]) && config.schemaVersion === "dogfood-repair-request/v1",
    "malformed-repair-config",
  );
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
    strings(config.sourcePaths, 32, 500) &&
      config.sourcePaths.every(validRepairReviewPath) &&
      new Set(config.sourcePaths).size === config.sourcePaths.length,
    "malformed-source-footprint",
  );
  demand(
    config.sourcePaths.every((path) => config.allowedPaths.includes(path)),
    "malformed-source-footprint",
  );
  demand(strings(config.acceptanceCriteria, 32, 1_000), "malformed-acceptance-criteria");
  demand(strings(config.requiredChecks, 16, 160), "malformed-required-checks");
  demand(validAdapter(config.adapter), "unsupported-repair-adapter");
  for (const actor of [config.author, config.reviewer])
    demand(validActor(actor), "malformed-repair-actor");
  demand(
    Number.isSafeInteger(config.implementationAttempts) &&
      config.implementationAttempts > 0 &&
      config.implementationAttemptCeiling === 4 &&
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
  validateAuthority(config);
  const sourceAuthor = config.history.find(
    (participant) => participant.id === config.authority.source.authorAttempt,
  );
  const sourceReviewer = config.history.find(
    (participant) => participant.id === config.authority.source.reviewerAttempt,
  );
  demand(
    sourceAuthor?.role === "author" &&
      sourceAuthor.outcome === "passed" &&
      sourceReviewer?.role === "reviewer" &&
      sourceReviewer.outcome === "failed",
    "source-history-mismatch",
  );
}

function validateAuthority(config: RepairConfig) {
  const authority = config.authority;
  const boundKeys: (keyof RepairConfig & keyof RepairAuthority)[] = [
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
    "implementationAttempts",
    "implementationAttemptCeiling",
  ];
  demand(
    exactKeys(authority, [
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
      "source",
      "author",
      "reviewer",
      "adapter",
      "implementationAttempts",
      "implementationAttemptCeiling",
      "admission",
      "historyDigest",
      "actions",
    ]) &&
      authority.schemaVersion === "dogfood-repair-authority/v1" &&
      IDENTITY.test(authority.controller) &&
      boundKeys.every((key) => same(authority[key], config[key])) &&
      same(authority.allowedPaths, config.allowedPaths) &&
      same(authority.sourcePaths, config.sourcePaths) &&
      same(authority.acceptanceCriteria, config.acceptanceCriteria) &&
      same(authority.requiredChecks, config.requiredChecks) &&
      same(authority.admission, config.admission) &&
      same(authority.author, config.author) &&
      same(authority.reviewer, config.reviewer) &&
      same(authority.adapter, config.adapter) &&
      authority.historyDigest === repairDigest(config.history) &&
      same(authority.actions, ACTIONS),
    "unauthorized-repair",
  );
  demand(
    exactKeys(authority.source, [
      "owner",
      "run",
      "pilotRevision",
      "requiredChecks",
      "author",
      "reviewer",
      "adapter",
      "configFingerprint",
      "candidateHead",
      "authorAttempt",
      "reviewerAttempt",
      "reviewId",
      "disposition",
    ]) &&
      IDENTITY.test(authority.source.owner) &&
      SHA.test(authority.source.pilotRevision) &&
      strings(authority.source.requiredChecks, 16, 160) &&
      validActor(authority.source.author) &&
      validActor(authority.source.reviewer) &&
      authority.source.author.promptFile === resolve(config.sourceStateDirectory, "author.md") &&
      authority.source.reviewer.promptFile ===
        resolve(config.sourceStateDirectory, "reviewer.md") &&
      validAdapter(authority.source.adapter) &&
      /^[a-f0-9]{64}$/.test(authority.source.configFingerprint) &&
      authority.source.candidateHead === config.repairBase &&
      [
        authority.source.authorAttempt,
        authority.source.reviewerAttempt,
        authority.source.reviewId,
      ].every((value) => IDENTITY.test(value)) &&
      authority.source.authorAttempt !== authority.source.reviewerAttempt &&
      authority.source.reviewId === authority.source.reviewerAttempt &&
      authority.source.disposition === "BLOCK_FIXABLE",
    "unauthorized-source-review",
  );
}

export function parseReview(
  summary: unknown,
  expectedHead: string,
  expectedScope: "complete" | "delta",
) {
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
      parsed.v === 2 &&
      parsed.head === expectedHead &&
      parsed.complete === true &&
      parsed.scope === expectedScope &&
      parsed.profile === "contract" &&
      Array.isArray(parsed.g0) &&
      parsed.g0.length === 2 &&
      ["PASS", "BLOCK_REPLAN"].includes(parsed.g0[0]) &&
      bounded(parsed.g0[1], 200) &&
      Array.isArray(parsed.pairs) &&
      parsed.pairs.length === QUALITY_KEYS.length &&
      Array.isArray(parsed.findings) &&
      parsed.findings.length <= 8 &&
      Array.isArray(parsed.notes) &&
      parsed.notes.length <= 8,
    "malformed-source-review-report",
  );
  for (const [index, pair] of parsed.pairs.entries()) {
    demand(
      Array.isArray(pair) &&
        pair.length === 3 &&
        [pair[0], pair[1]].every((value) => ["PASS", "BLOCK", "NOTE", "NA"].includes(value)) &&
        bounded(pair[2], 140),
      "malformed-quality-verdict",
    );
    demand(!(QUALITY_WEIGHTS[index] === "Low" && pair.includes("BLOCK")), "invalid-quality-block");
    demand(!(QUALITY_WEIGHTS[index] === "Med" && pair[1] === "BLOCK"), "invalid-quality-block");
    if (pair.includes("BLOCK")) {
      const ids = Array.from({ length: parsed.findings.length }, (_, item) => `F${item + 1}`);
      demand(
        ids.some((id) => new RegExp(`\\b${id}\\b`).test(pair[2])),
        "unbound-quality-finding",
      );
    }
    if (pair.includes("NOTE")) {
      const ids = Array.from({ length: parsed.notes.length }, (_, item) => `N${item + 1}`);
      demand(
        ids.some((id) => new RegExp(`\\b${id}\\b`).test(pair[2])),
        "unbound-quality-note",
      );
    }
  }
  for (const finding of parsed.findings)
    demand(
      exactKeys(finding, ["file", "line", "severity", "defect", "verification"]) &&
        validPath(finding.file) &&
        Number.isSafeInteger(finding.line) &&
        finding.line > 0 &&
        ["P0", "P1", "P2"].includes(finding.severity) &&
        bounded(finding.defect, 350) &&
        bounded(finding.verification, 200),
      "malformed-source-finding",
    );
  for (const note of parsed.notes)
    demand(
      exactKeys(note, ["file", "line", "remedy"]) &&
        validPath(note.file) &&
        Number.isSafeInteger(note.line) &&
        note.line > 0 &&
        bounded(note.remedy, 160),
      "malformed-source-note",
    );
  const findingEvidence = parsed.pairs
    .filter((pair: string[]) => pair.includes("BLOCK"))
    .map((pair: string[]) => pair[2])
    .join(" ");
  const noteEvidence = parsed.pairs
    .filter((pair: string[]) => pair.includes("NOTE"))
    .map((pair: string[]) => pair[2])
    .join(" ");
  parsed.findings.forEach((_finding: unknown, index: number) =>
    demand(new RegExp(`\\bF${index + 1}\\b`).test(findingEvidence), "unbound-quality-finding"),
  );
  parsed.notes.forEach((_note: unknown, index: number) =>
    demand(new RegExp(`\\bN${index + 1}\\b`).test(noteEvidence), "unbound-quality-note"),
  );
  demand(
    new Set(parsed.findings.map((finding: unknown) => JSON.stringify(finding))).size ===
      parsed.findings.length,
    "duplicate-source-finding",
  );
  demand(
    new Set(parsed.notes.map((note: unknown) => JSON.stringify(note))).size === parsed.notes.length,
    "duplicate-source-note",
  );
  return parsed as unknown as ValidatedReview;
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
  for (const row of [...review.findings, ...review.notes])
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
      artifacts: SourceReviewArtifactsWithPrompts,
      requireCurrentCandidate = true,
    ): RepairHandoff {
      validateRepairConfig(config);
      const source = config.authority.source;
      demand(
        exactKeys(artifacts.configRecord, ["fingerprint", "config", "host"]) &&
          artifacts.configRecord.fingerprint === source.configFingerprint &&
          Array.isArray(artifacts.promptContents) &&
          artifacts.promptContents.length === 2 &&
          artifacts.promptContents.every((prompt) => typeof prompt === "string") &&
          repairDigest({
            config: artifacts.configRecord.config,
            prompts: artifacts.promptContents,
          }) === source.configFingerprint &&
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
          prior.run === source.run &&
          prior.owner === source.owner &&
          prior.issue === config.issue &&
          prior.pilotRevision === source.pilotRevision &&
          prior.repository === config.repository &&
          prior.base === config.mainBase &&
          prior.worktree === config.worktree &&
          prior.reviewWorktree === config.reviewWorktree &&
          prior.stateDirectory === config.sourceStateDirectory &&
          same(prior.allowedPaths, config.allowedPaths) &&
          same(prior.requiredChecks, source.requiredChecks) &&
          same(prior.author, source.author) &&
          same(prior.reviewer, source.reviewer) &&
          same(prior.adapter, source.adapter),
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
        exactKeys(artifacts.authorAttempt, ["id", "pid", "trace"]) &&
          exactKeys(artifacts.reviewerAttempt, ["id", "pid", "trace"]) &&
          [artifacts.authorAttempt, artifacts.reviewerAttempt].every(
            (attempt) =>
              Number.isSafeInteger(attempt.pid) &&
              attempt.pid > 0 &&
              typeof attempt.trace === "string" &&
              isAbsolute(attempt.trace),
          ) &&
          artifacts.authorAttempt.id === source.authorAttempt &&
          artifacts.reviewerAttempt.id === source.reviewerAttempt &&
          artifacts.authorAttempt.id !== artifacts.reviewerAttempt.id,
        "source-participant-mismatch",
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
      const review = parseReview(artifacts.terminal.summary, config.repairBase, "complete");
      demand(
        review.g0[0] === "PASS" &&
          review.findings.length > 0 &&
          review.pairs.some((pair) => pair[0] === "BLOCK" || pair[1] === "BLOCK"),
        "source-review-not-fixable-failure",
      );
      validateLocations(config, artifacts, review);
      return {
        schemaVersion: "dogfood-repair-handoff/v1",
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controller: config.authority.controller,
        controllerRevision: config.controllerRevision,
        mainBase: config.mainBase,
        correctiveBase: config.repairBase,
        acceptanceCriteria: config.acceptanceCriteria,
        allowedPaths: config.allowedPaths,
        sourcePaths: config.sourcePaths,
        failedReview: {
          run: source.run,
          head: config.repairBase,
          reviewId: source.reviewId,
          authorAttempt: source.authorAttempt,
          reviewerAttempt: source.reviewerAttempt,
          disposition: "BLOCK_FIXABLE",
          verdict: "failed",
          complete: true,
          scope: "complete",
          profile: "contract",
          g0: review.g0,
          pairs: review.pairs,
          findings: review.findings,
          notes: review.notes,
        },
        predecessorCompleteSweep: source.reviewId,
        history: config.history,
        implementation: {
          attempts: config.implementationAttempts,
          ceiling: config.implementationAttemptCeiling,
          consumedByRepair: 0,
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
        exactKeys(artifacts.authorAttempt, ["id", "pid", "trace"]) &&
          exactKeys(artifacts.reviewerAttempt, ["id", "pid", "trace"]) &&
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
      const review = parseReview(artifacts.terminal.summary, artifacts.candidate.head, "delta");
      demand(
        review.g0[0] === "PASS" &&
          review.findings.length === 0 &&
          review.pairs.every((pair) => !pair.includes("BLOCK")),
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

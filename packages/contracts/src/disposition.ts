import {
  computeDispatchPlanDigest,
  computeWorkerLaunchReceiptDigest,
  computeWorkerTerminalReceiptDigest,
  parseDispatchPlan,
  parseWorkerLaunchReceipt,
  parseWorkerTerminalReceipt,
  validateWorkerTerminalReceiptBinding,
  type DispatchPlan,
  type WorkerLaunchReceipt,
  type WorkerTerminalReceipt,
} from "./dispatch-lifecycle.js";
import {
  computeModuleActionPlanDigest,
  computeModuleDescriptorDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
  validateModulePlanBinding,
  type ModuleActionPlan,
  type ModulePlanInput,
} from "./module-plan.js";
import {
  computeProjectPreflightDigest,
  parseProjectPreflight,
  type ProjectPreflight,
} from "./project-preflight.js";
import {
  computeReviewRequestDigest,
  parseReviewRequest,
  type ReviewRequest,
} from "./review-request.js";
import {
  parseReviewAttemptResult,
  parseReviewAuthority,
  validateReviewResultBinding,
  type ReviewAttemptResult,
  type ReviewAuthority,
} from "./review-result.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseReviewSubject,
  parseWorkerResultSubject,
  type ReviewSubject,
  type WorkerResultSubject,
} from "./review-subject.js";
import {
  computeRouteSelectionDigest,
  parseRouteSelection,
  type RouteSelection,
} from "./route-selection.js";
import {
  computeRoutineStepSkipDigest,
  parseRoutineStepSkip,
  type RoutineStepSkip,
} from "./routine-step.js";
import {
  canonicalDigest,
  canonicalJson,
  closedRecord,
  frame,
  framedDigest,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const dispositionSchemaVersions = Object.freeze([
  "action-disposition/v1",
  "follow-up-cycle-request/v1",
] as const);
export const dispositionSubjectKinds = Object.freeze([
  "ACTION",
  "WORKER_RESULT",
  "RELEASE_CANDIDATE",
] as const);
export const dispositionUnknownReasons = Object.freeze([
  "INPUT_UNPROVEN",
  "RESULT_UNPROVEN",
  "AUTHORITY_UNPROVEN",
  "DISPOSITION_FAILED",
] as const);
export const dispositionSchemaFields = Object.freeze({
  disposition: Object.freeze([
    "actionPlanDigest",
    "code",
    "inputDigest",
    "outcome",
    "schemaVersion",
    "subjectDigest",
    "subjectKind",
  ] as const),
  request: Object.freeze(["cause", "intent", "schemaVersion", "sourceCycleId"] as const),
  input: Object.freeze([
    "actionPlan",
    "moduleInput",
    "preflight",
    "review",
    "route",
    "skips",
    "worker",
  ] as const),
  worker: Object.freeze(["launch", "plan", "resultSubject", "terminal"] as const),
  review: Object.freeze(["attempt", "authority", "request"] as const),
  kind: Object.freeze(["kind"] as const),
  apply: Object.freeze(["kind", "operation"] as const),
  followUp: Object.freeze(["followUp", "kind"] as const),
  unknown: Object.freeze(["kind", "reason"] as const),
  reviewIntent: Object.freeze(["kind", "moduleId", "subject"] as const),
  ordinaryIntent: Object.freeze(["kind", "moduleId", "subjectDigest", "subjectKind"] as const),
  successorIntent: Object.freeze([
    "installationId",
    "kind",
    "promotionTransactionId",
    "successorReleaseDigest",
  ] as const),
  cause: Object.freeze(["digest", "kind"] as const),
});
export const dispositionClosedValues = Object.freeze([
  "APPLY",
  "PROJECT",
  "ASSEMBLE_CERTIFY",
  "PROMOTE",
  "REVIEW_NEEDED",
  "FOLLOW_UP",
  "FAILURE",
  "NO_ACTION",
  "COMPLETE",
  "UNKNOWN",
  "REVIEW",
  "REPAIR",
  "REPLAN",
  "RETRY",
  "SUCCESSOR_VERIFICATION",
  "DISPOSITION",
  "PROMOTION",
  ...dispositionSubjectKinds,
  ...dispositionUnknownReasons,
]);

export type DispositionSubjectKind = (typeof dispositionSubjectKinds)[number];
export type FollowUpIntent =
  | Readonly<{ kind: "REVIEW"; moduleId: string; subject: ReviewSubject }>
  | Readonly<{
      kind: "REPAIR" | "REPLAN" | "RETRY";
      moduleId: string;
      subjectDigest: string;
      subjectKind: DispositionSubjectKind;
    }>
  | Readonly<{
      installationId: string;
      kind: "SUCCESSOR_VERIFICATION";
      promotionTransactionId: string;
      successorReleaseDigest: string;
    }>;
type OrdinaryFollowUpIntent = Extract<FollowUpIntent, { kind: "REPAIR" | "REPLAN" | "RETRY" }>;
export type ActionDisposition = Readonly<{
  actionPlanDigest: string;
  code: string;
  inputDigest: string;
  schemaVersion: "action-disposition/v1";
  subjectDigest: string;
  subjectKind: DispositionSubjectKind;
  outcome:
    | Readonly<{ kind: "APPLY"; operation: "PROJECT" | "ASSEMBLE_CERTIFY" | "PROMOTE" }>
    | Readonly<{ followUp: Extract<FollowUpIntent, { kind: "REVIEW" }>; kind: "REVIEW_NEEDED" }>
    | Readonly<{ followUp: OrdinaryFollowUpIntent; kind: "FOLLOW_UP" }>
    | Readonly<{ followUp: OrdinaryFollowUpIntent | null; kind: "FAILURE" }>
    | Readonly<{ kind: "NO_ACTION" | "COMPLETE" }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof dispositionUnknownReasons)[number] }>;
}>;
export type FollowUpCycleRequest = Readonly<{
  schemaVersion: "follow-up-cycle-request/v1";
  sourceCycleId: string;
}> &
  (
    | Readonly<{
        cause: Readonly<{ digest: string; kind: "DISPOSITION" }>;
        intent: Exclude<FollowUpIntent, { kind: "SUCCESSOR_VERIFICATION" }>;
      }>
    | Readonly<{
        cause: Readonly<{ digest: string; kind: "PROMOTION" }>;
        intent: Extract<FollowUpIntent, { kind: "SUCCESSOR_VERIFICATION" }>;
      }>
  );
/** Optional pure ABI input, not a new public family or installed callable admission. */
export type DispositionInput = Readonly<{
  actionPlan: ModuleActionPlan;
  moduleInput: ModulePlanInput;
  preflight: ProjectPreflight;
  review: Readonly<{
    attempt: ReviewAttemptResult | null;
    authority: ReviewAuthority;
    request: ReviewRequest;
  }> | null;
  route: RouteSelection;
  skips: readonly RoutineStepSkip[];
  worker: Readonly<{
    launch: WorkerLaunchReceipt;
    plan: DispatchPlan;
    resultSubject: WorkerResultSubject | null;
    terminal: WorkerTerminalReceipt;
  }> | null;
}>;

const fields = dispositionSchemaFields;
const invalid = (...issues: readonly string[]) => ({
  ok: false as const,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefixed = (prefix: string, issues: readonly string[]) =>
  issues.map((issue) => `${prefix}.${issue}`);
const digest = (value: JsonValue | undefined) => isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined) => isUuidV7(value) && value.length === 36;
const member = (value: JsonValue | undefined, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value);
const id = (value: JsonValue | undefined) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/.test(value);
const name = (value: JsonValue | undefined) =>
  typeof value === "string" && /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/.test(value);
function record(input: unknown): ParseResult {
  const parsed = snapshotJson(input);
  if (!parsed.ok) return parsed;
  return parsed.value !== null && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? { ok: true, value: parsed.value as ContractRecord }
    : invalid("record:object-required");
}
function nested(parsed: ParseResult, prefix: string, issues: string[]): void {
  if (!parsed.ok) issues.push(...prefixed(prefix, parsed.issues));
}

/** All five inline intents; no future cycle allocation, scheduler or promotion authority. */
export function parseFollowUpIntent(input: unknown): ParseResult<FollowUpIntent> {
  const parsed = record(input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const expected =
    row.kind === "REVIEW"
      ? fields.reviewIntent
      : member(row.kind, ["REPAIR", "REPLAN", "RETRY"])
        ? fields.ordinaryIntent
        : row.kind === "SUCCESSOR_VERIFICATION"
          ? fields.successorIntent
          : null;
  if (!expected) return invalid("kind:invalid");
  const issues = [...closedRecord(row, expected)];
  if (row.kind === "SUCCESSOR_VERIFICATION") {
    for (const key of ["installationId", "promotionTransactionId"] as const)
      if (!uuid(row[key])) issues.push(`${key}:invalid`);
    if (!digest(row.successorReleaseDigest)) issues.push("successorReleaseDigest:invalid");
  } else {
    if (!id(row.moduleId)) issues.push("moduleId:invalid");
    if (row.kind === "REVIEW") nested(parseReviewSubject(row.subject), "subject", issues);
    else {
      if (!digest(row.subjectDigest)) issues.push("subjectDigest:invalid");
      if (!member(row.subjectKind, dispositionSubjectKinds)) issues.push("subjectKind:invalid");
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as FollowUpIntent };
}

/** Complete nested shape; equality with actual supplied predecessor records is separate. */
export function parseDispositionInput(input: unknown): ParseResult<DispositionInput> {
  const parsed = snapshotClosedRecord(input, fields.input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  nested(parseModuleActionPlan(row.actionPlan), "actionPlan", issues);
  nested(parseModulePlanInput(row.moduleInput), "moduleInput", issues);
  nested(parseProjectPreflight(row.preflight), "preflight", issues);
  nested(parseRouteSelection(row.route), "route", issues);
  if (row.worker !== null) {
    const worker = snapshotClosedRecord(row.worker, fields.worker);
    if (!worker.ok) issues.push(...prefixed("worker", worker.issues));
    else {
      nested(parseWorkerLaunchReceipt(worker.value.launch), "worker.launch", issues);
      nested(parseDispatchPlan(worker.value.plan), "worker.plan", issues);
      nested(parseWorkerTerminalReceipt(worker.value.terminal), "worker.terminal", issues);
      if (worker.value.resultSubject !== null)
        nested(
          parseWorkerResultSubject(worker.value.resultSubject),
          "worker.resultSubject",
          issues,
        );
    }
  }
  if (row.review !== null) {
    const review = snapshotClosedRecord(row.review, fields.review);
    if (!review.ok) issues.push(...prefixed("review", review.issues));
    else {
      nested(parseReviewRequest(review.value.request), "review.request", issues);
      nested(parseReviewAuthority(review.value.authority), "review.authority", issues);
      if (review.value.attempt !== null)
        nested(parseReviewAttemptResult(review.value.attempt), "review.attempt", issues);
    }
  }
  // The outer snapshot has already rejected sparse, exotic, accessor and proxy arrays.
  if (!Array.isArray(row.skips)) issues.push("skips:array-required");
  else if (row.skips.length > 4) issues.push("skips:length-refused");
  else {
    let previous = 6;
    for (const [index, value] of row.skips.entries()) {
      const skip = parseRoutineStepSkip(value);
      if (!skip.ok) issues.push(...prefixed(`skips.${index}`, skip.issues));
      else {
        const ordinal = Number(skip.value.step.ordinal);
        if (ordinal < 7 || ordinal > 10 || ordinal <= previous)
          issues.push(`skips.${index}.step.ordinal:order-or-range-refused`);
        previous = ordinal;
      }
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as DispositionInput };
}

/** Intrinsic outcomes and inline intent closure only; no module issuance or effect authority. */
export function parseActionDisposition(input: unknown): ParseResult<ActionDisposition> {
  const parsed = snapshotClosedRecord(input, fields.disposition);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "action-disposition/v1") issues.push("schemaVersion:mismatch");
  for (const key of ["actionPlanDigest", "inputDigest", "subjectDigest"] as const)
    if (!digest(row[key])) issues.push(`${key}:invalid`);
  if (!name(row.code)) issues.push("code:invalid");
  if (!member(row.subjectKind, dispositionSubjectKinds)) issues.push("subjectKind:invalid");
  const outcome = record(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  const cell = outcome.value;
  if (cell.kind === "APPLY") {
    issues.push(...closedRecord(cell, fields.apply, "outcome"));
    if (!member(cell.operation, ["PROJECT", "ASSEMBLE_CERTIFY", "PROMOTE"]))
      issues.push("outcome.operation:invalid");
  } else if (member(cell.kind, ["REVIEW_NEEDED", "FOLLOW_UP", "FAILURE"])) {
    issues.push(...closedRecord(cell, fields.followUp, "outcome"));
    if (cell.followUp !== null || cell.kind !== "FAILURE") {
      const intent = parseFollowUpIntent(cell.followUp);
      if (!intent.ok) issues.push(...prefixed("outcome.followUp", intent.issues));
      else if (
        cell.kind === "REVIEW_NEEDED"
          ? intent.value.kind !== "REVIEW"
          : !["REPAIR", "REPLAN", "RETRY"].includes(intent.value.kind)
      )
        issues.push("outcome.followUp.kind:mismatch");
    }
  } else if (member(cell.kind, ["NO_ACTION", "COMPLETE"]))
    issues.push(...closedRecord(cell, fields.kind, "outcome"));
  else if (cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, fields.unknown, "outcome"));
    if (!member(cell.reason, dispositionUnknownReasons)) issues.push("outcome.reason:invalid");
  } else issues.push("outcome.kind:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ActionDisposition };
}

/** Both cause arms parse; promotion's actual causal authority belongs to its later owner. */
export function parseFollowUpCycleRequest(input: unknown): ParseResult<FollowUpCycleRequest> {
  const parsed = snapshotClosedRecord(input, fields.request);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "follow-up-cycle-request/v1") issues.push("schemaVersion:mismatch");
  if (!uuid(row.sourceCycleId)) issues.push("sourceCycleId:invalid");
  const intent = parseFollowUpIntent(row.intent);
  nested(intent, "intent", issues);
  const cause = snapshotClosedRecord(row.cause, fields.cause);
  if (!cause.ok) issues.push(...prefixed("cause", cause.issues));
  else {
    if (!digest(cause.value.digest)) issues.push("cause.digest:invalid");
    if (!member(cause.value.kind, ["DISPOSITION", "PROMOTION"])) issues.push("cause.kind:invalid");
    else if (
      intent.ok &&
      (cause.value.kind === "PROMOTION") !== (intent.value.kind === "SUCCESSOR_VERIFICATION")
    )
      issues.push("intent.kind:cause-mismatch");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as FollowUpCycleRequest };
}

export function computeDispositionInputDigest(input: unknown): string {
  const parsed = parseDispositionInput(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}
export function computeActionDispositionDigest(input: unknown): string {
  const parsed = parseActionDisposition(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("action-disposition/v1", [frame.canonical(parsed.value)]);
}
export function computeFollowUpCycleRequestDigest(input: unknown): string {
  const parsed = parseFollowUpCycleRequest(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("follow-up-cycle-request/v1", [frame.canonical(parsed.value)]);
}

function subjectTarget(subject: ReviewSubject): Readonly<{
  subjectDigest: string;
  subjectKind: DispositionSubjectKind;
}> {
  return subject.schemaVersion === "worker-result-subject/v1"
    ? { subjectDigest: computeWorkerResultSubjectDigest(subject), subjectKind: "WORKER_RESULT" }
    : {
        subjectDigest: computeReleaseCandidateSubjectDigest(subject),
        subjectKind: "RELEASE_CANDIDATE",
      };
}
type SkipPath = readonly (readonly [string, string])[];
function skipIssues(input: DispositionInput, expected: SkipPath, initialDigest: string): string[] {
  if (input.skips.length !== expected.length) return ["skips:path-mismatch"];
  const issues: string[] = [];
  let predecessor = initialDigest;
  for (const [index, skip] of input.skips.entries()) {
    const [ordinal, reason] = expected[index]!;
    if (
      skip.step.ordinal !== ordinal ||
      skip.reason !== reason ||
      skip.step.cycleId !== input.moduleInput.cycleRequest.cycleId ||
      skip.step.inputDigest !== predecessor
    )
      issues.push(`skips.${index}:predecessor-or-path-mismatch`);
    predecessor = computeRoutineStepSkipDigest(skip);
  }
  return issues;
}

/** Four supplied preimages/byte arguments only. Never proves admission, history or reclamation. */
export function validateActionDispositionBinding(
  inputValue: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  dispositionValue: unknown,
): ParseResult<ActionDisposition> {
  const parsed = parseDispositionInput(inputValue);
  if (!parsed.ok) return invalid(...prefixed("input", parsed.issues));
  const disposition = parseActionDisposition(dispositionValue);
  if (!disposition.ok) return disposition;
  const input = parsed.value;
  const { actionPlan: action, moduleInput, preflight, route, worker, review } = input;
  const moduleBinding = validateModulePlanBinding(moduleInput, action);
  if (!moduleBinding.ok) return invalid(...prefixed("module", moduleBinding.issues));
  const declaration = moduleInput.descriptor.actions.find(
    (row) =>
      row.actionKind === action.actionCore.actionKind &&
      row.capabilityName === action.actionCore.capabilityName,
  );
  if (!declaration) return invalid("action:declaration-required");
  const role = declaration.requestedRole;
  const cycleId = moduleInput.cycleRequest.cycleId;
  const actionDigest = computeModuleActionPlanDigest(action);
  const routeDigest = computeRouteSelectionDigest(route);
  const preflightDigest = computeProjectPreflightDigest(preflight);
  const issues: string[] = [];
  if (
    route.actionPlanDigest !== actionDigest ||
    preflight.actionPlanDigest !== actionDigest ||
    preflight.routeDigest !== routeDigest
  )
    issues.push("preparation:reference-mismatch");
  if (preflight.outcome.kind !== "ELIGIBLE") issues.push("preflight:eligible-required");
  if (route.outcome.kind !== (declaration.workerRequired ? "SELECTED" : "NO_WORKER"))
    issues.push("route:worker-declaration-mismatch");

  let diagnostic = false;
  let processFailure = false;
  let processSuccess = false;
  let expectedSkips: SkipPath = [];
  let primaryDigest = preflightDigest;
  if (!declaration.workerRequired) {
    if (
      worker !== null ||
      review !== null ||
      stdoutBytesOrNull !== null ||
      stderrBytesOrNull !== null
    )
      issues.push("workerless:null-context-required");
    expectedSkips = [
      ["7", "no-allocation"],
      ["8", "no-worker"],
      ["9", "no-worker"],
      ["10", "no-review"],
    ];
  } else if (worker === null) issues.push("worker:required");
  else {
    const terminal = validateWorkerTerminalReceiptBinding(
      worker.plan,
      worker.launch,
      stdoutBytesOrNull,
      stderrBytesOrNull,
      worker.terminal,
    );
    nested(terminal, "worker", issues);
    if (
      worker.plan.actionPlanDigest !== actionDigest ||
      worker.plan.preflightDigest !== preflightDigest ||
      worker.plan.routeDigest !== routeDigest
    )
      issues.push("worker.plan:context-mismatch");
    if (
      role === "review"
        ? worker.plan.reviewRequestDigest === null
        : worker.plan.reviewRequestDigest !== null
    )
      issues.push("worker.plan.reviewRequestDigest:role-mismatch");
    // Preserve upstream independence comparisons even when failure/UNKNOWN has no review attempt.
    const reviewTarget = moduleInput.reviewSubject;
    if (role === "review" && reviewTarget !== null) {
      const sourceCycle =
        reviewTarget.schemaVersion === "worker-result-subject/v1"
          ? reviewTarget.authorCycleId
          : reviewTarget.assemblyCycleId;
      if (sourceCycle === cycleId) issues.push("review:distinct-source-cycle-required");
      if (
        reviewTarget.schemaVersion === "worker-result-subject/v1" &&
        worker.plan.attemptId === reviewTarget.authorAttemptId
      )
        issues.push("review:distinct-author-attempt-required");
    }
    const observed = worker.terminal.outcome;
    diagnostic =
      worker.launch.outcome.kind === "UNKNOWN" ||
      observed.kind === "UNKNOWN" ||
      observed.kind === "TERMINATION_FAILED_LIVE";
    if (!diagnostic && observed.kind === "START_FAILED") {
      processFailure = true;
      expectedSkips = [
        ["9", "no-worker"],
        ["10", "no-review"],
      ];
      primaryDigest = computeWorkerLaunchReceiptDigest(worker.launch);
      if (review !== null || worker.resultSubject !== null)
        issues.push("startFailure:null-results-required");
    } else if (!diagnostic && observed.kind === "EXITED") {
      processSuccess = observed.exit.kind === "EXIT_CODE" && observed.exit.value === "0";
      processFailure = !processSuccess;
      primaryDigest = computeWorkerTerminalReceiptDigest(worker.terminal);
      if (role !== "review" || processFailure) expectedSkips = [["10", "no-review"]];
      if (role === "review") {
        if (processSuccess ? review === null : review !== null)
          issues.push("review:process-outcome-mismatch");
        if (worker.resultSubject !== null) issues.push("review:resultSubject-null-required");
      }
    }
    const subject = worker.resultSubject;
    if (subject !== null) {
      if (
        role === "review" ||
        worker.launch.outcome.kind === "START_FAILED" ||
        observed.kind === "START_FAILED"
      )
        issues.push("worker.resultSubject:role-or-start-mismatch");
      if (
        subject.authorCycleId !== cycleId ||
        subject.authorAttemptId !== worker.plan.attemptId ||
        subject.terminalReceiptDigest !== computeWorkerTerminalReceiptDigest(worker.terminal) ||
        subject.baseSource.adapterId !== moduleInput.adapterConfiguration.adapterId ||
        subject.baseSource.projectId !== moduleInput.adapterConfiguration.projectId
      )
        issues.push("worker.resultSubject:binding-mismatch");
    }
  }
  if (role !== "review" && review !== null) issues.push("review:ordinary-requires-null");
  if (review !== null) {
    if (role !== "review" || worker === null || worker.resultSubject !== null)
      issues.push("review:worker-role-mismatch");
    nested(
      validateReviewResultBinding(review.request, review.attempt, review.authority),
      "review",
      issues,
    );
    if (
      review.request.reviewCycleId !== cycleId ||
      canonicalJson(review.request.packet.brief) !== canonicalJson(action.dispatchBrief) ||
      canonicalJson(review.request.packet.subject) !== canonicalJson(moduleInput.reviewSubject) ||
      worker?.plan.reviewRequestDigest !== computeReviewRequestDigest(review.request)
    )
      issues.push("review.request:context-mismatch");
    if (review.attempt !== null && worker !== null) {
      const attempt = review.attempt;
      if (
        attempt.cycleId !== cycleId ||
        attempt.attemptId !== worker.plan.attemptId ||
        attempt.dispatchPlanDigest !== computeDispatchPlanDigest(worker.plan) ||
        attempt.launchReceiptDigest !== computeWorkerLaunchReceiptDigest(worker.launch) ||
        attempt.terminalReceiptDigest !== computeWorkerTerminalReceiptDigest(worker.terminal)
      )
        issues.push("review.attempt:worker-mismatch");
      if (attempt.result.kind === "BLOCKED") {
        const descriptorDigest = computeModuleDescriptorDigest(moduleInput.descriptor);
        for (const [index, finding] of attempt.result.findings.entries())
          if (
            !moduleInput.descriptor.dispositionCodes.includes(finding.disposition.code) ||
            finding.disposition.moduleDescriptorDigest !== descriptorDigest
          )
            issues.push(`review.attempt.result.findings.${index}.disposition:descriptor-mismatch`);
      }
    }
  }
  issues.push(...skipIssues(input, expectedSkips, primaryDigest));

  const row = disposition.value;
  if (row.actionPlanDigest !== actionDigest || row.inputDigest !== canonicalDigest(input))
    issues.push("disposition:input-or-action-mismatch");
  if (!moduleInput.descriptor.dispositionCodes.includes(row.code)) issues.push("code:not-declared");
  const subject = moduleInput.reviewSubject ?? worker?.resultSubject ?? null;
  const target =
    subject !== null
      ? subjectTarget(subject)
      : { subjectDigest: action.actionCore.immutableSubjectDigest, subjectKind: "ACTION" };
  if (row.subjectKind !== target.subjectKind || row.subjectDigest !== target.subjectDigest)
    issues.push("subject:derived-target-mismatch");
  const cell = row.outcome;
  if ("followUp" in cell && cell.followUp !== null) {
    const intent = cell.followUp;
    const desired = intent.kind === "REVIEW" ? subjectTarget(intent.subject) : intent;
    if (
      desired.subjectKind !== target.subjectKind ||
      desired.subjectDigest !== target.subjectDigest
    )
      issues.push("outcome.followUp:target-mismatch");
    if (
      cell.kind === "REVIEW_NEEDED" &&
      canonicalJson(cell.followUp.subject) !== canonicalJson(worker?.resultSubject ?? null)
    )
      issues.push("outcome.followUp.subject:materialized-result-mismatch");
  }

  // Ordered evidence gates; UNKNOWN never bypasses any structural join above.
  const authority = review?.authority.outcome.kind;
  if (diagnostic || authority === "unknown") {
    if (cell.kind !== "UNKNOWN") issues.push("outcome:unknown-required");
  } else if (processFailure) {
    if (cell.kind !== "FAILURE" && cell.kind !== "UNKNOWN")
      issues.push("outcome:known-failure-required");
  } else if (authority === "rejected") {
    if (cell.kind !== "FOLLOW_UP" && cell.kind !== "UNKNOWN")
      issues.push("outcome:rejection-follow-up-required");
  } else if (role !== "review" && processSuccess && worker?.resultSubject === null) {
    if (cell.kind !== "UNKNOWN" || cell.reason !== "RESULT_UNPROVEN")
      issues.push("outcome:result-unproven-required");
  } else if (role !== "review" && processSuccess && declaration.reviewRequired) {
    if (cell.kind !== "REVIEW_NEEDED" && cell.kind !== "UNKNOWN")
      issues.push("outcome:review-needed-required");
  } else {
    if (cell.kind === "REVIEW_NEEDED") issues.push("outcome:review-not-applicable");
    if (
      cell.kind === "COMPLETE" &&
      !(
        (role === "observer" && !declaration.reviewRequired) ||
        (role === "review" && authority === "accepted")
      )
    )
      issues.push("outcome:complete-not-applicable");
    if (cell.kind === "APPLY") {
      if (cell.operation === "PROJECT" && row.subjectKind === "RELEASE_CANDIDATE")
        issues.push("outcome.operation:project-target-mismatch");
      if (
        cell.operation === "ASSEMBLE_CERTIFY" &&
        (role !== "observer" ||
          declaration.workerRequired ||
          declaration.reviewRequired ||
          row.subjectKind !== "ACTION")
      )
        issues.push("outcome.operation:assembly-path-mismatch");
      if (
        cell.operation === "PROMOTE" &&
        (role !== "review" || authority !== "accepted" || row.subjectKind !== "RELEASE_CANDIDATE")
      )
        issues.push("outcome.operation:promotion-path-mismatch");
    }
  }
  return issues.length ? invalid(...issues) : disposition;
}

/** Acyclic disposition cause only; the complete PROMOTION arm is parsed but not admitted here. */
export function validateFollowUpCycleRequestBinding(
  inputValue: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  dispositionValue: unknown,
  requestValue: unknown,
): ParseResult<FollowUpCycleRequest> {
  const input = parseDispositionInput(inputValue);
  if (!input.ok) return invalid(...prefixed("input", input.issues));
  const disposition = validateActionDispositionBinding(
    input.value,
    stdoutBytesOrNull,
    stderrBytesOrNull,
    dispositionValue,
  );
  if (!disposition.ok) return invalid(...prefixed("disposition", disposition.issues));
  const request = parseFollowUpCycleRequest(requestValue);
  if (!request.ok) return request;
  const outcome = disposition.value.outcome;
  if (!("followUp" in outcome) || outcome.followUp === null)
    return invalid("disposition.outcome.followUp:required");
  if (
    request.value.cause.kind !== "DISPOSITION" ||
    request.value.cause.digest !== computeActionDispositionDigest(disposition.value) ||
    request.value.sourceCycleId !== input.value.moduleInput.cycleRequest.cycleId ||
    canonicalJson(request.value.intent) !== canonicalJson(outcome.followUp)
  )
    return invalid("request:disposition-cause-mismatch");
  return request;
}

export function parseDispositionContract(schema: string, input: unknown): ParseResult | null {
  if (schema === "action-disposition/v1") return parseActionDisposition(input);
  return schema === "follow-up-cycle-request/v1" ? parseFollowUpCycleRequest(input) : null;
}

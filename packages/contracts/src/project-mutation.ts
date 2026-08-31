import {
  computeActionDispositionDigest,
  parseDispositionInput,
  validateActionDispositionBinding,
  type DispositionInput,
} from "./disposition.js";
import {
  parseDispatchAllocationClaims,
  parseDispatchResourceIntents,
  type DispatchAllocationClaim,
  type DispatchResourceIntent,
} from "./dispatch-lifecycle.js";
import { computeModuleActionPlanDigest } from "./module-plan.js";
import {
  parseProjectFacts,
  validateProjectFactsBinding,
  type ProjectFacts,
} from "./project-snapshot.js";
import {
  canonicalDigest,
  canonicalJson,
  closedRecord,
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const projectMutationSchemaVersions = Object.freeze([
  "project-mutation-request/v1",
  "project-mutation-plan/v1",
  "project-apply-receipt/v1",
] as const);
export const projectMutationPlanRefusalReasons = Object.freeze([
  "TARGET_MOVED",
  "CAPABILITY_REMOVED",
  "POLICY_REFUSED",
  "UNSUPPORTED_ACTION",
  "RESOURCE_CONFLICT",
] as const);
export const projectMutationPlanUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "SOURCE_UNAVAILABLE",
  "SOURCE_UNKNOWN",
  "ADMISSION_UNPROVEN",
] as const);
export const projectApplyRefusalReasons = Object.freeze([
  "PRECONDITION_MOVED",
  "POLICY_REFUSED",
  "SESSION_UNHEALTHY",
  "CREDENTIALS_REFUSED",
  "PLAN_REFUSED",
] as const);
export const projectApplyUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "AUTHORITY_UNPROVEN",
  "WRITE_UNPROVEN",
  "READBACK_UNPROVEN",
  "PROGRESS_UNPROVEN",
] as const);
export const projectMutationSchemaFields = Object.freeze({
  request: Object.freeze([
    "actionPlanDigest",
    "adapterConfigurationDigest",
    "dispositionDigest",
    "schemaVersion",
    "sourceCycleId",
    "subjectDigest",
    "subjectKind",
    "transactionId",
  ] as const),
  plan: Object.freeze([
    "observationDigest",
    "outcome",
    "requestDigest",
    "schemaVersion",
    "transactionId",
  ] as const),
  apply: Object.freeze([
    "afterObservationDigest",
    "beforeObservationDigest",
    "completedEffectCount",
    "outcome",
    "phase",
    "planDigest",
    "requestDigest",
    "resources",
    "schemaVersion",
    "transactionId",
  ] as const),
  kind: Object.freeze(["kind"] as const),
  present: Object.freeze(["bytes", "kind"] as const),
  resource: Object.freeze(["resourceId", "value"] as const),
  effect: Object.freeze(["after", "before", "kind", "resourceId"] as const),
  observation: Object.freeze([
    "adapterConfigurationDigest",
    "observationId",
    "observedAt",
    "result",
  ] as const),
  complete: Object.freeze(["kind", "projectFacts", "resources"] as const),
  reason: Object.freeze(["kind", "reason"] as const),
  planned: Object.freeze(["effects", "kind", "resourceIntents"] as const),
});
export const projectMutationClosedValues = Object.freeze([
  "ABSENT",
  "PRESENT",
  "COMPARE_REPLACE",
  "COMPLETE",
  "UNAVAILABLE",
  "UNKNOWN",
  "PLANNED",
  "REFUSED",
  "APPLIED",
  "BEFORE_WRITE",
  "WRITING",
  "AFTER_WRITE",
  "ACTION",
  "WORKER_RESULT",
  "ADAPTER",
  "OBSERVATION_TIMEOUT",
  ...projectMutationPlanRefusalReasons,
  ...projectMutationPlanUnknownReasons,
  ...projectApplyRefusalReasons,
  ...projectApplyUnknownReasons,
]);
export type ProjectMutationValue =
  Readonly<{ kind: "ABSENT" }> | Readonly<{ bytes: string; kind: "PRESENT" }>;
export type ProjectMutationResourceObservation = Readonly<{
  resourceId: string;
  value: ProjectMutationValue;
}>;
export type ProjectMutationEffect = Readonly<{
  after: ProjectMutationValue;
  before: ProjectMutationValue;
  kind: "COMPARE_REPLACE";
  resourceId: string;
}>;
export type ProjectMutationObservation = Readonly<{
  adapterConfigurationDigest: string;
  observationId: string;
  observedAt: string;
  result:
    | Readonly<{
        kind: "COMPLETE";
        projectFacts: Extract<ProjectFacts, { state: "COMPLETE" }>;
        resources: readonly ProjectMutationResourceObservation[];
      }>
    | Readonly<{ kind: "UNAVAILABLE"; reason: "SOURCE_UNAVAILABLE" | "OBSERVATION_TIMEOUT" }>
    | Readonly<{ kind: "UNKNOWN"; reason: "SOURCE_UNKNOWN" | "OBSERVATION_INVALID" }>;
}>;
export type ProjectMutationRequest = Readonly<{
  actionPlanDigest: string;
  adapterConfigurationDigest: string;
  dispositionDigest: string;
  schemaVersion: "project-mutation-request/v1";
  sourceCycleId: string;
  subjectDigest: string;
  subjectKind: "ACTION" | "WORKER_RESULT";
  transactionId: string;
}>;
export type ProjectMutationPlan = Readonly<{
  observationDigest: string | null;
  outcome:
    | Readonly<{
        effects: readonly ProjectMutationEffect[];
        kind: "PLANNED";
        resourceIntents: readonly DispatchResourceIntent[];
      }>
    | Readonly<{ kind: "REFUSED"; reason: (typeof projectMutationPlanRefusalReasons)[number] }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof projectMutationPlanUnknownReasons)[number] }>;
  requestDigest: string;
  schemaVersion: "project-mutation-plan/v1";
  transactionId: string;
}>;
export type ProjectApplyReceipt = Readonly<{
  afterObservationDigest: string | null;
  beforeObservationDigest: string | null;
  completedEffectCount: string;
  outcome:
    | Readonly<{ kind: "APPLIED" }>
    | Readonly<{ kind: "REFUSED"; reason: (typeof projectApplyRefusalReasons)[number] }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof projectApplyUnknownReasons)[number] }>;
  phase: "BEFORE_WRITE" | "WRITING" | "AFTER_WRITE";
  planDigest: string;
  requestDigest: string;
  resources: readonly DispatchAllocationClaim[];
  schemaVersion: "project-apply-receipt/v1";
  transactionId: string;
}>;

const fields = projectMutationSchemaFields;
const invalid = (...issues: readonly string[]) => ({
  ok: false as const,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefixed = (prefix: string, issues: readonly string[]) =>
  issues.map((issue) => `${prefix}.${issue}`);
const digest = (value: JsonValue | undefined) => isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined) => isUuidV7(value) && value.length === 36;
const id = (value: JsonValue | undefined) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/.test(value);
const member = (value: JsonValue | undefined, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value);
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

/** Complete bounded bytes, never a path, program, projection or source-admission claim. */
export function parseProjectMutationValue(input: unknown): ParseResult<ProjectMutationValue> {
  const parsed = record(input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (row.kind !== "ABSENT" && row.kind !== "PRESENT") return invalid("kind:invalid");
  const issues = [...closedRecord(row, row.kind === "ABSENT" ? fields.kind : fields.present)];
  if (
    row.kind === "PRESENT" &&
    (typeof row.bytes !== "string" ||
      row.bytes.length > 8192 ||
      !/^(?:[0-9a-f]{2})*(?![\s\S])/.test(row.bytes))
  )
    issues.push("bytes:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectMutationValue };
}
export function parseProjectMutationEffect(input: unknown): ParseResult<ProjectMutationEffect> {
  const parsed = snapshotClosedRecord(input, fields.effect);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.kind !== "COMPARE_REPLACE") issues.push("kind:invalid");
  if (!id(row.resourceId)) issues.push("resourceId:invalid");
  const before = parseProjectMutationValue(row.before),
    after = parseProjectMutationValue(row.after);
  nested(before, "before", issues);
  nested(after, "after", issues);
  if (before.ok && after.ok && canonicalJson(before.value) === canonicalJson(after.value))
    issues.push("after:unchanged-effect");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectMutationEffect };
}
function resourceObservation(input: unknown): ParseResult<ProjectMutationResourceObservation> {
  const parsed = snapshotClosedRecord(input, fields.resource);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (!id(parsed.value.resourceId)) issues.push("resourceId:invalid");
  nested(parseProjectMutationValue(parsed.value.value), "value", issues);
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: parsed.value as ProjectMutationResourceObservation };
}
function resourceList(input: JsonValue | undefined, effects: boolean, prefix: string): string[] {
  if (!Array.isArray(input)) return [`${prefix}:array-required`];
  if (input.length > 64 || (effects && input.length === 0)) return [`${prefix}:length-refused`];
  const issues: string[] = [];
  let previous: string | null = null;
  for (const [index, entry] of input.entries()) {
    const parsed = effects ? parseProjectMutationEffect(entry) : resourceObservation(entry);
    if (!parsed.ok) issues.push(...prefixed(`${prefix}.${index}`, parsed.issues));
    else {
      if (previous !== null && previous >= parsed.value.resourceId)
        issues.push(`${prefix}.${index}.resourceId:order-refused`);
      previous = parsed.value.resourceId;
    }
  }
  return issues;
}

/** Inline full observation; complete resource data is still not actual source/currentness proof. */
export function parseProjectMutationObservation(
  input: unknown,
): ParseResult<ProjectMutationObservation> {
  const parsed = snapshotClosedRecord(input, fields.observation);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (!digest(row.adapterConfigurationDigest)) issues.push("adapterConfigurationDigest:invalid");
  if (!uuid(row.observationId)) issues.push("observationId:invalid");
  if (!isCanonicalTimestamp(row.observedAt)) issues.push("observedAt:invalid");
  const result = record(row.result);
  if (!result.ok) return invalid(...issues, ...prefixed("result", result.issues));
  const cell = result.value;
  if (cell.kind === "COMPLETE") {
    issues.push(...closedRecord(cell, fields.complete, "result"));
    const facts = parseProjectFacts(cell.projectFacts);
    nested(facts, "result.projectFacts", issues);
    if (facts.ok) {
      if (facts.value.state !== "COMPLETE")
        issues.push("result.projectFacts.state:complete-required");
      if (facts.value.observationId === row.observationId)
        issues.push("observationId:nested-id-reused");
    }
    issues.push(...resourceList(cell.resources, false, "result.resources"));
  } else if (cell.kind === "UNAVAILABLE" || cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, fields.reason, "result"));
    if (
      !member(
        cell.reason,
        cell.kind === "UNAVAILABLE"
          ? ["SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]
          : ["SOURCE_UNKNOWN", "OBSERVATION_INVALID"],
      )
    )
      issues.push("result.reason:invalid");
  } else issues.push("result.kind:invalid");
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as ProjectMutationObservation };
}
export function parseProjectMutationRequest(input: unknown): ParseResult<ProjectMutationRequest> {
  const parsed = snapshotClosedRecord(input, fields.request);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "project-mutation-request/v1") issues.push("schemaVersion:mismatch");
  for (const key of [
    "actionPlanDigest",
    "adapterConfigurationDigest",
    "dispositionDigest",
    "subjectDigest",
  ] as const)
    if (!digest(row[key])) issues.push(`${key}:invalid`);
  for (const key of ["sourceCycleId", "transactionId"] as const)
    if (!uuid(row[key])) issues.push(`${key}:invalid`);
  if (!member(row.subjectKind, ["ACTION", "WORKER_RESULT"])) issues.push("subjectKind:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectMutationRequest };
}
export function parseProjectMutationPlan(input: unknown): ParseResult<ProjectMutationPlan> {
  const parsed = snapshotClosedRecord(input, fields.plan);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "project-mutation-plan/v1") issues.push("schemaVersion:mismatch");
  if (!digest(row.requestDigest)) issues.push("requestDigest:invalid");
  if (!uuid(row.transactionId)) issues.push("transactionId:invalid");
  const outcome = record(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  const cell = outcome.value;
  if (cell.kind === "PLANNED") {
    issues.push(...closedRecord(cell, fields.planned, "outcome"));
    issues.push(...resourceList(cell.effects, true, "outcome.effects"));
    const intents = parseDispatchResourceIntents(cell.resourceIntents);
    if (!intents.ok) issues.push(...prefixed("outcome.resourceIntents", intents.issues));
    else if (intents.value.length > 64 || intents.value.some((row) => row.owner !== "ADAPTER"))
      issues.push("outcome.resourceIntents:adapter-or-bound-mismatch");
  } else if (cell.kind === "REFUSED" || cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, fields.reason, "outcome"));
    if (
      !member(
        cell.reason,
        cell.kind === "REFUSED"
          ? projectMutationPlanRefusalReasons
          : projectMutationPlanUnknownReasons,
      )
    )
      issues.push("outcome.reason:invalid");
  } else issues.push("outcome.kind:invalid");
  const needsNull =
    cell.kind === "UNKNOWN" &&
    member(cell.reason, ["OBSERVATION_UNAVAILABLE", "OBSERVATION_INVALID"]);
  if (needsNull ? row.observationDigest !== null : !digest(row.observationDigest))
    issues.push("observationDigest:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectMutationPlan };
}

/** Complete receipt shape; known writes/allocations and authentic progress are never inferred. */
export function parseProjectApplyReceipt(input: unknown): ParseResult<ProjectApplyReceipt> {
  const parsed = snapshotClosedRecord(input, fields.apply);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "project-apply-receipt/v1") issues.push("schemaVersion:mismatch");
  for (const key of ["planDigest", "requestDigest"] as const)
    if (!digest(row[key])) issues.push(`${key}:invalid`);
  for (const key of ["beforeObservationDigest", "afterObservationDigest"] as const)
    if (row[key] !== null && !digest(row[key])) issues.push(`${key}:invalid`);
  if (!uuid(row.transactionId)) issues.push("transactionId:invalid");
  if (!member(row.phase, ["BEFORE_WRITE", "WRITING", "AFTER_WRITE"])) issues.push("phase:invalid");
  if (
    !isCanonicalDecimal(row.completedEffectCount) ||
    /[^0-9]/.test(row.completedEffectCount) ||
    Number(row.completedEffectCount) > 64
  )
    issues.push("completedEffectCount:invalid");
  const allocations = parseDispatchAllocationClaims(row.resources);
  if (!allocations.ok) issues.push(...prefixed("resources", allocations.issues));
  const outcome = record(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  const cell = outcome.value;
  if (cell.kind === "APPLIED") {
    issues.push(...closedRecord(cell, fields.kind, "outcome"));
    if (
      row.phase !== "AFTER_WRITE" ||
      !digest(row.beforeObservationDigest) ||
      !digest(row.afterObservationDigest)
    )
      issues.push("outcome:applied-phase-or-observation-mismatch");
    if (allocations.ok && allocations.value.some((resource) => resource.state !== "ALLOCATED"))
      issues.push("resources:allocated-required");
  } else if (cell.kind === "REFUSED" || cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, fields.reason, "outcome"));
    if (
      !member(
        cell.reason,
        cell.kind === "REFUSED" ? projectApplyRefusalReasons : projectApplyUnknownReasons,
      )
    )
      issues.push("outcome.reason:invalid");
    if (cell.kind === "REFUSED") {
      if (
        row.phase !== "BEFORE_WRITE" ||
        row.completedEffectCount !== "0" ||
        !digest(row.beforeObservationDigest) ||
        row.afterObservationDigest !== null
      )
        issues.push("outcome:refused-phase-or-observation-mismatch");
      if (allocations.ok) {
        let unallocated = false;
        for (const resource of allocations.value) {
          if (resource.state === "UNKNOWN" || (unallocated && resource.state === "ALLOCATED"))
            issues.push("resources:known-prefix-required");
          if (resource.state === "NOT_ALLOCATED") unallocated = true;
        }
      }
    } else if (
      row.phase === "BEFORE_WRITE" &&
      (row.completedEffectCount !== "0" || row.afterObservationDigest !== null)
    )
      issues.push("outcome:before-write-mismatch");
  } else issues.push("outcome.kind:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectApplyReceipt };
}

export function computeProjectMutationRequestDigest(input: unknown): string {
  const parsed = parseProjectMutationRequest(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("project-mutation-request/v1", [frame.canonical(parsed.value)]);
}
export function computeProjectMutationPlanDigest(input: unknown): string {
  const parsed = parseProjectMutationPlan(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("project-mutation-plan/v1", [frame.canonical(parsed.value)]);
}
export function computeProjectApplyReceiptDigest(input: unknown): string {
  const parsed = parseProjectApplyReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("project-apply-receipt/v1", [frame.canonical(parsed.value)]);
}
export function computeProjectMutationObservationDigest(input: unknown): string {
  const parsed = parseProjectMutationObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}

const observationIds = (observation: ProjectMutationObservation): readonly string[] =>
  observation.result.kind === "COMPLETE"
    ? [observation.observationId, observation.result.projectFacts.observationId]
    : [observation.observationId];
function boundObservation(
  input: DispositionInput,
  value: unknown,
  previous: readonly ProjectMutationObservation[] = [],
): ParseResult<ProjectMutationObservation> {
  const parsed = parseProjectMutationObservation(value);
  if (!parsed.ok) return parsed;
  const observation = parsed.value;
  const module = input.moduleInput;
  const issues: string[] = [];
  if (observation.adapterConfigurationDigest !== canonicalDigest(module.adapterConfiguration))
    issues.push("adapterConfigurationDigest:mismatch");
  if (observation.result.kind === "COMPLETE")
    nested(
      validateProjectFactsBinding(observation.result.projectFacts, module.adapterConfiguration),
      "result.projectFacts",
      issues,
    );
  const used = new Set([
    module.projectFacts.observationId,
    module.policyFacts.observationId,
    ...previous.flatMap(observationIds),
  ]);
  if (observationIds(observation).some((id) => used.has(id))) issues.push("observationId:reused");
  return issues.length ? invalid(...issues) : parsed;
}

/** Five supplied arguments; the mutation key is owner-issued, never an authority or retry token. */
export function validateProjectMutationRequestBinding(
  dispositionInput: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  dispositionInputValue: unknown,
  requestInput: unknown,
): ParseResult<ProjectMutationRequest> {
  const input = parseDispositionInput(dispositionInput);
  if (!input.ok) return invalid(...prefixed("dispositionInput", input.issues));
  const disposition = validateActionDispositionBinding(
    input.value,
    stdoutBytesOrNull,
    stderrBytesOrNull,
    dispositionInputValue,
  );
  if (!disposition.ok) return invalid(...prefixed("disposition", disposition.issues));
  if (
    disposition.value.outcome.kind !== "APPLY" ||
    disposition.value.outcome.operation !== "PROJECT"
  )
    return invalid("disposition.outcome:project-apply-required");
  const request = parseProjectMutationRequest(requestInput);
  if (!request.ok) return request;
  const row = request.value;
  if (
    row.actionPlanDigest !== computeModuleActionPlanDigest(input.value.actionPlan) ||
    row.adapterConfigurationDigest !==
      canonicalDigest(input.value.moduleInput.adapterConfiguration) ||
    row.dispositionDigest !== computeActionDispositionDigest(disposition.value) ||
    row.sourceCycleId !== input.value.moduleInput.cycleRequest.cycleId ||
    row.subjectKind !== disposition.value.subjectKind ||
    row.subjectDigest !== disposition.value.subjectDigest
  )
    return invalid("request:disposition-context-mismatch");
  return request;
}

/** Complete dry-run claims, not proof of semantic effect mapping or fresh source authority. */
export function validateProjectMutationPlanBinding(
  dispositionInput: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  disposition: unknown,
  requestInput: unknown,
  observationOrNull: unknown,
  planInput: unknown,
): ParseResult<ProjectMutationPlan> {
  const request = validateProjectMutationRequestBinding(
    dispositionInput,
    stdoutBytesOrNull,
    stderrBytesOrNull,
    disposition,
    requestInput,
  );
  if (!request.ok) return invalid(...prefixed("request", request.issues));
  const input = parseDispositionInput(dispositionInput);
  if (!input.ok) return invalid(...prefixed("dispositionInput", input.issues));
  const plan = parseProjectMutationPlan(planInput);
  if (!plan.ok) return plan;
  if (
    plan.value.requestDigest !== computeProjectMutationRequestDigest(request.value) ||
    plan.value.transactionId !== request.value.transactionId
  )
    return invalid("plan:request-mismatch");
  const outcome = plan.value.outcome;
  if (outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_UNAVAILABLE")
    return observationOrNull === null ? plan : invalid("observation:null-required");
  const observation = boundObservation(input.value, observationOrNull);
  if (outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_INVALID") {
    if (observationOrNull === null || observationOrNull === undefined)
      return invalid("observation:input-required");
    return observation.ok ? invalid("observation:invalid-input-required") : plan;
  }
  if (!observation.ok) return invalid(...prefixed("observation", observation.issues));
  if (plan.value.observationDigest !== canonicalDigest(observation.value))
    return invalid("observationDigest:mismatch");
  const observed = observation.value.result;
  if (observed.kind !== "COMPLETE") {
    const expected = observed.kind === "UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "SOURCE_UNKNOWN";
    return outcome.kind === "UNKNOWN" && outcome.reason === expected
      ? plan
      : invalid("outcome:source-state-mismatch");
  }
  if (outcome.kind === "UNKNOWN")
    return outcome.reason === "ADMISSION_UNPROVEN"
      ? plan
      : invalid("outcome:complete-observation-mismatch");
  if (outcome.kind === "PLANNED") {
    if (
      outcome.effects.length !== observed.resources.length ||
      outcome.effects.some((effect, index) => {
        const resource = observed.resources[index]!;
        return (
          effect.resourceId !== resource.resourceId ||
          canonicalJson(effect.before) !== canonicalJson(resource.value)
        );
      })
    )
      return invalid("outcome.effects:observation-mismatch");
    if (
      !input.value.moduleInput.adapterConfiguration.capabilityNames.includes(
        String(input.value.actionPlan.actionCore.capabilityName),
      )
    )
      return invalid("outcome.effects:capability-not-configured");
  }
  return plan;
}

/** Eleven supplied arguments; never selects current progress, performs effects or admits a retry. */
export function validateProjectApplyReceiptBinding(
  dispositionInput: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  disposition: unknown,
  requestInput: unknown,
  dryObservationOrNull: unknown,
  planInput: unknown,
  expectedPlanDigest: unknown,
  beforeObservationOrNull: unknown,
  afterObservationOrNull: unknown,
  receiptInput: unknown,
): ParseResult<ProjectApplyReceipt> {
  const plan = validateProjectMutationPlanBinding(
    dispositionInput,
    stdoutBytesOrNull,
    stderrBytesOrNull,
    disposition,
    requestInput,
    dryObservationOrNull,
    planInput,
  );
  if (!plan.ok) return invalid(...prefixed("plan", plan.issues));
  if (plan.value.outcome.kind !== "PLANNED") return invalid("plan:planned-required");
  const input = parseDispositionInput(dispositionInput);
  if (!input.ok) return invalid(...prefixed("dispositionInput", input.issues));
  const dry = boundObservation(input.value, dryObservationOrNull);
  if (!dry.ok) return invalid(...prefixed("dryObservation", dry.issues));
  if (dry.value.result.kind !== "COMPLETE") return invalid("dryObservation:complete-required");
  const actualPlanDigest = computeProjectMutationPlanDigest(plan.value);
  if (
    typeof expectedPlanDigest !== "string" ||
    !digest(expectedPlanDigest) ||
    expectedPlanDigest !== actualPlanDigest
  )
    return invalid("expectedPlanDigest:mismatch");
  const receipt = parseProjectApplyReceipt(receiptInput);
  if (!receipt.ok) return receipt;
  const row = receipt.value,
    effects = plan.value.outcome.effects;
  const issues: string[] = [];
  if (
    row.planDigest !== actualPlanDigest ||
    row.requestDigest !== plan.value.requestDigest ||
    row.transactionId !== plan.value.transactionId
  )
    issues.push("receipt:plan-or-request-mismatch");
  const count = Number(row.completedEffectCount);
  if (count > effects.length || (row.phase === "AFTER_WRITE" && count !== effects.length))
    issues.push("completedEffectCount:plan-mismatch");
  const intents = plan.value.outcome.resourceIntents;
  if (
    row.resources.length !== intents.length ||
    row.resources.some((resource, index) => {
      const intent = intents[index]!;
      return (
        resource.owner !== intent.owner ||
        resource.resourceIdentityDigest !== intent.resourceIdentityDigest ||
        resource.ownerTransactionId !== plan.value.transactionId
      );
    })
  )
    issues.push("resources:intent-or-transaction-mismatch");

  const prior: ProjectMutationObservation[] = [dry.value];
  const observations: (ProjectMutationObservation | null)[] = [];
  for (const [label, value, reference] of [
    ["beforeObservation", beforeObservationOrNull, row.beforeObservationDigest],
    ["afterObservation", afterObservationOrNull, row.afterObservationDigest],
  ] as const) {
    if (value === null) {
      if (reference !== null) issues.push(`${label}Digest:null-mismatch`);
      observations.push(null);
      continue;
    }
    const observed = boundObservation(input.value, value, prior);
    if (!observed.ok) return invalid(...issues, ...prefixed(label, observed.issues));
    if (reference !== canonicalDigest(observed.value)) issues.push(`${label}Digest:mismatch`);
    if (prior.some((earlier) => earlier.observedAt > observed.value.observedAt))
      issues.push(`${label}.observedAt:before-prior`);
    prior.push(observed.value);
    observations.push(observed.value);
  }
  const [before, after] = observations;
  if (row.outcome.kind === "APPLIED" || row.outcome.kind === "REFUSED") {
    if (!before || before.result.kind !== "COMPLETE")
      issues.push("beforeObservation:complete-required");
    else {
      const moved =
        before.result.projectFacts.frontierDigest !==
          dry.value.result.projectFacts.frontierDigest ||
        canonicalJson(before.result.resources) !== canonicalJson(dry.value.result.resources);
      if (row.outcome.kind === "APPLIED" && moved)
        issues.push("beforeObservation:precondition-moved");
      if (row.outcome.kind === "REFUSED" && row.outcome.reason === "PRECONDITION_MOVED" && !moved)
        issues.push("outcome.reason:moved-precondition-required");
    }
  }
  if (row.outcome.kind === "APPLIED") {
    if (!after || after.result.kind !== "COMPLETE")
      issues.push("afterObservation:complete-required");
    else if (
      after.result.resources.length !== effects.length ||
      after.result.resources.some((resource, index) => {
        const effect = effects[index]!;
        return (
          resource.resourceId !== effect.resourceId ||
          canonicalJson(resource.value) !== canonicalJson(effect.after)
        );
      })
    )
      issues.push("afterObservation.resources:effect-mismatch");
  }
  return issues.length ? invalid(...issues) : receipt;
}

export function parseProjectMutationContract(schema: string, input: unknown): ParseResult | null {
  if (schema === "project-mutation-request/v1") return parseProjectMutationRequest(input);
  if (schema === "project-mutation-plan/v1") return parseProjectMutationPlan(input);
  return schema === "project-apply-receipt/v1" ? parseProjectApplyReceipt(input) : null;
}

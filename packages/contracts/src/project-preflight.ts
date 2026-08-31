import {
  computeModuleActionPlanDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
  type ModulePlanInput,
} from "./module-plan.js";
import {
  parseProjectFacts,
  validateProjectFactsBinding,
  type ProjectFacts,
} from "./project-snapshot.js";
import { computeRouteSelectionDigest, validateRouteSelectionBinding } from "./route-selection.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseReviewSubject,
  type ReviewSubject,
} from "./review-subject.js";
import {
  canonicalDigest,
  canonicalJson,
  closedRecord,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const projectPreflightSchemaVersions = Object.freeze(["project-preflight/v1"] as const);
export const projectPreflightRefusalReasons = Object.freeze([
  "WORK_MISSING",
  "TARGET_CHANGED",
  "CAPABILITY_REMOVED",
  "NOT_READY",
  "FRONTIER_CHANGED",
] as const);
export const projectPreflightUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "SOURCE_UNAVAILABLE",
  "SOURCE_UNKNOWN",
  "ADMISSION_UNPROVEN",
] as const);
export const projectPreflightSchemaFields = Object.freeze({
  preflight: Object.freeze([
    "actionPlanDigest",
    "observationDigest",
    "outcome",
    "routeDigest",
    "schemaVersion",
  ] as const),
  eligible: Object.freeze(["kind"] as const),
  failure: Object.freeze(["kind", "reason"] as const),
  project: Object.freeze(["facts", "kind"] as const),
  review: Object.freeze([
    "adapterConfigurationDigest",
    "kind",
    "observationId",
    "observedAt",
    "result",
  ] as const),
  available: Object.freeze(["kind", "subject"] as const),
  unavailable: Object.freeze(["kind"] as const),
});
export type ProjectPreflight = Readonly<{
  actionPlanDigest: string;
  observationDigest: string | null;
  outcome:
    | Readonly<{ kind: "ELIGIBLE" }>
    | Readonly<{ kind: "REFUSED"; reason: (typeof projectPreflightRefusalReasons)[number] }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof projectPreflightUnknownReasons)[number] }>;
  routeDigest: string;
  schemaVersion: "project-preflight/v1";
}>;
export type ProjectPreflightObservation =
  | Readonly<{ facts: ProjectFacts; kind: "PROJECT" }>
  | Readonly<{
      adapterConfigurationDigest: string;
      kind: "REVIEW";
      observationId: string;
      observedAt: string;
      result:
        | Readonly<{ kind: "AVAILABLE"; subject: ReviewSubject }>
        | Readonly<{ kind: "UNAVAILABLE" | "UNKNOWN" }>;
    }>;
const invalid = (...issues: readonly string[]) => ({
  ok: false as const,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefixed = (prefix: string, issues: readonly string[]) =>
  issues.map((issue) => `${prefix}.${issue}`);
const digest = (value: JsonValue | undefined) => isSha256(value) && value.length === 64;
function detachedRecord(input: unknown): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  return snapshot.value !== null &&
    typeof snapshot.value === "object" &&
    !Array.isArray(snapshot.value)
    ? { ok: true, value: snapshot.value as ContractRecord }
    : invalid("record:object-required");
}

/** Full inline observation, not a new persisted family or source-admission proof. */
export function parseProjectPreflightObservation(
  input: unknown,
): ParseResult<ProjectPreflightObservation> {
  const parsed = detachedRecord(input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const fields =
    row.kind === "PROJECT"
      ? projectPreflightSchemaFields.project
      : row.kind === "REVIEW"
        ? projectPreflightSchemaFields.review
        : null;
  if (!fields) return invalid("kind:invalid");
  const issues = [...closedRecord(row, fields)];
  if (row.kind === "PROJECT") {
    const facts = parseProjectFacts(row.facts);
    if (!facts.ok) issues.push(...prefixed("facts", facts.issues));
  } else {
    if (!digest(row.adapterConfigurationDigest)) issues.push("adapterConfigurationDigest:invalid");
    if (!isUuidV7(row.observationId)) issues.push("observationId:invalid");
    if (!isCanonicalTimestamp(row.observedAt)) issues.push("observedAt:invalid");
    const result = detachedRecord(row.result);
    if (!result.ok) issues.push(...prefixed("result", result.issues));
    else if (result.value.kind === "AVAILABLE") {
      issues.push(...closedRecord(result.value, projectPreflightSchemaFields.available, "result"));
      const subject = parseReviewSubject(result.value.subject);
      if (!subject.ok) issues.push(...prefixed("result.subject", subject.issues));
    } else if (result.value.kind === "UNAVAILABLE" || result.value.kind === "UNKNOWN") {
      issues.push(
        ...closedRecord(result.value, projectPreflightSchemaFields.unavailable, "result"),
      );
    } else issues.push("result.kind:invalid");
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as ProjectPreflightObservation };
}

/** Complete eleven-cell public result; ELIGIBLE is supplied consistency, never permission. */
export function parseProjectPreflight(input: unknown): ParseResult<ProjectPreflight> {
  const parsed = snapshotClosedRecord(input, projectPreflightSchemaFields.preflight);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const issues: string[] = [];
  if (row.schemaVersion !== "project-preflight/v1") issues.push("schemaVersion:mismatch");
  for (const name of ["actionPlanDigest", "routeDigest"] as const)
    if (!digest(row[name])) issues.push(`${name}:invalid`);
  const outcome = detachedRecord(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  const cell = outcome.value;
  if (cell.kind === "ELIGIBLE")
    issues.push(...closedRecord(cell, projectPreflightSchemaFields.eligible, "outcome"));
  else if (cell.kind === "REFUSED" || cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, projectPreflightSchemaFields.failure, "outcome"));
    const reasons: readonly JsonValue[] =
      cell.kind === "REFUSED" ? projectPreflightRefusalReasons : projectPreflightUnknownReasons;
    if (!reasons.includes(cell.reason!)) issues.push("outcome.reason:invalid");
  } else issues.push("outcome.kind:invalid");
  const needsNull =
    cell.kind === "UNKNOWN" &&
    (cell.reason === "OBSERVATION_UNAVAILABLE" || cell.reason === "OBSERVATION_INVALID");
  if (needsNull ? row.observationDigest !== null : !digest(row.observationDigest))
    issues.push("observationDigest:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as ProjectPreflight };
}
export function computeProjectPreflightDigest(input: unknown): string {
  const parsed = parseProjectPreflight(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("project-preflight/v1", [frame.canonical(parsed.value)]);
}
export function computeProjectPreflightObservationDigest(input: unknown): string {
  const parsed = parseProjectPreflightObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}
function boundObservation(
  input: ModulePlanInput,
  observationInput: unknown,
): ParseResult<ProjectPreflightObservation> {
  const parsed = parseProjectPreflightObservation(observationInput);
  if (!parsed.ok) return parsed;
  const observation = parsed.value;
  if ((input.reviewSubject === null) !== (observation.kind === "PROJECT"))
    return invalid("kind:context-mismatch");
  let observationId: string;
  if (observation.kind === "PROJECT") {
    const facts = validateProjectFactsBinding(observation.facts, input.adapterConfiguration);
    if (!facts.ok) return invalid(...prefixed("facts", facts.issues));
    observationId = observation.facts.observationId;
  } else {
    if (observation.adapterConfigurationDigest !== canonicalDigest(input.adapterConfiguration))
      return invalid("adapterConfigurationDigest:mismatch");
    observationId = observation.observationId;
  }
  if ([input.projectFacts.observationId, input.policyFacts.observationId].includes(observationId))
    return invalid("observationId:reused");
  return parsed;
}
const subjectDigest = (subject: ReviewSubject) =>
  subject.schemaVersion === "worker-result-subject/v1"
    ? computeWorkerResultSubjectDigest(subject)
    : computeReleaseCandidateSubjectDigest(subject);

/** Exactly six supplied preimages; no I/O, freshness, materialization or allocation admission. */
export function validateProjectPreflightBinding(
  moduleInput: unknown,
  actionPlan: unknown,
  mappingInput: unknown,
  routeInput: unknown,
  observationInput: unknown,
  preflightInput: unknown,
): ParseResult<ProjectPreflight> {
  const input = parseModulePlanInput(moduleInput);
  if (!input.ok) return invalid(...prefixed("moduleInput", input.issues));
  const action = parseModuleActionPlan(actionPlan);
  if (!action.ok) return invalid(...prefixed("actionPlan", action.issues));
  const route = validateRouteSelectionBinding(input.value, action.value, mappingInput, routeInput);
  if (!route.ok) return invalid(...prefixed("route", route.issues));
  if (route.value.outcome.kind !== "SELECTED" && route.value.outcome.kind !== "NO_WORKER")
    return invalid("route.outcome:preflight-not-applicable");
  const preflight = parseProjectPreflight(preflightInput);
  if (!preflight.ok) return preflight;
  if (preflight.value.actionPlanDigest !== computeModuleActionPlanDigest(action.value))
    return invalid("actionPlanDigest:mismatch");
  if (preflight.value.routeDigest !== computeRouteSelectionDigest(route.value))
    return invalid("routeDigest:mismatch");
  const outcome = preflight.value.outcome;
  if (outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_UNAVAILABLE")
    return observationInput === null ? preflight : invalid("observation:null-required");
  const observation = boundObservation(input.value, observationInput);
  if (outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_INVALID") {
    if (observationInput === null || observationInput === undefined)
      return invalid("observation:input-required");
    return observation.ok ? invalid("observation:invalid-input-required") : preflight;
  }
  if (!observation.ok) return invalid(...prefixed("observation", observation.issues));
  if (preflight.value.observationDigest !== canonicalDigest(observation.value))
    return invalid("observationDigest:mismatch");
  if (outcome.kind === "UNKNOWN" && outcome.reason === "ADMISSION_UNPROVEN") return preflight;
  const observed = observation.value;
  let expected: ProjectPreflight["outcome"];
  const state = observed.kind === "PROJECT" ? observed.facts.state : observed.result.kind;
  if (state === "UNAVAILABLE") expected = { kind: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" };
  else if (state === "UNKNOWN") expected = { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" };
  else if (observed.kind === "PROJECT" && observed.facts.state === "COMPLETE") {
    const row = observed.facts.frontier.find((entry) => entry.workId === action.value.workId);
    if (!row) expected = { kind: "REFUSED", reason: "WORK_MISSING" };
    else if (row.immutableSubjectDigest !== action.value.actionCore.immutableSubjectDigest)
      expected = { kind: "REFUSED", reason: "TARGET_CHANGED" };
    else if (!row.capabilityNames.includes(String(action.value.actionCore.capabilityName)))
      expected = { kind: "REFUSED", reason: "CAPABILITY_REMOVED" };
    else if (row.readiness !== "READY") expected = { kind: "REFUSED", reason: "NOT_READY" };
    else if (
      canonicalJson(observed.facts.frontier) !== canonicalJson(input.value.projectFacts.frontier)
    )
      expected = { kind: "REFUSED", reason: "FRONTIER_CHANGED" };
    else expected = { kind: "ELIGIBLE" };
  } else if (
    observed.kind === "REVIEW" &&
    observed.result.kind === "AVAILABLE" &&
    input.value.reviewSubject !== null
  ) {
    const target = input.value.reviewSubject;
    expected =
      observed.result.subject.schemaVersion === target.schemaVersion &&
      subjectDigest(observed.result.subject) === subjectDigest(target)
        ? { kind: "ELIGIBLE" }
        : { kind: "REFUSED", reason: "TARGET_CHANGED" };
  } else return invalid("observation:unhandled-state");
  return canonicalJson(outcome) === canonicalJson(expected)
    ? preflight
    : invalid("outcome:observation-mismatch");
}
export function parseProjectPreflightContract(
  schema: string,
  input: unknown,
): ParseResult<ProjectPreflight> | null {
  return schema === "project-preflight/v1" ? parseProjectPreflight(input) : null;
}

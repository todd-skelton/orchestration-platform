import {
  canonicalDigest,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";
import {
  parseConfigurationPaths,
  parseConfigurationProvenance,
  parsePlatformConfigurationSource,
} from "./configuration.js";
import { parseRoutineStepIdentity, type RoutineStepIdentity } from "./routine-step.js";

export const cycleEntrySchemaVersions = Object.freeze([
  "cycle-plan/v1",
  "cycle-request/v1",
  "session-acquire-request/v1",
  "session-health/v1",
  "session-receipt/v1",
] as const);
export const cycleEntrySchemaFields = Object.freeze({
  acquire: Object.freeze([
    "configurationPathsDigest",
    "configurationProvenanceDigest",
    "configurationSourceDigest",
    "schemaVersion",
    "sessionId",
  ] as const),
  request: Object.freeze([
    "adapterId",
    "allowedModuleIds",
    "cycleId",
    "schemaVersion",
    "sessionRequest",
  ] as const),
  plan: Object.freeze(["protocol", "request", "schemaVersion"] as const),
  receipt: Object.freeze([
    "acquireRequestDigest",
    "operation",
    "outcome",
    "reason",
    "recordedAt",
    "schemaVersion",
    "sessionId",
  ] as const),
  health: Object.freeze([
    "holderSessionId",
    "leaseState",
    "observedAt",
    "outcome",
    "reason",
    "schemaVersion",
    "step",
    "targetSessionId",
  ] as const),
});

const unknownReasons = Object.freeze([
  "STATE_UNREADABLE",
  "IDENTITY_CONFLICT",
  "CLOCK_ROLLBACK",
  "CLOCK_SKEW",
  "MONOTONIC_UNAVAILABLE",
] as const);
const refusedReasons = Object.freeze({
  ACQUIRE: Object.freeze([
    "SESSION_HELD",
    "SESSION_STALE",
    "HANDOFF_PENDING",
    "CONFIGURATION_MISMATCH",
  ] as const),
  RENEW: Object.freeze([
    "SESSION_NOT_FOUND",
    "SESSION_MISMATCH",
    "SESSION_RELEASED",
    "SESSION_STALE",
    "DURATION_EXCEEDED",
    "HANDOFF_PENDING",
    "CONFIGURATION_MISMATCH",
  ] as const),
  RELEASE: Object.freeze([
    "SESSION_NOT_FOUND",
    "SESSION_MISMATCH",
    "HANDOFF_PENDING",
    "CONFIGURATION_MISMATCH",
  ] as const),
});
const successOutcomes = Object.freeze({
  ACQUIRE: "ACQUIRED",
  RENEW: "RENEWED",
  RELEASE: "RELEASED",
} as const);
type SessionOperation = keyof typeof successOutcomes;
type UnknownReason = (typeof unknownReasons)[number];
export type SessionAcquireRequest = Readonly<{
  configurationPathsDigest: string;
  configurationProvenanceDigest: string;
  configurationSourceDigest: string;
  schemaVersion: "session-acquire-request/v1";
  sessionId: string;
}>;
export type CycleRequest = Readonly<{
  adapterId: string;
  allowedModuleIds: readonly string[];
  cycleId: string;
  schemaVersion: "cycle-request/v1";
  sessionRequest: SessionAcquireRequest;
}>;
export type CyclePlan = Readonly<{
  protocol: "routine-cycle/v1";
  request: CycleRequest;
  schemaVersion: "cycle-plan/v1";
}>;
export type SessionReceipt = {
  [Operation in SessionOperation]: Readonly<{
    acquireRequestDigest: Operation extends "ACQUIRE" ? string : null;
    operation: Operation;
    schemaVersion: "session-receipt/v1";
    sessionId: string;
  }> &
    (
      | Readonly<{ outcome: (typeof successOutcomes)[Operation]; reason: null; recordedAt: string }>
      | Readonly<{
          outcome: "REFUSED";
          reason: (typeof refusedReasons)[Operation][number];
          recordedAt: string;
        }>
      | Readonly<{ outcome: "UNKNOWN"; reason: UnknownReason; recordedAt: string | null }>
    );
}[SessionOperation];
export type SessionHealth = Readonly<{ schemaVersion: "session-health/v1" }> &
  (
    | Readonly<{ step: null; targetSessionId: string | null }>
    | Readonly<{ step: Extract<RoutineStepIdentity, { ordinal: "1" }>; targetSessionId: string }>
  ) &
  (
    | Readonly<{
        holderSessionId: null;
        leaseState: "AVAILABLE";
        observedAt: string;
        outcome: "REFUSED";
        reason: "SESSION_NOT_FOUND";
      }>
    | Readonly<{
        holderSessionId: string;
        leaseState: "HELD_FRESH";
        observedAt: string;
        outcome: "HEALTHY";
        reason: null;
      }>
    | Readonly<{
        holderSessionId: string;
        leaseState: "HELD_FRESH";
        observedAt: string;
        outcome: "REFUSED";
        reason: "SESSION_MISMATCH" | "CONFIGURATION_MISMATCH";
      }>
    | Readonly<{
        holderSessionId: string;
        leaseState: "HELD_STALE";
        observedAt: string;
        outcome: "REFUSED";
        reason: "FRESHNESS_EXPIRED" | "DURATION_EXCEEDED" | "SESSION_MISMATCH";
      }>
    | Readonly<{
        holderSessionId: string;
        leaseState: "HANDOFF_PREPARED";
        observedAt: string;
        outcome: "REFUSED";
        reason: "HANDOFF_PENDING" | "SESSION_MISMATCH";
      }>
    | Readonly<{
        holderSessionId: string;
        leaseState: "RELEASED";
        observedAt: string;
        outcome: "REFUSED";
        reason: "SESSION_RELEASED" | "SESSION_MISMATCH";
      }>
    | Readonly<{
        holderSessionId: null;
        leaseState: "UNKNOWN";
        observedAt: string | null;
        outcome: "UNKNOWN";
        reason: UnknownReason;
      }>
  );

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
function digest(value: JsonValue | undefined): value is string {
  return isSha256(value) && value.length === 64;
}
function uuid(value: JsonValue | undefined): value is string {
  return isUuidV7(value) && value.length === 36;
}
function id(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z0-9]/.test(value) &&
    !/[^a-z0-9._:@+-]/.test(value)
  );
}
function time(value: JsonValue | undefined): value is string {
  return isCanonicalTimestamp(value) && value.length === 24 && !value.startsWith("0000-");
}
function contains(values: readonly string[], value: JsonValue | undefined): boolean {
  return typeof value === "string" && values.includes(value);
}
function nested(issues: string[], prefix: string, parsed: ParseResult): void {
  if (!parsed.ok) issues.push(...parsed.issues.map((issue) => `${prefix}.${issue}`));
}

/** Shape only; no effective configuration, durable session identity, or lease is admitted. */
export function parseSessionAcquireRequest(input: unknown): ParseResult<SessionAcquireRequest> {
  const parsed = snapshotClosedRecord(input, cycleEntrySchemaFields.acquire);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "session-acquire-request/v1") issues.push("schemaVersion:mismatch");
  for (const field of [
    "configurationPathsDigest",
    "configurationProvenanceDigest",
    "configurationSourceDigest",
  ] as const)
    if (!digest(record[field])) issues.push(`${field}:invalid`);
  if (!uuid(record.sessionId)) issues.push("sessionId:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as SessionAcquireRequest };
}
export function parseCycleRequest(input: unknown): ParseResult<CycleRequest> {
  const parsed = snapshotClosedRecord(input, cycleEntrySchemaFields.request);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "cycle-request/v1") issues.push("schemaVersion:mismatch");
  if (!id(record.adapterId)) issues.push("adapterId:invalid");
  if (!uuid(record.cycleId)) issues.push("cycleId:invalid");
  const modules = snapshotClosedArray(record.allowedModuleIds);
  if (!modules.ok) issues.push(...modules.issues.map((issue) => `allowedModuleIds.${issue}`));
  else {
    if (modules.value.length > 64) issues.push("allowedModuleIds:limit-exceeded");
    for (const [index, value] of modules.value.entries()) {
      if (!id(value)) issues.push(`allowedModuleIds.${index}:invalid`);
      const previous = modules.value[index - 1];
      if (typeof value === "string" && typeof previous === "string" && previous >= value)
        issues.push("allowedModuleIds:not-ascii-sorted-unique");
    }
  }
  nested(issues, "sessionRequest", parseSessionAcquireRequest(record.sessionRequest));
  return issues.length ? invalid(...issues) : { ok: true, value: record as CycleRequest };
}
export function parseCyclePlan(input: unknown): ParseResult<CyclePlan> {
  const parsed = snapshotClosedRecord(input, cycleEntrySchemaFields.plan);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "cycle-plan/v1") issues.push("schemaVersion:mismatch");
  if (record.protocol !== "routine-cycle/v1") issues.push("protocol:invalid");
  nested(issues, "request", parseCycleRequest(record.request));
  return issues.length ? invalid(...issues) : { ok: true, value: record as CyclePlan };
}

/** Complete operation union, not a lease transition or proof of selected durable state. */
export function parseSessionReceipt(input: unknown): ParseResult<SessionReceipt> {
  const parsed = snapshotClosedRecord(input, cycleEntrySchemaFields.receipt);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "session-receipt/v1") issues.push("schemaVersion:mismatch");
  if (!uuid(record.sessionId)) issues.push("sessionId:invalid");
  if (record.operation === "ACQUIRE") {
    if (!digest(record.acquireRequestDigest)) issues.push("acquireRequestDigest:invalid");
  } else if (record.acquireRequestDigest !== null)
    issues.push("acquireRequestDigest:null-required");
  if (typeof record.operation !== "string" || !Object.hasOwn(successOutcomes, record.operation))
    issues.push("operation:invalid");
  else {
    const operation = record.operation as SessionOperation;
    if (record.outcome === successOutcomes[operation]) {
      if (record.reason !== null) issues.push("reason:null-required");
    } else if (record.outcome === "REFUSED") {
      if (!contains(refusedReasons[operation], record.reason))
        issues.push("reason:operation-mismatch");
    } else if (record.outcome === "UNKNOWN") {
      if (!contains(unknownReasons, record.reason)) issues.push("reason:unknown-required");
    } else issues.push("outcome:operation-mismatch");
  }
  if (!(record.outcome === "UNKNOWN" && record.recordedAt === null) && !time(record.recordedAt))
    issues.push("recordedAt:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as SessionReceipt };
}

/** Structural claims only, including holders established by handoff rather than acquisition. */
export function parseSessionHealth(input: unknown): ParseResult<SessionHealth> {
  const parsed = snapshotClosedRecord(input, cycleEntrySchemaFields.health);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "session-health/v1") issues.push("schemaVersion:mismatch");
  if (record.step !== null) {
    const step = parseRoutineStepIdentity(record.step);
    nested(issues, "step", step);
    if (step.ok && step.value.ordinal !== "1") issues.push("step.ordinal:initial-required");
  }
  if (!(record.step === null && record.targetSessionId === null) && !uuid(record.targetSessionId))
    issues.push("targetSessionId:invalid");
  if (record.leaseState === "AVAILABLE" || record.leaseState === "UNKNOWN") {
    if (record.holderSessionId !== null) issues.push("holderSessionId:null-required");
  } else if (!uuid(record.holderSessionId)) issues.push("holderSessionId:invalid");
  if (!(record.leaseState === "UNKNOWN" && record.observedAt === null) && !time(record.observedAt))
    issues.push("observedAt:invalid");
  const mismatch =
    record.targetSessionId !== null && record.targetSessionId !== record.holderSessionId;
  let permitted = false;
  switch (record.leaseState) {
    case "AVAILABLE":
      permitted = record.outcome === "REFUSED" && record.reason === "SESSION_NOT_FOUND";
      break;
    case "HELD_FRESH":
      permitted = mismatch
        ? record.outcome === "REFUSED" && record.reason === "SESSION_MISMATCH"
        : (record.outcome === "HEALTHY" && record.reason === null) ||
          (record.outcome === "REFUSED" && record.reason === "CONFIGURATION_MISMATCH");
      break;
    case "HELD_STALE":
      permitted =
        record.outcome === "REFUSED" &&
        (mismatch
          ? record.reason === "SESSION_MISMATCH"
          : contains(["FRESHNESS_EXPIRED", "DURATION_EXCEEDED"], record.reason));
      break;
    case "HANDOFF_PREPARED":
      permitted =
        record.outcome === "REFUSED" &&
        record.reason === (mismatch ? "SESSION_MISMATCH" : "HANDOFF_PENDING");
      break;
    case "RELEASED":
      permitted =
        record.outcome === "REFUSED" &&
        record.reason === (mismatch ? "SESSION_MISMATCH" : "SESSION_RELEASED");
      break;
    case "UNKNOWN":
      permitted = record.outcome === "UNKNOWN" && contains(unknownReasons, record.reason);
      break;
    default:
      issues.push("leaseState:invalid");
  }
  if (!permitted) issues.push("outcome:lease-state-reason-target-mismatch");
  return issues.length ? invalid(...issues) : { ok: true, value: record as SessionHealth };
}

export function parseCycleEntryContract(schema: string, input: unknown): ParseResult | null {
  switch (schema) {
    case "session-acquire-request/v1":
      return parseSessionAcquireRequest(input);
    case "cycle-request/v1":
      return parseCycleRequest(input);
    case "cycle-plan/v1":
      return parseCyclePlan(input);
    case "session-receipt/v1":
      return parseSessionReceipt(input);
    case "session-health/v1":
      return parseSessionHealth(input);
    default:
      return null;
  }
}
function familyDigest(schema: string, input: unknown): string {
  const parsed = parseCycleEntryContract(schema, input);
  if (!parsed || !parsed.ok)
    throw new TypeError(parsed ? parsed.issues.join(",") : "schemaVersion:unsupported");
  return framedDigest(schema, [frame.canonical(parsed.value)]);
}
export const computeSessionAcquireRequestDigest = (input: unknown): string =>
  familyDigest("session-acquire-request/v1", input);
export const computeCycleRequestDigest = (input: unknown): string =>
  familyDigest("cycle-request/v1", input);
export const computeCyclePlanDigest = (input: unknown): string =>
  familyDigest("cycle-plan/v1", input);
export const computeSessionReceiptDigest = (input: unknown): string =>
  familyDigest("session-receipt/v1", input);
export const computeSessionHealthDigest = (input: unknown): string =>
  familyDigest("session-health/v1", input);

/** Hashes supplied preimages only. The loader still owes source/effective/path resolution admission. */
export function validateSessionAcquireRequestBinding(
  requestInput: unknown,
  sourceInput: unknown,
  provenanceInput: unknown,
  pathsInput: unknown,
): ParseResult<SessionAcquireRequest> {
  const request = parseSessionAcquireRequest(requestInput);
  if (!request.ok) return request;
  const issues: string[] = [];
  const records = [
    ["configurationSourceDigest", parsePlatformConfigurationSource(sourceInput)],
    ["configurationProvenanceDigest", parseConfigurationProvenance(provenanceInput)],
    ["configurationPathsDigest", parseConfigurationPaths(pathsInput)],
  ] as const;
  for (const [field, parsed] of records) {
    nested(issues, field, parsed);
    if (parsed.ok && request.value[field] !== canonicalDigest(parsed.value))
      issues.push(`${field}:binding-mismatch`);
  }
  return issues.length ? invalid(...issues) : request;
}

/** Supplied plan/configuration/module-census equality only: no module loading, current policy, or authority. */
export function validateCyclePlanBinding(
  planInput: unknown,
  sourceInput: unknown,
  provenanceInput: unknown,
  pathsInput: unknown,
  moduleIdsInput: unknown,
  expectedPlanDigest: unknown,
): ParseResult<CyclePlan> {
  const plan = parseCyclePlan(planInput);
  if (!plan.ok) return plan;
  const issues: string[] = [];
  nested(
    issues,
    "sessionRequest",
    validateSessionAcquireRequestBinding(
      plan.value.request.sessionRequest,
      sourceInput,
      provenanceInput,
      pathsInput,
    ),
  );
  const provenance = parseConfigurationProvenance(provenanceInput);
  if (provenance.ok && plan.value.request.adapterId !== provenance.value.adapterId)
    issues.push("adapterId:binding-mismatch");
  const modules = snapshotClosedArray(moduleIdsInput);
  if (!modules.ok) issues.push(...modules.issues.map((issue) => `moduleIds.${issue}`));
  else if (
    modules.value.some((value) => !id(value)) ||
    new Set(modules.value).size !== modules.value.length
  )
    issues.push("moduleIds:invalid");
  else if (plan.value.request.allowedModuleIds.some((value) => !modules.value.includes(value)))
    issues.push("allowedModuleIds:not-in-supplied-census");
  if (typeof expectedPlanDigest !== "string" || !digest(expectedPlanDigest))
    issues.push("expectedPlanDigest:invalid");
  else if (computeCyclePlanDigest(plan.value) !== expectedPlanDigest)
    issues.push("expectedPlanDigest:binding-mismatch");
  return issues.length ? invalid(...issues) : plan;
}

/** Matches supplied command identity and, for acquisition only, actual request bytes. No lease selection. */
export function validateSessionReceiptBinding(
  receiptInput: unknown,
  operation: unknown,
  sessionId: unknown,
  acquireRequestInput: unknown = null,
): ParseResult<SessionReceipt> {
  const receipt = parseSessionReceipt(receiptInput);
  if (!receipt.ok) return receipt;
  const issues: string[] = [];
  if (receipt.value.operation !== operation) issues.push("operation:binding-mismatch");
  if (receipt.value.sessionId !== sessionId) issues.push("sessionId:binding-mismatch");
  if (receipt.value.operation === "ACQUIRE") {
    const request = parseSessionAcquireRequest(acquireRequestInput);
    nested(issues, "acquireRequest", request);
    if (request.ok) {
      if (receipt.value.acquireRequestDigest !== computeSessionAcquireRequestDigest(request.value))
        issues.push("acquireRequestDigest:binding-mismatch");
      if (receipt.value.sessionId !== request.value.sessionId)
        issues.push("sessionId:request-mismatch");
    }
  } else if (acquireRequestInput !== null) issues.push("acquireRequest:null-required");
  return issues.length ? invalid(...issues) : receipt;
}

/** Binds the actual step-1 input identity; even HEALTHY still requires fresh independent runtime admission. */
export function validateSessionHealthBinding(
  healthInput: unknown,
  planInput: unknown,
): ParseResult<SessionHealth> {
  const health = parseSessionHealth(healthInput);
  if (!health.ok) return health;
  const plan = parseCyclePlan(planInput);
  if (!plan.ok) return invalid(...plan.issues.map((issue) => `plan.${issue}`));
  const issues: string[] = [];
  if (health.value.step === null) issues.push("step:initial-required");
  else {
    if (health.value.step.cycleId !== plan.value.request.cycleId)
      issues.push("step.cycleId:binding-mismatch");
    if (health.value.step.inputDigest !== computeCycleRequestDigest(plan.value.request))
      issues.push("step.inputDigest:binding-mismatch");
  }
  if (health.value.targetSessionId !== plan.value.request.sessionRequest.sessionId)
    issues.push("targetSessionId:binding-mismatch");
  return issues.length ? invalid(...issues) : health;
}

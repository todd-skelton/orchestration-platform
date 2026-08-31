import { parseConfigurationProvenance } from "./configuration.js";
import {
  computeSessionHealthDigest,
  parseCyclePlan,
  parseSessionHealth,
  validateSessionHealthBinding,
  type CyclePlan,
  type SessionHealth,
} from "./cycle-entry.js";
import { parseWorkerHostRendererArtifacts } from "./dispatch.js";
import {
  computeDispatchPlanDigest,
  parseDispatchAllocationClaims,
  parseDispatchProcessCensus,
  parseDispatchPlan,
  parseWorkerLaunchReceipt,
  parseWorkerTerminalReceipt,
  validateDispatchPlanBinding,
  validateWorkerLaunchReceiptBinding,
  validateWorkerTerminalReceiptBinding,
  type DispatchAllocationClaim,
  type DispatchProcessCensus,
  type DispatchPlan,
  type WorkerLaunchReceipt,
  type WorkerTerminalReceipt,
} from "./dispatch-lifecycle.js";
import {
  computeActionDispositionDigest,
  parseActionDisposition,
  parseDispositionInput,
  parseFollowUpCycleRequest,
  validateActionDispositionBinding,
  validateFollowUpCycleRequestBinding,
  type ActionDisposition,
  type DispositionInput,
  type FollowUpCycleRequest,
} from "./disposition.js";
import {
  computeModuleNoActionDigest,
  parseModuleActionPlan,
  parseModuleNoAction,
  parseModulePlanInput,
  validateModulePlanBinding,
  type ModuleActionPlan,
  type ModuleNoAction,
  type ModulePlanInput,
} from "./module-plan.js";
import {
  computeProjectMutationPlanDigest,
  parseProjectApplyReceipt,
  parseProjectMutationObservation,
  parseProjectMutationPlan,
  parseProjectMutationRequest,
  parseProjectMutationValue,
  validateProjectApplyReceiptBinding,
  validateProjectMutationPlanBinding,
  validateProjectMutationRequestBinding,
  type ProjectApplyReceipt,
  type ProjectMutationObservation,
  type ProjectMutationPlan,
  type ProjectMutationRequest,
  type ProjectMutationValue,
} from "./project-mutation.js";
import {
  computeProjectPreflightDigest,
  parseProjectPreflight,
  parseProjectPreflightObservation,
  validateProjectPreflightBinding,
  type ProjectPreflight,
  type ProjectPreflightObservation,
} from "./project-preflight.js";
import { parseProjectBreakerFacts, type ProjectBreakerFacts } from "./project-breaker-facts.js";
import {
  parseProjectFacts,
  validateAdapterConfigurationBinding,
  validateProjectFactsBinding,
  type AdapterConfiguration,
  type ProjectFacts,
} from "./project-snapshot.js";
import { parseReviewRequest, type ReviewRequest } from "./review-request.js";
import {
  computeRouteSelectionDigest,
  parseRouteSelection,
  validateRouteSelectionBinding,
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
  isCanonicalTimestamp,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";
import {
  computeBreakerReceiptDigest,
  parseBreakerReceipt,
  validateBreakerReceiptBinding,
  type BreakerReceipt,
} from "./breaker-receipt.js";

export const resourceReclaimSchemaVersions = Object.freeze([
  "resource-reclaim-receipt/v1",
] as const);
export const reclaimOwnerUnknownReasons = Object.freeze([
  "AUTHORITY_UNPROVEN",
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "IDENTITY_CONFLICT",
  "RECLAIM_UNPROVEN",
  "UNSUPPORTED_RESOURCE",
] as const);
export const reclaimReceiptUnknownReasons = Object.freeze([
  "EARLIER_UNKNOWN",
  "PROCESS_LIVE",
  "PROCESS_UNPROVEN",
  "IDENTITY_CONFLICT",
  "OWNER_UNPROVEN",
  "RECLAIM_UNPROVEN",
  "AUTHORITY_UNPROVEN",
] as const);
export const resourceReclaimSchemaFields = Object.freeze({
  receipt: Object.freeze([
    "contextDigest",
    "cycleId",
    "observations",
    "outcome",
    "process",
    "reclaimTransactionId",
    "schemaVersion",
  ] as const),
  context: Object.freeze([
    "adapterConfiguration",
    "configurationProvenance",
    "cyclePlan",
    "origin",
    "sessionHealth",
    "skips",
  ] as const),
  session: Object.freeze(["health", "kind"] as const),
  snapshot: Object.freeze(["facts", "kind"] as const),
  breaker: Object.freeze(["facts", "kind", "policyFacts", "prior", "receipt"] as const),
  module: Object.freeze(["input", "kind", "result"] as const),
  preparation: Object.freeze([
    "action",
    "input",
    "kind",
    "launch",
    "mapping",
    "observation",
    "plan",
    "preflight",
    "reviewRequest",
    "route",
    "sessionHealth",
    "terminal",
  ] as const),
  action: Object.freeze([
    "disposition",
    "dispositionInput",
    "followUp",
    "kind",
    "mutation",
  ] as const),
  mutation: Object.freeze([
    "afterObservation",
    "beforeObservation",
    "dryObservation",
    "plan",
    "receipt",
    "request",
  ] as const),
  owner: Object.freeze([
    "after",
    "allocation",
    "before",
    "outcome",
    "reclaimTransactionId",
    "source",
  ] as const),
  observation: Object.freeze(["observationId", "observedAt", "result"] as const),
  complete: Object.freeze(["kind", "value"] as const),
  unknownObservation: Object.freeze(["kind", "reason"] as const),
  kind: Object.freeze(["kind"] as const),
  reason: Object.freeze(["kind", "reason"] as const),
  ownerUnknown: Object.freeze(["kind", "phase", "reason"] as const),
  observedProcess: Object.freeze([
    "handles",
    "kind",
    "observationId",
    "observedAt",
    "processes",
  ] as const),
  handles: Object.freeze(["process", "stderr", "stdin", "stdout"] as const),
});
export const resourceReclaimClosedValues = Object.freeze([
  "SESSION",
  "SNAPSHOT",
  "BREAKER",
  "MODULE",
  "PREPARATION",
  "ACTION",
  "DISPATCH",
  "MUTATION",
  "COMPLETE",
  "UNKNOWN",
  "NOT_ALLOCATED",
  "RECLAIMED",
  "RETAINED",
  "BEFORE_RECLAIM",
  "RECLAIMING",
  "AFTER_RECLAIM",
  "NOT_LAUNCHED",
  "OBSERVED",
  "NOT_CREATED",
  "CLOSED",
  "OPEN",
  "NO_ALLOCATION",
  "HANDLES_OPEN",
  "OWNER_REFUSED",
  "PROCESS_LIVE",
  "SESSION_UNHEALTHY",
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "IDENTITY_CONFLICT",
  "UNSUPPORTED_RESOURCE",
  "HANDLE_LOST",
  ...reclaimOwnerUnknownReasons,
  ...reclaimReceiptUnknownReasons,
] as const);

type ReclaimMutationTuple = Readonly<{
  afterObservation: ProjectMutationObservation | null;
  beforeObservation: ProjectMutationObservation | null;
  dryObservation: ProjectMutationObservation | null;
  plan: ProjectMutationPlan;
  receipt: ProjectApplyReceipt | null;
  request: ProjectMutationRequest;
}>;
export type ResourceReclaimOrigin =
  | Readonly<{ health: SessionHealth; kind: "SESSION" }>
  | Readonly<{ facts: ProjectFacts; kind: "SNAPSHOT" }>
  | Readonly<{
      facts: Extract<ProjectFacts, { state: "COMPLETE" }>;
      kind: "BREAKER";
      policyFacts: ProjectBreakerFacts;
      prior: BreakerReceipt | null;
      receipt: BreakerReceipt;
    }>
  | Readonly<{ input: ModulePlanInput; kind: "MODULE"; result: ModuleNoAction }>
  | Readonly<{
      action: ModuleActionPlan;
      input: ModulePlanInput;
      kind: "PREPARATION";
      launch: WorkerLaunchReceipt | null;
      mapping: readonly JsonValue[] | null;
      observation: ProjectPreflightObservation | null;
      plan: DispatchPlan | null;
      preflight: ProjectPreflight | null;
      reviewRequest: ReviewRequest | null;
      route: RouteSelection;
      sessionHealth: SessionHealth | null;
      terminal: WorkerTerminalReceipt | null;
    }>
  | Readonly<{
      disposition: ActionDisposition;
      dispositionInput: DispositionInput;
      followUp: FollowUpCycleRequest | null;
      kind: "ACTION";
      mutation: ReclaimMutationTuple | null;
    }>;
export type ResourceReclaimContext = Readonly<{
  adapterConfiguration: AdapterConfiguration;
  configurationProvenance: ContractRecord;
  cyclePlan: CyclePlan;
  origin: ResourceReclaimOrigin;
  sessionHealth: SessionHealth;
  skips: readonly RoutineStepSkip[];
}>;
export type ReclaimOwnerObservation = Readonly<{
  observationId: string | null;
  observedAt: string | null;
  result:
    | Readonly<{ kind: "COMPLETE"; value: ProjectMutationValue }>
    | Readonly<{
        kind: "UNKNOWN";
        reason:
          | "OBSERVATION_UNAVAILABLE"
          | "OBSERVATION_INVALID"
          | "IDENTITY_CONFLICT"
          | "UNSUPPORTED_RESOURCE";
      }>;
}>;
export type ReclaimOwnerRow = Readonly<{
  after: ReclaimOwnerObservation | null;
  allocation: DispatchAllocationClaim;
  before: ReclaimOwnerObservation | null;
  outcome:
    | Readonly<{ kind: "NOT_ALLOCATED" | "RECLAIMED" }>
    | Readonly<{
        kind: "RETAINED";
        reason: "HANDLES_OPEN" | "OWNER_REFUSED" | "PROCESS_LIVE" | "SESSION_UNHEALTHY";
      }>
    | Readonly<{
        kind: "UNKNOWN";
        phase: "BEFORE_RECLAIM" | "RECLAIMING" | "AFTER_RECLAIM";
        reason: (typeof reclaimOwnerUnknownReasons)[number];
      }>;
  reclaimTransactionId: string;
  source: "DISPATCH" | "MUTATION";
}>;
export type ReclaimProcessObservation =
  | Readonly<{ kind: "NOT_LAUNCHED" }>
  | Readonly<{
      kind: "UNKNOWN";
      reason: "OBSERVATION_UNAVAILABLE" | "IDENTITY_CONFLICT" | "HANDLE_LOST";
    }>
  | Readonly<{
      handles: Readonly<{
        process: "NOT_CREATED" | "CLOSED" | "OPEN" | "UNKNOWN";
        stderr: "NOT_CREATED" | "CLOSED" | "OPEN" | "UNKNOWN";
        stdin: "NOT_CREATED" | "CLOSED" | "OPEN" | "UNKNOWN";
        stdout: "NOT_CREATED" | "CLOSED" | "OPEN" | "UNKNOWN";
      }>;
      kind: "OBSERVED";
      observationId: string;
      observedAt: string;
      processes: DispatchProcessCensus;
    }>;
export type ResourceReclaimReceipt = Readonly<{
  contextDigest: string;
  cycleId: string;
  observations: readonly ReclaimOwnerRow[];
  outcome:
    | Readonly<{ kind: "NO_ALLOCATION" | "RECLAIMED" }>
    | Readonly<{
        kind: "RETAINED";
        reason: "HANDLES_OPEN" | "OWNER_REFUSED" | "SESSION_UNHEALTHY";
      }>
    | Readonly<{
        kind: "UNKNOWN";
        reason: (typeof reclaimReceiptUnknownReasons)[number];
      }>;
  process: ReclaimProcessObservation;
  reclaimTransactionId: string;
  schemaVersion: "resource-reclaim-receipt/v1";
}>;

const fields = resourceReclaimSchemaFields;
const invalid = <T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> => ({
  ok: false,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefix = (label: string, issues: readonly string[]) =>
  issues.map((issue) => `${label}.${issue}`);
const uuid = (value: JsonValue | undefined): value is string =>
  isUuidV7(value) && value.length === 36;
const member = (value: JsonValue | undefined, values: readonly string[]) =>
  typeof value === "string" && values.includes(value);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function plain(input: unknown): ParseResult {
  const parsed = snapshotJson(input);
  if (!parsed.ok) return parsed;
  return parsed.value !== null && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? { ok: true, value: parsed.value as ContractRecord }
    : invalid("record:object-required");
}
function nested(parsed: ParseResult, label: string, issues: string[]): void {
  if (!parsed.ok) issues.push(...prefix(label, parsed.issues));
}
function nullable<T extends ContractRecord>(
  value: JsonValue | undefined,
  parser: (input: unknown) => ParseResult<T>,
  label: string,
  issues: string[],
): T | null {
  if (value === null) return null;
  const parsed = parser(value);
  if (!parsed.ok) {
    issues.push(...prefix(label, parsed.issues));
    return null;
  }
  return parsed.value;
}

function parseMutationTuple(input: unknown): ParseResult<ReclaimMutationTuple> {
  const parsed = snapshotClosedRecord(input, fields.mutation);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  const request = parseProjectMutationRequest(row.request);
  const plan = parseProjectMutationPlan(row.plan);
  nested(request, "request", issues);
  nested(plan, "plan", issues);
  const dry = nullable(
    row.dryObservation,
    parseProjectMutationObservation,
    "dryObservation",
    issues,
  );
  const before = nullable(
    row.beforeObservation,
    parseProjectMutationObservation,
    "beforeObservation",
    issues,
  );
  const after = nullable(
    row.afterObservation,
    parseProjectMutationObservation,
    "afterObservation",
    issues,
  );
  const receipt = nullable(row.receipt, parseProjectApplyReceipt, "receipt", issues);
  if (!request.ok || !plan.ok || issues.length) return invalid(...issues);
  return {
    ok: true,
    value: {
      afterObservation: after,
      beforeObservation: before,
      dryObservation: dry,
      plan: plan.value,
      receipt,
      request: request.value,
    },
  };
}

function parseOrigin(input: unknown): ParseResult<ResourceReclaimOrigin> {
  const initial = plain(input);
  if (!initial.ok) return initial;
  const kind = initial.value.kind,
    expected =
      kind === "SESSION"
        ? fields.session
        : kind === "SNAPSHOT"
          ? fields.snapshot
          : kind === "BREAKER"
            ? fields.breaker
            : kind === "MODULE"
              ? fields.module
              : kind === "PREPARATION"
                ? fields.preparation
                : kind === "ACTION"
                  ? fields.action
                  : null;
  if (!expected) return invalid("kind:invalid");
  const parsed = snapshotClosedRecord(initial.value, expected);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (kind === "SESSION") nested(parseSessionHealth(row.health), "health", issues);
  else if (kind === "SNAPSHOT") nested(parseProjectFacts(row.facts), "facts", issues);
  else if (kind === "BREAKER") {
    const facts = parseProjectFacts(row.facts);
    nested(facts, "facts", issues);
    if (facts.ok && facts.value.state !== "COMPLETE") issues.push("facts:complete-required");
    nested(parseProjectBreakerFacts(row.policyFacts), "policyFacts", issues);
    nullable(row.prior, parseBreakerReceipt, "prior", issues);
    nested(parseBreakerReceipt(row.receipt), "receipt", issues);
  } else if (kind === "MODULE") {
    nested(parseModulePlanInput(row.input), "input", issues);
    nested(parseModuleNoAction(row.result), "result", issues);
  } else if (kind === "PREPARATION") {
    nested(parseModulePlanInput(row.input), "input", issues);
    nested(parseModuleActionPlan(row.action), "action", issues);
    nested(parseRouteSelection(row.route), "route", issues);
    if (row.mapping !== null) {
      const mapping = parseWorkerHostRendererArtifacts(row.mapping);
      if (!mapping.ok) issues.push(...prefix("mapping", mapping.issues));
    }
    nullable(row.observation, parseProjectPreflightObservation, "observation", issues);
    nullable(row.preflight, parseProjectPreflight, "preflight", issues);
    nullable(row.plan, parseDispatchPlan, "plan", issues);
    nullable(row.reviewRequest, parseReviewRequest, "reviewRequest", issues);
    nullable(row.sessionHealth, parseSessionHealth, "sessionHealth", issues);
    nullable(row.launch, parseWorkerLaunchReceipt, "launch", issues);
    nullable(row.terminal, parseWorkerTerminalReceipt, "terminal", issues);
  } else {
    nested(parseDispositionInput(row.dispositionInput), "dispositionInput", issues);
    nested(parseActionDisposition(row.disposition), "disposition", issues);
    nullable(row.followUp, parseFollowUpCycleRequest, "followUp", issues);
    if (row.mutation !== null) nested(parseMutationTuple(row.mutation), "mutation", issues);
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ResourceReclaimOrigin };
}

/** Complete retained context shape; no history selection or owner admission. */
export function parseResourceReclaimContext(input: unknown): ParseResult<ResourceReclaimContext> {
  const parsed = snapshotClosedRecord(input, fields.context);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  const provenance = parseConfigurationProvenance(row.configurationProvenance);
  const configuration = validateAdapterConfigurationBinding(
    row.adapterConfiguration,
    row.configurationProvenance,
  );
  const cycle = parseCyclePlan(row.cyclePlan);
  const health = parseSessionHealth(row.sessionHealth);
  const origin = parseOrigin(row.origin);
  nested(provenance, "configurationProvenance", issues);
  nested(configuration, "adapterConfiguration", issues);
  nested(cycle, "cyclePlan", issues);
  nested(health, "sessionHealth", issues);
  nested(origin, "origin", issues);
  if (configuration.ok && cycle.ok) {
    if (cycle.value.request.adapterId !== configuration.value.adapterId)
      issues.push("cyclePlan.request.adapterId:mismatch");
    if (
      cycle.value.request.sessionRequest.configurationProvenanceDigest !==
      canonicalDigest(row.configurationProvenance)
    )
      issues.push("cyclePlan.request.sessionRequest.configurationProvenanceDigest:mismatch");
  }
  if (cycle.ok && health.ok) {
    const sessionId = cycle.value.request.sessionRequest.sessionId;
    if (health.value.step !== null || health.value.targetSessionId !== sessionId)
      issues.push("sessionHealth:inspection-mismatch");
    if (health.value.outcome === "HEALTHY" && health.value.holderSessionId !== sessionId)
      issues.push("sessionHealth:holder-mismatch");
  }
  if (!Array.isArray(row.skips) || row.skips.length > 12) issues.push("skips:length-refused");
  else {
    let prior = "0";
    for (const [index, value] of row.skips.entries()) {
      const skip = parseRoutineStepSkip(value);
      if (!skip.ok) issues.push(...prefix(`skips.${index}`, skip.issues));
      else if (Number(skip.value.step.ordinal) <= Number(prior)) issues.push("skips:order-refused");
      else prior = skip.value.step.ordinal;
    }
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ResourceReclaimContext };
}

export function parseReclaimOwnerObservation(input: unknown): ParseResult<ReclaimOwnerObservation> {
  const parsed = snapshotClosedRecord(input, fields.observation);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  const result = plain(row.result);
  if (!result.ok) return invalid(...prefix("result", result.issues));
  if (result.value.kind === "COMPLETE") {
    issues.push(...closedRecord(result.value, fields.complete, "result"));
    nested(parseProjectMutationValue(result.value.value), "result.value", issues);
    if (!uuid(row.observationId) || !isCanonicalTimestamp(row.observedAt))
      issues.push("observation:identity-or-time-invalid");
  } else if (result.value.kind === "UNKNOWN") {
    issues.push(...closedRecord(result.value, fields.unknownObservation, "result"));
    if (
      !member(result.value.reason, [
        "OBSERVATION_UNAVAILABLE",
        "OBSERVATION_INVALID",
        "IDENTITY_CONFLICT",
        "UNSUPPORTED_RESOURCE",
      ])
    )
      issues.push("result.reason:invalid");
    const bothNull = row.observationId === null && row.observedAt === null;
    if (!bothNull && (!uuid(row.observationId) || !isCanonicalTimestamp(row.observedAt)))
      issues.push("observation:identity-time-pair-invalid");
  } else issues.push("result.kind:invalid");
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ReclaimOwnerObservation };
}

export function parseReclaimOwnerRow(input: unknown): ParseResult<ReclaimOwnerRow> {
  const parsed = snapshotClosedRecord(input, fields.owner);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  const allocations = parseDispatchAllocationClaims([row.allocation]);
  if (!allocations.ok) issues.push(...prefix("allocation", allocations.issues));
  if (!uuid(row.reclaimTransactionId)) issues.push("reclaimTransactionId:invalid");
  if (!member(row.source, ["DISPATCH", "MUTATION"])) issues.push("source:invalid");
  const before = nullable(row.before, parseReclaimOwnerObservation, "before", issues);
  const after = nullable(row.after, parseReclaimOwnerObservation, "after", issues);
  const outcome = plain(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefix("outcome", outcome.issues));
  const cell = outcome.value;
  if (cell.kind === "NOT_ALLOCATED" || cell.kind === "RECLAIMED")
    issues.push(...closedRecord(cell, fields.kind, "outcome"));
  else if (cell.kind === "RETAINED") {
    issues.push(...closedRecord(cell, fields.reason, "outcome"));
    if (
      !member(cell.reason, ["HANDLES_OPEN", "OWNER_REFUSED", "PROCESS_LIVE", "SESSION_UNHEALTHY"])
    )
      issues.push("outcome.reason:invalid");
  } else if (cell.kind === "UNKNOWN") {
    issues.push(...closedRecord(cell, fields.ownerUnknown, "outcome"));
    if (!member(cell.phase, ["BEFORE_RECLAIM", "RECLAIMING", "AFTER_RECLAIM"]))
      issues.push("outcome.phase:invalid");
    if (!member(cell.reason, reclaimOwnerUnknownReasons)) issues.push("outcome.reason:invalid");
    if (cell.phase === "BEFORE_RECLAIM" && after !== null)
      issues.push("after:null-before-reclaim-required");
  } else issues.push("outcome.kind:invalid");
  if (allocations.ok) {
    const allocation = allocations.value[0]!;
    if (allocation.state === "UNKNOWN" && cell.kind !== "UNKNOWN")
      issues.push("outcome:unknown-allocation-required");
    if (cell.kind === "NOT_ALLOCATED") {
      if (
        allocation.state !== "NOT_ALLOCATED" ||
        allocation.allocationId !== null ||
        before?.result.kind !== "COMPLETE" ||
        before.result.value.kind !== "ABSENT" ||
        after !== null
      )
        issues.push("outcome:not-allocated-matrix");
    } else if (cell.kind === "RECLAIMED") {
      if (
        allocation.state !== "ALLOCATED" ||
        allocation.allocationId === null ||
        before?.result.kind !== "COMPLETE" ||
        before.result.value.kind !== "PRESENT" ||
        after?.result.kind !== "COMPLETE" ||
        after.result.value.kind !== "ABSENT"
      )
        issues.push("outcome:reclaimed-matrix");
    } else if (cell.kind === "RETAINED") {
      if (allocation.state !== "ALLOCATED" || allocation.allocationId === null || after !== null)
        issues.push("outcome:retained-allocation-matrix");
      if (
        before !== null &&
        (before.result.kind !== "COMPLETE" || before.result.value.kind !== "PRESENT")
      )
        issues.push("before:retained-present-required");
      if (cell.reason === "OWNER_REFUSED" && before === null)
        issues.push("before:owner-refused-required");
    } else if (cell.kind === "UNKNOWN") {
      if (
        allocation.state === "ALLOCATED" &&
        before?.result.kind === "COMPLETE" &&
        before.result.value.kind === "ABSENT" &&
        cell.reason !== "IDENTITY_CONFLICT"
      )
        issues.push("outcome.reason:absent-allocation-identity-conflict-required");
      if (
        cell.phase === "AFTER_RECLAIM" &&
        after?.result.kind === "COMPLETE" &&
        after.result.value.kind === "PRESENT" &&
        cell.reason !== "IDENTITY_CONFLICT"
      )
        issues.push("outcome.reason:present-after-reclaim-identity-conflict-required");
    }
  }
  if (
    before?.observedAt !== null &&
    before?.observedAt !== undefined &&
    after?.observedAt !== null &&
    after?.observedAt !== undefined &&
    after.observedAt < before.observedAt &&
    !(cell.kind === "UNKNOWN" && cell.reason === "OBSERVATION_INVALID")
  )
    issues.push("after.observedAt:before-prior");
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ReclaimOwnerRow };
}

export function parseReclaimProcessObservation(
  input: unknown,
): ParseResult<ReclaimProcessObservation> {
  const initial = plain(input);
  if (!initial.ok) return initial;
  const row = initial.value,
    issues: string[] = [];
  if (row.kind === "NOT_LAUNCHED") issues.push(...closedRecord(row, fields.kind));
  else if (row.kind === "UNKNOWN") {
    issues.push(...closedRecord(row, fields.reason));
    if (!member(row.reason, ["OBSERVATION_UNAVAILABLE", "IDENTITY_CONFLICT", "HANDLE_LOST"]))
      issues.push("reason:invalid");
  } else if (row.kind === "OBSERVED") {
    issues.push(...closedRecord(row, fields.observedProcess));
    if (!uuid(row.observationId) || !isCanonicalTimestamp(row.observedAt))
      issues.push("identity-or-time:invalid");
    const census = parseDispatchProcessCensus(row.processes);
    nested(census, "processes", issues);
    const handles = snapshotClosedRecord(row.handles, fields.handles);
    if (!handles.ok) issues.push(...prefix("handles", handles.issues));
    else
      for (const key of fields.handles)
        if (!member(handles.value[key], ["NOT_CREATED", "CLOSED", "OPEN", "UNKNOWN"]))
          issues.push(`handles.${key}:invalid`);
  } else issues.push("kind:invalid");
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ReclaimProcessObservation };
}

/** Complete immutable claim only; owner admission and physical proof remain external. */
export function parseResourceReclaimReceipt(input: unknown): ParseResult<ResourceReclaimReceipt> {
  const parsed = snapshotClosedRecord(input, fields.receipt);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "resource-reclaim-receipt/v1") issues.push("schemaVersion:mismatch");
  if (typeof row.contextDigest !== "string" || !/^[0-9a-f]{64}$/.test(row.contextDigest))
    issues.push("contextDigest:invalid");
  for (const key of ["cycleId", "reclaimTransactionId"] as const)
    if (!uuid(row[key])) issues.push(`${key}:invalid`);
  const process = parseReclaimProcessObservation(row.process);
  nested(process, "process", issues);
  if (!Array.isArray(row.observations) || row.observations.length > 320)
    issues.push("observations:length-refused");
  else {
    let previous: string | undefined;
    const ids = new Set<string>();
    if (process.ok && process.value.kind === "OBSERVED") ids.add(process.value.observationId);
    for (const [index, value] of row.observations.entries()) {
      const owner = parseReclaimOwnerRow(value);
      if (!owner.ok) {
        issues.push(...prefix(`observations.${index}`, owner.issues));
        continue;
      }
      const item = owner.value;
      const key = `${item.source}\0${item.allocation.owner}\0${item.allocation.resourceIdentityDigest}`;
      if (previous !== undefined && previous >= key) issues.push("observations:order-refused");
      previous = key;
      if (item.reclaimTransactionId !== row.reclaimTransactionId)
        issues.push(`observations.${index}.reclaimTransactionId:mismatch`);
      for (const observation of [item.before, item.after]) {
        if (observation?.observationId !== null && observation?.observationId !== undefined) {
          if (ids.has(observation.observationId)) issues.push("observations:observationId-reused");
          ids.add(observation.observationId);
        }
      }
    }
  }
  const outcome = plain(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefix("outcome", outcome.issues));
  if (outcome.value.kind === "NO_ALLOCATION" || outcome.value.kind === "RECLAIMED")
    issues.push(...closedRecord(outcome.value, fields.kind, "outcome"));
  else if (outcome.value.kind === "RETAINED") {
    issues.push(...closedRecord(outcome.value, fields.reason, "outcome"));
    if (!member(outcome.value.reason, ["HANDLES_OPEN", "OWNER_REFUSED", "SESSION_UNHEALTHY"]))
      issues.push("outcome.reason:invalid");
  } else if (outcome.value.kind === "UNKNOWN") {
    issues.push(...closedRecord(outcome.value, fields.reason, "outcome"));
    if (!member(outcome.value.reason, reclaimReceiptUnknownReasons))
      issues.push("outcome.reason:invalid");
  } else issues.push("outcome.kind:invalid");
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as ResourceReclaimReceipt };
}

export function computeResourceReclaimContextDigest(input: unknown): string {
  const parsed = parseResourceReclaimContext(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}
export function computeResourceReclaimReceiptDigest(input: unknown): string {
  const parsed = parseResourceReclaimReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("resource-reclaim-receipt/v1", [frame.canonical(parsed.value)]);
}

type OriginBinding = Readonly<{
  allocations: readonly Readonly<{
    allocation: DispatchAllocationClaim;
    source: "DISPATCH" | "MUTATION";
  }>[];
  earlierLive: boolean;
  earlierUnknown: boolean;
  launch: WorkerLaunchReceipt | null;
  terminal: WorkerTerminalReceipt | null;
}>;

function validateSkipSuffix(
  context: ResourceReclaimContext,
  firstOrdinal: number,
  firstDigest: string,
  reason: "prior-known-terminal" | "no-mutation",
  issues: string[],
): void {
  const expected = Array.from({ length: 14 - firstOrdinal }, (_, index) =>
    String(firstOrdinal + index),
  );
  if (context.skips.length !== expected.length) {
    issues.push("context.skips:path-mismatch");
    return;
  }
  let prior = firstDigest;
  for (const [index, skip] of context.skips.entries()) {
    if (
      skip.step.ordinal !== expected[index] ||
      skip.reason !== reason ||
      skip.step.cycleId !== context.cyclePlan.request.cycleId ||
      skip.step.inputDigest !== prior
    )
      issues.push(`context.skips.${index}:path-mismatch`);
    prior = computeRoutineStepSkipDigest(skip);
  }
}

function bindOrigin(
  context: ResourceReclaimContext,
  rendered: unknown,
  stdout: unknown,
  stderr: unknown,
): ParseResult<OriginBinding> {
  const origin = context.origin,
    issues: string[] = [],
    empty: OriginBinding = {
      allocations: [],
      earlierLive: false,
      earlierUnknown: false,
      launch: null,
      terminal: null,
    };
  if (origin.kind === "SESSION") {
    const health = validateSessionHealthBinding(origin.health, context.cyclePlan);
    nested(health, "origin.health", issues);
    if (health.ok && health.value.outcome === "HEALTHY")
      issues.push("origin.health:terminal-required");
    if (origin.health.outcome === "UNKNOWN") {
      if (context.skips.length) issues.push("context.skips:empty-required");
    } else
      validateSkipSuffix(
        context,
        2,
        computeSessionHealthDigest(origin.health),
        "prior-known-terminal",
        issues,
      );
    if (rendered !== null || stdout !== null || stderr !== null) issues.push("bytes:null-required");
    return issues.length
      ? invalid(...issues)
      : { ok: true, value: { ...empty, earlierUnknown: origin.health.outcome === "UNKNOWN" } };
  }
  if (origin.kind === "SNAPSHOT") {
    const facts = validateProjectFactsBinding(origin.facts, context.adapterConfiguration);
    nested(facts, "origin.facts", issues);
    if (facts.ok && facts.value.state === "COMPLETE") issues.push("origin.facts:terminal-required");
    if (context.skips.length) issues.push("context.skips:empty-required");
    if (rendered !== null || stdout !== null || stderr !== null) issues.push("bytes:null-required");
    return issues.length
      ? invalid(...issues)
      : { ok: true, value: { ...empty, earlierUnknown: true } };
  }
  if (origin.kind === "BREAKER") {
    const binding = validateBreakerReceiptBinding(
      context.configurationProvenance,
      context.adapterConfiguration,
      context.cyclePlan.request,
      origin.facts,
      origin.policyFacts,
      origin.prior,
      origin.receipt,
    );
    nested(binding, "origin.receipt", issues);
    const unknown = origin.receipt.result.kind === "UNKNOWN";
    if (
      origin.receipt.result.kind === "KNOWN" &&
      origin.receipt.result.capabilities.every((capability) => capability.state === "CLOSED")
    )
      issues.push("origin.receipt:terminal-required");
    if (unknown) {
      if (context.skips.length) issues.push("context.skips:empty-required");
    } else
      validateSkipSuffix(
        context,
        4,
        computeBreakerReceiptDigest(origin.receipt),
        "prior-known-terminal",
        issues,
      );
    if (rendered !== null || stdout !== null || stderr !== null) issues.push("bytes:null-required");
    return issues.length
      ? invalid(...issues)
      : { ok: true, value: { ...empty, earlierUnknown: unknown } };
  }
  if (origin.kind === "MODULE") {
    const binding = validateModulePlanBinding(origin.input, origin.result);
    nested(binding, "origin.result", issues);
    if (!same(origin.input.adapterConfiguration, context.adapterConfiguration))
      issues.push("origin.input.adapterConfiguration:mismatch");
    if (!same(origin.input.configurationProvenance, context.configurationProvenance))
      issues.push("origin.input.configurationProvenance:mismatch");
    if (!same(origin.input.cycleRequest, context.cyclePlan.request))
      issues.push("origin.input.cycleRequest:mismatch");
    validateSkipSuffix(
      context,
      5,
      computeModuleNoActionDigest(origin.result),
      "prior-known-terminal",
      issues,
    );
    if (rendered !== null || stdout !== null || stderr !== null) issues.push("bytes:null-required");
    return issues.length ? invalid(...issues) : { ok: true, value: empty };
  }
  if (origin.kind === "PREPARATION") {
    const route = validateRouteSelectionBinding(
      origin.input,
      origin.action,
      origin.mapping,
      origin.route,
    );
    nested(route, "origin.route", issues);
    if (!same(origin.input.adapterConfiguration, context.adapterConfiguration))
      issues.push("origin.input.adapterConfiguration:mismatch");
    if (!same(origin.input.configurationProvenance, context.configurationProvenance))
      issues.push("origin.input.configurationProvenance:mismatch");
    if (!same(origin.input.cycleRequest, context.cyclePlan.request))
      issues.push("origin.input.cycleRequest:mismatch");
    let earlierUnknown = origin.route.outcome.kind === "UNKNOWN";
    if (origin.preflight === null) {
      if (
        origin.observation !== null ||
        origin.plan !== null ||
        origin.reviewRequest !== null ||
        origin.sessionHealth !== null ||
        origin.launch !== null ||
        origin.terminal !== null
      )
        issues.push("origin:route-stop-matrix");
      if (!member(origin.route.outcome.kind, ["REFUSED", "UNKNOWN"]))
        issues.push("origin.route:terminal-required");
      if (earlierUnknown) {
        if (context.skips.length) issues.push("context.skips:empty-required");
      } else
        validateSkipSuffix(
          context,
          6,
          computeRouteSelectionDigest(origin.route),
          "prior-known-terminal",
          issues,
        );
      if (rendered !== null || stdout !== null || stderr !== null)
        issues.push("bytes:null-required");
      return issues.length ? invalid(...issues) : { ok: true, value: { ...empty, earlierUnknown } };
    }
    const preflight = validateProjectPreflightBinding(
      origin.input,
      origin.action,
      origin.mapping,
      origin.route,
      origin.observation,
      origin.preflight,
    );
    nested(preflight, "origin.preflight", issues);
    earlierUnknown ||= origin.preflight.outcome.kind === "UNKNOWN";
    if (origin.plan === null) {
      if (
        origin.reviewRequest !== null ||
        origin.sessionHealth !== null ||
        origin.launch !== null ||
        origin.terminal !== null
      )
        issues.push("origin:preflight-stop-matrix");
      if (!member(origin.preflight.outcome.kind, ["REFUSED", "UNKNOWN"]))
        issues.push("origin.preflight:terminal-required");
      if (earlierUnknown) {
        if (context.skips.length) issues.push("context.skips:empty-required");
      } else
        validateSkipSuffix(
          context,
          7,
          computeProjectPreflightDigest(origin.preflight),
          "prior-known-terminal",
          issues,
        );
      if (rendered !== null || stdout !== null || stderr !== null)
        issues.push("bytes:null-required");
      return issues.length ? invalid(...issues) : { ok: true, value: { ...empty, earlierUnknown } };
    }
    if (origin.sessionHealth === null) issues.push("origin.sessionHealth:required");
    else {
      const plan = validateDispatchPlanBinding(
        origin.input,
        origin.action,
        origin.mapping,
        origin.route,
        origin.observation,
        origin.preflight,
        context.cyclePlan,
        origin.sessionHealth,
        origin.reviewRequest,
        rendered,
        origin.plan,
      );
      nested(plan, "origin.plan", issues);
    }
    earlierUnknown ||= origin.plan.outcome.kind === "UNKNOWN";
    if (origin.launch === null) {
      if (origin.terminal !== null) issues.push("origin.terminal:null-required");
      if (!member(origin.plan.outcome.kind, ["REFUSED", "UNKNOWN"]))
        issues.push("origin.plan:terminal-required");
      if (earlierUnknown) {
        if (context.skips.length) issues.push("context.skips:empty-required");
      } else
        validateSkipSuffix(
          context,
          8,
          computeDispatchPlanDigest(origin.plan),
          "prior-known-terminal",
          issues,
        );
      if (stdout !== null || stderr !== null) issues.push("capture-bytes:null-required");
      return issues.length ? invalid(...issues) : { ok: true, value: { ...empty, earlierUnknown } };
    }
    nested(validateWorkerLaunchReceiptBinding(origin.plan, origin.launch), "origin.launch", issues);
    earlierUnknown ||= origin.launch.outcome.kind === "UNKNOWN";
    const earlierLive = origin.launch.outcome.kind === "LIVE";
    if (origin.terminal !== null)
      nested(
        validateWorkerTerminalReceiptBinding(
          origin.plan,
          origin.launch,
          stdout,
          stderr,
          origin.terminal,
        ),
        "origin.terminal",
        issues,
      );
    if (origin.launch.outcome.kind === "LIVE" && origin.terminal === null)
      issues.push("origin.terminal:required-for-live-launch");
    if (
      origin.terminal?.outcome.kind === "UNKNOWN" ||
      origin.terminal?.outcome.kind === "TERMINATION_FAILED_LIVE"
    )
      earlierUnknown = true;
    if (
      origin.terminal?.outcome.kind === "EXITED" ||
      origin.terminal?.outcome.kind === "START_FAILED"
    )
      issues.push("origin:known-terminal-must-continue-to-action");
    if (!earlierUnknown && !earlierLive)
      issues.push("origin:known-terminal-must-continue-to-action");
    if (context.skips.length) issues.push("context.skips:empty-required");
    const allocations = origin.launch.resources.map((allocation) => ({
      allocation,
      source: "DISPATCH" as const,
    }));
    return issues.length
      ? invalid(...issues)
      : {
          ok: true,
          value: {
            allocations,
            earlierLive,
            earlierUnknown,
            launch: origin.launch,
            terminal: origin.terminal,
          },
        };
  }
  const disposition = validateActionDispositionBinding(
    origin.dispositionInput,
    stdout,
    stderr,
    origin.disposition,
  );
  nested(disposition, "origin.disposition", issues);
  if (rendered !== null) issues.push("renderedInputBytes:null-required");
  if (!same(origin.dispositionInput.moduleInput.adapterConfiguration, context.adapterConfiguration))
    issues.push("origin.dispositionInput.moduleInput.adapterConfiguration:mismatch");
  if (
    !same(
      origin.dispositionInput.moduleInput.configurationProvenance,
      context.configurationProvenance,
    )
  )
    issues.push("origin.dispositionInput.moduleInput.configurationProvenance:mismatch");
  if (!same(origin.dispositionInput.moduleInput.cycleRequest, context.cyclePlan.request))
    issues.push("origin.dispositionInput.moduleInput.cycleRequest:mismatch");
  const followIntent =
    "followUp" in origin.disposition.outcome && origin.disposition.outcome.followUp !== null;
  if (followIntent) {
    if (origin.followUp === null) issues.push("origin.followUp:required");
    else
      nested(
        validateFollowUpCycleRequestBinding(
          origin.dispositionInput,
          stdout,
          stderr,
          origin.disposition,
          origin.followUp,
        ),
        "origin.followUp",
        issues,
      );
  } else if (origin.followUp !== null) issues.push("origin.followUp:null-required");
  const worker = origin.dispositionInput.worker;
  const dispatchAllocations =
    worker?.launch.resources.map((allocation) => ({ allocation, source: "DISPATCH" as const })) ??
    [];
  const launch = worker?.launch ?? null;
  const terminal = worker?.terminal ?? null;
  let mutationAllocations: OriginBinding["allocations"] = [];
  let earlierUnknown = origin.disposition.outcome.kind === "UNKNOWN";
  if (origin.disposition.outcome.kind === "APPLY") {
    if (origin.disposition.outcome.operation !== "PROJECT")
      issues.push("origin.disposition:project-only");
    if (origin.mutation === null) issues.push("origin.mutation:required");
    else {
      const mutation = origin.mutation;
      nested(
        validateProjectMutationRequestBinding(
          origin.dispositionInput,
          stdout,
          stderr,
          origin.disposition,
          mutation.request,
        ),
        "origin.mutation.request",
        issues,
      );
      nested(
        validateProjectMutationPlanBinding(
          origin.dispositionInput,
          stdout,
          stderr,
          origin.disposition,
          mutation.request,
          mutation.dryObservation,
          mutation.plan,
        ),
        "origin.mutation.plan",
        issues,
      );
      earlierUnknown ||= mutation.plan.outcome.kind === "UNKNOWN";
      if (mutation.plan.outcome.kind === "PLANNED") {
        if (mutation.receipt === null) issues.push("origin.mutation.receipt:required");
        else {
          nested(
            validateProjectApplyReceiptBinding(
              origin.dispositionInput,
              stdout,
              stderr,
              origin.disposition,
              mutation.request,
              mutation.dryObservation,
              mutation.plan,
              computeProjectMutationPlanDigest(mutation.plan),
              mutation.beforeObservation,
              mutation.afterObservation,
              mutation.receipt,
            ),
            "origin.mutation.receipt",
            issues,
          );
          earlierUnknown ||= mutation.receipt.outcome.kind === "UNKNOWN";
          mutationAllocations = mutation.receipt.resources.map((allocation) => ({
            allocation,
            source: "MUTATION" as const,
          }));
        }
        if (context.skips.length) issues.push("context.skips:empty-required");
      } else {
        if (
          mutation.beforeObservation !== null ||
          mutation.afterObservation !== null ||
          mutation.receipt !== null
        )
          issues.push("origin.mutation:plan-stop-null-matrix");
        if (mutation.plan.outcome.kind === "UNKNOWN") {
          if (context.skips.length) issues.push("context.skips:empty-required");
        } else
          validateSkipSuffix(
            context,
            13,
            computeProjectMutationPlanDigest(mutation.plan),
            "prior-known-terminal",
            issues,
          );
      }
    }
  } else {
    if (origin.mutation !== null) issues.push("origin.mutation:null-required");
    if (origin.disposition.outcome.kind === "UNKNOWN") {
      if (context.skips.length) issues.push("context.skips:empty-required");
    } else
      validateSkipSuffix(
        context,
        12,
        computeActionDispositionDigest(origin.disposition),
        "no-mutation",
        issues,
      );
  }
  return issues.length
    ? invalid(...issues)
    : {
        ok: true,
        value: {
          allocations: [...dispatchAllocations, ...mutationAllocations],
          earlierLive: false,
          earlierUnknown,
          launch,
          terminal,
        },
      };
}

function allocationKey(source: string, allocation: DispatchAllocationClaim): string {
  return `${source}\0${allocation.owner}\0${allocation.resourceIdentityDigest}`;
}
function noEffects(rows: readonly ReclaimOwnerRow[]): boolean {
  return rows.every(
    (row) =>
      row.after === null &&
      row.outcome.kind !== "RECLAIMED" &&
      (row.outcome.kind !== "UNKNOWN" || row.outcome.phase === "BEFORE_RECLAIM"),
  );
}
function processFacts(
  process: ReclaimProcessObservation,
  launch: WorkerLaunchReceipt | null,
  terminal: WorkerTerminalReceipt | null,
  issues: string[],
): { closed: boolean; live: boolean; open: boolean; uncertain: boolean; conflict: boolean } {
  if (launch === null) {
    if (process.kind !== "NOT_LAUNCHED") issues.push("receipt.process:not-launched-required");
    return {
      closed: process.kind === "NOT_LAUNCHED",
      live: false,
      open: false,
      uncertain: process.kind !== "NOT_LAUNCHED",
      conflict: false,
    };
  }
  if (process.kind === "NOT_LAUNCHED") {
    issues.push("receipt.process:launch-observation-required");
    return { closed: false, live: false, open: false, uncertain: true, conflict: false };
  }
  if (process.kind === "UNKNOWN")
    return {
      closed: false,
      live: false,
      open: false,
      uncertain: true,
      conflict: process.reason === "IDENTITY_CONFLICT",
    };
  const expected = terminal?.processes ?? launch.processes;
  let conflict = process.processes.entries.length !== expected.entries.length;
  const actual = new Map(process.processes.entries.map((row) => [row.processId, row]));
  for (const row of expected.entries) {
    const observed = actual.get(row.processId);
    if (
      !observed ||
      observed.parentProcessId !== row.parentProcessId ||
      (row.state === "DEAD" && observed.state === "LIVE")
    )
      conflict = true;
  }
  const referenceTime = terminal?.observedAt ?? launch.observedAt;
  if (referenceTime !== null && process.observedAt < referenceTime) conflict = true;
  const statuses = Object.values(process.handles);
  const open = statuses.includes("OPEN");
  const uncertain =
    process.processes.completeness !== "COMPLETE" ||
    statuses.includes("UNKNOWN") ||
    (process.processes.entries.length > 0 && process.handles.process === "NOT_CREATED");
  const live = process.processes.entries.some((row) => row.state === "LIVE");
  const closed =
    !conflict &&
    !uncertain &&
    !live &&
    !open &&
    process.processes.entries.every((row) => row.state === "DEAD") &&
    (process.processes.entries.length
      ? process.handles.process === "CLOSED"
      : member(process.handles.process, ["CLOSED", "NOT_CREATED"])) &&
    [process.handles.stdin, process.handles.stdout, process.handles.stderr].every((status) =>
      member(status, ["CLOSED", "NOT_CREATED"]),
    );
  return { closed, live, open, uncertain, conflict };
}

/** Supplied tuple relation only. Matching bytes and claims do not prove ownership or deletion. */
export function validateResourceReclaimReceiptBinding(
  contextInput: unknown,
  renderedInputBytesOrNull: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  receiptInput: unknown,
): ParseResult<ResourceReclaimReceipt> {
  const context = parseResourceReclaimContext(contextInput);
  if (!context.ok) return invalid(...prefix("context", context.issues));
  const receipt = parseResourceReclaimReceipt(receiptInput);
  if (!receipt.ok) return invalid(...prefix("receipt", receipt.issues));
  const binding = bindOrigin(
    context.value,
    renderedInputBytesOrNull,
    stdoutBytesOrNull,
    stderrBytesOrNull,
  );
  if (!binding.ok) return invalid(...prefix("context.origin", binding.issues));
  const row = receipt.value,
    source = binding.value,
    issues: string[] = [];
  if (row.contextDigest !== canonicalDigest(context.value))
    issues.push("receipt.contextDigest:mismatch");
  if (row.cycleId !== context.value.cyclePlan.request.cycleId)
    issues.push("receipt.cycleId:mismatch");
  if (
    source.allocations.some(
      (item) => item.allocation.ownerTransactionId === row.reclaimTransactionId,
    )
  )
    issues.push("receipt.reclaimTransactionId:owner-transaction-collision");
  const expected = [...source.allocations].sort((a, b) => {
    const left = allocationKey(a.source, a.allocation),
      right = allocationKey(b.source, b.allocation);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (expected.length !== row.observations.length)
    issues.push("receipt.observations:census-mismatch");
  for (const [index, owner] of row.observations.entries()) {
    const actual = expected[index];
    if (!actual || owner.source !== actual.source || !same(owner.allocation, actual.allocation))
      issues.push(`receipt.observations.${index}:allocation-mismatch`);
  }
  const crossKeys = new Map<string, string>(),
    allocationIds = new Map<string, string>(),
    ownerTransactions = new Map<string, string>();
  let collision = false;
  for (const item of expected) {
    const base = `${item.allocation.owner}\0${item.allocation.resourceIdentityDigest}`;
    const priorSource = crossKeys.get(base);
    if (priorSource && priorSource !== item.source) collision = true;
    crossKeys.set(base, item.source);
    if (item.allocation.allocationId !== null) {
      const priorAllocationSource = allocationIds.get(item.allocation.allocationId);
      if (priorAllocationSource && priorAllocationSource !== item.source) collision = true;
      allocationIds.set(item.allocation.allocationId, item.source);
    }
    const prior = ownerTransactions.get(item.allocation.ownerTransactionId);
    if (prior && prior !== item.source) collision = true;
    ownerTransactions.set(item.allocation.ownerTransactionId, item.source);
  }
  const process = processFacts(row.process, source.launch, source.terminal, issues);
  const session = context.value.sessionHealth.outcome;
  for (const owner of row.observations) {
    if (
      owner.allocation.state === "UNKNOWN" &&
      !(
        owner.outcome.kind === "UNKNOWN" &&
        owner.outcome.phase === "BEFORE_RECLAIM" &&
        owner.after === null
      )
    )
      issues.push("receipt.observations:unknown-allocation-matrix");
  }
  const outcome = row.outcome;
  const preOwnerGate = process.open || session === "REFUSED";
  if (preOwnerGate && !noEffects(row.observations))
    issues.push("receipt.observations:pre-owner-no-effects");
  if (
    preOwnerGate &&
    outcome.kind === "UNKNOWN" &&
    row.observations.some((owner) => {
      if (owner.outcome.kind === "UNKNOWN")
        return owner.outcome.phase !== "BEFORE_RECLAIM" || owner.after !== null;
      if (owner.outcome.kind === "NOT_ALLOCATED") return false;
      return !(
        owner.outcome.kind === "RETAINED" &&
        ((process.open && owner.outcome.reason === "HANDLES_OPEN") ||
          (session === "REFUSED" && owner.outcome.reason === "SESSION_UNHEALTHY"))
      );
    })
  )
    issues.push("receipt.observations:pre-owner-unknown-row-matrix");
  const identityConflict = collision || process.conflict;
  const strictUnknownRows = row.observations.every(
    (owner) =>
      owner.outcome.kind === "UNKNOWN" &&
      owner.outcome.phase === "BEFORE_RECLAIM" &&
      owner.after === null,
  );
  if (source.earlierUnknown) {
    if (!(outcome.kind === "UNKNOWN" && outcome.reason === "EARLIER_UNKNOWN") || !strictUnknownRows)
      issues.push("receipt.outcome:earlier-unknown-matrix");
  } else if ((source.earlierLive || process.live) && !identityConflict) {
    if (
      !(outcome.kind === "UNKNOWN" && outcome.reason === "PROCESS_LIVE") ||
      !noEffects(row.observations) ||
      row.observations.some(
        (owner) =>
          owner.outcome.kind !== "NOT_ALLOCATED" &&
          !(owner.outcome.kind === "UNKNOWN" && owner.outcome.phase === "BEFORE_RECLAIM") &&
          !(owner.outcome.kind === "RETAINED" && owner.outcome.reason === "PROCESS_LIVE"),
      )
    )
      issues.push("receipt.outcome:process-live-matrix");
  } else if (identityConflict) {
    if (
      !(outcome.kind === "UNKNOWN" && outcome.reason === "IDENTITY_CONFLICT") ||
      !strictUnknownRows
    )
      issues.push("receipt.outcome:identity-conflict-matrix");
  } else if (session === "UNKNOWN") {
    if (
      !(outcome.kind === "UNKNOWN" && outcome.reason === "AUTHORITY_UNPROVEN") ||
      !strictUnknownRows
    )
      issues.push("receipt.outcome:authority-unproven-matrix");
  } else if (process.uncertain) {
    if (
      !(outcome.kind === "UNKNOWN" && outcome.reason === "PROCESS_UNPROVEN") ||
      !strictUnknownRows
    )
      issues.push("receipt.outcome:process-unproven-matrix");
  } else if (row.observations.some((owner) => owner.outcome.kind === "UNKNOWN")) {
    const partial = row.observations.some(
      (owner) => owner.outcome.kind === "UNKNOWN" && owner.outcome.phase !== "BEFORE_RECLAIM",
    );
    if (!(
      outcome.kind === "UNKNOWN" &&
      outcome.reason === (partial ? "RECLAIM_UNPROVEN" : "OWNER_UNPROVEN")
    ))
      issues.push("receipt.outcome:owner-unknown-matrix");
  } else if (process.open) {
    if (
      !(outcome.kind === "RETAINED" && outcome.reason === "HANDLES_OPEN") ||
      row.observations.some(
        (owner) =>
          owner.allocation.state === "ALLOCATED" &&
          !(owner.outcome.kind === "RETAINED" && owner.outcome.reason === "HANDLES_OPEN"),
      )
    )
      issues.push("receipt.outcome:handles-open-matrix");
  } else if (
    session === "REFUSED" &&
    row.observations.some((owner) => owner.allocation.state === "ALLOCATED")
  ) {
    if (
      !(outcome.kind === "RETAINED" && outcome.reason === "SESSION_UNHEALTHY") ||
      row.observations.some(
        (owner) =>
          owner.allocation.state === "ALLOCATED" &&
          !(owner.outcome.kind === "RETAINED" && owner.outcome.reason === "SESSION_UNHEALTHY"),
      )
    )
      issues.push("receipt.outcome:session-unhealthy-matrix");
  } else if (
    row.observations.some(
      (owner) => owner.outcome.kind === "RETAINED" && owner.outcome.reason === "OWNER_REFUSED",
    )
  ) {
    if (
      !(outcome.kind === "RETAINED" && outcome.reason === "OWNER_REFUSED") ||
      row.observations.some(
        (owner) =>
          owner.outcome.kind !== "NOT_ALLOCATED" &&
          owner.outcome.kind !== "RECLAIMED" &&
          !(owner.outcome.kind === "RETAINED" && owner.outcome.reason === "OWNER_REFUSED"),
      )
    )
      issues.push("receipt.outcome:owner-refused-matrix");
  } else if (
    row.observations.every((owner) => owner.outcome.kind === "NOT_ALLOCATED") &&
    process.closed
  ) {
    if (outcome.kind !== "NO_ALLOCATION") issues.push("receipt.outcome:no-allocation-required");
  } else if (
    row.observations.some((owner) => owner.outcome.kind === "RECLAIMED") &&
    row.observations.every(
      (owner) => owner.outcome.kind === "NOT_ALLOCATED" || owner.outcome.kind === "RECLAIMED",
    ) &&
    session === "HEALTHY" &&
    process.closed
  ) {
    if (outcome.kind !== "RECLAIMED") issues.push("receipt.outcome:reclaimed-required");
  } else issues.push("receipt.outcome:unmatched-matrix");
  return issues.length ? invalid(...issues) : receipt;
}

export function parseResourceReclaimContract(schema: string, input: unknown): ParseResult | null {
  return schema === "resource-reclaim-receipt/v1" ? parseResourceReclaimReceipt(input) : null;
}

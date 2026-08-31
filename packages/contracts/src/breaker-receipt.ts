import { computeCycleRequestDigest, parseCycleRequest } from "./cycle-entry.js";
import { parseConfigurationProvenance } from "./configuration.js";
import {
  parseProjectBreakerFacts,
  validateProjectBreakerFactsBinding,
} from "./project-breaker-facts.js";
import {
  parseAdapterConfiguration,
  validateAdapterConfigurationBinding,
  validateProjectFactsBinding,
  type AdapterConfiguration,
  type ProjectFacts,
} from "./project-snapshot.js";
import {
  canonicalDigest,
  canonicalJson,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const breakerReceiptSchemaVersions = Object.freeze(["breaker-receipt/v1"] as const);
export const breakerCheckpointStates = Object.freeze([
  "CLOSED",
  "OPEN",
  "RECOVERY_PENDING",
  "PROBE_IN_FLIGHT",
  "CLOSED_RECOVERED",
] as const);
export const breakerUnknownReasons = Object.freeze([
  "HISTORY_UNPROVEN",
  "CONFIGURATION_CHANGED",
  "POLICY_CHANGED",
  "INPUT_UNAVAILABLE",
  "INPUT_UNKNOWN",
  "INVALID_TRANSITION",
  "RECOVERY_UNAVAILABLE",
  "RECOVERY_UNKNOWN",
  "PROBE_UNKNOWN",
] as const);
export const breakerOperationKinds = Object.freeze([
  "REQUEST_RECOVERY",
  "START_PROBE",
  "FINISH_PROBE",
] as const);
export const breakerRecoveryDecisions = Object.freeze([
  "ALLOW_RECOVERY",
  "KEEP_HOLD",
  "UNAVAILABLE",
  "UNKNOWN",
] as const);
export const breakerProbeOutcomes = Object.freeze(["SUCCEEDED", "FAILED", "UNKNOWN"] as const);
export const breakerReceiptSchemaFields = Object.freeze({
  receipt: Object.freeze([
    "adapterConfigurationDigest",
    "cycleId",
    "cycleRequestDigest",
    "operations",
    "policyFactsDigest",
    "policyIdentity",
    "priorReceiptDigest",
    "result",
    "schemaVersion",
    "sessionId",
  ] as const),
  policyIdentity: Object.freeze(["adapterId", "adapterVersion", "policyVersion"] as const),
  operation: Object.freeze(["capabilityName", "kind", "observation"] as const),
  opening: Object.freeze(["cycleRequestDigest", "policyFactsDigest"] as const),
  recovery: Object.freeze([
    "adapterConfigurationDigest",
    "capabilityName",
    "decision",
    "observationId",
    "observedAt",
    "openReceiptDigest",
    "policyIdentity",
    "projectFactsDigest",
    "transactionId",
  ] as const),
  recoveryRequest: Object.freeze([
    "adapterConfiguration",
    "capabilityName",
    "observationId",
    "openReceipt",
    "policyIdentity",
    "projectFacts",
    "transactionId",
  ] as const),
  probe: Object.freeze(["probeId", "recoveryDigest", "startedAt"] as const),
  completion: Object.freeze([
    "finishedAt",
    "outcome",
    "probeId",
    "recoveryDigest",
    "startedAt",
  ] as const),
  known: Object.freeze(["capabilities", "kind"] as const),
  unknown: Object.freeze(["blockedCapabilityNames", "kind", "reason"] as const),
  closed: Object.freeze(["capabilityName", "state"] as const),
  open: Object.freeze(["capabilityName", "opening", "state"] as const),
  recoveryPending: Object.freeze(["capabilityName", "opening", "recovery", "state"] as const),
  probeInFlight: Object.freeze([
    "capabilityName",
    "opening",
    "probe",
    "recovery",
    "state",
  ] as const),
  closedRecovered: Object.freeze([
    "capabilityName",
    "completion",
    "opening",
    "probe",
    "recovery",
    "state",
  ] as const),
});
export type BreakerPolicyIdentity = Readonly<{
  adapterId: string;
  adapterVersion: string;
  policyVersion: string;
}>;
export type BreakerOpening = Readonly<{ cycleRequestDigest: string; policyFactsDigest: string }>;
export type BreakerRecoveryObservation = Readonly<{
  adapterConfigurationDigest: string;
  capabilityName: string;
  decision: (typeof breakerRecoveryDecisions)[number];
  observationId: string;
  observedAt: string;
  openReceiptDigest: string;
  policyIdentity: BreakerPolicyIdentity;
  projectFactsDigest: string;
  transactionId: string;
}>;
type Recovery = BreakerRecoveryObservation & Readonly<{ decision: "ALLOW_RECOVERY" }>;
export type BreakerProbeStart = Readonly<{
  probeId: string;
  recoveryDigest: string;
  startedAt: string;
}>;
export type BreakerProbeCompletion = BreakerProbeStart &
  Readonly<{ finishedAt: string; outcome: (typeof breakerProbeOutcomes)[number] }>;
export type BreakerCheckpoint = Readonly<{ capabilityName: string }> &
  (
    | Readonly<{ state: "CLOSED" }>
    | Readonly<{ opening: BreakerOpening; state: "OPEN" }>
    | Readonly<{ opening: BreakerOpening; recovery: Recovery; state: "RECOVERY_PENDING" }>
    | Readonly<{
        opening: BreakerOpening;
        probe: BreakerProbeStart;
        recovery: Recovery;
        state: "PROBE_IN_FLIGHT";
      }>
    | Readonly<{
        completion: BreakerProbeCompletion & { readonly outcome: "SUCCEEDED" };
        opening: BreakerOpening;
        probe: BreakerProbeStart;
        recovery: Recovery;
        state: "CLOSED_RECOVERED";
      }>
  );
export type BreakerOperation = Readonly<{ capabilityName: string }> &
  (
    | Readonly<{ kind: "REQUEST_RECOVERY"; observation: BreakerRecoveryObservation }>
    | Readonly<{ kind: "START_PROBE"; observation: BreakerProbeStart }>
    | Readonly<{ kind: "FINISH_PROBE"; observation: BreakerProbeCompletion }>
  );
type UnknownReason = (typeof breakerUnknownReasons)[number];
export type BreakerReceipt = Readonly<{
  adapterConfigurationDigest: string;
  cycleId: string;
  cycleRequestDigest: string;
  operations: readonly BreakerOperation[];
  policyFactsDigest: string;
  policyIdentity: BreakerPolicyIdentity;
  priorReceiptDigest: string | null;
  schemaVersion: "breaker-receipt/v1";
  sessionId: string;
  result:
    | Readonly<{ capabilities: readonly BreakerCheckpoint[]; kind: "KNOWN" }>
    | Readonly<{
        blockedCapabilityNames: readonly string[];
        kind: "UNKNOWN";
        reason: UnknownReason;
      }>;
}>;
export type BreakerRecoveryRequest = Readonly<{
  adapterConfiguration: AdapterConfiguration;
  capabilityName: string;
  observationId: string;
  openReceipt: BreakerReceipt;
  policyIdentity: BreakerPolicyIdentity;
  projectFacts: Extract<ProjectFacts, { state: "COMPLETE" }>;
  transactionId: string;
}>;

const name = (v: JsonValue | undefined): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/.test(v);
const id = (v: JsonValue | undefined): v is string =>
  typeof v === "string" && /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/.test(v);
const version = (v: JsonValue | undefined): v is string =>
  typeof v === "string" &&
  v.length <= 63 &&
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/.test(v);
const digest = (v: JsonValue | undefined): v is string => isSha256(v) && v.length === 64;
const uuid = (v: JsonValue | undefined): v is string => isUuidV7(v) && v.length === 36;
const record = (v: JsonValue | undefined): ContractRecord | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as ContractRecord) : null;
const same = (a: JsonValue, b: JsonValue): boolean => canonicalJson(a) === canonicalJson(b);
function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
const prefix = (label: string, issues: readonly string[]): string[] =>
  issues.map((issue) => `${label}.${issue}`);
function policyIdentity(input: unknown): ParseResult<BreakerPolicyIdentity> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.policyIdentity);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (!id(row.adapterId)) issues.push("adapterId:invalid");
  for (const field of ["adapterVersion", "policyVersion"] as const)
    if (!version(row[field])) issues.push(`${field}:invalid`);
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerPolicyIdentity };
}
export function parseBreakerRecoveryObservation(
  input: unknown,
): ParseResult<BreakerRecoveryObservation> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.recovery);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  for (const field of [
    "adapterConfigurationDigest",
    "openReceiptDigest",
    "projectFactsDigest",
  ] as const)
    if (!digest(row[field])) issues.push(`${field}:invalid`);
  for (const field of ["observationId", "transactionId"] as const)
    if (!uuid(row[field])) issues.push(`${field}:invalid`);
  if (!name(row.capabilityName)) issues.push("capabilityName:invalid");
  if (!isCanonicalTimestamp(row.observedAt)) issues.push("observedAt:invalid");
  if (!(breakerRecoveryDecisions as readonly JsonValue[]).includes(row.decision!))
    issues.push("decision:invalid");
  const policy = policyIdentity(row.policyIdentity);
  if (!policy.ok) issues.push(...prefix("policyIdentity", policy.issues));
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as BreakerRecoveryObservation };
}
export function computeBreakerRecoveryDigest(input: unknown): string {
  const parsed = parseBreakerRecoveryObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  if (parsed.value.decision !== "ALLOW_RECOVERY")
    throw new TypeError("decision:allow-recovery-required");
  return canonicalDigest(parsed.value);
}
export function parseBreakerProbeStart(input: unknown): ParseResult<BreakerProbeStart> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.probe);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (!uuid(row.probeId)) issues.push("probeId:invalid");
  if (!digest(row.recoveryDigest)) issues.push("recoveryDigest:invalid");
  if (!isCanonicalTimestamp(row.startedAt)) issues.push("startedAt:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerProbeStart };
}
export function parseBreakerProbeCompletion(input: unknown): ParseResult<BreakerProbeCompletion> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.completion);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    start = parseBreakerProbeStart({
      probeId: row.probeId,
      recoveryDigest: row.recoveryDigest,
      startedAt: row.startedAt,
    });
  const issues = start.ok ? [] : [...start.issues];
  if (!isCanonicalTimestamp(row.finishedAt)) issues.push("finishedAt:invalid");
  else if (start.ok && row.finishedAt < start.value.startedAt)
    issues.push("finishedAt:before-start");
  if (!(breakerProbeOutcomes as readonly JsonValue[]).includes(row.outcome!))
    issues.push("outcome:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerProbeCompletion };
}
function checkpoint(input: JsonValue): ParseResult<BreakerCheckpoint> {
  const value = record(input),
    state = value?.state;
  const fields =
    state === "CLOSED"
      ? breakerReceiptSchemaFields.closed
      : state === "OPEN"
        ? breakerReceiptSchemaFields.open
        : state === "RECOVERY_PENDING"
          ? breakerReceiptSchemaFields.recoveryPending
          : state === "PROBE_IN_FLIGHT"
            ? breakerReceiptSchemaFields.probeInFlight
            : state === "CLOSED_RECOVERED"
              ? breakerReceiptSchemaFields.closedRecovered
              : null;
  if (!fields) return invalid("state:invalid");
  const parsed = snapshotClosedRecord(input, fields);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (!name(row.capabilityName)) issues.push("capabilityName:invalid");
  if (state !== "CLOSED") {
    const opening = snapshotClosedRecord(row.opening, breakerReceiptSchemaFields.opening);
    if (!opening.ok) issues.push(...prefix("opening", opening.issues));
    else
      for (const field of breakerReceiptSchemaFields.opening)
        if (!digest(opening.value[field])) issues.push(`opening.${field}:invalid`);
  }
  if (state === "RECOVERY_PENDING" || state === "PROBE_IN_FLIGHT" || state === "CLOSED_RECOVERED") {
    const recovery = parseBreakerRecoveryObservation(row.recovery);
    if (!recovery.ok) issues.push(...prefix("recovery", recovery.issues));
    else {
      if (recovery.value.decision !== "ALLOW_RECOVERY")
        issues.push("recovery.decision:allow-required");
      if (recovery.value.capabilityName !== row.capabilityName)
        issues.push("recovery.capabilityName:mismatch");
    }
    if (state !== "RECOVERY_PENDING") {
      const probe = parseBreakerProbeStart(row.probe);
      if (!probe.ok) issues.push(...prefix("probe", probe.issues));
      else if (recovery.ok && probe.value.recoveryDigest !== canonicalDigest(recovery.value))
        issues.push("probe.recoveryDigest:mismatch");
      if (state === "CLOSED_RECOVERED") {
        const completion = parseBreakerProbeCompletion(row.completion);
        if (!completion.ok) issues.push(...prefix("completion", completion.issues));
        else {
          if (completion.value.outcome !== "SUCCEEDED")
            issues.push("completion.outcome:success-required");
          if (probe.ok)
            for (const field of breakerReceiptSchemaFields.probe)
              if (completion.value[field] !== probe.value[field])
                issues.push(`completion.${field}:mismatch`);
        }
      }
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerCheckpoint };
}
function operation(input: JsonValue): ParseResult<BreakerOperation> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.operation);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (!name(row.capabilityName)) issues.push("capabilityName:invalid");
  const observation =
    row.kind === "REQUEST_RECOVERY"
      ? parseBreakerRecoveryObservation(row.observation)
      : row.kind === "START_PROBE"
        ? parseBreakerProbeStart(row.observation)
        : row.kind === "FINISH_PROBE"
          ? parseBreakerProbeCompletion(row.observation)
          : null;
  if (!observation) issues.push("kind:invalid");
  else if (!observation.ok) issues.push(...prefix("observation", observation.issues));
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerOperation };
}
function rows(
  input: JsonValue | undefined,
  parser: (value: JsonValue) => ParseResult,
  label: string,
  issues: string[],
): void {
  if (!Array.isArray(input) || input.length > 256) {
    issues.push(`${label}:length-refused`);
    return;
  }
  let previous: string | undefined;
  for (const [index, item] of input.entries()) {
    const parsed = parser(item);
    if (!parsed.ok) issues.push(...prefix(`${label}.${index}`, parsed.issues));
    else {
      const key = parsed.value.capabilityName as string;
      if (previous !== undefined && previous >= key) issues.push(`${label}:order-refused`);
      previous = key;
    }
  }
}
/** Complete supplied checkpoint structure; no history selection, recovery execution or authority. */
export function parseBreakerReceipt(input: unknown): ParseResult<BreakerReceipt> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.receipt);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "breaker-receipt/v1") issues.push("schemaVersion:mismatch");
  for (const field of [
    "adapterConfigurationDigest",
    "cycleRequestDigest",
    "policyFactsDigest",
  ] as const)
    if (!digest(row[field])) issues.push(`${field}:invalid`);
  for (const field of ["cycleId", "sessionId"] as const)
    if (!uuid(row[field])) issues.push(`${field}:invalid`);
  if (row.priorReceiptDigest !== null && !digest(row.priorReceiptDigest))
    issues.push("priorReceiptDigest:invalid");
  const policy = policyIdentity(row.policyIdentity);
  if (!policy.ok) issues.push(...prefix("policyIdentity", policy.issues));
  rows(row.operations, operation, "operations", issues);
  const kind = record(row.result)?.kind;
  if (kind !== "KNOWN" && kind !== "UNKNOWN") issues.push("result.kind:invalid");
  else {
    const result = snapshotClosedRecord(
      row.result,
      kind === "KNOWN" ? breakerReceiptSchemaFields.known : breakerReceiptSchemaFields.unknown,
    );
    if (!result.ok) issues.push(...prefix("result", result.issues));
    else if (kind === "KNOWN")
      rows(result.value.capabilities, checkpoint, "result.capabilities", issues);
    else {
      if (!(breakerUnknownReasons as readonly JsonValue[]).includes(result.value.reason!))
        issues.push("result.reason:invalid");
      const names = result.value.blockedCapabilityNames;
      if (!Array.isArray(names) || names.length > 512)
        issues.push("result.blockedCapabilityNames:length-refused");
      else {
        let previous: string | undefined;
        for (const value of names) {
          if (!name(value)) issues.push("result.blockedCapabilityNames:invalid");
          else {
            if (previous !== undefined && previous >= value)
              issues.push("result.blockedCapabilityNames:order-refused");
            previous = value;
          }
        }
      }
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerReceipt };
}
export function computeBreakerReceiptDigest(input: unknown): string {
  const parsed = parseBreakerReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("breaker-receipt/v1", [frame.canonical(parsed.value)]);
}
export function parseBreakerReceiptContract(schema: string, input: unknown): ParseResult | null {
  return schema === "breaker-receipt/v1" ? parseBreakerReceipt(input) : null;
}

/** Closed future SDK data only; this does not invoke or authorize a recovery callback. */
export function parseBreakerRecoveryRequest(input: unknown): ParseResult<BreakerRecoveryRequest> {
  const parsed = snapshotClosedRecord(input, breakerReceiptSchemaFields.recoveryRequest);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const configuration = parseAdapterConfiguration(row.adapterConfiguration);
  if (!configuration.ok) return invalid(...prefix("adapterConfiguration", configuration.issues));
  const facts = validateProjectFactsBinding(row.projectFacts, configuration.value);
  if (!facts.ok) return invalid(...prefix("projectFacts", facts.issues));
  if (facts.value.state !== "COMPLETE") return invalid("projectFacts:complete-required");
  const open = parseBreakerReceipt(row.openReceipt);
  if (!open.ok) return invalid(...prefix("openReceipt", open.issues));
  if (open.value.result.kind !== "KNOWN") return invalid("openReceipt:known-required");
  const policy = policyIdentity(row.policyIdentity);
  if (!policy.ok) return invalid(...prefix("policyIdentity", policy.issues));
  const issues: string[] = [];
  if (!name(row.capabilityName)) issues.push("capabilityName:invalid");
  for (const field of ["observationId", "transactionId"] as const)
    if (!uuid(row[field])) issues.push(`${field}:invalid`);
  if (
    !open.value.result.capabilities.some(
      (value) => value.capabilityName === row.capabilityName && value.state === "OPEN",
    )
  )
    issues.push("openReceipt:open-capability-required");
  if (!configuration.value.capabilityNames.includes(row.capabilityName as string))
    issues.push("capabilityName:not-configured");
  if (row.observationId === facts.value.observationId)
    issues.push("observationId:must-differ-from-snapshot");
  if (open.value.adapterConfigurationDigest !== canonicalDigest(configuration.value))
    issues.push("openReceipt.adapterConfigurationDigest:mismatch");
  if (
    policy.value.adapterId !== configuration.value.adapterId ||
    policy.value.adapterVersion !== configuration.value.adapterVersion ||
    !same(policy.value, open.value.policyIdentity)
  )
    issues.push("policyIdentity:mismatch");
  return issues.length ? invalid(...issues) : { ok: true, value: row as BreakerRecoveryRequest };
}

type TransitionContext = Readonly<{
  capabilityName: string;
  trip: "TRIP" | "NO_TRIP";
  opening: BreakerOpening;
  priorDigest: string | null;
  configDigest: string;
  factsDigest: string;
  policy: BreakerPolicyIdentity;
  observationIds: readonly string[];
}>;
// Computes only the expected supplied checkpoint for comparison. Never emits or admits a receipt.
function expectedCheckpoint(
  prior: BreakerCheckpoint | undefined,
  op: BreakerOperation | undefined,
  ctx: TransitionContext,
): BreakerCheckpoint | UnknownReason {
  if (prior === undefined && ctx.priorDigest !== null) return "INVALID_TRANSITION";
  if (!prior || prior.state === "CLOSED" || prior.state === "CLOSED_RECOVERED") {
    if (op) return "INVALID_TRANSITION";
    return ctx.trip === "NO_TRIP"
      ? { capabilityName: ctx.capabilityName, state: "CLOSED" }
      : { capabilityName: ctx.capabilityName, opening: ctx.opening, state: "OPEN" };
  }
  if (!op) return prior; // NO_TRIP does not clear an opening or recovery hold.
  if (prior.state === "OPEN" && op.kind === "REQUEST_RECOVERY") {
    const obs = op.observation;
    if (
      obs.capabilityName !== ctx.capabilityName ||
      obs.openReceiptDigest !== ctx.priorDigest ||
      obs.adapterConfigurationDigest !== ctx.configDigest ||
      !same(obs.policyIdentity, ctx.policy) ||
      obs.projectFactsDigest !== ctx.factsDigest ||
      ctx.observationIds.includes(obs.observationId)
    )
      return "INVALID_TRANSITION";
    if (obs.decision === "UNAVAILABLE") return "RECOVERY_UNAVAILABLE";
    if (obs.decision === "UNKNOWN") return "RECOVERY_UNKNOWN";
    if (obs.decision === "KEEP_HOLD") return prior;
    return { ...prior, recovery: obs as Recovery, state: "RECOVERY_PENDING" };
  }
  if (prior.state === "RECOVERY_PENDING" && op.kind === "START_PROBE") {
    const probe = op.observation;
    if (
      probe.recoveryDigest !== canonicalDigest(prior.recovery) ||
      probe.startedAt < prior.recovery.observedAt
    )
      return "INVALID_TRANSITION";
    return { ...prior, probe, state: "PROBE_IN_FLIGHT" };
  }
  if (prior.state === "PROBE_IN_FLIGHT" && op.kind === "FINISH_PROBE") {
    const completion = op.observation;
    if (breakerReceiptSchemaFields.probe.some((field) => completion[field] !== prior.probe[field]))
      return "INVALID_TRANSITION";
    if (completion.outcome === "UNKNOWN") return "PROBE_UNKNOWN";
    if (completion.outcome === "FAILED")
      return { capabilityName: prior.capabilityName, opening: prior.opening, state: "OPEN" };
    return {
      ...prior,
      completion: completion as BreakerProbeCompletion & { readonly outcome: "SUCCEEDED" },
      state: "CLOSED_RECOVERED",
    };
  }
  return "INVALID_TRANSITION";
}

/** Supplied-record relation only. Null prior never proves genesis; even KNOWN grants no authority. */
export function validateBreakerReceiptBinding(
  provenanceInput: unknown,
  configurationInput: unknown,
  cycleInput: unknown,
  projectFactsInput: unknown,
  policyFactsInput: unknown,
  priorInput: unknown,
  receiptInput: unknown,
): ParseResult<BreakerReceipt> {
  const receipt = parseBreakerReceipt(receiptInput);
  if (!receipt.ok) return invalid(...prefix("receipt", receipt.issues));
  const prior = priorInput === null ? null : parseBreakerReceipt(priorInput);
  if (prior && !prior.ok) return invalid(...prefix("priorReceipt", prior.issues));
  if (prior?.ok && prior.value.result.kind === "UNKNOWN")
    return invalid("priorReceipt:unknown-terminal");
  const provenance = parseConfigurationProvenance(provenanceInput);
  if (!provenance.ok) return invalid(...prefix("provenance", provenance.issues));
  const configuration = validateAdapterConfigurationBinding(configurationInput, provenance.value);
  if (!configuration.ok) return invalid(...prefix("configuration", configuration.issues));
  const project = validateProjectFactsBinding(projectFactsInput, configuration.value);
  if (!project.ok) return invalid(...prefix("projectFacts", project.issues));
  if (project.value.state !== "COMPLETE") return invalid("projectFacts:complete-required");
  const cycle = parseCycleRequest(cycleInput);
  if (!cycle.ok) return invalid(...prefix("cycleRequest", cycle.issues));
  const policy = parseProjectBreakerFacts(policyFactsInput);
  if (!policy.ok) return invalid(...prefix("policyFacts", policy.issues));
  const policyBinding = validateProjectBreakerFactsBinding(
    policy.value,
    configuration.value,
    project.value,
    policy.value.policyVersion,
  );
  if (!policyBinding.ok) return invalid(...prefix("policyFacts", policyBinding.issues));
  const current = receipt.value,
    before = prior?.ok ? prior.value : null;
  const beforeRows = before?.result.kind === "KNOWN" ? before.result.capabilities : [];
  const configDigest = canonicalDigest(configuration.value),
    factsDigest = canonicalDigest(project.value);
  const policyDigest = canonicalDigest(policy.value),
    cycleDigest = computeCycleRequestDigest(cycle.value);
  const priorDigest = before === null ? null : computeBreakerReceiptDigest(before);
  const actualPolicy = {
    adapterId: configuration.value.adapterId,
    adapterVersion: configuration.value.adapterVersion,
    policyVersion: policy.value.policyVersion,
  };
  const issues: string[] = [];
  for (const [field, actual] of Object.entries({
    adapterConfigurationDigest: configDigest,
    cycleRequestDigest: cycleDigest,
    policyFactsDigest: policyDigest,
    priorReceiptDigest: priorDigest,
    cycleId: cycle.value.cycleId,
    sessionId: cycle.value.sessionRequest.sessionId,
  }))
    if (current[field as keyof BreakerReceipt] !== actual) issues.push(`receipt.${field}:mismatch`);
  if (!same(current.policyIdentity, actualPolicy)) issues.push("receipt.policyIdentity:mismatch");
  if (cycle.value.adapterId !== configuration.value.adapterId)
    issues.push("cycleRequest.adapterId:mismatch");
  if (
    cycle.value.sessionRequest.configurationProvenanceDigest !== canonicalDigest(provenance.value)
  )
    issues.push("cycleRequest.sessionRequest.configurationProvenanceDigest:mismatch");
  if (before && current.cycleId === before.cycleId)
    issues.push("receipt.cycleId:same-predecessor-cycle");
  if (issues.length) return invalid(...issues);
  const names = configuration.value.capabilityNames;
  if (current.result.kind === "UNKNOWN") {
    const blocked = [...new Set([...names, ...beforeRows.map((row) => row.capabilityName)])].sort();
    if (!same(current.result.blockedCapabilityNames, blocked))
      return invalid("result.blockedCapabilityNames:mismatch");
    // This external admission claim takes precedence; the tuple proves neither history nor absence.
    if (current.result.reason === "HISTORY_UNPROVEN") return receipt;
  }
  let failure: UnknownReason | undefined;
  const expected: BreakerCheckpoint[] = [];
  if (before && before.adapterConfigurationDigest !== configDigest)
    failure = "CONFIGURATION_CHANGED";
  else if (before && !same(before.policyIdentity, actualPolicy)) failure = "POLICY_CHANGED";
  else if (policy.value.state === "UNAVAILABLE") failure = "INPUT_UNAVAILABLE";
  else if (policy.value.state === "UNKNOWN") failure = "INPUT_UNKNOWN";
  else {
    const failures: UnknownReason[] = [];
    if (
      before &&
      !same(
        beforeRows.map((row) => row.capabilityName),
        names,
      )
    )
      failures.push("INVALID_TRANSITION");
    const operations = new Map(current.operations.map((op) => [op.capabilityName, op]));
    if (current.operations.some((op) => !names.includes(op.capabilityName)))
      failures.push("INVALID_TRANSITION");
    for (const capabilityName of names) {
      const decision = policy.value.decisions.find((row) => row.capabilityName === capabilityName);
      if (!decision) {
        failures.push("INVALID_TRANSITION");
        continue;
      }
      const next = expectedCheckpoint(
        beforeRows.find((row) => row.capabilityName === capabilityName),
        operations.get(capabilityName),
        {
          capabilityName,
          trip: decision.trip,
          opening: { cycleRequestDigest: cycleDigest, policyFactsDigest: policyDigest },
          priorDigest,
          configDigest,
          factsDigest,
          policy: actualPolicy,
          observationIds: [project.value.observationId, policy.value.observationId],
        },
      );
      if (typeof next === "string") failures.push(next);
      else expected.push(next);
    }
    failure = breakerUnknownReasons.find((reason) => failures.includes(reason));
  }
  if (current.result.kind === "KNOWN") {
    if (failure) return invalid(`result:unknown-required:${failure}`);
    if (!same(current.result.capabilities, expected))
      return invalid("result.capabilities:transition-mismatch");
  } else if (current.result.reason !== failure) {
    // No higher structural failure: unavailable external probe evidence can only claim UNKNOWN.
    if (!(failure === undefined && current.result.reason === "PROBE_UNKNOWN"))
      return invalid("result.reason:priority-mismatch");
  }
  return receipt;
}

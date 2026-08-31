import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  computeBreakerReceiptDigest,
  parseBreakerReceipt,
  validateBreakerReceiptBinding,
} from "./breaker-receipt.js";
import { parseConfigurationProvenance } from "./configuration.js";
import {
  computeCyclePlanDigest,
  computeSessionHealthDigest,
  parseCyclePlan,
  parseCycleRequest,
  parseSessionHealth,
  validateSessionHealthBinding,
  type CyclePlan,
} from "./cycle-entry.js";
import { parseWorkerHostRendererArtifacts } from "./dispatch.js";
import {
  computeDispatchPlanDigest,
  computeWorkerLaunchReceiptDigest,
  computeWorkerTerminalReceiptDigest,
  parseDispatchPlan,
  parseWorkerLaunchReceipt,
  parseWorkerTerminalReceipt,
  validateDispatchPlanBinding,
  validateWorkerLaunchReceiptBinding,
  validateWorkerTerminalReceiptBinding,
} from "./dispatch-lifecycle.js";
import {
  computeActionDispositionDigest,
  computeFollowUpCycleRequestDigest,
  parseActionDisposition,
  parseDispositionInput,
  parseFollowUpCycleRequest,
  validateActionDispositionBinding,
  validateFollowUpCycleRequestBinding,
} from "./disposition.js";
import {
  computeModuleActionPlanDigest,
  computeModuleNoActionDigest,
  parseModuleActionPlan,
  parseModuleNoAction,
  parseModulePlanInput,
  validateModulePlanBinding,
} from "./module-plan.js";
import {
  computeProjectApplyReceiptDigest,
  computeProjectMutationPlanDigest,
  parseProjectApplyReceipt,
  parseProjectMutationObservation,
  parseProjectMutationPlan,
  parseProjectMutationRequest,
  validateProjectApplyReceiptBinding,
  validateProjectMutationPlanBinding,
  validateProjectMutationRequestBinding,
} from "./project-mutation.js";
import {
  computeProjectPreflightDigest,
  parseProjectPreflight,
  parseProjectPreflightObservation,
  validateProjectPreflightBinding,
} from "./project-preflight.js";
import { parseProjectBreakerFacts } from "./project-breaker-facts.js";
import {
  parseAdapterConfiguration,
  parseProjectFacts,
  validateProjectFactsBinding,
} from "./project-snapshot.js";
import {
  computeReviewPacketDigest,
  computeReviewRequestDigest,
  parseReviewRequest,
} from "./review-request.js";
import {
  computeReviewAttemptResultDigest,
  computeReviewAuthorityDigest,
  parseReviewAttemptResult,
  parseReviewAuthority,
  validateReviewResultBinding,
} from "./review-result.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseWorkerResultSubject,
} from "./review-subject.js";
import {
  computeResourceReclaimReceiptDigest,
  parseResourceReclaimContext,
  parseResourceReclaimReceipt,
  validateResourceReclaimReceiptBinding,
} from "./resource-reclaim.js";
import {
  computeRouteSelectionDigest,
  parseRouteSelection,
  validateRouteSelectionBinding,
} from "./route-selection.js";
import {
  computeRoutineStepDigest,
  computeRoutineStepSkipDigest,
  parseRoutineStepIdentity,
  parseRoutineStepSkip,
  type RoutineStepIdentity,
} from "./routine-step.js";
import {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  closedRecord,
  frame,
  framedDigest,
  isCanonicalDecimal,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const journalSchemaVersions = Object.freeze([
  "orchestration-event/v1",
  "event-journal/v1",
  "reduced-state/v1",
  "cycle-receipt/v1",
] as const);
export const retainedEvidenceKinds = Object.freeze([
  "MAPPING_OBSERVATION",
  "MUTATION_OBSERVATION",
  "PREFLIGHT_OBSERVATION",
  "RENDERED_INPUT",
  "STDERR",
  "STDOUT",
] as const);
export const eventOutputKinds = Object.freeze([
  "SESSION",
  "PROJECT_FACTS",
  "BREAKER",
  "MODULE",
  "ROUTE",
  "PREFLIGHT",
  "DISPATCH_PLAN",
  "LAUNCH",
  "WORKER_TERMINAL",
  "REVIEW_AUTHORITY",
  "DISPOSITION",
  "MUTATION_PLAN",
  "PROJECT_APPLY",
  "RECLAIM",
  "CYCLE_TERMINAL",
  "SKIP",
] as const);
export const journalSchemaFields = Object.freeze({
  event: Object.freeze([
    "cycleId",
    "output",
    "phase",
    "position",
    "previousEventDigest",
    "previousPrefixDigest",
    "retainedEvidence",
    "schemaVersion",
    "step",
  ] as const),
  evidence: Object.freeze(["byteLength", "contentDigest", "encoding", "kind"] as const),
  journal: Object.freeze([
    "cycleId",
    "cyclePlan",
    "cyclePlanDigest",
    "events",
    "genesisDigest",
    "schemaVersion",
    "sessionId",
  ] as const),
  header: Object.freeze([
    "cycleId",
    "cyclePlan",
    "cyclePlanDigest",
    "genesisDigest",
    "schemaVersion",
    "sessionId",
  ] as const),
  genesis: Object.freeze(["cycleId", "cyclePlan", "cyclePlanDigest", "sessionId"] as const),
  reduced: Object.freeze([
    "bindings",
    "cycleId",
    "cyclePlanDigest",
    "journalPrefixDigest",
    "outcome",
    "pendingStep",
    "schemaVersion",
    "steps",
  ] as const),
  bindings: Object.freeze([
    "actionDigest",
    "applyDigest",
    "followUpDigest",
    "mutationPlanDigest",
    "reclaimDigest",
    "reviewAuthorityDigest",
    "subjectDigest",
  ] as const),
  reducedStep: Object.freeze([
    "dependentDigests",
    "ordinal",
    "primaryDigest",
    "state",
    "stepDigest",
  ] as const),
  kind: Object.freeze(["kind"] as const),
  attempt: Object.freeze(["attemptId", "kind"] as const),
  request: Object.freeze(["kind", "requestDigest"] as const),
  dispositionWait: Object.freeze(["dispositionDigest", "kind"] as const),
  terminalizing: Object.freeze(["kind", "terminalStepDigest"] as const),
  completed: Object.freeze(["cycleReceiptDigest", "kind"] as const),
  unknown: Object.freeze(["kind", "reason"] as const),
  cycleReceipt: Object.freeze([
    "bindings",
    "cycleId",
    "cyclePlanDigest",
    "outcome",
    "reclaimOutcome",
    "reducedStateDigest",
    "schemaVersion",
    "sessionId",
    "startedJournalPrefixDigest",
    "steps",
    "terminalStepDigest",
  ] as const),
  session: Object.freeze(["cyclePlan", "health", "kind"] as const),
  facts: Object.freeze(["configuration", "facts", "kind"] as const),
  breaker: Object.freeze([
    "configuration",
    "cycleRequest",
    "kind",
    "policyFacts",
    "prior",
    "projectFacts",
    "provenance",
    "receipt",
  ] as const),
  module: Object.freeze(["input", "kind", "result"] as const),
  route: Object.freeze(["action", "input", "kind", "mapping", "route"] as const),
  preflight: Object.freeze([
    "action",
    "input",
    "kind",
    "mapping",
    "observation",
    "preflight",
    "route",
  ] as const),
  dispatchPlan: Object.freeze([
    "action",
    "cyclePlan",
    "health",
    "input",
    "kind",
    "mapping",
    "observation",
    "plan",
    "preflight",
    "reviewRequest",
    "route",
  ] as const),
  launch: Object.freeze(["kind", "launch", "plan", "terminal"] as const),
  workerTerminal: Object.freeze([
    "attempt",
    "kind",
    "launch",
    "plan",
    "resultSubject",
    "terminal",
  ] as const),
  review: Object.freeze(["attempt", "authority", "kind", "request"] as const),
  disposition: Object.freeze(["disposition", "followUp", "input", "kind"] as const),
  mutationPlan: Object.freeze([
    "disposition",
    "dispositionInput",
    "kind",
    "observation",
    "plan",
    "request",
  ] as const),
  apply: Object.freeze([
    "afterObservation",
    "beforeObservation",
    "disposition",
    "dispositionInput",
    "dryObservation",
    "expectedPlanDigest",
    "kind",
    "plan",
    "receipt",
    "request",
  ] as const),
  reclaim: Object.freeze(["context", "kind", "receipt"] as const),
  cycleTerminal: Object.freeze(["kind", "receipt"] as const),
  skip: Object.freeze(["kind", "skip"] as const),
});
export const journalClosedValues = Object.freeze([
  "STARTED",
  "TERMINAL",
  "RAW_BYTES",
  "CANONICAL_JSON",
  ...retainedEvidenceKinds,
  ...eventOutputKinds,
  "RUNNING",
  "WAITING_WORKER",
  "WAITING_REVIEW",
  "WAITING_ACTION",
  "TERMINALIZING",
  "COMPLETED",
  "COMPLETED_NO_WORK",
  "FAILED_KNOWN",
  "UNKNOWN",
  "SKIPPED",
  "EARLIER_UNKNOWN",
  "PREFIX_CONFLICT",
  "OUTPUT_CONFLICT",
  "RESOURCE_UNKNOWN",
  "HISTORY_UNPROVEN",
  "NO_ALLOCATION",
  "RECLAIMED",
  "RETAINED",
] as const);

export type RetainedEvidenceKind = (typeof retainedEvidenceKinds)[number];
export type RetainedEvidenceReference = Readonly<{
  byteLength: string;
  contentDigest: string;
  encoding: "RAW_BYTES" | "CANONICAL_JSON";
  kind: RetainedEvidenceKind;
}>;
export type OrchestrationEvent = Readonly<{
  cycleId: string;
  output: ContractRecord | null;
  phase: "STARTED" | "TERMINAL";
  position: string;
  previousEventDigest: string | null;
  previousPrefixDigest: string;
  retainedEvidence: readonly RetainedEvidenceReference[];
  schemaVersion: "orchestration-event/v1";
  step: RoutineStepIdentity;
}>;
export type EventJournal = Readonly<{
  cycleId: string;
  cyclePlan: CyclePlan;
  cyclePlanDigest: string;
  events: readonly OrchestrationEvent[];
  genesisDigest: string;
  schemaVersion: "event-journal/v1";
  sessionId: string;
}>;
export type ReducedStep = Readonly<{
  dependentDigests: readonly string[];
  ordinal: string;
  primaryDigest: string | null;
  state: "STARTED" | "TERMINAL" | "SKIPPED";
  stepDigest: string;
}>;
export type ReducedBindings = Readonly<{
  actionDigest: string | null;
  applyDigest: string | null;
  followUpDigest: string | null;
  mutationPlanDigest: string | null;
  reclaimDigest: string | null;
  reviewAuthorityDigest: string | null;
  subjectDigest: string | null;
}>;
export type ReducedState = Readonly<{
  bindings: ReducedBindings;
  cycleId: string;
  cyclePlanDigest: string;
  journalPrefixDigest: string;
  pendingStep: RoutineStepIdentity | null;
  schemaVersion: "reduced-state/v1";
  steps: readonly ReducedStep[];
  outcome:
    | Readonly<{ kind: "RUNNING" }>
    | Readonly<{ attemptId: string; kind: "WAITING_WORKER" }>
    | Readonly<{ kind: "WAITING_REVIEW"; requestDigest: string }>
    | Readonly<{ dispositionDigest: string | null; kind: "WAITING_ACTION" }>
    | Readonly<{ kind: "TERMINALIZING"; terminalStepDigest: string }>
    | Readonly<{
        cycleReceiptDigest: string;
        kind: "COMPLETED" | "COMPLETED_NO_WORK" | "FAILED_KNOWN";
      }>
    | Readonly<{
        kind: "UNKNOWN";
        reason:
          | "EARLIER_UNKNOWN"
          | "PREFIX_CONFLICT"
          | "OUTPUT_CONFLICT"
          | "RESOURCE_UNKNOWN"
          | "HISTORY_UNPROVEN";
      }>;
}>;
export type CycleReceipt = Readonly<{
  bindings: ReducedBindings;
  cycleId: string;
  cyclePlanDigest: string;
  outcome: "COMPLETED" | "COMPLETED_NO_WORK" | "FAILED_KNOWN";
  reclaimOutcome: "NO_ALLOCATION" | "RECLAIMED" | "RETAINED";
  reducedStateDigest: string;
  schemaVersion: "cycle-receipt/v1";
  sessionId: string;
  startedJournalPrefixDigest: string;
  steps: readonly ReducedStep[];
  terminalStepDigest: string;
}>;
export type RetainedEvidenceInput = Readonly<{
  bytes: Uint8Array;
  kind: RetainedEvidenceKind;
}>;

const F = journalSchemaFields;
const invalid = <T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> => ({
  ok: false,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const specializedFailure = (...issues: readonly string[]) => ({
  ok: false as const,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefixed = (label: string, issues: readonly string[]) =>
  issues.map((issue) => `${label}.${issue}`);
const digest = (value: JsonValue | undefined): value is string =>
  isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined): value is string =>
  isUuidV7(value) && value.length === 36;
const decimal = (value: JsonValue | undefined, maximum: number) =>
  typeof value === "string" && isCanonicalDecimal(value) && Number(value) <= maximum;
const member = (value: JsonValue | undefined, values: readonly string[]) =>
  typeof value === "string" && values.includes(value);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function record(input: unknown): ParseResult {
  const parsed = snapshotJson(input);
  if (!parsed.ok) return parsed;
  return parsed.value !== null && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? { ok: true, value: parsed.value as ContractRecord }
    : invalid("record:object-required");
}
function nested(parsed: ParseResult, label: string, issues: string[]): void {
  if (!parsed.ok) issues.push(...prefixed(label, parsed.issues));
}
function nullable(
  input: JsonValue | undefined,
  parser: (value: unknown) => ParseResult,
  label: string,
  issues: string[],
): void {
  if (input !== null) nested(parser(input), label, issues);
}

function parseEvidenceReferences(input: JsonValue | undefined): ParseResult {
  if (!Array.isArray(input) || input.length > 6) return invalid("length-refused");
  let previous: string | undefined;
  const rows: ContractRecord[] = [];
  const issues: string[] = [];
  for (const [index, value] of input.entries()) {
    const parsed = snapshotClosedRecord(value, F.evidence);
    if (!parsed.ok) {
      issues.push(...prefixed(String(index), parsed.issues));
      continue;
    }
    const row = parsed.value;
    if (!decimal(row.byteLength, 1048576)) issues.push(`${index}.byteLength:invalid`);
    if (!digest(row.contentDigest)) issues.push(`${index}.contentDigest:invalid`);
    if (!member(row.encoding, ["RAW_BYTES", "CANONICAL_JSON"]))
      issues.push(`${index}.encoding:invalid`);
    if (!member(row.kind, retainedEvidenceKinds)) issues.push(`${index}.kind:invalid`);
    if (typeof row.kind === "string") {
      if (previous !== undefined && previous >= row.kind) issues.push("order-refused");
      previous = row.kind;
      const jsonKind = member(row.kind, [
        "MAPPING_OBSERVATION",
        "MUTATION_OBSERVATION",
        "PREFLIGHT_OBSERVATION",
      ]);
      if (row.encoding !== (jsonKind ? "CANONICAL_JSON" : "RAW_BYTES"))
        issues.push(`${index}.encoding:kind-mismatch`);
    }
    rows.push(row);
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: Object.freeze(rows) as unknown as ContractRecord };
}

function outputFields(kind: JsonValue | undefined): readonly string[] | null {
  const byKind: Readonly<Record<string, readonly string[]>> = {
    SESSION: F.session,
    PROJECT_FACTS: F.facts,
    BREAKER: F.breaker,
    MODULE: F.module,
    ROUTE: F.route,
    PREFLIGHT: F.preflight,
    DISPATCH_PLAN: F.dispatchPlan,
    LAUNCH: F.launch,
    WORKER_TERMINAL: F.workerTerminal,
    REVIEW_AUTHORITY: F.review,
    DISPOSITION: F.disposition,
    MUTATION_PLAN: F.mutationPlan,
    PROJECT_APPLY: F.apply,
    RECLAIM: F.reclaim,
    CYCLE_TERMINAL: F.cycleTerminal,
    SKIP: F.skip,
  };
  return typeof kind === "string" ? (byKind[kind] ?? null) : null;
}

function parseEventOutput(input: unknown): ParseResult {
  const initial = record(input);
  if (!initial.ok) return initial;
  const expected = outputFields(initial.value.kind);
  if (!expected) return invalid("kind:invalid");
  const parsed = snapshotClosedRecord(initial.value, expected);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  switch (row.kind) {
    case "SESSION":
      nested(parseCyclePlan(row.cyclePlan), "cyclePlan", issues);
      nested(parseSessionHealth(row.health), "health", issues);
      break;
    case "PROJECT_FACTS":
      nested(parseAdapterConfiguration(row.configuration), "configuration", issues);
      nested(parseProjectFacts(row.facts), "facts", issues);
      break;
    case "BREAKER":
      nested(parseAdapterConfiguration(row.configuration), "configuration", issues);
      nested(parseCycleRequest(row.cycleRequest), "cycleRequest", issues);
      nested(parseProjectBreakerFacts(row.policyFacts), "policyFacts", issues);
      nullable(row.prior, parseBreakerReceipt, "prior", issues);
      nested(parseProjectFacts(row.projectFacts), "projectFacts", issues);
      nested(parseConfigurationProvenance(row.provenance), "provenance", issues);
      nested(parseBreakerReceipt(row.receipt), "receipt", issues);
      break;
    case "MODULE":
      nested(parseModulePlanInput(row.input), "input", issues);
      if (
        record(row.result).ok &&
        (row.result as ContractRecord).schemaVersion === "module-action-plan/v1"
      )
        nested(parseModuleActionPlan(row.result), "result", issues);
      else nested(parseModuleNoAction(row.result), "result", issues);
      break;
    case "ROUTE":
      nested(parseModuleActionPlan(row.action), "action", issues);
      nested(parseModulePlanInput(row.input), "input", issues);
      if (row.mapping !== null) {
        const mapping = parseWorkerHostRendererArtifacts(row.mapping);
        if (!mapping.ok) issues.push(...prefixed("mapping", mapping.issues));
      }
      nested(parseRouteSelection(row.route), "route", issues);
      break;
    case "PREFLIGHT":
      nested(parseModuleActionPlan(row.action), "action", issues);
      nested(parseModulePlanInput(row.input), "input", issues);
      if (row.mapping !== null) {
        const mapping = parseWorkerHostRendererArtifacts(row.mapping);
        if (!mapping.ok) issues.push(...prefixed("mapping", mapping.issues));
      }
      nullable(row.observation, parseProjectPreflightObservation, "observation", issues);
      nested(parseProjectPreflight(row.preflight), "preflight", issues);
      nested(parseRouteSelection(row.route), "route", issues);
      break;
    case "DISPATCH_PLAN":
      nested(parseModuleActionPlan(row.action), "action", issues);
      nested(parseCyclePlan(row.cyclePlan), "cyclePlan", issues);
      nested(parseSessionHealth(row.health), "health", issues);
      nested(parseModulePlanInput(row.input), "input", issues);
      if (row.mapping !== null) {
        const mapping = parseWorkerHostRendererArtifacts(row.mapping);
        if (!mapping.ok) issues.push(...prefixed("mapping", mapping.issues));
      }
      nullable(row.observation, parseProjectPreflightObservation, "observation", issues);
      nested(parseDispatchPlan(row.plan), "plan", issues);
      nested(parseProjectPreflight(row.preflight), "preflight", issues);
      nullable(row.reviewRequest, parseReviewRequest, "reviewRequest", issues);
      nested(parseRouteSelection(row.route), "route", issues);
      break;
    case "LAUNCH":
      nested(parseWorkerLaunchReceipt(row.launch), "launch", issues);
      nested(parseDispatchPlan(row.plan), "plan", issues);
      nullable(row.terminal, parseWorkerTerminalReceipt, "terminal", issues);
      break;
    case "WORKER_TERMINAL":
      nullable(row.attempt, parseReviewAttemptResult, "attempt", issues);
      nested(parseWorkerLaunchReceipt(row.launch), "launch", issues);
      nested(parseDispatchPlan(row.plan), "plan", issues);
      nullable(row.resultSubject, parseWorkerResultSubject, "resultSubject", issues);
      nested(parseWorkerTerminalReceipt(row.terminal), "terminal", issues);
      break;
    case "REVIEW_AUTHORITY":
      nullable(row.attempt, parseReviewAttemptResult, "attempt", issues);
      nested(parseReviewAuthority(row.authority), "authority", issues);
      nested(parseReviewRequest(row.request), "request", issues);
      break;
    case "DISPOSITION":
      nested(parseActionDisposition(row.disposition), "disposition", issues);
      nullable(row.followUp, parseFollowUpCycleRequest, "followUp", issues);
      nested(parseDispositionInput(row.input), "input", issues);
      break;
    case "MUTATION_PLAN":
      nested(parseActionDisposition(row.disposition), "disposition", issues);
      nested(parseDispositionInput(row.dispositionInput), "dispositionInput", issues);
      nullable(row.observation, parseProjectMutationObservation, "observation", issues);
      nested(parseProjectMutationPlan(row.plan), "plan", issues);
      nested(parseProjectMutationRequest(row.request), "request", issues);
      break;
    case "PROJECT_APPLY":
      nullable(row.afterObservation, parseProjectMutationObservation, "afterObservation", issues);
      nullable(row.beforeObservation, parseProjectMutationObservation, "beforeObservation", issues);
      nested(parseActionDisposition(row.disposition), "disposition", issues);
      nested(parseDispositionInput(row.dispositionInput), "dispositionInput", issues);
      nullable(row.dryObservation, parseProjectMutationObservation, "dryObservation", issues);
      if (!digest(row.expectedPlanDigest)) issues.push("expectedPlanDigest:invalid");
      nested(parseProjectMutationPlan(row.plan), "plan", issues);
      nested(parseProjectApplyReceipt(row.receipt), "receipt", issues);
      nested(parseProjectMutationRequest(row.request), "request", issues);
      break;
    case "RECLAIM":
      nested(parseResourceReclaimContext(row.context), "context", issues);
      nested(parseResourceReclaimReceipt(row.receipt), "receipt", issues);
      break;
    case "CYCLE_TERMINAL":
      nested(parseCycleReceipt(row.receipt), "receipt", issues);
      break;
    case "SKIP":
      nested(parseRoutineStepSkip(row.skip), "skip", issues);
      break;
  }
  return issues.length ? invalid(...issues) : parsed;
}

/** Closed event structure only; supplied producer and retained-byte joins are separate. */
export function parseOrchestrationEvent(input: unknown): ParseResult<OrchestrationEvent> {
  const parsed = snapshotClosedRecord(input, F.event);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "orchestration-event/v1") issues.push("schemaVersion:mismatch");
  if (!uuid(row.cycleId)) issues.push("cycleId:invalid");
  if (!member(row.phase, ["STARTED", "TERMINAL"])) issues.push("phase:invalid");
  if (!decimal(row.position, 4095)) issues.push("position:invalid");
  if (!digest(row.previousPrefixDigest)) issues.push("previousPrefixDigest:invalid");
  if (row.position === "0") {
    if (row.previousEventDigest !== null) issues.push("previousEventDigest:initial-null-required");
  } else if (!digest(row.previousEventDigest)) issues.push("previousEventDigest:invalid");
  const step = parseRoutineStepIdentity(row.step);
  nested(step, "step", issues);
  if (step.ok && step.value.cycleId !== row.cycleId) issues.push("step.cycleId:mismatch");
  const evidence = parseEvidenceReferences(row.retainedEvidence);
  nested(evidence, "retainedEvidence", issues);
  if (row.phase === "STARTED") {
    if (row.output !== null) issues.push("output:null-required");
    if (Array.isArray(row.retainedEvidence) && row.retainedEvidence.length)
      issues.push("retainedEvidence:empty-required");
  } else {
    if (row.output === null) issues.push("output:required");
    else {
      const output = parseEventOutput(row.output);
      nested(output, "output", issues);
      if (output.ok && step.ok) {
        const kind = output.value.kind;
        const ordinal = Number(step.value.ordinal);
        const expected = eventOutputKinds[ordinal - 1];
        if (kind !== expected && !(kind === "SKIP" && ordinal >= 2 && ordinal <= 13))
          issues.push("output.kind:ordinal-mismatch");
        if (kind === "SKIP" && !same((output.value.skip as ContractRecord).step, step.value))
          issues.push("output.skip.step:mismatch");
      }
    }
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: row as unknown as OrchestrationEvent };
}

export function computeOrchestrationEventDigest(input: unknown): string {
  const parsed = parseOrchestrationEvent(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("orchestration-event/v1", [frame.canonical(parsed.value)]);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}
function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
function rawBytes(input: unknown): Uint8Array | null {
  try {
    if (!nodeTypes.isUint8Array(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return null;
    const buffer = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "buffer",
    )!.get!.call(input);
    if (nodeTypes.isSharedArrayBuffer(buffer)) return null;
    const byteLength = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "byteLength",
    )!.get!.call(input) as number;
    const byteOffset = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "byteOffset",
    )!.get!.call(input) as number;
    return new Uint8Array(buffer as ArrayBuffer, byteOffset, byteLength).slice();
  } catch {
    return null;
  }
}
function domainDigest(domain: string, suffix: Uint8Array): string {
  return createHash("sha256")
    .update(new TextEncoder().encode("orchestration-platform"))
    .update(Uint8Array.of(0))
    .update(new TextEncoder().encode(domain))
    .update(Uint8Array.of(0))
    .update(suffix)
    .digest("hex");
}
function journalGenesisHeader(
  journal: Pick<EventJournal, "cycleId" | "cyclePlan" | "cyclePlanDigest" | "sessionId">,
) {
  return {
    cycleId: journal.cycleId,
    cyclePlan: journal.cyclePlan,
    cyclePlanDigest: journal.cyclePlanDigest,
    sessionId: journal.sessionId,
  };
}
function journalPhysicalHeader(journal: Omit<EventJournal, "events">) {
  return {
    cycleId: journal.cycleId,
    cyclePlan: journal.cyclePlan,
    cyclePlanDigest: journal.cyclePlanDigest,
    genesisDigest: journal.genesisDigest,
    schemaVersion: journal.schemaVersion,
    sessionId: journal.sessionId,
  };
}
export function computeEventJournalGenesisDigest(input: unknown): string {
  const parsed = snapshotClosedRecord(input, F.genesis);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const plan = parseCyclePlan(parsed.value.cyclePlan);
  if (!plan.ok) throw new TypeError(plan.issues.join(","));
  if (
    !uuid(parsed.value.cycleId) ||
    !uuid(parsed.value.sessionId) ||
    !digest(parsed.value.cyclePlanDigest)
  )
    throw new TypeError("header:invalid");
  return domainDigest("event-journal-genesis/v1", canonicalBytes(parsed.value));
}
export function computeEventJournalPrefixDigest(input: unknown): string {
  const bytes = rawBytes(input);
  if (!bytes) throw new TypeError("encoding:bytes-required");
  return domainDigest("event-journal-prefix/v1", concat([u64(bytes.byteLength), bytes]));
}

function initialJournalBytes(journal: Omit<EventJournal, "events">): Uint8Array {
  const header = canonicalBytes(journalPhysicalHeader(journal));
  return concat([
    new TextEncoder().encode("OPJ1"),
    Uint8Array.of(0),
    u32(header.byteLength),
    header,
  ]);
}

/** Logical journal structure and exact event/prefix chain; create-once admission remains external. */
export function parseEventJournal(input: unknown): ParseResult<EventJournal> {
  const parsed = snapshotClosedRecord(input, F.journal);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "event-journal/v1") issues.push("schemaVersion:mismatch");
  if (!uuid(row.cycleId)) issues.push("cycleId:invalid");
  if (!uuid(row.sessionId)) issues.push("sessionId:invalid");
  if (!digest(row.cyclePlanDigest)) issues.push("cyclePlanDigest:invalid");
  if (!digest(row.genesisDigest)) issues.push("genesisDigest:invalid");
  const plan = parseCyclePlan(row.cyclePlan);
  nested(plan, "cyclePlan", issues);
  if (plan.ok) {
    if (row.cyclePlanDigest !== computeCyclePlanDigest(plan.value))
      issues.push("cyclePlanDigest:mismatch");
    if (row.cycleId !== plan.value.request.cycleId) issues.push("cycleId:plan-mismatch");
    if (row.sessionId !== plan.value.request.sessionRequest.sessionId)
      issues.push("sessionId:plan-mismatch");
  }
  if (
    plan.ok &&
    row.genesisDigest !==
      computeEventJournalGenesisDigest({
        cycleId: row.cycleId,
        cyclePlan: plan.value,
        cyclePlanDigest: row.cyclePlanDigest,
        sessionId: row.sessionId,
      })
  )
    issues.push("genesisDigest:mismatch");
  if (!Array.isArray(row.events) || row.events.length > 4096) issues.push("events:length-refused");
  else if (plan.ok && issues.length === 0) {
    let prefixBytes = initialJournalBytes({
      cycleId: row.cycleId as string,
      cyclePlan: plan.value,
      cyclePlanDigest: row.cyclePlanDigest as string,
      genesisDigest: row.genesisDigest as string,
      schemaVersion: "event-journal/v1",
      sessionId: row.sessionId as string,
    });
    let previousEvent: OrchestrationEvent | null = null;
    let pending: OrchestrationEvent | null = null;
    let nextOrdinal = 1;
    let terminalSeen = false;
    for (const [index, value] of row.events.entries()) {
      const event = parseOrchestrationEvent(value);
      if (!event.ok) {
        issues.push(...prefixed(`events.${index}`, event.issues));
        continue;
      }
      const current = event.value;
      if (current.position !== String(index)) issues.push(`events.${index}.position:mismatch`);
      if (current.cycleId !== row.cycleId) issues.push(`events.${index}.cycleId:mismatch`);
      const expectedPrevious = previousEvent
        ? computeOrchestrationEventDigest(previousEvent)
        : null;
      if (current.previousEventDigest !== expectedPrevious)
        issues.push(`events.${index}.previousEventDigest:mismatch`);
      const prefixDigest = computeEventJournalPrefixDigest(prefixBytes);
      if (current.previousPrefixDigest !== prefixDigest)
        issues.push(`events.${index}.previousPrefixDigest:mismatch`);
      if (terminalSeen) issues.push(`events.${index}:after-cycle-terminal`);
      if (current.phase === "STARTED") {
        if (pending !== null) issues.push(`events.${index}:pending-step-conflict`);
        if (Number(current.step.ordinal) !== nextOrdinal)
          issues.push(`events.${index}.step.ordinal:sequence-mismatch`);
        if (current.step.ordinal === "1") {
          if (current.step.predecessorJournalDigest !== null)
            issues.push(`events.${index}.step.predecessorJournalDigest:null-required`);
        } else if (current.step.predecessorJournalDigest !== prefixDigest)
          issues.push(`events.${index}.step.predecessorJournalDigest:mismatch`);
        pending = current;
      } else {
        if (pending === null || !same(current.step, pending.step))
          issues.push(`events.${index}.step:started-mismatch`);
        else {
          pending = null;
          nextOrdinal += 1;
        }
        if ((current.output as ContractRecord).kind === "CYCLE_TERMINAL") terminalSeen = true;
      }
      const bytes = canonicalBytes(current);
      prefixBytes = concat([prefixBytes, u32(bytes.byteLength), bytes]);
      previousEvent = current;
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as unknown as EventJournal };
}

export function serializeEventJournal(input: unknown): Uint8Array {
  const parsed = parseEventJournal(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const journal = parsed.value;
  const header = initialJournalBytes({
    cycleId: journal.cycleId,
    cyclePlan: journal.cyclePlan,
    cyclePlanDigest: journal.cyclePlanDigest,
    genesisDigest: journal.genesisDigest,
    schemaVersion: journal.schemaVersion,
    sessionId: journal.sessionId,
  });
  return concat([
    header,
    ...journal.events.flatMap((event) => {
      const bytes = canonicalBytes(event);
      return [u32(bytes.byteLength), bytes];
    }),
  ]);
}
export function computeEventJournalDigest(input: unknown): string {
  const bytes = serializeEventJournal(input);
  return domainDigest("event-journal/v1", concat([u64(bytes.byteLength), bytes]));
}

function decodeCanonical(
  bytes: Uint8Array,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { ok: false };
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.startsWith("\ufeff")) return { ok: false };
    const value: unknown = JSON.parse(text);
    return canonicalJson(value) === text ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type EventJournalByteInspection =
  | Readonly<{ ok: false; issues: readonly string[] }>
  | Readonly<{
      ok: true;
      value: Readonly<{
        authoritativeByteLength: number;
        journal: EventJournal;
        partialSuffix: boolean;
      }>;
    }>;

/** Longest complete prefix inspection; a partial final frame is non-authoritative and retained. */
export function inspectEventJournalBytes(input: unknown): EventJournalByteInspection {
  const bytes = rawBytes(input);
  if (!bytes) return invalid("encoding:bytes-required");
  if (
    bytes.byteLength < 9 ||
    bytes[0] !== 0x4f ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4a ||
    bytes[3] !== 0x31 ||
    bytes[4] !== 0
  )
    return invalid("encoding:header-invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(5, false);
  if (headerLength > bytes.byteLength - 9) return invalid("encoding:header-truncated");
  const headerBytes = bytes.slice(9, 9 + headerLength);
  const headerValue = decodeCanonical(headerBytes);
  if (!headerValue.ok) return invalid("encoding:header-noncanonical");
  const header = snapshotClosedRecord(headerValue.value, F.header);
  if (!header.ok) return invalid(...prefixed("header", header.issues));
  const events: OrchestrationEvent[] = [];
  let offset = 9 + headerLength;
  let partialSuffix = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 4) {
      partialSuffix = true;
      break;
    }
    const length = view.getUint32(offset, false);
    if (length > bytes.byteLength - offset - 4) {
      partialSuffix = true;
      break;
    }
    const eventBytes = bytes.slice(offset + 4, offset + 4 + length);
    const value = decodeCanonical(eventBytes);
    if (!value.ok) return invalid(`events.${events.length}:encoding-noncanonical`);
    const event = parseOrchestrationEvent(value.value);
    if (!event.ok) return invalid(...prefixed(`events.${events.length}`, event.issues));
    events.push(event.value);
    offset += 4 + length;
    if (events.length > 4096) return invalid("events:length-refused");
  }
  const journal = parseEventJournal({ ...header.value, events });
  if (!journal.ok) return invalid(...journal.issues);
  return {
    ok: true,
    value: { authoritativeByteLength: offset, journal: journal.value, partialSuffix },
  };
}
export function parseEventJournalBytes(input: unknown): ParseResult<EventJournal> {
  const inspected = inspectEventJournalBytes(input);
  if (!inspected.ok) return invalid(...inspected.issues);
  return inspected.value.partialSuffix
    ? invalid("encoding:partial-final-frame")
    : { ok: true, value: inspected.value.journal };
}

export type EventJournalAppendPlan =
  | Readonly<{ ok: false; issues: readonly string[] }>
  | Readonly<{
      ok: true;
      value: Readonly<{
        bytes: Uint8Array;
        resultingPrefixDigest: string;
        status: "APPEND" | "IDEMPOTENT";
      }>;
    }>;

/** Compare-and-append planning only; it performs no write, fsync, read-back, or admission. */
export function planEventJournalAppend(
  prefixInput: unknown,
  eventInput: unknown,
): EventJournalAppendPlan {
  const bytes = rawBytes(prefixInput);
  if (!bytes) return specializedFailure("prefix:bytes-required");
  const inspected = inspectEventJournalBytes(bytes);
  if (!inspected.ok) return specializedFailure(...inspected.issues);
  if (inspected.value.partialSuffix) return specializedFailure("prefix:partial-final-frame");
  const event = parseOrchestrationEvent(eventInput);
  if (!event.ok) return specializedFailure(...prefixed("event", event.issues));
  const journal = inspected.value.journal,
    prior = journal.events[journal.events.length - 1];
  if (prior && event.value.position === prior.position) {
    return same(prior, event.value)
      ? {
          ok: true,
          value: {
            bytes,
            resultingPrefixDigest: computeEventJournalPrefixDigest(bytes),
            status: "IDEMPOTENT",
          },
        }
      : specializedFailure("event:position-conflict");
  }
  if (journal.events.length >= 4096) return specializedFailure("journal:capacity-exhausted");
  if (prior?.phase === "TERMINAL" && (prior.output as ContractRecord).kind === "CYCLE_TERMINAL")
    return specializedFailure("event:after-cycle-terminal");
  if (
    event.value.position !== String(journal.events.length) ||
    event.value.previousPrefixDigest !== computeEventJournalPrefixDigest(bytes) ||
    event.value.previousEventDigest !== (prior ? computeOrchestrationEventDigest(prior) : null)
  )
    return specializedFailure("event:prefix-mismatch");
  const eventBytes = canonicalBytes(event.value),
    resulting = concat([bytes, u32(eventBytes.byteLength), eventBytes]);
  const candidate = parseEventJournal({ ...journal, events: [...journal.events, event.value] });
  if (!candidate.ok) return specializedFailure(...prefixed("event", candidate.issues));
  return {
    ok: true,
    value: {
      bytes: resulting,
      resultingPrefixDigest: computeEventJournalPrefixDigest(resulting),
      status: "APPEND",
    },
  };
}

function parseBindings(input: unknown): ParseResult<ReducedBindings> {
  const parsed = snapshotClosedRecord(input, F.bindings);
  if (!parsed.ok) return parsed;
  const issues = F.bindings
    .filter((field) => parsed.value[field] !== null && !digest(parsed.value[field]))
    .map((field) => `${field}:invalid`);
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: parsed.value as unknown as ReducedBindings };
}
function parseReducedSteps(input: JsonValue | undefined, maximum: number): ParseResult {
  if (!Array.isArray(input) || input.length > maximum) return invalid("length-refused");
  const rows: ContractRecord[] = [],
    issues: string[] = [];
  let previous = 0;
  for (const [index, value] of input.entries()) {
    const parsed = snapshotClosedRecord(value, F.reducedStep);
    if (!parsed.ok) {
      issues.push(...prefixed(String(index), parsed.issues));
      continue;
    }
    const row = parsed.value;
    if (!decimal(row.ordinal, 15) || Number(row.ordinal) < 1)
      issues.push(`${index}.ordinal:invalid`);
    else if (Number(row.ordinal) <= previous || Number(row.ordinal) !== index + 1)
      issues.push("order-or-density-refused");
    else previous = Number(row.ordinal);
    if (!member(row.state, ["STARTED", "TERMINAL", "SKIPPED"]))
      issues.push(`${index}.state:invalid`);
    if (!digest(row.stepDigest)) issues.push(`${index}.stepDigest:invalid`);
    if (row.state === "STARTED") {
      if (row.primaryDigest !== null) issues.push(`${index}.primaryDigest:null-required`);
    } else if (!digest(row.primaryDigest)) issues.push(`${index}.primaryDigest:invalid`);
    if (!Array.isArray(row.dependentDigests) || row.dependentDigests.length > 2)
      issues.push(`${index}.dependentDigests:length-refused`);
    else if (row.dependentDigests.some((item) => !digest(item)))
      issues.push(`${index}.dependentDigests:invalid`);
    rows.push(row);
  }
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: Object.freeze(rows) as unknown as ContractRecord };
}

export function parseReducedState(input: unknown): ParseResult<ReducedState> {
  const parsed = snapshotClosedRecord(input, F.reduced);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "reduced-state/v1") issues.push("schemaVersion:mismatch");
  if (!uuid(row.cycleId)) issues.push("cycleId:invalid");
  for (const field of ["cyclePlanDigest", "journalPrefixDigest"] as const)
    if (!digest(row[field])) issues.push(`${field}:invalid`);
  nested(parseBindings(row.bindings), "bindings", issues);
  const steps = parseReducedSteps(row.steps, 15);
  nested(steps, "steps", issues);
  if (row.pendingStep !== null)
    nested(parseRoutineStepIdentity(row.pendingStep), "pendingStep", issues);
  const outcome = record(row.outcome);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  const kind = outcome.value.kind;
  const expected =
    kind === "RUNNING"
      ? F.kind
      : kind === "WAITING_WORKER"
        ? F.attempt
        : kind === "WAITING_REVIEW"
          ? F.request
          : kind === "WAITING_ACTION"
            ? F.dispositionWait
            : kind === "TERMINALIZING"
              ? F.terminalizing
              : member(kind, ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"])
                ? F.completed
                : kind === "UNKNOWN"
                  ? F.unknown
                  : null;
  if (!expected) issues.push("outcome.kind:invalid");
  else {
    issues.push(...closedRecord(outcome.value, expected, "outcome"));
    if (kind === "WAITING_WORKER" && !uuid(outcome.value.attemptId))
      issues.push("outcome.attemptId:invalid");
    if (kind === "WAITING_REVIEW" && !digest(outcome.value.requestDigest))
      issues.push("outcome.requestDigest:invalid");
    if (
      kind === "WAITING_ACTION" &&
      outcome.value.dispositionDigest !== null &&
      !digest(outcome.value.dispositionDigest)
    )
      issues.push("outcome.dispositionDigest:invalid");
    if (kind === "TERMINALIZING" && !digest(outcome.value.terminalStepDigest))
      issues.push("outcome.terminalStepDigest:invalid");
    if (
      member(kind, ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"]) &&
      !digest(outcome.value.cycleReceiptDigest)
    )
      issues.push("outcome.cycleReceiptDigest:invalid");
    if (
      kind === "UNKNOWN" &&
      !member(outcome.value.reason, [
        "EARLIER_UNKNOWN",
        "PREFIX_CONFLICT",
        "OUTPUT_CONFLICT",
        "RESOURCE_UNKNOWN",
        "HISTORY_UNPROVEN",
      ])
    )
      issues.push("outcome.reason:invalid");
  }
  if (row.pendingStep === null) {
    if (kind === "WAITING_WORKER" || kind === "WAITING_REVIEW") issues.push("pendingStep:required");
    if (kind === "WAITING_ACTION" && outcome.value.dispositionDigest === null)
      issues.push("pendingStep:required");
    if (kind === "TERMINALIZING") issues.push("pendingStep:required");
  } else if (
    !member(kind, [
      "RUNNING",
      "WAITING_WORKER",
      "WAITING_REVIEW",
      "WAITING_ACTION",
      "TERMINALIZING",
    ])
  )
    issues.push("pendingStep:null-required");
  if (steps.ok) {
    const values = steps.value as unknown as readonly ReducedStep[];
    const started = values.filter((step) => step.state === "STARTED");
    if (started.length > 1) issues.push("steps:multiple-started");
    if (row.pendingStep === null) {
      if (started.length) issues.push("steps:started-requires-pending");
    } else {
      const pendingStep = parseRoutineStepIdentity(row.pendingStep);
      if (
        pendingStep.ok &&
        (pendingStep.value.cycleId !== row.cycleId ||
          started.length !== 1 ||
          started[0]!.ordinal !== pendingStep.value.ordinal ||
          started[0]!.stepDigest !== computeRoutineStepDigest(pendingStep.value))
      )
        issues.push("steps:pending-mismatch");
      if (
        pendingStep.ok &&
        kind === "WAITING_WORKER" &&
        pendingStep.value.ordinal !== "8" &&
        pendingStep.value.ordinal !== "9"
      )
        issues.push("pendingStep:worker-ordinal-mismatch");
      if (pendingStep.ok && kind === "WAITING_REVIEW" && pendingStep.value.ordinal !== "10")
        issues.push("pendingStep:review-ordinal-mismatch");
      if (pendingStep.ok && kind === "WAITING_ACTION" && pendingStep.value.ordinal !== "11")
        issues.push("pendingStep:action-ordinal-mismatch");
      if (pendingStep.ok && kind === "WAITING_ACTION" && outcome.value.dispositionDigest !== null)
        issues.push("outcome.dispositionDigest:null-while-started-required");
      if (
        pendingStep.ok &&
        kind === "TERMINALIZING" &&
        outcome.value.terminalStepDigest !== computeRoutineStepDigest(pendingStep.value)
      )
        issues.push("outcome.terminalStepDigest:pending-mismatch");
    }
    if (
      member(kind, ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"]) &&
      (values.length !== 15 || values[14]?.state !== "TERMINAL")
    )
      issues.push("steps:completed-census-required");
    if (kind === "TERMINALIZING" && (values.length !== 15 || values[14]?.state !== "STARTED"))
      issues.push("steps:terminalizing-census-required");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as unknown as ReducedState };
}
export function computeReducedStateDigest(input: unknown): string {
  const parsed = parseReducedState(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("reduced-state/v1", [frame.canonical(parsed.value)]);
}

export function parseCycleReceipt(input: unknown): ParseResult<CycleReceipt> {
  const parsed = snapshotClosedRecord(input, F.cycleReceipt);
  if (!parsed.ok) return parsed;
  const row = parsed.value,
    issues: string[] = [];
  if (row.schemaVersion !== "cycle-receipt/v1") issues.push("schemaVersion:mismatch");
  for (const field of ["cycleId", "sessionId"] as const)
    if (!uuid(row[field])) issues.push(`${field}:invalid`);
  for (const field of [
    "cyclePlanDigest",
    "reducedStateDigest",
    "startedJournalPrefixDigest",
    "terminalStepDigest",
  ] as const)
    if (!digest(row[field])) issues.push(`${field}:invalid`);
  if (!member(row.outcome, ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"]))
    issues.push("outcome:invalid");
  if (!member(row.reclaimOutcome, ["NO_ALLOCATION", "RECLAIMED", "RETAINED"]))
    issues.push("reclaimOutcome:invalid");
  nested(parseBindings(row.bindings), "bindings", issues);
  const steps = parseReducedSteps(row.steps, 15);
  nested(steps, "steps", issues);
  if (steps.ok) {
    const values = steps.value as unknown as readonly ReducedStep[];
    if (
      values.length !== 15 ||
      values.slice(0, 14).some((step) => step.state === "STARTED") ||
      values[0]?.state !== "TERMINAL" ||
      values[13]?.state !== "TERMINAL" ||
      values[14]?.state !== "STARTED"
    )
      issues.push("steps:terminalizing-census-required");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: row as unknown as CycleReceipt };
}
export function computeCycleReceiptDigest(input: unknown): string {
  const parsed = parseCycleReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("cycle-receipt/v1", [frame.canonical(parsed.value)]);
}

type EvidenceSet = Readonly<{
  bytes: ReadonlyMap<RetainedEvidenceKind, Uint8Array>;
  decoded: ReadonlyMap<RetainedEvidenceKind, unknown>;
}>;
function bindEvidence(
  event: OrchestrationEvent,
  input: unknown,
  expectedKinds: readonly RetainedEvidenceKind[],
):
  | { readonly ok: true; readonly value: EvidenceSet }
  | { readonly ok: false; readonly issues: readonly string[] } {
  let inputs: readonly unknown[] = [];
  try {
    if (
      nodeTypes.isProxy(input) ||
      !Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length !== expectedKinds.length
    )
      return specializedFailure("retainedEvidenceInput:length-mismatch");
    inputs = input;
  } catch {
    return specializedFailure("retainedEvidenceInput:unreadable");
  }
  if (
    event.retainedEvidence.length !== expectedKinds.length ||
    event.retainedEvidence.some((row, index) => row.kind !== expectedKinds[index])
  )
    return specializedFailure("retainedEvidence:census-mismatch");
  const bytes = new Map<RetainedEvidenceKind, Uint8Array>();
  const decoded = new Map<RetainedEvidenceKind, unknown>();
  const issues: string[] = [];
  for (const [index, expectedKind] of expectedKinds.entries()) {
    const candidate = inputs[index];
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      nodeTypes.isProxy(candidate) ||
      Array.isArray(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      issues.push(`retainedEvidenceInput.${index}:record-required`);
      continue;
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
      Object.keys(descriptors).sort().join("\0") !== "bytes\0kind" ||
      Object.values(descriptors).some(
        (descriptor) => !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      issues.push(`retainedEvidenceInput.${index}:closed-data-record-required`);
      continue;
    }
    const kind = descriptors.kind!.value as unknown;
    const raw = rawBytes(descriptors.bytes!.value);
    const reference = event.retainedEvidence[index]!;
    if (kind !== expectedKind || reference.kind !== expectedKind)
      issues.push(`retainedEvidenceInput.${index}.kind:mismatch`);
    if (!raw) {
      issues.push(`retainedEvidenceInput.${index}.bytes:invalid`);
      continue;
    }
    if (
      reference.byteLength !== String(raw.byteLength) ||
      reference.contentDigest !== createHash("sha256").update(raw).digest("hex")
    )
      issues.push(`retainedEvidenceInput.${index}.bytes:reference-mismatch`);
    const jsonKind = member(expectedKind, [
      "MAPPING_OBSERVATION",
      "MUTATION_OBSERVATION",
      "PREFLIGHT_OBSERVATION",
    ]);
    if (reference.encoding !== (jsonKind ? "CANONICAL_JSON" : "RAW_BYTES"))
      issues.push(`retainedEvidence.${index}.encoding:mismatch`);
    if (jsonKind) {
      const value = decodeCanonical(raw);
      if (!value.ok) issues.push(`retainedEvidenceInput.${index}:canonical-json-invalid`);
      else decoded.set(expectedKind, value.value);
    }
    bytes.set(expectedKind, raw);
  }
  return issues.length ? specializedFailure(...issues) : { ok: true, value: { bytes, decoded } };
}
function captureKinds(terminal: ContractRecord): RetainedEvidenceKind[] {
  const capture = terminal.capture as ContractRecord;
  const kinds: RetainedEvidenceKind[] = [];
  if ((capture.stderr as ContractRecord).kind !== "UNAVAILABLE") kinds.push("STDERR");
  if ((capture.stdout as ContractRecord).kind !== "UNAVAILABLE") kinds.push("STDOUT");
  return kinds;
}
function dispositionCaptureKinds(input: ContractRecord): RetainedEvidenceKind[] {
  const worker = input.worker as ContractRecord | null;
  return worker === null ? [] : captureKinds(worker.terminal as ContractRecord);
}
function reclaimEvidenceKinds(context: ContractRecord): RetainedEvidenceKind[] {
  const origin = context.origin as ContractRecord;
  const kinds: RetainedEvidenceKind[] = [];
  if (origin.kind === "PREPARATION") {
    const plan = origin.plan as ContractRecord | null;
    if (plan !== null && (plan.outcome as ContractRecord).kind === "PLANNED")
      kinds.push("RENDERED_INPUT");
    if (origin.terminal !== null) kinds.push(...captureKinds(origin.terminal as ContractRecord));
  } else if (origin.kind === "ACTION")
    kinds.push(...dispositionCaptureKinds(origin.dispositionInput as ContractRecord));
  return [...new Set(kinds)].sort() as RetainedEvidenceKind[];
}
function requiredEvidenceKinds(output: ContractRecord): RetainedEvidenceKind[] {
  const kinds: RetainedEvidenceKind[] = [];
  if (
    output.kind === "ROUTE" &&
    (output.route as ContractRecord).outcome !== null &&
    ((output.route as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN" &&
    ((output.route as ContractRecord).outcome as ContractRecord).reason === "MAPPING_INVALID"
  )
    kinds.push("MAPPING_OBSERVATION");
  if (
    output.kind === "PREFLIGHT" &&
    ((output.preflight as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN" &&
    ((output.preflight as ContractRecord).outcome as ContractRecord).reason ===
      "OBSERVATION_INVALID"
  )
    kinds.push("PREFLIGHT_OBSERVATION");
  if (
    output.kind === "DISPATCH_PLAN" &&
    ((output.plan as ContractRecord).outcome as ContractRecord).kind === "PLANNED"
  )
    kinds.push("RENDERED_INPUT");
  if (output.kind === "LAUNCH" && output.terminal !== null)
    kinds.push(...captureKinds(output.terminal as ContractRecord));
  if (output.kind === "WORKER_TERMINAL")
    kinds.push(...captureKinds(output.terminal as ContractRecord));
  if (output.kind === "DISPOSITION")
    kinds.push(...dispositionCaptureKinds(output.input as ContractRecord));
  if (output.kind === "MUTATION_PLAN") {
    const plan = output.plan as ContractRecord;
    const outcome = plan.outcome as ContractRecord;
    if (outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_INVALID")
      kinds.push("MUTATION_OBSERVATION");
    kinds.push(...dispositionCaptureKinds(output.dispositionInput as ContractRecord));
  }
  if (output.kind === "PROJECT_APPLY")
    kinds.push(...dispositionCaptureKinds(output.dispositionInput as ContractRecord));
  if (output.kind === "RECLAIM")
    kinds.push(...reclaimEvidenceKinds(output.context as ContractRecord));
  return [...new Set(kinds)].sort() as RetainedEvidenceKind[];
}
const supplied = (evidence: EvidenceSet, kind: RetainedEvidenceKind) =>
  evidence.bytes.get(kind) ?? null;
const observed = (evidence: EvidenceSet, kind: RetainedEvidenceKind) =>
  evidence.decoded.get(kind) ?? null;

/** Replays one complete owning relation. It does not append, select history, or admit effects. */
export function validateOrchestrationEventBinding(
  eventInput: unknown,
  retainedEvidenceInput: unknown,
): ParseResult<OrchestrationEvent> {
  const event = parseOrchestrationEvent(eventInput);
  if (!event.ok) return event;
  if (event.value.phase === "STARTED") {
    const evidence = bindEvidence(event.value, retainedEvidenceInput, []);
    return evidence.ok ? event : invalid(...evidence.issues);
  }
  const output = event.value.output!;
  const evidence = bindEvidence(event.value, retainedEvidenceInput, requiredEvidenceKinds(output));
  if (!evidence.ok) return invalid(...evidence.issues);
  const row = output,
    issues: string[] = [],
    stdout = supplied(evidence.value, "STDOUT"),
    stderr = supplied(evidence.value, "STDERR");
  switch (row.kind) {
    case "SESSION":
      nested(validateSessionHealthBinding(row.health, row.cyclePlan), "output.health", issues);
      if (!same((row.health as ContractRecord).step, event.value.step))
        issues.push("output.health.step:mismatch");
      break;
    case "PROJECT_FACTS":
      nested(validateProjectFactsBinding(row.facts, row.configuration), "output.facts", issues);
      break;
    case "BREAKER":
      nested(
        validateBreakerReceiptBinding(
          row.provenance,
          row.configuration,
          row.cycleRequest,
          row.projectFacts,
          row.policyFacts,
          row.prior,
          row.receipt,
        ),
        "output.receipt",
        issues,
      );
      break;
    case "MODULE":
      nested(validateModulePlanBinding(row.input, row.result), "output.result", issues);
      break;
    case "ROUTE": {
      const route = row.route as ContractRecord,
        outcome = route.outcome as ContractRecord;
      const mapping =
        outcome.kind === "UNKNOWN" && outcome.reason === "MAPPING_INVALID"
          ? observed(evidence.value, "MAPPING_OBSERVATION")
          : row.mapping;
      if (
        outcome.kind === "UNKNOWN" &&
        outcome.reason === "MAPPING_INVALID" &&
        row.mapping !== null
      )
        issues.push("output.mapping:null-required-for-invalid-input");
      nested(
        validateRouteSelectionBinding(row.input, row.action, mapping, row.route),
        "output.route",
        issues,
      );
      break;
    }
    case "PREFLIGHT": {
      const outcome = (row.preflight as ContractRecord).outcome as ContractRecord;
      const observation =
        outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_INVALID"
          ? observed(evidence.value, "PREFLIGHT_OBSERVATION")
          : row.observation;
      if (
        outcome.kind === "UNKNOWN" &&
        outcome.reason === "OBSERVATION_INVALID" &&
        row.observation !== null
      )
        issues.push("output.observation:null-required-for-invalid-input");
      nested(
        validateProjectPreflightBinding(
          row.input,
          row.action,
          row.mapping,
          row.route,
          observation,
          row.preflight,
        ),
        "output.preflight",
        issues,
      );
      break;
    }
    case "DISPATCH_PLAN":
      nested(
        validateDispatchPlanBinding(
          row.input,
          row.action,
          row.mapping,
          row.route,
          row.observation,
          row.preflight,
          row.cyclePlan,
          row.health,
          row.reviewRequest,
          supplied(evidence.value, "RENDERED_INPUT"),
          row.plan,
        ),
        "output.plan",
        issues,
      );
      break;
    case "LAUNCH": {
      const launch = row.launch as ContractRecord;
      nested(validateWorkerLaunchReceiptBinding(row.plan, row.launch), "output.launch", issues);
      if ((launch.outcome as ContractRecord).kind === "START_FAILED") {
        if (row.terminal === null) issues.push("output.terminal:required-for-start-failure");
        else
          nested(
            validateWorkerTerminalReceiptBinding(
              row.plan,
              row.launch,
              stdout,
              stderr,
              row.terminal,
            ),
            "output.terminal",
            issues,
          );
      } else if (row.terminal !== null) issues.push("output.terminal:null-required");
      break;
    }
    case "WORKER_TERMINAL": {
      nested(
        validateWorkerTerminalReceiptBinding(row.plan, row.launch, stdout, stderr, row.terminal),
        "output.terminal",
        issues,
      );
      const plan = row.plan as ContractRecord,
        terminal = row.terminal as ContractRecord,
        review = plan.reviewRequestDigest !== null,
        known = member((terminal.outcome as ContractRecord).kind, ["EXITED", "START_FAILED"]);
      if ((terminal.outcome as ContractRecord).kind === "START_FAILED")
        issues.push("output:launch-failure-requires-skip");
      if (review && known && (terminal.outcome as ContractRecord).kind === "EXITED") {
        if (row.resultSubject !== null) issues.push("output.resultSubject:null-required");
        if (row.attempt !== null) {
          const attempt = row.attempt as ContractRecord;
          if (
            attempt.attemptId !== plan.attemptId ||
            attempt.cycleId !== event.value.cycleId ||
            attempt.dispatchPlanDigest !== computeDispatchPlanDigest(plan) ||
            attempt.launchReceiptDigest !== computeWorkerLaunchReceiptDigest(row.launch) ||
            attempt.terminalReceiptDigest !== computeWorkerTerminalReceiptDigest(terminal)
          )
            issues.push("output.attempt:worker-binding-mismatch");
        }
      } else if (known && (terminal.outcome as ContractRecord).kind === "EXITED") {
        if (row.attempt !== null) issues.push("output.attempt:null-required");
        if (row.resultSubject !== null) {
          const subject = row.resultSubject as ContractRecord;
          if (
            subject.authorAttemptId !== plan.attemptId ||
            subject.authorCycleId !== event.value.cycleId ||
            subject.terminalReceiptDigest !== computeWorkerTerminalReceiptDigest(terminal)
          )
            issues.push("output.resultSubject:worker-binding-mismatch");
        }
      } else if (row.attempt !== null || row.resultSubject !== null)
        issues.push("output:diagnostic-null-matrix");
      break;
    }
    case "REVIEW_AUTHORITY":
      nested(
        validateReviewResultBinding(row.request, row.attempt, row.authority),
        "output.authority",
        issues,
      );
      break;
    case "DISPOSITION": {
      nested(
        validateActionDispositionBinding(row.input, stdout, stderr, row.disposition),
        "output.disposition",
        issues,
      );
      const disposition = row.disposition as ContractRecord,
        outcome = disposition.outcome as ContractRecord,
        hasFollowUp = Object.hasOwn(outcome, "followUp") && outcome.followUp !== null;
      if (hasFollowUp) {
        if (row.followUp === null) issues.push("output.followUp:required");
        else
          nested(
            validateFollowUpCycleRequestBinding(
              row.input,
              stdout,
              stderr,
              row.disposition,
              row.followUp,
            ),
            "output.followUp",
            issues,
          );
      } else if (row.followUp !== null) issues.push("output.followUp:null-required");
      break;
    }
    case "MUTATION_PLAN": {
      nested(
        validateProjectMutationRequestBinding(
          row.dispositionInput,
          stdout,
          stderr,
          row.disposition,
          row.request,
        ),
        "output.request",
        issues,
      );
      const outcome = (row.plan as ContractRecord).outcome as ContractRecord;
      const observation =
        outcome.kind === "UNKNOWN" && outcome.reason === "OBSERVATION_INVALID"
          ? observed(evidence.value, "MUTATION_OBSERVATION")
          : row.observation;
      if (
        outcome.kind === "UNKNOWN" &&
        outcome.reason === "OBSERVATION_INVALID" &&
        row.observation !== null
      )
        issues.push("output.observation:null-required-for-invalid-input");
      nested(
        validateProjectMutationPlanBinding(
          row.dispositionInput,
          stdout,
          stderr,
          row.disposition,
          row.request,
          observation,
          row.plan,
        ),
        "output.plan",
        issues,
      );
      break;
    }
    case "PROJECT_APPLY":
      nested(
        validateProjectApplyReceiptBinding(
          row.dispositionInput,
          stdout,
          stderr,
          row.disposition,
          row.request,
          row.dryObservation,
          row.plan,
          row.expectedPlanDigest,
          row.beforeObservation,
          row.afterObservation,
          row.receipt,
        ),
        "output.receipt",
        issues,
      );
      break;
    case "RECLAIM":
      nested(
        validateResourceReclaimReceiptBinding(
          row.context,
          supplied(evidence.value, "RENDERED_INPUT"),
          stdout,
          stderr,
          row.receipt,
        ),
        "output.receipt",
        issues,
      );
      break;
    case "SKIP":
      if (!same((row.skip as ContractRecord).step, event.value.step))
        issues.push("output.skip.step:mismatch");
      break;
    case "CYCLE_TERMINAL":
      break;
  }
  const cycleCandidate =
    row.kind === "SESSION"
      ? ((row.cyclePlan as ContractRecord).request as ContractRecord).cycleId
      : row.kind === "BREAKER"
        ? (row.cycleRequest as ContractRecord).cycleId
        : member(row.kind, ["MODULE", "ROUTE", "PREFLIGHT", "DISPATCH_PLAN"])
          ? ((row.input as ContractRecord).cycleRequest as ContractRecord).cycleId
          : row.kind === "REVIEW_AUTHORITY"
            ? (row.request as ContractRecord).reviewCycleId
            : member(row.kind, ["DISPOSITION", "MUTATION_PLAN", "PROJECT_APPLY"])
              ? (
                  (
                    (
                      row[
                        row.kind === "DISPOSITION" ? "input" : "dispositionInput"
                      ] as ContractRecord
                    ).moduleInput as ContractRecord
                  ).cycleRequest as ContractRecord
                ).cycleId
              : row.kind === "RECLAIM"
                ? (
                    ((row.context as ContractRecord).cyclePlan as ContractRecord)
                      .request as ContractRecord
                  ).cycleId
                : row.kind === "CYCLE_TERMINAL"
                  ? (row.receipt as ContractRecord).cycleId
                  : event.value.cycleId;
  if (cycleCandidate !== event.value.cycleId) issues.push("output:cycle-mismatch");
  return issues.length ? invalid(...issues) : event;
}

function outputIdentity(
  output: ContractRecord,
): Readonly<{ primary: string; dependents: readonly string[] }> {
  switch (output.kind) {
    case "SESSION":
      return { primary: computeSessionHealthDigest(output.health), dependents: [] };
    case "PROJECT_FACTS":
      return { primary: canonicalDigest(output.facts), dependents: [] };
    case "BREAKER":
      return { primary: computeBreakerReceiptDigest(output.receipt), dependents: [] };
    case "MODULE":
      return {
        primary:
          (output.result as ContractRecord).schemaVersion === "module-action-plan/v1"
            ? computeModuleActionPlanDigest(output.result)
            : computeModuleNoActionDigest(output.result),
        dependents: [],
      };
    case "ROUTE":
      return { primary: computeRouteSelectionDigest(output.route), dependents: [] };
    case "PREFLIGHT":
      return { primary: computeProjectPreflightDigest(output.preflight), dependents: [] };
    case "DISPATCH_PLAN":
      return { primary: computeDispatchPlanDigest(output.plan), dependents: [] };
    case "LAUNCH":
      return {
        primary: computeWorkerLaunchReceiptDigest(output.launch),
        dependents:
          output.terminal === null ? [] : [computeWorkerTerminalReceiptDigest(output.terminal)],
      };
    case "WORKER_TERMINAL":
      return {
        primary: computeWorkerTerminalReceiptDigest(output.terminal),
        dependents:
          output.attempt !== null
            ? [computeReviewAttemptResultDigest(output.attempt)]
            : output.resultSubject !== null
              ? [computeWorkerResultSubjectDigest(output.resultSubject)]
              : [],
      };
    case "REVIEW_AUTHORITY":
      return { primary: computeReviewAuthorityDigest(output.authority), dependents: [] };
    case "DISPOSITION":
      return {
        primary: computeActionDispositionDigest(output.disposition),
        dependents:
          output.followUp === null ? [] : [computeFollowUpCycleRequestDigest(output.followUp)],
      };
    case "MUTATION_PLAN":
      return { primary: computeProjectMutationPlanDigest(output.plan), dependents: [] };
    case "PROJECT_APPLY":
      return { primary: computeProjectApplyReceiptDigest(output.receipt), dependents: [] };
    case "RECLAIM":
      return { primary: computeResourceReclaimReceiptDigest(output.receipt), dependents: [] };
    case "CYCLE_TERMINAL":
      return { primary: computeCycleReceiptDigest(output.receipt), dependents: [] };
    case "SKIP":
      return { primary: computeRoutineStepSkipDigest(output.skip), dependents: [] };
    default:
      throw new TypeError("output.kind:unsupported");
  }
}

function outputUnknown(output: ContractRecord): "EARLIER_UNKNOWN" | "RESOURCE_UNKNOWN" | null {
  switch (output.kind) {
    case "SESSION":
      return (output.health as ContractRecord).outcome === "UNKNOWN" ? "EARLIER_UNKNOWN" : null;
    case "PROJECT_FACTS":
      return (output.facts as ContractRecord).state === "UNKNOWN" ? "EARLIER_UNKNOWN" : null;
    case "BREAKER":
      return ((output.receipt as ContractRecord).result as ContractRecord).kind === "UNKNOWN"
        ? "EARLIER_UNKNOWN"
        : null;
    case "ROUTE":
    case "PREFLIGHT":
    case "DISPATCH_PLAN":
    case "MUTATION_PLAN":
      return (
        (
          output[
            output.kind === "ROUTE" ? "route" : output.kind === "PREFLIGHT" ? "preflight" : "plan"
          ] as ContractRecord
        ).outcome as ContractRecord
      ).kind === "UNKNOWN"
        ? "EARLIER_UNKNOWN"
        : null;
    case "LAUNCH":
      return ((output.launch as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN"
        ? "EARLIER_UNKNOWN"
        : null;
    case "WORKER_TERMINAL":
      return member(((output.terminal as ContractRecord).outcome as ContractRecord).kind, [
        "UNKNOWN",
        "TERMINATION_FAILED_LIVE",
      ])
        ? "EARLIER_UNKNOWN"
        : null;
    case "REVIEW_AUTHORITY":
      return ((output.authority as ContractRecord).outcome as ContractRecord).kind === "unknown"
        ? "EARLIER_UNKNOWN"
        : null;
    case "DISPOSITION":
      return ((output.disposition as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN"
        ? "EARLIER_UNKNOWN"
        : null;
    case "PROJECT_APPLY":
      return ((output.receipt as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN"
        ? "EARLIER_UNKNOWN"
        : null;
    case "RECLAIM":
      return ((output.receipt as ContractRecord).outcome as ContractRecord).kind === "UNKNOWN"
        ? "RESOURCE_UNKNOWN"
        : null;
    default:
      return null;
  }
}

function emptyBindings(): ReducedBindings {
  return {
    actionDigest: null,
    applyDigest: null,
    followUpDigest: null,
    mutationPlanDigest: null,
    reclaimDigest: null,
    reviewAuthorityDigest: null,
    subjectDigest: null,
  };
}
function updateBindings(bindings: ReducedBindings, output: ContractRecord): ReducedBindings {
  const next = { ...bindings };
  if (
    output.kind === "MODULE" &&
    (output.result as ContractRecord).schemaVersion === "module-action-plan/v1"
  )
    next.actionDigest = computeModuleActionPlanDigest(output.result);
  if (output.kind === "WORKER_TERMINAL" && output.resultSubject !== null)
    next.subjectDigest = computeWorkerResultSubjectDigest(output.resultSubject);
  if (output.kind === "REVIEW_AUTHORITY") {
    next.reviewAuthorityDigest = computeReviewAuthorityDigest(output.authority);
    next.subjectDigest = (output.authority as ContractRecord).subjectDigest as string;
  }
  if (output.kind === "DISPOSITION") {
    if (output.followUp !== null)
      next.followUpDigest = computeFollowUpCycleRequestDigest(output.followUp);
  }
  if (output.kind === "MUTATION_PLAN")
    next.mutationPlanDigest = computeProjectMutationPlanDigest(output.plan);
  if (output.kind === "PROJECT_APPLY")
    next.applyDigest = computeProjectApplyReceiptDigest(output.receipt);
  if (output.kind === "RECLAIM")
    next.reclaimDigest = computeResourceReclaimReceiptDigest(output.receipt);
  return next;
}
function waitingOutcome(
  pending: RoutineStepIdentity,
  outputs: ReadonlyMap<number, ContractRecord>,
): ReducedState["outcome"] {
  const ordinal = Number(pending.ordinal);
  if (ordinal === 8 || ordinal === 9) {
    const plan = outputs.get(7)?.plan as ContractRecord | undefined;
    return plan && uuid(plan.attemptId)
      ? { attemptId: plan.attemptId, kind: "WAITING_WORKER" }
      : { kind: "RUNNING" };
  }
  if (ordinal === 10) {
    const plan = outputs.get(7)?.plan as ContractRecord | undefined;
    return plan && digest(plan.reviewRequestDigest)
      ? { kind: "WAITING_REVIEW", requestDigest: plan.reviewRequestDigest }
      : { kind: "RUNNING" };
  }
  if (ordinal === 11) return { dispositionDigest: null, kind: "WAITING_ACTION" };
  if (ordinal === 15)
    return { kind: "TERMINALIZING", terminalStepDigest: computeRoutineStepDigest(pending) };
  return { kind: "RUNNING" };
}
function continuityIssues(
  output: ContractRecord,
  outputs: ReadonlyMap<number, ContractRecord>,
  journal: EventJournal,
): string[] {
  const issues: string[] = [];
  const equal = (label: string, actual: unknown, expected: unknown) => {
    if (expected === undefined || !same(actual, expected))
      issues.push(`${label}:prior-output-mismatch`);
  };
  if (output.kind === "SESSION") equal("cyclePlan", output.cyclePlan, journal.cyclePlan);
  if (output.kind === "BREAKER") {
    equal("cycleRequest", output.cycleRequest, journal.cyclePlan.request);
    equal("configuration", output.configuration, outputs.get(2)?.configuration);
    equal("projectFacts", output.projectFacts, outputs.get(2)?.facts);
  }
  if (output.kind === "MODULE") {
    const input = output.input as ContractRecord;
    equal("input.cycleRequest", input.cycleRequest, journal.cyclePlan.request);
    equal("input.adapterConfiguration", input.adapterConfiguration, outputs.get(2)?.configuration);
    equal("input.projectFacts", input.projectFacts, outputs.get(2)?.facts);
    equal("input.policyFacts", input.policyFacts, outputs.get(3)?.policyFacts);
  }
  if (output.kind === "ROUTE") {
    const module = outputs.get(4);
    equal("input", output.input, module?.input);
    equal("action", output.action, module?.result);
  }
  if (output.kind === "PREFLIGHT") {
    const route = outputs.get(5);
    for (const field of ["input", "action", "mapping", "route"])
      equal(field, output[field], route?.[field]);
  }
  if (output.kind === "DISPATCH_PLAN") {
    const preflight = outputs.get(6);
    for (const field of ["input", "action", "mapping", "observation", "preflight", "route"])
      equal(field, output[field], preflight?.[field]);
    equal("cyclePlan", output.cyclePlan, journal.cyclePlan);
  }
  if (output.kind === "LAUNCH") equal("plan", output.plan, outputs.get(7)?.plan);
  if (output.kind === "WORKER_TERMINAL") {
    equal("plan", output.plan, outputs.get(7)?.plan);
    equal("launch", output.launch, outputs.get(8)?.launch);
    const dependent = outputs.get(8)?.terminal;
    if (dependent !== null && dependent !== undefined)
      equal("terminal", output.terminal, dependent);
    const attempt = output.attempt as ContractRecord | null;
    if (attempt !== null) {
      const request = outputs.get(7)?.reviewRequest as ContractRecord | null | undefined;
      if (request === null || request === undefined) issues.push("attempt:review-request-required");
      else {
        if (attempt.requestDigest !== computeReviewRequestDigest(request))
          issues.push("attempt.requestDigest:prior-output-mismatch");
        if (attempt.packetDigest !== computeReviewPacketDigest(request.packet))
          issues.push("attempt.packetDigest:prior-output-mismatch");
        const target = (request.packet as ContractRecord).subject as ContractRecord;
        const targetDigest =
          target.schemaVersion === "worker-result-subject/v1"
            ? computeWorkerResultSubjectDigest(target)
            : computeReleaseCandidateSubjectDigest(target);
        if (attempt.subjectDigest !== targetDigest)
          issues.push("attempt.subjectDigest:prior-output-mismatch");
      }
    }
    const subject = output.resultSubject as ContractRecord | null;
    if (subject !== null) {
      const configuration = outputs.get(4)?.input as ContractRecord | undefined;
      const adapter = configuration?.adapterConfiguration as ContractRecord | undefined;
      const base = subject.baseSource as ContractRecord;
      if (!adapter || base.adapterId !== adapter.adapterId || base.projectId !== adapter.projectId)
        issues.push("resultSubject.baseSource:prior-output-mismatch");
    }
  }
  if (output.kind === "REVIEW_AUTHORITY") {
    equal("attempt", output.attempt, outputs.get(9)?.attempt);
    equal("request", output.request, outputs.get(7)?.reviewRequest);
  }
  if (output.kind === "DISPOSITION") {
    const input = output.input as ContractRecord;
    equal("input.actionPlan", input.actionPlan, outputs.get(4)?.result);
    equal("input.moduleInput", input.moduleInput, outputs.get(4)?.input);
    equal("input.route", input.route, outputs.get(5)?.route);
    equal("input.preflight", input.preflight, outputs.get(6)?.preflight);
    const worker = input.worker as ContractRecord | null;
    if (worker !== null) {
      equal("input.worker.plan", worker.plan, outputs.get(7)?.plan);
      equal("input.worker.launch", worker.launch, outputs.get(8)?.launch);
      equal("input.worker.terminal", worker.terminal, outputs.get(9)?.terminal);
      equal("input.worker.resultSubject", worker.resultSubject, outputs.get(9)?.resultSubject);
    }
    const review = input.review as ContractRecord | null;
    if (review !== null) {
      equal("input.review.request", review.request, outputs.get(7)?.reviewRequest);
      equal("input.review.attempt", review.attempt, outputs.get(9)?.attempt);
      equal("input.review.authority", review.authority, outputs.get(10)?.authority);
    }
    if (Array.isArray(input.skips))
      for (const skip of input.skips) {
        const ordinal = Number(((skip as ContractRecord).step as ContractRecord).ordinal);
        equal(`input.skips.${ordinal}`, skip, outputs.get(ordinal)?.skip);
      }
  }
  if (output.kind === "MUTATION_PLAN") {
    equal("disposition", output.disposition, outputs.get(11)?.disposition);
    equal("dispositionInput", output.dispositionInput, outputs.get(11)?.input);
  }
  if (output.kind === "PROJECT_APPLY") {
    equal("disposition", output.disposition, outputs.get(11)?.disposition);
    equal("dispositionInput", output.dispositionInput, outputs.get(11)?.input);
    equal("request", output.request, outputs.get(12)?.request);
    equal("plan", output.plan, outputs.get(12)?.plan);
    equal("dryObservation", output.dryObservation, outputs.get(12)?.observation);
  }
  if (output.kind === "RECLAIM") {
    const context = output.context as ContractRecord;
    equal("context.cyclePlan", context.cyclePlan, journal.cyclePlan);
    const origin = context.origin as ContractRecord;
    if (origin.kind !== "SESSION")
      equal(
        "context.adapterConfiguration",
        context.adapterConfiguration,
        outputs.get(2)?.configuration,
      );
    if (Array.isArray(context.skips))
      for (const skip of context.skips) {
        const ordinal = Number(((skip as ContractRecord).step as ContractRecord).ordinal);
        equal(`context.skips.${ordinal}`, skip, outputs.get(ordinal)?.skip);
      }
    if (origin.kind === "SESSION")
      equal("context.origin.health", origin.health, outputs.get(1)?.health);
    if (origin.kind === "SNAPSHOT")
      equal("context.origin.facts", origin.facts, outputs.get(2)?.facts);
    if (origin.kind === "BREAKER") {
      const prior = outputs.get(3);
      for (const field of ["projectFacts", "policyFacts", "prior", "receipt"])
        equal(
          `context.origin.${field}`,
          origin[field === "projectFacts" ? "facts" : field],
          prior?.[field],
        );
    }
    if (origin.kind === "MODULE") {
      equal("context.origin.input", origin.input, outputs.get(4)?.input);
      equal("context.origin.result", origin.result, outputs.get(4)?.result);
    }
    if (origin.kind === "PREPARATION") {
      for (const [field, ordinal] of [
        ["input", 4],
        ["action", 4],
        ["mapping", 5],
        ["route", 5],
        ["observation", 6],
        ["preflight", 6],
        ["plan", 7],
        ["reviewRequest", 7],
        ["sessionHealth", 7],
        ["launch", 8],
        ["terminal", 9],
      ] as const)
        if (origin[field] !== null)
          equal(
            `context.origin.${field}`,
            origin[field],
            outputs.get(ordinal)?.[field === "sessionHealth" ? "health" : field],
          );
    }
    if (origin.kind === "ACTION") {
      equal("context.origin.disposition", origin.disposition, outputs.get(11)?.disposition);
      equal("context.origin.dispositionInput", origin.dispositionInput, outputs.get(11)?.input);
      equal("context.origin.followUp", origin.followUp, outputs.get(11)?.followUp);
      const mutation = origin.mutation as ContractRecord | null;
      if (mutation !== null) {
        equal("context.origin.mutation.request", mutation.request, outputs.get(12)?.request);
        equal("context.origin.mutation.plan", mutation.plan, outputs.get(12)?.plan);
        equal(
          "context.origin.mutation.dryObservation",
          mutation.dryObservation,
          outputs.get(12)?.observation,
        );
        if (mutation.receipt !== null) {
          equal("context.origin.mutation.receipt", mutation.receipt, outputs.get(13)?.receipt);
          equal(
            "context.origin.mutation.beforeObservation",
            mutation.beforeObservation,
            outputs.get(13)?.beforeObservation,
          );
          equal(
            "context.origin.mutation.afterObservation",
            mutation.afterObservation,
            outputs.get(13)?.afterObservation,
          );
        }
      }
    }
  }
  return issues;
}

function expectedCycleOutcome(
  outputs: ReadonlyMap<number, ContractRecord>,
): CycleReceipt["outcome"] | null {
  const reclaim = outputs.get(14)?.receipt as ContractRecord | undefined;
  if (!reclaim || (reclaim.outcome as ContractRecord).kind === "UNKNOWN") return null;
  const reclaimKind = (reclaim.outcome as ContractRecord).kind;
  if (reclaimKind === "RETAINED") return "FAILED_KNOWN";
  const module = outputs.get(4)?.result as ContractRecord | undefined;
  if (
    module?.schemaVersion === "module-no-action/v1" &&
    module.outcome === "NO_ACTION" &&
    module.reason === "NO_ELIGIBLE_ACTION" &&
    reclaimKind === "NO_ALLOCATION"
  )
    return "COMPLETED_NO_WORK";
  const breaker = outputs.get(3)?.receipt as ContractRecord | undefined;
  const breakerResult = breaker?.result as ContractRecord | undefined;
  if (
    breakerResult?.kind === "KNOWN" &&
    Array.isArray(breakerResult.capabilities) &&
    breakerResult.capabilities.length > 0 &&
    breakerResult.capabilities.every(
      (capability) => (capability as ContractRecord).state !== "CLOSED",
    ) &&
    reclaimKind === "NO_ALLOCATION"
  )
    return "COMPLETED_NO_WORK";
  const apply = outputs.get(13)?.receipt as ContractRecord | undefined;
  if (apply && (apply.outcome as ContractRecord).kind === "APPLIED") return "COMPLETED";
  const disposition = outputs.get(11)?.disposition as ContractRecord | undefined;
  if (disposition) {
    const kind = (disposition.outcome as ContractRecord).kind;
    if (kind === "COMPLETE" || kind === "REVIEW_NEEDED") return "COMPLETED";
  }
  return "FAILED_KNOWN";
}

/** Supplied pre-terminal state relation; it names no terminal event or future prefix. */
export function validateCycleReceiptBinding(
  journalInput: unknown,
  terminalizingStateInput: unknown,
  receiptInput: unknown,
): ParseResult<CycleReceipt> {
  const journal = parseEventJournal(journalInput);
  if (!journal.ok) return invalid(...prefixed("journal", journal.issues));
  const state = parseReducedState(terminalizingStateInput);
  if (!state.ok) return invalid(...prefixed("state", state.issues));
  const receipt = parseCycleReceipt(receiptInput);
  if (!receipt.ok) return receipt;
  const row = receipt.value,
    issues: string[] = [];
  if (state.value.outcome.kind !== "TERMINALIZING" || state.value.pendingStep?.ordinal !== "15")
    issues.push("state:terminalizing-required");
  if (
    row.cycleId !== journal.value.cycleId ||
    row.sessionId !== journal.value.sessionId ||
    row.cyclePlanDigest !== journal.value.cyclePlanDigest
  )
    issues.push("receipt:journal-identity-mismatch");
  if (
    row.reducedStateDigest !== computeReducedStateDigest(state.value) ||
    row.startedJournalPrefixDigest !== state.value.journalPrefixDigest ||
    row.terminalStepDigest !==
      (state.value.pendingStep ? computeRoutineStepDigest(state.value.pendingStep) : null) ||
    !same(row.bindings, state.value.bindings) ||
    !same(row.steps, state.value.steps)
  )
    issues.push("receipt:terminalizing-state-mismatch");
  const outputs = new Map<number, ContractRecord>();
  for (const event of journal.value.events)
    if (event.phase === "TERMINAL") outputs.set(Number(event.step.ordinal), event.output!);
  const reclaim = outputs.get(14)?.receipt as ContractRecord | undefined;
  if (!reclaim || (reclaim.outcome as ContractRecord).kind === "UNKNOWN")
    issues.push("receipt:known-reclaim-required");
  else if (row.reclaimOutcome !== (reclaim.outcome as ContractRecord).kind)
    issues.push("receipt.reclaimOutcome:mismatch");
  const expected = expectedCycleOutcome(outputs);
  if (expected === null || row.outcome !== expected) issues.push("receipt.outcome:mismatch");
  if (
    row.steps.length !== 15 ||
    row.steps.some((step, index) => step.ordinal !== String(index + 1)) ||
    row.steps[14]?.state !== "STARTED"
  )
    issues.push("receipt.steps:complete-census-required");
  return issues.length ? invalid(...issues) : receipt;
}

/** Deterministic project-path replay. Evidence rows supply bytes; no effect or append is performed. */
export function reduceEventJournal(
  journalInput: unknown,
  retainedEvidenceByEvent: unknown,
): ParseResult<ReducedState> {
  const journal = parseEventJournal(journalInput);
  if (!journal.ok) return invalid(...prefixed("journal", journal.issues));
  if (
    !Array.isArray(retainedEvidenceByEvent) ||
    retainedEvidenceByEvent.length !== journal.value.events.length
  )
    return invalid("retainedEvidenceByEvent:length-mismatch");
  const steps = new Map<number, ReducedStep>();
  const outputs = new Map<number, ContractRecord>();
  let bindings = emptyBindings();
  let pending: RoutineStepIdentity | null = null;
  let outcome: ReducedState["outcome"] = { kind: "RUNNING" };
  let prefixBytes = initialJournalBytes({
    cycleId: journal.value.cycleId,
    cyclePlan: journal.value.cyclePlan,
    cyclePlanDigest: journal.value.cyclePlanDigest,
    genesisDigest: journal.value.genesisDigest,
    schemaVersion: journal.value.schemaVersion,
    sessionId: journal.value.sessionId,
  });
  for (const [index, event] of journal.value.events.entries()) {
    if (outcome.kind === "UNKNOWN") outcome = { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" };
    const binding = validateOrchestrationEventBinding(event, retainedEvidenceByEvent[index]);
    if (!binding.ok) outcome = { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" };
    const eventBytes = canonicalBytes(event);
    prefixBytes = concat([prefixBytes, u32(eventBytes.byteLength), eventBytes]);
    const ordinal = Number(event.step.ordinal),
      stepDigest = computeRoutineStepDigest(event.step);
    if (event.phase === "STARTED") {
      pending = event.step;
      steps.set(ordinal, {
        dependentDigests: [],
        ordinal: event.step.ordinal,
        primaryDigest: null,
        state: "STARTED",
        stepDigest,
      });
      if (outcome.kind !== "UNKNOWN") outcome = waitingOutcome(event.step, outputs);
      continue;
    }
    const output = event.output!;
    const continuity = continuityIssues(output, outputs, journal.value);
    if (continuity.length) outcome = { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" };
    if (output.kind === "CYCLE_TERMINAL") {
      const priorJournal = { ...journal.value, events: journal.value.events.slice(0, index) };
      const terminalizing: ReducedState = {
        bindings,
        cycleId: journal.value.cycleId,
        cyclePlanDigest: journal.value.cyclePlanDigest,
        journalPrefixDigest: event.previousPrefixDigest,
        outcome,
        pendingStep: pending,
        schemaVersion: "reduced-state/v1",
        steps: [...steps.values()],
      };
      const terminal = validateCycleReceiptBinding(priorJournal, terminalizing, output.receipt);
      if (!terminal.ok) outcome = { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" };
    }
    const identity = outputIdentity(output);
    steps.set(ordinal, {
      dependentDigests: identity.dependents,
      ordinal: event.step.ordinal,
      primaryDigest: identity.primary,
      state: output.kind === "SKIP" ? "SKIPPED" : "TERMINAL",
      stepDigest,
    });
    pending = null;
    outputs.set(ordinal, output);
    bindings = updateBindings(bindings, output);
    const unknown = outputUnknown(output);
    if (unknown !== null) outcome = { kind: "UNKNOWN", reason: unknown };
    else if (outcome.kind !== "UNKNOWN") {
      if (output.kind === "DISPOSITION")
        outcome = {
          dispositionDigest: computeActionDispositionDigest(output.disposition),
          kind: "WAITING_ACTION",
        };
      else if (output.kind === "CYCLE_TERMINAL") {
        const receipt = output.receipt as ContractRecord;
        outcome = {
          cycleReceiptDigest: computeCycleReceiptDigest(receipt),
          kind: receipt.outcome as "COMPLETED" | "COMPLETED_NO_WORK" | "FAILED_KNOWN",
        };
      } else outcome = { kind: "RUNNING" };
    }
  }
  const result: ReducedState = {
    bindings,
    cycleId: journal.value.cycleId,
    cyclePlanDigest: journal.value.cyclePlanDigest,
    journalPrefixDigest: computeEventJournalPrefixDigest(prefixBytes),
    outcome,
    pendingStep: pending,
    schemaVersion: "reduced-state/v1",
    steps: [...steps.values()],
  };
  const parsed = parseReducedState(result);
  return parsed.ok ? parsed : invalid(...prefixed("reduced", parsed.issues));
}

export function parseJournalContract(schema: string, input: unknown): ParseResult | null {
  if (schema === "orchestration-event/v1") return parseOrchestrationEvent(input);
  if (schema === "event-journal/v1") return parseEventJournal(input);
  if (schema === "reduced-state/v1") return parseReducedState(input);
  return schema === "cycle-receipt/v1" ? parseCycleReceipt(input) : null;
}

import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { computeSessionHealthDigest, parseCyclePlan, parseSessionHealth } from "./cycle-entry.js";
import { dispatchRoles, selectWorkerHostForCapability } from "./dispatch.js";
import {
  computeModuleActionPlanDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
} from "./module-plan.js";
import {
  computeProjectPreflightDigest,
  validateProjectPreflightBinding,
} from "./project-preflight.js";
import { computeReviewRequestDigest, parseReviewRequest } from "./review-request.js";
import { computeRouteSelectionDigest, parseRouteSelection } from "./route-selection.js";
import {
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
  type SnapshotResult,
} from "./runtime.js";

export const dispatchLifecycleSchemaVersions = Object.freeze([
  "dispatch-plan/v1",
  "worker-launch-receipt/v1",
  "worker-terminal-receipt/v1",
] as const);
export const dispatchPlanRefusalReasons = Object.freeze([
  "PRECONDITION_MOVED",
  "RENDERING_REFUSED",
  "CREDENTIALS_REFUSED",
  "RESOURCES_REFUSED",
] as const);
export const dispatchPlanUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "ADMISSION_UNPROVEN",
] as const);
export const workerStartFailureReasons = Object.freeze([
  "ALLOCATION_REFUSED",
  "OWNERSHIP_REFUSED",
  "SPAWN_REFUSED",
  "STARTUP_EXITED",
] as const);
export const workerLaunchUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "IDENTITY_CONFLICT",
  "STARTUP_UNPROVEN",
  "HANDLE_LOST",
] as const);
export const workerTerminalUnknownReasons = Object.freeze([
  "OBSERVATION_UNAVAILABLE",
  "OBSERVATION_INVALID",
  "IDENTITY_CONFLICT",
  "HANDLE_LOST",
  "PROCESS_TREE_UNPROVEN",
  "EXIT_UNPROVEN",
] as const);
export const dispatchLifecycleSchemaFields = Object.freeze({
  plan: Object.freeze([
    "actionPlanDigest",
    "attemptId",
    "outcome",
    "preflightDigest",
    "reviewRequestDigest",
    "routeDigest",
    "schemaVersion",
    "sessionHealthDigest",
  ] as const),
  planned: Object.freeze([
    "credentials",
    "hostRendererArtifactDigest",
    "kind",
    "renderedInput",
    "resourceIntents",
    "workerHostIdentityDigest",
  ] as const),
  launch: Object.freeze([
    "attemptId",
    "dispatchPlanDigest",
    "observedAt",
    "outcome",
    "ownership",
    "processes",
    "resources",
    "schemaVersion",
  ] as const),
  terminal: Object.freeze([
    "attemptId",
    "capture",
    "dispatchPlanDigest",
    "launchReceiptDigest",
    "observedAt",
    "outcome",
    "processes",
    "schemaVersion",
  ] as const),
  kind: Object.freeze(["kind"] as const),
  failure: Object.freeze(["kind", "reason"] as const),
  content: Object.freeze(["byteLength", "contentDigest"] as const),
  references: Object.freeze(["kind", "references"] as const),
  credential: Object.freeze([
    "access",
    "capabilityNames",
    "credentialId",
    "generation",
    "referenceDigest",
    "role",
  ] as const),
  intent: Object.freeze(["owner", "resourceIdentityDigest"] as const),
  allocation: Object.freeze([
    "allocationId",
    "owner",
    "ownerTransactionId",
    "resourceIdentityDigest",
    "state",
  ] as const),
  census: Object.freeze(["completeness", "entries"] as const),
  process: Object.freeze(["parentProcessId", "processId", "state"] as const),
  exit: Object.freeze(["kind", "value"] as const),
  stream: Object.freeze(["content", "kind"] as const),
  capture: Object.freeze(["stderr", "stdout"] as const),
  exited: Object.freeze(["exit", "kind"] as const),
  liveTermination: Object.freeze(["kind", "termination"] as const),
  termination: Object.freeze(["elapsedMilliseconds", "limitMilliseconds"] as const),
});
export const dispatchLifecycleClosedValues = Object.freeze([
  "PLANNED",
  "REFUSED",
  "UNKNOWN",
  "LIVE",
  "START_FAILED",
  "EXITED",
  "TERMINATION_FAILED_LIVE",
  "NONE",
  "REFERENCES",
  "READ_ONLY",
  "PROJECT_MUTATION",
  "ADAPTER",
  "HOST",
  "NOT_ALLOCATED",
  "ALLOCATED",
  "COMPLETE",
  "DEAD",
  "UNPUBLISHED",
  "PUBLISHED",
  "EXIT_CODE",
  "SIGNAL",
  "TRUNCATED",
  "UNAVAILABLE",
  ...dispatchRoles,
  ...dispatchPlanRefusalReasons,
  ...dispatchPlanUnknownReasons,
  ...workerStartFailureReasons,
  ...workerLaunchUnknownReasons,
  ...workerTerminalUnknownReasons,
]);

export type DispatchContentReference = Readonly<{ byteLength: string; contentDigest: string }>;
export type DispatchResourceIntent = Readonly<{
  owner: "ADAPTER" | "HOST";
  resourceIdentityDigest: string;
}>;
export type DispatchAllocationClaim = DispatchResourceIntent &
  Readonly<{
    allocationId: string | null;
    ownerTransactionId: string;
    state: "NOT_ALLOCATED" | "ALLOCATED" | "UNKNOWN";
  }>;
export type DispatchCredentialClaims =
  | Readonly<{ kind: "NONE" }>
  | Readonly<{
      kind: "REFERENCES";
      references: readonly Readonly<{
        access: "READ_ONLY" | "PROJECT_MUTATION";
        capabilityNames: readonly string[];
        credentialId: string;
        generation: string;
        referenceDigest: string;
        role: (typeof dispatchRoles)[number];
      }>[];
    }>;
export type DispatchProcessCensus = Readonly<{
  completeness: "COMPLETE" | "UNKNOWN";
  entries: readonly Readonly<{
    parentProcessId: string | null;
    processId: string;
    state: "LIVE" | "DEAD" | "UNKNOWN";
  }>[];
}>;
export type WorkerExitCause = Readonly<{ kind: "EXIT_CODE" | "SIGNAL"; value: string }>;
export type DispatchStreamCapture =
  | Readonly<{ content: DispatchContentReference; kind: "COMPLETE" | "TRUNCATED" }>
  | Readonly<{ kind: "UNAVAILABLE" }>;
export type DispatchCapture = Readonly<{
  stderr: DispatchStreamCapture;
  stdout: DispatchStreamCapture;
}>;
export type DispatchPlan = Readonly<{
  actionPlanDigest: string;
  attemptId: string;
  preflightDigest: string;
  reviewRequestDigest: string | null;
  routeDigest: string;
  schemaVersion: "dispatch-plan/v1";
  sessionHealthDigest: string;
  outcome:
    | Readonly<{
        credentials: DispatchCredentialClaims;
        hostRendererArtifactDigest: string;
        kind: "PLANNED";
        renderedInput: DispatchContentReference;
        resourceIntents: readonly DispatchResourceIntent[];
        workerHostIdentityDigest: string;
      }>
    | Readonly<{ kind: "REFUSED"; reason: (typeof dispatchPlanRefusalReasons)[number] }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof dispatchPlanUnknownReasons)[number] }>;
}>;
export type WorkerLaunchReceipt = Readonly<{
  attemptId: string;
  dispatchPlanDigest: string;
  observedAt: string | null;
  ownership: "UNPUBLISHED" | "PUBLISHED" | "UNKNOWN";
  processes: DispatchProcessCensus;
  resources: readonly DispatchAllocationClaim[];
  schemaVersion: "worker-launch-receipt/v1";
  outcome:
    | Readonly<{ kind: "LIVE" }>
    | Readonly<{ kind: "START_FAILED"; reason: (typeof workerStartFailureReasons)[number] }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof workerLaunchUnknownReasons)[number] }>;
}>;
export type WorkerTerminalReceipt = Readonly<{
  attemptId: string;
  capture: DispatchCapture;
  dispatchPlanDigest: string;
  launchReceiptDigest: string;
  observedAt: string | null;
  processes: DispatchProcessCensus;
  schemaVersion: "worker-terminal-receipt/v1";
  outcome:
    | Readonly<{ exit: WorkerExitCause; kind: "EXITED" }>
    | Readonly<{ exit: WorkerExitCause | null; kind: "START_FAILED" }>
    | Readonly<{
        kind: "TERMINATION_FAILED_LIVE";
        termination: Readonly<{ elapsedMilliseconds: string; limitMilliseconds: string }>;
      }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof workerTerminalUnknownReasons)[number] }>;
}>;

const fields = dispatchLifecycleSchemaFields;
const invalid = (...issues: readonly string[]) => ({
  ok: false as const,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const prefixed = (prefix: string, issues: readonly string[]) =>
  issues.map((issue) => `${prefix}.${issue}`);
const digest = (value: JsonValue | undefined) => isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined) => isUuidV7(value) && value.length === 36;
const decimal = (value: JsonValue | undefined, minimum: number, maximum: number) =>
  isCanonicalDecimal(value) &&
  !/[^0-9]/.test(value) &&
  Number(value) >= minimum &&
  Number(value) <= maximum;
const member = (value: JsonValue | undefined, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value);
const owner = (value: JsonValue | undefined) => member(value, ["ADAPTER", "HOST"]);
const name = (value: JsonValue | undefined) =>
  typeof value === "string" && /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/.test(value);
function record(input: unknown): ParseResult {
  const detached = snapshotJson(input);
  if (!detached.ok) return detached;
  return detached.value !== null &&
    typeof detached.value === "object" &&
    !Array.isArray(detached.value)
    ? { ok: true, value: detached.value as ContractRecord }
    : invalid("record:object-required");
}
function array(input: unknown, minimum = 0): SnapshotResult<readonly JsonValue[]> {
  const detached = snapshotJson(input);
  if (!detached.ok) return detached;
  return Array.isArray(detached.value) &&
    detached.value.length >= minimum &&
    detached.value.length <= 256
    ? { ok: true, value: detached.value as readonly JsonValue[] }
    : invalid("array:bounds");
}
const resourceKey = (row: DispatchResourceIntent) => `${row.owner}\0${row.resourceIdentityDigest}`;
const root = (census: DispatchProcessCensus) =>
  census.entries.find((row) => row.parentProcessId === null);

export function parseDispatchContentReference(
  input: unknown,
): ParseResult<DispatchContentReference> {
  const parsed = snapshotClosedRecord(input, fields.content);
  if (!parsed.ok) return parsed;
  if (!decimal(parsed.value.byteLength, 0, 1048576) || !digest(parsed.value.contentDigest))
    return invalid("content:invalid");
  return { ok: true, value: parsed.value as DispatchContentReference };
}

/** Native intrinsic getters and a fresh copy avoid caller length/iterator/species hooks. */
function bytes(input: unknown): SnapshotResult<Uint8Array> {
  try {
    if (nodeTypes.isProxy(input) || !nodeTypes.isUint8Array(input))
      return invalid("bytes:required");
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype)
      return invalid("bytes:prototype");
    const intrinsic = Object.getPrototypeOf(Uint8Array.prototype);
    const get = (key: string) => Object.getOwnPropertyDescriptor(intrinsic, key)!.get!.call(input);
    const buffer = get("buffer") as ArrayBuffer;
    const length = get("byteLength") as number;
    const offset = get("byteOffset") as number;
    if (nodeTypes.isSharedArrayBuffer(buffer) || length > 1048576)
      return invalid("bytes:bounds-or-shared");
    const view = new Uint8Array(buffer, offset, length);
    const copy = new Uint8Array(length);
    copy.set(view);
    return { ok: true, value: copy };
  } catch {
    return invalid("bytes:invalid");
  }
}
export function computeDispatchContentReference(input: unknown): DispatchContentReference {
  const parsed = bytes(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return Object.freeze({
    byteLength: String(parsed.value.byteLength),
    contentDigest: createHash("sha256").update(parsed.value).digest("hex"),
  });
}
function byteBinding(reference: DispatchContentReference, input: unknown): boolean {
  const parsed = bytes(input);
  return (
    parsed.ok &&
    reference.byteLength === String(parsed.value.byteLength) &&
    reference.contentDigest === createHash("sha256").update(parsed.value).digest("hex")
  );
}

export function parseDispatchCredentialClaims(
  input: unknown,
): ParseResult<DispatchCredentialClaims> {
  const parsed = record(input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (row.kind === "NONE")
    return closedRecord(row, fields.kind).length
      ? invalid("credentials:fields")
      : { ok: true, value: row as DispatchCredentialClaims };
  if (row.kind !== "REFERENCES" || closedRecord(row, fields.references).length)
    return invalid("credentials:fields-or-kind");
  const references = array(row.references, 1);
  if (!references.ok) return references;
  let previous = "";
  for (const value of references.value) {
    const reference = snapshotClosedRecord(value, fields.credential);
    if (!reference.ok) return reference;
    const item = reference.value;
    if (
      !member(item.access, ["READ_ONLY", "PROJECT_MUTATION"]) ||
      !member(item.role, dispatchRoles) ||
      (item.access === "PROJECT_MUTATION" && item.role !== "implementation") ||
      !uuid(item.credentialId) ||
      !decimal(item.generation, 0, Number.MAX_SAFE_INTEGER) ||
      !digest(item.referenceDigest)
    )
      return invalid("credential:invalid");
    const capabilities = array(item.capabilityNames, 1);
    if (!capabilities.ok) return capabilities;
    let priorName = "";
    for (const capability of capabilities.value) {
      if (!name(capability) || typeof capability !== "string" || capability <= priorName)
        return invalid("capabilityNames:invalid-order");
      priorName = capability;
    }
    const key = String(item.credentialId);
    if (key <= previous) return invalid("credentials:order");
    previous = key;
  }
  return { ok: true, value: row as DispatchCredentialClaims };
}
function resources(
  input: unknown,
  allocated: boolean,
): SnapshotResult<readonly (DispatchResourceIntent | DispatchAllocationClaim)[]> {
  const parsed = array(input);
  if (!parsed.ok) return parsed;
  let previous = "";
  const ids = new Set<string>();
  for (const value of parsed.value) {
    const parsedRow = snapshotClosedRecord(value, allocated ? fields.allocation : fields.intent);
    if (!parsedRow.ok) return parsedRow;
    const row = parsedRow.value;
    if (!owner(row.owner) || !digest(row.resourceIdentityDigest))
      return invalid("resource:identity");
    const key = resourceKey(row as DispatchResourceIntent);
    if (key <= previous) return invalid("resources:order");
    previous = key;
    if (allocated) {
      if (
        !uuid(row.ownerTransactionId) ||
        !member(row.state, ["NOT_ALLOCATED", "ALLOCATED", "UNKNOWN"])
      )
        return invalid("allocation:invalid");
      if (
        row.state === "NOT_ALLOCATED"
          ? row.allocationId !== null
          : row.state === "ALLOCATED"
            ? !uuid(row.allocationId)
            : row.allocationId !== null && !uuid(row.allocationId)
      )
        return invalid("allocationId:invalid");
      if (row.allocationId !== null) {
        const id = String(row.allocationId);
        if (ids.has(id)) return invalid("allocationId:duplicate");
        ids.add(id);
      }
    }
  }
  return {
    ok: true,
    value: parsed.value as readonly (DispatchResourceIntent | DispatchAllocationClaim)[],
  };
}
export function parseDispatchResourceIntents(
  input: unknown,
): SnapshotResult<readonly DispatchResourceIntent[]> {
  return resources(input, false);
}
export function parseDispatchAllocationClaims(
  input: unknown,
): SnapshotResult<readonly DispatchAllocationClaim[]> {
  return resources(input, true) as SnapshotResult<readonly DispatchAllocationClaim[]>;
}
export function parseDispatchProcessCensus(input: unknown): ParseResult<DispatchProcessCensus> {
  const parsed = snapshotClosedRecord(input, fields.census);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (!member(row.completeness, ["COMPLETE", "UNKNOWN"])) return invalid("completeness:invalid");
  const entries = array(row.entries);
  if (!entries.ok) return entries;
  const parents = new Map<string, string | null>();
  let previous = "";
  let roots = 0;
  for (const value of entries.value) {
    const process = snapshotClosedRecord(value, fields.process);
    if (!process.ok) return process;
    const item = process.value;
    if (
      !uuid(item.processId) ||
      (item.parentProcessId !== null && !uuid(item.parentProcessId)) ||
      !member(item.state, ["LIVE", "DEAD", "UNKNOWN"]) ||
      (row.completeness === "COMPLETE" && item.state === "UNKNOWN")
    )
      return invalid("process:invalid");
    const id = String(item.processId);
    if (id <= previous) return invalid("processes:order");
    previous = id;
    if (item.parentProcessId === null) roots += 1;
    parents.set(id, item.parentProcessId as string | null);
  }
  if (parents.size && roots !== 1) return invalid("processes:root-count");
  for (const id of parents.keys()) {
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null) {
      if (!parents.has(cursor) || seen.has(cursor)) return invalid("processes:parent-or-cycle");
      seen.add(cursor);
      cursor = parents.get(cursor)!;
    }
  }
  return { ok: true, value: row as DispatchProcessCensus };
}
export function parseWorkerExitCause(input: unknown): ParseResult<WorkerExitCause> {
  const parsed = snapshotClosedRecord(input, fields.exit);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  const valid =
    row.kind === "EXIT_CODE"
      ? decimal(row.value, 0, 4294967295)
      : row.kind === "SIGNAL" &&
        typeof row.value === "string" &&
        /^SIG[A-Z0-9]{1,16}(?![\s\S])/.test(row.value);
  return valid ? { ok: true, value: row as WorkerExitCause } : invalid("exit:invalid");
}
export function parseDispatchStreamCapture(input: unknown): ParseResult<DispatchStreamCapture> {
  const parsed = record(input);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (row.kind === "UNAVAILABLE")
    return closedRecord(row, fields.kind).length
      ? invalid("capture:fields")
      : { ok: true, value: row as DispatchStreamCapture };
  if (!member(row.kind, ["COMPLETE", "TRUNCATED"]) || closedRecord(row, fields.stream).length)
    return invalid("capture:fields-or-kind");
  const content = parseDispatchContentReference(row.content);
  return content.ok ? { ok: true, value: row as DispatchStreamCapture } : content;
}
export function parseDispatchCapture(input: unknown): ParseResult<DispatchCapture> {
  const parsed = snapshotClosedRecord(input, fields.capture);
  if (!parsed.ok) return parsed;
  for (const key of fields.capture) {
    const stream = parseDispatchStreamCapture(parsed.value[key]);
    if (!stream.ok) return invalid(...prefixed(key, stream.issues));
  }
  return { ok: true, value: parsed.value as DispatchCapture };
}

/** Preparation structure only; NONE and resource intents require actual owner admission. */
export function parseDispatchPlan(input: unknown): ParseResult<DispatchPlan> {
  const parsed = snapshotClosedRecord(input, fields.plan);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (row.schemaVersion !== "dispatch-plan/v1" || !uuid(row.attemptId))
    return invalid("plan:schema-or-attempt");
  for (const key of [
    "actionPlanDigest",
    "preflightDigest",
    "routeDigest",
    "sessionHealthDigest",
  ] as const)
    if (!digest(row[key])) return invalid(`${key}:invalid`);
  if (row.reviewRequestDigest !== null && !digest(row.reviewRequestDigest))
    return invalid("reviewRequestDigest:invalid");
  const outcome = record(row.outcome);
  if (!outcome.ok) return outcome;
  const cell = outcome.value;
  if (cell.kind === "PLANNED") {
    if (
      closedRecord(cell, fields.planned).length ||
      !digest(cell.hostRendererArtifactDigest) ||
      !digest(cell.workerHostIdentityDigest)
    )
      return invalid("outcome:planned-fields");
    const credentials = parseDispatchCredentialClaims(cell.credentials);
    if (!credentials.ok) return invalid(...prefixed("credentials", credentials.issues));
    const intents = parseDispatchResourceIntents(cell.resourceIntents);
    if (!intents.ok) return invalid(...prefixed("resourceIntents", intents.issues));
    const content = parseDispatchContentReference(cell.renderedInput);
    if (!content.ok) return invalid(...prefixed("renderedInput", content.issues));
    if (content.value.byteLength === "0") return invalid("renderedInput:empty");
  } else if (cell.kind === "REFUSED" || cell.kind === "UNKNOWN") {
    if (
      closedRecord(cell, fields.failure).length ||
      !member(
        cell.reason,
        cell.kind === "REFUSED" ? dispatchPlanRefusalReasons : dispatchPlanUnknownReasons,
      )
    )
      return invalid("outcome:failure-fields");
  } else return invalid("outcome.kind:invalid");
  return { ok: true, value: row as DispatchPlan };
}

/** Includes the local start-failure matrix, but cannot prove child absence or ownership. */
export function parseWorkerLaunchReceipt(input: unknown): ParseResult<WorkerLaunchReceipt> {
  const parsed = snapshotClosedRecord(input, fields.launch);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (
    row.schemaVersion !== "worker-launch-receipt/v1" ||
    !uuid(row.attemptId) ||
    !digest(row.dispatchPlanDigest) ||
    !member(row.ownership, ["UNPUBLISHED", "PUBLISHED", "UNKNOWN"])
  )
    return invalid("launch:invalid");
  const outcome = record(row.outcome);
  if (!outcome.ok) return outcome;
  const cell = outcome.value;
  if (cell.kind === "LIVE") {
    if (closedRecord(cell, fields.kind).length) return invalid("outcome:fields");
  } else if (cell.kind === "START_FAILED" || cell.kind === "UNKNOWN") {
    if (
      closedRecord(cell, fields.failure).length ||
      !member(
        cell.reason,
        cell.kind === "START_FAILED" ? workerStartFailureReasons : workerLaunchUnknownReasons,
      )
    )
      return invalid("outcome:failure-fields");
  } else return invalid("outcome.kind:invalid");
  if (
    !(cell.kind === "UNKNOWN" && row.observedAt === null) &&
    !isCanonicalTimestamp(row.observedAt)
  )
    return invalid("observedAt:invalid");
  const processes = parseDispatchProcessCensus(row.processes);
  if (!processes.ok) return invalid(...prefixed("processes", processes.issues));
  const allocations = parseDispatchAllocationClaims(row.resources);
  if (!allocations.ok) return invalid(...prefixed("resources", allocations.issues));
  const census = processes.value;
  const allAllocated = allocations.value.every((item) => item.state === "ALLOCATED");
  if (cell.kind === "LIVE") {
    if (
      row.ownership !== "PUBLISHED" ||
      !allAllocated ||
      census.completeness !== "COMPLETE" ||
      root(census)?.state !== "LIVE"
    )
      return invalid("outcome:live-matrix");
  } else if (cell.kind === "START_FAILED") {
    if (census.completeness !== "COMPLETE" || census.entries.some((item) => item.state !== "DEAD"))
      return invalid("outcome:start-failed-processes");
    if (cell.reason === "STARTUP_EXITED") {
      if (!census.entries.length || row.ownership !== "PUBLISHED" || !allAllocated)
        return invalid("outcome:startup-exited-matrix");
    } else {
      if (census.entries.length) return invalid("outcome:no-child-required");
      if (cell.reason === "ALLOCATION_REFUSED") {
        const first = allocations.value.findIndex((item) => item.state === "NOT_ALLOCATED");
        if (
          row.ownership !== "UNPUBLISHED" ||
          first < 0 ||
          allocations.value.slice(0, first).some((item) => item.state !== "ALLOCATED") ||
          allocations.value.slice(first).some((item) => item.state !== "NOT_ALLOCATED")
        )
          return invalid("outcome:allocation-prefix");
      } else if (
        !allAllocated ||
        row.ownership !== (cell.reason === "OWNERSHIP_REFUSED" ? "UNPUBLISHED" : "PUBLISHED")
      )
        return invalid("outcome:start-failed-ownership");
    }
  }
  return { ok: true, value: row as WorkerLaunchReceipt };
}

/** A completed observation is not necessarily worker death; live/unknown retains capacity. */
export function parseWorkerTerminalReceipt(input: unknown): ParseResult<WorkerTerminalReceipt> {
  const parsed = snapshotClosedRecord(input, fields.terminal);
  if (!parsed.ok) return parsed;
  const row = parsed.value;
  if (
    row.schemaVersion !== "worker-terminal-receipt/v1" ||
    !uuid(row.attemptId) ||
    !digest(row.dispatchPlanDigest) ||
    !digest(row.launchReceiptDigest)
  )
    return invalid("terminal:invalid");
  const outcome = record(row.outcome);
  if (!outcome.ok) return outcome;
  const cell = outcome.value;
  if (cell.kind === "EXITED" || cell.kind === "START_FAILED") {
    if (closedRecord(cell, fields.exited).length) return invalid("outcome:fields");
    if (cell.kind !== "START_FAILED" || cell.exit !== null) {
      const exit = parseWorkerExitCause(cell.exit);
      if (!exit.ok) return exit;
    }
  } else if (cell.kind === "TERMINATION_FAILED_LIVE") {
    if (closedRecord(cell, fields.liveTermination).length) return invalid("outcome:fields");
    const termination = snapshotClosedRecord(cell.termination, fields.termination);
    if (!termination.ok) return termination;
    const timing = termination.value;
    if (
      !decimal(timing.elapsedMilliseconds, 1, 86400000) ||
      !decimal(timing.limitMilliseconds, 1, 60000) ||
      Number(timing.elapsedMilliseconds) < Number(timing.limitMilliseconds)
    )
      return invalid("termination:bounds");
  } else if (cell.kind === "UNKNOWN") {
    if (
      closedRecord(cell, fields.failure).length ||
      !member(cell.reason, workerTerminalUnknownReasons)
    )
      return invalid("outcome:failure-fields");
  } else return invalid("outcome.kind:invalid");
  if (
    !(cell.kind === "UNKNOWN" && row.observedAt === null) &&
    !isCanonicalTimestamp(row.observedAt)
  )
    return invalid("observedAt:invalid");
  const capture = parseDispatchCapture(row.capture);
  if (!capture.ok) return capture;
  const processes = parseDispatchProcessCensus(row.processes);
  if (!processes.ok) return processes;
  const census = processes.value;
  if (cell.kind !== "UNKNOWN") {
    if (census.completeness !== "COMPLETE") return invalid("processes:complete-required");
    if (cell.kind === "TERMINATION_FAILED_LIVE") {
      if (!census.entries.some((item) => item.state === "LIVE"))
        return invalid("processes:live-required");
    } else {
      if (census.entries.some((item) => item.state !== "DEAD"))
        return invalid("processes:dead-required");
      if (cell.kind === "EXITED" && !census.entries.length)
        return invalid("processes:empty-exited");
      if (cell.kind === "START_FAILED") {
        if ((cell.exit === null) !== (census.entries.length === 0))
          return invalid("exit:start-failure-mismatch");
        if (
          !census.entries.length &&
          (capture.value.stdout.kind !== "UNAVAILABLE" ||
            capture.value.stderr.kind !== "UNAVAILABLE")
        )
          return invalid("capture:no-child");
      }
    }
  }
  return { ok: true, value: row as WorkerTerminalReceipt };
}

export function parseDispatchLifecycleContract(
  schema: string,
  input: unknown,
): ParseResult<DispatchPlan | WorkerLaunchReceipt | WorkerTerminalReceipt> | null {
  if (schema === "dispatch-plan/v1") return parseDispatchPlan(input);
  if (schema === "worker-launch-receipt/v1") return parseWorkerLaunchReceipt(input);
  if (schema === "worker-terminal-receipt/v1") return parseWorkerTerminalReceipt(input);
  return null;
}
function lifecycleDigest(schema: string, input: unknown): string {
  const parsed = parseDispatchLifecycleContract(schema, input);
  if (!parsed?.ok) throw new TypeError(parsed?.issues.join(",") ?? "schemaVersion:unsupported");
  return framedDigest(schema, [frame.canonical(parsed.value)]);
}
export const computeDispatchPlanDigest = (input: unknown): string =>
  lifecycleDigest("dispatch-plan/v1", input);
export const computeWorkerLaunchReceiptDigest = (input: unknown): string =>
  lifecycleDigest("worker-launch-receipt/v1", input);
export const computeWorkerTerminalReceiptDigest = (input: unknown): string =>
  lifecycleDigest("worker-terminal-receipt/v1", input);

/** Eleven actual supplied inputs; no registry, lease, source, credential or process admission. */
export function validateDispatchPlanBinding(
  moduleInput: unknown,
  actionPlanInput: unknown,
  mappingInput: unknown,
  routeInput: unknown,
  observationInput: unknown,
  preflightInput: unknown,
  cyclePlanInput: unknown,
  healthInput: unknown,
  reviewRequestOrNull: unknown,
  renderedInputBytesOrNull: unknown,
  planInput: unknown,
): ParseResult<DispatchPlan> {
  const input = parseModulePlanInput(moduleInput);
  if (!input.ok) return invalid(...prefixed("moduleInput", input.issues));
  const action = parseModuleActionPlan(actionPlanInput);
  if (!action.ok) return invalid(...prefixed("actionPlan", action.issues));
  const preflight = validateProjectPreflightBinding(
    input.value,
    action.value,
    mappingInput,
    routeInput,
    observationInput,
    preflightInput,
  );
  if (!preflight.ok) return invalid(...prefixed("preflight", preflight.issues));
  const route = parseRouteSelection(routeInput);
  if (!route.ok) return route;
  if (preflight.value.outcome.kind !== "ELIGIBLE" || route.value.outcome.kind !== "SELECTED")
    return invalid("preparation:not-applicable");
  const cycle = parseCyclePlan(cyclePlanInput);
  if (!cycle.ok) return invalid(...prefixed("cyclePlan", cycle.issues));
  if (canonicalJson(cycle.value.request) !== canonicalJson(input.value.cycleRequest))
    return invalid("cyclePlan.request:mismatch");
  const health = parseSessionHealth(healthInput);
  if (!health.ok) return invalid(...prefixed("health", health.issues));
  const sessionId = input.value.cycleRequest.sessionRequest.sessionId;
  if (
    health.value.outcome !== "HEALTHY" ||
    health.value.step !== null ||
    health.value.targetSessionId !== sessionId ||
    health.value.holderSessionId !== sessionId
  )
    return invalid("health:inspection-mismatch");
  const plan = parseDispatchPlan(planInput);
  if (!plan.ok) return plan;
  const row = plan.value;
  if (
    row.actionPlanDigest !== computeModuleActionPlanDigest(action.value) ||
    row.preflightDigest !== computeProjectPreflightDigest(preflight.value) ||
    row.routeDigest !== computeRouteSelectionDigest(route.value) ||
    row.sessionHealthDigest !== computeSessionHealthDigest(health.value)
  )
    return invalid("plan:reference-mismatch");
  const role = action.value.actionCore.requestedRole;
  if (role === "review") {
    const request = parseReviewRequest(reviewRequestOrNull);
    if (!request.ok) return invalid(...prefixed("reviewRequest", request.issues));
    const target = input.value.reviewSubject;
    if (
      !target ||
      request.value.reviewCycleId !== input.value.cycleRequest.cycleId ||
      canonicalJson(request.value.packet.brief) !== canonicalJson(action.value.dispatchBrief) ||
      canonicalJson(request.value.packet.subject) !== canonicalJson(target) ||
      (target.schemaVersion === "worker-result-subject/v1" &&
        row.attemptId === target.authorAttemptId) ||
      row.reviewRequestDigest !== computeReviewRequestDigest(request.value)
    )
      return invalid("reviewRequest:binding-mismatch");
  } else if (reviewRequestOrNull !== null || row.reviewRequestDigest !== null)
    return invalid("reviewRequest:null-required");
  if (row.outcome.kind !== "PLANNED")
    return renderedInputBytesOrNull === null ? plan : invalid("renderedInput:null-required");
  const prepared = row.outcome;
  const selected = selectWorkerHostForCapability(
    mappingInput,
    route.value.outcome.workerHostIdentityDigest,
    action.value.actionCore.capabilityName,
  );
  if (!selected.ok) return invalid(...prefixed("selected", selected.issues));
  if (
    prepared.workerHostIdentityDigest !== selected.value.workerHostIdentityDigest ||
    prepared.hostRendererArtifactDigest !== selected.value.hostRendererArtifactDigest
  )
    return invalid("host:binding-mismatch");
  if (
    prepared.credentials.kind === "REFERENCES" &&
    prepared.credentials.references.some((reference) => reference.role !== role)
  )
    return invalid("credentials:role-mismatch");
  return byteBinding(prepared.renderedInput, renderedInputBytesOrNull)
    ? plan
    : invalid("renderedInput:bytes-mismatch");
}

/** Allocation and launch claims are bound to the plan, never proof of their issuance. */
export function validateWorkerLaunchReceiptBinding(
  planInput: unknown,
  launchInput: unknown,
): ParseResult<WorkerLaunchReceipt> {
  const plan = parseDispatchPlan(planInput);
  if (!plan.ok) return invalid(...prefixed("plan", plan.issues));
  if (plan.value.outcome.kind !== "PLANNED") return invalid("plan:planned-required");
  const launch = parseWorkerLaunchReceipt(launchInput);
  if (!launch.ok) return launch;
  if (
    launch.value.dispatchPlanDigest !== computeDispatchPlanDigest(plan.value) ||
    launch.value.attemptId !== plan.value.attemptId
  )
    return invalid("launch:plan-mismatch");
  const intents = plan.value.outcome.resourceIntents;
  if (
    launch.value.resources.length !== intents.length ||
    launch.value.resources.some(
      (row, index) =>
        resourceKey(row) !== resourceKey(intents[index]!) ||
        row.ownerTransactionId !== plan.value.attemptId,
    )
  )
    return invalid("resources:intent-or-transaction-mismatch");
  return launch;
}

/** Captures and process-census continuity only; no death, history, recovery or reclaim authority. */
export function validateWorkerTerminalReceiptBinding(
  planInput: unknown,
  launchInput: unknown,
  stdoutBytesOrNull: unknown,
  stderrBytesOrNull: unknown,
  terminalInput: unknown,
): ParseResult<WorkerTerminalReceipt> {
  const launch = validateWorkerLaunchReceiptBinding(planInput, launchInput);
  if (!launch.ok) return invalid(...prefixed("launch", launch.issues));
  const terminal = parseWorkerTerminalReceipt(terminalInput);
  if (!terminal.ok) return terminal;
  const row = terminal.value;
  const prior = launch.value;
  if (
    row.attemptId !== prior.attemptId ||
    row.dispatchPlanDigest !== prior.dispatchPlanDigest ||
    row.launchReceiptDigest !== computeWorkerLaunchReceiptDigest(prior)
  )
    return invalid("terminal:launch-mismatch");
  const cell = row.outcome;
  if (cell.kind === "START_FAILED") {
    if (
      prior.outcome.kind !== "START_FAILED" ||
      canonicalJson(row.processes) !== canonicalJson(prior.processes) ||
      (cell.exit === null) !== (prior.outcome.reason !== "STARTUP_EXITED")
    )
      return invalid("outcome:start-failure-mismatch");
  } else if (cell.kind !== "UNKNOWN" && prior.outcome.kind !== "LIVE")
    return invalid("outcome:live-launch-required");
  if (
    cell.kind !== "UNKNOWN" &&
    prior.observedAt !== null &&
    row.observedAt !== null &&
    row.observedAt < prior.observedAt
  )
    return invalid("observedAt:before-launch");
  const entries = new Map(row.processes.entries.map((item) => [item.processId, item]));
  for (const item of prior.processes.entries) {
    const retained = entries.get(item.processId);
    if (
      !retained ||
      retained.parentProcessId !== item.parentProcessId ||
      (item.state === "DEAD" && retained.state === "LIVE")
    )
      return invalid("processes:lost-or-reversed");
  }
  const oldRoot = root(prior.processes);
  const newRoot = root(row.processes);
  if (oldRoot ? newRoot?.processId !== oldRoot.processId : newRoot && cell.kind !== "UNKNOWN")
    return invalid("processes:root-mismatch");
  for (const [key, supplied] of [
    ["stdout", stdoutBytesOrNull],
    ["stderr", stderrBytesOrNull],
  ] as const) {
    const capture = row.capture[key];
    if (
      capture.kind === "UNAVAILABLE" ? supplied !== null : !byteBinding(capture.content, supplied)
    )
      return invalid(`${key}:capture-mismatch`);
  }
  return terminal;
}

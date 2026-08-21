import {
  frame,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";
import {
  computePointerPositionDigest,
  computePointerValueDigest,
  type PointerKind,
} from "./pointer.js";

export type CleanupLifecycle = "PENDING" | "ACTIVATING" | "ABORTING" | "COMPLETE";
export type CleanupPublication = "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "CLEARED";
export type CleanupHeadWriteDisposition = "APPEND" | "NO_APPEND" | "REFUSED";
export type DestinationOwnerLifecycle = "ACTIVE" | "CONSUMED" | "RETIRED";
export type DestinationOwnerTransition =
  "ACTIVATE_GENESIS" | "CONSUME" | "RETIRE_UNUSED" | "RETIRE_CONSUMED" | "ACTIVATE_SUCCESSOR";
export type RecoveryAttemptReservationLifecycle =
  "RESERVED" | "CONSUMED" | "TERMINAL" | "TOMBSTONE";
export type RecoveryAuthorizationLifecycle = "CREATED" | "CONSUMED" | "REVOKED";

const cleanupGateRootFields = Object.freeze([
  "authorizationCoreDigest",
  "authorizationCreatedReceiptDigest",
  "authorizationCreatedTipDigest",
  "authorizationCreatedValueDigest",
  "candidateActiveReleaseValueDigest",
  "cleanupArchivePredecessorReceiptDigest",
  "cleanupArchivePredecessorTipDigest",
  "cleanupArchivePredecessorValueDigest",
  "createdAt",
  "installationId",
  "mode",
  "predecessorActiveReleaseReceiptDigest",
  "predecessorActiveReleaseTipDigest",
  "predecessorActiveReleaseValueDigest",
  "projectId",
  "recoveryFenceRootDigest",
  "schemaVersion",
  "stateRootDigest",
  "successorCoreDigest",
  "transactionId",
] as const);
const cleanupGateHeadFields = Object.freeze([
  "lifecycle",
  "ordinal",
  "priorHeadValueDigest",
  "publication",
  "recordedAt",
  "rootDigest",
  "schemaVersion",
] as const);
const recoveryFenceRootFields = Object.freeze([
  "candidateActiveReleaseValueDigest",
  "candidateBrokerAdmissionDigest",
  "cleanupArchivePredecessorReceiptDigest",
  "cleanupArchivePredecessorTipDigest",
  "cleanupArchivePredecessorValueDigest",
  "createdAt",
  "installationId",
  "predecessorActiveReleaseReceiptDigest",
  "predecessorActiveReleaseTipDigest",
  "predecessorActiveReleaseValueDigest",
  "predecessorBrokerGeneration",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
  "successorBrokerGeneration",
  "successorCoreDigest",
  "transactionId",
] as const);
const recoveryFenceHeadFields = Object.freeze([
  "ordinal",
  "priorHeadValueDigest",
  "recordedAt",
  "rootDigest",
  "schemaVersion",
  "state",
] as const);
const valuePositionFields = Object.freeze(["mode", "parts"] as const);
const valuePositionPartFields = Object.freeze(["ordinal", "rootDigest"] as const);

export const gateFenceSchemaFields = Object.freeze({
  cleanupGateRoot: cleanupGateRootFields,
  cleanupGateHead: cleanupGateHeadFields,
  recoveryFenceRoot: recoveryFenceRootFields,
  recoveryFenceHead: recoveryFenceHeadFields,
});
export const gateFenceSchemaVersions = Object.freeze([
  "activation-cleanup-gate-head/v1",
  "activation-cleanup-gate-root/v1",
  "activation-recovery-fence-head/v1",
  "activation-recovery-fence-root/v1",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, names: readonly string[]): string[] {
  return names.filter((name) => !isSha256(record[name])).map((name) => `${name}:invalid`);
}

function nullableDigestIssues(record: ContractRecord, names: readonly string[]): string[] {
  return names
    .filter((name) => record[name] !== null && !isSha256(record[name]))
    .map((name) => `${name}:invalid`);
}

function nonNullCount(record: ContractRecord, names: readonly string[]): number {
  return names.filter((name) => record[name] !== null).length;
}

const cleanupArchivePredecessorFields = Object.freeze([
  "cleanupArchivePredecessorReceiptDigest",
  "cleanupArchivePredecessorTipDigest",
  "cleanupArchivePredecessorValueDigest",
] as const);
const predecessorActiveReleaseFields = Object.freeze([
  "predecessorActiveReleaseReceiptDigest",
  "predecessorActiveReleaseTipDigest",
  "predecessorActiveReleaseValueDigest",
] as const);

export function parseCleanupGateRoot(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, cleanupGateRootFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [
    ...digestIssues(record, [
      "authorizationCoreDigest",
      "authorizationCreatedReceiptDigest",
      "authorizationCreatedTipDigest",
      "authorizationCreatedValueDigest",
      "candidateActiveReleaseValueDigest",
      "stateRootDigest",
      "successorCoreDigest",
    ]),
    ...nullableDigestIssues(record, [
      ...cleanupArchivePredecessorFields,
      ...predecessorActiveReleaseFields,
      "recoveryFenceRootDigest",
    ]),
  ];
  if (record.schemaVersion !== "activation-cleanup-gate-root/v1")
    issues.push("schemaVersion:mismatch");
  for (const name of ["installationId", "projectId", "transactionId"] as const)
    if (!isUuidV7(record[name])) issues.push(`${name}:invalid`);
  if (!isCanonicalTimestamp(record.createdAt)) issues.push("createdAt:invalid");

  const archiveCount = nonNullCount(record, cleanupArchivePredecessorFields);
  const predecessorCount = nonNullCount(record, predecessorActiveReleaseFields);
  if (archiveCount !== 0 && archiveCount !== cleanupArchivePredecessorFields.length)
    issues.push("cleanupArchivePredecessorTriple:partial");
  if (predecessorCount !== 0 && predecessorCount !== predecessorActiveReleaseFields.length)
    issues.push("predecessorActiveReleaseTriple:partial");
  if (record.mode === "BOOTSTRAP") {
    if (predecessorCount !== 0) issues.push("mode:bootstrap-predecessor-forbidden");
    if (record.recoveryFenceRootDigest !== null) issues.push("mode:bootstrap-fence-forbidden");
  } else if (record.mode === "SUCCESSOR") {
    if (archiveCount !== cleanupArchivePredecessorFields.length)
      issues.push("mode:successor-archive-required");
    if (predecessorCount !== predecessorActiveReleaseFields.length)
      issues.push("mode:successor-predecessor-required");
    if (!isSha256(record.recoveryFenceRootDigest)) issues.push("mode:successor-fence-required");
  } else issues.push("mode:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseCleanupGateHead(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, cleanupGateHeadFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [
    ...digestIssues(record, ["rootDigest"]),
    ...nullableDigestIssues(record, ["priorHeadValueDigest"]),
  ];
  if (record.schemaVersion !== "activation-cleanup-gate-head/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalDecimal(record.ordinal)) issues.push("ordinal:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (!isCleanupLifecyclePublicationPair(record.lifecycle, record.publication))
    issues.push("lifecyclePublication:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseRecoveryFenceRoot(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, recoveryFenceRootFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = digestIssues(record, [
    "candidateActiveReleaseValueDigest",
    "candidateBrokerAdmissionDigest",
    ...cleanupArchivePredecessorFields,
    ...predecessorActiveReleaseFields,
    "stateRootDigest",
    "successorCoreDigest",
  ]);
  if (record.schemaVersion !== "activation-recovery-fence-root/v1")
    issues.push("schemaVersion:mismatch");
  for (const name of ["installationId", "projectId", "transactionId"] as const)
    if (!isUuidV7(record[name])) issues.push(`${name}:invalid`);
  if (!isCanonicalTimestamp(record.createdAt)) issues.push("createdAt:invalid");
  for (const name of ["predecessorBrokerGeneration", "successorBrokerGeneration"] as const)
    if (!isCanonicalDecimal(record[name])) issues.push(`${name}:invalid`);
  if (
    isCanonicalDecimal(record.predecessorBrokerGeneration) &&
    isCanonicalDecimal(record.successorBrokerGeneration)
  ) {
    try {
      if (
        incrementCanonicalDecimal(String(record.predecessorBrokerGeneration)) !==
        record.successorBrokerGeneration
      )
        issues.push("brokerGeneration:not-successor");
    } catch {
      issues.push("brokerGeneration:not-successor");
    }
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseRecoveryFenceHead(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, recoveryFenceHeadFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [
    ...digestIssues(record, ["rootDigest"]),
    ...nullableDigestIssues(record, ["priorHeadValueDigest"]),
  ];
  if (record.schemaVersion !== "activation-recovery-fence-head/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalDecimal(record.ordinal)) issues.push("ordinal:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (record.state !== "PREPARED" && record.state !== "POST_ACTIVATION")
    issues.push("state:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parseValuePosition(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, valuePositionFields);
  if (!parsed.ok) return parsed;
  const parts = snapshotClosedRecord(parsed.value.parts, valuePositionPartFields);
  if (!parts.ok) return invalid(...parts.issues.map((issue) => `parts.${issue}`));
  const issues: string[] = [];
  if (parsed.value.mode !== "VALUE") issues.push("mode:invalid");
  if (!isCanonicalDecimal(parts.value.ordinal)) issues.push("parts.ordinal:invalid");
  if (!isSha256(parts.value.rootDigest)) issues.push("parts.rootDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseCleanupGateValuePosition(input: unknown): ParseResult {
  return parseValuePosition(input);
}

export function parseRecoveryFenceValuePosition(input: unknown): ParseResult {
  return parseValuePosition(input);
}

export function computeCleanupGateRootDigest(input: unknown): string {
  const parsed = parseCleanupGateRoot(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("activation-cleanup-gate-root/v1", [frame.canonical(parsed.value)]);
}

export function computeRecoveryFenceRootDigest(input: unknown): string {
  const parsed = parseRecoveryFenceRoot(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("activation-recovery-fence-root/v1", [frame.canonical(parsed.value)]);
}

function computeValuePositionDigest(kind: PointerKind, input: unknown): string {
  const parsed = parseValuePosition(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return computePointerPositionDigest(kind, parsed.value);
}

export function computeCleanupGateValuePositionDigest(input: unknown): string {
  return computeValuePositionDigest("ACTIVATION_CLEANUP_GATE", input);
}

export function computeRecoveryFenceValuePositionDigest(input: unknown): string {
  return computeValuePositionDigest("ACTIVATION_RECOVERY_FENCE", input);
}

export function parseGateFenceContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | null {
  switch (expectedSchemaVersion) {
    case "activation-cleanup-gate-root/v1":
      return parseCleanupGateRoot(input);
    case "activation-cleanup-gate-head/v1":
      return parseCleanupGateHead(input);
    case "activation-recovery-fence-root/v1":
      return parseRecoveryFenceRoot(input);
    case "activation-recovery-fence-head/v1":
      return parseRecoveryFenceHead(input);
    default:
      return null;
  }
}

export const destinationOwnerLifecycles = Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"] as const);
export const destinationOwnerTransitions = Object.freeze([
  Object.freeze({ previous: null, next: "ACTIVE", transition: "ACTIVATE_GENESIS" }),
  Object.freeze({ previous: "ACTIVE", next: "CONSUMED", transition: "CONSUME" }),
  Object.freeze({ previous: "ACTIVE", next: "RETIRED", transition: "RETIRE_UNUSED" }),
  Object.freeze({ previous: "CONSUMED", next: "RETIRED", transition: "RETIRE_CONSUMED" }),
  Object.freeze({ previous: "RETIRED", next: "ACTIVE", transition: "ACTIVATE_SUCCESSOR" }),
] as const);
export const recoveryAttemptReservationLifecycles = Object.freeze([
  "RESERVED",
  "CONSUMED",
  "TERMINAL",
  "TOMBSTONE",
] as const);
export const recoveryAuthorizationLifecycles = Object.freeze([
  "CREATED",
  "CONSUMED",
  "REVOKED",
] as const);

export function validateDestinationOwnerTransition(
  previous: unknown,
  next: unknown,
  transition: unknown,
): boolean {
  return destinationOwnerTransitions.some(
    (edge) => edge.previous === previous && edge.next === next && edge.transition === transition,
  );
}

export function validateRecoveryAttemptReservationTransition(
  previous: unknown,
  next: unknown,
): boolean {
  return (
    (previous === "RESERVED" && next === "CONSUMED") ||
    (previous === "CONSUMED" && next === "TERMINAL") ||
    (previous === "TERMINAL" && next === "TOMBSTONE")
  );
}

const cleanupPairs = Object.freeze({
  PENDING: Object.freeze(["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED"] as const),
  ACTIVATING: Object.freeze(["PUBLISHED"] as const),
  ABORTING: Object.freeze(["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"] as const),
  COMPLETE: Object.freeze(["NOT_PUBLISHED", "CLEARED"] as const),
}) satisfies Readonly<Record<CleanupLifecycle, readonly CleanupPublication[]>>;
const cleanupTransitions = new Set([
  "PENDING/NOT_PUBLISHED>PENDING/PUBLISHING",
  "PENDING/NOT_PUBLISHED>ABORTING/NOT_PUBLISHED",
  "PENDING/NOT_PUBLISHED>COMPLETE/NOT_PUBLISHED",
  "PENDING/PUBLISHING>PENDING/PUBLISHED",
  "PENDING/PUBLISHING>ABORTING/PUBLISHING",
  "PENDING/PUBLISHED>ACTIVATING/PUBLISHED",
  "PENDING/PUBLISHED>ABORTING/PUBLISHED",
  "ACTIVATING/PUBLISHED>COMPLETE/CLEARED",
  "ABORTING/NOT_PUBLISHED>COMPLETE/NOT_PUBLISHED",
  "ABORTING/PUBLISHING>ABORTING/PUBLISHED",
  "ABORTING/PUBLISHED>ABORTING/CLEARED",
  "ABORTING/CLEARED>COMPLETE/CLEARED",
]);

export function isCleanupLifecyclePublicationPair(
  lifecycle: unknown,
  publication: unknown,
): lifecycle is CleanupLifecycle {
  return (
    typeof lifecycle === "string" &&
    typeof publication === "string" &&
    Object.hasOwn(cleanupPairs, lifecycle) &&
    (cleanupPairs[lifecycle as CleanupLifecycle] as readonly string[]).includes(publication)
  );
}
export function isCleanupLifecyclePublicationTransition(
  previousLifecycle: unknown,
  previousPublication: unknown,
  nextLifecycle: unknown,
  nextPublication: unknown,
): boolean {
  return (
    isCleanupLifecyclePublicationPair(previousLifecycle, previousPublication) &&
    isCleanupLifecyclePublicationPair(nextLifecycle, nextPublication) &&
    cleanupTransitions.has(
      `${previousLifecycle}/${previousPublication}>${nextLifecycle}/${nextPublication}`,
    )
  );
}
export function reduceCleanupHeadWrite(
  previousLifecycle: unknown,
  previousPublication: unknown,
  requestedLifecycle: unknown,
  requestedPublication: unknown,
): CleanupHeadWriteDisposition {
  if (
    !isCleanupLifecyclePublicationPair(previousLifecycle, previousPublication) ||
    !isCleanupLifecyclePublicationPair(requestedLifecycle, requestedPublication)
  )
    return "REFUSED";
  if (previousLifecycle === requestedLifecycle && previousPublication === requestedPublication)
    return "NO_APPEND";
  return isCleanupLifecyclePublicationTransition(
    previousLifecycle,
    previousPublication,
    requestedLifecycle,
    requestedPublication,
  )
    ? "APPEND"
    : "REFUSED";
}

export function validateFenceTransition(previous: unknown, next: unknown): boolean {
  return previous === "PREPARED" && next === "POST_ACTIVATION";
}

function prefixed(prefix: string, issues: readonly string[]): string[] {
  return issues.map((issue) => `${prefix}:${issue}`);
}

function validateHistoryInputs(
  rootInput: unknown,
  historyInput: unknown,
  pathInstanceDigest: unknown,
  parseRoot: (input: unknown) => ParseResult,
  parseHead: (input: unknown) => ParseResult,
  maximum: number,
):
  | {
      readonly ok: true;
      readonly root: ContractRecord;
      readonly heads: readonly ContractRecord[];
      readonly pathInstanceDigest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const root = parseRoot(rootInput);
  if (!root.ok) issues.push(...prefixed("root", root.issues));
  const history = snapshotClosedArray(historyInput);
  if (!history.ok) issues.push(...prefixed("history", history.issues));
  else if (history.value.length < 1 || history.value.length > maximum)
    issues.push("history:length");
  const validPathInstanceDigest =
    typeof pathInstanceDigest === "string" && isSha256(pathInstanceDigest);
  if (!validPathInstanceDigest) issues.push("pathInstanceDigest:invalid");

  const heads: ContractRecord[] = [];
  if (history.ok)
    for (let index = 0; index < history.value.length; index += 1) {
      const parsed = parseHead(history.value[index]);
      if (!parsed.ok) issues.push(...prefixed(`history.${index}`, parsed.issues));
      else heads.push(parsed.value);
    }
  if (issues.length > 0 || !root.ok || !history.ok || !validPathInstanceDigest)
    return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
  return {
    ok: true,
    root: root.value,
    heads: Object.freeze(heads),
    pathInstanceDigest: pathInstanceDigest as string,
  };
}

export function validateCleanupHeadHistory(
  rootInput: unknown,
  historyInput: unknown,
  pathInstanceDigest: unknown,
): readonly string[] {
  const parsed = validateHistoryInputs(
    rootInput,
    historyInput,
    pathInstanceDigest,
    parseCleanupGateRoot,
    parseCleanupGateHead,
    6,
  );
  if (!parsed.ok) return parsed.issues;
  const issues: string[] = [];
  const rootDigest = computeCleanupGateRootDigest(parsed.root);
  let priorValueDigest: string | null = null;
  let priorRecordedAt: string | null = null;
  let priorLifecycle: unknown;
  let priorPublication: unknown;
  for (let index = 0; index < parsed.heads.length; index += 1) {
    const head = parsed.heads[index]!;
    if (head.ordinal !== String(index)) issues.push(`${index}:ordinal:not-dense`);
    if (head.priorHeadValueDigest !== priorValueDigest)
      issues.push(`${index}:priorHeadValueDigest:mismatch`);
    if (head.rootDigest !== rootDigest) issues.push(`${index}:rootDigest:mismatch`);
    if (String(head.recordedAt) < String(parsed.root.createdAt))
      issues.push(`${index}:recordedAt:before-root`);
    if (priorRecordedAt !== null && String(head.recordedAt) < priorRecordedAt)
      issues.push(`${index}:recordedAt:before-prior`);
    if (index === 0) {
      if (head.lifecycle !== "PENDING" || head.publication !== "NOT_PUBLISHED")
        issues.push("0:transition:not-genesis");
    } else if (
      !isCleanupLifecyclePublicationTransition(
        priorLifecycle,
        priorPublication,
        head.lifecycle,
        head.publication,
      )
    )
      issues.push(`${index}:transition:invalid`);
    priorValueDigest = computePointerValueDigest(
      "ACTIVATION_CLEANUP_GATE",
      parsed.pathInstanceDigest,
      head,
    );
    priorRecordedAt = String(head.recordedAt);
    priorLifecycle = head.lifecycle;
    priorPublication = head.publication;
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function validateFenceHeadHistory(
  rootInput: unknown,
  historyInput: unknown,
  pathInstanceDigest: unknown,
): readonly string[] {
  const parsed = validateHistoryInputs(
    rootInput,
    historyInput,
    pathInstanceDigest,
    parseRecoveryFenceRoot,
    parseRecoveryFenceHead,
    2,
  );
  if (!parsed.ok) return parsed.issues;
  const issues: string[] = [];
  const rootDigest = computeRecoveryFenceRootDigest(parsed.root);
  let priorValueDigest: string | null = null;
  let priorRecordedAt: string | null = null;
  let priorState: unknown;
  for (let index = 0; index < parsed.heads.length; index += 1) {
    const head = parsed.heads[index]!;
    if (head.ordinal !== String(index)) issues.push(`${index}:ordinal:not-dense`);
    if (head.priorHeadValueDigest !== priorValueDigest)
      issues.push(`${index}:priorHeadValueDigest:mismatch`);
    if (head.rootDigest !== rootDigest) issues.push(`${index}:rootDigest:mismatch`);
    if (String(head.recordedAt) < String(parsed.root.createdAt))
      issues.push(`${index}:recordedAt:before-root`);
    if (priorRecordedAt !== null && String(head.recordedAt) < priorRecordedAt)
      issues.push(`${index}:recordedAt:before-prior`);
    if (index === 0 ? head.state !== "PREPARED" : !validateFenceTransition(priorState, head.state))
      issues.push(`${index}:transition:invalid`);
    priorValueDigest = computePointerValueDigest(
      "ACTIVATION_RECOVERY_FENCE",
      parsed.pathInstanceDigest,
      head,
    );
    priorRecordedAt = String(head.recordedAt);
    priorState = head.state;
  }
  return Object.freeze([...new Set(issues)].sort());
}

export const cleanupLifecyclePairs = Object.freeze(
  Object.entries(cleanupPairs).flatMap(([lifecycle, publications]) =>
    publications.map((publication) => `${lifecycle}/${publication}`),
  ),
);
export const cleanupLifecycleTransitions = Object.freeze([...cleanupTransitions].sort());

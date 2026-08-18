import {
  canonicalDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
} from "./runtime.js";

export type CleanupLifecycle = "PENDING" | "ACTIVATING" | "ABORTING" | "COMPLETE";
export type CleanupPublication = "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "CLEARED";
export type CleanupHeadWriteDisposition = "APPEND" | "NO_APPEND" | "REFUSED";
export type DestinationOwnerLifecycle = "ACTIVE" | "CONSUMED" | "RETIRED";
export type DestinationOwnerTransition =
  "ACTIVATE_GENESIS" | "CONSUME" | "RETIRE_UNUSED" | "RETIRE_CONSUMED" | "ACTIVATE_SUCCESSOR";
export type RecoveryAttemptReservationLifecycle =
  "RESERVED" | "CONSUMED" | "TERMINAL" | "TOMBSTONE";

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

export function validateCleanupHeadHistory(input: unknown): readonly string[] {
  const array = snapshotClosedArray(input);
  if (!array.ok || array.value.length === 0) return array.ok ? ["history:empty"] : array.issues;
  const issues: string[] = [];
  let priorDigest: string | null = null;
  let priorOrdinal: string | null = null;
  let priorLifecycle: unknown;
  let priorPublication: unknown;
  for (let index = 0; index < array.value.length; index += 1) {
    const row = snapshotClosedRecord(array.value[index], [
      "schemaVersion",
      "ordinal",
      "priorHeadDigest",
      "lifecycle",
      "publication",
      "rootDigest",
    ]);
    if (!row.ok) {
      issues.push(...row.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const r = row.value;
    if (r.schemaVersion !== "activation-cleanup-gate-head/v1")
      issues.push(`${index}:schemaVersion`);
    if (
      !isCanonicalDecimal(r.ordinal) ||
      r.ordinal !== (priorOrdinal === null ? "0" : incrementCanonicalDecimal(priorOrdinal))
    )
      issues.push(`${index}:ordinal`);
    if (r.priorHeadDigest !== priorDigest) issues.push(`${index}:priorHeadDigest`);
    if (!isSha256(r.rootDigest)) issues.push(`${index}:rootDigest`);
    if (!isCleanupLifecyclePublicationPair(r.lifecycle, r.publication))
      issues.push(`${index}:pair`);
    if (
      index > 0 &&
      !isCleanupLifecyclePublicationTransition(
        priorLifecycle,
        priorPublication,
        r.lifecycle,
        r.publication,
      )
    )
      issues.push(`${index}:transition`);
    priorDigest = canonicalDigest(r);
    priorOrdinal = String(r.ordinal);
    priorLifecycle = r.lifecycle;
    priorPublication = r.publication;
  }
  return Object.freeze(issues);
}

export function validateFenceHeadHistory(input: unknown): readonly string[] {
  const array = snapshotClosedArray(input);
  if (!array.ok || array.value.length < 1 || array.value.length > 2)
    return array.ok ? ["history:length"] : array.issues;
  const issues: string[] = [];
  let priorDigest: string | null = null;
  let priorState: unknown;
  for (let index = 0; index < array.value.length; index += 1) {
    const row = snapshotClosedRecord(array.value[index], [
      "schemaVersion",
      "ordinal",
      "priorHeadDigest",
      "state",
      "rootDigest",
    ]);
    if (!row.ok) {
      issues.push(...row.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const r = row.value;
    if (r.schemaVersion !== "activation-recovery-fence-head/v1" || r.ordinal !== String(index))
      issues.push(`${index}:identity`);
    if (r.priorHeadDigest !== priorDigest || !isSha256(r.rootDigest))
      issues.push(`${index}:digest-link`);
    if (index === 0 ? r.state !== "PREPARED" : !validateFenceTransition(priorState, r.state))
      issues.push(`${index}:transition`);
    priorDigest = canonicalDigest(r);
    priorState = r.state;
  }
  return Object.freeze(issues);
}

export const cleanupLifecyclePairs = Object.freeze(
  Object.entries(cleanupPairs).flatMap(([lifecycle, publications]) =>
    publications.map((publication) => `${lifecycle}/${publication}`),
  ),
);
export const cleanupLifecycleTransitions = Object.freeze([...cleanupTransitions].sort());

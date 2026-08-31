import {
  canonicalDigest,
  frame,
  framedDigest,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

// ISS-002 additive first literal group: inline identity, one public skip family.
export const routineStepSkipSchemaVersions = Object.freeze(["routine-step-skip/v1"] as const);
export const routineStepSchemaFields = Object.freeze({
  identity: Object.freeze([
    "cycleId",
    "inputDigest",
    "kind",
    "ordinal",
    "predecessorJournalDigest",
  ] as const),
  skip: Object.freeze(["reason", "schemaVersion", "step"] as const),
});
export const routineStepKinds = Object.freeze({
  "1": "session.verify",
  "2": "project.snapshot",
  "3": "breaker.reduce",
  "4": "module.plan",
  "5": "route.select",
  "6": "project.preflight",
  "7": "dispatch.plan",
  "8": "worker.dispatch",
  "9": "worker.observe",
  "10": "review.reduce",
  "11": "disposition.plan",
  "12": "mutation.plan",
  "13": "action.apply",
  "14": "resource.reclaim",
  "15": "cycle.terminal",
} as const);
export const routineStepSkipOrdinals = Object.freeze({
  "prior-known-terminal": Object.freeze([
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
  ] as const),
  "no-allocation": Object.freeze(["7"] as const),
  "no-worker": Object.freeze(["8", "9"] as const),
  "no-review": Object.freeze(["10"] as const),
  "no-mutation": Object.freeze(["12", "13"] as const),
});

export type RoutineStepOrdinal = keyof typeof routineStepKinds;
export type RoutineStepIdentity = {
  [Ordinal in RoutineStepOrdinal]: Readonly<{
    cycleId: string;
    inputDigest: string;
    kind: (typeof routineStepKinds)[Ordinal];
    ordinal: Ordinal;
    predecessorJournalDigest: Ordinal extends "1" ? null : string;
  }>;
}[RoutineStepOrdinal];
export type RoutineStepSkipReason = keyof typeof routineStepSkipOrdinals;
export type RoutineStepSkip = {
  [Reason in RoutineStepSkipReason]: Readonly<{
    reason: Reason;
    schemaVersion: "routine-step-skip/v1";
    step: Extract<
      RoutineStepIdentity,
      { ordinal: (typeof routineStepSkipOrdinals)[Reason][number] }
    >;
  }>;
}[RoutineStepSkipReason];

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

/** Shape only. The input and original journal prefix must later bind to actual admitted records. */
export function parseRoutineStepIdentity(input: unknown): ParseResult<RoutineStepIdentity> {
  const snapshot = snapshotClosedRecord(input, routineStepSchemaFields.identity);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  if (!isUuidV7(record.cycleId) || record.cycleId.length !== 36) issues.push("cycleId:invalid");
  if (!isSha256(record.inputDigest) || record.inputDigest.length !== 64)
    issues.push("inputDigest:invalid");
  if (typeof record.ordinal !== "string" || !Object.hasOwn(routineStepKinds, record.ordinal))
    issues.push("ordinal:invalid");
  else if (record.kind !== routineStepKinds[record.ordinal as RoutineStepOrdinal])
    issues.push("kind:ordinal-mismatch");
  if (record.ordinal === "1") {
    if (record.predecessorJournalDigest !== null)
      issues.push("predecessorJournalDigest:initial-null-required");
  } else if (
    !isSha256(record.predecessorJournalDigest) ||
    record.predecessorJournalDigest.length !== 64
  )
    issues.push("predecessorJournalDigest:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as RoutineStepIdentity };
}

/** Structural reason/ordinal admission is not manifest, terminal, history, or cycle authority. */
export function parseRoutineStepSkip(input: unknown): ParseResult<RoutineStepSkip> {
  const snapshot = snapshotClosedRecord(input, routineStepSchemaFields.skip);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "routine-step-skip/v1") issues.push("schemaVersion:mismatch");
  const step = parseRoutineStepIdentity(record.step);
  if (!step.ok) issues.push(...step.issues.map((issue) => `step.${issue}`));
  if (typeof record.reason !== "string" || !Object.hasOwn(routineStepSkipOrdinals, record.reason))
    issues.push("reason:invalid");
  else if (step.ok) {
    const ordinals: readonly string[] =
      routineStepSkipOrdinals[record.reason as RoutineStepSkipReason];
    if (!ordinals.includes(step.value.ordinal)) issues.push("step.ordinal:reason-mismatch");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as RoutineStepSkip };
}

/** Dstep is deliberately untagged SHA-256(C(step)), including the final LF. */
export function computeRoutineStepDigest(input: unknown): string {
  const parsed = parseRoutineStepIdentity(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}

/** Dskip uses one canonical-record part, not Dstep or an untagged skip hash. */
export function computeRoutineStepSkipDigest(input: unknown): string {
  const parsed = parseRoutineStepSkip(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("routine-step-skip/v1", [frame.canonical(parsed.value)]);
}

export function parseRoutineStepSkipContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "routine-step-skip/v1" ? parseRoutineStepSkip(input) : null;
}

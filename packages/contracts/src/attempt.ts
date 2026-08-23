import {
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotJson,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const reservedFields = Object.freeze([
  "activeReleaseTipDigest",
  "attemptId",
  "cleanupGateTipDigest",
  "lifecycle",
  "predecessorAttemptLogTipDigest",
  "recordedAt",
  "recoveryFenceTipDigest",
  "schemaVersion",
] as const);
const selectedFields = Object.freeze([...reservedFields, "selectedAttemptLogTipDigest"] as const);

export const recoveryAttemptReservationSchemaFields = Object.freeze({
  consumed: selectedFields,
  reserved: reservedFields,
  terminal: selectedFields,
});
export const recoveryAttemptReservationSchemaVersions = Object.freeze([
  "recovery-attempt-reservation/v1",
] as const);
export const recoveryAttemptReservationLifecycles = Object.freeze([
  "RESERVED",
  "CONSUMED",
  "TERMINAL",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function snapshotReservation(input: unknown): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const record = snapshot.value as ContractRecord;
  const expected =
    record.lifecycle === "RESERVED"
      ? reservedFields
      : record.lifecycle === "CONSUMED" || record.lifecycle === "TERMINAL"
        ? selectedFields
        : reservedFields;
  const expectedSet = new Set<string>(expected);
  const observed = Object.keys(record).sort();
  const issues = [
    ...expected.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed.filter((field) => !expectedSet.has(field)).map((field) => `${field}:unknown-field`),
  ];
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function parseRecoveryAttemptReservation(input: unknown): ParseResult {
  const parsed = snapshotReservation(input);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "recovery-attempt-reservation/v1")
    issues.push("schemaVersion:mismatch");
  if (
    record.lifecycle !== "RESERVED" &&
    record.lifecycle !== "CONSUMED" &&
    record.lifecycle !== "TERMINAL"
  )
    issues.push("lifecycle:invalid");
  for (const field of ["activeReleaseTipDigest", "cleanupGateTipDigest"] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  for (const field of ["predecessorAttemptLogTipDigest", "recoveryFenceTipDigest"] as const)
    if (record[field] !== null && !isSha256(record[field])) issues.push(`${field}:invalid`);
  if (!isUuidV7(record.attemptId)) issues.push("attemptId:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (
    (record.lifecycle === "CONSUMED" || record.lifecycle === "TERMINAL") &&
    !isSha256(record.selectedAttemptLogTipDigest)
  )
    issues.push("selectedAttemptLogTipDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function transitionIssues(...issues: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(issues)].sort());
}

export function validateRecoveryAttemptReservationTransition(
  previousInput: unknown | null,
  nextInput: unknown,
): readonly string[] {
  const next = parseRecoveryAttemptReservation(nextInput);
  if (!next.ok) return transitionIssues(...next.issues.map((issue) => `next.${issue}`));
  if (previousInput === null)
    return next.value.lifecycle === "RESERVED"
      ? transitionIssues()
      : transitionIssues("edge:invalid");
  const previous = parseRecoveryAttemptReservation(previousInput);
  if (!previous.ok) return transitionIssues(...previous.issues.map((issue) => `previous.${issue}`));

  const prior = previous.value;
  const current = next.value;
  const edge = `${prior.lifecycle}>${current.lifecycle}`;
  if (edge !== "RESERVED>CONSUMED" && edge !== "CONSUMED>TERMINAL")
    return transitionIssues("edge:invalid");

  const issues: string[] = [];
  for (const field of [
    "activeReleaseTipDigest",
    "attemptId",
    "cleanupGateTipDigest",
    "predecessorAttemptLogTipDigest",
    "recoveryFenceTipDigest",
  ] as const)
    if (prior[field] !== current[field]) issues.push(`${field}:mismatch`);
  if (String(prior.recordedAt) > String(current.recordedAt)) issues.push("recordedAt:before-prior");
  return transitionIssues(...issues);
}

export function parseRecoveryAttemptContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "recovery-attempt-reservation/v1"
    ? parseRecoveryAttemptReservation(input)
    : null;
}

import {
  frame,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedArray,
  snapshotJson,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const inProgressFields = Object.freeze([
  "attemptId",
  "descriptorDigest",
  "lifecycle",
  "ordinal",
  "predecessorRecordDigest",
  "recordedAt",
  "schemaVersion",
  "sourceToken",
  "transactionId",
] as const);
const terminalFields = Object.freeze([
  "attachmentTipDigest",
  "attemptId",
  "channelDenialEvidenceDigest",
  "descriptorDigest",
  "lifecycle",
  "ordinal",
  "predecessorRecordDigest",
  "processTerminalObservationDigest",
  "recordedAt",
  "revocationEvidenceDigest",
  "schemaVersion",
  "sourceToken",
  "terminalDisposition",
  "terminalOutcomeEvidenceDigest",
  "transactionId",
] as const);

export const recoveryAttemptLogSchemaFields = Object.freeze({
  inProgress: inProgressFields,
  terminal: terminalFields,
});
export const recoveryAttemptLogSchemaVersions = Object.freeze(["attempt-log/v1"] as const);
export const recoveryAttemptLogLifecycles = Object.freeze(["IN_PROGRESS", "TERMINAL"] as const);
export const recoveryAttemptTerminalDispositions = Object.freeze([
  "RETRYABLE",
  "HANDOFF",
  "ABORTED",
  "COMPLETE",
] as const);
export type RecoveryAttemptLogLifecycle = (typeof recoveryAttemptLogLifecycles)[number];
export type RecoveryAttemptTerminalDisposition =
  (typeof recoveryAttemptTerminalDispositions)[number];

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function parseRecoveryAttemptLogRecord(input: unknown): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const record = snapshot.value as ContractRecord;
  const fields =
    record.lifecycle === "IN_PROGRESS"
      ? inProgressFields
      : record.lifecycle === "TERMINAL"
        ? terminalFields
        : inProgressFields;
  const expected = new Set<string>(fields);
  const observed = Object.keys(record).sort();
  const found = [
    ...fields.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed.filter((field) => !expected.has(field)).map((field) => `${field}:unknown-field`),
  ];
  if (found.length > 0) return invalid(...found);
  if (record.schemaVersion !== "attempt-log/v1") found.push("schemaVersion:mismatch");
  if (record.lifecycle !== "IN_PROGRESS" && record.lifecycle !== "TERMINAL")
    found.push("lifecycle:invalid");
  for (const field of ["attemptId", "transactionId"] as const)
    if (!isUuidV7(record[field])) found.push(`${field}:invalid`);
  if (!isSha256(record.descriptorDigest)) found.push("descriptorDigest:invalid");
  if (!isCanonicalDecimal(record.ordinal)) found.push("ordinal:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) found.push("recordedAt:invalid");
  if (record.sourceToken !== "cleanup-gate-pre-fence" && record.sourceToken !== "recovery-fence")
    found.push("sourceToken:invalid");
  if (record.ordinal === "0") {
    if (record.predecessorRecordDigest !== null) found.push("predecessorRecordDigest:genesis");
    if (record.lifecycle !== "IN_PROGRESS") found.push("lifecycle:genesis-not-in-progress");
  } else if (!isSha256(record.predecessorRecordDigest)) {
    found.push("predecessorRecordDigest:invalid");
  }
  if (record.lifecycle === "TERMINAL") {
    for (const field of [
      "channelDenialEvidenceDigest",
      "processTerminalObservationDigest",
      "terminalOutcomeEvidenceDigest",
    ] as const)
      if (!isSha256(record[field])) found.push(`${field}:invalid`);
    for (const field of ["attachmentTipDigest", "revocationEvidenceDigest"] as const)
      if (record[field] !== null && !isSha256(record[field])) found.push(`${field}:invalid`);
    if (
      !(recoveryAttemptTerminalDispositions as readonly unknown[]).includes(
        record.terminalDisposition,
      )
    )
      found.push("terminalDisposition:invalid");
  }
  return found.length === 0 ? { ok: true, value: record } : invalid(...found);
}

export function computeRecoveryAttemptLogRecordDigest(input: unknown): string {
  const parsed = parseRecoveryAttemptLogRecord(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("attempt-log/v1", [frame.canonical(parsed.value)]);
}

export function recoveryAttemptLogRecordPath(input: unknown): string {
  const parsed = parseRecoveryAttemptLogRecord(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return `installation/activation-recovery-launches/${String(record.transactionId)}/${String(record.sourceToken)}/attempts/${String(record.attemptId)}/${String(record.ordinal)}-${String(record.lifecycle)}.json`;
}

function uniqueIssues(...values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function validateRecoveryAttemptLogEdge(
  previousInput: unknown | null,
  nextInput: unknown,
): readonly string[] {
  const next = parseRecoveryAttemptLogRecord(nextInput);
  if (!next.ok) return uniqueIssues(...next.issues.map((issue) => `next.${issue}`));
  if (previousInput === null)
    return next.value.lifecycle === "IN_PROGRESS" &&
      next.value.ordinal === "0" &&
      next.value.predecessorRecordDigest === null
      ? uniqueIssues()
      : uniqueIssues("edge:invalid-genesis");
  const previous = parseRecoveryAttemptLogRecord(previousInput);
  if (!previous.ok) return uniqueIssues(...previous.issues.map((issue) => `previous.${issue}`));
  const prior = previous.value;
  const current = next.value;
  const expectedLifecycle = prior.lifecycle === "IN_PROGRESS" ? "TERMINAL" : "IN_PROGRESS";
  const found: string[] = [];
  if (current.lifecycle !== expectedLifecycle) found.push("edge:lifecycle");
  try {
    if (incrementCanonicalDecimal(String(prior.ordinal)) !== current.ordinal)
      found.push("ordinal:not-adjacent");
  } catch {
    found.push("ordinal:not-adjacent");
  }
  if (current.predecessorRecordDigest !== computeRecoveryAttemptLogRecordDigest(prior))
    found.push("predecessorRecordDigest:mismatch");
  for (const field of ["sourceToken", "transactionId"] as const)
    if (prior[field] !== current[field]) found.push(`${field}:mismatch`);
  if (prior.lifecycle === "IN_PROGRESS") {
    for (const field of ["attemptId", "descriptorDigest"] as const)
      if (prior[field] !== current[field]) found.push(`${field}:mismatch`);
  } else if (prior.attemptId === current.attemptId) {
    found.push("attemptId:reused");
  }
  if (String(prior.recordedAt) > String(current.recordedAt)) found.push("recordedAt:before-prior");
  return uniqueIssues(...found);
}

export type RecoveryAttemptLogChainResult =
  | { readonly ok: true; readonly value: readonly ContractRecord[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export function validateRecoveryAttemptLogChain(input: unknown): RecoveryAttemptLogChainResult {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return { ok: false, issues: snapshot.issues };
  if (snapshot.value.length === 0) return { ok: false, issues: Object.freeze(["chain:empty"]) };
  const parsed: ContractRecord[] = [];
  const found: string[] = [];
  const seenAttempts = new Set<string>();
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const record = parseRecoveryAttemptLogRecord(snapshot.value[index]);
    if (!record.ok) {
      found.push(...record.issues.map((issue) => `${index}.${issue}`));
      continue;
    }
    if (record.value.lifecycle === "IN_PROGRESS") {
      const attemptId = String(record.value.attemptId);
      if (seenAttempts.has(attemptId)) found.push(`${index}.attemptId:reused`);
      else seenAttempts.add(attemptId);
    }
    const prior = index === 0 ? null : parsed[index - 1];
    if (index === 0 || prior)
      found.push(
        ...validateRecoveryAttemptLogEdge(prior ?? null, record.value).map(
          (issue) => `${index}.${issue}`,
        ),
      );
    parsed.push(record.value);
  }
  return found.length === 0 && parsed.length === snapshot.value.length
    ? { ok: true, value: Object.freeze(parsed) }
    : { ok: false, issues: uniqueIssues(...found) };
}

export function parseRecoveryAttemptLogContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "attempt-log/v1" ? parseRecoveryAttemptLogRecord(input) : null;
}

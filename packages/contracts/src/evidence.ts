import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ParseResult,
} from "./runtime.js";

const globalIdentityFields = Object.freeze([
  "authorityPath",
  "authorityPathInstanceDigest",
  "custodyInstanceDigest",
  "installationId",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
] as const);
const unknownEvidenceFields = Object.freeze([
  "category",
  "observationDigest",
  "observedAt",
  "observedByteLength",
  "reason",
  "schemaVersion",
  "targetMutationId",
  "targetPathInstanceDigest",
] as const);

export const evidenceSchemaFields = Object.freeze({
  globalIdentity: globalIdentityFields,
  unknownEvidence: unknownEvidenceFields,
});
export const evidenceSchemaVersions = Object.freeze([
  "pointer-mutation-unknown-evidence/v1",
  "state-mutation-global-identity/v1",
] as const);

export const unknownEvidenceReasons = Object.freeze({
  IMPOSSIBLE: Object.freeze(["EPOCH_MISMATCH", "IDENTITY_MISMATCH", "STATE_CONTRADICTION"]),
  MALFORMED: Object.freeze(["DIGEST_MISMATCH", "NON_CANONICAL", "SCHEMA_INVALID"]),
  UNREADABLE: Object.freeze(["IO_ERROR", "MISSING", "PERMISSION_DENIED"]),
} as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
  schemaVersion: string,
): ParseResult {
  const record = snapshotClosedRecord(input, fields);
  if (!record.ok) return record;
  return record.value.schemaVersion === schemaVersion ? record : invalid("schemaVersion:mismatch");
}

export function parseStateMutationGlobalIdentity(input: unknown): ParseResult {
  const parsed = exactRecord(input, globalIdentityFields, "state-mutation-global-identity/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (!isUuidV7(record.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
  if (!isSha256(record.stateRootDigest)) issues.push("stateRootDigest:invalid");
  if (!isSha256(record.custodyInstanceDigest)) issues.push("custodyInstanceDigest:invalid");
  if (!isContractRelativePath(record.authorityPath)) issues.push("authorityPath:invalid");
  if (!isSha256(record.authorityPathInstanceDigest))
    issues.push("authorityPathInstanceDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeStateMutationGlobalIdentityDigest(input: unknown): string {
  const parsed = parseStateMutationGlobalIdentity(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("state-mutation-global-identity/v1", [
    frame.text(String(record.installationId)),
    frame.text(String(record.projectId)),
    frame.raw32(String(record.stateRootDigest)),
    frame.raw32(String(record.custodyInstanceDigest)),
    frame.text(String(record.authorityPath)),
    frame.raw32(String(record.authorityPathInstanceDigest)),
  ]);
}

export function parsePointerMutationUnknownEvidence(input: unknown): ParseResult {
  const parsed = exactRecord(input, unknownEvidenceFields, "pointer-mutation-unknown-evidence/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  const category = String(record.category) as keyof typeof unknownEvidenceReasons;
  if (!Object.hasOwn(unknownEvidenceReasons, category)) issues.push("category:invalid");
  else if (!(unknownEvidenceReasons[category] as readonly string[]).includes(String(record.reason)))
    issues.push("reason:category-mismatch");
  if (!isSha256(record.targetPathInstanceDigest)) issues.push("targetPathInstanceDigest:invalid");
  if (!isSha256(record.targetMutationId)) issues.push("targetMutationId:invalid");
  if (!isSha256(record.observationDigest)) issues.push("observationDigest:invalid");
  if (!isCanonicalDecimal(record.observedByteLength)) issues.push("observedByteLength:invalid");
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computePointerMutationUnknownEvidenceDigest(input: unknown): string {
  const parsed = parsePointerMutationUnknownEvidence(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("pointer-mutation-unknown-evidence/v1", [frame.canonical(parsed.value)]);
}

export function parseEvidenceContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | null {
  switch (expectedSchemaVersion) {
    case "pointer-mutation-unknown-evidence/v1":
      return parsePointerMutationUnknownEvidence(input);
    case "state-mutation-global-identity/v1":
      return parseStateMutationGlobalIdentity(input);
    default:
      return null;
  }
}

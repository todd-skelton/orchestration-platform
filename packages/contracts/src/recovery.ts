import {
  frame,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotJson,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const commonCoreFields = Object.freeze([
  "candidateDigest",
  "capabilityDigest",
  "capabilityReferenceDigest",
  "expiresAt",
  "hostIdentityDigest",
  "installationId",
  "issuedAt",
  "mode",
  "nativeGeneration",
  "producerDigest",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
  "transactionId",
  "userIdentityDigest",
] as const);
const bootstrapCoreFields = Object.freeze([
  "candidateDigest",
  "capabilityDigest",
  "capabilityReferenceDigest",
  "destinationDigest",
  "expiresAt",
  "grantDigest",
  "hostIdentityDigest",
  "installationId",
  "installerDigest",
  "issuedAt",
  "mode",
  "nativeGeneration",
  "producerDigest",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
  "transactionId",
  "userIdentityDigest",
] as const);
const successorCoreFields = Object.freeze([
  "admissionDigest",
  "candidateDigest",
  "capabilityDigest",
  "capabilityReferenceDigest",
  "cycleId",
  "expectedActiveGeneration",
  "expiresAt",
  "hostIdentityDigest",
  "installationId",
  "issuedAt",
  "mode",
  "nativeGeneration",
  "predecessorBrokerGeneration",
  "predecessorExecutableDigest",
  "predecessorOperationManifestDigest",
  "predecessorReleaseDigest",
  "producerDigest",
  "projectId",
  "recoveryFenceRootDigest",
  "schemaVersion",
  "stateRootDigest",
  "successorBrokerGeneration",
  "successorExecutableDigest",
  "successorOperationManifestDigest",
  "successorReleaseDigest",
  "transactionId",
  "userIdentityDigest",
] as const);

export const recoveryAuthorizationCoreSchemaFields = Object.freeze({
  bootstrap: bootstrapCoreFields,
  common: commonCoreFields,
  successor: successorCoreFields,
});
export const recoveryAuthorizationCoreSchemaVersions = Object.freeze([
  "recovery-authorization-core/v1",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function snapshotCore(input: unknown): ParseResult {
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
    record.mode === "BOOTSTRAP"
      ? bootstrapCoreFields
      : record.mode === "SUCCESSOR"
        ? successorCoreFields
        : commonCoreFields;
  const expectedSet = new Set<string>(expected);
  const observed = Object.keys(record).sort();
  const issues = [
    ...expected.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed.filter((field) => !expectedSet.has(field)).map((field) => `${field}:unknown-field`),
  ];
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

const commonDigestFields = Object.freeze([
  "candidateDigest",
  "capabilityDigest",
  "capabilityReferenceDigest",
  "hostIdentityDigest",
  "producerDigest",
  "stateRootDigest",
  "userIdentityDigest",
] as const);
const bootstrapDigestFields = Object.freeze([
  ...commonDigestFields,
  "destinationDigest",
  "grantDigest",
  "installerDigest",
] as const);
const successorDigestFields = Object.freeze([
  ...commonDigestFields,
  "admissionDigest",
  "predecessorExecutableDigest",
  "predecessorOperationManifestDigest",
  "predecessorReleaseDigest",
  "recoveryFenceRootDigest",
  "successorExecutableDigest",
  "successorOperationManifestDigest",
  "successorReleaseDigest",
] as const);

export function parseRecoveryAuthorizationCore(input: unknown): ParseResult {
  const parsed = snapshotCore(input);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "recovery-authorization-core/v1")
    issues.push("schemaVersion:mismatch");
  if (record.mode !== "BOOTSTRAP" && record.mode !== "SUCCESSOR") issues.push("mode:invalid");

  const digestFields = record.mode === "BOOTSTRAP" ? bootstrapDigestFields : successorDigestFields;
  for (const field of digestFields) if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  for (const field of ["installationId", "projectId", "transactionId"] as const)
    if (!isUuidV7(record[field])) issues.push(`${field}:invalid`);
  if (record.mode === "SUCCESSOR" && !isUuidV7(record.cycleId)) issues.push("cycleId:invalid");

  const issuedAtValid = isCanonicalTimestamp(record.issuedAt);
  const expiresAtValid = isCanonicalTimestamp(record.expiresAt);
  if (!issuedAtValid) issues.push("issuedAt:invalid");
  if (!expiresAtValid) issues.push("expiresAt:invalid");
  if (issuedAtValid && expiresAtValid && String(record.issuedAt) >= String(record.expiresAt))
    issues.push("issuedAt+expiresAt:not-increasing");

  const decimalFields =
    record.mode === "SUCCESSOR"
      ? ([
          "expectedActiveGeneration",
          "nativeGeneration",
          "predecessorBrokerGeneration",
          "successorBrokerGeneration",
        ] as const)
      : (["nativeGeneration"] as const);
  for (const field of decimalFields)
    if (!isCanonicalDecimal(record[field])) issues.push(`${field}:invalid`);
  if (
    record.mode === "SUCCESSOR" &&
    isCanonicalDecimal(record.predecessorBrokerGeneration) &&
    isCanonicalDecimal(record.successorBrokerGeneration)
  ) {
    try {
      if (
        incrementCanonicalDecimal(record.predecessorBrokerGeneration) !==
        record.successorBrokerGeneration
      )
        issues.push("brokerGeneration:not-adjacent");
    } catch {
      issues.push("brokerGeneration:not-adjacent");
    }
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeRecoveryAuthorizationCoreDigest(input: unknown): string {
  const parsed = parseRecoveryAuthorizationCore(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("recovery-authorization-core/v1", [frame.canonical(parsed.value)]);
}

export function parseRecoveryAuthorizationContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "recovery-authorization-core/v1"
    ? parseRecoveryAuthorizationCore(input)
    : null;
}

function uuidV7(value: string, name: string): string {
  if (!isUuidV7(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function root(transactionId: string): string {
  return `installation/recovery-authorizations/${uuidV7(transactionId, "transactionId")}`;
}

export const recoveryAuthorizationPaths = Object.freeze({
  core: (transactionId: string): string => `${root(transactionId)}/core.json`,
  state: (transactionId: string): string => `${root(transactionId)}/state.json`,
  attachment: (transactionId: string): string => `${root(transactionId)}/attachment.json`,
  nativeReceipt: (transactionId: string, operationId: string): string =>
    `${root(transactionId)}/native/${uuidV7(operationId, "operationId")}.json`,
  postSelectionReceipt: (transactionId: string, operationId: string): string =>
    `${root(transactionId)}/receipts/${uuidV7(operationId, "operationId")}.json`,
  archive: (transactionId: string): string => `${root(transactionId)}/archive.json`,
  attachmentArchive: (transactionId: string): string =>
    `${root(transactionId)}/attachment-archive.json`,
});

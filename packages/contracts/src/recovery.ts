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

const createdStateFields = Object.freeze([
  "authorizationCoreDigest",
  "consumeOperationId",
  "lifecycle",
  "mode",
  "recordedAt",
  "schemaVersion",
  "transactionId",
] as const);
const consumedStateFields = Object.freeze([
  "authorizationCoreDigest",
  "cleanupGateRootDigest",
  "consumeOperationId",
  "lifecycle",
  "mode",
  "nativeConsumeReceiptDigest",
  "recordedAt",
  "schemaVersion",
  "transactionId",
] as const);
const revokedStateFields = Object.freeze([
  "authorizationCoreDigest",
  "cleanupGateRootDigest",
  "consumeOperationId",
  "consumePostSelectionReceiptDigest",
  "lifecycle",
  "mode",
  "nativeConsumeReceiptDigest",
  "nativeRemovalReceiptDigest",
  "recordedAt",
  "removalOperationId",
  "schemaVersion",
  "transactionId",
] as const);
const commonStateFields = Object.freeze([
  "authorizationCoreDigest",
  "lifecycle",
  "mode",
  "recordedAt",
  "schemaVersion",
  "transactionId",
] as const);

export const recoveryAuthorizationStateSchemaFields = Object.freeze({
  consumed: consumedStateFields,
  created: createdStateFields,
  revoked: revokedStateFields,
});
export const recoveryAuthorizationStateSchemaVersions = Object.freeze([
  "recovery-authorization-state/v1",
] as const);

const nativeConsumeReceiptFields = Object.freeze([
  "authorizationCoreDigest",
  "nativeGeneration",
  "operationId",
  "recordedAt",
  "schemaVersion",
  "transactionId",
] as const);
const nativeRemovalReceiptFields = Object.freeze([
  "authorizationCoreDigest",
  "nativeConsumeReceiptDigest",
  "operationId",
  "priorNativeGeneration",
  "recordedAt",
  "removalDisposition",
  "schemaVersion",
  "successorNativeGeneration",
  "transactionId",
] as const);

export const recoveryAuthorizationNativeReceiptSchemaFields = Object.freeze({
  consume: nativeConsumeReceiptFields,
  removal: nativeRemovalReceiptFields,
});
export const recoveryAuthorizationNativeReceiptSchemaVersions = Object.freeze([
  "native-consume-receipt/v1",
  "native-removal-receipt/v1",
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

function snapshotState(input: unknown): ParseResult {
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
    record.lifecycle === "CREATED"
      ? createdStateFields
      : record.lifecycle === "CONSUMED"
        ? consumedStateFields
        : record.lifecycle === "REVOKED"
          ? revokedStateFields
          : commonStateFields;
  const expectedSet = new Set<string>(expected);
  const observed = Object.keys(record).sort();
  const issues = [
    ...expected.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed.filter((field) => !expectedSet.has(field)).map((field) => `${field}:unknown-field`),
  ];
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function parseRecoveryAuthorizationState(input: unknown): ParseResult {
  const parsed = snapshotState(input);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "recovery-authorization-state/v1")
    issues.push("schemaVersion:mismatch");
  if (
    record.lifecycle !== "CREATED" &&
    record.lifecycle !== "CONSUMED" &&
    record.lifecycle !== "REVOKED"
  )
    issues.push("lifecycle:invalid");
  if (record.mode !== "BOOTSTRAP" && record.mode !== "SUCCESSOR") issues.push("mode:invalid");
  if (!isSha256(record.authorizationCoreDigest)) issues.push("authorizationCoreDigest:invalid");
  if (!isUuidV7(record.consumeOperationId)) issues.push("consumeOperationId:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (!isUuidV7(record.transactionId)) issues.push("transactionId:invalid");

  if (record.lifecycle === "CONSUMED") {
    if (!isSha256(record.cleanupGateRootDigest)) issues.push("cleanupGateRootDigest:invalid");
    if (!isSha256(record.nativeConsumeReceiptDigest))
      issues.push("nativeConsumeReceiptDigest:invalid");
  }
  if (record.lifecycle === "REVOKED") {
    const gateValid =
      record.cleanupGateRootDigest === null || isSha256(record.cleanupGateRootDigest);
    const consumePostValid =
      record.consumePostSelectionReceiptDigest === null ||
      isSha256(record.consumePostSelectionReceiptDigest);
    const nativeConsumeValid =
      record.nativeConsumeReceiptDigest === null || isSha256(record.nativeConsumeReceiptDigest);
    if (!gateValid) issues.push("cleanupGateRootDigest:invalid");
    if (!consumePostValid) issues.push("consumePostSelectionReceiptDigest:invalid");
    if (!nativeConsumeValid) issues.push("nativeConsumeReceiptDigest:invalid");
    if (!isSha256(record.nativeRemovalReceiptDigest))
      issues.push("nativeRemovalReceiptDigest:invalid");
    if (!isUuidV7(record.removalOperationId)) issues.push("removalOperationId:invalid");
    const consumePostPresent = record.consumePostSelectionReceiptDigest !== null;
    const nativeConsumePresent = record.nativeConsumeReceiptDigest !== null;
    if (consumePostPresent !== nativeConsumePresent) issues.push("consumeReceipts:partial");
    if (consumePostPresent && record.cleanupGateRootDigest === null)
      issues.push("cleanupGateRootDigest:required-after-consume");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

function transitionIssues(...issues: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(issues)].sort());
}

export function validateRecoveryAuthorizationTransition(
  previousInput: unknown | null,
  nextInput: unknown,
): readonly string[] {
  const next = parseRecoveryAuthorizationState(nextInput);
  if (!next.ok) return transitionIssues(...next.issues.map((issue) => `next.${issue}`));
  if (previousInput === null)
    return next.value.lifecycle === "CREATED"
      ? transitionIssues()
      : transitionIssues("edge:invalid");
  const previous = parseRecoveryAuthorizationState(previousInput);
  if (!previous.ok) return transitionIssues(...previous.issues.map((issue) => `previous.${issue}`));

  const prior = previous.value;
  const current = next.value;
  const edge = `${prior.lifecycle}>${current.lifecycle}`;
  if (edge !== "CREATED>CONSUMED" && edge !== "CREATED>REVOKED" && edge !== "CONSUMED>REVOKED")
    return transitionIssues("edge:invalid");

  const issues: string[] = [];
  for (const field of [
    "authorizationCoreDigest",
    "consumeOperationId",
    "mode",
    "transactionId",
  ] as const)
    if (prior[field] !== current[field]) issues.push(`${field}:mismatch`);
  if (String(prior.recordedAt) > String(current.recordedAt)) issues.push("recordedAt:before-prior");

  if (edge === "CREATED>REVOKED") {
    if (
      current.consumePostSelectionReceiptDigest !== null ||
      current.nativeConsumeReceiptDigest !== null
    )
      issues.push("consumeReceipts:unexpected");
  }
  if (edge === "CONSUMED>REVOKED") {
    if (current.consumePostSelectionReceiptDigest === null)
      issues.push("consumePostSelectionReceiptDigest:required");
    if (current.cleanupGateRootDigest !== prior.cleanupGateRootDigest)
      issues.push("cleanupGateRootDigest:mismatch");
    if (current.nativeConsumeReceiptDigest !== prior.nativeConsumeReceiptDigest)
      issues.push("nativeConsumeReceiptDigest:mismatch");
  }
  return transitionIssues(...issues);
}

function snapshotReceipt(input: unknown, fields: readonly string[]): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const record = snapshot.value as ContractRecord;
  const expected = new Set(fields);
  const observed = Object.keys(record).sort();
  const issues = [
    ...fields.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed.filter((field) => !expected.has(field)).map((field) => `${field}:unknown-field`),
  ];
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function parseNativeConsumeReceipt(input: unknown): ParseResult {
  const parsed = snapshotReceipt(input, nativeConsumeReceiptFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "native-consume-receipt/v1") issues.push("schemaVersion:mismatch");
  if (!isSha256(record.authorizationCoreDigest)) issues.push("authorizationCoreDigest:invalid");
  if (!isCanonicalDecimal(record.nativeGeneration)) issues.push("nativeGeneration:invalid");
  if (!isUuidV7(record.operationId)) issues.push("operationId:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (!isUuidV7(record.transactionId)) issues.push("transactionId:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeNativeConsumeReceiptDigest(input: unknown): string {
  const parsed = parseNativeConsumeReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("native-consume-receipt/v1", [frame.canonical(parsed.value)]);
}

export function parseNativeRemovalReceipt(input: unknown): ParseResult {
  const parsed = snapshotReceipt(input, nativeRemovalReceiptFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "native-removal-receipt/v1") issues.push("schemaVersion:mismatch");
  if (!isSha256(record.authorizationCoreDigest)) issues.push("authorizationCoreDigest:invalid");
  if (record.nativeConsumeReceiptDigest !== null && !isSha256(record.nativeConsumeReceiptDigest))
    issues.push("nativeConsumeReceiptDigest:invalid");
  if (!isUuidV7(record.operationId)) issues.push("operationId:invalid");
  const priorValid = isCanonicalDecimal(record.priorNativeGeneration);
  const successorValid = isCanonicalDecimal(record.successorNativeGeneration);
  if (!priorValid) issues.push("priorNativeGeneration:invalid");
  if (!successorValid) issues.push("successorNativeGeneration:invalid");
  if (priorValid && successorValid) {
    try {
      if (
        incrementCanonicalDecimal(String(record.priorNativeGeneration)) !==
        String(record.successorNativeGeneration)
      )
        issues.push("nativeGeneration:not-adjacent");
    } catch {
      issues.push("nativeGeneration:not-adjacent");
    }
  }
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (record.removalDisposition !== "ABSENT" && record.removalDisposition !== "DISABLED")
    issues.push("removalDisposition:invalid");
  if (!isUuidV7(record.transactionId)) issues.push("transactionId:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeNativeRemovalReceiptDigest(input: unknown): string {
  const parsed = parseNativeRemovalReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("native-removal-receipt/v1", [frame.canonical(parsed.value)]);
}

export function parseRecoveryAuthorizationContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  if (schemaVersion === "recovery-authorization-core/v1")
    return parseRecoveryAuthorizationCore(input);
  if (schemaVersion === "recovery-authorization-state/v1")
    return parseRecoveryAuthorizationState(input);
  if (schemaVersion === "native-consume-receipt/v1") return parseNativeConsumeReceipt(input);
  if (schemaVersion === "native-removal-receipt/v1") return parseNativeRemovalReceipt(input);
  return null;
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

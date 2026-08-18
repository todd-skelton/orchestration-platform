import {
  canonicalDigest,
  frame,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isSha256,
  isUuidV7,
  snapshotClosedArray,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const bootstrapOperationFields = Object.freeze([
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "independentReviewReceiptDigest",
  "installedBytesDigest",
  "operationKind",
  "releaseManifestDigest",
  "releaseSubjectDigest",
  "reviewedInstallerDigest",
  "schemaVersion",
] as const);
const promotionOperationFields = Object.freeze([
  "independentReviewReceiptDigest",
  "installedBytesDigest",
  "operationKind",
  "predecessorActiveReleasePathInstanceDigest",
  "predecessorActiveReleaseReceiptDigest",
  "predecessorActiveReleaseTipDigest",
  "predecessorActiveReleaseValueDigest",
  "promotionTransactionId",
  "releaseManifestDigest",
  "releaseSubjectDigest",
  "schemaVersion",
  "successorActiveReleasePathInstanceDigest",
  "successorActiveReleaseReceiptDigest",
  "successorActiveReleaseTipDigest",
  "successorActiveReleaseValueDigest",
] as const);
const successorCoreFields = Object.freeze([
  "abiDigest",
  "admittedCustodyObservationDigest",
  "authorityPathInstanceDigest",
  "custodyInstanceDigest",
  "globalIdentityDigest",
  "independentReviewReceiptDigest",
  "lockProfileDigest",
  "operationKind",
  "reviewedInstalledBytesDigest",
  "reviewedOperationDigest",
  "reviewedReleaseManifestDigest",
  "reviewedReleaseSubjectDigest",
  "schemaVersion",
  "stateComponentProfileDigest",
  "successorAuthorityOrdinal",
  "successorHelperDigest",
  "successorHelperProfileDigest",
] as const);
const genesisBootstrapInputFields = Object.freeze([
  "bootstrapAnchorActiveReceiptDigest",
  "bootstrapAnchorActiveTipDigest",
  "bootstrapAnchorActiveValueDigest",
  "bootstrapAnchorDigest",
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "destinationDigest",
  "destinationOwnerActiveReceiptDigest",
  "destinationOwnerActiveTipDigest",
  "destinationOwnerActiveValueDigest",
  "globalBootstrapIdentityDigest",
  "schemaVersion",
  "successorCoreDigest",
  "useIntentDigest",
] as const);
const rotationInputFields = Object.freeze([
  "globalIdentityDigest",
  "priorHeadOrdinal",
  "priorRecordDigest",
  "retiringAuthorityPathInstanceDigest",
  "retiringAuthorityReceiptDigest",
  "retiringAuthorityTipDigest",
  "retiringAuthorityValueDigest",
  "reviewedOperationDigest",
  "rotationTransactionId",
  "schemaVersion",
  "successorAuthorityOrdinal",
  "successorCoreDigest",
] as const);
const genesisSelectionEvidenceFields = Object.freeze([
  "anchorConsumedProposalReadbackDigest",
  "anchorConsumedReceiptDigest",
  "anchorConsumedTipDigest",
  "anchorConsumedTipReadbackDigest",
  "anchorConsumedValueDigest",
  "anchorConsumedValueReadbackDigest",
  "anchorConsumptionReceiptDigest",
  "bootstrapAnchorActiveReceiptDigest",
  "bootstrapAnchorActiveTipDigest",
  "bootstrapAnchorActiveValueDigest",
  "bootstrapAnchorDigest",
  "bootstrapGenesisCoreDigest",
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "destinationDigest",
  "destinationOwnerActiveReceiptDigest",
  "destinationOwnerActiveTipDigest",
  "destinationOwnerActiveValueDigest",
  "genesisBootstrapInputDigest",
  "globalBootstrapIdentityDigest",
  "historyRecordDigest",
  "ownerConsumedProposalReadbackDigest",
  "ownerConsumedReceiptDigest",
  "ownerConsumedTipDigest",
  "ownerConsumedTipReadbackDigest",
  "ownerConsumedValueDigest",
  "ownerConsumedValueReadbackDigest",
  "schemaVersion",
  "selectedAuthorityPathInstanceDigest",
  "selectedAuthorityProposalReadbackDigest",
  "selectedAuthorityReceiptDigest",
  "selectedAuthorityTipDigest",
  "selectedAuthorityTipReadbackDigest",
  "selectedAuthorityValueDigest",
  "selectedAuthorityValueReadbackDigest",
  "selectionPostReceiptDigest",
  "successorCoreDigest",
  "useIntentDigest",
] as const);
const genesisRecordFields = Object.freeze([
  "genesisBootstrapInputDigest",
  "globalIdentityDigest",
  "ordinal",
  "predecessorKind",
  "recordKind",
  "schemaVersion",
  "successorCoreDigest",
] as const);
const rotationRecordFields = Object.freeze([
  "globalIdentityDigest",
  "ordinal",
  "predecessorKind",
  "priorHeadOrdinal",
  "priorRecordDigest",
  "recordKind",
  "retiringAuthorityPathInstanceDigest",
  "retiringAuthorityReceiptDigest",
  "retiringAuthorityTipDigest",
  "retiringAuthorityValueDigest",
  "rotationInputDigest",
  "schemaVersion",
  "successorCoreDigest",
] as const);
const authorityValueFields = Object.freeze([
  "activeReleasePathInstanceDigest",
  "activeReleaseReceiptDigest",
  "activeReleaseTipDigest",
  "activeReleaseValueDigest",
  "admittedCustodyObservationDigest",
  "authorityOrdinal",
  "custodyInstanceDigest",
  "globalIdentityDigest",
  "headOrdinal",
  "headRecordDigest",
  "helperAbiDigest",
  "helperDigest",
  "helperProfileDigest",
  "installationId",
  "lockProfileDigest",
  "priorAuthorityReceiptDigest",
  "priorAuthorityTipDigest",
  "priorAuthorityValueDigest",
  "projectId",
  "schemaVersion",
  "stateComponentProfileDigest",
  "stateRootDigest",
] as const);
const authorityHistoryBindingFields = Object.freeze([
  "genesisSelectionEvidence",
  "globalIdentityDigest",
  "headOrdinal",
  "headRecordDigest",
  "records",
  "schemaVersion",
] as const);

export const simplifiedAuthoritySchemaFields = Object.freeze({
  authorityHistoryBinding: authorityHistoryBindingFields,
  reviewedAuthorityOperationBootstrap: bootstrapOperationFields,
  reviewedAuthorityOperationPromotion: promotionOperationFields,
  successorAuthorityCore: successorCoreFields,
  genesisBootstrapInput: genesisBootstrapInputFields,
  genesisSelectionEvidence: genesisSelectionEvidenceFields,
  rotationInput: rotationInputFields,
  historyGenesis: genesisRecordFields,
  historyRotation: rotationRecordFields,
  selectedAuthorityValue: authorityValueFields,
});

export const simplifiedAuthoritySchemaVersions = Object.freeze([
  "authority-history-binding/v1",
  "authority-history-genesis-bootstrap-input/v1",
  "authority-history-genesis-selection-evidence/v1",
  "authority-history-record/v1",
  "reviewed-authority-operation/v1",
  "state-mutation-authority-rotation-id/v1",
  "state-mutation-authority-value/v1",
  "state-mutation-successor-authority-core/v1",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function schemaRecord(
  input: unknown,
  fields: readonly string[],
  schemaVersion: string,
): ParseResult {
  const record = snapshotClosedRecord(input, fields);
  if (!record.ok) return record;
  return record.value.schemaVersion === schemaVersion ? record : invalid("schemaVersion:mismatch");
}

function digestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !isSha256(record[field])).map((field) => `${field}:invalid`);
}

function parsedOrThrow(result: ParseResult): ContractRecord {
  if (!result.ok) throw new TypeError(result.issues.join(","));
  return result.value;
}

function isNextDecimal(prior: string, successor: string): boolean {
  try {
    return incrementCanonicalDecimal(prior) === successor;
  } catch {
    return false;
  }
}

export function parseReviewedAuthorityOperation(input: unknown): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot as ParseResult;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const detached = snapshot.value as ContractRecord;
  const kind = detached.operationKind;
  const fields =
    kind === "BOOTSTRAP_INSTALL"
      ? bootstrapOperationFields
      : kind === "STABLE_PROMOTION"
        ? promotionOperationFields
        : null;
  if (!fields) return invalid("operationKind:invalid");
  const parsed = schemaRecord(detached, fields, "reviewed-authority-operation/v1");
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    fields.filter((field) => field.endsWith("Digest")),
  );
  const transactionField =
    kind === "BOOTSTRAP_INSTALL" ? "bootstrapTransactionId" : "promotionTransactionId";
  if (!isUuidV7(parsed.value[transactionField])) issues.push(`${transactionField}:invalid`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeReviewedAuthorityOperationDigest(input: unknown): string {
  const record = parsedOrThrow(parseReviewedAuthorityOperation(input));
  if (record.operationKind === "BOOTSTRAP_INSTALL") {
    return framedDigest("reviewed-authority-operation/v1", [
      frame.fixed("00"),
      frame.text(String(record.bootstrapTransactionId)),
      frame.raw32(String(record.bootstrapGrantDigest)),
      frame.raw32(String(record.reviewedInstallerDigest)),
      frame.raw32(String(record.releaseSubjectDigest)),
      frame.raw32(String(record.independentReviewReceiptDigest)),
      frame.raw32(String(record.releaseManifestDigest)),
      frame.raw32(String(record.installedBytesDigest)),
    ]);
  }
  return framedDigest("reviewed-authority-operation/v1", [
    frame.fixed("01"),
    frame.text(String(record.promotionTransactionId)),
    frame.raw32(String(record.predecessorActiveReleasePathInstanceDigest)),
    frame.raw32(String(record.predecessorActiveReleaseTipDigest)),
    frame.raw32(String(record.predecessorActiveReleaseValueDigest)),
    frame.raw32(String(record.predecessorActiveReleaseReceiptDigest)),
    frame.raw32(String(record.successorActiveReleasePathInstanceDigest)),
    frame.raw32(String(record.successorActiveReleaseTipDigest)),
    frame.raw32(String(record.successorActiveReleaseValueDigest)),
    frame.raw32(String(record.successorActiveReleaseReceiptDigest)),
    frame.raw32(String(record.releaseSubjectDigest)),
    frame.raw32(String(record.independentReviewReceiptDigest)),
    frame.raw32(String(record.releaseManifestDigest)),
    frame.raw32(String(record.installedBytesDigest)),
  ]);
}

export function parseSuccessorAuthorityCore(input: unknown): ParseResult {
  const parsed = schemaRecord(
    input,
    successorCoreFields,
    "state-mutation-successor-authority-core/v1",
  );
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    successorCoreFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isCanonicalDecimal(parsed.value.successorAuthorityOrdinal))
    issues.push("successorAuthorityOrdinal:invalid");
  if (!["BOOTSTRAP_INSTALL", "STABLE_PROMOTION"].includes(String(parsed.value.operationKind)))
    issues.push("operationKind:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeSuccessorAuthorityCoreDigest(
  input: unknown,
  reviewedOperation: unknown,
): string {
  const core = parsedOrThrow(parseSuccessorAuthorityCore(input));
  const operation = parsedOrThrow(parseReviewedAuthorityOperation(reviewedOperation));
  const operationDigest = computeReviewedAuthorityOperationDigest(operation);
  const repeated = [
    ["operationKind", "operationKind"],
    ["reviewedInstalledBytesDigest", "installedBytesDigest"],
    ["reviewedReleaseManifestDigest", "releaseManifestDigest"],
    ["reviewedReleaseSubjectDigest", "releaseSubjectDigest"],
    ["independentReviewReceiptDigest", "independentReviewReceiptDigest"],
  ] as const;
  if (
    core.reviewedOperationDigest !== operationDigest ||
    repeated.some(([coreField, operationField]) => core[coreField] !== operation[operationField])
  )
    throw new TypeError("successorCore:reviewed-operation-mismatch");
  return framedDigest("state-mutation-successor-authority-core/v1", [
    frame.raw32(String(core.globalIdentityDigest)),
    frame.raw32(String(core.authorityPathInstanceDigest)),
    frame.boundedDecimal(String(core.successorAuthorityOrdinal)),
    frame.raw32(String(core.reviewedReleaseManifestDigest)),
    frame.raw32(String(core.reviewedInstalledBytesDigest)),
    frame.raw32(String(core.reviewedReleaseSubjectDigest)),
    frame.raw32(String(core.independentReviewReceiptDigest)),
    frame.fixed(core.operationKind === "BOOTSTRAP_INSTALL" ? "00" : "01"),
    frame.raw32(String(core.reviewedOperationDigest)),
    frame.raw32(String(core.successorHelperDigest)),
    frame.raw32(String(core.successorHelperProfileDigest)),
    frame.raw32(String(core.abiDigest)),
    frame.raw32(String(core.lockProfileDigest)),
    frame.raw32(String(core.stateComponentProfileDigest)),
    frame.raw32(String(core.custodyInstanceDigest)),
    frame.raw32(String(core.admittedCustodyObservationDigest)),
    frame.canonical(core),
  ]);
}

export function parseGenesisBootstrapInput(input: unknown): ParseResult {
  const parsed = schemaRecord(
    input,
    genesisBootstrapInputFields,
    "authority-history-genesis-bootstrap-input/v1",
  );
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    genesisBootstrapInputFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isUuidV7(parsed.value.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeGenesisBootstrapInputDigest(input: unknown): string {
  const record = parsedOrThrow(parseGenesisBootstrapInput(input));
  return framedDigest("authority-history-genesis-bootstrap-input/v1", [
    frame.raw32(String(record.destinationDigest)),
    frame.raw32(String(record.destinationOwnerActiveTipDigest)),
    frame.raw32(String(record.destinationOwnerActiveValueDigest)),
    frame.raw32(String(record.destinationOwnerActiveReceiptDigest)),
    frame.raw32(String(record.bootstrapAnchorDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveTipDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveValueDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveReceiptDigest)),
    frame.raw32(String(record.useIntentDigest)),
    frame.raw32(String(record.globalBootstrapIdentityDigest)),
    frame.text(String(record.bootstrapTransactionId)),
    frame.raw32(String(record.bootstrapGrantDigest)),
    frame.raw32(String(record.successorCoreDigest)),
    frame.canonical(record),
  ]);
}

export function parseGenesisSelectionEvidence(input: unknown): ParseResult {
  const parsed = schemaRecord(
    input,
    genesisSelectionEvidenceFields,
    "authority-history-genesis-selection-evidence/v1",
  );
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    genesisSelectionEvidenceFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isUuidV7(parsed.value.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeGenesisSelectionEvidenceDigest(input: unknown): string {
  const record = parsedOrThrow(parseGenesisSelectionEvidence(input));
  return framedDigest("authority-history-genesis-selection-evidence/v1", [
    frame.raw32(String(record.genesisBootstrapInputDigest)),
    frame.raw32(String(record.historyRecordDigest)),
    frame.raw32(String(record.successorCoreDigest)),
    frame.raw32(String(record.bootstrapGenesisCoreDigest)),
    frame.raw32(String(record.destinationDigest)),
    frame.raw32(String(record.destinationOwnerActiveTipDigest)),
    frame.raw32(String(record.destinationOwnerActiveValueDigest)),
    frame.raw32(String(record.destinationOwnerActiveReceiptDigest)),
    frame.raw32(String(record.bootstrapAnchorDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveTipDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveValueDigest)),
    frame.raw32(String(record.bootstrapAnchorActiveReceiptDigest)),
    frame.raw32(String(record.useIntentDigest)),
    frame.raw32(String(record.globalBootstrapIdentityDigest)),
    frame.text(String(record.bootstrapTransactionId)),
    frame.raw32(String(record.bootstrapGrantDigest)),
    frame.raw32(String(record.selectedAuthorityPathInstanceDigest)),
    frame.raw32(String(record.selectedAuthorityTipDigest)),
    frame.raw32(String(record.selectedAuthorityValueDigest)),
    frame.raw32(String(record.selectedAuthorityReceiptDigest)),
    frame.raw32(String(record.selectedAuthorityValueReadbackDigest)),
    frame.raw32(String(record.selectedAuthorityProposalReadbackDigest)),
    frame.raw32(String(record.selectedAuthorityTipReadbackDigest)),
    frame.raw32(String(record.selectionPostReceiptDigest)),
    frame.raw32(String(record.anchorConsumedTipDigest)),
    frame.raw32(String(record.anchorConsumedValueDigest)),
    frame.raw32(String(record.anchorConsumedReceiptDigest)),
    frame.raw32(String(record.ownerConsumedTipDigest)),
    frame.raw32(String(record.ownerConsumedValueDigest)),
    frame.raw32(String(record.ownerConsumedReceiptDigest)),
    frame.raw32(String(record.anchorConsumptionReceiptDigest)),
    frame.raw32(String(record.anchorConsumedValueReadbackDigest)),
    frame.raw32(String(record.anchorConsumedProposalReadbackDigest)),
    frame.raw32(String(record.anchorConsumedTipReadbackDigest)),
    frame.raw32(String(record.ownerConsumedValueReadbackDigest)),
    frame.raw32(String(record.ownerConsumedProposalReadbackDigest)),
    frame.raw32(String(record.ownerConsumedTipReadbackDigest)),
    frame.canonical(record),
  ]);
}

export function parseRotationInput(input: unknown): ParseResult {
  const parsed = schemaRecord(
    input,
    rotationInputFields,
    "state-mutation-authority-rotation-id/v1",
  );
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    rotationInputFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isUuidV7(parsed.value.rotationTransactionId)) issues.push("rotationTransactionId:invalid");
  if (!isCanonicalDecimal(parsed.value.priorHeadOrdinal)) issues.push("priorHeadOrdinal:invalid");
  if (!isCanonicalDecimal(parsed.value.successorAuthorityOrdinal))
    issues.push("successorAuthorityOrdinal:invalid");
  if (
    isCanonicalDecimal(parsed.value.priorHeadOrdinal) &&
    isCanonicalDecimal(parsed.value.successorAuthorityOrdinal) &&
    !isNextDecimal(
      String(parsed.value.priorHeadOrdinal),
      String(parsed.value.successorAuthorityOrdinal),
    )
  )
    issues.push("successorAuthorityOrdinal:not-next");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeRotationInputDigest(input: unknown): string {
  const record = parsedOrThrow(parseRotationInput(input));
  return framedDigest("state-mutation-authority-rotation-id/v1", [
    frame.raw32(String(record.globalIdentityDigest)),
    frame.text(String(record.rotationTransactionId)),
    frame.raw32(String(record.retiringAuthorityPathInstanceDigest)),
    frame.raw32(String(record.retiringAuthorityTipDigest)),
    frame.raw32(String(record.retiringAuthorityValueDigest)),
    frame.raw32(String(record.retiringAuthorityReceiptDigest)),
    frame.boundedDecimal(String(record.priorHeadOrdinal)),
    frame.raw32(String(record.priorRecordDigest)),
    frame.boundedDecimal(String(record.successorAuthorityOrdinal)),
    frame.raw32(String(record.reviewedOperationDigest)),
    frame.raw32(String(record.successorCoreDigest)),
  ]);
}

export function parseAuthorityHistoryRecord(input: unknown): ParseResult {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot as ParseResult;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const detached = snapshot.value as ContractRecord;
  const fields =
    detached.recordKind === "GENESIS"
      ? genesisRecordFields
      : detached.recordKind === "ROTATION"
        ? rotationRecordFields
        : null;
  if (!fields) return invalid("recordKind:invalid");
  const parsed = schemaRecord(detached, fields, "authority-history-record/v1");
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    fields.filter((field) => field.endsWith("Digest")),
  );
  if (detached.recordKind === "GENESIS") {
    if (detached.ordinal !== "0") issues.push("ordinal:genesis-not-zero");
    if (detached.predecessorKind !== "GENESIS_LITERAL") issues.push("predecessorKind:invalid");
  } else {
    if (!isCanonicalDecimal(detached.ordinal) || detached.ordinal === "0")
      issues.push("ordinal:rotation-not-positive");
    if (!isCanonicalDecimal(detached.priorHeadOrdinal)) issues.push("priorHeadOrdinal:invalid");
    if (detached.predecessorKind !== "RECORD") issues.push("predecessorKind:invalid");
    if (
      isCanonicalDecimal(detached.priorHeadOrdinal) &&
      isCanonicalDecimal(detached.ordinal) &&
      !isNextDecimal(String(detached.priorHeadOrdinal), String(detached.ordinal))
    )
      issues.push("priorHeadOrdinal:not-predecessor");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeAuthorityHistoryRecordDigest(input: unknown): string {
  const record = parsedOrThrow(parseAuthorityHistoryRecord(input));
  if (record.recordKind === "GENESIS") {
    return framedDigest("authority-history/v1", [
      frame.fixed("00"),
      frame.raw32(String(record.globalIdentityDigest)),
      frame.boundedDecimal("0"),
      frame.text("GENESIS_LITERAL"),
      frame.raw32(String(record.genesisBootstrapInputDigest)),
      frame.raw32(String(record.successorCoreDigest)),
      frame.canonical(record),
    ]);
  }
  return framedDigest("authority-history/v1", [
    frame.fixed("01"),
    frame.raw32(String(record.globalIdentityDigest)),
    frame.boundedDecimal(String(record.ordinal)),
    frame.boundedDecimal(String(record.priorHeadOrdinal)),
    frame.raw32(String(record.priorRecordDigest)),
    frame.raw32(String(record.retiringAuthorityPathInstanceDigest)),
    frame.raw32(String(record.retiringAuthorityTipDigest)),
    frame.raw32(String(record.retiringAuthorityValueDigest)),
    frame.raw32(String(record.retiringAuthorityReceiptDigest)),
    frame.raw32(String(record.rotationInputDigest)),
    frame.raw32(String(record.successorCoreDigest)),
    frame.canonical(record),
  ]);
}

export function authorityHistoryRecordPath(ordinal: unknown): string {
  if (typeof ordinal !== "string" || !isCanonicalDecimal(ordinal))
    throw new TypeError("ordinal:invalid");
  return `installation/state-mutation-authority-history/records/${String(ordinal)}.json`;
}

export function parseStateMutationAuthorityValue(input: unknown): ParseResult {
  const parsed = schemaRecord(input, authorityValueFields, "state-mutation-authority-value/v1");
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    authorityValueFields.filter(
      (field) => field.endsWith("Digest") && !field.startsWith("priorAuthority"),
    ),
  );
  if (!isUuidV7(parsed.value.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(parsed.value.projectId)) issues.push("projectId:invalid");
  if (!isCanonicalDecimal(parsed.value.authorityOrdinal)) issues.push("authorityOrdinal:invalid");
  if (!isCanonicalDecimal(parsed.value.headOrdinal)) issues.push("headOrdinal:invalid");
  if (parsed.value.authorityOrdinal !== parsed.value.headOrdinal)
    issues.push("headOrdinal:authority-mismatch");
  const prior = [
    parsed.value.priorAuthorityTipDigest,
    parsed.value.priorAuthorityValueDigest,
    parsed.value.priorAuthorityReceiptDigest,
  ];
  const genesis = prior.every((value) => value === null);
  const rotation = prior.every((value) => isSha256(value));
  if (!genesis && !rotation) issues.push("priorAuthority:partial");
  if (genesis && parsed.value.authorityOrdinal !== "0") issues.push("priorAuthority:missing");
  if (rotation && parsed.value.authorityOrdinal === "0") issues.push("priorAuthority:unexpected");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseAuthorityHistoryBinding(input: unknown): ParseResult {
  const parsed = schemaRecord(input, authorityHistoryBindingFields, "authority-history-binding/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const records = snapshotClosedArray(record.records);
  const genesisSelection = parseGenesisSelectionEvidence(record.genesisSelectionEvidence);
  const issues: string[] = [];
  if (!isSha256(record.globalIdentityDigest)) issues.push("globalIdentityDigest:invalid");
  if (!isCanonicalDecimal(record.headOrdinal)) issues.push("headOrdinal:invalid");
  if (!isSha256(record.headRecordDigest)) issues.push("headRecordDigest:invalid");
  if (!records.ok) issues.push(...records.issues.map((issue) => `records:${issue}`));
  if (!genesisSelection.ok)
    issues.push(...genesisSelection.issues.map((issue) => `genesisSelectionEvidence:${issue}`));
  if (!records.ok || !genesisSelection.ok) return invalid(...issues);
  if (records.value.length === 0) return invalid(...issues, "records:empty");

  let priorDigest: string | null = null;
  let genesis: ContractRecord | null = null;
  for (let index = 0; index < records.value.length; index += 1) {
    const current = parseAuthorityHistoryRecord(records.value[index]);
    if (!current.ok) {
      issues.push(...current.issues.map((issue) => `records:${index}:${issue}`));
      continue;
    }
    const historyRecord = current.value;
    if (historyRecord.ordinal !== String(index)) issues.push(`records:${index}:ordinal`);
    if (historyRecord.globalIdentityDigest !== record.globalIdentityDigest)
      issues.push(`records:${index}:globalIdentityDigest`);
    if (index === 0) {
      genesis = historyRecord;
      if (historyRecord.recordKind !== "GENESIS") issues.push("records:0:not-genesis");
    } else if (historyRecord.priorRecordDigest !== priorDigest) {
      issues.push(`records:${index}:priorRecordDigest`);
    }
    priorDigest = computeAuthorityHistoryRecordDigest(historyRecord);
  }
  const finalOrdinal = String(records.value.length - 1);
  if (record.headOrdinal !== finalOrdinal) issues.push("headOrdinal:records-length-mismatch");
  if (record.headRecordDigest !== priorDigest) issues.push("headRecordDigest:mismatch");
  if (genesis !== null && genesis.recordKind === "GENESIS") {
    const genesisDigest = computeAuthorityHistoryRecordDigest(genesis);
    if (genesisSelection.value.genesisBootstrapInputDigest !== genesis.genesisBootstrapInputDigest)
      issues.push("genesisSelectionEvidence:genesisBootstrapInputDigest:mismatch");
    if (genesisSelection.value.historyRecordDigest !== genesisDigest)
      issues.push("genesisSelectionEvidence:historyRecordDigest:mismatch");
    if (genesisSelection.value.successorCoreDigest !== genesis.successorCoreDigest)
      issues.push("genesisSelectionEvidence:successorCoreDigest:mismatch");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeAuthorityHistoryBindingDigest(input: unknown): string {
  const record = parsedOrThrow(parseAuthorityHistoryBinding(input));
  const records = snapshotClosedArray(record.records);
  if (!records.ok) throw new TypeError(records.issues.join(","));
  return framedDigest("authority-history-binding/v1", [
    frame.raw32(String(record.globalIdentityDigest)),
    frame.boundedDecimal(String(record.headOrdinal)),
    frame.raw32(String(record.headRecordDigest)),
    ...records.value.map((historyRecord) =>
      frame.raw32(computeAuthorityHistoryRecordDigest(historyRecord)),
    ),
    frame.raw32(computeGenesisSelectionEvidenceDigest(record.genesisSelectionEvidence)),
    frame.canonical(record),
  ]);
}

export function parseSimplifiedAuthorityContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  switch (expectedSchemaVersion) {
    case "authority-history-binding/v1":
      return parseAuthorityHistoryBinding(input);
    case "authority-history-genesis-bootstrap-input/v1":
      return parseGenesisBootstrapInput(input);
    case "authority-history-genesis-selection-evidence/v1":
      return parseGenesisSelectionEvidence(input);
    case "authority-history-record/v1":
      return parseAuthorityHistoryRecord(input);
    case "reviewed-authority-operation/v1":
      return parseReviewedAuthorityOperation(input);
    case "state-mutation-authority-rotation-id/v1":
      return parseRotationInput(input);
    case "state-mutation-authority-value/v1":
      return parseStateMutationAuthorityValue(input);
    case "state-mutation-successor-authority-core/v1":
      return parseSuccessorAuthorityCore(input);
    default:
      return undefined;
  }
}

export function validateAuthorityHistoryChain(
  recordsInput: unknown,
  selectedAuthorityValueInput: unknown,
): readonly string[] {
  const records = snapshotClosedArray(recordsInput);
  const selected = parseStateMutationAuthorityValue(selectedAuthorityValueInput);
  if (!records.ok || !selected.ok)
    return Object.freeze([
      ...(!records.ok ? records.issues.map((issue) => `records:${issue}`) : []),
      ...(!selected.ok ? selected.issues.map((issue) => `selected:${issue}`) : []),
    ]);
  if (records.value.length === 0) return ["records:empty"];
  const issues: string[] = [];
  let priorDigest: string | null = null;
  let globalIdentityDigest: string | null = null;
  for (let index = 0; index < records.value.length; index += 1) {
    const parsed = parseAuthorityHistoryRecord(records.value[index]);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `records:${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    if (record.ordinal !== String(index)) issues.push(`records:${index}:ordinal`);
    if (index === 0) {
      globalIdentityDigest = String(record.globalIdentityDigest);
    } else {
      if (record.priorRecordDigest !== priorDigest)
        issues.push(`records:${index}:priorRecordDigest`);
      if (record.globalIdentityDigest !== globalIdentityDigest)
        issues.push(`records:${index}:globalIdentityDigest`);
    }
    priorDigest = computeAuthorityHistoryRecordDigest(record);
  }
  const finalOrdinal = String(records.value.length - 1);
  if (selected.value.headOrdinal !== finalOrdinal) issues.push("selected:headOrdinal");
  if (selected.value.headRecordDigest !== priorDigest) issues.push("selected:headRecordDigest");
  if (selected.value.globalIdentityDigest !== globalIdentityDigest)
    issues.push("selected:globalIdentityDigest");
  return Object.freeze(issues);
}

export interface ArmedRotationExpectation {
  readonly expectedRecordDigest: string;
  readonly retiringAuthorityPathInstanceDigest: string;
  readonly retiringAuthorityReceiptDigest: string;
  readonly retiringAuthorityTipDigest: string;
  readonly retiringAuthorityValueDigest: string;
  readonly rotationInputDigest: string;
  readonly successorCoreDigest: string;
}

export function validateAuthorityHistoryWalk(input: unknown): readonly string[] {
  const envelope = snapshotClosedRecord(input, [
    "armedRotation",
    "headPlusOne",
    "headPlusTwoExists",
    "records",
    "selectedAuthorityValue",
  ]);
  if (!envelope.ok) return envelope.issues;
  const value = envelope.value;
  if (typeof value.headPlusTwoExists !== "boolean") return ["headPlusTwoExists:invalid"];
  let armed: ContractRecord | null = null;
  if (value.armedRotation !== null) {
    const parsedArmed = snapshotClosedRecord(value.armedRotation, [
      "expectedRecordDigest",
      "retiringAuthorityPathInstanceDigest",
      "retiringAuthorityReceiptDigest",
      "retiringAuthorityTipDigest",
      "retiringAuthorityValueDigest",
      "rotationInputDigest",
      "successorCoreDigest",
    ]);
    if (!parsedArmed.ok) return parsedArmed.issues.map((issue) => `armedRotation:${issue}`);
    const invalidDigest = Object.entries(parsedArmed.value).find(([, item]) => !isSha256(item));
    if (invalidDigest) return [`armedRotation:${invalidDigest[0]}:invalid`];
    armed = parsedArmed.value;
  }
  const issues = [...validateAuthorityHistoryChain(value.records, value.selectedAuthorityValue)];
  const records = snapshotClosedArray(value.records);
  const selected = parseStateMutationAuthorityValue(value.selectedAuthorityValue);
  if (!records.ok || !selected.ok || records.value.length === 0) return Object.freeze(issues);
  if (value.headPlusTwoExists) issues.push("headPlusTwo:must-be-absent");
  if (value.headPlusOne === null) return Object.freeze(issues);
  if (armed === null) {
    issues.push("headPlusOne:unarmed");
    return Object.freeze(issues);
  }
  const pending = parseAuthorityHistoryRecord(value.headPlusOne);
  if (!pending.ok) {
    issues.push(...pending.issues.map((issue) => `headPlusOne:${issue}`));
    return Object.freeze(issues);
  }
  const record = pending.value;
  if (record.recordKind !== "ROTATION") issues.push("headPlusOne:not-rotation");
  let expectedOrdinal: string | undefined;
  try {
    expectedOrdinal = incrementCanonicalDecimal(String(selected.value.headOrdinal));
  } catch {
    issues.push("headPlusOne:ordinal-overflow");
  }
  if (record.ordinal !== expectedOrdinal) issues.push("headPlusOne:ordinal");
  if (record.priorHeadOrdinal !== selected.value.headOrdinal)
    issues.push("headPlusOne:priorHeadOrdinal");
  if (record.priorRecordDigest !== selected.value.headRecordDigest)
    issues.push("headPlusOne:priorRecordDigest");
  for (const field of [
    "retiringAuthorityPathInstanceDigest",
    "retiringAuthorityReceiptDigest",
    "retiringAuthorityTipDigest",
    "retiringAuthorityValueDigest",
    "rotationInputDigest",
    "successorCoreDigest",
  ] as const) {
    if (record[field] !== armed[field]) issues.push(`headPlusOne:${field}`);
  }
  if (computeAuthorityHistoryRecordDigest(record) !== armed.expectedRecordDigest)
    issues.push("headPlusOne:recordDigest");
  return Object.freeze(issues);
}

export function authorityHistoryRecordDigestForReadback(input: unknown): string {
  return canonicalDigest(parsedOrThrow(parseAuthorityHistoryRecord(input)));
}

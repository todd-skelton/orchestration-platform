import { isUuidV7, type ContractDefinition, type ContractRecord } from "./runtime.js";
import { simplifiedAuthoritySchemaFields, simplifiedAuthoritySchemaVersions } from "./authority.js";
import { pointerGraphSchemaFields, pointerGraphSchemaVersions } from "./pointer.js";

const platformConfiguration: ContractDefinition = Object.freeze({
  schemaVersion: "platform-configuration/v1",
  fields: Object.freeze([
    "schemaVersion",
    "adapterId",
    "capabilityNames",
    "leaseFreshnessMs",
    "maximumSessionMs",
    "projectId",
    "stateRoot",
    "wallClockSkewMs",
  ]),
  validate(record: ContractRecord): readonly string[] {
    const issues: string[] = [];
    if (
      typeof record.adapterId !== "string" ||
      !/^[a-z0-9][a-z0-9._:@+-]{0,127}$/.test(record.adapterId)
    )
      issues.push("adapterId:invalid");
    if (
      !Array.isArray(record.capabilityNames) ||
      record.capabilityNames.some((item) => typeof item !== "string")
    )
      issues.push("capabilityNames:invalid");
    if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
    if (typeof record.stateRoot !== "string" || !record.stateRoot.startsWith("file:///"))
      issues.push("stateRoot:invalid");
    for (const name of ["leaseFreshnessMs", "maximumSessionMs", "wallClockSkewMs"] as const)
      if (
        typeof record[name] !== "number" ||
        !Number.isSafeInteger(record[name]) ||
        Number(record[name]) < 0
      )
        issues.push(`${name}:invalid`);
    if (
      Number(record.leaseFreshnessMs) <= 0 ||
      Number(record.leaseFreshnessMs) > Number(record.maximumSessionMs)
    )
      issues.push("leaseFreshnessMs:out-of-range");
    if (Number(record.maximumSessionMs) <= 0 || Number(record.maximumSessionMs) > 86_400_000)
      issues.push("maximumSessionMs:out-of-range");
    if (Number(record.wallClockSkewMs) > 300_000) issues.push("wallClockSkewMs:out-of-range");
    return Object.freeze(issues);
  },
});

export const schemaDefinitions: Readonly<Record<string, ContractDefinition>> = Object.freeze({
  [platformConfiguration.schemaVersion]: platformConfiguration,
});
export const schemaVocabularyDefinitions: Readonly<Record<string, ContractDefinition>> =
  Object.freeze({
    ...schemaDefinitions,
    "reviewed-authority-operation/v1#BOOTSTRAP_INSTALL": Object.freeze({
      schemaVersion: "reviewed-authority-operation/v1",
      fields: simplifiedAuthoritySchemaFields.reviewedAuthorityOperationBootstrap,
      closedValues: Object.freeze(["BOOTSTRAP_INSTALL"]),
    }),
    "reviewed-authority-operation/v1#STABLE_PROMOTION": Object.freeze({
      schemaVersion: "reviewed-authority-operation/v1",
      fields: simplifiedAuthoritySchemaFields.reviewedAuthorityOperationPromotion,
      closedValues: Object.freeze(["STABLE_PROMOTION"]),
    }),
    "state-mutation-successor-authority-core/v1": Object.freeze({
      schemaVersion: "state-mutation-successor-authority-core/v1",
      fields: simplifiedAuthoritySchemaFields.successorAuthorityCore,
      closedValues: Object.freeze(["BOOTSTRAP_INSTALL", "STABLE_PROMOTION"]),
    }),
    "authority-history-genesis-bootstrap-input/v1": Object.freeze({
      schemaVersion: "authority-history-genesis-bootstrap-input/v1",
      fields: simplifiedAuthoritySchemaFields.genesisBootstrapInput,
    }),
    "authority-history-genesis-selection-evidence/v1": Object.freeze({
      schemaVersion: "authority-history-genesis-selection-evidence/v1",
      fields: simplifiedAuthoritySchemaFields.genesisSelectionEvidence,
    }),
    "state-mutation-authority-rotation-id/v1": Object.freeze({
      schemaVersion: "state-mutation-authority-rotation-id/v1",
      fields: simplifiedAuthoritySchemaFields.rotationInput,
    }),
    "authority-history-record/v1#GENESIS": Object.freeze({
      schemaVersion: "authority-history-record/v1",
      fields: simplifiedAuthoritySchemaFields.historyGenesis,
      closedValues: Object.freeze(["GENESIS", "GENESIS_LITERAL"]),
    }),
    "authority-history-record/v1#ROTATION": Object.freeze({
      schemaVersion: "authority-history-record/v1",
      fields: simplifiedAuthoritySchemaFields.historyRotation,
      closedValues: Object.freeze(["ROTATION", "RECORD"]),
    }),
    "state-mutation-authority-value/v1": Object.freeze({
      schemaVersion: "state-mutation-authority-value/v1",
      fields: simplifiedAuthoritySchemaFields.selectedAuthorityValue,
    }),
    "pointer-cas-proposal-receipt/v1": Object.freeze({
      schemaVersion: "pointer-cas-proposal-receipt/v1",
      fields: pointerGraphSchemaFields.proposal,
      closedValues: Object.freeze([
        "VALUE_PROPOSED",
        "TOMBSTONE_PROPOSED",
        "SELECT",
        "REMOVE",
        "REVIEWED_BOOTSTRAP_GENESIS",
        "SELECTED_EPOCH",
      ]),
    }),
    "pointer-conflict-receipt/v1": Object.freeze({
      schemaVersion: "pointer-conflict-receipt/v1",
      fields: pointerGraphSchemaFields.conflict,
      closedValues: Object.freeze(["VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"]),
    }),
    "pointer-current-tip/v1": Object.freeze({
      schemaVersion: "pointer-current-tip/v1",
      fields: pointerGraphSchemaFields.currentTip,
    }),
  });
export const schemaVersions = Object.freeze(
  [
    ...Object.keys(schemaDefinitions),
    ...pointerGraphSchemaVersions,
    ...simplifiedAuthoritySchemaVersions,
  ].sort(),
);
export type CompatibilityDisposition = "readable" | "refused";
export function compatibilityDisposition(
  expectedSchemaVersion: string,
  observedSchemaVersion: string | null,
): CompatibilityDisposition {
  if (!schemaVersions.includes(expectedSchemaVersion)) return "refused";
  if (observedSchemaVersion === expectedSchemaVersion) return "readable";
  return "refused";
}

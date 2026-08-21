import { isUuidV7, type ContractDefinition, type ContractRecord } from "./runtime.js";
import { simplifiedAuthoritySchemaFields, simplifiedAuthoritySchemaVersions } from "./authority.js";
import {
  commitRunPhases,
  commitRunStages,
  commitSchemaFields,
  commitSchemaVersions,
} from "./commit.js";
import {
  dispatchDirectiveKinds,
  dispatchPlanAccessors,
  dispatchResourceAccess,
  dispatchRoles,
  dispatchSchemaFields,
  dispatchSchemaVersions,
} from "./dispatch.js";
import {
  evidenceSchemaFields,
  evidenceSchemaVersions,
  unknownEvidenceReasons,
} from "./evidence.js";
import { pointerGraphSchemaFields, pointerGraphSchemaVersions, pointerKinds } from "./pointer.js";
import { packetSchemaFields, packetSchemaVersions } from "./packet.js";
import { externalSchemaFields, externalSchemaVersions } from "./external.js";
import { destinationOwnerSchemaFields, destinationOwnerSchemaVersions } from "./owner.js";
import { successorReviewSchemaFields, successorReviewSchemaVersions } from "./successor.js";
import { bootstrapAnchorSchemaFields, bootstrapAnchorSchemaVersions } from "./anchor.js";
import { bootstrapUseIntentSchemaFields, bootstrapUseIntentSchemaVersions } from "./intent.js";
import {
  bootstrapAnchorTeardownSchemaFields,
  bootstrapAnchorTeardownSchemaVersions,
} from "./teardown.js";
import { bootstrapGenesisSchemaFields, bootstrapGenesisSchemaVersions } from "./genesis.js";
import {
  bootstrapConsumptionSchemaFields,
  bootstrapConsumptionSchemaVersions,
} from "./consumption.js";
import { gateFenceSchemaFields, gateFenceSchemaVersions } from "./definitions.js";

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
    "physical-destination-identity/v1": Object.freeze({
      schemaVersion: "physical-destination-identity/v1",
      fields: externalSchemaFields.physicalIdentity,
      closedValues: Object.freeze([
        "DARWIN",
        "LINUX",
        "WINDOWS",
        "EXISTING_DIRECTORY_ENTRY",
        "ABSENT_DIRECTORY_ENTRY",
      ]),
    }),
    "physical-destination-locator-observation-receipt/v1": Object.freeze({
      schemaVersion: "physical-destination-locator-observation-receipt/v1",
      fields: externalSchemaFields.locatorObservation,
      closedValues: Object.freeze([
        "CASE_INSENSITIVE_LOWERCASE",
        "CASE_SENSITIVE",
        "NFC",
        "NFD",
        "ADMITTED",
        "UNSUPPORTED",
        "UNKNOWN",
      ]),
    }),
    "external-destination-absence-observation/v1": Object.freeze({
      schemaVersion: "external-destination-absence-observation/v1",
      fields: externalSchemaFields.absenceObservation,
      closedValues: Object.freeze(["RUNTIME_AUTHORITY_ABSENT", "DESTINATION_STATE_ROOT_ABSENT"]),
    }),
    "state-mutation-destination-owner-value/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-value/v1",
      fields: destinationOwnerSchemaFields.value,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"]),
    }),
    "state-mutation-destination-owner-cas-proposal/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
      fields: destinationOwnerSchemaFields.proposal,
      closedValues: Object.freeze([
        "BOOTSTRAP_GENESIS",
        "ANCHOR_CONSUMED",
        "ANCHOR_RETIRED",
        "SUCCESSOR_REVIEW",
        "ACTIVATE_GENESIS",
        "CONSUME",
        "RETIRE_UNUSED",
        "RETIRE_CONSUMED",
        "ACTIVATE_SUCCESSOR",
      ]),
    }),
    "state-mutation-destination-owner-current-tip/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-current-tip/v1",
      fields: destinationOwnerSchemaFields.tip,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-conflict-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-conflict-receipt/v1",
      fields: destinationOwnerSchemaFields.conflict,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-teardown-archive/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
      fields: destinationOwnerSchemaFields.archive,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-prior-installation/v1": Object.freeze({
      schemaVersion: "destination-owner-prior-installation/v1",
      fields: successorReviewSchemaFields.priorInstallation,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-successor-authority/v1": Object.freeze({
      schemaVersion: "destination-owner-successor-authority/v1",
      fields: successorReviewSchemaFields.successorAuthority,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-independent-review/v1": Object.freeze({
      schemaVersion: "destination-owner-independent-review/v1",
      fields: successorReviewSchemaFields.independentReview,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-successor-review-core/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-successor-review-core/v1",
      fields: successorReviewSchemaFields.reviewCore,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-successor-review-post-selection-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
      fields: successorReviewSchemaFields.postSelection,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor/v1",
      fields: bootstrapAnchorSchemaFields.anchor,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-lifecycle-value/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
      fields: bootstrapAnchorSchemaFields.value,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"]),
    }),
    "state-mutation-bootstrap-anchor-cas-proposal/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
      fields: bootstrapAnchorSchemaFields.proposal,
      closedValues: Object.freeze([
        "BOOTSTRAP_CREATE",
        "E0_SELECTION",
        "TEARDOWN",
        "ACTIVATE",
        "CONSUME",
        "RETIRE_UNUSED",
        "RETIRE_CONSUMED",
      ]),
    }),
    "state-mutation-bootstrap-anchor-current-tip/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
      fields: bootstrapAnchorSchemaFields.tip,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-conflict-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-conflict-receipt/v1",
      fields: bootstrapAnchorSchemaFields.conflict,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-proposed-genesis-input/v1": Object.freeze({
      schemaVersion: "bootstrap-proposed-genesis-input/v1",
      fields: bootstrapUseIntentSchemaFields.proposedGenesis,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-reviewed-installer/v1": Object.freeze({
      schemaVersion: "bootstrap-reviewed-installer/v1",
      fields: bootstrapUseIntentSchemaFields.reviewedInstaller,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-reviewed-helper/v1": Object.freeze({
      schemaVersion: "bootstrap-reviewed-helper/v1",
      fields: bootstrapUseIntentSchemaFields.reviewedHelper,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-use-intent/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-use-intent/v1",
      fields: bootstrapUseIntentSchemaFields.useIntent,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-lifecycle-archive/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
      fields: bootstrapAnchorTeardownSchemaFields.lifecycleArchive,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED"]),
    }),
    "state-mutation-bootstrap-anchor-teardown-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-teardown-receipt/v1",
      fields: bootstrapAnchorTeardownSchemaFields.teardownReceipt,
      closedValues: Object.freeze(["RETIRE_UNUSED", "RETIRE_CONSUMED"]),
    }),
    "state-mutation-bootstrap-genesis-core/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-genesis-core/v1",
      fields: bootstrapGenesisSchemaFields.core,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-genesis-post-selection-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
      fields: bootstrapGenesisSchemaFields.post,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-consumption-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-consumption-receipt/v1",
      fields: bootstrapConsumptionSchemaFields.receipt,
    }),
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
    "authority-history-binding/v1": Object.freeze({
      schemaVersion: "authority-history-binding/v1",
      fields: simplifiedAuthoritySchemaFields.authorityHistoryBinding,
      closedValues: Object.freeze(["GENESIS", "ROTATION", "GENESIS_LITERAL", "RECORD"]),
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
    "pointer-mutation-run-checkpoint-core/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-checkpoint-core/v1",
      fields: commitSchemaFields.checkpointCore,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-commit-evidence/v1#ORDINARY": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceOrdinary,
      closedValues: Object.freeze([
        "ORDINARY",
        "KNOWN",
        "SELECTED",
        "LOST_CONFLICT",
        "UNKNOWN_TERMINAL",
        ...pointerKinds,
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#RESUMABLE": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationResumable,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "KNOWN",
        "RESUMABLE",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#SELECTED": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationSelected,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "KNOWN",
        "SELECTED",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#UNKNOWN": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationUnknown,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "UNKNOWN",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-run-checkpoint-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-checkpoint-evidence/v1",
      fields: commitSchemaFields.checkpointEvidence,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-commit-resolution/v1": Object.freeze({
      schemaVersion: "pointer-mutation-commit-resolution/v1",
      fields: commitSchemaFields.commitResolution,
      closedValues: Object.freeze(["SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"]),
    }),
    "pointer-mutation-run-current-value/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-current-value/v1",
      fields: commitSchemaFields.runCurrentValue,
      closedValues: Object.freeze([...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-run-intent/v1#ORDINARY": Object.freeze({
      schemaVersion: "pointer-mutation-run-intent/v1",
      fields: commitSchemaFields.runIntentOrdinary,
      closedValues: Object.freeze(["ORDINARY", "SINGLE_EPOCH", ...pointerKinds]),
    }),
    "pointer-mutation-run-intent/v1#AUTHORITY_ROTATION": Object.freeze({
      schemaVersion: "pointer-mutation-run-intent/v1",
      fields: commitSchemaFields.runIntentRotation,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "SINGLE_EPOCH",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-run-segment/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-segment/v1",
      fields: commitSchemaFields.runSegment,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages]),
    }),
    "pointer-mutation-run-selector-post-selection-observation/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-selector-post-selection-observation/v1",
      fields: commitSchemaFields.postSelectionObservation,
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
    "active-release/v1": Object.freeze({
      schemaVersion: "active-release/v1",
      fields: pointerGraphSchemaFields.activeRelease,
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
    "pointer-tombstone-value/v1": Object.freeze({
      schemaVersion: "pointer-tombstone-value/v1",
      fields: pointerGraphSchemaFields.tombstone,
      closedValues: pointerKinds.filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION"),
    }),
    "activation-cleanup-gate-root/v1": Object.freeze({
      schemaVersion: "activation-cleanup-gate-root/v1",
      fields: gateFenceSchemaFields.cleanupGateRoot,
      closedValues: Object.freeze(["BOOTSTRAP", "SUCCESSOR"]),
    }),
    "activation-cleanup-gate-head/v1": Object.freeze({
      schemaVersion: "activation-cleanup-gate-head/v1",
      fields: gateFenceSchemaFields.cleanupGateHead,
      closedValues: Object.freeze([
        "PENDING",
        "ACTIVATING",
        "ABORTING",
        "COMPLETE",
        "NOT_PUBLISHED",
        "PUBLISHING",
        "PUBLISHED",
        "CLEARED",
      ]),
    }),
    "activation-recovery-fence-root/v1": Object.freeze({
      schemaVersion: "activation-recovery-fence-root/v1",
      fields: gateFenceSchemaFields.recoveryFenceRoot,
    }),
    "activation-recovery-fence-head/v1": Object.freeze({
      schemaVersion: "activation-recovery-fence-head/v1",
      fields: gateFenceSchemaFields.recoveryFenceHead,
      closedValues: Object.freeze(["PREPARED", "POST_ACTIVATION"]),
    }),
    "dispatch-action-core/v1": Object.freeze({
      schemaVersion: "dispatch-action-core/v1",
      fields: dispatchSchemaFields.actionCore,
      closedValues: dispatchRoles,
    }),
    "dispatch-brief-action/v1": Object.freeze({
      schemaVersion: "dispatch-brief-action/v1",
      fields: dispatchSchemaFields.briefAction,
    }),
    "dispatch-brief-directive/v1": Object.freeze({
      schemaVersion: "dispatch-brief-directive/v1",
      fields: dispatchSchemaFields.directive,
      closedValues: Object.freeze([...dispatchDirectiveKinds, "PRESENT", "ABSENT"]),
    }),
    "dispatch-brief-resource/v1": Object.freeze({
      schemaVersion: "dispatch-brief-resource/v1",
      fields: dispatchSchemaFields.resource,
      closedValues: dispatchResourceAccess,
    }),
    "dispatch-brief/v1": Object.freeze({
      schemaVersion: "dispatch-brief/v1",
      fields: dispatchSchemaFields.brief,
      closedValues: dispatchRoles,
    }),
    "dispatch-catalog-entry/v1#nested": Object.freeze({
      schemaVersion: "dispatch-catalog-entry/v1",
      fields: dispatchSchemaFields.catalog,
      closedValues: Object.freeze([...dispatchDirectiveKinds, ...dispatchPlanAccessors]),
    }),
    "worker-host-identity/v1": Object.freeze({
      schemaVersion: "worker-host-identity/v1",
      fields: dispatchSchemaFields.hostIdentity,
    }),
    "worker-host-renderer-artifact/v1": Object.freeze({
      schemaVersion: "worker-host-renderer-artifact/v1",
      fields: dispatchSchemaFields.hostArtifact,
    }),
    "state-mutation-global-identity/v1": Object.freeze({
      schemaVersion: "state-mutation-global-identity/v1",
      fields: evidenceSchemaFields.globalIdentity,
    }),
    "pointer-mutation-unknown-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-unknown-evidence/v1",
      fields: evidenceSchemaFields.unknownEvidence,
      closedValues: Object.freeze([
        ...Object.keys(unknownEvidenceReasons),
        ...Object.values(unknownEvidenceReasons).flat(),
      ]),
    }),
    "pointer-mutation-conflict-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-conflict-evidence/v1",
      fields: evidenceSchemaFields.conflictEvidence,
    }),
    "pointer-evidence-slot/v1": Object.freeze({
      schemaVersion: "pointer-evidence-slot/v1",
      fields: evidenceSchemaFields.evidenceSlot,
      closedValues: pointerKinds,
    }),
    "pointer-evidence-packet/v1": Object.freeze({
      schemaVersion: "pointer-evidence-packet/v1",
      fields: packetSchemaFields.packet,
      closedValues: Object.freeze(["HISTORICAL_READ", "MUTATION_COMMIT", ...pointerKinds]),
    }),
  });
export const schemaVersions = Object.freeze(
  [
    ...Object.keys(schemaDefinitions),
    ...pointerGraphSchemaVersions,
    ...simplifiedAuthoritySchemaVersions,
    ...commitSchemaVersions,
    ...dispatchSchemaVersions,
    ...evidenceSchemaVersions,
    ...packetSchemaVersions,
    ...externalSchemaVersions,
    ...destinationOwnerSchemaVersions,
    ...successorReviewSchemaVersions,
    ...bootstrapAnchorSchemaVersions,
    ...bootstrapUseIntentSchemaVersions,
    ...bootstrapAnchorTeardownSchemaVersions,
    ...bootstrapGenesisSchemaVersions,
    ...bootstrapConsumptionSchemaVersions,
    ...gateFenceSchemaVersions,
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

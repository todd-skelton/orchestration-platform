import { compatibilityDisposition, schemaDefinitions, schemaVersions } from "./registry.js";
import { diagnostic } from "./diagnostic.js";
import {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  parseCanonicalBytes as parseBytes,
  snapshotClosedArray,
  snapshotClosedRecord,
  validateAgainstSchema,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export {
  classifyProposal,
  computeConflictDigest,
  computeCurrentTipDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeRecoveryAuthorizationCoreDigest,
  computeReservationPredecessorKey,
  derivePointerPositionEvidence,
  framedBytes,
  nativeConsumePath,
  pointerArchivePaths,
  pointerGenesisRule,
  pointerKinds,
  pointerPath,
  pointerPositionContracts,
  pointerRegistry,
  pointerRootPaths,
  recoveryAccumulatorDigest,
  recoveryAuthorizationCorePath,
  retentionAllows,
  stateMutationAuthorityPath,
  stateMutationLockPath,
  stateMutationRegistry,
  v2SchemaVersions,
  validateAuthorizationReceiptChain,
  validateAuthorizationRevokeReceiptChain,
  validateCleanupHeadHistory,
  validateFenceHeadHistory,
  validateGateAuthorizationBinding,
  validatePointerDispatch,
  validatePointerGenesisDispatch,
  validatePointerPositionEvidence,
  validatePointerTemplateDispatch,
  validateRecoveryAccumulatorFormula,
  validateRetentionTransition,
  validateRotationCensus,
  validateSelectedPointerEvidence,
} from "./v2.js";
export type {
  ConflictDigestInput,
  EpochSequenceStep,
  FramePart,
  MutationDigestInput,
  PointerInstanceDigestInput,
  PointerKind,
  PointerPathBindings,
  PointerRegistryRow,
  ProposalClassification,
  ProposalDigestInput,
  RetentionOperation,
} from "./v2.js";
export {
  canonicalContractGolden,
  commitRunStages,
  compareDecimalAscii,
  computeAuthorityAppendReceiptDigest,
  computeAuthorityEmptyDigest,
  computeAuthorityEmptyRootDigest,
  computeAuthorityEpochKey,
  computeAuthorityHistoryRootDigest,
  computeAuthorityLeafDigest,
  computeAuthorityNodeDigest,
  computeAuthorityRotationId,
  computeAuthoritySuccessorCoreDigest,
  computeAuthorityUpdateProofDigest,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorLifecycleArchiveDigest,
  computeBootstrapAnchorConflictDigest,
  computeBootstrapAnchorConsumptionDigest,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorTeardownDigest,
  computeBootstrapAnchorUseIntentDigest,
  computeBootstrapAnchorValueDigest,
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostDigest,
  computeCommitResolutionDigest,
  computeDestinationDigest,
  computeDestinationOwnerConflictDigest,
  computeDestinationOwnerRetentionDigest,
  computeDestinationOwnerRetirementEvidenceDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeDestinationSuccessorPostDigest,
  computeDestinationSuccessorReviewCoreDigest,
  computeGlobalIdentityDigest,
  computePhysicalDestinationDigest,
  computePhysicalObservationDigest,
  computeRunAuditDigest,
  computeRunCheckpointCoreDigest,
  computeRunId,
  computeRunIntentDigest,
  computeRunPostSelectionDigest,
  computeRunSegmentDigest,
  computeSparseAbsentRoot,
  computeSparseRoot,
  externalAuthorityPaths,
  incrementDecimalAscii,
  validateAuthorityMembership,
  validateAuthorityMembershipV2,
  validateAuthorityHistoryNodeInventoryPage,
  validateAuthoritySingleUpdateWitness,
  validateAuthorityValueHistoryBinding,
  validateBootstrapAnchorTransition,
  validateBootstrapAnchorComposition,
  validateBootstrapGenesisGraph,
  validateCommitRunSequence,
  validateCommitRunComposition,
  validateCommitEvidenceV3,
  validateDestinationOwnerTransition,
  validateDestinationOwnerComposition,
  validateEvidencePacketV2,
  validateEvidencePacketV3,
  resolveProposedTargetEvidence,
} from "./approved.js";
export {
  authorityInventoryPaths,
  computeAuthorityCensusChainDigest,
  computeAuthorityCensusEntryDigest,
  computeAuthorityCensusPageDigest,
  computeAuthorityCensusTerminalDigest,
  computeAuthorityCoordinatorPositionDigest,
  computeAuthorityFilesystemObservationDigest,
  computeAuthorityInventoryBatchDigest,
  computeAuthorityInventoryEmptyDigest,
  computeAuthorityInventoryLeafDigest,
  computeAuthorityInventoryRootDigest,
  computeAuthorityInventorySparseRoot,
  computeAuthorityInventorySparseAbsentRoot,
  computeAuthorityInventoryUpdateEntryDigest,
  computeAuthorityHistoryEmptyRootDigestV2,
  computeAuthorityHistoryRootDigestV2,
  computeAuthorityAppendReceiptDigestV2,
  computeAuthoritySuccessorCoreDigestV2,
  computeAuthorityMaterializationHandoffDigest,
  computeAuthorityMaterializationFinishingDigest,
  computeAuthorityMaterializationPlanDigest,
  computeAuthorityMaterializationPlanEntryDigest,
  computeAuthorityMaterializationReceiptDigest,
  computeAuthorityMaterializationRevocationDigest,
  computeAuthorityMaterializationStartDigest,
  computeAuthorityMaterializationTerminalDigest,
  computeAuthorityNodeRecordDigest,
  computeAuthorityRotationHandoffDigest,
  computeAuthorityRotationIdV2,
  computeRunCheckpointCoreDigestV2,
  computeRunPostSelectionDigestV1,
  validateAuthorityCoordinatorComposition,
  validateAuthorityCoordinatorTransition,
  validateAuthorityCommitRunV3,
  validateAuthorityInventoryCensus,
  validateAuthorityMaterializationComposition,
  validateAuthorityMaterializationAuthorityComposition,
  validateAuthorityValueV3Composition,
} from "./inventory.js";
export type * from "./runtime.js";
export type {
  CleanupHeadWriteDisposition,
  CleanupLifecycle,
  CleanupPublication,
} from "./definitions.js";
export {
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
  reduceCleanupHeadWrite,
} from "./definitions.js";
export {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  compatibilityDisposition,
  diagnostic,
  schemaDefinitions,
  schemaVersions,
  snapshotClosedArray,
  snapshotClosedRecord,
};

export function parseContract(expectedSchemaVersion: string, input: unknown): ParseResult {
  const definition = schemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:unsupported"] };
  try {
    return validateAgainstSchema(definition, input);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export function parseCanonicalContractBytes(
  expectedSchemaVersion: string,
  bytes: Uint8Array,
): ParseResult {
  const definition = schemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:unsupported"] };
  try {
    return parseBytes(definition, bytes);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export type SerializationResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };

export function serializeContract(
  expectedSchemaVersion: string,
  input: unknown,
): SerializationResult {
  const parsed = parseContract(expectedSchemaVersion, input);
  if (!parsed.ok) return parsed;
  const value = parsed.value as JsonValue;
  return { ok: true, bytes: canonicalBytes(value), digest: canonicalDigest(value) };
}

export interface CompatibilityRow {
  readonly expectedSchemaVersion: string;
  readonly observedSchemaVersion: string | null;
  readonly disposition: "readable" | "migratable" | "refused";
}

export const compatibilityMatrix: readonly CompatibilityRow[] = Object.freeze(
  schemaVersions.flatMap((expectedSchemaVersion) => {
    const family = expectedSchemaVersion.slice(0, expectedSchemaVersion.lastIndexOf("/"));
    const observations = [
      expectedSchemaVersion,
      `${family}/v0-fixture`,
      `${family}/v999`,
      `${family}/future`,
      "",
    ];
    return observations.map((observedSchemaVersion) =>
      Object.freeze({
        expectedSchemaVersion,
        observedSchemaVersion: observedSchemaVersion || null,
        disposition: compatibilityDisposition(expectedSchemaVersion, observedSchemaVersion || null),
      }),
    );
  }),
);

export type MigrationResult =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

export function migrateNamedLegacyFixture(input: unknown): MigrationResult {
  try {
    return migrateNamedLegacyFixtureUnchecked(input);
  } catch {
    return { ok: false, issues: ["legacy:unreadable"] };
  }
}

function migrateNamedLegacyFixtureUnchecked(input: unknown): MigrationResult {
  const expected = ["adapterId", "projectId", "schemaVersion", "stateRoot"];
  const closed = snapshotClosedRecord(input, expected);
  if (!closed.ok) return { ok: false, issues: closed.issues.map((issue) => `legacy:${issue}`) };
  const record = closed.value;
  if (record.schemaVersion !== "platform-configuration/v0-fixture")
    return { ok: false, issues: ["legacy:not-named-fixture"] };
  const migrated = {
    schemaVersion: "platform-configuration/v1",
    adapterId: record.adapterId,
    capabilityNames: [],
    leaseFreshnessMs: 3_600_000,
    maximumSessionMs: 86_400_000,
    projectId: record.projectId,
    stateRoot: record.stateRoot,
    wallClockSkewMs: 300_000,
  };
  const parsed = parseContract("platform-configuration/v1", migrated);
  return parsed.ok ? parsed : { ok: false, issues: parsed.issues };
}

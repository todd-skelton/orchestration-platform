import { describe, expect, test } from "vitest";
import {
  bootstrapGenesisSchemaFields,
  bootstrapConsumptionSchemaFields,
  bootstrapAnchorConsumptionReceiptPath,
  canonicalDigest,
  computeAuthorityHistoryRecordDigest,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorLifecycleArchiveDigest,
  computeBootstrapAnchorConsumptionId,
  computeBootstrapAnchorConsumptionReceiptDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorTeardownReceiptDigest,
  computeBootstrapAnchorUseIntentDigest,
  computeBootstrapAnchorValueDigest,
  computeBootstrapDestinationIdentityDigest,
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostSelectionDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerSuccessorPostSelectionDigest,
  computeDestinationOwnerSuccessorReviewCandidateDigest,
  computeDestinationOwnerSuccessorReviewCoreDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeExternalDestinationAbsenceObservationDigest,
  computeGenesisBootstrapInputDigest,
  computeGenesisSelectionEvidenceDigest,
  computeGlobalBootstrapIdentityDigest,
  computeMutationId,
  computePhysicalDestinationIdentityDigest,
  computePhysicalLocatorObservationDigest,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeReviewedAuthorityOperationDigest,
  computeSuccessorAuthorityCoreDigest,
  computeStateMutationGlobalIdentityDigest,
  computeCurrentTipDigest,
  incrementCanonicalDecimal,
  parseBootstrapGenesisCore,
  parseBootstrapGenesisPostSelection,
  parseBootstrapAnchorConsumptionReceipt,
  parseActiveReleaseValue,
  parseContract,
  pointerGraphSchemaFields,
  pointerRootPaths,
  stateMutationAuthorityPath,
  validateBootstrapGenesisCoreBinding,
  validateBootstrapGenesisPostSelectionBinding,
  validateBootstrapAnchorConsumptionBinding,
  validateBootstrapConsumedRetirementBinding,
  validateGenesisSelectionEvidenceBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";

function fixture(
  successorReviewCoreDigest: string | null = null,
  successorPrior: {
    proposalDigest: string;
    tipDigest: string;
    valueDigest: string;
  } | null = null,
  timing: {
    selectedOwnerProposedAt?: string;
    successorPostObservedAt?: string;
  } = {},
) {
  const physical = {
    ancestorObjectIdentityDigest: d("1"),
    canonicalPhysicalLeafBytes: Buffer.from("destination", "utf8").toString("base64url"),
    filesystemIdentityDigest: d("2"),
    hostCustodyNamespaceDigest: d("3"),
    leafIdentityKind: "ABSENT_DIRECTORY_ENTRY",
    operatingSystem: "WINDOWS",
    physicalVolumeIdentityDigest: d("4"),
    schemaVersion: "physical-destination-identity/v1",
  };
  const destinationDigest = computeBootstrapDestinationIdentityDigest(
    computePhysicalDestinationIdentityDigest(physical),
  );
  const authorityIdentity = {
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION" as const,
    canonicalPointerPath: stateMutationAuthorityPath,
    installationId,
    projectId,
    stateRootDigest: d("5"),
    transactionId: null,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE", parts: {} },
  };
  const authorityPathInstanceDigest = computePointerInstanceDigest(authorityIdentity);
  const genesisPositionDigest = computePointerPositionDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    authorityIdentity.positionEvidence,
  );
  const observation = {
    caseComparisonProfile: "CASE_INSENSITIVE_LOWERCASE",
    custodyInstanceDigest: d("6"),
    custodyReceiptDigest: d("7"),
    disposition: "ADMITTED",
    helperDigest: d("8"),
    helperVersion: "helper-1.0.0",
    logicalLocatorDigest: d("9"),
    nativeIdentityReadbackDigest: d("a"),
    observedAt: "2026-08-19T12:00:00.000Z",
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(physical),
    resolvedLocatorReadbackDigest: d("b"),
    schemaVersion: "physical-destination-locator-observation-receipt/v1",
    unicodeNormalizationProfile: "NFC",
    validFrom: "2026-08-19T11:59:00.000Z",
    validUntil: "2026-08-19T12:30:00.000Z",
  };
  const observationDigest = computePhysicalLocatorObservationDigest(observation);
  const absence = {
    custodyInstanceDigest: observation.custodyInstanceDigest,
    destinationDigest,
    helperDigest: observation.helperDigest,
    locatorObservationDigest: observationDigest,
    observedAt: "2026-08-19T12:01:00.000Z",
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(physical),
    reason: "RUNTIME_AUTHORITY_ABSENT",
    schemaVersion: "external-destination-absence-observation/v1",
    stateRootDigest: authorityIdentity.stateRootDigest,
  };
  const anchorBase = {
    abiDigest: d("c"),
    authorityPathInstanceDigest,
    bootstrapGrantDigest: d("d"),
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: observation.custodyInstanceDigest,
    custodyReceiptDigest: observation.custodyReceiptDigest,
    destinationDigest,
    globalBootstrapIdentityDigest: d("0"),
    helperDigest: observation.helperDigest,
    helperProfileDigest: d("e"),
    independentReviewReceiptDigest: d("f"),
    installationId,
    lockProfileDigest: d("1"),
    projectId,
    reviewedInstallerDigest: d("2"),
    schemaVersion: "state-mutation-bootstrap-anchor/v1",
    stateComponentProfileDigest: d("3"),
    stateRootDigest: authorityIdentity.stateRootDigest,
    successorReviewCoreDigest,
  };
  const anchor = {
    ...anchorBase,
    globalBootstrapIdentityDigest: computeGlobalBootstrapIdentityDigest(anchorBase),
  };
  const anchorDigest = computeBootstrapAnchorDigest(anchor);
  const anchorValue = {
    anchorDigest,
    bootstrapGenesisCoreDigest: null,
    lifecycle: "ACTIVE",
    lifecycleOrdinal: "0",
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    selectedAuthorityPathInstanceDigest: null,
    selectedAuthorityReceiptDigest: null,
    selectedAuthorityTipDigest: null,
    selectedAuthorityValueDigest: null,
    selectionPostReceiptDigest: null,
    teardownReceiptDigest: null,
  };
  const anchorProposalBase = {
    anchorDigest,
    mutationId: d("0"),
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    proposedAt: "2026-08-19T12:00:00.000Z",
    schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
    source: "BOOTSTRAP_CREATE",
    successorValueDigest: computeBootstrapAnchorValueDigest(anchorValue),
    transition: "ACTIVATE",
    transitionEvidenceDigest: anchor.bootstrapGrantDigest,
  };
  const anchorProposal = {
    ...anchorProposalBase,
    mutationId: computeBootstrapAnchorMutationId(anchor, anchorProposalBase, anchorValue),
  };
  const anchorValueDigest = computeBootstrapAnchorValueDigest(anchorValue);
  const anchorReceiptDigest = computeBootstrapAnchorProposalDigest(anchorProposal);
  const anchorTip = {
    anchorDigest,
    proposalReceiptDigest: anchorReceiptDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest: anchorValueDigest,
  };
  const anchorTipDigest = computeBootstrapAnchorTipDigest(anchorTip);

  const ownerValue = {
    anchorDigest,
    anchorReceiptDigest: null,
    anchorTipDigest: null,
    anchorValueDigest: null,
    destinationDigest,
    installationId,
    lifecycle: "ACTIVE",
    ownerOrdinal: successorReviewCoreDigest === null ? "0" : "2",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest,
    teardownArchiveDigest: null,
  };
  const ownerProposalBase = {
    destinationDigest,
    mutationId: d("0"),
    observationDigest,
    positionDigest: computeDestinationOwnerPositionDigest(destinationDigest),
    priorReceiptDigest: successorReviewCoreDigest === null ? null : successorPrior?.proposalDigest,
    priorTipDigest: successorReviewCoreDigest === null ? null : successorPrior?.tipDigest,
    priorValueDigest: successorReviewCoreDigest === null ? null : successorPrior?.valueDigest,
    proposedAt: timing.selectedOwnerProposedAt ?? "2026-08-19T12:00:01.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: successorReviewCoreDigest === null ? "BOOTSTRAP_GENESIS" : "SUCCESSOR_REVIEW",
    successorValueDigest: computeDestinationOwnerValueDigest(ownerValue),
    transition: successorReviewCoreDigest === null ? "ACTIVATE_GENESIS" : "ACTIVATE_SUCCESSOR",
    transitionEvidenceDigest: successorReviewCoreDigest ?? anchor.bootstrapGrantDigest,
  };
  const ownerProposal = {
    ...ownerProposalBase,
    mutationId: computeDestinationOwnerMutationId(ownerProposalBase, ownerValue),
  };
  const ownerValueDigest = computeDestinationOwnerValueDigest(ownerValue);
  const ownerReceiptDigest = computeDestinationOwnerProposalDigest(ownerProposal);
  const ownerTip = {
    destinationDigest,
    proposalReceiptDigest: ownerReceiptDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: ownerValueDigest,
  };
  const ownerTipDigest = computeDestinationOwnerTipDigest(ownerTip);

  const operation = {
    bootstrapGrantDigest: anchor.bootstrapGrantDigest,
    bootstrapTransactionId: transactionId,
    independentReviewReceiptDigest: anchor.independentReviewReceiptDigest,
    installedBytesDigest: d("7"),
    operationKind: "BOOTSTRAP_INSTALL",
    releaseManifestDigest: d("8"),
    releaseSubjectDigest: d("9"),
    reviewedInstallerDigest: anchor.reviewedInstallerDigest,
    schemaVersion: "reviewed-authority-operation/v1",
  };
  const globalIdentity = {
    authorityPath: stateMutationAuthorityPath,
    authorityPathInstanceDigest,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    installationId,
    projectId,
    schemaVersion: "state-mutation-global-identity/v1",
    stateRootDigest: anchor.stateRootDigest,
  };
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(globalIdentity);
  const successorCore = {
    abiDigest: anchor.abiDigest,
    admittedCustodyObservationDigest: observationDigest,
    authorityPathInstanceDigest,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    globalIdentityDigest,
    independentReviewReceiptDigest: operation.independentReviewReceiptDigest,
    lockProfileDigest: anchor.lockProfileDigest,
    operationKind: "BOOTSTRAP_INSTALL",
    reviewedInstalledBytesDigest: operation.installedBytesDigest,
    reviewedOperationDigest: computeReviewedAuthorityOperationDigest(operation),
    reviewedReleaseManifestDigest: operation.releaseManifestDigest,
    reviewedReleaseSubjectDigest: operation.releaseSubjectDigest,
    schemaVersion: "state-mutation-successor-authority-core/v1",
    stateComponentProfileDigest: anchor.stateComponentProfileDigest,
    successorAuthorityOrdinal: "0",
    successorHelperDigest: anchor.helperDigest,
    successorHelperProfileDigest: anchor.helperProfileDigest,
  };
  const successorCoreDigest = computeSuccessorAuthorityCoreDigest(successorCore, operation);
  const proposedGenesisInput = {
    authorityPathInstanceDigest,
    bootstrapGrantDigest: anchor.bootstrapGrantDigest,
    bootstrapTransactionId: transactionId,
    genesisPositionDigest,
    globalIdentityDigest,
    schemaVersion: "bootstrap-proposed-genesis-input/v1",
    successorCoreDigest,
  };
  const reviewedInstaller = {
    installerArtifactDigest: anchor.reviewedInstallerDigest,
    installerSourceDigest: d("b"),
    reviewReceiptDigest: anchor.independentReviewReceiptDigest,
    schemaVersion: "bootstrap-reviewed-installer/v1",
  };
  const reviewedHelper = {
    abiDigest: anchor.abiDigest,
    helperDigest: anchor.helperDigest,
    helperProfileDigest: anchor.helperProfileDigest,
    lockProfileDigest: anchor.lockProfileDigest,
    schemaVersion: "bootstrap-reviewed-helper/v1",
    stateComponentProfileDigest: anchor.stateComponentProfileDigest,
  };
  const intent = {
    anchorActiveReceiptDigest: anchorReceiptDigest,
    anchorActiveTipDigest: anchorTipDigest,
    anchorActiveValueDigest: anchorValueDigest,
    anchorDigest,
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    destinationDigest,
    destinationOwnerActiveReceiptDigest: ownerReceiptDigest,
    destinationOwnerActiveTipDigest: ownerTipDigest,
    destinationOwnerActiveValueDigest: ownerValueDigest,
    destinationStateRootDigest: anchor.stateRootDigest,
    expiresAt: "2026-08-19T12:15:00.000Z",
    proposedGenesisInput,
    reviewedHelper,
    reviewedInstaller,
    schemaVersion: "state-mutation-bootstrap-anchor-use-intent/v1",
    startedAt: "2026-08-19T12:00:00.000Z",
  };
  const successorPostSelectionReceipt =
    successorReviewCoreDigest === null
      ? null
      : {
          destinationLockCustodyObservationDigest: d("c"),
          observedAt: timing.successorPostObservedAt ?? "2026-08-19T12:00:02.000Z",
          proposalReadbackDigest: canonicalDigest(ownerProposal),
          reviewCoreDigest: successorReviewCoreDigest,
          schemaVersion:
            "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
          successorAnchorDigest: anchorDigest,
          successorOwnerProposalReceiptDigest: ownerReceiptDigest,
          successorOwnerTipDigest: ownerTipDigest,
          successorOwnerValueDigest: ownerValueDigest,
          tipReadbackDigest: canonicalDigest(ownerTip),
          valueReadbackDigest: canonicalDigest(ownerValue),
        };
  const intentExpected = {
    anchorDigest,
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    destinationLockCustodyObservationDigest:
      successorPostSelectionReceipt?.destinationLockCustodyObservationDigest ?? null,
    destinationDigest,
    destinationStateRootDigest: anchor.stateRootDigest,
    effectiveAt: "2026-08-19T12:10:00.000Z",
    proposedGenesisInput,
    reviewedHelper,
    reviewedInstaller,
    reviewedInstallerDigest: anchor.reviewedInstallerDigest,
    successorPostSelectionReceiptDigest:
      successorPostSelectionReceipt === null
        ? null
        : computeDestinationOwnerSuccessorPostSelectionDigest(successorPostSelectionReceipt),
    successorPostSelectionReceipt,
    successorPostSelectionReceiptReadbackDigest:
      successorPostSelectionReceipt === null
        ? null
        : canonicalDigest(successorPostSelectionReceipt),
    successorPostSelectionReviewCoreDigest: successorReviewCoreDigest,
  };
  const useIntentDigest = computeBootstrapAnchorUseIntentDigest(intent);
  const genesisInput = {
    bootstrapAnchorActiveReceiptDigest: anchorReceiptDigest,
    bootstrapAnchorActiveTipDigest: anchorTipDigest,
    bootstrapAnchorActiveValueDigest: anchorValueDigest,
    bootstrapAnchorDigest: anchorDigest,
    bootstrapGrantDigest: anchor.bootstrapGrantDigest,
    bootstrapTransactionId: transactionId,
    destinationDigest,
    destinationOwnerActiveReceiptDigest: ownerReceiptDigest,
    destinationOwnerActiveTipDigest: ownerTipDigest,
    destinationOwnerActiveValueDigest: ownerValueDigest,
    globalBootstrapIdentityDigest: anchor.globalBootstrapIdentityDigest,
    schemaVersion: "authority-history-genesis-bootstrap-input/v1",
    successorCoreDigest,
    useIntentDigest,
  };
  const genesisBootstrapInputDigest = computeGenesisBootstrapInputDigest(genesisInput);
  const history = {
    genesisBootstrapInputDigest,
    globalIdentityDigest,
    ordinal: "0",
    predecessorKind: "GENESIS_LITERAL",
    recordKind: "GENESIS",
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest,
  };
  const historyRecordDigest = computeAuthorityHistoryRecordDigest(history);
  const activeReleaseIdentity = {
    pointerKind: "ACTIVE_RELEASE" as const,
    canonicalPointerPath: "installation/active-release.json",
    installationId,
    projectId,
    stateRootDigest: anchor.stateRootDigest,
    transactionId: installationId,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE", parts: {} },
  };
  const activeReleaseValue = {
    independentReviewReceiptDigest: operation.independentReviewReceiptDigest,
    installedBytesDigest: operation.installedBytesDigest,
    releaseDigest: operation.releaseSubjectDigest,
    releaseManifestDigest: operation.releaseManifestDigest,
    releaseSubjectDigest: operation.releaseSubjectDigest,
    reviewedInstallerDigest: operation.reviewedInstallerDigest,
    schemaVersion: "active-release/v1",
  };
  const activeReleasePathInstanceDigest = computePointerInstanceDigest(activeReleaseIdentity);
  const activeReleaseValueDigest = computePointerValueDigest(
    "ACTIVE_RELEASE",
    activeReleasePathInstanceDigest,
    activeReleaseValue,
  );
  const activeReleasePositionDigest = computePointerPositionDigest("ACTIVE_RELEASE", {
    mode: "VALUE",
    parts: {},
  });
  const activeReleaseMutationId = computeMutationId({
    ...activeReleaseIdentity,
    priorTipDigest: null,
    priorValueDigest: null,
    priorReceiptDigest: null,
    successorValueDigest: activeReleaseValueDigest,
    outcome: "SELECT",
  });
  const activeReleaseProposal = {
    authorityEpochReceiptDigest: null,
    authorityEpochTipDigest: null,
    authorityEpochValueDigest: null,
    intent: "VALUE_PROPOSED",
    mutationId: activeReleaseMutationId,
    outcome: "SELECT",
    pathInstanceDigest: activeReleasePathInstanceDigest,
    pointerKind: "ACTIVE_RELEASE",
    positionDigest: activeReleasePositionDigest,
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    producerDigest: successorCoreDigest,
    producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
    proposedAt: "2026-08-19T12:01:00.000Z",
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    successorValueDigest: activeReleaseValueDigest,
  };
  const activeReleaseReceiptDigest = computeProposalReceiptDigest(activeReleaseProposal);
  const activeReleaseTip = {
    pathInstanceDigest: activeReleasePathInstanceDigest,
    pointerKind: "ACTIVE_RELEASE",
    proposalReceiptDigest: activeReleaseReceiptDigest,
    schemaVersion: "pointer-current-tip/v1",
    valueDigest: activeReleaseValueDigest,
  };
  const activeReleaseTipDigest = computeCurrentTipDigest(activeReleaseTip);
  const authorityValue = {
    activeReleasePathInstanceDigest,
    activeReleaseReceiptDigest,
    activeReleaseTipDigest,
    activeReleaseValueDigest,
    admittedCustodyObservationDigest: observationDigest,
    authorityOrdinal: "0",
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    globalIdentityDigest,
    headOrdinal: "0",
    headRecordDigest: historyRecordDigest,
    helperAbiDigest: anchor.abiDigest,
    helperDigest: anchor.helperDigest,
    helperProfileDigest: anchor.helperProfileDigest,
    installationId,
    lockProfileDigest: anchor.lockProfileDigest,
    priorAuthorityReceiptDigest: null,
    priorAuthorityTipDigest: null,
    priorAuthorityValueDigest: null,
    projectId,
    schemaVersion: "state-mutation-authority-value/v1",
    stateComponentProfileDigest: anchor.stateComponentProfileDigest,
    stateRootDigest: anchor.stateRootDigest,
  };
  const authorityValueDigest = computePointerValueDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    authorityPathInstanceDigest,
    authorityValue,
  );
  const core = {
    anchorDigest,
    authorityPathInstanceDigest,
    authorityValueDigest,
    bootstrapTransactionId: transactionId,
    destinationAbsenceDigest: computeExternalDestinationAbsenceObservationDigest(absence),
    destinationDigest,
    destinationOwnerActiveReceiptDigest: ownerReceiptDigest,
    destinationOwnerActiveTipDigest: ownerTipDigest,
    destinationOwnerActiveValueDigest: ownerValueDigest,
    genesisBootstrapInputDigest,
    genesisHistoryRecordDigest: historyRecordDigest,
    genesisPositionDigest,
    globalIdentityDigest,
    schemaVersion: "state-mutation-bootstrap-genesis-core/v1",
    successorCoreDigest,
  };
  const coreDigest = computeBootstrapGenesisCoreDigest(core);
  const proposalBase = {
    authorityEpochReceiptDigest: null,
    authorityEpochTipDigest: null,
    authorityEpochValueDigest: null,
    intent: "VALUE_PROPOSED",
    mutationId: d("0"),
    outcome: "SELECT",
    pathInstanceDigest: authorityPathInstanceDigest,
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
    positionDigest: genesisPositionDigest,
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    producerDigest: coreDigest,
    producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
    proposedAt: "2026-08-19T12:02:00.000Z",
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    successorValueDigest: authorityValueDigest,
  };
  const mutationId = computeMutationId({
    ...authorityIdentity,
    priorTipDigest: null,
    priorValueDigest: null,
    priorReceiptDigest: null,
    successorValueDigest: authorityValueDigest,
    outcome: "SELECT",
  });
  const proposal = { ...proposalBase, mutationId };
  const receiptDigest = computeProposalReceiptDigest(proposal);
  const tip = {
    pathInstanceDigest: authorityPathInstanceDigest,
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
    proposalReceiptDigest: receiptDigest,
    schemaVersion: "pointer-current-tip/v1",
    valueDigest: authorityValueDigest,
  };
  const tipDigest = computeCurrentTipDigest(tip);
  const post = {
    anchorDigest,
    authorityPathInstanceDigest,
    bootstrapGenesisCoreDigest: coreDigest,
    observedAt: "2026-08-19T12:03:00.000Z",
    proposalReadbackDigest: canonicalDigest(proposal),
    receiptDigest,
    schemaVersion: "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
    tipDigest,
    tipReadbackDigest: canonicalDigest(tip),
    valueDigest: authorityValueDigest,
    valueReadbackDigest: canonicalDigest(authorityValue),
  };
  return {
    absence,
    absenceExpected: {
      custodyInstanceDigest: observation.custodyInstanceDigest,
      destinationDigest,
      helperDigest: observation.helperDigest,
      locatorObservationDigest: observationDigest,
      physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(physical),
      reason: "RUNTIME_AUTHORITY_ABSENT",
      stateRootDigest: anchor.stateRootDigest,
    },
    anchor,
    anchorProposal,
    anchorTip,
    anchorValue,
    activeReleaseProposal,
    activeReleaseTip,
    activeReleaseValue,
    authorityValue,
    core,
    genesisInput,
    globalIdentity,
    history,
    intent,
    intentExpected,
    observation,
    operation,
    ownerProposal,
    ownerTip,
    ownerValue,
    physical,
    post,
    postExpected: {
      anchorDigest,
      authorityPathInstanceDigest,
      bootstrapGenesisCoreDigest: coreDigest,
    },
    proposal,
    priorOwnerProposal: null,
    priorOwnerTip: null,
    priorOwnerValue: null,
    ownerTeardownArchive: null,
    successorReviewCore: null,
    successorReviewExpected: null,
    successorPostSelection: null,
    successorPostExpected: null,
    successorCore,
    tip,
  };
}

function successorFixture(
  timing: {
    priorRetiredProposedAt?: string;
    reviewedAt?: string;
    selectedOwnerProposedAt?: string;
    successorPostObservedAt?: string;
  } = {},
) {
  const seed = fixture();
  const priorInstallationId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";
  const priorProjectId = "018f0f4d-7b2d-7a15-8a2b-123456789abc";
  const priorAnchorDigest = d("4");
  const priorActiveValue = {
    anchorDigest: priorAnchorDigest,
    anchorReceiptDigest: null,
    anchorTipDigest: null,
    anchorValueDigest: null,
    destinationDigest: seed.anchor.destinationDigest,
    installationId: priorInstallationId,
    lifecycle: "ACTIVE",
    ownerOrdinal: "0",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: null,
    teardownArchiveDigest: null,
  };
  const priorActiveProposalBase = {
    destinationDigest: seed.anchor.destinationDigest,
    mutationId: d("0"),
    observationDigest: d("5"),
    positionDigest: computeDestinationOwnerPositionDigest(seed.anchor.destinationDigest),
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    proposedAt: "2026-08-19T11:00:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: "BOOTSTRAP_GENESIS",
    successorValueDigest: computeDestinationOwnerValueDigest(priorActiveValue),
    transition: "ACTIVATE_GENESIS",
    transitionEvidenceDigest: d("6"),
  };
  const priorActiveProposal = {
    ...priorActiveProposalBase,
    mutationId: computeDestinationOwnerMutationId(priorActiveProposalBase, priorActiveValue),
  };
  const priorActiveValueDigest = computeDestinationOwnerValueDigest(priorActiveValue);
  const priorActiveReceiptDigest = computeDestinationOwnerProposalDigest(priorActiveProposal);
  const priorActiveTip = {
    destinationDigest: seed.anchor.destinationDigest,
    proposalReceiptDigest: priorActiveReceiptDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: priorActiveValueDigest,
  };
  const priorActiveTipDigest = computeDestinationOwnerTipDigest(priorActiveTip);
  const ownerTeardownArchive = {
    anchorRetiredReceiptDigest: d("7"),
    anchorRetiredTipDigest: d("8"),
    anchorRetiredValueDigest: d("9"),
    destinationDigest: seed.anchor.destinationDigest,
    installationId: priorInstallationId,
    observationDigest: d("a"),
    priorOwnerReceiptDigest: priorActiveReceiptDigest,
    priorOwnerTipDigest: priorActiveTipDigest,
    priorOwnerValueDigest: priorActiveValueDigest,
    schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
    teardownReceiptDigest: d("b"),
  };
  const archiveDigest = computeDestinationOwnerTeardownArchiveDigest(ownerTeardownArchive);
  const priorOwnerValue = {
    anchorDigest: priorAnchorDigest,
    anchorReceiptDigest: ownerTeardownArchive.anchorRetiredReceiptDigest,
    anchorTipDigest: ownerTeardownArchive.anchorRetiredTipDigest,
    anchorValueDigest: ownerTeardownArchive.anchorRetiredValueDigest,
    destinationDigest: seed.anchor.destinationDigest,
    installationId: priorInstallationId,
    lifecycle: "RETIRED",
    ownerOrdinal: "1",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: null,
    teardownArchiveDigest: archiveDigest,
  };
  const priorOwnerProposalBase = {
    destinationDigest: seed.anchor.destinationDigest,
    mutationId: d("0"),
    observationDigest: d("c"),
    positionDigest: computeDestinationOwnerPositionDigest(seed.anchor.destinationDigest),
    priorReceiptDigest: priorActiveReceiptDigest,
    priorTipDigest: priorActiveTipDigest,
    priorValueDigest: priorActiveValueDigest,
    proposedAt: timing.priorRetiredProposedAt ?? "2026-08-19T11:10:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: "ANCHOR_RETIRED",
    successorValueDigest: computeDestinationOwnerValueDigest(priorOwnerValue),
    transition: "RETIRE_UNUSED",
    transitionEvidenceDigest: archiveDigest,
  };
  const priorOwnerProposal = {
    ...priorOwnerProposalBase,
    mutationId: computeDestinationOwnerMutationId(priorOwnerProposalBase, priorOwnerValue),
  };
  const priorOwnerValueDigest = computeDestinationOwnerValueDigest(priorOwnerValue);
  const priorOwnerReceiptDigest = computeDestinationOwnerProposalDigest(priorOwnerProposal);
  const priorOwnerTip = {
    destinationDigest: seed.anchor.destinationDigest,
    proposalReceiptDigest: priorOwnerReceiptDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: priorOwnerValueDigest,
  };
  const priorOwnerTipDigest = computeDestinationOwnerTipDigest(priorOwnerTip);
  const priorInstallation = {
    anchorDigest: priorAnchorDigest,
    anchorRetiredReceiptDigest: ownerTeardownArchive.anchorRetiredReceiptDigest,
    anchorRetiredTipDigest: ownerTeardownArchive.anchorRetiredTipDigest,
    anchorRetiredValueDigest: ownerTeardownArchive.anchorRetiredValueDigest,
    installationId: priorInstallationId,
    projectId: priorProjectId,
    schemaVersion: "destination-owner-prior-installation/v1",
    stateRootDigest: d("d"),
  };
  const successorAuthority = {
    bootstrapGrantDigest: seed.anchor.bootstrapGrantDigest,
    bootstrapTransactionId: seed.anchor.bootstrapTransactionId,
    globalBootstrapIdentityDigest: seed.anchor.globalBootstrapIdentityDigest,
    installationId: seed.anchor.installationId,
    projectId: seed.anchor.projectId,
    reviewedInstallerDigest: seed.anchor.reviewedInstallerDigest,
    reviewedReleaseManifestDigest: seed.operation.releaseManifestDigest,
    reviewedReleaseSubjectDigest: seed.operation.releaseSubjectDigest,
    schemaVersion: "destination-owner-successor-authority/v1",
    stateRootDigest: seed.anchor.stateRootDigest,
  };
  const independentReview = {
    authorIdentityDigest: d("e"),
    candidateDigest: d("0"),
    reviewReceiptDigest: d("f"),
    reviewedAt: timing.reviewedAt ?? "2026-08-19T11:20:00.000Z",
    reviewerIdentityDigest: d("1"),
    schemaVersion: "destination-owner-independent-review/v1",
  };
  const reviewCoreBase = {
    destinationDigest: seed.anchor.destinationDigest,
    independentReview,
    priorInstallation,
    priorRetiredReceiptDigest: priorOwnerReceiptDigest,
    priorRetiredTipDigest: priorOwnerTipDigest,
    priorRetiredValueDigest: priorOwnerValueDigest,
    schemaVersion: "state-mutation-destination-owner-successor-review-core/v1",
    successorAuthority,
    teardownArchiveDigest: archiveDigest,
  };
  const successorReviewCore = {
    ...reviewCoreBase,
    independentReview: {
      ...independentReview,
      candidateDigest: computeDestinationOwnerSuccessorReviewCandidateDigest(reviewCoreBase),
    },
  };
  const reviewCoreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(successorReviewCore);
  const base = fixture(
    reviewCoreDigest,
    {
      proposalDigest: priorOwnerReceiptDigest,
      tipDigest: priorOwnerTipDigest,
      valueDigest: priorOwnerValueDigest,
    },
    timing,
  );
  const successorPostSelection = base.intentExpected.successorPostSelectionReceipt!;
  const successorReviewExpected = {
    authorIdentityDigest: independentReview.authorIdentityDigest,
    candidateDigest: successorReviewCore.independentReview.candidateDigest,
    destinationDigest: base.anchor.destinationDigest,
    priorProjectId,
    priorStateRootDigest: priorInstallation.stateRootDigest,
    reviewReceiptDigest: independentReview.reviewReceiptDigest,
    reviewerIdentityDigest: independentReview.reviewerIdentityDigest,
    successorAuthority,
    teardownAbsenceDigest: ownerTeardownArchive.observationDigest,
  };
  const successorPostExpected = {
    destinationLockCustodyObservationDigest:
      successorPostSelection.destinationLockCustodyObservationDigest,
    observationDigest: computePhysicalLocatorObservationDigest(base.observation),
    proposalReadbackDigest: successorPostSelection.proposalReadbackDigest,
    reviewCoreDigest,
    successorAnchorDigest: computeBootstrapAnchorDigest(base.anchor),
    tipReadbackDigest: successorPostSelection.tipReadbackDigest,
    valueReadbackDigest: successorPostSelection.valueReadbackDigest,
  };
  return {
    ...base,
    ownerTeardownArchive,
    priorOwnerProposal,
    priorOwnerTip,
    priorOwnerValue,
    successorPostExpected,
    successorPostSelection,
    successorReviewCore,
    successorReviewExpected,
  };
}

type E0Fixture = ReturnType<typeof fixture> | ReturnType<typeof successorFixture>;
type E0CoreFixture = Omit<
  E0Fixture,
  "activeReleaseValue" | "activeReleaseProposal" | "activeReleaseTip"
> & {
  activeReleaseValue: unknown;
  activeReleaseProposal: unknown;
  activeReleaseTip: unknown;
};

function validateCore(
  f: E0CoreFixture,
  core: unknown = f.core,
  globalIdentity: unknown = f.globalIdentity,
  observation: unknown = f.observation,
) {
  return validateBootstrapGenesisCoreBinding(
    core,
    f.anchor,
    f.anchorTip,
    f.anchorValue,
    f.anchorProposal,
    f.ownerTip,
    f.ownerValue,
    f.ownerProposal,
    f.intent,
    f.genesisInput,
    f.history,
    f.operation,
    f.successorCore,
    f.authorityValue,
    f.activeReleaseValue,
    f.activeReleaseProposal,
    f.activeReleaseTip,
    globalIdentity,
    f.priorOwnerTip,
    f.priorOwnerValue,
    f.priorOwnerProposal,
    f.ownerTeardownArchive,
    f.successorReviewCore,
    f.successorReviewExpected,
    f.successorPostSelection,
    f.successorPostExpected,
    f.physical,
    observation,
    f.absence,
    f.intentExpected,
    f.absenceExpected,
  );
}

function validatePost(
  f: ReturnType<typeof fixture> | ReturnType<typeof successorFixture>,
  post: unknown = f.post,
) {
  return validateBootstrapGenesisPostSelectionBinding(
    post,
    f.core,
    f.anchor,
    f.authorityValue,
    f.proposal,
    f.tip,
    f.postExpected,
  );
}

function rebuildActiveRelease(
  f: ReturnType<typeof fixture> | ReturnType<typeof successorFixture>,
  activeReleaseValue: typeof f.activeReleaseValue,
) {
  const identity = {
    pointerKind: "ACTIVE_RELEASE" as const,
    canonicalPointerPath: "installation/active-release.json",
    installationId: f.anchor.installationId,
    projectId: f.anchor.projectId,
    stateRootDigest: f.anchor.stateRootDigest,
    transactionId: f.anchor.installationId,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE", parts: {} },
  };
  const pathInstanceDigest = computePointerInstanceDigest(identity);
  const valueDigest = computePointerValueDigest(
    "ACTIVE_RELEASE",
    pathInstanceDigest,
    activeReleaseValue,
  );
  const mutationId = computeMutationId({
    ...identity,
    priorTipDigest: null,
    priorValueDigest: null,
    priorReceiptDigest: null,
    successorValueDigest: valueDigest,
    outcome: "SELECT",
  });
  const activeReleaseProposal = {
    ...f.activeReleaseProposal,
    mutationId,
    pathInstanceDigest,
    successorValueDigest: valueDigest,
  };
  const receiptDigest = computeProposalReceiptDigest(activeReleaseProposal);
  const activeReleaseTip = {
    ...f.activeReleaseTip,
    pathInstanceDigest,
    proposalReceiptDigest: receiptDigest,
    valueDigest,
  };
  const tipDigest = computeCurrentTipDigest(activeReleaseTip);
  const authorityValue = {
    ...f.authorityValue,
    activeReleasePathInstanceDigest: pathInstanceDigest,
    activeReleaseReceiptDigest: receiptDigest,
    activeReleaseTipDigest: tipDigest,
    activeReleaseValueDigest: valueDigest,
  };
  return {
    ...f,
    activeReleaseProposal,
    activeReleaseTip,
    activeReleaseValue,
    authorityValue,
    core: {
      ...f.core,
      authorityValueDigest: computePointerValueDigest(
        "STATE_MUTATION_AUTHORITY_ROTATION",
        f.core.authorityPathInstanceDigest,
        authorityValue,
      ),
    },
  };
}

function consumptionFixture(
  base: ReturnType<typeof fixture> | ReturnType<typeof successorFixture> = fixture(),
  timing: { consumedAt?: string } = {},
) {
  const anchorDigest = computeBootstrapAnchorDigest(base.anchor);
  const coreDigest = computeBootstrapGenesisCoreDigest(base.core);
  const postDigest = computeBootstrapGenesisPostSelectionDigest(base.post);
  const anchorActiveTipDigest = computeBootstrapAnchorTipDigest(base.anchorTip);
  const anchorActiveValueDigest = computeBootstrapAnchorValueDigest(base.anchorValue);
  const anchorActiveReceiptDigest = computeBootstrapAnchorProposalDigest(base.anchorProposal);
  const anchorConsumedValue = {
    anchorDigest,
    bootstrapGenesisCoreDigest: coreDigest,
    lifecycle: "CONSUMED",
    lifecycleOrdinal: "1",
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    selectedAuthorityPathInstanceDigest: base.post.authorityPathInstanceDigest,
    selectedAuthorityReceiptDigest: base.post.receiptDigest,
    selectedAuthorityTipDigest: base.post.tipDigest,
    selectedAuthorityValueDigest: base.post.valueDigest,
    selectionPostReceiptDigest: postDigest,
    teardownReceiptDigest: null,
  };
  const anchorConsumedValueDigest = computeBootstrapAnchorValueDigest(anchorConsumedValue);
  const anchorConsumedProposalBase = {
    anchorDigest,
    mutationId: d("0"),
    priorReceiptDigest: anchorActiveReceiptDigest,
    priorTipDigest: anchorActiveTipDigest,
    priorValueDigest: anchorActiveValueDigest,
    proposedAt: "2026-08-19T12:05:00.000Z",
    schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
    source: "E0_SELECTION",
    successorValueDigest: anchorConsumedValueDigest,
    transition: "CONSUME",
    transitionEvidenceDigest: postDigest,
  };
  const anchorConsumedProposal = {
    ...anchorConsumedProposalBase,
    mutationId: computeBootstrapAnchorMutationId(
      base.anchor,
      anchorConsumedProposalBase,
      anchorConsumedValue,
    ),
  };
  const anchorConsumedReceiptDigest = computeBootstrapAnchorProposalDigest(anchorConsumedProposal);
  const anchorConsumedTip = {
    anchorDigest,
    proposalReceiptDigest: anchorConsumedReceiptDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest: anchorConsumedValueDigest,
  };
  const anchorConsumedTipDigest = computeBootstrapAnchorTipDigest(anchorConsumedTip);

  const ownerActiveTipDigest = computeDestinationOwnerTipDigest(base.ownerTip);
  const ownerActiveValueDigest = computeDestinationOwnerValueDigest(base.ownerValue);
  const ownerActiveReceiptDigest = computeDestinationOwnerProposalDigest(base.ownerProposal);
  const ownerConsumedValue = {
    anchorDigest,
    anchorReceiptDigest: anchorConsumedReceiptDigest,
    anchorTipDigest: anchorConsumedTipDigest,
    anchorValueDigest: anchorConsumedValueDigest,
    destinationDigest: base.anchor.destinationDigest,
    installationId: base.anchor.installationId,
    lifecycle: "CONSUMED",
    ownerOrdinal: incrementCanonicalDecimal(base.ownerValue.ownerOrdinal),
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: null,
    teardownArchiveDigest: null,
  };
  const ownerConsumedValueDigest = computeDestinationOwnerValueDigest(ownerConsumedValue);
  const ownerConsumedProposalBase = {
    destinationDigest: base.anchor.destinationDigest,
    mutationId: d("0"),
    observationDigest: base.authorityValue.admittedCustodyObservationDigest,
    positionDigest: computeDestinationOwnerPositionDigest(base.anchor.destinationDigest),
    priorReceiptDigest: ownerActiveReceiptDigest,
    priorTipDigest: ownerActiveTipDigest,
    priorValueDigest: ownerActiveValueDigest,
    proposedAt: "2026-08-19T12:06:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: "ANCHOR_CONSUMED",
    successorValueDigest: ownerConsumedValueDigest,
    transition: "CONSUME",
    transitionEvidenceDigest: anchorConsumedTipDigest,
  };
  const ownerConsumedProposal = {
    ...ownerConsumedProposalBase,
    mutationId: computeDestinationOwnerMutationId(ownerConsumedProposalBase, ownerConsumedValue),
  };
  const ownerConsumedReceiptDigest = computeDestinationOwnerProposalDigest(ownerConsumedProposal);
  const ownerConsumedTip = {
    destinationDigest: base.anchor.destinationDigest,
    proposalReceiptDigest: ownerConsumedReceiptDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: ownerConsumedValueDigest,
  };
  const ownerConsumedTipDigest = computeDestinationOwnerTipDigest(ownerConsumedTip);
  const receipt = {
    anchorDigest,
    bootstrapGenesisCoreDigest: coreDigest,
    bootstrapTransactionId: base.anchor.bootstrapTransactionId,
    consumedAt: timing.consumedAt ?? "2026-08-19T12:07:00.000Z",
    custodyInstanceDigest: base.anchor.custodyInstanceDigest,
    destinationOwnerActiveReceiptDigest: ownerActiveReceiptDigest,
    destinationOwnerActiveTipDigest: ownerActiveTipDigest,
    destinationOwnerActiveValueDigest: ownerActiveValueDigest,
    destinationOwnerConsumedReceiptDigest: ownerConsumedReceiptDigest,
    destinationOwnerConsumedTipDigest: ownerConsumedTipDigest,
    destinationOwnerConsumedValueDigest: ownerConsumedValueDigest,
    destinationStateRootDigest: base.anchor.stateRootDigest,
    externalAnchorProposalReadbackDigest: canonicalDigest(anchorConsumedProposal),
    externalAnchorTipReadbackDigest: canonicalDigest(anchorConsumedTip),
    externalAnchorValueReadbackDigest: canonicalDigest(anchorConsumedValue),
    externalRuntimeCustodyDigest: base.authorityValue.admittedCustodyObservationDigest,
    runtimePostSelectionReceiptDigest: postDigest,
    runtimePostSelectionReceiptReadbackDigest: canonicalDigest(base.post),
    runtimeProposalReadbackDigest: canonicalDigest(base.proposal),
    runtimeReceiptDigest: base.post.receiptDigest,
    runtimeTipDigest: base.post.tipDigest,
    runtimeTipReadbackDigest: canonicalDigest(base.tip),
    runtimeValueDigest: base.post.valueDigest,
    runtimeValueReadbackDigest: canonicalDigest(base.authorityValue),
    schemaVersion: "state-mutation-bootstrap-anchor-consumption-receipt/v1",
    selectedAuthorityPathInstanceDigest: base.post.authorityPathInstanceDigest,
    useIntentDigest: computeBootstrapAnchorUseIntentDigest(base.intent),
  };
  return {
    ...base,
    anchorConsumedProposal,
    anchorConsumedTip,
    anchorConsumedValue,
    ownerConsumedProposal,
    ownerConsumedTip,
    ownerConsumedValue,
    receipt,
  };
}

function validateConsumption(f: ReturnType<typeof consumptionFixture>) {
  return validateBootstrapAnchorConsumptionBinding(
    f.receipt,
    f.anchor,
    f.intent,
    f.core,
    f.genesisInput,
    f.authorityValue,
    f.proposal,
    f.tip,
    f.post,
    f.anchorTip,
    f.anchorValue,
    f.anchorProposal,
    f.anchorConsumedTip,
    f.anchorConsumedValue,
    f.anchorConsumedProposal,
    f.ownerTip,
    f.ownerValue,
    f.ownerProposal,
    f.ownerConsumedTip,
    f.ownerConsumedValue,
    f.ownerConsumedProposal,
  );
}

function selectionFixture(base: ReturnType<typeof consumptionFixture> = consumptionFixture()) {
  const evidence = {
    anchorConsumedProposalReadbackDigest: canonicalDigest(base.anchorConsumedProposal),
    anchorConsumedReceiptDigest: computeBootstrapAnchorProposalDigest(base.anchorConsumedProposal),
    anchorConsumedTipDigest: computeBootstrapAnchorTipDigest(base.anchorConsumedTip),
    anchorConsumedTipReadbackDigest: canonicalDigest(base.anchorConsumedTip),
    anchorConsumedValueDigest: computeBootstrapAnchorValueDigest(base.anchorConsumedValue),
    anchorConsumedValueReadbackDigest: canonicalDigest(base.anchorConsumedValue),
    anchorConsumptionReceiptDigest: computeBootstrapAnchorConsumptionReceiptDigest(base.receipt),
    bootstrapAnchorActiveReceiptDigest: computeBootstrapAnchorProposalDigest(base.anchorProposal),
    bootstrapAnchorActiveTipDigest: computeBootstrapAnchorTipDigest(base.anchorTip),
    bootstrapAnchorActiveValueDigest: computeBootstrapAnchorValueDigest(base.anchorValue),
    bootstrapAnchorDigest: computeBootstrapAnchorDigest(base.anchor),
    bootstrapGenesisCoreDigest: computeBootstrapGenesisCoreDigest(base.core),
    bootstrapGrantDigest: base.anchor.bootstrapGrantDigest,
    bootstrapTransactionId: base.anchor.bootstrapTransactionId,
    destinationDigest: base.anchor.destinationDigest,
    destinationOwnerActiveReceiptDigest: computeDestinationOwnerProposalDigest(base.ownerProposal),
    destinationOwnerActiveTipDigest: computeDestinationOwnerTipDigest(base.ownerTip),
    destinationOwnerActiveValueDigest: computeDestinationOwnerValueDigest(base.ownerValue),
    genesisBootstrapInputDigest: computeGenesisBootstrapInputDigest(base.genesisInput),
    globalBootstrapIdentityDigest: base.anchor.globalBootstrapIdentityDigest,
    historyRecordDigest: computeAuthorityHistoryRecordDigest(base.history),
    ownerConsumedProposalReadbackDigest: canonicalDigest(base.ownerConsumedProposal),
    ownerConsumedReceiptDigest: computeDestinationOwnerProposalDigest(base.ownerConsumedProposal),
    ownerConsumedTipDigest: computeDestinationOwnerTipDigest(base.ownerConsumedTip),
    ownerConsumedTipReadbackDigest: canonicalDigest(base.ownerConsumedTip),
    ownerConsumedValueDigest: computeDestinationOwnerValueDigest(base.ownerConsumedValue),
    ownerConsumedValueReadbackDigest: canonicalDigest(base.ownerConsumedValue),
    schemaVersion: "authority-history-genesis-selection-evidence/v1",
    selectedAuthorityPathInstanceDigest: base.core.authorityPathInstanceDigest,
    selectedAuthorityProposalReadbackDigest: canonicalDigest(base.proposal),
    selectedAuthorityReceiptDigest: computeProposalReceiptDigest(base.proposal),
    selectedAuthorityTipDigest: computeCurrentTipDigest(base.tip),
    selectedAuthorityTipReadbackDigest: canonicalDigest(base.tip),
    selectedAuthorityValueDigest: computePointerValueDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      base.core.authorityPathInstanceDigest,
      base.authorityValue,
    ),
    selectedAuthorityValueReadbackDigest: canonicalDigest(base.authorityValue),
    selectionPostReceiptDigest: computeBootstrapGenesisPostSelectionDigest(base.post),
    successorCoreDigest: base.genesisInput.successorCoreDigest,
    useIntentDigest: computeBootstrapAnchorUseIntentDigest(base.intent),
  };
  return { ...base, evidence };
}

function rebuildE0Graph(
  base: ReturnType<typeof fixture>,
  replacements: {
    authorityGlobalIdentityDigest?: string;
    successorCoreDigest?: string;
  },
) {
  const successorCoreDigest =
    replacements.successorCoreDigest ?? base.genesisInput.successorCoreDigest;
  const genesisInput = { ...base.genesisInput, successorCoreDigest };
  const genesisBootstrapInputDigest = computeGenesisBootstrapInputDigest(genesisInput);
  const history = {
    ...base.history,
    genesisBootstrapInputDigest,
    successorCoreDigest,
  };
  const genesisHistoryRecordDigest = computeAuthorityHistoryRecordDigest(history);
  const authorityValue = {
    ...base.authorityValue,
    globalIdentityDigest:
      replacements.authorityGlobalIdentityDigest ?? base.authorityValue.globalIdentityDigest,
    headRecordDigest: genesisHistoryRecordDigest,
  };
  const authorityValueDigest = computePointerValueDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    base.core.authorityPathInstanceDigest,
    authorityValue,
  );
  const core = {
    ...base.core,
    authorityValueDigest,
    genesisBootstrapInputDigest,
    genesisHistoryRecordDigest,
    successorCoreDigest,
  };
  const bootstrapGenesisCoreDigest = computeBootstrapGenesisCoreDigest(core);
  const authorityIdentity = {
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION" as const,
    canonicalPointerPath: stateMutationAuthorityPath,
    installationId: base.anchor.installationId,
    projectId: base.anchor.projectId,
    stateRootDigest: base.anchor.stateRootDigest,
    transactionId: null,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE" as const, parts: {} },
  };
  const proposal = {
    ...base.proposal,
    mutationId: computeMutationId({
      ...authorityIdentity,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: authorityValueDigest,
      outcome: "SELECT",
    }),
    producerDigest: bootstrapGenesisCoreDigest,
    successorValueDigest: authorityValueDigest,
  };
  const receiptDigest = computeProposalReceiptDigest(proposal);
  const tip = {
    ...base.tip,
    proposalReceiptDigest: receiptDigest,
    valueDigest: authorityValueDigest,
  };
  const tipDigest = computeCurrentTipDigest(tip);
  const post = {
    ...base.post,
    bootstrapGenesisCoreDigest,
    proposalReadbackDigest: canonicalDigest(proposal),
    receiptDigest,
    tipDigest,
    tipReadbackDigest: canonicalDigest(tip),
    valueDigest: authorityValueDigest,
    valueReadbackDigest: canonicalDigest(authorityValue),
  };
  return {
    ...base,
    authorityValue,
    core,
    genesisInput,
    history,
    post,
    proposal,
    tip,
  };
}

function validateSelection(f: ReturnType<typeof selectionFixture>) {
  return validateGenesisSelectionEvidenceBinding(
    f.evidence,
    f.genesisInput,
    f.history,
    f.anchor,
    f.intent,
    f.core,
    f.operation,
    f.successorCore,
    f.activeReleaseValue,
    f.activeReleaseProposal,
    f.activeReleaseTip,
    f.globalIdentity,
    f.priorOwnerTip,
    f.priorOwnerValue,
    f.priorOwnerProposal,
    f.ownerTeardownArchive,
    f.successorReviewCore,
    f.successorReviewExpected,
    f.successorPostSelection,
    f.successorPostExpected,
    f.physical,
    f.observation,
    f.absence,
    f.intentExpected,
    f.absenceExpected,
    f.authorityValue,
    f.proposal,
    f.tip,
    f.post,
    f.anchorTip,
    f.anchorValue,
    f.anchorProposal,
    f.anchorConsumedTip,
    f.anchorConsumedValue,
    f.anchorConsumedProposal,
    f.ownerTip,
    f.ownerValue,
    f.ownerProposal,
    f.ownerConsumedTip,
    f.ownerConsumedValue,
    f.ownerConsumedProposal,
    f.receipt,
  );
}

function consumedRetirementFixture(
  base: ReturnType<typeof selectionFixture> = selectionFixture(),
  timing: { retirementAbsenceObservedAt?: string } = {},
) {
  const anchorDigest = computeBootstrapAnchorDigest(base.anchor);
  const retirementAbsence = {
    ...base.absence,
    observedAt: timing.retirementAbsenceObservedAt ?? "2026-08-19T12:08:00.000Z",
    reason: "DESTINATION_STATE_ROOT_ABSENT",
  };
  const destinationAbsenceDigest =
    computeExternalDestinationAbsenceObservationDigest(retirementAbsence);
  const lifecycleArchive = {
    anchorDigest,
    archivedAt: "2026-08-19T12:09:00.000Z",
    archivedReceiptDigest: computeBootstrapAnchorProposalDigest(base.anchorConsumedProposal),
    archivedTipDigest: computeBootstrapAnchorTipDigest(base.anchorConsumedTip),
    archivedValueDigest: computeBootstrapAnchorValueDigest(base.anchorConsumedValue),
    destinationAbsenceDigest,
    lifecycle: "CONSUMED",
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
  };
  const teardownReceipt = {
    anchorDigest,
    destinationDigest: base.anchor.destinationDigest,
    externalArchiveDigest: computeBootstrapAnchorLifecycleArchiveDigest(lifecycleArchive),
    priorAnchorReceiptDigest: lifecycleArchive.archivedReceiptDigest,
    priorAnchorTipDigest: lifecycleArchive.archivedTipDigest,
    priorAnchorValueDigest: lifecycleArchive.archivedValueDigest,
    processCustodyProofDigest: d("3"),
    retirementTransition: "RETIRE_CONSUMED",
    schemaVersion: "state-mutation-bootstrap-anchor-teardown-receipt/v1",
    selectedOwnerReceiptDigest: computeDestinationOwnerProposalDigest(base.ownerConsumedProposal),
    selectedOwnerTipDigest: computeDestinationOwnerTipDigest(base.ownerConsumedTip),
    selectedOwnerValueDigest: computeDestinationOwnerValueDigest(base.ownerConsumedValue),
    teardownEvidenceDigest: destinationAbsenceDigest,
  };
  const teardownReceiptDigest = computeBootstrapAnchorTeardownReceiptDigest(teardownReceipt);
  const anchorRetiredValue = {
    anchorDigest,
    bootstrapGenesisCoreDigest: null,
    lifecycle: "RETIRED",
    lifecycleOrdinal: incrementCanonicalDecimal(base.anchorConsumedValue.lifecycleOrdinal),
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    selectedAuthorityPathInstanceDigest: null,
    selectedAuthorityReceiptDigest: null,
    selectedAuthorityTipDigest: null,
    selectedAuthorityValueDigest: null,
    selectionPostReceiptDigest: null,
    teardownReceiptDigest,
  };
  const anchorRetiredValueDigest = computeBootstrapAnchorValueDigest(anchorRetiredValue);
  const anchorRetiredProposalBase = {
    anchorDigest,
    mutationId: d("0"),
    priorReceiptDigest: lifecycleArchive.archivedReceiptDigest,
    priorTipDigest: lifecycleArchive.archivedTipDigest,
    priorValueDigest: lifecycleArchive.archivedValueDigest,
    proposedAt: "2026-08-19T12:10:00.000Z",
    schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
    source: "TEARDOWN",
    successorValueDigest: anchorRetiredValueDigest,
    transition: "RETIRE_CONSUMED",
    transitionEvidenceDigest: teardownReceiptDigest,
  };
  const anchorRetiredProposal = {
    ...anchorRetiredProposalBase,
    mutationId: computeBootstrapAnchorMutationId(
      base.anchor,
      anchorRetiredProposalBase,
      anchorRetiredValue,
    ),
  };
  const anchorRetiredReceiptDigest = computeBootstrapAnchorProposalDigest(anchorRetiredProposal);
  const anchorRetiredTip = {
    anchorDigest,
    proposalReceiptDigest: anchorRetiredReceiptDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest: anchorRetiredValueDigest,
  };
  const anchorRetiredTipDigest = computeBootstrapAnchorTipDigest(anchorRetiredTip);
  const ownerArchive = {
    anchorRetiredReceiptDigest,
    anchorRetiredTipDigest,
    anchorRetiredValueDigest,
    destinationDigest: base.anchor.destinationDigest,
    installationId: base.anchor.installationId,
    observationDigest: destinationAbsenceDigest,
    priorOwnerReceiptDigest: teardownReceipt.selectedOwnerReceiptDigest,
    priorOwnerTipDigest: teardownReceipt.selectedOwnerTipDigest,
    priorOwnerValueDigest: teardownReceipt.selectedOwnerValueDigest,
    schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
    teardownReceiptDigest,
  };
  const ownerArchiveDigest = computeDestinationOwnerTeardownArchiveDigest(ownerArchive);
  const ownerRetiredValue = {
    anchorDigest,
    anchorReceiptDigest: anchorRetiredReceiptDigest,
    anchorTipDigest: anchorRetiredTipDigest,
    anchorValueDigest: anchorRetiredValueDigest,
    destinationDigest: base.anchor.destinationDigest,
    installationId: base.anchor.installationId,
    lifecycle: "RETIRED",
    ownerOrdinal: incrementCanonicalDecimal(base.ownerConsumedValue.ownerOrdinal),
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: null,
    teardownArchiveDigest: ownerArchiveDigest,
  };
  const ownerRetiredValueDigest = computeDestinationOwnerValueDigest(ownerRetiredValue);
  const ownerRetiredProposalBase = {
    destinationDigest: base.anchor.destinationDigest,
    mutationId: d("0"),
    observationDigest: computePhysicalLocatorObservationDigest(base.observation),
    positionDigest: computeDestinationOwnerPositionDigest(base.anchor.destinationDigest),
    priorReceiptDigest: teardownReceipt.selectedOwnerReceiptDigest,
    priorTipDigest: teardownReceipt.selectedOwnerTipDigest,
    priorValueDigest: teardownReceipt.selectedOwnerValueDigest,
    proposedAt: "2026-08-19T12:11:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: "ANCHOR_RETIRED",
    successorValueDigest: ownerRetiredValueDigest,
    transition: "RETIRE_CONSUMED",
    transitionEvidenceDigest: ownerArchiveDigest,
  };
  const ownerRetiredProposal = {
    ...ownerRetiredProposalBase,
    mutationId: computeDestinationOwnerMutationId(ownerRetiredProposalBase, ownerRetiredValue),
  };
  const ownerRetiredReceiptDigest = computeDestinationOwnerProposalDigest(ownerRetiredProposal);
  const ownerRetiredTip = {
    destinationDigest: base.anchor.destinationDigest,
    proposalReceiptDigest: ownerRetiredReceiptDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: ownerRetiredValueDigest,
  };
  const retirementAbsenceExpected = {
    ...base.absenceExpected,
    reason: "DESTINATION_STATE_ROOT_ABSENT",
  };
  const teardownExpected = {
    anchorDigest,
    destinationAbsenceDigest,
    destinationDigest: base.anchor.destinationDigest,
    priorAnchorReceiptDigest: lifecycleArchive.archivedReceiptDigest,
    priorAnchorTipDigest: lifecycleArchive.archivedTipDigest,
    priorAnchorValueDigest: lifecycleArchive.archivedValueDigest,
    processCustodyProofDigest: d("3"),
    retirementTransition: "RETIRE_CONSUMED",
    selectedOwnerReceiptDigest: teardownReceipt.selectedOwnerReceiptDigest,
    selectedOwnerTipDigest: teardownReceipt.selectedOwnerTipDigest,
    selectedOwnerValueDigest: teardownReceipt.selectedOwnerValueDigest,
  };
  return {
    ...base,
    anchorRetiredProposal,
    anchorRetiredTip,
    anchorRetiredValue,
    lifecycleArchive,
    ownerArchive,
    ownerRetiredProposal,
    ownerRetiredTip,
    ownerRetiredValue,
    retirementAbsence,
    retirementAbsenceExpected,
    teardownExpected,
    teardownReceipt,
  };
}

function successorConsumedRetirementFixture(
  timing: Parameters<typeof successorFixture>[0] & {
    consumedAt?: string;
    retirementAbsenceObservedAt?: string;
  } = {},
) {
  const consumptionTiming =
    timing.consumedAt === undefined ? {} : { consumedAt: timing.consumedAt };
  const retirementTiming =
    timing.retirementAbsenceObservedAt === undefined
      ? {}
      : { retirementAbsenceObservedAt: timing.retirementAbsenceObservedAt };
  return consumedRetirementFixture(
    selectionFixture(consumptionFixture(successorFixture(timing), consumptionTiming)),
    retirementTiming,
  );
}

function validateConsumedRetirement(f: ReturnType<typeof consumedRetirementFixture>) {
  return validateBootstrapConsumedRetirementBinding(
    f.anchor,
    f.anchorConsumedTip,
    f.anchorConsumedValue,
    f.anchorConsumedProposal,
    f.ownerConsumedTip,
    f.ownerConsumedValue,
    f.ownerConsumedProposal,
    f.physical,
    f.observation,
    f.retirementAbsence,
    f.lifecycleArchive,
    f.teardownReceipt,
    f.retirementAbsenceExpected,
    f.teardownExpected,
    f.anchorRetiredTip,
    f.anchorRetiredValue,
    f.anchorRetiredProposal,
    f.ownerArchive,
    f.ownerRetiredTip,
    f.ownerRetiredValue,
    f.ownerRetiredProposal,
    f.evidence,
    f.genesisInput,
    f.history,
    f.intent,
    f.core,
    f.operation,
    f.successorCore,
    f.activeReleaseValue,
    f.activeReleaseProposal,
    f.activeReleaseTip,
    f.globalIdentity,
    f.priorOwnerTip,
    f.priorOwnerValue,
    f.priorOwnerProposal,
    f.ownerTeardownArchive,
    f.successorReviewCore,
    f.successorReviewExpected,
    f.successorPostSelection,
    f.successorPostExpected,
    f.physical,
    f.observation,
    f.absence,
    f.intentExpected,
    f.absenceExpected,
    f.authorityValue,
    f.proposal,
    f.tip,
    f.post,
    f.anchorTip,
    f.anchorValue,
    f.anchorProposal,
    f.ownerTip,
    f.ownerValue,
    f.ownerProposal,
    f.receipt,
  );
}

describe("bootstrap E0 core and post-selection", () => {
  test.each([
    ["genesis", fixture()],
    ["successor", successorFixture()],
  ] as const)("accepts %s-anchor E0", (_branch, f) => {
    expect(validateCore(f)).toEqual([]);
    expect(validatePost(f)).toEqual([]);
  });

  test("closes schemas, digest framing, and contract dispatch", () => {
    const f = fixture();
    expect(parseActiveReleaseValue(f.activeReleaseValue).ok).toBe(true);
    expect(parseBootstrapGenesisCore(f.core).ok).toBe(true);
    expect(parseBootstrapGenesisPostSelection(f.post).ok).toBe(true);
    expect(parseContract("state-mutation-bootstrap-genesis-core/v1", f.core).ok).toBe(true);
    expect(
      parseContract("state-mutation-bootstrap-genesis-post-selection-receipt/v1", f.post).ok,
    ).toBe(true);
    expect(parseContract("active-release/v1", f.activeReleaseValue).ok).toBe(true);
    expect(pointerGraphSchemaFields.activeRelease).toEqual(
      Object.keys(f.activeReleaseValue).sort(),
    );
    expect(
      pointerRootPaths("ACTIVE_RELEASE", { releaseDigest: f.activeReleaseValue.releaseDigest }),
    ).toEqual([`releases/${f.activeReleaseValue.releaseDigest}/`]);
    expect(bootstrapGenesisSchemaFields.core).toEqual(Object.keys(f.core).sort());
    expect(bootstrapGenesisSchemaFields.post).toEqual(Object.keys(f.post).sort());
    expect({
      core: computeBootstrapGenesisCoreDigest(f.core),
      post: computeBootstrapGenesisPostSelectionDigest(f.post),
    }).toEqual({
      core: "681e300e5ab60c766bfcf90b92b188da852e041e31f8751e9edaaa35a44d2d28",
      post: "1c686e33c981c74e3ee0e9c6ede0a49271f6e8875950682cc28bfa2c2c0bd1a1",
    });
  });

  test("refuses coordinated upstream and authority substitutions", () => {
    const f = fixture();
    expect(validateCore(f, { ...f.core, destinationDigest: d("1") })).toContain(
      "destinationDigest:mismatch",
    );
    expect(validateCore(f, { ...f.core, authorityPathInstanceDigest: d("2") })).toContain(
      "authorityPathInstanceDigest:mismatch",
    );
    expect(validateCore(f, { ...f.core, genesisPositionDigest: d("3") })).toContain(
      "genesisPositionDigest:mismatch",
    );
    expect(validateCore(f, { ...f.core, destinationAbsenceDigest: d("4") })).toContain(
      "destinationAbsenceDigest:mismatch",
    );
    expect(validateCore(f, f.core, { ...f.globalIdentity, custodyInstanceDigest: d("5") })).toEqual(
      expect.arrayContaining([
        "globalIdentity.custodyInstanceDigest:mismatch",
        "globalIdentityDigest:mismatch",
      ]),
    );
    expect(
      validateCore(f, f.core, f.globalIdentity, {
        ...f.observation,
        validUntil: "2026-08-19T12:05:00.000Z",
      }),
    ).toContain("effectiveObservation:effectiveAt:after-validity");
  });

  test("refuses self-epoch, producer, graph, and readback substitution", () => {
    const f = fixture();
    expect(
      validateBootstrapGenesisPostSelectionBinding(
        f.post,
        f.core,
        f.anchor,
        f.authorityValue,
        { ...f.proposal, producerKind: "SELECTED_EPOCH" },
        f.tip,
        f.postExpected,
      ),
    ).not.toEqual([]);
    expect(validatePost(f, { ...f.post, valueReadbackDigest: d("1") })).toContain(
      "valueReadbackDigest:mismatch",
    );
    expect(validatePost(f, { ...f.post, receiptDigest: d("2") })).toContain(
      "receiptDigest:mismatch",
    );

    const successor = successorFixture();
    const substitutedPost = {
      ...successor.successorPostSelection,
      proposalReadbackDigest: d("3"),
      tipReadbackDigest: d("4"),
      valueReadbackDigest: d("5"),
    };
    const substitutedIntentExpected = {
      ...successor.intentExpected,
      successorPostSelectionReceipt: substitutedPost,
      successorPostSelectionReceiptDigest:
        computeDestinationOwnerSuccessorPostSelectionDigest(substitutedPost),
      successorPostSelectionReceiptReadbackDigest: canonicalDigest(substitutedPost),
    };
    const substitutedPostExpected = {
      ...successor.successorPostExpected,
      proposalReadbackDigest: substitutedPost.proposalReadbackDigest,
      tipReadbackDigest: substitutedPost.tipReadbackDigest,
      valueReadbackDigest: substitutedPost.valueReadbackDigest,
    };
    expect(
      validateCore({
        ...successor,
        intentExpected: substitutedIntentExpected,
        successorPostExpected: substitutedPostExpected,
        successorPostSelection: substitutedPost,
      }),
    ).toEqual(
      expect.arrayContaining([
        "successorPost:proposalReadbackDigest:derived:mismatch",
        "successorPost:tipReadbackDigest:derived:mismatch",
        "successorPost:valueReadbackDigest:derived:mismatch",
      ]),
    );

    const substitutedAuthority = {
      ...successor.successorReviewCore.successorAuthority,
      bootstrapGrantDigest: d("6"),
    };
    const substitutedReviewBase = {
      ...successor.successorReviewCore,
      successorAuthority: substitutedAuthority,
    };
    const substitutedReview = {
      ...substitutedReviewBase,
      independentReview: {
        ...substitutedReviewBase.independentReview,
        candidateDigest:
          computeDestinationOwnerSuccessorReviewCandidateDigest(substitutedReviewBase),
      },
    };
    expect(
      validateCore({
        ...successor,
        successorReviewCore: substitutedReview,
        successorReviewExpected: {
          ...successor.successorReviewExpected,
          candidateDigest: substitutedReview.independentReview.candidateDigest,
          successorAuthority: substitutedAuthority,
        },
      }),
    ).toContain("successorAuthority.bootstrapGrantDigest:mismatch");
  });

  test("closes the direct active-release value and N0 reviewed-bootstrap graph", () => {
    const f = fixture();
    for (const field of pointerGraphSchemaFields.activeRelease.filter((name) =>
      name.endsWith("Digest"),
    )) {
      expect(parseActiveReleaseValue({ ...f.activeReleaseValue, [field]: null }).ok).toBe(false);
      expect(parseActiveReleaseValue({ ...f.activeReleaseValue, [field]: "not-a-digest" }).ok).toBe(
        false,
      );
    }
    const { installedBytesDigest: _removed, ...missing } = f.activeReleaseValue;
    expect(parseActiveReleaseValue(missing).ok).toBe(false);
    expect(parseActiveReleaseValue({ ...f.activeReleaseValue, extra: d("a") }).ok).toBe(false);
    const releaseMismatch = parseActiveReleaseValue({
      ...f.activeReleaseValue,
      releaseDigest: d("b"),
    });
    expect(releaseMismatch.ok ? [] : releaseMismatch.issues).toContain(
      "releaseDigest:subject-mismatch",
    );
    expect(
      parseActiveReleaseValue({ ...f.activeReleaseValue, schemaVersion: "active-release/v2" }).ok,
    ).toBe(false);

    for (const field of [
      "independentReviewReceiptDigest",
      "installedBytesDigest",
      "releaseManifestDigest",
      "reviewedInstallerDigest",
    ] as const)
      expect(
        validateCore({
          ...f,
          activeReleaseValue: { ...f.activeReleaseValue, [field]: d("9") },
        }),
      ).toContain(`activeReleaseValue.${field}:mismatch`);
    expect(
      validateCore({
        ...f,
        activeReleaseValue: {
          ...f.activeReleaseValue,
          releaseDigest: d("a"),
          releaseSubjectDigest: d("a"),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "activeReleaseValue.releaseDigest:mismatch",
        "activeReleaseValue.releaseSubjectDigest:mismatch",
      ]),
    );
    for (const [field, issue] of [
      ["activeReleasePathInstanceDigest", "authority.activeReleasePathInstanceDigest:mismatch"],
      ["activeReleaseReceiptDigest", "authority.activeReleaseReceiptDigest:mismatch"],
      ["activeReleaseTipDigest", "authority.activeReleaseTipDigest:mismatch"],
      ["activeReleaseValueDigest", "authority.activeReleaseValueDigest:mismatch"],
    ] as const)
      expect(
        validateCore({ ...f, authorityValue: { ...f.authorityValue, [field]: d("b") } }),
      ).toContain(issue);

    expect(
      validateCore({
        ...f,
        activeReleaseProposal: { ...f.activeReleaseProposal, producerDigest: d("c") },
      }),
    ).toContain("activeReleaseProposal.producerDigest:mismatch");
    expect(
      validateCore({
        ...f,
        activeReleaseProposal: { ...f.activeReleaseProposal, positionDigest: d("d") },
      }),
    ).toContain("activeReleaseProposal.positionDigest:mismatch");
    expect(
      validateCore({
        ...f,
        activeReleaseProposal: { ...f.activeReleaseProposal, mutationId: d("e") },
      }),
    ).toContain("activeReleaseProposal.mutationId:mismatch");

    const selectedEpochProposal = {
      ...f.activeReleaseProposal,
      authorityEpochReceiptDigest: d("1"),
      authorityEpochTipDigest: d("2"),
      authorityEpochValueDigest: d("3"),
      producerKind: "SELECTED_EPOCH",
    };
    expect(validateCore({ ...f, activeReleaseProposal: selectedEpochProposal })).toContain(
      "activeReleaseProposal:producerKind:active-release-prior-mismatch",
    );
    expect(
      validateCore({
        ...f,
        activeReleaseProposal: {
          ...f.activeReleaseProposal,
          priorReceiptDigest: d("4"),
          priorTipDigest: d("5"),
          priorValueDigest: d("6"),
        },
      }),
    ).not.toEqual([]);
    expect(
      validateCore({
        ...f,
        activeReleaseProposal: {
          ...f.activeReleaseProposal,
          authorityEpochReceiptDigest: d("4"),
          authorityEpochTipDigest: d("5"),
          authorityEpochValueDigest: d("6"),
        },
      }),
    ).not.toEqual([]);

    const substitutedValue = {
      ...f.activeReleaseValue,
      independentReviewReceiptDigest: d("4"),
      installedBytesDigest: d("5"),
      releaseDigest: d("6"),
      releaseManifestDigest: d("7"),
      releaseSubjectDigest: d("6"),
      reviewedInstallerDigest: d("8"),
    };
    expect(validateCore(rebuildActiveRelease(f, substitutedValue))).toEqual(
      expect.arrayContaining([
        "activeReleaseValue.independentReviewReceiptDigest:mismatch",
        "activeReleaseValue.installedBytesDigest:mismatch",
        "activeReleaseValue.releaseDigest:mismatch",
        "activeReleaseValue.releaseManifestDigest:mismatch",
        "activeReleaseValue.releaseSubjectDigest:mismatch",
        "activeReleaseValue.reviewedInstallerDigest:mismatch",
      ]),
    );

    const foreignDp = d("9");
    const foreignDv = computePointerValueDigest("ACTIVE_RELEASE", foreignDp, f.activeReleaseValue);
    const foreignProposal = {
      ...f.activeReleaseProposal,
      mutationId: d("a"),
      pathInstanceDigest: foreignDp,
      successorValueDigest: foreignDv,
    };
    const foreignDr = computeProposalReceiptDigest(foreignProposal);
    const foreignTip = {
      ...f.activeReleaseTip,
      pathInstanceDigest: foreignDp,
      proposalReceiptDigest: foreignDr,
      valueDigest: foreignDv,
    };
    const foreignDt = computeCurrentTipDigest(foreignTip);
    const foreignAuthority = {
      ...f.authorityValue,
      activeReleasePathInstanceDigest: foreignDp,
      activeReleaseReceiptDigest: foreignDr,
      activeReleaseTipDigest: foreignDt,
      activeReleaseValueDigest: foreignDv,
    };
    expect(
      validateCore({
        ...f,
        activeReleaseProposal: foreignProposal,
        activeReleaseTip: foreignTip,
        authorityValue: foreignAuthority,
        core: {
          ...f.core,
          authorityValueDigest: computePointerValueDigest(
            "STATE_MUTATION_AUTHORITY_ROTATION",
            f.core.authorityPathInstanceDigest,
            foreignAuthority,
          ),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "activeReleaseProposal.pathInstanceDigest:mismatch",
        "activeReleaseTip.pathInstanceDigest:mismatch",
        "authority.activeReleasePathInstanceDigest:mismatch",
      ]),
    );
  });

  test("fails closed for malformed, future, and hostile inputs", () => {
    const f = fixture();
    expect(parseBootstrapGenesisCore({ ...f.core, extra: true }).ok).toBe(false);
    expect(
      parseBootstrapGenesisPostSelection({
        ...f.post,
        schemaVersion: "state-mutation-bootstrap-genesis-post-selection-receipt/v2",
      }).ok,
    ).toBe(false);
    expect(() =>
      validateCore(
        f,
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).not.toThrow();
    expect(() => validatePost(f, null)).not.toThrow();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("trap");
        },
      },
    );
    expect(() => validateCore({ ...f, activeReleaseValue: hostile })).not.toThrow();
    expect(() => validateCore({ ...f, activeReleaseProposal: hostile })).not.toThrow();
    expect(() => validateCore({ ...f, activeReleaseTip: hostile })).not.toThrow();
  });
});

describe("bootstrap anchor consumption", () => {
  test.each([
    ["genesis", consumptionFixture(fixture())],
    ["successor", consumptionFixture(successorFixture())],
  ] as const)("accepts the %s-anchor one-way CONSUMED graph", (_branch, f) => {
    expect(validateConsumption(f)).toEqual([]);
    expect(f.anchorConsumedValue).not.toHaveProperty("consumptionReceiptDigest");
    expect(f.ownerConsumedValue).not.toHaveProperty("consumptionReceiptDigest");
  });

  test("closes the receipt schema, digest, identity, path, and dispatch", () => {
    const f = consumptionFixture();
    expect(parseBootstrapAnchorConsumptionReceipt(f.receipt).ok).toBe(true);
    expect(
      parseContract("state-mutation-bootstrap-anchor-consumption-receipt/v1", f.receipt).ok,
    ).toBe(true);
    expect(bootstrapConsumptionSchemaFields.receipt).toEqual(Object.keys(f.receipt).sort());
    expect({
      digest: computeBootstrapAnchorConsumptionReceiptDigest(f.receipt),
      id: computeBootstrapAnchorConsumptionId(f.receipt),
      path: bootstrapAnchorConsumptionReceiptPath(f.anchor, f.receipt),
    }).toEqual({
      digest: "45412a07503808a5c0a90e96f58c75af0b5287e548454629a5365588899c5ddb",
      id: "d85477f1eb1c4267eef77f78fe99d5321b9b023f363b5b8623bb555cab2c5f30",
      path: "state-mutation-authority-anchors/018f0f4d-7b2d-7a11-8a2b-123456789abc/consumption-receipts/d85477f1eb1c4267eef77f78fe99d5321b9b023f363b5b8623bb555cab2c5f30.json",
    });
  });

  test("binds every receipt digest, selected graph, readback, custody, and time", () => {
    const f = consumptionFixture();
    for (const field of bootstrapConsumptionSchemaFields.receipt.filter((name) =>
      name.endsWith("Digest"),
    ))
      expect(validateConsumption({ ...f, receipt: { ...f.receipt, [field]: d("0") } })).toContain(
        `${field}:mismatch`,
      );
    expect(
      validateConsumption({
        ...f,
        anchorConsumedValue: {
          ...f.anchorConsumedValue,
          selectionPostReceiptDigest: d("1"),
        },
      }),
    ).not.toEqual([]);
    expect(
      validateConsumption({
        ...f,
        ownerConsumedValue: {
          ...f.ownerConsumedValue,
          anchorTipDigest: d("2"),
        },
      }),
    ).not.toEqual([]);
    expect(
      validateConsumption({
        ...f,
        ownerConsumedProposal: {
          ...f.ownerConsumedProposal,
          observationDigest: d("3"),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "ownerConsumedBinding:observationDigest:mismatch",
        "ownerConsumedProposal.observationDigest:mismatch",
      ]),
    );

    const substitutedAnchorValue = {
      ...f.anchorConsumedValue,
      selectionPostReceiptDigest: d("4"),
    };
    const substitutedAnchorValueDigest = computeBootstrapAnchorValueDigest(substitutedAnchorValue);
    const substitutedAnchorProposalBase = {
      ...f.anchorConsumedProposal,
      successorValueDigest: substitutedAnchorValueDigest,
    };
    const substitutedAnchorProposal = {
      ...substitutedAnchorProposalBase,
      mutationId: computeBootstrapAnchorMutationId(
        f.anchor,
        substitutedAnchorProposalBase,
        substitutedAnchorValue,
      ),
    };
    const substitutedAnchorReceiptDigest =
      computeBootstrapAnchorProposalDigest(substitutedAnchorProposal);
    const substitutedAnchorTip = {
      ...f.anchorConsumedTip,
      proposalReceiptDigest: substitutedAnchorReceiptDigest,
      valueDigest: substitutedAnchorValueDigest,
    };
    const substitutedAnchorTipDigest = computeBootstrapAnchorTipDigest(substitutedAnchorTip);
    const substitutedOwnerValue = {
      ...f.ownerConsumedValue,
      anchorReceiptDigest: substitutedAnchorReceiptDigest,
      anchorTipDigest: substitutedAnchorTipDigest,
      anchorValueDigest: substitutedAnchorValueDigest,
    };
    const substitutedOwnerValueDigest = computeDestinationOwnerValueDigest(substitutedOwnerValue);
    const substitutedOwnerProposalBase = {
      ...f.ownerConsumedProposal,
      successorValueDigest: substitutedOwnerValueDigest,
      transitionEvidenceDigest: substitutedAnchorTipDigest,
    };
    const substitutedOwnerProposal = {
      ...substitutedOwnerProposalBase,
      mutationId: computeDestinationOwnerMutationId(
        substitutedOwnerProposalBase,
        substitutedOwnerValue,
      ),
    };
    const substitutedOwnerReceiptDigest =
      computeDestinationOwnerProposalDigest(substitutedOwnerProposal);
    const substitutedOwnerTip = {
      ...f.ownerConsumedTip,
      proposalReceiptDigest: substitutedOwnerReceiptDigest,
      valueDigest: substitutedOwnerValueDigest,
    };
    const substitutedOwnerTipDigest = computeDestinationOwnerTipDigest(substitutedOwnerTip);
    expect(
      validateConsumption({
        ...f,
        anchorConsumedProposal: substitutedAnchorProposal,
        anchorConsumedTip: substitutedAnchorTip,
        anchorConsumedValue: substitutedAnchorValue,
        ownerConsumedProposal: substitutedOwnerProposal,
        ownerConsumedTip: substitutedOwnerTip,
        ownerConsumedValue: substitutedOwnerValue,
        receipt: {
          ...f.receipt,
          destinationOwnerConsumedReceiptDigest: substitutedOwnerReceiptDigest,
          destinationOwnerConsumedTipDigest: substitutedOwnerTipDigest,
          destinationOwnerConsumedValueDigest: substitutedOwnerValueDigest,
          externalAnchorProposalReadbackDigest: canonicalDigest(substitutedAnchorProposal),
          externalAnchorTipReadbackDigest: canonicalDigest(substitutedAnchorTip),
          externalAnchorValueReadbackDigest: canonicalDigest(substitutedAnchorValue),
        },
      }),
    ).toContain("anchorConsumedValue.selectionPostReceiptDigest:mismatch");
    expect(
      validateConsumption({
        ...f,
        receipt: { ...f.receipt, consumedAt: "2026-08-19T12:00:00.000Z" },
      }),
    ).toEqual(
      expect.arrayContaining([
        "consumedAt:before-anchor-consumed",
        "consumedAt:before-owner-consumed",
        "consumedAt:before-runtime-post",
      ]),
    );
  });

  test.each(["destinationOwnerActiveTipDigest", "reviewReceiptDigest", "globalIdentityDigest"])(
    "binds a substituted use-intent %s through the selected Dgb",
    (field) => {
      const f = consumptionFixture();
      const intent =
        field === "destinationOwnerActiveTipDigest"
          ? { ...f.intent, destinationOwnerActiveTipDigest: d("7") }
          : field === "reviewReceiptDigest"
            ? {
                ...f.intent,
                reviewedInstaller: {
                  ...f.intent.reviewedInstaller,
                  reviewReceiptDigest: d("7"),
                },
              }
            : {
                ...f.intent,
                proposedGenesisInput: {
                  ...f.intent.proposedGenesisInput,
                  globalIdentityDigest: d("7"),
                },
              };
      const useIntentDigest = computeBootstrapAnchorUseIntentDigest(intent);
      expect(
        validateConsumption({
          ...f,
          intent,
          receipt: { ...f.receipt, useIntentDigest },
        }),
      ).toContain("genesisInput.useIntentDigest:mismatch");

      const genesisInput = { ...f.genesisInput, useIntentDigest };
      expect(
        validateConsumption({
          ...f,
          genesisInput,
          intent,
          receipt: { ...f.receipt, useIntentDigest },
        }),
      ).toContain("core.genesisBootstrapInputDigest:mismatch");
    },
  );

  test("fails closed for malformed, future, extended, and hostile receipts", () => {
    const f = consumptionFixture();
    expect(parseBootstrapAnchorConsumptionReceipt({ ...f.receipt, extra: true }).ok).toBe(false);
    expect(
      parseBootstrapAnchorConsumptionReceipt({
        ...f.receipt,
        schemaVersion: "state-mutation-bootstrap-anchor-consumption-receipt/v2",
      }).ok,
    ).toBe(false);
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("trap");
        },
      },
    );
    expect(() => parseBootstrapAnchorConsumptionReceipt(proxy)).not.toThrow();
    expect(() =>
      validateBootstrapAnchorConsumptionBinding(
        proxy,
        f.anchor,
        f.intent,
        f.core,
        f.genesisInput,
        f.authorityValue,
        f.proposal,
        f.tip,
        f.post,
        f.anchorTip,
        f.anchorValue,
        f.anchorProposal,
        f.anchorConsumedTip,
        f.anchorConsumedValue,
        f.anchorConsumedProposal,
        f.ownerTip,
        f.ownerValue,
        f.ownerProposal,
        f.ownerConsumedTip,
        f.ownerConsumedValue,
        f.ownerConsumedProposal,
      ),
    ).not.toThrow();
  });
});

describe("authority-history genesis selection evidence", () => {
  test.each([
    [
      "genesis",
      selectionFixture(consumptionFixture(fixture())),
      "3be26d312cb0cc5bf58aec2328c87b7d97fe326570a64bef35e668b0008393b3",
    ],
    [
      "successor",
      selectionFixture(consumptionFixture(successorFixture())),
      "ca0b056776ed1c207803246e8555d728683c62dfa12b3d778b08ef3c2e07507e",
    ],
  ] as const)("accepts the complete %s-origin downstream composition", (_branch, f, golden) => {
    expect(validateSelection(f)).toEqual([]);
    expect(parseContract("authority-history-genesis-selection-evidence/v1", f.evidence).ok).toBe(
      true,
    );
    expect(computeGenesisSelectionEvidenceDigest(f.evidence)).toBe(golden);
    expect(f.evidence).not.toHaveProperty("path");
    expect(f.evidence).not.toHaveProperty("mutationId");
    expect(f.evidence).not.toHaveProperty("proposalReceiptDigest");
  });

  test("binds every evidence member to a recomputed selected record", () => {
    const f = selectionFixture();
    for (const field of Object.keys(f.evidence).filter((name) => name.endsWith("Digest")))
      expect(
        validateSelection({
          ...f,
          evidence: { ...f.evidence, [field]: d("0") },
        }),
      ).toContain(`${field}:mismatch`);
    expect(
      validateSelection({
        ...f,
        evidence: { ...f.evidence, bootstrapTransactionId: installationId },
      }),
    ).toContain("bootstrapTransactionId:mismatch");
  });

  test("rejects coordinated upstream, selected-E0, and consumed-graph substitutions", () => {
    const f = selectionFixture();
    const arbitraryDsc = selectionFixture(
      consumptionFixture(rebuildE0Graph(fixture(), { successorCoreDigest: d("0") })),
    );
    expect(validateSelection(arbitraryDsc)).toEqual(
      expect.arrayContaining([
        "coreBinding:genesisInput.successorCoreDigest:mismatch",
        "coreBinding:history.successorCoreDigest:mismatch",
      ]),
    );

    const foreignAuthorityG = selectionFixture(
      consumptionFixture(rebuildE0Graph(fixture(), { authorityGlobalIdentityDigest: d("0") })),
    );
    expect(validateSelection(foreignAuthorityG)).toEqual(
      expect.arrayContaining([
        "authority.globalIdentityDigest:mismatch",
        "coreBinding:authority.globalIdentityDigest:mismatch",
      ]),
    );

    expect(
      validateSelection({
        ...f,
        successorCore: { ...f.successorCore, successorHelperDigest: d("1") },
      }),
    ).not.toEqual([]);

    const genesisInput = { ...f.genesisInput, useIntentDigest: d("2") };
    const genesisBootstrapInputDigest = computeGenesisBootstrapInputDigest(genesisInput);
    expect(
      validateSelection({
        ...f,
        evidence: { ...f.evidence, genesisBootstrapInputDigest },
        genesisInput,
      }),
    ).toEqual(
      expect.arrayContaining([
        "consumptionBinding:core.genesisBootstrapInputDigest:mismatch",
        "genesisInput.useIntentDigest:mismatch",
        "history.genesisBootstrapInputDigest:mismatch",
      ]),
    );

    const authorityValue = { ...f.authorityValue, helperDigest: d("3") };
    const selectedAuthorityValueDigest = computePointerValueDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      f.core.authorityPathInstanceDigest,
      authorityValue,
    );
    expect(
      validateSelection({
        ...f,
        authorityValue,
        evidence: {
          ...f.evidence,
          selectedAuthorityValueDigest,
          selectedAuthorityValueReadbackDigest: canonicalDigest(authorityValue),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "consumptionBinding:runtimePostBinding:core.authorityValueDigest:mismatch",
        "core.authorityValueDigest:mismatch",
      ]),
    );

    const ownerConsumedValue = { ...f.ownerConsumedValue, anchorTipDigest: d("4") };
    const ownerConsumedValueDigest = computeDestinationOwnerValueDigest(ownerConsumedValue);
    expect(
      validateSelection({
        ...f,
        evidence: {
          ...f.evidence,
          ownerConsumedValueDigest,
          ownerConsumedValueReadbackDigest: canonicalDigest(ownerConsumedValue),
        },
        ownerConsumedValue,
      }),
    ).not.toEqual([]);
  });

  test("is total for malformed and hostile nested inputs", () => {
    const f = selectionFixture();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("trap");
        },
      },
    );
    expect(() =>
      validateSelection({ ...f, evidence: hostile as unknown as typeof f.evidence }),
    ).not.toThrow();
    expect(() =>
      validateSelection({ ...f, genesisInput: hostile as unknown as typeof f.genesisInput }),
    ).not.toThrow();
    expect(() =>
      validateSelection({ ...f, receipt: hostile as unknown as typeof f.receipt }),
    ).not.toThrow();
    expect(validateSelection({ ...f, evidence: null as unknown as typeof f.evidence })).not.toEqual(
      [],
    );
  });
});

describe("consumed retirement provenance", () => {
  test.each([
    ["genesis", consumedRetirementFixture(selectionFixture(consumptionFixture(fixture())))],
    ["successor", successorConsumedRetirementFixture()],
  ] as const)("accepts the complete %s-origin CONSUMED retirement", (_branch, f) => {
    expect(validateConsumedRetirement(f)).toEqual([]);
  });

  test.each([
    [
      "review before prior RETIRED",
      { reviewedAt: "2026-08-19T11:09:00.000Z" },
      "successorChronology:review-before-prior-retired",
    ],
    [
      "ACTIVE before review",
      { selectedOwnerProposedAt: "2026-08-19T11:19:00.000Z" },
      "successorChronology:active-before-review",
    ],
    [
      "post-selection before ACTIVE",
      { successorPostObservedAt: "2026-08-19T12:00:00.000Z" },
      "successorChronology:post-before-active",
    ],
    [
      "retirement absence before post-selection",
      { successorPostObservedAt: "2026-08-19T12:08:30.000Z" },
      "successorChronology:absence-before-post",
    ],
  ] as const)("refuses fully rebuilt successor chronology: %s", (_case, timing, issue) => {
    expect(validateConsumedRetirement(successorConsumedRetirementFixture(timing))).toEqual([issue]);
  });

  test.each([
    [
      "prior RETIRED equals review",
      {
        priorRetiredProposedAt: "2026-08-19T11:10:00.000Z",
        reviewedAt: "2026-08-19T11:10:00.000Z",
      },
    ],
    [
      "review equals ACTIVE",
      {
        reviewedAt: "2026-08-19T11:20:00.000Z",
        selectedOwnerProposedAt: "2026-08-19T11:20:00.000Z",
      },
    ],
    [
      "ACTIVE equals post-selection",
      {
        selectedOwnerProposedAt: "2026-08-19T12:00:01.000Z",
        successorPostObservedAt: "2026-08-19T12:00:01.000Z",
      },
    ],
    [
      "post-selection equals retirement absence",
      {
        successorPostObservedAt: "2026-08-19T12:08:00.000Z",
        retirementAbsenceObservedAt: "2026-08-19T12:08:00.000Z",
      },
    ],
    [
      "consumption equals retirement absence",
      {
        consumedAt: "2026-08-19T12:08:00.000Z",
        retirementAbsenceObservedAt: "2026-08-19T12:08:00.000Z",
      },
    ],
  ] as const)("accepts the inclusive chronology boundary: %s", (_case, timing) => {
    expect(validateConsumedRetirement(successorConsumedRetirementFixture(timing))).toEqual([]);
  });

  test("refuses substituted Dgse, E0/consumption, and retirement chronology", () => {
    const f = consumedRetirementFixture();
    expect(
      validateConsumedRetirement({
        ...f,
        evidence: { ...f.evidence, selectionPostReceiptDigest: d("0") },
      }),
    ).toContain("genesisSelectionBinding:selectionPostReceiptDigest:mismatch");
    expect(
      validateConsumedRetirement({
        ...f,
        receipt: { ...f.receipt, consumedAt: "2026-08-19T12:08:30.000Z" },
      }),
    ).toContain("consumedChronology:absence-before-consumption");
    expect(
      validateConsumedRetirement({
        ...f,
        ownerConsumedValue: { ...f.ownerConsumedValue, anchorTipDigest: d("1") },
      }),
    ).not.toEqual([]);
  });
});

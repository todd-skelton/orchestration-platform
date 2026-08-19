import { describe, expect, test } from "vitest";
import {
  bootstrapGenesisSchemaFields,
  canonicalDigest,
  computeAuthorityHistoryRecordDigest,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
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
  parseBootstrapGenesisCore,
  parseBootstrapGenesisPostSelection,
  parseContract,
  stateMutationAuthorityPath,
  validateBootstrapGenesisCoreBinding,
  validateBootstrapGenesisPostSelectionBinding,
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
    proposedAt: "2026-08-19T12:00:01.000Z",
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
          observedAt: "2026-08-19T12:00:02.000Z",
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
  const coreExpected = {
    activeReleasePathInstanceDigest: d("2"),
    activeReleaseReceiptDigest: d("3"),
    activeReleaseTipDigest: d("4"),
    activeReleaseValueDigest: d("5"),
  };
  const authorityValue = {
    activeReleasePathInstanceDigest: coreExpected.activeReleasePathInstanceDigest,
    activeReleaseReceiptDigest: coreExpected.activeReleaseReceiptDigest,
    activeReleaseTipDigest: coreExpected.activeReleaseTipDigest,
    activeReleaseValueDigest: coreExpected.activeReleaseValueDigest,
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
    authorityValue,
    core,
    coreExpected,
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

function successorFixture() {
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
    proposedAt: "2026-08-19T11:10:00.000Z",
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
    reviewedAt: "2026-08-19T11:20:00.000Z",
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
  const base = fixture(reviewCoreDigest, {
    proposalDigest: priorOwnerReceiptDigest,
    tipDigest: priorOwnerTipDigest,
    valueDigest: priorOwnerValueDigest,
  });
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

function validateCore(
  f: ReturnType<typeof fixture> | ReturnType<typeof successorFixture>,
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
    f.coreExpected,
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
    expect(parseBootstrapGenesisCore(f.core).ok).toBe(true);
    expect(parseBootstrapGenesisPostSelection(f.post).ok).toBe(true);
    expect(parseContract("state-mutation-bootstrap-genesis-core/v1", f.core).ok).toBe(true);
    expect(
      parseContract("state-mutation-bootstrap-genesis-post-selection-receipt/v1", f.post).ok,
    ).toBe(true);
    expect(bootstrapGenesisSchemaFields.core).toEqual(Object.keys(f.core).sort());
    expect(bootstrapGenesisSchemaFields.post).toEqual(Object.keys(f.post).sort());
    expect({
      core: computeBootstrapGenesisCoreDigest(f.core),
      post: computeBootstrapGenesisPostSelectionDigest(f.post),
    }).toEqual({
      core: "b0ff65a21b902a64f546cf13a47f2adb2db92953e008edc13a5f12db35410fee",
      post: "6feaddc69046148c64345e11d8409e455bef786b0d03e1d40fe5fdd9b982c170",
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
  });
});

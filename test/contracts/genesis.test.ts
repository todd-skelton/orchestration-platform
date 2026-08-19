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

function fixture(successorReviewCoreDigest: string | null = null) {
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
    ownerOrdinal: successorReviewCoreDigest === null ? "0" : "1",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest,
    teardownArchiveDigest: null,
  };
  const ownerProposalBase = {
    destinationDigest,
    mutationId: d("0"),
    observationDigest,
    positionDigest: computeDestinationOwnerPositionDigest(destinationDigest),
    priorReceiptDigest: successorReviewCoreDigest === null ? null : d("4"),
    priorTipDigest: successorReviewCoreDigest === null ? null : d("5"),
    priorValueDigest: successorReviewCoreDigest === null ? null : d("6"),
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
  const globalIdentityDigest = d("a");
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
          proposalReadbackDigest: d("d"),
          reviewCoreDigest: successorReviewCoreDigest,
          schemaVersion:
            "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
          successorAnchorDigest: anchorDigest,
          successorOwnerProposalReceiptDigest: ownerReceiptDigest,
          successorOwnerTipDigest: ownerTipDigest,
          successorOwnerValueDigest: ownerValueDigest,
          tipReadbackDigest: d("e"),
          valueReadbackDigest: d("f"),
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
      successorPostSelectionReceipt === null ? null : d("1"),
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
    successorCore,
    tip,
  };
}

function validateCore(f: ReturnType<typeof fixture>, core: unknown = f.core) {
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
    f.physical,
    f.observation,
    f.absence,
    f.intentExpected,
    f.absenceExpected,
    f.coreExpected,
  );
}

function validatePost(f: ReturnType<typeof fixture>, post: unknown = f.post) {
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
  test.each([null, d("f")])("accepts genesis and successor-anchor E0 (%s)", (reviewCore) => {
    const f = fixture(reviewCore);
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
      core: "7c575b62c71380e4281504788cba6dd0035dc82a2bf8d35a5a084ae2fccd1f4a",
      post: "32bf4eb73f25c82a36a027a7661076a34c611a9c57cf1ae356568179f3108239",
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

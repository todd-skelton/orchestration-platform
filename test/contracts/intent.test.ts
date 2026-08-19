import { describe, expect, test } from "vitest";
import {
  bootstrapUseIntentSchemaFields,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorUseIntentDigest,
  computeBootstrapAnchorValueDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerSuccessorPostSelectionDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeGlobalBootstrapIdentityDigest,
  externalAuthorityPaths,
  parseBootstrapAnchorUseIntent,
  parseBootstrapProposedGenesisInput,
  parseBootstrapReviewedHelper,
  parseBootstrapReviewedInstaller,
  parseContract,
  validateBootstrapAnchorUseIntentBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";

function fixture(successorReviewCoreDigest: string | null = null) {
  const anchorBase = {
    abiDigest: d("1"),
    authorityPathInstanceDigest: d("2"),
    bootstrapGrantDigest: d("3"),
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: d("4"),
    custodyReceiptDigest: d("5"),
    destinationDigest: d("6"),
    globalBootstrapIdentityDigest: d("0"),
    helperDigest: d("7"),
    helperProfileDigest: d("8"),
    independentReviewReceiptDigest: d("9"),
    installationId,
    lockProfileDigest: d("a"),
    projectId: "018f0f4d-7b2d-7a13-9a2b-123456789abc",
    reviewedInstallerDigest: d("b"),
    schemaVersion: "state-mutation-bootstrap-anchor/v1",
    stateComponentProfileDigest: d("c"),
    stateRootDigest: d("d"),
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
    proposedAt: "2026-08-18T12:00:00.000Z",
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
  const anchorProposalDigest = computeBootstrapAnchorProposalDigest(anchorProposal);
  const anchorTip = {
    anchorDigest,
    proposalReceiptDigest: anchorProposalDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest: anchorValueDigest,
  };

  const ownerValue = {
    anchorDigest,
    anchorReceiptDigest: null,
    anchorTipDigest: null,
    anchorValueDigest: null,
    destinationDigest: anchor.destinationDigest,
    installationId,
    lifecycle: "ACTIVE",
    ownerOrdinal: successorReviewCoreDigest === null ? "0" : "1",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest,
    teardownArchiveDigest: null,
  };
  const ownerProposalBase = {
    destinationDigest: anchor.destinationDigest,
    mutationId: d("0"),
    observationDigest: d("e"),
    positionDigest: computeDestinationOwnerPositionDigest(anchor.destinationDigest),
    priorReceiptDigest: successorReviewCoreDigest === null ? null : d("1"),
    priorTipDigest: successorReviewCoreDigest === null ? null : d("2"),
    priorValueDigest: successorReviewCoreDigest === null ? null : d("3"),
    proposedAt: "2026-08-18T12:00:01.000Z",
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
  const ownerProposalDigest = computeDestinationOwnerProposalDigest(ownerProposal);
  const ownerTip = {
    destinationDigest: anchor.destinationDigest,
    proposalReceiptDigest: ownerProposalDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest: ownerValueDigest,
  };

  const proposedGenesisInput = {
    authorityPathInstanceDigest: anchor.authorityPathInstanceDigest,
    bootstrapGrantDigest: anchor.bootstrapGrantDigest,
    bootstrapTransactionId: transactionId,
    genesisPositionDigest: d("f"),
    globalIdentityDigest: d("e"),
    schemaVersion: "bootstrap-proposed-genesis-input/v1",
    successorCoreDigest: d("0"),
  };
  const reviewedInstaller = {
    installerArtifactDigest: anchor.reviewedInstallerDigest,
    installerSourceDigest: d("2"),
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
    anchorActiveReceiptDigest: anchorProposalDigest,
    anchorActiveTipDigest: computeBootstrapAnchorTipDigest(anchorTip),
    anchorActiveValueDigest: anchorValueDigest,
    anchorDigest,
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    destinationDigest: anchor.destinationDigest,
    destinationOwnerActiveReceiptDigest: ownerProposalDigest,
    destinationOwnerActiveTipDigest: computeDestinationOwnerTipDigest(ownerTip),
    destinationOwnerActiveValueDigest: ownerValueDigest,
    destinationStateRootDigest: anchor.stateRootDigest,
    expiresAt: "2026-08-18T12:15:00.000Z",
    proposedGenesisInput,
    reviewedHelper,
    reviewedInstaller,
    schemaVersion: "state-mutation-bootstrap-anchor-use-intent/v1",
    startedAt: "2026-08-18T12:00:00.000Z",
  };
  const successorPostSelectionReceipt =
    successorReviewCoreDigest === null
      ? null
      : {
          destinationLockCustodyObservationDigest: d("4"),
          observedAt: "2026-08-18T12:00:03.000Z",
          proposalReadbackDigest: d("5"),
          reviewCoreDigest: successorReviewCoreDigest,
          schemaVersion:
            "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
          successorAnchorDigest: anchorDigest,
          successorOwnerProposalReceiptDigest: ownerProposalDigest,
          successorOwnerTipDigest: computeDestinationOwnerTipDigest(ownerTip),
          successorOwnerValueDigest: ownerValueDigest,
          tipReadbackDigest: d("6"),
          valueReadbackDigest: d("7"),
        };
  const expected = {
    anchorDigest,
    bootstrapTransactionId: transactionId,
    custodyInstanceDigest: anchor.custodyInstanceDigest,
    destinationLockCustodyObservationDigest:
      successorPostSelectionReceipt?.destinationLockCustodyObservationDigest ?? null,
    destinationDigest: anchor.destinationDigest,
    destinationStateRootDigest: anchor.stateRootDigest,
    effectiveAt: "2026-08-18T12:10:00.000Z",
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
      successorPostSelectionReceipt === null ? null : d("8"),
    successorPostSelectionReviewCoreDigest: successorReviewCoreDigest,
  };
  return {
    anchor,
    anchorProposal,
    anchorTip,
    anchorValue,
    expected,
    intent,
    ownerProposal,
    ownerTip,
    ownerValue,
    proposedGenesisInput,
    reviewedHelper,
    reviewedInstaller,
  };
}

function validate(
  f: ReturnType<typeof fixture>,
  intent = f.intent,
  expected: unknown = f.expected,
) {
  return validateBootstrapAnchorUseIntentBinding(
    intent,
    f.anchor,
    f.anchorTip,
    f.anchorValue,
    f.anchorProposal,
    f.ownerTip,
    f.ownerValue,
    f.ownerProposal,
    expected,
  );
}

describe("bootstrap anchor use intent", () => {
  test("closes nested records and pins the upstream-only digest", () => {
    const f = fixture();
    expect(parseBootstrapProposedGenesisInput(f.proposedGenesisInput).ok).toBe(true);
    expect(parseBootstrapReviewedInstaller(f.reviewedInstaller).ok).toBe(true);
    expect(parseBootstrapReviewedHelper(f.reviewedHelper).ok).toBe(true);
    expect(parseBootstrapAnchorUseIntent(f.intent).ok).toBe(true);
    expect(parseContract("state-mutation-bootstrap-anchor-use-intent/v1", f.intent).ok).toBe(true);
    expect(f.proposedGenesisInput.globalIdentityDigest).not.toBe(
      f.anchor.globalBootstrapIdentityDigest,
    );
    expect(f.reviewedInstaller.installerArtifactDigest).toBe(f.anchor.reviewedInstallerDigest);
    expect(f.reviewedInstaller.reviewReceiptDigest).toBe(f.anchor.independentReviewReceiptDigest);
    expect(bootstrapUseIntentSchemaFields.useIntent).toEqual(Object.keys(f.intent).sort());
    expect(bootstrapUseIntentSchemaFields.proposedGenesis).toEqual(
      Object.keys(f.proposedGenesisInput).sort(),
    );
    expect(bootstrapUseIntentSchemaFields.reviewedInstaller).toEqual(
      Object.keys(f.reviewedInstaller).sort(),
    );
    expect(bootstrapUseIntentSchemaFields.reviewedHelper).toEqual(
      Object.keys(f.reviewedHelper).sort(),
    );
    expect(computeBootstrapAnchorUseIntentDigest(f.intent)).toBe(
      "0bc50d1a0e4448547fac48bdbb9e8ff8e4cc497e8bb71b1e60037e6f5c423f54",
    );
    expect(externalAuthorityPaths.bootstrapAnchorUseIntent(installationId, transactionId)).toBe(
      `state-mutation-authority-anchors/${installationId}/use-intents/${transactionId}.json`,
    );
    expect(Object.keys(f.intent).join("\n")).not.toMatch(
      /genesisBootstrapInputDigest|genesisHistoryRecordDigest|bootstrapGenesisCoreDigest|selectionPostReceiptDigest|proposalReadback|tipReadback|valueReadback|consumed/i,
    );
  });

  test("binds selected ACTIVE owner/anchor, reviewed preimages, interval, and custody", () => {
    const f = fixture();
    expect(validate(f)).toEqual([]);
    for (const [field, value] of [
      ["anchorActiveTipDigest", d("f")],
      ["destinationOwnerActiveTipDigest", d("f")],
      ["destinationStateRootDigest", d("f")],
      ["custodyInstanceDigest", d("f")],
      ["bootstrapTransactionId", "018f0f4d-7b2d-7a14-aa2b-123456789abc"],
    ] as const)
      expect(validate(f, { ...f.intent, [field]: value }), field).not.toEqual([]);
    expect(validate(f, f.intent, { ...f.expected, effectiveAt: f.intent.expiresAt })).toContain(
      "effectiveAt:at-or-after-expiry",
    );
    const foreignAnchorTip = { ...f.anchorTip, anchorDigest: d("f") };
    expect(
      validateBootstrapAnchorUseIntentBinding(
        {
          ...f.intent,
          anchorActiveTipDigest: computeBootstrapAnchorTipDigest(foreignAnchorTip),
        },
        f.anchor,
        foreignAnchorTip,
        f.anchorValue,
        f.anchorProposal,
        f.ownerTip,
        f.ownerValue,
        f.ownerProposal,
        f.expected,
      ),
    ).not.toEqual([]);
    const foreignOwnerTip = { ...f.ownerTip, destinationDigest: d("f") };
    expect(
      validateBootstrapAnchorUseIntentBinding(
        {
          ...f.intent,
          destinationOwnerActiveTipDigest: computeDestinationOwnerTipDigest(foreignOwnerTip),
        },
        f.anchor,
        f.anchorTip,
        f.anchorValue,
        f.anchorProposal,
        foreignOwnerTip,
        f.ownerValue,
        f.ownerProposal,
        f.expected,
      ),
    ).not.toEqual([]);
    const substitutedInstaller = { ...f.reviewedInstaller, installerArtifactDigest: d("f") };
    expect(
      validate(
        f,
        { ...f.intent, reviewedInstaller: substitutedInstaller },
        { ...f.expected, reviewedInstaller: substitutedInstaller },
      ),
    ).toContain("installer.installerArtifactDigest:mismatch");
  });

  test("requires successor post-selection only for successor anchors", () => {
    const genesis = fixture();
    expect(
      validate(genesis, genesis.intent, {
        ...genesis.expected,
        successorPostSelectionReceiptDigest: d("f"),
      }),
    ).toContain("successorPostSelectionReceiptDigest:genesis-forbidden");
    const successor = fixture(d("e"));
    expect(validate(successor)).toEqual([]);
    expect(
      validate(successor, successor.intent, {
        ...successor.expected,
        successorPostSelectionReceiptDigest: d("f"),
      }),
    ).toContain("successorPostSelectionReceiptDigest:mismatch");
    const foreignPost = {
      ...successor.expected.successorPostSelectionReceipt!,
      reviewCoreDigest: d("f"),
    };
    expect(
      validate(successor, successor.intent, {
        ...successor.expected,
        successorPostSelectionReceipt: foreignPost,
        successorPostSelectionReceiptDigest:
          computeDestinationOwnerSuccessorPostSelectionDigest(foreignPost),
      }),
    ).toContain("successorPostSelection.reviewCoreDigest:mismatch");
    expect(
      validate(successor, successor.intent, {
        ...successor.expected,
        successorPostSelectionReceiptDigest: null,
      }),
    ).toContain("successorPostSelectionReceiptDigest:successor-required");
  });

  test("rejects interval drift, coordinated nested substitution, omissions, and hostile input", () => {
    const f = fixture();
    expect(
      parseBootstrapAnchorUseIntent({
        ...f.intent,
        expiresAt: "2026-08-18T12:15:00.001Z",
      }).ok,
    ).toBe(false);
    const substitutedProposed = { ...f.proposedGenesisInput, successorCoreDigest: d("f") };
    expect(
      validate(f, { ...f.intent, proposedGenesisInput: substitutedProposed }, f.expected),
    ).not.toEqual([]);
    for (const [parser, record] of [
      [parseBootstrapProposedGenesisInput, f.proposedGenesisInput],
      [parseBootstrapReviewedInstaller, f.reviewedInstaller],
      [parseBootstrapReviewedHelper, f.reviewedHelper],
      [parseBootstrapAnchorUseIntent, f.intent],
    ] as const)
      for (const name of Object.keys(record)) {
        const mutant = { ...record } as Record<string, unknown>;
        delete mutant[name];
        expect(parser(mutant).ok, `${record.schemaVersion}:missing:${name}`).toBe(false);
      }
    const hostile = new Proxy(f.intent, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(() => parseBootstrapAnchorUseIntent(hostile)).not.toThrow();
    expect(parseBootstrapAnchorUseIntent(hostile).ok).toBe(false);
    expect(validate(f, f.intent, { ...f.expected, extra: d("f") })).not.toEqual([]);
  });
});

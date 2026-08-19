import { describe, expect, test } from "vitest";
import {
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerSuccessorPostSelectionDigest,
  computeDestinationOwnerSuccessorReviewCandidateDigest,
  computeDestinationOwnerSuccessorReviewCoreDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  externalAuthorityPaths,
  parseContract,
  parseDestinationOwnerIndependentReview,
  parseDestinationOwnerPriorInstallation,
  parseDestinationOwnerSuccessorAuthority,
  parseDestinationOwnerSuccessorPostSelection,
  parseDestinationOwnerSuccessorReviewCore,
  successorReviewSchemaFields,
  validateDestinationOwnerSuccessorPostSelectionBinding,
  validateDestinationOwnerSuccessorReviewCoreBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const destinationDigest = d("a");
const priorInstallationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const successorInstallationId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const priorProjectId = "018f0f4d-7b2d-7a11-aa2b-123456789abc";
const successorProjectId = "018f0f4d-7b2d-7a11-ba2b-123456789abc";

function value(
  lifecycle: "ACTIVE" | "RETIRED",
  ordinal: string,
  options: {
    anchorDigest?: string;
    installationId?: string;
    reviewCoreDigest?: string | null;
    teardownArchiveDigest?: string | null;
  } = {},
) {
  const retired = lifecycle === "RETIRED";
  return {
    anchorDigest: options.anchorDigest ?? d("1"),
    anchorReceiptDigest: retired ? d("2") : null,
    anchorTipDigest: retired ? d("3") : null,
    anchorValueDigest: retired ? d("4") : null,
    destinationDigest,
    installationId: options.installationId ?? priorInstallationId,
    lifecycle,
    ownerOrdinal: ordinal,
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: options.reviewCoreDigest ?? null,
    teardownArchiveDigest: options.teardownArchiveDigest ?? null,
  };
}

function proposal(
  transition: "ACTIVATE_GENESIS" | "RETIRE_UNUSED" | "ACTIVATE_SUCCESSOR",
  source: "BOOTSTRAP_GENESIS" | "ANCHOR_RETIRED" | "SUCCESSOR_REVIEW",
  successor: ReturnType<typeof value>,
  evidence: string,
  prior: { proposalDigest: string; tipDigest: string; valueDigest: string } | null,
  observationDigest = d("b"),
) {
  const base = {
    destinationDigest,
    mutationId: d("0"),
    observationDigest,
    positionDigest: computeDestinationOwnerPositionDigest(destinationDigest),
    priorReceiptDigest: prior?.proposalDigest ?? null,
    priorTipDigest: prior?.tipDigest ?? null,
    priorValueDigest: prior?.valueDigest ?? null,
    proposedAt: "2026-08-18T12:00:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source,
    successorValueDigest: computeDestinationOwnerValueDigest(successor),
    transition,
    transitionEvidenceDigest: evidence,
  };
  return { ...base, mutationId: computeDestinationOwnerMutationId(base, successor) };
}

function select(ownerValue: ReturnType<typeof value>, ownerProposal: ReturnType<typeof proposal>) {
  const valueDigest = computeDestinationOwnerValueDigest(ownerValue);
  const proposalDigest = computeDestinationOwnerProposalDigest(ownerProposal);
  const tip = {
    destinationDigest,
    proposalReceiptDigest: proposalDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest,
  };
  return {
    proposal: ownerProposal,
    proposalDigest,
    tip,
    tipDigest: computeDestinationOwnerTipDigest(tip),
    value: ownerValue,
    valueDigest,
  };
}

function fixture() {
  const active = value("ACTIVE", "0");
  const activeSelection = select(
    active,
    proposal("ACTIVATE_GENESIS", "BOOTSTRAP_GENESIS", active, d("5"), null),
  );
  const archive = {
    anchorRetiredReceiptDigest: d("2"),
    anchorRetiredTipDigest: d("3"),
    anchorRetiredValueDigest: d("4"),
    destinationDigest,
    installationId: priorInstallationId,
    observationDigest: d("6"),
    priorOwnerReceiptDigest: activeSelection.proposalDigest,
    priorOwnerTipDigest: activeSelection.tipDigest,
    priorOwnerValueDigest: activeSelection.valueDigest,
    schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
    teardownReceiptDigest: d("7"),
  };
  const archiveDigest = computeDestinationOwnerTeardownArchiveDigest(archive);
  const retired = value("RETIRED", "1", { teardownArchiveDigest: archiveDigest });
  const retiredSelection = select(
    retired,
    proposal("RETIRE_UNUSED", "ANCHOR_RETIRED", retired, archiveDigest, activeSelection),
  );
  const priorInstallation = {
    anchorDigest: retired.anchorDigest,
    anchorRetiredReceiptDigest: retired.anchorReceiptDigest!,
    anchorRetiredTipDigest: retired.anchorTipDigest!,
    anchorRetiredValueDigest: retired.anchorValueDigest!,
    installationId: priorInstallationId,
    projectId: priorProjectId,
    schemaVersion: "destination-owner-prior-installation/v1",
    stateRootDigest: d("8"),
  };
  const successorAuthority = {
    bootstrapGrantDigest: d("9"),
    bootstrapTransactionId: "018f0f4d-7b2d-7a12-8a2b-123456789abc",
    globalBootstrapIdentityDigest: d("c"),
    installationId: successorInstallationId,
    projectId: successorProjectId,
    reviewedInstallerDigest: d("d"),
    reviewedReleaseManifestDigest: d("e"),
    reviewedReleaseSubjectDigest: d("f"),
    schemaVersion: "destination-owner-successor-authority/v1",
    stateRootDigest: d("0"),
  };
  const independentReview = {
    authorIdentityDigest: d("1"),
    candidateDigest: d("0"),
    reviewReceiptDigest: d("2"),
    reviewedAt: "2026-08-18T12:01:00.000Z",
    reviewerIdentityDigest: d("3"),
    schemaVersion: "destination-owner-independent-review/v1",
  };
  const coreBase = {
    destinationDigest,
    independentReview,
    priorInstallation,
    priorRetiredReceiptDigest: retiredSelection.proposalDigest,
    priorRetiredTipDigest: retiredSelection.tipDigest,
    priorRetiredValueDigest: retiredSelection.valueDigest,
    schemaVersion: "state-mutation-destination-owner-successor-review-core/v1",
    successorAuthority,
    teardownArchiveDigest: archiveDigest,
  };
  const core = {
    ...coreBase,
    independentReview: {
      ...independentReview,
      candidateDigest: computeDestinationOwnerSuccessorReviewCandidateDigest(coreBase),
    },
  };
  const coreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(core);
  const successorAnchorDigest = d("4");
  const successorValue = value("ACTIVE", "2", {
    anchorDigest: successorAnchorDigest,
    installationId: successorInstallationId,
    reviewCoreDigest: coreDigest,
  });
  const successorProposal = proposal(
    "ACTIVATE_SUCCESSOR",
    "SUCCESSOR_REVIEW",
    successorValue,
    coreDigest,
    retiredSelection,
    d("5"),
  );
  const successorSelection = select(successorValue, successorProposal);
  const postExpected = {
    destinationLockCustodyObservationDigest: d("6"),
    observationDigest: d("5"),
    proposalReadbackDigest: d("7"),
    reviewCoreDigest: coreDigest,
    successorAnchorDigest,
    tipReadbackDigest: d("8"),
    valueReadbackDigest: d("9"),
  };
  const post = {
    destinationLockCustodyObservationDigest: postExpected.destinationLockCustodyObservationDigest,
    observedAt: "2026-08-18T12:02:00.000Z",
    proposalReadbackDigest: postExpected.proposalReadbackDigest,
    reviewCoreDigest: coreDigest,
    schemaVersion: "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
    successorAnchorDigest,
    successorOwnerProposalReceiptDigest: successorSelection.proposalDigest,
    successorOwnerTipDigest: successorSelection.tipDigest,
    successorOwnerValueDigest: successorSelection.valueDigest,
    tipReadbackDigest: postExpected.tipReadbackDigest,
    valueReadbackDigest: postExpected.valueReadbackDigest,
  };
  const reviewExpected = {
    authorIdentityDigest: independentReview.authorIdentityDigest,
    candidateDigest: core.independentReview.candidateDigest,
    destinationDigest,
    priorProjectId,
    priorStateRootDigest: priorInstallation.stateRootDigest,
    reviewReceiptDigest: independentReview.reviewReceiptDigest,
    reviewerIdentityDigest: independentReview.reviewerIdentityDigest,
    successorAuthority,
    teardownAbsenceDigest: archive.observationDigest,
  };
  return {
    archive,
    core,
    post,
    postExpected,
    priorInstallation,
    retiredSelection,
    reviewExpected,
    successorAuthority,
    successorSelection,
  };
}

describe("destination-owner successor review", () => {
  test("closes all five records and pins the acyclic digest split", () => {
    const f = fixture();
    expect(parseDestinationOwnerPriorInstallation(f.priorInstallation).ok).toBe(true);
    expect(parseDestinationOwnerSuccessorAuthority(f.successorAuthority).ok).toBe(true);
    expect(parseDestinationOwnerIndependentReview(f.core.independentReview).ok).toBe(true);
    expect(parseDestinationOwnerSuccessorReviewCore(f.core).ok).toBe(true);
    expect(parseDestinationOwnerSuccessorPostSelection(f.post).ok).toBe(true);
    expect(
      parseContract("state-mutation-destination-owner-successor-review-core/v1", f.core).ok,
    ).toBe(true);
    expect(successorReviewSchemaFields.reviewCore).toEqual(Object.keys(f.core).sort());
    expect(successorReviewSchemaFields.postSelection).toEqual(Object.keys(f.post).sort());
    expect(successorReviewSchemaFields.priorInstallation).toEqual(
      Object.keys(f.priorInstallation).sort(),
    );
    expect(successorReviewSchemaFields.successorAuthority).toEqual(
      Object.keys(f.successorAuthority).sort(),
    );
    expect(successorReviewSchemaFields.independentReview).toEqual(
      Object.keys(f.core.independentReview).sort(),
    );
    const candidateDigest = computeDestinationOwnerSuccessorReviewCandidateDigest(f.core);
    const coreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(f.core);
    const postDigest = computeDestinationOwnerSuccessorPostSelectionDigest(f.post);
    expect({ candidateDigest, coreDigest, postDigest }).toEqual({
      candidateDigest: "0a7a2788c7882442a98e7cef4085a3ede2ea7c1114bd94715d12b8bd76abd4dc",
      coreDigest: "1e8ef93f6121e90eb2557005ef9a6add3c4a8f688b2bbac6463f5f0e8916d651",
      postDigest: "e1c3c259878e8c8df5212d33ecd8432611f6d3a179f901a21ecaa40fe6356f1b",
    });
    expect(
      externalAuthorityPaths.destinationSuccessorReviewCore(
        destinationDigest,
        f.retiredSelection.tipDigest,
        coreDigest,
      ),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-cores/${f.retiredSelection.tipDigest}/${coreDigest}.json`,
    );
    expect(
      externalAuthorityPaths.destinationSuccessorPostSelectionReceipt(
        destinationDigest,
        f.successorSelection.tipDigest,
      ),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-post-selection-receipts/${f.successorSelection.tipDigest}.json`,
    );
    expect(Object.keys(f.core).join("\n")).not.toMatch(
      /successorAnchor|successorOwner|postSelection/i,
    );
  });

  test("binds retired lineage, archive, independent reviewer, and intended successor", () => {
    const f = fixture();
    expect(
      validateDestinationOwnerSuccessorReviewCoreBinding(
        f.core,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.archive,
        f.reviewExpected,
      ),
    ).toEqual([]);
    expect(
      validateDestinationOwnerSuccessorReviewCoreBinding(
        { ...f.core, teardownArchiveDigest: d("f") },
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.archive,
        f.reviewExpected,
      ),
    ).not.toEqual([]);
    expect(
      validateDestinationOwnerSuccessorReviewCoreBinding(
        f.core,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.archive,
        { ...f.reviewExpected, reviewReceiptDigest: d("f") },
      ),
    ).not.toEqual([]);
  });

  test("binds downstream selection without feeding it into the review core", () => {
    const f = fixture();
    expect(
      validateDestinationOwnerSuccessorPostSelectionBinding(
        f.post,
        f.core,
        f.successorSelection.value,
        f.successorSelection.proposal,
        f.successorSelection.tip,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.postExpected,
      ),
    ).toEqual([]);
    for (const field of [
      "reviewCoreDigest",
      "successorAnchorDigest",
      "successorOwnerValueDigest",
      "successorOwnerProposalReceiptDigest",
      "successorOwnerTipDigest",
      "valueReadbackDigest",
      "proposalReadbackDigest",
      "tipReadbackDigest",
      "destinationLockCustodyObservationDigest",
    ] as const)
      expect(
        validateDestinationOwnerSuccessorPostSelectionBinding(
          { ...f.post, [field]: d("f") },
          f.core,
          f.successorSelection.value,
          f.successorSelection.proposal,
          f.successorSelection.tip,
          f.retiredSelection.tip,
          f.retiredSelection.value,
          f.retiredSelection.proposal,
          f.postExpected,
        ),
        field,
      ).not.toEqual([]);
    const substitutedCore = {
      ...f.core,
      independentReview: { ...f.core.independentReview, reviewReceiptDigest: d("f") },
    };
    const substitutedCoreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(substitutedCore);
    const substitutedValue = {
      ...f.successorSelection.value,
      successorReviewCoreDigest: substitutedCoreDigest,
    };
    const substitutedProposalBase = {
      ...f.successorSelection.proposal,
      mutationId: d("0"),
      successorValueDigest: computeDestinationOwnerValueDigest(substitutedValue),
      transitionEvidenceDigest: substitutedCoreDigest,
    };
    const substitutedProposal = {
      ...substitutedProposalBase,
      mutationId: computeDestinationOwnerMutationId(substitutedProposalBase, substitutedValue),
    };
    const substitutedValueDigest = computeDestinationOwnerValueDigest(substitutedValue);
    const substitutedProposalDigest = computeDestinationOwnerProposalDigest(substitutedProposal);
    const substitutedTip = {
      ...f.successorSelection.tip,
      proposalReceiptDigest: substitutedProposalDigest,
      valueDigest: substitutedValueDigest,
    };
    const substitutedPost = {
      ...f.post,
      reviewCoreDigest: substitutedCoreDigest,
      successorOwnerProposalReceiptDigest: substitutedProposalDigest,
      successorOwnerTipDigest: computeDestinationOwnerTipDigest(substitutedTip),
      successorOwnerValueDigest: substitutedValueDigest,
    };
    expect(
      validateDestinationOwnerSuccessorPostSelectionBinding(
        substitutedPost,
        substitutedCore,
        substitutedValue,
        substitutedProposal,
        substitutedTip,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.postExpected,
      ),
    ).not.toEqual([]);
  });

  test("rejects coordinated authority substitution, self-review, additions, and omissions", () => {
    const f = fixture();
    expect(
      parseDestinationOwnerIndependentReview({
        ...f.core.independentReview,
        reviewerIdentityDigest: f.core.independentReview.authorIdentityDigest,
      }).ok,
    ).toBe(false);
    expect(
      parseDestinationOwnerSuccessorReviewCore({ ...f.core, successorAnchorDigest: d("f") }).ok,
    ).toBe(false);
    const substitutedAuthority = { ...f.successorAuthority, reviewedInstallerDigest: d("f") };
    const substitutedBase = { ...f.core, successorAuthority: substitutedAuthority };
    const substitutedCore = {
      ...substitutedBase,
      independentReview: {
        ...f.core.independentReview,
        candidateDigest: computeDestinationOwnerSuccessorReviewCandidateDigest(substitutedBase),
      },
    };
    expect(
      validateDestinationOwnerSuccessorReviewCoreBinding(
        substitutedCore,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.archive,
        f.reviewExpected,
      ),
    ).not.toEqual([]);
    for (const [parser, record] of [
      [parseDestinationOwnerPriorInstallation, f.priorInstallation],
      [parseDestinationOwnerSuccessorAuthority, f.successorAuthority],
      [parseDestinationOwnerIndependentReview, f.core.independentReview],
      [parseDestinationOwnerSuccessorReviewCore, f.core],
      [parseDestinationOwnerSuccessorPostSelection, f.post],
    ] as const)
      for (const name of Object.keys(record)) {
        const mutant = { ...record } as Record<string, unknown>;
        delete mutant[name];
        expect(parser(mutant).ok, `${record.schemaVersion}:missing:${name}`).toBe(false);
      }
    const hostile = new Proxy(f.core, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(() => parseDestinationOwnerSuccessorReviewCore(hostile)).not.toThrow();
    expect(parseDestinationOwnerSuccessorReviewCore(hostile).ok).toBe(false);
    expect(
      validateDestinationOwnerSuccessorReviewCoreBinding(
        f.core,
        f.retiredSelection.tip,
        f.retiredSelection.value,
        f.retiredSelection.proposal,
        f.archive,
        { ...f.reviewExpected, extra: d("f") },
      ),
    ).not.toEqual([]);
  });
});

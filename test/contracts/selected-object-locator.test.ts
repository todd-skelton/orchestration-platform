import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const positionEvidence = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
const expectedIdentity = Object.freeze({
  canonicalPointerPath: "installation/active-release.json",
  installationId,
  pointerKind: "ACTIVE_RELEASE" as const,
  positionEvidence,
  projectId,
  sourceToken: "none",
  stateRootDigest: d("b"),
  transactionId: installationId,
});
const value = Object.freeze({
  independentReviewReceiptDigest: d("1"),
  installedBytesDigest: d("2"),
  releaseDigest: d("a"),
  releaseManifestDigest: d("3"),
  releaseSubjectDigest: d("a"),
  reviewedInstallerDigest: d("4"),
  schemaVersion: "active-release/v1",
});
const pathInstanceDigest = contracts.computePointerInstanceDigest(expectedIdentity);
const valueDigest = contracts.computePointerValueDigest(
  "ACTIVE_RELEASE",
  pathInstanceDigest,
  value,
);
const positionDigest = contracts.computePointerPositionDigest("ACTIVE_RELEASE", positionEvidence);
const proposal = Object.freeze({
  authorityEpochReceiptDigest: d("f"),
  authorityEpochTipDigest: d("d"),
  authorityEpochValueDigest: d("e"),
  intent: "VALUE_PROPOSED",
  mutationId: contracts.computeMutationId({
    ...expectedIdentity,
    outcome: "SELECT",
    priorReceiptDigest: d("5"),
    priorTipDigest: d("6"),
    priorValueDigest: d("7"),
    successorValueDigest: valueDigest,
  }),
  outcome: "SELECT",
  pathInstanceDigest,
  pointerKind: "ACTIVE_RELEASE",
  positionDigest,
  priorReceiptDigest: d("5"),
  priorTipDigest: d("6"),
  priorValueDigest: d("7"),
  producerDigest: d("b"),
  producerKind: "SELECTED_EPOCH",
  proposedAt: "2026-08-21T05:00:00.000Z",
  schemaVersion: "pointer-cas-proposal-receipt/v1",
  successorValueDigest: valueDigest,
});
const proposalReceiptDigest = contracts.computeProposalReceiptDigest(proposal);
const tip = Object.freeze({
  pathInstanceDigest,
  pointerKind: "ACTIVE_RELEASE",
  proposalReceiptDigest,
  schemaVersion: "pointer-current-tip/v1",
  valueDigest,
});

const locatedInput = Object.freeze({ expectedIdentity, proposal, tip, value });

describe("common selected-object locator", () => {
  test("pins exact content-addressed paths and rejects malformed digests", () => {
    const tipDigest = contracts.computeCurrentTipDigest(tip);
    expect(contracts.pointerStoragePaths.selectedValue(pathInstanceDigest, valueDigest)).toBe(
      `installation/pointer-cas/${pathInstanceDigest}/objects/values/${valueDigest}.json`,
    );
    expect(
      contracts.pointerStoragePaths.selectedProposal(pathInstanceDigest, proposalReceiptDigest),
    ).toBe(
      `installation/pointer-cas/${pathInstanceDigest}/objects/proposals/${proposalReceiptDigest}.json`,
    );
    expect(contracts.pointerStoragePaths.selectedTip(pathInstanceDigest, tipDigest)).toBe(
      `installation/pointer-cas/${pathInstanceDigest}/objects/tips/${tipDigest}.json`,
    );
    expect(() => contracts.pointerStoragePaths.selectedValue(d("z"), valueDigest)).toThrow();
    expect(() => contracts.pointerStoragePaths.selectedValue(pathInstanceDigest, "bad")).toThrow();
    expect(() =>
      contracts.pointerStoragePaths.selectedProposal("bad", proposalReceiptDigest),
    ).toThrow();
    expect(() =>
      contracts.pointerStoragePaths.selectedProposal(pathInstanceDigest, "bad"),
    ).toThrow();
    expect(() => contracts.pointerStoragePaths.selectedTip("bad", tipDigest)).toThrow();
    expect(() => contracts.pointerStoragePaths.selectedTip(pathInstanceDigest, d("Z"))).toThrow();
  });

  test("returns the exact selected tuple and complete prior tuple for one node", () => {
    const result = contracts.validateLocatedSelectedPointerEvidence(locatedInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      pathInstanceDigest,
      priorReceiptDigest: d("5"),
      priorTipDigest: d("6"),
      priorValueDigest: d("7"),
      proposal,
      proposalReceiptDigest,
      tip,
      tipDigest: contracts.computeCurrentTipDigest(tip),
      value,
      valueDigest,
    });

    const bootstrapProposal = Object.freeze({
      ...proposal,
      authorityEpochReceiptDigest: null,
      authorityEpochTipDigest: null,
      authorityEpochValueDigest: null,
      mutationId: contracts.computeMutationId({
        ...expectedIdentity,
        outcome: "SELECT",
        priorReceiptDigest: null,
        priorTipDigest: null,
        priorValueDigest: null,
        successorValueDigest: valueDigest,
      }),
      priorReceiptDigest: null,
      priorTipDigest: null,
      priorValueDigest: null,
      producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
    });
    const bootstrapReceiptDigest = contracts.computeProposalReceiptDigest(bootstrapProposal);
    const bootstrapTip = Object.freeze({ ...tip, proposalReceiptDigest: bootstrapReceiptDigest });
    const bootstrap = contracts.validateLocatedSelectedPointerEvidence({
      expectedIdentity,
      proposal: bootstrapProposal,
      tip: bootstrapTip,
      value,
    });
    expect(bootstrap.ok).toBe(true);
    if (bootstrap.ok)
      expect([
        bootstrap.value.priorTipDigest,
        bootstrap.value.priorValueDigest,
        bootstrap.value.priorReceiptDigest,
      ]).toEqual([null, null, null]);
  });

  test("equal-binds every trusted identity scalar, kind, and position", () => {
    for (const [field, replacement] of [
      ["canonicalPointerPath", "installation/other.json"],
      ["installationId", "018f0f4d-7b2d-7a16-8a2b-123456789abc"],
      ["pointerKind", "ACTIVATION_CLEANUP_GATE"],
      ["projectId", "018f0f4d-7b2d-7a17-8a2b-123456789abc"],
      ["sourceToken", "recovery-fence"],
      ["stateRootDigest", d("9")],
      ["transactionId", "018f0f4d-7b2d-7a18-8a2b-123456789abc"],
    ] as const)
      expect(
        contracts.validateLocatedSelectedPointerEvidence({
          ...locatedInput,
          expectedIdentity: { ...expectedIdentity, [field]: replacement },
        }).ok,
        field,
      ).toBe(false);

    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        ...locatedInput,
        expectedIdentity: {
          ...expectedIdentity,
          positionEvidence: { mode: "TOMBSTONE", parts: {} },
        },
      }).ok,
    ).toBe(false);

    const wrongKindProposal = Object.freeze({
      ...proposal,
      pointerKind: "ACTIVATION_CLEANUP_GATE",
    });
    const wrongKindTip = Object.freeze({
      ...tip,
      proposalReceiptDigest: contracts.computeProposalReceiptDigest(wrongKindProposal),
    });
    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        expectedIdentity,
        proposal: wrongKindProposal,
        tip: wrongKindTip,
        value,
      }).ok,
    ).toBe(false);

    const wrongPositionProposal = Object.freeze({ ...proposal, positionDigest: d("0") });
    const wrongPositionTip = Object.freeze({
      ...tip,
      proposalReceiptDigest: contracts.computeProposalReceiptDigest(wrongPositionProposal),
    });
    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        expectedIdentity,
        proposal: wrongPositionProposal,
        tip: wrongPositionTip,
        value,
      }).ok,
    ).toBe(false);
  });

  test("refuses selected-graph substitutions and partial prior tuples", () => {
    for (const mutant of [
      { ...locatedInput, value: { ...value, installedBytesDigest: d("9") } },
      { ...locatedInput, tip: { ...tip, pointerKind: "ACTIVATION_CLEANUP_GATE" } },
      { ...locatedInput, tip: { ...tip, pathInstanceDigest: d("9") } },
      { ...locatedInput, tip: { ...tip, valueDigest: d("9") } },
      { ...locatedInput, tip: { ...tip, proposalReceiptDigest: d("9") } },
      { ...locatedInput, proposal: { ...proposal, successorValueDigest: d("9") } },
      {
        ...locatedInput,
        proposal: { ...proposal, mutationId: d("9") },
        tip: {
          ...tip,
          proposalReceiptDigest: contracts.computeProposalReceiptDigest({
            ...proposal,
            mutationId: d("9"),
          }),
        },
      },
      { ...locatedInput, proposal: { ...proposal, pathInstanceDigest: d("9") } },
      { ...locatedInput, proposal: { ...proposal, priorReceiptDigest: null } },
    ])
      expect(contracts.validateLocatedSelectedPointerEvidence(mutant).ok).toBe(false);
  });

  test("closes common intent/outcome pairs and binds them to trusted position mode", () => {
    for (const [intent, outcome] of [
      ["VALUE_PROPOSED", "REMOVE"],
      ["TOMBSTONE_PROPOSED", "SELECT"],
    ] as const) {
      const crossed = { ...proposal, intent, outcome };
      expect(contracts.parsePointerProposal(crossed).ok).toBe(false);
      expect(
        contracts.classifyProposal({
          conflictReceipt: null,
          proposal: crossed,
          selectedProposal: null,
          selectedTip: null,
          selectedValue: null,
        }),
      ).toBe("UNKNOWN");
    }

    const tombstonePosition = Object.freeze({ mode: "TOMBSTONE", parts: Object.freeze({}) });
    const tombstoneIdentity = Object.freeze({
      ...expectedIdentity,
      positionEvidence: tombstonePosition,
    });
    const tombstoneProposalBase = {
      ...proposal,
      intent: "TOMBSTONE_PROPOSED",
      outcome: "REMOVE",
      positionDigest: contracts.computePointerPositionDigest("ACTIVE_RELEASE", tombstonePosition),
    } as const;
    const tombstoneProposal = Object.freeze({
      ...tombstoneProposalBase,
      mutationId: contracts.computeMutationId({
        ...tombstoneIdentity,
        outcome: "REMOVE",
        priorReceiptDigest: proposal.priorReceiptDigest,
        priorTipDigest: proposal.priorTipDigest,
        priorValueDigest: proposal.priorValueDigest,
        successorValueDigest: valueDigest,
      }),
    });
    const tombstoneTip = Object.freeze({
      ...tip,
      proposalReceiptDigest: contracts.computeProposalReceiptDigest(tombstoneProposal),
    });
    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        expectedIdentity: tombstoneIdentity,
        proposal: tombstoneProposal,
        tip: tombstoneTip,
        value,
      }).ok,
    ).toBe(true);

    const valueRowAtTombstonePosition = Object.freeze({
      ...proposal,
      positionDigest: tombstoneProposal.positionDigest,
      mutationId: contracts.computeMutationId({
        ...tombstoneIdentity,
        outcome: "SELECT",
        priorReceiptDigest: proposal.priorReceiptDigest,
        priorTipDigest: proposal.priorTipDigest,
        priorValueDigest: proposal.priorValueDigest,
        successorValueDigest: valueDigest,
      }),
    });
    const valueRowTip = Object.freeze({
      ...tip,
      proposalReceiptDigest: contracts.computeProposalReceiptDigest(valueRowAtTombstonePosition),
    });
    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        expectedIdentity: tombstoneIdentity,
        proposal: valueRowAtTombstonePosition,
        tip: valueRowTip,
        value,
      }).ok,
    ).toBe(false);
  });

  test("leaves family semantics to the family parser and remains total", () => {
    const openValue = Object.freeze({ schemaVersion: "active-release/v1", unexpected: true });
    const openValueDigest = contracts.computePointerValueDigest(
      "ACTIVE_RELEASE",
      pathInstanceDigest,
      openValue,
    );
    const openProposal = Object.freeze({
      ...proposal,
      mutationId: contracts.computeMutationId({
        ...expectedIdentity,
        outcome: "SELECT",
        priorReceiptDigest: proposal.priorReceiptDigest,
        priorTipDigest: proposal.priorTipDigest,
        priorValueDigest: proposal.priorValueDigest,
        successorValueDigest: openValueDigest,
      }),
      successorValueDigest: openValueDigest,
    });
    const openReceiptDigest = contracts.computeProposalReceiptDigest(openProposal);
    const openTip = Object.freeze({
      ...tip,
      proposalReceiptDigest: openReceiptDigest,
      valueDigest: openValueDigest,
    });
    expect(
      contracts.validateLocatedSelectedPointerEvidence({
        expectedIdentity,
        proposal: openProposal,
        tip: openTip,
        value: openValue,
      }).ok,
    ).toBe(true);
    expect(contracts.parseActiveReleaseValue(openValue).ok).toBe(false);

    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, [], "selected", hostile, { ...locatedInput, extra: true }]) {
      expect(() => contracts.validateLocatedSelectedPointerEvidence(input)).not.toThrow();
      expect(contracts.validateLocatedSelectedPointerEvidence(input).ok).toBe(false);
    }
    for (const input of [
      { ...locatedInput, expectedIdentity: hostile },
      { ...locatedInput, proposal: hostile },
      { ...locatedInput, tip: hostile },
      { ...locatedInput, value: hostile },
      {
        ...locatedInput,
        expectedIdentity: { ...expectedIdentity, positionEvidence: hostile },
      },
    ]) {
      expect(() => contracts.validateLocatedSelectedPointerEvidence(input)).not.toThrow();
      expect(contracts.validateLocatedSelectedPointerEvidence(input).ok).toBe(false);
    }
  });
});

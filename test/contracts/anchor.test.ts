import { describe, expect, test } from "vitest";
import {
  bootstrapAnchorSchemaFields,
  computeBootstrapAnchorConflictDigest,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  computeGlobalBootstrapIdentityDigest,
  externalAuthorityPaths,
  parseBootstrapAnchor,
  parseBootstrapAnchorConflict,
  parseBootstrapAnchorLifecycleValue,
  parseBootstrapAnchorProposal,
  parseBootstrapAnchorTip,
  parseContract,
  validateBootstrapAnchorConflictBinding,
  validateBootstrapAnchorIdentityBinding,
  validateBootstrapAnchorMutationBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";

function anchor(successorReviewCoreDigest: string | null = null) {
  const base = {
    abiDigest: d("1"),
    authorityPathInstanceDigest: d("2"),
    bootstrapGrantDigest: d("3"),
    bootstrapTransactionId: "018f0f4d-7b2d-7a12-8a2b-123456789abc",
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
  return { ...base, globalBootstrapIdentityDigest: computeGlobalBootstrapIdentityDigest(base) };
}

function lifecycleValue(
  anchorDigest: string,
  lifecycle: "ACTIVE" | "CONSUMED" | "RETIRED",
  lifecycleOrdinal: string,
) {
  const consumed = lifecycle === "CONSUMED";
  return {
    anchorDigest,
    bootstrapGenesisCoreDigest: consumed ? d("1") : null,
    lifecycle,
    lifecycleOrdinal,
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    selectedAuthorityPathInstanceDigest: consumed ? d("2") : null,
    selectedAuthorityReceiptDigest: consumed ? d("3") : null,
    selectedAuthorityTipDigest: consumed ? d("4") : null,
    selectedAuthorityValueDigest: consumed ? d("5") : null,
    selectionPostReceiptDigest: consumed ? d("6") : null,
    teardownReceiptDigest: lifecycle === "RETIRED" ? d("7") : null,
  };
}

type SelectionRef = { proposalDigest: string; tipDigest: string; valueDigest: string };

function proposal(
  anchorRecord: ReturnType<typeof anchor>,
  transition: "ACTIVATE" | "CONSUME" | "RETIRE_UNUSED" | "RETIRE_CONSUMED",
  source: "BOOTSTRAP_CREATE" | "E0_SELECTION" | "TEARDOWN",
  successor: ReturnType<typeof lifecycleValue>,
  evidence: string,
  prior: SelectionRef | null,
  proposedAt = "2026-08-18T12:00:00.000Z",
) {
  const base = {
    anchorDigest: computeBootstrapAnchorDigest(anchorRecord),
    mutationId: d("0"),
    priorReceiptDigest: prior?.proposalDigest ?? null,
    priorTipDigest: prior?.tipDigest ?? null,
    priorValueDigest: prior?.valueDigest ?? null,
    proposedAt,
    schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
    source,
    successorValueDigest: computeBootstrapAnchorValueDigest(successor),
    transition,
    transitionEvidenceDigest: evidence,
  };
  return {
    ...base,
    mutationId: computeBootstrapAnchorMutationId(anchorRecord, base, successor),
  };
}

function select(
  ownerValue: ReturnType<typeof lifecycleValue>,
  ownerProposal: ReturnType<typeof proposal>,
) {
  const valueDigest = computeBootstrapAnchorValueDigest(ownerValue);
  const proposalDigest = computeBootstrapAnchorProposalDigest(ownerProposal);
  const tip = {
    anchorDigest: ownerValue.anchorDigest,
    proposalReceiptDigest: proposalDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest,
  };
  return {
    proposal: ownerProposal,
    proposalDigest,
    tip,
    tipDigest: computeBootstrapAnchorTipDigest(tip),
    value: ownerValue,
    valueDigest,
  };
}

function fixture() {
  const anchorRecord = anchor();
  const anchorDigest = computeBootstrapAnchorDigest(anchorRecord);
  const active = lifecycleValue(anchorDigest, "ACTIVE", "0");
  const activeProposal = proposal(
    anchorRecord,
    "ACTIVATE",
    "BOOTSTRAP_CREATE",
    active,
    anchorRecord.bootstrapGrantDigest,
    null,
  );
  return { active, activeSelection: select(active, activeProposal), anchorDigest, anchorRecord };
}

function validate(
  anchorRecord: ReturnType<typeof anchor>,
  ownerProposal: ReturnType<typeof proposal>,
  successor: ReturnType<typeof lifecycleValue>,
  prior: ReturnType<typeof select> | null,
  evidence: string,
) {
  return validateBootstrapAnchorMutationBinding(
    anchorRecord,
    ownerProposal,
    successor,
    prior?.tip ?? null,
    prior?.value ?? null,
    prior?.proposal ?? null,
    {
      anchorDigest: computeBootstrapAnchorDigest(anchorRecord),
      transitionEvidenceDigest: evidence,
    },
  );
}

describe("bootstrap anchor identity and lifecycle", () => {
  test("closes and hashes the anchor identity without successor/post-selection cycles", () => {
    const f = fixture();
    expect(parseBootstrapAnchor(f.anchorRecord).ok).toBe(true);
    expect(parseContract("state-mutation-bootstrap-anchor/v1", f.anchorRecord).ok).toBe(true);
    expect(bootstrapAnchorSchemaFields.anchor).toEqual(Object.keys(f.anchorRecord).sort());
    expect(computeGlobalBootstrapIdentityDigest(f.anchorRecord)).toBe(
      f.anchorRecord.globalBootstrapIdentityDigest,
    );
    expect(
      validateBootstrapAnchorIdentityBinding(f.anchorRecord, {
        globalBootstrapIdentityDigest: f.anchorRecord.globalBootstrapIdentityDigest,
        successorReviewCoreDigest: null,
      }),
    ).toEqual([]);
    expect({
      anchor: computeBootstrapAnchorDigest(f.anchorRecord),
      global: computeGlobalBootstrapIdentityDigest(f.anchorRecord),
      proposal: computeBootstrapAnchorProposalDigest(f.activeSelection.proposal),
      tip: computeBootstrapAnchorTipDigest(f.activeSelection.tip),
      value: computeBootstrapAnchorValueDigest(f.active),
    }).toEqual({
      anchor: "29702c8e8eb89b42088f196ebcac584399e38f39875a6fa65706feb7090aab3a",
      global: "4a49f09889436027fdf60e59236c88307aabe574a6f5d79a8c6a5de9dffc65c9",
      proposal: "4bb699c2c3369757c3cecc84b206826d1fc88a75a9293e764857599e7c0b6a6c",
      tip: "1cc45f725cfa4f5ff4ec0050d17f583e4793ecc54d0e04aa03ed88adffe50ac2",
      value: "e99387b54dbe572206f854d5d14d9288ec82e9f6437a39c29bff9a2a5110e7ac",
    });
    expect(externalAuthorityPaths.bootstrapAnchor(installationId)).toBe(
      `state-mutation-authority-anchors/${installationId}/anchor.json`,
    );
    const successorAnchor = anchor(d("e"));
    expect(computeGlobalBootstrapIdentityDigest(successorAnchor)).toBe(
      f.anchorRecord.globalBootstrapIdentityDigest,
    );
    expect(computeBootstrapAnchorDigest(successorAnchor)).not.toBe(f.anchorDigest);
    expect(
      validateBootstrapAnchorIdentityBinding(successorAnchor, {
        globalBootstrapIdentityDigest: successorAnchor.globalBootstrapIdentityDigest,
        successorReviewCoreDigest: d("e"),
      }),
    ).toEqual([]);
    expect(
      validateBootstrapAnchorIdentityBinding(successorAnchor, {
        globalBootstrapIdentityDigest: successorAnchor.globalBootstrapIdentityDigest,
        successorReviewCoreDigest: d("f"),
      }),
    ).not.toEqual([]);
  });

  test("accepts the exhaustive anchor lifecycle matrix", () => {
    const f = fixture();
    expect(validate(f.anchorRecord, f.activeSelection.proposal, f.active, null, d("3"))).toEqual(
      [],
    );
    const consumed = lifecycleValue(f.anchorDigest, "CONSUMED", "1");
    const consumeProposal = proposal(
      f.anchorRecord,
      "CONSUME",
      "E0_SELECTION",
      consumed,
      consumed.selectionPostReceiptDigest!,
      f.activeSelection,
    );
    expect(
      validate(
        f.anchorRecord,
        consumeProposal,
        consumed,
        f.activeSelection,
        consumed.selectionPostReceiptDigest!,
      ),
    ).toEqual([]);
    const consumedSelection = select(consumed, consumeProposal);

    const retiredUnused = lifecycleValue(f.anchorDigest, "RETIRED", "1");
    const retireUnusedProposal = proposal(
      f.anchorRecord,
      "RETIRE_UNUSED",
      "TEARDOWN",
      retiredUnused,
      retiredUnused.teardownReceiptDigest!,
      f.activeSelection,
    );
    expect(
      validate(
        f.anchorRecord,
        retireUnusedProposal,
        retiredUnused,
        f.activeSelection,
        retiredUnused.teardownReceiptDigest!,
      ),
    ).toEqual([]);

    const retiredConsumed = lifecycleValue(f.anchorDigest, "RETIRED", "2");
    const retireConsumedProposal = proposal(
      f.anchorRecord,
      "RETIRE_CONSUMED",
      "TEARDOWN",
      retiredConsumed,
      retiredConsumed.teardownReceiptDigest!,
      consumedSelection,
    );
    expect(
      validate(
        f.anchorRecord,
        retireConsumedProposal,
        retiredConsumed,
        consumedSelection,
        retiredConsumed.teardownReceiptDigest!,
      ),
    ).toEqual([]);

    const forgedPriorBase = {
      ...consumeProposal,
      mutationId: d("0"),
      source: "TEARDOWN" as const,
    };
    const forgedPrior = {
      ...forgedPriorBase,
      mutationId: computeBootstrapAnchorMutationId(f.anchorRecord, forgedPriorBase, consumed),
    };
    const forgedPriorSelection = select(consumed, forgedPrior);
    const retirementAfterForgedPrior = proposal(
      f.anchorRecord,
      "RETIRE_CONSUMED",
      "TEARDOWN",
      retiredConsumed,
      retiredConsumed.teardownReceiptDigest!,
      forgedPriorSelection,
    );
    expect(
      validate(
        f.anchorRecord,
        retirementAfterForgedPrior,
        retiredConsumed,
        forgedPriorSelection,
        retiredConsumed.teardownReceiptDigest!,
      ),
    ).toContain("priorProposal:source:not-e0-selection");
  });

  test("binds conflict records and rejects coordinated semantic substitutions", () => {
    const f = fixture();
    const losingProposal = proposal(
      f.anchorRecord,
      "ACTIVATE",
      "BOOTSTRAP_CREATE",
      f.active,
      f.anchorRecord.bootstrapGrantDigest,
      null,
      "2026-08-18T12:00:01.000Z",
    );
    const conflict = {
      anchorDigest: f.anchorDigest,
      conflictAt: "2026-08-18T12:00:02.000Z",
      losingProposalReceiptDigest: computeBootstrapAnchorProposalDigest(losingProposal),
      losingSuccessorValueDigest: f.activeSelection.valueDigest,
      mutationId: losingProposal.mutationId,
      schemaVersion: "state-mutation-bootstrap-anchor-conflict-receipt/v1",
      winningProposalReceiptDigest: f.activeSelection.proposalDigest,
      winningTipDigest: f.activeSelection.tipDigest,
      winningValueDigest: f.activeSelection.valueDigest,
    };
    expect(parseBootstrapAnchorConflict(conflict).ok).toBe(true);
    expect(
      validateBootstrapAnchorConflictBinding(
        f.anchorRecord,
        conflict,
        losingProposal,
        f.active,
        f.activeSelection.tip,
        f.activeSelection.proposal,
        f.active,
      ),
    ).toEqual([]);
    expect(computeBootstrapAnchorConflictDigest(conflict)).toBe(
      "874cf5d473f9b9c3a5528b20b8db81f2bdbc5803f32eaf9eaa71392286283e2d",
    );
    for (const [field, value] of [
      ["mutationId", d("e")],
      ["source", "TEARDOWN"],
      ["transitionEvidenceDigest", d("f")],
    ] as const) {
      const forgedProposal = { ...f.activeSelection.proposal, [field]: value };
      const forgedProposalDigest = computeBootstrapAnchorProposalDigest(forgedProposal);
      const forgedTip = {
        ...f.activeSelection.tip,
        proposalReceiptDigest: forgedProposalDigest,
      };
      const forgedConflict = {
        ...conflict,
        winningProposalReceiptDigest: forgedProposalDigest,
        winningTipDigest: computeBootstrapAnchorTipDigest(forgedTip),
      };
      expect(
        validateBootstrapAnchorConflictBinding(
          f.anchorRecord,
          forgedConflict,
          losingProposal,
          f.active,
          forgedTip,
          forgedProposal,
          f.active,
        ),
        field,
      ).not.toEqual([]);
    }
    const foreignTip = { ...f.activeSelection.tip, anchorDigest: d("f") };
    expect(
      validateBootstrapAnchorConflictBinding(
        f.anchorRecord,
        { ...conflict, winningTipDigest: computeBootstrapAnchorTipDigest(foreignTip) },
        losingProposal,
        f.active,
        foreignTip,
        f.activeSelection.proposal,
        f.active,
      ),
    ).not.toEqual([]);
  });

  test("rejects every omission, mixed groups, future enums, and hostile records", () => {
    const f = fixture();
    for (const [parser, record] of [
      [parseBootstrapAnchor, f.anchorRecord],
      [parseBootstrapAnchorLifecycleValue, f.active],
      [parseBootstrapAnchorProposal, f.activeSelection.proposal],
      [parseBootstrapAnchorTip, f.activeSelection.tip],
    ] as const)
      for (const name of Object.keys(record)) {
        const mutant = { ...record } as Record<string, unknown>;
        delete mutant[name];
        expect(parser(mutant).ok, `${record.schemaVersion}:missing:${name}`).toBe(false);
      }
    expect(
      parseBootstrapAnchorLifecycleValue({
        ...f.active,
        bootstrapGenesisCoreDigest: d("1"),
      }).ok,
    ).toBe(false);
    expect(parseBootstrapAnchorLifecycleValue({ ...f.active, lifecycle: "READY" }).ok).toBe(false);
    const hostile = new Proxy(f.anchorRecord, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(() => parseBootstrapAnchor(hostile)).not.toThrow();
    expect(parseBootstrapAnchor(hostile).ok).toBe(false);
  });
});

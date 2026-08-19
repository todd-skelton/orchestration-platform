import { describe, expect, test } from "vitest";
import {
  computeDestinationOwnerConflictDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  destinationOwnerSchemaFields,
  externalAuthorityPaths,
  parseContract,
  parseDestinationOwnerConflict,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTeardownArchive,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
  validateDestinationOwnerMutationBinding,
  validateDestinationOwnerConflictBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const destinationDigest = d("a");
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const successorInstallationId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const observationDigest = d("b");

function ownerValue(
  lifecycle: "ACTIVE" | "CONSUMED" | "RETIRED",
  ownerOrdinal: string,
  options: {
    anchorDigest?: string;
    installationId?: string;
    successorReviewCoreDigest?: string | null;
    teardownArchiveDigest?: string | null;
  } = {},
) {
  const selectedAnchor = lifecycle === "ACTIVE" ? null : d("3");
  return {
    anchorDigest: options.anchorDigest ?? d("1"),
    anchorReceiptDigest: selectedAnchor === null ? null : d("2"),
    anchorTipDigest: selectedAnchor,
    anchorValueDigest: selectedAnchor === null ? null : d("4"),
    destinationDigest,
    installationId: options.installationId ?? installationId,
    lifecycle,
    ownerOrdinal,
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: options.successorReviewCoreDigest ?? null,
    teardownArchiveDigest:
      options.teardownArchiveDigest ?? (lifecycle === "RETIRED" ? d("5") : null),
  };
}

function ownerProposal(
  transition:
    "ACTIVATE_GENESIS" | "CONSUME" | "RETIRE_UNUSED" | "RETIRE_CONSUMED" | "ACTIVATE_SUCCESSOR",
  source: "BOOTSTRAP_GENESIS" | "ANCHOR_CONSUMED" | "ANCHOR_RETIRED" | "SUCCESSOR_REVIEW",
  successor: ReturnType<typeof ownerValue>,
  evidence: string,
  prior: { proposalDigest: string; tipDigest: string; valueDigest: string } | null,
) {
  const proposal = {
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
  return { ...proposal, mutationId: computeDestinationOwnerMutationId(proposal, successor) };
}

function selected(
  value: ReturnType<typeof ownerValue>,
  proposal: ReturnType<typeof ownerProposal>,
) {
  const valueDigest = computeDestinationOwnerValueDigest(value);
  const proposalDigest = computeDestinationOwnerProposalDigest(proposal);
  const tip = {
    destinationDigest,
    proposalReceiptDigest: proposalDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest,
  };
  return {
    proposal,
    proposalDigest,
    tip,
    tipDigest: computeDestinationOwnerTipDigest(tip),
    value,
    valueDigest,
  };
}

type Prior = ReturnType<typeof selected>;

function expected(successor: ReturnType<typeof ownerValue>, transitionEvidenceDigest: string) {
  return {
    anchorDigest: successor.anchorDigest,
    destinationDigest,
    installationId: successor.installationId,
    observationDigest,
    transitionEvidenceDigest,
  };
}

function validate(
  proposal: ReturnType<typeof ownerProposal>,
  successor: ReturnType<typeof ownerValue>,
  prior: Prior | null,
  evidence: string,
) {
  return validateDestinationOwnerMutationBinding(
    proposal,
    successor,
    prior?.tip ?? null,
    prior?.value ?? null,
    prior?.proposal ?? null,
    expected(successor, evidence),
  );
}

describe("destination-owner contracts", () => {
  const active = ownerValue("ACTIVE", "0");
  const genesisProposal = ownerProposal(
    "ACTIVATE_GENESIS",
    "BOOTSTRAP_GENESIS",
    active,
    d("6"),
    null,
  );
  const activeSelection = selected(active, genesisProposal);

  test("closes and hashes owner value, proposal, and tip records", () => {
    expect(parseDestinationOwnerValue(active).ok).toBe(true);
    expect(parseDestinationOwnerProposal(genesisProposal).ok).toBe(true);
    expect(parseDestinationOwnerTip(activeSelection.tip).ok).toBe(true);
    expect(parseContract("state-mutation-destination-owner-value/v1", active).ok).toBe(true);
    expect(destinationOwnerSchemaFields.value).toEqual(Object.keys(active).sort());
    expect(destinationOwnerSchemaFields.proposal).toEqual(Object.keys(genesisProposal).sort());
    expect(destinationOwnerSchemaFields.tip).toEqual(Object.keys(activeSelection.tip).sort());
    expect({
      proposal: computeDestinationOwnerProposalDigest(genesisProposal),
      tip: computeDestinationOwnerTipDigest(activeSelection.tip),
      value: computeDestinationOwnerValueDigest(active),
    }).toEqual({
      proposal: "eecdc017f479abad036111ec8777163648e854ab7d61d0dbfdcf3712692a1149",
      tip: "ae6d370809c777291fcf9e7df5d29d1c28add396b73cfb1f87b1ff6d2df9eda8",
      value: "d845a9bf81e4415e4108fcd444d6e21b44d186e2713aae0959d218040f5be452",
    });
    expect(genesisProposal.positionDigest).toBe(
      computeDestinationOwnerPositionDigest(destinationDigest),
    );
    expect(
      externalAuthorityPaths.destinationOwnerValue(destinationDigest, genesisProposal.mutationId),
    ).toContain(`/values/${genesisProposal.mutationId}.json`);
  });

  test("accepts the exhaustive owner transition matrix", () => {
    expect(validate(genesisProposal, active, null, d("6"))).toEqual([]);

    const consumed = ownerValue("CONSUMED", "1");
    const consumeProposal = ownerProposal(
      "CONSUME",
      "ANCHOR_CONSUMED",
      consumed,
      consumed.anchorTipDigest!,
      activeSelection,
    );
    expect(validate(consumeProposal, consumed, activeSelection, consumed.anchorTipDigest!)).toEqual(
      [],
    );
    const consumedSelection = selected(consumed, consumeProposal);

    const retiredUnused = ownerValue("RETIRED", "1");
    const retireUnusedProposal = ownerProposal(
      "RETIRE_UNUSED",
      "ANCHOR_RETIRED",
      retiredUnused,
      retiredUnused.teardownArchiveDigest!,
      activeSelection,
    );
    expect(
      validate(
        retireUnusedProposal,
        retiredUnused,
        activeSelection,
        retiredUnused.teardownArchiveDigest!,
      ),
    ).toEqual([]);

    const retiredConsumed = ownerValue("RETIRED", "2");
    const retireConsumedProposal = ownerProposal(
      "RETIRE_CONSUMED",
      "ANCHOR_RETIRED",
      retiredConsumed,
      retiredConsumed.teardownArchiveDigest!,
      consumedSelection,
    );
    expect(
      validate(
        retireConsumedProposal,
        retiredConsumed,
        consumedSelection,
        retiredConsumed.teardownArchiveDigest!,
      ),
    ).toEqual([]);
    const retiredSelection = selected(retiredConsumed, retireConsumedProposal);

    const successor = ownerValue("ACTIVE", "3", {
      anchorDigest: d("7"),
      installationId: successorInstallationId,
      successorReviewCoreDigest: d("8"),
    });
    const successorProposal = ownerProposal(
      "ACTIVATE_SUCCESSOR",
      "SUCCESSOR_REVIEW",
      successor,
      successor.successorReviewCoreDigest!,
      retiredSelection,
    );
    expect(
      validate(
        successorProposal,
        successor,
        retiredSelection,
        successor.successorReviewCoreDigest!,
      ),
    ).toEqual([]);
  });

  test("rejects coordinated prior, branch, identity, observation, and evidence substitution", () => {
    const consumed = ownerValue("CONSUMED", "1");
    const proposal = ownerProposal(
      "CONSUME",
      "ANCHOR_CONSUMED",
      consumed,
      consumed.anchorTipDigest!,
      activeSelection,
    );
    expect(
      validate(
        { ...proposal, observationDigest: d("f") },
        consumed,
        activeSelection,
        consumed.anchorTipDigest!,
      ),
    ).not.toEqual([]);
    expect(
      validate(
        { ...proposal, source: "ANCHOR_RETIRED" },
        consumed,
        activeSelection,
        consumed.anchorTipDigest!,
      ),
    ).not.toEqual([]);
    expect(
      validate(
        { ...proposal, transitionEvidenceDigest: d("f") },
        consumed,
        activeSelection,
        consumed.anchorTipDigest!,
      ),
    ).not.toEqual([]);
    expect(
      validate(
        proposal,
        { ...consumed, installationId: successorInstallationId },
        activeSelection,
        consumed.anchorTipDigest!,
      ),
    ).not.toEqual([]);
    expect(
      validateDestinationOwnerMutationBinding(
        proposal,
        consumed,
        { ...activeSelection.tip, valueDigest: d("f") },
        { ...activeSelection.value, hostChosen: d("f") },
        activeSelection.proposal,
        expected(consumed, consumed.anchorTipDigest!),
      ),
    ).not.toEqual([]);
  });

  test("closes conflict and teardown archive records", () => {
    const losingValue = ownerValue("ACTIVE", "0", { anchorDigest: d("9") });
    const losingProposal = ownerProposal(
      "ACTIVATE_GENESIS",
      "BOOTSTRAP_GENESIS",
      losingValue,
      d("6"),
      null,
    );
    const conflict = {
      conflictAt: "2026-08-18T12:00:02.000Z",
      destinationDigest,
      losingProposalReceiptDigest: computeDestinationOwnerProposalDigest(losingProposal),
      losingSuccessorValueDigest: computeDestinationOwnerValueDigest(losingValue),
      mutationId: losingProposal.mutationId,
      schemaVersion: "state-mutation-destination-owner-conflict-receipt/v1",
      winningProposalReceiptDigest: activeSelection.proposalDigest,
      winningTipDigest: activeSelection.tipDigest,
      winningValueDigest: activeSelection.valueDigest,
    };
    const archive = {
      anchorRetiredReceiptDigest: d("1"),
      anchorRetiredTipDigest: d("2"),
      anchorRetiredValueDigest: d("3"),
      destinationDigest,
      installationId,
      observationDigest: d("4"),
      priorOwnerReceiptDigest: d("5"),
      priorOwnerTipDigest: d("6"),
      priorOwnerValueDigest: d("7"),
      schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
      teardownReceiptDigest: d("8"),
    };
    expect(parseDestinationOwnerConflict(conflict).ok).toBe(true);
    expect(parseDestinationOwnerTeardownArchive(archive).ok).toBe(true);
    expect(destinationOwnerSchemaFields.conflict).toEqual(Object.keys(conflict).sort());
    expect(destinationOwnerSchemaFields.archive).toEqual(Object.keys(archive).sort());
    expect({
      archive: computeDestinationOwnerTeardownArchiveDigest(archive),
      conflict: computeDestinationOwnerConflictDigest(conflict),
    }).toEqual({
      archive: "b6c5c8e2c9a2c560f171316bd78de527b8f1090f8bd3338c17701368ac3415bb",
      conflict: "2ab4bbe1aa04d979466a5f431095aba2707d62e7b2e427ed1bbd17d28643eaf5",
    });
    expect(
      validateDestinationOwnerConflictBinding(
        conflict,
        losingProposal,
        losingValue,
        activeSelection.tip,
        activeSelection.proposal,
        activeSelection.value,
      ),
    ).toEqual([]);
    expect(
      validateDestinationOwnerConflictBinding(
        { ...conflict, winningTipDigest: d("f") },
        losingProposal,
        losingValue,
        activeSelection.tip,
        activeSelection.proposal,
        activeSelection.value,
      ),
    ).not.toEqual([]);
    for (const [field, value] of [
      ["mutationId", d("e")],
      ["positionDigest", d("f")],
      ["source", "SUCCESSOR_REVIEW"],
    ] as const) {
      const forgedWinningProposal = { ...activeSelection.proposal, [field]: value };
      const forgedWinningProposalDigest =
        computeDestinationOwnerProposalDigest(forgedWinningProposal);
      const forgedWinningTip = {
        ...activeSelection.tip,
        proposalReceiptDigest: forgedWinningProposalDigest,
      };
      const forgedConflict = {
        ...conflict,
        winningProposalReceiptDigest: forgedWinningProposalDigest,
        winningTipDigest: computeDestinationOwnerTipDigest(forgedWinningTip),
      };
      expect(
        validateDestinationOwnerConflictBinding(
          forgedConflict,
          losingProposal,
          losingValue,
          forgedWinningTip,
          forgedWinningProposal,
          activeSelection.value,
        ),
        `coordinated-winning:${field}`,
      ).not.toEqual([]);
    }
  });

  test("rejects every omitted member, mixed nullability, and future values", () => {
    const conflict = {
      conflictAt: "2026-08-18T12:00:02.000Z",
      destinationDigest,
      losingProposalReceiptDigest: d("1"),
      losingSuccessorValueDigest: d("2"),
      mutationId: d("3"),
      schemaVersion: "state-mutation-destination-owner-conflict-receipt/v1",
      winningProposalReceiptDigest: d("4"),
      winningTipDigest: d("5"),
      winningValueDigest: d("6"),
    };
    const archive = {
      anchorRetiredReceiptDigest: d("1"),
      anchorRetiredTipDigest: d("2"),
      anchorRetiredValueDigest: d("3"),
      destinationDigest,
      installationId,
      observationDigest: d("4"),
      priorOwnerReceiptDigest: d("5"),
      priorOwnerTipDigest: d("6"),
      priorOwnerValueDigest: d("7"),
      schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
      teardownReceiptDigest: d("8"),
    };
    for (const [parser, record] of [
      [parseDestinationOwnerValue, active],
      [parseDestinationOwnerProposal, genesisProposal],
      [parseDestinationOwnerTip, activeSelection.tip],
      [parseDestinationOwnerConflict, conflict],
      [parseDestinationOwnerTeardownArchive, archive],
    ] as const)
      for (const name of Object.keys(record)) {
        const mutant = { ...record } as Record<string, unknown>;
        delete mutant[name];
        expect(parser(mutant).ok, `${record.schemaVersion}:missing:${name}`).toBe(false);
      }
    expect(parseDestinationOwnerValue({ ...active, anchorTipDigest: d("1") }).ok).toBe(false);
    expect(parseDestinationOwnerValue({ ...active, lifecycle: "READY" }).ok).toBe(false);
    expect(parseDestinationOwnerProposal({ ...genesisProposal, priorTipDigest: d("1") }).ok).toBe(
      false,
    );
    expect(parseDestinationOwnerProposal({ ...genesisProposal, transition: "COMPACT" }).ok).toBe(
      false,
    );
  });
});

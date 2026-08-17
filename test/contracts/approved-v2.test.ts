import { describe, expect, test } from "vitest";
import {
  canonicalDigest,
  compareDecimalAscii,
  computeAuthorityEmptyDigest,
  computeAuthorityEmptyRootDigest,
  computeAuthorityEpochKey,
  computeAuthorityHistoryRootDigest,
  computeAuthorityLeafDigest,
  computeAuthorityNodeDigest,
  computeAuthorityAppendReceiptDigest,
  computeAuthorityRotationId,
  computeAuthoritySuccessorCoreDigest,
  computeAuthorityUpdateProofDigest,
  computeSparseRoot,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorLifecycleArchiveDigest,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTeardownDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostDigest,
  computeCommitResolutionDigest,
  computeDestinationDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerRetirementEvidenceDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeGlobalIdentityDigest,
  computePhysicalDestinationDigest,
  computePhysicalObservationDigest,
  computeCurrentTipDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeRunAuditDigest,
  computeRunCheckpointCoreDigest,
  computeRunId,
  computeRunPostSelectionDigest,
  computeRunSegmentDigest,
  diagnostic,
  derivePointerPositionEvidence,
  externalAuthorityPaths,
  framedBytes,
  incrementDecimalAscii,
  parseContract,
  pointerKinds,
  pointerPath,
  pointerRegistry,
  schemaVersions,
  validateBootstrapAnchorTransition,
  validateBootstrapAnchorComposition,
  validateAuthorityMembership,
  validateAuthorityHistoryNodeInventoryPage,
  validateAuthoritySingleUpdateWitness,
  validateAuthorityValueHistoryBinding,
  validateBootstrapGenesisGraph,
  validateCommitRunSequence,
  validateDestinationOwnerTransition,
  validateDestinationOwnerComposition,
  validateEvidencePacketV2,
  type ContractRecord,
  type JsonValue,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, uuid, uuid2 } from "./fixtures.js";

const digest3 = "c".repeat(64);
const digest4 = "d".repeat(64);

describe("approved v2 authority contracts", () => {
  test("pins the thirteen-kind registry and diagnostic-only superseded authority", () => {
    expect(pointerKinds).toHaveLength(13);
    expect(pointerKinds.at(-1)).toBe("AUTHORITY_NODE_MATERIALIZATION_RUN");
    expect(
      pointerRegistry.find((row) => row.kind === "STATE_MUTATION_AUTHORITY_ROTATION")?.valueSchemas,
    ).toEqual(["state-mutation-authority-value/v3"]);
    expect(schemaVersions).toContain("pointer-cas-proposal-receipt/v2");
    expect(schemaVersions).not.toContain("pointer-cas-proposal-receipt/v1");
    expect(schemaVersions).toContain("state-mutation-authority-value/v3");
    expect(schemaVersions).not.toContain("state-mutation-authority-value/v2");
    expect(schemaVersions).not.toContain("state-mutation-authority-value/v1");
    expect(diagnostic.schemaVersions).toContain("pointer-cas-proposal-receipt/v1");
    expect(diagnostic.schemaVersions).toContain("state-mutation-authority-value/v1");
    expect(diagnostic.schemaVersions).toContain("state-mutation-authority-value/v2");
    expect(
      canonicalDigest(
        schemaVersions.map((schemaVersion) => ({
          digest: canonicalDigest(fixtureFor(schemaVersion)),
          schemaVersion,
        })),
      ),
    ).toBe("61ec448b230294e2cbf1b8ac8c73a64a8350b082bb257e596cdc83e72d02c24d");
  });

  test("closes bootstrap versus selected-epoch proposal producers", () => {
    const proposal = fixtureFor("pointer-cas-proposal-receipt/v2");
    const bootstrap = {
      ...proposal,
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      authorityEpochTipDigest: null,
      authorityEpochValueDigest: null,
      authorityEpochReceiptDigest: null,
    };
    expect(parseContract("pointer-cas-proposal-receipt/v2", bootstrap).ok).toBe(true);
    expect(
      parseContract("pointer-cas-proposal-receipt/v2", {
        ...bootstrap,
        priorTipDigest: digest,
        priorValueDigest: digest,
        priorReceiptDigest: digest,
      }).ok,
    ).toBe(false);
    expect(
      parseContract("pointer-cas-proposal-receipt/v2", {
        ...proposal,
        producerKind: "SELECTED_EPOCH",
        authorityEpochTipDigest: null,
        authorityEpochValueDigest: null,
        authorityEpochReceiptDigest: null,
      }).ok,
    ).toBe(false);
  });

  test("uses arbitrary DECIMAL_ASCII without Number coercion", () => {
    const huge = "9".repeat(512);
    const successor = `1${"0".repeat(512)}`;
    expect(incrementDecimalAscii(huge)).toBe(successor);
    expect(compareDecimalAscii(huge, successor)).toBe(-1);
    expect(compareDecimalAscii(successor, successor)).toBe(0);
    for (const invalid of ["", "00", "+1", "-1", "1.0", " 1"])
      expect(() => incrementDecimalAscii(invalid)).toThrow(/decimal/);
    const bytes = framedBytes("authority-history-root/v1", [
      { type: "decimal-ascii", value: successor },
    ]);
    expect(canonicalDigest({ hex: Buffer.from(bytes).toString("hex") })).toBe(
      "e22155ca29b546b03f0fddf6f302eb047ccdc3642eeeb95647132c09560c611f",
    );
  });

  test("keeps physical destination stable across admitted locator observations", () => {
    const identity = fixtureFor("physical-destination-identity/v1");
    const dphys = computePhysicalDestinationDigest(identity);
    const ddest = computeDestinationDigest(dphys);
    const observationA = {
      ...fixtureFor("physical-destination-locator-observation-receipt/v1"),
      physicalDestinationDigest: dphys,
    };
    const observationB = {
      ...observationA,
      helperDigest: digest2,
      helperVersion: "2.0.0",
      caseComparisonProfile: "profile-b",
      custodyInstanceDigest: digest3,
    };
    const dobsA = computePhysicalObservationDigest(observationA);
    const dobsB = computePhysicalObservationDigest(observationB);
    expect(dobsA).not.toBe(dobsB);
    expect(computeDestinationDigest(dphys)).toBe(ddest);
    expect(externalAuthorityPaths.physicalIdentity(dphys)).toBe(
      `state-mutation-destination-identities/${dphys}/identity.json`,
    );
    expect(externalAuthorityPaths.physicalObservation(dphys, dobsA)).toContain(dobsA);
    expect(() => externalAuthorityPaths.physicalIdentity(dphys.toUpperCase())).toThrow();
    for (const canonicalLeafName of [".", "..", "a/b", "a\\b"])
      expect(
        parseContract("physical-destination-identity/v1", {
          ...identity,
          canonicalLeafName,
        }).ok,
      ).toBe(false);
    const windowsIdentity = {
      ...identity,
      os: "windows",
      leafNameProfile: "WINDOWS_NFC_CASE_INSENSITIVE_V1",
      canonicalLeafName: "alpha",
    };
    expect(parseContract("physical-destination-identity/v1", windowsIdentity).ok).toBe(true);
    expect(
      parseContract("physical-destination-identity/v1", {
        ...windowsIdentity,
        canonicalLeafName: "straße",
      }).ok,
    ).toBe(true);
    expect(
      computePhysicalDestinationDigest({ ...windowsIdentity, canonicalLeafName: "straße" }),
    ).not.toBe(
      computePhysicalDestinationDigest({ ...windowsIdentity, canonicalLeafName: "strasse" }),
    );
    for (const canonicalLeafName of [
      "Alpha",
      "con",
      "com1.txt",
      "com¹",
      "lpt².log",
      "lpt³",
      "alpha.",
      "alpha ",
      "a:b",
    ])
      expect(
        parseContract("physical-destination-identity/v1", {
          ...windowsIdentity,
          canonicalLeafName,
        }).ok,
      ).toBe(false);
    const macosIdentity = {
      ...identity,
      os: "macos",
      leafNameProfile: "MACOS_NFD_CASE_INSENSITIVE_V1",
      canonicalLeafName: "e\u0301",
    };
    expect(parseContract("physical-destination-identity/v1", macosIdentity).ok).toBe(true);
    expect(
      parseContract("physical-destination-identity/v1", {
        ...macosIdentity,
        canonicalLeafName: "é",
      }).ok,
    ).toBe(false);
    expect(
      parseContract("physical-destination-identity/v1", {
        ...identity,
        canonicalLeafName: "Alpha",
      }).ok,
    ).toBe(true);
    expect(computePhysicalDestinationDigest({ ...identity, canonicalLeafName: "Alpha" })).not.toBe(
      computePhysicalDestinationDigest({ ...identity, canonicalLeafName: "alpha" }),
    );
    expect(
      parseContract("physical-destination-identity/v1", {
        ...identity,
        canonicalLeafName: "e\u0301",
      }).ok,
    ).toBe(false);
    expect(
      parseContract("physical-destination-identity/v1", {
        ...identity,
        leafNameProfile: "WINDOWS_NFC_CASE_INSENSITIVE_V1",
      }).ok,
    ).toBe(false);
    expect(canonicalDigest({ ddest, dobsA, dobsB, dphys })).toBe(
      "e1c6ac271b02dbfd73f0bbfdd92cb25f3a81b5ee64c087a0b6e1e025dd301018",
    );
  });

  test("closes destination owner lifecycle and exact acyclic digests", () => {
    const genesis: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-destination-owner-value/v1"),
      ownerOrdinal: "0",
      lifecycle: "ACTIVE",
      successorReviewCoreDigest: null,
    };
    const consumed = {
      ...genesis,
      ownerOrdinal: "1",
      lifecycle: "CONSUMED",
    };
    const retired = {
      ...consumed,
      ownerOrdinal: "2",
      lifecycle: "RETIRED",
      teardownArchiveDigest: digest,
      retirementAnchorTipDigest: digest,
      retirementAnchorValueDigest: digest2,
      retirementAnchorReceiptDigest: digest3,
    };
    const successor = {
      ...retired,
      ownerOrdinal: "3",
      lifecycle: "ACTIVE",
      installationId: uuid2,
      bootstrapAnchorDigest: digest4,
      successorReviewCoreDigest: digest2,
      teardownArchiveDigest: null,
      retirementAnchorTipDigest: null,
      retirementAnchorValueDigest: null,
      retirementAnchorReceiptDigest: null,
    };
    expect(validateDestinationOwnerTransition(null, genesis)).toEqual([]);
    expect(validateDestinationOwnerTransition(genesis, consumed)).toEqual([]);
    expect(validateDestinationOwnerTransition(consumed, retired)).toEqual([]);
    expect(validateDestinationOwnerTransition(retired, successor)).toEqual([]);
    expect(
      parseContract("state-mutation-destination-owner-value/v1", {
        ...retired,
        retirementAnchorTipDigest: null,
        retirementAnchorValueDigest: null,
        retirementAnchorReceiptDigest: null,
      }).ok,
    ).toBe(false);
    const lifecycleArchive = fixtureFor("state-mutation-bootstrap-anchor-lifecycle-archive/v1");
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-archive/v1", lifecycleArchive).ok,
    ).toBe(true);
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-archive/v1", {
        ...lifecycleArchive,
        ownerRetiredTipDigest: digest,
      }).ok,
    ).toBe(false);
    const activeAnchorValue = fixtureFor("state-mutation-bootstrap-anchor-lifecycle-value/v1");
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-value/v1", {
        ...activeAnchorValue,
        useIntentDigest: digest,
      }).ok,
    ).toBe(false);
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-value/v1", {
        ...activeAnchorValue,
        lifecycle: "CONSUMED",
      }).ok,
    ).toBe(false);
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-value/v1", {
        ...activeAnchorValue,
        lifecycle: "RETIRED",
      }).ok,
    ).toBe(false);
    expect(validateDestinationOwnerTransition(genesis, successor)).toContain(
      "lifecycle:transition-refused",
    );
    expect(
      validateDestinationOwnerTransition(retired, {
        ...successor,
        successorReviewCoreDigest: null,
      }),
    ).not.toEqual([]);
    const dov = computeDestinationOwnerValueDigest(genesis);
    const proposal: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-destination-owner-cas-proposal/v1"),
      destinationDigest: genesis.destinationDigest!,
      successorValueDigest: dov,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      transition: "ACTIVATE_GENESIS",
    };
    const mutationId = computeDestinationOwnerMutationId({
      destinationDigest: genesis.destinationDigest,
      currentPath: externalAuthorityPaths.destinationOwnerCurrent(
        genesis.destinationDigest as string,
      ),
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      ownerOrdinal: "0",
      transition: "ACTIVATE_GENESIS",
      successorValueDigest: dov,
      installationId: genesis.installationId,
      bootstrapAnchorDigest: genesis.bootstrapAnchorDigest,
      source: "reviewed-bootstrap",
      transitionEvidenceDigest: digest,
    });
    proposal.mutationId = mutationId;
    const dor = computeDestinationOwnerProposalDigest(proposal);
    const dot = computeDestinationOwnerTipDigest({
      ...fixtureFor("state-mutation-destination-owner-current-tip/v1"),
      destinationDigest: genesis.destinationDigest,
      valueDigest: dov,
      proposalReceiptDigest: dor,
    });
    expect(canonicalDigest({ dor, dot, dov, mutationId })).toBe(
      "4a4d658d3d9974f15470af55a1324cc31b57bb6fa047dfc106af864df11d8191",
    );
  });

  test("composes admitted destination ownership and ACTIVE bootstrap anchor selection", () => {
    const physicalIdentity = fixtureFor("physical-destination-identity/v1");
    const dphys = computePhysicalDestinationDigest(physicalIdentity);
    const observation = {
      ...fixtureFor("physical-destination-locator-observation-receipt/v1"),
      physicalDestinationDigest: dphys,
      disposition: "ADMITTED",
    };
    const dobs = computePhysicalObservationDigest(observation);
    const ddest = computeDestinationDigest(dphys);
    const anchor: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor/v1"),
      destinationDigest: ddest,
    };
    const dba = computeBootstrapAnchorDigest(anchor);
    const ownerValue: ContractRecord = {
      ...fixtureFor("state-mutation-destination-owner-value/v1"),
      destinationDigest: ddest,
      physicalObservationDigest: dobs,
      installationId: anchor.installationId!,
      bootstrapAnchorDigest: dba,
      ownerOrdinal: "0",
      lifecycle: "ACTIVE",
    };
    const dov = computeDestinationOwnerValueDigest(ownerValue);
    const ownerMutationId = computeDestinationOwnerMutationId({
      destinationDigest: ddest,
      currentPath: externalAuthorityPaths.destinationOwnerCurrent(ddest),
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      ownerOrdinal: "0",
      transition: "ACTIVATE_GENESIS",
      successorValueDigest: dov,
      installationId: ownerValue.installationId as string,
      bootstrapAnchorDigest: dba,
      source: "reviewed-bootstrap",
      transitionEvidenceDigest: dobs,
    });
    const ownerProposal: ContractRecord = {
      ...fixtureFor("state-mutation-destination-owner-cas-proposal/v1"),
      destinationDigest: ddest,
      mutationId: ownerMutationId,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: dov,
      transition: "ACTIVATE_GENESIS",
      positionDigest: dobs,
    };
    const dor = computeDestinationOwnerProposalDigest(ownerProposal);
    const ownerTip: ContractRecord = {
      ...fixtureFor("state-mutation-destination-owner-current-tip/v1"),
      destinationDigest: ddest,
      valueDigest: dov,
      proposalReceiptDigest: dor,
    };
    const ownerSelection = { value: ownerValue, proposal: ownerProposal, tip: ownerTip };
    const ownerComposition = {
      anchorConsumed: null,
      anchorRetired: null,
      anchorConsumptionReceipt: null,
      current: ownerSelection,
      now: instant,
      observation,
      ownerRetired: null,
      physicalIdentity,
      previous: null,
      successorPost: null,
      successorReviewCore: null,
      teardownArchive: null,
    };
    expect(validateDestinationOwnerComposition(ownerComposition)).toEqual([]);
    expect(
      validateDestinationOwnerComposition({
        ...ownerComposition,
        observation: { ...observation, disposition: "UNKNOWN" },
      }),
    ).not.toEqual([]);
    const dot = computeDestinationOwnerTipDigest(ownerTip);
    const anchorValue: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor-lifecycle-value/v1"),
      bootstrapAnchorDigest: dba,
      lifecycle: "ACTIVE",
      ownerActiveTipDigest: dot,
      ownerActiveValueDigest: dov,
      ownerActiveReceiptDigest: dor,
    };
    const dbav = computeBootstrapAnchorValueDigest(anchorValue);
    const anchorProposal: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor-cas-proposal/v1"),
      bootstrapAnchorDigest: dba,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: dbav,
      transition: "ACTIVATE",
    };
    const dbar = computeBootstrapAnchorProposalDigest(anchorProposal);
    const anchorTip: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor-current-tip/v1"),
      bootstrapAnchorDigest: dba,
      valueDigest: dbav,
      proposalReceiptDigest: dbar,
    };
    expect(
      validateBootstrapAnchorComposition({
        anchor,
        anchorRetired: null,
        consumptionReceipt: null,
        current: { value: anchorValue, proposal: anchorProposal, tip: anchorTip },
        genesisPost: null,
        genesisGraph: null,
        now: instant,
        ownerActive: ownerSelection,
        ownerConsumed: null,
        ownerObservation: observation,
        ownerPhysicalIdentity: physicalIdentity,
        previous: null,
        successorPost: null,
        successorReviewCore: null,
        teardownArchive: null,
        teardownReceipt: null,
        useIntent: null,
      }),
    ).toEqual([]);
    const activeAnchorSelection = {
      value: anchorValue,
      proposal: anchorProposal,
      tip: anchorTip,
    };
    const dbat = computeBootstrapAnchorTipDigest(anchorTip);
    const lifecycleArchive: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor-lifecycle-archive/v1"),
      bootstrapAnchorDigest: dba,
      priorTipDigest: dbat,
      priorValueDigest: dbav,
      priorReceiptDigest: dbar,
      ownerPredecessorTipDigest: dot,
      ownerPredecessorValueDigest: dov,
      ownerPredecessorReceiptDigest: dor,
    };
    const lifecycleArchiveDigest = computeBootstrapAnchorLifecycleArchiveDigest(lifecycleArchive);
    const teardownReceipt: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor-teardown-receipt/v1"),
      bootstrapAnchorDigest: dba,
      priorTipDigest: dbat,
      priorValueDigest: dbav,
      priorReceiptDigest: dbar,
      destinationDigest: ddest,
      ownerTipDigest: dot,
      ownerValueDigest: dov,
      ownerReceiptDigest: dor,
      externalArchiveDigest: lifecycleArchiveDigest,
    };
    const teardownReceiptDigest = computeBootstrapAnchorTeardownDigest(teardownReceipt);
    const retiredAnchorValue: ContractRecord = {
      ...anchorValue,
      lifecycle: "RETIRED",
      teardownReceiptDigest,
    };
    const retiredAnchorValueDigest = computeBootstrapAnchorValueDigest(retiredAnchorValue);
    const retiredAnchorProposal: ContractRecord = {
      ...anchorProposal,
      priorTipDigest: dbat,
      priorValueDigest: dbav,
      priorReceiptDigest: dbar,
      successorValueDigest: retiredAnchorValueDigest,
      transition: "RETIRE",
    };
    const retiredAnchorReceiptDigest = computeBootstrapAnchorProposalDigest(retiredAnchorProposal);
    const retiredAnchorTip: ContractRecord = {
      ...anchorTip,
      valueDigest: retiredAnchorValueDigest,
      proposalReceiptDigest: retiredAnchorReceiptDigest,
    };
    const retiredAnchorSelection = {
      value: retiredAnchorValue,
      proposal: retiredAnchorProposal,
      tip: retiredAnchorTip,
    };
    expect(
      validateBootstrapAnchorComposition({
        anchor,
        anchorRetired: retiredAnchorSelection,
        consumptionReceipt: null,
        current: retiredAnchorSelection,
        genesisPost: null,
        genesisGraph: null,
        now: instant,
        ownerActive: ownerSelection,
        ownerConsumed: null,
        ownerObservation: observation,
        ownerPhysicalIdentity: physicalIdentity,
        previous: activeAnchorSelection,
        successorPost: null,
        successorReviewCore: null,
        teardownArchive: lifecycleArchive,
        teardownReceipt,
        useIntent: null,
      }),
    ).toEqual([]);
    const retiredAnchorTipDigest = computeBootstrapAnchorTipDigest(retiredAnchorTip);
    const ownerArchive: ContractRecord = {
      ...fixtureFor("state-mutation-destination-owner-teardown-archive/v1"),
      destinationDigest: ddest,
      ownerTipDigest: dot,
      ownerValueDigest: dov,
      ownerReceiptDigest: dor,
      installationId: ownerValue.installationId as string,
      bootstrapAnchorDigest: dba,
    };
    const ownerArchiveDigest = computeDestinationOwnerTeardownArchiveDigest(ownerArchive);
    const retiredOwnerValue: ContractRecord = {
      ...ownerValue,
      ownerOrdinal: "1",
      lifecycle: "RETIRED",
      teardownArchiveDigest: ownerArchiveDigest,
      retirementAnchorTipDigest: retiredAnchorTipDigest,
      retirementAnchorValueDigest: retiredAnchorValueDigest,
      retirementAnchorReceiptDigest: retiredAnchorReceiptDigest,
    };
    const retiredOwnerValueDigest = computeDestinationOwnerValueDigest(retiredOwnerValue);
    const retirementEvidenceDigest = computeDestinationOwnerRetirementEvidenceDigest({
      teardownArchiveDigest: ownerArchiveDigest,
      anchorTipDigest: retiredAnchorTipDigest,
      anchorValueDigest: retiredAnchorValueDigest,
      anchorReceiptDigest: retiredAnchorReceiptDigest,
    });
    const retiredOwnerMutationId = computeDestinationOwnerMutationId({
      destinationDigest: ddest,
      currentPath: externalAuthorityPaths.destinationOwnerCurrent(ddest),
      priorTipDigest: dot,
      priorValueDigest: dov,
      priorReceiptDigest: dor,
      ownerOrdinal: "1",
      transition: "RETIRE_UNUSED",
      successorValueDigest: retiredOwnerValueDigest,
      installationId: ownerValue.installationId,
      bootstrapAnchorDigest: dba,
      source: "teardown",
      transitionEvidenceDigest: retirementEvidenceDigest,
    });
    const retiredOwnerProposal: ContractRecord = {
      ...ownerProposal,
      mutationId: retiredOwnerMutationId,
      priorTipDigest: dot,
      priorValueDigest: dov,
      priorReceiptDigest: dor,
      successorValueDigest: retiredOwnerValueDigest,
      transition: "RETIRE_UNUSED",
      positionDigest: retirementEvidenceDigest,
    };
    const retiredOwnerReceiptDigest = computeDestinationOwnerProposalDigest(retiredOwnerProposal);
    const retiredOwnerTip: ContractRecord = {
      ...ownerTip,
      valueDigest: retiredOwnerValueDigest,
      proposalReceiptDigest: retiredOwnerReceiptDigest,
    };
    const retiredOwnerSelection = {
      value: retiredOwnerValue,
      proposal: retiredOwnerProposal,
      tip: retiredOwnerTip,
    };
    const retiredOwnerComposition = {
      ...ownerComposition,
      anchorRetired: retiredAnchorSelection,
      current: retiredOwnerSelection,
      ownerRetired: retiredOwnerSelection,
      previous: ownerSelection,
      teardownArchive: ownerArchive,
    };
    expect(validateDestinationOwnerComposition(retiredOwnerComposition)).toEqual([]);
    expect(
      validateDestinationOwnerComposition({
        ...retiredOwnerComposition,
        anchorRetired: null,
      }),
    ).not.toEqual([]);
    expect(
      validateDestinationOwnerComposition({
        ...retiredOwnerComposition,
        current: {
          ...retiredOwnerSelection,
          value: { ...retiredOwnerValue, retirementAnchorValueDigest: digest },
        },
      }),
    ).not.toEqual([]);
  });

  test("keeps the external anchor to E0 graph acyclic and cross-bound", () => {
    const authorityPath = pointerPath("STATE_MUTATION_AUTHORITY_ROTATION");
    const identityBase = fixtureFor("state-mutation-global-identity/v1");
    const dp = computePointerInstanceDigest({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      installationId: identityBase.installationId as string,
      projectId: identityBase.projectId as string,
      stateRootDigest: identityBase.stateRootDigest as string,
      transactionId: null,
      sourceToken: "none",
    });
    const identity: ContractRecord = {
      ...identityBase,
      authorityPath,
      authorityPathInstanceDigest: dp,
    };
    const g = computeGlobalIdentityDigest(identity);
    const anchor: ContractRecord = {
      ...fixtureFor("state-mutation-bootstrap-anchor/v1"),
      installationId: identity.installationId!,
      projectId: identity.projectId!,
      destinationStateRootDigest: identity.stateRootDigest!,
      custodyInstanceDigest: identity.custodyInstanceDigest!,
      authorityPath,
    };
    const dba = computeBootstrapAnchorDigest(anchor);
    const active = {
      ...fixtureFor("state-mutation-bootstrap-anchor-lifecycle-value/v1"),
      bootstrapAnchorDigest: dba,
      lifecycle: "ACTIVE",
    };
    const dbav = computeBootstrapAnchorValueDigest(active);
    const anchorProposal = {
      ...fixtureFor("state-mutation-bootstrap-anchor-cas-proposal/v1"),
      bootstrapAnchorDigest: dba,
      successorValueDigest: dbav,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      transition: "ACTIVATE",
    };
    const dbar = computeBootstrapAnchorProposalDigest(anchorProposal);
    const dbat = computeBootstrapAnchorTipDigest({
      ...fixtureFor("state-mutation-bootstrap-anchor-current-tip/v1"),
      bootstrapAnchorDigest: dba,
      valueDigest: dbav,
      proposalReceiptDigest: dbar,
    });
    const emptyRoot = {
      ...fixtureFor("authority-history-empty-root/v1"),
      globalIdentityDigest: g,
      treeRootDigest: computeAuthorityEmptyDigest(0),
    };
    const dhe = computeAuthorityEmptyRootDigest(emptyRoot);
    const authorityValue: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-authority-value/v2"),
      installationId: identity.installationId!,
      projectId: identity.projectId!,
      stateRootDigest: identity.stateRootDigest!,
      custodyInstanceDigest: identity.custodyInstanceDigest!,
      globalIdentityDigest: g,
      historyRootDigest: dhe,
    };
    const dv = computePointerValueDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, authorityValue);
    const positionEvidence = derivePointerPositionEvidence(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      authorityValue,
    );
    const positionDigest = computePointerPositionDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      positionEvidence,
    );
    const core: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-bootstrap-genesis-core/v1"),
      bootstrapAnchorDigest: dba,
      globalIdentityDigest: g,
      transactionId: anchor.bootstrapTransactionId!,
      authorityPathInstanceDigest: dp,
      authorityValueDigest: dv,
      genesisPositionDigest: positionDigest,
    };
    const dbg = computeBootstrapGenesisCoreDigest(core);
    const mutationId = computeMutationId({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      pathInstanceDigest: dp,
      transactionId: null,
      sourceToken: "none",
      positionEvidence,
      priorDt: null,
      priorDv: null,
      priorDr: null,
      successorDv: dv,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
    });
    const proposal = {
      ...fixtureFor("pointer-cas-proposal-receipt/v2"),
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: dp,
      mutationId,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: dv,
      positionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
      producerDigest: dbg,
      authorityEpochTipDigest: null,
      authorityEpochValueDigest: null,
      authorityEpochReceiptDigest: null,
    };
    const dr = computeProposalReceiptDigest({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: dp,
      mutationId,
      priorDt: null,
      priorDv: null,
      priorDr: null,
      successorDv: dv,
      positionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
      producerDigest: dbg,
      authorityEpochDt: null,
      authorityEpochDv: null,
      authorityEpochDr: null,
      receipt: proposal,
    });
    const tip = {
      ...fixtureFor("pointer-current-tip/v1"),
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: dp,
      valueDigest: dv,
      proposalReceiptDigest: dr,
    };
    const dt = computeCurrentTipDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, dv, dr, tip);
    const post = {
      ...fixtureFor("state-mutation-bootstrap-genesis-post-selection-receipt/v1"),
      bootstrapAnchorDigest: dba,
      genesisCoreDigest: dbg,
      authorityPathInstanceDigest: dp,
      valueDigest: dv,
      proposalReceiptDigest: dr,
      tipDigest: dt,
      valueReadbackDigest: dv,
      proposalReadbackDigest: dr,
      tipReadbackDigest: dt,
    };
    const dgp = computeBootstrapGenesisPostDigest(post);
    const graph = {
      anchor,
      authoritySelection: { value: authorityValue, proposal, tip },
      core,
      emptyRoot,
      globalIdentity: identity,
      post,
    };
    expect(validateBootstrapGenesisGraph(graph)).toEqual([]);
    const authorityEnvelope = {
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      installationId: identity.installationId,
      projectId: identity.projectId,
      stateRootDigest: identity.stateRootDigest,
      transactionId: null,
      sourceToken: "none",
      pathBindings: {},
      positionEvidence,
      tombstoneEvidence: null,
      value: authorityValue,
      proposal,
      tip,
    };
    const historicalPacket = {
      ...fixtureFor("pointer-evidence-packet/v2"),
      globalIdentity: identity,
      currentAuthoritySelection: authorityEnvelope,
      authorityHistoryBinding: {
        appendReceipt: null,
        authorityValue,
        globalIdentity: identity,
        historyRoot: emptyRoot,
        leaf: null,
        priorHistoryRoot: null,
        successorCore: null,
        updateProof: null,
      },
      evidenceSlots: pointerKinds.map((pointerKind) => ({
        schemaVersion: "pointer-evidence-slot/v2",
        pointerKind,
        selectedEvidence: null,
        producerMembershipIndex: null,
      })),
      producerMemberships: [],
    };
    expect(validateEvidencePacketV2(historicalPacket)).toEqual([]);
    expect(validateEvidencePacketV2({ ...historicalPacket, purpose: "MUTATION_COMMIT" })).toContain(
      "purpose:current-commit-mismatch",
    );
    expect(
      validateBootstrapGenesisGraph({
        ...graph,
        post: { ...post, genesisCoreDigest: digest2 },
      }),
    ).toContain("post:core-anchor-mismatch");
    expect(
      validateBootstrapAnchorTransition(active, {
        ...active,
        lifecycle: "CONSUMED",
        useIntentDigest: digest,
        genesisPostSelectionReceiptDigest: dgp,
      }),
    ).toEqual([]);
    expect(validateBootstrapAnchorTransition(active, active)).toContain(
      "lifecycle:transition-refused",
    );
    expect(canonicalDigest({ dba, dbar, dbat, dbav, dbg, dgp })).toBe(
      "4fa87a247a57515e974149b0eef4f79e6c25580db26083b65ce03acb0c76e6b6",
    );
  });

  test("pins sparse primitives to raw global identity and exact 256 depth", () => {
    const globalIdentity = fixtureFor("state-mutation-global-identity/v1");
    const globalIdentityDigest = computeGlobalIdentityDigest(globalIdentity);
    const leaf: Record<string, JsonValue> = {
      ...fixtureFor("authority-history-leaf/v1"),
      globalIdentityDigest,
      authorityPathInstanceDigest: globalIdentity.authorityPathInstanceDigest as string,
      authorityTipDigest: digest3,
      authorityValueDigest: digest4,
      authorityReceiptDigest: digest,
      authorityOrdinal: "0",
    };
    leaf.epochKey = computeAuthorityEpochKey({
      globalIdentityDigest: leaf.globalIdentityDigest as string,
      authorityPathInstanceDigest: leaf.authorityPathInstanceDigest as string,
      authorityTipDigest: leaf.authorityTipDigest as string,
      authorityValueDigest: leaf.authorityValueDigest as string,
      authorityReceiptDigest: leaf.authorityReceiptDigest as string,
    });
    const de = computeAuthorityLeafDigest(leaf);
    expect(computeAuthorityEmptyDigest(0)).not.toBe(computeAuthorityEmptyDigest(256));
    expect(computeAuthorityNodeDigest(0, de, digest)).not.toBe(
      computeAuthorityNodeDigest(0, digest, de),
    );
    expect(externalAuthorityPaths.historyNode(digest2)).toBe(
      `installation/state-mutation-authority-history/nodes/${digest2}.json`,
    );
    const node = fixtureFor("authority-history-node/v1");
    expect(
      validateAuthorityHistoryNodeInventoryPage({
        afterPath: null,
        complete: true,
        nextAfterPath: null,
        nodes: [node],
      }),
    ).toEqual([]);
    const lifetimeNodes = Array.from({ length: 300 }, (_, index) => {
      const leftChildDigest = index.toString(16).padStart(64, "0");
      const depth = index % 256;
      const nodeDigest = computeAuthorityNodeDigest(depth, leftChildDigest, digest2);
      return {
        ...fixtureFor("authority-history-node/v1"),
        depth: String(depth),
        leftChildDigest,
        rightChildDigest: digest2,
        nodeDigest,
        recordPath: externalAuthorityPaths.historyNode(nodeDigest),
      };
    }).sort((left, right) => left.recordPath.localeCompare(right.recordPath));
    const firstPage = lifetimeNodes.slice(0, 200);
    const secondPage = lifetimeNodes.slice(200);
    expect(
      validateAuthorityHistoryNodeInventoryPage({
        afterPath: null,
        complete: false,
        nextAfterPath: firstPage.at(-1)!.recordPath,
        nodes: firstPage,
      }),
    ).toEqual([]);
    expect(
      validateAuthorityHistoryNodeInventoryPage({
        afterPath: firstPage.at(-1)!.recordPath,
        complete: true,
        nextAfterPath: null,
        nodes: secondPage,
      }),
    ).toEqual([]);
    expect(
      validateAuthorityHistoryNodeInventoryPage({
        afterPath: null,
        complete: false,
        nextAfterPath: lifetimeNodes.at(-1)!.recordPath,
        nodes: lifetimeNodes,
      }),
    ).toEqual(["nodes:invalid"]);
    const siblings = Array.from({ length: 256 }, (_, index) =>
      computeAuthorityEmptyDigest(256 - index),
    );
    const emptyRoot = {
      ...fixtureFor("authority-history-empty-root/v1"),
      globalIdentityDigest,
      treeRootDigest: computeAuthorityEmptyDigest(0),
    };
    const dhe = computeAuthorityEmptyRootDigest(emptyRoot);
    const root = {
      ...fixtureFor("authority-history-root/v1"),
      globalIdentityDigest,
      count: "1",
      latestIncludedOrdinal: leaf.authorityOrdinal,
      latestEpochKey: leaf.epochKey,
      latestTipDigest: leaf.authorityTipDigest,
      latestValueDigest: leaf.authorityValueDigest,
      latestReceiptDigest: leaf.authorityReceiptDigest,
      treeRootDigest: computeSparseRoot(leaf.epochKey as string, de, siblings),
    };
    const dh = computeAuthorityHistoryRootDigest(root);
    const proof = {
      ...fixtureFor("authority-history-update-proof/v1"),
      globalIdentityDigest,
      epochKey: leaf.epochKey,
      leafDigest: de,
      priorRootKind: "EMPTY",
      priorRootDigest: dhe,
      successorRootDigest: dh,
      priorCount: "0",
      successorCount: "1",
      siblingDigests: siblings,
    };
    expect(
      validateAuthoritySingleUpdateWitness({
        globalIdentity,
        leaf,
        priorRoot: emptyRoot,
        proof,
        successorRoot: root,
      }),
    ).toEqual([]);
    expect(
      validateAuthorityMembership({
        currentAuthoritySelection: {},
        globalIdentity: {},
        leaf,
        root: emptyRoot,
        rootKind: "EMPTY",
        siblingDigests: siblings,
      }),
    ).toEqual(["membership:empty-root-refused"]);
    expect(
      validateAuthorityMembership({
        currentAuthoritySelection: {},
        globalIdentity: {},
        leaf,
        root,
        rootKind: "NONEMPTY",
        siblingDigests: siblings,
      }),
    ).not.toEqual([]);
    const leaf2: Record<string, JsonValue> = {
      ...leaf,
      authorityOrdinal: "1",
      authorityTipDigest: digest2,
      authorityValueDigest: digest3,
      authorityReceiptDigest: digest4,
    };
    leaf2.epochKey = computeAuthorityEpochKey({
      globalIdentityDigest: leaf2.globalIdentityDigest as string,
      authorityPathInstanceDigest: leaf2.authorityPathInstanceDigest as string,
      authorityTipDigest: leaf2.authorityTipDigest as string,
      authorityValueDigest: leaf2.authorityValueDigest as string,
      authorityReceiptDigest: leaf2.authorityReceiptDigest as string,
    });
    const bits = (key: string) =>
      [...Buffer.from(key, "hex")].flatMap((byte) =>
        Array.from({ length: 8 }, (_, bit) => (byte >> (7 - bit)) & 1),
      );
    const bits1 = bits(leaf.epochKey as string);
    const bits2 = bits(leaf2.epochKey as string);
    const divergence = bits1.findIndex((bit, index) => bit !== bits2[index]);
    expect(divergence).toBeGreaterThanOrEqual(0);
    let leaf1Subtree = de;
    for (let depth = 255; depth > divergence; depth -= 1) {
      const emptySibling = computeAuthorityEmptyDigest(depth + 1);
      leaf1Subtree =
        bits1[depth] === 0
          ? computeAuthorityNodeDigest(depth, leaf1Subtree, emptySibling)
          : computeAuthorityNodeDigest(depth, emptySibling, leaf1Subtree);
    }
    const siblings2 = Array.from({ length: 256 }, (_, index) =>
      computeAuthorityEmptyDigest(256 - index),
    );
    siblings2[255 - divergence] = leaf1Subtree;
    const de2 = computeAuthorityLeafDigest(leaf2);
    const root2 = {
      ...root,
      count: "2",
      latestIncludedOrdinal: "1",
      latestEpochKey: leaf2.epochKey,
      latestTipDigest: leaf2.authorityTipDigest,
      latestValueDigest: leaf2.authorityValueDigest,
      latestReceiptDigest: leaf2.authorityReceiptDigest,
      treeRootDigest: computeSparseRoot(leaf2.epochKey as string, de2, siblings2),
    };
    const dh2 = computeAuthorityHistoryRootDigest(root2);
    const proof2 = {
      ...proof,
      epochKey: leaf2.epochKey,
      leafDigest: de2,
      priorRootKind: "NONEMPTY",
      priorRootDigest: dh,
      successorRootDigest: dh2,
      priorCount: "1",
      successorCount: "2",
      siblingDigests: siblings2,
    };
    expect(
      validateAuthoritySingleUpdateWitness({
        globalIdentity,
        leaf: leaf2,
        priorRoot: root,
        proof: proof2,
        successorRoot: root2,
      }),
    ).toEqual([]);
    expect(
      validateAuthoritySingleUpdateWitness({
        globalIdentity,
        leaf: leaf2,
        priorRoot: root,
        proof: { ...proof2, priorRootKind: "EMPTY" },
        successorRoot: root2,
      }),
    ).not.toEqual([]);
    expect(canonicalDigest({ de, dh, dhe, epochKey: leaf.epochKey })).toBe(
      "59cc1fa480b48b11598b2aab6f372bcf6d274a9d2b3bbbb2f55be5ee610b65b1",
    );
    expect(
      parseContract("authority-history-update-proof/v1", {
        ...fixtureFor("authority-history-update-proof/v1"),
        siblingDigests: [digest],
      }).ok,
    ).toBe(false);
  });

  test("keeps G stable across rotating helper facts and binds E0 to Dhe", () => {
    const identityBase = fixtureFor("state-mutation-global-identity/v1");
    const authorityPath = pointerPath("STATE_MUTATION_AUTHORITY_ROTATION");
    const authorityDp = computePointerInstanceDigest({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      installationId: identityBase.installationId as string,
      projectId: identityBase.projectId as string,
      stateRootDigest: identityBase.stateRootDigest as string,
      transactionId: null,
      sourceToken: "none",
    });
    const identity: ContractRecord = {
      ...identityBase,
      authorityPath,
      authorityPathInstanceDigest: authorityDp,
    };
    const g = computeGlobalIdentityDigest(identity);
    const emptyRoot = {
      ...fixtureFor("authority-history-empty-root/v1"),
      globalIdentityDigest: g,
      treeRootDigest: computeAuthorityEmptyDigest(0),
    };
    const dhe = computeAuthorityEmptyRootDigest(emptyRoot);
    const authority = {
      ...fixtureFor("state-mutation-authority-value/v2"),
      installationId: identity.installationId,
      projectId: identity.projectId,
      stateRootDigest: identity.stateRootDigest,
      custodyInstanceDigest: identity.custodyInstanceDigest,
      globalIdentityDigest: g,
      historyRootKind: "EMPTY",
      historyRootDigest: dhe,
      historyCount: "0",
      helperDigest: digest,
    };
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt: null,
        authorityValue: authority,
        globalIdentity: identity,
        historyRoot: emptyRoot,
        leaf: null,
        priorHistoryRoot: null,
        successorCore: null,
        updateProof: null,
      }),
    ).toEqual([]);
    const leafBase: ContractRecord = {
      ...fixtureFor("authority-history-leaf/v1"),
      globalIdentityDigest: g,
      authorityOrdinal: "0",
      authorityPathInstanceDigest: identity.authorityPathInstanceDigest!,
      authorityTipDigest: digest2,
      authorityValueDigest: digest3,
      authorityReceiptDigest: digest4,
    };
    const epochKey = computeAuthorityEpochKey({
      globalIdentityDigest: g,
      authorityPathInstanceDigest: leafBase.authorityPathInstanceDigest as string,
      authorityTipDigest: leafBase.authorityTipDigest as string,
      authorityValueDigest: leafBase.authorityValueDigest as string,
      authorityReceiptDigest: leafBase.authorityReceiptDigest as string,
    });
    const leaf: ContractRecord = { ...leafBase, epochKey };
    const de = computeAuthorityLeafDigest(leaf);
    const siblings = Array.from({ length: 256 }, (_, index) =>
      computeAuthorityEmptyDigest(256 - index),
    );
    const historyRoot: ContractRecord = {
      ...fixtureFor("authority-history-root/v1"),
      globalIdentityDigest: g,
      count: "1",
      treeRootDigest: computeSparseRoot(leaf.epochKey as string, de, siblings),
      latestIncludedOrdinal: "0",
      latestEpochKey: leaf.epochKey!,
      latestTipDigest: leaf.authorityTipDigest!,
      latestValueDigest: leaf.authorityValueDigest!,
      latestReceiptDigest: leaf.authorityReceiptDigest!,
    };
    const dh = computeAuthorityHistoryRootDigest(historyRoot);
    const rotationOperationId = computeAuthorityRotationId({
      globalIdentityDigest: g,
      predecessorOrdinal: "0",
      predecessorTipDigest: leaf.authorityTipDigest as string,
      predecessorValueDigest: leaf.authorityValueDigest as string,
      predecessorReceiptDigest: leaf.authorityReceiptDigest as string,
      successorOrdinal: "1",
      selectedActiveReleaseDigest: digest,
      reviewedHelperDigest: digest,
      reviewedProfileDigest: digest,
      reviewedAbiDigest: digest,
      reviewedCustodyDigest: digest,
    });
    const successorCore: ContractRecord = {
      ...fixtureFor("state-mutation-authority-successor-core/v1"),
      globalIdentityDigest: g,
      rotationOperationId,
      predecessorTipDigest: leaf.authorityTipDigest!,
      predecessorValueDigest: leaf.authorityValueDigest!,
      predecessorReceiptDigest: leaf.authorityReceiptDigest!,
      successorOrdinal: "1",
      successorHistoryRootDigest: dh,
    };
    const successorCoreDigest = computeAuthoritySuccessorCoreDigest(successorCore);
    const updateProof: ContractRecord = {
      ...fixtureFor("authority-history-update-proof/v1"),
      globalIdentityDigest: g,
      epochKey: leaf.epochKey!,
      leafDigest: de,
      priorRootKind: "EMPTY",
      priorRootDigest: dhe,
      successorRootDigest: dh,
      priorCount: "0",
      successorCount: "1",
      siblingDigests: siblings,
    };
    const updateProofDigest = computeAuthorityUpdateProofDigest(updateProof);
    const appendReceipt: ContractRecord = {
      ...fixtureFor("authority-history-append-receipt/v1"),
      globalIdentityDigest: g,
      rotationOperationId,
      predecessorPathInstanceDigest: leaf.authorityPathInstanceDigest!,
      predecessorTipDigest: leaf.authorityTipDigest!,
      predecessorValueDigest: leaf.authorityValueDigest!,
      predecessorReceiptDigest: leaf.authorityReceiptDigest!,
      priorRootKind: "EMPTY",
      priorRootDigest: dhe,
      priorCount: "0",
      appendedEpochKey: leaf.epochKey!,
      leafDigest: de,
      updateProofDigest,
      successorRootDigest: dh,
      successorCount: "1",
      successorCoreDigest,
    };
    const appendDigest = computeAuthorityAppendReceiptDigest(appendReceipt);
    const rotatedAuthority: ContractRecord = {
      ...fixtureFor("state-mutation-authority-value/v2"),
      installationId: identity.installationId!,
      projectId: identity.projectId!,
      stateRootDigest: identity.stateRootDigest!,
      custodyInstanceDigest: identity.custodyInstanceDigest!,
      globalIdentityDigest: g,
      authorityOrdinal: "1",
      historyRootKind: "NONEMPTY",
      historyRootDigest: dh,
      historyCount: "1",
      historyAppendReceiptDigest: appendDigest,
      successorCoreDigest,
      rotationOperationId,
      priorAuthorityTipDigest: leaf.authorityTipDigest!,
      priorAuthorityValueDigest: leaf.authorityValueDigest!,
      priorAuthorityReceiptDigest: leaf.authorityReceiptDigest!,
      priorHelperDigest: digest,
      priorHelperProfileDigest: digest,
      priorHelperAbiDigest: digest,
      priorCustodyReceiptDigest: digest,
      rotationKind: "ROTATION",
      producerKind: "SELECTED_STABLE",
    };
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt,
        authorityValue: rotatedAuthority,
        globalIdentity: identity,
        historyRoot,
        leaf,
        priorHistoryRoot: emptyRoot,
        successorCore,
        updateProof,
      }),
    ).toEqual([]);
    const rotatedDv = computePointerValueDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      authorityDp,
      rotatedAuthority,
    );
    const rotatedPosition = derivePointerPositionEvidence(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      rotatedAuthority,
    );
    const rotatedPositionDigest = computePointerPositionDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      rotatedPosition,
    );
    const rotatedMutationId = computeMutationId({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      pathInstanceDigest: authorityDp,
      transactionId: null,
      sourceToken: "none",
      positionEvidence: rotatedPosition,
      priorDt: leaf.authorityTipDigest as string,
      priorDv: leaf.authorityValueDigest as string,
      priorDr: leaf.authorityReceiptDigest as string,
      successorDv: rotatedDv,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
    });
    const rotatedProposal: ContractRecord = {
      ...fixtureFor("pointer-cas-proposal-receipt/v2"),
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: authorityDp,
      mutationId: rotatedMutationId,
      priorTipDigest: leaf.authorityTipDigest!,
      priorValueDigest: leaf.authorityValueDigest!,
      priorReceiptDigest: leaf.authorityReceiptDigest!,
      successorValueDigest: rotatedDv,
      positionDigest: rotatedPositionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      producerKind: "SELECTED_EPOCH",
      producerDigest: digest,
      authorityEpochTipDigest: leaf.authorityTipDigest!,
      authorityEpochValueDigest: leaf.authorityValueDigest!,
      authorityEpochReceiptDigest: leaf.authorityReceiptDigest!,
    };
    const rotatedDr = computeProposalReceiptDigest({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: authorityDp,
      mutationId: rotatedMutationId,
      priorDt: leaf.authorityTipDigest as string,
      priorDv: leaf.authorityValueDigest as string,
      priorDr: leaf.authorityReceiptDigest as string,
      successorDv: rotatedDv,
      positionDigest: rotatedPositionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      producerKind: "SELECTED_EPOCH",
      producerDigest: digest,
      authorityEpochDt: leaf.authorityTipDigest as string,
      authorityEpochDv: leaf.authorityValueDigest as string,
      authorityEpochDr: leaf.authorityReceiptDigest as string,
      receipt: rotatedProposal,
    });
    const rotatedTip: ContractRecord = {
      ...fixtureFor("pointer-current-tip/v1"),
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest: authorityDp,
      valueDigest: rotatedDv,
      proposalReceiptDigest: rotatedDr,
    };
    const rotatedEnvelope = {
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath: authorityPath,
      installationId: identity.installationId,
      projectId: identity.projectId,
      stateRootDigest: identity.stateRootDigest,
      transactionId: null,
      sourceToken: "none",
      pathBindings: {},
      positionEvidence: rotatedPosition,
      tombstoneEvidence: null,
      value: rotatedAuthority,
      proposal: rotatedProposal,
      tip: rotatedTip,
    };
    expect(
      validateAuthorityMembership({
        currentAuthoritySelection: rotatedEnvelope,
        globalIdentity: identity,
        leaf,
        root: historyRoot,
        rootKind: "NONEMPTY",
        siblingDigests: siblings,
      }),
    ).toEqual([]);
    expect(
      validateAuthorityMembership({
        currentAuthoritySelection: rotatedEnvelope,
        globalIdentity: identity,
        leaf: { ...leaf, epochKey: digest },
        root: historyRoot,
        rootKind: "NONEMPTY",
        siblingDigests: siblings,
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt: { ...appendReceipt, successorCoreDigest: digest },
        authorityValue: rotatedAuthority,
        globalIdentity: identity,
        historyRoot,
        leaf,
        priorHistoryRoot: emptyRoot,
        successorCore,
        updateProof,
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt: null,
        authorityValue: { ...authority, helperDigest: digest2 },
        globalIdentity: identity,
        historyRoot: emptyRoot,
        leaf: null,
        priorHistoryRoot: null,
        successorCore: null,
        updateProof: null,
      }),
    ).toEqual([]);
    expect(() => computeGlobalIdentityDigest({ ...identity, helperDigest: digest })).toThrow(
      /unknown-field/,
    );
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt: null,
        authorityValue: authority,
        globalIdentity: { ...identity, projectId: uuid2 },
        historyRoot: emptyRoot,
        leaf: null,
        priorHistoryRoot: null,
        successorCore: null,
        updateProof: null,
      }),
    ).toContain("globalIdentityDigest:mismatch");
  });

  test("pins nine-stage run graph, rolling audit, and terminal resolution", () => {
    const runId = computeRunId({
      globalIdentityDigest: digest,
      targetMutationId: digest2,
      runOrdinal: "999999999999999999999999999999",
      priorCheckpointDigest: null,
      authorityPathInstanceDigest: digest3,
      authorityTipDigest: digest,
      authorityValueDigest: digest2,
      authorityReceiptDigest: digest3,
    });
    let audit: string | null = null;
    const checkpoints: ContractRecord[] = [];
    for (const [index, stage] of [
      "CURRENT_AUTHORITY_READ",
      "TARGET_RECONCILED",
      "VALUE_READBACK",
      "PROPOSAL_READBACK",
      "CURRENT_AUTHORITY_PRE_CAS_READ",
      "CAS_ARMED",
      "TARGET_POST_CAS_READBACK",
      "PROPOSAL_CLASSIFIED",
      "CURRENT_AUTHORITY_POST_CAS_READ",
    ].entries()) {
      const segment = {
        ...fixtureFor("pointer-mutation-run-segment/v1"),
        globalIdentityDigest: digest,
        targetPathInstanceDigest: digest,
        targetMutationId: digest2,
        runId,
        runOrdinal: "0",
        stage,
      };
      const segmentDigest = computeRunSegmentDigest(segment);
      audit = computeRunAuditDigest(audit, segmentDigest);
      const terminal = index >= 7;
      checkpoints.push({
        ...fixtureFor("pointer-mutation-run-checkpoint-core/v1"),
        globalIdentityDigest: digest,
        targetPathInstanceDigest: digest,
        targetMutationId: digest2,
        runOrdinal: "0",
        checkpointOrdinal: String(index),
        segmentDigest,
        auditDigest: audit,
        stage,
        phase: terminal ? "SELECTED" : index >= 5 ? "CAS_AMBIGUOUS" : "CRASH_PREFIX",
        terminalResolutionDigest: terminal ? digest4 : null,
      });
    }
    expect(validateCommitRunSequence(checkpoints)).toEqual([]);
    expect(validateCommitRunSequence([checkpoints[1]!, checkpoints[0]!])).not.toEqual([]);
    for (const [fieldName, replacement] of Object.entries({
      globalIdentityDigest: digest3,
      pointerKind: "ACTIVATION_RECOVERY_LAUNCH",
      canonicalPointerPath: "installation/changed.json",
      installationId: uuid2,
      projectId: uuid2,
      stateRootDigest: digest3,
      transactionId: uuid2,
      sourceToken: "recovery-fence-v2",
      targetPathInstanceDigest: digest3,
      targetMutationId: digest3,
      runOrdinal: "1",
    })) {
      const mutant = checkpoints.map((checkpoint, index) =>
        index === 1 ? { ...checkpoint, [fieldName]: replacement } : checkpoint,
      );
      expect(validateCommitRunSequence(mutant), fieldName).not.toEqual([]);
    }
    const coreDigest = computeRunCheckpointCoreDigest(checkpoints.at(-1));
    const postDigest = computeRunPostSelectionDigest({
      ...fixtureFor("pointer-mutation-run-selector-post-selection-observation/v1"),
      checkpointCoreDigest: coreDigest,
    });
    const resolutionDigest = computeCommitResolutionDigest({
      ...fixtureFor("pointer-mutation-commit-resolution/v1"),
      targetPathInstanceDigest: digest,
      targetMutationId: digest2,
      outcome: "SELECTED",
    });
    expect(canonicalDigest({ audit, coreDigest, postDigest, resolutionDigest, runId })).toBe(
      "a516e543265d6f25f2bd6e75b69069189691cd05b2c3020638539f8804e43631",
    );
  });

  test("separates historical-read and mutation-commit packets with fixed census", () => {
    const historical = fixtureFor("pointer-evidence-packet/v2");
    expect(validateEvidencePacketV2(historical)).not.toEqual([]);
    expect(() => validateEvidencePacketV2({ ...historical, globalIdentity: null })).not.toThrow();
    expect(validateEvidencePacketV2({ ...historical, purpose: "MUTATION_COMMIT" })).toContain(
      "purpose:current-commit-mismatch",
    );
    const mutation = { ...historical, purpose: "MUTATION_COMMIT", currentCommit: { kind: "x" } };
    expect(validateEvidencePacketV2(mutation)).not.toEqual([]);
    expect(validateEvidencePacketV2({ ...mutation, evidenceSlots: [] })).toContain(
      "evidenceSlots:registry-census-mismatch",
    );
    expect(
      validateEvidencePacketV2({
        ...mutation,
        producerMemberships: Array.from({ length: 13 }, (_, index) => ({ index })),
      }),
    ).not.toEqual([]);
  });
});

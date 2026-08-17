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
  computeSparseRoot,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostDigest,
  computeCommitResolutionDigest,
  computeDestinationDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeGlobalIdentityDigest,
  computePhysicalDestinationDigest,
  computePhysicalObservationDigest,
  computeRunAuditDigest,
  computeRunCheckpointCoreDigest,
  computeRunId,
  computeRunPostSelectionDigest,
  computeRunSegmentDigest,
  diagnostic,
  externalAuthorityPaths,
  framedBytes,
  incrementDecimalAscii,
  parseContract,
  pointerKinds,
  pointerRegistry,
  schemaVersions,
  validateBootstrapAnchorTransition,
  validateAuthorityMembership,
  validateAuthoritySparseUpdate,
  validateAuthorityValueHistoryBinding,
  validateBootstrapGenesisGraph,
  validateCommitRunSequence,
  validateDestinationOwnerTransition,
  validateEvidencePacketV2,
  type ContractRecord,
  type JsonValue,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, uuid, uuid2 } from "./fixtures.js";

const digest3 = "c".repeat(64);
const digest4 = "d".repeat(64);

describe("approved v2 authority contracts", () => {
  test("pins the twelve-kind registry and diagnostic-only superseded authority", () => {
    expect(pointerKinds).toHaveLength(12);
    expect(pointerKinds.at(-1)).toBe("POINTER_MUTATION_RUN_CURRENT");
    expect(
      pointerRegistry.find((row) => row.kind === "STATE_MUTATION_AUTHORITY_ROTATION")?.valueSchemas,
    ).toEqual(["state-mutation-authority-value/v2"]);
    expect(schemaVersions).toContain("pointer-cas-proposal-receipt/v2");
    expect(schemaVersions).not.toContain("pointer-cas-proposal-receipt/v1");
    expect(schemaVersions).toContain("state-mutation-authority-value/v2");
    expect(schemaVersions).not.toContain("state-mutation-authority-value/v1");
    expect(diagnostic.schemaVersions).toContain("pointer-cas-proposal-receipt/v1");
    expect(diagnostic.schemaVersions).toContain("state-mutation-authority-value/v1");
    expect(
      canonicalDigest(
        schemaVersions.map((schemaVersion) => ({
          digest: canonicalDigest(fixtureFor(schemaVersion)),
          schemaVersion,
        })),
      ),
    ).toBe("035aae15fb04483eff82b792a1f3d7d9a540975df153b4a4ea8b01846ebe01e7");
  });

  test("closes bootstrap versus selected-epoch proposal producers", () => {
    const proposal = fixtureFor("pointer-cas-proposal-receipt/v2");
    const bootstrap = {
      ...proposal,
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
    expect(canonicalDigest({ ddest, dobsA, dobsB, dphys })).toBe(
      "98318d7bf43ef23b82308fb8723555a2f60a09fcea07bc133f0146b484655380",
    );
  });

  test("closes destination owner lifecycle and exact acyclic digests", () => {
    const genesis: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-destination-owner-value/v1"),
      ownerOrdinal: "0",
      lifecycle: "ACTIVE",
      successorReviewCoreDigest: null,
    };
    const consumed = { ...genesis, ownerOrdinal: "1", lifecycle: "CONSUMED" };
    const retired = { ...consumed, ownerOrdinal: "2", lifecycle: "RETIRED" };
    const successor = {
      ...retired,
      ownerOrdinal: "3",
      lifecycle: "ACTIVE",
      installationId: uuid2,
      successorReviewCoreDigest: digest2,
    };
    expect(validateDestinationOwnerTransition(null, genesis)).toEqual([]);
    expect(validateDestinationOwnerTransition(genesis, consumed)).toEqual([]);
    expect(validateDestinationOwnerTransition(consumed, retired)).toEqual([]);
    expect(validateDestinationOwnerTransition(retired, successor)).toEqual([]);
    expect(validateDestinationOwnerTransition(genesis, successor)).toContain(
      "lifecycle:transition-refused",
    );
    expect(
      validateDestinationOwnerTransition(retired, {
        ...successor,
        successorReviewCoreDigest: null,
      }),
    ).toContain("successorReviewCoreDigest:missing");
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
      "e3e82bc0b21a555132d7902639302812fe033227c7950fa0f3848f6238c5d7e3",
    );
  });

  test("keeps the external anchor to E0 graph acyclic and cross-bound", () => {
    const anchor = fixtureFor("state-mutation-bootstrap-anchor/v1");
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
    const core: Record<string, JsonValue> = {
      ...fixtureFor("state-mutation-bootstrap-genesis-core/v1"),
      bootstrapAnchorDigest: dba,
    };
    const dbg = computeBootstrapGenesisCoreDigest(core);
    const post = {
      ...fixtureFor("state-mutation-bootstrap-genesis-post-selection-receipt/v1"),
      bootstrapAnchorDigest: dba,
      genesisCoreDigest: dbg,
      authorityPathInstanceDigest: core.authorityPathInstanceDigest,
      valueDigest: core.authorityValueDigest,
    };
    const dgp = computeBootstrapGenesisPostDigest(post);
    expect(validateBootstrapGenesisGraph({ anchor, core, post })).toEqual([]);
    expect(
      validateBootstrapGenesisGraph({
        anchor,
        core,
        post: { ...post, genesisCoreDigest: digest2 },
      }),
    ).toContain("post:core-anchor-mismatch");
    expect(validateBootstrapAnchorTransition(active, { ...active, lifecycle: "CONSUMED" })).toEqual(
      [],
    );
    expect(validateBootstrapAnchorTransition(active, active)).toContain(
      "lifecycle:transition-refused",
    );
    expect(canonicalDigest({ dba, dbar, dbat, dbav, dbg, dgp })).toBe(
      "7222d8c82da2792e78f5d17cd623961acfa3256dd05ed53f249c7370abc94a22",
    );
  });

  test("pins sparse primitives to raw global identity and exact 256 depth", () => {
    const leaf: Record<string, JsonValue> = {
      ...fixtureFor("authority-history-leaf/v1"),
      globalIdentityDigest: digest,
      authorityPathInstanceDigest: digest2,
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
    const siblings = Array.from({ length: 256 }, (_, index) =>
      computeAuthorityEmptyDigest(256 - index),
    );
    const emptyRoot = {
      ...fixtureFor("authority-history-empty-root/v1"),
      globalIdentityDigest: digest,
      treeRootDigest: computeAuthorityEmptyDigest(0),
    };
    const dhe = computeAuthorityEmptyRootDigest(emptyRoot);
    const root = {
      ...fixtureFor("authority-history-root/v1"),
      globalIdentityDigest: digest,
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
      globalIdentityDigest: digest,
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
      validateAuthoritySparseUpdate({ leaf, priorRoot: emptyRoot, proof, successorRoot: root }),
    ).toEqual([]);
    expect(
      validateAuthorityMembership({
        leaf,
        root: emptyRoot,
        rootKind: "EMPTY",
        siblingDigests: siblings,
      }),
    ).toEqual(["membership:empty-root-refused"]);
    expect(
      validateAuthorityMembership({ leaf, root, rootKind: "NONEMPTY", siblingDigests: siblings }),
    ).toEqual([]);
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
      validateAuthoritySparseUpdate({
        leaf: leaf2,
        priorRoot: root,
        proof: proof2,
        successorRoot: root2,
      }),
    ).toEqual([]);
    expect(
      validateAuthoritySparseUpdate({
        leaf: leaf2,
        priorRoot: root,
        proof: { ...proof2, priorRootKind: "EMPTY" },
        successorRoot: root2,
      }),
    ).not.toEqual([]);
    expect(canonicalDigest({ de, dh, dhe, epochKey: leaf.epochKey })).toBe(
      "fe7ac23e3bfc4e2982fb9054a024889623921f12a987873e0193ddc2223ca859",
    );
    expect(
      parseContract("authority-history-update-proof/v1", {
        ...fixtureFor("authority-history-update-proof/v1"),
        siblingDigests: [digest],
      }).ok,
    ).toBe(false);
  });

  test("keeps G stable across rotating helper facts and binds E0 to Dhe", () => {
    const identity = fixtureFor("state-mutation-global-identity/v1");
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
      }),
    ).toEqual([]);
    expect(
      validateAuthorityValueHistoryBinding({
        appendReceipt: null,
        authorityValue: { ...authority, helperDigest: digest2 },
        globalIdentity: identity,
        historyRoot: emptyRoot,
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
      "bc44798e884d951d2739a299a2288a257894f94e72bf487e83c162272867982b",
    );
  });

  test("separates historical-read and mutation-commit packets with fixed census", () => {
    const historical = fixtureFor("pointer-evidence-packet/v2");
    expect(validateEvidencePacketV2(historical)).toEqual([]);
    expect(validateEvidencePacketV2({ ...historical, purpose: "MUTATION_COMMIT" })).toContain(
      "purpose:current-commit-mismatch",
    );
    const mutation = { ...historical, purpose: "MUTATION_COMMIT", currentCommitDigest: digest };
    expect(validateEvidencePacketV2(mutation)).toEqual([]);
    expect(validateEvidencePacketV2({ ...mutation, evidenceSlotDigests: [digest] })).toContain(
      "evidenceSlotDigests:registry-census-mismatch",
    );
    expect(
      validateEvidencePacketV2({
        ...mutation,
        producerMembershipDigests: Array.from({ length: 13 }, (_, index) =>
          index.toString(16).padStart(64, "0"),
        ),
      }),
    ).toContain("producerMembershipDigests:unbounded");
  });
});

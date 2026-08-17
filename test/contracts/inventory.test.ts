import { describe, expect, test } from "vitest";
import {
  authorityInventoryPaths,
  canonicalDigest,
  computeAuthorityHistoryEmptyRootDigestV2,
  computeAuthorityEmptyDigest,
  computeAuthorityLeafDigest,
  computeAuthorityCensusChainDigest,
  computeAuthorityCensusEntryDigest,
  computeAuthorityCensusPageDigest,
  computeAuthorityCensusTerminalDigest,
  computeAuthorityCoordinatorPositionDigest,
  computeAuthorityFilesystemObservationDigest,
  computeAuthorityInventoryBatchDigest,
  computeAuthorityInventoryEmptyDigest,
  computeAuthorityInventoryLeafDigest,
  computeAuthorityInventoryRootDigest,
  computeAuthorityInventorySparseRoot,
  computeAuthorityInventorySparseAbsentRoot,
  computeAuthorityInventoryUpdateEntryDigest,
  computeAuthorityMaterializationPlanDigest,
  computeAuthorityMaterializationPlanEntryDigest,
  computeAuthorityMaterializationReceiptDigest,
  computeAuthorityNodeDigest,
  computeAuthorityNodeRecordDigest,
  diagnostic,
  derivePointerPositionEvidence,
  deriveAuthorityUpdateNodeCensus,
  pointerKinds,
  computePointerPositionDigest,
  parseContract,
  pointerPath,
  pointerRegistry,
  schemaVersions,
  validateAuthorityCoordinatorTransition,
  validateAuthorityInventoryCensus,
  validateAuthorityMaterializationComposition,
  validateAuthorityValueV3Composition,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, later, uuid } from "./fixtures.js";

const d = (character: string): string => character.repeat(64);
const siblings = Object.freeze(
  Array.from({ length: 256 }, (_, index) => computeAuthorityInventoryEmptyDigest(256 - index)),
);
const v = (record: ContractRecord, name: string) => record[name]!;

describe("approved authority node inventory contracts", () => {
  test("pins current versions, the singleton thirteenth row, and closed paths", () => {
    expect(pointerKinds).toHaveLength(13);
    expect(pointerKinds.at(-1)).toBe("AUTHORITY_NODE_MATERIALIZATION_RUN");
    expect(pointerRegistry.at(-1)).toMatchObject({
      kind: "AUTHORITY_NODE_MATERIALIZATION_RUN",
      singletonScope: "AUTHORITY_DP",
      genesis: "ABSENT_TO_IDLE",
      transactionPolicy: "NULL",
      sourceTokens: ["none"],
      retention: "FULL_REQUIRED",
      valueSchemas: ["authority-node-materialization-run-value/v1"],
      rootTemplates: [],
      archiveTemplates: [],
      tombstonePositionDomain: null,
    });
    expect(
      pointerPath("AUTHORITY_NODE_MATERIALIZATION_RUN", {
        authorityPathInstanceDigest: digest,
      }),
    ).toBe(authorityInventoryPaths.coordinator(digest));
    expect(() =>
      pointerPath("AUTHORITY_NODE_MATERIALIZATION_RUN", {
        authorityPathInstanceDigest: "../escape",
      }),
    ).toThrow();
    const coordinatorValue = fixtureFor("authority-node-materialization-run-value/v1");
    const genericPosition = derivePointerPositionEvidence(
      "AUTHORITY_NODE_MATERIALIZATION_RUN",
      coordinatorValue,
      { authorityPathInstanceDigest: coordinatorValue.authorityPathInstanceDigest as string },
    );
    const dedicatedPosition = {
      schemaVersion: "authority-node-materialization-run-position/v1",
      authorityPathInstanceDigest: genericPosition.authorityPathInstanceDigest!,
      coordinatorOrdinal: genericPosition.coordinatorOrdinal!,
      lifecycle: genericPosition.lifecycle!,
      rotationId: genericPosition.rotationId!,
      materializationPlanDigest: genericPosition.materializationPlanDigest!,
      phaseEvidenceDigest: genericPosition.phaseEvidenceDigest!,
    };
    expect(
      computePointerPositionDigest("AUTHORITY_NODE_MATERIALIZATION_RUN", genericPosition),
    ).toBe(computeAuthorityCoordinatorPositionDigest(dedicatedPosition));
    for (const current of [
      "state-mutation-authority-value/v3",
      "authority-history-empty-root/v2",
      "authority-history-root/v2",
      "authority-history-append-receipt/v2",
      "pointer-mutation-run-intent/v2",
      "pointer-mutation-run-checkpoint-core/v2",
      "pointer-mutation-run-current-value/v2",
      "pointer-mutation-commit-evidence/v3",
      "pointer-evidence-packet/v3",
    ])
      expect(schemaVersions).toContain(current);
    for (const old of [
      "state-mutation-authority-value/v2",
      "authority-history-empty-root/v1",
      "authority-history-root/v1",
      "pointer-mutation-run-intent/v1",
      "pointer-mutation-run-current-value/v1",
      "pointer-mutation-commit-evidence/v1",
      "pointer-evidence-packet/v2",
    ]) {
      expect(schemaVersions).not.toContain(old);
      expect(diagnostic.schemaVersions).toContain(old);
    }
  });

  test("allows repeated sparse siblings but enforces explicitly unique digest censuses", () => {
    expect(
      parseContract("authority-history-update-proof/v1", {
        ...fixtureFor("authority-history-update-proof/v1"),
        siblingDigests: Array(256).fill(digest),
      }).ok,
    ).toBe(true);
    expect(
      schemaVersions.includes("authority-node-materialization-plan/v1") &&
        fixtureFor("authority-node-materialization-plan/v1"),
    ).toBeTruthy();
    const duplicatedPlan = {
      ...fixtureFor("authority-node-materialization-plan/v1"),
      planEntryDigests: [digest, digest],
    };
    expect(
      // The current parser is reached through the public inventory composition helper.
      () => computeAuthorityMaterializationPlanDigest(duplicatedPlan),
    ).toThrow(/duplicate-array-entry/);
  });

  test("derives the exact canonical first and later authority update node censuses", () => {
    const leaf = fixtureFor("authority-history-leaf/v1");
    const emptySiblings = Array.from({ length: 256 }, (_, index) =>
      computeAuthorityEmptyDigest(256 - index),
    );
    const proof = {
      ...fixtureFor("authority-history-update-proof/v1"),
      epochKey: leaf.epochKey,
      leafDigest: computeAuthorityLeafDigest(leaf),
      siblingDigests: emptySiblings,
    };
    const first = deriveAuthorityUpdateNodeCensus({ leaf, updateProof: proof });
    expect(first).toHaveLength(256);
    expect(first.map((row) => row.nodeDigest)).toEqual(
      [...first.map((row) => row.nodeDigest)].sort(),
    );
    const laterSiblings = [...emptySiblings];
    laterSiblings[0] = digest2;
    const later = deriveAuthorityUpdateNodeCensus({
      leaf,
      updateProof: { ...proof, priorRootKind: "NONEMPTY", siblingDigests: laterSiblings },
    });
    expect(later).toHaveLength(256);
    expect(new Set(later.map((row) => row.nodeDigest)).size).toBe(later.length);
    expect(() =>
      deriveAuthorityUpdateNodeCensus({
        leaf: { ...leaf, authorityTipDigest: digest2 },
        updateProof: proof,
      }),
    ).toThrow(/leaf-mismatch/);
    expect(() =>
      deriveAuthorityUpdateNodeCensus({
        leaf,
        updateProof: { ...proof, siblingDigests: emptySiblings.slice(1) },
      }),
    ).toThrow();
  });

  test("composes one exact planned node through filesystem, membership, receipt, and batch", () => {
    const planEntry: ContractRecord = {
      ...fixtureFor("authority-node-materialization-plan-entry/v1"),
      nodeDigest: d("1"),
      nodePath: `installation/state-mutation-authority-history/nodes/${d("1")}.json`,
      nodeRecordDigest: d("2"),
      inventoryLeafDigest: d("3"),
      membershipAction: "INSERT_ABSENT",
      priorTreeRootDigest: computeAuthorityInventorySparseAbsentRoot(d("1"), siblings),
      priorCount: "0",
      siblingDigests: siblings,
      successorTreeRootDigest: computeAuthorityInventorySparseRoot(d("1"), d("3"), siblings),
      successorCount: "1",
    };
    const planEntryDigest = computeAuthorityMaterializationPlanEntryDigest(planEntry);
    const priorInventoryRootDigest = computeAuthorityInventoryRootDigest({
      schemaVersion: "authority-node-inventory-empty-root/v1",
      globalIdentityDigest: d("6"),
      kind: "EMPTY",
      count: "0",
      treeRootDigest: v(planEntry, "priorTreeRootDigest"),
    });
    const successorInventoryRootDigest = computeAuthorityInventoryRootDigest({
      schemaVersion: "authority-node-inventory-root/v1",
      globalIdentityDigest: d("6"),
      kind: "NONEMPTY",
      count: "1",
      treeRootDigest: v(planEntry, "successorTreeRootDigest"),
    });
    const plan: ContractRecord = {
      ...fixtureFor("authority-node-materialization-plan/v1"),
      globalIdentityDigest: d("6"),
      rotationId: d("7"),
      oldAuthorityPathInstanceDigest: d("8"),
      oldAuthorityTipDigest: d("9"),
      oldAuthorityValueDigest: d("a"),
      oldAuthorityReceiptDigest: d("b"),
      priorHistoryKind: "EMPTY",
      priorHistoryRootDigest: d("c"),
      priorHistoryCount: "0",
      priorHistoryTreeRootDigest: d("d"),
      predecessorLeafDigest: d("e"),
      authorityUpdateProofDigest: d("f"),
      priorInventoryKind: "EMPTY",
      priorInventoryRootDigest,
      priorInventoryCount: "0",
      priorInventoryTreeRootDigest: v(planEntry, "priorTreeRootDigest"),
      planEntryDigests: [planEntryDigest],
      successorInventoryKind: "NONEMPTY",
      successorInventoryRootDigest,
      successorInventoryCount: "1",
      successorInventoryTreeRootDigest: v(planEntry, "successorTreeRootDigest"),
      successorHistoryCount: "1",
      successorHistoryTreeRootDigest: d("3"),
      successorOrdinal: "1",
      recoveryPolicy: "FINISH_ONLY",
    };
    const planDigest = computeAuthorityMaterializationPlanDigest(plan);
    const common = {
      globalIdentityDigest: v(plan, "globalIdentityDigest"),
      rotationId: v(plan, "rotationId"),
      materializationPlanDigest: planDigest,
      startedTipDigest: d("4"),
      startedValueDigest: d("5"),
      startedReceiptDigest: d("6"),
      nodeDigest: v(planEntry, "nodeDigest"),
      inventoryLeafDigest: v(planEntry, "inventoryLeafDigest"),
    };
    const observation: ContractRecord = {
      ...fixtureFor("authority-node-filesystem-observation/v1"),
      ...common,
      nodePath: v(planEntry, "nodePath"),
      nodeRecordDigest: v(planEntry, "nodeRecordDigest"),
      filesystemDisposition: "CREATED",
      existed: false,
      observedBytesDigest: null,
      readbackDigest: v(planEntry, "nodeRecordDigest"),
      oldAuthorityTipDigest: v(plan, "oldAuthorityTipDigest"),
      oldAuthorityValueDigest: v(plan, "oldAuthorityValueDigest"),
      oldAuthorityReceiptDigest: v(plan, "oldAuthorityReceiptDigest"),
    };
    const observationDigest = computeAuthorityFilesystemObservationDigest(observation);
    const update: ContractRecord = {
      ...fixtureFor("authority-node-inventory-update-entry/v1"),
      ...common,
      membershipAction: "INSERT_ABSENT",
      filesystemObservationDigest: observationDigest,
      priorTreeRootDigest: v(planEntry, "priorTreeRootDigest"),
      priorCount: "0",
      siblingDigests: siblings,
      successorTreeRootDigest: v(planEntry, "successorTreeRootDigest"),
      successorCount: "1",
    };
    const updateDigest = computeAuthorityInventoryUpdateEntryDigest(update);
    const receipt: ContractRecord = {
      ...fixtureFor("authority-node-materialization-receipt/v1"),
      ...common,
      nodePath: v(planEntry, "nodePath"),
      nodeRecordDigest: v(planEntry, "nodeRecordDigest"),
      filesystemObservationDigest: observationDigest,
      updateEntryDigest: updateDigest,
      createdAt: instant,
      readbackAt: later,
      recordPath: authorityInventoryPaths.materialization(
        plan.rotationId as string,
        planEntry.nodeDigest as string,
      ),
    };
    const receiptDigest = computeAuthorityMaterializationReceiptDigest(receipt);
    const batch: ContractRecord = {
      ...fixtureFor("authority-node-inventory-batch-update/v1"),
      globalIdentityDigest: v(plan, "globalIdentityDigest"),
      rotationId: v(plan, "rotationId"),
      materializationPlanDigest: planDigest,
      startedTipDigest: common.startedTipDigest,
      startedValueDigest: common.startedValueDigest,
      startedReceiptDigest: common.startedReceiptDigest,
      authorityUpdateProofDigest: v(plan, "authorityUpdateProofDigest"),
      priorInventoryKind: v(plan, "priorInventoryKind"),
      priorInventoryRootDigest: v(plan, "priorInventoryRootDigest"),
      priorInventoryCount: v(plan, "priorInventoryCount"),
      priorInventoryTreeRootDigest: v(plan, "priorInventoryTreeRootDigest"),
      materializationReceiptDigests: [receiptDigest],
      updateEntryDigests: [updateDigest],
      successorInventoryKind: "NONEMPTY",
      successorInventoryRootDigest: v(plan, "successorInventoryRootDigest"),
      successorInventoryCount: "1",
      successorInventoryTreeRootDigest: v(plan, "successorInventoryTreeRootDigest"),
      recordPath: authorityInventoryPaths.update(plan.rotationId as string),
    };
    const composition = {
      plan,
      planEntries: [planEntry],
      observations: [observation],
      updateEntries: [update],
      receipts: [receipt],
      batch,
    };
    expect(validateAuthorityMaterializationComposition(composition)).toEqual([]);
    expect(computeAuthorityInventoryBatchDigest(batch)).toMatch(/^[0-9a-f]{64}$/);
    expect(
      canonicalDigest({
        batch: computeAuthorityInventoryBatchDigest(batch),
        observation: observationDigest,
        plan: planDigest,
        planEntry: planEntryDigest,
        receipt: receiptDigest,
        update: updateDigest,
      }),
    ).toBe("7de42a228bc0e4e205e4c4befd87f596dd650a0c4a58686ce330218d53f334a0");
    expect(
      validateAuthorityMaterializationComposition({
        ...composition,
        receipts: [{ ...receipt, updateEntryDigest: d("9") }],
      }),
    ).toContain("0:observation-update-receipt-mismatch");
    expect(
      validateAuthorityMaterializationComposition({
        ...composition,
        observations: [
          {
            ...observation,
            filesystemDisposition: "BYTES_CONFLICT",
            existed: true,
            observedBytesDigest: d("9"),
            readbackDigest: d("9"),
          },
        ],
      }),
    ).toContain("0:blocking-filesystem-disposition");
    expect(
      validateAuthorityMaterializationComposition({
        ...composition,
        batch: { ...batch, updateEntryDigests: [] },
      }),
    ).toContain("batch:census-mismatch");
  });

  test("uses exact coordinator edges, immutable identity, and unbounded decimal ordinals", () => {
    const idle: ContractRecord = {
      ...fixtureFor("authority-node-materialization-run-value/v1"),
      coordinatorOrdinal: "0",
      lifecycle: "IDLE",
    };
    const preauthorized: ContractRecord = {
      ...idle,
      coordinatorOrdinal: "1",
      lifecycle: "PREAUTHORIZED",
      rotationId: digest,
      materializationPlanDigest: digest2,
      predecessorTipDigest: d("1"),
      predecessorValueDigest: d("2"),
      predecessorReceiptDigest: d("3"),
      phaseEvidenceDigest: digest2,
    };
    const started = {
      ...preauthorized,
      coordinatorOrdinal: "99999999999999999999999999999999999999999999999999",
      lifecycle: "STARTED",
    };
    expect(validateAuthorityCoordinatorTransition(null, idle)).toEqual([]);
    expect(validateAuthorityCoordinatorTransition(idle, preauthorized)).toEqual([]);
    expect(
      validateAuthorityCoordinatorTransition(preauthorized, {
        ...preauthorized,
        coordinatorOrdinal: "2",
        lifecycle: "STARTED",
      }),
    ).toEqual([]);
    expect(validateAuthorityCoordinatorTransition(preauthorized, started)).toContain(
      "coordinatorOrdinal:not-adjacent",
    );
    expect(
      validateAuthorityCoordinatorTransition(idle, { ...preauthorized, lifecycle: "TERMINAL" }),
    ).not.toEqual([]);
  });

  test("proves a real deterministic zero-count page and rejects null/truncated branches", () => {
    const emptyInventoryTreeRoot = computeAuthorityInventoryEmptyDigest(0);
    const emptyInventoryRoot = computeAuthorityInventoryRootDigest({
      schemaVersion: "authority-node-inventory-empty-root/v1",
      globalIdentityDigest: digest,
      kind: "EMPTY",
      count: "0",
      treeRootDigest: emptyInventoryTreeRoot,
    });
    const core: ContractRecord = {
      ...fixtureFor("authority-node-inventory-census-page-core/v1"),
      censusId: uuid,
      authorityTipDigest: digest,
      inventoryKind: "EMPTY",
      inventoryCount: "0",
      inventoryRootDigest: emptyInventoryRoot,
      inventoryTreeRootDigest: emptyInventoryTreeRoot,
      pageOrdinal: "0",
      priorPageDigest: null,
      priorCursor: null,
      priorCensusDigest: null,
      priorCumulativeCount: "0",
      entries: [],
      entryDigests: [],
      successorCursor: null,
      successorCumulativeCount: "0",
      exhausted: true,
    };
    const pageDigest = computeAuthorityCensusPageDigest(core);
    const censusDigest = computeAuthorityCensusChainDigest(pageDigest, "0", null, null);
    const page: ContractRecord = {
      schemaVersion: "authority-node-inventory-census-page/v1",
      core,
      pageDigest,
      censusDigest,
      recordPath: authorityInventoryPaths.censusPage(digest, uuid, "0", pageDigest),
    };
    const terminalCore: ContractRecord = {
      ...fixtureFor("authority-node-inventory-census-terminal-core/v1"),
      globalIdentityDigest: v(core, "globalIdentityDigest"),
      censusId: uuid,
      authorityPathInstanceDigest: v(core, "authorityPathInstanceDigest"),
      authorityTipDigest: digest,
      authorityValueDigest: v(core, "authorityValueDigest"),
      authorityReceiptDigest: v(core, "authorityReceiptDigest"),
      historyRootDigest: v(core, "historyRootDigest"),
      inventoryKind: "EMPTY",
      inventoryRootDigest: v(core, "inventoryRootDigest"),
      inventoryCount: "0",
      inventoryTreeRootDigest: v(core, "inventoryTreeRootDigest"),
      firstPageDigest: pageDigest,
      lastPageDigest: pageDigest,
      lastCensusDigest: censusDigest,
      pageCount: "1",
      cumulativeCount: "0",
    };
    const terminalDigest = computeAuthorityCensusTerminalDigest(terminalCore);
    const terminal: ContractRecord = {
      schemaVersion: "authority-node-inventory-census-terminal/v1",
      core: terminalCore,
      terminalDigest,
      recordPath: authorityInventoryPaths.censusTerminal(digest, uuid, terminalDigest),
    };
    expect(validateAuthorityInventoryCensus({ pages: [page], terminal })).toEqual([]);
    expect(canonicalDigest({ censusDigest, pageDigest, terminalDigest })).toBe(
      "632297556f374c78cb0686dbf95751b79b738a1c9a1de6032c00ac8d81d39a8e",
    );
    expect(validateAuthorityInventoryCensus({ pages: [], terminal })).toContain("pages:required");
    expect(
      validateAuthorityInventoryCensus({
        pages: [{ ...page, censusDigest: digest2 }],
        terminal,
      }),
    ).toContain("0:page-chain-digest-mismatch");
    expect(
      validateAuthorityInventoryCensus({
        pages: [page],
        terminal: { ...terminal, core: { ...terminalCore, firstPageDigest: digest2 } },
      }),
    ).toContain("terminal:chain-mismatch");
  });

  test("recomputes nonempty census membership, ordinals, counts, paths, and selected tuple", () => {
    const nodeDigest = computeAuthorityNodeDigest(0, digest, digest2);
    const node: ContractRecord = {
      ...fixtureFor("authority-history-node/v1"),
      depth: "0",
      leftChildDigest: digest,
      rightChildDigest: digest2,
      nodeDigest,
      recordPath: `installation/state-mutation-authority-history/nodes/${nodeDigest}.json`,
    };
    const nodeRecordDigest = computeAuthorityNodeRecordDigest({
      schemaVersion: "authority-history-node-record/v1",
      nodeDigest,
      node,
      recordPath: node.recordPath!,
    });
    const inventoryLeafDigest = computeAuthorityInventoryLeafDigest({
      schemaVersion: "authority-node-inventory-leaf/v1",
      nodeDigest,
      nodePath: node.recordPath!,
      nodeRecordDigest,
      recordPath: authorityInventoryPaths.leaf(nodeDigest),
    });
    const entry: ContractRecord = {
      schemaVersion: "authority-node-inventory-census-entry/v1",
      globalEntryOrdinal: "0",
      nodePath: node.recordPath!,
      node,
      nodeDigest,
      nodeRecordDigest,
      inventoryLeafDigest,
      siblingDigests: siblings,
    };
    const entryDigest = computeAuthorityCensusEntryDigest(entry);
    const inventoryTreeRootDigest = computeAuthorityInventorySparseRoot(
      nodeDigest,
      inventoryLeafDigest,
      siblings,
    );
    const inventoryRootDigest = computeAuthorityInventoryRootDigest({
      schemaVersion: "authority-node-inventory-root/v1",
      globalIdentityDigest: digest,
      kind: "NONEMPTY",
      count: "1",
      treeRootDigest: inventoryTreeRootDigest,
    });
    const core: ContractRecord = {
      ...fixtureFor("authority-node-inventory-census-page-core/v1"),
      censusId: uuid,
      authorityTipDigest: digest,
      inventoryKind: "NONEMPTY",
      inventoryCount: "1",
      inventoryRootDigest,
      inventoryTreeRootDigest,
      pageOrdinal: "0",
      priorPageDigest: null,
      priorCursor: null,
      priorCensusDigest: null,
      priorCumulativeCount: "0",
      entries: [entry],
      entryDigests: [entryDigest],
      successorCursor: null,
      successorCumulativeCount: "1",
      exhausted: true,
    };
    const pageDigest = computeAuthorityCensusPageDigest(core);
    const censusDigest = computeAuthorityCensusChainDigest(pageDigest, "1", null, null);
    const page: ContractRecord = {
      schemaVersion: "authority-node-inventory-census-page/v1",
      core,
      pageDigest,
      censusDigest,
      recordPath: authorityInventoryPaths.censusPage(digest, uuid, "0", pageDigest),
    };
    const terminalCore: ContractRecord = {
      ...fixtureFor("authority-node-inventory-census-terminal-core/v1"),
      globalIdentityDigest: core.globalIdentityDigest!,
      censusId: uuid,
      authorityPathInstanceDigest: core.authorityPathInstanceDigest!,
      authorityTipDigest: digest,
      authorityValueDigest: core.authorityValueDigest!,
      authorityReceiptDigest: core.authorityReceiptDigest!,
      historyRootDigest: core.historyRootDigest!,
      inventoryKind: "NONEMPTY",
      inventoryRootDigest: core.inventoryRootDigest!,
      inventoryCount: "1",
      inventoryTreeRootDigest,
      firstPageDigest: pageDigest,
      lastPageDigest: pageDigest,
      lastCensusDigest: censusDigest,
      pageCount: "1",
      cumulativeCount: "1",
    };
    const terminalDigest = computeAuthorityCensusTerminalDigest(terminalCore);
    const terminal = {
      schemaVersion: "authority-node-inventory-census-terminal/v1",
      core: terminalCore,
      terminalDigest,
      recordPath: authorityInventoryPaths.censusTerminal(digest, uuid, terminalDigest),
    };
    expect(validateAuthorityInventoryCensus({ pages: [page], terminal })).toEqual([]);
    expect(
      validateAuthorityInventoryCensus({
        pages: [{ ...page, core: { ...core, inventoryTreeRootDigest: digest2 } }],
        terminal,
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorityInventoryCensus({
        pages: [{ ...page, core: { ...core, entries: [{ ...entry, globalEntryOrdinal: "1" }] } }],
        terminal,
      }),
    ).not.toEqual([]);
  });

  test("census entries recompute node, node-record, and inventory-leaf identities", () => {
    const nodeDigest = computeAuthorityNodeDigest(0, digest, digest2);
    const node: ContractRecord = {
      ...fixtureFor("authority-history-node/v1"),
      depth: "0",
      leftChildDigest: digest,
      rightChildDigest: digest2,
      nodeDigest,
      recordPath: `installation/state-mutation-authority-history/nodes/${nodeDigest}.json`,
    };
    const nodeRecord: ContractRecord = {
      schemaVersion: "authority-history-node-record/v1",
      nodeDigest,
      node,
      recordPath: node.recordPath!,
    };
    const nodeRecordDigest = computeAuthorityNodeRecordDigest(nodeRecord);
    const leaf: ContractRecord = {
      schemaVersion: "authority-node-inventory-leaf/v1",
      nodeDigest,
      nodePath: node.recordPath!,
      nodeRecordDigest,
      recordPath: authorityInventoryPaths.leaf(nodeDigest),
    };
    const inventoryLeafDigest = computeAuthorityInventoryLeafDigest(leaf);
    const entry: ContractRecord = {
      schemaVersion: "authority-node-inventory-census-entry/v1",
      globalEntryOrdinal: "0",
      nodePath: node.recordPath!,
      node,
      nodeDigest,
      nodeRecordDigest,
      inventoryLeafDigest,
      siblingDigests: siblings,
    };
    expect(computeAuthorityCensusEntryDigest(entry)).toMatch(/^[0-9a-f]{64}$/);
    const root = {
      ...fixtureFor("authority-node-inventory-empty-root/v1"),
      kind: "EMPTY",
      count: "0",
    };
    expect(computeAuthorityInventoryRootDigest(root)).toMatch(/^[0-9a-f]{64}$/);
    expect(
      canonicalDigest({
        entry: computeAuthorityCensusEntryDigest(entry),
        inventoryLeafDigest,
        nodeDigest,
        nodeRecordDigest,
        root: computeAuthorityInventoryRootDigest(root),
      }),
    ).toBe("78eeca98ac6e8e60999386277ce83fec94cd479a115497e1f2c902dafb04801e");
  });

  test("binds E0 authority v3 to selected empty history and inventory roots", () => {
    const inventoryRoot: ContractRecord = {
      ...fixtureFor("authority-node-inventory-empty-root/v1"),
      globalIdentityDigest: digest,
      kind: "EMPTY",
      count: "0",
      treeRootDigest: computeAuthorityInventoryEmptyDigest(0),
    };
    const inventoryRootDigest = computeAuthorityInventoryRootDigest(inventoryRoot);
    const historyRoot: ContractRecord = {
      ...fixtureFor("authority-history-empty-root/v2"),
      globalIdentityDigest: digest,
      count: "0",
      treeRootDigest: d("3"),
      nodeInventoryRootKind: "EMPTY",
      nodeInventoryRootDigest: inventoryRootDigest,
      nodeInventoryCount: "0",
    };
    const historyRootDigest = computeAuthorityHistoryEmptyRootDigestV2(historyRoot);
    const authorityValue: ContractRecord = {
      ...fixtureFor("state-mutation-authority-value/v3"),
      globalIdentityDigest: digest,
      historyRootKind: "EMPTY",
      historyRootDigest,
      historyCount: "0",
      nodeInventoryRootKind: "EMPTY",
      nodeInventoryRootDigest: inventoryRootDigest,
      nodeInventoryCount: "0",
      nodeInventoryTreeRootDigest: computeAuthorityInventoryEmptyDigest(0),
    };
    expect(
      validateAuthorityValueV3Composition({
        appendReceipt: null,
        authorityValue,
        historyRoot,
        inventoryRoot,
        successorCore: null,
      }),
    ).toEqual([]);
    expect(canonicalDigest({ historyRootDigest, inventoryRootDigest, authorityValue })).toBe(
      "2d75eb57c82fc1d424a0de340207f7fb191b2729c41db042aa0ab7de2dd33d00",
    );
    expect(
      validateAuthorityValueV3Composition({
        appendReceipt: null,
        authorityValue: { ...authorityValue, nodeInventoryRootDigest: d("4") },
        historyRoot,
        inventoryRoot,
        successorCore: null,
      }),
    ).toContain("nodeInventoryRoot:binding-mismatch");
  });
});

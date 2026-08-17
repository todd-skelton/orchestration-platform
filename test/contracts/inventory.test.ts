import { describe, expect, test } from "vitest";
import {
  authorityInventoryPaths,
  canonicalDigest,
  computeAuthorityHistoryEmptyRootDigestV2,
  computeAuthorityCensusChainDigest,
  computeAuthorityCensusEntryDigest,
  computeAuthorityCensusPageDigest,
  computeAuthorityCensusTerminalDigest,
  computeAuthorityFilesystemObservationDigest,
  computeAuthorityInventoryBatchDigest,
  computeAuthorityInventoryLeafDigest,
  computeAuthorityInventoryRootDigest,
  computeAuthorityInventoryUpdateEntryDigest,
  computeAuthorityMaterializationPlanDigest,
  computeAuthorityMaterializationPlanEntryDigest,
  computeAuthorityMaterializationReceiptDigest,
  computeAuthorityNodeDigest,
  computeAuthorityNodeRecordDigest,
  diagnostic,
  pointerKinds,
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
  Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(64, "0")),
);
const v = (record: ContractRecord, name: string) => record[name]!;

describe("approved authority node inventory contracts", () => {
  test("pins current versions, the singleton thirteenth row, and closed paths", () => {
    expect(pointerKinds).toHaveLength(13);
    expect(pointerKinds.at(-1)).toBe("AUTHORITY_NODE_MATERIALIZATION_RUN");
    expect(pointerRegistry.at(-1)).toMatchObject({
      kind: "AUTHORITY_NODE_MATERIALIZATION_RUN",
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

  test("composes one exact planned node through filesystem, membership, receipt, and batch", () => {
    const planEntry: ContractRecord = {
      ...fixtureFor("authority-node-materialization-plan-entry/v1"),
      nodeDigest: d("1"),
      nodePath: `installation/state-mutation-authority-history/nodes/${d("1")}.json`,
      nodeRecordDigest: d("2"),
      inventoryLeafDigest: d("3"),
      membershipAction: "INSERT_ABSENT",
      priorTreeRootDigest: d("4"),
      priorCount: "0",
      siblingDigests: siblings,
      successorTreeRootDigest: d("5"),
      successorCount: "1",
    };
    const planEntryDigest = computeAuthorityMaterializationPlanEntryDigest(planEntry);
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
      priorInventoryRootDigest: d("0"),
      priorInventoryCount: "0",
      priorInventoryTreeRootDigest: d("1"),
      planEntryDigests: [planEntryDigest],
      successorInventoryKind: "NONEMPTY",
      successorInventoryRootDigest: d("2"),
      successorInventoryCount: "1",
      successorInventoryTreeRootDigest: d("5"),
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
    ).toBe("6d3bf40e384fcab78f4da89196dc72293cb2a8c75358944038bf7d8ffafcd1a1");
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
    const core: ContractRecord = {
      ...fixtureFor("authority-node-inventory-census-page-core/v1"),
      censusId: uuid,
      authorityTipDigest: digest,
      inventoryKind: "EMPTY",
      inventoryCount: "0",
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
      "3d5e91618255d83d93580499fed4746fcc497df209596bbdd2db75d172ac87fe",
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
    ).toBe("015458c6c885a623c1b71e17bd96f00d2674744606c29133e5038d633bd8a133");
  });

  test("binds E0 authority v3 to selected empty history and inventory roots", () => {
    const inventoryRoot: ContractRecord = {
      ...fixtureFor("authority-node-inventory-empty-root/v1"),
      globalIdentityDigest: digest,
      kind: "EMPTY",
      count: "0",
      treeRootDigest: digest2,
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
      nodeInventoryTreeRootDigest: digest2,
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
      "79830cd0a874c36a365b978129601b9fee7ed7236da301c6ab6a906d3498c7e2",
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

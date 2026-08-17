import { createHash } from "node:crypto";
import {
  canonicalBytes,
  canonicalDigest,
  snapshotClosedArray,
  snapshotClosedRecord,
  validateAgainstSchema,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
  type SchemaDefinition,
} from "./runtime.js";
import {
  framedBytes,
  pointerKinds,
  resolveSelectedPointerEvidence,
  v2Definitions,
  type FramePart,
  type SelectedPointerEvidence,
} from "./v2.js";

const field = (kind: FieldRule["kind"], options: Omit<FieldRule, "kind"> = {}): FieldRule =>
  Object.freeze({ kind, ...options });
const enumeration = (...values: readonly string[]): FieldRule =>
  field("opaque", { values: Object.freeze([...values]) });
const nullable = (kind: FieldRule["kind"]): FieldRule => field(kind, { nullable: true });
const array = (kind: FieldRule["kind"]): FieldRule => field(kind, { array: true });
const uniqueArray = (kind: FieldRule["kind"]): FieldRule =>
  field(kind, { array: true, unique: true });
const define = (
  schemaVersion: string,
  fields: Readonly<Record<string, FieldRule>>,
  validate?: SchemaDefinition["validate"],
): SchemaDefinition =>
  Object.freeze({
    schemaVersion,
    authority: true,
    fields: Object.freeze({ schemaVersion: field("schema-id"), ...fields }),
    ...(validate ? { validate } : {}),
  });
const sha = field("sha256");
const nullableSha = nullable("sha256");
const decimal = field("decimal");
const timestamp = field("timestamp");
const path = field("relative-path");
const json = field("json");
const nullableJson = field("json", { nullable: true });
const uuid = field("uuid-v7");
const raw = (value: string): FramePart => ({ type: "raw32", value });
const nullableRaw = (value: string | null): FramePart => ({ type: "nullable-raw32", value });
const text = (value: string): FramePart => ({ type: "text", value });
const decimalPart = (value: string): FramePart => ({ type: "decimal-ascii", value });
const fixed = (value: string): FramePart => ({ type: "raw-fixed", value });
const canonical = (value: JsonValue): FramePart => ({ type: "canonical", value });
const shaComponent = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError("path:digest-invalid");
  return value;
};
const uuidComponent = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new TypeError("path:uuid-invalid");
  return value;
};
const decimalComponent = (value: string): string => {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new TypeError("path:decimal-invalid");
  return value;
};
const incrementDecimal = (value: string): string => (BigInt(value) + 1n).toString();

function computeHistoryEmptyDigest(depth: number): string {
  return digest("authority-history-empty/v1", [fixed(depth.toString(16).padStart(4, "0"))]);
}

function computeHistoryNodeDigest(depth: number, left: string, right: string): string {
  return digest("authority-history-node/v1", [
    fixed(depth.toString(16).padStart(4, "0")),
    raw(left),
    raw(right),
  ]);
}

function computeHistorySparseRoot(
  epochKey: string,
  leafDigest: string | null,
  siblingDigests: readonly string[],
): string {
  if (siblingDigests.length !== 256) throw new TypeError("history-siblings:invalid");
  const bits = [...Buffer.from(epochKey, "hex")].flatMap((byte) =>
    Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1),
  );
  let current = leafDigest ?? computeHistoryEmptyDigest(256);
  for (let level = 0; level < 256; level += 1) {
    const depth = 255 - level;
    const sibling = siblingDigests[level]!;
    if (
      leafDigest === null &&
      current === computeHistoryEmptyDigest(depth + 1) &&
      sibling === computeHistoryEmptyDigest(depth + 1)
    )
      current = computeHistoryEmptyDigest(depth);
    else
      current =
        bits[depth] === 0
          ? computeHistoryNodeDigest(depth, current, sibling)
          : computeHistoryNodeDigest(depth, sibling, current);
  }
  return current;
}

function computeHistoryLeafDigest(record: ContractRecord): string {
  return digest("authority-epoch-leaf/v1", [
    raw(record.globalIdentityDigest as string),
    raw(record.epochKey as string),
    decimalPart(record.authorityOrdinal as string),
    raw(record.authorityPathInstanceDigest as string),
    raw(record.authorityTipDigest as string),
    raw(record.authorityValueDigest as string),
    raw(record.authorityReceiptDigest as string),
    canonical(record),
  ]);
}

function computeAuthorityUpdateProofDigestLocal(record: ContractRecord): string {
  const siblings = record.siblingDigests as readonly string[];
  return digest("authority-history-update-proof/v1", [
    raw(record.globalIdentityDigest as string),
    raw(record.epochKey as string),
    raw(record.leafDigest as string),
    text(record.priorRootKind as string),
    raw(record.priorRootDigest as string),
    raw(record.successorRootDigest as string),
    decimalPart(record.priorCount as string),
    decimalPart(record.successorCount as string),
    ...siblings.map(raw),
    canonical(record),
  ]);
}

export function deriveAuthorityUpdateNodeCensus(input: unknown): readonly ContractRecord[] {
  const closed = snapshotClosedRecord(input, ["leaf", "updateProof"]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const leafParsed = validateAgainstSchema(authorityHistoryLeafDefinition, closed.value.leaf);
  const proofParsed = validateAgainstSchema(
    authorityHistoryUpdateProofDefinition,
    closed.value.updateProof,
  );
  if (!leafParsed.ok || !proofParsed.ok) throw new TypeError("authority-update-witness:invalid");
  const leaf = leafParsed.value;
  const proof = proofParsed.value;
  const leafDigest = computeHistoryLeafDigest(leaf);
  if (proof.epochKey !== leaf.epochKey || proof.leafDigest !== leafDigest)
    throw new TypeError("authority-update-witness:leaf-mismatch");
  const siblings = proof.siblingDigests as readonly string[];
  const bits = [...Buffer.from(leaf.epochKey as string, "hex")].flatMap((byte) =>
    Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1),
  );
  let successor = leafDigest;
  const byDigest = new Map<string, ContractRecord>();
  const addNode = (depth: number, current: string, sibling: string, bit: number): string => {
    if (
      current === computeHistoryEmptyDigest(depth + 1) &&
      sibling === computeHistoryEmptyDigest(depth + 1)
    )
      return computeHistoryEmptyDigest(depth);
    const left = bit === 0 ? current : sibling;
    const right = bit === 0 ? sibling : current;
    const nodeDigest = computeHistoryNodeDigest(depth, left, right);
    const recordPath = `installation/state-mutation-authority-history/nodes/${nodeDigest}.json`;
    const node: ContractRecord = Object.freeze({
      schemaVersion: "authority-history-node/v1",
      depth: String(depth),
      leftChildDigest: left,
      rightChildDigest: right,
      nodeDigest,
      recordPath,
    });
    const existing = byDigest.get(nodeDigest);
    if (
      existing &&
      Buffer.compare(Buffer.from(canonicalBytes(existing)), Buffer.from(canonicalBytes(node))) !== 0
    )
      throw new TypeError("authority-update-witness:node-digest-collision");
    byDigest.set(nodeDigest, node);
    return nodeDigest;
  };
  for (let level = 0; level < 256; level += 1) {
    const depth = 255 - level;
    const sibling = siblings[level]!;
    successor = addNode(depth, successor, sibling, bits[depth]!);
  }
  return Object.freeze(
    [...byDigest.values()]
      .sort((left, right) => String(left.nodeDigest).localeCompare(String(right.nodeDigest)))
      .map((node) => {
        const nodeRecord: ContractRecord = {
          schemaVersion: "authority-history-node-record/v1",
          nodeDigest: node.nodeDigest!,
          node,
          recordPath: node.recordPath!,
        };
        const nodeRecordDigest = computeAuthorityNodeRecordDigest(nodeRecord);
        const inventoryLeaf: ContractRecord = {
          schemaVersion: "authority-node-inventory-leaf/v1",
          nodeDigest: node.nodeDigest!,
          nodePath: node.recordPath!,
          nodeRecordDigest,
          recordPath: authorityInventoryPaths.leaf(node.nodeDigest as string),
        };
        return Object.freeze({
          node,
          nodeDigest: node.nodeDigest!,
          nodePath: node.recordPath!,
          nodeRecordDigest,
          inventoryLeafDigest: computeAuthorityInventoryLeafDigest(inventoryLeaf),
        });
      }),
  );
}

const runPostSelectionObservationDefinition = define(
  "pointer-mutation-run-selector-post-selection-observation/v1",
  {
    checkpointCoreDigest: sha,
    selectorPathInstanceDigest: sha,
    selectorMutationId: sha,
    selectorValueDigest: sha,
    selectorReceiptDigest: sha,
    selectorTipDigest: sha,
    valueReadbackDigest: sha,
    proposalReadbackDigest: sha,
    tipReadbackDigest: sha,
    observedAt: timestamp,
  },
);
const runSegmentDefinition = define("pointer-mutation-run-segment/v1", {
  globalIdentityDigest: sha,
  pointerKind: enumeration(...pointerKinds),
  canonicalPointerPath: path,
  installationId: uuid,
  projectId: uuid,
  stateRootDigest: sha,
  transactionId: field("uuid-v7", { nullable: true }),
  sourceToken: field("opaque"),
  targetPathInstanceDigest: sha,
  targetMutationId: sha,
  runId: sha,
  runOrdinal: decimal,
  stage: enumeration(
    "CURRENT_AUTHORITY_READ",
    "TARGET_RECONCILED",
    "VALUE_READBACK",
    "PROPOSAL_READBACK",
    "CURRENT_AUTHORITY_PRE_CAS_READ",
    "CAS_ARMED",
    "TARGET_POST_CAS_READBACK",
    "PROPOSAL_CLASSIFIED",
    "CURRENT_AUTHORITY_POST_CAS_READ",
  ),
  stageEvidenceDigest: sha,
  recordedAt: timestamp,
});
const commitResolutionDefinition = define("pointer-mutation-commit-resolution/v1", {
  targetPathInstanceDigest: sha,
  targetMutationId: sha,
  outcome: enumeration("SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"),
  outcomeEvidenceDigest: sha,
  selectedTargetTipDigest: nullableSha,
  conflictReceiptDigest: nullableSha,
  unknownEvidenceDigest: nullableSha,
  producerEpochKey: sha,
  resolvedAt: timestamp,
});
const authorityHistoryLeafDefinition = define("authority-history-leaf/v1", {
  globalIdentityDigest: sha,
  epochKey: sha,
  authorityOrdinal: decimal,
  authorityPathInstanceDigest: sha,
  authorityTipDigest: sha,
  authorityValueDigest: sha,
  authorityReceiptDigest: sha,
});
const authorityHistoryUpdateProofDefinition = define("authority-history-update-proof/v1", {
  globalIdentityDigest: sha,
  epochKey: sha,
  leafDigest: sha,
  priorRootKind: enumeration("EMPTY", "NONEMPTY"),
  priorRootDigest: sha,
  successorRootDigest: sha,
  priorCount: decimal,
  successorCount: decimal,
  siblingDigests: array("sha256"),
});

export function computeAuthorityInventoryEmptyDigest(depth: number): string {
  if (!Number.isInteger(depth) || depth < 0 || depth > 256)
    throw new TypeError("inventory-depth:invalid");
  return digest("authority-node-inventory-empty/v1", [fixed(depth.toString(16).padStart(4, "0"))]);
}

function digestBits(value: string): readonly number[] {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError("inventory-key:invalid");
  return [...Buffer.from(value, "hex")].flatMap((byte) =>
    Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1),
  );
}

export function computeAuthorityInventorySparseRoot(
  nodeDigest: string,
  leafDigest: string,
  siblingDigests: readonly string[],
): string {
  const siblings = snapshotClosedArray(siblingDigests);
  if (!siblings.ok || siblings.value.length !== 256)
    throw new TypeError("inventory-siblings:invalid");
  const bits = digestBits(nodeDigest);
  let current = leafDigest;
  for (let index = 0; index < 256; index += 1) {
    const sibling = siblings.value[index] as string;
    const depth = 255 - index;
    current =
      bits[depth] === 0
        ? digest("authority-node-inventory-node/v1", [
            fixed(depth.toString(16).padStart(4, "0")),
            raw(current),
            raw(sibling),
          ])
        : digest("authority-node-inventory-node/v1", [
            fixed(depth.toString(16).padStart(4, "0")),
            raw(sibling),
            raw(current),
          ]);
  }
  return current;
}

export function computeAuthorityInventorySparseAbsentRoot(
  nodeDigest: string,
  siblingDigests: readonly string[],
): string {
  const siblings = snapshotClosedArray(siblingDigests);
  if (!siblings.ok || siblings.value.length !== 256)
    throw new TypeError("inventory-siblings:invalid");
  const bits = digestBits(nodeDigest);
  let current = computeAuthorityInventoryEmptyDigest(256);
  for (let index = 0; index < 256; index += 1) {
    const sibling = siblings.value[index] as string;
    const depth = 255 - index;
    if (
      current === computeAuthorityInventoryEmptyDigest(depth + 1) &&
      sibling === computeAuthorityInventoryEmptyDigest(depth + 1)
    )
      current = computeAuthorityInventoryEmptyDigest(depth);
    else
      current =
        bits[depth] === 0
          ? digest("authority-node-inventory-node/v1", [
              fixed(depth.toString(16).padStart(4, "0")),
              raw(current),
              raw(sibling),
            ])
          : digest("authority-node-inventory-node/v1", [
              fixed(depth.toString(16).padStart(4, "0")),
              raw(sibling),
              raw(current),
            ]);
  }
  return current;
}

function inventoryEntryProofIssues(record: ContractRecord): readonly string[] {
  const siblings = record.siblingDigests as readonly string[];
  const priorRoot =
    record.membershipAction === "INSERT_ABSENT"
      ? computeAuthorityInventorySparseAbsentRoot(record.nodeDigest as string, siblings)
      : computeAuthorityInventorySparseRoot(
          record.nodeDigest as string,
          record.inventoryLeafDigest as string,
          siblings,
        );
  const successorRoot = computeAuthorityInventorySparseRoot(
    record.nodeDigest as string,
    record.inventoryLeafDigest as string,
    siblings,
  );
  const issues: string[] = [];
  if (record.priorTreeRootDigest !== priorRoot) issues.push("priorTreeRootDigest:not-derived");
  if (record.successorTreeRootDigest !== successorRoot)
    issues.push("successorTreeRootDigest:not-derived");
  return issues;
}

function digest(domain: string, parts: readonly FramePart[]): string {
  return createHash("sha256").update(framedBytes(domain, parts)).digest("hex");
}

function requireRecord(schemaVersion: string, input: unknown): ContractRecord {
  const definition = inventoryDefinitions[schemaVersion];
  if (!definition) throw new TypeError("schemaVersion:unsupported");
  const parsed = validateAgainstSchema(definition, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

const exactTriple = (record: ContractRecord, prefix: string): readonly string[] => {
  const fields = [
    record[`${prefix}TipDigest`],
    record[`${prefix}ValueDigest`],
    record[`${prefix}ReceiptDigest`],
  ];
  return fields.every((value) => value === null) || fields.every((value) => value !== null)
    ? []
    : [`${prefix}:partial-triple`];
};

const INVENTORY_KIND = ["EMPTY", "NONEMPTY"] as const;
const FILE_DISPOSITION = [
  "CREATED",
  "READBACK_SAME",
  "MISSING_SELECTED",
  "BYTES_CONFLICT",
] as const;
const MEMBERSHIP_ACTION = ["INSERT_ABSENT", "ALREADY_MEMBER"] as const;

export const authorityInventoryPaths = Object.freeze({
  emptyRoot: (digestValue: string) =>
    `installation/state-mutation-authority-history/node-inventory/empty-roots/${shaComponent(digestValue)}.json`,
  root: (digestValue: string) =>
    `installation/state-mutation-authority-history/node-inventory/roots/${shaComponent(digestValue)}.json`,
  leaf: (nodeDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/leaves/${shaComponent(nodeDigest)}.json`,
  plan: (rotationId: string, planDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/plans/${shaComponent(rotationId)}/${shaComponent(planDigest)}.json`,
  observation: (rotationId: string, nodeDigest: string, observationDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/observations/${shaComponent(rotationId)}/${shaComponent(nodeDigest)}-${shaComponent(observationDigest)}.json`,
  materialization: (rotationId: string, nodeDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/materializations/${shaComponent(rotationId)}/${shaComponent(nodeDigest)}.json`,
  update: (rotationId: string) =>
    `installation/state-mutation-authority-history/node-inventory/updates/${shaComponent(rotationId)}.json`,
  coordinator: (authorityDp: string) =>
    `installation/state-mutation-authority-history/node-inventory/coordinator/${shaComponent(authorityDp)}/current.json`,
  censusPage: (authorityDt: string, censusId: string, ordinal: string, pageDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/censuses/${shaComponent(authorityDt)}/${uuidComponent(censusId)}/pages/${decimalComponent(ordinal)}-${shaComponent(pageDigest)}.json`,
  censusTerminal: (authorityDt: string, censusId: string, terminalDigest: string) =>
    `installation/state-mutation-authority-history/node-inventory/censuses/${shaComponent(authorityDt)}/${uuidComponent(censusId)}/terminal-${shaComponent(terminalDigest)}.json`,
});

export const inventoryDefinitions: Readonly<Record<string, SchemaDefinition>> = Object.freeze(
  Object.fromEntries(
    [
      define("state-mutation-authority-rotation-id/v2", {
        globalIdentityDigest: sha,
        oldAuthorityPathInstanceDigest: sha,
        oldAuthorityTipDigest: sha,
        oldAuthorityValueDigest: sha,
        oldAuthorityReceiptDigest: sha,
        successorOrdinal: decimal,
        reviewedSuccessorSubjectDigest: sha,
        independentReviewDigest: sha,
        rotationOperationIdentityDigest: sha,
      }),
      define(
        "authority-node-inventory-empty-root/v1",
        {
          globalIdentityDigest: sha,
          kind: enumeration("EMPTY"),
          count: enumeration("0"),
          treeRootDigest: sha,
        },
        (record) =>
          record.treeRootDigest === computeAuthorityInventoryEmptyDigest(0)
            ? []
            : ["treeRootDigest:not-empty-root"],
      ),
      define(
        "authority-node-inventory-root/v1",
        {
          globalIdentityDigest: sha,
          kind: enumeration("NONEMPTY"),
          count: decimal,
          treeRootDigest: sha,
        },
        (record) => (record.count === "0" ? ["count:must-be-positive"] : []),
      ),
      define("authority-history-node-record/v1", {
        nodeDigest: sha,
        node: json,
        recordPath: path,
      }),
      define("authority-node-inventory-leaf/v1", {
        nodeDigest: sha,
        nodePath: path,
        nodeRecordDigest: sha,
        recordPath: path,
      }),
      define(
        "authority-node-materialization-plan-entry/v1",
        {
          nodeDigest: sha,
          nodePath: path,
          nodeRecordDigest: sha,
          inventoryLeafDigest: sha,
          membershipAction: enumeration(...MEMBERSHIP_ACTION),
          priorTreeRootDigest: sha,
          priorCount: decimal,
          siblingDigests: array("sha256"),
          successorTreeRootDigest: sha,
          successorCount: decimal,
        },
        (record) => {
          const issues: string[] = [];
          if (!Array.isArray(record.siblingDigests) || record.siblingDigests.length !== 256)
            issues.push("siblingDigests:length");
          else issues.push(...inventoryEntryProofIssues(record));
          if (record.membershipAction === "INSERT_ABSENT") {
            if (incrementDecimal(record.priorCount as string) !== record.successorCount)
              issues.push("count:insert-not-adjacent");
          } else if (
            record.priorCount !== record.successorCount ||
            record.priorTreeRootDigest !== record.successorTreeRootDigest
          )
            issues.push("membership:already-member-changed-root-count");
          return issues;
        },
      ),
      define(
        "authority-node-filesystem-observation/v1",
        {
          globalIdentityDigest: sha,
          rotationId: sha,
          materializationPlanDigest: sha,
          startedTipDigest: sha,
          startedValueDigest: sha,
          startedReceiptDigest: sha,
          nodeDigest: sha,
          nodePath: path,
          nodeRecordDigest: sha,
          inventoryLeafDigest: sha,
          filesystemDisposition: enumeration(...FILE_DISPOSITION),
          existed: field("boolean"),
          observedBytesDigest: nullableSha,
          readbackDigest: nullableSha,
          oldAuthorityTipDigest: sha,
          oldAuthorityValueDigest: sha,
          oldAuthorityReceiptDigest: sha,
          observedAt: timestamp,
        },
        (record) => {
          if (record.filesystemDisposition === "CREATED")
            return record.existed === false &&
              record.observedBytesDigest === null &&
              record.readbackDigest === record.nodeRecordDigest
              ? []
              : ["filesystemDisposition:created-fields"];
          if (record.filesystemDisposition === "READBACK_SAME")
            return record.existed === true &&
              record.observedBytesDigest === record.nodeRecordDigest &&
              record.readbackDigest === record.nodeRecordDigest
              ? []
              : ["filesystemDisposition:readback-fields"];
          if (record.filesystemDisposition === "MISSING_SELECTED")
            return record.existed === false &&
              record.observedBytesDigest === null &&
              record.readbackDigest === null
              ? []
              : ["filesystemDisposition:missing-fields"];
          return record.existed === true &&
            record.observedBytesDigest !== null &&
            record.observedBytesDigest !== record.nodeRecordDigest &&
            record.readbackDigest === record.observedBytesDigest
            ? []
            : ["filesystemDisposition:conflict-fields"];
        },
      ),
      define(
        "authority-node-inventory-update-entry/v1",
        {
          globalIdentityDigest: sha,
          rotationId: sha,
          materializationPlanDigest: sha,
          startedTipDigest: sha,
          startedValueDigest: sha,
          startedReceiptDigest: sha,
          nodeDigest: sha,
          inventoryLeafDigest: sha,
          membershipAction: enumeration(...MEMBERSHIP_ACTION),
          filesystemObservationDigest: sha,
          priorTreeRootDigest: sha,
          priorCount: decimal,
          siblingDigests: array("sha256"),
          successorTreeRootDigest: sha,
          successorCount: decimal,
        },
        (record) => {
          const issues: string[] = [];
          if (!Array.isArray(record.siblingDigests) || record.siblingDigests.length !== 256)
            issues.push("siblingDigests:length");
          else issues.push(...inventoryEntryProofIssues(record));
          if (record.membershipAction === "INSERT_ABSENT") {
            if (incrementDecimal(record.priorCount as string) !== record.successorCount)
              issues.push("count:insert-not-adjacent");
          } else if (
            record.priorCount !== record.successorCount ||
            record.priorTreeRootDigest !== record.successorTreeRootDigest
          )
            issues.push("membership:already-member-changed-root-count");
          return issues;
        },
      ),
      define(
        "authority-node-materialization-receipt/v1",
        {
          globalIdentityDigest: sha,
          rotationId: sha,
          materializationPlanDigest: sha,
          startedTipDigest: sha,
          startedValueDigest: sha,
          startedReceiptDigest: sha,
          nodeDigest: sha,
          nodePath: path,
          nodeRecordDigest: sha,
          inventoryLeafDigest: sha,
          filesystemObservationDigest: sha,
          updateEntryDigest: sha,
          createdAt: timestamp,
          readbackAt: timestamp,
          recordPath: path,
        },
        (record) =>
          String(record.createdAt) <= String(record.readbackAt)
            ? []
            : ["readbackAt:before-createdAt"],
      ),
      define("authority-node-materialization-plan/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        oldAuthorityPathInstanceDigest: sha,
        oldAuthorityTipDigest: sha,
        oldAuthorityValueDigest: sha,
        oldAuthorityReceiptDigest: sha,
        priorHistoryKind: enumeration(...INVENTORY_KIND),
        priorHistoryRootDigest: sha,
        priorHistoryCount: decimal,
        priorHistoryTreeRootDigest: sha,
        predecessorLeafDigest: sha,
        authorityUpdateProofDigest: sha,
        priorInventoryKind: enumeration(...INVENTORY_KIND),
        priorInventoryRootDigest: sha,
        priorInventoryCount: decimal,
        priorInventoryTreeRootDigest: sha,
        planEntryDigests: uniqueArray("sha256"),
        successorInventoryKind: enumeration("NONEMPTY"),
        successorInventoryRootDigest: sha,
        successorInventoryCount: decimal,
        successorInventoryTreeRootDigest: sha,
        successorHistoryCount: decimal,
        successorHistoryTreeRootDigest: sha,
        successorLatestEpochKey: sha,
        successorLatestTipDigest: sha,
        successorLatestValueDigest: sha,
        successorLatestReceiptDigest: sha,
        reviewedSuccessorSubjectDigest: sha,
        activeReleaseTipDigest: sha,
        activeReleaseValueDigest: sha,
        activeReleaseReceiptDigest: sha,
        independentReviewDigest: sha,
        successorOrdinal: decimal,
        recoveryPolicy: enumeration("FINISH_ONLY"),
      }),
      define("authority-node-inventory-batch-update/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        startedTipDigest: sha,
        startedValueDigest: sha,
        startedReceiptDigest: sha,
        authorityUpdateProofDigest: sha,
        priorInventoryKind: enumeration(...INVENTORY_KIND),
        priorInventoryRootDigest: sha,
        priorInventoryCount: decimal,
        priorInventoryTreeRootDigest: sha,
        materializationReceiptDigests: uniqueArray("sha256"),
        updateEntryDigests: uniqueArray("sha256"),
        successorInventoryKind: enumeration("NONEMPTY"),
        successorInventoryRootDigest: sha,
        successorInventoryCount: decimal,
        successorInventoryTreeRootDigest: sha,
        recordPath: path,
      }),
      define("authority-node-materialization-run-position/v1", {
        authorityPathInstanceDigest: sha,
        coordinatorOrdinal: decimal,
        lifecycle: enumeration(
          "IDLE",
          "PREAUTHORIZED",
          "STARTED",
          "FINISHING",
          "TERMINAL",
          "REVOKED_BEFORE_START",
        ),
        rotationId: nullableSha,
        materializationPlanDigest: nullableSha,
        phaseEvidenceDigest: nullableSha,
      }),
      define("authority-node-materialization-start-receipt/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        preauthorizedTipDigest: sha,
        preauthorizedValueDigest: sha,
        preauthorizedReceiptDigest: sha,
        oldAuthorityTipDigest: sha,
        oldAuthorityValueDigest: sha,
        oldAuthorityReceiptDigest: sha,
        startedAt: timestamp,
      }),
      define("authority-rotation-run-handoff-receipt/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        targetAuthorityPathInstanceDigest: sha,
        oldAuthorityTipDigest: sha,
        oldAuthorityValueDigest: sha,
        oldAuthorityReceiptDigest: sha,
        casArmedSelectorTipDigest: sha,
        casArmedSelectorValueDigest: sha,
        casArmedSelectorReceiptDigest: sha,
        casArmedCoreDigest: sha,
        startedTipDigest: sha,
        startedValueDigest: sha,
        startedReceiptDigest: sha,
        newAuthorityTipDigest: sha,
        newAuthorityValueDigest: sha,
        newAuthorityReceiptDigest: sha,
        targetValueReadbackDigest: sha,
        targetProposalReadbackDigest: sha,
        targetTipReadbackDigest: sha,
        lockProfileDigest: sha,
        custodyInstanceDigest: sha,
        custodyObservationDigest: sha,
        observedAt: timestamp,
      }),
      define("authority-node-materialization-handoff-receipt/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        startedTipDigest: sha,
        startedValueDigest: sha,
        startedReceiptDigest: sha,
        inventoryBatchDigest: sha,
        newAuthorityPathInstanceDigest: sha,
        newAuthorityTipDigest: sha,
        newAuthorityValueDigest: sha,
        newAuthorityReceiptDigest: sha,
        rotationHandoffReceiptDigest: sha,
        terminalResolutionDigest: sha,
        finalSelectorTipDigest: sha,
        finalSelectorValueDigest: sha,
        finalSelectorReceiptDigest: sha,
        finalValueReadbackDigest: sha,
        finalProposalReadbackDigest: sha,
        finalTipReadbackDigest: sha,
        createdAt: timestamp,
      }),
      define("authority-node-materialization-finishing/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        startedTipDigest: sha,
        startedValueDigest: sha,
        startedReceiptDigest: sha,
        inventoryBatchDigest: sha,
        newAuthorityPathInstanceDigest: sha,
        newAuthorityTipDigest: sha,
        newAuthorityValueDigest: sha,
        newAuthorityReceiptDigest: sha,
        terminalResolutionDigest: sha,
        finalSelectorTipDigest: sha,
        finalSelectorValueDigest: sha,
        finalSelectorReceiptDigest: sha,
        rotationHandoffReceiptDigest: sha,
        materializationHandoffReceiptDigest: sha,
      }),
      define("authority-node-materialization-terminal-receipt/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        finishingTipDigest: sha,
        finishingValueDigest: sha,
        finishingReceiptDigest: sha,
        newAuthorityTipDigest: sha,
        newAuthorityValueDigest: sha,
        newAuthorityReceiptDigest: sha,
        finalValueReadbackDigest: sha,
        finalProposalReadbackDigest: sha,
        finalTipReadbackDigest: sha,
        censusTerminalDigest: nullableSha,
        completedAt: timestamp,
      }),
      define("authority-node-materialization-revocation-receipt/v1", {
        globalIdentityDigest: sha,
        rotationId: sha,
        materializationPlanDigest: sha,
        preauthorizedTipDigest: sha,
        preauthorizedValueDigest: sha,
        preauthorizedReceiptDigest: sha,
        revocationEvidenceDigest: sha,
        revokedAt: timestamp,
      }),
      define(
        "authority-node-inventory-census-entry/v1",
        {
          globalEntryOrdinal: decimal,
          nodePath: path,
          node: json,
          nodeDigest: sha,
          nodeRecordDigest: sha,
          inventoryLeafDigest: sha,
          siblingDigests: array("sha256"),
        },
        (record) =>
          Array.isArray(record.siblingDigests) && record.siblingDigests.length === 256
            ? []
            : ["siblingDigests:length"],
      ),
      define("authority-node-inventory-census-page-core/v1", {
        globalIdentityDigest: sha,
        censusId: uuid,
        authorityPathInstanceDigest: sha,
        authorityTipDigest: sha,
        authorityValueDigest: sha,
        authorityReceiptDigest: sha,
        historyRootDigest: sha,
        inventoryKind: enumeration(...INVENTORY_KIND),
        inventoryRootDigest: sha,
        inventoryCount: decimal,
        inventoryTreeRootDigest: sha,
        pageOrdinal: decimal,
        priorPageDigest: nullableSha,
        priorCursor: field("relative-path", { nullable: true }),
        priorCensusDigest: nullableSha,
        priorCumulativeCount: decimal,
        entries: array("json"),
        entryDigests: uniqueArray("sha256"),
        enumerationObservationDigest: sha,
        successorCursor: field("relative-path", { nullable: true }),
        successorCumulativeCount: decimal,
        exhausted: field("boolean"),
        createdAt: timestamp,
      }),
      define("authority-node-inventory-census-page/v1", {
        core: json,
        pageDigest: sha,
        censusDigest: sha,
        recordPath: path,
      }),
      define("authority-node-inventory-census-terminal-core/v1", {
        globalIdentityDigest: sha,
        censusId: uuid,
        authorityPathInstanceDigest: sha,
        authorityTipDigest: sha,
        authorityValueDigest: sha,
        authorityReceiptDigest: sha,
        historyRootDigest: sha,
        inventoryKind: enumeration(...INVENTORY_KIND),
        inventoryRootDigest: sha,
        inventoryCount: decimal,
        inventoryTreeRootDigest: sha,
        firstPageDigest: sha,
        lastPageDigest: sha,
        lastCensusDigest: sha,
        pageCount: decimal,
        cumulativeCount: decimal,
        terminalEnumerationObservationDigest: sha,
        completedAt: timestamp,
      }),
      define("authority-node-inventory-census-terminal/v1", {
        core: json,
        terminalDigest: sha,
        recordPath: path,
      }),
      define(
        "authority-history-empty-root/v2",
        {
          globalIdentityDigest: sha,
          treeProfile: enumeration("SPARSE_SHA256_256_V1"),
          count: enumeration("0"),
          treeRootDigest: sha,
          nodeInventoryRootKind: enumeration("EMPTY"),
          nodeInventoryRootDigest: sha,
          nodeInventoryCount: enumeration("0"),
        },
        (record) =>
          record.treeRootDigest === computeHistoryEmptyDigest(0)
            ? []
            : ["treeRootDigest:empty-root-mismatch"],
      ),
      define(
        "authority-history-root/v2",
        {
          globalIdentityDigest: sha,
          treeProfile: enumeration("SPARSE_SHA256_256_V1"),
          count: decimal,
          treeRootDigest: sha,
          latestIncludedOrdinal: decimal,
          latestEpochKey: sha,
          latestTipDigest: sha,
          latestValueDigest: sha,
          latestReceiptDigest: sha,
          nodeInventoryRootKind: enumeration("NONEMPTY"),
          nodeInventoryRootDigest: sha,
          nodeInventoryCount: decimal,
          nodeInventoryTreeRootDigest: sha,
        },
        (record) => {
          const issues: string[] = [];
          if (
            record.count === "0" ||
            incrementDecimal(record.latestIncludedOrdinal as string) !== record.count
          )
            issues.push("count:latest-ordinal-mismatch");
          if (record.nodeInventoryCount === "0") issues.push("nodeInventoryCount:must-be-positive");
          return issues;
        },
      ),
      define("authority-history-append-receipt/v2", {
        globalIdentityDigest: sha,
        rotationId: sha,
        predecessorPathInstanceDigest: sha,
        predecessorTipDigest: sha,
        predecessorValueDigest: sha,
        predecessorReceiptDigest: sha,
        priorRootKind: enumeration(...INVENTORY_KIND),
        priorRootDigest: sha,
        priorCount: decimal,
        appendedEpochKey: sha,
        leafDigest: sha,
        updateProofDigest: sha,
        materializationPlanDigest: sha,
        materializationStartedTipDigest: sha,
        materializationStartedValueDigest: sha,
        materializationStartedReceiptDigest: sha,
        inventoryBatchDigest: sha,
        successorInventoryRootDigest: sha,
        successorInventoryCount: decimal,
        successorInventoryTreeRootDigest: sha,
        successorRootDigest: sha,
        successorCount: decimal,
        successorCoreDigest: sha,
        createdAt: timestamp,
      }),
      define("state-mutation-authority-successor-core/v2", {
        globalIdentityDigest: sha,
        rotationId: sha,
        predecessorTipDigest: sha,
        predecessorValueDigest: sha,
        predecessorReceiptDigest: sha,
        successorOrdinal: decimal,
        selectedActiveReleaseTipDigest: sha,
        selectedActiveReleaseValueDigest: sha,
        selectedActiveReleaseReceiptDigest: sha,
        reviewedHelperDigest: sha,
        reviewedProfileDigest: sha,
        reviewedAbiDigest: sha,
        reviewedCustodyDigest: sha,
        successorHistoryRootDigest: sha,
        successorInventoryRootDigest: sha,
      }),
      define(
        "pointer-mutation-run-intent/v2",
        {
          globalIdentityDigest: sha,
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: field("uuid-v7", { nullable: true }),
          sourceToken: field("opaque"),
          targetPathInstanceDigest: sha,
          targetMutationId: sha,
          expectedPriorTipDigest: nullableSha,
          expectedPriorValueDigest: nullableSha,
          expectedPriorReceiptDigest: nullableSha,
          expectedSuccessorValueDigest: sha,
          epochPolicy: enumeration("SINGLE_EPOCH", "AUTHORITY_ROTATION_HANDOFF"),
          materializationPlanDigest: nullableSha,
          materializationStartedTipDigest: nullableSha,
          materializationStartedValueDigest: nullableSha,
          materializationStartedReceiptDigest: nullableSha,
          priorCheckpointDigest: nullableSha,
          createdAt: timestamp,
        },
        (record) => [
          ...exactTriple(record, "expectedPrior"),
          ...exactTriple(record, "materializationStarted"),
        ],
      ),
      define(
        "pointer-mutation-run-checkpoint-core/v2",
        {
          globalIdentityDigest: sha,
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          targetPathInstanceDigest: sha,
          targetMutationId: sha,
          runOrdinal: decimal,
          checkpointOrdinal: decimal,
          segmentDigest: sha,
          auditDigest: sha,
          priorSelectorTipDigest: nullableSha,
          priorSelectorValueDigest: nullableSha,
          priorSelectorReceiptDigest: nullableSha,
          priorPostSelectionObservationDigest: nullableSha,
          epochPolicy: enumeration("SINGLE_EPOCH", "AUTHORITY_ROTATION_HANDOFF"),
          producerAuthorityTipDigest: sha,
          producerAuthorityValueDigest: sha,
          producerAuthorityReceiptDigest: sha,
          materializationPlanDigest: nullableSha,
          materializationStartedTipDigest: nullableSha,
          materializationStartedValueDigest: nullableSha,
          materializationStartedReceiptDigest: nullableSha,
          rotationHandoffReceiptDigest: nullableSha,
          stage: enumeration(
            "CURRENT_AUTHORITY_READ",
            "TARGET_RECONCILED",
            "VALUE_READBACK",
            "PROPOSAL_READBACK",
            "CURRENT_AUTHORITY_PRE_CAS_READ",
            "CAS_ARMED",
            "TARGET_POST_CAS_READBACK",
            "PROPOSAL_CLASSIFIED",
            "CURRENT_AUTHORITY_POST_CAS_READ",
          ),
          phase: enumeration(
            "CRASH_PREFIX",
            "CAS_AMBIGUOUS",
            "SELECTED",
            "LOST_CONFLICT",
            "UNKNOWN_TERMINAL",
          ),
          terminalResolutionDigest: nullableSha,
        },
        (record) => [
          ...exactTriple(record, "priorSelector"),
          ...exactTriple(record, "materializationStarted"),
        ],
      ),
      define("pointer-mutation-commit-evidence/v3", {
        purpose: enumeration("MUTATION_COMMIT"),
        authoritySelection: json,
        intent: json,
        checkpoints: array("json"),
        outcome: enumeration("SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"),
        proposedTarget: json,
        selectedTarget: nullableJson,
        conflictEvidence: nullableJson,
        unknownEvidence: nullableJson,
        rotationHandoffReceipt: nullableJson,
        materializationHandoffReceipt: nullableJson,
        materializationFinishingSelection: nullableJson,
      }),
      define("pointer-mutation-run-checkpoint-evidence/v2", {
        segment: json,
        core: json,
        selectorSelection: json,
        postSelectionObservation: json,
        terminalResolution: nullableJson,
      }),
      define("pointer-evidence-slot/v3", {
        pointerKind: enumeration(...pointerKinds),
        selectedEvidence: field("json", { nullable: true }),
        producerMembership: field("json", { nullable: true }),
      }),
      define(
        "pointer-evidence-packet/v3",
        {
          purpose: enumeration("HISTORICAL_READ", "MUTATION_COMMIT"),
          globalIdentity: json,
          currentAuthoritySelection: json,
          currentAuthorityHistoryRoot: json,
          currentNodeInventoryRoot: json,
          currentCommit: nullableJson,
          evidenceSlots: array("json"),
          producerMemberships: array("json"),
        },
        (record) =>
          (record.purpose === "HISTORICAL_READ") === (record.currentCommit === null)
            ? []
            : ["purpose:currentCommit-mismatch"],
      ),
    ].map((definition) => [definition.schemaVersion, definition]),
  ),
);

function digestRecord(
  schemaVersion: string,
  domain: string,
  input: unknown,
  parts: FramePart[],
): string {
  const record = requireRecord(schemaVersion, input);
  return digest(domain, [...parts, canonical(record)]);
}

export function computeAuthorityRotationIdV2(input: unknown): string {
  const record = requireRecord("state-mutation-authority-rotation-id/v2", input);
  return digest("state-mutation-authority-rotation-id/v2", [
    raw(record.globalIdentityDigest as string),
    raw(record.oldAuthorityPathInstanceDigest as string),
    raw(record.oldAuthorityTipDigest as string),
    raw(record.oldAuthorityValueDigest as string),
    raw(record.oldAuthorityReceiptDigest as string),
    decimalPart(record.successorOrdinal as string),
    raw(record.reviewedSuccessorSubjectDigest as string),
    raw(record.independentReviewDigest as string),
    raw(record.rotationOperationIdentityDigest as string),
  ]);
}

export function computeAuthorityNodeRecordDigest(input: unknown): string {
  const record = requireRecord("authority-history-node-record/v1", input);
  return digest("authority-history-node-record/v1", [
    raw(record.nodeDigest as string),
    canonical(record.node as JsonValue),
  ]);
}

export function computeAuthorityInventoryLeafDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-leaf/v1", input);
  return digest("authority-node-inventory-leaf/v1", [
    raw(record.nodeDigest as string),
    text(record.nodePath as string),
    raw(record.nodeRecordDigest as string),
    canonical(record),
  ]);
}

export function computeAuthorityInventoryRootDigest(input: unknown): string {
  const record = requireRecord(String((input as ContractRecord)?.schemaVersion), input);
  if (
    !["authority-node-inventory-empty-root/v1", "authority-node-inventory-root/v1"].includes(
      String(record.schemaVersion),
    )
  )
    throw new TypeError("inventory-root:schema");
  return digest("authority-node-inventory-root/v1", [
    raw(record.globalIdentityDigest as string),
    text(record.kind as string),
    decimalPart(record.count as string),
    raw(record.treeRootDigest as string),
    canonical(record),
  ]);
}

export function computeAuthorityHistoryEmptyRootDigestV2(input: unknown): string {
  const record = requireRecord("authority-history-empty-root/v2", input);
  return digest("authority-history-empty-root/v2", [
    raw(record.globalIdentityDigest as string),
    text(record.treeProfile as string),
    decimalPart(record.count as string),
    raw(record.treeRootDigest as string),
    text(record.nodeInventoryRootKind as string),
    raw(record.nodeInventoryRootDigest as string),
    decimalPart(record.nodeInventoryCount as string),
    canonical(record),
  ]);
}

export function computeAuthorityHistoryRootDigestV2(input: unknown): string {
  const record = requireRecord("authority-history-root/v2", input);
  return digest("authority-history-root/v2", [
    raw(record.globalIdentityDigest as string),
    text(record.treeProfile as string),
    decimalPart(record.count as string),
    raw(record.treeRootDigest as string),
    decimalPart(record.latestIncludedOrdinal as string),
    raw(record.latestEpochKey as string),
    raw(record.latestTipDigest as string),
    raw(record.latestValueDigest as string),
    raw(record.latestReceiptDigest as string),
    text(record.nodeInventoryRootKind as string),
    raw(record.nodeInventoryRootDigest as string),
    decimalPart(record.nodeInventoryCount as string),
    raw(record.nodeInventoryTreeRootDigest as string),
    canonical(record),
  ]);
}

export function computeAuthoritySuccessorCoreDigestV2(input: unknown): string {
  const record = requireRecord("state-mutation-authority-successor-core/v2", input);
  return digest("state-mutation-authority-successor-core/v2", [
    raw(record.globalIdentityDigest as string),
    raw(record.rotationId as string),
    raw(record.predecessorTipDigest as string),
    raw(record.predecessorValueDigest as string),
    raw(record.predecessorReceiptDigest as string),
    decimalPart(record.successorOrdinal as string),
    raw(record.selectedActiveReleaseTipDigest as string),
    raw(record.selectedActiveReleaseValueDigest as string),
    raw(record.selectedActiveReleaseReceiptDigest as string),
    raw(record.reviewedHelperDigest as string),
    raw(record.reviewedProfileDigest as string),
    raw(record.reviewedAbiDigest as string),
    raw(record.reviewedCustodyDigest as string),
    raw(record.successorHistoryRootDigest as string),
    raw(record.successorInventoryRootDigest as string),
    canonical(record),
  ]);
}

export function computeAuthorityAppendReceiptDigestV2(input: unknown): string {
  const record = requireRecord("authority-history-append-receipt/v2", input);
  return digest("authority-history-append-receipt/v2", [
    raw(record.globalIdentityDigest as string),
    raw(record.rotationId as string),
    raw(record.predecessorPathInstanceDigest as string),
    raw(record.predecessorTipDigest as string),
    raw(record.predecessorValueDigest as string),
    raw(record.predecessorReceiptDigest as string),
    text(record.priorRootKind as string),
    raw(record.priorRootDigest as string),
    decimalPart(record.priorCount as string),
    raw(record.appendedEpochKey as string),
    raw(record.leafDigest as string),
    raw(record.updateProofDigest as string),
    raw(record.materializationPlanDigest as string),
    raw(record.materializationStartedTipDigest as string),
    raw(record.materializationStartedValueDigest as string),
    raw(record.materializationStartedReceiptDigest as string),
    raw(record.inventoryBatchDigest as string),
    raw(record.successorInventoryRootDigest as string),
    decimalPart(record.successorInventoryCount as string),
    raw(record.successorInventoryTreeRootDigest as string),
    raw(record.successorRootDigest as string),
    decimalPart(record.successorCount as string),
    raw(record.successorCoreDigest as string),
    canonical(record),
  ]);
}

export function validateAuthorityValueV3Composition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "appendReceipt",
    "authorityValue",
    "historyRoot",
    "inventoryRoot",
    "successorCore",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const valueDefinition = v2Definitions["state-mutation-authority-value/v3"]!;
    const valueResult = validateAgainstSchema(valueDefinition, closed.value.authorityValue);
    if (!valueResult.ok) return valueResult.issues;
    const value = valueResult.value;
    const history = requireRecord(
      value.historyRootKind === "EMPTY"
        ? "authority-history-empty-root/v2"
        : "authority-history-root/v2",
      closed.value.historyRoot,
    );
    const inventory = requireRecord(
      value.nodeInventoryRootKind === "EMPTY"
        ? "authority-node-inventory-empty-root/v1"
        : "authority-node-inventory-root/v1",
      closed.value.inventoryRoot,
    );
    const historyDigest =
      value.historyRootKind === "EMPTY"
        ? computeAuthorityHistoryEmptyRootDigestV2(history)
        : computeAuthorityHistoryRootDigestV2(history);
    const inventoryDigest = computeAuthorityInventoryRootDigest(inventory);
    const issues: string[] = [];
    if (
      value.globalIdentityDigest !== history.globalIdentityDigest ||
      value.globalIdentityDigest !== inventory.globalIdentityDigest
    )
      issues.push("globalIdentityDigest:split");
    if (value.historyRootDigest !== historyDigest || value.historyCount !== history.count)
      issues.push("historyRoot:binding-mismatch");
    if (
      value.nodeInventoryRootDigest !== inventoryDigest ||
      value.nodeInventoryCount !== inventory.count ||
      value.nodeInventoryTreeRootDigest !== inventory.treeRootDigest
    )
      issues.push("nodeInventoryRoot:binding-mismatch");
    if (
      history.nodeInventoryRootDigest !== inventoryDigest ||
      history.nodeInventoryCount !== inventory.count ||
      (history.schemaVersion === "authority-history-root/v2" &&
        history.nodeInventoryTreeRootDigest !== inventory.treeRootDigest)
    )
      issues.push("historyRoot:inventory-binding-mismatch");
    if (value.rotationKind === "GENESIS") {
      if (closed.value.appendReceipt !== null || closed.value.successorCore !== null)
        issues.push("genesis:rotation-evidence-unexpected");
    } else {
      const append = requireRecord(
        "authority-history-append-receipt/v2",
        closed.value.appendReceipt,
      );
      const core = requireRecord(
        "state-mutation-authority-successor-core/v2",
        closed.value.successorCore,
      );
      if (
        append.globalIdentityDigest !== value.globalIdentityDigest ||
        core.globalIdentityDigest !== value.globalIdentityDigest ||
        append.predecessorTipDigest !== value.priorAuthorityTipDigest ||
        append.predecessorValueDigest !== value.priorAuthorityValueDigest ||
        append.predecessorReceiptDigest !== value.priorAuthorityReceiptDigest ||
        core.predecessorTipDigest !== value.priorAuthorityTipDigest ||
        core.predecessorValueDigest !== value.priorAuthorityValueDigest ||
        core.predecessorReceiptDigest !== value.priorAuthorityReceiptDigest ||
        core.successorOrdinal !== value.authorityOrdinal ||
        core.selectedActiveReleaseTipDigest !== value.activeReleaseTipDigest ||
        core.selectedActiveReleaseValueDigest !== value.activeReleaseValueDigest ||
        core.selectedActiveReleaseReceiptDigest !== value.activeReleaseReceiptDigest ||
        core.reviewedHelperDigest !== value.helperDigest ||
        core.reviewedProfileDigest !== value.helperProfileDigest ||
        core.reviewedCustodyDigest !== value.custodyReceiptDigest ||
        value.historyAppendReceiptDigest !== computeAuthorityAppendReceiptDigestV2(append) ||
        value.successorCoreDigest !== computeAuthoritySuccessorCoreDigestV2(core) ||
        append.successorRootDigest !== historyDigest ||
        append.successorCount !== history.count ||
        append.successorInventoryRootDigest !== inventoryDigest ||
        append.successorInventoryCount !== inventory.count ||
        append.successorInventoryTreeRootDigest !== inventory.treeRootDigest ||
        append.successorCoreDigest !== value.successorCoreDigest ||
        core.successorHistoryRootDigest !== historyDigest ||
        core.successorInventoryRootDigest !== inventoryDigest ||
        append.rotationId !== value.rotationId ||
        core.rotationId !== value.rotationId
      )
        issues.push("rotation:evidence-binding-mismatch");
    }
    return Object.freeze(issues.sort());
  } catch {
    return ["authority-value-v3:invalid"];
  }
}

export function computeAuthorityMaterializationPlanEntryDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-plan-entry/v1", input);
  const siblings = snapshotClosedArray(record.siblingDigests);
  if (!siblings.ok) throw new TypeError("siblingDigests:invalid");
  return digest("authority-node-materialization-plan-entry/v1", [
    raw(record.nodeDigest as string),
    text(record.nodePath as string),
    raw(record.nodeRecordDigest as string),
    raw(record.inventoryLeafDigest as string),
    text(record.membershipAction as string),
    raw(record.priorTreeRootDigest as string),
    decimalPart(record.priorCount as string),
    ...siblings.value.map((value) => raw(value as string)),
    raw(record.successorTreeRootDigest as string),
    decimalPart(record.successorCount as string),
    canonical(record),
  ]);
}

export function computeAuthorityFilesystemObservationDigest(input: unknown): string {
  const record = requireRecord("authority-node-filesystem-observation/v1", input);
  return digestRecord(
    "authority-node-filesystem-observation/v1",
    "authority-node-filesystem-observation/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.nodeDigest as string),
      text(record.nodePath as string),
      raw(record.nodeRecordDigest as string),
      raw(record.inventoryLeafDigest as string),
      text(record.filesystemDisposition as string),
      fixed(record.existed ? "01" : "00"),
      nullableRaw(record.observedBytesDigest as string | null),
      nullableRaw(record.readbackDigest as string | null),
      raw(record.oldAuthorityTipDigest as string),
      raw(record.oldAuthorityValueDigest as string),
      raw(record.oldAuthorityReceiptDigest as string),
      text(record.observedAt as string),
    ],
  );
}

export function computeAuthorityInventoryUpdateEntryDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-update-entry/v1", input);
  const siblings = snapshotClosedArray(record.siblingDigests);
  if (!siblings.ok) throw new TypeError("siblingDigests:invalid");
  return digestRecord(
    "authority-node-inventory-update-entry/v1",
    "authority-node-inventory-update-entry/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.nodeDigest as string),
      raw(record.inventoryLeafDigest as string),
      text(record.membershipAction as string),
      raw(record.filesystemObservationDigest as string),
      raw(record.priorTreeRootDigest as string),
      decimalPart(record.priorCount as string),
      ...siblings.value.map((value) => raw(value as string)),
      raw(record.successorTreeRootDigest as string),
      decimalPart(record.successorCount as string),
    ],
  );
}

export function computeAuthorityMaterializationReceiptDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-receipt/v1", input);
  return digestRecord(
    "authority-node-materialization-receipt/v1",
    "authority-node-materialization-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.nodeDigest as string),
      text(record.nodePath as string),
      raw(record.nodeRecordDigest as string),
      raw(record.inventoryLeafDigest as string),
      raw(record.filesystemObservationDigest as string),
      raw(record.updateEntryDigest as string),
      text(record.createdAt as string),
      text(record.readbackAt as string),
    ],
  );
}

export function computeAuthorityMaterializationPlanDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-plan/v1", input);
  const entries = snapshotClosedArray(record.planEntryDigests);
  if (!entries.ok) throw new TypeError("planEntryDigests:invalid");
  return digestRecord(
    "authority-node-materialization-plan/v1",
    "authority-node-materialization-plan/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.oldAuthorityPathInstanceDigest as string),
      raw(record.oldAuthorityTipDigest as string),
      raw(record.oldAuthorityValueDigest as string),
      raw(record.oldAuthorityReceiptDigest as string),
      text(record.priorHistoryKind as string),
      raw(record.priorHistoryRootDigest as string),
      decimalPart(record.priorHistoryCount as string),
      raw(record.priorHistoryTreeRootDigest as string),
      raw(record.predecessorLeafDigest as string),
      raw(record.authorityUpdateProofDigest as string),
      text(record.priorInventoryKind as string),
      raw(record.priorInventoryRootDigest as string),
      decimalPart(record.priorInventoryCount as string),
      raw(record.priorInventoryTreeRootDigest as string),
      ...entries.value.map((value) => raw(value as string)),
      text(record.successorInventoryKind as string),
      raw(record.successorInventoryRootDigest as string),
      decimalPart(record.successorInventoryCount as string),
      raw(record.successorInventoryTreeRootDigest as string),
      decimalPart(record.successorHistoryCount as string),
      raw(record.successorHistoryTreeRootDigest as string),
      raw(record.successorLatestEpochKey as string),
      raw(record.successorLatestTipDigest as string),
      raw(record.successorLatestValueDigest as string),
      raw(record.successorLatestReceiptDigest as string),
      raw(record.reviewedSuccessorSubjectDigest as string),
      raw(record.activeReleaseTipDigest as string),
      raw(record.activeReleaseValueDigest as string),
      raw(record.activeReleaseReceiptDigest as string),
      raw(record.independentReviewDigest as string),
      decimalPart(record.successorOrdinal as string),
      text(record.recoveryPolicy as string),
    ],
  );
}

export function computeAuthorityInventoryBatchDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-batch-update/v1", input);
  const receipts = snapshotClosedArray(record.materializationReceiptDigests);
  const entries = snapshotClosedArray(record.updateEntryDigests);
  if (!receipts.ok || !entries.ok) throw new TypeError("batch:arrays-invalid");
  return digestRecord(
    "authority-node-inventory-batch-update/v1",
    "authority-node-inventory-batch-update/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.authorityUpdateProofDigest as string),
      text(record.priorInventoryKind as string),
      raw(record.priorInventoryRootDigest as string),
      decimalPart(record.priorInventoryCount as string),
      raw(record.priorInventoryTreeRootDigest as string),
      ...receipts.value.map((value) => raw(value as string)),
      ...entries.value.map((value) => raw(value as string)),
      text(record.successorInventoryKind as string),
      raw(record.successorInventoryRootDigest as string),
      decimalPart(record.successorInventoryCount as string),
      raw(record.successorInventoryTreeRootDigest as string),
    ],
  );
}

export function computeAuthorityCoordinatorPositionDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-run-position/v1", input);
  return digestRecord(
    "authority-node-materialization-run-position/v1",
    "authority-node-materialization-run-position/v1",
    record,
    [
      raw(record.authorityPathInstanceDigest as string),
      decimalPart(record.coordinatorOrdinal as string),
      text(record.lifecycle as string),
      nullableRaw(record.rotationId as string | null),
      nullableRaw(record.materializationPlanDigest as string | null),
      nullableRaw(record.phaseEvidenceDigest as string | null),
    ],
  );
}

export function computeAuthorityMaterializationStartDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-start-receipt/v1", input);
  return digestRecord(
    "authority-node-materialization-start-receipt/v1",
    "authority-node-materialization-start-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.preauthorizedTipDigest as string),
      raw(record.preauthorizedValueDigest as string),
      raw(record.preauthorizedReceiptDigest as string),
      raw(record.oldAuthorityTipDigest as string),
      raw(record.oldAuthorityValueDigest as string),
      raw(record.oldAuthorityReceiptDigest as string),
      text(record.startedAt as string),
    ],
  );
}

export function computeAuthorityRotationHandoffDigest(input: unknown): string {
  const record = requireRecord("authority-rotation-run-handoff-receipt/v1", input);
  return digestRecord(
    "authority-rotation-run-handoff-receipt/v1",
    "authority-rotation-run-handoff-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.targetAuthorityPathInstanceDigest as string),
      raw(record.oldAuthorityTipDigest as string),
      raw(record.oldAuthorityValueDigest as string),
      raw(record.oldAuthorityReceiptDigest as string),
      raw(record.casArmedSelectorTipDigest as string),
      raw(record.casArmedSelectorValueDigest as string),
      raw(record.casArmedSelectorReceiptDigest as string),
      raw(record.casArmedCoreDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.newAuthorityTipDigest as string),
      raw(record.newAuthorityValueDigest as string),
      raw(record.newAuthorityReceiptDigest as string),
      raw(record.targetValueReadbackDigest as string),
      raw(record.targetProposalReadbackDigest as string),
      raw(record.targetTipReadbackDigest as string),
      raw(record.lockProfileDigest as string),
      raw(record.custodyInstanceDigest as string),
      raw(record.custodyObservationDigest as string),
      text(record.observedAt as string),
    ],
  );
}

export function computeAuthorityMaterializationHandoffDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-handoff-receipt/v1", input);
  return digestRecord(
    "authority-node-materialization-handoff-receipt/v1",
    "authority-node-materialization-handoff-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.inventoryBatchDigest as string),
      raw(record.newAuthorityPathInstanceDigest as string),
      raw(record.newAuthorityTipDigest as string),
      raw(record.newAuthorityValueDigest as string),
      raw(record.newAuthorityReceiptDigest as string),
      raw(record.rotationHandoffReceiptDigest as string),
      raw(record.terminalResolutionDigest as string),
      raw(record.finalSelectorTipDigest as string),
      raw(record.finalSelectorValueDigest as string),
      raw(record.finalSelectorReceiptDigest as string),
      raw(record.finalValueReadbackDigest as string),
      raw(record.finalProposalReadbackDigest as string),
      raw(record.finalTipReadbackDigest as string),
      text(record.createdAt as string),
    ],
  );
}

export function computeAuthorityMaterializationFinishingDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-finishing/v1", input);
  return digestRecord(
    "authority-node-materialization-finishing/v1",
    "authority-node-materialization-finishing/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.startedTipDigest as string),
      raw(record.startedValueDigest as string),
      raw(record.startedReceiptDigest as string),
      raw(record.inventoryBatchDigest as string),
      raw(record.newAuthorityPathInstanceDigest as string),
      raw(record.newAuthorityTipDigest as string),
      raw(record.newAuthorityValueDigest as string),
      raw(record.newAuthorityReceiptDigest as string),
      raw(record.terminalResolutionDigest as string),
      raw(record.finalSelectorTipDigest as string),
      raw(record.finalSelectorValueDigest as string),
      raw(record.finalSelectorReceiptDigest as string),
      raw(record.rotationHandoffReceiptDigest as string),
      raw(record.materializationHandoffReceiptDigest as string),
    ],
  );
}

export function computeAuthorityMaterializationTerminalDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-terminal-receipt/v1", input);
  return digestRecord(
    "authority-node-materialization-terminal-receipt/v1",
    "authority-node-materialization-terminal-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.finishingTipDigest as string),
      raw(record.finishingValueDigest as string),
      raw(record.finishingReceiptDigest as string),
      raw(record.newAuthorityTipDigest as string),
      raw(record.newAuthorityValueDigest as string),
      raw(record.newAuthorityReceiptDigest as string),
      raw(record.finalValueReadbackDigest as string),
      raw(record.finalProposalReadbackDigest as string),
      raw(record.finalTipReadbackDigest as string),
      nullableRaw(record.censusTerminalDigest as string | null),
      text(record.completedAt as string),
    ],
  );
}

export function computeAuthorityMaterializationRevocationDigest(input: unknown): string {
  const record = requireRecord("authority-node-materialization-revocation-receipt/v1", input);
  return digestRecord(
    "authority-node-materialization-revocation-receipt/v1",
    "authority-node-materialization-revocation-receipt/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      raw(record.rotationId as string),
      raw(record.materializationPlanDigest as string),
      raw(record.preauthorizedTipDigest as string),
      raw(record.preauthorizedValueDigest as string),
      raw(record.preauthorizedReceiptDigest as string),
      raw(record.revocationEvidenceDigest as string),
      text(record.revokedAt as string),
    ],
  );
}

export function computeAuthorityCensusEntryDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-census-entry/v1", input);
  const siblings = snapshotClosedArray(record.siblingDigests);
  if (!siblings.ok) throw new TypeError("siblingDigests:invalid");
  return digestRecord(
    "authority-node-inventory-census-entry/v1",
    "authority-node-inventory-census-entry/v1",
    record,
    [
      decimalPart(record.globalEntryOrdinal as string),
      text(record.nodePath as string),
      canonical(record.node as JsonValue),
      raw(record.nodeDigest as string),
      raw(record.nodeRecordDigest as string),
      raw(record.inventoryLeafDigest as string),
      ...siblings.value.map((value) => raw(value as string)),
    ],
  );
}

export function computeAuthorityCensusPageDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-census-page-core/v1", input);
  const entries = snapshotClosedArray(record.entryDigests);
  if (!entries.ok) throw new TypeError("entryDigests:invalid");
  return digestRecord(
    "authority-node-inventory-census-page-core/v1",
    "authority-node-inventory-census-page/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      text(record.censusId as string),
      raw(record.authorityPathInstanceDigest as string),
      raw(record.authorityTipDigest as string),
      raw(record.authorityValueDigest as string),
      raw(record.authorityReceiptDigest as string),
      raw(record.historyRootDigest as string),
      text(record.inventoryKind as string),
      raw(record.inventoryRootDigest as string),
      decimalPart(record.inventoryCount as string),
      raw(record.inventoryTreeRootDigest as string),
      decimalPart(record.pageOrdinal as string),
      nullableRaw(record.priorPageDigest as string | null),
      record.priorCursor === null
        ? ({ type: "nullable-text", value: null } as FramePart)
        : ({ type: "nullable-text", value: record.priorCursor as string } as FramePart),
      nullableRaw(record.priorCensusDigest as string | null),
      decimalPart(record.priorCumulativeCount as string),
      ...entries.value.map((value) => raw(value as string)),
      raw(record.enumerationObservationDigest as string),
      record.successorCursor === null
        ? ({ type: "nullable-text", value: null } as FramePart)
        : ({ type: "nullable-text", value: record.successorCursor as string } as FramePart),
      decimalPart(record.successorCumulativeCount as string),
      fixed(record.exhausted ? "01" : "00"),
    ],
  );
}

export function computeAuthorityCensusChainDigest(
  pageDigest: string,
  count: string,
  cursor: string | null,
  priorDigest: string | null,
): string {
  return digest("authority-node-inventory-census-chain/v1", [
    fixed(priorDigest === null ? "00" : "01"),
    ...(priorDigest === null ? [] : [raw(priorDigest)]),
    raw(pageDigest),
    decimalPart(count),
    { type: "nullable-text", value: cursor },
  ]);
}

export function computeAuthorityCensusTerminalDigest(input: unknown): string {
  const record = requireRecord("authority-node-inventory-census-terminal-core/v1", input);
  return digestRecord(
    "authority-node-inventory-census-terminal-core/v1",
    "authority-node-inventory-census-terminal/v1",
    record,
    [
      raw(record.globalIdentityDigest as string),
      text(record.censusId as string),
      raw(record.authorityPathInstanceDigest as string),
      raw(record.authorityTipDigest as string),
      raw(record.authorityValueDigest as string),
      raw(record.authorityReceiptDigest as string),
      raw(record.historyRootDigest as string),
      text(record.inventoryKind as string),
      raw(record.inventoryRootDigest as string),
      decimalPart(record.inventoryCount as string),
      raw(record.inventoryTreeRootDigest as string),
      raw(record.firstPageDigest as string),
      raw(record.lastPageDigest as string),
      raw(record.lastCensusDigest as string),
      decimalPart(record.pageCount as string),
      decimalPart(record.cumulativeCount as string),
      raw(record.terminalEnumerationObservationDigest as string),
      text(record.completedAt as string),
    ],
  );
}

function same(record: ContractRecord, other: ContractRecord, names: readonly string[]): boolean {
  return names.every((name) => record[name] === other[name]);
}

function recomputeHistoryNodeDigest(node: unknown): { node: ContractRecord; digest: string } {
  const closed = snapshotClosedRecord(node, [
    "depth",
    "leftChildDigest",
    "nodeDigest",
    "recordPath",
    "rightChildDigest",
    "schemaVersion",
  ]);
  if (!closed.ok || closed.value.schemaVersion !== "authority-history-node/v1")
    throw new TypeError("node:invalid");
  const depth = Number(closed.value.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 255) throw new TypeError("node:depth");
  const nodeDigest = digest("authority-history-node/v1", [
    fixed(depth.toString(16).padStart(4, "0")),
    raw(closed.value.leftChildDigest as string),
    raw(closed.value.rightChildDigest as string),
  ]);
  const expectedPath = `installation/state-mutation-authority-history/nodes/${nodeDigest}.json`;
  if (closed.value.nodeDigest !== nodeDigest || closed.value.recordPath !== expectedPath)
    throw new TypeError("node:derived-binding");
  return { node: closed.value, digest: nodeDigest };
}

export function validateAuthorityMaterializationComposition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "batch",
    "observations",
    "plan",
    "planEntries",
    "receipts",
    "updateEntries",
  ]);
  if (!closed.ok) return closed.issues;
  const arrays = [
    closed.value.planEntries,
    closed.value.observations,
    closed.value.updateEntries,
    closed.value.receipts,
  ].map(snapshotClosedArray);
  if (arrays.some((result) => !result.ok)) return ["materialization:array-invalid"];
  try {
    const plan = requireRecord("authority-node-materialization-plan/v1", closed.value.plan);
    const batch = requireRecord("authority-node-inventory-batch-update/v1", closed.value.batch);
    const [planInputs = [], observationInputs = [], updateInputs = [], receiptInputs = []] =
      arrays.map((result) => (result.ok ? result.value : []));
    const planEntries = planInputs.map((value) =>
      requireRecord("authority-node-materialization-plan-entry/v1", value),
    );
    const observations = observationInputs.map((value) =>
      requireRecord("authority-node-filesystem-observation/v1", value),
    );
    const updates = updateInputs.map((value) =>
      requireRecord("authority-node-inventory-update-entry/v1", value),
    );
    const receipts = receiptInputs.map((value) =>
      requireRecord("authority-node-materialization-receipt/v1", value),
    );
    const issues: string[] = [];
    const planDigest = computeAuthorityMaterializationPlanDigest(plan);
    const planDigests = planEntries.map(computeAuthorityMaterializationPlanEntryDigest);
    if (JSON.stringify(plan.planEntryDigests) !== JSON.stringify(planDigests))
      issues.push("plan:entry-census-mismatch");
    if (
      [...planEntries].map((entry) => entry.nodeDigest as string).join("\0") !==
      [...planEntries]
        .map((entry) => entry.nodeDigest as string)
        .sort()
        .join("\0")
    )
      issues.push("plan:entries-not-sorted");
    if (
      planEntries.length === 0 ||
      planEntries.length !== observations.length ||
      planEntries.length !== updates.length ||
      planEntries.length !== receipts.length
    )
      issues.push("plan:row-count-mismatch");
    let intermediateRoot = plan.priorInventoryTreeRootDigest as string;
    let intermediateCount = plan.priorInventoryCount as string;
    for (const [index, entry] of planEntries.entries()) {
      if (
        entry.nodePath !==
        `installation/state-mutation-authority-history/nodes/${String(entry.nodeDigest)}.json`
      )
        issues.push(`${index}:node-path-not-canonical`);
      if (entry.priorTreeRootDigest !== intermediateRoot || entry.priorCount !== intermediateCount)
        issues.push(`${index}:intermediate-predecessor-mismatch`);
      intermediateRoot = entry.successorTreeRootDigest as string;
      intermediateCount = entry.successorCount as string;
    }
    if (
      intermediateRoot !== plan.successorInventoryTreeRootDigest ||
      intermediateCount !== plan.successorInventoryCount
    )
      issues.push("plan:terminal-inventory-tuple-mismatch");
    const priorInventoryRecord: ContractRecord = {
      schemaVersion:
        plan.priorInventoryKind === "EMPTY"
          ? "authority-node-inventory-empty-root/v1"
          : "authority-node-inventory-root/v1",
      globalIdentityDigest: plan.globalIdentityDigest!,
      kind: plan.priorInventoryKind!,
      count: plan.priorInventoryCount!,
      treeRootDigest: plan.priorInventoryTreeRootDigest!,
    };
    const successorInventoryRecord: ContractRecord = {
      schemaVersion: "authority-node-inventory-root/v1",
      globalIdentityDigest: plan.globalIdentityDigest!,
      kind: "NONEMPTY",
      count: plan.successorInventoryCount!,
      treeRootDigest: plan.successorInventoryTreeRootDigest!,
    };
    if (plan.priorInventoryRootDigest !== computeAuthorityInventoryRootDigest(priorInventoryRecord))
      issues.push("plan:prior-inventory-root-not-derived");
    if (
      plan.successorInventoryRootDigest !==
      computeAuthorityInventoryRootDigest(successorInventoryRecord)
    )
      issues.push("plan:successor-inventory-root-not-derived");
    const identityFields = [
      "globalIdentityDigest",
      "rotationId",
      "startedTipDigest",
      "startedValueDigest",
      "startedReceiptDigest",
    ];
    for (let index = 0; index < planEntries.length; index += 1) {
      const entry = planEntries[index]!;
      const observation = observations[index];
      const update = updates[index];
      const receipt = receipts[index];
      if (!observation || !update || !receipt) {
        issues.push(`${index}:missing-row`);
        continue;
      }
      if (!same(observation, update, identityFields) || !same(update, receipt, identityFields))
        issues.push(`${index}:identity-split`);
      if (
        [
          observation.materializationPlanDigest,
          update.materializationPlanDigest,
          receipt.materializationPlanDigest,
        ].some((value) => value !== planDigest)
      )
        issues.push(`${index}:plan-mismatch`);
      if (
        observation.oldAuthorityTipDigest !== plan.oldAuthorityTipDigest ||
        observation.oldAuthorityValueDigest !== plan.oldAuthorityValueDigest ||
        observation.oldAuthorityReceiptDigest !== plan.oldAuthorityReceiptDigest ||
        batch.startedTipDigest !== observation.startedTipDigest ||
        batch.startedValueDigest !== observation.startedValueDigest ||
        batch.startedReceiptDigest !== observation.startedReceiptDigest
      )
        issues.push(`${index}:started-old-authority-binding-mismatch`);
      const observationDigest = computeAuthorityFilesystemObservationDigest(observation);
      const updateDigest = computeAuthorityInventoryUpdateEntryDigest(update);
      if (
        update.filesystemObservationDigest !== observationDigest ||
        receipt.filesystemObservationDigest !== observationDigest ||
        receipt.updateEntryDigest !== updateDigest
      )
        issues.push(`${index}:observation-update-receipt-mismatch`);
      if (
        ![observation.nodeDigest, update.nodeDigest, receipt.nodeDigest].every(
          (value) => value === entry.nodeDigest,
        ) ||
        ![
          observation.inventoryLeafDigest,
          update.inventoryLeafDigest,
          receipt.inventoryLeafDigest,
        ].every((value) => value === entry.inventoryLeafDigest) ||
        observation.nodePath !== entry.nodePath ||
        receipt.nodePath !== entry.nodePath ||
        observation.nodeRecordDigest !== entry.nodeRecordDigest ||
        receipt.nodeRecordDigest !== entry.nodeRecordDigest
      )
        issues.push(`${index}:node-leaf-mismatch`);
      if (update.membershipAction !== entry.membershipAction)
        issues.push(`${index}:membership-action-mismatch`);
      if (
        observation.filesystemDisposition === "MISSING_SELECTED" ||
        observation.filesystemDisposition === "BYTES_CONFLICT"
      )
        issues.push(`${index}:blocking-filesystem-disposition`);
      if (
        entry.membershipAction === "ALREADY_MEMBER" &&
        observation.filesystemDisposition !== "READBACK_SAME"
      )
        issues.push(`${index}:already-member-without-readback`);
      if (
        receipt.recordPath !==
          authorityInventoryPaths.materialization(
            plan.rotationId as string,
            entry.nodeDigest as string,
          ) ||
        observation.recordPath !== undefined ||
        update.recordPath !== undefined
      )
        issues.push(`${index}:record-path-mismatch`);
    }
    const receiptDigests = receipts.map(computeAuthorityMaterializationReceiptDigest);
    const updateDigests = updates.map(computeAuthorityInventoryUpdateEntryDigest);
    if (
      JSON.stringify(batch.materializationReceiptDigests) !== JSON.stringify(receiptDigests) ||
      JSON.stringify(batch.updateEntryDigests) !== JSON.stringify(updateDigests)
    )
      issues.push("batch:census-mismatch");
    if (
      batch.materializationPlanDigest !== planDigest ||
      batch.authorityUpdateProofDigest !== plan.authorityUpdateProofDigest
    )
      issues.push("batch:plan-proof-mismatch");
    if (batch.recordPath !== authorityInventoryPaths.update(plan.rotationId as string))
      issues.push("batch:record-path-mismatch");
    for (const name of [
      "globalIdentityDigest",
      "rotationId",
      "priorInventoryKind",
      "priorInventoryRootDigest",
      "priorInventoryCount",
      "priorInventoryTreeRootDigest",
      "successorInventoryKind",
      "successorInventoryRootDigest",
      "successorInventoryCount",
      "successorInventoryTreeRootDigest",
    ])
      if (batch[name] !== plan[name]) issues.push(`batch:${name}:plan-mismatch`);
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["materialization:invalid"];
  }
}

export function validateAuthorityMaterializationAuthorityComposition(
  input: unknown,
): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "appendReceipt",
    "authorityLeaf",
    "authorityUpdateProof",
    "authorityValue",
    "historyRoot",
    "inventoryRoot",
    "materialization",
    "priorHistoryRoot",
    "reviewedSuccessorSubject",
    "rotationIdRecord",
    "successorCore",
  ]);
  if (!closed.ok) return closed.issues;
  const issues = [...validateAuthorityMaterializationComposition(closed.value.materialization)];
  try {
    const materialization = snapshotClosedRecord(closed.value.materialization, [
      "batch",
      "observations",
      "plan",
      "planEntries",
      "receipts",
      "updateEntries",
    ]);
    if (!materialization.ok) return materialization.issues;
    const plan = requireRecord(
      "authority-node-materialization-plan/v1",
      materialization.value.plan,
    );
    const batch = requireRecord(
      "authority-node-inventory-batch-update/v1",
      materialization.value.batch,
    );
    const append = requireRecord("authority-history-append-receipt/v2", closed.value.appendReceipt);
    const leafParsed = validateAgainstSchema(
      authorityHistoryLeafDefinition,
      closed.value.authorityLeaf,
    );
    const proofParsed = validateAgainstSchema(
      authorityHistoryUpdateProofDefinition,
      closed.value.authorityUpdateProof,
    );
    if (!leafParsed.ok || !proofParsed.ok)
      return ["materialization-authority:update-proof-invalid"];
    const leaf = leafParsed.value;
    const proof = proofParsed.value;
    const history = requireRecord("authority-history-root/v2", closed.value.historyRoot);
    const priorHistory = requireRecord(
      proof.priorRootKind === "EMPTY"
        ? "authority-history-empty-root/v2"
        : "authority-history-root/v2",
      closed.value.priorHistoryRoot,
    );
    const inventory = requireRecord("authority-node-inventory-root/v1", closed.value.inventoryRoot);
    const authority = validateAgainstSchema(
      v2Definitions["state-mutation-authority-value/v3"]!,
      closed.value.authorityValue,
    );
    const core = requireRecord(
      "state-mutation-authority-successor-core/v2",
      closed.value.successorCore,
    );
    const rotationIdRecord = requireRecord(
      "state-mutation-authority-rotation-id/v2",
      closed.value.rotationIdRecord,
    );
    const reviewedSubject = snapshotClosedRecord(closed.value.reviewedSuccessorSubject, [
      "activeReleaseReceiptDigest",
      "activeReleaseTipDigest",
      "activeReleaseValueDigest",
      "independentReviewDigest",
      "reviewedAbiDigest",
      "reviewedCustodyDigest",
      "reviewedHelperDigest",
      "reviewedProfileDigest",
    ]);
    if (!reviewedSubject.ok) return reviewedSubject.issues;
    if (!authority.ok) return authority.issues;
    issues.push(
      ...validateAuthorityValueV3Composition({
        appendReceipt: append,
        authorityValue: authority.value,
        historyRoot: history,
        inventoryRoot: inventory,
        successorCore: core,
      }),
    );
    const planDigest = computeAuthorityMaterializationPlanDigest(plan);
    const batchDigest = computeAuthorityInventoryBatchDigest(batch);
    const historyDigest = computeAuthorityHistoryRootDigestV2(history);
    const priorHistoryDigest =
      proof.priorRootKind === "EMPTY"
        ? computeAuthorityHistoryEmptyRootDigestV2(priorHistory)
        : computeAuthorityHistoryRootDigestV2(priorHistory);
    const inventoryDigest = computeAuthorityInventoryRootDigest(inventory);
    const epochKey = digest("authority-epoch-key/v1", [
      raw(leaf.globalIdentityDigest as string),
      raw(leaf.authorityPathInstanceDigest as string),
      raw(leaf.authorityTipDigest as string),
      raw(leaf.authorityValueDigest as string),
      raw(leaf.authorityReceiptDigest as string),
    ]);
    const leafDigest = computeHistoryLeafDigest(leaf);
    const derivedNodes = deriveAuthorityUpdateNodeCensus({
      leaf,
      updateProof: proof,
    });
    const actualPlanEntriesSnapshot = snapshotClosedArray(materialization.value.planEntries);
    if (!actualPlanEntriesSnapshot.ok)
      return ["materialization-authority:plan-entry-array-invalid"];
    const actualPlanEntries = actualPlanEntriesSnapshot.value.map((entry) =>
      requireRecord("authority-node-materialization-plan-entry/v1", entry),
    );
    const reviewedSubjectDigest = canonicalDigest(reviewedSubject.value);
    const proofSiblings = proof.siblingDigests as readonly string[];
    if (
      leaf.epochKey !== epochKey ||
      leaf.globalIdentityDigest !== plan.globalIdentityDigest ||
      leaf.authorityPathInstanceDigest !== plan.oldAuthorityPathInstanceDigest ||
      leaf.authorityTipDigest !== plan.oldAuthorityTipDigest ||
      leaf.authorityValueDigest !== plan.oldAuthorityValueDigest ||
      leaf.authorityReceiptDigest !== plan.oldAuthorityReceiptDigest ||
      rotationIdRecord.globalIdentityDigest !== plan.globalIdentityDigest ||
      rotationIdRecord.oldAuthorityPathInstanceDigest !== plan.oldAuthorityPathInstanceDigest ||
      rotationIdRecord.oldAuthorityTipDigest !== plan.oldAuthorityTipDigest ||
      rotationIdRecord.oldAuthorityValueDigest !== plan.oldAuthorityValueDigest ||
      rotationIdRecord.oldAuthorityReceiptDigest !== plan.oldAuthorityReceiptDigest ||
      rotationIdRecord.successorOrdinal !== plan.successorOrdinal ||
      rotationIdRecord.independentReviewDigest !== plan.independentReviewDigest ||
      derivedNodes.length !== actualPlanEntries.length ||
      derivedNodes.some((derived, index) => {
        const actual = actualPlanEntries[index];
        return (
          !actual ||
          derived.nodeDigest !== actual.nodeDigest ||
          derived.nodePath !== actual.nodePath ||
          derived.nodeRecordDigest !== actual.nodeRecordDigest ||
          derived.inventoryLeafDigest !== actual.inventoryLeafDigest
        );
      }) ||
      computeAuthorityRotationIdV2(rotationIdRecord) !== plan.rotationId ||
      rotationIdRecord.reviewedSuccessorSubjectDigest !== reviewedSubjectDigest ||
      plan.reviewedSuccessorSubjectDigest !== reviewedSubjectDigest ||
      plan.independentReviewDigest !== reviewedSubject.value.independentReviewDigest ||
      plan.activeReleaseTipDigest !== reviewedSubject.value.activeReleaseTipDigest ||
      plan.activeReleaseValueDigest !== reviewedSubject.value.activeReleaseValueDigest ||
      plan.activeReleaseReceiptDigest !== reviewedSubject.value.activeReleaseReceiptDigest ||
      core.reviewedHelperDigest !== reviewedSubject.value.reviewedHelperDigest ||
      core.reviewedProfileDigest !== reviewedSubject.value.reviewedProfileDigest ||
      core.reviewedAbiDigest !== reviewedSubject.value.reviewedAbiDigest ||
      core.reviewedCustodyDigest !== reviewedSubject.value.reviewedCustodyDigest ||
      proof.globalIdentityDigest !== leaf.globalIdentityDigest ||
      proof.epochKey !== epochKey ||
      proof.leafDigest !== leafDigest ||
      proof.priorRootDigest !== priorHistoryDigest ||
      proof.successorRootDigest !== historyDigest ||
      proof.priorCount !== priorHistory.count ||
      proof.successorCount !== history.count ||
      incrementDecimal(proof.priorCount as string) !== proof.successorCount ||
      leaf.authorityOrdinal !== proof.priorCount ||
      plan.successorOrdinal !== proof.successorCount ||
      history.latestIncludedOrdinal !== leaf.authorityOrdinal ||
      history.latestEpochKey !== leaf.epochKey ||
      history.latestTipDigest !== leaf.authorityTipDigest ||
      history.latestValueDigest !== leaf.authorityValueDigest ||
      history.latestReceiptDigest !== leaf.authorityReceiptDigest ||
      computeHistorySparseRoot(epochKey, null, proofSiblings) !== priorHistory.treeRootDigest ||
      computeHistorySparseRoot(epochKey, leafDigest, proofSiblings) !== history.treeRootDigest ||
      append.appendedEpochKey !== epochKey ||
      append.leafDigest !== leafDigest ||
      append.updateProofDigest !== computeAuthorityUpdateProofDigestLocal(proof) ||
      plan.globalIdentityDigest !== append.globalIdentityDigest ||
      plan.globalIdentityDigest !== core.globalIdentityDigest ||
      plan.globalIdentityDigest !== authority.value.globalIdentityDigest ||
      plan.oldAuthorityPathInstanceDigest !== append.predecessorPathInstanceDigest ||
      plan.oldAuthorityTipDigest !== append.predecessorTipDigest ||
      plan.oldAuthorityValueDigest !== append.predecessorValueDigest ||
      plan.oldAuthorityReceiptDigest !== append.predecessorReceiptDigest ||
      plan.oldAuthorityTipDigest !== core.predecessorTipDigest ||
      plan.oldAuthorityValueDigest !== core.predecessorValueDigest ||
      plan.oldAuthorityReceiptDigest !== core.predecessorReceiptDigest ||
      plan.oldAuthorityTipDigest !== authority.value.priorAuthorityTipDigest ||
      plan.oldAuthorityValueDigest !== authority.value.priorAuthorityValueDigest ||
      plan.oldAuthorityReceiptDigest !== authority.value.priorAuthorityReceiptDigest ||
      plan.priorHistoryKind !== append.priorRootKind ||
      plan.priorHistoryRootDigest !== append.priorRootDigest ||
      plan.priorHistoryCount !== append.priorCount ||
      plan.priorHistoryTreeRootDigest !== priorHistory.treeRootDigest ||
      plan.priorInventoryKind !== priorHistory.nodeInventoryRootKind ||
      plan.priorInventoryRootDigest !== priorHistory.nodeInventoryRootDigest ||
      plan.priorInventoryCount !== priorHistory.nodeInventoryCount ||
      (priorHistory.schemaVersion === "authority-history-root/v2" &&
        plan.priorInventoryTreeRootDigest !== priorHistory.nodeInventoryTreeRootDigest) ||
      plan.predecessorLeafDigest !== append.leafDigest ||
      plan.authorityUpdateProofDigest !== append.updateProofDigest ||
      append.materializationPlanDigest !== planDigest ||
      append.inventoryBatchDigest !== batchDigest ||
      append.materializationStartedTipDigest !== batch.startedTipDigest ||
      append.materializationStartedValueDigest !== batch.startedValueDigest ||
      append.materializationStartedReceiptDigest !== batch.startedReceiptDigest ||
      append.successorRootDigest !== historyDigest ||
      append.successorInventoryRootDigest !== inventoryDigest ||
      plan.successorHistoryCount !== history.count ||
      plan.successorHistoryTreeRootDigest !== history.treeRootDigest ||
      plan.successorLatestEpochKey !== history.latestEpochKey ||
      plan.successorLatestTipDigest !== history.latestTipDigest ||
      plan.successorLatestValueDigest !== history.latestValueDigest ||
      plan.successorLatestReceiptDigest !== history.latestReceiptDigest ||
      plan.successorHistoryCount !== append.successorCount ||
      plan.successorInventoryRootDigest !== inventoryDigest ||
      plan.successorInventoryCount !== inventory.count ||
      plan.successorInventoryTreeRootDigest !== inventory.treeRootDigest ||
      authority.value.rotationId !== plan.rotationId ||
      core.rotationId !== plan.rotationId ||
      authority.value.authorityOrdinal !== plan.successorOrdinal ||
      core.successorOrdinal !== plan.successorOrdinal ||
      plan.activeReleaseTipDigest !== core.selectedActiveReleaseTipDigest ||
      plan.activeReleaseValueDigest !== core.selectedActiveReleaseValueDigest ||
      plan.activeReleaseReceiptDigest !== core.selectedActiveReleaseReceiptDigest
    )
      issues.push("materialization-authority:cross-binding-mismatch");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["materialization-authority:invalid"];
  }
}

export function validateAuthorityCoordinatorTransition(
  previous: unknown,
  next: unknown,
): readonly string[] {
  try {
    const prior = previous === null ? null : (previous as ContractRecord);
    const successor = next as ContractRecord;
    const definition = v2Definitions["authority-node-materialization-run-value/v1"]!;
    const priorParsed = prior === null ? null : validateAgainstSchema(definition, prior);
    const nextParsed = validateAgainstSchema(definition, successor);
    if ((priorParsed && !priorParsed.ok) || !nextParsed.ok) return ["coordinator:invalid"];
    const p = priorParsed?.ok ? priorParsed.value : null;
    const n = nextParsed.value;
    const edge = p === null ? `ABSENT>${n.lifecycle}` : `${p.lifecycle}>${n.lifecycle}`;
    const allowed = new Set([
      "ABSENT>IDLE",
      "IDLE>PREAUTHORIZED",
      "PREAUTHORIZED>STARTED",
      "PREAUTHORIZED>REVOKED_BEFORE_START",
      "STARTED>FINISHING",
      "FINISHING>TERMINAL",
      "TERMINAL>PREAUTHORIZED",
      "REVOKED_BEFORE_START>PREAUTHORIZED",
    ]);
    const issues: string[] = [];
    if (!allowed.has(edge)) issues.push("lifecycle:transition-refused");
    if (p) {
      if (BigInt(n.coordinatorOrdinal as string) !== BigInt(p.coordinatorOrdinal as string) + 1n)
        issues.push("coordinatorOrdinal:not-adjacent");
      for (const name of [
        "installationId",
        "projectId",
        "stateRootDigest",
        "globalIdentityDigest",
        "authorityPathInstanceDigest",
      ])
        if (p[name] !== n[name]) issues.push(`${name}:changed`);
      if (
        ["PREAUTHORIZED", "STARTED", "FINISHING"].includes(String(p.lifecycle)) &&
        p.rotationId !== n.rotationId
      )
        issues.push("rotationId:changed-mid-cycle");
      if (["PREAUTHORIZED", "STARTED", "FINISHING"].includes(String(p.lifecycle))) {
        for (const name of [
          "materializationPlanDigest",
          "predecessorTipDigest",
          "predecessorValueDigest",
          "predecessorReceiptDigest",
        ])
          if (p[name] !== n[name]) issues.push(`${name}:changed-mid-cycle`);
      }
      if (
        ["TERMINAL", "REVOKED_BEFORE_START"].includes(String(p.lifecycle)) &&
        n.lifecycle === "PREAUTHORIZED"
      ) {
        if (
          p.rotationId === n.rotationId ||
          p.materializationPlanDigest === n.materializationPlanDigest
        )
          issues.push("reset:plan-not-distinct");
      }
    }
    return Object.freeze(issues.sort());
  } catch {
    return ["coordinator:invalid"];
  }
}

export function validateAuthorityCoordinatorComposition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "currentSelection",
    "finishingEvidence",
    "materializationPlan",
    "previousSelection",
    "revocationReceipt",
    "startReceipt",
    "terminalReceipt",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const current = resolveSelectedPointerEvidence(closed.value.currentSelection);
    if (!current.ok) return current.issues.map((issue) => `current:${issue}`);
    if (current.value.tip.pointerKind !== "AUTHORITY_NODE_MATERIALIZATION_RUN")
      return ["current:pointer-kind"];
    const previous =
      closed.value.previousSelection === null
        ? null
        : resolveSelectedPointerEvidence(closed.value.previousSelection);
    if (previous && !previous.ok) return previous.issues.map((issue) => `previous:${issue}`);
    const p = previous?.ok ? previous.value : null;
    const value = current.value.value;
    const issues = [...validateAuthorityCoordinatorTransition(p?.value ?? null, value)];
    if (p) {
      if (
        current.value.proposal.priorTipDigest !== p.tipDigest ||
        current.value.proposal.priorValueDigest !== p.valueDigest ||
        current.value.proposal.priorReceiptDigest !== p.proposalReceiptDigest
      )
        issues.push("selected-predecessor:mismatch");
      const resetting =
        value.lifecycle === "PREAUTHORIZED" &&
        ["IDLE", "TERMINAL", "REVOKED_BEFORE_START"].includes(String(p.value.lifecycle));
      const expectedPredecessor = resetting
        ? [p.tipDigest, p.valueDigest, p.proposalReceiptDigest]
        : [
            p.value.predecessorTipDigest,
            p.value.predecessorValueDigest,
            p.value.predecessorReceiptDigest,
          ];
      if (
        value.predecessorTipDigest !== expectedPredecessor[0] ||
        value.predecessorValueDigest !== expectedPredecessor[1] ||
        value.predecessorReceiptDigest !== expectedPredecessor[2]
      )
        issues.push("value-predecessor:mismatch");
    } else if (
      current.value.proposal.priorTipDigest !== null ||
      current.value.proposal.priorValueDigest !== null ||
      current.value.proposal.priorReceiptDigest !== null
    )
      issues.push("genesis:non-null-prior");
    const plan =
      closed.value.materializationPlan === null
        ? null
        : requireRecord("authority-node-materialization-plan/v1", closed.value.materializationPlan);
    const planDigest = plan ? computeAuthorityMaterializationPlanDigest(plan) : null;
    if (value.lifecycle === "IDLE") {
      if (
        plan !== null ||
        closed.value.startReceipt !== null ||
        closed.value.finishingEvidence !== null ||
        closed.value.terminalReceipt !== null ||
        closed.value.revocationReceipt !== null
      )
        issues.push("idle:evidence-unexpected");
    } else {
      if (
        !plan ||
        value.materializationPlanDigest !== planDigest ||
        value.rotationId !== plan.rotationId ||
        value.globalIdentityDigest !== plan.globalIdentityDigest
      )
        issues.push("plan:value-binding-mismatch");
    }
    if (value.lifecycle === "PREAUTHORIZED" && value.phaseEvidenceDigest !== planDigest)
      issues.push("preauthorized:phase-evidence-mismatch");
    if (value.lifecycle === "STARTED") {
      const start = requireRecord(
        "authority-node-materialization-start-receipt/v1",
        closed.value.startReceipt,
      );
      const startDigest = computeAuthorityMaterializationStartDigest(start);
      if (
        !p ||
        start.globalIdentityDigest !== value.globalIdentityDigest ||
        start.preauthorizedTipDigest !== p.tipDigest ||
        start.preauthorizedValueDigest !== p.valueDigest ||
        start.preauthorizedReceiptDigest !== p.proposalReceiptDigest ||
        start.materializationPlanDigest !== planDigest ||
        start.rotationId !== value.rotationId ||
        start.oldAuthorityTipDigest !== plan?.oldAuthorityTipDigest ||
        start.oldAuthorityValueDigest !== plan?.oldAuthorityValueDigest ||
        start.oldAuthorityReceiptDigest !== plan?.oldAuthorityReceiptDigest ||
        value.phaseEvidenceDigest !== startDigest
      )
        issues.push("started:evidence-binding-mismatch");
    } else if (closed.value.startReceipt !== null) issues.push("startReceipt:unexpected");
    if (["FINISHING", "TERMINAL"].includes(String(value.lifecycle))) {
      const finishing = requireRecord(
        "authority-node-materialization-finishing/v1",
        closed.value.finishingEvidence,
      );
      const finishingDigest = computeAuthorityMaterializationFinishingDigest(finishing);
      if (
        !p ||
        finishing.globalIdentityDigest !== value.globalIdentityDigest ||
        finishing.rotationId !== value.rotationId ||
        finishing.materializationPlanDigest !== planDigest ||
        (value.lifecycle === "FINISHING" &&
          (finishing.startedTipDigest !== p.tipDigest ||
            finishing.startedValueDigest !== p.valueDigest ||
            finishing.startedReceiptDigest !== p.proposalReceiptDigest)) ||
        (value.lifecycle === "TERMINAL" && finishingDigest !== p.value.phaseEvidenceDigest) ||
        value.phaseEvidenceDigest !== finishingDigest ||
        value.inventoryBatchDigest !== finishing.inventoryBatchDigest ||
        value.successorAuthorityPathInstanceDigest !== finishing.newAuthorityPathInstanceDigest ||
        value.successorAuthorityTipDigest !== finishing.newAuthorityTipDigest ||
        value.successorAuthorityValueDigest !== finishing.newAuthorityValueDigest ||
        value.successorAuthorityReceiptDigest !== finishing.newAuthorityReceiptDigest ||
        value.authorityRunTerminalResolutionDigest !== finishing.terminalResolutionDigest ||
        value.authorityRunFinalSelectorTipDigest !== finishing.finalSelectorTipDigest ||
        value.authorityRunFinalSelectorValueDigest !== finishing.finalSelectorValueDigest ||
        value.authorityRunFinalSelectorReceiptDigest !== finishing.finalSelectorReceiptDigest ||
        value.materializationHandoffReceiptDigest !==
          finishing.materializationHandoffReceiptDigest ||
        value.rotationHandoffReceiptDigest !== finishing.rotationHandoffReceiptDigest
      )
        issues.push("finishing:evidence-binding-mismatch");
      if (value.lifecycle === "TERMINAL") {
        const terminal = requireRecord(
          "authority-node-materialization-terminal-receipt/v1",
          closed.value.terminalReceipt,
        );
        const terminalDigest = computeAuthorityMaterializationTerminalDigest(terminal);
        if (
          !p ||
          terminal.globalIdentityDigest !== value.globalIdentityDigest ||
          terminal.finishingTipDigest !== p.tipDigest ||
          terminal.finishingValueDigest !== p.valueDigest ||
          terminal.finishingReceiptDigest !== p.proposalReceiptDigest ||
          value.terminalReceiptDigest !== terminalDigest ||
          terminal.rotationId !== value.rotationId ||
          terminal.materializationPlanDigest !== planDigest ||
          terminal.newAuthorityTipDigest !== value.successorAuthorityTipDigest ||
          terminal.newAuthorityValueDigest !== value.successorAuthorityValueDigest ||
          terminal.newAuthorityReceiptDigest !== value.successorAuthorityReceiptDigest ||
          terminal.finalValueReadbackDigest !== value.successorAuthorityValueDigest ||
          terminal.finalProposalReadbackDigest !== value.successorAuthorityReceiptDigest ||
          terminal.finalTipReadbackDigest !== value.successorAuthorityTipDigest ||
          terminal.censusTerminalDigest !== value.censusTerminalDigest
        )
          issues.push("terminal:evidence-binding-mismatch");
      }
    } else if (closed.value.finishingEvidence !== null || closed.value.terminalReceipt !== null)
      issues.push("finishing-terminal:evidence-unexpected");
    if (value.lifecycle === "REVOKED_BEFORE_START") {
      const revocation = requireRecord(
        "authority-node-materialization-revocation-receipt/v1",
        closed.value.revocationReceipt,
      );
      const revocationDigest = computeAuthorityMaterializationRevocationDigest(revocation);
      if (
        !p ||
        revocation.globalIdentityDigest !== value.globalIdentityDigest ||
        revocation.rotationId !== value.rotationId ||
        revocation.materializationPlanDigest !== planDigest ||
        revocation.preauthorizedTipDigest !== p.tipDigest ||
        revocation.preauthorizedValueDigest !== p.valueDigest ||
        revocation.preauthorizedReceiptDigest !== p.proposalReceiptDigest ||
        value.phaseEvidenceDigest !== revocationDigest
      )
        issues.push("revocation:evidence-binding-mismatch");
    } else if (closed.value.revocationReceipt !== null) issues.push("revocationReceipt:unexpected");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["coordinator-composition:invalid"];
  }
}

export function validateAuthorityInventoryCensus(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["pages", "terminal"]);
  if (!closed.ok) return closed.issues;
  const pagesResult = snapshotClosedArray(closed.value.pages);
  if (!pagesResult.ok || pagesResult.value.length === 0) return ["pages:required"];
  try {
    const pages = pagesResult.value.map((value) =>
      requireRecord("authority-node-inventory-census-page/v1", value),
    );
    const terminalOuter = requireRecord(
      "authority-node-inventory-census-terminal/v1",
      closed.value.terminal,
    );
    const terminal = requireRecord(
      "authority-node-inventory-census-terminal-core/v1",
      terminalOuter.core,
    );
    const issues: string[] = [];
    let priorPage: string | null = null;
    let priorCensus: string | null = null;
    let priorCursor: string | null = null;
    let count = "0";
    let firstPage: string | null = null;
    let selectedTuple: ContractRecord | null = null;
    let previousNodePath: string | null = null;
    const seenNodeDigests = new Set<string>();
    const seenNodePaths = new Set<string>();
    for (const [index, page] of pages.entries()) {
      const core = requireRecord("authority-node-inventory-census-page-core/v1", page.core);
      const selectedInventoryRoot: ContractRecord = {
        schemaVersion:
          core.inventoryKind === "EMPTY"
            ? "authority-node-inventory-empty-root/v1"
            : "authority-node-inventory-root/v1",
        globalIdentityDigest: core.globalIdentityDigest!,
        kind: core.inventoryKind!,
        count: core.inventoryCount!,
        treeRootDigest: core.inventoryTreeRootDigest!,
      };
      if (core.inventoryRootDigest !== computeAuthorityInventoryRootDigest(selectedInventoryRoot))
        issues.push(`${index}:inventory-root-digest-mismatch`);
      const entries = snapshotClosedArray(core.entries);
      const entryDigests = snapshotClosedArray(core.entryDigests);
      if (!entries.ok || !entryDigests.ok) {
        issues.push(`${index}:entries-invalid`);
        continue;
      }
      const computedEntryDigests = entries.value.map(computeAuthorityCensusEntryDigest);
      if (JSON.stringify(computedEntryDigests) !== JSON.stringify(entryDigests.value))
        issues.push(`${index}:entry-digests-mismatch`);
      for (const [entryIndex, entryInput] of entries.value.entries()) {
        const entry = requireRecord("authority-node-inventory-census-entry/v1", entryInput);
        const recomputed = recomputeHistoryNodeDigest(entry.node);
        const nodeRecord: ContractRecord = {
          schemaVersion: "authority-history-node-record/v1",
          nodeDigest: recomputed.digest,
          node: recomputed.node,
          recordPath: recomputed.node.recordPath!,
        };
        const nodeRecordDigest = computeAuthorityNodeRecordDigest(nodeRecord);
        const leaf: ContractRecord = {
          schemaVersion: "authority-node-inventory-leaf/v1",
          nodeDigest: recomputed.digest,
          nodePath: recomputed.node.recordPath!,
          nodeRecordDigest,
          recordPath: authorityInventoryPaths.leaf(recomputed.digest),
        };
        const leafDigest = computeAuthorityInventoryLeafDigest(leaf);
        if (
          entry.nodeDigest !== recomputed.digest ||
          entry.nodePath !== recomputed.node.recordPath ||
          entry.nodeRecordDigest !== nodeRecordDigest ||
          entry.inventoryLeafDigest !== leafDigest
        )
          issues.push(`${index}:${entryIndex}:node-binding-mismatch`);
        if (
          (previousNodePath !== null && previousNodePath >= String(entry.nodePath)) ||
          seenNodeDigests.has(String(entry.nodeDigest)) ||
          seenNodePaths.has(String(entry.nodePath))
        )
          issues.push(`${index}:${entryIndex}:global-order-or-duplicate-mismatch`);
        previousNodePath = String(entry.nodePath);
        seenNodeDigests.add(String(entry.nodeDigest));
        seenNodePaths.add(String(entry.nodePath));
        if (
          computeAuthorityInventorySparseRoot(
            recomputed.digest,
            leafDigest,
            entry.siblingDigests as readonly string[],
          ) !== core.inventoryTreeRootDigest
        )
          issues.push(`${index}:${entryIndex}:membership-root-mismatch`);
        if (
          entry.globalEntryOrdinal !==
          (BigInt(core.priorCumulativeCount as string) + BigInt(entryIndex)).toString()
        )
          issues.push(`${index}:${entryIndex}:global-ordinal-mismatch`);
        if (entryIndex > 0) {
          const priorEntry = requireRecord(
            "authority-node-inventory-census-entry/v1",
            entries.value[entryIndex - 1],
          );
          if (String(priorEntry.nodePath) >= String(entry.nodePath))
            issues.push(`${index}:${entryIndex}:path-order-mismatch`);
        }
      }
      const pageDigest = computeAuthorityCensusPageDigest(core);
      const censusDigest = computeAuthorityCensusChainDigest(
        pageDigest,
        core.successorCumulativeCount as string,
        core.successorCursor as string | null,
        priorCensus,
      );
      if (page.pageDigest !== pageDigest || page.censusDigest !== censusDigest)
        issues.push(`${index}:page-chain-digest-mismatch`);
      if (
        page.recordPath !==
        authorityInventoryPaths.censusPage(
          core.authorityTipDigest as string,
          core.censusId as string,
          core.pageOrdinal as string,
          pageDigest,
        )
      )
        issues.push(`${index}:page-path-mismatch`);
      if (
        core.pageOrdinal !== String(index) ||
        core.priorPageDigest !== priorPage ||
        core.priorCensusDigest !== priorCensus ||
        core.priorCursor !== priorCursor ||
        core.priorCumulativeCount !== count
      )
        issues.push(`${index}:predecessor-mismatch`);
      const tupleFields = [
        "globalIdentityDigest",
        "censusId",
        "authorityPathInstanceDigest",
        "authorityTipDigest",
        "authorityValueDigest",
        "authorityReceiptDigest",
        "historyRootDigest",
        "inventoryKind",
        "inventoryRootDigest",
        "inventoryCount",
        "inventoryTreeRootDigest",
      ];
      if (selectedTuple === null) selectedTuple = core;
      else if (!same(core, selectedTuple, tupleFields))
        issues.push(`${index}:selected-tuple-changed`);
      if (
        core.successorCumulativeCount !==
        (BigInt(core.priorCumulativeCount as string) + BigInt(entries.value.length)).toString()
      )
        issues.push(`${index}:successor-count-mismatch`);
      if (
        index < pages.length - 1 &&
        (core.exhausted !== false || entries.value.length !== 256 || core.successorCursor === null)
      )
        issues.push(`${index}:nonterminal-shape`);
      if (index === pages.length - 1 && (core.exhausted !== true || core.successorCursor !== null))
        issues.push(`${index}:terminal-shape`);
      if (
        core.inventoryCount === "0" &&
        (index !== 0 ||
          pages.length !== 1 ||
          entries.value.length !== 0 ||
          core.successorCumulativeCount !== "0")
      )
        issues.push("zero-count:page0-mismatch");
      if (entries.value.length > 256) issues.push(`${index}:page-too-large`);
      if (entries.value.length > 0 && core.successorCursor !== null) {
        const lastEntry = requireRecord(
          "authority-node-inventory-census-entry/v1",
          entries.value.at(-1),
        );
        if (core.successorCursor !== lastEntry.nodePath)
          issues.push(`${index}:successor-cursor-mismatch`);
      }
      if (entries.value.length === 0 && index > 0) {
        const priorCore = requireRecord(
          "authority-node-inventory-census-page-core/v1",
          pages[index - 1]!.core,
        );
        const priorEntries = snapshotClosedArray(priorCore.entries);
        if (!priorEntries.ok || priorEntries.value.length !== 256 || !core.exhausted)
          issues.push(`${index}:empty-boundary-page-refused`);
      }
      firstPage ??= pageDigest;
      priorPage = pageDigest;
      priorCensus = censusDigest;
      priorCursor = core.successorCursor as string | null;
      count = core.successorCumulativeCount as string;
    }
    const finalCore = requireRecord(
      "authority-node-inventory-census-page-core/v1",
      pages.at(-1)!.core,
    );
    if (
      terminal.firstPageDigest !== firstPage ||
      terminal.lastPageDigest !== priorPage ||
      terminal.lastCensusDigest !== priorCensus ||
      terminal.pageCount !== String(pages.length) ||
      terminal.cumulativeCount !== count ||
      terminal.inventoryCount !== count ||
      terminal.terminalEnumerationObservationDigest !== finalCore.enumerationObservationDigest ||
      !same(terminal, finalCore, [
        "globalIdentityDigest",
        "censusId",
        "authorityPathInstanceDigest",
        "authorityTipDigest",
        "authorityValueDigest",
        "authorityReceiptDigest",
        "historyRootDigest",
        "inventoryKind",
        "inventoryRootDigest",
        "inventoryCount",
        "inventoryTreeRootDigest",
      ])
    )
      issues.push("terminal:chain-mismatch");
    const terminalDigest = computeAuthorityCensusTerminalDigest(terminal);
    if (
      terminalOuter.terminalDigest !== terminalDigest ||
      terminalOuter.recordPath !==
        authorityInventoryPaths.censusTerminal(
          terminal.authorityTipDigest as string,
          terminal.censusId as string,
          terminalDigest,
        )
    )
      issues.push("terminal:path-mismatch");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["census:invalid"];
  }
}

const RUN_STAGES = Object.freeze([
  "CURRENT_AUTHORITY_READ",
  "TARGET_RECONCILED",
  "VALUE_READBACK",
  "PROPOSAL_READBACK",
  "CURRENT_AUTHORITY_PRE_CAS_READ",
  "CAS_ARMED",
  "TARGET_POST_CAS_READBACK",
  "PROPOSAL_CLASSIFIED",
  "CURRENT_AUTHORITY_POST_CAS_READ",
]);

export function computeRunCheckpointCoreDigestV2(input: unknown): string {
  const record = requireRecord("pointer-mutation-run-checkpoint-core/v2", input);
  return digestRecord(
    "pointer-mutation-run-checkpoint-core/v2",
    "pointer-mutation-run-checkpoint-core/v2",
    record,
    [
      raw(record.globalIdentityDigest as string),
      text(record.pointerKind as string),
      text(record.canonicalPointerPath as string),
      raw(record.targetPathInstanceDigest as string),
      raw(record.targetMutationId as string),
      decimalPart(record.runOrdinal as string),
      decimalPart(record.checkpointOrdinal as string),
      raw(record.segmentDigest as string),
      raw(record.auditDigest as string),
      nullableRaw(record.priorSelectorTipDigest as string | null),
      nullableRaw(record.priorSelectorValueDigest as string | null),
      nullableRaw(record.priorSelectorReceiptDigest as string | null),
      nullableRaw(record.priorPostSelectionObservationDigest as string | null),
      text(record.epochPolicy as string),
      raw(record.producerAuthorityTipDigest as string),
      raw(record.producerAuthorityValueDigest as string),
      raw(record.producerAuthorityReceiptDigest as string),
      nullableRaw(record.materializationPlanDigest as string | null),
      nullableRaw(record.materializationStartedTipDigest as string | null),
      nullableRaw(record.materializationStartedValueDigest as string | null),
      nullableRaw(record.materializationStartedReceiptDigest as string | null),
      nullableRaw(record.rotationHandoffReceiptDigest as string | null),
      text(record.stage as string),
      text(record.phase as string),
      nullableRaw(record.terminalResolutionDigest as string | null),
    ],
  );
}

export function computeRunPostSelectionDigestV1(input: unknown): string {
  const parsed = validateAgainstSchema(runPostSelectionObservationDefinition, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return digest("pointer-mutation-run-selector-post-selection-observation/v1", [
    raw(record.checkpointCoreDigest as string),
    raw(record.selectorPathInstanceDigest as string),
    raw(record.selectorMutationId as string),
    raw(record.selectorValueDigest as string),
    raw(record.selectorReceiptDigest as string),
    raw(record.selectorTipDigest as string),
    raw(record.valueReadbackDigest as string),
    raw(record.proposalReadbackDigest as string),
    raw(record.tipReadbackDigest as string),
    canonical(record),
  ]);
}

export function computeRunSegmentDigestV1(input: unknown): string {
  const parsed = validateAgainstSchema(runSegmentDefinition, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return digest("pointer-mutation-run-segment/v1", [canonical(parsed.value)]);
}

export function computeRunAuditDigestV1(prior: string | null, segment: string): string {
  return digest("pointer-mutation-run-audit/v1", [
    fixed(prior === null ? "00" : "01"),
    ...(prior === null ? [] : [raw(prior)]),
    raw(segment),
  ]);
}

export function computeRunIdV2(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "authorityPathInstanceDigest",
    "authorityReceiptDigest",
    "authorityTipDigest",
    "authorityValueDigest",
    "globalIdentityDigest",
    "priorCheckpointDigest",
    "runOrdinal",
    "targetMutationId",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  return digest("pointer-mutation-run-id/v1", [
    raw(closed.value.globalIdentityDigest as string),
    raw(closed.value.targetMutationId as string),
    decimalPart(closed.value.runOrdinal as string),
    nullableRaw(closed.value.priorCheckpointDigest as string | null),
    raw(closed.value.authorityPathInstanceDigest as string),
    raw(closed.value.authorityTipDigest as string),
    raw(closed.value.authorityValueDigest as string),
    raw(closed.value.authorityReceiptDigest as string),
  ]);
}

function computeCommitResolutionDigestV1(input: unknown): string {
  const parsed = validateAgainstSchema(commitResolutionDefinition, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return digest("pointer-mutation-commit-resolution/v1", [canonical(parsed.value)]);
}

export function validateAuthorityCommitRunV3(input: unknown): readonly string[] {
  const parsed = validateAgainstSchema(
    inventoryDefinitions["pointer-mutation-commit-evidence/v3"]!,
    input,
  );
  if (!parsed.ok) return parsed.issues;
  const checkpointsResult = snapshotClosedArray(parsed.value.checkpoints);
  if (!checkpointsResult.ok || checkpointsResult.value.length !== 9) return ["checkpoints:length"];
  try {
    const checkpointEvidence = checkpointsResult.value.map((value) =>
      requireRecord("pointer-mutation-run-checkpoint-evidence/v2", value),
    );
    const checkpoints = checkpointEvidence.map((value) =>
      requireRecord("pointer-mutation-run-checkpoint-core/v2", value.core),
    );
    const intent = requireRecord("pointer-mutation-run-intent/v2", parsed.value.intent);
    const authority = resolveSelectedPointerEvidence(parsed.value.authoritySelection);
    if (!authority.ok) return authority.issues.map((issue) => `authority:${issue}`);
    const issues: string[] = [];
    const identityFields = [
      "globalIdentityDigest",
      "pointerKind",
      "canonicalPointerPath",
      "targetPathInstanceDigest",
      "targetMutationId",
      "runOrdinal",
      "epochPolicy",
    ];
    let priorSelector: SelectedPointerEvidence | null = null;
    let priorPostDigest: string | null = null;
    let priorAuditDigest: string | null = null;
    let runId: string | null = null;
    let terminalResolutionBytes: Uint8Array | null = null;
    for (let index = 0; index < checkpoints.length; index += 1) {
      const current = checkpoints[index]!;
      const envelope = checkpointEvidence[index]!;
      const segment = validateAgainstSchema(runSegmentDefinition, envelope.segment);
      if (!segment.ok) issues.push(`${index}:segment-invalid`);
      else {
        const segmentDigest = computeRunSegmentDigestV1(segment.value);
        const auditDigest = computeRunAuditDigestV1(priorAuditDigest, segmentDigest);
        const expectedRunId = digest("pointer-mutation-run-id/v1", [
          raw(intent.globalIdentityDigest as string),
          raw(intent.targetMutationId as string),
          decimalPart(current.runOrdinal as string),
          nullableRaw(intent.priorCheckpointDigest as string | null),
          raw(authority.value.pathInstanceDigest),
          raw(checkpoints[0]!.producerAuthorityTipDigest as string),
          raw(checkpoints[0]!.producerAuthorityValueDigest as string),
          raw(checkpoints[0]!.producerAuthorityReceiptDigest as string),
        ]);
        if (
          current.segmentDigest !== segmentDigest ||
          current.auditDigest !== auditDigest ||
          segment.value.runId !== expectedRunId ||
          (runId !== null && segment.value.runId !== runId) ||
          segment.value.stage !== current.stage ||
          segment.value.runOrdinal !== current.runOrdinal ||
          !same(segment.value, intent, [
            "globalIdentityDigest",
            "pointerKind",
            "canonicalPointerPath",
            "installationId",
            "projectId",
            "stateRootDigest",
            "transactionId",
            "sourceToken",
            "targetPathInstanceDigest",
            "targetMutationId",
          ])
        )
          issues.push(`${index}:segment-audit-binding-mismatch`);
        runId ??= String(segment.value.runId);
        priorAuditDigest = auditDigest;
      }
      if (index < 7) {
        if (envelope.terminalResolution !== null || current.terminalResolutionDigest !== null)
          issues.push(`${index}:terminal-resolution-unexpected`);
      } else {
        const resolution = validateAgainstSchema(
          commitResolutionDefinition,
          envelope.terminalResolution,
        );
        if (!resolution.ok) issues.push(`${index}:terminal-resolution-invalid`);
        else {
          const resolutionBytes = canonicalBytes(resolution.value);
          if (
            terminalResolutionBytes !== null &&
            Buffer.compare(Buffer.from(terminalResolutionBytes), Buffer.from(resolutionBytes)) !== 0
          )
            issues.push(`${index}:terminal-resolution-changed`);
          terminalResolutionBytes ??= resolutionBytes;
          const producerEpochKey = digest("authority-epoch-key/v1", [
            raw(intent.globalIdentityDigest as string),
            raw(authority.value.pathInstanceDigest),
            raw(current.producerAuthorityTipDigest as string),
            raw(current.producerAuthorityValueDigest as string),
            raw(current.producerAuthorityReceiptDigest as string),
          ]);
          let outcomeMismatch = false;
          if (parsed.value.outcome === "SELECTED") {
            const selected = resolveSelectedPointerEvidence(parsed.value.selectedTarget);
            outcomeMismatch =
              !selected.ok ||
              resolution.value.selectedTargetTipDigest !== selected.value.tipDigest ||
              resolution.value.outcomeEvidenceDigest !== selected.value.tipDigest ||
              resolution.value.conflictReceiptDigest !== null ||
              resolution.value.unknownEvidenceDigest !== null;
          } else if (parsed.value.outcome === "UNKNOWN_TERMINAL") {
            const unknownDigest = digest("pointer-mutation-unknown-evidence/v1", [
              canonical(parsed.value.unknownEvidence as JsonValue),
            ]);
            outcomeMismatch =
              resolution.value.selectedTargetTipDigest !== null ||
              resolution.value.conflictReceiptDigest !== null ||
              resolution.value.unknownEvidenceDigest !== unknownDigest ||
              resolution.value.outcomeEvidenceDigest !== unknownDigest;
          } else {
            outcomeMismatch =
              resolution.value.selectedTargetTipDigest !== null ||
              resolution.value.conflictReceiptDigest === null ||
              resolution.value.unknownEvidenceDigest !== null ||
              resolution.value.outcomeEvidenceDigest !== resolution.value.conflictReceiptDigest;
          }
          if (
            current.terminalResolutionDigest !==
              computeCommitResolutionDigestV1(resolution.value) ||
            resolution.value.targetPathInstanceDigest !== intent.targetPathInstanceDigest ||
            resolution.value.targetMutationId !== intent.targetMutationId ||
            resolution.value.outcome !== parsed.value.outcome ||
            resolution.value.producerEpochKey !== producerEpochKey ||
            outcomeMismatch
          )
            issues.push(`${index}:terminal-resolution-binding-mismatch`);
        }
      }
      const selector = resolveSelectedPointerEvidence(envelope.selectorSelection);
      if (!selector.ok) {
        issues.push(`${index}:selector-invalid`);
        continue;
      }
      if (
        selector.value.tip.pointerKind !== "POINTER_MUTATION_RUN_CURRENT" ||
        selector.value.value.schemaVersion !== "pointer-mutation-run-current-value/v2"
      )
        issues.push(`${index}:selector-family-version-mismatch`);
      if (
        selector.value.proposal.authorityEpochTipDigest !== current.producerAuthorityTipDigest ||
        selector.value.proposal.authorityEpochValueDigest !==
          current.producerAuthorityValueDigest ||
        selector.value.proposal.authorityEpochReceiptDigest !==
          current.producerAuthorityReceiptDigest
      )
        issues.push(`${index}:selector-producer-epoch-mismatch`);
      const coreDigest = computeRunCheckpointCoreDigestV2(current);
      if (
        selector.value.value.checkpointCoreDigest !== coreDigest ||
        selector.value.value.checkpointOrdinal !== current.checkpointOrdinal ||
        selector.value.value.runOrdinal !== current.runOrdinal ||
        selector.value.value.stage !== current.stage ||
        selector.value.value.phase !== current.phase ||
        selector.value.value.targetPathInstanceDigest !== current.targetPathInstanceDigest ||
        selector.value.value.targetMutationId !== current.targetMutationId ||
        selector.value.value.globalIdentityDigest !== current.globalIdentityDigest ||
        selector.value.value.epochPolicy !== current.epochPolicy ||
        selector.value.value.producerAuthorityTipDigest !== current.producerAuthorityTipDigest ||
        selector.value.value.producerAuthorityValueDigest !==
          current.producerAuthorityValueDigest ||
        selector.value.value.producerAuthorityReceiptDigest !==
          current.producerAuthorityReceiptDigest ||
        selector.value.value.materializationPlanDigest !== current.materializationPlanDigest ||
        selector.value.value.materializationStartedTipDigest !==
          current.materializationStartedTipDigest ||
        selector.value.value.materializationStartedValueDigest !==
          current.materializationStartedValueDigest ||
        selector.value.value.materializationStartedReceiptDigest !==
          current.materializationStartedReceiptDigest ||
        selector.value.value.rotationHandoffReceiptDigest !==
          current.rotationHandoffReceiptDigest ||
        selector.value.value.terminalResolutionDigest !== current.terminalResolutionDigest
      )
        issues.push(`${index}:selector-core-binding-mismatch`);
      if (
        current.priorSelectorTipDigest !== (priorSelector?.tipDigest ?? null) ||
        current.priorSelectorValueDigest !== (priorSelector?.valueDigest ?? null) ||
        current.priorSelectorReceiptDigest !== (priorSelector?.proposalReceiptDigest ?? null) ||
        current.priorPostSelectionObservationDigest !== priorPostDigest
      )
        issues.push(`${index}:selector-predecessor-mismatch`);
      const post = validateAgainstSchema(
        runPostSelectionObservationDefinition,
        envelope.postSelectionObservation,
      );
      if (!post.ok) issues.push(`${index}:post-invalid`);
      else {
        if (
          post.value.checkpointCoreDigest !== coreDigest ||
          post.value.selectorPathInstanceDigest !== selector.value.pathInstanceDigest ||
          post.value.selectorMutationId !== selector.value.proposal.mutationId ||
          post.value.selectorValueDigest !== selector.value.valueDigest ||
          post.value.selectorReceiptDigest !== selector.value.proposalReceiptDigest ||
          post.value.selectorTipDigest !== selector.value.tipDigest ||
          post.value.valueReadbackDigest !== selector.value.valueDigest ||
          post.value.proposalReadbackDigest !== selector.value.proposalReceiptDigest ||
          post.value.tipReadbackDigest !== selector.value.tipDigest
        )
          issues.push(`${index}:post-selector-binding-mismatch`);
        priorPostDigest = computeRunPostSelectionDigestV1(post.value);
      }
      priorSelector = selector.value;
      if (current.stage !== RUN_STAGES[index] || current.checkpointOrdinal !== String(index))
        issues.push(`${index}:stage-ordinal-mismatch`);
      const expectedPhase =
        index < 5 ? "CRASH_PREFIX" : index < 7 ? "CAS_AMBIGUOUS" : parsed.value.outcome;
      if (current.phase !== expectedPhase) issues.push(`${index}:phase-mismatch`);
      if (!same(current, checkpoints[0]!, identityFields)) issues.push(`${index}:identity-changed`);
    }
    const first = checkpoints[0]!;
    if (
      !same(intent, first, [
        "globalIdentityDigest",
        "pointerKind",
        "canonicalPointerPath",
        "targetPathInstanceDigest",
        "targetMutationId",
        "epochPolicy",
      ])
    )
      issues.push("intent:checkpoint-identity-mismatch");
    const rotation = intent.epochPolicy === "AUTHORITY_ROTATION_HANDOFF";
    if (rotation !== (intent.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"))
      issues.push("epochPolicy:pointer-kind-mismatch");
    if (rotation) {
      const oldEpoch = checkpoints[0]!;
      for (let index = 0; index <= 5; index += 1) {
        const checkpoint = checkpoints[index]!;
        if (
          checkpoint.materializationPlanDigest !== intent.materializationPlanDigest ||
          checkpoint.materializationStartedTipDigest !== intent.materializationStartedTipDigest ||
          checkpoint.materializationStartedValueDigest !==
            intent.materializationStartedValueDigest ||
          checkpoint.materializationStartedReceiptDigest !==
            intent.materializationStartedReceiptDigest ||
          checkpoint.rotationHandoffReceiptDigest !== null
        )
          issues.push(`${index}:rotation-pre-cas-evidence-mismatch`);
      }
      for (let index = 1; index <= 5; index += 1)
        if (
          !same(checkpoints[index]!, oldEpoch, [
            "producerAuthorityTipDigest",
            "producerAuthorityValueDigest",
            "producerAuthorityReceiptDigest",
          ])
        )
          issues.push(`${index}:old-epoch-drift`);
      const newEpoch = checkpoints[6]!;
      for (let index = 7; index <= 8; index += 1)
        if (
          !same(checkpoints[index]!, newEpoch, [
            "producerAuthorityTipDigest",
            "producerAuthorityValueDigest",
            "producerAuthorityReceiptDigest",
          ])
        )
          issues.push(`${index}:new-epoch-drift`);
      if (
        same(oldEpoch, newEpoch, [
          "producerAuthorityTipDigest",
          "producerAuthorityValueDigest",
          "producerAuthorityReceiptDigest",
        ])
      )
        issues.push("rotation:epoch-did-not-advance");
      const handoff = requireRecord(
        "authority-rotation-run-handoff-receipt/v1",
        parsed.value.rotationHandoffReceipt,
      );
      const materialization = requireRecord(
        "authority-node-materialization-handoff-receipt/v1",
        parsed.value.materializationHandoffReceipt,
      );
      const drh = computeAuthorityRotationHandoffDigest(handoff);
      const casArmedSelector = resolveSelectedPointerEvidence(
        checkpointEvidence[5]!.selectorSelection,
      );
      const finalSelector = resolveSelectedPointerEvidence(
        checkpointEvidence[8]!.selectorSelection,
      );
      if (
        handoff.globalIdentityDigest !== intent.globalIdentityDigest ||
        handoff.rotationId !== materialization.rotationId ||
        handoff.targetAuthorityPathInstanceDigest !== authority.value.pathInstanceDigest ||
        handoff.materializationPlanDigest !== intent.materializationPlanDigest ||
        handoff.oldAuthorityTipDigest !== oldEpoch.producerAuthorityTipDigest ||
        handoff.oldAuthorityValueDigest !== oldEpoch.producerAuthorityValueDigest ||
        handoff.oldAuthorityReceiptDigest !== oldEpoch.producerAuthorityReceiptDigest ||
        handoff.newAuthorityTipDigest !== newEpoch.producerAuthorityTipDigest ||
        handoff.newAuthorityValueDigest !== newEpoch.producerAuthorityValueDigest ||
        handoff.newAuthorityReceiptDigest !== newEpoch.producerAuthorityReceiptDigest ||
        checkpoints
          .slice(6)
          .some((checkpoint) => checkpoint.rotationHandoffReceiptDigest !== drh) ||
        !casArmedSelector.ok ||
        handoff.casArmedSelectorTipDigest !== casArmedSelector.value.tipDigest ||
        handoff.casArmedSelectorValueDigest !== casArmedSelector.value.valueDigest ||
        handoff.casArmedSelectorReceiptDigest !== casArmedSelector.value.proposalReceiptDigest ||
        handoff.casArmedCoreDigest !== computeRunCheckpointCoreDigestV2(checkpoints[5]!) ||
        handoff.startedTipDigest !== intent.materializationStartedTipDigest ||
        handoff.startedValueDigest !== intent.materializationStartedValueDigest ||
        handoff.startedReceiptDigest !== intent.materializationStartedReceiptDigest ||
        handoff.targetValueReadbackDigest !== handoff.newAuthorityValueDigest ||
        handoff.targetProposalReadbackDigest !== handoff.newAuthorityReceiptDigest ||
        handoff.targetTipReadbackDigest !== handoff.newAuthorityTipDigest
      )
        issues.push("rotationHandoff:binding-mismatch");
      if (
        materialization.globalIdentityDigest !== intent.globalIdentityDigest ||
        materialization.rotationId !== handoff.rotationId ||
        materialization.rotationHandoffReceiptDigest !== drh ||
        materialization.materializationPlanDigest !== intent.materializationPlanDigest ||
        materialization.startedTipDigest !== intent.materializationStartedTipDigest ||
        materialization.startedValueDigest !== intent.materializationStartedValueDigest ||
        materialization.startedReceiptDigest !== intent.materializationStartedReceiptDigest ||
        materialization.newAuthorityPathInstanceDigest !== authority.value.pathInstanceDigest ||
        materialization.newAuthorityTipDigest !== newEpoch.producerAuthorityTipDigest ||
        materialization.newAuthorityValueDigest !== newEpoch.producerAuthorityValueDigest ||
        materialization.newAuthorityReceiptDigest !== newEpoch.producerAuthorityReceiptDigest ||
        materialization.terminalResolutionDigest !== checkpoints[8]!.terminalResolutionDigest ||
        !finalSelector.ok ||
        materialization.finalSelectorTipDigest !== finalSelector.value.tipDigest ||
        materialization.finalSelectorValueDigest !== finalSelector.value.valueDigest ||
        materialization.finalSelectorReceiptDigest !== finalSelector.value.proposalReceiptDigest ||
        materialization.finalValueReadbackDigest !== finalSelector.value.valueDigest ||
        materialization.finalProposalReadbackDigest !== finalSelector.value.proposalReceiptDigest ||
        materialization.finalTipReadbackDigest !== finalSelector.value.tipDigest
      )
        issues.push("materializationHandoff:binding-mismatch");
      const finishing = resolveSelectedPointerEvidence(
        parsed.value.materializationFinishingSelection,
      );
      if (!finishing.ok) issues.push("materializationFinishingSelection:invalid");
      else if (
        finishing.value.tip.pointerKind !== "AUTHORITY_NODE_MATERIALIZATION_RUN" ||
        finishing.value.value.lifecycle !== "FINISHING" ||
        finishing.value.proposal.priorTipDigest !== intent.materializationStartedTipDigest ||
        finishing.value.proposal.priorValueDigest !== intent.materializationStartedValueDigest ||
        finishing.value.proposal.priorReceiptDigest !==
          intent.materializationStartedReceiptDigest ||
        finishing.value.value.globalIdentityDigest !== intent.globalIdentityDigest ||
        finishing.value.value.rotationId !== handoff.rotationId ||
        finishing.value.value.materializationPlanDigest !== intent.materializationPlanDigest ||
        finishing.value.value.inventoryBatchDigest !== materialization.inventoryBatchDigest ||
        finishing.value.value.successorAuthorityPathInstanceDigest !==
          materialization.newAuthorityPathInstanceDigest ||
        finishing.value.value.successorAuthorityTipDigest !==
          materialization.newAuthorityTipDigest ||
        finishing.value.value.successorAuthorityValueDigest !==
          materialization.newAuthorityValueDigest ||
        finishing.value.value.successorAuthorityReceiptDigest !==
          materialization.newAuthorityReceiptDigest ||
        finishing.value.value.authorityRunTerminalResolutionDigest !==
          materialization.terminalResolutionDigest ||
        finishing.value.value.authorityRunFinalSelectorTipDigest !==
          materialization.finalSelectorTipDigest ||
        finishing.value.value.authorityRunFinalSelectorValueDigest !==
          materialization.finalSelectorValueDigest ||
        finishing.value.value.authorityRunFinalSelectorReceiptDigest !==
          materialization.finalSelectorReceiptDigest ||
        finishing.value.value.materializationHandoffReceiptDigest !==
          computeAuthorityMaterializationHandoffDigest(materialization) ||
        finishing.value.value.rotationHandoffReceiptDigest !== drh ||
        finishing.value.value.phaseEvidenceDigest === null
      )
        issues.push("materializationFinishingSelection:binding-mismatch");
    } else if (
      parsed.value.rotationHandoffReceipt !== null ||
      parsed.value.materializationHandoffReceipt !== null ||
      parsed.value.materializationFinishingSelection !== null
    )
      issues.push("handoff:unexpected");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["commit-run-v3:invalid"];
  }
}

import { createHash } from "node:crypto";
import {
  canonicalBytes,
  snapshotClosedArray,
  snapshotClosedRecord,
  validateAgainstSchema,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
  type SchemaDefinition,
} from "./runtime.js";
import { framedBytes, v2Definitions, type FramePart } from "./v2.js";

const field = (kind: FieldRule["kind"], options: Omit<FieldRule, "kind"> = {}): FieldRule =>
  Object.freeze({ kind, ...options });
const enumeration = (...values: readonly string[]): FieldRule =>
  field("opaque", { values: Object.freeze([...values]) });
const nullable = (kind: FieldRule["kind"]): FieldRule => field(kind, { nullable: true });
const array = (kind: FieldRule["kind"]): FieldRule => field(kind, { array: true });
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
      define("authority-node-inventory-empty-root/v1", {
        globalIdentityDigest: sha,
        kind: enumeration("EMPTY"),
        count: enumeration("0"),
        treeRootDigest: sha,
      }),
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
            return record.existed === false && record.readbackDigest === record.nodeRecordDigest
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
        planEntryDigests: array("sha256"),
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
        materializationReceiptDigests: array("sha256"),
        updateEntryDigests: array("sha256"),
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
        entryDigests: array("sha256"),
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
      define("authority-history-empty-root/v2", {
        globalIdentityDigest: sha,
        treeProfile: enumeration("SPARSE_SHA256_256_V1"),
        count: enumeration("0"),
        treeRootDigest: sha,
        nodeInventoryRootKind: enumeration("EMPTY"),
        nodeInventoryRootDigest: sha,
        nodeInventoryCount: enumeration("0"),
      }),
      define("authority-history-root/v2", {
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
      }),
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
          pointerKind: field("opaque"),
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
          pointerKind: field("opaque"),
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
      }),
      define("pointer-evidence-slot/v3", {
        pointerKind: field("opaque"),
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
      history.nodeInventoryCount !== inventory.count
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
        value.historyAppendReceiptDigest !== computeAuthorityAppendReceiptDigestV2(append) ||
        value.successorCoreDigest !== computeAuthoritySuccessorCoreDigestV2(core) ||
        append.successorRootDigest !== historyDigest ||
        append.successorInventoryRootDigest !== inventoryDigest ||
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
  return digestRecord(
    "authority-node-materialization-run-position/v1",
    "authority-node-materialization-run-position/v1",
    input,
    [],
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
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["materialization:invalid"];
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
    }
    return Object.freeze(issues.sort());
  } catch {
    return ["coordinator:invalid"];
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
    for (const [index, page] of pages.entries()) {
      const core = requireRecord("authority-node-inventory-census-page-core/v1", page.core);
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
      if (
        index < pages.length - 1 &&
        (core.exhausted !== false || entries.value.length === 0 || core.successorCursor === null)
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

export function validateAuthorityCommitRunV3(input: unknown): readonly string[] {
  const parsed = validateAgainstSchema(
    inventoryDefinitions["pointer-mutation-commit-evidence/v3"]!,
    input,
  );
  if (!parsed.ok) return parsed.issues;
  const checkpointsResult = snapshotClosedArray(parsed.value.checkpoints);
  if (!checkpointsResult.ok || checkpointsResult.value.length !== 9) return ["checkpoints:length"];
  try {
    const checkpoints = checkpointsResult.value.map((value) =>
      requireRecord("pointer-mutation-run-checkpoint-core/v2", value),
    );
    const intent = requireRecord("pointer-mutation-run-intent/v2", parsed.value.intent);
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
    for (let index = 0; index < checkpoints.length; index += 1) {
      const current = checkpoints[index]!;
      if (current.stage !== RUN_STAGES[index] || current.checkpointOrdinal !== String(index))
        issues.push(`${index}:stage-ordinal-mismatch`);
      const expectedPhase =
        index < 5 ? "CRASH_PREFIX" : index < 7 ? "CAS_AMBIGUOUS" : parsed.value.outcome;
      if (current.phase !== expectedPhase) issues.push(`${index}:phase-mismatch`);
      if (!same(current, checkpoints[0]!, identityFields)) issues.push(`${index}:identity-changed`);
      if (index > 0 && current.priorSelectorTipDigest === null)
        issues.push(`${index}:prior-selector-missing`);
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
      if (
        handoff.materializationPlanDigest !== intent.materializationPlanDigest ||
        handoff.oldAuthorityTipDigest !== oldEpoch.producerAuthorityTipDigest ||
        handoff.oldAuthorityValueDigest !== oldEpoch.producerAuthorityValueDigest ||
        handoff.oldAuthorityReceiptDigest !== oldEpoch.producerAuthorityReceiptDigest ||
        handoff.newAuthorityTipDigest !== newEpoch.producerAuthorityTipDigest ||
        handoff.newAuthorityValueDigest !== newEpoch.producerAuthorityValueDigest ||
        handoff.newAuthorityReceiptDigest !== newEpoch.producerAuthorityReceiptDigest ||
        checkpoints[6]!.rotationHandoffReceiptDigest !== drh
      )
        issues.push("rotationHandoff:binding-mismatch");
      if (
        materialization.rotationHandoffReceiptDigest !== drh ||
        materialization.materializationPlanDigest !== intent.materializationPlanDigest ||
        materialization.terminalResolutionDigest !== checkpoints[8]!.terminalResolutionDigest
      )
        issues.push("materializationHandoff:binding-mismatch");
    } else if (
      parsed.value.rotationHandoffReceipt !== null ||
      parsed.value.materializationHandoffReceipt !== null
    )
      issues.push("handoff:unexpected");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["commit-run-v3:invalid"];
  }
}

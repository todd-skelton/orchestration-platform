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
const uuid = field("uuid-v7");
const timestamp = field("timestamp");
const decimal = field("decimal");
const path = field("relative-path");
const opaque = field("opaque");

function digest(domain: string, parts: readonly FramePart[]): string {
  return createHash("sha256").update(framedBytes(domain, parts)).digest("hex");
}
function safeSha(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError("digest:invalid");
  return value;
}
function safeUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new TypeError("uuid:invalid");
  return value;
}
function safeDecimal(value: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new TypeError("decimal:invalid");
  return value;
}
const text = (value: string): FramePart => ({ type: "text", value });
const raw = (value: string): FramePart => ({ type: "raw32", value });
const nullableRaw = (value: string | null): FramePart => ({ type: "nullable-raw32", value });
const fixed = (value: string): FramePart => ({ type: "raw-fixed", value });
const canonical = (value: JsonValue): FramePart => ({ type: "canonical", value });
const decimalPart = (value: string): FramePart => ({ type: "decimal-ascii", value });

function requireRecord(schemaVersion: string, input: unknown): ContractRecord {
  const definition = approvedDefinitions[schemaVersion] ?? v2Definitions[schemaVersion];
  if (!definition) throw new TypeError("schemaVersion:unsupported");
  const parsed = validateAgainstSchema(definition, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

function optionalTriple(record: ContractRecord, names: readonly string[]): readonly string[] {
  const count = names.filter((name) => record[name] !== null).length;
  return count === 0 || count === names.length ? [] : [`${names.join("+")}:partial-group`];
}

export function compareDecimalAscii(left: string, right: string): -1 | 0 | 1 {
  if (!/^(?:0|[1-9][0-9]*)$/.test(left) || !/^(?:0|[1-9][0-9]*)$/.test(right))
    throw new TypeError("decimal:invalid");
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function incrementDecimalAscii(value: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new TypeError("decimal:invalid");
  const digits = value.split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") {
      digits[index] = String(Number(digits[index]) + 1);
      return digits.join("");
    }
    digits[index] = "0";
  }
  return `1${digits.join("")}`;
}

const exactTriple = (record: ContractRecord, prefix: string): readonly string[] =>
  optionalTriple(record, [`${prefix}TipDigest`, `${prefix}ValueDigest`, `${prefix}ReceiptDigest`]);

export const approvedDefinitions: Readonly<Record<string, SchemaDefinition>> = Object.freeze(
  Object.fromEntries(
    [
      define("physical-destination-identity/v1", {
        stableNamespaceDigest: sha,
        os: enumeration("windows", "macos", "linux"),
        physicalVolumeDigest: sha,
        filesystemDigest: sha,
        ancestorObjectDigest: sha,
        leafIdentityKind: enumeration("EXISTING_OBJECT", "NONEXISTENT_LEAF"),
        canonicalPhysicalLeaf: field("json"),
      }),
      define("physical-destination-locator-observation-receipt/v1", {
        physicalDestinationDigest: sha,
        helperDigest: sha,
        helperVersion: field("semver"),
        logicalLocatorDigest: sha,
        resolvedLocatorReadbackDigest: sha,
        caseComparisonProfile: opaque,
        unicodeNormalizationProfile: opaque,
        custodyInstanceDigest: sha,
        custodyReceiptDigest: sha,
        nativeIdentityReadbackDigest: sha,
        disposition: enumeration("ADMITTED", "UNSUPPORTED", "UNKNOWN"),
        observedAt: timestamp,
        validUntil: timestamp,
      }),
      define("state-mutation-destination-owner-value/v1", {
        destinationDigest: sha,
        ownerOrdinal: decimal,
        lifecycle: enumeration("ACTIVE", "CONSUMED", "RETIRED"),
        installationId: uuid,
        bootstrapAnchorDigest: sha,
        successorReviewCoreDigest: nullableSha,
        selectedAt: timestamp,
      }),
      define(
        "state-mutation-destination-owner-cas-proposal/v1",
        {
          destinationDigest: sha,
          mutationId: sha,
          priorTipDigest: nullableSha,
          priorValueDigest: nullableSha,
          priorReceiptDigest: nullableSha,
          successorValueDigest: sha,
          transition: enumeration(
            "ACTIVATE_GENESIS",
            "CONSUME",
            "RETIRE_UNUSED",
            "RETIRE_CONSUMED",
            "ACTIVATE_SUCCESSOR",
          ),
          positionDigest: sha,
          proposedAt: timestamp,
        },
        (record) =>
          optionalTriple(record, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"]),
      ),
      define("state-mutation-destination-owner-current-tip/v1", {
        destinationDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
      }),
      define("state-mutation-destination-owner-conflict-receipt/v1", {
        destinationDigest: sha,
        mutationId: sha,
        losingReceiptDigest: sha,
        losingValueDigest: sha,
        winningTipDigest: sha,
        winningValueDigest: sha,
        winningReceiptDigest: sha,
        conflictAt: timestamp,
      }),
      define("state-mutation-destination-owner-successor-review-core/v1", {
        destinationDigest: sha,
        priorRetiredTipDigest: sha,
        priorRetiredValueDigest: sha,
        priorRetiredReceiptDigest: sha,
        teardownArchiveDigest: sha,
        priorInstallation: field("json"),
        successorInstallationId: uuid,
        successorAuthority: field("json"),
        independentReview: field("json"),
      }),
      define("state-mutation-destination-owner-successor-review-post-selection-receipt/v1", {
        reviewCoreDigest: sha,
        successorBootstrapAnchorDigest: sha,
        successorValueDigest: sha,
        successorReceiptDigest: sha,
        successorTipDigest: sha,
        valueReadbackDigest: sha,
        proposalReadbackDigest: sha,
        tipReadbackDigest: sha,
        lockCustodyObservationDigest: sha,
        observedAt: timestamp,
      }),
      define("state-mutation-bootstrap-anchor/v1", {
        globalBootstrapIdentityDigest: sha,
        installationId: uuid,
        projectId: uuid,
        destinationDigest: sha,
        destinationStateRootDigest: sha,
        custodyInstanceDigest: sha,
        bootstrapTransactionId: uuid,
        reviewedInstallerDigest: sha,
        independentReviewDigest: sha,
        operatorGrantDigest: sha,
        authorityPath: path,
        lockProfileDigest: sha,
        stateComponentProfileDigest: sha,
        helperDigest: sha,
        helperAbi: opaque,
        custodyReceiptDigest: sha,
        successorReviewCoreDigest: nullableSha,
      }),
      define("state-mutation-bootstrap-anchor-lifecycle-value/v1", {
        bootstrapAnchorDigest: sha,
        lifecycle: enumeration("ACTIVE", "CONSUMED", "RETIRED"),
        selectedAt: timestamp,
      }),
      define(
        "state-mutation-bootstrap-anchor-cas-proposal/v1",
        {
          bootstrapAnchorDigest: sha,
          mutationId: sha,
          priorTipDigest: nullableSha,
          priorValueDigest: nullableSha,
          priorReceiptDigest: nullableSha,
          successorValueDigest: sha,
          transition: enumeration("ACTIVATE", "CONSUME", "RETIRE"),
          proposedAt: timestamp,
        },
        (record) =>
          optionalTriple(record, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"]),
      ),
      define("state-mutation-bootstrap-anchor-current-tip/v1", {
        bootstrapAnchorDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
      }),
      define("state-mutation-bootstrap-anchor-conflict-receipt/v1", {
        bootstrapAnchorDigest: sha,
        mutationId: sha,
        losingReceiptDigest: sha,
        losingValueDigest: sha,
        winningTipDigest: sha,
        winningValueDigest: sha,
        winningReceiptDigest: sha,
        conflictAt: timestamp,
      }),
      define("state-mutation-bootstrap-anchor-use-intent/v1", {
        bootstrapAnchorDigest: sha,
        activeTipDigest: sha,
        activeValueDigest: sha,
        activeReceiptDigest: sha,
        bootstrapTransactionId: uuid,
        destinationStateRootDigest: sha,
        custodyInstanceDigest: sha,
        proposedGenesisInput: field("json"),
        expectedAuthorityValueDigest: sha,
        reviewedInstaller: field("json"),
        reviewedHelper: field("json"),
        startedAt: timestamp,
        expiresAt: timestamp,
      }),
      define("state-mutation-bootstrap-genesis-core/v1", {
        bootstrapAnchorDigest: sha,
        globalIdentityDigest: sha,
        transactionId: uuid,
        authorityPathInstanceDigest: sha,
        authorityValueDigest: sha,
        genesisPositionDigest: sha,
      }),
      define("state-mutation-bootstrap-genesis-post-selection-receipt/v1", {
        bootstrapAnchorDigest: sha,
        genesisCoreDigest: sha,
        authorityPathInstanceDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
        tipDigest: sha,
        valueReadbackDigest: sha,
        proposalReadbackDigest: sha,
        tipReadbackDigest: sha,
        observedAt: timestamp,
      }),
      define("state-mutation-bootstrap-anchor-consumption-receipt/v1", {
        bootstrapAnchorDigest: sha,
        genesisCoreDigest: sha,
        authorityPathInstanceDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
        tipDigest: sha,
        genesisPostSelectionReceiptDigest: sha,
        bootstrapTransactionId: uuid,
        useIntentDigest: sha,
        destinationStateRootDigest: sha,
        custodyInstanceDigest: sha,
        runtimeValueReadbackDigest: sha,
        runtimeProposalReadbackDigest: sha,
        runtimeTipReadbackDigest: sha,
        runtimePostReadbackDigest: sha,
        ownerActiveTipDigest: sha,
        ownerActiveValueDigest: sha,
        ownerActiveReceiptDigest: sha,
        ownerConsumedTipDigest: sha,
        ownerConsumedValueDigest: sha,
        ownerConsumedReceiptDigest: sha,
        externalAnchorValueReadbackDigest: sha,
        externalAnchorProposalReadbackDigest: sha,
        externalAnchorTipReadbackDigest: sha,
        externalRuntimeLockHelperCustodyDigest: sha,
        consumedAt: timestamp,
      }),
      define("state-mutation-bootstrap-anchor-teardown-receipt/v1", {
        bootstrapAnchorDigest: sha,
        priorTipDigest: sha,
        priorValueDigest: sha,
        priorReceiptDigest: sha,
        transition: enumeration("RETIRE"),
        destinationDigest: sha,
        ownerTipDigest: sha,
        ownerValueDigest: sha,
        ownerReceiptDigest: sha,
        teardownEvidenceDigest: sha,
        processCustodyProofDigest: sha,
        externalArchiveDigest: sha,
        retiredAt: timestamp,
      }),
      define("authority-history-leaf/v1", {
        globalIdentityDigest: sha,
        epochKey: sha,
        authorityOrdinal: decimal,
        authorityPathInstanceDigest: sha,
        authorityTipDigest: sha,
        authorityValueDigest: sha,
        authorityReceiptDigest: sha,
      }),
      define("state-mutation-global-identity/v1", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        custodyInstanceDigest: sha,
        authorityPath: path,
        authorityPathInstanceDigest: sha,
      }),
      define("authority-history-empty-root/v1", {
        globalIdentityDigest: sha,
        treeProfile: enumeration("SPARSE_SHA256_256_V1"),
        count: enumeration("0"),
        treeRootDigest: sha,
      }),
      define(
        "authority-history-root/v1",
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
        },
        (record) =>
          record.count === "0" ||
          incrementDecimalAscii(record.latestIncludedOrdinal as string) !== record.count
            ? ["count+latestIncludedOrdinal:mismatch"]
            : [],
      ),
      define(
        "authority-history-update-proof/v1",
        {
          globalIdentityDigest: sha,
          epochKey: sha,
          leafDigest: sha,
          priorRootKind: enumeration("EMPTY", "NONEMPTY"),
          priorRootDigest: sha,
          successorRootDigest: sha,
          priorCount: decimal,
          successorCount: decimal,
          siblingDigests: array("sha256"),
        },
        (record) =>
          Array.isArray(record.siblingDigests) && record.siblingDigests.length === 256
            ? []
            : ["siblingDigests:length"],
      ),
      define("authority-history-append-receipt/v1", {
        globalIdentityDigest: sha,
        rotationOperationId: sha,
        predecessorPathInstanceDigest: sha,
        predecessorTipDigest: sha,
        predecessorValueDigest: sha,
        predecessorReceiptDigest: sha,
        priorRootKind: enumeration("EMPTY", "NONEMPTY"),
        priorRootDigest: sha,
        priorCount: decimal,
        appendedEpochKey: sha,
        leafDigest: sha,
        updateProofDigest: sha,
        successorRootDigest: sha,
        successorCount: decimal,
        successorCoreDigest: sha,
        createdAt: timestamp,
      }),
      define("state-mutation-authority-successor-core/v1", {
        globalIdentityDigest: sha,
        rotationOperationId: sha,
        predecessorTipDigest: sha,
        predecessorValueDigest: sha,
        predecessorReceiptDigest: sha,
        successorOrdinal: decimal,
        selectedActiveReleaseDigest: sha,
        reviewedHelperDigest: sha,
        reviewedProfileDigest: sha,
        reviewedAbiDigest: sha,
        reviewedCustodyDigest: sha,
        successorHistoryRootDigest: sha,
      }),
      define(
        "pointer-mutation-run-intent/v1",
        {
          globalIdentityDigest: sha,
          targetPathInstanceDigest: sha,
          targetMutationId: sha,
          expectedPriorTipDigest: nullableSha,
          expectedPriorValueDigest: nullableSha,
          expectedPriorReceiptDigest: nullableSha,
          expectedSuccessorValueDigest: sha,
          createdAt: timestamp,
        },
        (record) => exactTriple(record, "expectedPrior"),
      ),
      define("pointer-mutation-run-segment/v1", {
        globalIdentityDigest: sha,
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
      }),
      define(
        "pointer-mutation-run-checkpoint-core/v1",
        {
          globalIdentityDigest: sha,
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
          ...((record.phase === "SELECTED" ||
            record.phase === "LOST_CONFLICT" ||
            record.phase === "UNKNOWN_TERMINAL") ===
          (record.terminalResolutionDigest !== null)
            ? []
            : ["terminalResolutionDigest:phase-mismatch"]),
        ],
      ),
      define("pointer-mutation-run-selector-post-selection-observation/v1", {
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
      }),
      define("pointer-mutation-commit-resolution/v1", {
        targetPathInstanceDigest: sha,
        targetMutationId: sha,
        outcome: enumeration("SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"),
        outcomeEvidenceDigest: sha,
        producerEpochKey: sha,
        resolvedAt: timestamp,
      }),
      define(
        "pointer-evidence-packet/v2",
        {
          purpose: enumeration("HISTORICAL_READ", "MUTATION_COMMIT"),
          globalIdentityDigest: sha,
          currentAuthorityTipDigest: sha,
          currentAuthorityValueDigest: sha,
          currentAuthorityReceiptDigest: sha,
          currentHistoryRootDigest: sha,
          currentCommitDigest: nullableSha,
          evidenceSlotDigests: array("sha256"),
          producerMembershipDigests: array("sha256"),
        },
        (record) =>
          (record.purpose === "HISTORICAL_READ") === (record.currentCommitDigest === null)
            ? []
            : ["purpose:current-commit-mismatch"],
      ),
    ].map((definition) => [definition.schemaVersion, definition]),
  ),
);

export const diagnosticAuthorityDefinitions: Readonly<Record<string, SchemaDefinition>> =
  Object.freeze(
    Object.fromEntries(
      [
        define("pointer-cas-proposal-receipt/v1", {
          pointerKind: opaque,
          pathInstanceDigest: sha,
          mutationId: sha,
          priorTipDigest: nullableSha,
          priorValueDigest: nullableSha,
          priorReceiptDigest: nullableSha,
          successorValueDigest: sha,
          positionDigest: sha,
          intent: opaque,
          outcome: opaque,
          authorityEpochTipDigest: sha,
          authorityEpochValueDigest: sha,
          authorityEpochReceiptDigest: sha,
          proposedAt: timestamp,
        }),
        define("state-mutation-authority-value/v1", {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          helperPath: path,
          helperDigest: sha,
          helperProfileDigest: sha,
          helperAbi: enumeration("portable-state-cas/v2"),
          lockPath: enumeration("installation/state-mutation.lock"),
          lockProfileDigest: sha,
          custodyPrincipalDigest: sha,
          custodyReceiptDigest: sha,
          handleInheritance: enumeration("DENY"),
          activeReleaseTipDigest: sha,
          activeReleaseValueDigest: sha,
          activeReleaseReceiptDigest: sha,
          priorAuthorityTipDigest: nullableSha,
          priorAuthorityValueDigest: nullableSha,
          priorAuthorityReceiptDigest: nullableSha,
          priorHelperDigest: nullableSha,
          priorHelperProfileDigest: nullableSha,
          priorHelperAbiDigest: nullableSha,
          priorCustodyReceiptDigest: nullableSha,
          rotationKind: enumeration("GENESIS", "ROTATION"),
          producerKind: enumeration("REVIEWED_BOOTSTRAP", "SELECTED_STABLE"),
          producerDigest: sha,
          producerExecutableDigest: sha,
          producerProfileDigest: sha,
          producerAbiDigest: sha,
          producerCustodyDigest: sha,
          selectedAt: timestamp,
        }),
      ].map((definition) => [definition.schemaVersion, definition]),
    ),
  );

export function computePhysicalDestinationDigest(input: unknown): string {
  const record = requireRecord("physical-destination-identity/v1", input);
  return digest("physical-destination-identity/v1", [
    raw(record.stableNamespaceDigest as string),
    text(record.os as string),
    raw(record.physicalVolumeDigest as string),
    raw(record.filesystemDigest as string),
    raw(record.ancestorObjectDigest as string),
    text(record.leafIdentityKind as string),
    canonical(record.canonicalPhysicalLeaf as string),
    canonical(record),
  ]);
}

export function computePhysicalObservationDigest(input: unknown): string {
  const record = requireRecord("physical-destination-locator-observation-receipt/v1", input);
  return digest("physical-destination-locator-observation-receipt/v1", [
    raw(record.physicalDestinationDigest as string),
    raw(record.helperDigest as string),
    text(record.helperVersion as string),
    raw(record.logicalLocatorDigest as string),
    raw(record.resolvedLocatorReadbackDigest as string),
    text(record.caseComparisonProfile as string),
    text(record.unicodeNormalizationProfile as string),
    raw(record.custodyInstanceDigest as string),
    raw(record.custodyReceiptDigest as string),
    raw(record.nativeIdentityReadbackDigest as string),
    text(record.disposition as string),
    canonical(record),
  ]);
}

export function computeDestinationDigest(physicalDestinationDigest: string): string {
  return digest("bootstrap-destination-identity/v2", [raw(physicalDestinationDigest)]);
}

export function computeDestinationOwnerValueDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-value/v1", input);
  return digest("destination-owner-value/v1", [
    raw(record.destinationDigest as string),
    decimalPart(record.ownerOrdinal as string),
    text(record.lifecycle as string),
    text(record.installationId as string),
    raw(record.bootstrapAnchorDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerProposalDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-cas-proposal/v1", input);
  return digest("destination-owner-receipt/v1", [
    raw(record.destinationDigest as string),
    raw(record.mutationId as string),
    nullableRaw(record.priorTipDigest as string | null),
    nullableRaw(record.priorValueDigest as string | null),
    nullableRaw(record.priorReceiptDigest as string | null),
    raw(record.successorValueDigest as string),
    text(record.transition as string),
    raw(record.positionDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerTipDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-current-tip/v1", input);
  return digest("destination-owner-tip/v1", [
    raw(record.destinationDigest as string),
    raw(record.valueDigest as string),
    raw(record.proposalReceiptDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerConflictDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-conflict-receipt/v1", input);
  return digest("destination-owner-conflict/v1", [
    raw(record.destinationDigest as string),
    raw(record.mutationId as string),
    raw(record.losingReceiptDigest as string),
    raw(record.losingValueDigest as string),
    raw(record.winningTipDigest as string),
    raw(record.winningValueDigest as string),
    raw(record.winningReceiptDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerMutationId(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "bootstrapAnchorDigest",
    "currentPath",
    "destinationDigest",
    "installationId",
    "ownerOrdinal",
    "priorReceiptDigest",
    "priorTipDigest",
    "priorValueDigest",
    "source",
    "successorValueDigest",
    "transition",
    "transitionEvidenceDigest",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const record = closed.value;
  return digest("destination-owner-mutation-id/v1", [
    raw(record.destinationDigest as string),
    text(record.currentPath as string),
    nullableRaw(record.priorTipDigest as string | null),
    nullableRaw(record.priorValueDigest as string | null),
    nullableRaw(record.priorReceiptDigest as string | null),
    decimalPart(record.ownerOrdinal as string),
    text(record.transition as string),
    raw(record.successorValueDigest as string),
    text(record.installationId as string),
    raw(record.bootstrapAnchorDigest as string),
    text(record.source as string),
    raw(record.transitionEvidenceDigest as string),
  ]);
}

export function computeDestinationSuccessorReviewCoreDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-successor-review-core/v1", input);
  return digest("destination-owner-successor-review-core/v1", [
    raw(record.destinationDigest as string),
    raw(record.priorRetiredTipDigest as string),
    raw(record.priorRetiredValueDigest as string),
    raw(record.priorRetiredReceiptDigest as string),
    raw(record.teardownArchiveDigest as string),
    canonical(record.priorInstallation!),
    text(record.successorInstallationId as string),
    canonical(record.successorAuthority!),
    canonical(record.independentReview!),
    canonical(record),
  ]);
}

export function computeDestinationSuccessorPostDigest(input: unknown): string {
  const record = requireRecord(
    "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
    input,
  );
  return digest("destination-owner-successor-review-post-selection-receipt/v1", [
    raw(record.reviewCoreDigest as string),
    raw(record.successorBootstrapAnchorDigest as string),
    raw(record.successorValueDigest as string),
    raw(record.successorReceiptDigest as string),
    raw(record.successorTipDigest as string),
    raw(record.valueReadbackDigest as string),
    raw(record.proposalReadbackDigest as string),
    raw(record.tipReadbackDigest as string),
    raw(record.lockCustodyObservationDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor/v1", input);
  return digest("state-mutation-bootstrap-anchor/v1", [
    raw(record.globalBootstrapIdentityDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorValueDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-lifecycle-value/v1", input);
  return digest("bootstrap-anchor-value/v1", [
    raw(record.bootstrapAnchorDigest as string),
    text(record.lifecycle as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorProposalDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-cas-proposal/v1", input);
  return digest("bootstrap-anchor-receipt/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.mutationId as string),
    nullableRaw(record.priorTipDigest as string | null),
    nullableRaw(record.priorValueDigest as string | null),
    nullableRaw(record.priorReceiptDigest as string | null),
    raw(record.successorValueDigest as string),
    text(record.transition as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorTipDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-current-tip/v1", input);
  return digest("bootstrap-anchor-tip/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.valueDigest as string),
    raw(record.proposalReceiptDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorConflictDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-conflict-receipt/v1", input);
  return digest("bootstrap-anchor-conflict/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.mutationId as string),
    raw(record.losingReceiptDigest as string),
    raw(record.losingValueDigest as string),
    raw(record.winningTipDigest as string),
    raw(record.winningValueDigest as string),
    raw(record.winningReceiptDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorUseIntentDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-use-intent/v1", input);
  return digest("bootstrap-anchor-use-intent/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.activeTipDigest as string),
    raw(record.activeValueDigest as string),
    raw(record.activeReceiptDigest as string),
    text(record.bootstrapTransactionId as string),
    raw(record.destinationStateRootDigest as string),
    raw(record.custodyInstanceDigest as string),
    canonical(record.proposedGenesisInput!),
    raw(record.expectedAuthorityValueDigest as string),
    canonical(record.reviewedInstaller!),
    canonical(record.reviewedHelper!),
    text(record.startedAt as string),
    text(record.expiresAt as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorConsumptionDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-consumption-receipt/v1", input);
  return digest("bootstrap-anchor-consumption-receipt/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.genesisCoreDigest as string),
    raw(record.authorityPathInstanceDigest as string),
    raw(record.valueDigest as string),
    raw(record.proposalReceiptDigest as string),
    raw(record.tipDigest as string),
    raw(record.genesisPostSelectionReceiptDigest as string),
    text(record.bootstrapTransactionId as string),
    raw(record.useIntentDigest as string),
    raw(record.destinationStateRootDigest as string),
    raw(record.custodyInstanceDigest as string),
    raw(record.runtimeValueReadbackDigest as string),
    raw(record.runtimeProposalReadbackDigest as string),
    raw(record.runtimeTipReadbackDigest as string),
    raw(record.runtimePostReadbackDigest as string),
    raw(record.ownerActiveTipDigest as string),
    raw(record.ownerActiveValueDigest as string),
    raw(record.ownerActiveReceiptDigest as string),
    raw(record.ownerConsumedTipDigest as string),
    raw(record.ownerConsumedValueDigest as string),
    raw(record.ownerConsumedReceiptDigest as string),
    raw(record.externalAnchorValueReadbackDigest as string),
    raw(record.externalAnchorProposalReadbackDigest as string),
    raw(record.externalAnchorTipReadbackDigest as string),
    raw(record.externalRuntimeLockHelperCustodyDigest as string),
    text(record.consumedAt as string),
    canonical(record),
  ]);
}

export function computeBootstrapAnchorTeardownDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-teardown-receipt/v1", input);
  return digest("bootstrap-anchor-teardown-receipt/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.priorTipDigest as string),
    raw(record.priorValueDigest as string),
    raw(record.priorReceiptDigest as string),
    text(record.transition as string),
    raw(record.destinationDigest as string),
    raw(record.ownerTipDigest as string),
    raw(record.ownerValueDigest as string),
    raw(record.ownerReceiptDigest as string),
    raw(record.teardownEvidenceDigest as string),
    raw(record.processCustodyProofDigest as string),
    raw(record.externalArchiveDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapGenesisCoreDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-genesis-core/v1", input);
  return digest("state-mutation-bootstrap-genesis-core/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.globalIdentityDigest as string),
    text(record.transactionId as string),
    raw(record.authorityPathInstanceDigest as string),
    raw(record.authorityValueDigest as string),
    raw(record.genesisPositionDigest as string),
    canonical(record),
  ]);
}

export function computeBootstrapGenesisPostDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-genesis-post-selection-receipt/v1", input);
  return digest("state-mutation-bootstrap-genesis-post-selection-receipt/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.genesisCoreDigest as string),
    raw(record.authorityPathInstanceDigest as string),
    raw(record.valueDigest as string),
    raw(record.proposalReceiptDigest as string),
    raw(record.tipDigest as string),
    raw(record.valueReadbackDigest as string),
    raw(record.proposalReadbackDigest as string),
    raw(record.tipReadbackDigest as string),
    canonical(record),
  ]);
}

export function validateDestinationOwnerTransition(
  previous: unknown,
  next: unknown,
): readonly string[] {
  let prior: ContractRecord | null;
  let successor: ContractRecord;
  try {
    prior =
      previous === null
        ? null
        : requireRecord("state-mutation-destination-owner-value/v1", previous);
    successor = requireRecord("state-mutation-destination-owner-value/v1", next);
  } catch {
    return ["destination-owner:invalid"];
  }
  const issues: string[] = [];
  const transition =
    prior === null ? "ABSENT>ACTIVE" : `${String(prior.lifecycle)}>${String(successor.lifecycle)}`;
  if (
    !new Set([
      "ABSENT>ACTIVE",
      "ACTIVE>CONSUMED",
      "ACTIVE>RETIRED",
      "CONSUMED>RETIRED",
      "RETIRED>ACTIVE",
    ]).has(transition)
  )
    issues.push("lifecycle:transition-refused");
  if (prior) {
    if (prior.destinationDigest !== successor.destinationDigest)
      issues.push("destinationDigest:changed");
    if (incrementDecimalAscii(prior.ownerOrdinal as string) !== successor.ownerOrdinal)
      issues.push("ownerOrdinal:not-adjacent");
    if (prior.lifecycle !== "RETIRED" && prior.installationId !== successor.installationId)
      issues.push("installationId:changed-before-retired");
    if (
      prior.lifecycle === "RETIRED" &&
      successor.lifecycle === "ACTIVE" &&
      successor.successorReviewCoreDigest === null
    )
      issues.push("successorReviewCoreDigest:missing");
  } else if (successor.ownerOrdinal !== "0" || successor.successorReviewCoreDigest !== null) {
    issues.push("genesis:mismatch");
  }
  return Object.freeze(issues.sort());
}

export function validateBootstrapAnchorTransition(
  previous: unknown,
  next: unknown,
): readonly string[] {
  try {
    const prior = requireRecord("state-mutation-bootstrap-anchor-lifecycle-value/v1", previous);
    const successor = requireRecord("state-mutation-bootstrap-anchor-lifecycle-value/v1", next);
    const issues: string[] = [];
    if (prior.bootstrapAnchorDigest !== successor.bootstrapAnchorDigest)
      issues.push("bootstrapAnchorDigest:changed");
    const edge = `${String(prior.lifecycle)}>${String(successor.lifecycle)}`;
    if (!new Set(["ACTIVE>CONSUMED", "ACTIVE>RETIRED", "CONSUMED>RETIRED"]).has(edge))
      issues.push("lifecycle:transition-refused");
    return Object.freeze(issues.sort());
  } catch {
    return ["bootstrap-anchor:invalid"];
  }
}

export function validateBootstrapGenesisGraph(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["anchor", "core", "post"]);
  if (!closed.ok) return closed.issues;
  try {
    const dba = computeBootstrapAnchorDigest(closed.value.anchor);
    const core = requireRecord("state-mutation-bootstrap-genesis-core/v1", closed.value.core);
    const post = requireRecord(
      "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
      closed.value.post,
    );
    const dbg = computeBootstrapGenesisCoreDigest(core);
    const issues: string[] = [];
    if (core.bootstrapAnchorDigest !== dba) issues.push("core:anchor-mismatch");
    if (post.bootstrapAnchorDigest !== dba || post.genesisCoreDigest !== dbg)
      issues.push("post:core-anchor-mismatch");
    if (
      post.authorityPathInstanceDigest !== core.authorityPathInstanceDigest ||
      post.valueDigest !== core.authorityValueDigest
    )
      issues.push("post:authority-mismatch");
    return Object.freeze(issues.sort());
  } catch {
    return ["bootstrap-genesis:invalid"];
  }
}

export function computeGlobalIdentityDigest(input: unknown): string {
  const closed = requireRecord("state-mutation-global-identity/v1", input);
  return digest("state-mutation-global-identity/v1", [
    text(closed.installationId as string),
    text(closed.projectId as string),
    raw(closed.stateRootDigest as string),
    raw(closed.custodyInstanceDigest as string),
    text(closed.authorityPath as string),
    raw(closed.authorityPathInstanceDigest as string),
  ]);
}

export function computeAuthorityEpochKey(input: {
  readonly globalIdentityDigest: string;
  readonly authorityPathInstanceDigest: string;
  readonly authorityTipDigest: string;
  readonly authorityValueDigest: string;
  readonly authorityReceiptDigest: string;
}): string {
  const closed = snapshotClosedRecord(input, [
    "authorityPathInstanceDigest",
    "authorityReceiptDigest",
    "authorityTipDigest",
    "authorityValueDigest",
    "globalIdentityDigest",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  return digest("authority-epoch-key/v1", [
    raw(closed.value.globalIdentityDigest as string),
    raw(closed.value.authorityPathInstanceDigest as string),
    raw(closed.value.authorityTipDigest as string),
    raw(closed.value.authorityValueDigest as string),
    raw(closed.value.authorityReceiptDigest as string),
  ]);
}

export function computeAuthorityRotationId(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "globalIdentityDigest",
    "predecessorOrdinal",
    "predecessorReceiptDigest",
    "predecessorTipDigest",
    "predecessorValueDigest",
    "reviewedAbiDigest",
    "reviewedCustodyDigest",
    "reviewedHelperDigest",
    "reviewedProfileDigest",
    "selectedActiveReleaseDigest",
    "successorOrdinal",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const record = closed.value;
  return digest("state-mutation-authority-rotation-id/v1", [
    raw(record.globalIdentityDigest as string),
    decimalPart(record.predecessorOrdinal as string),
    raw(record.predecessorTipDigest as string),
    raw(record.predecessorValueDigest as string),
    raw(record.predecessorReceiptDigest as string),
    decimalPart(record.successorOrdinal as string),
    raw(record.selectedActiveReleaseDigest as string),
    raw(record.reviewedHelperDigest as string),
    raw(record.reviewedProfileDigest as string),
    raw(record.reviewedAbiDigest as string),
    raw(record.reviewedCustodyDigest as string),
  ]);
}

export function computeAuthorityLeafDigest(input: unknown): string {
  const record = requireRecord("authority-history-leaf/v1", input);
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

export function computeAuthorityEmptyDigest(depth: number): string {
  if (!Number.isInteger(depth) || depth < 0 || depth > 256) throw new TypeError("depth:invalid");
  return digest("authority-history-empty/v1", [fixed(depth.toString(16).padStart(4, "0"))]);
}

export function computeAuthorityNodeDigest(depth: number, left: string, right: string): string {
  if (!Number.isInteger(depth) || depth < 0 || depth > 255) throw new TypeError("depth:invalid");
  return digest("authority-history-node/v1", [
    fixed(depth.toString(16).padStart(4, "0")),
    raw(left),
    raw(right),
  ]);
}

function keyBits(key: string): readonly number[] {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new TypeError("epochKey:invalid");
  return Object.freeze(
    [...Buffer.from(key, "hex")].flatMap((byte) =>
      Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1),
    ),
  );
}

export function computeSparseRoot(
  epochKey: string,
  leafDigest: string,
  siblingDigests: readonly string[],
): string {
  const siblings = snapshotClosedArray(siblingDigests);
  if (!siblings.ok || siblings.value.length !== 256) throw new TypeError("siblings:invalid");
  const bits = keyBits(epochKey);
  let current = leafDigest;
  for (let level = 0; level < 256; level += 1) {
    const sibling = siblings.value[level];
    if (typeof sibling !== "string" || !/^[0-9a-f]{64}$/.test(sibling))
      throw new TypeError("siblings:invalid");
    const depth = 255 - level;
    current =
      bits[depth] === 0
        ? computeAuthorityNodeDigest(depth, current, sibling)
        : computeAuthorityNodeDigest(depth, sibling, current);
  }
  return current;
}

export function computeSparseAbsentRoot(
  epochKey: string,
  siblingDigests: readonly string[],
): string {
  const siblings = snapshotClosedArray(siblingDigests);
  if (!siblings.ok || siblings.value.length !== 256) throw new TypeError("siblings:invalid");
  const bits = keyBits(epochKey);
  let current = computeAuthorityEmptyDigest(256);
  for (let level = 0; level < 256; level += 1) {
    const sibling = siblings.value[level];
    if (typeof sibling !== "string" || !/^[0-9a-f]{64}$/.test(sibling))
      throw new TypeError("siblings:invalid");
    const depth = 255 - level;
    if (
      current === computeAuthorityEmptyDigest(depth + 1) &&
      sibling === computeAuthorityEmptyDigest(depth + 1)
    ) {
      current = computeAuthorityEmptyDigest(depth);
    } else {
      current =
        bits[depth] === 0
          ? computeAuthorityNodeDigest(depth, current, sibling)
          : computeAuthorityNodeDigest(depth, sibling, current);
    }
  }
  return current;
}

export function computeAuthorityHistoryRootDigest(input: unknown): string {
  const record = requireRecord("authority-history-root/v1", input);
  return digest("authority-history-root/v1", [
    raw(record.globalIdentityDigest as string),
    text(record.treeProfile as string),
    decimalPart(record.count as string),
    raw(record.treeRootDigest as string),
    decimalPart(record.latestIncludedOrdinal as string),
    raw(record.latestEpochKey as string),
    raw(record.latestTipDigest as string),
    raw(record.latestValueDigest as string),
    raw(record.latestReceiptDigest as string),
    canonical(record),
  ]);
}

export function computeAuthorityEmptyRootDigest(input: unknown): string {
  const record = requireRecord("authority-history-empty-root/v1", input);
  if (record.treeRootDigest !== computeAuthorityEmptyDigest(0))
    throw new TypeError("treeRootDigest:not-deterministic-empty");
  return digest("authority-history-empty-root/v1", [
    raw(record.globalIdentityDigest as string),
    text(record.treeProfile as string),
    decimalPart("0"),
    raw(record.treeRootDigest as string),
    canonical(record),
  ]);
}

export function computeAuthorityUpdateProofDigest(input: unknown): string {
  const record = requireRecord("authority-history-update-proof/v1", input);
  return digest("authority-history-update-proof/v1", [
    raw(record.globalIdentityDigest as string),
    raw(record.epochKey as string),
    raw(record.leafDigest as string),
    text(record.priorRootKind as string),
    raw(record.priorRootDigest as string),
    raw(record.successorRootDigest as string),
    decimalPart(record.priorCount as string),
    decimalPart(record.successorCount as string),
    ...(record.siblingDigests as readonly string[]).map(raw),
    canonical(record),
  ]);
}

export function computeAuthorityAppendReceiptDigest(input: unknown): string {
  const record = requireRecord("authority-history-append-receipt/v1", input);
  return digest("authority-history-append-receipt/v1", [
    raw(record.globalIdentityDigest as string),
    raw(record.rotationOperationId as string),
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
    raw(record.successorRootDigest as string),
    decimalPart(record.successorCount as string),
    raw(record.successorCoreDigest as string),
    text(record.createdAt as string),
    canonical(record),
  ]);
}

export function computeAuthoritySuccessorCoreDigest(input: unknown): string {
  const record = requireRecord("state-mutation-authority-successor-core/v1", input);
  return digest("state-mutation-authority-successor-core/v1", [
    raw(record.globalIdentityDigest as string),
    raw(record.rotationOperationId as string),
    raw(record.predecessorTipDigest as string),
    raw(record.predecessorValueDigest as string),
    raw(record.predecessorReceiptDigest as string),
    decimalPart(record.successorOrdinal as string),
    raw(record.selectedActiveReleaseDigest as string),
    raw(record.reviewedHelperDigest as string),
    raw(record.reviewedProfileDigest as string),
    raw(record.reviewedAbiDigest as string),
    raw(record.reviewedCustodyDigest as string),
    raw(record.successorHistoryRootDigest as string),
    canonical(record),
  ]);
}

export function validateAuthoritySparseUpdate(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["leaf", "priorRoot", "proof", "successorRoot"]);
  if (!closed.ok) return closed.issues;
  try {
    const leaf = requireRecord("authority-history-leaf/v1", closed.value.leaf);
    const proof = requireRecord("authority-history-update-proof/v1", closed.value.proof);
    const priorKind = proof.priorRootKind as "EMPTY" | "NONEMPTY";
    const prior = requireRecord(
      priorKind === "EMPTY" ? "authority-history-empty-root/v1" : "authority-history-root/v1",
      closed.value.priorRoot,
    );
    const successor = requireRecord("authority-history-root/v1", closed.value.successorRoot);
    const issues: string[] = [];
    const de = computeAuthorityLeafDigest(leaf);
    const siblings = proof.siblingDigests as readonly string[];
    const emptyRoot = computeSparseAbsentRoot(leaf.epochKey as string, siblings);
    const presentRoot = computeSparseRoot(leaf.epochKey as string, de, siblings);
    const priorDigest =
      priorKind === "EMPTY"
        ? computeAuthorityEmptyRootDigest(prior)
        : computeAuthorityHistoryRootDigest(prior);
    const successorDh = computeAuthorityHistoryRootDigest(successor);
    for (const name of ["globalIdentityDigest", "epochKey"])
      if (proof[name] !== leaf[name]) issues.push(`${name}:mismatch`);
    if (proof.leafDigest !== de) issues.push("leafDigest:mismatch");
    if (proof.priorRootDigest !== priorDigest || prior.treeRootDigest !== emptyRoot)
      issues.push("priorRootDigest:mismatch");
    if (proof.successorRootDigest !== successorDh || successor.treeRootDigest !== presentRoot)
      issues.push("successorRootDigest:mismatch");
    if (proof.priorCount !== prior.count || proof.successorCount !== successor.count)
      issues.push("count:root-mismatch");
    if (incrementDecimalAscii(prior.count as string) !== successor.count)
      issues.push("count:not-adjacent");
    if ((priorKind === "EMPTY") !== (prior.count === "0"))
      issues.push("priorRootKind:count-mismatch");
    if (
      successor.latestEpochKey !== leaf.epochKey ||
      successor.latestIncludedOrdinal !== leaf.authorityOrdinal
    )
      issues.push("successor:latest-mismatch");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["sparse-update:invalid"];
  }
}

export function validateAuthorityMembership(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["leaf", "root", "rootKind", "siblingDigests"]);
  if (!closed.ok) return closed.issues;
  if (closed.value.rootKind === "EMPTY") return ["membership:empty-root-refused"];
  if (closed.value.rootKind !== "NONEMPTY") return ["rootKind:invalid"];
  try {
    const leaf = requireRecord("authority-history-leaf/v1", closed.value.leaf);
    const root = requireRecord("authority-history-root/v1", closed.value.root);
    const siblings = snapshotClosedArray(closed.value.siblingDigests);
    if (!siblings.ok || siblings.value.length !== 256) return ["siblingDigests:invalid"];
    const issues: string[] = [];
    if (leaf.globalIdentityDigest !== root.globalIdentityDigest)
      issues.push("globalIdentityDigest:mismatch");
    if (
      computeSparseRoot(
        leaf.epochKey as string,
        computeAuthorityLeafDigest(leaf),
        siblings.value as readonly string[],
      ) !== root.treeRootDigest
    )
      issues.push("membership:root-mismatch");
    return Object.freeze(issues.sort());
  } catch {
    return ["membership:invalid"];
  }
}

export function validateAuthorityValueHistoryBinding(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "appendReceipt",
    "authorityValue",
    "globalIdentity",
    "historyRoot",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const authority = requireRecord(
      "state-mutation-authority-value/v2",
      closed.value.authorityValue,
    );
    const identity = requireRecord(
      "state-mutation-global-identity/v1",
      closed.value.globalIdentity,
    );
    const g = computeGlobalIdentityDigest(identity);
    const kind = authority.historyRootKind as "EMPTY" | "NONEMPTY";
    const root = requireRecord(
      kind === "EMPTY" ? "authority-history-empty-root/v1" : "authority-history-root/v1",
      closed.value.historyRoot,
    );
    const rootDigest =
      kind === "EMPTY"
        ? computeAuthorityEmptyRootDigest(root)
        : computeAuthorityHistoryRootDigest(root);
    const issues: string[] = [];
    if (authority.globalIdentityDigest !== g || root.globalIdentityDigest !== g)
      issues.push("globalIdentityDigest:mismatch");
    for (const name of ["installationId", "projectId", "stateRootDigest"])
      if (authority[name] !== identity[name]) issues.push(`${name}:identity-mismatch`);
    if (authority.custodyInstanceDigest !== identity.custodyInstanceDigest)
      issues.push("custodyInstanceDigest:identity-mismatch");
    if (authority.historyRootDigest !== rootDigest || authority.historyCount !== root.count)
      issues.push("historyRoot:authority-mismatch");
    if (kind === "EMPTY") {
      if (closed.value.appendReceipt !== null || authority.historyAppendReceiptDigest !== null)
        issues.push("historyAppendReceiptDigest:empty-present");
    } else {
      const append = requireRecord(
        "authority-history-append-receipt/v1",
        closed.value.appendReceipt,
      );
      const dar = computeAuthorityAppendReceiptDigest(append);
      if (authority.historyAppendReceiptDigest !== dar)
        issues.push("historyAppendReceiptDigest:mismatch");
      if (
        append.globalIdentityDigest !== g ||
        append.successorRootDigest !== rootDigest ||
        append.successorCount !== root.count
      )
        issues.push("appendReceipt:root-mismatch");
    }
    return Object.freeze(issues.sort());
  } catch {
    return ["authority-history-binding:invalid"];
  }
}

export const externalAuthorityPaths = Object.freeze({
  physicalIdentity: (dphys: string) =>
    `state-mutation-destination-identities/${safeSha(dphys)}/identity.json`,
  physicalObservation: (dphys: string, dobs: string) =>
    `state-mutation-destination-identities/${safeSha(dphys)}/observations/${safeSha(dobs)}.json`,
  destinationOwnerCurrent: (ddest: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/current.json`,
  destinationOwnerValue: (ddest: string, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/values/${safeSha(mutationId)}.json`,
  destinationOwnerProposal: (ddest: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/proposals/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  destinationOwnerConflict: (ddest: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/conflicts/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  destinationOwnerTeardownArchive: (ddest: string, ownerTip: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/teardown-archives/${safeSha(ownerTip)}.json`,
  destinationSuccessorReviewCore: (ddest: string, retiredTip: string, reviewCore: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/successor-review-cores/${safeSha(retiredTip)}/${safeSha(reviewCore)}.json`,
  destinationSuccessorPost: (ddest: string, successorTip: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/successor-review-post-selection-receipts/${safeSha(successorTip)}.json`,
  bootstrapAnchor: (installationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/anchor.json`,
  bootstrapAnchorCurrent: (installationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/current.json`,
  bootstrapAnchorUseIntent: (installationId: string, transactionId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/use-intents/${safeUuid(transactionId)}.json`,
  bootstrapGenesisCore: (transactionId: string) =>
    `installation/bootstrap/state-mutation-authority-genesis/${safeUuid(transactionId)}/core.json`,
  bootstrapGenesisPost: (transactionId: string) =>
    `installation/bootstrap/state-mutation-authority-genesis/${safeUuid(transactionId)}/post-selection-receipt.json`,
  historyLeaf: (epochKey: string) =>
    `installation/state-mutation-authority-history/leaves/${safeSha(epochKey)}.json`,
  historyRoot: (rootDigest: string) =>
    `installation/state-mutation-authority-history/roots/${safeSha(rootDigest)}.json`,
  historyEmptyRoot: (rootDigest: string) =>
    `installation/state-mutation-authority-history/empty-roots/${safeSha(rootDigest)}.json`,
  historyUpdateProof: (rotationId: string) =>
    `installation/state-mutation-authority-history/update-proofs/${safeSha(rotationId)}.json`,
  historyAppendReceipt: (rotationId: string) =>
    `installation/state-mutation-authority-history/append-receipts/${safeSha(rotationId)}.json`,
  commitIntent: (targetDp: string, targetMutationId: string) =>
    `installation/pointer-cas/${safeSha(targetDp)}/commits/${safeSha(targetMutationId)}/intent.json`,
  commitCheckpoint: (targetDp: string, targetMutationId: string, coreDigest: string) =>
    `installation/pointer-cas/${safeSha(targetDp)}/commits/${safeSha(targetMutationId)}/checkpoints/${safeSha(coreDigest)}.json`,
  commitRunSegment: (
    targetDp: string,
    targetMutationId: string,
    runOrdinal: string,
    runId: string,
  ) =>
    `installation/pointer-cas/${safeSha(targetDp)}/commits/${safeSha(targetMutationId)}/runs/${safeDecimal(runOrdinal)}-${safeSha(runId)}/segment.json`,
  commitSelectorObservation: (
    targetDp: string,
    targetMutationId: string,
    selectorMutationId: string,
  ) =>
    `installation/pointer-cas/${safeSha(targetDp)}/commits/${safeSha(targetMutationId)}/selector-observations/${safeSha(selectorMutationId)}.json`,
  commitResolution: (targetDp: string, targetMutationId: string) =>
    `installation/pointer-cas/${safeSha(targetDp)}/commits/${safeSha(targetMutationId)}/resolution.json`,
});

export const commitRunStages = Object.freeze([
  "CURRENT_AUTHORITY_READ",
  "TARGET_RECONCILED",
  "VALUE_READBACK",
  "PROPOSAL_READBACK",
  "CURRENT_AUTHORITY_PRE_CAS_READ",
  "CAS_ARMED",
  "TARGET_POST_CAS_READBACK",
  "PROPOSAL_CLASSIFIED",
  "CURRENT_AUTHORITY_POST_CAS_READ",
] as const);

export function computeRunId(input: unknown): string {
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

export function computeRunCheckpointCoreDigest(input: unknown): string {
  const record = requireRecord("pointer-mutation-run-checkpoint-core/v1", input);
  return digest("pointer-mutation-run-checkpoint-core/v1", [
    raw(record.globalIdentityDigest as string),
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
    text(record.stage as string),
    text(record.phase as string),
    nullableRaw(record.terminalResolutionDigest as string | null),
    canonical(record),
  ]);
}

export function computeRunSegmentDigest(input: unknown): string {
  const record = requireRecord("pointer-mutation-run-segment/v1", input);
  return digest("pointer-mutation-run-segment/v1", [canonical(record)]);
}

export function computeRunAuditDigest(
  priorAuditDigest: string | null,
  segmentDigest: string,
): string {
  return digest("pointer-mutation-run-audit/v1", [
    fixed(priorAuditDigest === null ? "00" : "01"),
    ...(priorAuditDigest === null ? [] : [raw(priorAuditDigest)]),
    raw(segmentDigest),
  ]);
}

export function computeRunPostSelectionDigest(input: unknown): string {
  const record = requireRecord(
    "pointer-mutation-run-selector-post-selection-observation/v1",
    input,
  );
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

export function computeCommitResolutionDigest(input: unknown): string {
  const record = requireRecord("pointer-mutation-commit-resolution/v1", input);
  return digest("pointer-mutation-commit-resolution/v1", [canonical(record)]);
}

export function validateCommitRunSequence(input: unknown): readonly string[] {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok || snapshot.value.length !== commitRunStages.length)
    return ["run-sequence:invalid"];
  const issues: string[] = [];
  let previous: ContractRecord | undefined;
  for (const [index, value] of snapshot.value.entries()) {
    const parsed = validateAgainstSchema(
      approvedDefinitions["pointer-mutation-run-checkpoint-core/v1"]!,
      value,
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const current = parsed.value;
    if (current.checkpointOrdinal !== String(index))
      issues.push(`${index}:checkpointOrdinal:mismatch`);
    if (current.stage !== commitRunStages[index]) issues.push(`${index}:stage:mismatch`);
    const expectedPhase =
      index < 5 ? "CRASH_PREFIX" : index < 7 ? "CAS_AMBIGUOUS" : (previous?.phase ?? current.phase);
    if (index < 7 && current.phase !== expectedPhase) issues.push(`${index}:phase:mismatch`);
    if (
      index >= 7 &&
      !["SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"].includes(String(current.phase))
    )
      issues.push(`${index}:phase:not-terminal`);
    if (previous) {
      if (
        current.globalIdentityDigest !== previous.globalIdentityDigest ||
        current.targetMutationId !== previous.targetMutationId
      )
        issues.push(`${index}:identity:changed`);
      if (current.runOrdinal !== previous.runOrdinal) issues.push(`${index}:runOrdinal:changed`);
      if (
        index >= 8 &&
        (current.phase !== previous.phase ||
          current.terminalResolutionDigest !== previous.terminalResolutionDigest)
      )
        issues.push(`${index}:terminal-resolution:changed`);
    }
    previous = current;
  }
  const terminal =
    previous?.phase === "SELECTED" ||
    previous?.phase === "LOST_CONFLICT" ||
    previous?.phase === "UNKNOWN_TERMINAL";
  if (!terminal) issues.push("run-sequence:not-terminal");
  return Object.freeze([...new Set(issues)].sort());
}

export function validateEvidencePacketV2(input: unknown): readonly string[] {
  const parsed = validateAgainstSchema(approvedDefinitions["pointer-evidence-packet/v2"]!, input);
  if (!parsed.ok) return parsed.issues;
  const record = parsed.value;
  const slots = record.evidenceSlotDigests as readonly string[];
  const memberships = record.producerMembershipDigests as readonly string[];
  const issues: string[] = [];
  if (new Set(slots).size !== slots.length) issues.push("evidenceSlotDigests:duplicate");
  if (new Set(memberships).size !== memberships.length)
    issues.push("producerMembershipDigests:duplicate");
  if (slots.length !== 12) issues.push("evidenceSlotDigests:registry-census-mismatch");
  if (memberships.length > 12) issues.push("producerMembershipDigests:unbounded");
  return Object.freeze(issues.sort());
}

export function canonicalContractGolden(
  schemaVersion: string,
  input: unknown,
): {
  readonly bytesHex: string;
  readonly digest: string;
} {
  const record = requireRecord(schemaVersion, input);
  const bytes = canonicalBytes(record);
  return Object.freeze({
    bytesHex: Buffer.from(bytes).toString("hex"),
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

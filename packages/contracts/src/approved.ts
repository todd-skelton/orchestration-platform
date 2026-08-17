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
import {
  computeCurrentTipDigest,
  computeConflictDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  derivePointerPositionEvidence,
  framedBytes,
  pointerPath,
  pointerKinds,
  resolveSelectedPointerEvidence,
  validateEpochSequence,
  v2Definitions,
  type FramePart,
} from "./v2.js";

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

function nestedIssues(
  schemaVersion: string,
  value: JsonValue,
  fieldName: string,
): readonly string[] {
  const definition = approvedDefinitions[schemaVersion];
  if (!definition) return [`${fieldName}:schema-missing`];
  const parsed = validateAgainstSchema(definition, value);
  return parsed.ok ? [] : parsed.issues.map((issue) => `${fieldName}:${issue}`);
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
      define(
        "physical-destination-identity/v1",
        {
          stableNamespaceDigest: sha,
          os: enumeration("windows", "macos", "linux"),
          physicalVolumeDigest: sha,
          filesystemDigest: sha,
          ancestorObjectDigest: sha,
          leafIdentityKind: enumeration("EXISTING_DIRECTORY", "NONEXISTENT_DIRECTORY_LEAF"),
          existingLeafObjectDigest: nullableSha,
          canonicalLeafName: field("bounded-string"),
          leafNameProfile: enumeration(
            "WINDOWS_NFC_CASE_INSENSITIVE_V1",
            "MACOS_NFD_CASE_INSENSITIVE_V1",
            "POSIX_NFC_CASE_SENSITIVE_V1",
          ),
        },
        (record) => {
          const existing = record.leafIdentityKind === "EXISTING_DIRECTORY";
          const name = String(record.canonicalLeafName);
          const profileByOs = {
            windows: "WINDOWS_NFC_CASE_INSENSITIVE_V1",
            macos: "MACOS_NFD_CASE_INSENSITIVE_V1",
            linux: "POSIX_NFC_CASE_SENSITIVE_V1",
          } as const;
          const issues: string[] = [];
          if (existing !== (record.existingLeafObjectDigest !== null))
            issues.push("leafIdentityKind:fields-mismatch");
          if (
            name === "." ||
            name === ".." ||
            /[\\/]/.test(name) ||
            /[\u0000-\u001f\u007f-\u009f]/.test(name)
          )
            issues.push("canonicalLeafName:not-single-safe-component");
          if (record.leafNameProfile !== profileByOs[record.os as keyof typeof profileByOs])
            issues.push("leafNameProfile:os-mismatch");
          if (record.os === "windows") {
            const canonicalWindows = name.normalize("NFC").toLowerCase();
            if (
              name !== canonicalWindows ||
              /[<>:"|?*]/.test(name) ||
              /[ .]$/.test(name) ||
              /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
            )
              issues.push("canonicalLeafName:windows-alias-refused");
          } else if (record.os === "macos") {
            const canonicalMacos = name.normalize("NFD").toLowerCase();
            if (name !== canonicalMacos) issues.push("canonicalLeafName:macos-alias-refused");
          } else if (name !== name.normalize("NFC")) {
            issues.push("canonicalLeafName:linux-normalization-refused");
          }
          return issues;
        },
      ),
      define(
        "physical-destination-locator-observation-receipt/v1",
        {
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
        },
        (record) =>
          String(record.observedAt) <= String(record.validUntil)
            ? []
            : ["validUntil:before-observedAt"],
      ),
      define(
        "state-mutation-destination-owner-value/v1",
        {
          destinationDigest: sha,
          ownerOrdinal: decimal,
          lifecycle: enumeration("ACTIVE", "CONSUMED", "RETIRED"),
          installationId: uuid,
          bootstrapAnchorDigest: sha,
          physicalObservationDigest: sha,
          successorReviewCoreDigest: nullableSha,
          teardownArchiveDigest: nullableSha,
          retirementAnchorTipDigest: nullableSha,
          retirementAnchorValueDigest: nullableSha,
          retirementAnchorReceiptDigest: nullableSha,
          expiresAt: timestamp,
          selectedAt: timestamp,
        },
        (record) => {
          const retirementAnchor = exactTriple(record, "retirementAnchor");
          if (retirementAnchor.length > 0) return retirementAnchor;
          if (record.lifecycle === "ACTIVE")
            return record.teardownArchiveDigest === null &&
              record.retirementAnchorTipDigest === null
              ? []
              : ["lifecycle:active-evidence-mismatch"];
          if (record.lifecycle === "CONSUMED")
            return record.teardownArchiveDigest === null &&
              record.retirementAnchorTipDigest === null
              ? []
              : ["lifecycle:consumed-evidence-mismatch"];
          return record.teardownArchiveDigest !== null && record.retirementAnchorTipDigest !== null
            ? []
            : ["lifecycle:retired-evidence-mismatch"];
        },
      ),
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
      define("state-mutation-destination-owner-teardown-archive/v1", {
        destinationDigest: sha,
        ownerTipDigest: sha,
        ownerValueDigest: sha,
        ownerReceiptDigest: sha,
        installationId: uuid,
        bootstrapAnchorDigest: sha,
        teardownEvidenceDigest: sha,
        custodyProofDigest: sha,
        archivedAt: timestamp,
      }),
      define("state-mutation-destination-owner-retention/v1", {
        destinationDigest: sha,
        currentTipDigest: sha,
        currentValueDigest: sha,
        currentReceiptDigest: sha,
        retention: enumeration("FULL_REQUIRED"),
        censusDigest: sha,
        verifiedAt: timestamp,
      }),
      define("destination-owner-prior-installation/v1", {
        installationId: uuid,
        bootstrapAnchorDigest: sha,
        retiredOwnerTipDigest: sha,
        retiredOwnerValueDigest: sha,
        retiredOwnerReceiptDigest: sha,
        teardownArchiveDigest: sha,
      }),
      define("destination-owner-successor-authority/v1", {
        installationId: uuid,
        projectId: uuid,
        destinationStateRootDigest: sha,
        custodyInstanceDigest: sha,
        reviewedInstallerDigest: sha,
        reviewedHelperDigest: sha,
        reviewedProfileDigest: sha,
        reviewedAbiDigest: sha,
      }),
      define("destination-owner-independent-review/v1", {
        reviewerIdentityDigest: sha,
        subjectDigest: sha,
        reviewReceiptDigest: sha,
        reviewedAt: timestamp,
      }),
      define(
        "state-mutation-destination-owner-successor-review-core/v1",
        {
          destinationDigest: sha,
          priorRetiredTipDigest: sha,
          priorRetiredValueDigest: sha,
          priorRetiredReceiptDigest: sha,
          teardownArchiveDigest: sha,
          priorInstallation: field("json"),
          successorInstallationId: uuid,
          successorAuthority: field("json"),
          independentReview: field("json"),
        },
        (record) => [
          ...nestedIssues(
            "destination-owner-prior-installation/v1",
            record.priorInstallation!,
            "priorInstallation",
          ),
          ...nestedIssues(
            "destination-owner-successor-authority/v1",
            record.successorAuthority!,
            "successorAuthority",
          ),
          ...nestedIssues(
            "destination-owner-independent-review/v1",
            record.independentReview!,
            "independentReview",
          ),
        ],
      ),
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
      define(
        "state-mutation-bootstrap-anchor-lifecycle-value/v1",
        {
          bootstrapAnchorDigest: sha,
          lifecycle: enumeration("ACTIVE", "CONSUMED", "RETIRED"),
          ownerActiveTipDigest: sha,
          ownerActiveValueDigest: sha,
          ownerActiveReceiptDigest: sha,
          useIntentDigest: nullableSha,
          genesisPostSelectionReceiptDigest: nullableSha,
          teardownReceiptDigest: nullableSha,
          expiresAt: timestamp,
          selectedAt: timestamp,
        },
        (record) => {
          if (record.lifecycle === "ACTIVE")
            return [
              "useIntentDigest",
              "genesisPostSelectionReceiptDigest",
              "teardownReceiptDigest",
            ].every((name) => record[name] === null)
              ? []
              : ["lifecycle:active-evidence-mismatch"];
          if (record.lifecycle === "CONSUMED")
            return ["useIntentDigest", "genesisPostSelectionReceiptDigest"].every(
              (name) => record[name] !== null,
            ) && record.teardownReceiptDigest === null
              ? []
              : ["lifecycle:consumed-evidence-mismatch"];
          return record.teardownReceiptDigest !== null
            ? []
            : ["lifecycle:retired-evidence-mismatch"];
        },
      ),
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
      define("bootstrap-proposed-genesis-input/v1", {
        globalIdentityDigest: sha,
        historyEmptyRootDigest: sha,
        authorityPathInstanceDigest: sha,
        authorityValueDigest: sha,
        genesisPositionDigest: sha,
      }),
      define("bootstrap-reviewed-installer/v1", {
        installerDigest: sha,
        profileDigest: sha,
        abiDigest: sha,
        reviewReceiptDigest: sha,
      }),
      define("bootstrap-reviewed-helper/v1", {
        helperDigest: sha,
        profileDigest: sha,
        abiDigest: sha,
        custodyDigest: sha,
      }),
      define(
        "state-mutation-bootstrap-anchor-use-intent/v1",
        {
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
        },
        (record) => [
          ...nestedIssues(
            "bootstrap-proposed-genesis-input/v1",
            record.proposedGenesisInput!,
            "proposedGenesisInput",
          ),
          ...nestedIssues(
            "bootstrap-reviewed-installer/v1",
            record.reviewedInstaller!,
            "reviewedInstaller",
          ),
          ...nestedIssues("bootstrap-reviewed-helper/v1", record.reviewedHelper!, "reviewedHelper"),
        ],
      ),
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
      define("state-mutation-bootstrap-anchor-lifecycle-archive/v1", {
        bootstrapAnchorDigest: sha,
        priorTipDigest: sha,
        priorValueDigest: sha,
        priorReceiptDigest: sha,
        ownerPredecessorTipDigest: sha,
        ownerPredecessorValueDigest: sha,
        ownerPredecessorReceiptDigest: sha,
        archivedAt: timestamp,
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
      define(
        "authority-history-node/v1",
        {
          depth: decimal,
          leftChildDigest: sha,
          rightChildDigest: sha,
          nodeDigest: sha,
          recordPath: path,
        },
        (record) => {
          const depth = Number(record.depth);
          if (!Number.isSafeInteger(depth) || depth < 0 || depth > 255)
            return ["depth:out-of-range"];
          const issues: string[] = [];
          if (
            record.nodeDigest !==
            computeAuthorityNodeDigest(
              depth,
              record.leftChildDigest as string,
              record.rightChildDigest as string,
            )
          )
            issues.push("nodeDigest:not-derived");
          if (record.recordPath !== externalAuthorityPaths.historyNode(record.nodeDigest as string))
            issues.push("recordPath:not-canonical");
          return issues;
        },
      ),
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
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: field("uuid-v7", { nullable: true }),
          sourceToken: opaque,
          targetPathInstanceDigest: sha,
          targetMutationId: sha,
          expectedPriorTipDigest: nullableSha,
          expectedPriorValueDigest: nullableSha,
          expectedPriorReceiptDigest: nullableSha,
          expectedSuccessorValueDigest: sha,
          priorCheckpointDigest: nullableSha,
          createdAt: timestamp,
        },
        (record) => exactTriple(record, "expectedPrior"),
      ),
      define("pointer-mutation-run-segment/v1", {
        globalIdentityDigest: sha,
        pointerKind: enumeration(...pointerKinds),
        canonicalPointerPath: path,
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: field("uuid-v7", { nullable: true }),
        sourceToken: opaque,
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
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: field("uuid-v7", { nullable: true }),
          sourceToken: opaque,
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
      define(
        "pointer-mutation-commit-resolution/v1",
        {
          targetPathInstanceDigest: sha,
          targetMutationId: sha,
          outcome: enumeration("SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"),
          outcomeEvidenceDigest: sha,
          selectedTargetTipDigest: nullableSha,
          conflictReceiptDigest: nullableSha,
          unknownEvidenceDigest: nullableSha,
          producerEpochKey: sha,
          resolvedAt: timestamp,
        },
        (record) => {
          if (record.outcome === "SELECTED")
            return record.selectedTargetTipDigest !== null &&
              record.conflictReceiptDigest === null &&
              record.unknownEvidenceDigest === null &&
              record.outcomeEvidenceDigest === record.selectedTargetTipDigest
              ? []
              : ["outcome:selected-evidence-mismatch"];
          if (record.outcome === "LOST_CONFLICT")
            return record.selectedTargetTipDigest === null &&
              record.conflictReceiptDigest !== null &&
              record.unknownEvidenceDigest === null &&
              record.outcomeEvidenceDigest === record.conflictReceiptDigest
              ? []
              : ["outcome:conflict-evidence-mismatch"];
          return record.selectedTargetTipDigest === null &&
            record.conflictReceiptDigest === null &&
            record.unknownEvidenceDigest !== null &&
            record.outcomeEvidenceDigest === record.unknownEvidenceDigest
            ? []
            : ["outcome:unknown-evidence-mismatch"];
        },
      ),
      define("pointer-mutation-run-checkpoint-evidence/v1", {
        segment: field("json"),
        core: field("json"),
        selectorSelection: field("json"),
        postSelectionObservation: field("json"),
        terminalResolution: field("json", { nullable: true }),
      }),
      define("pointer-mutation-conflict-evidence/v1", {
        receipt: field("json"),
        winningSelection: field("json"),
      }),
      define("pointer-mutation-unknown-evidence/v1", {
        targetPathInstanceDigest: sha,
        targetMutationId: sha,
        reason: enumeration("MALFORMED", "IMPOSSIBLE", "UNREADABLE"),
        observationDigest: sha,
        observedAt: timestamp,
      }),
      define("pointer-mutation-proposed-target-evidence/v1", {
        pointerKind: enumeration(...pointerKinds),
        canonicalPointerPath: path,
        pathBindings: field("json"),
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: field("uuid-v7", { nullable: true }),
        sourceToken: opaque,
        positionEvidence: field("json"),
        value: field("json"),
        proposal: field("json"),
      }),
      define(
        "pointer-mutation-commit-evidence/v1",
        {
          authoritySelection: field("json"),
          epochSequence: field("json"),
          intent: field("json"),
          outcome: enumeration("SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"),
          conflictEvidence: field("json", { nullable: true }),
          proposedTarget: field("json", { nullable: true }),
          selectedTarget: field("json", { nullable: true }),
          unknownEvidence: field("json", { nullable: true }),
          checkpoints: array("json"),
        },
        (record) => {
          const selected = record.outcome === "SELECTED";
          const lost = record.outcome === "LOST_CONFLICT";
          const unknown = record.outcome === "UNKNOWN_TERMINAL";
          return (selected &&
            record.selectedTarget !== null &&
            record.proposedTarget === null &&
            record.conflictEvidence === null &&
            record.unknownEvidence === null) ||
            (lost &&
              record.selectedTarget === null &&
              record.proposedTarget !== null &&
              record.conflictEvidence !== null &&
              record.unknownEvidence === null) ||
            (unknown &&
              record.selectedTarget === null &&
              record.proposedTarget !== null &&
              record.conflictEvidence === null &&
              record.unknownEvidence !== null)
            ? []
            : ["outcome:evidence-union-mismatch"];
        },
      ),
      define(
        "pointer-evidence-slot/v2",
        {
          pointerKind: enumeration(...pointerKinds),
          selectedEvidence: field("json", { nullable: true }),
          producerMembershipIndex: field("decimal", { nullable: true }),
        },
        (record) =>
          (record.selectedEvidence === null) === (record.producerMembershipIndex === null)
            ? []
            : ["selection+membership:partial-group"],
      ),
      define("authority-membership-evidence/v1", {
        currentAuthoritySelection: field("json"),
        globalIdentity: field("json"),
        leaf: field("json"),
        root: field("json"),
        rootKind: enumeration("NONEMPTY"),
        siblingDigests: array("sha256"),
      }),
      define(
        "pointer-evidence-packet/v2",
        {
          purpose: enumeration("HISTORICAL_READ", "MUTATION_COMMIT"),
          globalIdentity: field("json"),
          currentAuthoritySelection: field("json"),
          authorityHistoryBinding: field("json"),
          currentCommit: field("json", { nullable: true }),
          evidenceSlots: array("json"),
          producerMemberships: array("json"),
        },
        (record) =>
          (record.purpose === "HISTORICAL_READ") === (record.currentCommit === null)
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
    canonical({
      canonicalLeafName: record.canonicalLeafName!,
      existingLeafObjectDigest: record.existingLeafObjectDigest!,
      leafIdentityKind: record.leafIdentityKind!,
      leafNameProfile: record.leafNameProfile!,
    }),
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

export function computeDestinationOwnerTeardownArchiveDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-teardown-archive/v1", input);
  return digest("destination-owner-teardown-archive/v1", [
    raw(record.destinationDigest as string),
    raw(record.ownerTipDigest as string),
    raw(record.ownerValueDigest as string),
    raw(record.ownerReceiptDigest as string),
    text(record.installationId as string),
    raw(record.bootstrapAnchorDigest as string),
    raw(record.teardownEvidenceDigest as string),
    raw(record.custodyProofDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerRetentionDigest(input: unknown): string {
  const record = requireRecord("state-mutation-destination-owner-retention/v1", input);
  return digest("destination-owner-retention/v1", [
    raw(record.destinationDigest as string),
    raw(record.currentTipDigest as string),
    raw(record.currentValueDigest as string),
    raw(record.currentReceiptDigest as string),
    text(record.retention as string),
    raw(record.censusDigest as string),
    canonical(record),
  ]);
}

export function computeDestinationOwnerRetirementEvidenceDigest(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "anchorReceiptDigest",
    "anchorTipDigest",
    "anchorValueDigest",
    "teardownArchiveDigest",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  return digest("destination-owner-retirement-evidence/v1", [
    raw(closed.value.teardownArchiveDigest as string),
    raw(closed.value.anchorTipDigest as string),
    raw(closed.value.anchorValueDigest as string),
    raw(closed.value.anchorReceiptDigest as string),
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

export function computeBootstrapAnchorLifecycleArchiveDigest(input: unknown): string {
  const record = requireRecord("state-mutation-bootstrap-anchor-lifecycle-archive/v1", input);
  return digest("bootstrap-anchor-lifecycle-archive/v1", [
    raw(record.bootstrapAnchorDigest as string),
    raw(record.priorTipDigest as string),
    raw(record.priorValueDigest as string),
    raw(record.priorReceiptDigest as string),
    raw(record.ownerPredecessorTipDigest as string),
    raw(record.ownerPredecessorValueDigest as string),
    raw(record.ownerPredecessorReceiptDigest as string),
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

function selectedOwnerTriple(input: unknown): {
  readonly value: ContractRecord;
  readonly proposal: ContractRecord;
  readonly tip: ContractRecord;
  readonly valueDigest: string;
  readonly proposalDigest: string;
  readonly tipDigest: string;
} {
  const closed = snapshotClosedRecord(input, ["proposal", "tip", "value"]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const ownerValue = requireRecord("state-mutation-destination-owner-value/v1", closed.value.value);
  const proposal = requireRecord(
    "state-mutation-destination-owner-cas-proposal/v1",
    closed.value.proposal,
  );
  const tip = requireRecord("state-mutation-destination-owner-current-tip/v1", closed.value.tip);
  const valueDigest = computeDestinationOwnerValueDigest(ownerValue);
  const proposalDigest = computeDestinationOwnerProposalDigest(proposal);
  const tipDigest = computeDestinationOwnerTipDigest(tip);
  if (
    proposal.destinationDigest !== ownerValue.destinationDigest ||
    proposal.successorValueDigest !== valueDigest ||
    tip.destinationDigest !== ownerValue.destinationDigest ||
    tip.valueDigest !== valueDigest ||
    tip.proposalReceiptDigest !== proposalDigest
  )
    throw new TypeError("owner-selection:binding-mismatch");
  return { value: ownerValue, proposal, tip, valueDigest, proposalDigest, tipDigest };
}

function selectedAnchorTriple(input: unknown): {
  readonly value: ContractRecord;
  readonly proposal: ContractRecord;
  readonly tip: ContractRecord;
  readonly valueDigest: string;
  readonly proposalDigest: string;
  readonly tipDigest: string;
} {
  const closed = snapshotClosedRecord(input, ["proposal", "tip", "value"]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const anchorValue = requireRecord(
    "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    closed.value.value,
  );
  const proposal = requireRecord(
    "state-mutation-bootstrap-anchor-cas-proposal/v1",
    closed.value.proposal,
  );
  const tip = requireRecord("state-mutation-bootstrap-anchor-current-tip/v1", closed.value.tip);
  const valueDigest = computeBootstrapAnchorValueDigest(anchorValue);
  const proposalDigest = computeBootstrapAnchorProposalDigest(proposal);
  const tipDigest = computeBootstrapAnchorTipDigest(tip);
  if (
    proposal.bootstrapAnchorDigest !== anchorValue.bootstrapAnchorDigest ||
    proposal.successorValueDigest !== valueDigest ||
    tip.bootstrapAnchorDigest !== anchorValue.bootstrapAnchorDigest ||
    tip.valueDigest !== valueDigest ||
    tip.proposalReceiptDigest !== proposalDigest
  )
    throw new TypeError("anchor-selection:binding-mismatch");
  return { value: anchorValue, proposal, tip, valueDigest, proposalDigest, tipDigest };
}

export function validateDestinationOwnerComposition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "anchorConsumed",
    "anchorRetired",
    "anchorConsumptionReceipt",
    "current",
    "now",
    "observation",
    "ownerRetired",
    "physicalIdentity",
    "previous",
    "successorPost",
    "successorReviewCore",
    "teardownArchive",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const identity = requireRecord(
      "physical-destination-identity/v1",
      closed.value.physicalIdentity,
    );
    const observation = requireRecord(
      "physical-destination-locator-observation-receipt/v1",
      closed.value.observation,
    );
    const current = selectedOwnerTriple(closed.value.current);
    const previous =
      closed.value.previous === null ? null : selectedOwnerTriple(closed.value.previous);
    const anchorConsumed =
      closed.value.anchorConsumed === null
        ? null
        : selectedAnchorTriple(closed.value.anchorConsumed);
    const anchorRetired =
      closed.value.anchorRetired === null ? null : selectedAnchorTriple(closed.value.anchorRetired);
    const ownerRetired =
      closed.value.ownerRetired === null ? null : selectedOwnerTriple(closed.value.ownerRetired);
    const dphys = computePhysicalDestinationDigest(identity);
    const dobs = computePhysicalObservationDigest(observation);
    const ddest = computeDestinationDigest(dphys);
    const issues: string[] = [];
    let transitionEvidenceDigest = dobs;
    if (
      observation.physicalDestinationDigest !== dphys ||
      observation.disposition !== "ADMITTED" ||
      String(observation.observedAt) > String(closed.value.now) ||
      String(observation.validUntil) < String(closed.value.now)
    )
      issues.push("physicalObservation:not-current-admitted");
    if (
      current.value.destinationDigest !== ddest ||
      current.value.physicalObservationDigest !== dobs
    )
      issues.push("current:destination-observation-mismatch");
    const prior = previous;
    for (const [field, expected] of [
      ["priorTipDigest", prior?.tipDigest ?? null],
      ["priorValueDigest", prior?.valueDigest ?? null],
      ["priorReceiptDigest", prior?.proposalDigest ?? null],
    ] as const)
      if (current.proposal[field] !== expected) issues.push(`${field}:selected-prior-mismatch`);
    const expectedTransition =
      previous === null
        ? "ACTIVATE_GENESIS"
        : previous.value.lifecycle === "ACTIVE" && current.value.lifecycle === "CONSUMED"
          ? "CONSUME"
          : previous.value.lifecycle === "ACTIVE" && current.value.lifecycle === "RETIRED"
            ? "RETIRE_UNUSED"
            : previous.value.lifecycle === "CONSUMED" && current.value.lifecycle === "RETIRED"
              ? "RETIRE_CONSUMED"
              : previous.value.lifecycle === "RETIRED" && current.value.lifecycle === "ACTIVE"
                ? "ACTIVATE_SUCCESSOR"
                : null;
    if (current.proposal.transition !== expectedTransition)
      issues.push("proposal:transition-lifecycle-mismatch");
    issues.push(...validateDestinationOwnerTransition(previous?.value ?? null, current.value));
    if (
      current.value.lifecycle === "ACTIVE" &&
      String(current.value.expiresAt) < String(closed.value.now)
    )
      issues.push("owner:active-expired");
    const successor = current.proposal.transition === "ACTIVATE_SUCCESSOR";
    if (successor) {
      const core = requireRecord(
        "state-mutation-destination-owner-successor-review-core/v1",
        closed.value.successorReviewCore,
      );
      const post = requireRecord(
        "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
        closed.value.successorPost,
      );
      const dsrc = computeDestinationSuccessorReviewCoreDigest(core);
      const dsrp = computeDestinationSuccessorPostDigest(post);
      transitionEvidenceDigest = dsrc;
      if (
        core.destinationDigest !== ddest ||
        core.priorRetiredTipDigest !== previous?.tipDigest ||
        core.priorRetiredValueDigest !== previous?.valueDigest ||
        core.priorRetiredReceiptDigest !== previous?.proposalDigest ||
        current.value.successorReviewCoreDigest !== dsrc ||
        post.reviewCoreDigest !== dsrc ||
        post.successorValueDigest !== current.valueDigest ||
        post.successorReceiptDigest !== current.proposalDigest ||
        post.successorTipDigest !== current.tipDigest ||
        post.valueReadbackDigest !== current.valueDigest ||
        post.proposalReadbackDigest !== current.proposalDigest ||
        post.tipReadbackDigest !== current.tipDigest
      )
        issues.push("successor-review:binding-mismatch");
      const priorInstallation = requireRecord(
        "destination-owner-prior-installation/v1",
        core.priorInstallation,
      );
      const successorAuthority = requireRecord(
        "destination-owner-successor-authority/v1",
        core.successorAuthority,
      );
      const independentReview = requireRecord(
        "destination-owner-independent-review/v1",
        core.independentReview,
      );
      const successorSubject = createHash("sha256")
        .update(canonicalBytes(successorAuthority))
        .digest("hex");
      if (
        priorInstallation.installationId !== previous?.value.installationId ||
        priorInstallation.bootstrapAnchorDigest !== previous?.value.bootstrapAnchorDigest ||
        priorInstallation.retiredOwnerTipDigest !== previous?.tipDigest ||
        priorInstallation.retiredOwnerValueDigest !== previous?.valueDigest ||
        priorInstallation.retiredOwnerReceiptDigest !== previous?.proposalDigest ||
        priorInstallation.teardownArchiveDigest !== previous?.value.teardownArchiveDigest ||
        core.teardownArchiveDigest !== previous?.value.teardownArchiveDigest ||
        core.successorInstallationId !== current.value.installationId ||
        successorAuthority.installationId !== current.value.installationId ||
        independentReview.subjectDigest !== successorSubject
      )
        issues.push("successor-review:closed-subrecord-mismatch");
    } else if (closed.value.successorReviewCore !== null || closed.value.successorPost !== null) {
      issues.push("successor-review:unexpected");
    }
    if (current.value.lifecycle === "CONSUMED") {
      const consumptionReceipt = requireRecord(
        "state-mutation-bootstrap-anchor-consumption-receipt/v1",
        closed.value.anchorConsumptionReceipt,
      );
      if (
        !anchorConsumed ||
        anchorConsumed.value.lifecycle !== "CONSUMED" ||
        anchorConsumed.value.bootstrapAnchorDigest !== current.value.bootstrapAnchorDigest ||
        anchorConsumed.value.ownerActiveTipDigest !== previous?.tipDigest ||
        anchorConsumed.value.ownerActiveValueDigest !== previous?.valueDigest ||
        anchorConsumed.value.ownerActiveReceiptDigest !== previous?.proposalDigest ||
        consumptionReceipt.ownerActiveTipDigest !== previous?.tipDigest ||
        consumptionReceipt.ownerActiveValueDigest !== previous?.valueDigest ||
        consumptionReceipt.ownerActiveReceiptDigest !== previous?.proposalDigest ||
        consumptionReceipt.ownerConsumedTipDigest !== current.tipDigest ||
        consumptionReceipt.ownerConsumedValueDigest !== current.valueDigest ||
        consumptionReceipt.ownerConsumedReceiptDigest !== current.proposalDigest ||
        consumptionReceipt.externalAnchorTipReadbackDigest !== anchorConsumed?.tipDigest ||
        consumptionReceipt.externalAnchorValueReadbackDigest !== anchorConsumed?.valueDigest ||
        consumptionReceipt.externalAnchorProposalReadbackDigest !== anchorConsumed?.proposalDigest
      )
        issues.push("anchorConsumption:binding-mismatch");
      transitionEvidenceDigest = anchorConsumed?.tipDigest ?? dobs;
    } else if (
      closed.value.anchorConsumptionReceipt !== null ||
      closed.value.anchorConsumed !== null
    ) {
      issues.push("anchorConsumptionReceipt:unexpected");
    }
    if (current.value.lifecycle === "RETIRED") {
      const archive = requireRecord(
        "state-mutation-destination-owner-teardown-archive/v1",
        closed.value.teardownArchive,
      );
      const archiveDigest = computeDestinationOwnerTeardownArchiveDigest(archive);
      const retirementEvidenceDigest = anchorRetired
        ? computeDestinationOwnerRetirementEvidenceDigest({
            teardownArchiveDigest: archiveDigest,
            anchorTipDigest: anchorRetired.tipDigest,
            anchorValueDigest: anchorRetired.valueDigest,
            anchorReceiptDigest: anchorRetired.proposalDigest,
          })
        : archiveDigest;
      transitionEvidenceDigest = retirementEvidenceDigest;
      if (
        current.value.teardownArchiveDigest !== archiveDigest ||
        archive.destinationDigest !== ddest ||
        archive.ownerTipDigest !== previous?.tipDigest ||
        archive.ownerValueDigest !== previous?.valueDigest ||
        archive.ownerReceiptDigest !== previous?.proposalDigest ||
        archive.installationId !== previous?.value.installationId ||
        archive.bootstrapAnchorDigest !== previous?.value.bootstrapAnchorDigest ||
        String(previous?.value.selectedAt) > String(archive.archivedAt) ||
        String(anchorRetired?.value.selectedAt) > String(archive.archivedAt) ||
        String(archive.archivedAt) > String(current.value.selectedAt)
      )
        issues.push("teardownArchive:binding-mismatch");
      if (
        !ownerRetired ||
        !anchorRetired ||
        ownerRetired.tipDigest !== current.tipDigest ||
        ownerRetired.valueDigest !== current.valueDigest ||
        ownerRetired.proposalDigest !== current.proposalDigest ||
        anchorRetired.value.lifecycle !== "RETIRED" ||
        anchorRetired.value.bootstrapAnchorDigest !== current.value.bootstrapAnchorDigest ||
        current.value.retirementAnchorTipDigest !== anchorRetired.tipDigest ||
        current.value.retirementAnchorValueDigest !== anchorRetired.valueDigest ||
        current.value.retirementAnchorReceiptDigest !== anchorRetired.proposalDigest
      )
        issues.push("retired-selection:binding-mismatch");
    } else if (closed.value.teardownArchive !== null) {
      issues.push("teardownArchiveDigest:unexpected");
    }
    if (
      current.value.lifecycle !== "RETIRED" &&
      (closed.value.ownerRetired !== null || closed.value.anchorRetired !== null)
    )
      issues.push("retired-selection:unexpected");
    if (current.proposal.positionDigest !== transitionEvidenceDigest)
      issues.push("proposal:position-evidence-mismatch");
    const source =
      current.proposal.transition === "ACTIVATE_GENESIS" ||
      current.proposal.transition === "ACTIVATE_SUCCESSOR"
        ? "reviewed-bootstrap"
        : current.proposal.transition === "CONSUME"
          ? "bootstrap-consumption"
          : "teardown";
    const mutationId = computeDestinationOwnerMutationId({
      destinationDigest: ddest,
      currentPath: externalAuthorityPaths.destinationOwnerCurrent(ddest),
      priorTipDigest: prior?.tipDigest ?? null,
      priorValueDigest: prior?.valueDigest ?? null,
      priorReceiptDigest: prior?.proposalDigest ?? null,
      ownerOrdinal: current.value.ownerOrdinal,
      transition: current.proposal.transition,
      successorValueDigest: current.valueDigest,
      installationId: current.value.installationId,
      bootstrapAnchorDigest: current.value.bootstrapAnchorDigest,
      source,
      transitionEvidenceDigest,
    });
    if (current.proposal.mutationId !== mutationId) issues.push("proposal:mutationId:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["destination-owner-composition:invalid"];
  }
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

export function validateBootstrapAnchorComposition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "anchor",
    "anchorRetired",
    "consumptionReceipt",
    "current",
    "genesisPost",
    "genesisGraph",
    "now",
    "ownerActive",
    "ownerConsumed",
    "ownerObservation",
    "ownerPhysicalIdentity",
    "previous",
    "successorPost",
    "successorReviewCore",
    "teardownArchive",
    "teardownReceipt",
    "useIntent",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const anchor = requireRecord("state-mutation-bootstrap-anchor/v1", closed.value.anchor);
    const dba = computeBootstrapAnchorDigest(anchor);
    const current = selectedAnchorTriple(closed.value.current);
    const previous =
      closed.value.previous === null ? null : selectedAnchorTriple(closed.value.previous);
    const owner = selectedOwnerTriple(closed.value.ownerActive);
    const ownerPhysicalIdentity = requireRecord(
      "physical-destination-identity/v1",
      closed.value.ownerPhysicalIdentity,
    );
    const ownerObservation = requireRecord(
      "physical-destination-locator-observation-receipt/v1",
      closed.value.ownerObservation,
    );
    const ownerDphys = computePhysicalDestinationDigest(ownerPhysicalIdentity);
    const ownerDobs = computePhysicalObservationDigest(ownerObservation);
    const ownerDdest = computeDestinationDigest(ownerDphys);
    const ownerConsumed =
      closed.value.ownerConsumed === null ? null : selectedOwnerTriple(closed.value.ownerConsumed);
    const anchorRetired =
      closed.value.anchorRetired === null ? null : selectedAnchorTriple(closed.value.anchorRetired);
    const issues: string[] = [];
    if (
      current.value.bootstrapAnchorDigest !== dba ||
      owner.value.bootstrapAnchorDigest !== dba ||
      owner.value.destinationDigest !== ownerDdest ||
      owner.value.physicalObservationDigest !== ownerDobs ||
      ownerObservation.physicalDestinationDigest !== ownerDphys ||
      ownerObservation.disposition !== "ADMITTED" ||
      String(ownerObservation.observedAt) > String(closed.value.now) ||
      String(ownerObservation.validUntil) < String(closed.value.now) ||
      anchor.destinationDigest !== ownerDdest ||
      owner.value.lifecycle !== "ACTIVE" ||
      owner.value.installationId !== anchor.installationId
    )
      issues.push("anchor-owner:binding-mismatch");
    if (anchor.successorReviewCoreDigest !== null) {
      const successorCore = requireRecord(
        "state-mutation-destination-owner-successor-review-core/v1",
        closed.value.successorReviewCore,
      );
      const successorPost = requireRecord(
        "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
        closed.value.successorPost,
      );
      const successorAuthority = requireRecord(
        "destination-owner-successor-authority/v1",
        successorCore.successorAuthority,
      );
      const dsrc = computeDestinationSuccessorReviewCoreDigest(successorCore);
      if (
        dsrc !== anchor.successorReviewCoreDigest ||
        owner.value.successorReviewCoreDigest !== anchor.successorReviewCoreDigest ||
        successorPost.reviewCoreDigest !== anchor.successorReviewCoreDigest ||
        successorPost.successorBootstrapAnchorDigest !== dba ||
        successorPost.successorTipDigest !== owner.tipDigest ||
        successorPost.successorValueDigest !== owner.valueDigest ||
        successorPost.successorReceiptDigest !== owner.proposalDigest ||
        successorPost.tipReadbackDigest !== owner.tipDigest ||
        successorPost.valueReadbackDigest !== owner.valueDigest ||
        successorPost.proposalReadbackDigest !== owner.proposalDigest ||
        String(successorPost.observedAt) > String(closed.value.now) ||
        successorCore.successorInstallationId !== anchor.installationId ||
        successorAuthority.installationId !== anchor.installationId ||
        successorAuthority.projectId !== anchor.projectId ||
        successorAuthority.destinationStateRootDigest !== anchor.destinationStateRootDigest ||
        successorAuthority.custodyInstanceDigest !== anchor.custodyInstanceDigest ||
        successorAuthority.reviewedInstallerDigest !== anchor.reviewedInstallerDigest ||
        successorAuthority.reviewedHelperDigest !== anchor.helperDigest
      )
        issues.push("successorPost:anchor-owner-mismatch");
    } else if (closed.value.successorPost !== null || closed.value.successorReviewCore !== null) {
      issues.push("successorPost:unexpected");
    }
    for (const [name, expected] of [
      ["ownerActiveTipDigest", owner.tipDigest],
      ["ownerActiveValueDigest", owner.valueDigest],
      ["ownerActiveReceiptDigest", owner.proposalDigest],
    ] as const)
      if (current.value[name] !== expected) issues.push(`${name}:mismatch`);
    for (const [name, expected] of [
      ["priorTipDigest", previous?.tipDigest ?? null],
      ["priorValueDigest", previous?.valueDigest ?? null],
      ["priorReceiptDigest", previous?.proposalDigest ?? null],
    ] as const)
      if (current.proposal[name] !== expected) issues.push(`${name}:selected-prior-mismatch`);
    const expectedTransition =
      previous === null
        ? "ACTIVATE"
        : previous.value.lifecycle === "ACTIVE" && current.value.lifecycle === "CONSUMED"
          ? "CONSUME"
          : current.value.lifecycle === "RETIRED"
            ? "RETIRE"
            : null;
    if (current.proposal.transition !== expectedTransition)
      issues.push("proposal:transition-lifecycle-mismatch");
    if (previous) issues.push(...validateBootstrapAnchorTransition(previous.value, current.value));
    else if (current.value.lifecycle !== "ACTIVE") issues.push("anchor:genesis-not-active");
    if (
      current.value.lifecycle === "ACTIVE" &&
      (ownerConsumed !== null || anchorRetired !== null || closed.value.teardownArchive !== null)
    )
      issues.push("phase:active-extra-selection");
    if (
      current.value.lifecycle === "CONSUMED" &&
      (ownerConsumed === null ||
        anchorRetired !== null ||
        closed.value.teardownArchive !== null ||
        closed.value.teardownReceipt !== null)
    )
      issues.push("phase:consumed-selection-mismatch");
    if (current.value.lifecycle === "RETIRED") {
      if (!previous || !anchorRetired) issues.push("phase:retired-selection-missing");
      else {
        if (
          anchorRetired.tipDigest !== current.tipDigest ||
          anchorRetired.valueDigest !== current.valueDigest ||
          anchorRetired.proposalDigest !== current.proposalDigest ||
          current.value.ownerActiveTipDigest !== previous.value.ownerActiveTipDigest ||
          current.value.ownerActiveValueDigest !== previous.value.ownerActiveValueDigest ||
          current.value.ownerActiveReceiptDigest !== previous.value.ownerActiveReceiptDigest ||
          current.value.useIntentDigest !== previous.value.useIntentDigest ||
          current.value.genesisPostSelectionReceiptDigest !==
            previous.value.genesisPostSelectionReceiptDigest ||
          current.value.expiresAt !== previous.value.expiresAt
        )
          issues.push("phase:retired-carry-forward-mismatch");
      }
    } else if (anchorRetired !== null) {
      issues.push("phase:retired-selection-unexpected");
    }
    const useIntent =
      closed.value.useIntent === null
        ? null
        : requireRecord("state-mutation-bootstrap-anchor-use-intent/v1", closed.value.useIntent);
    if (useIntent) {
      const useDigest = computeBootstrapAnchorUseIntentDigest(useIntent);
      if (
        useIntent.bootstrapAnchorDigest !== dba ||
        useIntent.activeTipDigest !== (previous?.tipDigest ?? current.tipDigest) ||
        useIntent.activeValueDigest !== (previous?.valueDigest ?? current.valueDigest) ||
        useIntent.activeReceiptDigest !== (previous?.proposalDigest ?? current.proposalDigest) ||
        useIntent.bootstrapTransactionId !== anchor.bootstrapTransactionId ||
        useIntent.destinationStateRootDigest !== anchor.destinationStateRootDigest ||
        useIntent.custodyInstanceDigest !== anchor.custodyInstanceDigest ||
        String(useIntent.startedAt) > String(useIntent.expiresAt) ||
        String(useIntent.startedAt) > String(current.value.expiresAt) ||
        (current.value.lifecycle === "CONSUMED" && current.value.useIntentDigest !== useDigest)
      )
        issues.push("useIntent:binding-or-expiry-mismatch");
    } else if (
      String(closed.value.now) > String(current.value.expiresAt) &&
      current.value.lifecycle === "ACTIVE"
    ) {
      issues.push("anchor:expired-without-intent");
    }
    if (current.value.lifecycle === "CONSUMED") {
      if (!useIntent) issues.push("useIntent:required-for-consumed");
      if (previous && current.value.expiresAt !== previous.value.expiresAt)
        issues.push("phase:consumed-expiry-changed");
      const post = requireRecord(
        "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
        closed.value.genesisPost,
      );
      const consumption = requireRecord(
        "state-mutation-bootstrap-anchor-consumption-receipt/v1",
        closed.value.consumptionReceipt,
      );
      const dgp = computeBootstrapGenesisPostDigest(post);
      const genesisGraph = snapshotClosedRecord(closed.value.genesisGraph, [
        "anchor",
        "authoritySelection",
        "core",
        "emptyRoot",
        "globalIdentity",
        "post",
      ]);
      if (!genesisGraph.ok) issues.push("genesisGraph:invalid");
      else {
        issues.push(
          ...validateBootstrapGenesisGraph(genesisGraph.value).map(
            (issue) => `genesisGraph:${issue}`,
          ),
        );
        if (
          Buffer.compare(
            Buffer.from(canonicalBytes(genesisGraph.value.anchor as JsonValue)),
            Buffer.from(canonicalBytes(anchor)),
          ) !== 0 ||
          Buffer.compare(
            Buffer.from(canonicalBytes(genesisGraph.value.post as JsonValue)),
            Buffer.from(canonicalBytes(post)),
          ) !== 0
        )
          issues.push("genesisGraph:anchor-post-mismatch");
        if (useIntent) {
          const proposed = requireRecord(
            "bootstrap-proposed-genesis-input/v1",
            useIntent.proposedGenesisInput,
          );
          const reviewedInstaller = requireRecord(
            "bootstrap-reviewed-installer/v1",
            useIntent.reviewedInstaller,
          );
          const reviewedHelper = requireRecord(
            "bootstrap-reviewed-helper/v1",
            useIntent.reviewedHelper,
          );
          const graphIdentity = requireRecord(
            "state-mutation-global-identity/v1",
            genesisGraph.value.globalIdentity,
          );
          const graphCore = requireRecord(
            "state-mutation-bootstrap-genesis-core/v1",
            genesisGraph.value.core,
          );
          const graphEmptyRoot = requireRecord(
            "authority-history-empty-root/v1",
            genesisGraph.value.emptyRoot,
          );
          const graphAuthority = snapshotClosedRecord(genesisGraph.value.authoritySelection, [
            "proposal",
            "tip",
            "value",
          ]);
          if (!graphAuthority.ok) issues.push("useIntent:authority-selection-invalid");
          else {
            const graphAuthorityValue = requireRecord(
              "state-mutation-authority-value/v2",
              graphAuthority.value.value,
            );
            if (
              proposed.globalIdentityDigest !== computeGlobalIdentityDigest(graphIdentity) ||
              proposed.historyEmptyRootDigest !== computeAuthorityEmptyRootDigest(graphEmptyRoot) ||
              proposed.authorityPathInstanceDigest !== graphCore.authorityPathInstanceDigest ||
              proposed.authorityValueDigest !== graphCore.authorityValueDigest ||
              proposed.genesisPositionDigest !== graphCore.genesisPositionDigest ||
              useIntent.expectedAuthorityValueDigest !== graphCore.authorityValueDigest ||
              reviewedInstaller.installerDigest !== anchor.reviewedInstallerDigest ||
              reviewedInstaller.reviewReceiptDigest !== anchor.independentReviewDigest ||
              reviewedHelper.helperDigest !== anchor.helperDigest ||
              reviewedHelper.abiDigest !== graphAuthorityValue.producerAbiDigest ||
              reviewedHelper.custodyDigest !== graphAuthorityValue.producerCustodyDigest
            )
              issues.push("useIntent:genesis-review-binding-mismatch");
          }
        }
      }
      if (!ownerConsumed) issues.push("ownerConsumed:missing");
      if (ownerConsumed) {
        issues.push(...validateDestinationOwnerTransition(owner.value, ownerConsumed.value));
        const expectedOwnerMutationId = computeDestinationOwnerMutationId({
          destinationDigest: ownerDdest,
          currentPath: externalAuthorityPaths.destinationOwnerCurrent(ownerDdest),
          priorTipDigest: owner.tipDigest,
          priorValueDigest: owner.valueDigest,
          priorReceiptDigest: owner.proposalDigest,
          ownerOrdinal: ownerConsumed.value.ownerOrdinal,
          transition: "CONSUME",
          successorValueDigest: ownerConsumed.valueDigest,
          installationId: ownerConsumed.value.installationId,
          bootstrapAnchorDigest: dba,
          source: "bootstrap-consumption",
          transitionEvidenceDigest: current.tipDigest,
        });
        if (
          ownerConsumed.value.destinationDigest !== ownerDdest ||
          ownerConsumed.value.physicalObservationDigest !== ownerDobs ||
          ownerConsumed.value.bootstrapAnchorDigest !== dba ||
          ownerConsumed.proposal.transition !== "CONSUME" ||
          ownerConsumed.proposal.priorTipDigest !== owner.tipDigest ||
          ownerConsumed.proposal.priorValueDigest !== owner.valueDigest ||
          ownerConsumed.proposal.priorReceiptDigest !== owner.proposalDigest ||
          ownerConsumed.proposal.positionDigest !== current.tipDigest ||
          ownerConsumed.proposal.mutationId !== expectedOwnerMutationId
        )
          issues.push("ownerConsumed:transition-mismatch");
      }
      if (
        current.value.genesisPostSelectionReceiptDigest !== dgp ||
        consumption.bootstrapAnchorDigest !== dba ||
        consumption.useIntentDigest !==
          (useIntent ? computeBootstrapAnchorUseIntentDigest(useIntent) : null) ||
        consumption.genesisPostSelectionReceiptDigest !== dgp ||
        consumption.bootstrapTransactionId !== anchor.bootstrapTransactionId ||
        consumption.destinationStateRootDigest !== anchor.destinationStateRootDigest ||
        consumption.custodyInstanceDigest !== anchor.custodyInstanceDigest ||
        consumption.authorityPathInstanceDigest !== post.authorityPathInstanceDigest ||
        consumption.valueDigest !== post.valueDigest ||
        consumption.proposalReceiptDigest !== post.proposalReceiptDigest ||
        consumption.tipDigest !== post.tipDigest ||
        consumption.runtimeValueReadbackDigest !== post.valueDigest ||
        consumption.runtimeProposalReadbackDigest !== post.proposalReceiptDigest ||
        consumption.runtimeTipReadbackDigest !== post.tipDigest ||
        consumption.runtimePostReadbackDigest !== dgp ||
        consumption.ownerActiveTipDigest !== owner.tipDigest ||
        consumption.ownerActiveValueDigest !== owner.valueDigest ||
        consumption.ownerActiveReceiptDigest !== owner.proposalDigest ||
        consumption.ownerConsumedTipDigest !== ownerConsumed?.tipDigest ||
        consumption.ownerConsumedValueDigest !== ownerConsumed?.valueDigest ||
        consumption.ownerConsumedReceiptDigest !== ownerConsumed?.proposalDigest ||
        consumption.externalAnchorValueReadbackDigest !== current.valueDigest ||
        consumption.externalAnchorProposalReadbackDigest !== current.proposalDigest ||
        consumption.externalAnchorTipReadbackDigest !== current.tipDigest ||
        ownerConsumed?.value.lifecycle !== "CONSUMED" ||
        ownerConsumed?.proposal.priorTipDigest !== owner.tipDigest ||
        ownerConsumed?.proposal.priorValueDigest !== owner.valueDigest ||
        ownerConsumed?.proposal.priorReceiptDigest !== owner.proposalDigest ||
        String(post.observedAt) > String(current.value.selectedAt) ||
        String(current.value.selectedAt) > String(ownerConsumed?.value.selectedAt) ||
        String(ownerConsumed?.value.selectedAt) > String(consumption.consumedAt)
      )
        issues.push("consumption:binding-mismatch");
    } else if (
      closed.value.genesisPost !== null ||
      closed.value.genesisGraph !== null ||
      closed.value.consumptionReceipt !== null ||
      ownerConsumed !== null
    ) {
      issues.push("consumption:unexpected");
    }
    if (current.value.lifecycle === "RETIRED") {
      const teardown = requireRecord(
        "state-mutation-bootstrap-anchor-teardown-receipt/v1",
        closed.value.teardownReceipt,
      );
      const teardownArchive = requireRecord(
        "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
        closed.value.teardownArchive,
      );
      const teardownDigest = computeBootstrapAnchorTeardownDigest(teardown);
      const teardownArchiveDigest = computeBootstrapAnchorLifecycleArchiveDigest(teardownArchive);
      const ownerPrior = ownerConsumed ?? owner;
      if (
        current.value.teardownReceiptDigest !== teardownDigest ||
        teardown.bootstrapAnchorDigest !== dba ||
        teardown.priorTipDigest !== previous?.tipDigest ||
        teardown.priorValueDigest !== previous?.valueDigest ||
        teardown.priorReceiptDigest !== previous?.proposalDigest ||
        teardown.ownerTipDigest !== ownerPrior.tipDigest ||
        teardown.ownerValueDigest !== ownerPrior.valueDigest ||
        teardown.ownerReceiptDigest !== ownerPrior.proposalDigest ||
        teardown.externalArchiveDigest !== teardownArchiveDigest ||
        teardownArchive.bootstrapAnchorDigest !== dba ||
        teardownArchive.priorTipDigest !== previous?.tipDigest ||
        teardownArchive.priorValueDigest !== previous?.valueDigest ||
        teardownArchive.priorReceiptDigest !== previous?.proposalDigest ||
        teardownArchive.ownerPredecessorTipDigest !== ownerPrior.tipDigest ||
        teardownArchive.ownerPredecessorValueDigest !== ownerPrior.valueDigest ||
        teardownArchive.ownerPredecessorReceiptDigest !== ownerPrior.proposalDigest ||
        (previous?.value.lifecycle === "CONSUMED") !== (ownerConsumed !== null) ||
        String(ownerPrior.value.selectedAt) > String(teardownArchive.archivedAt) ||
        String(teardownArchive.archivedAt) > String(teardown.retiredAt) ||
        String(teardown.retiredAt) > String(current.value.selectedAt)
      )
        issues.push("teardown:binding-mismatch");
    } else if (closed.value.teardownReceipt !== null || closed.value.teardownArchive !== null) {
      issues.push("teardown:unexpected");
    }
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["bootstrap-anchor-composition:invalid"];
  }
}

export function validateBootstrapGenesisGraph(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "anchor",
    "authoritySelection",
    "core",
    "emptyRoot",
    "globalIdentity",
    "post",
  ]);
  if (!closed.ok) return closed.issues;
  try {
    const anchor = requireRecord("state-mutation-bootstrap-anchor/v1", closed.value.anchor);
    const dba = computeBootstrapAnchorDigest(anchor);
    const identity = requireRecord(
      "state-mutation-global-identity/v1",
      closed.value.globalIdentity,
    );
    const authority = snapshotClosedRecord(closed.value.authoritySelection, [
      "proposal",
      "tip",
      "value",
    ]);
    if (!authority.ok) throw new TypeError(authority.issues.join(","));
    const authorityValue = requireRecord(
      "state-mutation-authority-value/v2",
      authority.value.value,
    );
    const proposal = v2Definitions["pointer-cas-proposal-receipt/v2"]!;
    const parsedProposal = validateAgainstSchema(proposal, authority.value.proposal);
    if (!parsedProposal.ok) throw new TypeError(parsedProposal.issues.join(","));
    const proposalRecord = parsedProposal.value;
    const parsedTip = validateAgainstSchema(
      v2Definitions["pointer-current-tip/v1"]!,
      authority.value.tip,
    );
    if (!parsedTip.ok) throw new TypeError(parsedTip.issues.join(","));
    const tipRecord = parsedTip.value;
    const core = requireRecord("state-mutation-bootstrap-genesis-core/v1", closed.value.core);
    const post = requireRecord(
      "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
      closed.value.post,
    );
    const dbg = computeBootstrapGenesisCoreDigest(core);
    const issues: string[] = [];
    const canonicalPointerPath = pointerPath("STATE_MUTATION_AUTHORITY_ROTATION");
    const dp = computePointerInstanceDigest({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath,
      installationId: identity.installationId as string,
      projectId: identity.projectId as string,
      stateRootDigest: identity.stateRootDigest as string,
      transactionId: null,
      sourceToken: "none",
    });
    const dv = computePointerValueDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, authorityValue);
    const positionEvidence = derivePointerPositionEvidence(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      authorityValue,
    );
    const positionDigest = computePointerPositionDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      positionEvidence,
    );
    const mutationId = computeMutationId({
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      canonicalPointerPath,
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
      receipt: proposalRecord,
    });
    const dt = computeCurrentTipDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, dv, dr, tipRecord);
    if (core.bootstrapAnchorDigest !== dba) issues.push("core:anchor-mismatch");
    if (post.bootstrapAnchorDigest !== dba || post.genesisCoreDigest !== dbg)
      issues.push("post:core-anchor-mismatch");
    if (
      identity.authorityPath !== canonicalPointerPath ||
      identity.authorityPathInstanceDigest !== dp ||
      anchor.authorityPath !== canonicalPointerPath ||
      anchor.installationId !== identity.installationId ||
      anchor.projectId !== identity.projectId ||
      anchor.destinationStateRootDigest !== identity.stateRootDigest ||
      anchor.custodyInstanceDigest !== identity.custodyInstanceDigest ||
      authorityValue.installationId !== identity.installationId ||
      authorityValue.projectId !== identity.projectId ||
      authorityValue.stateRootDigest !== identity.stateRootDigest ||
      authorityValue.custodyInstanceDigest !== identity.custodyInstanceDigest ||
      authorityValue.rotationKind !== "GENESIS" ||
      authorityValue.producerKind !== "REVIEWED_BOOTSTRAP_GENESIS" ||
      authorityValue.globalIdentityDigest !== computeGlobalIdentityDigest(identity) ||
      core.globalIdentityDigest !== authorityValue.globalIdentityDigest ||
      core.bootstrapAnchorDigest !== dba ||
      core.transactionId !== anchor.bootstrapTransactionId ||
      core.authorityPathInstanceDigest !== dp ||
      core.authorityValueDigest !== dv ||
      core.genesisPositionDigest !== positionDigest ||
      proposalRecord.producerKind !== "REVIEWED_BOOTSTRAP_GENESIS" ||
      proposalRecord.producerDigest !== dbg ||
      proposalRecord.pathInstanceDigest !== dp ||
      proposalRecord.mutationId !== mutationId ||
      post.authorityPathInstanceDigest !== dp ||
      post.valueDigest !== dv ||
      post.proposalReceiptDigest !== dr ||
      post.tipDigest !== dt ||
      post.valueReadbackDigest !== dv ||
      post.proposalReadbackDigest !== dr ||
      post.tipReadbackDigest !== dt
    )
      issues.push("post:authority-mismatch");
    issues.push(
      ...validateAuthorityValueHistoryBinding({
        appendReceipt: null,
        authorityValue,
        globalIdentity: identity,
        historyRoot: closed.value.emptyRoot,
        leaf: null,
        priorHistoryRoot: null,
        successorCore: null,
        updateProof: null,
      }),
    );
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

export function validateAuthoritySingleUpdateWitness(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "globalIdentity",
    "leaf",
    "priorRoot",
    "proof",
    "successorRoot",
  ]);
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
    const identity = requireRecord(
      "state-mutation-global-identity/v1",
      closed.value.globalIdentity,
    );
    const issues: string[] = [];
    const g = computeGlobalIdentityDigest(identity);
    const de = computeAuthorityLeafDigest(leaf);
    const expectedEpochKey = computeAuthorityEpochKey({
      globalIdentityDigest: leaf.globalIdentityDigest as string,
      authorityPathInstanceDigest: leaf.authorityPathInstanceDigest as string,
      authorityTipDigest: leaf.authorityTipDigest as string,
      authorityValueDigest: leaf.authorityValueDigest as string,
      authorityReceiptDigest: leaf.authorityReceiptDigest as string,
    });
    const siblings = proof.siblingDigests as readonly string[];
    const emptyRoot = computeSparseAbsentRoot(leaf.epochKey as string, siblings);
    const presentRoot = computeSparseRoot(leaf.epochKey as string, de, siblings);
    const priorDigest =
      priorKind === "EMPTY"
        ? computeAuthorityEmptyRootDigest(prior)
        : computeAuthorityHistoryRootDigest(prior);
    const successorDh = computeAuthorityHistoryRootDigest(successor);
    if (leaf.epochKey !== expectedEpochKey) issues.push("epochKey:not-derived");
    if (
      leaf.globalIdentityDigest !== g ||
      leaf.authorityPathInstanceDigest !== identity.authorityPathInstanceDigest
    )
      issues.push("leaf:stable-global-authority-mismatch");
    for (const name of ["globalIdentityDigest", "epochKey"])
      if (proof[name] !== leaf[name]) issues.push(`${name}:mismatch`);
    if (
      prior.globalIdentityDigest !== leaf.globalIdentityDigest ||
      successor.globalIdentityDigest !== leaf.globalIdentityDigest
    )
      issues.push("globalIdentityDigest:root-mismatch");
    if (proof.leafDigest !== de) issues.push("leafDigest:mismatch");
    if (proof.priorRootDigest !== priorDigest || prior.treeRootDigest !== emptyRoot)
      issues.push("priorRootDigest:mismatch");
    if (proof.successorRootDigest !== successorDh || successor.treeRootDigest !== presentRoot)
      issues.push("successorRootDigest:mismatch");
    if (proof.priorCount !== prior.count || proof.successorCount !== successor.count)
      issues.push("count:root-mismatch");
    if (incrementDecimalAscii(prior.count as string) !== successor.count)
      issues.push("count:not-adjacent");
    if (leaf.authorityOrdinal !== prior.count) issues.push("authorityOrdinal:prior-count-mismatch");
    if ((priorKind === "EMPTY") !== (prior.count === "0"))
      issues.push("priorRootKind:count-mismatch");
    if (
      successor.latestEpochKey !== leaf.epochKey ||
      successor.latestIncludedOrdinal !== leaf.authorityOrdinal ||
      successor.latestTipDigest !== leaf.authorityTipDigest ||
      successor.latestValueDigest !== leaf.authorityValueDigest ||
      successor.latestReceiptDigest !== leaf.authorityReceiptDigest
    )
      issues.push("successor:latest-mismatch");
    return Object.freeze([...new Set(issues)].sort());
  } catch {
    return ["sparse-update:invalid"];
  }
}

export function validateAuthorityMembership(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "currentAuthoritySelection",
    "globalIdentity",
    "leaf",
    "root",
    "rootKind",
    "siblingDigests",
  ]);
  if (!closed.ok) return closed.issues;
  if (closed.value.rootKind === "EMPTY") return ["membership:empty-root-refused"];
  if (closed.value.rootKind !== "NONEMPTY") return ["rootKind:invalid"];
  try {
    const leaf = requireRecord("authority-history-leaf/v1", closed.value.leaf);
    const root = requireRecord("authority-history-root/v1", closed.value.root);
    const identity = requireRecord(
      "state-mutation-global-identity/v1",
      closed.value.globalIdentity,
    );
    const authority = resolveSelectedPointerEvidence(closed.value.currentAuthoritySelection);
    if (!authority.ok) return authority.issues.map((issue) => `authority:${issue}`);
    const siblings = snapshotClosedArray(closed.value.siblingDigests);
    if (!siblings.ok || siblings.value.length !== 256) return ["siblingDigests:invalid"];
    const issues: string[] = [];
    const g = computeGlobalIdentityDigest(identity);
    const expectedEpochKey = computeAuthorityEpochKey({
      globalIdentityDigest: leaf.globalIdentityDigest as string,
      authorityPathInstanceDigest: leaf.authorityPathInstanceDigest as string,
      authorityTipDigest: leaf.authorityTipDigest as string,
      authorityValueDigest: leaf.authorityValueDigest as string,
      authorityReceiptDigest: leaf.authorityReceiptDigest as string,
    });
    if (
      leaf.globalIdentityDigest !== root.globalIdentityDigest ||
      leaf.globalIdentityDigest !== g ||
      leaf.authorityPathInstanceDigest !== identity.authorityPathInstanceDigest ||
      authority.value.tip.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION" ||
      authority.value.value.globalIdentityDigest !== g ||
      authority.value.value.historyRootKind !== "NONEMPTY" ||
      authority.value.value.historyRootDigest !== computeAuthorityHistoryRootDigest(root) ||
      authority.value.value.historyCount !== root.count
    )
      issues.push("globalIdentityDigest:mismatch");
    if (leaf.epochKey !== expectedEpochKey) issues.push("epochKey:not-derived");
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

export function validateAuthorityHistoryNodeInventoryPage(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["afterPath", "complete", "nextAfterPath", "nodes"]);
  if (!closed.ok) return closed.issues;
  if (
    typeof closed.value.complete !== "boolean" ||
    (closed.value.afterPath !== null && typeof closed.value.afterPath !== "string") ||
    (closed.value.nextAfterPath !== null && typeof closed.value.nextAfterPath !== "string")
  )
    return ["page-cursor:invalid"];
  const nodePathPattern =
    /^installation\/state-mutation-authority-history\/nodes\/[0-9a-f]{64}\.json$/;
  if (
    (closed.value.afterPath !== null && !nodePathPattern.test(closed.value.afterPath)) ||
    (closed.value.nextAfterPath !== null && !nodePathPattern.test(closed.value.nextAfterPath))
  )
    return ["page-cursor:not-canonical-node-path"];
  const nodes = snapshotClosedArray(closed.value.nodes);
  if (!nodes.ok || nodes.value.length > 256) return ["nodes:invalid"];
  const issues: string[] = [];
  const paths: string[] = [];
  for (const [index, nodeInput] of nodes.value.entries()) {
    const parsed = validateAgainstSchema(
      approvedDefinitions["authority-history-node/v1"]!,
      nodeInput,
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    paths.push(String(parsed.value.recordPath));
  }
  if (new Set(paths).size !== paths.length) issues.push("nodes:duplicate-path");
  if (paths.join("\0") !== [...paths].sort().join("\0")) issues.push("nodes:not-sorted");
  if (
    closed.value.afterPath !== null &&
    paths.some((path) => path <= String(closed.value.afterPath))
  )
    issues.push("nodes:not-after-cursor");
  const expectedNext = paths.at(-1) ?? closed.value.afterPath;
  if (
    (closed.value.complete === true && closed.value.nextAfterPath !== null) ||
    (closed.value.complete === false &&
      (paths.length === 0 || closed.value.nextAfterPath !== expectedNext))
  )
    issues.push("nextAfterPath:mismatch");
  return Object.freeze([...new Set(issues)].sort());
}

export function validateAuthorityValueHistoryBinding(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "appendReceipt",
    "authorityValue",
    "globalIdentity",
    "historyRoot",
    "leaf",
    "priorHistoryRoot",
    "successorCore",
    "updateProof",
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
      if (
        closed.value.appendReceipt !== null ||
        closed.value.leaf !== null ||
        closed.value.priorHistoryRoot !== null ||
        closed.value.successorCore !== null ||
        closed.value.updateProof !== null ||
        authority.historyAppendReceiptDigest !== null
      )
        issues.push("historyAppendReceiptDigest:empty-present");
    } else {
      const leaf = requireRecord("authority-history-leaf/v1", closed.value.leaf);
      const priorHistoryRoot = closed.value.priorHistoryRoot;
      const updateProof = requireRecord(
        "authority-history-update-proof/v1",
        closed.value.updateProof,
      );
      const successorCore = requireRecord(
        "state-mutation-authority-successor-core/v1",
        closed.value.successorCore,
      );
      const append = requireRecord(
        "authority-history-append-receipt/v1",
        closed.value.appendReceipt,
      );
      const de = computeAuthorityLeafDigest(leaf);
      const dup = computeAuthorityUpdateProofDigest(updateProof);
      const coreDigest = computeAuthoritySuccessorCoreDigest(successorCore);
      const dar = computeAuthorityAppendReceiptDigest(append);
      if (authority.historyAppendReceiptDigest !== dar)
        issues.push("historyAppendReceiptDigest:mismatch");
      if (
        append.globalIdentityDigest !== g ||
        append.successorRootDigest !== rootDigest ||
        append.successorCount !== root.count
      )
        issues.push("appendReceipt:root-mismatch");
      if (
        root.latestEpochKey !== leaf.epochKey ||
        root.latestIncludedOrdinal !== leaf.authorityOrdinal ||
        root.latestTipDigest !== leaf.authorityTipDigest ||
        root.latestValueDigest !== leaf.authorityValueDigest ||
        root.latestReceiptDigest !== leaf.authorityReceiptDigest
      )
        issues.push("historyRoot:latest-leaf-mismatch");
      if (
        append.appendedEpochKey !== leaf.epochKey ||
        append.leafDigest !== de ||
        append.updateProofDigest !== dup ||
        append.successorCoreDigest !== coreDigest ||
        append.predecessorPathInstanceDigest !== leaf.authorityPathInstanceDigest ||
        append.predecessorTipDigest !== leaf.authorityTipDigest ||
        append.predecessorValueDigest !== leaf.authorityValueDigest ||
        append.predecessorReceiptDigest !== leaf.authorityReceiptDigest
      )
        issues.push("appendReceipt:evidence-mismatch");
      if (
        append.priorRootKind !== updateProof.priorRootKind ||
        append.priorRootDigest !== updateProof.priorRootDigest ||
        append.priorCount !== updateProof.priorCount ||
        append.successorRootDigest !== updateProof.successorRootDigest ||
        append.successorCount !== updateProof.successorCount
      )
        issues.push("appendReceipt:update-proof-mismatch");
      if (
        successorCore.globalIdentityDigest !== g ||
        successorCore.rotationOperationId !== append.rotationOperationId ||
        successorCore.predecessorTipDigest !== leaf.authorityTipDigest ||
        successorCore.predecessorValueDigest !== leaf.authorityValueDigest ||
        successorCore.predecessorReceiptDigest !== leaf.authorityReceiptDigest ||
        successorCore.successorOrdinal !== authority.authorityOrdinal ||
        successorCore.successorHistoryRootDigest !== rootDigest ||
        authority.successorCoreDigest !== coreDigest ||
        authority.rotationOperationId !== append.rotationOperationId ||
        authority.priorAuthorityTipDigest !== leaf.authorityTipDigest ||
        authority.priorAuthorityValueDigest !== leaf.authorityValueDigest ||
        authority.priorAuthorityReceiptDigest !== leaf.authorityReceiptDigest
      )
        issues.push("successorCore:authority-mismatch");
      issues.push(
        ...validateAuthoritySingleUpdateWitness({
          globalIdentity: identity,
          leaf,
          priorRoot: priorHistoryRoot,
          proof: updateProof,
          successorRoot: root,
        }),
      );
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
  destinationOwnerLock: (ddest: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/destination-owner.lock`,
  destinationOwnerValue: (ddest: string, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/values/${safeSha(mutationId)}.json`,
  destinationOwnerProposal: (ddest: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/proposals/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  destinationOwnerConflict: (ddest: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/conflicts/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  destinationOwnerRetention: (ddest: string) =>
    `state-mutation-destination-owners/${safeSha(ddest)}/retention.json`,
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
  bootstrapAnchorLock: (installationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/anchor.lock`,
  bootstrapAnchorValue: (installationId: string, mutationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/values/${safeSha(mutationId)}.json`,
  bootstrapAnchorProposal: (installationId: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/proposals/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  bootstrapAnchorConflict: (installationId: string, priorTip: string | null, mutationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/conflicts/${priorTip === null ? "genesis" : safeSha(priorTip)}/${safeSha(mutationId)}.json`,
  bootstrapAnchorUseIntent: (installationId: string, transactionId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/use-intents/${safeUuid(transactionId)}.json`,
  bootstrapAnchorConsumptionReceipt: (installationId: string, mutationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/consumption-receipts/${safeSha(mutationId)}.json`,
  bootstrapAnchorTeardownReceipt: (installationId: string, mutationId: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/teardown-receipts/${safeSha(mutationId)}.json`,
  bootstrapAnchorLifecycleArchive: (installationId: string, tipDigest: string) =>
    `state-mutation-authority-anchors/${safeUuid(installationId)}/lifecycle-archives/${safeSha(tipDigest)}.json`,
  bootstrapGenesisCore: (transactionId: string) =>
    `installation/bootstrap/state-mutation-authority-genesis/${safeUuid(transactionId)}/core.json`,
  bootstrapGenesisPost: (transactionId: string) =>
    `installation/bootstrap/state-mutation-authority-genesis/${safeUuid(transactionId)}/post-selection-receipt.json`,
  historyLeaf: (epochKey: string) =>
    `installation/state-mutation-authority-history/leaves/${safeSha(epochKey)}.json`,
  historyNode: (nodeDigest: string) =>
    `installation/state-mutation-authority-history/nodes/${safeSha(nodeDigest)}.json`,
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
    text(record.pointerKind as string),
    text(record.canonicalPointerPath as string),
    text(record.installationId as string),
    text(record.projectId as string),
    raw(record.stateRootDigest as string),
    ...(record.transactionId === null
      ? [fixed("00")]
      : [fixed("01"), text(record.transactionId as string)]),
    text(record.sourceToken as string),
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

export function computeRunIntentDigest(input: unknown): string {
  const record = requireRecord("pointer-mutation-run-intent/v1", input);
  return digest("pointer-mutation-run-intent/v1", [canonical(record)]);
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
      for (const name of [
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
        "runOrdinal",
      ])
        if (current[name] !== previous[name]) issues.push(`${index}:${name}:changed`);
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

type ProposedTargetEvidence = Readonly<{
  canonicalPointerPath: string;
  pathInstanceDigest: string;
  positionDigest: string;
  valueDigest: string;
  proposalReceiptDigest: string;
  value: ContractRecord;
  proposal: ContractRecord;
  pointerKind: (typeof pointerKinds)[number];
  installationId: string;
  projectId: string;
  stateRootDigest: string;
  transactionId: string | null;
  sourceToken: string;
}>;

function resolveProposedTargetEvidence(
  input: unknown,
):
  | { readonly ok: true; readonly value: ProposedTargetEvidence }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const parsed = validateAgainstSchema(
    approvedDefinitions["pointer-mutation-proposed-target-evidence/v1"]!,
    input,
  );
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  try {
    const record = parsed.value;
    const kind = record.pointerKind as (typeof pointerKinds)[number];
    const bindings = record.pathBindings as NonNullable<Parameters<typeof pointerPath>[1]>;
    const canonicalPointerPath = pointerPath(kind, bindings);
    if (canonicalPointerPath !== record.canonicalPointerPath)
      return { ok: false, issues: ["canonicalPointerPath:mismatch"] };
    const digestExtras = {
      ...(Object.hasOwn(bindings, "predecessorKey")
        ? { predecessorKey: bindings.predecessorKey as string }
        : {}),
      ...(Object.hasOwn(bindings, "pointerInstanceDigest")
        ? { retainedPointerInstanceDigest: bindings.pointerInstanceDigest as string }
        : {}),
      ...(Object.hasOwn(bindings, "targetMutationId")
        ? { targetMutationId: bindings.targetMutationId as string }
        : {}),
    };
    const pathInstanceDigest = computePointerInstanceDigest({
      pointerKind: kind,
      canonicalPointerPath,
      installationId: record.installationId as string,
      projectId: record.projectId as string,
      stateRootDigest: record.stateRootDigest as string,
      transactionId: record.transactionId as string | null,
      sourceToken: record.sourceToken as string,
      ...digestExtras,
    });
    const value = record.value as JsonValue;
    const valueDigest = computePointerValueDigest(kind, pathInstanceDigest, value);
    const expectedPosition = derivePointerPositionEvidence(kind, value, bindings);
    if (
      Buffer.compare(
        Buffer.from(canonicalBytes(expectedPosition)),
        Buffer.from(canonicalBytes(record.positionEvidence as JsonValue)),
      ) !== 0
    )
      return { ok: false, issues: ["positionEvidence:value-mismatch"] };
    const positionDigest = computePointerPositionDigest(kind, expectedPosition);
    const proposal = requireRecord("pointer-cas-proposal-receipt/v2", record.proposal);
    const mutationId = computeMutationId({
      pointerKind: kind,
      canonicalPointerPath,
      pathInstanceDigest,
      transactionId: record.transactionId as string | null,
      sourceToken: record.sourceToken as string,
      positionEvidence: expectedPosition,
      priorDt: proposal.priorTipDigest as string | null,
      priorDv: proposal.priorValueDigest as string | null,
      priorDr: proposal.priorReceiptDigest as string | null,
      successorDv: valueDigest,
      outcome: proposal.outcome as string,
      intent: proposal.intent as string,
      ...digestExtras,
    });
    if (
      proposal.pointerKind !== kind ||
      proposal.pathInstanceDigest !== pathInstanceDigest ||
      proposal.successorValueDigest !== valueDigest ||
      proposal.positionDigest !== positionDigest ||
      proposal.mutationId !== mutationId
    )
      return { ok: false, issues: ["proposal:derived-binding-mismatch"] };
    const proposalReceiptDigest = computeProposalReceiptDigest({
      pointerKind: kind,
      pathInstanceDigest,
      mutationId,
      priorDt: proposal.priorTipDigest as string | null,
      priorDv: proposal.priorValueDigest as string | null,
      priorDr: proposal.priorReceiptDigest as string | null,
      successorDv: valueDigest,
      positionDigest,
      intent: proposal.intent as "VALUE_PROPOSED" | "TOMBSTONE_PROPOSED",
      outcome: proposal.outcome as "SELECT" | "REMOVE",
      producerKind: proposal.producerKind as "REVIEWED_BOOTSTRAP_GENESIS" | "SELECTED_EPOCH",
      producerDigest: proposal.producerDigest as string,
      authorityEpochDt: proposal.authorityEpochTipDigest as string | null,
      authorityEpochDv: proposal.authorityEpochValueDigest as string | null,
      authorityEpochDr: proposal.authorityEpochReceiptDigest as string | null,
      receipt: proposal,
    });
    return {
      ok: true,
      value: Object.freeze({
        canonicalPointerPath,
        pathInstanceDigest,
        positionDigest,
        valueDigest,
        proposalReceiptDigest,
        value: requireRecord(String((value as ContractRecord).schemaVersion), value),
        proposal,
        pointerKind: kind,
        installationId: record.installationId as string,
        projectId: record.projectId as string,
        stateRootDigest: record.stateRootDigest as string,
        transactionId: record.transactionId as string | null,
        sourceToken: record.sourceToken as string,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `proposal:${error.message}` : "proposal:invalid"],
    };
  }
}

export function validateCommitRunComposition(input: unknown): readonly string[] {
  const parsed = validateAgainstSchema(
    approvedDefinitions["pointer-mutation-commit-evidence/v1"]!,
    input,
  );
  if (!parsed.ok) return parsed.issues;
  const checkpoints = snapshotClosedArray(parsed.value.checkpoints);
  if (!checkpoints.ok || checkpoints.value.length !== commitRunStages.length)
    return ["checkpoints:invalid"];
  const authority = resolveSelectedPointerEvidence(parsed.value.authoritySelection);
  if (!authority.ok) return authority.issues.map((issue) => `authoritySelection:${issue}`);
  if (authority.value.tip.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION")
    return ["authoritySelection:pointer-kind-mismatch"];
  if (!validateEpochSequence(parsed.value.epochSequence)) return ["epochSequence:invalid"];
  const issues: string[] = [];
  let intent: ContractRecord;
  try {
    intent = requireRecord("pointer-mutation-run-intent/v1", parsed.value.intent);
  } catch {
    return ["intent:invalid"];
  }
  const selectedTarget =
    parsed.value.selectedTarget === null
      ? null
      : resolveSelectedPointerEvidence(parsed.value.selectedTarget);
  const proposedTarget =
    parsed.value.proposedTarget === null
      ? null
      : resolveProposedTargetEvidence(parsed.value.proposedTarget);
  if (selectedTarget && !selectedTarget.ok)
    return selectedTarget.issues.map((issue) => `selectedTarget:${issue}`);
  if (proposedTarget && !proposedTarget.ok)
    return proposedTarget.issues.map((issue) => `proposedTarget:${issue}`);
  const proposed = selectedTarget?.ok
    ? {
        ...selectedTarget.value,
        pointerKind: selectedTarget.value.tip.pointerKind as (typeof pointerKinds)[number],
        mutationId: selectedTarget.value.proposal.mutationId as string,
        priorTipDigest: selectedTarget.value.proposal.priorTipDigest as string | null,
        priorValueDigest: selectedTarget.value.proposal.priorValueDigest as string | null,
        priorReceiptDigest: selectedTarget.value.proposal.priorReceiptDigest as string | null,
      }
    : proposedTarget?.ok
      ? {
          ...proposedTarget.value,
          mutationId: proposedTarget.value.proposal.mutationId as string,
          priorTipDigest: proposedTarget.value.proposal.priorTipDigest as string | null,
          priorValueDigest: proposedTarget.value.proposal.priorValueDigest as string | null,
          priorReceiptDigest: proposedTarget.value.proposal.priorReceiptDigest as string | null,
        }
      : {
          canonicalPointerPath: intent.canonicalPointerPath as string,
          pathInstanceDigest: intent.targetPathInstanceDigest as string,
          valueDigest: intent.expectedSuccessorValueDigest as string,
          proposalReceiptDigest: null,
          tipDigest: null,
          pointerKind: intent.pointerKind as (typeof pointerKinds)[number],
          mutationId: intent.targetMutationId as string,
          priorTipDigest: intent.expectedPriorTipDigest as string | null,
          priorValueDigest: intent.expectedPriorValueDigest as string | null,
          priorReceiptDigest: intent.expectedPriorReceiptDigest as string | null,
          installationId: intent.installationId as string,
          projectId: intent.projectId as string,
          stateRootDigest: intent.stateRootDigest as string,
          transactionId: intent.transactionId as string | null,
          sourceToken: intent.sourceToken as string,
          proposal: null,
        };
  if (
    intent.globalIdentityDigest !== authority.value.value.globalIdentityDigest ||
    intent.pointerKind !== proposed.pointerKind ||
    intent.canonicalPointerPath !== proposed.canonicalPointerPath ||
    intent.installationId !== proposed.installationId ||
    intent.projectId !== proposed.projectId ||
    intent.stateRootDigest !== proposed.stateRootDigest ||
    intent.transactionId !== proposed.transactionId ||
    intent.sourceToken !== proposed.sourceToken ||
    intent.targetPathInstanceDigest !== proposed.pathInstanceDigest ||
    intent.targetMutationId !== proposed.mutationId ||
    intent.expectedPriorTipDigest !== proposed.priorTipDigest ||
    intent.expectedPriorValueDigest !== proposed.priorValueDigest ||
    intent.expectedPriorReceiptDigest !== proposed.priorReceiptDigest ||
    intent.expectedSuccessorValueDigest !== proposed.valueDigest
  )
    issues.push("intent:target-binding-mismatch");
  const epochEntries = snapshotClosedArray(parsed.value.epochSequence);
  if (epochEntries.ok)
    for (const [index, entryInput] of epochEntries.value.entries()) {
      const entry = snapshotClosedRecord(entryInput, [
        "authorityEpochDigest",
        "authorityEpochReceiptDigest",
        "authorityEpochTipDigest",
        "authorityEpochValueDigest",
        "step",
      ]);
      if (
        !entry.ok ||
        entry.value.authorityEpochDigest !== authority.value.valueDigest ||
        entry.value.authorityEpochTipDigest !== authority.value.tipDigest ||
        entry.value.authorityEpochValueDigest !== authority.value.valueDigest ||
        entry.value.authorityEpochReceiptDigest !== authority.value.proposalReceiptDigest
      )
        issues.push(`epochSequence:${index}:authority-selection-mismatch`);
    }
  for (const identityName of ["installationId", "projectId", "stateRootDigest"] as const)
    if (proposed[identityName] !== authority.value[identityName])
      issues.push(`targetProposal:${identityName}-authority-mismatch`);
  if (proposed.proposal)
    for (const [proposalName, expected] of [
      ["authorityEpochTipDigest", authority.value.tipDigest],
      ["authorityEpochValueDigest", authority.value.valueDigest],
      ["authorityEpochReceiptDigest", authority.value.proposalReceiptDigest],
    ] as const)
      if (proposed.proposal[proposalName] !== expected)
        issues.push(`targetProposal:${proposalName}-mismatch`);
  const cores: ContractRecord[] = [];
  let priorAudit: string | null = null;
  let selectedRunId: string | undefined;
  let priorSelector:
    | {
        readonly tipDigest: string;
        readonly valueDigest: string;
        readonly proposalReceiptDigest: string;
      }
    | undefined;
  let priorPostDigest: string | null = null;
  for (const [index, rawEntry] of checkpoints.value.entries()) {
    const entry = validateAgainstSchema(
      approvedDefinitions["pointer-mutation-run-checkpoint-evidence/v1"]!,
      rawEntry,
    );
    if (!entry.ok) {
      issues.push(...entry.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    try {
      const segment = requireRecord("pointer-mutation-run-segment/v1", entry.value.segment);
      const core = requireRecord("pointer-mutation-run-checkpoint-core/v1", entry.value.core);
      const post = requireRecord(
        "pointer-mutation-run-selector-post-selection-observation/v1",
        entry.value.postSelectionObservation,
      );
      const selector = resolveSelectedPointerEvidence(entry.value.selectorSelection);
      if (!selector.ok) {
        issues.push(...selector.issues.map((issue) => `${index}:selector:${issue}`));
        continue;
      }
      if (selector.value.tip.pointerKind !== "POINTER_MUTATION_RUN_CURRENT")
        issues.push(`${index}:selector:pointer-kind-mismatch`);
      for (const [proposalName, expected] of [
        ["authorityEpochTipDigest", authority.value.tipDigest],
        ["authorityEpochValueDigest", authority.value.valueDigest],
        ["authorityEpochReceiptDigest", authority.value.proposalReceiptDigest],
      ] as const)
        if (selector.value.proposal[proposalName] !== expected)
          issues.push(`${index}:selector:${proposalName}-mismatch`);
      const selectorValue = requireRecord(
        "pointer-mutation-run-current-value/v1",
        selector.value.value,
      );
      const segmentDigest = computeRunSegmentDigest(segment);
      const auditDigest = computeRunAuditDigest(priorAudit, segmentDigest);
      const coreDigest = computeRunCheckpointCoreDigest(core);
      const postDigest = computeRunPostSelectionDigest(post);
      const expectedRunId = computeRunId({
        globalIdentityDigest: intent.globalIdentityDigest as string,
        targetMutationId: intent.targetMutationId as string,
        runOrdinal: core.runOrdinal as string,
        priorCheckpointDigest: intent.priorCheckpointDigest as string | null,
        authorityPathInstanceDigest: authority.value.pathInstanceDigest,
        authorityTipDigest: authority.value.tipDigest,
        authorityValueDigest: authority.value.valueDigest,
        authorityReceiptDigest: authority.value.proposalReceiptDigest,
      });
      if (segment.runId !== expectedRunId) issues.push(`${index}:runId:not-derived`);
      if (String(intent.createdAt) > String(segment.recordedAt))
        issues.push(`${index}:segment:before-intent`);
      if (selectedRunId === undefined) selectedRunId = String(segment.runId);
      else if (segment.runId !== selectedRunId) issues.push(`${index}:runId:changed`);
      for (const name of [
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
        if (segment[name] !== core[name]) issues.push(`${index}:${name}:segment-core-mismatch`);
      if (
        core.globalIdentityDigest !== authority.value.value.globalIdentityDigest ||
        core.globalIdentityDigest !==
          (cores[0]?.globalIdentityDigest ?? core.globalIdentityDigest) ||
        core.targetPathInstanceDigest !== proposed.pathInstanceDigest ||
        core.targetMutationId !== proposed.mutationId ||
        core.pointerKind !== proposed.pointerKind ||
        core.canonicalPointerPath !== proposed.canonicalPointerPath ||
        core.installationId !== proposed.installationId ||
        core.projectId !== proposed.projectId ||
        core.stateRootDigest !== proposed.stateRootDigest ||
        core.transactionId !== proposed.transactionId ||
        core.sourceToken !== proposed.sourceToken ||
        core.runOrdinal !== segment.runOrdinal ||
        core.stage !== segment.stage ||
        core.segmentDigest !== segmentDigest ||
        core.auditDigest !== auditDigest
      )
        issues.push(`${index}:core:derived-binding-mismatch`);
      if (
        core.priorSelectorTipDigest !== (priorSelector?.tipDigest ?? null) ||
        core.priorSelectorValueDigest !== (priorSelector?.valueDigest ?? null) ||
        core.priorSelectorReceiptDigest !== (priorSelector?.proposalReceiptDigest ?? null) ||
        core.priorPostSelectionObservationDigest !== priorPostDigest
      )
        issues.push(`${index}:core:predecessor-mismatch`);
      if (
        selectorValue.targetPathInstanceDigest !== core.targetPathInstanceDigest ||
        selectorValue.targetMutationId !== core.targetMutationId ||
        selectorValue.checkpointCoreDigest !== coreDigest ||
        selectorValue.runOrdinal !== core.runOrdinal ||
        selectorValue.checkpointOrdinal !== core.checkpointOrdinal ||
        selectorValue.stage !== core.stage ||
        selectorValue.phase !== core.phase ||
        selectorValue.terminalResolutionDigest !== core.terminalResolutionDigest
      )
        issues.push(`${index}:selector:value-core-mismatch`);
      if (
        post.checkpointCoreDigest !== coreDigest ||
        post.selectorPathInstanceDigest !== selector.value.pathInstanceDigest ||
        post.selectorMutationId !== selector.value.proposal.mutationId ||
        post.selectorValueDigest !== selector.value.valueDigest ||
        post.selectorReceiptDigest !== selector.value.proposalReceiptDigest ||
        post.selectorTipDigest !== selector.value.tipDigest ||
        post.valueReadbackDigest !== selector.value.valueDigest ||
        post.proposalReadbackDigest !== selector.value.proposalReceiptDigest ||
        post.tipReadbackDigest !== selector.value.tipDigest
      )
        issues.push(`${index}:post:selector-mismatch`);
      const terminal = entry.value.terminalResolution;
      if (index < 7) {
        if (terminal !== null) issues.push(`${index}:terminal:premature`);
      } else {
        const resolution = requireRecord("pointer-mutation-commit-resolution/v1", terminal);
        const resolutionDigest = computeCommitResolutionDigest(resolution);
        const producerEpochKey = computeAuthorityEpochKey({
          globalIdentityDigest: core.globalIdentityDigest as string,
          authorityPathInstanceDigest: authority.value.pathInstanceDigest,
          authorityTipDigest: authority.value.tipDigest,
          authorityValueDigest: authority.value.valueDigest,
          authorityReceiptDigest: authority.value.proposalReceiptDigest,
        });
        if (
          core.terminalResolutionDigest !== resolutionDigest ||
          resolution.targetPathInstanceDigest !== core.targetPathInstanceDigest ||
          resolution.targetMutationId !== core.targetMutationId ||
          resolution.outcome !== core.phase ||
          resolution.producerEpochKey !== producerEpochKey ||
          (resolution.outcome === "SELECTED" &&
            resolution.selectedTargetTipDigest !== selectedTarget?.value.tipDigest)
        )
          issues.push(`${index}:terminal:binding-mismatch`);
      }
      cores.push(core);
      priorAudit = auditDigest;
      priorSelector = selector.value;
      priorPostDigest = postDigest;
    } catch {
      issues.push(`${index}:composition:invalid`);
    }
  }
  const finalPhase = cores.at(-1)?.phase;
  if (finalPhase !== parsed.value.outcome) issues.push("outcome:checkpoint-phase-mismatch");
  if (finalPhase === "SELECTED") {
    if (parsed.value.conflictEvidence !== null || parsed.value.unknownEvidence !== null)
      issues.push("outcomeEvidence:selected-extra");
  } else if (finalPhase === "LOST_CONFLICT") {
    if (parsed.value.unknownEvidence !== null) issues.push("outcomeEvidence:lost-unknown-extra");
    const conflict = validateAgainstSchema(
      approvedDefinitions["pointer-mutation-conflict-evidence/v1"]!,
      parsed.value.conflictEvidence,
    );
    const finalResolutionInput = (checkpoints.value.at(-1) as ContractRecord | undefined)
      ?.terminalResolution;
    try {
      if (!conflict.ok) throw new TypeError("conflict:invalid");
      const receipt = requireRecord("pointer-conflict-receipt/v1", conflict.value.receipt);
      const winner = resolveSelectedPointerEvidence(conflict.value.winningSelection);
      const finalResolution = requireRecord(
        "pointer-mutation-commit-resolution/v1",
        finalResolutionInput,
      );
      if (!winner.ok) throw new TypeError("winner:invalid");
      if (
        winner.value.pathInstanceDigest !== proposed.pathInstanceDigest ||
        winner.value.canonicalPointerPath !== proposed.canonicalPointerPath ||
        winner.value.installationId !== proposed.installationId ||
        winner.value.projectId !== proposed.projectId ||
        winner.value.stateRootDigest !== proposed.stateRootDigest ||
        winner.value.transactionId !== proposed.transactionId ||
        winner.value.sourceToken !== proposed.sourceToken ||
        receipt.pathInstanceDigest !== proposed.pathInstanceDigest ||
        receipt.mutationId !== proposed.mutationId ||
        receipt.losingProposalReceiptDigest !== proposed.proposalReceiptDigest ||
        receipt.losingSuccessorValueDigest !== proposed.valueDigest ||
        receipt.winningTipDigest !== winner.value.tipDigest ||
        receipt.winningValueDigest !== winner.value.valueDigest ||
        receipt.winningReceiptDigest !== winner.value.proposalReceiptDigest
      )
        throw new TypeError("conflict:cross-binding-mismatch");
      const dc = computeConflictDigest({
        pathInstanceDigest: proposed.pathInstanceDigest,
        mutationId: proposed.mutationId,
        losingDr: proposed.proposalReceiptDigest as string,
        losingDv: proposed.valueDigest,
        winningDt: winner.value.tipDigest,
        winningDv: winner.value.valueDigest,
        winningDr: winner.value.proposalReceiptDigest,
        conflictKind: receipt.conflictKind as string,
        authorityEpochDt: authority.value.tipDigest,
        authorityEpochDv: authority.value.valueDigest,
        authorityEpochDr: authority.value.proposalReceiptDigest,
        conflictAt: receipt.conflictAt as string,
        receipt,
      });
      if (finalResolution.conflictReceiptDigest !== dc)
        issues.push("outcomeEvidence:conflict-digest-mismatch");
    } catch {
      issues.push("outcomeEvidence:conflict-invalid");
    }
  } else if (finalPhase === "UNKNOWN_TERMINAL") {
    if (parsed.value.conflictEvidence !== null)
      issues.push("outcomeEvidence:unknown-conflict-extra");
    try {
      const unknown = requireRecord(
        "pointer-mutation-unknown-evidence/v1",
        parsed.value.unknownEvidence,
      );
      const finalResolution = requireRecord(
        "pointer-mutation-commit-resolution/v1",
        (checkpoints.value.at(-1) as ContractRecord | undefined)?.terminalResolution,
      );
      const unknownDigest = digest("pointer-mutation-unknown-evidence/v1", [canonical(unknown)]);
      if (
        unknown.targetPathInstanceDigest !== proposed.pathInstanceDigest ||
        unknown.targetMutationId !== proposed.mutationId ||
        String(unknown.observedAt) < String(intent.createdAt) ||
        finalResolution.unknownEvidenceDigest !== unknownDigest
      )
        issues.push("outcomeEvidence:unknown-binding-mismatch");
    } catch {
      issues.push("outcomeEvidence:unknown-invalid");
    }
  }
  issues.push(...validateCommitRunSequence(cores));
  return Object.freeze([...new Set(issues)].sort());
}

export function validateEvidencePacketV2(input: unknown): readonly string[] {
  const parsed = validateAgainstSchema(approvedDefinitions["pointer-evidence-packet/v2"]!, input);
  if (!parsed.ok) return parsed.issues;
  const record = parsed.value;
  const slots = snapshotClosedArray(record.evidenceSlots);
  const memberships = snapshotClosedArray(record.producerMemberships);
  if (!slots.ok || !memberships.ok) return ["packet:arrays-invalid"];
  const issues: string[] = [];
  let g: string | undefined;
  let identityRecord: ContractRecord | undefined;
  try {
    identityRecord = requireRecord("state-mutation-global-identity/v1", record.globalIdentity);
    g = computeGlobalIdentityDigest(identityRecord);
  } catch {
    issues.push("globalIdentity:invalid");
  }
  const authority = resolveSelectedPointerEvidence(record.currentAuthoritySelection);
  if (!authority.ok) issues.push(...authority.issues.map((issue) => `authority:${issue}`));
  else if (
    authority.value.tip.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION" ||
    authority.value.value.globalIdentityDigest !== g
  )
    issues.push("authority:global-binding-mismatch");
  const historyBinding = snapshotClosedRecord(record.authorityHistoryBinding, [
    "appendReceipt",
    "authorityValue",
    "globalIdentity",
    "historyRoot",
    "leaf",
    "priorHistoryRoot",
    "successorCore",
    "updateProof",
  ]);
  if (!historyBinding.ok) issues.push(...historyBinding.issues.map((issue) => `history:${issue}`));
  else {
    issues.push(
      ...validateAuthorityValueHistoryBinding(historyBinding.value).map(
        (issue) => `history:${issue}`,
      ),
    );
    if (authority.ok) {
      const boundAuthority = historyBinding.value.authorityValue as ContractRecord;
      if (
        Buffer.compare(
          Buffer.from(canonicalBytes(boundAuthority)),
          Buffer.from(canonicalBytes(authority.value.value)),
        ) !== 0
      )
        issues.push("history:authority-selection-mismatch");
    }
  }
  if (slots.value.length !== pointerKinds.length)
    issues.push("evidenceSlots:registry-census-mismatch");
  const seen = new Set<string>();
  const usedMembershipIndexes = new Set<number>();
  for (const [index, slotInput] of slots.value.entries()) {
    const slot = validateAgainstSchema(approvedDefinitions["pointer-evidence-slot/v2"]!, slotInput);
    if (!slot.ok) {
      issues.push(...slot.issues.map((issue) => `slot:${index}:${issue}`));
      continue;
    }
    if (slot.value.pointerKind !== pointerKinds[index]) issues.push(`slot:${index}:kind-order`);
    if (seen.has(slot.value.pointerKind as string)) issues.push(`slot:${index}:duplicate-kind`);
    seen.add(slot.value.pointerKind as string);
    if (slot.value.selectedEvidence !== null) {
      const selected = resolveSelectedPointerEvidence(slot.value.selectedEvidence);
      if (!selected.ok) issues.push(...selected.issues.map((issue) => `slot:${index}:${issue}`));
      else if (selected.value.tip.pointerKind !== slot.value.pointerKind)
        issues.push(`slot:${index}:pointer-kind-mismatch`);
      const membershipIndex = Number(slot.value.producerMembershipIndex);
      if (!Number.isSafeInteger(membershipIndex) || membershipIndex >= memberships.value.length)
        issues.push(`slot:${index}:membership-index-invalid`);
      else if (selected.ok) {
        usedMembershipIndexes.add(membershipIndex);
        const membership = validateAgainstSchema(
          approvedDefinitions["authority-membership-evidence/v1"]!,
          memberships.value[membershipIndex],
        );
        if (membership.ok) {
          const leaf = validateAgainstSchema(
            approvedDefinitions["authority-history-leaf/v1"]!,
            membership.value.leaf,
          );
          if (!leaf.ok) issues.push(`slot:${index}:producer-leaf-invalid`);
          else if (
            selected.value.proposal.authorityEpochTipDigest !== leaf.value.authorityTipDigest ||
            selected.value.proposal.authorityEpochValueDigest !== leaf.value.authorityValueDigest ||
            selected.value.proposal.authorityEpochReceiptDigest !==
              leaf.value.authorityReceiptDigest ||
            selected.value.installationId !== identityRecord?.installationId ||
            selected.value.projectId !== identityRecord?.projectId ||
            selected.value.stateRootDigest !== identityRecord?.stateRootDigest
          )
            issues.push(`slot:${index}:producer-membership-mismatch`);
        }
      }
    }
  }
  if (memberships.value.length > pointerKinds.length) issues.push("producerMemberships:unbounded");
  const membershipEpochKeys: string[] = [];
  for (const [index, membershipInput] of memberships.value.entries()) {
    const membership = validateAgainstSchema(
      approvedDefinitions["authority-membership-evidence/v1"]!,
      membershipInput,
    );
    if (!membership.ok)
      issues.push(...membership.issues.map((issue) => `membership:${index}:${issue}`));
    else {
      const membershipAuthority = resolveSelectedPointerEvidence(
        membership.value.currentAuthoritySelection,
      );
      if (
        !authority.ok ||
        !membershipAuthority.ok ||
        membershipAuthority.value.tipDigest !== authority.value.tipDigest ||
        membershipAuthority.value.valueDigest !== authority.value.valueDigest ||
        membershipAuthority.value.proposalReceiptDigest !== authority.value.proposalReceiptDigest
      )
        issues.push(`membership:${index}:current-authority-mismatch`);
      try {
        const membershipIdentity = requireRecord(
          "state-mutation-global-identity/v1",
          membership.value.globalIdentity,
        );
        const leaf = requireRecord("authority-history-leaf/v1", membership.value.leaf);
        membershipEpochKeys.push(String(leaf.epochKey));
        if (computeGlobalIdentityDigest(membershipIdentity) !== g)
          issues.push(`membership:${index}:global-identity-mismatch`);
      } catch {
        issues.push(`membership:${index}:identity-or-leaf-invalid`);
      }
      issues.push(
        ...validateAuthorityMembership(membership.value).map(
          (issue) => `membership:${index}:${issue}`,
        ),
      );
    }
  }
  if (usedMembershipIndexes.size !== memberships.value.length)
    issues.push("producerMemberships:unused-entry");
  if (new Set(membershipEpochKeys).size !== membershipEpochKeys.length)
    issues.push("producerMemberships:duplicate-epoch");
  if (membershipEpochKeys.join("\0") !== [...membershipEpochKeys].sort().join("\0"))
    issues.push("producerMemberships:not-sorted");
  if (record.purpose === "MUTATION_COMMIT") {
    issues.push(
      ...validateCommitRunComposition(record.currentCommit).map((issue) => `commit:${issue}`),
    );
    const commit = validateAgainstSchema(
      approvedDefinitions["pointer-mutation-commit-evidence/v1"]!,
      record.currentCommit,
    );
    if (commit.ok) {
      const commitAuthority = resolveSelectedPointerEvidence(commit.value.authoritySelection);
      if (
        !authority.ok ||
        !commitAuthority.ok ||
        commitAuthority.value.tipDigest !== authority.value.tipDigest ||
        commitAuthority.value.valueDigest !== authority.value.valueDigest ||
        commitAuthority.value.proposalReceiptDigest !== authority.value.proposalReceiptDigest
      )
        issues.push("commit:top-authority-mismatch");
      let canonicalTarget: ReturnType<typeof resolveSelectedPointerEvidence> | undefined;
      let targetKind: (typeof pointerKinds)[number] | undefined;
      if (commit.value.outcome === "SELECTED") {
        canonicalTarget = resolveSelectedPointerEvidence(commit.value.selectedTarget);
        if (canonicalTarget.ok)
          targetKind = canonicalTarget.value.tip.pointerKind as (typeof pointerKinds)[number];
      } else if (commit.value.outcome === "LOST_CONFLICT") {
        const conflict = validateAgainstSchema(
          approvedDefinitions["pointer-mutation-conflict-evidence/v1"]!,
          commit.value.conflictEvidence,
        );
        if (conflict.ok) {
          canonicalTarget = resolveSelectedPointerEvidence(conflict.value.winningSelection);
          if (canonicalTarget.ok)
            targetKind = canonicalTarget.value.tip.pointerKind as (typeof pointerKinds)[number];
        }
      } else {
        try {
          const intent = requireRecord("pointer-mutation-run-intent/v1", commit.value.intent);
          targetKind = intent.pointerKind as (typeof pointerKinds)[number];
        } catch {
          issues.push("commit:intent-invalid");
        }
      }
      if (targetKind) {
        const targetSlotIndex = pointerKinds.indexOf(targetKind);
        const targetSlot =
          targetSlotIndex < 0
            ? undefined
            : validateAgainstSchema(
                approvedDefinitions["pointer-evidence-slot/v2"]!,
                slots.value[targetSlotIndex],
              );
        const slotTarget =
          targetSlot?.ok && targetSlot.value.selectedEvidence !== null
            ? resolveSelectedPointerEvidence(targetSlot.value.selectedEvidence)
            : undefined;
        if (commit.value.outcome === "UNKNOWN_TERMINAL") {
          if (targetSlot?.ok && targetSlot.value.selectedEvidence !== null)
            issues.push("commit:unknown-target-slot-must-be-empty");
        } else if (
          !canonicalTarget?.ok ||
          !slotTarget?.ok ||
          slotTarget.value.tipDigest !== canonicalTarget.value.tipDigest ||
          slotTarget.value.valueDigest !== canonicalTarget.value.valueDigest ||
          slotTarget.value.proposalReceiptDigest !== canonicalTarget.value.proposalReceiptDigest
        ) {
          issues.push("commit:target-registry-slot-mismatch");
        }
      }
    }
  }
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

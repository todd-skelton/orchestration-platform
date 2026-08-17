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
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
} from "./definitions.js";

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
    authority: true as const,
    fields: Object.freeze({ schemaVersion: field("schema-id"), ...fields }),
    ...(validate ? { validate } : {}),
  });

const sha = field("sha256");
const nullableSha = nullable("sha256");
const uuid = field("uuid-v7");
const timestamp = field("timestamp");
const path = field("relative-path");
const opaque = field("opaque");
const integer = field("integer");
const value = (record: ContractRecord, name: string): JsonValue => record[name]!;
const nullGroup = (record: ContractRecord, names: readonly string[]): boolean =>
  names.every((name) => value(record, name) === null);
const presentGroup = (record: ContractRecord, names: readonly string[]): boolean =>
  names.every((name) => value(record, name) !== null);
const exactOptionalGroup = (record: ContractRecord, names: readonly string[]): readonly string[] =>
  nullGroup(record, names) || presentGroup(record, names)
    ? []
    : [`${names.join("+")}:partial-group`];

export const pointerKinds = Object.freeze([
  "ACTIVE_RELEASE",
  "ACTIVATION_CLEANUP_GATE",
  "ACTIVATION_RECOVERY_FENCE",
  "ACTIVATION_RECOVERY_LAUNCH",
  "RECOVERY_AUTHORIZATION_STATE",
  "RECOVERY_AUTHORIZATION_ATTACHMENT",
  "RECOVERY_ATTEMPT_ACCUMULATOR",
  "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
  "AUTHORITY_RETENTION",
  "RECOVERY_ATTEMPT_RESERVATION",
  "STATE_MUTATION_AUTHORITY_ROTATION",
] as const);
export type PointerKind = (typeof pointerKinds)[number];
export const stateMutationLockPath = "installation/state-mutation.lock";
export const stateMutationAuthorityPath = "installation/state-mutation-authority.json";
export const stateMutationRegistry = Object.freeze({
  lock: Object.freeze({ path: stateMutationLockPath, singleton: true, symlinkAllowed: false }),
  authority: Object.freeze({ path: stateMutationAuthorityPath, singleton: true }),
});

export interface PointerRegistryRow {
  readonly kind: PointerKind;
  readonly singleton: boolean;
  readonly pathTemplate: string;
  readonly sourceTokens: readonly string[];
  readonly retention: "FULL_REQUIRED" | "TERMINAL_CHECKPOINT_ALLOWED";
  readonly valueSchemas: readonly string[];
}

const pointerRows: readonly PointerRegistryRow[] = [
  {
    kind: "ACTIVE_RELEASE",
    singleton: true,
    pathTemplate: "installation/active-release.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["active-release/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "ACTIVATION_CLEANUP_GATE",
    singleton: true,
    pathTemplate: "installation/activation-cleanup-gate.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-cleanup-gate-head/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "ACTIVATION_RECOVERY_FENCE",
    singleton: true,
    pathTemplate: "installation/activation-recovery-fence.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-recovery-fence-head/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "ACTIVATION_RECOVERY_LAUNCH",
    singleton: false,
    pathTemplate: "installation/activation-recovery-launches/<transaction>/<source>/current.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "TERMINAL_CHECKPOINT_ALLOWED",
    valueSchemas: ["activation-recovery-launch/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "RECOVERY_AUTHORIZATION_STATE",
    singleton: false,
    pathTemplate: "installation/recovery-authorizations/<transaction>/state.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-authorization-state/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "RECOVERY_AUTHORIZATION_ATTACHMENT",
    singleton: false,
    pathTemplate: "installation/recovery-authorizations/<transaction>/attachment.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-authorization-attachment/v1", "pointer-tombstone-value/v1"],
  },
  {
    kind: "RECOVERY_ATTEMPT_ACCUMULATOR",
    singleton: false,
    pathTemplate:
      "installation/activation-recovery-launches/<transaction>/<source>/accumulator.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "TERMINAL_CHECKPOINT_ALLOWED",
    valueSchemas: ["recovery-attempt-accumulator/v1", "pointer-tombstone-value/v1"],
  },
  {
    kind: "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
    singleton: true,
    pathTemplate: "installation/activation-cleanup/archive-head.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-cleanup-archive-head/v2", "pointer-tombstone-value/v1"],
  },
  {
    kind: "AUTHORITY_RETENTION",
    singleton: false,
    pathTemplate: "installation/authority-retention/<pointer-instance-digest>.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["authority-retention/v1"],
  },
  {
    kind: "RECOVERY_ATTEMPT_RESERVATION",
    singleton: false,
    pathTemplate:
      "installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-attempt-reservation/v1", "pointer-tombstone-value/v1"],
  },
  {
    kind: "STATE_MUTATION_AUTHORITY_ROTATION",
    singleton: true,
    pathTemplate: stateMutationAuthorityPath,
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["state-mutation-authority-value/v1"],
  },
];
export const pointerRegistry: readonly PointerRegistryRow[] = Object.freeze(
  pointerRows.map((row) =>
    Object.freeze({
      ...row,
      sourceTokens: Object.freeze(row.sourceTokens),
      valueSchemas: Object.freeze(row.valueSchemas),
    }),
  ),
);

function safeSegment(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,126}$/.test(value)) throw new TypeError(`${label}:invalid`);
  return value;
}
function safeDigest(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label}:invalid`);
  return value;
}
export function pointerPath(
  kind: PointerKind,
  bindings: {
    transactionId?: string;
    sourceToken?: string;
    predecessorKey?: string;
    pointerInstanceDigest?: string;
  } = {},
): string {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) throw new TypeError("pointer-kind:unsupported");
  let result = row.pathTemplate;
  if (result.includes("<transaction>"))
    result = result.replace(
      "<transaction>",
      safeSegment(bindings.transactionId ?? "", "transactionId"),
    );
  if (result.includes("<source>")) {
    const source = bindings.sourceToken ?? "";
    if (!row.sourceTokens.includes(source)) throw new TypeError("sourceToken:invalid");
    result = result.replace("<source>", source);
  }
  if (result.includes("<predecessor-key>"))
    result = result.replace(
      "<predecessor-key>",
      safeDigest(bindings.predecessorKey ?? "", "predecessorKey"),
    );
  if (result.includes("<pointer-instance-digest>"))
    result = result.replace(
      "<pointer-instance-digest>",
      safeDigest(bindings.pointerInstanceDigest ?? "", "pointerInstanceDigest"),
    );
  return result;
}

export function validatePointerDispatch(
  kind: PointerKind,
  observedPath: string,
  schemaVersion: string,
  bindings: Parameters<typeof pointerPath>[1] = {},
): readonly string[] {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) return ["pointerKind:unsupported"];
  let expectedPath: string;
  try {
    expectedPath = pointerPath(kind, bindings);
  } catch {
    return ["pointerPath:invalid-bindings"];
  }
  const issues: string[] = [];
  if (observedPath !== expectedPath) issues.push("pointerPath:mismatch");
  if (!row.valueSchemas.includes(schemaVersion)) issues.push("schemaVersion:wrong-pointer-family");
  return Object.freeze(issues);
}

type FramePart =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "raw32"; readonly value: string }
  | { readonly type: "nullable-raw32"; readonly value: string | null }
  | { readonly type: "canonical"; readonly value: JsonValue };

const encoder = new TextEncoder();
function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}
function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}
function hexBytes(value: string): Uint8Array {
  safeDigest(value, "digest");
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function framedBytes(domainTag: string, parts: readonly FramePart[]): Uint8Array {
  if (!/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/.test(domainTag)) throw new TypeError("domainTag:invalid");
  const chunks: Uint8Array[] = [
    encoder.encode("orchestration-platform\0"),
    encoder.encode(`${domainTag}\0`),
    u32(parts.length),
  ];
  for (const part of parts) {
    let tag: number;
    let bytes: Uint8Array;
    if (part.type === "text") {
      tag = 1;
      bytes = encoder.encode(part.value);
    } else if (part.type === "raw32") {
      tag = 2;
      bytes = hexBytes(part.value);
    } else if (part.type === "nullable-raw32") {
      tag = part.value === null ? 3 : 4;
      bytes = part.value === null ? new Uint8Array() : hexBytes(part.value);
    } else {
      tag = 5;
      bytes = canonicalBytes(part.value);
    }
    chunks.push(Uint8Array.of(tag), u64(bytes.length), bytes);
  }
  return concat(chunks);
}
function hashFrame(domain: string, parts: readonly FramePart[]): string {
  return createHash("sha256").update(framedBytes(domain, parts)).digest("hex");
}
const textPart = (value: string): FramePart => ({ type: "text", value });
const rawPart = (value: string): FramePart => ({ type: "raw32", value });
const nullableRawPart = (value: string | null): FramePart => ({ type: "nullable-raw32", value });
const canonicalPart = (value: JsonValue): FramePart => ({ type: "canonical", value });

export function computePointerValueDigest(
  kind: PointerKind,
  pathInstanceDigest: string,
  value: JsonValue,
): string {
  return hashFrame("pointer-value/v2", [
    textPart(kind),
    rawPart(pathInstanceDigest),
    canonicalPart(value),
  ]);
}
export interface PointerInstanceDigestInput {
  pointerKind: PointerKind;
  canonicalPointerPath: string;
  installationId: string;
  projectId: string;
  stateRootDigest: string;
  transactionId: string | null;
  sourceToken: string;
}
export function computePointerInstanceDigest(input: PointerInstanceDigestInput): string {
  return hashFrame("pointer-instance/v2", [
    textPart(input.pointerKind),
    textPart(input.canonicalPointerPath),
    textPart(input.installationId),
    textPart(input.projectId),
    rawPart(input.stateRootDigest),
    textPart(input.transactionId ?? "null"),
    textPart(input.sourceToken),
  ]);
}
export interface ProposalDigestInput {
  pointerKind: PointerKind;
  pathInstanceDigest: string;
  mutationId: string;
  priorDt: string | null;
  priorDv: string | null;
  priorDr: string | null;
  successorDv: string;
  positionDigest: string;
  intent: "VALUE_PROPOSED" | "TOMBSTONE_PROPOSED";
  outcome: "SELECT" | "REMOVE";
  receipt: JsonValue;
}
export function computeProposalReceiptDigest(input: ProposalDigestInput): string {
  return hashFrame("pointer-receipt/v2", [
    textPart(input.pointerKind),
    rawPart(input.pathInstanceDigest),
    rawPart(input.mutationId),
    nullableRawPart(input.priorDt),
    nullableRawPart(input.priorDv),
    nullableRawPart(input.priorDr),
    rawPart(input.successorDv),
    rawPart(input.positionDigest),
    textPart(input.intent),
    textPart(input.outcome),
    canonicalPart(input.receipt),
  ]);
}
export function computeCurrentTipDigest(
  kind: PointerKind,
  pathInstanceDigest: string,
  dv: string,
  dr: string,
  tip: JsonValue,
): string {
  return hashFrame("pointer-tip/v2", [
    textPart(kind),
    rawPart(pathInstanceDigest),
    rawPart(dv),
    rawPart(dr),
    canonicalPart(tip),
  ]);
}
export interface MutationDigestInput {
  pointerKind: PointerKind;
  canonicalPointerPath: string;
  pathInstanceDigest: string;
  transactionId: string | null;
  sourceToken: string;
  positionDigest: string;
  priorDt: string | null;
  priorDv: string | null;
  priorDr: string | null;
  successorDv: string;
  outcome: string;
  intent: string;
}
export function computeMutationId(input: MutationDigestInput): string {
  return hashFrame("pointer-mutation-id/v2", [
    textPart(input.pointerKind),
    textPart(input.canonicalPointerPath),
    rawPart(input.pathInstanceDigest),
    textPart(input.transactionId ?? "null"),
    textPart(input.sourceToken),
    rawPart(input.positionDigest),
    nullableRawPart(input.priorDt),
    nullableRawPart(input.priorDv),
    nullableRawPart(input.priorDr),
    rawPart(input.successorDv),
    textPart(input.outcome),
    textPart(input.intent),
  ]);
}
export interface ConflictDigestInput {
  pathInstanceDigest: string;
  mutationId: string;
  losingDr: string;
  losingDv: string;
  winningDt: string;
  winningDv: string;
  winningDr: string;
  conflictKind: string;
  authorityEpochDt: string;
  authorityEpochDv: string;
  authorityEpochDr: string;
  conflictAt: string;
  receipt: JsonValue;
}
export function computeConflictDigest(input: ConflictDigestInput): string {
  return hashFrame("pointer-conflict-receipt/v1", [
    rawPart(input.pathInstanceDigest),
    rawPart(input.mutationId),
    rawPart(input.losingDr),
    rawPart(input.losingDv),
    rawPart(input.winningDt),
    rawPart(input.winningDv),
    rawPart(input.winningDr),
    textPart(input.conflictKind),
    rawPart(input.authorityEpochDt),
    rawPart(input.authorityEpochDv),
    rawPart(input.authorityEpochDr),
    textPart(input.conflictAt),
    canonicalPart(input.receipt),
  ]);
}

export type ProposalClassification =
  "PENDING" | "SELECTED" | "LOST_CONFLICT" | "COMPACTED" | "UNKNOWN";
export function classifyProposal(input: unknown): ProposalClassification {
  const closed = snapshotClosedRecord(input, [
    "compacted",
    "conflictMatchesWinner",
    "malformed",
    "selectedTipMatches",
  ]);
  if (!closed.ok) return "UNKNOWN";
  if (closed.value.malformed === true) return "UNKNOWN";
  if (closed.value.selectedTipMatches === true) return "SELECTED";
  if (closed.value.conflictMatchesWinner === true) return "LOST_CONFLICT";
  if (closed.value.compacted === true) return "COMPACTED";
  if (
    closed.value.selectedTipMatches === false &&
    closed.value.conflictMatchesWinner === false &&
    closed.value.compacted === false
  )
    return "PENDING";
  return "UNKNOWN";
}

export type RetentionOperation =
  | "EXISTING_RECOVERY"
  | "EXISTING_RETRY"
  | "EXISTING_CLEANUP"
  | "SELECTED_ATTACHMENT"
  | "ORDINARY_NON_RELEASE_TICK"
  | "NEW_PROMOTION"
  | "NEW_BOOTSTRAP"
  | "CERTIFICATION"
  | "UNRELATED_AUTHORIZATION"
  | "UNRELATED_ATTACHMENT"
  | "COMPACTION"
  | "AUDIT_FINALIZATION";
const degradedAllowed = new Set<RetentionOperation>([
  "EXISTING_RECOVERY",
  "EXISTING_RETRY",
  "EXISTING_CLEANUP",
  "SELECTED_ATTACHMENT",
  "ORDINARY_NON_RELEASE_TICK",
]);
export function retentionAllows(
  status:
    "CURRENT" | "CHECKPOINTED" | "COMPACTION_PLANNED" | "COMPACTED" | "AUDIT_DEGRADED" | "UNKNOWN",
  operation: RetentionOperation,
): boolean {
  if (status === "UNKNOWN") return false;
  if (status === "AUDIT_DEGRADED") return degradedAllowed.has(operation);
  return true;
}

export function validateRetentionTransition(previous: unknown, next: unknown): boolean {
  const allowed = new Set([
    "CURRENT>CHECKPOINTED",
    "CHECKPOINTED>COMPACTION_PLANNED",
    "COMPACTION_PLANNED>COMPACTED",
    "COMPACTED>AUDIT_DEGRADED",
  ]);
  return (
    typeof previous === "string" && typeof next === "string" && allowed.has(`${previous}>${next}`)
  );
}

export const v2Definitions = Object.freeze(
  Object.fromEntries(
    [
      define("pointer-current-tip/v1", {
        pointerKind: enumeration(...pointerKinds),
        pathInstanceDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
      }),
      define(
        "pointer-cas-proposal-receipt/v1",
        {
          pointerKind: enumeration(...pointerKinds),
          pathInstanceDigest: sha,
          mutationId: sha,
          priorTipDigest: nullableSha,
          priorValueDigest: nullableSha,
          priorReceiptDigest: nullableSha,
          successorValueDigest: sha,
          positionDigest: sha,
          intent: enumeration("VALUE_PROPOSED", "TOMBSTONE_PROPOSED"),
          outcome: enumeration("SELECT", "REMOVE"),
          authorityEpochTipDigest: sha,
          authorityEpochValueDigest: sha,
          authorityEpochReceiptDigest: sha,
          proposedAt: timestamp,
        },
        (record) =>
          exactOptionalGroup(record, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"]),
      ),
      define("pointer-conflict-receipt/v1", {
        pathInstanceDigest: sha,
        mutationId: sha,
        losingProposalReceiptDigest: sha,
        losingSuccessorValueDigest: sha,
        winningTipDigest: sha,
        winningValueDigest: sha,
        winningReceiptDigest: sha,
        conflictKind: enumeration("VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"),
        authorityEpochTipDigest: sha,
        authorityEpochValueDigest: sha,
        authorityEpochReceiptDigest: sha,
        conflictAt: timestamp,
      }),
      define("pointer-tombstone-value/v1", {
        pointerKind: enumeration(...pointerKinds),
        priorTipDigest: sha,
        priorValueDigest: sha,
        priorReceiptDigest: sha,
        archiveDigest: sha,
        terminalProofDigest: sha,
        tombstonedAt: timestamp,
      }),
      define("authority-retention/v1", {
        pointerKind: enumeration(...pointerKinds),
        pathInstanceDigest: sha,
        mode: enumeration("FULL_REQUIRED", "TERMINAL_CHECKPOINT_ALLOWED"),
        status: enumeration(
          "CURRENT",
          "CHECKPOINTED",
          "COMPACTION_PLANNED",
          "COMPACTED",
          "AUDIT_DEGRADED",
          "UNKNOWN",
        ),
        checkpointDigest: nullableSha,
        compactionPlanDigest: nullableSha,
        completionReceiptDigest: nullableSha,
        updatedAt: timestamp,
      }),
      define("state-mutation-authority-value/v1", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        helperPath: path,
        helperDigest: sha,
        helperProfileDigest: sha,
        helperAbi: enumeration("portable-state-cas/v2"),
        lockPath: enumeration(stateMutationLockPath),
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
        producerKind: enumeration("REVIEWED_BOOTSTRAP", "SELECTED_STABLE"),
        producerDigest: sha,
        selectedAt: timestamp,
      }),
      define("active-release/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        releaseDigest: sha,
        executablePath: path,
        executableDigest: sha,
        operationManifestDigest: sha,
        cleanupTransactionId: uuid,
        cleanupArchivePath: path,
        cleanupArchiveDigest: nullableSha,
        activatedAt: timestamp,
      }),
      define("activation-cleanup-gate-root/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        mode: enumeration("BOOTSTRAP", "SUCCESSOR"),
        candidateDigest: sha,
        authorizationCoreDigest: sha,
        authorizationCreatedTipDigest: sha,
        authorizationCreatedValueDigest: sha,
        authorizationCreatedReceiptDigest: sha,
        expectedActiveReleaseDigest: sha,
        expectedFenceRootDigest: nullableSha,
        priorCleanupArchiveHeadDigest: nullableSha,
        createdAt: timestamp,
      }),
      define(
        "activation-cleanup-gate-head/v2",
        {
          rootDigest: sha,
          ordinal: integer,
          previousHeadDigest: nullableSha,
          lifecycle: enumeration("PENDING", "ACTIVATING", "ABORTING", "COMPLETE"),
          publication: enumeration("NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"),
          fenceDigest: nullableSha,
          terminalProofDigest: nullableSha,
          recordedAt: timestamp,
        },
        (record) => {
          const issues: string[] = [];
          if (
            !isCleanupLifecyclePublicationPair(
              value(record, "lifecycle"),
              value(record, "publication"),
            )
          )
            issues.push("lifecycle+publication:inadmissible");
          if ((value(record, "ordinal") === 0) !== (value(record, "previousHeadDigest") === null))
            issues.push("previousHeadDigest:ordinal-mismatch");
          return issues;
        },
      ),
      define("activation-recovery-fence-root/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        predecessorReleaseDigest: sha,
        successorReleaseDigest: sha,
        predecessorExecutableDigest: sha,
        successorExecutableDigest: sha,
        predecessorOperationManifestDigest: sha,
        successorOperationManifestDigest: sha,
        pendingAdmissionDigest: sha,
        expectedActiveReleaseDigest: sha,
        createdAt: timestamp,
      }),
      define(
        "activation-recovery-fence-head/v2",
        {
          rootDigest: sha,
          ordinal: integer,
          previousHeadDigest: nullableSha,
          lifecycle: enumeration("PREPARED", "POST_ACTIVATION"),
          recordedAt: timestamp,
        },
        (record) =>
          (value(record, "ordinal") === 0) === (value(record, "previousHeadDigest") === null)
            ? []
            : ["previousHeadDigest:ordinal-mismatch"],
      ),
      define("activation-recovery-launch/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
        attemptId: uuid,
        ordinal: integer,
        previousRecordDigest: nullableSha,
        lifecycle: enumeration(
          "READY",
          "LIVE",
          "TERMINAL_RETRYABLE",
          "TERMINAL_HANDOFF",
          "TERMINAL_ABORTED",
          "TERMINAL_COMPLETE",
          "UNKNOWN",
        ),
        gateRootDigest: sha,
        gateHeadDigest: sha,
        fenceRootDigest: nullableSha,
        fenceHeadDigest: nullableSha,
        activeReleaseDigest: sha,
        argvDigest: sha,
        processIdentityDigest: nullableSha,
        recordedAt: timestamp,
      }),
      define(
        "recovery-attempt-reservation/v1",
        {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          predecessorAccumulatorTipDigest: nullableSha,
          predecessorAccumulatorValueDigest: nullableSha,
          predecessorAccumulatorReceiptDigest: nullableSha,
          attemptId: uuid,
          descriptorInputsDigest: sha,
          lifecycle: enumeration("RESERVED", "CONSUMED", "TERMINAL", "TOMBSTONE"),
          selectedAt: timestamp,
        },
        (record) =>
          exactOptionalGroup(record, [
            "predecessorAccumulatorTipDigest",
            "predecessorAccumulatorValueDigest",
            "predecessorAccumulatorReceiptDigest",
          ]),
      ),
      define(
        "recovery-attempt-descriptor/v1",
        {
          attemptId: uuid,
          reservationTipDigest: sha,
          reservationValueDigest: sha,
          reservationReceiptDigest: sha,
          lifecycle: enumeration("READY_ONLY", "LIVE"),
          readyRecordDigest: sha,
          initialLiveRecordDigest: nullableSha,
          argvDigest: sha,
          processIdentityDigest: nullableSha,
          startedAt: nullable("timestamp"),
        },
        (record) => {
          const live = value(record, "lifecycle") === "LIVE";
          return live ===
            presentGroup(record, ["initialLiveRecordDigest", "processIdentityDigest", "startedAt"])
            ? []
            : ["lifecycle:live-fields-mismatch"];
        },
      ),
      define("recovery-attempt-terminal-summary/v1", {
        attemptId: uuid,
        descriptorDigest: sha,
        attachmentTipDigest: nullableSha,
        terminalRecordDigest: sha,
        terminalLifecycle: enumeration(
          "TERMINAL_RETRYABLE",
          "TERMINAL_HANDOFF",
          "TERMINAL_ABORTED",
          "TERMINAL_COMPLETE",
        ),
        processExitProofDigest: sha,
        channelDenialProofDigest: sha,
        revocationProofDigest: nullableSha,
        terminalAt: timestamp,
      }),
      define(
        "recovery-attempt-accumulator/v1",
        {
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          lifecycle: enumeration("IN_PROGRESS", "TERMINAL"),
          reservationTipDigest: sha,
          descriptorDigest: sha,
          priorTerminalAccumulatorTipDigest: nullableSha,
          priorTerminalAccumulatorValueDigest: nullableSha,
          priorTerminalAccumulatorReceiptDigest: nullableSha,
          terminalSummaryDigest: nullableSha,
          rollingDigest: nullableSha,
          updatedAt: timestamp,
        },
        (record) => {
          const issues = [
            ...exactOptionalGroup(record, [
              "priorTerminalAccumulatorTipDigest",
              "priorTerminalAccumulatorValueDigest",
              "priorTerminalAccumulatorReceiptDigest",
            ]),
          ];
          const terminal = value(record, "lifecycle") === "TERMINAL";
          if (terminal !== presentGroup(record, ["terminalSummaryDigest", "rollingDigest"]))
            issues.push("lifecycle:terminal-fields-mismatch");
          return issues;
        },
      ),
      define("activation-cleanup-archive-head/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        archivePath: path,
        archiveDigest: sha,
        activeReleaseDigest: sha,
        previousArchiveHeadDigest: nullableSha,
        selectedAt: timestamp,
      }),
      define(
        "recovery-authorization-core/v1",
        {
          transactionId: uuid,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          hostDigest: sha,
          userDigest: sha,
          issuedAt: timestamp,
          expiresAt: timestamp,
          capabilityReferenceDigest: sha,
          capabilityDigest: sha,
          nativeGeneration: integer,
          mode: enumeration("BOOTSTRAP", "SUCCESSOR"),
          producerDigest: sha,
          grantDigest: nullableSha,
          installerDigest: nullableSha,
          candidateDigest: sha,
          destinationDigest: nullableSha,
          cycleId: nullable("uuid-v7"),
          admissionDigest: nullableSha,
          priorBrokerGeneration: nullable("integer"),
          successorBrokerGeneration: nullable("integer"),
          expectedActiveGeneration: nullable("integer"),
          predecessorReleaseDigest: nullableSha,
          successorReleaseDigest: nullableSha,
          predecessorExecutableDigest: nullableSha,
          successorExecutableDigest: nullableSha,
          predecessorOperationManifestDigest: nullableSha,
          successorOperationManifestDigest: nullableSha,
          fencePath: nullable("relative-path"),
          fenceDigest: nullableSha,
        },
        (record) => {
          const bootstrap = ["grantDigest", "installerDigest", "destinationDigest"];
          const successor = [
            "cycleId",
            "admissionDigest",
            "priorBrokerGeneration",
            "successorBrokerGeneration",
            "expectedActiveGeneration",
            "predecessorReleaseDigest",
            "successorReleaseDigest",
            "predecessorExecutableDigest",
            "successorExecutableDigest",
            "predecessorOperationManifestDigest",
            "successorOperationManifestDigest",
            "fencePath",
            "fenceDigest",
          ];
          if (value(record, "mode") === "BOOTSTRAP")
            return presentGroup(record, bootstrap) && nullGroup(record, successor)
              ? []
              : ["mode:bootstrap-fields-mismatch"];
          return nullGroup(record, bootstrap) && presentGroup(record, successor)
            ? []
            : ["mode:successor-fields-mismatch"];
        },
      ),
      define(
        "recovery-authorization-state/v2",
        {
          transactionId: uuid,
          coreDigest: sha,
          gateRootDigest: nullableSha,
          lifecycle: enumeration("CREATED", "CONSUMED", "REVOKED", "REMOVED"),
          consumeOperationId: uuid,
          nativeConsumeReceiptPath: path,
          nativeConsumeReceiptDigest: nullableSha,
          postConsumeReceiptDigest: nullableSha,
          nativeRemovalReceiptDigest: nullableSha,
          postRevokeReceiptDigest: nullableSha,
          selectedAt: timestamp,
        },
        (record) => {
          const consumed = ["nativeConsumeReceiptDigest", "postConsumeReceiptDigest"];
          const revoked = ["nativeRemovalReceiptDigest", "postRevokeReceiptDigest"];
          switch (value(record, "lifecycle")) {
            case "CREATED":
              return nullGroup(record, ["gateRootDigest", ...consumed, ...revoked])
                ? []
                : ["lifecycle:created-fields-mismatch"];
            case "CONSUMED":
              return presentGroup(record, ["gateRootDigest", ...consumed]) &&
                nullGroup(record, revoked)
                ? []
                : ["lifecycle:consumed-fields-mismatch"];
            default:
              return presentGroup(record, ["gateRootDigest", ...consumed, ...revoked])
                ? []
                : ["lifecycle:revoked-fields-mismatch"];
          }
        },
      ),
      define("native-consume-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        coreDigest: sha,
        capabilityReferenceDigest: sha,
        nativeGeneration: integer,
        consumedAt: timestamp,
      }),
      define("recovery-authorization-consume-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        authorizationTipDigest: sha,
        authorizationValueDigest: sha,
        authorizationReceiptDigest: sha,
        nativeConsumeReceiptDigest: sha,
        coreDigest: sha,
        gateRootDigest: sha,
        consumedAt: timestamp,
      }),
      define("native-removal-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        capabilityReferenceDigest: sha,
        nativeConsumeReceiptDigest: sha,
        removedAt: timestamp,
      }),
      define("recovery-authorization-revoke-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        authorizationTipDigest: sha,
        authorizationValueDigest: sha,
        authorizationReceiptDigest: sha,
        nativeRemovalReceiptDigest: sha,
        revokedAt: timestamp,
      }),
      define(
        "recovery-authorization-attachment/v1",
        {
          transactionId: uuid,
          lifecycle: enumeration("UNATTACHED", "ATTACHED", "TERMINAL", "REMOVED"),
          authorizationTipDigest: sha,
          reservationTipDigest: nullableSha,
          descriptorDigest: nullableSha,
          gateHeadDigest: nullableSha,
          fenceHeadDigest: nullableSha,
          activeReleaseDigest: nullableSha,
          brokerClientDigest: nullableSha,
          argvDigest: nullableSha,
          processIdentityDigest: nullableSha,
          priorTerminalAccumulatorTipDigest: nullableSha,
          terminalSummaryDigest: nullableSha,
          selectedAt: timestamp,
        },
        (record) => {
          const attached = [
            "reservationTipDigest",
            "descriptorDigest",
            "gateHeadDigest",
            "fenceHeadDigest",
            "activeReleaseDigest",
            "brokerClientDigest",
            "argvDigest",
            "processIdentityDigest",
          ];
          switch (value(record, "lifecycle")) {
            case "UNATTACHED":
              return nullGroup(record, [
                ...attached,
                "priorTerminalAccumulatorTipDigest",
                "terminalSummaryDigest",
              ])
                ? []
                : ["lifecycle:unattached-fields-mismatch"];
            case "ATTACHED":
              return presentGroup(record, attached) &&
                value(record, "terminalSummaryDigest") === null
                ? []
                : ["lifecycle:attached-fields-mismatch"];
            default:
              return presentGroup(record, [...attached, "terminalSummaryDigest"])
                ? []
                : ["lifecycle:terminal-fields-mismatch"];
          }
        },
      ),
    ].map((definition) => [definition.schemaVersion, definition]),
  ) as Readonly<Record<string, SchemaDefinition>>,
);

export const v2SchemaVersions = Object.freeze(Object.keys(v2Definitions).sort());

export function validateCleanupHeadHistory(input: unknown): readonly string[] {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return snapshot.issues;
  if (
    snapshot.value.length === 0 ||
    snapshot.value.length > fixedEvidencePacketLimits.maximumGateHeads
  )
    return ["cleanup-history:length-refused"];
  const issues: string[] = [];
  let previous: ContractRecord | undefined;
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const parsed = validateAgainstSchema(
      v2Definitions["activation-cleanup-gate-head/v2"]!,
      snapshot.value[index],
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    if (record.ordinal !== index) issues.push(`${index}:ordinal-mismatch`);
    if (index === 0) {
      if (record.previousHeadDigest !== null) issues.push("0:non-null-predecessor");
    } else if (previous) {
      if (record.previousHeadDigest !== canonicalDigest(previous))
        issues.push(`${index}:previous-digest-mismatch`);
      if (
        !isCleanupLifecyclePublicationTransition(
          previous.lifecycle,
          previous.publication,
          record.lifecycle,
          record.publication,
        )
      )
        issues.push(`${index}:invalid-edge`);
    }
    previous = record;
  }
  return Object.freeze(issues);
}

export function validateFenceHeadHistory(input: unknown): readonly string[] {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return snapshot.issues;
  if (snapshot.value.length < 1 || snapshot.value.length > 2)
    return ["fence-history:length-refused"];
  const issues: string[] = [];
  let previous: ContractRecord | undefined;
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const parsed = validateAgainstSchema(
      v2Definitions["activation-recovery-fence-head/v2"]!,
      snapshot.value[index],
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    if (record.ordinal !== index) issues.push(`${index}:ordinal-mismatch`);
    if (index === 0 && record.lifecycle !== "PREPARED") issues.push("0:initial-lifecycle");
    if (
      index === 1 &&
      (record.lifecycle !== "POST_ACTIVATION" ||
        !previous ||
        record.previousHeadDigest !== canonicalDigest(previous))
    )
      issues.push("1:transition-mismatch");
    previous = record;
  }
  return Object.freeze(issues);
}

export function validateAuthorizationReceiptChain(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["nativeConsume", "postConsume", "state"]);
  if (!closed.ok) return closed.issues;
  const state = validateAgainstSchema(
    v2Definitions["recovery-authorization-state/v2"]!,
    closed.value.state,
  );
  const nativeReceipt = validateAgainstSchema(
    v2Definitions["native-consume-receipt/v1"]!,
    closed.value.nativeConsume,
  );
  const postReceipt = validateAgainstSchema(
    v2Definitions["recovery-authorization-consume-receipt/v1"]!,
    closed.value.postConsume,
  );
  if (!state.ok || !nativeReceipt.ok || !postReceipt.ok)
    return Object.freeze([
      ...(!state.ok ? state.issues.map((issue) => `state:${issue}`) : []),
      ...(!nativeReceipt.ok ? nativeReceipt.issues.map((issue) => `native:${issue}`) : []),
      ...(!postReceipt.ok ? postReceipt.issues.map((issue) => `post:${issue}`) : []),
    ]);
  const issues: string[] = [];
  for (const name of ["transactionId", "coreDigest", "operationId"] as const) {
    const stateName = name === "operationId" ? "consumeOperationId" : name;
    if (postReceipt.value[name] !== nativeReceipt.value[name])
      issues.push(`${name}:native-post-mismatch`);
    if (name !== "operationId" && postReceipt.value[name] !== state.value[stateName])
      issues.push(`${name}:state-post-mismatch`);
    if (name === "operationId" && nativeReceipt.value[name] !== state.value[stateName])
      issues.push(`${name}:state-native-mismatch`);
  }
  if (state.value.nativeConsumeReceiptDigest !== canonicalDigest(nativeReceipt.value))
    issues.push("nativeConsumeReceiptDigest:mismatch");
  if (postReceipt.value.nativeConsumeReceiptDigest !== canonicalDigest(nativeReceipt.value))
    issues.push("post:nativeConsumeReceiptDigest:mismatch");
  if (state.value.postConsumeReceiptDigest !== canonicalDigest(postReceipt.value))
    issues.push("postConsumeReceiptDigest:mismatch");
  return Object.freeze(issues);
}

export const fixedEvidencePacketLimits = Object.freeze({
  maximumGateHeads: 64,
  maximumFenceHeads: 2,
  maximumLaunchRecords: 64,
  maximumPriorTerminalSummaries: 1,
  maximumPointerProposalsPerBucket: 16,
});

export function validateEvidencePacket(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "fenceHistory",
    "gateHistory",
    "launchHistory",
    "priorTerminalSummaries",
  ]);
  if (!closed.ok) return closed.issues;
  const issues: string[] = [];
  for (const [name, limit] of Object.entries({
    gateHistory: fixedEvidencePacketLimits.maximumGateHeads,
    fenceHistory: fixedEvidencePacketLimits.maximumFenceHeads,
    launchHistory: fixedEvidencePacketLimits.maximumLaunchRecords,
    priorTerminalSummaries: fixedEvidencePacketLimits.maximumPriorTerminalSummaries,
  })) {
    const arrayResult = snapshotClosedArray(closed.value[name]);
    if (!arrayResult.ok) issues.push(...arrayResult.issues.map((issue) => `${name}:${issue}`));
    else if (arrayResult.value.length > limit) issues.push(`${name}:limit-exceeded`);
  }
  return Object.freeze(issues);
}

export type EpochSequenceStep =
  | "LOCK_ACQUIRED"
  | "AUTHORITY_READ"
  | "TARGET_RECONCILED"
  | "VALUE_PROPOSAL_WRITTEN"
  | "AUTHORITY_REREAD_PRE_CAS"
  | "TARGET_CAS_READBACK"
  | "PROPOSAL_CLASSIFIED"
  | "AUTHORITY_REREAD_POST_CAS"
  | "LOCK_RELEASED";
export const ordinaryEpochSequence: readonly EpochSequenceStep[] = Object.freeze([
  "LOCK_ACQUIRED",
  "AUTHORITY_READ",
  "TARGET_RECONCILED",
  "VALUE_PROPOSAL_WRITTEN",
  "AUTHORITY_REREAD_PRE_CAS",
  "TARGET_CAS_READBACK",
  "PROPOSAL_CLASSIFIED",
  "AUTHORITY_REREAD_POST_CAS",
  "LOCK_RELEASED",
]);
export function validateEpochSequence(input: unknown): boolean {
  const snapshot = snapshotClosedArray(input);
  return (
    snapshot.ok &&
    snapshot.value.length === ordinaryEpochSequence.length &&
    snapshot.value.every((entry, index) => entry === ordinaryEpochSequence[index])
  );
}
export function validateRotationCensus(input: unknown): boolean {
  const snapshot = snapshotClosedRecord(input, [
    "authorityEpochDigest",
    "otherPointerKinds",
    "pendingCount",
    "unknownCount",
  ]);
  if (
    !snapshot.ok ||
    snapshot.value.pendingCount !== 0 ||
    snapshot.value.unknownCount !== 0 ||
    typeof snapshot.value.authorityEpochDigest !== "string"
  )
    return false;
  const kinds = snapshotClosedArray(snapshot.value.otherPointerKinds);
  if (!kinds.ok) return false;
  const expected = pointerKinds
    .filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION")
    .sort();
  return (
    kinds.value.length === expected.length &&
    [...kinds.value].sort().every((kind, index) => kind === expected[index])
  );
}

export function recoveryAccumulatorDigest(
  priorValueDigest: string | null,
  terminalSummaryDigest: string,
): string {
  return priorValueDigest === null
    ? hashFrame("recovery-attempt-accumulator/v1", [
        textPart("0x00"),
        rawPart(terminalSummaryDigest),
      ])
    : hashFrame("recovery-attempt-accumulator/v1", [
        textPart("0x01"),
        rawPart(priorValueDigest),
        rawPart(terminalSummaryDigest),
      ]);
}

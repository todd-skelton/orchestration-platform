import {
  canonicalDigest,
  snapshotClosedRecord,
  validateAgainstSchema,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
  type SchemaDefinition,
} from "./runtime.js";

const field = (kind: FieldRule["kind"], options: Omit<FieldRule, "kind"> = {}): FieldRule =>
  Object.freeze({ kind, ...options });
const enumeration = (...values: readonly string[]): FieldRule =>
  field("opaque", { values: Object.freeze([...values]) });
const nullableEnumeration = (...values: readonly string[]): FieldRule =>
  field("opaque", { nullable: true, values: Object.freeze([...values]) });
const nullable = (kind: FieldRule["kind"]): FieldRule => field(kind, { nullable: true });
const array = (kind: FieldRule["kind"]): FieldRule => field(kind, { array: true });
const text = (record: ContractRecord, name: string): string => record[name] as string;
const integer = (record: ContractRecord, name: string): number => record[name] as number;

export type CleanupLifecycle = "PENDING" | "ACTIVATING" | "ABORTING" | "COMPLETE";
export type CleanupPublication = "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "CLEARED";

const cleanupPairs = Object.freeze({
  PENDING: Object.freeze(["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED"] as const),
  ACTIVATING: Object.freeze(["PUBLISHED"] as const),
  ABORTING: Object.freeze(["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"] as const),
  COMPLETE: Object.freeze(["NOT_PUBLISHED", "CLEARED"] as const),
}) satisfies Readonly<Record<CleanupLifecycle, readonly CleanupPublication[]>>;

export function isCleanupLifecyclePublicationPair(
  lifecycle: unknown,
  publication: unknown,
): lifecycle is CleanupLifecycle {
  return (
    typeof lifecycle === "string" &&
    typeof publication === "string" &&
    Object.hasOwn(cleanupPairs, lifecycle) &&
    (cleanupPairs[lifecycle as CleanupLifecycle] as readonly string[]).includes(publication)
  );
}

const cleanupPairTransitions = new Set([
  "PENDING/NOT_PUBLISHED>PENDING/PUBLISHING",
  "PENDING/NOT_PUBLISHED>ABORTING/NOT_PUBLISHED",
  "PENDING/NOT_PUBLISHED>COMPLETE/NOT_PUBLISHED",
  "PENDING/PUBLISHING>PENDING/PUBLISHED",
  "PENDING/PUBLISHING>ABORTING/PUBLISHING",
  "PENDING/PUBLISHED>ACTIVATING/PUBLISHED",
  "PENDING/PUBLISHED>ABORTING/PUBLISHED",
  "ACTIVATING/PUBLISHED>COMPLETE/CLEARED",
  "ABORTING/NOT_PUBLISHED>COMPLETE/NOT_PUBLISHED",
  "ABORTING/PUBLISHING>ABORTING/PUBLISHED",
  "ABORTING/PUBLISHED>ABORTING/CLEARED",
  "ABORTING/CLEARED>COMPLETE/CLEARED",
]);

export function isCleanupLifecyclePublicationTransition(
  previousLifecycle: unknown,
  previousPublication: unknown,
  nextLifecycle: unknown,
  nextPublication: unknown,
): boolean {
  if (
    !isCleanupLifecyclePublicationPair(previousLifecycle, previousPublication) ||
    !isCleanupLifecyclePublicationPair(nextLifecycle, nextPublication)
  )
    return false;
  return cleanupPairTransitions.has(
    `${previousLifecycle}/${previousPublication}>${nextLifecycle}/${nextPublication}`,
  );
}

export type CleanupHeadWriteDisposition = "APPEND" | "NO_APPEND" | "REFUSED";

export function reduceCleanupHeadWrite(
  previousLifecycle: unknown,
  previousPublication: unknown,
  requestedLifecycle: unknown,
  requestedPublication: unknown,
): CleanupHeadWriteDisposition {
  if (
    !isCleanupLifecyclePublicationPair(previousLifecycle, previousPublication) ||
    !isCleanupLifecyclePublicationPair(requestedLifecycle, requestedPublication)
  )
    return "REFUSED";
  if (previousLifecycle === requestedLifecycle && previousPublication === requestedPublication)
    return "NO_APPEND";
  return isCleanupLifecyclePublicationTransition(
    previousLifecycle,
    previousPublication,
    requestedLifecycle,
    requestedPublication,
  )
    ? "APPEND"
    : "REFUSED";
}

function define(
  schemaVersion: string,
  fields: Readonly<Record<string, FieldRule>>,
  validate?: SchemaDefinition["validate"],
): SchemaDefinition {
  return Object.freeze({
    schemaVersion,
    authority: true as const,
    fields: Object.freeze({ schemaVersion: field("schema-id"), ...fields }),
    ...(validate ? { validate } : {}),
  });
}

function adjacentGeneration(
  record: ContractRecord,
  prior: string,
  next: string,
): readonly string[] {
  return integer(record, next) === integer(record, prior) + 1 ? [] : [`${next}:not-adjacent`];
}

function orderedTimes(record: ContractRecord, first: string, second: string): readonly string[] {
  return Date.parse(text(record, first)) < Date.parse(text(record, second))
    ? []
    : [`${second}:not-after-${first}`];
}

export const recoveryFenceCurrentPath = "installation/activation-recovery-fence.json";
export const recoveryLaunchCurrentPath = "installation/activation-recovery-launch.json";
export const cleanupGateCurrentPath = "installation/activation-cleanup-gate.json";
export const cleanupHeadCurrentPath = "installation/activation-cleanup-head.json";

export function recoveryFenceRootPath(transactionId: string): string {
  return `installation/activation-recovery-fence-roots/${transactionId}.json`;
}

export function recoveryFenceHeadPath(
  transactionId: string,
  ordinal: number,
  lifecycle: string,
): string {
  return `installation/activation-recovery-fence-history/${transactionId}/${ordinal}-${lifecycle}.json`;
}

export function recoveryLaunchPath(
  transactionId: string,
  sourcePathToken: string,
  generation: number,
  ordinal: number,
  lifecycle: string,
): string {
  return `installation/activation-recovery-launches/${transactionId}/${sourcePathToken}/${generation}/${ordinal}-${lifecycle}.json`;
}

export function recoveryAuthorizationPath(transactionId: string): string {
  return `installation/recovery-authorizations/${transactionId}.json`;
}

export function cleanupGateRootPath(transactionId: string): string {
  return `installation/activation-cleanup-gate-roots/${transactionId}.json`;
}

export function cleanupGateHeadPath(
  transactionId: string,
  ordinal: number,
  lifecycle: string,
  publication: string,
): string {
  return `installation/activation-cleanup-gate-history/${transactionId}/${ordinal}-${lifecycle}-${publication}.json`;
}

export function cleanupGateArchivePath(transactionId: string): string {
  return `installation/activation-cleanup-gates/${transactionId}.json`;
}

const sourceToken = Object.freeze({
  "recovery-fence/v1": "recovery-fence-v1",
  "cleanup-gate-pre-fence/v1": "cleanup-gate-pre-fence-v1",
});

const lifecycle = [
  "READY",
  "LIVE",
  "TERMINAL_RETRYABLE",
  "TERMINAL_HANDOFF",
  "TERMINAL_ABORTED",
  "TERMINAL_COMPLETE",
  "UNKNOWN",
] as const;

const definitions = [
  define(
    "platform-configuration/v1",
    {
      adapterId: field("opaque"),
      capabilityNames: array("opaque"),
      leaseFreshnessMs: field("positive-integer"),
      maximumSessionMs: field("positive-integer"),
      projectId: field("uuid-v7"),
      stateRoot: field("file-url"),
      wallClockSkewMs: field("integer"),
    },
    (record) => {
      const issues: string[] = [];
      if (integer(record, "maximumSessionMs") > 86_400_000)
        issues.push("maximumSessionMs:above-24h");
      if (integer(record, "leaseFreshnessMs") > integer(record, "maximumSessionMs"))
        issues.push("leaseFreshnessMs:above-session-maximum");
      if (integer(record, "wallClockSkewMs") > 300_000)
        issues.push("wallClockSkewMs:above-five-minutes");
      return issues;
    },
  ),
  define("adapter-declaration/v1", {
    adapterId: field("opaque"),
    adapterVersion: field("semver"),
    capabilityNames: array("opaque"),
    contractRange: field("bounded-string"),
    factsSchemaVersion: field("schema-id"),
    planSchemaVersion: field("schema-id"),
  }),
  define("installed-release/v1", {
    contractSetDigest: field("sha256"),
    installationId: field("uuid-v7"),
    installedAt: field("timestamp"),
    manifestDigest: field("sha256"),
    releaseDigest: field("sha256"),
    releasePath: field("relative-path"),
  }),
  define(
    "session-lease/v1",
    {
      acquiredAt: field("timestamp"),
      expiresAt: field("timestamp"),
      generation: field("integer"),
      ownerId: field("opaque"),
      projectId: field("uuid-v7"),
      sessionId: field("uuid-v7"),
      status: enumeration("ACTIVE", "HANDOFF", "RELEASED", "UNKNOWN"),
    },
    (record) => orderedTimes(record, "acquiredAt", "expiresAt"),
  ),
  define("worker-ownership/v1", {
    claimedAt: field("timestamp"),
    cycleId: field("uuid-v7"),
    launchId: field("uuid-v7"),
    processIdentityDigest: field("sha256"),
    role: enumeration("implementation", "review", "observer"),
    sessionId: field("uuid-v7"),
    status: enumeration("CLAIMED", "RUNNING", "TERMINAL", "UNKNOWN"),
    workspaceResourceId: field("uuid-v7"),
  }),
  define("journal-event/v1", {
    eventId: field("uuid-v7"),
    eventKind: field("opaque"),
    occurredAt: field("timestamp"),
    ordinal: field("decimal"),
    payloadDigest: field("sha256"),
    previousEventDigest: nullable("sha256"),
    sessionId: field("uuid-v7"),
    subjectId: field("opaque"),
  }),
  define(
    "review-receipt/v1",
    {
      authorIdentity: field("opaque"),
      evidenceDigest: field("sha256"),
      issuedAt: field("timestamp"),
      outcome: enumeration("accepted", "rejected", "unknown"),
      receiptId: field("uuid-v7"),
      reviewerIdentity: field("opaque"),
      subjectDigest: field("sha256"),
    },
    (record) =>
      text(record, "outcome") === "accepted" &&
      text(record, "reviewerIdentity") === text(record, "authorIdentity")
        ? ["reviewerIdentity:not-independent"]
        : [],
  ),
  define("promotion-receipt/v1", {
    activeRecordDigest: field("sha256"),
    candidateDigest: field("sha256"),
    certificationDigest: field("sha256"),
    generation: field("positive-integer"),
    outcome: enumeration("PROMOTED", "RECOVERY_REQUIRED", "REFUSED"),
    predecessorReleaseDigest: field("sha256"),
    priorActiveRecordDigest: field("sha256"),
    promotedAt: field("timestamp"),
    reviewDigest: field("sha256"),
    successorReleaseDigest: field("sha256"),
    transactionId: field("uuid-v7"),
  }),
  define("dispatch-plan/v1", {
    argvDigest: field("sha256"),
    capabilityNames: array("opaque"),
    cycleId: field("uuid-v7"),
    expiresAt: field("timestamp"),
    ownedResourceIds: array("uuid-v7"),
    planId: field("sha256"),
    role: enumeration("implementation", "review", "observer"),
    sessionId: field("uuid-v7"),
    subjectId: field("opaque"),
  }),
  define(
    "breaker-authority/v1",
    {
      breakerId: field("uuid-v7"),
      capabilityName: field("opaque"),
      expiresAt: field("timestamp"),
      generation: field("integer"),
      lifecycle: enumeration("CLOSED", "OPEN", "HALF_OPEN", "UNKNOWN"),
      observationDigest: field("sha256"),
      observedAt: field("timestamp"),
      recoveryPolicyDigest: field("sha256"),
    },
    (record) => orderedTimes(record, "observedAt", "expiresAt"),
  ),
  define("owned-resource/v1", {
    acquiredAt: field("timestamp"),
    identityDigest: field("sha256"),
    kind: field("opaque"),
    ownerId: field("opaque"),
    ownerType: enumeration("adapter", "host"),
    reclamation: enumeration("RETAINED", "RECLAIMED", "UNKNOWN"),
    resourceId: field("uuid-v7"),
  }),
  define("export-manifest/v1", {
    artifactDigest: field("sha256"),
    createdAt: field("timestamp"),
    exportId: field("uuid-v7"),
    projectId: field("uuid-v7"),
    recordDigests: array("sha256"),
    sourceContractSetDigest: field("sha256"),
  }),
  define("import-plan/v1", {
    createdAt: field("timestamp"),
    exportDigest: field("sha256"),
    migrationIds: array("opaque"),
    planDigest: field("sha256"),
    sourceContractSetDigest: field("sha256"),
    targetContractSetDigest: field("sha256"),
    targetProjectId: field("uuid-v7"),
    transactionId: field("uuid-v7"),
  }),
  define("import-receipt/v1", {
    appliedRecordDigest: nullable("sha256"),
    completedAt: field("timestamp"),
    exportDigest: field("sha256"),
    outcome: enumeration("APPLIED", "REFUSED"),
    planDigest: field("sha256"),
    targetProjectId: field("uuid-v7"),
    transactionId: field("uuid-v7"),
  }),
  define("module-descriptor/v1", {
    abiVersion: enumeration("orchestration-module/v1"),
    acceptedAdapterRange: field("bounded-string"),
    acceptedContractRange: field("bounded-string"),
    acceptedEngineRange: field("bounded-string"),
    actionKinds: array("opaque"),
    inputSchemaVersion: field("schema-id"),
    moduleId: field("opaque"),
    moduleVersion: field("semver"),
    outputSchemaVersions: array("schema-id"),
    requiredCapabilityNames: array("opaque"),
    requiresReview: field("boolean"),
    requiresWorker: field("boolean"),
  }),
  define("module-plan-input/v1", {
    adapterPolicyDigest: field("sha256"),
    capabilityNames: array("opaque"),
    cycleId: field("uuid-v7"),
    factsDigest: field("sha256"),
    moduleId: field("opaque"),
    moduleVersion: field("semver"),
    sessionId: field("uuid-v7"),
  }),
  define(
    "module-plan-result/v1",
    {
      actionDigest: nullable("sha256"),
      cycleId: field("uuid-v7"),
      moduleId: field("opaque"),
      noActionDigest: nullable("sha256"),
      outcome: enumeration("ACTION", "NO_ACTION", "REFUSED"),
      refusalCode: nullable("opaque"),
    },
    (record) => {
      const outcome = text(record, "outcome");
      const action = record.actionDigest;
      const noAction = record.noActionDigest;
      const refusal = record.refusalCode;
      if (outcome === "ACTION" && action !== null && noAction === null && refusal === null)
        return [];
      if (outcome === "NO_ACTION" && action === null && noAction !== null && refusal === null)
        return [];
      if (outcome === "REFUSED" && action === null && noAction === null && refusal !== null)
        return [];
      return ["outcome:payload-discriminator-mismatch"];
    },
  ),
  define("module-action-plan/v1", {
    actionId: field("uuid-v7"),
    actionKind: field("opaque"),
    capabilityNames: array("opaque"),
    cycleId: field("uuid-v7"),
    moduleId: field("opaque"),
    mutationPlanDigest: field("sha256"),
    requiresReview: field("boolean"),
    requiresWorker: field("boolean"),
    subjectId: field("opaque"),
  }),
  define("module-no-action/v1", {
    cycleId: field("uuid-v7"),
    evidenceDigest: field("sha256"),
    moduleId: field("opaque"),
    reasonCode: field("opaque"),
  }),
  define("supervisor-shim/v1", {
    executableDigest: field("sha256"),
    installationId: field("uuid-v7"),
    installedAt: field("timestamp"),
    operationManifestDigest: field("sha256"),
    schedulerDefinitionDigest: field("sha256"),
    shimDigest: field("sha256"),
  }),
  define(
    "active-release/v1",
    {
      activatedAt: field("timestamp"),
      activeGeneration: field("integer"),
      brokerClientGeneration: field("integer"),
      cleanupArchiveDigest: field("sha256"),
      cleanupArchivePath: field("relative-path"),
      cleanupTransactionId: field("uuid-v7"),
      executableDigest: field("sha256"),
      executablePath: field("relative-path"),
      installationId: field("uuid-v7"),
      operationManifestDigest: field("sha256"),
      priorActiveRecordDigest: nullable("sha256"),
      projectId: field("uuid-v7"),
      releaseDigest: field("sha256"),
      stateRootDigest: field("sha256"),
      supervisorShimVersion: enumeration("supervisor-shim/v1"),
    },
    (record) => [
      ...(text(record, "cleanupArchivePath") ===
      cleanupGateArchivePath(text(record, "cleanupTransactionId"))
        ? []
        : ["cleanupArchivePath:not-transaction-derived"]),
      ...(integer(record, "activeGeneration") === 0
        ? record.priorActiveRecordDigest === null
          ? []
          : ["priorActiveRecordDigest:generation-zero-must-be-null"]
        : record.priorActiveRecordDigest === null
          ? ["priorActiveRecordDigest:later-generation-requires-digest"]
          : []),
    ],
  ),
  define("broker-active-client/v1", {
    activeRecordDigest: field("sha256"),
    activatedAt: field("timestamp"),
    clientDigest: field("sha256"),
    executableDigest: field("sha256"),
    generation: field("integer"),
    installationId: field("uuid-v7"),
    operationManifestDigest: field("sha256"),
    releaseDigest: field("sha256"),
  }),
  define(
    "pending-successor/v1",
    {
      brokerAdmissionDigest: field("sha256"),
      currentGeneration: field("integer"),
      executableDigest: field("sha256"),
      installationId: field("uuid-v7"),
      operationManifestDigest: field("sha256"),
      predecessorReleaseDigest: field("sha256"),
      stagedAt: field("timestamp"),
      successorGeneration: field("positive-integer"),
      successorReleaseDigest: field("sha256"),
      transactionId: field("uuid-v7"),
    },
    (record) => adjacentGeneration(record, "currentGeneration", "successorGeneration"),
  ),
  define("successor-admission/v1", {
    brokerAdmissionDigest: field("sha256"),
    clientGeneration: field("positive-integer"),
    installationId: field("uuid-v7"),
    outcome: enumeration("ACCEPTED", "REFUSED"),
    successorReleaseDigest: field("sha256"),
    transactionId: field("uuid-v7"),
    verifiedAt: field("timestamp"),
  }),
  define(
    "activation-recovery-fence-root/v1",
    {
      brokerAdmissionDigest: field("sha256"),
      createdAt: field("timestamp"),
      cycleId: field("uuid-v7"),
      expectedActiveRecordDigest: field("sha256"),
      expectedGeneration: field("positive-integer"),
      installationId: field("uuid-v7"),
      oldActiveRecordDigest: field("sha256"),
      oldGeneration: field("integer"),
      pendingAdmissionDigest: field("sha256"),
      predecessorExecutableDigest: field("sha256"),
      predecessorOperationManifestDigest: field("sha256"),
      predecessorReleaseDigest: field("sha256"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      recoveryReferenceDigest: field("sha256"),
      stateRootDigest: field("sha256"),
      successorExecutableDigest: field("sha256"),
      successorOperationManifestDigest: field("sha256"),
      successorReleaseDigest: field("sha256"),
      transactionId: field("uuid-v7"),
    },
    (record) => [
      ...(text(record, "recordPath") === recoveryFenceRootPath(text(record, "transactionId"))
        ? []
        : ["recordPath:not-transaction-derived"]),
      ...adjacentGeneration(record, "oldGeneration", "expectedGeneration"),
    ],
  ),
  define(
    "activation-recovery-fence-head/v1",
    {
      activeGeneration: field("integer"),
      activeRecordDigest: field("sha256"),
      createdAt: field("timestamp"),
      lifecycle: enumeration("PREPARED", "POST_ACTIVATION"),
      ordinal: field("integer"),
      previousHeadDigest: nullable("sha256"),
      recordPath: field("relative-path"),
      rootDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      updatedAt: field("timestamp"),
    },
    (record) => [
      ...(text(record, "recordPath") ===
      recoveryFenceHeadPath(
        text(record, "transactionId"),
        integer(record, "ordinal"),
        text(record, "lifecycle"),
      )
        ? []
        : ["recordPath:not-state-derived"]),
      ...(integer(record, "ordinal") === 0
        ? record.previousHeadDigest === null
          ? []
          : ["previousHeadDigest:ordinal-zero-must-be-null"]
        : record.previousHeadDigest === null
          ? ["previousHeadDigest:later-ordinal-requires-digest"]
          : []),
    ],
  ),
  define(
    "activation-recovery-fence-current/v1",
    {
      expectedPointerDigest: nullable("sha256"),
      generation: field("integer"),
      headDigest: field("sha256"),
      headLifecycle: enumeration("PREPARED", "POST_ACTIVATION"),
      headOrdinal: field("integer"),
      headPath: field("relative-path"),
      installationId: field("uuid-v7"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      rootDigest: field("sha256"),
      rootPath: field("relative-path"),
      stateRootDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      updatedAt: field("timestamp"),
    },
    (record) => [
      ...(text(record, "recordPath") === recoveryFenceCurrentPath
        ? []
        : ["recordPath:not-canonical"]),
      ...(text(record, "rootPath") === recoveryFenceRootPath(text(record, "transactionId"))
        ? []
        : ["rootPath:mismatch"]),
      ...(text(record, "headPath") ===
      recoveryFenceHeadPath(
        text(record, "transactionId"),
        integer(record, "headOrdinal"),
        text(record, "headLifecycle"),
      )
        ? []
        : ["headPath:mismatch"]),
      ...(integer(record, "headOrdinal") === 0
        ? record.expectedPointerDigest === null
          ? []
          : ["expectedPointerDigest:initial-cas-requires-null"]
        : record.expectedPointerDigest === null
          ? ["expectedPointerDigest:later-pointer-requires-digest"]
          : []),
      ...(record.expectedPointerDigest === "0".repeat(64)
        ? ["expectedPointerDigest:zero-refused"]
        : []),
    ],
  ),
  define(
    "activation-recovery-launch/v1",
    {
      activeRecordDigest: field("sha256"),
      argvDigest: field("sha256"),
      attempt: field("positive-integer"),
      authorityAdvance: nullableEnumeration("GATE", "FENCE"),
      cycleId: field("uuid-v7"),
      expectedFenceRootDigest: field("sha256"),
      fenceHeadDigest: nullable("sha256"),
      fenceHeadOrdinal: nullable("integer"),
      fenceRootDigest: nullable("sha256"),
      fenceRootPath: field("relative-path"),
      gateHeadDigest: field("sha256"),
      gateHeadOrdinal: field("integer"),
      gateLifecycle: enumeration("PENDING", "ACTIVATING", "ABORTING", "COMPLETE"),
      gatePublication: enumeration("NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"),
      gateRootDigest: field("sha256"),
      gateRootPath: field("relative-path"),
      generation: field("integer"),
      heartbeatAt: nullable("timestamp"),
      installationId: field("uuid-v7"),
      lifecycle: enumeration(...lifecycle),
      ordinal: field("integer"),
      predecessorExecutableDigest: field("sha256"),
      predecessorExecutablePath: field("relative-path"),
      predecessorReleaseDigest: field("sha256"),
      previousStateRecordDigest: nullable("sha256"),
      priorPointerDigest: nullable("sha256"),
      processTreeDigest: nullable("sha256"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      source: enumeration("recovery-fence/v1", "cleanup-gate-pre-fence/v1"),
      sourcePathToken: enumeration("recovery-fence-v1", "cleanup-gate-pre-fence-v1"),
      startedAt: nullable("timestamp"),
      stateRootDigest: field("sha256"),
      terminalAt: nullable("timestamp"),
      transactionId: field("uuid-v7"),
      transitionKind: enumeration("LIFECYCLE", "AUTHORITY_REBIND"),
    },
    (record) => {
      const issues: string[] = [];
      const source = text(record, "source") as keyof typeof sourceToken;
      if (!isCleanupLifecyclePublicationPair(record.gateLifecycle, record.gatePublication))
        issues.push("gateAuthority:inadmissible-lifecycle-publication-pair");
      if (text(record, "sourcePathToken") !== sourceToken[source])
        issues.push("sourcePathToken:mismatch");
      if (
        text(record, "recordPath") !==
        recoveryLaunchPath(
          text(record, "transactionId"),
          text(record, "sourcePathToken"),
          integer(record, "generation"),
          integer(record, "ordinal"),
          text(record, "lifecycle"),
        )
      )
        issues.push("recordPath:not-source-derived");
      if (text(record, "fenceRootPath") !== recoveryFenceRootPath(text(record, "transactionId")))
        issues.push("fenceRootPath:not-transaction-derived");
      if (text(record, "gateRootPath") !== cleanupGateRootPath(text(record, "transactionId")))
        issues.push("gateRootPath:not-transaction-derived");
      const initial = integer(record, "generation") === 0 && integer(record, "ordinal") === 0;
      if (initial !== (record.previousStateRecordDigest === null))
        issues.push("previousStateRecordDigest:initiality-mismatch");
      if (initial !== (record.priorPointerDigest === null))
        issues.push("priorPointerDigest:initiality-mismatch");
      if (!initial && record.previousStateRecordDigest === "0".repeat(64))
        issues.push("previousStateRecordDigest:zero-refused");
      if (!initial && record.priorPointerDigest === "0".repeat(64))
        issues.push("priorPointerDigest:zero-refused");
      if (source === "recovery-fence/v1") {
        if (
          [record.fenceRootDigest, record.fenceHeadOrdinal, record.fenceHeadDigest].includes(null)
        )
          issues.push("source:fence-authority-required");
        if (record.fenceRootDigest !== record.expectedFenceRootDigest)
          issues.push("source:fence-root-not-expected");
        if (record.gatePublication !== "PUBLISHED")
          issues.push("source:fence-requires-published-gate");
      } else {
        if (
          ![record.fenceRootDigest, record.fenceHeadOrdinal, record.fenceHeadDigest].every(
            (value) => value === null,
          )
        )
          issues.push("source:fence-authority-must-be-null");
        if (!["PENDING", "ABORTING"].includes(text(record, "gateLifecycle")))
          issues.push("source:pre-fence-gate-lifecycle");
        if (!["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED"].includes(text(record, "gatePublication")))
          issues.push("source:pre-fence-publication");
      }
      const state = text(record, "lifecycle");
      if (initial && state !== "READY") issues.push("lifecycle:initial-must-be-ready");
      if (
        state === "READY" &&
        ![record.processTreeDigest, record.startedAt, record.heartbeatAt, record.terminalAt].every(
          (value) => value === null,
        )
      )
        issues.push("lifecycle:ready-process-fields-must-be-null");
      if (
        state === "LIVE" &&
        [record.processTreeDigest, record.startedAt, record.heartbeatAt].includes(null)
      )
        issues.push("lifecycle:live-process-fields-required");
      if (state === "LIVE" && record.terminalAt !== null)
        issues.push("terminalAt:live-must-be-null");
      if (state.startsWith("TERMINAL_") && record.terminalAt === null)
        issues.push("terminalAt:terminal-state-required");
      if (
        state === "TERMINAL_HANDOFF" &&
        (source !== "cleanup-gate-pre-fence/v1" ||
          record.gateLifecycle !== "PENDING" ||
          record.gatePublication !== "PUBLISHED")
      )
        issues.push("lifecycle:handoff-requires-pending-published-pre-fence");
      if (state === "TERMINAL_ABORTED" && record.gateLifecycle !== "ABORTING")
        issues.push("lifecycle:aborted-requires-gate-aborting");
      if (state === "TERMINAL_COMPLETE" && source !== "recovery-fence/v1")
        issues.push("lifecycle:complete-fence-only");
      if (text(record, "transitionKind") === "AUTHORITY_REBIND") {
        if (!["GATE", "FENCE"].includes(record.authorityAdvance as string))
          issues.push("authorityAdvance:exactly-one-head-required");
        if (record.authorityAdvance === "FENCE" && source !== "recovery-fence/v1")
          issues.push("authorityAdvance:pre-fence-cannot-advance-fence");
      } else if (record.authorityAdvance !== null) {
        issues.push("authorityAdvance:lifecycle-transition-must-be-null");
      }
      return issues;
    },
  ),
  define(
    "activation-recovery-launch-current/v1",
    {
      activeRecordDigest: field("sha256"),
      argvDigest: field("sha256"),
      attempt: field("positive-integer"),
      cycleId: field("uuid-v7"),
      expectedFenceRootDigest: field("sha256"),
      expectedPointerDigest: nullable("sha256"),
      fenceHeadDigest: nullable("sha256"),
      fenceHeadOrdinal: nullable("integer"),
      fenceRootDigest: nullable("sha256"),
      gateHeadDigest: field("sha256"),
      gateHeadOrdinal: field("integer"),
      gateRootDigest: field("sha256"),
      generation: field("integer"),
      installationId: field("uuid-v7"),
      launchDigest: field("sha256"),
      launchLifecycle: enumeration(...lifecycle),
      launchOrdinal: field("integer"),
      launchPath: field("relative-path"),
      predecessorExecutableDigest: field("sha256"),
      predecessorExecutablePath: field("relative-path"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      source: enumeration("recovery-fence/v1", "cleanup-gate-pre-fence/v1"),
      sourcePathToken: enumeration("recovery-fence-v1", "cleanup-gate-pre-fence-v1"),
      stateRootDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      updatedAt: field("timestamp"),
    },
    (record) => {
      const source = text(record, "source") as keyof typeof sourceToken;
      const initial = integer(record, "generation") === 0 && integer(record, "launchOrdinal") === 0;
      const issues = [
        ...(text(record, "recordPath") === recoveryLaunchCurrentPath
          ? []
          : ["recordPath:not-canonical"]),
        ...(text(record, "sourcePathToken") === sourceToken[source]
          ? []
          : ["sourcePathToken:mismatch"]),
        ...(text(record, "launchPath") ===
        recoveryLaunchPath(
          text(record, "transactionId"),
          text(record, "sourcePathToken"),
          integer(record, "generation"),
          integer(record, "launchOrdinal"),
          text(record, "launchLifecycle"),
        )
          ? []
          : ["launchPath:mismatch"]),
        ...(initial === (record.expectedPointerDigest === null)
          ? []
          : ["expectedPointerDigest:initiality-mismatch"]),
        ...(record.expectedPointerDigest === "0".repeat(64)
          ? ["expectedPointerDigest:zero-refused"]
          : []),
      ];
      const fenceFields = [record.fenceRootDigest, record.fenceHeadOrdinal, record.fenceHeadDigest];
      if (source === "recovery-fence/v1") {
        if (fenceFields.includes(null)) issues.push("source:fence-authority-required");
        if (record.fenceRootDigest !== record.expectedFenceRootDigest)
          issues.push("source:fence-root-not-expected");
      } else if (!fenceFields.every((value) => value === null)) {
        issues.push("source:fence-authority-must-be-null");
      }
      return issues;
    },
  ),
  define(
    "activation-recovery-launch-archive/v1",
    {
      archivedAt: field("timestamp"),
      chainDigest: field("sha256"),
      childExitProofDigest: field("sha256"),
      fenceClearReceiptDigest: nullable("sha256"),
      generationCount: field("positive-integer"),
      launchCount: field("positive-integer"),
      pointerRemovalDigest: field("sha256"),
      recordPath: field("relative-path"),
      source: enumeration("recovery-fence/v1", "cleanup-gate-pre-fence/v1"),
      sourcePathToken: enumeration("recovery-fence-v1", "cleanup-gate-pre-fence-v1"),
      stateRecordDigests: array("sha256"),
      stateRecordPaths: array("relative-path"),
      terminalLaunchDigest: field("sha256"),
      terminalLifecycle: enumeration("TERMINAL_HANDOFF", "TERMINAL_ABORTED", "TERMINAL_COMPLETE"),
      terminalProofDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      transitionCount: field("integer"),
    },
    (record) => {
      const source = text(record, "source") as keyof typeof sourceToken;
      const statePaths = record.stateRecordPaths as readonly string[];
      const stateDigests = record.stateRecordDigests as readonly string[];
      const pathPrefix = `installation/activation-recovery-launches/${text(record, "transactionId")}/${text(record, "sourcePathToken")}/`;
      const parsedPaths = statePaths.map((path) => {
        if (!path.startsWith(pathPrefix)) return null;
        const match =
          /^(\d+)\/(\d+)-(READY|LIVE|TERMINAL_RETRYABLE|TERMINAL_HANDOFF|TERMINAL_ABORTED|TERMINAL_COMPLETE|UNKNOWN)\.json$/.exec(
            path.slice(pathPrefix.length),
          );
        return match
          ? { generation: Number(match[1]), ordinal: Number(match[2]), lifecycle: match[3] }
          : null;
      });
      const chainIsAdjacent = parsedPaths.every((entry, index) => {
        if (!entry) return false;
        if (index === 0) return entry.generation === 0 && entry.ordinal === 0;
        const previous = parsedPaths[index - 1]!;
        return (
          previous !== null &&
          (entry.generation === previous.generation
            ? entry.ordinal === previous.ordinal + 1
            : entry.generation === previous.generation + 1 && entry.ordinal === 0)
        );
      });
      return [
        ...(text(record, "sourcePathToken") === sourceToken[source]
          ? []
          : ["sourcePathToken:mismatch"]),
        ...(text(record, "recordPath") ===
        `installation/activation-recovery-launches/${text(record, "transactionId")}/${text(record, "sourcePathToken")}/archive.json`
          ? []
          : ["recordPath:mismatch"]),
        ...((record.stateRecordPaths as readonly string[]).length ===
          integer(record, "launchCount") &&
        (record.stateRecordDigests as readonly string[]).length === integer(record, "launchCount")
          ? []
          : ["launchCount:chain-census-mismatch"]),
        ...(chainIsAdjacent ? [] : ["stateRecordPaths:nonadjacent-chain"]),
        ...(new Set(parsedPaths.flatMap((entry) => (entry ? [entry.generation] : []))).size ===
        integer(record, "generationCount")
          ? []
          : ["generationCount:chain-census-mismatch"]),
        ...(integer(record, "transitionCount") === integer(record, "launchCount") - 1
          ? []
          : ["transitionCount:chain-census-mismatch"]),
        ...(stateDigests.at(-1) === record.terminalLaunchDigest
          ? []
          : ["terminalLaunchDigest:not-chain-tail"]),
        ...(parsedPaths.at(-1)?.lifecycle === record.terminalLifecycle
          ? []
          : ["terminalLifecycle:not-chain-tail"]),
        ...(text(record, "terminalLifecycle") === "TERMINAL_HANDOFF" &&
        source !== "cleanup-gate-pre-fence/v1"
          ? ["terminalLifecycle:handoff-pre-fence-only"]
          : []),
        ...(text(record, "terminalLifecycle") === "TERMINAL_COMPLETE" &&
        source !== "recovery-fence/v1"
          ? ["terminalLifecycle:complete-fence-only"]
          : []),
        ...(text(record, "terminalLifecycle") === "TERMINAL_COMPLETE" &&
        record.fenceClearReceiptDigest === null
          ? ["fenceClearReceiptDigest:complete-required"]
          : []),
      ];
    },
  ),
  define(
    "recovery-authorization/v1",
    {
      bootstrapGrantDigest: nullable("sha256"),
      bootstrapInstallerDigest: nullable("sha256"),
      candidateDigest: nullable("sha256"),
      capabilityDigest: field("sha256"),
      capabilityReference: field("opaque"),
      consumedAt: nullable("timestamp"),
      createdAt: field("timestamp"),
      destinationStateRootDigest: nullable("sha256"),
      expectedActiveRecordDigest: nullable("sha256"),
      expiresAt: nullable("timestamp"),
      fenceRootDigest: nullable("sha256"),
      gateRootDigest: nullable("sha256"),
      installationId: field("uuid-v7"),
      lifecycle: enumeration("CREATED_UNCONSUMED", "CONSUMED_BOUND", "REVOKED", "UNKNOWN"),
      mode: enumeration("bootstrap-n0", "successor"),
      nativeGeneration: field("positive-integer"),
      operationManifestDigest: nullable("sha256"),
      pendingAdmissionDigest: nullable("sha256"),
      predecessorExecutableDigest: nullable("sha256"),
      predecessorReleaseDigest: nullable("sha256"),
      priorBrokerGeneration: nullable("integer"),
      promotionCycleId: nullable("uuid-v7"),
      recordPath: field("relative-path"),
      recoveryFenceRootDigest: nullable("sha256"),
      recoveryGateRootDigest: nullable("sha256"),
      recoveryInitialLiveRecordDigest: nullable("sha256"),
      recoveryLaunchAttempt: nullable("positive-integer"),
      recoveryLaunchGeneration: nullable("integer"),
      recoveryLaunchSource: nullableEnumeration("recovery-fence/v1"),
      recoveryReadyRecordDigest: nullable("sha256"),
      revokedAt: nullable("timestamp"),
      stateRootDigest: field("sha256"),
      successorBrokerGeneration: nullable("positive-integer"),
      successorExecutableDigest: nullable("sha256"),
      successorReleaseDigest: nullable("sha256"),
      targetHostDigest: field("sha256"),
      targetUserDigest: field("sha256"),
      transactionId: field("uuid-v7"),
    },
    (record) => {
      const state = text(record, "lifecycle");
      const issues =
        text(record, "recordPath") === recoveryAuthorizationPath(text(record, "transactionId"))
          ? []
          : ["recordPath:mismatch"];
      const bootstrapFields = [
        record.bootstrapGrantDigest,
        record.bootstrapInstallerDigest,
        record.candidateDigest,
        record.destinationStateRootDigest,
      ];
      const successorFields = [
        record.expectedActiveRecordDigest,
        record.fenceRootDigest,
        record.gateRootDigest,
        record.operationManifestDigest,
        record.pendingAdmissionDigest,
        record.predecessorExecutableDigest,
        record.predecessorReleaseDigest,
        record.priorBrokerGeneration,
        record.promotionCycleId,
        record.successorBrokerGeneration,
        record.successorExecutableDigest,
        record.successorReleaseDigest,
      ];
      if (text(record, "mode") === "bootstrap-n0") {
        if (bootstrapFields.includes(null)) issues.push("mode:bootstrap-bindings-required");
        if (!successorFields.every((value) => value === null))
          issues.push("mode:successor-bindings-must-be-null");
      } else {
        if (!bootstrapFields.every((value) => value === null))
          issues.push("mode:bootstrap-bindings-must-be-null");
        if (successorFields.includes(null)) issues.push("mode:successor-bindings-required");
        if (
          record.priorBrokerGeneration !== null &&
          record.successorBrokerGeneration !== null &&
          record.successorBrokerGeneration !== (record.priorBrokerGeneration as number) + 1
        )
          issues.push("successorBrokerGeneration:not-adjacent");
      }
      const launchFields = [
        record.recoveryFenceRootDigest,
        record.recoveryGateRootDigest,
        record.recoveryInitialLiveRecordDigest,
        record.recoveryLaunchAttempt,
        record.recoveryLaunchGeneration,
        record.recoveryLaunchSource,
        record.recoveryReadyRecordDigest,
      ];
      if (!launchFields.every((value) => value === null) && launchFields.includes(null))
        issues.push("recoveryLaunch:partial-binding");
      if (text(record, "mode") === "bootstrap-n0" && !launchFields.every((value) => value === null))
        issues.push("recoveryLaunch:bootstrap-must-be-null");
      if (!launchFields.includes(null)) {
        if (record.recoveryFenceRootDigest !== record.fenceRootDigest)
          issues.push("recoveryFenceRootDigest:authority-mismatch");
        if (record.recoveryGateRootDigest !== record.gateRootDigest)
          issues.push("recoveryGateRootDigest:authority-mismatch");
      }
      if (
        state === "CREATED_UNCONSUMED" &&
        (record.consumedAt !== null ||
          record.revokedAt !== null ||
          !launchFields.every((value) => value === null))
      )
        issues.push("lifecycle:unconsumed-fields");
      if (
        state === "CONSUMED_BOUND" &&
        (record.consumedAt === null || record.revokedAt !== null || record.expiresAt !== null)
      )
        issues.push("lifecycle:consumed-fields");
      if (record.consumedAt !== null && record.expiresAt !== null)
        issues.push("expiresAt:consumed-must-be-null");
      if (state === "REVOKED" && record.revokedAt === null)
        issues.push("lifecycle:revoked-time-required");
      if (
        record.expiresAt !== null &&
        Date.parse(text(record, "expiresAt")) <= Date.parse(text(record, "createdAt"))
      )
        issues.push("expiresAt:not-after-createdAt");
      return issues;
    },
  ),
  define(
    "activation-cleanup-gate-root/v1",
    {
      archivePath: field("relative-path"),
      candidateDigest: field("sha256"),
      createdAuthorizationDigest: field("sha256"),
      createdAt: field("timestamp"),
      expectedActiveGeneration: field("integer"),
      expectedActiveRecordDigest: nullable("sha256"),
      expectedConsumedAuthorizationDigest: field("sha256"),
      expectedFenceRootDigest: nullable("sha256"),
      expectedFenceRootPath: nullable("relative-path"),
      installationId: field("uuid-v7"),
      mode: enumeration("N0", "PROMOTION"),
      priorCleanupHeadDigest: nullable("sha256"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      recoveryAuthorizationId: field("uuid-v7"),
      recoveryAuthorizationPath: field("relative-path"),
      releaseDigest: field("sha256"),
      stateRootDigest: field("sha256"),
      transactionId: field("uuid-v7"),
    },
    (record) => [
      ...(text(record, "recordPath") === cleanupGateRootPath(text(record, "transactionId"))
        ? []
        : ["recordPath:mismatch"]),
      ...(text(record, "archivePath") === cleanupGateArchivePath(text(record, "transactionId"))
        ? []
        : ["archivePath:mismatch"]),
      ...(text(record, "recoveryAuthorizationPath") ===
      recoveryAuthorizationPath(text(record, "transactionId"))
        ? []
        : ["recoveryAuthorizationPath:mismatch"]),
      ...(text(record, "mode") === "N0" &&
      (record.expectedActiveRecordDigest !== null ||
        integer(record, "expectedActiveGeneration") !== 0 ||
        record.expectedFenceRootPath !== null ||
        record.expectedFenceRootDigest !== null ||
        record.priorCleanupHeadDigest !== null)
        ? ["mode:n0-active-state-mismatch"]
        : []),
      ...(text(record, "mode") === "PROMOTION" &&
      [
        record.expectedActiveRecordDigest,
        record.expectedFenceRootPath,
        record.expectedFenceRootDigest,
        record.priorCleanupHeadDigest,
      ].includes(null)
        ? ["mode:promotion-bindings-required"]
        : []),
      ...(text(record, "mode") === "PROMOTION" &&
      text(record, "expectedFenceRootPath") !== recoveryFenceRootPath(text(record, "transactionId"))
        ? ["expectedFenceRootPath:not-transaction-derived"]
        : []),
    ],
  ),
  define(
    "activation-cleanup-gate-head/v1",
    {
      abortRevocationReceiptDigest: nullable("sha256"),
      activeRecordDigest: nullable("sha256"),
      createdAt: field("timestamp"),
      fenceDigest: nullable("sha256"),
      lifecycle: enumeration("PENDING", "ACTIVATING", "ABORTING", "COMPLETE"),
      ordinal: field("integer"),
      previousHeadDigest: nullable("sha256"),
      publication: enumeration("NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"),
      recordPath: field("relative-path"),
      rootDigest: field("sha256"),
      terminalRevocationReceiptDigest: nullable("sha256"),
      transactionId: field("uuid-v7"),
    },
    (record) => {
      const issues =
        text(record, "recordPath") ===
        cleanupGateHeadPath(
          text(record, "transactionId"),
          integer(record, "ordinal"),
          text(record, "lifecycle"),
          text(record, "publication"),
        )
          ? []
          : ["recordPath:not-state-derived"];
      if (
        integer(record, "ordinal") === 0
          ? record.previousHeadDigest !== null
          : record.previousHeadDigest === null
      )
        issues.push("previousHeadDigest:ordinal-mismatch");
      if (
        integer(record, "ordinal") === 0 &&
        (record.lifecycle !== "PENDING" || record.publication !== "NOT_PUBLISHED")
      )
        issues.push("ordinal:zero-must-be-pending-not-published");
      const lifecycle = text(record, "lifecycle");
      const publication = text(record, "publication");
      if (!isCleanupLifecyclePublicationPair(lifecycle, publication))
        issues.push("lifecyclePublication:inadmissible-pair");
      if (["PENDING", "ACTIVATING"].includes(lifecycle)) {
        if (record.abortRevocationReceiptDigest !== null)
          issues.push("abortRevocationReceiptDigest:premature");
        if (record.terminalRevocationReceiptDigest !== null)
          issues.push("terminalRevocationReceiptDigest:premature");
      } else if (lifecycle === "ABORTING") {
        if (record.abortRevocationReceiptDigest === null)
          issues.push("abortRevocationReceiptDigest:required");
        if (record.terminalRevocationReceiptDigest !== null)
          issues.push("terminalRevocationReceiptDigest:premature");
      } else if (record.terminalRevocationReceiptDigest === null) {
        issues.push("terminalRevocationReceiptDigest:required");
      }
      if (publication === "NOT_PUBLISHED" && record.fenceDigest !== null)
        issues.push("fenceDigest:not-published-must-be-null");
      if (["PUBLISHED", "CLEARED"].includes(publication) && record.fenceDigest === null)
        issues.push("fenceDigest:publication-required");
      return issues;
    },
  ),
  define(
    "activation-cleanup-gate-current/v1",
    {
      expectedPointerDigest: nullable("sha256"),
      headDigest: field("sha256"),
      headLifecycle: enumeration("PENDING", "ACTIVATING", "ABORTING", "COMPLETE"),
      headOrdinal: field("integer"),
      headPath: field("relative-path"),
      headPublication: enumeration("NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"),
      installationId: field("uuid-v7"),
      projectId: field("uuid-v7"),
      recordPath: field("relative-path"),
      rootDigest: field("sha256"),
      rootPath: field("relative-path"),
      stateRootDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      updatedAt: field("timestamp"),
    },
    (record) => [
      ...(text(record, "recordPath") === cleanupGateCurrentPath
        ? []
        : ["recordPath:not-canonical"]),
      ...(text(record, "rootPath") === cleanupGateRootPath(text(record, "transactionId"))
        ? []
        : ["rootPath:mismatch"]),
      ...(text(record, "headPath") ===
      cleanupGateHeadPath(
        text(record, "transactionId"),
        integer(record, "headOrdinal"),
        text(record, "headLifecycle"),
        text(record, "headPublication"),
      )
        ? []
        : ["headPath:mismatch"]),
      ...(integer(record, "headOrdinal") === 0
        ? record.expectedPointerDigest === null
          ? []
          : ["expectedPointerDigest:initial-cas-requires-null"]
        : record.expectedPointerDigest === null
          ? ["expectedPointerDigest:later-pointer-requires-digest"]
          : []),
      ...(record.expectedPointerDigest === "0".repeat(64)
        ? ["expectedPointerDigest:zero-refused"]
        : []),
    ],
  ),
  define(
    "activation-cleanup-gate-archive/v1",
    {
      activeRecordDigest: field("sha256"),
      abortProofDigest: nullable("sha256"),
      archivedAt: field("timestamp"),
      authorizationRevocationDigest: field("sha256"),
      mode: enumeration("N0", "PROMOTION"),
      outcome: enumeration("ACTIVATED", "ABORTED"),
      priorCleanupHeadDigest: nullable("sha256"),
      proofDigests: array("sha256"),
      recordPath: field("relative-path"),
      rootDigest: field("sha256"),
      terminalProofDigest: nullable("sha256"),
      terminalHeadDigest: field("sha256"),
      transactionId: field("uuid-v7"),
      transitionChainDigest: field("sha256"),
      transitionCount: field("positive-integer"),
    },
    (record) => [
      ...(text(record, "recordPath") === cleanupGateArchivePath(text(record, "transactionId"))
        ? []
        : ["recordPath:mismatch"]),
      ...(text(record, "outcome") === "ABORTED" && record.abortProofDigest === null
        ? ["abortProofDigest:aborted-required"]
        : []),
      ...(text(record, "outcome") === "ABORTED" && record.terminalProofDigest !== null
        ? ["terminalProofDigest:aborted-must-be-null"]
        : []),
      ...(text(record, "outcome") === "ACTIVATED" && record.terminalProofDigest === null
        ? ["terminalProofDigest:activated-required"]
        : []),
      ...(text(record, "outcome") === "ACTIVATED" && record.abortProofDigest !== null
        ? ["abortProofDigest:activated-must-be-null"]
        : []),
    ],
  ),
  define(
    "activation-cleanup-head/v1",
    {
      archiveDigest: field("sha256"),
      archivePath: field("relative-path"),
      activeRecordDigest: field("sha256"),
      expectedPreviousDigest: nullable("sha256"),
      recordPath: field("relative-path"),
      transactionId: field("uuid-v7"),
      updatedAt: field("timestamp"),
    },
    (record) => [
      ...(text(record, "recordPath") === cleanupHeadCurrentPath
        ? []
        : ["recordPath:not-canonical"]),
      ...(text(record, "archivePath") === cleanupGateArchivePath(text(record, "transactionId"))
        ? []
        : ["archivePath:mismatch"]),
    ],
  ),
  define(
    "repository-protection-receipt/v1",
    {
      actorPolicyDigest: field("sha256"),
      apiVersion: enumeration("2022-11-28"),
      apiPageDigests: array("sha256"),
      apiPageCount: field("positive-integer"),
      apiProvenanceDigest: field("sha256"),
      disposition: enumeration("VERIFIED", "REFUSED", "UNKNOWN"),
      expiresAt: field("timestamp"),
      intendedArtifactName: field("relative-path"),
      issuedAt: field("timestamp"),
      probePermissionsDigest: field("sha256"),
      probeTriggersDigest: field("sha256"),
      probeWorkflowDigest: field("sha256"),
      probeWorkflowIdentity: field("bounded-string"),
      producerAttempt: field("positive-integer"),
      producerRunId: field("decimal"),
      producerStartedAt: field("timestamp"),
      protectedEnvironmentId: field("decimal"),
      protectedEnvironmentName: enumeration("host-custody-bootstrap-root"),
      protectedPathPolicyDigest: field("sha256"),
      repositoryId: field("decimal"),
      repositoryIdentity: field("bounded-string"),
      reviewPolicyDigest: field("sha256"),
      rulesetId: field("decimal"),
      rulesetSemanticDigest: field("sha256"),
      verifierAnchorDigest: field("sha256"),
      verifierAnchorVariableEtag: field("bounded-string"),
      verifierAnchorVariableName: enumeration("VERIFIER_ANCHOR_SHA256"),
      verifierAnchorVariableUpdatedAt: field("timestamp"),
      verifierAnchorVariableValue: field("sha256"),
      verifierVersion: enumeration("2.93.0"),
    },
    (record) => [
      ...(text(record, "verifierAnchorVariableName") === "VERIFIER_ANCHOR_SHA256"
        ? []
        : ["verifierAnchorVariableName:mismatch"]),
      ...((record.apiPageDigests as readonly string[]).length === integer(record, "apiPageCount")
        ? []
        : ["apiPageDigests:count-mismatch"]),
      ...orderedTimes(record, "issuedAt", "expiresAt"),
      ...(record.verifierAnchorDigest === record.verifierAnchorVariableValue
        ? []
        : ["verifierAnchorDigest:variable-value-mismatch"]),
      ...(Date.parse(text(record, "verifierAnchorVariableUpdatedAt")) <
      Date.parse(text(record, "producerStartedAt"))
        ? []
        : ["verifierAnchorVariableUpdatedAt:not-pre-run"]),
      ...(Date.parse(text(record, "producerStartedAt")) < Date.parse(text(record, "issuedAt"))
        ? []
        : ["producerStartedAt:not-before-issuedAt"]),
      ...(Date.parse(text(record, "expiresAt")) - Date.parse(text(record, "issuedAt")) <=
      604_800_000
        ? []
        : ["expiresAt:above-seven-days"]),
    ],
  ),
  define("bootstrap-verifier-anchor/v1", {
    anchorId: field("uuid-v7"),
    confirmationDigest: field("sha256"),
    createdAt: field("timestamp"),
    issuerIdentity: field("bounded-string"),
    officialAssetDigest: field("sha256"),
    officialChecksumDigest: field("sha256"),
    repositoryId: field("decimal"),
    repositoryIdentity: field("bounded-string"),
    signerIdentity: field("bounded-string"),
    trustSource: enumeration("OPERATOR_CONFIRMED_OFFICIAL"),
    verifierExecutableDigest: field("sha256"),
    verifierVersion: enumeration("2.93.0"),
  }),
] as const;

export const schemaDefinitions: Readonly<Record<string, SchemaDefinition>> = Object.freeze(
  Object.fromEntries(definitions.map((definition) => [definition.schemaVersion, definition])),
);

export const schemaVersions = Object.freeze(Object.keys(schemaDefinitions).sort());

export type CompatibilityDisposition = "readable" | "migratable" | "refused";

export function compatibilityDisposition(
  expectedSchemaVersion: string,
  observedSchemaVersion: unknown,
): CompatibilityDisposition {
  if (!Object.hasOwn(schemaDefinitions, expectedSchemaVersion)) return "refused";
  if (observedSchemaVersion === expectedSchemaVersion) return "readable";
  if (
    expectedSchemaVersion === "platform-configuration/v1" &&
    observedSchemaVersion === "platform-configuration/v0-fixture"
  )
    return "migratable";
  return "refused";
}

export function validateImportReceiptAgainstPlan(
  plan: ContractRecord,
  receipt: ContractRecord,
): readonly string[] {
  const bindings = ["transactionId", "exportDigest", "planDigest", "targetProjectId"];
  return bindings
    .filter((name) => plan[name] !== receipt[name])
    .map((name) => `${name}:transaction-binding-mismatch`);
}

export interface RecoveryAuthorizationAttachmentInput {
  readonly authorization: ContractRecord;
  readonly authorizationDigest: string;
  readonly current: ContractRecord;
  readonly expectedArgvDigest: string;
  readonly fenceCurrent: ContractRecord;
  readonly fenceHistory: readonly ContractRecord[];
  readonly fenceHistoryDigests: readonly string[];
  readonly fencePriorCurrentDigest: string | null;
  readonly fenceRoot: ContractRecord;
  readonly fenceRootDigest: string;
  readonly gateCurrent: ContractRecord;
  readonly gateHistory: readonly ContractRecord[];
  readonly gateHistoryDigests: readonly string[];
  readonly gatePriorCurrentDigest: string | null;
  readonly gateRoot: ContractRecord;
  readonly gateRootDigest: string;
  readonly live: ContractRecord;
  readonly liveDigest: string;
  readonly predecessorActiveRecord: ContractRecord;
  readonly predecessorActiveRecordDigest: string;
  readonly priorAttemptHistory: readonly ContractRecord[];
  readonly priorAttemptHistoryDigests: readonly string[];
  readonly ready: ContractRecord;
  readonly readyDigest: string;
}

const attachmentInputFields = Object.freeze([
  "authorization",
  "authorizationDigest",
  "current",
  "expectedArgvDigest",
  "fenceCurrent",
  "fenceHistory",
  "fenceHistoryDigests",
  "fencePriorCurrentDigest",
  "fenceRoot",
  "fenceRootDigest",
  "gateCurrent",
  "gateHistory",
  "gateHistoryDigests",
  "gatePriorCurrentDigest",
  "gateRoot",
  "gateRootDigest",
  "live",
  "liveDigest",
  "predecessorActiveRecord",
  "predecessorActiveRecordDigest",
  "priorAttemptHistory",
  "priorAttemptHistoryDigests",
  "ready",
  "readyDigest",
] as const);

export function validateRecoveryAuthorizationAttachment(
  input: RecoveryAuthorizationAttachmentInput,
): readonly string[] {
  const issues: string[] = [];
  const closedEnvelope = snapshotClosedRecord(input, attachmentInputFields);
  if (!closedEnvelope.ok) return closedEnvelope.issues.map((issue) => `attachmentInput:${issue}`);
  const envelope = closedEnvelope.value;

  const parsedRecords: Record<string, ContractRecord> = {};
  for (const [label, schemaVersion] of [
    ["authorization", "recovery-authorization/v1"],
    ["ready", "activation-recovery-launch/v1"],
    ["live", "activation-recovery-launch/v1"],
    ["current", "activation-recovery-launch-current/v1"],
    ["predecessorActiveRecord", "active-release/v1"],
    ["gateRoot", "activation-cleanup-gate-root/v1"],
    ["gateCurrent", "activation-cleanup-gate-current/v1"],
    ["fenceRoot", "activation-recovery-fence-root/v1"],
    ["fenceCurrent", "activation-recovery-fence-current/v1"],
  ] as const) {
    try {
      const parsed = validateAgainstSchema(schemaDefinitions[schemaVersion]!, envelope[label]);
      if (parsed.ok) parsedRecords[label] = parsed.value;
      else issues.push(...parsed.issues.map((issue) => `${label}:${issue}`));
    } catch {
      issues.push(`${label}:unreadable`);
    }
  }
  const parsedHistories: Record<string, readonly ContractRecord[]> = {};
  for (const [label, schemaVersion] of [
    ["gateHistory", "activation-cleanup-gate-head/v1"],
    ["fenceHistory", "activation-recovery-fence-head/v1"],
    ["priorAttemptHistory", "activation-recovery-launch/v1"],
  ] as const) {
    const history = envelope[label];
    if (!Array.isArray(history) || history.length > 256) {
      issues.push(`${label}:bounded-array-required`);
      continue;
    }
    const parsed: ContractRecord[] = [];
    for (const [index, record] of history.entries()) {
      try {
        const result = validateAgainstSchema(schemaDefinitions[schemaVersion]!, record);
        if (result.ok) parsed.push(result.value);
        else issues.push(...result.issues.map((issue) => `${label}[${index}]:${issue}`));
      } catch {
        issues.push(`${label}[${index}]:unreadable`);
      }
    }
    parsedHistories[label] = Object.freeze(parsed);
  }
  const digestNames = [
    "authorizationDigest",
    "expectedArgvDigest",
    "fenceRootDigest",
    "gateRootDigest",
    "liveDigest",
    "predecessorActiveRecordDigest",
    "readyDigest",
  ] as const;
  for (const name of digestNames) {
    if (typeof envelope[name] !== "string" || !/^[0-9a-f]{64}$/.test(envelope[name]))
      issues.push(`${name}:invalid-sha256`);
  }
  for (const name of ["gatePriorCurrentDigest", "fencePriorCurrentDigest"] as const) {
    if (
      envelope[name] !== null &&
      (typeof envelope[name] !== "string" || !/^[0-9a-f]{64}$/.test(envelope[name]))
    )
      issues.push(`${name}:invalid-nullable-sha256`);
  }
  for (const [historyName, digestName] of [
    ["gateHistory", "gateHistoryDigests"],
    ["fenceHistory", "fenceHistoryDigests"],
    ["priorAttemptHistory", "priorAttemptHistoryDigests"],
  ] as const) {
    const history = envelope[historyName];
    const digests = envelope[digestName];
    if (
      !Array.isArray(digests) ||
      !Array.isArray(history) ||
      digests.length !== history.length ||
      digests.some((digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
    )
      issues.push(`${digestName}:history-census-mismatch`);
  }
  if ((envelope.gateHistory as readonly unknown[]).length === 0) issues.push("gateHistory:empty");
  if ((envelope.fenceHistory as readonly unknown[]).length === 0) issues.push("fenceHistory:empty");
  if (issues.length > 0) return [...new Set(issues)].sort();

  const authorization = parsedRecords.authorization!;
  const ready = parsedRecords.ready!;
  const live = parsedRecords.live!;
  const current = parsedRecords.current!;
  const predecessorActiveRecord = parsedRecords.predecessorActiveRecord!;
  const gateRoot = parsedRecords.gateRoot!;
  const gateCurrent = parsedRecords.gateCurrent!;
  const fenceRoot = parsedRecords.fenceRoot!;
  const fenceCurrent = parsedRecords.fenceCurrent!;
  const gateHistory = parsedHistories.gateHistory!;
  const gateHead = gateHistory.at(-1)!;
  const fenceHistory = parsedHistories.fenceHistory!;
  const fenceHead = fenceHistory.at(-1)!;
  const priorAttemptHistory = parsedHistories.priorAttemptHistory!;
  const authorizationDigest = envelope.authorizationDigest as string;
  const expectedArgvDigest = envelope.expectedArgvDigest as string;
  const readyDigest = envelope.readyDigest as string;
  const liveDigest = envelope.liveDigest as string;
  const predecessorActiveRecordDigest = envelope.predecessorActiveRecordDigest as string;
  const gateRootDigest = envelope.gateRootDigest as string;
  const gateHistoryDigests = envelope.gateHistoryDigests as readonly string[];
  const gateHeadDigest = gateHistoryDigests.at(-1)!;
  const fenceRootDigest = envelope.fenceRootDigest as string;
  const fenceHistoryDigests = envelope.fenceHistoryDigests as readonly string[];
  const fenceHeadDigest = fenceHistoryDigests.at(-1)!;
  const priorAttemptHistoryDigests = envelope.priorAttemptHistoryDigests as readonly string[];

  for (const [label, record, observedDigest] of [
    ["authorization", authorization, authorizationDigest],
    ["readyRecord", ready, readyDigest],
    ["liveRecord", live, liveDigest],
    ["predecessorActiveRecord", predecessorActiveRecord, predecessorActiveRecordDigest],
    ["gateRoot", gateRoot, gateRootDigest],
    ["fenceRoot", fenceRoot, fenceRootDigest],
  ] as const) {
    if (canonicalDigest(record as JsonValue) !== observedDigest)
      issues.push(`${label}Digest:content-mismatch`);
  }

  for (const [index, head] of gateHistory.entries()) {
    const observedDigest = gateHistoryDigests[index]!;
    if (canonicalDigest(head as JsonValue) !== observedDigest)
      issues.push(`gateHistory[${index}]:digest-mismatch`);
    if (
      head.ordinal !== index ||
      head.rootDigest !== gateRootDigest ||
      head.transactionId !== gateRoot.transactionId
    )
      issues.push(`gateHistory[${index}]:identity-mismatch`);
    if (index === 0) {
      if (
        head.previousHeadDigest !== null ||
        head.lifecycle !== "PENDING" ||
        head.publication !== "NOT_PUBLISHED"
      )
        issues.push("gateHistory[0]:invalid-initial-head");
    } else {
      if (head.previousHeadDigest !== gateHistoryDigests[index - 1])
        issues.push(`gateHistory[${index}]:previous-digest-mismatch`);
      if (
        !isCleanupLifecyclePublicationTransition(
          gateHistory[index - 1]!.lifecycle,
          gateHistory[index - 1]!.publication,
          head.lifecycle,
          head.publication,
        )
      )
        issues.push(`gateHistory[${index}]:transition-refused`);
    }
  }
  if (
    gateCurrent.headOrdinal !== gateHistory.length - 1 ||
    gateCurrent.headDigest !== gateHeadDigest ||
    gateCurrent.expectedPointerDigest !== envelope.gatePriorCurrentDigest
  )
    issues.push("gateHistory:current-tail-mismatch");
  if ((gateHistory.length === 1) !== (envelope.gatePriorCurrentDigest === null))
    issues.push("gatePriorCurrentDigest:initiality-mismatch");

  for (const [index, head] of fenceHistory.entries()) {
    const observedDigest = fenceHistoryDigests[index]!;
    if (canonicalDigest(head as JsonValue) !== observedDigest)
      issues.push(`fenceHistory[${index}]:digest-mismatch`);
    if (
      head.ordinal !== index ||
      head.rootDigest !== fenceRootDigest ||
      head.transactionId !== fenceRoot.transactionId
    )
      issues.push(`fenceHistory[${index}]:identity-mismatch`);
    if (index === 0) {
      if (head.previousHeadDigest !== null || head.lifecycle !== "PREPARED")
        issues.push("fenceHistory[0]:invalid-initial-head");
    } else {
      if (head.previousHeadDigest !== fenceHistoryDigests[index - 1])
        issues.push(`fenceHistory[${index}]:previous-digest-mismatch`);
      if (fenceHistory[index - 1]!.lifecycle !== "PREPARED" || head.lifecycle !== "POST_ACTIVATION")
        issues.push(`fenceHistory[${index}]:transition-refused`);
    }
  }
  if (
    fenceCurrent.headOrdinal !== fenceHistory.length - 1 ||
    fenceCurrent.headDigest !== fenceHeadDigest ||
    fenceCurrent.expectedPointerDigest !== envelope.fencePriorCurrentDigest
  )
    issues.push("fenceHistory:current-tail-mismatch");
  if ((fenceHistory.length === 1) !== (envelope.fencePriorCurrentDigest === null))
    issues.push("fencePriorCurrentDigest:initiality-mismatch");

  for (const [index, record] of priorAttemptHistory.entries()) {
    if (canonicalDigest(record as JsonValue) !== priorAttemptHistoryDigests[index])
      issues.push(`priorAttemptHistory[${index}]:digest-mismatch`);
    if (index === 0) {
      if (record.generation !== 0 || record.ordinal !== 0 || record.lifecycle !== "READY")
        issues.push("priorAttemptHistory[0]:invalid-initial-record");
    } else {
      const previous = priorAttemptHistory[index - 1]!;
      if (record.previousStateRecordDigest !== priorAttemptHistoryDigests[index - 1])
        issues.push(`priorAttemptHistory[${index}]:previous-digest-mismatch`);
      issues.push(
        ...validateRecoveryLaunchTransition(
          previous,
          record,
          priorAttemptHistoryDigests[index - 1]!,
          record.priorPointerDigest as string,
        ).map((issue) => `priorAttemptHistory[${index}]:${issue}`),
      );
    }
  }
  if (ready.generation === 0) {
    if (priorAttemptHistory.length !== 0)
      issues.push("priorAttemptHistory:generation-zero-must-empty");
  } else {
    const priorTail = priorAttemptHistory.at(-1);
    if (
      !priorTail ||
      priorTail.lifecycle !== "TERMINAL_RETRYABLE" ||
      priorTail.generation !== (ready.generation as number) - 1 ||
      ready.previousStateRecordDigest !== priorAttemptHistoryDigests.at(-1)
    )
      issues.push("priorAttemptHistory:not-complete-terminal-retryable-prefix");
    else
      issues.push(
        ...validateRecoveryLaunchTransition(
          priorTail,
          ready,
          priorAttemptHistoryDigests.at(-1)!,
          ready.priorPointerDigest as string,
        ).map((issue) => `priorAttemptHistory:ready-successor:${issue}`),
      );
  }

  issues.push(
    ...validateCleanupAuthorityBinding(
      gateRoot,
      gateHead,
      gateCurrent,
      gateRootDigest,
      gateHeadDigest,
    ).map((issue) => `gateAuthority:${issue}`),
    ...validateFenceAuthorityBinding(
      fenceRoot,
      fenceHead,
      fenceCurrent,
      fenceRootDigest,
      fenceHeadDigest,
    ).map((issue) => `fenceAuthority:${issue}`),
  );
  if (authorization.mode !== "successor" || authorization.lifecycle !== "CONSUMED_BOUND")
    issues.push("authorization:not-consumed-successor");
  for (const name of ["transactionId", "installationId", "stateRootDigest"]) {
    if (
      authorization[name] !== ready[name] ||
      ready[name] !== live[name] ||
      live[name] !== current[name]
    )
      issues.push(`${name}:attachment-mismatch`);
  }
  for (const name of ["source", "generation", "attempt"] as const) {
    const authorizationName =
      name === "source"
        ? "recoveryLaunchSource"
        : name === "generation"
          ? "recoveryLaunchGeneration"
          : "recoveryLaunchAttempt";
    if (
      authorization[authorizationName] !== ready[name] ||
      ready[name] !== live[name] ||
      live[name] !== current[name]
    )
      issues.push(`${authorizationName}:attachment-mismatch`);
  }
  for (const [authorizationName, launchName] of [
    ["promotionCycleId", "cycleId"],
    ["expectedActiveRecordDigest", "activeRecordDigest"],
    ["predecessorExecutableDigest", "predecessorExecutableDigest"],
    ["predecessorReleaseDigest", "predecessorReleaseDigest"],
  ] as const) {
    if (authorization[authorizationName] !== ready[launchName])
      issues.push(`${authorizationName}:attachment-mismatch`);
  }
  if (
    gateRoot.transactionId !== fenceRoot.transactionId ||
    fenceRoot.transactionId !== ready.transactionId
  )
    issues.push("transactionId:root-launch-mismatch");
  for (const name of ["installationId", "projectId", "stateRootDigest"]) {
    if (
      gateRoot[name] !== fenceRoot[name] ||
      fenceRoot[name] !== predecessorActiveRecord[name] ||
      predecessorActiveRecord[name] !== ready[name]
    )
      issues.push(`${name}:root-active-launch-mismatch`);
  }
  for (const [rootName, launchName] of [
    ["cycleId", "cycleId"],
    ["oldActiveRecordDigest", "activeRecordDigest"],
    ["predecessorExecutableDigest", "predecessorExecutableDigest"],
    ["predecessorReleaseDigest", "predecessorReleaseDigest"],
  ] as const) {
    if (fenceRoot[rootName] !== ready[launchName]) issues.push(`${rootName}:fence-launch-mismatch`);
  }
  if (
    predecessorActiveRecordDigest !== ready.activeRecordDigest ||
    gateRoot.expectedActiveRecordDigest !== predecessorActiveRecordDigest ||
    fenceRoot.oldActiveRecordDigest !== predecessorActiveRecordDigest
  )
    issues.push("activeRecordDigest:authority-mismatch");
  if (
    predecessorActiveRecord.executablePath !== ready.predecessorExecutablePath ||
    predecessorActiveRecord.executableDigest !== ready.predecessorExecutableDigest ||
    predecessorActiveRecord.releaseDigest !== ready.predecessorReleaseDigest
  )
    issues.push("predecessorExecutable:authority-mismatch");
  if (
    predecessorActiveRecord.operationManifestDigest !== fenceRoot.predecessorOperationManifestDigest
  )
    issues.push("predecessorOperationManifestDigest:authority-mismatch");
  if (ready.argvDigest !== expectedArgvDigest) issues.push("argvDigest:authority-mismatch");
  if (
    gateRoot.expectedFenceRootPath !== fenceRoot.recordPath ||
    gateRoot.expectedFenceRootDigest !== fenceRootDigest
  )
    issues.push("fenceRoot:gate-binding-mismatch");
  if (
    gateHead.publication === "PUBLISHED" &&
    (gateHead.fenceDigest !== gateRoot.expectedFenceRootDigest ||
      gateHead.fenceDigest !== fenceRootDigest)
  )
    issues.push("fenceDigest:published-authority-mismatch");
  for (const [authorizationName, fenceName] of [
    ["pendingAdmissionDigest", "pendingAdmissionDigest"],
    ["successorExecutableDigest", "successorExecutableDigest"],
    ["successorReleaseDigest", "successorReleaseDigest"],
    ["operationManifestDigest", "successorOperationManifestDigest"],
  ] as const) {
    if (authorization[authorizationName] !== fenceRoot[fenceName])
      issues.push(`${authorizationName}:fence-authority-mismatch`);
  }
  if (
    gateRoot.releaseDigest !== fenceRoot.successorReleaseDigest ||
    gateRoot.releaseDigest !== authorization.successorReleaseDigest
  )
    issues.push("releaseDigest:successor-authority-mismatch");
  if (gateRoot.expectedActiveGeneration !== predecessorActiveRecord.activeGeneration)
    issues.push("expectedActiveGeneration:predecessor-mismatch");
  if (
    gateRoot.recoveryAuthorizationId !== authorization.transactionId ||
    gateRoot.recoveryAuthorizationPath !== authorization.recordPath ||
    gateRoot.expectedConsumedAuthorizationDigest !== authorization.capabilityDigest
  )
    issues.push("recoveryAuthorization:consumed-identity-mismatch");
  if (
    !["PENDING", "ACTIVATING"].includes(gateHead.lifecycle as string) ||
    gateHead.publication !== "PUBLISHED" ||
    gateHead.activeRecordDigest !== predecessorActiveRecordDigest
  )
    issues.push("gateHead:not-attachment-authority");
  if (
    fenceHead.activeRecordDigest !== predecessorActiveRecordDigest ||
    fenceHead.activeGeneration !== predecessorActiveRecord.activeGeneration
  )
    issues.push("fenceHead:not-predecessor-authority");
  if (ready.lifecycle !== "READY" || ready.ordinal !== 0)
    issues.push("readyRecord:not-generation-root");
  issues.push(
    ...validateRecoveryLaunchTransition(
      ready,
      live,
      readyDigest,
      current.expectedPointerDigest as string,
    ).map((issue) => `readyToLive:${issue}`),
  );
  if (
    live.lifecycle !== "LIVE" ||
    live.ordinal !== 1 ||
    live.previousStateRecordDigest !== readyDigest
  )
    issues.push("liveRecord:not-ready-successor");
  if (authorization.recoveryReadyRecordDigest !== readyDigest)
    issues.push("recoveryReadyRecordDigest:mismatch");
  if (authorization.recoveryInitialLiveRecordDigest !== liveDigest)
    issues.push("recoveryInitialLiveRecordDigest:mismatch");
  if (
    current.launchDigest !== liveDigest ||
    current.launchLifecycle !== "LIVE" ||
    current.launchOrdinal !== live.ordinal ||
    current.expectedPointerDigest !== live.priorPointerDigest
  )
    issues.push("current:live-binding-mismatch");
  for (const [currentName, launchName] of [
    ["transactionId", "transactionId"],
    ["source", "source"],
    ["sourcePathToken", "sourcePathToken"],
    ["cycleId", "cycleId"],
    ["installationId", "installationId"],
    ["projectId", "projectId"],
    ["stateRootDigest", "stateRootDigest"],
    ["predecessorExecutablePath", "predecessorExecutablePath"],
    ["predecessorExecutableDigest", "predecessorExecutableDigest"],
    ["activeRecordDigest", "activeRecordDigest"],
    ["argvDigest", "argvDigest"],
    ["expectedFenceRootDigest", "expectedFenceRootDigest"],
    ["fenceRootDigest", "fenceRootDigest"],
    ["fenceHeadOrdinal", "fenceHeadOrdinal"],
    ["fenceHeadDigest", "fenceHeadDigest"],
    ["gateRootDigest", "gateRootDigest"],
    ["gateHeadOrdinal", "gateHeadOrdinal"],
    ["gateHeadDigest", "gateHeadDigest"],
    ["generation", "generation"],
    ["attempt", "attempt"],
  ] as const) {
    if (current[currentName] !== live[launchName])
      issues.push(`${currentName}:current-launch-mismatch`);
  }
  for (const [authorizationName, launchName] of [
    ["recoveryGateRootDigest", "gateRootDigest"],
    ["recoveryFenceRootDigest", "fenceRootDigest"],
  ] as const) {
    if (
      authorization[authorizationName] !== ready[launchName] ||
      ready[launchName] !== live[launchName] ||
      live[launchName] !== current[launchName]
    )
      issues.push(`${authorizationName}:root-mismatch`);
  }
  for (const launch of [ready, live, current]) {
    if (
      launch.gateRootDigest !== gateRootDigest ||
      launch.gateHeadOrdinal !== gateHead.ordinal ||
      launch.gateHeadDigest !== gateHeadDigest
    )
      issues.push("gateHead:launch-binding-mismatch");
    if (
      launch.fenceRootDigest !== fenceRootDigest ||
      launch.fenceHeadOrdinal !== fenceHead.ordinal ||
      launch.fenceHeadDigest !== fenceHeadDigest
    )
      issues.push("fenceHead:launch-binding-mismatch");
  }
  return [...new Set(issues)].sort();
}

function changed(
  left: ContractRecord,
  right: ContractRecord,
  names: readonly string[],
): readonly string[] {
  return names.filter((name) => left[name] !== right[name]).map((name) => `${name}:changed`);
}

export function validateRecoveryLaunchTransition(
  previous: ContractRecord,
  next: ContractRecord,
  previousStateRecordDigest: string,
  previousPointerDigest: string,
): readonly string[] {
  const issues: string[] = [];
  if (next.previousStateRecordDigest !== previousStateRecordDigest)
    issues.push("previousStateRecordDigest:mismatch");
  if (next.priorPointerDigest !== previousPointerDigest) issues.push("priorPointerDigest:mismatch");
  issues.push(
    ...changed(previous, next, [
      "transactionId",
      "source",
      "sourcePathToken",
      "cycleId",
      "installationId",
      "projectId",
      "stateRootDigest",
      "predecessorReleaseDigest",
      "predecessorExecutablePath",
      "predecessorExecutableDigest",
      "activeRecordDigest",
      "argvDigest",
      "expectedFenceRootDigest",
      "fenceRootPath",
      "fenceRootDigest",
      "gateRootPath",
      "gateRootDigest",
    ]),
  );
  if (next.transitionKind === "AUTHORITY_REBIND") {
    if (next.generation !== previous.generation) issues.push("generation:changed-during-rebind");
    if (next.ordinal !== (previous.ordinal as number) + 1) issues.push("ordinal:not-adjacent");
    issues.push(
      ...changed(previous, next, [
        "lifecycle",
        "attempt",
        "processTreeDigest",
        "startedAt",
        "heartbeatAt",
        "terminalAt",
      ]),
    );
    const advance = next.authorityAdvance;
    if (advance === "GATE") {
      if (next.gateHeadDigest === previous.gateHeadDigest)
        issues.push("gateHeadDigest:not-advanced");
      if (next.gateHeadOrdinal !== (previous.gateHeadOrdinal as number) + 1)
        issues.push("gateHeadOrdinal:not-adjacent");
      if (next.fenceHeadDigest !== previous.fenceHeadDigest)
        issues.push("fenceHeadDigest:also-advanced");
      if (next.fenceHeadOrdinal !== previous.fenceHeadOrdinal)
        issues.push("fenceHeadOrdinal:also-advanced");
    } else if (advance === "FENCE") {
      if (next.fenceHeadDigest === previous.fenceHeadDigest)
        issues.push("fenceHeadDigest:not-advanced");
      if (next.fenceHeadOrdinal !== (previous.fenceHeadOrdinal as number) + 1)
        issues.push("fenceHeadOrdinal:not-adjacent");
      if (next.gateHeadDigest !== previous.gateHeadDigest)
        issues.push("gateHeadDigest:also-advanced");
      if (next.gateHeadOrdinal !== previous.gateHeadOrdinal)
        issues.push("gateHeadOrdinal:also-advanced");
      issues.push(...changed(previous, next, ["gateLifecycle", "gatePublication"]));
    } else {
      issues.push("authorityAdvance:invalid");
    }
  } else {
    if (next.authorityAdvance !== null) issues.push("authorityAdvance:lifecycle-must-be-null");
    const allowed: Readonly<Record<string, readonly string[]>> = {
      READY: ["LIVE", "TERMINAL_RETRYABLE", "TERMINAL_ABORTED", "UNKNOWN"],
      LIVE: [
        "TERMINAL_RETRYABLE",
        "TERMINAL_HANDOFF",
        "TERMINAL_ABORTED",
        "TERMINAL_COMPLETE",
        "UNKNOWN",
      ],
      TERMINAL_RETRYABLE: ["READY"],
      TERMINAL_HANDOFF: [],
      TERMINAL_ABORTED: [],
      TERMINAL_COMPLETE: [],
      UNKNOWN: [],
    };
    if (!allowed[previous.lifecycle as string]?.includes(next.lifecycle as string))
      issues.push("lifecycle:transition-refused");
    const retry = previous.lifecycle === "TERMINAL_RETRYABLE" && next.lifecycle === "READY";
    const expectedAttempt = retry ? (previous.attempt as number) + 1 : previous.attempt;
    if (next.attempt !== expectedAttempt) issues.push("attempt:transition-mismatch");
    if (
      previous.processTreeDigest !== null &&
      !retry &&
      next.processTreeDigest !== previous.processTreeDigest
    )
      issues.push("processTreeDigest:changed");
    if (retry) {
      if (next.generation !== (previous.generation as number) + 1)
        issues.push("generation:retry-not-adjacent");
      if (next.ordinal !== 0) issues.push("ordinal:retry-must-reset");
    } else {
      if (next.generation !== previous.generation) issues.push("generation:changed");
      if (next.ordinal !== (previous.ordinal as number) + 1) issues.push("ordinal:not-adjacent");
    }
    issues.push(
      ...changed(previous, next, [
        "gateHeadDigest",
        "gateHeadOrdinal",
        "gateLifecycle",
        "gatePublication",
        "fenceHeadDigest",
        "fenceHeadOrdinal",
      ]),
    );
  }
  return [...new Set(issues)].sort();
}

export function validateRecoveryAuthorityAlignment(
  launch: ContractRecord,
  observed: {
    readonly gateHeadDigest: string;
    readonly gateHeadOrdinal: number;
    readonly fenceHeadDigest: string | null;
    readonly fenceHeadOrdinal: number | null;
  },
): readonly string[] {
  const issues: string[] = [];
  if (launch.gateHeadDigest !== observed.gateHeadDigest)
    issues.push("gateHeadDigest:launch-behind");
  if (launch.gateHeadOrdinal !== observed.gateHeadOrdinal)
    issues.push("gateHeadOrdinal:launch-behind");
  if (launch.fenceHeadDigest !== observed.fenceHeadDigest)
    issues.push("fenceHeadDigest:launch-behind");
  if (launch.fenceHeadOrdinal !== observed.fenceHeadOrdinal)
    issues.push("fenceHeadOrdinal:launch-behind");
  return issues;
}

export function validateFenceAuthorityBinding(
  root: ContractRecord,
  head: ContractRecord,
  current: ContractRecord,
  rootDigest: string,
  headDigest: string,
): readonly string[] {
  const issues: string[] = [];
  for (const name of ["transactionId", "installationId", "projectId", "stateRootDigest"]) {
    if (root[name] !== current[name]) issues.push(`${name}:root-current-mismatch`);
  }
  if (head.transactionId !== root.transactionId) issues.push("transactionId:root-head-mismatch");
  if (head.rootDigest !== rootDigest || current.rootDigest !== rootDigest)
    issues.push("rootDigest:binding-mismatch");
  if (current.headDigest !== headDigest) issues.push("headDigest:binding-mismatch");
  for (const [currentName, headName] of [
    ["headOrdinal", "ordinal"],
    ["headLifecycle", "lifecycle"],
    ["generation", "activeGeneration"],
  ] as const) {
    if (current[currentName] !== head[headName]) issues.push(`${currentName}:head-mismatch`);
  }
  const prepared = head.lifecycle === "PREPARED";
  const expectedGeneration = prepared ? root.oldGeneration : root.expectedGeneration;
  const expectedActiveDigest = prepared
    ? root.oldActiveRecordDigest
    : root.expectedActiveRecordDigest;
  if (head.activeGeneration !== expectedGeneration)
    issues.push("activeGeneration:root-state-mismatch");
  if (head.activeRecordDigest !== expectedActiveDigest)
    issues.push("activeRecordDigest:root-state-mismatch");
  return [...new Set(issues)].sort();
}

export function validateCleanupAuthorityBinding(
  root: ContractRecord,
  head: ContractRecord,
  current: ContractRecord,
  rootDigest: string,
  headDigest: string,
): readonly string[] {
  const issues: string[] = [];
  for (const name of ["transactionId", "installationId", "projectId", "stateRootDigest"]) {
    if (root[name] !== current[name]) issues.push(`${name}:root-current-mismatch`);
  }
  if (head.transactionId !== root.transactionId) issues.push("transactionId:root-head-mismatch");
  if (head.rootDigest !== rootDigest || current.rootDigest !== rootDigest)
    issues.push("rootDigest:binding-mismatch");
  if (current.headDigest !== headDigest) issues.push("headDigest:binding-mismatch");
  for (const [currentName, headName] of [
    ["headOrdinal", "ordinal"],
    ["headLifecycle", "lifecycle"],
    ["headPublication", "publication"],
  ] as const) {
    if (current[currentName] !== head[headName]) issues.push(`${currentName}:head-mismatch`);
  }
  if (
    head.activeRecordDigest !== null &&
    head.activeRecordDigest !== root.expectedActiveRecordDigest
  )
    issues.push("activeRecordDigest:root-mismatch");
  return [...new Set(issues)].sort();
}

export function validateFenceHeadTransition(
  previous: ContractRecord,
  next: ContractRecord,
  previousDigest: string,
): readonly string[] {
  const order = ["PREPARED", "POST_ACTIVATION"];
  const issues = [
    ...(next.transactionId === previous.transactionId ? [] : ["transactionId:changed"]),
    ...(next.rootDigest === previous.rootDigest ? [] : ["rootDigest:changed"]),
    ...(next.ordinal === (previous.ordinal as number) + 1 ? [] : ["ordinal:not-adjacent"]),
    ...(next.previousHeadDigest === previousDigest ? [] : ["previousHeadDigest:mismatch"]),
    ...(order.indexOf(next.lifecycle as string) === order.indexOf(previous.lifecycle as string) + 1
      ? []
      : ["lifecycle:transition-refused"]),
  ];
  return issues.sort();
}

export function validateCleanupHeadTransition(
  previous: ContractRecord,
  next: ContractRecord,
  previousDigest: string,
): readonly string[] {
  const issues = [
    ...(next.transactionId === previous.transactionId ? [] : ["transactionId:changed"]),
    ...(next.rootDigest === previous.rootDigest ? [] : ["rootDigest:changed"]),
    ...(next.ordinal === (previous.ordinal as number) + 1 ? [] : ["ordinal:not-adjacent"]),
    ...(next.previousHeadDigest === previousDigest ? [] : ["previousHeadDigest:mismatch"]),
  ];
  if (
    !isCleanupLifecyclePublicationTransition(
      previous.lifecycle,
      previous.publication,
      next.lifecycle,
      next.publication,
    )
  )
    issues.push("lifecyclePublication:transition-refused");
  return [...new Set(issues)].sort();
}

export type InitializationPrefix =
  "ALL_ABSENT" | "ROOT_ONLY" | "ROOT_AND_INITIAL_HEAD" | "FULLY_CURRENT" | "UNKNOWN";

export function reduceInitializationCensus(census: {
  readonly root: boolean;
  readonly heads: readonly {
    readonly ordinal: number;
    readonly previousHeadDigest: string | null;
  }[];
  readonly current: boolean;
  readonly extraHistory: boolean;
}): InitializationPrefix {
  if (census.extraHistory) return "UNKNOWN";
  if (!census.root && census.heads.length === 0 && !census.current) return "ALL_ABSENT";
  if (census.root && census.heads.length === 0 && !census.current) return "ROOT_ONLY";
  if (
    census.root &&
    census.heads.length === 1 &&
    census.heads[0]?.ordinal === 0 &&
    census.heads[0].previousHeadDigest === null
  )
    return census.current ? "FULLY_CURRENT" : "ROOT_AND_INITIAL_HEAD";
  return "UNKNOWN";
}

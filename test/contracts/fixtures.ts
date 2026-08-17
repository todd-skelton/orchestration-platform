import {
  diagnostic,
  nativeConsumePath,
  recoveryAuthorizationCorePath,
  schemaDefinitions,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
} from "../../packages/contracts/src/index.js";

const {
  cleanupGateArchivePath,
  cleanupGateCurrentPath,
  cleanupGateHeadPath,
  cleanupGateRootPath,
  cleanupHeadCurrentPath,
  recoveryAuthorizationPath,
  recoveryFenceCurrentPath,
  recoveryFenceHeadPath,
  recoveryFenceRootPath,
  recoveryLaunchCurrentPath,
  recoveryLaunchPath,
} = diagnostic.paths;

export const uuid = "018f0c24-7a3b-7cc1-8a2f-1234567890ab";
export const uuid2 = "018f0c24-7a3b-7cc1-9a2f-1234567890ac";
export const digest = "a".repeat(64);
export const digest2 = "b".repeat(64);
export const instant = "2026-08-16T12:34:56.789Z";
export const later = "2026-08-16T12:35:56.789Z";

function scalar(rule: FieldRule): JsonValue {
  if (rule.values) return rule.values[0]!;
  switch (rule.kind) {
    case "boolean":
      return false;
    case "bounded-string":
      return "alpha";
    case "decimal":
      return "1";
    case "file-url":
      return "file:///var/lib/orchestration/state";
    case "integer":
      return 0;
    case "opaque":
      return "alpha";
    case "positive-integer":
      return 1;
    case "relative-path":
      return "state/item.json";
    case "schema-id":
      return "facts/v1";
    case "semver":
      return "1.0.0";
    case "sha256":
      return digest;
    case "timestamp":
      return instant;
    case "uuid-v7":
      return uuid;
  }
}

function baseFixture(schemaVersion: string): Record<string, JsonValue> {
  const definition =
    schemaDefinitions[schemaVersion] ?? diagnostic.schemaDefinitions[schemaVersion]!;
  return Object.fromEntries(
    Object.entries(definition.fields).map(([name, rule]) => {
      if (name === "schemaVersion") return [name, schemaVersion];
      if (rule.nullable) return [name, null];
      const value = scalar(rule);
      return [name, rule.array ? [value] : value];
    }),
  );
}

function overrides(schemaVersion: string): Record<string, JsonValue> {
  switch (schemaVersion) {
    case "platform-configuration/v1":
      return {
        capabilityNames: ["read", "write"],
        leaseFreshnessMs: 3_600_000,
        maximumSessionMs: 86_400_000,
        wallClockSkewMs: 300_000,
      };
    case "session-lease/v1":
    case "breaker-authority/v1":
      return { expiresAt: later };
    case "review-receipt/v1":
      return { reviewerIdentity: "reviewer", authorIdentity: "author" };
    case "module-plan-result/v1":
      return { actionDigest: digest, noActionDigest: null, refusalCode: null };
    case "pending-successor/v1":
      return { currentGeneration: 0, successorGeneration: 1 };
    case "active-release/v1":
      return {
        activeGeneration: 0,
        priorActiveRecordDigest: null,
        cleanupTransactionId: uuid,
        cleanupArchivePath: cleanupGateArchivePath(uuid),
        supervisorShimVersion: "supervisor-shim/v1",
      };
    case "activation-recovery-fence-root/v1":
      return {
        transactionId: uuid,
        recordPath: recoveryFenceRootPath(uuid),
        oldGeneration: 0,
        expectedGeneration: 1,
        oldActiveRecordDigest: digest,
      };
    case "activation-recovery-fence-head/v1":
      return {
        transactionId: uuid,
        ordinal: 0,
        lifecycle: "PREPARED",
        previousHeadDigest: null,
        recordPath: recoveryFenceHeadPath(uuid, 0, "PREPARED"),
      };
    case "activation-recovery-fence-current/v1":
      return {
        transactionId: uuid,
        generation: 0,
        headLifecycle: "PREPARED",
        headOrdinal: 0,
        expectedPointerDigest: null,
        recordPath: recoveryFenceCurrentPath,
        rootPath: recoveryFenceRootPath(uuid),
        headPath: recoveryFenceHeadPath(uuid, 0, "PREPARED"),
      };
    case "activation-recovery-launch/v1":
      return {
        transactionId: uuid,
        source: "recovery-fence/v1",
        sourcePathToken: "recovery-fence-v1",
        generation: 0,
        ordinal: 0,
        previousStateRecordDigest: null,
        priorPointerDigest: null,
        recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 0, "READY"),
        expectedFenceRootDigest: digest,
        fenceRootPath: recoveryFenceRootPath(uuid),
        fenceRootDigest: digest,
        fenceHeadOrdinal: 0,
        fenceHeadDigest: digest2,
        gateRootPath: cleanupGateRootPath(uuid),
        gateRootDigest: digest,
        gateHeadOrdinal: 0,
        gateHeadDigest: digest,
        gateLifecycle: "PENDING",
        gatePublication: "PUBLISHED",
        lifecycle: "READY",
        startedAt: null,
        heartbeatAt: null,
        processTreeDigest: null,
        terminalAt: null,
        transitionKind: "LIFECYCLE",
        authorityAdvance: null,
      };
    case "activation-recovery-launch-current/v1":
      return {
        transactionId: uuid,
        source: "recovery-fence/v1",
        sourcePathToken: "recovery-fence-v1",
        generation: 0,
        launchLifecycle: "READY",
        launchOrdinal: 0,
        fenceRootDigest: digest,
        fenceHeadOrdinal: 0,
        fenceHeadDigest: digest2,
        expectedPointerDigest: null,
        recordPath: recoveryLaunchCurrentPath,
        launchPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 0, "READY"),
      };
    case "activation-recovery-launch-archive/v1":
      return {
        transactionId: uuid,
        source: "recovery-fence/v1",
        sourcePathToken: "recovery-fence-v1",
        terminalLifecycle: "TERMINAL_COMPLETE",
        fenceClearReceiptDigest: digest,
        stateRecordPaths: [
          recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 0, "TERMINAL_COMPLETE"),
        ],
        stateRecordDigests: [digest],
        recordPath: `installation/activation-recovery-launches/${uuid}/recovery-fence-v1/archive.json`,
      };
    case "recovery-authorization/v1":
      return {
        transactionId: uuid,
        recordPath: recoveryAuthorizationPath(uuid),
        mode: "bootstrap-n0",
        bootstrapGrantDigest: digest,
        bootstrapInstallerDigest: digest,
        candidateDigest: digest,
        destinationStateRootDigest: digest,
        lifecycle: "CREATED_UNCONSUMED",
        consumedAt: null,
        revokedAt: null,
      };
    case "activation-cleanup-gate-root/v1":
      return {
        transactionId: uuid,
        mode: "N0",
        recordPath: cleanupGateRootPath(uuid),
        archivePath: cleanupGateArchivePath(uuid),
        expectedActiveGeneration: 0,
        expectedActiveRecordDigest: null,
        priorCleanupHeadDigest: null,
        expectedFenceRootDigest: null,
        expectedFenceRootPath: null,
        recoveryAuthorizationPath: recoveryAuthorizationPath(uuid),
      };
    case "activation-cleanup-gate-head/v1":
      return {
        transactionId: uuid,
        ordinal: 0,
        previousHeadDigest: null,
        recordPath: cleanupGateHeadPath(uuid, 0, "PENDING", "NOT_PUBLISHED"),
        lifecycle: "PENDING",
        publication: "NOT_PUBLISHED",
        abortRevocationReceiptDigest: null,
        activeRecordDigest: null,
        fenceDigest: null,
        terminalRevocationReceiptDigest: null,
      };
    case "activation-cleanup-gate-current/v1":
      return {
        transactionId: uuid,
        headOrdinal: 0,
        headLifecycle: "PENDING",
        headPublication: "NOT_PUBLISHED",
        expectedPointerDigest: null,
        recordPath: cleanupGateCurrentPath,
        rootPath: cleanupGateRootPath(uuid),
        headPath: cleanupGateHeadPath(uuid, 0, "PENDING", "NOT_PUBLISHED"),
      };
    case "activation-cleanup-gate-archive/v1":
      return {
        transactionId: uuid,
        recordPath: cleanupGateArchivePath(uuid),
        outcome: "ACTIVATED",
        terminalProofDigest: digest,
      };
    case "activation-cleanup-head/v1":
      return {
        transactionId: uuid,
        recordPath: cleanupHeadCurrentPath,
        archivePath: cleanupGateArchivePath(uuid),
      };
    case "repository-protection-receipt/v1":
      return {
        verifierAnchorVariableName: "VERIFIER_ANCHOR_SHA256",
        verifierAnchorVariableUpdatedAt: "2026-08-16T12:33:56.789Z",
        producerStartedAt: instant,
        issuedAt: later,
        expiresAt: "2026-08-16T12:36:56.789Z",
      };
    case "recovery-authorization-core/v1":
      return {
        mode: "BOOTSTRAP",
        grantDigest: digest,
        installerDigest: digest,
        destinationDigest: digest,
        expiresAt: later,
      };
    case "recovery-authorization-state/v2":
      return {
        nativeConsumeReceiptPath: nativeConsumePath(uuid, uuid),
      };
    case "activation-cleanup-gate-root/v2":
      return {
        authorizationCorePath: recoveryAuthorizationCorePath(uuid),
        nativeConsumeReceiptPath: nativeConsumePath(uuid, uuid),
      };
    case "activation-recovery-launch/v2":
      return {
        sourceToken: "recovery-fence-v2",
        lifecycle: "READY",
        fenceRootDigest: digest,
        fenceHeadDigest: digest2,
      };
    case "recovery-attempt-descriptor/v1":
      return {
        sourceToken: "recovery-fence-v2",
        lifecycle: "READY_ONLY",
        fenceRootDigest: digest,
        fenceHeadDigest: digest2,
      };
    default:
      return {};
  }
}

export function fixtureFor(schemaVersion: string): ContractRecord {
  return structuredClone({ ...baseFixture(schemaVersion), ...overrides(schemaVersion) });
}

export const validFixtures: Readonly<Record<string, ContractRecord>> = Object.freeze(
  Object.fromEntries(
    Object.keys(schemaDefinitions).map((schemaVersion) => [
      schemaVersion,
      fixtureFor(schemaVersion),
    ]),
  ),
);

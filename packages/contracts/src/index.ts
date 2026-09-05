import {
  computeProjectMutationRequestDigest,
  computeProjectMutationPlanDigest,
  computeProjectApplyReceiptDigest,
  projectMutationSchemaVersions,
  parseProjectMutationContract,
} from "./project-mutation.js";
import {
  computeCycleReceiptDigest,
  computeEventJournalDigest,
  computeOrchestrationEventDigest,
  computeReducedStateDigest,
  journalSchemaVersions,
  parseEventJournalBytes,
  parseJournalContract,
  serializeEventJournal,
} from "./journal.js";
import {
  computeResourceReclaimReceiptDigest,
  parseResourceReclaimContract,
  resourceReclaimSchemaVersions,
} from "./resource-reclaim.js";
import {
  computeActionDispositionDigest,
  computeFollowUpCycleRequestDigest,
  dispositionSchemaVersions,
  parseDispositionContract,
} from "./disposition.js";
import {
  computeProjectPreflightDigest,
  parseProjectPreflightContract,
} from "./project-preflight.js";
import {
  computeDispatchPlanDigest,
  computeWorkerLaunchReceiptDigest,
  computeWorkerTerminalReceiptDigest,
  dispatchLifecycleSchemaVersions,
  parseDispatchLifecycleContract,
} from "./dispatch-lifecycle.js";
import { compatibilityDisposition, schemaDefinitions, schemaVersions } from "./registry.js";
import {
  computeBootstrapVerifierAnchorDigest,
  parseVerifierAnchorContract,
} from "./verifier-anchor.js";
import {
  computeRepositoryProtectionReceiptDigest,
  parseRepositoryProtectionContract,
} from "./repository-protection.js";
import {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  parseCanonicalBytes,
  snapshotBytes,
  validateDefinition,
  type ParseResult,
} from "./runtime.js";
import { parseSimplifiedAuthorityContract } from "./authority.js";
import { parseCommitContract } from "./commit.js";
import { parseDispatchContract } from "./dispatch.js";
import { parseEvidenceContract } from "./evidence.js";
import { parseExternalContract } from "./external.js";
import { parseDestinationOwnerContract } from "./owner.js";
import { parseDestinationOwnerSuccessorContract } from "./successor.js";
import { parseBootstrapAnchorContract } from "./anchor.js";
import { parseBootstrapUseIntentContract } from "./intent.js";
import { parseBootstrapAnchorTeardownContract } from "./teardown.js";
import { parseBootstrapGenesisContract } from "./genesis.js";
import { parseBootstrapConsumptionContract } from "./consumption.js";
import { parsePacketContract } from "./packet.js";
import { parsePointerGraphContract } from "./pointer.js";
import { parseGateFenceContract } from "./definitions.js";
import { computeRecoveryAttemptDescriptorDigest, parseRecoveryAttemptContract } from "./attempt.js";
import {
  computeRecoveryAttemptLogRecordDigest,
  parseRecoveryAttemptLogContract,
} from "./attempt-log.js";
import {
  computeNativeConsumeReceiptDigest,
  computeNativeRemovalReceiptDigest,
  computeRecoveryAuthorizationArchiveDigest,
  computeRecoveryAuthorizationConsumeReceiptDigest,
  computeRecoveryAuthorizationCoreDigest,
  computeRecoveryAuthorizationRevokeReceiptDigest,
  parseRecoveryAuthorizationContract,
} from "./recovery.js";
import { parseConfigurationContract } from "./configuration.js";
import { computeRouteSelectionDigest, parseRouteSelectionContract } from "./route-selection.js";
import { parseProjectSnapshotContract } from "./project-snapshot.js";
import { parseProjectBreakerFactsContract } from "./project-breaker-facts.js";
import { computeBreakerReceiptDigest, parseBreakerReceiptContract } from "./breaker-receipt.js";
import { computeRoutineStepSkipDigest, parseRoutineStepSkipContract } from "./routine-step.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseReviewSubjectContract,
  reviewSubjectSchemaVersions,
} from "./review-subject.js";
import { computeReviewRequestDigest, parseReviewRequestContract } from "./review-request.js";
import {
  computeModuleActionPlanDigest,
  computeModuleDescriptorDigest,
  computeModuleNoActionDigest,
  computeModulePlanInputDigest,
  modulePlanSchemaVersions,
  parseModulePlanContract,
} from "./module-plan.js";
import {
  computeReviewAttemptResultDigest,
  computeReviewAuthorityDigest,
  parseReviewResultContract,
  reviewResultSchemaVersions,
} from "./review-result.js";
import {
  computeCyclePlanDigest,
  computeCycleRequestDigest,
  computeSessionAcquireRequestDigest,
  computeSessionHealthDigest,
  computeSessionReceiptDigest,
  cycleEntrySchemaVersions,
  parseCycleEntryContract,
} from "./cycle-entry.js";

export * from "./authority.js";
export * from "./verifier-anchor.js";
export * from "./repository-protection.js";
export * from "./breaker-receipt.js";
export * from "./commit.js";
export * from "./definitions.js";
export * from "./dispatch.js";
export * from "./dispatch-lifecycle.js";
export * from "./disposition.js";
export * from "./evidence.js";
export * from "./packet.js";
export * from "./external.js";
export * from "./owner.js";
export * from "./successor.js";
export * from "./anchor.js";
export * from "./intent.js";
export * from "./teardown.js";
export * from "./genesis.js";
export * from "./consumption.js";
export * from "./selection.js";
export * from "./retirement.js";
export * from "./pointer.js";
export * from "./recovery.js";
export * from "./attempt.js";
export * from "./attempt-log.js";
export * from "./project-snapshot.js";
export * from "./project-preflight.js";
export * from "./project-mutation.js";
export * from "./journal.js";
export * from "./resource-reclaim.js";
export * from "./project-breaker-facts.js";
export * from "./module-plan.js";
export * from "./route-selection.js";
export * from "./routine-step.js";
export * from "./review-subject.js";
export * from "./review-request.js";
export * from "./review-result.js";
export * from "./cycle-entry.js";
export * from "./vocabulary.js";
export type * from "./runtime.js";
export {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  closedArray,
  closedRecord,
  compareCanonicalDecimal,
  frame,
  framedBytes,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUnicodeScalarSequence,
  isUuidV7,
  parseCanonicalDecimal,
  snapshotClosedArray,
  snapshotClosedRecord,
  snapshotJson,
} from "./runtime.js";
export {
  compatibilityDisposition,
  schemaDefinitions,
  schemaVersions,
  schemaVocabularyDefinitions,
} from "./registry.js";
export {
  computeConfigurationPathToken,
  configurationSchemaFields,
  configurationSchemaVersions,
  orchestrationCommandCensus,
  parseConfigurationPaths,
  parseConfigurationProvenance,
  parseOrchestrationCommandResult,
  parsePlatformConfigurationSource,
} from "./configuration.js";

export function parseContract(expectedSchemaVersion: string, input: unknown): ParseResult {
  const repositoryProtection = parseRepositoryProtectionContract(expectedSchemaVersion, input);
  if (repositoryProtection) return repositoryProtection;
  const verifierAnchor = parseVerifierAnchorContract(expectedSchemaVersion, input);
  if (verifierAnchor) return verifierAnchor;
  const journal = parseJournalContract(expectedSchemaVersion, input);
  if (journal) return journal;
  const reclaim = parseResourceReclaimContract(expectedSchemaVersion, input);
  if (reclaim) return reclaim;
  const projectMutation = parseProjectMutationContract(expectedSchemaVersion, input);
  if (projectMutation) return projectMutation;
  const disposition = parseDispositionContract(expectedSchemaVersion, input);
  if (disposition) return disposition;
  const dispatchLifecycle = parseDispatchLifecycleContract(expectedSchemaVersion, input);
  if (dispatchLifecycle) return dispatchLifecycle;
  const preflight = parseProjectPreflightContract(expectedSchemaVersion, input);
  if (preflight) return preflight;
  const route = parseRouteSelectionContract(expectedSchemaVersion, input);
  if (route) return route;
  const breakerReceipt = parseBreakerReceiptContract(expectedSchemaVersion, input);
  if (breakerReceipt) return breakerReceipt;
  const modulePlan = parseModulePlanContract(expectedSchemaVersion, input);
  if (modulePlan) return modulePlan;
  const reviewResult = parseReviewResultContract(expectedSchemaVersion, input);
  if (reviewResult) return reviewResult;
  const reviewRequest = parseReviewRequestContract(expectedSchemaVersion, input);
  if (reviewRequest) return reviewRequest;
  const reviewSubject = parseReviewSubjectContract(expectedSchemaVersion, input);
  if (reviewSubject) return reviewSubject;
  const cycleEntry = parseCycleEntryContract(expectedSchemaVersion, input);
  if (cycleEntry) return cycleEntry;
  const routineStepSkip = parseRoutineStepSkipContract(expectedSchemaVersion, input);
  if (routineStepSkip) return routineStepSkip;
  const projectBreakerFacts = parseProjectBreakerFactsContract(expectedSchemaVersion, input);
  if (projectBreakerFacts) return projectBreakerFacts;
  const projectSnapshot = parseProjectSnapshotContract(expectedSchemaVersion, input);
  if (projectSnapshot) return projectSnapshot;
  const configuration = parseConfigurationContract(expectedSchemaVersion, input);
  if (configuration) return configuration;
  const authority = parseSimplifiedAuthorityContract(expectedSchemaVersion, input);
  if (authority) return authority;
  const commit = parseCommitContract(expectedSchemaVersion, input);
  if (commit) return commit;
  const dispatch = parseDispatchContract(expectedSchemaVersion, input);
  if (dispatch) return dispatch;
  const evidence = parseEvidenceContract(expectedSchemaVersion, input);
  if (evidence) return evidence;
  const external = parseExternalContract(expectedSchemaVersion, input);
  if (external) return external;
  const owner = parseDestinationOwnerContract(expectedSchemaVersion, input);
  if (owner) return owner;
  const successor = parseDestinationOwnerSuccessorContract(expectedSchemaVersion, input);
  if (successor) return successor;
  const anchor = parseBootstrapAnchorContract(expectedSchemaVersion, input);
  if (anchor) return anchor;
  const intent = parseBootstrapUseIntentContract(expectedSchemaVersion, input);
  if (intent) return intent;
  const teardown = parseBootstrapAnchorTeardownContract(expectedSchemaVersion, input);
  if (teardown) return teardown;
  const genesis = parseBootstrapGenesisContract(expectedSchemaVersion, input);
  if (genesis) return genesis;
  const consumption = parseBootstrapConsumptionContract(expectedSchemaVersion, input);
  if (consumption) return consumption;
  const packet = parsePacketContract(expectedSchemaVersion, input);
  if (packet) return packet;
  const pointer = parsePointerGraphContract(expectedSchemaVersion, input);
  if (pointer) return pointer;
  const gateFence = parseGateFenceContract(expectedSchemaVersion, input);
  if (gateFence) return gateFence;
  const recoveryAuthorization = parseRecoveryAuthorizationContract(expectedSchemaVersion, input);
  if (recoveryAuthorization) return recoveryAuthorization;
  const recoveryAttempt = parseRecoveryAttemptContract(expectedSchemaVersion, input);
  if (recoveryAttempt) return recoveryAttempt;
  const recoveryAttemptLog = parseRecoveryAttemptLogContract(expectedSchemaVersion, input);
  if (recoveryAttemptLog) return recoveryAttemptLog;
  const definition = schemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:unsupported"] };
  try {
    return validateDefinition(definition, input);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export function parseCanonicalContractBytes(
  expectedSchemaVersion: string,
  bytes: Uint8Array,
): ParseResult {
  if (expectedSchemaVersion === "event-journal/v1") return parseEventJournalBytes(bytes);
  const definition = schemaDefinitions[expectedSchemaVersion];
  try {
    if (
      !definition &&
      expectedSchemaVersion !== "review-subject/v1" &&
      expectedSchemaVersion !== "module-plan-result/v1" &&
      !schemaVersions.includes(expectedSchemaVersion)
    )
      return { ok: false, issues: ["schemaVersion:unsupported"] };
    if (definition) return parseCanonicalBytes(definition, bytes);
    const snapshot = snapshotBytes(bytes);
    if (!snapshot.ok) return snapshot;
    const stableBytes = snapshot.value;
    if (expectedSchemaVersion === "adapter-configuration/v1" && stableBytes.byteLength > 65536)
      return { ok: false, issues: ["encoding:limit-exceeded"] };
    if (stableBytes[0] === 0xef && stableBytes[1] === 0xbb && stableBytes[2] === 0xbf)
      return { ok: false, issues: ["encoding:bom-refused"] };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(stableBytes);
    } catch {
      return { ok: false, issues: ["encoding:invalid-utf8"] };
    }
    if (text.startsWith("\ufeff")) return { ok: false, issues: ["encoding:bom-refused"] };
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return { ok: false, issues: ["encoding:invalid-json"] };
    }
    const parsed = parseContract(expectedSchemaVersion, input);
    if (!parsed.ok) return parsed;
    return canonicalJson(parsed.value) === text
      ? parsed
      : { ok: false, issues: ["encoding:noncanonical"] };
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export type SerializationResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };
export function serializeContract(
  expectedSchemaVersion: string,
  input: unknown,
): SerializationResult {
  const parsed = parseContract(expectedSchemaVersion, input);
  if (!parsed.ok) return parsed;
  if (expectedSchemaVersion === "repository-protection-receipt/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeRepositoryProtectionReceiptDigest(parsed.value),
    };
  if (expectedSchemaVersion === "bootstrap-verifier-anchor/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeBootstrapVerifierAnchorDigest(parsed.value),
    };
  if ((journalSchemaVersions as readonly string[]).includes(expectedSchemaVersion)) {
    const bytes =
      expectedSchemaVersion === "event-journal/v1"
        ? serializeEventJournal(parsed.value)
        : canonicalBytes(parsed.value);
    return {
      ok: true,
      bytes,
      digest:
        expectedSchemaVersion === "orchestration-event/v1"
          ? computeOrchestrationEventDigest(parsed.value)
          : expectedSchemaVersion === "event-journal/v1"
            ? computeEventJournalDigest(parsed.value)
            : expectedSchemaVersion === "reduced-state/v1"
              ? computeReducedStateDigest(parsed.value)
              : computeCycleReceiptDigest(parsed.value),
    };
  }
  if ((resourceReclaimSchemaVersions as readonly string[]).includes(expectedSchemaVersion))
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeResourceReclaimReceiptDigest(parsed.value),
    };
  if ((projectMutationSchemaVersions as readonly string[]).includes(expectedSchemaVersion))
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest:
        expectedSchemaVersion === "project-mutation-request/v1"
          ? computeProjectMutationRequestDigest(parsed.value)
          : expectedSchemaVersion === "project-mutation-plan/v1"
            ? computeProjectMutationPlanDigest(parsed.value)
            : computeProjectApplyReceiptDigest(parsed.value),
    };
  if ((dispositionSchemaVersions as readonly string[]).includes(expectedSchemaVersion))
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest:
        expectedSchemaVersion === "action-disposition/v1"
          ? computeActionDispositionDigest(parsed.value)
          : computeFollowUpCycleRequestDigest(parsed.value),
    };
  if ((dispatchLifecycleSchemaVersions as readonly string[]).includes(expectedSchemaVersion))
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest:
        expectedSchemaVersion === "dispatch-plan/v1"
          ? computeDispatchPlanDigest(parsed.value)
          : expectedSchemaVersion === "worker-launch-receipt/v1"
            ? computeWorkerLaunchReceiptDigest(parsed.value)
            : computeWorkerTerminalReceiptDigest(parsed.value),
    };
  if (expectedSchemaVersion === "project-preflight/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeProjectPreflightDigest(parsed.value),
    };
  if (expectedSchemaVersion === "route-selection/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeRouteSelectionDigest(parsed.value),
    };
  if (
    expectedSchemaVersion === "recovery-authorization-state/v1" ||
    expectedSchemaVersion === "recovery-attempt-reservation/v1"
  )
    return { ok: false, issues: ["serialization:pointer-context-required"] };
  if (
    expectedSchemaVersion === "review-subject/v1" ||
    (reviewSubjectSchemaVersions as readonly string[]).includes(expectedSchemaVersion)
  )
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest:
        parsed.value.schemaVersion === "worker-result-subject/v1"
          ? computeWorkerResultSubjectDigest(parsed.value)
          : computeReleaseCandidateSubjectDigest(parsed.value),
    };
  if (expectedSchemaVersion === "review-request/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeReviewRequestDigest(parsed.value),
    };
  if (expectedSchemaVersion === "breaker-receipt/v1")
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest: computeBreakerReceiptDigest(parsed.value),
    };
  if (
    expectedSchemaVersion === "module-plan-result/v1" ||
    (modulePlanSchemaVersions as readonly string[]).includes(expectedSchemaVersion)
  ) {
    const digest =
      parsed.value.schemaVersion === "module-descriptor/v1"
        ? computeModuleDescriptorDigest(parsed.value)
        : parsed.value.schemaVersion === "module-plan-input/v1"
          ? computeModulePlanInputDigest(parsed.value)
          : parsed.value.schemaVersion === "module-action-plan/v1"
            ? computeModuleActionPlanDigest(parsed.value)
            : computeModuleNoActionDigest(parsed.value);
    return { ok: true, bytes: canonicalBytes(parsed.value), digest };
  }
  if ((reviewResultSchemaVersions as readonly string[]).includes(expectedSchemaVersion))
    return {
      ok: true,
      bytes: canonicalBytes(parsed.value),
      digest:
        expectedSchemaVersion === "review-attempt-result/v1"
          ? computeReviewAttemptResultDigest(parsed.value)
          : computeReviewAuthorityDigest(parsed.value),
    };
  const digest =
    expectedSchemaVersion === "cycle-plan/v1"
      ? computeCyclePlanDigest(parsed.value)
      : expectedSchemaVersion === "cycle-request/v1"
        ? computeCycleRequestDigest(parsed.value)
        : expectedSchemaVersion === "session-acquire-request/v1"
          ? computeSessionAcquireRequestDigest(parsed.value)
          : expectedSchemaVersion === "session-health/v1"
            ? computeSessionHealthDigest(parsed.value)
            : expectedSchemaVersion === "session-receipt/v1"
              ? computeSessionReceiptDigest(parsed.value)
              : expectedSchemaVersion === "routine-step-skip/v1"
                ? computeRoutineStepSkipDigest(parsed.value)
                : expectedSchemaVersion === "attempt-log/v1"
                  ? computeRecoveryAttemptLogRecordDigest(parsed.value)
                  : expectedSchemaVersion === "recovery-attempt-descriptor/v1"
                    ? computeRecoveryAttemptDescriptorDigest(parsed.value)
                    : expectedSchemaVersion === "recovery-authorization-archive/v1"
                      ? computeRecoveryAuthorizationArchiveDigest(parsed.value)
                      : expectedSchemaVersion === "recovery-authorization-core/v1"
                        ? computeRecoveryAuthorizationCoreDigest(parsed.value)
                        : expectedSchemaVersion === "native-consume-receipt/v1"
                          ? computeNativeConsumeReceiptDigest(parsed.value)
                          : expectedSchemaVersion === "native-removal-receipt/v1"
                            ? computeNativeRemovalReceiptDigest(parsed.value)
                            : expectedSchemaVersion === "recovery-authorization-consume-receipt/v1"
                              ? computeRecoveryAuthorizationConsumeReceiptDigest(parsed.value)
                              : expectedSchemaVersion === "recovery-authorization-revoke-receipt/v1"
                                ? computeRecoveryAuthorizationRevokeReceiptDigest(parsed.value)
                                : canonicalDigest(parsed.value);
  return { ok: true, bytes: canonicalBytes(parsed.value), digest };
}

export interface CompatibilityRow {
  readonly expectedSchemaVersion: string;
  readonly observedSchemaVersion: string | null;
  readonly disposition: "readable" | "refused";
}
export const compatibilityMatrix: readonly CompatibilityRow[] = Object.freeze(
  [...schemaVersions, "review-subject/v1", "module-plan-result/v1"].flatMap(
    (expectedSchemaVersion) => {
      const family = expectedSchemaVersion.slice(0, expectedSchemaVersion.lastIndexOf("/"));
      const observedVersions: readonly (string | null)[] = [
        ...(expectedSchemaVersion === "review-subject/v1" ? reviewSubjectSchemaVersions : []),
        ...(expectedSchemaVersion === "module-plan-result/v1"
          ? ["module-action-plan/v1", "module-no-action/v1"]
          : []),
        expectedSchemaVersion,
        `${family}/v0-fixture`,
        `${family}/v999`,
        null,
      ];
      return observedVersions.map((observedSchemaVersion) =>
        Object.freeze({
          expectedSchemaVersion,
          observedSchemaVersion,
          disposition: compatibilityDisposition(expectedSchemaVersion, observedSchemaVersion),
        }),
      );
    },
  ),
);

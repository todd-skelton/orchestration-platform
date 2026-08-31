import {
  projectPreflightSchemaFields,
  projectPreflightSchemaVersions,
  projectPreflightRefusalReasons,
  projectPreflightUnknownReasons,
} from "./project-preflight.js";
import { type ContractDefinition, type ContractRecord } from "./runtime.js";
import { cycleEntrySchemaFields, cycleEntrySchemaVersions } from "./cycle-entry.js";
import { reviewSubjectSchemaFields, reviewSubjectSchemaVersions } from "./review-subject.js";
import { reviewRequestSchemaFields, reviewRequestSchemaVersions } from "./review-request.js";
import { modulePlanSchemaFields, modulePlanSchemaVersions } from "./module-plan.js";
import {
  routeSelectionSchemaFields,
  routeSelectionSchemaVersions,
  routeUnknownReasons,
} from "./route-selection.js";
import {
  reviewAuthorityUnknownReasons,
  reviewResultKinds,
  reviewResultSchemaFields,
  reviewResultSchemaVersions,
} from "./review-result.js";
import { projectSnapshotSchemaFields, projectSnapshotSchemaVersions } from "./project-snapshot.js";
import {
  routineStepKinds,
  routineStepSchemaFields,
  routineStepSkipOrdinals,
  routineStepSkipSchemaVersions,
} from "./routine-step.js";
import {
  projectBreakerFactsSchemaFields,
  projectBreakerFactsSchemaVersions,
} from "./project-breaker-facts.js";
import { simplifiedAuthoritySchemaFields, simplifiedAuthoritySchemaVersions } from "./authority.js";
import {
  commitRunPhases,
  commitRunStages,
  commitSchemaFields,
  commitSchemaVersions,
} from "./commit.js";
import {
  dispatchDirectiveKinds,
  dispatchPlanAccessors,
  dispatchResourceAccess,
  dispatchRoles,
  dispatchSchemaFields,
  dispatchSchemaVersions,
} from "./dispatch.js";
import {
  evidenceSchemaFields,
  evidenceSchemaVersions,
  unknownEvidenceReasons,
} from "./evidence.js";
import { pointerGraphSchemaFields, pointerGraphSchemaVersions, pointerKinds } from "./pointer.js";
import { packetSchemaFields, packetSchemaVersions } from "./packet.js";
import { externalSchemaFields, externalSchemaVersions } from "./external.js";
import { destinationOwnerSchemaFields, destinationOwnerSchemaVersions } from "./owner.js";
import { successorReviewSchemaFields, successorReviewSchemaVersions } from "./successor.js";
import { bootstrapAnchorSchemaFields, bootstrapAnchorSchemaVersions } from "./anchor.js";
import { bootstrapUseIntentSchemaFields, bootstrapUseIntentSchemaVersions } from "./intent.js";
import {
  bootstrapAnchorTeardownSchemaFields,
  bootstrapAnchorTeardownSchemaVersions,
} from "./teardown.js";
import { bootstrapGenesisSchemaFields, bootstrapGenesisSchemaVersions } from "./genesis.js";
import {
  bootstrapConsumptionSchemaFields,
  bootstrapConsumptionSchemaVersions,
} from "./consumption.js";
import { gateFenceSchemaFields, gateFenceSchemaVersions } from "./definitions.js";
import {
  recoveryAuthorizationArchiveSchemaFields,
  recoveryAuthorizationArchiveSchemaVersions,
  recoveryAuthorizationCoreSchemaFields,
  recoveryAuthorizationCoreSchemaVersions,
  recoveryAuthorizationNativeReceiptSchemaFields,
  recoveryAuthorizationNativeReceiptSchemaVersions,
  recoveryAuthorizationPostSelectionReceiptSchemaFields,
  recoveryAuthorizationPostSelectionReceiptSchemaVersions,
  recoveryAuthorizationStateSchemaFields,
  recoveryAuthorizationStateSchemaVersions,
} from "./recovery.js";
import {
  recoveryAttemptDescriptorSchemaFields,
  recoveryAttemptDescriptorSchemaVersions,
  recoveryAttemptReservationSchemaFields,
  recoveryAttemptReservationSchemaVersions,
} from "./attempt.js";
import {
  recoveryAttemptLogSchemaFields,
  recoveryAttemptLogSchemaVersions,
  recoveryAttemptTerminalDispositions,
} from "./attempt-log.js";
import {
  configurationSchemaFields,
  configurationSchemaVersions,
  orchestrationCommandCensus,
  platformConfigurationScalarIssues,
} from "./configuration.js";

const platformConfiguration: ContractDefinition = Object.freeze({
  schemaVersion: "platform-configuration/v1",
  fields: Object.freeze([
    "schemaVersion",
    "adapterId",
    "capabilityNames",
    "leaseFreshnessMs",
    "maximumSessionMs",
    "projectId",
    "stateRoot",
    "wallClockSkewMs",
  ]),
  validate(record: ContractRecord): readonly string[] {
    const issues = [...platformConfigurationScalarIssues(record)];
    if (typeof record.stateRoot !== "string" || !record.stateRoot.startsWith("file:///"))
      issues.push("stateRoot:invalid");
    return Object.freeze(issues);
  },
});

export const schemaDefinitions: Readonly<Record<string, ContractDefinition>> = Object.freeze({
  [platformConfiguration.schemaVersion]: platformConfiguration,
});
export const schemaVocabularyDefinitions: Readonly<Record<string, ContractDefinition>> =
  Object.freeze({
    ...schemaDefinitions,
    "project-preflight/v1": Object.freeze({
      schemaVersion: "project-preflight/v1",
      fields: projectPreflightSchemaFields.preflight,
      closedValues: Object.freeze([
        "ELIGIBLE",
        "REFUSED",
        "UNKNOWN",
        ...projectPreflightRefusalReasons,
        ...projectPreflightUnknownReasons,
      ]),
    }),
    ...Object.fromEntries(
      Object.entries(projectPreflightSchemaFields)
        .filter(([key]) => key !== "preflight")
        .map(([key, fields]) => [
          `project-preflight/v1#${key}`,
          Object.freeze({ schemaVersion: "project-preflight/v1", fields }),
        ]),
    ),
    "route-selection/v1": Object.freeze({
      schemaVersion: "route-selection/v1",
      fields: routeSelectionSchemaFields.route,
    }),
    "route-selection/v1#selected": Object.freeze({
      schemaVersion: "route-selection/v1",
      fields: routeSelectionSchemaFields.selected,
      closedValues: Object.freeze(["SELECTED"]),
    }),
    "route-selection/v1#refused": Object.freeze({
      schemaVersion: "route-selection/v1",
      fields: routeSelectionSchemaFields.refused,
      closedValues: Object.freeze(["REFUSED", "NO_SUPPORTED_HOST"]),
    }),
    "route-selection/v1#unknown": Object.freeze({
      schemaVersion: "route-selection/v1",
      fields: routeSelectionSchemaFields.refused,
      closedValues: Object.freeze(["UNKNOWN", ...routeUnknownReasons]),
    }),
    "route-selection/v1#no-worker": Object.freeze({
      schemaVersion: "route-selection/v1",
      fields: routeSelectionSchemaFields.noWorker,
      closedValues: Object.freeze(["NO_WORKER"]),
    }),
    "module-descriptor/v1": Object.freeze({
      schemaVersion: "module-descriptor/v1",
      fields: modulePlanSchemaFields.descriptor,
      closedValues: Object.freeze([
        "orchestration-module/v1",
        "module-plan-input/v1",
        "module-action-plan/v1",
        "module-no-action/v1",
      ]),
    }),
    "module-descriptor/v1#action": Object.freeze({
      schemaVersion: "module-descriptor/v1",
      fields: modulePlanSchemaFields.action,
      closedValues: dispatchRoles,
    }),
    "module-descriptor/v1#compatibility": Object.freeze({
      schemaVersion: "module-descriptor/v1",
      fields: modulePlanSchemaFields.compatibility,
    }),
    "module-descriptor/v1#dispatchCatalog": Object.freeze({
      schemaVersion: "module-descriptor/v1",
      fields: dispatchSchemaFields.catalog,
      closedValues: Object.freeze([...dispatchDirectiveKinds, ...dispatchPlanAccessors]),
    }),
    "module-plan-input/v1": Object.freeze({
      schemaVersion: "module-plan-input/v1",
      fields: modulePlanSchemaFields.input,
      closedValues: Object.freeze(["COMPLETE"]),
    }),
    "module-action-plan/v1": Object.freeze({
      schemaVersion: "module-action-plan/v1",
      fields: modulePlanSchemaFields.plan,
    }),
    "module-no-action/v1": Object.freeze({
      schemaVersion: "module-no-action/v1",
      fields: modulePlanSchemaFields.noAction,
      closedValues: Object.freeze([
        "NO_ACTION",
        "NO_ELIGIBLE_ACTION",
        "REFUSED",
        "INPUT_REFUSED",
        "PLANNING_FAILED",
      ]),
    }),
    "review-attempt-result/v1": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.attempt,
    }),
    "review-attempt-result/v1#result": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.result,
      closedValues: Object.freeze(reviewResultKinds.filter((kind) => kind !== "BLOCKED")),
    }),
    "review-attempt-result/v1#BLOCKED": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.blocked,
      closedValues: Object.freeze(["BLOCKED"]),
    }),
    "review-attempt-result/v1#finding": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.finding,
    }),
    "review-attempt-result/v1#disposition": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.disposition,
    }),
    "review-attempt-result/v1#finding-evidence": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewResultSchemaFields.findingEvidence,
    }),
    "review-attempt-result/v1#content": Object.freeze({
      schemaVersion: "review-attempt-result/v1",
      fields: reviewRequestSchemaFields.content,
    }),
    "review-authority/v1": Object.freeze({
      schemaVersion: "review-authority/v1",
      fields: reviewResultSchemaFields.authority,
    }),
    "review-authority/v1#decided": Object.freeze({
      schemaVersion: "review-authority/v1",
      fields: reviewResultSchemaFields.decided,
      closedValues: Object.freeze(["accepted", "rejected"]),
    }),
    "review-authority/v1#unknown": Object.freeze({
      schemaVersion: "review-authority/v1",
      fields: reviewResultSchemaFields.unknown,
      closedValues: Object.freeze(["unknown", ...reviewAuthorityUnknownReasons]),
    }),
    "review-authority/v1#content": Object.freeze({
      schemaVersion: "review-authority/v1",
      fields: reviewRequestSchemaFields.content,
    }),
    "review-request/v1": Object.freeze({
      schemaVersion: "review-request/v1",
      fields: reviewRequestSchemaFields.request,
    }),
    "review-request/v1#packet": Object.freeze({
      schemaVersion: "review-request/v1",
      fields: reviewRequestSchemaFields.packet,
    }),
    "review-request/v1#content": Object.freeze({
      schemaVersion: "review-request/v1",
      fields: reviewRequestSchemaFields.content,
    }),
    "worker-result-subject/v1": Object.freeze({
      schemaVersion: "worker-result-subject/v1",
      fields: reviewSubjectSchemaFields.worker,
    }),
    "worker-result-subject/v1#source": Object.freeze({
      schemaVersion: "worker-result-subject/v1",
      fields: reviewSubjectSchemaFields.source,
    }),
    "worker-result-subject/v1#TREE": Object.freeze({
      schemaVersion: "worker-result-subject/v1",
      fields: reviewSubjectSchemaFields.tree,
      closedValues: Object.freeze(["TREE"]),
    }),
    "worker-result-subject/v1#ORDERED_PATCH_ARTIFACTS": Object.freeze({
      schemaVersion: "worker-result-subject/v1",
      fields: reviewSubjectSchemaFields.ordered,
      closedValues: Object.freeze(["ORDERED_PATCH_ARTIFACTS"]),
    }),
    "worker-result-subject/v1#entry": Object.freeze({
      schemaVersion: "worker-result-subject/v1",
      fields: reviewSubjectSchemaFields.entry,
      closedValues: Object.freeze(["PATCH", "ARTIFACT"]),
    }),
    "release-candidate-subject/v1": Object.freeze({
      schemaVersion: "release-candidate-subject/v1",
      fields: reviewSubjectSchemaFields.candidate,
    }),
    "release-candidate-subject/v1#source": Object.freeze({
      schemaVersion: "release-candidate-subject/v1",
      fields: reviewSubjectSchemaFields.source,
    }),
    "session-acquire-request/v1": Object.freeze({
      schemaVersion: "session-acquire-request/v1",
      fields: cycleEntrySchemaFields.acquire,
    }),
    "cycle-request/v1": Object.freeze({
      schemaVersion: "cycle-request/v1",
      fields: cycleEntrySchemaFields.request,
    }),
    "cycle-plan/v1": Object.freeze({
      schemaVersion: "cycle-plan/v1",
      fields: cycleEntrySchemaFields.plan,
      closedValues: Object.freeze(["routine-cycle/v1"]),
    }),
    "session-receipt/v1": Object.freeze({
      schemaVersion: "session-receipt/v1",
      fields: cycleEntrySchemaFields.receipt,
      closedValues: Object.freeze([
        "ACQUIRE",
        "RENEW",
        "RELEASE",
        "ACQUIRED",
        "RENEWED",
        "RELEASED",
        "REFUSED",
        "UNKNOWN",
        "SESSION_HELD",
        "SESSION_STALE",
        "HANDOFF_PENDING",
        "CONFIGURATION_MISMATCH",
        "SESSION_NOT_FOUND",
        "SESSION_MISMATCH",
        "SESSION_RELEASED",
        "DURATION_EXCEEDED",
        "STATE_UNREADABLE",
        "IDENTITY_CONFLICT",
        "CLOCK_ROLLBACK",
        "CLOCK_SKEW",
        "MONOTONIC_UNAVAILABLE",
      ]),
    }),
    "session-health/v1": Object.freeze({
      schemaVersion: "session-health/v1",
      fields: cycleEntrySchemaFields.health,
      closedValues: Object.freeze([
        "AVAILABLE",
        "HELD_FRESH",
        "HELD_STALE",
        "HANDOFF_PREPARED",
        "RELEASED",
        "UNKNOWN",
        "HEALTHY",
        "REFUSED",
        "SESSION_NOT_FOUND",
        "SESSION_MISMATCH",
        "CONFIGURATION_MISMATCH",
        "FRESHNESS_EXPIRED",
        "DURATION_EXCEEDED",
        "HANDOFF_PENDING",
        "SESSION_RELEASED",
        "STATE_UNREADABLE",
        "IDENTITY_CONFLICT",
        "CLOCK_ROLLBACK",
        "CLOCK_SKEW",
        "MONOTONIC_UNAVAILABLE",
      ]),
    }),
    "session-health/v1#step": Object.freeze({
      schemaVersion: "session-health/v1",
      fields: routineStepSchemaFields.identity,
      closedValues: Object.freeze(["1", "session.verify"]),
    }),
    "routine-step-skip/v1": Object.freeze({
      schemaVersion: "routine-step-skip/v1",
      fields: routineStepSchemaFields.skip,
      closedValues: Object.freeze(Object.keys(routineStepSkipOrdinals)),
    }),
    // Inline vocabulary only: step identity is not a standalone schema family.
    "routine-step-skip/v1#step": Object.freeze({
      schemaVersion: "routine-step-skip/v1",
      fields: routineStepSchemaFields.identity,
      closedValues: Object.freeze([
        ...Object.keys(routineStepKinds),
        ...Object.values(routineStepKinds),
      ]),
    }),
    // ISS-013: one public family; decision rows are inline vocabulary, not a schema.
    "project-breaker-facts/v1#COMPLETE": Object.freeze({
      schemaVersion: "project-breaker-facts/v1",
      fields: projectBreakerFactsSchemaFields.complete,
      closedValues: Object.freeze(["COMPLETE"]),
    }),
    "project-breaker-facts/v1#UNAVAILABLE": Object.freeze({
      schemaVersion: "project-breaker-facts/v1",
      fields: projectBreakerFactsSchemaFields.failure,
      closedValues: Object.freeze(["UNAVAILABLE", "SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]),
    }),
    "project-breaker-facts/v1#UNKNOWN": Object.freeze({
      schemaVersion: "project-breaker-facts/v1",
      fields: projectBreakerFactsSchemaFields.failure,
      closedValues: Object.freeze([
        "UNKNOWN",
        "SOURCE_UNKNOWN",
        "MALFORMED_OBSERVATION",
        "CHANGED_BINDING",
        "CHANGED_SOURCE",
        "INCOMPLETE_CAPABILITIES",
      ]),
    }),
    "project-breaker-facts/v1#decision-row": Object.freeze({
      schemaVersion: "project-breaker-facts/v1",
      fields: projectBreakerFactsSchemaFields.decisionRow,
      closedValues: Object.freeze(["TRIP", "NO_TRIP"]),
    }),
    "adapter-configuration/v1": Object.freeze({
      schemaVersion: "adapter-configuration/v1",
      fields: projectSnapshotSchemaFields.configuration,
    }),
    "project-facts/v1#COMPLETE": Object.freeze({
      schemaVersion: "project-facts/v1",
      fields: projectSnapshotSchemaFields.complete,
      closedValues: Object.freeze(["COMPLETE"]),
    }),
    "project-facts/v1#UNAVAILABLE": Object.freeze({
      schemaVersion: "project-facts/v1",
      fields: projectSnapshotSchemaFields.failure,
      closedValues: Object.freeze(["UNAVAILABLE", "SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]),
    }),
    "project-facts/v1#UNKNOWN": Object.freeze({
      schemaVersion: "project-facts/v1",
      fields: projectSnapshotSchemaFields.failure,
      closedValues: Object.freeze([
        "UNKNOWN",
        "SOURCE_UNKNOWN",
        "MALFORMED_OBSERVATION",
        "INCOMPLETE_FRONTIER",
        "CHANGED_FRONTIER",
      ]),
    }),
    "project-facts/v1#frontier-row": Object.freeze({
      schemaVersion: "project-facts/v1",
      fields: projectSnapshotSchemaFields.frontierRow,
      closedValues: Object.freeze(["READY", "NOT_READY"]),
    }),
    "physical-destination-identity/v1": Object.freeze({
      schemaVersion: "physical-destination-identity/v1",
      fields: externalSchemaFields.physicalIdentity,
      closedValues: Object.freeze([
        "DARWIN",
        "LINUX",
        "WINDOWS",
        "EXISTING_DIRECTORY_ENTRY",
        "ABSENT_DIRECTORY_ENTRY",
      ]),
    }),
    "physical-destination-locator-observation-receipt/v1": Object.freeze({
      schemaVersion: "physical-destination-locator-observation-receipt/v1",
      fields: externalSchemaFields.locatorObservation,
      closedValues: Object.freeze([
        "CASE_INSENSITIVE_LOWERCASE",
        "CASE_SENSITIVE",
        "NFC",
        "NFD",
        "ADMITTED",
        "UNSUPPORTED",
        "UNKNOWN",
      ]),
    }),
    "external-destination-absence-observation/v1": Object.freeze({
      schemaVersion: "external-destination-absence-observation/v1",
      fields: externalSchemaFields.absenceObservation,
      closedValues: Object.freeze(["RUNTIME_AUTHORITY_ABSENT", "DESTINATION_STATE_ROOT_ABSENT"]),
    }),
    "state-mutation-destination-owner-value/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-value/v1",
      fields: destinationOwnerSchemaFields.value,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"]),
    }),
    "state-mutation-destination-owner-cas-proposal/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
      fields: destinationOwnerSchemaFields.proposal,
      closedValues: Object.freeze([
        "BOOTSTRAP_GENESIS",
        "ANCHOR_CONSUMED",
        "ANCHOR_RETIRED",
        "SUCCESSOR_REVIEW",
        "ACTIVATE_GENESIS",
        "CONSUME",
        "RETIRE_UNUSED",
        "RETIRE_CONSUMED",
        "ACTIVATE_SUCCESSOR",
      ]),
    }),
    "state-mutation-destination-owner-current-tip/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-current-tip/v1",
      fields: destinationOwnerSchemaFields.tip,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-conflict-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-conflict-receipt/v1",
      fields: destinationOwnerSchemaFields.conflict,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-teardown-archive/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-teardown-archive/v1",
      fields: destinationOwnerSchemaFields.archive,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-prior-installation/v1": Object.freeze({
      schemaVersion: "destination-owner-prior-installation/v1",
      fields: successorReviewSchemaFields.priorInstallation,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-successor-authority/v1": Object.freeze({
      schemaVersion: "destination-owner-successor-authority/v1",
      fields: successorReviewSchemaFields.successorAuthority,
      closedValues: Object.freeze([]),
    }),
    "destination-owner-independent-review/v1": Object.freeze({
      schemaVersion: "destination-owner-independent-review/v1",
      fields: successorReviewSchemaFields.independentReview,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-successor-review-core/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-successor-review-core/v1",
      fields: successorReviewSchemaFields.reviewCore,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-destination-owner-successor-review-post-selection-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
      fields: successorReviewSchemaFields.postSelection,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor/v1",
      fields: bootstrapAnchorSchemaFields.anchor,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-lifecycle-value/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
      fields: bootstrapAnchorSchemaFields.value,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"]),
    }),
    "state-mutation-bootstrap-anchor-cas-proposal/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
      fields: bootstrapAnchorSchemaFields.proposal,
      closedValues: Object.freeze([
        "BOOTSTRAP_CREATE",
        "E0_SELECTION",
        "TEARDOWN",
        "ACTIVATE",
        "CONSUME",
        "RETIRE_UNUSED",
        "RETIRE_CONSUMED",
      ]),
    }),
    "state-mutation-bootstrap-anchor-current-tip/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
      fields: bootstrapAnchorSchemaFields.tip,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-conflict-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-conflict-receipt/v1",
      fields: bootstrapAnchorSchemaFields.conflict,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-proposed-genesis-input/v1": Object.freeze({
      schemaVersion: "bootstrap-proposed-genesis-input/v1",
      fields: bootstrapUseIntentSchemaFields.proposedGenesis,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-reviewed-installer/v1": Object.freeze({
      schemaVersion: "bootstrap-reviewed-installer/v1",
      fields: bootstrapUseIntentSchemaFields.reviewedInstaller,
      closedValues: Object.freeze([]),
    }),
    "bootstrap-reviewed-helper/v1": Object.freeze({
      schemaVersion: "bootstrap-reviewed-helper/v1",
      fields: bootstrapUseIntentSchemaFields.reviewedHelper,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-use-intent/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-use-intent/v1",
      fields: bootstrapUseIntentSchemaFields.useIntent,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-lifecycle-archive/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
      fields: bootstrapAnchorTeardownSchemaFields.lifecycleArchive,
      closedValues: Object.freeze(["ACTIVE", "CONSUMED"]),
    }),
    "state-mutation-bootstrap-anchor-teardown-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-teardown-receipt/v1",
      fields: bootstrapAnchorTeardownSchemaFields.teardownReceipt,
      closedValues: Object.freeze(["RETIRE_UNUSED", "RETIRE_CONSUMED"]),
    }),
    "state-mutation-bootstrap-genesis-core/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-genesis-core/v1",
      fields: bootstrapGenesisSchemaFields.core,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-genesis-post-selection-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
      fields: bootstrapGenesisSchemaFields.post,
      closedValues: Object.freeze([]),
    }),
    "state-mutation-bootstrap-anchor-consumption-receipt/v1": Object.freeze({
      schemaVersion: "state-mutation-bootstrap-anchor-consumption-receipt/v1",
      fields: bootstrapConsumptionSchemaFields.receipt,
    }),
    "reviewed-authority-operation/v1#BOOTSTRAP_INSTALL": Object.freeze({
      schemaVersion: "reviewed-authority-operation/v1",
      fields: simplifiedAuthoritySchemaFields.reviewedAuthorityOperationBootstrap,
      closedValues: Object.freeze(["BOOTSTRAP_INSTALL"]),
    }),
    "reviewed-authority-operation/v1#STABLE_PROMOTION": Object.freeze({
      schemaVersion: "reviewed-authority-operation/v1",
      fields: simplifiedAuthoritySchemaFields.reviewedAuthorityOperationPromotion,
      closedValues: Object.freeze(["STABLE_PROMOTION"]),
    }),
    "state-mutation-successor-authority-core/v1": Object.freeze({
      schemaVersion: "state-mutation-successor-authority-core/v1",
      fields: simplifiedAuthoritySchemaFields.successorAuthorityCore,
      closedValues: Object.freeze(["BOOTSTRAP_INSTALL", "STABLE_PROMOTION"]),
    }),
    "authority-history-genesis-bootstrap-input/v1": Object.freeze({
      schemaVersion: "authority-history-genesis-bootstrap-input/v1",
      fields: simplifiedAuthoritySchemaFields.genesisBootstrapInput,
    }),
    "authority-history-binding/v1": Object.freeze({
      schemaVersion: "authority-history-binding/v1",
      fields: simplifiedAuthoritySchemaFields.authorityHistoryBinding,
      closedValues: Object.freeze(["GENESIS", "ROTATION", "GENESIS_LITERAL", "RECORD"]),
    }),
    "authority-history-genesis-selection-evidence/v1": Object.freeze({
      schemaVersion: "authority-history-genesis-selection-evidence/v1",
      fields: simplifiedAuthoritySchemaFields.genesisSelectionEvidence,
    }),
    "state-mutation-authority-rotation-id/v1": Object.freeze({
      schemaVersion: "state-mutation-authority-rotation-id/v1",
      fields: simplifiedAuthoritySchemaFields.rotationInput,
    }),
    "authority-history-record/v1#GENESIS": Object.freeze({
      schemaVersion: "authority-history-record/v1",
      fields: simplifiedAuthoritySchemaFields.historyGenesis,
      closedValues: Object.freeze(["GENESIS", "GENESIS_LITERAL"]),
    }),
    "authority-history-record/v1#ROTATION": Object.freeze({
      schemaVersion: "authority-history-record/v1",
      fields: simplifiedAuthoritySchemaFields.historyRotation,
      closedValues: Object.freeze(["ROTATION", "RECORD"]),
    }),
    "state-mutation-authority-value/v1": Object.freeze({
      schemaVersion: "state-mutation-authority-value/v1",
      fields: simplifiedAuthoritySchemaFields.selectedAuthorityValue,
    }),
    "pointer-mutation-run-checkpoint-core/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-checkpoint-core/v1",
      fields: commitSchemaFields.checkpointCore,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-commit-evidence/v1#ORDINARY": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceOrdinary,
      closedValues: Object.freeze([
        "ORDINARY",
        "KNOWN",
        "SELECTED",
        "LOST_CONFLICT",
        "UNKNOWN_TERMINAL",
        ...pointerKinds,
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#RESUMABLE": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationResumable,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "KNOWN",
        "RESUMABLE",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#SELECTED": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationSelected,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "KNOWN",
        "SELECTED",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-commit-evidence/v1#AUTHORITY_ROTATION#UNKNOWN": Object.freeze({
      schemaVersion: "pointer-mutation-commit-evidence/v1",
      fields: commitSchemaFields.commitEvidenceRotationUnknown,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "UNKNOWN",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-run-checkpoint-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-checkpoint-evidence/v1",
      fields: commitSchemaFields.checkpointEvidence,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-commit-resolution/v1": Object.freeze({
      schemaVersion: "pointer-mutation-commit-resolution/v1",
      fields: commitSchemaFields.commitResolution,
      closedValues: Object.freeze(["SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"]),
    }),
    "pointer-mutation-run-current-value/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-current-value/v1",
      fields: commitSchemaFields.runCurrentValue,
      closedValues: Object.freeze([...commitRunStages, ...commitRunPhases]),
    }),
    "pointer-mutation-run-intent/v1#ORDINARY": Object.freeze({
      schemaVersion: "pointer-mutation-run-intent/v1",
      fields: commitSchemaFields.runIntentOrdinary,
      closedValues: Object.freeze(["ORDINARY", "SINGLE_EPOCH", ...pointerKinds]),
    }),
    "pointer-mutation-run-intent/v1#AUTHORITY_ROTATION": Object.freeze({
      schemaVersion: "pointer-mutation-run-intent/v1",
      fields: commitSchemaFields.runIntentRotation,
      closedValues: Object.freeze([
        "AUTHORITY_ROTATION",
        "SINGLE_EPOCH",
        "STATE_MUTATION_AUTHORITY_ROTATION",
      ]),
    }),
    "pointer-mutation-run-segment/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-segment/v1",
      fields: commitSchemaFields.runSegment,
      closedValues: Object.freeze([...pointerKinds, ...commitRunStages]),
    }),
    "pointer-mutation-run-selector-post-selection-observation/v1": Object.freeze({
      schemaVersion: "pointer-mutation-run-selector-post-selection-observation/v1",
      fields: commitSchemaFields.postSelectionObservation,
    }),
    "pointer-cas-proposal-receipt/v1": Object.freeze({
      schemaVersion: "pointer-cas-proposal-receipt/v1",
      fields: pointerGraphSchemaFields.proposal,
      closedValues: Object.freeze([
        "VALUE_PROPOSED",
        "TOMBSTONE_PROPOSED",
        "SELECT",
        "REMOVE",
        "REVIEWED_BOOTSTRAP_GENESIS",
        "SELECTED_EPOCH",
      ]),
    }),
    "active-release/v1": Object.freeze({
      schemaVersion: "active-release/v1",
      fields: pointerGraphSchemaFields.activeRelease,
    }),
    "pointer-conflict-receipt/v1": Object.freeze({
      schemaVersion: "pointer-conflict-receipt/v1",
      fields: pointerGraphSchemaFields.conflict,
      closedValues: Object.freeze(["VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"]),
    }),
    "pointer-current-tip/v1": Object.freeze({
      schemaVersion: "pointer-current-tip/v1",
      fields: pointerGraphSchemaFields.currentTip,
    }),
    "pointer-tombstone-value/v1": Object.freeze({
      schemaVersion: "pointer-tombstone-value/v1",
      fields: pointerGraphSchemaFields.tombstone,
      closedValues: pointerKinds.filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION"),
    }),
    "recovery-authorization-core/v1#BOOTSTRAP": Object.freeze({
      schemaVersion: "recovery-authorization-core/v1",
      fields: recoveryAuthorizationCoreSchemaFields.bootstrap,
      closedValues: Object.freeze(["BOOTSTRAP"]),
    }),
    "recovery-authorization-core/v1#SUCCESSOR": Object.freeze({
      schemaVersion: "recovery-authorization-core/v1",
      fields: recoveryAuthorizationCoreSchemaFields.successor,
      closedValues: Object.freeze(["SUCCESSOR"]),
    }),
    "recovery-authorization-state/v1#CONSUMED": Object.freeze({
      schemaVersion: "recovery-authorization-state/v1",
      fields: recoveryAuthorizationStateSchemaFields.consumed,
      closedValues: Object.freeze(["CONSUMED"]),
    }),
    "recovery-authorization-state/v1#CREATED": Object.freeze({
      schemaVersion: "recovery-authorization-state/v1",
      fields: recoveryAuthorizationStateSchemaFields.created,
      closedValues: Object.freeze(["CREATED"]),
    }),
    "recovery-authorization-state/v1#REVOKED": Object.freeze({
      schemaVersion: "recovery-authorization-state/v1",
      fields: recoveryAuthorizationStateSchemaFields.revoked,
      closedValues: Object.freeze(["REVOKED"]),
    }),
    "native-consume-receipt/v1": Object.freeze({
      schemaVersion: "native-consume-receipt/v1",
      fields: recoveryAuthorizationNativeReceiptSchemaFields.consume,
    }),
    "native-removal-receipt/v1": Object.freeze({
      schemaVersion: "native-removal-receipt/v1",
      fields: recoveryAuthorizationNativeReceiptSchemaFields.removal,
      closedValues: Object.freeze(["ABSENT", "DISABLED"]),
    }),
    "recovery-authorization-consume-receipt/v1": Object.freeze({
      schemaVersion: "recovery-authorization-consume-receipt/v1",
      fields: recoveryAuthorizationPostSelectionReceiptSchemaFields.consume,
    }),
    "recovery-authorization-revoke-receipt/v1": Object.freeze({
      schemaVersion: "recovery-authorization-revoke-receipt/v1",
      fields: recoveryAuthorizationPostSelectionReceiptSchemaFields.revoke,
    }),
    "recovery-authorization-archive/v1": Object.freeze({
      schemaVersion: "recovery-authorization-archive/v1",
      fields: recoveryAuthorizationArchiveSchemaFields,
    }),
    "recovery-attempt-reservation/v1#CONSUMED": Object.freeze({
      schemaVersion: "recovery-attempt-reservation/v1",
      fields: recoveryAttemptReservationSchemaFields.consumed,
      closedValues: Object.freeze(["CONSUMED"]),
    }),
    "recovery-attempt-descriptor/v1": Object.freeze({
      schemaVersion: "recovery-attempt-descriptor/v1",
      fields: recoveryAttemptDescriptorSchemaFields,
      closedValues: Object.freeze(["LIVE"]),
    }),
    "attempt-log/v1#IN_PROGRESS": Object.freeze({
      schemaVersion: "attempt-log/v1",
      fields: recoveryAttemptLogSchemaFields.inProgress,
      closedValues: Object.freeze(["IN_PROGRESS"]),
    }),
    "attempt-log/v1#TERMINAL": Object.freeze({
      schemaVersion: "attempt-log/v1",
      fields: recoveryAttemptLogSchemaFields.terminal,
      closedValues: Object.freeze(["TERMINAL", ...recoveryAttemptTerminalDispositions]),
    }),
    "recovery-attempt-reservation/v1#RESERVED": Object.freeze({
      schemaVersion: "recovery-attempt-reservation/v1",
      fields: recoveryAttemptReservationSchemaFields.reserved,
      closedValues: Object.freeze(["RESERVED"]),
    }),
    "recovery-attempt-reservation/v1#TERMINAL": Object.freeze({
      schemaVersion: "recovery-attempt-reservation/v1",
      fields: recoveryAttemptReservationSchemaFields.terminal,
      closedValues: Object.freeze(["TERMINAL"]),
    }),
    "activation-cleanup-gate-root/v1": Object.freeze({
      schemaVersion: "activation-cleanup-gate-root/v1",
      fields: gateFenceSchemaFields.cleanupGateRoot,
      closedValues: Object.freeze(["BOOTSTRAP", "SUCCESSOR"]),
    }),
    "activation-cleanup-gate-head/v1": Object.freeze({
      schemaVersion: "activation-cleanup-gate-head/v1",
      fields: gateFenceSchemaFields.cleanupGateHead,
      closedValues: Object.freeze([
        "PENDING",
        "ACTIVATING",
        "ABORTING",
        "COMPLETE",
        "NOT_PUBLISHED",
        "PUBLISHING",
        "PUBLISHED",
        "CLEARED",
      ]),
    }),
    "activation-recovery-fence-root/v1": Object.freeze({
      schemaVersion: "activation-recovery-fence-root/v1",
      fields: gateFenceSchemaFields.recoveryFenceRoot,
    }),
    "activation-recovery-fence-head/v1": Object.freeze({
      schemaVersion: "activation-recovery-fence-head/v1",
      fields: gateFenceSchemaFields.recoveryFenceHead,
      closedValues: Object.freeze(["PREPARED", "POST_ACTIVATION"]),
    }),
    "dispatch-action-core/v1": Object.freeze({
      schemaVersion: "dispatch-action-core/v1",
      fields: dispatchSchemaFields.actionCore,
      closedValues: dispatchRoles,
    }),
    "dispatch-brief-action/v1": Object.freeze({
      schemaVersion: "dispatch-brief-action/v1",
      fields: dispatchSchemaFields.briefAction,
    }),
    "dispatch-brief-directive/v1": Object.freeze({
      schemaVersion: "dispatch-brief-directive/v1",
      fields: dispatchSchemaFields.directive,
      closedValues: Object.freeze([...dispatchDirectiveKinds, "PRESENT", "ABSENT"]),
    }),
    "dispatch-brief-resource/v1": Object.freeze({
      schemaVersion: "dispatch-brief-resource/v1",
      fields: dispatchSchemaFields.resource,
      closedValues: dispatchResourceAccess,
    }),
    "dispatch-brief/v1": Object.freeze({
      schemaVersion: "dispatch-brief/v1",
      fields: dispatchSchemaFields.brief,
      closedValues: dispatchRoles,
    }),
    "dispatch-catalog-entry/v1#nested": Object.freeze({
      schemaVersion: "dispatch-catalog-entry/v1",
      fields: dispatchSchemaFields.catalog,
      closedValues: Object.freeze([...dispatchDirectiveKinds, ...dispatchPlanAccessors]),
    }),
    "worker-host-identity/v1": Object.freeze({
      schemaVersion: "worker-host-identity/v1",
      fields: dispatchSchemaFields.hostIdentity,
    }),
    "worker-host-renderer-artifact/v1": Object.freeze({
      schemaVersion: "worker-host-renderer-artifact/v1",
      fields: dispatchSchemaFields.hostArtifact,
    }),
    "state-mutation-global-identity/v1": Object.freeze({
      schemaVersion: "state-mutation-global-identity/v1",
      fields: evidenceSchemaFields.globalIdentity,
    }),
    "pointer-mutation-unknown-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-unknown-evidence/v1",
      fields: evidenceSchemaFields.unknownEvidence,
      closedValues: Object.freeze([
        ...Object.keys(unknownEvidenceReasons),
        ...Object.values(unknownEvidenceReasons).flat(),
      ]),
    }),
    "pointer-mutation-conflict-evidence/v1": Object.freeze({
      schemaVersion: "pointer-mutation-conflict-evidence/v1",
      fields: evidenceSchemaFields.conflictEvidence,
    }),
    "pointer-evidence-slot/v1": Object.freeze({
      schemaVersion: "pointer-evidence-slot/v1",
      fields: evidenceSchemaFields.evidenceSlot,
      closedValues: pointerKinds,
    }),
    "pointer-evidence-packet/v1": Object.freeze({
      schemaVersion: "pointer-evidence-packet/v1",
      fields: packetSchemaFields.packet,
      closedValues: Object.freeze(["HISTORICAL_READ", "MUTATION_COMMIT", ...pointerKinds]),
    }),
    "platform-configuration-source/v1": Object.freeze({
      schemaVersion: "platform-configuration-source/v1",
      fields: configurationSchemaFields.source,
    }),
    "configuration-provenance/v1": Object.freeze({
      schemaVersion: "configuration-provenance/v1",
      fields: configurationSchemaFields.provenance,
      closedValues: Object.freeze(["CLI", "DEFAULT", "ENVIRONMENT", "PROJECT"]),
    }),
    "configuration-paths/v1": Object.freeze({
      schemaVersion: "configuration-paths/v1",
      fields: configurationSchemaFields.paths,
    }),
    "orchestration-command-result/v1": Object.freeze({
      schemaVersion: "orchestration-command-result/v1",
      fields: configurationSchemaFields.commandResult,
      closedValues: Object.freeze([
        ...orchestrationCommandCensus.map(({ command }) => command),
        "success",
        "invalid-input",
        "authority-refused",
        "operation-failed",
        "internal-error",
        "ARGV_REFUSED",
        "CONFIG_REFUSED",
        "PROJECT_ROOT_REFUSED",
        "PATH_REFUSED",
        "FILESYSTEM_OPERATION_FAILED",
        "CAPABILITY_NOT_IMPLEMENTED",
        "INTERNAL_ERROR",
        "authority-unknown",
        "external-unavailable",
        "ADAPTER_CONFIGURATION_REFUSED",
        "ADAPTER_BINDING_REFUSED",
        "ADAPTER_COMPATIBILITY_REFUSED",
        "PROJECT_SNAPSHOT_UNAVAILABLE",
        "PROJECT_SNAPSHOT_UNKNOWN",
      ]),
    }),
  });
export const schemaVersions = Object.freeze(
  [
    ...Object.keys(schemaDefinitions),
    ...configurationSchemaVersions,
    ...projectSnapshotSchemaVersions,
    ...projectBreakerFactsSchemaVersions,
    ...routineStepSkipSchemaVersions,
    ...cycleEntrySchemaVersions,
    ...reviewSubjectSchemaVersions,
    ...reviewRequestSchemaVersions,
    ...modulePlanSchemaVersions,
    ...routeSelectionSchemaVersions,
    ...projectPreflightSchemaVersions,
    ...reviewResultSchemaVersions,
    ...pointerGraphSchemaVersions,
    ...simplifiedAuthoritySchemaVersions,
    ...commitSchemaVersions,
    ...dispatchSchemaVersions,
    ...evidenceSchemaVersions,
    ...packetSchemaVersions,
    ...externalSchemaVersions,
    ...destinationOwnerSchemaVersions,
    ...successorReviewSchemaVersions,
    ...bootstrapAnchorSchemaVersions,
    ...bootstrapUseIntentSchemaVersions,
    ...bootstrapAnchorTeardownSchemaVersions,
    ...bootstrapGenesisSchemaVersions,
    ...bootstrapConsumptionSchemaVersions,
    ...gateFenceSchemaVersions,
    ...recoveryAuthorizationArchiveSchemaVersions,
    ...recoveryAuthorizationCoreSchemaVersions,
    ...recoveryAuthorizationNativeReceiptSchemaVersions,
    ...recoveryAuthorizationPostSelectionReceiptSchemaVersions,
    ...recoveryAuthorizationStateSchemaVersions,
    ...recoveryAttemptReservationSchemaVersions,
    ...recoveryAttemptDescriptorSchemaVersions,
    ...recoveryAttemptLogSchemaVersions,
  ].sort(),
);
export type CompatibilityDisposition = "readable" | "refused";
export function compatibilityDisposition(
  expectedSchemaVersion: string,
  observedSchemaVersion: string | null,
): CompatibilityDisposition {
  if (expectedSchemaVersion === "module-plan-result/v1")
    return observedSchemaVersion === "module-action-plan/v1" ||
      observedSchemaVersion === "module-no-action/v1"
      ? "readable"
      : "refused";
  if (expectedSchemaVersion === "review-subject/v1")
    return (reviewSubjectSchemaVersions as readonly (string | null)[]).includes(
      observedSchemaVersion,
    )
      ? "readable"
      : "refused";
  if (!schemaVersions.includes(expectedSchemaVersion)) return "refused";
  if (observedSchemaVersion === expectedSchemaVersion) return "readable";
  return "refused";
}

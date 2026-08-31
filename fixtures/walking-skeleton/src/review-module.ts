import {
  computeDispatchActionCoreDigest,
  computeDispositionInputDigest,
  computeModuleActionPlanDigest,
  computeModuleDescriptorDigest,
  computeModulePlanInputDigest,
  computeWorkerResultSubjectDigest,
  dispatchDirectiveKinds,
  parseActionDisposition,
  parseDispositionInput,
  parseModuleDescriptor,
  parseModulePlanInput,
  validateModulePlanBinding,
  type ActionDisposition,
  type DispositionInput,
  type ModulePlanInput,
  type ModulePlanResult,
} from "@orchestration-platform/contracts";
import { descriptor as observerDescriptor } from "./index.js";

const pair = { actionKind: "fixture.review", capabilityName: "work.read" };
const parsedDescriptor = parseModuleDescriptor({
  ...observerDescriptor,
  actions: [{ ...pair, requestedRole: "review", reviewRequired: false, workerRequired: true }],
  dispatchCatalog: observerDescriptor.dispatchCatalog.map((row) => ({ ...row, ...pair })),
  dispositionCodes: ["review.complete", "review.reject", "review.unknown"],
  moduleId: "fixture.review-consumer",
});
if (!parsedDescriptor.ok) throw new Error("fixture review descriptor refused");
export const descriptor = parsedDescriptor.value;

// This second fixed module remains pure. Seeded earlier history is input, never executed-history proof.
export async function plan(value: ModulePlanInput): Promise<ModulePlanResult> {
  const parsed = parseModulePlanInput(value);
  if (!parsed.ok) throw new Error("fixture review input refused");
  const input = parsed.value;
  const inputDigest = computeModulePlanInputDigest(input);
  const subject = input.reviewSubject;
  let result: unknown;
  if (
    computeModuleDescriptorDigest(input.descriptor) !== computeModuleDescriptorDigest(descriptor) ||
    subject?.schemaVersion !== "worker-result-subject/v1"
  ) {
    result = {
      inputDigest,
      outcome: "REFUSED",
      reason: "INPUT_REFUSED",
      schemaVersion: "module-no-action/v1",
    };
  } else {
    const core = {
      ...pair,
      immutableSubjectDigest: computeWorkerResultSubjectDigest(subject),
      moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
      requestedRole: "review",
      schemaVersion: "dispatch-action-core/v1",
    };
    result = {
      actionCore: core,
      inputDigest,
      schemaVersion: "module-action-plan/v1",
      workId: null,
      dispatchBrief: {
        action: {
          ...pair,
          actionCoreDigest: computeDispatchActionCoreDigest(core),
          immutableSubjectDigest: core.immutableSubjectDigest,
          moduleDescriptorDigest: core.moduleDescriptorDigest,
          schemaVersion: "dispatch-brief-action/v1",
        },
        directives: dispatchDirectiveKinds.map((directiveKind) => ({
          code: directiveKind === "OPERATOR_ACTION" ? null : directiveKind.toLowerCase(),
          directiveKind,
          presence: directiveKind === "OPERATOR_ACTION" ? "ABSENT" : "PRESENT",
          schemaVersion: "dispatch-brief-directive/v1",
          subjectDigest: core.immutableSubjectDigest,
        })),
        footprint: [
          {
            access: "READ",
            resourceIdentityDigest: core.immutableSubjectDigest,
            schemaVersion: "dispatch-brief-resource/v1",
          },
        ],
        role: "review",
        schemaVersion: "dispatch-brief/v1",
      },
    };
  }
  const bound = validateModulePlanBinding(input, result);
  if (!bound.ok) throw new Error("fixture review plan binding refused");
  return bound.value;
}

// The caller binds the actual captured bytes and journal step before admitting this phase.
// Returning COMPLETE here is a module decision, never proof of reclaim or final cycle completion.
export async function disposition(value: DispositionInput): Promise<ActionDisposition> {
  const parsed = parseDispositionInput(value);
  if (!parsed.ok) throw new Error("fixture disposition input refused");
  const input = parsed.value,
    subject = input.moduleInput.reviewSubject;
  if (
    computeModuleDescriptorDigest(input.moduleInput.descriptor) !==
      computeModuleDescriptorDigest(descriptor) ||
    subject?.schemaVersion !== "worker-result-subject/v1"
  )
    throw new Error("fixture disposition target refused");
  const kind = input.review?.authority.outcome.kind;
  const subjectDigest = computeWorkerResultSubjectDigest(subject);
  const result = parseActionDisposition({
    actionPlanDigest: computeModuleActionPlanDigest(input.actionPlan),
    code:
      kind === "accepted"
        ? "review.complete"
        : kind === "rejected"
          ? "review.reject"
          : "review.unknown",
    inputDigest: computeDispositionInputDigest(input),
    outcome:
      kind === "accepted"
        ? { kind: "COMPLETE" }
        : kind === "rejected"
          ? {
              kind: "FOLLOW_UP",
              followUp: {
                kind: "REPLAN",
                moduleId: descriptor.moduleId,
                subjectDigest,
                subjectKind: "WORKER_RESULT",
              },
            }
          : { kind: "UNKNOWN", reason: "AUTHORITY_UNPROVEN" },
    schemaVersion: "action-disposition/v1",
    subjectDigest,
    subjectKind: "WORKER_RESULT",
  });
  if (!result.ok) throw new Error("fixture disposition refused");
  return result.value;
}

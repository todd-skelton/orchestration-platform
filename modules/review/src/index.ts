import {
  canonicalJson,
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
} from "../../../packages/contracts/src/index.js";

const actionPair = Object.freeze({
  actionKind: "review.worker-result",
  capabilityName: "work.read",
});

function directiveCode(directiveKind: string): string {
  return `review.${directiveKind.toLowerCase().replaceAll("_", "-")}`;
}

const parsedDescriptor = parseModuleDescriptor({
  abi: "orchestration-module/v1",
  actions: [
    {
      ...actionPair,
      requestedRole: "review",
      reviewRequired: false,
      workerRequired: true,
    },
  ],
  compatibility: ["fixture.branches", "fixture.queue"].map((adapterId) => ({
    adapterId,
    adapterVersion: "1.0.0",
    engineVersion: "0.0.0",
    policyVersion: "1.0.0",
  })),
  dispatchCatalog: dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      ...actionPair,
      code: directiveCode(directiveKind),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: directiveCode(directiveKind),
    })),
  dispositionCodes: ["review.complete", "review.reject", "review.unknown"],
  inputSchemas: ["module-plan-input/v1"],
  moduleId: "review",
  moduleVersion: "0.0.0",
  outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
  schemaVersion: "module-descriptor/v1",
});
if (!parsedDescriptor.ok) throw new Error("review descriptor refused");
export const descriptor = parsedDescriptor.value;

function boundResult(input: ModulePlanInput, result: unknown): ModulePlanResult {
  const bound = validateModulePlanBinding(input, result);
  if (!bound.ok) throw new Error("review result binding refused");
  return bound.value;
}

export async function plan(value: ModulePlanInput): Promise<ModulePlanResult> {
  const parsed = parseModulePlanInput(value);
  if (!parsed.ok) throw new Error("review input refused");
  const input = parsed.value;
  const inputDigest = computeModulePlanInputDigest(input);
  const subject = input.reviewSubject;
  if (
    canonicalJson(input.descriptor) !== canonicalJson(descriptor) ||
    subject?.schemaVersion !== "worker-result-subject/v1"
  )
    return boundResult(input, {
      inputDigest,
      outcome: "REFUSED",
      reason: "INPUT_REFUSED",
      schemaVersion: "module-no-action/v1",
    });

  const core = {
    ...actionPair,
    immutableSubjectDigest: computeWorkerResultSubjectDigest(subject),
    moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
    requestedRole: "review",
    schemaVersion: "dispatch-action-core/v1",
  };
  return boundResult(input, {
    actionCore: core,
    dispatchBrief: {
      action: {
        ...actionPair,
        actionCoreDigest: computeDispatchActionCoreDigest(core),
        immutableSubjectDigest: core.immutableSubjectDigest,
        moduleDescriptorDigest: core.moduleDescriptorDigest,
        schemaVersion: "dispatch-brief-action/v1",
      },
      directives: dispatchDirectiveKinds.map((directiveKind) => ({
        code: directiveKind === "OPERATOR_ACTION" ? null : directiveCode(directiveKind),
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
    inputDigest,
    schemaVersion: "module-action-plan/v1",
    workId: null,
  });
}

export async function disposition(value: DispositionInput): Promise<ActionDisposition> {
  const parsed = parseDispositionInput(value);
  if (!parsed.ok) throw new Error("review disposition input refused");
  const input = parsed.value;
  const subject = input.moduleInput.reviewSubject;
  if (
    canonicalJson(input.moduleInput.descriptor) !== canonicalJson(descriptor) ||
    subject?.schemaVersion !== "worker-result-subject/v1"
  )
    throw new Error("review disposition target refused");

  const authority = input.review?.authority.outcome.kind;
  const subjectDigest = computeWorkerResultSubjectDigest(subject);
  const result = parseActionDisposition({
    actionPlanDigest: computeModuleActionPlanDigest(input.actionPlan),
    code:
      authority === "accepted"
        ? "review.complete"
        : authority === "rejected"
          ? "review.reject"
          : "review.unknown",
    inputDigest: computeDispositionInputDigest(input),
    outcome:
      authority === "accepted"
        ? { kind: "COMPLETE" }
        : authority === "rejected"
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
  if (!result.ok) throw new Error("review disposition refused");
  return result.value;
}

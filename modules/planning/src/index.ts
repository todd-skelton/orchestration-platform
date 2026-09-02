import {
  computeDispatchActionCoreDigest,
  computeModuleDescriptorDigest,
  computeModulePlanInputDigest,
  dispatchDirectiveKinds,
  parseDispatchActionCore,
  parseModuleDescriptor,
  parseModulePlanInput,
  validateModulePlanBinding,
  type ModulePlanInput,
  type ModulePlanResult,
} from "../../../packages/contracts/src/index.js";

const actionPair = Object.freeze({
  actionKind: "planning.implement",
  capabilityName: "work.read",
});

function directiveCode(directiveKind: string): string {
  return `planning.${directiveKind.toLowerCase().replaceAll("_", "-")}`;
}

function planningDescriptor() {
  const parsed = parseModuleDescriptor({
    abi: "orchestration-module/v1",
    actions: [
      {
        ...actionPair,
        requestedRole: "implementation",
        reviewRequired: true,
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
    dispositionCodes: [],
    inputSchemas: ["module-plan-input/v1"],
    moduleId: "planning",
    moduleVersion: "0.0.0",
    outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
    schemaVersion: "module-descriptor/v1",
  });
  if (!parsed.ok) throw new Error("planning descriptor refused");
  return parsed.value;
}

export const descriptor = planningDescriptor();

function boundResult(input: ModulePlanInput, value: unknown): ModulePlanResult {
  const result = validateModulePlanBinding(input, value);
  if (!result.ok) throw new Error("planning result binding refused");
  return result.value;
}

export async function plan(input: ModulePlanInput): Promise<ModulePlanResult> {
  const parsed = parseModulePlanInput(input);
  if (!parsed.ok) throw new Error("planning input refused");
  const retained = parsed.value;
  const inputDigest = computeModulePlanInputDigest(retained);
  if (
    computeModuleDescriptorDigest(retained.descriptor) !==
      computeModuleDescriptorDigest(descriptor) ||
    retained.reviewSubject !== null
  )
    return boundResult(retained, {
      inputDigest,
      outcome: "REFUSED",
      reason: "INPUT_REFUSED",
      schemaVersion: "module-no-action/v1",
    });

  const workRead = retained.policyFacts.decisions.find(
    (decision) => decision.capabilityName === actionPair.capabilityName,
  );
  const selected =
    workRead?.trip === "NO_TRIP"
      ? retained.projectFacts.frontier.find(
          (row) =>
            row.readiness === "READY" && row.capabilityNames.includes(actionPair.capabilityName),
        )
      : undefined;
  if (!selected)
    return boundResult(retained, {
      inputDigest,
      outcome: "NO_ACTION",
      reason: "NO_ELIGIBLE_ACTION",
      schemaVersion: "module-no-action/v1",
    });

  const parsedCore = parseDispatchActionCore({
    ...actionPair,
    immutableSubjectDigest: selected.immutableSubjectDigest,
    moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
    requestedRole: "implementation",
    schemaVersion: "dispatch-action-core/v1",
  });
  if (!parsedCore.ok) throw new Error("planning action core refused");
  const core = parsedCore.value;
  return boundResult(retained, {
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
      role: core.requestedRole,
      schemaVersion: "dispatch-brief/v1",
    },
    inputDigest,
    schemaVersion: "module-action-plan/v1",
    workId: selected.workId,
  });
}

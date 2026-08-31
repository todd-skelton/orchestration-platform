import {
  computeDispatchActionCoreDigest,
  computeModuleDescriptorDigest,
  computeModulePlanInputDigest,
  dispatchDirectiveKinds,
  parseDispatchActionCore,
  parseModuleDescriptor,
  parseModulePlanInput,
  validateModulePlanBinding,
} from "@orchestration-platform/contracts";

export const actionPair = Object.freeze({
  actionKind: "fixture.inspect",
  capabilityName: "work.read",
});
function fixtureDescriptor() {
  const parsed = parseModuleDescriptor({
    abi: "orchestration-module/v1",
    actions: [
      { ...actionPair, requestedRole: "observer", reviewRequired: false, workerRequired: true },
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
        code: directiveKind.toLowerCase(),
        directiveKind,
        planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
        templateId: `fixture.${directiveKind.toLowerCase()}`,
      })),
    dispositionCodes: [],
    inputSchemas: ["module-plan-input/v1"],
    moduleId: "fixture.contract-consumer",
    moduleVersion: "1.0.0",
    outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
    schemaVersion: "module-descriptor/v1",
  });
  if (!parsed.ok) throw new Error("fixture descriptor refused");
  return parsed.value;
}
// Public structural descriptor only; this is not installed registry admission.
export const descriptor = fixtureDescriptor();

// This quarantined observer call produces records, never executes a worker or clears a hold.
export async function plan(input: unknown) {
  const parsed = parseModulePlanInput(input);
  if (!parsed.ok) return parsed;
  const retained = parsed.value;
  if (
    computeModuleDescriptorDigest(retained.descriptor) !==
      computeModuleDescriptorDigest(descriptor) ||
    retained.reviewSubject !== null
  )
    return { ok: false as const, issues: ["fixture:input-binding"] };
  const inputDigest = computeModulePlanInputDigest(retained);
  const selected = retained.projectFacts.frontier.find(
    (row) => row.readiness === "READY" && row.capabilityNames.includes(actionPair.capabilityName),
  );
  if (!selected)
    return validateModulePlanBinding(retained, {
      inputDigest,
      outcome: "NO_ACTION",
      reason: "NO_ELIGIBLE_ACTION",
      schemaVersion: "module-no-action/v1",
    });
  const parsedCore = parseDispatchActionCore({
    ...actionPair,
    immutableSubjectDigest: selected.immutableSubjectDigest,
    moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
    requestedRole: "observer",
    schemaVersion: "dispatch-action-core/v1",
  });
  if (!parsedCore.ok) return parsedCore;
  const core = parsedCore.value;
  return validateModulePlanBinding(retained, {
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
      role: core.requestedRole,
      schemaVersion: "dispatch-brief/v1",
    },
    inputDigest,
    schemaVersion: "module-action-plan/v1",
    workId: selected.workId,
  });
}

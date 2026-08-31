import {
  canonicalDigest,
  computeDispatchActionCoreDigest,
  dispatchDirectiveKinds,
  parseContract,
  validateDispatchBriefBinding,
} from "@orchestration-platform/contracts";

// Fixture descriptor only: not a module-descriptor/v1 or registry admission.
export const descriptor = Object.freeze({
  abi: "orchestration-module/v1",
  moduleId: "fixture.contract-consumer",
  actionKind: "fixture.inspect",
  capabilityName: "fixture.read",
  inputSchema: "dispatch-action-core/v1",
  outputSchema: "dispatch-brief/v1",
});

// The descriptor/async-plan shape exercises composition, not the full module ABI.
export async function plan(input: unknown) {
  const parsed = parseContract(descriptor.inputSchema, input);
  if (!parsed.ok) return parsed;
  const core = parsed.value;
  if (
    core.moduleDescriptorDigest !== canonicalDigest(descriptor) ||
    core.actionKind !== descriptor.actionKind ||
    core.capabilityName !== descriptor.capabilityName ||
    core.requestedRole !== "observer"
  )
    return { ok: false as const, issues: ["fixture:input-binding"] };
  const pair = {
    actionKind: descriptor.actionKind,
    capabilityName: descriptor.capabilityName,
  };
  const catalog = dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      ...pair,
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `fixture.${directiveKind.toLowerCase()}`,
    }));
  const brief = {
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
    role: core.requestedRole,
    schemaVersion: descriptor.outputSchema,
  };
  const issues = validateDispatchBriefBinding(brief, core, catalog, [pair]);
  return issues.length
    ? { ok: false as const, issues }
    : parseContract(descriptor.outputSchema, brief);
}

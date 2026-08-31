import { parseCycleRequest, type CycleRequest } from "./cycle-entry.js";
import {
  computeDispatchActionCoreDigest,
  dispatchRoles,
  parseDispatchActionCore,
  parseDispatchBrief,
  validateDispatchBriefBinding,
  validateDispatchCatalog,
} from "./dispatch.js";
import {
  parseProjectBreakerFacts,
  validateProjectBreakerFactsBinding,
  type ProjectBreakerFacts,
} from "./project-breaker-facts.js";
import {
  validateAdapterConfigurationBinding,
  validateProjectFactsBinding,
  type AdapterConfiguration,
  type ProjectFacts,
} from "./project-snapshot.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseReviewSubject,
  type ReviewSubject,
} from "./review-subject.js";
import {
  canonicalDigest,
  frame,
  framedDigest,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";
import { engineVocabularyValueFindings } from "./vocabulary.js";

export const modulePlanSchemaVersions = Object.freeze([
  "module-descriptor/v1",
  "module-plan-input/v1",
  "module-action-plan/v1",
  "module-no-action/v1",
] as const);
export const modulePlanSchemaFields = Object.freeze({
  descriptor: Object.freeze([
    "abi",
    "actions",
    "compatibility",
    "dispatchCatalog",
    "dispositionCodes",
    "inputSchemas",
    "moduleId",
    "moduleVersion",
    "outputSchemas",
    "schemaVersion",
  ] as const),
  action: Object.freeze([
    "actionKind",
    "capabilityName",
    "requestedRole",
    "reviewRequired",
    "workerRequired",
  ] as const),
  compatibility: Object.freeze([
    "adapterId",
    "adapterVersion",
    "engineVersion",
    "policyVersion",
  ] as const),
  input: Object.freeze([
    "adapterConfiguration",
    "configurationProvenance",
    "cycleRequest",
    "descriptor",
    "policyFacts",
    "projectFacts",
    "reviewSubject",
    "schemaVersion",
  ] as const),
  plan: Object.freeze([
    "actionCore",
    "dispatchBrief",
    "inputDigest",
    "schemaVersion",
    "workId",
  ] as const),
  noAction: Object.freeze(["inputDigest", "outcome", "reason", "schemaVersion"] as const),
});
export type ModuleActionDeclaration = Readonly<{
  actionKind: string;
  capabilityName: string;
}> &
  (
    | Readonly<{
        requestedRole: "implementation" | "observer";
        reviewRequired: boolean;
        workerRequired: true;
      }>
    | Readonly<{ requestedRole: "review"; reviewRequired: false; workerRequired: true }>
    | Readonly<{ requestedRole: "observer"; reviewRequired: false; workerRequired: false }>
  );
export type ModuleCompatibility = Readonly<{
  adapterId: string;
  adapterVersion: string;
  engineVersion: string;
  policyVersion: string;
}>;
export type ModuleDescriptor = Readonly<{
  abi: "orchestration-module/v1";
  actions: readonly ModuleActionDeclaration[];
  compatibility: readonly ModuleCompatibility[];
  dispatchCatalog: readonly ContractRecord[];
  dispositionCodes: readonly string[];
  inputSchemas: readonly ["module-plan-input/v1"];
  moduleId: string;
  moduleVersion: string;
  outputSchemas: readonly ["module-action-plan/v1", "module-no-action/v1"];
  schemaVersion: "module-descriptor/v1";
}>;
export type ModulePlanInput = Readonly<{
  adapterConfiguration: AdapterConfiguration;
  configurationProvenance: ContractRecord;
  cycleRequest: CycleRequest;
  descriptor: ModuleDescriptor;
  policyFacts: Extract<ProjectBreakerFacts, { state: "COMPLETE" }>;
  projectFacts: Extract<ProjectFacts, { state: "COMPLETE" }>;
  reviewSubject: ReviewSubject | null;
  schemaVersion: "module-plan-input/v1";
}>;
export type ModuleActionPlan = Readonly<{
  actionCore: ContractRecord;
  dispatchBrief: ContractRecord | null;
  inputDigest: string;
  schemaVersion: "module-action-plan/v1";
  workId: string | null;
}>;
export type ModuleNoAction = Readonly<{
  inputDigest: string;
  schemaVersion: "module-no-action/v1";
}> &
  (
    | Readonly<{ outcome: "NO_ACTION"; reason: "NO_ELIGIBLE_ACTION" }>
    | Readonly<{ outcome: "REFUSED"; reason: "INPUT_REFUSED" | "PLANNING_FAILED" }>
  );
export type ModulePlanResult = ModuleActionPlan | ModuleNoAction;

const idPattern = /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/;
const namePattern = /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;
const id = (value: unknown): value is string => typeof value === "string" && idPattern.test(value);
const name = (value: unknown): value is string =>
  typeof value === "string" && namePattern.test(value);
const version = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 63 && versionPattern.test(value);
const digest = (value: JsonValue | undefined): boolean => isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined): boolean => isUuidV7(value) && value.length === 36;
const prefixed = (prefix: string, issues: readonly string[]): string[] =>
  issues.map((issue) => `${prefix}.${issue}`);
function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
function exactStrings(value: JsonValue | undefined, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, i) => entry === expected[i])
  );
}
function workerPairs(actions: readonly ModuleActionDeclaration[]): readonly ContractRecord[] {
  return actions
    .filter((action) => action.workerRequired)
    .map(({ actionKind, capabilityName }) => ({ actionKind, capabilityName }));
}

/** Descriptor structure is not installed source, policy or module-admission authority. */
export function parseModuleDescriptor(input: unknown): ParseResult<ModuleDescriptor> {
  const parsed = snapshotClosedRecord(input, modulePlanSchemaFields.descriptor);
  if (!parsed.ok) return parsed;
  const record = parsed.value,
    issues: string[] = [];
  if (record.schemaVersion !== "module-descriptor/v1") issues.push("schemaVersion:mismatch");
  if (record.abi !== "orchestration-module/v1") issues.push("abi:invalid");
  if (!id(record.moduleId)) issues.push("moduleId:invalid");
  else issues.push(...engineVocabularyValueFindings([record.moduleId]));
  if (!version(record.moduleVersion)) issues.push("moduleVersion:invalid");
  if (!exactStrings(record.inputSchemas, ["module-plan-input/v1"]))
    issues.push("inputSchemas:invalid");
  if (!exactStrings(record.outputSchemas, ["module-action-plan/v1", "module-no-action/v1"]))
    issues.push("outputSchemas:invalid");
  const actions: ModuleActionDeclaration[] = [];
  if (!Array.isArray(record.actions) || record.actions.length < 1 || record.actions.length > 256)
    issues.push("actions:length-refused");
  else {
    let previous: string | undefined;
    for (const [index, entry] of record.actions.entries()) {
      const action = snapshotClosedRecord(entry, modulePlanSchemaFields.action);
      if (!action.ok) {
        issues.push(...prefixed(`actions.${index}`, action.issues));
        continue;
      }
      const row = action.value;
      for (const field of ["actionKind", "capabilityName"] as const)
        if (!name(row[field])) issues.push(`actions.${index}.${field}:invalid`);
        else issues.push(...engineVocabularyValueFindings([row[field]]));
      if (!(dispatchRoles as readonly JsonValue[]).includes(row.requestedRole!))
        issues.push(`actions.${index}.requestedRole:invalid`);
      if (
        typeof row.workerRequired !== "boolean" ||
        typeof row.reviewRequired !== "boolean" ||
        (row.workerRequired === false &&
          (row.requestedRole !== "observer" || row.reviewRequired !== false)) ||
        (row.requestedRole === "review" && row.reviewRequired !== false)
      )
        issues.push(`actions.${index}:role-worker-review-mismatch`);
      if (name(row.actionKind) && name(row.capabilityName)) {
        const key = `${row.actionKind}\0${row.capabilityName}`;
        if (previous !== undefined && previous >= key) issues.push("actions:order-refused");
        previous = key;
      }
      actions.push(row as ModuleActionDeclaration);
    }
  }
  if (
    !Array.isArray(record.compatibility) ||
    record.compatibility.length < 1 ||
    record.compatibility.length > 256
  )
    issues.push("compatibility:length-refused");
  else {
    let previous: string | undefined;
    for (const [index, entry] of record.compatibility.entries()) {
      const compatible = snapshotClosedRecord(entry, modulePlanSchemaFields.compatibility);
      if (!compatible.ok) {
        issues.push(...prefixed(`compatibility.${index}`, compatible.issues));
        continue;
      }
      const row = compatible.value;
      if (!id(row.adapterId)) issues.push(`compatibility.${index}.adapterId:invalid`);
      for (const field of ["adapterVersion", "engineVersion", "policyVersion"] as const)
        if (!version(row[field])) issues.push(`compatibility.${index}.${field}:invalid`);
      if (
        id(row.adapterId) &&
        version(row.adapterVersion) &&
        version(row.engineVersion) &&
        version(row.policyVersion)
      ) {
        const key = [row.adapterId, row.adapterVersion, row.engineVersion, row.policyVersion].join(
          "\0",
        );
        if (previous !== undefined && previous >= key) issues.push("compatibility:order-refused");
        previous = key;
      }
    }
  }
  if (!Array.isArray(record.dispositionCodes) || record.dispositionCodes.length > 256)
    issues.push("dispositionCodes:length-refused");
  else {
    let previous: string | undefined;
    for (const code of record.dispositionCodes) {
      if (!name(code)) issues.push("dispositionCodes:invalid");
      else {
        issues.push(...engineVocabularyValueFindings([code]));
        if (previous !== undefined && previous >= code)
          issues.push("dispositionCodes:order-refused");
        previous = code;
      }
    }
  }
  issues.push(...validateDispatchCatalog(record.dispatchCatalog, workerPairs(actions)));
  return issues.length ? invalid(...issues) : { ok: true, value: record as ModuleDescriptor };
}

/** Actual supplied observations only: TRIP/NO_TRIP are preserved, never execution permission. */
export function parseModulePlanInput(input: unknown): ParseResult<ModulePlanInput> {
  const parsed = snapshotClosedRecord(input, modulePlanSchemaFields.input);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  if (record.schemaVersion !== "module-plan-input/v1") return invalid("schemaVersion:mismatch");
  const descriptor = parseModuleDescriptor(record.descriptor);
  if (!descriptor.ok) return invalid(...prefixed("descriptor", descriptor.issues));
  const configuration = validateAdapterConfigurationBinding(
    record.adapterConfiguration,
    record.configurationProvenance,
  );
  if (!configuration.ok) return invalid(...prefixed("adapterConfiguration", configuration.issues));
  const facts = validateProjectFactsBinding(record.projectFacts, configuration.value);
  if (!facts.ok) return invalid(...prefixed("projectFacts", facts.issues));
  if (facts.value.state !== "COMPLETE") return invalid("projectFacts:complete-required");
  const policy = parseProjectBreakerFacts(record.policyFacts);
  if (!policy.ok) return invalid(...prefixed("policyFacts", policy.issues));
  if (policy.value.state !== "COMPLETE") return invalid("policyFacts:complete-required");
  const compatibility = descriptor.value.compatibility.find(
    (row) =>
      row.adapterId === configuration.value.adapterId &&
      row.adapterVersion === configuration.value.adapterVersion &&
      row.engineVersion === configuration.value.engineVersion &&
      row.policyVersion === policy.value.policyVersion,
  );
  if (!compatibility) return invalid("descriptor.compatibility:mismatch");
  const policyBinding = validateProjectBreakerFactsBinding(
    policy.value,
    configuration.value,
    facts.value,
    compatibility.policyVersion,
  );
  if (!policyBinding.ok) return invalid(...prefixed("policyFacts", policyBinding.issues));
  const cycle = parseCycleRequest(record.cycleRequest);
  if (!cycle.ok) return invalid(...prefixed("cycleRequest", cycle.issues));
  const subject = record.reviewSubject === null ? null : parseReviewSubject(record.reviewSubject);
  if (subject && !subject.ok) return invalid(...prefixed("reviewSubject", subject.issues));
  const issues: string[] = [];
  if (cycle.value.adapterId !== configuration.value.adapterId)
    issues.push("cycleRequest.adapterId:mismatch");
  if (
    cycle.value.sessionRequest.configurationProvenanceDigest !==
    canonicalDigest(record.configurationProvenance!)
  )
    issues.push("cycleRequest.sessionRequest.configurationProvenanceDigest:mismatch");
  if (!cycle.value.allowedModuleIds.includes(descriptor.value.moduleId))
    issues.push("cycleRequest.allowedModuleIds:module-not-allowed");
  if (
    descriptor.value.actions.some(
      (action) => !configuration.value.capabilityNames.includes(action.capabilityName),
    )
  )
    issues.push("descriptor.actions:capability-not-configured");
  if (
    subject?.ok &&
    cycle.value.cycleId ===
      (subject.value.schemaVersion === "worker-result-subject/v1"
        ? subject.value.authorCycleId
        : subject.value.assemblyCycleId)
  )
    issues.push("reviewSubject:same-cycle");
  return issues.length ? invalid(...issues) : { ok: true, value: record as ModulePlanInput };
}

/** Intrinsic plan structure only; descriptor catalog and supplied target join below. */
export function parseModuleActionPlan(input: unknown): ParseResult<ModuleActionPlan> {
  const parsed = snapshotClosedRecord(input, modulePlanSchemaFields.plan);
  if (!parsed.ok) return parsed;
  const record = parsed.value,
    issues: string[] = [];
  if (record.schemaVersion !== "module-action-plan/v1") issues.push("schemaVersion:mismatch");
  if (!digest(record.inputDigest)) issues.push("inputDigest:invalid");
  if (record.workId !== null && !uuid(record.workId)) issues.push("workId:invalid");
  const core = parseDispatchActionCore(record.actionCore);
  if (!core.ok) issues.push(...prefixed("actionCore", core.issues));
  if (record.dispatchBrief === null) {
    if (core.ok && core.value.requestedRole !== "observer")
      issues.push("dispatchBrief:null-role-mismatch");
  } else {
    const brief = parseDispatchBrief(record.dispatchBrief);
    if (!brief.ok) issues.push(...prefixed("dispatchBrief", brief.issues));
    if (brief.ok && core.ok) {
      const action = brief.value.action as ContractRecord;
      for (const field of [
        "actionKind",
        "capabilityName",
        "immutableSubjectDigest",
        "moduleDescriptorDigest",
      ])
        if (action[field] !== core.value[field])
          issues.push(`dispatchBrief.action.${field}:mismatch`);
      if (action.actionCoreDigest !== computeDispatchActionCoreDigest(core.value))
        issues.push("dispatchBrief.action.actionCoreDigest:mismatch");
      if (brief.value.role !== core.value.requestedRole) issues.push("dispatchBrief.role:mismatch");
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ModuleActionPlan };
}
export function parseModuleNoAction(input: unknown): ParseResult<ModuleNoAction> {
  const parsed = snapshotClosedRecord(input, modulePlanSchemaFields.noAction);
  if (!parsed.ok) return parsed;
  const record = parsed.value,
    issues: string[] = [];
  if (record.schemaVersion !== "module-no-action/v1") issues.push("schemaVersion:mismatch");
  if (!digest(record.inputDigest)) issues.push("inputDigest:invalid");
  if (
    !(record.outcome === "NO_ACTION" && record.reason === "NO_ELIGIBLE_ACTION") &&
    !(
      record.outcome === "REFUSED" &&
      (record.reason === "INPUT_REFUSED" || record.reason === "PLANNING_FAILED")
    )
  )
    issues.push("outcome:reason-mismatch");
  return issues.length ? invalid(...issues) : { ok: true, value: record as ModuleNoAction };
}
export function parseModulePlanResult(input: unknown): ParseResult<ModulePlanResult> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return invalid("record:object-required");
  const record = value as ContractRecord;
  if (record.schemaVersion === "module-action-plan/v1") return parseModuleActionPlan(record);
  if (record.schemaVersion === "module-no-action/v1") return parseModuleNoAction(record);
  return invalid("schemaVersion:unsupported");
}
function identity(input: unknown, schema: string, parser: (input: unknown) => ParseResult): string {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(schema, [frame.canonical(parsed.value)]);
}
export const computeModuleDescriptorDigest = (input: unknown): string =>
  identity(input, "module-descriptor/v1", parseModuleDescriptor);
export const computeModulePlanInputDigest = (input: unknown): string =>
  identity(input, "module-plan-input/v1", parseModulePlanInput);
export const computeModuleActionPlanDigest = (input: unknown): string =>
  identity(input, "module-action-plan/v1", parseModuleActionPlan);
export const computeModuleNoActionDigest = (input: unknown): string =>
  identity(input, "module-no-action/v1", parseModuleNoAction);

/** Exact supplied joins only; no planning execution, breaker, registry, history or mutation authority. */
export function validateModulePlanBinding(
  inputValue: unknown,
  resultValue: unknown,
): ParseResult<ModulePlanResult> {
  const input = parseModulePlanInput(inputValue),
    result = parseModulePlanResult(resultValue);
  if (!input.ok) return invalid(...prefixed("input", input.issues));
  if (!result.ok) return invalid(...prefixed("result", result.issues));
  const issues: string[] = [];
  if (result.value.inputDigest !== computeModulePlanInputDigest(input.value))
    issues.push("result.inputDigest:mismatch");
  if (result.value.schemaVersion === "module-action-plan/v1") {
    const { actionCore: core, dispatchBrief: brief, workId } = result.value;
    const {
      descriptor,
      adapterConfiguration: configuration,
      projectFacts: facts,
      reviewSubject: subject,
    } = input.value;
    if (core.moduleDescriptorDigest !== computeModuleDescriptorDigest(descriptor))
      issues.push("result.actionCore.moduleDescriptorDigest:mismatch");
    const action = descriptor.actions.find(
      (row) => row.actionKind === core.actionKind && row.capabilityName === core.capabilityName,
    );
    if (!action) issues.push("result.actionCore:undeclared-pair");
    else {
      if (action.requestedRole !== core.requestedRole)
        issues.push("result.actionCore.requestedRole:mismatch");
      if (action.workerRequired) {
        if (brief === null) issues.push("result.dispatchBrief:required");
        else
          issues.push(
            ...validateDispatchBriefBinding(
              brief,
              core,
              descriptor.dispatchCatalog,
              workerPairs(descriptor.actions),
            ),
          );
      } else if (
        brief !== null ||
        core.requestedRole !== "observer" ||
        action.reviewRequired !== false
      )
        issues.push("result:workerless-mismatch");
    }
    if (!configuration.capabilityNames.includes(core.capabilityName as string))
      issues.push("result.actionCore.capabilityName:not-configured");
    if (subject === null) {
      if (core.requestedRole === "review") issues.push("result:review-subject-required");
      const work = facts.frontier.find((row) => row.workId === workId);
      if (workId === null || !work) issues.push("result.workId:missing-frontier-row");
      else {
        if (work.readiness !== "READY") issues.push("result.workId:not-ready");
        if (!work.capabilityNames.includes(core.capabilityName as string))
          issues.push("result.actionCore.capabilityName:not-in-work");
        if (core.immutableSubjectDigest !== work.immutableSubjectDigest)
          issues.push("result.actionCore.immutableSubjectDigest:work-mismatch");
      }
    } else {
      if (workId !== null) issues.push("result.workId:review-requires-null");
      if (core.requestedRole !== "review" || action?.workerRequired !== true)
        issues.push("result:review-role-worker-mismatch");
      const subjectDigest =
        subject.schemaVersion === "worker-result-subject/v1"
          ? computeWorkerResultSubjectDigest(subject)
          : computeReleaseCandidateSubjectDigest(subject);
      if (core.immutableSubjectDigest !== subjectDigest)
        issues.push("result.actionCore.immutableSubjectDigest:review-mismatch");
    }
  }
  return issues.length ? invalid(...issues) : result;
}
export function parseModulePlanContract(schema: string, input: unknown): ParseResult | null {
  if (schema === "module-descriptor/v1") return parseModuleDescriptor(input);
  if (schema === "module-plan-input/v1") return parseModulePlanInput(input);
  if (schema === "module-action-plan/v1") return parseModuleActionPlan(input);
  if (schema === "module-no-action/v1") return parseModuleNoAction(input);
  return schema === "module-plan-result/v1" ? parseModulePlanResult(input) : null;
}

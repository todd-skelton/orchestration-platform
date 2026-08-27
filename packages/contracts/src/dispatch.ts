import { engineVocabularyValueFindings } from "./vocabulary.js";
import {
  frame,
  framedDigest,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
  type SnapshotResult,
} from "./runtime.js";

export const dispatchRoles = Object.freeze(["implementation", "review", "observer"] as const);
export const dispatchDirectiveKinds = Object.freeze([
  "ACCEPTANCE_EVIDENCE",
  "CONSTRAINT",
  "DECISION",
  "NON_GOAL",
  "OPERATOR_ACTION",
  "REVIEW_ATTACK",
  "SCOPE_EXCLUDE",
  "SCOPE_INCLUDE",
  "VERIFICATION",
] as const);
export const dispatchPlanAccessors = Object.freeze([
  "IMMUTABLE_SUBJECT_DIGEST",
  "MODULE_DESCRIPTOR_DIGEST",
  "REQUESTED_ROLE",
] as const);
export const dispatchResourceAccess = Object.freeze([
  "READ",
  "CREATE",
  "MODIFY",
  "DELETE",
] as const);

const actionCoreFields = Object.freeze([
  "actionKind",
  "capabilityName",
  "immutableSubjectDigest",
  "moduleDescriptorDigest",
  "requestedRole",
  "schemaVersion",
] as const);
const briefActionFields = Object.freeze([
  "actionCoreDigest",
  "actionKind",
  "capabilityName",
  "immutableSubjectDigest",
  "moduleDescriptorDigest",
  "schemaVersion",
] as const);
const directiveFields = Object.freeze([
  "code",
  "directiveKind",
  "presence",
  "schemaVersion",
  "subjectDigest",
] as const);
const resourceFields = Object.freeze([
  "access",
  "resourceIdentityDigest",
  "schemaVersion",
] as const);
const briefFields = Object.freeze([
  "action",
  "directives",
  "footprint",
  "role",
  "schemaVersion",
] as const);
const catalogFields = Object.freeze([
  "actionKind",
  "capabilityName",
  "code",
  "directiveKind",
  "planAccessor",
  "templateId",
] as const);
const actionCapabilityPairFields = Object.freeze(["actionKind", "capabilityName"] as const);
const hostIdentityFields = Object.freeze([
  "capabilityNames",
  "hostRendererArtifactDigest",
  "schemaVersion",
] as const);
const hostArtifactFields = Object.freeze([
  "capabilityNames",
  "hostRendererArtifactDigest",
  "schemaVersion",
  "workerHostIdentityDigest",
] as const);

export const dispatchSchemaFields = Object.freeze({
  actionCore: actionCoreFields,
  brief: briefFields,
  briefAction: briefActionFields,
  catalog: catalogFields,
  directive: directiveFields,
  hostArtifact: hostArtifactFields,
  hostIdentity: hostIdentityFields,
  resource: resourceFields,
});
export const dispatchSchemaVersions = Object.freeze([
  "dispatch-action-core/v1",
  "dispatch-brief-action/v1",
  "dispatch-brief-directive/v1",
  "dispatch-brief-resource/v1",
  "dispatch-brief/v1",
  "worker-host-identity/v1",
  "worker-host-renderer-artifact/v1",
] as const);

const identifierPattern = /^[a-z][a-z0-9._:-]{0,63}$/;

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function arrayInvalid<T>(...issues: readonly string[]): SnapshotResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
  schemaVersion: string,
): ParseResult {
  const record = snapshotClosedRecord(input, fields);
  if (!record.ok) return record;
  return record.value.schemaVersion === schemaVersion ? record : invalid("schemaVersion:mismatch");
}

function prefixed(prefix: string, issues: readonly string[]): readonly string[] {
  return issues.map((issue) => `${prefix}:${issue}`);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function identifierIssues(values: readonly unknown[], prefix: string): readonly string[] {
  const issues: string[] = [];
  for (const [index, value] of values.entries()) {
    if (!isIdentifier(value)) issues.push(`${prefix}:${index}:invalid`);
  }
  issues.push(
    ...engineVocabularyValueFindings(
      values.filter((value): value is string => typeof value === "string"),
    ),
  );
  return issues;
}

function parseCapabilityNames(input: unknown): SnapshotResult<readonly string[]> {
  const array = snapshotClosedArray(input);
  if (!array.ok) return arrayInvalid(...array.issues);
  if (array.value.length < 1 || array.value.length > 256)
    return arrayInvalid("capabilityNames:length");
  const issues = [...identifierIssues(array.value, "capabilityNames")];
  for (let index = 1; index < array.value.length; index += 1) {
    if (String(array.value[index - 1]) >= String(array.value[index]))
      issues.push(`capabilityNames:${index}:order`);
  }
  return issues.length === 0
    ? { ok: true, value: Object.freeze(array.value.map(String)) }
    : arrayInvalid(...issues);
}

export function parseDispatchActionCore(input: unknown): ParseResult {
  const parsed = exactRecord(input, actionCoreFields, "dispatch-action-core/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [...identifierIssues([record.actionKind, record.capabilityName], "actionCore")];
  if (!isSha256(record.immutableSubjectDigest)) issues.push("immutableSubjectDigest:invalid");
  if (!isSha256(record.moduleDescriptorDigest)) issues.push("moduleDescriptorDigest:invalid");
  if (!dispatchRoles.includes(record.requestedRole as (typeof dispatchRoles)[number]))
    issues.push("requestedRole:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeDispatchActionCoreDigest(input: unknown): string {
  const parsed = parseDispatchActionCore(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("dispatch-action-core/v1", [
    frame.text(String(record.schemaVersion)),
    frame.text(String(record.actionKind)),
    frame.text(String(record.capabilityName)),
    frame.raw32(String(record.immutableSubjectDigest)),
    frame.raw32(String(record.moduleDescriptorDigest)),
    frame.text(String(record.requestedRole)),
  ]);
}

export function parseDispatchBriefAction(input: unknown): ParseResult {
  const parsed = exactRecord(input, briefActionFields, "dispatch-brief-action/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [...identifierIssues([record.actionKind, record.capabilityName], "briefAction")];
  for (const field of [
    "actionCoreDigest",
    "immutableSubjectDigest",
    "moduleDescriptorDigest",
  ] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDispatchBriefDirective(input: unknown): ParseResult {
  const parsed = exactRecord(input, directiveFields, "dispatch-brief-directive/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (
    !dispatchDirectiveKinds.includes(
      record.directiveKind as (typeof dispatchDirectiveKinds)[number],
    )
  )
    issues.push("directiveKind:invalid");
  if (record.presence !== "PRESENT" && record.presence !== "ABSENT")
    issues.push("presence:invalid");
  if (!isSha256(record.subjectDigest)) issues.push("subjectDigest:invalid");
  if (record.presence === "PRESENT") {
    issues.push(...identifierIssues([record.code], "code"));
  } else if (record.code !== null || record.directiveKind !== "OPERATOR_ACTION") {
    issues.push("absence:invalid");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDispatchBriefResource(input: unknown): ParseResult {
  const parsed = exactRecord(input, resourceFields, "dispatch-brief-resource/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (!dispatchResourceAccess.includes(record.access as (typeof dispatchResourceAccess)[number]))
    issues.push("access:invalid");
  if (!isSha256(record.resourceIdentityDigest)) issues.push("resourceIdentityDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDispatchBrief(input: unknown): ParseResult {
  const parsed = exactRecord(input, briefFields, "dispatch-brief/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  const action = parseDispatchBriefAction(record.action);
  if (!action.ok) issues.push(...prefixed("action", action.issues));
  if (!dispatchRoles.includes(record.role as (typeof dispatchRoles)[number]))
    issues.push("role:invalid");

  const directives = snapshotClosedArray(record.directives);
  const parsedDirectives: ContractRecord[] = [];
  if (!directives.ok) issues.push(...prefixed("directives", directives.issues));
  else if (directives.value.length < 1 || directives.value.length > 256)
    issues.push("directives:length");
  else
    directives.value.forEach((value, index) => {
      const directive = parseDispatchBriefDirective(value);
      if (!directive.ok) issues.push(...prefixed(`directives:${index}`, directive.issues));
      else parsedDirectives.push(directive.value);
    });

  const footprint = snapshotClosedArray(record.footprint);
  const parsedResources: ContractRecord[] = [];
  if (!footprint.ok) issues.push(...prefixed("footprint", footprint.issues));
  else if (footprint.value.length > 256) issues.push("footprint:length");
  else
    footprint.value.forEach((value, index) => {
      const resource = parseDispatchBriefResource(value);
      if (!resource.ok) issues.push(...prefixed(`footprint:${index}`, resource.issues));
      else parsedResources.push(resource.value);
    });

  if (action.ok) {
    for (const [index, directive] of parsedDirectives.entries())
      if (directive.subjectDigest !== action.value.immutableSubjectDigest)
        issues.push(`directives:${index}:subjectDigest:mismatch`);
  }
  const directiveKeys = new Set<string>();
  for (const directive of parsedDirectives) {
    if (directive.presence === "PRESENT") {
      const key = `${String(directive.directiveKind)}\0${String(directive.code)}`;
      if (directiveKeys.has(key)) issues.push("directives:duplicate");
      directiveKeys.add(key);
    }
  }
  for (const kind of dispatchDirectiveKinds.filter((kind) => kind !== "OPERATOR_ACTION")) {
    if (!parsedDirectives.some((row) => row.directiveKind === kind && row.presence === "PRESENT"))
      issues.push(`directives:${kind}:missing`);
  }
  const operatorPresent = parsedDirectives.filter(
    (row) => row.directiveKind === "OPERATOR_ACTION" && row.presence === "PRESENT",
  ).length;
  const operatorAbsent = parsedDirectives.filter(
    (row) => row.directiveKind === "OPERATOR_ACTION" && row.presence === "ABSENT",
  ).length;
  if (!(
    (operatorPresent >= 1 && operatorAbsent === 0) ||
    (operatorPresent === 0 && operatorAbsent === 1)
  ))
    issues.push("directives:OPERATOR_ACTION:xor");

  const resourceKeys = new Set<string>();
  for (const resource of parsedResources) {
    const key = `${String(resource.access)}\0${String(resource.resourceIdentityDigest)}`;
    if (resourceKeys.has(key)) issues.push("footprint:duplicate");
    resourceKeys.add(key);
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parseCatalogEntry(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, catalogFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [
    ...identifierIssues(
      [record.actionKind, record.capabilityName, record.code, record.templateId],
      "catalog",
    ),
  ];
  if (
    !dispatchDirectiveKinds.includes(
      record.directiveKind as (typeof dispatchDirectiveKinds)[number],
    )
  )
    issues.push("directiveKind:invalid");
  if (
    !dispatchPlanAccessors.includes(record.planAccessor as (typeof dispatchPlanAccessors)[number])
  )
    issues.push("planAccessor:invalid");
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

function pairKey(record: ContractRecord): string {
  return `${String(record.actionKind)}\0${String(record.capabilityName)}`;
}

export function validateDispatchCatalog(
  input: unknown,
  declaredActionCapabilityPairs: unknown,
): readonly string[] {
  const issues: string[] = [];
  const catalog = snapshotClosedArray(input);
  const entries: ContractRecord[] = [];
  if (!catalog.ok) issues.push(...prefixed("catalog", catalog.issues));
  else if (catalog.value.length < 1 || catalog.value.length > 256) issues.push("catalog:length");
  else
    catalog.value.forEach((value, index) => {
      const entry = parseCatalogEntry(value);
      if (!entry.ok) issues.push(...prefixed(`catalog:${index}`, entry.issues));
      else entries.push(entry.value);
    });
  const resolverKeys = new Set<string>();
  for (const entry of entries) {
    const key = `${pairKey(entry)}\0${String(entry.directiveKind)}\0${String(entry.code)}`;
    if (resolverKeys.has(key)) issues.push("catalog:resolver-key:duplicate");
    resolverKeys.add(key);
  }

  const declared = snapshotClosedArray(declaredActionCapabilityPairs);
  const declaredRows: ContractRecord[] = [];
  if (!declared.ok) issues.push(...prefixed("declaredPairs", declared.issues));
  else
    declared.value.forEach((value, index) => {
      const row = snapshotClosedRecord(value, actionCapabilityPairFields);
      if (!row.ok) issues.push(...prefixed(`declaredPairs:${index}`, row.issues));
      else {
        const rowIssues = identifierIssues(
          [row.value.actionKind, row.value.capabilityName],
          "pair",
        );
        if (rowIssues.length) issues.push(...prefixed(`declaredPairs:${index}`, rowIssues));
        else declaredRows.push(row.value);
      }
    });
  const declaredKeys = declaredRows.map(pairKey);
  if (new Set(declaredKeys).size !== declaredKeys.length) issues.push("declaredPairs:duplicate");
  const catalogPairs = new Set(entries.map(pairKey));
  if (
    catalogPairs.size !== new Set(declaredKeys).size ||
    [...catalogPairs].some((key) => !declaredKeys.includes(key))
  )
    issues.push("declaredPairs:mismatch");
  return Object.freeze([...new Set(issues)].sort());
}

export function validateDispatchBriefBinding(
  briefInput: unknown,
  actionCoreInput: unknown,
  catalogInput: unknown,
  declaredActionCapabilityPairs: unknown,
): readonly string[] {
  const issues = [...validateDispatchCatalog(catalogInput, declaredActionCapabilityPairs)];
  const brief = parseDispatchBrief(briefInput);
  const core = parseDispatchActionCore(actionCoreInput);
  if (!brief.ok) issues.push(...prefixed("brief", brief.issues));
  if (!core.ok) issues.push(...prefixed("actionCore", core.issues));
  if (!brief.ok || !core.ok) return Object.freeze([...new Set(issues)].sort());
  const action = brief.value.action as ContractRecord;
  for (const field of [
    "actionKind",
    "capabilityName",
    "immutableSubjectDigest",
    "moduleDescriptorDigest",
  ])
    if (action[field] !== core.value[field]) issues.push(`binding:${field}`);
  if (action.actionCoreDigest !== computeDispatchActionCoreDigest(core.value))
    issues.push("binding:actionCoreDigest");
  if (brief.value.role !== core.value.requestedRole) issues.push("binding:role");

  const catalog = snapshotClosedArray(catalogInput);
  const catalogRows = catalog.ok
    ? catalog.value.map((value) => snapshotClosedRecord(value, catalogFields))
    : [];
  for (const directive of brief.value.directives as readonly ContractRecord[]) {
    if (directive.presence !== "PRESENT") continue;
    const matches = catalogRows.filter(
      (row) =>
        row.ok &&
        row.value.actionKind === action.actionKind &&
        row.value.capabilityName === action.capabilityName &&
        row.value.directiveKind === directive.directiveKind &&
        row.value.code === directive.code,
    );
    if (matches.length !== 1) issues.push("binding:catalog");
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function parseWorkerHostIdentity(input: unknown): ParseResult {
  const parsed = exactRecord(input, hostIdentityFields, "worker-host-identity/v1");
  if (!parsed.ok) return parsed;
  const capabilities = parseCapabilityNames(parsed.value.capabilityNames);
  const issues = capabilities.ok ? [] : [...capabilities.issues];
  if (!isSha256(parsed.value.hostRendererArtifactDigest))
    issues.push("hostRendererArtifactDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeWorkerHostIdentityDigest(input: unknown): string {
  const parsed = parseWorkerHostIdentity(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("worker-host-identity/v1", [
    frame.text(String(parsed.value.schemaVersion)),
    frame.raw32(String(parsed.value.hostRendererArtifactDigest)),
    frame.canonical(parsed.value.capabilityNames!),
  ]);
}

export function parseWorkerHostRendererArtifact(input: unknown): ParseResult {
  const parsed = exactRecord(input, hostArtifactFields, "worker-host-renderer-artifact/v1");
  if (!parsed.ok) return parsed;
  const capabilities = parseCapabilityNames(parsed.value.capabilityNames);
  const issues = capabilities.ok ? [] : [...capabilities.issues];
  if (!isSha256(parsed.value.hostRendererArtifactDigest))
    issues.push("hostRendererArtifactDigest:invalid");
  if (!isSha256(parsed.value.workerHostIdentityDigest))
    issues.push("workerHostIdentityDigest:invalid");
  if (issues.length === 0) {
    const identity = {
      capabilityNames: parsed.value.capabilityNames,
      hostRendererArtifactDigest: parsed.value.hostRendererArtifactDigest,
      schemaVersion: "worker-host-identity/v1",
    };
    if (parsed.value.workerHostIdentityDigest !== computeWorkerHostIdentityDigest(identity))
      issues.push("workerHostIdentityDigest:mismatch");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseWorkerHostRendererArtifacts(
  input: unknown,
): SnapshotResult<readonly ContractRecord[]> {
  const array = snapshotClosedArray(input);
  if (!array.ok) return arrayInvalid(...array.issues);
  if (array.value.length < 1 || array.value.length > 16) return arrayInvalid("mapping:length");
  const issues: string[] = [];
  const rows: ContractRecord[] = [];
  array.value.forEach((value, index) => {
    const parsed = parseWorkerHostRendererArtifact(value);
    if (!parsed.ok) issues.push(...prefixed(`mapping:${index}`, parsed.issues));
    else rows.push(parsed.value);
  });
  const keys = rows.map((row) => String(row.workerHostIdentityDigest));
  if (new Set(keys).size !== keys.length) issues.push("mapping:identity:duplicate");
  return issues.length === 0 ? { ok: true, value: Object.freeze(rows) } : arrayInvalid(...issues);
}

export function selectWorkerHostForCapability(
  mappingInput: unknown,
  workerHostIdentityDigest: unknown,
  capabilityName: unknown,
): ParseResult {
  const mapping = parseWorkerHostRendererArtifacts(mappingInput);
  if (!mapping.ok) return invalid(...mapping.issues);
  const issues: string[] = [];
  if (!isSha256(workerHostIdentityDigest as never)) issues.push("workerHostIdentityDigest:invalid");
  if (!isIdentifier(capabilityName)) issues.push("capabilityName:invalid");
  else issues.push(...engineVocabularyValueFindings([capabilityName]));
  if (issues.length) return invalid(...issues);
  const rows = mapping.value.filter(
    (row) => row.workerHostIdentityDigest === workerHostIdentityDigest,
  );
  if (rows.length !== 1) return invalid("workerHostIdentityDigest:not-admitted");
  const capabilities = rows[0]!.capabilityNames as readonly string[];
  return capabilities.includes(String(capabilityName))
    ? { ok: true, value: rows[0]! }
    : invalid("capabilityName:not-admitted");
}

export function parseDispatchContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | null {
  switch (expectedSchemaVersion) {
    case "dispatch-action-core/v1":
      return parseDispatchActionCore(input);
    case "dispatch-brief-action/v1":
      return parseDispatchBriefAction(input);
    case "dispatch-brief-directive/v1":
      return parseDispatchBriefDirective(input);
    case "dispatch-brief-resource/v1":
      return parseDispatchBriefResource(input);
    case "dispatch-brief/v1":
      return parseDispatchBrief(input);
    case "worker-host-identity/v1":
      return parseWorkerHostIdentity(input);
    case "worker-host-renderer-artifact/v1":
      return parseWorkerHostRendererArtifact(input);
    default:
      return null;
  }
}

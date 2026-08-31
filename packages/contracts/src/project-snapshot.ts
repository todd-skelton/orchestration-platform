import { parseConfigurationProvenance } from "./configuration.js";
import {
  canonicalDigest,
  closedArray,
  closedRecord,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const projectSnapshotSchemaVersions = Object.freeze([
  "adapter-configuration/v1",
  "project-facts/v1",
] as const);
const configurationFields = Object.freeze([
  "adapterId",
  "adapterVersion",
  "capabilityNames",
  "engineVersion",
  "projectId",
  "schemaVersion",
] as const);
const commonFields = [
  "adapterConfigurationDigest",
  "observationId",
  "observedAt",
  "projectId",
  "schemaVersion",
  "state",
] as const;
export const projectSnapshotSchemaFields = Object.freeze({
  configuration: configurationFields,
  complete: Object.freeze([...commonFields, "frontier", "frontierDigest"].sort()),
  failure: Object.freeze([...commonFields, "reason"].sort()),
  frontierRow: Object.freeze([
    "capabilityNames",
    "immutableSubjectDigest",
    "readiness",
    "workId",
  ] as const),
});

export type AdapterConfiguration = Readonly<{
  adapterId: string;
  adapterVersion: string;
  capabilityNames: readonly string[];
  engineVersion: string;
  projectId: string;
  schemaVersion: "adapter-configuration/v1";
}>;
export type ProjectFrontierRow = Readonly<{
  capabilityNames: readonly string[];
  immutableSubjectDigest: string;
  readiness: "READY" | "NOT_READY";
  workId: string;
}>;
type ProjectFactsCommon = Readonly<{
  adapterConfigurationDigest: string;
  observationId: string;
  observedAt: string;
  projectId: string;
  schemaVersion: "project-facts/v1";
}>;
export type ProjectFacts = ProjectFactsCommon &
  (
    | Readonly<{
        state: "COMPLETE";
        frontier: readonly ProjectFrontierRow[];
        frontierDigest: string;
      }>
    | Readonly<{ state: "UNAVAILABLE"; reason: "SOURCE_UNAVAILABLE" | "OBSERVATION_TIMEOUT" }>
    | Readonly<{
        state: "UNKNOWN";
        reason:
          "SOURCE_UNKNOWN" | "MALFORMED_OBSERVATION" | "INCOMPLETE_FRONTIER" | "CHANGED_FRONTIER";
      }>
  );

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

// The final lookahead requires the actual end, including for trailing line terminators.
const namePattern = /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/;
const adapterIdPattern = /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;
const uuid = (value: JsonValue | undefined): boolean => isUuidV7(value) && value.length === 36;
const digest = (value: JsonValue | undefined): boolean => isSha256(value) && value.length === 64;

function nameIssues(value: JsonValue, prefix: string): readonly string[] {
  const issues = [...closedArray(value, 256, prefix)];
  if (!Array.isArray(value)) return issues;
  if (value.some((name) => typeof name !== "string" || !namePattern.test(name)))
    issues.push(`${prefix}:invalid-name`);
  if (
    value.some(
      (name, index) =>
        index > 0 &&
        typeof name === "string" &&
        typeof value[index - 1] === "string" &&
        value[index - 1]! >= name,
    )
  )
    issues.push(`${prefix}:not-sorted-unique`);
  return issues;
}

export function parseAdapterConfiguration(input: unknown): ParseResult<AdapterConfiguration> {
  const parsed = snapshotClosedRecord(input, configurationFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = [...nameIssues(record.capabilityNames!, "capabilityNames")];
  if (record.schemaVersion !== "adapter-configuration/v1") issues.push("schemaVersion:mismatch");
  if (typeof record.adapterId !== "string" || !adapterIdPattern.test(record.adapterId))
    issues.push("adapterId:invalid");
  for (const field of ["adapterVersion", "engineVersion"] as const)
    if (
      typeof record[field] !== "string" ||
      record[field].length > 63 ||
      !versionPattern.test(record[field])
    )
      issues.push(`${field}:invalid`);
  if (!uuid(record.projectId)) issues.push("projectId:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as AdapterConfiguration };
}

function frontierIssues(value: JsonValue): readonly string[] {
  const issues = [...closedArray(value, 4096, "frontier")];
  if (!Array.isArray(value)) return issues;
  let priorWorkId: string | undefined;
  for (const [index, input] of value.entries()) {
    const prefix = `frontier.${index}`;
    const shape = closedRecord(input, projectSnapshotSchemaFields.frontierRow, prefix);
    if (shape.length) {
      issues.push(...shape);
      continue;
    }
    const row = input as ContractRecord;
    issues.push(...nameIssues(row.capabilityNames!, `${prefix}.capabilityNames`));
    if (!uuid(row.workId)) issues.push(`${prefix}.workId:invalid`);
    if (!digest(row.immutableSubjectDigest))
      issues.push(`${prefix}.immutableSubjectDigest:invalid`);
    if (row.readiness !== "READY" && row.readiness !== "NOT_READY")
      issues.push(`${prefix}.readiness:invalid`);
    if (typeof row.workId === "string") {
      if (priorWorkId !== undefined && priorWorkId >= row.workId)
        issues.push("frontier:not-sorted-unique");
      priorWorkId = row.workId;
    }
  }
  return issues;
}

/** Structural content only: success does not establish fresh source provenance. */
export function parseProjectFacts(input: unknown): ParseResult<ProjectFacts> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return invalid("record:object-required");
  const record = snapshot.value as ContractRecord;
  if (record.state !== "COMPLETE" && record.state !== "UNAVAILABLE" && record.state !== "UNKNOWN")
    return invalid("state:invalid");
  const issues = [
    ...closedRecord(
      record,
      record.state === "COMPLETE"
        ? projectSnapshotSchemaFields.complete
        : projectSnapshotSchemaFields.failure,
    ),
  ];
  if (issues.length) return invalid(...issues);
  if (record.schemaVersion !== "project-facts/v1") issues.push("schemaVersion:mismatch");
  if (!digest(record.adapterConfigurationDigest)) issues.push("adapterConfigurationDigest:invalid");
  for (const field of ["observationId", "projectId"] as const)
    if (!uuid(record[field])) issues.push(`${field}:invalid`);
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  if (record.state === "COMPLETE") {
    issues.push(...frontierIssues(record.frontier!));
    if (!digest(record.frontierDigest)) issues.push("frontierDigest:invalid");
    if (!issues.length && canonicalDigest(record.frontier!) !== record.frontierDigest)
      issues.push("frontierDigest:mismatch");
  } else {
    const reasons =
      record.state === "UNAVAILABLE"
        ? ["SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]
        : ["SOURCE_UNKNOWN", "MALFORMED_OBSERVATION", "INCOMPLETE_FRONTIER", "CHANGED_FRONTIER"];
    if (typeof record.reason !== "string" || !reasons.includes(record.reason))
      issues.push("reason:invalid");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ProjectFacts };
}

/** Compares supplied records only; the caller must obtain successful loaded provenance. */
export function validateAdapterConfigurationBinding(
  configurationInput: unknown,
  provenanceInput: unknown,
): ParseResult<AdapterConfiguration> {
  const configuration = parseAdapterConfiguration(configurationInput);
  if (!configuration.ok) return configuration;
  let provenance: ParseResult;
  try {
    provenance = parseConfigurationProvenance(provenanceInput);
  } catch {
    return invalid("provenance:unreadable");
  }
  if (!provenance.ok) return invalid(...provenance.issues.map((issue) => `provenance.${issue}`));
  const issues: string[] = [];
  for (const field of ["adapterId", "projectId"] as const)
    if (configuration.value[field] !== provenance.value[field])
      issues.push(`${field}:binding-mismatch`);
  const names = provenance.value.capabilityNames as readonly string[];
  if (
    configuration.value.capabilityNames.length !== names.length ||
    configuration.value.capabilityNames.some((name, index) => name !== names[index])
  )
    issues.push("capabilityNames:binding-mismatch");
  return issues.length ? invalid(...issues) : configuration;
}

/** Recomputes configuration identity and checks row subsets, without observation authority. */
export function validateProjectFactsBinding(
  factsInput: unknown,
  configurationInput: unknown,
): ParseResult<ProjectFacts> {
  const facts = parseProjectFacts(factsInput);
  if (!facts.ok) return facts;
  const configuration = parseAdapterConfiguration(configurationInput);
  if (!configuration.ok)
    return invalid(...configuration.issues.map((issue) => `configuration.${issue}`));
  const issues: string[] = [];
  if (facts.value.adapterConfigurationDigest !== canonicalDigest(configuration.value))
    issues.push("adapterConfigurationDigest:binding-mismatch");
  if (facts.value.projectId !== configuration.value.projectId)
    issues.push("projectId:binding-mismatch");
  if (facts.value.state === "COMPLETE") {
    const names = new Set(configuration.value.capabilityNames);
    for (const [index, row] of facts.value.frontier.entries())
      if (row.capabilityNames.some((name) => !names.has(name)))
        issues.push(`frontier.${index}.capabilityNames:not-subset`);
  }
  return issues.length ? invalid(...issues) : facts;
}

export function parseProjectSnapshotContract(schema: string, input: unknown): ParseResult | null {
  if (schema === "adapter-configuration/v1") return parseAdapterConfiguration(input);
  if (schema === "project-facts/v1") return parseProjectFacts(input);
  return null;
}

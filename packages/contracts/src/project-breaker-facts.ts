import { parseAdapterConfiguration, validateProjectFactsBinding } from "./project-snapshot.js";
import {
  canonicalDigest,
  closedArray,
  closedRecord,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

// ISS-013: current policy/trip content only; no recovery or execution authority.
export const projectBreakerFactsSchemaVersions = Object.freeze([
  "project-breaker-facts/v1",
] as const);
const commonFields = [
  "adapterConfigurationDigest",
  "observationId",
  "observedAt",
  "policyVersion",
  "projectFactsDigest",
  "projectId",
  "schemaVersion",
  "state",
] as const;
export const projectBreakerFactsSchemaFields = Object.freeze({
  complete: Object.freeze([...commonFields, "decisions"].sort()),
  failure: Object.freeze([...commonFields, "reason"].sort()),
  decisionRow: Object.freeze(["capabilityName", "trip"] as const),
});

export type ProjectBreakerDecision = Readonly<{
  capabilityName: string;
  trip: "TRIP" | "NO_TRIP";
}>;
type ProjectBreakerFactsCommon = Readonly<{
  adapterConfigurationDigest: string;
  observationId: string;
  observedAt: string;
  policyVersion: string;
  projectFactsDigest: string;
  projectId: string;
  schemaVersion: "project-breaker-facts/v1";
}>;
export type ProjectBreakerFacts = ProjectBreakerFactsCommon &
  (
    | Readonly<{ state: "COMPLETE"; decisions: readonly ProjectBreakerDecision[] }>
    | Readonly<{ state: "UNAVAILABLE"; reason: "SOURCE_UNAVAILABLE" | "OBSERVATION_TIMEOUT" }>
    | Readonly<{
        state: "UNKNOWN";
        reason:
          | "SOURCE_UNKNOWN"
          | "MALFORMED_OBSERVATION"
          | "CHANGED_BINDING"
          | "CHANGED_SOURCE"
          | "INCOMPLETE_CAPABILITIES";
      }>
  );

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

// Identical Name/Version bounds to the snapshot ledger, including actual string end.
const namePattern = /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;
const version = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 63 && versionPattern.test(value);

function decisionIssues(value: JsonValue): readonly string[] {
  const issues = [...closedArray(value, 256, "decisions")];
  if (!Array.isArray(value)) return issues;
  let priorName: string | undefined;
  for (const [index, input] of value.entries()) {
    const prefix = `decisions.${index}`;
    const shape = closedRecord(input, projectBreakerFactsSchemaFields.decisionRow, prefix);
    if (shape.length) {
      issues.push(...shape);
      continue;
    }
    const row = input as ContractRecord;
    if (typeof row.capabilityName !== "string" || !namePattern.test(row.capabilityName))
      issues.push(`${prefix}.capabilityName:invalid`);
    if (row.trip !== "TRIP" && row.trip !== "NO_TRIP") issues.push(`${prefix}.trip:invalid`);
    if (typeof row.capabilityName === "string") {
      if (priorName !== undefined && priorName >= row.capabilityName)
        issues.push("decisions:not-sorted-unique");
      priorName = row.capabilityName;
    }
  }
  return issues;
}

/** Structural content only: NO_TRIP grants nothing and no arm proves freshness or recovery. */
export function parseProjectBreakerFacts(input: unknown): ParseResult<ProjectBreakerFacts> {
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
        ? projectBreakerFactsSchemaFields.complete
        : projectBreakerFactsSchemaFields.failure,
    ),
  ];
  if (issues.length) return invalid(...issues);
  if (record.schemaVersion !== "project-breaker-facts/v1") issues.push("schemaVersion:mismatch");
  for (const field of ["adapterConfigurationDigest", "projectFactsDigest"] as const)
    if (!isSha256(record[field]) || record[field].length !== 64) issues.push(`${field}:invalid`);
  for (const field of ["observationId", "projectId"] as const)
    if (!isUuidV7(record[field]) || record[field].length !== 36) issues.push(`${field}:invalid`);
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  if (!version(record.policyVersion)) issues.push("policyVersion:invalid");
  if (record.state === "COMPLETE") issues.push(...decisionIssues(record.decisions!));
  else {
    const reasons =
      record.state === "UNAVAILABLE"
        ? ["SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]
        : [
            "SOURCE_UNKNOWN",
            "MALFORMED_OBSERVATION",
            "CHANGED_BINDING",
            "CHANGED_SOURCE",
            "INCOMPLETE_CAPABILITIES",
          ];
    if (typeof record.reason !== "string" || !reasons.includes(record.reason))
      issues.push("reason:invalid");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ProjectBreakerFacts };
}

/**
 * Binds supplied content only. The caller must independently admit configuration/provenance,
 * static adapter and current policy support, and obtain a fresh source/policy invocation.
 * Matching hashes or a distinct observation ID cannot prove those execution obligations.
 */
export function validateProjectBreakerFactsBinding(
  factsInput: unknown,
  configurationInput: unknown,
  projectFactsInput: unknown,
  currentPolicyVersion: unknown,
): ParseResult<ProjectBreakerFacts> {
  const facts = parseProjectBreakerFacts(factsInput);
  if (!facts.ok) return facts;
  const configuration = parseAdapterConfiguration(configurationInput);
  if (!configuration.ok)
    return invalid(...configuration.issues.map((issue) => `configuration.${issue}`));
  const projectFacts = validateProjectFactsBinding(projectFactsInput, configuration.value);
  if (!projectFacts.ok)
    return invalid(...projectFacts.issues.map((issue) => `projectFacts.${issue}`));
  if (projectFacts.value.state !== "COMPLETE") return invalid("projectFacts:complete-required");
  const issues: string[] = [];
  if (!version(currentPolicyVersion)) issues.push("currentPolicyVersion:invalid");
  else if (facts.value.policyVersion !== currentPolicyVersion)
    issues.push("policyVersion:binding-mismatch");
  if (facts.value.adapterConfigurationDigest !== canonicalDigest(configuration.value))
    issues.push("adapterConfigurationDigest:binding-mismatch");
  if (facts.value.projectFactsDigest !== canonicalDigest(projectFacts.value))
    issues.push("projectFactsDigest:binding-mismatch");
  if (facts.value.projectId !== configuration.value.projectId)
    issues.push("projectId:binding-mismatch");
  if (facts.value.observationId === projectFacts.value.observationId)
    issues.push("observationId:must-differ-from-snapshot");
  if (facts.value.state === "COMPLETE") {
    const names = configuration.value.capabilityNames;
    if (
      facts.value.decisions.length !== names.length ||
      facts.value.decisions.some((decision, index) => decision.capabilityName !== names[index])
    )
      issues.push("decisions:capability-census-mismatch");
  }
  return issues.length ? invalid(...issues) : facts;
}

export function parseProjectBreakerFactsContract(
  schema: string,
  input: unknown,
): ParseResult | null {
  return schema === "project-breaker-facts/v1" ? parseProjectBreakerFacts(input) : null;
}

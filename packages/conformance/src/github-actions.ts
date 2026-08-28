import { types as nodeTypes } from "node:util";
import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  computeConformanceRecordDigest,
  addCompleteDays,
  parseConformanceCandidateSubject,
  parseConformanceRequiredJobRegistry,
  sha256Bytes,
} from "./contracts.js";

export const githubConformanceProtectionSchemaVersion =
  "github-conformance-protection-snapshot/v1" as const;
export const githubConformanceProtectedRefSchemaVersion =
  "github-conformance-protected-ref/v1" as const;
export const githubConformanceProviderRecordSchemaVersion =
  "github-conformance-provisional-provider-record/v1" as const;

const protectionFields = Object.freeze([
  "bypassActorCount",
  "deletionBlocked",
  "enforcement",
  "nonFastForwardBlocked",
  "pullRequestRequired",
  "schemaVersion",
  "targetRef",
] as const);

const protectedRefFields = Object.freeze(["refProtected", "schemaVersion", "targetRef"] as const);

const providerRunFields = Object.freeze([
  "candidateRevision",
  "candidateSubjectDigest",
  "event",
  "harnessBundleDigest",
  "protectedRefDigest",
  "repositoryId",
  "requiredJobRegistryDigest",
  "runAttempt",
  "runId",
  "testBundleDigest",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
] as const);

const candidateProjectionFields = Object.freeze(["entries", "truncated"] as const);
const candidateProjectionEntryFields = Object.freeze(["bytes", "mode", "path", "type"] as const);
const providerRecordFields = Object.freeze([
  "aggregateDigest",
  "artifacts",
  "candidateRevision",
  "candidateSubjectDigest",
  "event",
  "harnessBundleDigest",
  "jobs",
  "protectedRefDigest",
  "recordedAt",
  "repositoryId",
  "requiredJobRegistryDigest",
  "runAttempt",
  "runId",
  "schemaVersion",
  "testBundleDigest",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
] as const);
const providerJobFields = Object.freeze([
  "conclusion",
  "logicalJobId",
  "providerJobId",
  "providerJobName",
  "role",
] as const);
const providerArtifactFields = Object.freeze([
  "artifactDigest",
  "artifactId",
  "artifactName",
  "byteLength",
  "expiresAt",
  "logicalJobId",
  "role",
] as const);

function refusal(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function accepted(value: ContractRecord): ParseResult {
  return { ok: true, value };
}

function positiveDecimal(value: JsonValue | undefined): value is string {
  return isCanonicalDecimal(value) && value !== "0";
}

function commitRevision(value: JsonValue | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function githubWorkflowRef(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/conformance\.yml@refs\/heads\/main$/.test(
      value,
    )
  );
}

export function parseGithubConformanceProtectionSnapshot(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, protectionFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  if (value.bypassActorCount !== "0") issues.push("bypassActorCount:must-be-zero");
  if (value.deletionBlocked !== true) issues.push("deletionBlocked:required");
  if (value.enforcement !== "ACTIVE") issues.push("enforcement:must-be-active");
  if (value.nonFastForwardBlocked !== true) issues.push("nonFastForwardBlocked:required");
  if (value.pullRequestRequired !== true) issues.push("pullRequestRequired:required");
  if (value.schemaVersion !== githubConformanceProtectionSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (value.targetRef !== "refs/heads/main") issues.push("targetRef:mismatch");
  return issues.length === 0 ? accepted(value) : refusal(...issues);
}

export function computeGithubConformanceProtectionDigest(input: unknown): string {
  const parsed = parseGithubConformanceProtectionSnapshot(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(githubConformanceProtectionSchemaVersion, [frame.canonical(parsed.value)]);
}

export function parseGithubConformanceProtectedRef(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, protectedRefFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  if (value.refProtected !== true) issues.push("refProtected:required");
  if (value.schemaVersion !== githubConformanceProtectedRefSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (value.targetRef !== "refs/heads/main") issues.push("targetRef:mismatch");
  return issues.length === 0 ? accepted(value) : refusal(...issues);
}

export function computeGithubConformanceProtectedRefDigest(input: unknown): string {
  const parsed = parseGithubConformanceProtectedRef(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(githubConformanceProtectedRefSchemaVersion, [frame.canonical(parsed.value)]);
}

export function parseGithubProviderRunContext(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, providerRunFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  if (!commitRevision(value.candidateRevision)) issues.push("candidateRevision:invalid");
  for (const field of [
    "candidateSubjectDigest",
    "harnessBundleDigest",
    "protectedRefDigest",
    "requiredJobRegistryDigest",
    "testBundleDigest",
  ] as const)
    if (!isSha256(value[field])) issues.push(`${field}:invalid`);
  if (value.event !== "repository_dispatch") issues.push("event:mismatch");
  if (!positiveDecimal(value.repositoryId)) issues.push("repositoryId:invalid");
  if (!positiveDecimal(value.runAttempt)) issues.push("runAttempt:invalid");
  if (!positiveDecimal(value.runId)) issues.push("runId:invalid");
  if (value.workflowPath !== ".github/workflows/conformance.yml")
    issues.push("workflowPath:mismatch");
  if (!githubWorkflowRef(value.workflowRef)) issues.push("workflowRef:invalid");
  if (!commitRevision(value.workflowRevision)) issues.push("workflowRevision:invalid");
  return issues.length === 0 ? accepted(value) : refusal(...issues);
}

export function computeGithubProviderRunDigest(input: unknown): string {
  const parsed = parseGithubProviderRunContext(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const value = parsed.value;
  return framedDigest("github-conformance-provisional-provider-run/v1", [
    frame.text(String(value.repositoryId)),
    frame.text(String(value.workflowPath)),
    frame.text(String(value.workflowRef)),
    frame.text(String(value.workflowRevision)),
    frame.text(String(value.runId)),
    frame.text(String(value.runAttempt)),
    frame.text(String(value.event)),
    frame.raw32(String(value.protectedRefDigest)),
    frame.text(String(value.candidateRevision)),
    frame.raw32(String(value.candidateSubjectDigest)),
    frame.raw32(String(value.harnessBundleDigest)),
    frame.raw32(String(value.testBundleDigest)),
    frame.raw32(String(value.requiredJobRegistryDigest)),
  ]);
}

function portableLogicalId(value: JsonValue | undefined): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function utf8SortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1)
    if (
      Buffer.compare(
        Buffer.from(values[index - 1]!, "utf8"),
        Buffer.from(values[index]!, "utf8"),
      ) >= 0
    )
      return false;
  return true;
}

function retainedForCompleteDays(expiresAt: string, recordedAt: string, days: number): boolean {
  try {
    const minimum = new Date(addCompleteDays(recordedAt, days)).valueOf();
    const observed = new Date(expiresAt).valueOf();
    return Number.isFinite(minimum) && Number.isFinite(observed) && observed >= minimum;
  } catch {
    return false;
  }
}

function providerJobIssues(
  input: JsonValue,
  index: number,
): {
  readonly value?: ContractRecord;
  readonly issues: readonly string[];
} {
  const parsed = snapshotClosedRecord(input, providerJobFields);
  if (!parsed.ok) return { issues: parsed.issues.map((issue) => `jobs.${index}.${issue}`) };
  const row = parsed.value;
  const issues: string[] = [];
  if (row.conclusion !== "SUCCESS") issues.push(`jobs.${index}.conclusion:mismatch`);
  if (!portableLogicalId(row.logicalJobId)) issues.push(`jobs.${index}.logicalJobId:invalid`);
  if (!positiveDecimal(row.providerJobId)) issues.push(`jobs.${index}.providerJobId:invalid`);
  if (typeof row.providerJobName !== "string" || row.providerJobName.length > 256)
    issues.push(`jobs.${index}.providerJobName:invalid`);
  if (!(row.role === "PLAN" || row.role === "OBSERVATION" || row.role === "AGGREGATE"))
    issues.push(`jobs.${index}.role:invalid`);
  if (row.role === "PLAN") {
    if (row.logicalJobId !== "plan") issues.push(`jobs.${index}.logicalJobId:plan-mismatch`);
    if (row.providerJobName !== "Conformance / plan")
      issues.push(`jobs.${index}.providerJobName:plan-mismatch`);
  } else if (row.role === "AGGREGATE") {
    if (row.logicalJobId !== "aggregate")
      issues.push(`jobs.${index}.logicalJobId:aggregate-mismatch`);
    if (row.providerJobName !== "Conformance / aggregate")
      issues.push(`jobs.${index}.providerJobName:aggregate-mismatch`);
  } else if (
    typeof row.logicalJobId === "string" &&
    row.providerJobName !== `Conformance / observation / ${row.logicalJobId}`
  )
    issues.push(`jobs.${index}.providerJobName:observation-mismatch`);
  return { value: row, issues };
}

function providerArtifactIssues(
  input: JsonValue,
  index: number,
  runId: string,
  runAttempt: string,
  recordedAt: string,
): { readonly value?: ContractRecord; readonly issues: readonly string[] } {
  const parsed = snapshotClosedRecord(input, providerArtifactFields);
  if (!parsed.ok) return { issues: parsed.issues.map((issue) => `artifacts.${index}.${issue}`) };
  const row = parsed.value;
  const issues: string[] = [];
  if (!isSha256(row.artifactDigest)) issues.push(`artifacts.${index}.artifactDigest:invalid`);
  if (!positiveDecimal(row.artifactId)) issues.push(`artifacts.${index}.artifactId:invalid`);
  if (typeof row.artifactName !== "string" || row.artifactName.length > 256)
    issues.push(`artifacts.${index}.artifactName:invalid`);
  if (!positiveDecimal(row.byteLength)) issues.push(`artifacts.${index}.byteLength:invalid`);
  if (!isCanonicalTimestamp(row.expiresAt)) issues.push(`artifacts.${index}.expiresAt:invalid`);
  else if (
    isCanonicalTimestamp(recordedAt) &&
    !retainedForCompleteDays(row.expiresAt, recordedAt, 30)
  )
    issues.push(`artifacts.${index}.expiresAt:retention-short`);
  if (!portableLogicalId(row.logicalJobId)) issues.push(`artifacts.${index}.logicalJobId:invalid`);
  if (!(row.role === "OBSERVATION" || row.role === "AGGREGATE"))
    issues.push(`artifacts.${index}.role:invalid`);
  const prefix = `conformance-${runId}-${runAttempt}-`;
  if (row.role === "AGGREGATE") {
    if (row.logicalJobId !== "aggregate")
      issues.push(`artifacts.${index}.logicalJobId:aggregate-mismatch`);
    if (row.artifactName !== `${prefix}aggregate`)
      issues.push(`artifacts.${index}.artifactName:aggregate-mismatch`);
  } else if (
    typeof row.logicalJobId === "string" &&
    row.artifactName !== `${prefix}${row.logicalJobId}`
  )
    issues.push(`artifacts.${index}.artifactName:observation-mismatch`);
  return { value: row, issues };
}

export function parseGithubConformanceProviderRecord(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, providerRecordFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "aggregateDigest",
    "candidateSubjectDigest",
    "harnessBundleDigest",
    "protectedRefDigest",
    "requiredJobRegistryDigest",
    "testBundleDigest",
  ] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  if (!commitRevision(record.candidateRevision)) issues.push("candidateRevision:invalid");
  if (record.event !== "repository_dispatch") issues.push("event:mismatch");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  if (!positiveDecimal(record.repositoryId)) issues.push("repositoryId:invalid");
  if (!positiveDecimal(record.runAttempt)) issues.push("runAttempt:invalid");
  if (!positiveDecimal(record.runId)) issues.push("runId:invalid");
  if (record.schemaVersion !== githubConformanceProviderRecordSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (record.workflowPath !== ".github/workflows/conformance.yml")
    issues.push("workflowPath:mismatch");
  if (!githubWorkflowRef(record.workflowRef)) issues.push("workflowRef:invalid");
  if (!commitRevision(record.workflowRevision)) issues.push("workflowRevision:invalid");

  const jobs = record.jobs;
  const logicalJobIds: string[] = [];
  const providerJobIds: string[] = [];
  if (!Array.isArray(jobs) || jobs.length < 2 || jobs.length > 258)
    issues.push("jobs:census-bound-refused");
  else
    for (let index = 0; index < jobs.length; index += 1) {
      const result = providerJobIssues(jobs[index]!, index);
      issues.push(...result.issues);
      if (typeof result.value?.logicalJobId === "string")
        logicalJobIds.push(result.value.logicalJobId);
      if (typeof result.value?.providerJobId === "string")
        providerJobIds.push(result.value.providerJobId);
    }
  if (
    logicalJobIds.length === (Array.isArray(jobs) ? jobs.length : -1) &&
    !utf8SortedUnique(logicalJobIds)
  )
    issues.push("jobs:logical-order-refused");
  if (new Set(providerJobIds).size !== providerJobIds.length)
    issues.push("jobs:provider-id-duplicate");

  const artifacts = record.artifacts;
  const artifactNames: string[] = [];
  const artifactIds: string[] = [];
  if (!Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > 257)
    issues.push("artifacts:census-bound-refused");
  else
    for (let index = 0; index < artifacts.length; index += 1) {
      const result = providerArtifactIssues(
        artifacts[index]!,
        index,
        String(record.runId),
        String(record.runAttempt),
        String(record.recordedAt),
      );
      issues.push(...result.issues);
      if (typeof result.value?.artifactName === "string")
        artifactNames.push(result.value.artifactName);
      if (typeof result.value?.artifactId === "string") artifactIds.push(result.value.artifactId);
    }
  if (
    artifactNames.length === (Array.isArray(artifacts) ? artifacts.length : -1) &&
    !utf8SortedUnique(artifactNames)
  )
    issues.push("artifacts:name-order-refused");
  if (new Set(artifactIds).size !== artifactIds.length)
    issues.push("artifacts:provider-id-duplicate");
  return issues.length === 0 ? accepted(record) : refusal(...issues);
}

export interface GithubProviderRecordExpectation {
  readonly aggregateDigest: string;
  readonly providerRun: unknown;
  readonly registry: unknown;
}

export function validateGithubConformanceProviderRecord(
  input: unknown,
  expectation: GithubProviderRecordExpectation,
): ParseResult {
  try {
    const record = parseGithubConformanceProviderRecord(input);
    if (!record.ok) return record;
    const providerRun = parseGithubProviderRunContext(expectation.providerRun);
    if (!providerRun.ok)
      return refusal(...providerRun.issues.map((issue) => `providerRun.${issue}`));
    const registry = parseConformanceRequiredJobRegistry(expectation.registry);
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    const issues: string[] = [];
    if (!isSha256(expectation.aggregateDigest)) issues.push("aggregateDigest:expected-invalid");
    if (record.value.aggregateDigest !== expectation.aggregateDigest)
      issues.push("aggregateDigest:mismatch");
    for (const field of providerRunFields)
      if (record.value[field] !== providerRun.value[field]) issues.push(`${field}:mismatch`);
    const registryDigest = computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      registry.value,
    );
    if (record.value.requiredJobRegistryDigest !== registryDigest)
      issues.push("requiredJobRegistryDigest:registry-mismatch");
    const registryJobs = registry.value.jobs as readonly ContractRecord[];
    const expectedJobs = [
      { logicalJobId: "aggregate", providerJobName: "Conformance / aggregate", role: "AGGREGATE" },
      ...registryJobs.map((job) => ({
        logicalJobId: String(job.jobId),
        providerJobName: `Conformance / observation / ${String(job.jobId)}`,
        role: "OBSERVATION",
      })),
      { logicalJobId: "plan", providerJobName: "Conformance / plan", role: "PLAN" },
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.logicalJobId), Buffer.from(right.logicalJobId)),
    );
    const jobs = record.value.jobs as readonly ContractRecord[];
    if (jobs.length !== expectedJobs.length) issues.push("jobs:registry-census-mismatch");
    else
      for (let index = 0; index < expectedJobs.length; index += 1)
        for (const field of ["logicalJobId", "providerJobName", "role"] as const)
          if (jobs[index]?.[field] !== expectedJobs[index]![field])
            issues.push(`jobs.${index}.${field}:registry-mismatch`);
    const prefix = `conformance-${String(record.value.runId)}-${String(record.value.runAttempt)}-`;
    const expectedArtifacts = [
      { artifactName: `${prefix}aggregate`, logicalJobId: "aggregate", role: "AGGREGATE" },
      ...registryJobs.map((job) => ({
        artifactName: `${prefix}${String(job.jobId)}`,
        logicalJobId: String(job.jobId),
        role: "OBSERVATION",
      })),
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.artifactName), Buffer.from(right.artifactName)),
    );
    const artifacts = record.value.artifacts as readonly ContractRecord[];
    if (artifacts.length !== expectedArtifacts.length)
      issues.push("artifacts:registry-census-mismatch");
    else
      for (let index = 0; index < expectedArtifacts.length; index += 1)
        for (const field of ["artifactName", "logicalJobId", "role"] as const)
          if (artifacts[index]?.[field] !== expectedArtifacts[index]![field])
            issues.push(`artifacts.${index}.${field}:registry-mismatch`);
    return issues.length === 0 ? record : refusal(...issues);
  } catch {
    return refusal("providerRecord:unreadable");
  }
}

export function computeGithubConformanceProviderRecordDigest(input: unknown): string {
  const parsed = parseGithubConformanceProviderRecord(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(githubConformanceProviderRecordSchemaVersion, [
    frame.canonical(parsed.value),
  ]);
}

type CandidateProjectionResult =
  | {
      readonly ok: true;
      readonly value: ContractRecord;
      readonly digest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function exactDataRecord(
  input: unknown,
  fields: readonly string[],
):
  | { readonly ok: true; readonly values: Readonly<Record<string, unknown>> }
  | { readonly ok: false } {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return { ok: false };
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return { ok: false };
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
      return { ok: false };
    values[field] = descriptor.value;
  }
  return { ok: true, values: Object.freeze(values) };
}

function projectionEntry(
  input: unknown,
  index: number,
):
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly executable: boolean;
      readonly path: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const parsed = exactDataRecord(input, candidateProjectionEntryFields);
  if (!parsed.ok)
    return {
      ok: false,
      issues: [`entries.${index}:closed-data-record-required`],
    };
  const row = parsed.values;
  const issues: string[] = [];
  const bytes = row.bytes as unknown;
  if (
    !(bytes instanceof Uint8Array) ||
    nodeTypes.isProxy(bytes) ||
    Object.getPrototypeOf(bytes) !== Uint8Array.prototype
  )
    issues.push(`entries.${index}.bytes:exact-uint8array-required`);
  if (row.type !== "blob") issues.push(`entries.${index}.type:must-be-blob`);
  const executable = row.mode === "100755";
  if (!(row.mode === "100644" || executable)) issues.push(`entries.${index}.mode:refused`);
  if (typeof row.path !== "string" || !isContractRelativePath(row.path))
    issues.push(`entries.${index}.path:invalid`);
  return issues.length === 0
    ? { ok: true, bytes: bytes as Uint8Array, executable, path: String(row.path) }
    : { ok: false, issues };
}

export function projectGithubCandidateSubject(input: unknown): CandidateProjectionResult {
  try {
    const parsed = exactDataRecord(input, candidateProjectionFields);
    if (!parsed.ok) return { ok: false, issues: ["projection:closed-data-record-required"] };
    if (parsed.values.truncated !== false)
      return { ok: false, issues: ["projection:complete-tree-required"] };
    const entries = parsed.values.entries;
    if (
      !Array.isArray(entries) ||
      nodeTypes.isProxy(entries) ||
      Object.getPrototypeOf(entries) !== Array.prototype ||
      entries.length === 0 ||
      entries.length > 65_536
    )
      return { ok: false, issues: ["entries:length-or-array-refused"] };
    const entryDescriptors = Object.getOwnPropertyDescriptors(entries);
    const entryKeys = Reflect.ownKeys(entryDescriptors);
    const expectedEntryKeys = new Set([
      ...Array.from({ length: entries.length }, (_, index) => String(index)),
      "length",
    ]);
    if (
      entryKeys.some((key) => typeof key !== "string") ||
      (entryKeys as string[]).some((key) => !expectedEntryKeys.has(key)) ||
      entryKeys.length !== expectedEntryKeys.size
    )
      return { ok: false, issues: ["entries:exact-dense-array-required"] };
    const rows: ContractRecord[] = [];
    const issues: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const descriptor = entryDescriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        issues.push(`entries.${index}:data-element-required`);
        continue;
      }
      const projected = projectionEntry(descriptor.value, index);
      if (!projected.ok) {
        issues.push(...projected.issues);
        continue;
      }
      rows.push(
        Object.freeze({
          byteLength: String(projected.bytes.byteLength),
          executable: projected.executable,
          path: projected.path,
          sha256Digest: sha256Bytes(projected.bytes),
        }),
      );
    }
    if (issues.length > 0) return { ok: false, issues: Object.freeze(issues.sort()) };
    rows.sort((left, right) =>
      Buffer.compare(
        Buffer.from(String(left.path), "utf8"),
        Buffer.from(String(right.path), "utf8"),
      ),
    );
    const candidate = Object.freeze({
      files: Object.freeze(rows),
      schemaVersion: "conformance-candidate-subject/v1",
    });
    const validated = parseConformanceCandidateSubject(candidate);
    if (!validated.ok) return validated;
    return {
      ok: true,
      value: validated.value,
      digest: computeConformanceRecordDigest("conformance-candidate-subject/v1", validated.value),
    };
  } catch {
    return { ok: false, issues: ["projection:unreadable"] };
  }
}

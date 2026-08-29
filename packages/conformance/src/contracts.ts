import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  canonicalBytes,
  canonicalJson,
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";

export const conformanceSchemaVersions = Object.freeze([
  "conformance-aggregate/v1",
  "conformance-bundle-manifest/v1",
  "conformance-candidate-subject/v1",
  "conformance-contract-versions/v1",
  "conformance-environment/v1",
  "conformance-job-receipt/v1",
  "conformance-raw-artifact-manifest/v1",
  "conformance-required-job-registry/v1",
  "conformance-vector-census/v1",
] as const);

export type ConformanceSchemaVersion = (typeof conformanceSchemaVersions)[number];
export const conformanceBundlePurposes = Object.freeze(["HARNESS", "TEST_BUNDLE"] as const);
export const conformanceResults = Object.freeze([
  "PASS",
  "FAIL",
  "UNSUPPORTED",
  "UNKNOWN",
] as const);
export const conformanceEnvironmentFamilies = Object.freeze(["LINUX", "MACOS", "WINDOWS"] as const);
export const conformanceArchitectures = Object.freeze(["ARM64", "X64"] as const);
export const conformanceFixtureDispositions = Object.freeze([
  "ACCEPT",
  "REFUSE",
  "CENSUS",
  "MEASURE",
] as const);
export const conformanceFixtureKinds = Object.freeze(["BYTES", "GENERATOR"] as const);
export const conformanceRequirementKinds = Object.freeze(["REQUIRED", "UNUSED"] as const);
export const conformanceWalkRequirements = Object.freeze(["NONE", "WALK_1000"] as const);
export const conformanceRunnerTokens = Object.freeze([
  "ISS002_CONTRACTS",
  "ISS022_PORTABLE_PRIMITIVES",
] as const);

const bundleFields = Object.freeze(["files", "purpose", "schemaVersion"] as const);
const candidateFields = Object.freeze(["files", "schemaVersion"] as const);
const contractVersionFields = Object.freeze(["schemaVersion", "versions"] as const);
const vectorFields = Object.freeze(["entries", "schemaVersion"] as const);
const registryFields = Object.freeze(["jobs", "schemaVersion", "suites"] as const);
const environmentFields = Object.freeze([
  "abiDigest",
  "architecture",
  "custodyObservationDigest",
  "filesystemProfileDigest",
  "helperProfileDigest",
  "nodeVersion",
  "operatingSystem",
  "osImageDigest",
  "packageManagerVersion",
  "runnerClass",
  "schemaVersion",
] as const);
const rawManifestFields = Object.freeze(["entries", "schemaVersion"] as const);
const receiptFields = Object.freeze([
  "candidateSubjectDigest",
  "contractVersionsDigest",
  "environmentDigest",
  "harnessBundleDigest",
  "jobId",
  "maximumWalkDurationNanoseconds",
  "normalizedResult",
  "providerRunDigest",
  "rawArtifactManifestDigest",
  "requiredJobRegistryDigest",
  "schemaVersion",
  "suiteId",
  "testBundleDigest",
  "vectorCensusDigest",
] as const);
const aggregateFields = Object.freeze([
  "candidateSubjectDigest",
  "contractVersionsDigest",
  "harnessBundleDigest",
  "jobReceiptDigests",
  "providerRunDigest",
  "requiredJobRegistryDigest",
  "result",
  "schemaVersion",
  "testBundleDigest",
] as const);

const bundleFileFields = Object.freeze(["byteLength", "path", "sha256Digest"] as const);
const candidateFileFields = Object.freeze([
  "byteLength",
  "executable",
  "path",
  "sha256Digest",
] as const);
const generatorParameterFields = Object.freeze(["caseId", "iterationCount", "seed"] as const);
const vectorEntryFields = Object.freeze([
  "expectedDisposition",
  "fixtureDigest",
  "fixtureId",
  "fixtureKind",
  "generatorParameters",
] as const);
const suiteFields = Object.freeze([
  "custodyRequirement",
  "helperRequirement",
  "ownerPackage",
  "runnerToken",
  "suiteId",
  "vectorCensusDigest",
  "walkRequirement",
] as const);
const jobFields = Object.freeze(["environmentFamily", "jobId", "requirement", "suiteId"] as const);
const rawEntryFields = Object.freeze(["byteLength", "mediaType", "name", "sha256Digest"] as const);

export const conformanceSchemaFields = Object.freeze({
  aggregate: aggregateFields,
  bundle: bundleFields,
  candidate: candidateFields,
  contractVersions: contractVersionFields,
  environment: environmentFields,
  jobReceipt: receiptFields,
  rawManifest: rawManifestFields,
  registry: registryFields,
  vectorCensus: vectorFields,
});

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function success(value: ContractRecord): ParseResult {
  return { ok: true, value };
}

function prefixIssues(prefix: string, issues: readonly string[]): readonly string[] {
  return issues.map((issue) => `${prefix}.${issue}`);
}

function enumValue(value: JsonValue | undefined, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function portableId(value: JsonValue | undefined): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function packageName(value: JsonValue | undefined): value is string {
  return typeof value === "string" && /^@orchestration-platform\/[a-z][a-z0-9-]{0,63}$/.test(value);
}

function stableVersion(value: JsonValue | undefined, major: 24 | 11): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${major}\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$`).test(value)
  );
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1)
    if (utf8Compare(values[index - 1]!, values[index]!) >= 0) return false;
  return true;
}

function parseNestedRecord(
  input: JsonValue,
  fields: readonly string[],
  prefix: string,
): { readonly value?: ContractRecord; readonly issues: readonly string[] } {
  const parsed = snapshotClosedRecord(input, fields);
  return parsed.ok
    ? { value: parsed.value, issues: [] }
    : { issues: prefixIssues(prefix, parsed.issues) };
}

function parseBundleFileRows(input: JsonValue): readonly string[] {
  if (!Array.isArray(input)) return ["files:array-required"];
  if (input.length === 0 || input.length > 4096) return ["files:length-refused"];
  const issues: string[] = [];
  const paths: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const row = parseNestedRecord(input[index]!, bundleFileFields, `files.${index}`);
    if (!row.value) {
      issues.push(...row.issues);
      continue;
    }
    if (!isCanonicalDecimal(row.value.byteLength)) issues.push(`files.${index}.byteLength:invalid`);
    if (!isContractRelativePath(row.value.path)) issues.push(`files.${index}.path:invalid`);
    else paths.push(String(row.value.path));
    if (!isSha256(row.value.sha256Digest)) issues.push(`files.${index}.sha256Digest:invalid`);
  }
  if (paths.length === input.length && !sortedUnique(paths))
    issues.push("files:path-order-refused");
  return issues;
}

export function parseConformanceBundleManifest(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, bundleFields);
  if (!parsed.ok) return parsed;
  const issues = [...parseBundleFileRows(parsed.value.files!)];
  if (!enumValue(parsed.value.purpose, conformanceBundlePurposes)) issues.push("purpose:invalid");
  if (parsed.value.schemaVersion !== "conformance-bundle-manifest/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

type CandidateSnapshot =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

function candidateSnapshot(input: unknown): CandidateSnapshot {
  try {
    if (input === null || typeof input !== "object" || nodeTypes.isProxy(input))
      return { ok: false, issues: ["record:object-required"] };
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false, issues: ["record:plain-object-required"] };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string"))
      return { ok: false, issues: ["record:symbol-field-refused"] };
    const observed = (keys as string[]).sort();
    if (observed.join("\0") !== [...candidateFields].sort().join("\0"))
      return { ok: false, issues: ["record:field-census-refused"] };
    for (const key of candidateFields) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return { ok: false, issues: [`${key}:descriptor-refused`] };
    }
    const filesInput = descriptors.files!.value as unknown;
    if (
      !Array.isArray(filesInput) ||
      nodeTypes.isProxy(filesInput) ||
      Object.getPrototypeOf(filesInput) !== Array.prototype
    )
      return { ok: false, issues: ["files:exact-array-required"] };
    const fileDescriptors = Object.getOwnPropertyDescriptors(
      filesInput,
    ) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = fileDescriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor))
      return { ok: false, issues: ["files:length-descriptor-refused"] };
    const length = lengthDescriptor.value as unknown;
    if (!Number.isSafeInteger(length) || Number(length) <= 0 || Number(length) > 65536)
      return { ok: false, issues: ["files:length-refused"] };
    const fileKeys = Reflect.ownKeys(fileDescriptors);
    const expectedKeys = new Set<string>([
      ...Array.from({ length: Number(length) }, (_, index) => String(index)),
      "length",
    ]);
    if (
      fileKeys.some((key) => typeof key !== "string") ||
      (fileKeys as string[]).some((key) => !expectedKeys.has(key)) ||
      fileKeys.length !== expectedKeys.size
    )
      return { ok: false, issues: ["files:keys-refused"] };
    const files: JsonValue[] = [];
    for (let index = 0; index < Number(length); index += 1) {
      const element = fileDescriptors[String(index)];
      if (!element || !("value" in element) || element.enumerable !== true)
        return { ok: false, issues: [`files.${index}:descriptor-refused`] };
      const rowInput = element.value as unknown;
      if (
        rowInput === null ||
        typeof rowInput !== "object" ||
        nodeTypes.isProxy(rowInput) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(rowInput))
      )
        return { ok: false, issues: [`files.${index}:plain-record-required`] };
      const rowDescriptors = Object.getOwnPropertyDescriptors(rowInput);
      const rowKeys = Reflect.ownKeys(rowDescriptors);
      if (
        rowKeys.some((key) => typeof key !== "string") ||
        (rowKeys as string[]).sort().join("\0") !== [...candidateFileFields].sort().join("\0")
      )
        return { ok: false, issues: [`files.${index}:field-census-refused`] };
      const row: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const field of candidateFileFields) {
        const descriptor = rowDescriptors[field];
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
          return { ok: false, issues: [`files.${index}.${field}:descriptor-refused`] };
        const value = descriptor.value as unknown;
        if (!(typeof value === "string" || typeof value === "boolean"))
          return { ok: false, issues: [`files.${index}.${field}:scalar-refused`] };
        row[field] = value;
      }
      files.push(Object.freeze(row));
    }
    return {
      ok: true,
      value: Object.freeze({
        files: Object.freeze(files),
        schemaVersion: descriptors.schemaVersion!.value as JsonValue,
      }),
    };
  } catch {
    return { ok: false, issues: ["value:unreadable"] };
  }
}

export function parseConformanceCandidateSubject(input: unknown): ParseResult {
  const parsed = candidateSnapshot(input);
  if (!parsed.ok) return parsed;
  const files = parsed.value.files;
  const issues: string[] = [];
  const paths: string[] = [];
  if (!Array.isArray(files)) return failure("files:array-required");
  for (let index = 0; index < files.length; index += 1) {
    const row = files[index] as ContractRecord;
    if (!isCanonicalDecimal(row.byteLength)) issues.push(`files.${index}.byteLength:invalid`);
    if (typeof row.executable !== "boolean") issues.push(`files.${index}.executable:invalid`);
    if (!isContractRelativePath(row.path)) issues.push(`files.${index}.path:invalid`);
    else paths.push(String(row.path));
    if (!isSha256(row.sha256Digest)) issues.push(`files.${index}.sha256Digest:invalid`);
  }
  if (paths.length === files.length && !sortedUnique(paths))
    issues.push("files:path-order-refused");
  if (parsed.value.schemaVersion !== "conformance-candidate-subject/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

export function parseConformanceContractVersions(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, contractVersionFields);
  if (!parsed.ok) return parsed;
  const versions = parsed.value.versions;
  const issues: string[] = [];
  if (!Array.isArray(versions) || versions.length === 0 || versions.length > 1024)
    issues.push("versions:length-refused");
  else {
    if (
      versions.some(
        (version) =>
          typeof version !== "string" ||
          version.length > 128 ||
          !/^[a-z][a-z0-9-]*\/v1$/.test(version),
      )
    )
      issues.push("versions:value-refused");
    if (versions.every((version) => typeof version === "string") && !sortedUnique(versions))
      issues.push("versions:order-refused");
  }
  if (parsed.value.schemaVersion !== "conformance-contract-versions/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

function parseGeneratorParameters(input: JsonValue, prefix: string): readonly string[] {
  const parsed = parseNestedRecord(input, generatorParameterFields, prefix);
  if (!parsed.value) return parsed.issues;
  const issues: string[] = [];
  if (!portableId(parsed.value.caseId)) issues.push(`${prefix}.caseId:invalid`);
  if (!isCanonicalDecimal(parsed.value.iterationCount) || parsed.value.iterationCount === "0")
    issues.push(`${prefix}.iterationCount:invalid`);
  if (!isSha256(parsed.value.seed)) issues.push(`${prefix}.seed:invalid`);
  return issues;
}

export function parseConformanceVectorCensus(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, vectorFields);
  if (!parsed.ok) return parsed;
  const entries = parsed.value.entries;
  const issues: string[] = [];
  const ids: string[] = [];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256)
    issues.push("entries:length-refused");
  else
    for (let index = 0; index < entries.length; index += 1) {
      const row = parseNestedRecord(entries[index]!, vectorEntryFields, `entries.${index}`);
      if (!row.value) {
        issues.push(...row.issues);
        continue;
      }
      if (!enumValue(row.value.expectedDisposition, conformanceFixtureDispositions))
        issues.push(`entries.${index}.expectedDisposition:invalid`);
      if (!isSha256(row.value.fixtureDigest)) issues.push(`entries.${index}.fixtureDigest:invalid`);
      if (!portableId(row.value.fixtureId)) issues.push(`entries.${index}.fixtureId:invalid`);
      else ids.push(String(row.value.fixtureId));
      if (!enumValue(row.value.fixtureKind, conformanceFixtureKinds))
        issues.push(`entries.${index}.fixtureKind:invalid`);
      if (row.value.fixtureKind === "BYTES") {
        if (row.value.generatorParameters !== null)
          issues.push(`entries.${index}.generatorParameters:must-be-null`);
      } else if (row.value.fixtureKind === "GENERATOR") {
        if (row.value.generatorParameters === null)
          issues.push(`entries.${index}.generatorParameters:required`);
        else
          issues.push(
            ...parseGeneratorParameters(
              row.value.generatorParameters!,
              `entries.${index}.generatorParameters`,
            ),
          );
      }
    }
  if (ids.length === (Array.isArray(entries) ? entries.length : -1) && !sortedUnique(ids))
    issues.push("entries:id-order-refused");
  if (parsed.value.schemaVersion !== "conformance-vector-census/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

export function parseConformanceRequiredJobRegistry(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, registryFields);
  if (!parsed.ok) return parsed;
  const suites = parsed.value.suites;
  const jobs = parsed.value.jobs;
  const issues: string[] = [];
  const suiteIds: string[] = [];
  const jobIds: string[] = [];
  if (!Array.isArray(suites) || suites.length === 0 || suites.length > 64)
    issues.push("suites:length-refused");
  else
    for (let index = 0; index < suites.length; index += 1) {
      const row = parseNestedRecord(suites[index]!, suiteFields, `suites.${index}`);
      if (!row.value) {
        issues.push(...row.issues);
        continue;
      }
      if (!enumValue(row.value.custodyRequirement, conformanceRequirementKinds))
        issues.push(`suites.${index}.custodyRequirement:invalid`);
      if (!enumValue(row.value.helperRequirement, conformanceRequirementKinds))
        issues.push(`suites.${index}.helperRequirement:invalid`);
      if (!packageName(row.value.ownerPackage)) issues.push(`suites.${index}.ownerPackage:invalid`);
      if (
        typeof row.value.runnerToken !== "string" ||
        !conformanceRunnerTokens.includes(
          row.value.runnerToken as (typeof conformanceRunnerTokens)[number],
        )
      )
        issues.push(`suites.${index}.runnerToken:not-in-stable-catalog`);
      if (!portableId(row.value.suiteId)) issues.push(`suites.${index}.suiteId:invalid`);
      else suiteIds.push(String(row.value.suiteId));
      if (!isSha256(row.value.vectorCensusDigest))
        issues.push(`suites.${index}.vectorCensusDigest:invalid`);
      if (!enumValue(row.value.walkRequirement, conformanceWalkRequirements))
        issues.push(`suites.${index}.walkRequirement:invalid`);
    }
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > 256)
    issues.push("jobs:length-refused");
  else
    for (let index = 0; index < jobs.length; index += 1) {
      const row = parseNestedRecord(jobs[index]!, jobFields, `jobs.${index}`);
      if (!row.value) {
        issues.push(...row.issues);
        continue;
      }
      if (!enumValue(row.value.environmentFamily, conformanceEnvironmentFamilies))
        issues.push(`jobs.${index}.environmentFamily:invalid`);
      if (!portableId(row.value.jobId)) issues.push(`jobs.${index}.jobId:invalid`);
      else jobIds.push(String(row.value.jobId));
      if (row.value.requirement !== "REQUIRED") issues.push(`jobs.${index}.requirement:invalid`);
      if (!portableId(row.value.suiteId)) issues.push(`jobs.${index}.suiteId:invalid`);
    }
  if (suiteIds.length === (Array.isArray(suites) ? suites.length : -1) && !sortedUnique(suiteIds))
    issues.push("suites:id-order-refused");
  if (jobIds.length === (Array.isArray(jobs) ? jobs.length : -1) && !sortedUnique(jobIds))
    issues.push("jobs:id-order-refused");
  if (Array.isArray(jobs) && suiteIds.length > 0) {
    const jobSuiteIds = jobs
      .filter(
        (job): job is ContractRecord =>
          job !== null && !Array.isArray(job) && typeof job === "object",
      )
      .map((job) => String(job.suiteId));
    for (const id of jobSuiteIds)
      if (!suiteIds.includes(id)) issues.push(`jobs.${id}:orphan-suite`);
    for (const id of suiteIds) if (!jobSuiteIds.includes(id)) issues.push(`suites.${id}:no-jobs`);
  }
  if (parsed.value.schemaVersion !== "conformance-required-job-registry/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

export function parseConformanceEnvironment(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, environmentFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  for (const field of ["abiDigest", "osImageDigest"] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  for (const field of [
    "custodyObservationDigest",
    "filesystemProfileDigest",
    "helperProfileDigest",
  ] as const)
    if (!(record[field] === null || isSha256(record[field]))) issues.push(`${field}:invalid`);
  if (!enumValue(record.architecture, conformanceArchitectures))
    issues.push("architecture:invalid");
  if (!stableVersion(record.nodeVersion, 24)) issues.push("nodeVersion:invalid");
  if (!enumValue(record.operatingSystem, conformanceEnvironmentFamilies))
    issues.push("operatingSystem:invalid");
  if (!stableVersion(record.packageManagerVersion, 11))
    issues.push("packageManagerVersion:invalid");
  if (record.runnerClass !== "EPHEMERAL_HOSTED") issues.push("runnerClass:invalid");
  if (record.schemaVersion !== "conformance-environment/v1") issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(record) : failure(...issues);
}

const rawCensus = Object.freeze([
  ["environment", "APPLICATION_JSON"],
  ["report", "APPLICATION_JSON"],
  ["stderr", "TEXT_PLAIN"],
  ["stdout", "TEXT_PLAIN"],
] as const);

export function parseConformanceRawArtifactManifest(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, rawManifestFields);
  if (!parsed.ok) return parsed;
  const entries = parsed.value.entries;
  const issues: string[] = [];
  if (!Array.isArray(entries) || entries.length !== rawCensus.length)
    issues.push("entries:census-refused");
  else
    for (let index = 0; index < entries.length; index += 1) {
      const row = parseNestedRecord(entries[index]!, rawEntryFields, `entries.${index}`);
      if (!row.value) {
        issues.push(...row.issues);
        continue;
      }
      const [name, mediaType] = rawCensus[index]!;
      if (row.value.name !== name) issues.push(`entries.${index}.name:mismatch`);
      if (row.value.mediaType !== mediaType) issues.push(`entries.${index}.mediaType:mismatch`);
      if (!isCanonicalDecimal(row.value.byteLength))
        issues.push(`entries.${index}.byteLength:invalid`);
      if (!isSha256(row.value.sha256Digest)) issues.push(`entries.${index}.sha256Digest:invalid`);
    }
  if (parsed.value.schemaVersion !== "conformance-raw-artifact-manifest/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

export function parseConformanceJobReceipt(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, receiptFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "candidateSubjectDigest",
    "contractVersionsDigest",
    "environmentDigest",
    "harnessBundleDigest",
    "providerRunDigest",
    "rawArtifactManifestDigest",
    "requiredJobRegistryDigest",
    "testBundleDigest",
    "vectorCensusDigest",
  ] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  for (const field of ["jobId", "suiteId"] as const)
    if (!portableId(record[field])) issues.push(`${field}:invalid`);
  if (!enumValue(record.normalizedResult, conformanceResults))
    issues.push("normalizedResult:invalid");
  const walkDuration = record.maximumWalkDurationNanoseconds;
  if (record.normalizedResult !== "PASS") {
    if (walkDuration !== null) issues.push("maximumWalkDurationNanoseconds:must-be-null");
  } else if (!(
    walkDuration === null ||
    (isCanonicalDecimal(walkDuration) && BigInt(walkDuration) <= 5_000_000_000n)
  ))
    issues.push("maximumWalkDurationNanoseconds:invalid-or-over-budget");
  if (record.schemaVersion !== "conformance-job-receipt/v1") issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(record) : failure(...issues);
}

export function parseConformanceAggregate(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, aggregateFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "candidateSubjectDigest",
    "contractVersionsDigest",
    "harnessBundleDigest",
    "providerRunDigest",
    "requiredJobRegistryDigest",
    "testBundleDigest",
  ] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  if (
    !Array.isArray(record.jobReceiptDigests) ||
    record.jobReceiptDigests.length === 0 ||
    record.jobReceiptDigests.length > 256 ||
    record.jobReceiptDigests.some((digest) => !isSha256(digest)) ||
    new Set(record.jobReceiptDigests).size !== record.jobReceiptDigests.length
  )
    issues.push("jobReceiptDigests:invalid");
  if (record.result !== "PASS") issues.push("result:invalid");
  if (record.schemaVersion !== "conformance-aggregate/v1") issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(record) : failure(...issues);
}

export function parseConformanceContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult {
  switch (expectedSchemaVersion) {
    case "conformance-aggregate/v1":
      return parseConformanceAggregate(input);
    case "conformance-bundle-manifest/v1":
      return parseConformanceBundleManifest(input);
    case "conformance-candidate-subject/v1":
      return parseConformanceCandidateSubject(input);
    case "conformance-contract-versions/v1":
      return parseConformanceContractVersions(input);
    case "conformance-environment/v1":
      return parseConformanceEnvironment(input);
    case "conformance-job-receipt/v1":
      return parseConformanceJobReceipt(input);
    case "conformance-raw-artifact-manifest/v1":
      return parseConformanceRawArtifactManifest(input);
    case "conformance-required-job-registry/v1":
      return parseConformanceRequiredJobRegistry(input);
    case "conformance-vector-census/v1":
      return parseConformanceVectorCensus(input);
    default:
      return failure("schemaVersion:unsupported");
  }
}

function parsedRecord(
  expectedSchemaVersion: ConformanceSchemaVersion,
  input: unknown,
): ContractRecord {
  const parsed = parseConformanceContract(expectedSchemaVersion, input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function computeConformanceRecordDigest(
  expectedSchemaVersion: ConformanceSchemaVersion,
  input: unknown,
): string {
  const parsed = parsedRecord(expectedSchemaVersion, input);
  return framedDigest(expectedSchemaVersion, [frame.canonical(parsed)]);
}

export function serializeConformanceContract(
  expectedSchemaVersion: ConformanceSchemaVersion,
  input: unknown,
):
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const parsed = parseConformanceContract(expectedSchemaVersion, input);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    bytes: canonicalBytes(parsed.value),
    digest: framedDigest(expectedSchemaVersion, [frame.canonical(parsed.value)]),
  };
}

export function parseCanonicalConformanceBytes(
  expectedSchemaVersion: ConformanceSchemaVersion,
  bytes: unknown,
): ParseResult {
  if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype)
    return failure("encoding:bytes-required");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return failure("encoding:invalid-utf8");
  }
  if (text.startsWith("\ufeff")) return failure("encoding:bom-refused");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return failure("encoding:invalid-json");
  }
  const parsed = parseConformanceContract(expectedSchemaVersion, value);
  if (!parsed.ok) return parsed;
  return canonicalJson(parsed.value) === text ? parsed : failure("encoding:noncanonical");
}

function exactBytes(input: unknown): Uint8Array {
  if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype)
    throw new TypeError("bytes:exact-uint8array-required");
  if (input.length === 0) throw new TypeError("bytes:empty-refused");
  return input;
}

export function computeConformanceVectorBytesDigest(bytes: unknown): string {
  if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype)
    throw new TypeError("bytes:exact-uint8array-required");
  const value = bytes;
  if (value.length === 0) {
    const domain = Buffer.from("conformance-vector-bytes/v1\0", "utf8");
    const partCount = Buffer.alloc(4);
    partCount.writeUInt32BE(1);
    const byteLength = Buffer.alloc(8);
    byteLength.writeBigUInt64BE(0n);
    return createHash("sha256")
      .update(Buffer.from("orchestration-platform\0", "utf8"))
      .update(domain)
      .update(partCount)
      .update(Buffer.from([5]))
      .update(byteLength)
      .digest("hex");
  }
  return framedDigest("conformance-vector-bytes/v1", [
    frame.fixed(Buffer.from(value).toString("hex")),
  ]);
}

export function computeConformanceVectorGeneratorDigest(
  sourceBytes: unknown,
  parameters: unknown,
): string {
  const source = exactBytes(sourceBytes);
  const parsed = snapshotClosedRecord(parameters, generatorParameterFields);
  if (
    !parsed.ok ||
    parseGeneratorParameters(parsed.ok ? parsed.value : null, "parameters").length > 0
  )
    throw new TypeError(parsed.ok ? "parameters:invalid" : parsed.issues.join(","));
  return framedDigest("conformance-vector-generator/v1", [
    frame.fixed(Buffer.from(source).toString("hex")),
    frame.canonical(parsed.value),
  ]);
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalByteLength(value: Uint8Array): string {
  return String(value.byteLength);
}

export function addCompleteDays(timestamp: string, days: number): string {
  if (!isCanonicalTimestamp(timestamp) || !Number.isSafeInteger(days) || days < 0)
    throw new TypeError("timestamp-or-days:invalid");
  return new Date(new Date(timestamp).valueOf() + days * 86_400_000).toISOString();
}

import { types as nodeTypes } from "node:util";
import {
  isCanonicalDecimal,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
} from "@orchestration-platform/contracts";
import {
  computeConformanceRecordDigest,
  conformanceEnvironmentFamilies,
  conformanceResults,
  parseConformanceEnvironment,
  parseConformanceJobReceipt,
  parseConformanceRawArtifactManifest,
  parseConformanceRequiredJobRegistry,
  sha256Bytes,
} from "./contracts.js";

export interface ConformanceRawArtifacts {
  readonly environment: Uint8Array;
  readonly report: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdout: Uint8Array;
}

export interface CreateConformanceJobEvidenceInput {
  readonly candidateSubjectDigest: string;
  readonly contractVersionsDigest: string;
  readonly environment: unknown;
  readonly harnessBundleDigest: string;
  readonly jobId: string;
  readonly maximumWalkDurationNanoseconds: string | null;
  readonly normalizedResult: "PASS" | "FAIL" | "UNSUPPORTED" | "UNKNOWN";
  readonly providerRunDigest: string;
  readonly rawArtifacts: ConformanceRawArtifacts;
  readonly registry: unknown;
  readonly testBundleDigest: string;
}

export type CreateConformanceJobEvidenceResult =
  | {
      readonly ok: true;
      readonly environment: ContractRecord;
      readonly rawArtifactManifest: ContractRecord;
      readonly receipt: ContractRecord;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export type ReduceConformanceAggregateResult =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

const rawNames = Object.freeze(["environment", "report", "stderr", "stdout"] as const);
const evidenceFields = Object.freeze(["environment", "rawArtifactManifest", "receipt"] as const);

function refusal(...issues: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function portableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function exactRawArtifacts(input: unknown): input is ConformanceRawArtifacts {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...rawNames].sort().join("\0")
  )
    return false;
  for (const name of rawNames) {
    const descriptor = descriptors[name];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return false;
    const value = descriptor.value as unknown;
    if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype)
      return false;
  }
  return true;
}

function registryRows(registry: ContractRecord): {
  readonly jobs: readonly ContractRecord[];
  readonly suites: readonly ContractRecord[];
} {
  return {
    jobs: registry.jobs as readonly ContractRecord[],
    suites: registry.suites as readonly ContractRecord[],
  };
}

function suiteFor(suites: readonly ContractRecord[], suiteId: string): ContractRecord | undefined {
  return suites.find((suite) => suite.suiteId === suiteId);
}

function jobFor(jobs: readonly ContractRecord[], jobId: string): ContractRecord | undefined {
  return jobs.find((job) => job.jobId === jobId);
}

function validateEnvironmentForSuite(
  environment: ContractRecord,
  suite: ContractRecord,
  environmentFamily: JsonValue | undefined,
): readonly string[] {
  const issues: string[] = [];
  if (environment.operatingSystem !== environmentFamily)
    issues.push("environment.operatingSystem:mismatch");
  for (const [field, requirementField] of [
    ["custodyObservationDigest", "custodyRequirement"],
    ["helperProfileDigest", "helperRequirement"],
  ] as const) {
    if (suite[requirementField] === "REQUIRED" && !isSha256(environment[field]))
      issues.push(`environment.${field}:required`);
    if (suite[requirementField] === "UNUSED" && environment[field] !== null)
      issues.push(`environment.${field}:must-be-null`);
  }
  return issues;
}

function validateWalkArm(receipt: ContractRecord, suite: ContractRecord): readonly string[] {
  const value = receipt.maximumWalkDurationNanoseconds;
  if (receipt.normalizedResult !== "PASS")
    return value === null ? [] : ["maximumWalkDurationNanoseconds:must-be-null"];
  if (suite.walkRequirement === "NONE")
    return value === null ? [] : ["maximumWalkDurationNanoseconds:must-be-null"];
  if (!isCanonicalDecimal(value)) return ["maximumWalkDurationNanoseconds:required"];
  return BigInt(value) <= 5_000_000_000n ? [] : ["maximumWalkDurationNanoseconds:limit-exceeded"];
}

function rawManifest(raw: ConformanceRawArtifacts): ContractRecord {
  const mediaTypes = Object.freeze({
    environment: "APPLICATION_JSON",
    report: "APPLICATION_JSON",
    stderr: "TEXT_PLAIN",
    stdout: "TEXT_PLAIN",
  } as const);
  return Object.freeze({
    entries: Object.freeze(
      rawNames.map((name) =>
        Object.freeze({
          byteLength: String(raw[name].byteLength),
          mediaType: mediaTypes[name],
          name,
          sha256Digest: sha256Bytes(raw[name]),
        }),
      ),
    ),
    schemaVersion: "conformance-raw-artifact-manifest/v1",
  });
}

export function createConformanceJobEvidence(
  input: CreateConformanceJobEvidenceInput,
): CreateConformanceJobEvidenceResult {
  try {
    const registry = parseConformanceRequiredJobRegistry(input.registry);
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    const environment = parseConformanceEnvironment(input.environment);
    if (!environment.ok)
      return refusal(...environment.issues.map((issue) => `environment.${issue}`));
    if (!exactRawArtifacts(input.rawArtifacts)) return refusal("rawArtifacts:invalid");
    const { jobs, suites } = registryRows(registry.value);
    const job = jobFor(jobs, input.jobId);
    if (!job) return refusal("jobId:not-required");
    const suite = suiteFor(suites, String(job.suiteId));
    if (!suite) return refusal("suiteId:not-required");
    const issues = [
      ...validateEnvironmentForSuite(environment.value, suite, job.environmentFamily),
    ];
    if (sha256Bytes(input.rawArtifacts.environment) !== environment.value.osImageDigest)
      issues.push("rawArtifacts.environment:osImageDigest-mismatch");
    for (const [field, value] of Object.entries({
      candidateSubjectDigest: input.candidateSubjectDigest,
      contractVersionsDigest: input.contractVersionsDigest,
      harnessBundleDigest: input.harnessBundleDigest,
      providerRunDigest: input.providerRunDigest,
      testBundleDigest: input.testBundleDigest,
    }))
      if (!isSha256(value)) issues.push(`${field}:invalid`);
    if (!portableId(input.jobId)) issues.push("jobId:invalid");
    if (!conformanceResults.includes(input.normalizedResult))
      issues.push("normalizedResult:invalid");
    const manifest = rawManifest(input.rawArtifacts);
    const receipt: ContractRecord = Object.freeze({
      candidateSubjectDigest: input.candidateSubjectDigest,
      contractVersionsDigest: input.contractVersionsDigest,
      environmentDigest: computeConformanceRecordDigest(
        "conformance-environment/v1",
        environment.value,
      ),
      harnessBundleDigest: input.harnessBundleDigest,
      jobId: input.jobId,
      maximumWalkDurationNanoseconds: input.maximumWalkDurationNanoseconds,
      normalizedResult: input.normalizedResult,
      providerRunDigest: input.providerRunDigest,
      rawArtifactManifestDigest: computeConformanceRecordDigest(
        "conformance-raw-artifact-manifest/v1",
        manifest,
      ),
      requiredJobRegistryDigest: computeConformanceRecordDigest(
        "conformance-required-job-registry/v1",
        registry.value,
      ),
      schemaVersion: "conformance-job-receipt/v1",
      suiteId: String(job.suiteId),
      testBundleDigest: input.testBundleDigest,
      vectorCensusDigest: String(suite.vectorCensusDigest),
    });
    const parsedReceipt = parseConformanceJobReceipt(receipt);
    if (!parsedReceipt.ok) issues.push(...parsedReceipt.issues);
    issues.push(...validateWalkArm(receipt, suite));
    return issues.length === 0
      ? {
          ok: true,
          environment: environment.value,
          rawArtifactManifest: manifest,
          receipt,
        }
      : refusal(...issues);
  } catch {
    return refusal("evidence:unreadable");
  }
}

export function reduceConformanceAggregate(
  registryInput: unknown,
  evidenceInput: unknown,
): ReduceConformanceAggregateResult {
  const registry = parseConformanceRequiredJobRegistry(registryInput);
  if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
  const evidenceArray = snapshotClosedArray(evidenceInput);
  if (!evidenceArray.ok)
    return refusal(...evidenceArray.issues.map((issue) => `evidence.${issue}`));
  const { jobs, suites } = registryRows(registry.value);
  if (evidenceArray.value.length !== jobs.length) return refusal("evidence:census-mismatch");
  const registryDigest = computeConformanceRecordDigest(
    "conformance-required-job-registry/v1",
    registry.value,
  );
  const evidenceByJob = new Map<
    string,
    {
      readonly environment: ContractRecord;
      readonly manifest: ContractRecord;
      readonly receipt: ContractRecord;
    }
  >();
  const issues: string[] = [];
  for (let index = 0; index < evidenceArray.value.length; index += 1) {
    const wrapper = snapshotClosedRecord(evidenceArray.value[index], evidenceFields);
    if (!wrapper.ok) {
      issues.push(...wrapper.issues.map((issue) => `evidence.${index}.${issue}`));
      continue;
    }
    const environment = parseConformanceEnvironment(wrapper.value.environment);
    const manifest = parseConformanceRawArtifactManifest(wrapper.value.rawArtifactManifest);
    const receipt = parseConformanceJobReceipt(wrapper.value.receipt);
    if (!environment.ok)
      issues.push(...environment.issues.map((issue) => `evidence.${index}.environment.${issue}`));
    if (!manifest.ok)
      issues.push(...manifest.issues.map((issue) => `evidence.${index}.manifest.${issue}`));
    if (!receipt.ok)
      issues.push(...receipt.issues.map((issue) => `evidence.${index}.receipt.${issue}`));
    if (!(environment.ok && manifest.ok && receipt.ok)) continue;
    const jobId = String(receipt.value.jobId);
    if (evidenceByJob.has(jobId)) issues.push(`evidence.${jobId}:duplicate`);
    else
      evidenceByJob.set(jobId, {
        environment: environment.value,
        manifest: manifest.value,
        receipt: receipt.value,
      });
  }
  const receiptDigests: string[] = [];
  let global:
    | Pick<
        ContractRecord,
        | "candidateSubjectDigest"
        | "contractVersionsDigest"
        | "harnessBundleDigest"
        | "providerRunDigest"
        | "testBundleDigest"
      >
    | undefined;
  for (const job of jobs) {
    const jobId = String(job.jobId);
    const evidence = evidenceByJob.get(jobId);
    if (!evidence) {
      issues.push(`evidence.${jobId}:missing`);
      continue;
    }
    const suite = suiteFor(suites, String(job.suiteId));
    if (!suite) {
      issues.push(`suite.${String(job.suiteId)}:missing`);
      continue;
    }
    const receipt = evidence.receipt;
    if (receipt.suiteId !== suite.suiteId) issues.push(`receipt.${jobId}.suiteId:mismatch`);
    if (receipt.vectorCensusDigest !== suite.vectorCensusDigest)
      issues.push(`receipt.${jobId}.vectorCensusDigest:mismatch`);
    if (receipt.requiredJobRegistryDigest !== registryDigest)
      issues.push(`receipt.${jobId}.requiredJobRegistryDigest:mismatch`);
    if (
      receipt.environmentDigest !==
      computeConformanceRecordDigest("conformance-environment/v1", evidence.environment)
    )
      issues.push(`receipt.${jobId}.environmentDigest:mismatch`);
    if (
      receipt.rawArtifactManifestDigest !==
      computeConformanceRecordDigest("conformance-raw-artifact-manifest/v1", evidence.manifest)
    )
      issues.push(`receipt.${jobId}.rawArtifactManifestDigest:mismatch`);
    const rawEntries = evidence.manifest.entries as readonly ContractRecord[];
    if (rawEntries[0]?.sha256Digest !== evidence.environment.osImageDigest)
      issues.push(`receipt.${jobId}.osImageDigest:mismatch`);
    issues.push(
      ...validateEnvironmentForSuite(evidence.environment, suite, job.environmentFamily).map(
        (issue) => `receipt.${jobId}.${issue}`,
      ),
      ...validateWalkArm(receipt, suite).map((issue) => `receipt.${jobId}.${issue}`),
    );
    if (receipt.normalizedResult !== "PASS") issues.push(`receipt.${jobId}.result:not-pass`);
    const current = {
      candidateSubjectDigest: String(receipt.candidateSubjectDigest),
      contractVersionsDigest: String(receipt.contractVersionsDigest),
      harnessBundleDigest: String(receipt.harnessBundleDigest),
      providerRunDigest: String(receipt.providerRunDigest),
      testBundleDigest: String(receipt.testBundleDigest),
    } as const;
    if (!global) global = current;
    else
      for (const field of Object.keys(current) as readonly (keyof typeof current)[])
        if (current[field] !== global[field]) issues.push(`receipt.${jobId}.${field}:mismatch`);
    receiptDigests.push(computeConformanceRecordDigest("conformance-job-receipt/v1", receipt));
  }
  if (issues.length > 0 || !global)
    return refusal(...issues, ...(!global ? ["aggregate:empty"] : []));
  return {
    ok: true,
    value: Object.freeze({
      candidateSubjectDigest: global.candidateSubjectDigest,
      contractVersionsDigest: global.contractVersionsDigest,
      harnessBundleDigest: global.harnessBundleDigest,
      jobReceiptDigests: Object.freeze(receiptDigests),
      providerRunDigest: global.providerRunDigest,
      requiredJobRegistryDigest: registryDigest,
      result: "PASS",
      schemaVersion: "conformance-aggregate/v1",
      testBundleDigest: global.testBundleDigest,
    }),
  };
}

export function environmentFamilyForJob(
  registryInput: unknown,
  jobId: string,
): (typeof conformanceEnvironmentFamilies)[number] | undefined {
  const registry = parseConformanceRequiredJobRegistry(registryInput);
  if (!registry.ok) return undefined;
  const job = jobFor(registryRows(registry.value).jobs, jobId);
  return conformanceEnvironmentFamilies.find((family) => family === job?.environmentFamily);
}

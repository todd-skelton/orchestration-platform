import { types as nodeTypes } from "node:util";
import {
  canonicalJson,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
} from "@orchestration-platform/contracts";
import {
  addCompleteDays,
  computeConformanceRecordDigest,
  parseConformanceRequiredJobRegistry,
  sha256Bytes,
} from "./contracts.js";
import {
  computeGithubConformanceProtectionDigest,
  computeGithubConformanceProviderRecordDigest,
  computeGithubProviderRunDigest,
  parseGithubConformanceProtectionSnapshot,
  parseGithubConformanceProviderRecord,
  parseGithubProviderRunContext,
  validateGithubConformanceProviderRecord,
} from "./github-actions.js";
import {
  verifyGithubAggregateArchive,
  verifyGithubArtifactIdentity,
  verifyGithubObservationArchive,
} from "./github-artifacts.js";

export type GithubTerminalVerificationResult =
  | { readonly ok: true; readonly providerRecordDigest: string; readonly providerRunDigest: string }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface GithubTerminalVerificationInput {
  readonly artifactBytes: unknown;
  readonly currentProtectionSnapshot: unknown;
  readonly expected: unknown;
  readonly liveArtifacts: unknown;
  readonly liveJobs: unknown;
  readonly liveRun: unknown;
  readonly providerRecordBytes: unknown;
  readonly providerRun: unknown;
  readonly registry: unknown;
}

const expectedFields = Object.freeze([
  "repositoryId",
  "runAttempt",
  "runId",
  "workflowRevision",
] as const);
const runFields = Object.freeze([
  "conclusion",
  "event",
  "repositoryId",
  "runAttempt",
  "runId",
  "status",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
] as const);
const liveJobFields = Object.freeze([
  "completedAt",
  "conclusion",
  "providerJobId",
  "providerJobName",
  "startedAt",
] as const);
const liveArtifactFields = Object.freeze([
  "artifactDigest",
  "artifactId",
  "artifactName",
  "byteLength",
  "createdAt",
  "expired",
  "expiresAt",
  "runAttempt",
  "runId",
] as const);
const artifactBytesFields = Object.freeze(["artifactId", "bytes"] as const);

function refusal(...issues: readonly string[]): GithubTerminalVerificationResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactBytes(input: unknown): Uint8Array | undefined {
  try {
    if (input === null || typeof input !== "object" || nodeTypes.isProxy(input)) return undefined;
    return input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype
      ? input
      : undefined;
  } catch {
    return undefined;
  }
}

function canonicalProviderRecordBytes(
  input: unknown,
):
  | { readonly ok: true; readonly bytes: Uint8Array; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const bytes = exactBytes(input);
  if (!bytes) return { ok: false, issues: ["providerRecordBytes:exact-bytes-required"] };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, issues: ["providerRecordBytes:utf8-refused"] };
  }
  if (text.startsWith("\ufeff")) return { ok: false, issues: ["providerRecordBytes:bom-refused"] };
  let inputRecord: unknown;
  try {
    inputRecord = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["providerRecordBytes:json-refused"] };
  }
  const parsed = parseGithubConformanceProviderRecord(inputRecord);
  if (!parsed.ok) return parsed;
  if (canonicalJson(parsed.value) !== text)
    return { ok: false, issues: ["providerRecordBytes:noncanonical"] };
  return { ok: true, bytes, value: parsed.value };
}

function milliseconds(timestamp: unknown): number | undefined {
  if (typeof timestamp !== "string" || !isCanonicalTimestamp(timestamp)) return undefined;
  const value = new Date(timestamp).valueOf();
  return Number.isFinite(value) ? value : undefined;
}

function retained(recordedAt: string, expiresAt: unknown): boolean {
  try {
    const minimum = milliseconds(addCompleteDays(recordedAt, 30));
    const observed = milliseconds(expiresAt);
    return minimum !== undefined && observed !== undefined && observed >= minimum;
  } catch {
    return false;
  }
}

function manualDataRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      nodeTypes.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
    )
      return undefined;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return undefined;
      result[field] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" && isCanonicalDecimal(value) && value !== "0";
}

function exactUnknownArray(input: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (
      !Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length === 0 ||
      input.length > maximum
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const expected = new Set([
      ...Array.from({ length: input.length }, (_, index) => String(index)),
      "length",
    ]);
    if (
      keys.some((key) => typeof key !== "string") ||
      (keys as string[]).some((key) => !expected.has(key)) ||
      keys.length !== expected.size
    )
      return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function artifactByteMap(input: unknown): ReadonlyMap<string, Uint8Array> | undefined {
  const array = exactUnknownArray(input, 258);
  if (!array) return undefined;
  const result = new Map<string, Uint8Array>();
  for (const rowInput of array) {
    const row = manualDataRecord(rowInput, artifactBytesFields);
    if (!row || typeof row.artifactId !== "string") return undefined;
    const bytes = exactBytes(row.bytes);
    if (!bytes || result.has(row.artifactId)) return undefined;
    result.set(row.artifactId, bytes);
  }
  return result;
}

function parsedRows(
  input: unknown,
  fields: readonly string[],
  maximum: number,
): readonly ContractRecord[] | undefined {
  const array = snapshotClosedArray(input);
  if (!array.ok || array.value.length === 0 || array.value.length > maximum) return undefined;
  const rows: ContractRecord[] = [];
  for (const rowInput of array.value) {
    const row = snapshotClosedRecord(rowInput, fields);
    if (!row.ok) return undefined;
    rows.push(row.value);
  }
  return rows;
}

export function verifyGithubTerminalEvidence(
  input: GithubTerminalVerificationInput,
): GithubTerminalVerificationResult {
  try {
    const expected = snapshotClosedRecord(input.expected, expectedFields);
    const liveRun = snapshotClosedRecord(input.liveRun, runFields);
    const providerRun = parseGithubProviderRunContext(input.providerRun);
    const registry = parseConformanceRequiredJobRegistry(input.registry);
    const protection = parseGithubConformanceProtectionSnapshot(input.currentProtectionSnapshot);
    const providerRecord = canonicalProviderRecordBytes(input.providerRecordBytes);
    const jobs = parsedRows(input.liveJobs, liveJobFields, 259);
    const artifacts = parsedRows(input.liveArtifacts, liveArtifactFields, 258);
    const bytesByArtifact = artifactByteMap(input.artifactBytes);
    if (!expected.ok) return refusal(...expected.issues.map((issue) => `expected.${issue}`));
    if (!liveRun.ok) return refusal(...liveRun.issues.map((issue) => `liveRun.${issue}`));
    if (!providerRun.ok)
      return refusal(...providerRun.issues.map((issue) => `providerRun.${issue}`));
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    if (!protection.ok) return refusal(...protection.issues.map((issue) => `protection.${issue}`));
    if (!providerRecord.ok) return refusal(...providerRecord.issues);
    if (!jobs) return refusal("liveJobs:closed-census-required");
    if (!artifacts) return refusal("liveArtifacts:closed-census-required");
    if (!bytesByArtifact) return refusal("artifactBytes:closed-census-required");

    const issues: string[] = [];
    for (const field of expectedFields) {
      if (expected.value[field] !== providerRun.value[field])
        issues.push(`expected.${field}:provider-run-mismatch`);
      if (expected.value[field] !== liveRun.value[field])
        issues.push(`expected.${field}:live-run-mismatch`);
    }
    for (const field of ["event", "workflowPath", "workflowRef"] as const)
      if (liveRun.value[field] !== providerRun.value[field])
        issues.push(`liveRun.${field}:provider-run-mismatch`);
    if (liveRun.value.status !== "COMPLETED") issues.push("liveRun.status:not-completed");
    if (liveRun.value.conclusion !== "SUCCESS") issues.push("liveRun.conclusion:not-success");
    if (
      computeGithubConformanceProtectionDigest(protection.value) !==
      providerRun.value.protectionSnapshotDigest
    )
      issues.push("protectionSnapshotDigest:moved");
    const recordValidation = validateGithubConformanceProviderRecord(providerRecord.value, {
      aggregateDigest: String(providerRecord.value.aggregateDigest),
      providerRun: providerRun.value,
      registry: registry.value,
    });
    if (!recordValidation.ok)
      issues.push(...recordValidation.issues.map((issue) => `providerRecord.${issue}`));
    if (issues.length > 0) return refusal(...issues);

    const providerJobs = providerRecord.value.jobs as readonly ContractRecord[];
    if (jobs.length !== providerJobs.length + 1) return refusal("liveJobs:census-mismatch");
    const jobById = new Map(jobs.map((job) => [String(job.providerJobId), job]));
    if (jobById.size !== jobs.length) return refusal("liveJobs:duplicate-provider-id");
    for (const expectedJob of providerJobs) {
      const live = jobById.get(String(expectedJob.providerJobId));
      if (
        !live ||
        live.providerJobName !== expectedJob.providerJobName ||
        live.conclusion !== "SUCCESS"
      )
        return refusal(`liveJobs.${String(expectedJob.logicalJobId)}:mismatch`);
      if (
        milliseconds(live.startedAt) === undefined ||
        milliseconds(live.completedAt) === undefined
      )
        return refusal(`liveJobs.${String(expectedJob.logicalJobId)}:timestamp-invalid`);
    }
    const recordJobs = jobs.filter((job) => job.providerJobName === "Conformance / record");
    if (
      recordJobs.length !== 1 ||
      recordJobs[0]!.conclusion !== "SUCCESS" ||
      !positiveDecimal(recordJobs[0]!.providerJobId)
    )
      return refusal("liveJobs:record-job-census-mismatch");
    const recordJob = recordJobs[0]!;
    for (const job of jobs)
      if (
        !providerJobs.some((expectedJob) => expectedJob.providerJobId === job.providerJobId) &&
        job !== recordJob
      )
        return refusal("liveJobs:unknown-job");

    const providerArtifacts = providerRecord.value.artifacts as readonly ContractRecord[];
    if (artifacts.length !== providerArtifacts.length + 1)
      return refusal("liveArtifacts:census-mismatch");
    if (bytesByArtifact.size !== artifacts.length) return refusal("artifactBytes:census-mismatch");
    const artifactById = new Map(
      artifacts.map((artifact) => [String(artifact.artifactId), artifact]),
    );
    if (artifactById.size !== artifacts.length)
      return refusal("liveArtifacts:duplicate-provider-id");
    const observations = new Map<
      string,
      { readonly environment: ContractRecord; readonly rawArtifactManifest: ContractRecord }
    >();
    let aggregate:
      | { readonly aggregate: ContractRecord; readonly receipts: readonly ContractRecord[] }
      | undefined;
    for (const expectedArtifact of providerArtifacts) {
      const id = String(expectedArtifact.artifactId);
      const live = artifactById.get(id);
      const bytes = bytesByArtifact.get(id);
      if (!live || !bytes) return refusal(`liveArtifacts.${id}:missing`);
      for (const field of [
        "artifactDigest",
        "artifactId",
        "artifactName",
        "byteLength",
        "expiresAt",
      ] as const)
        if (live[field] !== expectedArtifact[field])
          return refusal(`liveArtifacts.${id}.${field}:mismatch`);
      if (
        live.runId !== providerRecord.value.runId ||
        live.runAttempt !== providerRecord.value.runAttempt ||
        live.expired !== false ||
        milliseconds(live.createdAt) === undefined
      )
        return refusal(`liveArtifacts.${id}:run-or-state-mismatch`);
      const outer = verifyGithubArtifactIdentity(
        bytes,
        String(expectedArtifact.artifactDigest),
        String(expectedArtifact.byteLength),
      );
      if (!outer.ok) return refusal(...outer.issues.map((issue) => `liveArtifacts.${id}.${issue}`));
      if (expectedArtifact.role === "OBSERVATION") {
        const verified = verifyGithubObservationArchive(bytes);
        if (!verified.ok)
          return refusal(...verified.issues.map((issue) => `liveArtifacts.${id}.${issue}`));
        observations.set(String(expectedArtifact.logicalJobId), verified);
      } else {
        const verified = verifyGithubAggregateArchive(bytes, registry.value);
        if (!verified.ok)
          return refusal(...verified.issues.map((issue) => `liveArtifacts.${id}.${issue}`));
        aggregate = verified;
      }
    }
    if (!aggregate || observations.size !== (registry.value.jobs as readonly unknown[]).length)
      return refusal("providerArtifacts:role-census-mismatch");
    if (
      computeConformanceRecordDigest("conformance-aggregate/v1", aggregate.aggregate) !==
      providerRecord.value.aggregateDigest
    )
      return refusal("aggregateDigest:mismatch");
    for (const receipt of aggregate.receipts) {
      const observation = observations.get(String(receipt.jobId));
      if (!observation) return refusal(`observation.${String(receipt.jobId)}:missing`);
      if (
        computeConformanceRecordDigest("conformance-environment/v1", observation.environment) !==
          receipt.environmentDigest ||
        computeConformanceRecordDigest(
          "conformance-raw-artifact-manifest/v1",
          observation.rawArtifactManifest,
        ) !== receipt.rawArtifactManifestDigest
      )
        return refusal(`observation.${String(receipt.jobId)}:receipt-mismatch`);
    }

    const recordArtifactName = `conformance-${String(providerRecord.value.runId)}-${String(providerRecord.value.runAttempt)}-provider-record.json`;
    const recordArtifacts = artifacts.filter(
      (artifact) => artifact.artifactName === recordArtifactName,
    );
    if (recordArtifacts.length !== 1) return refusal("providerRecordArtifact:census-mismatch");
    const recordArtifact = recordArtifacts[0]!;
    const recordArtifactId = String(recordArtifact.artifactId);
    const recordBytes = bytesByArtifact.get(recordArtifactId);
    if (!recordBytes || !Buffer.from(recordBytes).equals(Buffer.from(providerRecord.bytes)))
      return refusal("providerRecordArtifact:bytes-object-mismatch");
    if (
      !positiveDecimal(recordArtifact.artifactId) ||
      recordArtifact.artifactDigest !== sha256Bytes(providerRecord.bytes) ||
      recordArtifact.byteLength !== String(providerRecord.bytes.byteLength) ||
      recordArtifact.runId !== providerRecord.value.runId ||
      recordArtifact.runAttempt !== providerRecord.value.runAttempt ||
      recordArtifact.expired !== false ||
      !retained(String(providerRecord.value.recordedAt), recordArtifact.expiresAt)
    )
      return refusal("providerRecordArtifact:identity-or-retention-mismatch");
    for (const artifact of artifacts)
      if (
        !providerArtifacts.some(
          (expectedArtifact) => expectedArtifact.artifactId === artifact.artifactId,
        ) &&
        artifact !== recordArtifact
      )
        return refusal("liveArtifacts:unknown-artifact");

    const started = milliseconds(recordJob.startedAt);
    const recorded = milliseconds(providerRecord.value.recordedAt);
    const created = milliseconds(recordArtifact.createdAt);
    const completed = milliseconds(recordJob.completedAt);
    if (
      started === undefined ||
      recorded === undefined ||
      created === undefined ||
      completed === undefined ||
      !(started <= recorded && recorded <= created && created <= completed)
    )
      return refusal("providerRecordArtifact:provider-time-order-mismatch");
    return {
      ok: true,
      providerRecordDigest: computeGithubConformanceProviderRecordDigest(providerRecord.value),
      providerRunDigest: computeGithubProviderRunDigest(providerRun.value),
    };
  } catch {
    return refusal("terminalEvidence:unreadable");
  }
}

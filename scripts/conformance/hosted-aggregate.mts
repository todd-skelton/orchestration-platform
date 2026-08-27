import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";
import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  createConformanceJobEvidence,
  iss002VectorIds,
  parseCanonicalConformanceBytes,
  reduceConformanceAggregate,
  serializeConformanceContract,
  sha256Bytes,
} from "../../packages/conformance/src/index.js";
import {
  hostedIss002StableInputsMatchContext,
  loadHostedIss002StableInputs,
  parseHostedObservationContext,
} from "./hosted-observation.mjs";
import type { HostedPlanContext } from "./hosted-plan.mjs";

export type HostedAggregateResult =
  | { readonly ok: true; readonly aggregate: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface HostedAggregateInput {
  readonly context: unknown;
  readonly downloadRoot: string;
  readonly outputRoot: string;
  readonly runnerTemp: string;
  readonly stableRoot: string;
}

interface ParsedReport {
  readonly maximumWalkDurationNanoseconds: string | null;
  readonly normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
}

const observationFiles = Object.freeze([
  "environment",
  "environment-record.json",
  "raw-manifest.json",
  "report",
  "stderr",
  "stdout",
] as const);
const reportFields = Object.freeze([
  "executedVectors",
  "jobId",
  "maximumWalkDurationNanoseconds",
  "normalizedResult",
  "runnerToken",
  "schemaVersion",
  "suiteId",
  "walkDurationsNanoseconds",
]);
const executionFields = Object.freeze(["fixtureId", "normalizedResult"]);
const results = Object.freeze(["FAIL", "PASS", "UNSUPPORTED"] as const);

function refusal(...issues: readonly string[]): HostedAggregateResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
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
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
  }
  return input as Readonly<Record<string, unknown>>;
}

function exactArray(input: unknown, length: number): readonly unknown[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length !== length
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const expected = new Set([...Array.from({ length }, (_, index) => String(index)), "length"]);
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expected.has(key)) ||
    Reflect.ownKeys(descriptors).length !== expected.size
  )
    return undefined;
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values.push(descriptor.value);
  }
  return Object.freeze(values);
}

function canonicalDecimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9][0-9]*)$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function parseReport(bytes: Uint8Array, jobId: string): ParsedReport | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const input: unknown = JSON.parse(text);
    if (canonicalJson(input) !== text) return undefined;
    const report = exactRecord(input, reportFields);
    const vectorRows = exactArray(report?.executedVectors, iss002VectorIds.length);
    if (
      !report ||
      !vectorRows ||
      report.jobId !== jobId ||
      report.runnerToken !== "ISS002_CONTRACTS" ||
      report.schemaVersion !== "iss002-conformance-raw-report/v1" ||
      report.suiteId !== "iss002-contracts"
    )
      return undefined;
    const vectorResults: Array<(typeof results)[number]> = [];
    for (let index = 0; index < vectorRows.length; index += 1) {
      const row = exactRecord(vectorRows[index], executionFields);
      if (
        !row ||
        row.fixtureId !== iss002VectorIds[index] ||
        typeof row.normalizedResult !== "string" ||
        !results.includes(row.normalizedResult as (typeof results)[number])
      )
        return undefined;
      vectorResults.push(row.normalizedResult as (typeof results)[number]);
    }
    const derivedResult = vectorResults.includes("FAIL")
      ? "FAIL"
      : vectorResults.includes("UNSUPPORTED")
        ? "UNSUPPORTED"
        : "PASS";
    if (report.normalizedResult !== derivedResult) return undefined;
    const walkResult = vectorResults[vectorResults.length - 1]!;
    if (walkResult !== "PASS")
      return report.walkDurationsNanoseconds === null &&
        report.maximumWalkDurationNanoseconds === null
        ? { maximumWalkDurationNanoseconds: null, normalizedResult: derivedResult }
        : undefined;
    const durations = exactArray(report.walkDurationsNanoseconds, 3);
    if (
      !durations ||
      durations.some((value) => !canonicalDecimal(value) || BigInt(value) > 5_000_000_000n)
    )
      return undefined;
    const maximum = (durations as readonly string[]).reduce((current, value) =>
      BigInt(value) > BigInt(current) ? value : current,
    );
    return report.maximumWalkDurationNanoseconds === maximum
      ? { maximumWalkDurationNanoseconds: maximum, normalizedResult: derivedResult }
      : undefined;
  } catch {
    return undefined;
  }
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function sameDirectory(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function exactObservationFiles(
  root: string,
): Promise<ReadonlyMap<string, Uint8Array> | undefined> {
  const identity = await lstat(root);
  if (!identity.isDirectory() || identity.isSymbolicLink()) return undefined;
  const names = await readdir(root);
  if (names.sort().join("\0") !== [...observationFiles].sort().join("\0")) return undefined;
  const files = new Map<string, Uint8Array>();
  for (const name of observationFiles) {
    const path = resolve(root, name);
    const fileIdentity = await lstat(path);
    if (!fileIdentity.isFile() || fileIdentity.isSymbolicLink()) return undefined;
    files.set(name, Uint8Array.from(await readFile(path)));
  }
  return files;
}

async function readObservationEvidence(
  root: string,
  jobId: string,
  context: HostedPlanContext,
  registry: ContractRecord,
): Promise<
  | {
      readonly environment: ContractRecord;
      readonly rawArtifactManifest: ContractRecord;
      readonly receipt: ContractRecord;
    }
  | undefined
> {
  const files = await exactObservationFiles(root);
  if (!files) return undefined;
  const environment = parseCanonicalConformanceBytes(
    "conformance-environment/v1",
    files.get("environment-record.json")!,
  );
  const manifest = parseCanonicalConformanceBytes(
    "conformance-raw-artifact-manifest/v1",
    files.get("raw-manifest.json")!,
  );
  const report = parseReport(files.get("report")!, jobId);
  if (!environment.ok || !manifest.ok || !report) return undefined;
  const raw = Object.freeze({
    environment: files.get("environment")!,
    report: files.get("report")!,
    stderr: files.get("stderr")!,
    stdout: files.get("stdout")!,
  });
  const entries = manifest.value.entries as readonly ContractRecord[];
  for (const [name, bytes] of Object.entries(raw)) {
    const row = entries.find((entry) => entry.name === name);
    if (
      !row ||
      row.byteLength !== String(bytes.byteLength) ||
      row.sha256Digest !== sha256Bytes(bytes)
    )
      return undefined;
  }
  const created = createConformanceJobEvidence({
    candidateSubjectDigest: context.candidateSubjectDigest,
    contractVersionsDigest: context.contractVersionsDigest,
    environment: environment.value,
    harnessBundleDigest: context.harnessBundleDigest,
    jobId,
    maximumWalkDurationNanoseconds: report.maximumWalkDurationNanoseconds,
    normalizedResult: report.normalizedResult,
    providerRunDigest: context.providerRunDigest,
    rawArtifacts: raw,
    registry,
    testBundleDigest: context.testBundleDigest,
  });
  if (
    !created.ok ||
    computeConformanceRecordDigest(
      "conformance-raw-artifact-manifest/v1",
      created.rawArtifactManifest,
    ) !== computeConformanceRecordDigest("conformance-raw-artifact-manifest/v1", manifest.value)
  )
    return undefined;
  return Object.freeze({
    environment: created.environment,
    rawArtifactManifest: manifest.value,
    receipt: created.receipt,
  });
}

async function writeAggregate(
  outputRoot: string,
  jobs: readonly ContractRecord[],
  aggregate: ContractRecord,
  evidence: readonly Readonly<{ readonly receipt: ContractRecord }>[],
): Promise<boolean> {
  let identity: BigIntStats | undefined;
  let complete = false;
  try {
    await mkdir(outputRoot, { recursive: false });
    identity = await lstat(outputRoot, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) return false;
    const receiptsRoot = resolve(outputRoot, "receipts");
    await mkdir(receiptsRoot);
    const aggregateBytes = serializeConformanceContract("conformance-aggregate/v1", aggregate);
    if (!aggregateBytes.ok) return false;
    await writeFile(resolve(outputRoot, "aggregate.json"), aggregateBytes.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    for (let index = 0; index < jobs.length; index += 1) {
      const jobId = String(jobs[index]!.jobId);
      const receipt = serializeConformanceContract(
        "conformance-job-receipt/v1",
        evidence[index]!.receipt,
      );
      if (!receipt.ok) return false;
      await writeFile(resolve(receiptsRoot, `${jobId}.json`), receipt.bytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    complete =
      (await readdir(outputRoot)).sort().join("\0") === "aggregate.json\0receipts" &&
      (await readdir(receiptsRoot)).sort().join("\0") ===
        jobs
          .map((job) => `${String(job.jobId)}.json`)
          .sort()
          .join("\0");
    return complete;
  } catch {
    return false;
  } finally {
    if (identity && !complete)
      try {
        const current = await lstat(outputRoot, { bigint: true });
        if (!sameDirectory(identity, current)) throw new TypeError("aggregate-output:moved");
        await rm(outputRoot, { recursive: true });
      } catch {
        return false;
      }
  }
}

export async function runHostedAggregateComposition(
  input: HostedAggregateInput,
): Promise<HostedAggregateResult> {
  try {
    const context = parseHostedObservationContext(input.context);
    if (
      !context ||
      ![input.downloadRoot, input.outputRoot, input.runnerTemp, input.stableRoot].every(
        (path) => typeof path === "string" && isAbsolute(path),
      )
    )
      return refusal("aggregate-runner:input-refused");
    const outputParentInput = resolve(input.outputRoot, "..");
    const [downloadRoot, outputParent, runnerTemp, stableRoot, ...identities] = await Promise.all([
      realpath(input.downloadRoot),
      realpath(outputParentInput),
      realpath(input.runnerTemp),
      realpath(input.stableRoot),
      lstat(input.downloadRoot),
      lstat(outputParentInput),
      lstat(input.runnerTemp),
      lstat(input.stableRoot),
    ]);
    if (
      identities.some((identity) => !identity.isDirectory() || identity.isSymbolicLink()) ||
      !within(runnerTemp, downloadRoot) ||
      !within(runnerTemp, outputParent) ||
      within(downloadRoot, input.outputRoot) ||
      within(stableRoot, runnerTemp) ||
      within(runnerTemp, stableRoot)
    )
      return refusal("aggregate-runner:root-separation-refused");
    const stable = await loadHostedIss002StableInputs(stableRoot);
    if (!stable || !hostedIss002StableInputsMatchContext(stable, context))
      return refusal("aggregate-runner:stable-authority-refused");
    const jobs = stable.registry.jobs as readonly ContractRecord[];
    const expectedDirectories = jobs.map(
      (job) => `conformance-${context.runId}-${context.runAttempt}-${String(job.jobId)}`,
    );
    if (
      (await readdir(downloadRoot)).sort().join("\0") !== [...expectedDirectories].sort().join("\0")
    )
      return refusal("aggregate-runner:observation-census-refused");
    const evidence = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const jobId = String(jobs[index]!.jobId);
      const value = await readObservationEvidence(
        resolve(downloadRoot, expectedDirectories[index]!),
        jobId,
        context,
        stable.registry,
      );
      if (!value) return refusal(`aggregate-runner:${jobId}:observation-refused`);
      evidence.push(value);
    }
    const reduced = reduceConformanceAggregate(stable.registry, evidence);
    if (!reduced.ok) return refusal(...reduced.issues.map((issue) => `aggregate.${issue}`));
    const stableAfter = await loadHostedIss002StableInputs(stableRoot);
    if (!stableAfter || !hostedIss002StableInputsMatchContext(stableAfter, context))
      return refusal("aggregate-runner:stable-recheck-refused");
    if (!(await writeAggregate(input.outputRoot, jobs, reduced.value, evidence)))
      return refusal("aggregate-runner:output-refused");
    return { ok: true, aggregate: reduced.value };
  } catch {
    return refusal("aggregate-runner:unreadable");
  }
}

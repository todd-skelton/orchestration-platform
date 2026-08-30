import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import { types as nodeTypes } from "node:util";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  computeConformanceRecordDigest,
  parseConformanceRequiredJobRegistry,
} from "../../packages/conformance/src/index.js";
import {
  computeGithubConformanceProtectedRefDigest,
  parseGithubConformanceProtectedRef,
  parseGithubConformanceProviderRecord,
  validateGithubConformanceProviderRecord,
  verifyGithubAggregateArchive,
  verifyGithubArtifactIdentity,
  verifyGithubObservationArchive,
} from "../../packages/conformance/src/github-actions/index.js";
import { parseHostedObservationContext } from "./hosted-observation.mjs";
import {
  hostedEnvironmentMatchesContext,
  hostedStableInputsMatchContext,
  loadHostedStableInputs,
  decodeHostedObservationContext,
} from "./hosted-observation.mjs";
import {
  readGithubHostedArtifacts,
  readGithubHostedJobs,
  type GithubHostedArtifactEvidence,
  type GithubHostedJobEvidence,
} from "./hosted-record-api.mjs";

export type HostedProviderRecordResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly value: ContractRecord;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface HostedProviderJobInput {
  readonly conclusion: unknown;
  readonly providerJobId: unknown;
  readonly providerJobName: unknown;
}

export interface HostedProviderArtifactInput {
  readonly archiveBytes: unknown;
  readonly artifactDigest: unknown;
  readonly artifactId: unknown;
  readonly artifactName: unknown;
  readonly byteLength: unknown;
  readonly expiresAt: unknown;
}

export interface HostedProviderRecordInput {
  readonly artifacts: unknown;
  readonly context: unknown;
  readonly currentProtectedRef: unknown;
  readonly jobs: unknown;
  readonly recordedAt: unknown;
  readonly registry: unknown;
}

const jobFields = Object.freeze(["conclusion", "providerJobId", "providerJobName"] as const);
const artifactFields = Object.freeze([
  "archiveBytes",
  "artifactDigest",
  "artifactId",
  "artifactName",
  "byteLength",
  "expiresAt",
] as const);

function refusal(...issues: readonly string[]): HostedProviderRecordResult {
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

function exactArray(input: unknown, maximum: number): readonly unknown[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype
  )
    return undefined;
  if (input.length === 0 || input.length > maximum) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const expected = new Set([
    ...Array.from({ length: input.length }, (_, index) => String(index)),
    "length",
  ]);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string" || !expected.has(key)) ||
    keys.length !== expected.size
  )
    return undefined;
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values.push(descriptor.value);
  }
  return values;
}

function exactBytes(input: unknown): Uint8Array | undefined {
  return input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype
    ? input
    : undefined;
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function providerRun(context: NonNullable<ReturnType<typeof parseHostedObservationContext>>) {
  return Object.freeze({
    candidateRevision: context.candidateRevision,
    candidateSubjectDigest: context.candidateSubjectDigest,
    event: context.event,
    harnessBundleDigest: context.harnessBundleDigest,
    protectedRefDigest: context.protectedRefDigest,
    repositoryId: context.repositoryId,
    requiredJobRegistryDigest: context.requiredJobRegistryDigest,
    runAttempt: context.runAttempt,
    runId: context.runId,
    testBundleDigest: context.testBundleDigest,
    workflowPath: context.workflowPath,
    workflowRef: context.workflowRef,
    workflowRevision: context.workflowRevision,
  });
}

export function createHostedProviderRecord(
  input: HostedProviderRecordInput,
): HostedProviderRecordResult {
  try {
    const context = parseHostedObservationContext(input.context);
    const registry = parseConformanceRequiredJobRegistry(input.registry);
    const protectedRef = parseGithubConformanceProtectedRef(input.currentProtectedRef);
    if (!context) return refusal("context:refused");
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    if (!protectedRef.ok)
      return refusal(...protectedRef.issues.map((issue) => `protectedRef.${issue}`));
    if (
      computeGithubConformanceProtectedRefDigest(protectedRef.value) !== context.protectedRefDigest
    )
      return refusal("protectedRefDigest:moved");
    if (
      computeConformanceRecordDigest("conformance-required-job-registry/v1", registry.value) !==
      context.requiredJobRegistryDigest
    )
      return refusal("requiredJobRegistryDigest:mismatch");

    const registryJobs = registry.value.jobs as readonly ContractRecord[];
    const expectedJobs = [
      Object.freeze({
        logicalJobId: "aggregate",
        providerJobName: "Conformance / aggregate",
        role: "AGGREGATE",
      }),
      ...registryJobs.map((job) =>
        Object.freeze({
          logicalJobId: String(job.jobId),
          providerJobName: `Conformance / observation / ${String(job.jobId)}`,
          role: "OBSERVATION",
        }),
      ),
      Object.freeze({
        logicalJobId: "plan",
        providerJobName: "Conformance / plan",
        role: "PLAN",
      }),
    ].sort((left, right) => utf8Compare(left.logicalJobId, right.logicalJobId));
    const jobsInput = exactArray(input.jobs, 258);
    if (!jobsInput || jobsInput.length !== expectedJobs.length)
      return refusal("jobs:census-mismatch");
    const jobsByName = new Map<string, Readonly<Record<string, unknown>>>();
    for (const rowInput of jobsInput) {
      const row = exactRecord(rowInput, jobFields);
      if (!row || typeof row.providerJobName !== "string" || jobsByName.has(row.providerJobName))
        return refusal("jobs:closed-unique-census-required");
      jobsByName.set(row.providerJobName, row);
    }
    const jobs: ContractRecord[] = [];
    for (const expected of expectedJobs) {
      const row = jobsByName.get(expected.providerJobName);
      if (!row || row.conclusion !== "SUCCESS")
        return refusal(`jobs.${expected.logicalJobId}:missing-or-unsuccessful`);
      jobs.push(
        Object.freeze({
          conclusion: row.conclusion,
          logicalJobId: expected.logicalJobId,
          providerJobId: row.providerJobId,
          providerJobName: row.providerJobName,
          role: expected.role,
        }) as ContractRecord,
      );
    }

    const prefix = `conformance-${context.runId}-${context.runAttempt}-`;
    const expectedArtifacts = [
      Object.freeze({
        artifactName: `${prefix}aggregate`,
        logicalJobId: "aggregate",
        role: "AGGREGATE",
      }),
      ...registryJobs.map((job) =>
        Object.freeze({
          artifactName: `${prefix}${String(job.jobId)}`,
          logicalJobId: String(job.jobId),
          role: "OBSERVATION",
        }),
      ),
    ].sort((left, right) => utf8Compare(left.artifactName, right.artifactName));
    const artifactsInput = exactArray(input.artifacts, 257);
    if (!artifactsInput || artifactsInput.length !== expectedArtifacts.length)
      return refusal("artifacts:census-mismatch");
    const artifactsByName = new Map<string, Readonly<Record<string, unknown>>>();
    for (const rowInput of artifactsInput) {
      const row = exactRecord(rowInput, artifactFields);
      if (!row || typeof row.artifactName !== "string" || artifactsByName.has(row.artifactName))
        return refusal("artifacts:closed-unique-census-required");
      artifactsByName.set(row.artifactName, row);
    }
    const artifacts: ContractRecord[] = [];
    let aggregateDigest: string | undefined;
    for (const expected of expectedArtifacts) {
      const row = artifactsByName.get(expected.artifactName);
      const bytes = row && exactBytes(row.archiveBytes);
      if (
        !row ||
        !bytes ||
        typeof row.artifactDigest !== "string" ||
        typeof row.artifactId !== "string" ||
        typeof row.byteLength !== "string" ||
        typeof row.expiresAt !== "string"
      )
        return refusal(`artifacts.${expected.logicalJobId}:missing-or-malformed`);
      const identity = verifyGithubArtifactIdentity(bytes, row.artifactDigest, row.byteLength);
      if (!identity.ok)
        return refusal(
          ...identity.issues.map((issue) => `artifacts.${expected.logicalJobId}.${issue}`),
        );
      if (expected.role === "AGGREGATE") {
        const archive = verifyGithubAggregateArchive(bytes, registry.value);
        if (!archive.ok)
          return refusal(
            ...archive.issues.map((issue) => `artifacts.${expected.logicalJobId}.${issue}`),
          );
        if (
          archive.aggregate.providerRunDigest !== context.providerRunDigest ||
          archive.aggregate.candidateSubjectDigest !== context.candidateSubjectDigest ||
          archive.aggregate.harnessBundleDigest !== context.harnessBundleDigest ||
          archive.aggregate.testBundleDigest !== context.testBundleDigest
        )
          return refusal("aggregate:context-mismatch");
        aggregateDigest = computeConformanceRecordDigest(
          "conformance-aggregate/v1",
          archive.aggregate,
        );
      } else {
        const archive = verifyGithubObservationArchive(bytes);
        if (!archive.ok)
          return refusal(
            ...archive.issues.map((issue) => `artifacts.${expected.logicalJobId}.${issue}`),
          );
      }
      artifacts.push(
        Object.freeze({
          artifactDigest: row.artifactDigest,
          artifactId: row.artifactId,
          artifactName: row.artifactName,
          byteLength: row.byteLength,
          expiresAt: row.expiresAt,
          logicalJobId: expected.logicalJobId,
          role: expected.role,
        }) as ContractRecord,
      );
    }
    if (!aggregateDigest) return refusal("aggregate:missing");

    const run = providerRun(context);
    const record = Object.freeze({
      aggregateDigest,
      artifacts: Object.freeze(artifacts),
      candidateRevision: context.candidateRevision,
      candidateSubjectDigest: context.candidateSubjectDigest,
      event: context.event,
      harnessBundleDigest: context.harnessBundleDigest,
      jobs: Object.freeze(jobs),
      protectedRefDigest: context.protectedRefDigest,
      recordedAt: input.recordedAt,
      repositoryId: context.repositoryId,
      requiredJobRegistryDigest: context.requiredJobRegistryDigest,
      runAttempt: context.runAttempt,
      runId: context.runId,
      schemaVersion: "github-conformance-provisional-provider-record/v1",
      testBundleDigest: context.testBundleDigest,
      workflowPath: context.workflowPath,
      workflowRef: context.workflowRef,
      workflowRevision: context.workflowRevision,
    });
    const parsed = parseGithubConformanceProviderRecord(record);
    if (!parsed.ok) return refusal(...parsed.issues.map((issue) => `providerRecord.${issue}`));
    const validated = validateGithubConformanceProviderRecord(parsed.value, {
      aggregateDigest,
      providerRun: run,
      registry: registry.value,
    });
    if (!validated.ok)
      return refusal(...validated.issues.map((issue) => `providerRecord.${issue}`));
    return {
      ok: true,
      bytes: new TextEncoder().encode(canonicalJson(parsed.value)),
      value: parsed.value,
    };
  } catch {
    return refusal("providerRecord:unreadable");
  }
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export interface HostedRecordRuntime {
  readonly readArtifacts: (input: {
    readonly context: NonNullable<ReturnType<typeof parseHostedObservationContext>>;
    readonly registry: unknown;
    readonly token: string;
  }) => Promise<
    | { readonly ok: true; readonly value: readonly GithubHostedArtifactEvidence[] }
    | { readonly ok: false; readonly issues: readonly string[] }
  >;
  readonly readJobs: (input: {
    readonly context: NonNullable<ReturnType<typeof parseHostedObservationContext>>;
    readonly registry: unknown;
    readonly token: string;
  }) => Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly jobs: readonly GithubHostedJobEvidence[];
          readonly recordedAt: string;
        };
      }
    | { readonly ok: false; readonly issues: readonly string[] }
  >;
}

const githubRecordRuntime: HostedRecordRuntime = Object.freeze({
  readArtifacts: readGithubHostedArtifacts,
  readJobs: readGithubHostedJobs,
});

export async function runHostedRecord(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runtime: HostedRecordRuntime = githubRecordRuntime,
): Promise<void> {
  const encodedContext = environmentValue(environment, "CONFORMANCE_PLAN_CONTEXT");
  const outputRootInput = environmentValue(environment, "CONFORMANCE_OUTPUT_ROOT");
  const runnerTempInput = environmentValue(environment, "RUNNER_TEMP");
  const token = environmentValue(environment, "GITHUB_TOKEN");
  const context = encodedContext && decodeHostedObservationContext(encodedContext);
  if (!context || !outputRootInput || !runnerTempInput || !token)
    throw new Error("record:required-input-refused");
  if (!hostedEnvironmentMatchesContext(environment, context))
    throw new Error("record:provider-context-mismatch");
  const stableRoot = resolve(process.cwd());
  const outputRoot = resolve(outputRootInput);
  const runnerTemp = resolve(runnerTempInput);
  if (
    !isAbsolute(outputRootInput) ||
    !isAbsolute(runnerTempInput) ||
    within(stableRoot, outputRoot) ||
    !within(runnerTemp, outputRoot) ||
    outputRoot === runnerTemp
  )
    throw new Error("record:external-output-root-required");
  const stable = await loadHostedStableInputs(stableRoot);
  if (!stable || !hostedStableInputsMatchContext(stable, context))
    throw new Error("record:stable-inputs-moved");

  const artifacts = await runtime.readArtifacts({ context, registry: stable.registry, token });
  if (!artifacts.ok) throw new Error(artifacts.issues.join(","));
  const jobs = await runtime.readJobs({ context, registry: stable.registry, token });
  if (!jobs.ok) throw new Error(jobs.issues.join(","));
  const record = createHostedProviderRecord({
    artifacts: artifacts.value,
    context,
    currentProtectedRef: Object.freeze({
      refProtected: true,
      schemaVersion: "github-conformance-protected-ref/v1",
      targetRef: "refs/heads/main",
    }),
    jobs: jobs.value.jobs,
    recordedAt: jobs.value.recordedAt,
    registry: stable.registry,
  });
  if (!record.ok) throw new Error(record.issues.join(","));

  let created = false;
  try {
    await mkdir(outputRoot, { recursive: false });
    created = true;
    const identity = await lstat(outputRoot);
    if (!identity.isDirectory() || identity.isSymbolicLink())
      throw new Error("record:output-root-refused");
    const filename = `conformance-${context.runId}-${context.runAttempt}-provider-record.json`;
    await writeFile(resolve(outputRoot, filename), record.bytes, { flag: "wx" });
  } catch (error) {
    if (created) await rm(outputRoot, { recursive: true, force: false });
    throw error;
  }
}

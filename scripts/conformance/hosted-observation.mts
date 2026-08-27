import type { BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { types as nodeTypes } from "node:util";
import {
  canonicalJson,
  schemaVersions,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  createIss002ContractVersions,
  createIss002ObservationArtifacts,
  createIss002RequiredJobRegistry,
  createIss002StableBundleManifests,
  createIss002VectorCensus,
  runIss002StableHandler,
  type Iss002ObservationArtifactsResult,
  type Iss002StableHandlerResult,
} from "../../packages/conformance/src/index.js";
import { runIss002NativeCandidateObservation } from "../../packages/conformance/src/iss002-native-candidate-walk.js";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import { withHostedCandidateSource } from "./hosted-candidate.mjs";
import { loadHostedCandidateSnapshot, type HostedPlanContext } from "./hosted-plan.mjs";
import {
  executeIss002ContractSelection,
  prepareIss002WorkspaceDependencies,
} from "./iss002-executor.mjs";
import { withIss002ExecutionWorkspace } from "./iss002-workspace.mjs";

export type HostedObservationResult =
  | {
      readonly ok: true;
      readonly normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface HostedObservationInput {
  readonly candidateRoot: string;
  readonly context: unknown;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly jobId: string;
  readonly outputRoot: string;
  readonly runnerTemp: string;
  readonly runnerToken: string;
  readonly stableRoot: string;
}

const contextFields = Object.freeze([
  "candidateRevision",
  "candidateSubjectDigest",
  "contractVersionsDigest",
  "event",
  "harnessBundleDigest",
  "protectionSnapshotDigest",
  "providerRunDigest",
  "repository",
  "repositoryId",
  "requiredJobRegistryDigest",
  "runAttempt",
  "runId",
  "schemaVersion",
  "testBundleDigest",
  "vectorCensusDigest",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
]);
const digestPattern = /^[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{40}$/;
const positiveDecimalPattern = /^[1-9][0-9]*$/;

function refusal(...issues: readonly string[]): HostedObservationResult {
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

function safePositiveDecimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    positiveDecimalPattern.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

export function parseHostedObservationContext(input: unknown): HostedPlanContext | undefined {
  try {
    const record = exactRecord(input, contextFields);
    if (!record) return undefined;
    for (const field of [
      "candidateSubjectDigest",
      "contractVersionsDigest",
      "harnessBundleDigest",
      "protectionSnapshotDigest",
      "providerRunDigest",
      "requiredJobRegistryDigest",
      "testBundleDigest",
      "vectorCensusDigest",
    ] as const)
      if (typeof record[field] !== "string" || !digestPattern.test(record[field])) return undefined;
    if (
      typeof record.candidateRevision !== "string" ||
      !revisionPattern.test(record.candidateRevision) ||
      typeof record.workflowRevision !== "string" ||
      !revisionPattern.test(record.workflowRevision) ||
      !safePositiveDecimal(record.repositoryId) ||
      !safePositiveDecimal(record.runAttempt) ||
      !safePositiveDecimal(record.runId) ||
      typeof record.repository !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.repository) ||
      record.event !== "repository_dispatch" ||
      record.schemaVersion !== "hosted-conformance-plan-context/v1" ||
      record.workflowPath !== ".github/workflows/conformance.yml" ||
      record.workflowRef !==
        `${record.repository}/.github/workflows/conformance.yml@refs/heads/main`
    )
      return undefined;
    const provider = parseGithubProviderRunContext({
      candidateRevision: record.candidateRevision,
      candidateSubjectDigest: record.candidateSubjectDigest,
      event: record.event,
      harnessBundleDigest: record.harnessBundleDigest,
      protectionSnapshotDigest: record.protectionSnapshotDigest,
      repositoryId: record.repositoryId,
      requiredJobRegistryDigest: record.requiredJobRegistryDigest,
      runAttempt: record.runAttempt,
      runId: record.runId,
      testBundleDigest: record.testBundleDigest,
      workflowPath: record.workflowPath,
      workflowRef: record.workflowRef,
      workflowRevision: record.workflowRevision,
    });
    if (!provider.ok || computeGithubProviderRunDigest(provider.value) !== record.providerRunDigest)
      return undefined;
    return Object.freeze({ ...record }) as unknown as HostedPlanContext;
  } catch {
    return undefined;
  }
}

export function decodeHostedObservationContext(input: string): HostedPlanContext | undefined {
  try {
    if (typeof input !== "string" || !/^[A-Za-z0-9_-]+$/.test(input)) return undefined;
    const bytes = Buffer.from(input, "base64url");
    if (bytes.toString("base64url") !== input) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (canonicalJson(value) !== text) return undefined;
    return parseHostedObservationContext(value);
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

async function filesystemProfile(runnerTemp: string): Promise<Uint8Array> {
  const root = await mkdtemp(resolve(runnerTemp, "orchestration-filesystem-profile-"));
  const identity = await lstat(root, { bigint: true });
  let caseSensitive: boolean;
  try {
    await writeFile(resolve(root, "Case-Probe"), "", { flag: "wx" });
    try {
      await lstat(resolve(root, "case-probe"));
      caseSensitive = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      caseSensitive = true;
    }
  } finally {
    const current = await lstat(root, { bigint: true });
    if (!sameDirectory(identity, current)) throw new TypeError("filesystem-profile:root-moved");
    await rm(root, { recursive: true });
  }
  return new TextEncoder().encode(canonicalJson({ caseSensitive, separator: sep }));
}

async function environmentInputs(
  environment: Readonly<Record<string, string | undefined>>,
  runnerTemp: string,
  stableRoot: string,
): Promise<
  | {
      readonly abiBytes: Uint8Array;
      readonly architecture: "ARM64" | "X64";
      readonly environmentBytes: Uint8Array;
      readonly filesystemProfileBytes: Uint8Array;
      readonly nodeVersion: string;
      readonly operatingSystem: "LINUX" | "MACOS" | "WINDOWS";
      readonly packageManagerVersion: string;
    }
  | undefined
> {
  const operatingSystem = { Linux: "LINUX", macOS: "MACOS", Windows: "WINDOWS" }[
    environment.RUNNER_OS ?? ""
  ] as "LINUX" | "MACOS" | "WINDOWS" | undefined;
  const expectedPlatform = { LINUX: "linux", MACOS: "darwin", WINDOWS: "win32" }[
    operatingSystem ?? "LINUX"
  ];
  const architecture = { ARM64: "ARM64", X64: "X64" }[environment.RUNNER_ARCH ?? ""] as
    "ARM64" | "X64" | undefined;
  const expectedArchitecture = architecture === "ARM64" ? "arm64" : "x64";
  const rootManifest = JSON.parse(await readFile(resolve(stableRoot, "package.json"), "utf8")) as {
    readonly packageManager?: unknown;
  };
  const packageManagerMatch =
    typeof rootManifest.packageManager === "string"
      ? rootManifest.packageManager.match(/^pnpm@(11\.[0-9]+\.[0-9]+)$/)
      : undefined;
  if (
    !operatingSystem ||
    !architecture ||
    process.platform !== expectedPlatform ||
    process.arch !== expectedArchitecture ||
    typeof environment.ImageOS !== "string" ||
    environment.ImageOS.length === 0 ||
    typeof environment.ImageVersion !== "string" ||
    environment.ImageVersion.length === 0 ||
    !packageManagerMatch ||
    typeof process.versions.modules !== "string" ||
    typeof process.versions.napi !== "string"
  )
    return undefined;
  return Object.freeze({
    abiBytes: new TextEncoder().encode(
      canonicalJson({ modules: process.versions.modules, napi: process.versions.napi }),
    ),
    architecture,
    environmentBytes: new TextEncoder().encode(
      canonicalJson({
        imageOS: environment.ImageOS,
        imageVersion: environment.ImageVersion,
        runnerArchitecture: environment.RUNNER_ARCH,
        runnerOperatingSystem: environment.RUNNER_OS,
        schemaVersion: "github-hosted-environment-inventory/v1",
      }),
    ),
    filesystemProfileBytes: await filesystemProfile(runnerTemp),
    nodeVersion: process.versions.node,
    operatingSystem,
    packageManagerVersion: packageManagerMatch[1]!,
  });
}

async function stableInputs(stableRoot: string) {
  const bundles = await createIss002StableBundleManifests(stableRoot);
  if (!bundles.ok) return undefined;
  const generatorBytes = Uint8Array.from(
    await readFile(resolve(stableRoot, "packages/conformance/src/iss002-vector-generator.mjs")),
  );
  const vectorCensus = createIss002VectorCensus(generatorBytes);
  const contractVersions = createIss002ContractVersions(schemaVersions);
  const registry = createIss002RequiredJobRegistry(vectorCensus);
  return Object.freeze({
    bundles,
    contractVersionsDigest: computeConformanceRecordDigest(
      "conformance-contract-versions/v1",
      contractVersions,
    ),
    harnessBundleDigest: computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      bundles.harnessManifest,
    ),
    registry,
    requiredJobRegistryDigest: computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      registry,
    ),
    testBundleDigest: computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      bundles.testBundleManifest,
    ),
    vectorCensus,
    vectorCensusDigest: computeConformanceRecordDigest(
      "conformance-vector-census/v1",
      vectorCensus,
    ),
  });
}

function stableMatchesContext(
  stable: NonNullable<Awaited<ReturnType<typeof stableInputs>>>,
  context: HostedPlanContext,
): boolean {
  return (
    stable.contractVersionsDigest === context.contractVersionsDigest &&
    stable.harnessBundleDigest === context.harnessBundleDigest &&
    stable.requiredJobRegistryDigest === context.requiredJobRegistryDigest &&
    stable.testBundleDigest === context.testBundleDigest &&
    stable.vectorCensusDigest === context.vectorCensusDigest
  );
}

async function writeObservation(
  outputRoot: string,
  artifacts: Extract<Iss002ObservationArtifactsResult, { readonly ok: true }>,
): Promise<boolean> {
  let identity: BigIntStats | undefined;
  let complete = false;
  try {
    await mkdir(outputRoot, { recursive: false });
    identity = await lstat(outputRoot, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) return false;
    const files = Object.freeze({
      environment: artifacts.environmentBytes,
      "environment-record.json": artifacts.environmentRecordBytes,
      "raw-manifest.json": artifacts.rawManifestBytes,
      report: artifacts.reportBytes,
      stderr: artifacts.stderrBytes,
      stdout: artifacts.stdoutBytes,
    });
    for (const [name, bytes] of Object.entries(files))
      await writeFile(resolve(outputRoot, name), bytes, { flag: "wx", mode: 0o600 });
    complete =
      (await readdir(outputRoot)).sort().join("\0") ===
      "environment\0environment-record.json\0raw-manifest.json\0report\0stderr\0stdout";
    return complete;
  } catch {
    return false;
  } finally {
    if (identity)
      try {
        const current = await lstat(outputRoot, { bigint: true });
        if (!sameDirectory(identity, current)) throw new TypeError("observation-output:moved");
        if (!complete) await rm(outputRoot, { recursive: true });
      } catch {
        return false;
      }
  }
}

export async function runHostedIss002Observation(
  input: HostedObservationInput,
): Promise<HostedObservationResult> {
  let runtimeRoot: string | undefined;
  let runtimeIdentity: BigIntStats | undefined;
  try {
    const context = parseHostedObservationContext(input.context);
    if (
      !context ||
      ![input.candidateRoot, input.outputRoot, input.runnerTemp, input.stableRoot].every(
        (path) => typeof path === "string" && isAbsolute(path),
      ) ||
      input.runnerToken !== "ISS002_CONTRACTS" ||
      !/^iss002-contracts-(?:linux|macos|windows)$/.test(input.jobId)
    )
      return refusal("observation-runner:input-refused");
    const outputParentInput = resolve(input.outputRoot, "..");
    const [candidateRoot, runnerTemp, stableRoot, outputParent, ...identities] = await Promise.all([
      realpath(input.candidateRoot),
      realpath(input.runnerTemp),
      realpath(input.stableRoot),
      realpath(outputParentInput),
      lstat(input.candidateRoot),
      lstat(input.runnerTemp),
      lstat(input.stableRoot),
      lstat(outputParentInput),
    ]);
    if (
      identities.some((identity) => !identity.isDirectory() || identity.isSymbolicLink()) ||
      [candidateRoot, stableRoot].some(
        (root) => within(root, runnerTemp) || within(runnerTemp, root),
      ) ||
      within(candidateRoot, stableRoot) ||
      within(stableRoot, candidateRoot) ||
      !within(runnerTemp, outputParent) ||
      within(candidateRoot, input.outputRoot) ||
      within(stableRoot, input.outputRoot)
    )
      return refusal("observation-runner:root-separation-refused");
    const environment = await environmentInputs(input.environment, runnerTemp, stableRoot);
    if (
      !environment ||
      input.jobId !== `iss002-contracts-${environment.operatingSystem.toLowerCase()}`
    )
      return refusal("observation-runner:environment-refused");
    const stable = await stableInputs(stableRoot);
    if (!stable || !stableMatchesContext(stable, context))
      return refusal("observation-runner:stable-authority-refused");
    const candidate = await loadHostedCandidateSnapshot(candidateRoot, context.candidateRevision);
    if (!candidate.ok || candidate.value.digest !== context.candidateSubjectDigest)
      return refusal("observation-runner:candidate-authority-refused");
    const jobRows = stable.registry.jobs as readonly ContractRecord[];
    const job = jobRows.find((row) => row.jobId === input.jobId);
    if (!job || job.suiteId !== "iss002-contracts")
      return refusal("observation-runner:registry-selection-refused");
    runtimeRoot = await mkdtemp(resolve(runnerTemp, "op-observation-"));
    runtimeIdentity = await lstat(runtimeRoot, { bigint: true });
    const sourceParent = resolve(runtimeRoot, "s");
    const executionParent = resolve(runtimeRoot, "e");
    const materializationParent = resolve(runtimeRoot, "m");
    await Promise.all(
      [sourceParent, executionParent, materializationParent].map(async (path) => {
        await mkdir(path);
      }),
    );
    const sourceResult = await withHostedCandidateSource(
      candidate.value,
      sourceParent,
      stableRoot,
      async (candidateSourceRoot, candidateSubject) =>
        await withIss002ExecutionWorkspace({
          candidateSourceRoot,
          candidateSubject,
          executionParent,
          materializationParent,
          stableRoot,
          async consume(workspaceRoot): Promise<Iss002StableHandlerResult> {
            const preparation = await prepareIss002WorkspaceDependencies(stableRoot, workspaceRoot);
            if (!preparation.ok)
              return {
                issues: Object.freeze(["observation-runner:dependency-refused"]),
                ok: false,
              };
            const generator = (await import(
              pathToFileURL(
                resolve(stableRoot, "packages/conformance/src/iss002-vector-generator.mjs"),
              ).href
            )) as { readonly generate: (parameters: unknown) => unknown };
            return await runIss002StableHandler(stable.vectorCensus, {
              executeContracts: async (selection) =>
                await executeIss002ContractSelection(workspaceRoot, selection),
              executeWalk: async () => {
                const observed = await runIss002NativeCandidateObservation({
                  candidateSourceRoot,
                  candidateSubject,
                  executionParent,
                  materializationParent,
                });
                return {
                  normalizedResult: observed.ok ? "PASS" : "FAIL",
                  stderrBytes: observed.stderrBytes,
                  stdoutBytes: observed.stdoutBytes,
                  walkDurationsNanoseconds: observed.ok ? observed.durationsNanoseconds : null,
                };
              },
              generate: generator.generate,
            });
          },
        }),
    );
    if (!sourceResult.ok || !sourceResult.value.ok || !sourceResult.value.value.ok)
      return refusal("observation-runner:execution-refused");
    const handler = sourceResult.value.value;
    const stableAfter = await stableInputs(stableRoot);
    if (!stableAfter || !stableMatchesContext(stableAfter, context))
      return refusal("observation-runner:stable-recheck-refused");
    const artifacts = createIss002ObservationArtifacts({
      ...environment,
      jobId: input.jobId,
      runnerToken: "ISS002_CONTRACTS",
      stderrBytes: handler.stderrBytes,
      stdoutBytes: handler.stdoutBytes,
      suiteId: "iss002-contracts",
      vectorExecutions: handler.vectorExecutions,
      walkDurationsNanoseconds: handler.walkDurationsNanoseconds,
    });
    if (!artifacts.ok || !(await writeObservation(input.outputRoot, artifacts)))
      return refusal("observation-runner:artifact-refused");
    return { ok: true, normalizedResult: artifacts.normalizedResult };
  } catch {
    return refusal("observation-runner:unreadable");
  } finally {
    if (runtimeRoot && runtimeIdentity)
      try {
        const current = await lstat(runtimeRoot, { bigint: true });
        if (!sameDirectory(runtimeIdentity, current))
          throw new TypeError("observation-runner:runtime-moved");
        await rm(runtimeRoot, { recursive: true });
      } catch {
        return refusal("observation-runner:cleanup-refused");
      }
  }
}

function hostedEnvironmentMatchesContext(
  environment: Readonly<Record<string, string | undefined>>,
  context: HostedPlanContext,
): boolean {
  return (
    environment.GITHUB_EVENT_NAME === context.event &&
    environment.GITHUB_REF === "refs/heads/main" &&
    environment.GITHUB_REF_PROTECTED === "true" &&
    environment.GITHUB_REPOSITORY === context.repository &&
    environment.GITHUB_REPOSITORY_ID === context.repositoryId &&
    environment.GITHUB_RUN_ATTEMPT === context.runAttempt &&
    environment.GITHUB_RUN_ID === context.runId &&
    environment.GITHUB_SHA === context.workflowRevision &&
    environment.GITHUB_WORKFLOW_REF === context.workflowRef &&
    environment.GITHUB_WORKFLOW_SHA === context.workflowRevision
  );
}

export async function runHostedObservation(): Promise<void> {
  const context = decodeHostedObservationContext(process.env.CONFORMANCE_PLAN_CONTEXT ?? "");
  const candidateRoot = process.env.CANDIDATE_ROOT;
  const jobId = process.env.CONFORMANCE_JOB_ID;
  const outputRoot = process.env.CONFORMANCE_OUTPUT_ROOT;
  const runnerTemp = process.env.RUNNER_TEMP;
  const runnerToken = process.env.CONFORMANCE_RUNNER_TOKEN;
  if (
    !context ||
    !hostedEnvironmentMatchesContext(process.env, context) ||
    !candidateRoot ||
    !jobId ||
    !outputRoot ||
    !runnerTemp ||
    !runnerToken
  )
    throw new Error("observation:provider-context-refused");
  const result = await runHostedIss002Observation({
    candidateRoot,
    context,
    environment: process.env,
    jobId,
    outputRoot,
    runnerTemp,
    runnerToken,
    stableRoot: process.cwd(),
  });
  if (!result.ok) throw new Error("observation:execution-refused");
}

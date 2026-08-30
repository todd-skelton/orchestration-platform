import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";
import {
  canonicalJson,
  schemaVersions,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  createIss002ContractVersions,
  createIss002StableBundleManifests,
  createIss022RequiredJobRegistry,
  iss022PortablePrimitiveVectorCensus,
  parseConformanceRawArtifactManifest,
  runIss022PortablePrimitivesStableSuite,
  serializeConformanceContract,
  sha256Bytes,
  type Iss022StableSuiteResult,
} from "../../packages/conformance/src/index.js";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import { loadHostedCandidateSnapshot, type HostedPlanContext } from "./hosted-plan.mjs";

export type HostedObservationResult =
  | {
      readonly ok: true;
      readonly normalizedResult: "FAIL" | "PASS" | "UNKNOWN" | "UNSUPPORTED";
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
  "protectedRefDigest",
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
      "protectedRefDigest",
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
      protectedRefDigest: record.protectedRefDigest,
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

async function environmentInputs(
  environment: Readonly<Record<string, string | undefined>>,
  stableRoot: string,
): Promise<
  | {
      readonly architecture: "ARM64" | "X64";
      readonly environmentBytes: Uint8Array;
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
    operatingSystem,
    packageManagerVersion: packageManagerMatch[1]!,
  });
}

export async function loadHostedStableInputs(stableRoot: string) {
  const bundles = await createIss002StableBundleManifests(stableRoot);
  if (!bundles.ok) return undefined;
  const vectorCensus = iss022PortablePrimitiveVectorCensus;
  const contractVersions = createIss002ContractVersions(schemaVersions);
  const registry = createIss022RequiredJobRegistry();
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

export function hostedStableInputsMatchContext(
  stable: NonNullable<Awaited<ReturnType<typeof loadHostedStableInputs>>>,
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
  artifacts: Readonly<{
    readonly environmentBytes: Uint8Array;
    readonly environmentRecordBytes: Uint8Array;
    readonly rawManifestBytes: Uint8Array;
    readonly reportBytes: Uint8Array;
    readonly stderrBytes: Uint8Array;
    readonly stdoutBytes: Uint8Array;
  }>,
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

function createIss022ObservationArtifacts(
  environmentBytes: Uint8Array,
  result: Extract<Iss022StableSuiteResult, { readonly ok: true }>,
) {
  const raw = Object.freeze({
    environment: Uint8Array.from(environmentBytes),
    report: Uint8Array.from(result.reportBytes),
    stderr: new Uint8Array(),
    stdout: new Uint8Array(),
  });
  const mediaTypes = Object.freeze({
    environment: "APPLICATION_JSON",
    report: "APPLICATION_JSON",
    stderr: "TEXT_PLAIN",
    stdout: "TEXT_PLAIN",
  } as const);
  const manifest = parseConformanceRawArtifactManifest(
    Object.freeze({
      entries: Object.freeze(
        (Object.keys(raw) as readonly (keyof typeof raw)[]).map((name) =>
          Object.freeze({
            byteLength: String(raw[name].byteLength),
            mediaType: mediaTypes[name],
            name,
            sha256Digest: sha256Bytes(raw[name]),
          }),
        ),
      ),
      schemaVersion: "conformance-raw-artifact-manifest/v1",
    }),
  );
  const environment = serializeConformanceContract(
    "conformance-environment/v1",
    result.environment,
  );
  const rawManifest = manifest.ok
    ? serializeConformanceContract("conformance-raw-artifact-manifest/v1", manifest.value)
    : manifest;
  return manifest.ok && environment.ok && rawManifest.ok
    ? Object.freeze({
        environmentBytes: raw.environment,
        environmentRecordBytes: environment.bytes,
        rawManifestBytes: rawManifest.bytes,
        reportBytes: raw.report,
        stderrBytes: raw.stderr,
        stdoutBytes: raw.stdout,
      })
    : undefined;
}

export async function runHostedIss022Observation(
  input: HostedObservationInput,
): Promise<HostedObservationResult> {
  try {
    const context = parseHostedObservationContext(input.context);
    if (
      !context ||
      ![input.candidateRoot, input.outputRoot, input.runnerTemp, input.stableRoot].every(
        (path) => typeof path === "string" && isAbsolute(path),
      ) ||
      input.runnerToken !== "ISS022_PORTABLE_PRIMITIVES" ||
      !/^iss022-portable-primitives-(?:linux|macos|windows)$/.test(input.jobId)
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
    const environment = await environmentInputs(input.environment, stableRoot);
    if (
      !environment ||
      input.jobId !== `iss022-portable-primitives-${environment.operatingSystem.toLowerCase()}`
    )
      return refusal("observation-runner:environment-refused");
    const stable = await loadHostedStableInputs(stableRoot);
    if (!stable || !hostedStableInputsMatchContext(stable, context))
      return refusal("observation-runner:stable-authority-refused");
    const candidate = await loadHostedCandidateSnapshot(candidateRoot, context.candidateRevision);
    if (!candidate.ok || candidate.value.digest !== context.candidateSubjectDigest)
      return refusal("observation-runner:candidate-authority-refused");
    const jobRows = stable.registry.jobs as readonly ContractRecord[];
    const job = jobRows.find((row) => row.jobId === input.jobId);
    if (
      !job ||
      job.suiteId !== "iss022-portable-primitives" ||
      job.environmentFamily !== environment.operatingSystem
    )
      return refusal("observation-runner:registry-selection-refused");
    const suite = await runIss022PortablePrimitivesStableSuite({
      architecture: environment.architecture,
      custodyParentRoot: runnerTemp,
      environmentBytes: environment.environmentBytes,
      jobId: input.jobId,
      packageManagerVersion: environment.packageManagerVersion,
      providerRunDigest: context.providerRunDigest,
      stableRoot,
    });
    if (!suite.ok) return refusal(...suite.issues.map((issue) => `suite.${issue}`));
    const stableAfter = await loadHostedStableInputs(stableRoot);
    if (!stableAfter || !hostedStableInputsMatchContext(stableAfter, context))
      return refusal("observation-runner:stable-recheck-refused");
    const artifacts = createIss022ObservationArtifacts(environment.environmentBytes, suite);
    if (!artifacts || !(await writeObservation(input.outputRoot, artifacts)))
      return refusal("observation-runner:artifact-refused");
    return { ok: true, normalizedResult: suite.normalizedResult };
  } catch {
    return refusal("observation-runner:unreadable");
  }
}

export function hostedEnvironmentMatchesContext(
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
  const result = await runHostedIss022Observation({
    candidateRoot,
    context,
    environment: process.env,
    jobId,
    outputRoot,
    runnerTemp,
    runnerToken,
    stableRoot: process.cwd(),
  });
  if (!result.ok) throw new Error(result.issues.join(","));
}

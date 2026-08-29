import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  canonicalJson,
  schemaVersions,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  constructIss022EnvironmentAuthority,
  createConformanceJobEvidence,
  createIss002ContractVersions,
  createIss022RequiredJobRegistry,
  iss022PortablePrimitiveVectorCensusDigest,
  runIss022PortablePrimitivesStableSuite,
  serializeConformanceContract,
  sha256Bytes,
} from "../../packages/conformance/src/index.js";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import { runHostedAggregateComposition } from "../../scripts/conformance/hosted-aggregate.mjs";
import { loadHostedStableInputs } from "../../scripts/conformance/hosted-observation.mjs";
import type { HostedPlanContext } from "../../scripts/conformance/hosted-plan.mjs";

const roots: string[] = [];
const repository = "todd-skelton/orchestration-platform";
const workflowPath = ".github/workflows/conformance.yml" as const;
const workflowRef = `${repository}/${workflowPath}@refs/heads/main`;
const stableRoot = resolve(import.meta.dirname, "../..");

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "op-hosted-aggregate-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

async function context(): Promise<HostedPlanContext> {
  const stable = await loadHostedStableInputs(stableRoot);
  if (!stable) throw new Error("stable inputs unavailable");
  const revision = "a".repeat(40);
  const candidateSubjectDigest = "b".repeat(64);
  const protectedRefDigest = "c".repeat(64);
  const provider = parseGithubProviderRunContext({
    candidateRevision: revision,
    candidateSubjectDigest,
    event: "repository_dispatch",
    harnessBundleDigest: stable.harnessBundleDigest,
    protectedRefDigest,
    repositoryId: "1",
    requiredJobRegistryDigest: stable.requiredJobRegistryDigest,
    runAttempt: "1",
    runId: "2",
    testBundleDigest: stable.testBundleDigest,
    workflowPath,
    workflowRef,
    workflowRevision: revision,
  });
  if (!provider.ok) throw new Error(provider.issues.join(","));
  return Object.freeze({
    candidateRevision: revision,
    candidateSubjectDigest,
    contractVersionsDigest: stable.contractVersionsDigest,
    event: "repository_dispatch",
    harnessBundleDigest: stable.harnessBundleDigest,
    protectedRefDigest,
    providerRunDigest: computeGithubProviderRunDigest(provider.value),
    repository,
    repositoryId: "1",
    requiredJobRegistryDigest: stable.requiredJobRegistryDigest,
    runAttempt: "1",
    runId: "2",
    schemaVersion: "hosted-conformance-plan-context/v1",
    testBundleDigest: stable.testBundleDigest,
    vectorCensusDigest: stable.vectorCensusDigest,
    workflowPath,
    workflowRef,
    workflowRevision: revision,
  });
}

function currentJobId(): string {
  const suffix = ({ darwin: "macos", linux: "linux", win32: "windows" } as const)[
    process.platform as "darwin" | "linux" | "win32"
  ];
  if (!suffix) throw new Error(`unsupported platform ${process.platform}`);
  return `iss022-portable-primitives-${suffix}`;
}

async function diagnosticReport(plan: HostedPlanContext, runnerTemp: string) {
  const environmentBytes = new TextEncoder().encode(
    canonicalJson({
      imageOS: "test",
      imageVersion: "20260829.1",
      runnerArchitecture: process.arch === "arm64" ? "ARM64" : "X64",
      runnerOperatingSystem: process.platform,
      schemaVersion: "github-hosted-environment-inventory/v1",
    }),
  );
  const suite = await runIss022PortablePrimitivesStableSuite({
    architecture: process.arch === "arm64" ? "ARM64" : "X64",
    custodyParentRoot: runnerTemp,
    environmentBytes,
    jobId: currentJobId(),
    packageManagerVersion: "11.22.0",
    providerRunDigest: plan.providerRunDigest,
    stableRoot,
  });
  if (!suite.ok) throw new Error(suite.issues.join(","));
  expect(suite.report.selection).not.toBeNull();
  const report = JSON.parse(canonicalJson(suite.report)) as Record<string, any>;
  report.vectorExecutions[0].rawFacts.rootStable = false;
  report.vectorExecutions[0].normalizedResult = "UNKNOWN";
  return { environmentBytes, report };
}

async function observation(
  downloadRoot: string,
  plan: HostedPlanContext,
  operatingSystem: "LINUX" | "MACOS" | "WINDOWS",
  base: Awaited<ReturnType<typeof diagnosticReport>>,
): Promise<string> {
  const jobId = `iss022-portable-primitives-${operatingSystem.toLowerCase()}`;
  const environmentBytes = new TextEncoder().encode(
    canonicalJson({
      imageOS: operatingSystem.toLowerCase(),
      imageVersion: "20260829.1",
      runnerArchitecture: process.arch === "arm64" ? "ARM64" : "X64",
      runnerOperatingSystem: operatingSystem,
      schemaVersion: "github-hosted-environment-inventory/v1",
    }),
  );
  const report = JSON.parse(canonicalJson(base.report)) as Record<string, any>;
  const coordinates = Object.freeze({
    architecture: process.arch === "arm64" ? "ARM64" : "X64",
    jobId,
    observedAt: report.observedAt,
    osImageDigest: sha256Bytes(environmentBytes),
    packageManagerVersion: "11.22.0",
    providerRunDigest: plan.providerRunDigest,
  });
  const authority = constructIss022EnvironmentAuthority(
    report.vectorExecutions as ContractRecord[],
    report.executableCapture,
    coordinates,
    iss022PortablePrimitiveVectorCensusDigest,
  );
  if (!authority.ok) throw new Error(authority.issues.join(","));
  Object.assign(report, authority.value.profile, coordinates, {
    environmentDigest: authority.value.environmentDigest,
    normalizedResult: authority.value.normalizedResult,
  });
  const reportBytes = new TextEncoder().encode(canonicalJson(report));
  const rawArtifacts = Object.freeze({
    environment: environmentBytes,
    report: reportBytes,
    stderr: new Uint8Array(),
    stdout: new Uint8Array(),
  });
  const evidence = createConformanceJobEvidence({
    candidateSubjectDigest: plan.candidateSubjectDigest,
    contractVersionsDigest: computeConformanceRecordDigest(
      "conformance-contract-versions/v1",
      createIss002ContractVersions(schemaVersions),
    ),
    environment: authority.value.environment,
    harnessBundleDigest: plan.harnessBundleDigest,
    jobId,
    maximumWalkDurationNanoseconds: null,
    normalizedResult: "UNKNOWN",
    providerRunDigest: plan.providerRunDigest,
    rawArtifacts,
    registry: createIss022RequiredJobRegistry(),
    testBundleDigest: plan.testBundleDigest,
  });
  if (!evidence.ok) throw new Error(evidence.issues.join(","));
  const environmentRecord = serializeConformanceContract(
    "conformance-environment/v1",
    evidence.environment,
  );
  const manifest = serializeConformanceContract(
    "conformance-raw-artifact-manifest/v1",
    evidence.rawArtifactManifest,
  );
  if (!(environmentRecord.ok && manifest.ok)) throw new Error("serialization refused");
  const directory = resolve(downloadRoot, `conformance-${plan.runId}-${plan.runAttempt}-${jobId}`);
  await mkdir(directory);
  for (const [name, bytes] of Object.entries({
    environment: environmentBytes,
    "environment-record.json": environmentRecord.bytes,
    "raw-manifest.json": manifest.bytes,
    report: reportBytes,
    stderr: new Uint8Array(),
    stdout: new Uint8Array(),
  }))
    await writeFile(resolve(directory, name), bytes);
  return directory;
}

async function fixture() {
  const runnerTemp = await root();
  const downloadRoot = resolve(runnerTemp, "downloads");
  const outputRoot = resolve(runnerTemp, "aggregate");
  await mkdir(downloadRoot);
  const plan = await context();
  const base = await diagnosticReport(plan, runnerTemp);
  const directories = await Promise.all(
    (["LINUX", "MACOS", "WINDOWS"] as const).map(
      async (operatingSystem) => await observation(downloadRoot, plan, operatingSystem, base),
    ),
  );
  return { directories, downloadRoot, outputRoot, plan, runnerTemp };
}

async function replaceReport(directory: string, mutate: (report: any) => void) {
  const report = JSON.parse(await readFile(resolve(directory, "report"), "utf8"));
  mutate(report);
  const reportBytes = new TextEncoder().encode(canonicalJson(report));
  await writeFile(resolve(directory, "report"), reportBytes);
  const manifest = JSON.parse(await readFile(resolve(directory, "raw-manifest.json"), "utf8"));
  const row = manifest.entries.find((entry: any) => entry.name === "report");
  row.byteLength = String(reportBytes.byteLength);
  row.sha256Digest = sha256Bytes(reportBytes);
  await writeFile(resolve(directory, "raw-manifest.json"), canonicalJson(manifest), "utf8");
}

describe("hosted stable ISS-022 aggregate composition", () => {
  test("authenticates the null-arm reports, preserves exact UNKNOWN receipts, and emits no aggregate", async () => {
    const input = await fixture();
    const result = await runHostedAggregateComposition({
      context: input.plan,
      downloadRoot: input.downloadRoot,
      outputRoot: input.outputRoot,
      runnerTemp: input.runnerTemp,
      stableRoot,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("non-PASS aggregate unexpectedly constructed");
    expect(
      result.receipts?.map(({ jobId, normalizedResult }) => ({ jobId, normalizedResult })),
    ).toEqual(
      (["linux", "macos", "windows"] as const).map((suffix) => ({
        jobId: `iss022-portable-primitives-${suffix}`,
        normalizedResult: "UNKNOWN",
      })),
    );
    expect(result.issues).toContain(
      "aggregate.receipt.iss022-portable-primitives-linux.result:not-pass",
    );
    await expect(readdir(input.outputRoot)).rejects.toThrow();
  }, 600_000);

  test("refuses missing, extra, and cross-job observation artifacts", async () => {
    const missing = await fixture();
    await rm(missing.directories[0]!, { recursive: true });
    expect(
      (
        await runHostedAggregateComposition({
          context: missing.plan,
          downloadRoot: missing.downloadRoot,
          outputRoot: missing.outputRoot,
          runnerTemp: missing.runnerTemp,
          stableRoot,
        })
      ).ok,
    ).toBe(false);

    const extra = await fixture();
    await writeFile(resolve(extra.directories[0]!, "receipt.json"), "{}");
    expect(
      (
        await runHostedAggregateComposition({
          context: extra.plan,
          downloadRoot: extra.downloadRoot,
          outputRoot: extra.outputRoot,
          runnerTemp: extra.runnerTemp,
          stableRoot,
        })
      ).ok,
    ).toBe(false);

    const substituted = await fixture();
    const linuxReport = await readFile(resolve(substituted.directories[0]!, "report"), "utf8");
    await replaceReport(substituted.directories[1]!, (report) =>
      Object.assign(report, JSON.parse(linuxReport)),
    );
    expect(
      (
        await runHostedAggregateComposition({
          context: substituted.plan,
          downloadRoot: substituted.downloadRoot,
          outputRoot: substituted.outputRoot,
          runnerTemp: substituted.runnerTemp,
          stableRoot,
        })
      ).ok,
    ).toBe(false);
  }, 600_000);

  test("refuses UNKNOWN laundering even when the substituted report digest is rebound", async () => {
    const input = await fixture();
    await replaceReport(input.directories[0]!, (report) => {
      report.normalizedResult = "PASS";
    });
    const result = await runHostedAggregateComposition({
      context: input.plan,
      downloadRoot: input.downloadRoot,
      outputRoot: input.outputRoot,
      runnerTemp: input.runnerTemp,
      stableRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.receipts).toBeUndefined();
    await expect(readdir(input.outputRoot)).rejects.toThrow();
  }, 600_000);
});

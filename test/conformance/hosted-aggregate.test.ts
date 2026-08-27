import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import {
  createIss002ObservationArtifacts,
  iss002VectorIds,
  parseCanonicalConformanceBytes,
} from "../../packages/conformance/src/index.js";
import { runHostedAggregateComposition } from "../../scripts/conformance/hosted-aggregate.mjs";
import { loadHostedIss002StableInputs } from "../../scripts/conformance/hosted-observation.mjs";
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
  const stable = await loadHostedIss002StableInputs(stableRoot);
  if (!stable) throw new Error("stable inputs unavailable");
  const revision = "a".repeat(40);
  const candidateSubjectDigest = "b".repeat(64);
  const protectionSnapshotDigest = "c".repeat(64);
  const provider = parseGithubProviderRunContext({
    candidateRevision: revision,
    candidateSubjectDigest,
    event: "repository_dispatch",
    harnessBundleDigest: stable.harnessBundleDigest,
    protectionSnapshotDigest,
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
    protectionSnapshotDigest,
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

async function observation(
  downloadRoot: string,
  plan: HostedPlanContext,
  operatingSystem: "LINUX" | "MACOS" | "WINDOWS",
): Promise<string> {
  const suffix = operatingSystem.toLowerCase();
  const jobId = `iss002-contracts-${suffix}`;
  const created = createIss002ObservationArtifacts({
    abiBytes: new TextEncoder().encode('{"modules":"137","napi":"10"}'),
    architecture: operatingSystem === "MACOS" ? "ARM64" : "X64",
    environmentBytes: new TextEncoder().encode(
      `{"imageOS":"${suffix}","imageVersion":"20260827.1"}`,
    ),
    filesystemProfileBytes: new TextEncoder().encode(
      operatingSystem === "WINDOWS"
        ? '{"caseSensitive":false,"separator":"\\\\"}'
        : '{"caseSensitive":true,"separator":"/"}',
    ),
    jobId,
    nodeVersion: "24.15.0",
    operatingSystem,
    packageManagerVersion: "11.22.0",
    runnerToken: "ISS002_CONTRACTS",
    stderrBytes: new Uint8Array(),
    stdoutBytes: new TextEncoder().encode(`${jobId}\n`),
    suiteId: "iss002-contracts",
    vectorExecutions: iss002VectorIds.map((fixtureId) => ({
      fixtureId,
      normalizedResult: "PASS" as const,
    })),
    walkDurationsNanoseconds: ["1", "2", "3"],
  });
  if (!created.ok) throw new Error(created.issues.join(","));
  const directory = resolve(downloadRoot, `conformance-${plan.runId}-${plan.runAttempt}-${jobId}`);
  await mkdir(directory);
  for (const [name, bytes] of Object.entries({
    environment: created.environmentBytes,
    "environment-record.json": created.environmentRecordBytes,
    "raw-manifest.json": created.rawManifestBytes,
    report: created.reportBytes,
    stderr: created.stderrBytes,
    stdout: created.stdoutBytes,
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
  const directories = await Promise.all(
    (["LINUX", "MACOS", "WINDOWS"] as const).map(
      async (operatingSystem) => await observation(downloadRoot, plan, operatingSystem),
    ),
  );
  return { directories, downloadRoot, outputRoot, plan, runnerTemp };
}

describe("hosted stable aggregate composition", () => {
  test("derives exact receipts and one PASS aggregate from the complete current-attempt census", async () => {
    const input = await fixture();
    const result = await runHostedAggregateComposition({
      context: input.plan,
      downloadRoot: input.downloadRoot,
      outputRoot: input.outputRoot,
      runnerTemp: input.runnerTemp,
      stableRoot,
    });
    expect(result.ok).toBe(true);
    expect((await readdir(input.outputRoot)).sort()).toEqual(["aggregate.json", "receipts"]);
    const aggregate = parseCanonicalConformanceBytes(
      "conformance-aggregate/v1",
      Uint8Array.from(await readFile(resolve(input.outputRoot, "aggregate.json"))),
    );
    if (!aggregate.ok) throw new Error(aggregate.issues.join(","));
    expect(aggregate.value.result).toBe("PASS");
    expect(aggregate.value.providerRunDigest).toBe(input.plan.providerRunDigest);
    expect(await readdir(resolve(input.outputRoot, "receipts"))).toHaveLength(3);
  });

  test("refuses a missing observation or changed bound report without leaving aggregate bytes", async () => {
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
    await expect(readdir(missing.outputRoot)).rejects.toThrow();

    const changed = await fixture();
    await writeFile(resolve(changed.directories[1]!, "report"), "{}", "utf8");
    expect(
      (
        await runHostedAggregateComposition({
          context: changed.plan,
          downloadRoot: changed.downloadRoot,
          outputRoot: changed.outputRoot,
          runnerTemp: changed.runnerTemp,
          stableRoot,
        })
      ).ok,
    ).toBe(false);
    await expect(readdir(changed.outputRoot)).rejects.toThrow();
  });
});

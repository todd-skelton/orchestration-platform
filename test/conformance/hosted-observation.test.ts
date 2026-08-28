import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import {
  computeGithubConformanceProtectedRefDigest,
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import {
  decodeHostedObservationContext,
  parseHostedObservationContext,
  runHostedIss002Observation,
} from "../../scripts/conformance/hosted-observation.mjs";
import {
  finalizeHostedPlan,
  type HostedPlanContext,
  type HostedPlanSelection,
} from "../../scripts/conformance/hosted-plan.mjs";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const repository = "todd-skelton/orchestration-platform";
const workflowPath = ".github/workflows/conformance.yml" as const;
const workflowRef = `${repository}/${workflowPath}@refs/heads/main`;
const integrationTest =
  process.env.ISS002_HOSTED_OBSERVATION_INTEGRATION === "1" ? test : test.skip;

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function syntheticContext(): HostedPlanContext {
  const digest = "a".repeat(64);
  const revision = "b".repeat(40);
  const provider = parseGithubProviderRunContext({
    candidateRevision: revision,
    candidateSubjectDigest: digest,
    event: "repository_dispatch",
    harnessBundleDigest: digest,
    protectedRefDigest: digest,
    repositoryId: "1",
    requiredJobRegistryDigest: digest,
    runAttempt: "1",
    runId: "2",
    testBundleDigest: digest,
    workflowPath,
    workflowRef,
    workflowRevision: revision,
  });
  if (!provider.ok) throw new Error(provider.issues.join(","));
  return Object.freeze({
    candidateRevision: revision,
    candidateSubjectDigest: digest,
    contractVersionsDigest: digest,
    event: "repository_dispatch",
    harnessBundleDigest: digest,
    protectedRefDigest: digest,
    providerRunDigest: computeGithubProviderRunDigest(provider.value),
    repository,
    repositoryId: "1",
    requiredJobRegistryDigest: digest,
    runAttempt: "1",
    runId: "2",
    schemaVersion: "hosted-conformance-plan-context/v1",
    testBundleDigest: digest,
    vectorCensusDigest: digest,
    workflowPath,
    workflowRef,
    workflowRevision: revision,
  });
}

function runnerEnvironment(): Readonly<Record<string, string>> {
  const rows: Readonly<Record<string, Readonly<{ image: string; runner: string }>>> = {
    darwin: { image: "macos", runner: "macOS" },
    linux: { image: "ubuntu", runner: "Linux" },
    win32: { image: "windows", runner: "Windows" },
  };
  const row = rows[process.platform];
  if (!row) throw new Error(`unsupported test platform: ${process.platform}`);
  const architecture = process.arch === "arm64" ? "ARM64" : "X64";
  return Object.freeze({
    ImageOS: row.image,
    ImageVersion: "20260827.1",
    RUNNER_ARCH: architecture,
    RUNNER_OS: row.runner,
  });
}

describe("hosted ISS-002 observation runner", () => {
  test("accepts only canonical closed plan context with a recomputed provider-run digest", () => {
    const context = syntheticContext();
    const encoded = Buffer.from(canonicalJson(context), "utf8").toString("base64url");
    expect(parseHostedObservationContext(context)).toEqual(context);
    expect(decodeHostedObservationContext(encoded)).toEqual(context);
    for (const mutation of [
      { ...context, extra: true },
      { ...context, providerRunDigest: "c".repeat(64) },
      { ...context, repositoryId: "01" },
      { ...context, workflowRef: `${repository}/${workflowPath}@refs/heads/candidate` },
    ])
      expect(parseHostedObservationContext(mutation)).toBeUndefined();
    expect(decodeHostedObservationContext(`${encoded}=`)).toBeUndefined();
    expect(
      decodeHostedObservationContext(
        Buffer.from(`${canonicalJson(context)}\n`, "utf8").toString("base64url"),
      ),
    ).toBeUndefined();
  });

  integrationTest(
    "runs the authenticated candidate through the stable 22-row handler and writes six raw files",
    async () => {
      const stableRoot = resolve(import.meta.dirname, "../..");
      const parent = await temporaryRoot("op-hosted-observation-");
      const candidateRoot = resolve(parent, "candidate");
      const runnerTemp = resolve(parent, "temp");
      await execFileAsync("git", [
        "clone",
        "--local",
        "--no-hardlinks",
        "--quiet",
        stableRoot,
        candidateRoot,
      ]);
      await mkdir(runnerTemp);
      const { stdout } = await execFileAsync("git", ["-C", candidateRoot, "rev-parse", "HEAD"], {
        encoding: "utf8",
      });
      const candidateRevision = stdout.trim();
      const protectedRef = Object.freeze({
        refProtected: true,
        schemaVersion: "github-conformance-protected-ref/v1",
        targetRef: "refs/heads/main",
      });
      const selection: HostedPlanSelection = Object.freeze({
        candidateRevision,
        event: "repository_dispatch",
        protectedRef,
        protectedRefDigest: computeGithubConformanceProtectedRefDigest(protectedRef),
        repository,
        repositoryId: "1",
        runAttempt: "1",
        runId: "2",
        schemaVersion: "hosted-conformance-plan-selection/v1",
        workflowPath,
        workflowRef,
        workflowRevision: candidateRevision,
      });
      const finalized = await finalizeHostedPlan({ candidateRoot, selection, stableRoot });
      if (!finalized.ok) throw new Error(finalized.issues.join(","));
      const suffix = (
        { darwin: "macos", linux: "linux", win32: "windows" } as Readonly<Record<string, string>>
      )[process.platform];
      if (!suffix) throw new Error(`unsupported test platform: ${process.platform}`);
      const outputRoot = resolve(runnerTemp, "observation");
      const result = await runHostedIss002Observation({
        candidateRoot,
        context: finalized.value.context,
        environment: runnerEnvironment(),
        jobId: `iss002-contracts-${suffix}`,
        outputRoot,
        runnerTemp,
        runnerToken: "ISS002_CONTRACTS",
        stableRoot,
      });
      expect((await readdir(outputRoot)).sort()).toEqual([
        "environment",
        "environment-record.json",
        "raw-manifest.json",
        "report",
        "stderr",
        "stdout",
      ]);
      const report = JSON.parse(await readFile(resolve(outputRoot, "report"), "utf8"));
      expect(report.executedVectors).toHaveLength(22);
      expect(
        report.executedVectors.filter(
          (row: Readonly<{ normalizedResult: string }>) => row.normalizedResult !== "PASS",
        ),
      ).toEqual([]);
      expect(report.walkDurationsNanoseconds).toHaveLength(3);
      expect(result).toEqual({ normalizedResult: "PASS", ok: true });
      expect(await readdir(runnerTemp)).toEqual(["observation"]);
    },
    900_000,
  );
});

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
  computeGithubConformanceProtectedRefDigest,
  computeGithubProviderRunDigest,
  parseGithubConformanceDiagnosticProviderRecord,
  parseGithubProviderRunContext,
  verifyGithubDiagnosticAggregateArchive,
} from "../../packages/conformance/src/github-actions/index.js";
import { runHostedAggregateComposition } from "../../scripts/conformance/hosted-aggregate.mjs";
import { loadHostedStableInputs } from "../../scripts/conformance/hosted-observation.mjs";
import type { HostedPlanContext } from "../../scripts/conformance/hosted-plan.mjs";
import { createHostedDiagnosticProviderRecord } from "../../scripts/conformance/hosted-record.mjs";

const roots: string[] = [];
const repository = "todd-skelton/orchestration-platform";
const workflowPath = ".github/workflows/conformance.yml" as const;
const workflowRef = `${repository}/${workflowPath}@refs/heads/main`;
const stableRoot = resolve(import.meta.dirname, "../..");
const protectedRef = Object.freeze({
  refProtected: true,
  schemaVersion: "github-conformance-protected-ref/v1",
  targetRef: "refs/heads/main",
});

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1)
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries: readonly Readonly<{ bytes: Uint8Array; name: string }>[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0o100644 * 65_536, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes);
    centrals.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Uint8Array.from(Buffer.concat([...locals, centralBytes, end]));
}

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
  const protectedRefDigest = computeGithubConformanceProtectedRefDigest(protectedRef);
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
    expect(await readdir(input.outputRoot)).toEqual(["receipts"]);
    expect((await readdir(resolve(input.outputRoot, "receipts"))).sort()).toEqual(
      (["linux", "macos", "windows"] as const).map(
        (suffix) => `iss022-portable-primitives-${suffix}.json`,
      ),
    );
    const stable = await loadHostedStableInputs(stableRoot);
    if (!stable) throw new Error("stable inputs unavailable");
    const jobs = stable.registry.jobs as readonly ContractRecord[];
    const receiptEntries = await Promise.all(
      jobs.map(async (job) => {
        const jobId = String(job.jobId);
        return {
          bytes: Uint8Array.from(
            await readFile(resolve(input.outputRoot, "receipts", `${jobId}.json`)),
          ),
          name: `receipts/${jobId}.json`,
        };
      }),
    );
    const evidence = await Promise.all(
      jobs.map(async (job, index) => {
        const directory = input.directories[index]!;
        return Object.freeze({
          environment: JSON.parse(
            await readFile(resolve(directory, "environment-record.json"), "utf8"),
          ),
          jobId: String(job.jobId),
          rawArtifactManifest: JSON.parse(
            await readFile(resolve(directory, "raw-manifest.json"), "utf8"),
          ),
          rawArtifacts: Object.freeze({
            environment: Uint8Array.from(await readFile(resolve(directory, "environment"))),
            report: Uint8Array.from(await readFile(resolve(directory, "report"))),
            stderr: Uint8Array.from(await readFile(resolve(directory, "stderr"))),
            stdout: Uint8Array.from(await readFile(resolve(directory, "stdout"))),
          }),
        });
      }),
    );
    const expectation = Object.freeze({
      candidateSubjectDigest: input.plan.candidateSubjectDigest,
      contractVersionsDigest: input.plan.contractVersionsDigest,
      evidence: Object.freeze(evidence),
      harnessBundleDigest: input.plan.harnessBundleDigest,
      providerRunDigest: input.plan.providerRunDigest,
      registry: stable.registry,
      testBundleDigest: input.plan.testBundleDigest,
    });
    const archive = zip(receiptEntries);
    const verified = verifyGithubDiagnosticAggregateArchive(archive, expectation);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.issues.join(","));
    expect(verified.receipts.map((receipt) => receipt.jobId)).toEqual(jobs.map((job) => job.jobId));

    const launderedEntries = receiptEntries.map((entry, index) => {
      if (index !== 0) return entry;
      const receipt = JSON.parse(new TextDecoder().decode(entry.bytes));
      receipt.normalizedResult = "PASS";
      const serialized = serializeConformanceContract("conformance-job-receipt/v1", receipt);
      if (!serialized.ok) throw new Error(serialized.issues.join(","));
      return { ...entry, bytes: serialized.bytes };
    });
    const vectorEntries = receiptEntries.map((entry, index) => {
      if (index !== 1) return entry;
      const receipt = JSON.parse(new TextDecoder().decode(entry.bytes));
      receipt.vectorCensusDigest = "e".repeat(64);
      const serialized = serializeConformanceContract("conformance-job-receipt/v1", receipt);
      if (!serialized.ok) throw new Error(serialized.issues.join(","));
      return { ...entry, bytes: serialized.bytes };
    });
    const rawMutant = {
      ...evidence[0],
      rawArtifacts: {
        ...evidence[0]!.rawArtifacts,
        report: Uint8Array.from([...evidence[0]!.rawArtifacts.report, 0]),
      },
    };
    const environmentMutant = {
      ...evidence[0],
      environment: { ...evidence[0]!.environment, osImageDigest: "d".repeat(64) },
    };
    const manifestMutant = {
      ...evidence[0],
      rawArtifactManifest: {
        ...evidence[0]!.rawArtifactManifest,
        entries: (evidence[0]!.rawArtifactManifest.entries as readonly ContractRecord[]).map(
          (entry, index) => (index === 1 ? { ...entry, sha256Digest: "c".repeat(64) } : entry),
        ),
      },
    };
    for (const [archiveMutant, expectationMutant] of [
      [zip(receiptEntries.slice(1)), expectation],
      [
        zip([...receiptEntries, { bytes: new TextEncoder().encode("{}"), name: "aggregate.json" }]),
        expectation,
      ],
      [zip(receiptEntries), { ...expectation, evidence: [...evidence].reverse() }],
      [zip(receiptEntries), { ...expectation, evidence: [rawMutant, ...evidence.slice(1)] }],
      [
        zip(receiptEntries),
        { ...expectation, evidence: [environmentMutant, ...evidence.slice(1)] },
      ],
      [zip(receiptEntries), { ...expectation, evidence: [manifestMutant, ...evidence.slice(1)] }],
      [zip(receiptEntries), { ...expectation, candidateSubjectDigest: "a".repeat(64) }],
      [zip(receiptEntries), { ...expectation, contractVersionsDigest: "b".repeat(64) }],
      [zip(receiptEntries), { ...expectation, harnessBundleDigest: "c".repeat(64) }],
      [zip(receiptEntries), { ...expectation, providerRunDigest: "f".repeat(64) }],
      [zip(receiptEntries), { ...expectation, testBundleDigest: "d".repeat(64) }],
      [zip(launderedEntries), expectation],
      [zip(vectorEntries), expectation],
    ] as const)
      expect(verifyGithubDiagnosticAggregateArchive(archiveMutant, expectationMutant).ok).toBe(
        false,
      );

    const recordedAt = "2026-08-29T12:00:00.000Z";
    const expiresAt = "2026-09-29T12:00:00.000Z";
    const prefix = `conformance-${input.plan.runId}-${input.plan.runAttempt}-`;
    const observationArchives = await Promise.all(
      input.directories.map(async (directory) =>
        zip(
          await Promise.all(
            [
              "environment",
              "environment-record.json",
              "raw-manifest.json",
              "report",
              "stderr",
              "stdout",
            ].map(async (name) => ({
              bytes: Uint8Array.from(await readFile(resolve(directory, name))),
              name,
            })),
          ),
        ),
      ),
    );
    const providerArtifact = (artifactName: string, artifactId: string, archiveBytes: Uint8Array) =>
      Object.freeze({
        archiveBytes,
        artifactDigest: sha256Bytes(archiveBytes),
        artifactId,
        artifactName,
        byteLength: String(archiveBytes.byteLength),
        expiresAt,
      });
    const artifacts = Object.freeze([
      providerArtifact(`${prefix}aggregate`, "20", archive),
      ...jobs.map((job, index) =>
        providerArtifact(
          `${prefix}${String(job.jobId)}`,
          String(21 + index),
          observationArchives[index]!,
        ),
      ),
    ]);
    const providerJobs = Object.freeze([
      Object.freeze({
        conclusion: "FAILURE",
        providerJobId: "10",
        providerJobName: "Conformance / aggregate",
      }),
      ...jobs.map((job, index) =>
        Object.freeze({
          conclusion: "SUCCESS",
          providerJobId: String(11 + index),
          providerJobName: `Conformance / observation / ${String(job.jobId)}`,
        }),
      ),
      Object.freeze({
        conclusion: "SUCCESS",
        providerJobId: "14",
        providerJobName: "Conformance / plan",
      }),
    ]);
    const createRecord = (overrides: Readonly<Record<string, unknown>> = {}) =>
      createHostedDiagnosticProviderRecord({
        artifacts,
        context: input.plan,
        currentProtectedRef: protectedRef,
        jobs: providerJobs,
        missingArtifactNames: [],
        missingLogicalJobIds: [],
        recordedAt,
        registry: stable.registry,
        ...overrides,
      });
    const record = createRecord();
    expect(record.ok).toBe(true);
    if (!record.ok) throw new Error(record.issues.join(","));
    expect(parseGithubConformanceDiagnosticProviderRecord(record.value).ok).toBe(true);
    expect(record.value.schemaVersion).toBe("github-conformance-diagnostic-provider-record/v1");
    expect("aggregateDigest" in record.value).toBe(false);

    const changedObservation = Uint8Array.from(observationArchives[0]!);
    changedObservation[0] = changedObservation[0]! ^ 1;
    for (const mutation of [
      { jobs: providerJobs.map((job) => ({ ...job, conclusion: "SUCCESS" })) },
      { missingArtifactNames: [`${prefix}aggregate`] },
      { recordedAt: "2026-08-29T12:00:00Z" },
      { currentProtectedRef: { ...protectedRef, refProtected: false } },
      {
        artifacts: [
          artifacts[0],
          providerArtifact(`${prefix}${String(jobs[0]!.jobId)}`, "21", changedObservation),
          ...artifacts.slice(2),
        ],
      },
      {
        artifacts: artifacts.map((artifact) => ({
          ...artifact,
          expiresAt: "2026-08-30T12:00:00.000Z",
        })),
      },
    ])
      expect(createRecord(mutation).ok).toBe(false);
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

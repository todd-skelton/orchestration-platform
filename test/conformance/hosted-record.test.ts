import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as core from "../../packages/conformance/src/index.js";
import * as github from "../../packages/conformance/src/github-actions/index.js";
import { createHostedProviderRecord } from "../../scripts/conformance/hosted-record.mjs";

const d = (value: string): string => value.repeat(64);
const revision = (value: string): string => value.repeat(40);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

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
  for (let index = 0; index < bytes.length; index += 1)
    value = crcTable[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
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

function canonical(schema: core.ConformanceSchemaVersion, value: unknown): Uint8Array {
  const serialized = core.serializeConformanceContract(schema, value);
  if (!serialized.ok) throw new Error(serialized.issues.join(","));
  return serialized.bytes;
}

const raw = Object.freeze({
  environment: text('{"image":"ubuntu-24.04"}\n'),
  report: text('{"executed":["authority-history-linear"]}\n'),
  stderr: new Uint8Array(),
  stdout: text("ok\n"),
});
const environment = Object.freeze({
  abiDigest: d("1"),
  architecture: "X64",
  custodyObservationDigest: null,
  filesystemProfileDigest: d("2"),
  helperProfileDigest: null,
  nodeVersion: "24.15.0",
  operatingSystem: "LINUX",
  osImageDigest: core.sha256Bytes(raw.environment),
  packageManagerVersion: "11.22.0",
  runnerClass: "EPHEMERAL_HOSTED",
  schemaVersion: "conformance-environment/v1",
});
const registry = Object.freeze({
  jobs: Object.freeze([
    Object.freeze({
      environmentFamily: "LINUX",
      jobId: "iss002-contracts-linux",
      requirement: "REQUIRED",
      suiteId: "iss002-contracts",
    }),
  ]),
  schemaVersion: "conformance-required-job-registry/v1",
  suites: Object.freeze([
    Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "iss002-contracts",
      vectorCensusDigest: d("3"),
      walkRequirement: "WALK_1000",
    }),
  ]),
});
const protectedRef = Object.freeze({
  refProtected: true,
  schemaVersion: "github-conformance-protected-ref/v1",
  targetRef: "refs/heads/main",
});
const context = Object.freeze({
  candidateRevision: revision("a"),
  candidateSubjectDigest: d("4"),
  contractVersionsDigest: d("5"),
  event: "repository_dispatch",
  harnessBundleDigest: d("6"),
  protectedRefDigest: github.computeGithubConformanceProtectedRefDigest(protectedRef),
  providerRunDigest: "",
  repository: "todd-skelton/orchestration-platform",
  repositoryId: "123",
  requiredJobRegistryDigest: core.computeConformanceRecordDigest(
    "conformance-required-job-registry/v1",
    registry,
  ),
  runAttempt: "2",
  runId: "456",
  schemaVersion: "hosted-conformance-plan-context/v1",
  testBundleDigest: d("7"),
  vectorCensusDigest: d("8"),
  workflowPath: ".github/workflows/conformance.yml",
  workflowRef:
    "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
  workflowRevision: revision("b"),
});
const providerRun = Object.freeze({
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
const boundContext = Object.freeze({
  ...context,
  providerRunDigest: github.computeGithubProviderRunDigest(providerRun),
});
const evidence = core.createConformanceJobEvidence({
  candidateSubjectDigest: context.candidateSubjectDigest,
  contractVersionsDigest: context.contractVersionsDigest,
  environment,
  harnessBundleDigest: context.harnessBundleDigest,
  jobId: "iss002-contracts-linux",
  maximumWalkDurationNanoseconds: "1000",
  normalizedResult: "PASS",
  providerRunDigest: boundContext.providerRunDigest,
  rawArtifacts: raw,
  registry,
  testBundleDigest: context.testBundleDigest,
});
if (!evidence.ok) throw new Error(evidence.issues.join(","));
const aggregate = core.reduceConformanceAggregate(registry, [
  {
    environment: evidence.environment,
    rawArtifactManifest: evidence.rawArtifactManifest,
    receipt: evidence.receipt,
  },
]);
if (!aggregate.ok) throw new Error(aggregate.issues.join(","));
const observationBytes = zip([
  { bytes: raw.environment, name: "environment" },
  {
    bytes: canonical("conformance-environment/v1", evidence.environment),
    name: "environment-record.json",
  },
  {
    bytes: canonical("conformance-raw-artifact-manifest/v1", evidence.rawArtifactManifest),
    name: "raw-manifest.json",
  },
  { bytes: raw.report, name: "report" },
  { bytes: raw.stderr, name: "stderr" },
  { bytes: raw.stdout, name: "stdout" },
]);
const aggregateBytes = zip([
  { bytes: canonical("conformance-aggregate/v1", aggregate.value), name: "aggregate.json" },
  {
    bytes: canonical("conformance-job-receipt/v1", evidence.receipt),
    name: "receipts/iss002-contracts-linux.json",
  },
]);
const recordedAt = "2026-08-27T12:00:00.000Z";
const expiresAt = core.addCompleteDays(recordedAt, 30);
const prefix = `conformance-${context.runId}-${context.runAttempt}-`;
const jobs = Object.freeze([
  Object.freeze({
    conclusion: "SUCCESS",
    providerJobId: "10",
    providerJobName: "Conformance / aggregate",
  }),
  Object.freeze({
    conclusion: "SUCCESS",
    providerJobId: "11",
    providerJobName: "Conformance / observation / iss002-contracts-linux",
  }),
  Object.freeze({
    conclusion: "SUCCESS",
    providerJobId: "12",
    providerJobName: "Conformance / plan",
  }),
]);
function artifact(name: string, id: string, bytes: Uint8Array) {
  return Object.freeze({
    archiveBytes: bytes,
    artifactDigest: core.sha256Bytes(bytes),
    artifactId: id,
    artifactName: name,
    byteLength: String(bytes.byteLength),
    expiresAt,
  });
}
const artifacts = Object.freeze([
  artifact(`${prefix}aggregate`, "20", aggregateBytes),
  artifact(`${prefix}iss002-contracts-linux`, "21", observationBytes),
]);

function create(overrides: Readonly<Record<string, unknown>> = {}) {
  return createHostedProviderRecord({
    artifacts,
    context: boundContext,
    currentProtectedRef: protectedRef,
    jobs,
    recordedAt,
    registry,
    ...overrides,
  });
}

describe("hosted provider-record composition", () => {
  test("writes canonical bytes only from the exact protected census", () => {
    const result = create();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextDecoder().decode(result.bytes)).toBe(contracts.canonicalJson(result.value));
    expect(result.value.aggregateDigest).toBe(
      core.computeConformanceRecordDigest("conformance-aggregate/v1", aggregate.value),
    );
    expect(
      github.validateGithubConformanceProviderRecord(result.value, {
        aggregateDigest: String(result.value.aggregateDigest),
        providerRun,
        registry,
      }).ok,
    ).toBe(true);
  });

  test("refuses moved protection, changed archive bytes, and incomplete provider evidence", () => {
    const changedProtectedRef = { ...protectedRef, refProtected: false };
    const changedArtifact = {
      ...artifacts[0],
      archiveBytes: Uint8Array.from([...aggregateBytes, 0]),
    };
    for (const mutation of [
      { currentProtectedRef: changedProtectedRef },
      { artifacts: [changedArtifact, artifacts[1]] },
      { artifacts: artifacts.slice(1) },
      { jobs: jobs.slice(1) },
      { jobs: [{ ...jobs[0], conclusion: "FAILURE" }, ...jobs.slice(1)] },
      { recordedAt: "2026-08-27T12:00:00Z" },
    ])
      expect(create(mutation).ok).toBe(false);
  });
});

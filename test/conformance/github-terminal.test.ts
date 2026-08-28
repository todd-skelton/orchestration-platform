import { describe, expect, test } from "vitest";
import * as core from "../../packages/conformance/src/index.js";
import * as github from "../../packages/conformance/src/github-actions/index.js";
import * as contracts from "../../packages/contracts/src/index.js";

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
  const result = core.serializeConformanceContract(schema, value);
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.bytes;
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
const registryDigest = core.computeConformanceRecordDigest(
  "conformance-required-job-registry/v1",
  registry,
);
const protection = Object.freeze({
  bypassActorCount: "0",
  deletionBlocked: true,
  enforcement: "ACTIVE",
  nonFastForwardBlocked: true,
  pullRequestRequired: true,
  schemaVersion: "github-conformance-protection-snapshot/v1",
  targetRef: "refs/heads/main",
});
const protectedRef = Object.freeze({
  refProtected: true,
  schemaVersion: "github-conformance-protected-ref/v1",
  targetRef: "refs/heads/main",
});
const providerRun = Object.freeze({
  candidateRevision: revision("a"),
  candidateSubjectDigest: d("4"),
  event: "repository_dispatch",
  harnessBundleDigest: d("5"),
  protectedRefDigest: github.computeGithubConformanceProtectedRefDigest(protectedRef),
  repositoryId: "123",
  requiredJobRegistryDigest: registryDigest,
  runAttempt: "1",
  runId: "456",
  testBundleDigest: d("6"),
  workflowPath: ".github/workflows/conformance.yml",
  workflowRef:
    "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
  workflowRevision: revision("b"),
});
const evidence = core.createConformanceJobEvidence({
  candidateSubjectDigest: providerRun.candidateSubjectDigest,
  contractVersionsDigest: d("7"),
  environment,
  harnessBundleDigest: providerRun.harnessBundleDigest,
  jobId: "iss002-contracts-linux",
  maximumWalkDurationNanoseconds: "1000",
  normalizedResult: "PASS",
  providerRunDigest: github.computeGithubProviderRunDigest(providerRun),
  rawArtifacts: raw,
  registry,
  testBundleDigest: providerRun.testBundleDigest,
});
if (!evidence.ok) throw new Error(evidence.issues.join(","));
const acceptedEvidence = evidence;
const aggregateResult = core.reduceConformanceAggregate(registry, [
  {
    environment: acceptedEvidence.environment,
    rawArtifactManifest: acceptedEvidence.rawArtifactManifest,
    receipt: acceptedEvidence.receipt,
  },
]);
if (!aggregateResult.ok) throw new Error(aggregateResult.issues.join(","));
const acceptedAggregate = aggregateResult;

const observationZip = zip([
  { bytes: raw.environment, name: "environment" },
  {
    bytes: canonical("conformance-environment/v1", acceptedEvidence.environment),
    name: "environment-record.json",
  },
  {
    bytes: canonical("conformance-raw-artifact-manifest/v1", acceptedEvidence.rawArtifactManifest),
    name: "raw-manifest.json",
  },
  { bytes: raw.report, name: "report" },
  { bytes: raw.stderr, name: "stderr" },
  { bytes: raw.stdout, name: "stdout" },
]);
const aggregateZip = zip([
  { bytes: canonical("conformance-aggregate/v1", acceptedAggregate.value), name: "aggregate.json" },
  {
    bytes: canonical("conformance-job-receipt/v1", acceptedEvidence.receipt),
    name: "receipts/iss002-contracts-linux.json",
  },
]);
const recordedAt = "2026-08-24T00:00:01.000Z";
const expiresAt = core.addCompleteDays(recordedAt, 30);
const prefix = `conformance-${providerRun.runId}-${providerRun.runAttempt}-`;
const providerArtifacts = Object.freeze([
  Object.freeze({
    artifactDigest: core.sha256Bytes(aggregateZip),
    artifactId: "10",
    artifactName: `${prefix}aggregate`,
    byteLength: String(aggregateZip.byteLength),
    expiresAt,
    logicalJobId: "aggregate",
    role: "AGGREGATE",
  }),
  Object.freeze({
    artifactDigest: core.sha256Bytes(observationZip),
    artifactId: "11",
    artifactName: `${prefix}iss002-contracts-linux`,
    byteLength: String(observationZip.byteLength),
    expiresAt,
    logicalJobId: "iss002-contracts-linux",
    role: "OBSERVATION",
  }),
]);
const providerJobs = Object.freeze([
  Object.freeze({
    conclusion: "SUCCESS",
    logicalJobId: "aggregate",
    providerJobId: "20",
    providerJobName: "Conformance / aggregate",
    role: "AGGREGATE",
  }),
  Object.freeze({
    conclusion: "SUCCESS",
    logicalJobId: "iss002-contracts-linux",
    providerJobId: "21",
    providerJobName: "Conformance / observation / iss002-contracts-linux",
    role: "OBSERVATION",
  }),
  Object.freeze({
    conclusion: "SUCCESS",
    logicalJobId: "plan",
    providerJobId: "22",
    providerJobName: "Conformance / plan",
    role: "PLAN",
  }),
]);
const providerRecord = Object.freeze({
  aggregateDigest: core.computeConformanceRecordDigest(
    "conformance-aggregate/v1",
    acceptedAggregate.value,
  ),
  artifacts: providerArtifacts,
  candidateRevision: providerRun.candidateRevision,
  candidateSubjectDigest: providerRun.candidateSubjectDigest,
  event: providerRun.event,
  harnessBundleDigest: providerRun.harnessBundleDigest,
  jobs: providerJobs,
  protectedRefDigest: providerRun.protectedRefDigest,
  recordedAt,
  repositoryId: providerRun.repositoryId,
  requiredJobRegistryDigest: providerRun.requiredJobRegistryDigest,
  runAttempt: providerRun.runAttempt,
  runId: providerRun.runId,
  schemaVersion: "github-conformance-provisional-provider-record/v1",
  testBundleDigest: providerRun.testBundleDigest,
  workflowPath: providerRun.workflowPath,
  workflowRef: providerRun.workflowRef,
  workflowRevision: providerRun.workflowRevision,
});
const providerRecordBytes = contracts.canonicalBytes(providerRecord);
const recordArtifact = Object.freeze({
  artifactDigest: core.sha256Bytes(providerRecordBytes),
  artifactId: "99",
  artifactName: `${prefix}provider-record.json`,
  byteLength: String(providerRecordBytes.byteLength),
  createdAt: "2026-08-24T00:00:02.000Z",
  expired: false,
  expiresAt,
  runAttempt: providerRun.runAttempt,
  runId: providerRun.runId,
});
const liveArtifacts = Object.freeze([
  ...providerArtifacts.map((artifact) =>
    Object.freeze({
      artifactDigest: artifact.artifactDigest,
      artifactId: artifact.artifactId,
      artifactName: artifact.artifactName,
      byteLength: artifact.byteLength,
      createdAt: "2026-08-24T00:00:00.500Z",
      expired: false,
      expiresAt: artifact.expiresAt,
      runAttempt: providerRun.runAttempt,
      runId: providerRun.runId,
    }),
  ),
  recordArtifact,
]);
const liveJobs = Object.freeze([
  ...providerJobs.map((job) =>
    Object.freeze({
      completedAt: "2026-08-24T00:00:00.900Z",
      conclusion: job.conclusion,
      providerJobId: job.providerJobId,
      providerJobName: job.providerJobName,
      startedAt: "2026-08-24T00:00:00.100Z",
    }),
  ),
  Object.freeze({
    completedAt: "2026-08-24T00:00:03.000Z",
    conclusion: "SUCCESS",
    providerJobId: "29",
    providerJobName: "Conformance / record",
    startedAt: "2026-08-24T00:00:00.000Z",
  }),
]);
const baseline = Object.freeze({
  artifactBytes: Object.freeze([
    Object.freeze({ artifactId: "10", bytes: aggregateZip }),
    Object.freeze({ artifactId: "11", bytes: observationZip }),
    Object.freeze({ artifactId: "99", bytes: providerRecordBytes.slice() }),
  ]),
  currentProtectionSnapshot: protection,
  expected: Object.freeze({
    repositoryId: providerRun.repositoryId,
    runAttempt: providerRun.runAttempt,
    runId: providerRun.runId,
    workflowRevision: providerRun.workflowRevision,
  }),
  liveArtifacts,
  liveJobs,
  liveRun: Object.freeze({
    conclusion: "SUCCESS",
    event: providerRun.event,
    repositoryId: providerRun.repositoryId,
    runAttempt: providerRun.runAttempt,
    runId: providerRun.runId,
    status: "COMPLETED",
    workflowPath: providerRun.workflowPath,
    workflowRef: providerRun.workflowRef,
    workflowRevision: providerRun.workflowRevision,
  }),
  providerRecordBytes,
  providerRun,
  registry,
});

function withProviderRecord(record: Readonly<Record<string, unknown>>) {
  const bytes = contracts.canonicalBytes(record);
  const liveRecordArtifact = {
    ...recordArtifact,
    artifactDigest: core.sha256Bytes(bytes),
    byteLength: String(bytes.byteLength),
  };
  return {
    ...baseline,
    artifactBytes: baseline.artifactBytes.map((row) =>
      row.artifactId === "99" ? { ...row, bytes } : row,
    ),
    liveArtifacts: [...baseline.liveArtifacts.slice(0, -1), liveRecordArtifact],
    providerRecordBytes: bytes,
  };
}

function composedEvidenceAttack(input: {
  readonly environmentValue?: Readonly<Record<string, unknown>>;
  readonly providerRunValue?: Readonly<Record<string, unknown>>;
  readonly receiptValue: Readonly<Record<string, unknown>>;
  readonly registryValue?: Readonly<Record<string, unknown>>;
}) {
  const environmentValue = input.environmentValue ?? acceptedEvidence.environment;
  const providerRunValue = input.providerRunValue ?? providerRun;
  const registryValue = input.registryValue ?? registry;
  const receiptValue = input.receiptValue;
  const registryValueDigest = core.computeConformanceRecordDigest(
    "conformance-required-job-registry/v1",
    registryValue,
  );
  const aggregateValue = {
    ...acceptedAggregate.value,
    candidateSubjectDigest: receiptValue.candidateSubjectDigest,
    contractVersionsDigest: receiptValue.contractVersionsDigest,
    harnessBundleDigest: receiptValue.harnessBundleDigest,
    jobReceiptDigests: [
      core.computeConformanceRecordDigest("conformance-job-receipt/v1", receiptValue),
    ],
    providerRunDigest: receiptValue.providerRunDigest,
    requiredJobRegistryDigest: registryValueDigest,
    testBundleDigest: receiptValue.testBundleDigest,
  };
  const movedObservationZip = zip([
    { bytes: raw.environment, name: "environment" },
    {
      bytes: canonical("conformance-environment/v1", environmentValue),
      name: "environment-record.json",
    },
    {
      bytes: canonical(
        "conformance-raw-artifact-manifest/v1",
        acceptedEvidence.rawArtifactManifest,
      ),
      name: "raw-manifest.json",
    },
    { bytes: raw.report, name: "report" },
    { bytes: raw.stderr, name: "stderr" },
    { bytes: raw.stdout, name: "stdout" },
  ]);
  const movedAggregateZip = zip([
    { bytes: canonical("conformance-aggregate/v1", aggregateValue), name: "aggregate.json" },
    {
      bytes: canonical("conformance-job-receipt/v1", receiptValue),
      name: "receipts/iss002-contracts-linux.json",
    },
  ]);
  const movedPrefix = `conformance-${String(providerRunValue.runId)}-${String(providerRunValue.runAttempt)}-`;
  const movedProviderArtifacts = [
    {
      ...providerArtifacts[0]!,
      artifactDigest: core.sha256Bytes(movedAggregateZip),
      artifactName: `${movedPrefix}aggregate`,
      byteLength: String(movedAggregateZip.byteLength),
    },
    {
      ...providerArtifacts[1]!,
      artifactDigest: core.sha256Bytes(movedObservationZip),
      artifactName: `${movedPrefix}iss002-contracts-linux`,
      byteLength: String(movedObservationZip.byteLength),
    },
  ];
  const movedProviderRecord = {
    ...providerRecord,
    aggregateDigest: core.computeConformanceRecordDigest(
      "conformance-aggregate/v1",
      aggregateValue,
    ),
    artifacts: movedProviderArtifacts,
    candidateRevision: providerRunValue.candidateRevision,
    candidateSubjectDigest: providerRunValue.candidateSubjectDigest,
    event: providerRunValue.event,
    harnessBundleDigest: providerRunValue.harnessBundleDigest,
    protectedRefDigest: providerRunValue.protectedRefDigest,
    repositoryId: providerRunValue.repositoryId,
    requiredJobRegistryDigest: registryValueDigest,
    runAttempt: providerRunValue.runAttempt,
    runId: providerRunValue.runId,
    testBundleDigest: providerRunValue.testBundleDigest,
    workflowPath: providerRunValue.workflowPath,
    workflowRef: providerRunValue.workflowRef,
    workflowRevision: providerRunValue.workflowRevision,
  };
  const movedRecordBytes = contracts.canonicalBytes(movedProviderRecord);
  const movedLiveArtifacts = [
    ...movedProviderArtifacts.map((artifact) => ({
      artifactDigest: artifact.artifactDigest,
      artifactId: artifact.artifactId,
      artifactName: artifact.artifactName,
      byteLength: artifact.byteLength,
      createdAt: "2026-08-24T00:00:00.500Z",
      expired: false,
      expiresAt: artifact.expiresAt,
      runAttempt: providerRunValue.runAttempt,
      runId: providerRunValue.runId,
    })),
    {
      ...recordArtifact,
      artifactDigest: core.sha256Bytes(movedRecordBytes),
      artifactName: `${movedPrefix}provider-record.json`,
      byteLength: String(movedRecordBytes.byteLength),
      runAttempt: providerRunValue.runAttempt,
      runId: providerRunValue.runId,
    },
  ];
  return {
    ...baseline,
    artifactBytes: [
      { artifactId: "10", bytes: movedAggregateZip },
      { artifactId: "11", bytes: movedObservationZip },
      { artifactId: "99", bytes: movedRecordBytes },
    ],
    expected: {
      repositoryId: providerRunValue.repositoryId,
      runAttempt: providerRunValue.runAttempt,
      runId: providerRunValue.runId,
      workflowRevision: providerRunValue.workflowRevision,
    },
    liveArtifacts: movedLiveArtifacts,
    liveRun: {
      ...baseline.liveRun,
      event: providerRunValue.event,
      repositoryId: providerRunValue.repositoryId,
      runAttempt: providerRunValue.runAttempt,
      runId: providerRunValue.runId,
      workflowPath: providerRunValue.workflowPath,
      workflowRef: providerRunValue.workflowRef,
      workflowRevision: providerRunValue.workflowRevision,
    },
    providerRecordBytes: movedRecordBytes,
    providerRun: providerRunValue,
    registry: registryValue,
  };
}

describe("GitHub post-terminal evidence verifier", () => {
  test("revalidates the complete successful current-attempt join", () => {
    const verified = github.verifyGithubTerminalEvidence(baseline);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.providerRunDigest).toBe(github.computeGithubProviderRunDigest(providerRun));
    expect(verified.providerRecordDigest).toBe(
      github.computeGithubConformanceProviderRecordDigest(providerRecord),
    );
    const boundaryJob = {
      ...baseline.liveJobs.at(-1)!,
      completedAt: recordedAt,
      startedAt: recordedAt,
    };
    const boundaryArtifact = { ...recordArtifact, createdAt: recordedAt };
    expect(
      github.verifyGithubTerminalEvidence({
        ...baseline,
        liveArtifacts: [...baseline.liveArtifacts.slice(0, -1), boundaryArtifact],
        liveJobs: [...baseline.liveJobs.slice(0, -1), boundaryJob],
      }).ok,
    ).toBe(true);
  });

  test("refuses run, expected-context, and protection movement", () => {
    for (const mutation of [
      { ...baseline, liveRun: { ...baseline.liveRun, conclusion: "FAILURE" } },
      { ...baseline, liveRun: { ...baseline.liveRun, status: "IN_PROGRESS" } },
      { ...baseline, expected: { ...baseline.expected, runAttempt: "2" } },
      {
        ...baseline,
        currentProtectionSnapshot: { ...protection, pullRequestRequired: false },
      },
    ])
      expect(github.verifyGithubTerminalEvidence(mutation).ok).toBe(false);
    expect(
      github.verifyGithubTerminalEvidence(
        withProviderRecord({ ...providerRecord, aggregateDigest: d("9") }),
      ).ok,
    ).toBe(false);
  });

  test("replays retained evidence and refuses internally consistent identity movement", () => {
    const wrongOperatingSystem = {
      ...acceptedEvidence.environment,
      operatingSystem: "WINDOWS",
    };
    const unexpectedHelper = {
      ...acceptedEvidence.environment,
      helperProfileDigest: d("9"),
    };
    const requiredRegistry = {
      ...registry,
      suites: [{ ...registry.suites[0], helperRequirement: "REQUIRED" }],
    };
    const requiredRegistryDigest = core.computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      requiredRegistry,
    );
    const requiredProviderRun = {
      ...providerRun,
      requiredJobRegistryDigest: requiredRegistryDigest,
    };
    const attacks = [
      composedEvidenceAttack({
        receiptValue: { ...acceptedEvidence.receipt, providerRunDigest: d("9") },
      }),
      composedEvidenceAttack({
        receiptValue: { ...acceptedEvidence.receipt, candidateSubjectDigest: d("9") },
      }),
      composedEvidenceAttack({
        receiptValue: { ...acceptedEvidence.receipt, harnessBundleDigest: d("9") },
      }),
      composedEvidenceAttack({
        receiptValue: { ...acceptedEvidence.receipt, testBundleDigest: d("9") },
      }),
      composedEvidenceAttack({
        environmentValue: wrongOperatingSystem,
        receiptValue: {
          ...acceptedEvidence.receipt,
          environmentDigest: core.computeConformanceRecordDigest(
            "conformance-environment/v1",
            wrongOperatingSystem,
          ),
        },
      }),
      composedEvidenceAttack({
        environmentValue: unexpectedHelper,
        receiptValue: {
          ...acceptedEvidence.receipt,
          environmentDigest: core.computeConformanceRecordDigest(
            "conformance-environment/v1",
            unexpectedHelper,
          ),
        },
      }),
      composedEvidenceAttack({
        providerRunValue: requiredProviderRun,
        receiptValue: {
          ...acceptedEvidence.receipt,
          providerRunDigest: github.computeGithubProviderRunDigest(requiredProviderRun),
          requiredJobRegistryDigest: requiredRegistryDigest,
        },
        registryValue: requiredRegistry,
      }),
    ];
    for (const attack of attacks)
      expect(github.verifyGithubTerminalEvidence(attack).ok).toBe(false);
  });

  test("refuses job, artifact, bytes, retention, and provider-time mutations", () => {
    const recordJob = baseline.liveJobs.at(-1)!;
    const movedRecordArtifact = { ...recordArtifact, createdAt: "2026-08-23T23:59:59.000Z" };
    for (const mutation of [
      { ...baseline, liveJobs: baseline.liveJobs.slice(0, -1) },
      {
        ...baseline,
        liveJobs: [...baseline.liveJobs.slice(0, -1), { ...recordJob, conclusion: "FAILURE" }],
      },
      {
        ...baseline,
        liveJobs: [
          ...baseline.liveJobs.slice(0, -1),
          { ...recordJob, startedAt: "2026-08-24T00:00:01.001Z" },
        ],
      },
      {
        ...baseline,
        liveJobs: [
          ...baseline.liveJobs.slice(0, -1),
          { ...recordJob, completedAt: "2026-08-24T00:00:01.999Z" },
        ],
      },
      { ...baseline, liveArtifacts: baseline.liveArtifacts.slice(0, -1) },
      {
        ...baseline,
        liveArtifacts: [
          ...baseline.liveArtifacts.slice(0, -1),
          { ...recordArtifact, expired: true },
        ],
      },
      {
        ...baseline,
        liveArtifacts: [...baseline.liveArtifacts.slice(0, -1), movedRecordArtifact],
      },
      {
        ...baseline,
        liveArtifacts: [
          ...baseline.liveArtifacts.slice(0, -1),
          { ...recordArtifact, expiresAt: recordedAt },
        ],
      },
      {
        ...baseline,
        liveArtifacts: baseline.liveArtifacts.map((artifact) =>
          artifact.artifactId === "11" ? { ...artifact, runAttempt: "2" } : artifact,
        ),
      },
      {
        ...baseline,
        liveArtifacts: baseline.liveArtifacts.map((artifact) =>
          artifact.artifactId === "11" ? { ...artifact, artifactDigest: d("9") } : artifact,
        ),
      },
      { ...baseline, artifactBytes: baseline.artifactBytes.slice(0, -1) },
      {
        ...baseline,
        artifactBytes: baseline.artifactBytes.map((row) =>
          row.artifactId === "11" ? { ...row, bytes: observationZip.slice(1) } : row,
        ),
      },
    ])
      expect(github.verifyGithubTerminalEvidence(mutation).ok).toBe(false);
  });

  test("refuses noncanonical record bytes and is total for hostile wrappers", () => {
    const noncanonicalRecord = Object.fromEntries([
      ["schemaVersion", providerRecord.schemaVersion],
      ...Object.entries(providerRecord).filter(([key]) => key !== "schemaVersion"),
    ]);
    const noncanonical = text(`${JSON.stringify(noncanonicalRecord)}\n`);
    expect(
      github.verifyGithubTerminalEvidence({ ...baseline, providerRecordBytes: noncanonical }).ok,
    ).toBe(false);
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    for (const mutation of [
      { ...baseline, artifactBytes: hostile },
      { ...baseline, providerRecordBytes: hostile },
      { ...baseline, liveJobs: hostile },
    ])
      expect(() => github.verifyGithubTerminalEvidence(mutation)).not.toThrow();
  });
});

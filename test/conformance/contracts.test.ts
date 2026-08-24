import { describe, expect, test } from "vitest";
import * as conformance from "../../packages/conformance/src/index.js";

const d = (value: string): string => value.repeat(64);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const sourceBytes = bytes("export function generate(caseId) { return caseId; }\n");
const generatorParameters = Object.freeze({
  caseId: "authority-history-linear",
  iterationCount: "1",
  seed: d("1"),
});
const vector = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      expectedDisposition: "ACCEPT",
      fixtureDigest: conformance.computeConformanceVectorGeneratorDigest(
        sourceBytes,
        generatorParameters,
      ),
      fixtureId: "authority-history-linear",
      fixtureKind: "GENERATOR",
      generatorParameters,
    }),
  ]),
  schemaVersion: "conformance-vector-census/v1",
});
const vectorDigest = conformance.computeConformanceRecordDigest(
  "conformance-vector-census/v1",
  vector,
);
const bundle = Object.freeze({
  files: Object.freeze([
    Object.freeze({ byteLength: "3", path: "src/a.ts", sha256Digest: d("a") }),
  ]),
  purpose: "HARNESS",
  schemaVersion: "conformance-bundle-manifest/v1",
});
const candidate = Object.freeze({
  files: Object.freeze([
    Object.freeze({
      byteLength: "3",
      executable: false,
      path: "src/a.ts",
      sha256Digest: d("a"),
    }),
  ]),
  schemaVersion: "conformance-candidate-subject/v1",
});
const contractVersions = Object.freeze({
  schemaVersion: "conformance-contract-versions/v1",
  versions: Object.freeze(["attempt-log/v1", "authority-history/v1"]),
});
const registry = Object.freeze({
  jobs: Object.freeze(
    ["linux", "macos", "windows"].map((environmentFamily) =>
      Object.freeze({
        environmentFamily: environmentFamily.toUpperCase(),
        jobId: `iss002-contracts-${environmentFamily}`,
        requirement: "REQUIRED",
        suiteId: "iss002-contracts",
      }),
    ),
  ),
  schemaVersion: "conformance-required-job-registry/v1",
  suites: Object.freeze([
    Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "iss002-contracts",
      vectorCensusDigest: vectorDigest,
      walkRequirement: "WALK_1000",
    }),
  ]),
});
const environmentRawByFamily = Object.freeze({
  LINUX: bytes('{"image":"ubuntu-24.04"}\n'),
  MACOS: bytes('{"image":"macos-15"}\n'),
  WINDOWS: bytes('{"image":"windows-2025"}\n'),
});
const rawCommon = Object.freeze({
  report: bytes('{"executed":["authority-history-linear"]}\n'),
  stderr: bytes(""),
  stdout: bytes("ok\n"),
});

function environment(
  operatingSystem: keyof typeof environmentRawByFamily,
  helperProfileDigest: string | null = null,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    abiDigest: d("2"),
    architecture: operatingSystem === "MACOS" ? "ARM64" : "X64",
    custodyObservationDigest: null,
    filesystemProfileDigest: d("3"),
    helperProfileDigest,
    nodeVersion: "24.15.0",
    operatingSystem,
    osImageDigest: conformance.sha256Bytes(environmentRawByFamily[operatingSystem]),
    packageManagerVersion: "11.22.0",
    runnerClass: "EPHEMERAL_HOSTED",
    schemaVersion: "conformance-environment/v1",
  });
}

function rawArtifacts(operatingSystem: keyof typeof environmentRawByFamily) {
  return Object.freeze({
    environment: environmentRawByFamily[operatingSystem],
    ...rawCommon,
  });
}

function without(record: Readonly<Record<string, unknown>>, field: string) {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

function createEvidence(
  selectedRegistry: unknown,
  jobId: string,
  operatingSystem: keyof typeof environmentRawByFamily,
  duration: string | null,
) {
  return conformance.createConformanceJobEvidence({
    candidateSubjectDigest: conformance.computeConformanceRecordDigest(
      "conformance-candidate-subject/v1",
      candidate,
    ),
    contractVersionsDigest: conformance.computeConformanceRecordDigest(
      "conformance-contract-versions/v1",
      contractVersions,
    ),
    environment: environment(operatingSystem),
    harnessBundleDigest: conformance.computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      bundle,
    ),
    jobId,
    maximumWalkDurationNanoseconds: duration,
    normalizedResult: "PASS",
    providerRunDigest: d("4"),
    rawArtifacts: rawArtifacts(operatingSystem),
    registry: selectedRegistry,
    testBundleDigest: d("5"),
  });
}

describe("portable conformance contracts", () => {
  test("closes the exact nine-schema census and canonical identities", () => {
    expect(conformance.conformanceSchemaVersions).toEqual([
      "conformance-aggregate/v1",
      "conformance-bundle-manifest/v1",
      "conformance-candidate-subject/v1",
      "conformance-contract-versions/v1",
      "conformance-environment/v1",
      "conformance-job-receipt/v1",
      "conformance-raw-artifact-manifest/v1",
      "conformance-required-job-registry/v1",
      "conformance-vector-census/v1",
    ]);
    for (const [schemaVersion, value] of [
      ["conformance-bundle-manifest/v1", bundle],
      ["conformance-candidate-subject/v1", candidate],
      ["conformance-contract-versions/v1", contractVersions],
      ["conformance-vector-census/v1", vector],
      ["conformance-required-job-registry/v1", registry],
      ["conformance-environment/v1", environment("LINUX")],
    ] as const) {
      expect(conformance.parseConformanceContract(schemaVersion, value).ok).toBe(true);
      expect(
        conformance.parseConformanceContract(schemaVersion, without(value, "schemaVersion")).ok,
      ).toBe(false);
      expect(
        conformance.parseConformanceContract(schemaVersion, { ...value, extra: true }).ok,
      ).toBe(false);
    }
    expect(conformance.parseConformanceContract("unknown/v1", {}).ok).toBe(false);
  });

  test("pins exact canonical bytes and domain-separated digests", () => {
    const serialized = conformance.serializeConformanceContract(
      "conformance-bundle-manifest/v1",
      bundle,
    );
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextDecoder().decode(serialized.bytes)).toBe(
      `{"files":[{"byteLength":"3","path":"src/a.ts","sha256Digest":"${d("a")}"}],"purpose":"HARNESS","schemaVersion":"conformance-bundle-manifest/v1"}\n`,
    );
    expect(serialized.digest).toBe(
      "5d063e4a5e1103fc8a1f1e08deec672aabc88bddda85780d2553fba96eece6d2",
    );
    expect(vectorDigest).toBe("d67331c58051437259e23de119ffbfb50b5f1e46c644af75caa6fedf1a6f00d5");
    expect(
      conformance.computeConformanceVectorGeneratorDigest(sourceBytes, generatorParameters),
    ).toBe("7a3c7a2458af7f2ababf37d5704934306803e819b857e12a32978ceb94618105");
    expect(conformance.computeConformanceVectorBytesDigest(bytes("fixture"))).toBe(
      "8c149631824c4d253d04a70e27d1cf15379fbfa50599133e09fb89762b96ff7d",
    );
    expect(conformance.computeConformanceVectorBytesDigest(new Uint8Array())).toBe(
      "0a9f48975321d6a6e54525bd0200d1ebe0405be5c7a7721d20671e8c063bfa66",
    );
    expect(serialized.digest).not.toBe(vectorDigest);
    expect(
      conformance.parseCanonicalConformanceBytes(
        "conformance-bundle-manifest/v1",
        bytes(
          `{"purpose":"HARNESS","files":[],"schemaVersion":"conformance-bundle-manifest/v1"}\n`,
        ),
      ).ok,
    ).toBe(false);
  });

  test("enforces source, version, vector, and registry closure", () => {
    expect(conformance.parseConformanceCandidateSubject(candidate).ok).toBe(true);
    for (const invalid of [
      { ...candidate, files: [] },
      {
        ...candidate,
        files: [{ ...candidate.files[0], executable: "false" }],
      },
      {
        ...candidate,
        files: [
          { ...candidate.files[0], path: "z" },
          { ...candidate.files[0], path: "a" },
        ],
      },
      new Proxy(candidate, {}),
    ])
      expect(conformance.parseConformanceCandidateSubject(invalid).ok).toBe(false);
    expect(
      conformance.parseConformanceContractVersions({
        ...contractVersions,
        versions: [...contractVersions.versions].reverse(),
      }).ok,
    ).toBe(false);
    expect(
      conformance.parseConformanceVectorCensus({
        ...vector,
        entries: [{ ...vector.entries[0], generatorParameters: null }],
      }).ok,
    ).toBe(false);
    expect(
      conformance.parseConformanceVectorCensus({
        entries: [
          {
            expectedDisposition: "REFUSE",
            fixtureDigest: conformance.computeConformanceVectorBytesDigest(bytes("fixture")),
            fixtureId: "bytes-fixture",
            fixtureKind: "BYTES",
            generatorParameters: null,
          },
        ],
        schemaVersion: "conformance-vector-census/v1",
      }).ok,
    ).toBe(true);
    expect(
      conformance.parseConformanceRequiredJobRegistry({
        ...registry,
        jobs: registry.jobs.slice(0, 2),
      }).ok,
    ).toBe(true);
    expect(conformance.parseConformanceRequiredJobRegistry({ ...registry, jobs: [] }).ok).toBe(
      false,
    );
    expect(
      conformance.parseConformanceRequiredJobRegistry({
        ...registry,
        suites: [{ ...registry.suites[0], runnerToken: "CANDIDATE_SELECTED" }],
      }).ok,
    ).toBe(false);
  });

  test("builds exact raw evidence and refuses moved environment bytes", () => {
    const created = createEvidence(registry, "iss002-contracts-linux", "LINUX", "1000");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.rawArtifactManifest.entries).toEqual([
      {
        byteLength: String(environmentRawByFamily.LINUX.byteLength),
        mediaType: "APPLICATION_JSON",
        name: "environment",
        sha256Digest: conformance.sha256Bytes(environmentRawByFamily.LINUX),
      },
      {
        byteLength: String(rawCommon.report.byteLength),
        mediaType: "APPLICATION_JSON",
        name: "report",
        sha256Digest: conformance.sha256Bytes(rawCommon.report),
      },
      {
        byteLength: "0",
        mediaType: "TEXT_PLAIN",
        name: "stderr",
        sha256Digest: conformance.sha256Bytes(rawCommon.stderr),
      },
      {
        byteLength: String(rawCommon.stdout.byteLength),
        mediaType: "TEXT_PLAIN",
        name: "stdout",
        sha256Digest: conformance.sha256Bytes(rawCommon.stdout),
      },
    ]);
    expect(
      conformance.createConformanceJobEvidence({
        candidateSubjectDigest: d("1"),
        contractVersionsDigest: d("2"),
        environment: environment("LINUX"),
        harnessBundleDigest: d("3"),
        jobId: "iss002-contracts-linux",
        maximumWalkDurationNanoseconds: "1000",
        normalizedResult: "PASS",
        providerRunDigest: d("4"),
        rawArtifacts: { ...rawArtifacts("LINUX"), environment: bytes("moved") },
        registry,
        testBundleDigest: d("5"),
      }).ok,
    ).toBe(false);
    expect(
      conformance.parseConformanceJobReceipt({
        ...created.receipt,
        maximumWalkDurationNanoseconds: "1",
        normalizedResult: "FAIL",
      }).ok,
    ).toBe(false);
    expect(
      conformance.parseConformanceJobReceipt({
        ...created.receipt,
        maximumWalkDurationNanoseconds: "5000000001",
      }).ok,
    ).toBe(false);
  });

  test("derives a complete PASS aggregate in stable registry order", () => {
    const created = [
      createEvidence(registry, "iss002-contracts-linux", "LINUX", "1000"),
      createEvidence(registry, "iss002-contracts-macos", "MACOS", "1001"),
      createEvidence(registry, "iss002-contracts-windows", "WINDOWS", "1002"),
    ];
    expect(created.every((result) => result.ok)).toBe(true);
    const evidence = created.flatMap((result) =>
      result.ok
        ? [
            {
              environment: result.environment,
              rawArtifactManifest: result.rawArtifactManifest,
              receipt: result.receipt,
            },
          ]
        : [],
    );
    const aggregate = conformance.reduceConformanceAggregate(registry, evidence.reverse());
    expect(aggregate.ok).toBe(true);
    if (!aggregate.ok) return;
    expect(aggregate.value.result).toBe("PASS");
    expect(aggregate.value.jobReceiptDigests).toHaveLength(3);
    expect(conformance.parseConformanceAggregate(aggregate.value).ok).toBe(true);
    expect(conformance.reduceConformanceAggregate(registry, evidence.slice(0, 2)).ok).toBe(false);
    expect(
      conformance.reduceConformanceAggregate(registry, [
        ...evidence.slice(0, 2),
        {
          ...evidence[2],
          receipt: { ...evidence[2]!.receipt, providerRunDigest: d("9") },
        },
      ]).ok,
    ).toBe(false);
  });

  test("composes a future suite with its own vector and no walk", () => {
    const futureSuite = Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "future-suite",
      vectorCensusDigest: d("8"),
      walkRequirement: "NONE",
    });
    const futureRegistry = Object.freeze({
      jobs: Object.freeze([
        Object.freeze({
          environmentFamily: "LINUX",
          jobId: "future-suite-linux",
          requirement: "REQUIRED",
          suiteId: "future-suite",
        }),
        ...registry.jobs,
      ]),
      schemaVersion: "conformance-required-job-registry/v1",
      suites: Object.freeze([futureSuite, ...registry.suites]),
    });
    const created = [
      createEvidence(futureRegistry, "future-suite-linux", "LINUX", null),
      createEvidence(futureRegistry, "iss002-contracts-linux", "LINUX", "1000"),
      createEvidence(futureRegistry, "iss002-contracts-macos", "MACOS", "1001"),
      createEvidence(futureRegistry, "iss002-contracts-windows", "WINDOWS", "1002"),
    ];
    expect(created.every((result) => result.ok)).toBe(true);
    const evidence = created.flatMap((result) =>
      result.ok
        ? [
            {
              environment: result.environment,
              rawArtifactManifest: result.rawArtifactManifest,
              receipt: result.receipt,
            },
          ]
        : [],
    );
    expect(conformance.reduceConformanceAggregate(futureRegistry, evidence).ok).toBe(true);
  });

  test("is total for hostile public inputs", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], "value", hostile]) {
      for (const schemaVersion of conformance.conformanceSchemaVersions)
        expect(() => conformance.parseConformanceContract(schemaVersion, input)).not.toThrow();
      expect(() => conformance.reduceConformanceAggregate(input, input)).not.toThrow();
    }
  });
});

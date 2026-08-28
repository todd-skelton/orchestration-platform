import { describe, expect, test } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import {
  createIss002ObservationArtifacts,
  iss002VectorIds,
  parseCanonicalConformanceBytes,
  sha256Bytes,
} from "../../packages/conformance/src/index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

function executions(mutation: Readonly<Record<string, "FAIL" | "PASS" | "UNSUPPORTED">> = {}) {
  return iss002VectorIds.map((fixtureId) => ({
    fixtureId,
    normalizedResult: mutation[fixtureId] ?? "PASS",
  }));
}

function input() {
  return {
    abiBytes: bytes('{"modules":"137","napi":"10"}'),
    architecture: "X64" as const,
    environmentBytes: bytes('{"imageOS":"ubuntu24","imageVersion":"20260824.1"}'),
    filesystemProfileBytes: bytes('{"caseSensitive":true,"separator":"/"}'),
    jobId: "iss002-contracts-linux",
    nodeVersion: "24.15.0",
    operatingSystem: "LINUX" as const,
    packageManagerVersion: "11.22.0",
    runnerToken: "ISS002_CONTRACTS" as const,
    stderrBytes: Uint8Array.from([0, 255]),
    stdoutBytes: Uint8Array.from([1, 2, 3]),
    suiteId: "iss002-contracts" as const,
    vectorExecutions: executions(),
    walkDurationsNanoseconds: ["3", "10", "2"],
  };
}

describe("ISS-002 stable observation artifacts", () => {
  test("derives canonical environment, report, and exact raw manifest without a receipt", () => {
    const source = input();
    const created = createIss002ObservationArtifacts(source);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.normalizedResult).toBe("PASS");
    expect(created.maximumWalkDurationNanoseconds).toBe("10");
    expect(created.environment).toMatchObject({
      abiDigest: sha256Bytes(source.abiBytes),
      filesystemProfileDigest: sha256Bytes(source.filesystemProfileBytes),
      osImageDigest: sha256Bytes(source.environmentBytes),
    });
    expect(
      parseCanonicalConformanceBytes("conformance-environment/v1", created.environmentRecordBytes)
        .ok,
    ).toBe(true);
    expect(
      parseCanonicalConformanceBytes(
        "conformance-raw-artifact-manifest/v1",
        created.rawManifestBytes,
      ).ok,
    ).toBe(true);
    expect(created.rawArtifactManifest.entries).toEqual([
      {
        byteLength: String(source.environmentBytes.byteLength),
        mediaType: "APPLICATION_JSON",
        name: "environment",
        sha256Digest: sha256Bytes(source.environmentBytes),
      },
      {
        byteLength: String(created.reportBytes.byteLength),
        mediaType: "APPLICATION_JSON",
        name: "report",
        sha256Digest: sha256Bytes(created.reportBytes),
      },
      {
        byteLength: "2",
        mediaType: "TEXT_PLAIN",
        name: "stderr",
        sha256Digest: sha256Bytes(source.stderrBytes),
      },
      {
        byteLength: "3",
        mediaType: "TEXT_PLAIN",
        name: "stdout",
        sha256Digest: sha256Bytes(source.stdoutBytes),
      },
    ]);
    const report = JSON.parse(new TextDecoder().decode(created.reportBytes));
    expect(canonicalJson(report)).toBe(new TextDecoder().decode(created.reportBytes));
    expect(report.executedVectors).toHaveLength(22);
    expect(report.walkDurationsNanoseconds).toEqual(["3", "10", "2"]);
    for (const value of [created.environment, created.rawArtifactManifest, report]) {
      expect(value).not.toHaveProperty("receipt");
      expect(value).not.toHaveProperty("providerRunDigest");
      expect(value).not.toHaveProperty("candidateSubjectDigest");
    }
  });

  test("derives FAIL and UNSUPPORTED only from the complete stable vector census", () => {
    for (const [fixtureId, expected] of [
      ["authority-history-linear", "FAIL"],
      ["pointer-kind-census", "UNSUPPORTED"],
    ] as const) {
      const source = input();
      const created = createIss002ObservationArtifacts({
        ...source,
        vectorExecutions: executions({ [fixtureId]: expected }),
      });
      expect(created).toMatchObject({ normalizedResult: expected, ok: true });
    }
    const failedWalk = createIss002ObservationArtifacts({
      ...input(),
      vectorExecutions: executions({ "walk-1000-records": "FAIL" }),
      walkDurationsNanoseconds: null,
    });
    expect(failedWalk).toMatchObject({
      maximumWalkDurationNanoseconds: null,
      normalizedResult: "FAIL",
      ok: true,
    });
  });

  test("refuses missing, duplicate, reordered, extra, and forged walk evidence", () => {
    const source = input();
    const mutations: unknown[] = [
      source.vectorExecutions.slice(1),
      [...source.vectorExecutions.slice(0, -1), source.vectorExecutions[0]],
      [...source.vectorExecutions].reverse(),
      [...source.vectorExecutions, source.vectorExecutions[0]],
    ];
    for (const vectorExecutions of mutations)
      expect(
        createIss002ObservationArtifacts({
          ...source,
          vectorExecutions,
        } as Parameters<typeof createIss002ObservationArtifacts>[0]).ok,
      ).toBe(false);
    for (const walkDurationsNanoseconds of [
      null,
      [],
      ["1", "2"],
      ["1", "2", "5000000001"],
      ["1", "02", "3"],
    ] as const)
      expect(
        createIss002ObservationArtifacts({
          ...source,
          walkDurationsNanoseconds,
        } as Parameters<typeof createIss002ObservationArtifacts>[0]).ok,
      ).toBe(false);
    expect(
      createIss002ObservationArtifacts({
        ...source,
        vectorExecutions: executions({ "walk-1000-records": "FAIL" }),
      }).ok,
    ).toBe(false);
  });

  test("refuses runner mismatch, malformed versions, byte subclasses, and reflective input", () => {
    const source = input();
    for (const mutation of [
      { jobId: "iss002-contracts-windows" },
      { nodeVersion: "26.0.0" },
      { packageManagerVersion: "11.22.0-beta.1" },
      { environmentBytes: Buffer.from("buffer-subclass") },
      { environmentBytes: new Uint8Array() },
      { environmentBytes: Uint8Array.from([0xff]) },
      { abiBytes: new Uint8Array() },
      { extra: true },
    ])
      expect(createIss002ObservationArtifacts({ ...source, ...mutation } as never).ok).toBe(false);
    expect(createIss002ObservationArtifacts(new Proxy(source, {}) as never).ok).toBe(false);
    let getterCalls = 0;
    const accessor = { ...source };
    Object.defineProperty(accessor, "jobId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return source.jobId;
      },
    });
    expect(createIss002ObservationArtifacts(accessor).ok).toBe(false);
    expect(getterCalls).toBe(0);
  });
});

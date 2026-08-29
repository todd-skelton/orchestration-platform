import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import {
  createIss022RequiredJobRegistry,
  iss022PortablePrimitiveVectorCensus,
  iss022PortablePrimitiveVectorCensusDigest,
  iss022CustodyRootIsAbsent,
  parseIss022RequiredJobRegistry,
  parseIss022StableRawReport,
  parseIss022SuiteCoordinates,
  runIss022PortablePrimitivesStableSuite,
  type Iss022StableSuiteResult,
} from "../../packages/conformance/src/index.js";
import { portablePrimitiveCaseIds } from "../../probes/portable-primitives/src/index.js";

const digest = (value: string) => value.repeat(64);
const operatingSystem =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const coordinates = Object.freeze({
  environmentDigest: digest("a"),
  jobId: `iss022-portable-primitives-${operatingSystem}`,
  observedAt: "2026-08-28T18:00:00.000Z",
  providerRunDigest: digest("b"),
});
const stableRoot = resolve(import.meta.dirname, "../..");
let parentRoot: string;
let result: Iss022StableSuiteResult;

function copyReport() {
  if (!result.ok) throw new Error(result.issues.join(","));
  return JSON.parse(canonicalJson(result.report)) as Record<string, any>;
}

function accepted(input: unknown, expected: unknown = coordinates): boolean {
  return parseIss022StableRawReport(input, expected).ok;
}

beforeAll(async () => {
  parentRoot = await mkdtemp(resolve(tmpdir(), "orchestration-iss022-suite-parent-"));
  result = await runIss022PortablePrimitivesStableSuite({
    custodyParentRoot: parentRoot,
    stableRoot,
    ...coordinates,
  });
}, 180_000);

afterAll(async () => {
  if (parentRoot) await rm(parentRoot, { force: true, recursive: true });
});

describe("ISS-022 stable portable-primitives suite composer", () => {
  test("binds the exact stable registry row and LINUX/MACOS/WINDOWS job order", () => {
    const registry = createIss022RequiredJobRegistry();
    expect(registry).toEqual({
      jobs: [
        {
          environmentFamily: "LINUX",
          jobId: "iss022-portable-primitives-linux",
          requirement: "REQUIRED",
          suiteId: "iss022-portable-primitives",
        },
        {
          environmentFamily: "MACOS",
          jobId: "iss022-portable-primitives-macos",
          requirement: "REQUIRED",
          suiteId: "iss022-portable-primitives",
        },
        {
          environmentFamily: "WINDOWS",
          jobId: "iss022-portable-primitives-windows",
          requirement: "REQUIRED",
          suiteId: "iss022-portable-primitives",
        },
      ],
      schemaVersion: "conformance-required-job-registry/v1",
      suites: [
        {
          custodyRequirement: "REQUIRED",
          helperRequirement: "REQUIRED",
          ownerPackage: "@orchestration-platform/portable-primitives",
          runnerToken: "ISS022_PORTABLE_PRIMITIVES",
          suiteId: "iss022-portable-primitives",
          vectorCensusDigest: iss022PortablePrimitiveVectorCensusDigest,
          walkRequirement: "NONE",
        },
      ],
    });
    expect(parseIss022RequiredJobRegistry(registry).ok).toBe(true);
  });

  test("refuses every registry census and stable-authority substitution", () => {
    const registry = createIss022RequiredJobRegistry() as any;
    const jobs = registry.jobs as any[];
    const suite = registry.suites[0] as Record<string, unknown>;
    for (const mutant of [
      { ...registry, jobs: jobs.slice(0, 2) },
      {
        ...registry,
        jobs: [
          {
            ...jobs[0],
            jobId: "iss022-portable-primitives-extra",
          },
          ...jobs,
        ],
      },
      { ...registry, jobs: [...jobs, jobs[0]] },
      { ...registry, jobs: [...jobs].reverse() },
      {
        ...registry,
        jobs: jobs.map((job, index) =>
          index === 0 ? { ...job, jobId: "iss022-portable-primitives-a" } : job,
        ),
      },
      {
        ...registry,
        jobs: jobs.map((job, index) =>
          index === 0 ? { ...job, environmentFamily: "MACOS" } : job,
        ),
      },
      { ...registry, suites: [{ ...suite, ownerPackage: "@orchestration-platform/contracts" }] },
      { ...registry, suites: [{ ...suite, runnerToken: "ISS002_CONTRACTS" }] },
      { ...registry, suites: [{ ...suite, vectorCensusDigest: digest("f") }] },
      { ...registry, suites: [{ ...suite, custodyRequirement: "UNUSED" }] },
      { ...registry, suites: [{ ...suite, helperRequirement: "UNUSED" }] },
      { ...registry, suites: [{ ...suite, walkRequirement: "WALK_1000" }] },
      { ...registry, suites: [...registry.suites, suite] },
    ])
      expect(parseIss022RequiredJobRegistry(mutant).ok).toBe(false);
  });

  test("runs the eight stable groups once into one exact canonical raw report", async () => {
    expect(result.ok, result.ok ? undefined : result.issues.join(",")).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.reportBytes)).toEqual(Buffer.from(canonicalJson(result.report)));
    expect(result.report.schemaVersion).toBe("portable-primitives-stable-raw-report/v1");
    expect(result.report).not.toHaveProperty("result");
    expect(result.report).not.toHaveProperty("candidateVerdict");
    expect((result.report.vectorExecutions as any[]).map(({ caseId }) => caseId)).toEqual(
      portablePrimitiveCaseIds,
    );
    expect(result.report.vectorCensus).toEqual(iss022PortablePrimitiveVectorCensus);
    expect(result.report.vectorCensusDigest).toBe(iss022PortablePrimitiveVectorCensusDigest);
    const inventoryIds = (result.report.vectorCensus as any).entries.map(
      ({ fixtureId }: any) => fixtureId,
    );
    expect(inventoryIds).toEqual(
      [...inventoryIds].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    );
    expect(inventoryIds).not.toEqual(
      portablePrimitiveCaseIds.map((caseId) => caseId.toLowerCase()),
    );
    expect((result.report.selection as any).operatingSystem).toBe(operatingSystem.toUpperCase());
    expect((result.report.selection as any).locatorObservation.disposition).toBe("ADMITTED");
    expect(accepted(result.report)).toBe(true);
    expect(await readdir(parentRoot)).toEqual([]);
  });

  test("refuses reordered, missing, extra, duplicated, or candidate-declared vector authority", () => {
    for (const mutate of [
      (report: any) => report.vectorExecutions.reverse(),
      (report: any) => report.vectorExecutions.pop(),
      (report: any) => report.vectorExecutions.push(report.vectorExecutions.at(-1)),
      (report: any) => (report.vectorExecutions[1] = report.vectorExecutions[0]),
      (report: any) => (report.candidateVerdict = "PASS"),
      (report: any) => (report.result = "PASS"),
    ]) {
      const report = copyReport();
      mutate(report);
      expect(accepted(report)).toBe(false);
    }
  });

  test("refuses malformed coordinates and TOCTOU/reflection inputs", () => {
    expect(parseIss022SuiteCoordinates({ ...coordinates, jobId: "UPPER" }, false).ok).toBe(false);
    expect(accepted(new Proxy(copyReport(), {}))).toBe(false);
    const report = copyReport();
    Object.defineProperty(report, "providerRunDigest", {
      enumerable: true,
      get: () => coordinates.providerRunDigest,
    });
    expect(accepted(report)).toBe(false);
    const expected = { ...coordinates };
    Object.defineProperty(expected, "jobId", { enumerable: true, get: () => coordinates.jobId });
    expect(accepted(copyReport(), expected)).toBe(false);
  });

  test("refuses a custody root that remains present after cleanup", async () => {
    const survivor = await mkdtemp(resolve(parentRoot, "cleanup-mutant-"));
    expect(await iss022CustodyRootIsAbsent(survivor)).toBe(false);
    await rm(survivor, { recursive: true });
    expect(await iss022CustodyRootIsAbsent(survivor)).toBe(true);
  });
});

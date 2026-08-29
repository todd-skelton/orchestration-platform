import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  canonicalJson,
  parsePhysicalLocatorObservation,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import {
  constructIss022ProfileArtifacts,
  parseIss022SuiteCoordinates,
  runIss022PhysicalStableHandler,
  validateIss022ProfileArtifacts,
  validIss022ExecutableCapture,
  withIss022ExecutableCustody,
} from "../../packages/conformance/src/index.js";
import {
  computePortablePrimitivesPreCustodyEnvironmentDigest,
  computePortableProbeCustodyInstanceDigest,
  parsePortablePrimitivesOsProfile,
  parsePortableProbeCustodyReceipt,
} from "../../probes/portable-primitives/src/index.js";

const digest = (value: string) => value.repeat(64);
const operatingSystem =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const coordinates = Object.freeze({
  architecture: (process.arch === "arm64" ? "ARM64" : "X64") as "ARM64" | "X64",
  jobId: `iss022-portable-primitives-${operatingSystem}`,
  observedAt: "2026-08-28T18:00:00.000Z",
  osImageDigest: digest("a"),
  packageManagerVersion: "11.22.0",
  providerRunDigest: digest("b"),
});
let parentRoot: string;
let executions: ContractRecord[];
let report: ContractRecord;

function copyReport() {
  return JSON.parse(canonicalJson(report)) as Record<string, any>;
}

function copyExecutions() {
  return JSON.parse(canonicalJson(executions)) as Record<string, any>[];
}

function accepted(
  input: ContractRecord,
  expected: unknown = coordinates,
  rows = executions,
): boolean {
  return validateIss022ProfileArtifacts(input, rows, expected, digest("c")).length === 0;
}

beforeAll(async () => {
  parentRoot = await mkdtemp(resolve(tmpdir(), "orchestration-iss022-profile-parent-"));
  const custody = await withIss022ExecutableCustody(() =>
    runIss022PhysicalStableHandler(parentRoot),
  );
  if (!custody.value.ok) throw new Error(custody.value.issues.join(","));
  executions = [...custody.value.vectorExecutions] as unknown as ContractRecord[];
  const artifacts = constructIss022ProfileArtifacts(
    executions,
    custody.executableCapture,
    coordinates,
    digest("c"),
  );
  if (!artifacts.ok) throw new Error(artifacts.issues.join(","));
  report = Object.freeze({ executableCapture: custody.executableCapture, ...artifacts.value });
}, 180_000);

afterAll(async () => {
  if (parentRoot) await rm(parentRoot, { force: true, recursive: true });
});

describe("ISS-022 executable, profile, custody, and locator authority", () => {
  test("retains executable custody and refuses dynamic path or byte substitution", async () => {
    const root = await mkdtemp(resolve(parentRoot, "executable-mutant-"));
    const first = resolve(root, "first.exe");
    const second = resolve(root, "second.exe");
    const descriptor = Object.getOwnPropertyDescriptor(process, "execPath")!;
    await writeFile(first, "first");
    await writeFile(second, "second");
    try {
      Object.defineProperty(process, "execPath", { ...descriptor, value: first });
      await expect(
        withIss022ExecutableCustody(async () => {
          Object.defineProperty(process, "execPath", { ...descriptor, value: second });
        }),
      ).rejects.toThrow();
      Object.defineProperty(process, "execPath", { ...descriptor, value: first });
      await expect(
        withIss022ExecutableCustody(async () => writeFile(first, "substituted-bytes")),
      ).rejects.toThrow();
    } finally {
      Object.defineProperty(process, "execPath", descriptor);
      await rm(root, { force: true, recursive: true });
    }
  });

  test("captures one stable executable identity and binds exact Node, ABI, and helper bytes", () => {
    expect(validIss022ExecutableCapture(report.executableCapture)).toBe(true);
    const selection = report.selection as any;
    expect(parsePortablePrimitivesOsProfile(selection.osProfile).ok).toBe(true);
    expect(parsePortableProbeCustodyReceipt(selection.custodyReceipt).ok).toBe(true);
    expect(parsePhysicalLocatorObservation(selection.locatorObservation).ok).toBe(true);
    for (const mutate of [
      (report: any) => (report.executableCapture.realpathAfter += ".moved"),
      (report: any) => (report.executableCapture.handleAfter.inodeBytes = "f".repeat(16)),
      (report: any) => (report.executableCapture.pathAfter.sizeBytes = "0".repeat(16)),
      (report: any) => (report.executableCapture.executableBytesDigest = digest("f")),
      (report: any) => (report.executableCapture.nodeVersion = "25.0.0"),
      (report: any) => (report.executableCapture.modulesVersion = "0137"),
      (report: any) => (report.executableCapture.napiVersion = "0"),
    ]) {
      const report = copyReport();
      mutate(report);
      expect(accepted(report)).toBe(false);
    }
  });

  test("derives the OS profile from exact raw aliases and admits only PHYSICAL_ABSENT_LEAF", () => {
    const existing = copyReport();
    existing.selection.physicalDestinationIdentity = (
      executions[0]!.rawFacts as any
    ).derivation.physicalDestinationIdentity;
    expect(accepted(existing)).toBe(false);
    for (const mutate of [
      (report: any, rows: any[]) => (rows[1].rawFacts.rootStable = false),
      (_report: any, rows: any[]) => (rows[2].rawFacts.relationBefore = "DISTINCT_EXISTING"),
      (_report: any, rows: any[]) => (rows[3].rawFacts.relationAfter = "DISTINCT_EXISTING"),
      (_report: any, rows: any[]) => (rows[2].normalizedResult = "UNSUPPORTED"),
      (report: any) => (report.selection.osProfile.filesystemTypeBytes = "f".repeat(16)),
      (report: any) =>
        (report.selection.osProfile.caseComparisonProfile =
          report.selection.osProfile.caseComparisonProfile === "CASE_SENSITIVE"
            ? "CASE_INSENSITIVE_LOWERCASE"
            : "CASE_SENSITIVE"),
    ]) {
      const mutantReport = copyReport();
      const rows = copyExecutions();
      mutate(mutantReport, rows);
      expect(accepted(mutantReport, coordinates, rows)).toBe(false);
    }
  });

  test("derives the acyclic pre-custody identity and equal-binds all stable coordinates", () => {
    const selection = report.selection as any;
    const derivation = (executions[1]!.rawFacts as any).derivation;
    const preCustodyEnvironmentDigest = computePortablePrimitivesPreCustodyEnvironmentDigest(
      String(report.helperAbiDigest),
      coordinates.architecture as "ARM64" | "X64",
      String(selection.osProfileDigest),
      String(report.helperProfileDigest),
      String((report.executableCapture as any).nodeVersion),
      selection.operatingSystem,
      coordinates.osImageDigest,
      coordinates.packageManagerVersion,
    );
    expect(
      computePortableProbeCustodyInstanceDigest(
        String(derivation.hostCustodyNamespaceDigest),
        preCustodyEnvironmentDigest,
        coordinates.providerRunDigest,
        coordinates.jobId,
        String(derivation.rootReadbackDigest),
      ),
    ).toBe(selection.custodyInstanceDigest);
    for (const mutate of [
      (report: any) => (report.selection.custodyInstanceDigest = digest("c")),
      (report: any) => (report.selection.custodyReceipt.helperDigest = digest("d")),
      (report: any) => (report.selection.locatorObservation.custodyReceiptDigest = digest("e")),
    ]) {
      const report = copyReport();
      mutate(report);
      expect(accepted(report)).toBe(false);
    }
    for (const coordinateMutant of [
      { ...coordinates, architecture: coordinates.architecture === "X64" ? "ARM64" : "X64" },
      { ...coordinates, osImageDigest: digest("c") },
      { ...coordinates, packageManagerVersion: "11.23.0" },
      { ...coordinates, providerRunDigest: digest("c") },
    ])
      expect(accepted(copyReport(), coordinateMutant)).toBe(false);
  });

  test("refuses caller-supplied final or pre-custody environment identities", () => {
    expect(parseIss022SuiteCoordinates(coordinates, false).ok).toBe(true);
    for (const input of [
      { ...coordinates, environmentDigest: digest("d") },
      { ...coordinates, preCustodyEnvironmentDigest: digest("e") },
      { ...coordinates, architecture: "IA32" },
      { ...coordinates, osImageDigest: null },
      { ...coordinates, packageManagerVersion: "v11.22.0" },
    ])
      expect(parseIss022SuiteCoordinates(input, false).ok).toBe(false);
  });

  test("selects null for exact non-PASS physical diagnostics and refuses crossed arms", () => {
    const allPassNull = copyReport();
    allPassNull.selection = null;
    expect(accepted(allPassNull)).toBe(false);
    for (const index of [0, 4, 5]) {
      const rows = copyExecutions();
      if (index === 0) rows[index]!.rawFacts.rootStable = false;
      if (index === 4) rows[index]!.rawFacts.locatorStable = true;
      if (index === 5) rows[index]!.rawFacts.rootStable = true;
      rows[index]!.normalizedResult = "UNKNOWN";
      const constructed = constructIss022ProfileArtifacts(
        rows,
        report.executableCapture,
        coordinates,
        digest("c"),
      );
      expect(constructed.ok && constructed.value.selection).toBe(null);
      expect(accepted(copyReport(), coordinates, rows)).toBe(false);
      const diagnostic = copyReport();
      diagnostic.selection = null;
      expect(accepted(diagnostic, coordinates, rows)).toBe(true);
    }
  });
});

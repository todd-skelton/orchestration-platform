import { lstat, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalBytes,
  canonicalJson,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  canonicalPortablePrimitiveCustodyRoot,
  computePortablePrimitiveVectorDigest,
  portablePrimitiveCaseIds,
  portablePrimitiveVectors,
} from "@orchestration-platform/portable-primitives";
import {
  computeConformanceRecordDigest,
  parseConformanceRequiredJobRegistry,
  parseConformanceVectorCensus,
} from "./contracts.js";
import {
  normalizeIss022AbsenceProbe,
  normalizeIss022CasProbe,
  normalizeIss022CreateOnceProbe,
  normalizeIss022LockProbe,
  normalizeIss022ParserProbe,
  normalizeIss022PhysicalProbe,
  normalizeIss022ReplaceProbe,
  normalizeIss022RuntimeProbe,
  runIss022AbsenceStableHandler,
  runIss022CasStableHandler,
  runIss022CreateOnceStableHandler,
  runIss022LockStableHandler,
  runIss022ParserStableHandler,
  runIss022PhysicalStableHandler,
  runIss022ReplaceStableHandler,
  runIss022RuntimeStableHandler,
} from "./iss022-handler.js";
import {
  constructIss022ProfileArtifacts,
  iss022CoordinateFields,
  parseIss022SuiteCoordinates,
  validateIss022ProfileArtifacts,
  withIss022ExecutableCustody,
} from "./iss022-profile.js";
const reportFields = Object.freeze([
  "environmentDigest",
  "executableCapture",
  "helperAbiDigest",
  "helperDigest",
  "helperProfileDigest",
  "jobId",
  "observedAt",
  "providerRunDigest",
  "schemaVersion",
  "selection",
  "vectorCensus",
  "vectorCensusDigest",
  "vectorExecutions",
] as const);
const executionFields = Object.freeze(["caseId", "normalizedResult", "rawFacts"] as const);

export type Iss022StableSuiteResult =
  | { readonly ok: true; readonly report: ContractRecord; readonly reportBytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): Iss022StableSuiteResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function fixtureId(caseId: string): string {
  return caseId.toLowerCase().replaceAll("_", "-");
}

export const iss022PortablePrimitiveVectorCensus = (() => {
  const entries = portablePrimitiveVectors
    .map((vector) =>
      Object.freeze({
        expectedDisposition: "ACCEPT",
        fixtureDigest: computePortablePrimitiveVectorDigest(vector),
        fixtureId: fixtureId(String(vector.caseId)),
        fixtureKind: "BYTES",
        generatorParameters: null,
      }),
    )
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.fixtureId), Buffer.from(right.fixtureId)),
    );
  const value = Object.freeze({
    entries: Object.freeze(entries),
    schemaVersion: "conformance-vector-census/v1",
  });
  const parsed = parseConformanceVectorCensus(value);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
})();

export const iss022PortablePrimitiveVectorCensusDigest = computeConformanceRecordDigest(
  "conformance-vector-census/v1",
  iss022PortablePrimitiveVectorCensus,
);

const iss022RequiredJobs = Object.freeze([
  Object.freeze({
    environmentFamily: "LINUX",
    jobId: "iss022-portable-primitives-linux",
    requirement: "REQUIRED",
    suiteId: "iss022-portable-primitives",
  }),
  Object.freeze({
    environmentFamily: "MACOS",
    jobId: "iss022-portable-primitives-macos",
    requirement: "REQUIRED",
    suiteId: "iss022-portable-primitives",
  }),
  Object.freeze({
    environmentFamily: "WINDOWS",
    jobId: "iss022-portable-primitives-windows",
    requirement: "REQUIRED",
    suiteId: "iss022-portable-primitives",
  }),
]);

export function createIss022RequiredJobRegistry(): ContractRecord {
  const registry = Object.freeze({
    jobs: iss022RequiredJobs,
    schemaVersion: "conformance-required-job-registry/v1",
    suites: Object.freeze([
      Object.freeze({
        custodyRequirement: "REQUIRED",
        helperRequirement: "REQUIRED",
        ownerPackage: "@orchestration-platform/portable-primitives",
        runnerToken: "ISS022_PORTABLE_PRIMITIVES",
        suiteId: "iss022-portable-primitives",
        vectorCensusDigest: iss022PortablePrimitiveVectorCensusDigest,
        walkRequirement: "NONE",
      }),
    ]),
  });
  const parsed = parseConformanceRequiredJobRegistry(registry);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function parseIss022RequiredJobRegistry(input: unknown): ParseResult {
  const parsed = parseConformanceRequiredJobRegistry(input);
  if (!parsed.ok) return parsed;
  return canonicalJson(parsed.value) === canonicalJson(createIss022RequiredJobRegistry())
    ? parsed
    : { ok: false, issues: Object.freeze(["registry:iss022-census-mismatch"]) };
}

function normalizedExecutions(input: unknown): readonly ContractRecord[] | undefined {
  if (!Array.isArray(input) || input.length !== portablePrimitiveCaseIds.length) return undefined;
  const executions: ContractRecord[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const parsed = snapshotClosedRecord(input[index], executionFields);
    if (!parsed.ok || parsed.value.caseId !== portablePrimitiveCaseIds[index]) return undefined;
    executions.push(parsed.value);
  }
  const raw = executions.map((row) => row.rawFacts);
  const groups = [
    normalizeIss022PhysicalProbe(raw.slice(0, 6)),
    normalizeIss022CreateOnceProbe(raw[6]),
    normalizeIss022LockProbe(raw.slice(7, 10)),
    normalizeIss022ReplaceProbe(raw.slice(10, 15)),
    normalizeIss022CasProbe(raw.slice(15, 17)),
    normalizeIss022AbsenceProbe(raw[17]),
    normalizeIss022RuntimeProbe(raw.slice(18, 20)),
    normalizeIss022ParserProbe(raw[20]),
  ];
  if (groups.some((group) => !group.ok)) return undefined;
  const stable = groups.flatMap((group) => (group.ok ? [...group.vectorExecutions] : []));
  return canonicalJson(stable) === canonicalJson(executions)
    ? Object.freeze(executions)
    : undefined;
}

export async function iss022CustodyRootIsAbsent(root: string): Promise<boolean> {
  try {
    await lstat(root);
    return false;
  } catch (error) {
    return (
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
    );
  }
}

export function parseIss022StableRawReport(
  input: unknown,
  expectedCoordinates: unknown,
): Iss022StableSuiteResult {
  try {
    const expected = parseIss022SuiteCoordinates(expectedCoordinates, false);
    const parsed = snapshotClosedRecord(input, reportFields);
    if (!expected.ok) return refusal(...expected.issues);
    if (!parsed.ok) return refusal(...parsed.issues);
    const report = parsed.value;
    if (report.schemaVersion !== "portable-primitives-stable-raw-report/v1")
      return refusal("schemaVersion:mismatch");
    for (const field of iss022CoordinateFields)
      if (report[field] !== expected.value[field]) return refusal(`${field}:mismatch`);
    const executions = normalizedExecutions(report.vectorExecutions);
    if (!executions) return refusal("vectorExecutions:refused");
    if (canonicalJson(report.vectorCensus) !== canonicalJson(iss022PortablePrimitiveVectorCensus))
      return refusal("vectorCensus:mismatch");
    if (report.vectorCensusDigest !== iss022PortablePrimitiveVectorCensusDigest)
      return refusal("vectorCensusDigest:mismatch");
    const profileIssues = validateIss022ProfileArtifacts(
      report,
      executions,
      expected.value,
      iss022PortablePrimitiveVectorCensusDigest,
    );
    if (profileIssues.length > 0) return refusal(...profileIssues);
    return { ok: true, report, reportBytes: canonicalBytes(report) };
  } catch {
    return refusal("report:unreadable");
  }
}

export async function runIss022PortablePrimitivesStableSuite(
  input: unknown,
): Promise<Iss022StableSuiteResult> {
  const parsed = parseIss022SuiteCoordinates(input, true);
  if (!parsed.ok) return refusal(...parsed.issues);
  let root: string | undefined;
  try {
    const parent = await canonicalPortablePrimitiveCustodyRoot(
      String(parsed.value.custodyParentRoot),
    );
    root = await mkdtemp(resolve(parent, "iss022-portable-primitives-"));
    const custody = await withIss022ExecutableCustody(async () =>
      Object.freeze([
        await runIss022PhysicalStableHandler(root!),
        await runIss022CreateOnceStableHandler(root!),
        await runIss022LockStableHandler(root!),
        await runIss022ReplaceStableHandler(root!),
        await runIss022CasStableHandler(root!),
        await runIss022AbsenceStableHandler(root!),
        await runIss022RuntimeStableHandler(root!),
        await runIss022ParserStableHandler(String(parsed.value.stableRoot)),
      ]),
    );
    const executableCapture = custody.executableCapture;
    const groups = custody.value;
    const handlerIssues = groups.flatMap((group, index) =>
      group.ok ? [] : group.issues.map((issue) => `handler.${index}.${issue}`),
    );
    if (handlerIssues.length > 0) return refusal(...handlerIssues);
    const vectorExecutions = Object.freeze(
      groups.flatMap((group) => (group.ok ? [...group.vectorExecutions] : [])),
    );
    if (
      vectorExecutions.length !== portablePrimitiveCaseIds.length ||
      vectorExecutions.some((row, index) => row.caseId !== portablePrimitiveCaseIds[index])
    )
      return refusal("vectorExecutions:order-refused");
    const coordinates = Object.freeze({
      environmentDigest: parsed.value.environmentDigest,
      jobId: parsed.value.jobId,
      observedAt: parsed.value.observedAt,
      providerRunDigest: parsed.value.providerRunDigest,
    });
    const artifacts = constructIss022ProfileArtifacts(
      vectorExecutions as unknown as ContractRecord[],
      executableCapture,
      coordinates,
      iss022PortablePrimitiveVectorCensusDigest,
    );
    if (!artifacts.ok) return refusal(...artifacts.issues);
    const report = Object.freeze({
      ...artifacts.value,
      environmentDigest: parsed.value.environmentDigest,
      executableCapture,
      jobId: parsed.value.jobId,
      observedAt: parsed.value.observedAt,
      providerRunDigest: parsed.value.providerRunDigest,
      schemaVersion: "portable-primitives-stable-raw-report/v1",
      vectorCensus: iss022PortablePrimitiveVectorCensus,
      vectorCensusDigest: iss022PortablePrimitiveVectorCensusDigest,
      vectorExecutions,
    });
    return parseIss022StableRawReport(report, coordinates);
  } catch {
    return refusal("suite:execution-refused");
  } finally {
    if (root) {
      try {
        await rm(root, { force: true, recursive: true });
      } catch {
        return refusal("custodyRoot:cleanup-refused");
      }
      if (!(await iss022CustodyRootIsAbsent(root))) return refusal("custodyRoot:cleanup-refused");
    }
  }
}

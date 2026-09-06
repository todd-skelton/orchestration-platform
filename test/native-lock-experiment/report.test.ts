import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  hostedNativeLockControlIds,
  hostedNativeLockSuiteId,
} from "../../scripts/conformance/hosted-native-lock-plan.mjs";
import {
  completeHostedNativeLockLoadedMembers,
  hostedNativeLockLoadedOutputNames,
} from "../../scripts/conformance/hosted-native-lock-preparation.mjs";

/**
 * ISS-048 stage-three sub-slice 3.4. Nothing here compiles, downloads, installs
 * or loads a native binary, requires a `.node`, spawns a fixture child, takes an
 * OS lock, runs a case, seals an archive, uploads anything, calls a provider or
 * writes a workflow. Every reducer input below is synthetic diagnostic data and
 * every guard reached is a stable one.
 *
 * Two things are deliberately explicit, because both look like the thing the
 * ledger forbids and neither is:
 *
 *  1. `reduceNativeLockPerOs` returns `OBSERVED` for a hand-built evidence
 *     bundle in this file. That is the reducer's arithmetic over synthetic
 *     records, never a native observation, and no path from it reaches a report:
 *     `produceNativeLockReport` discloses every boundary substitution and the
 *     reducer treats any disclosure as disqualifying, so a substituted run can
 *     never publish `OBSERVED`, and an unsubstituted run under Vitest has no
 *     toolchain, so its two build rows are never `BUILT`, the case phase is
 *     never entered, and all four case rows stay `UNSUPPORTED` or `UNKNOWN`.
 *     The positive evidence in this file is therefore structural throughout.
 *  2. One test writes a few bytes into a temporary file whose name ends in
 *     `.node`. It is never required, loaded, executed or committed; it exists
 *     only so the post-load rehash has bytes to reread.
 *
 * `probes/portable-primitives/experiment/*.mjs` are landed JavaScript modules
 * with no declaration file, and `tsconfig.json` sets no `allowJs`, so `tsc`
 * reports TS7016 for each import below. Sub-slice 3.4's footprint may not add a
 * declaration file or change the compiler configuration, so every one of them
 * is suppressed once and immediately bound to a locally declared shape.
 */

type FileRow = { byteLength: string; path: string; sha256: string };
type BuildRow = {
  argv: string[] | null;
  inputs: FileRow[] | null;
  loaded: FileRow[] | null;
  outputs: FileRow[] | null;
  result: string;
  revision: string;
  role: string;
  toolchain: { compilerPath: string; compilerVersion: string; sdkVersion: string } | null;
};
type CaseRow = { caseId: string; events: Array<Record<string, unknown>>; result: string };
type ControlRow = { controlId: string; refused: boolean | null; result: string };
type Custody = {
  finalByteHex: string | null;
  finalIdentity: unknown;
  initialByteHex: string | null;
  initialIdentity: unknown;
  leafName: string;
  rootPath: string | null;
};
type Coordinates = Record<string, string>;
type Report = {
  builds: BuildRow[];
  cases: CaseRow[];
  controls: ControlRow[];
  coordinates: Coordinates;
  custody: Custody;
  experiment: string;
  result: string;
};
type Substitutions = {
  fixtures: boolean;
  gates: string[];
  guards: string[];
  seam: string;
  spawn: boolean;
};
type Observation = {
  archiveRelativeInputPath: string | null;
  controlId: string;
  deferredHalves: string[];
  detail: string;
  evidence: string;
  executedHalf: string | null;
  guard: string | null;
  mutant: string | null;
  prerequisite: string | null;
  refused: boolean | null;
  result: string;
  substitutions: Substitutions;
  witnessDisposition: string | null;
};
type TranscriptRow = { caseId: string; failures: unknown[]; transcriptResult: string };
type Transcript = {
  cases: TranscriptRow[];
  failures: unknown[];
  missingPrerequisites: readonly string[];
  result: string;
  transcriptResult: string;
};
type Bundle = {
  cleanupFailures: string[];
  controlObservations: Observation[];
  controlRetainedPaths: string[];
  loadedRoles: string[];
  plan: Record<string, string>;
  prerequisites: Record<string, string>;
  report: Report;
  retainedFiles: FileRow[];
  sealedFiles: FileRow[];
  substitutions: { controls: string[]; report: string[] };
  transcript: Transcript | null;
};
type Failure = { reason: string; result: string; source: string; subject: string };
type Reduction = Readonly<{
  buildResults: ReadonlyArray<{ result: string; role: string }>;
  caseResults: ReadonlyArray<{ caseId: string; result: string }>;
  controlResults: ReadonlyArray<{ controlId: string; result: string }>;
  deferredControlHalves: ReadonlyArray<{
    controlId: string;
    executedHalf: string | null;
    halves: readonly string[];
  }>;
  dischargedPrerequisites: readonly string[];
  disclosedSubstitutions: readonly string[];
  failures: readonly Failure[];
  gatesSubstituted: readonly string[];
  remainingPrerequisites: readonly string[];
  result: string;
}>;
type Envelope = Readonly<{
  controlObservations: readonly Observation[];
  controlRetainedPaths: readonly string[];
  diagnostics: readonly string[];
  loadedRoles: readonly string[];
  reduction: Reduction;
  report: Report;
  retainedFiles: readonly FileRow[];
  sealedFiles: readonly FileRow[];
  substitutions: { controls: readonly string[]; report: readonly string[] };
  transcript: Transcript | null;
}>;
type Boundary = Readonly<Record<string, unknown>>;
type PerOsModule = Readonly<{
  checkNativeLockPerOsReport: (report: unknown, reduction: unknown) => boolean;
  expectedNativeLockCoordinates: (plan: unknown) => Coordinates;
  nativeLockCoordinateMembers: readonly string[];
  nativeLockPerOsGates: Readonly<Record<string, unknown>>;
  nativeLockReportMembers: readonly string[];
  parseNativeLockReport: (value: unknown) => unknown;
  reduceNativeLockPerOs: (input: unknown, boundary?: Boundary) => Reduction;
}>;
type ReportModule = Readonly<{
  assembleNativeLockReport: (parts: unknown) => Report;
  buildNativeLockReportCoordinates: (context: unknown, provider: unknown) => Coordinates;
  nativeLockHungFixtureChildPolicy: string;
  nativeLockReportBoundaryPoints: readonly string[];
  nativeLockReportInputMembers: readonly string[];
  nativeLockUnexecutedCases: () => readonly CaseRow[];
  produceNativeLockReport: (input: unknown, boundary?: Boundary) => Promise<Envelope>;
}>;
type ReductionModule = Readonly<{
  caseIds: readonly string[];
  missingPrerequisites: readonly string[];
}>;

// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as perOsSource from "../../probes/portable-primitives/experiment/per-os-reduction.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as reportSource from "../../probes/portable-primitives/experiment/report.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as reductionSource from "../../probes/portable-primitives/experiment/reduction.mjs";

const perOs: PerOsModule = perOsSource;
const reportModule: ReportModule = reportSource;
const landedReduction: ReductionModule = reductionSource;

const {
  checkNativeLockPerOsReport,
  expectedNativeLockCoordinates,
  nativeLockCoordinateMembers,
  nativeLockPerOsGates,
  nativeLockReportMembers,
  parseNativeLockReport,
  reduceNativeLockPerOs,
} = perOs;
const {
  assembleNativeLockReport,
  buildNativeLockReportCoordinates,
  nativeLockHungFixtureChildPolicy,
  nativeLockReportBoundaryPoints,
  nativeLockReportInputMembers,
  nativeLockUnexecutedCases,
  produceNativeLockReport,
} = reportModule;

const experimentRoot = resolve(import.meta.dirname, "../../probes/portable-primitives/experiment");
const windows = process.platform === "win32";
const operatingSystem = { darwin: "MACOS", linux: "LINUX", win32: "WINDOWS" }[
  process.platform as "darwin" | "linux" | "win32"
] as string;
const jobId = `${hostedNativeLockSuiteId}-${operatingSystem.toLowerCase()}`;
const workflowRevision = "b".repeat(40);
const candidateRevision = "a".repeat(40);
const plan = Object.freeze({
  candidateRevision,
  jobId,
  repositoryId: "42",
  runAttempt: "1",
  runId: "770077",
  workflowRevision,
});
const planContext = Object.freeze({
  action: "iss022_native_lock_experiment",
  candidateRevision,
  repositoryId: "42",
  runAttempt: "1",
  runId: "770077",
  schemaVersion: "hosted-native-lock-plan-context/v1",
  workflowRevision,
});
const identityValue = windows
  ? { fileIdHex: "1".repeat(32), kind: "WINDOWS", volumeSerialNumber: "9" }
  : { device: "9", inode: "11", kind: "POSIX" };
const deferredHalvesById: Readonly<Record<string, readonly string[]>> = Object.freeze({
  BUILD_OR_LOADER_SUBSTITUTION: ["POST_LOAD_RETAINED_BYTE_REHASH"],
  MISSING_OR_MIXED_CENSUS: ["CROSS_OS_CENSUS", "CROSS_ATTEMPT_CENSUS"],
});
const executedHalfById: Readonly<Record<string, string>> = Object.freeze({
  BUILD_OR_LOADER_SUBSTITUTION: "PRE_LOAD_RETAINED_BYTE_REHASH",
  MISSING_OR_MIXED_CENSUS: "PER_OS_CASE_CENSUS",
});
const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { force: true, recursive: true });
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function digestOf(seed: number): string {
  return seed.toString(16).padStart(2, "0").repeat(32);
}

function buildFiles(role: string, source: string, output: string, seed: number) {
  const inputs: FileRow[] = [
    { byteLength: "16", path: `inputs/${role}/${source}`, sha256: digestOf(seed) },
  ];
  const outputs: FileRow[] = [
    { byteLength: "3", path: `builds/${role}/compiler.stdout`, sha256: digestOf(seed + 1) },
    { byteLength: "64", path: `builds/${role}/${output}`, sha256: digestOf(seed + 2) },
  ];
  const loaded: FileRow[] = [
    { byteLength: "64", path: `builds/${role}/${output}`, sha256: digestOf(seed + 2) },
  ];
  return { inputs, loaded, outputs };
}

function observedBundle(): Bundle {
  const witnessFiles = buildFiles(
    "STABLE_WITNESS",
    "native-lock-witness.c",
    hostedNativeLockLoadedOutputNames.STABLE_WITNESS,
    16,
  );
  const candidateFiles = buildFiles(
    "CANDIDATE_BINDING",
    "native-lock-candidate.c",
    hostedNativeLockLoadedOutputNames.CANDIDATE_BINDING,
    32,
  );
  const builds: BuildRow[] = [
    {
      argv: ["-std=c11"],
      inputs: witnessFiles.inputs,
      loaded: witnessFiles.loaded,
      outputs: witnessFiles.outputs,
      result: "BUILT",
      revision: workflowRevision,
      role: "STABLE_WITNESS",
      toolchain: { compilerPath: "/usr/bin/cc", compilerVersion: "1", sdkVersion: "1" },
    },
    {
      argv: ["-std=c11"],
      inputs: candidateFiles.inputs,
      loaded: candidateFiles.loaded,
      outputs: candidateFiles.outputs,
      result: "BUILT",
      revision: candidateRevision,
      role: "CANDIDATE_BINDING",
      toolchain: { compilerPath: "/usr/bin/cc", compilerVersion: "1", sdkVersion: "1" },
    },
  ];
  const sealedFiles: FileRow[] = [];
  for (const build of builds)
    for (const row of [...(build.inputs ?? []), ...(build.outputs ?? [])])
      sealedFiles.push({ ...row, path: `build/${row.path}` });
  const cases: CaseRow[] = landedReduction.caseIds.map((caseId) => ({
    caseId,
    events: [
      { actor: "HOLDER", data: { operation: "TRY_LOCK" }, kind: "CALL", sequence: "0" },
      { actor: "PARENT", data: { operation: "TRY_LOCK" }, kind: "CALL", sequence: "1" },
    ],
    result: "OBSERVED",
  }));
  const controls: ControlRow[] = hostedNativeLockControlIds.map((controlId) => ({
    controlId,
    refused: true,
    result: "REFUSED",
  }));
  const controlRetainedPaths: string[] = [];
  const controlObservations: Observation[] = hostedNativeLockControlIds.map((controlId) => {
    controlRetainedPaths.push(
      `controls/${controlId}/input.json`,
      `controls/${controlId}/observation.json`,
    );
    return {
      archiveRelativeInputPath: `controls/${controlId}/input.json`,
      controlId,
      deferredHalves: [...(deferredHalvesById[controlId] ?? [])],
      detail: "synthetic structural row",
      evidence: "SYNTHETIC_STABLE_GUARD_REPLAY",
      executedHalf: executedHalfById[controlId] ?? null,
      guard: "stable",
      mutant: "stable",
      prerequisite: null,
      refused: true,
      result: "REFUSED",
      substitutions: {
        fixtures: false,
        gates: [],
        guards: [],
        seam: "LANDED_CASE_CONTEXT",
        spawn: false,
      },
      witnessDisposition: null,
    };
  });
  return {
    cleanupFailures: [],
    controlObservations,
    controlRetainedPaths,
    loadedRoles: ["STABLE_WITNESS", "CANDIDATE_BINDING"],
    plan: { ...plan },
    prerequisites: { candidateBinding: "AVAILABLE", custody: "AVAILABLE", witness: "AVAILABLE" },
    report: {
      builds,
      cases,
      controls,
      coordinates: { ...expectedNativeLockCoordinates(plan) },
      custody: {
        finalByteHex: "41",
        finalIdentity: structuredClone(identityValue),
        initialByteHex: "41",
        initialIdentity: structuredClone(identityValue),
        leafName: "native-lock",
        rootPath: windows ? "C:\\temp\\iss022-native-lock-x" : "/tmp/iss022-native-lock-x",
      },
      experiment: "iss022-native-lock-experiment/v1",
      result: "UNKNOWN",
    },
    retainedFiles: structuredClone(sealedFiles),
    sealedFiles,
    substitutions: { controls: [], report: [] },
    transcript: {
      cases: landedReduction.caseIds.map((caseId) => ({
        caseId,
        failures: [],
        transcriptResult: "OBSERVED",
      })),
      failures: [],
      missingPrerequisites: landedReduction.missingPrerequisites,
      result: "UNKNOWN",
      transcriptResult: "OBSERVED",
    },
  };
}

/** One defect per gate, each caught by exactly the gate it names. */
const gateMutants: ReadonlyArray<readonly [string, (bundle: Bundle) => void]> = Object.freeze([
  ["builds", (bundle) => void (bundle.report.builds[1]!.result = "UNKNOWN")],
  ["loaded", (bundle) => void (bundle.report.builds[0]!.loaded = null)],
  ["cases", (bundle) => void (bundle.transcript!.cases[2]!.transcriptResult = "VIOLATED")],
  [
    "watchdog",
    (bundle) =>
      void bundle.report.cases[0]!.events.push({
        actor: "PARENT",
        data: { elapsedNanoseconds: "1", limitMilliseconds: "10000" },
        kind: "WATCHDOG",
        sequence: "2",
      }),
  ],
  [
    "controls",
    (bundle) => {
      const row = bundle.report.controls[3]!;
      row.refused = null;
      row.result = "UNSUPPORTED";
      bundle.controlRetainedPaths = bundle.controlRetainedPaths.filter(
        (path) => path !== `controls/${row.controlId}/input.json`,
      );
    },
  ],
  ["coordinates", (bundle) => void (bundle.report.coordinates.runId = "999999")],
  ["custody", (bundle) => void (bundle.report.custody.finalIdentity = null)],
  ["prerequisites", (bundle) => void (bundle.prerequisites.witness = "UNKNOWN")],
  [
    "retention",
    (bundle) => {
      bundle.retainedFiles = bundle.retainedFiles.filter(
        (row) => !row.path.endsWith("native-lock-witness.c"),
      );
    },
  ],
  ["substitutions", (bundle) => void (bundle.substitutions.report = ["runCases"])],
  ["vocabulary", (bundle) => void (bundle.report.cases[1]!.result = "BUILT")],
]);

describe("ISS-048 per-OS diagnostic report", () => {
  test("the structural evidence bundle reduces to OBSERVED with no failure", () => {
    const reduction = reduceNativeLockPerOs(observedBundle());
    expect(reduction.result).toBe("OBSERVED");
    expect(reduction.failures).toEqual([]);
    expect(reduction.gatesSubstituted).toEqual([]);
    expect(reduction.caseResults.map((row) => row.result)).toEqual([
      "OBSERVED",
      "OBSERVED",
      "OBSERVED",
      "OBSERVED",
    ]);
    expect(reduction.controlResults).toHaveLength(12);
    // The per-OS reducer discharges four of the landed reducer's five missing
    // prerequisites; stage four's three-OS/provider evidence stays outstanding.
    expect(reduction.dischargedPrerequisites).toHaveLength(4);
    expect(reduction.remainingPrerequisites).toEqual([
      landedReduction.missingPrerequisites[4] as string,
    ]);
  });

  test("the report member census is exact and closed", () => {
    const bundle = observedBundle();
    expect([...nativeLockReportMembers]).toEqual([
      "builds",
      "cases",
      "controls",
      "coordinates",
      "custody",
      "experiment",
      "result",
    ]);
    expect(() => parseNativeLockReport(bundle.report)).not.toThrow();
    for (const member of nativeLockReportMembers) {
      const short = structuredClone(bundle.report) as unknown as Record<string, unknown>;
      delete short[member];
      expect(() => parseNativeLockReport(short)).toThrow(/native-lock/);
      expect(() => reduceNativeLockPerOs({ ...observedBundle(), report: short })).toThrow(
        /native-lock/,
      );
    }
    const extended = structuredClone(bundle.report) as unknown as Record<string, unknown>;
    extended.retainedFiles = [];
    expect(() => parseNativeLockReport(extended)).toThrow(/native-lock/);
    const wrongExperiment = structuredClone(bundle.report);
    wrongExperiment.experiment = "iss022-native-lock-experiment/v2";
    expect(() => parseNativeLockReport(wrongExperiment)).toThrow(/native-lock/);
    for (const shorten of [
      (report: Report) => report.builds.pop(),
      (report: Report) => report.cases.pop(),
      (report: Report) => report.controls.pop(),
    ]) {
      const mutated = structuredClone(bundle.report);
      shorten(mutated);
      expect(() => parseNativeLockReport(mutated)).toThrow(/native-lock/);
    }
    const reordered = structuredClone(bundle.report);
    reordered.controls.reverse();
    expect(() => parseNativeLockReport(reordered)).toThrow(/native-lock/);
  });

  test("coordinates equal the plan, provider and actual process inputs", () => {
    const expected = expectedNativeLockCoordinates(plan);
    expect(Object.keys(expected).sort()).toEqual([...nativeLockCoordinateMembers].sort());
    expect(expected).toMatchObject({
      architecture: process.arch,
      jobId,
      nodeModulesVersion: process.versions.modules,
      nodeNapiVersion: process.versions.napi,
      nodeVersion: process.version,
      operatingSystem,
    });
    // Every coordinate mutant is caught, one at a time.
    for (const field of nativeLockCoordinateMembers) {
      const bundle = observedBundle();
      bundle.report.coordinates[field] = `${bundle.report.coordinates[field]}-moved`;
      const reduction = reduceNativeLockPerOs(bundle);
      expect(reduction.result).not.toBe("OBSERVED");
      expect(reduction.failures.some((entry) => entry.subject === field)).toBe(true);
    }
    // The constructor refuses a wrong job identifier, OS or revision outright.
    expect(() => expectedNativeLockCoordinates({ ...plan, jobId: "other-job" })).toThrow(
      /native-lock/,
    );
    expect(() => expectedNativeLockCoordinates({ ...plan, runId: "0" })).toThrow(/native-lock/);
    expect(() => expectedNativeLockCoordinates({ ...plan, candidateRevision: "z" })).toThrow(
      /native-lock/,
    );
    expect(() =>
      buildNativeLockReportCoordinates(
        { ...planContext, action: "conformance_candidate" },
        {
          jobId,
        },
      ),
    ).toThrow(/native-lock/);
    expect(buildNativeLockReportCoordinates(planContext, { jobId })).toEqual(expected);
  });

  test("a case row with no events is UNKNOWN unless a verified premise propagates UNSUPPORTED", () => {
    const empty = observedBundle();
    for (const row of empty.report.cases) row.events = [];
    empty.transcript = null;
    expect(reduceNativeLockPerOs(empty).caseResults.map((row) => row.result)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);

    // A build row alone does not propagate UNSUPPORTED.
    const buildOnly = structuredClone(empty);
    buildOnly.report.builds[0]!.result = "UNSUPPORTED";
    buildOnly.report.builds[0]!.loaded = null;
    buildOnly.loadedRoles = ["CANDIDATE_BINDING"];
    expect(reduceNativeLockPerOs(buildOnly).caseResults.map((row) => row.result)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);

    // The stable prerequisite evidence alone does not propagate it either.
    const prerequisiteOnly = structuredClone(empty);
    prerequisiteOnly.prerequisites.witness = "UNSUPPORTED";
    expect(reduceNativeLockPerOs(prerequisiteOnly).caseResults.map((row) => row.result)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);

    // Both together are the verified unsupported prerequisite.
    const verified = structuredClone(buildOnly);
    verified.prerequisites.witness = "UNSUPPORTED";
    const reduction = reduceNativeLockPerOs(verified);
    expect(reduction.caseResults.map((row) => row.result)).toEqual([
      "UNSUPPORTED",
      "UNSUPPORTED",
      "UNSUPPORTED",
      "UNSUPPORTED",
    ]);
    expect(reduction.result).toBe("UNKNOWN");
  });

  test("a watchdog row forces UNKNOWN even when the transcript row is observed", () => {
    const bundle = observedBundle();
    bundle.report.cases[3]!.events.push({
      actor: "PARENT",
      data: { elapsedNanoseconds: "10000000001", limitMilliseconds: "10000" },
      kind: "WATCHDOG",
      sequence: "2",
    });
    const reduction = reduceNativeLockPerOs(bundle);
    expect(reduction.result).toBe("UNKNOWN");
    expect(reduction.caseResults[3]).toEqual({
      caseId: landedReduction.caseIds[3],
      result: "UNKNOWN",
    });
    expect(
      reduction.failures.some((entry) => entry.reason === "watchdog expired in this row"),
    ).toBe(true);
  });

  test("no case result is inferred from the candidate's own reply or the submitted result", () => {
    const bundle = observedBundle();
    // A row full of candidate-side native calls claiming success, and a
    // submitted OBSERVED result, cannot outrank the stable transcript reduction.
    bundle.report.cases[0]!.result = "OBSERVED";
    bundle.report.cases[0]!.events.push({
      actor: "HOLDER",
      data: { errorCode: "0", operation: "TRY_LOCK", returnValue: "0" },
      kind: "CALL",
      sequence: "2",
    });
    bundle.transcript!.cases[0]!.transcriptResult = "VIOLATED";
    bundle.transcript!.transcriptResult = "VIOLATED";
    const reduction = reduceNativeLockPerOs(bundle);
    expect(reduction.caseResults[0]!.result).toBe("VIOLATED");
    expect(reduction.result).toBe("VIOLATED");
    // And the submitted per-OS result is never the recomputed one.
    const claimed = observedBundle();
    claimed.report.result = "OBSERVED";
    claimed.transcript!.cases[1]!.transcriptResult = "UNKNOWN";
    expect(reduceNativeLockPerOs(claimed).result).toBe("UNKNOWN");
  });

  test("OBSERVED is unreachable while any one of the twelve controls is not refused", () => {
    for (const [index, controlId] of hostedNativeLockControlIds.entries())
      for (const arm of [
        { refused: null, result: "UNSUPPORTED" },
        { refused: null, result: "UNKNOWN" },
        { refused: false, result: "VIOLATED" },
      ]) {
        const bundle = observedBundle();
        const row = bundle.report.controls[index]!;
        row.refused = arm.refused;
        row.result = arm.result;
        if (arm.refused === null)
          bundle.controlRetainedPaths = bundle.controlRetainedPaths.filter(
            (path) => path !== `controls/${controlId}/input.json`,
          );
        const reduction = reduceNativeLockPerOs(bundle);
        expect(reduction.result).not.toBe("OBSERVED");
        expect(
          reduction.failures.some(
            (entry) => entry.subject === controlId && entry.result === arm.result,
          ),
        ).toBe(true);
      }
    // An incomplete presence pattern is refused by the landed control census.
    const missing = observedBundle();
    missing.controlRetainedPaths = missing.controlRetainedPaths.filter(
      (path) => path !== `controls/${hostedNativeLockControlIds[5]}/observation.json`,
    );
    expect(reduceNativeLockPerOs(missing).result).toBe("UNKNOWN");
  });

  test("OBSERVED is unreachable while any substitution is disclosed", () => {
    for (const mutate of [
      (bundle: Bundle) => void (bundle.substitutions.report = ["createContext"]),
      (bundle: Bundle) => void (bundle.substitutions.controls = ["spawn"]),
      (bundle: Bundle) => void (bundle.controlObservations[0]!.substitutions.spawn = true),
      (bundle: Bundle) => void (bundle.controlObservations[1]!.substitutions.fixtures = true),
      (bundle: Bundle) => void bundle.controlObservations[2]!.substitutions.gates.push("judge"),
      (bundle: Bundle) =>
        void bundle.controlObservations[3]!.substitutions.guards.push("requireInspection"),
      (bundle: Bundle) =>
        void (bundle.controlObservations[4]!.substitutions.seam = "SUBSTITUTED_SEAM"),
      (bundle: Bundle) =>
        void (bundle.controlObservations[5]!.substitutions.seam = "CAPTURED_INPUT"),
    ]) {
      const bundle = observedBundle();
      mutate(bundle);
      const reduction = reduceNativeLockPerOs(bundle);
      expect(reduction.result).toBe("UNKNOWN");
      expect(reduction.disclosedSubstitutions.length).toBeGreaterThan(0);
    }
    // `ABSENT` is not a substitution: it is the no-fixture-phase seam, which the
    // control gate already refuses through the row's nullable arm.
    const absent = observedBundle();
    for (const observation of absent.controlObservations) observation.substitutions.seam = "ABSENT";
    expect(reduceNativeLockPerOs(absent).disclosedSubstitutions).toEqual([]);
  });

  test("the precedence reduction retains every individual failure", () => {
    const bundle = observedBundle();
    bundle.prerequisites.custody = "UNSUPPORTED";
    bundle.report.custody.finalByteHex = "42";
    bundle.transcript!.cases[2]!.transcriptResult = "UNKNOWN";
    const reduction = reduceNativeLockPerOs(bundle);
    expect(reduction.result).toBe("UNKNOWN");
    const results = reduction.failures.map((entry) => entry.result);
    expect(results).toContain("UNSUPPORTED");
    expect(results).toContain("VIOLATED");
    expect(results).toContain("UNKNOWN");
    expect(reduction.failures.map((entry) => entry.source)).toEqual(
      expect.arrayContaining(["cases", "custody", "prerequisites"]),
    );
  });

  test("collection success cannot upgrade a failed premise", () => {
    const bundle = observedBundle();
    bundle.report.builds[0]!.result = "UNSUPPORTED";
    bundle.report.builds[0]!.loaded = null;
    bundle.loadedRoles = ["CANDIDATE_BINDING"];
    bundle.prerequisites.witness = "UNSUPPORTED";
    const before = reduceNativeLockPerOs(bundle);
    expect(before.result).not.toBe("OBSERVED");
    // A larger, entirely consistent retained census changes nothing.
    bundle.retainedFiles = [
      ...bundle.retainedFiles,
      { byteLength: "1", path: "controls/extra.json", sha256: digestOf(90) },
      { byteLength: "1", path: "transcripts/extra.stdout", sha256: digestOf(91) },
    ];
    const after = reduceNativeLockPerOs(bundle);
    expect(after.result).toBe(before.result);
    expect(after.failures.length).toBeGreaterThanOrEqual(before.failures.length);
  });

  test("the loaded member stays null with no load and is never the pre-load hash", () => {
    // No load happened: the member must still be null and must never be filled.
    const unloaded = observedBundle();
    unloaded.loadedRoles = [];
    unloaded.report.builds[0]!.loaded = null;
    unloaded.report.builds[1]!.loaded = null;
    const reduction = reduceNativeLockPerOs(unloaded);
    expect(reduction.result).toBe("UNKNOWN");
    expect(
      reduction.failures.filter((entry) => entry.reason === "no load happened for this role"),
    ).toHaveLength(2);

    // A filled member with no load is a fabricated row and refuses outright.
    const fabricated = observedBundle();
    fabricated.loadedRoles = [];
    expect(() => reduceNativeLockPerOs(fabricated)).toThrow(/native-lock/);

    // A loaded row that is not the post-case retained byte row refuses OBSERVED.
    const moved = observedBundle();
    moved.report.builds[1]!.loaded![0]!.sha256 = digestOf(99);
    expect(reduceNativeLockPerOs(moved).result).toBe("UNKNOWN");

    // A load claimed without the parent's own evidence never stands.
    const unevidenced = observedBundle();
    unevidenced.report.custody.initialIdentity = null;
    for (const row of unevidenced.report.cases) row.events = [];
    unevidenced.transcript = null;
    expect(
      reduceNativeLockPerOs(unevidenced).failures.some(
        (entry) => entry.reason === "load claimed without stable evidence",
      ),
    ).toBe(true);
  });

  test("the post-load rehash, not the pre-load hash, completes the loaded member", async () => {
    const root = await temporaryRoot("orchestration-native-lock-loaded-");
    const role = "STABLE_WITNESS";
    const name = hostedNativeLockLoadedOutputNames.STABLE_WITNESS;
    await mkdir(resolve(root, "builds", role), { recursive: true });
    // Plain bytes in an OS temp directory. Nothing requires, loads or runs this
    // file; it exists only so a rehash has something to reread.
    await writeFile(resolve(root, "builds", role, name), "not-an-addon\n", "utf8");
    const actual = await completeHostedNativeLockLoadedMembers(
      root,
      [
        {
          argv: null,
          inputs: null,
          loaded: null,
          outputs: [{ byteLength: "0", path: `builds/${role}/${name}`, sha256: digestOf(7) }],
          result: "BUILT",
          revision: workflowRevision,
          role,
          toolchain: null,
        },
        {
          argv: null,
          inputs: null,
          loaded: null,
          outputs: null,
          result: "UNKNOWN",
          revision: candidateRevision,
          role: "CANDIDATE_BINDING",
          toolchain: null,
        },
      ],
      [role],
    );
    // The declared pre-load row disagrees with the bytes on disk, so the
    // completion refuses instead of publishing the pre-load hash.
    expect(actual).toMatchObject({ ok: false });
    if (actual.ok) throw new Error("expected the pre-load mismatch to refuse");
    expect(actual.issues).toContain("native-lock-preparation:post-load-rehash-mismatch");

    const honest = await completeHostedNativeLockLoadedMembers(
      root,
      [
        {
          argv: null,
          inputs: null,
          loaded: null,
          outputs: [
            {
              byteLength: "13",
              path: `builds/${role}/${name}`,
              sha256: "9359df94c96a887d139b57cc383b9f1b1b0e3aa4f127dddd7f1d2d65af4a0acd",
            },
          ],
          result: "BUILT",
          revision: workflowRevision,
          role,
          toolchain: null,
        },
        {
          argv: null,
          inputs: null,
          loaded: null,
          outputs: null,
          result: "UNKNOWN",
          revision: candidateRevision,
          role: "CANDIDATE_BINDING",
          toolchain: null,
        },
      ],
      [],
    );
    // Neither role loaded, so both members stay null even though one row is
    // BUILT and its bytes are retained and hashable.
    expect(honest).toMatchObject({ ok: true });
    if (!honest.ok) throw new Error(honest.issues.join(","));
    expect(honest.loaded).toEqual([null, null]);
  });

  test("a report whose result disagrees with the recomputed reduction refuses", () => {
    const bundle = observedBundle();
    const reduction = reduceNativeLockPerOs(bundle);
    const agreeing = { ...structuredClone(bundle.report), result: reduction.result };
    expect(checkNativeLockPerOsReport(agreeing, reduction)).toBe(true);
    for (const claimed of ["OBSERVED", "VIOLATED", "UNSUPPORTED", "UNKNOWN"].filter(
      (word) => word !== reduction.result,
    )) {
      const disagreeing = { ...structuredClone(bundle.report), result: claimed };
      expect(() => checkNativeLockPerOsReport(disagreeing, reduction)).toThrow(/native-lock/);
    }
    expect(() => checkNativeLockPerOsReport(agreeing, { result: "OBSERVED-ish" })).toThrow(
      /native-lock/,
    );
  });

  test("no vocabulary crosses between build, case, control and report rows", () => {
    for (const mutate of [
      (bundle: Bundle) => void (bundle.report.builds[0]!.result = "OBSERVED"),
      (bundle: Bundle) => void (bundle.report.builds[1]!.result = "REFUSED"),
      (bundle: Bundle) => void (bundle.report.cases[0]!.result = "BUILT"),
      (bundle: Bundle) => void (bundle.report.cases[1]!.result = "REFUSED"),
      (bundle: Bundle) => void (bundle.report.controls[0]!.result = "BUILT"),
      (bundle: Bundle) => void (bundle.report.controls[1]!.result = "OBSERVED"),
      (bundle: Bundle) => void (bundle.report.result = "BUILT"),
      (bundle: Bundle) => void (bundle.report.result = "REFUSED"),
    ]) {
      const bundle = observedBundle();
      mutate(bundle);
      expect(() => reduceNativeLockPerOs(bundle)).toThrow(/native-lock/);
    }
  });

  test("the deferred halves of the two split control rows stay visible", () => {
    const reduction = reduceNativeLockPerOs(observedBundle());
    expect(reduction.deferredControlHalves).toEqual([
      {
        controlId: "BUILD_OR_LOADER_SUBSTITUTION",
        executedHalf: "PRE_LOAD_RETAINED_BYTE_REHASH",
        halves: ["POST_LOAD_RETAINED_BYTE_REHASH"],
      },
      {
        controlId: "MISSING_OR_MIXED_CENSUS",
        executedHalf: "PER_OS_CASE_CENSUS",
        halves: ["CROSS_OS_CENSUS", "CROSS_ATTEMPT_CENSUS"],
      },
    ]);
  });

  test("every new gate has a deletion mutant that is not tautological", () => {
    const names = Object.keys(nativeLockPerOsGates).sort();
    expect(names).toEqual(gateMutants.map(([name]) => name).sort());
    for (const [name, mutate] of gateMutants) {
      const defective = observedBundle();
      mutate(defective);
      const deleted = observedBundle();
      mutate(deleted);
      const deletion = { gates: { [name]: () => [] } };
      if (name === "vocabulary") {
        // The one structurally refusing gate: with it deleted the crossed word
        // is accepted and the defect reaches OBSERVED.
        expect(() => reduceNativeLockPerOs(defective)).toThrow(/native-lock/);
        const mutant = reduceNativeLockPerOs(deleted, deletion);
        expect(mutant.result).toBe("OBSERVED");
        expect(mutant.gatesSubstituted).toEqual(["vocabulary"]);
        continue;
      }
      expect(reduceNativeLockPerOs(defective).result).not.toBe("OBSERVED");
      const mutant = reduceNativeLockPerOs(deleted, deletion);
      expect(mutant.result).toBe("OBSERVED");
      expect(mutant.gatesSubstituted).toEqual([name]);
    }
  });

  test("the hung-child decision is recorded in code and adds no signal", async () => {
    expect(nativeLockHungFixtureChildPolicy).toBe("ACCEPT_THE_HANG_NEVER_SIGNAL");
    for (const name of ["report.mjs", "per-os-reduction.mjs"]) {
      const source = await readFile(resolve(experimentRoot, name), "utf8");
      for (const forbidden of [
        /\.kill\s*\(/,
        /\.disconnect\s*\(/,
        /\.unref\s*\(/,
        /SIGKILL/,
        /node:child_process/,
      ])
        expect(source).not.toMatch(forbidden);
    }
  });

  test("the report assembler and unexecuted rows carry no extra member", () => {
    const bundle = observedBundle();
    const report = assembleNativeLockReport({
      builds: bundle.report.builds,
      cases: bundle.report.cases,
      controls: bundle.report.controls,
      coordinates: bundle.report.coordinates,
      custody: bundle.report.custody,
      result: "UNKNOWN",
    });
    expect(Object.keys(report).sort()).toEqual([...nativeLockReportMembers].sort());
    expect(report.experiment).toBe("iss022-native-lock-experiment/v1");
    expect(() =>
      assembleNativeLockReport({
        builds: bundle.report.builds,
        cases: bundle.report.cases,
        controls: bundle.report.controls,
        coordinates: bundle.report.coordinates,
        custody: bundle.report.custody,
        experiment: "iss022-native-lock-experiment/v1",
        result: "UNKNOWN",
      }),
    ).toThrow(/native-lock/);
    const unexecuted = nativeLockUnexecutedCases();
    expect(unexecuted.map((row) => row.caseId)).toEqual([...landedReduction.caseIds]);
    expect(unexecuted.every((row) => row.events.length === 0)).toBe(true);
  });
});

describe("ISS-048 report production without a native toolchain", () => {
  async function produce(
    state: "UNSUPPORTED" | "UNKNOWN",
    prerequisites: Record<string, string>,
    boundary: Boundary = {},
  ): Promise<{ envelope: Envelope; contexts: number }> {
    const archiveRoot = await temporaryRoot("orchestration-native-lock-report-");
    let contexts = 0;
    const envelope = await produceNativeLockReport(
      {
        archiveRoot,
        artifactRoot: resolve(archiveRoot, "build"),
        candidate: null,
        caseRoot: resolve(archiveRoot, "case"),
        context: planContext,
        controlFixtureFiles: null,
        preparation: { acquisitionFiles: [], ok: true, reason: "no toolchain", roots: {}, state },
        prerequisites,
        provider: { jobId },
        sourceRoots: null,
        stableFiles: null,
        systemRoot: null,
        witness: null,
      },
      {
        createContext: () => {
          contexts += 1;
          throw new Error("no case context may be created without a BUILT preparation");
        },
        ...boundary,
      },
    );
    return { contexts, envelope };
  }

  test("an unsupported preparation yields a closed report with no native call", async () => {
    const { contexts, envelope } = await produce("UNSUPPORTED", {
      candidateBinding: "UNSUPPORTED",
      custody: "UNKNOWN",
      witness: "UNSUPPORTED",
    });
    // The case phase is gated on two BUILT rows, so the case-context
    // constructor is never reached and no fixture child can exist.
    expect(contexts).toBe(0);
    expect(Object.keys(envelope.report).sort()).toEqual([...nativeLockReportMembers].sort());
    expect(envelope.report.builds.map((build) => build.result)).toEqual([
      "UNSUPPORTED",
      "UNSUPPORTED",
    ]);
    expect(envelope.report.builds.every((build) => build.loaded === null)).toBe(true);
    expect(envelope.report.controls).toHaveLength(12);
    expect(envelope.report.cases).toHaveLength(4);
    for (const row of envelope.report.cases) {
      expect(row.events).toEqual([]);
      expect(["UNSUPPORTED", "UNKNOWN"]).toContain(row.result);
    }
    expect(envelope.report.result).toBe(envelope.reduction.result);
    expect(envelope.report.result).not.toBe("OBSERVED");
    expect(envelope.transcript).toBeNull();
    expect(envelope.loadedRoles).toEqual([]);
    expect(envelope.report.custody).toMatchObject({
      finalIdentity: null,
      initialIdentity: null,
      leafName: "native-lock",
      rootPath: null,
    });
    // The verified unsupported premise propagates to the unexecuted rows.
    expect(envelope.reduction.caseResults.map((row) => row.result)).toEqual([
      "UNSUPPORTED",
      "UNSUPPORTED",
      "UNSUPPORTED",
      "UNSUPPORTED",
    ]);
    expect(envelope.substitutions.report).toEqual(["createContext"]);
    expect(envelope.reduction.failures.some((entry) => entry.source === "substitutions")).toBe(
      true,
    );
  });

  test("an unknown preparation keeps every unexecuted row UNKNOWN", async () => {
    const { contexts, envelope } = await produce("UNKNOWN", {
      candidateBinding: "UNKNOWN",
      custody: "UNKNOWN",
      witness: "UNKNOWN",
    });
    expect(contexts).toBe(0);
    expect(envelope.report.builds.map((build) => build.result)).toEqual(["UNKNOWN", "UNKNOWN"]);
    expect(envelope.reduction.caseResults.map((row) => row.result)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(envelope.report.result).toBe("UNKNOWN");
    expect(envelope.diagnostics.join(",")).toContain("case phase not entered");
  });

  test("the report input census is closed and every boundary point is disclosed", async () => {
    expect([...nativeLockReportInputMembers]).toEqual([
      "archiveRoot",
      "artifactRoot",
      "candidate",
      "caseRoot",
      "context",
      "controlFixtureFiles",
      "preparation",
      "prerequisites",
      "provider",
      "sourceRoots",
      "stableFiles",
      "systemRoot",
      "witness",
    ]);
    expect([...nativeLockReportBoundaryPoints]).toEqual([
      "completeLoaded",
      "controlPhase",
      "createContext",
      "enterCasePhase",
      "reduceTranscripts",
      "runCases",
    ]);
    await expect(produceNativeLockReport({ archiveRoot: "/nowhere" })).rejects.toThrow(
      /native-lock/,
    );
    const { envelope } = await produce(
      "UNKNOWN",
      { candidateBinding: "UNKNOWN", custody: "UNKNOWN", witness: "UNKNOWN" },
      { reduceTranscripts: () => null, runCases: () => null },
    );
    expect([...envelope.substitutions.report]).toEqual([
      "createContext",
      "reduceTranscripts",
      "runCases",
    ]);
  });
});

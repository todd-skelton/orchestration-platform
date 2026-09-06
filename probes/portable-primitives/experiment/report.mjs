// Private ISS-048 stage-three per-OS diagnostic report producer (sub-slice 3.4).
//
// It runs the landed case-context setup, the landed 3.3 control phase, the
// landed case runner and finalize, completes each build's `loaded` member from
// the actual post-load rehash, assembles the ledger's exact seven-member report,
// and recomputes the per-OS result in the separate reducer the ledger's
// "Single-OS archive layout, roots, and the post-case census" subsection fixes.
// It never edits, wraps or re-implements `./reduction.mjs`.
//
// It seals no archive, uploads nothing, writes no aggregate, provider record or
// terminal verifier, adds no workflow surface, and calls no ISS-022 selection,
// profile, capability or decision writer. It compiles nothing and installs
// nothing: every native byte it can reach was produced by the landed builder.
//
// This is stable-parent code. It is not required to be loadable by bare Node —
// it reaches `./controls.mjs`, `./per-os-reduction.mjs` and
// `scripts/conformance/*.mts`, whose graphs resolve only under esbuild or
// Vitest — and it must therefore never enter a spawned fixture child's import
// graph. The bare-Node-loadable child entry stays `./control-fixtures.mjs` and
// `./fixture.mjs`.
//
// Standing rules this module implements, all of them the ledger's:
//   * the report has exactly the seven closed members, and nothing else;
//   * `coordinates` equal the stable plan, the provider and this actual process;
//   * a case row with no events is `UNKNOWN` unless a verified unsupported
//     prerequisite propagates `UNSUPPORTED`, and a watchdog row is `UNKNOWN`;
//   * a case result is never inferred from the candidate's own reply: every row
//     result comes from the landed transcript reduction over the stable
//     parent's transcript, or from the unexecuted-row rule;
//   * the `loaded` member stays null whenever no load happened, and is never
//     filled from the pre-load hash;
//   * no vocabulary crossing between build, case, control and report rows;
//   * the case phase is entered ONLY through `enterNativeLockCasePhase`, so the
//     landed 3.3 entry gate runs before the landed `beginCases`;
//   * every result this module publishes was recomputed by the separate per-OS
//     reducer, and a report disagreeing with that reduction refuses.
import { canonicalJson, snapshotClosedArray } from "../../../packages/contracts/src/runtime.ts";
import { hostedNativeLockAction } from "../../../scripts/conformance/hosted-native-lock-plan.mts";
import { completeHostedNativeLockLoadedMembers } from "../../../scripts/conformance/hosted-native-lock-preparation.mts";
import { createCaseContext } from "./case-context.mjs";
import { runCases } from "./cases.mjs";
import {
  enterNativeLockCasePhase,
  nativeLockControlPrerequisiteFields,
  runNativeLockControlPhase,
} from "./controls.mjs";
import { interfaceVersion, record, refuse } from "./facts.mjs";
import {
  checkNativeLockPerOsReport,
  nativeLockBuildResults,
  nativeLockBuildRoles,
  nativeLockCustodyMembers,
  nativeLockReportMembers,
  reduceNativeLockPerOs,
  expectedNativeLockCoordinates,
} from "./per-os-reduction.mjs";
import { caseIds, reduceCaseTranscripts } from "./reduction.mjs";

/** The closed input census of one per-OS observation job's report step. */
export const nativeLockReportInputMembers = Object.freeze([
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

/**
 * The report-level boundary points. Each one is disclosed in `substitutions`,
 * which the per-OS reducer treats as disqualifying for `OBSERVED`, so a
 * substituted run can never publish an observed per-OS result.
 */
export const nativeLockReportBoundaryPoints = Object.freeze([
  "completeLoaded",
  "controlPhase",
  "createContext",
  "enterCasePhase",
  "reduceTranscripts",
  "runCases",
]);

/**
 * The slice 3.3 review receipt's observation 1 asked sub-slice 3.4 to decide
 * explicitly between a child IPC-channel detach plus an event-loop de-reference
 * — neither of which is a signal — and accepting the hang for a control-fixture
 * child that misses its `CLOSE` exchange. The decision is
 * `ACCEPT_THE_HANG_NEVER_SIGNAL`, and this module implements it by adding
 * nothing:
 *
 *   * Signalling is never an option. A termination request here would be a
 *     second holder-death attempt hidden in a control, which the ledger forbids
 *     and which the death case must remain the sole owner of.
 *   * Detaching the channel and de-referencing the handle would let the hosted
 *     observation job's event loop drain while a live child still holds the OS
 *     lock on the fixed file. The parent would then finalize custody, and a
 *     later slice would seal an archive, against a file another live process
 *     still owns. It also destroys the IPC channel the retained transcript is
 *     read from, turning a loud hang into a quiet, unretained one.
 *   * Accepting the hang keeps the failure loud and bounded: the landed
 *     per-fixture watchdog bounds each exchange, the hung child's resource
 *     stays open in the control resource ledger, `enterNativeLockCasePhase`
 *     therefore refuses the case phase, the row reduces to `UNKNOWN`, and the
 *     hosted job's own timeout is the outer bound. That is the ledger's rule
 *     that a cleanup failure stays visible and cannot repair a measurement.
 *
 * Changing the teardown itself would require editing
 * `./control-fixtures.mjs#runNativeLockControlFixtureChild`, which is outside
 * this sub-slice's exact seven-file footprint; a bounded teardown belongs to a
 * later slice whose footprint includes that module.
 */
export const nativeLockHungFixtureChildPolicy = "ACCEPT_THE_HANG_NEVER_SIGNAL";

const buildMembers = Object.freeze([
  "argv",
  "inputs",
  "loaded",
  "outputs",
  "result",
  "revision",
  "role",
  "toolchain",
]);
const sorted = (values) => Object.freeze([...new Set(values)].sort());

function array(value) {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok) refuse();
  return parsed.value;
}

/** Closed key census without a deep snapshot; leaves are parsed where used. */
function closed(value, members) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse();
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.slice().sort().join("\0") !== [...members].sort().join("\0")
  )
    refuse();
  return value;
}

/**
 * The exact plan, provider and actual-process coordinates. The process half is
 * read from this process; the plan half comes from the authenticated hosted
 * native-lock plan context; the job identifier comes from the provider and must
 * be the registry's own row for this OS. Any disagreement refuses here.
 */
export function buildNativeLockReportCoordinates(context, provider) {
  if (
    context === null ||
    typeof context !== "object" ||
    context.action !== hostedNativeLockAction ||
    context.schemaVersion !== "hosted-native-lock-plan-context/v1"
  )
    refuse();
  const parsedProvider = record(provider, ["jobId"]);
  return expectedNativeLockCoordinates({
    candidateRevision: context.candidateRevision,
    jobId: parsedProvider.jobId,
    repositoryId: context.repositoryId,
    runAttempt: context.runAttempt,
    runId: context.runId,
    workflowRevision: context.workflowRevision,
  });
}

/** The four unexecuted rows. Their results are placeholders the reducer replaces. */
export function nativeLockUnexecutedCases() {
  return Object.freeze(
    caseIds.map((caseId) =>
      Object.freeze({ caseId, events: Object.freeze([]), result: "UNKNOWN" }),
    ),
  );
}

/**
 * The two build rows in `STABLE_WITNESS,CANDIDATE_BINDING` order. `loaded` is
 * always null here: only `completeHostedNativeLockLoadedMembers` may fill it,
 * and only from the actual post-load rehash. Role and revision stay bound to
 * the plan; unavailable members are null, never invented.
 */
export function buildNativeLockBuildRows(coordinates, preparedBuilds, state) {
  if (!["AVAILABLE", "UNSUPPORTED", "UNKNOWN"].includes(state)) refuse();
  return Object.freeze(
    nativeLockBuildRoles.map((role, index) => {
      const revision = index === 0 ? coordinates.workflowRevision : coordinates.candidateRevision;
      if (preparedBuilds === null)
        return Object.freeze({
          argv: null,
          inputs: null,
          loaded: null,
          outputs: null,
          result: state === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN",
          revision,
          role,
          toolchain: null,
        });
      const build = record(preparedBuilds[index], buildMembers);
      // The builder's own row must still be unloaded, correctly bound, and in
      // its own vocabulary; a crossed word refuses before the report exists.
      if (
        build.role !== role ||
        build.revision !== revision ||
        build.loaded !== null ||
        !nativeLockBuildResults.includes(build.result)
      )
        refuse();
      return Object.freeze({
        argv: build.argv,
        inputs: build.inputs,
        loaded: null,
        outputs: build.outputs,
        result: build.result,
        revision,
        role,
        toolchain: build.toolchain,
      });
    }),
  );
}

/** Assemble the exact seven-member report. A closed census, checked in place. */
export function assembleNativeLockReport(parts) {
  const parsed = record(parts, ["builds", "cases", "controls", "coordinates", "custody", "result"]);
  const report = Object.freeze({
    builds: parsed.builds,
    cases: parsed.cases,
    controls: parsed.controls,
    coordinates: parsed.coordinates,
    custody: parsed.custody,
    experiment: interfaceVersion,
    result: parsed.result,
  });
  closed(report, nativeLockReportMembers);
  return report;
}

const absentCustody = Object.freeze({
  finalByteHex: null,
  finalIdentity: null,
  initialByteHex: null,
  initialIdentity: null,
  leafName: "native-lock",
  rootPath: null,
});

/**
 * The ONLY path into the case phase. `enterNativeLockCasePhase` runs the landed
 * 3.3 entry gate — which refuses while a control left the witness locked or a
 * known resource open on the fixed file — and only then calls `beginCases`
 * exactly once. That call is the landed case runner, which begins the case
 * phase on the real context. This module never calls `seam.beginCases()`
 * itself, so no second entry point into the case phase exists.
 */
function enterCasePhase(seam, phase, runner, boundary) {
  let started = null;
  const entered = (boundary.enterCasePhase ?? enterNativeLockCasePhase)(
    Object.freeze({
      beginCases: () => {
        started = runner(seam);
      },
    }),
    phase,
    boundary.controls ?? {},
  );
  if (entered !== true || started === null) refuse();
  return started;
}

/**
 * Produce one OS's diagnostic report. Returns the report plus the evidence a
 * later reviewed collector needs; the report itself carries exactly the seven
 * ledger members and nothing else.
 */
export async function produceNativeLockReport(input, boundary = {}) {
  closed(input, nativeLockReportInputMembers);
  const controlBoundary = boundary.controls ?? {};
  const substitutions = Object.freeze({
    controls: sorted(Object.keys(controlBoundary)),
    report: sorted(
      Object.keys(boundary).filter((key) => nativeLockReportBoundaryPoints.includes(key)),
    ),
  });
  const prerequisites = record(input.prerequisites, nativeLockControlPrerequisiteFields);
  const coordinates = buildNativeLockReportCoordinates(input.context, input.provider);
  const preparation = input.preparation;
  if (preparation === null || typeof preparation !== "object" || preparation.ok !== true) refuse();
  const state = preparation.state;
  const pending = state === "AVAILABLE" ? preparation.preparation : null;
  const preparedBuilds = pending === null ? null : array(pending.helper.builds);
  const sealedFiles = Object.freeze(
    pending === null
      ? []
      : array(pending.retainedFiles).map((row) => {
          const file = record(row, ["byteLength", "path", "sha256"]);
          return Object.freeze({ ...file });
        }),
  );
  const builds = buildNativeLockBuildRows(coordinates, preparedBuilds, state);
  const diagnostics = [];

  // The case phase is reachable only from a complete preparation whose two
  // build rows are BUILT. Nothing below can compile, download or install: a
  // run without a hosted toolchain never reaches `createCaseContext`, so no
  // addon is loaded, no `.node` is required and no fixture child is spawned.
  const casePhaseReady = pending !== null && builds.every((build) => build.result === "BUILT");
  let caseContext = null;
  let rootIdentity = null;
  if (casePhaseReady) {
    try {
      caseContext = (boundary.createContext ?? createCaseContext)({
        artifactRoot: input.artifactRoot,
        candidate: input.candidate,
        runnerTemp: input.caseRoot,
        sourceRoots: input.sourceRoots,
        stableFiles: input.stableFiles,
        systemRoot: input.systemRoot,
        witness: input.witness,
      });
      caseContext.setup();
      // One extra metadata barrier, before any control or case, purely to bind
      // the parent's own root identity for the landed transcript reducer. It
      // acquires nothing, spawns nothing and issues no command.
      rootIdentity = caseContext.barrier().rootIdentity;
    } catch (error) {
      caseContext = null;
      rootIdentity = null;
      diagnostics.push(`case-context setup refused: ${String(error?.message ?? error)}`);
    }
  } else diagnostics.push("case phase not entered: no complete BUILT preparation");

  // Controls run before the four observation rows, exactly as the ledger
  // requires, and run even when the case phase is unreachable: the nine
  // captured-input rows are stable guard replays that need no witness.
  const phase = await (boundary.controlPhase ?? runNativeLockControlPhase)(
    input.archiveRoot,
    { prerequisites },
    caseContext === null
      ? controlBoundary
      : Object.freeze({
          fixtureChild: Object.freeze({
            stableFiles: input.controlFixtureFiles,
            systemRoot: input.systemRoot,
            witness: input.witness,
          }),
          seam: caseContext,
          ...controlBoundary,
        }),
  );

  let cases = nativeLockUnexecutedCases();
  let custody = absentCustody;
  let cleanupFailures = Object.freeze([]);
  let transcript = null;
  let loadedRoles = [];
  if (caseContext !== null) {
    loadedRoles = ["STABLE_WITNESS"];
    let ran = null;
    try {
      ran = await enterCasePhase(caseContext, phase, boundary.runCases ?? runCases, boundary);
    } catch (error) {
      diagnostics.push(`case phase refused: ${String(error?.message ?? error)}`);
    }
    const finalized = caseContext.finalize();
    cleanupFailures = Object.freeze([...finalized.cleanupFailures]);
    custody = Object.freeze({ ...record(finalized.custody, nativeLockCustodyMembers) });
    if (ran !== null) {
      cases = Object.freeze(array(ran.cases).map((row) => Object.freeze({ ...row })));
      // The candidate binding was loaded only if a child actually made a native
      // call of its own; a child's textual claim never establishes it.
      if (
        cases.some((row) =>
          array(row.events).some((event) => event?.actor === "HOLDER" && event?.kind === "CALL"),
        )
      )
        loadedRoles.push("CANDIDATE_BINDING");
      if (rootIdentity !== null) {
        try {
          transcript = (boundary.reduceTranscripts ?? reduceCaseTranscripts)({
            cases,
            leafIdentity: caseContext.identity,
            operatingSystem: coordinates.operatingSystem,
            rootIdentity,
            witnessNativeHandle: caseContext.nativeHandle,
          });
        } catch (error) {
          transcript = null;
          diagnostics.push(`transcript reduction refused: ${String(error?.message ?? error)}`);
        }
      }
    }
  }

  // The `loaded` member is completed from the ACTUAL post-load rehash and never
  // from the pre-load hash; a role that did not load keeps a null member.
  let reportBuilds = builds;
  let retainedFiles = sealedFiles;
  if (pending !== null) {
    const completed = await (boundary.completeLoaded ?? completeHostedNativeLockLoadedMembers)(
      input.artifactRoot,
      preparedBuilds,
      loadedRoles,
    );
    if (completed?.ok === true) {
      const loaded = array(completed.loaded);
      reportBuilds = Object.freeze(
        builds.map((build, index) =>
          Object.freeze({ ...build, loaded: loaded[index] === null ? null : loaded[index] }),
        ),
      );
      // The post-case retained row for a loaded output is the rehashed one, not
      // the sealed pre-load row; a byte that moved across the load therefore
      // shows up in the reducer's sealed-to-retained join.
      const rehashed = new Map();
      for (const rows of loaded)
        for (const row of rows ?? []) rehashed.set(`build/${row.path}`, row);
      retainedFiles = Object.freeze(
        sealedFiles.map((row) =>
          rehashed.has(row.path) ? Object.freeze({ ...rehashed.get(row.path), path: row.path }) : row,
        ),
      );
    } else {
      loadedRoles = [];
      diagnostics.push(
        `loaded completion refused: ${array(completed?.issues ?? ["unreadable"]).join(",")}`,
      );
    }
  }

  const reductionInput = Object.freeze({
    cleanupFailures,
    controlObservations: phase.observations,
    controlRetainedPaths: phase.retained,
    loadedRoles: Object.freeze([...loadedRoles]),
    plan: Object.freeze({
      candidateRevision: coordinates.candidateRevision,
      jobId: coordinates.jobId,
      repositoryId: coordinates.repositoryId,
      runAttempt: coordinates.runAttempt,
      runId: coordinates.runId,
      workflowRevision: coordinates.workflowRevision,
    }),
    prerequisites,
    retainedFiles,
    sealedFiles,
    substitutions,
    transcript,
  });
  // Two passes. The draft carries placeholder `UNKNOWN` results, which the
  // reducer reads for vocabulary only; the published report then takes every
  // row result and the per-OS result from the recomputation. Reducing the
  // published report again must yield a byte-identical reduction, which is what
  // proves the recomputation never read a submitted result.
  const draft = assembleNativeLockReport({
    builds: reportBuilds,
    cases,
    controls: phase.records,
    coordinates,
    custody,
    result: "UNKNOWN",
  });
  const draftReduction = reduceNativeLockPerOs(
    Object.freeze({ ...reductionInput, report: draft }),
  );
  const caseResults = new Map(
    array(draftReduction.caseResults).map((row) => [row.caseId, row.result]),
  );
  const report = assembleNativeLockReport({
    builds: reportBuilds,
    cases: Object.freeze(
      cases.map((row) => Object.freeze({ ...row, result: caseResults.get(row.caseId) })),
    ),
    controls: phase.records,
    coordinates,
    custody,
    result: draftReduction.result,
  });
  const reduction = reduceNativeLockPerOs(Object.freeze({ ...reductionInput, report }));
  if (canonicalJson(reduction) !== canonicalJson(draftReduction)) refuse();
  checkNativeLockPerOsReport(report, reduction);
  return Object.freeze({
    controlObservations: phase.observations,
    controlRetainedPaths: phase.retained,
    diagnostics: Object.freeze([...diagnostics]),
    loadedRoles: Object.freeze([...loadedRoles]),
    reduction,
    report,
    retainedFiles,
    sealedFiles,
    substitutions,
    transcript,
  });
}

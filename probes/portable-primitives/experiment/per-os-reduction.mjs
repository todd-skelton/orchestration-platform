// Private ISS-048 stage-three per-OS reducer (sub-slice 3.4).
//
// The bounded native-lock ledger's "Single-OS archive layout, roots, and the
// post-case census" subsection fixes this module as a SEPARATE reducer rather
// than an amendment to the landed transcript reducer: `./reduction.mjs` stays
// byte-stable and its `transcriptResult` is consumed here unchanged. That
// subsection also states why: amending `reduceCaseTranscripts` to return a
// non-`UNKNOWN` `result` would have to drop its fifth missing prerequisite —
// three-OS same-attempt reports and terminal provider evidence — from a landed
// independently reviewed guard, and that is exactly the evidence stage four
// supplies. This module therefore discharges only the first four of those
// prerequisites and reports the fifth as still outstanding. "No per-OS `result`
// may be reported that the separate reducer did not recompute."
//
// Nothing here loads an addon, requires a `.node`, makes a native call, spawns
// a process, reads a file, seals an archive, uploads anything, writes a report,
// workflow or archive member, or calls any ISS-022 selection, profile,
// capability or decision writer. It is pure over already-collected data.
//
// This is stable-parent code. It is not required to be loadable by bare Node —
// it reaches `./controls.mjs` and `scripts/conformance/*.mts`, whose graphs
// resolve only under esbuild or Vitest — and it must therefore never enter a
// spawned fixture child's import graph.
//
// The submitted `result` of a report is never trusted and is never an input to
// the recomputation: it is checked for vocabulary only, exactly as
// `reduceCaseTranscripts` checks a submitted case row's result. A report whose
// submitted `result` disagrees with the recomputed one is refused by
// `checkNativeLockPerOsReport`. Collection success cannot upgrade a failed
// premise: a retained failure is never removed by a later complete census, and
// an empty failure list is the only path to `OBSERVED`.
import { canonicalJson, snapshotClosedArray } from "../../../packages/contracts/src/runtime.ts";
import {
  hostedNativeLockCaseIds,
  hostedNativeLockControlIds,
  hostedNativeLockSuiteId,
} from "../../../scripts/conformance/hosted-native-lock-plan.mts";
import { checkNativeLockControlCensus, nativeLockControlPrerequisiteFields } from "./controls.mjs";
import { decimal, identity, interfaceVersion, record, refuse, sameIdentity } from "./facts.mjs";
import { caseIds, missingPrerequisites, reduceResults } from "./reduction.mjs";

/** The report's exact closed member census. No member is added or removed. */
export const nativeLockReportMembers = Object.freeze([
  "builds",
  "cases",
  "controls",
  "coordinates",
  "custody",
  "experiment",
  "result",
]);

/** The ledger's closed `coordinates` census. */
export const nativeLockCoordinateMembers = Object.freeze([
  "architecture",
  "candidateRevision",
  "jobId",
  "nodeModulesVersion",
  "nodeNapiVersion",
  "nodeVersion",
  "operatingSystem",
  "repositoryId",
  "runAttempt",
  "runId",
  "workflowRevision",
]);

/** The plan and provider half of `coordinates`; the rest is this process. */
export const nativeLockPlanCoordinateMembers = Object.freeze([
  "candidateRevision",
  "jobId",
  "repositoryId",
  "runAttempt",
  "runId",
  "workflowRevision",
]);

/** The ledger's closed build-record census, in `STABLE_WITNESS,CANDIDATE_BINDING` order. */
export const nativeLockBuildMembers = Object.freeze([
  "argv",
  "inputs",
  "loaded",
  "outputs",
  "result",
  "revision",
  "role",
  "toolchain",
]);
export const nativeLockBuildRoles = Object.freeze(["STABLE_WITNESS", "CANDIDATE_BINDING"]);

/** The one `.node` output each role may load. Never derived from a caller. */
export const nativeLockLoadedOutputNames = Object.freeze({
  CANDIDATE_BINDING: "native-lock-candidate.node",
  STABLE_WITNESS: "native-lock-witness.node",
});

/** The ledger's closed `custody` census. */
export const nativeLockCustodyMembers = Object.freeze([
  "finalByteHex",
  "finalIdentity",
  "initialByteHex",
  "initialIdentity",
  "leafName",
  "rootPath",
]);

/** Every retained-file reference is exactly these three members. */
export const nativeLockFileMembers = Object.freeze(["byteLength", "path", "sha256"]);

/**
 * The three vocabularies the ledger declares non-interchangeable. Build rows
 * use `BUILT|UNSUPPORTED|UNKNOWN`; case and per-OS report rows use
 * `OBSERVED|VIOLATED|UNSUPPORTED|UNKNOWN`; control rows add the control-local
 * success word `REFUSED`, which never enters a build, case or report row.
 */
export const nativeLockBuildResults = Object.freeze(["BUILT", "UNSUPPORTED", "UNKNOWN"]);
export const nativeLockPerOsResults = Object.freeze([
  "OBSERVED",
  "UNSUPPORTED",
  "VIOLATED",
  "UNKNOWN",
]);
export const nativeLockControlResults = Object.freeze([
  "REFUSED",
  "UNSUPPORTED",
  "VIOLATED",
  "UNKNOWN",
]);
export const nativeLockOperatingSystems = Object.freeze(["LINUX", "MACOS", "WINDOWS"]);

/** The closed reducer input census. */
export const nativeLockPerOsReductionMembers = Object.freeze([
  "cleanupFailures",
  "controlObservations",
  "controlRetainedPaths",
  "loadedRoles",
  "plan",
  "prerequisites",
  "report",
  "retainedFiles",
  "sealedFiles",
  "substitutions",
  "transcript",
]);

/** The `transcriptResult` carrier this reducer consumes unchanged. */
const transcriptMembers = Object.freeze([
  "cases",
  "failures",
  "missingPrerequisites",
  "result",
  "transcriptResult",
]);
const transcriptRowMembers = Object.freeze(["caseId", "failures", "transcriptResult"]);
const observationMembers = Object.freeze([
  "archiveRelativeInputPath",
  "controlId",
  "deferredHalves",
  "detail",
  "evidence",
  "executedHalf",
  "guard",
  "mutant",
  "prerequisite",
  "refused",
  "result",
  "substitutions",
  "witnessDisposition",
]);
const substitutionMembers = Object.freeze(["fixtures", "gates", "guards", "seam", "spawn"]);
const gateFailureMembers = Object.freeze(["reason", "result", "source", "subject"]);

/**
 * The four missing prerequisites this reducer discharges, and the one it does
 * not. Index four is stage four's three-OS/provider evidence; no per-OS
 * `OBSERVED` discharges it.
 */
export const nativeLockPerOsDischargedPrerequisites = Object.freeze(
  missingPrerequisites.slice(0, 4),
);
export const nativeLockPerOsRemainingPrerequisites = Object.freeze(missingPrerequisites.slice(4));

const localOS = { darwin: "MACOS", linux: "LINUX", win32: "WINDOWS" }[process.platform];
const sorted = (values) => Object.freeze([...new Set(values)].sort());
const controlIds = Object.freeze([...hostedNativeLockControlIds]);
const buildPathPrefix = "build/";
const disqualifyingSeams = Object.freeze(["CAPTURED_INPUT", "SUBSTITUTED_SEAM"]);

// Derived, never re-typed: the two landed case-ID lists must already agree, and
// the landed prerequisite census must still be the five this module splits.
if (canonicalJson([...hostedNativeLockCaseIds]) !== canonicalJson([...caseIds])) refuse();
if (missingPrerequisites.length !== 5) refuse();

function array(value) {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok) refuse();
  return parsed.value;
}

function hygienic(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function fileRow(value) {
  const row = record(value, nativeLockFileMembers);
  decimal(row.byteLength);
  if (!hygienic(row.path) || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256))
    refuse();
  return row;
}

/** A nullable sorted, unique `{path,byteLength,sha256}` array. Never invented. */
function fileRows(value) {
  if (value === null) return null;
  const rows = array(value).map(fileRow);
  for (const [index, row] of rows.entries())
    if (index > 0 && rows[index - 1].path >= row.path) refuse();
  return Object.freeze(rows);
}

function positiveDecimal(value) {
  decimal(value);
  if (BigInt(value) <= 0n) refuse();
  return value;
}

/**
 * The plan, provider and actual-process coordinates this run must carry. The
 * process half is read from this process, never from the report.
 */
export function expectedNativeLockCoordinates(plan) {
  const parsed = record(plan, nativeLockPlanCoordinateMembers);
  if (localOS === undefined || !nativeLockOperatingSystems.includes(localOS)) refuse();
  for (const field of ["candidateRevision", "workflowRevision"])
    if (typeof parsed[field] !== "string" || !/^[0-9a-f]{40}$/.test(parsed[field])) refuse();
  for (const field of ["repositoryId", "runAttempt", "runId"]) positiveDecimal(parsed[field]);
  // The job identifier is the registry's own row for this OS, never a caller's.
  if (parsed.jobId !== `${hostedNativeLockSuiteId}-${localOS.toLowerCase()}`) refuse();
  return Object.freeze({
    architecture: process.arch,
    candidateRevision: parsed.candidateRevision,
    jobId: parsed.jobId,
    nodeModulesVersion: process.versions.modules,
    nodeNapiVersion: process.versions.napi,
    nodeVersion: process.version,
    operatingSystem: localOS,
    repositoryId: parsed.repositoryId,
    runAttempt: parsed.runAttempt,
    runId: parsed.runId,
    workflowRevision: parsed.workflowRevision,
  });
}

/**
 * Structural parse of the report. This is not a substitutable gate: an open,
 * short, reordered or malformed census is refused before any evidence is
 * weighed, and a refusal here is a report refusal.
 */
export function parseNativeLockReport(value) {
  const report = record(value, nativeLockReportMembers);
  if (report.experiment !== interfaceVersion) refuse();
  const coordinates = record(report.coordinates, nativeLockCoordinateMembers);
  const custody = record(report.custody, nativeLockCustodyMembers);
  const builds = array(report.builds);
  if (builds.length !== nativeLockBuildRoles.length) refuse();
  const parsedBuilds = builds.map((entry, index) => {
    const build = record(entry, nativeLockBuildMembers);
    if (build.role !== nativeLockBuildRoles[index]) refuse();
    if (typeof build.revision !== "string" || !/^[0-9a-f]{40}$/.test(build.revision)) refuse();
    return Object.freeze({
      ...build,
      inputs: fileRows(build.inputs),
      loaded: fileRows(build.loaded),
      outputs: fileRows(build.outputs),
    });
  });
  const rows = array(report.cases);
  if (rows.length !== caseIds.length) refuse();
  const parsedCases = rows.map((entry, index) => {
    const row = record(entry, ["caseId", "events", "result"]);
    if (row.caseId !== caseIds[index]) refuse();
    return Object.freeze({ ...row, events: array(row.events) });
  });
  const controls = array(report.controls);
  if (controls.length !== controlIds.length) refuse();
  const parsedControls = controls.map((entry, index) => {
    const row = record(entry, ["controlId", "refused", "result"]);
    if (row.controlId !== controlIds[index]) refuse();
    return row;
  });
  return Object.freeze({
    builds: Object.freeze(parsedBuilds),
    cases: Object.freeze(parsedCases),
    controls: Object.freeze(parsedControls),
    coordinates,
    custody,
    experiment: report.experiment,
    result: report.result,
  });
}

// ---------------------------------------------------------------------------
// Gates. Each returns the failures it found and never removes another's. They
// are substitutable ONLY so that a stable test can delete exactly one at a
// time; `report.mjs` passes no boundary, so no production path replaces one.
// `vocabulary` is the single gate whose finding is a structural refusal.
// ---------------------------------------------------------------------------

function failure(source, subject, result, reason) {
  if (!nativeLockPerOsResults.includes(result) || result === "OBSERVED") refuse();
  return Object.freeze({ reason, result, source, subject });
}

/** No vocabulary crossing between build, case, control and report rows. */
function checkVocabularyBoundaries(view) {
  for (const build of view.report.builds)
    if (!nativeLockBuildResults.includes(build.result)) refuse();
  for (const row of view.report.cases) if (!nativeLockPerOsResults.includes(row.result)) refuse();
  for (const row of view.report.controls)
    if (!nativeLockControlResults.includes(row.result)) refuse();
  // The control-local success word never enters a build, case or report row.
  if (nativeLockPerOsResults.includes("REFUSED") || nativeLockBuildResults.includes("REFUSED"))
    refuse();
  if (!nativeLockPerOsResults.includes(view.report.result)) refuse();
  return Object.freeze([]);
}

/** Coordinates equal the plan, provider and actual process inputs. */
function checkCoordinateBinding(view) {
  const expected = expectedNativeLockCoordinates(view.plan);
  const found = [];
  for (const field of nativeLockCoordinateMembers)
    if (view.report.coordinates[field] !== expected[field])
      found.push(failure("coordinates", field, "UNKNOWN", "coordinate does not bind its input"));
  return Object.freeze(found);
}

/** Build rows contribute their own vocabulary's failure word. */
function checkBuildEvidence(view) {
  const found = [];
  for (const [index, build] of view.report.builds.entries()) {
    const expectedRevision = index === 0 ? view.plan.workflowRevision : view.plan.candidateRevision;
    if (build.revision !== expectedRevision)
      found.push(failure("builds", build.role, "UNKNOWN", "build revision is not the plan's"));
    if (build.result !== "BUILT") {
      found.push(failure("builds", build.role, build.result, "build row is not BUILT"));
      continue;
    }
    for (const member of ["argv", "inputs", "outputs", "toolchain"])
      if (build[member] === null)
        found.push(failure("builds", build.role, "UNKNOWN", `built row has no ${member}`));
  }
  return Object.freeze(found);
}

/**
 * `loaded` stays null whenever no load happened, is exactly that role's `.node`
 * output, and binds the retained post-case byte row. It is never invented and
 * never taken from the pre-load hash: the row it must equal is the post-case
 * retained-byte census row, so a byte that changed across the load refuses.
 */
function checkLoadedMembers(view) {
  const found = [];
  const retained = new Map(view.retainedFiles.map((row) => [row.path, row]));
  for (const build of view.report.builds) {
    if (!view.loadedRoles.includes(build.role)) {
      // No load happened for this role, so the member must still be null.
      if (build.loaded !== null) refuse();
      found.push(failure("loaded", build.role, "UNKNOWN", "no load happened for this role"));
      continue;
    }
    if (view.loadEvidence[build.role] !== true) {
      found.push(failure("loaded", build.role, "UNKNOWN", "load claimed without stable evidence"));
      continue;
    }
    if (build.loaded === null || build.loaded.length !== 1) {
      found.push(
        failure("loaded", build.role, "UNKNOWN", "loaded member absent for a loaded role"),
      );
      continue;
    }
    const row = build.loaded[0];
    const expectedPath = `builds/${build.role}/${nativeLockLoadedOutputNames[build.role]}`;
    const output = (build.outputs ?? []).find((entry) => entry.path === row.path);
    const archived = retained.get(`${buildPathPrefix}${row.path}`);
    if (row.path !== expectedPath)
      found.push(
        failure("loaded", build.role, "UNKNOWN", "loaded is not this role's .node output"),
      );
    else if (!output || output.byteLength !== row.byteLength || output.sha256 !== row.sha256)
      found.push(
        failure("loaded", build.role, "UNKNOWN", "loaded does not equal the built output"),
      );
    else if (!archived || archived.byteLength !== row.byteLength || archived.sha256 !== row.sha256)
      found.push(
        failure("loaded", build.role, "UNKNOWN", "loaded is not the retained post-case byte row"),
      );
  }
  return Object.freeze(found);
}

/** A `WATCHDOG` event in a row forces `UNKNOWN` for that row. */
function checkWatchdogRows(view) {
  const found = [];
  for (const row of view.report.cases)
    if (row.events.some((event) => event?.kind === "WATCHDOG"))
      found.push(failure("cases", row.caseId, "UNKNOWN", "watchdog expired in this row"));
  return Object.freeze(found);
}

/**
 * Recompute each case row from the landed transcript reduction. The submitted
 * `result` is never read, and no result is inferred from a candidate's own
 * reply: an executed row takes `transcriptResult`, which the landed reducer
 * derives from the stable parent's own transcript.
 */
function caseRows(view, watchdogForces) {
  const rows = [];
  let previous = null;
  for (const [index, row] of view.report.cases.entries()) {
    let result, reason;
    if (watchdogForces && row.events.some((event) => event?.kind === "WATCHDOG")) {
      result = "UNKNOWN";
      reason = null;
    } else if (row.events.length === 0) {
      // A verified unsupported premise is the only thing that lets an
      // unexecuted row propagate UNSUPPORTED instead of UNKNOWN.
      result = view.unsupportedPremise || previous === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN";
      reason = "row carries no event";
    } else if (view.transcript === null) {
      result = "UNKNOWN";
      reason = "no landed transcript reduction";
    } else {
      const reduced = view.transcript.cases[index];
      if (!reduced || reduced.caseId !== row.caseId) refuse();
      result = reduced.transcriptResult;
      reason = "landed transcript reduction";
    }
    if (!nativeLockPerOsResults.includes(result)) refuse();
    previous = result;
    rows.push(Object.freeze({ caseId: row.caseId, reason, result }));
  }
  return Object.freeze(rows);
}

function checkCaseEvidence(view) {
  return Object.freeze(
    caseRows(view, false)
      .filter((row) => row.result !== "OBSERVED")
      .map((row) => failure("cases", row.caseId, row.result, row.reason ?? "case row not observed")),
  );
}

/**
 * Twelve ordered controls with a valid arm pairing and the ledger's presence
 * pattern. `REFUSED` contributes no failure; `UNKNOWN`, `VIOLATED` and
 * `UNSUPPORTED` each contribute the report word of the same name, so an
 * incomplete control census can never yield `OBSERVED`.
 */
function checkControlEvidence(view) {
  const found = [];
  for (const issue of checkNativeLockControlCensus(view.report.controls, view.controlRetainedPaths))
    found.push(failure("controls", issue, "UNKNOWN", "control census refused"));
  for (const row of view.report.controls)
    if (row.result !== "REFUSED")
      found.push(failure("controls", row.controlId, row.result, "control did not refuse"));
  return Object.freeze(found);
}

/** Custody must be complete, matching and byte `41` at both ends. */
function checkCustodyEvidence(view) {
  const custody = view.report.custody;
  const found = [];
  if (custody.leafName !== "native-lock")
    found.push(failure("custody", "leafName", "UNKNOWN", "custody leaf is not the fixed name"));
  if (typeof custody.rootPath !== "string" || custody.rootPath.length === 0)
    found.push(failure("custody", "rootPath", "UNKNOWN", "custody root path absent"));
  for (const member of ["initialByteHex", "finalByteHex"]) {
    if (custody[member] === null)
      found.push(failure("custody", member, "UNKNOWN", "custody byte readback missing"));
    else if (custody[member] !== "41")
      found.push(failure("custody", member, "VIOLATED", "custody byte is not 41"));
  }
  for (const member of ["initialIdentity", "finalIdentity"])
    if (custody[member] === null)
      found.push(failure("custody", member, "UNKNOWN", "custody identity missing"));
  if (custody.initialIdentity !== null && custody.finalIdentity !== null) {
    let same = false;
    try {
      identity(custody.initialIdentity);
      identity(custody.finalIdentity);
      same = sameIdentity(custody.initialIdentity, custody.finalIdentity);
    } catch {
      same = false;
    }
    if (!same)
      found.push(failure("custody", "identity", "VIOLATED", "custody identities do not match"));
  }
  for (const reason of view.cleanupFailures)
    found.push(failure("custody", "cleanup", "UNKNOWN", String(reason)));
  return Object.freeze(found);
}

/** The stable prerequisite evidence the control arms were derived from. */
function checkPrerequisiteEvidence(view) {
  const found = [];
  for (const field of nativeLockControlPrerequisiteFields) {
    const state = view.prerequisites[field];
    if (state === "AVAILABLE") continue;
    if (state !== "UNSUPPORTED" && state !== "UNKNOWN") refuse();
    found.push(failure("prerequisites", field, state, "prerequisite is not available"));
  }
  return Object.freeze(found);
}

/**
 * The retained-byte join. Every sealed preparation row must reappear in the
 * post-case census with identical bytes, and every build file row must bind a
 * retained row. Hashes never substitute for retained bytes: a referenced row
 * absent from the post-case census is missing evidence, not a pass.
 */
function checkRetainedByteEvidence(view) {
  const found = [];
  const retained = new Map(view.retainedFiles.map((row) => [row.path, row]));
  for (const row of view.sealedFiles) {
    const archived = retained.get(row.path);
    if (!archived || archived.byteLength !== row.byteLength || archived.sha256 !== row.sha256)
      found.push(failure("retention", row.path, "UNKNOWN", "sealed row missing or changed"));
  }
  for (const build of view.report.builds)
    for (const member of ["inputs", "outputs"])
      for (const row of build[member] ?? []) {
        const archived = retained.get(`${buildPathPrefix}${row.path}`);
        if (!archived || archived.byteLength !== row.byteLength || archived.sha256 !== row.sha256)
          found.push(
            failure("retention", row.path, "UNKNOWN", `build ${member} row is not retained`),
          );
      }
  return Object.freeze(found);
}

/**
 * Every disclosed boundary substitution disqualifies `OBSERVED`. The slice 3.3
 * review receipt requires this verifier to read `substitutions` from each
 * `controls/<controlId>/observation.json` and treat any true or non-empty
 * member as disqualifying; `seam` is disqualifying exactly when it names a
 * substituted or captured-input seam, and `ABSENT` already forces the nullable
 * arm, which the control gate refuses on its own.
 */
function checkSubstitutionDisclosure(view) {
  return Object.freeze(
    view.disclosedSubstitutions.map((entry) =>
      failure("substitutions", entry, "UNKNOWN", "disclosed boundary substitution"),
    ),
  );
}

export const nativeLockPerOsGates = Object.freeze({
  builds: checkBuildEvidence,
  cases: checkCaseEvidence,
  controls: checkControlEvidence,
  coordinates: checkCoordinateBinding,
  custody: checkCustodyEvidence,
  loaded: checkLoadedMembers,
  prerequisites: checkPrerequisiteEvidence,
  retention: checkRetainedByteEvidence,
  substitutions: checkSubstitutionDisclosure,
  vocabulary: checkVocabularyBoundaries,
  watchdog: checkWatchdogRows,
});

function disclosedFrom(substitutions, observations) {
  const disclosed = [];
  const parsed = record(substitutions, ["controls", "report"]);
  for (const scope of ["controls", "report"])
    for (const key of array(parsed[scope])) {
      if (typeof key !== "string") refuse();
      disclosed.push(`${scope}:${key}`);
    }
  for (const observation of observations) {
    const row = record(observation.substitutions, substitutionMembers);
    if (row.fixtures === true) disclosed.push(`${observation.controlId}:fixtures`);
    if (row.spawn === true) disclosed.push(`${observation.controlId}:spawn`);
    for (const scope of ["gates", "guards"])
      for (const key of array(row[scope]))
        disclosed.push(`${observation.controlId}:${scope}:${key}`);
    if (disqualifyingSeams.includes(row.seam))
      disclosed.push(`${observation.controlId}:seam:${row.seam}`);
  }
  return sorted(disclosed);
}

/**
 * Recompute the per-OS result. The submitted `report.result` is read only for
 * vocabulary. Every individual failure is retained even when a
 * higher-precedence failure exists, and the ledger's precedence
 * `UNKNOWN > VIOLATED > UNSUPPORTED > OBSERVED` is applied by the landed
 * `reduceResults`, which this module consumes unchanged.
 */
export function reduceNativeLockPerOs(input, boundary = {}) {
  const parsed = record(input, nativeLockPerOsReductionMembers);
  const gates = Object.freeze({ ...nativeLockPerOsGates, ...(boundary.gates ?? {}) });
  const report = parseNativeLockReport(parsed.report);
  const prerequisites = record(parsed.prerequisites, nativeLockControlPrerequisiteFields);
  const loadedRoles = array(parsed.loadedRoles);
  if (
    loadedRoles.some((role) => !nativeLockBuildRoles.includes(role)) ||
    new Set(loadedRoles).size !== loadedRoles.length
  )
    refuse();
  const observations = array(parsed.controlObservations).map((entry, index) => {
    const row = record(entry, observationMembers);
    if (row.controlId !== controlIds[index]) refuse();
    return row;
  });
  if (observations.length !== controlIds.length) refuse();
  let transcript = null;
  if (parsed.transcript !== null) {
    const carrier = record(parsed.transcript, transcriptMembers);
    // The landed reducer pins `result` to UNKNOWN behind its five missing
    // prerequisites. A carrier claiming otherwise did not come from it.
    if (
      carrier.result !== "UNKNOWN" ||
      canonicalJson(carrier.missingPrerequisites) !== canonicalJson([...missingPrerequisites])
    )
      refuse();
    const rows = array(carrier.cases);
    if (rows.length !== caseIds.length) refuse();
    transcript = Object.freeze({
      ...carrier,
      cases: Object.freeze(rows.map((row) => record(row, transcriptRowMembers))),
    });
  }
  // A verified unsupported premise: the build row and the stable prerequisite
  // evidence for that same role must independently agree before an unexecuted
  // case row may propagate UNSUPPORTED instead of UNKNOWN.
  const unsupportedPremise = report.builds.some(
    (build, index) =>
      build.result === "UNSUPPORTED" &&
      prerequisites[index === 0 ? "witness" : "candidateBinding"] === "UNSUPPORTED",
  );
  const view = Object.freeze({
    cleanupFailures: Object.freeze(array(parsed.cleanupFailures)),
    controlRetainedPaths: Object.freeze(array(parsed.controlRetainedPaths)),
    disclosedSubstitutions: disclosedFrom(parsed.substitutions, observations),
    // Load evidence is the stable parent's own: the witness opened the fixed
    // file (custody identity), and the candidate was loaded in a child only if
    // that child's captured transcript carries a native call of its own.
    loadEvidence: Object.freeze({
      CANDIDATE_BINDING: report.cases.some((row) =>
        row.events.some((event) => event?.actor === "HOLDER" && event?.kind === "CALL"),
      ),
      STABLE_WITNESS: report.custody.initialIdentity !== null,
    }),
    loadedRoles: Object.freeze([...loadedRoles]),
    plan: record(parsed.plan, nativeLockPlanCoordinateMembers),
    prerequisites,
    report,
    retainedFiles: Object.freeze(array(parsed.retainedFiles).map(fileRow)),
    sealedFiles: Object.freeze(array(parsed.sealedFiles).map(fileRow)),
    transcript,
    unsupportedPremise,
  });
  const failures = [];
  for (const name of Object.keys(nativeLockPerOsGates).sort())
    failures.push(...array(gates[name](view)).map((entry) => record(entry, gateFailureMembers)));
  // Collection success cannot upgrade a failed premise: nothing removes a
  // retained failure, and an empty failure list is the only path to OBSERVED.
  const result = reduceResults(
    failures.length ? failures.map((entry) => entry.result) : ["OBSERVED"],
  );
  return Object.freeze({
    buildResults: Object.freeze(
      report.builds.map((build) => Object.freeze({ result: build.result, role: build.role })),
    ),
    caseResults: Object.freeze(
      caseRows(view, true).map((row) => Object.freeze({ caseId: row.caseId, result: row.result })),
    ),
    controlResults: Object.freeze(
      report.controls.map((row) => Object.freeze({ controlId: row.controlId, result: row.result })),
    ),
    // The deferred halves of the two split control rows stay visible to the
    // report reader: the report's `controls` member cannot carry them.
    deferredControlHalves: Object.freeze(
      observations
        .filter((row) => array(row.deferredHalves).length > 0)
        .map((row) =>
          Object.freeze({
            controlId: row.controlId,
            executedHalf: row.executedHalf,
            halves: Object.freeze([...array(row.deferredHalves)]),
          }),
        ),
    ),
    dischargedPrerequisites: nativeLockPerOsDischargedPrerequisites,
    disclosedSubstitutions: view.disclosedSubstitutions,
    failures: Object.freeze(failures.map((entry) => Object.freeze({ ...entry }))),
    gatesSubstituted: sorted(Object.keys(boundary.gates ?? {})),
    remainingPrerequisites: nativeLockPerOsRemainingPrerequisites,
    result,
  });
}

/**
 * A report whose submitted `result` disagrees with the recomputed reduction is
 * refused. The reduction is never derived from the submitted result, so this
 * comparison is not a tautology.
 */
export function checkNativeLockPerOsReport(report, reduction) {
  const parsed = parseNativeLockReport(report);
  if (!nativeLockPerOsResults.includes(parsed.result)) refuse();
  if (typeof reduction?.result !== "string" || parsed.result !== reduction.result) refuse();
  return true;
}

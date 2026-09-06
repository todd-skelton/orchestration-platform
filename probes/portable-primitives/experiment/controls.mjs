// Private ISS-048 stage-three control census (sub-slice 3.2). Every record this
// module produces is a stable guard replay over synthetic captured input. It
// loads no addon, requires no `.node`, spawns no process, makes no native call,
// runs no case, seals no archive, writes no report or workflow, and calls no
// ISS-022 selection, profile, capability or decision writer. No synthetic
// result is ever labelled a native observation: the control-local `REFUSED`
// word stays inside the control arm vocabulary and never enters the per-OS
// `OBSERVED|VIOLATED|UNSUPPORTED|UNKNOWN` case or report vocabulary.
//
// The ordered census is derived from the landed control ID list
// (`hostedNativeLockControlIds`) and is never re-typed here. The landed guards
// this module calls and never changes live in `./facts.mjs`, `./capture.mjs`,
// `./reduction.mjs`, `scripts/conformance/hosted-native-lock-preparation.mts`
// (sub-slice 3.1) and `packages/conformance/src`. Those last two are reached
// with their real `.mts`/`.ts` specifiers because Node does not rewrite a
// `.mjs` specifier onto a TypeScript source file.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { resolve } from "node:path";
import { canonicalJson } from "../../../packages/contracts/src/runtime.ts";
import { parseIss022SuiteCoordinates } from "../../../packages/conformance/src/iss022-profile.ts";
import { parsePortablePrimitivesCapabilityDecisionCore } from "../../../packages/conformance/src/portable-primitives-decision.ts";
import { checkPortablePrimitivesPublication } from "../../../packages/conformance/src/portable-primitives-publication.ts";
import { hostedNativeLockControlIds } from "../../../scripts/conformance/hosted-native-lock-plan.mts";
import {
  checkCandidateSubjectBinding,
  checkPreLoadBuildBinding,
  hostedNativeLockCandidateSourcePath,
} from "../../../scripts/conformance/hosted-native-lock-preparation.mts";
import { candidateReply, measurement } from "./capture.mjs";
import {
  openOperations,
  readOperations,
  record,
  refuse,
  requireCustody,
  requireInspection,
} from "./facts.mjs";
import { absolute } from "./io.mjs";
import { caseIds, reduceCaseTranscripts } from "./reduction.mjs";

/** The four closed control arms. No other `{refused,result}` pairing is valid. */
export const nativeLockControlArms = Object.freeze({
  REFUSED: Object.freeze({ refused: true, result: "REFUSED" }),
  UNKNOWN: Object.freeze({ refused: null, result: "UNKNOWN" }),
  UNSUPPORTED: Object.freeze({ refused: null, result: "UNSUPPORTED" }),
  VIOLATED: Object.freeze({ refused: false, result: "VIOLATED" }),
});

/** The single archive-relative prefix every control file lives under. */
export const nativeLockControlPrefix = "controls/";

/** Closed prerequisite vocabulary for the three witness-dependent rows. */
export const nativeLockControlPrerequisiteFields = Object.freeze([
  "candidateBinding",
  "custody",
  "witness",
]);
const prerequisiteStates = Object.freeze(["AVAILABLE", "UNSUPPORTED", "UNKNOWN"]);

// Derived, never re-typed. The ledger fixes the census order and states that
// the first three rows are the call-interception fixtures that need a real
// stable witness; every other row mutates captured input to a real guard.
const controlIds = Object.freeze([...hostedNativeLockControlIds]);
const witnessDependentCount = 3;
if (
  controlIds.length < witnessDependentCount + 1 ||
  new Set(controlIds).size !== controlIds.length ||
  controlIds.some(
    (controlId) => typeof controlId !== "string" || !/^[A-Z][A-Z_]*[A-Z]$/.test(controlId),
  )
)
  refuse();

/**
 * The two fixed control files for one row. Both are archive-relative, unique,
 * and free of empty, dot and parent components.
 */
export function nativeLockControlPaths(controlId) {
  if (!controlIds.includes(controlId)) refuse();
  return Object.freeze({
    inputPath: `${nativeLockControlPrefix}${controlId}/input.json`,
    observationPath: `${nativeLockControlPrefix}${controlId}/observation.json`,
  });
}

const windows = process.platform === "win32";
const clone = (value) => structuredClone(value);
const sorted = (values) => Object.freeze([...new Set(values)].sort());
const hex = (value) => createHash("sha256").update(value).digest("hex");
const bytesOf = (value) => new TextEncoder().encode(value);
const brief = (value) => String(value).slice(0, 240);

const leafIdentity = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "1".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "11" };
const rootIdentity = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "2".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "12" };
const foreignIdentity = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "3".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "13" };
const handles = Object.freeze({ CONTENDER: "39", HOLDER: "37", PARENT: "31" });
const localOS = { darwin: "MACOS", linux: "LINUX", win32: "WINDOWS" }[process.platform];
const contendedCode = windows ? "33" : String(constants.errno.EWOULDBLOCK);
const invalidHandleCode = windows ? "6" : String(constants.errno.EBADF);

function fact(operation, actor, changes = {}) {
  return {
    operation,
    returnValue:
      operation === "OPEN" ? handles[actor] : operation === "FLAGS" ? "1" : windows ? "1" : "0",
    errorCode: "0",
    identity: operation === "OPEN" ? null : clone(leafIdentity),
    nativeHandle: operation === "CLOSE" ? null : handles[actor],
    nonInheritable: operation === "OPEN" ? null : true,
    ...changes,
  };
}

/**
 * One complete synthetic four-case transcript in the landed reducer's expected
 * order. It is captured input for that reducer, never a measurement: no process
 * ran and no native call was issued to produce any event in it.
 */
function caseTranscripts() {
  let sequence = 0;
  const cases = caseIds.map((caseId, index) => {
    const events = [];
    const emit = (actor, kind, data) =>
      events.push({ sequence: String(sequence++), actor, kind, data });
    const call = (actor, operation, changes) =>
      emit(actor, "CALL", fact(operation, actor, changes));
    const command = (actor, name) => emit(actor, "COMMAND", { name });
    function barrier() {
      call("PARENT", "OPEN", { nativeHandle: "41", returnValue: "41" });
      for (let repeat = 0; repeat < (windows ? 2 : 1); repeat += 1)
        call("PARENT", "IDENTIFY", {
          identity: clone(rootIdentity),
          nativeHandle: "41",
          nonInheritable: null,
        });
      call("PARENT", "CLOSE", { identity: clone(rootIdentity), nonInheritable: null });
      for (const operation of readOperations) call("PARENT", operation);
      emit("PARENT", "CUSTODY", {
        rootIdentity: clone(rootIdentity),
        leafIdentity: clone(leafIdentity),
        regularFile: true,
        linkCount: "1",
        size: "1",
      });
    }
    function ready(actor) {
      barrier();
      command(actor, "READY");
      for (const [position, operation] of openOperations.entries())
        call(actor, operation, {
          nonInheritable: position === openOperations.length - 1 ? true : null,
        });
    }
    function lock(actor, contended = false) {
      call(
        actor,
        "TRY_LOCK",
        contended ? { returnValue: windows ? "0" : "-1", errorCode: contendedCode } : {},
      );
    }
    function terminal(actor, forced = false) {
      const data = { exitCode: forced ? null : "0", signal: forced ? "SIGKILL" : null };
      emit(actor, "EXIT", { ...data });
      emit(actor, "CLOSE", { ...data });
    }
    function release() {
      barrier();
      command("HOLDER", "RELEASE");
      call("HOLDER", "UNLOCK");
    }
    function close(actor) {
      barrier();
      command(actor, "CLOSE");
      call(actor, "CLOSE");
      terminal(actor);
    }

    ready("HOLDER");
    if (index === 0) ready("CONTENDER");
    barrier();
    command("HOLDER", "ACQUIRE");
    lock("HOLDER");
    barrier();
    lock("PARENT", true);
    if (index === 0) {
      barrier();
      command("CONTENDER", "ACQUIRE");
      lock("CONTENDER", true);
      close("CONTENDER");
      release();
      close("HOLDER");
    } else if (index === 1) {
      release();
      barrier();
      lock("PARENT");
      barrier();
      call("PARENT", "UNLOCK");
      close("HOLDER");
    } else if (index === 2) {
      barrier();
      command("HOLDER", "SPAWN_DEFAULT_CHILD");
      for (const operation of readOperations) call("HOLDER", operation);
      emit("HOLDER", "INSPECTION", {
        nativeHandle: handles.HOLDER,
        identity: clone(leafIdentity),
        nonInheritable: true,
        errorCode: "0",
      });
      command("DEFAULT_CHILD", "READY");
      call("DEFAULT_CHILD", "IDENTIFY", {
        returnValue: windows ? "0" : "-1",
        errorCode: invalidHandleCode,
        identity: null,
        nativeHandle: null,
        nonInheritable: null,
      });
      emit("DEFAULT_CHILD", "INSPECTION", {
        nativeHandle: handles.HOLDER,
        identity: null,
        nonInheritable: null,
        errorCode: invalidHandleCode,
      });
      barrier();
      lock("PARENT", true);
      barrier();
      command("HOLDER", "CLOSE");
      command("DEFAULT_CHILD", "CLOSE");
      terminal("DEFAULT_CHILD");
      release();
      close("HOLDER");
    } else {
      barrier();
      command("HOLDER", "TERMINATE");
      emit("HOLDER", "TERMINATION", { signal: "SIGKILL", accepted: true });
      terminal("HOLDER", true);
      lock("PARENT");
      barrier();
      call("PARENT", "UNLOCK");
    }
    barrier();
    return { caseId, events, result: "OBSERVED" };
  });
  return {
    operatingSystem: localOS ?? "UNSUPPORTED_HOST",
    rootIdentity: clone(rootIdentity),
    leafIdentity: clone(leafIdentity),
    witnessNativeHandle: handles.PARENT,
    cases,
  };
}

function renumber(input) {
  let sequence = 0;
  for (const row of input.cases)
    for (const event of row.events) event.sequence = String(sequence++);
  return input;
}

/** Two post-death lock attempts: the ledger's named `FALSE_DEATH_OR_RETRY` retry. */
function retriedDeathTranscript() {
  const input = caseTranscripts();
  const events = input.cases[caseIds.length - 1].events;
  const position = events.findLastIndex(
    (event) =>
      event.actor === "PARENT" && event.kind === "CALL" && event.data.operation === "TRY_LOCK",
  );
  if (position < 0) refuse();
  events.splice(position + 1, 0, clone(events[position]));
  return renumber(input);
}

/** A duplicated per-OS case-census row, refused before that row is interpreted. */
function duplicatedCaseCensusTranscript() {
  const input = caseTranscripts();
  input.cases[1] = clone(input.cases[0]);
  return renumber(input);
}

const reviewedCandidateSource = "/* reviewed native-lock candidate: fixed range and flags */\n";
const substitutedCandidateSource =
  "/* substituted native-lock candidate: widened range and blocking flags */\n";

function candidateSnapshot(source) {
  const bytes = bytesOf(source);
  const sha256Digest = hex(bytes);
  return {
    digest: hex(bytesOf(`iss048-native-lock-candidate-subject/v1\n${sha256Digest}\n`)),
    files: [{ bytes, executable: false, path: hostedNativeLockCandidateSourcePath }],
    subject: {
      files: [
        {
          byteLength: String(bytes.byteLength),
          executable: false,
          path: hostedNativeLockCandidateSourcePath,
          sha256Digest,
        },
      ],
    },
  };
}

const witnessOutputPath = "builds/STABLE_WITNESS/native-lock-witness.node";
const candidateOutputPath = "builds/CANDIDATE_BINDING/native-lock-candidate.node";

/** A `PENDING_CANDIDATE_CONSUME`-shaped capture whose `loaded` members are null. */
function pendingPreparation(substituteWitnessOutput) {
  const outputs = [
    { path: witnessOutputPath, byteLength: "24", sha256: hex(bytesOf("witness-output")) },
    { path: candidateOutputPath, byteLength: "26", sha256: hex(bytesOf("candidate-output")) },
  ];
  const retainedFiles = outputs.map((output) => ({
    path: `build/${output.path}`,
    byteLength: output.byteLength,
    sha256: output.sha256,
  }));
  const declared = clone(outputs);
  if (substituteWitnessOutput) {
    declared[0].byteLength = outputs[1].byteLength;
    declared[0].sha256 = outputs[1].sha256;
  }
  return {
    buildPathPrefix: "build/",
    helper: {
      builds: [
        { role: "STABLE_WITNESS", loaded: null, outputs: [declared[0]] },
        { role: "CANDIDATE_BINDING", loaded: null, outputs: [declared[1]] },
      ],
    },
    retainedFiles,
    status: "PENDING_CANDIDATE_CONSUME",
  };
}

function closeReply(extra) {
  const reply = { sequence: "0", name: "CLOSE", facts: [fact("CLOSE", "HOLDER")], state: "CLOSED" };
  return extra === undefined ? reply : { ...reply, ...extra };
}

const honestSuiteCoordinates = Object.freeze({
  architecture: "X64",
  jobId: "iss022-native-lock-experiment-linux",
  observedAt: "2026-09-05T00:00:00.000Z",
  osImageDigest: hex(bytesOf("iss048-slice32-os-image")),
  packageManagerVersion: "11.22.0",
  providerRunDigest: hex(bytesOf("iss048-slice32-provider-run")),
});

/**
 * A forged experiment report offered to unrelated parsers. It is hostile input
 * for `CAPABILITY_CONFUSION`, not this slice's report: it adds, renames and
 * removes no report member, no consumer reads a value out of it, and no
 * producer in this module emits it as evidence.
 */
function forgedExperimentReport() {
  return {
    experiment: "iss022-native-lock-experiment/v1",
    coordinates: {
      repositoryId: "0",
      runId: "0",
      runAttempt: "1",
      workflowRevision: "0".repeat(40),
      candidateRevision: "0".repeat(40),
      jobId: "iss022-native-lock-experiment-linux",
      operatingSystem: localOS ?? "LINUX",
      architecture: "X64",
      nodeVersion: "24.0.0",
      nodeModulesVersion: "137",
      nodeNapiVersion: "10",
    },
    builds: [],
    custody: null,
    cases: [],
    controls: [],
    result: "OBSERVED",
  };
}

/** The landed guards each executable row reaches. Substituted only by mutants. */
export const nativeLockControlGuards = Object.freeze({
  candidateSubjectBinding: checkCandidateSubjectBinding,
  capabilityDecisionCore: parsePortablePrimitivesCapabilityDecisionCore,
  caseTranscriptReduction: reduceCaseTranscripts,
  childInspection: requireInspection,
  custodyBarrier: requireCustody,
  parentInspection: requireInspection,
  pendingCandidateReply: candidateReply,
  preLoadBuildBinding: checkPreLoadBuildBinding,
  publication: checkPortablePrimitivesPublication,
  suiteCoordinates: (value) => parseIss022SuiteCoordinates(value, false),
});

function thrown(run) {
  try {
    run();
    return { accepted: true, detail: "guard accepted the captured input" };
  } catch (error) {
    return { accepted: false, detail: brief(error?.message ?? error) };
  }
}
function issued(run) {
  try {
    const issues = run();
    return Array.isArray(issues) && issues.length === 0
      ? { accepted: true, detail: "guard returned no issue" }
      : { accepted: false, detail: brief((issues ?? ["guard:non-array-result"]).join(",")) };
  } catch (error) {
    return { accepted: false, detail: brief(error?.message ?? error) };
  }
}
function reduced(run) {
  try {
    const output = run();
    if (output?.transcriptResult === "OBSERVED")
      return { accepted: true, detail: "reducer observed every case row" };
    const reason = output?.failures?.[0]?.reason ?? "unreported";
    return { accepted: false, detail: brief(`${output?.transcriptResult ?? "MISSING"}:${reason}`) };
  } catch (error) {
    return { accepted: false, detail: brief(error?.message ?? error) };
  }
}

// The nine captured-input rows in the ledger's census order, positionally
// aligned with `controlIds` after the three witness-dependent rows. Each row
// names the landed guard it reaches, the one mutant it retains, and the honest
// counterpart that proves the guard is not a blanket refuser.
const executableRows = Object.freeze([
  {
    // INHERITABLE_FLAGS
    guard: "probes/portable-primitives/experiment/facts.mjs#requireInspection",
    mutant: "stable-inspection-read-back-non-inheritable-false",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: {
        nativeHandle: handles.HOLDER,
        identity: clone(leafIdentity),
        nonInheritable: true,
        errorCode: "0",
      },
      mutated: {
        nativeHandle: handles.HOLDER,
        identity: clone(leafIdentity),
        nonInheritable: false,
        errorCode: "0",
      },
    }),
    run: (guards, value) => thrown(() => guards.parentInspection(value, clone(leafIdentity))),
  },
  {
    // INHERITED_IDENTITY
    guard: "probes/portable-primitives/experiment/facts.mjs#requireInspection(child)",
    mutant: "child-inspection-same-file-identity-with-claimed-non-inherit-flags",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: {
        nativeHandle: handles.HOLDER,
        identity: clone(foreignIdentity),
        nonInheritable: true,
        errorCode: "0",
      },
      mutated: {
        nativeHandle: handles.HOLDER,
        identity: clone(leafIdentity),
        nonInheritable: true,
        errorCode: "0",
      },
    }),
    run: (guards, value) => thrown(() => guards.childInspection(value, clone(leafIdentity), true)),
  },
  {
    // WRONG_CUSTODY
    guard: "probes/portable-primitives/experiment/facts.mjs#requireCustody",
    mutant: "captured-barrier-leaf-identity-substituted",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: {
        rootIdentity: clone(rootIdentity),
        leafIdentity: clone(leafIdentity),
        regularFile: true,
        linkCount: "1",
        size: "1",
      },
      mutated: {
        rootIdentity: clone(rootIdentity),
        leafIdentity: clone(foreignIdentity),
        regularFile: true,
        linkCount: "1",
        size: "1",
      },
    }),
    run: (guards, value) =>
      thrown(() => guards.custodyBarrier(value, clone(rootIdentity), clone(leafIdentity))),
  },
  {
    // WRONG_RANGE_OR_FLAGS
    guard: "scripts/conformance/hosted-native-lock-preparation.mts#checkCandidateSubjectBinding",
    mutant: "reviewed-call-and-compile-parameters-substituted",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: { reviewedSource: reviewedCandidateSource, suppliedSource: reviewedCandidateSource },
      mutated: {
        reviewedSource: reviewedCandidateSource,
        suppliedSource: substitutedCandidateSource,
      },
    }),
    run: (guards, value) =>
      issued(() =>
        guards.candidateSubjectBinding(
          { candidateSubjectDigest: candidateSnapshot(value.reviewedSource).digest },
          candidateSnapshot(value.suppliedSource),
        ),
      ),
  },
  {
    // BUILD_OR_LOADER_SUBSTITUTION, pre-load half only
    guard: "scripts/conformance/hosted-native-lock-preparation.mts#checkPreLoadBuildBinding",
    mutant: "candidate-bytes-substituted-for-the-witness-output",
    executedHalf: "PRE_LOAD_RETAINED_BYTE_REHASH",
    deferredHalves: Object.freeze(["POST_LOAD_RETAINED_BYTE_REHASH"]),
    replay: () => ({ honest: pendingPreparation(false), mutated: pendingPreparation(true) }),
    run: (guards, value) => issued(() => guards.preLoadBuildBinding(value)),
  },
  {
    // MALFORMED_OR_FORGED_FACTS
    guard: "probes/portable-primitives/experiment/capture.mjs#candidateReply",
    mutant: "pending-reply-carries-an-extra-candidate-verdict-member",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: { actor: "HOLDER", command: { sequence: "0", name: "CLOSE" }, reply: closeReply() },
      mutated: {
        actor: "HOLDER",
        command: { sequence: "0", name: "CLOSE" },
        reply: closeReply({ result: "OBSERVED" }),
      },
    }),
    run: (guards, value) =>
      thrown(() =>
        guards.pendingCandidateReply(
          measurement(),
          value.actor,
          value.reply,
          value.command,
          clone(leafIdentity),
          handles.HOLDER,
        ),
      ),
  },
  {
    // FALSE_DEATH_OR_RETRY
    guard: "probes/portable-primitives/experiment/reduction.mjs#reduceCaseTranscripts",
    mutant: "death-row-carries-two-post-death-lock-attempts",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({ honest: caseTranscripts(), mutated: retriedDeathTranscript() }),
    run: (guards, value) => reduced(() => guards.caseTranscriptReduction(value)),
  },
  {
    // MISSING_OR_MIXED_CENSUS, per-OS half only
    guard: "probes/portable-primitives/experiment/reduction.mjs#reduceCaseTranscripts",
    mutant: "per-os-case-census-row-duplicated",
    executedHalf: "PER_OS_CASE_CENSUS",
    deferredHalves: Object.freeze(["CROSS_OS_CENSUS", "CROSS_ATTEMPT_CENSUS"]),
    replay: () => ({ honest: caseTranscripts(), mutated: duplicatedCaseCensusTranscript() }),
    run: (guards, value) => reduced(() => guards.caseTranscriptReduction(value)),
  },
  {
    // CAPABILITY_CONFUSION
    guard:
      "packages/conformance/src/iss022-profile.ts#parseIss022SuiteCoordinates;" +
      "packages/conformance/src/portable-primitives-decision.ts#parsePortablePrimitivesCapabilityDecisionCore;" +
      "packages/conformance/src/portable-primitives-publication.ts#checkPortablePrimitivesPublication",
    mutant: "experiment-report-and-observed-fed-to-profile-core-and-publication-parsers",
    executedHalf: null,
    deferredHalves: Object.freeze([]),
    replay: () => ({
      honest: { coordinates: clone(honestSuiteCoordinates) },
      mutated: { report: forgedExperimentReport(), verdict: "OBSERVED" },
    }),
    run: (guards, value) => {
      if (Object.hasOwn(value, "coordinates")) {
        const parsed = guards.suiteCoordinates(value.coordinates);
        return parsed?.ok === true
          ? { accepted: true, detail: "profile parser accepted its own coordinates record" }
          : { accepted: false, detail: brief((parsed?.issues ?? ["unreported"]).join(",")) };
      }
      const reasons = [];
      let accepted = false;
      for (const offered of [value.report, value.verdict]) {
        for (const [name, parse] of [
          ["profile", (input) => guards.suiteCoordinates(input)],
          ["core", (input) => guards.capabilityDecisionCore(input)],
          [
            "publication",
            (input) =>
              guards.publication("planning/pressure-tests", {
                "decision-core.json": bytesOf(canonicalJson(input)),
                "independent-review.json": bytesOf(canonicalJson(input)),
                "decision.json": bytesOf(canonicalJson(input)),
              }),
          ],
        ]) {
          let outcome;
          try {
            outcome = parse(offered);
          } catch {
            reasons.push(`${name}:threw`);
            continue;
          }
          if (outcome?.ok === true) accepted = true;
          reasons.push(`${name}:${(outcome?.issues ?? ["unreported"]).slice(0, 2).join("|")}`);
        }
      }
      return { accepted, detail: brief(reasons.join(",")) };
    },
  },
]);
if (executableRows.length !== controlIds.length - witnessDependentCount) refuse();

/**
 * Derive the nullable arm of a witness-dependent row from stable prerequisite
 * evidence. Stage three executes no call-interception fixture, so there is no
 * path from this function to `REFUSED` or `VIOLATED`: an unsupported exact
 * prerequisite yields `UNSUPPORTED`, and every other state yields `UNKNOWN`
 * because the control did not run.
 */
export function deriveNativeLockControlPrerequisiteArm(prerequisites) {
  const parsed = record(prerequisites, nativeLockControlPrerequisiteFields);
  if (
    nativeLockControlPrerequisiteFields.some((field) => !prerequisiteStates.includes(parsed[field]))
  )
    refuse();
  const unsupported = nativeLockControlPrerequisiteFields.filter(
    (field) => parsed[field] === "UNSUPPORTED",
  );
  return unsupported.length > 0
    ? Object.freeze({
        arm: nativeLockControlArms.UNSUPPORTED,
        prerequisite: `unsupported:${unsupported.join("+")}`,
      })
    : Object.freeze({
        arm: nativeLockControlArms.UNKNOWN,
        prerequisite: "not-run:no-call-interception-fixture-before-sub-slice-3.3",
      });
}

function observationOf(row) {
  return Object.freeze({
    archiveRelativeInputPath: row.inputPath,
    controlId: row.controlId,
    deferredHalves: Object.freeze([...row.deferredHalves]),
    detail: row.detail,
    evidence: row.evidence,
    executedHalf: row.executedHalf,
    guard: row.guard,
    mutant: row.mutant,
    prerequisite: row.prerequisite,
    refused: row.arm.refused,
    result: row.arm.result,
  });
}

/**
 * Build the ordered twelve-row control census and the fixed files it retains.
 * `records` are exactly the report's `{controlId,refused,result}` rows in the
 * landed census order; `files` carries their archive-relative paths and values.
 */
export function buildNativeLockControlCensus(input, boundary = {}) {
  const parsed = record(input, ["prerequisites"]);
  const guards = Object.freeze({ ...nativeLockControlGuards, ...(boundary.guards ?? {}) });
  const derived = deriveNativeLockControlPrerequisiteArm(parsed.prerequisites);
  const rows = controlIds.map((controlId, index) => {
    const paths = nativeLockControlPaths(controlId);
    if (index < witnessDependentCount)
      return {
        arm: derived.arm,
        controlId,
        deferredHalves: [],
        detail: "witness-dependent control did not run; nullable arm from stable prerequisites",
        evidence: "STABLE_PREREQUISITE_DERIVATION",
        executedHalf: null,
        guard: null,
        inputPath: null,
        mutant: null,
        observationPath: paths.observationPath,
        prerequisite: derived.prerequisite,
        retained: null,
      };
    const definition = executableRows[index - witnessDependentCount];
    const replay = definition.replay();
    const honest = definition.run(guards, replay.honest);
    const mutated = definition.run(guards, replay.mutated);
    const reached = honest.accepted === true;
    const arm = !reached
      ? nativeLockControlArms.UNKNOWN
      : mutated.accepted
        ? nativeLockControlArms.VIOLATED
        : nativeLockControlArms.REFUSED;
    return {
      arm,
      controlId,
      deferredHalves: definition.deferredHalves,
      detail: reached
        ? `honest counterpart accepted; mutant ${mutated.accepted ? "accepted" : "refused"}: ${mutated.detail}`
        : `guard refused its own honest counterpart, so the mutant proves nothing: ${honest.detail}`,
      evidence: "SYNTHETIC_STABLE_GUARD_REPLAY",
      executedHalf: definition.executedHalf,
      guard: definition.guard,
      inputPath: reached ? paths.inputPath : null,
      mutant: definition.mutant,
      observationPath: paths.observationPath,
      prerequisite: null,
      retained: reached
        ? {
            controlId,
            guard: definition.guard,
            half: definition.executedHalf,
            mutant: definition.mutant,
            replay,
          }
        : null,
    };
  });
  const files = [];
  for (const row of rows) {
    if (row.retained !== null)
      files.push(Object.freeze({ path: row.inputPath, value: row.retained }));
    files.push(Object.freeze({ path: row.observationPath, value: observationOf(row) }));
  }
  return Object.freeze({
    files: Object.freeze(files),
    observations: Object.freeze(rows.map(observationOf)),
    records: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          controlId: row.controlId,
          refused: row.arm.refused,
          result: row.arm.result,
        }),
      ),
    ),
  });
}

const armByResult = new Map(
  Object.values(nativeLockControlArms).map((arm) => [arm.result, arm.refused]),
);

/**
 * Refuse a census that is missing, duplicated, reordered or carries an invalid
 * arm pairing, and refuse any presence pattern other than the ledger's: an
 * executed row requires both fixed files, an unavailable row requires its
 * `observation.json` and forbids its `input.json`.
 */
export function checkNativeLockControlCensus(records, presentPaths) {
  const issues = [];
  const rows = Array.isArray(records) ? records : [];
  const present = new Set(Array.isArray(presentPaths) ? presentPaths : []);
  if (rows.length !== controlIds.length) issues.push("controls:census-length-refused");
  for (const [index, controlId] of controlIds.entries()) {
    const row = rows[index];
    if (!row || row.controlId !== controlId) {
      issues.push("controls:census-order-refused");
      continue;
    }
    let parsed;
    try {
      parsed = record(row, ["controlId", "refused", "result"]);
    } catch {
      issues.push("controls:row-census-refused");
      continue;
    }
    if (!armByResult.has(parsed.result) || armByResult.get(parsed.result) !== parsed.refused) {
      issues.push("controls:arm-pairing-refused");
      continue;
    }
    const paths = nativeLockControlPaths(controlId);
    const executed = parsed.refused !== null;
    if (!present.has(paths.observationPath)) issues.push("controls:observation-file-required");
    if (executed && !present.has(paths.inputPath)) issues.push("controls:input-file-required");
    if (!executed && present.has(paths.inputPath)) issues.push("controls:input-file-forbidden");
  }
  const expected = new Set();
  for (const controlId of controlIds) {
    const paths = nativeLockControlPaths(controlId);
    expected.add(paths.inputPath);
    expected.add(paths.observationPath);
  }
  for (const path of present) if (!expected.has(path)) issues.push("controls:extra-file-refused");
  return sorted(issues);
}

function hygienic(path) {
  return (
    typeof path === "string" &&
    path.startsWith(nativeLockControlPrefix) &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes("\0"))
  );
}

/**
 * Write the fixed control files under the archive root's `controls/` child.
 * Refuses a non-canonical root, a duplicate or non-hygienic archive-relative
 * path, an already present file, and any presence pattern the census rejects.
 */
export async function writeNativeLockControlFiles(archiveRoot, census) {
  absolute(archiveRoot);
  const files = census?.files;
  if (!Array.isArray(files) || files.length === 0) refuse();
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || !paths.every(hygienic)) refuse();
  if (checkNativeLockControlCensus(census.records, paths).length !== 0) refuse();
  for (const file of files) {
    const target = resolve(archiveRoot, ...file.path.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, canonicalJson(file.value), { encoding: "utf8", flag: "wx" });
  }
  return sorted(paths);
}

/**
 * The control-phase entry point a later sub-slice wires before the case phase.
 * It builds the census, writes the fixed files, and returns the ordered report
 * rows with the archive-relative paths it retained. It runs no fixture and
 * releases no resource, because this slice adds no call-interception fixture.
 */
export async function runNativeLockControlPhase(archiveRoot, input, boundary = {}) {
  const census = buildNativeLockControlCensus(input, boundary);
  const retained = await writeNativeLockControlFiles(archiveRoot, census);
  return Object.freeze({
    observations: census.observations,
    records: census.records,
    retained,
  });
}

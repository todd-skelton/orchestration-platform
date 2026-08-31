// Private, pure transcript checking only. This module reads no retained bytes,
// loads no addon and grants no experiment/receipt/publication authority.
import { canonicalJson, snapshotClosedArray } from "../../../packages/contracts/src/runtime.ts";
import {
  decimal,
  identity,
  inspectionFromFacts,
  lockDisposition,
  openOperations,
  parseCustodyResult,
  parseFacts,
  readOperations,
  record,
  refuse,
  requireLiveFacts,
  sameIdentity,
  successful,
} from "./facts.mjs";

export const caseIds = Object.freeze([
  "NATIVE_UNRELATED_EXCLUSION",
  "NATIVE_NORMAL_RELEASE",
  "NATIVE_DEFAULT_NON_INHERITANCE",
  "NATIVE_HOLDER_DEATH_ONCE",
]);
export const missingPrerequisites = Object.freeze([
  "retained bytes and complete source/build/load/ABI census",
  "exact captured process handles, pending replies and immediate native call execution",
  "initial/final custody bytes and complete ancestor checks",
  "twelve replayed refusal controls with retained inputs and observations",
  "three-OS same-attempt reports and terminal provider/workflow/archive evidence",
]);
const results = Object.freeze(["OBSERVED", "UNSUPPORTED", "VIOLATED", "UNKNOWN"]);
const localOS = { linux: "LINUX", darwin: "MACOS", win32: "WINDOWS" }[process.platform];
const windows = process.platform === "win32";
const completedFailure = Symbol("complete failed measurement prefix");
const kinds = Object.freeze({
  COMMAND: ["name"],
  CALL: ["operation", "returnValue", "errorCode", "identity", "nativeHandle", "nonInheritable"],
  CUSTODY: ["rootIdentity", "leafIdentity", "regularFile", "linkCount", "size"],
  EXIT: ["exitCode", "signal"],
  CLOSE: ["exitCode", "signal"],
  TERMINATION: ["signal", "accepted"],
  WATCHDOG: ["limitMilliseconds", "elapsedNanoseconds"],
  INSPECTION: ["nativeHandle", "identity", "nonInheritable", "errorCode"],
});

function array(value) {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok) refuse();
  return parsed.value;
}
export function reduceResults(value) {
  const input = array(value);
  if (!input.length || input.some((entry) => !results.includes(entry))) return "UNKNOWN";
  return input.reduce((a, b) => (results.indexOf(a) > results.indexOf(b) ? a : b));
}

function event(value, sequence) {
  const e = record(value, ["sequence", "actor", "kind", "data"]);
  if (
    decimal(e.sequence) !== String(sequence) ||
    !["PARENT", "HOLDER", "CONTENDER", "DEFAULT_CHILD"].includes(e.actor) ||
    !Object.hasOwn(kinds, e.kind)
  )
    refuse();
  const data = record(e.data, kinds[e.kind]);
  if (e.kind === "CALL") parseFacts([data]);
  if (
    e.kind === "COMMAND" &&
    !["READY", "ACQUIRE", "RELEASE", "SPAWN_DEFAULT_CHILD", "TERMINATE", "CLOSE"].includes(
      data.name,
    )
  )
    refuse();
  if (e.kind === "EXIT" || e.kind === "CLOSE") {
    if (data.exitCode !== null) decimal(data.exitCode, true);
    if (data.signal !== null && data.signal !== "SIGKILL") refuse();
  }
  if (e.kind === "TERMINATION" && (data.signal !== "SIGKILL" || typeof data.accepted !== "boolean"))
    refuse();
  if (e.kind === "WATCHDOG") {
    if (data.limitMilliseconds !== "10000") refuse();
    decimal(data.elapsedNanoseconds);
  }
  return e;
}

function checkRow(events, index, context, reportFailure) {
  let cursor = 0,
    freshBarrier = false;
  let failed = false;
  function fail(result, reason) {
    failed = true;
    reportFailure(result, reason);
  }
  function checkpoint() {
    // A failed native measurement ends the case; later cleanup/rows are not
    // fabricated to complete a happy-path transcript. Missing death terminals
    // still refuse before its attempt, regardless of any prior claim.
    if (failed && cursor === events.length) throw completedFailure;
  }
  const handles = { PARENT: context.witnessNativeHandle };
  const peek = () => events[cursor];
  function take(actor, kind) {
    const next = events[cursor++];
    if (!next || next.actor !== actor || next.kind !== kind) refuse();
    freshBarrier = false;
    return next.data;
  }
  function calls(actor, operations) {
    return operations.map((operation) => {
      const fact = take(actor, "CALL");
      if (fact.operation !== operation) refuse();
      return fact;
    });
  }
  function match(actual, expected, reason) {
    if (actual === null) fail("UNKNOWN", `${reason}:missing identity`);
    else if (!sameIdentity(actual, expected)) fail("VIOLATED", `${reason}:identity mismatch`);
  }
  function live(facts, operations, actor, expected = context.leafIdentity) {
    const final = facts.at(-1);
    for (const fact of facts) {
      if (!successful(fact))
        fail("UNKNOWN", `${actor}:${fact.operation}:unsuccessful metadata or cleanup`);
      if (fact.operation !== "OPEN" || fact.identity !== null)
        match(fact.identity, expected, actor);
    }
    if (final.nonInheritable === false) fail("VIOLATED", `${actor}:inheritable flags`);
    else if (final.nonInheritable !== true) fail("UNKNOWN", `${actor}:missing flags`);
    if (handles[actor] !== undefined && final.nativeHandle !== handles[actor])
      fail("VIOLATED", `${actor}:handle mismatch`);
    // Foundation also checks every intermediate snapshot/descriptor and the
    // actual POSIX FD_CLOEXEC bit; do not accept only the final claim.
    try {
      return requireLiveFacts(facts, operations, expected, handles[actor]);
    } catch {
      if (
        facts.every(successful) &&
        final.nonInheritable === true &&
        final.identity !== null &&
        sameIdentity(final.identity, expected) &&
        (handles[actor] === undefined || handles[actor] === final.nativeHandle)
      )
        fail("UNKNOWN", `${actor}:inconsistent native snapshots`);
      checkpoint();
      return final.nativeHandle;
    }
  }
  function barriers(required = false) {
    while (
      peek()?.actor === "PARENT" &&
      peek()?.kind === "CALL" &&
      peek().data.operation === "OPEN"
    ) {
      const rootFacts = calls(
        "PARENT",
        windows ? ["OPEN", "IDENTIFY", "IDENTIFY", "CLOSE"] : ["OPEN", "IDENTIFY", "CLOSE"],
      );
      const leafFacts = calls("PARENT", readOperations);
      const data = take("PARENT", "CUSTODY");
      match(data.rootIdentity, context.rootIdentity, "custody root");
      match(data.leafIdentity, context.leafIdentity, "custody leaf");
      if (data.regularFile !== true || data.linkCount !== "1" || data.size !== "1")
        fail("VIOLATED", "custody metadata mismatch");
      try {
        parseCustodyResult({ identity: data.rootIdentity, facts: rootFacts });
      } catch {
        fail("UNKNOWN", "custody native transcript refused");
      }
      live(leafFacts, readOperations, "PARENT");
      freshBarrier = true;
    }
    if (required && !freshBarrier) refuse();
    checkpoint();
  }
  function command(actor, name, guarded = true) {
    if (guarded) barriers(true);
    if (take(actor, "COMMAND").name !== name) refuse();
  }
  function ready(actor) {
    command(actor, "READY");
    handles[actor] = live(calls(actor, openOperations), openOperations, actor);
  }
  function lock(actor, expected, postDeath = false) {
    const facts = calls(actor, ["TRY_LOCK"]),
      fact = facts[0];
    const disposition = lockDisposition(facts);
    match(fact.identity, context.leafIdentity, actor);
    if (fact.nativeHandle !== handles[actor] || fact.nonInheritable !== true)
      fail("VIOLATED", `${actor}:lock handle/flags mismatch`);
    if (disposition === "UNKNOWN" || disposition === "UNSUPPORTED")
      fail(disposition, `${actor}:TRY_LOCK:${fact.errorCode}`);
    else if (disposition !== expected)
      fail("VIOLATED", `${actor}:expected ${expected}, saw ${disposition}`);
    if (!postDeath) checkpoint();
  }
  function challenge(expected) {
    barriers(true);
    lock("PARENT", expected);
  }
  function unlock(actor) {
    live(calls(actor, ["UNLOCK"]), ["UNLOCK"], actor);
  }
  function release() {
    command("HOLDER", "RELEASE");
    unlock("HOLDER");
  }
  function terminal(actor, forced = false) {
    // The stable capture adapter currently uses null/SIGKILL for forced Node
    // events on all targets. This checks its transcript, not OS death itself.
    const exit = take(actor, "EXIT"),
      close = take(actor, "CLOSE");
    if (
      canonicalJson(exit) !== canonicalJson(close) ||
      exit.exitCode !== (forced ? null : "0") ||
      exit.signal !== (forced ? "SIGKILL" : null)
    )
      refuse();
  }
  function close(actor) {
    command(actor, "CLOSE");
    const fact = calls(actor, ["CLOSE"])[0];
    match(fact.identity, context.leafIdentity, actor);
    if (!successful(fact)) fail("UNKNOWN", `${actor}:close failed`);
    terminal(actor);
  }
  function inspection(actor, child = false) {
    const operations = child && peek()?.data?.errorCode !== "0" ? ["IDENTIFY"] : readOperations;
    const facts = calls(actor, operations);
    const actual = take(actor, "INSPECTION");
    const derived = inspectionFromFacts(facts, handles.HOLDER);
    if (canonicalJson(actual) !== canonicalJson(derived)) refuse();
    if (child) {
      if (derived.identity !== null && sameIdentity(derived.identity, context.leafIdentity))
        fail("VIOLATED", "default child inherited same-file handle");
    } else {
      match(derived.identity, context.leafIdentity, "holder inspection");
      if (derived.nonInheritable !== true) fail("VIOLATED", "holder inspection inheritable");
    }
    checkpoint();
  }

  ready("HOLDER");
  if (index === 0) ready("CONTENDER");
  command("HOLDER", "ACQUIRE");
  lock("HOLDER", "ACQUIRED");
  challenge("CONTENDED");
  if (index === 0) {
    command("CONTENDER", "ACQUIRE");
    lock("CONTENDER", "CONTENDED");
    close("CONTENDER");
    release();
    close("HOLDER");
  } else if (index === 1) {
    release();
    challenge("ACQUIRED");
    barriers();
    unlock("PARENT");
    close("HOLDER");
  } else if (index === 2) {
    command("HOLDER", "SPAWN_DEFAULT_CHILD");
    inspection("HOLDER");
    command("DEFAULT_CHILD", "READY", false);
    inspection("DEFAULT_CHILD", true);
    challenge("CONTENDED");
    command("HOLDER", "CLOSE");
    command("DEFAULT_CHILD", "CLOSE", false);
    terminal("DEFAULT_CHILD");
    release();
    close("HOLDER");
  } else {
    command("HOLDER", "TERMINATE");
    if (take("HOLDER", "TERMINATION").accepted !== true) fail("UNKNOWN", "termination rejected");
    terminal("HOLDER", true);
    // No barrier, timer, cleanup, second open or other event may appear here.
    lock("PARENT", "ACQUIRED", true);
    barriers(true);
    unlock("PARENT");
  }
  barriers(true);
  if (cursor !== events.length) refuse();
}

// Input is diagnostic data plus expected identity/handle context, never proof
// of its provenance. `transcriptResult` is suitable for stable guard replay;
// `result` intentionally remains UNKNOWN until a separate retained-byte/build/
// control/provider verifier exists. No JSON boolean can discharge those gates.
// Foreign OS interpretation fails closed because facts.mjs uses host constants.
export function reduceCaseTranscripts(value) {
  const failures = [],
    cases = [];
  const fail = (result, reason, caseId = null) =>
    failures.push(Object.freeze({ caseId, result, reason }));
  try {
    const input = record(value, [
      "operatingSystem",
      "rootIdentity",
      "leafIdentity",
      "witnessNativeHandle",
      "cases",
    ]);
    if (
      !["LINUX", "MACOS", "WINDOWS"].includes(input.operatingSystem) ||
      input.operatingSystem !== localOS
    )
      refuse();
    identity(input.rootIdentity);
    identity(input.leafIdentity);
    decimal(input.witnessNativeHandle);
    if (sameIdentity(input.rootIdentity, input.leafIdentity)) refuse();
    const rows = array(input.cases);
    if (rows.length !== caseIds.length) refuse();
    let sequence = 0,
      previous = "OBSERVED";
    for (const [index, caseId] of caseIds.entries()) {
      const start = failures.length;
      try {
        const row = record(rows[index], ["caseId", "events", "result"]);
        if (row.caseId !== caseId || !results.includes(row.result)) refuse();
        // Submitted result is checked for vocabulary only, never trusted.
        const events = array(row.events).map((entry) => event(entry, sequence++));
        for (const e of events)
          if (e.kind === "WATCHDOG") fail("UNKNOWN", "watchdog expired", caseId);
        if (!events.length) {
          fail(previous === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN", "unexecuted row", caseId);
        } else {
          if (previous !== "OBSERVED")
            fail("UNKNOWN", "row executed after failed prerequisite", caseId);
          checkRow(events, index, input, (result, reason) => fail(result, reason, caseId));
        }
      } catch (error) {
        if (error !== completedFailure)
          fail("UNKNOWN", "missing, malformed or out-of-order transcript", caseId);
      }
      const rowFailures = failures.slice(start);
      previous = reduceResults(
        rowFailures.length ? rowFailures.map((entry) => entry.result) : ["OBSERVED"],
      );
      cases.push(
        Object.freeze({ caseId, transcriptResult: previous, failures: Object.freeze(rowFailures) }),
      );
    }
  } catch {
    fail("UNKNOWN", "case census, OS adapter or expected context refused");
  }
  return Object.freeze({
    cases: Object.freeze(cases),
    failures: Object.freeze(failures),
    transcriptResult: reduceResults(
      failures.length ? failures.map((entry) => entry.result) : ["OBSERVED"],
    ),
    missingPrerequisites,
    result: "UNKNOWN",
  });
}

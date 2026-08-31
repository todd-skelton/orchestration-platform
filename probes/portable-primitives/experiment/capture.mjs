// Stable process capture and bounded refusal guards. Synthetic transports can
// exercise these guards; their transcripts are never native evidence.
import { canonicalJson, snapshotJson } from "../../../packages/contracts/src/runtime.ts";
import { constants } from "node:os";
import { types } from "node:util";
import {
  inspectionFromFacts,
  lockDisposition,
  openOperations,
  operationsAre,
  parseFacts,
  record,
  refuse,
  requireInspection,
  requireLiveFacts,
  sameIdentity,
  successful,
} from "./facts.mjs";

const precedence = ["OBSERVED", "UNSUPPORTED", "VIOLATED", "UNKNOWN"];
export function measurement(
  nextSequence = (() => {
    let n = 0;
    return () => String(n++);
  })(),
) {
  const events = [],
    failures = [];
  let frozen = false;
  return Object.freeze({
    events,
    failures,
    get isFrozen() {
      return frozen;
    },
    get active() {
      return !frozen && failures.length === 0;
    },
    assert() {
      if (frozen || failures.length) refuse();
    },
    emit(actor, kind, data) {
      if (frozen) return;
      events.push(Object.freeze({ sequence: nextSequence(), actor, kind, data }));
    },
    fail(result, reason) {
      if (!precedence.includes(result) || result === "OBSERVED") refuse();
      if (!frozen) failures.push(Object.freeze({ result, reason }));
    },
    stop(result, reason) {
      this.fail(result, reason);
      refuse();
    },
    freeze() {
      frozen = true;
      Object.freeze(events);
      Object.freeze(failures);
      return failures.reduce(
        (a, b) => (precedence.indexOf(a) > precedence.indexOf(b.result) ? a : b.result),
        "OBSERVED",
      );
    },
  });
}

export function retainCalls(journal, actor, value) {
  const facts = parseFacts(value);
  for (const fact of facts) journal.emit(actor, "CALL", fact);
  return facts;
}

function requireSuccessful(journal, actor, facts) {
  const unsupported =
    process.platform === "win32"
      ? ["1", "5", "50"]
      : ["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EACCES", "EPERM"]
          .map((name) => constants.errno[name])
          .filter(Number.isInteger)
          .map(String);
  for (const fact of facts)
    if (!successful(fact)) {
      const nativeFailure =
        process.platform === "win32" && fact.operation === "OPEN"
          ? fact.nativeHandle === null &&
            fact.returnValue === (process.arch === "ia32" ? "4294967295" : "18446744073709551615")
          : fact.returnValue === (process.platform === "win32" ? "0" : "-1");
      journal.fail(
        nativeFailure && unsupported.includes(fact.errorCode) ? "UNSUPPORTED" : "UNKNOWN",
        `${actor}:${fact.operation}:${fact.errorCode}`,
      );
    }
  journal.assert();
}

function liveFacts(journal, actor, facts, operations, expectedIdentity, nativeHandle) {
  requireSuccessful(journal, actor, facts);
  if (!operationsAre(facts, operations)) refuse();
  for (const fact of facts) {
    if (fact.operation !== "OPEN" && fact.identity === null)
      journal.fail("UNKNOWN", `${actor}:missing native identity`);
    else if (fact.identity !== null && !sameIdentity(fact.identity, expectedIdentity))
      journal.fail("VIOLATED", `${actor}:native identity changed`);
  }
  const final = facts.at(-1);
  if (
    final.nonInheritable === false ||
    (nativeHandle !== undefined && final.nativeHandle !== nativeHandle)
  )
    journal.fail("VIOLATED", `${actor}:native handle/flags changed`);
  journal.assert();
  return requireLiveFacts(facts, operations, expectedIdentity, nativeHandle);
}

export function expectLock(journal, actor, value, expectedIdentity, nativeHandle, expected) {
  const facts = parseFacts(value); // Caller retained the actual calls exactly once.
  const disposition = lockDisposition(facts);
  const fact = facts[0];
  // Retain operation-context error classification even if identity is missing.
  if (disposition === "UNKNOWN" || disposition === "UNSUPPORTED")
    journal.fail(disposition, `${actor}:TRY_LOCK:${fact.errorCode}`);
  if (fact.identity === null) journal.fail("UNKNOWN", `${actor}:missing lock identity`);
  else if (
    !sameIdentity(fact.identity, expectedIdentity) ||
    fact.nativeHandle !== nativeHandle ||
    fact.nonInheritable !== true
  )
    journal.fail("VIOLATED", `${actor}:lock identity/flags changed`);
  if ((disposition === "ACQUIRED" || disposition === "CONTENDED") && disposition !== expected)
    journal.fail("VIOLATED", `${actor}:expected ${expected}, saw ${disposition}`);
  journal.assert();
  return disposition;
}

export function candidateReply(journal, actor, value, command, expectedIdentity, nativeHandle) {
  const reply = record(value, ["sequence", "name", "facts", "state"]);
  if (reply.sequence !== command.sequence || reply.name !== command.name) refuse();
  const facts = retainCalls(journal, actor, reply.facts);
  if (command.name === "READY") {
    const handle = liveFacts(journal, actor, facts, openOperations, expectedIdentity);
    if (reply.state !== "OPEN") refuse();
    return handle;
  }
  if (command.name === "ACQUIRE") {
    const disposition = lockDisposition(facts);
    const expectedState =
      disposition === "ACQUIRED" ? "LOCKED" : disposition === "CONTENDED" ? "OPEN" : "FAILED";
    if (reply.state !== expectedState) refuse();
  } else {
    const operation =
      command.name === "RELEASE" ? "UNLOCK" : command.name === "CLOSE" ? "CLOSE" : null;
    if (!operation || !operationsAre(facts, [operation])) refuse();
    requireSuccessful(journal, actor, facts);
    if (operation === "UNLOCK")
      liveFacts(journal, actor, facts, [operation], expectedIdentity, nativeHandle);
    else if (facts[0].identity === null || !sameIdentity(facts[0].identity, expectedIdentity))
      refuse();
    if (reply.state !== (operation === "UNLOCK" ? "OPEN" : "CLOSED")) refuse();
  }
  return facts;
}

export function defaultReply(journal, value, command, expectedIdentity, nativeHandle) {
  const reply = record(value, ["sequence", "name", "holder", "child"]);
  if (reply.sequence !== command.sequence || reply.name !== "SPAWN_DEFAULT_CHILD") refuse();
  const holder = record(reply.holder, ["facts", "inspection"]);
  const holderFacts = retainCalls(journal, "HOLDER", holder.facts);
  const inspection = inspectionFromFacts(holderFacts, nativeHandle);
  if (canonicalJson(inspection) !== canonicalJson(holder.inspection)) refuse();
  journal.emit("HOLDER", "INSPECTION", inspection);
  if (
    inspection.nonInheritable === false ||
    (inspection.identity !== null && !sameIdentity(inspection.identity, expectedIdentity))
  )
    journal.stop("VIOLATED", "HOLDER:inspection identity/flags changed");
  requireInspection(inspection, expectedIdentity);
  const child = record(reply.child, ["sequence", "name", "facts", "inspection"]);
  if (child.sequence !== command.sequence || child.name !== "READY") refuse();
  journal.emit("DEFAULT_CHILD", "COMMAND", { name: "READY" });
  const childFacts = retainCalls(journal, "DEFAULT_CHILD", child.facts);
  const childInspection = inspectionFromFacts(childFacts, nativeHandle);
  if (canonicalJson(childInspection) !== canonicalJson(child.inspection)) refuse();
  journal.emit("DEFAULT_CHILD", "INSPECTION", childInspection);
  if (childInspection.identity !== null && sameIdentity(childInspection.identity, expectedIdentity))
    journal.stop("VIOLATED", "DEFAULT_CHILD:inherited same-file handle");
  requireInspection(childInspection, expectedIdentity, true);
}

function clean(value) {
  const terminal = record(value, ["exitCode", "signal"]);
  if (terminal.exitCode !== "0" || terminal.signal !== null) refuse();
  return terminal;
}
export function childClosed(journal, value, command) {
  const reply = record(value, ["sequence", "name", "child"]);
  if (reply.sequence !== command.sequence || reply.name !== "CLOSE") refuse();
  const child = record(reply.child, ["exit", "close", "stdoutBase64", "stderrBase64"]);
  const outputs = {};
  for (const stream of ["stdout", "stderr"]) {
    const value = child[`${stream}Base64`];
    if (typeof value !== "string" || value.length > 1400000) refuse();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) refuse();
    outputs[stream] = bytes;
  }
  journal.emit("DEFAULT_CHILD", "COMMAND", { name: "CLOSE" });
  journal.emit("DEFAULT_CHILD", "EXIT", clean(child.exit));
  journal.emit("DEFAULT_CHILD", "CLOSE", clean(child.close));
  return outputs;
}

// The caller passes the handle returned by spawnFixture, never a PID. The
// synchronous death callback runs inside CLOSE, with no await/metadata/timer.
export function captureProcess(child, actor, journal) {
  let pending = null,
    terminal = null,
    exit = null,
    close = null,
    death = null,
    length = 0;
  const output = {
    stdout: [],
    stderr: [],
    commands: [],
    replies: [],
    terminals: [],
    truncated: false,
  };
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  function fail(reason) {
    journal.fail("UNKNOWN", `${actor}:${reason}`);
    pending?.reject(new Error("native-lock-capture:refused"));
    pending = null;
  }
  for (const stream of ["stdout", "stderr"])
    child[stream].on("data", (bytes) => {
      length += bytes.length;
      if (length > 1024 * 1024) {
        output.truncated = true;
        fail("output limit");
        return;
      }
      output[stream].push(Buffer.from(bytes));
    });
  child.on("error", () => fail("process error"));
  child.on("message", (value) => {
    try {
      const raw = snapshotJson(value);
      if (output.replies.length < 16) output.replies.push(raw.ok ? raw.value : null);
      else {
        output.truncated = true;
        refuse();
      }
      journal.assert();
      if (!pending || exit || close) refuse();
      if (!value || typeof value !== "object" || types.isProxy(value)) refuse();
      const fields = Object.getOwnPropertyDescriptors(value);
      if (
        !fields.sequence ||
        !fields.name ||
        !("value" in fields.sequence) ||
        !("value" in fields.name) ||
        fields.sequence.value !== pending.command.sequence ||
        fields.name.value !== pending.command.name
      )
        refuse();
      const complete = pending;
      pending = null;
      complete.resolve(value);
    } catch {
      fail("unexpected reply");
    }
  });
  child.on("disconnect", () => {
    if (!terminal) fail("unexpected disconnect");
  });
  child.on("exit", (exitCode, signal) => {
    const value = { exitCode: exitCode === null ? null : String(exitCode), signal };
    output.terminals.push({ kind: "EXIT", data: value });
    journal.emit(actor, "EXIT", value);
    if (
      exit ||
      !terminal ||
      (terminal === "CLEAN"
        ? exitCode !== 0 || signal !== null
        : signal !== "SIGKILL" || exitCode !== null)
    )
      fail("unexpected exit");
    exit = value;
  });
  child.on("close", (exitCode, signal) => {
    const value = { exitCode: exitCode === null ? null : String(exitCode), signal };
    output.terminals.push({ kind: "CLOSE", data: value });
    journal.emit(actor, "CLOSE", value);
    if (close || !exit || canonicalJson(value) !== canonicalJson(exit)) fail("unexpected close");
    close = value;
    if (death && journal.active) {
      // Next external operation after this exact handle's exit+close is TRY_LOCK.
      // Event retention and scalar checks above perform no I/O or scheduling.
      try {
        death();
      } catch {
        fail("post-death attempt refused");
      }
    }
    if (pending) fail("close before reply");
    resolveClosed(value);
  });
  return Object.freeze({
    child,
    closed,
    output,
    get isClosed() {
      return close !== null;
    },
    assertLive() {
      journal.assert();
      if (exit || close || !child.connected) refuse();
    },
    exchange(command, cleanTerminal = false) {
      this.assertLive();
      if (pending || terminal) refuse();
      if (cleanTerminal) terminal = "CLEAN";
      output.commands.push(command);
      journal.emit(actor, "COMMAND", { name: command.name });
      return new Promise((resolve, reject) => {
        pending = { command, resolve, reject };
        child.send(command, (error) => {
          if (error) fail("send failed");
        });
      });
    },
    terminateOnce(attempt) {
      this.assertLive();
      if (pending || terminal || death || typeof attempt !== "function") refuse();
      terminal = "FORCED";
      death = attempt;
      journal.emit(actor, "COMMAND", { name: "TERMINATE" });
      const accepted = child.kill("SIGKILL");
      journal.emit(actor, "TERMINATION", { signal: "SIGKILL", accepted });
      if (!accepted) fail("termination refused");
      return closed;
    },
    abort() {
      fail("measurement aborted");
    },
    cleanup() {
      if (!close) child.kill("SIGKILL");
      return closed;
    },
  });
}

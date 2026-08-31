// Synthetic transports/facts exercise real parent guards. No native addon is
// loaded, no lock is measured, and none of these tests is a refusal-control run.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { constants } from "node:os";
import test from "node:test";
import {
  candidateReply,
  captureProcess,
  childClosed,
  defaultReply,
  expectLock,
  measurement,
} from "../../probes/portable-primitives/experiment/capture.mjs";
import {
  requireCaseContext,
  stableCaseFiles,
} from "../../probes/portable-primitives/experiment/case-context.mjs";
import { caseIds } from "../../probes/portable-primitives/experiment/cases.mjs";
import {
  openOperations,
  readOperations,
} from "../../probes/portable-primitives/experiment/facts.mjs";

const windows = process.platform === "win32";
const id = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "1".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "11" };
const other = windows ? { ...id, fileIdHex: "2".repeat(32) } : { ...id, inode: "12" };
const success = windows ? "1" : "0";
const command = (name, sequence = "0") => ({ name, sequence });
function fact(operation, changes = {}) {
  return {
    operation,
    returnValue: operation === "OPEN" ? "37" : operation === "FLAGS" ? "1" : success,
    errorCode: "0",
    identity: operation === "OPEN" ? null : id,
    nativeHandle: operation === "CLOSE" ? null : "37",
    nonInheritable: true,
    ...changes,
  };
}
function transport(accepted = true) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.connected = true;
  const calls = [];
  child.send = (value, done) => {
    calls.push(["send", value]);
    done(null);
  };
  child.kill = (signal) => {
    calls.push(["kill", signal]);
    return accepted;
  };
  return { child, calls };
}

test("synthetic exact-handle death performs one synchronous attempt after exit and close", async () => {
  const { child, calls } = transport();
  const journal = measurement();
  const captured = captureProcess(child, "HOLDER", journal);
  let attempts = 0;
  const completion = captured.terminateOnce(() => {
    attempts++;
    calls.push(["try"]);
    assert.deepEqual(
      journal.events.slice(-2).map((event) => event.kind),
      ["EXIT", "CLOSE"],
    );
  });
  assert.deepEqual(calls, [["kill", "SIGKILL"]]);
  assert.throws(() => captured.terminateOnce(() => attempts++));
  child.emit("exit", null, "SIGKILL");
  assert.equal(attempts, 0);
  child.emit("close", null, "SIGKILL");
  assert.equal(attempts, 1); // Already happened; no await or timer can gate it.
  await completion;
  assert.deepEqual(calls, [["kill", "SIGKILL"], ["try"]]);
  assert.equal(journal.freeze(), "OBSERVED");
});

test("rejected termination, natural exit, mismatched close and absent exit never attempt", async () => {
  for (const scenario of ["rejected", "natural", "mismatch", "no-exit"]) {
    const { child } = transport(scenario !== "rejected");
    const journal = measurement();
    const captured = captureProcess(child, "HOLDER", journal);
    let attempts = 0;
    const completion = captured.terminateOnce(() => attempts++);
    if (scenario !== "no-exit")
      child.emit(
        "exit",
        scenario === "natural" ? 0 : null,
        scenario === "natural" ? null : "SIGKILL",
      );
    child.emit(
      "close",
      scenario === "mismatch" || scenario === "natural" ? 0 : null,
      scenario === "mismatch" || scenario === "natural" ? null : "SIGKILL",
    );
    await completion;
    assert.equal(attempts, 0, scenario);
    assert.equal(journal.freeze(), "UNKNOWN", scenario);
  }
});

test("one command in flight; mismatched and unsolicited IPC refuse captured claims", async () => {
  const { child, calls } = transport();
  const journal = measurement();
  const captured = captureProcess(child, "HOLDER", journal);
  const reply = captured.exchange(command("READY"));
  assert.throws(() => captured.exchange(command("ACQUIRE", "1")));
  child.emit("message", { name: "READY", sequence: "9", facts: [] });
  await assert.rejects(reply);
  assert.equal(calls.length, 1);
  assert.equal(journal.freeze(), "UNKNOWN");
  const second = transport();
  const secondJournal = measurement();
  captureProcess(second.child, "CONTENDER", secondJournal);
  second.child.emit("message", { name: "READY", sequence: "0" });
  assert.equal(secondJournal.freeze(), "UNKNOWN");
});

test("frozen failure cleanup retains raw streams but cannot attempt after forced close", async () => {
  const { child, calls } = transport();
  const journal = measurement();
  const captured = captureProcess(child, "HOLDER", journal);
  let attempts = 0;
  const completion = captured.terminateOnce(() => attempts++);
  journal.fail("UNKNOWN", "synthetic watchdog");
  assert.equal(journal.freeze(), "UNKNOWN");
  const eventCount = journal.events.length;
  captured.cleanup();
  child.stdout.emit("data", Buffer.from([0, 255, 10]));
  child.stderr.emit("data", Buffer.from("retained"));
  child.emit("exit", null, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  await completion;
  assert.equal(attempts, 0);
  assert.equal(journal.events.length, eventCount);
  assert.deepEqual(Buffer.concat(captured.output.stdout), Buffer.from([0, 255, 10]));
  assert.equal(Buffer.concat(captured.output.stderr).toString(), "retained");
  assert.deepEqual(calls, [
    ["kill", "SIGKILL"],
    ["kill", "SIGKILL"],
  ]);
});

test("HELD refuses bypassed lock and release/death refuses still-contended witness", () => {
  const contended = fact("TRY_LOCK", {
    errorCode: windows ? "33" : String(constants.errno.EWOULDBLOCK),
    returnValue: windows ? "0" : "-1",
  });
  for (const [facts, expected] of [
    [[fact("TRY_LOCK")], "CONTENDED"],
    [[contended], "ACQUIRED"],
  ]) {
    const journal = measurement();
    assert.throws(() => expectLock(journal, "PARENT", facts, id, "37", expected));
    assert.equal(journal.freeze(), "VIOLATED");
  }
  const journal = measurement();
  expectLock(journal, "PARENT", [contended], id, "37", "CONTENDED");
  assert.equal(journal.freeze(), "OBSERVED");
});

test("native context preserves each failure and precedence without accepting open contention", () => {
  const journal = measurement();
  assert.throws(() =>
    expectLock(
      journal,
      "PARENT",
      [
        fact("TRY_LOCK", {
          returnValue: windows ? "0" : "-1",
          errorCode: windows ? "5" : String(constants.errno.EACCES),
          identity: null,
        }),
      ],
      id,
      "37",
      "CONTENDED",
    ),
  );
  journal.fail("VIOLATED", "separate mismatch");
  assert.deepEqual(
    journal.failures.map((entry) => entry.result),
    ["UNSUPPORTED", "UNKNOWN", "VIOLATED"],
  );
  assert.equal(journal.freeze(), "UNKNOWN");
  assert.throws(() => expectLock(measurement(), "PARENT", [fact("OPEN")], id, "37", "CONTENDED"));
  const open = measurement();
  assert.throws(() =>
    candidateReply(
      open,
      "HOLDER",
      {
        ...command("READY"),
        state: "FAILED",
        facts: [
          fact("OPEN", {
            returnValue: windows
              ? process.arch === "ia32"
                ? "4294967295"
                : "18446744073709551615"
              : "-1",
            errorCode: windows ? "5" : String(constants.errno.EACCES),
            nativeHandle: null,
          }),
        ],
      },
      command("READY"),
      id,
    ),
  );
  assert.equal(open.freeze(), "UNSUPPORTED");
});

test("candidate READY validates actual fact shapes; candidate verdict and replaced identity refuse", () => {
  const reply = {
    ...command("READY"),
    state: "OPEN",
    facts: openOperations.map((operation) => fact(operation)),
  };
  assert.equal(candidateReply(measurement(), "HOLDER", reply, command("READY"), id), "37");
  assert.throws(() =>
    candidateReply(
      measurement(),
      "HOLDER",
      { ...reply, verdict: "OBSERVED" },
      command("READY"),
      id,
    ),
  );
  const journal = measurement();
  const mutated = {
    ...reply,
    facts: reply.facts.map((call) => (call.identity ? { ...call, identity: other } : call)),
  };
  assert.throws(() => candidateReply(journal, "HOLDER", mutated, command("READY"), id));
  assert.equal(journal.freeze(), "VIOLATED");
});

test("default inspection refuses same-file inheritance even with non-inherit flags", () => {
  const inspection = { nativeHandle: "37", identity: id, nonInheritable: true, errorCode: "0" };
  const facts = readOperations.map((operation) => fact(operation));
  const reply = {
    ...command("SPAWN_DEFAULT_CHILD"),
    holder: { facts, inspection },
    child: { ...command("READY"), facts, inspection },
  };
  const journal = measurement();
  assert.throws(() => defaultReply(journal, reply, command("SPAWN_DEFAULT_CHILD"), id, "37"));
  assert.equal(journal.freeze(), "VIOLATED");
  const terminal = { exitCode: "0", signal: null };
  const closed = {
    ...command("CLOSE"),
    child: { exit: terminal, close: terminal, stdoutBase64: "AP8=", stderrBase64: "" },
  };
  assert.deepEqual(
    childClosed(measurement(), closed, command("CLOSE")).stdout,
    Buffer.from([0, 255]),
  );
  assert.throws(() =>
    childClosed(
      measurement(),
      { ...closed, child: { ...closed.child, stdoutBase64: "AP8=garbage" } },
      command("CLOSE"),
    ),
  );
});

test("case context cannot be replaced by caller callbacks or a candidate report", () => {
  assert.throws(() =>
    requireCaseContext({
      tryWitness() {
        assert.fail("untrusted callback");
      },
    }),
  );
  assert.throws(() => requireCaseContext({ result: "OBSERVED" }));
  assert.deepEqual(caseIds, [
    "NATIVE_UNRELATED_EXCLUSION",
    "NATIVE_NORMAL_RELEASE",
    "NATIVE_DEFAULT_NON_INHERITANCE",
    "NATIVE_HOLDER_DEATH_ONCE",
  ]);
  assert.ok(stableCaseFiles.includes("probes/portable-primitives/experiment/cases.mjs"));
});

test("hostile proxy/accessor replies are rejected without executing their traps", async () => {
  let invoked = false;
  const accessor = Object.defineProperty({ sequence: "0" }, "name", {
    enumerable: true,
    get() {
      invoked = true;
      return "READY";
    },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        invoked = true;
        return [];
      },
    },
  );
  for (const value of [accessor, proxy]) {
    const { child } = transport();
    const journal = measurement();
    const captured = captureProcess(child, "HOLDER", journal);
    const pending = captured.exchange(command("READY"));
    child.emit("message", value);
    await assert.rejects(pending);
    assert.equal(journal.freeze(), "UNKNOWN");
  }
  assert.equal(invoked, false);
});

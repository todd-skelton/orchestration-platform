// Pure synthetic transcripts only: no filesystem, native calls or processes.
import assert from "node:assert/strict";
import { constants } from "node:os";
import test from "node:test";
import {
  caseIds,
  reduceCaseTranscripts,
  reduceResults,
} from "../../probes/portable-primitives/experiment/reduction.mjs";

const localOS = { linux: "LINUX", darwin: "MACOS", win32: "WINDOWS" }[process.platform];
function fixture(operatingSystem = localOS) {
  const windows = operatingSystem === "WINDOWS";
  const leaf = windows
    ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "1".repeat(32) }
    : { kind: "POSIX", device: "9", inode: "11" };
  const root = windows ? { ...leaf, fileIdHex: "2".repeat(32) } : { ...leaf, inode: "12" };
  const read = windows ? ["IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS"] : ["IDENTIFY", "FLAGS"];
  const open = windows
    ? ["OPEN", "IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS", "FLAGS"]
    : ["OPEN", ...read];
  const handles = { PARENT: "31", HOLDER: "37", CONTENDER: "39" };
  const fact = (operation, actor = "HOLDER", changes = {}) => ({
    operation,
    returnValue:
      operation === "OPEN" ? handles[actor] : operation === "FLAGS" ? "1" : windows ? "1" : "0",
    errorCode: "0",
    identity: operation === "OPEN" ? null : leaf,
    nativeHandle: operation === "CLOSE" ? null : handles[actor],
    nonInheritable: operation === "OPEN" ? null : true,
    ...changes,
  });
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
      for (let i = 0; i < (windows ? 2 : 1); i++)
        call("PARENT", "IDENTIFY", { identity: root, nativeHandle: "41", nonInheritable: null });
      call("PARENT", "CLOSE", { identity: root, nonInheritable: null });
      for (const operation of read) call("PARENT", operation);
      emit("PARENT", "CUSTODY", {
        rootIdentity: root,
        leafIdentity: leaf,
        regularFile: true,
        linkCount: "1",
        size: "1",
      });
    }
    function ready(actor) {
      barrier();
      command(actor, "READY");
      for (const [i, operation] of open.entries())
        call(actor, operation, { nonInheritable: i === open.length - 1 ? true : null });
    }
    function lock(actor, contended = false) {
      // Foreign-OS fixtures are structurally complete synthetic inputs only;
      // reducer refuses their adapter before interpreting any numeric code.
      const code = windows
        ? "33"
        : operatingSystem === localOS
          ? String(constants.errno.EWOULDBLOCK)
          : "999999";
      call(
        actor,
        "TRY_LOCK",
        contended ? { returnValue: windows ? "0" : "-1", errorCode: code } : {},
      );
    }
    function terminal(actor, forced = false) {
      const data = { exitCode: forced ? null : "0", signal: forced ? "SIGKILL" : null };
      emit(actor, "EXIT", data);
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
      for (const operation of read) call("HOLDER", operation);
      emit("HOLDER", "INSPECTION", {
        nativeHandle: handles.HOLDER,
        identity: leaf,
        nonInheritable: true,
        errorCode: "0",
      });
      command("DEFAULT_CHILD", "READY");
      const errorCode = windows
        ? "6"
        : operatingSystem === localOS
          ? String(constants.errno.EBADF)
          : "999999";
      call("DEFAULT_CHILD", "IDENTIFY", {
        returnValue: windows ? "0" : "-1",
        errorCode,
        identity: null,
        nativeHandle: null,
        nonInheritable: null,
      });
      emit("DEFAULT_CHILD", "INSPECTION", {
        nativeHandle: handles.HOLDER,
        identity: null,
        nonInheritable: null,
        errorCode,
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
    operatingSystem,
    rootIdentity: root,
    leafIdentity: leaf,
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
const is = (actor, kind, operation) => (event) =>
  event.actor === actor &&
  event.kind === kind &&
  (!operation || event.data.operation === operation);
function mutate(index, change) {
  const input = fixture();
  change(input.cases[index].events, input);
  return reduceCaseTranscripts(renumber(input));
}
function rowResult(output, index) {
  return output.cases[index].transcriptResult;
}

test("four complete local transcripts pass the private guard but cannot become experiment evidence", () => {
  const output = reduceCaseTranscripts(fixture());
  assert.equal(output.transcriptResult, "OBSERVED");
  assert.deepEqual(output.failures, []);
  assert.deepEqual(
    output.cases.map((row) => row.caseId),
    caseIds,
  );
  assert.equal(output.result, "UNKNOWN");
  assert.equal(output.missingPrerequisites.length, 5);
  assert.ok(Object.isFrozen(output.cases));
});

for (const operatingSystem of ["LINUX", "MACOS", "WINDOWS"]) {
  test(`${operatingSystem} complete and negative fixtures never bypass the explicit OS adapter boundary`, () => {
    const input = fixture(operatingSystem);
    assert.equal(
      reduceCaseTranscripts(input).transcriptResult,
      operatingSystem === localOS ? "OBSERVED" : "UNKNOWN",
    );
    input.cases[3].events = input.cases[3].events.filter((e) => !is("HOLDER", "CLOSE")(e));
    assert.equal(reduceCaseTranscripts(renumber(input)).transcriptResult, "UNKNOWN");
  });
}

test("submitted OBSERVED, refused flags and fabricated prerequisite booleans grant nothing", () => {
  const input = fixture();
  for (const row of input.cases) row.result = "UNKNOWN";
  assert.equal(reduceCaseTranscripts(input).transcriptResult, "OBSERVED");
  assert.equal(reduceCaseTranscripts(input).result, "UNKNOWN");
  for (const extra of [
    { retainedBytesVerified: true },
    { controls: [{ refused: true }] },
    { providerVerified: true },
  ]) {
    assert.equal(reduceCaseTranscripts({ ...input, ...extra }).transcriptResult, "UNKNOWN");
  }
  for (const row of input.cases) {
    row.result = "OBSERVED";
    row.events = [];
  }
  assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNKNOWN");
});

test("missing, duplicate, extra and reordered case/event census refuses", () => {
  for (const change of [
    (input) => input.cases.pop(),
    (input) => input.cases.push(input.cases[0]),
    (input) => (input.cases[1] = input.cases[0]),
    (input) => input.cases.reverse(),
    (input) => (input.cases[0].events[1].sequence = "00"),
    (input) => (input.cases[0].events[1].sequence = "0"),
    (input) => (input.cases[0].events[0].data.candidateVerdict = "PASS"),
    (input) => (input.cases[0].events[0].pid = "123"),
  ]) {
    const input = fixture();
    change(input);
    assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNKNOWN");
  }
});

test("missing fresh custody, changed root/leaf/handle and bypassed HELD refuse", () => {
  const noBarrier = mutate(0, (events) =>
    events.splice(0, events.findIndex(is("HOLDER", "COMMAND"))),
  );
  assert.equal(rowResult(noBarrier, 0), "UNKNOWN");
  for (const change of [
    (events, input) => {
      events.find(is("PARENT", "CUSTODY")).data.rootIdentity = input.leafIdentity;
      for (const e of events.slice(1, process.platform === "win32" ? 4 : 3))
        e.data.identity = input.leafIdentity;
    },
    (events, input) =>
      (events.find(is("HOLDER", "CALL", "TRY_LOCK")).data.identity = input.rootIdentity),
    (events) => (events.find(is("PARENT", "CALL", "TRY_LOCK")).data.nativeHandle = "77"),
    (events) =>
      Object.assign(events.find(is("PARENT", "CALL", "TRY_LOCK")).data, {
        errorCode: "0",
        returnValue: process.platform === "win32" ? "1" : "0",
      }),
  ])
    assert.equal(rowResult(mutate(0, change), 0), "VIOLATED");
});

test("normal release must precede live-holder witness acquisition, and retained lock is violated", () => {
  assert.equal(
    rowResult(
      mutate(1, (events) => {
        const lock = events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1];
        Object.assign(lock.data, {
          returnValue: process.platform === "win32" ? "0" : "-1",
          errorCode: process.platform === "win32" ? "33" : String(constants.errno.EWOULDBLOCK),
        });
      }),
      1,
    ),
    "VIOLATED",
  );
  assert.equal(
    rowResult(
      mutate(1, (events) => {
        const terminal = events.splice(events.findIndex(is("HOLDER", "EXIT")), 2);
        events.splice(events.findIndex(is("HOLDER", "COMMAND")) + 1, 0, ...terminal);
      }),
      1,
    ),
    "UNKNOWN",
  );
});

test("default child stays live through challenge and cannot open the fixed file or forge inspection", () => {
  for (const change of [
    (events) => {
      const terminal = events.splice(events.findIndex(is("DEFAULT_CHILD", "EXIT")), 2);
      events.splice(events.findIndex(is("DEFAULT_CHILD", "INSPECTION")) + 1, 0, ...terminal);
    },
    (events) => (events.find(is("DEFAULT_CHILD", "CALL")).data.operation = "OPEN"),
    (events, input) =>
      (events.find(is("DEFAULT_CHILD", "INSPECTION")).data.identity = input.leafIdentity),
    (events) => (events.find(is("HOLDER", "INSPECTION")).data.nonInheritable = false),
  ])
    assert.equal(rowResult(mutate(2, change), 2), "UNKNOWN");
});

test("derived child inspection distinguishes a different native identity from inherited same-file access", () => {
  for (const inherited of [false, true]) {
    const output = mutate(2, (events, input) => {
      const inspector = events.findIndex(is("DEFAULT_CHILD", "CALL"));
      const holderInspection = events.findIndex(is("HOLDER", "INSPECTION"));
      const count = process.platform === "win32" ? 4 : 2;
      const identity = inherited ? input.leafIdentity : input.rootIdentity;
      const facts = structuredClone(events.slice(holderInspection - count, holderInspection));
      for (const e of facts) {
        e.actor = "DEFAULT_CHILD";
        e.data.identity = identity;
      }
      events.splice(inspector, 1, ...facts);
      Object.assign(events.find(is("DEFAULT_CHILD", "INSPECTION")).data, {
        identity,
        nonInheritable: true,
        errorCode: "0",
      });
    });
    assert.equal(rowResult(output, 2), inherited ? "VIOLATED" : "OBSERVED");
  }
});

test("death requires accepted termination, exact exit then close and immediately one attempt", () => {
  for (const change of [
    (events) => events.splice(events.findIndex(is("HOLDER", "EXIT")), 1),
    (events) => events.splice(events.findIndex(is("HOLDER", "CLOSE")), 1),
    (events) => (events.find(is("HOLDER", "TERMINATION")).data.accepted = false),
    (events) =>
      events
        .filter((e) => is("HOLDER", "EXIT")(e) || is("HOLDER", "CLOSE")(e))
        .forEach((e) => Object.assign(e.data, { exitCode: "0", signal: null })),
    (events) => {
      const at = events.findIndex(is("HOLDER", "CLOSE"));
      [events[at], events[at + 1]] = [events[at + 1], events[at]];
    },
    (events) => {
      const at = events.findIndex(is("HOLDER", "CLOSE")) + 1;
      events.splice(at + 1, 0, structuredClone(events[at]));
    },
    (events) => {
      const at = events.findIndex(is("HOLDER", "CLOSE")) + 1;
      events.splice(at, 0, structuredClone(events.find(is("PARENT", "CUSTODY"))));
    },
    (events) =>
      events.splice(events.findIndex(is("HOLDER", "TERMINATION")), 0, {
        actor: "HOLDER",
        kind: "COMMAND",
        data: { name: "RELEASE" },
      }),
  ])
    assert.equal(rowResult(mutate(3, change), 3), "UNKNOWN");
});

test("native contention after death is VIOLATED; unsupported and unknown errors are never exclusion", () => {
  const windows = process.platform === "win32";
  for (const [errorCode, expected] of [
    [windows ? "33" : String(constants.errno.EWOULDBLOCK), "VIOLATED"],
    [windows ? "5" : String(constants.errno.EACCES), "UNSUPPORTED"],
    [windows ? "50" : String(constants.errno.ENOSYS), "UNSUPPORTED"],
    [windows ? "997" : String(constants.errno.EINTR), "UNKNOWN"],
    [windows ? "183" : String(constants.errno.EEXIST), "UNKNOWN"],
    ["999999", "UNKNOWN"],
  ]) {
    const output = mutate(3, (events) =>
      Object.assign(events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1].data, {
        errorCode,
        returnValue: windows ? "0" : "-1",
      }),
    );
    assert.equal(rowResult(output, 3), expected);
    assert.equal(output.result, "UNKNOWN");
    const stopped = mutate(3, (events) => {
      Object.assign(events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1].data, {
        errorCode,
        returnValue: windows ? "0" : "-1",
      });
      events.splice(events.findIndex(is("PARENT", "CALL", "UNLOCK")));
    });
    assert.equal(rowResult(stopped, 3), expected);
    const missingCustody = mutate(3, (events) => {
      const index = events.findIndex(is("HOLDER", "CLOSE")) + 1;
      Object.assign(events[index].data, { errorCode, returnValue: windows ? "0" : "-1" });
      events.splice(index + 1);
    });
    assert.equal(rowResult(missingCustody, 3), "UNKNOWN");
  }
});

test("a native unsupported prefix propagates only to unexecuted rows, never from submitted results", () => {
  const input = fixture();
  const events = input.cases[0].events;
  const index = events.findIndex(is("HOLDER", "CALL", "TRY_LOCK"));
  Object.assign(events[index].data, {
    errorCode: process.platform === "win32" ? "5" : String(constants.errno.EACCES),
    returnValue: process.platform === "win32" ? "0" : "-1",
  });
  events.splice(index + 1);
  for (const row of input.cases.slice(1)) row.events = [];
  assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNSUPPORTED");
  input.cases[0].events = [];
  for (const row of input.cases) row.result = "UNSUPPORTED";
  assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNKNOWN");
});

test("watchdog/structural failures preserve already visible violations and apply UNKNOWN precedence", () => {
  const output = mutate(3, (events, input) => {
    events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1].data.identity = input.rootIdentity;
    events.push({
      actor: "PARENT",
      kind: "WATCHDOG",
      data: { limitMilliseconds: "10000", elapsedNanoseconds: "10000000000" },
    });
  });
  assert.equal(rowResult(output, 3), "UNKNOWN");
  assert.ok(output.cases[3].failures.some((failure) => failure.result === "VIOLATED"));
  for (const order of [
    ["OBSERVED", "UNSUPPORTED", "VIOLATED", "UNKNOWN"],
    ["UNKNOWN", "VIOLATED", "UNSUPPORTED", "OBSERVED"],
  ])
    assert.equal(reduceResults(order), "UNKNOWN");
  assert.equal(reduceResults(["UNSUPPORTED", "VIOLATED"]), "VIOLATED");
  assert.equal(reduceResults(["UNSUPPORTED", "OBSERVED"]), "UNSUPPORTED");
  assert.equal(reduceResults(["PASS"]), "UNKNOWN");
});

test("ordinary malformed suffixes retain earlier death contention and add structural UNKNOWN", () => {
  for (const corrupt of [
    (events) =>
      events.push({
        actor: "PARENT",
        kind: "WATCHDOG",
        data: { limitMilliseconds: "10000", elapsedNanoseconds: "10000000000" },
        extra: true,
      }),
    (events) =>
      events.push({
        actor: "PARENT",
        kind: "WATCHDOG",
        data: { limitMilliseconds: "10000", elapsedNanoseconds: "10000000000", extra: true },
      }),
    (events) => {
      events.at(-1).extra = true;
    },
    (events) => {
      events.at(-1).data.extra = true;
    },
    (events) => {
      events.at(-1).sequence = "00";
    },
    (events) => {
      events.at(-1).sequence = events.at(-2).sequence;
    },
  ]) {
    const input = fixture();
    const events = input.cases[3].events;
    Object.assign(events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1].data, {
      returnValue: process.platform === "win32" ? "0" : "-1",
      errorCode: process.platform === "win32" ? "33" : String(constants.errno.EWOULDBLOCK),
    });
    // Only newly appended events need numbering; leave sequence mutants intact.
    const priorLength = events.length;
    corrupt(events);
    if (events.length > priorLength)
      events.at(-1).sequence = String(BigInt(events.at(-2).sequence) + 1n);
    const output = reduceCaseTranscripts(input);
    assert.equal(rowResult(output, 3), "UNKNOWN");
    assert.equal(output.result, "UNKNOWN");
    assert.ok(
      output.cases[3].failures.some(
        (failure) =>
          failure.result === "VIOLATED" &&
          failure.reason === "PARENT:expected ACQUIRED, saw CONTENDED",
      ),
    );
    assert.ok(
      output.cases[3].failures.some(
        (failure) => failure.result === "UNKNOWN" && failure.reason === "malformed event boundary",
      ),
    );
  }
});

test("native claims after a malformed event or in later rows are not interpreted", () => {
  const input = fixture();
  const events = input.cases[3].events;
  const index = events.findIndex(is("HOLDER", "CLOSE")) + 1;
  events.splice(index, 0, {
    actor: "PARENT",
    kind: "WATCHDOG",
    data: { limitMilliseconds: "10000", elapsedNanoseconds: "10000000000" },
    extra: true,
  });
  Object.assign(events[index + 1].data, {
    returnValue: process.platform === "win32" ? "0" : "-1",
    errorCode: process.platform === "win32" ? "33" : String(constants.errno.EWOULDBLOCK),
  });
  const output = reduceCaseTranscripts(renumber(input));
  assert.equal(rowResult(output, 3), "UNKNOWN");
  assert.ok(!output.failures.some((failure) => failure.result === "VIOLATED"));

  const laterRows = fixture();
  laterRows.cases[0].events.at(-1).extra = true;
  Object.assign(laterRows.cases[1].events.filter(is("PARENT", "CALL", "TRY_LOCK"))[1].data, {
    returnValue: process.platform === "win32" ? "0" : "-1",
    errorCode: process.platform === "win32" ? "33" : String(constants.errno.EWOULDBLOCK),
  });
  const stopped = reduceCaseTranscripts(laterRows);
  assert.equal(stopped.transcriptResult, "UNKNOWN");
  assert.ok(!stopped.failures.some((failure) => failure.result === "VIOLATED"));
  for (const row of stopped.cases.slice(1)) {
    assert.equal(row.transcriptResult, "UNKNOWN");
    assert.ok(
      row.failures.some((failure) => failure.reason === "row beyond malformed transcript boundary"),
    );
  }
});

test("hostile input snapshot does not invoke accessors or proxy traps", () => {
  let invoked = false;
  const getter = Object.defineProperty({}, "cases", {
    enumerable: true,
    get() {
      invoked = true;
      return [];
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
  for (const input of [getter, proxy, null, [], { ...fixture(), cases: new Array(4) }])
    assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNKNOWN");
  for (const suffix of [getter, proxy]) {
    const input = fixture();
    input.cases[3].events.push(suffix);
    assert.equal(reduceCaseTranscripts(input).transcriptResult, "UNKNOWN");
  }
  assert.equal(invoked, false);
});

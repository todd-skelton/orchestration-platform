// Standalone protocol/guard tests. Synthetic facts below prove only refusal and
// invocation behavior. They are never native evidence or experiment controls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  candidateSession,
  parseCommand,
} from "../../probes/portable-primitives/experiment/session.mjs";
import {
  checkReference,
  fileGuard,
  loadNative,
  nodeLaunchOptions,
} from "../../probes/portable-primitives/experiment/io.mjs";
import {
  coordinatorPreconditions,
  stableFixtureFiles,
} from "../../probes/portable-primitives/experiment/fixture.mjs";
import {
  interfaceVersion,
  inspectionFromFacts,
  lockDisposition,
  openOperations,
  parseCustodyResult,
  parseFacts,
  readOperations,
  requireCustody,
  requireInspection,
} from "../../probes/portable-primitives/experiment/facts.mjs";

const windows = process.platform === "win32";
const id = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "1".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "11" };
const other = windows ? { ...id, fileIdHex: "2".repeat(32) } : { ...id, inode: "12" };
const success = windows ? "1" : "0";
function fact(operation, changes = {}) {
  return {
    operation,
    returnValue: operation === "OPEN" ? "37" : operation === "FLAGS" ? "1" : success,
    errorCode: "0",
    identity: operation === "OPEN" ? null : id,
    nativeHandle: operation === "CLOSE" ? null : "37",
    nonInheritable: operation === "OPEN" ? null : true,
    ...changes,
  };
}
const ready = (sequence = "0") => ({ sequence, name: "READY", configuration: {} });
const command = (sequence, name) => ({ sequence, name });
const openingFacts = () =>
  openOperations.map((operation, index) =>
    fact(operation, { nonInheritable: index === openOperations.length - 1 ? true : null }),
  );
function syntheticAddon(acquisition = fact("TRY_LOCK"), opening = openingFacts()) {
  const calls = [];
  const handle = Object.freeze({});
  const addon = Object.freeze({
    interfaceVersion,
    openFixedLock(path) {
      calls.push(["open", path]);
      return { handle, facts: opening };
    },
    tryLock(actual) {
      assert.equal(actual, handle);
      calls.push(["try"]);
      return [acquisition];
    },
    release(actual) {
      assert.equal(actual, handle);
      calls.push(["release"]);
      return [fact("UNLOCK")];
    },
    close(actual) {
      assert.equal(actual, handle);
      calls.push(["close"]);
      return [fact("CLOSE")];
    },
    describe() {
      assert.fail("no implicit describe or retry in the fixture protocol");
    },
  });
  return { calls, addon };
}

test("closed facts reject candidate verdicts, accessors, proxies, extras and noncanonical numbers", () => {
  let invoked = false;
  const getter = Object.defineProperty({}, "operation", {
    enumerable: true,
    get() {
      invoked = true;
      return "TRY_LOCK";
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
  for (const value of [
    [{ ...fact("TRY_LOCK"), result: "PASS" }],
    [getter],
    [proxy],
    [fact("RETRY")],
    [fact("TRY_LOCK", { errorCode: "01" })],
    [fact("TRY_LOCK", { returnValue: "-0" })],
    [fact("TRY_LOCK", { identity: { ...id, shortened: true } })],
    [fact("CLOSE", { nativeHandle: "37" })],
    [],
    new Array(1),
  ])
    assert.throws(() => parseFacts(value));
  assert.equal(invoked, false);
  assert.equal(parseFacts([fact("TRY_LOCK")])[0].operation, "TRY_LOCK");
});

test("operation-specific error interpretation cannot turn open errors or unknown codes into exclusion", () => {
  const failed = (errorCode) => [
    fact("TRY_LOCK", { returnValue: windows ? "0" : "-1", errorCode }),
  ];
  assert.equal(lockDisposition([fact("TRY_LOCK")]), "ACQUIRED");
  assert.equal(
    lockDisposition(failed(windows ? "33" : String(constants.errno.EWOULDBLOCK))),
    "CONTENDED",
  );
  assert.equal(
    lockDisposition(failed(windows ? "5" : String(constants.errno.EACCES))),
    "UNSUPPORTED",
  );
  for (const code of [
    "999999",
    windows ? "997" : String(constants.errno.EINTR),
    windows ? "183" : String(constants.errno.EEXIST),
  ])
    assert.equal(lockDisposition(failed(code)), "UNKNOWN");
  assert.throws(() => lockDisposition([fact("OPEN", { errorCode: "33" })]));
  assert.equal(lockDisposition([fact("TRY_LOCK", { returnValue: "19" })]), "UNKNOWN");
});

test("custody wrapper preserves null on successful metadata policy refusal and failed close", () => {
  const operations = windows
    ? ["OPEN", "IDENTIFY", "IDENTIFY", "CLOSE"]
    : ["OPEN", "IDENTIFY", "CLOSE"];
  const facts = operations.map((operation) => fact(operation, { nonInheritable: null }));
  assert.equal(parseCustodyResult({ identity: null, facts }).identity, null);
  assert.equal(parseCustodyResult({ identity: id, facts }).identity.kind, id.kind);
  const closingFailed = [
    ...facts.slice(0, -1),
    fact("CLOSE", { errorCode: "5", returnValue: windows ? "0" : "-1" }),
  ];
  assert.equal(parseCustodyResult({ identity: null, facts: closingFailed }).identity, null);
  assert.throws(() => parseCustodyResult({ identity: id, facts: closingFailed }));
  assert.throws(() => parseCustodyResult({ identity: null, facts: [fact("TRY_LOCK")] }));
  assert.throws(() => parseCustodyResult({ identity: other, facts }));
  // Successful native metadata carries its identity at that call, not merely
  // in the later CLOSE snapshot or the accepted outer wrapper.
  for (const [index, call] of facts.entries()) {
    if (call.operation !== "IDENTIFY") continue;
    const missing = facts.map((entry, i) => (i === index ? { ...entry, identity: null } : entry));
    assert.deepEqual(missing.at(-1).identity, id);
    assert.throws(() => parseCustodyResult({ identity: id, facts: missing }));
  }
  const custody = {
    rootIdentity: other,
    leafIdentity: id,
    regularFile: true,
    linkCount: "1",
    size: "1",
  };
  assert.equal(requireCustody(custody, other, id).regularFile, true);
  for (const changed of [
    { rootIdentity: null },
    { rootIdentity: id },
    { leafIdentity: other },
    { size: "2" },
    { linkCount: "2" },
  ])
    assert.throws(() => requireCustody({ ...custody, ...changed }, other, id));
});

test("stable inspection admits only invalid/different child identity and non-inheritable holder", () => {
  const facts = readOperations.map((operation) => fact(operation));
  const inspected = inspectionFromFacts(facts, "37");
  assert.equal(requireInspection(inspected, id).nonInheritable, true);
  assert.throws(() => requireInspection({ ...inspected, nonInheritable: false }, id));
  assert.throws(() => requireInspection(inspected, id, true));
  assert.equal(requireInspection({ ...inspected, identity: other }, id, true).errorCode, "0");
  const invalid = windows ? "6" : String(constants.errno.EBADF);
  const invalidFacts = [
    fact("IDENTIFY", {
      returnValue: windows ? "0" : "-1",
      errorCode: invalid,
      identity: null,
      nativeHandle: null,
      nonInheritable: null,
    }),
  ];
  const absent = inspectionFromFacts(invalidFacts, "37");
  assert.equal(absent.nativeHandle, "37");
  assert.equal(requireInspection(absent, id, true).identity, null);
  assert.throws(() => requireInspection(absent, id));
  assert.throws(() => inspectionFromFacts([fact("IDENTIFY", { errorCode: "99999" })], "37"));
  assert.throws(() => inspectionFromFacts(facts, "38"));
});

test("synthetic session performs only one fixed call per command and no automatic release", () => {
  const { addon, calls } = syntheticAddon();
  const session = candidateSession(addon, "/synthetic/native-lock", id);
  assert.equal(session.run(ready()).state, "OPEN");
  assert.equal(session.run(command("3", "ACQUIRE")).state, "LOCKED");
  assert.deepEqual(calls, [["open", "/synthetic/native-lock"], ["try"]]);
  assert.equal(session.run(command("9", "RELEASE")).state, "OPEN");
  assert.equal(session.run(command("12", "CLOSE")).state, "CLOSED");
  assert.deepEqual(
    calls.map(([name]) => name),
    ["open", "try", "release", "close"],
  );
  assert.throws(() => session.run(command("13", "CLOSE")));
});

test("READY refuses each missing post-OPEN identity before any acquisition", () => {
  const opening = openingFacts();
  assert.equal(opening[0].identity, null); // Legitimate native OPEN snapshot.
  for (let index = 1; index < opening.length; index++) {
    const missing = opening.map((entry, i) => (i === index ? { ...entry, identity: null } : entry));
    if (index < opening.length - 1) assert.deepEqual(missing.at(-1).identity, id);
    const { addon, calls } = syntheticAddon(undefined, missing);
    const session = candidateSession(addon, "/synthetic/native-lock", id);
    assert.throws(() => session.run(ready()));
    assert.equal(session.state, "FAILED");
    assert.throws(() => session.run(command("1", "ACQUIRE")));
    assert.deepEqual(calls, [["open", "/synthetic/native-lock"]]);
  }
});

test("duplicate, wrong-state and forged commands invoke no extra native operation", () => {
  for (const invalid of [
    command("0", "ACQUIRE"),
    command("1", "RELEASE"),
    { sequence: "1", name: "ACQUIRE", retry: true },
  ]) {
    const { addon, calls } = syntheticAddon();
    const session = candidateSession(addon, "/synthetic/native-lock", id);
    session.run(ready());
    assert.throws(() => session.run(invalid));
    assert.equal(calls.length, 1);
  }
  for (const name of ["ACQUIRE", "CLOSE"]) {
    const { addon, calls } = syntheticAddon();
    const session = candidateSession(addon, "/synthetic/native-lock", id);
    session.run(ready());
    session.run(command("1", "ACQUIRE"));
    assert.throws(() => session.run(command("2", name)));
    assert.equal(calls.length, 2);
  }
  for (const value of [
    { sequence: "01", name: "ACQUIRE" },
    { sequence: "1", name: "TERMINATE" },
    { sequence: "1", name: "CLOSE", path: "other" },
  ])
    assert.throws(() => parseCommand(value));
});

test("contention leaves OPEN but cannot be retried; an unknown failure ends the synthetic session", () => {
  for (const [errorCode, expected] of [
    [windows ? "33" : String(constants.errno.EWOULDBLOCK), "OPEN"],
    ["999999", "FAILED"],
  ]) {
    const { addon, calls } = syntheticAddon(
      fact("TRY_LOCK", { errorCode, returnValue: windows ? "0" : "-1" }),
    );
    const session = candidateSession(addon, "/synthetic/native-lock", id);
    session.run(ready());
    assert.equal(session.run(command("1", "ACQUIRE")).state, expected);
    assert.throws(() => session.run(command("2", "ACQUIRE")));
    assert.equal(calls.length, 2);
  }
});

test("module guards reject byte substitution and extra loadable outputs before native load", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "iss022-loader-guard-"));
  try {
    const directory = join(root, "builds", "STABLE_WITNESS");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "native-lock-witness.node");
    // Text guard input, deliberately not a native binary; never passed to require.
    writeFileSync(path, "synthetic retained guard input");
    const bytes = readFileSync(path);
    const reference = {
      path: "builds/STABLE_WITNESS/native-lock-witness.node",
      byteLength: String(bytes.length),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const guard = fileGuard();
    checkReference(guard, path, reference);
    assert.throws(() =>
      loadNative("STABLE_WITNESS", root, { ...reference, sha256: "0".repeat(64) }, guard),
    );
    writeFileSync(join(directory, "extra.node"), "another non-executable guard input");
    assert.throws(() => loadNative("STABLE_WITNESS", root, reference, guard));
    writeFileSync(path, "changed retained guard input");
    assert.throws(() => checkReference(guard, path, reference));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("launch options have the exact IPC/stdio boundary and no inherited injection variables", () => {
  const root = realpathSync(tmpdir());
  const options = nodeLaunchOptions(root, windows ? process.env.SystemRoot : null);
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe", "ipc"]);
  assert.equal(options.shell, false);
  assert.equal(options.detached, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(Object.keys(options).sort(), [
    "cwd",
    "detached",
    "env",
    "shell",
    "stdio",
    "windowsHide",
  ]);
  assert.deepEqual(
    Object.keys(options.env).sort(),
    [
      "LANG",
      "LC_ALL",
      "TEMP",
      "TMP",
      "TMPDIR",
      ...(windows ? ["SystemRoot", "WINDIR"] : []),
    ].sort(),
  );
  assert.ok(stableFixtureFiles.includes("packages/contracts/src/runtime.ts"));
  assert.ok(coordinatorPreconditions.some((text) => text.includes("HELD")));
});

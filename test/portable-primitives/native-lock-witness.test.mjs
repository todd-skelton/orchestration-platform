/* Standalone native unit tests, not the experiment's four-row observation run.
 * The serial verifier supplies a reviewed build and its independently retained
 * SHA-256. Missing/unverified native bytes fail; these tests never compile,
 * install, fall back to JS, or manufacture a PASS from missing prerequisites.
 *
 * ISS022_NATIVE_WITNESS_ADDON=<absolute .node path>
 * ISS022_NATIVE_WITNESS_SHA256=<64 lowercase hex digits>
 * node --test test/portable-primitives/native-lock-witness.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { constants as osConstants, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const self = fileURLToPath(import.meta.url);
const repository = resolve(dirname(self), "../..");
const addonPath = process.env.ISS022_NATIVE_WITNESS_ADDON;
const expectedDigest = process.env.ISS022_NATIVE_WITNESS_SHA256;
const unsigned = /^(0|[1-9][0-9]*)$/;
const signed = /^(0|-?[1-9][0-9]*)$/;
const success = windows ? "1" : "0";
const invalidNumber = windows ? "18446744073709551615" : "2147483647";
const invalidError = windows ? "6" : String(osConstants.errno.EBADF);
const openOperations = windows
  ? ["OPEN", "IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS", "FLAGS"]
  : ["OPEN", "IDENTIFY", "FLAGS"];
const readOperations = windows
  ? ["IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS"]
  : ["IDENTIFY", "FLAGS"];
const custodyOperations = windows
  ? ["OPEN", "IDENTIFY", "IDENTIFY", "CLOSE"]
  : ["OPEN", "IDENTIFY", "CLOSE"];

function inside(parent, child) {
  const suffix = relative(parent, child);
  return (
    suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
  );
}

function verifyAddon() {
  assert.equal(typeof addonPath, "string", "provide an explicit absolute witness addon path");
  assert.ok(isAbsolute(addonPath), "the addon path must be absolute");
  assert.equal(resolve(addonPath), addonPath, "the addon path must be normalized");
  assert.ok(addonPath.endsWith(".node"), "only a .node build is admitted");
  assert.match(
    expectedDigest ?? "",
    /^[a-f0-9]{64}$/,
    "provide the independently retained addon SHA-256",
  );
  assert.equal(realpathSync(addonPath), addonPath, "the addon or its parent may not be an alias");
  const before = lstatSync(addonPath, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.nlink, 1n);
  assert.ok(before.size > 0n);
  const descriptor = openSync(addonPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assert.ok(opened.isFile());
    assert.equal(opened.dev, before.dev);
    assert.equal(opened.ino, before.ino);
    assert.equal(opened.nlink, 1n);
    assert.equal(opened.size, before.size);
    bytes = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  assert.equal(BigInt(bytes.length), before.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedDigest);
  const after = lstatSync(addonPath, { bigint: true });
  for (const key of ["dev", "ino", "nlink", "size", "mtimeNs", "ctimeNs"]) {
    assert.equal(after[key], before[key], `addon ${key} changed during verification`);
  }
  return Object.fromEntries(
    ["dev", "ino", "nlink", "size", "mtimeNs", "ctimeNs"].map((key) => [key, before[key]]),
  );
}

function loadWitness() {
  assert.match(process.versions.node, /^24\./, "this bounded experiment requires Node 24");
  assert.ok(Number(process.versions.napi) >= 8);
  const before = verifyAddon();
  const addon = createRequire(import.meta.url)(addonPath);
  assert.deepEqual(verifyAddon(), before, "native input changed across absolute-path loading");
  return { addon, before };
}

function assertIdentity(identity, path) {
  assert.ok(identity && typeof identity === "object");
  if (windows) {
    assert.deepEqual(Object.keys(identity), ["kind", "volumeSerialNumber", "fileIdHex"]);
    assert.equal(identity.kind, "WINDOWS");
    assert.match(identity.volumeSerialNumber, unsigned);
    assert.match(identity.fileIdHex, /^[a-f0-9]{32}$/);
    // Node's stat does not supply FILE_ID_INFO's complete 16-byte identity.
  } else {
    assert.deepEqual(Object.keys(identity), ["kind", "device", "inode"]);
    assert.equal(identity.kind, "POSIX");
    assert.match(identity.device, unsigned);
    assert.match(identity.inode, unsigned);
    if (path) {
      const expected = statSync(path, { bigint: true });
      assert.equal(identity.device, String(expected.dev));
      assert.equal(identity.inode, String(expected.ino));
    }
  }
}

function assertFacts(facts, operations) {
  assert.ok(Array.isArray(facts));
  assert.ok(facts.length > 0);
  if (operations)
    assert.deepEqual(
      facts.map((fact) => fact.operation),
      operations,
    );
  for (const fact of facts) {
    assert.deepEqual(Object.keys(fact), [
      "operation",
      "returnValue",
      "errorCode",
      "identity",
      "nativeHandle",
      "nonInheritable",
    ]);
    assert.ok(
      ["OPEN", "IDENTIFY", "FLAGS", "TRY_LOCK", "UNLOCK", "CLOSE", "DESCRIBE"].includes(
        fact.operation,
      ),
    );
    assert.match(fact.returnValue, signed);
    assert.match(fact.errorCode, unsigned);
    if (fact.identity !== null) assertIdentity(fact.identity);
    if (fact.nativeHandle !== null) assert.match(fact.nativeHandle, unsigned);
    assert.ok(fact.nonInheritable === null || typeof fact.nonInheritable === "boolean");
    if (fact.operation === "CLOSE") assert.equal(fact.nativeHandle, null);
  }
}

function assertSuccess(facts, operations) {
  assertFacts(facts, operations);
  for (const fact of facts) {
    assert.equal(fact.errorCode, "0");
    if (fact.operation !== "OPEN" && fact.operation !== "FLAGS")
      assert.equal(fact.returnValue, success);
  }
}

function assertOpen(addon, path) {
  const opened = addon.openFixedLock(path);
  assert.deepEqual(Object.keys(opened), ["handle", "facts"]);
  assert.equal(typeof opened.handle, "object");
  assert.notEqual(opened.handle, null);
  assert.ok(Object.isFrozen(opened.handle));
  assertSuccess(opened.facts, openOperations);
  assert.equal(opened.facts[0].identity, null);
  assert.equal(opened.facts[0].nonInheritable, null);
  assert.equal(opened.facts[0].returnValue, opened.facts[0].nativeHandle);
  assert.equal(opened.facts.at(-1).nonInheritable, true);
  assertIdentity(opened.facts.at(-1).identity, path);
  return opened;
}

function childEnvironment() {
  const result = {};
  // No NODE_OPTIONS, NODE_PATH, preload, custom loader, or compiler inputs.
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"]) {
    if (process.env[name] !== undefined) result[name] = process.env[name];
  }
  result.ISS022_NATIVE_WITNESS_ADDON = addonPath;
  result.ISS022_NATIVE_WITNESS_SHA256 = expectedDigest;
  return result;
}

function runChild(name, path) {
  const result = spawnSync(
    process.execPath,
    [self, "--witness-case", name, ...(path ? [path] : [])],
    {
      cwd: tmpdir(),
      env: childEnvironment(),
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `completed ${name}\n`);
}

function withFixture(callback) {
  const temporary = realpathSync(tmpdir());
  assert.ok(!inside(repository, temporary), "runtime state must stay outside the checkout");
  const root = mkdtempSync(join(temporary, "iss022-witness-unit-"));
  const fixed = join(root, "native-lock");
  try {
    writeFileSync(fixed, Buffer.from([0x41]), { flag: "wx", mode: 0o600 });
    callback({ root, fixed });
  } finally {
    assert.ok(inside(temporary, root) && root !== temporary);
    rmSync(root, { recursive: true });
    assert.throws(() => lstatSync(root), { code: "ENOENT" });
  }
}

const cases = {
  interface(addon) {
    assert.deepEqual(
      Object.keys(addon).sort(),
      [
        "interfaceVersion",
        "openFixedLock",
        "tryLock",
        "release",
        "close",
        "describe",
        "inspectNativeHandle",
        "describeCustody",
      ].sort(),
    );
    assert.equal(addon.interfaceVersion, "iss022-native-lock-experiment/v1");
    assert.ok(Object.isFrozen(addon));
    assert.throws(() => addon.describeCustody(), TypeError);
    assert.throws(() => addon.describeCustody("ignored"), TypeError);
    for (const name of ["tryLock", "release", "close", "describe"]) {
      for (const value of [undefined, null, 0, "0", {}, [], new Proxy({}, {})]) {
        assert.throws(() => addon[name](value), TypeError);
      }
      assert.throws(() => addon[name](), TypeError);
      assert.throws(() => addon[name]({}, "extra"), TypeError);
    }
    const badNumbers = [
      undefined,
      null,
      0,
      1n,
      {},
      [],
      "",
      "-1",
      "+1",
      " 1",
      "1 ",
      "01",
      "1.0",
      "1e2",
      "1\0",
      "１２",
      "18446744073709551616",
    ];
    for (const value of badNumbers)
      assert.throws(() => addon.inspectNativeHandle(value), TypeError);
    assert.throws(() => addon.inspectNativeHandle(), TypeError);
    assert.throws(() => addon.inspectNativeHandle("0", "extra"), TypeError);
    const invalid = addon.inspectNativeHandle(invalidNumber);
    assertFacts(invalid, ["IDENTIFY"]);
    assert.equal(invalid[0].errorCode, invalidError);
    assert.equal(invalid[0].returnValue, windows ? "0" : "-1");
    assert.equal(invalid[0].identity, null);
    assert.equal(invalid[0].nativeHandle, null);
    assert.equal(invalid[0].nonInheritable, null);
    // Invalid calls and the pre-open inspector must not consume the binding.
    withFixture(({ fixed }) => {
      let coerced = false;
      const badPath = {
        [Symbol.toPrimitive]() {
          coerced = true;
          return fixed;
        },
      };
      for (const value of [
        badPath,
        null,
        1,
        {},
        "",
        "native-lock",
        "../native-lock",
        `${fixed}\0`,
        "\ud800",
      ]) {
        assert.throws(() => addon.openFixedLock(value), TypeError);
      }
      if (windows) {
        for (const value of ["C:native-lock", "\\native-lock", `${fixed}:stream`]) {
          assert.throws(() => addon.openFixedLock(value), TypeError);
        }
      }
      assert.throws(() => addon.openFixedLock(), TypeError);
      assert.throws(() => addon.openFixedLock(fixed, "extra"), TypeError);
      assert.equal(coerced, false);
      const { handle } = assertOpen(addon, fixed);
      assertSuccess(addon.close(handle), ["CLOSE"]);
    });
  },

  cache_reload(addon) {
    withFixture(({ root, fixed }) => {
      const { handle } = assertOpen(addon, fixed);
      const require = createRequire(import.meta.url);
      delete require.cache[addonPath];
      assert.throws(() => require(addonPath), TypeError);
      assert.throws(() => addon.openFixedLock(join(root, "other")), TypeError);
      assertSuccess(addon.describe(handle), readOperations);
      assertSuccess(addon.close(handle), ["CLOSE"]);
      assert.throws(() => addon.describe(handle), TypeError);
      delete require.cache[addonPath];
      assert.throws(() => require(addonPath), TypeError);
    });
  },

  prototype_setters(addon) {
    withFixture(({ fixed }) => {
      let invoked = false;
      const names = ["operation", "nativeHandle", "handle", "facts", "identity"];
      for (const name of names) {
        assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, name), undefined);
        Object.defineProperty(Object.prototype, name, {
          configurable: true,
          set() {
            invoked = true;
            addon.inspectNativeHandle(invalidNumber);
          },
        });
      }
      let opened;
      try {
        opened = addon.openFixedLock(fixed);
      } finally {
        for (const name of names) delete Object.prototype[name];
      }
      assert.equal(invoked, false, "result construction must not invoke inherited JS setters");
      assertSuccess(opened.facts, openOperations);
      assert.notEqual(opened.handle, null);
      assertSuccess(addon.close(opened.handle), ["CLOSE"]);
    });
  },

  lifecycle(addon) {
    withFixture(({ root, fixed }) => {
      const { handle, facts } = assertOpen(addon, fixed);
      const nativeHandle = facts.at(-1).nativeHandle;
      const identity = facts.at(-1).identity;
      assert.throws(() => addon.openFixedLock(fixed), TypeError);
      assert.throws(() => addon.openFixedLock(join(root, "other")), TypeError);
      const counterfeits = [
        { ...handle },
        Object.create(handle),
        new Proxy(handle, {}),
        nativeHandle,
      ];
      for (const counterfeit of counterfeits) {
        for (const name of ["tryLock", "release", "close", "describe"]) {
          assert.throws(() => addon[name](counterfeit), TypeError);
        }
      }
      for (const name of ["tryLock", "release", "close", "describe"]) {
        assert.throws(() => addon[name](), TypeError);
        assert.throws(() => addon[name](handle, "extra"), TypeError);
      }
      assert.throws(() => addon.release(handle), TypeError);
      const inspected = addon.inspectNativeHandle(nativeHandle);
      assertSuccess(inspected, readOperations);
      assert.deepEqual(inspected.at(-1).identity, identity);
      assert.equal(inspected.at(-1).nonInheritable, true);
      const custody = addon.describeCustody();
      assert.deepEqual(Object.keys(custody), ["identity", "facts"]);
      assertSuccess(custody.facts, custodyOperations);
      const parentIdentity = custody.identity;
      assertIdentity(parentIdentity, root);
      assert.notDeepEqual(parentIdentity, identity);
      assert.throws(() => addon.describeCustody(fixed), TypeError);
      assertSuccess(addon.tryLock(handle), ["TRY_LOCK"]);
      assert.throws(() => addon.tryLock(handle), TypeError);
      assert.throws(() => addon.close(handle), TypeError);
      assertSuccess(addon.describe(handle), readOperations);
      assertSuccess(addon.inspectNativeHandle(nativeHandle), readOperations);
      // Another native open challenges that read-only inspection did not unlock.
      runChild("contender", fixed);
      assertSuccess(addon.release(handle), ["UNLOCK"]);
      assert.throws(() => addon.release(handle), TypeError);
      runChild("acquirer", fixed);
      const closing = addon.close(handle);
      assertSuccess(closing, ["CLOSE"]);
      assert.deepEqual(closing[0].identity, identity);
      // Inspect immediately: no filesystem call can recycle the closed number.
      const stale = addon.inspectNativeHandle(nativeHandle);
      assertFacts(stale, ["IDENTIFY"]);
      assert.equal(stale[0].errorCode, invalidError);
      assert.equal(stale[0].nativeHandle, null);
      for (const name of ["tryLock", "release", "close", "describe"]) {
        assert.throws(() => addon[name](handle), TypeError);
      }
      assert.throws(() => addon.openFixedLock(fixed), TypeError);
      const afterClose = addon.describeCustody();
      assertSuccess(afterClose.facts, custodyOperations);
      assert.deepEqual(afterClose.identity, parentIdentity);
      assert.deepEqual(readFileSync(fixed), Buffer.from([0x41]));
    });
  },

  custody_parent_alias(addon) {
    withFixture(({ root }) => {
      const parent = join(root, "bound-parent");
      const moved = join(root, "moved-parent");
      mkdirSync(parent);
      const fixed = join(parent, "native-lock");
      writeFileSync(fixed, Buffer.from([0x41]), { flag: "wx" });
      const { handle } = assertOpen(addon, fixed);
      const initial = addon.describeCustody();
      assert.deepEqual(Object.keys(initial), ["identity", "facts"]);
      assertSuccess(initial.facts, custodyOperations);
      assertIdentity(initial.identity, parent);
      assertSuccess(addon.close(handle), ["CLOSE"]);
      // A local negative unit fixture, never a mutation during the four-row run.
      // Close first so Windows file sharing does not itself block the rename.
      renameSync(parent, moved);
      symlinkSync(moved, parent, windows ? "junction" : "dir");
      const refused = addon.describeCustody();
      assert.deepEqual(Object.keys(refused), ["identity", "facts"]);
      assert.equal(refused.identity, null, "an alias must not expose accepted custody");
      assertFacts(refused.facts);
      if (windows) {
        // OPEN_REPARSE_POINT permits native metadata success on the junction.
        // Only the wrapper represents the policy refusal; no invented errno.
        assertSuccess(refused.facts, custodyOperations);
        assertIdentity(refused.facts.at(-1).identity);
      } else {
        assert.deepEqual(
          refused.facts.map((fact) => fact.operation),
          ["OPEN"],
        );
        assert.notEqual(refused.facts[0].errorCode, "0");
      }
    });
  },

  changed_size(addon) {
    withFixture(({ fixed }) => {
      const { handle } = assertOpen(addon, fixed);
      writeFileSync(fixed, Buffer.from([0x41, 0x42]));
      const facts = addon.describe(handle);
      assertFacts(facts, windows ? ["IDENTIFY", "IDENTIFY"] : ["IDENTIFY"]);
      assert.ok(facts.every((fact) => fact.errorCode === "0"));
      assertSuccess(addon.close(handle), ["CLOSE"]);
    });
  },
};

for (const malformed of [
  "empty",
  "long",
  "hardlink",
  "directory",
  "missing",
  ...(!windows ? ["symlink"] : []),
]) {
  cases[`refuse_${malformed}`] = (addon) =>
    withFixture(({ root, fixed }) => {
      let target = fixed;
      if (malformed === "empty") writeFileSync(fixed, Buffer.alloc(0));
      if (malformed === "long") writeFileSync(fixed, Buffer.from([0x41, 0x42]));
      if (malformed === "hardlink") linkSync(fixed, join(root, "second-link"));
      if (malformed === "directory") {
        target = join(root, "directory");
        mkdirSync(target);
      }
      if (malformed === "missing") target = join(root, "absent");
      if (malformed === "symlink") {
        target = join(root, "symbolic-link");
        symlinkSync(fixed, target);
      }
      const result = addon.openFixedLock(target);
      assert.deepEqual(Object.keys(result), ["handle", "facts"]);
      assert.equal(result.handle, null, `must not publish ${malformed} as a fixed file`);
      assertFacts(result.facts);
      assert.equal(result.facts[0].operation, "OPEN");
      if (result.facts[0].errorCode === "0") {
        assert.equal(result.facts.at(-1).operation, "CLOSE");
        assert.equal(result.facts.at(-1).errorCode, "0");
        assert.equal(result.facts.at(-1).nativeHandle, null);
        assert.ok(!result.facts.some((fact) => fact.operation === "FLAGS"));
      } else {
        assert.equal(result.facts.length, 1);
        assert.equal(result.facts[0].nativeHandle, null);
      }
      assert.throws(() => addon.openFixedLock(fixed), TypeError);
      assert.throws(() => addon.openFixedLock(target), TypeError);
      assert.throws(() => addon.describeCustody(), TypeError);
    });
}

if (process.argv[2] === "--witness-case") {
  const name = process.argv[3];
  const { addon, before } = loadWitness();
  if (name === "contender" || name === "acquirer") {
    const fixed = process.argv[4];
    assert.ok(isAbsolute(fixed));
    assert.ok(inside(realpathSync(tmpdir()), fixed) && !inside(repository, fixed));
    const { handle } = assertOpen(addon, fixed);
    const facts = addon.tryLock(handle);
    assertFacts(facts, ["TRY_LOCK"]);
    if (name === "contender") {
      const contentionErrors = windows
        ? ["33"]
        : [...new Set([osConstants.errno.EWOULDBLOCK, osConstants.errno.EAGAIN])].map(String);
      assert.ok(contentionErrors.includes(facts[0].errorCode), JSON.stringify(facts));
      assert.equal(facts[0].returnValue, windows ? "0" : "-1");
    } else {
      assertSuccess(facts, ["TRY_LOCK"]);
      assertSuccess(addon.release(handle), ["UNLOCK"]);
    }
    assertSuccess(addon.close(handle), ["CLOSE"]);
  } else {
    assert.equal(typeof cases[name], "function", "unknown native unit case");
    cases[name](addon);
  }
  assert.deepEqual(verifyAddon(), before, "addon changed during native unit case");
  process.stdout.write(`completed ${name}\n`);
} else {
  // Validate once before dispatch, then each fresh environment validates again.
  verifyAddon();
  for (const name of Object.keys(cases)) {
    test(`stable native witness: ${name}`, { concurrency: false, timeout: 30_000 }, () =>
      runChild(name),
    );
  }
}

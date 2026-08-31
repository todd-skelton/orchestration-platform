// Standalone source-contract checks, not the stable experiment or certification.
// Host invocation: ISS022_CANDIDATE_ADDON_PATH=<verified absolute .node> node --test <this file>
// Or: node <this file> <verified absolute .node>. No build, lookup fallback or skip.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import test from "node:test";

const here = fileURLToPath(import.meta.url);
const sourceRoot = resolve(dirname(here), "../..");
const windows = process.platform === "win32";
const functions = ["openFixedLock", "tryLock", "release", "close", "describe"];
const openOperations = windows
  ? ["OPEN", "IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS", "FLAGS"]
  : ["OPEN", "IDENTIFY", "FLAGS"];
const describeOperations = windows
  ? ["IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS"]
  : ["IDENTIFY", "FLAGS"];
const decimal = /^(0|[1-9][0-9]*)$/;
const signedDecimal = /^(0|-?[1-9][0-9]*)$/;

function outside(root, path) {
  const suffix = relative(root, path);
  return suffix === ".." || suffix.startsWith(".." + sep) || isAbsolute(suffix);
}

function checkedAddon(path) {
  assert.equal(typeof path, "string", "Host must provide the verified built addon path");
  assert.ok(isAbsolute(path), "Addon path must be absolute");
  assert.equal(extname(path), ".node");
  const metadata = lstatSync(path, { bigint: true });
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.nlink, 1n);
  assert.ok(metadata.size > 0n);
  assert.equal(realpathSync(path), path, "Addon path must have resolved ancestors");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function identity(value) {
  assert.ok(value && typeof value === "object");
  if (windows) {
    assert.deepEqual(Object.keys(value), ["kind", "volumeSerialNumber", "fileIdHex"]);
    assert.equal(value.kind, "WINDOWS");
    assert.match(value.volumeSerialNumber, decimal);
    assert.match(value.fileIdHex, /^[0-9a-f]{32}$/);
  } else {
    assert.deepEqual(Object.keys(value), ["kind", "device", "inode"]);
    assert.equal(value.kind, "POSIX");
    assert.match(value.device, decimal);
    assert.match(value.inode, decimal);
  }
}

function facts(records, operations) {
  assert.ok(Array.isArray(records));
  if (operations)
    assert.deepEqual(
      records.map((record) => record.operation),
      operations,
    );
  for (const record of records) {
    assert.deepEqual(Reflect.ownKeys(record), [
      "operation",
      "returnValue",
      "errorCode",
      "identity",
      "nativeHandle",
      "nonInheritable",
    ]);
    assert.ok(
      ["OPEN", "IDENTIFY", "FLAGS", "TRY_LOCK", "UNLOCK", "CLOSE", "DESCRIBE"].includes(
        record.operation,
      ),
    );
    assert.match(record.returnValue, signedDecimal);
    assert.match(record.errorCode, decimal);
    if (record.identity !== null) identity(record.identity);
    if (record.nativeHandle !== null) assert.match(record.nativeHandle, decimal);
    assert.ok(record.nonInheritable === null || typeof record.nonInheritable === "boolean");
  }
}

function successful(records, operations) {
  facts(records, operations);
  for (const record of records) {
    assert.equal(record.errorCode, "0");
    if (record.operation === "OPEN") {
      assert.equal(record.returnValue, record.nativeHandle);
    } else if (windows) {
      assert.notEqual(record.returnValue, "0", "Windows BOOL must report native success");
    } else if (record.operation === "FLAGS") {
      assert.ok(BigInt(record.returnValue) >= 0n);
    } else {
      assert.equal(record.returnValue, "0");
    }
  }
}

function opened(addon, path) {
  const result = addon.openFixedLock(path);
  assert.deepEqual(Object.keys(result), ["handle", "facts"]);
  assert.ok(result.handle && typeof result.handle === "object");
  successful(result.facts, openOperations);
  assert.equal(result.facts[0].identity, null);
  assert.equal(result.facts[0].nonInheritable, null);
  const last = result.facts.at(-1);
  assert.equal(last.nonInheritable, true);
  identity(last.identity);
  for (const record of result.facts) {
    assert.equal(record.nativeHandle, last.nativeHandle);
  }
  for (const record of result.facts.slice(1)) {
    assert.deepEqual(record.identity, last.identity);
  }
  if (!windows) {
    const metadata = statSync(path, { bigint: true });
    assert.deepEqual(last.identity, {
      kind: "POSIX",
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
    });
  }
  return result;
}

function close(addon, handle, expectedIdentity) {
  const records = addon.close(handle);
  successful(records, ["CLOSE"]);
  assert.deepEqual(records[0].identity, expectedIdentity);
  assert.equal(records[0].nativeHandle, null);
  assert.equal(records[0].nonInheritable, null);
  for (const name of functions.slice(1)) assert.throws(() => addon[name](handle), TypeError);
}

async function workerEnvironment(addonPath, path, foreign) {
  // A second Node environment loads the same absolute addon bytes. Neither
  // structured cloning nor independent environment state grants handle transfer.
  const worker = new Worker(
    String.raw`const { parentPort, workerData } = require("node:worker_threads");
const assert = require("node:assert/strict");
const addon = require(workerData.addonPath);
for (const name of ["tryLock", "release", "close", "describe"])
  assert.throws(() => addon[name](workerData.foreign), TypeError);
const opened = addon.openFixedLock(workerData.path);
assert.ok(opened.handle);
const closed = addon.close(opened.handle);
parentPort.postMessage({ foreign: opened.handle, facts: opened.facts, closed });`,
    { eval: true, workerData: { addonPath, path, foreign }, execArgv: [] },
  );
  let message;
  let exited = false;
  try {
    await new Promise((resolve, reject) => {
      worker.on("message", (value) => {
        if (message !== undefined) reject(new Error("Duplicate worker response"));
        else message = value;
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        exited = true;
        if (code !== 0) reject(new Error("Worker exited with code " + code));
        else resolve();
      });
    });
  } finally {
    // This negative fixture owns and waits for its worker even on failure.
    // No process-tree authority or death-lock property follows from this test.
    if (!exited) await worker.terminate();
  }
  assert.ok(message);
  return message;
}

async function fixture(mode, addonPath, directory) {
  const before = checkedAddon(addonPath);
  const require = createRequire(import.meta.url);
  const addon = require(addonPath);
  assert.deepEqual(Reflect.ownKeys(addon), ["interfaceVersion", ...functions]);
  assert.equal(addon.interfaceVersion, "iss022-native-lock-experiment/v1");
  const path = join(directory, "native-lock");
  if (mode === "lifecycle") {
    const reentrant = {
      toString() {
        addon.openFixedLock(path);
        throw new Error("coerced");
      },
    };
    const badPaths = [
      undefined,
      null,
      false,
      1,
      1n,
      Symbol("path"),
      {},
      [],
      Buffer.from(path),
      new String(path),
      new URL("file:///native-lock"),
      reentrant,
      "",
      "native-lock",
      ".",
    ];
    if (windows) badPaths.push("C:native-lock", "\\native-lock", "/native-lock");
    badPaths.push(path + "\0suffix", path + "\ud800");
    for (const value of badPaths) assert.throws(() => addon.openFixedLock(value), TypeError);
    assert.throws(() => addon.openFixedLock(), TypeError);
    assert.throws(() => addon.openFixedLock(path, "extra"), TypeError);
    writeFileSync(path, "A", { flag: "wx" });
    const { handle, facts: opening } = opened(addon, path);
    const originalIdentity = opening.at(-1).identity;
    assert.throws(() => addon.openFixedLock(path), TypeError);
    assert.throws(() => addon.openFixedLock(join(directory, "different")), TypeError);
    const copies = [
      undefined,
      null,
      false,
      0,
      1n,
      Symbol("handle"),
      "0",
      opening.at(-1).nativeHandle,
      {},
      [],
      { ...handle },
      Object.create(handle),
      structuredClone(handle),
      new Proxy(handle, {}),
    ];
    for (const name of functions.slice(1)) {
      assert.throws(() => addon[name](), TypeError);
      assert.throws(() => addon[name](handle, "extra"), TypeError);
      for (const copy of copies) assert.throws(() => addon[name](copy), TypeError);
    }
    // A malformed call cannot release or consume the real OPEN handle.
    assert.throws(() => addon.release(handle), TypeError);
    const other = await workerEnvironment(addonPath, path, handle);
    successful(other.facts, openOperations);
    successful(other.closed, ["CLOSE"]);
    assert.deepEqual(other.facts.at(-1).identity, originalIdentity);
    assert.throws(() => addon.describe(other.foreign), TypeError);
    const description = addon.describe(handle);
    successful(description, describeOperations);
    assert.deepEqual(description.at(-1).identity, originalIdentity);
    assert.equal(description.at(-1).nonInheritable, true);
    successful(addon.tryLock(handle), ["TRY_LOCK"]);
    assert.throws(() => addon.tryLock(handle), TypeError);
    assert.throws(() => addon.close(handle), TypeError);
    successful(addon.describe(handle), describeOperations);
    successful(addon.release(handle), ["UNLOCK"]);
    assert.throws(() => addon.release(handle), TypeError);
    close(addon, handle, originalIdentity);
    assert.throws(() => addon.openFixedLock(path), TypeError);
    delete require.cache[require.resolve(addonPath)];
    const reloaded = require(addonPath);
    assert.throws(() => reloaded.openFixedLock(path), TypeError);
    assert.throws(() => reloaded.describe(handle), TypeError);
    assert.equal(readFileSync(path, "hex"), "41");
  } else if (mode === "changed-size" || mode === "changed-links") {
    writeFileSync(path, "A", { flag: "wx" });
    const { handle, facts: opening } = opened(addon, path);
    if (mode === "changed-size") writeFileSync(path, "AA");
    else linkSync(path, join(directory, "alias"));
    const description = addon.describe(handle);
    facts(description, windows ? ["IDENTIFY", "IDENTIFY"] : ["IDENTIFY"]);
    assert.ok(description.every((call) => call.errorCode === "0"));
    assert.ok(description.every((call) => call.nonInheritable === null));
    // Native metadata calls succeeded, but incomplete fixed sequence refuses.
    close(addon, handle, opening.at(-1).identity);
  } else {
    if (mode === "empty") writeFileSync(path, "", { flag: "wx" });
    else if (mode === "oversize") writeFileSync(path, "AA", { flag: "wx" });
    else if (mode === "directory") mkdirSync(path);
    else if (mode === "hardlink") {
      writeFileSync(path, "A", { flag: "wx" });
      linkSync(path, join(directory, "alias"));
    } else if (mode === "symlink") {
      assert.ok(!windows, "No Windows symlink privilege is requested");
      writeFileSync(join(directory, "target"), "A", { flag: "wx" });
      symlinkSync(join(directory, "target"), path);
    } else assert.equal(mode, "missing");
    const refusal = addon.openFixedLock(path);
    assert.deepEqual(Object.keys(refusal), ["handle", "facts"]);
    assert.equal(refusal.handle, null);
    facts(refusal.facts);
    assert.equal(refusal.facts[0].operation, "OPEN");
    const metadataMismatch = ["empty", "oversize", "hardlink"].includes(mode);
    if (metadataMismatch) {
      assert.deepEqual(
        refusal.facts.map((call) => call.operation),
        windows ? ["OPEN", "IDENTIFY", "IDENTIFY", "CLOSE"] : ["OPEN", "IDENTIFY", "CLOSE"],
      );
      assert.ok(refusal.facts.every((call) => call.errorCode === "0"));
    } else {
      assert.notEqual(refusal.facts[0].errorCode, "0");
      assert.equal(refusal.facts.length, 1);
    }
    const terminal = refusal.facts.at(-1);
    assert.equal(terminal.nativeHandle, null);
    assert.equal(terminal.nonInheritable, null);
    assert.throws(() => addon.openFixedLock(path), TypeError);
    // A failed native attempt consumes the path lifetime; no alternate path.
    const alternate = join(directory, "alternate");
    writeFileSync(alternate, "A", { flag: "wx" });
    assert.throws(() => addon.openFixedLock(alternate), TypeError);
    if (mode === "missing") assert.equal(existsSync(path), false);
  }
  assert.equal(checkedAddon(addonPath), before, "Loaded addon bytes changed");
}

if (process.argv[2] === "--candidate-fixture") {
  assert.equal(process.argv.length, 6);
  await fixture(process.argv[3], process.argv[4], process.argv[5]);
  process.stdout.write("candidate-contract-complete\n");
} else {
  test("source-built candidate native interface contracts", { timeout: 60_000 }, async (t) => {
    assert.equal(process.versions.node.split(".")[0], "24", "Host must supply Node 24");
    const addonPath = process.env.ISS022_CANDIDATE_ADDON_PATH ?? process.argv[2];
    const addonHash = checkedAddon(addonPath);
    const tempParent = realpathSync(tmpdir());
    assert.ok(outside(sourceRoot, tempParent), "Runtime state must stay outside the checkout");
    const root = mkdtempSync(join(tempParent, "iss022-native-candidate-"));
    assert.equal(realpathSync(root), root);
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(NODE_|LD_|DYLD_)/i.test(key)) delete env[key];
    }
    delete env.ISS022_CANDIDATE_ADDON_PATH;
    const modes = [
      "lifecycle",
      "missing",
      "empty",
      "oversize",
      "hardlink",
      "directory",
      "changed-size",
      "changed-links",
      ...(!windows ? ["symlink"] : []),
    ];
    try {
      for (const mode of modes) {
        await t.test(mode, () => {
          const directory = mkdtempSync(join(root, mode + "-"));
          const child = spawnSync(
            process.execPath,
            [here, "--candidate-fixture", mode, addonPath, directory],
            {
              cwd: directory,
              env,
              shell: false,
              windowsHide: true,
              timeout: 15_000,
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          assert.ifError(child.error);
          assert.equal(child.signal, null);
          assert.equal(child.status, 0, child.stderr || child.stdout);
          assert.equal(child.stderr, "");
          assert.equal(child.stdout, "candidate-contract-complete\n");
        });
      }
      assert.equal(checkedAddon(addonPath), addonHash);
    } finally {
      // Check the exact created root before recursive deletion, on every OS.
      assert.equal(realpathSync(root), root);
      assert.equal(dirname(root), tempParent);
      assert.ok(outside(sourceRoot, root));
      rmSync(root, { recursive: true, force: false });
      assert.equal(existsSync(root), false, "Fixture cleanup must be visible");
    }
  });
}

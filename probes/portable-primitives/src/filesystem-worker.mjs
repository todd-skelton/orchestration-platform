import { constants, read } from "node:fs";
import { lstat, open, readFile, realpath, rename } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const [mode, rootInput, first, second] = process.argv.slice(2);
const modes = new Set([
  "ABSENCE",
  "CAS",
  "CAS_BARRIER",
  "EXCLUSIVE_CREATE",
  "LOCK_ATTEMPT",
  "LOCK_DESCRIPTOR_PROBE",
  "LOCK_HOLDER",
  "REPLACE",
]);
const readDescriptor = promisify(read);
const crashPoints = new Set([
  "READY",
  "AFTER_CREATE",
  "AFTER_FILE_SYNC",
  "AFTER_RENAME",
  "AFTER_DIRECTORY_SYNC",
]);
const sourceRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function event(eventName, values = {}) {
  const record = {
    barrier: values.barrier ?? null,
    errorCode: values.errorCode ?? null,
    event: eventName,
    headPlusOneCode: values.headPlusOneCode ?? null,
    headPlusTwoCode: values.headPlusTwoCode ?? null,
    mode: mode === "CAS_BARRIER" ? "CAS" : mode,
    readbackHex: values.readbackHex ?? null,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function casBarrier(barrier) {
  if (typeof process.send !== "function") throw new TypeError("casBarrier:ipc-required");
  await new Promise((resolveSend, reject) =>
    process.send(
      {
        barrier,
        predecessorHex: first,
        proposalHex: second,
        schemaVersion: "portable-primitives-cas-barrier-event/v1",
      },
      (error) => (error ? reject(error) : resolveSend()),
    ),
  );
  if (barrier === "RELEASED") process.disconnect();
}

async function waitForCasRelease() {
  await new Promise((resolveRelease, reject) => {
    process.once("disconnect", () => reject(new Error("casBarrier:provider-disconnected")));
    process.once("message", (message) => {
      if (
        message === null ||
        typeof message !== "object" ||
        Object.getPrototypeOf(message) !== Object.prototype ||
        Object.keys(message).sort().join("\0") !== "command\0schemaVersion" ||
        message.command !== "RELEASE" ||
        message.schemaVersion !== "portable-primitives-cas-barrier-release/v1"
      )
        return reject(new TypeError("casBarrier:release-refused"));
      resolveRelease();
    });
  });
}

function descriptorEvent(accessResult, values = {}) {
  process.stdout.write(
    `${JSON.stringify({
      accessResult,
      errorCode: values.errorCode ?? null,
      readbackHex: values.readbackHex ?? null,
      schemaVersion: "portable-primitives-lock-descriptor-child-event/v1",
    })}\n`,
  );
}

function code(error) {
  return typeof error === "object" && error !== null && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function leaf(root, name) {
  const path = resolve(root, name);
  const value = relative(root, path);
  if (value === "" || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`))
    throw new TypeError("leaf:outside-root");
  return path;
}

function within(root, path) {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

async function checkedRoot(input) {
  if (typeof input !== "string" || !isAbsolute(input) || resolve(input) !== input)
    throw new TypeError("root:absolute-normalized-required");
  const identity = await lstat(input);
  if (!identity.isDirectory() || identity.isSymbolicLink()) throw new TypeError("root:unsafe");
  const resolved = await realpath(input);
  if (resolved !== input) throw new TypeError("root:unresolved");
  if (within(sourceRoot, resolved) || within(resolved, sourceRoot))
    throw new TypeError("root:source-overlap");
  return input;
}

async function waitAtBarrier(barrier) {
  event("REACHED_BARRIER", { barrier });
  await new Promise(() => setInterval(() => undefined, 60_000));
}

async function exclusiveCreate(root) {
  if (first !== undefined || second !== undefined) throw new TypeError("arguments:unexpected");
  const path = leaf(root, "create-once");
  try {
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    try {
      await handle.writeFile(Buffer.from("41", "hex"));
      await handle.sync();
    } finally {
      await handle.close();
    }
    event("CREATED", { readbackHex: (await readFile(path)).toString("hex") });
  } catch (error) {
    event("ERROR", { errorCode: code(error) });
  }
}

async function lock(root, hold) {
  if (first !== undefined || second !== undefined) throw new TypeError("arguments:unexpected");
  try {
    const handle = await open(
      leaf(root, "owner-lock"),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    event("ACQUIRED");
    if (hold) {
      await new Promise(() => setInterval(() => undefined, 60_000));
    } else {
      await handle.close();
    }
  } catch (error) {
    event("ERROR", { errorCode: code(error) });
  }
}

async function lockDescriptorProbe() {
  if (!/^(?:0|[1-9][0-9]{0,4})$/.test(first ?? "") || second !== "32")
    throw new TypeError("lockDescriptor:arguments-invalid");
  const descriptor = Number(first);
  const readback = Buffer.alloc(32);
  try {
    const { bytesRead } = await readDescriptor(descriptor, readback, 0, readback.length, 0);
    descriptorEvent("ACCESSED", { readbackHex: readback.subarray(0, bytesRead).toString("hex") });
  } catch (error) {
    descriptorEvent("REFUSED", { errorCode: code(error) });
  }
}

async function replaceAt(root) {
  if (!crashPoints.has(first) || second !== undefined) throw new TypeError("crashPoint:invalid");
  try {
    const target = leaf(root, "replace-target");
    const temporary = leaf(root, "replace-temp");
    if (first === "READY") return await waitAtBarrier("READY");
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    if (first === "AFTER_CREATE") return await waitAtBarrier(first);
    await handle.writeFile(Buffer.from("42", "hex"));
    await handle.sync();
    if (first === "AFTER_FILE_SYNC") return await waitAtBarrier(first);
    await handle.close();
    await rename(temporary, target);
    if (first === "AFTER_RENAME") return await waitAtBarrier(first);
    const directory = await open(root, constants.O_RDONLY);
    await directory.sync();
    await directory.close();
    await waitAtBarrier("AFTER_DIRECTORY_SYNC");
  } catch (error) {
    event("ERROR", { errorCode: code(error) });
  }
}

async function cas(root, useBarrier = false) {
  if (!new Set(["41", "42"]).has(first) || second !== "42")
    throw new TypeError("cas:arguments-invalid");
  if (useBarrier) {
    await casBarrier("READY");
    await waitForCasRelease();
    await casBarrier("RELEASED");
  }
  let lockHandle;
  try {
    lockHandle = await open(
      leaf(root, "cas-lock"),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
  } catch (error) {
    return event("ERROR", { errorCode: code(error) });
  }
  try {
    const target = leaf(root, "cas-target");
    const readback = (await readFile(target)).toString("hex");
    if (readback !== first) {
      await lockHandle.close();
      return event("PREDECESSOR_MISMATCH", { readbackHex: readback });
    }
    const proposal = await open(
      leaf(root, "cas-proposal"),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    await proposal.writeFile(Buffer.from(second, "hex"));
    await proposal.sync();
    await proposal.close();
    await rename(leaf(root, "cas-proposal"), target);
    const directory = await open(root, constants.O_RDONLY);
    await directory.sync();
    await directory.close();
    const selectedReadback = (await readFile(target)).toString("hex");
    await lockHandle.close();
    event("SELECTED", { readbackHex: selectedReadback });
  } catch (error) {
    event("ERROR", { errorCode: code(error) });
  }
}

async function absence(root) {
  if (first !== undefined || second !== undefined) throw new TypeError("arguments:unexpected");
  let lockHandle;
  try {
    lockHandle = await open(
      leaf(root, "absence-lock"),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
  } catch (error) {
    return event("ERROR", { errorCode: code(error) });
  }
  let headPlusOneCode;
  let headPlusTwoCode;
  try {
    await lstat(leaf(root, "authority-head-plus-one"));
    headPlusOneCode = "PRESENT";
  } catch (error) {
    headPlusOneCode = code(error);
  }
  try {
    await lstat(leaf(root, "authority-head-plus-two"));
    headPlusTwoCode = "PRESENT";
  } catch (error) {
    headPlusTwoCode = code(error);
  }
  await lockHandle.close();
  event("ABSENCE_OBSERVED", { headPlusOneCode, headPlusTwoCode });
}

try {
  if (!modes.has(mode)) throw new TypeError("mode:invalid");
  const root = await checkedRoot(rootInput);
  if (mode === "EXCLUSIVE_CREATE") await exclusiveCreate(root);
  else if (mode === "LOCK_ATTEMPT") await lock(root, false);
  else if (mode === "LOCK_DESCRIPTOR_PROBE") await lockDescriptorProbe();
  else if (mode === "LOCK_HOLDER") await lock(root, true);
  else if (mode === "REPLACE") await replaceAt(root);
  else if (mode === "CAS" || mode === "CAS_BARRIER") await cas(root, mode === "CAS_BARRIER");
  else await absence(root);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

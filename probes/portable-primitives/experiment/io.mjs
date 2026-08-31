import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { types } from "node:util";
import { decimal, interfaceVersion, record, refuse } from "./facts.mjs";

export function absolute(value) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isAbsolute(value) ||
    resolve(value) !== value
  )
    refuse();
  return value;
}
export function inside(root, path) {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}
const stamp = (stat) =>
  [
    stat.dev,
    stat.ino,
    stat.mode,
    ...(stat.isFile() ? [stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs] : []),
  ].join(":");

// Private identity guard, scoped to this fixture's files. Native parent custody
// (including Windows reparse policy) remains the coordinator's required barrier.
export function fileGuard() {
  const observed = new Map();
  function metadata(path, directory) {
    absolute(path);
    const stat = lstatSync(path, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) ||
      realpathSync(path) !== path
    )
      refuse();
    const value = stamp(stat);
    if (observed.has(path) && observed.get(path) !== value) refuse();
    observed.set(path, value);
    return stat;
  }
  function parents(path) {
    const paths = [];
    for (let current = dirname(path); ; current = dirname(current)) {
      paths.push(current);
      if (dirname(current) === current) break;
    }
    for (const parent of paths.reverse()) metadata(parent, true);
  }
  function bytes(path) {
    parents(path);
    const before = metadata(path, false);
    if (before.size > 256n * 1024n * 1024n) refuse();
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (stamp(fstatSync(fd, { bigint: true })) !== stamp(before)) refuse();
      const result = readFileSync(fd);
      if (stamp(fstatSync(fd, { bigint: true })) !== stamp(before)) refuse();
      metadata(path, false);
      parents(path);
      return result;
    } finally {
      closeSync(fd);
    }
  }
  function verify() {
    for (const [path, expected] of observed) {
      const stat = lstatSync(path, { bigint: true });
      if (stat.isSymbolicLink() || stamp(stat) !== expected || realpathSync(path) !== path)
        refuse();
    }
  }
  return Object.freeze({ metadata, parents, bytes, verify });
}

export function checkReference(guard, path, value) {
  const ref = record(value, ["path", "byteLength", "sha256"]);
  decimal(ref.byteLength);
  if (typeof ref.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(ref.sha256)) refuse();
  const bytes = guard.bytes(path);
  if (
    String(bytes.length) !== ref.byteLength ||
    createHash("sha256").update(bytes).digest("hex") !== ref.sha256
  )
    refuse();
  return ref;
}
export function checkAddon(addon, role) {
  if (!["STABLE_WITNESS", "CANDIDATE_BINDING"].includes(role)) refuse();
  if (
    !addon ||
    typeof addon !== "object" ||
    types.isProxy(addon) ||
    Object.getPrototypeOf(addon) !== Object.prototype
  )
    refuse();
  const functions = [
    "openFixedLock",
    "tryLock",
    "release",
    "close",
    "describe",
    ...(role === "STABLE_WITNESS" ? ["inspectNativeHandle", "describeCustody"] : []),
  ];
  const descriptors = Object.getOwnPropertyDescriptors(addon);
  if (Reflect.ownKeys(descriptors).length !== functions.length + 1) refuse();
  for (const name of ["interfaceVersion", ...functions]) {
    const field = descriptors[name];
    if (
      !field ||
      !("value" in field) ||
      !field.enumerable ||
      (name === "interfaceVersion"
        ? field.value !== interfaceVersion
        : typeof field.value !== "function")
    )
      refuse();
  }
  return addon;
}

// The only dynamic load is the exact expected absolute .node output. No flags,
// search path, candidate module dependencies, or injected test loader are accepted.
export function loadNative(role, artifactRoot, reference, guard) {
  if (!["STABLE_WITNESS", "CANDIDATE_BINDING"].includes(role)) refuse();
  absolute(artifactRoot);
  if (role === "CANDIDATE_BINDING" && typeof process.send !== "function") refuse();
  const name =
    role === "STABLE_WITNESS" ? "native-lock-witness.node" : "native-lock-candidate.node";
  const expected = `builds/${role}/${name}`;
  const ref = record(reference, ["path", "byteLength", "sha256"]);
  if (ref.path !== expected) refuse();
  const path = resolve(artifactRoot, expected);
  function verify() {
    const entries = readdirSync(dirname(path), { withFileTypes: true });
    if (
      entries.some(
        (entry) =>
          !entry.isFile() ||
          (entry.name !== name &&
            !["compiler.stdout", "compiler.stderr"].includes(entry.name) &&
            !(process.platform === "win32" && /\.(obj|lib|exp|pdb|ilk)$/.test(entry.name))),
      )
    )
      refuse();
    checkReference(guard, path, ref);
    guard.verify();
  }
  verify();
  const require = createRequire(import.meta.url);
  if (require.cache[path]) refuse();
  const addon = checkAddon(require(path), role);
  verify();
  return Object.freeze({ addon, verify });
}

export function nodeLaunchOptions(rootPath, systemRoot = null) {
  absolute(rootPath);
  const env = { LANG: "C", LC_ALL: "C", TEMP: rootPath, TMP: rootPath, TMPDIR: rootPath };
  if (process.platform === "win32") {
    absolute(systemRoot);
    env.SystemRoot = systemRoot;
    env.WINDIR = systemRoot;
  } else if (systemRoot !== null) refuse();
  // No inherited environment, PATH, NODE_OPTIONS, NODE_PATH, LD_*, DYLD_*,
  // command-line preloads or extra stdio/Windows handle list.
  return {
    cwd: rootPath,
    env,
    shell: false,
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  };
}

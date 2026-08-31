import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { types } from "node:util";
import { readNativeLockHeaders } from "./native-lock-distribution.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = () => {
  throw new TypeError("native-lock-headers:refused");
};
const order = (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

function snapshot(input) {
  const keys = [
    "archiveBytes",
    "exactNodeVersion",
    "runnerTemp",
    "headerRoot",
    "stableRoot",
    "candidateRoot",
  ];
  if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length) refuse();
  const result = {};
  for (const key of keys) {
    const property = descriptors[key];
    if (!property || !Object.hasOwn(property, "value") || !property.enumerable) refuse();
    result[key] = property.value;
  }
  return result;
}

function absolute(path) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    path.includes("\0")
  )
    refuse();
  // Refuse alternate streams, DOS device/short names and trailing-dot/space aliases.
  for (let current = path; dirname(current) !== current; current = dirname(current)) {
    const part = basename(current);
    if (
      /[\\:~]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
    )
      refuse();
  }
}
function within(root, path) {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}
function identity(value) {
  return [
    value.dev,
    value.ino,
    value.mode,
    ...(value.isFile() ? [value.nlink, value.size, value.mtimeNs, value.ctimeNs] : []),
  ].join(":");
}

// These observations detect custody changes; they do not isolate a hostile writer.
// The stable caller must own exclusive external-temp custody throughout use.
function custody() {
  const known = new Map();
  const contents = new Map();
  async function inspect(path, directory) {
    const value = await lstat(path, { bigint: true });
    if (
      value.isSymbolicLink() ||
      (directory ? !value.isDirectory() : !value.isFile()) ||
      (!directory && value.nlink !== 1n) ||
      (await realpath(path)) !== path
    )
      refuse();
    const observed = identity(value);
    if (known.has(path) && known.get(path).identity !== observed) refuse();
    if (contents.has(path) && contents.get(path) !== `${value.mtimeNs}:${value.ctimeNs}`) refuse();
    known.set(path, { identity: observed, directory });
    return value;
  }
  async function parents(path) {
    const chain = [];
    for (let current = dirname(path); ; current = dirname(current)) {
      chain.push(current);
      if (dirname(current) === current) break;
    }
    for (const parent of chain.reverse()) await inspect(parent, true);
  }
  async function verify() {
    for (const [path, entry] of known) await inspect(path, entry.directory);
  }
  async function bytes(path, expected) {
    await parents(path);
    const before = await inspect(path, false);
    if (before.size !== BigInt(expected.length)) refuse();
    const handle = await open(path, "r");
    try {
      if (identity(await handle.stat({ bigint: true })) !== identity(before)) refuse();
      // Read exactly the accepted payload plus one byte, even if a writer grows it.
      const bytes = Buffer.alloc(expected.length + 1);
      let used = 0;
      while (used < bytes.length) {
        const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      if (
        used !== expected.length ||
        !bytes.subarray(0, used).equals(expected) ||
        identity(await handle.stat({ bigint: true })) !== identity(before)
      )
        refuse();
      await inspect(path, false);
      return bytes.subarray(0, used);
    } finally {
      await handle.close();
    }
  }
  async function seal(path) {
    const value = await inspect(path, true);
    contents.set(path, `${value.mtimeNs}:${value.ctimeNs}`);
  }
  function beginCleanup() {
    contents.clear(); // Our own unlinks change directory times; identities remain bound.
  }
  function requireKnown(path) {
    if (!known.has(path)) refuse();
  }
  function bindFile(path, value) {
    if (!value.isFile() || value.nlink !== 1n || known.has(path)) refuse();
    known.set(path, { identity: identity(value), directory: false });
  }
  return { inspect, parents, verify, bytes, seal, beginCleanup, requireKnown, bindFile };
}

/**
 * Private extraction only: no official-origin, revision, build, load or capability
 * authority. The caller binds the version to its actual Node process and retains
 * acquired archive/SHASUMS bytes separately. Both source roots must be complete
 * caller-owned roots, not arbitrary stand-ins. No candidate callback executes.
 */
export async function materializeNativeLockHeaders(input) {
  const guard = custody();
  const created = [];
  let request;
  let active = true;
  let busy = false;
  async function cleanup() {
    // Remove only observed owned entries, never recurse into unexpected contents.
    guard.beginCleanup();
    for (const entry of [...created].reverse()) {
      guard.requireKnown(entry.path);
      await guard.parents(entry.path);
      await guard.inspect(entry.path, entry.directory);
      if (entry.directory) await rmdir(entry.path);
      else await unlink(entry.path);
    }
    if (created.length) {
      await guard.parents(request.headerRoot);
      try {
        await lstat(request.headerRoot);
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      refuse();
    }
  }
  try {
    request = snapshot(input);
    // Synchronous real-reader snapshot occurs before the first filesystem await.
    const distribution = readNativeLockHeaders(request.archiveBytes, request.exactNodeVersion);
    for (const key of ["runnerTemp", "headerRoot", "stableRoot", "candidateRoot"])
      absolute(request[key]);
    if (
      dirname(request.headerRoot) !== request.runnerTemp ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(basename(request.headerRoot))
    )
      refuse();
    const roots = [request.runnerTemp, request.stableRoot, request.candidateRoot];
    for (let left = 0; left < roots.length; left++) {
      for (let right = left + 1; right < roots.length; right++)
        if (within(roots[left], roots[right]) || within(roots[right], roots[left])) refuse();
      await guard.parents(roots[left]);
      await guard.inspect(roots[left], true);
    }
    async function directory(path) {
      await guard.parents(path);
      await mkdir(path, { mode: 0o700 }); // EEXIST refuses even an empty prior extraction.
      created.push({ path, directory: true });
      await guard.inspect(path, true);
    }
    await directory(request.headerRoot);
    const expected = new Map(distribution.entries.map((entry) => [entry.path, entry]));
    for (const entry of distribution.entries) {
      const path = resolve(request.headerRoot, entry.path);
      if (entry.kind === "DIRECTORY") await directory(path);
      else {
        await guard.parents(path);
        const handle = await open(path, "wx", 0o600);
        created.push({ path, directory: false });
        try {
          await handle.writeFile(entry.bytes);
          guard.bindFile(path, await handle.stat({ bigint: true }));
          await guard.inspect(path, false);
        } finally {
          await handle.close();
        }
      }
    }
    for (const entry of created) if (entry.directory) await guard.seal(entry.path);
    async function census() {
      await guard.verify();
      const entries = [];
      const headers = [];
      const seen = new Set();
      async function visit(directory, depth) {
        if (depth > 24) refuse();
        await guard.inspect(directory, true);
        for (const child of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, child.name);
          const name = relative(request.headerRoot, path).split(sep).join("/");
          const entry = expected.get(name);
          if (!entry || seen.has(name) || child.isSymbolicLink()) refuse();
          seen.add(name); // Exact spelling rejects case aliases, extras and duplicates.
          if (entry.kind === "DIRECTORY") {
            if (!child.isDirectory()) refuse();
            entries.push(Object.freeze({ ...entry }));
            await visit(path, depth + 1);
          } else {
            if (!child.isFile()) refuse();
            const bytes = await guard.bytes(path, entry.bytes);
            const { bytes: unused, ...metadata } = entry;
            const sha256 = digest(bytes);
            entries.push(Object.freeze({ ...metadata, byteLength: bytes.length, sha256 }));
            headers.push(
              Object.freeze({ path: entry.headerPath, byteLength: String(bytes.length), sha256 }),
            );
          }
        }
        await guard.inspect(directory, true);
      }
      await visit(request.headerRoot, 0);
      if (seen.size !== expected.size) refuse();
      await guard.verify();
      return Object.freeze({
        distribution: Object.freeze({
          ...distribution,
          entries: Object.freeze(entries.sort(order)),
        }),
        headers: Object.freeze(headers.sort(order)),
      });
    }
    const observed = await census(); // Complete disk readback before returning anything.
    async function exclusive(operation) {
      if (!active || busy) refuse();
      busy = true;
      try {
        return await operation();
      } catch {
        active = false; // Failed revalidation cannot be retried into success.
        refuse();
      } finally {
        busy = false;
      }
    }
    return Object.freeze({
      headerRoot: request.headerRoot,
      includeRoot: resolve(request.headerRoot, `node-${distribution.version}/include/node`),
      ...observed,
      revalidate: () => exclusive(census),
      dispose: async () => {
        if (busy) refuse();
        busy = true;
        active = false;
        try {
          await cleanup();
        } catch {
          throw new TypeError("native-lock-headers:cleanup-refused");
        } finally {
          busy = false;
        }
      },
    });
  } catch {
    active = false;
    try {
      await cleanup();
    } catch {
      throw new TypeError("native-lock-headers:cleanup-refused");
    }
    refuse();
  }
}

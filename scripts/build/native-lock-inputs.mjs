import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { basename, delimiter, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { decimal, record } from "../../probes/portable-primitives/experiment/facts.mjs";
import { absolute, fileGuard, inside } from "../../probes/portable-primitives/experiment/io.mjs";
import { buildNativeLockExperiment } from "./native-lock-experiment.mjs";
import { materializeNativeLockHeaders } from "./native-lock-headers.mjs";

// Protected N must authenticate its executing bundle BEFORE importing this module.
// These hashes bind bytes only: neither this census nor capture JSON grants authority.
const stablePaths = Object.freeze([
  "packages/contracts/src/runtime.ts",
  "probes/portable-primitives/experiment/facts.mjs",
  "probes/portable-primitives/experiment/fixture.mjs",
  "probes/portable-primitives/experiment/io.mjs",
  "probes/portable-primitives/experiment/session.mjs",
  "scripts/build/native-lock-distribution.mjs",
  "scripts/build/native-lock-experiment.mjs",
  "scripts/build/native-lock-headers.mjs",
  "scripts/build/native-lock-inputs.mjs",
  "scripts/conformance/hosted-native-lock-acquisition.mts",
]);
const modulePath = fileURLToPath(import.meta.url);
const stableRoot = resolve(dirname(modulePath), "../..");
const sourcePrefix = "probes/portable-primitives/native/";
const candidatePath = `${sourcePrefix}native-lock-candidate.c`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entry = (path, bytes) => ({ path, byteLength: String(bytes.length), sha256: hash(bytes) });
const order = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const refuse = () => {
  throw new TypeError("native-lock-inputs:refused");
};
const overlap = (a, b) => inside(a, b) || inside(b, a);
function text(value, maximum = 4096, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.length) ||
    value.length > maximum ||
    value.includes("\0")
  )
    refuse();
  return value;
}
function path(value) {
  absolute(text(value));
  for (let current = value; dirname(current) !== current; current = dirname(current)) {
    const part = basename(current);
    if (
      /[\\:~]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
    )
      refuse();
  }
  return value;
}
function portable(value) {
  text(value, 1024);
  if (
    /[\\:]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    refuse();
  return value;
}
function reference(input) {
  const value = record(input, ["path", "byteLength", "sha256"]);
  portable(value.path);
  decimal(value.byteLength);
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) refuse();
  return value;
}
function array(value, maximum) {
  // All arrays arrive through record's recursive descriptor-safe snapshot.
  if (!Array.isArray(value) || value.length > maximum) refuse();
  return value;
}

/** Private preparation only: no discovery, download, addon loading or native case execution. */
export async function prepareNativeLockBuild(input) {
  const request = record(input, [
    "runnerTemp",
    "stableRevision",
    "candidateRevision",
    "candidateRoot",
    "candidateFile",
    "distribution",
    "toolchainCapture",
  ]);
  const distribution = record(request.distribution, [
    "archivePath",
    "shasumsPath",
    "importLibraryPath",
  ]);
  const candidate = record(request.candidateFile, [
    "path",
    "byteLength",
    "sha256Digest",
    "executable",
  ]);
  for (const revision of [request.stableRevision, request.candidateRevision])
    if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) refuse();
  if (candidate.path !== candidatePath || typeof candidate.executable !== "boolean") refuse();
  reference({
    path: candidate.path,
    byteLength: candidate.byteLength,
    sha256: candidate.sha256Digest,
  });
  const node = {
    executablePath: process.execPath,
    version: process.version,
    architecture: process.arch,
    platform: process.platform,
    modules: process.versions.modules,
    napi: process.versions.napi,
  };
  if (
    !/^v24\.[0-9]+\.[0-9]+$/.test(node.version) ||
    !["linux", "darwin", "win32"].includes(node.platform)
  )
    refuse();
  decimal(node.modules);
  decimal(node.napi);
  if (BigInt(node.napi) < 8n) refuse();
  text(node.architecture, 32);
  const roots = [path(stableRoot), path(request.candidateRoot), path(request.runnerTemp)];
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++) if (overlap(roots[i], roots[j])) refuse();
  if (modulePath !== resolve(stableRoot, "scripts/build/native-lock-inputs.mjs")) refuse();
  const external = (value) => {
    path(value);
    if (roots.some((root) => overlap(root, value))) refuse();
    return value;
  };
  external(node.executablePath);
  external(distribution.archivePath);
  external(distribution.shasumsPath);
  if (node.platform === "win32") external(distribution.importLibraryPath);
  else if (distribution.importLibraryPath !== null) refuse();
  // Null/malformed/UNKNOWN capture must never become the builder's unavailable branch.
  if (request.toolchainCapture === null) refuse();
  external(request.toolchainCapture);
  const guard = fileGuard();
  for (const root of roots) {
    guard.parents(root);
    guard.metadata(root, true);
  }
  if ((await readdir(request.runnerTemp)).length) refuse();
  const headerRoot = resolve(request.runnerTemp, "headers");
  const buildRoot = resolve(request.runnerTemp, "build");
  const preparationRoot = resolve(request.runnerTemp, "preparation");
  for (const child of [headerRoot, buildRoot, preparationRoot]) {
    try {
      await lstat(child);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    refuse();
  }
  const originals = new Map(),
    retained = new Map();
  function read(file, limit = 256 * 1024 * 1024) {
    path(file);
    guard.parents(file);
    if (guard.metadata(file, false).size > BigInt(limit)) refuse();
    const bytes = guard.bytes(file);
    if (bytes.length > limit) refuse();
    const observed = entry(file, bytes);
    const previous = originals.get(file);
    if (
      previous &&
      (previous.sha256 !== observed.sha256 || previous.byteLength !== observed.byteLength)
    )
      refuse();
    originals.set(file, observed);
    return bytes;
  }
  const executable = entry(node.executablePath, read(node.executablePath));
  const archiveBytes = read(distribution.archivePath, 16 * 1024 * 1024);
  const archive = entry(distribution.archivePath, archiveBytes);
  const shasumsBytes = read(distribution.shasumsPath, 1024 * 1024);
  const shasums = entry(distribution.shasumsPath, shasumsBytes);
  const archiveName = `node-${node.version}-headers.tar.gz`;
  if (basename(archive.path) !== archiveName) refuse();
  const lines = shasumsBytes.toString("utf8").split(/\r?\n/);
  function checksum(name, expected) {
    // Validate every nonempty row so malformed duplicate rows cannot hide beside a valid row.
    const rows = lines
      .filter((line) => line !== "")
      .map((line) => {
        const match = /^([0-9a-f]{64})  ([^\s]+)$/.exec(line);
        if (!match) refuse();
        return match;
      })
      .filter((row) => row[2] === name);
    if (rows.length !== 1 || rows[0][1] !== expected) refuse();
  }
  checksum(archiveName, archive.sha256);
  const importLibrary =
    distribution.importLibraryPath === null
      ? null
      : entry(
          distribution.importLibraryPath,
          read(distribution.importLibraryPath, 16 * 1024 * 1024),
        );
  if (importLibrary) checksum(`win-${node.architecture}/node.lib`, importLibrary.sha256);
  const captureBytes = read(request.toolchainCapture, 1024 * 1024);
  const capture = record(JSON.parse(captureBytes.toString("utf8")), [
    "platform",
    "architecture",
    "nodeVersion",
    "state",
    "toolchain",
    "observations",
  ]);
  if (
    capture.platform !== node.platform ||
    capture.architecture !== node.architecture ||
    capture.nodeVersion !== node.version ||
    !["AVAILABLE", "UNAVAILABLE", "UNKNOWN"].includes(capture.state)
  )
    refuse();
  const raw = new Map();
  function stream(value) {
    const ref = reference(value);
    if (ref.path === "capture.json") refuse();
    const source = external(resolve(dirname(request.toolchainCapture), ref.path));
    const bytes = read(source, 8 * 1024 * 1024);
    if (String(bytes.length) !== ref.byteLength || hash(bytes) !== ref.sha256) refuse();
    raw.set(ref.path, bytes);
    return bytes.length;
  }
  function directory(value) {
    external(value);
    guard.parents(value);
    guard.metadata(value, true);
  }
  function directories(value) {
    const values = array(value, 64);
    if (new Set(values).size !== values.length) refuse();
    for (const value of values) {
      if (text(value).includes(delimiter)) refuse();
      directory(value);
    }
    return [...values];
  }
  const purposes = new Map();
  for (const observation of array(capture.observations, 2)) {
    const value = record(
      observation,
      observation.kind === "COMMAND"
        ? [
            "kind",
            "purpose",
            "executablePath",
            "argv",
            "cwd",
            "exitCode",
            "signal",
            "errorCode",
            "stdout",
            "stderr",
          ]
        : ["kind", "purpose", "searchDirectories", "selectedPath", "errorCode"],
    );
    if (!["COMPILER", "SDK"].includes(value.purpose) || purposes.has(value.purpose)) refuse();
    if (value.errorCode !== null) text(value.errorCode, 64);
    let available = false,
      unavailable = false;
    if (value.kind === "COMMAND") {
      external(value.executablePath);
      guard.parents(value.executablePath);
      directory(value.cwd);
      for (const argument of array(value.argv, 64)) text(argument, 4096, true);
      if (value.exitCode !== null) {
        decimal(value.exitCode);
        if (BigInt(value.exitCode) > 2147483647n) refuse();
      }
      if (
        value.signal !== null &&
        (typeof value.signal !== "string" || !Object.hasOwn(constants.signals, value.signal))
      )
        refuse();
      if (value.exitCode !== null && value.signal !== null) refuse();
      const bytes = stream(value.stdout) + stream(value.stderr);
      available =
        value.exitCode === "0" && value.signal === null && value.errorCode === null && bytes > 0;
      unavailable =
        value.exitCode === null &&
        value.signal === null &&
        ["ENOENT", "EACCES", "EPERM"].includes(value.errorCode);
      if (available) guard.metadata(value.executablePath, false);
    } else if (value.kind === "LOOKUP") {
      if (!directories(value.searchDirectories).length) refuse();
      if (value.selectedPath !== null) {
        external(value.selectedPath);
        guard.parents(value.selectedPath);
        if (value.purpose === "COMPILER") guard.metadata(value.selectedPath, false);
        else directory(value.selectedPath);
        if (value.errorCode !== null) refuse();
        available = true;
      } else unavailable = ["ENOENT", "EACCES", "EPERM"].includes(value.errorCode);
    } else refuse();
    purposes.set(value.purpose, { value, available, unavailable });
  }
  let toolchain = null;
  if (capture.state === "AVAILABLE") {
    if (purposes.size !== 2 || [...purposes.values()].some((value) => !value.available)) refuse();
    const value = record(capture.toolchain, [
      "compilerPath",
      "compilerVersion",
      "sdkVersion",
      "path",
      "include",
      "lib",
      "sdkRoot",
      "systemRoot",
    ]);
    external(value.compilerPath);
    guard.parents(value.compilerPath);
    guard.metadata(value.compilerPath, false);
    text(value.compilerVersion, 1024);
    text(value.sdkVersion, 1024);
    if (!value.compilerVersion.trim() || !value.sdkVersion.trim()) refuse();
    toolchain = {
      ...value,
      path: directories(value.path),
      include: directories(value.include),
      lib: directories(value.lib),
    };
    if (
      !toolchain.path.length ||
      (node.platform !== "win32" && (toolchain.include.length || toolchain.lib.length))
    )
      refuse();
    if (
      node.platform === "win32"
        ? !toolchain.systemRoot || !toolchain.include.length || !toolchain.lib.length
        : toolchain.systemRoot !== null
    )
      refuse();
    if (node.platform === "darwin" ? !toolchain.sdkRoot : toolchain.sdkRoot !== null) refuse();
    for (const value of [toolchain.sdkRoot, toolchain.systemRoot])
      if (value !== null) directory(value);
    const compiler = purposes.get("COMPILER").value;
    // A lookup can establish absence, but cannot replace retained version-command evidence.
    if (compiler.kind !== "COMMAND" || compiler.executablePath !== toolchain.compilerPath) refuse();
  } else if (capture.toolchain !== null) refuse();
  const stableFiles = stablePaths.map((name) => entry(name, read(resolve(stableRoot, name))));
  const stableSource = entry(
    resolve(stableRoot, `${sourcePrefix}native-lock-witness.c`),
    read(resolve(stableRoot, `${sourcePrefix}native-lock-witness.c`)),
  );
  const candidateSource = entry(
    resolve(request.candidateRoot, candidatePath),
    read(resolve(request.candidateRoot, candidatePath)),
  );
  if (
    candidateSource.byteLength !== candidate.byteLength ||
    candidateSource.sha256 !== candidate.sha256Digest
  )
    refuse();
  if (
    node.platform !== "win32" &&
    ((guard.metadata(candidateSource.path, false).mode & 0o111n) !== 0n) !== candidate.executable
  )
    refuse();
  let headers,
    helper,
    failure,
    disposalAttempted = false;
  const residualPaths = [headerRoot, buildRoot, preparationRoot];
  function verify() {
    guard.verify();
    for (const original of originals.values()) {
      const bytes = guard.bytes(original.path);
      if (String(bytes.length) !== original.byteLength || hash(bytes) !== original.sha256) refuse();
    }
  }
  async function retain(name, bytes) {
    portable(name);
    const destination = resolve(preparationRoot, name);
    await mkdir(dirname(destination), { recursive: true });
    guard.parents(destination);
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    const observed = entry(`preparation/${name}`, read(destination, 8 * 1024 * 1024));
    if (observed.sha256 !== hash(bytes) || observed.byteLength !== String(bytes.length)) refuse();
    retained.set(observed.path, observed);
  }
  async function census(disposed = false) {
    // The shared guard binds directory identity, not contents. Seal each directory
    // before enumeration, then check all seals after the complete retained readback.
    // Each census starts after our own writes/disposal; unexpected entries stay put.
    const sealedDirectories = new Map();
    const contentStamp = (stat) => `${stat.mtimeNs}:${stat.ctimeNs}`;
    function seal(directory) {
      guard.parents(directory);
      sealedDirectories.set(directory, contentStamp(guard.metadata(directory, true)));
    }
    seal(request.runnerTemp);
    const children = (await readdir(request.runnerTemp)).sort().join("\0");
    if (children !== (disposed ? "build\0preparation" : "build\0headers\0preparation")) refuse();
    const expected = new Map(retained);
    for (const build of helper.builds)
      for (const file of [...(build.inputs ?? []), ...(build.outputs ?? [])]) {
        const name = `build/${portable(file.path)}`;
        const value = { ...file, path: name };
        if (expected.has(name) && JSON.stringify(expected.get(name)) !== JSON.stringify(value))
          refuse();
        expected.set(name, value);
      }
    const files = [],
      seen = new Set();
    let count = 0;
    async function visit(directory, prefix, depth) {
      if (++count > 24000 || depth > 24) refuse();
      seal(directory);
      for (const child of await readdir(directory, { withFileTypes: true })) {
        if (++count > 24000 || child.isSymbolicLink()) refuse();
        const name = `${prefix}/${child.name}`,
          destination = resolve(directory, child.name);
        if (child.isDirectory()) {
          if (![...expected.keys()].some((key) => key.startsWith(`${name}/`))) refuse();
          await visit(destination, name, depth + 1);
        } else {
          if (!child.isFile() || !expected.has(name) || seen.has(name)) refuse();
          const observed = entry(name, read(destination));
          if (
            observed.byteLength !== expected.get(name).byteLength ||
            observed.sha256 !== expected.get(name).sha256
          )
            refuse();
          seen.add(name);
          files.push(observed);
        }
      }
    }
    await visit(buildRoot, "build", 0);
    await visit(preparationRoot, "preparation", 0);
    if (seen.size !== expected.size) refuse();
    verify();
    for (const [directory, stamp] of sealedDirectories)
      if (contentStamp(guard.metadata(directory, true)) !== stamp) refuse();
    return files.sort(order);
  }
  try {
    await mkdir(preparationRoot, { mode: 0o700 });
    guard.metadata(preparationRoot, true);
    await retain("capture.json", captureBytes);
    for (const [name, bytes] of raw) await retain(name, bytes);
    if (
      capture.state === "UNKNOWN" ||
      (capture.state === "UNAVAILABLE" &&
        (![...purposes.values()].some((value) => value.unavailable) ||
          [...purposes.values()].some((value) => !value.available && !value.unavailable)))
    )
      refuse();
    headers = await materializeNativeLockHeaders({
      archiveBytes,
      exactNodeVersion: node.version,
      runnerTemp: request.runnerTemp,
      headerRoot,
      stableRoot,
      candidateRoot: request.candidateRoot,
    });
    if (
      headers.distribution.archive.sha256 !== archive.sha256 ||
      String(headers.distribution.archive.byteLength) !== archive.byteLength
    )
      refuse();
    const buildRequest = {
      runnerTemp: request.runnerTemp,
      artifactRoot: buildRoot,
      stableRoot,
      candidateRoot: request.candidateRoot,
      stableRevision: request.stableRevision,
      candidateRevision: request.candidateRevision,
      node: { ...node, byteLength: executable.byteLength, sha256: executable.sha256 },
      stableSource,
      candidateSource,
      stableFiles,
      distribution: {
        archive,
        shasums,
        includeRoot: headers.includeRoot,
        headers: [...headers.headers],
        importLibrary,
      },
      toolchain,
    };
    await headers.revalidate();
    verify();
    helper = await buildNativeLockExperiment(buildRequest);
    await headers.revalidate();
    verify();
    await census();
    disposalAttempted = true;
    await headers.dispose();
    const retainedFiles = await census(true);
    // The caller must keep this pending inside consume(...): only its successful
    // authenticated outer consume/delete result permits later collection/acceptance.
    return {
      status: "PENDING_CANDIDATE_CONSUME",
      buildRoot,
      buildPathPrefix: "build/",
      helper,
      extraction: { distribution: headers.distribution, headers: headers.headers },
      capture,
      stableFiles,
      candidateFile: candidate,
      retainedFiles,
    };
  } catch (error) {
    failure = error;
  }
  if (headers && !disposalAttempted) {
    try {
      await headers.dispose();
    } catch (cleanup) {
      failure = new AggregateError(
        [failure, cleanup],
        "native-lock-inputs:preparation-and-cleanup-refused",
      );
    }
  }
  // No force deletion of changed trees; preserve diagnostics and both failure causes.
  throw Object.assign(new Error("native-lock-inputs:preparation-refused", { cause: failure }), {
    residualPaths,
    helper: helper ?? null,
  });
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const roles = ["STABLE_WITNESS", "CANDIDATE_BINDING"];
const sourceNames = ["native-lock-witness.c", "native-lock-candidate.c"];
const sourcePrefix = "probes/portable-primitives/native/";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (values) => values.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const refuse = () => {
  throw new Error("native-lock-build:refused");
};

// Preconditions for the stable caller, not a receipt or a complete diagnostic report.
// In particular, hashes below do NOT prove that extracted headers came from the archive.
export const nativeLockBuildRequiredInputs = Object.freeze([
  "Authenticated stable/candidate revisions and consume-delete candidate source materialization.",
  "Official exact-Node distribution acquisition and retained authenticated SHASUMS256.txt.",
  "Verified archive extraction: complete entry census and entry-to-header byte equality.",
  "Complete reviewed stable fixture/build/loader file census in stableFiles.",
  "Captured hosted compiler/SDK identities and canonical absolute search directories; no candidate PATH.",
  "Exclusive runner-temp custody outside all source roots, retained until collection finishes.",
  "Coordinator must verify sole module architecture/ABI and identity/hash before and after actual load.",
  "loaded:null is build preparation only; coordinator must finish the diagnostic build records.",
]);

function closed(value, keys) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  )
    refuse();
}
function text(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) refuse();
}
function absolute(path) {
  text(path);
  if (!isAbsolute(path) || resolve(path) !== path) refuse();
}
function portable(path) {
  text(path);
  if (
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((x) => !x || x === "." || x === "..")
  )
    refuse();
}
function within(root, path) {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}
function reference(value, pathKind = absolute) {
  closed(value, ["path", "byteLength", "sha256"]);
  pathKind(value.path);
  if (!/^(0|[1-9][0-9]*)$/.test(value.byteLength) || !/^[0-9a-f]{64}$/.test(value.sha256)) refuse();
}
function identity(value) {
  return [
    value.dev,
    value.ino,
    value.mode,
    ...(value.isFile() ? [value.nlink, value.size, value.mtimeNs, value.ctimeNs] : []),
  ].join(":");
}

// Intentionally local to this helper: bounded input/output directories, no general file API.
function custody() {
  const identities = new Map();
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
    if (identities.has(path) && identities.get(path) !== observed) refuse();
    identities.set(path, observed);
    return value;
  }
  async function parents(path) {
    const paths = [];
    for (let current = dirname(path); ; current = dirname(current)) {
      paths.push(current);
      if (dirname(current) === current) break;
    }
    for (const parent of paths.reverse()) await inspect(parent, true);
  }
  async function bytes(path) {
    await parents(path);
    const before = await inspect(path, false);
    if (before.size > 256n * 1024n * 1024n) refuse();
    const handle = await open(path, "r");
    try {
      if (identity(await handle.stat({ bigint: true })) !== identity(before)) refuse();
      const value = await handle.readFile();
      if (identity(await handle.stat({ bigint: true })) !== identity(before)) refuse();
      await inspect(path, false);
      return value;
    } finally {
      await handle.close();
    }
  }
  async function verify() {
    for (const [path, expected] of identities) {
      const value = await lstat(path, { bigint: true });
      if (value.isSymbolicLink() || identity(value) !== expected || (await realpath(path)) !== path)
        refuse();
    }
  }
  return { bytes, parents, inspect, verify };
}

async function census(root, guard) {
  const paths = [];
  let count = 0;
  async function visit(directory, depth) {
    if (depth > 24 || ++count > 24000) refuse();
    await guard.inspect(directory, true);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++count > 24000 || entry.isSymbolicLink()) refuse();
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile()) paths.push(relative(root, path).split(sep).join("/"));
      else refuse();
    }
  }
  await visit(root, 0);
  return paths.sort();
}

function argumentsFor(platform, include, source, library, output) {
  if (platform === "linux")
    return [
      "-std=c11",
      "-O2",
      "-fPIC",
      "-shared",
      "-DNAPI_VERSION=8",
      "-I",
      include,
      source,
      "-o",
      output,
    ];
  if (platform === "darwin")
    return [
      "-std=c11",
      "-O2",
      "-fPIC",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-DNAPI_VERSION=8",
      "-I",
      include,
      source,
      "-o",
      output,
    ];
  return [
    "/nologo",
    "/TC",
    "/std:c11",
    "/O2",
    "/MD",
    "/LD",
    "/DNAPI_VERSION=8",
    `/I${include}`,
    source,
    library,
    "kernel32.lib",
    "/link",
    `/OUT:${output}`,
  ];
}

/** No native loading, installation, network, candidate hooks, or caller compiler flags. */
export async function buildNativeLockExperiment(request) {
  const node = Object.freeze({
    executablePath: process.execPath,
    version: process.version,
    modules: process.versions.modules,
    napi: process.versions.napi,
    architecture: process.arch,
    platform: process.platform,
  });
  const builds = roles.map((role, i) => ({
    role,
    revision: i === 0 ? request?.stableRevision : request?.candidateRevision,
    inputs: null,
    argv: null,
    toolchain: null,
    outputs: null,
    loaded: null,
    result: "UNKNOWN",
  }));
  const result = () => ({ node, builds });
  // Invalid revision/role binding is an invalid private call, not a fabricated report.
  for (const build of builds) if (!/^[0-9a-f]{40}$/.test(build.revision)) refuse();
  const guard = custody();
  const retained = [];
  const originals = [];
  try {
    closed(request, [
      "runnerTemp",
      "artifactRoot",
      "stableRoot",
      "candidateRoot",
      "stableRevision",
      "candidateRevision",
      "node",
      "stableSource",
      "candidateSource",
      "stableFiles",
      "distribution",
      "toolchain",
    ]);
    for (const key of ["runnerTemp", "artifactRoot", "stableRoot", "candidateRoot"])
      absolute(request[key]);
    if (
      within(request.stableRoot, request.candidateRoot) ||
      within(request.candidateRoot, request.stableRoot)
    )
      refuse();
    if (
      !within(request.runnerTemp, request.artifactRoot) ||
      request.runnerTemp === request.artifactRoot ||
      [request.stableRoot, request.candidateRoot].some(
        (root) => within(root, request.artifactRoot) || within(request.artifactRoot, root),
      )
    )
      refuse();
    closed(request.node, [...Object.keys(node), "byteLength", "sha256"]);
    for (const key of Object.keys(node)) if (node[key] !== request.node[key]) refuse();
    if (
      !/^v24\.[0-9]+\.[0-9]+$/.test(node.version) ||
      !/^[0-9]+$/.test(node.napi) ||
      Number(node.napi) < 8
    )
      refuse();
    if (!["linux", "darwin", "win32"].includes(node.platform)) {
      builds.forEach((build) => {
        build.result = "UNSUPPORTED";
      });
      return result();
    }
    for (const path of [request.runnerTemp, request.stableRoot, request.candidateRoot]) {
      await guard.parents(path);
      await guard.inspect(path, true);
    }
    await guard.parents(request.artifactRoot);
    await mkdir(request.artifactRoot); // EEXIST refuses even an empty reused directory.
    await guard.inspect(request.artifactRoot, true);
    async function retain(source, destination) {
      reference(source);
      portable(destination);
      const bytes = await guard.bytes(source.path);
      if (String(bytes.length) !== source.byteLength || digest(bytes) !== source.sha256) refuse();
      const path = resolve(request.artifactRoot, destination);
      await mkdir(dirname(path), { recursive: true });
      await guard.parents(path);
      await writeFile(path, bytes, { flag: "wx" });
      await guard.inspect(path, false);
      const entry = { path: destination, byteLength: String(bytes.length), sha256: digest(bytes) };
      retained.push(entry);
      originals.push(source);
      return bytes;
    }
    await retain(
      {
        path: node.executablePath,
        byteLength: request.node.byteLength,
        sha256: request.node.sha256,
      },
      `inputs/node/${basename(node.executablePath)}`,
    );
    if (
      !Array.isArray(request.stableFiles) ||
      request.stableFiles.length === 0 ||
      request.stableFiles.length > 128
    )
      refuse();
    const stablePaths = new Set();
    for (const file of request.stableFiles) {
      reference(file, portable);
      if (stablePaths.has(file.path)) refuse();
      stablePaths.add(file.path);
      await retain(
        { ...file, path: resolve(request.stableRoot, file.path) },
        `inputs/stable/${file.path}`,
      );
    }
    if (!stablePaths.has("scripts/build/native-lock-experiment.mjs")) refuse();
    const distribution = request.distribution;
    closed(distribution, ["archive", "shasums", "includeRoot", "headers", "importLibrary"]);
    absolute(distribution.includeRoot);
    const shasums = (
      await retain(distribution.shasums, "inputs/distribution/SHASUMS256.txt")
    ).toString("utf8");
    const archiveName = `node-${node.version}-headers.tar.gz`;
    if (basename(distribution.archive.path) !== archiveName) refuse();
    function checksum(name, expected) {
      const matches = shasums.split(/\r?\n/).filter((line) => line.slice(66) === name);
      if (
        matches.length !== 1 ||
        !/^[0-9a-f]{64}  .+$/.test(matches[0]) ||
        matches[0].slice(0, 64) !== expected
      )
        refuse();
    }
    checksum(archiveName, distribution.archive.sha256);
    await retain(distribution.archive, `inputs/distribution/${archiveName}`);
    if (!Array.isArray(distribution.headers) || distribution.headers.length > 12000) refuse();
    const headerNames = distribution.headers
      .map((file) => {
        reference(file, portable);
        return file.path;
      })
      .sort();
    if (
      new Set(headerNames).size !== headerNames.length ||
      JSON.stringify(headerNames) !== JSON.stringify(await census(distribution.includeRoot, guard))
    )
      refuse();
    for (const name of [
      "node_api.h",
      "node_api_types.h",
      "js_native_api.h",
      "js_native_api_types.h",
      "node_version.h",
    ])
      if (!headerNames.includes(name)) refuse();
    for (const file of distribution.headers) {
      const bytes = await retain(
        { ...file, path: resolve(distribution.includeRoot, file.path) },
        `inputs/headers/${file.path}`,
      );
      if (file.path === "node_version.h") {
        const version = node.version.slice(1).split(".");
        for (const [macro, expected] of [
          ["NODE_MAJOR_VERSION", version[0]],
          ["NODE_MINOR_VERSION", version[1]],
          ["NODE_PATCH_VERSION", version[2]],
          ["NODE_MODULE_VERSION", node.modules],
        ]) {
          const matches = [
            ...bytes
              .toString("utf8")
              .matchAll(new RegExp(`^#define[ \\t]+${macro}[ \\t]+([0-9]+)[ \\t]*\\r?$`, "gm")),
          ];
          if (matches.length !== 1 || matches[0][1] !== expected) refuse();
        }
      }
    }
    if (node.platform === "win32") {
      reference(distribution.importLibrary);
      checksum(`win-${node.architecture}/node.lib`, distribution.importLibrary.sha256);
      await retain(distribution.importLibrary, "inputs/distribution/node.lib");
    } else if (distribution.importLibrary !== null) refuse();
    const commonInputs = [...retained];
    for (const [i, source] of [request.stableSource, request.candidateSource].entries()) {
      reference(source);
      if (
        source.path !==
        resolve(
          i === 0 ? request.stableRoot : request.candidateRoot,
          `${sourcePrefix}${sourceNames[i]}`,
        )
      )
        refuse();
      await retain(source, `inputs/${roles[i]}/${sourceNames[i]}`);
      builds[i].inputs = sorted([...commonInputs, retained.at(-1)]);
    }
    async function finish() {
      await guard.verify();
      for (const file of [
        ...originals,
        ...retained.map((entry) => ({ ...entry, path: resolve(request.artifactRoot, entry.path) })),
      ]) {
        const bytes = await guard.bytes(file.path);
        if (String(bytes.length) !== file.byteLength || digest(bytes) !== file.sha256) refuse();
      }
      if (
        JSON.stringify(headerNames) !==
          JSON.stringify(await census(distribution.includeRoot, guard)) ||
        JSON.stringify(retained.map((file) => file.path).sort()) !==
          JSON.stringify(await census(request.artifactRoot, guard))
      )
        refuse();
      return result();
    }
    const toolchain = request.toolchain;
    if (toolchain === null) {
      builds.forEach((build) => {
        build.result = "UNSUPPORTED";
      });
      return await finish();
    }
    closed(toolchain, [
      "compilerPath",
      "compilerVersion",
      "sdkVersion",
      "path",
      "include",
      "lib",
      "sdkRoot",
      "systemRoot",
    ]);
    absolute(toolchain.compilerPath);
    if (
      [request.stableRoot, request.candidateRoot, request.artifactRoot].some((root) =>
        within(root, toolchain.compilerPath),
      )
    )
      refuse();
    text(toolchain.compilerVersion);
    text(toolchain.sdkVersion);
    for (const key of ["path", "include", "lib"]) {
      if (!Array.isArray(toolchain[key]) || toolchain[key].length > 64) refuse();
      for (const path of toolchain[key]) {
        absolute(path);
        if (path.includes(delimiter)) refuse();
      }
    }
    if (
      toolchain.path.length === 0 ||
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
    const directories = [
      ...toolchain.path,
      ...toolchain.include,
      ...toolchain.lib,
      ...[toolchain.sdkRoot, toolchain.systemRoot].filter((value) => value !== null),
    ];
    try {
      await guard.parents(toolchain.compilerPath);
      await guard.inspect(toolchain.compilerPath, false);
      for (const path of directories) {
        absolute(path);
        if (
          [request.stableRoot, request.candidateRoot, request.artifactRoot].some((root) =>
            within(root, path),
          )
        )
          refuse();
        await guard.parents(path);
        await guard.inspect(path, true);
      }
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error;
      builds.forEach((build) => {
        build.result = "UNSUPPORTED";
      });
      return await finish();
    }
    const environment = { PATH: toolchain.path.join(delimiter), LANG: "C", LC_ALL: "C" };
    if (node.platform === "win32")
      Object.assign(environment, {
        SystemRoot: toolchain.systemRoot,
        WINDIR: toolchain.systemRoot,
        INCLUDE: toolchain.include.join(delimiter),
        LIB: toolchain.lib.join(delimiter),
      });
    if (node.platform === "darwin") environment.SDKROOT = toolchain.sdkRoot;
    for (let i = 0; i < builds.length; i++) {
      const build = builds[i];
      const directory = resolve(request.artifactRoot, `builds/${build.role}`);
      await mkdir(dirname(directory), { recursive: true });
      await mkdir(directory);
      await guard.inspect(directory, true);
      const outputName = sourceNames[i].replace(/\.c$/, ".node");
      const output = resolve(directory, outputName);
      build.argv = argumentsFor(
        node.platform,
        resolve(request.artifactRoot, "inputs/headers"),
        resolve(request.artifactRoot, `inputs/${build.role}/${sourceNames[i]}`),
        node.platform === "win32"
          ? resolve(request.artifactRoot, "inputs/distribution/node.lib")
          : null,
        output,
      );
      build.toolchain = {
        compilerPath: toolchain.compilerPath,
        compilerVersion: toolchain.compilerVersion,
        sdkVersion: toolchain.sdkVersion,
      };
      await guard.verify();
      let success = false;
      let stdout = Buffer.alloc(0),
        stderr = Buffer.alloc(0);
      try {
        ({ stdout, stderr } = await execute(toolchain.compilerPath, build.argv, {
          cwd: directory,
          env: { ...environment, TMP: directory, TEMP: directory, TMPDIR: directory },
          shell: false,
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
          encoding: "buffer",
        }));
        success = true;
      } catch (error) {
        stdout = error.stdout ?? stdout;
        stderr = error.stderr ?? stderr;
        if (["ENOENT", "EACCES", "EPERM"].includes(error.code)) build.result = "UNSUPPORTED";
      }
      await guard.verify();
      await writeFile(resolve(directory, "compiler.stdout"), stdout, { flag: "wx" });
      await writeFile(resolve(directory, "compiler.stderr"), stderr, { flag: "wx" });
      const paths = await census(directory, guard);
      if (
        paths.some(
          (path) =>
            path.includes("/") ||
            (path !== outputName &&
              path !== "compiler.stdout" &&
              path !== "compiler.stderr" &&
              !(node.platform === "win32" && /\.(obj|lib|exp|pdb|ilk)$/.test(path))),
        )
      )
        refuse();
      build.outputs = [];
      for (const path of paths) {
        const bytes = await guard.bytes(resolve(directory, path));
        const entry = {
          path: `builds/${build.role}/${path}`,
          byteLength: String(bytes.length),
          sha256: digest(bytes),
        };
        build.outputs.push(entry);
        retained.push(entry);
      }
      if (
        success &&
        paths.includes(outputName) &&
        build.outputs.find((file) => file.path.endsWith(`/${outputName}`)).byteLength !== "0"
      )
        build.result = "BUILT";
    }
    return await finish();
  } catch {
    // Includes malformed data, changed custody, checksum mismatch, and actual compile failures.
    // Never turn an unclassified failure into a claim that this host lacks the primitive.
    builds.forEach((build) => {
      build.result = "UNKNOWN";
    });
    return result();
  }
}

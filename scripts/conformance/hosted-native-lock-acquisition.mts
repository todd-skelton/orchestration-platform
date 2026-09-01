import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { access, lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import { sha256Bytes } from "../../packages/conformance/src/index.js";

const maximumDownloadBytes = 32 * 1024 * 1024;
const unavailableCodes = new Set(["EACCES", "ENOENT", "EPERM"]);

export interface NativeLockCommandResult {
  readonly errorCode: string | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: Uint8Array;
  readonly stdout: Uint8Array;
}

export interface HostedNativeLockAcquisitionBoundary {
  readonly execute: (
    executablePath: string,
    argv: readonly string[],
    options: Readonly<{ cwd: string; env: Readonly<Record<string, string>> }>,
  ) => Promise<NativeLockCommandResult>;
  readonly fetch: (url: string) => Promise<Response>;
  readonly resolveExecutable: (
    name: string,
    searchDirectories: readonly string[],
  ) => Promise<NativeLockExecutableLookup>;
}

export type NativeLockExecutableLookup =
  | { readonly state: "FOUND"; readonly path: string }
  | {
      readonly state: "UNAVAILABLE" | "UNKNOWN";
      readonly errorCode: string;
    };

export interface HostedNativeLockAcquisitionInput {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly root: string;
}

export type HostedNativeLockAcquisitionResult =
  | {
      readonly ok: true;
      readonly state: "AVAILABLE";
      readonly archivePath: string;
      readonly capturePath: string;
      readonly importLibraryPath: string | null;
      readonly retainedFiles: readonly Readonly<{
        path: string;
        byteLength: string;
        sha256: string;
      }>[];
      readonly shasumsPath: string;
    }
  | {
      readonly ok: true;
      readonly state: "UNSUPPORTED" | "UNKNOWN";
      readonly reason: string;
      readonly retainedFiles: readonly Readonly<{
        path: string;
        byteLength: string;
        sha256: string;
      }>[];
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): HostedNativeLockAcquisitionResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function absolute(path: unknown): path is string {
  return (
    typeof path === "string" && !path.includes("\0") && isAbsolute(path) && resolve(path) === path
  );
}

function splitDirectories(value: string | undefined): readonly string[] | undefined {
  if (!value) return undefined;
  const values = value.split(delimiter);
  if (
    values.length === 0 ||
    values.length > 128 ||
    values.some((path) => !absolute(path)) ||
    new Set(values).size !== values.length
  )
    return undefined;
  return Object.freeze(values);
}

function reference(path: string, bytes: Uint8Array) {
  return Object.freeze({
    byteLength: String(bytes.byteLength),
    path,
    sha256: sha256Bytes(bytes),
  });
}

async function defaultResolveExecutable(
  name: string,
  searchDirectories: readonly string[],
): Promise<NativeLockExecutableLookup> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { state: "UNKNOWN", errorCode: "EINVAL" };
  let unavailableCode = "ENOENT";
  for (const directory of searchDirectories) {
    const candidate = resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      const canonical = await realpath(candidate);
      const identity = await lstat(canonical, { bigint: true });
      if (
        !absolute(canonical) ||
        canonical !== candidate ||
        !identity.isFile() ||
        identity.isSymbolicLink()
      )
        return { state: "UNKNOWN", errorCode: "ESTALE" };
      return { state: "FOUND", path: canonical };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      if (code === "EACCES" || code === "EPERM") {
        unavailableCode = code;
        continue;
      }
      return { state: "UNKNOWN", errorCode: code ?? "EIO" };
    }
  }
  return { state: "UNAVAILABLE", errorCode: unavailableCode };
}

const defaultBoundary: HostedNativeLockAcquisitionBoundary = Object.freeze({
  fetch: async (url: string) => await fetch(url, { redirect: "error" }),
  resolveExecutable: defaultResolveExecutable,
  async execute(
    executablePath: string,
    argv: readonly string[],
    options: Readonly<{ cwd: string; env: Readonly<Record<string, string>> }>,
  ) {
    const { execFile } = await import("node:child_process");
    return await new Promise<NativeLockCommandResult>((accept) => {
      execFile(
        executablePath,
        [...argv],
        {
          cwd: options.cwd,
          encoding: "buffer",
          env: options.env,
          maxBuffer: 8 * 1024 * 1024,
          shell: false,
          timeout: 30_000,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const failure = error as NodeJS.ErrnoException & {
            code?: string | number;
            signal?: NodeJS.Signals;
          };
          accept(
            Object.freeze({
              errorCode:
                error && typeof failure.code === "string" && !/^[0-9]+$/.test(failure.code)
                  ? failure.code
                  : null,
              exitCode: error && typeof failure.code === "number" ? failure.code : error ? null : 0,
              signal: error && failure.signal ? failure.signal : null,
              stderr: Uint8Array.from(stderr),
              stdout: Uint8Array.from(stdout),
            }),
          );
        },
      );
    });
  },
});

function commandEnvironment(
  root: string,
  systemRoot: string | null,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    LANG: "C",
    LC_ALL: "C",
    TEMP: root,
    TMP: root,
    TMPDIR: root,
  };
  if (systemRoot) {
    environment.SystemRoot = systemRoot;
    environment.WINDIR = systemRoot;
  }
  return Object.freeze(environment);
}

async function responseBytes(
  response: Response,
  expectedUrl: string,
): Promise<Uint8Array | undefined> {
  if (
    !response.ok ||
    response.status !== 200 ||
    response.redirected ||
    response.url !== expectedUrl ||
    !response.body
  )
    return undefined;
  const length = response.headers.get("content-length");
  let declared: number | null = null;
  if (length !== null) {
    declared = Number(length);
    if (
      !/^(0|[1-9][0-9]*)$/.test(length) ||
      !Number.isSafeInteger(declared) ||
      declared > maximumDownloadBytes
    )
      return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const row = await reader.read();
      if (row.done) break;
      if (!(row.value instanceof Uint8Array)) return undefined;
      total += row.value.byteLength;
      if (total > maximumDownloadBytes || (declared !== null && total > declared)) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(Uint8Array.from(row.value));
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
  }
  if (total === 0 || (declared !== null && total !== declared)) return undefined;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function acquireDistribution(
  root: string,
  boundary: HostedNativeLockAcquisitionBoundary,
  retain: (path: string, bytes: Uint8Array) => Promise<string>,
) {
  const base = `https://nodejs.org/dist/${process.version}`;
  const archiveName = `node-${process.version}-headers.tar.gz`;
  const rows: Array<readonly [string, string]> = [
    ["SHASUMS256.txt", `${base}/SHASUMS256.txt`],
    [archiveName, `${base}/${archiveName}`],
  ];
  if (process.platform === "win32") rows.push(["node.lib", `${base}/win-${process.arch}/node.lib`]);
  const paths = new Map<string, string>();
  for (const [name, url] of rows) {
    let response: Response;
    try {
      response = await boundary.fetch(url);
    } catch {
      return { state: "UNKNOWN" as const, reason: `distribution:${name}:fetch` };
    }
    if (response.status === 404)
      return { state: "UNSUPPORTED" as const, reason: `distribution:${name}:missing` };
    const bytes = await responseBytes(response, url);
    if (!bytes) return { state: "UNKNOWN" as const, reason: `distribution:${name}:response` };
    paths.set(name, await retain(`distribution/${name}`, bytes));
  }
  return {
    state: "AVAILABLE" as const,
    archivePath: paths.get(archiveName)!,
    importLibraryPath: paths.get("node.lib") ?? null,
    shasumsPath: paths.get("SHASUMS256.txt")!,
  };
}

async function canonicalDirectory(path: string): Promise<boolean> {
  try {
    const identity = await lstat(path, { bigint: true });
    return identity.isDirectory() && !identity.isSymbolicLink() && (await realpath(path)) === path;
  } catch {
    return false;
  }
}

async function canonicalFile(path: string): Promise<boolean> {
  try {
    const identity = await lstat(path, { bigint: true });
    return identity.isFile() && !identity.isSymbolicLink() && (await realpath(path)) === path;
  } catch {
    return false;
  }
}

function boundedVersion(...streams: readonly Uint8Array[]): string | undefined {
  const text = Buffer.concat(streams.map((value) => Buffer.from(value))).toString("utf8");
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line && line.length <= 1024 && !line.includes("\0") ? line : undefined;
}

function identityStamp(value: BigIntStats, directory = false): string {
  const base = [value.dev, value.ino, value.mode];
  return (
    directory
      ? [...base, value.mtimeNs, value.ctimeNs]
      : [...base, value.nlink, value.size, value.mtimeNs, value.ctimeNs]
  ).join(":");
}

const ownerStamp = (value: Awaited<ReturnType<typeof lstat>>) =>
  [value.dev, value.ino, value.mode].join(":");

async function sealRetainedTree(
  root: string,
  rootStamp: string,
  expected: ReadonlyMap<string, Readonly<{ path: string; byteLength: string; sha256: string }>>,
): Promise<boolean> {
  const observed = new Set<string>();
  const directoryStamps = new Map<string, string>();
  let entries = 0;
  async function visit(directory: string, depth: number): Promise<boolean> {
    if (depth > 8 || ++entries > 64) return false;
    const before = await lstat(directory, { bigint: true });
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      return false;
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const child of children) {
      if (++entries > 64 || child.isSymbolicLink()) return false;
      const path = resolve(directory, child.name);
      if (child.isDirectory()) {
        const prefix = `${relative(root, path).split(sep).join("/")}/`;
        if (![...expected.keys()].some((name) => name.startsWith(prefix))) return false;
        if (!(await visit(path, depth + 1))) return false;
        continue;
      }
      if (!child.isFile()) return false;
      const name = relative(root, path).split(sep).join("/");
      const row = expected.get(name);
      if (!row || observed.has(name)) return false;
      const fileBefore = await lstat(path, { bigint: true });
      if (
        !fileBefore.isFile() ||
        fileBefore.isSymbolicLink() ||
        fileBefore.nlink !== 1n ||
        (await realpath(path)) !== path
      )
        return false;
      const bytes = Uint8Array.from(await readFile(path));
      const fileAfter = await lstat(path, { bigint: true });
      if (
        identityStamp(fileBefore) !== identityStamp(fileAfter) ||
        String(bytes.byteLength) !== row.byteLength ||
        sha256Bytes(bytes) !== row.sha256
      )
        return false;
      observed.add(name);
    }
    const after = await lstat(directory, { bigint: true });
    const stamp = identityStamp(after, true);
    if (identityStamp(before, true) !== stamp) return false;
    directoryStamps.set(directory, stamp);
    return true;
  }
  if (!(await visit(root, 0))) return false;
  for (const [directory, stamp] of directoryStamps) {
    const current = await lstat(directory, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      (await realpath(directory)) !== directory ||
      identityStamp(current, true) !== stamp
    )
      return false;
  }
  return (
    ownerStamp(await lstat(root, { bigint: true })) === rootStamp && observed.size === expected.size
  );
}

async function captureToolchain(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
  boundary: HostedNativeLockAcquisitionBoundary,
  retain: (path: string, bytes: Uint8Array) => Promise<string>,
) {
  const searchDirectories = splitDirectories(environment.PATH ?? environment.Path);
  if (
    !searchDirectories ||
    !(await Promise.all(searchDirectories.map(canonicalDirectory))).every(Boolean)
  )
    return { state: "UNKNOWN" as const, reason: "toolchain:path" };
  const systemRoot = process.platform === "win32" ? (environment.SystemRoot ?? null) : null;
  if (systemRoot !== null && (!absolute(systemRoot) || !(await canonicalDirectory(systemRoot))))
    return { state: "UNKNOWN" as const, reason: "toolchain:system-root" };
  const commandEnv = commandEnvironment(root, systemRoot);
  const observations: Record<string, unknown>[] = [];

  const resolveLookup = async (name: string): Promise<NativeLockExecutableLookup> => {
    try {
      const result = await boundary.resolveExecutable(name, searchDirectories);
      if (
        !result ||
        (result.state === "FOUND"
          ? !absolute(result.path)
          : !["UNAVAILABLE", "UNKNOWN"].includes(result.state) ||
            typeof result.errorCode !== "string" ||
            !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.errorCode))
      )
        return { state: "UNKNOWN", errorCode: "EINVAL" };
      if (result.state === "FOUND" && !(await canonicalFile(result.path)))
        return { state: "UNKNOWN", errorCode: "ESTALE" };
      if (result.state === "UNAVAILABLE" && !unavailableCodes.has(result.errorCode))
        return { state: "UNKNOWN", errorCode: result.errorCode };
      if (result.state === "UNKNOWN" && unavailableCodes.has(result.errorCode))
        return { state: "UNKNOWN", errorCode: "EIO" };
      return result;
    } catch {
      return { state: "UNKNOWN", errorCode: "EIO" };
    }
  };

  const lookup = async (
    purpose: "COMPILER" | "SDK",
    result: NativeLockExecutableLookup,
    sdkDirectory = false,
  ) => {
    const selectedPath =
      result.state === "FOUND" ? (sdkDirectory ? dirname(result.path) : result.path) : null;
    observations.push({
      errorCode: result.state === "FOUND" ? null : result.errorCode,
      kind: "LOOKUP",
      purpose,
      searchDirectories,
      selectedPath,
    });
    return result.state === "FOUND" ? result.path : null;
  };

  const run = async (
    purpose: "COMPILER" | "SDK",
    executablePath: string,
    argv: readonly string[],
  ) => {
    let result: NativeLockCommandResult;
    if (!(await canonicalFile(executablePath))) {
      result = {
        errorCode: "ESTALE",
        exitCode: null,
        signal: null,
        stderr: new Uint8Array(),
        stdout: new Uint8Array(),
      };
    } else {
      result = await boundary.execute(executablePath, argv, { cwd: root, env: commandEnv });
      if (!(await canonicalFile(executablePath)))
        result = { ...result, errorCode: "ESTALE", exitCode: null, signal: null };
    }
    const stdoutPath = await retain(`toolchain/${purpose.toLowerCase()}.stdout`, result.stdout);
    const stderrPath = await retain(`toolchain/${purpose.toLowerCase()}.stderr`, result.stderr);
    observations.push({
      argv,
      cwd: root,
      errorCode: result.errorCode,
      executablePath,
      exitCode: result.exitCode === null ? null : String(result.exitCode),
      kind: "COMMAND",
      purpose,
      signal: result.signal,
      stderr: reference(`toolchain/${purpose.toLowerCase()}.stderr`, result.stderr),
      stdout: reference(`toolchain/${purpose.toLowerCase()}.stdout`, result.stdout),
    });
    return { ...result, stderrPath, stdoutPath };
  };

  let toolchain: Record<string, unknown> | null = null;
  if (process.platform === "linux") {
    const compilerLookup = await resolveLookup("cc");
    const compiler = compilerLookup.state === "FOUND" ? compilerLookup.path : null;
    if (!compiler) {
      await lookup("COMPILER", compilerLookup);
      await lookup("SDK", compilerLookup);
    } else {
      const compilerResult = await run("COMPILER", compiler, ["--version"]);
      const sdkResult = await run("SDK", compiler, ["-v"]);
      const compilerVersion = boundedVersion(compilerResult.stdout, compilerResult.stderr);
      const sdkVersion = boundedVersion(sdkResult.stdout, sdkResult.stderr);
      if (
        compilerResult.exitCode === 0 &&
        sdkResult.exitCode === 0 &&
        compilerResult.errorCode === null &&
        sdkResult.errorCode === null &&
        compilerVersion &&
        sdkVersion
      )
        toolchain = {
          compilerPath: compiler,
          compilerVersion,
          include: [],
          lib: [],
          path: [dirname(compiler)],
          sdkRoot: null,
          sdkVersion,
          systemRoot: null,
        };
    }
  } else if (process.platform === "darwin") {
    const compilerLookup = await resolveLookup("clang");
    const sdkLookup = await resolveLookup("xcrun");
    const compiler = compilerLookup.state === "FOUND" ? compilerLookup.path : null;
    const xcrun = sdkLookup.state === "FOUND" ? sdkLookup.path : null;
    if (!compiler || !xcrun) {
      await lookup("COMPILER", compilerLookup);
      await lookup("SDK", sdkLookup, true);
    } else {
      const compilerResult = await run("COMPILER", compiler, ["--version"]);
      const sdkResult = await run("SDK", xcrun, ["--show-sdk-path"]);
      const sdkRootInput = Buffer.from(sdkResult.stdout).toString("utf8").trim();
      const sdkRoot = absolute(sdkRootInput) ? await realpath(sdkRootInput).catch(() => "") : "";
      const compilerVersion = boundedVersion(compilerResult.stdout, compilerResult.stderr);
      const sdkVersion = basename(sdkRoot);
      if (
        compilerResult.exitCode === 0 &&
        sdkResult.exitCode === 0 &&
        compilerResult.errorCode === null &&
        sdkResult.errorCode === null &&
        compilerVersion &&
        absolute(sdkRoot) &&
        (await canonicalDirectory(sdkRoot)) &&
        /^MacOSX[0-9]+(?:\.[0-9]+){0,3}\.sdk$/.test(sdkVersion) &&
        sdkVersion.length <= 1024
      )
        toolchain = {
          compilerPath: compiler,
          compilerVersion,
          include: [],
          lib: [],
          path: [...new Set([dirname(compiler), dirname(xcrun)])],
          sdkRoot,
          sdkVersion,
          systemRoot: null,
        };
    }
  } else if (process.platform === "win32") {
    const compilerLookup = await resolveLookup("cl.exe");
    const compiler = compilerLookup.state === "FOUND" ? compilerLookup.path : null;
    const include = splitDirectories(environment.INCLUDE);
    const lib = splitDirectories(environment.LIB);
    const sdkVersion = environment.WindowsSDKVersion?.replace(/[\\/]$/, "") ?? "";
    const directoriesValid =
      include &&
      lib &&
      (await Promise.all([...include, ...lib].map(canonicalDirectory))).every(Boolean);
    const sdkAvailable = Boolean(
      directoriesValid && systemRoot && /^[0-9]+(?:\.[0-9]+){2,4}$/.test(sdkVersion),
    );
    if (!compiler || !sdkAvailable) {
      await lookup("COMPILER", compilerLookup);
      observations.push({
        errorCode: sdkAvailable ? null : "ENOENT",
        kind: "LOOKUP",
        purpose: "SDK",
        searchDirectories: lib ?? searchDirectories,
        selectedPath: sdkAvailable ? lib![0] : null,
      });
    } else {
      const windowsInclude = include!;
      const windowsLib = lib!;
      const compilerResult = await run("COMPILER", compiler, ["/Bv", "/?"]);
      const compilerVersion = boundedVersion(compilerResult.stdout, compilerResult.stderr);
      observations.push({
        errorCode: null,
        kind: "LOOKUP",
        purpose: "SDK",
        searchDirectories: windowsLib,
        selectedPath: windowsLib[0],
      });
      if (compilerResult.exitCode === 0 && compilerResult.errorCode === null && compilerVersion)
        toolchain = {
          compilerPath: compiler,
          compilerVersion,
          include: windowsInclude,
          lib: windowsLib,
          path: [dirname(compiler)],
          sdkRoot: null,
          sdkVersion,
          systemRoot,
        };
    }
  } else return { state: "UNSUPPORTED" as const, reason: "toolchain:platform" };

  const unavailable = observations.some(
    (value) => value.errorCode && unavailableCodes.has(String(value.errorCode)),
  );
  const state = toolchain ? "AVAILABLE" : unavailable ? "UNAVAILABLE" : "UNKNOWN";
  const capture = {
    architecture: process.arch,
    nodeVersion: process.version,
    observations,
    platform: process.platform,
    state,
    toolchain,
  };
  const capturePath = await retain(
    "capture.json",
    new TextEncoder().encode(`${canonicalJson(capture)}\n`),
  );
  return state === "AVAILABLE"
    ? { state: "AVAILABLE" as const, capturePath }
    : {
        state: state === "UNAVAILABLE" ? ("UNSUPPORTED" as const) : ("UNKNOWN" as const),
        reason: `toolchain:${state.toLowerCase()}`,
        capturePath,
      };
}

export async function acquireHostedNativeLockInputs(
  input: HostedNativeLockAcquisitionInput,
  boundary: HostedNativeLockAcquisitionBoundary = defaultBoundary,
): Promise<HostedNativeLockAcquisitionResult> {
  const retained = new Map<
    string,
    Readonly<{ path: string; byteLength: string; sha256: string }>
  >();
  try {
    if (
      !absolute(input.root) ||
      !input.environment ||
      typeof input.environment !== "object" ||
      !/^v24\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/.test(process.version)
    )
      return refusal("native-lock-acquisition:input-refused");
    const identity = await lstat(input.root, { bigint: true });
    if (
      !identity.isDirectory() ||
      identity.isSymbolicLink() ||
      (await realpath(input.root)) !== input.root
    )
      return refusal("native-lock-acquisition:root-refused");
    if ((await readdir(input.root)).length !== 0)
      return refusal("native-lock-acquisition:root-not-empty");
    const rootStamp = ownerStamp(identity);
    const retain = async (path: string, bytes: Uint8Array) => {
      if (
        !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
        retained.has(path) ||
        bytes.byteLength > maximumDownloadBytes
      )
        throw new TypeError("native-lock-acquisition:retain-refused");
      const destination = resolve(input.root, ...path.split("/"));
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      const fileIdentity = await lstat(destination, { bigint: true });
      const readBack = Uint8Array.from(await readFile(destination));
      if (
        !fileIdentity.isFile() ||
        fileIdentity.isSymbolicLink() ||
        fileIdentity.nlink !== 1n ||
        (await realpath(destination)) !== destination ||
        readBack.byteLength !== bytes.byteLength ||
        sha256Bytes(readBack) !== sha256Bytes(bytes)
      )
        throw new TypeError("native-lock-acquisition:write-readback-refused");
      retained.set(path, reference(path, readBack));
      return destination;
    };
    const distribution = await acquireDistribution(input.root, boundary, retain);
    const toolchain = await captureToolchain(input.root, input.environment, boundary, retain);
    const retainedFiles = Object.freeze(
      [...retained.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    );
    if (!(await sealRetainedTree(input.root, rootStamp, retained)))
      return refusal("native-lock-acquisition:census-refused");
    if (distribution.state !== "AVAILABLE")
      return { ok: true, state: distribution.state, reason: distribution.reason, retainedFiles };
    if (toolchain.state !== "AVAILABLE")
      return { ok: true, state: toolchain.state, reason: toolchain.reason, retainedFiles };
    return Object.freeze({
      ok: true,
      state: "AVAILABLE",
      archivePath: distribution.archivePath,
      capturePath: toolchain.capturePath,
      importLibraryPath: distribution.importLibraryPath,
      retainedFiles,
      shasumsPath: distribution.shasumsPath,
    });
  } catch {
    return refusal("native-lock-acquisition:unreadable");
  }
}

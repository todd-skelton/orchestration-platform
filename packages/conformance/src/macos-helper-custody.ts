import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, rm, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { types as nodeTypes } from "node:util";

const sudoPath = "/usr/bin/sudo";
const xcrunPath = "/usr/bin/xcrun";
const chownPath = "/usr/sbin/chown";
const dsclPath = "/usr/bin/dscl";
const dscacheutilPath = "/usr/bin/dscacheutil";
const lsPath = "/bin/ls";
const statPath = "/usr/bin/stat";
const intentPrefix = "macos-helper-intent-";
const nativeHostPlatform = process.platform;
const maximumOutputBytes = 1024 * 1024;
const commandTimeoutMilliseconds = 30_000;

export interface MacosHelperCommandRequest {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly file: string;
  readonly inputText: string;
}

export interface MacosHelperCommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface MacosHelperFileProfile {
  readonly ctimeNanoseconds: string;
  readonly device: string;
  readonly gid: string;
  readonly inode: string;
  readonly linkCount: string;
  readonly mode: string;
  readonly sha256: string;
  readonly size: string;
  readonly uid: string;
}

export interface MacosHelperCustodyOptions {
  readonly authorityRoot: string;
  readonly helperRoot: string;
  readonly helperSourcePath: string;
  readonly runtimePath: string;
  readonly stateRoot: string;
}

export interface MacosHelperCustody {
  readonly clangPath: string;
  readonly dscacheutilPath: string;
  readonly dsclPath: string;
  readonly helperPath: string;
  readonly runtimePath: string;
  readonly sudoPath: string;
  close(): Promise<void>;
  requireCustody(): Promise<void>;
}

interface MacosHelperCustodyDependencies {
  readonly architecture: "arm64" | "x86_64";
  readonly chmodRetained: (handle: FileHandle, mode: number) => Promise<void>;
  readonly commandRunner: (request: MacosHelperCommandRequest) => Promise<unknown>;
  readonly directorySecurityReader: (path: string) => Promise<unknown>;
  readonly fileSecurityReader: (path: string) => Promise<unknown>;
  readonly hostPlatform: string;
  readonly nodeMajor: number;
  readonly profileReader: (
    path: string,
    owner: "ROOT" | "STABLE",
  ) => Promise<MacosHelperFileProfile>;
  readonly retainDirectory: (path: string) => Promise<FileHandle>;
  readonly retainFile: (path: string) => Promise<FileHandle>;
  readonly resolveClangPath: (path: string) => Promise<string>;
  readonly stableGid: number;
  readonly stableUid: number;
  readonly syncDirectory: (path: string) => Promise<void>;
  readonly token: () => string;
  readonly unlinkRetained: (
    path: string,
    handle: FileHandle,
    profile: MacosHelperFileProfile,
  ) => Promise<void>;
  readonly verifyArchitecture: (path: string, architecture: "arm64" | "x86_64") => Promise<void>;
  readonly verifyRetainedProfile: (
    handle: FileHandle,
    profile: MacosHelperFileProfile,
  ) => Promise<void>;
}

interface MacosDirectorySecurity {
  readonly aclEntries: number;
  readonly flags: string;
}

interface MacosCommandRunnerDependencies {
  readonly delay: (milliseconds: number) => Promise<unknown>;
  readonly groupSignal: (processGroup: number, signal: NodeJS.Signals | 0) => void;
  readonly spawnChild: typeof spawn;
  readonly timeoutMilliseconds: number;
}

class MacosCustodyLostError extends TypeError {}
class MacosNonterminalCommandError extends TypeError {}

interface BuildIntent {
  readonly helperName: string;
  readonly helperPath: string;
  readonly intentPath: string;
  readonly profile: MacosHelperFileProfile | undefined;
  readonly stage:
    "BUILD" | "MODE" | "MODE_PROFILE" | "OUTPUT" | "OWNER" | "ROOT_PROFILE" | "UNLINK_PROVED";
}

function below(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

type NativeIdentity = Pick<BigIntStats, "dev" | "gid" | "ino" | "mode" | "uid">;

function detachedIdentity(identity: BigIntStats): NativeIdentity {
  return Object.freeze({
    dev: identity.dev,
    gid: identity.gid,
    ino: identity.ino,
    mode: identity.mode,
    uid: identity.uid,
  });
}

function sameDirectoryIdentity(left: NativeIdentity, right: NativeIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultDirectorySecurityReader(path: string): Promise<MacosDirectorySecurity> {
  const statResult = detachedResult(
    await nativeCommandRunner({
      arguments: ["-f", "%HT|%f", path],
      cwd: path,
      file: statPath,
      inputText: "",
    }),
  );
  const lsResult = detachedResult(
    await nativeCommandRunner({
      arguments: ["-lde", path],
      cwd: path,
      file: lsPath,
      inputText: "",
    }),
  );
  if (
    !statResult ||
    statResult.exitCode !== 0 ||
    statResult.signal !== null ||
    statResult.stderr !== "" ||
    !/^Directory\|[0-9a-f]+\n$/.test(statResult.stdout) ||
    Number.parseInt(statResult.stdout.slice("Directory|".length, -1), 16) !== 0 ||
    !lsResult ||
    lsResult.exitCode !== 0 ||
    lsResult.signal !== null ||
    lsResult.stderr !== "" ||
    lsResult.stdout.split("\n").length !== 2 ||
    !/^drwx------[ @]/.test(lsResult.stdout) ||
    lsResult.stdout[10] === "+"
  )
    throw new TypeError("macos-helper:directory-security-refused");
  return Object.freeze({ aclEntries: 0, flags: "0" });
}

async function defaultFileSecurityReader(path: string): Promise<MacosDirectorySecurity> {
  const statResult = detachedResult(
    await nativeCommandRunner({
      arguments: ["-f", "%HT|%f", path],
      cwd: resolve(path, ".."),
      file: statPath,
      inputText: "",
    }),
  );
  const lsResult = detachedResult(
    await nativeCommandRunner({
      arguments: ["-le", path],
      cwd: resolve(path, ".."),
      file: lsPath,
      inputText: "",
    }),
  );
  if (
    !statResult ||
    statResult.exitCode !== 0 ||
    statResult.signal !== null ||
    statResult.stderr !== "" ||
    !/^Regular File\|[0-9a-f]+\n$/.test(statResult.stdout) ||
    Number.parseInt(statResult.stdout.slice("Regular File|".length, -1), 16) !== 0 ||
    !lsResult ||
    lsResult.exitCode !== 0 ||
    lsResult.signal !== null ||
    lsResult.stderr !== "" ||
    lsResult.stdout.split("\n").length !== 2 ||
    !/^-[rwx-]{9}[ @]/.test(lsResult.stdout) ||
    lsResult.stdout[10] === "+"
  )
    throw new TypeError("macos-helper:file-security-refused");
  return Object.freeze({ aclEntries: 0, flags: "0" });
}

function detachedDirectorySecurity(input: unknown): MacosDirectorySecurity | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== "aclEntries\0flags") return undefined;
  const aclEntries = descriptors.aclEntries;
  const flags = descriptors.flags;
  if (
    !aclEntries ||
    !("value" in aclEntries) ||
    aclEntries.enumerable !== true ||
    aclEntries.value !== 0 ||
    !flags ||
    !("value" in flags) ||
    flags.enumerable !== true ||
    flags.value !== "0"
  )
    return undefined;
  return Object.freeze({ aclEntries: 0, flags: "0" });
}

async function defaultVerifyArchitecture(
  path: string,
  architecture: "arm64" | "x86_64",
): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const header = Buffer.alloc(8);
    const read = await handle.read(header, 0, header.length, 0);
    if (read.bytesRead !== header.length || header.readUInt32LE(0) !== 0xfeedfacf)
      throw new TypeError("macos-helper:macho-refused");
    const expectedCpu = architecture === "arm64" ? 0x0100000c : 0x01000007;
    if (header.readUInt32LE(4) !== expectedCpu)
      throw new TypeError("macos-helper:architecture-refused");
  } finally {
    await handle.close();
  }
}

async function defaultProfileReader(
  path: string,
  owner: "ROOT" | "STABLE",
): Promise<MacosHelperFileProfile> {
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    throw new TypeError("macos-helper:file-alias-refused");
  const before = await lstat(path, { bigint: true });
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    const expectedUid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !opened.isFile() ||
      !sameDirectoryIdentity(before, opened) ||
      opened.uid !== expectedUid ||
      (opened.mode & 0o22n) !== 0n
    )
      throw new TypeError("macos-helper:file-profile-refused");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameDirectoryIdentity(opened, after) || opened.size !== after.size)
      throw new TypeError("macos-helper:file-moved");
    return Object.freeze({
      ctimeNanoseconds: String(after.ctimeNs),
      device: String(after.dev),
      gid: String(after.gid),
      inode: String(after.ino),
      linkCount: String(after.nlink),
      mode: String(after.mode),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: String(after.size),
      uid: String(after.uid),
    });
  } finally {
    await handle.close();
  }
}

async function defaultRetainFile(path: string): Promise<FileHandle> {
  return await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
}

async function defaultRetainDirectory(path: string): Promise<FileHandle> {
  return await open(
    path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
}

async function defaultVerifyRetainedProfile(
  handle: FileHandle,
  profile: MacosHelperFileProfile,
): Promise<void> {
  const identity = await handle.stat({ bigint: true });
  if (
    !identity.isFile() ||
    String(identity.ctimeNs) !== profile.ctimeNanoseconds ||
    String(identity.dev) !== profile.device ||
    String(identity.gid) !== profile.gid ||
    String(identity.ino) !== profile.inode ||
    String(identity.nlink) !== profile.linkCount ||
    String(identity.mode) !== profile.mode ||
    String(identity.size) !== profile.size ||
    String(identity.uid) !== profile.uid
  )
    throw new MacosCustodyLostError("macos-helper:retained-file-moved");
}

async function defaultUnlinkRetained(
  path: string,
  handle: FileHandle,
  profile: MacosHelperFileProfile,
): Promise<void> {
  await defaultVerifyRetainedProfile(handle, profile);
  const current = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const entry = await current.stat({ bigint: true });
    if (
      String(entry.dev) !== profile.device ||
      String(entry.ino) !== profile.inode ||
      String(entry.nlink) !== "1"
    )
      throw new MacosCustodyLostError("macos-helper:unlink-entry-moved");
    try {
      await rm(path, { force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } finally {
    await current.close();
  }
  const unlinked = await handle.stat({ bigint: true });
  if (
    !unlinked.isFile() ||
    String(unlinked.dev) !== profile.device ||
    String(unlinked.ino) !== profile.inode ||
    String(unlinked.gid) !== profile.gid ||
    String(unlinked.mode) !== profile.mode ||
    String(unlinked.nlink) !== "0" ||
    String(unlinked.size) !== profile.size ||
    String(unlinked.uid) !== profile.uid
  )
    throw new MacosCustodyLostError("macos-helper:post-unlink-refused");
}

function detachedProfile(input: unknown): MacosHelperFileProfile | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = [
    "ctimeNanoseconds",
    "device",
    "gid",
    "inode",
    "linkCount",
    "mode",
    "sha256",
    "size",
    "uid",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== [...fields].sort().join("\0"))
    return undefined;
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string" ||
      (field === "sha256"
        ? !/^[a-f0-9]{64}$/.test(descriptor.value)
        : !/^(?:0|[1-9][0-9]*)$/.test(descriptor.value))
    )
      return undefined;
    values[field] = descriptor.value;
  }
  return Object.freeze({ ...values }) as unknown as MacosHelperFileProfile;
}

function sameProfile(left: MacosHelperFileProfile, right: MacosHelperFileProfile): boolean {
  return (Object.keys(left) as (keyof MacosHelperFileProfile)[]).every(
    (field) => left[field] === right[field],
  );
}

async function runMacosHelperCommandCore(
  request: MacosHelperCommandRequest,
  dependencies: MacosCommandRunnerDependencies,
): Promise<MacosHelperCommandResult> {
  return await new Promise((complete) => {
    const child = dependencies.spawnChild(request.file, [...request.arguments], {
      cwd: request.cwd,
      detached: true,
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let timedOut = false;
    let outputLimited = false;
    let spawnFailed = false;
    let terminationRequested = false;

    function terminateGroup(): void {
      if (terminationRequested) return;
      terminationRequested = true;
      try {
        dependencies.groupSignal(-child.pid!, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") spawnFailed = true;
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateGroup();
    }, dependencies.timeoutMilliseconds);
    child.stdout.on("data", (chunk: Uint8Array) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength > maximumOutputBytes) {
        outputLimited = true;
        terminateGroup();
      } else stdout.push(Uint8Array.from(chunk));
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderrLength += chunk.byteLength;
      if (stderrLength > maximumOutputBytes) {
        outputLimited = true;
        terminateGroup();
      } else stderr.push(Uint8Array.from(chunk));
    });
    child.once("error", () => {
      spawnFailed = true;
      terminateGroup();
    });
    child.once("close", async (exitCode, signal) => {
      clearTimeout(timer);
      let groupAbsent = child.pid === undefined;
      let unexpectedDescendant = false;
      if (child.pid !== undefined) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            dependencies.groupSignal(-child.pid, 0);
            unexpectedDescendant = true;
            terminationRequested = true;
            dependencies.groupSignal(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") {
              groupAbsent = true;
              break;
            }
            spawnFailed = true;
          }
          await dependencies.delay(50);
        }
      }
      complete({
        exitCode,
        signal: !groupAbsent
          ? "TERMINATION_FAILED"
          : timedOut
            ? "TIMEOUT"
            : outputLimited
              ? "OUTPUT_LIMIT"
              : unexpectedDescendant
                ? "UNEXPECTED_DESCENDANT"
                : spawnFailed
                  ? "SPAWN_ERROR"
                  : signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.end(request.inputText);
  });
}

async function nativeCommandRunner(
  request: MacosHelperCommandRequest,
): Promise<MacosHelperCommandResult> {
  return await runMacosHelperCommandCore(request, {
    delay,
    groupSignal: (processGroup, signal) => process.kill(processGroup, signal),
    spawnChild: spawn,
    timeoutMilliseconds: commandTimeoutMilliseconds,
  });
}

function detachedResult(input: unknown): MacosHelperCommandResult | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = ["exitCode", "signal", "stderr", "stdout"] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== [...fields].sort().join("\0"))
    return undefined;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values[field] = descriptor.value;
  }
  if (
    !(values.exitCode === null || Number.isInteger(values.exitCode)) ||
    !(values.signal === null || typeof values.signal === "string") ||
    typeof values.stderr !== "string" ||
    typeof values.stdout !== "string" ||
    Buffer.byteLength(values.stderr, "utf8") > maximumOutputBytes ||
    Buffer.byteLength(values.stdout, "utf8") > maximumOutputBytes
  )
    return undefined;
  return Object.freeze({ ...values }) as unknown as MacosHelperCommandResult;
}

function canonicalProfile(profile: MacosHelperFileProfile): string {
  return JSON.stringify({
    ctimeNanoseconds: profile.ctimeNanoseconds,
    device: profile.device,
    gid: profile.gid,
    inode: profile.inode,
    linkCount: profile.linkCount,
    mode: profile.mode,
    sha256: profile.sha256,
    size: profile.size,
    uid: profile.uid,
  });
}

function parseProfileLine(line: string, prefix: string): MacosHelperFileProfile | undefined {
  if (!line.startsWith(prefix)) return undefined;
  const text = line.slice(prefix.length);
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  const profile = detachedProfile(input);
  return profile && canonicalProfile(profile) === text ? profile : undefined;
}

function parseIntent(text: string, stateRoot: string, helperRoot: string): BuildIntent | undefined {
  if (!text.endsWith("\n")) return undefined;
  const lines = text.slice(0, -1).split("\n");
  const unlinkProved = lines.at(-1) === "UNLINK_PROVED";
  if (unlinkProved) lines.pop();
  if (lines.length < 2 || lines.length > 7 || lines[1] !== "BUILD") return undefined;
  let input: unknown;
  try {
    input = JSON.parse(lines[0]!) as unknown;
  } catch {
    return undefined;
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "helperName\0helperPath") return undefined;
  if (
    typeof record.helperName !== "string" ||
    !/^macos-principal-helper-[a-f0-9]{16}$/.test(record.helperName) ||
    typeof record.helperPath !== "string"
  )
    return undefined;
  const helperPath = resolve(record.helperPath);
  const intentPath = resolve(stateRoot, `${intentPrefix}${record.helperName}.json`);
  if (
    record.helperPath !== helperPath ||
    helperPath !== resolve(helperRoot, record.helperName) ||
    !below(helperRoot, helperPath) ||
    JSON.stringify({ helperName: record.helperName, helperPath: record.helperPath }) !== lines[0]
  )
    return undefined;
  let profile: MacosHelperFileProfile | undefined;
  let stage: BuildIntent["stage"] = "BUILD";
  if (lines.length >= 3) {
    profile = parseProfileLine(lines[2]!, "OUTPUT:");
    if (!profile) return undefined;
    stage = "OUTPUT";
  }
  if (lines.length >= 4) {
    if (lines[3] !== "MODE") return undefined;
    stage = "MODE";
  }
  if (lines.length >= 5) {
    profile = parseProfileLine(lines[4]!, "MODE_PROFILE:");
    if (!profile) return undefined;
    stage = "MODE_PROFILE";
  }
  if (lines.length >= 6) {
    if (lines[5] !== "OWNER") return undefined;
    stage = "OWNER";
  }
  if (lines.length >= 7) {
    profile = parseProfileLine(lines[6]!, "ROOT_PROFILE:");
    if (!profile) return undefined;
    stage = "ROOT_PROFILE";
  }
  return Object.freeze({
    helperName: record.helperName,
    helperPath,
    intentPath,
    profile,
    stage: unlinkProved ? "UNLINK_PROVED" : stage,
  });
}

async function createMacosHelperCustodyCore(
  options: MacosHelperCustodyOptions,
  dependencies: MacosHelperCustodyDependencies,
): Promise<MacosHelperCustody> {
  if (dependencies.hostPlatform !== "darwin")
    throw new TypeError("macos-helper:unsupported-platform");
  if (dependencies.stableUid <= 0 || dependencies.stableGid <= 0)
    throw new TypeError("macos-helper:stable-unprivileged-required");
  if (dependencies.nodeMajor !== 24) throw new TypeError("macos-helper:node-24-required");
  const authorityRoot = await realpath(resolve(options.authorityRoot));
  const stateRoot = await realpath(resolve(options.stateRoot));
  const helperRoot = await realpath(resolve(options.helperRoot));
  const helperSourcePath = await realpath(resolve(options.helperSourcePath));
  const runtimePath = await realpath(resolve(options.runtimePath));
  if (stateRoot === helperRoot || below(stateRoot, helperRoot) || below(helperRoot, stateRoot))
    throw new TypeError("macos-helper:root-separation-refused");
  if (
    !below(authorityRoot, stateRoot) ||
    !below(authorityRoot, helperRoot) ||
    !below(authorityRoot, helperSourcePath) ||
    !below(authorityRoot, runtimePath)
  )
    throw new TypeError("macos-helper:authority-root-refused");
  const directoryPaths = new Set<string>([authorityRoot]);
  for (const target of [
    stateRoot,
    helperRoot,
    resolve(helperSourcePath, ".."),
    resolve(runtimePath, ".."),
  ]) {
    if (target === authorityRoot) continue;
    let current = authorityRoot;
    for (const component of relative(authorityRoot, target).split(sep)) {
      current = resolve(current, component);
      if ((await realpath(current)) !== current)
        throw new TypeError("macos-helper:directory-alias-refused");
      directoryPaths.add(current);
    }
  }
  const directoryIdentities = new Map<
    string,
    { readonly handle: FileHandle; readonly identity: NativeIdentity }
  >();
  const retainedFiles = new Set<FileHandle>();
  try {
    for (const path of directoryPaths) {
      const identity = await lstat(path, { bigint: true });
      if (
        !identity.isDirectory() ||
        identity.isSymbolicLink() ||
        identity.uid !== BigInt(dependencies.stableUid) ||
        identity.gid !== BigInt(dependencies.stableGid) ||
        (identity.mode & 0o7777n) !== 0o700n
      )
        throw new TypeError("macos-helper:private-root-refused");
      const handle = await dependencies.retainDirectory(path);
      let retained: BigIntStats;
      try {
        retained = await handle.stat({ bigint: true });
      } catch (error) {
        await handle.close();
        throw error;
      }
      if (!sameDirectoryIdentity(identity, retained)) {
        await handle.close();
        throw new TypeError("macos-helper:private-root-refused");
      }
      directoryIdentities.set(path, { handle, identity: detachedIdentity(identity) });
    }
    const readProfile = dependencies.profileReader;
    const run = dependencies.commandRunner;
    const profiles = new Map<
      string,
      {
        readonly handle: FileHandle;
        readonly owner: "ROOT" | "STABLE";
        readonly profile: MacosHelperFileProfile;
      }
    >();

    async function capture(path: string, owner: "ROOT" | "STABLE"): Promise<void> {
      if (profiles.has(path)) throw new TypeError("macos-helper:file-alias-refused");
      const profile = detachedProfile(await readProfile(path, owner));
      if (!profile || profile.linkCount !== "1")
        throw new TypeError("macos-helper:file-profile-refused");
      if (
        [...profiles.values()].some(
          (existing) =>
            existing.profile.device === profile.device && existing.profile.inode === profile.inode,
        )
      )
        throw new TypeError("macos-helper:file-alias-refused");
      const handle = await dependencies.retainFile(path);
      try {
        await dependencies.verifyRetainedProfile(handle, profile);
      } catch (error) {
        await handle.close();
        throw error;
      }
      retainedFiles.add(handle);
      profiles.set(path, { handle, owner, profile });
    }

    for (const path of [
      sudoPath,
      xcrunPath,
      chownPath,
      dsclPath,
      dscacheutilPath,
      lsPath,
      statPath,
    ])
      await capture(path, "ROOT");
    await capture(runtimePath, "STABLE");
    await capture(helperSourcePath, "STABLE");

    async function requireProfileAt(path: string): Promise<void> {
      const expected = profiles.get(path);
      if (!expected) throw new TypeError("macos-helper:file-profile-refused");
      await dependencies.verifyRetainedProfile(expected.handle, expected.profile);
      const observed = detachedProfile(await readProfile(path, expected.owner));
      if (!observed || !sameProfile(expected.profile, observed))
        throw new MacosCustodyLostError("macos-helper:file-moved");
      await dependencies.verifyRetainedProfile(expected.handle, expected.profile);
    }

    async function requireInspectionTools(): Promise<void> {
      await requireProfileAt(lsPath);
      await requireProfileAt(statPath);
    }

    async function requireRoots(): Promise<void> {
      await requireInspectionTools();
      for (const [path, retained] of directoryIdentities) {
        const openedBefore = await retained.handle.stat({ bigint: true });
        const current = await lstat(path, { bigint: true });
        if (
          !sameDirectoryIdentity(retained.identity, openedBefore) ||
          !sameDirectoryIdentity(retained.identity, current)
        )
          throw new MacosCustodyLostError("macos-helper:private-root-moved");
        if (!detachedDirectorySecurity(await dependencies.directorySecurityReader(path)))
          throw new MacosCustodyLostError("macos-helper:directory-security-refused");
        const openedAfter = await retained.handle.stat({ bigint: true });
        const currentAfter = await lstat(path, { bigint: true });
        if (
          !sameDirectoryIdentity(retained.identity, openedAfter) ||
          !sameDirectoryIdentity(retained.identity, currentAfter)
        )
          throw new MacosCustodyLostError("macos-helper:private-root-moved");
      }
      await requireInspectionTools();
    }

    async function requireProfiles(skipPath?: string): Promise<void> {
      await requireRoots();
      for (const [path, expected] of profiles) {
        if (path === skipPath) continue;
        await dependencies.verifyRetainedProfile(expected.handle, expected.profile);
        const observed = detachedProfile(await readProfile(path, expected.owner));
        if (!observed || !sameProfile(expected.profile, observed))
          throw new MacosCustodyLostError("macos-helper:file-moved");
        await dependencies.verifyRetainedProfile(expected.handle, expected.profile);
        if (
          path === runtimePath ||
          path === helperSourcePath ||
          path.startsWith(`${helperRoot}${sep}`)
        )
          await requireFileSecurity(path);
      }
    }

    async function requireFileSecurity(path: string): Promise<void> {
      await requireInspectionTools();
      if (!detachedDirectorySecurity(await dependencies.fileSecurityReader(path)))
        throw new MacosCustodyLostError("macos-helper:file-security-refused");
      await requireInspectionTools();
    }

    async function requireHelperRootEntries(expectedNames: readonly string[]): Promise<void> {
      const entries = await readdir(helperRoot, { withFileTypes: true });
      const names = entries.map((entry) => entry.name).sort();
      if (
        entries.some((entry) => !entry.isFile()) ||
        names.join("\0") !== [...expectedNames].sort().join("\0")
      )
        throw new TypeError("macos-helper:helper-root-census-refused");
    }

    async function closeDirectoryHandles(): Promise<void> {
      const issues: unknown[] = [];
      for (const retained of directoryIdentities.values())
        try {
          await retained.handle.close();
        } catch (error) {
          issues.push(error);
        }
      if (issues.length !== 0) throw new TypeError("macos-helper:directory-handle-close-refused");
    }

    async function closeRetainedFiles(): Promise<void> {
      const issues: unknown[] = [];
      for (const handle of retainedFiles)
        try {
          await handle.close();
          retainedFiles.delete(handle);
        } catch (error) {
          issues.push(error);
        }
      if (issues.length !== 0) throw new TypeError("macos-helper:file-handle-close-refused");
    }

    async function closeHandles(): Promise<void> {
      await closeRetainedFiles();
      await closeDirectoryHandles();
    }

    async function exactCommand(
      file: string,
      arguments_: readonly string[],
      expectedStdout: string,
      mutatedPath?: string,
    ): Promise<void> {
      await requireProfiles();
      const result = detachedResult(
        await run({ arguments: arguments_, cwd: helperRoot, file, inputText: "" }),
      );
      await requireProfiles(mutatedPath);
      if (result?.signal === "TERMINATION_FAILED")
        throw new MacosNonterminalCommandError("macos-helper:command-nonterminal");
      if (
        !result ||
        result.exitCode !== 0 ||
        result.signal !== null ||
        result.stderr !== "" ||
        result.stdout !== expectedStdout
      )
        throw new TypeError("macos-helper:command-refused");
    }

    await requireProfiles();
    const runtimeResult = detachedResult(
      await run({ arguments: ["--version"], cwd: helperRoot, file: runtimePath, inputText: "" }),
    );
    await requireProfiles();
    if (runtimeResult?.signal === "TERMINATION_FAILED")
      throw new MacosNonterminalCommandError("macos-helper:runtime-nonterminal");
    if (
      !runtimeResult ||
      runtimeResult.exitCode !== 0 ||
      runtimeResult.signal !== null ||
      runtimeResult.stderr !== "" ||
      !/^v24\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\n$/.test(runtimeResult.stdout)
    )
      throw new TypeError("macos-helper:runtime-node-24-refused");

    await requireProfiles();
    const clangResult = detachedResult(
      await run({
        arguments: ["--find", "clang"],
        cwd: helperRoot,
        file: xcrunPath,
        inputText: "",
      }),
    );
    await requireProfiles();
    if (clangResult?.signal === "TERMINATION_FAILED")
      throw new MacosNonterminalCommandError("macos-helper:command-nonterminal");
    if (
      !clangResult ||
      clangResult.exitCode !== 0 ||
      clangResult.signal !== null ||
      clangResult.stderr !== "" ||
      !/^\/[\x21-\x7e]+\n$/.test(clangResult.stdout)
    )
      throw new TypeError("macos-helper:clang-resolution-refused");
    const clangPath = await dependencies.resolveClangPath(clangResult.stdout.slice(0, -1));
    if (!isAbsolute(clangPath)) throw new TypeError("macos-helper:clang-resolution-refused");
    await capture(clangPath, "ROOT");

    async function removeIntent(intent: BuildIntent): Promise<void> {
      try {
        await rm(intent.intentPath, { force: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await dependencies.syncDirectory(stateRoot);
      try {
        await lstat(intent.intentPath);
        throw new TypeError("macos-helper:intent-removal-refused");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    async function appendIntentLine(
      intent: BuildIntent,
      expectedStage: BuildIntent["stage"],
      line: string,
    ): Promise<void> {
      const handle = await open(
        intent.intentPath,
        constants.O_APPEND | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const identity = await handle.stat({ bigint: true });
        if (
          !identity.isFile() ||
          identity.uid !== BigInt(dependencies.stableUid) ||
          identity.gid !== BigInt(dependencies.stableGid) ||
          (identity.mode & 0o7777n) !== 0o600n ||
          identity.size > 4096n
        )
          throw new TypeError("macos-helper:intent-profile-refused");
        const current = parseIntent(await handle.readFile("utf8"), stateRoot, helperRoot);
        if (!current || current.intentPath !== intent.intentPath || current.stage !== expectedStage)
          throw new TypeError("macos-helper:intent-transition-refused");
        await handle.writeFile(`${line}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    }

    function sameOutputCore(left: MacosHelperFileProfile, right: MacosHelperFileProfile): boolean {
      return (
        left.device === right.device &&
        left.inode === right.inode &&
        left.linkCount === "1" &&
        right.linkCount === "1" &&
        left.sha256 === right.sha256 &&
        left.size === right.size
      );
    }

    async function readRecoveryProfile(
      path: string,
      owner: "ROOT" | "STABLE",
    ): Promise<{ readonly handle: FileHandle; readonly profile: MacosHelperFileProfile }> {
      const profile = detachedProfile(await readProfile(path, owner));
      if (!profile || profile.linkCount !== "1")
        throw new TypeError("macos-helper:recovery-output-refused");
      const handle = await dependencies.retainFile(path);
      try {
        await dependencies.verifyRetainedProfile(handle, profile);
      } catch (error) {
        await handle.close();
        throw error;
      }
      return { handle, profile };
    }

    async function requireRecoverableOutput(
      intent: BuildIntent,
    ): Promise<{ readonly handle: FileHandle; readonly profile: MacosHelperFileProfile }> {
      if (intent.stage === "BUILD") {
        const retained = await readRecoveryProfile(intent.helperPath, "STABLE");
        const identity = await retained.handle.stat({ bigint: true });
        if (
          !identity.isFile() ||
          identity.uid !== BigInt(dependencies.stableUid) ||
          identity.gid !== BigInt(dependencies.stableGid)
        )
          throw new TypeError("macos-helper:recovery-output-refused");
        return retained;
      }
      if (!intent.profile) throw new TypeError("macos-helper:recovery-output-refused");
      if (intent.stage === "OUTPUT" || intent.stage === "MODE") {
        const retained = await readRecoveryProfile(intent.helperPath, "STABLE");
        const observed = retained.profile;
        if (
          !sameProfile(intent.profile, observed) &&
          !(
            intent.stage === "MODE" &&
            sameOutputCore(intent.profile, observed) &&
            observed.uid === String(dependencies.stableUid) &&
            observed.gid === String(dependencies.stableGid) &&
            (BigInt(observed.mode) & 0o7777n) === 0o500n
          )
        )
          throw new TypeError("macos-helper:recovery-output-refused");
        return retained;
      }
      if (intent.stage === "MODE_PROFILE") {
        const retained = await readRecoveryProfile(intent.helperPath, "STABLE");
        const observed = retained.profile;
        if (!sameProfile(intent.profile, observed))
          throw new TypeError("macos-helper:recovery-output-refused");
        return retained;
      }
      if (intent.stage === "ROOT_PROFILE") {
        const retained = await readRecoveryProfile(intent.helperPath, "ROOT");
        const observed = retained.profile;
        if (!sameProfile(intent.profile, observed))
          throw new TypeError("macos-helper:recovery-output-refused");
        return retained;
      }
      let retained: { readonly handle: FileHandle; readonly profile: MacosHelperFileProfile };
      try {
        retained = await readRecoveryProfile(intent.helperPath, "STABLE");
      } catch {
        retained = await readRecoveryProfile(intent.helperPath, "ROOT");
      }
      const observed = retained.profile;
      if (
        !sameOutputCore(intent.profile, observed) ||
        (BigInt(observed.mode) & 0o7777n) !== 0o500n ||
        ![`${dependencies.stableUid}:${dependencies.stableGid}`, "0:0"].includes(
          `${observed.uid}:${observed.gid}`,
        )
      )
        throw new TypeError("macos-helper:recovery-output-refused");
      return retained;
    }

    async function readIntent(intentPath: string): Promise<BuildIntent> {
      const handle = await open(intentPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const identity = await handle.stat({ bigint: true });
        if (
          !identity.isFile() ||
          identity.uid !== BigInt(dependencies.stableUid) ||
          identity.gid !== BigInt(dependencies.stableGid) ||
          (identity.mode & 0o7777n) !== 0o600n ||
          identity.size > 4096n
        )
          throw new TypeError("macos-helper:intent-profile-refused");
        const parsed = parseIntent(await handle.readFile("utf8"), stateRoot, helperRoot);
        if (!parsed || parsed.intentPath !== intentPath)
          throw new TypeError("macos-helper:intent-refused");
        return parsed;
      } finally {
        await handle.close();
      }
    }

    const unlinkProved = new Set<string>();

    async function reverse(intent: BuildIntent): Promise<void> {
      let retained:
        { readonly handle: FileHandle; readonly profile: MacosHelperFileProfile } | undefined;
      try {
        let currentIntent: BuildIntent | undefined;
        try {
          currentIntent = await readIntent(intent.intentPath);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" ||
            !unlinkProved.has(intent.intentPath)
          )
            throw error;
        }
        if (currentIntent?.stage === "UNLINK_PROVED") unlinkProved.add(intent.intentPath);
        else if (currentIntent) {
          try {
            retained = await requireRecoverableOutput(currentIntent);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            if (currentIntent.stage !== "BUILD" && !unlinkProved.has(intent.intentPath))
              throw new MacosCustodyLostError("macos-helper:output-absence-unproved");
          }
          if (retained) {
            await dependencies.verifyRetainedProfile(retained.handle, retained.profile);
            await requireRoots();
            await dependencies.unlinkRetained(intent.helperPath, retained.handle, retained.profile);
            unlinkProved.add(intent.intentPath);
          }
        }
        await dependencies.syncDirectory(helperRoot);
        try {
          await lstat(intent.helperPath);
          throw new TypeError("macos-helper:output-removal-refused");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await requireHelperRootEntries([]);
        if (
          currentIntent &&
          currentIntent.stage !== "BUILD" &&
          currentIntent.stage !== "UNLINK_PROVED"
        ) {
          if (!unlinkProved.has(intent.intentPath))
            throw new MacosCustodyLostError("macos-helper:unlink-proof-refused");
          await appendIntentLine(currentIntent, currentIntent.stage, "UNLINK_PROVED");
        }
        await removeIntent(intent);
      } finally {
        if (retained) await retained.handle.close();
      }
    }

    await requireProfiles();
    await dependencies.syncDirectory(stateRoot);
    const entries = await readdir(stateRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith(intentPrefix)) continue;
      if (!entry.isFile() || !entry.name.endsWith(".json"))
        throw new TypeError("macos-helper:intent-census-refused");
      const intentPath = resolve(stateRoot, entry.name);
      await reverse(await readIntent(intentPath));
    }
    await dependencies.syncDirectory(helperRoot);
    if ((await readdir(helperRoot)).length !== 0)
      throw new TypeError("macos-helper:helper-root-census-refused");

    const principalToken = dependencies.token();
    if (!/^[a-f0-9]{16}$/.test(principalToken)) throw new TypeError("macos-helper:token-refused");
    const helperName = `macos-principal-helper-${principalToken}`;
    const helperPath = resolve(helperRoot, helperName);
    const intentPath = resolve(stateRoot, `${intentPrefix}${helperName}.json`);
    if (!below(helperRoot, helperPath) || !below(stateRoot, intentPath))
      throw new TypeError("macos-helper:path-refused");
    const intent = Object.freeze({
      helperName,
      helperPath,
      intentPath,
      profile: undefined,
      stage: "BUILD" as const,
    });
    const intentHandle = await open(
      intentPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await intentHandle.writeFile(
        `${JSON.stringify({ helperName, helperPath })}\nBUILD\n`,
        "utf8",
      );
      await intentHandle.sync();
    } finally {
      await intentHandle.close();
    }
    await dependencies.syncDirectory(stateRoot);

    let closed = false;
    let closing = false;
    try {
      await exactCommand(
        clangPath,
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-arch",
          dependencies.architecture,
          helperSourcePath,
          "-o",
          helperPath,
        ],
        "",
      );
      await requireHelperRootEntries([helperName]);
      await dependencies.verifyArchitecture(helperPath, dependencies.architecture);
      await requireFileSecurity(helperPath);
      await capture(helperPath, "STABLE");
      const stableEntry = profiles.get(helperPath);
      if (!stableEntry) throw new TypeError("macos-helper:output-profile-refused");
      const stableOutput = stableEntry.profile;
      await appendIntentLine(intent, "BUILD", `OUTPUT:${canonicalProfile(stableOutput)}`);
      await appendIntentLine(intent, "OUTPUT", "MODE");
      await dependencies.chmodRetained(stableEntry.handle, 0o500);
      await stableEntry.handle.sync();
      await dependencies.syncDirectory(helperRoot);
      await requireFileSecurity(helperPath);
      const modeProfile = detachedProfile(await readProfile(helperPath, "STABLE"));
      if (
        !modeProfile ||
        !sameOutputCore(stableOutput, modeProfile) ||
        modeProfile.uid !== String(dependencies.stableUid) ||
        modeProfile.gid !== String(dependencies.stableGid) ||
        (BigInt(modeProfile.mode) & 0o7777n) !== 0o500n
      )
        throw new TypeError("macos-helper:mode-output-refused");
      await dependencies.verifyRetainedProfile(stableEntry.handle, modeProfile);
      profiles.set(helperPath, {
        handle: stableEntry.handle,
        owner: "STABLE",
        profile: modeProfile,
      });
      await appendIntentLine(intent, "MODE", `MODE_PROFILE:${canonicalProfile(modeProfile)}`);
      await appendIntentLine(intent, "MODE_PROFILE", "OWNER");
      await exactCommand(sudoPath, ["-n", "--", chownPath, "0:0", helperPath], "", helperPath);
      await dependencies.verifyArchitecture(helperPath, dependencies.architecture);
      await requireFileSecurity(helperPath);
      const outputProfile = detachedProfile(await readProfile(helperPath, "ROOT"));
      if (
        !outputProfile ||
        outputProfile.uid !== "0" ||
        outputProfile.gid !== "0" ||
        (BigInt(outputProfile.mode) & 0o7777n) !== 0o500n ||
        !sameOutputCore(modeProfile, outputProfile)
      )
        throw new TypeError("macos-helper:root-output-refused");
      await dependencies.verifyRetainedProfile(stableEntry.handle, outputProfile);
      await appendIntentLine(intent, "OWNER", `ROOT_PROFILE:${canonicalProfile(outputProfile)}`);
      profiles.set(helperPath, {
        handle: stableEntry.handle,
        owner: "ROOT",
        profile: outputProfile,
      });
      await requireHelperRootEntries([helperName]);

      return Object.freeze({
        clangPath,
        dscacheutilPath,
        dsclPath,
        helperPath,
        runtimePath,
        sudoPath,
        async close() {
          if (closed) throw new TypeError("macos-helper:close-reuse-refused");
          if (!closing) {
            await requireProfiles();
            closing = true;
          }
          await reverse(intent);
          profiles.delete(helperPath);
          await closeHandles();
          closed = true;
        },
        async requireCustody() {
          if (closed) throw new TypeError("macos-helper:closed");
          if (closing) throw new TypeError("macos-helper:closing");
          await dependencies.verifyArchitecture(helperPath, dependencies.architecture);
          await requireProfiles();
        },
      });
    } catch (error) {
      if (error instanceof MacosNonterminalCommandError || error instanceof MacosCustodyLostError) {
        await closeHandles();
        throw error;
      }
      try {
        await reverse(intent);
      } catch {
        await closeHandles();
        throw new TypeError("macos-helper:build-reversal-refused");
      }
      profiles.delete(helperPath);
      await closeHandles();
      throw error;
    }
  } catch (error) {
    for (const handle of retainedFiles)
      try {
        await handle.close();
      } catch {}
    for (const retained of directoryIdentities.values())
      try {
        await retained.handle.close();
      } catch {}
    throw error;
  }
}

export async function createMacosHelperCustody(
  options: MacosHelperCustodyOptions,
): Promise<MacosHelperCustody> {
  if (nativeHostPlatform !== "darwin") throw new TypeError("macos-helper:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("macos-helper:posix-identities-required");
  const architecture =
    process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : undefined;
  if (!architecture) throw new TypeError("macos-helper:architecture-refused");
  return await createMacosHelperCustodyCore(options, {
    architecture,
    chmodRetained: async (handle, mode) => await handle.chmod(mode),
    commandRunner: nativeCommandRunner,
    directorySecurityReader: defaultDirectorySecurityReader,
    fileSecurityReader: defaultFileSecurityReader,
    hostPlatform: nativeHostPlatform,
    nodeMajor: Number.parseInt(process.versions.node.split(".", 1)[0]!, 10),
    profileReader: defaultProfileReader,
    retainDirectory: defaultRetainDirectory,
    retainFile: defaultRetainFile,
    resolveClangPath: realpath,
    stableGid: process.getgid(),
    stableUid: process.getuid(),
    syncDirectory,
    token: () => randomBytes(8).toString("hex"),
    unlinkRetained: defaultUnlinkRetained,
    verifyArchitecture: defaultVerifyArchitecture,
    verifyRetainedProfile: defaultVerifyRetainedProfile,
  });
}

export async function createMacosHelperCustodyTestFixture(
  options: MacosHelperCustodyOptions,
  dependencies: MacosHelperCustodyDependencies,
): Promise<MacosHelperCustody> {
  return await createMacosHelperCustodyCore(options, dependencies);
}

export async function runMacosHelperCommandTestFixture(
  request: MacosHelperCommandRequest,
  dependencies: MacosCommandRunnerDependencies,
): Promise<MacosHelperCommandResult> {
  return await runMacosHelperCommandCore(request, dependencies);
}

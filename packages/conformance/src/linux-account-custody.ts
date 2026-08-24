import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { types as nodeTypes } from "node:util";

const sudoPath = "/usr/bin/sudo";
const pythonPath = "/usr/bin/python3";
const intentPrefix = "linux-principal-intent-";
const usedPrefix = "linux-principal-used-";
const nativeHostPlatform = process.platform;

export interface LinuxAccountCommandRequest {
  readonly arguments: readonly string[];
  readonly file: string;
  readonly inputText: string;
}

export interface LinuxAccountCommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface LinuxHelperProfile {
  readonly ctimeNanoseconds: string;
  readonly device: string;
  readonly gid: string;
  readonly inode: string;
  readonly mode: string;
  readonly size: string;
  readonly uid: string;
}

export interface LinuxAccountCustodyOptions {
  readonly accountHelperPath: string;
  readonly commandRunner?: (request: LinuxAccountCommandRequest) => Promise<unknown>;
  readonly principalToken?: () => string;
  readonly profileReader?: (path: string, owner: "ROOT" | "STABLE") => Promise<LinuxHelperProfile>;
  readonly stateRoot: string;
}

export interface LinuxAccountPrincipal {
  readonly gid: string;
  readonly intentPath: string;
  readonly name: string;
  readonly uid: string;
}

export interface LinuxAccountCustody {
  createPrincipal(): Promise<LinuxAccountPrincipal>;
  deletePrincipal(principal: LinuxAccountPrincipal): Promise<void>;
  recover(): Promise<void>;
}

function below(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid
  );
}

async function defaultProfileReader(
  path: string,
  owner: "ROOT" | "STABLE",
): Promise<LinuxHelperProfile> {
  const identity = await lstat(path, { bigint: true });
  const expectedUid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
  if (
    !identity.isFile() ||
    identity.isSymbolicLink() ||
    identity.uid !== expectedUid ||
    (identity.mode & 0o22n) !== 0n
  )
    throw new TypeError("linux-account:helper-profile-refused");
  return Object.freeze({
    ctimeNanoseconds: String(identity.ctimeNs),
    device: String(identity.dev),
    gid: String(identity.gid),
    inode: String(identity.ino),
    mode: String(identity.mode),
    size: String(identity.size),
    uid: String(identity.uid),
  });
}

function sameProfile(left: LinuxHelperProfile, right: LinuxHelperProfile): boolean {
  return (Object.keys(left) as (keyof LinuxHelperProfile)[]).every(
    (field) => left[field] === right[field],
  );
}

function detachedProfile(input: unknown): LinuxHelperProfile | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = ["ctimeNanoseconds", "device", "gid", "inode", "mode", "size", "uid"] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const profile: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(descriptor.value)
    )
      return undefined;
    profile[field] = descriptor.value;
  }
  return Object.freeze({ ...profile }) as unknown as LinuxHelperProfile;
}

async function nativeCommandRunner(
  request: LinuxAccountCommandRequest,
): Promise<LinuxAccountCommandResult> {
  return await new Promise((complete, reject) => {
    const child = spawn(request.file, [...request.arguments], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    child.stdout.on("data", (chunk: Uint8Array) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength > 1024 * 1024) child.kill("SIGKILL");
      else stdout.push(Uint8Array.from(chunk));
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderrLength += chunk.byteLength;
      if (stderrLength > 1024 * 1024) child.kill("SIGKILL");
      else stderr.push(Uint8Array.from(chunk));
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) =>
      complete({
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      }),
    );
    child.stdin.end(request.inputText);
  });
}

function detachedResult(input: unknown): LinuxAccountCommandResult | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["exitCode", "signal", "stderr", "stdout"] as const;
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== [...fields].sort().join("\0"))
    return undefined;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values[field] = descriptor.value;
  }
  if (
    !(values.exitCode === null || typeof values.exitCode === "number") ||
    !(values.signal === null || typeof values.signal === "string") ||
    typeof values.stderr !== "string" ||
    typeof values.stdout !== "string"
  )
    return undefined;
  return Object.freeze({ ...values }) as unknown as LinuxAccountCommandResult;
}

function parseIntent(input: unknown): Omit<LinuxAccountPrincipal, "intentPath"> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "gid\0name\0uid") return undefined;
  if (
    typeof record.gid !== "string" ||
    typeof record.name !== "string" ||
    typeof record.uid !== "string" ||
    !/^orch6-[a-f0-9]{16}$/.test(record.name) ||
    !/^[1-9][0-9]*$/.test(record.uid) ||
    !/^[1-9][0-9]*$/.test(record.gid)
  )
    return undefined;
  const token = record.name.slice("orch6-".length);
  const numeric = BigInt(`0x${token}`);
  if (
    record.uid !== String(1_000_000n + (numeric % 500_000_000n)) ||
    record.gid !== String(1_100_000_000n + (numeric % 500_000_000n))
  )
    return undefined;
  return Object.freeze({ gid: record.gid, name: record.name, uid: record.uid });
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

interface LinuxAccountCustodyDependencies {
  readonly stableGid: number;
  readonly stableUid: number;
  readonly syncStateDirectory: (path: string) => Promise<void>;
}

async function createLinuxAccountCustodyCore(
  options: LinuxAccountCustodyOptions,
  dependencies: LinuxAccountCustodyDependencies,
): Promise<LinuxAccountCustody> {
  const { stableGid, stableUid } = dependencies;
  if (stableUid <= 0 || stableGid <= 0)
    throw new TypeError("linux-account:stable-unprivileged-required");
  const stateRoot = await realpath(resolve(options.stateRoot));
  const stateIdentity = await lstat(stateRoot, { bigint: true });
  if (
    !stateIdentity.isDirectory() ||
    stateIdentity.isSymbolicLink() ||
    stateIdentity.uid !== BigInt(stableUid) ||
    (stateIdentity.mode & 0o77n) !== 0n
  )
    throw new TypeError("linux-account:state-root-refused");
  const accountHelperPath = await realpath(resolve(options.accountHelperPath));
  const readProfile = options.profileReader ?? defaultProfileReader;
  const profiles = new Map<string, LinuxHelperProfile>();
  for (const [path, owner] of [
    [sudoPath, "ROOT"],
    [pythonPath, "ROOT"],
    [accountHelperPath, "STABLE"],
  ] as const) {
    const profile = detachedProfile(await readProfile(path, owner));
    if (!profile) throw new TypeError("linux-account:helper-profile-refused");
    profiles.set(path, profile);
  }
  const run = options.commandRunner ?? nativeCommandRunner;
  const token = options.principalToken ?? (() => randomBytes(8).toString("hex"));
  const usedIds = new Set<string>();
  const active = new Map<LinuxAccountPrincipal, { intentUnlinked: boolean }>();

  async function requireCustody(): Promise<void> {
    const currentState = await lstat(stateRoot, { bigint: true });
    if (!sameDirectoryIdentity(stateIdentity, currentState))
      throw new TypeError("linux-account:state-root-moved");
    for (const [path, profile] of profiles) {
      const owner = path === accountHelperPath ? "STABLE" : "ROOT";
      const observed = detachedProfile(await readProfile(path, owner));
      if (!observed || !sameProfile(profile, observed))
        throw new TypeError("linux-account:helper-moved");
    }
  }

  async function command(operation: "CREATE" | "DELETE", principal: LinuxAccountPrincipal) {
    await requireCustody();
    const arguments_ = [
      "-n",
      pythonPath,
      accountHelperPath,
      operation,
      principal.name,
      principal.uid,
      principal.gid,
      ...(operation === "CREATE" ? [String(stableUid), String(stableGid)] : []),
    ];
    const result = detachedResult(
      await run({ arguments: arguments_, file: sudoPath, inputText: "" }),
    );
    await requireCustody();
    if (!result || result.exitCode !== 0 || result.signal !== null || result.stderr !== "")
      throw new TypeError(`linux-account:${operation.toLowerCase()}-refused`);
    const expected =
      operation === "CREATE"
        ? JSON.stringify({ gid: principal.gid, name: principal.name, uid: principal.uid })
        : '{"ok":true}';
    if (result.stdout !== expected)
      throw new TypeError(`linux-account:${operation.toLowerCase()}-output-refused`);
  }

  async function writeStateRecord(path: string, principal: LinuxAccountPrincipal): Promise<void> {
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(
        JSON.stringify({ gid: principal.gid, name: principal.name, uid: principal.uid }),
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await dependencies.syncStateDirectory(stateRoot);
  }

  async function writeIntent(principal: LinuxAccountPrincipal): Promise<void> {
    await writeStateRecord(principal.intentPath, principal);
  }

  async function removeIntent(
    principal: LinuxAccountPrincipal,
    allowAbsent = false,
    onUnlinked: () => void = () => {},
  ): Promise<void> {
    try {
      await rm(principal.intentPath, { force: false });
      onUnlinked();
    } catch (error) {
      if (!allowAbsent || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await dependencies.syncStateDirectory(stateRoot);
  }

  async function reverse(
    principal: LinuxAccountPrincipal,
    state?: { intentUnlinked: boolean },
  ): Promise<void> {
    await command("DELETE", principal);
    await removeIntent(principal, state?.intentUnlinked ?? false, () => {
      if (state) state.intentUnlinked = true;
    });
  }

  const custody: LinuxAccountCustody = {
    async createPrincipal() {
      await requireCustody();
      const principalToken = token();
      if (!/^[a-f0-9]{16}$/.test(principalToken))
        throw new TypeError("linux-account:token-refused");
      const numeric = BigInt(`0x${principalToken}`);
      const uid = String(1_000_000n + (numeric % 500_000_000n));
      const gid = String(1_100_000_000n + (numeric % 500_000_000n));
      if (usedIds.has(uid) || usedIds.has(gid))
        throw new TypeError("linux-account:identity-reuse-refused");
      const name = `orch6-${principalToken}`;
      const intentPath = resolve(stateRoot, `${intentPrefix}${name}.json`);
      const usedPath = resolve(stateRoot, `${usedPrefix}${name}.json`);
      if (!below(stateRoot, intentPath) || !below(stateRoot, usedPath))
        throw new TypeError("linux-account:intent-path-refused");
      const principal = Object.freeze({ gid, intentPath, name, uid });
      await writeStateRecord(usedPath, principal);
      usedIds.add(uid);
      usedIds.add(gid);
      await writeIntent(principal);
      try {
        await command("CREATE", principal);
      } catch (error) {
        try {
          await reverse(principal);
        } catch {
          throw new TypeError("linux-account:create-reversal-refused");
        }
        throw error;
      }
      active.set(principal, { intentUnlinked: false });
      return principal;
    },
    async deletePrincipal(principal) {
      const state = active.get(principal);
      if (!state) throw new TypeError("linux-account:principal-handle-refused");
      await reverse(principal, state);
      active.delete(principal);
    },
    async recover() {
      await requireCustody();
      await dependencies.syncStateDirectory(stateRoot);
      const entries = (await readdir(stateRoot, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const usedNames = new Set(
        entries
          .filter((entry) => entry.name.startsWith(usedPrefix) && entry.name.endsWith(".json"))
          .map((entry) => entry.name.slice(usedPrefix.length, -".json".length)),
      );
      for (const entry of entries)
        if (
          entry.name.startsWith(intentPrefix) &&
          entry.name.endsWith(".json") &&
          !usedNames.has(entry.name.slice(intentPrefix.length, -".json".length))
        )
          throw new TypeError("linux-account:used-census-refused");
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          (!entry.name.startsWith(intentPrefix) && !entry.name.startsWith(usedPrefix)) ||
          !entry.name.endsWith(".json")
        )
          throw new TypeError("linux-account:state-census-refused");
        const intentPath = resolve(stateRoot, entry.name);
        const handle = await open(intentPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let principal: LinuxAccountPrincipal;
        try {
          const identity = await handle.stat({ bigint: true });
          if (
            !identity.isFile() ||
            identity.uid !== BigInt(stableUid) ||
            (identity.mode & 0o77n) !== 0n
          )
            throw new TypeError("linux-account:intent-profile-refused");
          const parsed = parseIntent(JSON.parse(await handle.readFile("utf8")) as unknown);
          const expectedName = entry.name.startsWith(intentPrefix)
            ? `${intentPrefix}${parsed?.name ?? ""}.json`
            : `${usedPrefix}${parsed?.name ?? ""}.json`;
          if (!parsed || entry.name !== expectedName)
            throw new TypeError("linux-account:intent-refused");
          principal = Object.freeze({ ...parsed, intentPath });
        } finally {
          await handle.close();
        }
        usedIds.add(principal.uid);
        usedIds.add(principal.gid);
        if (entry.name.startsWith(intentPrefix)) await reverse(principal);
      }
    },
  };
  await custody.recover();
  return Object.freeze(custody);
}

export async function createLinuxAccountCustody(
  options: LinuxAccountCustodyOptions,
): Promise<LinuxAccountCustody> {
  if (nativeHostPlatform !== "linux") throw new TypeError("linux-account:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("linux-account:posix-identities-required");
  return await createLinuxAccountCustodyCore(options, {
    stableGid: process.getgid(),
    stableUid: process.getuid(),
    syncStateDirectory: syncDirectory,
  });
}

export async function createLinuxAccountCustodyTestFixture(
  options: LinuxAccountCustodyOptions,
  dependencies: LinuxAccountCustodyDependencies,
): Promise<LinuxAccountCustody> {
  return await createLinuxAccountCustodyCore(options, dependencies);
}

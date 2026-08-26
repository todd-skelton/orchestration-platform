import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";
import {
  runLinuxAuthorityCommand,
  type LinuxDacCommandRequest,
  type LinuxDacCommandResult,
  type LinuxDacHelperProfile,
} from "./linux-dac-custody.js";
import type { LinuxAccountPrincipal } from "./linux-account-custody.js";

const sudoPath = "/usr/bin/sudo";
const pythonLinkPath = "/usr/bin/python3";
const intentPrefix = "linux-principal-intent-";
const usedPrefix = "linux-principal-used-";
const nativeHostPlatform = process.platform;
const pythonPath = nativeHostPlatform === "linux" ? await realpath(pythonLinkPath) : pythonLinkPath;

export interface LinuxProcessCustodyOptions {
  readonly commandRunner?: (request: LinuxDacCommandRequest) => Promise<unknown>;
  readonly pidfdHelperPath: string;
  readonly profileReader?: (
    path: string,
    owner: "ROOT" | "STABLE",
  ) => Promise<LinuxDacHelperProfile>;
  readonly stateRoot: string;
}

export interface LinuxProcessCustody {
  quiesce(principal: LinuxAccountPrincipal): Promise<void>;
  recover(): Promise<void>;
}

interface LinuxProcessCustodyDependencies {
  readonly stableGid: number;
  readonly stableUid: number;
}

function canonicalUid(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const numeric = BigInt(value);
  return numeric >= 1_000_000n && numeric <= 2_147_483_646n ? value : undefined;
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

function detachedPrincipal(input: unknown): LinuxAccountPrincipal | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = ["gid", "intentPath", "name", "uid"] as const;
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
    typeof values.gid !== "string" ||
    typeof values.intentPath !== "string" ||
    typeof values.name !== "string" ||
    typeof values.uid !== "string" ||
    !/^orch6-[a-f0-9]{16}$/.test(values.name) ||
    !isAbsolute(values.intentPath) ||
    resolve(values.intentPath) !== values.intentPath ||
    !canonicalUid(values.uid) ||
    !canonicalUid(values.gid)
  )
    return undefined;
  const numeric = BigInt(`0x${values.name.slice("orch6-".length)}`);
  if (
    values.uid !== String(1_000_000n + (numeric % 500_000_000n)) ||
    values.gid !== String(1_100_000_000n + (numeric % 500_000_000n))
  )
    return undefined;
  return Object.freeze({
    gid: values.gid,
    intentPath: values.intentPath,
    name: values.name,
    uid: values.uid,
  }) as LinuxAccountPrincipal;
}

async function defaultProfileReader(
  path: string,
  owner: "ROOT" | "STABLE",
): Promise<LinuxDacHelperProfile> {
  const observed = await lstat(path, { bigint: true });
  const expectedUid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
  if (
    !observed.isFile() ||
    observed.isSymbolicLink() ||
    observed.uid !== expectedUid ||
    (observed.mode & 0o22n) !== 0n
  )
    throw new TypeError("linux-process:helper-profile-refused");
  return Object.freeze({
    ctimeNanoseconds: String(observed.ctimeNs),
    device: String(observed.dev),
    gid: String(observed.gid),
    inode: String(observed.ino),
    mode: String(observed.mode),
    size: String(observed.size),
    uid: String(observed.uid),
  });
}

function detachedProfile(input: unknown): LinuxDacHelperProfile | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = ["ctimeNanoseconds", "device", "gid", "inode", "mode", "size", "uid"] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== [...fields].sort().join("\0"))
    return undefined;
  const value: Record<string, string> = Object.create(null) as Record<string, string>;
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
    value[field] = descriptor.value;
  }
  return Object.freeze({ ...value }) as unknown as LinuxDacHelperProfile;
}

function sameProfile(left: LinuxDacHelperProfile, right: LinuxDacHelperProfile): boolean {
  return (Object.keys(left) as (keyof LinuxDacHelperProfile)[]).every(
    (field) => left[field] === right[field],
  );
}

function detachedResult(input: unknown): LinuxDacCommandResult | undefined {
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
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  if (
    !(value.exitCode === null || typeof value.exitCode === "number") ||
    !(value.signal === null || typeof value.signal === "string") ||
    typeof value.stderr !== "string" ||
    typeof value.stdout !== "string"
  )
    return undefined;
  return Object.freeze({ ...value }) as unknown as LinuxDacCommandResult;
}

async function createLinuxProcessCustodyCore(
  options: LinuxProcessCustodyOptions,
  dependencies: LinuxProcessCustodyDependencies,
): Promise<LinuxProcessCustody> {
  if (dependencies.stableUid <= 0 || dependencies.stableGid <= 0)
    throw new TypeError("linux-process:stable-unprivileged-required");
  const stateRoot = await realpath(resolve(options.stateRoot));
  const stateIdentity = await lstat(stateRoot, { bigint: true });
  if (
    !stateIdentity.isDirectory() ||
    stateIdentity.isSymbolicLink() ||
    stateIdentity.uid !== BigInt(dependencies.stableUid) ||
    stateIdentity.gid !== BigInt(dependencies.stableGid) ||
    (stateIdentity.mode & 0o7777n) !== 0o700n
  )
    throw new TypeError("linux-process:state-root-refused");
  const pidfdHelperPath = await realpath(resolve(options.pidfdHelperPath));
  const readProfile = options.profileReader ?? defaultProfileReader;
  const profiles = new Map<string, LinuxDacHelperProfile>();
  for (const [path, owner] of [
    [sudoPath, "ROOT"],
    [pythonPath, "ROOT"],
    [pidfdHelperPath, "STABLE"],
  ] as const) {
    const profile = detachedProfile(await readProfile(path, owner));
    if (!profile) throw new TypeError("linux-process:helper-profile-refused");
    profiles.set(path, profile);
  }
  const run = options.commandRunner ?? runLinuxAuthorityCommand;

  async function requireCustody(): Promise<void> {
    if (nativeHostPlatform === "linux" && (await realpath(pythonLinkPath)) !== pythonPath)
      throw new TypeError("linux-process:helper-moved");
    const currentState = await lstat(stateRoot, { bigint: true });
    if (!sameDirectoryIdentity(stateIdentity, currentState))
      throw new TypeError("linux-process:state-root-moved");
    for (const [path, profile] of profiles) {
      const observed = detachedProfile(
        await readProfile(path, path === pidfdHelperPath ? "STABLE" : "ROOT"),
      );
      if (!observed || !sameProfile(profile, observed))
        throw new TypeError("linux-process:helper-moved");
    }
  }

  async function readPrincipalRecord(
    recordPath: string,
    prefix: typeof intentPrefix | typeof usedPrefix,
  ): Promise<LinuxAccountPrincipal> {
    if (!below(stateRoot, recordPath)) throw new TypeError("linux-process:record-path-refused");
    const handle = await open(recordPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const observed = await handle.stat({ bigint: true });
      if (
        !observed.isFile() ||
        observed.uid !== BigInt(dependencies.stableUid) ||
        observed.gid !== BigInt(dependencies.stableGid) ||
        (observed.mode & 0o7777n) !== 0o600n
      )
        throw new TypeError("linux-process:intent-profile-refused");
      const bytes = await handle.readFile("utf8");
      const value = JSON.parse(bytes) as Readonly<Record<string, unknown>>;
      const principal = detachedPrincipal({
        gid: value?.gid,
        intentPath: resolve(stateRoot, `${intentPrefix}${String(value?.name ?? "")}.json`),
        name: value?.name,
        uid: value?.uid,
      });
      if (
        !principal ||
        recordPath !== resolve(stateRoot, `${prefix}${principal.name}.json`) ||
        bytes !== JSON.stringify({ gid: principal.gid, name: principal.name, uid: principal.uid })
      )
        throw new TypeError("linux-process:record-refused");
      return principal;
    } finally {
      await handle.close();
    }
  }

  async function requirePrincipal(input: unknown): Promise<LinuxAccountPrincipal> {
    const principal = detachedPrincipal(input);
    if (!principal) throw new TypeError("linux-process:principal-refused");
    const persisted = await readPrincipalRecord(principal.intentPath, intentPrefix);
    const used = await readPrincipalRecord(
      resolve(stateRoot, `${usedPrefix}${principal.name}.json`),
      usedPrefix,
    );
    if (
      persisted.gid !== principal.gid ||
      persisted.name !== principal.name ||
      persisted.uid !== principal.uid ||
      used.gid !== principal.gid ||
      used.name !== principal.name ||
      used.uid !== principal.uid
    )
      throw new TypeError("linux-process:principal-intent-mismatch");
    if (
      principal.uid === String(dependencies.stableUid) ||
      principal.gid === String(dependencies.stableGid)
    )
      throw new TypeError("linux-process:identity-equality-refused");
    return persisted;
  }

  async function quiesce(principalInput: LinuxAccountPrincipal): Promise<void> {
    const principal = await requirePrincipal(principalInput);
    await requireCustody();
    let untrusted: unknown;
    try {
      untrusted = await run({
        arguments: ["-n", pythonPath, "-I", "-B", pidfdHelperPath, principal.uid],
        file: sudoPath,
        inputText: "",
      });
    } finally {
      await requireCustody();
      await requirePrincipal(principal);
    }
    const result = detachedResult(untrusted);
    if (
      !result ||
      result.exitCode !== 0 ||
      result.signal !== null ||
      result.stderr !== "" ||
      result.stdout !== '{"ok":true}'
    )
      throw new TypeError("linux-process:quiescence-refused");
  }

  const custody: LinuxProcessCustody = {
    quiesce,
    async recover() {
      await requireCustody();
      const entries = (await readdir(stateRoot, { withFileTypes: true }))
        .filter((entry) => entry.name.startsWith(intentPrefix))
        .sort((left, right) => left.name.localeCompare(right.name));
      const principals: LinuxAccountPrincipal[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
          throw new TypeError("linux-process:state-census-refused");
        const principal = await readPrincipalRecord(resolve(stateRoot, entry.name), intentPrefix);
        principals.push(await requirePrincipal(principal));
      }
      for (const principal of principals) await quiesce(principal);
    },
  };
  await custody.recover();
  return Object.freeze(custody);
}

export async function createLinuxProcessCustody(
  options: LinuxProcessCustodyOptions,
): Promise<LinuxProcessCustody> {
  if (nativeHostPlatform !== "linux") throw new TypeError("linux-process:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("linux-process:posix-identities-required");
  return await createLinuxProcessCustodyCore(options, {
    stableGid: process.getgid(),
    stableUid: process.getuid(),
  });
}

export async function createLinuxProcessCustodyTestFixture(
  options: LinuxProcessCustodyOptions,
  dependencies: LinuxProcessCustodyDependencies,
): Promise<LinuxProcessCustody> {
  return await createLinuxProcessCustodyCore(options, dependencies);
}

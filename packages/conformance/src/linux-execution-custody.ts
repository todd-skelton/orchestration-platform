import { createHash, randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, parse as parsePath, relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";
import type { LinuxAccountPrincipal } from "./linux-account-custody.js";
import {
  runLinuxAuthorityCommand,
  type LinuxDacCommandRequest,
  type LinuxDacCommandResult,
  type LinuxDacHelperProfile,
} from "./linux-dac-custody.js";

const pythonPath = "/usr/bin/python3";
const intentPrefix = "linux-execution-intent-";
const usedPrefix = "linux-execution-used-";
const createdPrefix = "linux-execution-created-";
const accountIntentPrefix = "linux-principal-intent-";
const accountUsedPrefix = "linux-principal-used-";
const nativeHostPlatform = process.platform;

interface Identity {
  readonly device: string;
  readonly digest: string | null;
  readonly gid: string;
  readonly inode: string;
  readonly mode: string;
  readonly path: string;
  readonly size: string;
  readonly type: "DIRECTORY" | "FILE";
  readonly uid: string;
}

interface AllocationRecord {
  readonly ancestors: readonly Identity[];
  readonly candidateSource: Identity;
  readonly executionName: string;
  readonly principal: Readonly<{ gid: string; name: string; uid: string }>;
  readonly rpcRunnerSource: Identity;
  readonly stableGid: string;
  readonly stableUid: string;
}

interface CreatedRecord {
  readonly allocationDigest: string;
  readonly candidate: Identity;
  readonly root: Identity;
  readonly rpcRunner: Identity;
  readonly scratch: Identity;
}

export interface LinuxExecutionCustodyOptions {
  readonly accountStateRoot: string;
  readonly cleanupHelperPath: string;
  readonly commandRunner?: (request: LinuxDacCommandRequest) => Promise<unknown>;
  readonly executionParent: string;
  readonly profileReader?: (
    path: string,
    owner: "ROOT" | "STABLE",
  ) => Promise<LinuxDacHelperProfile>;
  readonly stateRoot: string;
  readonly token?: () => string;
}

export interface LinuxExecutionInput {
  readonly candidateArtifactPath: string;
  readonly principal: LinuxAccountPrincipal;
  readonly rpcRunnerPath: string;
}

export interface LinuxExecutionLease {
  readonly candidateArtifactPath: string;
  readonly executionName: string;
  readonly rootPath: string;
  readonly rpcRunnerPath: string;
  readonly scratchPath: string;
}

export interface LinuxExecutionCustody {
  cleanupAfterRevocation(lease: LinuxExecutionLease): Promise<void>;
  close(): Promise<void>;
  create(input: LinuxExecutionInput): Promise<LinuxExecutionLease>;
  recoverAfterRevocation(): Promise<void>;
}

interface Dependencies {
  readonly stableGid: number;
  readonly stableUid: number;
  readonly syncStateDirectory: (path: string) => Promise<void>;
}

interface ActiveExecution {
  readonly allocation: AllocationRecord;
  readonly created: CreatedRecord;
  createdUnlinked: boolean;
  readonly intentPath: string;
  intentUnlinked: boolean;
}

function below(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function canonicalDecimal(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? value : undefined;
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
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  if (
    typeof value.gid !== "string" ||
    typeof value.intentPath !== "string" ||
    typeof value.name !== "string" ||
    typeof value.uid !== "string" ||
    !/^orch6-[a-f0-9]{16}$/.test(value.name) ||
    !isAbsolute(value.intentPath) ||
    resolve(value.intentPath) !== value.intentPath ||
    !canonicalDecimal(value.uid) ||
    !canonicalDecimal(value.gid)
  )
    return undefined;
  const numeric = BigInt(`0x${value.name.slice("orch6-".length)}`);
  if (
    value.uid !== String(1_000_000n + (numeric % 500_000_000n)) ||
    value.gid !== String(1_100_000_000n + (numeric % 500_000_000n))
  )
    return undefined;
  return Object.freeze({
    gid: value.gid,
    intentPath: value.intentPath,
    name: value.name,
    uid: value.uid,
  }) as LinuxAccountPrincipal;
}

function identity(
  path: string,
  kind: "DIRECTORY" | "FILE",
  profile: BigIntStats,
  bytes?: Buffer,
): Identity {
  if (
    (kind === "DIRECTORY" && !profile.isDirectory()) ||
    (kind === "FILE" && !profile.isFile()) ||
    profile.isSymbolicLink()
  )
    throw new TypeError("linux-execution:identity-type-refused");
  if (kind === "FILE" && (!bytes || BigInt(bytes.byteLength) !== profile.size))
    throw new TypeError("linux-execution:identity-bytes-refused");
  return Object.freeze({
    device: String(profile.dev),
    digest: kind === "FILE" ? createHash("sha256").update(bytes!).digest("hex") : null,
    gid: String(profile.gid),
    inode: String(profile.ino),
    mode: String(profile.mode & 0o7777n),
    path,
    size: kind === "FILE" ? String(profile.size) : "0",
    type: kind,
    uid: String(profile.uid),
  });
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return (Object.keys(left) as (keyof Identity)[]).every((field) => left[field] === right[field]);
}

function allocationDigest(record: AllocationRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function canonicalAncestorPaths(parentPath: string): readonly string[] {
  const filesystemRoot = parsePath(parentPath).root;
  const paths = [filesystemRoot];
  let current = filesystemRoot;
  const remainder = relative(filesystemRoot, parentPath);
  for (const component of remainder === "" ? [] : remainder.split(sep)) {
    if (!component || component === "." || component === "..")
      throw new TypeError("linux-execution:ancestor-component-refused");
    current = resolve(current, component);
    paths.push(current);
  }
  return Object.freeze(paths);
}

async function defaultProfileReader(
  path: string,
  owner: "ROOT" | "STABLE",
): Promise<LinuxDacHelperProfile> {
  const profile = await lstat(path, { bigint: true });
  const uid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
  if (
    !profile.isFile() ||
    profile.isSymbolicLink() ||
    profile.uid !== uid ||
    (profile.mode & 0o22n) !== 0n
  )
    throw new TypeError("linux-execution:helper-profile-refused");
  return Object.freeze({
    ctimeNanoseconds: String(profile.ctimeNs),
    device: String(profile.dev),
    gid: String(profile.gid),
    inode: String(profile.ino),
    mode: String(profile.mode),
    size: String(profile.size),
    uid: String(profile.uid),
  });
}

function detachedProfile(input: unknown): LinuxDacHelperProfile | undefined {
  if (input === null || typeof input !== "object" || nodeTypes.isProxy(input)) return undefined;
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
  if (input === null || typeof input !== "object" || nodeTypes.isProxy(input)) return undefined;
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

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseIdentity(input: unknown, kind: "DIRECTORY" | "FILE"): Identity | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join("\0") !==
    "device\0digest\0gid\0inode\0mode\0path\0size\0type\0uid"
  )
    return undefined;
  if (
    record.type !== kind ||
    typeof record.path !== "string" ||
    !isAbsolute(record.path) ||
    resolve(record.path) !== record.path ||
    !canonicalDecimal(record.device) ||
    !canonicalDecimal(record.gid) ||
    !canonicalDecimal(record.inode) ||
    !canonicalDecimal(record.mode) ||
    !canonicalDecimal(record.size) ||
    !canonicalDecimal(record.uid) ||
    (kind === "DIRECTORY"
      ? record.digest !== null || record.size !== "0"
      : typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest))
  )
    return undefined;
  return Object.freeze({
    device: record.device,
    digest: record.digest,
    gid: record.gid,
    inode: record.inode,
    mode: record.mode,
    path: record.path,
    size: record.size,
    type: kind,
    uid: record.uid,
  }) as Identity;
}

function parseAllocation(input: unknown): AllocationRecord | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join("\0") !==
    "ancestors\0candidateSource\0executionName\0principal\0rpcRunnerSource\0stableGid\0stableUid"
  )
    return undefined;
  if (
    !Array.isArray(record.ancestors) ||
    record.ancestors.length < 1 ||
    record.ancestors.length > 256
  )
    return undefined;
  const ancestors = record.ancestors.map((value) => parseIdentity(value, "DIRECTORY"));
  const candidateSource = parseIdentity(record.candidateSource, "FILE");
  const rpcRunnerSource = parseIdentity(record.rpcRunnerSource, "FILE");
  const principalRecord = record.principal as Readonly<Record<string, unknown>> | null;
  if (
    ancestors.some((value) => !value) ||
    !candidateSource ||
    !rpcRunnerSource ||
    typeof record.executionName !== "string" ||
    !/^orch6-exec-[a-f0-9]{16}$/.test(record.executionName) ||
    !canonicalDecimal(record.stableGid) ||
    !canonicalDecimal(record.stableUid) ||
    !principalRecord ||
    Object.keys(principalRecord).sort().join("\0") !== "gid\0name\0uid" ||
    typeof principalRecord.gid !== "string" ||
    typeof principalRecord.name !== "string" ||
    typeof principalRecord.uid !== "string"
  )
    return undefined;
  const principal = detachedPrincipal({
    gid: principalRecord.gid,
    intentPath: resolve(ancestors.at(-1)!.path, `../placeholder-${principalRecord.name}.json`),
    name: principalRecord.name,
    uid: principalRecord.uid,
  });
  if (!principal) return undefined;
  const objectKeys = [...ancestors, candidateSource, rpcRunnerSource].map(
    (value) => `${value!.device}:${value!.inode}`,
  );
  if (new Set(objectKeys).size !== objectKeys.length) return undefined;
  return Object.freeze({
    ancestors: Object.freeze(ancestors as Identity[]),
    candidateSource,
    executionName: record.executionName,
    principal: Object.freeze({ gid: principal.gid, name: principal.name, uid: principal.uid }),
    rpcRunnerSource,
    stableGid: String(record.stableGid),
    stableUid: String(record.stableUid),
  });
}

function parseCreated(input: unknown): CreatedRecord | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join("\0") !==
    "allocationDigest\0candidate\0root\0rpcRunner\0scratch"
  )
    return undefined;
  const candidate = parseIdentity(record.candidate, "FILE");
  const root = parseIdentity(record.root, "DIRECTORY");
  const rpcRunner = parseIdentity(record.rpcRunner, "FILE");
  const scratch = parseIdentity(record.scratch, "DIRECTORY");
  if (
    !candidate ||
    !root ||
    !rpcRunner ||
    !scratch ||
    typeof record.allocationDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.allocationDigest)
  )
    return undefined;
  const keys = [root, candidate, rpcRunner, scratch].map(
    (value) => `${value.device}:${value.inode}`,
  );
  if (new Set(keys).size !== keys.length) return undefined;
  return Object.freeze({
    allocationDigest: record.allocationDigest,
    candidate,
    root,
    rpcRunner,
    scratch,
  });
}

async function createCore(
  options: LinuxExecutionCustodyOptions,
  dependencies: Dependencies,
): Promise<LinuxExecutionCustody> {
  const { stableGid, stableUid } = dependencies;
  if (stableUid <= 0 || stableGid <= 0)
    throw new TypeError("linux-execution:stable-unprivileged-required");
  const accountStateRoot = await realpath(resolve(options.accountStateRoot));
  const stateRoot = await realpath(resolve(options.stateRoot));
  const executionParent = await realpath(resolve(options.executionParent));
  if (
    within(stateRoot, executionParent) ||
    within(executionParent, stateRoot) ||
    within(accountStateRoot, executionParent) ||
    within(executionParent, accountStateRoot) ||
    within(accountStateRoot, stateRoot) ||
    within(stateRoot, accountStateRoot)
  )
    throw new TypeError("linux-execution:root-separation-refused");
  const accountStateProfile = await lstat(accountStateRoot, { bigint: true });
  const stateProfile = await lstat(stateRoot, { bigint: true });
  if (
    !accountStateProfile.isDirectory() ||
    accountStateProfile.uid !== BigInt(stableUid) ||
    accountStateProfile.gid !== BigInt(stableGid) ||
    (accountStateProfile.mode & 0o7777n) !== 0o700n ||
    !stateProfile.isDirectory() ||
    stateProfile.uid !== BigInt(stableUid) ||
    stateProfile.gid !== BigInt(stableGid) ||
    (stateProfile.mode & 0o7777n) !== 0o700n
  )
    throw new TypeError("linux-execution:state-root-refused");
  const ancestorPaths = canonicalAncestorPaths(executionParent);
  const ancestorHandles: Awaited<ReturnType<typeof open>>[] = [];
  const ancestors: Identity[] = [];
  try {
    for (const path of ancestorPaths) {
      if ((await realpath(path)) !== path)
        throw new TypeError("linux-execution:ancestor-alias-refused");
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
      );
      ancestorHandles.push(handle);
      ancestors.push(identity(path, "DIRECTORY", await handle.stat({ bigint: true })));
    }
  } catch (error) {
    await Promise.allSettled(ancestorHandles.map(async (handle) => await handle.close()));
    throw error;
  }
  const parent = ancestors.at(-1)!;
  if (
    parent.uid !== String(stableUid) ||
    parent.gid !== String(stableGid) ||
    parent.mode !== String(0o700)
  ) {
    await Promise.allSettled(ancestorHandles.map(async (handle) => await handle.close()));
    throw new TypeError("linux-execution:parent-profile-refused");
  }
  const cleanupHelperPath = await realpath(resolve(options.cleanupHelperPath));
  const readProfile = options.profileReader ?? defaultProfileReader;
  const helperProfiles = new Map<string, LinuxDacHelperProfile>();
  for (const [path, owner] of [
    [pythonPath, "ROOT"],
    [cleanupHelperPath, "STABLE"],
  ] as const) {
    const profile = detachedProfile(await readProfile(path, owner));
    if (!profile) throw new TypeError("linux-execution:helper-profile-refused");
    helperProfiles.set(path, profile);
  }
  const run = options.commandRunner ?? runLinuxAuthorityCommand;
  const token = options.token ?? (() => randomBytes(8).toString("hex"));
  const active = new Map<LinuxExecutionLease, ActiveExecution>();
  let recovered = false;
  let closed = false;

  async function requireCustody(): Promise<void> {
    if (closed) throw new TypeError("linux-execution:closed");
    const state = await lstat(stateRoot, { bigint: true });
    const accountState = await lstat(accountStateRoot, { bigint: true });
    if (
      accountState.dev !== accountStateProfile.dev ||
      accountState.ino !== accountStateProfile.ino ||
      accountState.mode !== accountStateProfile.mode ||
      accountState.uid !== accountStateProfile.uid ||
      accountState.gid !== accountStateProfile.gid ||
      state.dev !== stateProfile.dev ||
      state.ino !== stateProfile.ino ||
      state.mode !== stateProfile.mode ||
      state.uid !== stateProfile.uid ||
      state.gid !== stateProfile.gid
    )
      throw new TypeError("linux-execution:state-root-moved");
    for (let index = 0; index < ancestorHandles.length; index += 1) {
      const observed = identity(
        ancestorPaths[index]!,
        "DIRECTORY",
        await ancestorHandles[index]!.stat({ bigint: true }),
      );
      if (!sameIdentity(observed, ancestors[index]!))
        throw new TypeError("linux-execution:ancestor-moved");
      const pathProfile = identity(
        ancestorPaths[index]!,
        "DIRECTORY",
        await lstat(ancestorPaths[index]!, { bigint: true }),
      );
      if (!sameIdentity(pathProfile, ancestors[index]!))
        throw new TypeError("linux-execution:ancestor-entry-moved");
    }
    for (const [path, profile] of helperProfiles) {
      const observed = detachedProfile(
        await readProfile(path, path === cleanupHelperPath ? "STABLE" : "ROOT"),
      );
      if (!observed || !sameProfile(profile, observed))
        throw new TypeError("linux-execution:helper-moved");
    }
  }

  async function readAccountRecord(path: string, expected: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const profile = await handle.stat({ bigint: true });
      if (
        !profile.isFile() ||
        profile.uid !== BigInt(stableUid) ||
        profile.gid !== BigInt(stableGid) ||
        (profile.mode & 0o7777n) !== 0o600n ||
        (await handle.readFile("utf8")) !== expected
      )
        throw new TypeError("linux-execution:account-authority-refused");
    } finally {
      await handle.close();
    }
  }

  async function requireAccountPair(principal: AllocationRecord["principal"]): Promise<void> {
    const expected = JSON.stringify(principal);
    await readAccountRecord(
      resolve(accountStateRoot, `${accountIntentPrefix}${principal.name}.json`),
      expected,
    );
    await readAccountRecord(
      resolve(accountStateRoot, `${accountUsedPrefix}${principal.name}.json`),
      expected,
    );
  }

  async function writeRecord(path: string, value: unknown): Promise<void> {
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await dependencies.syncStateDirectory(stateRoot);
  }

  async function readRecord<Value>(
    path: string,
    parse: (input: unknown) => Value | undefined,
  ): Promise<Value> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const profile = await handle.stat({ bigint: true });
      if (
        !profile.isFile() ||
        profile.uid !== BigInt(stableUid) ||
        profile.gid !== BigInt(stableGid) ||
        (profile.mode & 0o7777n) !== 0o600n
      )
        throw new TypeError("linux-execution:record-profile-refused");
      const bytes = await handle.readFile("utf8");
      const value = parse(JSON.parse(bytes) as unknown);
      if (!value || bytes !== JSON.stringify(value))
        throw new TypeError("linux-execution:record-refused");
      return value;
    } finally {
      await handle.close();
    }
  }

  async function readSource(pathInput: string): Promise<{ bytes: Buffer; identity: Identity }> {
    const path = await realpath(resolve(pathInput));
    if (within(accountStateRoot, path) || within(stateRoot, path) || within(executionParent, path))
      throw new TypeError("linux-execution:source-root-refused");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.uid !== BigInt(stableUid) ||
        before.gid !== BigInt(stableGid) ||
        (before.mode & 0o22n) !== 0n ||
        before.size < 1n ||
        before.size > 64n * 1024n * 1024n
      )
        throw new TypeError("linux-execution:source-profile-refused");
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.uid !== after.uid ||
        before.gid !== after.gid ||
        before.size !== after.size ||
        before.ctimeNs !== after.ctimeNs
      )
        throw new TypeError("linux-execution:source-moved");
      return { bytes, identity: identity(path, "FILE", before, bytes) };
    } finally {
      await handle.close();
    }
  }

  async function writeTarget(path: string, bytes: Buffer): Promise<Identity> {
    const writer = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await writer.writeFile(bytes);
      await writer.sync();
    } finally {
      await writer.close();
    }
    const reader = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const profile = await reader.stat({ bigint: true });
      const observed = await reader.readFile();
      const value = identity(path, "FILE", profile, observed);
      if (
        profile.uid !== BigInt(stableUid) ||
        profile.gid !== BigInt(stableGid) ||
        value.mode !== String(0o600) ||
        !observed.equals(bytes)
      )
        throw new TypeError("linux-execution:target-readback-refused");
      return value;
    } finally {
      await reader.close();
    }
  }

  async function requireTarget(expected: Identity): Promise<void> {
    const handle = await open(
      expected.path,
      constants.O_RDONLY |
        (expected.type === "DIRECTORY" ? (constants.O_DIRECTORY ?? 0) : 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const bytes = expected.type === "FILE" ? await handle.readFile() : undefined;
      const observed = identity(
        expected.path,
        expected.type,
        await handle.stat({ bigint: true }),
        bytes,
      );
      if (!sameIdentity(observed, expected))
        throw new TypeError("linux-execution:target-identity-refused");
    } finally {
      await handle.close();
    }
  }

  async function requireCreatedTargets(created: CreatedRecord): Promise<void> {
    for (const value of [created.root, created.candidate, created.rpcRunner, created.scratch])
      await requireTarget(value);
  }

  function helperRequest(allocation: AllocationRecord, created: CreatedRecord | undefined) {
    return Object.freeze({
      ancestors: allocation.ancestors,
      candidate: created?.candidate ?? null,
      executionName: allocation.executionName,
      mode: created ? "CREATED" : "PARTIAL",
      root: created?.root ?? null,
      rpcRunner: created?.rpcRunner ?? null,
      scratch: created?.scratch ?? null,
      stableGid: allocation.stableGid,
      stableUid: allocation.stableUid,
    });
  }

  async function cleanupCommand(
    allocation: AllocationRecord,
    created: CreatedRecord | undefined,
  ): Promise<void> {
    await requireCustody();
    await requireAccountPair(allocation.principal);
    let untrusted: unknown;
    try {
      untrusted = await run({
        arguments: ["-I", "-B", cleanupHelperPath],
        file: pythonPath,
        inputText: JSON.stringify(helperRequest(allocation, created)),
      });
    } finally {
      await requireCustody();
      await requireAccountPair(allocation.principal);
    }
    const result = detachedResult(untrusted);
    if (
      !result ||
      result.exitCode !== 0 ||
      result.signal !== null ||
      result.stderr !== "" ||
      result.stdout !== '{"ok":true}'
    )
      throw new TypeError("linux-execution:cleanup-refused");
    await ancestorHandles.at(-1)!.sync();
    const rootPath = resolve(executionParent, allocation.executionName);
    try {
      await lstat(rootPath);
      throw new TypeError("linux-execution:root-residue");
    } catch (error) {
      if (error instanceof TypeError || (error as NodeJS.ErrnoException).code !== "ENOENT")
        throw error;
    }
    await requireCustody();
    await requireAccountPair(allocation.principal);
  }

  async function removeRecord(
    path: string,
    allowAbsent: boolean,
    onUnlinked: () => void = () => {},
  ): Promise<void> {
    try {
      await rm(path, { force: false });
      onUnlinked();
    } catch (error) {
      if (!allowAbsent || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await dependencies.syncStateDirectory(stateRoot);
  }

  async function finishCleanup(
    allocation: AllocationRecord,
    created: CreatedRecord | undefined,
    state?: ActiveExecution,
  ): Promise<void> {
    await cleanupCommand(allocation, created);
    const createdPath = resolve(stateRoot, `${createdPrefix}${allocation.executionName}.json`);
    if (created) {
      await removeRecord(createdPath, state?.createdUnlinked ?? false, () => {
        if (state) state.createdUnlinked = true;
      });
    }
    const intentPath = resolve(stateRoot, `${intentPrefix}${allocation.executionName}.json`);
    await removeRecord(intentPath, state?.intentUnlinked ?? false, () => {
      if (state) state.intentUnlinked = true;
    });
  }

  async function allocationAt(name: string): Promise<AllocationRecord> {
    const intentPath = resolve(stateRoot, `${intentPrefix}${name}.json`);
    const allocation = await readRecord(intentPath, parseAllocation);
    if (
      allocation.executionName !== name ||
      allocation.stableUid !== String(stableUid) ||
      allocation.stableGid !== String(stableGid) ||
      allocation.principal.uid === allocation.stableUid ||
      allocation.principal.gid === allocation.stableGid ||
      allocation.ancestors.length !== ancestors.length ||
      allocation.ancestors.some((value, index) => !sameIdentity(value, ancestors[index]!))
    )
      throw new TypeError("linux-execution:allocation-refused");
    const used = await readRecord(resolve(stateRoot, `${usedPrefix}${name}.json`), parseAllocation);
    if (JSON.stringify(used) !== JSON.stringify(allocation))
      throw new TypeError("linux-execution:used-mismatch");
    await requireAccountPair(allocation.principal);
    return allocation;
  }

  async function createdFor(allocation: AllocationRecord): Promise<CreatedRecord | undefined> {
    const path = resolve(stateRoot, `${createdPrefix}${allocation.executionName}.json`);
    try {
      const created = await readRecord(path, parseCreated);
      if (created.allocationDigest !== allocationDigest(allocation))
        throw new TypeError("linux-execution:created-allocation-mismatch");
      const rootPath = resolve(executionParent, allocation.executionName);
      if (
        created.root.path !== rootPath ||
        created.candidate.path !== resolve(rootPath, "candidate.mjs") ||
        created.rpcRunner.path !== resolve(rootPath, "rpc-runner.mjs") ||
        created.scratch.path !== resolve(rootPath, "scratch")
      )
        throw new TypeError("linux-execution:created-path-refused");
      return created;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  const custody: LinuxExecutionCustody = {
    async cleanupAfterRevocation(lease) {
      const state = active.get(lease);
      if (!state) throw new TypeError("linux-execution:lease-refused");
      await finishCleanup(state.allocation, state.created, state);
      active.delete(lease);
    },
    async close() {
      if (closed) throw new TypeError("linux-execution:closed");
      if (active.size !== 0) throw new TypeError("linux-execution:active-close-refused");
      closed = true;
      const outcomes = await Promise.allSettled(
        [...ancestorHandles].reverse().map(async (handle) => await handle.close()),
      );
      if (outcomes.some((outcome) => outcome.status === "rejected"))
        throw new TypeError("linux-execution:handle-close-refused");
    },
    async create(input) {
      if (!recovered) throw new TypeError("linux-execution:recovery-required");
      await requireCustody();
      const principal = detachedPrincipal(input.principal);
      if (
        !principal ||
        principal.intentPath !==
          resolve(accountStateRoot, `${accountIntentPrefix}${principal.name}.json`)
      )
        throw new TypeError("linux-execution:principal-refused");
      const principalRecord = Object.freeze({
        gid: principal.gid,
        name: principal.name,
        uid: principal.uid,
      });
      await requireAccountPair(principalRecord);
      if ((await readdir(executionParent)).length !== 0)
        throw new TypeError("linux-execution:parent-census-refused");
      const [candidateSource, rpcRunnerSource] = await Promise.all([
        readSource(input.candidateArtifactPath),
        readSource(input.rpcRunnerPath),
      ]);
      if (
        `${candidateSource.identity.device}:${candidateSource.identity.inode}` ===
        `${rpcRunnerSource.identity.device}:${rpcRunnerSource.identity.inode}`
      )
        throw new TypeError("linux-execution:source-alias-refused");
      const tokenValue = token();
      if (!/^[a-f0-9]{16}$/.test(tokenValue)) throw new TypeError("linux-execution:token-refused");
      const executionName = `orch6-exec-${tokenValue}`;
      const rootPath = resolve(executionParent, executionName);
      try {
        await lstat(rootPath);
        throw new TypeError("linux-execution:preexisting-root-refused");
      } catch (error) {
        if (error instanceof TypeError || (error as NodeJS.ErrnoException).code !== "ENOENT")
          throw error;
      }
      const allocation: AllocationRecord = Object.freeze({
        ancestors: Object.freeze([...ancestors]),
        candidateSource: candidateSource.identity,
        executionName,
        principal: principalRecord,
        rpcRunnerSource: rpcRunnerSource.identity,
        stableGid: String(stableGid),
        stableUid: String(stableUid),
      });
      const usedPath = resolve(stateRoot, `${usedPrefix}${executionName}.json`);
      const intentPath = resolve(stateRoot, `${intentPrefix}${executionName}.json`);
      await writeRecord(usedPath, allocation);
      await writeRecord(intentPath, allocation);
      let created: CreatedRecord | undefined;
      try {
        await mkdir(rootPath, { mode: 0o700 });
        const rootHandle = await open(
          rootPath,
          constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const rootIdentity = identity(
            rootPath,
            "DIRECTORY",
            await rootHandle.stat({ bigint: true }),
          );
          if (
            rootIdentity.uid !== String(stableUid) ||
            rootIdentity.gid !== String(stableGid) ||
            rootIdentity.mode !== String(0o700)
          )
            throw new TypeError("linux-execution:root-profile-refused");
          const candidate = await writeTarget(
            resolve(rootPath, "candidate.mjs"),
            candidateSource.bytes,
          );
          const rpcRunner = await writeTarget(
            resolve(rootPath, "rpc-runner.mjs"),
            rpcRunnerSource.bytes,
          );
          const scratchPath = resolve(rootPath, "scratch");
          await mkdir(scratchPath, { mode: 0o700 });
          const scratchHandle = await open(
            scratchPath,
            constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
          );
          let scratch: Identity;
          try {
            scratch = identity(
              scratchPath,
              "DIRECTORY",
              await scratchHandle.stat({ bigint: true }),
            );
            if (
              scratch.uid !== String(stableUid) ||
              scratch.gid !== String(stableGid) ||
              scratch.mode !== String(0o700)
            )
              throw new TypeError("linux-execution:scratch-profile-refused");
            await scratchHandle.sync();
          } finally {
            await scratchHandle.close();
          }
          await rootHandle.sync();
          await ancestorHandles.at(-1)!.sync();
          created = Object.freeze({
            allocationDigest: allocationDigest(allocation),
            candidate,
            root: rootIdentity,
            rpcRunner,
            scratch,
          });
          const createdPath = resolve(stateRoot, `${createdPrefix}${executionName}.json`);
          await writeRecord(createdPath, created);
          const persistedCreated = await readRecord(createdPath, parseCreated);
          if (JSON.stringify(persistedCreated) !== JSON.stringify(created))
            throw new TypeError("linux-execution:created-readback-refused");
          await requireCreatedTargets(created);
          await requireCustody();
          await requireAccountPair(allocation.principal);
          const lease = Object.freeze({
            candidateArtifactPath: candidate.path,
            executionName,
            rootPath,
            rpcRunnerPath: rpcRunner.path,
            scratchPath: scratch.path,
          });
          active.set(lease, {
            allocation,
            created,
            createdUnlinked: false,
            intentPath,
            intentUnlinked: false,
          });
          return lease;
        } finally {
          await rootHandle.close();
        }
      } catch (error) {
        try {
          await finishCleanup(allocation, created);
        } catch {
          throw new TypeError("linux-execution:create-reversal-refused");
        }
        throw error;
      }
    },
    async recoverAfterRevocation() {
      if (active.size !== 0) throw new TypeError("linux-execution:active-recovery-refused");
      await requireCustody();
      await dependencies.syncStateDirectory(stateRoot);
      const entries = (await readdir(stateRoot, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const intentEntries = entries.filter((entry) => entry.name.startsWith(intentPrefix));
      const intentNames = new Set(
        intentEntries.map((entry) => entry.name.slice(intentPrefix.length, -".json".length)),
      );
      for (const entry of entries.filter((value) => value.name.startsWith(createdPrefix))) {
        const name = entry.name.slice(createdPrefix.length, -".json".length);
        if (!entry.isFile() || !entry.name.endsWith(".json") || !intentNames.has(name))
          throw new TypeError("linux-execution:orphan-created-refused");
      }
      const pending: { allocation: AllocationRecord; created: CreatedRecord | undefined }[] = [];
      for (const entry of intentEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
          throw new TypeError("linux-execution:state-census-refused");
        const name = entry.name.slice(intentPrefix.length, -".json".length);
        const allocation = await allocationAt(name);
        pending.push({ allocation, created: await createdFor(allocation) });
      }
      const expectedRoots = pending.map((value) => value.allocation.executionName).sort();
      const observedRoots = (await readdir(executionParent)).sort();
      if (observedRoots.some((name) => !expectedRoots.includes(name)))
        throw new TypeError("linux-execution:untracked-root-refused");
      for (const value of pending) await finishCleanup(value.allocation, value.created);
      if ((await readdir(executionParent)).length !== 0)
        throw new TypeError("linux-execution:parent-residue");
      recovered = true;
    },
  };
  return Object.freeze(custody);
}

export async function createLinuxExecutionCustody(
  options: LinuxExecutionCustodyOptions,
): Promise<LinuxExecutionCustody> {
  if (nativeHostPlatform !== "linux") throw new TypeError("linux-execution:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("linux-execution:posix-identities-required");
  return await createCore(options, {
    stableGid: process.getgid(),
    stableUid: process.getuid(),
    syncStateDirectory: syncDirectory,
  });
}

export async function createLinuxExecutionCustodyTestFixture(
  options: LinuxExecutionCustodyOptions,
  dependencies: Dependencies,
): Promise<LinuxExecutionCustody> {
  return await createCore(options, dependencies);
}

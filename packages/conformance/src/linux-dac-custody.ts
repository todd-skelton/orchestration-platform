import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, parse as parsePath, relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";

const sudoPath = "/usr/bin/sudo";
const pythonPath = "/usr/bin/python3";
const intentPrefix = "linux-dac-intent-";
const nativeHostPlatform = process.platform;
const identityFields = ["device", "gid", "inode", "mode", "path", "type", "uid"] as const;

export interface LinuxDacCommandRequest {
  readonly arguments: readonly string[];
  readonly file: string;
  readonly inputText: string;
}

export interface LinuxDacCommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface LinuxDacHelperProfile {
  readonly ctimeNanoseconds: string;
  readonly device: string;
  readonly gid: string;
  readonly inode: string;
  readonly mode: string;
  readonly size: string;
  readonly uid: string;
}

export interface LinuxDacPrincipal {
  readonly gid: string;
  readonly name: string;
  readonly uid: string;
}

export interface LinuxDacExecutionInput {
  readonly principal: LinuxDacPrincipal;
  readonly rootPath: string;
}

export interface LinuxDacLease {
  readonly name: string;
}

export interface LinuxDacCustodyOptions {
  readonly commandRunner?: (request: LinuxDacCommandRequest) => Promise<unknown>;
  readonly dacHelperPath: string;
  readonly profileReader?: (
    path: string,
    owner: "ROOT" | "STABLE",
  ) => Promise<LinuxDacHelperProfile>;
  readonly stateRoot: string;
}

export interface LinuxDacCustody {
  prepareAccess(input: LinuxDacExecutionInput): Promise<LinuxDacLease>;
  recover(): Promise<void>;
  restoreAccess(lease: LinuxDacLease): Promise<void>;
}

type LinuxDacIdentity = Readonly<{
  device: string;
  gid: string;
  inode: string;
  mode: string;
  path: string;
  type: "DIRECTORY" | "FILE";
  uid: string;
}>;

type LinuxDacRequest = Readonly<{
  ancestors: readonly LinuxDacIdentity[];
  candidate: LinuxDacIdentity;
  gid: string;
  operation: "PREPARE" | "RESTORE";
  parent: LinuxDacIdentity;
  root: LinuxDacIdentity;
  rpcRunner: LinuxDacIdentity;
  scratch: LinuxDacIdentity;
  stableGid: string;
  stableUid: string;
  uid: string;
}>;

interface LinuxDacCustodyDependencies {
  readonly stableGid: number;
  readonly stableUid: number;
  readonly syncStateDirectory: (path: string) => Promise<void>;
}

interface RetainedHandles {
  readonly ancestors: readonly Awaited<ReturnType<typeof open>>[];
  readonly candidate: Awaited<ReturnType<typeof open>>;
  readonly parent: Awaited<ReturnType<typeof open>>;
  readonly root: Awaited<ReturnType<typeof open>>;
  readonly rpcRunner: Awaited<ReturnType<typeof open>>;
  readonly scratch: Awaited<ReturnType<typeof open>>;
}

interface ActiveLease {
  readonly handles: RetainedHandles;
  readonly intentPath: string;
  readonly request: LinuxDacRequest;
  intentUnlinked: boolean;
}

function below(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function canonicalDecimal(
  value: unknown,
  minimum = 0n,
  maximum = 2_147_483_646n,
): string | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const numeric = BigInt(value);
  return numeric >= minimum && numeric <= maximum ? value : undefined;
}

function detachedPrincipal(input: unknown): LinuxDacPrincipal | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== "gid\0name\0uid") return undefined;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of ["gid", "name", "uid"] as const) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values[field] = descriptor.value;
  }
  if (
    typeof values.name !== "string" ||
    !/^orch6-[a-f0-9]{16}$/.test(values.name) ||
    !canonicalDecimal(values.uid, 1_000_000n) ||
    !canonicalDecimal(values.gid, 1_000_000n)
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
    name: values.name,
    uid: values.uid,
  }) as LinuxDacPrincipal;
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
): Promise<LinuxDacHelperProfile> {
  const observed = await lstat(path, { bigint: true });
  const expectedUid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
  if (
    !observed.isFile() ||
    observed.isSymbolicLink() ||
    observed.uid !== expectedUid ||
    (observed.mode & 0o22n) !== 0n
  )
    throw new TypeError("linux-dac:helper-profile-refused");
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

async function nativeCommandRunner(
  request: LinuxDacCommandRequest,
): Promise<LinuxDacCommandResult> {
  return await new Promise((complete, reject) => {
    const child = spawn(request.file, [...request.arguments], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let oversize = false;
    child.stdout.on("data", (chunk: Uint8Array) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength > 1024 * 1024) {
        oversize = true;
        child.kill("SIGKILL");
      } else stdout.push(Uint8Array.from(chunk));
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderrLength += chunk.byteLength;
      if (stderrLength > 1024 * 1024) {
        oversize = true;
        child.kill("SIGKILL");
      } else stderr.push(Uint8Array.from(chunk));
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (oversize) {
        reject(new TypeError("linux-dac:command-output-limit-refused"));
        return;
      }
      complete({
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.end(request.inputText);
  });
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

function identity(path: string, type: "DIRECTORY" | "FILE", value: BigIntStats): LinuxDacIdentity {
  if (
    (type === "DIRECTORY" && !value.isDirectory()) ||
    (type === "FILE" && !value.isFile()) ||
    value.isSymbolicLink()
  )
    throw new TypeError("linux-dac:identity-type-refused");
  return Object.freeze({
    device: String(value.dev),
    gid: String(value.gid),
    inode: String(value.ino),
    mode: String(value.mode & 0o7777n),
    path,
    type,
    uid: String(value.uid),
  });
}

function sameIdentity(left: LinuxDacIdentity, right: LinuxDacIdentity): boolean {
  return identityFields.every((field) => left[field] === right[field]);
}

function grantedIdentity(
  original: LinuxDacIdentity,
  uid: string,
  gid: string,
  mode: number,
): LinuxDacIdentity {
  return Object.freeze({ ...original, gid, mode: String(mode), uid });
}

function grantedRequest(request: LinuxDacRequest): LinuxDacRequest {
  return Object.freeze({
    ...request,
    candidate: grantedIdentity(request.candidate, "0", request.gid, 0o550),
    root: grantedIdentity(request.root, "0", request.gid, 0o510),
    rpcRunner: grantedIdentity(request.rpcRunner, "0", request.gid, 0o550),
    scratch: grantedIdentity(request.scratch, request.uid, request.gid, 0o700),
  });
}

async function closeHandles(handles: RetainedHandles): Promise<void> {
  const ordered = [
    handles.scratch,
    handles.rpcRunner,
    handles.candidate,
    handles.root,
    ...[...handles.ancestors].reverse(),
  ];
  const outcomes = await Promise.allSettled(ordered.map(async (handle) => await handle.close()));
  if (outcomes.some((outcome) => outcome.status === "rejected"))
    throw new TypeError("linux-dac:handle-close-refused");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseIdentity(input: unknown, type: "DIRECTORY" | "FILE"): LinuxDacIdentity | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== [...identityFields].sort().join("\0"))
    return undefined;
  if (
    record.type !== type ||
    typeof record.path !== "string" ||
    !isAbsolute(record.path) ||
    resolve(record.path) !== record.path ||
    !canonicalDecimal(record.device, 0n, 2n ** 63n - 1n) ||
    !canonicalDecimal(record.inode, 0n, 2n ** 63n - 1n) ||
    !canonicalDecimal(record.uid) ||
    !canonicalDecimal(record.gid) ||
    !canonicalDecimal(record.mode) ||
    BigInt(record.mode as string) > 0o7777n
  )
    return undefined;
  return Object.freeze({
    device: record.device,
    gid: record.gid,
    inode: record.inode,
    mode: record.mode,
    path: record.path,
    type,
    uid: record.uid,
  }) as LinuxDacIdentity;
}

function canonicalAncestorPaths(parentPath: string): readonly string[] {
  const filesystemRoot = parsePath(parentPath).root;
  if (!filesystemRoot || resolve(filesystemRoot) !== filesystemRoot)
    throw new TypeError("linux-dac:ancestor-root-refused");
  const paths = [filesystemRoot];
  let current = filesystemRoot;
  const remainder = relative(filesystemRoot, parentPath);
  for (const component of remainder === "" ? [] : remainder.split(sep)) {
    if (!component || component === "." || component === "..")
      throw new TypeError("linux-dac:ancestor-component-refused");
    current = resolve(current, component);
    paths.push(current);
  }
  return Object.freeze(paths);
}

function parseIntent(
  input: unknown,
  stableUid: number,
  stableGid: number,
): { readonly name: string; readonly request: LinuxDacRequest } | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "name\0request") return undefined;
  const principal = detachedPrincipal({
    gid: (record.request as Readonly<Record<string, unknown>> | undefined)?.gid,
    name: record.name,
    uid: (record.request as Readonly<Record<string, unknown>> | undefined)?.uid,
  });
  const value = record.request;
  if (!principal || value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const requestRecord = value as Readonly<Record<string, unknown>>;
  const fields = [
    "ancestors",
    "candidate",
    "gid",
    "operation",
    "parent",
    "root",
    "rpcRunner",
    "scratch",
    "stableGid",
    "stableUid",
    "uid",
  ];
  if (Object.keys(requestRecord).sort().join("\0") !== fields.sort().join("\0")) return undefined;
  if (
    !Array.isArray(requestRecord.ancestors) ||
    requestRecord.ancestors.length < 1 ||
    requestRecord.ancestors.length > 256
  )
    return undefined;
  const ancestors = requestRecord.ancestors.map((value) => parseIdentity(value, "DIRECTORY"));
  const parent = parseIdentity(requestRecord.parent, "DIRECTORY");
  const root = parseIdentity(requestRecord.root, "DIRECTORY");
  const candidate = parseIdentity(requestRecord.candidate, "FILE");
  const rpcRunner = parseIdentity(requestRecord.rpcRunner, "FILE");
  const scratch = parseIdentity(requestRecord.scratch, "DIRECTORY");
  if (
    ancestors.some((value) => !value) ||
    !parent ||
    !root ||
    !candidate ||
    !rpcRunner ||
    !scratch ||
    requestRecord.operation !== "RESTORE" ||
    requestRecord.uid !== principal.uid ||
    requestRecord.gid !== principal.gid ||
    requestRecord.stableUid !== String(stableUid) ||
    requestRecord.stableGid !== String(stableGid) ||
    requestRecord.uid === requestRecord.stableUid ||
    requestRecord.gid === requestRecord.stableGid ||
    ancestors.map((value) => value!.path).join("\0") !==
      canonicalAncestorPaths(parent.path).join("\0") ||
    !sameIdentity(ancestors.at(-1)!, parent) ||
    dirname(root.path) !== parent.path ||
    candidate.path !== resolve(root.path, "candidate.mjs") ||
    rpcRunner.path !== resolve(root.path, "rpc-runner.mjs") ||
    scratch.path !== resolve(root.path, "scratch") ||
    new Set([parent.device, root.device, candidate.device, rpcRunner.device, scratch.device])
      .size !== 1 ||
    parent.uid !== String(stableUid) ||
    parent.gid !== String(stableGid) ||
    parent.mode !== String(0o700) ||
    root.uid !== String(stableUid) ||
    root.gid !== String(stableGid) ||
    root.mode !== String(0o700) ||
    candidate.uid !== String(stableUid) ||
    candidate.gid !== String(stableGid) ||
    candidate.mode !== String(0o600) ||
    rpcRunner.uid !== String(stableUid) ||
    rpcRunner.gid !== String(stableGid) ||
    rpcRunner.mode !== String(0o600) ||
    scratch.uid !== String(stableUid) ||
    scratch.gid !== String(stableGid) ||
    scratch.mode !== String(0o700)
  )
    return undefined;
  const objectIdentities = [
    ...ancestors.map((value) => `${value!.device}:${value!.inode}`),
    ...[root, candidate, rpcRunner, scratch].map((value) => `${value.device}:${value.inode}`),
  ];
  if (new Set(objectIdentities).size !== objectIdentities.length) return undefined;
  return Object.freeze({
    name: principal.name,
    request: Object.freeze({
      ancestors: Object.freeze(ancestors as LinuxDacIdentity[]),
      candidate,
      gid: principal.gid,
      operation: "RESTORE",
      parent,
      root,
      rpcRunner,
      scratch,
      stableGid: String(stableGid),
      stableUid: String(stableUid),
      uid: principal.uid,
    }),
  });
}

async function createLinuxDacCustodyCore(
  options: LinuxDacCustodyOptions,
  dependencies: LinuxDacCustodyDependencies,
): Promise<LinuxDacCustody> {
  const { stableGid, stableUid } = dependencies;
  if (stableUid <= 0 || stableGid <= 0)
    throw new TypeError("linux-dac:stable-unprivileged-required");
  const stateRoot = await realpath(resolve(options.stateRoot));
  const stateIdentity = await lstat(stateRoot, { bigint: true });
  if (
    !stateIdentity.isDirectory() ||
    stateIdentity.isSymbolicLink() ||
    stateIdentity.uid !== BigInt(stableUid) ||
    (stateIdentity.mode & 0o77n) !== 0n
  )
    throw new TypeError("linux-dac:state-root-refused");
  const dacHelperPath = await realpath(resolve(options.dacHelperPath));
  const readProfile = options.profileReader ?? defaultProfileReader;
  const profiles = new Map<string, LinuxDacHelperProfile>();
  for (const [path, owner] of [
    [sudoPath, "ROOT"],
    [pythonPath, "ROOT"],
    [dacHelperPath, "STABLE"],
  ] as const) {
    const profile = detachedProfile(await readProfile(path, owner));
    if (!profile) throw new TypeError("linux-dac:helper-profile-refused");
    profiles.set(path, profile);
  }
  const run = options.commandRunner ?? nativeCommandRunner;
  const active = new Map<LinuxDacLease, ActiveLease>();

  async function requireCustody(): Promise<void> {
    const currentState = await lstat(stateRoot, { bigint: true });
    if (!sameDirectoryIdentity(stateIdentity, currentState))
      throw new TypeError("linux-dac:state-root-moved");
    for (const [path, profile] of profiles) {
      const observed = detachedProfile(
        await readProfile(path, path === dacHelperPath ? "STABLE" : "ROOT"),
      );
      if (!observed || !sameProfile(profile, observed))
        throw new TypeError("linux-dac:helper-moved");
    }
  }

  async function command(request: LinuxDacRequest, operation: "PREPARE" | "RESTORE") {
    await requireCustody();
    const commandRequest = Object.freeze({ ...request, operation });
    let untrusted: unknown;
    try {
      untrusted = await run({
        arguments: ["-n", pythonPath, "-I", "-B", dacHelperPath],
        file: sudoPath,
        inputText: JSON.stringify(commandRequest),
      });
    } finally {
      await requireCustody();
    }
    const result = detachedResult(untrusted);
    if (
      !result ||
      result.exitCode !== 0 ||
      result.signal !== null ||
      result.stderr !== "" ||
      result.stdout !== '{"ok":true}'
    )
      throw new TypeError(`linux-dac:${operation.toLowerCase()}-refused`);
  }

  async function writeIntent(
    intentPath: string,
    name: string,
    request: LinuxDacRequest,
  ): Promise<void> {
    const handle = await open(
      intentPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify({ name, request }), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await dependencies.syncStateDirectory(stateRoot);
  }

  async function removeIntent(
    intentPath: string,
    allowAbsent: boolean,
    onUnlinked: () => void = () => {},
  ): Promise<void> {
    try {
      await rm(intentPath, { force: false });
      onUnlinked();
    } catch (error) {
      if (!allowAbsent || (error as Readonly<{ code?: unknown }> | null)?.code !== "ENOENT")
        throw error;
    }
    await dependencies.syncStateDirectory(stateRoot);
    try {
      await lstat(intentPath);
      throw new TypeError("linux-dac:intent-residue");
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error as Readonly<{ code?: unknown }> | null)?.code !== "ENOENT"
      )
        throw error;
    }
  }

  async function requireRestoredPaths(request: LinuxDacRequest): Promise<void> {
    try {
      await lstat(request.scratch.path);
      throw new TypeError("linux-dac:scratch-residue");
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error as Readonly<{ code?: unknown }> | null)?.code !== "ENOENT"
      )
        throw error;
    }
    if ((await readdir(request.root.path)).sort().join("\0") !== "candidate.mjs\0rpc-runner.mjs")
      throw new TypeError("linux-dac:restored-census-refused");
  }

  async function capture(input: LinuxDacExecutionInput): Promise<{
    handles: RetainedHandles;
    request: LinuxDacRequest;
  }> {
    const principal = detachedPrincipal(input.principal);
    if (!principal || typeof input.rootPath !== "string" || !isAbsolute(input.rootPath))
      throw new TypeError("linux-dac:input-refused");
    const rootPath = await realpath(resolve(input.rootPath));
    if (rootPath !== resolve(input.rootPath)) throw new TypeError("linux-dac:root-alias-refused");
    const parentPath = dirname(rootPath);
    if ((await realpath(parentPath)) !== parentPath)
      throw new TypeError("linux-dac:parent-alias-refused");
    if ((await readdir(rootPath)).sort().join("\0") !== "candidate.mjs\0rpc-runner.mjs\0scratch")
      throw new TypeError("linux-dac:root-census-refused");
    const paths = {
      candidate: resolve(rootPath, "candidate.mjs"),
      parent: parentPath,
      root: rootPath,
      rpcRunner: resolve(rootPath, "rpc-runner.mjs"),
      scratch: resolve(rootPath, "scratch"),
    };
    const ancestorPaths = canonicalAncestorPaths(parentPath);
    const opened: Partial<{
      -readonly [Field in keyof RetainedHandles]: RetainedHandles[Field];
    }> = {};
    try {
      const ancestorHandles: Awaited<ReturnType<typeof open>>[] = [];
      for (const ancestorPath of ancestorPaths) {
        if ((await realpath(ancestorPath)) !== ancestorPath)
          throw new TypeError("linux-dac:ancestor-alias-refused");
        ancestorHandles.push(
          await open(
            ancestorPath,
            constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
          ),
        );
      }
      opened.ancestors = ancestorHandles;
      opened.parent = ancestorHandles.at(-1)!;
      opened.root = await open(
        paths.root,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
      );
      opened.candidate = await open(
        paths.candidate,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      opened.rpcRunner = await open(
        paths.rpcRunner,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      opened.scratch = await open(
        paths.scratch,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
      );
      const handles = opened as RetainedHandles;
      const ancestors = Object.freeze(
        await Promise.all(
          ancestorPaths.map(async (path, index) =>
            identity(path, "DIRECTORY", await handles.ancestors[index]!.stat({ bigint: true })),
          ),
        ),
      );
      const request: LinuxDacRequest = Object.freeze({
        ancestors,
        candidate: identity(
          paths.candidate,
          "FILE",
          await handles.candidate.stat({ bigint: true }),
        ),
        gid: principal.gid,
        operation: "RESTORE",
        parent: ancestors.at(-1)!,
        root: identity(paths.root, "DIRECTORY", await handles.root.stat({ bigint: true })),
        rpcRunner: identity(
          paths.rpcRunner,
          "FILE",
          await handles.rpcRunner.stat({ bigint: true }),
        ),
        scratch: identity(paths.scratch, "DIRECTORY", await handles.scratch.stat({ bigint: true })),
        stableGid: String(stableGid),
        stableUid: String(stableUid),
        uid: principal.uid,
      });
      if (!parseIntent({ name: principal.name, request }, stableUid, stableGid))
        throw new TypeError("linux-dac:original-profile-refused");
      return { handles, request };
    } catch (error) {
      const childHandles = [opened.scratch, opened.rpcRunner, opened.candidate, opened.root].filter(
        (handle) => handle !== undefined,
      );
      await Promise.allSettled(
        [...childHandles, ...[...(opened.ancestors ?? [])].reverse()].map(
          async (handle) => await handle.close(),
        ),
      );
      throw error;
    }
  }

  async function requireHandleProfiles(
    handles: RetainedHandles,
    expected: LinuxDacRequest,
  ): Promise<void> {
    if (handles.ancestors.length !== expected.ancestors.length)
      throw new TypeError("linux-dac:ancestor-handle-census-refused");
    for (const [index, expectedAncestor] of expected.ancestors.entries()) {
      const observed = identity(
        expectedAncestor.path,
        "DIRECTORY",
        await handles.ancestors[index]!.stat({ bigint: true }),
      );
      if (!sameIdentity(observed, expectedAncestor))
        throw new TypeError("linux-dac:ancestor-handle-moved");
    }
    for (const field of ["root", "candidate", "rpcRunner", "scratch"] as const) {
      const observed = identity(
        expected[field].path,
        expected[field].type,
        await handles[field].stat({ bigint: true }),
      );
      if (!sameIdentity(observed, expected[field]))
        throw new TypeError(`linux-dac:${field}-handle-moved`);
    }
  }

  const custody: LinuxDacCustody = {
    async prepareAccess(input) {
      await requireCustody();
      const principal = detachedPrincipal(input.principal);
      if (!principal) throw new TypeError("linux-dac:principal-refused");
      const { handles, request } = await capture(input);
      const intentPath = resolve(stateRoot, `${intentPrefix}${principal.name}.json`);
      if (!below(stateRoot, intentPath)) {
        await closeHandles(handles);
        throw new TypeError("linux-dac:intent-path-refused");
      }
      try {
        await writeIntent(intentPath, principal.name, request);
      } catch (error) {
        await closeHandles(handles);
        throw error;
      }
      try {
        await command(request, "PREPARE");
        await requireHandleProfiles(handles, grantedRequest(request));
      } catch (error) {
        try {
          await command(request, "RESTORE");
          await requireHandleProfiles(handles, request);
          await requireRestoredPaths(request);
          await removeIntent(intentPath, false);
        } catch {
          await closeHandles(handles);
          throw new TypeError("linux-dac:prepare-reversal-refused");
        }
        await closeHandles(handles);
        throw error;
      }
      const lease = Object.freeze({ name: principal.name });
      active.set(lease, { handles, intentPath, intentUnlinked: false, request });
      return lease;
    },
    async recover() {
      await requireCustody();
      await dependencies.syncStateDirectory(stateRoot);
      const entries = (await readdir(stateRoot, { withFileTypes: true })).filter((entry) =>
        entry.name.startsWith(intentPrefix),
      );
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
          throw new TypeError("linux-dac:state-census-refused");
        const intentPath = resolve(stateRoot, entry.name);
        const handle = await open(intentPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let parsed: ReturnType<typeof parseIntent>;
        try {
          const observed = await handle.stat({ bigint: true });
          if (
            !observed.isFile() ||
            observed.uid !== BigInt(stableUid) ||
            (observed.mode & 0o77n) !== 0n
          )
            throw new TypeError("linux-dac:intent-profile-refused");
          const bytes = await handle.readFile("utf8");
          const value = JSON.parse(bytes) as unknown;
          parsed = parseIntent(value, stableUid, stableGid);
          if (
            !parsed ||
            bytes !== JSON.stringify(parsed) ||
            entry.name !== `${intentPrefix}${parsed.name}.json`
          )
            throw new TypeError("linux-dac:intent-refused");
        } finally {
          await handle.close();
        }
        await command(parsed.request, "RESTORE");
        await requireRestoredPaths(parsed.request);
        await removeIntent(intentPath, false);
      }
    },
    async restoreAccess(lease) {
      const retained = active.get(lease);
      if (!retained) throw new TypeError("linux-dac:lease-refused");
      await command(retained.request, "RESTORE");
      await requireHandleProfiles(retained.handles, retained.request);
      await requireRestoredPaths(retained.request);
      await removeIntent(retained.intentPath, retained.intentUnlinked, () => {
        retained.intentUnlinked = true;
      });
      active.delete(lease);
      await closeHandles(retained.handles);
    },
  };
  await custody.recover();
  return Object.freeze(custody);
}

export async function createLinuxDacCustody(
  options: LinuxDacCustodyOptions,
): Promise<LinuxDacCustody> {
  if (nativeHostPlatform !== "linux") throw new TypeError("linux-dac:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("linux-dac:posix-identities-required");
  return await createLinuxDacCustodyCore(options, {
    stableGid: process.getgid(),
    stableUid: process.getuid(),
    syncStateDirectory: syncDirectory,
  });
}

export async function createLinuxDacCustodyTestFixture(
  options: LinuxDacCustodyOptions,
  dependencies: LinuxDacCustodyDependencies,
): Promise<LinuxDacCustody> {
  return await createLinuxDacCustodyCore(options, dependencies);
}

export async function runLinuxDacCommandTestFixture(
  request: LinuxDacCommandRequest,
): Promise<LinuxDacCommandResult> {
  return await nativeCommandRunner(request);
}

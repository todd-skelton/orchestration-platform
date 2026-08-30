import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types as nodeTypes } from "node:util";

import {
  parseCanonicalContractBytes,
  snapshotClosedRecord,
  type ContractRecord,
} from "@orchestration-platform/contracts";

import {
  resolveConfigurationFromAdmittedPaths,
  type ConfigurationResolutionFailure,
  type ConfigurationResolutionResult,
  type ConfigurationResolverOperatingSystem,
} from "./resolver.js";
import {
  createWindowsReparseFactAdapter,
  parseWindowsReparseFactForTesting,
  type WindowsReparseFact,
  type WindowsReparseFactResult,
} from "./windows-reparse-fact.js";

export type { WindowsReparseFact } from "./windows-reparse-fact.js";

export interface ConfigurationLoaderInvocation {
  readonly cwd: string;
  readonly operatingSystem: ConfigurationResolverOperatingSystem;
  readonly flags: Readonly<{
    configPath: string | null;
    projectRoot: string | null;
    stateRoot: string | null;
  }>;
  readonly environment: Readonly<{
    HOME: string | null;
    LOCALAPPDATA: string | null;
    ORCHESTRATION_CONFIG: string | null;
    ORCHESTRATION_PROJECT_ROOT: string | null;
    ORCHESTRATION_STATE_ROOT: string | null;
    XDG_STATE_HOME: string | null;
  }>;
}

export type ConfigurationLoadResult =
  | ConfigurationResolutionResult
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "PROJECT_ROOT_REFUSED" | "FILESYSTEM_OPERATION_FAILED";
        exitCode: 3 | 5;
        message: "project root refused" | "filesystem operation failed";
        outcome: "authority-refused" | "operation-failed";
      }>;
    }>;

export type ConfigurationHostAdapter =
  | Readonly<{
      operatingSystem: "MACOS" | "LINUX";
    }>
  | Readonly<{
      operatingSystem: "WINDOWS";
      observeReparseFact(
        path: string,
      ): WindowsReparseFactResult | Promise<WindowsReparseFactResult>;
    }>;

export type LoadConfiguration = (
  invocation: ConfigurationLoaderInvocation,
) => Promise<ConfigurationLoadResult>;

interface PathFact {
  readonly device: string;
  readonly inode: string;
  readonly kind: "DIRECTORY" | "REGULAR_FILE" | "SYMLINK" | "OTHER";
  readonly mode: string;
  readonly reparsePoint: boolean;
  readonly windowsIdentity: string | null;
  readonly windowsNodeDevice: string | null;
  readonly windowsNodeInode: string | null;
}

interface CapturedPath {
  readonly fact: PathFact;
  readonly path: string;
  readonly physicalPath: string;
}

interface RetainedPath {
  readonly captured: CapturedPath;
  readonly handle: FileHandle;
}

const invocationFields = Object.freeze(["cwd", "environment", "flags", "operatingSystem"] as const);
const flagFields = Object.freeze(["configPath", "projectRoot", "stateRoot"] as const);
const environmentFields = Object.freeze([
  "HOME",
  "LOCALAPPDATA",
  "ORCHESTRATION_CONFIG",
  "ORCHESTRATION_PROJECT_ROOT",
  "ORCHESTRATION_STATE_ROOT",
  "XDG_STATE_HOME",
] as const);
const adapterWindowsFields = Object.freeze(["observeReparseFact", "operatingSystem"] as const);
const adapterPortableFields = Object.freeze(["operatingSystem"] as const);
const windowsObservationSuccessFields = Object.freeze(["ok", "value"] as const);
const adapterObservationTimeoutMs = 6_000;

const failures = Object.freeze({
  ARGV_REFUSED: Object.freeze({
    code: "ARGV_REFUSED",
    exitCode: 2,
    message: "command line refused",
    outcome: "invalid-input",
  }),
  CONFIG_REFUSED: Object.freeze({
    code: "CONFIG_REFUSED",
    exitCode: 2,
    message: "configuration refused",
    outcome: "invalid-input",
  }),
  PROJECT_ROOT_REFUSED: Object.freeze({
    code: "PROJECT_ROOT_REFUSED",
    exitCode: 3,
    message: "project root refused",
    outcome: "authority-refused",
  }),
  PATH_REFUSED: Object.freeze({
    code: "PATH_REFUSED",
    exitCode: 3,
    message: "path refused",
    outcome: "authority-refused",
  }),
  FILESYSTEM_OPERATION_FAILED: Object.freeze({
    code: "FILESYSTEM_OPERATION_FAILED",
    exitCode: 5,
    message: "filesystem operation failed",
    outcome: "operation-failed",
  }),
  INTERNAL_ERROR: Object.freeze({
    code: "INTERNAL_ERROR",
    exitCode: 70,
    message: "internal error",
    outcome: "internal-error",
  }),
} as const);

type FailureCode = keyof typeof failures;

class LoaderRefusal extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

function refused<Code extends FailureCode>(
  code: Code,
): Readonly<{ ok: false; error: (typeof failures)[Code] }> {
  return Object.freeze({ ok: false, error: failures[code] });
}

function plainRecord(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key))
    )
      return null;
    const copy: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      copy[field] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function inspectAdapter(input: unknown): ConfigurationHostAdapter | null {
  const operatingSystem = (() => {
    try {
      if (input === null || typeof input !== "object" || nodeTypes.isProxy(input)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, "operatingSystem");
      return descriptor && "value" in descriptor ? descriptor.value : null;
    } catch {
      return null;
    }
  })();
  const fields = operatingSystem === "WINDOWS" ? adapterWindowsFields : adapterPortableFields;
  const record = plainRecord(input, fields);
  if (
    record === null ||
    !["WINDOWS", "MACOS", "LINUX"].includes(String(record.operatingSystem)) ||
    (record.operatingSystem === "WINDOWS" && typeof record.observeReparseFact !== "function")
  )
    return null;
  if (record.operatingSystem === "WINDOWS") {
    const observe = record.observeReparseFact as (
      path: string,
    ) => WindowsReparseFactResult | Promise<WindowsReparseFactResult>;
    return Object.freeze({
      operatingSystem: "WINDOWS" as const,
      observeReparseFact(path: string) {
        return Reflect.apply(observe, undefined, [path]) as
          WindowsReparseFactResult | Promise<WindowsReparseFactResult>;
      },
    });
  }
  return Object.freeze({
    operatingSystem: record.operatingSystem as "MACOS" | "LINUX",
  });
}

function observeReparsePoint(
  adapter: Extract<ConfigurationHostAdapter, { operatingSystem: "WINDOWS" }>,
  path: string,
): Promise<WindowsReparseFactResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(
      () => finish(() => reject(new TypeError("adapter observation timed out"))),
      adapterObservationTimeoutMs,
    );
    let observation: unknown;
    try {
      observation = adapter.observeReparseFact(path);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    Promise.resolve(observation).then(
      (value) => finish(() => resolve(value as WindowsReparseFactResult)),
      (error) => finish(() => reject(error)),
    );
  });
}

function pathApi(operatingSystem: ConfigurationResolverOperatingSystem) {
  return operatingSystem === "WINDOWS" ? win32 : posix;
}

function canonicalLocalPath(
  operatingSystem: ConfigurationResolverOperatingSystem,
  value: unknown,
): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) return false;
  const paths = pathApi(operatingSystem);
  if (!paths.isAbsolute(value) || paths.normalize(value) !== value) return false;
  const parsed = paths.parse(value);
  if (operatingSystem === "WINDOWS") {
    if (!/^[A-Z]:\\$/.test(parsed.root) || value.includes("/")) return false;
  } else if (parsed.root !== "/" || (value.length > 1 && value.endsWith("/"))) {
    return false;
  }
  const relative = value.slice(parsed.root.length);
  const segments = relative.length === 0 ? [] : relative.split(paths.sep);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".."))
    return false;
  if (
    operatingSystem === "WINDOWS" &&
    segments.some(
      (segment) =>
        /[\u0000-\u001f<>:"/\\|?*]/.test(segment) ||
        /[ .]$/.test(segment) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(segment),
    )
  )
    return false;
  try {
    const windows = operatingSystem === "WINDOWS";
    const url = !windows && value === "/" ? new URL("file:///") : pathToFileURL(value, { windows });
    return url.hostname === "" && fileURLToPath(url, { windows }) === value;
  } catch {
    return false;
  }
}

function pathComponents(
  operatingSystem: ConfigurationResolverOperatingSystem,
  value: string,
): readonly string[] {
  const paths = pathApi(operatingSystem);
  const root = paths.parse(value).root;
  const result = [root];
  let current = root;
  for (const segment of value.slice(root.length).split(paths.sep).filter(Boolean)) {
    current = paths.join(current, segment);
    result.push(current);
  }
  return Object.freeze(result);
}

function inside(
  operatingSystem: ConfigurationResolverOperatingSystem,
  parent: string,
  child: string,
  allowEqual: boolean,
): boolean {
  const paths = pathApi(operatingSystem);
  const relative = paths.relative(parent, child);
  return relative === ""
    ? allowEqual
    : relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}

function statsFact(
  value: BigIntStats,
  reparsePoint: boolean,
  windowsIdentity: string | null = null,
  windowsNodeDevice: string | null = null,
  windowsNodeInode: string | null = null,
): PathFact {
  return Object.freeze({
    device: value.dev.toString(10),
    inode: value.ino.toString(10),
    kind: value.isSymbolicLink()
      ? "SYMLINK"
      : value.isDirectory()
        ? "DIRECTORY"
        : value.isFile()
          ? "REGULAR_FILE"
          : "OTHER",
    mode: value.mode.toString(10),
    reparsePoint,
    windowsIdentity,
    windowsNodeDevice,
    windowsNodeInode,
  });
}

function sameFact(left: PathFact, right: PathFact): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.reparsePoint === right.reparsePoint &&
    left.windowsIdentity === right.windowsIdentity &&
    left.windowsNodeDevice === right.windowsNodeDevice &&
    left.windowsNodeInode === right.windowsNodeInode
  );
}

function retainedCoordinatesMatch(captured: PathFact, retained: BigIntStats): boolean {
  return (
    captured.windowsNodeDevice === null ||
    (BigInt(captured.windowsNodeDevice) === retained.dev &&
      captured.windowsNodeInode !== null &&
      BigInt(captured.windowsNodeInode) === retained.ino)
  );
}

function sameNodeFact(left: PathFact, right: PathFact): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.kind === right.kind &&
    left.mode === right.mode
  );
}

function sameIdentity(left: PathFact, right: PathFact): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function successfulWindowsFact(input: unknown): WindowsReparseFact | undefined {
  const observed = plainRecord(input, windowsObservationSuccessFields);
  return observed !== null && observed.ok === true
    ? parseWindowsReparseFactForTesting(observed.value)
    : undefined;
}

async function nativeFact(
  adapter: ConfigurationHostAdapter,
  path: string,
): Promise<PathFact | null> {
  let value: BigIntStats;
  try {
    value = await lstat(path, { bigint: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return null;
    throw new LoaderRefusal("FILESYSTEM_OPERATION_FAILED");
  }
  let reparsePoint = value.isSymbolicLink();
  let windowsIdentity: string | null = null;
  let windowsNodeDevice: string | null = null;
  let windowsNodeInode: string | null = null;
  if (adapter.operatingSystem === "WINDOWS") {
    let observed: WindowsReparseFactResult;
    try {
      observed = await observeReparsePoint(adapter, path);
    } catch {
      throw new LoaderRefusal("PATH_REFUSED");
    }
    const fact = successfulWindowsFact(observed);
    if (
      fact === undefined ||
      fact.kind !== (value.isDirectory() ? "DIRECTORY" : value.isFile() ? "FILE" : "OTHER") ||
      BigInt(fact.identity.nodeDevice.decimal) !== value.dev ||
      BigInt(fact.identity.nodeInode.decimal) !== value.ino
    )
      throw new LoaderRefusal("PATH_REFUSED");
    reparsePoint ||= fact.reparsePoint;
    windowsIdentity = `${fact.identity.volumeSerialNumber}:${fact.identity.fileId}`;
    windowsNodeDevice = fact.identity.nodeDevice.decimal;
    windowsNodeInode = fact.identity.nodeInode.decimal;
    let after: BigIntStats;
    try {
      after = await lstat(path, { bigint: true });
    } catch {
      throw new LoaderRefusal("PATH_REFUSED");
    }
    if (
      after.dev !== value.dev ||
      after.ino !== value.ino ||
      after.mode !== value.mode ||
      after.isSymbolicLink() !== value.isSymbolicLink()
    )
      throw new LoaderRefusal("PATH_REFUSED");
    value = after;
  }
  return statsFact(value, reparsePoint, windowsIdentity, windowsNodeDevice, windowsNodeInode);
}

async function inspectPath(
  adapter: ConfigurationHostAdapter,
  path: string,
): Promise<CapturedPath | null> {
  const fact = await nativeFact(adapter, path);
  if (fact === null) return null;
  if (fact.kind === "SYMLINK" || fact.reparsePoint) throw new LoaderRefusal("PATH_REFUSED");
  let physicalPath: string;
  try {
    physicalPath = await realpath(path);
  } catch {
    throw new LoaderRefusal("FILESYSTEM_OPERATION_FAILED");
  }
  if (!canonicalLocalPath(adapter.operatingSystem, physicalPath) || physicalPath !== path)
    throw new LoaderRefusal("PATH_REFUSED");
  return Object.freeze({ fact, path, physicalPath });
}

async function requiredPath(
  adapter: ConfigurationHostAdapter,
  path: string,
  leafKind: "DIRECTORY" | "REGULAR_FILE",
): Promise<readonly CapturedPath[]> {
  const components = pathComponents(adapter.operatingSystem, path);
  const captured: CapturedPath[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const current = await inspectPath(adapter, components[index]!);
    if (current === null) throw new LoaderRefusal("PATH_REFUSED");
    const expected = index === components.length - 1 ? leafKind : "DIRECTORY";
    if (current.fact.kind !== expected) throw new LoaderRefusal("PATH_REFUSED");
    captured.push(current);
  }
  return Object.freeze(captured);
}

async function statePath(
  adapter: ConfigurationHostAdapter,
  path: string,
): Promise<
  Readonly<{
    absentPath: string | null;
    captured: readonly CapturedPath[];
    disposition: "ABSENT" | "DIRECTORY";
  }>
> {
  const components = pathComponents(adapter.operatingSystem, path);
  const captured: CapturedPath[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const current = await inspectPath(adapter, components[index]!);
    if (current === null) {
      if (index === 0) throw new LoaderRefusal("PATH_REFUSED");
      return Object.freeze({
        absentPath: components[index]!,
        captured: Object.freeze(captured),
        disposition: "ABSENT",
      });
    }
    if (current.fact.kind !== "DIRECTORY") throw new LoaderRefusal("PATH_REFUSED");
    captured.push(current);
  }
  return Object.freeze({
    absentPath: null,
    captured: Object.freeze(captured),
    disposition: "DIRECTORY",
  });
}

async function retainPaths(captured: readonly CapturedPath[]): Promise<readonly RetainedPath[]> {
  const unique = [...new Map(captured.map((entry) => [entry.path, entry])).values()];
  const retained: RetainedPath[] = [];
  try {
    for (const entry of unique) {
      const handle = await open(entry.path, constants.O_RDONLY);
      retained.push(Object.freeze({ captured: entry, handle }));
      const held = await handle.stat({ bigint: true });
      if (
        !sameNodeFact(entry.fact, statsFact(held, false)) ||
        !retainedCoordinatesMatch(entry.fact, held)
      )
        throw new LoaderRefusal("PATH_REFUSED");
    }
    return Object.freeze(retained);
  } catch (error) {
    await Promise.allSettled(retained.map(({ handle }) => handle.close()));
    if (error instanceof LoaderRefusal) throw error;
    throw new LoaderRefusal("FILESYSTEM_OPERATION_FAILED");
  }
}

async function finalCensus(
  adapter: ConfigurationHostAdapter,
  retained: readonly RetainedPath[],
  absentPaths: readonly string[],
): Promise<void> {
  for (const path of absentPaths)
    if ((await inspectPath(adapter, path)) !== null) throw new LoaderRefusal("PATH_REFUSED");
  for (const entry of [...retained].reverse()) {
    let freshHandle: FileHandle | null = null;
    try {
      freshHandle = await open(entry.captured.path, constants.O_RDONLY);
      const [pathFact, retainedStats, freshStats] = await Promise.all([
        inspectPath(adapter, entry.captured.path),
        entry.handle.stat({ bigint: true }),
        freshHandle.stat({ bigint: true }),
      ]);
      if (
        pathFact === null ||
        !sameFact(entry.captured.fact, pathFact.fact) ||
        pathFact.physicalPath !== entry.captured.physicalPath ||
        !sameNodeFact(entry.captured.fact, statsFact(retainedStats, false)) ||
        !retainedCoordinatesMatch(entry.captured.fact, retainedStats) ||
        !sameNodeFact(entry.captured.fact, statsFact(freshStats, false)) ||
        !retainedCoordinatesMatch(entry.captured.fact, freshStats)
      )
        throw new LoaderRefusal("PATH_REFUSED");
    } catch (error) {
      if (error instanceof LoaderRefusal) throw error;
      throw new LoaderRefusal("PATH_REFUSED");
    } finally {
      await freshHandle?.close().catch(() => undefined);
    }
  }
}

function selected(primary: unknown, secondary: unknown): string | null {
  return typeof primary === "string" ? primary : typeof secondary === "string" ? secondary : null;
}

function defaultStateRoot(
  operatingSystem: ConfigurationResolverOperatingSystem,
  environment: Record<string, unknown>,
  projectId: string,
): string | null {
  if (operatingSystem === "WINDOWS")
    return typeof environment.LOCALAPPDATA === "string"
      ? win32.join(environment.LOCALAPPDATA, "orchestration-platform", projectId)
      : null;
  if (operatingSystem === "MACOS")
    return typeof environment.HOME === "string"
      ? posix.join(
          environment.HOME,
          "Library/Application Support",
          "orchestration-platform",
          projectId,
        )
      : null;
  const base =
    typeof environment.XDG_STATE_HOME === "string" ? environment.XDG_STATE_HOME : environment.HOME;
  if (typeof base !== "string") return null;
  return typeof environment.XDG_STATE_HOME === "string"
    ? posix.join(base, "orchestration-platform", projectId)
    : posix.join(base, ".local/state", "orchestration-platform", projectId);
}

function hostPathFromSourceStateRoot(
  operatingSystem: ConfigurationResolverOperatingSystem,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const windows = operatingSystem === "WINDOWS";
    const path = fileURLToPath(value, { windows });
    return pathToFileURL(path, { windows }).href === value ? path : null;
  } catch {
    return null;
  }
}

function validateInvocation(input: unknown):
  | Readonly<{
      ok: true;
      cwd: string;
      environment: Record<string, unknown>;
      flags: Record<string, unknown>;
      operatingSystem: ConfigurationResolverOperatingSystem;
    }>
  | Readonly<{ ok: false; code: "ARGV_REFUSED" | "CONFIG_REFUSED" }> {
  const invocation = plainRecord(input, invocationFields);
  if (invocation === null) return { ok: false, code: "ARGV_REFUSED" };
  const flags = plainRecord(invocation.flags, flagFields);
  if (
    flags === null ||
    typeof invocation.cwd !== "string" ||
    !["WINDOWS", "MACOS", "LINUX"].includes(String(invocation.operatingSystem)) ||
    flagFields.some(
      (field) => flags[field] !== null && (typeof flags[field] !== "string" || flags[field] === ""),
    )
  )
    return { ok: false, code: "ARGV_REFUSED" };
  const environment = plainRecord(invocation.environment, environmentFields);
  if (
    environment === null ||
    environmentFields.some(
      (field) =>
        environment[field] !== null &&
        (typeof environment[field] !== "string" || environment[field] === ""),
    )
  )
    return { ok: false, code: "CONFIG_REFUSED" };
  return {
    ok: true,
    cwd: invocation.cwd,
    environment,
    flags,
    operatingSystem: invocation.operatingSystem as ConfigurationResolverOperatingSystem,
  };
}

async function discoverProjectRoot(
  adapter: ConfigurationHostAdapter,
  cwd: string,
): Promise<Readonly<{ absentCandidates: readonly string[]; projectRoot: string }>> {
  await requiredPath(adapter, cwd, "DIRECTORY");
  const paths = pathApi(adapter.operatingSystem);
  const ancestors: string[] = [];
  let current = cwd;
  while (true) {
    ancestors.push(current);
    const parent = paths.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const candidates: string[] = [];
  const absentCandidates: string[] = [];
  for (const ancestor of ancestors) {
    const candidate = paths.join(ancestor, ".orchestration", "project.json");
    const fact = await inspectPath(adapter, candidate);
    if (fact === null) absentCandidates.push(candidate);
    else if (fact.fact.kind === "REGULAR_FILE") candidates.push(ancestor);
    else throw new LoaderRefusal("PATH_REFUSED");
  }
  if (candidates.length !== 1) throw new LoaderRefusal("PROJECT_ROOT_REFUSED");
  return Object.freeze({
    absentCandidates: Object.freeze(absentCandidates),
    projectRoot: candidates[0]!,
  });
}

async function loadWithAdapter(
  adapter: ConfigurationHostAdapter,
  input: unknown,
): Promise<ConfigurationLoadResult> {
  const invocation = validateInvocation(input);
  if (!invocation.ok) return refused(invocation.code);
  if (invocation.operatingSystem !== adapter.operatingSystem) return refused("ARGV_REFUSED");
  if (
    !canonicalLocalPath(invocation.operatingSystem, invocation.cwd) ||
    flagFields.some((field) =>
      typeof invocation.flags[field] === "string"
        ? !canonicalLocalPath(invocation.operatingSystem, invocation.flags[field])
        : false,
    ) ||
    ["ORCHESTRATION_CONFIG", "ORCHESTRATION_PROJECT_ROOT", "ORCHESTRATION_STATE_ROOT"].some(
      (field) =>
        typeof invocation.environment[field] === "string"
          ? !canonicalLocalPath(invocation.operatingSystem, invocation.environment[field])
          : false,
    )
  )
    return refused("PATH_REFUSED");

  const retained: RetainedPath[] = [];
  try {
    const explicitProjectRoot = selected(
      invocation.flags.projectRoot,
      invocation.environment.ORCHESTRATION_PROJECT_ROOT,
    );
    const discovery =
      explicitProjectRoot === null
        ? await discoverProjectRoot(adapter, invocation.cwd)
        : Object.freeze({
            absentCandidates: Object.freeze([] as string[]),
            projectRoot: explicitProjectRoot,
          });
    const projectRoot = discovery.projectRoot;
    if (!canonicalLocalPath(invocation.operatingSystem, projectRoot))
      throw new LoaderRefusal("PATH_REFUSED");
    const configPath =
      selected(invocation.flags.configPath, invocation.environment.ORCHESTRATION_CONFIG) ??
      pathApi(invocation.operatingSystem).join(projectRoot, ".orchestration", "project.json");
    if (
      !canonicalLocalPath(invocation.operatingSystem, configPath) ||
      !inside(invocation.operatingSystem, projectRoot, configPath, false)
    )
      throw new LoaderRefusal("PATH_REFUSED");

    const projectCaptured = await requiredPath(adapter, projectRoot, "DIRECTORY");
    const configCaptured = await requiredPath(adapter, configPath, "REGULAR_FILE");
    retained.push(...(await retainPaths([...projectCaptured, ...configCaptured])));
    const configurationHandle = retained.find(
      ({ captured }) => captured.path === configPath,
    )?.handle;
    if (!configurationHandle) throw new LoaderRefusal("INTERNAL_ERROR");
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = Uint8Array.from(await configurationHandle.readFile());
    } catch {
      throw new LoaderRefusal("FILESYSTEM_OPERATION_FAILED");
    }
    const source = parseCanonicalContractBytes("platform-configuration-source/v1", sourceBytes);
    if (!source.ok) throw new LoaderRefusal("CONFIG_REFUSED");
    const sourceRecord = source.value as ContractRecord;

    const stateRoot =
      selected(invocation.flags.stateRoot, invocation.environment.ORCHESTRATION_STATE_ROOT) ??
      hostPathFromSourceStateRoot(invocation.operatingSystem, sourceRecord.stateRoot) ??
      defaultStateRoot(
        invocation.operatingSystem,
        invocation.environment,
        String(sourceRecord.projectId),
      );
    if (stateRoot === null || !canonicalLocalPath(invocation.operatingSystem, stateRoot))
      throw new LoaderRefusal("PATH_REFUSED");
    if (
      inside(invocation.operatingSystem, projectRoot, stateRoot, true) ||
      inside(invocation.operatingSystem, stateRoot, projectRoot, true)
    )
      throw new LoaderRefusal("PATH_REFUSED");

    const state = await statePath(adapter, stateRoot);
    const alreadyRetained = new Set(retained.map(({ captured }) => captured.path));
    retained.push(
      ...(await retainPaths(state.captured.filter(({ path }) => !alreadyRetained.has(path)))),
    );
    const projectLeaf = projectCaptured.at(-1)!;
    if (state.captured.some(({ fact }) => sameIdentity(projectLeaf.fact, fact)))
      throw new LoaderRefusal("PATH_REFUSED");
    const stateLeaf = state.disposition === "DIRECTORY" ? state.captured.at(-1)! : null;
    if (stateLeaf && projectCaptured.some(({ fact }) => sameIdentity(stateLeaf.fact, fact)))
      throw new LoaderRefusal("PATH_REFUSED");

    const reducedInvocation = Object.freeze({
      environment: Object.freeze({ ...invocation.environment }),
      flags: Object.freeze({ ...invocation.flags }),
      operatingSystem: invocation.operatingSystem,
    });
    const result = resolveConfigurationFromAdmittedPaths(reducedInvocation, sourceRecord, {
      configPath,
      projectRoot,
      stateRoot,
      stateRootDisposition: state.disposition,
    });
    if (!result.ok) return result;
    const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
    if ((await fileDigest(configurationHandle)) !== sourceDigest)
      throw new LoaderRefusal("PATH_REFUSED");
    const absentPaths = [
      ...discovery.absentCandidates,
      ...(state.absentPath === null ? [] : [state.absentPath]),
    ];
    await finalCensus(adapter, retained, absentPaths);
    return result;
  } catch (error) {
    if (!(error instanceof LoaderRefusal)) return refused("INTERNAL_ERROR");
    switch (error.code) {
      case "ARGV_REFUSED":
        return refused("ARGV_REFUSED");
      case "CONFIG_REFUSED":
        return refused("CONFIG_REFUSED");
      case "PROJECT_ROOT_REFUSED":
        return refused("PROJECT_ROOT_REFUSED");
      case "PATH_REFUSED":
        return refused("PATH_REFUSED");
      case "FILESYSTEM_OPERATION_FAILED":
        return refused("FILESYSTEM_OPERATION_FAILED");
      case "INTERNAL_ERROR":
        return refused("INTERNAL_ERROR");
    }
  } finally {
    await Promise.allSettled(retained.map(({ handle }) => handle.close()));
  }
}

export function createConfigurationLoader(
  adapterInput: ConfigurationHostAdapter,
): LoadConfiguration {
  const adapter = inspectAdapter(adapterInput);
  if (adapter === null) {
    return async () => refused("INTERNAL_ERROR");
  }
  return (invocation) => loadWithAdapter(adapter, invocation);
}

export function createPortableConfigurationHostAdapter(
  operatingSystem: "MACOS" | "LINUX",
): ConfigurationHostAdapter {
  return Object.freeze({ operatingSystem });
}

async function fileDigest(handle: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function createWindowsConfigurationHostAdapter(): ConfigurationHostAdapter {
  const native = createWindowsReparseFactAdapter("WINDOWS");
  const observe = native.observe;
  return Object.freeze({
    operatingSystem: "WINDOWS" as const,
    observeReparseFact(path: string) {
      return Reflect.apply(observe, undefined, [path]) as WindowsReparseFactResult;
    },
  });
}

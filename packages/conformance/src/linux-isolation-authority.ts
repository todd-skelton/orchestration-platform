import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { types as nodeTypes } from "node:util";
import {
  createLinuxAccountCustody,
  type LinuxAccountCustody,
  type LinuxAccountCustodyOptions,
  type LinuxAccountPrincipal,
} from "./linux-account-custody.js";
import {
  createLinuxDacCustody,
  type LinuxDacCustody,
  type LinuxDacCustodyOptions,
  type LinuxDacHelperProfile,
  type LinuxDacLease,
} from "./linux-dac-custody.js";
import {
  createLinuxExecutionCustody,
  type LinuxExecutionCustody,
  type LinuxExecutionCustodyOptions,
  type LinuxExecutionLease,
} from "./linux-execution-custody.js";
import {
  createLinuxProcessCustody,
  type LinuxProcessCustody,
  type LinuxProcessCustodyOptions,
} from "./linux-process-custody.js";
import type {
  Iss002IsolatedTerminalObservation,
  Iss002IsolationLaunchRequest,
  Iss002StableIsolationAuthority,
} from "./isolated-walk.js";

const nativeHostPlatform = process.platform;
const nativeEnvironmentPath = "/usr/bin/env";
const nativeSetprivPath = "/usr/bin/setpriv";
const nativeSudoPath = "/usr/bin/sudo";
const maximumOutputBytes = 4 * 1024 * 1024;

export interface LinuxIsolationAuthorityOptions {
  readonly account: LinuxAccountCustodyOptions;
  readonly dac: LinuxDacCustodyOptions;
  readonly execution: LinuxExecutionCustodyOptions;
  readonly process: LinuxProcessCustodyOptions;
  readonly profileReader?: (
    path: string,
    owner: "ROOT" | "STABLE",
  ) => Promise<LinuxDacHelperProfile>;
  readonly runtimePath: string;
}

export interface LinuxIsolationAuthority extends Iss002StableIsolationAuthority {
  close(): Promise<void>;
}

export interface LinuxCandidateLaunchCommand {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly file: string;
  readonly inputText: string;
  readonly timeoutMilliseconds: 5000;
}

interface CompositionDependencies {
  readonly accountFactory: (options: LinuxAccountCustodyOptions) => Promise<LinuxAccountCustody>;
  readonly dacFactory: (options: LinuxDacCustodyOptions) => Promise<LinuxDacCustody>;
  readonly environmentPath: string;
  readonly executionFactory: (
    options: LinuxExecutionCustodyOptions,
  ) => Promise<LinuxExecutionCustody>;
  readonly launchRunner: (command: LinuxCandidateLaunchCommand) => Promise<unknown>;
  readonly processFactory: (options: LinuxProcessCustodyOptions) => Promise<LinuxProcessCustody>;
  readonly setprivPath: string;
  readonly sudoPath: string;
}

interface ActivePrincipal {
  dacLease?: LinuxDacLease;
  dacPreparationAttempted: boolean;
  dacRecoveryComplete: boolean;
  executionLease?: LinuxExecutionLease;
  executionCreationAttempted: boolean;
  executionRecoveryComplete: boolean;
  launchAttempted: boolean;
  launchTerminal?: Promise<unknown>;
  preparationAttempted: boolean;
  preparedRequest?: Iss002IsolationLaunchRequest;
  principal: LinuxAccountPrincipal;
  rootTerminal: boolean;
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
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
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  if (
    fields.some(
      (field) =>
        typeof value[field] !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value[field] as string),
    )
  )
    return undefined;
  return Object.freeze({ ...value }) as unknown as LinuxDacHelperProfile;
}

function sameProfile(left: LinuxDacHelperProfile, right: LinuxDacHelperProfile): boolean {
  return (Object.keys(left) as (keyof LinuxDacHelperProfile)[]).every(
    (field) => left[field] === right[field],
  );
}

async function defaultProfileReader(
  path: string,
  owner: "ROOT" | "STABLE",
): Promise<LinuxDacHelperProfile> {
  const profile = await lstat(path, { bigint: true });
  const expectedUid = owner === "ROOT" ? 0n : BigInt(process.getuid?.() ?? -1);
  if (
    !profile.isFile() ||
    profile.isSymbolicLink() ||
    profile.uid !== expectedUid ||
    (profile.mode & 0o22n) !== 0n
  )
    throw new TypeError("linux-isolation:launch-helper-profile-refused");
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

function detachedTerminal(input: unknown): Iss002IsolatedTerminalObservation | undefined {
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
    !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) ||
    !(value.signal === null || typeof value.signal === "string") ||
    typeof value.stderr !== "string" ||
    typeof value.stdout !== "string" ||
    Buffer.byteLength(value.stderr, "utf8") > maximumOutputBytes ||
    Buffer.byteLength(value.stdout, "utf8") > maximumOutputBytes
  )
    return undefined;
  return Object.freeze({
    exitCode: value.exitCode,
    signal: value.signal,
    stderr: value.stderr,
    stdout: value.stdout,
  }) as Iss002IsolatedTerminalObservation;
}

function detachedLaunchRequest(input: unknown): Iss002IsolationLaunchRequest | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = [
    "candidateArtifactPath",
    "inputText",
    "rpcRunnerPath",
    "timeoutMilliseconds",
  ] as const;
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
    typeof value.candidateArtifactPath !== "string" ||
    !isAbsolute(value.candidateArtifactPath) ||
    typeof value.rpcRunnerPath !== "string" ||
    !isAbsolute(value.rpcRunnerPath) ||
    typeof value.inputText !== "string" ||
    Buffer.byteLength(value.inputText, "utf8") > maximumOutputBytes ||
    value.timeoutMilliseconds !== 5000
  )
    return undefined;
  return Object.freeze({
    candidateArtifactPath: value.candidateArtifactPath,
    inputText: value.inputText,
    rpcRunnerPath: value.rpcRunnerPath,
    timeoutMilliseconds: 5000,
  }) as Iss002IsolationLaunchRequest;
}

async function nativeLaunchRunner(
  command: LinuxCandidateLaunchCommand,
  spawnChild: typeof spawn = spawn,
): Promise<Iss002IsolatedTerminalObservation> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawnChild(command.file, [...command.arguments], {
      cwd: command.cwd,
      env: Object.create(null) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    let settled = false;
    let terminalError: unknown;
    const refuseOutput = () => {
      if (exceeded) return;
      exceeded = true;
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maximumOutputBytes) refuseOutput();
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maximumOutputBytes) refuseOutput();
      else stderr.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      terminalError ??= error;
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }
      resolvePromise(
        Object.freeze({
          exitCode: exceeded ? null : exitCode,
          signal: exceeded ? "OUTPUT_LIMIT" : signal,
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdout: Buffer.concat(stdout).toString("utf8"),
        }),
      );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(command.inputText, "utf8");
  });
}

async function createCore(
  options: LinuxIsolationAuthorityOptions,
  dependencies: CompositionDependencies,
): Promise<LinuxIsolationAuthority> {
  const accountRoot = await realpath(resolve(options.account.stateRoot));
  const processRoot = await realpath(resolve(options.process.stateRoot));
  const executionAccountRoot = await realpath(resolve(options.execution.accountStateRoot));
  if (accountRoot !== processRoot || accountRoot !== executionAccountRoot)
    throw new TypeError("linux-isolation:account-state-composition-refused");
  const roots = await Promise.all(
    [
      accountRoot,
      options.dac.stateRoot,
      options.execution.stateRoot,
      options.execution.executionParent,
    ].map(async (path) => await realpath(resolve(path))),
  );
  for (const [index, left] of roots.entries())
    for (const right of roots.slice(index + 1))
      if (within(left, right) || within(right, left))
        throw new TypeError("linux-isolation:root-separation-refused");

  const runtimePath = await realpath(resolve(options.runtimePath));
  const environmentPath = await realpath(resolve(dependencies.environmentPath));
  const setprivPath = await realpath(resolve(dependencies.setprivPath));
  const sudoPath = await realpath(resolve(dependencies.sudoPath));
  if (new Set([runtimePath, environmentPath, setprivPath, sudoPath]).size !== 4)
    throw new TypeError("linux-isolation:launch-helper-alias-refused");
  const readProfile = options.profileReader ?? defaultProfileReader;
  const profiles = new Map<string, LinuxDacHelperProfile>();
  for (const [path, owner] of [
    [setprivPath, "ROOT"],
    [sudoPath, "ROOT"],
    [environmentPath, "ROOT"],
    [runtimePath, "STABLE"],
  ] as const) {
    const profile = detachedProfile(await readProfile(path, owner));
    if (!profile) throw new TypeError("linux-isolation:launch-helper-profile-refused");
    profiles.set(path, profile);
  }
  async function requireLaunchCustody(): Promise<void> {
    for (const [path, expected] of profiles) {
      const owner = path === runtimePath ? "STABLE" : "ROOT";
      const observed = detachedProfile(await readProfile(path, owner));
      if (!observed || !sameProfile(expected, observed))
        throw new TypeError("linux-isolation:launch-helper-moved");
    }
  }

  const processCustody = await dependencies.processFactory(options.process);
  const dacCustody = await dependencies.dacFactory(options.dac);
  const executionCustody = await dependencies.executionFactory(options.execution);
  try {
    await executionCustody.recoverAfterRevocation();
  } catch (error) {
    await Promise.allSettled([executionCustody.close()]);
    throw error;
  }
  let accountCustody: LinuxAccountCustody;
  try {
    accountCustody = await dependencies.accountFactory(options.account);
  } catch (error) {
    await Promise.allSettled([executionCustody.close()]);
    throw error;
  }

  const active = new Map<object, ActivePrincipal>();
  let closed = false;
  const authority: LinuxIsolationAuthority = {
    async close() {
      if (closed) throw new TypeError("linux-isolation:closed");
      if (active.size !== 0) throw new TypeError("linux-isolation:active-close-refused");
      await executionCustody.close();
      closed = true;
    },
    async createPrincipal() {
      if (closed) throw new TypeError("linux-isolation:closed");
      const principal = await accountCustody.createPrincipal();
      const handle = Object.freeze(Object.create(null) as object);
      active.set(handle, {
        dacPreparationAttempted: false,
        dacRecoveryComplete: false,
        executionCreationAttempted: false,
        executionRecoveryComplete: false,
        launchAttempted: false,
        preparationAttempted: false,
        principal,
        rootTerminal: true,
      });
      return handle;
    },
    async prepare(handle, requestInput) {
      if (closed) throw new TypeError("linux-isolation:closed");
      const state = active.get(handle as object);
      if (!state) throw new TypeError("linux-isolation:principal-handle-refused");
      if (state.preparationAttempted)
        throw new TypeError("linux-isolation:preparation-reuse-refused");
      state.preparationAttempted = true;
      const request = detachedLaunchRequest(requestInput);
      if (!request) throw new TypeError("linux-isolation:launch-request-refused");
      state.executionCreationAttempted = true;
      state.executionLease = await executionCustody.create({
        candidateArtifactPath: request.candidateArtifactPath,
        principal: state.principal,
        rpcRunnerPath: request.rpcRunnerPath,
      });
      state.dacPreparationAttempted = true;
      state.dacLease = await dacCustody.prepareAccess({
        principal: state.principal,
        rootPath: state.executionLease.rootPath,
      });
      await requireLaunchCustody();
      state.preparedRequest = request;
    },
    async launch(handle, requestInput) {
      if (closed) throw new TypeError("linux-isolation:closed");
      const state = active.get(handle as object);
      if (!state) throw new TypeError("linux-isolation:principal-handle-refused");
      if (state.launchAttempted) throw new TypeError("linux-isolation:launch-reuse-refused");
      const request = detachedLaunchRequest(requestInput);
      if (
        !request ||
        !state.preparedRequest ||
        JSON.stringify(request) !== JSON.stringify(state.preparedRequest) ||
        !state.executionLease ||
        !state.dacLease
      )
        throw new TypeError("linux-isolation:launch-preparation-refused");
      await requireLaunchCustody();
      state.launchAttempted = true;
      state.rootTerminal = false;
      let result: Iss002IsolatedTerminalObservation | undefined;
      try {
        const launchCommand = Object.freeze({
          arguments: Object.freeze([
            "-n",
            setprivPath,
            "--reuid",
            state.principal.uid,
            "--regid",
            state.principal.gid,
            "--clear-groups",
            "--no-new-privs",
            "--inh-caps=-all",
            "--ambient-caps=-all",
            "--bounding-set=-all",
            environmentPath,
            "-i",
            runtimePath,
            state.executionLease.rpcRunnerPath,
            pathToFileURL(state.executionLease.candidateArtifactPath).href,
            "--linux-principal",
            state.principal.uid,
            state.principal.gid,
          ]),
          cwd: state.executionLease.scratchPath,
          file: sudoPath,
          inputText: request.inputText,
          timeoutMilliseconds: 5000 as const,
        });
        const untrustedLaunchPromise = Promise.resolve().then(
          async () => await dependencies.launchRunner(launchCommand),
        );
        const launchPromise = untrustedLaunchPromise.then(
          (value) => {
            state.rootTerminal = true;
            return value;
          },
          (error: unknown) => {
            state.rootTerminal = true;
            throw error;
          },
        );
        state.launchTerminal = launchPromise;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        let outcome:
          { readonly kind: "QUIESCED" } | { readonly kind: "TERMINAL"; readonly value: unknown };
        try {
          outcome = await Promise.race([
            launchPromise.then((value) => ({ kind: "TERMINAL" as const, value })),
            new Promise<{ readonly kind: "QUIESCED" }>((resolvePromise, reject) => {
              watchdog = setTimeout(() => {
                void processCustody.quiesce(state.principal).then(
                  () => resolvePromise({ kind: "QUIESCED" }),
                  (error: unknown) => reject(error),
                );
              }, request.timeoutMilliseconds);
            }),
          ]);
        } finally {
          if (watchdog) clearTimeout(watchdog);
        }
        if (outcome.kind === "QUIESCED") {
          await launchPromise;
          result = Object.freeze({
            exitCode: null,
            signal: "TIMEOUT",
            stderr: "",
            stdout: "",
          });
        } else {
          result = detachedTerminal(outcome.value);
          if (!result) throw new TypeError("linux-isolation:terminal-observation-refused");
        }
      } finally {
        await requireLaunchCustody();
      }
      return result;
    },
    async teardownPrincipal(handle) {
      if (closed) throw new TypeError("linux-isolation:closed");
      const state = active.get(handle as object);
      if (!state) throw new TypeError("linux-isolation:principal-handle-refused");
      await processCustody.quiesce(state.principal);
      if (state.launchAttempted) {
        if (!state.launchTerminal) throw new TypeError("linux-isolation:terminal-root-refused");
        try {
          await state.launchTerminal;
        } catch {
          // A trusted runner rejection is terminal/no-child or follows terminal close.
        }
        if (!state.rootTerminal) throw new TypeError("linux-isolation:terminal-root-refused");
      }
      if (state.dacPreparationAttempted && !state.dacRecoveryComplete) {
        if (state.dacLease) {
          await dacCustody.restoreAccess(state.dacLease);
          delete state.dacLease;
        }
        await dacCustody.recover();
        state.dacRecoveryComplete = true;
      }
      if (state.executionCreationAttempted && !state.executionRecoveryComplete) {
        if (state.executionLease) {
          await executionCustody.cleanupAfterRevocation(state.executionLease);
          delete state.executionLease;
        }
        await executionCustody.recoverAfterRevocation();
        state.executionRecoveryComplete = true;
      }
      await accountCustody.deletePrincipal(state.principal);
      active.delete(handle as object);
    },
  };
  return Object.freeze(authority);
}

export async function createLinuxIsolationAuthority(
  options: LinuxIsolationAuthorityOptions,
): Promise<LinuxIsolationAuthority> {
  if (nativeHostPlatform !== "linux") throw new TypeError("linux-isolation:unsupported-platform");
  if (!process.getuid || !process.getgid)
    throw new TypeError("linux-isolation:posix-identities-required");
  return await createCore(options, {
    accountFactory: createLinuxAccountCustody,
    dacFactory: createLinuxDacCustody,
    environmentPath: nativeEnvironmentPath,
    executionFactory: createLinuxExecutionCustody,
    launchRunner: nativeLaunchRunner,
    processFactory: createLinuxProcessCustody,
    setprivPath: nativeSetprivPath,
    sudoPath: nativeSudoPath,
  });
}

export async function createLinuxIsolationAuthorityTestFixture(
  options: LinuxIsolationAuthorityOptions,
  dependencies: CompositionDependencies,
): Promise<LinuxIsolationAuthority> {
  return await createCore(options, dependencies);
}

export async function runLinuxCandidateCommandTestFixture(
  command: LinuxCandidateLaunchCommand,
  spawnChild: typeof spawn = spawn,
): Promise<Iss002IsolatedTerminalObservation> {
  return await nativeLaunchRunner(command, spawnChild);
}

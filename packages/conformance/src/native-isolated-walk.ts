import { isAbsolute } from "node:path";
import { types as nodeTypes } from "node:util";
import {
  runIss002IsolatedWalk,
  type Iss002IsolatedWalkRunInput,
  type Iss002IsolatedWalkRunResult,
  type Iss002StableIsolationAuthority,
} from "./isolated-walk.js";
import {
  createLinuxIsolationAuthority,
  type LinuxIsolationAuthority,
  type LinuxIsolationAuthorityOptions,
} from "./linux-isolation-authority.js";
import {
  createWindowsIsolationAuthority,
  type WindowsIsolationAuthorityOptions,
} from "./windows-isolation-authority.js";

const nativeHostPlatform = process.platform;
const decimalNanoseconds = /^(?:0|[1-9][0-9]*)$/;

export interface NativeLinuxIsolationConfiguration {
  readonly accountHelperPath: string;
  readonly accountStateRoot: string;
  readonly cleanupHelperPath: string;
  readonly dacHelperPath: string;
  readonly dacStateRoot: string;
  readonly executionParent: string;
  readonly executionStateRoot: string;
  readonly pidfdHelperPath: string;
  readonly runtimePath: string;
}

export type NativeWindowsIsolationConfiguration = WindowsIsolationAuthorityOptions;

interface NativeWalkDependencies {
  readonly linuxFactory: (
    options: LinuxIsolationAuthorityOptions,
  ) => Promise<LinuxIsolationAuthority>;
  readonly platform: NodeJS.Platform;
  readonly run: (
    input: Iss002IsolatedWalkRunInput,
    authority: Iss002StableIsolationAuthority,
  ) => Promise<Iss002IsolatedWalkRunResult>;
  readonly windowsFactory: (
    options: WindowsIsolationAuthorityOptions,
  ) => Promise<Iss002StableIsolationAuthority>;
}

function refusal(...issues: readonly string[]): Iss002IsolatedWalkRunResult {
  return Object.freeze({
    issues: Object.freeze([...new Set(issues)]),
    ok: false as const,
  });
}

function ownDataRecord(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  return value;
}

function absolutePaths(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, string>> | undefined {
  const value = ownDataRecord(input, fields);
  if (!value) return undefined;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of fields) {
    const path = value[field];
    if (typeof path !== "string" || !isAbsolute(path)) return undefined;
    result[field] = path;
  }
  return Object.freeze(result);
}

function detachedInput(input: unknown): Iss002IsolatedWalkRunInput | undefined {
  const value = absolutePaths(input, ["candidateArtifactPath", "rpcRunnerPath"]);
  if (!value) return undefined;
  return Object.freeze({
    candidateArtifactPath: value.candidateArtifactPath!,
    rpcRunnerPath: value.rpcRunnerPath!,
  });
}

function detachedLinuxConfiguration(input: unknown): NativeLinuxIsolationConfiguration | undefined {
  const fields = [
    "accountHelperPath",
    "accountStateRoot",
    "cleanupHelperPath",
    "dacHelperPath",
    "dacStateRoot",
    "executionParent",
    "executionStateRoot",
    "pidfdHelperPath",
    "runtimePath",
  ] as const;
  const value = absolutePaths(input, fields);
  if (!value) return undefined;
  return Object.freeze({
    accountHelperPath: value.accountHelperPath!,
    accountStateRoot: value.accountStateRoot!,
    cleanupHelperPath: value.cleanupHelperPath!,
    dacHelperPath: value.dacHelperPath!,
    dacStateRoot: value.dacStateRoot!,
    executionParent: value.executionParent!,
    executionStateRoot: value.executionStateRoot!,
    pidfdHelperPath: value.pidfdHelperPath!,
    runtimePath: value.runtimePath!,
  });
}

function detachedWindowsConfiguration(
  input: unknown,
): NativeWindowsIsolationConfiguration | undefined {
  const value = absolutePaths(input, ["executionParent", "runtimePath", "stateRoot"]);
  if (!value) return undefined;
  return Object.freeze({
    executionParent: value.executionParent!,
    runtimePath: value.runtimePath!,
    stateRoot: value.stateRoot!,
  });
}

function detachedStringArray(input: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const length = Reflect.getOwnPropertyDescriptor(input, "length");
  if (
    !length ||
    !("value" in length) ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > 1024 ||
    Reflect.ownKeys(descriptors).length !== length.value + 1
  )
    return undefined;
  const result: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    )
      return undefined;
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function detachedResult(input: unknown): Iss002IsolatedWalkRunResult | undefined {
  const probe = ownDataRecord(
    input,
    input !== null && typeof input === "object" && !nodeTypes.isProxy(input)
      ? Object.prototype.hasOwnProperty.call(input, "issues")
        ? ["issues", "ok"]
        : ["durationsNanoseconds", "maximumWalkDurationNanoseconds", "ok"]
      : [],
  );
  if (!probe) return undefined;
  if (probe.ok === false) {
    const issues = detachedStringArray(probe.issues);
    return issues && issues.length !== 0 ? refusal(...issues) : undefined;
  }
  if (probe.ok !== true || typeof probe.maximumWalkDurationNanoseconds !== "string")
    return undefined;
  const durations = detachedStringArray(probe.durationsNanoseconds);
  if (
    !durations ||
    durations.length !== 3 ||
    !durations.every((value) => decimalNanoseconds.test(value)) ||
    !decimalNanoseconds.test(probe.maximumWalkDurationNanoseconds)
  )
    return undefined;
  const maximum = durations.reduce((left, right) => (BigInt(left) >= BigInt(right) ? left : right));
  if (maximum !== probe.maximumWalkDurationNanoseconds) return undefined;
  return Object.freeze({
    durationsNanoseconds: durations,
    maximumWalkDurationNanoseconds: maximum,
    ok: true as const,
  });
}

async function runCore(
  inputValue: unknown,
  configurationValue: unknown,
  dependencies: NativeWalkDependencies,
): Promise<Iss002IsolatedWalkRunResult> {
  if (dependencies.platform === "darwin")
    return refusal("native-isolated-walk:macos-authority-unavailable");
  if (dependencies.platform !== "linux" && dependencies.platform !== "win32")
    return refusal("native-isolated-walk:unsupported-platform");
  const input = detachedInput(inputValue);
  if (!input) return refusal("native-isolated-walk:input-refused");

  if (dependencies.platform === "linux") {
    const configuration = detachedLinuxConfiguration(configurationValue);
    if (!configuration) return refusal("native-isolated-walk:configuration-refused");
    let authority: LinuxIsolationAuthority;
    try {
      authority = await dependencies.linuxFactory({
        account: {
          accountHelperPath: configuration.accountHelperPath,
          stateRoot: configuration.accountStateRoot,
        },
        dac: {
          dacHelperPath: configuration.dacHelperPath,
          stateRoot: configuration.dacStateRoot,
        },
        execution: {
          accountStateRoot: configuration.accountStateRoot,
          cleanupHelperPath: configuration.cleanupHelperPath,
          executionParent: configuration.executionParent,
          stateRoot: configuration.executionStateRoot,
        },
        process: {
          pidfdHelperPath: configuration.pidfdHelperPath,
          stateRoot: configuration.accountStateRoot,
        },
        runtimePath: configuration.runtimePath,
      });
    } catch {
      return refusal("native-isolated-walk:linux-factory-refused");
    }
    let result: Iss002IsolatedWalkRunResult | undefined;
    let runRefused = false;
    try {
      result = detachedResult(await dependencies.run(input, authority));
      if (!result) runRefused = true;
    } catch {
      runRefused = true;
    }
    let closeRefused = false;
    try {
      await authority.close();
    } catch {
      closeRefused = true;
    }
    if (closeRefused)
      return refusal(
        ...(runRefused
          ? ["native-isolated-walk:coordinator-refused"]
          : result && !result.ok
            ? result.issues
            : []),
        "native-isolated-walk:linux-close-refused",
      );
    if (runRefused) return refusal("native-isolated-walk:coordinator-refused");
    return result!;
  }

  const configuration = detachedWindowsConfiguration(configurationValue);
  if (!configuration) return refusal("native-isolated-walk:configuration-refused");
  let authority: Iss002StableIsolationAuthority;
  try {
    authority = await dependencies.windowsFactory(configuration);
  } catch {
    return refusal("native-isolated-walk:windows-factory-refused");
  }
  try {
    const result = detachedResult(await dependencies.run(input, authority));
    return result ?? refusal("native-isolated-walk:coordinator-refused");
  } catch {
    return refusal("native-isolated-walk:coordinator-refused");
  }
}

export async function runNativeIss002IsolatedWalk(
  input: Iss002IsolatedWalkRunInput,
  configuration: NativeLinuxIsolationConfiguration | NativeWindowsIsolationConfiguration,
): Promise<Iss002IsolatedWalkRunResult> {
  return await runCore(input, configuration, {
    linuxFactory: createLinuxIsolationAuthority,
    platform: nativeHostPlatform,
    run: runIss002IsolatedWalk,
    windowsFactory: createWindowsIsolationAuthority,
  });
}

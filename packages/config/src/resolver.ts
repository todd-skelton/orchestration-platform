import { posix, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types as nodeTypes } from "node:util";

import {
  computeConfigurationPathToken,
  parseConfigurationPaths,
  parseConfigurationProvenance,
  parseContract,
  parsePlatformConfigurationSource,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";

export type ConfigurationResolverOperatingSystem = "WINDOWS" | "MACOS" | "LINUX";
export type ConfigurationFieldSource = "CLI" | "ENVIRONMENT" | "PROJECT" | "DEFAULT";

export interface ConfigurationResolverInvocation {
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

export interface AdmittedConfigurationPaths {
  readonly configPath: string;
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly stateRootDisposition: "ABSENT" | "DIRECTORY";
}

export interface ConfigurationFieldSources {
  readonly adapterId: "PROJECT";
  readonly capabilityNames: "PROJECT";
  readonly leaseFreshnessMs: "PROJECT";
  readonly maximumSessionMs: "PROJECT";
  readonly projectId: "PROJECT";
  readonly stateRoot: ConfigurationFieldSource;
  readonly wallClockSkewMs: "PROJECT";
}

export interface ConfigurationResolutionSuccess {
  readonly configuration: ContractRecord;
  readonly configPath: string;
  readonly fieldSources: ConfigurationFieldSources;
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly stateRootDisposition: "ABSENT" | "DIRECTORY";
}

export interface ConfigurationResolutionFailure {
  readonly code: "ARGV_REFUSED" | "CONFIG_REFUSED" | "PATH_REFUSED" | "INTERNAL_ERROR";
  readonly exitCode: 2 | 3 | 70;
  readonly message:
    "command line refused" | "configuration refused" | "path refused" | "internal error";
  readonly outcome: "invalid-input" | "authority-refused" | "internal-error";
}

export type ConfigurationResolutionResult =
  | Readonly<{ ok: true; value: ConfigurationResolutionSuccess }>
  | Readonly<{ ok: false; error: ConfigurationResolutionFailure }>;

const invocationFields = Object.freeze(["environment", "flags", "operatingSystem"] as const);
const flagFields = Object.freeze(["configPath", "projectRoot", "stateRoot"] as const);
const environmentFields = Object.freeze([
  "HOME",
  "LOCALAPPDATA",
  "ORCHESTRATION_CONFIG",
  "ORCHESTRATION_PROJECT_ROOT",
  "ORCHESTRATION_STATE_ROOT",
  "XDG_STATE_HOME",
] as const);
const admittedPathFields = Object.freeze([
  "configPath",
  "projectRoot",
  "stateRoot",
  "stateRootDisposition",
] as const);
const resolutionValueFields = Object.freeze([
  "configuration",
  "configPath",
  "fieldSources",
  "projectRoot",
  "stateRoot",
  "stateRootDisposition",
] as const);
const operatingSystems = Object.freeze(["WINDOWS", "MACOS", "LINUX"] as const);

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
  PATH_REFUSED: Object.freeze({
    code: "PATH_REFUSED",
    exitCode: 3,
    message: "path refused",
    outcome: "authority-refused",
  }),
  INTERNAL_ERROR: Object.freeze({
    code: "INTERNAL_ERROR",
    exitCode: 70,
    message: "internal error",
    outcome: "internal-error",
  }),
} as const satisfies Readonly<Record<string, ConfigurationResolutionFailure>>);

function refused(code: keyof typeof failures): ConfigurationResolutionResult {
  return Object.freeze({ ok: false, error: failures[code] });
}

function stringOrNull(value: JsonValue | undefined): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

type InvocationShell =
  | Readonly<{
      ok: true;
      environment: unknown;
      flags: unknown;
      operatingSystem: unknown;
    }>
  | Readonly<{ ok: false; code: "ARGV_REFUSED" | "CONFIG_REFUSED" }>;

function inspectInvocationShell(input: unknown): InvocationShell {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    )
      return { ok: false, code: "ARGV_REFUSED" };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== invocationFields.length ||
      invocationFields.some((field) => !Object.hasOwn(descriptors, field)) ||
      keys.some((key) => !invocationFields.includes(key as (typeof invocationFields)[number]))
    )
      return { ok: false, code: "ARGV_REFUSED" };
    const flags = descriptors.flags;
    const operatingSystem = descriptors.operatingSystem;
    const environment = descriptors.environment;
    if (
      !flags ||
      !("value" in flags) ||
      !flags.enumerable ||
      !operatingSystem ||
      !("value" in operatingSystem) ||
      !operatingSystem.enumerable
    )
      return { ok: false, code: "ARGV_REFUSED" };
    if (!environment || !("value" in environment) || !environment.enumerable)
      return { ok: false, code: "CONFIG_REFUSED" };
    return {
      ok: true,
      environment: environment.value,
      flags: flags.value,
      operatingSystem: operatingSystem.value,
    };
  } catch {
    return { ok: false, code: "ARGV_REFUSED" };
  }
}

function isAbsoluteHostPath(value: string, operatingSystem: ConfigurationResolverOperatingSystem) {
  return operatingSystem === "WINDOWS"
    ? /^[A-Za-z]:\\/.test(value) && win32.isAbsolute(value)
    : posix.isAbsolute(value);
}

interface CanonicalPath {
  readonly hostPath: string;
  readonly fileUrl: string;
}

function canonicalPath(
  value: string,
  operatingSystem: ConfigurationResolverOperatingSystem,
): CanonicalPath | null {
  if (!isAbsoluteHostPath(value, operatingSystem)) return null;
  try {
    const windows = operatingSystem === "WINDOWS";
    const url = pathToFileURL(value, { windows });
    if (fileURLToPath(url, { windows }) !== value) return null;
    return Object.freeze({ hostPath: value, fileUrl: url.href });
  } catch {
    return null;
  }
}

function hostPathFromCanonicalFileUrl(
  value: string,
  operatingSystem: ConfigurationResolverOperatingSystem,
): CanonicalPath | null {
  try {
    const windows = operatingSystem === "WINDOWS";
    const hostPath = fileURLToPath(value, { windows });
    const converted = canonicalPath(hostPath, operatingSystem);
    return converted?.fileUrl === value ? converted : null;
  } catch {
    return null;
  }
}

function selectedPathMatches(
  primary: JsonValue | undefined,
  secondary: JsonValue | undefined,
  admitted: CanonicalPath,
  operatingSystem: ConfigurationResolverOperatingSystem,
): boolean {
  const selected = typeof primary === "string" ? primary : secondary;
  if (typeof selected !== "string") return true;
  return canonicalPath(selected, operatingSystem)?.hostPath === admitted.hostPath;
}

function defaultConfigPath(
  projectRoot: CanonicalPath,
  operatingSystem: ConfigurationResolverOperatingSystem,
): CanonicalPath | null {
  const selected =
    operatingSystem === "WINDOWS"
      ? win32.join(projectRoot.hostPath, ".orchestration", "project.json")
      : posix.join(projectRoot.hostPath, ".orchestration", "project.json");
  return canonicalPath(selected, operatingSystem);
}

function defaultStateRoot(
  operatingSystem: ConfigurationResolverOperatingSystem,
  environment: ContractRecord,
  projectId: string,
): string | null {
  if (operatingSystem === "WINDOWS") {
    const base = environment.LOCALAPPDATA;
    return typeof base === "string" && win32.isAbsolute(base)
      ? win32.join(base, "orchestration-platform", projectId)
      : null;
  }
  if (operatingSystem === "MACOS") {
    const home = environment.HOME;
    return typeof home === "string" && posix.isAbsolute(home)
      ? posix.join(home, "Library/Application Support", "orchestration-platform", projectId)
      : null;
  }
  const xdg = environment.XDG_STATE_HOME;
  if (typeof xdg === "string")
    return posix.isAbsolute(xdg) ? posix.join(xdg, "orchestration-platform", projectId) : null;
  const home = environment.HOME;
  return typeof home === "string" && posix.isAbsolute(home)
    ? posix.join(home, ".local/state", "orchestration-platform", projectId)
    : null;
}

function projectFieldSources(stateRoot: ConfigurationFieldSource): ConfigurationFieldSources {
  return Object.freeze({
    adapterId: "PROJECT",
    capabilityNames: "PROJECT",
    leaseFreshnessMs: "PROJECT",
    maximumSessionMs: "PROJECT",
    projectId: "PROJECT",
    stateRoot,
    wallClockSkewMs: "PROJECT",
  });
}

function successfulRecord(parsed: ReturnType<typeof parseContract>): ContractRecord | null {
  return parsed.ok ? parsed.value : null;
}

function invalidProjection(): ParseResult {
  return Object.freeze({ ok: false, issues: Object.freeze(["resolution:refused"]) });
}

function projectionPaths(resolutionInput: unknown): Readonly<{
  configuration: ContractRecord;
  configPath: CanonicalPath;
  fieldSources: JsonValue;
  projectRoot: CanonicalPath;
  stateRoot: CanonicalPath;
}> | null {
  const resolution = snapshotClosedRecord(resolutionInput, resolutionValueFields);
  if (!resolution.ok) return null;
  const fieldSources = resolution.value.fieldSources;
  if (fieldSources === undefined) return null;
  const configuration = parseContract("platform-configuration/v1", resolution.value.configuration);
  if (!configuration.ok) return null;
  if (
    typeof resolution.value.configPath !== "string" ||
    typeof resolution.value.projectRoot !== "string" ||
    typeof resolution.value.stateRoot !== "string" ||
    (resolution.value.stateRootDisposition !== "ABSENT" &&
      resolution.value.stateRootDisposition !== "DIRECTORY")
  )
    return null;
  const hostPaths = [
    resolution.value.configPath,
    resolution.value.projectRoot,
    resolution.value.stateRoot,
  ];
  const operatingSystem = hostPaths.every((value) => /^[A-Za-z]:\\/.test(value))
    ? "WINDOWS"
    : hostPaths.every((value) => value.startsWith("/"))
      ? "LINUX"
      : null;
  if (operatingSystem === null) return null;
  const configPath = canonicalPath(resolution.value.configPath, operatingSystem);
  const projectRoot = canonicalPath(resolution.value.projectRoot, operatingSystem);
  const stateRoot = canonicalPath(resolution.value.stateRoot, operatingSystem);
  if (
    !configPath ||
    !projectRoot ||
    !stateRoot ||
    configuration.value.stateRoot !== stateRoot.fileUrl
  )
    return null;
  return Object.freeze({
    configuration: configuration.value,
    configPath,
    fieldSources,
    projectRoot,
    stateRoot,
  });
}

/** Pure projection for the future `config validate` handler; not path admission. */
export function projectConfigurationProvenance(
  resolution: ConfigurationResolutionSuccess,
): ParseResult {
  try {
    const projected = projectionPaths(resolution);
    if (!projected) return invalidProjection();
    return parseConfigurationProvenance({
      adapterId: projected.configuration.adapterId,
      capabilityNames: projected.configuration.capabilityNames,
      fieldSources: projected.fieldSources,
      leaseFreshnessMs: projected.configuration.leaseFreshnessMs,
      maximumSessionMs: projected.configuration.maximumSessionMs,
      projectId: projected.configuration.projectId,
      projectRoot: computeConfigurationPathToken(projected.projectRoot.fileUrl),
      schemaVersion: "configuration-provenance/v1",
      stateRoot: computeConfigurationPathToken(projected.stateRoot.fileUrl),
      wallClockSkewMs: projected.configuration.wallClockSkewMs,
    });
  } catch {
    return invalidProjection();
  }
}

/** Pure projection for the future `config paths` handler; not path admission. */
export function projectConfigurationPaths(resolution: ConfigurationResolutionSuccess): ParseResult {
  try {
    const projected = projectionPaths(resolution);
    if (!projected) return invalidProjection();
    return parseConfigurationPaths({
      configPath: computeConfigurationPathToken(projected.configPath.fileUrl),
      projectRoot: computeConfigurationPathToken(projected.projectRoot.fileUrl),
      schemaVersion: "configuration-paths/v1",
      stateRoot: computeConfigurationPathToken(projected.stateRoot.fileUrl),
    });
  } catch {
    return invalidProjection();
  }
}

/**
 * Resolves data only after a future concrete loader has admitted all three host paths.
 * It performs no discovery or physical-path admission and grants no path authority.
 */
export function resolveConfigurationFromAdmittedPaths(
  invocationInput: unknown,
  authenticatedSourceInput: unknown,
  admittedPathsInput: unknown,
): ConfigurationResolutionResult {
  try {
    const invocation = inspectInvocationShell(invocationInput);
    if (!invocation.ok) return refused(invocation.code);
    const flags = snapshotClosedRecord(invocation.flags, flagFields);
    if (!flags.ok) return refused("ARGV_REFUSED");
    if (
      !operatingSystems.includes(invocation.operatingSystem as (typeof operatingSystems)[number]) ||
      flagFields.some((field) => !stringOrNull(flags.value[field]))
    )
      return refused("ARGV_REFUSED");

    const environment = snapshotClosedRecord(invocation.environment, environmentFields);
    if (
      !environment.ok ||
      environmentFields.some((field) => !stringOrNull(environment.value[field]))
    )
      return refused("CONFIG_REFUSED");

    const source = parsePlatformConfigurationSource(authenticatedSourceInput);
    if (!source.ok) return refused("CONFIG_REFUSED");
    const admittedPaths = snapshotClosedRecord(admittedPathsInput, admittedPathFields);
    if (
      !admittedPaths.ok ||
      typeof admittedPaths.value.configPath !== "string" ||
      admittedPaths.value.configPath.length === 0 ||
      typeof admittedPaths.value.projectRoot !== "string" ||
      admittedPaths.value.projectRoot.length === 0 ||
      typeof admittedPaths.value.stateRoot !== "string" ||
      admittedPaths.value.stateRoot.length === 0 ||
      (admittedPaths.value.stateRootDisposition !== "ABSENT" &&
        admittedPaths.value.stateRootDisposition !== "DIRECTORY")
    )
      return refused("PATH_REFUSED");

    const operatingSystem = invocation.operatingSystem as ConfigurationResolverOperatingSystem;
    if (
      flagFields.some(
        (field) =>
          typeof flags.value[field] === "string" &&
          !isAbsoluteHostPath(flags.value[field], operatingSystem),
      )
    )
      return refused("PATH_REFUSED");

    const configPath = canonicalPath(String(admittedPaths.value.configPath), operatingSystem);
    const projectRoot = canonicalPath(String(admittedPaths.value.projectRoot), operatingSystem);
    const admittedStateRoot = canonicalPath(String(admittedPaths.value.stateRoot), operatingSystem);
    if (!configPath || !projectRoot || !admittedStateRoot) return refused("PATH_REFUSED");
    if (
      !selectedPathMatches(
        flags.value.projectRoot,
        environment.value.ORCHESTRATION_PROJECT_ROOT,
        projectRoot,
        operatingSystem,
      ) ||
      !selectedPathMatches(
        flags.value.configPath,
        environment.value.ORCHESTRATION_CONFIG,
        configPath,
        operatingSystem,
      )
    )
      return refused("PATH_REFUSED");
    if (
      flags.value.configPath === null &&
      environment.value.ORCHESTRATION_CONFIG === null &&
      defaultConfigPath(projectRoot, operatingSystem)?.hostPath !== configPath.hostPath
    )
      return refused("PATH_REFUSED");

    let selectedStateRoot: CanonicalPath | null;
    let stateRootSource: ConfigurationFieldSource;
    if (typeof flags.value.stateRoot === "string") {
      selectedStateRoot = canonicalPath(flags.value.stateRoot, operatingSystem);
      stateRootSource = "CLI";
    } else if (typeof environment.value.ORCHESTRATION_STATE_ROOT === "string") {
      selectedStateRoot = canonicalPath(
        environment.value.ORCHESTRATION_STATE_ROOT,
        operatingSystem,
      );
      stateRootSource = "ENVIRONMENT";
    } else if (typeof source.value.stateRoot === "string") {
      selectedStateRoot = hostPathFromCanonicalFileUrl(source.value.stateRoot, operatingSystem);
      stateRootSource = "PROJECT";
    } else {
      const selectedDefault = defaultStateRoot(
        operatingSystem,
        environment.value,
        String(source.value.projectId),
      );
      selectedStateRoot =
        selectedDefault === null ? null : canonicalPath(selectedDefault, operatingSystem);
      stateRootSource = "DEFAULT";
    }
    if (!selectedStateRoot || selectedStateRoot.hostPath !== admittedStateRoot.hostPath)
      return refused("PATH_REFUSED");

    const configuration = successfulRecord(
      parseContract("platform-configuration/v1", {
        adapterId: source.value.adapterId,
        capabilityNames: source.value.capabilityNames,
        leaseFreshnessMs: source.value.leaseFreshnessMs,
        maximumSessionMs: source.value.maximumSessionMs,
        projectId: source.value.projectId,
        schemaVersion: "platform-configuration/v1",
        stateRoot: selectedStateRoot.fileUrl,
        wallClockSkewMs: source.value.wallClockSkewMs,
      }),
    );
    if (!configuration) return refused("INTERNAL_ERROR");

    const fieldSources = projectFieldSources(stateRootSource);
    const value: ConfigurationResolutionSuccess = Object.freeze({
      configuration,
      configPath: configPath.hostPath,
      fieldSources,
      projectRoot: projectRoot.hostPath,
      stateRoot: selectedStateRoot.hostPath,
      stateRootDisposition: admittedPaths.value.stateRootDisposition as "ABSENT" | "DIRECTORY",
    });
    if (!projectConfigurationProvenance(value).ok || !projectConfigurationPaths(value).ok)
      return refused("INTERNAL_ERROR");
    return Object.freeze({
      ok: true,
      value,
    });
  } catch {
    return refused("INTERNAL_ERROR");
  }
}

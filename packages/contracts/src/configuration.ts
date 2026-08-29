import {
  frame,
  framedDigest,
  isUuidV7,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

const sourceFields = Object.freeze([
  "adapterId",
  "capabilityNames",
  "leaseFreshnessMs",
  "maximumSessionMs",
  "projectId",
  "schemaVersion",
  "stateRoot",
  "wallClockSkewMs",
] as const);
const provenanceFields = Object.freeze([
  "adapterId",
  "capabilityNames",
  "fieldSources",
  "leaseFreshnessMs",
  "maximumSessionMs",
  "projectId",
  "projectRoot",
  "schemaVersion",
  "stateRoot",
  "wallClockSkewMs",
] as const);
const fieldSourceFields = Object.freeze([
  "adapterId",
  "capabilityNames",
  "leaseFreshnessMs",
  "maximumSessionMs",
  "projectId",
  "stateRoot",
  "wallClockSkewMs",
] as const);
const pathsFields = Object.freeze([
  "configPath",
  "projectRoot",
  "schemaVersion",
  "stateRoot",
] as const);
const commandResultFields = Object.freeze([
  "command",
  "diagnostics",
  "outcome",
  "result",
  "schemaVersion",
] as const);

export const configurationSchemaFields = Object.freeze({
  commandResult: commandResultFields,
  paths: pathsFields,
  provenance: provenanceFields,
  source: sourceFields,
});
export const configurationSchemaVersions = Object.freeze([
  "configuration-paths/v1",
  "configuration-provenance/v1",
  "orchestration-command-result/v1",
  "platform-configuration-source/v1",
] as const);

const adapterIdPattern = /^[a-z0-9][a-z0-9._:@+-]{0,127}$/;
const pathTokenPattern = /^<redacted:path:[0-9a-f]{64}>$/;
const ownerPattern = /^ISS-[0-9]{3}$/;
const fieldSourceValues = Object.freeze(["CLI", "DEFAULT", "ENVIRONMENT", "PROJECT"] as const);
const configCommands = Object.freeze(["config paths", "config validate"] as const);
export interface OrchestrationCommandCensusRow {
  readonly command: string;
  readonly placeholderOwner: string | null;
}
export const orchestrationCommandCensus: readonly OrchestrationCommandCensusRow[] = Object.freeze(
  (
    [
      ["config validate", null],
      ["config paths", null],
      ["session acquire", "ISS-007"],
      ["session renew", "ISS-007"],
      ["session inspect", "ISS-007"],
      ["session release", "ISS-007"],
      ["session handoff", "ISS-007"],
      ["worker dispatch", "ISS-008"],
      ["worker inspect", "ISS-008"],
      ["worker terminate", "ISS-008"],
      ["review reduce", "ISS-009"],
      ["journal append", "ISS-010"],
      ["journal reduce", "ISS-010"],
      ["journal snapshot", "ISS-010"],
      ["project snapshot", "ISS-013"],
      ["project plan", "ISS-013"],
      ["project apply", "ISS-013"],
      ["release assemble", "ISS-014"],
      ["release certify", "ISS-014"],
      ["release promote", "ISS-014"],
      ["release recover", "ISS-014"],
      ["cycle plan", "ISS-026"],
      ["cycle run", "ISS-026"],
      ["cycle resume", "ISS-026"],
      ["cycle inspect", "ISS-026"],
      ["supervisor plan", "ISS-030"],
      ["supervisor install", "ISS-030"],
      ["supervisor tick", "ISS-030"],
      ["supervisor inspect", "ISS-030"],
      ["supervisor uninstall", "ISS-030"],
      ["credential bind", "ISS-032"],
      ["credential inspect", "ISS-032"],
      ["credential revoke", "ISS-032"],
    ] as const
  ).map(([command, placeholderOwner]) => Object.freeze({ command, placeholderOwner })),
);
const commandCensusByIdentity = new Map(
  orchestrationCommandCensus.map((row) => [row.command, row] as const),
);
const failureRows = Object.freeze({
  ARGV_REFUSED: Object.freeze({ outcome: "invalid-input", message: "command line refused" }),
  CONFIG_REFUSED: Object.freeze({
    outcome: "invalid-input",
    message: "configuration refused",
  }),
  PROJECT_ROOT_REFUSED: Object.freeze({
    outcome: "authority-refused",
    message: "project root refused",
  }),
  PATH_REFUSED: Object.freeze({ outcome: "authority-refused", message: "path refused" }),
  FILESYSTEM_OPERATION_FAILED: Object.freeze({
    outcome: "operation-failed",
    message: "filesystem operation failed",
  }),
  INTERNAL_ERROR: Object.freeze({ outcome: "internal-error", message: "internal error" }),
} as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function utf8Compare(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}

export function platformConfigurationScalarIssues(record: ContractRecord): readonly string[] {
  const issues: string[] = [];
  if (typeof record.adapterId !== "string" || !adapterIdPattern.test(record.adapterId))
    issues.push("adapterId:invalid");
  if (
    !Array.isArray(record.capabilityNames) ||
    record.capabilityNames.some((name) => typeof name !== "string")
  )
    issues.push("capabilityNames:invalid");
  if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
  for (const name of ["leaseFreshnessMs", "maximumSessionMs", "wallClockSkewMs"] as const)
    if (
      typeof record[name] !== "number" ||
      !Number.isSafeInteger(record[name]) ||
      Number(record[name]) < 0
    )
      issues.push(`${name}:invalid`);
  if (
    typeof record.leaseFreshnessMs === "number" &&
    typeof record.maximumSessionMs === "number" &&
    (record.leaseFreshnessMs <= 0 || record.leaseFreshnessMs > record.maximumSessionMs)
  )
    issues.push("leaseFreshnessMs:out-of-range");
  if (
    typeof record.maximumSessionMs === "number" &&
    (record.maximumSessionMs <= 0 || record.maximumSessionMs > 86_400_000)
  )
    issues.push("maximumSessionMs:out-of-range");
  if (typeof record.wallClockSkewMs === "number" && record.wallClockSkewMs > 300_000)
    issues.push("wallClockSkewMs:out-of-range");
  return Object.freeze(issues);
}

function configurationScalarIssues(record: ContractRecord): string[] {
  const issues = [...platformConfigurationScalarIssues(record)];
  if (Array.isArray(record.capabilityNames)) {
    const names = record.capabilityNames;
    if (names.some((name) => typeof name !== "string" || name.length === 0))
      issues.push("capabilityNames:invalid");
    if (new Set(names).size !== names.length) issues.push("capabilityNames:duplicate");
    if (
      names.some(
        (name, index) =>
          index > 0 && typeof name === "string" && utf8Compare(String(names[index - 1]), name) >= 0,
      )
    )
      issues.push("capabilityNames:not-utf8-sorted");
  }
  return issues;
}

function isCanonicalLocalFileUrl(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || !value.startsWith("file:///")) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "file:" &&
      parsed.hostname === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.href === value
    );
  } catch {
    return false;
  }
}

function isPathToken(value: JsonValue | undefined): value is string {
  return typeof value === "string" && pathTokenPattern.test(value);
}

export function computeConfigurationPathToken(canonicalFileUrl: string): string {
  if (!isCanonicalLocalFileUrl(canonicalFileUrl)) throw new TypeError("path:invalid-file-url");
  const bytes = new TextEncoder().encode(canonicalFileUrl);
  const fixedBytes = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `<redacted:path:${framedDigest("configuration-path/v1", [frame.fixed(fixedBytes)])}>`;
}

export function parsePlatformConfigurationSource(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, sourceFields);
  if (!parsed.ok) return parsed;
  const issues = configurationScalarIssues(parsed.value);
  if (parsed.value.schemaVersion !== "platform-configuration-source/v1")
    issues.push("schemaVersion:mismatch");
  if (parsed.value.stateRoot !== null && !isCanonicalLocalFileUrl(parsed.value.stateRoot))
    issues.push("stateRoot:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function fieldSourcesIssues(input: JsonValue | undefined): string[] {
  const parsed = snapshotClosedRecord(input, fieldSourceFields);
  if (!parsed.ok) return parsed.issues.map((issue) => `fieldSources.${issue}`);
  const issues = fieldSourceFields
    .filter((name) => parsed.value[name] !== "PROJECT" && name !== "stateRoot")
    .map((name) => `fieldSources.${name}:must-be-project`);
  if (!fieldSourceValues.includes(parsed.value.stateRoot as (typeof fieldSourceValues)[number]))
    issues.push("fieldSources.stateRoot:invalid");
  return issues;
}

export function parseConfigurationProvenance(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, provenanceFields);
  if (!parsed.ok) return parsed;
  const issues = [
    ...configurationScalarIssues(parsed.value),
    ...fieldSourcesIssues(parsed.value.fieldSources),
  ];
  if (parsed.value.schemaVersion !== "configuration-provenance/v1")
    issues.push("schemaVersion:mismatch");
  for (const name of ["projectRoot", "stateRoot"] as const)
    if (!isPathToken(parsed.value[name])) issues.push(`${name}:invalid`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseConfigurationPaths(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, pathsFields);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (parsed.value.schemaVersion !== "configuration-paths/v1")
    issues.push("schemaVersion:mismatch");
  for (const name of ["configPath", "projectRoot", "stateRoot"] as const)
    if (!isPathToken(parsed.value[name])) issues.push(`${name}:invalid`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

function prefixed(prefix: string, issues: readonly string[]): string[] {
  return issues.map((issue) => `${prefix}.${issue}`);
}

function diagnosticIssues(
  input: JsonValue | undefined,
  outcome: JsonValue | undefined,
  commandRow: OrchestrationCommandCensusRow | undefined,
): string[] {
  const codeRecord = snapshotClosedRecord(input, ["code"]);
  let code: JsonValue | undefined;
  if (codeRecord.ok) code = codeRecord.value.code;
  else {
    const candidate = snapshotClosedRecord(input, ["code", "message"]);
    const ownerCandidate = snapshotClosedRecord(input, ["code", "owner"]);
    if (candidate.ok) code = candidate.value.code;
    else if (ownerCandidate.ok) code = ownerCandidate.value.code;
    else return prefixed("diagnostics.0", candidate.issues);
  }
  if (code === "CAPABILITY_NOT_IMPLEMENTED") {
    const parsed = snapshotClosedRecord(input, ["code", "owner"]);
    if (!parsed.ok) return prefixed("diagnostics.0", parsed.issues);
    const issues: string[] = [];
    if (outcome !== "operation-failed") issues.push("outcome:mismatch");
    if (commandRow?.placeholderOwner === null || commandRow === undefined)
      issues.push("command:not-placeholder");
    if (
      typeof parsed.value.owner !== "string" ||
      !ownerPattern.test(parsed.value.owner) ||
      parsed.value.owner !== commandRow?.placeholderOwner
    )
      issues.push("owner:mismatch");
    return prefixed("diagnostics.0", issues);
  }
  if (typeof code !== "string" || !Object.hasOwn(failureRows, code))
    return ["diagnostics.0.code:invalid"];
  const parsed = snapshotClosedRecord(input, ["code", "message"]);
  if (!parsed.ok) return prefixed("diagnostics.0", parsed.issues);
  const row = failureRows[code as keyof typeof failureRows];
  const issues: string[] = [];
  if (outcome !== row.outcome) issues.push("outcome:mismatch");
  if (parsed.value.message !== row.message) issues.push("message:mismatch");
  return prefixed("diagnostics.0", issues);
}

export function parseOrchestrationCommandResult(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, commandResultFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "orchestration-command-result/v1")
    issues.push("schemaVersion:mismatch");
  const commandRow =
    typeof record.command === "string" ? commandCensusByIdentity.get(record.command) : undefined;
  if (record.command !== "" && commandRow === undefined) issues.push("command:invalid");
  const diagnostics = snapshotClosedArray(record.diagnostics);
  if (!diagnostics.ok) issues.push(...prefixed("diagnostics", diagnostics.issues));
  if (record.outcome === "success") {
    if (!configCommands.includes(record.command as (typeof configCommands)[number]))
      issues.push("command:unsupported-result");
    if (diagnostics.ok && diagnostics.value.length !== 0) issues.push("diagnostics:not-empty");
    const result =
      record.command === "config validate"
        ? parseConfigurationProvenance(record.result)
        : record.command === "config paths"
          ? parseConfigurationPaths(record.result)
          : invalid("command:unsupported-result");
    if (!result.ok) issues.push(...prefixed("result", result.issues));
  } else {
    if (record.result !== null) issues.push("result:not-null");
    if (!diagnostics.ok || diagnostics.value.length !== 1) issues.push("diagnostics:length");
    else issues.push(...diagnosticIssues(diagnostics.value[0], record.outcome, commandRow));
    if (record.command === "" && diagnostics.ok && diagnostics.value[0]) {
      const diagnostic = diagnostics.value[0];
      if (
        diagnostic === null ||
        typeof diagnostic !== "object" ||
        Array.isArray(diagnostic) ||
        (diagnostic as Readonly<Record<string, JsonValue>>).code !== "ARGV_REFUSED"
      )
        issues.push("command:empty-only-for-argv-refused");
    }
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseConfigurationContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | null {
  switch (expectedSchemaVersion) {
    case "platform-configuration-source/v1":
      return parsePlatformConfigurationSource(input);
    case "configuration-provenance/v1":
      return parseConfigurationProvenance(input);
    case "configuration-paths/v1":
      return parseConfigurationPaths(input);
    case "orchestration-command-result/v1":
      return parseOrchestrationCommandResult(input);
    default:
      return null;
  }
}

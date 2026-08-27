import { types as nodeTypes } from "node:util";
import { canonicalJson, type ContractRecord } from "@orchestration-platform/contracts";
import {
  parseConformanceEnvironment,
  parseConformanceRawArtifactManifest,
  serializeConformanceContract,
  sha256Bytes,
} from "./contracts.js";
import { iss002VectorIds } from "./stable.js";

export interface Iss002VectorExecution {
  readonly fixtureId: string;
  readonly normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
}

export interface CreateIss002ObservationArtifactsInput {
  readonly abiBytes: Uint8Array;
  readonly architecture: "ARM64" | "X64";
  readonly environmentBytes: Uint8Array;
  readonly filesystemProfileBytes: Uint8Array;
  readonly jobId: string;
  readonly nodeVersion: string;
  readonly operatingSystem: "LINUX" | "MACOS" | "WINDOWS";
  readonly packageManagerVersion: string;
  readonly runnerToken: "ISS002_CONTRACTS";
  readonly stderrBytes: Uint8Array;
  readonly stdoutBytes: Uint8Array;
  readonly suiteId: "iss002-contracts";
  readonly vectorExecutions: readonly Iss002VectorExecution[];
  readonly walkDurationsNanoseconds: readonly string[] | null;
}

export type Iss002ObservationArtifactsResult =
  | {
      readonly ok: true;
      readonly environment: ContractRecord;
      readonly environmentBytes: Uint8Array;
      readonly environmentRecordBytes: Uint8Array;
      readonly maximumWalkDurationNanoseconds: string | null;
      readonly normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
      readonly rawArtifactManifest: ContractRecord;
      readonly rawManifestBytes: Uint8Array;
      readonly reportBytes: Uint8Array;
      readonly stderrBytes: Uint8Array;
      readonly stdoutBytes: Uint8Array;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

const inputFields = Object.freeze([
  "abiBytes",
  "architecture",
  "environmentBytes",
  "filesystemProfileBytes",
  "jobId",
  "nodeVersion",
  "operatingSystem",
  "packageManagerVersion",
  "runnerToken",
  "stderrBytes",
  "stdoutBytes",
  "suiteId",
  "vectorExecutions",
  "walkDurationsNanoseconds",
]);
const executionFields = Object.freeze(["fixtureId", "normalizedResult"]);
const results = Object.freeze(["FAIL", "PASS", "UNSUPPORTED"] as const);

function refusal(...issues: readonly string[]): Iss002ObservationArtifactsResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
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
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
  }
  return input as Readonly<Record<string, unknown>>;
}

function exactBytes(input: unknown): input is Uint8Array {
  return input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype;
}

function rawEnvironmentInventory(input: Uint8Array): boolean {
  if (input.byteLength === 0) return false;
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function executions(input: unknown): readonly Iss002VectorExecution[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length !== iss002VectorIds.length
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const expected = new Set([
    ...Array.from({ length: input.length }, (_, index) => String(index)),
    "length",
  ]);
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expected.has(key)) ||
    Reflect.ownKeys(descriptors).length !== expected.size
  )
    return undefined;
  const values: Iss002VectorExecution[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    const row =
      descriptor && "value" in descriptor
        ? exactRecord(descriptor.value, executionFields)
        : undefined;
    if (
      !descriptor?.enumerable ||
      !row ||
      row.fixtureId !== iss002VectorIds[index] ||
      typeof row.normalizedResult !== "string" ||
      !results.includes(row.normalizedResult as (typeof results)[number])
    )
      return undefined;
    values.push(
      Object.freeze({
        fixtureId: row.fixtureId as string,
        normalizedResult: row.normalizedResult as Iss002VectorExecution["normalizedResult"],
      }),
    );
  }
  return Object.freeze(values);
}

function walkDurations(input: unknown): readonly string[] | null | undefined {
  if (input === null) return null;
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length !== 3
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const values: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const descriptor = descriptors[String(index)];
    const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (
      !descriptor?.enumerable ||
      typeof value !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      BigInt(value) > 5_000_000_000n
    )
      return undefined;
    values.push(value);
  }
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== ["0", "1", "2", "length"].join("\0"))
    return undefined;
  return Object.freeze(values);
}

function normalizedResult(
  vectorExecutions: readonly Iss002VectorExecution[],
): "FAIL" | "PASS" | "UNSUPPORTED" {
  if (vectorExecutions.some((row) => row.normalizedResult === "FAIL")) return "FAIL";
  return vectorExecutions.some((row) => row.normalizedResult === "UNSUPPORTED")
    ? "UNSUPPORTED"
    : "PASS";
}

function rawManifest(
  raw: Readonly<Record<"environment" | "report" | "stderr" | "stdout", Uint8Array>>,
): ContractRecord {
  const mediaTypes = Object.freeze({
    environment: "APPLICATION_JSON",
    report: "APPLICATION_JSON",
    stderr: "TEXT_PLAIN",
    stdout: "TEXT_PLAIN",
  } as const);
  return Object.freeze({
    entries: Object.freeze(
      (["environment", "report", "stderr", "stdout"] as const).map((name) =>
        Object.freeze({
          byteLength: String(raw[name].byteLength),
          mediaType: mediaTypes[name],
          name,
          sha256Digest: sha256Bytes(raw[name]),
        }),
      ),
    ),
    schemaVersion: "conformance-raw-artifact-manifest/v1",
  });
}

export function createIss002ObservationArtifacts(
  inputValue: CreateIss002ObservationArtifactsInput,
): Iss002ObservationArtifactsResult {
  try {
    const input = exactRecord(inputValue, inputFields);
    if (!input) return refusal("observation:closed-input-required");
    for (const field of [
      "abiBytes",
      "environmentBytes",
      "filesystemProfileBytes",
      "stderrBytes",
      "stdoutBytes",
    ] as const)
      if (!exactBytes(input[field])) return refusal(`observation:${field}-required`);
    if (
      (input.abiBytes as Uint8Array).byteLength === 0 ||
      (input.filesystemProfileBytes as Uint8Array).byteLength === 0
    )
      return refusal("observation:profile-bytes-empty");
    if (!rawEnvironmentInventory(input.environmentBytes as Uint8Array))
      return refusal("observation:environment-inventory-refused");
    const vectorExecutions = executions(input.vectorExecutions);
    const durations = walkDurations(input.walkDurationsNanoseconds);
    if (!vectorExecutions) return refusal("observation:vector-execution-census-refused");
    if (durations === undefined) return refusal("observation:walk-duration-census-refused");
    const walk = vectorExecutions[vectorExecutions.length - 1]!;
    if ((walk.normalizedResult === "PASS") !== (durations !== null))
      return refusal("observation:walk-result-arm-refused");
    const expectedJob =
      typeof input.operatingSystem === "string"
        ? `iss002-contracts-${input.operatingSystem.toLowerCase()}`
        : undefined;
    if (
      input.jobId !== expectedJob ||
      input.runnerToken !== "ISS002_CONTRACTS" ||
      input.suiteId !== "iss002-contracts"
    )
      return refusal("observation:stable-runner-selection-refused");
    const environment = Object.freeze({
      abiDigest: sha256Bytes(input.abiBytes as Uint8Array),
      architecture: input.architecture,
      custodyObservationDigest: null,
      filesystemProfileDigest: sha256Bytes(input.filesystemProfileBytes as Uint8Array),
      helperProfileDigest: null,
      nodeVersion: input.nodeVersion,
      operatingSystem: input.operatingSystem,
      osImageDigest: sha256Bytes(input.environmentBytes as Uint8Array),
      packageManagerVersion: input.packageManagerVersion,
      runnerClass: "EPHEMERAL_HOSTED",
      schemaVersion: "conformance-environment/v1",
    });
    const parsedEnvironment = parseConformanceEnvironment(environment);
    if (!parsedEnvironment.ok)
      return refusal(...parsedEnvironment.issues.map((issue) => `environment.${issue}`));
    const result = normalizedResult(vectorExecutions);
    const maximum =
      durations === null
        ? null
        : durations.reduce((current, value) => (BigInt(value) > BigInt(current) ? value : current));
    const reportBytes = new TextEncoder().encode(
      canonicalJson({
        executedVectors: vectorExecutions,
        jobId: input.jobId,
        maximumWalkDurationNanoseconds: maximum,
        normalizedResult: result,
        runnerToken: input.runnerToken,
        schemaVersion: "iss002-conformance-raw-report/v1",
        suiteId: input.suiteId,
        walkDurationsNanoseconds: durations,
      }),
    );
    const raw = Object.freeze({
      environment: Uint8Array.from(input.environmentBytes as Uint8Array),
      report: reportBytes,
      stderr: Uint8Array.from(input.stderrBytes as Uint8Array),
      stdout: Uint8Array.from(input.stdoutBytes as Uint8Array),
    });
    const manifest = rawManifest(raw);
    const parsedManifest = parseConformanceRawArtifactManifest(manifest);
    if (!parsedManifest.ok)
      return refusal(...parsedManifest.issues.map((issue) => `manifest.${issue}`));
    const serializedEnvironment = serializeConformanceContract(
      "conformance-environment/v1",
      parsedEnvironment.value,
    );
    const serializedManifest = serializeConformanceContract(
      "conformance-raw-artifact-manifest/v1",
      parsedManifest.value,
    );
    if (!(serializedEnvironment.ok && serializedManifest.ok))
      return refusal("observation:serialization-refused");
    return Object.freeze({
      environment: parsedEnvironment.value,
      environmentBytes: raw.environment,
      environmentRecordBytes: serializedEnvironment.bytes,
      maximumWalkDurationNanoseconds: maximum,
      normalizedResult: result,
      ok: true as const,
      rawArtifactManifest: parsedManifest.value,
      rawManifestBytes: serializedManifest.bytes,
      reportBytes: raw.report,
      stderrBytes: raw.stderr,
      stdoutBytes: raw.stdout,
    });
  } catch {
    return refusal("observation:unreadable");
  }
}

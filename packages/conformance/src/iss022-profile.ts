import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { types as nodeTypes } from "node:util";
import {
  canonicalJson,
  computePhysicalLocatorObservationDigest,
  isCanonicalTimestamp,
  isSha256,
  parsePhysicalLocatorObservation,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  computePortableNodeAbiDigest,
  computePortableNodeHelperDigest,
  computePortableNodeHelperProfileDigest,
  computePortablePrimitivesOsProfileDigest,
  computePortablePrimitivesPreCustodyEnvironmentDigest,
  computePortableProbeCustodyInstanceDigest,
  computePortableProbeCustodyReceiptDigest,
  parsePortablePrimitivesOsProfile,
  parsePortableProbeCustodyReceipt,
  portablePrimitiveCaseIds,
  portableU32Hex,
  portableU64Hex,
} from "@orchestration-platform/portable-primitives";
import {
  computeConformanceRecordDigest,
  parseConformanceEnvironment,
  sha256Bytes,
} from "./contracts.js";
import { normalizeIss022PhysicalProbe } from "./iss022-handler.js";

const inputFields = Object.freeze([
  "architecture",
  "custodyParentRoot",
  "environmentBytes",
  "jobId",
  "packageManagerVersion",
  "providerRunDigest",
  "stableRoot",
] as const);
const coordinateFields = Object.freeze([
  "architecture",
  "jobId",
  "observedAt",
  "osImageDigest",
  "packageManagerVersion",
  "providerRunDigest",
] as const);
const captureFields = Object.freeze([
  "executableBytesDigest",
  "handleAfter",
  "handleBefore",
  "modulesVersion",
  "napiVersion",
  "nodeVersion",
  "pathAfter",
  "pathBefore",
  "realpathAfter",
  "realpathBefore",
] as const);
const identityFields = Object.freeze([
  "changeTimeNanoseconds",
  "deviceBytes",
  "inodeBytes",
  "modeBytes",
  "modificationTimeNanoseconds",
  "sizeBytes",
] as const);
const selectionFields = Object.freeze([
  "custodyInstanceDigest",
  "custodyReceipt",
  "custodyReceiptDigest",
  "locatorObservation",
  "locatorObservationDigest",
  "operatingSystem",
  "osProfile",
  "osProfileDigest",
  "physicalDestinationIdentity",
] as const);
const jobId = /^[a-z][a-z0-9-]{0,63}$/;

export const iss022CoordinateFields = coordinateFields;

export type Iss022ProfileSelection = Readonly<{
  custodyInstanceDigest: string;
  custodyReceipt: ContractRecord;
  custodyReceiptDigest: string;
  locatorObservation: ContractRecord;
  locatorObservationDigest: string;
  operatingSystem: "LINUX" | "MACOS" | "WINDOWS";
  osProfile: ContractRecord;
  osProfileDigest: string;
  physicalDestinationIdentity: ContractRecord;
}>;
export type Iss022ProfileAuthority = Readonly<{
  helperAbiDigest: string;
  helperDigest: string;
  helperProfileDigest: string;
  selection: Iss022ProfileSelection | null;
}>;
export type Iss022EnvironmentAuthority = Readonly<{
  environment: ContractRecord;
  environmentDigest: string;
  normalizedResult: "PASS" | "UNKNOWN" | "UNSUPPORTED";
  profile: Iss022ProfileAuthority;
}>;
type Iss022StableSuiteInput = Readonly<{
  architecture: "ARM64" | "X64";
  custodyParentRoot: string;
  environmentBytes: Uint8Array;
  jobId: string;
  osImageDigest: string;
  packageManagerVersion: string;
  providerRunDigest: string;
  stableRoot: string;
}>;
type Iss022StableSuiteInputResult =
  { readonly ok: true; readonly value: Iss022StableSuiteInput } | ReturnType<typeof failure>;

function failure(...issues: readonly string[]) {
  return { ok: false as const, issues: Object.freeze([...new Set(issues)].sort()) };
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

export function parseIss022SuiteCoordinates(
  input: unknown,
  includeRoots: true,
): Iss022StableSuiteInputResult;
export function parseIss022SuiteCoordinates(input: unknown, includeRoots: false): ParseResult;
export function parseIss022SuiteCoordinates(
  input: unknown,
  includeRoots: boolean,
): Iss022StableSuiteInputResult | ParseResult {
  if (includeRoots) {
    const record = exactRecord(input, inputFields);
    if (!record) return failure("record:field-census-refused");
    const issues: string[] = [];
    if (!exactBytes(record.environmentBytes)) issues.push("environmentBytes:exact-bytes-required");
    else if (!rawEnvironmentInventory(record.environmentBytes))
      issues.push("environmentBytes:inventory-refused");
    if (record.architecture !== "ARM64" && record.architecture !== "X64")
      issues.push("architecture:invalid");
    if (!/^11\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(String(record.packageManagerVersion)))
      issues.push("packageManagerVersion:invalid");
    if (typeof record.providerRunDigest !== "string" || !isSha256(record.providerRunDigest))
      issues.push("providerRunDigest:invalid");
    if (!jobId.test(String(record.jobId))) issues.push("jobId:invalid");
    if (
      (["custodyParentRoot", "stableRoot"] as const).some(
        (field) =>
          typeof record[field] !== "string" || resolve(String(record[field])) !== record[field],
      )
    )
      issues.push("root:absolute-normalized-required");
    if (issues.length > 0) return failure(...issues);
    const environmentBytes = Uint8Array.from(record.environmentBytes as Uint8Array);
    return {
      ok: true as const,
      value: Object.freeze({
        architecture: record.architecture as "ARM64" | "X64",
        custodyParentRoot: String(record.custodyParentRoot),
        environmentBytes,
        jobId: String(record.jobId),
        osImageDigest: sha256Bytes(environmentBytes),
        packageManagerVersion: String(record.packageManagerVersion),
        providerRunDigest: String(record.providerRunDigest),
        stableRoot: String(record.stableRoot),
      }),
    };
  }
  const parsed = snapshotClosedRecord(input, coordinateFields);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (parsed.value.architecture !== "ARM64" && parsed.value.architecture !== "X64")
    issues.push("architecture:invalid");
  if (!isSha256(parsed.value.osImageDigest)) issues.push("osImageDigest:invalid");
  if (
    !/^11\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(String(parsed.value.packageManagerVersion))
  )
    issues.push("packageManagerVersion:invalid");
  if (!isSha256(parsed.value.providerRunDigest)) issues.push("providerRunDigest:invalid");
  if (!jobId.test(String(parsed.value.jobId))) issues.push("jobId:invalid");
  if (!isCanonicalTimestamp(parsed.value.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? parsed : failure(...issues);
}

function fileIdentity(value: BigIntStats) {
  return Object.freeze({
    changeTimeNanoseconds: portableU64Hex(value.ctimeNs, "changeTimeNanoseconds"),
    deviceBytes: portableU64Hex(value.dev, "device"),
    inodeBytes: portableU64Hex(value.ino, "inode"),
    modeBytes: portableU32Hex(value.mode, "mode"),
    modificationTimeNanoseconds: portableU64Hex(value.mtimeNs, "modificationTimeNanoseconds"),
    sizeBytes: portableU64Hex(value.size, "size"),
  });
}

function validIdentity(input: unknown): input is ContractRecord {
  const parsed = snapshotClosedRecord(input, identityFields);
  return (
    parsed.ok &&
    /^[0-9a-f]{16}$/.test(String(parsed.value.changeTimeNanoseconds)) &&
    /^[0-9a-f]{16}$/.test(String(parsed.value.deviceBytes)) &&
    /^[0-9a-f]{16}$/.test(String(parsed.value.inodeBytes)) &&
    /^[0-9a-f]{8}$/.test(String(parsed.value.modeBytes)) &&
    /^[0-9a-f]{16}$/.test(String(parsed.value.modificationTimeNanoseconds)) &&
    /^[0-9a-f]{16}$/.test(String(parsed.value.sizeBytes))
  );
}

export function validIss022ExecutableCapture(input: unknown): input is ContractRecord {
  const parsed = snapshotClosedRecord(input, captureFields);
  if (!parsed.ok || !isSha256(parsed.value.executableBytesDigest)) return false;
  for (const field of ["handleAfter", "handleBefore", "pathAfter", "pathBefore"] as const)
    if (!validIdentity(parsed.value[field])) return false;
  return (
    parsed.value.realpathBefore === parsed.value.realpathAfter &&
    canonicalJson(parsed.value.handleBefore) === canonicalJson(parsed.value.handleAfter) &&
    canonicalJson(parsed.value.handleBefore) === canonicalJson(parsed.value.pathBefore) &&
    canonicalJson(parsed.value.handleBefore) === canonicalJson(parsed.value.pathAfter)
  );
}

async function hashHandle(handle: FileHandle) {
  const hash = createHash("sha256");
  let size = 0n;
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
    hash.update(chunk);
    size += BigInt(chunk.length);
  }
  return Object.freeze({ digest: hash.digest("hex"), size });
}

export async function withIss022ExecutableCustody<T>(
  callback: () => Promise<T>,
): Promise<Readonly<{ executableCapture: ContractRecord; value: T }>> {
  const realpathBefore = await realpath(process.execPath);
  const pathBeforeRaw = await stat(realpathBefore, { bigint: true });
  const handle = await open(realpathBefore, constants.O_RDONLY);
  try {
    const handleBeforeRaw = await handle.stat({ bigint: true });
    if (!pathBeforeRaw.isFile() || !handleBeforeRaw.isFile())
      throw new TypeError("executable:regular-file-required");
    const bytesBefore = await hashHandle(handle);
    const value = await callback();
    const realpathAfter = await realpath(process.execPath);
    const [handleAfterRaw, pathAfterRaw, bytesAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      stat(realpathAfter, { bigint: true }),
      hashHandle(handle),
    ]);
    const capture = Object.freeze({
      executableBytesDigest: bytesBefore.digest,
      handleAfter: fileIdentity(handleAfterRaw),
      handleBefore: fileIdentity(handleBeforeRaw),
      modulesVersion: process.versions.modules,
      napiVersion: process.versions.napi,
      nodeVersion: process.versions.node,
      pathAfter: fileIdentity(pathAfterRaw),
      pathBefore: fileIdentity(pathBeforeRaw),
      realpathAfter,
      realpathBefore,
    });
    if (
      !validIss022ExecutableCapture(capture) ||
      bytesBefore.digest !== bytesAfter.digest ||
      bytesBefore.size !== bytesAfter.size ||
      BigInt(`0x${capture.handleAfter.sizeBytes}`) !== bytesAfter.size
    )
      throw new TypeError("executable:unstable");
    return Object.freeze({ executableCapture: capture, value });
  } finally {
    await handle.close();
  }
}

function expectedOs(physicalOs: unknown): "LINUX" | "MACOS" | "WINDOWS" | undefined {
  if (physicalOs === "DARWIN") return "MACOS";
  if (physicalOs === "LINUX" || physicalOs === "WINDOWS") return physicalOs;
  return undefined;
}

function expectedRelations(os: "LINUX" | "MACOS" | "WINDOWS") {
  return os === "MACOS"
    ? Object.freeze({ caseAlias: "IDENTICAL", unicodeAlias: "IDENTICAL" })
    : os === "WINDOWS"
      ? Object.freeze({ caseAlias: "IDENTICAL", unicodeAlias: "DISTINCT_ABSENT" })
      : Object.freeze({ caseAlias: "DISTINCT_ABSENT", unicodeAlias: "DISTINCT_ABSENT" });
}

export function deriveIss022PhysicalProfile(executions: readonly ContractRecord[]) {
  const physical = executions.slice(0, 6);
  const existing = physical[0];
  const absent = executions[1];
  const caseAlias = executions[2];
  const unicodeAlias = executions[3];
  const symlinkSwap = physical[4];
  const parentSwap = physical[5];
  if (!existing || !absent || !caseAlias || !unicodeAlias || !symlinkSwap || !parentSwap)
    return undefined;
  const existingFacts = existing.rawFacts as ContractRecord;
  const absentFacts = absent.rawFacts as ContractRecord;
  const caseFacts = caseAlias.rawFacts as ContractRecord;
  const unicodeFacts = unicodeAlias.rawFacts as ContractRecord;
  const revalidated = normalizeIss022PhysicalProbe(physical.map((row) => row.rawFacts));
  if (!revalidated.ok || canonicalJson(revalidated.vectorExecutions) !== canonicalJson(physical))
    return undefined;
  const os = expectedOs(absentFacts.operatingSystem);
  if (!os) return undefined;
  const relations = expectedRelations(os);
  if (
    physical.some((row) => row.normalizedResult !== "PASS") ||
    existing.caseId !== "PHYSICAL_EXISTING" ||
    absent.caseId !== "PHYSICAL_ABSENT_LEAF" ||
    caseAlias.caseId !== "PHYSICAL_CASE_ALIAS" ||
    unicodeAlias.caseId !== "PHYSICAL_UNICODE_ALIAS" ||
    symlinkSwap.caseId !== "PHYSICAL_SYMLINK_SWAP" ||
    parentSwap.caseId !== "PHYSICAL_PARENT_SWAP" ||
    existingFacts.derivation === null ||
    absentFacts.derivation === null ||
    expectedOs(caseFacts.operatingSystem) !== os ||
    expectedOs(unicodeFacts.operatingSystem) !== os ||
    caseFacts.relationBefore !== relations.caseAlias ||
    caseFacts.relationAfter !== relations.caseAlias ||
    unicodeFacts.relationBefore !== relations.unicodeAlias ||
    unicodeFacts.relationAfter !== relations.unicodeAlias
  )
    return undefined;
  return Object.freeze({
    caseComparisonProfile:
      relations.caseAlias === "IDENTICAL" ? "CASE_INSENSITIVE_LOWERCASE" : "CASE_SENSITIVE",
    operatingSystem: os,
    unicodeNormalizationProfile: relations.unicodeAlias === "IDENTICAL" ? "NFD" : "NFC",
  });
}

export function constructIss022ProfileArtifacts(
  executions: readonly ContractRecord[],
  executableCapture: unknown,
  coordinates: unknown,
  vectorCensusDigest: string,
): { readonly ok: true; readonly value: Iss022ProfileAuthority } | ReturnType<typeof failure> {
  try {
    const parsedCoordinates = parseIss022SuiteCoordinates(coordinates, false);
    if (!parsedCoordinates.ok) return failure(...parsedCoordinates.issues);
    if (!isSha256(vectorCensusDigest)) return failure("vectorCensusDigest:invalid");
    if (!validIss022ExecutableCapture(executableCapture))
      return failure("executableCapture:refused");
    const capture = executableCapture;
    const helperAbiDigest = computePortableNodeAbiDigest(
      String(capture.nodeVersion),
      String(capture.modulesVersion),
      String(capture.napiVersion),
    );
    const helperDigest = computePortableNodeHelperDigest(
      String(capture.executableBytesDigest),
      String(capture.nodeVersion),
      helperAbiDigest,
    );
    const helperProfileDigest = computePortableNodeHelperProfileDigest(
      helperDigest,
      helperAbiDigest,
    );
    const helper = Object.freeze({ helperAbiDigest, helperDigest, helperProfileDigest });
    const physical = executions.slice(0, 6);
    if (physical.length !== 6) return failure("physicalExecutions:missing");
    if (physical.some((row) => row.normalizedResult !== "PASS"))
      return { ok: true, value: Object.freeze({ ...helper, selection: null }) };
    const absent = executions[1];
    const profile = deriveIss022PhysicalProfile(executions);
    if (!absent || !profile) return failure("physicalProfile:unavailable");
    const derivation = (absent.rawFacts as ContractRecord).derivation as ContractRecord;
    if (!derivation || typeof derivation !== "object") return failure("derivation:unavailable");
    if (
      parsedCoordinates.value.jobId !==
      `iss022-portable-primitives-${profile.operatingSystem.toLowerCase()}`
    )
      return failure("jobId:operating-system-mismatch");
    const observedAt = String(parsedCoordinates.value.observedAt);
    const physicalDestinationIdentityDigest = String(derivation.physicalDestinationIdentityDigest);
    const rootReadbackDigest = String(derivation.rootReadbackDigest);
    const osProfile = Object.freeze({
      caseComparisonProfile: profile.caseComparisonProfile,
      filesystemTypeBytes: String(derivation.filesystemTypeBytes),
      helperAbiDigest,
      helperDigest,
      operatingSystem: profile.operatingSystem,
      schemaVersion: "portable-primitives-os-profile/v1",
      statDeviceBytes: String(derivation.statDeviceBytes),
      unicodeNormalizationProfile: profile.unicodeNormalizationProfile,
      vectorCensusDigest,
    });
    if (!parsePortablePrimitivesOsProfile(osProfile).ok) return failure("osProfile:invalid");
    const osProfileDigest = computePortablePrimitivesOsProfileDigest(osProfile);
    const preCustodyEnvironmentDigest = computePortablePrimitivesPreCustodyEnvironmentDigest(
      helperAbiDigest,
      parsedCoordinates.value.architecture as "ARM64" | "X64",
      osProfileDigest,
      helperProfileDigest,
      String(capture.nodeVersion),
      profile.operatingSystem,
      String(parsedCoordinates.value.osImageDigest),
      String(parsedCoordinates.value.packageManagerVersion),
    );
    const custodyInstanceDigest = computePortableProbeCustodyInstanceDigest(
      String(derivation.hostCustodyNamespaceDigest),
      preCustodyEnvironmentDigest,
      String(parsedCoordinates.value.providerRunDigest),
      String(parsedCoordinates.value.jobId),
      rootReadbackDigest,
    );
    const custodyReceipt = Object.freeze({
      custodyInstanceDigest,
      helperAbiDigest,
      helperDigest,
      observedAt,
      osProfileDigest,
      physicalDestinationIdentityDigest,
      rootReadbackDigest,
      schemaVersion: "portable-probe-custody-receipt/v1",
    });
    if (!parsePortableProbeCustodyReceipt(custodyReceipt).ok)
      return failure("custodyReceipt:invalid");
    const custodyReceiptDigest = computePortableProbeCustodyReceiptDigest(custodyReceipt);
    const locatorObservation = Object.freeze({
      caseComparisonProfile: profile.caseComparisonProfile,
      custodyInstanceDigest,
      custodyReceiptDigest,
      disposition: "ADMITTED",
      helperDigest,
      helperVersion: String(capture.nodeVersion),
      logicalLocatorDigest: String(derivation.logicalLocatorDigest),
      nativeIdentityReadbackDigest: String(derivation.nativeIdentityReadbackDigest),
      observedAt,
      physicalDestinationIdentityDigest,
      resolvedLocatorReadbackDigest: String(derivation.resolvedLocatorReadbackDigest),
      schemaVersion: "physical-destination-locator-observation-receipt/v1",
      unicodeNormalizationProfile: profile.unicodeNormalizationProfile,
      validFrom: observedAt,
      validUntil: null,
    });
    if (!parsePhysicalLocatorObservation(locatorObservation).ok)
      return failure("locatorObservation:invalid");
    return {
      ok: true,
      value: Object.freeze({
        ...helper,
        selection: Object.freeze({
          custodyInstanceDigest,
          custodyReceipt,
          custodyReceiptDigest,
          locatorObservation,
          locatorObservationDigest: computePhysicalLocatorObservationDigest(locatorObservation),
          operatingSystem: profile.operatingSystem,
          osProfile,
          osProfileDigest,
          physicalDestinationIdentity: derivation.physicalDestinationIdentity as ContractRecord,
        }),
      }),
    };
  } catch {
    return failure("profile:unreadable");
  }
}

export function constructIss022EnvironmentAuthority(
  executions: readonly ContractRecord[],
  executableCapture: unknown,
  coordinates: unknown,
  vectorCensusDigest: string,
): { readonly ok: true; readonly value: Iss022EnvironmentAuthority } | ReturnType<typeof failure> {
  const parsedCoordinates = parseIss022SuiteCoordinates(coordinates, false);
  if (!parsedCoordinates.ok) return failure(...parsedCoordinates.issues);
  if (
    executions.length !== portablePrimitiveCaseIds.length ||
    executions.some(
      (row, index) =>
        row.caseId !== portablePrimitiveCaseIds[index] ||
        !["PASS", "UNKNOWN", "UNSUPPORTED"].includes(String(row.normalizedResult)),
    )
  )
    return failure("vectorExecutions:closed-census-required");
  const profile = constructIss022ProfileArtifacts(
    executions,
    executableCapture,
    parsedCoordinates.value,
    vectorCensusDigest,
  );
  if (!profile.ok) return profile;
  const physicalDiagnostic = executions
    .slice(0, 6)
    .some((row) => row.normalizedResult === "UNKNOWN" || row.normalizedResult === "UNSUPPORTED");
  const normalizedResult = executions.some((row) => row.normalizedResult === "UNKNOWN")
    ? "UNKNOWN"
    : executions.some((row) => row.normalizedResult === "UNSUPPORTED")
      ? "UNSUPPORTED"
      : "PASS";
  if ((profile.value.selection === null) !== physicalDiagnostic)
    return failure("environment:selection-arm-mismatch");
  if (profile.value.selection === null && normalizedResult === "PASS")
    return failure("environment:diagnostic-result-required");
  const expectedOperatingSystem: "LINUX" | "MACOS" | "WINDOWS" | undefined = (
    {
      "iss022-portable-primitives-linux": "LINUX",
      "iss022-portable-primitives-macos": "MACOS",
      "iss022-portable-primitives-windows": "WINDOWS",
    } as Readonly<Record<string, "LINUX" | "MACOS" | "WINDOWS">>
  )[String(parsedCoordinates.value.jobId)];
  if (!expectedOperatingSystem) return failure("jobId:operating-system-mismatch");
  if (
    profile.value.selection !== null &&
    profile.value.selection.operatingSystem !== expectedOperatingSystem
  )
    return failure("environment:operating-system-mismatch");
  const environment = Object.freeze({
    abiDigest: profile.value.helperAbiDigest,
    architecture: parsedCoordinates.value.architecture,
    custodyObservationDigest: profile.value.selection?.custodyReceiptDigest ?? null,
    filesystemProfileDigest: profile.value.selection?.osProfileDigest ?? null,
    helperProfileDigest: profile.value.helperProfileDigest,
    nodeVersion: (executableCapture as ContractRecord).nodeVersion,
    operatingSystem: expectedOperatingSystem,
    osImageDigest: parsedCoordinates.value.osImageDigest,
    packageManagerVersion: parsedCoordinates.value.packageManagerVersion,
    runnerClass: "EPHEMERAL_HOSTED",
    schemaVersion: "conformance-environment/v1",
  });
  const parsedEnvironment = parseConformanceEnvironment(environment);
  if (!parsedEnvironment.ok)
    return failure(...parsedEnvironment.issues.map((issue) => `environment.${issue}`));
  return {
    ok: true,
    value: Object.freeze({
      environment: parsedEnvironment.value,
      environmentDigest: computeConformanceRecordDigest(
        "conformance-environment/v1",
        parsedEnvironment.value,
      ),
      normalizedResult,
      profile: profile.value,
    }),
  };
}

export function validateIss022ProfileArtifacts(
  report: ContractRecord,
  executions: readonly ContractRecord[],
  coordinates: unknown,
  vectorCensusDigest: string,
): readonly string[] {
  const expected = constructIss022ProfileArtifacts(
    executions,
    report.executableCapture,
    coordinates,
    vectorCensusDigest,
  );
  if (!expected.ok) return expected.issues;
  for (const field of ["helperAbiDigest", "helperDigest", "helperProfileDigest"] as const)
    if (canonicalJson(report[field]) !== canonicalJson(expected.value[field]))
      return [`${field}:mismatch`];
  if (report.selection === null)
    return expected.value.selection === null ? [] : ["selection:all-pass-required"];
  if (expected.value.selection === null) return ["selection:non-pass-refused"];
  const selection = snapshotClosedRecord(report.selection, selectionFields);
  if (!selection.ok) return selection.issues;
  if (!parsePortablePrimitivesOsProfile(selection.value.osProfile).ok) return ["osProfile:invalid"];
  if (!parsePortableProbeCustodyReceipt(selection.value.custodyReceipt).ok)
    return ["custodyReceipt:invalid"];
  if (!parsePhysicalLocatorObservation(selection.value.locatorObservation).ok)
    return ["locatorObservation:invalid"];
  if (canonicalJson(selection.value) !== canonicalJson(expected.value.selection))
    return ["selection:mismatch"];
  return [];
}

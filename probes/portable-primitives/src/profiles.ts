import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";

const osProfileFields = Object.freeze([
  "caseComparisonProfile",
  "filesystemTypeBytes",
  "helperAbiDigest",
  "helperDigest",
  "operatingSystem",
  "schemaVersion",
  "statDeviceBytes",
  "unicodeNormalizationProfile",
  "vectorCensusDigest",
] as const);
const custodyReceiptFields = Object.freeze([
  "custodyInstanceDigest",
  "helperAbiDigest",
  "helperDigest",
  "observedAt",
  "osProfileDigest",
  "physicalDestinationIdentityDigest",
  "rootReadbackDigest",
  "schemaVersion",
] as const);

const fixedU64 = /^[0-9a-f]{16}$/;
const fixed32 = /^[0-9a-f]{64}$/;

function isCanonicalNodeVersion(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 3 &&
    parts[0] === "24" &&
    isCanonicalDecimal(parts[1]) &&
    isCanonicalDecimal(parts[2])
  );
}

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !isSha256(record[field])).map((field) => `${field}:invalid`);
}

export function computePortableHostCustodyNamespaceDigest(namespaceFileHex: string): string {
  if (!fixed32.test(namespaceFileHex)) throw new TypeError("namespaceFileHex:invalid");
  return framedDigest("portable-host-custody-namespace/v1", [frame.fixed(namespaceFileHex)]);
}

export function computePortableNodeAbiDigest(
  nodeVersion: string,
  modulesVersion: string,
  napiVersion: string,
): string {
  if (!isCanonicalNodeVersion(nodeVersion)) throw new TypeError("nodeVersion:invalid");
  if (
    !isCanonicalDecimal(modulesVersion) ||
    modulesVersion === "0" ||
    !isCanonicalDecimal(napiVersion) ||
    napiVersion === "0"
  )
    throw new TypeError("abiVersion:invalid");
  return framedDigest("portable-node-abi/v1", [
    frame.text(nodeVersion),
    frame.text(modulesVersion),
    frame.text(napiVersion),
  ]);
}

export function computePortableNodeHelperDigest(
  executableBytesDigest: string,
  nodeVersion: string,
  helperAbiDigest: string,
): string {
  if (!isSha256(executableBytesDigest)) throw new TypeError("executableBytesDigest:invalid");
  if (!isCanonicalNodeVersion(nodeVersion)) throw new TypeError("nodeVersion:invalid");
  if (!isSha256(helperAbiDigest)) throw new TypeError("helperAbiDigest:invalid");
  return framedDigest("portable-node-helper/v1", [
    frame.raw32(executableBytesDigest),
    frame.text(nodeVersion),
    frame.raw32(helperAbiDigest),
  ]);
}

export function computePortableNodeHelperProfileDigest(
  helperDigest: string,
  helperAbiDigest: string,
): string {
  if (!(isSha256(helperDigest) && isSha256(helperAbiDigest)))
    throw new TypeError("helperProfile:invalid");
  return framedDigest("portable-node-helper-profile/v1", [
    frame.text("NODE24_BUILTIN_FS_CHILD_PROCESS_V1"),
    frame.raw32(helperDigest),
    frame.raw32(helperAbiDigest),
  ]);
}

export function computePortableCustodyProfileDigest(): string {
  return framedDigest("portable-custody-profile/v1", [
    frame.text("STABLE_PARENT_EXCLUSIVE_NAMESPACE_FILE_V1"),
  ]);
}

export function parsePortablePrimitivesOsProfile(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, osProfileFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = digestIssues(record, ["helperAbiDigest", "helperDigest", "vectorCensusDigest"]);
  if (record.schemaVersion !== "portable-primitives-os-profile/v1")
    issues.push("schemaVersion:mismatch");
  if (!["LINUX", "MACOS", "WINDOWS"].includes(String(record.operatingSystem)))
    issues.push("operatingSystem:invalid");
  if (
    record.caseComparisonProfile !== "CASE_INSENSITIVE_LOWERCASE" &&
    record.caseComparisonProfile !== "CASE_SENSITIVE"
  )
    issues.push("caseComparisonProfile:invalid");
  if (record.unicodeNormalizationProfile !== "NFC" && record.unicodeNormalizationProfile !== "NFD")
    issues.push("unicodeNormalizationProfile:invalid");
  const expectedProfiles = Object.freeze({
    LINUX: Object.freeze(["CASE_SENSITIVE", "NFC"]),
    MACOS: Object.freeze(["CASE_INSENSITIVE_LOWERCASE", "NFD"]),
    WINDOWS: Object.freeze(["CASE_INSENSITIVE_LOWERCASE", "NFC"]),
  } as const);
  if (
    Object.hasOwn(expectedProfiles, String(record.operatingSystem)) &&
    (record.caseComparisonProfile !==
      expectedProfiles[record.operatingSystem as keyof typeof expectedProfiles][0] ||
      record.unicodeNormalizationProfile !==
        expectedProfiles[record.operatingSystem as keyof typeof expectedProfiles][1])
  )
    issues.push("operatingSystemProfile:mismatch");
  for (const field of ["filesystemTypeBytes", "statDeviceBytes"] as const)
    if (typeof record[field] !== "string" || !fixedU64.test(record[field]))
      issues.push(`${field}:invalid`);
  return issues.length === 0 ? parsed : failure(...issues);
}

export function computePortablePrimitivesOsProfileDigest(input: unknown): string {
  const parsed = parsePortablePrimitivesOsProfile(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("portable-primitives-os-profile/v1", [
    frame.text(String(record.operatingSystem)),
    frame.raw32(String(record.helperDigest)),
    frame.raw32(String(record.helperAbiDigest)),
    frame.fixed(String(record.statDeviceBytes)),
    frame.fixed(String(record.filesystemTypeBytes)),
    frame.text(String(record.caseComparisonProfile)),
    frame.text(String(record.unicodeNormalizationProfile)),
    frame.raw32(String(record.vectorCensusDigest)),
  ]);
}

export function parsePortableProbeCustodyReceipt(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, custodyReceiptFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "custodyInstanceDigest",
    "helperAbiDigest",
    "helperDigest",
    "osProfileDigest",
    "physicalDestinationIdentityDigest",
    "rootReadbackDigest",
  ]);
  if (parsed.value.schemaVersion !== "portable-probe-custody-receipt/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalTimestamp(parsed.value.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? parsed : failure(...issues);
}

export function computePortableProbeCustodyReceiptDigest(input: unknown): string {
  const parsed = parsePortableProbeCustodyReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("portable-probe-custody-receipt/v1", [
    frame.raw32(String(record.custodyInstanceDigest)),
    frame.raw32(String(record.physicalDestinationIdentityDigest)),
    frame.raw32(String(record.helperDigest)),
    frame.raw32(String(record.helperAbiDigest)),
    frame.raw32(String(record.osProfileDigest)),
    frame.raw32(String(record.rootReadbackDigest)),
    frame.text(String(record.observedAt)),
    frame.canonical(record),
  ]);
}

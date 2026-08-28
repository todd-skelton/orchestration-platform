import {
  canonicalJson,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";

export const portablePrimitiveCaseIds = Object.freeze([
  "PHYSICAL_EXISTING",
  "PHYSICAL_ABSENT_LEAF",
  "PHYSICAL_CASE_ALIAS",
  "PHYSICAL_UNICODE_ALIAS",
  "PHYSICAL_SYMLINK_SWAP",
  "PHYSICAL_PARENT_SWAP",
  "CREATE_ONCE_32_CONTENDERS",
  "LOCK_TWO_UNRELATED_PROCESSES",
  "LOCK_HOLDER_DEATH",
  "LOCK_DEFAULT_NON_INHERITANCE",
  "REPLACE_BEFORE_CREATE",
  "REPLACE_AFTER_CREATE",
  "REPLACE_AFTER_FILE_SYNC",
  "REPLACE_AFTER_RENAME",
  "REPLACE_AFTER_DIRECTORY_SYNC",
  "CAS_PREDECESSOR_MISMATCH",
  "CAS_TWO_CONTENDERS",
  "ABSENCE_HEAD_PLUS_ONE_TWO",
  "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP",
  "HANDLE_CLONE_TRANSFER_REUSE",
  "PARSER_EQUIVALENCE",
] as const);

export type PortablePrimitiveCaseId = (typeof portablePrimitiveCaseIds)[number];
export type PortablePrimitiveResult = "PASS" | "UNKNOWN" | "UNSUPPORTED";
export type PortableOperatingSystem = "LINUX" | "MACOS" | "WINDOWS";

export const portablePrimitiveProfileTokens = Object.freeze([
  "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  "NODE_OPEN_EXCL_SYNC_READBACK_V1",
  "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  "NODE_EXCL_OWNER_DEATH_LOCK_V1",
  "NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1",
  "NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1",
  "NODE_WEAKMAP_NONCE_CALLBACK_V1",
  "NODE_LOCKED_LSTAT_ENOENT_V1",
  "NODE_FRESH_CHILD_CANONICAL_PARSE_V1",
] as const);

export type PortablePrimitiveProfileToken = (typeof portablePrimitiveProfileTokens)[number];

export const portablePhysicalLeafCorpus = Object.freeze([
  "6578697374696e672d6c656166",
  "616273656e742d6c656166",
  "41",
  "61",
  "c3a9",
  "65cc81",
  "6c696e6b2d6c656166",
  "706172656e742d6c656166",
] as const);

export const portablePhysicalLeafCorpusDigest = framedDigest("portable-physical-leaf-corpus/v1", [
  frame.canonical(portablePhysicalLeafCorpus),
]);

const profileByCaseId = Object.freeze({
  PHYSICAL_EXISTING: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  PHYSICAL_ABSENT_LEAF: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  PHYSICAL_CASE_ALIAS: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  PHYSICAL_UNICODE_ALIAS: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  PHYSICAL_SYMLINK_SWAP: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  PHYSICAL_PARENT_SWAP: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  CREATE_ONCE_32_CONTENDERS: "NODE_OPEN_EXCL_SYNC_READBACK_V1",
  LOCK_TWO_UNRELATED_PROCESSES: "NODE_EXCL_OWNER_DEATH_LOCK_V1",
  LOCK_HOLDER_DEATH: "NODE_EXCL_OWNER_DEATH_LOCK_V1",
  LOCK_DEFAULT_NON_INHERITANCE: "NODE_EXCL_OWNER_DEATH_LOCK_V1",
  REPLACE_BEFORE_CREATE: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  REPLACE_AFTER_CREATE: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  REPLACE_AFTER_FILE_SYNC: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  REPLACE_AFTER_RENAME: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  REPLACE_AFTER_DIRECTORY_SYNC: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  CAS_PREDECESSOR_MISMATCH: "NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1",
  CAS_TWO_CONTENDERS: "NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1",
  ABSENCE_HEAD_PLUS_ONE_TWO: "NODE_LOCKED_LSTAT_ENOENT_V1",
  PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP: "NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1",
  HANDLE_CLONE_TRANSFER_REUSE: "NODE_WEAKMAP_NONCE_CALLBACK_V1",
  PARSER_EQUIVALENCE: "NODE_FRESH_CHILD_CANONICAL_PARSE_V1",
} as const satisfies Readonly<Record<PortablePrimitiveCaseId, PortablePrimitiveProfileToken>>);

const inputFields = Object.freeze([
  "barriers",
  "caseId",
  "contenderCount",
  "corpusDigest",
  "crashPoint",
  "expectedReadbackHex",
  "operationToken",
  "payloadHex",
  "predecessorHex",
  "schemaVersion",
  "timeoutMilliseconds",
] as const);
const vectorFields = Object.freeze([
  "caseId",
  "expectedResult",
  "inputsDigest",
  "profileToken",
  "schemaVersion",
] as const);
const observationFields = Object.freeze([
  "caseId",
  "detailsDigest",
  "environmentDigest",
  "normalizedResult",
  "observedAt",
  "operatingSystem",
  "schemaVersion",
  "vectorDigest",
] as const);

type VectorInputSeed = Readonly<{
  barriers?: readonly string[];
  contenderCount?: string;
  crashPoint?: string;
  expectedReadbackHex?: "41" | "42";
  payloadHex?: "41" | "42";
  predecessorHex?: "41" | "42";
  timeoutMilliseconds?: string;
}>;

const seeds = Object.freeze({
  PHYSICAL_EXISTING: { barriers: ["READY"] },
  PHYSICAL_ABSENT_LEAF: { barriers: ["READY"] },
  PHYSICAL_CASE_ALIAS: { barriers: ["READY"] },
  PHYSICAL_UNICODE_ALIAS: { barriers: ["READY"] },
  PHYSICAL_SYMLINK_SWAP: { barriers: ["READY"] },
  PHYSICAL_PARENT_SWAP: { barriers: ["READY"] },
  CREATE_ONCE_32_CONTENDERS: {
    barriers: ["READY"],
    contenderCount: "32",
    expectedReadbackHex: "41",
    payloadHex: "41",
  },
  LOCK_TWO_UNRELATED_PROCESSES: { barriers: ["READY", "ACQUIRED"], contenderCount: "2" },
  LOCK_HOLDER_DEATH: { barriers: ["READY", "ACQUIRED"] },
  LOCK_DEFAULT_NON_INHERITANCE: { barriers: ["ACQUIRED"] },
  REPLACE_BEFORE_CREATE: {
    barriers: ["READY"],
    crashPoint: "READY",
    expectedReadbackHex: "41",
    payloadHex: "42",
  },
  REPLACE_AFTER_CREATE: {
    barriers: ["READY", "AFTER_CREATE"],
    crashPoint: "AFTER_CREATE",
    expectedReadbackHex: "41",
    payloadHex: "42",
  },
  REPLACE_AFTER_FILE_SYNC: {
    barriers: ["READY", "AFTER_CREATE", "AFTER_FILE_SYNC"],
    crashPoint: "AFTER_FILE_SYNC",
    expectedReadbackHex: "41",
    payloadHex: "42",
  },
  REPLACE_AFTER_RENAME: {
    barriers: ["READY", "AFTER_CREATE", "AFTER_FILE_SYNC", "AFTER_RENAME"],
    crashPoint: "AFTER_RENAME",
    expectedReadbackHex: "42",
    payloadHex: "42",
  },
  REPLACE_AFTER_DIRECTORY_SYNC: {
    barriers: ["READY", "AFTER_CREATE", "AFTER_FILE_SYNC", "AFTER_RENAME", "AFTER_DIRECTORY_SYNC"],
    crashPoint: "AFTER_DIRECTORY_SYNC",
    expectedReadbackHex: "42",
    payloadHex: "42",
  },
  CAS_PREDECESSOR_MISMATCH: {
    barriers: ["ACQUIRED"],
    expectedReadbackHex: "41",
    payloadHex: "42",
    predecessorHex: "42",
  },
  CAS_TWO_CONTENDERS: {
    barriers: ["READY", "ACQUIRED"],
    contenderCount: "2",
    expectedReadbackHex: "42",
    payloadHex: "42",
    predecessorHex: "41",
  },
  ABSENCE_HEAD_PLUS_ONE_TWO: { barriers: ["ACQUIRED"] },
  PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP: {
    barriers: ["READY"],
    timeoutMilliseconds: "10000",
  },
  HANDLE_CLONE_TRANSFER_REUSE: { barriers: ["READY"] },
  PARSER_EQUIVALENCE: { barriers: ["READY"] },
} as const satisfies Readonly<Record<PortablePrimitiveCaseId, VectorInputSeed>>);

function isPhysical(caseId: PortablePrimitiveCaseId): boolean {
  return caseId.startsWith("PHYSICAL_");
}

function createInputs(caseId: PortablePrimitiveCaseId): ContractRecord {
  const seed = seeds[caseId];
  return Object.freeze({
    barriers: Object.freeze([...(seed.barriers ?? [])]),
    caseId,
    contenderCount: "contenderCount" in seed ? seed.contenderCount! : null,
    corpusDigest: isPhysical(caseId) ? portablePhysicalLeafCorpusDigest : null,
    crashPoint: "crashPoint" in seed ? seed.crashPoint! : null,
    expectedReadbackHex: "expectedReadbackHex" in seed ? seed.expectedReadbackHex! : null,
    operationToken: profileByCaseId[caseId],
    payloadHex: "payloadHex" in seed ? seed.payloadHex! : null,
    predecessorHex: "predecessorHex" in seed ? seed.predecessorHex! : null,
    schemaVersion: "portable-primitives-vector-inputs/v1",
    timeoutMilliseconds: "timeoutMilliseconds" in seed ? seed.timeoutMilliseconds! : null,
  });
}

export const portablePrimitiveVectorInputs = Object.freeze(
  Object.fromEntries(portablePrimitiveCaseIds.map((caseId) => [caseId, createInputs(caseId)])),
) as Readonly<Record<PortablePrimitiveCaseId, ContractRecord>>;

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function isCaseId(value: JsonValue | undefined): value is PortablePrimitiveCaseId {
  return (
    typeof value === "string" && (portablePrimitiveCaseIds as readonly string[]).includes(value)
  );
}

export function parsePortablePrimitiveVectorInputs(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, inputFields);
  if (!parsed.ok) return parsed;
  if (!isCaseId(parsed.value.caseId)) return failure("caseId:invalid");
  const expected = portablePrimitiveVectorInputs[parsed.value.caseId];
  return canonicalJson(parsed.value) === canonicalJson(expected)
    ? parsed
    : failure("vectorInputs:literal-row-mismatch");
}

export function computePortablePrimitiveInputsDigest(input: unknown): string {
  const parsed = parsePortablePrimitiveVectorInputs(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("portable-primitives-vector-inputs/v1", [
    frame.text(String(parsed.value.caseId)),
    frame.canonical(parsed.value),
  ]);
}

function createVector(caseId: PortablePrimitiveCaseId): ContractRecord {
  return Object.freeze({
    caseId,
    expectedResult: "PASS",
    inputsDigest: computePortablePrimitiveInputsDigest(portablePrimitiveVectorInputs[caseId]),
    profileToken: profileByCaseId[caseId],
    schemaVersion: "portable-primitives-vector/v1",
  });
}

export const portablePrimitiveVectors = Object.freeze(
  portablePrimitiveCaseIds.map((caseId) => createVector(caseId)),
);

export function parsePortablePrimitiveVector(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, vectorFields);
  if (!parsed.ok) return parsed;
  if (!isCaseId(parsed.value.caseId)) return failure("caseId:invalid");
  const expected = portablePrimitiveVectors[portablePrimitiveCaseIds.indexOf(parsed.value.caseId)]!;
  return canonicalJson(parsed.value) === canonicalJson(expected)
    ? parsed
    : failure("vector:literal-row-mismatch");
}

export function computePortablePrimitiveVectorDigest(input: unknown): string {
  const parsed = parsePortablePrimitiveVector(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("portable-primitives-vector/v1", [
    frame.text(String(parsed.value.caseId)),
    frame.text(String(parsed.value.profileToken)),
    frame.raw32(String(parsed.value.inputsDigest)),
    frame.text(String(parsed.value.expectedResult)),
    frame.canonical(parsed.value),
  ]);
}

export function parsePortablePrimitiveObservation(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, observationFields);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (!isCaseId(parsed.value.caseId)) issues.push("caseId:invalid");
  if (!isSha256(parsed.value.detailsDigest)) issues.push("detailsDigest:invalid");
  if (!isSha256(parsed.value.environmentDigest)) issues.push("environmentDigest:invalid");
  if (!["PASS", "UNKNOWN", "UNSUPPORTED"].includes(String(parsed.value.normalizedResult)))
    issues.push("normalizedResult:invalid");
  if (!isCanonicalTimestamp(parsed.value.observedAt)) issues.push("observedAt:invalid");
  if (!["LINUX", "MACOS", "WINDOWS"].includes(String(parsed.value.operatingSystem)))
    issues.push("operatingSystem:invalid");
  if (parsed.value.schemaVersion !== "portable-primitives-observation/v1")
    issues.push("schemaVersion:mismatch");
  if (!isSha256(parsed.value.vectorDigest)) issues.push("vectorDigest:invalid");
  if (isCaseId(parsed.value.caseId)) {
    const vector = portablePrimitiveVectors[portablePrimitiveCaseIds.indexOf(parsed.value.caseId)]!;
    if (parsed.value.vectorDigest !== computePortablePrimitiveVectorDigest(vector))
      issues.push("vectorDigest:mismatch");
  }
  return issues.length === 0 ? parsed : failure(...issues);
}

export function computePortablePrimitiveObservationDigest(input: unknown): string {
  const parsed = parsePortablePrimitiveObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("portable-primitives-observation/v1", [
    frame.text(String(parsed.value.caseId)),
    frame.text(String(parsed.value.operatingSystem)),
    frame.raw32(String(parsed.value.environmentDigest)),
    frame.raw32(String(parsed.value.vectorDigest)),
    frame.text(String(parsed.value.normalizedResult)),
    frame.raw32(String(parsed.value.detailsDigest)),
    frame.text(String(parsed.value.observedAt)),
    frame.canonical(parsed.value),
  ]);
}

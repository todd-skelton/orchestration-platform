import { types as nodeTypes } from "node:util";
import { canonicalJson, type ContractRecord } from "@orchestration-platform/contracts";
import {
  bindPortablePrimitiveRawChildEvent,
  derivePortablePhysicalIdentity,
  executePortablePrimitiveCreateOnceProbe,
  executePortablePrimitiveHandleConfinementProbe,
  executePortablePrimitiveLockProbe,
  executePortablePrimitiveParserEquivalenceProbe,
  executePortablePrimitiveProcessProbe,
  executePortablePrimitiveReplaceProbe,
  executePortablePhysicalProbe,
  parsePortablePrimitiveLockDescriptorChildEvent,
  portablePrimitiveReplaceCases,
  type PortableLeafRawObservation,
  type PortablePhysicalAliasRawFacts,
  type PortablePhysicalBaseRawFacts,
  type PortablePhysicalCaseId,
  type PortablePhysicalLocatorRawObservation,
  type PortablePhysicalSwapRawFacts,
  type PortablePrimitiveChildExecution,
  type PortablePrimitiveCreateOnceRawFacts,
  type PortablePrimitiveHandleRawFacts,
  type PortablePrimitiveLockContentionRawFacts,
  type PortablePrimitiveLockHolderDeathRawFacts,
  type PortablePrimitiveLockNonInheritanceRawFacts,
  type PortablePrimitiveLockRawFacts,
  type PortablePrimitiveParserChildObservation,
  type PortablePrimitiveParserEquivalenceRawFacts,
  type PortablePrimitiveProcessRawFacts,
  type PortablePrimitiveReplaceRawFacts,
  type PortablePrimitiveResult,
  type PortableRootRawObservation,
} from "@orchestration-platform/portable-primitives";

export interface Iss022PhysicalVectorExecution {
  readonly caseId: PortablePhysicalCaseId;
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts:
    PortablePhysicalAliasRawFacts | PortablePhysicalBaseRawFacts | PortablePhysicalSwapRawFacts;
}

export type Iss022PhysicalHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly Iss022PhysicalVectorExecution[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export type Iss022RuntimeCaseId =
  "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP" | "HANDLE_CLONE_TRANSFER_REUSE";

export interface Iss022RuntimeVectorExecution {
  readonly caseId: Iss022RuntimeCaseId;
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts: PortablePrimitiveHandleRawFacts | PortablePrimitiveProcessRawFacts;
}

export type Iss022RuntimeHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly Iss022RuntimeVectorExecution[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface Iss022ParserVectorExecution {
  readonly caseId: "PARSER_EQUIVALENCE";
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts: PortablePrimitiveParserEquivalenceRawFacts;
}

export type Iss022ParserHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly [Iss022ParserVectorExecution] }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface Iss022CreateOnceVectorExecution {
  readonly caseId: "CREATE_ONCE_32_CONTENDERS";
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts: PortablePrimitiveCreateOnceRawFacts;
}

export type Iss022CreateOnceHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly [Iss022CreateOnceVectorExecution] }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface Iss022LockVectorExecution {
  readonly caseId: PortablePrimitiveLockRawFacts["caseId"];
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts: PortablePrimitiveLockRawFacts;
}

export type Iss022LockHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly Iss022LockVectorExecution[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface Iss022ReplaceVectorExecution {
  readonly caseId: PortablePrimitiveReplaceRawFacts["caseId"];
  readonly normalizedResult: PortablePrimitiveResult;
  readonly rawFacts: PortablePrimitiveReplaceRawFacts;
}

export type Iss022ReplaceHandlerResult =
  | { readonly ok: true; readonly vectorExecutions: readonly Iss022ReplaceVectorExecution[] }
  | { readonly ok: false; readonly issues: readonly string[] };

const caseIds = Object.freeze([
  "PHYSICAL_EXISTING",
  "PHYSICAL_ABSENT_LEAF",
  "PHYSICAL_CASE_ALIAS",
  "PHYSICAL_UNICODE_ALIAS",
  "PHYSICAL_SYMLINK_SWAP",
  "PHYSICAL_PARENT_SWAP",
] as const);

const unsupportedOperationCodes = new Set([
  "EACCES",
  "EINVAL",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
]);
const u64 = /^[0-9a-f]{16}$/;
const u32 = /^[0-9a-f]{8}$/;
const digest = /^[0-9a-f]{64}$/;
const operationErrorCode = /^[A-Z0-9_]{1,32}$/;
const operatingSystems = new Set(["DARWIN", "LINUX", "WINDOWS"]);
const invalidSnapshot = Symbol("invalid-snapshot");
const processFields = Object.freeze([
  "closeCode",
  "closeObserved",
  "closeSignal",
  "directChildHandleOwned",
  "eventOrder",
  "exitCode",
  "exitObserved",
  "exitSignal",
  "forcedKillAccepted",
  "grandchildClaimAcceptedAsAuthority",
  "grandchildClaimPresent",
  "ipcNonceMatched",
  "killAccepted",
  "killRequestedSignal",
  "messageCount",
  "outputLimitExceeded",
  "responseAccepted",
  "timedOut",
] as const);
const handleFields = Object.freeze([
  "callbackInvocations",
  "crossProcessReplayRejected",
  "directInvocationAccepted",
  "nonceByteLength",
  "reuseAfterReleaseRejected",
  "serializationRejected",
  "structuredCloneRejected",
  "workerTransferRejected",
  "wrappedFunctionRejected",
] as const);
const parserFields = Object.freeze([
  "caseId",
  "childCount",
  "children",
  "parentNormalizedDigest",
  "resultsMatch",
  "schemaVersion",
] as const);
const parserChildFields = Object.freeze([
  "closeCode",
  "closeEventCount",
  "closeSignal",
  "errorEventCount",
  "exitCode",
  "exitEventCount",
  "exitSignal",
  "killRefused",
  "messageCount",
  "normalizedBytesMatch",
  "normalizedDigest",
  "outputAccepted",
  "postSignalDeadlineExpired",
  "stderrOverflow",
  "terminalEventsMatch",
  "timedOut",
] as const);
const createOnceFields = Object.freeze([
  "caseId",
  "contenderCount",
  "contenders",
  "finalReadbackErrorCode",
  "finalReadbackHex",
  "schemaVersion",
] as const);
const createOnceChildFields = Object.freeze([
  "event",
  "exitCode",
  "outputLimitExceeded",
  "signal",
  "stderr",
  "stdout",
  "timedOut",
] as const);
const lockChildFields = createOnceChildFields;
const lockContentionFields = Object.freeze(
  "caseId contender holderCloseObserved holderEvent schemaVersion".split(" "),
);
const lockHolderDeathFields = Object.freeze(
  "acquisitionAttemptCount caseId holderCloseObserved holderEvent postDeathAttempt prohibitedActions schemaVersion".split(
    " ",
  ),
);
const lockNonInheritanceFields = Object.freeze(
  "caseId child parentReadbackHex probeNonceHex schemaVersion".split(" "),
);
const replaceFields = Object.freeze(
  "caseId child finalReadbackErrorCode finalReadbackHex initialReadbackHex requestedBarrier schemaVersion".split(
    " ",
  ),
);
const prohibitedLockActions = new Set([
  "DELETE",
  "RETRY",
  "PID",
  "AGE",
  "LEASE",
  "STALE_OWNER_INFERENCE",
]);
const rootFields = Object.freeze([
  "filesystemTypeBytes",
  "handleDeviceBytes",
  "handleInodeBytes",
  "handleModeBytes",
  "namespaceFileHex",
  "pathDeviceBytes",
  "pathInodeBytes",
  "pathModeBytes",
]);
const existingLeafFields = Object.freeze([
  "disposition",
  "lstatDeviceBytes",
  "lstatInodeBytes",
  "lstatModeBytes",
  "statDeviceBytes",
  "statInodeBytes",
  "statModeBytes",
]);
const locatorFields = Object.freeze([
  "lstatDeviceBytes",
  "lstatInodeBytes",
  "lstatKind",
  "lstatModeBytes",
  "statDeviceBytes",
  "statInodeBytes",
  "statKind",
  "statModeBytes",
]);
const baseFields = Object.freeze([
  "caseId",
  "derivation",
  "leafAfter",
  "leafBefore",
  "leafStable",
  "operatingSystem",
  "rootAfter",
  "rootBefore",
  "rootRealpathStable",
  "rootStable",
]);
const aliasFields = Object.freeze([
  "caseId",
  "leftAfter",
  "leftBefore",
  "leftStable",
  "operatingSystem",
  "relationAfter",
  "relationBefore",
  "relationStable",
  "rightAfter",
  "rightBefore",
  "rightStable",
  "rootAfter",
  "rootBefore",
  "rootRealpathStable",
  "rootStable",
]);
const swapFields = Object.freeze([
  "caseId",
  "locatorAfter",
  "locatorBefore",
  "locatorStable",
  "namespaceStable",
  "operatingSystem",
  "operationApplied",
  "operationErrorCode",
  "rootAfter",
  "rootBefore",
  "rootRealpathStable",
  "rootStable",
]);

function refusal(...issues: readonly string[]): Iss022PhysicalHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function snapshotData(input: unknown, depth = 0): unknown | typeof invalidSnapshot {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean" ||
    (typeof input === "number" && Number.isSafeInteger(input))
  )
    return input;
  if (depth >= 8 || typeof input !== "object" || nodeTypes.isProxy(input)) return invalidSnapshot;
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 64)
      return invalidSnapshot;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const expectedKeys = [...input.keys()].map(String).concat("length").sort();
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
      (Reflect.ownKeys(descriptors) as string[]).sort().join("\0") !== expectedKeys.join("\0")
    )
      return invalidSnapshot;
    const snapshot: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return invalidSnapshot;
      const value = snapshotData(descriptor.value, depth + 1);
      if (value === invalidSnapshot) return invalidSnapshot;
      snapshot.push(value);
    }
    return Object.freeze(snapshot);
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalidSnapshot;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length > 64 ||
    keys.some((key) => typeof key !== "string") ||
    keys.some((key) => {
      const descriptor = descriptors[key as string];
      return !descriptor || !("value" in descriptor) || descriptor.enumerable !== true;
    })
  )
    return invalidSnapshot;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const value = snapshotData(
      (descriptors[key] as PropertyDescriptor & { value: unknown }).value,
      depth + 1,
    );
    if (value === invalidSnapshot) return invalidSnapshot;
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

function isBoolean(input: unknown): input is boolean {
  return typeof input === "boolean";
}

function isTerminalCode(input: unknown): input is number | null {
  return input === null || (typeof input === "number" && Number.isSafeInteger(input));
}

function isObservedSignal(input: unknown): input is "SIGKILL" | "SIGTERM" | null {
  return input === null || input === "SIGKILL" || input === "SIGTERM";
}

function validProcessRow(row: PortablePrimitiveProcessRawFacts): boolean {
  return (
    exactKeys(row, processFields) &&
    isTerminalCode(row.closeCode) &&
    isBoolean(row.closeObserved) &&
    isObservedSignal(row.closeSignal) &&
    isBoolean(row.directChildHandleOwned) &&
    Array.isArray(row.eventOrder) &&
    row.eventOrder.length <= 2 &&
    row.eventOrder.every((event) => event === "close" || event === "exit") &&
    isTerminalCode(row.exitCode) &&
    isBoolean(row.exitObserved) &&
    isObservedSignal(row.exitSignal) &&
    (row.forcedKillAccepted === null || isBoolean(row.forcedKillAccepted)) &&
    isBoolean(row.grandchildClaimAcceptedAsAuthority) &&
    isBoolean(row.grandchildClaimPresent) &&
    isBoolean(row.ipcNonceMatched) &&
    isBoolean(row.killAccepted) &&
    row.killRequestedSignal === "SIGTERM" &&
    Number.isSafeInteger(row.messageCount) &&
    row.messageCount >= 0 &&
    isBoolean(row.outputLimitExceeded) &&
    isBoolean(row.responseAccepted) &&
    isBoolean(row.timedOut)
  );
}

function validHandleRow(row: PortablePrimitiveHandleRawFacts): boolean {
  return (
    exactKeys(row, handleFields) &&
    Number.isSafeInteger(row.callbackInvocations) &&
    row.callbackInvocations >= 0 &&
    isBoolean(row.crossProcessReplayRejected) &&
    isBoolean(row.directInvocationAccepted) &&
    Number.isSafeInteger(row.nonceByteLength) &&
    row.nonceByteLength >= 0 &&
    isBoolean(row.reuseAfterReleaseRejected) &&
    isBoolean(row.serializationRejected) &&
    isBoolean(row.structuredCloneRejected) &&
    isBoolean(row.workerTransferRejected) &&
    isBoolean(row.wrappedFunctionRejected)
  );
}

function processResult(row: PortablePrimitiveProcessRawFacts): PortablePrimitiveResult {
  const responseAccepted =
    row.messageCount === 1 &&
    row.ipcNonceMatched &&
    row.grandchildClaimPresent &&
    row.killAccepted &&
    !row.outputLimitExceeded &&
    !row.timedOut;
  const terminalEventsCoherent =
    row.exitObserved === row.eventOrder.includes("exit") &&
    row.closeObserved === row.eventOrder.includes("close");
  return row.responseAccepted === responseAccepted &&
    responseAccepted &&
    terminalEventsCoherent &&
    row.directChildHandleOwned &&
    row.eventOrder.length === 2 &&
    row.eventOrder[0] === "exit" &&
    row.eventOrder[1] === "close" &&
    row.exitCode === null &&
    row.exitSignal === "SIGTERM" &&
    row.closeCode === null &&
    row.closeSignal === "SIGTERM" &&
    row.forcedKillAccepted === null &&
    !row.grandchildClaimAcceptedAsAuthority
    ? "UNSUPPORTED"
    : "UNKNOWN";
}

function handleResult(row: PortablePrimitiveHandleRawFacts): PortablePrimitiveResult {
  return row.callbackInvocations === 1 &&
    row.crossProcessReplayRejected &&
    row.directInvocationAccepted &&
    row.nonceByteLength === 32 &&
    row.reuseAfterReleaseRejected &&
    row.serializationRejected &&
    row.structuredCloneRejected &&
    row.workerTransferRejected &&
    row.wrappedFunctionRejected
    ? "PASS"
    : "UNKNOWN";
}

function exactKeys(input: unknown, fields: readonly string[]): boolean {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return false;
  return fields.every((field) => {
    const descriptor = descriptors[field];
    return Boolean(descriptor && "value" in descriptor && descriptor.enumerable === true);
  });
}

function validRoot(root: PortableRootRawObservation): boolean {
  return (
    exactKeys(root, rootFields) &&
    u64.test(root.filesystemTypeBytes) &&
    u64.test(root.handleDeviceBytes) &&
    u64.test(root.handleInodeBytes) &&
    u32.test(root.handleModeBytes) &&
    digest.test(root.namespaceFileHex) &&
    u64.test(root.pathDeviceBytes) &&
    u64.test(root.pathInodeBytes) &&
    u32.test(root.pathModeBytes)
  );
}

function coherentRoot(root: PortableRootRawObservation): boolean {
  return (
    validRoot(root) &&
    root.handleDeviceBytes === root.pathDeviceBytes &&
    root.handleInodeBytes === root.pathInodeBytes &&
    root.handleModeBytes === root.pathModeBytes
  );
}

function validLeaf(leaf: PortableLeafRawObservation): boolean {
  if (leaf.disposition === "ABSENT")
    return exactKeys(leaf, ["disposition", "errorCode"]) && leaf.errorCode === "ENOENT";
  return (
    exactKeys(leaf, existingLeafFields) &&
    u64.test(leaf.lstatDeviceBytes) &&
    u64.test(leaf.lstatInodeBytes) &&
    u32.test(leaf.lstatModeBytes) &&
    u64.test(leaf.statDeviceBytes) &&
    u64.test(leaf.statInodeBytes) &&
    u32.test(leaf.statModeBytes) &&
    leaf.lstatDeviceBytes === leaf.statDeviceBytes &&
    leaf.lstatInodeBytes === leaf.statInodeBytes &&
    leaf.lstatModeBytes === leaf.statModeBytes
  );
}

function validLocator(locator: PortablePhysicalLocatorRawObservation): boolean {
  return (
    exactKeys(locator, locatorFields) &&
    u64.test(locator.lstatDeviceBytes) &&
    u64.test(locator.lstatInodeBytes) &&
    u32.test(locator.lstatModeBytes) &&
    u64.test(locator.statDeviceBytes) &&
    u64.test(locator.statInodeBytes) &&
    u32.test(locator.statModeBytes) &&
    ["DIRECTORY", "REGULAR_FILE", "SYMLINK"].includes(locator.lstatKind) &&
    ["DIRECTORY", "REGULAR_FILE"].includes(locator.statKind)
  );
}

function validBaseRow(row: PortablePhysicalBaseRawFacts): boolean {
  return (
    exactKeys(row, baseFields) &&
    operatingSystems.has(row.operatingSystem) &&
    typeof row.leafStable === "boolean" &&
    typeof row.rootRealpathStable === "boolean" &&
    typeof row.rootStable === "boolean" &&
    validLeaf(row.leafBefore) &&
    validLeaf(row.leafAfter) &&
    validRoot(row.rootBefore) &&
    validRoot(row.rootAfter) &&
    (row.derivation === null ||
      (exactKeys(row.derivation, [
        "ancestorObjectIdentityDigest",
        "destinationDigest",
        "filesystemIdentityDigest",
        "filesystemTypeBytes",
        "hostCustodyNamespaceDigest",
        "logicalLocatorDigest",
        "nativeIdentityReadbackDigest",
        "physicalDestinationIdentity",
        "physicalDestinationIdentityDigest",
        "physicalVolumeIdentityDigest",
        "resolvedLocatorReadbackDigest",
        "rootReadbackDigest",
        "statDeviceBytes",
      ]) &&
        exactKeys(row.derivation.physicalDestinationIdentity, [
          "ancestorObjectIdentityDigest",
          "canonicalPhysicalLeafBytes",
          "filesystemIdentityDigest",
          "hostCustodyNamespaceDigest",
          "leafIdentityKind",
          "operatingSystem",
          "physicalVolumeIdentityDigest",
          "schemaVersion",
        ])))
  );
}

function validAliasRow(row: PortablePhysicalAliasRawFacts): boolean {
  return (
    exactKeys(row, aliasFields) &&
    operatingSystems.has(row.operatingSystem) &&
    typeof row.leftStable === "boolean" &&
    typeof row.relationStable === "boolean" &&
    typeof row.rightStable === "boolean" &&
    typeof row.rootRealpathStable === "boolean" &&
    typeof row.rootStable === "boolean" &&
    ["DISTINCT_ABSENT", "DISTINCT_EXISTING", "IDENTICAL"].includes(row.relationBefore) &&
    ["DISTINCT_ABSENT", "DISTINCT_EXISTING", "IDENTICAL"].includes(row.relationAfter) &&
    validLeaf(row.leftBefore) &&
    validLeaf(row.leftAfter) &&
    validLeaf(row.rightBefore) &&
    validLeaf(row.rightAfter) &&
    validRoot(row.rootBefore) &&
    validRoot(row.rootAfter)
  );
}

function validSwapRow(row: PortablePhysicalSwapRawFacts): boolean {
  return (
    exactKeys(row, swapFields) &&
    operatingSystems.has(row.operatingSystem) &&
    typeof row.locatorStable === "boolean" &&
    typeof row.namespaceStable === "boolean" &&
    typeof row.operationApplied === "boolean" &&
    typeof row.rootRealpathStable === "boolean" &&
    typeof row.rootStable === "boolean" &&
    (row.operationErrorCode === null ||
      (typeof row.operationErrorCode === "string" &&
        operationErrorCode.test(row.operationErrorCode))) &&
    validLocator(row.locatorBefore) &&
    validLocator(row.locatorAfter) &&
    validRoot(row.rootBefore) &&
    validRoot(row.rootAfter)
  );
}

function sameRecord(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => leftRecord[key] === rightRecord[key])
  );
}

function sameRoot(left: PortableRootRawObservation, right: PortableRootRawObservation): boolean {
  return coherentRoot(left) && coherentRoot(right) && sameRecord(left, right);
}

function sameLeaf(left: PortableLeafRawObservation, right: PortableLeafRawObservation): boolean {
  return validLeaf(left) && validLeaf(right) && sameRecord(left, right);
}

function sameLocator(
  left: PortablePhysicalLocatorRawObservation,
  right: PortablePhysicalLocatorRawObservation,
): boolean {
  return validLocator(left) && validLocator(right) && sameRecord(left, right);
}

function sameRootHandle(
  left: PortableRootRawObservation,
  right: PortableRootRawObservation,
): boolean {
  return (
    left.handleDeviceBytes === right.handleDeviceBytes &&
    left.handleInodeBytes === right.handleInodeBytes &&
    left.handleModeBytes === right.handleModeBytes
  );
}

function baseResult(row: PortablePhysicalBaseRawFacts): PortablePrimitiveResult {
  const expectedDisposition = row.caseId === "PHYSICAL_EXISTING" ? "EXISTING" : "ABSENT";
  let expectedDerivation;
  try {
    expectedDerivation = derivePortablePhysicalIdentity({
      canonicalPhysicalLeafBytes: Buffer.from(
        row.caseId === "PHYSICAL_EXISTING" ? "existing-leaf" : "absent-leaf",
        "utf8",
      ).toString("base64url"),
      filesystemType: BigInt(`0x${row.rootBefore.filesystemTypeBytes}`),
      leafIdentityKind:
        row.caseId === "PHYSICAL_EXISTING" ? "EXISTING_DIRECTORY_ENTRY" : "ABSENT_DIRECTORY_ENTRY",
      namespaceFileHex: row.rootBefore.namespaceFileHex,
      operatingSystem: row.operatingSystem,
      rootStatDevice: BigInt(`0x${row.rootBefore.handleDeviceBytes}`),
      rootStatInode: BigInt(`0x${row.rootBefore.handleInodeBytes}`),
      rootStatMode: BigInt(`0x${row.rootBefore.handleModeBytes}`),
    });
  } catch {
    return "UNKNOWN";
  }
  return row.derivation !== null &&
    canonicalJson(row.derivation) === canonicalJson(expectedDerivation) &&
    row.leafBefore.disposition === expectedDisposition &&
    row.leafAfter.disposition === expectedDisposition &&
    row.leafStable &&
    sameLeaf(row.leafBefore, row.leafAfter) &&
    row.rootRealpathStable &&
    row.rootStable &&
    sameRoot(row.rootBefore, row.rootAfter)
    ? "PASS"
    : "UNKNOWN";
}

function aliasRelation(
  row: PortablePhysicalAliasRawFacts,
): "DISTINCT_ABSENT" | "DISTINCT_EXISTING" | "IDENTICAL" | undefined {
  if (row.leftBefore.disposition !== "EXISTING") return undefined;
  if (row.rightBefore.disposition === "ABSENT") return "DISTINCT_ABSENT";
  if (
    row.leftBefore.statDeviceBytes === row.rightBefore.statDeviceBytes &&
    row.leftBefore.statInodeBytes === row.rightBefore.statInodeBytes
  )
    return "IDENTICAL";
  return "DISTINCT_EXISTING";
}

function expectedAliasRelation(
  row: PortablePhysicalAliasRawFacts,
): "DISTINCT_ABSENT" | "IDENTICAL" {
  if (row.caseId === "PHYSICAL_CASE_ALIAS")
    return row.operatingSystem === "LINUX" ? "DISTINCT_ABSENT" : "IDENTICAL";
  return row.operatingSystem === "DARWIN" ? "IDENTICAL" : "DISTINCT_ABSENT";
}

function aliasResult(row: PortablePhysicalAliasRawFacts): PortablePrimitiveResult {
  const observed = aliasRelation(row);
  if (
    observed === undefined ||
    observed !== row.relationBefore ||
    row.relationBefore !== row.relationAfter ||
    !row.relationStable ||
    !row.leftStable ||
    !sameLeaf(row.leftBefore, row.leftAfter) ||
    !row.rightStable ||
    !sameLeaf(row.rightBefore, row.rightAfter) ||
    !row.rootRealpathStable ||
    !row.rootStable ||
    !sameRoot(row.rootBefore, row.rootAfter)
  )
    return "UNKNOWN";
  return observed === expectedAliasRelation(row) ? "PASS" : "UNSUPPORTED";
}

function unsupportedSwap(row: PortablePhysicalSwapRawFacts): PortablePrimitiveResult | undefined {
  if (row.operationApplied) return undefined;
  if (
    !row.namespaceStable ||
    !row.rootRealpathStable ||
    !row.rootStable ||
    !sameRoot(row.rootBefore, row.rootAfter) ||
    !row.locatorStable ||
    !sameLocator(row.locatorBefore, row.locatorAfter)
  )
    return "UNKNOWN";
  return row.operationErrorCode !== null && unsupportedOperationCodes.has(row.operationErrorCode)
    ? "UNSUPPORTED"
    : "UNKNOWN";
}

function symlinkSwapResult(row: PortablePhysicalSwapRawFacts): PortablePrimitiveResult {
  const unsupported = unsupportedSwap(row);
  if (unsupported) return unsupported;
  return row.operationErrorCode === null &&
    row.namespaceStable &&
    row.rootRealpathStable &&
    row.rootStable &&
    sameRoot(row.rootBefore, row.rootAfter) &&
    !row.locatorStable &&
    !sameLocator(row.locatorBefore, row.locatorAfter) &&
    row.locatorBefore.lstatKind === "DIRECTORY" &&
    row.locatorBefore.statKind === "DIRECTORY" &&
    row.locatorAfter.lstatKind === "SYMLINK" &&
    row.locatorAfter.statKind === "DIRECTORY"
    ? "PASS"
    : "UNKNOWN";
}

function parentSwapResult(row: PortablePhysicalSwapRawFacts): PortablePrimitiveResult {
  const unsupported = unsupportedSwap(row);
  if (unsupported) return unsupported;
  return row.operationErrorCode === null &&
    row.namespaceStable &&
    row.rootRealpathStable &&
    !row.rootStable &&
    validRoot(row.rootBefore) &&
    validRoot(row.rootAfter) &&
    coherentRoot(row.rootBefore) &&
    !coherentRoot(row.rootAfter) &&
    sameRootHandle(row.rootBefore, row.rootAfter) &&
    !sameRoot(row.rootBefore, row.rootAfter) &&
    !row.locatorStable &&
    !sameLocator(row.locatorBefore, row.locatorAfter) &&
    row.locatorBefore.lstatKind === "REGULAR_FILE" &&
    row.locatorBefore.statKind === "REGULAR_FILE" &&
    row.locatorAfter.lstatKind === "REGULAR_FILE" &&
    row.locatorAfter.statKind === "REGULAR_FILE"
    ? "PASS"
    : "UNKNOWN";
}

export function normalizeIss022PhysicalProbe(input: unknown): Iss022PhysicalHandlerResult {
  try {
    if (
      !Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length !== caseIds.length
    )
      return refusal("physical:census-refused");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.some((key) => typeof key !== "string") ||
      (descriptorKeys as string[]).sort().join("\0") !==
        [...caseIds.keys()].map(String).concat("length").sort().join("\0")
    )
      return refusal("physical:census-refused");
    const rows: (
      PortablePhysicalAliasRawFacts | PortablePhysicalBaseRawFacts | PortablePhysicalSwapRawFacts
    )[] = [];
    for (let index = 0; index < caseIds.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return refusal(`physical.${index}:descriptor-refused`);
      const snapshot = snapshotData(descriptor.value);
      if (snapshot === invalidSnapshot) return refusal(`physical.${index}:snapshot-refused`);
      const row = snapshot as
        PortablePhysicalAliasRawFacts | PortablePhysicalBaseRawFacts | PortablePhysicalSwapRawFacts;
      if (row.caseId !== caseIds[index]) return refusal(`physical.${index}:caseId-refused`);
      const valid =
        index < 2
          ? validBaseRow(row as PortablePhysicalBaseRawFacts)
          : index < 4
            ? validAliasRow(row as PortablePhysicalAliasRawFacts)
            : validSwapRow(row as PortablePhysicalSwapRawFacts);
      if (!valid) return refusal(`physical.${index}:record-refused`);
      rows.push(row);
    }
    const values: Iss022PhysicalVectorExecution[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      let result: PortablePrimitiveResult;
      if (index < 2) result = baseResult(row as PortablePhysicalBaseRawFacts);
      else if (index < 4) result = aliasResult(row as PortablePhysicalAliasRawFacts);
      else if (index === 4) result = symlinkSwapResult(row as PortablePhysicalSwapRawFacts);
      else result = parentSwapResult(row as PortablePhysicalSwapRawFacts);
      values.push(
        Object.freeze({ caseId: caseIds[index]!, normalizedResult: result, rawFacts: row }),
      );
    }
    return { ok: true, vectorExecutions: Object.freeze(values) };
  } catch {
    return refusal("physical:unreadable");
  }
}

export async function runIss022PhysicalStableHandler(
  custodyRoot: string,
): Promise<Iss022PhysicalHandlerResult> {
  try {
    return normalizeIss022PhysicalProbe(await executePortablePhysicalProbe(custodyRoot));
  } catch {
    return refusal("physical:execution-refused");
  }
}

function runtimeRefusal(...issues: readonly string[]): Iss022RuntimeHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function normalizeIss022RuntimeProbe(input: unknown): Iss022RuntimeHandlerResult {
  try {
    if (
      !Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length !== 2
    )
      return runtimeRefusal("runtime:census-refused");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
      (Reflect.ownKeys(descriptors) as string[]).sort().join("\0") !==
        ["0", "1", "length"].sort().join("\0")
    )
      return runtimeRefusal("runtime:census-refused");
    const snapshots: unknown[] = [];
    for (let index = 0; index < 2; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        return runtimeRefusal(`runtime.${index}:descriptor-refused`);
      const snapshot = snapshotData(descriptor.value);
      if (snapshot === invalidSnapshot) return runtimeRefusal(`runtime.${index}:snapshot-refused`);
      snapshots.push(snapshot);
    }
    const process = snapshots[0] as PortablePrimitiveProcessRawFacts;
    const handle = snapshots[1] as PortablePrimitiveHandleRawFacts;
    if (!validProcessRow(process)) return runtimeRefusal("runtime.0:record-refused");
    if (!validHandleRow(handle)) return runtimeRefusal("runtime.1:record-refused");
    return {
      ok: true,
      vectorExecutions: Object.freeze([
        Object.freeze({
          caseId: "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP",
          normalizedResult: processResult(process),
          rawFacts: process,
        }),
        Object.freeze({
          caseId: "HANDLE_CLONE_TRANSFER_REUSE",
          normalizedResult: handleResult(handle),
          rawFacts: handle,
        }),
      ]),
    };
  } catch {
    return runtimeRefusal("runtime:unreadable");
  }
}

export async function runIss022RuntimeStableHandler(
  custodyRoot: string,
): Promise<Iss022RuntimeHandlerResult> {
  try {
    const process = await executePortablePrimitiveProcessProbe(custodyRoot);
    const handle = await executePortablePrimitiveHandleConfinementProbe(custodyRoot);
    return normalizeIss022RuntimeProbe([process, handle]);
  } catch {
    return runtimeRefusal("runtime:execution-refused");
  }
}

function parserRefusal(...issues: readonly string[]): Iss022ParserHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function isParserEventCount(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0 && Number(input) <= 1;
}

function isParserMessageCount(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0;
}

function isParserTerminalCode(input: unknown): input is number | null {
  return input === null || (Number.isSafeInteger(input) && Number(input) >= 0);
}

function isParserSignal(input: unknown): input is "SIGKILL" | null {
  return input === null || input === "SIGKILL";
}

function validParserChildRow(row: PortablePrimitiveParserChildObservation): boolean {
  return (
    exactKeys(row, parserChildFields) &&
    isParserTerminalCode(row.closeCode) &&
    isParserEventCount(row.closeEventCount) &&
    isParserSignal(row.closeSignal) &&
    isParserEventCount(row.errorEventCount) &&
    isParserTerminalCode(row.exitCode) &&
    isParserEventCount(row.exitEventCount) &&
    isParserSignal(row.exitSignal) &&
    isBoolean(row.killRefused) &&
    isParserMessageCount(row.messageCount) &&
    isBoolean(row.normalizedBytesMatch) &&
    (row.normalizedDigest === null || digest.test(row.normalizedDigest)) &&
    isBoolean(row.outputAccepted) &&
    isBoolean(row.postSignalDeadlineExpired) &&
    isBoolean(row.stderrOverflow) &&
    isBoolean(row.terminalEventsMatch) &&
    isBoolean(row.timedOut)
  );
}

function coherentParserTerminalTuple(
  eventCount: number,
  code: number | null,
  signal: NodeJS.Signals | null,
): boolean {
  return eventCount === 0
    ? code === null && signal === null
    : (code === null) !== (signal === null);
}

function coherentParserChild(row: PortablePrimitiveParserChildObservation): boolean {
  if (
    !coherentParserTerminalTuple(row.exitEventCount, row.exitCode, row.exitSignal) ||
    !coherentParserTerminalTuple(row.closeEventCount, row.closeCode, row.closeSignal)
  )
    return false;
  const terminalEventsMatch =
    row.errorEventCount === 0 &&
    row.exitEventCount === 1 &&
    row.closeEventCount === 1 &&
    row.exitCode === row.closeCode &&
    row.exitSignal === row.closeSignal;
  if (row.terminalEventsMatch !== terminalEventsMatch) return false;
  const terminalPairComplete = row.exitEventCount === 1 && row.closeEventCount === 1;
  const nonTerminalTrigger = row.errorEventCount === 1 || row.stderrOverflow || row.timedOut;
  if (!terminalPairComplete && !(nonTerminalTrigger && row.postSignalDeadlineExpired)) return false;
  const outputAccepted =
    terminalEventsMatch &&
    row.exitCode === 0 &&
    row.exitSignal === null &&
    row.messageCount === 1 &&
    row.normalizedDigest !== null &&
    !row.timedOut &&
    !row.stderrOverflow &&
    !row.killRefused &&
    !row.postSignalDeadlineExpired;
  if (row.outputAccepted !== outputAccepted) return false;
  return row.outputAccepted || (!row.normalizedBytesMatch && row.normalizedDigest === null);
}

function parserResult(row: PortablePrimitiveParserEquivalenceRawFacts): PortablePrimitiveResult {
  const childrenAccepted = row.children.every((child) => child.outputAccepted);
  const exactEquality =
    childrenAccepted &&
    row.children.every(
      (child) =>
        child.normalizedBytesMatch && child.normalizedDigest === row.parentNormalizedDigest,
    );
  if (row.resultsMatch !== exactEquality) return "UNKNOWN";
  if (exactEquality) return "PASS";
  return childrenAccepted ? "UNSUPPORTED" : "UNKNOWN";
}

export function normalizeIss022ParserProbe(input: unknown): Iss022ParserHandlerResult {
  try {
    const snapshot = snapshotData(input);
    if (snapshot === invalidSnapshot) return parserRefusal("parser:snapshot-refused");
    const row = snapshot as PortablePrimitiveParserEquivalenceRawFacts;
    if (
      !exactKeys(row, parserFields) ||
      row.caseId !== "PARSER_EQUIVALENCE" ||
      row.childCount !== "3" ||
      row.schemaVersion !== "portable-primitives-parser-equivalence-raw/v1" ||
      !digest.test(row.parentNormalizedDigest) ||
      !isBoolean(row.resultsMatch) ||
      !Array.isArray(row.children) ||
      Object.getPrototypeOf(row.children) !== Array.prototype ||
      row.children.length !== 3
    )
      return parserRefusal("parser:record-refused");
    for (let index = 0; index < row.children.length; index += 1) {
      const child = row.children[index]!;
      if (!validParserChildRow(child))
        return parserRefusal(`parser.children.${index}:record-refused`);
      if (!coherentParserChild(child))
        return parserRefusal(`parser.children.${index}:terminal-refused`);
      if (child.normalizedBytesMatch && child.normalizedDigest !== row.parentNormalizedDigest)
        return parserRefusal(`parser.children.${index}:equality-refused`);
    }
    return {
      ok: true,
      vectorExecutions: Object.freeze([
        Object.freeze({
          caseId: "PARSER_EQUIVALENCE",
          normalizedResult: parserResult(row),
          rawFacts: row,
        }),
      ]),
    };
  } catch {
    return parserRefusal("parser:unreadable");
  }
}

export async function runIss022ParserStableHandler(
  stableRoot: string,
): Promise<Iss022ParserHandlerResult> {
  try {
    return normalizeIss022ParserProbe(
      await executePortablePrimitiveParserEquivalenceProbe(stableRoot),
    );
  } catch {
    return parserRefusal("parser:execution-refused");
  }
}

function createOnceRefusal(...issues: readonly string[]): Iss022CreateOnceHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function validFilesystemChild(
  row: PortablePrimitiveChildExecution,
  mode: "EXCLUSIVE_CREATE" | "LOCK_ATTEMPT" | "REPLACE",
  arguments_: readonly string[] = [],
): boolean {
  return (
    validChildEnvelope(row) &&
    (row.event === null || bindPortablePrimitiveRawChildEvent(row.event, mode, arguments_).ok)
  );
}

function validChildEnvelope(row: PortablePrimitiveChildExecution): boolean {
  return (
    exactKeys(row, createOnceChildFields) &&
    isParserTerminalCode(row.exitCode) &&
    (row.signal === null || row.signal === "SIGKILL") &&
    isBoolean(row.outputLimitExceeded) &&
    isBoolean(row.timedOut) &&
    typeof row.stderr === "string" &&
    typeof row.stdout === "string" &&
    Buffer.byteLength(row.stderr) + Buffer.byteLength(row.stdout) <= 64 * 1024
  );
}

function coherentFilesystemChild(row: PortablePrimitiveChildExecution): boolean {
  return (
    !row.outputLimitExceeded &&
    !row.timedOut &&
    row.exitCode === 0 &&
    row.signal === null &&
    row.stderr === "" &&
    row.event !== null &&
    row.stdout === canonicalJson(row.event)
  );
}

function createOnceResult(row: PortablePrimitiveCreateOnceRawFacts): PortablePrimitiveResult {
  if (!row.contenders.every(coherentFilesystemChild)) return "UNKNOWN";
  const created = row.contenders.filter(({ event }) => event?.event === "CREATED");
  const existing = row.contenders.filter(
    ({ event }) => event?.event === "ERROR" && event.errorCode === "EEXIST",
  );
  if (
    created.length === 1 &&
    existing.length === 31 &&
    row.finalReadbackHex === "41" &&
    row.finalReadbackErrorCode === null
  )
    return "PASS";
  const unsupportedCodes = row.contenders.map(({ event }) =>
    event?.event === "ERROR" && typeof event.errorCode === "string" ? event.errorCode : null,
  );
  if (
    unsupportedCodes.every(
      (code): code is string => code !== null && unsupportedOperationCodes.has(code),
    ) &&
    new Set(unsupportedCodes).size === 1 &&
    row.finalReadbackHex === null &&
    row.finalReadbackErrorCode === "ENOENT"
  )
    return "UNSUPPORTED";
  return "UNKNOWN";
}

export function normalizeIss022CreateOnceProbe(input: unknown): Iss022CreateOnceHandlerResult {
  try {
    const snapshot = snapshotData(input);
    if (snapshot === invalidSnapshot) return createOnceRefusal("createOnce:snapshot-refused");
    const row = snapshot as PortablePrimitiveCreateOnceRawFacts;
    if (
      !exactKeys(row, createOnceFields) ||
      row.caseId !== "CREATE_ONCE_32_CONTENDERS" ||
      row.contenderCount !== "32" ||
      row.schemaVersion !== "portable-primitives-create-once-raw/v1" ||
      !Array.isArray(row.contenders) ||
      Object.getPrototypeOf(row.contenders) !== Array.prototype ||
      row.contenders.length !== 32 ||
      (row.finalReadbackHex !== null &&
        (typeof row.finalReadbackHex !== "string" ||
          !/^(?:[0-9a-f]{2}){0,4096}$/.test(row.finalReadbackHex))) ||
      (row.finalReadbackErrorCode !== null &&
        (typeof row.finalReadbackErrorCode !== "string" ||
          !operationErrorCode.test(row.finalReadbackErrorCode))) ||
      (row.finalReadbackHex === null) === (row.finalReadbackErrorCode === null)
    )
      return createOnceRefusal("createOnce:record-refused");
    for (let index = 0; index < row.contenders.length; index += 1)
      if (!validFilesystemChild(row.contenders[index]!, "EXCLUSIVE_CREATE"))
        return createOnceRefusal(`createOnce.contenders.${index}:record-refused`);
    return {
      ok: true,
      vectorExecutions: Object.freeze([
        Object.freeze({
          caseId: "CREATE_ONCE_32_CONTENDERS",
          normalizedResult: createOnceResult(row),
          rawFacts: row,
        }),
      ]),
    };
  } catch {
    return createOnceRefusal("createOnce:unreadable");
  }
}

export async function runIss022CreateOnceStableHandler(
  custodyRoot: string,
): Promise<Iss022CreateOnceHandlerResult> {
  try {
    return normalizeIss022CreateOnceProbe(
      await executePortablePrimitiveCreateOnceProbe(custodyRoot),
    );
  } catch {
    return createOnceRefusal("createOnce:execution-refused");
  }
}

function lockRefusal(...issues: readonly string[]): Iss022LockHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function validLockChild(row: PortablePrimitiveChildExecution): boolean {
  return exactKeys(row, lockChildFields) && validFilesystemChild(row, "LOCK_ATTEMPT");
}

function validLockDescriptorChild(row: PortablePrimitiveChildExecution): boolean {
  return (
    validChildEnvelope(row) &&
    (row.event === null || parsePortablePrimitiveLockDescriptorChildEvent(row.event).ok)
  );
}

function validHolderEvent(event: ContractRecord): boolean {
  return bindPortablePrimitiveRawChildEvent(event, "LOCK_HOLDER", []).ok;
}

function holderAcquired(event: ContractRecord): boolean {
  return validHolderEvent(event) && event.event === "ACQUIRED";
}

function lockAttemptErrorCode(row: PortablePrimitiveChildExecution): string | null {
  return row.event?.event === "ERROR" && typeof row.event.errorCode === "string"
    ? row.event.errorCode
    : null;
}

function contentionResult(row: PortablePrimitiveLockContentionRawFacts): PortablePrimitiveResult {
  if (!row.holderCloseObserved || !holderAcquired(row.holderEvent)) return "UNKNOWN";
  if (!coherentFilesystemChild(row.contender)) return "UNKNOWN";
  const code = lockAttemptErrorCode(row.contender);
  if (code === "EEXIST") return "PASS";
  return code !== null && unsupportedOperationCodes.has(code) ? "UNSUPPORTED" : "UNKNOWN";
}

function holderDeathResult(row: PortablePrimitiveLockHolderDeathRawFacts): PortablePrimitiveResult {
  if (
    !row.holderCloseObserved ||
    !holderAcquired(row.holderEvent) ||
    row.acquisitionAttemptCount !== "1" ||
    row.prohibitedActions.length !== 0 ||
    !coherentFilesystemChild(row.postDeathAttempt)
  )
    return "UNKNOWN";
  if (row.postDeathAttempt.event?.event === "ACQUIRED") return "PASS";
  const code = lockAttemptErrorCode(row.postDeathAttempt);
  if (code === "EEXIST" || (code !== null && unsupportedOperationCodes.has(code)))
    return "UNSUPPORTED";
  return "UNKNOWN";
}

function nonInheritanceResult(
  row: PortablePrimitiveLockNonInheritanceRawFacts,
): PortablePrimitiveResult {
  if (row.parentReadbackHex !== row.probeNonceHex || !coherentFilesystemChild(row.child))
    return "UNKNOWN";
  const event = row.child.event;
  if (event?.accessResult === "REFUSED" && event.errorCode === "EBADF") return "PASS";
  if (
    event?.accessResult === "REFUSED" &&
    typeof event.errorCode === "string" &&
    unsupportedOperationCodes.has(event.errorCode)
  )
    return "UNSUPPORTED";
  return "UNKNOWN";
}

export function normalizeIss022LockProbe(input: unknown): Iss022LockHandlerResult {
  try {
    const snapshot = snapshotData(input);
    if (
      snapshot === invalidSnapshot ||
      !Array.isArray(snapshot) ||
      Object.getPrototypeOf(snapshot) !== Array.prototype ||
      snapshot.length !== 3
    )
      return lockRefusal("lock:census-refused");
    const [contention, holderDeath, nonInheritance] = snapshot as unknown as [
      PortablePrimitiveLockContentionRawFacts,
      PortablePrimitiveLockHolderDeathRawFacts,
      PortablePrimitiveLockNonInheritanceRawFacts,
    ];
    if (
      !exactKeys(contention, lockContentionFields) ||
      contention.caseId !== "LOCK_TWO_UNRELATED_PROCESSES" ||
      contention.schemaVersion !== "portable-primitives-lock-contention-raw/v1" ||
      !isBoolean(contention.holderCloseObserved) ||
      !validHolderEvent(contention.holderEvent) ||
      !validLockChild(contention.contender)
    )
      return lockRefusal("lock.0:record-refused");
    if (
      !exactKeys(holderDeath, lockHolderDeathFields) ||
      holderDeath.caseId !== "LOCK_HOLDER_DEATH" ||
      holderDeath.schemaVersion !== "portable-primitives-lock-holder-death-raw/v1" ||
      !isBoolean(holderDeath.holderCloseObserved) ||
      !validHolderEvent(holderDeath.holderEvent) ||
      !validLockChild(holderDeath.postDeathAttempt) ||
      !["0", "1"].includes(holderDeath.acquisitionAttemptCount) ||
      !Array.isArray(holderDeath.prohibitedActions) ||
      new Set(holderDeath.prohibitedActions).size !== holderDeath.prohibitedActions.length ||
      !holderDeath.prohibitedActions.every((action) => prohibitedLockActions.has(action))
    )
      return lockRefusal("lock.1:record-refused");
    if (
      !exactKeys(nonInheritance, lockNonInheritanceFields) ||
      nonInheritance.caseId !== "LOCK_DEFAULT_NON_INHERITANCE" ||
      nonInheritance.schemaVersion !== "portable-primitives-lock-non-inheritance-raw/v1" ||
      !digest.test(nonInheritance.parentReadbackHex) ||
      !digest.test(nonInheritance.probeNonceHex) ||
      !validLockDescriptorChild(nonInheritance.child)
    )
      return lockRefusal("lock.2:record-refused");
    return {
      ok: true,
      vectorExecutions: Object.freeze([
        Object.freeze({
          caseId: contention.caseId,
          normalizedResult: contentionResult(contention),
          rawFacts: contention,
        }),
        Object.freeze({
          caseId: holderDeath.caseId,
          normalizedResult: holderDeathResult(holderDeath),
          rawFacts: holderDeath,
        }),
        Object.freeze({
          caseId: nonInheritance.caseId,
          normalizedResult: nonInheritanceResult(nonInheritance),
          rawFacts: nonInheritance,
        }),
      ]),
    };
  } catch {
    return lockRefusal("lock:unreadable");
  }
}

export async function runIss022LockStableHandler(
  custodyRoot: string,
): Promise<Iss022LockHandlerResult> {
  try {
    return normalizeIss022LockProbe(await executePortablePrimitiveLockProbe(custodyRoot));
  } catch {
    return lockRefusal("lock:execution-refused");
  }
}

function replaceRefusal(...issues: readonly string[]): Iss022ReplaceHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function coherentReplaceBarrierChild(
  row: PortablePrimitiveChildExecution,
  requestedBarrier: PortablePrimitiveReplaceRawFacts["requestedBarrier"],
): boolean {
  return (
    !row.outputLimitExceeded &&
    !row.timedOut &&
    row.exitCode === null &&
    row.signal === "SIGKILL" &&
    row.stderr === "" &&
    row.event?.event === "REACHED_BARRIER" &&
    row.event.barrier === requestedBarrier &&
    row.stdout === canonicalJson(row.event)
  );
}

function coherentReplaceErrorChild(row: PortablePrimitiveChildExecution): boolean {
  return (
    !row.outputLimitExceeded &&
    !row.timedOut &&
    row.stderr === "" &&
    row.event?.event === "ERROR" &&
    row.stdout === canonicalJson(row.event) &&
    ((row.exitCode === 0 && row.signal === null) ||
      (row.exitCode === null && row.signal === "SIGKILL"))
  );
}

function replaceResult(row: PortablePrimitiveReplaceRawFacts): PortablePrimitiveResult {
  const expectedReadback =
    row.requestedBarrier === "AFTER_RENAME" || row.requestedBarrier === "AFTER_DIRECTORY_SYNC"
      ? "42"
      : "41";
  if (row.child.event?.event === "REACHED_BARRIER")
    return coherentReplaceBarrierChild(row.child, row.requestedBarrier) &&
      row.finalReadbackErrorCode === null &&
      row.finalReadbackHex === expectedReadback
      ? "PASS"
      : "UNKNOWN";
  if (
    row.child.event?.event !== "ERROR" ||
    !coherentReplaceErrorChild(row.child) ||
    typeof row.child.event.errorCode !== "string" ||
    !unsupportedOperationCodes.has(row.child.event.errorCode) ||
    row.requestedBarrier === "READY" ||
    row.finalReadbackErrorCode !== null
  )
    return "UNKNOWN";
  const reachableUnsupportedReadbacks =
    row.requestedBarrier === "AFTER_DIRECTORY_SYNC" ? new Set(["41", "42"]) : new Set(["41"]);
  return row.finalReadbackHex !== null && reachableUnsupportedReadbacks.has(row.finalReadbackHex)
    ? "UNSUPPORTED"
    : "UNKNOWN";
}

export function normalizeIss022ReplaceProbe(input: unknown): Iss022ReplaceHandlerResult {
  try {
    const snapshot = snapshotData(input);
    if (
      snapshot === invalidSnapshot ||
      !Array.isArray(snapshot) ||
      Object.getPrototypeOf(snapshot) !== Array.prototype ||
      snapshot.length !== portablePrimitiveReplaceCases.length
    )
      return replaceRefusal("replace:census-refused");
    const rows = snapshot as unknown as PortablePrimitiveReplaceRawFacts[];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const definition = portablePrimitiveReplaceCases[index]!;
      if (
        !exactKeys(row, replaceFields) ||
        row.caseId !== definition.caseId ||
        row.requestedBarrier !== definition.requestedBarrier ||
        row.schemaVersion !== "portable-primitives-replace-raw/v1" ||
        row.initialReadbackHex !== "41" ||
        (row.finalReadbackHex !== null &&
          (typeof row.finalReadbackHex !== "string" ||
            !/^[0-9a-f]{2}$/.test(row.finalReadbackHex))) ||
        (row.finalReadbackErrorCode !== null &&
          (typeof row.finalReadbackErrorCode !== "string" ||
            !operationErrorCode.test(row.finalReadbackErrorCode))) ||
        (row.finalReadbackHex === null) === (row.finalReadbackErrorCode === null) ||
        !validFilesystemChild(row.child, "REPLACE", [row.requestedBarrier])
      )
        return replaceRefusal(`replace.${index}:record-refused`);
    }
    return {
      ok: true,
      vectorExecutions: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            caseId: row.caseId,
            normalizedResult: replaceResult(row),
            rawFacts: row,
          }),
        ),
      ),
    };
  } catch {
    return replaceRefusal("replace:unreadable");
  }
}

export async function runIss022ReplaceStableHandler(
  custodyRoot: string,
): Promise<Iss022ReplaceHandlerResult> {
  try {
    return normalizeIss022ReplaceProbe(await executePortablePrimitiveReplaceProbe(custodyRoot));
  } catch {
    return replaceRefusal("replace:execution-refused");
  }
}

// Private stable experiment protocol; no native behavior is certified here.
import { constants } from "node:os";
import {
  canonicalJson,
  snapshotClosedArray,
  snapshotClosedRecord,
} from "../../../packages/contracts/src/runtime.ts";

export const interfaceVersion = "iss022-native-lock-experiment/v1";
export function refuse() {
  throw new Error("native-lock-fixture:refused");
}
export function record(value, keys) {
  const parsed = snapshotClosedRecord(value, keys);
  if (!parsed.ok) refuse();
  return parsed.value;
}
export function decimal(value, signed = false) {
  if (
    typeof value !== "string" ||
    !(signed ? /^(0|-?[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)$/).test(value) ||
    value.length > 21
  )
    refuse();
  return value;
}
function unsigned64(value) {
  decimal(value);
  if (BigInt(value) > 18446744073709551615n) refuse();
}
function nativeNumber(value) {
  unsigned64(value);
  if (process.platform !== "win32" && BigInt(value) > 2147483647n) refuse();
}
export function identity(value) {
  const kind = record(
    value,
    process.platform === "win32"
      ? ["kind", "volumeSerialNumber", "fileIdHex"]
      : ["kind", "device", "inode"],
  );
  if (process.platform === "win32") {
    if (
      kind.kind !== "WINDOWS" ||
      typeof kind.fileIdHex !== "string" ||
      !/^[0-9a-f]{32}$/.test(kind.fileIdHex)
    )
      refuse();
    unsigned64(kind.volumeSerialNumber);
  } else {
    if (kind.kind !== "POSIX") refuse();
    unsigned64(kind.device);
    unsigned64(kind.inode);
  }
  return kind;
}
export const sameIdentity = (a, b) => canonicalJson(identity(a)) === canonicalJson(identity(b));
export const readOperations = Object.freeze(
  process.platform === "win32"
    ? ["IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS"]
    : ["IDENTIFY", "FLAGS"],
);
export const openOperations = Object.freeze(
  process.platform === "win32"
    ? ["OPEN", "IDENTIFY", "IDENTIFY", "IDENTIFY", "FLAGS", "FLAGS"]
    : ["OPEN", ...readOperations],
);
const custodyOperations =
  process.platform === "win32"
    ? ["OPEN", "IDENTIFY", "IDENTIFY", "CLOSE"]
    : ["OPEN", "IDENTIFY", "CLOSE"];

export function parseFacts(value) {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok || parsed.value.length === 0 || parsed.value.length > 7) refuse();
  return Object.freeze(
    parsed.value.map((entry) => {
      const fact = record(entry, [
        "operation",
        "returnValue",
        "errorCode",
        "identity",
        "nativeHandle",
        "nonInheritable",
      ]);
      if (
        !["OPEN", "IDENTIFY", "FLAGS", "TRY_LOCK", "UNLOCK", "CLOSE", "DESCRIBE"].includes(
          fact.operation,
        )
      )
        refuse();
      decimal(fact.returnValue, true);
      decimal(fact.errorCode);
      if (fact.identity !== null) identity(fact.identity);
      if (fact.nativeHandle !== null) nativeNumber(fact.nativeHandle);
      if (fact.nonInheritable !== null && typeof fact.nonInheritable !== "boolean") refuse();
      if (fact.operation === "CLOSE" && fact.nativeHandle !== null) refuse();
      return fact;
    }),
  );
}
export function successful(fact) {
  if (fact.errorCode !== "0") return false;
  if (fact.operation === "OPEN")
    return fact.nativeHandle !== null && fact.returnValue === fact.nativeHandle;
  if (process.platform !== "win32" && fact.operation === "FLAGS")
    return BigInt(fact.returnValue) >= 0n;
  return fact.returnValue === (process.platform === "win32" ? "1" : "0");
}
export function operationsAre(facts, operations) {
  return (
    facts.length === operations.length && facts.every((fact, i) => fact.operation === operations[i])
  );
}
export function requireLiveFacts(facts, operations, expectedIdentity, nativeHandle = undefined) {
  if (!operationsAre(facts, operations) || !facts.every(successful)) refuse();
  const final = facts.at(-1);
  if (
    final.identity === null ||
    !sameIdentity(final.identity, expectedIdentity) ||
    final.nonInheritable !== true ||
    final.nativeHandle === null
  )
    refuse();
  for (const fact of facts) {
    // Native identification populates the snapshot before IDENTIFY is recorded;
    // every later successful call retains it. Only the initial OPEN lacks it.
    if (
      fact.nativeHandle !== final.nativeHandle ||
      (fact.operation !== "OPEN" && fact.identity === null) ||
      (fact.identity !== null && !sameIdentity(fact.identity, expectedIdentity))
    )
      refuse();
  }
  if (nativeHandle !== undefined && final.nativeHandle !== nativeHandle) refuse();
  if (
    process.platform !== "win32" &&
    final.operation === "FLAGS" &&
    (BigInt(final.returnValue) & 1n) === 0n
  )
    refuse();
  return final.nativeHandle;
}

// Error meanings are stable OS constants, never a candidate-provided table.
export function lockDisposition(value) {
  const facts = parseFacts(value);
  if (!operationsAre(facts, ["TRY_LOCK"])) refuse();
  const fact = facts[0];
  if (successful(fact)) return "ACQUIRED";
  if (fact.errorCode === "0" || fact.returnValue !== (process.platform === "win32" ? "0" : "-1"))
    return "UNKNOWN";
  const numbers = (names) =>
    names
      .map((name) => constants.errno[name])
      .filter(Number.isInteger)
      .map(String);
  const contended = process.platform === "win32" ? ["33"] : numbers(["EWOULDBLOCK", "EAGAIN"]);
  const unsupported =
    process.platform === "win32"
      ? ["1", "5", "50"]
      : numbers(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EACCES", "EPERM"]);
  if (contended.includes(fact.errorCode)) return "CONTENDED";
  return unsupported.includes(fact.errorCode) ? "UNSUPPORTED" : "UNKNOWN";
}

// Null is refusal even when all recorded metadata calls succeeded; never recover it from facts.
export function parseCustodyResult(value) {
  const parsed = record(value, ["identity", "facts"]);
  const facts = parseFacts(parsed.facts);
  if (facts[0].operation !== "OPEN") refuse();
  if (!successful(facts[0])) {
    if (facts.length !== 1 || facts[0].nativeHandle !== null || parsed.identity !== null) refuse();
  } else {
    const middle = facts.slice(1, -1);
    if (
      facts.at(-1).operation !== "CLOSE" ||
      middle.length === 0 ||
      middle.length > custodyOperations.length - 2
    )
      refuse();
    for (const [i, fact] of middle.entries()) {
      if (
        fact.operation !== custodyOperations[i + 1] ||
        fact.nativeHandle !== facts[0].nativeHandle ||
        (i < middle.length - 1 && !successful(fact))
      )
        refuse();
    }
  }
  if (parsed.identity !== null) {
    identity(parsed.identity);
    if (!operationsAre(facts, custodyOperations) || !facts.every(successful)) refuse();
    for (const fact of facts) {
      if (
        (fact.operation !== "OPEN" && fact.identity === null) ||
        (fact.identity !== null && !sameIdentity(fact.identity, parsed.identity))
      )
        refuse();
    }
  }
  return Object.freeze({ identity: parsed.identity, facts });
}
export function requireCustody(value, expectedRoot, expectedLeaf) {
  const parsed = record(value, [
    "rootIdentity",
    "leafIdentity",
    "regularFile",
    "linkCount",
    "size",
  ]);
  if (
    parsed.rootIdentity === null ||
    parsed.leafIdentity === null ||
    !sameIdentity(parsed.rootIdentity, expectedRoot) ||
    !sameIdentity(parsed.leafIdentity, expectedLeaf) ||
    parsed.regularFile !== true ||
    parsed.linkCount !== "1" ||
    parsed.size !== "1"
  )
    refuse();
  return parsed;
}

// Only stable witness facts may enter this conversion. Preserve raw CALLs separately.
export function inspectionFromFacts(value, nativeHandle) {
  nativeNumber(nativeHandle);
  const facts = parseFacts(value);
  const invalid = process.platform === "win32" ? "6" : String(constants.errno.EBADF);
  const first = facts[0];
  if (
    operationsAre(facts, ["IDENTIFY"]) &&
    first.errorCode === invalid &&
    first.returnValue === (process.platform === "win32" ? "0" : "-1") &&
    first.identity === null &&
    first.nativeHandle === null &&
    first.nonInheritable === null
  ) {
    return Object.freeze({
      nativeHandle,
      identity: null,
      nonInheritable: null,
      errorCode: invalid,
    });
  }
  if (!operationsAre(facts, readOperations) || !facts.every(successful)) refuse();
  const final = facts.at(-1);
  if (final.identity === null || typeof final.nonInheritable !== "boolean") refuse();
  if (
    process.platform !== "win32" &&
    final.nonInheritable !== ((BigInt(final.returnValue) & 1n) !== 0n)
  )
    refuse();
  for (const fact of facts) {
    if (
      fact.nativeHandle !== nativeHandle ||
      fact.identity === null ||
      !sameIdentity(fact.identity, final.identity)
    )
      refuse();
  }
  return Object.freeze({
    nativeHandle,
    identity: final.identity,
    nonInheritable: final.nonInheritable,
    errorCode: "0",
  });
}
export function requireInspection(value, expectedIdentity, child = false) {
  const parsed = record(value, ["nativeHandle", "identity", "nonInheritable", "errorCode"]);
  nativeNumber(parsed.nativeHandle);
  const invalid = process.platform === "win32" ? "6" : String(constants.errno.EBADF);
  if (
    child &&
    parsed.errorCode === invalid &&
    parsed.identity === null &&
    parsed.nonInheritable === null
  )
    return parsed;
  if (
    parsed.errorCode !== "0" ||
    parsed.identity === null ||
    typeof parsed.nonInheritable !== "boolean"
  )
    refuse();
  if (
    child
      ? sameIdentity(parsed.identity, expectedIdentity)
      : !sameIdentity(parsed.identity, expectedIdentity) || parsed.nonInheritable !== true
  )
    refuse();
  return parsed;
}

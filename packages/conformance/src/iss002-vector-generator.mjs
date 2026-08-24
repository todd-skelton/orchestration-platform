const caseIds = Object.freeze([
  "authority-history-linear",
  "authority-rotation-resting-cas-armed",
  "bootstrap-e0-core-post",
  "canonical-decimal-boundaries",
  "canonical-framing-boundaries",
  "commit-run-single-epoch-prefixes",
  "destination-owner-race",
  "external-ledger-literals",
  "full-required-loss",
  "physical-destination-profile",
  "pointer-digest-domains",
  "pointer-kind-census",
  "pointer-packet-purpose-handle",
  "recovery-archives-tombstones",
  "recovery-attempt-descriptor",
  "recovery-attempt-log",
  "recovery-attempt-reservation",
  "recovery-authorization-core",
  "reflective-arrays",
  "reflective-records",
  "run-current-crash-prefixes",
  "walk-1000-records",
]);

function canonicalPositiveDecimal(value) {
  return (
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))
  );
}

function next(state) {
  let value = state;
  value ^= value << 13n;
  value ^= value >> 7n;
  value ^= value << 17n;
  return BigInt.asUintN(64, value);
}

function detachedParameters(input) {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      nodeTypes.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      throw new TypeError("iss002-vector-parameters:refused");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.sort().join("\0") !== "caseId\0iterationCount\0seed"
    )
      throw new TypeError("iss002-vector-parameters:refused");
    const values = Object.create(null);
    for (const key of ["caseId", "iterationCount", "seed"]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
        throw new TypeError("iss002-vector-parameters:refused");
      values[key] = descriptor.value;
    }
    return Object.freeze(values);
  } catch {
    throw new TypeError("iss002-vector-parameters:refused");
  }
}

export function generate(input) {
  const parameters = detachedParameters(input);
  if (
    !caseIds.includes(parameters.caseId) ||
    !canonicalPositiveDecimal(parameters.iterationCount) ||
    typeof parameters.seed !== "string" ||
    !/^[0-9a-f]{64}$/.test(parameters.seed)
  )
    throw new TypeError("iss002-vector-parameters:refused");
  const count = Number(parameters.iterationCount);
  if (parameters.caseId === "walk-1000-records" ? count !== 1000 : count !== 1)
    throw new TypeError("iss002-vector-parameters:iteration-census-mismatch");
  let state = BigInt(`0x${parameters.seed.slice(0, 16)}`) || 1n;
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    state = next(state);
    samples.push(state.toString(16).padStart(16, "0"));
  }
  return Object.freeze({
    caseId: parameters.caseId,
    samples: Object.freeze(samples),
    seed: parameters.seed,
  });
}
import { types as nodeTypes } from "node:util";

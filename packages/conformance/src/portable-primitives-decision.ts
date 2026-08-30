import {
  canonicalBytes,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  computePortableCustodyProfileDigest,
  computePortablePrimitiveObservationDigest,
  parsePortablePrimitiveObservation,
  portablePrimitiveCaseIds,
} from "@orchestration-platform/portable-primitives";

export const portablePrimitivesDecisionCoreSchemaVersion =
  "portable-primitives-capability-decision-core/v1" as const;
export const portablePrimitivesIndependentReviewSchemaVersion =
  "portable-primitives-independent-review/v1" as const;
export const portablePrimitivesDecisionSchemaVersion =
  "portable-primitives-capability-decision/v1" as const;

const coreFields = Object.freeze([
  "aggregateDigest",
  "candidateSubjectDigest",
  "contractVersionsDigest",
  "custodyProfileDigest",
  "decision",
  "decisionWriterDigest",
  "diagnosticTerminalDigest",
  "harnessBundleDigest",
  "helperAbiDigests",
  "helperDigests",
  "observationDigests",
  "osProfileDigests",
  "profile",
  "providerRunDigest",
  "requiredJobRegistryDigest",
  "schemaVersion",
  "stableHarnessSubjectDigest",
  "testBundleDigest",
] as const);
const reviewFields = Object.freeze([
  "decisionCoreDigest",
  "providerReviewDigest",
  "reviewDisposition",
  "reviewedAt",
  "reviewerSubjectDigest",
  "schemaVersion",
] as const);
const decisionFields = Object.freeze([
  "decisionCoreDigest",
  "independentReviewReceiptDigest",
  "schemaVersion",
] as const);
const profileFields = Object.freeze([
  "absence",
  "atomicReplace",
  "cas",
  "createOnce",
  "custody",
  "destinationLock",
  "handleConfinement",
  "helper",
  "helperAbi",
  "parserEquivalence",
  "physicalIdentity",
  "process",
  "runtimeLock",
] as const);

export const portablePrimitivesCapabilityProfile = Object.freeze({
  absence: "NODE_LOCKED_LSTAT_ENOENT_V1",
  atomicReplace: "NODE_TEMP_SYNC_RENAME_DIRSYNC_V1",
  cas: "NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1",
  createOnce: "NODE_OPEN_EXCL_SYNC_READBACK_V1",
  custody: "STABLE_PARENT_EXCLUSIVE_NAMESPACE_FILE_V1",
  destinationLock: "NODE_EXCL_OWNER_DEATH_LOCK_V1",
  handleConfinement: "NODE_WEAKMAP_NONCE_CALLBACK_V1",
  helper: "NODE24_BUILTIN_FS_CHILD_PROCESS_V1",
  helperAbi: "NODE24_MODULES_NAPI_V1",
  parserEquivalence: "NODE_FRESH_CHILD_CANONICAL_PARSE_V1",
  physicalIdentity: "NODE_REALPATH_BIGINT_STATFS_LEAF_V1",
  process: "NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1",
  runtimeLock: "NODE_EXCL_OWNER_DEATH_LOCK_V1",
} as const);

export type PortablePrimitivesDigestSlots = readonly [string | null, string | null, string | null];

type SerializedDecisionRecord =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function success(value: ContractRecord): ParseResult {
  return { ok: true, value };
}

function nullableDigest(value: JsonValue | undefined): boolean {
  return value === null || isSha256(value);
}

function digestSlots(
  value: JsonValue | undefined,
  field: string,
): { readonly issues: readonly string[]; readonly values?: readonly JsonValue[] } {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok || parsed.value.length !== 3)
    return { issues: [`${field}:three-slot-array-required`] };
  if (parsed.value.some((entry) => !nullableDigest(entry)))
    return { issues: [`${field}:nullable-digest-required`] };
  return { issues: [], values: parsed.value };
}

function observationDigestArray(value: JsonValue | undefined): {
  readonly issues: readonly string[];
  readonly values?: readonly string[];
} {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok || parsed.value.length > 63)
    return { issues: ["observationDigests:bounded-array-required"] };
  if (parsed.value.some((entry) => !isSha256(entry)))
    return { issues: ["observationDigests:digest-required"] };
  if (new Set(parsed.value).size !== parsed.value.length)
    return { issues: ["observationDigests:duplicate-refused"] };
  return { issues: [], values: parsed.value.map(String) };
}

function profileIssues(value: JsonValue | undefined, decision: JsonValue | undefined): string[] {
  const parsed = snapshotClosedRecord(value, profileFields);
  if (!parsed.ok) return parsed.issues.map((issue) => `profile.${issue}`);
  const issues: string[] = [];
  for (const field of profileFields) {
    const expected = decision === "PASS" ? portablePrimitivesCapabilityProfile[field] : null;
    if (parsed.value[field] !== expected) issues.push(`profile.${field}:arm-mismatch`);
  }
  return issues;
}

export function computePortablePrimitivesStableHarnessSubjectDigest(
  harnessBundleDigest: string,
  testBundleDigest: string,
  requiredJobRegistryDigest: string,
  contractVersionsDigest: string,
): string {
  for (const [field, value] of Object.entries({
    contractVersionsDigest,
    harnessBundleDigest,
    requiredJobRegistryDigest,
    testBundleDigest,
  }))
    if (!isSha256(value)) throw new TypeError(`${field}:invalid`);
  return framedDigest("portable-primitives-stable-harness-subject/v1", [
    frame.raw32(harnessBundleDigest),
    frame.raw32(testBundleDigest),
    frame.raw32(requiredJobRegistryDigest),
    frame.raw32(contractVersionsDigest),
  ]);
}

export function computePortablePrimitivesDecisionWriterDigest(
  stableHarnessSubjectDigest: string,
  harnessBundleDigest: string,
  testBundleDigest: string,
  contractVersionsDigest: string,
): string {
  for (const [field, value] of Object.entries({
    contractVersionsDigest,
    harnessBundleDigest,
    stableHarnessSubjectDigest,
    testBundleDigest,
  }))
    if (!isSha256(value)) throw new TypeError(`${field}:invalid`);
  return framedDigest("portable-primitives-decision-writer/v1", [
    frame.raw32(stableHarnessSubjectDigest),
    frame.raw32(harnessBundleDigest),
    frame.raw32(testBundleDigest),
    frame.raw32(contractVersionsDigest),
  ]);
}

export function parsePortablePrimitivesCapabilityDecisionCore(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, coreFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "candidateSubjectDigest",
    "contractVersionsDigest",
    "custodyProfileDigest",
    "decisionWriterDigest",
    "harnessBundleDigest",
    "providerRunDigest",
    "requiredJobRegistryDigest",
    "stableHarnessSubjectDigest",
    "testBundleDigest",
  ] as const)
    if (!isSha256(value[field])) issues.push(`${field}:invalid`);
  const helperAbis = digestSlots(value.helperAbiDigests, "helperAbiDigests");
  const helpers = digestSlots(value.helperDigests, "helperDigests");
  const osProfiles = digestSlots(value.osProfileDigests, "osProfileDigests");
  const observations = observationDigestArray(value.observationDigests);
  issues.push(
    ...helperAbis.issues,
    ...helpers.issues,
    ...osProfiles.issues,
    ...observations.issues,
  );
  if (value.schemaVersion !== portablePrimitivesDecisionCoreSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (value.custodyProfileDigest !== computePortableCustodyProfileDigest())
    issues.push("custodyProfileDigest:mismatch");
  if (value.decision !== "PASS" && value.decision !== "BLOCK_REPLAN")
    issues.push("decision:invalid");
  else {
    if (
      helperAbis.values &&
      helpers.values &&
      helperAbis.values.some((slot, index) => (slot === null) !== (helpers.values![index] === null))
    )
      issues.push("helperDigests:abi-slot-presence-mismatch");
    issues.push(...profileIssues(value.profile, value.decision));
    if (value.decision === "PASS") {
      if (!isSha256(value.aggregateDigest)) issues.push("aggregateDigest:pass-required");
      if (value.diagnosticTerminalDigest !== null)
        issues.push("diagnosticTerminalDigest:pass-must-be-null");
      if (observations.values?.length !== 63)
        issues.push("observationDigests:pass-census-required");
      for (const [field, slots] of [
        ["helperAbiDigests", helperAbis.values],
        ["helperDigests", helpers.values],
        ["osProfileDigests", osProfiles.values],
      ] as const)
        if (slots?.some((slot) => !isSha256(slot))) issues.push(`${field}:pass-non-null-required`);
    } else {
      if (value.aggregateDigest !== null) issues.push("aggregateDigest:block-must-be-null");
      if (!isSha256(value.diagnosticTerminalDigest))
        issues.push("diagnosticTerminalDigest:block-required");
      if (osProfiles.values?.some((slot) => slot !== null))
        issues.push("osProfileDigests:block-must-be-null");
    }
  }
  if (
    isSha256(value.harnessBundleDigest) &&
    isSha256(value.testBundleDigest) &&
    isSha256(value.requiredJobRegistryDigest) &&
    isSha256(value.contractVersionsDigest)
  ) {
    const stableSubject = computePortablePrimitivesStableHarnessSubjectDigest(
      String(value.harnessBundleDigest),
      String(value.testBundleDigest),
      String(value.requiredJobRegistryDigest),
      String(value.contractVersionsDigest),
    );
    if (value.stableHarnessSubjectDigest !== stableSubject)
      issues.push("stableHarnessSubjectDigest:mismatch");
    const writer = computePortablePrimitivesDecisionWriterDigest(
      stableSubject,
      String(value.harnessBundleDigest),
      String(value.testBundleDigest),
      String(value.contractVersionsDigest),
    );
    if (value.decisionWriterDigest !== writer) issues.push("decisionWriterDigest:mismatch");
  }
  return issues.length === 0 ? success(value) : failure(...issues);
}

export function computePortablePrimitivesCapabilityDecisionCoreDigest(input: unknown): string {
  const parsed = parsePortablePrimitivesCapabilityDecisionCore(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(portablePrimitivesDecisionCoreSchemaVersion, [frame.canonical(parsed.value)]);
}

function serialize(
  input: unknown,
  parser: (value: unknown) => ParseResult,
  digest: (value: unknown) => string,
): SerializedDecisionRecord {
  const parsed = parser(input);
  if (!parsed.ok) return parsed;
  return { ok: true, bytes: canonicalBytes(parsed.value), digest: digest(parsed.value) };
}

export function serializePortablePrimitivesCapabilityDecisionCore(
  input: unknown,
): SerializedDecisionRecord {
  return serialize(
    input,
    parsePortablePrimitivesCapabilityDecisionCore,
    computePortablePrimitivesCapabilityDecisionCoreDigest,
  );
}

const operatingSystems = Object.freeze(["LINUX", "MACOS", "WINDOWS"] as const);

function stableObservations(input: readonly unknown[]): {
  readonly issues: readonly string[];
  readonly digests: readonly string[];
  readonly allPass: boolean;
  readonly presentOperatingSystems: ReadonlySet<string>;
} {
  const issues: string[] = [];
  const digests: string[] = [];
  const presentOperatingSystems = new Set<string>();
  let priorRank = -1;
  let allPass = true;
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok || snapshot.value.length > 63)
    return {
      allPass: false,
      digests: [],
      issues: ["observations:closed-bounded-array-required"],
      presentOperatingSystems,
    };
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const parsed = parsePortablePrimitiveObservation(snapshot.value[index]);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `observations.${index}.${issue}`));
      continue;
    }
    const osIndex = operatingSystems.indexOf(
      parsed.value.operatingSystem as (typeof operatingSystems)[number],
    );
    const caseIndex = portablePrimitiveCaseIds.indexOf(
      parsed.value.caseId as (typeof portablePrimitiveCaseIds)[number],
    );
    const rank = osIndex * portablePrimitiveCaseIds.length + caseIndex;
    if (rank <= priorRank) issues.push(`observations.${index}:stable-subset-order-refused`);
    priorRank = rank;
    if (parsed.value.normalizedResult !== "PASS") allPass = false;
    presentOperatingSystems.add(String(parsed.value.operatingSystem));
    digests.push(computePortablePrimitiveObservationDigest(parsed.value));
  }
  return {
    allPass,
    digests: Object.freeze(digests),
    issues,
    presentOperatingSystems,
  };
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Closes only the core's observation subset syntax and identities. Aggregate,
 * diagnostic-terminal, environment, profile, and custody authority belong to
 * the later stable decision writer and are deliberately not granted here.
 */
export function joinPortablePrimitivesDecisionCoreObservations(
  input: unknown,
  observationRecords: readonly unknown[],
): ParseResult {
  try {
    const parsed = parsePortablePrimitivesCapabilityDecisionCore(input);
    if (!parsed.ok) return parsed;
    const observations = stableObservations(observationRecords);
    const issues = [...observations.issues];
    const actualObservationDigests = parsed.value.observationDigests;
    if (
      !Array.isArray(actualObservationDigests) ||
      !sameArray(actualObservationDigests, observations.digests)
    )
      issues.push("observationDigests:evidence-or-order-mismatch");
    if (
      parsed.value.decision === "PASS" &&
      (observations.digests.length !== 63 || !observations.allPass)
    )
      issues.push("observations:pass-census-refused");
    const helperAbis = parsed.value.helperAbiDigests;
    const helpers = parsed.value.helperDigests;
    if (Array.isArray(helperAbis) && Array.isArray(helpers)) {
      for (let index = 0; index < operatingSystems.length; index += 1) {
        const operatingSystem = operatingSystems[index]!;
        if (
          observations.presentOperatingSystems.has(operatingSystem) &&
          (helperAbis[index] === null || helpers[index] === null)
        )
          issues.push(`helperDigests.${operatingSystem}:present-observation-requires-helper-abi`);
      }
    }
    return issues.length === 0 ? parsed : failure(...issues);
  } catch {
    return failure("decisionCoreObservationJoin:unreadable");
  }
}

export function parsePortablePrimitivesIndependentReview(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, reviewFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "decisionCoreDigest",
    "providerReviewDigest",
    "reviewerSubjectDigest",
  ] as const)
    if (!isSha256(value[field])) issues.push(`${field}:invalid`);
  if (
    value.reviewDisposition !== "AUTHORIZE_PASS" &&
    value.reviewDisposition !== "RECORD_BLOCK_REPLAN"
  )
    issues.push("reviewDisposition:invalid");
  if (!isCanonicalTimestamp(value.reviewedAt)) issues.push("reviewedAt:invalid");
  if (value.schemaVersion !== portablePrimitivesIndependentReviewSchemaVersion)
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(value) : failure(...issues);
}

export function computePortablePrimitivesIndependentReviewDigest(input: unknown): string {
  const parsed = parsePortablePrimitivesIndependentReview(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const value = parsed.value;
  return framedDigest(portablePrimitivesIndependentReviewSchemaVersion, [
    frame.raw32(String(value.decisionCoreDigest)),
    frame.raw32(String(value.providerReviewDigest)),
    frame.text(String(value.reviewDisposition)),
    frame.text(String(value.reviewedAt)),
    frame.raw32(String(value.reviewerSubjectDigest)),
    frame.canonical(value),
  ]);
}

export function serializePortablePrimitivesIndependentReview(
  input: unknown,
): SerializedDecisionRecord {
  return serialize(
    input,
    parsePortablePrimitivesIndependentReview,
    computePortablePrimitivesIndependentReviewDigest,
  );
}

export function joinPortablePrimitivesIndependentReviewToCore(
  independentReview: unknown,
  decisionCore: unknown,
): ParseResult {
  const parsed = parsePortablePrimitivesIndependentReview(independentReview);
  const core = parsePortablePrimitivesCapabilityDecisionCore(decisionCore);
  if (!parsed.ok) return parsed;
  if (!core.ok) return failure(...core.issues.map((issue) => `decisionCore.${issue}`));
  const issues: string[] = [];
  const coreDigest = computePortablePrimitivesCapabilityDecisionCoreDigest(core.value);
  if (parsed.value.decisionCoreDigest !== coreDigest)
    issues.push("decisionCoreDigest:core-mismatch");
  const disposition = core.value.decision === "PASS" ? "AUTHORIZE_PASS" : "RECORD_BLOCK_REPLAN";
  if (parsed.value.reviewDisposition !== disposition)
    issues.push("reviewDisposition:decision-mismatch");
  return issues.length === 0 ? parsed : failure(...issues);
}

export function parsePortablePrimitivesCapabilityDecision(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, decisionFields);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  for (const field of ["decisionCoreDigest", "independentReviewReceiptDigest"] as const)
    if (!isSha256(parsed.value[field])) issues.push(`${field}:invalid`);
  if (parsed.value.schemaVersion !== portablePrimitivesDecisionSchemaVersion)
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? success(parsed.value) : failure(...issues);
}

export function computePortablePrimitivesCapabilityDecisionDigest(input: unknown): string {
  const parsed = parsePortablePrimitivesCapabilityDecision(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const value = parsed.value;
  return framedDigest(portablePrimitivesDecisionSchemaVersion, [
    frame.raw32(String(value.decisionCoreDigest)),
    frame.raw32(String(value.independentReviewReceiptDigest)),
    frame.canonical(value),
  ]);
}

export function serializePortablePrimitivesCapabilityDecision(
  input: unknown,
): SerializedDecisionRecord {
  return serialize(
    input,
    parsePortablePrimitivesCapabilityDecision,
    computePortablePrimitivesCapabilityDecisionDigest,
  );
}

export function validatePortablePrimitivesCapabilityDecision(
  input: unknown,
  decisionCore: unknown,
  independentReview: unknown,
): ParseResult {
  try {
    const parsed = parsePortablePrimitivesCapabilityDecision(input);
    if (!parsed.ok) return parsed;
    const core = parsePortablePrimitivesCapabilityDecisionCore(decisionCore);
    const review = parsePortablePrimitivesIndependentReview(independentReview);
    if (!core.ok) return failure(...core.issues.map((issue) => `decisionCore.${issue}`));
    if (!review.ok) return failure(...review.issues.map((issue) => `independentReview.${issue}`));
    const coreDigest = computePortablePrimitivesCapabilityDecisionCoreDigest(core.value);
    const reviewDigest = computePortablePrimitivesIndependentReviewDigest(review.value);
    const issues: string[] = [];
    if (review.value.decisionCoreDigest !== coreDigest)
      issues.push("independentReview.decisionCoreDigest:mismatch");
    const expectedDisposition =
      core.value.decision === "PASS" ? "AUTHORIZE_PASS" : "RECORD_BLOCK_REPLAN";
    if (review.value.reviewDisposition !== expectedDisposition)
      issues.push("independentReview.reviewDisposition:decision-mismatch");
    if (parsed.value.decisionCoreDigest !== coreDigest) issues.push("decisionCoreDigest:mismatch");
    if (parsed.value.independentReviewReceiptDigest !== reviewDigest)
      issues.push("independentReviewReceiptDigest:mismatch");
    return issues.length === 0 ? parsed : failure(...issues);
  } catch {
    return failure("decisionValidation:unreadable");
  }
}

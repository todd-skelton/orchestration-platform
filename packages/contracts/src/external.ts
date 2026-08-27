import {
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";
import { decodeCanonicalPhysicalLeaf, type PhysicalOperatingSystem } from "./unicode15.js";

const physicalIdentityFields = Object.freeze([
  "ancestorObjectIdentityDigest",
  "canonicalPhysicalLeafBytes",
  "filesystemIdentityDigest",
  "hostCustodyNamespaceDigest",
  "leafIdentityKind",
  "operatingSystem",
  "physicalVolumeIdentityDigest",
  "schemaVersion",
] as const);
const locatorObservationFields = Object.freeze([
  "caseComparisonProfile",
  "custodyInstanceDigest",
  "custodyReceiptDigest",
  "disposition",
  "helperDigest",
  "helperVersion",
  "logicalLocatorDigest",
  "nativeIdentityReadbackDigest",
  "observedAt",
  "physicalDestinationIdentityDigest",
  "resolvedLocatorReadbackDigest",
  "schemaVersion",
  "unicodeNormalizationProfile",
  "validFrom",
  "validUntil",
] as const);
const absenceObservationFields = Object.freeze([
  "custodyInstanceDigest",
  "destinationDigest",
  "helperDigest",
  "locatorObservationDigest",
  "observedAt",
  "physicalDestinationIdentityDigest",
  "reason",
  "schemaVersion",
  "stateRootDigest",
] as const);
const physicalObservationExpectationFields = Object.freeze([
  "locatorObservationDigest",
  "physicalDestinationIdentityDigest",
] as const);
const absenceExpectationFields = Object.freeze([
  "custodyInstanceDigest",
  "destinationDigest",
  "helperDigest",
  "locatorObservationDigest",
  "physicalDestinationIdentityDigest",
  "reason",
  "stateRootDigest",
] as const);

export const externalSchemaFields = Object.freeze({
  physicalIdentity: physicalIdentityFields,
  locatorObservation: locatorObservationFields,
  absenceObservation: absenceObservationFields,
});
export const externalSchemaVersions = Object.freeze([
  "external-destination-absence-observation/v1",
  "physical-destination-identity/v1",
  "physical-destination-locator-observation-receipt/v1",
] as const);

const operatingSystems = Object.freeze(["DARWIN", "LINUX", "WINDOWS"] as const);
const leafIdentityKinds = Object.freeze([
  "EXISTING_DIRECTORY_ENTRY",
  "ABSENT_DIRECTORY_ENTRY",
] as const);
const observationDispositions = Object.freeze(["ADMITTED", "UNSUPPORTED", "UNKNOWN"] as const);
const absenceReasons = Object.freeze([
  "RUNTIME_AUTHORITY_ABSENT",
  "DESTINATION_STATE_ROOT_ABSENT",
] as const);
const externalToken = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, names: readonly string[]): string[] {
  return names.filter((name) => !isSha256(record[name])).map((name) => `${name}:invalid`);
}

function nullableDigestIssues(record: ContractRecord, names: readonly string[]): string[] {
  return names
    .filter((name) => record[name] !== null && !isSha256(record[name]))
    .map((name) => `${name}:invalid`);
}

export function parsePhysicalDestinationIdentity(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, physicalIdentityFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = digestIssues(record, [
    "ancestorObjectIdentityDigest",
    "filesystemIdentityDigest",
    "hostCustodyNamespaceDigest",
    "physicalVolumeIdentityDigest",
  ]);
  if (record.schemaVersion !== "physical-destination-identity/v1")
    issues.push("schemaVersion:mismatch");
  if (!operatingSystems.includes(record.operatingSystem as PhysicalOperatingSystem))
    issues.push("operatingSystem:invalid");
  if (!leafIdentityKinds.includes(record.leafIdentityKind as (typeof leafIdentityKinds)[number]))
    issues.push("leafIdentityKind:invalid");
  if (operatingSystems.includes(record.operatingSystem as PhysicalOperatingSystem)) {
    const leaf = decodeCanonicalPhysicalLeaf(
      record.canonicalPhysicalLeafBytes,
      record.operatingSystem as PhysicalOperatingSystem,
    );
    if (!leaf.ok) issues.push(...leaf.issues);
  }
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function computePhysicalDestinationIdentityDigest(input: unknown): string {
  const parsed = parsePhysicalDestinationIdentity(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  const leaf = decodeCanonicalPhysicalLeaf(
    record.canonicalPhysicalLeafBytes,
    record.operatingSystem as PhysicalOperatingSystem,
  );
  if (!leaf.ok) throw new TypeError(leaf.issues.join(","));
  return framedDigest("physical-destination-identity/v1", [
    frame.raw32(String(record.hostCustodyNamespaceDigest)),
    frame.text(String(record.operatingSystem)),
    frame.raw32(String(record.physicalVolumeIdentityDigest)),
    frame.raw32(String(record.filesystemIdentityDigest)),
    frame.raw32(String(record.ancestorObjectIdentityDigest)),
    frame.text(String(record.leafIdentityKind)),
    frame.fixed(Buffer.from(leaf.bytes).toString("hex")),
    frame.canonical(record),
  ]);
}

export function parsePhysicalLocatorObservation(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, locatorObservationFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const nullableNames = [
    "custodyInstanceDigest",
    "custodyReceiptDigest",
    "nativeIdentityReadbackDigest",
    "resolvedLocatorReadbackDigest",
  ] as const;
  const issues = [
    ...digestIssues(record, [
      "helperDigest",
      "logicalLocatorDigest",
      "physicalDestinationIdentityDigest",
    ]),
    ...nullableDigestIssues(record, nullableNames),
  ];
  if (record.schemaVersion !== "physical-destination-locator-observation-receipt/v1")
    issues.push("schemaVersion:mismatch");
  if (
    !observationDispositions.includes(
      record.disposition as (typeof observationDispositions)[number],
    )
  )
    issues.push("disposition:invalid");
  if (
    record.caseComparisonProfile !== "CASE_INSENSITIVE_LOWERCASE" &&
    record.caseComparisonProfile !== "CASE_SENSITIVE"
  )
    issues.push("caseComparisonProfile:invalid");
  if (record.unicodeNormalizationProfile !== "NFC" && record.unicodeNormalizationProfile !== "NFD")
    issues.push("unicodeNormalizationProfile:invalid");
  if (typeof record.helperVersion !== "string" || !externalToken.test(record.helperVersion))
    issues.push("helperVersion:invalid");
  for (const name of ["observedAt", "validFrom"] as const)
    if (!isCanonicalTimestamp(record[name])) issues.push(`${name}:invalid`);
  if (record.validUntil !== null && !isCanonicalTimestamp(record.validUntil))
    issues.push("validUntil:invalid");
  if (
    isCanonicalTimestamp(record.validFrom) &&
    isCanonicalTimestamp(record.observedAt) &&
    String(record.validFrom) > String(record.observedAt)
  )
    issues.push("validFrom:after-observation");
  if (
    isCanonicalTimestamp(record.observedAt) &&
    isCanonicalTimestamp(record.validUntil) &&
    String(record.validUntil) <= String(record.observedAt)
  )
    issues.push("validUntil:not-after-observation");
  const nonNullCount = nullableNames.filter((name) => record[name] !== null).length;
  if (record.disposition === "ADMITTED" && nonNullCount !== nullableNames.length)
    issues.push("disposition:admitted-readbacks-required");
  if (record.disposition !== "ADMITTED" && nonNullCount !== 0)
    issues.push("disposition:non-admitted-readbacks-forbidden");
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function computePhysicalLocatorObservationDigest(input: unknown): string {
  const parsed = parsePhysicalLocatorObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("physical-destination-locator-observation-receipt/v1", [
    frame.raw32(String(record.physicalDestinationIdentityDigest)),
    frame.raw32(String(record.helperDigest)),
    frame.text(String(record.helperVersion)),
    frame.raw32(String(record.logicalLocatorDigest)),
    frame.nullableRaw32(record.resolvedLocatorReadbackDigest as string | null),
    frame.text(String(record.caseComparisonProfile)),
    frame.text(String(record.unicodeNormalizationProfile)),
    frame.nullableRaw32(record.custodyInstanceDigest as string | null),
    frame.nullableRaw32(record.custodyReceiptDigest as string | null),
    frame.nullableRaw32(record.nativeIdentityReadbackDigest as string | null),
    frame.text(String(record.disposition)),
    frame.canonical(record),
  ]);
}

export function parseExternalDestinationAbsenceObservation(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, absenceObservationFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = digestIssues(record, [
    "custodyInstanceDigest",
    "destinationDigest",
    "helperDigest",
    "locatorObservationDigest",
    "physicalDestinationIdentityDigest",
    "stateRootDigest",
  ]);
  if (record.schemaVersion !== "external-destination-absence-observation/v1")
    issues.push("schemaVersion:mismatch");
  if (!absenceReasons.includes(record.reason as (typeof absenceReasons)[number]))
    issues.push("reason:invalid");
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? { ok: true, value: record } : invalid(...issues);
}

export function computeExternalDestinationAbsenceObservationDigest(input: unknown): string {
  const parsed = parseExternalDestinationAbsenceObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("external-destination-absence-observation/v1", [
    frame.raw32(String(record.physicalDestinationIdentityDigest)),
    frame.raw32(String(record.destinationDigest)),
    frame.raw32(String(record.stateRootDigest)),
    frame.text(String(record.reason)),
    frame.raw32(String(record.locatorObservationDigest)),
    frame.raw32(String(record.helperDigest)),
    frame.raw32(String(record.custodyInstanceDigest)),
    frame.text(String(record.observedAt)),
    frame.canonical(record),
  ]);
}

function expectedProfiles(operatingSystem: PhysicalOperatingSystem): readonly [string, string] {
  if (operatingSystem === "DARWIN") return ["CASE_INSENSITIVE_LOWERCASE", "NFD"];
  if (operatingSystem === "WINDOWS") return ["CASE_INSENSITIVE_LOWERCASE", "NFC"];
  return ["CASE_SENSITIVE", "NFC"];
}

export function validatePhysicalObservationBinding(
  identityInput: unknown,
  observationInput: unknown,
  effectiveAt: unknown,
  expectedInput: unknown,
): readonly string[] {
  const identity = parsePhysicalDestinationIdentity(identityInput);
  const observation = parsePhysicalLocatorObservation(observationInput);
  const expected = snapshotClosedRecord(expectedInput, physicalObservationExpectationFields);
  if (!identity.ok || !observation.ok || !expected.ok)
    return Object.freeze([
      ...(!identity.ok ? identity.issues.map((issue) => `identity:${issue}`) : []),
      ...(!observation.ok ? observation.issues.map((issue) => `observation:${issue}`) : []),
      ...(!expected.ok ? expected.issues.map((issue) => `expected:${issue}`) : []),
    ]);
  const issues: string[] = [];
  for (const name of physicalObservationExpectationFields)
    if (!isSha256(expected.value[name])) issues.push(`expected:${name}:invalid`);
  const physicalDigest = computePhysicalDestinationIdentityDigest(identity.value);
  const observationDigest = computePhysicalLocatorObservationDigest(observation.value);
  if (observation.value.physicalDestinationIdentityDigest !== physicalDigest)
    issues.push("physicalDestinationIdentityDigest:mismatch");
  if (expected.value.physicalDestinationIdentityDigest !== physicalDigest)
    issues.push("expected:physicalDestinationIdentityDigest:mismatch");
  if (expected.value.locatorObservationDigest !== observationDigest)
    issues.push("expected:locatorObservationDigest:mismatch");
  const [caseProfile, unicodeProfile] = expectedProfiles(
    identity.value.operatingSystem as PhysicalOperatingSystem,
  );
  if (observation.value.caseComparisonProfile !== caseProfile)
    issues.push("caseComparisonProfile:os-mismatch");
  if (observation.value.unicodeNormalizationProfile !== unicodeProfile)
    issues.push("unicodeNormalizationProfile:os-mismatch");
  if (observation.value.disposition !== "ADMITTED") issues.push("disposition:not-admitted");
  if (typeof effectiveAt !== "string" || !isCanonicalTimestamp(effectiveAt))
    issues.push("effectiveAt:invalid");
  else {
    if (effectiveAt < String(observation.value.validFrom))
      issues.push("effectiveAt:before-validity");
    if (
      observation.value.validUntil !== null &&
      effectiveAt >= String(observation.value.validUntil)
    )
      issues.push("effectiveAt:after-validity");
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function validateExternalAbsenceBinding(
  identityInput: unknown,
  observationInput: unknown,
  absenceInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const identity = parsePhysicalDestinationIdentity(identityInput);
  const observation = parsePhysicalLocatorObservation(observationInput);
  const absence = parseExternalDestinationAbsenceObservation(absenceInput);
  const expected = snapshotClosedRecord(expectedInput, absenceExpectationFields);
  if (!identity.ok || !observation.ok || !absence.ok || !expected.ok)
    return Object.freeze([
      ...(!identity.ok ? identity.issues.map((issue) => `identity:${issue}`) : []),
      ...(!observation.ok ? observation.issues.map((issue) => `observation:${issue}`) : []),
      ...(!absence.ok ? absence.issues.map((issue) => `absence:${issue}`) : []),
      ...(!expected.ok ? expected.issues.map((issue) => `expected:${issue}`) : []),
    ]);
  const expectedIssues = digestIssues(expected.value, [
    "custodyInstanceDigest",
    "destinationDigest",
    "helperDigest",
    "locatorObservationDigest",
    "physicalDestinationIdentityDigest",
    "stateRootDigest",
  ]).map((issue) => `expected:${issue}`);
  if (!absenceReasons.includes(expected.value.reason as (typeof absenceReasons)[number]))
    expectedIssues.push("expected:reason:invalid");
  const issues = [
    ...validatePhysicalObservationBinding(
      identity.value,
      observation.value,
      String(absence.value.observedAt),
      {
        locatorObservationDigest: expected.value.locatorObservationDigest,
        physicalDestinationIdentityDigest: expected.value.physicalDestinationIdentityDigest,
      },
    ),
  ];
  const physicalDigest = computePhysicalDestinationIdentityDigest(identity.value);
  const destinationDigest = computeBootstrapDestinationIdentityDigest(physicalDigest);
  const observationDigest = computePhysicalLocatorObservationDigest(observation.value);
  for (const [field, actual, selected] of [
    ["destinationDigest", destinationDigest, expected.value.destinationDigest],
    ["helperDigest", observation.value.helperDigest, expected.value.helperDigest],
    [
      "custodyInstanceDigest",
      observation.value.custodyInstanceDigest,
      expected.value.custodyInstanceDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`expected:${field}:mismatch`);
  for (const [field, expectedValue] of [
    ["physicalDestinationIdentityDigest", expected.value.physicalDestinationIdentityDigest],
    ["destinationDigest", expected.value.destinationDigest],
    ["locatorObservationDigest", expected.value.locatorObservationDigest],
    ["helperDigest", expected.value.helperDigest],
    ["custodyInstanceDigest", expected.value.custodyInstanceDigest],
    ["stateRootDigest", expected.value.stateRootDigest],
    ["reason", expected.value.reason],
  ] as const)
    if (absence.value[field] !== expectedValue) issues.push(`${field}:mismatch`);
  if (absence.value.physicalDestinationIdentityDigest !== physicalDigest)
    issues.push("physicalDestinationIdentityDigest:derived-mismatch");
  if (absence.value.destinationDigest !== destinationDigest)
    issues.push("destinationDigest:derived-mismatch");
  if (absence.value.locatorObservationDigest !== observationDigest)
    issues.push("locatorObservationDigest:derived-mismatch");
  if (String(absence.value.observedAt) < String(observation.value.observedAt))
    issues.push("observedAt:before-locator-observation");
  return Object.freeze([...new Set([...issues, ...expectedIssues])].sort());
}

export function parseExternalContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "physical-destination-identity/v1")
    return parsePhysicalDestinationIdentity(input);
  if (expectedSchemaVersion === "physical-destination-locator-observation-receipt/v1")
    return parsePhysicalLocatorObservation(input);
  if (expectedSchemaVersion === "external-destination-absence-observation/v1")
    return parseExternalDestinationAbsenceObservation(input);
  return undefined;
}

function sha256(value: string, name: string): string {
  if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function uuidV7(value: string, name: string): string {
  if (!isUuidV7(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function priorBucket(priorTipDigest: string | null): string {
  return priorTipDigest === null ? "genesis" : sha256(priorTipDigest, "priorTipDigest");
}

export function computeBootstrapDestinationIdentityDigest(
  physicalDestinationIdentityDigest: string,
): string {
  return framedDigest("bootstrap-destination-identity/v1", [
    frame.raw32(sha256(physicalDestinationIdentityDigest, "physicalDestinationIdentityDigest")),
  ]);
}

export const externalAuthorityPaths = Object.freeze({
  physicalIdentity: (physicalIdentityDigest: string): string =>
    `state-mutation-destination-identities/${sha256(physicalIdentityDigest, "physicalIdentityDigest")}/identity.json`,
  physicalObservation: (physicalIdentityDigest: string, observationDigest: string): string =>
    `state-mutation-destination-identities/${sha256(physicalIdentityDigest, "physicalIdentityDigest")}/observations/${sha256(observationDigest, "observationDigest")}.json`,
  physicalAbsenceObservation: (physicalIdentityDigest: string, absenceDigest: string): string =>
    `state-mutation-destination-identities/${sha256(physicalIdentityDigest, "physicalIdentityDigest")}/absence-observations/${sha256(absenceDigest, "absenceDigest")}.json`,
  destinationOwnerRoot: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}`,
  destinationOwnerCurrent: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/current.json`,
  destinationOwnerLock: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/destination-owner.lock`,
  destinationOwnerValue: (destinationDigest: string, mutationId: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/values/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerProposal: (
    destinationDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/proposals/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerConflict: (
    destinationDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/conflicts/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerTeardownArchive: (destinationDigest: string, ownerTipDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/teardown-archives/${sha256(ownerTipDigest, "ownerTipDigest")}.json`,
  destinationSuccessorReviewCore: (
    destinationDigest: string,
    retiredTipDigest: string,
    reviewCoreDigest: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/successor-review-cores/${sha256(retiredTipDigest, "retiredTipDigest")}/${sha256(reviewCoreDigest, "reviewCoreDigest")}.json`,
  destinationSuccessorPostSelectionReceipt: (
    destinationDigest: string,
    successorTipDigest: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/successor-review-post-selection-receipts/${sha256(successorTipDigest, "successorTipDigest")}.json`,
  bootstrapAnchor: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/anchor.json`,
  bootstrapAnchorCurrent: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/current.json`,
  bootstrapAnchorLock: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/anchor.lock`,
  bootstrapAnchorValue: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/values/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorProposal: (
    installationId: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/proposals/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorConflict: (
    installationId: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/conflicts/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorUseIntent: (installationId: string, transactionId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/use-intents/${uuidV7(transactionId, "transactionId")}.json`,
  bootstrapAnchorConsumptionReceipt: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/consumption-receipts/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorTeardownReceipt: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/teardown-receipts/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorLifecycleArchive: (installationId: string, tipDigest: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/lifecycle-archives/${sha256(tipDigest, "tipDigest")}.json`,
  bootstrapGenesisCore: (transactionId: string): string =>
    `installation/bootstrap/state-mutation-authority-genesis/${uuidV7(transactionId, "transactionId")}/core.json`,
  bootstrapGenesisPostSelectionReceipt: (transactionId: string): string =>
    `installation/bootstrap/state-mutation-authority-genesis/${uuidV7(transactionId, "transactionId")}/post-selection-receipt.json`,
});

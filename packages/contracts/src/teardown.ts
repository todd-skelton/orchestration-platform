import {
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  parseBootstrapAnchor,
  parseBootstrapAnchorLifecycleValue,
  parseBootstrapAnchorProposal,
  parseBootstrapAnchorTip,
} from "./anchor.js";
import {
  computeExternalDestinationAbsenceObservationDigest,
  parseExternalDestinationAbsenceObservation,
  parsePhysicalDestinationIdentity,
  parsePhysicalLocatorObservation,
  validateExternalAbsenceBinding,
} from "./external.js";
import {
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
} from "./owner.js";
import {
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const archiveFields = Object.freeze([
  "anchorDigest",
  "archivedAt",
  "archivedReceiptDigest",
  "archivedTipDigest",
  "archivedValueDigest",
  "destinationAbsenceDigest",
  "lifecycle",
  "schemaVersion",
] as const);
const receiptFields = Object.freeze([
  "anchorDigest",
  "destinationDigest",
  "externalArchiveDigest",
  "priorAnchorReceiptDigest",
  "priorAnchorTipDigest",
  "priorAnchorValueDigest",
  "processCustodyProofDigest",
  "retirementTransition",
  "schemaVersion",
  "selectedOwnerReceiptDigest",
  "selectedOwnerTipDigest",
  "selectedOwnerValueDigest",
  "teardownEvidenceDigest",
] as const);
const expectationFields = Object.freeze([
  "anchorDigest",
  "destinationAbsenceDigest",
  "destinationDigest",
  "priorAnchorReceiptDigest",
  "priorAnchorTipDigest",
  "priorAnchorValueDigest",
  "processCustodyProofDigest",
  "retirementTransition",
  "selectedOwnerReceiptDigest",
  "selectedOwnerTipDigest",
  "selectedOwnerValueDigest",
] as const);

export const bootstrapAnchorTeardownSchemaFields = Object.freeze({
  lifecycleArchive: archiveFields,
  teardownReceipt: receiptFields,
});
export const bootstrapAnchorTeardownSchemaVersions = Object.freeze([
  "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
  "state-mutation-bootstrap-anchor-teardown-receipt/v1",
] as const);

const retirementTransitions = Object.freeze(["RETIRE_UNUSED", "RETIRE_CONSUMED"] as const);
const archivedLifecycles = Object.freeze(["ACTIVE", "CONSUMED"] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !isSha256(record[field])).map((field) => `${field}:invalid`);
}

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function parseBootstrapAnchorLifecycleArchive(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, archiveFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "anchorDigest",
    "archivedReceiptDigest",
    "archivedTipDigest",
    "archivedValueDigest",
    "destinationAbsenceDigest",
  ]);
  if (!isCanonicalTimestamp(parsed.value.archivedAt)) issues.push("archivedAt:invalid");
  if (!archivedLifecycles.includes(parsed.value.lifecycle as (typeof archivedLifecycles)[number]))
    issues.push("lifecycle:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-lifecycle-archive/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorTeardownReceipt(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, receiptFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    receiptFields.filter((field) => field !== "retirementTransition" && field !== "schemaVersion"),
  );
  if (
    !retirementTransitions.includes(
      parsed.value.retirementTransition as (typeof retirementTransitions)[number],
    )
  )
    issues.push("retirementTransition:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-teardown-receipt/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeBootstrapAnchorLifecycleArchiveDigest(input: unknown): string {
  const archive = parsedOrThrow(parseBootstrapAnchorLifecycleArchive, input);
  return framedDigest("state-mutation-bootstrap-anchor-lifecycle-archive/v1", [
    frame.raw32(String(archive.anchorDigest)),
    frame.raw32(String(archive.archivedTipDigest)),
    frame.raw32(String(archive.archivedValueDigest)),
    frame.raw32(String(archive.archivedReceiptDigest)),
    frame.text(String(archive.lifecycle)),
    frame.raw32(String(archive.destinationAbsenceDigest)),
    frame.canonical(archive),
  ]);
}

export function computeBootstrapAnchorTeardownReceiptDigest(input: unknown): string {
  const receipt = parsedOrThrow(parseBootstrapAnchorTeardownReceipt, input);
  return framedDigest("bootstrap-anchor-teardown-receipt/v1", [
    frame.raw32(String(receipt.anchorDigest)),
    frame.raw32(String(receipt.priorAnchorTipDigest)),
    frame.raw32(String(receipt.priorAnchorValueDigest)),
    frame.raw32(String(receipt.priorAnchorReceiptDigest)),
    frame.text(String(receipt.retirementTransition)),
    frame.raw32(String(receipt.destinationDigest)),
    frame.raw32(String(receipt.selectedOwnerTipDigest)),
    frame.raw32(String(receipt.selectedOwnerValueDigest)),
    frame.raw32(String(receipt.selectedOwnerReceiptDigest)),
    frame.raw32(String(receipt.teardownEvidenceDigest)),
    frame.raw32(String(receipt.processCustodyProofDigest)),
    frame.raw32(String(receipt.externalArchiveDigest)),
    frame.canonical(receipt),
  ]);
}

export function computeBootstrapAnchorTeardownId(input: unknown): string {
  const receipt = parsedOrThrow(parseBootstrapAnchorTeardownReceipt, input);
  return framedDigest("bootstrap-anchor-teardown-id/v1", [
    frame.raw32(String(receipt.anchorDigest)),
    frame.raw32(String(receipt.priorAnchorTipDigest)),
    frame.text(String(receipt.retirementTransition)),
    frame.raw32(String(receipt.teardownEvidenceDigest)),
    frame.raw32(String(receipt.externalArchiveDigest)),
  ]);
}

export function validateBootstrapAnchorTeardownBinding(
  anchorInput: unknown,
  priorAnchorTipInput: unknown,
  priorAnchorValueInput: unknown,
  priorAnchorProposalInput: unknown,
  selectedOwnerTipInput: unknown,
  selectedOwnerValueInput: unknown,
  selectedOwnerProposalInput: unknown,
  physicalIdentityInput: unknown,
  locatorObservationInput: unknown,
  absenceInput: unknown,
  archiveInput: unknown,
  receiptInput: unknown,
  absenceExpectedInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const anchor = parseBootstrapAnchor(anchorInput);
  const priorAnchorTip = parseBootstrapAnchorTip(priorAnchorTipInput);
  const priorAnchorValue = parseBootstrapAnchorLifecycleValue(priorAnchorValueInput);
  const priorAnchorProposal = parseBootstrapAnchorProposal(priorAnchorProposalInput);
  const selectedOwnerTip = parseDestinationOwnerTip(selectedOwnerTipInput);
  const selectedOwnerValue = parseDestinationOwnerValue(selectedOwnerValueInput);
  const selectedOwnerProposal = parseDestinationOwnerProposal(selectedOwnerProposalInput);
  const identity = parsePhysicalDestinationIdentity(physicalIdentityInput);
  const observation = parsePhysicalLocatorObservation(locatorObservationInput);
  const absence = parseExternalDestinationAbsenceObservation(absenceInput);
  const archive = parseBootstrapAnchorLifecycleArchive(archiveInput);
  const receipt = parseBootstrapAnchorTeardownReceipt(receiptInput);
  const expected = snapshotClosedRecord(expectedInput, expectationFields);
  const issues = [
    ...prefixed("anchor", anchor),
    ...prefixed("priorAnchorTip", priorAnchorTip),
    ...prefixed("priorAnchorValue", priorAnchorValue),
    ...prefixed("priorAnchorProposal", priorAnchorProposal),
    ...prefixed("selectedOwnerTip", selectedOwnerTip),
    ...prefixed("selectedOwnerValue", selectedOwnerValue),
    ...prefixed("selectedOwnerProposal", selectedOwnerProposal),
    ...prefixed("identity", identity),
    ...prefixed("observation", observation),
    ...prefixed("absence", absence),
    ...prefixed("archive", archive),
    ...prefixed("receipt", receipt),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
  ];
  if (
    !anchor.ok ||
    !priorAnchorTip.ok ||
    !priorAnchorValue.ok ||
    !priorAnchorProposal.ok ||
    !selectedOwnerTip.ok ||
    !selectedOwnerValue.ok ||
    !selectedOwnerProposal.ok ||
    !identity.ok ||
    !observation.ok ||
    !absence.ok ||
    !archive.ok ||
    !receipt.ok ||
    !expected.ok
  )
    return Object.freeze([...new Set(issues)].sort());

  for (const field of expectationFields.filter((field) => field !== "retirementTransition"))
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (
    !retirementTransitions.includes(
      expected.value.retirementTransition as (typeof retirementTransitions)[number],
    )
  )
    issues.push("expected:retirementTransition:invalid");
  if (issues.length > 0) return Object.freeze([...new Set(issues)].sort());

  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(anchor.value);
  } catch {
    issues.push("anchor:globalBootstrapIdentityDigest:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  }
  const priorAnchorTipDigest = computeBootstrapAnchorTipDigest(priorAnchorTip.value);
  const priorAnchorValueDigest = computeBootstrapAnchorValueDigest(priorAnchorValue.value);
  const priorAnchorReceiptDigest = computeBootstrapAnchorProposalDigest(priorAnchorProposal.value);
  const selectedOwnerTipDigest = computeDestinationOwnerTipDigest(selectedOwnerTip.value);
  const selectedOwnerValueDigest = computeDestinationOwnerValueDigest(selectedOwnerValue.value);
  const selectedOwnerReceiptDigest = computeDestinationOwnerProposalDigest(
    selectedOwnerProposal.value,
  );
  const destinationAbsenceDigest = computeExternalDestinationAbsenceObservationDigest(
    absence.value,
  );
  const externalArchiveDigest = computeBootstrapAnchorLifecycleArchiveDigest(archive.value);
  const transition = String(expected.value.retirementTransition);
  const lifecycle = transition === "RETIRE_UNUSED" ? "ACTIVE" : "CONSUMED";

  issues.push(
    ...validateExternalAbsenceBinding(
      identity.value,
      observation.value,
      absence.value,
      absenceExpectedInput,
    ).map((issue) => `absenceBinding:${issue}`),
  );
  const expectedPairs = [
    ["anchorDigest", anchorDigest],
    ["destinationAbsenceDigest", destinationAbsenceDigest],
    ["destinationDigest", anchor.value.destinationDigest],
    ["priorAnchorReceiptDigest", priorAnchorReceiptDigest],
    ["priorAnchorTipDigest", priorAnchorTipDigest],
    ["priorAnchorValueDigest", priorAnchorValueDigest],
    ["selectedOwnerReceiptDigest", selectedOwnerReceiptDigest],
    ["selectedOwnerTipDigest", selectedOwnerTipDigest],
    ["selectedOwnerValueDigest", selectedOwnerValueDigest],
  ] as const;
  for (const [field, actual] of expectedPairs)
    if (expected.value[field] !== actual) issues.push(`expected:${field}:mismatch`);

  for (const [field, actual, selected] of [
    ["priorAnchorTip.anchorDigest", priorAnchorTip.value.anchorDigest, anchorDigest],
    ["priorAnchorTip.valueDigest", priorAnchorTip.value.valueDigest, priorAnchorValueDigest],
    [
      "priorAnchorTip.proposalReceiptDigest",
      priorAnchorTip.value.proposalReceiptDigest,
      priorAnchorReceiptDigest,
    ],
    ["priorAnchorValue.anchorDigest", priorAnchorValue.value.anchorDigest, anchorDigest],
    ["priorAnchorProposal.anchorDigest", priorAnchorProposal.value.anchorDigest, anchorDigest],
    [
      "priorAnchorProposal.successorValueDigest",
      priorAnchorProposal.value.successorValueDigest,
      priorAnchorValueDigest,
    ],
    [
      "selectedOwnerTip.destinationDigest",
      selectedOwnerTip.value.destinationDigest,
      anchor.value.destinationDigest,
    ],
    ["selectedOwnerTip.valueDigest", selectedOwnerTip.value.valueDigest, selectedOwnerValueDigest],
    [
      "selectedOwnerTip.proposalReceiptDigest",
      selectedOwnerTip.value.proposalReceiptDigest,
      selectedOwnerReceiptDigest,
    ],
    [
      "selectedOwnerValue.destinationDigest",
      selectedOwnerValue.value.destinationDigest,
      anchor.value.destinationDigest,
    ],
    ["selectedOwnerValue.anchorDigest", selectedOwnerValue.value.anchorDigest, anchorDigest],
    [
      "selectedOwnerValue.installationId",
      selectedOwnerValue.value.installationId,
      anchor.value.installationId,
    ],
    [
      "selectedOwnerProposal.destinationDigest",
      selectedOwnerProposal.value.destinationDigest,
      anchor.value.destinationDigest,
    ],
    [
      "selectedOwnerProposal.successorValueDigest",
      selectedOwnerProposal.value.successorValueDigest,
      selectedOwnerValueDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);

  if (
    priorAnchorProposal.value.mutationId !==
    computeBootstrapAnchorMutationId(
      anchor.value,
      priorAnchorProposal.value,
      priorAnchorValue.value,
    )
  )
    issues.push("priorAnchorProposal.mutationId:mismatch");
  if (lifecycle === "ACTIVE") {
    if (
      priorAnchorProposal.value.transition !== "ACTIVATE" ||
      priorAnchorProposal.value.source !== "BOOTSTRAP_CREATE"
    )
      issues.push("priorAnchorProposal.active-branch:mismatch");
    if (
      priorAnchorProposal.value.priorTipDigest !== null ||
      priorAnchorProposal.value.priorValueDigest !== null ||
      priorAnchorProposal.value.priorReceiptDigest !== null
    )
      issues.push("priorAnchorProposal.active-prior:not-null");
    if (priorAnchorValue.value.lifecycleOrdinal !== "0")
      issues.push("priorAnchorValue.lifecycleOrdinal:not-zero");
    if (priorAnchorProposal.value.transitionEvidenceDigest !== anchor.value.bootstrapGrantDigest)
      issues.push("priorAnchorProposal.transitionEvidenceDigest:mismatch");
  } else {
    if (
      priorAnchorProposal.value.transition !== "CONSUME" ||
      priorAnchorProposal.value.source !== "E0_SELECTION"
    )
      issues.push("priorAnchorProposal.consumed-branch:mismatch");
    if (
      priorAnchorProposal.value.transitionEvidenceDigest !==
      priorAnchorValue.value.selectionPostReceiptDigest
    )
      issues.push("priorAnchorProposal.transitionEvidenceDigest:mismatch");
  }

  if (
    selectedOwnerProposal.value.positionDigest !==
    computeDestinationOwnerPositionDigest(String(selectedOwnerProposal.value.destinationDigest))
  )
    issues.push("selectedOwnerProposal.positionDigest:mismatch");
  if (
    selectedOwnerProposal.value.mutationId !==
    computeDestinationOwnerMutationId(selectedOwnerProposal.value, selectedOwnerValue.value)
  )
    issues.push("selectedOwnerProposal.mutationId:mismatch");
  if (lifecycle === "ACTIVE") {
    const genesis = selectedOwnerProposal.value.transition === "ACTIVATE_GENESIS";
    const successor = selectedOwnerProposal.value.transition === "ACTIVATE_SUCCESSOR";
    if (
      (!genesis && !successor) ||
      (genesis && selectedOwnerProposal.value.source !== "BOOTSTRAP_GENESIS") ||
      (successor && selectedOwnerProposal.value.source !== "SUCCESSOR_REVIEW")
    )
      issues.push("selectedOwnerProposal.active-branch:mismatch");
    if (
      successor &&
      selectedOwnerProposal.value.transitionEvidenceDigest !==
        selectedOwnerValue.value.successorReviewCoreDigest
    )
      issues.push("selectedOwnerProposal.transitionEvidenceDigest:mismatch");
  } else {
    if (
      selectedOwnerProposal.value.transition !== "CONSUME" ||
      selectedOwnerProposal.value.source !== "ANCHOR_CONSUMED"
    )
      issues.push("selectedOwnerProposal.consumed-branch:mismatch");
    if (
      selectedOwnerProposal.value.transitionEvidenceDigest !==
      selectedOwnerValue.value.anchorTipDigest
    )
      issues.push("selectedOwnerProposal.transitionEvidenceDigest:mismatch");
  }

  if (priorAnchorValue.value.lifecycle !== lifecycle)
    issues.push("priorAnchorValue.lifecycle:mismatch");
  if (selectedOwnerValue.value.lifecycle !== lifecycle)
    issues.push("selectedOwnerValue.lifecycle:mismatch");
  if (absence.value.reason !== "DESTINATION_STATE_ROOT_ABSENT")
    issues.push("absence.reason:not-destination-state-root-absent");
  if (absence.value.destinationDigest !== anchor.value.destinationDigest)
    issues.push("absence.destinationDigest:mismatch");
  if (archive.value.anchorDigest !== anchorDigest) issues.push("archive.anchorDigest:mismatch");
  if (archive.value.archivedTipDigest !== priorAnchorTipDigest)
    issues.push("archive.archivedTipDigest:mismatch");
  if (archive.value.archivedValueDigest !== priorAnchorValueDigest)
    issues.push("archive.archivedValueDigest:mismatch");
  if (archive.value.archivedReceiptDigest !== priorAnchorReceiptDigest)
    issues.push("archive.archivedReceiptDigest:mismatch");
  if (archive.value.lifecycle !== lifecycle) issues.push("archive.lifecycle:mismatch");
  if (archive.value.destinationAbsenceDigest !== destinationAbsenceDigest)
    issues.push("archive.destinationAbsenceDigest:mismatch");
  if (String(archive.value.archivedAt) < String(absence.value.observedAt))
    issues.push("archive.archivedAt:before-absence");

  for (const [field, actual] of [
    ["anchorDigest", anchorDigest],
    ["destinationDigest", anchor.value.destinationDigest],
    ["externalArchiveDigest", externalArchiveDigest],
    ["priorAnchorReceiptDigest", priorAnchorReceiptDigest],
    ["priorAnchorTipDigest", priorAnchorTipDigest],
    ["priorAnchorValueDigest", priorAnchorValueDigest],
    ["processCustodyProofDigest", expected.value.processCustodyProofDigest],
    ["retirementTransition", transition],
    ["selectedOwnerReceiptDigest", selectedOwnerReceiptDigest],
    ["selectedOwnerTipDigest", selectedOwnerTipDigest],
    ["selectedOwnerValueDigest", selectedOwnerValueDigest],
    ["teardownEvidenceDigest", destinationAbsenceDigest],
  ] as const)
    if (receipt.value[field] !== actual) issues.push(`receipt.${field}:mismatch`);

  return Object.freeze([...new Set(issues)].sort());
}

export function parseBootstrapAnchorTeardownContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-lifecycle-archive/v1")
    return parseBootstrapAnchorLifecycleArchive(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-teardown-receipt/v1")
    return parseBootstrapAnchorTeardownReceipt(input);
  return undefined;
}

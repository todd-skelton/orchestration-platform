import { externalAuthorityPaths } from "./external.js";
import {
  frame,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const valueFields = Object.freeze([
  "anchorDigest",
  "anchorReceiptDigest",
  "anchorTipDigest",
  "anchorValueDigest",
  "destinationDigest",
  "installationId",
  "lifecycle",
  "ownerOrdinal",
  "schemaVersion",
  "successorReviewCoreDigest",
  "teardownArchiveDigest",
] as const);
const proposalFields = Object.freeze([
  "destinationDigest",
  "mutationId",
  "observationDigest",
  "positionDigest",
  "priorReceiptDigest",
  "priorTipDigest",
  "priorValueDigest",
  "proposedAt",
  "schemaVersion",
  "source",
  "successorValueDigest",
  "transition",
  "transitionEvidenceDigest",
] as const);
const tipFields = Object.freeze([
  "destinationDigest",
  "proposalReceiptDigest",
  "schemaVersion",
  "valueDigest",
] as const);
const conflictFields = Object.freeze([
  "conflictAt",
  "destinationDigest",
  "losingProposalReceiptDigest",
  "losingSuccessorValueDigest",
  "mutationId",
  "schemaVersion",
  "winningProposalReceiptDigest",
  "winningTipDigest",
  "winningValueDigest",
] as const);
const archiveFields = Object.freeze([
  "anchorRetiredReceiptDigest",
  "anchorRetiredTipDigest",
  "anchorRetiredValueDigest",
  "destinationDigest",
  "installationId",
  "observationDigest",
  "priorOwnerReceiptDigest",
  "priorOwnerTipDigest",
  "priorOwnerValueDigest",
  "schemaVersion",
  "teardownReceiptDigest",
] as const);
const transitionExpectationFields = Object.freeze([
  "anchorDigest",
  "destinationDigest",
  "installationId",
  "observationDigest",
  "transitionEvidenceDigest",
] as const);

export const destinationOwnerSchemaFields = Object.freeze({
  archive: archiveFields,
  conflict: conflictFields,
  proposal: proposalFields,
  tip: tipFields,
  value: valueFields,
});
export const destinationOwnerSchemaVersions = Object.freeze([
  "state-mutation-destination-owner-cas-proposal/v1",
  "state-mutation-destination-owner-conflict-receipt/v1",
  "state-mutation-destination-owner-current-tip/v1",
  "state-mutation-destination-owner-teardown-archive/v1",
  "state-mutation-destination-owner-value/v1",
] as const);

const lifecycles = Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"] as const);
const transitions = Object.freeze([
  "ACTIVATE_GENESIS",
  "CONSUME",
  "RETIRE_UNUSED",
  "RETIRE_CONSUMED",
  "ACTIVATE_SUCCESSOR",
] as const);
const sources = Object.freeze([
  "BOOTSTRAP_GENESIS",
  "ANCHOR_CONSUMED",
  "ANCHOR_RETIRED",
  "SUCCESSOR_REVIEW",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !isSha256(record[field])).map((field) => `${field}:invalid`);
}

function nullableDigestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields
    .filter((field) => record[field] !== null && !isSha256(record[field]))
    .map((field) => `${field}:invalid`);
}

function nullableGroupIssue(record: ContractRecord, fields: readonly string[]): boolean {
  const count = fields.filter((field) => record[field] !== null).length;
  return count !== 0 && count !== fields.length;
}

export function parseDestinationOwnerValue(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, valueFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const anchorTriple = ["anchorReceiptDigest", "anchorTipDigest", "anchorValueDigest"] as const;
  const issues = [
    ...digestIssues(record, ["anchorDigest", "destinationDigest"]),
    ...nullableDigestIssues(record, [
      ...anchorTriple,
      "successorReviewCoreDigest",
      "teardownArchiveDigest",
    ]),
  ];
  if (record.schemaVersion !== "state-mutation-destination-owner-value/v1")
    issues.push("schemaVersion:mismatch");
  if (!isUuidV7(record.installationId)) issues.push("installationId:invalid");
  if (!isCanonicalDecimal(record.ownerOrdinal)) issues.push("ownerOrdinal:invalid");
  if (!lifecycles.includes(record.lifecycle as (typeof lifecycles)[number]))
    issues.push("lifecycle:invalid");
  if (nullableGroupIssue(record, anchorTriple)) issues.push("anchorTriple:mixed-nullability");
  const anchorCount = anchorTriple.filter((field) => record[field] !== null).length;
  if (record.lifecycle === "ACTIVE") {
    if (anchorCount !== 0) issues.push("lifecycle:active-anchor-triple-forbidden");
    if (record.teardownArchiveDigest !== null) issues.push("lifecycle:active-archive-forbidden");
  }
  if (record.lifecycle === "CONSUMED") {
    if (anchorCount !== anchorTriple.length)
      issues.push("lifecycle:consumed-anchor-triple-required");
    if (record.successorReviewCoreDigest !== null)
      issues.push("lifecycle:consumed-review-forbidden");
    if (record.teardownArchiveDigest !== null) issues.push("lifecycle:consumed-archive-forbidden");
  }
  if (record.lifecycle === "RETIRED") {
    if (anchorCount !== anchorTriple.length)
      issues.push("lifecycle:retired-anchor-triple-required");
    if (record.successorReviewCoreDigest !== null)
      issues.push("lifecycle:retired-review-forbidden");
    if (record.teardownArchiveDigest === null) issues.push("lifecycle:retired-archive-required");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerProposal(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, proposalFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const priorFields = ["priorReceiptDigest", "priorTipDigest", "priorValueDigest"] as const;
  const issues = [
    ...digestIssues(record, [
      "destinationDigest",
      "mutationId",
      "observationDigest",
      "positionDigest",
      "successorValueDigest",
      "transitionEvidenceDigest",
    ]),
    ...nullableDigestIssues(record, priorFields),
  ];
  if (record.schemaVersion !== "state-mutation-destination-owner-cas-proposal/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalTimestamp(record.proposedAt)) issues.push("proposedAt:invalid");
  if (!sources.includes(record.source as (typeof sources)[number])) issues.push("source:invalid");
  if (!transitions.includes(record.transition as (typeof transitions)[number]))
    issues.push("transition:invalid");
  if (nullableGroupIssue(record, priorFields)) issues.push("priorTriple:mixed-nullability");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerTip(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, tipFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "destinationDigest",
    "proposalReceiptDigest",
    "valueDigest",
  ]);
  if (parsed.value.schemaVersion !== "state-mutation-destination-owner-current-tip/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerConflict(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, conflictFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "destinationDigest",
    "losingProposalReceiptDigest",
    "losingSuccessorValueDigest",
    "mutationId",
    "winningProposalReceiptDigest",
    "winningTipDigest",
    "winningValueDigest",
  ]);
  if (parsed.value.schemaVersion !== "state-mutation-destination-owner-conflict-receipt/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalTimestamp(parsed.value.conflictAt)) issues.push("conflictAt:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerTeardownArchive(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, archiveFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "anchorRetiredReceiptDigest",
    "anchorRetiredTipDigest",
    "anchorRetiredValueDigest",
    "destinationDigest",
    "observationDigest",
    "priorOwnerReceiptDigest",
    "priorOwnerTipDigest",
    "priorOwnerValueDigest",
    "teardownReceiptDigest",
  ]);
  if (parsed.value.schemaVersion !== "state-mutation-destination-owner-teardown-archive/v1")
    issues.push("schemaVersion:mismatch");
  if (!isUuidV7(parsed.value.installationId)) issues.push("installationId:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function computeDestinationOwnerValueDigest(input: unknown): string {
  const value = parsedOrThrow(parseDestinationOwnerValue, input);
  return framedDigest("destination-owner-value/v1", [
    frame.raw32(String(value.destinationDigest)),
    frame.boundedDecimal(String(value.ownerOrdinal)),
    frame.text(String(value.lifecycle)),
    frame.text(String(value.installationId)),
    frame.raw32(String(value.anchorDigest)),
    frame.canonical(value),
  ]);
}

export function computeDestinationOwnerProposalDigest(input: unknown): string {
  const proposal = parsedOrThrow(parseDestinationOwnerProposal, input);
  return framedDigest("destination-owner-receipt/v1", [
    frame.raw32(String(proposal.destinationDigest)),
    frame.raw32(String(proposal.mutationId)),
    frame.nullableRaw32(proposal.priorTipDigest as string | null),
    frame.nullableRaw32(proposal.priorValueDigest as string | null),
    frame.nullableRaw32(proposal.priorReceiptDigest as string | null),
    frame.raw32(String(proposal.successorValueDigest)),
    frame.text(String(proposal.transition)),
    frame.raw32(String(proposal.positionDigest)),
    frame.canonical(proposal),
  ]);
}

export function computeDestinationOwnerTipDigest(input: unknown): string {
  const tip = parsedOrThrow(parseDestinationOwnerTip, input);
  return framedDigest("destination-owner-tip/v1", [
    frame.raw32(String(tip.destinationDigest)),
    frame.raw32(String(tip.valueDigest)),
    frame.raw32(String(tip.proposalReceiptDigest)),
    frame.canonical(tip),
  ]);
}

export function computeDestinationOwnerConflictDigest(input: unknown): string {
  const conflict = parsedOrThrow(parseDestinationOwnerConflict, input);
  return framedDigest("destination-owner-conflict/v1", [
    frame.raw32(String(conflict.destinationDigest)),
    frame.raw32(String(conflict.mutationId)),
    frame.raw32(String(conflict.losingProposalReceiptDigest)),
    frame.raw32(String(conflict.losingSuccessorValueDigest)),
    frame.raw32(String(conflict.winningTipDigest)),
    frame.raw32(String(conflict.winningValueDigest)),
    frame.raw32(String(conflict.winningProposalReceiptDigest)),
    frame.canonical(conflict),
  ]);
}

export function computeDestinationOwnerTeardownArchiveDigest(input: unknown): string {
  const archive = parsedOrThrow(parseDestinationOwnerTeardownArchive, input);
  return framedDigest("state-mutation-destination-owner-teardown-archive/v1", [
    frame.raw32(String(archive.destinationDigest)),
    frame.raw32(String(archive.priorOwnerTipDigest)),
    frame.raw32(String(archive.priorOwnerValueDigest)),
    frame.raw32(String(archive.priorOwnerReceiptDigest)),
    frame.text(String(archive.installationId)),
    frame.raw32(String(archive.anchorRetiredTipDigest)),
    frame.raw32(String(archive.anchorRetiredValueDigest)),
    frame.raw32(String(archive.anchorRetiredReceiptDigest)),
    frame.raw32(String(archive.teardownReceiptDigest)),
    frame.raw32(String(archive.observationDigest)),
    frame.canonical(archive),
  ]);
}

export function computeDestinationOwnerPositionDigest(destinationDigest: string): string {
  if (!isSha256(destinationDigest)) throw new TypeError("destinationDigest:invalid");
  return framedDigest("destination-owner-position/v1", [
    frame.raw32(destinationDigest),
    frame.text(externalAuthorityPaths.destinationOwnerCurrent(destinationDigest)),
  ]);
}

export function computeDestinationOwnerMutationId(
  proposalInput: unknown,
  successorValueInput: unknown,
): string {
  const proposal = parsedOrThrow(parseDestinationOwnerProposal, proposalInput);
  const successor = parsedOrThrow(parseDestinationOwnerValue, successorValueInput);
  return framedDigest("destination-owner-mutation-id/v1", [
    frame.raw32(String(proposal.destinationDigest)),
    frame.text(externalAuthorityPaths.destinationOwnerCurrent(String(proposal.destinationDigest))),
    frame.nullableRaw32(proposal.priorTipDigest as string | null),
    frame.nullableRaw32(proposal.priorValueDigest as string | null),
    frame.nullableRaw32(proposal.priorReceiptDigest as string | null),
    frame.boundedDecimal(String(successor.ownerOrdinal)),
    frame.text(String(proposal.transition)),
    frame.raw32(String(proposal.successorValueDigest)),
    frame.text(String(successor.installationId)),
    frame.raw32(String(successor.anchorDigest)),
    frame.text(String(proposal.source)),
    frame.raw32(String(proposal.transitionEvidenceDigest)),
  ]);
}

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

export function validateDestinationOwnerMutationBinding(
  proposalInput: unknown,
  successorValueInput: unknown,
  priorTipInput: unknown,
  priorValueInput: unknown,
  priorProposalInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const proposal = parseDestinationOwnerProposal(proposalInput);
  const successor = parseDestinationOwnerValue(successorValueInput);
  const expected = snapshotClosedRecord(expectedInput, transitionExpectationFields);
  const priorInputs = [priorTipInput, priorValueInput, priorProposalInput] as const;
  const priorNullCount = priorInputs.filter((value) => value === null).length;
  const priorTip = priorTipInput === null ? undefined : parseDestinationOwnerTip(priorTipInput);
  const priorValue =
    priorValueInput === null ? undefined : parseDestinationOwnerValue(priorValueInput);
  const priorProposal =
    priorProposalInput === null ? undefined : parseDestinationOwnerProposal(priorProposalInput);
  const issues = [
    ...prefixed("proposal", proposal),
    ...prefixed("successor", successor),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
    ...(priorTip ? prefixed("priorTip", priorTip) : []),
    ...(priorValue ? prefixed("priorValue", priorValue) : []),
    ...(priorProposal ? prefixed("priorProposal", priorProposal) : []),
  ];
  if (priorNullCount !== 0 && priorNullCount !== priorInputs.length)
    issues.push("priorInputs:mixed-nullability");
  if (
    !proposal.ok ||
    !successor.ok ||
    !expected.ok ||
    issues.length > 0 ||
    (priorNullCount === 0 && (!priorTip?.ok || !priorValue?.ok || !priorProposal?.ok))
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of [
    "anchorDigest",
    "destinationDigest",
    "observationDigest",
    "transitionEvidenceDigest",
  ])
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (!isUuidV7(expected.value.installationId)) issues.push("expected:installationId:invalid");
  const p = proposal.value;
  const s = successor.value;
  const successorDigest = computeDestinationOwnerValueDigest(s);
  for (const [field, actual, selected] of [
    ["destinationDigest", p.destinationDigest, expected.value.destinationDigest],
    ["observationDigest", p.observationDigest, expected.value.observationDigest],
    [
      "transitionEvidenceDigest",
      p.transitionEvidenceDigest,
      expected.value.transitionEvidenceDigest,
    ],
    ["successor.destinationDigest", s.destinationDigest, expected.value.destinationDigest],
    ["successor.installationId", s.installationId, expected.value.installationId],
    ["successor.anchorDigest", s.anchorDigest, expected.value.anchorDigest],
    ["successorValueDigest", p.successorValueDigest, successorDigest],
    [
      "positionDigest",
      p.positionDigest,
      computeDestinationOwnerPositionDigest(String(p.destinationDigest)),
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (p.mutationId !== computeDestinationOwnerMutationId(p, s)) issues.push("mutationId:mismatch");

  if (priorNullCount === priorInputs.length) {
    for (const field of ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"])
      if (p[field] !== null) issues.push(`${field}:genesis-non-null`);
    if (p.transition !== "ACTIVATE_GENESIS") issues.push("transition:not-genesis");
    if (p.source !== "BOOTSTRAP_GENESIS") issues.push("source:not-bootstrap-genesis");
    if (s.ownerOrdinal !== "0") issues.push("ownerOrdinal:not-zero");
    if (s.lifecycle !== "ACTIVE") issues.push("successor:lifecycle-not-active");
    if (s.successorReviewCoreDigest !== null) issues.push("successor:genesis-review-forbidden");
  } else {
    const pt = parsedOrThrow(parseDestinationOwnerTip, priorTipInput);
    const pv = parsedOrThrow(parseDestinationOwnerValue, priorValueInput);
    const pp = parsedOrThrow(parseDestinationOwnerProposal, priorProposalInput);
    const priorTipDigest = computeDestinationOwnerTipDigest(pt);
    const priorValueDigest = computeDestinationOwnerValueDigest(pv);
    const priorReceiptDigest = computeDestinationOwnerProposalDigest(pp);
    for (const [field, actual, selected] of [
      ["priorTipDigest", p.priorTipDigest, priorTipDigest],
      ["priorValueDigest", p.priorValueDigest, priorValueDigest],
      ["priorReceiptDigest", p.priorReceiptDigest, priorReceiptDigest],
      ["priorTip.valueDigest", pt.valueDigest, priorValueDigest],
      ["priorTip.proposalReceiptDigest", pt.proposalReceiptDigest, priorReceiptDigest],
      ["priorProposal.successorValueDigest", pp.successorValueDigest, priorValueDigest],
      [
        "priorProposal.positionDigest",
        pp.positionDigest,
        computeDestinationOwnerPositionDigest(String(pp.destinationDigest)),
      ],
      ["priorProposal.mutationId", pp.mutationId, computeDestinationOwnerMutationId(pp, pv)],
      ["prior.destinationDigest", pv.destinationDigest, p.destinationDigest],
      ["priorTip.destinationDigest", pt.destinationDigest, p.destinationDigest],
      ["priorProposal.destinationDigest", pp.destinationDigest, p.destinationDigest],
    ] as const)
      if (actual !== selected) issues.push(`${field}:mismatch`);
    try {
      if (s.ownerOrdinal !== incrementCanonicalDecimal(String(pv.ownerOrdinal)))
        issues.push("ownerOrdinal:not-successor");
    } catch {
      issues.push("ownerOrdinal:overflow");
    }
    const sameIdentity =
      s.installationId === pv.installationId && s.anchorDigest === pv.anchorDigest;
    if (p.transition === "CONSUME") {
      if (p.source !== "ANCHOR_CONSUMED") issues.push("source:not-anchor-consumed");
      if (pv.lifecycle !== "ACTIVE" || s.lifecycle !== "CONSUMED")
        issues.push("transition:consume-lifecycle");
      if (!sameIdentity) issues.push("transition:consume-identity");
      if (p.transitionEvidenceDigest !== s.anchorTipDigest)
        issues.push("transition:consume-evidence");
    } else if (p.transition === "RETIRE_UNUSED" || p.transition === "RETIRE_CONSUMED") {
      if (p.source !== "ANCHOR_RETIRED") issues.push("source:not-anchor-retired");
      const expectedPrior = p.transition === "RETIRE_UNUSED" ? "ACTIVE" : "CONSUMED";
      if (pv.lifecycle !== expectedPrior || s.lifecycle !== "RETIRED")
        issues.push("transition:retire-lifecycle");
      if (!sameIdentity) issues.push("transition:retire-identity");
      if (p.transitionEvidenceDigest !== s.teardownArchiveDigest)
        issues.push("transition:retire-evidence");
    } else if (p.transition === "ACTIVATE_SUCCESSOR") {
      if (p.source !== "SUCCESSOR_REVIEW") issues.push("source:not-successor-review");
      if (pv.lifecycle !== "RETIRED" || s.lifecycle !== "ACTIVE")
        issues.push("transition:successor-lifecycle");
      if (
        sameIdentity ||
        s.installationId === pv.installationId ||
        s.anchorDigest === pv.anchorDigest
      )
        issues.push("transition:successor-identity-not-distinct");
      if (p.transitionEvidenceDigest !== s.successorReviewCoreDigest)
        issues.push("transition:successor-evidence");
    } else {
      issues.push("transition:genesis-with-prior");
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function validateDestinationOwnerConflictBinding(
  conflictInput: unknown,
  losingProposalInput: unknown,
  losingValueInput: unknown,
  winningTipInput: unknown,
  winningProposalInput: unknown,
  winningValueInput: unknown,
): readonly string[] {
  const conflict = parseDestinationOwnerConflict(conflictInput);
  const losingProposal = parseDestinationOwnerProposal(losingProposalInput);
  const losingValue = parseDestinationOwnerValue(losingValueInput);
  const winningTip = parseDestinationOwnerTip(winningTipInput);
  const winningProposal = parseDestinationOwnerProposal(winningProposalInput);
  const winningValue = parseDestinationOwnerValue(winningValueInput);
  const issues = [
    ...prefixed("conflict", conflict),
    ...prefixed("losingProposal", losingProposal),
    ...prefixed("losingValue", losingValue),
    ...prefixed("winningTip", winningTip),
    ...prefixed("winningProposal", winningProposal),
    ...prefixed("winningValue", winningValue),
  ];
  if (
    !conflict.ok ||
    !losingProposal.ok ||
    !losingValue.ok ||
    !winningTip.ok ||
    !winningProposal.ok ||
    !winningValue.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  const c = conflict.value;
  const lp = losingProposal.value;
  const lv = losingValue.value;
  const wt = winningTip.value;
  const wp = winningProposal.value;
  const wv = winningValue.value;
  const losingProposalDigest = computeDestinationOwnerProposalDigest(lp);
  const losingValueDigest = computeDestinationOwnerValueDigest(lv);
  const winningTipDigest = computeDestinationOwnerTipDigest(wt);
  const winningProposalDigest = computeDestinationOwnerProposalDigest(wp);
  const winningValueDigest = computeDestinationOwnerValueDigest(wv);
  for (const [field, actual, selected] of [
    ["destinationDigest", c.destinationDigest, lp.destinationDigest],
    ["losing.destinationDigest", lv.destinationDigest, lp.destinationDigest],
    ["winningTip.destinationDigest", wt.destinationDigest, lp.destinationDigest],
    ["winningProposal.destinationDigest", wp.destinationDigest, lp.destinationDigest],
    ["winningValue.destinationDigest", wv.destinationDigest, lp.destinationDigest],
    ["mutationId", c.mutationId, lp.mutationId],
    ["losingProposalReceiptDigest", c.losingProposalReceiptDigest, losingProposalDigest],
    ["losingSuccessorValueDigest", c.losingSuccessorValueDigest, losingValueDigest],
    ["losingProposal.successorValueDigest", lp.successorValueDigest, losingValueDigest],
    ["winningTipDigest", c.winningTipDigest, winningTipDigest],
    ["winningValueDigest", c.winningValueDigest, winningValueDigest],
    ["winningProposalReceiptDigest", c.winningProposalReceiptDigest, winningProposalDigest],
    ["winningTip.valueDigest", wt.valueDigest, winningValueDigest],
    ["winningTip.proposalReceiptDigest", wt.proposalReceiptDigest, winningProposalDigest],
    ["winningProposal.successorValueDigest", wp.successorValueDigest, winningValueDigest],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (losingProposalDigest === winningProposalDigest && losingValueDigest === winningValueDigest)
    issues.push("conflict:idempotent-not-conflict");
  return Object.freeze([...new Set(issues)].sort());
}

export function parseDestinationOwnerContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "state-mutation-destination-owner-value/v1")
    return parseDestinationOwnerValue(input);
  if (expectedSchemaVersion === "state-mutation-destination-owner-cas-proposal/v1")
    return parseDestinationOwnerProposal(input);
  if (expectedSchemaVersion === "state-mutation-destination-owner-current-tip/v1")
    return parseDestinationOwnerTip(input);
  if (expectedSchemaVersion === "state-mutation-destination-owner-conflict-receipt/v1")
    return parseDestinationOwnerConflict(input);
  if (expectedSchemaVersion === "state-mutation-destination-owner-teardown-archive/v1")
    return parseDestinationOwnerTeardownArchive(input);
  return undefined;
}

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

const anchorFields = Object.freeze([
  "abiDigest",
  "authorityPathInstanceDigest",
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "custodyInstanceDigest",
  "custodyReceiptDigest",
  "destinationDigest",
  "globalBootstrapIdentityDigest",
  "helperDigest",
  "helperProfileDigest",
  "independentReviewReceiptDigest",
  "installationId",
  "lockProfileDigest",
  "projectId",
  "reviewedInstallerDigest",
  "schemaVersion",
  "stateComponentProfileDigest",
  "stateRootDigest",
  "successorReviewCoreDigest",
] as const);
const valueFields = Object.freeze([
  "anchorDigest",
  "bootstrapGenesisCoreDigest",
  "lifecycle",
  "lifecycleOrdinal",
  "schemaVersion",
  "selectedAuthorityPathInstanceDigest",
  "selectedAuthorityReceiptDigest",
  "selectedAuthorityTipDigest",
  "selectedAuthorityValueDigest",
  "selectionPostReceiptDigest",
  "teardownReceiptDigest",
] as const);
const proposalFields = Object.freeze([
  "anchorDigest",
  "mutationId",
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
  "anchorDigest",
  "proposalReceiptDigest",
  "schemaVersion",
  "valueDigest",
] as const);
const conflictFields = Object.freeze([
  "anchorDigest",
  "conflictAt",
  "losingProposalReceiptDigest",
  "losingSuccessorValueDigest",
  "mutationId",
  "schemaVersion",
  "winningProposalReceiptDigest",
  "winningTipDigest",
  "winningValueDigest",
] as const);
const mutationExpectationFields = Object.freeze([
  "anchorDigest",
  "transitionEvidenceDigest",
] as const);
const identityExpectationFields = Object.freeze([
  "globalBootstrapIdentityDigest",
  "successorReviewCoreDigest",
] as const);

export const bootstrapAnchorSchemaFields = Object.freeze({
  anchor: anchorFields,
  conflict: conflictFields,
  proposal: proposalFields,
  tip: tipFields,
  value: valueFields,
});
export const bootstrapAnchorSchemaVersions = Object.freeze([
  "state-mutation-bootstrap-anchor-cas-proposal/v1",
  "state-mutation-bootstrap-anchor-conflict-receipt/v1",
  "state-mutation-bootstrap-anchor-current-tip/v1",
  "state-mutation-bootstrap-anchor-lifecycle-value/v1",
  "state-mutation-bootstrap-anchor/v1",
] as const);

const lifecycles = Object.freeze(["ACTIVE", "CONSUMED", "RETIRED"] as const);
const transitions = Object.freeze([
  "ACTIVATE",
  "CONSUME",
  "RETIRE_UNUSED",
  "RETIRE_CONSUMED",
] as const);
const sources = Object.freeze(["BOOTSTRAP_CREATE", "E0_SELECTION", "TEARDOWN"] as const);
const e0Fields = Object.freeze([
  "bootstrapGenesisCoreDigest",
  "selectedAuthorityPathInstanceDigest",
  "selectedAuthorityReceiptDigest",
  "selectedAuthorityTipDigest",
  "selectedAuthorityValueDigest",
  "selectionPostReceiptDigest",
] as const);
const priorFields = Object.freeze([
  "priorReceiptDigest",
  "priorTipDigest",
  "priorValueDigest",
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

function groupCount(record: ContractRecord, fields: readonly string[]): number {
  return fields.filter((field) => record[field] !== null).length;
}

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

export function parseBootstrapAnchor(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, anchorFields);
  if (!parsed.ok) return parsed;
  const issues = [
    ...digestIssues(parsed.value, [
      "abiDigest",
      "authorityPathInstanceDigest",
      "bootstrapGrantDigest",
      "custodyInstanceDigest",
      "custodyReceiptDigest",
      "destinationDigest",
      "globalBootstrapIdentityDigest",
      "helperDigest",
      "helperProfileDigest",
      "independentReviewReceiptDigest",
      "lockProfileDigest",
      "reviewedInstallerDigest",
      "stateComponentProfileDigest",
      "stateRootDigest",
    ]),
    ...nullableDigestIssues(parsed.value, ["successorReviewCoreDigest"]),
  ];
  for (const field of ["bootstrapTransactionId", "installationId", "projectId"])
    if (!isUuidV7(parsed.value[field])) issues.push(`${field}:invalid`);
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorLifecycleValue(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, valueFields);
  if (!parsed.ok) return parsed;
  const issues = [
    ...digestIssues(parsed.value, ["anchorDigest"]),
    ...nullableDigestIssues(parsed.value, [...e0Fields, "teardownReceiptDigest"]),
  ];
  if (!lifecycles.includes(parsed.value.lifecycle as (typeof lifecycles)[number]))
    issues.push("lifecycle:invalid");
  if (!isCanonicalDecimal(parsed.value.lifecycleOrdinal)) issues.push("lifecycleOrdinal:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-lifecycle-value/v1")
    issues.push("schemaVersion:mismatch");
  const e0Count = groupCount(parsed.value, e0Fields);
  if (e0Count !== 0 && e0Count !== e0Fields.length) issues.push("e0Group:mixed-nullability");
  if (parsed.value.lifecycle === "ACTIVE") {
    if (e0Count !== 0) issues.push("lifecycle:active-e0-forbidden");
    if (parsed.value.teardownReceiptDigest !== null)
      issues.push("lifecycle:active-teardown-forbidden");
  }
  if (parsed.value.lifecycle === "CONSUMED") {
    if (e0Count !== e0Fields.length) issues.push("lifecycle:consumed-e0-required");
    if (parsed.value.teardownReceiptDigest !== null)
      issues.push("lifecycle:consumed-teardown-forbidden");
  }
  if (parsed.value.lifecycle === "RETIRED") {
    if (e0Count !== 0) issues.push("lifecycle:retired-e0-forbidden");
    if (parsed.value.teardownReceiptDigest === null)
      issues.push("lifecycle:retired-teardown-required");
  }
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorProposal(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, proposalFields);
  if (!parsed.ok) return parsed;
  const issues = [
    ...digestIssues(parsed.value, [
      "anchorDigest",
      "mutationId",
      "successorValueDigest",
      "transitionEvidenceDigest",
    ]),
    ...nullableDigestIssues(parsed.value, priorFields),
  ];
  if (groupCount(parsed.value, priorFields) !== 0 && groupCount(parsed.value, priorFields) !== 3)
    issues.push("priorTriple:mixed-nullability");
  if (!isCanonicalTimestamp(parsed.value.proposedAt)) issues.push("proposedAt:invalid");
  if (!sources.includes(parsed.value.source as (typeof sources)[number]))
    issues.push("source:invalid");
  if (!transitions.includes(parsed.value.transition as (typeof transitions)[number]))
    issues.push("transition:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-cas-proposal/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorTip(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, tipFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "anchorDigest",
    "proposalReceiptDigest",
    "valueDigest",
  ]);
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-current-tip/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorConflict(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, conflictFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "anchorDigest",
    "losingProposalReceiptDigest",
    "losingSuccessorValueDigest",
    "mutationId",
    "winningProposalReceiptDigest",
    "winningTipDigest",
    "winningValueDigest",
  ]);
  if (!isCanonicalTimestamp(parsed.value.conflictAt)) issues.push("conflictAt:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-conflict-receipt/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function computeGlobalBootstrapIdentityDigest(input: unknown): string {
  const anchor = parsedOrThrow(parseBootstrapAnchor, input);
  return framedDigest("global-bootstrap-identity/v1", [
    frame.text(String(anchor.installationId)),
    frame.text(String(anchor.projectId)),
    frame.raw32(String(anchor.destinationDigest)),
    frame.raw32(String(anchor.stateRootDigest)),
    frame.raw32(String(anchor.custodyInstanceDigest)),
    frame.text(String(anchor.bootstrapTransactionId)),
    frame.raw32(String(anchor.reviewedInstallerDigest)),
    frame.raw32(String(anchor.independentReviewReceiptDigest)),
    frame.raw32(String(anchor.bootstrapGrantDigest)),
    frame.raw32(String(anchor.authorityPathInstanceDigest)),
    frame.raw32(String(anchor.lockProfileDigest)),
    frame.raw32(String(anchor.helperDigest)),
    frame.raw32(String(anchor.helperProfileDigest)),
    frame.raw32(String(anchor.abiDigest)),
    frame.raw32(String(anchor.stateComponentProfileDigest)),
    frame.raw32(String(anchor.custodyReceiptDigest)),
  ]);
}

export function computeBootstrapAnchorDigest(input: unknown): string {
  const anchor = parsedOrThrow(parseBootstrapAnchor, input);
  const globalIdentity = computeGlobalBootstrapIdentityDigest(anchor);
  if (anchor.globalBootstrapIdentityDigest !== globalIdentity)
    throw new TypeError("globalBootstrapIdentityDigest:mismatch");
  return framedDigest("state-mutation-bootstrap-anchor/v1", [
    frame.raw32(globalIdentity),
    frame.canonical(anchor),
  ]);
}

export function validateBootstrapAnchorIdentityBinding(
  anchorInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const anchor = parseBootstrapAnchor(anchorInput);
  const expected = snapshotClosedRecord(expectedInput, identityExpectationFields);
  const issues = [
    ...prefixed("anchor", anchor),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
  ];
  if (!anchor.ok || !expected.ok) return Object.freeze([...new Set(issues)].sort());
  if (!isSha256(expected.value.globalBootstrapIdentityDigest))
    issues.push("expected:globalBootstrapIdentityDigest:invalid");
  if (
    expected.value.successorReviewCoreDigest !== null &&
    !isSha256(expected.value.successorReviewCoreDigest)
  )
    issues.push("expected:successorReviewCoreDigest:invalid");
  const globalIdentity = computeGlobalBootstrapIdentityDigest(anchor.value);
  if (anchor.value.globalBootstrapIdentityDigest !== globalIdentity)
    issues.push("globalBootstrapIdentityDigest:derived-mismatch");
  if (expected.value.globalBootstrapIdentityDigest !== globalIdentity)
    issues.push("expected:globalBootstrapIdentityDigest:mismatch");
  if (anchor.value.successorReviewCoreDigest !== expected.value.successorReviewCoreDigest)
    issues.push("expected:successorReviewCoreDigest:mismatch");
  return Object.freeze([...new Set(issues)].sort());
}

export function computeBootstrapAnchorValueDigest(input: unknown): string {
  const value = parsedOrThrow(parseBootstrapAnchorLifecycleValue, input);
  return framedDigest("bootstrap-anchor-value/v1", [
    frame.raw32(String(value.anchorDigest)),
    frame.text(String(value.lifecycle)),
    frame.canonical(value),
  ]);
}

export function computeBootstrapAnchorProposalDigest(input: unknown): string {
  const proposal = parsedOrThrow(parseBootstrapAnchorProposal, input);
  return framedDigest("bootstrap-anchor-receipt/v1", [
    frame.raw32(String(proposal.anchorDigest)),
    frame.raw32(String(proposal.mutationId)),
    frame.nullableRaw32(proposal.priorTipDigest as string | null),
    frame.nullableRaw32(proposal.priorValueDigest as string | null),
    frame.nullableRaw32(proposal.priorReceiptDigest as string | null),
    frame.raw32(String(proposal.successorValueDigest)),
    frame.text(String(proposal.transition)),
    frame.canonical(proposal),
  ]);
}

export function computeBootstrapAnchorTipDigest(input: unknown): string {
  const tip = parsedOrThrow(parseBootstrapAnchorTip, input);
  return framedDigest("bootstrap-anchor-tip/v1", [
    frame.raw32(String(tip.anchorDigest)),
    frame.raw32(String(tip.valueDigest)),
    frame.raw32(String(tip.proposalReceiptDigest)),
    frame.canonical(tip),
  ]);
}

export function computeBootstrapAnchorConflictDigest(input: unknown): string {
  const conflict = parsedOrThrow(parseBootstrapAnchorConflict, input);
  return framedDigest("bootstrap-anchor-conflict/v1", [
    frame.raw32(String(conflict.anchorDigest)),
    frame.raw32(String(conflict.mutationId)),
    frame.raw32(String(conflict.losingProposalReceiptDigest)),
    frame.raw32(String(conflict.losingSuccessorValueDigest)),
    frame.raw32(String(conflict.winningTipDigest)),
    frame.raw32(String(conflict.winningValueDigest)),
    frame.raw32(String(conflict.winningProposalReceiptDigest)),
    frame.canonical(conflict),
  ]);
}

export function computeBootstrapAnchorMutationId(
  anchorInput: unknown,
  proposalInput: unknown,
  successorValueInput: unknown,
): string {
  const anchor = parsedOrThrow(parseBootstrapAnchor, anchorInput);
  const proposal = parsedOrThrow(parseBootstrapAnchorProposal, proposalInput);
  const successor = parsedOrThrow(parseBootstrapAnchorLifecycleValue, successorValueInput);
  return framedDigest("bootstrap-anchor-mutation-id/v1", [
    frame.raw32(String(proposal.anchorDigest)),
    frame.text(externalAuthorityPaths.bootstrapAnchorCurrent(String(anchor.installationId))),
    frame.nullableRaw32(proposal.priorTipDigest as string | null),
    frame.nullableRaw32(proposal.priorValueDigest as string | null),
    frame.nullableRaw32(proposal.priorReceiptDigest as string | null),
    frame.boundedDecimal(String(successor.lifecycleOrdinal)),
    frame.text(String(proposal.transition)),
    frame.raw32(String(proposal.successorValueDigest)),
    frame.text(String(proposal.source)),
    frame.raw32(String(proposal.transitionEvidenceDigest)),
  ]);
}

function proposalValueIssues(
  anchor: ContractRecord,
  anchorDigest: string,
  proposal: ContractRecord,
  successor: ContractRecord,
): string[] {
  const issues: string[] = [];
  const successorDigest = computeBootstrapAnchorValueDigest(successor);
  const priorCount = groupCount(proposal, priorFields);
  for (const [field, actual, selected] of [
    ["proposal.anchorDigest", proposal.anchorDigest, anchorDigest],
    ["successor.anchorDigest", successor.anchorDigest, anchorDigest],
    ["successorValueDigest", proposal.successorValueDigest, successorDigest],
    [
      "mutationId",
      proposal.mutationId,
      computeBootstrapAnchorMutationId(anchor, proposal, successor),
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (proposal.transition === "ACTIVATE") {
    if (priorCount !== 0) issues.push("priorTriple:activate-non-null");
    if (proposal.source !== "BOOTSTRAP_CREATE") issues.push("source:not-bootstrap-create");
    if (successor.lifecycle !== "ACTIVE" || successor.lifecycleOrdinal !== "0")
      issues.push("successor:activate-shape");
    if (proposal.transitionEvidenceDigest !== anchor.bootstrapGrantDigest)
      issues.push("transition:activate-evidence");
  } else {
    if (priorCount !== priorFields.length) issues.push("priorTriple:non-activate-required");
    if (proposal.transition === "CONSUME") {
      if (proposal.source !== "E0_SELECTION") issues.push("source:not-e0-selection");
      if (successor.lifecycle !== "CONSUMED") issues.push("successor:consume-shape");
      if (proposal.transitionEvidenceDigest !== successor.selectionPostReceiptDigest)
        issues.push("transition:consume-evidence");
    } else {
      if (proposal.source !== "TEARDOWN") issues.push("source:not-teardown");
      if (successor.lifecycle !== "RETIRED") issues.push("successor:retire-shape");
      if (proposal.transitionEvidenceDigest !== successor.teardownReceiptDigest)
        issues.push("transition:retire-evidence");
    }
  }
  return issues;
}

export function validateBootstrapAnchorMutationBinding(
  anchorInput: unknown,
  proposalInput: unknown,
  successorValueInput: unknown,
  priorTipInput: unknown,
  priorValueInput: unknown,
  priorProposalInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const anchor = parseBootstrapAnchor(anchorInput);
  const proposal = parseBootstrapAnchorProposal(proposalInput);
  const successor = parseBootstrapAnchorLifecycleValue(successorValueInput);
  const expected = snapshotClosedRecord(expectedInput, mutationExpectationFields);
  const inputs = [priorTipInput, priorValueInput, priorProposalInput] as const;
  const nullCount = inputs.filter((input) => input === null).length;
  const priorTip = priorTipInput === null ? undefined : parseBootstrapAnchorTip(priorTipInput);
  const priorValue =
    priorValueInput === null ? undefined : parseBootstrapAnchorLifecycleValue(priorValueInput);
  const priorProposal =
    priorProposalInput === null ? undefined : parseBootstrapAnchorProposal(priorProposalInput);
  const issues = [
    ...prefixed("anchor", anchor),
    ...prefixed("proposal", proposal),
    ...prefixed("successor", successor),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
    ...(priorTip ? prefixed("priorTip", priorTip) : []),
    ...(priorValue ? prefixed("priorValue", priorValue) : []),
    ...(priorProposal ? prefixed("priorProposal", priorProposal) : []),
  ];
  if (nullCount !== 0 && nullCount !== inputs.length) issues.push("priorInputs:mixed-nullability");
  if (
    !anchor.ok ||
    !proposal.ok ||
    !successor.ok ||
    !expected.ok ||
    (nullCount === 0 && (!priorTip?.ok || !priorValue?.ok || !priorProposal?.ok))
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of mutationExpectationFields)
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  const a = anchor.value;
  const p = proposal.value;
  const s = successor.value;
  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    issues.push("anchor:globalBootstrapIdentityDigest:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  }
  issues.push(...proposalValueIssues(a, anchorDigest, p, s));
  if (expected.value.anchorDigest !== anchorDigest) issues.push("expected:anchorDigest:mismatch");
  if (expected.value.transitionEvidenceDigest !== p.transitionEvidenceDigest)
    issues.push("expected:transitionEvidenceDigest:mismatch");
  if (nullCount === inputs.length) {
    if (p.transition !== "ACTIVATE") issues.push("transition:not-activate");
  } else {
    const pt = parsedOrThrow(parseBootstrapAnchorTip, priorTipInput);
    const pv = parsedOrThrow(parseBootstrapAnchorLifecycleValue, priorValueInput);
    const pp = parsedOrThrow(parseBootstrapAnchorProposal, priorProposalInput);
    const tipDigest = computeBootstrapAnchorTipDigest(pt);
    const valueDigest = computeBootstrapAnchorValueDigest(pv);
    const proposalDigest = computeBootstrapAnchorProposalDigest(pp);
    issues.push(
      ...proposalValueIssues(a, anchorDigest, pp, pv).map((issue) => `priorProposal:${issue}`),
    );
    for (const [field, actual, selected] of [
      ["priorTipDigest", p.priorTipDigest, tipDigest],
      ["priorValueDigest", p.priorValueDigest, valueDigest],
      ["priorReceiptDigest", p.priorReceiptDigest, proposalDigest],
      ["priorTip.valueDigest", pt.valueDigest, valueDigest],
      ["priorTip.proposalReceiptDigest", pt.proposalReceiptDigest, proposalDigest],
      ["priorProposal.successorValueDigest", pp.successorValueDigest, valueDigest],
      ["priorTip.anchorDigest", pt.anchorDigest, p.anchorDigest],
      ["priorValue.anchorDigest", pv.anchorDigest, p.anchorDigest],
      ["priorProposal.anchorDigest", pp.anchorDigest, p.anchorDigest],
      ["priorProposal.mutationId", pp.mutationId, computeBootstrapAnchorMutationId(a, pp, pv)],
    ] as const)
      if (actual !== selected) issues.push(`${field}:mismatch`);
    try {
      if (s.lifecycleOrdinal !== incrementCanonicalDecimal(String(pv.lifecycleOrdinal)))
        issues.push("lifecycleOrdinal:not-successor");
    } catch {
      issues.push("lifecycleOrdinal:overflow");
    }
    if (p.transition === "CONSUME" && pv.lifecycle !== "ACTIVE")
      issues.push("transition:consume-prior-not-active");
    if (p.transition === "RETIRE_UNUSED" && pv.lifecycle !== "ACTIVE")
      issues.push("transition:retire-unused-prior-not-active");
    if (p.transition === "RETIRE_CONSUMED" && pv.lifecycle !== "CONSUMED")
      issues.push("transition:retire-consumed-prior-not-consumed");
    if (p.transition === "ACTIVATE") issues.push("transition:activate-with-prior");
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function validateBootstrapAnchorConflictBinding(
  anchorInput: unknown,
  conflictInput: unknown,
  losingProposalInput: unknown,
  losingValueInput: unknown,
  winningTipInput: unknown,
  winningProposalInput: unknown,
  winningValueInput: unknown,
): readonly string[] {
  const anchor = parseBootstrapAnchor(anchorInput);
  const conflict = parseBootstrapAnchorConflict(conflictInput);
  const losingProposal = parseBootstrapAnchorProposal(losingProposalInput);
  const losingValue = parseBootstrapAnchorLifecycleValue(losingValueInput);
  const winningTip = parseBootstrapAnchorTip(winningTipInput);
  const winningProposal = parseBootstrapAnchorProposal(winningProposalInput);
  const winningValue = parseBootstrapAnchorLifecycleValue(winningValueInput);
  const issues = [
    ...prefixed("anchor", anchor),
    ...prefixed("conflict", conflict),
    ...prefixed("losingProposal", losingProposal),
    ...prefixed("losingValue", losingValue),
    ...prefixed("winningTip", winningTip),
    ...prefixed("winningProposal", winningProposal),
    ...prefixed("winningValue", winningValue),
  ];
  if (
    !anchor.ok ||
    !conflict.ok ||
    !losingProposal.ok ||
    !losingValue.ok ||
    !winningTip.ok ||
    !winningProposal.ok ||
    !winningValue.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  const a = anchor.value;
  const c = conflict.value;
  const lp = losingProposal.value;
  const lv = losingValue.value;
  const wt = winningTip.value;
  const wp = winningProposal.value;
  const wv = winningValue.value;
  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    issues.push("anchor:globalBootstrapIdentityDigest:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  }
  issues.push(
    ...proposalValueIssues(a, anchorDigest, lp, lv).map((issue) => `losing:${issue}`),
    ...proposalValueIssues(a, anchorDigest, wp, wv).map((issue) => `winning:${issue}`),
  );
  const losingProposalDigest = computeBootstrapAnchorProposalDigest(lp);
  const losingValueDigest = computeBootstrapAnchorValueDigest(lv);
  const winningTipDigest = computeBootstrapAnchorTipDigest(wt);
  const winningProposalDigest = computeBootstrapAnchorProposalDigest(wp);
  const winningValueDigest = computeBootstrapAnchorValueDigest(wv);
  for (const [field, actual, selected] of [
    ["anchorDigest", c.anchorDigest, anchorDigest],
    ["mutationId", c.mutationId, lp.mutationId],
    ["losingProposalReceiptDigest", c.losingProposalReceiptDigest, losingProposalDigest],
    ["losingSuccessorValueDigest", c.losingSuccessorValueDigest, losingValueDigest],
    ["winningTipDigest", c.winningTipDigest, winningTipDigest],
    ["winningValueDigest", c.winningValueDigest, winningValueDigest],
    ["winningProposalReceiptDigest", c.winningProposalReceiptDigest, winningProposalDigest],
    ["winningTip.anchorDigest", wt.anchorDigest, anchorDigest],
    ["winningTip.valueDigest", wt.valueDigest, winningValueDigest],
    ["winningTip.proposalReceiptDigest", wt.proposalReceiptDigest, winningProposalDigest],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (losingProposalDigest === winningProposalDigest && losingValueDigest === winningValueDigest)
    issues.push("conflict:idempotent-not-conflict");
  return Object.freeze([...new Set(issues)].sort());
}

export function parseBootstrapAnchorContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor/v1")
    return parseBootstrapAnchor(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-lifecycle-value/v1")
    return parseBootstrapAnchorLifecycleValue(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-cas-proposal/v1")
    return parseBootstrapAnchorProposal(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-current-tip/v1")
    return parseBootstrapAnchorTip(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-conflict-receipt/v1")
    return parseBootstrapAnchorConflict(input);
  return undefined;
}

import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";
import {
  computeConflictDigest,
  computeCurrentTipDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parsePointerConflict,
  parsePointerCurrentTip,
  parsePointerProposal,
  pointerKinds,
  validateSelectedPointerEvidence,
  type PointerKind,
} from "./pointer.js";

const globalIdentityFields = Object.freeze([
  "authorityPath",
  "authorityPathInstanceDigest",
  "custodyInstanceDigest",
  "installationId",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
] as const);
const unknownEvidenceFields = Object.freeze([
  "category",
  "observationDigest",
  "observedAt",
  "observedByteLength",
  "reason",
  "schemaVersion",
  "targetMutationId",
  "targetPathInstanceDigest",
] as const);
const conflictEvidenceFields = Object.freeze([
  "conflictReceipt",
  "losingProposal",
  "schemaVersion",
  "selectedWinner",
  "targetMutationId",
  "targetPathInstanceDigest",
] as const);
const evidenceSlotFields = Object.freeze([
  "pointerKind",
  "schemaVersion",
  "selectedEvidence",
] as const);

export const evidenceSchemaFields = Object.freeze({
  conflictEvidence: conflictEvidenceFields,
  evidenceSlot: evidenceSlotFields,
  globalIdentity: globalIdentityFields,
  unknownEvidence: unknownEvidenceFields,
});
export const evidenceSchemaVersions = Object.freeze([
  "pointer-evidence-slot/v1",
  "pointer-mutation-conflict-evidence/v1",
  "pointer-mutation-unknown-evidence/v1",
  "state-mutation-global-identity/v1",
] as const);

export const unknownEvidenceReasons = Object.freeze({
  IMPOSSIBLE: Object.freeze(["EPOCH_MISMATCH", "IDENTITY_MISMATCH", "STATE_CONTRADICTION"]),
  MALFORMED: Object.freeze(["DIGEST_MISMATCH", "NON_CANONICAL", "SCHEMA_INVALID"]),
  UNREADABLE: Object.freeze(["IO_ERROR", "MISSING", "PERMISSION_DENIED"]),
} as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
  schemaVersion: string,
): ParseResult {
  const record = snapshotClosedRecord(input, fields);
  if (!record.ok) return record;
  return record.value.schemaVersion === schemaVersion ? record : invalid("schemaVersion:mismatch");
}

export function parseStateMutationGlobalIdentity(input: unknown): ParseResult {
  const parsed = exactRecord(input, globalIdentityFields, "state-mutation-global-identity/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (!isUuidV7(record.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
  if (!isSha256(record.stateRootDigest)) issues.push("stateRootDigest:invalid");
  if (!isSha256(record.custodyInstanceDigest)) issues.push("custodyInstanceDigest:invalid");
  if (!isContractRelativePath(record.authorityPath)) issues.push("authorityPath:invalid");
  if (!isSha256(record.authorityPathInstanceDigest))
    issues.push("authorityPathInstanceDigest:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeStateMutationGlobalIdentityDigest(input: unknown): string {
  const parsed = parseStateMutationGlobalIdentity(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("state-mutation-global-identity/v1", [
    frame.text(String(record.installationId)),
    frame.text(String(record.projectId)),
    frame.raw32(String(record.stateRootDigest)),
    frame.raw32(String(record.custodyInstanceDigest)),
    frame.text(String(record.authorityPath)),
    frame.raw32(String(record.authorityPathInstanceDigest)),
  ]);
}

export function parsePointerMutationUnknownEvidence(input: unknown): ParseResult {
  const parsed = exactRecord(input, unknownEvidenceFields, "pointer-mutation-unknown-evidence/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  const category = String(record.category) as keyof typeof unknownEvidenceReasons;
  if (!Object.hasOwn(unknownEvidenceReasons, category)) issues.push("category:invalid");
  else if (!(unknownEvidenceReasons[category] as readonly string[]).includes(String(record.reason)))
    issues.push("reason:category-mismatch");
  if (!isSha256(record.targetPathInstanceDigest)) issues.push("targetPathInstanceDigest:invalid");
  if (!isSha256(record.targetMutationId)) issues.push("targetMutationId:invalid");
  if (!isSha256(record.observationDigest)) issues.push("observationDigest:invalid");
  if (!isCanonicalDecimal(record.observedByteLength)) issues.push("observedByteLength:invalid");
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computePointerMutationUnknownEvidenceDigest(input: unknown): string {
  const parsed = parsePointerMutationUnknownEvidence(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("pointer-mutation-unknown-evidence/v1", [frame.canonical(parsed.value)]);
}

function parseSelectedGraph(input: unknown):
  | {
      readonly ok: true;
      readonly value: ContractRecord;
      readonly proposal: ContractRecord;
      readonly tip: ContractRecord;
      readonly valueDigest: string;
      readonly receiptDigest: string;
      readonly tipDigest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const selected = snapshotClosedRecord(input, ["proposal", "tip", "value"]);
  if (!selected.ok) return selected;
  const proposal = parsePointerProposal(selected.value.proposal);
  const tip = parsePointerCurrentTip(selected.value.tip);
  const issues = [
    ...(!proposal.ok ? proposal.issues.map((issue) => `proposal:${issue}`) : []),
    ...(!tip.ok ? tip.issues.map((issue) => `tip:${issue}`) : []),
    ...validateSelectedPointerEvidence(selected.value),
  ];
  if (!proposal.ok || !tip.ok || issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: selected.value,
    proposal: proposal.value,
    tip: tip.value,
    valueDigest: computePointerValueDigest(
      proposal.value.pointerKind as PointerKind,
      String(proposal.value.pathInstanceDigest),
      selected.value.value,
    ),
    receiptDigest: computeProposalReceiptDigest(proposal.value),
    tipDigest: computeCurrentTipDigest(tip.value),
  };
}

export function parsePointerMutationConflictEvidence(input: unknown): ParseResult {
  const parsed = exactRecord(
    input,
    conflictEvidenceFields,
    "pointer-mutation-conflict-evidence/v1",
  );
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const loser = parsePointerProposal(record.losingProposal);
  const winner = parseSelectedGraph(record.selectedWinner);
  const conflict = parsePointerConflict(record.conflictReceipt);
  const issues: string[] = [];
  if (!loser.ok) issues.push(...loser.issues.map((issue) => `losingProposal:${issue}`));
  if (!winner.ok) issues.push(...winner.issues.map((issue) => `selectedWinner:${issue}`));
  if (!conflict.ok) issues.push(...conflict.issues.map((issue) => `conflictReceipt:${issue}`));
  if (!isSha256(record.targetMutationId)) issues.push("targetMutationId:invalid");
  if (!isSha256(record.targetPathInstanceDigest)) issues.push("targetPathInstanceDigest:invalid");
  if (!loser.ok || !winner.ok || !conflict.ok) return invalid(...issues);

  const loserReceiptDigest = computeProposalReceiptDigest(loser.value);
  if (winner.proposal.pointerKind !== loser.value.pointerKind)
    issues.push("selectedWinner.pointerKind:mismatch");
  if (winner.receiptDigest === loserReceiptDigest)
    issues.push("selectedWinner:loser-not-different");
  for (const [field, actual, expected] of [
    [
      "losingProposal.pathInstanceDigest",
      loser.value.pathInstanceDigest,
      record.targetPathInstanceDigest,
    ],
    ["losingProposal.mutationId", loser.value.mutationId, record.targetMutationId],
    [
      "selectedWinner.pathInstanceDigest",
      winner.proposal.pathInstanceDigest,
      record.targetPathInstanceDigest,
    ],
    [
      "conflictReceipt.pathInstanceDigest",
      conflict.value.pathInstanceDigest,
      record.targetPathInstanceDigest,
    ],
    ["conflictReceipt.mutationId", conflict.value.mutationId, record.targetMutationId],
    [
      "conflictReceipt.losingProposalReceiptDigest",
      conflict.value.losingProposalReceiptDigest,
      loserReceiptDigest,
    ],
    [
      "conflictReceipt.losingSuccessorValueDigest",
      conflict.value.losingSuccessorValueDigest,
      loser.value.successorValueDigest,
    ],
    ["conflictReceipt.winningTipDigest", conflict.value.winningTipDigest, winner.tipDigest],
    ["conflictReceipt.winningValueDigest", conflict.value.winningValueDigest, winner.valueDigest],
    [
      "conflictReceipt.winningReceiptDigest",
      conflict.value.winningReceiptDigest,
      winner.receiptDigest,
    ],
    [
      "conflictReceipt.authorityEpochTipDigest",
      conflict.value.authorityEpochTipDigest,
      loser.value.authorityEpochTipDigest,
    ],
    [
      "conflictReceipt.authorityEpochValueDigest",
      conflict.value.authorityEpochValueDigest,
      loser.value.authorityEpochValueDigest,
    ],
    [
      "conflictReceipt.authorityEpochReceiptDigest",
      conflict.value.authorityEpochReceiptDigest,
      loser.value.authorityEpochReceiptDigest,
    ],
  ] as const)
    if (actual !== expected) issues.push(`${field}:mismatch`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computePointerMutationConflictEvidenceDigest(input: unknown): string {
  const parsed = parsePointerMutationConflictEvidence(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  const loser = parsePointerProposal(record.losingProposal);
  const winner = parseSelectedGraph(record.selectedWinner);
  const conflict = parsePointerConflict(record.conflictReceipt);
  if (!loser.ok || !winner.ok || !conflict.ok) throw new TypeError("conflictEvidence:invalid");
  return framedDigest("pointer-mutation-conflict-evidence/v1", [
    frame.raw32(String(record.targetPathInstanceDigest)),
    frame.raw32(String(record.targetMutationId)),
    frame.raw32(computeProposalReceiptDigest(loser.value)),
    frame.raw32(String(loser.value.successorValueDigest)),
    frame.raw32(winner.tipDigest),
    frame.raw32(winner.valueDigest),
    frame.raw32(winner.receiptDigest),
    frame.raw32(computeConflictDigest(conflict.value)),
    frame.canonical(record),
  ]);
}

export function parsePointerEvidenceSlot(input: unknown): ParseResult {
  const parsed = exactRecord(input, evidenceSlotFields, "pointer-evidence-slot/v1");
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  if (!pointerKinds.includes(record.pointerKind as PointerKind))
    return invalid("pointerKind:invalid");
  if (record.selectedEvidence === null) return parsed;
  const nested = record.selectedEvidence as ContractRecord;
  if (nested.schemaVersion === "pointer-mutation-conflict-evidence/v1") {
    const conflict = parsePointerMutationConflictEvidence(nested);
    if (!conflict.ok)
      return invalid(...conflict.issues.map((issue) => `selectedEvidence:${issue}`));
    const loser = parsePointerProposal(conflict.value.losingProposal);
    const winner = parseSelectedGraph(conflict.value.selectedWinner);
    if (!loser.ok || !winner.ok) return invalid("selectedEvidence:invalid");
    return loser.value.pointerKind === record.pointerKind &&
      winner.proposal.pointerKind === record.pointerKind
      ? parsed
      : invalid("selectedEvidence:pointerKind:mismatch");
  }
  const selected = parseSelectedGraph(record.selectedEvidence);
  if (!selected.ok) return invalid(...selected.issues.map((issue) => `selectedEvidence:${issue}`));
  return selected.proposal.pointerKind === record.pointerKind
    ? parsed
    : invalid("selectedEvidence:pointerKind:mismatch");
}

export function parseEvidenceContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | null {
  switch (expectedSchemaVersion) {
    case "pointer-mutation-unknown-evidence/v1":
      return parsePointerMutationUnknownEvidence(input);
    case "pointer-mutation-conflict-evidence/v1":
      return parsePointerMutationConflictEvidence(input);
    case "pointer-evidence-slot/v1":
      return parsePointerEvidenceSlot(input);
    case "state-mutation-global-identity/v1":
      return parseStateMutationGlobalIdentity(input);
    default:
      return null;
  }
}

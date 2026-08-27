import {
  canonicalDigest,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";
import {
  computeCurrentTipDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parsePointerCurrentTip,
  parsePointerProposal,
  pointerKinds,
  stateMutationAuthorityPath,
  validateSelectedPointerEvidence,
} from "./pointer.js";
import { parseAuthorityHistoryBinding, parseStateMutationAuthorityValue } from "./authority.js";
import {
  computeCommitEvidenceDigest,
  parseCommitEvidence,
  parseRunCheckpointCore,
  parseRunCheckpointEvidence,
} from "./commit.js";
import {
  computeStateMutationGlobalIdentityDigest,
  parsePointerEvidenceSlot,
  parseStateMutationGlobalIdentity,
} from "./evidence.js";

const packetFields = Object.freeze([
  "authorityHistoryBinding",
  "currentAuthoritySelection",
  "currentCommit",
  "evidenceSlots",
  "globalIdentity",
  "purpose",
  "schemaVersion",
] as const);

export const packetSchemaFields = Object.freeze({ packet: packetFields });
export const packetSchemaVersions = Object.freeze(["pointer-evidence-packet/v1"] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function selectedAuthority(input: unknown):
  | {
      readonly ok: true;
      readonly selection: ContractRecord;
      readonly proposal: ContractRecord;
      readonly value: ContractRecord;
      readonly pathInstanceDigest: string;
      readonly receiptDigest: string;
      readonly tipDigest: string;
      readonly valueDigest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const selection = snapshotClosedRecord(input, ["proposal", "tip", "value"]);
  if (!selection.ok) return selection;
  const proposal = parsePointerProposal(selection.value.proposal);
  const tip = parsePointerCurrentTip(selection.value.tip);
  const value = parseStateMutationAuthorityValue(selection.value.value);
  const issues = [
    ...(!proposal.ok ? proposal.issues.map((issue) => `proposal:${issue}`) : []),
    ...(!tip.ok ? tip.issues.map((issue) => `tip:${issue}`) : []),
    ...(!value.ok ? value.issues.map((issue) => `value:${issue}`) : []),
    ...validateSelectedPointerEvidence(selection.value),
  ];
  if (!proposal.ok || !tip.ok || !value.ok || issues.length > 0) return { ok: false, issues };
  if (
    proposal.value.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION" ||
    tip.value.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION"
  )
    return { ok: false, issues: ["pointerKind:not-authority"] };
  const pathInstanceDigest = String(proposal.value.pathInstanceDigest);
  return {
    ok: true,
    selection: selection.value,
    proposal: proposal.value,
    value: value.value,
    pathInstanceDigest,
    receiptDigest: computeProposalReceiptDigest(proposal.value),
    tipDigest: computeCurrentTipDigest(tip.value),
    valueDigest: computePointerValueDigest(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      pathInstanceDigest,
      value.value,
    ),
  };
}

function commitCore(commit: ContractRecord): ParseResult {
  const checkpointInput =
    commit.commitKind === "ORDINARY"
      ? Array.isArray(commit.checkpoints)
        ? commit.checkpoints[0]
        : null
      : commit.checkpoint5;
  const checkpoint = parseRunCheckpointEvidence(checkpointInput);
  if (!checkpoint.ok) return checkpoint;
  return parseRunCheckpointCore(checkpoint.value.core);
}

function validateSlots(
  input: unknown,
):
  | { readonly ok: true; readonly slots: readonly ContractRecord[] }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const slots = snapshotClosedArray(input);
  if (!slots.ok) return slots;
  if (slots.value.length !== pointerKinds.length)
    return { ok: false, issues: ["evidenceSlots:length"] };
  const parsedSlots: ContractRecord[] = [];
  const issues: string[] = [];
  for (let index = 0; index < pointerKinds.length; index += 1) {
    const parsed = parsePointerEvidenceSlot(slots.value[index]);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `evidenceSlots:${index}:${issue}`));
      continue;
    }
    if (parsed.value.pointerKind !== pointerKinds[index])
      issues.push(`evidenceSlots:${index}:registry-order`);
    parsedSlots.push(parsed.value);
  }
  return issues.length === 0
    ? { ok: true, slots: Object.freeze(parsedSlots) }
    : { ok: false, issues };
}

function isConflictSelection(slot: ContractRecord): boolean {
  return (
    slot.selectedEvidence !== null &&
    (slot.selectedEvidence as ContractRecord).schemaVersion ===
      "pointer-mutation-conflict-evidence/v1"
  );
}

function validatePositiveAuthority(
  globalIdentity: ContractRecord,
  current: ReturnType<typeof selectedAuthority> & { readonly ok: true },
  history: ContractRecord,
): string[] {
  const issues: string[] = [];
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(globalIdentity);
  if (globalIdentity.authorityPath !== stateMutationAuthorityPath)
    issues.push("globalIdentity:authorityPath:mismatch");
  if (globalIdentity.authorityPathInstanceDigest !== current.pathInstanceDigest)
    issues.push("globalIdentity:authorityPathInstanceDigest:mismatch");
  for (const field of [
    "custodyInstanceDigest",
    "installationId",
    "projectId",
    "stateRootDigest",
  ] as const)
    if (globalIdentity[field] !== current.value[field])
      issues.push(`currentAuthoritySelection:${field}:mismatch`);
  if (current.value.globalIdentityDigest !== globalIdentityDigest)
    issues.push("currentAuthoritySelection:globalIdentityDigest:mismatch");
  for (const field of ["globalIdentityDigest", "headOrdinal", "headRecordDigest"] as const)
    if (history[field] !== current.value[field])
      issues.push(`authorityHistoryBinding:${field}:mismatch`);
  return issues;
}

export function parsePointerEvidencePacket(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, packetFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-evidence-packet/v1") issues.push("schemaVersion:mismatch");
  if (!["HISTORICAL_READ", "MUTATION_COMMIT"].includes(String(record.purpose)))
    issues.push("purpose:invalid");
  const globalIdentity = parseStateMutationGlobalIdentity(record.globalIdentity);
  if (!globalIdentity.ok)
    issues.push(...globalIdentity.issues.map((issue) => `globalIdentity:${issue}`));
  const slots = validateSlots(record.evidenceSlots);
  if (!slots.ok) issues.push(...slots.issues);
  if (!globalIdentity.ok || !slots.ok) return invalid(...issues);

  const authorityIndex = pointerKinds.indexOf("STATE_MUTATION_AUTHORITY_ROTATION");
  const authoritySlot = slots.slots[authorityIndex]!;
  const current =
    record.currentAuthoritySelection === null
      ? null
      : selectedAuthority(record.currentAuthoritySelection);
  const history =
    record.authorityHistoryBinding === null
      ? null
      : parseAuthorityHistoryBinding(record.authorityHistoryBinding);
  if (current !== null && !current.ok)
    issues.push(...current.issues.map((issue) => `currentAuthoritySelection:${issue}`));
  if (history !== null && !history.ok)
    issues.push(...history.issues.map((issue) => `authorityHistoryBinding:${issue}`));
  if ((current === null) !== (history === null)) issues.push("authorityBinding:partial-null");
  if (current !== null && current.ok && history !== null && history.ok) {
    issues.push(...validatePositiveAuthority(globalIdentity.value, current, history.value));
    if (
      authoritySlot.selectedEvidence === null ||
      canonicalDigest(authoritySlot.selectedEvidence) !== canonicalDigest(current.selection)
    )
      issues.push("evidenceSlots:authority:current-selection-mismatch");
  }

  if (record.purpose === "HISTORICAL_READ") {
    if (record.currentCommit !== null) issues.push("currentCommit:historical-must-be-null");
    if (current === null || history === null) issues.push("authorityBinding:historical-required");
    for (const slot of slots.slots)
      if (isConflictSelection(slot)) issues.push("evidenceSlots:historical-conflict-forbidden");
    return issues.length === 0 ? parsed : invalid(...issues);
  }
  if (record.purpose !== "MUTATION_COMMIT") return invalid(...issues);
  if (record.currentCommit === null) return invalid(...issues, "currentCommit:mutation-required");
  const commit = parseCommitEvidence(record.currentCommit);
  if (!commit.ok)
    return invalid(...issues, ...commit.issues.map((issue) => `currentCommit:${issue}`));
  computeCommitEvidenceDigest(commit.value);
  const core = commitCore(commit.value);
  if (!core.ok)
    return invalid(...issues, ...core.issues.map((issue) => `currentCommit:core:${issue}`));
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(globalIdentity.value);
  if (core.value.globalIdentityDigest !== globalIdentityDigest)
    issues.push("currentCommit:globalIdentityDigest:mismatch");
  for (const field of ["installationId", "projectId", "stateRootDigest"] as const)
    if (core.value[field] !== globalIdentity.value[field])
      issues.push(`currentCommit:${field}:mismatch`);
  if (globalIdentity.value.authorityPath !== stateMutationAuthorityPath)
    issues.push("globalIdentity:authorityPath:mismatch");
  if (
    globalIdentity.value.authorityPathInstanceDigest !== commit.value.oldAuthorityPathInstanceDigest
  )
    issues.push("currentCommit:authorityPathInstanceDigest:mismatch");

  const rotationUnknown =
    commit.value.commitKind === "AUTHORITY_ROTATION" && commit.value.rotationOutcome === "UNKNOWN";
  if (rotationUnknown) {
    if (current !== null || history !== null) issues.push("authorityBinding:unknown-must-be-null");
    if (authoritySlot.selectedEvidence !== null)
      issues.push("evidenceSlots:authority:unknown-must-be-empty");
  } else {
    if (current === null || history === null || !current?.ok || !history?.ok) {
      issues.push("authorityBinding:positive-required");
    } else {
      for (const [field, actual] of [
        ["packetAuthorityPathInstanceDigest", current.pathInstanceDigest],
        ["packetAuthorityReceiptDigest", current.receiptDigest],
        ["packetAuthorityTipDigest", current.tipDigest],
        ["packetAuthorityValueDigest", current.valueDigest],
      ] as const)
        if (commit.value[field] !== actual)
          issues.push(`currentCommit:${field}:current-authority-mismatch`);
    }
  }

  const targetKind = String(commit.value.targetPointerKind);
  const targetIndex = pointerKinds.indexOf(targetKind as (typeof pointerKinds)[number]);
  const expectedTargetSlot =
    commit.value.commitKind === "ORDINARY"
      ? commit.value.targetRegistrySlot
      : commit.value.authorityRegistrySlot;
  if (
    targetIndex < 0 ||
    canonicalDigest(slots.slots[targetIndex]!) !== canonicalDigest(expectedTargetSlot)
  )
    issues.push("evidenceSlots:target:mismatch");
  for (let index = 0; index < slots.slots.length; index += 1)
    if (index !== targetIndex && isConflictSelection(slots.slots[index]!))
      issues.push(`evidenceSlots:${index}:non-target-conflict-forbidden`);
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parsePacketContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  return expectedSchemaVersion === "pointer-evidence-packet/v1"
    ? parsePointerEvidencePacket(input)
    : undefined;
}

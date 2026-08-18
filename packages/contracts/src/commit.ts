import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUuidV7,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";
import { pointerKinds, pointerRegistry, type PointerKind } from "./pointer.js";

export const commitRunStages = Object.freeze([
  "CURRENT_AUTHORITY_READ",
  "TARGET_RECONCILED",
  "VALUE_READBACK",
  "PROPOSAL_READBACK",
  "CURRENT_AUTHORITY_PRE_CAS_READ",
  "CAS_ARMED",
  "TARGET_POST_CAS_READBACK",
  "PROPOSAL_CLASSIFIED",
  "CURRENT_AUTHORITY_POST_CAS_READ",
] as const);
export type CommitRunStage = (typeof commitRunStages)[number];

export const commitRunPhases = Object.freeze([
  "CRASH_PREFIX",
  "CAS_AMBIGUOUS",
  "SELECTED",
  "LOST_CONFLICT",
  "UNKNOWN_TERMINAL",
] as const);
export type CommitRunPhase = (typeof commitRunPhases)[number];

const checkpointCoreFields = Object.freeze([
  "auditDigest",
  "canonicalPointerPath",
  "checkpointOrdinal",
  "globalIdentityDigest",
  "installationId",
  "phase",
  "pointerKind",
  "priorPostSelectionObservationDigest",
  "priorSelectorReceiptDigest",
  "priorSelectorTipDigest",
  "priorSelectorValueDigest",
  "projectId",
  "runOrdinal",
  "schemaVersion",
  "segmentDigest",
  "sourceToken",
  "stage",
  "stateRootDigest",
  "targetMutationId",
  "targetPathInstanceDigest",
  "terminalResolutionDigest",
  "transactionId",
] as const);
const runSegmentFields = Object.freeze([
  "canonicalPointerPath",
  "globalIdentityDigest",
  "installationId",
  "pointerKind",
  "projectId",
  "recordedAt",
  "runId",
  "runOrdinal",
  "schemaVersion",
  "sourceToken",
  "stage",
  "stageEvidenceDigest",
  "stateRootDigest",
  "targetMutationId",
  "targetPathInstanceDigest",
  "transactionId",
] as const);
const runCurrentValueFields = Object.freeze([
  "checkpointCoreDigest",
  "checkpointOrdinal",
  "phase",
  "runOrdinal",
  "schemaVersion",
  "stage",
  "targetMutationId",
  "targetPathInstanceDigest",
  "terminalResolutionDigest",
] as const);
const postSelectionObservationFields = Object.freeze([
  "checkpointCoreDigest",
  "observedAt",
  "proposalReadbackDigest",
  "schemaVersion",
  "selectorMutationId",
  "selectorPathInstanceDigest",
  "selectorReceiptDigest",
  "selectorTipDigest",
  "selectorValueDigest",
  "tipReadbackDigest",
  "valueReadbackDigest",
] as const);
const commitResolutionFields = Object.freeze([
  "conflictReceiptDigest",
  "outcome",
  "outcomeEvidenceDigest",
  "producerAuthorityPathInstanceDigest",
  "producerAuthorityReceiptDigest",
  "producerAuthorityTipDigest",
  "producerAuthorityValueDigest",
  "resolvedAt",
  "schemaVersion",
  "selectedTargetTipDigest",
  "targetMutationId",
  "targetPathInstanceDigest",
  "unknownEvidenceDigest",
] as const);

export const commitSchemaFields = Object.freeze({
  commitResolution: commitResolutionFields,
  checkpointCore: checkpointCoreFields,
  runSegment: runSegmentFields,
  runCurrentValue: runCurrentValueFields,
  postSelectionObservation: postSelectionObservationFields,
});
export const commitSchemaVersions = Object.freeze([
  "pointer-mutation-commit-resolution/v1",
  "pointer-mutation-run-checkpoint-core/v1",
  "pointer-mutation-run-current-value/v1",
  "pointer-mutation-run-segment/v1",
  "pointer-mutation-run-selector-post-selection-observation/v1",
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

function terminalPhase(phase: unknown): boolean {
  return ["SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"].includes(String(phase));
}

export function parseCommitResolution(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, commitResolutionFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-commit-resolution/v1")
    issues.push("schemaVersion:mismatch");
  if (!["SELECTED", "LOST_CONFLICT", "UNKNOWN_TERMINAL"].includes(String(record.outcome)))
    issues.push("outcome:invalid");
  issues.push(
    ...digestIssues(record, [
      "outcomeEvidenceDigest",
      "producerAuthorityPathInstanceDigest",
      "producerAuthorityReceiptDigest",
      "producerAuthorityTipDigest",
      "producerAuthorityValueDigest",
      "targetMutationId",
      "targetPathInstanceDigest",
    ]),
    ...nullableDigestIssues(record, [
      "conflictReceiptDigest",
      "selectedTargetTipDigest",
      "unknownEvidenceDigest",
    ]),
  );
  if (!isCanonicalTimestamp(record.resolvedAt)) issues.push("resolvedAt:invalid");
  const selected = record.outcome === "SELECTED";
  const lost = record.outcome === "LOST_CONFLICT";
  const unknown = record.outcome === "UNKNOWN_TERMINAL";
  if (
    selected
      ? !isSha256(record.selectedTargetTipDigest) ||
        record.conflictReceiptDigest !== null ||
        record.unknownEvidenceDigest !== null ||
        record.outcomeEvidenceDigest !== record.selectedTargetTipDigest
      : lost
        ? record.selectedTargetTipDigest !== null ||
          !isSha256(record.conflictReceiptDigest) ||
          record.unknownEvidenceDigest !== null ||
          record.outcomeEvidenceDigest !== record.conflictReceiptDigest
        : unknown
          ? record.selectedTargetTipDigest !== null ||
            record.conflictReceiptDigest !== null ||
            !isSha256(record.unknownEvidenceDigest) ||
            record.outcomeEvidenceDigest !== record.unknownEvidenceDigest
          : false
  )
    issues.push("outcome:evidence-union-mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeCommitResolutionDigest(input: unknown): string {
  const parsed = parseCommitResolution(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("pointer-mutation-commit-resolution/v1", [frame.canonical(parsed.value)]);
}

function validateStagePhase(record: ContractRecord): string[] {
  const issues: string[] = [];
  const stageIndex = commitRunStages.indexOf(record.stage as CommitRunStage);
  if (stageIndex < 0) issues.push("stage:invalid");
  else if (record.checkpointOrdinal !== String(stageIndex))
    issues.push("checkpointOrdinal:stage-mismatch");
  if (!commitRunPhases.includes(record.phase as CommitRunPhase)) issues.push("phase:invalid");
  if (stageIndex >= 0) {
    if (stageIndex <= 4 && record.phase !== "CRASH_PREFIX") issues.push("phase:stage-mismatch");
    if ((stageIndex === 5 || stageIndex === 6) && record.phase !== "CAS_AMBIGUOUS")
      issues.push("phase:stage-mismatch");
    if (stageIndex >= 7 && !terminalPhase(record.phase)) issues.push("phase:stage-mismatch");
  }
  if (terminalPhase(record.phase) !== isSha256(record.terminalResolutionDigest))
    issues.push("terminalResolutionDigest:phase-mismatch");
  return issues;
}

function validateTargetIdentity(record: ContractRecord): string[] {
  const issues: string[] = [];
  if (!pointerKinds.includes(record.pointerKind as PointerKind)) issues.push("pointerKind:invalid");
  if (!isContractRelativePath(record.canonicalPointerPath))
    issues.push("canonicalPointerPath:invalid");
  if (!isUuidV7(record.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
  const row = pointerRegistry.find((candidate) => candidate.kind === record.pointerKind);
  if (row) {
    if (row.transactionPolicy === "REQUIRED") {
      if (!isUuidV7(record.transactionId)) issues.push("transactionId:invalid");
    } else if (record.transactionId !== null) issues.push("transactionId:must-be-null");
    if (!row.sourceTokens.includes(String(record.sourceToken))) issues.push("sourceToken:invalid");
  }
  return issues;
}

export function parseRunSegment(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, runSegmentFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-run-segment/v1")
    issues.push("schemaVersion:mismatch");
  if (!commitRunStages.includes(record.stage as CommitRunStage)) issues.push("stage:invalid");
  if (!isCanonicalDecimal(record.runOrdinal)) issues.push("runOrdinal:invalid");
  if (!isCanonicalTimestamp(record.recordedAt)) issues.push("recordedAt:invalid");
  issues.push(
    ...validateTargetIdentity(record),
    ...digestIssues(record, [
      "globalIdentityDigest",
      "runId",
      "stageEvidenceDigest",
      "stateRootDigest",
      "targetMutationId",
      "targetPathInstanceDigest",
    ]),
  );
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeRunSegmentDigest(input: unknown): string {
  const parsed = parseRunSegment(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("pointer-mutation-run-segment/v1", [frame.canonical(parsed.value)]);
}

export function computeRunAuditDigest(
  priorAuditDigest: string | null,
  segmentDigest: string,
): string {
  if (priorAuditDigest !== null && !isSha256(priorAuditDigest))
    throw new TypeError("priorAuditDigest:invalid");
  if (!isSha256(segmentDigest)) throw new TypeError("segmentDigest:invalid");
  return framedDigest("pointer-mutation-run-audit/v1", [
    frame.fixed(priorAuditDigest === null ? "00" : "01"),
    ...(priorAuditDigest === null ? [] : [frame.raw32(priorAuditDigest)]),
    frame.raw32(segmentDigest),
  ]);
}

export function parseRunCheckpointCore(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, checkpointCoreFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-run-checkpoint-core/v1")
    issues.push("schemaVersion:mismatch");
  issues.push(...validateTargetIdentity(record));
  if (!isCanonicalDecimal(record.runOrdinal)) issues.push("runOrdinal:invalid");
  if (!isCanonicalDecimal(record.checkpointOrdinal)) issues.push("checkpointOrdinal:invalid");
  issues.push(
    ...digestIssues(record, [
      "auditDigest",
      "globalIdentityDigest",
      "segmentDigest",
      "stateRootDigest",
      "targetMutationId",
      "targetPathInstanceDigest",
    ]),
    ...nullableDigestIssues(record, [
      "priorPostSelectionObservationDigest",
      "priorSelectorReceiptDigest",
      "priorSelectorTipDigest",
      "priorSelectorValueDigest",
    ]),
    ...validateStagePhase(record),
  );
  const priorSelector = [
    record.priorSelectorTipDigest,
    record.priorSelectorValueDigest,
    record.priorSelectorReceiptDigest,
  ];
  if (!(priorSelector.every((value) => value === null) || priorSelector.every(isSha256)))
    issues.push("priorSelector:partial");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeRunCheckpointCoreDigest(input: unknown): string {
  const parsed = parseRunCheckpointCore(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("pointer-mutation-run-checkpoint-core/v1", [
    frame.raw32(String(record.globalIdentityDigest)),
    frame.text(String(record.pointerKind)),
    frame.text(String(record.canonicalPointerPath)),
    frame.text(String(record.installationId)),
    frame.text(String(record.projectId)),
    frame.raw32(String(record.stateRootDigest)),
    frame.nullableText(record.transactionId as string | null),
    frame.text(String(record.sourceToken)),
    frame.raw32(String(record.targetPathInstanceDigest)),
    frame.raw32(String(record.targetMutationId)),
    frame.boundedDecimal(String(record.runOrdinal)),
    frame.boundedDecimal(String(record.checkpointOrdinal)),
    frame.raw32(String(record.segmentDigest)),
    frame.raw32(String(record.auditDigest)),
    frame.nullableRaw32(record.priorSelectorTipDigest as string | null),
    frame.nullableRaw32(record.priorSelectorValueDigest as string | null),
    frame.nullableRaw32(record.priorSelectorReceiptDigest as string | null),
    frame.nullableRaw32(record.priorPostSelectionObservationDigest as string | null),
    frame.text(String(record.stage)),
    frame.text(String(record.phase)),
    frame.nullableRaw32(record.terminalResolutionDigest as string | null),
    frame.canonical(record),
  ]);
}

export function parseRunCurrentValue(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, runCurrentValueFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-run-current-value/v1")
    issues.push("schemaVersion:mismatch");
  if (!isCanonicalDecimal(record.runOrdinal)) issues.push("runOrdinal:invalid");
  if (!isCanonicalDecimal(record.checkpointOrdinal)) issues.push("checkpointOrdinal:invalid");
  issues.push(
    ...digestIssues(record, [
      "checkpointCoreDigest",
      "targetMutationId",
      "targetPathInstanceDigest",
    ]),
    ...validateStagePhase(record),
  );
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function validateRunCurrentSelection(
  checkpointCoreInput: unknown,
  runCurrentValueInput: unknown,
): readonly string[] {
  const core = parseRunCheckpointCore(checkpointCoreInput);
  const current = parseRunCurrentValue(runCurrentValueInput);
  if (!core.ok || !current.ok)
    return Object.freeze([
      ...(!core.ok ? core.issues.map((issue) => `core:${issue}`) : []),
      ...(!current.ok ? current.issues.map((issue) => `current:${issue}`) : []),
    ]);
  const issues: string[] = [];
  if (current.value.checkpointCoreDigest !== computeRunCheckpointCoreDigest(core.value))
    issues.push("checkpointCoreDigest:mismatch");
  for (const field of [
    "checkpointOrdinal",
    "phase",
    "runOrdinal",
    "stage",
    "targetMutationId",
    "targetPathInstanceDigest",
    "terminalResolutionDigest",
  ] as const)
    if (current.value[field] !== core.value[field]) issues.push(`${field}:mismatch`);
  return Object.freeze(issues);
}

export function validateRunTerminalResolution(
  checkpointCoreInput: unknown,
  resolutionInput: unknown,
): readonly string[] {
  const core = parseRunCheckpointCore(checkpointCoreInput);
  const resolution = parseCommitResolution(resolutionInput);
  if (!core.ok || !resolution.ok)
    return Object.freeze([
      ...(!core.ok ? core.issues.map((issue) => `core:${issue}`) : []),
      ...(!resolution.ok ? resolution.issues.map((issue) => `resolution:${issue}`) : []),
    ]);
  const issues: string[] = [];
  if (core.value.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION")
    issues.push("pointerKind:rotation-resolution-forbidden");
  if (
    core.value.stage !== "PROPOSAL_CLASSIFIED" &&
    core.value.stage !== "CURRENT_AUTHORITY_POST_CAS_READ"
  )
    issues.push("stage:not-terminal");
  if (core.value.phase !== resolution.value.outcome) issues.push("outcome:phase-mismatch");
  if (core.value.terminalResolutionDigest !== computeCommitResolutionDigest(resolution.value))
    issues.push("terminalResolutionDigest:mismatch");
  for (const field of ["targetMutationId", "targetPathInstanceDigest"] as const)
    if (core.value[field] !== resolution.value[field]) issues.push(`${field}:mismatch`);
  return Object.freeze(issues);
}

const ordinaryResolutionBindingFields = Object.freeze([
  "commitKind",
  "globalIdentityDigest",
  "oldAuthorityPathInstanceDigest",
  "oldAuthorityReceiptDigest",
  "oldAuthorityTipDigest",
  "oldAuthorityValueDigest",
  "outcome",
  "packetAuthorityKind",
  "packetAuthorityPathInstanceDigest",
  "packetAuthorityReceiptDigest",
  "packetAuthorityTipDigest",
  "packetAuthorityValueDigest",
  "priorCheckpointDigest",
  "runId",
  "runOrdinal",
  "targetMutationId",
  "targetPathInstanceDigest",
] as const);

export function validateCommitResolutionBinding(
  resolutionInput: unknown,
  ordinaryCommitBindingInput: unknown,
): readonly string[] {
  const resolution = parseCommitResolution(resolutionInput);
  const binding = snapshotClosedRecord(ordinaryCommitBindingInput, ordinaryResolutionBindingFields);
  if (!resolution.ok || !binding.ok)
    return Object.freeze([
      ...(!resolution.ok ? resolution.issues.map((issue) => `resolution:${issue}`) : []),
      ...(!binding.ok ? binding.issues.map((issue) => `binding:${issue}`) : []),
    ]);
  const expected = binding.value;
  const issues: string[] = [];
  if (expected.commitKind !== "ORDINARY") issues.push("commitKind:not-ordinary");
  if (expected.packetAuthorityKind !== "KNOWN") issues.push("packetAuthorityKind:not-known");
  for (const field of [
    "globalIdentityDigest",
    "oldAuthorityPathInstanceDigest",
    "oldAuthorityReceiptDigest",
    "oldAuthorityTipDigest",
    "oldAuthorityValueDigest",
    "packetAuthorityPathInstanceDigest",
    "packetAuthorityReceiptDigest",
    "packetAuthorityTipDigest",
    "packetAuthorityValueDigest",
    "runId",
    "targetMutationId",
    "targetPathInstanceDigest",
  ] as const)
    if (!isSha256(expected[field])) issues.push(`${field}:invalid`);
  if (expected.priorCheckpointDigest !== null && !isSha256(expected.priorCheckpointDigest))
    issues.push("priorCheckpointDigest:invalid");
  if (!isCanonicalDecimal(expected.runOrdinal)) issues.push("runOrdinal:invalid");
  const equalities = [
    [
      "producerAuthorityPathInstanceDigest",
      "oldAuthorityPathInstanceDigest",
      "packetAuthorityPathInstanceDigest",
    ],
    ["producerAuthorityReceiptDigest", "oldAuthorityReceiptDigest", "packetAuthorityReceiptDigest"],
    ["producerAuthorityTipDigest", "oldAuthorityTipDigest", "packetAuthorityTipDigest"],
    ["producerAuthorityValueDigest", "oldAuthorityValueDigest", "packetAuthorityValueDigest"],
  ] as const;
  for (const [resolutionField, oldField, packetField] of equalities)
    if (
      resolution.value[resolutionField] !== expected[oldField] ||
      resolution.value[resolutionField] !== expected[packetField]
    )
      issues.push(`${resolutionField}:authority-mismatch`);
  for (const field of ["outcome", "targetMutationId", "targetPathInstanceDigest"] as const)
    if (resolution.value[field] !== expected[field]) issues.push(`${field}:mismatch`);
  try {
    const expectedRunId = computeRunId({
      authorityPathInstanceDigest: expected.oldAuthorityPathInstanceDigest,
      authorityReceiptDigest: expected.oldAuthorityReceiptDigest,
      authorityTipDigest: expected.oldAuthorityTipDigest,
      authorityValueDigest: expected.oldAuthorityValueDigest,
      globalIdentityDigest: expected.globalIdentityDigest,
      priorCheckpointDigest: expected.priorCheckpointDigest,
      runOrdinal: expected.runOrdinal,
      targetMutationId: expected.targetMutationId,
    });
    if (expected.runId !== expectedRunId) issues.push("runId:authority-mismatch");
  } catch {
    issues.push("runId:inputs-invalid");
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function validateRunSegmentCore(
  segmentInput: unknown,
  checkpointCoreInput: unknown,
  priorAuditDigest: string | null,
): readonly string[] {
  const segment = parseRunSegment(segmentInput);
  const core = parseRunCheckpointCore(checkpointCoreInput);
  if (!segment.ok || !core.ok)
    return Object.freeze([
      ...(!segment.ok ? segment.issues.map((issue) => `segment:${issue}`) : []),
      ...(!core.ok ? core.issues.map((issue) => `core:${issue}`) : []),
    ]);
  const segmentDigest = computeRunSegmentDigest(segment.value);
  const issues: string[] = [];
  if (core.value.segmentDigest !== segmentDigest) issues.push("segmentDigest:mismatch");
  if (core.value.auditDigest !== computeRunAuditDigest(priorAuditDigest, segmentDigest))
    issues.push("auditDigest:mismatch");
  for (const field of [
    "canonicalPointerPath",
    "globalIdentityDigest",
    "installationId",
    "pointerKind",
    "projectId",
    "runOrdinal",
    "sourceToken",
    "stage",
    "stateRootDigest",
    "targetMutationId",
    "targetPathInstanceDigest",
    "transactionId",
  ] as const)
    if (segment.value[field] !== core.value[field]) issues.push(`${field}:mismatch`);
  return Object.freeze(issues);
}

export function parseRunPostSelectionObservation(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, postSelectionObservationFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-run-selector-post-selection-observation/v1")
    issues.push("schemaVersion:mismatch");
  issues.push(
    ...digestIssues(
      record,
      postSelectionObservationFields.filter((field) => field.endsWith("Digest")),
    ),
  );
  if (!isCanonicalTimestamp(record.observedAt)) issues.push("observedAt:invalid");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeRunPostSelectionObservationDigest(input: unknown): string {
  const parsed = parseRunPostSelectionObservation(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  return framedDigest("pointer-mutation-run-selector-post-selection-observation/v1", [
    frame.raw32(String(record.checkpointCoreDigest)),
    frame.raw32(String(record.selectorPathInstanceDigest)),
    frame.raw32(String(record.selectorMutationId)),
    frame.raw32(String(record.selectorValueDigest)),
    frame.raw32(String(record.selectorReceiptDigest)),
    frame.raw32(String(record.selectorTipDigest)),
    frame.raw32(String(record.valueReadbackDigest)),
    frame.raw32(String(record.proposalReadbackDigest)),
    frame.raw32(String(record.tipReadbackDigest)),
    frame.canonical(record),
  ]);
}

export function computeRunId(input: unknown): string {
  const parsed = snapshotClosedRecord(input, [
    "authorityPathInstanceDigest",
    "authorityReceiptDigest",
    "authorityTipDigest",
    "authorityValueDigest",
    "globalIdentityDigest",
    "priorCheckpointDigest",
    "runOrdinal",
    "targetMutationId",
  ]);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const record = parsed.value;
  const digestFields = [
    "authorityPathInstanceDigest",
    "authorityReceiptDigest",
    "authorityTipDigest",
    "authorityValueDigest",
    "globalIdentityDigest",
    "targetMutationId",
  ] as const;
  if (digestFields.some((field) => !isSha256(record[field])))
    throw new TypeError("runId:digest-invalid");
  if (record.priorCheckpointDigest !== null && !isSha256(record.priorCheckpointDigest))
    throw new TypeError("priorCheckpointDigest:invalid");
  if (!isCanonicalDecimal(record.runOrdinal)) throw new TypeError("runOrdinal:invalid");
  return framedDigest("pointer-mutation-run-id/v1", [
    frame.raw32(String(record.globalIdentityDigest)),
    frame.raw32(String(record.targetMutationId)),
    frame.boundedDecimal(String(record.runOrdinal)),
    frame.nullableRaw32(record.priorCheckpointDigest as string | null),
    frame.raw32(String(record.authorityPathInstanceDigest)),
    frame.raw32(String(record.authorityTipDigest)),
    frame.raw32(String(record.authorityValueDigest)),
    frame.raw32(String(record.authorityReceiptDigest)),
  ]);
}

function requiredDigest(value: string, name: string): string {
  if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

export const commitJournalPaths = Object.freeze({
  intent: (targetPathInstanceDigest: string, targetMutationId: string): string =>
    `installation/pointer-cas/${requiredDigest(targetPathInstanceDigest, "targetPathInstanceDigest")}/commits/${requiredDigest(targetMutationId, "targetMutationId")}/intent.json`,
  checkpoint: (
    targetPathInstanceDigest: string,
    targetMutationId: string,
    checkpointCoreDigest: string,
  ): string =>
    `installation/pointer-cas/${requiredDigest(targetPathInstanceDigest, "targetPathInstanceDigest")}/commits/${requiredDigest(targetMutationId, "targetMutationId")}/checkpoints/${requiredDigest(checkpointCoreDigest, "checkpointCoreDigest")}.json`,
  runSegment: (
    targetPathInstanceDigest: string,
    targetMutationId: string,
    runOrdinal: string,
    runId: string,
  ): string => {
    if (!isCanonicalDecimal(runOrdinal)) throw new TypeError("runOrdinal:invalid");
    return `installation/pointer-cas/${requiredDigest(targetPathInstanceDigest, "targetPathInstanceDigest")}/commits/${requiredDigest(targetMutationId, "targetMutationId")}/runs/${runOrdinal}-${requiredDigest(runId, "runId")}/segment.json`;
  },
  selectorObservation: (
    targetPathInstanceDigest: string,
    targetMutationId: string,
    selectorMutationId: string,
  ): string =>
    `installation/pointer-cas/${requiredDigest(targetPathInstanceDigest, "targetPathInstanceDigest")}/commits/${requiredDigest(targetMutationId, "targetMutationId")}/selector-observations/${requiredDigest(selectorMutationId, "selectorMutationId")}.json`,
  resolution: (targetPathInstanceDigest: string, targetMutationId: string): string =>
    `installation/pointer-cas/${requiredDigest(targetPathInstanceDigest, "targetPathInstanceDigest")}/commits/${requiredDigest(targetMutationId, "targetMutationId")}/resolution.json`,
});

export function validateCommitCheckpointSequence(
  input: unknown,
  commitKind: "ORDINARY" | "AUTHORITY_ROTATION",
): readonly string[] {
  const checkpoints = snapshotClosedArray(input);
  if (!checkpoints.ok) return checkpoints.issues;
  const expectedLength = commitKind === "ORDINARY" ? 9 : 6;
  if (checkpoints.value.length !== expectedLength) return ["checkpoints:length"];
  const issues: string[] = [];
  let first: ContractRecord | undefined;
  let stageSevenPhase: unknown;
  for (let index = 0; index < checkpoints.value.length; index += 1) {
    const parsed = parseRunCheckpointCore(checkpoints.value[index]);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    first ??= record;
    if (record.checkpointOrdinal !== String(index)) issues.push(`${index}:checkpointOrdinal`);
    if (record.stage !== commitRunStages[index]) issues.push(`${index}:stage`);
    for (const field of [
      "canonicalPointerPath",
      "globalIdentityDigest",
      "installationId",
      "pointerKind",
      "projectId",
      "runOrdinal",
      "sourceToken",
      "stateRootDigest",
      "targetMutationId",
      "targetPathInstanceDigest",
      "transactionId",
    ] as const)
      if (record[field] !== first[field]) issues.push(`${index}:${field}`);
    if (index === 7) stageSevenPhase = record.phase;
    if (index === 8 && record.phase !== stageSevenPhase) issues.push("8:phase:not-stage-seven");
  }
  if (first) {
    const rotationTarget = first.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION";
    if ((commitKind === "AUTHORITY_ROTATION") !== rotationTarget)
      issues.push("commitKind:pointerKind-mismatch");
    if (commitKind === "AUTHORITY_ROTATION") {
      for (let index = 0; index < checkpoints.value.length; index += 1) {
        const parsed = parseRunCheckpointCore(checkpoints.value[index]);
        if (parsed.ok && parsed.value.terminalResolutionDigest !== null)
          issues.push(`${index}:terminalResolutionDigest:rotation-forbidden`);
      }
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function parseCommitContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  switch (expectedSchemaVersion) {
    case "pointer-mutation-commit-resolution/v1":
      return parseCommitResolution(input);
    case "pointer-mutation-run-checkpoint-core/v1":
      return parseRunCheckpointCore(input);
    case "pointer-mutation-run-current-value/v1":
      return parseRunCurrentValue(input);
    case "pointer-mutation-run-segment/v1":
      return parseRunSegment(input);
    case "pointer-mutation-run-selector-post-selection-observation/v1":
      return parseRunPostSelectionObservation(input);
    default:
      return undefined;
  }
}

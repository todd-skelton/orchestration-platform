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

export const commitSchemaFields = Object.freeze({
  checkpointCore: checkpointCoreFields,
  runCurrentValue: runCurrentValueFields,
  postSelectionObservation: postSelectionObservationFields,
});
export const commitSchemaVersions = Object.freeze([
  "pointer-mutation-run-checkpoint-core/v1",
  "pointer-mutation-run-current-value/v1",
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

export function parseRunCheckpointCore(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, checkpointCoreFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-mutation-run-checkpoint-core/v1")
    issues.push("schemaVersion:mismatch");
  if (!pointerKinds.includes(record.pointerKind as PointerKind)) issues.push("pointerKind:invalid");
  if (!isContractRelativePath(record.canonicalPointerPath))
    issues.push("canonicalPointerPath:invalid");
  if (!isUuidV7(record.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
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
  const row = pointerRegistry.find((candidate) => candidate.kind === record.pointerKind);
  if (row) {
    if (row.transactionPolicy === "REQUIRED") {
      if (!isUuidV7(record.transactionId)) issues.push("transactionId:invalid");
    } else if (record.transactionId !== null) issues.push("transactionId:must-be-null");
    if (!row.sourceTokens.includes(String(record.sourceToken))) issues.push("sourceToken:invalid");
  }
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
    case "pointer-mutation-run-checkpoint-core/v1":
      return parseRunCheckpointCore(input);
    case "pointer-mutation-run-current-value/v1":
      return parseRunCurrentValue(input);
    case "pointer-mutation-run-selector-post-selection-observation/v1":
      return parseRunPostSelectionObservation(input);
    default:
      return undefined;
  }
}

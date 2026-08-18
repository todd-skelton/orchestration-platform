import { describe, expect, test } from "vitest";
import {
  canonicalDigest,
  commitRunStages,
  commitJournalPaths,
  computeCommitResolutionDigest,
  computeCommitEvidenceDigest,
  computeConflictDigest,
  computeAuthorityHistoryRecordDigest,
  computeCurrentTipDigest,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeRunAuditDigest,
  computeRunCheckpointEvidenceDigest,
  computeRunCheckpointCoreDigest,
  computeRunId,
  computeRunIntentDigest,
  computeRunPostSelectionObservationDigest,
  computeRunSegmentDigest,
  computeRotationInputDigest,
  computeStateMutationGlobalIdentityDigest,
  parseContract,
  parseCommitResolution,
  parseOrdinaryCommitEvidence,
  parseRotationCommitEvidence,
  parsePointerEvidencePacket,
  packetSchemaFields,
  parseRunCheckpointCore,
  parseRunCheckpointEvidence,
  parseRunCurrentValue,
  parseRunIntent,
  parseRunPostSelectionObservation,
  parseRunSegment,
  validateCommitCheckpointSequence,
  validateCommitCheckpointEvidenceSequence,
  validateCommitResolutionBinding,
  validateRunCurrentSelection,
  validateRunSegmentCore,
  validateRunTerminalResolution,
  pointerKinds,
  simplifiedAuthoritySchemaFields,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const stateRootDigest = d("9");

function targetPathInstanceDigest(
  pointerKind: "ACTIVE_RELEASE" | "STATE_MUTATION_AUTHORITY_ROTATION",
): string {
  return computePointerInstanceDigest({
    pointerKind,
    canonicalPointerPath:
      pointerKind === "ACTIVE_RELEASE"
        ? "installation/active-release.json"
        : "installation/state-mutation-authority.json",
    installationId,
    projectId,
    stateRootDigest,
    transactionId: pointerKind === "ACTIVE_RELEASE" ? installationId : null,
    sourceToken: "none",
    positionEvidence: null,
  });
}

const activeReleaseTargetPathInstanceDigest = targetPathInstanceDigest("ACTIVE_RELEASE");
const authorityTargetPathInstanceDigest = targetPathInstanceDigest(
  "STATE_MUTATION_AUTHORITY_ROTATION",
);

function resolution(outcome = "SELECTED") {
  const evidenceDigest =
    outcome === "SELECTED" ? d("1") : outcome === "LOST_CONFLICT" ? d("2") : d("3");
  return {
    conflictReceiptDigest: outcome === "LOST_CONFLICT" ? evidenceDigest : null,
    outcome,
    outcomeEvidenceDigest: evidenceDigest,
    producerAuthorityPathInstanceDigest: d("4"),
    producerAuthorityReceiptDigest: d("5"),
    producerAuthorityTipDigest: d("6"),
    producerAuthorityValueDigest: d("7"),
    resolvedAt: "2026-08-18T14:30:00.000Z",
    schemaVersion: "pointer-mutation-commit-resolution/v1",
    selectedTargetTipDigest: outcome === "SELECTED" ? evidenceDigest : null,
    targetMutationId: d("a"),
    targetPathInstanceDigest: activeReleaseTargetPathInstanceDigest,
    unknownEvidenceDigest: outcome === "UNKNOWN_TERMINAL" ? evidenceDigest : null,
  };
}

function resolutionBinding() {
  const common = {
    commitKind: "ORDINARY",
    globalIdentityDigest: d("8"),
    oldAuthorityPathInstanceDigest: d("4"),
    oldAuthorityReceiptDigest: d("5"),
    oldAuthorityTipDigest: d("6"),
    oldAuthorityValueDigest: d("7"),
    outcome: "SELECTED",
    packetAuthorityKind: "KNOWN",
    packetAuthorityPathInstanceDigest: d("4"),
    packetAuthorityReceiptDigest: d("5"),
    packetAuthorityTipDigest: d("6"),
    packetAuthorityValueDigest: d("7"),
    priorCheckpointEvidence: null,
    runOrdinal: "0",
    targetMutationId: d("a"),
    targetPathInstanceDigest: activeReleaseTargetPathInstanceDigest,
  };
  return {
    ...common,
    runId: computeRunId({
      authorityPathInstanceDigest: common.oldAuthorityPathInstanceDigest,
      authorityReceiptDigest: common.oldAuthorityReceiptDigest,
      authorityTipDigest: common.oldAuthorityTipDigest,
      authorityValueDigest: common.oldAuthorityValueDigest,
      globalIdentityDigest: common.globalIdentityDigest,
      priorCheckpointDigest: null,
      runOrdinal: common.runOrdinal,
      targetMutationId: common.targetMutationId,
    }),
  };
}

function checkpoint(
  index: number,
  pointerKind = "ACTIVE_RELEASE",
  phase = index <= 4 ? "CRASH_PREFIX" : index <= 6 ? "CAS_AMBIGUOUS" : "SELECTED",
) {
  const targetPathInstanceDigest =
    pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
      ? authorityTargetPathInstanceDigest
      : activeReleaseTargetPathInstanceDigest;
  return {
    auditDigest: d("2"),
    canonicalPointerPath:
      pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
        ? "installation/state-mutation-authority.json"
        : "installation/active-release.json",
    checkpointOrdinal: String(index),
    globalIdentityDigest: d("3"),
    installationId,
    phase,
    pointerKind,
    priorPostSelectionObservationDigest: index === 0 ? null : d("4"),
    priorSelectorReceiptDigest: index === 0 ? null : d("5"),
    priorSelectorTipDigest: index === 0 ? null : d("6"),
    priorSelectorValueDigest: index === 0 ? null : d("7"),
    projectId,
    runOrdinal: "0",
    schemaVersion: "pointer-mutation-run-checkpoint-core/v1",
    segmentDigest: d("8"),
    sourceToken: "none",
    stage: commitRunStages[index],
    stateRootDigest,
    targetMutationId: d("a"),
    targetPathInstanceDigest,
    terminalResolutionDigest:
      phase === "SELECTED" || phase === "LOST_CONFLICT" || phase === "UNKNOWN_TERMINAL"
        ? d("c")
        : null,
    transactionId: pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION" ? null : installationId,
  };
}

function checkpointEvidence() {
  return checkpointEvidenceSequence("ORDINARY")[0]!;
}

function ordinaryIntent() {
  return {
    canonicalPointerPath: "installation/active-release.json",
    commitKind: "ORDINARY",
    createdAt: "2026-08-18T15:00:00.000Z",
    globalIdentityDigest: d("1"),
    intentKind: "SINGLE_EPOCH",
    oldAuthorityPathInstanceDigest: d("2"),
    oldAuthorityReceiptDigest: d("3"),
    oldAuthorityTipDigest: d("4"),
    oldAuthorityValueDigest: d("5"),
    schemaVersion: "pointer-mutation-run-intent/v1",
    targetMutationId: d("6"),
    targetPathInstanceDigest: d("7"),
    targetPointerKind: "ACTIVE_RELEASE",
  };
}

function rotationIntent() {
  const rotationInput = {
    globalIdentityDigest: d("1"),
    priorHeadOrdinal: "0",
    priorRecordDigest: d("8"),
    retiringAuthorityPathInstanceDigest: d("2"),
    retiringAuthorityReceiptDigest: d("3"),
    retiringAuthorityTipDigest: d("4"),
    retiringAuthorityValueDigest: d("5"),
    reviewedOperationDigest: d("9"),
    rotationTransactionId: installationId,
    schemaVersion: "state-mutation-authority-rotation-id/v1",
    successorAuthorityOrdinal: "1",
    successorCoreDigest: d("a"),
  };
  const rotationInputDigest = computeRotationInputDigest(rotationInput);
  const expectedRecordDigest = computeAuthorityHistoryRecordDigest({
    globalIdentityDigest: rotationInput.globalIdentityDigest,
    ordinal: rotationInput.successorAuthorityOrdinal,
    predecessorKind: "RECORD",
    priorHeadOrdinal: rotationInput.priorHeadOrdinal,
    priorRecordDigest: rotationInput.priorRecordDigest,
    recordKind: "ROTATION",
    retiringAuthorityPathInstanceDigest: rotationInput.retiringAuthorityPathInstanceDigest,
    retiringAuthorityReceiptDigest: rotationInput.retiringAuthorityReceiptDigest,
    retiringAuthorityTipDigest: rotationInput.retiringAuthorityTipDigest,
    retiringAuthorityValueDigest: rotationInput.retiringAuthorityValueDigest,
    rotationInputDigest,
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest: rotationInput.successorCoreDigest,
  });
  return {
    canonicalPointerPath: "installation/state-mutation-authority.json",
    commitKind: "AUTHORITY_ROTATION",
    createdAt: "2026-08-18T15:01:00.000Z",
    expectedHeadOrdinal: "1",
    expectedRecordDigest,
    expectedSuccessorValueDigest: d("b"),
    globalIdentityDigest: rotationInput.globalIdentityDigest,
    intentKind: "SINGLE_EPOCH",
    oldAuthorityPathInstanceDigest: rotationInput.retiringAuthorityPathInstanceDigest,
    oldAuthorityReceiptDigest: rotationInput.retiringAuthorityReceiptDigest,
    oldAuthorityTipDigest: rotationInput.retiringAuthorityTipDigest,
    oldAuthorityValueDigest: rotationInput.retiringAuthorityValueDigest,
    rotationInput,
    rotationInputDigest,
    schemaVersion: "pointer-mutation-run-intent/v1",
    successorCoreDigest: rotationInput.successorCoreDigest,
    targetMutationId: d("c"),
    targetPathInstanceDigest: d("d"),
    targetPointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
  };
}

type CheckpointEvidenceFixture = {
  core: Record<string, unknown>;
  postSelectionObservation: Record<string, unknown>;
  segment: Record<string, unknown>;
  selectorSelection: {
    proposal: Record<string, unknown>;
    tip: Record<string, unknown>;
    value: Record<string, unknown>;
  };
  terminalResolution: ReturnType<typeof resolution> | null;
};

function checkpointEvidenceSequence(
  commitKind: "ORDINARY" | "AUTHORITY_ROTATION",
  suppliedResolution = resolution(),
  authorityEpoch = {
    path: authorityTargetPathInstanceDigest,
    receipt: d("1"),
    tip: d("2"),
    value: d("3"),
  },
  globalIdentityDigest = d("3"),
  runOrdinal = "0",
  priorCheckpointEvidence: CheckpointEvidenceFixture | null = null,
  targetPathInstanceDigestOverride?: string,
  runIdOverride?: string,
): CheckpointEvidenceFixture[] {
  const length = commitKind === "ORDINARY" ? 9 : 6;
  const targetPointerKind =
    commitKind === "ORDINARY" ? "ACTIVE_RELEASE" : "STATE_MUTATION_AUTHORITY_ROTATION";
  const canonicalPointerPath =
    commitKind === "ORDINARY"
      ? "installation/active-release.json"
      : "installation/state-mutation-authority.json";
  const targetPathInstanceDigest =
    targetPathInstanceDigestOverride ??
    (commitKind === "ORDINARY"
      ? activeReleaseTargetPathInstanceDigest
      : authorityTargetPathInstanceDigest);
  const positionEvidence = {
    mode: "VALUE",
    parts: { targetInstanceDigest: targetPathInstanceDigest, targetMutationId: d("a") },
  } as const;
  const selectorPath = `installation/pointer-cas/${targetPathInstanceDigest}/commits/${d("a")}/current-run.json`;
  const selectorPathInstanceDigest = computePointerInstanceDigest({
    pointerKind: "POINTER_MUTATION_RUN_CURRENT",
    canonicalPointerPath: selectorPath,
    installationId,
    projectId,
    stateRootDigest,
    transactionId: null,
    sourceToken: "none",
    positionEvidence,
  });
  const terminalResolution = suppliedResolution;
  const rows: CheckpointEvidenceFixture[] = [];
  let priorAuditDigest: string | null = null;
  let priorSelectorTipDigest: string | null =
    priorCheckpointEvidence === null
      ? null
      : computeCurrentTipDigest(priorCheckpointEvidence.selectorSelection.tip);
  let priorSelectorValueDigest: string | null =
    priorCheckpointEvidence === null
      ? null
      : String(priorCheckpointEvidence.selectorSelection.tip.valueDigest);
  let priorSelectorReceiptDigest: string | null =
    priorCheckpointEvidence === null
      ? null
      : computeProposalReceiptDigest(priorCheckpointEvidence.selectorSelection.proposal);
  let priorPostSelectionObservationDigest: string | null =
    priorCheckpointEvidence === null
      ? null
      : computeRunPostSelectionObservationDigest(priorCheckpointEvidence.postSelectionObservation);
  const runId =
    runIdOverride ??
    computeRunId({
      authorityPathInstanceDigest: authorityEpoch.path,
      authorityReceiptDigest: authorityEpoch.receipt,
      authorityTipDigest: authorityEpoch.tip,
      authorityValueDigest: authorityEpoch.value,
      globalIdentityDigest,
      priorCheckpointDigest:
        priorCheckpointEvidence === null
          ? null
          : computeRunCheckpointCoreDigest(priorCheckpointEvidence.core),
      runOrdinal,
      targetMutationId: d("a"),
    });
  for (let index = 0; index < length; index += 1) {
    const stage = commitRunStages[index]!;
    const phase =
      index <= 4
        ? "CRASH_PREFIX"
        : index <= 6
          ? "CAS_AMBIGUOUS"
          : String(terminalResolution.outcome);
    const segment = {
      canonicalPointerPath,
      globalIdentityDigest,
      installationId,
      pointerKind: targetPointerKind,
      projectId,
      recordedAt: `2026-08-18T16:00:0${index}.000Z`,
      runId,
      runOrdinal,
      schemaVersion: "pointer-mutation-run-segment/v1",
      sourceToken: "none",
      stage,
      stageEvidenceDigest: d("e"),
      stateRootDigest,
      targetMutationId: d("a"),
      targetPathInstanceDigest,
      transactionId: commitKind === "ORDINARY" ? installationId : null,
    };
    const segmentDigest = computeRunSegmentDigest(segment);
    const auditDigest = computeRunAuditDigest(priorAuditDigest, segmentDigest);
    const applicableResolution =
      commitKind === "ORDINARY" && index >= 7 ? terminalResolution : null;
    const core = {
      ...checkpoint(index, targetPointerKind, phase),
      auditDigest,
      canonicalPointerPath,
      globalIdentityDigest,
      priorPostSelectionObservationDigest,
      priorSelectorReceiptDigest,
      priorSelectorTipDigest,
      priorSelectorValueDigest,
      runOrdinal,
      segmentDigest,
      stage,
      targetPathInstanceDigest,
      terminalResolutionDigest:
        applicableResolution === null ? null : computeCommitResolutionDigest(applicableResolution),
    };
    const coreDigest = computeRunCheckpointCoreDigest(core);
    const value = {
      checkpointCoreDigest: coreDigest,
      checkpointOrdinal: String(index),
      phase,
      runOrdinal,
      schemaVersion: "pointer-mutation-run-current-value/v1",
      stage,
      targetMutationId: d("a"),
      targetPathInstanceDigest,
      terminalResolutionDigest: core.terminalResolutionDigest,
    };
    const valueDigest = computePointerValueDigest(
      "POINTER_MUTATION_RUN_CURRENT",
      selectorPathInstanceDigest,
      value,
    );
    const proposal = {
      authorityEpochReceiptDigest: authorityEpoch.receipt,
      authorityEpochTipDigest: authorityEpoch.tip,
      authorityEpochValueDigest: authorityEpoch.value,
      intent: "VALUE_PROPOSED",
      mutationId: d(String(index)),
      outcome: "SELECT",
      pathInstanceDigest: selectorPathInstanceDigest,
      pointerKind: "POINTER_MUTATION_RUN_CURRENT",
      positionDigest: computePointerPositionDigest(
        "POINTER_MUTATION_RUN_CURRENT",
        positionEvidence,
      ),
      priorReceiptDigest: priorSelectorReceiptDigest,
      priorTipDigest: priorSelectorTipDigest,
      priorValueDigest: priorSelectorValueDigest,
      producerDigest: d("4"),
      producerKind: "SELECTED_EPOCH",
      proposedAt: `2026-08-18T16:01:0${index}.000Z`,
      schemaVersion: "pointer-cas-proposal-receipt/v1",
      successorValueDigest: valueDigest,
    };
    const proposalReceiptDigest = computeProposalReceiptDigest(proposal);
    const tip = {
      pathInstanceDigest: selectorPathInstanceDigest,
      pointerKind: "POINTER_MUTATION_RUN_CURRENT",
      proposalReceiptDigest,
      schemaVersion: "pointer-current-tip/v1",
      valueDigest,
    };
    const selectorTipDigest = computeCurrentTipDigest(tip);
    const observation = {
      checkpointCoreDigest: coreDigest,
      observedAt: `2026-08-18T16:02:0${index}.000Z`,
      proposalReadbackDigest: canonicalDigest(proposal),
      schemaVersion: "pointer-mutation-run-selector-post-selection-observation/v1",
      selectorMutationId: proposal.mutationId,
      selectorPathInstanceDigest,
      selectorReceiptDigest: proposalReceiptDigest,
      selectorTipDigest,
      selectorValueDigest: valueDigest,
      tipReadbackDigest: canonicalDigest(tip),
      valueReadbackDigest: canonicalDigest(value),
    };
    rows.push({
      core,
      postSelectionObservation: observation,
      segment,
      selectorSelection: { proposal, tip, value },
      terminalResolution: applicableResolution,
    });
    priorAuditDigest = auditDigest;
    priorSelectorTipDigest = selectorTipDigest;
    priorSelectorValueDigest = valueDigest;
    priorSelectorReceiptDigest = proposalReceiptDigest;
    priorPostSelectionObservationDigest = computeRunPostSelectionObservationDigest(observation);
  }
  return rows;
}

function ordinaryCommitEvidence(
  outcome = "SELECTED",
  options: {
    authority?: { path: string; receipt: string; tip: string; value: string };
    globalIdentityDigest?: string;
    priorCheckpointEvidence?: CheckpointEvidenceFixture | null;
    runOrdinal?: string;
    runIdOverride?: string;
    targetPathInstanceDigestOverride?: string;
  } = {},
) {
  const targetPathInstanceDigest =
    options.targetPathInstanceDigestOverride ?? activeReleaseTargetPathInstanceDigest;
  const targetMutationId = d("a");
  const authority = options.authority ?? {
    path: authorityTargetPathInstanceDigest,
    receipt: d("1"),
    tip: d("2"),
    value: d("3"),
  };
  const globalIdentityDigest = options.globalIdentityDigest ?? d("3");
  const runOrdinal = options.runOrdinal ?? "0";
  const priorCheckpointEvidence = options.priorCheckpointEvidence ?? null;
  let selectedEvidence: null | {
    proposal: Record<string, unknown>;
    tip: Record<string, unknown>;
    value: Record<string, unknown>;
  } = null;
  let selectedTargetTipDigest: string | null = null;
  if (outcome === "SELECTED") {
    const value = { releaseDigest: d("8"), schemaVersion: "active-release/v1" };
    const valueDigest = computePointerValueDigest(
      "ACTIVE_RELEASE",
      targetPathInstanceDigest,
      value,
    );
    const proposal = {
      authorityEpochReceiptDigest: authority.receipt,
      authorityEpochTipDigest: authority.tip,
      authorityEpochValueDigest: authority.value,
      intent: "VALUE_PROPOSED",
      mutationId: targetMutationId,
      outcome: "SELECT",
      pathInstanceDigest: targetPathInstanceDigest,
      pointerKind: "ACTIVE_RELEASE",
      positionDigest: d("9"),
      priorReceiptDigest: null,
      priorTipDigest: null,
      priorValueDigest: null,
      producerDigest: d("e"),
      producerKind: "SELECTED_EPOCH",
      proposedAt: "2026-08-18T16:10:00.000Z",
      schemaVersion: "pointer-cas-proposal-receipt/v1",
      successorValueDigest: valueDigest,
    };
    const tip = {
      pathInstanceDigest: targetPathInstanceDigest,
      pointerKind: "ACTIVE_RELEASE",
      proposalReceiptDigest: computeProposalReceiptDigest(proposal),
      schemaVersion: "pointer-current-tip/v1",
      valueDigest,
    };
    selectedEvidence = { proposal, tip, value };
    selectedTargetTipDigest = computeCurrentTipDigest(tip);
  }
  const evidenceDigest = outcome === "SELECTED" ? selectedTargetTipDigest! : d("c");
  const ordinaryResolution = {
    conflictReceiptDigest: outcome === "LOST_CONFLICT" ? evidenceDigest : null,
    outcome,
    outcomeEvidenceDigest: evidenceDigest,
    producerAuthorityPathInstanceDigest: authority.path,
    producerAuthorityReceiptDigest: authority.receipt,
    producerAuthorityTipDigest: authority.tip,
    producerAuthorityValueDigest: authority.value,
    resolvedAt: "2026-08-18T16:11:00.000Z",
    schemaVersion: "pointer-mutation-commit-resolution/v1",
    selectedTargetTipDigest,
    targetMutationId,
    targetPathInstanceDigest,
    unknownEvidenceDigest: outcome === "UNKNOWN_TERMINAL" ? evidenceDigest : null,
  };
  const checkpoints = checkpointEvidenceSequence(
    "ORDINARY",
    ordinaryResolution,
    authority,
    globalIdentityDigest,
    runOrdinal,
    priorCheckpointEvidence,
    options.targetPathInstanceDigestOverride,
    options.runIdOverride,
  );
  return {
    canonicalPointerPath: "installation/active-release.json",
    checkpoints,
    commitKind: "ORDINARY",
    intentDigest: d("f"),
    oldAuthorityPathInstanceDigest: authority.path,
    oldAuthorityReceiptDigest: authority.receipt,
    oldAuthorityTipDigest: authority.tip,
    oldAuthorityValueDigest: authority.value,
    ordinaryResolution,
    outcome,
    packetAuthorityKind: "KNOWN",
    packetAuthorityPathInstanceDigest: authority.path,
    packetAuthorityReceiptDigest: authority.receipt,
    packetAuthorityTipDigest: authority.tip,
    packetAuthorityValueDigest: authority.value,
    priorCheckpointEvidence,
    runId: String(checkpoints[0]!.segment.runId),
    runOrdinal,
    schemaVersion: "pointer-mutation-commit-evidence/v1",
    targetMutationId,
    targetPathInstanceDigest,
    targetPointerKind: "ACTIVE_RELEASE",
    targetRegistrySlot: {
      pointerKind: "ACTIVE_RELEASE",
      schemaVersion: "pointer-evidence-slot/v1",
      selectedEvidence,
    },
  };
}

function lostOrdinaryCommitEvidence(options: Parameters<typeof ordinaryCommitEvidence>[1] = {}) {
  const selected = ordinaryCommitEvidence("SELECTED", options);
  const selectedGraph = selected.targetRegistrySlot.selectedEvidence as {
    proposal: Record<string, unknown>;
    tip: Record<string, unknown>;
    value: Record<string, unknown>;
  };
  const losingProposal = selectedGraph.proposal;
  const winnerProposal = { ...losingProposal, mutationId: d("8") };
  const winningReceiptDigest = computeProposalReceiptDigest(winnerProposal);
  const winnerTip = {
    ...selectedGraph.tip,
    proposalReceiptDigest: winningReceiptDigest,
  };
  const conflictReceipt = {
    authorityEpochReceiptDigest: losingProposal.authorityEpochReceiptDigest,
    authorityEpochTipDigest: losingProposal.authorityEpochTipDigest,
    authorityEpochValueDigest: losingProposal.authorityEpochValueDigest,
    conflictAt: "2026-08-18T16:12:00.000Z",
    conflictKind: "VALUE_CONFLICT",
    losingProposalReceiptDigest: computeProposalReceiptDigest(losingProposal),
    losingSuccessorValueDigest: losingProposal.successorValueDigest,
    mutationId: selected.targetMutationId,
    pathInstanceDigest: selected.targetPathInstanceDigest,
    schemaVersion: "pointer-conflict-receipt/v1",
    winningReceiptDigest,
    winningTipDigest: computeCurrentTipDigest(winnerTip),
    winningValueDigest: selectedGraph.tip.valueDigest,
  };
  const conflictReceiptDigest = computeConflictDigest(conflictReceipt);
  const ordinaryResolution = {
    ...selected.ordinaryResolution,
    conflictReceiptDigest,
    outcome: "LOST_CONFLICT",
    outcomeEvidenceDigest: conflictReceiptDigest,
    selectedTargetTipDigest: null,
  };
  return {
    ...selected,
    checkpoints: checkpointEvidenceSequence(
      "ORDINARY",
      ordinaryResolution,
      {
        path: selected.oldAuthorityPathInstanceDigest,
        receipt: selected.oldAuthorityReceiptDigest,
        tip: selected.oldAuthorityTipDigest,
        value: selected.oldAuthorityValueDigest,
      },
      options.globalIdentityDigest ?? d("3"),
      options.runOrdinal ?? "0",
      options.priorCheckpointEvidence ?? null,
      options.targetPathInstanceDigestOverride,
      options.runIdOverride,
    ),
    ordinaryResolution,
    outcome: "LOST_CONFLICT",
    targetRegistrySlot: {
      ...selected.targetRegistrySlot,
      selectedEvidence: {
        conflictReceipt,
        losingProposal,
        schemaVersion: "pointer-mutation-conflict-evidence/v1",
        selectedWinner: {
          proposal: winnerProposal,
          tip: winnerTip,
          value: selectedGraph.value,
        },
        targetMutationId: selected.targetMutationId,
        targetPathInstanceDigest: selected.targetPathInstanceDigest,
      },
    },
  };
}

function authoritySelection(
  headOrdinal: string,
  headRecordDigest: string,
  prior: { tip: string; value: string; receipt: string } | null,
  globalIdentityDigest = d("3"),
) {
  const pathInstanceDigest = authorityTargetPathInstanceDigest;
  const value = {
    activeReleasePathInstanceDigest: d("1"),
    activeReleaseReceiptDigest: d("2"),
    activeReleaseTipDigest: d("3"),
    activeReleaseValueDigest: d("4"),
    admittedCustodyObservationDigest: d("5"),
    authorityOrdinal: headOrdinal,
    custodyInstanceDigest: d("6"),
    globalIdentityDigest,
    headOrdinal,
    headRecordDigest,
    helperAbiDigest: d("7"),
    helperDigest: d("8"),
    helperProfileDigest: d("9"),
    installationId,
    lockProfileDigest: d("a"),
    priorAuthorityReceiptDigest: prior?.receipt ?? null,
    priorAuthorityTipDigest: prior?.tip ?? null,
    priorAuthorityValueDigest: prior?.value ?? null,
    projectId,
    schemaVersion: "state-mutation-authority-value/v1",
    stateComponentProfileDigest: d("b"),
    stateRootDigest: d("9"),
  };
  const valueDigest = computePointerValueDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    pathInstanceDigest,
    value,
  );
  const proposal = {
    authorityEpochReceiptDigest: prior?.receipt ?? d("c"),
    authorityEpochTipDigest: prior?.tip ?? d("d"),
    authorityEpochValueDigest: prior?.value ?? d("e"),
    intent: "VALUE_PROPOSED",
    mutationId: d(headOrdinal === "0" ? "5" : "6"),
    outcome: "SELECT",
    pathInstanceDigest,
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
    positionDigest: d("f"),
    priorReceiptDigest: prior?.receipt ?? null,
    priorTipDigest: prior?.tip ?? null,
    priorValueDigest: prior?.value ?? null,
    producerDigest: d("0"),
    producerKind: "SELECTED_EPOCH",
    proposedAt: `2026-08-18T16:2${headOrdinal}:00.000Z`,
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    successorValueDigest: valueDigest,
  };
  const receiptDigest = computeProposalReceiptDigest(proposal);
  const tip = {
    pathInstanceDigest,
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
    proposalReceiptDigest: receiptDigest,
    schemaVersion: "pointer-current-tip/v1",
    valueDigest,
  };
  return {
    proposal,
    receiptDigest,
    selectedEvidence: { proposal, tip, value },
    tipDigest: computeCurrentTipDigest(tip),
    value,
    valueDigest,
    pathInstanceDigest,
  };
}

function rotationCommitEvidence(
  outcome: "RESUMABLE" | "SELECTED" | "UNKNOWN",
  options: { globalIdentityDigest?: string; priorRecordDigest?: string } = {},
) {
  const globalIdentityDigest = options.globalIdentityDigest ?? d("3");
  const priorRecordDigest = options.priorRecordDigest ?? d("7");
  const old = authoritySelection("0", priorRecordDigest, null, globalIdentityDigest);
  const rotationInputDigest = d("8");
  const successorCoreDigest = d("9");
  const pendingRecord = {
    globalIdentityDigest,
    ordinal: "1",
    predecessorKind: "RECORD",
    priorHeadOrdinal: "0",
    priorRecordDigest,
    recordKind: "ROTATION",
    retiringAuthorityPathInstanceDigest: old.pathInstanceDigest,
    retiringAuthorityReceiptDigest: old.receiptDigest,
    retiringAuthorityTipDigest: old.tipDigest,
    retiringAuthorityValueDigest: old.valueDigest,
    rotationInputDigest,
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest,
  };
  const expectedRecordDigest = computeAuthorityHistoryRecordDigest(pendingRecord);
  const successor = authoritySelection(
    "1",
    expectedRecordDigest,
    {
      receipt: old.receiptDigest,
      tip: old.tipDigest,
      value: old.valueDigest,
    },
    globalIdentityDigest,
  );
  const checkpoint5 = checkpointEvidenceSequence(
    "AUTHORITY_ROTATION",
    resolution(),
    {
      path: old.pathInstanceDigest,
      receipt: old.receiptDigest,
      tip: old.tipDigest,
      value: old.valueDigest,
    },
    globalIdentityDigest,
  )[5];
  const common = {
    authorityRegistrySlot: {
      pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      schemaVersion: "pointer-evidence-slot/v1",
      selectedEvidence:
        outcome === "RESUMABLE"
          ? old.selectedEvidence
          : outcome === "SELECTED"
            ? successor.selectedEvidence
            : null,
    },
    canonicalPointerPath: "installation/state-mutation-authority.json",
    checkpoint5,
    commitKind: "AUTHORITY_ROTATION",
    expectedHeadOrdinal: "1",
    expectedRecordDigest,
    expectedSuccessorValueDigest: successor.valueDigest,
    intentDigest: d("a"),
    oldAuthorityPathInstanceDigest: old.pathInstanceDigest,
    oldAuthorityReceiptDigest: old.receiptDigest,
    oldAuthorityTipDigest: old.tipDigest,
    oldAuthorityValueDigest: old.valueDigest,
    packetAuthorityKind: outcome === "UNKNOWN" ? "UNKNOWN" : "KNOWN",
    packetAuthorityPathInstanceDigest:
      outcome === "UNKNOWN"
        ? null
        : outcome === "RESUMABLE"
          ? old.pathInstanceDigest
          : successor.pathInstanceDigest,
    packetAuthorityReceiptDigest:
      outcome === "UNKNOWN"
        ? null
        : outcome === "RESUMABLE"
          ? old.receiptDigest
          : successor.receiptDigest,
    packetAuthorityTipDigest:
      outcome === "UNKNOWN" ? null : outcome === "RESUMABLE" ? old.tipDigest : successor.tipDigest,
    packetAuthorityValueDigest:
      outcome === "UNKNOWN"
        ? null
        : outcome === "RESUMABLE"
          ? old.valueDigest
          : successor.valueDigest,
    priorCheckpointEvidence: null,
    rotationInputDigest,
    rotationOutcome: outcome,
    runId: String(checkpoint5!.segment.runId),
    runOrdinal: "0",
    schemaVersion: "pointer-mutation-commit-evidence/v1",
    successorCoreDigest,
    targetMutationId: d("a"),
    targetPathInstanceDigest: authorityTargetPathInstanceDigest,
    targetPointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
  };
  if (outcome === "RESUMABLE")
    return {
      ...common,
      headPlusTwoAbsent: true,
      pendingRecord,
      pendingRecordReadbackDigest: canonicalDigest(pendingRecord),
      resumableOldAuthorityPathInstanceDigest: old.pathInstanceDigest,
      resumableOldAuthorityReceiptDigest: old.receiptDigest,
      resumableOldAuthorityTipDigest: old.tipDigest,
      resumableOldAuthorityValueDigest: old.valueDigest,
      resumablePriorHeadOrdinal: "0",
      resumablePriorRecordDigest: priorRecordDigest,
    };
  if (outcome === "SELECTED")
    return {
      ...common,
      selectedHistoryRecord: pendingRecord,
      selectedHistoryRecordReadbackDigest: canonicalDigest(pendingRecord),
      selectedSuccessorAuthorityPathInstanceDigest: successor.pathInstanceDigest,
      selectedSuccessorAuthorityReceiptDigest: successor.receiptDigest,
      selectedSuccessorAuthorityTipDigest: successor.tipDigest,
      selectedSuccessorAuthorityValue: successor.value,
      selectedSuccessorAuthorityValueDigest: successor.valueDigest,
      selectedSuccessorValueReadbackDigest: canonicalDigest(successor.value),
    };
  return {
    ...common,
    unknownEvidence: {
      category: "UNREADABLE",
      observationDigest: d("c"),
      observedAt: "2026-08-18T16:30:00.000Z",
      observedByteLength: "0",
      reason: "MISSING",
      schemaVersion: "pointer-mutation-unknown-evidence/v1",
      targetMutationId: d("a"),
      targetPathInstanceDigest: authorityTargetPathInstanceDigest,
    },
  };
}

function packetGlobalIdentity() {
  return {
    authorityPath: "installation/state-mutation-authority.json",
    authorityPathInstanceDigest: authorityTargetPathInstanceDigest,
    custodyInstanceDigest: d("6"),
    installationId,
    projectId,
    schemaVersion: "state-mutation-global-identity/v1",
    stateRootDigest: d("9"),
  };
}

function packetGenesis(globalIdentityDigest: string) {
  const record = {
    genesisBootstrapInputDigest: d("1"),
    globalIdentityDigest,
    ordinal: "0",
    predecessorKind: "GENESIS_LITERAL",
    recordKind: "GENESIS",
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest: d("2"),
  };
  const recordDigest = computeAuthorityHistoryRecordDigest(record);
  const genesisSelectionEvidence = {
    ...Object.fromEntries(
      simplifiedAuthoritySchemaFields.genesisSelectionEvidence
        .filter((field) => field.endsWith("Digest"))
        .map((field) => [field, d("1")]),
    ),
    bootstrapTransactionId: installationId,
    genesisBootstrapInputDigest: record.genesisBootstrapInputDigest,
    historyRecordDigest: recordDigest,
    schemaVersion: "authority-history-genesis-selection-evidence/v1",
    successorCoreDigest: record.successorCoreDigest,
  };
  return { genesisSelectionEvidence, record, recordDigest };
}

function registrySlots(authoritySlot: Record<string, unknown>) {
  return pointerKinds.map((pointerKind) =>
    pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
      ? authoritySlot
      : {
          pointerKind,
          schemaVersion: "pointer-evidence-slot/v1",
          selectedEvidence: null,
        },
  );
}

function rotationPacket(outcome: "RESUMABLE" | "SELECTED" | "UNKNOWN") {
  const globalIdentity = packetGlobalIdentity();
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(globalIdentity);
  const genesis = packetGenesis(globalIdentityDigest);
  const currentCommit = rotationCommitEvidence(outcome, {
    globalIdentityDigest,
    priorRecordDigest: genesis.recordDigest,
  });
  const positive = outcome !== "UNKNOWN";
  const selected = outcome === "SELECTED";
  const selectedHistoryRecord = (currentCommit as unknown as Record<string, unknown>)[
    "selectedHistoryRecord"
  ];
  const records = selected ? [genesis.record, selectedHistoryRecord] : [genesis.record];
  const authorityHistoryBinding = positive
    ? {
        genesisSelectionEvidence: genesis.genesisSelectionEvidence,
        globalIdentityDigest,
        headOrdinal: selected ? "1" : "0",
        headRecordDigest: selected ? currentCommit.expectedRecordDigest : genesis.recordDigest,
        records,
        schemaVersion: "authority-history-binding/v1",
      }
    : null;
  return {
    authorityHistoryBinding,
    currentAuthoritySelection: positive
      ? currentCommit.authorityRegistrySlot.selectedEvidence
      : null,
    currentCommit,
    evidenceSlots: registrySlots(currentCommit.authorityRegistrySlot),
    globalIdentity,
    purpose: "MUTATION_COMMIT",
    schemaVersion: "pointer-evidence-packet/v1",
  };
}

function ordinaryPacket(outcome: "SELECTED" | "LOST_CONFLICT" | "UNKNOWN_TERMINAL") {
  const base = rotationPacket("RESUMABLE");
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(base.globalIdentity);
  const authority = {
    path: String(base.currentCommit.packetAuthorityPathInstanceDigest),
    receipt: String(base.currentCommit.packetAuthorityReceiptDigest),
    tip: String(base.currentCommit.packetAuthorityTipDigest),
    value: String(base.currentCommit.packetAuthorityValueDigest),
  };
  const options = { authority, globalIdentityDigest };
  const currentCommit =
    outcome === "LOST_CONFLICT"
      ? lostOrdinaryCommitEvidence(options)
      : ordinaryCommitEvidence(outcome, options);
  return {
    ...base,
    currentCommit,
    evidenceSlots: base.evidenceSlots.map((slot) =>
      slot.pointerKind === "ACTIVE_RELEASE" ? currentCommit.targetRegistrySlot : slot,
    ),
  };
}

describe("single-epoch commit journal atoms", () => {
  test("closes create-once ordinary and armed rotation intents", () => {
    const ordinary = ordinaryIntent();
    expect(parseRunIntent(ordinary).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-intent/v1", ordinary).ok).toBe(true);
    expect(computeRunIntentDigest(ordinary)).toBe(
      "298527b9b388e337e80e15b263bda138a0021aeebb57de97eb95b7514e90c4a0",
    );

    const rotation = rotationIntent();
    expect(parseRunIntent(rotation).ok).toBe(true);
    expect(computeRunIntentDigest(rotation)).toBe(
      "590bdd7fa4ecde5e5e6981fea727e6116601efae15e80e8a4a9575d4f2fbd272",
    );
    expect(parseRunIntent({ ...ordinary, rotationInputDigest: d("f") }).ok).toBe(false);
    expect(
      parseRunIntent({
        ...ordinary,
        targetPointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      }).ok,
    ).toBe(false);
    expect(parseRunIntent({ ...rotation, expectedRecordDigest: d("f") }).ok).toBe(false);
    expect(parseRunIntent({ ...rotation, oldAuthorityTipDigest: d("f") }).ok).toBe(false);
    expect(parseRunIntent({ ...rotation, epochKey: d("f") }).ok).toBe(false);
  });

  test("closes ordinary resolution arms and binds the selected producer epoch", () => {
    const selected = resolution();
    expect(parseCommitResolution(selected).ok).toBe(true);
    expect(parseContract("pointer-mutation-commit-resolution/v1", selected).ok).toBe(true);
    expect(computeCommitResolutionDigest(selected)).toBe(
      "b57507749780a77894c92a030d45b340a9b26a3c73f9f4990eca698fc7a697c7",
    );
    expect(validateCommitResolutionBinding(selected, resolutionBinding())).toEqual([]);

    for (const outcome of ["LOST_CONFLICT", "UNKNOWN_TERMINAL"])
      expect(parseCommitResolution(resolution(outcome)).ok).toBe(true);
    expect(parseCommitResolution({ ...selected, outcomeEvidenceDigest: d("9") }).ok).toBe(false);
    expect(parseCommitResolution({ ...selected, conflictReceiptDigest: d("2") }).ok).toBe(false);
    expect(parseCommitResolution({ ...selected, producerEpochKey: d("f") }).ok).toBe(false);
    for (const field of [
      "producerAuthorityPathInstanceDigest",
      "producerAuthorityReceiptDigest",
      "producerAuthorityTipDigest",
      "producerAuthorityValueDigest",
    ] as const) {
      expect(parseCommitResolution({ ...selected, [field]: null }).ok).toBe(false);
      const missing = { ...selected } as Record<string, unknown>;
      delete missing[field];
      expect(parseCommitResolution(missing).ok).toBe(false);
    }

    const wrongResolutionTuple = {
      ...selected,
      producerAuthorityPathInstanceDigest: d("9"),
      producerAuthorityReceiptDigest: d("a"),
      producerAuthorityTipDigest: d("b"),
      producerAuthorityValueDigest: d("c"),
    };
    expect(validateCommitResolutionBinding(wrongResolutionTuple, resolutionBinding())).toEqual([
      "producerAuthorityPathInstanceDigest:authority-mismatch",
      "producerAuthorityReceiptDigest:authority-mismatch",
      "producerAuthorityTipDigest:authority-mismatch",
      "producerAuthorityValueDigest:authority-mismatch",
    ]);
    const coordinatedBinding = {
      ...resolutionBinding(),
      oldAuthorityPathInstanceDigest: d("9"),
      packetAuthorityPathInstanceDigest: d("9"),
    };
    expect(validateCommitResolutionBinding(selected, coordinatedBinding)).toContain(
      "runId:authority-mismatch",
    );
  });

  test("binds terminal resolution before the run-current selector and forbids rotation", () => {
    const selected = resolution();
    const digest = computeCommitResolutionDigest(selected);
    const terminalCore = { ...checkpoint(7), terminalResolutionDigest: digest };
    expect(validateRunTerminalResolution(terminalCore, selected)).toEqual([]);
    expect(
      validateRunTerminalResolution({ ...terminalCore, targetMutationId: d("d") }, selected),
    ).toContain("targetMutationId:mismatch");
    expect(
      validateRunTerminalResolution(
        {
          ...terminalCore,
          canonicalPointerPath: "installation/state-mutation-authority.json",
          pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
          transactionId: null,
        },
        selected,
      ),
    ).toContain("pointerKind:rotation-resolution-forbidden");
  });

  test("constructs only digest- and ordinal-derived journal paths", () => {
    expect(commitJournalPaths.intent(d("1"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/intent.json`,
    );
    expect(commitJournalPaths.checkpoint(d("1"), d("2"), d("3"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/checkpoints/${d("3")}.json`,
    );
    expect(commitJournalPaths.runSegment(d("1"), d("2"), "9007199254740991", d("4"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/runs/9007199254740991-${d("4")}/segment.json`,
    );
    expect(commitJournalPaths.selectorObservation(d("1"), d("2"), d("5"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/selector-observations/${d("5")}.json`,
    );
    expect(commitJournalPaths.resolution(d("1"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/resolution.json`,
    );
    expect(() =>
      commitJournalPaths.runSegment(d("1"), d("2"), "9007199254740992", d("4")),
    ).toThrow();
    expect(() => commitJournalPaths.intent(d("z"), d("2"))).toThrow();
  });

  test("chains immutable segments into the checkpoint core audit", () => {
    const runId = computeRunId({
      authorityPathInstanceDigest: d("1"),
      authorityReceiptDigest: d("2"),
      authorityTipDigest: d("3"),
      authorityValueDigest: d("4"),
      globalIdentityDigest: d("3"),
      priorCheckpointDigest: null,
      runOrdinal: "0",
      targetMutationId: d("a"),
    });
    const segment = {
      canonicalPointerPath: "installation/active-release.json",
      globalIdentityDigest: d("3"),
      installationId,
      pointerKind: "ACTIVE_RELEASE",
      projectId,
      recordedAt: "2026-08-18T13:59:00.000Z",
      runId,
      runOrdinal: "0",
      schemaVersion: "pointer-mutation-run-segment/v1",
      sourceToken: "none",
      stage: "CURRENT_AUTHORITY_READ",
      stageEvidenceDigest: d("d"),
      stateRootDigest: d("9"),
      targetMutationId: d("a"),
      targetPathInstanceDigest: activeReleaseTargetPathInstanceDigest,
      transactionId: installationId,
    };
    const segmentDigest = computeRunSegmentDigest(segment);
    const auditDigest = computeRunAuditDigest(null, segmentDigest);
    expect(parseRunSegment(segment).ok).toBe(true);
    expect(segmentDigest).toBe("7fdb4f47eaad28557694fb3341b413ee2c839aee496c2ac176efaf87e45378b4");
    expect(auditDigest).toBe("8272e1363b0c40dde3ddc633702fe5f2a90a7c7030e494a32bd68a7d6c9efc8d");
    const core = { ...checkpoint(0), segmentDigest, auditDigest };
    expect(validateRunSegmentCore(segment, core, null)).toEqual([]);
    expect(validateRunSegmentCore(segment, { ...core, segmentDigest: d("e") }, null)).toContain(
      "segmentDigest:mismatch",
    );
    expect(parseRunSegment({ ...segment, recordedAt: "2026-08-18" }).ok).toBe(false);
  });

  test("parses and hashes the exact checkpoint core and selected run-current projection", () => {
    const core = checkpoint(0);
    expect(parseRunCheckpointCore(core).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-checkpoint-core/v1", core).ok).toBe(true);
    expect(computeRunCheckpointCoreDigest(core)).toBe(
      "8e8af4b8e23d1c4c77a99601603b45ca20f53957ef5ca15aa66c2f39df422bf2",
    );

    const current = {
      checkpointCoreDigest: computeRunCheckpointCoreDigest(core),
      checkpointOrdinal: "0",
      phase: "CRASH_PREFIX",
      runOrdinal: "0",
      schemaVersion: "pointer-mutation-run-current-value/v1",
      stage: "CURRENT_AUTHORITY_READ",
      targetMutationId: d("a"),
      targetPathInstanceDigest: activeReleaseTargetPathInstanceDigest,
      terminalResolutionDigest: null,
    };
    expect(parseRunCurrentValue(current).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-current-value/v1", current).ok).toBe(true);
    expect(validateRunCurrentSelection(core, current)).toEqual([]);
    expect(validateRunCurrentSelection(core, { ...current, targetMutationId: d("d") })).toContain(
      "targetMutationId:mismatch",
    );
  });

  test("binds the downstream selector observation without feeding it back into the core", () => {
    const observation = {
      checkpointCoreDigest: computeRunCheckpointCoreDigest(checkpoint(0)),
      observedAt: "2026-08-18T14:00:00.000Z",
      proposalReadbackDigest: d("1"),
      schemaVersion: "pointer-mutation-run-selector-post-selection-observation/v1",
      selectorMutationId: d("2"),
      selectorPathInstanceDigest: d("3"),
      selectorReceiptDigest: d("4"),
      selectorTipDigest: d("5"),
      selectorValueDigest: d("6"),
      tipReadbackDigest: d("7"),
      valueReadbackDigest: d("8"),
    };
    expect(parseRunPostSelectionObservation(observation).ok).toBe(true);
    expect(computeRunPostSelectionObservationDigest(observation)).toBe(
      "606f4558c4435c0377b480c73b84bc75aa8887468c685ca4ac8908a11c324c94",
    );
    expect(parseRunPostSelectionObservation({ ...observation, nextCoreDigest: d("9") }).ok).toBe(
      false,
    );
  });

  test("composes a closed acyclic checkpoint-evidence record", () => {
    const evidence = checkpointEvidence();
    expect(parseRunCheckpointEvidence(evidence).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-checkpoint-evidence/v1", evidence).ok).toBe(true);
    expect(computeRunCheckpointEvidenceDigest(evidence)).toBe(
      "6457e82da1e10ca5f3dd52084961d82739b80c992f6546c8ae2715e114ca46cb",
    );
    expect(
      parseRunCheckpointEvidence({
        ...evidence,
        selectorSelection: {
          ...evidence.selectorSelection,
          tip: { ...evidence.selectorSelection.tip, valueDigest: d("f") },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseRunCheckpointEvidence({
        ...evidence,
        postSelectionObservation: {
          ...evidence.postSelectionObservation,
          valueReadbackDigest: d("f"),
        },
      }).ok,
    ).toBe(false);
    expect(parseRunCheckpointEvidence({ ...evidence, terminalResolution: resolution() }).ok).toBe(
      false,
    );
    expect(parseRunCheckpointEvidence({ ...evidence, schemaVersion: "v1" }).ok).toBe(false);
  });

  test("derives run identity from one selected authority epoch and bounded ordinal", () => {
    const projection = {
      authorityPathInstanceDigest: d("1"),
      authorityReceiptDigest: d("2"),
      authorityTipDigest: d("3"),
      authorityValueDigest: d("4"),
      globalIdentityDigest: d("5"),
      priorCheckpointDigest: null,
      runOrdinal: "9007199254740991",
      targetMutationId: d("6"),
    };
    expect(computeRunId(projection)).toBe(
      "0bcf3fa8e16fec02be7464fb70d164b2d6b09292b0b1b566d265dda12aaa6ed9",
    );
    expect(() => computeRunId({ ...projection, runOrdinal: "9007199254740992" })).toThrow();
    expect(() => computeRunId({ ...projection, priorCheckpointDigest: d("z") })).toThrow();
  });

  test("admits exactly the ordinary nine-stage and rotation six-stage prefixes", () => {
    const ordinary = Array.from({ length: 9 }, (_, index) => checkpoint(index));
    expect(validateCommitCheckpointSequence(ordinary, "ORDINARY")).toEqual([]);

    const rotation = Array.from({ length: 6 }, (_, index) =>
      checkpoint(index, "STATE_MUTATION_AUTHORITY_ROTATION"),
    );
    expect(validateCommitCheckpointSequence(rotation, "AUTHORITY_ROTATION")).toEqual([]);
    expect(validateCommitCheckpointSequence(ordinary.slice(0, 8), "ORDINARY")).toContain(
      "checkpoints:length",
    );
    expect(validateCommitCheckpointSequence(rotation, "ORDINARY")).toContain("checkpoints:length");
    expect(
      validateCommitCheckpointSequence(
        ordinary.map((row, index) =>
          index === 8 ? { ...row, phase: "LOST_CONFLICT", terminalResolutionDigest: d("d") } : row,
        ),
        "ORDINARY",
      ),
    ).toContain("8:phase:not-stage-seven");
  });

  test("validates the complete selected checkpoint evidence and audit chain", () => {
    const ordinary = checkpointEvidenceSequence("ORDINARY");
    const rotation = checkpointEvidenceSequence("AUTHORITY_ROTATION");
    expect(validateCommitCheckpointEvidenceSequence(ordinary, "ORDINARY")).toEqual([]);
    expect(validateCommitCheckpointEvidenceSequence(rotation, "AUTHORITY_ROTATION")).toEqual([]);
    expect(
      validateCommitCheckpointEvidenceSequence(
        ordinary.map((row, index) =>
          index === 3
            ? {
                ...row,
                core: { ...row.core, priorSelectorTipDigest: d("f") },
              }
            : row,
        ),
        "ORDINARY",
      ),
    ).not.toEqual([]);
    expect(
      validateCommitCheckpointEvidenceSequence(
        ordinary.map((row, index) =>
          index === 4
            ? {
                ...row,
                selectorSelection: {
                  ...row.selectorSelection,
                  proposal: {
                    ...row.selectorSelection.proposal,
                    authorityEpochTipDigest: d("f"),
                  },
                },
              }
            : row,
        ),
        "ORDINARY",
      ),
    ).not.toEqual([]);
  });

  test("closes the ordinary commit arm and outcome-to-slot equalities", () => {
    const selected = ordinaryCommitEvidence();
    expect(parseOrdinaryCommitEvidence(selected).ok).toBe(true);
    expect(parseContract("pointer-mutation-commit-evidence/v1", selected).ok).toBe(true);
    const unknown = ordinaryCommitEvidence("UNKNOWN_TERMINAL");
    expect(parseOrdinaryCommitEvidence(unknown).ok).toBe(true);
    const lost = lostOrdinaryCommitEvidence();
    expect(parseOrdinaryCommitEvidence(lost).ok).toBe(true);
    const priorCheckpointEvidence = selected.checkpoints[6]!;
    const retry = ordinaryCommitEvidence("SELECTED", {
      priorCheckpointEvidence,
      runOrdinal: "1",
    });
    expect(parseOrdinaryCommitEvidence(retry).ok).toBe(true);
    expect(computeCommitEvidenceDigest(retry)).toBe(
      "99579f5627884e1a68e071e1b9f2faa181199e08532acd8d2bd7a3d39390e58c",
    );
    expect(parseOrdinaryCommitEvidence({ ...retry, priorCheckpointEvidence: null }).ok).toBe(false);
    expect(
      parseOrdinaryCommitEvidence({
        ...retry,
        priorCheckpointEvidence: {
          ...priorCheckpointEvidence,
          core: { ...priorCheckpointEvidence.core, runOrdinal: "1" },
        },
      }).ok,
    ).toBe(false);
    const coordinatedWrongTarget = ordinaryCommitEvidence("SELECTED", {
      targetPathInstanceDigestOverride: d("0"),
    });
    const coordinatedWrongTargetResult = parseOrdinaryCommitEvidence(coordinatedWrongTarget);
    expect(coordinatedWrongTargetResult.ok).toBe(false);
    if (!coordinatedWrongTargetResult.ok)
      expect(coordinatedWrongTargetResult.issues).toContain(
        "checkpoints:0:targetPathInstanceDigest:derived-mismatch",
      );
    const coordinatedWrongRun = ordinaryCommitEvidence("SELECTED", {
      runIdOverride: d("0"),
    });
    const coordinatedWrongRunResult = parseOrdinaryCommitEvidence(coordinatedWrongRun);
    expect(coordinatedWrongRunResult.ok).toBe(false);
    if (!coordinatedWrongRunResult.ok)
      expect(coordinatedWrongRunResult.issues).toContain("runId:derived-mismatch");
    expect(
      parseOrdinaryCommitEvidence({
        ...selected,
        packetAuthorityPathInstanceDigest: d("0"),
      }).ok,
    ).toBe(false);
    expect(
      parseOrdinaryCommitEvidence({
        ...selected,
        ordinaryResolution: {
          ...selected.ordinaryResolution,
          selectedTargetTipDigest: d("0"),
          outcomeEvidenceDigest: d("0"),
        },
      }).ok,
    ).toBe(false);
    expect(
      parseOrdinaryCommitEvidence({
        ...selected,
        targetRegistrySlot: {
          ...selected.targetRegistrySlot,
          selectedEvidence: {
            ...(selected.targetRegistrySlot.selectedEvidence as {
              proposal: Record<string, unknown>;
              tip: Record<string, unknown>;
              value: Record<string, unknown>;
            }),
            proposal: {
              ...(
                selected.targetRegistrySlot.selectedEvidence as {
                  proposal: Record<string, unknown>;
                }
              ).proposal,
              authorityEpochTipDigest: d("0"),
            },
          },
        },
      }).ok,
    ).toBe(false);
    expect(parseOrdinaryCommitEvidence({ ...selected, outcomeTag: "00" }).ok).toBe(false);
    expect(
      parseOrdinaryCommitEvidence({
        ...lost,
        ordinaryResolution: {
          ...lost.ordinaryResolution,
          conflictReceiptDigest: d("0"),
          outcomeEvidenceDigest: d("0"),
        },
      }).ok,
    ).toBe(false);
    expect(
      parseOrdinaryCommitEvidence({
        ...lost,
        targetRegistrySlot: {
          ...lost.targetRegistrySlot,
          selectedEvidence: {
            ...lost.targetRegistrySlot.selectedEvidence,
            conflictReceipt: {
              ...lost.targetRegistrySlot.selectedEvidence.conflictReceipt,
              authorityEpochTipDigest: d("0"),
            },
          },
        },
      }).ok,
    ).toBe(false);
  });

  test("closes resumable, selected, and unknown rotation evidence arms", () => {
    const resumable = rotationCommitEvidence("RESUMABLE");
    const selected = rotationCommitEvidence("SELECTED");
    const unknown = rotationCommitEvidence("UNKNOWN");
    expect(parseRotationCommitEvidence(resumable).ok).toBe(true);
    expect(parseRotationCommitEvidence(selected).ok).toBe(true);
    expect(parseRotationCommitEvidence(unknown).ok).toBe(true);
    expect(parseContract("pointer-mutation-commit-evidence/v1", selected).ok).toBe(true);
    expect(parseRotationCommitEvidence({ ...resumable, headPlusTwoAbsent: false }).ok).toBe(false);
    expect(
      parseRotationCommitEvidence({
        ...resumable,
        pendingRecord: {
          ...(resumable as { pendingRecord: Record<string, unknown> }).pendingRecord,
          rotationInputDigest: d("0"),
        },
      }).ok,
    ).toBe(false);
    expect(
      parseRotationCommitEvidence({
        ...selected,
        selectedSuccessorAuthorityValueDigest: d("0"),
      }).ok,
    ).toBe(false);
    expect(
      parseRotationCommitEvidence({
        ...unknown,
        packetAuthorityKind: "KNOWN",
      }).ok,
    ).toBe(false);
    expect(parseRotationCommitEvidence({ ...selected, ordinaryResolution: resolution() }).ok).toBe(
      false,
    );
    expect(parseRotationCommitEvidence({ ...resumable, runOrdinal: "1" }).ok).toBe(false);
    expect(
      parseRotationCommitEvidence({
        ...resumable,
        priorCheckpointEvidence: ordinaryCommitEvidence().checkpoints[0],
      }).ok,
    ).toBe(false);
  });

  test("pins branch-local outcome tags in exact Dcommit goldens", () => {
    const digests = [
      computeCommitEvidenceDigest(ordinaryCommitEvidence("SELECTED")),
      computeCommitEvidenceDigest(lostOrdinaryCommitEvidence()),
      computeCommitEvidenceDigest(ordinaryCommitEvidence("UNKNOWN_TERMINAL")),
      computeCommitEvidenceDigest(rotationCommitEvidence("RESUMABLE")),
      computeCommitEvidenceDigest(rotationCommitEvidence("SELECTED")),
      computeCommitEvidenceDigest(rotationCommitEvidence("UNKNOWN")),
    ];
    expect(digests).toEqual([
      "a6b50df49cb2820fa02c823414f40c0c16dafffea4b9e3090ec5130ee934cca2",
      "2a26184b20db7bb752983471925e5e06267852b7c5439405ef7c9dc96abc7554",
      "80777a7bbec4948569dd14c925b1198a700d0ab80503fb8e9c18b1b0a499c879",
      "e4d29c239382342babf889e21c29a2afcd396f3340f2a738d8d815d51db82a01",
      "a4b7fed5d58ad81e5ac005fda69c5eff8a975b3649e3419b32ad0dd184ca4c27",
      "a2d6a20608d543f09b4bcec2b0c2443cd576e7ad21c9db73281860726749508c",
    ]);
    expect(new Set(digests).size).toBe(6);
  });

  test("closes the eleven-slot packet and paired authority-history nullability", () => {
    expect(packetSchemaFields.packet).toEqual([
      "authorityHistoryBinding",
      "currentAuthoritySelection",
      "currentCommit",
      "evidenceSlots",
      "globalIdentity",
      "purpose",
      "schemaVersion",
    ]);
    const resumable = rotationPacket("RESUMABLE");
    const selected = rotationPacket("SELECTED");
    const unknown = rotationPacket("UNKNOWN");
    const historical = { ...resumable, currentCommit: null, purpose: "HISTORICAL_READ" };
    const ordinarySelected = ordinaryPacket("SELECTED");
    const ordinaryLost = ordinaryPacket("LOST_CONFLICT");
    const ordinaryUnknown = ordinaryPacket("UNKNOWN_TERMINAL");
    for (const [name, packet] of Object.entries({
      historical,
      ordinaryLost,
      ordinarySelected,
      ordinaryUnknown,
      resumable,
      selected,
      unknown,
    })) {
      const result = parsePointerEvidencePacket(packet);
      expect(result.ok, `${name}: ${JSON.stringify(result)}`).toBe(true);
      expect(parseContract("pointer-evidence-packet/v1", packet).ok).toBe(true);
    }
    expect(parsePointerEvidencePacket({ ...resumable, authorityHistoryBinding: null }).ok).toBe(
      false,
    );
    expect(
      parsePointerEvidencePacket({
        ...unknown,
        currentAuthoritySelection: resumable.currentAuthoritySelection,
      }).ok,
    ).toBe(false);
    expect(
      parsePointerEvidencePacket({ ...resumable, evidenceSlots: resumable.evidenceSlots.slice(1) })
        .ok,
    ).toBe(false);
    expect(
      parsePointerEvidencePacket({
        ...resumable,
        evidenceSlots: [
          resumable.evidenceSlots[1],
          resumable.evidenceSlots[0],
          ...resumable.evidenceSlots.slice(2),
        ],
      }).ok,
    ).toBe(false);
    expect(
      parsePointerEvidencePacket({
        ...resumable,
        evidenceSlots: resumable.evidenceSlots.map((slot) =>
          slot.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
            ? { ...slot, selectedEvidence: null }
            : slot,
        ),
      }).ok,
    ).toBe(false);
    expect(
      parsePointerEvidencePacket({ ...historical, currentCommit: resumable.currentCommit }).ok,
    ).toBe(false);
    expect(
      parsePointerEvidencePacket({
        ...ordinaryLost,
        evidenceSlots: ordinaryLost.evidenceSlots.map((slot) =>
          slot.pointerKind === "ACTIVE_RELEASE"
            ? ordinarySelected.currentCommit.targetRegistrySlot
            : slot,
        ),
      }).ok,
    ).toBe(false);
    expect(parsePointerEvidencePacket({ ...unknown, capability: d("1") }).ok).toBe(false);
  });

  test("fails closed for partial predecessor triples, unsafe ordinals, wrong phases, and extras", () => {
    const core = checkpoint(1);
    expect(parseRunCheckpointCore({ ...core, priorSelectorTipDigest: null }).ok).toBe(false);
    expect(parseRunCheckpointCore({ ...core, checkpointOrdinal: "9007199254740992" }).ok).toBe(
      false,
    );
    expect(parseRunCheckpointCore({ ...core, phase: "SELECTED" }).ok).toBe(false);
    expect(parseRunCheckpointCore({ ...core, selectorTipDigest: d("1") }).ok).toBe(false);
    expect(
      parseRunCheckpointCore(
        new Proxy(core, {
          ownKeys() {
            throw new Error("trap");
          },
        }),
      ).ok,
    ).toBe(false);
  });
});

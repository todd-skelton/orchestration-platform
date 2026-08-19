import { describe, expect, test } from "vitest";
import {
  computeCurrentTipDigest,
  computePointerMutationConflictEvidenceDigest,
  computePointerMutationUnknownEvidenceDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeStateMutationGlobalIdentityDigest,
  parseContract,
  parsePointerEvidenceSlot,
  parsePointerMutationConflictEvidence,
  parsePointerMutationUnknownEvidence,
  parseStateMutationGlobalIdentity,
} from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const installationId = "018f47aa-7b5c-7c11-8abc-0123456789ab";
const projectId = "018f47aa-7b5c-7c11-8abc-1123456789ab";

const globalIdentity = Object.freeze({
  authorityPath: "installation/state-mutation-authority.json",
  authorityPathInstanceDigest: d("1"),
  custodyInstanceDigest: d("2"),
  installationId,
  projectId,
  schemaVersion: "state-mutation-global-identity/v1",
  stateRootDigest: d("3"),
});

const unknownEvidence = Object.freeze({
  category: "UNREADABLE",
  observationDigest: d("4"),
  observedAt: "2026-08-18T13:00:00.000Z",
  observedByteLength: "0",
  reason: "MISSING",
  schemaVersion: "pointer-mutation-unknown-evidence/v1",
  targetMutationId: d("5"),
  targetPathInstanceDigest: d("6"),
});

function conflictEvidence() {
  const targetPathInstanceDigest = d("7");
  const winnerValue = {
    independentReviewReceiptDigest: d("1"),
    installedBytesDigest: d("2"),
    releaseDigest: d("8"),
    releaseManifestDigest: d("3"),
    releaseSubjectDigest: d("8"),
    reviewedInstallerDigest: d("4"),
    schemaVersion: "active-release/v1",
  };
  const winnerValueDigest = computePointerValueDigest(
    "ACTIVE_RELEASE",
    targetPathInstanceDigest,
    winnerValue,
  );
  const winnerProposal = {
    authorityEpochReceiptDigest: d("a"),
    authorityEpochTipDigest: d("b"),
    authorityEpochValueDigest: d("c"),
    intent: "VALUE_PROPOSED",
    mutationId: d("d"),
    outcome: "SELECT",
    pathInstanceDigest: targetPathInstanceDigest,
    pointerKind: "ACTIVE_RELEASE",
    positionDigest: d("e"),
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    producerDigest: d("f"),
    producerKind: "SELECTED_EPOCH",
    proposedAt: "2026-08-18T13:10:00.000Z",
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    successorValueDigest: winnerValueDigest,
  };
  const winnerReceiptDigest = computeProposalReceiptDigest(winnerProposal);
  const winnerTip = {
    pathInstanceDigest: targetPathInstanceDigest,
    pointerKind: "ACTIVE_RELEASE",
    proposalReceiptDigest: winnerReceiptDigest,
    schemaVersion: "pointer-current-tip/v1",
    valueDigest: winnerValueDigest,
  };
  const losingValue = {
    ...winnerValue,
    releaseDigest: d("0"),
    releaseSubjectDigest: d("0"),
  };
  const losingValueDigest = computePointerValueDigest(
    "ACTIVE_RELEASE",
    targetPathInstanceDigest,
    losingValue,
  );
  const losingProposal = {
    ...winnerProposal,
    mutationId: d("1"),
    proposedAt: "2026-08-18T13:11:00.000Z",
    successorValueDigest: losingValueDigest,
  };
  const conflictReceipt = {
    authorityEpochReceiptDigest: losingProposal.authorityEpochReceiptDigest,
    authorityEpochTipDigest: losingProposal.authorityEpochTipDigest,
    authorityEpochValueDigest: losingProposal.authorityEpochValueDigest,
    conflictAt: "2026-08-18T13:12:00.000Z",
    conflictKind: "VALUE_CONFLICT",
    losingProposalReceiptDigest: computeProposalReceiptDigest(losingProposal),
    losingSuccessorValueDigest: losingValueDigest,
    mutationId: losingProposal.mutationId,
    pathInstanceDigest: targetPathInstanceDigest,
    schemaVersion: "pointer-conflict-receipt/v1",
    winningReceiptDigest: winnerReceiptDigest,
    winningTipDigest: computeCurrentTipDigest(winnerTip),
    winningValueDigest: winnerValueDigest,
  };
  return {
    conflictReceipt,
    losingProposal,
    schemaVersion: "pointer-mutation-conflict-evidence/v1",
    selectedWinner: { proposal: winnerProposal, tip: winnerTip, value: winnerValue },
    targetMutationId: losingProposal.mutationId,
    targetPathInstanceDigest,
  };
}

describe("global identity", () => {
  test("pins the lifetime-stable closed identity and digest", () => {
    expect(parseStateMutationGlobalIdentity(globalIdentity).ok).toBe(true);
    expect(parseContract("state-mutation-global-identity/v1", globalIdentity).ok).toBe(true);
    expect(computeStateMutationGlobalIdentityDigest(globalIdentity)).toBe(
      "3f94326aeba35db95893d8ecf7090197f3e98dc533141fcdfa5389ce138499cb",
    );
    for (const mutation of [
      { ...globalIdentity, schemaVersion: "state-mutation-global-identity/v2" },
      { ...globalIdentity, authorityPath: "/absolute" },
      { ...globalIdentity, installationId: projectId, extra: true },
      { ...globalIdentity, helperDigest: d("7") },
    ])
      expect(parseStateMutationGlobalIdentity(mutation).ok).toBe(false);
  });
});

describe("fixed unknown mutation evidence", () => {
  test("accepts only category-specific closed reasons", () => {
    for (const [category, reasons] of Object.entries({
      IMPOSSIBLE: ["EPOCH_MISMATCH", "IDENTITY_MISMATCH", "STATE_CONTRADICTION"],
      MALFORMED: ["DIGEST_MISMATCH", "NON_CANONICAL", "SCHEMA_INVALID"],
      UNREADABLE: ["IO_ERROR", "MISSING", "PERMISSION_DENIED"],
    }))
      for (const reason of reasons)
        expect(
          parsePointerMutationUnknownEvidence({ ...unknownEvidence, category, reason }).ok,
        ).toBe(true);
    expect(
      parsePointerMutationUnknownEvidence({
        ...unknownEvidence,
        category: "UNREADABLE",
        reason: "DIGEST_MISMATCH",
      }).ok,
    ).toBe(false);
  });

  test("pins the canonical evidence digest and refuses prose/path/JSON payloads", () => {
    expect(computePointerMutationUnknownEvidenceDigest(unknownEvidence)).toBe(
      "be8f945125e31ad5f0f163038941a934df4d87708f077ce947d5da85d981bbb5",
    );
    for (const extra of [
      { observation: { error: "missing" } },
      { message: "missing" },
      { path: "private/file" },
      { nativeError: "ENOENT" },
    ])
      expect(parsePointerMutationUnknownEvidence({ ...unknownEvidence, ...extra }).ok).toBe(false);
  });

  test("bounds observed length before conversion and is total", () => {
    expect(
      parsePointerMutationUnknownEvidence({
        ...unknownEvidence,
        observedByteLength: "9007199254740991",
      }).ok,
    ).toBe(true);
    for (const observedByteLength of ["9007199254740992", "01", "-1", 1])
      expect(
        parsePointerMutationUnknownEvidence({ ...unknownEvidence, observedByteLength }).ok,
      ).toBe(false);
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => parsePointerMutationUnknownEvidence(proxy)).not.toThrow();
    expect(parsePointerMutationUnknownEvidence(proxy).ok).toBe(false);
  });
});

describe("closed conflict composition and evidence slot", () => {
  test("recomputes the loser, real winner, receipt, and composed digest", () => {
    const evidence = conflictEvidence();
    expect(parsePointerMutationConflictEvidence(evidence).ok).toBe(true);
    expect(parseContract("pointer-mutation-conflict-evidence/v1", evidence).ok).toBe(true);
    expect(computePointerMutationConflictEvidenceDigest(evidence)).toBe(
      "dea3b2e7f00287ea3558c9bdd6ac44fdb88add89fcc48419364770972b1d47ce",
    );
    expect(
      parsePointerMutationConflictEvidence({
        ...evidence,
        conflictReceipt: { ...evidence.conflictReceipt, winningTipDigest: d("2") },
      }).ok,
    ).toBe(false);
    expect(
      parsePointerMutationConflictEvidence({
        ...evidence,
        losingProposal: { ...evidence.losingProposal, authorityEpochTipDigest: d("2") },
      }).ok,
    ).toBe(false);
  });

  test("admits only null, same-kind generic selection, or same-kind conflict evidence", () => {
    const evidence = conflictEvidence();
    const conflictSlot = {
      pointerKind: "ACTIVE_RELEASE",
      schemaVersion: "pointer-evidence-slot/v1",
      selectedEvidence: evidence,
    };
    expect(parsePointerEvidenceSlot(conflictSlot).ok).toBe(true);
    expect(parseContract("pointer-evidence-slot/v1", conflictSlot).ok).toBe(true);
    expect(
      parsePointerEvidenceSlot({
        ...conflictSlot,
        selectedEvidence: evidence.selectedWinner,
      }).ok,
    ).toBe(true);
    expect(parsePointerEvidenceSlot({ ...conflictSlot, selectedEvidence: null }).ok).toBe(true);
    expect(
      parsePointerEvidenceSlot({ ...conflictSlot, pointerKind: "ACTIVATION_CLEANUP_GATE" }).ok,
    ).toBe(false);
    expect(parsePointerEvidenceSlot({ ...conflictSlot, outcome: "LOST_CONFLICT" }).ok).toBe(false);
  });
});

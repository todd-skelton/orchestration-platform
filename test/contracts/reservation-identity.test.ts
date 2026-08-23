import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const transactionId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const otherTransactionId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const installationId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";

const genesis = Object.freeze({
  predecessorReceiptDigest: null,
  predecessorTipDigest: null,
  predecessorValueDigest: null,
  sourceToken: "cleanup-gate-pre-fence" as const,
  transactionId,
});
const selected = Object.freeze({
  predecessorReceiptDigest: d("3"),
  predecessorTipDigest: d("1"),
  predecessorValueDigest: d("2"),
  sourceToken: "recovery-fence" as const,
  transactionId,
});

describe("recovery attempt reservation identity", () => {
  test("pins tagged predecessor keys and the constructed path", () => {
    const genesisKey = contracts.computeRecoveryAttemptReservationPredecessorKey(genesis);
    const selectedKey = contracts.computeRecoveryAttemptReservationPredecessorKey(selected);
    expect(genesisKey).toBe("f38c262adfd7a9ccba27c5c13e060f4b6c9621f7cd8778c404e305f437241032");
    expect(selectedKey).toBe("b6aac024b9bad1cc639279bb5a48aff11ba01a0f635e927f2aa57e3f89569754");
    expect(contracts.recoveryAttemptReservationPath(selected)).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/reservations/${selectedKey}.json`,
    );

    expect(
      contracts.computeRecoveryAttemptReservationPredecessorKey({
        ...selected,
        transactionId: otherTransactionId,
      }),
    ).not.toBe(selectedKey);
    expect(
      contracts.computeRecoveryAttemptReservationPredecessorKey({
        ...selected,
        sourceToken: "cleanup-gate-pre-fence",
      }),
    ).not.toBe(selectedKey);
    expect(
      contracts.computeRecoveryAttemptReservationPredecessorKey({
        ...selected,
        predecessorTipDigest: selected.predecessorValueDigest,
        predecessorValueDigest: selected.predecessorTipDigest,
      }),
    ).not.toBe(selectedKey);
    for (const field of [
      "predecessorReceiptDigest",
      "predecessorTipDigest",
      "predecessorValueDigest",
    ] as const)
      expect(
        contracts.computeRecoveryAttemptReservationPredecessorKey({
          ...selected,
          [field]: d("8"),
        }),
        field,
      ).not.toBe(selectedKey);
  });

  test("refuses partial, malformed, extra, and hostile predecessor inputs", () => {
    for (const input of [
      ...(
        ["predecessorReceiptDigest", "predecessorTipDigest", "predecessorValueDigest"] as const
      ).map((field) => ({ ...selected, [field]: null })),
      { ...selected, predecessorTipDigest: "bad" },
      { ...selected, sourceToken: "none" },
      { ...selected, transactionId: "not-a-uuid" },
      { ...selected, predecessorKey: d("9") },
    ]) {
      expect(() => contracts.computeRecoveryAttemptReservationPredecessorKey(input)).toThrow();
      expect(() => contracts.recoveryAttemptReservationPath(input)).toThrow();
    }

    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => contracts.computeRecoveryAttemptReservationPredecessorKey(hostile)).toThrow();
    expect(() => contracts.recoveryAttemptReservationPath(hostile)).toThrow();
  });

  test("closes the empty VALUE position through specialized and common routes", () => {
    const position = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
    expect(contracts.parseRecoveryAttemptReservationValuePosition(position).ok).toBe(true);
    expect(contracts.computeRecoveryAttemptReservationValuePositionDigest(position)).toBe(
      "ab9f18a321cca489a68fd18b9bf83a5b8a652727def45622f875e0d8167cd21c",
    );
    expect(contracts.computePointerPositionDigest("RECOVERY_ATTEMPT_RESERVATION", position)).toBe(
      "ab9f18a321cca489a68fd18b9bf83a5b8a652727def45622f875e0d8167cd21c",
    );

    for (const input of [
      null,
      {},
      { ...position, extra: true },
      { mode: "VALUE", parts: { predecessorKey: d("1") } },
      { mode: "TOMBSTONE", parts: {} },
      { mode: "VALUE", parts: { ordinal: "0", rootDigest: d("1") } },
    ]) {
      expect(contracts.parseRecoveryAttemptReservationValuePosition(input).ok).toBe(false);
      expect(() =>
        contracts.computePointerPositionDigest("RECOVERY_ATTEMPT_RESERVATION", input),
      ).toThrow();
    }
  });

  test("uses one canonical-path-derived Dp through identity, mutation, and locator", () => {
    const canonicalPointerPath = contracts.recoveryAttemptReservationPath(selected);
    const positionEvidence = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
    const expectedIdentity = Object.freeze({
      canonicalPointerPath,
      installationId,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION" as const,
      positionEvidence,
      projectId,
      sourceToken: selected.sourceToken,
      stateRootDigest: d("a"),
      transactionId,
    });
    const pathInstanceDigest = contracts.computePointerInstanceDigest(expectedIdentity);
    expect(pathInstanceDigest).toBe(
      contracts.computePointerInstanceDigestFromCanonicalPath(expectedIdentity),
    );
    const value = Object.freeze({ attemptId: installationId, schemaVersion: "future-reservation" });
    const valueDigest = contracts.computePointerValueDigest(
      "RECOVERY_ATTEMPT_RESERVATION",
      pathInstanceDigest,
      value,
    );
    const mutationId = contracts.computeMutationId({
      ...expectedIdentity,
      outcome: "SELECT",
      priorReceiptDigest: null,
      priorTipDigest: null,
      priorValueDigest: null,
      successorValueDigest: valueDigest,
    });
    const proposal = Object.freeze({
      authorityEpochReceiptDigest: d("6"),
      authorityEpochTipDigest: d("4"),
      authorityEpochValueDigest: d("5"),
      intent: "VALUE_PROPOSED",
      mutationId,
      outcome: "SELECT",
      pathInstanceDigest,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION",
      positionDigest: contracts.computePointerPositionDigest(
        "RECOVERY_ATTEMPT_RESERVATION",
        positionEvidence,
      ),
      priorReceiptDigest: null,
      priorTipDigest: null,
      priorValueDigest: null,
      producerDigest: d("7"),
      producerKind: "SELECTED_EPOCH",
      proposedAt: "2026-08-23T20:00:00.000Z",
      schemaVersion: "pointer-cas-proposal-receipt/v1",
      successorValueDigest: valueDigest,
    });
    const proposalReceiptDigest = contracts.computeProposalReceiptDigest(proposal);
    const tip = Object.freeze({
      pathInstanceDigest,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION",
      proposalReceiptDigest,
      schemaVersion: "pointer-current-tip/v1",
      valueDigest,
    });
    const located = contracts.validateLocatedSelectedPointerEvidence({
      expectedIdentity,
      proposal,
      tip,
      value,
    });
    expect(located.ok).toBe(true);
    if (located.ok) expect(located.value.pathInstanceDigest).toBe(pathInstanceDigest);
  });

  test("refuses malformed or moved paths but leaves a wrong SHA key to family composition", () => {
    const actualPath = contracts.recoveryAttemptReservationPath(selected);
    const identity = {
      canonicalPointerPath: actualPath,
      installationId,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION" as const,
      positionEvidence: { mode: "VALUE", parts: {} },
      projectId,
      sourceToken: selected.sourceToken,
      stateRootDigest: d("a"),
      transactionId,
    };
    const actualDp = contracts.computePointerInstanceDigest(identity);
    for (const canonicalPointerPath of [
      actualPath.replace(/\/[0-9a-f]{64}\.json$/, "/bad.json"),
      actualPath.replace(transactionId, otherTransactionId),
      actualPath.replace("recovery-fence", "cleanup-gate-pre-fence"),
    ])
      expect(() =>
        contracts.computePointerInstanceDigest({ ...identity, canonicalPointerPath }),
      ).toThrow();

    const wrongKeyPath = actualPath.replace(/\/[0-9a-f]{64}\.json$/, `/${d("9")}.json`);
    const wrongDp = contracts.computePointerInstanceDigest({
      ...identity,
      canonicalPointerPath: wrongKeyPath,
    });
    expect(wrongDp).not.toBe(actualDp);
  });
});

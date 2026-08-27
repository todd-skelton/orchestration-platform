import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import type {
  RecoveryAttemptLogLifecycle,
  RecoveryAttemptTerminalDisposition,
} from "../../packages/contracts/src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
const exactLifecycleType: Equal<RecoveryAttemptLogLifecycle, "IN_PROGRESS" | "TERMINAL"> = true;
const exactDispositionType: Equal<
  RecoveryAttemptTerminalDisposition,
  "RETRYABLE" | "HANDOFF" | "ABORTED" | "COMPLETE"
> = true;
if (false) {
  // @ts-expect-error attempt-log has no accumulator-era lifecycle
  const forbiddenLifecycle: RecoveryAttemptLogLifecycle = "UNKNOWN";
  // @ts-expect-error disposition is a closed terminal outcome
  const forbiddenDisposition: RecoveryAttemptTerminalDisposition = "FAILED";
  void forbiddenLifecycle;
  void forbiddenDisposition;
}

const d = (value: string): string => value.repeat(64);
const attemptA = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const attemptB = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const otherTransactionId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";

const inProgress0 = Object.freeze({
  attemptId: attemptA,
  descriptorDigest: d("1"),
  lifecycle: "IN_PROGRESS",
  ordinal: "0",
  predecessorRecordDigest: null,
  recordedAt: "2026-08-24T00:00:00.000Z",
  schemaVersion: "attempt-log/v1",
  sourceToken: "recovery-fence",
  transactionId,
});
const terminal1 = Object.freeze({
  attachmentTipDigest: d("2"),
  attemptId: attemptA,
  channelDenialEvidenceDigest: d("3"),
  descriptorDigest: d("1"),
  lifecycle: "TERMINAL",
  ordinal: "1",
  predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(inProgress0),
  processTerminalObservationDigest: d("4"),
  recordedAt: "2026-08-24T00:00:01.000Z",
  revocationEvidenceDigest: d("5"),
  schemaVersion: "attempt-log/v1",
  sourceToken: "recovery-fence",
  terminalDisposition: "RETRYABLE",
  terminalOutcomeEvidenceDigest: d("6"),
  transactionId,
});
const inProgress2 = Object.freeze({
  ...inProgress0,
  attemptId: attemptB,
  descriptorDigest: d("7"),
  ordinal: "2",
  predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(terminal1),
  recordedAt: "2026-08-24T00:00:02.000Z",
});
const terminal3 = Object.freeze({
  ...terminal1,
  attachmentTipDigest: null,
  attemptId: attemptB,
  descriptorDigest: d("7"),
  ordinal: "3",
  predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(inProgress2),
  recordedAt: "2026-08-24T00:00:03.000Z",
  revocationEvidenceDigest: null,
  terminalDisposition: "HANDOFF",
});
const chain = [inProgress0, terminal1, inProgress2, terminal3] as const;

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery attempt log", () => {
  test("pins exact branch censuses and canonical cells", () => {
    expect(contracts.recoveryAttemptLogSchemaFields.inProgress).toEqual([
      "attemptId",
      "descriptorDigest",
      "lifecycle",
      "ordinal",
      "predecessorRecordDigest",
      "recordedAt",
      "schemaVersion",
      "sourceToken",
      "transactionId",
    ]);
    expect(contracts.recoveryAttemptLogSchemaFields.terminal).toEqual([
      "attachmentTipDigest",
      "attemptId",
      "channelDenialEvidenceDigest",
      "descriptorDigest",
      "lifecycle",
      "ordinal",
      "predecessorRecordDigest",
      "processTerminalObservationDigest",
      "recordedAt",
      "revocationEvidenceDigest",
      "schemaVersion",
      "sourceToken",
      "terminalDisposition",
      "terminalOutcomeEvidenceDigest",
      "transactionId",
    ]);
    expect(contracts.canonicalJson(inProgress0)).toBe(
      '{"attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","descriptorDigest":"1111111111111111111111111111111111111111111111111111111111111111","lifecycle":"IN_PROGRESS","ordinal":"0","predecessorRecordDigest":null,"recordedAt":"2026-08-24T00:00:00.000Z","schemaVersion":"attempt-log/v1","sourceToken":"recovery-fence","transactionId":"018f0f4d-7b2d-7a13-8a2b-123456789abc"}\n',
    );
    expect(terminal1.predecessorRecordDigest).toBe(
      "98f03fa1aae41cfd3c4421420ec063979a429d99aebf89bef7090c569bb61fc2",
    );
    expect(contracts.canonicalJson(terminal1)).toBe(
      '{"attachmentTipDigest":"2222222222222222222222222222222222222222222222222222222222222222","attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","channelDenialEvidenceDigest":"3333333333333333333333333333333333333333333333333333333333333333","descriptorDigest":"1111111111111111111111111111111111111111111111111111111111111111","lifecycle":"TERMINAL","ordinal":"1","predecessorRecordDigest":"98f03fa1aae41cfd3c4421420ec063979a429d99aebf89bef7090c569bb61fc2","processTerminalObservationDigest":"4444444444444444444444444444444444444444444444444444444444444444","recordedAt":"2026-08-24T00:00:01.000Z","revocationEvidenceDigest":"5555555555555555555555555555555555555555555555555555555555555555","schemaVersion":"attempt-log/v1","sourceToken":"recovery-fence","terminalDisposition":"RETRYABLE","terminalOutcomeEvidenceDigest":"6666666666666666666666666666666666666666666666666666666666666666","transactionId":"018f0f4d-7b2d-7a13-8a2b-123456789abc"}\n',
    );
  });

  test("closes every member, branch-only field, and scalar", () => {
    for (const fixture of [inProgress0, terminal1] as readonly Readonly<
      Record<string, unknown>
    >[]) {
      expect(contracts.parseRecoveryAttemptLogRecord(fixture).ok).toBe(true);
      expect(contracts.parseContract("attempt-log/v1", fixture).ok).toBe(true);
      for (const field of Object.keys(fixture)) {
        expect(contracts.parseRecoveryAttemptLogRecord(without(fixture, field)).ok).toBe(false);
        const nullable =
          field === "predecessorRecordDigest" ||
          (fixture.lifecycle === "TERMINAL" &&
            (field === "attachmentTipDigest" || field === "revocationEvidenceDigest"));
        if (!nullable)
          expect(contracts.parseRecoveryAttemptLogRecord({ ...fixture, [field]: null }).ok).toBe(
            false,
          );
        expect(contracts.parseRecoveryAttemptLogRecord({ ...fixture, [field]: 1 }).ok).toBe(false);
        expect(
          contracts.parseRecoveryAttemptLogRecord({
            ...without(fixture, field),
            [`${field}Renamed`]: fixture[field],
          }).ok,
        ).toBe(false);
      }
      expect(contracts.parseRecoveryAttemptLogRecord({ ...fixture, extra: true }).ok).toBe(false);
    }
    for (const field of [
      "attachmentTipDigest",
      "channelDenialEvidenceDigest",
      "processTerminalObservationDigest",
      "revocationEvidenceDigest",
      "terminalDisposition",
      "terminalOutcomeEvidenceDigest",
    ])
      expect(contracts.parseRecoveryAttemptLogRecord({ ...inProgress0, [field]: d("9") }).ok).toBe(
        false,
      );
    for (const lifecycle of ["READY", "LIVE", "UNKNOWN", "TOMBSTONE"])
      expect(contracts.parseRecoveryAttemptLogRecord({ ...inProgress0, lifecycle }).ok).toBe(false);
    for (const terminalDisposition of ["RETRYABLE", "HANDOFF", "ABORTED", "COMPLETE"])
      expect(
        contracts.parseRecoveryAttemptLogRecord({ ...terminal1, terminalDisposition }).ok,
      ).toBe(true);
    expect(
      contracts.parseRecoveryAttemptLogRecord({ ...terminal1, terminalDisposition: "FAILED" }).ok,
    ).toBe(false);
  });

  test("pins predecessor arms and safe ordinals", () => {
    expect(
      contracts.parseRecoveryAttemptLogRecord({ ...inProgress0, predecessorRecordDigest: d("8") })
        .ok,
    ).toBe(false);
    expect(
      contracts.parseRecoveryAttemptLogRecord({
        ...inProgress0,
        ordinal: "1",
        predecessorRecordDigest: null,
      }).ok,
    ).toBe(false);
    expect(
      contracts.parseRecoveryAttemptLogRecord({
        ...terminal1,
        lifecycle: "TERMINAL",
        ordinal: "0",
        predecessorRecordDigest: null,
      }).ok,
    ).toBe(false);
    for (const ordinal of ["00", "-1", "9007199254740992"])
      expect(contracts.parseRecoveryAttemptLogRecord({ ...inProgress2, ordinal }).ok).toBe(false);
    expect(
      contracts.parseRecoveryAttemptLogRecord({
        ...inProgress2,
        ordinal: "9007199254740991",
      }).ok,
    ).toBe(true);
  });

  test("admits only exact alternating adjacent edges", () => {
    expect(contracts.validateRecoveryAttemptLogEdge(null, inProgress0)).toEqual([]);
    expect(contracts.validateRecoveryAttemptLogEdge(inProgress0, terminal1)).toEqual([]);
    expect(contracts.validateRecoveryAttemptLogEdge(terminal1, inProgress2)).toEqual([]);
    expect(
      contracts.validateRecoveryAttemptLogEdge(inProgress0, {
        ...inProgress0,
        ordinal: "1",
        predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(inProgress0),
        recordedAt: "2026-08-24T00:00:01.000Z",
      }),
    ).toEqual(["edge:lifecycle"]);
    expect(
      contracts.validateRecoveryAttemptLogEdge(terminal1, {
        ...terminal1,
        attemptId: attemptB,
        descriptorDigest: d("7"),
        ordinal: "2",
        predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(terminal1),
        recordedAt: "2026-08-24T00:00:02.000Z",
      }),
    ).toEqual(["edge:lifecycle"]);
    expect(
      contracts.validateRecoveryAttemptLogEdge(inProgress0, {
        ...terminal1,
        attemptId: attemptB,
      }),
    ).toEqual(["attemptId:mismatch"]);
    for (const [previous, next] of [
      [null, terminal1],
      [inProgress0, inProgress2],
      [terminal1, terminal3],
      [terminal1, { ...inProgress2, attemptId: attemptA }],
      [inProgress0, { ...terminal1, descriptorDigest: d("9") }],
      [inProgress0, { ...terminal1, transactionId: otherTransactionId }],
      [inProgress0, { ...terminal1, sourceToken: "cleanup-gate-pre-fence" }],
      [inProgress0, { ...terminal1, ordinal: "2" }],
      [inProgress0, { ...terminal1, predecessorRecordDigest: d("9") }],
      [inProgress0, { ...terminal1, recordedAt: "2026-08-23T23:59:59.999Z" }],
    ] as const)
      expect(contracts.validateRecoveryAttemptLogEdge(previous, next)).not.toEqual([]);
    expect(
      contracts.validateRecoveryAttemptLogEdge(inProgress0, {
        ...terminal1,
        recordedAt: inProgress0.recordedAt,
      }),
    ).toEqual([]);
    expect(
      contracts.validateRecoveryAttemptLogEdge(
        { ...inProgress2, ordinal: "9007199254740991" },
        terminal3,
      ),
    ).toContain("ordinal:not-adjacent");
  });

  test("validates structural prefixes and global attempt uniqueness", () => {
    for (let length = 1; length <= chain.length; length += 1)
      expect(contracts.validateRecoveryAttemptLogChain(chain.slice(0, length)).ok).toBe(true);
    expect(contracts.validateRecoveryAttemptLogChain([]).ok).toBe(false);
    expect(
      contracts.validateRecoveryAttemptLogChain([
        ...chain,
        {
          ...inProgress2,
          attemptId: attemptA,
          ordinal: "4",
          predecessorRecordDigest: contracts.computeRecoveryAttemptLogRecordDigest(terminal3),
          recordedAt: "2026-08-24T00:00:04.000Z",
        },
      ]).ok,
    ).toBe(false);
    for (const invalid of [
      [terminal1],
      [inProgress0, { ...terminal1, ordinal: "2" }],
      [inProgress0, { ...terminal1, predecessorRecordDigest: d("9") }],
      [inProgress0, terminal1, { ...inProgress2, ordinal: "3" }],
    ])
      expect(contracts.validateRecoveryAttemptLogChain(invalid).ok).toBe(false);
  });

  test("pins movement-sensitive paths and one-frame digest serialization", () => {
    expect(contracts.recoveryAttemptLogRecordPath(inProgress0)).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/attempts/${attemptA}/0-IN_PROGRESS.json`,
    );
    expect(contracts.recoveryAttemptLogRecordPath(terminal1)).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/attempts/${attemptA}/1-TERMINAL.json`,
    );
    for (const moved of [
      { ...inProgress2, attemptId: attemptA },
      { ...inProgress2, transactionId: otherTransactionId },
      { ...inProgress2, sourceToken: "cleanup-gate-pre-fence" },
      { ...inProgress2, ordinal: "3" },
    ]) {
      expect(contracts.recoveryAttemptLogRecordPath(moved)).not.toBe(
        contracts.recoveryAttemptLogRecordPath(inProgress2),
      );
      expect(contracts.computeRecoveryAttemptLogRecordDigest(moved)).not.toBe(
        contracts.computeRecoveryAttemptLogRecordDigest(inProgress2),
      );
    }
    const serialized = contracts.serializeContract("attempt-log/v1", terminal1);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextDecoder().decode(serialized.bytes)).toBe(contracts.canonicalJson(terminal1));
    expect(serialized.digest).toBe(contracts.computeRecoveryAttemptLogRecordDigest(terminal1));
    expect(serialized.digest).toBe(
      "c17c66953471d5b6a5e97c0c5f87510c68b8c542841dc9173f6293a4dd9ab2ef",
    );
    expect(serialized.digest).not.toBe(contracts.canonicalDigest(terminal1));
    expect(
      contracts.parseCanonicalContractBytes("attempt-log/v1", contracts.canonicalBytes(terminal1))
        .ok,
    ).toBe(true);
  });

  test("closes the empty VALUE position through specialized and common routes", () => {
    const position = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
    expect(contracts.parseRecoveryAttemptLogValuePosition(position).ok).toBe(true);
    expect(contracts.computeRecoveryAttemptLogValuePositionDigest(position)).toBe(
      contracts.computePointerPositionDigest("RECOVERY_ATTEMPT_LOG", position),
    );
    expect(contracts.computeRecoveryAttemptLogValuePositionDigest(position)).toBe(
      "1a155ae3b2ce0ad547d5591c7e01f03816cf288781a06d6ded11afb3b1e7b077",
    );
    for (const invalid of [
      null,
      {},
      { ...position, extra: true },
      { mode: "VALUE", parts: { ordinal: "0" } },
      { mode: "TOMBSTONE", parts: {} },
    ]) {
      expect(contracts.parseRecoveryAttemptLogValuePosition(invalid).ok).toBe(false);
      expect(() =>
        contracts.computePointerPositionDigest("RECOVERY_ATTEMPT_LOG", invalid),
      ).toThrow();
    }
  });

  test("registers only the reviewed structural surface", () => {
    expect(exactLifecycleType).toBe(true);
    expect(exactDispositionType).toBe(true);
    expect(contracts.schemaVersions).toContain("attempt-log/v1");
    expect(contracts.schemaVocabularyDefinitions["attempt-log/v1#IN_PROGRESS"]).toEqual({
      schemaVersion: "attempt-log/v1",
      fields: contracts.recoveryAttemptLogSchemaFields.inProgress,
      closedValues: ["IN_PROGRESS"],
    });
    expect(contracts.schemaVocabularyDefinitions["attempt-log/v1#TERMINAL"]).toEqual({
      schemaVersion: "attempt-log/v1",
      fields: contracts.recoveryAttemptLogSchemaFields.terminal,
      closedValues: ["TERMINAL", "RETRYABLE", "HANDOFF", "ABORTED", "COMPLETE"],
    });
    for (const name of [
      "recoveryAttemptAccumulatorSchemaFields",
      "computeRecoveryAttemptRollingDigest",
      "recoveryAttemptCheckpointSchemaFields",
      "recoveryAttemptTerminalSummarySchemaFields",
      "parseProcessTerminalObservation",
      "parseRecoveryAuthorizationAttachment",
      "parseActivationRecoveryLaunch",
      "computeRecoveryAttemptLogArchiveDigest",
    ])
      expect(Object.hasOwn(contracts, name), name).toBe(false);
  });

  test("is total over hostile records and arrays", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], "log", hostile]) {
      expect(() => contracts.parseRecoveryAttemptLogRecord(input)).not.toThrow();
      expect(contracts.parseRecoveryAttemptLogRecord(input).ok).toBe(false);
      expect(() => contracts.validateRecoveryAttemptLogEdge(input, inProgress0)).not.toThrow();
      expect(() => contracts.validateRecoveryAttemptLogEdge(inProgress0, input)).not.toThrow();
      expect(() => contracts.validateRecoveryAttemptLogChain(input)).not.toThrow();
    }
  });
});

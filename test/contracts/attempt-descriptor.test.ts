import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import type { RecoveryAttemptDescriptorLifecycle } from "../../packages/contracts/src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
const exactLifecycleType: Equal<RecoveryAttemptDescriptorLifecycle, "LIVE"> = true;
if (false) {
  // @ts-expect-error a descriptor has no pre-launch, terminal, or tombstone lifecycle
  const forbiddenLifecycle: RecoveryAttemptDescriptorLifecycle = "READY_ONLY";
  void forbiddenLifecycle;
}

const d = (value: string): string => value.repeat(64);
const attemptId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const otherAttemptId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const otherTransactionId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";

const descriptor = Object.freeze({
  attemptId,
  lifecycle: "LIVE",
  processStartObservationDigest: d("1"),
  reservationPredecessorKey: d("2"),
  reservationTipDigest: d("3"),
  schemaVersion: "recovery-attempt-descriptor/v1",
  sourceToken: "recovery-fence",
  transactionId,
});

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery attempt LIVE descriptor", () => {
  test("pins the exact eight-member census and canonical bytes", () => {
    expect(contracts.recoveryAttemptDescriptorSchemaFields).toEqual([
      "attemptId",
      "lifecycle",
      "processStartObservationDigest",
      "reservationPredecessorKey",
      "reservationTipDigest",
      "schemaVersion",
      "sourceToken",
      "transactionId",
    ]);
    expect(contracts.canonicalJson(descriptor)).toBe(
      '{"attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","lifecycle":"LIVE","processStartObservationDigest":"1111111111111111111111111111111111111111111111111111111111111111","reservationPredecessorKey":"2222222222222222222222222222222222222222222222222222222222222222","reservationTipDigest":"3333333333333333333333333333333333333333333333333333333333333333","schemaVersion":"recovery-attempt-descriptor/v1","sourceToken":"recovery-fence","transactionId":"018f0f4d-7b2d-7a13-8a2b-123456789abc"}\n',
    );
  });

  test("closes every member and scalar", () => {
    expect(contracts.parseRecoveryAttemptDescriptor(descriptor).ok).toBe(true);
    expect(contracts.parseContract("recovery-attempt-descriptor/v1", descriptor).ok).toBe(true);
    for (const field of Object.keys(descriptor)) {
      expect(contracts.parseRecoveryAttemptDescriptor(without(descriptor, field)).ok).toBe(false);
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, [field]: null }).ok).toBe(
        false,
      );
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, [field]: 1 }).ok).toBe(
        false,
      );
      expect(
        contracts.parseRecoveryAttemptDescriptor({
          ...without(descriptor, field),
          [`${field}Renamed`]: descriptor[field as keyof typeof descriptor],
        }).ok,
      ).toBe(false);
    }
    expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, unknown: true }).ok).toBe(
      false,
    );
    for (const lifecycle of ["READY", "READY_ONLY", "TERMINAL", "UNKNOWN", "TOMBSTONE"])
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, lifecycle }).ok).toBe(false);
    expect(
      contracts.parseRecoveryAttemptDescriptor({
        ...descriptor,
        schemaVersion: "recovery-attempt-descriptor/v2",
      }).ok,
    ).toBe(false);
    for (const field of [
      "processStartObservationDigest",
      "reservationPredecessorKey",
      "reservationTipDigest",
    ] as const)
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, [field]: "bad" }).ok).toBe(
        false,
      );
    for (const field of ["attemptId", "transactionId"] as const)
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, [field]: "bad" }).ok).toBe(
        false,
      );
    for (const sourceToken of ["cleanup-gate-pre-fence", "recovery-fence"])
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, sourceToken }).ok).toBe(
        true,
      );
    for (const sourceToken of ["none", "recovery-fence-v2", "RECOVERY-FENCE"])
      expect(contracts.parseRecoveryAttemptDescriptor({ ...descriptor, sourceToken }).ok).toBe(
        false,
      );
  });

  test("constructs movement-sensitive descriptor and reservation paths", () => {
    expect(contracts.recoveryAttemptDescriptorPath(descriptor)).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/attempts/${attemptId}/descriptor.json`,
    );
    const reservationPath = contracts.recoveryAttemptReservationPathFromPredecessorKey({
      reservationPredecessorKey: descriptor.reservationPredecessorKey,
      sourceToken: descriptor.sourceToken,
      transactionId: descriptor.transactionId,
    });
    expect(reservationPath).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/reservations/${descriptor.reservationPredecessorKey}.json`,
    );
    expect(
      contracts.recoveryAttemptReservationPathFromPredecessorKey({
        reservationPredecessorKey: descriptor.reservationPredecessorKey,
        sourceToken: "cleanup-gate-pre-fence",
        transactionId: descriptor.transactionId,
      }),
    ).toBe(
      `installation/activation-recovery-launches/${transactionId}/cleanup-gate-pre-fence/reservations/${descriptor.reservationPredecessorKey}.json`,
    );
    expect(
      contracts.recoveryAttemptReservationPathFromPredecessorKey({
        reservationPredecessorKey: descriptor.reservationPredecessorKey,
        sourceToken: descriptor.sourceToken,
        transactionId: otherTransactionId,
      }),
    ).toBe(
      `installation/activation-recovery-launches/${otherTransactionId}/recovery-fence/reservations/${descriptor.reservationPredecessorKey}.json`,
    );
    const predecessor = Object.freeze({
      predecessorReceiptDigest: d("5"),
      predecessorTipDigest: d("6"),
      predecessorValueDigest: d("7"),
      sourceToken: descriptor.sourceToken,
      transactionId: descriptor.transactionId,
    });
    const computedKey = contracts.computeRecoveryAttemptReservationPredecessorKey(predecessor);
    expect(
      contracts.recoveryAttemptReservationPathFromPredecessorKey({
        reservationPredecessorKey: computedKey,
        sourceToken: descriptor.sourceToken,
        transactionId: descriptor.transactionId,
      }),
    ).toBe(contracts.recoveryAttemptReservationPath(predecessor));
    for (const moved of [
      { ...descriptor, attemptId: otherAttemptId },
      { ...descriptor, transactionId: otherTransactionId },
      { ...descriptor, sourceToken: "cleanup-gate-pre-fence" },
    ]) {
      expect(contracts.recoveryAttemptDescriptorPath(moved)).not.toBe(
        contracts.recoveryAttemptDescriptorPath(descriptor),
      );
      expect(contracts.computeRecoveryAttemptDescriptorDigest(moved)).not.toBe(
        contracts.computeRecoveryAttemptDescriptorDigest(descriptor),
      );
    }
    expect(
      contracts.recoveryAttemptReservationPathFromPredecessorKey({
        reservationPredecessorKey: d("9"),
        sourceToken: descriptor.sourceToken,
        transactionId: descriptor.transactionId,
      }),
    ).not.toBe(reservationPath);
    for (const invalid of [
      { ...descriptor, reservationPredecessorKey: "bad" },
      { ...descriptor, transactionId: "bad" },
      { ...descriptor, sourceToken: "none" },
    ])
      expect(() =>
        contracts.recoveryAttemptReservationPathFromPredecessorKey({
          reservationPredecessorKey: invalid.reservationPredecessorKey,
          sourceToken: invalid.sourceToken,
          transactionId: invalid.transactionId,
        }),
      ).toThrow();
    const locator = Object.freeze({
      reservationPredecessorKey: descriptor.reservationPredecessorKey,
      sourceToken: descriptor.sourceToken,
      transactionId: descriptor.transactionId,
    });
    expect(() =>
      contracts.recoveryAttemptReservationPathFromPredecessorKey({ ...locator, extra: true }),
    ).toThrow();
    for (const field of Object.keys(locator)) {
      expect(() =>
        contracts.recoveryAttemptReservationPathFromPredecessorKey(without(locator, field)),
      ).toThrow();
      for (const value of [null, 1, false, []])
        expect(() =>
          contracts.recoveryAttemptReservationPathFromPredecessorKey({
            ...locator,
            [field]: value,
          }),
        ).toThrow();
    }
  });

  test("pins domain-separated serialization and canonical-byte parsing", () => {
    const serialized = contracts.serializeContract("recovery-attempt-descriptor/v1", descriptor);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextDecoder().decode(serialized.bytes)).toBe(contracts.canonicalJson(descriptor));
    expect(serialized.digest).toBe(contracts.computeRecoveryAttemptDescriptorDigest(descriptor));
    expect(serialized.digest).toBe(
      "c4a5c80af8f9ee61cbac79122e88fe201dee866a8c7537bd7b8ad5e9440f0b0d",
    );
    expect(serialized.digest).not.toBe(contracts.canonicalDigest(descriptor));
    expect(
      contracts.parseCanonicalContractBytes(
        "recovery-attempt-descriptor/v1",
        contracts.canonicalBytes(descriptor),
      ).ok,
    ).toBe(true);
    const reordered = Object.fromEntries(Object.entries(descriptor).reverse());
    expect(
      contracts.parseCanonicalContractBytes(
        "recovery-attempt-descriptor/v1",
        new TextEncoder().encode(`${JSON.stringify(reordered)}\n`),
      ).ok,
    ).toBe(false);
  });

  test("keeps the descriptor structural and LIVE-only", () => {
    expect(exactLifecycleType).toBe(true);
    expect(contracts.recoveryAttemptDescriptorLifecycles).toEqual(["LIVE"]);
    expect(contracts.schemaVersions).toContain("recovery-attempt-descriptor/v1");
    expect(contracts.schemaVocabularyDefinitions["recovery-attempt-descriptor/v1"]).toEqual({
      schemaVersion: "recovery-attempt-descriptor/v1",
      fields: contracts.recoveryAttemptDescriptorSchemaFields,
      closedValues: ["LIVE"],
    });
    for (const name of [
      "descriptorInputsDigest",
      "launchDefinitionDigest",
      "parseProcessStartObservation",
      "parseActivationRecoveryLaunch",
      "parseAttemptLog",
      "parseRecoveryAuthorizationAttachment",
      "computeRecoveryAttemptArchiveDigest",
    ])
      expect(Object.hasOwn(contracts, name), name).toBe(false);
    expect(JSON.stringify(contracts.recoveryAttemptDescriptorSchemaFields)).not.toMatch(
      /READY|TERMINAL|UNKNOWN|TOMBSTONE|argv|executable|shim|path|user|processId|processTree|attachment|archive|activeRelease|cleanupGate|recoveryFence|authorityEpoch|predecessorTip/,
    );
  });

  test("is total over hostile reflective inputs", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], "descriptor", hostile]) {
      expect(() => contracts.parseRecoveryAttemptDescriptor(input)).not.toThrow();
      expect(contracts.parseRecoveryAttemptDescriptor(input).ok).toBe(false);
      expect(() => contracts.computeRecoveryAttemptDescriptorDigest(input)).toThrow();
      expect(() => contracts.recoveryAttemptDescriptorPath(input)).toThrow();
    }
  });
});

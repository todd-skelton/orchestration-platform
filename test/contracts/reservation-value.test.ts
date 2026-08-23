import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import type { RecoveryAttemptReservationLifecycle } from "../../packages/contracts/src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
const exactLifecycleType: Equal<
  RecoveryAttemptReservationLifecycle,
  "RESERVED" | "CONSUMED" | "TERMINAL"
> = true;
if (false) {
  // @ts-expect-error the common tombstone schema is not a reservation value lifecycle
  const forbiddenLifecycle: RecoveryAttemptReservationLifecycle = "TOMBSTONE";
  void forbiddenLifecycle;
}

const d = (value: string): string => value.repeat(64);
const attemptId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const installationId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";

const reserved = Object.freeze({
  activeReleaseTipDigest: d("1"),
  attemptId,
  cleanupGateTipDigest: d("2"),
  lifecycle: "RESERVED",
  predecessorAttemptLogTipDigest: null,
  recordedAt: "2026-08-23T20:00:00.000Z",
  recoveryFenceTipDigest: null,
  schemaVersion: "recovery-attempt-reservation/v1",
});
const consumed = Object.freeze({
  ...reserved,
  lifecycle: "CONSUMED",
  recordedAt: "2026-08-23T20:00:01.000Z",
  selectedAttemptLogTipDigest: d("3"),
});
const terminal = Object.freeze({
  ...consumed,
  lifecycle: "TERMINAL",
  recordedAt: "2026-08-23T20:00:02.000Z",
  selectedAttemptLogTipDigest: d("4"),
});
const fixtures = [reserved, consumed, terminal] as const;

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery attempt reservation values", () => {
  test("pins the exact sorted branch censuses and three detached canonical cells", () => {
    expect(contracts.recoveryAttemptReservationSchemaFields.reserved).toEqual([
      "activeReleaseTipDigest",
      "attemptId",
      "cleanupGateTipDigest",
      "lifecycle",
      "predecessorAttemptLogTipDigest",
      "recordedAt",
      "recoveryFenceTipDigest",
      "schemaVersion",
    ]);
    const selectedFields = [
      ...contracts.recoveryAttemptReservationSchemaFields.reserved,
      "selectedAttemptLogTipDigest",
    ];
    expect(contracts.recoveryAttemptReservationSchemaFields.consumed).toEqual(selectedFields);
    expect(contracts.recoveryAttemptReservationSchemaFields.terminal).toEqual(selectedFields);
    expect(fixtures.map((fixture) => contracts.canonicalJson(fixture))).toEqual([
      '{"activeReleaseTipDigest":"1111111111111111111111111111111111111111111111111111111111111111","attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","cleanupGateTipDigest":"2222222222222222222222222222222222222222222222222222222222222222","lifecycle":"RESERVED","predecessorAttemptLogTipDigest":null,"recordedAt":"2026-08-23T20:00:00.000Z","recoveryFenceTipDigest":null,"schemaVersion":"recovery-attempt-reservation/v1"}\n',
      '{"activeReleaseTipDigest":"1111111111111111111111111111111111111111111111111111111111111111","attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","cleanupGateTipDigest":"2222222222222222222222222222222222222222222222222222222222222222","lifecycle":"CONSUMED","predecessorAttemptLogTipDigest":null,"recordedAt":"2026-08-23T20:00:01.000Z","recoveryFenceTipDigest":null,"schemaVersion":"recovery-attempt-reservation/v1","selectedAttemptLogTipDigest":"3333333333333333333333333333333333333333333333333333333333333333"}\n',
      '{"activeReleaseTipDigest":"1111111111111111111111111111111111111111111111111111111111111111","attemptId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","cleanupGateTipDigest":"2222222222222222222222222222222222222222222222222222222222222222","lifecycle":"TERMINAL","predecessorAttemptLogTipDigest":null,"recordedAt":"2026-08-23T20:00:02.000Z","recoveryFenceTipDigest":null,"schemaVersion":"recovery-attempt-reservation/v1","selectedAttemptLogTipDigest":"4444444444444444444444444444444444444444444444444444444444444444"}\n',
    ]);
  });

  test("closes every branch member and refuses cross-branch or fourth-lifecycle shapes", () => {
    for (const fixture of fixtures as readonly Readonly<Record<string, unknown>>[]) {
      expect(contracts.parseRecoveryAttemptReservation(fixture).ok).toBe(true);
      expect(contracts.parseContract("recovery-attempt-reservation/v1", fixture).ok).toBe(true);
      for (const field of Object.keys(fixture)) {
        expect(contracts.parseRecoveryAttemptReservation(without(fixture, field)).ok).toBe(false);
        const nullable =
          field === "predecessorAttemptLogTipDigest" || field === "recoveryFenceTipDigest";
        if (!nullable)
          expect(
            contracts.parseRecoveryAttemptReservation({ ...fixture, [field]: null }).ok,
            `${String(fixture.lifecycle)}.${field}:null`,
          ).toBe(false);
        expect(
          contracts.parseRecoveryAttemptReservation({ ...fixture, [field]: 1 }).ok,
          `${String(fixture.lifecycle)}.${field}:number`,
        ).toBe(false);
        expect(
          contracts.parseRecoveryAttemptReservation({
            ...without(fixture, field),
            [`${field}Renamed`]: fixture[field],
          }).ok,
        ).toBe(false);
      }
    }
    expect(
      contracts.parseRecoveryAttemptReservation({
        ...reserved,
        selectedAttemptLogTipDigest: d("3"),
      }).ok,
    ).toBe(false);
    for (const lifecycle of ["CONSUMED", "TERMINAL"])
      expect(
        contracts.parseRecoveryAttemptReservation({
          ...without(consumed, "selectedAttemptLogTipDigest"),
          lifecycle,
        }).ok,
      ).toBe(false);
    for (const lifecycle of ["TOMBSTONE", "READY_ONLY", "IN_PROGRESS"])
      expect(contracts.parseRecoveryAttemptReservation({ ...reserved, lifecycle }).ok).toBe(false);
  });

  test("checks every scalar and both nullable structural cells", () => {
    for (const [field, invalid] of [
      ["activeReleaseTipDigest", "bad"],
      ["attemptId", "018f0f4d-7b2d-6a11-8a2b-123456789abc"],
      ["cleanupGateTipDigest", "BAD".repeat(21) + "B"],
      ["recordedAt", "2026-08-23T20:00:00Z"],
      ["schemaVersion", "recovery-attempt-reservation/v2"],
    ] as const)
      expect(contracts.parseRecoveryAttemptReservation({ ...reserved, [field]: invalid }).ok).toBe(
        false,
      );
    for (const field of ["predecessorAttemptLogTipDigest", "recoveryFenceTipDigest"] as const) {
      expect(contracts.parseRecoveryAttemptReservation({ ...reserved, [field]: d("a") }).ok).toBe(
        true,
      );
      for (const invalid of ["bad", 0, false, []])
        expect(
          contracts.parseRecoveryAttemptReservation({ ...reserved, [field]: invalid }).ok,
        ).toBe(false);
    }
    expect(
      contracts.parseRecoveryAttemptReservation({
        ...consumed,
        selectedAttemptLogTipDigest: null,
      }).ok,
    ).toBe(false);
  });

  test("admits only null to RESERVED to CONSUMED to TERMINAL", () => {
    expect(contracts.validateRecoveryAttemptReservationTransition(null, reserved)).toEqual([]);
    expect(contracts.validateRecoveryAttemptReservationTransition(reserved, consumed)).toEqual([]);
    expect(contracts.validateRecoveryAttemptReservationTransition(consumed, terminal)).toEqual([]);
    expect(
      contracts.validateRecoveryAttemptReservationTransition(reserved, {
        ...consumed,
        recordedAt: reserved.recordedAt,
      }),
    ).toEqual([]);
    expect(
      contracts.validateRecoveryAttemptReservationTransition(consumed, {
        ...terminal,
        selectedAttemptLogTipDigest: d("9"),
      }),
    ).toEqual([]);

    for (const [previous, next] of [
      [null, consumed],
      [null, terminal],
      [reserved, reserved],
      [reserved, terminal],
      [consumed, reserved],
      [consumed, consumed],
      [terminal, reserved],
      [terminal, consumed],
      [terminal, terminal],
    ] as const)
      expect(contracts.validateRecoveryAttemptReservationTransition(previous, next)).not.toEqual(
        [],
      );

    for (const field of [
      "activeReleaseTipDigest",
      "attemptId",
      "cleanupGateTipDigest",
      "predecessorAttemptLogTipDigest",
      "recoveryFenceTipDigest",
    ] as const) {
      const replacement = field === "attemptId" ? transactionId : d("f");
      expect(
        contracts.validateRecoveryAttemptReservationTransition(reserved, {
          ...consumed,
          [field]: replacement,
        }),
        field,
      ).not.toEqual([]);
    }
    expect(
      contracts.validateRecoveryAttemptReservationTransition(reserved, {
        ...consumed,
        recordedAt: "2026-08-23T19:59:59.999Z",
      }),
    ).toContain("recordedAt:before-prior");
  });

  test("admits canonical detached bytes but refuses detached identity serialization", () => {
    expect(contracts.schemaVersions).toContain("recovery-attempt-reservation/v1");
    expect(
      contracts.compatibilityDisposition(
        "recovery-attempt-reservation/v1",
        "recovery-attempt-reservation/v1",
      ),
    ).toBe("readable");
    expect(contracts.serializeContract("recovery-attempt-reservation/v1", reserved)).toEqual({
      ok: false,
      issues: ["serialization:pointer-context-required"],
    });
    for (const fixture of fixtures) {
      expect(
        contracts.parseCanonicalContractBytes(
          "recovery-attempt-reservation/v1",
          contracts.canonicalBytes(fixture),
        ).ok,
      ).toBe(true);
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      expect(
        contracts.parseCanonicalContractBytes(
          "recovery-attempt-reservation/v1",
          new TextEncoder().encode(`${JSON.stringify(reordered)}\n`),
        ).ok,
      ).toBe(false);
    }
  });

  test("derives identity only through common Dv and authenticated Dp", () => {
    const predecessor = Object.freeze({
      predecessorReceiptDigest: null,
      predecessorTipDigest: null,
      predecessorValueDigest: null,
      sourceToken: "cleanup-gate-pre-fence" as const,
      transactionId,
    });
    const identity = Object.freeze({
      canonicalPointerPath: contracts.recoveryAttemptReservationPath(predecessor),
      installationId,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION" as const,
      positionEvidence: Object.freeze({ mode: "VALUE", parts: Object.freeze({}) }),
      projectId,
      sourceToken: predecessor.sourceToken,
      stateRootDigest: d("8"),
      transactionId,
    });
    const pathInstanceDigest = contracts.computePointerInstanceDigest(identity);
    const commonValueDigest = contracts.computePointerValueDigest(
      "RECOVERY_ATTEMPT_RESERVATION",
      pathInstanceDigest,
      reserved,
    );
    expect(commonValueDigest).toBe(
      contracts.computePointerValueDigest(
        "RECOVERY_ATTEMPT_RESERVATION",
        contracts.computePointerInstanceDigestFromCanonicalPath(identity),
        reserved,
      ),
    );
    expect(
      contracts.computePointerValueDigest("RECOVERY_ATTEMPT_RESERVATION", d("9"), reserved),
    ).not.toBe(commonValueDigest);
  });

  test("keeps removed and downstream surfaces absent", () => {
    expect(exactLifecycleType).toBe(true);
    expect(contracts.recoveryAttemptReservationLifecycles).toEqual([
      "RESERVED",
      "CONSUMED",
      "TERMINAL",
    ]);
    for (const name of [
      "computeRecoveryAttemptReservationDigest",
      "descriptorInputsDigest",
      "launchDefinitionDigest",
      "recoveryAttemptDescriptorSchemaFields",
      "recoveryAttemptLogSchemaFields",
      "recoveryAttemptReservationTombstone",
    ])
      expect(Object.hasOwn(contracts, name), name).toBe(false);
    expect(JSON.stringify(contracts.recoveryAttemptReservationSchemaFields)).not.toMatch(
      /READY_ONLY|TOMBSTONE|descriptorInputsDigest|launchDefinitionDigest|argv|executable|processId|terminalSummary|TipValueDigest|TipReceiptDigest/,
    );
  });

  test("is total over hostile reflective parser and transition inputs", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], "reservation", hostile]) {
      expect(() => contracts.parseRecoveryAttemptReservation(input)).not.toThrow();
      expect(contracts.parseRecoveryAttemptReservation(input).ok).toBe(false);
      expect(() =>
        contracts.validateRecoveryAttemptReservationTransition(input, reserved),
      ).not.toThrow();
      expect(() =>
        contracts.validateRecoveryAttemptReservationTransition(reserved, input),
      ).not.toThrow();
    }
  });
});

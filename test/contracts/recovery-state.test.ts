import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";
const consumeOperationId = "018f0f4d-7b2d-7a14-aa2b-123456789abc";
const removalOperationId = "018f0f4d-7b2d-7a15-ba2b-123456789abc";

const created = Object.freeze({
  authorizationCoreDigest: d("0"),
  consumeOperationId,
  lifecycle: "CREATED",
  mode: "BOOTSTRAP",
  recordedAt: "2026-08-21T01:00:00.000Z",
  schemaVersion: "recovery-authorization-state/v1",
  transactionId,
});
const consumed = Object.freeze({
  authorizationCoreDigest: d("0"),
  cleanupGateRootDigest: d("1"),
  consumeOperationId,
  lifecycle: "CONSUMED",
  mode: "BOOTSTRAP",
  nativeConsumeReceiptDigest: d("2"),
  recordedAt: "2026-08-21T01:00:01.000Z",
  schemaVersion: "recovery-authorization-state/v1",
  transactionId,
});
const revokedPreGate = Object.freeze({
  authorizationCoreDigest: d("0"),
  cleanupGateRootDigest: null,
  consumeOperationId,
  consumePostSelectionReceiptDigest: null,
  lifecycle: "REVOKED",
  mode: "BOOTSTRAP",
  nativeConsumeReceiptDigest: null,
  nativeRemovalReceiptDigest: d("3"),
  recordedAt: "2026-08-21T01:00:01.000Z",
  removalOperationId,
  schemaVersion: "recovery-authorization-state/v1",
  transactionId,
});
const revokedPostGate = Object.freeze({
  ...revokedPreGate,
  cleanupGateRootDigest: d("1"),
});
const revokedConsumed = Object.freeze({
  ...revokedPostGate,
  consumePostSelectionReceiptDigest: d("4"),
  nativeConsumeReceiptDigest: d("2"),
  recordedAt: "2026-08-21T01:00:02.000Z",
});
const fixtures = [created, consumed, revokedPreGate, revokedPostGate, revokedConsumed] as const;

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery authorization selected state", () => {
  test("pins the three exact sorted branch censuses and five canonical cells", () => {
    expect(contracts.recoveryAuthorizationStateSchemaFields.created).toEqual([
      "authorizationCoreDigest",
      "consumeOperationId",
      "lifecycle",
      "mode",
      "recordedAt",
      "schemaVersion",
      "transactionId",
    ]);
    expect(contracts.recoveryAuthorizationStateSchemaFields.consumed).toEqual([
      "authorizationCoreDigest",
      "cleanupGateRootDigest",
      "consumeOperationId",
      "lifecycle",
      "mode",
      "nativeConsumeReceiptDigest",
      "recordedAt",
      "schemaVersion",
      "transactionId",
    ]);
    expect(contracts.recoveryAuthorizationStateSchemaFields.revoked).toEqual([
      "authorizationCoreDigest",
      "cleanupGateRootDigest",
      "consumeOperationId",
      "consumePostSelectionReceiptDigest",
      "lifecycle",
      "mode",
      "nativeConsumeReceiptDigest",
      "nativeRemovalReceiptDigest",
      "recordedAt",
      "removalOperationId",
      "schemaVersion",
      "transactionId",
    ]);
    expect(fixtures.map((fixture) => contracts.canonicalJson(fixture))).toEqual([
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","consumeOperationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","lifecycle":"CREATED","mode":"BOOTSTRAP","recordedAt":"2026-08-21T01:00:00.000Z","schemaVersion":"recovery-authorization-state/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","cleanupGateRootDigest":"1111111111111111111111111111111111111111111111111111111111111111","consumeOperationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","lifecycle":"CONSUMED","mode":"BOOTSTRAP","nativeConsumeReceiptDigest":"2222222222222222222222222222222222222222222222222222222222222222","recordedAt":"2026-08-21T01:00:01.000Z","schemaVersion":"recovery-authorization-state/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","cleanupGateRootDigest":null,"consumeOperationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","consumePostSelectionReceiptDigest":null,"lifecycle":"REVOKED","mode":"BOOTSTRAP","nativeConsumeReceiptDigest":null,"nativeRemovalReceiptDigest":"3333333333333333333333333333333333333333333333333333333333333333","recordedAt":"2026-08-21T01:00:01.000Z","removalOperationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","schemaVersion":"recovery-authorization-state/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","cleanupGateRootDigest":"1111111111111111111111111111111111111111111111111111111111111111","consumeOperationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","consumePostSelectionReceiptDigest":null,"lifecycle":"REVOKED","mode":"BOOTSTRAP","nativeConsumeReceiptDigest":null,"nativeRemovalReceiptDigest":"3333333333333333333333333333333333333333333333333333333333333333","recordedAt":"2026-08-21T01:00:01.000Z","removalOperationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","schemaVersion":"recovery-authorization-state/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","cleanupGateRootDigest":"1111111111111111111111111111111111111111111111111111111111111111","consumeOperationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","consumePostSelectionReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","lifecycle":"REVOKED","mode":"BOOTSTRAP","nativeConsumeReceiptDigest":"2222222222222222222222222222222222222222222222222222222222222222","nativeRemovalReceiptDigest":"3333333333333333333333333333333333333333333333333333333333333333","recordedAt":"2026-08-21T01:00:02.000Z","removalOperationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","schemaVersion":"recovery-authorization-state/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    ]);
  });

  test("closes every branch member and the three revoked nullability cells", () => {
    for (const fixture of fixtures as readonly Readonly<Record<string, unknown>>[]) {
      expect(contracts.parseRecoveryAuthorizationState(fixture).ok).toBe(true);
      for (const field of Object.keys(fixture)) {
        expect(contracts.parseRecoveryAuthorizationState(without(fixture, field)).ok).toBe(false);
        const nullableRevokedField =
          fixture.lifecycle === "REVOKED" &&
          [
            "cleanupGateRootDigest",
            "consumePostSelectionReceiptDigest",
            "nativeConsumeReceiptDigest",
          ].includes(field);
        if (!nullableRevokedField)
          expect(
            contracts.parseRecoveryAuthorizationState({ ...fixture, [field]: null }).ok,
            `${String(fixture.lifecycle)}.${field}:null`,
          ).toBe(false);
        expect(
          contracts.parseRecoveryAuthorizationState({ ...fixture, [field]: 1 }).ok,
          `${String(fixture.lifecycle)}.${field}:number`,
        ).toBe(false);
        expect(
          contracts.parseRecoveryAuthorizationState({
            ...without(fixture, field),
            [`${field}Renamed`]: fixture[field],
          }).ok,
        ).toBe(false);
      }
    }
    expect(
      contracts.parseRecoveryAuthorizationState({
        ...revokedPreGate,
        consumePostSelectionReceiptDigest: d("4"),
      }).ok,
    ).toBe(false);
    expect(
      contracts.parseRecoveryAuthorizationState({
        ...revokedPreGate,
        nativeConsumeReceiptDigest: d("2"),
      }).ok,
    ).toBe(false);
    expect(
      contracts.parseRecoveryAuthorizationState({
        ...revokedPreGate,
        consumePostSelectionReceiptDigest: d("4"),
        nativeConsumeReceiptDigest: d("2"),
      }).ok,
    ).toBe(false);
    for (const extra of [
      "archiveDigest",
      "cleanupGateRootDigest",
      "consumePostSelectionReceiptDigest",
      "nativeConsumeReceiptDigest",
      "nativeRemovalReceiptDigest",
      "removalOperationId",
    ])
      expect(contracts.parseRecoveryAuthorizationState({ ...created, [extra]: d("f") }).ok).toBe(
        false,
      );
    for (const extra of [
      "consumePostSelectionReceiptDigest",
      "nativeRemovalReceiptDigest",
      "removalOperationId",
    ])
      expect(contracts.parseRecoveryAuthorizationState({ ...consumed, [extra]: d("f") }).ok).toBe(
        false,
      );
    expect(contracts.parseRecoveryAuthorizationState({ ...created, lifecycle: "REMOVED" }).ok).toBe(
      false,
    );
  });

  test("admits only the four pure edges and preserves exact relative facts", () => {
    expect(contracts.validateRecoveryAuthorizationTransition(null, created)).toEqual([]);
    expect(contracts.validateRecoveryAuthorizationTransition(created, consumed)).toEqual([]);
    expect(contracts.validateRecoveryAuthorizationTransition(created, revokedPreGate)).toEqual([]);
    expect(contracts.validateRecoveryAuthorizationTransition(created, revokedPostGate)).toEqual([]);
    expect(contracts.validateRecoveryAuthorizationTransition(consumed, revokedConsumed)).toEqual(
      [],
    );
    for (const [previous, next] of [
      [null, consumed],
      [null, revokedPreGate],
      [created, created],
      [consumed, consumed],
      [revokedConsumed, revokedConsumed],
      [consumed, created],
      [revokedConsumed, created],
      [revokedConsumed, consumed],
    ] as const)
      expect(contracts.validateRecoveryAuthorizationTransition(previous, next)).not.toEqual([]);

    for (const field of [
      "authorizationCoreDigest",
      "consumeOperationId",
      "mode",
      "transactionId",
    ] as const)
      expect(
        contracts.validateRecoveryAuthorizationTransition(created, {
          ...consumed,
          [field]: field === "mode" ? "SUCCESSOR" : field.endsWith("Id") ? installationId : d("f"),
        }),
      ).not.toEqual([]);
    expect(
      contracts.validateRecoveryAuthorizationTransition(created, {
        ...consumed,
        recordedAt: "2026-08-21T00:59:59.999Z",
      }),
    ).toContain("recordedAt:before-prior");
    expect(
      contracts.validateRecoveryAuthorizationTransition(created, {
        ...consumed,
        recordedAt: created.recordedAt,
      }),
    ).toEqual([]);
    expect(contracts.validateRecoveryAuthorizationTransition(created, revokedConsumed)).toContain(
      "consumeReceipts:unexpected",
    );
    expect(
      contracts.validateRecoveryAuthorizationTransition(consumed, {
        ...revokedConsumed,
        cleanupGateRootDigest: d("e"),
      }),
    ).toContain("cleanupGateRootDigest:mismatch");
    expect(
      contracts.validateRecoveryAuthorizationTransition(consumed, {
        ...revokedConsumed,
        nativeConsumeReceiptDigest: d("e"),
      }),
    ).toContain("nativeConsumeReceiptDigest:mismatch");
  });

  test("pins the empty VALUE position and contextual common Dv", () => {
    const position = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
    expect(contracts.parseRecoveryAuthorizationStateValuePosition(position).ok).toBe(true);
    expect(
      contracts.parseRecoveryAuthorizationStateValuePosition({ mode: "TOMBSTONE", parts: {} }).ok,
    ).toBe(false);
    for (const invalid of [
      { mode: "VALUE", parts: { ordinal: "0" } },
      { mode: "VALUE", parts: {}, extra: true },
      { mode: "VALUE" },
    ]) {
      expect(contracts.parseRecoveryAuthorizationStateValuePosition(invalid).ok).toBe(false);
      expect(() =>
        contracts.computePointerPositionDigest("RECOVERY_AUTHORIZATION_STATE", invalid),
      ).toThrow();
    }
    expect(contracts.computeRecoveryAuthorizationStateValuePositionDigest(position)).toBe(
      "4cf9a17dc945568b410d1d23ffef243971cce087b0d87a7d7a97253eb352ec4c",
    );
    const identity = Object.freeze({
      canonicalPointerPath: contracts.recoveryAuthorizationPaths.state(transactionId),
      installationId,
      pointerKind: "RECOVERY_AUTHORIZATION_STATE" as const,
      positionEvidence: position,
      projectId,
      sourceToken: "none",
      stateRootDigest: d("9"),
      transactionId,
    });
    const pathInstanceDigest = contracts.computePointerInstanceDigest(identity);
    const values = fixtures.map((fixture) =>
      contracts.computePointerValueDigest(
        "RECOVERY_AUTHORIZATION_STATE",
        pathInstanceDigest,
        fixture,
      ),
    );
    expect(values).toEqual([
      "a54d7e29b9a597eed50a9ebb587e32271a50b10c16bb94439ddc964f358371d4",
      "88eb27fc7c684be13dc545c18dd544a5e31c589aa8c4c43353164ca2e7a286c2",
      "6d4ceba0d8441168d80c86b17fd0a341e4bae113242f324309671c9a0fc8e299",
      "b7a79d7a209f98374c1c7889a79e1dad985767c0bc1ed0afd41957a62dd1a2a5",
      "fe5dec41e17a31b1de843e5e8b2a61f222c5442ffad8244f49504405d86fac30",
    ]);
    expect(
      contracts.computePointerValueDigest("RECOVERY_AUTHORIZATION_STATE", d("8"), created),
    ).not.toBe(values[0]);
  });

  test("refuses detached generic identity and removes the legacy REMOVED surface", () => {
    expect(contracts.serializeContract("recovery-authorization-state/v1", created)).toEqual({
      ok: false,
      issues: ["serialization:pointer-context-required"],
    });
    for (const fixture of fixtures) {
      expect(
        contracts.parseCanonicalContractBytes(
          "recovery-authorization-state/v1",
          contracts.canonicalBytes(fixture),
        ).ok,
      ).toBe(true);
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      expect(
        contracts.parseCanonicalContractBytes(
          "recovery-authorization-state/v1",
          new TextEncoder().encode(`${JSON.stringify(reordered)}\n`),
        ).ok,
      ).toBe(false);
    }
    expect(contracts.recoveryAuthorizationLifecycles).toEqual(["CREATED", "CONSUMED", "REVOKED"]);
    expect(Object.hasOwn(contracts, "computeRecoveryAuthorizationStateDigest")).toBe(false);
    expect(
      Object.keys(contracts).filter((name) => name === "validateRecoveryAuthorizationTransition"),
    ).toEqual(["validateRecoveryAuthorizationTransition"]);
    expect(
      contracts.validateRecoveryAuthorizationTransition(revokedConsumed, {
        schemaVersion: "recovery-authorization-state/v1",
        lifecycle: "REMOVED",
      }),
    ).not.toEqual([]);
  });

  test("is total over hostile reflective state and transition inputs", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, [], "state", hostile]) {
      expect(() => contracts.parseRecoveryAuthorizationState(input)).not.toThrow();
      expect(contracts.parseRecoveryAuthorizationState(input).ok).toBe(false);
      expect(() => contracts.validateRecoveryAuthorizationTransition(input, created)).not.toThrow();
      expect(() => contracts.validateRecoveryAuthorizationTransition(created, input)).not.toThrow();
    }
  });
});

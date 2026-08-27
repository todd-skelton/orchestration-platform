import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const transactionId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";
const consumeOperationId = "018f0f4d-7b2d-7a14-aa2b-123456789abc";
const revokeOperationId = "018f0f4d-7b2d-7a15-ba2b-123456789abc";

const consume = Object.freeze({
  operationId: consumeOperationId,
  recordedAt: "2026-08-21T03:00:00.000Z",
  schemaVersion: "recovery-authorization-consume-receipt/v1",
  selectedStateTipDigest: d("a"),
  transactionId,
});
const revoke = Object.freeze({
  operationId: revokeOperationId,
  recordedAt: "2026-08-21T03:00:01.000Z",
  schemaVersion: "recovery-authorization-revoke-receipt/v1",
  selectedStateTipDigest: d("b"),
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

describe("recovery authorization post-selection receipts", () => {
  test("pins exact closed five-member censuses and canonical bytes", () => {
    expect(contracts.recoveryAuthorizationPostSelectionReceiptSchemaFields.consume).toEqual([
      "operationId",
      "recordedAt",
      "schemaVersion",
      "selectedStateTipDigest",
      "transactionId",
    ]);
    expect(contracts.recoveryAuthorizationPostSelectionReceiptSchemaFields.revoke).toEqual([
      "operationId",
      "recordedAt",
      "schemaVersion",
      "selectedStateTipDigest",
      "transactionId",
    ]);
    expect(contracts.canonicalJson(consume)).toBe(
      '{"operationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","recordedAt":"2026-08-21T03:00:00.000Z","schemaVersion":"recovery-authorization-consume-receipt/v1","selectedStateTipDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
    expect(contracts.canonicalJson(revoke)).toBe(
      '{"operationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","recordedAt":"2026-08-21T03:00:01.000Z","schemaVersion":"recovery-authorization-revoke-receipt/v1","selectedStateTipDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
  });

  test("closes every member, schema branch, and deleted proof-bag field", () => {
    for (const [fixture, parse] of [
      [consume, contracts.parseRecoveryAuthorizationConsumeReceipt],
      [revoke, contracts.parseRecoveryAuthorizationRevokeReceipt],
    ] as const) {
      expect(parse(fixture).ok).toBe(true);
      for (const field of Object.keys(fixture)) {
        expect(parse(without(fixture, field)).ok, `${field}:missing`).toBe(false);
        expect(parse({ ...fixture, [field]: null }).ok, `${field}:null`).toBe(false);
        expect(parse({ ...fixture, [field]: 1 }).ok, `${field}:number`).toBe(false);
        expect(
          parse({
            ...without(fixture, field),
            [`${field}Renamed`]: fixture[field as keyof typeof fixture],
          }).ok,
          `${field}:renamed`,
        ).toBe(false);
      }
      for (const deletedProofField of [
        "selectedStatePathInstanceDigest",
        "selectedStateValueDigest",
        "selectedStateProposalReceiptDigest",
      ])
        expect(parse({ ...fixture, [deletedProofField]: d("f") }).ok).toBe(false);
    }
    expect(contracts.parseRecoveryAuthorizationConsumeReceipt(revoke).ok).toBe(false);
    expect(contracts.parseRecoveryAuthorizationRevokeReceipt(consume).ok).toBe(false);
    expect(contracts.parseRecoveryAuthorizationConsumeReceipt({ ...consume, ...revoke }).ok).toBe(
      false,
    );
    expect(contracts.parseRecoveryAuthorizationRevokeReceipt({ ...revoke, ...consume }).ok).toBe(
      false,
    );
  });

  test("pins receipt-own path sensitivity without cross-operation authority", () => {
    const consumePath = contracts.recoveryAuthorizationPaths.postSelectionReceipt(
      transactionId,
      consumeOperationId,
    );
    const revokePath = contracts.recoveryAuthorizationPaths.postSelectionReceipt(
      transactionId,
      revokeOperationId,
    );
    expect(consumePath).toBe(
      "installation/recovery-authorizations/018f0f4d-7b2d-7a13-9a2b-123456789abc/receipts/018f0f4d-7b2d-7a14-aa2b-123456789abc.json",
    );
    expect(revokePath).not.toBe(consumePath);
    expect(
      contracts.recoveryAuthorizationPaths.postSelectionReceipt(
        "018f0f4d-7b2d-7a16-8a2b-123456789abc",
        consumeOperationId,
      ),
    ).not.toBe(consumePath);
    expect(() =>
      contracts.recoveryAuthorizationPaths.postSelectionReceipt("bad", consumeOperationId),
    ).toThrow();
    expect(() =>
      contracts.recoveryAuthorizationPaths.postSelectionReceipt(transactionId, "bad"),
    ).toThrow();
    expect(
      contracts.parseRecoveryAuthorizationConsumeReceipt({
        ...consume,
        operationId: revokeOperationId,
      }).ok,
    ).toBe(true);
    expect(
      contracts.parseRecoveryAuthorizationRevokeReceipt({
        ...revoke,
        operationId: consumeOperationId,
      }).ok,
    ).toBe(true);
  });

  test("pins tagged digests and the existing serializer success arm", () => {
    const consumeDigest = contracts.computeRecoveryAuthorizationConsumeReceiptDigest(consume);
    const revokeDigest = contracts.computeRecoveryAuthorizationRevokeReceiptDigest(revoke);
    expect([consumeDigest, revokeDigest]).toEqual([
      "e31cf3511d29134cd7c1a6ac4eb5efbf4d16124b478477d0c70703ed63f39e92",
      "313d469d3ab729c5a5bb1d8129f2588b81023fd433e47b874e36397c0ef8af81",
    ]);
    expect(consumeDigest).not.toBe(contracts.canonicalDigest(consume));
    expect(revokeDigest).not.toBe(contracts.canonicalDigest(revoke));
    expect(consumeDigest).not.toBe(revokeDigest);
    expect(contracts.serializeContract(consume.schemaVersion, consume)).toEqual({
      ok: true,
      bytes: contracts.canonicalBytes(consume),
      digest: consumeDigest,
    });
    expect(contracts.serializeContract(revoke.schemaVersion, revoke)).toEqual({
      ok: true,
      bytes: contracts.canonicalBytes(revoke),
      digest: revokeDigest,
    });
    expect(() => contracts.computeRecoveryAuthorizationConsumeReceiptDigest(revoke)).toThrow();
    expect(() => contracts.computeRecoveryAuthorizationRevokeReceiptDigest(consume)).toThrow();
  });

  test("registers only exact canonical bytes and stays total over hostile inputs", () => {
    for (const fixture of [consume, revoke]) {
      expect(contracts.schemaVersions).toContain(fixture.schemaVersion);
      expect(
        contracts.parseCanonicalContractBytes(
          fixture.schemaVersion,
          contracts.canonicalBytes(fixture),
        ).ok,
      ).toBe(true);
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      expect(
        contracts.parseCanonicalContractBytes(
          fixture.schemaVersion,
          new TextEncoder().encode(`${JSON.stringify(reordered)}\n`),
        ).ok,
      ).toBe(false);
    }
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, [], "receipt", hostile]) {
      expect(() => contracts.parseRecoveryAuthorizationConsumeReceipt(input)).not.toThrow();
      expect(() => contracts.parseRecoveryAuthorizationRevokeReceipt(input)).not.toThrow();
      expect(contracts.parseRecoveryAuthorizationConsumeReceipt(input).ok).toBe(false);
      expect(contracts.parseRecoveryAuthorizationRevokeReceipt(input).ok).toBe(false);
    }
  });
});

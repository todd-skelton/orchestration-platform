import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const transactionId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";
const consumeOperationId = "018f0f4d-7b2d-7a14-aa2b-123456789abc";
const removalOperationId = "018f0f4d-7b2d-7a15-ba2b-123456789abc";

const consume = Object.freeze({
  authorizationCoreDigest: d("0"),
  nativeGeneration: "0",
  operationId: consumeOperationId,
  recordedAt: "2026-08-21T02:00:00.000Z",
  schemaVersion: "native-consume-receipt/v1",
  transactionId,
});
const removalBeforeConsume = Object.freeze({
  authorizationCoreDigest: d("0"),
  nativeConsumeReceiptDigest: null,
  operationId: removalOperationId,
  priorNativeGeneration: "0",
  recordedAt: "2026-08-21T02:00:01.000Z",
  removalDisposition: "ABSENT",
  schemaVersion: "native-removal-receipt/v1",
  successorNativeGeneration: "1",
  transactionId,
});
const removalAfterConsume = Object.freeze({
  ...removalBeforeConsume,
  nativeConsumeReceiptDigest: d("1"),
  removalDisposition: "DISABLED",
});

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery authorization native receipts", () => {
  test("pins exact closed censuses and canonical bytes", () => {
    expect(contracts.recoveryAuthorizationNativeReceiptSchemaFields.consume).toEqual([
      "authorizationCoreDigest",
      "nativeGeneration",
      "operationId",
      "recordedAt",
      "schemaVersion",
      "transactionId",
    ]);
    expect(contracts.recoveryAuthorizationNativeReceiptSchemaFields.removal).toEqual([
      "authorizationCoreDigest",
      "nativeConsumeReceiptDigest",
      "operationId",
      "priorNativeGeneration",
      "recordedAt",
      "removalDisposition",
      "schemaVersion",
      "successorNativeGeneration",
      "transactionId",
    ]);
    expect(contracts.canonicalJson(consume)).toBe(
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","nativeGeneration":"0","operationId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","recordedAt":"2026-08-21T02:00:00.000Z","schemaVersion":"native-consume-receipt/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
    expect(contracts.canonicalJson(removalBeforeConsume)).toBe(
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","nativeConsumeReceiptDigest":null,"operationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","priorNativeGeneration":"0","recordedAt":"2026-08-21T02:00:01.000Z","removalDisposition":"ABSENT","schemaVersion":"native-removal-receipt/v1","successorNativeGeneration":"1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
    expect(contracts.canonicalJson(removalAfterConsume)).toBe(
      '{"authorizationCoreDigest":"0000000000000000000000000000000000000000000000000000000000000000","nativeConsumeReceiptDigest":"1111111111111111111111111111111111111111111111111111111111111111","operationId":"018f0f4d-7b2d-7a15-ba2b-123456789abc","priorNativeGeneration":"0","recordedAt":"2026-08-21T02:00:01.000Z","removalDisposition":"DISABLED","schemaVersion":"native-removal-receipt/v1","successorNativeGeneration":"1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
  });

  test("closes every member, nullable arm, schema, and disposition", () => {
    for (const [fixture, parse] of [
      [consume, contracts.parseNativeConsumeReceipt],
      [removalBeforeConsume, contracts.parseNativeRemovalReceipt],
      [removalAfterConsume, contracts.parseNativeRemovalReceipt],
    ] as const) {
      expect(parse(fixture).ok).toBe(true);
      for (const field of Object.keys(fixture)) {
        expect(parse(without(fixture, field)).ok, `${field}:missing`).toBe(false);
        if (field !== "nativeConsumeReceiptDigest")
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
    }
    expect(contracts.parseNativeRemovalReceipt(removalBeforeConsume).ok).toBe(true);
    expect(contracts.parseNativeRemovalReceipt(removalAfterConsume).ok).toBe(true);
    expect(
      contracts.parseNativeRemovalReceipt({
        ...removalBeforeConsume,
        removalDisposition: "DISABLED",
      }).ok,
    ).toBe(true);
    expect(
      contracts.parseNativeRemovalReceipt({
        ...removalAfterConsume,
        removalDisposition: "ABSENT",
      }).ok,
    ).toBe(true);
    expect(
      contracts.parseNativeRemovalReceipt({
        ...removalBeforeConsume,
        nativeConsumeReceiptDigest: "not-a-digest",
      }).ok,
    ).toBe(false);
    for (const removalDisposition of ["REMOVED", "absent", "UNKNOWN"])
      expect(
        contracts.parseNativeRemovalReceipt({
          ...removalBeforeConsume,
          removalDisposition,
        }).ok,
      ).toBe(false);
    for (const copiedCoreField of [
      "capabilityDigest",
      "capabilityReferenceDigest",
      "hostIdentityDigest",
      "installationId",
      "projectId",
      "stateRootDigest",
      "userIdentityDigest",
    ]) {
      expect(
        contracts.parseNativeConsumeReceipt({ ...consume, [copiedCoreField]: d("f") }).ok,
      ).toBe(false);
      expect(
        contracts.parseNativeRemovalReceipt({
          ...removalBeforeConsume,
          [copiedCoreField]: d("f"),
        }).ok,
      ).toBe(false);
    }
    expect(contracts.parseNativeConsumeReceipt({ ...consume, ...removalBeforeConsume }).ok).toBe(
      false,
    );
    expect(contracts.parseNativeRemovalReceipt({ ...removalBeforeConsume, ...consume }).ok).toBe(
      false,
    );
  });

  test("enforces canonical safe-integer generation adjacency", () => {
    const maximum = String(Number.MAX_SAFE_INTEGER);
    const beforeMaximum = String(Number.MAX_SAFE_INTEGER - 1);
    expect(contracts.parseNativeConsumeReceipt({ ...consume, nativeGeneration: maximum }).ok).toBe(
      true,
    );
    expect(
      contracts.parseNativeRemovalReceipt({
        ...removalBeforeConsume,
        priorNativeGeneration: beforeMaximum,
        successorNativeGeneration: maximum,
      }).ok,
    ).toBe(true);
    for (const [priorNativeGeneration, successorNativeGeneration] of [
      ["0", "0"],
      ["0", "2"],
      ["01", "2"],
      [maximum, maximum],
      [maximum, String(Number.MAX_SAFE_INTEGER + 1)],
    ])
      expect(
        contracts.parseNativeRemovalReceipt({
          ...removalBeforeConsume,
          priorNativeGeneration,
          successorNativeGeneration,
        }).ok,
      ).toBe(false);
    for (const nativeGeneration of ["00", String(Number.MAX_SAFE_INTEGER + 1), -1, 1])
      expect(contracts.parseNativeConsumeReceipt({ ...consume, nativeGeneration }).ok).toBe(false);
  });

  test("pins receipt-own path sensitivity without cross-operation authority", () => {
    const consumePath = contracts.recoveryAuthorizationPaths.nativeReceipt(
      transactionId,
      consumeOperationId,
    );
    const removalPath = contracts.recoveryAuthorizationPaths.nativeReceipt(
      transactionId,
      removalOperationId,
    );
    expect(consumePath).toBe(
      "installation/recovery-authorizations/018f0f4d-7b2d-7a13-9a2b-123456789abc/native/018f0f4d-7b2d-7a14-aa2b-123456789abc.json",
    );
    expect(removalPath).not.toBe(consumePath);
    expect(
      contracts.recoveryAuthorizationPaths.nativeReceipt(
        "018f0f4d-7b2d-7a16-8a2b-123456789abc",
        consumeOperationId,
      ),
    ).not.toBe(consumePath);
    expect(() =>
      contracts.recoveryAuthorizationPaths.nativeReceipt("bad", consumeOperationId),
    ).toThrow();
    expect(() =>
      contracts.recoveryAuthorizationPaths.nativeReceipt(transactionId, "bad"),
    ).toThrow();
    expect(
      contracts.parseNativeConsumeReceipt({ ...consume, operationId: removalOperationId }).ok,
    ).toBe(true);
    expect(
      contracts.parseNativeRemovalReceipt({
        ...removalBeforeConsume,
        operationId: consumeOperationId,
      }).ok,
    ).toBe(true);
  });

  test("pins tagged digests and the existing serializer success arm", () => {
    const consumeDigest = contracts.computeNativeConsumeReceiptDigest(consume);
    const removalBeforeDigest = contracts.computeNativeRemovalReceiptDigest(removalBeforeConsume);
    const removalAfterDigest = contracts.computeNativeRemovalReceiptDigest(removalAfterConsume);
    expect([consumeDigest, removalBeforeDigest, removalAfterDigest]).toEqual([
      "ed3e4437579cdb1d3f4d417027fafc5cdc427da1ca4c4748e8b3044f9a150da5",
      "8b52bd3636ffa894092c85e5f81c129d8a94eef6715f9918ed0bce9869559d88",
      "c0da986cbe35f88f1bacc9b357af0c3afff1554af2d3acf7c3419c841a25ea46",
    ]);
    expect(consumeDigest).not.toBe(contracts.canonicalDigest(consume));
    expect(removalBeforeDigest).not.toBe(contracts.canonicalDigest(removalBeforeConsume));
    expect(consumeDigest).not.toBe(removalBeforeDigest);
    expect(contracts.serializeContract("native-consume-receipt/v1", consume)).toEqual({
      ok: true,
      bytes: contracts.canonicalBytes(consume),
      digest: consumeDigest,
    });
    expect(contracts.serializeContract("native-removal-receipt/v1", removalAfterConsume)).toEqual({
      ok: true,
      bytes: contracts.canonicalBytes(removalAfterConsume),
      digest: removalAfterDigest,
    });
    expect(() => contracts.computeNativeConsumeReceiptDigest(removalBeforeConsume)).toThrow();
    expect(() => contracts.computeNativeRemovalReceiptDigest(consume)).toThrow();
  });

  test("admits only exact canonical detached bytes and is total over hostile inputs", () => {
    for (const [schemaVersion, fixture] of [
      ["native-consume-receipt/v1", consume],
      ["native-removal-receipt/v1", removalBeforeConsume],
      ["native-removal-receipt/v1", removalAfterConsume],
    ] as const) {
      expect(
        contracts.parseCanonicalContractBytes(schemaVersion, contracts.canonicalBytes(fixture)).ok,
      ).toBe(true);
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      expect(
        contracts.parseCanonicalContractBytes(
          schemaVersion,
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
      expect(() => contracts.parseNativeConsumeReceipt(input)).not.toThrow();
      expect(() => contracts.parseNativeRemovalReceipt(input)).not.toThrow();
      expect(contracts.parseNativeConsumeReceipt(input).ok).toBe(false);
      expect(contracts.parseNativeRemovalReceipt(input).ok).toBe(false);
    }
  });
});

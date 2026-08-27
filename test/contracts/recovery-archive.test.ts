import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const transactionId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";
const archive = Object.freeze({
  archivedAt: "2026-08-21T04:00:00.000Z",
  revokePostSelectionReceiptDigest: d("a"),
  schemaVersion: "recovery-authorization-archive/v1",
  transactionId,
});
const valuePosition = Object.freeze({ mode: "VALUE", parts: Object.freeze({}) });
const tombstonePosition = Object.freeze({ mode: "TOMBSTONE", parts: Object.freeze({}) });

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery authorization archive", () => {
  test("pins the exact closed four-member archive and canonical bytes", () => {
    expect(contracts.recoveryAuthorizationArchiveSchemaFields).toEqual([
      "archivedAt",
      "revokePostSelectionReceiptDigest",
      "schemaVersion",
      "transactionId",
    ]);
    expect(contracts.canonicalJson(archive)).toBe(
      '{"archivedAt":"2026-08-21T04:00:00.000Z","revokePostSelectionReceiptDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schemaVersion":"recovery-authorization-archive/v1","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc"}\n',
    );
    expect(contracts.parseRecoveryAuthorizationArchive(archive).ok).toBe(true);
    expect(contracts.parseContract(archive.schemaVersion, archive).ok).toBe(true);
  });

  test("closes every member and rejects every deleted copied proof field", () => {
    for (const field of Object.keys(archive)) {
      expect(
        contracts.parseRecoveryAuthorizationArchive(without(archive, field)).ok,
        `${field}:missing`,
      ).toBe(false);
      expect(
        contracts.parseRecoveryAuthorizationArchive({ ...archive, [field]: null }).ok,
        `${field}:null`,
      ).toBe(false);
      expect(
        contracts.parseRecoveryAuthorizationArchive({ ...archive, [field]: 1 }).ok,
        `${field}:number`,
      ).toBe(false);
      expect(
        contracts.parseRecoveryAuthorizationArchive({
          ...without(archive, field),
          [`${field}Renamed`]: archive[field as keyof typeof archive],
        }).ok,
        `${field}:renamed`,
      ).toBe(false);
    }
    for (const deletedProofField of [
      "authorizationCoreDigest",
      "authorizationStatePathInstanceDigest",
      "authorizationStateProposalReceiptDigest",
      "authorizationStateTipDigest",
      "authorizationStateValueDigest",
      "cleanupGateRootDigest",
      "lifecycle",
      "mode",
      "nativeRemovalReceiptDigest",
      "operationId",
      "removalDisposition",
    ])
      expect(
        contracts.parseRecoveryAuthorizationArchive({
          ...archive,
          [deletedProofField]: deletedProofField.endsWith("Digest") ? d("f") : "copied",
        }).ok,
      ).toBe(false);
  });

  test("pins transaction-own path, tagged Draa, and serializer route", () => {
    const archivePath = contracts.recoveryAuthorizationPaths.archive(transactionId);
    expect(archivePath).toBe(
      "installation/recovery-authorizations/018f0f4d-7b2d-7a13-9a2b-123456789abc/archive.json",
    );
    expect(
      contracts.recoveryAuthorizationPaths.archive("018f0f4d-7b2d-7a16-8a2b-123456789abc"),
    ).not.toBe(archivePath);
    expect(() => contracts.recoveryAuthorizationPaths.archive("bad")).toThrow();
    const digest = contracts.computeRecoveryAuthorizationArchiveDigest(archive);
    expect(digest).toBe("b8fdd1ab8714df6489d334a6f0a1828b4c48899353ca6e26e72c6a546b81975d");
    expect(digest).not.toBe(contracts.canonicalDigest(archive));
    expect(contracts.serializeContract(archive.schemaVersion, archive)).toEqual({
      ok: true,
      bytes: contracts.canonicalBytes(archive),
      digest,
    });
  });

  test("pins distinct exact empty VALUE and TOMBSTONE positions", () => {
    expect(contracts.parseRecoveryAuthorizationStateValuePosition(valuePosition).ok).toBe(true);
    expect(contracts.parseRecoveryAuthorizationStateTombstonePosition(tombstonePosition).ok).toBe(
      true,
    );
    expect(contracts.parseRecoveryAuthorizationStateValuePosition(tombstonePosition).ok).toBe(
      false,
    );
    expect(contracts.parseRecoveryAuthorizationStateTombstonePosition(valuePosition).ok).toBe(
      false,
    );
    const valueDigest =
      contracts.computeRecoveryAuthorizationStateValuePositionDigest(valuePosition);
    const tombstoneDigest =
      contracts.computeRecoveryAuthorizationStateTombstonePositionDigest(tombstonePosition);
    expect(valueDigest).toBe("4cf9a17dc945568b410d1d23ffef243971cce087b0d87a7d7a97253eb352ec4c");
    expect(tombstoneDigest).toBe(
      "5052076531f4025a544f1ed7c5af5001253ee2c1d8d15f79fa6bf7de7a086eb4",
    );
    expect(tombstoneDigest).not.toBe(valueDigest);
    expect(
      contracts.computePointerPositionDigest("RECOVERY_AUTHORIZATION_STATE", tombstonePosition),
    ).toBe(tombstoneDigest);

    for (const invalid of [
      { mode: "TOMBSTONE", parts: { archiveDigest: d("a") } },
      { mode: "TOMBSTONE", parts: {}, extra: true },
      { mode: "TOMBSTONE" },
      { mode: "TOMBSTONE", parts: { ordinal: "0", rootDigest: d("a") } },
    ]) {
      expect(contracts.parseRecoveryAuthorizationStateTombstonePosition(invalid).ok).toBe(false);
      expect(() =>
        contracts.computePointerPositionDigest("RECOVERY_AUTHORIZATION_STATE", invalid),
      ).toThrow();
    }
    expect(() =>
      contracts.computePointerPositionDigest("ACTIVATION_CLEANUP_GATE", tombstonePosition),
    ).toThrow();
  });

  test("admits only canonical detached bytes and remains total on hostile input", () => {
    expect(contracts.schemaVersions).toContain(archive.schemaVersion);
    expect(
      contracts.parseCanonicalContractBytes(
        archive.schemaVersion,
        contracts.canonicalBytes(archive),
      ).ok,
    ).toBe(true);
    const reordered = Object.fromEntries(Object.entries(archive).reverse());
    expect(
      contracts.parseCanonicalContractBytes(
        archive.schemaVersion,
        new TextEncoder().encode(`${JSON.stringify(reordered)}\n`),
      ).ok,
    ).toBe(false);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, [], "archive", hostile]) {
      expect(() => contracts.parseRecoveryAuthorizationArchive(input)).not.toThrow();
      expect(() => contracts.parseRecoveryAuthorizationStateTombstonePosition(input)).not.toThrow();
      expect(contracts.parseRecoveryAuthorizationArchive(input).ok).toBe(false);
      expect(contracts.parseRecoveryAuthorizationStateTombstonePosition(input).ok).toBe(false);
    }
  });
});

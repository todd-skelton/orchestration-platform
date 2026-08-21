import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  computeRecoveryAuthorizationCoreDigest,
  parseCanonicalContractBytes,
  parseContract,
  parseRecoveryAuthorizationCore,
  recoveryAuthorizationCoreSchemaFields,
  recoveryAuthorizationPaths,
} from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a13-9a2b-123456789abc";
const cycleId = "018f0f4d-7b2d-7a14-aa2b-123456789abc";

const bootstrapCore = Object.freeze({
  schemaVersion: "recovery-authorization-core/v1",
  mode: "BOOTSTRAP",
  transactionId,
  installationId,
  projectId,
  stateRootDigest: d("0"),
  hostIdentityDigest: d("1"),
  userIdentityDigest: d("2"),
  issuedAt: "2026-08-20T12:00:00.000Z",
  expiresAt: "2026-08-20T12:15:00.000Z",
  capabilityReferenceDigest: d("3"),
  capabilityDigest: d("4"),
  nativeGeneration: "0",
  producerDigest: d("5"),
  candidateDigest: d("6"),
  grantDigest: d("7"),
  installerDigest: d("8"),
  destinationDigest: d("9"),
});

const successorCore = Object.freeze({
  schemaVersion: "recovery-authorization-core/v1",
  mode: "SUCCESSOR",
  transactionId,
  installationId,
  projectId,
  stateRootDigest: d("0"),
  hostIdentityDigest: d("1"),
  userIdentityDigest: d("2"),
  issuedAt: "2026-08-20T12:00:00.000Z",
  expiresAt: "2026-08-20T12:15:00.000Z",
  capabilityReferenceDigest: d("3"),
  capabilityDigest: d("4"),
  nativeGeneration: "7",
  producerDigest: d("5"),
  candidateDigest: d("6"),
  cycleId,
  admissionDigest: d("7"),
  predecessorBrokerGeneration: "41",
  successorBrokerGeneration: "42",
  expectedActiveGeneration: "41",
  predecessorReleaseDigest: d("8"),
  successorReleaseDigest: d("9"),
  predecessorExecutableDigest: d("a"),
  successorExecutableDigest: d("b"),
  predecessorOperationManifestDigest: d("c"),
  successorOperationManifestDigest: d("d"),
  recoveryFenceRootDigest: d("e"),
});

function without(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

describe("recovery-authorization immutable core", () => {
  test("pins the two exact closed branch censuses", () => {
    expect(recoveryAuthorizationCoreSchemaFields.common).toHaveLength(15);
    expect(recoveryAuthorizationCoreSchemaFields.bootstrap).toHaveLength(18);
    expect(recoveryAuthorizationCoreSchemaFields.successor).toHaveLength(27);
    for (const fields of Object.values(recoveryAuthorizationCoreSchemaFields))
      expect(fields).toEqual([...fields].sort());
    expect(JSON.stringify(recoveryAuthorizationCoreSchemaFields)).not.toMatch(
      /recoveryFencePath|candidateOperationManifestDigest|verdict|github|git|credentialStore/,
    );
  });

  test("pins canonical bytes, Dac, dispatch, and the deterministic core path", () => {
    const bootstrapJson =
      '{"candidateDigest":"6666666666666666666666666666666666666666666666666666666666666666","capabilityDigest":"4444444444444444444444444444444444444444444444444444444444444444","capabilityReferenceDigest":"3333333333333333333333333333333333333333333333333333333333333333","destinationDigest":"9999999999999999999999999999999999999999999999999999999999999999","expiresAt":"2026-08-20T12:15:00.000Z","grantDigest":"7777777777777777777777777777777777777777777777777777777777777777","hostIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","installationId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","installerDigest":"8888888888888888888888888888888888888888888888888888888888888888","issuedAt":"2026-08-20T12:00:00.000Z","mode":"BOOTSTRAP","nativeGeneration":"0","producerDigest":"5555555555555555555555555555555555555555555555555555555555555555","projectId":"018f0f4d-7b2d-7a12-8a2b-123456789abc","schemaVersion":"recovery-authorization-core/v1","stateRootDigest":"0000000000000000000000000000000000000000000000000000000000000000","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc","userIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222"}\n';
    const successorJson =
      '{"admissionDigest":"7777777777777777777777777777777777777777777777777777777777777777","candidateDigest":"6666666666666666666666666666666666666666666666666666666666666666","capabilityDigest":"4444444444444444444444444444444444444444444444444444444444444444","capabilityReferenceDigest":"3333333333333333333333333333333333333333333333333333333333333333","cycleId":"018f0f4d-7b2d-7a14-aa2b-123456789abc","expectedActiveGeneration":"41","expiresAt":"2026-08-20T12:15:00.000Z","hostIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","installationId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","issuedAt":"2026-08-20T12:00:00.000Z","mode":"SUCCESSOR","nativeGeneration":"7","predecessorBrokerGeneration":"41","predecessorExecutableDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","predecessorOperationManifestDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","predecessorReleaseDigest":"8888888888888888888888888888888888888888888888888888888888888888","producerDigest":"5555555555555555555555555555555555555555555555555555555555555555","projectId":"018f0f4d-7b2d-7a12-8a2b-123456789abc","recoveryFenceRootDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","schemaVersion":"recovery-authorization-core/v1","stateRootDigest":"0000000000000000000000000000000000000000000000000000000000000000","successorBrokerGeneration":"42","successorExecutableDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","successorOperationManifestDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","successorReleaseDigest":"9999999999999999999999999999999999999999999999999999999999999999","transactionId":"018f0f4d-7b2d-7a13-9a2b-123456789abc","userIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222"}\n';
    expect(canonicalJson(bootstrapCore)).toBe(bootstrapJson);
    expect(canonicalJson(successorCore)).toBe(successorJson);
    expect([
      computeRecoveryAuthorizationCoreDigest(bootstrapCore),
      computeRecoveryAuthorizationCoreDigest(successorCore),
    ]).toEqual([
      "a8de464e22b7194daf49b52f102e6513b19255ff49d965fe68e4ef8940e67879",
      "d92dd5a77ab011dcc73f90bb3ad28d7444ddd4650306063de64d33d9152dc68a",
    ]);
    expect(parseContract("recovery-authorization-core/v1", bootstrapCore).ok).toBe(true);
    expect(parseContract("recovery-authorization-core/v1", successorCore).ok).toBe(true);
    expect(recoveryAuthorizationPaths.core(transactionId)).toBe(
      `installation/recovery-authorizations/${transactionId}/core.json`,
    );
    expect(() => recoveryAuthorizationPaths.core("not-a-uuid")).toThrow("transactionId:invalid");
    expect(
      parseCanonicalContractBytes(
        "recovery-authorization-core/v1",
        new TextEncoder().encode(bootstrapJson),
      ).ok,
    ).toBe(true);
    expect(
      parseCanonicalContractBytes(
        "recovery-authorization-core/v1",
        new TextEncoder().encode(JSON.stringify(bootstrapCore)),
      ),
    ).toEqual({ ok: false, issues: ["encoding:noncanonical"] });
    expect(
      parseCanonicalContractBytes(
        "recovery-authorization-core/v1",
        new TextEncoder().encode(JSON.stringify(successorCore)),
      ),
    ).toEqual({ ok: false, issues: ["encoding:noncanonical"] });
  });

  test("refuses every missing, null, opposite-branch, or unknown member", () => {
    for (const fixture of [bootstrapCore, successorCore] as readonly Readonly<
      Record<string, unknown>
    >[]) {
      for (const field of Object.keys(fixture)) {
        expect(parseRecoveryAuthorizationCore(without(fixture, field)).ok, `missing ${field}`).toBe(
          false,
        );
        expect(
          parseRecoveryAuthorizationCore({
            ...without(fixture, field),
            [`${field}Renamed`]: fixture[field],
          }).ok,
          `renamed ${field}`,
        ).toBe(false);
        expect(
          parseRecoveryAuthorizationCore({ ...fixture, [field]: null }).ok,
          `null ${field}`,
        ).toBe(false);
      }
    }
    for (const field of [
      "admissionDigest",
      "cycleId",
      "expectedActiveGeneration",
      "predecessorBrokerGeneration",
      "predecessorExecutableDigest",
      "predecessorOperationManifestDigest",
      "predecessorReleaseDigest",
      "recoveryFenceRootDigest",
      "successorBrokerGeneration",
      "successorExecutableDigest",
      "successorOperationManifestDigest",
      "successorReleaseDigest",
    ])
      expect(parseRecoveryAuthorizationCore({ ...bootstrapCore, [field]: d("f") }).ok).toBe(false);
    for (const field of ["destinationDigest", "grantDigest", "installerDigest"])
      expect(parseRecoveryAuthorizationCore({ ...successorCore, [field]: d("f") }).ok).toBe(false);
    for (const field of [
      "candidateOperationManifestDigest",
      "candidateVerdict",
      "recoveryFencePath",
      "selectedAuthorityTipDigest",
    ])
      expect(parseRecoveryAuthorizationCore({ ...successorCore, [field]: d("f") }).ok).toBe(false);
  });

  test("enforces strict time, safe-decimal bounds, and successor adjacency", () => {
    expect(
      parseRecoveryAuthorizationCore({ ...bootstrapCore, expiresAt: bootstrapCore.issuedAt }).ok,
    ).toBe(false);
    expect(
      parseRecoveryAuthorizationCore({
        ...bootstrapCore,
        expiresAt: "2026-08-20T11:59:59.999Z",
      }).ok,
    ).toBe(false);
    expect(
      parseRecoveryAuthorizationCore({
        ...bootstrapCore,
        nativeGeneration: "9007199254740991",
      }).ok,
    ).toBe(true);
    for (const nativeGeneration of ["01", "-1", "9007199254740992"])
      expect(parseRecoveryAuthorizationCore({ ...bootstrapCore, nativeGeneration }).ok).toBe(false);
    expect(
      parseRecoveryAuthorizationCore({
        ...successorCore,
        expectedActiveGeneration: "0",
        nativeGeneration: "0",
        predecessorBrokerGeneration: "0",
        successorBrokerGeneration: "1",
      }).ok,
    ).toBe(true);
    expect(
      parseRecoveryAuthorizationCore({
        ...successorCore,
        expectedActiveGeneration: "9007199254740991",
        nativeGeneration: "9007199254740991",
        predecessorBrokerGeneration: "9007199254740990",
        successorBrokerGeneration: "9007199254740991",
      }).ok,
    ).toBe(true);
    for (const field of [
      "expectedActiveGeneration",
      "nativeGeneration",
      "predecessorBrokerGeneration",
      "successorBrokerGeneration",
    ]) {
      expect(parseRecoveryAuthorizationCore({ ...successorCore, [field]: "01" }).ok).toBe(false);
      expect(
        parseRecoveryAuthorizationCore({ ...successorCore, [field]: "9007199254740992" }).ok,
      ).toBe(false);
    }
    expect(
      parseRecoveryAuthorizationCore({ ...successorCore, successorBrokerGeneration: "43" }).ok,
    ).toBe(false);
    expect(
      parseRecoveryAuthorizationCore({
        ...successorCore,
        predecessorBrokerGeneration: "9007199254740991",
        successorBrokerGeneration: "9007199254740991",
      }).ok,
    ).toBe(false);
  });

  test("is total over malformed and hostile reflective inputs", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, [], "core", { ...bootstrapCore, mode: "FUTURE" }, hostile])
      expect(() => parseRecoveryAuthorizationCore(input)).not.toThrow();
    expect(parseRecoveryAuthorizationCore(hostile).ok).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import {
  computePointerMutationUnknownEvidenceDigest,
  computeStateMutationGlobalIdentityDigest,
  parseContract,
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

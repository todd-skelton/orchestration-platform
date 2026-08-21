import { describe, expect, test } from "vitest";
import {
  computeBootstrapDestinationIdentityDigest,
  computeExternalDestinationAbsenceObservationDigest,
  computePhysicalDestinationIdentityDigest,
  computePhysicalLocatorObservationDigest,
  externalSchemaFields,
  externalAuthorityPaths,
  parseCanonicalContractBytes,
  parseContract,
  parseExternalDestinationAbsenceObservation,
  parsePhysicalDestinationIdentity,
  parsePhysicalLocatorObservation,
  validateExternalAbsenceBinding,
  validatePhysicalObservationBinding,
  serializeContract,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const stateRootDigest = d("9");

function leaf(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function physicalIdentity(
  operatingSystem: "DARWIN" | "LINUX" | "WINDOWS" = "WINDOWS",
  canonicalPhysicalLeafBytes = leaf("straße"),
) {
  return {
    ancestorObjectIdentityDigest: d("1"),
    canonicalPhysicalLeafBytes,
    filesystemIdentityDigest: d("2"),
    hostCustodyNamespaceDigest: d("3"),
    leafIdentityKind: "ABSENT_DIRECTORY_ENTRY",
    operatingSystem,
    physicalVolumeIdentityDigest: d("4"),
    schemaVersion: "physical-destination-identity/v1",
  };
}

function locatorObservation(identity = physicalIdentity()) {
  return {
    caseComparisonProfile:
      identity.operatingSystem === "LINUX" ? "CASE_SENSITIVE" : "CASE_INSENSITIVE_LOWERCASE",
    custodyInstanceDigest: d("5"),
    custodyReceiptDigest: d("6"),
    disposition: "ADMITTED",
    helperDigest: d("7"),
    helperVersion: "helper-1.0.0",
    logicalLocatorDigest: d("8"),
    nativeIdentityReadbackDigest: d("a"),
    observedAt: "2026-08-18T12:00:01.000Z",
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(identity),
    resolvedLocatorReadbackDigest: d("b"),
    schemaVersion: "physical-destination-locator-observation-receipt/v1",
    unicodeNormalizationProfile: identity.operatingSystem === "DARWIN" ? "NFD" : "NFC",
    validFrom: "2026-08-18T12:00:00.000Z",
    validUntil: "2026-08-18T12:30:00.000Z",
  };
}

function absenceObservation(
  identity = physicalIdentity(),
  observation = locatorObservation(identity),
) {
  const physicalDestinationIdentityDigest = computePhysicalDestinationIdentityDigest(identity);
  return {
    custodyInstanceDigest: observation.custodyInstanceDigest,
    destinationDigest: computeBootstrapDestinationIdentityDigest(physicalDestinationIdentityDigest),
    helperDigest: observation.helperDigest,
    locatorObservationDigest: computePhysicalLocatorObservationDigest(observation),
    observedAt: "2026-08-18T12:00:02.000Z",
    physicalDestinationIdentityDigest,
    reason: "RUNTIME_AUTHORITY_ABSENT",
    schemaVersion: "external-destination-absence-observation/v1",
    stateRootDigest,
  };
}

function physicalObservationExpectation(
  identity = physicalIdentity(),
  observation = locatorObservation(identity),
) {
  return {
    locatorObservationDigest: computePhysicalLocatorObservationDigest(observation),
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(identity),
  };
}

function absenceExpectation(
  identity = physicalIdentity(),
  observation = locatorObservation(identity),
) {
  const physicalDestinationIdentityDigest = computePhysicalDestinationIdentityDigest(identity);
  return {
    custodyInstanceDigest: observation.custodyInstanceDigest,
    destinationDigest: computeBootstrapDestinationIdentityDigest(physicalDestinationIdentityDigest),
    helperDigest: observation.helperDigest,
    locatorObservationDigest: computePhysicalLocatorObservationDigest(observation),
    physicalDestinationIdentityDigest,
    reason: "RUNTIME_AUTHORITY_ABSENT",
    stateRootDigest,
  };
}

describe("external destination identity and constructed authority paths", () => {
  test("derives Ddest from raw Dphys alone", () => {
    expect(computeBootstrapDestinationIdentityDigest(d("a"))).toBe(
      "41692e007f7bdd90eb112755e3653c4ec785bb0446afe19ba60a9ec69d21aa0b",
    );
    expect(computeBootstrapDestinationIdentityDigest(d("b"))).not.toBe(
      computeBootstrapDestinationIdentityDigest(d("a")),
    );
    expect(() => computeBootstrapDestinationIdentityDigest(d("A"))).toThrow();
  });

  test("constructs destination-owner paths without directory interpretation", () => {
    const destinationDigest = d("1");
    const mutationId = d("2");
    expect(externalAuthorityPaths.physicalIdentity(d("a"))).toBe(
      `state-mutation-destination-identities/${d("a")}/identity.json`,
    );
    expect(externalAuthorityPaths.physicalObservation(d("a"), d("b"))).toBe(
      `state-mutation-destination-identities/${d("a")}/observations/${d("b")}.json`,
    );
    expect(externalAuthorityPaths.destinationOwnerLock(destinationDigest)).toBe(
      `state-mutation-destination-owners/${destinationDigest}/destination-owner.lock`,
    );
    expect(externalAuthorityPaths.destinationOwnerCurrent(destinationDigest)).toBe(
      `state-mutation-destination-owners/${destinationDigest}/current.json`,
    );
    expect(
      externalAuthorityPaths.destinationOwnerProposal(destinationDigest, null, mutationId),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/proposals/genesis/${mutationId}.json`,
    );
    expect(
      externalAuthorityPaths.destinationOwnerConflict(destinationDigest, d("3"), mutationId),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/conflicts/${d("3")}/${mutationId}.json`,
    );
    expect(
      externalAuthorityPaths.destinationSuccessorReviewCore(destinationDigest, d("4"), d("5")),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-cores/${d("4")}/${d("5")}.json`,
    );
    expect(
      externalAuthorityPaths.destinationSuccessorPostSelectionReceipt(destinationDigest, d("6")),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-post-selection-receipts/${d("6")}.json`,
    );
  });

  test("constructs external anchor and E0 paths with UUIDv7 identity", () => {
    expect(externalAuthorityPaths.bootstrapAnchor(installationId)).toBe(
      `state-mutation-authority-anchors/${installationId}/anchor.json`,
    );
    expect(externalAuthorityPaths.bootstrapAnchorUseIntent(installationId, transactionId)).toBe(
      `state-mutation-authority-anchors/${installationId}/use-intents/${transactionId}.json`,
    );
    expect(externalAuthorityPaths.bootstrapAnchorLifecycleArchive(installationId, d("a"))).toBe(
      `state-mutation-authority-anchors/${installationId}/lifecycle-archives/${d("a")}.json`,
    );
    expect(externalAuthorityPaths.bootstrapGenesisCore(transactionId)).toBe(
      `installation/bootstrap/state-mutation-authority-genesis/${transactionId}/core.json`,
    );
    expect(externalAuthorityPaths.bootstrapGenesisPostSelectionReceipt(transactionId)).toBe(
      `installation/bootstrap/state-mutation-authority-genesis/${transactionId}/post-selection-receipt.json`,
    );
    expect(() => externalAuthorityPaths.bootstrapAnchor("not-a-uuid")).toThrow();
  });

  test("parses and hashes the pinned physical identity without helper drift", () => {
    const identity = physicalIdentity();
    expect(parsePhysicalDestinationIdentity(identity).ok).toBe(true);
    expect(parseContract("physical-destination-identity/v1", identity).ok).toBe(true);
    const serialized = serializeContract("physical-destination-identity/v1", identity);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) {
      const { schemaVersion, ...remainingIdentity } = identity;
      expect(
        parseCanonicalContractBytes("physical-destination-identity/v1", serialized.bytes).ok,
      ).toBe(true);
      expect(
        parseCanonicalContractBytes(
          "physical-destination-identity/v1",
          new TextEncoder().encode(JSON.stringify({ schemaVersion, ...remainingIdentity })),
        ).ok,
      ).toBe(false);
    }
    expect(computePhysicalDestinationIdentityDigest(identity)).toBe(
      "b7b1894578683cb2d7dbe5b1a70c81a830821ad457f285fc40b9a8daa4ca9bdd",
    );
    expect(externalSchemaFields.physicalIdentity).toEqual(Object.keys(identity).sort());
    for (const name of Object.keys(identity)) {
      const mutant = { ...identity } as Record<string, unknown>;
      delete mutant[name];
      expect(parsePhysicalDestinationIdentity(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parsePhysicalDestinationIdentity({ ...identity, extra: d("f") }).ok).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("Straße"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("CON"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("LPT².txt"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("file:stream"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf(String.fromCodePoint(0x1fa8a)),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("\u0378"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({
        ...identity,
        canonicalPhysicalLeafBytes: leaf("\ufdd0"),
      }).ok,
    ).toBe(false);
    expect(
      parsePhysicalDestinationIdentity({ ...identity, canonicalPhysicalLeafBytes: "_w" }).ok,
    ).toBe(false);
    expect(parsePhysicalDestinationIdentity(physicalIdentity("LINUX", leaf("Straße"))).ok).toBe(
      true,
    );
    expect(parsePhysicalDestinationIdentity(physicalIdentity("DARWIN", leaf("e\u0301"))).ok).toBe(
      true,
    );
    expect(parsePhysicalDestinationIdentity(physicalIdentity("DARWIN", leaf("é"))).ok).toBe(false);
    expect(parsePhysicalDestinationIdentity(physicalIdentity("WINDOWS", leaf("οσ"))).ok).toBe(true);
    expect(parsePhysicalDestinationIdentity(physicalIdentity("WINDOWS", leaf("ος"))).ok).toBe(true);
  });

  test("closes admitted locator observations and OS-profile binding", () => {
    const identity = physicalIdentity();
    const observation = locatorObservation(identity);
    expect(parsePhysicalLocatorObservation(observation).ok).toBe(true);
    expect(
      parseContract("physical-destination-locator-observation-receipt/v1", observation).ok,
    ).toBe(true);
    expect(computePhysicalLocatorObservationDigest(observation)).toBe(
      "c86180d5e00c5386fb3c7ab274c09f2f387a6c90dc93e415e8e06dd7de59f395",
    );
    expect(externalSchemaFields.locatorObservation).toEqual(Object.keys(observation).sort());
    expect(
      validatePhysicalObservationBinding(
        identity,
        observation,
        "2026-08-18T12:10:00.000Z",
        physicalObservationExpectation(identity, observation),
      ),
    ).toEqual([]);
    expect(
      validatePhysicalObservationBinding(
        identity,
        {
          ...observation,
          caseComparisonProfile: "CASE_SENSITIVE",
        },
        "2026-08-18T12:10:00.000Z",
        physicalObservationExpectation(identity, observation),
      ),
    ).toContain("caseComparisonProfile:os-mismatch");
    expect(
      validatePhysicalObservationBinding(
        identity,
        observation,
        "2026-08-18T12:30:00.000Z",
        physicalObservationExpectation(identity, observation),
      ),
    ).toContain("effectiveAt:after-validity");
    const unknown = {
      ...observation,
      custodyInstanceDigest: null,
      custodyReceiptDigest: null,
      disposition: "UNKNOWN",
      nativeIdentityReadbackDigest: null,
      resolvedLocatorReadbackDigest: null,
    };
    expect(parsePhysicalLocatorObservation(unknown).ok).toBe(true);
    expect(parsePhysicalLocatorObservation({ ...unknown, custodyInstanceDigest: d("5") }).ok).toBe(
      false,
    );
    expect(
      parsePhysicalLocatorObservation({ ...observation, validUntil: observation.observedAt }).ok,
    ).toBe(false);
    for (const name of Object.keys(observation)) {
      const mutant = { ...observation } as Record<string, unknown>;
      delete mutant[name];
      expect(parsePhysicalLocatorObservation(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parsePhysicalLocatorObservation({ ...observation, extra: d("f") }).ok).toBe(false);
  });

  test("binds same-lock absence evidence to physical, locator, helper, custody, reason, and state", () => {
    const identity = physicalIdentity();
    const observation = locatorObservation(identity);
    const absence = absenceObservation(identity, observation);
    expect(parseExternalDestinationAbsenceObservation(absence).ok).toBe(true);
    expect(parseContract("external-destination-absence-observation/v1", absence).ok).toBe(true);
    const absenceDigest = computeExternalDestinationAbsenceObservationDigest(absence);
    expect(absenceDigest).toBe("910afda0d7a52dd173535b1bcf475dc832007e9b63dd0717ee33a3fa8bd6beac");
    expect(externalSchemaFields.absenceObservation).toEqual(Object.keys(absence).sort());
    expect(
      validateExternalAbsenceBinding(
        identity,
        observation,
        absence,
        absenceExpectation(identity, observation),
      ),
    ).toEqual([]);
    for (const [field, value] of [
      ["physicalDestinationIdentityDigest", d("0")],
      ["destinationDigest", d("0")],
      ["locatorObservationDigest", d("0")],
      ["helperDigest", d("0")],
      ["custodyInstanceDigest", d("0")],
      ["stateRootDigest", d("0")],
      ["reason", "DESTINATION_STATE_ROOT_ABSENT"],
    ] as const)
      expect(
        validateExternalAbsenceBinding(
          identity,
          observation,
          { ...absence, [field]: value },
          absenceExpectation(identity, observation),
        ),
        field,
      ).not.toEqual([]);
    expect(externalAuthorityPaths.physicalAbsenceObservation(d("a"), absenceDigest)).toBe(
      `state-mutation-destination-identities/${d("a")}/absence-observations/${absenceDigest}.json`,
    );
    for (const name of Object.keys(absence)) {
      const mutant = { ...absence } as Record<string, unknown>;
      delete mutant[name];
      expect(parseExternalDestinationAbsenceObservation(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parseExternalDestinationAbsenceObservation({ ...absence, extra: d("f") }).ok).toBe(
      false,
    );
    expect(validateExternalAbsenceBinding(identity, observation, absence, null)).not.toEqual([]);
    expect(
      validateExternalAbsenceBinding(identity, observation, absence, {
        extra: d("f"),
        ...absenceExpectation(identity, observation),
      }),
    ).not.toEqual([]);
    const substitutedIdentity = { ...identity, hostCustodyNamespaceDigest: d("c") };
    const substitutedIdentityObservation = locatorObservation(substitutedIdentity);
    expect(
      validateExternalAbsenceBinding(
        substitutedIdentity,
        substitutedIdentityObservation,
        absenceObservation(substitutedIdentity, substitutedIdentityObservation),
        absenceExpectation(identity, observation),
      ),
    ).not.toEqual([]);
    for (const field of ["helperDigest", "custodyInstanceDigest"] as const) {
      const substitutedObservation = { ...observation, [field]: d("e") };
      expect(
        validateExternalAbsenceBinding(
          identity,
          substitutedObservation,
          absenceObservation(identity, substitutedObservation),
          absenceExpectation(identity, observation),
        ),
        `coordinated:${field}`,
      ).not.toEqual([]);
    }
  });

  test("fails closed on hostile external authority records", () => {
    const hostile = new Proxy(physicalIdentity(), {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(() => parsePhysicalDestinationIdentity(hostile)).not.toThrow();
    expect(parsePhysicalDestinationIdentity(hostile).ok).toBe(false);
    const observation = locatorObservation();
    expect(
      parsePhysicalLocatorObservation({
        ...observation,
        custodyInstanceDigest: new Proxy({}, {}),
      }).ok,
    ).toBe(false);
  });

  test("does not expose the deleted retention or sparse-history path families", () => {
    expect(Object.keys(externalAuthorityPaths).join("\n")).not.toMatch(
      /retention|historyLeaf|historyNode|historyRoot|updateProof|appendReceipt/i,
    );
    expect(() => externalAuthorityPaths.destinationOwnerValue(d("z"), d("1"))).toThrow();
  });
});

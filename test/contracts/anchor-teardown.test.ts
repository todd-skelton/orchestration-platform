import { describe, expect, test } from "vitest";
import {
  bootstrapAnchorTeardownSchemaFields,
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorLifecycleArchiveDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTeardownId,
  computeBootstrapAnchorTeardownReceiptDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  computeBootstrapDestinationIdentityDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  computeExternalDestinationAbsenceObservationDigest,
  computeGlobalBootstrapIdentityDigest,
  computePhysicalDestinationIdentityDigest,
  computePhysicalLocatorObservationDigest,
  externalAuthorityPaths,
  parseBootstrapAnchorLifecycleArchive,
  parseBootstrapAnchorTeardownReceipt,
  parseContract,
  validateBootstrapAnchorTeardownBinding,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";

function identity() {
  return {
    ancestorObjectIdentityDigest: d("1"),
    canonicalPhysicalLeafBytes: Buffer.from("destination", "utf8").toString("base64url"),
    filesystemIdentityDigest: d("2"),
    hostCustodyNamespaceDigest: d("3"),
    leafIdentityKind: "ABSENT_DIRECTORY_ENTRY",
    operatingSystem: "WINDOWS",
    physicalVolumeIdentityDigest: d("4"),
    schemaVersion: "physical-destination-identity/v1",
  };
}

function observation(physical = identity()) {
  return {
    caseComparisonProfile: "CASE_INSENSITIVE_LOWERCASE",
    custodyInstanceDigest: d("5"),
    custodyReceiptDigest: d("6"),
    disposition: "ADMITTED",
    helperDigest: d("7"),
    helperVersion: "helper-1.0.0",
    logicalLocatorDigest: d("8"),
    nativeIdentityReadbackDigest: d("9"),
    observedAt: "2026-08-19T12:00:00.000Z",
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(physical),
    resolvedLocatorReadbackDigest: d("a"),
    schemaVersion: "physical-destination-locator-observation-receipt/v1",
    unicodeNormalizationProfile: "NFC",
    validFrom: "2026-08-19T11:59:00.000Z",
    validUntil: "2026-08-19T12:30:00.000Z",
  };
}

function absence(physical = identity(), observed = observation(physical)) {
  const physicalDestinationIdentityDigest = computePhysicalDestinationIdentityDigest(physical);
  return {
    custodyInstanceDigest: observed.custodyInstanceDigest,
    destinationDigest: computeBootstrapDestinationIdentityDigest(physicalDestinationIdentityDigest),
    helperDigest: observed.helperDigest,
    locatorObservationDigest: computePhysicalLocatorObservationDigest(observed),
    observedAt: "2026-08-19T12:01:00.000Z",
    physicalDestinationIdentityDigest,
    reason: "DESTINATION_STATE_ROOT_ABSENT",
    schemaVersion: "external-destination-absence-observation/v1",
    stateRootDigest: d("b"),
  };
}

function absenceExpected(
  physical = identity(),
  observed = observation(physical),
  missing = absence(physical, observed),
) {
  return {
    custodyInstanceDigest: observed.custodyInstanceDigest,
    destinationDigest: missing.destinationDigest,
    helperDigest: observed.helperDigest,
    locatorObservationDigest: computePhysicalLocatorObservationDigest(observed),
    physicalDestinationIdentityDigest: computePhysicalDestinationIdentityDigest(physical),
    reason: "DESTINATION_STATE_ROOT_ABSENT",
    stateRootDigest: missing.stateRootDigest,
  };
}

function anchor(destinationDigest: string) {
  const base = {
    abiDigest: d("c"),
    authorityPathInstanceDigest: d("d"),
    bootstrapGrantDigest: d("e"),
    bootstrapTransactionId: "018f0f4d-7b2d-7a12-8a2b-123456789abc",
    custodyInstanceDigest: d("5"),
    custodyReceiptDigest: d("f"),
    destinationDigest,
    globalBootstrapIdentityDigest: d("0"),
    helperDigest: d("7"),
    helperProfileDigest: d("1"),
    independentReviewReceiptDigest: d("2"),
    installationId,
    lockProfileDigest: d("3"),
    projectId: "018f0f4d-7b2d-7a13-9a2b-123456789abc",
    reviewedInstallerDigest: d("4"),
    schemaVersion: "state-mutation-bootstrap-anchor/v1",
    stateComponentProfileDigest: d("5"),
    stateRootDigest: d("b"),
    successorReviewCoreDigest: null,
  };
  return { ...base, globalBootstrapIdentityDigest: computeGlobalBootstrapIdentityDigest(base) };
}

type Lifecycle = "ACTIVE" | "CONSUMED";

function anchorValue(anchorDigest: string, lifecycle: Lifecycle) {
  const consumed = lifecycle === "CONSUMED";
  return {
    anchorDigest,
    bootstrapGenesisCoreDigest: consumed ? d("1") : null,
    lifecycle,
    lifecycleOrdinal: consumed ? "1" : "0",
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-value/v1",
    selectedAuthorityPathInstanceDigest: consumed ? d("2") : null,
    selectedAuthorityReceiptDigest: consumed ? d("3") : null,
    selectedAuthorityTipDigest: consumed ? d("4") : null,
    selectedAuthorityValueDigest: consumed ? d("5") : null,
    selectionPostReceiptDigest: consumed ? d("6") : null,
    teardownReceiptDigest: null,
  };
}

function anchorSelection(anchorRecord: ReturnType<typeof anchor>, lifecycle: Lifecycle) {
  const value = anchorValue(computeBootstrapAnchorDigest(anchorRecord), lifecycle);
  const base = {
    anchorDigest: value.anchorDigest,
    mutationId: d("0"),
    priorReceiptDigest: lifecycle === "ACTIVE" ? null : d("7"),
    priorTipDigest: lifecycle === "ACTIVE" ? null : d("8"),
    priorValueDigest: lifecycle === "ACTIVE" ? null : d("9"),
    proposedAt: "2026-08-19T12:00:00.000Z",
    schemaVersion: "state-mutation-bootstrap-anchor-cas-proposal/v1",
    source: lifecycle === "ACTIVE" ? "BOOTSTRAP_CREATE" : "E0_SELECTION",
    successorValueDigest: computeBootstrapAnchorValueDigest(value),
    transition: lifecycle === "ACTIVE" ? "ACTIVATE" : "CONSUME",
    transitionEvidenceDigest:
      lifecycle === "ACTIVE"
        ? anchorRecord.bootstrapGrantDigest
        : String(value.selectionPostReceiptDigest),
  };
  const proposal = {
    ...base,
    mutationId: computeBootstrapAnchorMutationId(anchorRecord, base, value),
  };
  const valueDigest = computeBootstrapAnchorValueDigest(value);
  const proposalDigest = computeBootstrapAnchorProposalDigest(proposal);
  const tip = {
    anchorDigest: value.anchorDigest,
    proposalReceiptDigest: proposalDigest,
    schemaVersion: "state-mutation-bootstrap-anchor-current-tip/v1",
    valueDigest,
  };
  return {
    proposal,
    proposalDigest,
    tip,
    tipDigest: computeBootstrapAnchorTipDigest(tip),
    value,
    valueDigest,
  };
}

function ownerSelection(destinationDigest: string, anchorDigest: string, lifecycle: Lifecycle) {
  const consumed = lifecycle === "CONSUMED";
  const value = {
    anchorDigest,
    anchorReceiptDigest: consumed ? d("a") : null,
    anchorTipDigest: consumed ? d("b") : null,
    anchorValueDigest: consumed ? d("c") : null,
    destinationDigest,
    installationId,
    lifecycle,
    ownerOrdinal: consumed ? "1" : "0",
    schemaVersion: "state-mutation-destination-owner-value/v1",
    successorReviewCoreDigest: null,
    teardownArchiveDigest: null,
  };
  const base = {
    destinationDigest,
    mutationId: d("0"),
    observationDigest: d("d"),
    positionDigest: computeDestinationOwnerPositionDigest(destinationDigest),
    priorReceiptDigest: consumed ? d("e") : null,
    priorTipDigest: consumed ? d("f") : null,
    priorValueDigest: consumed ? d("1") : null,
    proposedAt: "2026-08-19T12:00:00.000Z",
    schemaVersion: "state-mutation-destination-owner-cas-proposal/v1",
    source: consumed ? "ANCHOR_CONSUMED" : "BOOTSTRAP_GENESIS",
    successorValueDigest: computeDestinationOwnerValueDigest(value),
    transition: consumed ? "CONSUME" : "ACTIVATE_GENESIS",
    transitionEvidenceDigest: consumed ? String(value.anchorTipDigest) : d("2"),
  };
  const proposal = { ...base, mutationId: computeDestinationOwnerMutationId(base, value) };
  const valueDigest = computeDestinationOwnerValueDigest(value);
  const proposalDigest = computeDestinationOwnerProposalDigest(proposal);
  const tip = {
    destinationDigest,
    proposalReceiptDigest: proposalDigest,
    schemaVersion: "state-mutation-destination-owner-current-tip/v1",
    valueDigest,
  };
  return {
    proposal,
    proposalDigest,
    tip,
    tipDigest: computeDestinationOwnerTipDigest(tip),
    value,
    valueDigest,
  };
}

function fixture(lifecycle: Lifecycle = "ACTIVE") {
  const physical = identity();
  const observed = observation(physical);
  const missing = absence(physical, observed);
  const anchorRecord = anchor(missing.destinationDigest);
  const anchorDigest = computeBootstrapAnchorDigest(anchorRecord);
  const priorAnchor = anchorSelection(anchorRecord, lifecycle);
  const selectedOwner = ownerSelection(missing.destinationDigest, anchorDigest, lifecycle);
  const destinationAbsenceDigest = computeExternalDestinationAbsenceObservationDigest(missing);
  const archive = {
    anchorDigest,
    archivedAt: "2026-08-19T12:02:00.000Z",
    archivedReceiptDigest: priorAnchor.proposalDigest,
    archivedTipDigest: priorAnchor.tipDigest,
    archivedValueDigest: priorAnchor.valueDigest,
    destinationAbsenceDigest,
    lifecycle,
    schemaVersion: "state-mutation-bootstrap-anchor-lifecycle-archive/v1",
  };
  const receipt = {
    anchorDigest,
    destinationDigest: missing.destinationDigest,
    externalArchiveDigest: computeBootstrapAnchorLifecycleArchiveDigest(archive),
    priorAnchorReceiptDigest: priorAnchor.proposalDigest,
    priorAnchorTipDigest: priorAnchor.tipDigest,
    priorAnchorValueDigest: priorAnchor.valueDigest,
    processCustodyProofDigest: d("3"),
    retirementTransition: lifecycle === "ACTIVE" ? "RETIRE_UNUSED" : "RETIRE_CONSUMED",
    schemaVersion: "state-mutation-bootstrap-anchor-teardown-receipt/v1",
    selectedOwnerReceiptDigest: selectedOwner.proposalDigest,
    selectedOwnerTipDigest: selectedOwner.tipDigest,
    selectedOwnerValueDigest: selectedOwner.valueDigest,
    teardownEvidenceDigest: destinationAbsenceDigest,
  };
  const expected = {
    anchorDigest,
    destinationAbsenceDigest,
    destinationDigest: missing.destinationDigest,
    priorAnchorReceiptDigest: priorAnchor.proposalDigest,
    priorAnchorTipDigest: priorAnchor.tipDigest,
    priorAnchorValueDigest: priorAnchor.valueDigest,
    processCustodyProofDigest: d("3"),
    retirementTransition: receipt.retirementTransition,
    selectedOwnerReceiptDigest: selectedOwner.proposalDigest,
    selectedOwnerTipDigest: selectedOwner.tipDigest,
    selectedOwnerValueDigest: selectedOwner.valueDigest,
  };
  return {
    anchorRecord,
    archive,
    expected,
    missing,
    observed,
    physical,
    priorAnchor,
    receipt,
    selectedOwner,
  };
}

function validate(f: ReturnType<typeof fixture>) {
  return validateBootstrapAnchorTeardownBinding(
    f.anchorRecord,
    f.priorAnchor.tip,
    f.priorAnchor.value,
    f.priorAnchor.proposal,
    f.selectedOwner.tip,
    f.selectedOwner.value,
    f.selectedOwner.proposal,
    f.physical,
    f.observed,
    f.missing,
    f.archive,
    f.receipt,
    absenceExpected(f.physical, f.observed, f.missing),
    f.expected,
  );
}

describe("bootstrap anchor lifecycle archive and teardown receipt", () => {
  test("closes, hashes, and constructs both retirement artifacts", () => {
    const f = fixture();
    expect(parseBootstrapAnchorLifecycleArchive(f.archive).ok).toBe(true);
    expect(parseBootstrapAnchorTeardownReceipt(f.receipt).ok).toBe(true);
    expect(
      parseContract("state-mutation-bootstrap-anchor-lifecycle-archive/v1", f.archive).ok,
    ).toBe(true);
    expect(parseContract("state-mutation-bootstrap-anchor-teardown-receipt/v1", f.receipt).ok).toBe(
      true,
    );
    expect(bootstrapAnchorTeardownSchemaFields.lifecycleArchive).toEqual(
      Object.keys(f.archive).sort(),
    );
    expect(bootstrapAnchorTeardownSchemaFields.teardownReceipt).toEqual(
      Object.keys(f.receipt).sort(),
    );
    const teardownId = computeBootstrapAnchorTeardownId(f.receipt);
    expect({
      archive: computeBootstrapAnchorLifecycleArchiveDigest(f.archive),
      receipt: computeBootstrapAnchorTeardownReceiptDigest(f.receipt),
      teardownId,
    }).toEqual({
      archive: "83bf6a1100b09608cd6d72a054a0a600574857010d1a9a23107e5e637aa14c8f",
      receipt: "3161695b7dc1a605017e7abe37b2a5b3513803eac8c046de2f5d0d22f1b5c8a0",
      teardownId: "c0d15b0bfa397e5aab69c0c5448191a544e008d62b6db2c109bc0253ed1dd9f8",
    });
    expect(teardownId).toMatch(/^[0-9a-f]{64}$/);
    expect(externalAuthorityPaths.bootstrapAnchorTeardownReceipt(installationId, teardownId)).toBe(
      `state-mutation-authority-anchors/${installationId}/teardown-receipts/${teardownId}.json`,
    );
    expect(
      externalAuthorityPaths.bootstrapAnchorLifecycleArchive(
        installationId,
        f.priorAnchor.tipDigest,
      ),
    ).toBe(
      `state-mutation-authority-anchors/${installationId}/lifecycle-archives/${f.priorAnchor.tipDigest}.json`,
    );
    expect(computeBootstrapAnchorTeardownReceiptDigest(f.receipt)).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(["ACTIVE", "CONSUMED"] as const)(
    "accepts the %s archive and retirement branch",
    (lifecycle) => expect(validate(fixture(lifecycle))).toEqual([]),
  );

  test("refuses independent trusted-context and branch substitutions", () => {
    const f = fixture();
    expect(validate({ ...f, expected: { ...f.expected, priorAnchorTipDigest: d("4") } })).toContain(
      "expected:priorAnchorTipDigest:mismatch",
    );
    expect(
      validate({
        ...f,
        archive: { ...f.archive, lifecycle: "CONSUMED" },
      }),
    ).toContain("archive.lifecycle:mismatch");
    expect(
      validate({
        ...f,
        receipt: { ...f.receipt, processCustodyProofDigest: d("4") },
      }),
    ).toContain("receipt.processCustodyProofDigest:mismatch");
  });

  test("refuses stale archive, coordinated selected-triple, and absence substitution", () => {
    const f = fixture();
    const substitutedArchive = { ...f.archive, archivedAt: "2026-08-19T12:03:00.000Z" };
    expect(validate({ ...f, archive: substitutedArchive })).toContain(
      "receipt.externalArchiveDigest:mismatch",
    );

    const substitutedOwnerValue = { ...f.selectedOwner.value, ownerOrdinal: "2" };
    const substitutedOwnerValueDigest = computeDestinationOwnerValueDigest(substitutedOwnerValue);
    const substitutedOwnerProposalBase = {
      ...f.selectedOwner.proposal,
      mutationId: d("0"),
      successorValueDigest: substitutedOwnerValueDigest,
    };
    const substitutedOwnerProposal = {
      ...substitutedOwnerProposalBase,
      mutationId: computeDestinationOwnerMutationId(
        substitutedOwnerProposalBase,
        substitutedOwnerValue,
      ),
    };
    const substitutedOwnerProposalDigest =
      computeDestinationOwnerProposalDigest(substitutedOwnerProposal);
    const substitutedOwnerTip = {
      ...f.selectedOwner.tip,
      proposalReceiptDigest: substitutedOwnerProposalDigest,
      valueDigest: substitutedOwnerValueDigest,
    };
    const substitutedOwnerTipDigest = computeDestinationOwnerTipDigest(substitutedOwnerTip);
    const receipt = {
      ...f.receipt,
      selectedOwnerReceiptDigest: substitutedOwnerProposalDigest,
      selectedOwnerTipDigest: substitutedOwnerTipDigest,
      selectedOwnerValueDigest: substitutedOwnerValueDigest,
    };
    expect(
      validate({
        ...f,
        receipt,
        selectedOwner: {
          proposal: substitutedOwnerProposal,
          proposalDigest: substitutedOwnerProposalDigest,
          tip: substitutedOwnerTip,
          tipDigest: substitutedOwnerTipDigest,
          value: substitutedOwnerValue,
          valueDigest: substitutedOwnerValueDigest,
        },
      }),
    ).toContain("expected:selectedOwnerTipDigest:mismatch");

    const missing = { ...f.missing, observedAt: "2026-08-19T12:01:30.000Z" };
    const destinationAbsenceDigest = computeExternalDestinationAbsenceObservationDigest(missing);
    const archive = { ...f.archive, destinationAbsenceDigest };
    const receiptWithAbsence = {
      ...f.receipt,
      externalArchiveDigest: computeBootstrapAnchorLifecycleArchiveDigest(archive),
      teardownEvidenceDigest: destinationAbsenceDigest,
    };
    expect(validate({ ...f, archive, missing, receipt: receiptWithAbsence })).toContain(
      "expected:destinationAbsenceDigest:mismatch",
    );
  });

  test("fails closed for malformed and future records", () => {
    const f = fixture();
    expect(parseBootstrapAnchorLifecycleArchive({ ...f.archive, extra: true }).ok).toBe(false);
    expect(
      parseBootstrapAnchorTeardownReceipt({
        ...f.receipt,
        schemaVersion: "state-mutation-bootstrap-anchor-teardown-receipt/v2",
      }).ok,
    ).toBe(false);
    expect(() => computeBootstrapAnchorTeardownId({ ...f.receipt, anchorDigest: "bad" })).toThrow();
    expect(() =>
      validateBootstrapAnchorTeardownBinding(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
    ).not.toThrow();
  });
});

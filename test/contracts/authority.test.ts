import { describe, expect, test } from "vitest";
import {
  authorityHistoryRecordPath,
  canonicalBytes,
  computeAuthorityHistoryBindingDigest,
  computeAuthorityHistoryRecordDigest,
  computeGenesisBootstrapInputDigest,
  computeGenesisSelectionEvidenceDigest,
  computeReviewedAuthorityOperationDigest,
  computeRotationInputDigest,
  computeSuccessorAuthorityCoreDigest,
  parseAuthorityHistoryRecord,
  parseAuthorityHistoryBinding,
  parseCanonicalContractBytes,
  parseContract,
  parseRotationInput,
  simplifiedAuthoritySchemaFields,
  validateAuthorityHistoryChain,
  validateAuthorityHistoryWalk,
} from "../../packages/contracts/src/index.js";

const d = (digit: string) => digit.repeat(64);
const bootstrapTransactionId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const promotionTransactionId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const installationId = "018f0f4d-7b2d-7a11-aa2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a11-ba2b-123456789abc";

const bootstrapOperation = Object.freeze({
  bootstrapGrantDigest: d("1"),
  bootstrapTransactionId,
  independentReviewReceiptDigest: d("2"),
  installedBytesDigest: d("3"),
  operationKind: "BOOTSTRAP_INSTALL",
  releaseManifestDigest: d("4"),
  releaseSubjectDigest: d("5"),
  reviewedInstallerDigest: d("6"),
  schemaVersion: "reviewed-authority-operation/v1",
});
const bootstrapOperationDigest = computeReviewedAuthorityOperationDigest(bootstrapOperation);
const successorCore0 = Object.freeze({
  abiDigest: d("7"),
  admittedCustodyObservationDigest: d("8"),
  authorityPathInstanceDigest: d("9"),
  custodyInstanceDigest: d("a"),
  globalIdentityDigest: d("b"),
  independentReviewReceiptDigest: bootstrapOperation.independentReviewReceiptDigest,
  lockProfileDigest: d("c"),
  operationKind: "BOOTSTRAP_INSTALL",
  reviewedInstalledBytesDigest: bootstrapOperation.installedBytesDigest,
  reviewedOperationDigest: bootstrapOperationDigest,
  reviewedReleaseManifestDigest: bootstrapOperation.releaseManifestDigest,
  reviewedReleaseSubjectDigest: bootstrapOperation.releaseSubjectDigest,
  schemaVersion: "state-mutation-successor-authority-core/v1",
  stateComponentProfileDigest: d("d"),
  successorAuthorityOrdinal: "0",
  successorHelperDigest: d("e"),
  successorHelperProfileDigest: d("f"),
});
const successorCoreDigest0 = computeSuccessorAuthorityCoreDigest(
  successorCore0,
  bootstrapOperation,
);
const genesisInput = Object.freeze({
  bootstrapAnchorActiveReceiptDigest: d("1"),
  bootstrapAnchorActiveTipDigest: d("2"),
  bootstrapAnchorActiveValueDigest: d("3"),
  bootstrapAnchorDigest: d("4"),
  bootstrapGrantDigest: bootstrapOperation.bootstrapGrantDigest,
  bootstrapTransactionId,
  destinationDigest: d("5"),
  destinationOwnerActiveReceiptDigest: d("6"),
  destinationOwnerActiveTipDigest: d("7"),
  destinationOwnerActiveValueDigest: d("8"),
  globalBootstrapIdentityDigest: d("9"),
  schemaVersion: "authority-history-genesis-bootstrap-input/v1",
  successorCoreDigest: successorCoreDigest0,
  useIntentDigest: d("a"),
});
const genesisInputDigest = computeGenesisBootstrapInputDigest(genesisInput);
const genesisSelectionEvidence = Object.freeze({
  ...Object.fromEntries(
    simplifiedAuthoritySchemaFields.genesisSelectionEvidence
      .filter((field) => field.endsWith("Digest"))
      .map((field) => [field, d("1")]),
  ),
  bootstrapTransactionId,
  schemaVersion: "authority-history-genesis-selection-evidence/v1",
});
const genesisSelectionEvidenceDigest =
  computeGenesisSelectionEvidenceDigest(genesisSelectionEvidence);
const genesisRecord = Object.freeze({
  genesisBootstrapInputDigest: genesisInputDigest,
  globalIdentityDigest: successorCore0.globalIdentityDigest,
  ordinal: "0",
  predecessorKind: "GENESIS_LITERAL",
  recordKind: "GENESIS",
  schemaVersion: "authority-history-record/v1",
  successorCoreDigest: successorCoreDigest0,
});
const genesisRecordDigest = computeAuthorityHistoryRecordDigest(genesisRecord);

const promotionOperation = Object.freeze({
  independentReviewReceiptDigest: d("1"),
  installedBytesDigest: d("2"),
  operationKind: "STABLE_PROMOTION",
  predecessorActiveReleasePathInstanceDigest: d("3"),
  predecessorActiveReleaseReceiptDigest: d("4"),
  predecessorActiveReleaseTipDigest: d("5"),
  predecessorActiveReleaseValueDigest: d("6"),
  promotionTransactionId,
  releaseManifestDigest: d("7"),
  releaseSubjectDigest: d("8"),
  schemaVersion: "reviewed-authority-operation/v1",
  successorActiveReleasePathInstanceDigest: d("9"),
  successorActiveReleaseReceiptDigest: d("a"),
  successorActiveReleaseTipDigest: d("b"),
  successorActiveReleaseValueDigest: d("c"),
});
const promotionOperationDigest = computeReviewedAuthorityOperationDigest(promotionOperation);
const successorCore1 = Object.freeze({
  ...successorCore0,
  independentReviewReceiptDigest: promotionOperation.independentReviewReceiptDigest,
  operationKind: "STABLE_PROMOTION",
  reviewedInstalledBytesDigest: promotionOperation.installedBytesDigest,
  reviewedOperationDigest: promotionOperationDigest,
  reviewedReleaseManifestDigest: promotionOperation.releaseManifestDigest,
  reviewedReleaseSubjectDigest: promotionOperation.releaseSubjectDigest,
  successorAuthorityOrdinal: "1",
});
const successorCoreDigest1 = computeSuccessorAuthorityCoreDigest(
  successorCore1,
  promotionOperation,
);
const rotationInput = Object.freeze({
  globalIdentityDigest: successorCore0.globalIdentityDigest,
  priorHeadOrdinal: "0",
  priorRecordDigest: genesisRecordDigest,
  retiringAuthorityPathInstanceDigest: d("1"),
  retiringAuthorityReceiptDigest: d("2"),
  retiringAuthorityTipDigest: d("3"),
  retiringAuthorityValueDigest: d("4"),
  reviewedOperationDigest: promotionOperationDigest,
  rotationTransactionId: promotionTransactionId,
  schemaVersion: "state-mutation-authority-rotation-id/v1",
  successorAuthorityOrdinal: "1",
  successorCoreDigest: successorCoreDigest1,
});
const rotationInputDigest = computeRotationInputDigest(rotationInput);
const rotationRecord = Object.freeze({
  globalIdentityDigest: successorCore0.globalIdentityDigest,
  ordinal: "1",
  predecessorKind: "RECORD",
  priorHeadOrdinal: "0",
  priorRecordDigest: genesisRecordDigest,
  recordKind: "ROTATION",
  retiringAuthorityPathInstanceDigest: rotationInput.retiringAuthorityPathInstanceDigest,
  retiringAuthorityReceiptDigest: rotationInput.retiringAuthorityReceiptDigest,
  retiringAuthorityTipDigest: rotationInput.retiringAuthorityTipDigest,
  retiringAuthorityValueDigest: rotationInput.retiringAuthorityValueDigest,
  rotationInputDigest,
  schemaVersion: "authority-history-record/v1",
  successorCoreDigest: successorCoreDigest1,
});
const rotationRecordDigest = computeAuthorityHistoryRecordDigest(rotationRecord);

function authorityValue(
  ordinal: string,
  headRecordDigest: string,
  prior: null | { tip: string; value: string; receipt: string },
) {
  return {
    activeReleasePathInstanceDigest: d("1"),
    activeReleaseReceiptDigest: d("2"),
    activeReleaseTipDigest: d("3"),
    activeReleaseValueDigest: d("4"),
    admittedCustodyObservationDigest: d("5"),
    authorityOrdinal: ordinal,
    custodyInstanceDigest: d("6"),
    globalIdentityDigest: successorCore0.globalIdentityDigest,
    headOrdinal: ordinal,
    headRecordDigest,
    helperAbiDigest: d("7"),
    helperDigest: d("8"),
    helperProfileDigest: d("9"),
    installationId,
    lockProfileDigest: d("a"),
    priorAuthorityReceiptDigest: prior?.receipt ?? null,
    priorAuthorityTipDigest: prior?.tip ?? null,
    priorAuthorityValueDigest: prior?.value ?? null,
    projectId,
    schemaVersion: "state-mutation-authority-value/v1",
    stateComponentProfileDigest: d("b"),
    stateRootDigest: d("c"),
  };
}

describe("simplified authority ledger", () => {
  test("pins exact branch field censuses and the record/digest version split", () => {
    expect(simplifiedAuthoritySchemaFields.authorityHistoryBinding).toHaveLength(6);
    expect(simplifiedAuthoritySchemaFields.reviewedAuthorityOperationBootstrap).toHaveLength(9);
    expect(simplifiedAuthoritySchemaFields.reviewedAuthorityOperationPromotion).toHaveLength(15);
    expect(simplifiedAuthoritySchemaFields.successorAuthorityCore).toHaveLength(17);
    expect(simplifiedAuthoritySchemaFields.genesisBootstrapInput).toHaveLength(14);
    expect(simplifiedAuthoritySchemaFields.genesisSelectionEvidence).toHaveLength(38);
    expect(simplifiedAuthoritySchemaFields.rotationInput).toHaveLength(12);
    expect(simplifiedAuthoritySchemaFields.historyGenesis).toHaveLength(7);
    expect(simplifiedAuthoritySchemaFields.historyRotation).toHaveLength(13);
    expect(simplifiedAuthoritySchemaFields.selectedAuthorityValue).toHaveLength(22);
    expect(parseContract("authority-history-record/v1", genesisRecord).ok).toBe(true);
    expect(parseContract("authority-history/v1", genesisRecord)).toEqual({
      ok: false,
      issues: ["schemaVersion:unsupported"],
    });
  });

  test("composes the complete linear history with exact genesis selection", () => {
    const boundGenesisSelection = {
      ...genesisSelectionEvidence,
      genesisBootstrapInputDigest: genesisRecord.genesisBootstrapInputDigest,
      historyRecordDigest: genesisRecordDigest,
      successorCoreDigest: genesisRecord.successorCoreDigest,
    };
    const binding = {
      genesisSelectionEvidence: boundGenesisSelection,
      globalIdentityDigest: genesisRecord.globalIdentityDigest,
      headOrdinal: "1",
      headRecordDigest: rotationRecordDigest,
      records: [genesisRecord, rotationRecord],
      schemaVersion: "authority-history-binding/v1",
    };
    expect(parseAuthorityHistoryBinding(binding).ok).toBe(true);
    expect(parseContract("authority-history-binding/v1", binding).ok).toBe(true);
    expect(computeAuthorityHistoryBindingDigest(binding)).toBe(
      "63b558fb41c4cf112254590e5db6ab1d2583f19261810f11d402540fef7f61a7",
    );
    expect(
      parseAuthorityHistoryBinding({ ...binding, records: [rotationRecord, genesisRecord] }).ok,
    ).toBe(false);
    expect(parseAuthorityHistoryBinding({ ...binding, records: [genesisRecord] }).ok).toBe(false);
    expect(
      parseAuthorityHistoryBinding({
        ...binding,
        genesisSelectionEvidence: {
          ...boundGenesisSelection,
          historyRecordDigest: d("0"),
        },
      }).ok,
    ).toBe(false);
    expect(parseAuthorityHistoryBinding({ ...binding, proof: d("0") }).ok).toBe(false);
  });

  test("derives branch-separated reviewed operation, successor, genesis, rotation, and history digests", () => {
    const digests = {
      bootstrapOperationDigest,
      promotionOperationDigest,
      successorCoreDigest0,
      successorCoreDigest1,
      genesisInputDigest,
      genesisSelectionEvidenceDigest,
      genesisRecordDigest,
      rotationInputDigest,
      rotationRecordDigest,
    };
    expect(digests).toMatchInlineSnapshot(`
      {
        "bootstrapOperationDigest": "d592c83cc72e7bc53b70e65f672007ad6345c331119299aada4b409d3219fb67",
        "genesisInputDigest": "951e456e1a9f71ee4024b6162902b3ac15c1463d67b6e792c934bf1f1b837ab5",
        "genesisRecordDigest": "195d435d6a3a30c3a8b227d403d8ab2c95eabaeaaa9cd8b10a160e5a07c7e562",
        "genesisSelectionEvidenceDigest": "723c09cc9838f6be46f3ae8250161ab901c7dfa4d8b1b0b149f3f8c77e434657",
        "promotionOperationDigest": "7617b4f10f96bd6794081d8ede36214d9cd6afe1cc872a403a9ca7cbe5a155fe",
        "rotationInputDigest": "24a397c6e36d3669d5b06928a77f3bf9a24309fada5653e177df9883794940f2",
        "rotationRecordDigest": "5913669ddae7431978c28c4928dc81603fe0f59ac92bd66ffb8b110654f18c0d",
        "successorCoreDigest0": "a114bfab53ff1acd0ce42ab3e32b16e3926fd63fc21256bad95edba569e34afb",
        "successorCoreDigest1": "7b923cf6f73aefc450a68dd494bc0da6057215eb59f9e0b8887df23c6efb89c0",
      }
    `);
    expect(bootstrapOperationDigest).not.toBe(promotionOperationDigest);
    expect(genesisRecordDigest).not.toBe(rotationRecordDigest);
    expect(() =>
      computeSuccessorAuthorityCoreDigest(
        { ...successorCore0, reviewedReleaseManifestDigest: d("0") },
        bootstrapOperation,
      ),
    ).toThrow("successorCore:reviewed-operation-mismatch");
  });

  test("refuses every omitted history field, extras, nulls, wrong record literal, and noncanonical bytes", () => {
    for (const field of simplifiedAuthoritySchemaFields.historyRotation) {
      const mutant = { ...rotationRecord } as Record<string, unknown>;
      delete mutant[field];
      expect(parseAuthorityHistoryRecord(mutant).ok, field).toBe(false);
    }
    expect(parseAuthorityHistoryRecord({ ...rotationRecord, extra: true }).ok).toBe(false);
    expect(parseAuthorityHistoryRecord({ ...rotationRecord, priorRecordDigest: null }).ok).toBe(
      false,
    );
    expect(
      parseAuthorityHistoryRecord({ ...rotationRecord, schemaVersion: "authority-history/v1" }).ok,
    ).toBe(false);
    const reordered = `${JSON.stringify(Object.fromEntries(Object.entries(rotationRecord).reverse()))}\n`;
    expect(
      parseCanonicalContractBytes(
        "authority-history-record/v1",
        new TextEncoder().encode(reordered),
      ).ok,
    ).toBe(false);
    expect(
      parseCanonicalContractBytes("authority-history-record/v1", canonicalBytes(rotationRecord)).ok,
    ).toBe(true);
  });

  test("bounds ordinals before conversion and constructs only canonical ordinal paths", () => {
    expect(authorityHistoryRecordPath("0")).toBe(
      "installation/state-mutation-authority-history/records/0.json",
    );
    expect(authorityHistoryRecordPath("9007199254740991")).toBe(
      "installation/state-mutation-authority-history/records/9007199254740991.json",
    );
    for (const value of ["00", "01", "9007199254740992", 1, -1])
      expect(() => authorityHistoryRecordPath(value)).toThrow("ordinal:invalid");
    expect(
      parseRotationInput({
        ...rotationInput,
        priorHeadOrdinal: "9007199254740991",
        successorAuthorityOrdinal: "9007199254740991",
      }).ok,
    ).toBe(false);
  });
});

describe("linear authority history", () => {
  test("walks the complete constructed chain against the selected head", () => {
    expect(
      validateAuthorityHistoryChain(
        [genesisRecord],
        authorityValue("0", genesisRecordDigest, null),
      ),
    ).toEqual([]);
    expect(
      validateAuthorityHistoryChain(
        [genesisRecord, rotationRecord],
        authorityValue("1", rotationRecordDigest, {
          tip: d("d"),
          value: d("e"),
          receipt: d("f"),
        }),
      ),
    ).toEqual([]);
  });

  test("refuses fork, gap, reorder, truncation, head substitution, and excluded successor fields", () => {
    const selected = authorityValue("1", rotationRecordDigest, {
      tip: d("d"),
      value: d("e"),
      receipt: d("f"),
    });
    expect(
      validateAuthorityHistoryChain(
        [genesisRecord, { ...rotationRecord, priorRecordDigest: d("0") }],
        selected,
      ),
    ).toContain("records:1:priorRecordDigest");
    expect(validateAuthorityHistoryChain([rotationRecord, genesisRecord], selected)).not.toEqual(
      [],
    );
    expect(validateAuthorityHistoryChain([genesisRecord], selected)).toContain(
      "selected:headOrdinal",
    );
    expect(
      validateAuthorityHistoryChain([genesisRecord, rotationRecord], {
        ...selected,
        headRecordDigest: d("0"),
      }),
    ).toContain("selected:headRecordDigest");
    expect(
      parseAuthorityHistoryRecord({ ...rotationRecord, successorAuthorityValueDigest: d("0") }).ok,
    ).toBe(false);
  });

  test("admits only one exact CAS-armed head-plus-one record and requires head-plus-two absence", () => {
    const selected = authorityValue("0", genesisRecordDigest, null);
    const armedRotation = {
      expectedRecordDigest: rotationRecordDigest,
      retiringAuthorityPathInstanceDigest: rotationRecord.retiringAuthorityPathInstanceDigest,
      retiringAuthorityReceiptDigest: rotationRecord.retiringAuthorityReceiptDigest,
      retiringAuthorityTipDigest: rotationRecord.retiringAuthorityTipDigest,
      retiringAuthorityValueDigest: rotationRecord.retiringAuthorityValueDigest,
      rotationInputDigest: rotationRecord.rotationInputDigest,
      successorCoreDigest: rotationRecord.successorCoreDigest,
    };
    const input = {
      armedRotation,
      headPlusOne: rotationRecord,
      headPlusTwoExists: false,
      records: [genesisRecord],
      selectedAuthorityValue: selected,
    };
    expect(validateAuthorityHistoryWalk(input)).toEqual([]);
    expect(validateAuthorityHistoryWalk({ ...input, armedRotation: null })).toContain(
      "headPlusOne:unarmed",
    );
    expect(
      validateAuthorityHistoryWalk({
        ...input,
        armedRotation: { ...armedRotation, rotationInputDigest: d("0") },
      }),
    ).toContain("headPlusOne:rotationInputDigest");
    expect(validateAuthorityHistoryWalk({ ...input, headPlusTwoExists: true })).toContain(
      "headPlusTwo:must-be-absent",
    );
    expect(() => validateAuthorityHistoryWalk(new Proxy(input, {}))).not.toThrow();
    expect(validateAuthorityHistoryWalk(new Proxy(input, {}))).not.toEqual([]);
  });
});

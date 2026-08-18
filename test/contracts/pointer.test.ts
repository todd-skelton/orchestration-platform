import { describe, expect, test } from "vitest";
import {
  classifyProposal,
  computeCurrentTipDigest,
  computePointerInstanceDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  pointerKinds,
  pointerPath,
  pointerRegistry,
  validatePointerDispatch,
  validatePointerGenesisDispatch,
  validatePointerRegistry,
  validatePointerTemplateDispatch,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";
const createdAt = "2026-08-17T12:00:00.000Z";

describe("twelve-kind pointer registry", () => {
  test("is exact, v1-only, collision-free, and contains no coordinator path", () => {
    expect(pointerKinds).toEqual([
      "ACTIVE_RELEASE",
      "ACTIVATION_CLEANUP_GATE",
      "ACTIVATION_RECOVERY_FENCE",
      "ACTIVATION_RECOVERY_LAUNCH",
      "RECOVERY_AUTHORIZATION_STATE",
      "RECOVERY_AUTHORIZATION_ATTACHMENT",
      "RECOVERY_ATTEMPT_LOG",
      "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
      "AUTHORITY_RETENTION",
      "RECOVERY_ATTEMPT_RESERVATION",
      "STATE_MUTATION_AUTHORITY_ROTATION",
      "POINTER_MUTATION_RUN_CURRENT",
    ]);
    expect(pointerRegistry).toHaveLength(12);
    expect(validatePointerRegistry()).toEqual([]);
    expect(JSON.stringify(pointerRegistry)).not.toMatch(
      /node-inventory|materialization|coordinator|\/v[23]"/,
    );
  });
  test("constructs only exact family paths and refuses wrong path, schema, case, encoding, or bindings", () => {
    const transactionId = installationId;
    expect(
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", { transactionId, sourceToken: "recovery-fence" }),
    ).toBe(
      `installation/activation-recovery-launches/${transactionId}/recovery-fence/current.json`,
    );
    expect(() =>
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", { transactionId, sourceToken: "RECOVERY-FENCE" }),
    ).toThrow();
    expect(() =>
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", { transactionId, sourceToken: "recovery%2Dfence" }),
    ).toThrow();
    expect(() =>
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", {
        transactionId,
        sourceToken: "recovery-fence",
        releaseDigest: d("1"),
      }),
    ).toThrow();
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "active-release/v1",
        {},
      ),
    ).toEqual([]);
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/activation-cleanup-gate.json",
        "active-release/v1",
        {},
      ),
    ).toContain("pointerPath:mismatch");
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "activation-cleanup-gate-head/v1",
        {},
      ),
    ).toContain("schemaVersion:wrong-pointer-family");
    expect(
      validatePointerTemplateDispatch("ACTIVE_RELEASE", "ROOT", [`releases/${d("1")}/`], {
        releaseDigest: d("1"),
      }),
    ).toEqual([]);
    expect(
      validatePointerTemplateDispatch("ACTIVE_RELEASE", "ROOT", ["releases/wrong/"], {
        releaseDigest: d("1"),
      }),
    ).toContain("root:path-mismatch");
    expect(validatePointerGenesisDispatch("ACTIVE_RELEASE", "REVIEWED_BOOTSTRAP")).toEqual([]);
  });
});

describe("acyclic pointer graph", () => {
  const value = Object.freeze({ schemaVersion: "active-release/v1", releaseDigest: d("a") });
  const valueDigest = computePointerValueDigest(value);
  const identity = Object.freeze({
    pointerKind: "ACTIVE_RELEASE" as const,
    canonicalPointerPath: "installation/active-release.json",
    installationId,
    projectId,
    stateRootDigest: d("b"),
    transactionId: installationId,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE", parts: {} },
  });
  const pathInstanceDigest = computePointerInstanceDigest(identity);
  const proposal = Object.freeze({
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    intent: "VALUE_PROPOSED",
    pointerKind: "ACTIVE_RELEASE",
    pathInstanceDigest,
    mutationId: d("c"),
    priorTipDigest: null,
    priorValueDigest: null,
    priorReceiptDigest: null,
    successorValueDigest: valueDigest,
    producerAuthorityTipDigest: d("d"),
    producerAuthorityValueDigest: d("e"),
    producerAuthorityReceiptDigest: d("f"),
    createdAt,
  });
  const proposalReceiptDigest = computeProposalReceiptDigest(proposal);
  const tip = Object.freeze({
    schemaVersion: "pointer-current-tip/v1",
    pointerKind: "ACTIVE_RELEASE",
    pathInstanceDigest,
    valueDigest,
    proposalReceiptDigest,
  });

  test("is deterministic and distinguishes a same-mutation byte conflict", () => {
    expect(computePointerValueDigest(structuredClone(value))).toBe(valueDigest);
    expect(computeProposalReceiptDigest(structuredClone(proposal))).toBe(proposalReceiptDigest);
    expect(computeCurrentTipDigest(tip)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeProposalReceiptDigest({ ...proposal, successorValueDigest: d("0") })).not.toBe(
      proposalReceiptDigest,
    );
    expect(proposal).not.toHaveProperty("tipDigest");
    expect(value).not.toHaveProperty("proposalReceiptDigest");
  });
  test("classifies only exact selected evidence and returns UNKNOWN for malformed evidence", () => {
    const selected = {
      proposal,
      selectedTip: tip,
      selectedValue: value,
      selectedProposal: proposal,
      conflictReceipt: null,
      retention: null,
    };
    expect(classifyProposal(selected)).toBe("SELECTED");
    expect(classifyProposal({ ...selected, selectedTip: { ...tip, valueDigest: d("0") } })).toBe(
      "UNKNOWN",
    );
    expect(
      classifyProposal(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).toBe("UNKNOWN");
  });
});

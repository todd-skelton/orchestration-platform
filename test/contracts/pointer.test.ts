import { describe, expect, test } from "vitest";
import {
  classifyProposal,
  computeCurrentTipDigest,
  computePointerInstanceDigest,
  computePointerInstanceDigestFromCanonicalPath,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parseActiveReleaseValue,
  parseContract,
  parsePointerTombstoneValue,
  pointerStoragePaths,
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

describe("eleven-kind pointer registry", () => {
  test("constructs generic value, proposal, and conflict storage from Dp and mutation identity", () => {
    expect(pointerStoragePaths.value(d("1"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/values/${d("2")}.json`,
    );
    expect(pointerStoragePaths.proposal(d("1"), null, d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/proposals/genesis/${d("2")}.json`,
    );
    expect(pointerStoragePaths.conflict(d("1"), d("3"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/conflicts/${d("3")}/${d("2")}.json`,
    );
    expect(() => pointerStoragePaths.value(d("z"), d("2"))).toThrow();
    expect(() => pointerStoragePaths.proposal(d("1"), d("Z"), d("2"))).toThrow();
  });

  test("is exact, v1-only, FULL_REQUIRED, collision-free, and contains no deleted surface", () => {
    expect(pointerKinds).toEqual([
      "ACTIVE_RELEASE",
      "ACTIVATION_CLEANUP_GATE",
      "ACTIVATION_RECOVERY_FENCE",
      "ACTIVATION_RECOVERY_LAUNCH",
      "RECOVERY_AUTHORIZATION_STATE",
      "RECOVERY_AUTHORIZATION_ATTACHMENT",
      "RECOVERY_ATTEMPT_LOG",
      "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
      "RECOVERY_ATTEMPT_RESERVATION",
      "STATE_MUTATION_AUTHORITY_ROTATION",
      "POINTER_MUTATION_RUN_CURRENT",
    ]);
    expect(pointerRegistry).toHaveLength(11);
    expect(pointerRegistry.every((row) => row.recordClass === "FULL_REQUIRED")).toBe(true);
    expect(pointerRegistry.filter((row) => row.tombstonePositionDomain !== null)).toHaveLength(10);
    expect(
      pointerRegistry.find((row) => row.kind === "STATE_MUTATION_AUTHORITY_ROTATION")
        ?.tombstonePositionDomain,
    ).toBeNull();
    expect(validatePointerRegistry()).toEqual([]);
    expect(JSON.stringify(pointerRegistry)).not.toMatch(
      /retention|compaction|degraded-audit|node-inventory|materialization|coordinator|\/v[23]"/,
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

  test("derives pointer identity from every canonical registry path", () => {
    for (const [index, row] of pointerRegistry.entries()) {
      const bindings: Record<string, string> = {};
      if (row.pathTemplate.includes("<transaction>")) bindings.transactionId = installationId;
      if (row.pathTemplate.includes("<source>")) bindings.sourceToken = row.sourceTokens[0]!;
      if (row.pathTemplate.includes("<predecessor-key>")) bindings.predecessorKey = d("1");
      if (row.pathTemplate.includes("<pointer-instance-digest>"))
        bindings.pointerInstanceDigest = d("2");
      if (row.pathTemplate.includes("<target-instance-digest>"))
        bindings.targetInstanceDigest = d("3");
      if (row.pathTemplate.includes("<release-digest>")) bindings.releaseDigest = d("4");
      if (row.pathTemplate.includes("<target-mutation-id>")) bindings.targetMutationId = d("5");
      const canonicalPointerPath = pointerPath(row.kind, bindings);
      const identity = {
        pointerKind: row.kind,
        canonicalPointerPath,
        installationId,
        projectId,
        stateRootDigest: d("b"),
        transactionId: row.transactionPolicy === "REQUIRED" ? installationId : null,
        sourceToken: row.sourceTokens[0]!,
      } as const;
      const fromPosition = computePointerInstanceDigest({
        ...identity,
        positionEvidence: { mode: "VALUE", parts: bindings },
      });
      expect(computePointerInstanceDigestFromCanonicalPath(identity), `${index}:${row.kind}`).toBe(
        fromPosition,
      );
    }
    expect(() =>
      computePointerInstanceDigestFromCanonicalPath({
        pointerKind: "RECOVERY_ATTEMPT_RESERVATION",
        canonicalPointerPath: pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
          predecessorKey: d("1"),
          sourceToken: "recovery-fence",
          transactionId: installationId,
        }).replace(d("1"), "not-a-digest"),
        installationId,
        projectId,
        stateRootDigest: d("b"),
        transactionId: installationId,
        sourceToken: "recovery-fence",
      }),
    ).toThrow();
  });

  test("rejects every registry-path substitution and canonical-path alias", () => {
    const identities = pointerRegistry.map((row) => {
      const bindings: Record<string, string> = {};
      if (row.pathTemplate.includes("<transaction>")) bindings.transactionId = installationId;
      if (row.pathTemplate.includes("<source>")) bindings.sourceToken = row.sourceTokens[0]!;
      if (row.pathTemplate.includes("<predecessor-key>")) bindings.predecessorKey = d("1");
      if (row.pathTemplate.includes("<pointer-instance-digest>"))
        bindings.pointerInstanceDigest = d("2");
      if (row.pathTemplate.includes("<target-instance-digest>"))
        bindings.targetInstanceDigest = d("3");
      if (row.pathTemplate.includes("<release-digest>")) bindings.releaseDigest = d("4");
      if (row.pathTemplate.includes("<target-mutation-id>")) bindings.targetMutationId = d("5");
      return {
        pointerKind: row.kind,
        canonicalPointerPath: pointerPath(row.kind, bindings),
        installationId,
        projectId,
        stateRootDigest: d("b"),
        transactionId: row.transactionPolicy === "REQUIRED" ? installationId : null,
        sourceToken: row.sourceTokens[0]!,
      } as const;
    });

    for (const [index, identity] of identities.entries()) {
      expect(
        () =>
          computePointerInstanceDigestFromCanonicalPath({
            ...identity,
            canonicalPointerPath: identity.canonicalPointerPath.replace(
              "installation/",
              "Installation/",
            ),
          }),
        `${index}:${identity.pointerKind}:fixed-segment`,
      ).toThrow();
      expect(
        () =>
          computePointerInstanceDigestFromCanonicalPath({
            ...identity,
            pointerKind: identities[(index + 1) % identities.length]!.pointerKind,
          }),
        `${index}:${identity.pointerKind}:kind-path`,
      ).toThrow();
    }

    const reservation = identities.find(
      ({ pointerKind }) => pointerKind === "RECOVERY_ATTEMPT_RESERVATION",
    )!;
    const alternateTransactionId = "018f0f4d-7b2d-7a11-aa2b-123456789abc";
    const reservationAliases = [
      reservation.canonicalPointerPath.replace(`/${d("1")}.json`, `/${d("1")}json`),
      reservation.canonicalPointerPath.replace(`/${d("1")}.json`, `/x${d("1")}.json`),
      `${reservation.canonicalPointerPath}.extra`,
      reservation.canonicalPointerPath.replace(`/${d("1")}.json`, "/.json"),
      reservation.canonicalPointerPath.replace("reservations/", "reservations//"),
      reservation.canonicalPointerPath.replace("installation/", "installation/./"),
      reservation.canonicalPointerPath.replaceAll("/", "\\"),
      `C:/${reservation.canonicalPointerPath}`,
      `file://${reservation.canonicalPointerPath}`,
      reservation.canonicalPointerPath.replace("recovery-fence", "recovery%2Dfence"),
      reservation.canonicalPointerPath.replace("recovery-fence", "recovery‐fence"),
      reservation.canonicalPointerPath.replace(d("1"), d("A")),
    ];
    for (const [index, canonicalPointerPath] of reservationAliases.entries())
      expect(
        () =>
          computePointerInstanceDigestFromCanonicalPath({
            ...reservation,
            canonicalPointerPath,
          }),
        `reservation-alias:${index}`,
      ).toThrow();

    expect(() =>
      computePointerInstanceDigestFromCanonicalPath({
        ...reservation,
        transactionId: alternateTransactionId,
      }),
    ).toThrow("transactionId:path-mismatch");
    expect(() =>
      computePointerInstanceDigestFromCanonicalPath({
        ...reservation,
        sourceToken: "cleanup-gate-pre-fence",
      }),
    ).toThrow("sourceToken:path-mismatch");
    expect(() =>
      computePointerInstanceDigestFromCanonicalPath({
        ...reservation,
        pointerKind: "UNREGISTERED" as never,
      }),
    ).toThrow();
    expect(() =>
      computePointerInstanceDigestFromCanonicalPath(
        new Proxy(reservation, {
          get() {
            throw new Error("hostile getter");
          },
        }),
      ),
    ).toThrow("hostile getter");
  });
});

describe("acyclic pointer graph", () => {
  const value = Object.freeze({
    independentReviewReceiptDigest: d("1"),
    installedBytesDigest: d("2"),
    releaseDigest: d("a"),
    releaseManifestDigest: d("3"),
    releaseSubjectDigest: d("a"),
    reviewedInstallerDigest: d("4"),
    schemaVersion: "active-release/v1",
  });
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
  const valueDigest = computePointerValueDigest("ACTIVE_RELEASE", pathInstanceDigest, value);
  const proposal = Object.freeze({
    authorityEpochReceiptDigest: d("f"),
    authorityEpochTipDigest: d("d"),
    authorityEpochValueDigest: d("e"),
    intent: "VALUE_PROPOSED",
    mutationId: d("c"),
    outcome: "SELECT",
    pathInstanceDigest,
    pointerKind: "ACTIVE_RELEASE",
    positionDigest: d("0"),
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    producerDigest: d("b"),
    producerKind: "SELECTED_EPOCH",
    proposedAt: createdAt,
    schemaVersion: "pointer-cas-proposal-receipt/v1",
    successorValueDigest: valueDigest,
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
    expect(parseActiveReleaseValue(value).ok).toBe(true);
    expect(parseContract("active-release/v1", value).ok).toBe(true);
    expect(
      computePointerValueDigest("ACTIVE_RELEASE", pathInstanceDigest, structuredClone(value)),
    ).toBe(valueDigest);
    expect(computeProposalReceiptDigest(structuredClone(proposal))).toBe(proposalReceiptDigest);
    expect(computeCurrentTipDigest(tip)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeProposalReceiptDigest({ ...proposal, successorValueDigest: d("0") })).not.toBe(
      proposalReceiptDigest,
    );
    expect(proposal).not.toHaveProperty("tipDigest");
    expect(value).not.toHaveProperty("proposalReceiptDigest");
  });
  test("admits reviewed-bootstrap genesis only for initial active release or authority", () => {
    const bootstrap = {
      ...proposal,
      authorityEpochReceiptDigest: null,
      authorityEpochTipDigest: null,
      authorityEpochValueDigest: null,
      producerKind: "REVIEWED_BOOTSTRAP_GENESIS",
    };
    expect(() => computeProposalReceiptDigest(bootstrap)).not.toThrow();
    expect(() =>
      computeProposalReceiptDigest({ ...bootstrap, pointerKind: "ACTIVATION_CLEANUP_GATE" }),
    ).toThrow("producerKind:bootstrap-selection-mismatch");
    expect(() => computeProposalReceiptDigest({ ...bootstrap, priorTipDigest: d("5") })).toThrow();
    expect(() =>
      computeProposalReceiptDigest({ ...bootstrap, authorityEpochTipDigest: d("6") }),
    ).toThrow("producerKind:epoch-mismatch");
  });
  test("classifies only exact selected evidence and returns UNKNOWN for malformed evidence", () => {
    const selected = {
      proposal,
      selectedTip: tip,
      selectedValue: value,
      selectedProposal: proposal,
      conflictReceipt: null,
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

describe("durable pointer tombstones", () => {
  const tombstone = Object.freeze({
    archiveDigest: d("a"),
    pointerKind: "ACTIVE_RELEASE",
    priorReceiptDigest: d("b"),
    priorTipDigest: d("c"),
    priorValueDigest: d("d"),
    schemaVersion: "pointer-tombstone-value/v1",
    terminalProofDigest: d("e"),
    tombstonedAt: "2026-08-18T13:00:00.000Z",
  });

  test("accepts the exact closed record through both direct and registry dispatch", () => {
    expect(parsePointerTombstoneValue(tombstone).ok).toBe(true);
    expect(parseContract("pointer-tombstone-value/v1", tombstone).ok).toBe(true);
  });

  test("rejects rotation tombstones and malformed, incomplete, or extended evidence", () => {
    expect(
      parsePointerTombstoneValue({
        ...tombstone,
        pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION",
      }).ok,
    ).toBe(false);
    expect(parsePointerTombstoneValue({ ...tombstone, archiveDigest: d("z") }).ok).toBe(false);
    expect(parsePointerTombstoneValue({ ...tombstone, tombstonedAt: "2026-08-18" }).ok).toBe(false);
    expect(parsePointerTombstoneValue({ ...tombstone, nativeError: "missing" }).ok).toBe(false);
    const missingArchive = { ...tombstone } as Record<string, unknown>;
    delete missingArchive.archiveDigest;
    expect(parsePointerTombstoneValue(missingArchive).ok).toBe(false);
    expect(parsePointerTombstoneValue(null).ok).toBe(false);
  });
});

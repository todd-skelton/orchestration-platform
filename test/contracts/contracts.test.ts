import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import * as publicApi from "../../packages/contracts/src/index.js";
import {
  canonicalBytes,
  canonicalDigest,
  classifyProposal,
  computeConflictDigest,
  computeCurrentTipDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeRecoveryAuthorizationCoreDigest,
  diagnostic,
  fixedEvidencePacketLimits,
  framedBytes,
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
  ordinaryEpochSequence,
  parseCanonicalContractBytes,
  parseContract,
  pointerKinds,
  pointerPath,
  pointerRegistry,
  recoveryAccumulatorDigest,
  retentionAllows,
  reduceCleanupHeadWrite,
  schemaDefinitions,
  schemaVersions,
  serializeContract,
  snapshotClosedArray,
  stateMutationAuthorityPath,
  stateMutationLockPath,
  stateMutationRegistry,
  validateEpochSequence,
  validateAuthorizationReceiptChain,
  validateAuthorizationRevokeReceiptChain,
  validateGateAuthorizationBinding,
  validateEvidencePacket,
  validateFenceHeadHistory,
  validatePointerDispatch,
  validateCleanupHeadHistory,
  validateRetentionTransition,
  validateRotationCensus,
  v2SchemaVersions,
  type ContractRecord,
  type FieldRule,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, uuid, uuid2 } from "./fixtures.js";

function invalidFor(rule: FieldRule): unknown {
  if (rule.array) return { no: "array" };
  if (rule.values) return "FUTURE";
  switch (rule.kind) {
    case "boolean":
      return "false";
    case "bounded-string":
      return "";
    case "decimal":
      return "01";
    case "file-url":
      return "/absolute";
    case "integer":
    case "positive-integer":
      return Number.MAX_SAFE_INTEGER + 1;
    case "opaque":
      return "contains spaces";
    case "relative-path":
      return "../escape";
    case "schema-id":
      return "schema/latest";
    case "semver":
      return "1";
    case "sha256":
      return digest.toUpperCase();
    case "timestamp":
      return "2026-08-16";
    case "uuid-v7":
      return "not-a-uuid";
  }
}

function authorizationSelection(
  core: ContractRecord,
  state: ContractRecord,
  prior: { tipDigest: string; valueDigest: string; proposalReceiptDigest: string } | null = null,
) {
  const canonicalPointerPath = pointerPath("RECOVERY_AUTHORIZATION_STATE", {
    transactionId: core.transactionId as string,
  });
  const pathInstanceDigest = computePointerInstanceDigest({
    pointerKind: "RECOVERY_AUTHORIZATION_STATE",
    canonicalPointerPath,
    installationId: core.installationId as string,
    projectId: core.projectId as string,
    stateRootDigest: core.stateRootDigest as string,
    transactionId: core.transactionId as string,
    sourceToken: "none",
  });
  const valueDigest = computePointerValueDigest(
    "RECOVERY_AUTHORIZATION_STATE",
    pathInstanceDigest,
    state,
  );
  const mutationInput = {
    pointerKind: "RECOVERY_AUTHORIZATION_STATE" as const,
    canonicalPointerPath,
    pathInstanceDigest,
    transactionId: core.transactionId as string,
    sourceToken: "none",
    positionDigest: digest2,
    priorDt: prior?.tipDigest ?? null,
    priorDv: prior?.valueDigest ?? null,
    priorDr: prior?.proposalReceiptDigest ?? null,
    successorDv: valueDigest,
    outcome: "SELECT",
    intent: "VALUE_PROPOSED",
  };
  const mutationId = computeMutationId(mutationInput);
  const proposal: ContractRecord = {
    ...fixtureFor("pointer-cas-proposal-receipt/v1"),
    pointerKind: "RECOVERY_AUTHORIZATION_STATE",
    pathInstanceDigest,
    mutationId,
    priorTipDigest: mutationInput.priorDt,
    priorValueDigest: mutationInput.priorDv,
    priorReceiptDigest: mutationInput.priorDr,
    successorValueDigest: valueDigest,
    positionDigest: digest2,
    outcome: "SELECT",
    intent: "VALUE_PROPOSED",
  };
  const proposalReceiptDigest = computeProposalReceiptDigest({
    pointerKind: mutationInput.pointerKind,
    pathInstanceDigest,
    mutationId,
    priorDt: mutationInput.priorDt,
    priorDv: mutationInput.priorDv,
    priorDr: mutationInput.priorDr,
    successorDv: valueDigest,
    positionDigest: digest2,
    outcome: "SELECT",
    intent: "VALUE_PROPOSED",
    receipt: proposal,
  });
  const tip: ContractRecord = {
    ...fixtureFor("pointer-current-tip/v1"),
    pointerKind: "RECOVERY_AUTHORIZATION_STATE",
    pathInstanceDigest,
    valueDigest,
    proposalReceiptDigest,
  };
  const tipDigest = computeCurrentTipDigest(
    "RECOVERY_AUTHORIZATION_STATE",
    pathInstanceDigest,
    valueDigest,
    proposalReceiptDigest,
    tip,
  );
  return { pathInstanceDigest, proposal, proposalReceiptDigest, tip, tipDigest, valueDigest };
}

describe("current and diagnostic schema registries", () => {
  test("pins eleven pointer kinds, one lock, and exact canonical paths", () => {
    expect(pointerKinds).toHaveLength(11);
    expect(pointerRegistry.map((row) => row.kind)).toEqual(pointerKinds);
    expect(new Set(pointerKinds).size).toBe(11);
    expect(stateMutationLockPath).toBe("installation/state-mutation.lock");
    expect(stateMutationAuthorityPath).toBe("installation/state-mutation-authority.json");
    expect(stateMutationRegistry.lock).toEqual({
      path: stateMutationLockPath,
      singleton: true,
      symlinkAllowed: false,
    });
    expect(pointerRegistry.filter((row) => row.singleton)).toHaveLength(5);
    for (const row of pointerRegistry) {
      expect(row.rootTemplates.length, `${row.kind}:roots`).toBeGreaterThan(0);
      expect(row.archiveTemplates.length, `${row.kind}:archives`).toBeGreaterThan(0);
      expect(row.valueSchemas.length, `${row.kind}:schemas`).toBeGreaterThan(0);
    }
    const familyCensus = pointerRegistry.map((row) => ({
      archiveTemplates: row.archiveTemplates,
      genesis: row.genesis,
      kind: row.kind,
      rootTemplates: row.rootTemplates,
      valueDigests: row.valueSchemas.map((schemaVersion) =>
        canonicalDigest(fixtureFor(schemaVersion)),
      ),
      valueSchemas: row.valueSchemas,
    }));
    expect(canonicalDigest(familyCensus)).toBe(
      "669bb4bc86059e22d0b8d0789af6b13b2624e86a65628d6999c78c068a30881f",
    );
    expect(pointerPath("ACTIVE_RELEASE")).toBe("installation/active-release.json");
    expect(pointerPath("RECOVERY_AUTHORIZATION_STATE", { transactionId: uuid })).toBe(
      `installation/recovery-authorizations/${uuid}/state.json`,
    );
    expect(
      pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        predecessorKey: digest,
      }),
    ).toBe(
      `installation/activation-recovery-launches/${uuid}/recovery-fence-v2/reservations/${digest}.json`,
    );
    expect(() =>
      pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
        transactionId: "../bad",
        sourceToken: "recovery-fence-v2",
        predecessorKey: digest,
      }),
    ).toThrow();
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "active-release/v2",
      ),
    ).toEqual([]);
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "active-release/v1",
      ),
    ).toContain("schemaVersion:wrong-pointer-family");
    expect(
      validatePointerDispatch("ACTIVE_RELEASE", "installation/other.json", "active-release/v2"),
    ).toContain("pointerPath:mismatch");
    expect(() =>
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", {
        transactionId: uuid,
        sourceToken: "recovery-fence/v1",
      }),
    ).toThrow();
    expect(() => pointerPath("ACTIVE_RELEASE", { transactionId: uuid })).toThrow();
  });

  test("exports current surface and isolates every legacy symbol under diagnostic", () => {
    for (const name of [
      "legacySchemaDefinitions",
      "recoveryFenceCurrentPath",
      "recoveryLaunchPath",
      "validateRecoveryAuthorizationAttachment",
      "validateRecoveryLaunchTransition",
    ])
      expect(publicApi).not.toHaveProperty(name);
    expect(publicApi.diagnostic).toBe(diagnostic);
    expect(Object.keys(diagnostic).sort()).toEqual(
      ["parseContract", "paths", "schemaDefinitions", "schemaVersions", "validators"].sort(),
    );
    const manifest = JSON.parse(
      readFileSync(new URL("../../packages/contracts/package.json", import.meta.url), "utf8"),
    );
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(manifest.files).toEqual(["src"]);
  });

  test("removes superseded authority v1 from current dispatch and retains diagnostic parsing", () => {
    expect(diagnostic.schemaVersions).toHaveLength(13);
    for (const schemaVersion of diagnostic.schemaVersions) {
      const fixture = fixtureFor(schemaVersion);
      expect(schemaDefinitions).not.toHaveProperty(schemaVersion);
      expect(parseContract(schemaVersion, fixture)).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
      expect(diagnostic.parseContract(schemaVersion, fixture).ok, schemaVersion).toBe(true);
    }
    expect(diagnostic.parseContract("active-release/v2", fixtureFor("active-release/v2"))).toEqual({
      ok: false,
      issues: ["schemaVersion:not-diagnostic"],
    });
  });

  test("pins the complete current schema census and exhaustive closed-field parsing", () => {
    const required = [
      "pointer-current-tip/v1",
      "pointer-cas-proposal-receipt/v1",
      "pointer-conflict-receipt/v1",
      "pointer-tombstone-value/v1",
      "authority-retention/v1",
      "state-mutation-authority-value/v1",
      "active-release/v2",
      "activation-cleanup-gate-root/v2",
      "activation-cleanup-gate-head/v2",
      "activation-recovery-fence-root/v2",
      "activation-recovery-fence-head/v2",
      "activation-recovery-launch/v2",
      "recovery-attempt-reservation/v1",
      "recovery-attempt-descriptor/v1",
      "recovery-attempt-terminal-summary/v1",
      "recovery-attempt-accumulator/v1",
      "activation-cleanup-archive-head/v2",
      "recovery-authorization-core/v1",
      "recovery-authorization-state/v2",
      "native-consume-receipt/v1",
      "recovery-authorization-consume-receipt/v1",
      "native-removal-receipt/v1",
      "recovery-authorization-revoke-receipt/v1",
      "recovery-authorization-attachment/v1",
    ];
    for (const schemaVersion of required) expect(schemaVersions).toContain(schemaVersion);
    expect(schemaVersions).toHaveLength(49);
    expect(new Set(schemaVersions).size).toBe(schemaVersions.length);
    for (const schemaVersion of schemaVersions) {
      const fixture = fixtureFor(schemaVersion);
      expect(parseContract(schemaVersion, fixture).ok, schemaVersion).toBe(true);
      for (const [name, rule] of Object.entries(schemaDefinitions[schemaVersion]!.fields)) {
        const missing = { ...fixture } as Record<string, unknown>;
        delete missing[name];
        expect(parseContract(schemaVersion, missing).ok, `${schemaVersion}:${name}:missing`).toBe(
          false,
        );
        expect(
          parseContract(schemaVersion, { ...fixture, [name]: invalidFor(rule) }).ok,
          `${schemaVersion}:${name}:invalid`,
        ).toBe(false);
      }
      expect(parseContract(schemaVersion, { ...fixture, extraAuthority: digest }).ok).toBe(false);
    }
  });
});

describe("closed snapshots and canonical bytes", () => {
  test("accepts exact mutable, sealed, and frozen arrays", () => {
    for (const input of [["a"], Object.seal(["a"]), Object.freeze(["a"])]) {
      const result = snapshotClosedArray(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  test("refuses reflective array and record mutants without invoking user code", () => {
    const accessor = ["a"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    const extra = ["a"] as unknown[] & { extra?: string };
    extra.extra = "x";
    const symbol = ["a"];
    Object.defineProperty(symbol, Symbol("x"), { value: true });
    const hole = new Array(1);
    const subclass = new (class extends Array<string> {})("a");
    const proxy = new Proxy(["a"], {});
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const input of [
      accessor,
      extra,
      symbol,
      hole,
      subclass,
      proxy,
      cyclic,
      Object.create(null),
    ])
      expect(snapshotClosedArray(input).ok).toBe(false);
    const fixture = fixtureFor("pointer-current-tip/v1");
    for (const input of [
      new Proxy(fixture, {}),
      Object.assign(Object.create({ x: 1 }), fixture),
      Object.defineProperty({ ...fixture }, "hidden", { value: 1 }),
    ])
      expect(parseContract("pointer-current-tip/v1", input).ok).toBe(false);
    const nullPrototype = Object.assign(Object.create(null), fixture);
    expect(parseContract("pointer-current-tip/v1", nullPrototype).ok).toBe(true);
  });

  test("canonical parse is exact-byte and total", () => {
    const fixture = fixtureFor("pointer-current-tip/v1");
    const serialized = serializeContract("pointer-current-tip/v1", fixture);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(parseCanonicalContractBytes("pointer-current-tip/v1", serialized.bytes).ok).toBe(true);
    expect(
      parseCanonicalContractBytes(
        "pointer-current-tip/v1",
        new TextEncoder().encode(JSON.stringify(fixture)),
      ).ok,
    ).toBe(false);
    expect(() => canonicalBytes(new Proxy(fixture, {}) as never)).toThrow();
  });
});

describe("framed pointer digest graph", () => {
  const value = fixtureFor("active-release/v2");
  const mutationInput = {
    pointerKind: "ACTIVE_RELEASE" as const,
    canonicalPointerPath: "installation/active-release.json",
    pathInstanceDigest: digest,
    transactionId: uuid,
    sourceToken: "none",
    positionDigest: digest2,
    priorDt: null,
    priorDv: null,
    priorDr: null,
    successorDv: digest2,
    outcome: "SELECT",
    intent: "VALUE_PROPOSED",
  };

  test("pins exact domain-separated golden digests", () => {
    const dp = computePointerInstanceDigest({
      pointerKind: "ACTIVE_RELEASE",
      canonicalPointerPath: "installation/active-release.json",
      installationId: uuid,
      projectId: uuid,
      stateRootDigest: digest,
      transactionId: uuid,
      sourceToken: "none",
    });
    const mutationId = computeMutationId(mutationInput);
    const dv = computePointerValueDigest("ACTIVE_RELEASE", digest, value);
    const receipt = {
      ...fixtureFor("pointer-cas-proposal-receipt/v1"),
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      mutationId,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: dv,
      positionDigest: digest2,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
    };
    const dr = computeProposalReceiptDigest({
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      mutationId,
      priorDt: null,
      priorDv: null,
      priorDr: null,
      successorDv: dv,
      positionDigest: digest2,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      receipt,
    });
    const tip = {
      ...fixtureFor("pointer-current-tip/v1"),
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      valueDigest: dv,
      proposalReceiptDigest: dr,
    };
    const dt = computeCurrentTipDigest("ACTIVE_RELEASE", digest, dv, dr, tip);
    const conflictReceipt = {
      ...fixtureFor("pointer-conflict-receipt/v1"),
      pathInstanceDigest: digest,
      mutationId,
      losingProposalReceiptDigest: dr,
      losingSuccessorValueDigest: dv,
      winningTipDigest: digest2,
      winningValueDigest: digest2,
      winningReceiptDigest: digest2,
      conflictKind: "VALUE_CONFLICT",
      authorityEpochTipDigest: digest,
      authorityEpochValueDigest: digest,
      authorityEpochReceiptDigest: digest,
      conflictAt: instant,
    };
    const dc = computeConflictDigest({
      pathInstanceDigest: digest,
      mutationId,
      losingDr: dr,
      losingDv: dv,
      winningDt: digest2,
      winningDv: digest2,
      winningDr: digest2,
      conflictKind: "VALUE_CONFLICT",
      authorityEpochDt: digest,
      authorityEpochDv: digest,
      authorityEpochDr: digest,
      conflictAt: instant,
      receipt: conflictReceipt,
    });
    expect({ dp, mutationId, dv, dr, dt, dc }).toEqual({
      dp: "89a284193336e4f6b301304ea99455dfec97eb958dd87f8377fc2fb0f9d40ef5",
      mutationId: "d4f916901cc71669b472e399cffc89a5c7d2cd7490fe8c14b90b4ae8d1eb9a05",
      dv: "33a244faa7cb01fc8be0512b16abaa092eff6f382f3f07db3dbcafc114ce2473",
      dr: "84a893dc24d82f21fe7a308e0ddd7426871093e4a6b8fd056ee60b794e2dfe03",
      dt: "d1d37f6192354f8c07133bbe2e972b0d41ff1b5da4f19a5882b7677312f91b0e",
      dc: "6991685bafe4c0310053e73ff87b86b84b06eda1d869de9fc13026fda0d2767c",
    });
    expect(() =>
      computeProposalReceiptDigest({
        pointerKind: "ACTIVE_RELEASE",
        pathInstanceDigest: digest,
        mutationId,
        priorDt: null,
        priorDv: null,
        priorDr: null,
        successorDv: dv,
        positionDigest: digest2,
        intent: "VALUE_PROPOSED",
        outcome: "SELECT",
        receipt: { ...receipt, successorValueDigest: digest },
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computeCurrentTipDigest("ACTIVE_RELEASE", digest, dv, dr, {
        ...tip,
        valueDigest: digest,
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computeConflictDigest({
        pathInstanceDigest: digest,
        mutationId,
        losingDr: dr,
        losingDv: dv,
        winningDt: digest2,
        winningDv: digest2,
        winningDr: digest2,
        conflictKind: "VALUE_CONFLICT",
        authorityEpochDt: digest,
        authorityEpochDv: digest,
        authorityEpochDr: digest,
        conflictAt: instant,
        receipt: { ...conflictReceipt, winningTipDigest: digest },
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computePointerValueDigest(
        "ACTIVE_RELEASE",
        digest,
        fixtureFor("activation-cleanup-gate-head/v2"),
      ),
    ).toThrow(/wrong-pointer-family/);
    expect(() => computeMutationId({ ...mutationInput, sourceToken: "future" })).toThrow(
      /sourceToken/,
    );
  });

  test("pins exact F bytes and all 24 canonical schema bytes", () => {
    const bytes = framedBytes("pointer-value/v2", [
      { type: "text", value: "A" },
      { type: "nullable-text", value: null },
      { type: "nullable-text", value: "B" },
      { type: "raw32", value: digest },
      { type: "nullable-raw32", value: null },
      { type: "nullable-raw32", value: digest2 },
      { type: "raw-fixed", value: "0001" },
      { type: "canonical", value: { a: 1 } },
    ]);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "6f726368657374726174696f6e2d706c6174666f726d00706f696e7465722d76616c75652f763200000000080100000000000000014106000000000000000007000000000000000142020000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa030000000000000000040000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb08000000000000000200010500000000000000087b2261223a317d0a",
    );
    expect(v2SchemaVersions).toHaveLength(24);
    const schemaBytes = v2SchemaVersions.map((schemaVersion) => ({
      digest: canonicalDigest(fixtureFor(schemaVersion)),
      schemaVersion,
    }));
    expect(canonicalDigest(schemaBytes)).toBe(
      "839830bce348eb4b9c9b511261ba24aee27aeff10d0da2f2fcf697d37d9d2a11",
    );
  });

  test("framing distinguishes null, text, raw, canonical, order, and domain", () => {
    const base = framedBytes("pointer-value/v2", [
      { type: "text", value: "x" },
      { type: "raw32", value: digest },
    ]);
    expect(base).not.toEqual(
      framedBytes("pointer-value/v2", [
        { type: "raw32", value: digest },
        { type: "text", value: "x" },
      ]),
    );
    expect(base).not.toEqual(
      framedBytes("pointer-tip/v2", [
        { type: "text", value: "x" },
        { type: "raw32", value: digest },
      ]),
    );
    expect(framedBytes("pointer-value/v2", [{ type: "nullable-raw32", value: null }])).not.toEqual(
      framedBytes("pointer-value/v2", [{ type: "text", value: "null" }]),
    );
    expect(() => framedBytes("pointer-value/v2", new Proxy([], {}))).toThrow(/array/);
    expect(() => framedBytes("pointer-value/v2", [{ type: "raw-fixed", value: "0" }])).toThrow(
      /raw-fixed/,
    );
    expect(() => framedBytes("pointer-value/v2", [{ type: "text", value: 1 } as never])).toThrow(
      /text/,
    );
    const dpInput = {
      pointerKind: "ACTIVE_RELEASE" as const,
      canonicalPointerPath: "installation/active-release.json",
      installationId: uuid,
      projectId: uuid,
      stateRootDigest: digest,
      transactionId: null,
      sourceToken: "none",
    };
    const nullDp = computePointerInstanceDigest(dpInput);
    expect(nullDp).not.toBe(computePointerInstanceDigest({ ...dpInput, transactionId: uuid }));
    expect(() => computePointerInstanceDigest({ ...dpInput, extra: true } as never)).toThrow(
      /unknown-field/,
    );
    expect(() => computePointerInstanceDigest({ ...dpInput, transactionId: "null" })).toThrow(
      /transactionId/,
    );
    const launchPath = pointerPath("ACTIVATION_RECOVERY_LAUNCH", {
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
    });
    for (const bindings of [
      { transactionId: uuid2, sourceToken: "recovery-fence-v2" },
      { transactionId: uuid, sourceToken: "cleanup-gate-pre-fence-v2" },
    ])
      expect(() =>
        computePointerInstanceDigest({
          ...dpInput,
          pointerKind: "ACTIVATION_RECOVERY_LAUNCH",
          canonicalPointerPath: launchPath,
          ...bindings,
        }),
      ).toThrow(/canonicalPointerPath/);
  });
});

describe("pointer, cleanup, epoch, authorization, and attempt semantics", () => {
  test("classifies proposals only from exact evidence", () => {
    const base = {
      checkpointSelected: false,
      compacted: false,
      completionSelected: false,
      conflictMatchesWinner: false,
      malformed: false,
      pending: true,
      planSelected: false,
      selectedTipMatches: false,
    };
    expect(classifyProposal(base)).toBe("PENDING");
    expect(classifyProposal({ ...base, pending: false, selectedTipMatches: true })).toBe(
      "SELECTED",
    );
    expect(classifyProposal({ ...base, pending: false, conflictMatchesWinner: true })).toBe(
      "LOST_CONFLICT",
    );
    expect(
      classifyProposal({
        ...base,
        pending: false,
        compacted: true,
        checkpointSelected: true,
        planSelected: true,
        completionSelected: true,
      }),
    ).toBe("COMPACTED");
    expect(classifyProposal({ ...base, selectedTipMatches: true })).toBe("UNKNOWN");
    expect(
      classifyProposal({
        ...base,
        pending: false,
        selectedTipMatches: true,
        conflictMatchesWinner: true,
      }),
    ).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, pending: false, compacted: true })).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, malformed: true })).toBe("UNKNOWN");
    expect(
      classifyProposal({ ...base, malformed: "false", pending: false, selectedTipMatches: true }),
    ).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, extra: true })).toBe("UNKNOWN");
  });

  test("pins ten cleanup pairs, twelve edges, and no append self loops", () => {
    const lifecycles = ["PENDING", "ACTIVATING", "ABORTING", "COMPLETE"];
    const publications = ["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"];
    const pairs = lifecycles.flatMap((lifecycle) =>
      publications.map((publication) => [lifecycle, publication] as const),
    );
    expect(
      pairs.filter(([lifecycle, publication]) =>
        isCleanupLifecyclePublicationPair(lifecycle, publication),
      ),
    ).toHaveLength(10);
    let edges = 0;
    for (const [a, b] of pairs)
      for (const [c, d] of pairs)
        if (isCleanupLifecyclePublicationTransition(a, b, c, d)) edges += 1;
    expect(edges).toBe(12);
    for (const [lifecycle, publication] of pairs)
      if (isCleanupLifecyclePublicationPair(lifecycle, publication))
        expect(reduceCleanupHeadWrite(lifecycle, publication, lifecycle, publication)).toBe(
          "NO_APPEND",
        );
  });

  test("pins ordinary epoch ordering and complete other-kind rotation census", () => {
    expect(validateEpochSequence([...ordinaryEpochSequence])).toBe(true);
    expect(validateEpochSequence([...ordinaryEpochSequence].reverse())).toBe(false);
    const entries = pointerKinds
      .filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION")
      .sort()
      .map((pointerKind) => ({
        classification: "SELECTED",
        pathInstanceDigest: digest,
        pointerKind,
        proposalReceiptDigest: digest,
        tipDigest: digest,
        valueDigest: digest,
      }));
    const census = { authorityEpochDigest: digest, entries };
    expect(validateRotationCensus(census)).toBe(true);
    expect(
      validateRotationCensus({
        ...census,
        entries: entries.map((entry, index) =>
          index === 0 ? { ...entry, classification: "PENDING" } : entry,
        ),
      }),
    ).toBe(false);
    expect(validateRotationCensus({ ...census, entries: entries.slice(1) })).toBe(false);
    expect(validateRotationCensus({ ...census, entries: [...entries].reverse() })).toBe(false);
    expect(validateRotationCensus({ ...census, entries: [...entries, entries.at(-1)!] })).toBe(
      false,
    );

    const genesis = fixtureFor("state-mutation-authority-value/v1");
    expect(parseContract("state-mutation-authority-value/v1", genesis).ok).toBe(true);
    const rotation = {
      ...genesis,
      rotationKind: "ROTATION",
      producerKind: "SELECTED_STABLE",
      priorAuthorityTipDigest: digest,
      priorAuthorityValueDigest: digest,
      priorAuthorityReceiptDigest: digest,
      priorHelperDigest: digest,
      priorHelperProfileDigest: digest,
      priorHelperAbiDigest: digest,
      priorCustodyReceiptDigest: digest,
    };
    expect(parseContract("state-mutation-authority-value/v1", rotation).ok).toBe(true);
    expect(
      parseContract("state-mutation-authority-value/v1", {
        ...rotation,
        priorHelperDigest: null,
      }).ok,
    ).toBe(false);
  });

  test("validates ordered cleanup/fence histories and retention policy", () => {
    const gate0 = fixtureFor("activation-cleanup-gate-head/v2");
    const gate1 = {
      ...gate0,
      ordinal: 1,
      previousHeadDigest: serializeContract("activation-cleanup-gate-head/v2", gate0).ok
        ? (
            serializeContract("activation-cleanup-gate-head/v2", gate0) as {
              ok: true;
              digest: string;
            }
          ).digest
        : digest,
      publication: "PUBLISHING",
      fenceDigest: digest,
    };
    expect(validateCleanupHeadHistory([gate0, gate1])).toEqual([]);
    expect(validateCleanupHeadHistory([gate1, gate0])).not.toEqual([]);
    const fence0 = fixtureFor("activation-recovery-fence-head/v2");
    const fenceDigest = (
      serializeContract("activation-recovery-fence-head/v2", fence0) as { ok: true; digest: string }
    ).digest;
    const fence1 = {
      ...fence0,
      ordinal: 1,
      previousHeadDigest: fenceDigest,
      lifecycle: "POST_ACTIVATION",
    };
    expect(validateFenceHeadHistory([fence0, fence1])).toEqual([]);
    expect(validateFenceHeadHistory([fence1])).not.toEqual([]);
    const retention = {
      checkpointDigest: digest,
      completionReceiptDigest: null,
      lossProofDigest: null,
      nextPhase: "CHECKPOINTED",
      planDigest: null,
      previousPhase: "CURRENT",
      proposalClassification: "SELECTED",
      recordClass: "TERMINAL_ATTEMPT_HISTORY",
    };
    expect(validateRetentionTransition(retention)).toBe(true);
    expect(validateRetentionTransition({ ...retention, proposalClassification: "PENDING" })).toBe(
      false,
    );
    expect(validateRetentionTransition({ ...retention, checkpointDigest: "not-a-digest" })).toBe(
      false,
    );
    expect(retentionAllows("AUDIT_DEGRADED", "EXISTING_RECOVERY")).toBe(true);
    expect(retentionAllows("AUDIT_DEGRADED", "NEW_PROMOTION")).toBe(false);
    expect(retentionAllows("UNKNOWN", "EXISTING_RECOVERY")).toBe(false);

    const cleanupBase = fixtureFor("activation-cleanup-gate-head/v2");
    const admissible = [
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
      ["PENDING", "PUBLISHED"],
      ["ACTIVATING", "PUBLISHED"],
      ["ABORTING", "NOT_PUBLISHED"],
      ["ABORTING", "PUBLISHING"],
      ["ABORTING", "PUBLISHED"],
      ["ABORTING", "CLEARED"],
      ["COMPLETE", "NOT_PUBLISHED"],
      ["COMPLETE", "CLEARED"],
    ] as const;
    for (const [lifecycle, publication] of admissible) {
      const complete = lifecycle === "COMPLETE";
      const needsFence = publication === "PUBLISHING" || publication === "PUBLISHED";
      expect(
        parseContract("activation-cleanup-gate-head/v2", {
          ...cleanupBase,
          lifecycle,
          publication,
          fenceDigest: needsFence ? digest : null,
          terminalRevocationReceiptDigest: complete ? digest : null,
          terminalProofDigest: complete ? digest : null,
          archiveOutcomeDigest: complete ? digest : null,
        }).ok,
        `${lifecycle}/${publication}`,
      ).toBe(true);
    }
  });

  test("auth core forbids candidate manifest and pins mode/state evidence", () => {
    const core = fixtureFor("recovery-authorization-core/v1");
    expect(parseContract("recovery-authorization-core/v1", core).ok).toBe(true);
    const successorCore = {
      ...core,
      mode: "SUCCESSOR",
      grantDigest: null,
      installerDigest: null,
      destinationDigest: null,
      cycleId: uuid,
      admissionDigest: digest,
      priorBrokerGeneration: 0,
      successorBrokerGeneration: 1,
      expectedActiveGeneration: 0,
      predecessorReleaseDigest: digest,
      successorReleaseDigest: digest2,
      predecessorExecutableDigest: digest,
      successorExecutableDigest: digest2,
      predecessorOperationManifestDigest: digest,
      successorOperationManifestDigest: digest2,
      fencePath: "installation/fence.json",
      fenceDigest: digest,
    };
    expect(parseContract("recovery-authorization-core/v1", successorCore).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-core/v1", {
        ...successorCore,
        successorBrokerGeneration: 2,
      }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-core/v1", { ...core, expiresAt: instant }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-core/v1", {
        ...core,
        candidateOperationManifestDigest: digest,
      }).ok,
    ).toBe(false);
    expect(parseContract("recovery-authorization-core/v1", { ...core, grantDigest: null }).ok).toBe(
      false,
    );
    const state = fixtureFor("recovery-authorization-state/v2");
    expect(parseContract("recovery-authorization-state/v2", state).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-state/v2", { ...state, lifecycle: "CONSUMED" }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-state/v2", {
        ...state,
        lifecycle: "CONSUMED",
        gateRootDigest: digest,
        nativeConsumeReceiptDigest: digest,
      }).ok,
    ).toBe(true);

    const coreDigest = computeRecoveryAuthorizationCoreDigest(core);
    expect(coreDigest).not.toBe(canonicalDigest(core));
    expect(coreDigest).toBe("407acdd929de14c74ee29274c7b2f6322a16f4603fa3450d1831172dc049fafd");
    const createdState = { ...state, coreDigest };
    const createdSelection = authorizationSelection(core, createdState);
    const gateRoot: ContractRecord = {
      ...fixtureFor("activation-cleanup-gate-root/v2"),
      authorizationCoreDigest: coreDigest,
      authorizationCreatedTipDigest: createdSelection.tipDigest,
      authorizationCreatedValueDigest: createdSelection.valueDigest,
      authorizationCreatedReceiptDigest: createdSelection.proposalReceiptDigest,
    };
    const gateRootDigest = canonicalDigest(gateRoot);
    const nativeConsume = {
      ...fixtureFor("native-consume-receipt/v1"),
      coreDigest,
    };
    const nativeConsumeDigest = canonicalDigest(nativeConsume);
    const consumedStateBase = {
      ...state,
      coreDigest,
      lifecycle: "CONSUMED",
      gateRootDigest,
      nativeConsumeReceiptDigest: nativeConsumeDigest,
    };
    const consumedSelection = authorizationSelection(core, consumedStateBase, createdSelection);
    const postConsume: ContractRecord = {
      ...fixtureFor("recovery-authorization-consume-receipt/v1"),
      authorizationTipDigest: consumedSelection.tipDigest,
      authorizationValueDigest: consumedSelection.valueDigest,
      authorizationReceiptDigest: consumedSelection.proposalReceiptDigest,
      nativeConsumeReceiptDigest: nativeConsumeDigest,
      coreDigest,
      gateRootDigest,
      selectedReadbackDigest: consumedSelection.tipDigest,
    };
    const consumedState = consumedStateBase;
    const consumeEnvelope = {
      core,
      nativeConsume,
      postConsume,
      selectedProposal: consumedSelection.proposal,
      selectedTip: consumedSelection.tip,
      state: consumedState,
    };
    expect(validateAuthorizationReceiptChain(consumeEnvelope)).toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        nativeConsume: {
          ...nativeConsume,
          operationId: "018f0c24-7a3b-7cc1-9a2f-1234567890ac",
        },
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        selectedProposal: { ...consumedSelection.proposal, positionDigest: digest },
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        selectedTip: { ...consumedSelection.tip, valueDigest: digest },
      }),
    ).not.toEqual([]);
    for (const name of [
      "capabilityReferenceDigest",
      "capabilityDigest",
      "custodyPrincipalDigest",
      "brokerServiceDigest",
      "brokerProfileDigest",
      "nativeReadbackDigest",
    ] as const)
      expect(
        validateAuthorizationReceiptChain({
          ...consumeEnvelope,
          postConsume: { ...postConsume, [name]: digest2 },
        }),
        name,
      ).not.toEqual([]);

    expect(
      validateGateAuthorizationBinding({
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot,
      }),
    ).toEqual([]);
    expect(
      validateGateAuthorizationBinding({
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot: { ...gateRoot, projectId: "018f0c24-7a3b-7cc1-9a2f-1234567890ac" },
      }),
    ).not.toEqual([]);
    for (const name of [
      "authorizationCoreDigest",
      "authorizationCorePath",
      "authorizationCreatedTipDigest",
      "authorizationCreatedValueDigest",
      "authorizationCreatedReceiptDigest",
      "consumeOperationId",
      "nativeConsumeReceiptPath",
    ] as const)
      expect(
        validateGateAuthorizationBinding({
          core,
          createdProposal: createdSelection.proposal,
          createdState,
          createdTip: createdSelection.tip,
          gateRoot: {
            ...gateRoot,
            [name]: name.endsWith("Path")
              ? "wrong/path.json"
              : name === "consumeOperationId"
                ? "018f0c24-7a3b-7cc1-9a2f-1234567890ac"
                : gateRoot[name] === digest2
                  ? digest
                  : digest2,
          },
        }),
        name,
      ).not.toEqual([]);

    const nativeRemoval: ContractRecord = {
      ...fixtureFor("native-removal-receipt/v1"),
      nativeConsumeReceiptDigest: nativeConsumeDigest,
    };
    const revokedState = {
      ...consumedState,
      lifecycle: "REVOKED",
      nativeRemovalReceiptDigest: canonicalDigest(nativeRemoval),
    };
    const revokedSelection = authorizationSelection(core, revokedState, consumedSelection);
    const postRevoke: ContractRecord = {
      ...fixtureFor("recovery-authorization-revoke-receipt/v1"),
      authorizationTipDigest: revokedSelection.tipDigest,
      authorizationValueDigest: revokedSelection.valueDigest,
      authorizationReceiptDigest: revokedSelection.proposalReceiptDigest,
      nativeRemovalReceiptDigest: canonicalDigest(nativeRemoval),
      coreDigest,
      gateRootDigest,
      nativeAbsenceReadbackDigest: nativeRemoval.nativeAbsenceReadbackDigest as string,
      selectedReadbackDigest: revokedSelection.tipDigest,
    };
    expect(
      validateAuthorizationRevokeReceiptChain({
        consumedProposal: consumedSelection.proposal,
        consumedState,
        consumedTip: consumedSelection.tip,
        core,
        nativeConsume,
        nativeRemoval,
        postConsume,
        postRevoke,
        selectedProposal: revokedSelection.proposal,
        selectedTip: revokedSelection.tip,
        state: revokedState,
      }),
    ).toEqual([]);
    expect(
      validateAuthorizationRevokeReceiptChain({
        consumedProposal: consumedSelection.proposal,
        consumedState,
        consumedTip: consumedSelection.tip,
        core,
        nativeConsume,
        nativeRemoval: { ...nativeRemoval, nativeAbsenceReadbackDigest: digest2 },
        postConsume,
        postRevoke,
        selectedProposal: revokedSelection.proposal,
        selectedTip: revokedSelection.tip,
        state: revokedState,
      }),
    ).not.toEqual([]);

    const attachment = fixtureFor("recovery-authorization-attachment/v1");
    expect(parseContract("recovery-authorization-attachment/v1", attachment).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-attachment/v1", {
        ...attachment,
        lifecycle: "ATTACHED",
      }).ok,
    ).toBe(false);
  });

  test("attempt groups, bounded packets, and rolling formulas fail closed", () => {
    const reservation = fixtureFor("recovery-attempt-reservation/v1");
    expect(
      parseContract("recovery-attempt-reservation/v1", {
        ...reservation,
        predecessorAccumulatorTipDigest: digest,
      }).ok,
    ).toBe(false);
    const descriptor = fixtureFor("recovery-attempt-descriptor/v1");
    expect(
      parseContract("recovery-attempt-descriptor/v1", { ...descriptor, lifecycle: "LIVE" }).ok,
    ).toBe(false);
    expect(recoveryAccumulatorDigest(null, digest)).not.toBe(
      recoveryAccumulatorDigest(digest2, digest),
    );
    const ready = fixtureFor("activation-recovery-launch/v2");
    const live = {
      ...ready,
      lifecycle: "LIVE",
      ordinal: 1,
      previousRecordDigest: canonicalDigest(ready),
      processIdentityDigest: digest2,
    };
    const liveDescriptor: ContractRecord = {
      ...descriptor,
      lifecycle: "LIVE",
      readyRecordDigest: canonicalDigest(ready),
      initialLiveRecordDigest: canonicalDigest(live),
      processIdentityDigest: digest2,
      startedAt: instant,
    };
    const consumedReservation = {
      ...reservation,
      lifecycle: "CONSUMED",
      consumedDescriptorDigest: canonicalDigest(liveDescriptor),
    };
    const accumulator = {
      ...fixtureFor("recovery-attempt-accumulator/v1"),
      descriptorDigest: canonicalDigest(liveDescriptor),
    };
    const postConsume = fixtureFor("recovery-authorization-consume-receipt/v1");
    const attached = {
      ...fixtureFor("recovery-authorization-attachment/v1"),
      lifecycle: "ATTACHED",
      activeReleaseDigest: digest,
      argvDigest: liveDescriptor.argvDigest,
      brokerClientDigest: digest,
      descriptorDigest: canonicalDigest(liveDescriptor),
      fenceHeadDigest: liveDescriptor.fenceHeadDigest,
      gateHeadDigest: digest,
      initialLiveRecordDigest: liveDescriptor.initialLiveRecordDigest,
      processIdentityDigest: liveDescriptor.processIdentityDigest,
      readyRecordDigest: liveDescriptor.readyRecordDigest,
      reservationReceiptDigest: liveDescriptor.reservationReceiptDigest,
      reservationTipDigest: liveDescriptor.reservationTipDigest,
      reservationValueDigest: liveDescriptor.reservationValueDigest,
      consumeReceiptDigest: canonicalDigest(postConsume),
    };
    const packet = {
      accumulator,
      attachment: attached,
      descriptor: liveDescriptor,
      gateHistory: [fixtureFor("activation-cleanup-gate-head/v2")],
      fenceHistory: [fixtureFor("activation-recovery-fence-head/v2")],
      launchHistory: [ready, live],
      postConsume,
      priorTerminalSummaries: [],
      reservation: consumedReservation,
    };
    expect(validateEvidencePacket(packet)).toEqual([]);
    expect(validateEvidencePacket({ ...packet, gateHistory: [1] })).not.toEqual([]);
    expect(validateEvidencePacket({ ...packet, descriptor: 1 })).not.toEqual([]);
    expect(validateEvidencePacket({ ...packet, launchHistory: [1] })).not.toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        priorTerminalSummaries: Array(
          fixedEvidencePacketLimits.maximumPriorTerminalSummaries + 1,
        ).fill(digest),
      }),
    ).toContain("priorTerminalSummaries:limit-exceeded");
  });

  test("pins every authorization, reservation, launch, attachment, accumulator, retention, and tombstone phase", () => {
    const state0 = fixtureFor("recovery-authorization-state/v2");
    const state1 = {
      ...state0,
      lifecycle: "CONSUMED",
      gateRootDigest: digest,
      nativeConsumeReceiptDigest: digest,
    };
    const state2 = { ...state1, lifecycle: "REVOKED", nativeRemovalReceiptDigest: digest2 };
    const reservation0 = fixtureFor("recovery-attempt-reservation/v1");
    const reservation1 = {
      ...reservation0,
      lifecycle: "CONSUMED",
      consumedDescriptorDigest: digest,
    };
    const reservation2 = { ...reservation1, lifecycle: "TERMINAL", terminalSummaryDigest: digest2 };
    const reservation3 = {
      ...reservation2,
      lifecycle: "TOMBSTONE",
      tombstoneArchiveDigest: digest,
    };
    const launch0 = fixtureFor("activation-recovery-launch/v2");
    const launch1 = { ...launch0, lifecycle: "LIVE", processIdentityDigest: digest };
    const launch2 = { ...launch1, lifecycle: "TERMINAL_RETRYABLE", terminalProofDigest: digest2 };
    const descriptor0 = fixtureFor("recovery-attempt-descriptor/v1");
    const descriptor1 = {
      ...descriptor0,
      lifecycle: "LIVE",
      initialLiveRecordDigest: digest,
      processIdentityDigest: digest2,
      startedAt: instant,
    };
    const attachment0 = fixtureFor("recovery-authorization-attachment/v1");
    const attachedFields = {
      activeReleaseDigest: digest,
      argvDigest: digest,
      brokerClientDigest: digest,
      descriptorDigest: digest,
      fenceHeadDigest: digest,
      gateHeadDigest: digest,
      initialLiveRecordDigest: digest,
      processIdentityDigest: digest,
      readyRecordDigest: digest,
      reservationReceiptDigest: digest,
      reservationTipDigest: digest,
      reservationValueDigest: digest,
    };
    const attachment1 = { ...attachment0, ...attachedFields, lifecycle: "ATTACHED" };
    const attachmentLater = {
      ...attachment1,
      priorAttachmentTipDigest: digest,
      priorAttachmentValueDigest: digest,
      priorAttachmentReceiptDigest: digest,
      priorTerminalAccumulatorTipDigest: digest2,
      priorTerminalAccumulatorValueDigest: digest2,
      priorTerminalAccumulatorReceiptDigest: digest2,
      priorTerminalSummaryDigest: digest2,
    };
    const attachment2 = { ...attachment1, lifecycle: "TERMINAL", terminalSummaryDigest: digest2 };
    const accumulator0 = fixtureFor("recovery-attempt-accumulator/v1");
    const accumulator1 = {
      ...accumulator0,
      lifecycle: "TERMINAL",
      terminalSummaryDigest: digest,
      rollingDigest: digest2,
    };
    const retention0 = fixtureFor("authority-retention/v1");
    const retention1 = {
      ...retention0,
      recordClass: "TERMINAL_ATTEMPT_HISTORY",
      phase: "CHECKPOINTED",
      checkpointDigest: digest,
    };
    const tombstone = fixtureFor("pointer-tombstone-value/v1");
    const sequences = [
      ["recovery-authorization-state/v2", [state0, state1, state2]],
      ["recovery-attempt-reservation/v1", [reservation0, reservation1, reservation2, reservation3]],
      ["activation-recovery-launch/v2", [launch0, launch1, launch2]],
      ["recovery-attempt-descriptor/v1", [descriptor0, descriptor1]],
      [
        "recovery-authorization-attachment/v1",
        [attachment0, attachment1, attachmentLater, attachment2],
      ],
      ["recovery-attempt-accumulator/v1", [accumulator0, accumulator1]],
      ["authority-retention/v1", [retention0, retention1]],
      ["pointer-tombstone-value/v1", [tombstone]],
    ] as const;
    const sequenceDigests: { digest: string; schemaVersion: string }[] = [];
    for (const [schemaVersion, values] of sequences)
      for (const record of values) {
        const labelRecord: ContractRecord = record;
        expect(
          parseContract(schemaVersion, record).ok,
          `${schemaVersion}:${String(labelRecord.lifecycle ?? labelRecord.phase ?? "value")}`,
        ).toBe(true);
        sequenceDigests.push({ digest: canonicalDigest(record), schemaVersion });
      }
    expect(
      parseContract("recovery-authorization-attachment/v1", {
        ...attachmentLater,
        priorAttachmentReceiptDigest: null,
      }).ok,
    ).toBe(false);
    expect(canonicalDigest(sequenceDigests)).toBe(
      "7e2f067ef6f97b5209682d510b8ac251cf9312c7ac92220110c7352cbc058784",
    );
    expect(recoveryAccumulatorDigest(null, digest)).toBe(
      "53e8330f18608045b35f390a91f9a2dfd97fc43064ba10d79071aa18f25de511",
    );
    expect(recoveryAccumulatorDigest(digest2, digest)).toBe(
      "934a3d1b05d1bd3fcf84783bd046b88662d321930e2d5965012c2fd87a290ea7",
    );
    expect(recoveryAccumulatorDigest(null, digest)).not.toBe(
      computePointerValueDigest("RECOVERY_ATTEMPT_ACCUMULATOR", digest2, accumulator0),
    );
  });
});

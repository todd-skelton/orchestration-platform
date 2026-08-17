import { describe, expect, test } from "vitest";
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
  diagnosticSchemaDefinitions,
  diagnosticSchemaVersions,
  fixedEvidencePacketLimits,
  framedBytes,
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
  ordinaryEpochSequence,
  parseCanonicalContractBytes,
  parseContract,
  parseDiagnosticContract,
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
  supersededAuthorityVersions,
  validateEpochSequence,
  validateAuthorizationReceiptChain,
  validateEvidencePacket,
  validateFenceHeadHistory,
  validatePointerDispatch,
  validateCleanupHeadHistory,
  validateRetentionTransition,
  validateRotationCensus,
  type FieldRule,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, uuid } from "./fixtures.js";

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
    expect(pointerPath("ACTIVE_RELEASE")).toBe("installation/active-release.json");
    expect(pointerPath("RECOVERY_AUTHORIZATION_STATE", { transactionId: "transaction-1" })).toBe(
      "installation/recovery-authorizations/transaction-1/state.json",
    );
    expect(
      pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
        transactionId: "transaction-1",
        sourceToken: "recovery-fence-v2",
        predecessorKey: digest,
      }),
    ).toBe(
      `installation/activation-recovery-launches/transaction-1/recovery-fence-v2/reservations/${digest}.json`,
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
        transactionId: "transaction-1",
        sourceToken: "recovery-fence/v1",
      }),
    ).toThrow();
  });

  test("removes superseded authority v1 from current dispatch and retains diagnostic parsing", () => {
    expect(diagnosticSchemaVersions).toEqual([...supersededAuthorityVersions].sort());
    for (const schemaVersion of supersededAuthorityVersions) {
      const fixture = fixtureFor(schemaVersion);
      expect(schemaDefinitions).not.toHaveProperty(schemaVersion);
      expect(parseContract(schemaVersion, fixture)).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
      expect(parseDiagnosticContract(schemaVersion, fixture).ok, schemaVersion).toBe(true);
    }
    expect(parseDiagnosticContract("active-release/v2", fixtureFor("active-release/v2"))).toEqual({
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
  const tip = fixtureFor("pointer-current-tip/v1");
  const receipt = fixtureFor("pointer-cas-proposal-receipt/v1");
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
    const dt = computeCurrentTipDigest("ACTIVE_RELEASE", digest, dv, dr, tip);
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
      receipt: fixtureFor("pointer-conflict-receipt/v1"),
    });
    expect({ dp, mutationId, dv, dr, dt, dc }).toEqual({
      dp: "5873e24c9a4b0db10a95ad208b5a8fc6b61ee156341cc5c097015a86a938262e",
      mutationId: "9a70c6fd543ce16263608376bfba2b94f827e61d7a8c7c6e54255818f679b1e6",
      dv: "33a244faa7cb01fc8be0512b16abaa092eff6f382f3f07db3dbcafc114ce2473",
      dr: "b42379aeafb64a9a2f3bbd3ae966f7d864c7d3490f6183d1131c4117ac1f6e98",
      dt: "3da038356af2c27564753dbb157d626f8000ee4341c2ce75101c220f56008cde",
      dc: "d5a58def0d121aebdeb7e3e4c14f597943e94b1950bf3a809104c80c3d5ac252",
    });
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
  });
});

describe("pointer, cleanup, epoch, authorization, and attempt semantics", () => {
  test("classifies proposals only from exact evidence", () => {
    const base = {
      compacted: false,
      conflictMatchesWinner: false,
      malformed: false,
      selectedTipMatches: false,
    };
    expect(classifyProposal(base)).toBe("PENDING");
    expect(classifyProposal({ ...base, selectedTipMatches: true })).toBe("SELECTED");
    expect(classifyProposal({ ...base, conflictMatchesWinner: true })).toBe("LOST_CONFLICT");
    expect(classifyProposal({ ...base, compacted: true })).toBe("COMPACTED");
    expect(classifyProposal({ ...base, malformed: true })).toBe("UNKNOWN");
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
    const census = {
      authorityEpochDigest: digest,
      otherPointerKinds: pointerKinds.filter(
        (kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION",
      ),
      pendingCount: 0,
      unknownCount: 0,
    };
    expect(validateRotationCensus(census)).toBe(true);
    expect(validateRotationCensus({ ...census, pendingCount: 1 })).toBe(false);
    expect(
      validateRotationCensus({ ...census, otherPointerKinds: census.otherPointerKinds.slice(1) }),
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
    expect(validateRetentionTransition("CURRENT", "CHECKPOINTED")).toBe(true);
    expect(validateRetentionTransition("CURRENT", "COMPACTED")).toBe(false);
    expect(retentionAllows("AUDIT_DEGRADED", "EXISTING_RECOVERY")).toBe(true);
    expect(retentionAllows("AUDIT_DEGRADED", "NEW_PROMOTION")).toBe(false);
    expect(retentionAllows("UNKNOWN", "EXISTING_RECOVERY")).toBe(false);
  });

  test("auth core forbids candidate manifest and pins mode/state evidence", () => {
    const core = fixtureFor("recovery-authorization-core/v1");
    expect(parseContract("recovery-authorization-core/v1", core).ok).toBe(true);
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
        postConsumeReceiptDigest: digest2,
      }).ok,
    ).toBe(true);

    const nativeConsume = fixtureFor("native-consume-receipt/v1");
    const postConsume = {
      ...fixtureFor("recovery-authorization-consume-receipt/v1"),
      nativeConsumeReceiptDigest: canonicalDigest(nativeConsume),
    };
    const consumedState = {
      ...state,
      lifecycle: "CONSUMED",
      gateRootDigest: digest,
      nativeConsumeReceiptDigest: canonicalDigest(nativeConsume),
      postConsumeReceiptDigest: canonicalDigest(postConsume),
    };
    expect(
      validateAuthorizationReceiptChain({
        nativeConsume,
        postConsume,
        state: consumedState,
      }),
    ).toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        nativeConsume: { ...nativeConsume, operationId: "018f0c24-7a3b-7cc1-9a2f-1234567890ac" },
        postConsume,
        state: consumedState,
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
    const packet = {
      gateHistory: [],
      fenceHistory: [],
      launchHistory: [],
      priorTerminalSummaries: [],
    };
    expect(validateEvidencePacket(packet)).toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        priorTerminalSummaries: Array(
          fixedEvidencePacketLimits.maximumPriorTerminalSummaries + 1,
        ).fill(digest),
      }),
    ).toContain("priorTerminalSummaries:limit-exceeded");
  });
});

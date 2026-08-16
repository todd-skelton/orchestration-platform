import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { TextEncoder } from "node:util";
import { describe, expect, test } from "vitest";
import { regularCapabilitySlot } from "../../scripts/capability-slots.mjs";
import {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  cleanupGateArchivePath,
  cleanupGateCurrentPath,
  cleanupGateHeadPath,
  cleanupGateRootPath,
  cleanupHeadCurrentPath,
  parseCanonicalContractBytes,
  parseContract,
  recoveryAuthorizationPath,
  recoveryFenceCurrentPath,
  recoveryFenceHeadPath,
  recoveryFenceRootPath,
  recoveryLaunchCurrentPath,
  recoveryLaunchPath,
  reduceInitializationCensus,
  schemaDefinitions,
  schemaVersions,
  serializeContract,
  validateCleanupAuthorityBinding,
  validateCleanupHeadTransition,
  validateFenceAuthorityBinding,
  validateFenceHeadTransition,
  validateImportReceiptAgainstPlan,
  validateRecoveryAuthorizationAttachment,
  validateRecoveryAuthorityAlignment,
  validateRecoveryLaunchTransition,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
} from "../../packages/contracts/src/index.js";
import {
  digest,
  digest2,
  fixtureFor,
  instant,
  later,
  uuid,
  uuid2,
  validFixtures,
} from "./fixtures.js";

function mutant(schemaVersion: string, changes: Record<string, unknown>): Record<string, unknown> {
  return { ...fixtureFor(schemaVersion), ...changes };
}

function successorAuthorizationFixture(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return mutant("recovery-authorization/v1", {
    mode: "successor",
    bootstrapGrantDigest: null,
    bootstrapInstallerDigest: null,
    candidateDigest: null,
    destinationStateRootDigest: null,
    expectedActiveRecordDigest: digest,
    fenceRootDigest: digest,
    gateRootDigest: digest,
    operationManifestDigest: digest,
    pendingAdmissionDigest: digest,
    predecessorExecutableDigest: digest,
    predecessorReleaseDigest: digest,
    priorBrokerGeneration: 0,
    promotionCycleId: uuid,
    successorBrokerGeneration: 1,
    successorExecutableDigest: digest,
    successorReleaseDigest: digest,
    lifecycle: "CONSUMED_BOUND",
    consumedAt: instant,
    expiresAt: null,
    ...changes,
  });
}

function invalidFor(rule: FieldRule): unknown {
  if (rule.array) return { not: "array" };
  if (rule.values) return "future-enum";
  switch (rule.kind) {
    case "boolean":
      return "false";
    case "bounded-string":
      return "";
    case "decimal":
      return "01";
    case "file-url":
      return "/host/path";
    case "integer":
    case "positive-integer":
      return Number.MAX_SAFE_INTEGER + 1;
    case "opaque":
      return "contains spaces";
    case "relative-path":
      return "../escape";
    case "schema-id":
      return "facts/latest";
    case "semver":
      return "1.0";
    case "sha256":
      return "A".repeat(64);
    case "timestamp":
      return "2026-08-16T12:34:56Z";
    case "uuid-v7":
      return "018f0c24-7a3b-6cc1-8a2f-1234567890ab";
  }
}

describe("closed contract registry", () => {
  test("pins the exhaustive ISS-002 schema census", () => {
    expect(schemaVersions).toEqual([
      "activation-cleanup-gate-archive/v1",
      "activation-cleanup-gate-current/v1",
      "activation-cleanup-gate-head/v1",
      "activation-cleanup-gate-root/v1",
      "activation-cleanup-head/v1",
      "activation-recovery-fence-current/v1",
      "activation-recovery-fence-head/v1",
      "activation-recovery-fence-root/v1",
      "activation-recovery-launch-archive/v1",
      "activation-recovery-launch-current/v1",
      "activation-recovery-launch/v1",
      "active-release/v1",
      "adapter-declaration/v1",
      "bootstrap-verifier-anchor/v1",
      "breaker-authority/v1",
      "broker-active-client/v1",
      "dispatch-plan/v1",
      "export-manifest/v1",
      "import-plan/v1",
      "import-receipt/v1",
      "installed-release/v1",
      "journal-event/v1",
      "module-action-plan/v1",
      "module-descriptor/v1",
      "module-no-action/v1",
      "module-plan-input/v1",
      "module-plan-result/v1",
      "owned-resource/v1",
      "pending-successor/v1",
      "platform-configuration/v1",
      "promotion-receipt/v1",
      "recovery-authorization/v1",
      "repository-protection-receipt/v1",
      "review-receipt/v1",
      "session-lease/v1",
      "successor-admission/v1",
      "supervisor-shim/v1",
      "worker-ownership/v1",
    ]);
    expect(new Set(schemaVersions).size).toBe(38);
  });

  test("every authority schema accepts its golden and refuses every missing, extra, malformed, and future field mutant", () => {
    for (const schemaVersion of schemaVersions) {
      const definition = schemaDefinitions[schemaVersion]!;
      const fixture = fixtureFor(schemaVersion);
      expect(parseContract(schemaVersion, fixture), schemaVersion).toEqual({
        ok: true,
        value: fixture,
      });

      for (const [name, rule] of Object.entries(definition.fields)) {
        const missing = { ...fixture } as Record<string, unknown>;
        delete missing[name];
        expect(parseContract(schemaVersion, missing).ok, `${schemaVersion} missing ${name}`).toBe(
          false,
        );
        expect(
          parseContract(schemaVersion, { ...fixture, [name]: invalidFor(rule) }).ok,
          `${schemaVersion} malformed ${name}`,
        ).toBe(false);
      }
      expect(parseContract(schemaVersion, { ...fixture, extraAuthority: digest }).ok).toBe(false);
      expect(
        parseContract(schemaVersion, { ...fixture, schemaVersion: `${schemaVersion}-future` }).ok,
      ).toBe(false);
    }
  });

  test("total parsers refuse hostile non-record inputs without throwing", () => {
    const throwingGetter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile proxy");
        },
      },
    );
    const hostile: unknown[] = [
      undefined,
      null,
      true,
      1,
      "{}",
      [],
      new Date(),
      Object.create({ inherited: true }),
      throwingGetter,
      throwingProxy,
    ];
    for (const schemaVersion of [...schemaVersions, "unknown/v1"]) {
      for (const input of hostile) {
        expect(() => parseContract(schemaVersion, input)).not.toThrow();
        expect(parseContract(schemaVersion, input).ok).toBe(false);
      }
    }
  });

  test("published schema definitions and enum sets are runtime immutable", () => {
    const dispatch = schemaDefinitions["dispatch-plan/v1"]!;
    expect(Object.isFrozen(dispatch)).toBe(true);
    expect(Object.isFrozen(dispatch.fields)).toBe(true);
    expect(Object.isFrozen(dispatch.fields.role)).toBe(true);
    expect(Object.isFrozen(dispatch.fields.role!.values)).toBe(true);
    expect(() => (dispatch.fields.role!.values as string[]).push("admin")).toThrow();
    expect(
      parseContract("dispatch-plan/v1", mutant("dispatch-plan/v1", { role: "admin" })).ok,
    ).toBe(false);
  });
});

describe("canonical exact-byte serialization", () => {
  test("matches the fixed platform-configuration golden bytes", () => {
    const fixture = fixtureFor("platform-configuration/v1");
    const golden =
      '{"adapterId":"alpha","capabilityNames":["read","write"],"leaseFreshnessMs":3600000,"maximumSessionMs":86400000,"projectId":"018f0c24-7a3b-7cc1-8a2f-1234567890ab","schemaVersion":"platform-configuration/v1","stateRoot":"file:///var/lib/orchestration/state","wallClockSkewMs":300000}\n';
    expect(canonicalJson(fixture as JsonValue)).toBe(golden);
    expect(canonicalBytes(fixture as JsonValue)).toEqual(new TextEncoder().encode(golden));
    expect(canonicalDigest(fixture as JsonValue)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("canonical arrays preserve authority order rather than silently sorting it", () => {
    const fixture = mutant("platform-configuration/v1", {
      capabilityNames: ["write", "read"],
    });
    const serialized = serializeContract("platform-configuration/v1", fixture);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) {
      expect(new TextDecoder().decode(serialized.bytes)).toContain(
        '"capabilityNames":["write","read"]',
      );
    }
  });

  test("all schemas serialize deterministically and accept only their exact canonical bytes", () => {
    for (const schemaVersion of schemaVersions) {
      const fixture = fixtureFor(schemaVersion);
      const serialized = serializeContract(schemaVersion, fixture);
      expect(serialized.ok, schemaVersion).toBe(true);
      if (!serialized.ok) continue;
      expect(parseCanonicalContractBytes(schemaVersion, serialized.bytes).ok).toBe(true);
      const text = new TextDecoder().decode(serialized.bytes);
      for (const changed of [
        ` ${text}`,
        text.slice(0, -1),
        text.replace(/\n$/, "\r\n"),
        `\ufeff${text}`,
      ]) {
        expect(
          parseCanonicalContractBytes(schemaVersion, new TextEncoder().encode(changed)).ok,
        ).toBe(false);
      }
    }
    expect(
      parseCanonicalContractBytes("platform-configuration/v1", Uint8Array.from([0xff])).ok,
    ).toBe(false);
  });

  test("pins one exact golden-byte root over every schema fixture", () => {
    const root = createHash("sha256");
    for (const schemaVersion of schemaVersions) {
      const serialized = serializeContract(schemaVersion, fixtureFor(schemaVersion));
      expect(serialized.ok, schemaVersion).toBe(true);
      if (!serialized.ok) continue;
      root.update(schemaVersion);
      root.update(Uint8Array.of(0));
      root.update(serialized.bytes);
    }
    expect(root.digest("hex")).toBe(
      "8e4536e06e88c37790e667228b8278743b3e06b280442b9aff42810731e7430e",
    );
  });

  test("canonical JSON rejects unsafe numeric, cyclic, exotic, and invalid-unicode values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [1.5, -0, Number.MAX_SAFE_INTEGER + 1, cyclic, new Date(), "\ud800"]) {
      expect(() => canonicalJson(value as JsonValue)).toThrow();
    }
  });

  test("byte parsers fail closed on hostile views and parsed arrays are detached immutable snapshots", () => {
    const hostileBytes = new Proxy(new Uint8Array([0x7b]), {
      get() {
        throw new Error("hostile byte view");
      },
    });
    expect(() =>
      parseCanonicalContractBytes("platform-configuration/v1", hostileBytes),
    ).not.toThrow();
    expect(parseCanonicalContractBytes("platform-configuration/v1", hostileBytes).ok).toBe(false);

    const input = mutant("platform-configuration/v1", {
      capabilityNames: ["read", "write"],
    });
    const parsed = parseContract("platform-configuration/v1", input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    (input.capabilityNames as string[])[0] = "changed";
    expect(parsed.value.capabilityNames).toEqual(["read", "write"]);
    expect(Object.isFrozen(parsed.value.capabilityNames)).toBe(true);
  });
});

describe("portable authority guards", () => {
  test("dispatch requires exactly one closed role before ownership", () => {
    for (const role of ["implementation", "review", "observer"]) {
      expect(parseContract("dispatch-plan/v1", mutant("dispatch-plan/v1", { role })).ok).toBe(true);
    }
    for (const role of [undefined, "", "implementer", "admin", ["review", "observer"]]) {
      const value = mutant("dispatch-plan/v1", { role });
      if (role === undefined) delete value.role;
      expect(parseContract("dispatch-plan/v1", value).ok).toBe(false);
    }
  });

  test("contract-relative paths refuse host, drive, traversal, alternate-separator, and URI encodings", () => {
    const pathSchemas = schemaVersions.filter((schemaVersion) =>
      Object.values(schemaDefinitions[schemaVersion]!.fields).some(
        (rule) => rule.kind === "relative-path",
      ),
    );
    for (const schemaVersion of pathSchemas) {
      const [pathName] = Object.entries(schemaDefinitions[schemaVersion]!.fields).find(
        ([, rule]) => rule.kind === "relative-path" && !rule.nullable,
      )!;
      for (const path of [
        "/var/state",
        "C:/state",
        "../state",
        "state\\item",
        "file:///state",
        "state//item",
      ])
        expect(parseContract(schemaVersion, mutant(schemaVersion, { [pathName]: path })).ok).toBe(
          false,
        );
    }
  });

  test("contract-relative paths refuse every C0/C1 control character", () => {
    const controls = [
      ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
      ...Array.from({ length: 33 }, (_, offset) => String.fromCharCode(0x7f + offset)),
    ];
    for (const control of controls) {
      expect(
        parseContract(
          "installed-release/v1",
          mutant("installed-release/v1", { releasePath: `release${control}item` }),
        ).ok,
        `control U+${control.charCodeAt(0).toString(16).padStart(4, "0")}`,
      ).toBe(false);
    }
  });

  test("schema and fixture surfaces contain no consumer-policy or secret-bearing vocabulary", () => {
    const surface = JSON.stringify({ schemaDefinitions, validFixtures }).toLowerCase();
    for (const forbidden of [
      "worktree",
      "milestone",
      "pullrequest",
      "deployment",
      "branchname",
      "labelname",
      "password",
      "privatekey",
      "accesstoken",
      "clientsecret",
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  test("module ABI schemas reject host, provider, policy, and ambient effect fields", () => {
    for (const schemaVersion of [
      "module-descriptor/v1",
      "module-plan-input/v1",
      "module-plan-result/v1",
      "module-action-plan/v1",
      "module-no-action/v1",
    ]) {
      for (const field of [
        "hostPath",
        "providerName",
        "policyDocument",
        "networkClient",
        "clock",
        "credential",
      ])
        expect(parseContract(schemaVersion, mutant(schemaVersion, { [field]: "alpha" })).ok).toBe(
          false,
        );
    }
  });

  test("import receipts bind the exact plan transaction identities", () => {
    const plan = fixtureFor("import-plan/v1");
    const receipt = mutant("import-receipt/v1", {
      transactionId: plan.transactionId,
      exportDigest: plan.exportDigest,
      planDigest: plan.planDigest,
      targetProjectId: plan.targetProjectId,
    }) as ContractRecord;
    expect(validateImportReceiptAgainstPlan(plan, receipt)).toEqual([]);
    for (const name of ["transactionId", "exportDigest", "planDigest", "targetProjectId"]) {
      const changed = name === "transactionId" || name === "targetProjectId" ? uuid2 : digest2;
      expect(
        validateImportReceiptAgainstPlan(plan, { ...receipt, [name]: changed } as ContractRecord),
      ).toContain(`${name}:transaction-binding-mismatch`);
    }
  });
});

describe("activation, recovery, and cleanup authority", () => {
  test("every recovery and cleanup family uses the authoritative transaction/state-derived path", () => {
    expect(recoveryFenceRootPath(uuid)).toBe(
      `installation/activation-recovery-fence-roots/${uuid}.json`,
    );
    expect(recoveryFenceHeadPath(uuid, 3, "POST_ACTIVATION")).toBe(
      `installation/activation-recovery-fence-history/${uuid}/3-POST_ACTIVATION.json`,
    );
    expect(recoveryLaunchPath(uuid, "recovery-fence-v1", 2, 4, "LIVE")).toBe(
      `installation/activation-recovery-launches/${uuid}/recovery-fence-v1/2/4-LIVE.json`,
    );
    expect(cleanupGateRootPath(uuid)).toBe(
      `installation/activation-cleanup-gate-roots/${uuid}.json`,
    );
    expect(cleanupGateHeadPath(uuid, 5, "ABORTING", "PUBLISHED")).toBe(
      `installation/activation-cleanup-gate-history/${uuid}/5-ABORTING-PUBLISHED.json`,
    );
    expect(cleanupGateArchivePath(uuid)).toBe(`installation/activation-cleanup-gates/${uuid}.json`);
    expect(recoveryAuthorizationPath(uuid)).toBe(
      `installation/recovery-authorizations/${uuid}.json`,
    );
    expect(recoveryFenceCurrentPath).toBe("installation/activation-recovery-fence.json");
    expect(recoveryLaunchCurrentPath).toBe("installation/activation-recovery-launch.json");
    expect(cleanupGateCurrentPath).toBe("installation/activation-cleanup-gate.json");
    expect(cleanupHeadCurrentPath).toBe("installation/activation-cleanup-head.json");

    for (const schemaVersion of [
      "activation-recovery-fence-root/v1",
      "activation-recovery-fence-head/v1",
      "activation-recovery-fence-current/v1",
      "activation-recovery-launch/v1",
      "activation-recovery-launch-current/v1",
      "activation-recovery-launch-archive/v1",
      "recovery-authorization/v1",
      "activation-cleanup-gate-root/v1",
      "activation-cleanup-gate-head/v1",
      "activation-cleanup-gate-current/v1",
      "activation-cleanup-gate-archive/v1",
      "activation-cleanup-head/v1",
    ]) {
      expect(
        parseContract(
          schemaVersion,
          mutant(schemaVersion, { recordPath: "installation/moved.json" }),
        ).ok,
        `${schemaVersion} moved path`,
      ).toBe(false);
    }

    for (const [schemaVersion, changes] of [
      ["activation-recovery-fence-head/v1", { lifecycle: "POST_ACTIVATION" }],
      ["activation-recovery-fence-current/v1", { headLifecycle: "POST_ACTIVATION" }],
      ["activation-recovery-launch/v1", { lifecycle: "LIVE" }],
      ["activation-recovery-launch-current/v1", { launchLifecycle: "LIVE" }],
      ["activation-cleanup-gate-head/v1", { publication: "PUBLISHING" }],
      ["activation-cleanup-gate-current/v1", { headPublication: "PUBLISHING" }],
    ] as const) {
      expect(parseContract(schemaVersion, mutant(schemaVersion, changes)).ok).toBe(false);
    }
  });

  test("successor and fence generations are adjacent and immutable paths are exact", () => {
    expect(
      parseContract(
        "pending-successor/v1",
        mutant("pending-successor/v1", { successorGeneration: 2 }),
      ).ok,
    ).toBe(false);
    expect(
      parseContract(
        "activation-recovery-fence-root/v1",
        mutant("activation-recovery-fence-root/v1", { recordPath: "installation/other/root.json" }),
      ).ok,
    ).toBe(false);
    expect(
      parseContract(
        "activation-recovery-fence-head/v1",
        mutant("activation-recovery-fence-head/v1", {
          ordinal: 1,
          recordPath: recoveryFenceHeadPath(uuid, 1, "PREPARED"),
          previousHeadDigest: null,
        }),
      ).ok,
    ).toBe(false);

    expect(Object.keys(schemaDefinitions["activation-recovery-fence-root/v1"]!.fields)).toEqual(
      expect.arrayContaining([
        "predecessorOperationManifestDigest",
        "successorOperationManifestDigest",
      ]),
    );
    expect(schemaDefinitions["activation-recovery-fence-root/v1"]!.fields).not.toHaveProperty(
      "operationManifestDigest",
    );
    expect(
      parseContract(
        "activation-recovery-fence-root/v1",
        mutant("activation-recovery-fence-root/v1", {
          operationManifestDigest: digest,
          predecessorOperationManifestDigest: digest,
          successorOperationManifestDigest: digest2,
        }),
      ).ok,
    ).toBe(false);
  });

  test("each fence transaction creates ordinal-zero current authority by CAS from absence", () => {
    const laterGenerationInitial = mutant("activation-recovery-fence-current/v1", {
      generation: 7,
      headOrdinal: 0,
      expectedPointerDigest: null,
    });
    expect(parseContract("activation-recovery-fence-current/v1", laterGenerationInitial).ok).toBe(
      true,
    );
    expect(
      parseContract("activation-recovery-fence-current/v1", {
        ...laterGenerationInitial,
        expectedPointerDigest: digest,
      }).ok,
    ).toBe(false);
    expect(
      parseContract(
        "activation-recovery-fence-current/v1",
        mutant("activation-recovery-fence-current/v1", {
          generation: 7,
          headOrdinal: 1,
          headPath: recoveryFenceHeadPath(uuid, 1, "PREPARED"),
          expectedPointerDigest: null,
        }),
      ).ok,
    ).toBe(false);
  });

  test("recovery launch source/token/path and conditional authority are closed", () => {
    for (const changes of [
      { sourcePathToken: "cleanup-gate-pre-fence-v1" },
      { recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 1, "READY") },
      { fenceHeadDigest: null },
      { gateRootDigest: null },
      { lifecycle: "LIVE", processTreeDigest: null },
      { lifecycle: "TERMINAL_COMPLETE", terminalAt: null },
      { lifecycle: "TERMINAL_HANDOFF" },
      { transitionKind: "AUTHORITY_REBIND", authorityAdvance: null },
    ]) {
      expect(
        parseContract(
          "activation-recovery-launch/v1",
          mutant("activation-recovery-launch/v1", changes),
        ).ok,
      ).toBe(false);
    }
    const preFence = mutant("activation-recovery-launch/v1", {
      source: "cleanup-gate-pre-fence/v1",
      sourcePathToken: "cleanup-gate-pre-fence-v1",
      ordinal: 1,
      previousStateRecordDigest: digest2,
      priorPointerDigest: digest2,
      recordPath: recoveryLaunchPath(uuid, "cleanup-gate-pre-fence-v1", 0, 1, "TERMINAL_HANDOFF"),
      fenceRootPath: recoveryFenceRootPath(uuid),
      fenceRootDigest: null,
      fenceHeadOrdinal: null,
      fenceHeadDigest: null,
      gateRootPath: cleanupGateRootPath(uuid),
      gateRootDigest: digest,
      gateHeadOrdinal: 0,
      gateHeadDigest: digest,
      gateLifecycle: "PENDING",
      gatePublication: "PUBLISHED",
      lifecycle: "TERMINAL_HANDOFF",
      terminalAt: later,
    });
    expect(parseContract("activation-recovery-launch/v1", preFence).ok).toBe(true);
    expect(
      parseContract("activation-recovery-launch/v1", {
        ...preFence,
        gateLifecycle: "ABORTING",
      }).ok,
    ).toBe(false);
    expect(
      parseContract("activation-recovery-launch/v1", {
        ...preFence,
        lifecycle: "TERMINAL_ABORTED",
        recordPath: recoveryLaunchPath(uuid, "cleanup-gate-pre-fence-v1", 0, 1, "TERMINAL_ABORTED"),
        gateLifecycle: "ABORTING",
      }).ok,
    ).toBe(true);
  });

  test("authorization and cleanup discriminators refuse partial authority", () => {
    expect(
      parseContract(
        "recovery-authorization/v1",
        mutant("recovery-authorization/v1", { lifecycle: "CONSUMED_BOUND" }),
      ).ok,
    ).toBe(false);
    expect(
      parseContract(
        "activation-cleanup-gate-head/v1",
        mutant("activation-cleanup-gate-head/v1", { lifecycle: "ABORTING" }),
      ).ok,
    ).toBe(false);
    expect(
      parseContract(
        "activation-cleanup-gate-head/v1",
        mutant("activation-cleanup-gate-head/v1", { publication: "PUBLISHED" }),
      ).ok,
    ).toBe(false);

    const successorAuthorization = successorAuthorizationFixture();
    expect(parseContract("recovery-authorization/v1", successorAuthorization).ok).toBe(true);
    for (const changes of [
      { successorBrokerGeneration: 2 },
      { expiresAt: later },
      { gateRootDigest: null },
      { fenceRootDigest: null },
      { bootstrapGrantDigest: digest },
    ]) {
      expect(
        parseContract("recovery-authorization/v1", {
          ...successorAuthorization,
          ...changes,
        }).ok,
      ).toBe(false);
    }
    expect(
      parseContract("recovery-authorization/v1", {
        ...successorAuthorization,
        recoveryLaunchSource: "recovery-fence/v1",
      }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization/v1", {
        ...successorAuthorization,
        recoveryLaunchSource: "recovery-fence/v1",
        recoveryLaunchGeneration: 0,
        recoveryLaunchAttempt: 1,
        recoveryReadyRecordDigest: digest,
        recoveryInitialLiveRecordDigest: digest,
        recoveryGateRootDigest: digest,
        recoveryFenceRootDigest: digest2,
      }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization/v1", {
        ...successorAuthorization,
        recoveryLaunchSource: "recovery-fence/v1",
        recoveryLaunchGeneration: 0,
        recoveryLaunchAttempt: 1,
        recoveryReadyRecordDigest: digest,
        recoveryInitialLiveRecordDigest: digest,
        recoveryGateRootDigest: digest,
        recoveryFenceRootDigest: digest,
      }).ok,
    ).toBe(true);

    const promotionGate = mutant("activation-cleanup-gate-root/v1", {
      mode: "PROMOTION",
      expectedActiveGeneration: 1,
      expectedActiveRecordDigest: digest,
      expectedFenceRootPath: recoveryFenceRootPath(uuid),
      expectedFenceRootDigest: digest,
      priorCleanupHeadDigest: digest,
    });
    expect(parseContract("activation-cleanup-gate-root/v1", promotionGate).ok).toBe(true);
    expect(
      parseContract("activation-cleanup-gate-root/v1", {
        ...promotionGate,
        expectedFenceRootPath: recoveryFenceRootPath(uuid2),
      }).ok,
    ).toBe(false);
    expect(
      parseContract("activation-cleanup-gate-root/v1", {
        ...promotionGate,
        priorCleanupHeadDigest: null,
      }).ok,
    ).toBe(false);
  });

  test("launch archives bind one ordered source-specific state chain and its exact terminal", () => {
    const fixture = fixtureFor("activation-recovery-launch-archive/v1");
    for (const changes of [
      { launchCount: 2 },
      { generationCount: 2 },
      { transitionCount: 1 },
      { terminalLaunchDigest: digest2 },
      { terminalLifecycle: "TERMINAL_ABORTED" },
      {
        stateRecordPaths: [
          recoveryLaunchPath(uuid, "recovery-fence-v1", 1, 0, "TERMINAL_COMPLETE"),
        ],
      },
      {
        stateRecordPaths: [
          recoveryLaunchPath(uuid2, "recovery-fence-v1", 0, 0, "TERMINAL_COMPLETE"),
        ],
      },
    ]) {
      expect(
        parseContract("activation-recovery-launch-archive/v1", { ...fixture, ...changes }).ok,
      ).toBe(false);
    }

    const twoRecordChain = {
      ...fixture,
      launchCount: 2,
      transitionCount: 1,
      stateRecordPaths: [
        recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 0, "LIVE"),
        recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 1, "TERMINAL_COMPLETE"),
      ],
      stateRecordDigests: [digest2, digest],
    };
    expect(parseContract("activation-recovery-launch-archive/v1", twoRecordChain).ok).toBe(true);
    expect(
      parseContract("activation-recovery-launch-archive/v1", {
        ...twoRecordChain,
        stateRecordPaths: [...twoRecordChain.stateRecordPaths].reverse(),
      }).ok,
    ).toBe(false);
  });

  test("cleanup initialization and archive outcomes are exact closed unions", () => {
    expect(
      parseContract(
        "activation-cleanup-gate-head/v1",
        mutant("activation-cleanup-gate-head/v1", {
          lifecycle: "ACTIVATING",
          publication: "PUBLISHED",
          fenceDigest: digest,
          recordPath: cleanupGateHeadPath(uuid, 0, "ACTIVATING", "PUBLISHED"),
        }),
      ).ok,
    ).toBe(false);

    const activated = fixtureFor("activation-cleanup-gate-archive/v1");
    expect(parseContract("activation-cleanup-gate-archive/v1", activated).ok).toBe(true);
    expect(
      parseContract("activation-cleanup-gate-archive/v1", {
        ...activated,
        abortProofDigest: digest,
      }).ok,
    ).toBe(false);
    const aborted = {
      ...activated,
      outcome: "ABORTED",
      terminalProofDigest: null,
      abortProofDigest: digest,
    };
    expect(parseContract("activation-cleanup-gate-archive/v1", aborted).ok).toBe(true);
    for (const changes of [{ terminalProofDigest: digest }, { abortProofDigest: null }]) {
      expect(
        parseContract("activation-cleanup-gate-archive/v1", { ...aborted, ...changes }).ok,
      ).toBe(false);
    }
  });

  test("successor recovery attachment binds one exact READY to LIVE chain and current pointer", () => {
    const ready = fixtureFor("activation-recovery-launch/v1");
    const readyDigest = canonicalDigest(ready as JsonValue);
    const priorPointerDigest = digest2;
    const live = mutant("activation-recovery-launch/v1", {
      ordinal: 1,
      previousStateRecordDigest: readyDigest,
      priorPointerDigest,
      lifecycle: "LIVE",
      recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 1, "LIVE"),
      processTreeDigest: digest,
      startedAt: instant,
      heartbeatAt: instant,
    }) as ContractRecord;
    const liveDigest = canonicalDigest(live as JsonValue);
    const current = mutant("activation-recovery-launch-current/v1", {
      expectedPointerDigest: priorPointerDigest,
      launchDigest: liveDigest,
      launchLifecycle: "LIVE",
      launchOrdinal: 1,
      launchPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 1, "LIVE"),
    }) as ContractRecord;
    const authorization = successorAuthorizationFixture({
      recoveryLaunchSource: "recovery-fence/v1",
      recoveryLaunchGeneration: 0,
      recoveryLaunchAttempt: 1,
      recoveryReadyRecordDigest: readyDigest,
      recoveryInitialLiveRecordDigest: liveDigest,
      recoveryGateRootDigest: digest,
      recoveryFenceRootDigest: digest,
    }) as ContractRecord;
    expect(parseContract("activation-recovery-launch/v1", live).ok).toBe(true);
    expect(parseContract("activation-recovery-launch-current/v1", current).ok).toBe(true);
    expect(parseContract("recovery-authorization/v1", authorization).ok).toBe(true);
    expect(
      validateRecoveryAuthorizationAttachment(
        authorization,
        ready,
        live,
        current,
        readyDigest,
        liveDigest,
      ),
    ).toEqual([]);
    for (const changed of [
      { authorization: { ...authorization, recoveryLaunchGeneration: 1 } as ContractRecord },
      { authorization: { ...authorization, recoveryLaunchAttempt: 2 } as ContractRecord },
      { live: { ...live, attempt: 2 } as ContractRecord },
      { current: { ...current, launchOrdinal: 2 } as ContractRecord },
      { current: { ...current, gateRootDigest: digest2 } as ContractRecord },
    ] as Array<{
      authorization?: ContractRecord;
      live?: ContractRecord;
      current?: ContractRecord;
    }>) {
      expect(
        validateRecoveryAuthorizationAttachment(
          changed.authorization ?? authorization,
          ready,
          changed.live ?? live,
          changed.current ?? current,
          readyDigest,
          liveDigest,
        ),
      ).not.toEqual([]);
    }
  });

  test("cross-record transitions bind adjacent ordinals, prior digests, immutable roots, and one authority advance", () => {
    const ready = fixtureFor("activation-recovery-launch/v1");
    const readyDigest = canonicalDigest(ready as JsonValue);
    const live = mutant("activation-recovery-launch/v1", {
      ordinal: 1,
      previousStateRecordDigest: readyDigest,
      priorPointerDigest: digest2,
      recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 1, "LIVE"),
      lifecycle: "LIVE",
      processTreeDigest: digest,
      startedAt: instant,
      heartbeatAt: instant,
    }) as ContractRecord;
    expect(parseContract("activation-recovery-launch/v1", live).ok).toBe(true);
    expect(validateRecoveryLaunchTransition(ready, live, readyDigest, digest2)).toEqual([]);

    const liveDigest = canonicalDigest(live as JsonValue);
    const livePointerDigest = "c".repeat(64);
    const rebound = {
      ...live,
      ordinal: 2,
      previousStateRecordDigest: liveDigest,
      priorPointerDigest: livePointerDigest,
      recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 2, "LIVE"),
      transitionKind: "AUTHORITY_REBIND",
      authorityAdvance: "FENCE",
      fenceHeadOrdinal: 1,
      fenceHeadDigest: "d".repeat(64),
    } as ContractRecord;
    expect(validateRecoveryLaunchTransition(live, rebound, liveDigest, livePointerDigest)).toEqual(
      [],
    );
    expect(
      validateRecoveryLaunchTransition(
        live,
        { ...rebound, gateHeadDigest: "e".repeat(64) } as ContractRecord,
        liveDigest,
        livePointerDigest,
      ),
    ).toContain("gateHeadDigest:also-advanced");
    expect(
      validateRecoveryAuthorityAlignment(rebound, {
        gateHeadDigest: digest,
        gateHeadOrdinal: 0,
        fenceHeadDigest: "e".repeat(64),
        fenceHeadOrdinal: 1,
      }),
    ).toContain("fenceHeadDigest:launch-behind");
    expect(
      validateRecoveryAuthorityAlignment(rebound, {
        gateHeadDigest: digest,
        gateHeadOrdinal: 1,
        fenceHeadDigest: "d".repeat(64),
        fenceHeadOrdinal: 2,
      }),
    ).toEqual(
      expect.arrayContaining(["gateHeadOrdinal:launch-behind", "fenceHeadOrdinal:launch-behind"]),
    );

    const fence0 = fixtureFor("activation-recovery-fence-head/v1");
    const fenceDigest = canonicalDigest(fence0 as JsonValue);
    const fence1 = mutant("activation-recovery-fence-head/v1", {
      ordinal: 1,
      previousHeadDigest: fenceDigest,
      recordPath: recoveryFenceHeadPath(uuid, 1, "POST_ACTIVATION"),
      lifecycle: "POST_ACTIVATION",
      activeGeneration: 1,
    }) as ContractRecord;
    expect(validateFenceHeadTransition(fence0, fence1, fenceDigest)).toEqual([]);
    expect(
      validateFenceHeadTransition(fence0, { ...fence1, ordinal: 2 } as ContractRecord, fenceDigest),
    ).toContain("ordinal:not-adjacent");

    const cleanup0 = fixtureFor("activation-cleanup-gate-head/v1");
    const cleanupDigest = canonicalDigest(cleanup0 as JsonValue);
    const cleanup1 = mutant("activation-cleanup-gate-head/v1", {
      ordinal: 1,
      previousHeadDigest: cleanupDigest,
      recordPath: cleanupGateHeadPath(uuid, 1, "PENDING", "PUBLISHING"),
      lifecycle: "PENDING",
      publication: "PUBLISHING",
    }) as ContractRecord;
    expect(parseContract("activation-cleanup-gate-head/v1", cleanup1).ok).toBe(true);
    expect(validateCleanupHeadTransition(cleanup0, cleanup1, cleanupDigest)).toEqual([]);
    const cleanup1Digest = canonicalDigest(cleanup1 as JsonValue);
    const aborting = {
      ...cleanup1,
      ordinal: 2,
      previousHeadDigest: cleanup1Digest,
      recordPath: cleanupGateHeadPath(uuid, 2, "ABORTING", "PUBLISHING"),
      lifecycle: "ABORTING",
      abortRevocationReceiptDigest: digest,
    } as ContractRecord;
    expect(parseContract("activation-cleanup-gate-head/v1", aborting).ok).toBe(true);
    expect(validateCleanupHeadTransition(cleanup1, aborting, cleanup1Digest)).toEqual([]);
    expect(
      validateCleanupHeadTransition(
        cleanup0,
        { ...cleanup1, lifecycle: "ACTIVATING" } as ContractRecord,
        cleanupDigest,
      ),
    ).toContain("publication:activation-requires-published");
  });

  test("current pointers bind the exact immutable root and state-derived head", () => {
    const fenceRoot = fixtureFor("activation-recovery-fence-root/v1");
    const fenceRootDigest = canonicalDigest(fenceRoot as JsonValue);
    const fenceHead = mutant("activation-recovery-fence-head/v1", {
      rootDigest: fenceRootDigest,
    }) as ContractRecord;
    const fenceHeadDigest = canonicalDigest(fenceHead as JsonValue);
    const fenceCurrent = mutant("activation-recovery-fence-current/v1", {
      rootDigest: fenceRootDigest,
      headDigest: fenceHeadDigest,
    }) as ContractRecord;
    expect(
      validateFenceAuthorityBinding(
        fenceRoot,
        fenceHead,
        fenceCurrent,
        fenceRootDigest,
        fenceHeadDigest,
      ),
    ).toEqual([]);
    expect(
      validateFenceAuthorityBinding(
        fenceRoot,
        fenceHead,
        { ...fenceCurrent, headDigest: digest2 } as ContractRecord,
        fenceRootDigest,
        fenceHeadDigest,
      ),
    ).toContain("headDigest:binding-mismatch");

    const gateRoot = fixtureFor("activation-cleanup-gate-root/v1");
    const gateRootDigest = canonicalDigest(gateRoot as JsonValue);
    const gateHead = mutant("activation-cleanup-gate-head/v1", {
      rootDigest: gateRootDigest,
    }) as ContractRecord;
    const gateHeadDigest = canonicalDigest(gateHead as JsonValue);
    const gateCurrent = mutant("activation-cleanup-gate-current/v1", {
      rootDigest: gateRootDigest,
      headDigest: gateHeadDigest,
    }) as ContractRecord;
    expect(
      validateCleanupAuthorityBinding(
        gateRoot,
        gateHead,
        gateCurrent,
        gateRootDigest,
        gateHeadDigest,
      ),
    ).toEqual([]);
    expect(
      validateCleanupAuthorityBinding(
        gateRoot,
        { ...gateHead, activeRecordDigest: digest2 } as ContractRecord,
        gateCurrent,
        gateRootDigest,
        gateHeadDigest,
      ),
    ).toContain("activeRecordDigest:root-mismatch");
  });

  test("retry advances exactly one generation, resets its ordinal, and retains both prior digests", () => {
    const retryable = mutant("activation-recovery-launch/v1", {
      lifecycle: "TERMINAL_RETRYABLE",
      ordinal: 2,
      previousStateRecordDigest: digest2,
      priorPointerDigest: digest2,
      recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 0, 2, "TERMINAL_RETRYABLE"),
      terminalAt: later,
    }) as ContractRecord;
    const retryableDigest = canonicalDigest(retryable as JsonValue);
    const pointerDigest = "c".repeat(64);
    const nextReady = mutant("activation-recovery-launch/v1", {
      attempt: 2,
      generation: 1,
      ordinal: 0,
      previousStateRecordDigest: retryableDigest,
      priorPointerDigest: pointerDigest,
      recordPath: recoveryLaunchPath(uuid, "recovery-fence-v1", 1, 0, "READY"),
    }) as ContractRecord;
    expect(parseContract("activation-recovery-launch/v1", retryable).ok).toBe(true);
    expect(parseContract("activation-recovery-launch/v1", nextReady).ok).toBe(true);
    expect(
      validateRecoveryLaunchTransition(retryable, nextReady, retryableDigest, pointerDigest),
    ).toEqual([]);
    expect(
      validateRecoveryLaunchTransition(
        retryable,
        { ...nextReady, generation: 2 } as ContractRecord,
        retryableDigest,
        pointerDigest,
      ),
    ).toContain("generation:retry-not-adjacent");
    expect(
      validateRecoveryLaunchTransition(
        retryable,
        { ...nextReady, ordinal: 1 } as ContractRecord,
        retryableDigest,
        pointerDigest,
      ),
    ).toContain("ordinal:retry-must-reset");
  });

  test("a published pre-fence LIVE chain may hand off, while process identity cannot move", () => {
    const live = mutant("activation-recovery-launch/v1", {
      source: "cleanup-gate-pre-fence/v1",
      sourcePathToken: "cleanup-gate-pre-fence-v1",
      generation: 0,
      ordinal: 1,
      previousStateRecordDigest: digest2,
      priorPointerDigest: digest2,
      recordPath: recoveryLaunchPath(uuid, "cleanup-gate-pre-fence-v1", 0, 1, "LIVE"),
      fenceRootDigest: null,
      fenceHeadOrdinal: null,
      fenceHeadDigest: null,
      gatePublication: "PUBLISHED",
      lifecycle: "LIVE",
      processTreeDigest: digest,
      startedAt: instant,
      heartbeatAt: instant,
    }) as ContractRecord;
    const liveDigest = canonicalDigest(live as JsonValue);
    const pointerDigest = "c".repeat(64);
    const handoff = {
      ...live,
      ordinal: 2,
      previousStateRecordDigest: liveDigest,
      priorPointerDigest: pointerDigest,
      recordPath: recoveryLaunchPath(uuid, "cleanup-gate-pre-fence-v1", 0, 2, "TERMINAL_HANDOFF"),
      lifecycle: "TERMINAL_HANDOFF",
      terminalAt: later,
    } as ContractRecord;
    expect(parseContract("activation-recovery-launch/v1", live).ok).toBe(true);
    expect(parseContract("activation-recovery-launch/v1", handoff).ok).toBe(true);
    expect(validateRecoveryLaunchTransition(live, handoff, liveDigest, pointerDigest)).toEqual([]);
    expect(
      validateRecoveryLaunchTransition(
        live,
        { ...handoff, processTreeDigest: digest2 } as ContractRecord,
        liveDigest,
        pointerDigest,
      ),
    ).toContain("processTreeDigest:changed");
  });

  test("initialization reducer accepts only resumable exact prefixes", () => {
    expect(
      reduceInitializationCensus({ root: false, heads: [], current: false, extraHistory: false }),
    ).toBe("ALL_ABSENT");
    expect(
      reduceInitializationCensus({ root: true, heads: [], current: false, extraHistory: false }),
    ).toBe("ROOT_ONLY");
    expect(
      reduceInitializationCensus({
        root: true,
        heads: [{ ordinal: 0, previousHeadDigest: null }],
        current: false,
        extraHistory: false,
      }),
    ).toBe("ROOT_AND_INITIAL_HEAD");
    expect(
      reduceInitializationCensus({
        root: true,
        heads: [{ ordinal: 0, previousHeadDigest: null }],
        current: true,
        extraHistory: false,
      }),
    ).toBe("FULLY_CURRENT");
    for (const census of [
      {
        root: false,
        heads: [{ ordinal: 0, previousHeadDigest: null }],
        current: false,
        extraHistory: false,
      },
      { root: true, heads: [], current: true, extraHistory: false },
      {
        root: true,
        heads: [{ ordinal: 0, previousHeadDigest: digest }],
        current: false,
        extraHistory: false,
      },
      {
        root: true,
        heads: [{ ordinal: 0, previousHeadDigest: null }],
        current: false,
        extraHistory: true,
      },
    ])
      expect(reduceInitializationCensus(census)).toBe("UNKNOWN");
  });
});

describe("protection and verifier roots", () => {
  test("protection receipt binds pre-run anchor provenance and seven-day freshness", () => {
    for (const changes of [
      { verifierAnchorVariableName: "OTHER" },
      { expiresAt: "2026-08-24T12:34:56.789Z" },
      { repositoryId: 1 },
      { rulesetId: "01" },
      { producerRunId: Number.MAX_SAFE_INTEGER + 1 },
      { verifierAnchorDigest: digest2 },
      { verifierAnchorVariableUpdatedAt: later },
      { producerStartedAt: later },
      { verifierVersion: "2.94.0" },
      { apiVersion: "latest" },
      { protectedEnvironmentName: "other" },
    ])
      expect(
        parseContract(
          "repository-protection-receipt/v1",
          mutant("repository-protection-receipt/v1", changes),
        ).ok,
      ).toBe(false);
    for (const forbiddenField of ["artifactId", "archiveDigest"])
      expect(
        parseContract(
          "repository-protection-receipt/v1",
          mutant("repository-protection-receipt/v1", { [forbiddenField]: digest }),
        ).ok,
      ).toBe(false);
    expect(
      parseContract(
        "repository-protection-receipt/v1",
        mutant("repository-protection-receipt/v1", { apiPageCount: 2 }),
      ).ok,
    ).toBe(false);
  });

  test("verifier anchor refuses candidate/custom-root authority", () => {
    for (const field of ["customRootDigest", "candidateTrustDigest", "combinedBundleDigest"])
      expect(
        parseContract(
          "bootstrap-verifier-anchor/v1",
          mutant("bootstrap-verifier-anchor/v1", { [field]: digest }),
        ).ok,
      ).toBe(false);
    expect(
      parseContract(
        "bootstrap-verifier-anchor/v1",
        mutant("bootstrap-verifier-anchor/v1", { verifierVersion: "2.94.0" }),
      ).ok,
    ).toBe(false);
  });

  test("timestamp and numeric authority are exact", () => {
    expect(
      parseContract(
        "session-lease/v1",
        mutant("session-lease/v1", { acquiredAt: instant, expiresAt: instant }),
      ).ok,
    ).toBe(false);
    expect(
      parseContract(
        "repository-protection-receipt/v1",
        mutant("repository-protection-receipt/v1", {
          producerRunId: "9007199254740993",
          issuedAt: instant,
          expiresAt: later,
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("declared capability ownership", () => {
  const root = resolve(import.meta.dirname, "../..");

  test("the two exact ISS-002 slots own only the declared commands", async () => {
    await expect(
      regularCapabilitySlot(root, "ISS-002", "@orchestration-platform/contracts:test"),
    ).resolves.toBe(
      resolve(
        root,
        "test/capability-slots/ISS-002/%40orchestration-platform%2Fcontracts%3Atest.mjs",
      ),
    );
    await expect(
      regularCapabilitySlot(root, "ISS-002", "contracts:compatibility-check"),
    ).resolves.toBe(
      resolve(root, "test/capability-slots/ISS-002/contracts%3Acompatibility-check.mjs"),
    );
    await expect(
      regularCapabilitySlot(root, "ISS-002", "contracts:extra"),
    ).resolves.toBeUndefined();
  });
});

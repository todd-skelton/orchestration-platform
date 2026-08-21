import { describe, expect, test } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  computeCleanupGateRootDigest,
  computeCleanupGateValuePositionDigest,
  computeMutationId,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeRecoveryFenceRootDigest,
  computeRecoveryFenceValuePositionDigest,
  gateFenceSchemaFields,
  gateFenceSchemaVersions,
  parseCanonicalContractBytes,
  parseCleanupGateHead,
  parseCleanupGateRoot,
  parseCleanupGateValuePosition,
  parseContract,
  parseRecoveryFenceHead,
  parseRecoveryFenceRoot,
  parseRecoveryFenceValuePosition,
  schemaVersions,
  validateCleanupHeadHistory,
  validateFenceHeadHistory,
} from "../../packages/contracts/src/index.js";

const d = (character: string): string => character.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abd";
const transactionId = "018f0f4d-7b2d-7a11-8a2b-123456789abe";
const pathInstanceDigest = d("a");
const createdAt = "2026-08-20T12:00:00.000Z";

const bootstrapGateRoot = Object.freeze({
  authorizationCoreDigest: d("0"),
  authorizationCreatedReceiptDigest: d("1"),
  authorizationCreatedTipDigest: d("2"),
  authorizationCreatedValueDigest: d("3"),
  candidateActiveReleaseValueDigest: d("4"),
  cleanupArchivePredecessorReceiptDigest: null,
  cleanupArchivePredecessorTipDigest: null,
  cleanupArchivePredecessorValueDigest: null,
  createdAt,
  installationId,
  mode: "BOOTSTRAP",
  predecessorActiveReleaseReceiptDigest: null,
  predecessorActiveReleaseTipDigest: null,
  predecessorActiveReleaseValueDigest: null,
  projectId,
  recoveryFenceRootDigest: null,
  schemaVersion: "activation-cleanup-gate-root/v1",
  stateRootDigest: d("5"),
  successorCoreDigest: d("6"),
  transactionId,
});

const successorGateRoot = Object.freeze({
  ...bootstrapGateRoot,
  cleanupArchivePredecessorReceiptDigest: d("7"),
  cleanupArchivePredecessorTipDigest: d("8"),
  cleanupArchivePredecessorValueDigest: d("9"),
  mode: "SUCCESSOR",
  predecessorActiveReleaseReceiptDigest: d("a"),
  predecessorActiveReleaseTipDigest: d("b"),
  predecessorActiveReleaseValueDigest: d("c"),
  recoveryFenceRootDigest: d("d"),
});

const fenceRoot = Object.freeze({
  candidateActiveReleaseValueDigest: d("0"),
  candidateBrokerAdmissionDigest: d("1"),
  cleanupArchivePredecessorReceiptDigest: d("2"),
  cleanupArchivePredecessorTipDigest: d("3"),
  cleanupArchivePredecessorValueDigest: d("4"),
  createdAt,
  installationId,
  predecessorActiveReleaseReceiptDigest: d("5"),
  predecessorActiveReleaseTipDigest: d("6"),
  predecessorActiveReleaseValueDigest: d("7"),
  predecessorBrokerGeneration: "41",
  projectId,
  schemaVersion: "activation-recovery-fence-root/v1",
  stateRootDigest: d("8"),
  successorBrokerGeneration: "42",
  successorCoreDigest: d("9"),
  transactionId,
});

type GatePair = readonly [
  "PENDING" | "ACTIVATING" | "ABORTING" | "COMPLETE",
  "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "CLEARED",
];

function gateHistory(pairs: readonly GatePair[], root = bootstrapGateRoot): readonly object[] {
  const rootDigest = computeCleanupGateRootDigest(root);
  let priorHeadValueDigest: string | null = null;
  return pairs.map(([lifecycle, publication], index) => {
    const head = Object.freeze({
      lifecycle,
      ordinal: String(index),
      priorHeadValueDigest,
      publication,
      recordedAt: `2026-08-20T12:00:0${index}.000Z`,
      rootDigest,
      schemaVersion: "activation-cleanup-gate-head/v1",
    });
    priorHeadValueDigest = computePointerValueDigest(
      "ACTIVATION_CLEANUP_GATE",
      pathInstanceDigest,
      head,
    );
    return head;
  });
}

function fenceHistory(): readonly object[] {
  const rootDigest = computeRecoveryFenceRootDigest(fenceRoot);
  const first = Object.freeze({
    ordinal: "0",
    priorHeadValueDigest: null,
    recordedAt: createdAt,
    rootDigest,
    schemaVersion: "activation-recovery-fence-head/v1",
    state: "PREPARED",
  });
  const second = Object.freeze({
    ordinal: "1",
    priorHeadValueDigest: computePointerValueDigest(
      "ACTIVATION_RECOVERY_FENCE",
      pathInstanceDigest,
      first,
    ),
    recordedAt: createdAt,
    rootDigest,
    schemaVersion: "activation-recovery-fence-head/v1",
    state: "POST_ACTIVATION",
  });
  return Object.freeze([first, second]);
}

function relinkHistory(
  kind: "ACTIVATION_CLEANUP_GATE" | "ACTIVATION_RECOVERY_FENCE",
  history: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  let priorHeadValueDigest: string | null = null;
  return history.map((input, index) => {
    const head = Object.freeze({
      ...input,
      ordinal: String(index),
      priorHeadValueDigest,
    });
    priorHeadValueDigest = computePointerValueDigest(kind, pathInstanceDigest, head);
    return head;
  });
}

function reorderedCanonicalBytes(record: Readonly<Record<string, unknown>>): Uint8Array {
  const reversed = Object.fromEntries(Object.entries(record).reverse());
  return new TextEncoder().encode(`${JSON.stringify(reversed)}\n`);
}

describe("cleanup-gate and recovery-fence literal schemas", () => {
  const schemas = [
    ["activation-cleanup-gate-root/v1", bootstrapGateRoot, gateFenceSchemaFields.cleanupGateRoot],
    [
      "activation-cleanup-gate-head/v1",
      gateHistory([["PENDING", "NOT_PUBLISHED"]])[0]!,
      gateFenceSchemaFields.cleanupGateHead,
    ],
    ["activation-recovery-fence-root/v1", fenceRoot, gateFenceSchemaFields.recoveryFenceRoot],
    [
      "activation-recovery-fence-head/v1",
      fenceHistory()[0]!,
      gateFenceSchemaFields.recoveryFenceHead,
    ],
  ] as const;

  test("registers exactly four current schema versions with literal canonical censuses", () => {
    expect(gateFenceSchemaVersions).toEqual([
      "activation-cleanup-gate-head/v1",
      "activation-cleanup-gate-root/v1",
      "activation-recovery-fence-head/v1",
      "activation-recovery-fence-root/v1",
    ]);
    for (const [schemaVersion, record, fields] of schemas) {
      expect(schemaVersions).toContain(schemaVersion);
      expect(Object.keys(record).sort()).toEqual([...fields]);
      expect(parseContract(schemaVersion, record).ok).toBe(true);
      expect(canonicalJson(record)).toMatch(/^\{/);
    }
  });

  test("refuses every omitted, extra, wrong-type, future, and noncanonical-order record", () => {
    for (const [schemaVersion, record, fields] of schemas) {
      for (const field of fields) {
        const omitted = structuredClone(record) as Record<string, unknown>;
        delete omitted[field];
        expect(parseContract(schemaVersion, omitted).ok, `${schemaVersion}:${field}:omitted`).toBe(
          false,
        );
        expect(
          parseContract(schemaVersion, { ...record, [field]: [] }).ok,
          `${schemaVersion}:${field}:wrong-type`,
        ).toBe(false);
      }
      expect(parseContract(schemaVersion, { ...record, extra: true }).ok).toBe(false);
      expect(
        parseContract(schemaVersion, {
          ...record,
          schemaVersion: schemaVersion.replace("/v1", "/v2"),
        }).ok,
      ).toBe(false);
      expect(
        parseCanonicalContractBytes(
          schemaVersion,
          reorderedCanonicalBytes(record as Readonly<Record<string, unknown>>),
        ).ok,
      ).toBe(false);
    }
  });

  test("enforces only the structural BOOTSTRAP and SUCCESSOR nullable matrix", () => {
    expect(parseCleanupGateRoot(bootstrapGateRoot).ok).toBe(true);
    expect(
      parseCleanupGateRoot({
        ...bootstrapGateRoot,
        cleanupArchivePredecessorReceiptDigest: d("7"),
        cleanupArchivePredecessorTipDigest: d("8"),
        cleanupArchivePredecessorValueDigest: d("9"),
      }).ok,
    ).toBe(true);
    expect(parseCleanupGateRoot(successorGateRoot).ok).toBe(true);
    for (const field of [
      "cleanupArchivePredecessorReceiptDigest",
      "cleanupArchivePredecessorTipDigest",
      "cleanupArchivePredecessorValueDigest",
    ] as const)
      expect(parseCleanupGateRoot({ ...successorGateRoot, [field]: null }).ok).toBe(false);
    for (const field of [
      "predecessorActiveReleaseReceiptDigest",
      "predecessorActiveReleaseTipDigest",
      "predecessorActiveReleaseValueDigest",
    ] as const) {
      expect(parseCleanupGateRoot({ ...successorGateRoot, [field]: null }).ok).toBe(false);
      expect(parseCleanupGateRoot({ ...bootstrapGateRoot, [field]: d("f") }).ok).toBe(false);
    }
    expect(parseCleanupGateRoot({ ...successorGateRoot, recoveryFenceRootDigest: null }).ok).toBe(
      false,
    );
    expect(parseCleanupGateRoot({ ...bootstrapGateRoot, recoveryFenceRootDigest: d("f") }).ok).toBe(
      false,
    );
  });

  test("requires the fence generation to be the canonical safe-decimal successor", () => {
    expect(parseRecoveryFenceRoot(fenceRoot).ok).toBe(true);
    for (const successorBrokerGeneration of ["41", "43", "042", "9007199254740992"])
      expect(parseRecoveryFenceRoot({ ...fenceRoot, successorBrokerGeneration }).ok).toBe(false);
    expect(
      parseRecoveryFenceRoot({
        ...fenceRoot,
        predecessorBrokerGeneration: "9007199254740991",
        successorBrokerGeneration: "9007199254740991",
      }).ok,
    ).toBe(false);
  });

  test("accepts the safe-decimal maximum structurally and refuses overflow", () => {
    const gateHead = gateHistory([["PENDING", "NOT_PUBLISHED"]])[0]!;
    const fenceHead = fenceHistory()[0]!;
    expect(parseCleanupGateHead({ ...gateHead, ordinal: "9007199254740991" }).ok).toBe(true);
    expect(parseRecoveryFenceHead({ ...fenceHead, ordinal: "9007199254740991" }).ok).toBe(true);
    expect(parseCleanupGateHead({ ...gateHead, ordinal: "9007199254740992" }).ok).toBe(false);
    expect(parseRecoveryFenceHead({ ...fenceHead, ordinal: "9007199254740992" }).ok).toBe(false);
  });
});

describe("tagged roots and exact VALUE positions", () => {
  const cleanupPosition = Object.freeze({
    mode: "VALUE",
    parts: Object.freeze({
      ordinal: "0",
      rootDigest: computeCleanupGateRootDigest(bootstrapGateRoot),
    }),
  });
  const fencePosition = Object.freeze({
    mode: "VALUE",
    parts: Object.freeze({ ordinal: "1", rootDigest: computeRecoveryFenceRootDigest(fenceRoot) }),
  });
  const cleanupMutationInput = Object.freeze({
    canonicalPointerPath: "installation/activation-cleanup-gate.json",
    installationId,
    outcome: "SELECT",
    pointerKind: "ACTIVATION_CLEANUP_GATE",
    positionEvidence: cleanupPosition,
    priorReceiptDigest: null,
    priorTipDigest: null,
    priorValueDigest: null,
    projectId,
    sourceToken: "none",
    stateRootDigest: d("5"),
    successorValueDigest: d("e"),
    transactionId,
  });
  const fenceMutationInput = Object.freeze({
    ...cleanupMutationInput,
    canonicalPointerPath: "installation/activation-recovery-fence.json",
    pointerKind: "ACTIVATION_RECOVERY_FENCE",
    positionEvidence: fencePosition,
  });

  test("uses distinct root domains with stable goldens", () => {
    expect([
      computeCleanupGateRootDigest(bootstrapGateRoot),
      computeRecoveryFenceRootDigest(fenceRoot),
      computeCleanupGateValuePositionDigest(cleanupPosition),
      computeRecoveryFenceValuePositionDigest(fencePosition),
    ]).toEqual([
      "6e9f81b1b286b13b0120fe43c152d1c742d65082cc94dfcdbd46b402f25783a1",
      "067ae6acc5257488621ddebfadb79b8f565cf417ac495473b5dfe2b9189f796d",
      "24df04b494e6c8c706a87ba76d5de290759b679f0462879a17ad641c3da2fe63",
      "7ce6a5e32c99a8fc09a66ac637ace1d2cc17a4fbab5f2583aed2418a83e62a69",
    ]);
    expect(computeCleanupGateRootDigest(bootstrapGateRoot)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRecoveryFenceRootDigest(fenceRoot)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCleanupGateRootDigest(bootstrapGateRoot)).not.toBe(
      canonicalDigest(bootstrapGateRoot),
    );
    expect(computeRecoveryFenceRootDigest(fenceRoot)).not.toBe(canonicalDigest(fenceRoot));
    expect(computeCleanupGateRootDigest(bootstrapGateRoot)).not.toBe(
      computeRecoveryFenceRootDigest(fenceRoot),
    );
  });

  test("parses and hashes only the exact closed VALUE position", () => {
    expect(parseCleanupGateValuePosition(cleanupPosition).ok).toBe(true);
    expect(parseRecoveryFenceValuePosition(fencePosition).ok).toBe(true);
    expect(computeCleanupGateValuePositionDigest(cleanupPosition)).toBe(
      computePointerPositionDigest("ACTIVATION_CLEANUP_GATE", cleanupPosition),
    );
    expect(computeRecoveryFenceValuePositionDigest(fencePosition)).toBe(
      computePointerPositionDigest("ACTIVATION_RECOVERY_FENCE", fencePosition),
    );
    expect(
      parseCleanupGateValuePosition({
        ...cleanupPosition,
        parts: { ...cleanupPosition.parts, ordinal: "9007199254740991" },
      }).ok,
    ).toBe(true);
    const invalidPositions = [
      { parts: cleanupPosition.parts },
      { mode: "VALUE" },
      { ...cleanupPosition, mode: "TOMBSTONE" },
      { ...cleanupPosition, extra: true },
      { ...cleanupPosition, parts: { rootDigest: cleanupPosition.parts.rootDigest } },
      { ...cleanupPosition, parts: { ordinal: cleanupPosition.parts.ordinal } },
      { ...cleanupPosition, parts: { ...cleanupPosition.parts, ordinal: "00" } },
      {
        ...cleanupPosition,
        parts: { ...cleanupPosition.parts, ordinal: "9007199254740992" },
      },
      { ...cleanupPosition, parts: { ...cleanupPosition.parts, rootDigest: "no" } },
      { ...cleanupPosition, parts: { ...cleanupPosition.parts, extra: true } },
    ];
    for (const invalid of invalidPositions) {
      expect(parseCleanupGateValuePosition(invalid).ok).toBe(false);
      expect(parseRecoveryFenceValuePosition(invalid).ok).toBe(false);
      expect(() => computePointerPositionDigest("ACTIVATION_CLEANUP_GATE", invalid)).toThrow();
      expect(() => computePointerPositionDigest("ACTIVATION_RECOVERY_FENCE", invalid)).toThrow();
      expect(() =>
        computeMutationId({ ...cleanupMutationInput, positionEvidence: invalid }),
      ).toThrow();
      expect(() =>
        computeMutationId({ ...fenceMutationInput, positionEvidence: invalid }),
      ).toThrow();
    }
    expect(() => computeMutationId(cleanupMutationInput)).not.toThrow();
    expect(() => computeMutationId(fenceMutationInput)).not.toThrow();
  });
});

describe("bounded relative histories over supplied records", () => {
  const paths = [
    [
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
      ["PENDING", "PUBLISHED"],
      ["ACTIVATING", "PUBLISHED"],
      ["COMPLETE", "CLEARED"],
    ],
    [
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
      ["ABORTING", "PUBLISHING"],
      ["ABORTING", "PUBLISHED"],
      ["ABORTING", "CLEARED"],
      ["COMPLETE", "CLEARED"],
    ],
    [
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
      ["PENDING", "PUBLISHED"],
      ["ABORTING", "PUBLISHED"],
      ["ABORTING", "CLEARED"],
      ["COMPLETE", "CLEARED"],
    ],
    [
      ["PENDING", "NOT_PUBLISHED"],
      ["ABORTING", "NOT_PUBLISHED"],
      ["COMPLETE", "NOT_PUBLISHED"],
    ],
    [
      ["PENDING", "NOT_PUBLISHED"],
      ["COMPLETE", "NOT_PUBLISHED"],
    ],
  ] as readonly (readonly GatePair[])[];

  test("accepts every legal edge, equal times, and every valid shorter prefix", () => {
    for (const path of paths) {
      const history = gateHistory(path);
      expect(validateCleanupHeadHistory(bootstrapGateRoot, history, pathInstanceDigest)).toEqual(
        [],
      );
      for (let length = 1; length <= history.length; length++)
        expect(
          validateCleanupHeadHistory(
            bootstrapGateRoot,
            history.slice(0, length),
            pathInstanceDigest,
          ),
        ).toEqual([]);
    }
    const fence = fenceHistory();
    expect(validateFenceHeadHistory(fenceRoot, fence.slice(0, 1), pathInstanceDigest)).toEqual([]);
    expect(validateFenceHeadHistory(fenceRoot, fence, pathInstanceDigest)).toEqual([]);
  });

  test("accepts an equal cleanup timestamp and isolates the ordinal-zero genesis cell", () => {
    const history = gateHistory([
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
    ]) as readonly Readonly<Record<string, unknown>>[];
    const equalTimes = relinkHistory("ACTIVATION_CLEANUP_GATE", [
      history[0]!,
      { ...history[1]!, recordedAt: history[0]!.recordedAt },
    ]);
    expect(validateCleanupHeadHistory(bootstrapGateRoot, equalTimes, pathInstanceDigest)).toEqual(
      [],
    );

    const wrongGenesisCell = [
      { ...history[0]!, lifecycle: "COMPLETE", publication: "NOT_PUBLISHED" },
    ];
    expect(
      validateCleanupHeadHistory(bootstrapGateRoot, wrongGenesisCell, pathInstanceDigest),
    ).toEqual(["0:transition:not-genesis"]);
  });

  test("pins common head Dv bytes and isolates every cleanup history comparison", () => {
    const history = gateHistory([
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
    ]) as readonly Readonly<Record<string, unknown>>[];
    expect([
      computePointerValueDigest("ACTIVATION_CLEANUP_GATE", pathInstanceDigest, history[0]!),
      computePointerValueDigest(
        "ACTIVATION_RECOVERY_FENCE",
        pathInstanceDigest,
        fenceHistory()[0]!,
      ),
    ]).toEqual([
      "8773addd78800f0922e863ff8fc1b44d9b98e46c14a93687f82e09ef105cb831",
      "56c1131812f99d922ef0a85253fded1e5ece049c3ebbcf23de65dc264a11030a",
    ]);

    expect(
      validateCleanupHeadHistory(
        bootstrapGateRoot,
        [history[0]!, { ...history[1]!, ordinal: "2" }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:ordinal:not-dense"]);
    expect(
      validateCleanupHeadHistory(
        bootstrapGateRoot,
        [history[0]!, { ...history[1]!, priorHeadValueDigest: d("f") }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:priorHeadValueDigest:mismatch"]);
    expect(
      validateCleanupHeadHistory(
        bootstrapGateRoot,
        [history[0]!, { ...history[1]!, rootDigest: d("f") }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:rootDigest:mismatch"]);

    const illegal = relinkHistory("ACTIVATION_CLEANUP_GATE", [
      history[0]!,
      { ...history[1]!, lifecycle: "ACTIVATING", publication: "PUBLISHED" },
    ]);
    expect(validateCleanupHeadHistory(bootstrapGateRoot, illegal, pathInstanceDigest)).toEqual([
      "1:transition:invalid",
    ]);
    const selfLoop = relinkHistory("ACTIVATION_CLEANUP_GATE", [
      history[0]!,
      { ...history[1]!, lifecycle: "PENDING", publication: "NOT_PUBLISHED" },
    ]);
    expect(validateCleanupHeadHistory(bootstrapGateRoot, selfLoop, pathInstanceDigest)).toEqual([
      "1:transition:invalid",
    ]);

    const beforeRoot = [{ ...history[0]!, recordedAt: "2026-08-20T11:59:59.999Z" }];
    expect(validateCleanupHeadHistory(bootstrapGateRoot, beforeRoot, pathInstanceDigest)).toEqual([
      "0:recordedAt:before-root",
    ]);
    const beforePrior = relinkHistory("ACTIVATION_CLEANUP_GATE", [
      { ...history[0]!, recordedAt: "2026-08-20T12:01:00.000Z" },
      { ...history[1]!, recordedAt: "2026-08-20T12:00:30.000Z" },
    ]);
    expect(validateCleanupHeadHistory(bootstrapGateRoot, beforePrior, pathInstanceDigest)).toEqual([
      "1:recordedAt:before-prior",
    ]);
  });

  test("refuses every recovery-fence history seam with discriminating evidence", () => {
    const history = fenceHistory() as readonly Readonly<Record<string, unknown>>[];
    expect(validateFenceHeadHistory(fenceRoot, [], pathInstanceDigest)).toEqual(["history:length"]);
    const third = relinkHistory("ACTIVATION_RECOVERY_FENCE", [
      history[0]!,
      history[1]!,
      { ...history[1]!, recordedAt: "2026-08-20T12:00:01.000Z" },
    ]);
    expect(validateFenceHeadHistory(fenceRoot, third, pathInstanceDigest)).toContain(
      "history:length",
    );
    expect(
      validateFenceHeadHistory(
        fenceRoot,
        [{ ...history[1]!, ordinal: "0", priorHeadValueDigest: null }],
        pathInstanceDigest,
      ),
    ).toEqual(["0:transition:invalid"]);
    expect(
      validateFenceHeadHistory(fenceRoot, [history[1]!, history[0]!], pathInstanceDigest),
    ).not.toEqual([]);
    expect(
      validateFenceHeadHistory(
        fenceRoot,
        [history[0]!, { ...history[1]!, ordinal: "2" }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:ordinal:not-dense"]);
    expect(
      validateFenceHeadHistory(
        fenceRoot,
        [history[0]!, { ...history[1]!, priorHeadValueDigest: d("f") }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:priorHeadValueDigest:mismatch"]);
    expect(
      validateFenceHeadHistory(
        fenceRoot,
        [history[0]!, { ...history[1]!, rootDigest: d("f") }],
        pathInstanceDigest,
      ),
    ).toEqual(["1:rootDigest:mismatch"]);
    expect(
      validateFenceHeadHistory(
        fenceRoot,
        [{ ...history[0]!, recordedAt: "2026-08-20T11:59:59.999Z" }],
        pathInstanceDigest,
      ),
    ).toEqual(["0:recordedAt:before-root"]);
    const beforePrior = relinkHistory("ACTIVATION_RECOVERY_FENCE", [
      { ...history[0]!, recordedAt: "2026-08-20T12:01:00.000Z" },
      { ...history[1]!, recordedAt: "2026-08-20T12:00:30.000Z" },
    ]);
    expect(validateFenceHeadHistory(fenceRoot, beforePrior, pathInstanceDigest)).toEqual([
      "1:recordedAt:before-prior",
    ]);
    const selfLoop = relinkHistory("ACTIVATION_RECOVERY_FENCE", [
      history[0]!,
      { ...history[1]!, state: "PREPARED" },
    ]);
    expect(validateFenceHeadHistory(fenceRoot, selfLoop, pathInstanceDigest)).toEqual([
      "1:transition:invalid",
    ]);
    expect(validateFenceHeadHistory(fenceRoot, history, d("f"))).toContain(
      "1:priorHeadValueDigest:mismatch",
    );
  });

  test("refuses detectable start/interior omissions and every structural seam", () => {
    const history = gateHistory(paths[1]!);
    expect(validateCleanupHeadHistory(bootstrapGateRoot, [], pathInstanceDigest)).toEqual([
      "history:length",
    ]);
    expect(
      validateCleanupHeadHistory(
        bootstrapGateRoot,
        [...history, { ...history.at(-1), ordinal: "6" }],
        pathInstanceDigest,
      ),
    ).toContain("history:length");
    expect(
      validateCleanupHeadHistory(bootstrapGateRoot, history.slice(1), pathInstanceDigest),
    ).not.toEqual([]);
    expect(
      validateCleanupHeadHistory(
        bootstrapGateRoot,
        history.filter((_, index) => index !== 2),
        pathInstanceDigest,
      ),
    ).not.toEqual([]);
    for (const mutant of [
      [history[0]!, history[2]!, history[1]!, ...history.slice(3)],
      [history[0]!, history[1]!, history[1]!],
      history.map((head, index) => (index === 1 ? { ...head, ordinal: "2" } : head)),
      history.map((head, index) =>
        index === 1 ? { ...head, priorHeadValueDigest: d("f") } : head,
      ),
      history.map((head, index) => (index === 1 ? { ...head, rootDigest: d("f") } : head)),
      history.map((head, index) =>
        index === 1 ? { ...head, recordedAt: "2026-08-20T11:59:59.999Z" } : head,
      ),
      [...history, { ...history.at(-1), ordinal: "6" }],
    ])
      expect(validateCleanupHeadHistory(bootstrapGateRoot, mutant, pathInstanceDigest)).not.toEqual(
        [],
      );
    expect(validateCleanupHeadHistory(bootstrapGateRoot, history, d("f"))).not.toEqual([]);
  });

  test("all structural parsers and validators refuse hostile reflective inputs without throwing", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile");
        },
      },
    );
    for (const parse of [
      parseCleanupGateRoot,
      parseCleanupGateHead,
      parseRecoveryFenceRoot,
      parseRecoveryFenceHead,
      parseCleanupGateValuePosition,
      parseRecoveryFenceValuePosition,
    ]) {
      expect(() => parse(hostile)).not.toThrow();
      expect(parse(hostile).ok).toBe(false);
    }
    for (const validate of [validateCleanupHeadHistory, validateFenceHeadHistory]) {
      expect(() => validate(hostile, [], pathInstanceDigest)).not.toThrow();
      expect(validate(hostile, [], pathInstanceDigest)).not.toEqual([]);
      expect(() => validate(bootstrapGateRoot, hostile, pathInstanceDigest)).not.toThrow();
      expect(validate(bootstrapGateRoot, hostile, pathInstanceDigest)).not.toEqual([]);
      expect(() => validate(bootstrapGateRoot, [], hostile)).not.toThrow();
      expect(validate(bootstrapGateRoot, [], hostile)).not.toEqual([]);
    }
  });
});

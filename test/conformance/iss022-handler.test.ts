import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import {
  normalizeIss022AbsenceProbe,
  normalizeIss022CasProbe,
  normalizeIss022CreateOnceProbe,
  normalizeIss022PhysicalProbe,
  normalizeIss022ParserProbe,
  normalizeIss022ReplaceProbe,
  normalizeIss022RuntimeProbe,
  runIss022AbsenceStableHandler,
  runIss022CasStableHandler,
  runIss022PhysicalStableHandler,
  runIss022CreateOnceStableHandler,
  runIss022ParserStableHandler,
  runIss022ReplaceStableHandler,
  runIss022RuntimeStableHandler,
} from "../../packages/conformance/src/index.js";
import {
  executePortablePhysicalProbe,
  portablePrimitiveReplaceCases,
  type PortablePrimitiveAbsenceRawFacts,
  type PortablePrimitiveCasContentionRawFacts,
  type PortablePrimitiveCasBarrierContenderRawFacts,
  type PortablePrimitiveCasMismatchRawFacts,
  type PortablePrimitiveChildExecution,
  type PortablePrimitiveCreateOnceRawFacts,
  type PortablePrimitiveParserChildObservation,
  type PortablePrimitiveParserEquivalenceRawFacts,
  type PortablePrimitiveHandleRawFacts,
  type PortablePrimitiveProcessRawFacts,
  type PortablePrimitiveReplaceRawFacts,
  type PortablePhysicalAliasRawFacts,
  type PortablePhysicalBaseRawFacts,
  type PortablePhysicalSwapRawFacts,
} from "../../probes/portable-primitives/src/index.js";

const roots: string[] = [];

async function custodyRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-iss022-handler-"));
  roots.push(root);
  return root;
}

function coherentUnsupportedSwap(row: PortablePhysicalSwapRawFacts): PortablePhysicalSwapRawFacts {
  return {
    ...row,
    locatorAfter: { ...row.locatorBefore },
    locatorBefore: { ...row.locatorBefore },
    locatorStable: true,
    namespaceStable: true,
    operationApplied: false,
    operationErrorCode: "EPERM",
    rootAfter: { ...row.rootBefore },
    rootBefore: { ...row.rootBefore },
    rootRealpathStable: true,
    rootStable: true,
  };
}

function processFacts(): PortablePrimitiveProcessRawFacts {
  return {
    closeCode: null,
    closeObserved: true,
    closeSignal: "SIGTERM",
    directChildHandleOwned: true,
    eventOrder: ["exit", "close"],
    exitCode: null,
    exitObserved: true,
    exitSignal: "SIGTERM",
    forcedKillAccepted: null,
    grandchildClaimAcceptedAsAuthority: false,
    grandchildClaimPresent: true,
    ipcNonceMatched: true,
    killAccepted: true,
    killRequestedSignal: "SIGTERM",
    messageCount: 1,
    outputLimitExceeded: false,
    responseAccepted: true,
    timedOut: false,
  };
}

function handleFacts(): PortablePrimitiveHandleRawFacts {
  return {
    callbackInvocations: 1,
    crossProcessReplayRejected: true,
    directInvocationAccepted: true,
    nonceByteLength: 32,
    reuseAfterReleaseRejected: true,
    serializationRejected: true,
    structuredCloneRejected: true,
    workerTransferRejected: true,
    wrappedFunctionRejected: true,
  };
}

function parserChild(
  mutation: Partial<PortablePrimitiveParserChildObservation> = {},
): PortablePrimitiveParserChildObservation {
  return {
    closeCode: 0,
    closeEventCount: 1,
    closeSignal: null,
    errorEventCount: 0,
    exitCode: 0,
    exitEventCount: 1,
    exitSignal: null,
    killRefused: false,
    messageCount: 1,
    normalizedBytesMatch: true,
    normalizedDigest: "a".repeat(64),
    outputAccepted: true,
    postSignalDeadlineExpired: false,
    stderrOverflow: false,
    terminalEventsMatch: true,
    timedOut: false,
    ...mutation,
  };
}

function parserFacts(
  mutation: Partial<PortablePrimitiveParserEquivalenceRawFacts> = {},
): PortablePrimitiveParserEquivalenceRawFacts {
  return {
    caseId: "PARSER_EQUIVALENCE",
    childCount: "3",
    children: [parserChild(), parserChild(), parserChild()],
    parentNormalizedDigest: "a".repeat(64),
    resultsMatch: true,
    schemaVersion: "portable-primitives-parser-equivalence-raw/v1",
    ...mutation,
  };
}

function createOnceEvent(event: "CREATED" | "ERROR", errorCode: string | null): ContractRecord {
  return Object.freeze({
    barrier: null,
    errorCode,
    event,
    headPlusOneCode: null,
    headPlusTwoCode: null,
    mode: "EXCLUSIVE_CREATE",
    readbackHex: event === "CREATED" ? "41" : null,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  });
}

function createOnceChild(
  event: ContractRecord | null,
  mutation: Partial<PortablePrimitiveChildExecution> = {},
): PortablePrimitiveChildExecution {
  return {
    event,
    exitCode: 0,
    outputLimitExceeded: false,
    signal: null,
    stderr: "",
    stdout: event === null ? "" : canonicalJson(event),
    timedOut: false,
    ...mutation,
  };
}

function createOnceFacts(
  mutation: Partial<PortablePrimitiveCreateOnceRawFacts> = {},
): PortablePrimitiveCreateOnceRawFacts {
  return {
    caseId: "CREATE_ONCE_32_CONTENDERS",
    contenderCount: "32",
    contenders: [
      createOnceChild(createOnceEvent("CREATED", null)),
      ...Array.from({ length: 31 }, () => createOnceChild(createOnceEvent("ERROR", "EEXIST"))),
    ],
    finalReadbackErrorCode: null,
    finalReadbackHex: "41",
    schemaVersion: "portable-primitives-create-once-raw/v1",
    ...mutation,
  };
}

function casEvent(
  event: "ERROR" | "PREDECESSOR_MISMATCH" | "SELECTED",
  errorCode: string | null,
  readbackHex: "41" | "42" | null,
): ContractRecord {
  return Object.freeze({
    barrier: null,
    errorCode,
    event,
    headPlusOneCode: null,
    headPlusTwoCode: null,
    mode: "CAS",
    readbackHex,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  });
}

function casChild(
  event: ContractRecord | null,
  mutation: Partial<PortablePrimitiveChildExecution> = {},
): PortablePrimitiveChildExecution {
  return createOnceChild(event, mutation);
}

function casBarrierEvent(barrier: "READY" | "RELEASED"): ContractRecord {
  return Object.freeze({
    barrier,
    predecessorHex: "41",
    proposalHex: "42",
    schemaVersion: "portable-primitives-cas-barrier-event/v1",
  });
}

function casContender(
  contenderId: "0" | "1",
  terminal: PortablePrimitiveChildExecution,
): PortablePrimitiveCasBarrierContenderRawFacts {
  return {
    contenderId,
    readyEvent: casBarrierEvent("READY"),
    releaseEvent: casBarrierEvent("RELEASED"),
    terminal,
  };
}

function casFacts(): [
  PortablePrimitiveCasMismatchRawFacts,
  PortablePrimitiveCasContentionRawFacts,
] {
  return [
    {
      caseId: "CAS_PREDECESSOR_MISMATCH",
      child: casChild(casEvent("PREDECESSOR_MISMATCH", null, "41")),
      finalReadbackErrorCode: null,
      finalReadbackHex: "41",
      initialReadbackHex: "41",
      predecessorHex: "42",
      proposalHex: "42",
      schemaVersion: "portable-primitives-cas-mismatch-raw/v1",
    },
    {
      barrierEventOrder: ["CONTENDER_0_READY", "CONTENDER_1_READY", "RELEASE"],
      caseId: "CAS_TWO_CONTENDERS",
      contenderCount: "2",
      contenders: [
        casContender("0", casChild(casEvent("SELECTED", null, "42"))),
        casContender("1", casChild(casEvent("PREDECESSOR_MISMATCH", null, "42"))),
      ],
      finalReadbackErrorCode: null,
      finalReadbackHex: "42",
      initialReadbackHex: "41",
      predecessorHex: "41",
      proposalHex: "42",
      schemaVersion: "portable-primitives-cas-contention-raw/v1",
    },
  ];
}

function absenceEvent(
  headPlusOneCode: string | null = "ENOENT",
  headPlusTwoCode: string | null = "ENOENT",
  errorCode: string | null = null,
): ContractRecord {
  return Object.freeze({
    barrier: null,
    errorCode,
    event: errorCode === null ? "ABSENCE_OBSERVED" : "ERROR",
    headPlusOneCode: errorCode === null ? headPlusOneCode : null,
    headPlusTwoCode: errorCode === null ? headPlusTwoCode : null,
    mode: "ABSENCE",
    readbackHex: null,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  });
}

function absenceFacts(
  mutation: Partial<PortablePrimitiveAbsenceRawFacts> = {},
): PortablePrimitiveAbsenceRawFacts {
  return {
    caseId: "ABSENCE_HEAD_PLUS_ONE_TWO",
    child: createOnceChild(absenceEvent()),
    headPlusOneLeaf: "authority-head-plus-one",
    headPlusTwoLeaf: "authority-head-plus-two",
    providerPostChildHeadPlusOneCode: "ENOENT",
    providerPostChildHeadPlusTwoCode: "ENOENT",
    schemaVersion: "portable-primitives-absence-raw/v1",
    ...mutation,
  };
}

function replaceEvent(
  barrier: PortablePrimitiveReplaceRawFacts["requestedBarrier"] | null,
  errorCode: string | null = null,
): ContractRecord {
  return Object.freeze({
    barrier,
    errorCode,
    event: errorCode === null ? "REACHED_BARRIER" : "ERROR",
    headPlusOneCode: null,
    headPlusTwoCode: null,
    mode: "REPLACE",
    readbackHex: null,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  });
}

function replaceChild(
  event: ContractRecord | null,
  mutation: Partial<PortablePrimitiveChildExecution> = {},
): PortablePrimitiveChildExecution {
  const reachedBarrier = event?.event === "REACHED_BARRIER";
  return {
    event,
    exitCode: reachedBarrier ? null : 0,
    outputLimitExceeded: false,
    signal: reachedBarrier ? "SIGKILL" : null,
    stderr: "",
    stdout: event === null ? "" : canonicalJson(event),
    timedOut: false,
    ...mutation,
  };
}

function replaceFacts(): PortablePrimitiveReplaceRawFacts[] {
  return portablePrimitiveReplaceCases.map(({ caseId, requestedBarrier }) => ({
    caseId,
    child: replaceChild(replaceEvent(requestedBarrier)),
    finalReadbackErrorCode: null,
    finalReadbackHex:
      requestedBarrier === "AFTER_RENAME" || requestedBarrier === "AFTER_DIRECTORY_SYNC"
        ? "42"
        : "41",
    initialReadbackHex: "41",
    requestedBarrier,
    schemaVersion: "portable-primitives-replace-raw/v1",
  }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("stable ISS-022 physical handler", () => {
  test("normalizes the exact six-row provider-owned physical census", async () => {
    const result = await runIss022PhysicalStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions.map((row) => row.caseId)).toEqual([
      "PHYSICAL_EXISTING",
      "PHYSICAL_ABSENT_LEAF",
      "PHYSICAL_CASE_ALIAS",
      "PHYSICAL_UNICODE_ALIAS",
      "PHYSICAL_SYMLINK_SWAP",
      "PHYSICAL_PARENT_SWAP",
    ]);
    expect(result.vectorExecutions.slice(0, 4).map((row) => row.normalizedResult)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    for (const row of result.vectorExecutions.slice(4))
      expect(["PASS", "UNSUPPORTED"]).toContain(row.normalizedResult);
  });

  test("refuses moved, expanded, proxied, and reordered censuses", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const moved = [...rows];
    [moved[0], moved[1]] = [moved[1]!, moved[0]!];
    const expanded = [...rows] as unknown[] & { extra?: boolean };
    expanded.extra = true;
    for (const mutant of [rows.slice(0, -1), moved, expanded, new Proxy([...rows], {})]) {
      const result = normalizeIss022PhysicalProbe(mutant);
      expect(result.ok).toBe(false);
    }
    expect(
      normalizeIss022PhysicalProbe([
        new Proxy(rows[0], {}),
        rows[1],
        rows[2],
        rows[3],
        rows[4],
        rows[5],
      ]).ok,
    ).toBe(false);
  });

  test("refuses wrong scalar types and operating systems before normalization", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    for (const [index, mutant] of [
      [0, { ...rows[0], rootStable: "true" }],
      [2, { ...rows[2], operatingSystem: "FREEBSD" }],
      [4, { ...rows[4], operationApplied: 0 }],
      [4, { ...rows[4], operationErrorCode: 1 }],
    ] as const) {
      const mutated = [...rows];
      mutated[index] = mutant as never;
      expect(normalizeIss022PhysicalProbe(mutated).ok).toBe(false);
    }
  });

  test("keeps moving or contradictory base and alias observations UNKNOWN", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const existing = rows[0];
    const caseAlias = rows[2];
    const baseMutant: PortablePhysicalBaseRawFacts = { ...existing, rootStable: false };
    const derivationMutant: PortablePhysicalBaseRawFacts = {
      ...existing,
      derivation: { ...existing.derivation!, destinationDigest: "f".repeat(64) },
    };
    const aliasMutant: PortablePhysicalAliasRawFacts = {
      ...caseAlias,
      relationAfter: caseAlias.relationBefore === "IDENTICAL" ? "DISTINCT_ABSENT" : "IDENTICAL",
    };
    const baseRows = [baseMutant, rows[1], rows[2], rows[3], rows[4], rows[5]] as const;
    const aliasRows = [rows[0], rows[1], aliasMutant, rows[3], rows[4], rows[5]] as const;
    const base = normalizeIss022PhysicalProbe(baseRows);
    const derivation = normalizeIss022PhysicalProbe([
      derivationMutant,
      rows[1],
      rows[2],
      rows[3],
      rows[4],
      rows[5],
    ]);
    const alias = normalizeIss022PhysicalProbe(aliasRows);
    if (!(base.ok && derivation.ok && alias.ok)) throw new Error("mutant:census-refused");
    expect(base.vectorExecutions[0]?.normalizedResult).toBe("UNKNOWN");
    expect(derivation.vectorExecutions[0]?.normalizedResult).toBe("UNKNOWN");
    expect(alias.vectorExecutions[2]?.normalizedResult).toBe("UNKNOWN");
  });

  test("distinguishes stable unavailable aliases from unproved swap operations", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const caseAlias = rows[2];
    const alternateOperatingSystem = caseAlias.operatingSystem === "LINUX" ? "WINDOWS" : "LINUX";
    const unsupportedAlias: PortablePhysicalAliasRawFacts = {
      ...caseAlias,
      operatingSystem: alternateOperatingSystem,
    };
    const unsupportedSwap = coherentUnsupportedSwap(rows[4]);
    const unknownSwap: PortablePhysicalSwapRawFacts = {
      ...rows[4],
      operationApplied: false,
      operationErrorCode: "ENOENT",
    };
    const aliasResult = normalizeIss022PhysicalProbe([
      ...rows.slice(0, 2),
      unsupportedAlias,
      ...rows.slice(3),
    ]);
    const unsupportedResult = normalizeIss022PhysicalProbe([
      ...rows.slice(0, 4),
      unsupportedSwap,
      rows[5],
    ]);
    const unknownResult = normalizeIss022PhysicalProbe([...rows.slice(0, 4), unknownSwap, rows[5]]);
    if (!(aliasResult.ok && unsupportedResult.ok && unknownResult.ok))
      throw new Error("mutant:census-refused");
    expect(aliasResult.vectorExecutions[2]?.normalizedResult).toBe("UNSUPPORTED");
    expect(unsupportedResult.vectorExecutions[4]?.normalizedResult).toBe("UNSUPPORTED");
    expect(unknownResult.vectorExecutions[4]?.normalizedResult).toBe("UNKNOWN");
  });

  test("validates every nested fact before accepting an UNSUPPORTED operation", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const coherent = coherentUnsupportedSwap(rows[4]);
    const proxied = { ...coherent, rootAfter: new Proxy({ ...coherent.rootAfter }, {}) };
    const { statModeBytes: _removed, ...malformedLocator } = coherent.locatorAfter;
    const malformed = { ...coherent, locatorAfter: malformedLocator };
    const accessorRoot = { ...coherent.rootAfter };
    Object.defineProperty(accessorRoot, "namespaceFileHex", {
      enumerable: true,
      get: () => coherent.rootAfter.namespaceFileHex,
    });
    const accessor = { ...coherent, rootAfter: accessorRoot };
    for (const mutant of [proxied, malformed, accessor]) {
      const result = normalizeIss022PhysicalProbe([...rows.slice(0, 4), mutant, rows[5]]);
      expect(result.ok).toBe(false);
    }
  });

  test("keeps contradictory or incoherent operation failures UNKNOWN", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const coherent = coherentUnsupportedSwap(rows[4]);
    const movedInode = coherent.locatorAfter.statInodeBytes.endsWith("0")
      ? `${coherent.locatorAfter.statInodeBytes.slice(0, -1)}1`
      : `${coherent.locatorAfter.statInodeBytes.slice(0, -1)}0`;
    const contradictory: PortablePhysicalSwapRawFacts = {
      ...coherent,
      locatorAfter: {
        ...coherent.locatorAfter,
        lstatInodeBytes: movedInode,
        statInodeBytes: movedInode,
      },
    };
    const appliedWithError: PortablePhysicalSwapRawFacts = {
      ...coherent,
      operationApplied: true,
    };
    const missingError: PortablePhysicalSwapRawFacts = {
      ...coherent,
      operationErrorCode: null,
    };
    for (const mutant of [contradictory, appliedWithError, missingError]) {
      const result = normalizeIss022PhysicalProbe([...rows.slice(0, 4), mutant, rows[5]]);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[4]?.normalizedResult).toBe("UNKNOWN");
    }
  });

  test("requires retained-handle and locator movement before swap PASS", async () => {
    const rows = await executePortablePhysicalProbe(await custodyRoot());
    const symlinkMutant: PortablePhysicalSwapRawFacts = { ...rows[4], locatorStable: true };
    const parentMutant: PortablePhysicalSwapRawFacts = {
      ...rows[5],
      operationApplied: true,
      operationErrorCode: null,
      rootStable: true,
    };
    const symlink = normalizeIss022PhysicalProbe([...rows.slice(0, 4), symlinkMutant, rows[5]]);
    const parent = normalizeIss022PhysicalProbe([...rows.slice(0, 5), parentMutant]);
    if (!(symlink.ok && parent.ok)) throw new Error("mutant:census-refused");
    expect(symlink.vectorExecutions[4]?.normalizedResult).toBe("UNKNOWN");
    expect(parent.vectorExecutions[5]?.normalizedResult).toBe("UNKNOWN");
  });
});

describe("stable ISS-022 process and handle handler", () => {
  test("executes and normalizes the exact two-row provider-owned runtime census", async () => {
    const result = await runIss022RuntimeStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(
      result.vectorExecutions.map(({ caseId, normalizedResult }) => ({
        caseId,
        normalizedResult,
      })),
    ).toEqual([
      {
        caseId: "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP",
        normalizedResult: "UNSUPPORTED",
      },
      { caseId: "HANDLE_CLONE_TRANSFER_REUSE", normalizedResult: "PASS" },
    ]);
  });

  test("snapshots every row and nested terminal tuple before disposition", () => {
    const eventOrder: ("close" | "exit")[] = ["exit", "close"];
    const process = { ...processFacts(), eventOrder };
    const handle = handleFacts();
    const result = normalizeIss022RuntimeProbe([process, handle]);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0]?.rawFacts).not.toBe(process);
    expect(
      (result.vectorExecutions[0]?.rawFacts as PortablePrimitiveProcessRawFacts).eventOrder,
    ).not.toBe(process.eventOrder);
    eventOrder.splice(0);
    expect(result.vectorExecutions[0]?.normalizedResult).toBe("UNSUPPORTED");
  });

  test("refuses missing, extra, proxied, accessor, and malformed nested facts", () => {
    const process = processFacts();
    const handle = handleFacts();
    const extra = [process, handle] as unknown[] & { extra?: boolean };
    extra.extra = true;
    const accessor = processFacts() as PortablePrimitiveProcessRawFacts;
    Object.defineProperty(accessor, "messageCount", { enumerable: true, get: () => 1 });
    const { messageCount: _missing, ...missing } = process;
    for (const mutant of [
      [process],
      extra,
      new Proxy([process, handle], {}),
      [new Proxy(process, {}), handle],
      [{ ...process, eventOrder: new Proxy(["exit", "close"] as const, {}) }, handle],
      [accessor, handle],
      [missing, handle],
      [{ ...process, extra: true }, handle],
      [{ ...process, closeObserved: "true" }, handle],
      [process, { ...handle, nonceByteLength: 32n }],
    ])
      expect(normalizeIss022RuntimeProbe(mutant).ok).toBe(false);
  });

  test("refuses values outside the closed signal and request enums", () => {
    const handle = handleFacts();
    expect(
      normalizeIss022RuntimeProbe([{ ...processFacts(), exitSignal: "SIGPWN" }, handle]).ok,
    ).toBe(false);
    expect(
      normalizeIss022RuntimeProbe([{ ...processFacts(), killRequestedSignal: "SIGKILL" }, handle])
        .ok,
    ).toBe(false);
  });

  test("recomputes response and terminal coherence instead of trusting flags", () => {
    for (const process of [
      { ...processFacts(), messageCount: 2 },
      { ...processFacts(), responseAccepted: false },
      { ...processFacts(), eventOrder: ["close", "exit"] as const },
      { ...processFacts(), closeObserved: false },
      { ...processFacts(), exitSignal: "SIGKILL" as const },
      { ...processFacts(), grandchildClaimAcceptedAsAuthority: true },
    ]) {
      const result = normalizeIss022RuntimeProbe([process, handleFacts()]);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[0]?.normalizedResult).toBe("UNKNOWN");
    }
  });

  test("requires every probe-local confinement fact for handle PASS", () => {
    for (const handle of [
      { ...handleFacts(), callbackInvocations: 2 },
      { ...handleFacts(), nonceByteLength: 31 },
      { ...handleFacts(), crossProcessReplayRejected: false },
      { ...handleFacts(), directInvocationAccepted: false },
      { ...handleFacts(), reuseAfterReleaseRejected: false },
      { ...handleFacts(), serializationRejected: false },
      { ...handleFacts(), structuredCloneRejected: false },
      { ...handleFacts(), workerTransferRejected: false },
      { ...handleFacts(), wrappedFunctionRejected: false },
    ]) {
      const result = normalizeIss022RuntimeProbe([processFacts(), handle]);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[1]?.normalizedResult).toBe("UNKNOWN");
    }
  });
});

describe("stable ISS-022 create-once handler", () => {
  test("executes and normalizes exactly one provider-owned 32-contender row", async () => {
    const result = await runIss022CreateOnceStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions).toHaveLength(1);
    expect(result.vectorExecutions[0]).toMatchObject({
      caseId: "CREATE_ONCE_32_CONTENDERS",
      normalizedResult: "PASS",
    });
    const raw = result.vectorExecutions[0].rawFacts;
    expect(raw.contenders).toHaveLength(32);
    expect(raw.contenders.filter(({ event }) => event?.event === "CREATED")).toHaveLength(1);
    expect(
      raw.contenders.filter(
        ({ event }) => event?.event === "ERROR" && event.errorCode === "EEXIST",
      ),
    ).toHaveLength(31);
    expect(raw.contenders.every(({ stdout }) => !stdout.includes("PASS"))).toBe(true);
  }, 60_000);

  test("snapshots the complete contender census before disposition", () => {
    const facts = createOnceFacts();
    const contenders = [...facts.contenders];
    const input = { ...facts, contenders };
    const result = normalizeIss022CreateOnceProbe(input);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0].rawFacts).not.toBe(input);
    expect(result.vectorExecutions[0].rawFacts.contenders).not.toBe(contenders);
    expect(result.vectorExecutions[0].rawFacts.contenders[0]).not.toBe(contenders[0]);
    contenders[0] = createOnceChild(null, { stdout: "PASS\n" });
    expect(result.vectorExecutions[0].normalizedResult).toBe("PASS");
  });

  test("refuses malformed, expanded, proxied, accessor, and typed raw facts", () => {
    const facts = createOnceFacts();
    const accessor = { ...facts.contenders[0] };
    Object.defineProperty(accessor, "stdout", { enumerable: true, get: () => "PASS\n" });
    const { contenderCount: _missing, ...missing } = facts;
    for (const mutant of [
      missing,
      { ...facts, extra: true },
      { ...facts, contenderCount: 32 },
      { ...facts, finalReadbackHex: "4" },
      { ...facts, finalReadbackErrorCode: "ENOENT" },
      { ...facts, finalReadbackErrorCode: null, finalReadbackHex: null },
      { ...facts, contenders: facts.contenders.slice(0, -1) },
      { ...facts, contenders: [...facts.contenders, facts.contenders[0]] },
      { ...facts, contenders: new Proxy([...facts.contenders], {}) },
      { ...facts, contenders: [new Proxy(facts.contenders[0]!, {}), ...facts.contenders.slice(1)] },
      { ...facts, contenders: [accessor, ...facts.contenders.slice(1)] },
      {
        ...facts,
        contenders: [{ ...facts.contenders[0], timedOut: "false" }, ...facts.contenders.slice(1)],
      },
      {
        ...facts,
        contenders: [
          {
            ...facts.contenders[0],
            event: { ...facts.contenders[0]!.event, mode: "CAS" },
          },
          ...facts.contenders.slice(1),
        ],
      },
      new Proxy(facts, {}),
    ])
      expect(normalizeIss022CreateOnceProbe(mutant).ok).toBe(false);
  });

  test("requires one exact winner, 31 EEXIST losers, and final readback 41 for PASS", () => {
    const facts = createOnceFacts();
    const twoWinners = [
      createOnceChild(createOnceEvent("CREATED", null)),
      createOnceChild(createOnceEvent("CREATED", null)),
      ...facts.contenders.slice(2),
    ];
    const terminalFailure = [...facts.contenders];
    terminalFailure[4] = createOnceChild(null, {
      exitCode: null,
      signal: "SIGKILL",
      timedOut: true,
    });
    const candidateClaim = [...facts.contenders];
    candidateClaim[8] = createOnceChild(null, { stdout: "PASS\n" });
    const outputOverflow = [...facts.contenders];
    outputOverflow[12] = createOnceChild(null, {
      outputLimitExceeded: true,
      signal: "SIGKILL",
    });
    for (const mutant of [
      { ...facts, contenders: twoWinners },
      { ...facts, finalReadbackHex: "42" },
      { ...facts, contenders: terminalFailure },
      { ...facts, contenders: candidateClaim },
      { ...facts, contenders: outputOverflow },
    ]) {
      const result = normalizeIss022CreateOnceProbe(mutant);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
    }
  });

  test("admits only one coherent unsupported operation code", () => {
    const unsupported = Array.from({ length: 32 }, () =>
      createOnceChild(createOnceEvent("ERROR", "EPERM")),
    );
    const coherent = createOnceFacts({
      contenders: unsupported,
      finalReadbackErrorCode: "ENOENT",
      finalReadbackHex: null,
    });
    const result = normalizeIss022CreateOnceProbe(coherent);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0].normalizedResult).toBe("UNSUPPORTED");

    const mixedUnsupported = [...unsupported];
    mixedUnsupported[3] = createOnceChild(createOnceEvent("ERROR", "EACCES"));
    const nonAdmitted = [...unsupported];
    nonAdmitted[3] = createOnceChild(createOnceEvent("ERROR", "EIO"));
    for (const mutant of [
      { ...coherent, contenders: mixedUnsupported },
      { ...coherent, contenders: nonAdmitted },
      { ...coherent, finalReadbackErrorCode: null, finalReadbackHex: "41" },
    ]) {
      const reduced = normalizeIss022CreateOnceProbe(mutant);
      if (!reduced.ok) throw new Error(reduced.issues.join(","));
      expect(reduced.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
    }
  });
});

describe("stable ISS-022 parser-equivalence handler", () => {
  test("executes and normalizes the one exact parser-equivalence row", async () => {
    const result = await runIss022ParserStableHandler(resolve(import.meta.dirname, "../.."));
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions).toHaveLength(1);
    expect(result.vectorExecutions[0]).toMatchObject({
      caseId: "PARSER_EQUIVALENCE",
      normalizedResult: "PASS",
    });
    expect(result.vectorExecutions[0]?.rawFacts.children).toHaveLength(3);
  });

  test("snapshots the complete raw record before disposition", () => {
    const children = [parserChild(), parserChild(), parserChild()];
    const input = parserFacts({ children });
    const result = normalizeIss022ParserProbe(input);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0].rawFacts).not.toBe(input);
    expect(result.vectorExecutions[0].rawFacts.children).not.toBe(children);
    expect(result.vectorExecutions[0].rawFacts.children[0]).not.toBe(children[0]);
    children[0] = parserChild({ normalizedBytesMatch: false });
    expect(result.vectorExecutions[0].normalizedResult).toBe("PASS");
    expect(result.vectorExecutions[0].rawFacts.children[0]?.normalizedBytesMatch).toBe(true);
  });

  test("reduces observed parser differences to UNSUPPORTED and missing output to UNKNOWN", () => {
    const difference = normalizeIss022ParserProbe(
      parserFacts({
        children: [
          parserChild(),
          parserChild({ normalizedBytesMatch: false, normalizedDigest: "b".repeat(64) }),
          parserChild(),
        ],
        resultsMatch: false,
      }),
    );
    const missingOutput = normalizeIss022ParserProbe(
      parserFacts({
        children: [
          parserChild(),
          parserChild({
            messageCount: 0,
            normalizedBytesMatch: false,
            normalizedDigest: null,
            outputAccepted: false,
          }),
          parserChild(),
        ],
        resultsMatch: false,
      }),
    );
    if (!(difference.ok && missingOutput.ok)) throw new Error("parser:mutant-refused");
    expect(difference.vectorExecutions[0].normalizedResult).toBe("UNSUPPORTED");
    expect(missingOutput.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
  });

  test("recomputes equality instead of trusting the outer resultsMatch summary", () => {
    const deniedPass = normalizeIss022ParserProbe(parserFacts({ resultsMatch: false }));
    const deniedUnsupported = normalizeIss022ParserProbe(
      parserFacts({
        children: [
          parserChild(),
          parserChild({ normalizedBytesMatch: false, normalizedDigest: "b".repeat(64) }),
          parserChild(),
        ],
        resultsMatch: true,
      }),
    );
    if (!(deniedPass.ok && deniedUnsupported.ok)) throw new Error("parser:mutant-refused");
    expect(deniedPass.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
    expect(deniedUnsupported.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
  });

  test("refuses missing, expanded, proxied, accessor, and typed record mutants", () => {
    const accessorChild = parserChild();
    Object.defineProperty(accessorChild, "messageCount", { enumerable: true, get: () => 1 });
    const { childCount: _childCount, ...missing } = parserFacts();
    for (const mutant of [
      missing,
      { ...parserFacts(), childCount: 3 },
      { ...parserFacts(), caseId: "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP" },
      { ...parserFacts(), schemaVersion: "portable-primitives-parser-equivalence-raw/v2" },
      { ...parserFacts(), path: "C:\\hostile" },
      { ...parserFacts(), children: [parserChild(), parserChild()] },
      { ...parserFacts(), children: [parserChild(), parserChild(), parserChild(), parserChild()] },
      { ...parserFacts(), children: [parserChild(), { ...parserChild(), pid: 7 }, parserChild()] },
      {
        ...parserFacts(),
        children: [parserChild(), { ...parserChild(), result: "PASS" }, parserChild()],
      },
      { ...parserFacts(), children: [parserChild(), new Proxy(parserChild(), {}), parserChild()] },
      { ...parserFacts(), children: [parserChild(), accessorChild, parserChild()] },
      { ...parserFacts(), children: new Proxy([parserChild(), parserChild(), parserChild()], {}) },
      new Proxy(parserFacts(), {}),
    ])
      expect(normalizeIss022ParserProbe(mutant).ok).toBe(false);
  });

  test("refuses terminal and byte-digest contradictions", () => {
    const noTerminalTrigger = parserChild({
      closeCode: null,
      closeEventCount: 0,
      exitCode: null,
      exitEventCount: 0,
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      terminalEventsMatch: false,
    });
    const exitOnlyWithoutTrigger = parserChild({
      closeCode: null,
      closeEventCount: 0,
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      terminalEventsMatch: false,
    });
    const closeOnlyWithoutTrigger = parserChild({
      exitCode: null,
      exitEventCount: 0,
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      terminalEventsMatch: false,
    });
    for (const child of [
      parserChild({ terminalEventsMatch: false }),
      parserChild({ timedOut: true }),
      parserChild({ exitSignal: "SIGKILL" }),
      parserChild({ normalizedDigest: null }),
      parserChild({ normalizedDigest: "b".repeat(64) }),
      parserChild({ closeEventCount: 2 }),
      noTerminalTrigger,
      exitOnlyWithoutTrigger,
      closeOnlyWithoutTrigger,
    ])
      expect(
        normalizeIss022ParserProbe(parserFacts({ children: [parserChild(), child, parserChild()] }))
          .ok,
      ).toBe(false);
  });

  test("keeps incomplete terminal pairs UNKNOWN only with their recorded lifecycle trigger", () => {
    const failedWithoutTerminal = parserChild({
      closeCode: null,
      closeEventCount: 0,
      errorEventCount: 1,
      exitCode: null,
      exitEventCount: 0,
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      postSignalDeadlineExpired: true,
      terminalEventsMatch: false,
    });
    const timedOutAfterExit = parserChild({
      closeCode: null,
      closeEventCount: 0,
      exitCode: null,
      exitSignal: "SIGKILL",
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      postSignalDeadlineExpired: true,
      terminalEventsMatch: false,
      timedOut: true,
    });
    const overflowedAfterClose = parserChild({
      closeCode: null,
      closeSignal: "SIGKILL",
      exitCode: null,
      exitEventCount: 0,
      normalizedBytesMatch: false,
      normalizedDigest: null,
      outputAccepted: false,
      postSignalDeadlineExpired: true,
      stderrOverflow: true,
      terminalEventsMatch: false,
    });
    for (const child of [failedWithoutTerminal, timedOutAfterExit, overflowedAfterClose]) {
      const result = normalizeIss022ParserProbe(
        parserFacts({ children: [parserChild(), child, parserChild()], resultsMatch: false }),
      );
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
    }
  });
});

describe("stable ISS-022 replace handler", () => {
  test("executes and normalizes the exact five provider-owned crash rows", async () => {
    const result = await runIss022ReplaceStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(
      result.vectorExecutions.slice(0, 4).map(({ caseId, normalizedResult, rawFacts }) => ({
        caseId,
        finalReadbackHex: rawFacts.finalReadbackHex,
        initialReadbackHex: rawFacts.initialReadbackHex,
        normalizedResult,
      })),
    ).toEqual([
      {
        caseId: "REPLACE_BEFORE_CREATE",
        finalReadbackHex: "41",
        initialReadbackHex: "41",
        normalizedResult: "PASS",
      },
      {
        caseId: "REPLACE_AFTER_CREATE",
        finalReadbackHex: "41",
        initialReadbackHex: "41",
        normalizedResult: "PASS",
      },
      {
        caseId: "REPLACE_AFTER_FILE_SYNC",
        finalReadbackHex: "41",
        initialReadbackHex: "41",
        normalizedResult: "PASS",
      },
      {
        caseId: "REPLACE_AFTER_RENAME",
        finalReadbackHex: "42",
        initialReadbackHex: "41",
        normalizedResult: "PASS",
      },
    ]);
    expect(result.vectorExecutions[4]).toMatchObject({
      caseId: "REPLACE_AFTER_DIRECTORY_SYNC",
      rawFacts: { finalReadbackHex: "42", initialReadbackHex: "41" },
    });
    expect(["PASS", "UNSUPPORTED"]).toContain(result.vectorExecutions[4]!.normalizedResult);
    expect(
      result.vectorExecutions.every(({ rawFacts }) => !rawFacts.child.stdout.includes("PASS")),
    ).toBe(true);
  }, 60_000);

  test("snapshots every child and event before disposition", () => {
    const rows = replaceFacts();
    const event = rows[0]!.child.event!;
    const result = normalizeIss022ReplaceProbe(rows);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0]!.rawFacts).not.toBe(rows[0]);
    expect(result.vectorExecutions[0]!.rawFacts.child).not.toBe(rows[0]!.child);
    expect(result.vectorExecutions[0]!.rawFacts.child.event).not.toBe(event);
    rows[0] = { ...rows[0]!, finalReadbackHex: "42" };
    expect(result.vectorExecutions[0]!.normalizedResult).toBe("PASS");
  });

  test("refuses census, shape, type, accessor, proxy, and mixed-barrier mutants", () => {
    const rows = replaceFacts();
    const accessor = { ...rows[0]!.child };
    Object.defineProperty(accessor, "stdout", {
      enumerable: true,
      get: () => canonicalJson(rows[0]!.child.event!),
    });
    const { initialReadbackHex: _missing, ...missing } = rows[0]!;
    for (const mutant of [
      rows.slice(0, -1),
      [...rows, rows[0]],
      [rows[1], rows[0], ...rows.slice(2)],
      [missing, ...rows.slice(1)],
      [{ ...rows[0], extra: true }, ...rows.slice(1)],
      [{ ...rows[0], initialReadbackHex: 41 }, ...rows.slice(1)],
      [{ ...rows[0], requestedBarrier: "AFTER_CREATE" }, ...rows.slice(1)],
      [
        {
          ...rows[0],
          child: replaceChild(replaceEvent("AFTER_CREATE")),
        },
        ...rows.slice(1),
      ],
      [{ ...rows[0], child: accessor }, ...rows.slice(1)],
      [new Proxy(rows[0]!, {}), ...rows.slice(1)],
      new Proxy(rows, {}),
    ])
      expect(normalizeIss022ReplaceProbe(mutant).ok).toBe(false);
  });

  test("keeps wrong readback and lifecycle contradictions non-PASS", () => {
    for (const row of [
      { ...replaceFacts()[0]!, finalReadbackHex: "42" },
      {
        ...replaceFacts()[1]!,
        child: replaceChild(replaceFacts()[1]!.child.event, { exitCode: 0, signal: null }),
      },
      {
        ...replaceFacts()[2]!,
        child: replaceChild(replaceFacts()[2]!.child.event, { timedOut: true }),
      },
      {
        ...replaceFacts()[3]!,
        child: replaceChild(replaceFacts()[3]!.child.event, { outputLimitExceeded: true }),
      },
      {
        ...replaceFacts()[4]!,
        child: replaceChild(null, { stdout: "PASS\n" }),
      },
    ]) {
      const rows = replaceFacts();
      const index = portablePrimitiveReplaceCases.findIndex(({ caseId }) => caseId === row.caseId);
      rows[index] = row;
      const result = normalizeIss022ReplaceProbe(rows);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[index]!.normalizedResult).toBe("UNKNOWN");
    }
  });

  test("admits only exact reachable unsupported operation evidence", () => {
    const admitted = replaceFacts();
    admitted[1] = {
      ...admitted[1]!,
      child: replaceChild(replaceEvent(null, "EPERM")),
    };
    admitted[4] = {
      ...admitted[4]!,
      child: replaceChild(replaceEvent(null, "ENOTSUP"), {
        exitCode: null,
        signal: "SIGKILL",
      }),
    };
    const result = normalizeIss022ReplaceProbe(admitted);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[1]!.normalizedResult).toBe("UNSUPPORTED");
    expect(result.vectorExecutions[4]!.normalizedResult).toBe("UNSUPPORTED");

    for (const row of [
      {
        ...replaceFacts()[0]!,
        child: replaceChild(replaceEvent(null, "EPERM")),
      },
      {
        ...replaceFacts()[2]!,
        child: replaceChild(replaceEvent(null, "EIO")),
      },
      {
        ...replaceFacts()[3]!,
        child: replaceChild(replaceEvent(null, "EACCES")),
        finalReadbackHex: "42",
      },
    ]) {
      const rows = replaceFacts();
      const index = portablePrimitiveReplaceCases.findIndex(({ caseId }) => caseId === row.caseId);
      rows[index] = row;
      const reduced = normalizeIss022ReplaceProbe(rows);
      if (!reduced.ok) throw new Error(reduced.issues.join(","));
      expect(reduced.vectorExecutions[index]!.normalizedResult).toBe("UNKNOWN");
    }
  });
});

describe("stable ISS-022 CAS handler", () => {
  test("executes and normalizes the exact two provider-owned fresh-child rows", async () => {
    const result = await runIss022CasStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(
      result.vectorExecutions.map(({ caseId, rawFacts }) => ({
        caseId,
        finalReadbackHex: rawFacts.finalReadbackHex,
        initialReadbackHex: rawFacts.initialReadbackHex,
      })),
    ).toEqual([
      {
        caseId: "CAS_PREDECESSOR_MISMATCH",
        finalReadbackHex: "41",
        initialReadbackHex: "41",
      },
      {
        caseId: "CAS_TWO_CONTENDERS",
        finalReadbackHex: "42",
        initialReadbackHex: "41",
      },
    ]);
    expect(result.vectorExecutions[0]!.normalizedResult).toBe("PASS");
    expect(result.vectorExecutions[1]!.normalizedResult).toBe("UNSUPPORTED");
    const [mismatch, contention] = result.vectorExecutions;
    expect((mismatch!.rawFacts as PortablePrimitiveCasMismatchRawFacts).child.stdout).not.toContain(
      "PASS",
    );
    expect(
      (contention!.rawFacts as PortablePrimitiveCasContentionRawFacts).contenders.every(
        ({ terminal }) => !terminal.stdout.includes("PASS"),
      ),
    ).toBe(true);
  });

  test("snapshots the complete census before disposition", () => {
    const rows = casFacts();
    const event = rows[0].child.event!;
    const result = normalizeIss022CasProbe(rows);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0]!.rawFacts).not.toBe(rows[0]);
    expect(
      (result.vectorExecutions[0]!.rawFacts as PortablePrimitiveCasMismatchRawFacts).child.event,
    ).not.toBe(event);
    rows[0] = { ...rows[0], finalReadbackHex: "42" };
    expect(result.vectorExecutions[0]!.normalizedResult).toBe("PASS");
  });

  test("refuses malformed census, requests, events, accessors, and proxies", () => {
    const rows = casFacts();
    const accessor = { ...rows[0] };
    Object.defineProperty(accessor, "predecessorHex", { enumerable: true, get: () => "42" });
    const { proposalHex: _missing, ...missing } = rows[0];
    for (const mutant of [
      rows.slice(0, 1),
      [...rows, rows[0]],
      [rows[1], rows[0]],
      [missing, rows[1]],
      [{ ...rows[0], extra: true }, rows[1]],
      [{ ...rows[0], predecessorHex: "41" }, rows[1]],
      [accessor, rows[1]],
      [new Proxy(rows[0], {}), rows[1]],
      new Proxy(rows, {}),
      [rows[0], { ...rows[1], barrierEventOrder: ["CONTENDER_0_READY", "RELEASE"] }],
      [
        rows[0],
        {
          ...rows[1],
          barrierEventOrder: ["CONTENDER_0_READY", "RELEASE", "CONTENDER_1_READY"],
        },
      ],
      [
        rows[0],
        {
          ...rows[1],
          contenders: [
            rows[1].contenders[0],
            { ...rows[1].contenders[1], readyEvent: casBarrierEvent("RELEASED") },
          ],
        },
      ],
      [
        rows[0],
        {
          ...rows[1],
          contenders: [
            {
              ...rows[1].contenders[0],
              readyEvent: { ...casBarrierEvent("READY"), predecessorHex: "42" },
            },
            rows[1].contenders[1],
          ],
        },
      ],
      [
        rows[0],
        {
          ...rows[1],
          contenders: [
            casContender("0", casChild(casEvent("PREDECESSOR_MISMATCH", null, "41"))),
            rows[1].contenders[1],
          ],
        },
      ],
    ])
      expect(normalizeIss022CasProbe(mutant).ok).toBe(false);
  });

  test("keeps EEXIST non-PASS and admits only coherent exact operation errors", () => {
    const resultAt = (rows: ReturnType<typeof casFacts>, index: 0 | 1) => {
      const result = normalizeIss022CasProbe(rows);
      if (!result.ok) throw new Error(result.issues.join(","));
      return result.vectorExecutions[index]!.normalizedResult;
    };
    expect(resultAt(casFacts(), 1)).toBe("PASS");

    const existing = casFacts();
    existing[1] = {
      ...existing[1],
      contenders: [
        casContender("0", casChild(casEvent("SELECTED", null, "42"))),
        casContender("1", casChild(casEvent("ERROR", "EEXIST", null))),
      ],
    };
    expect(resultAt(existing, 1)).toBe("UNSUPPORTED");

    const unsupported = casFacts();
    unsupported[0] = {
      ...unsupported[0],
      child: casChild(casEvent("ERROR", "EPERM", null)),
    };
    unsupported[1] = {
      ...unsupported[1],
      contenders: [
        casContender("0", casChild(casEvent("ERROR", "EEXIST", null))),
        casContender("1", casChild(casEvent("ERROR", "ENOTSUP", null))),
      ],
      finalReadbackHex: "41",
    };
    expect(resultAt(unsupported, 0)).toBe("UNSUPPORTED");
    expect(resultAt(unsupported, 1)).toBe("UNSUPPORTED");

    for (const [rows, index] of [
      [[{ ...casFacts()[0], finalReadbackHex: "42" }, casFacts()[1]], 0],
      [
        [
          casFacts()[0],
          {
            ...casFacts()[1],
            contenders: [
              casContender("0", casChild(casEvent("SELECTED", null, "42"))),
              casContender("1", casChild(casEvent("ERROR", "EPERM", null))),
            ],
          },
        ],
        1,
      ],
      [
        [
          { ...casFacts()[0], child: casChild(casFacts()[0].child.event, { timedOut: true }) },
          casFacts()[1],
        ],
        0,
      ],
    ] as readonly (readonly [ReturnType<typeof casFacts>, 0 | 1])[])
      expect(resultAt(rows, index)).toBe("UNKNOWN");
  });
});

describe("stable ISS-022 same-lock absence handler", () => {
  test("executes the exact provider-owned row and requires both post-child ENOENT rechecks", async () => {
    const result = await runIss022AbsenceStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0]).toMatchObject({
      caseId: "ABSENCE_HEAD_PLUS_ONE_TWO",
      normalizedResult: "PASS",
      rawFacts: {
        headPlusOneLeaf: "authority-head-plus-one",
        headPlusTwoLeaf: "authority-head-plus-two",
        providerPostChildHeadPlusOneCode: "ENOENT",
        providerPostChildHeadPlusTwoCode: "ENOENT",
      },
    });
    expect(result.vectorExecutions[0].rawFacts.child.stdout).not.toContain("PASS");
  });

  test("snapshots the complete raw row before disposition", () => {
    const facts = absenceFacts();
    const event = facts.child.event!;
    const result = normalizeIss022AbsenceProbe(facts);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0].rawFacts).not.toBe(facts);
    expect(result.vectorExecutions[0].rawFacts.child.event).not.toBe(event);
    expect(result.vectorExecutions[0].normalizedResult).toBe("PASS");
  });

  test("refuses substituted paths, malformed records, accessors, proxies, and widened census", () => {
    const facts = absenceFacts();
    const accessor = { ...facts };
    Object.defineProperty(accessor, "headPlusOneLeaf", {
      enumerable: true,
      get: () => "authority-head-plus-one",
    });
    const { schemaVersion: _missing, ...missing } = facts;
    for (const mutant of [
      [],
      [facts],
      missing,
      { ...facts, extra: true },
      { ...facts, headPlusOneLeaf: "authority-head-plus-two" },
      { ...facts, headPlusTwoLeaf: "authority-head-plus-one" },
      { ...facts, providerPostChildHeadPlusOneCode: false },
      { ...facts, child: createOnceChild({ ...absenceEvent(), mode: "CAS" }) },
      accessor,
      new Proxy(facts, {}),
    ])
      expect(normalizeIss022AbsenceProbe(mutant).ok).toBe(false);
  });

  test("keeps concurrent/later presence, unexpected errno, and lifecycle gaps non-PASS", () => {
    for (const facts of [
      absenceFacts({ providerPostChildHeadPlusOneCode: "PRESENT" }),
      absenceFacts({ child: createOnceChild(absenceEvent("PRESENT", "ENOENT")) }),
      absenceFacts({ child: createOnceChild(absenceEvent("EIO", "ENOENT")) }),
      absenceFacts({ child: createOnceChild(absenceEvent(), { timedOut: true }) }),
    ]) {
      const result = normalizeIss022AbsenceProbe(facts);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[0].normalizedResult).toBe("UNKNOWN");
    }
  });

  test("admits exact unsupported operation evidence but never promotes it to PASS", () => {
    for (const facts of [
      absenceFacts({ child: createOnceChild(absenceEvent(null, null, "EPERM")) }),
      absenceFacts({ child: createOnceChild(absenceEvent("ENOTSUP", "ENOTSUP")) }),
      absenceFacts({
        providerPostChildHeadPlusOneCode: "EACCES",
        providerPostChildHeadPlusTwoCode: "EACCES",
      }),
    ]) {
      const result = normalizeIss022AbsenceProbe(facts);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.vectorExecutions[0].normalizedResult).toBe("UNSUPPORTED");
    }
  });
});

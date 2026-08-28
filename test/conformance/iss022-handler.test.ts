import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  normalizeIss022PhysicalProbe,
  normalizeIss022RuntimeProbe,
  runIss022PhysicalStableHandler,
  runIss022RuntimeStableHandler,
} from "../../packages/conformance/src/index.js";
import {
  executePortablePhysicalProbe,
  type PortablePrimitiveHandleRawFacts,
  type PortablePrimitiveProcessRawFacts,
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

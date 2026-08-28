import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  normalizeIss022PhysicalProbe,
  runIss022PhysicalStableHandler,
} from "../../packages/conformance/src/index.js";
import {
  executePortablePhysicalProbe,
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

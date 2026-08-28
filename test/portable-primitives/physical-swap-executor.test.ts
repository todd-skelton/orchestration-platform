import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executePortablePhysicalProbe } from "../../probes/portable-primitives/src/index.js";

const roots: string[] = [];

async function root(label: string) {
  const value = await mkdtemp(resolve(tmpdir(), `orchestration-${label}-`));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

describe("ISS-022 symlink and parent-swap physical observations", () => {
  test("records a symlink or junction barrier without admitting its alternate locator", async () => {
    const custodyRoot = await root("physical-symlink-swap");
    const [, , , , symlinkSwap] = await executePortablePhysicalProbe(custodyRoot);
    expect(symlinkSwap).toMatchObject({
      caseId: "PHYSICAL_SYMLINK_SWAP",
      locatorStable: false,
      namespaceStable: true,
      operationApplied: true,
      operationErrorCode: null,
      rootRealpathStable: true,
      rootStable: true,
    });
    expect(symlinkSwap.locatorBefore).toMatchObject({
      lstatKind: "DIRECTORY",
      statKind: "DIRECTORY",
    });
    expect(symlinkSwap.locatorAfter).toMatchObject({
      lstatKind: "SYMLINK",
      statKind: "DIRECTORY",
    });
    expect((await lstat(resolve(custodyRoot, "link-leaf"))).isSymbolicLink()).toBe(true);
    expect(Object.keys(symlinkSwap)).not.toContain("derivation");
    expect(JSON.stringify(symlinkSwap)).not.toContain("PASS");
    expect(JSON.stringify(symlinkSwap)).not.toContain(custodyRoot);
  });

  test("retains raw parent-replacement evidence and restores the owned root", async () => {
    const custodyRoot = await root("physical-parent-swap");
    const [, , , , , parentSwap] = await executePortablePhysicalProbe(custodyRoot);
    expect(parentSwap.caseId).toBe("PHYSICAL_PARENT_SWAP");
    expect(parentSwap.namespaceStable).toBe(true);
    expect(parentSwap.rootRealpathStable).toBe(true);
    expect(parentSwap.locatorBefore).toMatchObject({
      lstatKind: "REGULAR_FILE",
      statKind: "REGULAR_FILE",
    });
    expect(parentSwap.locatorAfter).toMatchObject({
      lstatKind: "REGULAR_FILE",
      statKind: "REGULAR_FILE",
    });
    if (parentSwap.operationApplied) {
      expect(parentSwap.operationErrorCode).toBeNull();
      expect(parentSwap.rootStable).toBe(false);
      expect(parentSwap.locatorStable).toBe(false);
    } else {
      expect(parentSwap.rootStable).toBe(true);
      expect(parentSwap.locatorStable).toBe(true);
    }
    expect((await lstat(resolve(custodyRoot, "parent-leaf"))).isFile()).toBe(true);
    expect(Object.keys(parentSwap)).not.toContain("derivation");
    expect(JSON.stringify(parentSwap)).not.toContain("PASS");
    expect(JSON.stringify(parentSwap)).not.toContain(custodyRoot);
  });

  test("closes the retained handle and leaves no external swap custody", async () => {
    const custodyRoot = await root("physical-swap-cleanup");
    const facts = await executePortablePhysicalProbe(custodyRoot);
    expect(facts.map(({ caseId }) => caseId).slice(-2)).toEqual([
      "PHYSICAL_SYMLINK_SWAP",
      "PHYSICAL_PARENT_SWAP",
    ]);
    await rm(custodyRoot, { recursive: true });
    roots.splice(roots.indexOf(custodyRoot), 1);
  });
});

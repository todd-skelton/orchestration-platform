import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executePortablePhysicalProbe } from "../../probes/portable-primitives/src/index.js";
import {
  observePortablePhysicalOptionalLeaf,
  portablePhysicalAliasRelation,
} from "../../probes/portable-primitives/src/physical-executor.js";

const roots: string[] = [];

async function root(label: string) {
  const value = await mkdtemp(resolve(tmpdir(), `orchestration-${label}-`));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("ISS-022 case and Unicode physical alias observations", () => {
  test("records the OS-specific alias relations without deriving alternate destinations", async () => {
    const custodyRoot = await root("physical-alias");
    const [existing, absent, caseAlias, unicodeAlias] =
      await executePortablePhysicalProbe(custodyRoot);
    expect(caseAlias.caseId).toBe("PHYSICAL_CASE_ALIAS");
    expect(unicodeAlias.caseId).toBe("PHYSICAL_UNICODE_ALIAS");
    for (const observation of [caseAlias, unicodeAlias]) {
      expect(observation.rootStable).toBe(true);
      expect(observation.rootRealpathStable).toBe(true);
      expect(observation.leftStable).toBe(true);
      expect(observation.rightStable).toBe(true);
      expect(observation.relationStable).toBe(true);
      expect(observation.rootBefore).toEqual(observation.rootAfter);
      expect(observation.leftBefore).toEqual(observation.leftAfter);
      expect(observation.rightBefore).toEqual(observation.rightAfter);
      expect(observation.leftBefore.disposition).toBe("EXISTING");
      expect(Object.keys(observation)).not.toContain("derivation");
    }
    expect(caseAlias.relationBefore).toBe(
      process.platform === "linux" ? "DISTINCT_ABSENT" : "IDENTICAL",
    );
    expect(unicodeAlias.relationBefore).toBe(
      process.platform === "darwin" ? "IDENTICAL" : "DISTINCT_ABSENT",
    );
    expect(existing.rootBefore.namespaceFileHex).toBe(absent.rootBefore.namespaceFileHex);
    expect(absent.rootBefore.namespaceFileHex).toBe(caseAlias.rootBefore.namespaceFileHex);
    expect(caseAlias.rootBefore.namespaceFileHex).toBe(unicodeAlias.rootBefore.namespaceFileHex);
    expect(JSON.stringify([caseAlias, unicodeAlias])).not.toContain("PASS");
    expect(JSON.stringify([caseAlias, unicodeAlias])).not.toContain(custodyRoot);
  }, 30_000);

  test("releases the one retained root handle after all six rows", async () => {
    const custodyRoot = await root("physical-alias-cleanup");
    const facts = await executePortablePhysicalProbe(custodyRoot);
    expect(facts).toHaveLength(6);
    await rm(custodyRoot, { recursive: true });
    roots.splice(roots.indexOf(custodyRoot), 1);
  });

  test("refuses disappearance after lstat instead of laundering it as absence", async () => {
    const custodyRoot = await root("physical-alias-disappearance");
    const target = resolve(custodyRoot, "moving-leaf");
    await writeFile(target, new Uint8Array());
    const linkIdentity = await lstat(target, { bigint: true });
    const disappeared = Object.assign(new Error("disappeared after lstat"), { code: "ENOENT" });
    await expect(
      observePortablePhysicalOptionalLeaf(target, {
        lstat: async () => linkIdentity,
        realpath: async () => target,
        stat: async () => {
          throw disappeared;
        },
      }),
    ).rejects.toBe(disappeared);
  });

  test("retains the distinct-existing relation when both entries are stable", async () => {
    const custodyRoot = await root("physical-alias-distinct-existing");
    const leftPath = resolve(custodyRoot, "left");
    const rightPath = resolve(custodyRoot, "right");
    await Promise.all([
      writeFile(leftPath, new Uint8Array()),
      writeFile(rightPath, new Uint8Array()),
    ]);
    const left = await observePortablePhysicalOptionalLeaf(leftPath);
    const right = await observePortablePhysicalOptionalLeaf(rightPath);
    if (left.disposition !== "EXISTING") throw new Error("expected existing left entry");
    expect(portablePhysicalAliasRelation(left, right)).toBe("DISTINCT_EXISTING");
  });
});

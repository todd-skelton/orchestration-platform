import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executePortablePhysicalBaseProbe } from "../../probes/portable-primitives/src/index.js";

const roots: string[] = [];

async function root(label: string) {
  const value = await mkdtemp(resolve(tmpdir(), `orchestration-${label}-`));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("ISS-022 existing and constructed-absent physical observations", () => {
  test("runs both rows in ledger order through one namespace and retained root handle", async () => {
    const custodyRoot = await root("physical-base");
    const facts = await executePortablePhysicalBaseProbe(custodyRoot);
    expect(facts.map(({ caseId }) => caseId)).toEqual([
      "PHYSICAL_EXISTING",
      "PHYSICAL_ABSENT_LEAF",
    ]);
    const [existing, absent] = facts;
    for (const observation of facts) {
      expect(observation.rootStable).toBe(true);
      expect(observation.rootRealpathStable).toBe(true);
      expect(observation.leafStable).toBe(true);
      expect(observation.rootBefore).toEqual(observation.rootAfter);
      expect(observation.rootBefore.namespaceFileHex).toMatch(/^[0-9a-f]{64}$/);
      expect(observation.derivation?.physicalDestinationIdentityDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(observation.derivation?.destinationDigest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(existing.rootAfter).toEqual(absent.rootBefore);
    expect(existing.derivation?.hostCustodyNamespaceDigest).toBe(
      absent.derivation?.hostCustodyNamespaceDigest,
    );
    expect(existing.derivation?.rootReadbackDigest).toBe(absent.derivation?.rootReadbackDigest);
    expect(existing.derivation?.physicalDestinationIdentityDigest).not.toBe(
      absent.derivation?.physicalDestinationIdentityDigest,
    );
    expect(JSON.stringify(facts)).not.toContain("PASS");
    expect(JSON.stringify(facts)).not.toContain(custodyRoot);
  });

  test("observes the exact regular entry and constructed ENOENT arms", async () => {
    const custodyRoot = await root("physical-leaves");
    const [existing, absent] = await executePortablePhysicalBaseProbe(custodyRoot);
    expect(existing.leafBefore).toEqual(existing.leafAfter);
    expect(existing.leafBefore.disposition).toBe("EXISTING");
    expect(existing.derivation?.physicalDestinationIdentity.leafIdentityKind).toBe(
      "EXISTING_DIRECTORY_ENTRY",
    );
    expect(absent.leafBefore).toEqual({ disposition: "ABSENT", errorCode: "ENOENT" });
    expect(absent.leafAfter).toEqual({ disposition: "ABSENT", errorCode: "ENOENT" });
    expect(absent.derivation?.physicalDestinationIdentity.leafIdentityKind).toBe(
      "ABSENT_DIRECTORY_ENTRY",
    );
    expect(absent.derivation?.physicalDestinationIdentity.canonicalPhysicalLeafBytes).toBe(
      Buffer.from("absent-leaf", "utf8").toString("base64url"),
    );
    await rm(custodyRoot, { recursive: true });
    roots.splice(roots.indexOf(custodyRoot), 1);
  });

  test("creates the session namespace exactly once and refuses root reuse or overlap", async () => {
    const custodyRoot = await root("physical-reuse");
    await executePortablePhysicalBaseProbe(custodyRoot);
    await expect(executePortablePhysicalBaseProbe(custodyRoot)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(executePortablePhysicalBaseProbe("relative")).rejects.toThrow();
    await expect(
      executePortablePhysicalBaseProbe(resolve(import.meta.dirname, "../..")),
    ).rejects.toThrow(/source-overlap/);
  });
});

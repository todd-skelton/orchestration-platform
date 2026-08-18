import { describe, expect, test } from "vitest";
import {
  compatibilityDisposition,
  compatibilityMatrix,
  migrateNamedLegacyFixture,
  parseContract,
  schemaVersions,
} from "../../packages/contracts/src/index.js";

const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const legacy = Object.freeze({
  schemaVersion: "platform-configuration/v0-fixture",
  adapterId: "portable",
  projectId,
  stateRoot: "file:///var/lib/orchestration/state",
});

describe("compatibility", () => {
  test("reads exact current versions, migrates only the named configuration fixture, and refuses future or missing versions", () => {
    expect(schemaVersions).toContain("platform-configuration/v1");
    for (const expected of schemaVersions) {
      const family = expected.slice(0, expected.lastIndexOf("/"));
      expect(compatibilityDisposition(expected, expected)).toBe("readable");
      expect(compatibilityDisposition(expected, `${family}/v999`)).toBe("refused");
      expect(compatibilityDisposition(expected, null)).toBe("refused");
    }
    expect(
      compatibilityDisposition("platform-configuration/v1", "platform-configuration/v0-fixture"),
    ).toBe("migratable");
    expect(compatibilityDisposition("unknown/v1", "unknown/v1")).toBe("refused");
    expect(compatibilityMatrix.every((row) => row.expectedSchemaVersion.endsWith("/v1"))).toBe(
      true,
    );
  });

  test("the sole migration is closed, total, deterministic, and non-mutating", () => {
    const before = JSON.stringify(legacy);
    const first = migrateNamedLegacyFixture(legacy);
    expect(first).toEqual(migrateNamedLegacyFixture(structuredClone(legacy)));
    expect(JSON.stringify(legacy)).toBe(before);
    expect(first.ok).toBe(true);
    if (first.ok) expect(parseContract("platform-configuration/v1", first.value).ok).toBe(true);
    expect(migrateNamedLegacyFixture({ ...legacy, extra: true }).ok).toBe(false);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => migrateNamedLegacyFixture(hostile)).not.toThrow();
    expect(migrateNamedLegacyFixture(hostile).ok).toBe(false);
  });
});

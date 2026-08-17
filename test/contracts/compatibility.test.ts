import { describe, expect, test } from "vitest";
import {
  compatibilityDisposition,
  compatibilityMatrix,
  migrateNamedLegacyFixture,
  parseContract,
  schemaVersions,
} from "../../packages/contracts/src/index.js";
import { fixtureFor, uuid } from "./fixtures.js";

describe("contract compatibility matrix", () => {
  test("has exact readable, named-migratable, legacy-refused, missing-refused, and future-refused rows for every family", () => {
    expect(compatibilityMatrix).toHaveLength(schemaVersions.length * 5);
    for (const expected of schemaVersions) {
      const family = expected.slice(0, expected.lastIndexOf("/"));
      expect(compatibilityDisposition(expected, expected)).toBe("readable");
      expect(compatibilityDisposition(expected, `${family}/v2`)).toBe("refused");
      expect(compatibilityDisposition(expected, `${family}/future`)).toBe("refused");
      expect(compatibilityDisposition(expected, null)).toBe("refused");
      expect(compatibilityDisposition(expected, `${family}/v0-fixture`)).toBe(
        expected === "platform-configuration/v1" ? "migratable" : "refused",
      );
    }
    expect(compatibilityDisposition("unknown/v1", "unknown/v1")).toBe("refused");
  });

  test("the sole named legacy migration is pure, closed, deterministic, and produces current readable authority", () => {
    const legacy = Object.freeze({
      schemaVersion: "platform-configuration/v0-fixture",
      adapterId: "alpha",
      projectId: uuid,
      stateRoot: "file:///var/lib/orchestration/state",
    });
    const before = JSON.stringify(legacy);
    const first = migrateNamedLegacyFixture(legacy);
    const second = migrateNamedLegacyFixture(structuredClone(legacy));
    expect(first).toEqual(second);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(first.ok).toBe(true);
    if (first.ok) expect(parseContract("platform-configuration/v1", first.value).ok).toBe(true);
    expect(migrateNamedLegacyFixture({ ...legacy, extra: true }).ok).toBe(false);
    expect(
      migrateNamedLegacyFixture({ ...legacy, schemaVersion: "platform-configuration/v0" }).ok,
    ).toBe(false);
  });

  test("a future record cannot be mistaken for current even when all other fields match", () => {
    for (const expected of schemaVersions) {
      const fixture = fixtureFor(expected);
      const family = expected.slice(0, expected.lastIndexOf("/"));
      expect(parseContract(expected, { ...fixture, schemaVersion: `${family}/v2` }).ok).toBe(false);
    }
  });

  test("legacy migration is total for hostile reflective input", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile legacy input");
        },
      },
    );
    expect(() => migrateNamedLegacyFixture(hostile)).not.toThrow();
    expect(migrateNamedLegacyFixture(hostile).ok).toBe(false);

    const accessor = {
      adapterId: "alpha",
      projectId: uuid,
      stateRoot: "file:///var/lib/orchestration/state",
      get schemaVersion() {
        return "platform-configuration/v0-fixture";
      },
    };
    class LegacyRecord {
      adapterId = "alpha";
      projectId = uuid;
      schemaVersion = "platform-configuration/v0-fixture";
      stateRoot = "file:///var/lib/orchestration/state";
    }
    const transparentProxy = new Proxy(
      {
        adapterId: "alpha",
        projectId: uuid,
        schemaVersion: "platform-configuration/v0-fixture",
        stateRoot: "file:///var/lib/orchestration/state",
      },
      {},
    );
    const symbolBearing = {
      adapterId: "alpha",
      projectId: uuid,
      schemaVersion: "platform-configuration/v0-fixture",
      stateRoot: "file:///var/lib/orchestration/state",
      [Symbol("hidden")]: true,
    };
    const validLegacy = {
      adapterId: "alpha",
      projectId: uuid,
      schemaVersion: "platform-configuration/v0-fixture",
      stateRoot: "file:///var/lib/orchestration/state",
    };
    const nonEnumerable = Object.defineProperty({ ...validLegacy }, "schemaVersion", {
      enumerable: false,
      value: validLegacy.schemaVersion,
    });
    const inherited = Object.create(validLegacy) as Record<string, unknown>;
    for (const value of [
      accessor,
      transparentProxy,
      symbolBearing,
      nonEnumerable,
      inherited,
      new LegacyRecord(),
      new Map(),
      new Date(),
    ]) {
      expect(() => migrateNamedLegacyFixture(value)).not.toThrow();
      expect(migrateNamedLegacyFixture(value).ok).toBe(false);
    }
  });
});

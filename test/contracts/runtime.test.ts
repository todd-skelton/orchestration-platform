import vm from "node:vm";
import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  frame,
  framedBytes,
  framedDigest,
  isCanonicalDecimal,
  parseCanonicalDecimal,
  snapshotClosedArray,
  snapshotClosedRecord,
} from "../../packages/contracts/src/index.js";

describe("closed snapshots and canonical primitives", () => {
  test("accepts exact mutable/sealed/frozen arrays and snapshots before reads", () => {
    for (const value of [["a"], Object.seal(["a"]), Object.freeze(["a"])]) {
      const result = snapshotClosedArray(value);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
    expect(canonicalJson({ b: 2, a: ["x"] })).toBe('{"a":["x"],"b":2}\n');
  });

  test("refuses hostile reflective objects and arrays without throwing", () => {
    class SubArray<T> extends Array<T> {}
    const hole = new Array(1);
    const crossRealm = vm.runInNewContext("[1]") as unknown;
    const customIterator = [1];
    Object.defineProperty(customIterator, Symbol.iterator, {
      value: function* () {
        yield 2;
      },
    });
    for (const value of [new SubArray(1), hole, crossRealm, customIterator]) {
      expect(() => snapshotClosedArray(value)).not.toThrow();
      expect(snapshotClosedArray(value).ok).toBe(false);
    }
    const nonEnumerable = Object.defineProperty({ a: 1 }, "a", { enumerable: false });
    const accessor = Object.defineProperty({}, "a", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const value of [
      nonEnumerable,
      accessor,
      throwingProxy,
      new Date(),
      new Map(),
      { a: "\ud800" },
    ]) {
      expect(() => snapshotClosedRecord(value, ["a"])).not.toThrow();
      expect(snapshotClosedRecord(value, ["a"]).ok).toBe(false);
    }
    expect(snapshotClosedRecord({ a: 1, [Symbol("x")]: 2 }, ["a"]).ok).toBe(false);
  });

  test("bounds canonical decimal strings before conversion", () => {
    expect(["0", "1", "9007199254740991"].every(isCanonicalDecimal)).toBe(true);
    for (const value of ["9007199254740992", "-1", "1.0", "1e3", "01", "+1", ""]) {
      expect(isCanonicalDecimal(value)).toBe(false);
      expect(() => parseCanonicalDecimal(value)).toThrow();
    }
  });

  test("pins typed canonical framing and domain separation", () => {
    const parts = [
      frame.fixed("00"),
      frame.text("portable"),
      frame.raw32("11".repeat(32)),
      frame.boundedDecimal("1"),
      frame.canonical({ z: 1, a: "é" }),
    ];
    const bytes = framedBytes("contract-golden/v1", parts);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "6f726368657374726174696f6e2d706c6174666f726d00636f6e74726163742d676f6c64656e2f7631000000000505000000000000000100010000000000000008706f727461626c650300000000000000201111111111111111111111111111111111111111111111111111111111111111060000000000000001310700000000000000117b2261223a22c3a9222c227a223a317d0a",
    );
    expect(framedDigest("contract-golden/v1", parts)).toBe(
      "a0999fd6bd4b7e4b6fc4db186dc3dd724722f97b96dac40a2b938568146f1af0",
    );
    expect(framedDigest("contract-golden-other/v1", parts)).not.toBe(
      framedDigest("contract-golden/v1", parts),
    );
    expect(() => framedBytes("contract-golden/v1", [frame.raw32("g".repeat(64))])).toThrow();
  });
});

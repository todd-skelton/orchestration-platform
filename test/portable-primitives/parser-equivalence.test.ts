import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  evaluatePortablePrimitiveParserEquivalence,
  normalizePortablePrimitiveParserCorpus,
} from "../../probes/portable-primitives/src/parser-equivalence.js";
import * as portable from "../../probes/portable-primitives/src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("ISS-022 stable parser equivalence probe", () => {
  test("pins one canonical and seven hostile ISS-002 byte cases", () => {
    expect(portable.portablePrimitiveParserCorpus.map((row) => row.caseId)).toEqual([
      "CANONICAL",
      "MISSING_FINAL_LF",
      "NONCANONICAL_KEY_ORDER",
      "UTF8_BOM",
      "INVALID_UTF8",
      "INVALID_JSON",
      "UNKNOWN_FIELD",
      "SCHEMA_MISMATCH",
    ]);
    const normalized = JSON.parse(
      new TextDecoder().decode(
        normalizePortablePrimitiveParserCorpus(portable.portablePrimitiveParserCorpus),
      ),
    ) as { results: readonly { caseId: string; issues: readonly string[]; result: string }[] };
    expect(normalized.results.map(({ caseId, result }) => ({ caseId, result }))).toEqual([
      { caseId: "CANONICAL", result: "READABLE" },
      { caseId: "MISSING_FINAL_LF", result: "REFUSED" },
      { caseId: "NONCANONICAL_KEY_ORDER", result: "REFUSED" },
      { caseId: "UTF8_BOM", result: "REFUSED" },
      { caseId: "INVALID_UTF8", result: "REFUSED" },
      { caseId: "INVALID_JSON", result: "REFUSED" },
      { caseId: "UNKNOWN_FIELD", result: "REFUSED" },
      { caseId: "SCHEMA_MISMATCH", result: "REFUSED" },
    ]);
    expect(normalized.results.map((row) => row.issues)).toEqual([
      [],
      ["encoding:noncanonical"],
      ["encoding:noncanonical"],
      ["encoding:bom-refused"],
      ["encoding:invalid-utf8"],
      ["encoding:invalid-json"],
      ["extra:unknown-field"],
      ["schemaVersion:mismatch"],
    ]);
  });

  test("runs the same exact corpus in the parent and three fresh children", async () => {
    const result = await portable.executePortablePrimitiveParserEquivalenceProbe(repositoryRoot);
    expect(result.caseId).toBe("PARSER_EQUIVALENCE");
    expect(result.childCount).toBe("3");
    expect(result.children).toHaveLength(3);
    expect(result.resultsMatch).toBe(true);
    expect(result.children.every((child) => child.outputAccepted)).toBe(true);
    expect(result.children.every((child) => child.normalizedBytesMatch)).toBe(true);
    expect(result.children.map((child) => child.normalizedDigest)).toEqual(
      Array(3).fill(result.parentNormalizedDigest),
    );
    expect(JSON.stringify(result)).not.toContain(repositoryRoot);
    expect(JSON.stringify(result)).not.toMatch(/"pid"|"PASS"/);
  }, 60_000);

  test("refuses corpus movement and never launders a missing or changed child", () => {
    expect(() =>
      normalizePortablePrimitiveParserCorpus([
        ...portable.portablePrimitiveParserCorpus.slice(0, -1),
      ]),
    ).toThrow("parserCorpus:census");
    expect(() =>
      normalizePortablePrimitiveParserCorpus([
        { ...portable.portablePrimitiveParserCorpus[0], bytesBase64url: "e30K" },
        ...portable.portablePrimitiveParserCorpus.slice(1),
      ]),
    ).toThrow("parserCorpus:literal-row-mismatch");

    const digest = "1".repeat(64);
    const accepted = Object.freeze({
      exitCode: 0,
      normalizedBytesMatch: true,
      normalizedDigest: digest,
      outputAccepted: true,
      signal: null,
    });
    expect(
      evaluatePortablePrimitiveParserEquivalence(digest, [accepted, accepted]).resultsMatch,
    ).toBe(false);
    expect(
      evaluatePortablePrimitiveParserEquivalence(digest, [
        accepted,
        accepted,
        { ...accepted, normalizedBytesMatch: false },
      ]).resultsMatch,
    ).toBe(false);
    expect(
      evaluatePortablePrimitiveParserEquivalence(digest, [
        accepted,
        accepted,
        { ...accepted, outputAccepted: false, normalizedDigest: null },
      ]).resultsMatch,
    ).toBe(false);
  });
});

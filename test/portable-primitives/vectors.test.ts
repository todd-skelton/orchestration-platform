import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import { normalizeTrackedText } from "../../scripts/tracked-text.mjs";
import * as portable from "../../probes/portable-primitives/src/index.js";

const digest = (value: string) => value.repeat(64);

function observation(caseId: portable.PortablePrimitiveCaseId) {
  const vector =
    portable.portablePrimitiveVectors[portable.portablePrimitiveCaseIds.indexOf(caseId)]!;
  return Object.freeze({
    caseId,
    detailsDigest: digest("1"),
    environmentDigest: digest("2"),
    normalizedResult: "PASS",
    observedAt: "2026-08-28T00:00:00.000Z",
    operatingSystem: "LINUX",
    schemaVersion: "portable-primitives-observation/v1",
    vectorDigest: portable.computePortablePrimitiveVectorDigest(vector),
  });
}

describe("ISS-022 portable primitive vector contracts", () => {
  test("pins the exact ordered 21-vector census", () => {
    expect(portable.portablePrimitiveCaseIds).toEqual([
      "PHYSICAL_EXISTING",
      "PHYSICAL_ABSENT_LEAF",
      "PHYSICAL_CASE_ALIAS",
      "PHYSICAL_UNICODE_ALIAS",
      "PHYSICAL_SYMLINK_SWAP",
      "PHYSICAL_PARENT_SWAP",
      "CREATE_ONCE_32_CONTENDERS",
      "LOCK_TWO_UNRELATED_PROCESSES",
      "LOCK_HOLDER_DEATH",
      "LOCK_DEFAULT_NON_INHERITANCE",
      "REPLACE_BEFORE_CREATE",
      "REPLACE_AFTER_CREATE",
      "REPLACE_AFTER_FILE_SYNC",
      "REPLACE_AFTER_RENAME",
      "REPLACE_AFTER_DIRECTORY_SYNC",
      "CAS_PREDECESSOR_MISMATCH",
      "CAS_TWO_CONTENDERS",
      "ABSENCE_HEAD_PLUS_ONE_TWO",
      "PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP",
      "HANDLE_CLONE_TRANSFER_REUSE",
      "PARSER_EQUIVALENCE",
    ]);
    expect(portable.portablePrimitiveVectors).toHaveLength(21);
    for (const caseId of portable.portablePrimitiveCaseIds) {
      expect(
        portable.parsePortablePrimitiveVectorInputs(portable.portablePrimitiveVectorInputs[caseId])
          .ok,
      ).toBe(true);
      const vector =
        portable.portablePrimitiveVectors[portable.portablePrimitiveCaseIds.indexOf(caseId)]!;
      expect(portable.parsePortablePrimitiveVector(vector).ok).toBe(true);
      expect(portable.computePortablePrimitiveVectorDigest(vector)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("pins the literal corpus and representative input rows", () => {
    expect(portable.portablePhysicalLeafCorpus).toEqual([
      "6578697374696e672d6c656166",
      "616273656e742d6c656166",
      "41",
      "61",
      "c3a9",
      "65cc81",
      "6c696e6b2d6c656166",
      "706172656e742d6c656166",
    ]);
    expect(portable.portablePhysicalLeafCorpusDigest).toBe(
      "f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe",
    );
    expect(portable.portablePrimitiveVectorInputs.CREATE_ONCE_32_CONTENDERS).toMatchObject({
      contenderCount: "32",
      expectedReadbackHex: "41",
      payloadHex: "41",
    });
    expect(portable.portablePrimitiveVectorInputs.REPLACE_AFTER_DIRECTORY_SYNC).toMatchObject({
      crashPoint: "AFTER_DIRECTORY_SYNC",
      expectedReadbackHex: "42",
      payloadHex: "42",
    });
    expect(
      portable.portablePrimitiveVectorInputs.PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP,
    ).toMatchObject({ timeoutMilliseconds: "10000" });
    expect(portable.portablePrimitiveVectorInputs.CAS_PREDECESSOR_MISMATCH).toMatchObject({
      expectedReadbackHex: "41",
      payloadHex: "42",
      predecessorHex: "42",
    });
    expect(portable.portablePrimitiveVectorInputs.CAS_TWO_CONTENDERS).toMatchObject({
      predecessorHex: "41",
    });
  });

  test("keeps every executable input row byte-equal to the authority ledger", async () => {
    const ledger = normalizeTrackedText(
      await readFile(
        new URL("../../docs/architecture/contract-decisions.md", import.meta.url),
        "utf8",
      ),
    );
    const matches = [
      ...ledger.matchAll(
        /Each line below is one complete canonical record; key order and final LF are\ncanonicalized by the landed ISS-002 rules\.\n\n```text\n([\s\S]*?)```\n/g,
      ),
    ];
    const expected = `${portable.portablePrimitiveCaseIds
      .map((caseId) => canonicalJson(portable.portablePrimitiveVectorInputs[caseId]).trimEnd())
      .join("\n")}\n`;
    expect(matches).toHaveLength(1);
    expect(matches[0]?.[1]).toBe(expected);
  });

  test("refuses every moved or caller-expanded literal vector row", () => {
    const input = portable.portablePrimitiveVectorInputs.CAS_TWO_CONTENDERS;
    const vector =
      portable.portablePrimitiveVectors[
        portable.portablePrimitiveCaseIds.indexOf("CAS_TWO_CONTENDERS")
      ]!;
    for (const mutant of [
      { ...input, contenderCount: "3" },
      { ...input, barriers: [...(input.barriers as readonly string[])].reverse() },
      { ...input, operationToken: "NODE_OPEN_EXCL_SYNC_READBACK_V1" },
      { ...input, predecessorHex: "42" },
      { ...input, extra: true },
    ])
      expect(portable.parsePortablePrimitiveVectorInputs(mutant).ok).toBe(false);
    for (const mutant of [
      { ...vector, expectedResult: "UNSUPPORTED" },
      { ...vector, inputsDigest: digest("f") },
      { ...vector, profileToken: "NODE_OPEN_EXCL_SYNC_READBACK_V1" },
      { ...vector, extra: true },
    ])
      expect(portable.parsePortablePrimitiveVector(mutant).ok).toBe(false);
  });

  test("binds observations to the literal vector and closed environment fields", () => {
    const valid = observation("PHYSICAL_ABSENT_LEAF");
    expect(portable.parsePortablePrimitiveObservation(valid).ok).toBe(true);
    expect(portable.computePortablePrimitiveObservationDigest(valid)).toMatch(/^[0-9a-f]{64}$/);
    for (const mutant of [
      { ...valid, vectorDigest: digest("f") },
      { ...valid, normalizedResult: "FAIL" },
      { ...valid, operatingSystem: "DARWIN" },
      { ...valid, observedAt: "2026-08-28T00:00:00Z" },
      { ...valid, extra: true },
    ])
      expect(portable.parsePortablePrimitiveObservation(mutant).ok).toBe(false);
  });
});

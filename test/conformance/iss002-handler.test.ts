import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import {
  createIss002VectorCensus,
  iss002StableVectorSelections,
  iss002TestBundlePaths,
  iss002VectorIds,
  runIss002StableHandler,
  type Iss002StableExecutionResult,
} from "../../packages/conformance/src/index.js";

const { generate } = (await import(
  pathToFileURL(
    resolve(import.meta.dirname, "../../packages/conformance/src/iss002-vector-generator.mjs"),
  ).href
)) as { readonly generate: (parameters: unknown) => Readonly<{ readonly caseId: string }> };

const generatorBytes = new TextEncoder().encode("stable generator bytes");
const census = createIss002VectorCensus(generatorBytes);

function passed(walk = false, marker = 1): Iss002StableExecutionResult {
  return {
    normalizedResult: "PASS",
    stderrBytes: new Uint8Array(),
    stdoutBytes: Uint8Array.from([marker]),
    walkDurationsNanoseconds: walk ? ["1", "3", "2"] : null,
  };
}

describe("ISS-002 stable vector handler", () => {
  test("owns a closed selector for every stable vector and executes each exactly once", async () => {
    expect(iss002StableVectorSelections.map((selection) => selection.fixtureId)).toEqual(
      iss002VectorIds,
    );
    expect(iss002StableVectorSelections.at(-1)).toEqual({
      fixtureId: "walk-1000-records",
      testFiles: [],
    });
    expect(
      iss002StableVectorSelections
        .slice(0, -1)
        .every(
          (selection) =>
            selection.testFiles.length > 0 &&
            selection.testFiles.every(
              (path) =>
                path.startsWith("test/contracts/") && iss002TestBundlePaths.includes(path as never),
            ),
        ),
    ).toBe(true);
    const generated: string[] = [];
    const executed: string[] = [];
    const walked: string[] = [];
    const result = await runIss002StableHandler(census, {
      executeContracts: async (selection) => {
        executed.push(selection.fixtureId);
        return passed(false, executed.length);
      },
      executeWalk: async (selection) => {
        walked.push(selection.fixtureId);
        return passed(true, 22);
      },
      generate(parameters) {
        const fixture = generate(parameters);
        generated.push(fixture.caseId);
        return fixture;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generated).toEqual(iss002VectorIds);
    expect(executed).toEqual(iss002VectorIds.slice(0, -1));
    expect(walked).toEqual(["walk-1000-records"]);
    expect(result.vectorExecutions).toEqual(
      iss002VectorIds.map((fixtureId) => ({ fixtureId, normalizedResult: "PASS" })),
    );
    expect(result.walkDurationsNanoseconds).toEqual(["1", "3", "2"]);
    expect([...result.stdoutBytes]).toEqual(Array.from({ length: 22 }, (_, index) => index + 1));
    expect(result.stderrBytes.byteLength).toBe(0);
  });

  test("preserves stable FAIL and UNSUPPORTED results without accepting a walk duration claim", async () => {
    const result = await runIss002StableHandler(census, {
      executeContracts: async (selection) => ({
        ...passed(),
        normalizedResult:
          selection.fixtureId === "authority-history-linear" ? "UNSUPPORTED" : "PASS",
      }),
      executeWalk: async () => ({
        ...passed(false),
        normalizedResult: "FAIL",
      }),
      generate,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectorExecutions[0]).toEqual({
      fixtureId: "authority-history-linear",
      normalizedResult: "UNSUPPORTED",
    });
    expect(result.vectorExecutions.at(-1)).toEqual({
      fixtureId: "walk-1000-records",
      normalizedResult: "FAIL",
    });
    expect(result.walkDurationsNanoseconds).toBeNull();
  });

  test("refuses census and execution substitutions before emitting a complete result", async () => {
    const entries = census.entries as readonly Readonly<Record<string, unknown>>[];
    for (const mutated of [
      { ...census, entries: entries.slice(1) },
      { ...census, entries: [...entries].reverse() },
      {
        ...census,
        entries: [{ ...entries[0], fixtureKind: "BYTES", generatorParameters: null }],
      },
    ])
      expect(
        (
          await runIss002StableHandler(mutated, {
            executeContracts: async () => passed(),
            executeWalk: async () => passed(true),
            generate,
          })
        ).ok,
      ).toBe(false);
    expect(
      (
        await runIss002StableHandler(census, {
          executeContracts: async () => ({ ...passed(), stdoutBytes: Buffer.from("subclass") }),
          executeWalk: async () => passed(true),
          generate,
        })
      ).ok,
    ).toBe(false);
    let executionCalls = 0;
    expect(
      (
        await runIss002StableHandler(census, {
          executeContracts: async () => {
            executionCalls += 1;
            return passed();
          },
          executeWalk: async () => {
            executionCalls += 1;
            return passed(true);
          },
          generate: () => ({ caseId: "forged", samples: [], seed: "0".repeat(64) }),
        })
      ).ok,
    ).toBe(false);
    expect(executionCalls).toBe(0);
    expect(
      (
        await runIss002StableHandler(census, {
          executeContracts: async () => passed(),
          executeWalk: async () => ({ ...passed(true), walkDurationsNanoseconds: ["1", "2"] }),
          generate,
        })
      ).ok,
    ).toBe(false);
  });
});

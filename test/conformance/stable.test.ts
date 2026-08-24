import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import * as conformance from "../../packages/conformance/src/index.js";
import * as contracts from "../../packages/contracts/src/index.js";

const generatorPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/iss002-vector-generator.mjs",
);

async function stableSource(): Promise<Uint8Array> {
  return Uint8Array.from(await readFile(generatorPath));
}

describe("stable ISS-002 conformance census", () => {
  test("pins the exact 22-row stable selector census and digest", async () => {
    const census = conformance.createIss002VectorCensus(await stableSource());
    const entries = census.entries as readonly Readonly<Record<string, unknown>>[];
    expect(entries.map((entry) => entry.fixtureId)).toEqual(conformance.iss002VectorIds);
    expect(entries).toHaveLength(22);
    expect(entries.every((entry) => entry.fixtureKind === "GENERATOR")).toBe(true);
    expect(entries.at(-1)?.generatorParameters).toMatchObject({
      caseId: "walk-1000-records",
      iterationCount: "1000",
    });
    expect(conformance.computeConformanceRecordDigest("conformance-vector-census/v1", census)).toBe(
      "3a820f880c50359974be5f28fcd7bc9a71b61b1297399c35261ee2f49c93dfa4",
    );
  });

  test("binds every fixture to the exact source bytes and closed parameters", async () => {
    const source = await stableSource();
    const census = conformance.createIss002VectorCensus(source);
    const moved = source.slice();
    moved[moved.length - 1] = moved[moved.length - 1]! ^ 1;
    const movedCensus = conformance.createIss002VectorCensus(moved);
    const entries = census.entries as readonly Readonly<Record<string, unknown>>[];
    const movedEntries = movedCensus.entries as readonly Readonly<Record<string, unknown>>[];
    expect(entries.map((entry) => entry.fixtureDigest)).not.toEqual(
      movedEntries.map((entry) => entry.fixtureDigest),
    );
    expect(
      conformance.parseConformanceVectorCensus({
        ...census,
        entries: [...entries, entries[0]],
      }).ok,
    ).toBe(false);
  });

  test("derives the exact stable contract versions and three required jobs", async () => {
    const versions = conformance.createIss002ContractVersions(contracts.schemaVersions);
    expect(versions.versions).toEqual(contracts.schemaVersions);
    const census = conformance.createIss002VectorCensus(await stableSource());
    const registry = conformance.createIss002RequiredJobRegistry(census);
    expect(registry.jobs).toEqual([
      {
        environmentFamily: "LINUX",
        jobId: "iss002-contracts-linux",
        requirement: "REQUIRED",
        suiteId: "iss002-contracts",
      },
      {
        environmentFamily: "MACOS",
        jobId: "iss002-contracts-macos",
        requirement: "REQUIRED",
        suiteId: "iss002-contracts",
      },
      {
        environmentFamily: "WINDOWS",
        jobId: "iss002-contracts-windows",
        requirement: "REQUIRED",
        suiteId: "iss002-contracts",
      },
    ]);
    expect(registry.suites).toEqual([
      {
        custodyRequirement: "UNUSED",
        helperRequirement: "UNUSED",
        ownerPackage: "@orchestration-platform/contracts",
        runnerToken: "ISS002_CONTRACTS",
        suiteId: "iss002-contracts",
        vectorCensusDigest: conformance.computeConformanceRecordDigest(
          "conformance-vector-census/v1",
          census,
        ),
        walkRequirement: "WALK_1000",
      },
    ]);
  });

  test("executes each stable generator selector once with the reviewed iteration arm", async () => {
    const generatorUrl = pathToFileURL(generatorPath).href;
    const generator = (await import(generatorUrl)) as {
      readonly generate: (parameters: unknown) => Readonly<{
        caseId: string;
        samples: readonly string[];
        seed: string;
      }>;
    };
    const census = conformance.createIss002VectorCensus(await stableSource());
    const entries = census.entries as readonly Readonly<Record<string, unknown>>[];
    const outputs = entries.map((entry) => generator.generate(entry.generatorParameters));
    expect(outputs.map((output) => output.caseId)).toEqual(conformance.iss002VectorIds);
    expect(outputs.slice(0, -1).every((output) => output.samples.length === 1)).toBe(true);
    expect(outputs.at(-1)?.samples).toHaveLength(1000);
    expect(() =>
      generator.generate({
        ...(entries[0]?.generatorParameters as Readonly<Record<string, unknown>>),
        caseId: "candidate-added",
      }),
    ).toThrow(/refused/);
  });
});

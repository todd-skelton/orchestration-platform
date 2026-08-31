import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as projectSnapshot from "../../packages/contracts/src/project-snapshot.js";

describe("current public surface", () => {
  test("adds only the two ISS-013 snapshot contracts and pure supplied-record binding helpers", () => {
    expect(Object.keys(projectSnapshot).sort()).toEqual([
      "parseAdapterConfiguration",
      "parseProjectFacts",
      "parseProjectSnapshotContract",
      "projectSnapshotSchemaFields",
      "projectSnapshotSchemaVersions",
      "validateAdapterConfigurationBinding",
      "validateProjectFactsBinding",
    ]);
    for (const [name, value] of Object.entries(projectSnapshot))
      expect(Object.entries(contracts).find(([exportName]) => exportName === name)?.[1]).toBe(
        value,
      );
  });
  test("contains no diagnostic, archive, sparse-history, inventory, coordinator, materialization, or v2/v3 authority API", () => {
    const names = Object.keys(contracts).sort();
    expect(names).not.toContain("diagnostic");
    expect(names).not.toContain("migrateNamedLegacyFixture");
    expect(names.join("\n")).not.toMatch(
      /Sparse|Inventory|Coordinator|Materialization|NodeCensus|V[23](?:$|[A-Z])/,
    );
    expect(contracts.schemaVersions.every((version) => version.endsWith("/v1"))).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as projectSnapshot from "../../packages/contracts/src/project-snapshot.js";
import * as projectBreakerFacts from "../../packages/contracts/src/project-breaker-facts.js";

describe("current public surface", () => {
  test("adds only the ISS-013 breaker fact family and pure supplied-content binding", () => {
    expect(Object.keys(projectBreakerFacts).sort()).toEqual([
      "parseProjectBreakerFacts",
      "parseProjectBreakerFactsContract",
      "projectBreakerFactsSchemaFields",
      "projectBreakerFactsSchemaVersions",
      "validateProjectBreakerFactsBinding",
    ]);
    for (const [name, value] of Object.entries(projectBreakerFacts))
      expect(Object.entries(contracts).find(([exportName]) => exportName === name)?.[1]).toBe(
        value,
      );
  });
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

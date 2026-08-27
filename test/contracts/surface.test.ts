import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

describe("current public surface", () => {
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

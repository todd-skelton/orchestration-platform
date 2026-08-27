import { describe, expect, test } from "vitest";
import {
  compatibilityDisposition,
  compatibilityMatrix,
  schemaVersions,
} from "../../packages/contracts/src/index.js";

describe("compatibility", () => {
  test("reads only exact current versions and refuses legacy, future, missing, and unknown versions", () => {
    expect(schemaVersions).toContain("platform-configuration/v1");
    for (const expected of schemaVersions) {
      const family = expected.slice(0, expected.lastIndexOf("/"));
      expect(compatibilityDisposition(expected, expected)).toBe("readable");
      expect(compatibilityDisposition(expected, `${family}/v999`)).toBe("refused");
      expect(compatibilityDisposition(expected, null)).toBe("refused");
    }
    expect(
      compatibilityDisposition("platform-configuration/v1", "platform-configuration/v0-fixture"),
    ).toBe("refused");
    expect(compatibilityDisposition("unknown/v1", "unknown/v1")).toBe("refused");
    expect(compatibilityMatrix.every((row) => row.expectedSchemaVersion.endsWith("/v1"))).toBe(
      true,
    );
  });
});

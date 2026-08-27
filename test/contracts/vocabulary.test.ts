import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  engineVocabularyFindings,
  schemaVocabularyDefinitions,
  type ContractDefinition,
} from "../../packages/contracts/src/index.js";

const forbiddenDigest = (value: string): string =>
  createHash("sha256")
    .update(`forbidden-vocabulary/v1\0${value.normalize("NFKC").toLowerCase()}\0`)
    .digest("hex");

describe("engine vocabulary lint", () => {
  test("the current registry is adapter-vocabulary neutral", () => {
    expect(engineVocabularyFindings(schemaVocabularyDefinitions)).toEqual([]);
  });

  test("seeded adapter and hashed consumer terms fail deterministically", () => {
    const seeded: Readonly<Record<string, ContractDefinition>> = {
      "seed/v1": {
        schemaVersion: "seed/v1",
        fields: ["schemaVersion", "branchName", "secretProductIdentity"],
        closedValues: ["DEPLOYMENT_READY"],
      },
    };
    const findings = engineVocabularyFindings(seeded, [forbiddenDigest("secret product")]);
    expect(findings).toHaveLength(3);
    expect(findings.join("\n")).toMatch(/adapter:branch/);
    expect(findings.join("\n")).toMatch(/adapter:deployment/);
    expect(findings.join("\n")).toMatch(/:consumer$/m);
  });
});

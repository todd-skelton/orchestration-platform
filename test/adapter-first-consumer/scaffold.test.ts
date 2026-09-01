import { describe, expect, test } from "vitest";
import { createFirstConsumerConfiguration } from "../../adapters/first-consumer/src/index.js";
import { canonicalJson, parseAdapterConfiguration } from "../../packages/contracts/src/index.js";
import {
  runFirstConsumerFootprintCollisionCheck,
  runFirstConsumerPackageBoundaryCheck,
  runFirstConsumerScaffoldCheck,
} from "./scaffold-check.mjs";

describe("first-consumer adapter scaffold", () => {
  test("admits only the exact static compatibility and export census", async () => {
    await expect(runFirstConsumerScaffoldCheck()).resolves.toEqual({
      extensions: 3,
      outcome: "PASS",
    });
  });

  test("keeps extension-owner patches disjoint from the composition root", async () => {
    await expect(runFirstConsumerFootprintCollisionCheck()).resolves.toMatchObject({
      outcome: "PASS",
      paths: [
        "adapters/first-consumer/src/import/index.ts",
        "adapters/first-consumer/src/mutation/index.ts",
        "adapters/first-consumer/src/shadow/index.ts",
      ],
    });
  });

  test("constructs one generic-parser-compatible empty conformance configuration", () => {
    const result = createFirstConsumerConfiguration("01900000-0000-7000-8000-000000000028");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseAdapterConfiguration(result.value)).toEqual({ ok: true, value: result.value });
    expect(canonicalJson(result.value)).toBe(
      '{"adapterId":"first-consumer","adapterVersion":"0.0.0","capabilityNames":["project.import","project.mutation","project.shadow"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000028","schemaVersion":"adapter-configuration/v1"}\n',
    );
  });

  test("packs only the inspected adapter boundary and excludes it from platform inputs", async () => {
    await expect(runFirstConsumerPackageBoundaryCheck()).resolves.toEqual({ outcome: "PASS" });
  });
});

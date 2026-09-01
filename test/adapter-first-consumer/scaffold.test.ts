import { describe, expect, test } from "vitest";
import {
  runFirstConsumerFootprintCollisionCheck,
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
});

import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { regularCapabilitySlot } from "../../scripts/capability-slots.mjs";
import { loadInventory, validateInventory } from "./inventory.mjs";
import { redactionTestApi } from "./redaction.mjs";
import { parseLiveArguments } from "./source-evidence.mjs";

const root = resolve(import.meta.dirname, "../..");
let baseline: Awaited<ReturnType<typeof loadInventory>>;

function mutant(): any {
  return structuredClone(baseline);
}

beforeAll(async () => {
  baseline = await loadInventory();
});

describe("sanitized reference inventory", () => {
  test("binds every artifact, entrypoint, mutation candidate, and linked uncertainty", () => {
    expect(validateInventory(baseline)).toEqual({
      artifactCount: 112,
      entrypointCount: 79,
      effectCandidateCount: 887,
      unresolved: 2,
    });
  });

  test.each([
    ["missing artifact", (snapshot: any) => snapshot.artifacts.artifacts.pop()],
    [
      "duplicate artifact",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[1] = structuredClone(snapshot.artifacts.artifacts[0]);
      },
    ],
    [
      "extra artifact",
      (snapshot: any) =>
        snapshot.artifacts.artifacts.push(structuredClone(snapshot.artifacts.artifacts[0])),
    ],
    [
      "moved artifact digest",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].pathDigest = "0".repeat(64);
      },
    ],
    [
      "changed content evidence",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].contentDigest = "0".repeat(64);
      },
    ],
    [
      "extension census mismatch",
      (snapshot: any) => {
        snapshot.source.extensionCensus.ps1 -= 1;
      },
    ],
    [
      "missing behavior classification",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].behaviorFamilyIds = [];
      },
    ],
    ["missing entrypoint", (snapshot: any) => snapshot.entrypoints.entrypoints.pop()],
    [
      "dangling entrypoint",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].artifactId = "artifact-999";
      },
    ],
    [
      "unclassified entrypoint",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].classification = "unclassified";
      },
    ],
    ["missing mutation group", (snapshot: any) => snapshot.mutations.mutationGroups.pop()],
    [
      "missing mutation authorization",
      (snapshot: any) => {
        delete snapshot.mutations.mutationGroups[0].authorizingObservationId;
      },
    ],
    [
      "missing mutation failure mode",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].failureModes = [];
      },
    ],
    [
      "missing mutation recovery",
      (snapshot: any) => {
        delete snapshot.mutations.mutationGroups[0].recoveryTransitionId;
      },
    ],
    [
      "missing idempotency rule",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].idempotency = "";
      },
    ],
    [
      "dangling authority",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].authorityId = "authority-missing";
      },
    ],
    [
      "unlinked unknown",
      (snapshot: any) => {
        snapshot.assumptions.assumptions[0].classification = "unknown";
      },
    ],
    [
      "unresolved row without probe or decision",
      (snapshot: any) => {
        delete snapshot.assumptions.assumptions.at(-1).resolution;
      },
    ],
    [
      "dangling behavior family",
      (snapshot: any) => {
        snapshot.assumptions.assumptions[0].behaviorFamilyId = "behavior-missing";
      },
    ],
    [
      "raw redaction oracle row",
      (snapshot: any) => {
        snapshot["redaction-oracle"].entries[0].digest = "consumer-brand-canary";
      },
    ],
  ])("rejects the %s mutant", (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    expect(() => validateInventory(snapshot)).toThrow(/REFERENCE_INVENTORY_MISMATCH/);
  });

  test("both exact capability slots own only the declared ISS-001 commands", async () => {
    await expect(regularCapabilitySlot(root, "ISS-001", "inventory:check")).resolves.toBe(
      resolve(root, "test/capability-slots/ISS-001/inventory%3Acheck.mjs"),
    );
    await expect(regularCapabilitySlot(root, "ISS-001", "inventory:redaction-check")).resolves.toBe(
      resolve(root, "test/capability-slots/ISS-001/inventory%3Aredaction-check.mjs"),
    );
    await expect(
      regularCapabilitySlot(root, "ISS-001", "inventory:extra"),
    ).resolves.toBeUndefined();
  });
});

describe("reference redaction controls", () => {
  test("hashed vocabulary rejects normalized token and n-gram variants", () => {
    const synthetic = "consumer-brand-canary";
    const forbidden = new Set([redactionTestApi.forbiddenDigest(synthetic)]);
    expect(redactionTestApi.textFindings(`prefix ${synthetic} suffix`, forbidden)).toContain(
      "forbidden-vocabulary",
    );
  });

  test("rejects local paths, credential canaries, and high-entropy canaries", () => {
    const localPath = ["C:", "Users", "operator", "source"].join("\\");
    const credential = ["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("_");
    const entropy = ["AbCdEfGhIjKlMnOp", "QrStUvWxYz012345", "6789AbCdEfGhIjKl", "MnOp"].join("");
    const findings = redactionTestApi.textFindings(
      `${localPath}\n${credential}\n${entropy}`,
      new Set(),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        "absolute-local-path",
        "credential-or-secret",
        "high-entropy-canary",
      ]),
    );
  });

  test("rejects package evidence paths and inventory markers", () => {
    expect(() =>
      redactionTestApi.validatePackedFile(
        "reference/manifest/source.json",
        Buffer.from("{}"),
        new Set(),
      ),
    ).toThrow(/reference\/test evidence/);
    expect(() =>
      redactionTestApi.validatePackedFile(
        "src/index.ts",
        Buffer.from('export const marker = "reference-artifact-inventory/v1";'),
        new Set(),
      ),
    ).toThrow(/inventory material/);
  });

  test("rejects copied source chunks without retaining source text", () => {
    const source = "source evidence block ".repeat(12);
    expect(redactionTestApi.copiedSourceBytes([source], [`prefix ${source} suffix`])).toBe(true);
    expect(redactionTestApi.copiedSourceBytes([source], ["independent neutral evidence"])).toBe(
      false,
    );
  });

  test("live comparison flags are exact, complete, and duplicate-free", () => {
    expect(parseLiveArguments([])).toBeUndefined();
    expect(
      parseLiveArguments([
        "--",
        "--source-repository",
        "fixture",
        "--source-commit",
        "0".repeat(40),
        "--source-subtree",
        "controller",
      ]),
    ).toEqual({ repository: "fixture", commit: "0".repeat(40), subtree: "controller" });
    expect(() => parseLiveArguments(["--source-repository", "fixture"])).toThrow(
      /requires all source flags/,
    );
    expect(() =>
      parseLiveArguments([
        "--source-repository",
        "fixture-a",
        "--source-repository",
        "fixture-b",
        "--source-commit",
        "0".repeat(40),
      ]),
    ).toThrow(/duplicate live comparison flag/);
  });
});

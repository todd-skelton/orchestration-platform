import { beforeAll, describe, expect, test } from "vitest";
import {
  loadPlanningSnapshot,
  validatePlanningSnapshot,
  type PlanningSnapshot,
} from "../scripts/planning/check.mjs";

let baseline: PlanningSnapshot;

function mutant(): PlanningSnapshot {
  return structuredClone(baseline);
}

function issue(snapshot: PlanningSnapshot, key: string): Record<string, any> {
  return snapshot.roadmap.issues.find((row: Record<string, any>) => row.key === key);
}

beforeAll(async () => {
  baseline = await loadPlanningSnapshot();
});

describe("planning contract", () => {
  test("accepts the authoritative roadmap and generated DAG mirrors", () => {
    expect(() => validatePlanningSnapshot(baseline)).not.toThrow();
  });

  test.each([
    ["missing draft", (snapshot: PlanningSnapshot) => delete snapshot.issueDrafts["ISS-000"]],
    [
      "frontmatter key",
      (snapshot: PlanningSnapshot) => {
        snapshot.issueDrafts["ISS-000"] = snapshot.issueDrafts["ISS-000"]!.replace(
          "key: ISS-000",
          "key: ISS-999",
        );
      },
    ],
    [
      "parent",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").parent = "EPIC-KERNEL";
      },
    ],
    [
      "milestone",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").milestone = "MISSING";
      },
    ],
    [
      "direct blocked-by edge",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-001").blockedBy = [];
      },
    ],
    [
      "cycle",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").blockedBy = ["ISS-001"];
        snapshot.issueDrafts["ISS-000"] = snapshot.issueDrafts["ISS-000"]!.replace(
          "blocked_by: []",
          "blocked_by: [ISS-001]",
        );
      },
    ],
    [
      "epic membership",
      (snapshot: PlanningSnapshot) => {
        snapshot.epicDrafts["EPIC-RUNTIME"] = snapshot.epicDrafts["EPIC-RUNTIME"]!.replace(
          /\s+ISS-000,\r?\n/,
          "\n",
        );
      },
    ],
    [
      "generated DAG",
      (snapshot: PlanningSnapshot) => {
        snapshot.epicDrafts["EPIC-RUNTIME"] = snapshot.epicDrafts["EPIC-RUNTIME"]!.replace(
          "`ISS-000 → ISS-001`",
          "`ISS-002 → ISS-001`",
        );
      },
    ],
    [
      "missing verification wrapper",
      (snapshot: PlanningSnapshot) => {
        delete snapshot.rootPackage.scripts["inventory:check"];
      },
    ],
    [
      "wrong placeholder owner",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["inventory:check"] =
          "node scripts/capability-not-implemented.mjs ISS-999 inventory:check";
      },
    ],
    [
      "reverted implemented contracts wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["contracts:compatibility-check"] =
          "node scripts/capability-not-implemented.mjs ISS-002 contracts:compatibility-check";
      },
    ],
    [
      "reverted implemented contracts package test",
      (snapshot: PlanningSnapshot) => {
        snapshot.packageManifests["@orchestration-platform/contracts"]!.scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-002 @orchestration-platform/contracts:test";
      },
    ],
    [
      "reverted implemented CLI package test",
      (snapshot: PlanningSnapshot) => {
        snapshot.packageManifests["@orchestration-platform/cli"]!.scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-003 @orchestration-platform/cli:test";
      },
    ],
    [
      "reverted implemented config package test",
      (snapshot: PlanningSnapshot) => {
        snapshot.packageManifests["@orchestration-platform/config"]!.scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-003 @orchestration-platform/config:test";
      },
    ],
    [
      "reverted implemented adapter SDK package test",
      (snapshot: PlanningSnapshot) => {
        snapshot.packageManifests["@orchestration-platform/adapter-sdk"]!.scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-013 @orchestration-platform/adapter-sdk:test";
      },
    ],
    [
      "reverted implemented harness wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["harness:test"] =
          "node scripts/capability-not-implemented.mjs ISS-006 harness:test";
      },
    ],
    [
      "reverted ISS-022 probe wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["probe:portable-primitives"] =
          "node scripts/capability-not-implemented.mjs ISS-022 probe:portable-primitives";
      },
    ],
    [
      "reverted ISS-022 receipt verification wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["probe:portable-primitives:verify-receipts"] =
          "node scripts/capability-not-implemented.mjs ISS-022 probe:portable-primitives:verify-receipts";
      },
    ],
    [
      "reverted workflow mutation wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["test:harness-workflow-mutations"] =
          "node scripts/capability-not-implemented.mjs ISS-006 test:harness-workflow-mutations";
      },
    ],
    [
      "reverted ISS-041 cycle wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["skeleton:cycle"] =
          "node scripts/capability-not-implemented.mjs ISS-041 skeleton:cycle";
      },
    ],
    [
      "reverted ISS-041 negative-controls wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["skeleton:negative-controls"] =
          "node scripts/capability-not-implemented.mjs ISS-041 skeleton:negative-controls";
      },
    ],
    [
      "wrapper defaults",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts.bootstrap += " --state-root .state";
      },
    ],
    [
      "extra root wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["unowned:command"] = "node nowhere.mjs";
      },
    ],
    [
      "extra capability slot",
      (snapshot: PlanningSnapshot) => {
        snapshot.capabilitySlots.push({
          issue: "ISS-001",
          name: "extra.mjs",
          isDirectory: true,
          directorySymlink: false,
          isFile: true,
          isSymbolicLink: false,
        });
      },
    ],
    [
      "removed ISS-046 finding-census slot",
      (snapshot: PlanningSnapshot) => {
        snapshot.capabilitySlots = snapshot.capabilitySlots.filter(
          (slot) => slot.issue !== "ISS-046" || slot.name !== "planning%3Afinding-census-check.mjs",
        );
      },
    ],
    [
      "duplicate verification capability owner",
      (snapshot: PlanningSnapshot) => {
        snapshot.issueDrafts["ISS-040"] = snapshot.issueDrafts["ISS-040"]!.replace(
          "test:planning-module-proportionality",
          "test:module-simplification-findings",
        );
      },
    ],
  ])("rejects the %s mutant", (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(/PLANNING_CONTRACT_MISMATCH/);
  });
});

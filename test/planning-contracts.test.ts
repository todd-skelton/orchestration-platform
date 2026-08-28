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
      "reverted implemented harness wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["harness:test"] =
          "node scripts/capability-not-implemented.mjs ISS-006 harness:test";
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

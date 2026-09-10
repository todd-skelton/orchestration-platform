import { describe, expect, test } from "vitest";
import {
  loadPlanningSnapshot,
  parseFrontmatter,
  validatePlanningSnapshot,
  type PlanningSnapshot,
} from "../scripts/planning/check.mjs";

function draft(key: string, milestone: string, blockedBy: string[] = []): string {
  const edges = blockedBy.length === 0 ? "[]" : `[${blockedBy.join(", ")}]`;
  return [
    "---",
    `key: ${key}`,
    `title: "Do the ${key} thing"`,
    'labels: ["type:slice"]',
    `milestone: "${milestone}"`,
    `blocked_by: ${edges}`,
    "---",
    "",
    "## Why",
    "",
    "Because.",
    "",
  ].join("\n");
}

function synthetic(): PlanningSnapshot {
  return {
    roadmap: {
      schemaVersion: "orchestration-roadmap/v1",
      repository: "todd-skelton/orchestration-platform",
      project: {
        id: "PVT_synthetic",
        number: 1,
        title: "Delivery",
        url: "https://github.com/users/todd-skelton/projects/1",
      },
      milestones: [
        { key: "M1", title: "First" },
        { key: "M2", title: "Second" },
      ],
      issues: [
        { key: "ISS-100", file: "planning/drafts/ISS-100.md", milestone: "M1", blockedBy: [] },
        {
          key: "ISS-101",
          file: "planning/drafts/ISS-101.md",
          milestone: "M1",
          blockedBy: ["ISS-100"],
        },
        {
          key: "ISS-102",
          file: "planning/drafts/ISS-102.md",
          milestone: "M2",
          blockedBy: ["ISS-100", "ISS-101"],
        },
      ],
    },
    issueDrafts: {
      "ISS-100": draft("ISS-100", "First"),
      "ISS-101": draft("ISS-101", "First", ["ISS-100"]),
      "ISS-102": draft("ISS-102", "Second", ["ISS-100", "ISS-101"]),
    },
  };
}

function issue(snapshot: PlanningSnapshot, key: string): Record<string, any> {
  return snapshot.roadmap.issues.find((row: Record<string, any>) => row.key === key);
}

describe("planning contract", () => {
  test("accepts the repository roadmap and drafts", async () => {
    expect(() => validatePlanningSnapshot(synthetic())).not.toThrow();
    const real = await loadPlanningSnapshot();
    expect(() => validatePlanningSnapshot(real)).not.toThrow();
    expect(real.roadmap.issues.length).toBeGreaterThan(0);
  });

  test("parses inline and multi-line frontmatter arrays", () => {
    const parsed = parseFrontmatter(
      '---\nkey: ISS-100\ntitle: "x"\nblocked_by:\n  [\n    ISS-101,\n    ISS-102,\n  ]\n---\nbody\n',
      "f",
    );
    expect(parsed.blocked_by).toEqual(["ISS-101", "ISS-102"]);
    expect(parsed.title).toBe("x");
  });

  test.each([
    ["schema", (s: PlanningSnapshot) => void (s.roadmap.schemaVersion = "other")],
    ["repository", (s: PlanningSnapshot) => void (s.roadmap.repository = "other/repo")],
    ["project url", (s: PlanningSnapshot) => void (s.roadmap.project.url = "http://insecure")],
    ["missing draft", (s: PlanningSnapshot) => void delete s.issueDrafts["ISS-102"]],
    [
      "extra draft",
      (s: PlanningSnapshot) => void (s.issueDrafts["ISS-103"] = draft("ISS-103", "First")),
    ],
    ["wrong file path", (s: PlanningSnapshot) => void (issue(s, "ISS-100").file = "x.md")],
    ["unknown milestone", (s: PlanningSnapshot) => void (issue(s, "ISS-100").milestone = "M9")],
    [
      "duplicate milestone title",
      (s: PlanningSnapshot) => void (s.roadmap.milestones[1].title = "First"),
    ],
    [
      "frontmatter key mismatch",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(
          "key: ISS-100",
          "key: ISS-999",
        )),
    ],
    [
      "frontmatter milestone mismatch",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(
          'milestone: "First"',
          'milestone: "Second"',
        )),
    ],
    [
      "missing title",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(/title: .*\n/, "")),
    ],
    ["edge mismatch", (s: PlanningSnapshot) => void (issue(s, "ISS-101").blockedBy = [])],
    [
      "unknown dependency",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-101").blockedBy = ["ISS-999"];
        s.issueDrafts["ISS-101"] = draft("ISS-101", "First", ["ISS-999"]);
      },
    ],
    [
      "self dependency",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-101").blockedBy = ["ISS-101"];
        s.issueDrafts["ISS-101"] = draft("ISS-101", "First", ["ISS-101"]);
      },
    ],
    [
      "cycle",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-100").blockedBy = ["ISS-102"];
        s.issueDrafts["ISS-100"] = draft("ISS-100", "First", ["ISS-102"]);
      },
    ],
    [
      "duplicate issue key",
      (s: PlanningSnapshot) => void s.roadmap.issues.push({ ...issue(s, "ISS-100") }),
    ],
  ])("refuses %s", (_name, mutate) => {
    const snapshot = synthetic();
    mutate(snapshot);
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(/PLANNING_CONTRACT_MISMATCH/);
  });

  test("allows transitively implied direct edges", () => {
    const snapshot = synthetic();
    expect(issue(snapshot, "ISS-102").blockedBy).toEqual(["ISS-100", "ISS-101"]);
    expect(() => validatePlanningSnapshot(snapshot)).not.toThrow();
  });
});

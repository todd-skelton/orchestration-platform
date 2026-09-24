import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { iss206Draft } from "./fixtures/iss206.js";
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
    "## Done when",
    "",
    "- Preserve behavior.",
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

  test("rejects PR #647's ISS-206 Acceptance heading; only Done when repairs it", async () => {
    const snapshot = synthetic();
    snapshot.roadmap.milestones = [{ key: "M1", title: "Unattended self-improvement" }];
    snapshot.roadmap.issues = [
      { key: "ISS-206", file: "planning/drafts/ISS-206.md", milestone: "M1", blockedBy: [] },
    ];
    snapshot.issueDrafts = { "ISS-206": iss206Draft };
    const diagnostic =
      "PLANNING_CONTRACT_MISMATCH: planning/drafts/ISS-206.md requires ## Done when with supported list items (-, *, + or top-level N.)";
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(diagnostic);

    // Run the actual CLI against an otherwise valid, isolated planning tree.
    // Match Node's resolved entry path even when macOS tmpdir() uses a /var alias.
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "planning-criteria-")));
    try {
      await mkdir(resolve(root, "planning/drafts"), { recursive: true });
      await mkdir(resolve(root, "scripts/planning"), { recursive: true });
      const checker = resolve(root, "scripts/planning/check.mjs");
      await copyFile(resolve(import.meta.dirname, "../scripts/planning/check.mjs"), checker);
      await writeFile(resolve(root, "planning/roadmap.json"), JSON.stringify(snapshot.roadmap));
      const path = resolve(root, "planning/drafts/ISS-206.md");
      await writeFile(path, iss206Draft);
      const execute = () => promisify(execFile)(process.execPath, [checker], { cwd: root });
      await expect(execute()).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(diagnostic),
      });

      snapshot.issueDrafts["ISS-206"] = iss206Draft.replace("## Acceptance", "## Done when");
      expect(() => validatePlanningSnapshot(snapshot)).not.toThrow();
      await writeFile(path, snapshot.issueDrafts["ISS-206"]);
      await expect(execute()).resolves.toMatchObject({ stderr: "" });
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  test.each([
    ["missing heading", "## Why\n\n- Not acceptance"],
    ["empty section", "## Done when\n\n"],
    ["prose only", "## Done when\n\nNot a list."],
    ["unsupported list", "## Done when\n\n1) Not supported"],
  ])("rejects %s in an unready later-milestone sibling", (_name, section) => {
    const snapshot = synthetic();
    snapshot.issueDrafts["ISS-102"] = snapshot.issueDrafts["ISS-102"]!.replace(
      "## Done when\n\n- Preserve behavior.\n",
      `${section}\n\n## Out of scope\n\n- Not acceptance either.\n`,
    );
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(
      "PLANNING_CONTRACT_MISMATCH: planning/drafts/ISS-102.md requires ## Done when with supported list items",
    );
  });

  test.each([
    ["unknown roadmap schema", (s: PlanningSnapshot) => void (s.roadmap.schemaVersion = "other")],
    [
      "roadmap repository mismatch",
      (s: PlanningSnapshot) => void (s.roadmap.repository = "other/repo"),
    ],
    [
      "roadmap delivery project registration is malformed",
      (s: PlanningSnapshot) => void (s.roadmap.project.url = "http://insecure"),
    ],
    [
      "registered issue drafts and filesystem issue drafts differ",
      (s: PlanningSnapshot) => void delete s.issueDrafts["ISS-102"],
    ],
    [
      "registered issue drafts and filesystem issue drafts differ",
      (s: PlanningSnapshot) => void (s.issueDrafts["ISS-103"] = draft("ISS-103", "First")),
    ],
    [
      "ISS-100 file must be planning/drafts/ISS-100.md",
      (s: PlanningSnapshot) => void (issue(s, "ISS-100").file = "x.md"),
    ],
    [
      "ISS-100 has unknown milestone M9",
      (s: PlanningSnapshot) => void (issue(s, "ISS-100").milestone = "M9"),
    ],
    [
      "duplicate milestone title First",
      (s: PlanningSnapshot) => void (s.roadmap.milestones[1].title = "First"),
    ],
    [
      "ISS-100 frontmatter key mismatch",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(
          "key: ISS-100",
          "key: ISS-999",
        )),
    ],
    [
      "ISS-100 frontmatter milestone mismatch",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(
          'milestone: "First"',
          'milestone: "Second"',
        )),
    ],
    [
      "ISS-100 frontmatter title missing",
      (s: PlanningSnapshot) =>
        void (s.issueDrafts["ISS-100"] = s.issueDrafts["ISS-100"]!.replace(/title: .*\n/, "")),
    ],
    [
      "ISS-101 blocked-by edges mismatch",
      (s: PlanningSnapshot) => void (issue(s, "ISS-101").blockedBy = []),
    ],
    [
      "ISS-101 has unknown dependency ISS-999",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-101").blockedBy = ["ISS-999"];
        s.issueDrafts["ISS-101"] = draft("ISS-101", "First", ["ISS-999"]);
      },
    ],
    [
      "ISS-101 blockedBy must list distinct other issue keys",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-101").blockedBy = ["ISS-101"];
        s.issueDrafts["ISS-101"] = draft("ISS-101", "First", ["ISS-101"]);
      },
    ],
    [
      "dependency cycle includes ISS-100",
      (s: PlanningSnapshot) => {
        issue(s, "ISS-100").blockedBy = ["ISS-102"];
        s.issueDrafts["ISS-100"] = draft("ISS-100", "First", ["ISS-102"]);
      },
    ],
    [
      "duplicate issue key ISS-100",
      (s: PlanningSnapshot) => void s.roadmap.issues.push({ ...issue(s, "ISS-100") }),
    ],
  ])("refuses %s", (diagnostic, mutate) => {
    const snapshot = synthetic();
    mutate(snapshot);
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(
      `PLANNING_CONTRACT_MISMATCH: ${diagnostic}`,
    );
  });

  test("allows transitively implied direct edges", () => {
    const snapshot = synthetic();
    expect(issue(snapshot, "ISS-102").blockedBy).toEqual(["ISS-100", "ISS-101"]);
    expect(() => validatePlanningSnapshot(snapshot)).not.toThrow();
  });
});

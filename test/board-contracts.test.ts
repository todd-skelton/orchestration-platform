import { describe, expect, test } from "vitest";
import type { PlanningSnapshot } from "../scripts/planning/check.mjs";
import {
  expectedBoardItems,
  boardSnapshotFromGraphqlPages,
  normalizeBody,
  planningKeyOf,
  projectSnapshotFromGraphqlPages,
  validateBoardSnapshot,
  validatePlanningProjects,
  type BoardSnapshot,
  type ProjectSnapshot,
} from "../scripts/planning/board-check.mjs";

function draft(key: string, milestone: string, blockedBy: string[] = []): string {
  const edges = blockedBy.length === 0 ? "[]" : `[${blockedBy.join(", ")}]`;
  return `---\nkey: ${key}\ntitle: "Do ${key}"\nlabels: ["type:slice"]\nmilestone: "${milestone}"\nblocked_by: ${edges}\n---\n\n## Why\n\nBecause.\n`;
}

function planningSnapshot(): PlanningSnapshot {
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
        { key: "ISS-102", file: "planning/drafts/ISS-102.md", milestone: "M2", blockedBy: [] },
      ],
    },
    issueDrafts: {
      "ISS-100": draft("ISS-100", "First"),
      "ISS-101": draft("ISS-101", "First", ["ISS-100"]),
      "ISS-102": draft("ISS-102", "Second"),
    },
  };
}

const planning = planningSnapshot();

function synthesizeBoard(snapshot: PlanningSnapshot): BoardSnapshot {
  let next = 100;
  const issues = expectedBoardItems(snapshot).map((item) => ({
    number: next++,
    title: item.title,
    body: item.body,
    milestone: item.milestone,
    state: "OPEN" as const,
  }));
  return { repository: snapshot.roadmap.repository, totalCount: issues.length, issues };
}

const baseline = synthesizeBoard(planning);

function mutant(): BoardSnapshot {
  return structuredClone(baseline);
}

function item(board: BoardSnapshot, key: string): BoardSnapshot["issues"][number] {
  return board.issues.find((row) => planningKeyOf(row.body) === key)!;
}

function synthesizeProjects(board: BoardSnapshot): { destination: ProjectSnapshot } {
  const destinationItems = board.issues.map((row, index) => ({
    id: `destination-${index}`,
    repository: planning.roadmap.repository,
    number: row.number,
  }));
  return {
    destination: {
      id: planning.roadmap.project.id,
      title: planning.roadmap.project.title,
      totalCount: destinationItems.length,
      items: destinationItems,
    },
  };
}

describe("board contract", () => {
  test("accepts a board that mirrors every registered draft", () => {
    expect(() => validateBoardSnapshot(planning, baseline)).not.toThrow();
    expect(baseline.issues.map((row) => planningKeyOf(row.body))).toEqual([
      "ISS-100",
      "ISS-101",
      "ISS-102",
    ]);
  });

  test("expected bodies carry the marker, the draft link and the verbatim draft", () => {
    const [first] = expectedBoardItems(planning);
    expect(first!.title).toBe("[ISS-100] Do ISS-100");
    expect(first!.milestone).toBe("First");
    expect(first!.body.split("\n").slice(0, 4)).toEqual([
      "<!-- planning-key: ISS-100 -->",
      "",
      "Source draft: [`planning/drafts/ISS-100.md`](https://github.com/todd-skelton/orchestration-platform/blob/main/planning/drafts/ISS-100.md)",
      "",
    ]);
    expect(first!.body.endsWith(planning.issueDrafts["ISS-100"]!)).toBe(true);
  });

  test("ignores board items with no planning key", () => {
    const board = mutant();
    board.issues.push({
      number: 900,
      title: "An operator note",
      body: "Not a planning draft.",
      milestone: null,
      state: "OPEN",
    });
    board.totalCount += 1;
    expect(() => validateBoardSnapshot(planning, board)).not.toThrow();
  });

  test("treats closed items as history", () => {
    const board = mutant();
    board.issues.push({
      number: 901,
      title: "[ISS-042] Retired slice",
      body: "<!-- planning-key: ISS-042 -->\n\nold plan",
      milestone: "Old milestone",
      state: "CLOSED",
    });
    board.totalCount += 1;
    const done = item(board, "ISS-102");
    done.state = "CLOSED";
    done.body = "<!-- planning-key: ISS-102 -->\n\nstale body from before it shipped";
    expect(() => validateBoardSnapshot(planning, board)).not.toThrow();
  });

  test.each([
    [
      "drifted issue title",
      (board: BoardSnapshot) => {
        item(board, "ISS-101").title = "[ISS-101] Do something else";
      },
    ],
    [
      "drifted milestone",
      (board: BoardSnapshot) => {
        item(board, "ISS-101").milestone = "Second";
      },
    ],
    [
      "stale blocked-by edges in the body",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-101");
        row.body = row.body.replace("blocked_by: [ISS-100]", "blocked_by: []");
      },
    ],
    [
      "missing draft link",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-100");
        row.body = row.body.replace(/Source draft: .*\n/, "");
      },
    ],
    [
      "missing open item",
      (board: BoardSnapshot) => {
        board.issues = board.issues.filter((row) => planningKeyOf(row.body) !== "ISS-100");
        board.totalCount -= 1;
      },
    ],
    [
      "duplicate open planning key",
      (board: BoardSnapshot) => {
        board.issues.push({ ...item(board, "ISS-100"), number: 902 });
        board.totalCount += 1;
      },
    ],
    [
      "unregistered open planning key",
      (board: BoardSnapshot) => {
        board.issues.push({
          number: 903,
          title: "[ISS-777] Retired slice",
          body: "<!-- planning-key: ISS-777 -->\n\nleftover",
          milestone: null,
          state: "OPEN",
        });
        board.totalCount += 1;
      },
    ],
    [
      "duplicate issue numbers",
      (board: BoardSnapshot) => {
        board.issues[1]!.number = board.issues[0]!.number;
      },
    ],
  ])("refuses %s", (_name, apply) => {
    const board = mutant();
    apply(board);
    expect(() => validateBoardSnapshot(planning, board)).toThrow(/BOARD_CONTRACT_MISMATCH/);
  });

  test("normalizes line endings and trailing whitespace but not content", () => {
    const board = mutant();
    const row = item(board, "ISS-100");
    row.body = row.body.replace(/\n/g, "\r\n") + "   \n\n";
    expect(() => validateBoardSnapshot(planning, board)).not.toThrow();
    expect(normalizeBody("a \r\nb\n\n")).toBe("a\nb");
  });

  function issueNodes(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      title: `issue ${index + 1}`,
      body: "",
      milestone: null,
      state: "OPEN",
      labels: { nodes: index === 0 ? [{ name: "ready" }] : [] },
    }));
  }

  test("reconciles a complete cap-crossing GraphQL census against totalCount", () => {
    const nodes = issueNodes(101);
    const pages = [
      {
        data: {
          repository: {
            issues: {
              totalCount: 101,
              nodes: nodes.slice(0, 100),
              pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
            },
          },
        },
      },
      {
        data: {
          repository: {
            issues: {
              totalCount: 101,
              nodes: nodes.slice(100),
              pageInfo: { hasNextPage: false, endCursor: "cursor-101" },
            },
          },
        },
      },
    ];
    expect(boardSnapshotFromGraphqlPages("owner/repository", pages)).toEqual({
      repository: "owner/repository",
      totalCount: 101,
      issues: nodes.map(({ labels, ...node }) => ({
        ...node,
        labels: labels.nodes.map(({ name }) => name),
      })),
    });
  });

  test("refuses a cap-boundary first page without its authoritative remainder", () => {
    expect(() =>
      boardSnapshotFromGraphqlPages("owner/repository", [
        {
          data: {
            repository: {
              issues: {
                totalCount: 101,
                nodes: issueNodes(100),
                pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
              },
            },
          },
        },
      ]),
    ).toThrow(/stopped before the final page/);
  });

  test.each([
    [
      "moving totalCount",
      (pages: any[]) => {
        pages[1].data.repository.issues.totalCount = 102;
      },
      /totalCount moved/,
    ],
    [
      "early final page followed by rows",
      (pages: any[]) => {
        pages[0].data.repository.issues.pageInfo.hasNextPage = false;
      },
      /returned rows after its final page/,
    ],
    [
      "missing cursor",
      (pages: any[]) => {
        pages[0].data.repository.issues.pageInfo.endCursor = null;
      },
      /cursor is missing or repeated/,
    ],
    [
      "repeated cursor",
      (pages: any[]) => {
        pages.splice(1, 0, {
          data: {
            repository: {
              issues: {
                totalCount: 101,
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
              },
            },
          },
        });
      },
      /cursor is missing or repeated/,
    ],
  ])("refuses issue pagination mutant: %s", (_name, mutate, expected) => {
    const nodes = issueNodes(101);
    const pages = [
      {
        data: {
          repository: {
            issues: {
              totalCount: 101,
              nodes: nodes.slice(0, 100),
              pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
            },
          },
        },
      },
      {
        data: {
          repository: {
            issues: {
              totalCount: 101,
              nodes: nodes.slice(100),
              pageInfo: { hasNextPage: false, endCursor: "cursor-101" },
            },
          },
        },
      },
    ];
    mutate(pages);
    expect(() => boardSnapshotFromGraphqlPages("owner/repository", pages)).toThrow(expected);
  });

  test("accepts exact destination project membership", () => {
    const projects = synthesizeProjects(baseline);
    expect(() => validatePlanningProjects(planning, baseline, projects.destination)).not.toThrow();
  });

  test("ignores unrelated non-Issue Project items and closed issues", () => {
    const board = mutant();
    item(board, "ISS-102").state = "CLOSED";
    const projects = synthesizeProjects(board);
    projects.destination.items = projects.destination.items.filter(
      (row) => row.number !== item(board, "ISS-102").number,
    );
    projects.destination.items.push(
      { id: "draft-1", repository: undefined, number: undefined },
      { id: "draft-2", repository: undefined, number: undefined },
    );
    projects.destination.totalCount = projects.destination.items.length;
    expect(() => validatePlanningProjects(planning, board, projects.destination)).not.toThrow();
  });

  test.each([
    [
      "missing destination item",
      (projects: ReturnType<typeof synthesizeProjects>) => {
        projects.destination.items.pop();
        projects.destination.totalCount -= 1;
      },
    ],
    [
      "duplicate destination item",
      (projects: ReturnType<typeof synthesizeProjects>) => {
        projects.destination.items.push({
          ...projects.destination.items[0]!,
          id: "duplicate",
        });
        projects.destination.totalCount += 1;
      },
    ],
  ])("refuses project mismatch: %s", (_name, mutate) => {
    const projects = synthesizeProjects(baseline);
    mutate(projects);
    expect(() => validatePlanningProjects(planning, baseline, projects.destination)).toThrow(
      /BOARD_CONTRACT_MISMATCH/,
    );
  });

  function projectNodes(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `item-${index}`,
      content: { number: index + 1, repository: { nameWithOwner: "owner/repository" } },
    }));
  }

  function projectPages(project: { id: string; title: string }, nodes: any[]) {
    return [
      {
        data: {
          node: {
            ...project,
            items: {
              totalCount: 101,
              nodes: nodes.slice(0, 100),
              pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
            },
          },
        },
      },
      {
        data: {
          node: {
            ...project,
            items: {
              totalCount: 101,
              nodes: nodes.slice(100),
              pageInfo: { hasNextPage: false, endCursor: "cursor-101" },
            },
          },
        },
      },
    ];
  }

  test("accepts a complete 101-row Project census", () => {
    const project = { id: "project-id", title: "Project" };
    const snapshot = projectSnapshotFromGraphqlPages(
      project,
      projectPages(project, projectNodes(101)),
    );
    expect(snapshot.totalCount).toBe(101);
    expect(snapshot.items).toHaveLength(101);
  });

  test.each([
    [
      "wrong project identity",
      (pages: any[]) => {
        pages[0].data.node.id = "other";
      },
      /names the wrong project/,
    ],
    [
      "moving totalCount",
      (pages: any[]) => {
        pages[1].data.node.items.totalCount = 102;
      },
      /totalCount moved/,
    ],
    [
      "early final page followed by rows",
      (pages: any[]) => {
        pages[0].data.node.items.pageInfo.hasNextPage = false;
      },
      /returned rows after its final page/,
    ],
    [
      "missing cursor",
      (pages: any[]) => {
        pages[0].data.node.items.pageInfo.endCursor = null;
      },
      /cursor is missing or repeated/,
    ],
    [
      "cap boundary without remainder",
      (pages: any[]) => {
        pages.pop();
      },
      /stopped before the final page/,
    ],
  ])("refuses Project pagination mutant: %s", (_name, mutate, expected) => {
    const project = { id: "project-id", title: "Project" };
    const pages = projectPages(project, projectNodes(101));
    mutate(pages);
    expect(() => projectSnapshotFromGraphqlPages(project, pages)).toThrow(expected);
  });
});

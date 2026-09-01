import { beforeAll, describe, expect, test } from "vitest";
import { loadPlanningSnapshot, type PlanningSnapshot } from "../scripts/planning/check.mjs";
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

let planning: PlanningSnapshot;
let baseline: BoardSnapshot;

/** Epic board numbers are assigned by GitHub; the fixture pins a stable set. */
const epicNumbers = new Map<string, number>([
  ["EPIC-ADOPTION", 1],
  ["EPIC-KERNEL", 2],
  ["EPIC-MODULES", 3],
  ["EPIC-RUNTIME", 4],
  ["EPIC-SELFHOST", 5],
]);

function synthesizeBoard(snapshot: PlanningSnapshot): BoardSnapshot {
  let next = 100;
  const issues = expectedBoardItems(snapshot, epicNumbers).map((item) => ({
    number: item.isEpic ? epicNumbers.get(item.key)! : next++,
    title: item.title,
    body: item.body,
    milestone: item.milestone,
  }));
  return { repository: snapshot.roadmap.repository, totalCount: issues.length, issues };
}

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

beforeAll(async () => {
  planning = await loadPlanningSnapshot();
  baseline = synthesizeBoard(planning);
});

describe("board contract", () => {
  test("accepts a board that mirrors every registered draft", () => {
    expect(() => validateBoardSnapshot(planning, baseline)).not.toThrow();
  });

  test("covers every registered epic and issue", () => {
    const keys = baseline.issues.map((row) => planningKeyOf(row.body));
    expect(keys).toHaveLength(planning.roadmap.epics.length + planning.roadmap.issues.length);
  });

  test("ignores board items with no planning key", () => {
    const board = mutant();
    board.issues.push({
      number: 900,
      title: "Decision: disposition ISS-000 after eight attempt rounds",
      body: "An operator decision record that is not a planning draft.",
      milestone: null,
    });
    board.totalCount += 1;
    expect(() => validateBoardSnapshot(planning, board)).not.toThrow();
  });

  test.each([
    [
      "drifted issue title",
      (board: BoardSnapshot) => {
        item(board, "ISS-011").title =
          "[ISS-011] Package portable planning, delivery, and review skills";
      },
    ],
    [
      "drifted epic title",
      (board: BoardSnapshot) => {
        item(board, "EPIC-MODULES").title = "Epic: Package modules";
      },
    ],
    [
      "drifted milestone",
      (board: BoardSnapshot) => {
        item(board, "ISS-041").milestone = "Chase Sets adoption";
      },
    ],
    [
      "milestone on an epic",
      (board: BoardSnapshot) => {
        item(board, "EPIC-KERNEL").milestone = "Minimum orchestration kernel";
      },
    ],
    [
      "stale blocked-by edges in the body",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-019");
        row.body = row.body.replace(
          "blocked_by: [ISS-020, ISS-039, ISS-040]",
          "blocked_by: [ISS-006, ISS-020, ISS-039, ISS-040]",
        );
      },
    ],
    [
      "stale labels in the body",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-036");
        row.body = row.body.replace('"type:slice"', '"type:probe"');
      },
    ],
    [
      "wrong parent epic reference",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-041");
        row.body = row.body.replace("Parent epic: #2", "Parent epic: #4");
      },
    ],
    [
      "missing source draft link",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-040");
        row.body = row.body.replace(/^Source draft: .*$/m, "");
      },
    ],
    [
      "missing board item",
      (board: BoardSnapshot) => {
        board.issues = board.issues.filter((row) => planningKeyOf(row.body) !== "ISS-041");
      },
    ],
    [
      "missing epic item",
      (board: BoardSnapshot) => {
        board.issues = board.issues.filter((row) => planningKeyOf(row.body) !== "EPIC-SELFHOST");
      },
    ],
    [
      "duplicate planning key",
      (board: BoardSnapshot) => {
        const row = item(board, "ISS-002");
        board.issues.push({ ...row, number: 901 });
      },
    ],
    [
      "unregistered planning key",
      (board: BoardSnapshot) => {
        board.issues.push({
          number: 902,
          title: "[ISS-777] Retired slice",
          body: "<!-- planning-key: ISS-777 -->\n\nleftover",
          milestone: null,
        });
      },
    ],
  ])("refuses %s", (_name, apply) => {
    const board = mutant();
    apply(board);
    expect(() => validateBoardSnapshot(planning, board)).toThrow(/BOARD_CONTRACT_MISMATCH/);
  });

  test("normalizes line endings and trailing whitespace but not content", () => {
    const board = mutant();
    const row = item(board, "ISS-003");
    row.body = row.body.replace(/\n/g, "\r\n") + "   \n\n";
    expect(() => validateBoardSnapshot(planning, board)).not.toThrow();
    expect(normalizeBody("a \r\nb\n\n")).toBe("a\nb");
  });

  test("reconciles a complete cap-crossing GraphQL census against totalCount", () => {
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      number: index + 1,
      title: `issue ${index + 1}`,
      body: "",
      milestone: null,
    }));
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
      issues: nodes,
    });
  });

  test("refuses a cap-boundary first page without its authoritative remainder", () => {
    const nodes = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `issue ${index + 1}`,
      body: "",
      milestone: null,
    }));
    expect(() =>
      boardSnapshotFromGraphqlPages("owner/repository", [
        {
          data: {
            repository: {
              issues: {
                totalCount: 101,
                nodes,
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
  ])("refuses issue pagination mutant: %s", (_name, mutate, expected) => {
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      number: index + 1,
      title: `issue ${index + 1}`,
      body: "",
      milestone: null,
      state: "OPEN",
      stateReason: null,
    }));
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

  test("refuses a repeated issue pagination cursor", () => {
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      number: index + 1,
      title: `issue ${index + 1}`,
      body: "",
      milestone: null,
      state: "OPEN",
      stateReason: null,
    }));
    expect(() =>
      boardSnapshotFromGraphqlPages("owner/repository", [
        {
          data: {
            repository: {
              issues: {
                totalCount: 101,
                nodes: nodes.slice(0, 50),
                pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
              },
            },
          },
        },
        {
          data: {
            repository: {
              issues: {
                totalCount: 101,
                nodes: nodes.slice(50, 100),
                pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
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
      ]),
    ).toThrow(/cursor is missing or repeated/);
  });

  test("refuses duplicate issue numbers even when count matches", () => {
    const board = mutant();
    board.issues[1]!.number = board.issues[0]!.number;
    expect(() => validateBoardSnapshot(planning, board)).toThrow(/malformed or duplicated/);
  });

  test("accepts exact destination project membership", () => {
    const projects = synthesizeProjects(baseline);
    expect(() => validatePlanningProjects(planning, baseline, projects.destination)).not.toThrow();
  });

  test("ignores unrelated non-Issue Project items without aliasing their identity", () => {
    const projects = synthesizeProjects(baseline);
    projects.destination.items.push(
      { id: "draft-1", repository: undefined, number: undefined },
      { id: "draft-2", repository: undefined, number: undefined },
    );
    projects.destination.totalCount += 2;
    expect(() => validatePlanningProjects(planning, baseline, projects.destination)).not.toThrow();
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
      /PROJECT_MISMATCH|BOARD_CONTRACT_MISMATCH/,
    );
  });

  test("refuses a project provider cap boundary without its second page", () => {
    const project = { id: "project-id", title: "Project" };
    const nodes = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
      content: { number: index + 1, repository: { nameWithOwner: "owner/repository" } },
    }));
    expect(() =>
      projectSnapshotFromGraphqlPages(project, [
        {
          data: {
            node: {
              ...project,
              items: {
                totalCount: 101,
                nodes,
                pageInfo: { hasNextPage: true, endCursor: "cursor-100" },
              },
            },
          },
        },
      ]),
    ).toThrow(/stopped before the final page/);
  });

  test("accepts a complete 101-row Project census", () => {
    const project = { id: "project-id", title: "Project" };
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index}`,
      content: { number: index + 1, repository: { nameWithOwner: "owner/repository" } },
    }));
    const snapshot = projectSnapshotFromGraphqlPages(project, [
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
    ]);
    expect(snapshot.totalCount).toBe(101);
    expect(snapshot.items).toHaveLength(101);
  });

  test.each([
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
  ])("refuses Project pagination mutant: %s", (_name, mutate, expected) => {
    const project = { id: "project-id", title: "Project" };
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index}`,
      content: { number: index + 1, repository: { nameWithOwner: "owner/repository" } },
    }));
    const pages = [
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
    mutate(pages);
    expect(() => projectSnapshotFromGraphqlPages(project, pages)).toThrow(expected);
  });

  test("refuses a repeated Project pagination cursor", () => {
    const project = { id: "project-id", title: "Project" };
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index}`,
      content: { number: index + 1, repository: { nameWithOwner: "owner/repository" } },
    }));
    expect(() =>
      projectSnapshotFromGraphqlPages(project, [
        {
          data: {
            node: {
              ...project,
              items: {
                totalCount: 101,
                nodes: nodes.slice(0, 50),
                pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
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
                nodes: nodes.slice(50, 100),
                pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
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
      ]),
    ).toThrow(/cursor is missing or repeated/);
  });
});

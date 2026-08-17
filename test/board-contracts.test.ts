import { beforeAll, describe, expect, test } from "vitest";
import { loadPlanningSnapshot, type PlanningSnapshot } from "../scripts/planning/check.mjs";
import {
  expectedBoardItems,
  normalizeBody,
  planningKeyOf,
  validateBoardSnapshot,
  type BoardSnapshot,
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
  return { repository: snapshot.roadmap.repository, issues };
}

function mutant(): BoardSnapshot {
  return structuredClone(baseline);
}

function item(board: BoardSnapshot, key: string): BoardSnapshot["issues"][number] {
  return board.issues.find((row) => planningKeyOf(row.body) === key)!;
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
        item(board, "ISS-039").milestone = "Self-hosting release";
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
          "blocked_by: [ISS-020, ISS-030]",
          "blocked_by: [ISS-006, ISS-020, ISS-030]",
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
        const row = item(board, "ISS-039");
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
});

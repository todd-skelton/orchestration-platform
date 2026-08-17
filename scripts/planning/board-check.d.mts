import type { PlanningSnapshot } from "./check.d.mts";

export interface BoardItem {
  number: number;
  title: string;
  body: string;
  milestone: string | null;
}

export interface BoardSnapshot {
  repository: string;
  issues: BoardItem[];
}

export interface ExpectedBoardItem {
  key: string;
  isEpic: boolean;
  title: string;
  milestone: string | null;
  body: string;
}

export declare function normalizeBody(value: unknown): string;
export declare function planningKeyOf(body: unknown): string | undefined;
export declare function expectedBoardItems(
  planning: PlanningSnapshot,
  epicNumbers: Map<string, number>,
): ExpectedBoardItem[];
export declare function indexBoardByKey(board: BoardSnapshot): Map<string, BoardItem>;
export declare function boardMismatches(planning: PlanningSnapshot, board: BoardSnapshot): string[];
export declare function validateBoardSnapshot(
  planning: PlanningSnapshot,
  board: BoardSnapshot,
): void;
export declare function loadBoardSnapshot(repository: string): Promise<BoardSnapshot>;

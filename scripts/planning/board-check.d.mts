import type { PlanningSnapshot } from "./check.d.mts";

export interface BoardItem {
  number: number;
  title: string;
  body: string;
  milestone: string | null;
}

export interface BoardSnapshot {
  repository: string;
  totalCount: number;
  issues: BoardItem[];
}

export interface ExpectedBoardItem {
  key: string;
  isEpic: boolean;
  title: string;
  milestone: string | null;
  body: string;
}

export interface ProjectItem {
  id: string;
  repository: string | undefined;
  number: number | undefined;
}

export interface ProjectSnapshot {
  id: string;
  title: string;
  totalCount: number;
  items: ProjectItem[];
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
export declare function boardSnapshotFromGraphqlPages(
  repository: string,
  pages: unknown,
): BoardSnapshot;
export declare function loadBoardSnapshot(repository: string): Promise<BoardSnapshot>;
export declare function projectSnapshotFromGraphqlPages(
  project: { id: string; title: string },
  pages: unknown,
): ProjectSnapshot;
export declare function validatePlanningProjects(
  planning: PlanningSnapshot,
  board: BoardSnapshot,
  destinationProject: ProjectSnapshot,
): void;
export declare function planningProjectMismatches(
  planning: PlanningSnapshot,
  board: BoardSnapshot,
  destinationProject: ProjectSnapshot,
): string[];
export declare function loadProjectSnapshot(project: {
  id: string;
  title: string;
}): Promise<ProjectSnapshot>;

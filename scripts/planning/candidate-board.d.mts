import type { PlanningSnapshot } from "./check.mjs";
export function candidatePlanningBase(
  worktree: string,
  head: string,
  gitExecutable?: string,
): Promise<PlanningSnapshot>;
export function candidatePlanningKeys(
  base: PlanningSnapshot,
  candidate: PlanningSnapshot,
): Set<string>;
export function checkCandidateBoard(
  worktree: string,
  head: string,
  gitExecutable?: string,
): Promise<void>;

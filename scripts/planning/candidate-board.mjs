import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadPlanningSnapshot, validatePlanningSnapshot } from "./check.mjs";
import {
  boardMismatches,
  loadBoardSnapshot,
  loadProjectSnapshot,
  normalizeBody,
  planningKeyOf,
  planningProjectMismatches,
} from "./board-check.mjs";

const exec = promisify(execFile);

// ISS-148: compare both sides so deleted/omitted registrations remain candidate-owned.
export function candidatePlanningKeys(base, candidate) {
  const keys = new Set();
  const before = new Map(base.roadmap.issues.map((row) => [row.key, row]));
  const after = new Map(candidate.roadmap.issues.map((row) => [row.key, row]));
  const milestones = (snapshot, row) =>
    snapshot.roadmap.milestones.find((m) => m.key === row?.milestone);
  for (const key of new Set([
    ...before.keys(),
    ...after.keys(),
    ...Object.keys(base.issueDrafts),
    ...Object.keys(candidate.issueDrafts),
  ])) {
    if (
      JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)) ||
      normalizeBody(base.issueDrafts[key]) !== normalizeBody(candidate.issueDrafts[key]) ||
      JSON.stringify(milestones(base, before.get(key))) !==
        JSON.stringify(milestones(candidate, after.get(key))) ||
      JSON.stringify(base.roadmap.project) !== JSON.stringify(candidate.roadmap.project)
    )
      keys.add(key);
  }
  return keys;
}

export async function checkCandidateBoard(worktree, head, gitExecutable = "git") {
  const git = async (args) =>
    (
      await exec(gitExecutable, ["-C", worktree, ...args], { maxBuffer: 32 * 1024 * 1024 })
    ).stdout.trimEnd();
  const base = await git(["merge-base", "refs/remotes/origin/main", head]);
  const roadmap = JSON.parse(await git(["show", `${base}:planning/roadmap.json`]));
  const issueDrafts = Object.fromEntries(
    await Promise.all(
      roadmap.issues.map(async (row) => [row.key, await git(["show", `${base}:${row.file}`])]),
    ),
  );
  const candidate = await loadPlanningSnapshot(worktree);
  validatePlanningSnapshot(candidate);
  const keys = candidatePlanningKeys({ roadmap, issueDrafts }, candidate);
  const planning = {
    ...candidate,
    roadmap: {
      ...candidate.roadmap,
      issues: candidate.roadmap.issues.filter((row) => keys.has(row.key)),
    },
  };
  const board = await loadBoardSnapshot(roadmap.repository);
  const project = await loadProjectSnapshot(candidate.roadmap.project);
  const issues = board.issues.filter((row) => keys.has(planningKeyOf(row.body)));
  const scopedBoard = { ...board, issues, totalCount: issues.length };
  const numbers = new Set(issues.map((row) => row.number));
  const scopedProject = {
    ...project,
    items: project.items.filter(
      (row) => row.repository === roadmap.repository && numbers.has(row.number),
    ),
  };
  const problems = [
    ...boardMismatches(planning, scopedBoard),
    ...planningProjectMismatches(planning, scopedBoard, scopedProject),
  ];
  if (problems.length) throw new Error(`BOARD_CONTRACT_MISMATCH: ${problems.join("; ")}`);
}

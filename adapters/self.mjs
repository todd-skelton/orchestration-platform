import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadPlanningSnapshot,
  parseFrontmatter,
  validatePlanningSnapshot,
} from "../scripts/planning/check.mjs";
import {
  expectedBoardItems,
  indexBoardByKey,
  loadBoardSnapshot,
  planningKeyOf,
  validateBoardSnapshot,
} from "../scripts/planning/board-check.mjs";
import { DeliveryBlocked } from "../scripts/dogfood/delivery.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXPECTED_REPOSITORY = "todd-skelton/orchestration-platform";
const REQUIRED_CHECKS = [
  "Node 24 / ubuntu-latest",
  "Node 24 / windows-latest",
  "Node 24 / macos-latest",
];
const runFile = promisify(execFile);

function requirePolicy(condition, reason) {
  if (!condition) throw new DeliveryBlocked(reason);
}

function validateRepository(repository) {
  requirePolicy(repository === EXPECTED_REPOSITORY, "wrong-self-repository");
}

function policy(config) {
  validateRepository(config.repository);
  const value = config.policy;
  requirePolicy(
    value &&
      Object.keys(value).length === 4 &&
      ["key", "number", "title", "sourceBranch"].every((key) => Object.hasOwn(value, key)) &&
      /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value.key) &&
      Number.isSafeInteger(value.number) &&
      value.number > 0 &&
      typeof value.title === "string" &&
      value.title.length > 0 &&
      typeof value.sourceBranch === "string" &&
      /^codex\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(value.sourceBranch) &&
      !value.sourceBranch.endsWith(".lock"),
    "unsupported-self-delivery-policy",
  );
  requirePolicy(
    config.issue === `https://github.com/${EXPECTED_REPOSITORY}/issues/${value.number}`,
    "wrong-self-issue",
  );
  requirePolicy(
    REQUIRED_CHECKS.every(
      (name) => config.requiredChecks.filter((candidate) => candidate === name).length === 1,
    ) && config.requiredChecks.length === REQUIRED_CHECKS.length,
    "wrong-self-hosted-checks",
  );
  return value;
}

function boardByKey(board) {
  const open = new Map();
  const closed = new Set();
  for (const issue of board.issues) {
    const key = planningKeyOf(issue.body);
    if (!key) continue;
    if (issue.state === "CLOSED") closed.add(key);
    else open.set(key, issue);
  }
  return { open, closed };
}

export async function selectCandidates({ repository, executorRoot, planning, board }) {
  validateRepository(repository);
  if (!planning || !board)
    [planning, board] = await Promise.all([
      loadPlanningSnapshot(executorRoot),
      loadBoardSnapshot(repository),
    ]);
  validatePlanningSnapshot(planning);
  validateBoardSnapshot(planning, board);
  const observed = boardByKey(board);
  const earliest = planning.roadmap.milestones.find((milestone) =>
    planning.roadmap.issues.some(
      (issue) => issue.milestone === milestone.key && observed.open.has(issue.key),
    ),
  );
  if (!earliest) return [];
  return planning.roadmap.issues
    .filter((candidate) => candidate.milestone === earliest.key)
    .sort((left, right) => left.key.localeCompare(right.key))
    .flatMap((issue) => {
      const item = observed.open.get(issue.key);
      if (!item?.labels?.includes("ready")) return [];
      const frontmatter = parseFrontmatter(planning.issueDrafts[issue.key], issue.file);
      const blockers = frontmatter.blocked_by ?? [];
      return blockers.every((key) => observed.closed.has(key) && !observed.open.has(key))
        ? [{ key: issue.key, number: item.number }]
        : [];
    });
}

function listItems(section) {
  const items = [];
  let current;
  for (const line of section.split(/\r?\n/)) {
    const item = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (item) {
      if (current) items.push(current);
      current = item[1].trim();
    } else if (current && /^\s+\S/.test(line)) current += `\n${line.trim()}`;
  }
  if (current) items.push(current);
  return items;
}

export async function issueContext({ repository, key, executorRoot }) {
  validateRepository(repository);
  const planning = await loadPlanningSnapshot(executorRoot);
  const registered = planning.roadmap.issues.find((issue) => issue.key === key);
  requirePolicy(registered, "selected-issue-unregistered");
  const draft = planning.issueDrafts[key];
  const frontmatter = parseFrontmatter(draft, registered.file);
  const section = /\n## Done when\s*\n([\s\S]*?)(?=\n## |$)/.exec(draft)?.[1]?.trim();
  requirePolicy(section, "selected-issue-criteria-missing");
  const acceptanceCriteria = listItems(section);
  requirePolicy(acceptanceCriteria.length > 0, "selected-issue-criteria-missing");
  const loopRules = await readFile(resolve(executorRoot, "docs/loop.md"), "utf8");
  return {
    title: frontmatter.title,
    body: draft,
    acceptanceCriteria,
    rules: `${loopRules.trimEnd()}\n\nKeep the loop smaller: prefer deleting to adding.\n`,
  };
}

export function branchName({ key, attempt }) {
  return `codex/${key.toLowerCase()}${attempt === 1 ? "" : `-attempt-${attempt}`}`;
}

export function requiredChecks({ repository }) {
  validateRepository(repository);
  return [...REQUIRED_CHECKS];
}

export function localGates({ repository }) {
  validateRepository(repository);
  return ["typecheck", "format:check", "test"];
}

function describeLineChanges({ added, deleted }) {
  const net = added - deleted;
  return `${added} added, ${deleted} deleted, net ${net > 0 ? "+" : ""}${net}`;
}

export async function candidateLineChanges(config, gitExecutable) {
  policy(config);
  let stdout;
  try {
    ({ stdout } = await runFile(
      gitExecutable,
      [
        "-C",
        config.worktree,
        "diff",
        "--numstat",
        "--no-renames",
        `refs/remotes/origin/main...${config.candidateHead}`,
      ],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch {
    throw new DeliveryBlocked("self-publication-diff-unavailable");
  }
  const changes = {
    total: { added: 0, deleted: 0 },
    scripts: { added: 0, deleted: 0 },
    test: { added: 0, deleted: 0 },
  };
  for (const row of stdout.trim().split(/\r?\n/)) {
    if (!row) continue;
    const [addedText, deletedText, ...pathParts] = row.split("\t");
    if (addedText === "-" && deletedText === "-") continue;
    const added = Number(addedText);
    const deleted = Number(deletedText);
    const path = pathParts.join("\t");
    requirePolicy(
      Number.isSafeInteger(added) && Number.isSafeInteger(deleted) && path.length > 0,
      "self-publication-diff-unavailable",
    );
    changes.total.added += added;
    changes.total.deleted += deleted;
    const group = path.startsWith("scripts/")
      ? changes.scripts
      : path.startsWith("test/")
        ? changes.test
        : undefined;
    if (group) {
      group.added += added;
      group.deleted += deleted;
    }
  }
  return changes;
}

function publication(config, lineChanges) {
  const value = policy(config);
  return {
    sourceBranch: value.sourceBranch,
    baseBranch: "main",
    title: `[${value.key}] ${value.title}`,
    body: `Closes #${value.number}\n\nLine changes:\n- Total: ${describeLineChanges(lineChanges.total)}\n- Source (\`scripts/\`): ${describeLineChanges(lineChanges.scripts)}\n- Tests (\`test/\`): ${describeLineChanges(lineChanges.test)}`,
    draft: true,
  };
}

export async function pullRequest({ config, gitExecutable }) {
  return publication(config, await candidateLineChanges(config, gitExecutable));
}

function planningMirror(config, planning, board) {
  const value = policy(config);
  requirePolicy(planning?.roadmap?.repository === EXPECTED_REPOSITORY, "wrong-planning-repository");
  const index = indexBoardByKey(board);
  const seed = board.issues.find((item) => item.number === value.number);
  if (!index.has(value.key) && seed && planningKeyOf(seed.body) === undefined)
    index.set(value.key, seed);
  const actual = index.get(value.key);
  requirePolicy(actual?.number === value.number, "self-planning-identity-mismatch");
  const target = expectedBoardItems(planning).find((item) => item.key === value.key);
  requirePolicy(target, "self-draft-target-missing");
  return {
    gates: {
      beforeMirror: [],
      afterMirror: ["planning:board-check"],
    },
    drafts: [
      {
        key: value.key,
        issue: actual.number,
        title: target.title,
        body: target.body,
        attributes: { milestone: target.milestone },
      },
    ],
  };
}

export async function mirrorPlanning({ config }) {
  policy(config);
  const [planning, board] = await Promise.all([
    loadPlanningSnapshot(config.worktree),
    loadBoardSnapshot(config.repository),
  ]);
  return planningMirror(config, planning, board);
}

export function mergeMethod({ config }) {
  policy(config);
  return { method: "squash" };
}

export function afterMerge({ config }) {
  policy(config);
}

export function selfPlanFromSnapshots(config, planning, board, lineChanges) {
  const mirror = planningMirror(config, planning, board);
  const pr = publication(config, lineChanges);
  return {
    ...mirror,
    gates: {
      beforeMirror: localGates({ repository: config.repository }),
      afterMirror: mirror.gates.afterMirror,
    },
    publication: pr,
    mergePolicy: mergeMethod({ config }),
    cleanup: { worktrees: [config.worktree, config.reviewWorktree], branch: pr.sourceBranch },
  };
}

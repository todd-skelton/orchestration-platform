import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadPlanningSnapshot } from "../planning/check.mjs";
import {
  expectedBoardItems,
  indexBoardByKey,
  loadBoardSnapshot,
  planningKeyOf,
} from "../planning/board-check.mjs";
import { DeliveryBlocked } from "./delivery.mjs";

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

function validatePolicy(config) {
  const value = config.policy;
  const keys = [
    "kind",
    "planningKey",
    "planningIssue",
    "sourceBranch",
    "baseBranch",
    "pullRequestTitle",
    "pullRequestBody",
  ];
  requirePolicy(
    value &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)) &&
      value.kind === "orchestration-platform-self/v1" &&
      /^ISS-\d{3}$/.test(value.planningKey) &&
      Number.isSafeInteger(value.planningIssue) &&
      value.planningIssue > 0 &&
      value.baseBranch === "main" &&
      typeof value.sourceBranch === "string" &&
      /^codex\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(value.sourceBranch) &&
      !value.sourceBranch.split("/").some((part) => part === "." || part === "..") &&
      !value.sourceBranch.endsWith(".lock") &&
      typeof value.pullRequestTitle === "string" &&
      value.pullRequestTitle.length > 0 &&
      typeof value.pullRequestBody === "string" &&
      value.pullRequestBody.length > 0,
    "unsupported-self-delivery-policy",
  );
  requirePolicy(config.repository === EXPECTED_REPOSITORY, "wrong-self-repository");
  requirePolicy(
    config.issue === `https://github.com/${EXPECTED_REPOSITORY}/issues/${value.planningIssue}`,
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

function describeLineChanges({ added, deleted }) {
  const net = added - deleted;
  return `${added} added, ${deleted} deleted, net ${net > 0 ? "+" : ""}${net}`;
}

export async function candidateLineChanges(config, gitExecutable) {
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
        `refs/remotes/origin/${config.policy.baseBranch}...${config.candidateHead}`,
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

export function selfPlanFromSnapshots(config, planning, board, lineChanges) {
  const value = validatePolicy(config);
  requirePolicy(planning?.roadmap?.repository === EXPECTED_REPOSITORY, "wrong-planning-repository");
  const index = indexBoardByKey(board);
  const seed = board.issues.find((item) => item.number === value.planningIssue);
  if (!index.has(value.planningKey) && seed && planningKeyOf(seed.body) === undefined) {
    index.set(value.planningKey, seed);
  }
  const actual = index.get(value.planningKey);
  requirePolicy(actual?.number === value.planningIssue, "self-planning-identity-mismatch");
  const target = expectedBoardItems(planning).find((item) => item.key === value.planningKey);
  requirePolicy(target, "self-draft-target-missing");
  return {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [
      {
        key: value.planningKey,
        issue: actual.number,
        title: target.title,
        body: target.body,
        attributes: { milestone: target.milestone },
      },
    ],
    publication: {
      sourceBranch: value.sourceBranch,
      baseBranch: value.baseBranch,
      title: value.pullRequestTitle,
      body: `${value.pullRequestBody}\n\nLine changes:\n- Total: ${describeLineChanges(lineChanges.total)}\n- Source (\`scripts/\`): ${describeLineChanges(lineChanges.scripts)}\n- Tests (\`test/\`): ${describeLineChanges(lineChanges.test)}`,
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: { worktrees: [config.worktree, config.reviewWorktree], branch: value.sourceBranch },
  };
}

export function selfDeliveryPolicy(gitExecutable = "git") {
  return {
    async plan(config) {
      validatePolicy(config);
      const [planning, board, lineChanges] = await Promise.all([
        loadPlanningSnapshot(config.worktree),
        loadBoardSnapshot(config.repository),
        candidateLineChanges(config, gitExecutable),
      ]);
      return selfPlanFromSnapshots(config, planning, board, lineChanges);
    },
  };
}

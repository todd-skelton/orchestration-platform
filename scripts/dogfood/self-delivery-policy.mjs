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

export function selfPlanFromSnapshots(config, planning, board) {
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
      body: value.pullRequestBody,
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: { worktrees: [config.worktree, config.reviewWorktree], branch: value.sourceBranch },
  };
}

export function selfDeliveryPolicy() {
  return {
    async plan(config) {
      validatePolicy(config);
      const [planning, board] = await Promise.all([
        loadPlanningSnapshot(config.worktree),
        loadBoardSnapshot(config.repository),
      ]);
      return selfPlanFromSnapshots(config, planning, board);
    },
  };
}

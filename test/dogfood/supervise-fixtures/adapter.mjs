import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { QueueBlocked } from "../../../scripts/dogfood/queue.ts";
let sourceObserved = false;
export {
  currentCandidateAttempt,
  hasStartedDelivery,
  queueStep,
  validateLoopConfig,
} from "../../../scripts/dogfood/queue.ts";
export { QueueBlocked };
export {
  completeCycle,
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  startCycle,
  stopCycle,
} from "../../../scripts/dogfood/supervision.ts";

export async function validateLoopExecutor(loop, executingRoot) {
  await Promise.all([
    mkdir(loop.stateRoot, { recursive: true }),
    mkdir(loop.worktreeRoot, { recursive: true }),
  ]);
  return {
    executor: executingRoot,
    stateRoot: loop.stateRoot,
    worktreeRoot: loop.worktreeRoot,
    controllerRevision: "a".repeat(40),
  };
}

export async function loadRepositoryAdapter() {
  return {
    selectCandidates: async () => {
      const issue = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-issue.json"),
      );
      return issue.state === "OPEN" ? [{ key: "ISS-105", number: 362 }] : [];
    },
    issueContext: () => ({
      title: "fixture",
      body: "fixture body",
      acceptanceCriteria: ["fixture criterion"],
      rules: "fixture rules",
    }),
    branchName: () => "codex/iss-105",
    pullRequest: () => {
      throw new Error("unused pullRequest");
    },
    requiredChecks: () => ["linux", "windows", "macos"],
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: () => {},
  };
}

export async function queueConfigFromLoop(
  loop,
  executingRoot,
  selected,
  _repositoryAdapter,
  initialHistory,
) {
  const stateDirectory = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-queue`);
  const sourceState = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-source`);
  const repairState = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-repair`);
  const sourceWorktree = resolve(loop.worktreeRoot, `${selected.key.toLowerCase()}-source`);
  const reviewWorktree = resolve(loop.worktreeRoot, `${selected.key.toLowerCase()}-review`);
  const controller = `loop:${loop.run}`;
  await Promise.all(
    [stateDirectory, sourceState, repairState].map((path) => mkdir(path, { recursive: true })),
  );
  const base = selected.base;
  const issue = `https://github.com/${loop.repository}/issues/${selected.number}`;
  const requiredChecks = ["linux", "windows", "macos"];
  const item = {
    id: `${selected.key}:1`,
    issue,
    base,
    implementationAttempt: 1,
    implementationAttemptCeiling: loop.attemptCeiling,
    setup: {
      controller,
      run: loop.run,
      issue,
      base,
      repository: loop.repository,
      controllerRoot: executingRoot,
      controllerRevision: base,
      pilotRevision: base,
      sourceWorktree,
      reviewWorktree,
      pilotWorktree: resolve(loop.worktreeRoot, `${selected.key.toLowerCase()}-pilot`),
    },
    source: {
      owner: controller,
      run: loop.run,
      issue,
      base,
      pilotRevision: base,
      worktree: sourceWorktree,
      reviewWorktree,
      stateDirectory: sourceState,
      allowedPaths: ["."],
      repository: loop.repository,
      requiredChecks,
    },
    repair: {
      stateDirectory: repairState,
      acceptanceCriteria: ["fixture criterion"],
      author: { model: loop.author.model, effort: loop.author.effort, prompt: "author" },
      reviewer: { model: loop.reviewer.model, effort: loop.reviewer.effort, prompt: "reviewer" },
    },
    delivery: { requiredChecks, policy: { kind: "fixture" } },
  };
  const config = {
    schemaVersion: "dogfood-bounded-queue-config/v1",
    controller,
    run: loop.run,
    controllerRoot: executingRoot,
    controllerRevision: base,
    stateDirectory,
    limit: 1,
    nativeLaunchCeiling: loop.nativeLaunchCeiling,
    initialHistory,
    items: [item],
  };
  return config;
}

export function repositorySupervisionAdapter() {
  const issuePath = (config) => resolve(config.stateRoot, config.run, "command-issue.json");
  const readIssue = async (config) => readJson(issuePath(config));
  const writeIssue = async (config, issue) =>
    writeFile(issuePath(config), `${JSON.stringify(issue)}\n`);
  return {
    async currentMain(config) {
      const controls = await readJson(
        resolve(config.stateRoot, config.run, "command-controls.json"),
        {},
      );
      return controls.main ?? "a".repeat(40);
    },
    async issue(config) {
      return readIssue(config);
    },
    async removeReady(config) {
      const issue = await readIssue(config);
      issue.labels = issue.labels.filter((label) => label !== "ready");
      await writeIssue(config, issue);
    },
    async restoreReady(config) {
      const issue = await readIssue(config);
      if (!issue.labels.includes("ready")) issue.labels.push("ready");
      await writeIssue(config, issue);
    },
    async close(config) {
      const issue = await readIssue(config);
      issue.state = "CLOSED";
      await writeIssue(config, issue);
    },
    async comment(config, _number, body) {
      const issue = await readIssue(config);
      issue.comments.push(body);
      await writeIssue(config, issue);
    },
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function repositoryQueueAdapter(config, _executingRoot, options) {
  if (process.env.PATH.split(delimiter)[0] !== dirname(options.gitExecutable))
    throw new Error("selected-git-missing-from-worker-path");
  const history = async () => {
    const participants = [...config.initialHistory];
    for (
      let ordinal = config.initialHistory.length + 1;
      ordinal <= config.nativeLaunchCeiling;
      ordinal += 1
    ) {
      const participant = await readJson(
        resolve(config.stateDirectory, `participant-${ordinal}-terminal.json`),
        undefined,
      );
      if (participant === undefined) break;
      participants.push(participant);
    }
    return participants;
  };
  const accept = async (item) => {
    const usage = {
      inputTokens: { status: "known", value: 3 },
      outputTokens: { status: "known", value: 2 },
      costUsd: { status: "unavailable" },
    };
    const first = config.initialHistory.length + 1;
    const participants = [
      {
        ordinal: first,
        id: `${item.id}-source-author`,
        item: item.id,
        stage: "source",
        role: "author",
        outcome: "passed",
        usage,
      },
      {
        ordinal: first + 1,
        id: `${item.id}-source-reviewer`,
        item: item.id,
        stage: "source",
        role: "reviewer",
        outcome: "passed",
        usage,
      },
    ];
    await Promise.all(
      participants.map((participant) =>
        writeFile(
          resolve(config.stateDirectory, `participant-${participant.ordinal}-terminal.json`),
          `${JSON.stringify(participant)}\n`,
        ),
      ),
    );
    return {
      status: "accepted",
      head: "b".repeat(40),
      reviewId: participants[1].id,
      stateDirectory: item.source.stateDirectory,
    };
  };
  return {
    async assertExecutor() {},
    history,
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      if (!sourceObserved) {
        sourceObserved = true;
        return { status: "observing-author" };
      }
      return accept(item);
    },
    async repair() {
      throw new Error("fixture repair must not run");
    },
    async delivery(item, accepted) {
      return {
        status: "complete",
        run: item.source.run,
        issue: item.issue,
        head: accepted.head,
        reviewId: accepted.reviewId,
        publication: { number: 338, url: "https://example.test/338" },
        checks: item.delivery.requiredChecks.map((name) => ({
          name,
          bucket: "pass",
          link: `https://example.test/check/${name}`,
        })),
        mergeCommit: "c".repeat(40),
        cleanup: { status: "confirmed", branch: "codex/synthetic-338" },
        retries: 0,
      };
    },
  };
}

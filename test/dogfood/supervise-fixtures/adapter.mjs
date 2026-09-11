import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import {
  itemAuthority,
  participantIdentity,
  QueueBlocked,
  queueDigest,
} from "../../../scripts/dogfood/queue.ts";
import { expectedBoardItems } from "../../../scripts/planning/board-check.mjs";
import { loadPlanningSnapshot } from "../../../scripts/planning/check.mjs";
export {
  currentCandidateAttempt,
  hasStartedDelivery,
  queueStep,
  reconcileCompletedQueue,
  validateLoopConfig,
} from "../../../scripts/dogfood/queue.ts";
export { QueueBlocked };
export {
  completeCycle,
  nextCycle,
  reconcilePendingStop,
  startCycle,
  stopCycle,
} from "../../../scripts/dogfood/supervision.ts";

export async function queueConfigFromLoop(loop, executingRoot, selected, initialHistory) {
  const stateDirectory = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-queue`);
  const sourceState = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-source`);
  const repairState = resolve(loop.stateRoot, loop.run, `${selected.key.toLowerCase()}-repair`);
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
    setup: { run: loop.run, issue, base },
    source: {
      run: loop.run,
      issue,
      base,
      stateDirectory: sourceState,
      allowedPaths: ["."],
      requiredChecks,
      exitReceiptWindowMs: loop.exitReceiptWindowMs,
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
    run: loop.run,
    controllerRoot: executingRoot,
    controllerRevision: base,
    stateDirectory,
    limit: 1,
    nativeLaunchCeiling: loop.nativeLaunchCeiling,
    initialHistory,
    items: [item],
  };
  config.authority = {
    schemaVersion: "dogfood-bounded-queue-authority/v1",
    controller: `loop:${loop.run}`,
    run: config.run,
    controllerRoot: config.controllerRoot,
    controllerRevision: config.controllerRevision,
    stateDirectory,
    limit: 1,
    nativeLaunchCeiling: config.nativeLaunchCeiling,
    lineageDigest: queueDigest(config.initialHistory.map(participantIdentity)),
    itemsDigest: queueDigest(config.items.map(itemAuthority)),
    actions: ["setup", "source", "repair", "delivery"],
  };
  return config;
}

export function repositorySupervisionAdapter() {
  const issuePath = (config) => resolve(config.stateRoot, config.run, "command-issue.json");
  const readIssue = async (config) => readJson(issuePath(config));
  const writeIssue = async (config, issue) =>
    writeFile(issuePath(config), `${JSON.stringify(issue)}\n`);
  return {
    async board() {
      const root = resolve(import.meta.dirname, "../../..");
      const planning = await loadPlanningSnapshot(root);
      const issue = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-issue.json"),
      );
      const expected = expectedBoardItems(planning);
      return {
        repository: planning.roadmap.repository,
        totalCount: expected.length,
        issues: expected.map((item, index) => ({
          number: item.key === "ISS-105" ? 362 : index + 1,
          title: item.title,
          body: item.body,
          milestone: item.milestone,
          state: item.key === "ISS-105" ? issue.state : "CLOSED",
          labels: item.key === "ISS-105" ? issue.labels : [],
        })),
      };
    },
    async currentMain() {
      return "a".repeat(40);
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
  const callsPath = resolve(dirname(config.stateDirectory), "command-calls.json");
  const controlsPath = resolve(dirname(config.stateDirectory), "command-controls.json");
  const changeCalls = async (name) => {
    const calls = await readJson(callsPath, { setup: 0, source: 0, delivery: 0 });
    calls[name] += 1;
    await writeFile(callsPath, `${JSON.stringify(calls)}\n`);
    return calls;
  };
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
    async assertAuthority() {},
    history,
    async setup() {
      await changeCalls("setup");
      return { status: "ready" };
    },
    async source(item) {
      const calls = await changeCalls("source");
      const controls = await readJson(controlsPath, { mode: "complete" });
      if (controls.mode === "wait" && calls.source === 1) return { status: "observing-author" };
      if (controls.mode === "blocked-count-unavailable") {
        await writeFile(resolve(config.stateDirectory, "item-1-repair-intent.json"), "{}\n");
        throw new QueueBlocked("typecheck-failed-after-retry");
      }
      return accept(item);
    },
    async repair() {
      throw new Error("fixture repair must not run");
    },
    async delivery(item, accepted) {
      const receipt = resolve(accepted.stateDirectory, "fixture-delivery-complete.json");
      const completed = await readJson(receipt, undefined);
      if (completed) return completed;
      await changeCalls("delivery");
      const result = {
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
      };
      await writeFile(receipt, `${JSON.stringify(result)}\n`);
      return result;
    },
  };
}

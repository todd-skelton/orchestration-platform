import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { QueueBlocked } from "../../../scripts/dogfood/queue.ts";
import { DeliveryBlocked } from "../../../scripts/dogfood/delivery.mjs";
// ISS-165: the supervisor composes the real native adapter; only queue,
// supervision and repository effects are synthetic here.
export { codexAdapter } from "../../../scripts/dogfood/dispatch-adapter.ts";
import { nextCycle as nativeNextCycle } from "../../../scripts/dogfood/supervision.ts";
export const nextCycle = (loop, root, supervisor, repository) =>
  nativeNextCycle(loop, root, supervisor, repository, () => validateLoopExecutor(loop, root));
let sourceObserved = false;
export {
  currentCandidateAttempt,
  hasStartedDelivery,
  retainedPostMergeDelivery,
  queueStep,
  validateLoopConfig,
} from "../../../scripts/dogfood/queue.ts";
export { QueueBlocked, DeliveryBlocked };
export {
  completeCycle,
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
  const controls = await readJson(
    resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
    {},
  );
  if (controls.validationStopReason) throw new QueueBlocked(controls.validationStopReason);
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
      const directory = process.env.SUPERVISE_FIXTURE_STATE;
      const controlsPath = resolve(directory, "command-controls.json");
      const [issue, controls] = await Promise.all([
        readJson(resolve(directory, "command-issue.json")),
        readJson(controlsPath, {}),
      ]);
      controls.selectCalls = (controls.selectCalls ?? 0) + 1;
      await writeFile(controlsPath, `${JSON.stringify(controls)}\n`);
      if (controls.selectionMessage) throw new Error(controls.selectionMessage);
      if (controls.selectionReason)
        throw new QueueBlocked(controls.selectionReason, controls.selectionDiagnostics);
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
    async park() {
      const directory = process.env.SUPERVISE_FIXTURE_STATE;
      const issuePath = resolve(directory, "command-issue.json");
      const controlsPath = resolve(directory, "command-controls.json");
      const [issue, controls] = await Promise.all([
        readJson(issuePath),
        readJson(controlsPath, {}),
      ]);
      issue.labels = issue.labels.filter((label) => label !== "ready");
      controls.parkCalls = (controls.parkCalls ?? 0) + 1;
      await Promise.all([
        writeFile(issuePath, `${JSON.stringify(issue)}\n`),
        writeFile(controlsPath, `${JSON.stringify(controls)}\n`),
      ]);
      return "add the `ready` label after acting on the note";
    },
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: async ({ delivery }) => {
      await call(`post-merge:${delivery.mergeCommit}`);
      const controls = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
        {},
      );
      if (controls.postMergeStop) throw new DeliveryBlocked(controls.postMergeStop);
    },
  };
}

export async function queueConfigFromLoop(
  loop,
  executingRoot,
  selected,
  _repositoryAdapter,
  initialHistory,
) {
  await call(`workspace:${selected.key}`);
  const controls = await readJson(
    resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
    {},
  );
  if (controls.workspaceStops?.[selected.key])
    throw new QueueBlocked(controls.workspaceStops[selected.key]);
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
      author: { model: loop.author.model, effort: loop.author.effort, prompt: "author" },
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
  const issuePath = () => resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-issue.json");
  const readIssue = async (config) => readJson(issuePath(config));
  const writeIssue = async (config, issue) =>
    writeFile(issuePath(config), `${JSON.stringify(issue)}\n`);
  return {
    async currentMain(config) {
      const controls = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
        {},
      );
      return controls.main ?? "a".repeat(40);
    },
    async issue(config, number) {
      await call(`issue:${number}`);
      const controls = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
        {},
      );
      if (controls.issueObservationStops?.[number])
        throw new QueueBlocked(controls.issueObservationStops[number]);
      if (controls.issueObservations?.[number]) return controls.issueObservations[number];
      return readIssue(config);
    },
    async removeReady(config) {
      const issue = await readIssue(config);
      issue.labels = issue.labels.filter((label) => label !== "ready");
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

async function call(event) {
  await appendFile(resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-calls.log"), `${event}\n`);
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
    async setup(item) {
      await call(`setup:${item.id}`);
      return { status: "ready" };
    },
    async source(item) {
      await call(`source:${item.id}`);
      const controls = await readJson(
        resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-controls.json"),
        {},
      );
      if (controls.stopReason) throw new QueueBlocked(controls.stopReason);
      // ISS-165 TEST-ONLY trigger at the queue's source boundary: the composed
      // options.native is the actual supervisor composition; only its external
      // execution is replaced here. Production never reaches this branch.
      if (controls.nativeDbProfile) {
        const native = options.native;
        const methods = native
          ? Object.keys(native).filter((key) => typeof native[key] === "function")
          : null;
        const reply = native?.nativeDbProfile
          ? await native.nativeDbProfile(controls.nativeDbProfile)
          : { status: "unsupported", diagnostic: "native-db-profile-absent" };
        await writeFile(
          resolve(process.env.SUPERVISE_FIXTURE_STATE, "command-native-db.json"),
          `${JSON.stringify({ methods, reply })}\n`,
        );
      }
      if (!sourceObserved && !controls.observeImmediately) {
        sourceObserved = true;
        return { status: "observing-author" };
      }
      return accept(item);
    },
    async repair() {
      await call("repair");
      throw new Error("fixture repair must not run");
    },
    async delivery(item, accepted) {
      await call(`delivery:${item.id}`);
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

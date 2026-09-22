import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import * as boardLoader from "../../scripts/planning/board-check.mjs";
import { planningSelectionFixture, retainedFiles } from "./fixtures/planning-selection.js";
import {
  QueueBlocked,
  queueStep,
  queueUsage,
  repositoryQueueAdapter,
  queueConfigFromLoop,
  type LoopConfig,
} from "../../scripts/dogfood/queue.js";
import type {
  DeliveryAdapter,
  DeliveryConfig,
  DeliveryPlan,
  PublicationEvidence,
} from "../../scripts/dogfood/delivery.js";
import {
  sha,
  type Adapter,
  type Attempt,
  type NativeDbIdentity,
} from "../../scripts/dogfood/flow.js";
import {
  createNativeDbAdmission,
  nativeDbProfileAdapter,
} from "../../scripts/dogfood/supervise.mjs";
import type { RepairAdapter } from "../../scripts/dogfood/repair-adapter.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import type { SetupAdapter, SetupRole } from "../../scripts/dogfood/setup.js";
import {
  isItemStopReason,
  completeCycle,
  startCycle,
  persistCycle,
  stopCycle,
  reconcilePendingStop,
  nextCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import { codexAdapter } from "../../scripts/dogfood/dispatch-adapter.js";
import { SELF_ROUTING } from "../../scripts/dogfood/routing.mjs";
import { MAX_TERMINAL_SUMMARY_LENGTH } from "../../scripts/dogfood/terminal-summary.mjs";
import { sourceFailureFixture, historicalStops, snapshot } from "./fixtures/source-failure.js";
import { prerequisiteFixture, prerequisiteProof } from "./fixtures/prerequisite.js";
import {
  type QueueConfig,
  type QueueAdapter,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";

const roots: string[] = [];

it("ISS-187 retains a saved run's source failure through native absolute-2 entry and replay", async () => {
  const f = await prerequisiteFixture();
  roots.push(f.root);
  const { history } = f;
  const old = await snapshot(f.runState);
  const oldTrees = await snapshot(f.loop.worktreeRoot);
  const next = (await f.advance())!;
  expect(next.selection).toMatchObject({ cycle: 5, key: "fixture-110" });
  expect(next.initialHistory).toEqual(history);
  await persistCycle(f.loop, next);
  await startCycle(f.loop, next, f.host);
  const q = await f.compose(next);
  expect(q.config.items[0]!.implementationAttempt).toBe(2);
  expect(q.config.items[0]!.source.authorFailures).toEqual({ count: 1, ids: [history[5]!.id] });
  expect(q.config.items[0]!.source.author.rung).toBe(1);
  f.setAuthorStatus("running");
  expect(await queueStep(q.config, q.adapter)).toMatchObject({ status: "observing-author" });
  const replay = await f.compose((await f.advance())!);
  expect(await queueStep(replay.config, replay.adapter)).toMatchObject({
    status: "observing-author",
  });
  const after = await snapshot(f.runState);
  for (const [path, bytes] of old) {
    if (path === resolve(f.current.config.stateDirectory, "attempt.json")) continue;
    expect(after.get(path), path).toBe(bytes);
  }
  for (const [path, bytes] of oldTrees) expect(await readFile(path, "utf8"), path).toBe(bytes);
  expect(await replay.adapter.history()).toEqual(history);
  expect(
    f.calls.filter(
      (call) => call === "launch:author:https://github.com/fixture/repository/issues/110",
    ),
  ).toHaveLength(2);
  await prerequisiteProof(f, old, oldTrees, "interrupted-worker-resume");
});

it.each(["source2", "probe", "source4", "ceiling"])(
  "ISS-187 uses native accounting and terminal hold: %s",
  async (scenario) => {
    const f = await prerequisiteFixture();
    roots.push(f.root);
    const old = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    const next = (await f.advance())!;
    await persistCycle(f.loop, next);
    await startCycle(f.loop, next, f.host);
    const launch = f.native.launch;
    const observe = f.native.observe;
    let refused = false;
    f.native.launch = async (role, config, prompt) => {
      if (role === "author" && config.issue.endsWith("/110")) {
        if (scenario === "probe" && !refused) {
          refused = true;
          expect(config.author.rung).toBe(1);
          throw new QueueBlocked("provider-model-refused");
        }
        await writeFile(
          resolve(config.worktree, "product.txt"),
          `synthetic change ${config.stateDirectory}\n`,
        );
      }
      return launch(role, config, prompt);
    };
    f.native.observe = async (role, config, attempt) => {
      const result = await observe(role, config, attempt);
      if (role === "author") return { ...result, status: "passed", summary: "" };
      const fail =
        ["source4", "ceiling"].includes(scenario) &&
        (scenario === "ceiling" || !config.stateDirectory.includes("attempt-4"));
      return {
        ...result,
        status: fail ? "failed" : "passed",
        summary: JSON.stringify({
          run: config.run,
          role,
          head: result.head,
          verdict: fail ? "FAIL" : "PASS",
          findings: fail
            ? [
                {
                  file: "product.txt",
                  line: 1,
                  severity: "blocking",
                  text: "Use the required synthetic result.",
                },
              ]
            : [],
          g0: "No; the synthetic invariant is required.",
        }),
      };
    };
    let q = await f.compose(next);
    if (["source4", "ceiling"].includes(scenario)) {
      expect(await queueStep(q.config, q.adapter)).toMatchObject({
        status: "advancing-attempt",
        cursor: 3,
      });
      expect(await f.json(resolve(q.config.stateDirectory, "attempt.json"))).toMatchObject({
        phase: "failed",
        candidateAttempt: 3,
        authorFailures: { count: 3 },
      });
      q = await f.compose((await f.advance())!);
      expect(q.config.items[0]!.implementationAttempt).toBe(4);
      expect(q.config.items[0]!.source.author.rung).toBe(2);
    }
    if (scenario === "ceiling") {
      await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
        reason: "implementation-attempt-ceiling-exhausted",
      });
      expect(
        await stopCycle(
          f.loop,
          { ...next, initialHistory: await q.adapter.history() },
          "implementation-attempt-ceiling-exhausted",
          4,
          f.host,
          f.policy,
        ),
      ).toBe("item");
    } else {
      expect(await queueStep(q.config, q.adapter)).toMatchObject({ status: "complete" });
      await completeCycle(f.loop, next, await q.adapter.history(), f.host);
    }
    const charged = await q.adapter.history();
    expect(charged.slice(0, 12)).toEqual(f.history);
    expect(charged).toHaveLength(["source4", "ceiling"].includes(scenario) ? 18 : 14);
    const saved = await f.json(resolve(q.config.stateDirectory, "attempt.json"));
    expect(saved.authorFailures.count).toBe(
      scenario === "probe" ? 2 : scenario === "source4" ? 3 : scenario === "ceiling" ? 4 : 1,
    );
    if (scenario === "probe")
      expect(saved.authorFailures.ids).toEqual([
        f.history[5]!.id,
        `${q.config.items[0]!.source.stateDirectory}:probe:1`,
      ]);
    const after = await snapshot(f.runState);
    for (const [path, bytes] of old) {
      if (path !== resolve(f.current.config.stateDirectory, "attempt.json"))
        expect(after.get(path), path).toBe(bytes);
    }
    const oldAttempt = JSON.parse(
      old.get(resolve(f.current.config.stateDirectory, "attempt.json"))!,
    );
    const projected = await f.json(resolve(f.current.config.stateDirectory, "attempt.json"));
    expect(projected).toEqual({
      ...oldAttempt,
      phase: "failed",
      reviewId: "",
      rebasedBase: projected.rebasedBase,
      rebasedMainBase: projected.rebasedMainBase,
    });
    for (const [path, bytes] of trees) expect(await readFile(path, "utf8"), path).toBe(bytes);
    await expect(f.advance()).rejects.toMatchObject({ reason: "prerequisite-held" });
    const authorityUrl = f.loop.prerequisite!.authorityUrl;
    delete f.loop.prerequisite;
    await expect(f.advance()).rejects.toMatchObject({ reason: "prerequisite-held" });
    f.loop.blockedCycleResume = { cycle: 5, authorityUrl };
    await expect(f.advance()).rejects.toMatchObject({ reason: "prerequisite-held" });
    expect(await snapshot(f.runState)).toEqual(after);
    f.loop.blockedCycleResume.authorityUrl =
      "https://github.com/fixture/repository/issues/1#issuecomment-2";
    expect(await f.advance()).toMatchObject({
      selection: f.blocked.selection,
      initialHistory: charged,
    });
    expect(await snapshot(f.runState)).toEqual(after);
    await prerequisiteProof(f, old, trees, scenario);
  },
);

it("FAIL requires matching terminal and stable executor: terminal match", async () => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  await f.fail();
  await historicalStops(f, "complete");
  const source = f.current.config.items[0]!.source.stateDirectory;
  const terminalPath = resolve(source, "author-terminal.json");
  const terminalBytes = await readFile(terminalPath, "utf8");
  const terminal = JSON.parse(terminalBytes);
  const attemptPath = resolve(f.current.config.stateDirectory, "attempt.json");
  const attemptBytes = await readFile(attemptPath, "utf8");
  const attempt = JSON.parse(attemptBytes);
  const pinnedPath = resolve(source, "config.json");
  const pinnedBytes = await readFile(pinnedPath, "utf8");
  const pinned = JSON.parse(pinnedBytes);
  const authorPath = resolve(source, "author-attempt.json");
  const authorBytes = await readFile(authorPath, "utf8");
  const controls: Array<[string, string, unknown]> = [
    ["missing terminal", terminalPath, undefined],
    ["missing author", authorPath, undefined],
    ["mismatched terminal", terminalPath, { ...terminal, id: "another-synthetic-worker" }],
    ...["running", "passed", "dead", "malformed"].map(
      (status) => [status, terminalPath, { ...terminal, status }] as [string, string, unknown],
    ),
    ["wrong head", terminalPath, { ...terminal, head: "a".repeat(40) }],
    ["missing head", terminalPath, { ...terminal, head: undefined }],
    ["missing queue attempt", attemptPath, undefined],
    ["wrong item", attemptPath, { ...attempt, item: "fixture-other:1" }],
    ["wrong run", attemptPath, { ...attempt, run: "other-synthetic-run" }],
    [
      "wrong issue",
      attemptPath,
      { ...attempt, issue: "https://github.com/fixture/repository/issues/123" },
    ],
    ["wrong attempt", attemptPath, { ...attempt, candidateAttempt: 2 }],
    [
      "wrong source run",
      pinnedPath,
      { ...pinned, config: { ...pinned.config, run: "other-synthetic-run" } },
    ],
  ];
  for (const [name, path, value] of controls) {
    if (value === undefined) await rm(path);
    else await writeFile(path, JSON.stringify(value));
    expect(await f.advance(), name).toMatchObject({ selection: f.cycle.selection });
    expect(
      f.calls.filter((call) => call.startsWith("park:")),
      name,
    ).toEqual([]);
    await writeFile(terminalPath, terminalBytes);
    await writeFile(authorPath, authorBytes);
    await writeFile(attemptPath, attemptBytes);
    await writeFile(pinnedPath, pinnedBytes);
  }
  expect(await f.advance()).toMatchObject({ selection: { key: "fixture-159" } });
  expect(f.calls.filter((call) => call.startsWith("park:"))).toEqual(["park:110"]);
});

it("FAIL requires matching terminal and stable executor: live executor", async () => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  await f.fail();
  await historicalStops(f, "pilot-pending");
  const old = await snapshot(f.runState);
  await writeFile(resolve(f.repository, "product.txt"), "synthetic dirty executor\n");
  await expect(f.advance()).rejects.toMatchObject({ reason: "unstable-executor" });
  expect(f.calls.filter((call) => call.startsWith("park:"))).toEqual([]);
  expect(f.calls.filter((call) => call.startsWith("note:"))).toEqual(["note:110"]);
  expect(f.rows[0]!.comments.at(-1)).toContain("unstable-executor");
  expect(f.rows[0]!.comments.at(-1)).not.toContain("To unpark");
  await expect(
    readFile(resolve(f.runState, `cycle-${f.cycle.selection.cycle}-stop-2-complete.json`)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  for (const [path, bytes] of old) expect(await readFile(path, "utf8"), path).toBe(bytes);
  await f.git(f.repository, ["restore", "product.txt"]);
  await f.upgrade();
  // A changed queue executor binding is still rejected before source observation.
  const queue = f.current;
  queue.config.controllerRevision = await f.git(f.repository, ["rev-parse", "HEAD"]);
  await expect(queueStep(queue.config, queue.adapter)).rejects.toMatchObject({
    reason: "queue-executor-drift",
  });
  expect(await f.advance()).toMatchObject({ selection: { key: "fixture-159" } });
});

it("FAIL requires matching terminal and stable executor: live author retains source checks", async () => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  f.setAuthorStatus("running");
  await expect(queueStep(f.current.config, f.current.adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(await f.advance()).toMatchObject({ selection: f.cycle.selection });
  await expect(queueStep(f.current.config, f.current.adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(f.calls.filter((call) => call.startsWith("launch:"))).toHaveLength(1);
  await f.upgrade();
  const q = await f.compose(f.cycle);
  await expect(queueStep(q.config, q.adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(f.calls.filter((call) => call.startsWith("launch:"))).toHaveLength(1);
  // An executor upgrade retains the saved pilot; moving that worktree still refuses.
  await f.git(q.config.items[0]!.setup.pilotWorktree, [
    "checkout",
    "--detach",
    await f.git(f.repository, ["rev-parse", "HEAD"]),
  ]);
  await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
    reason: "pilot-revision-moved",
  });
  expect(f.calls.filter((call) => call.startsWith("park:"))).toEqual([]);
});
const stable = "a".repeat(40);
const base = "b".repeat(40);
const candidate = "c".repeat(40);
const repaired = "d".repeat(40);
const mergeCommit = "e".repeat(40);
const unavailable = { status: "unavailable" as const };

const passingReviewSummary = (head: string) =>
  JSON.stringify({
    run: "synthetic-item-run",
    role: "reviewer",
    head,
    verdict: "PASS",
    findings: [],
    g0: "No simpler change is available.",
  });

async function fixture(history: QueueParticipant[] = []) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "queue-adapter-fixture-")));
  roots.push(root);
  const paths = {
    repository: resolve(root, "repository"),
    controller: resolve(root, "controller"),
    queue: resolve(root, "queue"),
    setup: resolve(root, "queue/setup"),
    source: resolve(root, "queue/source"),
    repair: resolve(root, "queue/repair"),
    pilot: resolve(root, "pilot"),
    author: resolve(root, "author"),
    review: resolve(root, "review"),
  };
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  const source = {
    owner: "synthetic-controller",
    run: "synthetic-item-run",
    issue: "fixture-338",
    pilotRevision: stable,
    base,
    worktree: paths.author,
    reviewWorktree: paths.review,
    stateDirectory: paths.source,
    allowedPaths: ["scripts/dogfood/queue.ts"],
    repository: "fixture/repository",
    requiredChecks: ["linux", "windows", "macos"],
    author: { model: "gpt-author", effort: "high", prompt: "author prompt" },
    reviewer: {
      model: "gpt-reviewer",
      effort: "high",
      prompt: "review prompt",
    },
    adapter: { kind: "codex-exec" as const, executable: resolve(root, "codex") },
  };
  const item: QueueItem = {
    id: "fixture-338",
    issue: source.issue,
    base,
    implementationAttempt: 1,
    implementationAttemptCeiling: 4,
    setup: {
      controller: source.owner,
      run: source.run,
      issue: source.issue,
      repository: source.repository,
      repositoryRoot: paths.repository,
      controllerRoot: paths.controller,
      controllerRevision: stable,
      pilotRevision: stable,
      base,
      baseBranch: "main",
      sourceBranch: "codex/fixture-338",
      pilotWorktree: paths.pilot,
      sourceWorktree: paths.author,
      reviewWorktree: paths.review,
      stateDirectory: paths.setup,
    },
    source,
    repair: {
      stateDirectory: paths.repair,
      acceptanceCriteria: ["criterion one", "criterion two"],
      author: {
        model: "gpt-repair",
        effort: "high",
        prompt: "repair author prompt",
      },
      reviewer: {
        model: "gpt-delta",
        effort: "high",
        prompt: "repair reviewer prompt",
      },
    },
    delivery: { requiredChecks: [...source.requiredChecks], policy: { kind: "fixture" } },
  };
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-config/v1",
    controller: source.owner,
    run: "synthetic-queue",
    controllerRoot: paths.controller,
    controllerRevision: stable,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: 8,
    initialHistory: history,
    items: [item],
  };
  return { root, paths, source, item, config };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

async function planningSource(
  f: Awaited<ReturnType<typeof planningSelectionFixture>>,
  q: QueueConfig,
) {
  const launches: string[] = [];
  const setup = gitSetupAdapter({
    gitExecutable: f.loop.gitExecutable,
    resolveLauncher: async () => ({ executable: process.execPath, prefixArgs: [] }),
    install: async (_launcher, _args, cwd) => {
      await mkdir(resolve(cwd, "node_modules"));
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
      return "succeeded";
    },
  });
  const native: Adapter = {
    async preflight() {},
    git: f.git,
    async launch(role, config) {
      launches.push(role);
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic running worker\n");
      return { id: "synthetic-pinned-author", pid: 111, trace, launchedAt: 1 };
    },
    async observe(_role, _config, attempt) {
      return { id: attempt.id, status: "running" };
    },
    async checks() {
      throw new Error("no publication during pinned source test");
    },
  };
  const adapter = (config: QueueConfig) =>
    repositoryQueueAdapter(config, f.executor, {
      gitExecutable: f.loop.gitExecutable,
      native,
      setup,
    });
  await expect(queueStep(q, adapter(q))).resolves.toMatchObject({ status: "observing-author" });
  return { adapter, launches };
}

it("new selection context remains pinned after main moves", async () => {
  const f = await planningSelectionFixture();
  roots.push(f.root);
  const installed = await f.installed();
  vi.spyOn(boardLoader, "loadBoardSnapshot").mockResolvedValue(await f.board());
  const cycle = (await nextCycle(f.loop, f.executor, f.host, f.policy))!;
  await persistCycle(f.loop, cycle);
  const { cycle: _cycle, ...selection } = cycle.selection;
  const compose = () => queueConfigFromLoop(f.loop, f.executor, selection, f.policy);
  const first = await compose();
  const item = first.items[0]!;
  expect(item.setup.base).toBe(f.current);
  expect(item.source.base).toBe(f.current);
  expect(item.source.pilotRevision).toBe(f.old);
  expect(item.delivery.policy).toMatchObject({ title: "Synthetic ISS-002" });
  expect(item.repair.acceptanceCriteria).toEqual(["Execute ISS-002\nKeep the pinned brief."]);
  const body = await readFile(resolve(f.remote, "planning/drafts/ISS-002.md"), "utf8");
  expect(item.source.author.prompt).toContain(body.trim());
  expect(item.source.reviewer.prompt).toContain(body.trim());
  expect(item.source.author.prompt).toContain(
    "Synthetic current rules describe uninstalled behavior",
  );
  await writeFile(
    resolve(f.remote, "planning/drafts/ISS-002.md"),
    body.replaceAll("Execute ISS-002", "Mutated later brief"),
  );
  const later = await f.commit("Synthetic later rules");
  await f.host.currentMain(f.loop, f.executor);
  expect(await f.git(f.executor, ["rev-parse", "refs/remotes/origin/main"])).toBe(later);
  f.host.issue = async () => ({ key: "ISS-002", state: "OPEN", labels: [], comments: [] });
  f.host.currentMain = async () => {
    throw new Error("saved selection must not fetch");
  };
  const resumed = (await nextCycle(f.loop, f.executor, f.host, f.policy))!;
  expect(resumed).toEqual(cycle);
  expect(await compose()).toEqual(first);
  expect(await f.installed()).toEqual(installed);
  const active = await planningSource(f, first);
  const retained = await retainedFiles(resolve(f.loop.stateRoot, f.loop.run));
  const again = await compose();
  expect(await retainedFiles(resolve(f.loop.stateRoot, f.loop.run))).toEqual(retained);
  await expect(active.adapter(again).source(again.items[0]!)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(active.launches).toEqual(["author"]);
  expect(await retainedFiles(resolve(f.loop.stateRoot, f.loop.run))).toEqual(retained);
  // Exact fingerprints remain strict even when only prompt data differs.
  again.items[0]!.source.author.prompt += "\nSynthetic changed brief";
  await expect(active.adapter(again).source(again.items[0]!)).rejects.toMatchObject({
    reason: "conflicting-run-configuration",
  });
});

it("legacy selection base differs from executor HEAD", async () => {
  const f = await planningSelectionFixture();
  roots.push(f.root);
  await f.host.currentMain(f.loop, f.executor);
  const selection = { key: "ISS-001", number: 1, base: f.current };
  const compose = (planningRevision?: string) =>
    queueConfigFromLoop(
      f.loop,
      f.executor,
      { ...selection, ...(planningRevision === undefined ? {} : { planningRevision }) },
      f.policy,
    );
  const legacy = await compose();
  expect(f.current).not.toBe(f.old);
  expect(legacy.items[0]!.source.author.prompt).toContain("Synthetic installed rules");
  expect(legacy.items[0]!.repair.acceptanceCriteria).toEqual([
    "Execute ISS-001\nKeep the pinned brief.",
  ]);
  const active = await planningSource(f, legacy);
  const retained = await retainedFiles(resolve(f.loop.stateRoot, f.loop.run));
  const resumed = await compose();
  expect(resumed.items[0]!.source).toEqual(legacy.items[0]!.source);
  expect(await retainedFiles(resolve(f.loop.stateRoot, f.loop.run))).toEqual(retained);
  await expect(active.adapter(resumed).source(resumed.items[0]!)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(active.launches).toEqual(["author"]);
  expect(await retainedFiles(resolve(f.loop.stateRoot, f.loop.run))).toEqual(retained);
  const marked = await compose(f.current);
  expect(marked.items[0]!.source.author.prompt).toContain(
    "Synthetic current rules describe uninstalled behavior",
  );
  expect(marked.items[0]!.repair.acceptanceCriteria).toEqual([
    "New criterion ISS-001\nKeep the pinned brief.",
  ]);
  await expect(active.adapter(marked).source(marked.items[0]!)).rejects.toMatchObject({
    reason: "conflicting-run-configuration",
  });
  for (const revision of ["main", f.old, "A".repeat(40), "", null]) {
    await expect(
      queueConfigFromLoop(
        f.loop,
        f.executor,
        { ...selection, planningRevision: revision as string },
        f.policy,
      ),
    ).rejects.toMatchObject({ reason: "invalid-selected-issue" });
  }
});

async function enableLadders(current: Awaited<ReturnType<typeof fixture>>) {
  current.item.source.author = {
    ...current.item.source.author,
    ...SELF_ROUTING.author[0]!,
    ladder: SELF_ROUTING.author,
  };
  current.item.source.reviewer = {
    ...current.item.source.reviewer,
    ...SELF_ROUTING.reviewer[0]!,
    ladder: SELF_ROUTING.reviewer,
  };
  current.item.repair.author = current.item.source.author;
  current.item.repair.reviewer = current.item.source.reviewer;
  await writeFile(
    resolve(current.paths.queue, "attempt.json"),
    JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "setup",
      run: current.config.run,
      index: 0,
      item: current.item.id,
      issue: current.item.issue,
      base,
      candidateAttempt: current.item.implementationAttempt,
      head: base,
      reviewId: null,
      findings: [],
      history: [],
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
      authorFailures: { count: 0, ids: [] },
    }),
  );
}

it.each([
  "refused-probe",
  "refused-worker",
  "dead-before-work",
  "dead-after-work",
  "failed",
  "malformed",
  "outages",
])("advances the author ladder after %s and keeps the rung across resume", async (failure) => {
  const f = await fixture();
  await enableLadders(f);
  const placements: { model: string; effort: string; rung: number | undefined }[] = [];
  let serial = 0;
  let partialWork = false;
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (args[0] === "status" && partialWork) return " M fixture.ts";
      if (args[0] === "diff" && args.includes("--binary") && partialWork)
        return "retained partial work";
      if (args[0] === "reset") partialWork = false;
      if (args[0] === "rev-parse")
        return args[1] === "--show-toplevel" ? tree : tree === f.paths.pilot ? stable : base;
      return "";
    },
    async launch(role, config) {
      expect(role).toBe("author");
      const { model, effort, rung } = config.author;
      placements.push({ model, effort, rung });
      expect(
        JSON.parse(await readFile(resolve(config.stateDirectory, "author-intent.json"), "utf8")),
      ).toMatchObject({ rung, placement: { model, effort } });
      serial++;
      if (failure === "refused-probe" && serial === 1)
        throw new QueueBlocked("provider-model-refused");
      return {
        id: `author-${serial}`,
        pid: serial,
        launchedAt: 1,
        trace: resolve(config.stateDirectory, `trace-${serial}`),
      };
    },
    async observe(_role, _config, attempt) {
      if (serial > (failure === "outages" ? 4 : failure === "refused-worker" ? 2 : 1))
        return { id: attempt.id, status: "running" };
      if (failure === "dead-after-work") partialWork = true;
      return {
        id: attempt.id,
        status: failure === "failed" ? "failed" : failure === "malformed" ? "malformed" : "dead",
        head: base,
        ...(failure === "outages" ? { providerFailure: true } : {}),
        ...(failure === "refused-worker" ? { modelRefused: true } : {}),
        summary: failure === "dead-after-work" ? "worker died after editing source" : "",
      };
    },
    async checks() {
      return { head: candidate, checks: [] };
    },
  };
  const adapter = () => repositoryQueueAdapter(f.config, f.paths.controller, { native });
  if (failure === "failed") {
    await expect(adapter().source(f.item)).rejects.toThrow(`author-${failure}`);
    await expect(adapter().source(f.item)).rejects.toThrow(`author-${failure}`);
    f.item.source.stateDirectory = resolve(f.paths.queue, "next-author");
    await mkdir(f.item.source.stateDirectory);
  }
  await expect(adapter().source(f.item)).resolves.toMatchObject({ status: "observing-author" });
  const saved = await readFile(
    resolve(f.item.source.stateDirectory, "author-attempt.json"),
    "utf8",
  );
  await expect(adapter().source(f.item)).resolves.toMatchObject({ status: "observing-author" });
  expect(await readFile(resolve(f.item.source.stateDirectory, "author-attempt.json"), "utf8")).toBe(
    saved,
  );
  const count = failure === "outages" ? 4 : failure === "refused-worker" ? 2 : 1;
  expect(placements).toEqual(
    Array.from({ length: count + 1 }, (_, index) => ({
      ...SELF_ROUTING.author[Math.min(index, 2)],
      rung: Math.min(index, 2),
    })),
  );
  expect(
    JSON.parse(await readFile(resolve(f.paths.queue, "attempt.json"), "utf8")).authorFailures.count,
  ).toBe(count);
  expect(JSON.parse(saved)).toMatchObject({
    rung: Math.min(count, 2),
    placement: SELF_ROUTING.author[Math.min(count, 2)],
  });
  if (failure.startsWith("refused")) expect(JSON.parse(saved).retries).toBeUndefined();
  if (failure === "malformed") {
    expect(JSON.parse(saved)).toMatchObject({
      retries: 1,
      retryContext: expect.stringContaining("could not be parsed"),
    });
    expect(await adapter().history()).toMatchObject([
      { id: "author-1", role: "author", outcome: "malformed", rung: 0 },
    ]);
  }
  if (failure === "dead-after-work") {
    expect(partialWork).toBe(false);
    expect(
      await readFile(resolve(f.item.source.stateDirectory, "author-retry-author-1.patch"), "utf8"),
    ).toContain("retained partial work");
  }
  expect((await adapter().history()).every((p) => p.rung !== undefined)).toBe(true);
});

// ISS-165: options.native carries the run-owned channel through the bounded
// source and repair adapters. The harness captures each actual receiver at its
// `git` entry and is the only caller; the queue never requests.
it("retains the composed native profile method through the bounded source and repair adapters", async () => {
  const current = await fixture();
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  const syntheticRun = "synthetic-native-component";
  const admission = createNativeDbAdmission(syntheticRun, input, output, {
    approvedParents: [current.root],
  });
  const identity: NativeDbIdentity = {
    profile: "reconciliation-pg16/v1",
    run: syntheticRun,
    issue: 338,
    attempt: 1,
    executorHead: stable,
    product: { repository: "fixture/repository", head: candidate, tree: "f".repeat(40) },
    declaration: {
      version: 1,
      profile: "reconciliation-pg16/v1",
      files: ["one", "two", "three"].map((name) => ({
        file: `${name}.db.test.ts`,
        cases: [`${name} reconciles`],
      })),
      mutants: [],
    },
    patchDigests: [],
    stagedInputDirectory: resolve(current.root, "staged-input"),
  };
  let sourceHead = base;
  let reviewHead = base;
  const receivers: Adapter[] = [];
  const launches: string[] = [];
  const native = nativeDbProfileAdapter(
    {
      async preflight() {},
      async git(worktree, args) {
        if (!receivers.includes(this)) receivers.push(this);
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return worktree;
        if (args[0] === "rev-parse") {
          if (worktree === current.paths.pilot) return stable;
          return worktree === current.paths.review ? reviewHead : sourceHead;
        }
        if (args[0] === "checkout") {
          reviewHead = String(args.at(-1));
          return "";
        }
        if (args[0] === "merge-base") return args[1]!;
        if (args[0] === "diff")
          return args.includes("--cached") || (args.at(-1) === "HEAD" && sourceHead === candidate)
            ? ""
            : "scripts/dogfood/queue.ts\0";
        if (args[0] === "show") return args.includes("-z") ? "\none\n\n" : "one";
        if (args[0] === "commit") sourceHead = candidate;
        return "";
      },
      async launch(role, config) {
        const stage = config.stateDirectory === current.paths.repair ? "repair" : "source";
        launches.push(`${stage}:${role}`);
        return {
          id: `synthetic-${stage}-${role}`,
          pid: launches.length,
          trace: resolve(config.stateDirectory, `${role}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        if (config.stateDirectory === current.paths.repair)
          return { id: attempt.id, status: "running" };
        return role === "author"
          ? { status: "passed", id: attempt.id, head: base }
          : {
              status: "failed",
              id: attempt.id,
              head: candidate,
              summary: JSON.stringify({
                run: current.source.run,
                role: "reviewer",
                head: candidate,
                verdict: "FAIL",
                findings: [
                  {
                    file: "scripts/dogfood/queue.ts",
                    line: 3,
                    severity: "blocking",
                    text: "synthetic fixable review defect",
                  },
                ],
                g0: "The prescribed repair is the simplest change.",
              }),
            };
      },
      async checks() {
        return { head: candidate, checks: [] };
      },
    },
    admission,
  );
  const flush = () => new Promise((done) => setImmediate(done));
  const invoke = async (adapter: Adapter) => {
    expect(typeof adapter.nativeDbProfile).toBe("function");
    const ordinal = written.length + 1;
    const pending = adapter.nativeDbProfile!(identity);
    await flush();
    expect(written).toHaveLength(ordinal);
    expect(JSON.parse(written[ordinal - 1]!)).toEqual({
      schemaVersion: "dogfood-native-db-request/v1",
      correlation: ordinal,
      ...identity,
    });
    input.write(
      `${JSON.stringify({
        schemaVersion: "dogfood-native-db-reply/v1",
        correlation: ordinal,
        status: "completed",
        owner: { lockId: "0".repeat(32), head: candidate, lane: syntheticRun },
        evidencePath: resolve(current.root, "evidence"),
        diagnostic: null,
      })}\n`,
    );
    expect(await pending).toEqual({
      correlation: ordinal,
      status: "completed",
      owner: { lockId: "0".repeat(32), head: candidate, lane: syntheticRun },
      evidencePath: resolve(current.root, "evidence"),
      diagnostic: null,
    });
  };
  const adapter = repositoryQueueAdapter(current.config, current.paths.controller, { native });
  // Flow reaches the bounded stage adapter; the queue's own location check
  // reaches the raw composition. Both are receivers, neither requests.
  const bounded = () => receivers.filter((receiver) => receiver !== native);
  await expect(adapter.source(current.item)).resolves.toMatchObject({ status: "fixable-review" });
  expect(launches).toEqual(["source:author", "source:reviewer"]);
  expect(written).toEqual([]);
  expect(receivers).toContain(native);
  expect(bounded()).toHaveLength(1);
  expect(bounded()[0]!.authorRung).toBeDefined();
  await invoke(bounded()[0]!);
  await expect(adapter.repair(current.item)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(launches).toEqual(["source:author", "source:reviewer", "repair:author"]);
  expect(written).toHaveLength(1);
  expect(bounded()).toHaveLength(2);
  await invoke(bounded()[1]!);
  // Replay from retained records: fresh bounded receivers, no request from the queue.
  await expect(adapter.repair(current.item)).resolves.toMatchObject({
    status: "observing-author",
  });
  await expect(adapter.source(current.item)).resolves.toMatchObject({ status: "fixable-review" });
  expect(launches).toHaveLength(3);
  expect(bounded()).toHaveLength(4);
  await flush();
  expect(written).toHaveLength(2);
  expect((await adapter.history()).map((row) => row.outcome)).toEqual(["passed", "failed"]);
  admission.close();
  for (const receiver of bounded().slice(2))
    expect(await receiver.nativeDbProfile!(identity)).toMatchObject({
      correlation: null,
      status: "refused",
      diagnostic: "native-db-channel-closed",
    });
  expect(written).toHaveLength(2);
});

it.each([
  "initial",
  "legacy retry",
  "failed fetch",
  "spent retry",
  "corrected",
  "corrected-refreshed",
])(
  "hands full hosted diagnostics to corrective workers on %s without rewriting historical prompts",
  async (mode) => {
    const current = await fixture([
      {
        ordinal: 1,
        id: "previous-reviewer",
        item: "ISS-141:3",
        stage: "source",
        role: "reviewer",
        outcome: "passed",
        usage: queueUsage(undefined),
      },
    ]);
    current.item.id = "ISS-141:4";
    current.item.implementationAttempt = 4;
    current.source.author.prompt = "Fix prior failure: " + "PR Required boilerplate ".repeat(170);
    const previous = resolve(current.paths.queue, "..", "iss-141-attempt-3");
    const originalSource = resolve(previous, "source");
    let previousSource = originalSource;
    if (mode.startsWith("corrected")) {
      await mkdir(originalSource, { recursive: true });
      await writeFile(
        resolve(originalSource, "gate-correction-result.json"),
        JSON.stringify({ head: base }),
      );
      previousSource = resolve(originalSource, "gate-correction");
      if (mode === "corrected-refreshed") {
        await mkdir(previousSource);
        const directory = resolve(previousSource, `refresh-${stable}`);
        await writeFile(
          resolve(previousSource, "native-refresh.json"),
          JSON.stringify({ directory }),
        );
        previousSource = directory;
      }
    }
    await mkdir(previousSource, { recursive: true });
    const findings = [
      {
        file: "PR Required",
        line: 1,
        severity: "blocking",
        text: "PR Required boilerplate ".repeat(170),
      },
    ];
    const priorBytes = JSON.stringify({
      phase: "failed",
      head: base,
      issue: current.item.issue,
      retries: 0,
      findings,
    });
    const publication = {
      number: 8002,
      head: base,
      url: "https://github.com/fixture/repository/pull/8002",
    };
    await writeFile(resolve(previous, "attempt.json"), priorBytes);
    await writeFile(resolve(previousSource, "publication.json"), JSON.stringify(publication));
    await writeFile(
      resolve(previousSource, "delivery-source.json"),
      JSON.stringify({
        controller: current.source.owner,
        run: current.source.run,
        issue: current.source.issue,
        repository: current.source.repository,
        controllerRevision: stable,
        worktree: current.source.worktree,
        reviewWorktree: current.source.reviewWorktree,
        stateDirectory: previousSource,
        requiredChecks: current.source.requiredChecks,
        head: base,
        reviewId: "previous-reviewer",
      }),
    );
    const configBytes = JSON.stringify({
      fingerprint: sha(
        JSON.stringify({
          config: current.source,
          prompts: [current.source.author.prompt, current.source.reviewer.prompt],
        }),
      ),
      config: current.source,
    });
    await writeFile(resolve(current.paths.source, "config.json"), configBytes);
    const oldTrace = resolve(current.paths.source, "interrupted-author.jsonl");
    const interruptedId = "01a09eec-d3a9-7e53-8b40-34d9e363dcdd";
    const traceBytes = `${JSON.stringify({ type: "thread.started", thread_id: interruptedId })}\n${JSON.stringify({ type: "item.completed", item: { id: "item_46", type: "command_execution", command: "pnpm test", exit_code: 0 } })}\n`;
    await writeFile(oldTrace, traceBytes);
    const child = spawn(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
    await once(child, "exit");
    expect(() => process.kill(child.pid!, 0)).toThrow();
    const interrupted = ["legacy retry", "failed fetch", "spent retry"].includes(mode);
    if (interrupted)
      await writeFile(
        resolve(current.paths.source, "author-attempt.json"),
        JSON.stringify({
          id: interruptedId,
          pid: child.pid,
          trace: oldTrace,
          launchedAt: 1,
          ...(mode === "spent retry" ? { retries: 1 } : {}),
        }),
      );
    const patch =
      "diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1 +1 @@\n-process.cwd()\n+import.meta.url\n";
    let dirty = interrupted;
    let sourceHead = base;
    let reviewHead = base;
    let authorDone = false;
    const prompts: { role: string; prompt: string }[] = [];
    const mutations: string[] = [];
    const native: Adapter = {
      async preflight() {},
      async git(tree, args) {
        if (args[0] === "rev-parse")
          return args[1] === "--show-toplevel"
            ? tree
            : tree === current.paths.pilot
              ? stable
              : tree === current.paths.review
                ? reviewHead
                : sourceHead;
        if (args[0] === "status")
          return tree === current.paths.author && dirty ? " M fixture.ts" : "";
        if (args[0] === "diff")
          return args.includes("--binary")
            ? patch
            : args.includes("--cached")
              ? ""
              : `${current.source.allowedPaths[0]}\0`;
        if (args[0] === "reset") {
          expect(await readFile(resolve(previousSource, "hosted-failure.log"), "utf8")).toContain(
            "actual underlying diagnostic",
          );
          expect(
            await readFile(
              resolve(current.paths.source, `author-retry-${interruptedId}.patch`),
              "utf8",
            ),
          ).toBe(`${patch}\n`);
          mutations.push("reset");
          dirty = false;
          return "";
        }
        if (args[0] === "clean") {
          mutations.push("clean");
          return "";
        }
        if (args[0] === "checkout") {
          reviewHead = args.at(-1)!;
          return "";
        }
        if (args[0] === "commit") {
          sourceHead = candidate;
          return "";
        }
        if (args[0] === "merge-base") return base;
        return "";
      },
      async launch(role, config, prompt) {
        prompts.push({ role, prompt });
        return {
          id: `new-${role}`,
          pid: 2 + prompts.length,
          trace: resolve(config.stateDirectory, `new-${role}.jsonl`),
          launchedAt: 2,
        };
      },
      async observe(role, _config, attempt) {
        if (attempt.id === interruptedId)
          return codexAdapter("git", () => 60_000).observe(role, _config, attempt);
        return {
          id: attempt.id,
          status: role === "author" && authorDone ? "passed" : "running",
          head: role === "author" ? base : candidate,
          summary: "",
        };
      },
      async checks() {
        throw new Error("unused");
      },
    };
    const checks = ["PR Required", "Static Checks", "Unit Tests", "E2E"].map((name, index) => ({
      name,
      bucket: "fail" as const,
      link: `https://github.com/fixture/repository/actions/runs/${index === 3 ? 34818999246 : 34818999245}/job/${index + 1}`,
      actions: {
        run: index === 3 ? 34818999246 : 34818999245,
        attempt: 1,
        job: index + 1,
        workflow: index === 3 ? 2 : 1,
      },
    }));
    let fetches = 0;
    const delivery = {
      async checks(config: DeliveryConfig, observedPublication: PublicationEvidence) {
        expect(config.candidateHead).toBe(base);
        expect(config.controllerRoot).toBe(current.paths.controller);
        expect(config.repositoryRoot).toBe(current.paths.repository);
        expect(observedPublication).toEqual(publication);
        return { head: base, checks };
      },
      async failedCheckLog(
        config: DeliveryConfig,
        check: { name: string },
        observedPublication: PublicationEvidence,
      ) {
        expect(config.candidateHead).toBe(base);
        expect(observedPublication).toEqual(publication);
        fetches++;
        if (mode === "failed fetch") throw new Error("hosted logs unavailable");
        return `${(check.name === "E2E" ? ["E2E"] : ["PR Required", "Static Checks", "Unit Tests"]).map((name) => `${name}: actual underlying diagnostic`).join("\n")}\n${"PR Required aggregate boilerplate\n".repeat(200)}`;
      },
    } as DeliveryAdapter;
    const adapter = () =>
      repositoryQueueAdapter(current.config, current.paths.controller, { native, delivery });
    if (mode === "spent retry") {
      await expect(adapter().source(current.item)).rejects.toMatchObject({
        reason: "launcher-failed",
        retries: 1,
      });
      expect(fetches).toBe(0);
      expect(prompts).toEqual([]);
      expect(mutations).toEqual([]);
      expect(current.item.implementationAttempt).toBe(4);
      return;
    }
    if (mode === "failed fetch") {
      await expect(adapter().source(current.item)).rejects.toMatchObject({
        reason: "hosted-failure-evidence-unavailable",
      });
      expect(isItemStopReason("hosted-failure-evidence-unavailable")).toBe(false);
      expect(prompts).toEqual([]);
      expect(mutations).toEqual([]);
      expect(dirty).toBe(true);
      return;
    }
    await expect(adapter().source(current.item)).resolves.toMatchObject({
      status: "observing-author",
      ...(mode === "legacy retry" ? { retries: 1 } : {}),
    });
    const evidencePath = resolve(previousSource, "hosted-failure.log");
    const evidence = await readFile(evidencePath, "utf8");
    for (const check of checks) {
      expect(evidence).toContain(`${check.name}: actual underlying diagnostic`);
      expect(evidence).toContain(check.link);
    }
    expect(evidence).toContain(base);
    expect(evidence).toContain('"number":8002');
    expect(prompts[0]!.prompt).toContain(JSON.stringify(evidencePath));
    expect(prompts[0]!.prompt.length).toBeLessThan(8000);
    expect(prompts[0]!.prompt).not.toContain("actual underlying diagnostic");
    if (mode === "legacy retry") {
      expect(prompts[0]!.prompt).toContain(JSON.stringify(oldTrace));
      expect(prompts[0]!.prompt).toContain("author-retry-discard.json");
      expect(
        await readFile(
          resolve(current.paths.source, `author-retry-${interruptedId}.patch`),
          "utf8",
        ),
      ).toBe(`${patch}\n`);
      expect(mutations).toEqual(["reset", "clean"]);
    }
    await expect(adapter().source(current.item)).resolves.toMatchObject({
      status: "observing-author",
    });
    authorDone = true;
    await expect(adapter().source(current.item)).resolves.toMatchObject({
      status: "observing-reviewer",
    });
    expect(prompts[1]!.role).toBe("reviewer");
    expect(prompts[1]!.prompt).toContain(JSON.stringify(evidencePath));
    expect(prompts[1]!.prompt).toContain("author-terminal.json");
    expect(prompts[1]!.prompt).toContain("new-author.jsonl");
    expect(fetches).toBe(2);
    expect(evidence.match(/Static Checks: actual underlying diagnostic/g)).toHaveLength(1);
    expect(await readFile(resolve(previous, "attempt.json"), "utf8")).toBe(priorBytes);
    expect(await readFile(resolve(current.paths.source, "config.json"), "utf8")).toBe(configBytes);
    expect(await readFile(oldTrace, "utf8")).toBe(traceBytes);
    await expect(
      readFile(resolve(current.paths.source, "interrupted-author.exit.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(current.item.implementationAttempt).toBe(4);
  },
);

it("directly composes the accepted setup transition before source work", async () => {
  const current = await fixture();
  await Promise.all(
    [current.paths.pilot, current.paths.author, current.paths.review].map((path) =>
      rm(path, { recursive: true }),
    ),
  );
  const present = new Set<SetupRole>();
  const dependencies = new Set<SetupRole>();
  const setup: SetupAdapter = {
    async assertExecutor(_config, executingRoot) {
      expect(executingRoot).toBe(current.paths.controller);
    },
    async observeWorktree(config, role) {
      if (!present.has(role)) return { state: "absent" };
      return {
        state: "confirmed",
        head: role === "pilot" ? stable : base,
        branch: role === "source" ? config.sourceBranch : null,
      };
    },
    async createWorktree(config, role) {
      const path =
        role === "pilot"
          ? config.pilotWorktree
          : role === "source"
            ? config.sourceWorktree
            : config.reviewWorktree;
      await mkdir(path);
      present.add(role);
    },
    async observeDependencies(_config, role) {
      return dependencies.has(role) ? "present" : "absent";
    },
    async installDependencies(_config, role) {
      dependencies.add(role);
      return "succeeded";
    },
  };
  const adapter = repositoryQueueAdapter(current.config, current.paths.controller, {
    native: {} as never,
    setup,
  });

  await expect(adapter.setup(current.item)).resolves.toMatchObject({
    status: "ready",
    phase: "complete",
    heads: { pilot: stable, source: base, review: base },
  });
  expect([...present]).toEqual(["pilot", "source", "review"]);
  expect([...dependencies]).toEqual(["pilot", "source", "review"]);
});

it.each([false, true])(
  "resumes native setup at the same controller after an upgrade, with pending note %s",
  async (pendingNote) => {
    const f = await fixture();
    const execute = promisify(execFile);
    const gitExecutable = (
      await execute(process.platform === "win32" ? "where.exe" : "which", ["git"])
    ).stdout
      .trim()
      .split(/\r?\n/)[0]!;
    const git = async (cwd: string, args: string[]) =>
      (await execute(gitExecutable, ["-C", cwd, ...args])).stdout.trim();
    for (const root of [f.paths.repository, f.paths.controller]) {
      await git(root, ["init", "-b", "main"]);
      await git(root, ["config", "user.name", "Synthetic Fixture"]);
      await git(root, ["config", "user.email", "fixture@example.test"]);
      await writeFile(resolve(root, ".gitignore"), "node_modules/\n");
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "synthetic old executor"]);
    }
    const loop: LoopConfig = {
      schemaVersion: "dogfood-loop/v1",
      run: "synthetic-setup-upgrade",
      adapter: "chase-sets",
      repository: "fixture/repository",
      stableExecutorRoot: f.paths.repository,
      stateRoot: resolve(f.root, "loop-state"),
      worktreeRoot: resolve(f.root, "loop-worktrees"),
      codexExecutable: process.execPath,
      gitExecutable,
      nativeLaunchCeiling: 8,
      attemptCeiling: 4,
      routingRows: [{ ...SELF_ROUTING, row: 7, review: 11 }],
    };
    const selected = {
      key: "fixture-159",
      number: 159,
      base: await git(f.paths.repository, ["rev-parse", "HEAD"]),
    };
    const policy: RepositoryAdapter = {
      selectCandidates: () => [],
      issueContext: async () => ({
        title: "Synthetic setup",
        body: "Synthetic setup criteria",
        acceptanceCriteria: ["retain diagnostics"],
        rules: "Keep setup bounded",
        routing: { row: 7, review: 11 },
      }),
      branchName: () => "codex/synthetic-setup",
      requiredChecks: () => ["synthetic-check"],
      pullRequest: async () => {
        throw new Error("no publication during setup");
      },
      park: () => {
        throw new Error("setup failure must not park");
      },
      mergeMethod: () => ({ method: "squash" }),
      afterMerge: () => {},
    };
    const compose = () => queueConfigFromLoop(loop, f.paths.controller, selected, policy);
    let q = await compose();
    const item = q.items[0]!;
    const script = resolve(f.root, "synthetic-installer.cjs");
    const allow = resolve(f.root, "allow-source");
    await writeFile(
      script,
      `
    const fs = require('node:fs');
    if (process.cwd().endsWith('-source') && !fs.existsSync(${JSON.stringify(allow)})) {
      fs.writeSync(1, 'leading source\\nAuthorization: FAKE_SOURCE_SECRET\\ntrailing source\\n');
      fs.writeSync(2, 'source failure https://FAKE_URL_SECRET@host/path\\ntrailing error\\n');
      process.exitCode = 7;
    } else {
      fs.mkdirSync('node_modules', { recursive: true });
      fs.writeFileSync('node_modules/.modules.yaml', 'fixture: true\\n');
    }
  `,
    );
    const launcher = async () => ({ executable: process.execPath, prefixArgs: [script] });
    // Execute the pre-ISS-159 contract: real child, outcome only, no retained stdout.
    const oldSetup = gitSetupAdapter({
      gitExecutable,
      resolveLauncher: launcher,
      async install(command, args, cwd) {
        try {
          await execute(command.executable, [...command.prefixArgs, ...args], { cwd });
          return "succeeded";
        } catch {
          return "failed";
        }
      },
    });
    const launches: string[] = [];
    const native: Adapter = {
      async preflight() {},
      git,
      async launch(role, config) {
        launches.push(role);
        const trace = resolve(config.stateDirectory, `${role}.jsonl`);
        await writeFile(trace, "synthetic running worker\n");
        return { id: randomUUID(), pid: 111, trace, launchedAt: 1 };
      },
      async observe(_role, _config, attempt) {
        return { id: attempt.id, status: "running" };
      },
      async checks() {
        throw new Error("no hosted checks during setup");
      },
    };
    const adapter = (setup: SetupAdapter) =>
      repositoryQueueAdapter(q, f.paths.controller, { gitExecutable, native, setup });
    await expect(queueStep(q, adapter(oldSetup))).rejects.toMatchObject({
      reason: "dependency-install-failed",
      diagnostics: undefined,
    });
    expect(launches).toEqual([]);
    const planPath = resolve(item.setup.stateDirectory, "setup-plan.json");
    const oldPlan = await readFile(planPath, "utf8");
    const attemptPath = resolve(q.stateDirectory, "attempt.json");
    const oldAttempt = await readFile(attemptPath, "utf8");
    expect(JSON.parse(oldAttempt)).toMatchObject({
      phase: "setup",
      candidateAttempt: 1,
      retries: 0,
      history: [],
      routing: { row: 7, review: 11 },
    });
    const cycle = { selection: { cycle: 1, ...selected }, initialHistory: [] };
    await persistCycle(loop, cycle);
    const comments: string[] = [];
    let loseReceipt = pendingNote;
    const supervisor: SupervisionAdapter = {
      async currentMain() {
        throw new Error("saved selection must keep base");
      },
      async issue() {
        return { state: "OPEN", key: selected.key, labels: ["ready"], comments };
      },
      async removeReady() {
        throw new Error("no parking");
      },
      async close() {
        throw new Error("no closure");
      },
      async comment(_config, _number, body) {
        comments.push(body);
        if (loseReceipt) throw new Error("synthetic lost comment receipt");
      },
    };
    const stop = stopCycle(loop, cycle, "dependency-install-failed", 1, supervisor, policy);
    if (pendingNote) await expect(stop).rejects.toThrow("synthetic lost comment receipt");
    else await stop;
    const stopPath = resolve(loop.stateRoot, loop.run, "cycle-1-stop-1.json");
    const oldStop = await readFile(stopPath, "utf8");
    await git(f.paths.controller, ["commit", "--allow-empty", "-m", "synthetic upgraded executor"]);
    loseReceipt = false;
    await reconcilePendingStop(loop, cycle, supervisor, policy);
    expect(comments).toHaveLength(1);
    expect(await nextCycle(loop, f.paths.controller, supervisor, policy)).toMatchObject(cycle);
    q = await compose();
    expect(q.controllerRoot).toBe(item.setup.controllerRoot);
    expect(q.controllerRevision).not.toBe(item.setup.controllerRevision);
    const setup = gitSetupAdapter({ gitExecutable, resolveLauncher: launcher });
    for (const field of ["base", "ignoreScripts"]) {
      const changed = JSON.parse(oldPlan);
      if (field === "base") changed.base = "f".repeat(40);
      else changed.dependencies.ignoreScripts = false;
      await writeFile(planPath, JSON.stringify(changed, null, 2) + "\n");
      await expect(queueStep(q, adapter(setup))).rejects.toMatchObject({
        reason: "conflicting-record:setup-plan",
      });
      expect(launches).toEqual([]);
      await writeFile(planPath, oldPlan);
    }
    let failure: QueueBlocked | undefined;
    try {
      await queueStep(q, adapter(setup));
    } catch (error) {
      failure = error as QueueBlocked;
    }
    expect(failure).toMatchObject({ reason: "dependency-install-failed" });
    expect(launches).toEqual([]);
    expect(await readFile(attemptPath, "utf8")).toBe(oldAttempt);
    expect(await readFile(planPath, "utf8")).toBe(oldPlan);
    const metadata = JSON.parse(await readFile(failure!.diagnostics!, "utf8"));
    expect(metadata.role).toBe("source");
    const stdout = await readFile(metadata.stdout, "utf8");
    const stderr = await readFile(metadata.stderr, "utf8");
    const terminal = await readFile(metadata.terminal, "utf8");
    expect(stdout).toBe("leading source\n[REDACTED]\ntrailing source\n");
    expect(stderr).toBe("source failure https:[REDACTED]\ntrailing error\n");
    expect(JSON.parse(terminal)).toMatchObject({
      status: "failed",
      exitCode: 7,
      head: selected.base,
    });
    await stopCycle(loop, cycle, failure!.reason, 1, supervisor, policy, failure!.diagnostics);
    expect(comments).toHaveLength(2);
    expect(comments[1]).toContain(`Diagnostic: ${JSON.stringify(failure!.diagnostics)}.`);
    expect(comments[1]).not.toContain("FAKE_");
    expect(comments[1]).not.toContain("--frozen-lockfile");
    expect(comments[1]).not.toContain("trailing error");
    const names = await readdir(item.setup.stateDirectory);
    expect(names.some((name) => name.startsWith("dependency-pilot-install-"))).toBe(false);
    expect(names.some((name) => name.startsWith("dependency-review"))).toBe(false);
    await writeFile(allow, "explicit resume\n");
    q = await compose();
    expect(await queueStep(q, adapter(setup))).toMatchObject({ status: "observing-author" });
    expect(launches).toEqual(["author"]);
    expect(JSON.parse(await readFile(attemptPath, "utf8"))).toMatchObject({
      phase: "source",
      candidateAttempt: 1,
      retries: 0,
      routing: { row: 7, review: 11 },
    });
    const completeNames = await readdir(item.setup.stateDirectory);
    expect(
      completeNames.filter((name) => /^dependency-source-install-.*\.terminal\.json$/.test(name)),
    ).toHaveLength(2);
    expect(await adapter(setup).setup(q.items[0]!)).toMatchObject({ status: "ready" });
    expect(await readdir(item.setup.stateDirectory)).toEqual(completeNames);
    expect(await readFile(metadata.terminal, "utf8")).toBe(terminal);
    expect(await readFile(metadata.stdout, "utf8")).toBe(stdout);
    expect(await readFile(metadata.stderr, "utf8")).toBe(stderr);
    expect(await readFile(planPath, "utf8")).toBe(oldPlan);
    expect(await readFile(stopPath, "utf8")).toBe(oldStop);
    // The live revision check is still mandatory after admission.
    await git(f.paths.controller, ["commit", "--allow-empty", "-m", "synthetic unexpected drift"]);
    await expect(queueStep(q, adapter(setup))).rejects.toMatchObject({
      reason: "controller-executor-revision-moved",
    });
  },
  30_000,
);

it.each([false, true])(
  "lands after an author death and gate correction across restart (provider outage: %s)",
  async (providerFailure) => {
    const current = await fixture();
    const corrected = "f".repeat(40);
    current.item.implementationAttempt = 2;
    await enableLadders(current);
    current.item.delivery.refresh = {
      number: 337,
      url: "https://example.test/pull/337",
      head: current.item.base,
    };
    let sourceHead = base;
    let reviewHead = base;
    let pid = 10;
    let interruptGateCommit = true;
    const launches: string[] = [];
    const native: Adapter = {
      async preflight() {},
      async git(worktree, args) {
        if (args[0] === "rev-parse" && args[1] === "--verify") return base;
        if (args[0] === "rev-parse" && args[1] === `${corrected}^`) return candidate;
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return worktree;
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          if (worktree === current.paths.pilot) return stable;
          if (worktree === current.paths.review) return reviewHead;
          return sourceHead;
        }
        if (args[0] === "status") return "";
        if (args[0] === "checkout") {
          reviewHead = String(args.at(-1));
          return "";
        }
        if (args[0] === "merge-base") return String(args[1]);
        if (args[0] === "diff")
          return args.includes("--cached") || (sourceHead === corrected && !args.includes(base))
            ? ""
            : `scripts/dogfood/queue.ts\0`;
        if (args[0] === "ls-files") return "";
        if (args[0] === "commit") {
          sourceHead = sourceHead === base ? candidate : corrected;
          if (sourceHead === corrected && interruptGateCommit) {
            interruptGateCommit = false;
            throw new Error("simulated restart after gate commit");
          }
          return "";
        }
        return "";
      },
      async launch(role, selectedConfig, prompt): Promise<Attempt> {
        const correction = selectedConfig.stateDirectory.endsWith("gate-correction");
        if (role === "author") {
          const rung = correction ? 2 : launches.length === 0 ? 0 : 1;
          expect(selectedConfig.author).toMatchObject({ ...SELF_ROUTING.author[rung], rung });
          expect(
            JSON.parse(
              await readFile(resolve(selectedConfig.stateDirectory, "author-intent.json"), "utf8"),
            ),
          ).toMatchObject({ rung });
        }
        if (role === "reviewer") {
          expect(prompt).toContain(
            "Is there a simpler shape that still satisfies every acceptance criterion and every stated not-built reason? Answer No with one reason, or name the shape and the constraint you checked it against.",
          );
          if (!correction) {
            expect(prompt).toContain(JSON.stringify(current.source.allowedPaths));
            // ISS-198: the assembled source-stage prompt (flow report text plus
            // the queue's report suffix) states the one shared bound in both halves.
            expect(
              [...prompt.matchAll(/(\d+) characters/g)].map((match) => Number(match[1])),
            ).toEqual([MAX_TERMINAL_SUMMARY_LENGTH, MAX_TERMINAL_SUMMARY_LENGTH]);
          }
        }
        const selected = correction ? `gate-${role}` : role;
        const deadAuthor = selected === "author" && launches.length === 0;
        launches.push(selected);
        return {
          id: deadAuthor
            ? "dead-author"
            : `source-${selected}${selected === `gate-${role}` ? `-${pid}` : ""}`,
          pid: pid++,
          trace: resolve(current.root, `${selected}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, selectedConfig, attempt) {
        if (attempt.id === "dead-author")
          return {
            id: attempt.id,
            status: "dead",
            summary: providerFailure ? "HTTP 503" : "worker crashed",
            ...(providerFailure ? { providerFailure: true } : {}),
          };
        const correction = attempt.id.startsWith("source-gate-");
        const terminalHead =
          role === "author" ? selectedConfig.base : correction ? corrected : candidate;
        return {
          status: "passed",
          id: attempt.id,
          head: terminalHead,
          usage: {
            input_tokens: role === "author" ? 11 : 7,
            output_tokens: role === "author" ? 3 : 2,
          },
          ...(role === "reviewer" ? { summary: passingReviewSummary(terminalHead) } : {}),
        };
      },
      async checks() {
        return { head: candidate, checks: [] };
      },
    };
    const plan: DeliveryPlan = {
      gates: {
        beforeMirror: ["typecheck", "format:check", "planning:check"],
        afterMirror: ["planning:board-check"],
      },
      drafts: [
        {
          key: "ISS-FIXTURE",
          issue: 338,
          title: "fixture",
          body: "fixture body",
          attributes: { milestone: "M2" },
        },
      ],
      publication: {
        sourceBranch: "codex/fixture-338",
        baseBranch: "main",
        title: "fixture",
        body: "fixture body",
        draft: true,
      },
      mergePolicy: { method: "squash" },
      cleanup: {
        worktrees: [current.paths.author, current.paths.review],
        branch: "codex/fixture-338",
      },
    };
    let draft = false;
    let published = false;
    let publicationMutations = 0;
    let publishedDigest = "";
    let merged = false;
    let mergeMutations = 0;
    let cleaned = false;
    const publication = (): PublicationEvidence => ({
      number: 337,
      url: "https://example.test/pull/337",
      head: corrected,
      repository: current.source.repository,
      sourceBranch: plan.publication.sourceBranch,
      baseBranch: plan.publication.baseBranch,
      title: plan.publication.title,
      body: plan.publication.body,
      planDigest: publishedDigest,
    });
    let capturedDelivery: DeliveryConfig | undefined;
    let gateCalls = 0;
    let hostedReady = false;
    const postMerge: string[] = [];
    const repositoryPolicy: RepositoryAdapter = {
      selectCandidates: () => [],
      issueContext: async () => {
        throw new Error("unused");
      },
      branchName: () => plan.publication.sourceBranch,
      pullRequest: () => plan.publication,
      requiredChecks: () => [...current.source.requiredChecks],
      park: () => "add the `ready` label after acting on the note",
      mergeMethod: () => plan.mergePolicy,
      afterMerge({ config, delivery: completed }) {
        expect(config.candidateHead).toBe(corrected);
        postMerge.push(completed.mergeCommit);
      },
    };
    const delivery: DeliveryAdapter = {
      publicationUrl: (_config, number) => `https://example.test/pull/${number}`,
      async source(config) {
        capturedDelivery = config;
        return {
          head: config.candidateHead,
          reviewId: JSON.parse(
            await readFile(resolve(config.stateDirectory, "reviewer-attempt.json"), "utf8"),
          ).id,
          controller: current.source.owner,
          run: config.run,
          issue: config.issue,
          repository: config.repository,
          controllerRevision: stable,
          worktree: config.worktree,
          reviewWorktree: config.reviewWorktree,
          stateDirectory: config.stateDirectory,
          requiredChecks: [...config.requiredChecks],
        };
      },
      async verifyWorkspace(_config, head) {
        return sourceHead === head && reviewHead === head;
      },
      async runGate(config) {
        gateCalls += 1;
        if (sourceHead !== config.candidateHead || reviewHead !== config.candidateHead)
          return { status: "failed", output: "candidate workspace drifted before gate" };
        if (gateCalls !== 1) return "passed";
        const log = resolve(config.stateDirectory, "typecheck.log");
        await writeFile(log, "scripts/dogfood/queue.ts(1,1): error TS2322: incorrect type\n");
        return {
          status: "failed",
          output: "compiler diagnostic",
          evidence: {
            head: config.candidateHead,
            log,
            cause: "diagnostic",
            diagnostics: ["scripts/dogfood/queue.ts(1,1): error TS2322: incorrect type"],
            command: {
              executable: process.execPath,
              argv: ["fixture-pnpm", "run", "typecheck"],
              cwd: config.worktree,
            },
          },
        };
      },
      async attributeGate(_config, _name, _evidence, main) {
        return { cause: "candidate", main, log: resolve(current.paths.source, "base.log") };
      },
      async observeDraft() {
        return draft ? { state: "confirmed", value: { issue: 338 } } : { state: "needs-mutation" };
      },
      async applyDraft() {
        draft = true;
      },
      async observePublication(_config, _plan, planDigest) {
        publishedDigest = planDigest;
        return published
          ? { state: "confirmed", value: publication() }
          : { state: "needs-mutation", target: "absent" };
      },
      async publish() {
        publicationMutations += 1;
        published = true;
      },
      async checks(config) {
        return {
          head: corrected,
          checks: config.requiredChecks.map((name) => ({
            name,
            bucket: hostedReady ? ("pass" as const) : ("pending" as const),
            link: `https://example.test/check/${name}`,
          })),
        };
      },
      async observeMerge() {
        return merged
          ? { state: "confirmed", value: { number: 337, head: corrected, mergeCommit } }
          : { state: "needs-mutation" };
      },
      async merge() {
        mergeMutations += 1;
        merged = true;
      },
      async observeCleanup() {
        return cleaned
          ? {
              state: "confirmed",
              value: { worktrees: [...plan.cleanup.worktrees], branch: plan.cleanup.branch },
            }
          : { state: "needs-mutation" };
      },
      async cleanup() {
        cleaned = true;
      },
    };
    const adapter = repositoryQueueAdapter(current.config, current.paths.controller, {
      native,
      delivery,
      deliveryPolicy: {
        async plan() {
          return plan;
        },
      },
      repository: repositoryPolicy,
      assertExecutor: async () => {},
    });
    const queueAdapter: QueueAdapter = { ...adapter, async assertExecutor() {} };

    const accepted = await adapter.source(current.item);
    expect(accepted).toEqual({
      status: "accepted",
      head: candidate,
      reviewId: "source-reviewer",
      stateDirectory: current.paths.source,
      ...(providerFailure ? {} : { retries: 1 }),
    });
    expect(await adapter.history()).toEqual([
      expect.objectContaining({ ordinal: 1, id: "dead-author", outcome: "dead" }),
      expect.objectContaining({
        ordinal: 2,
        id: "source-author",
        outcome: "passed",
        usage: {
          inputTokens: { status: "known", value: 11 },
          outputTokens: { status: "known", value: 3 },
          costUsd: unavailable,
        },
      }),
      expect.objectContaining({ ordinal: 3, id: "source-reviewer", outcome: "passed" }),
    ]);
    if (accepted.status !== "accepted") throw new Error("fixture source did not accept");
    await writeFile(
      resolve(current.paths.queue, "attempt.json"),
      `${JSON.stringify({
        schemaVersion: "dogfood-bounded-queue-attempt/v1",
        phase: "delivery",
        run: current.config.run,
        index: 0,
        item: current.item.id,
        issue: current.item.issue,
        base: current.item.base,
        candidateAttempt: current.item.implementationAttempt,
        head: accepted.head,
        reviewId: accepted.reviewId,
        findings: [],
        history: await adapter.history(),
        authorFailures: JSON.parse(
          await readFile(resolve(current.paths.queue, "attempt.json"), "utf8"),
        ).authorFailures,
        retries: accepted.retries ?? 0,
        acceptedStage: "source",
        stateDirectory: accepted.stateDirectory,
      })}\n`,
    );
    await expect(queueStep(current.config, queueAdapter)).resolves.toMatchObject({
      status: "observing-author",
    });
    await expect(queueStep(current.config, queueAdapter)).rejects.toThrow(
      "simulated restart after gate commit",
    );
    const interrupted = JSON.parse(
      await readFile(resolve(current.paths.queue, "attempt.json"), "utf8"),
    );
    expect(interrupted).toMatchObject({ head: candidate, retries: providerFailure ? 1 : 2 });
    expect(interrupted.authorFailures).toEqual({ count: 2, ids: ["dead-author", "source-author"] });
    await expect(queueStep(current.config, queueAdapter)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    const freshReviewer = JSON.parse(
      await readFile(
        resolve(current.paths.source, "gate-correction/reviewer-attempt.json"),
        "utf8",
      ),
    ).id;
    expect(freshReviewer).not.toBe("source-reviewer");
    await expect(
      readFile(resolve(current.paths.queue, "attempt.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      head: corrected,
      reviewId: freshReviewer,
      retries: providerFailure ? 1 : 2,
    });
    const effectsAfterCorrection = { launches: [...launches], gateCalls };
    hostedReady = true;
    await expect(queueStep(current.config, queueAdapter)).resolves.toMatchObject({
      status: "complete",
    });
    await expect(
      readFile(resolve(current.paths.queue, "attempt.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      phase: "complete",
      head: corrected,
      retries: providerFailure ? 1 : 2,
      candidateAttempt: 2,
    });
    expect({ launches, gateCalls }).toEqual(effectsAfterCorrection);
    expect(launches).toEqual(["author", "author", "reviewer", "gate-author", "gate-reviewer"]);
    expect({ draft, published, merged, cleaned }).toEqual({
      draft: true,
      published: true,
      merged: true,
      cleaned: true,
    });
    expect({ publicationMutations, mergeMutations }).toEqual({
      publicationMutations: 1,
      mergeMutations: 1,
    });
    expect(capturedDelivery).toMatchObject({
      controllerRoot: current.paths.controller,
      repositoryRoot: current.paths.repository,
      refresh: current.item.delivery.refresh,
    });
    expect(postMerge).toEqual([mergeCommit]);
  },
);

it.each([false, true])("delivers and resumes (unchanged: %s)", async (unchanged) => {
  const current = await fixture();
  if (unchanged) await enableLadders(current);
  const repaired = unchanged ? candidate : "d".repeat(40);
  const sourceSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: candidate,
    verdict: "FAIL",
    findings: [
      {
        file: "scripts/dogfood/queue.ts",
        line: 3,
        severity: "blocking",
        text: "synthetic fixable review defect",
      },
    ],
    g0: "The prescribed repair is the simplest change.",
  });
  const deltaSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: repaired,
    verdict: "PASS",
    findings: [],
    g0: "The prescribed repair is the simplest change.",
  });
  let sourceHead = base;
  let reviewHead = base;
  let pid = 100;
  const workerEffects: string[] = [];
  const native: Adapter = {
    async preflight() {},
    async git(worktree, args) {
      if (args[0] === "rev-parse" && args[1] === "--verify") return base;
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return worktree;
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        if (worktree === current.paths.pilot) return stable;
        return worktree === current.paths.review ? reviewHead : sourceHead;
      }
      if (args[0] === "status") return "";
      if (args[0] === "checkout") {
        reviewHead = String(args.at(-1));
        return "";
      }
      if (args[0] === "merge-base") return args[1]!;
      if (args[0] === "diff")
        return args.includes("--cached") || (args.at(-1) === "HEAD" && sourceHead === candidate)
          ? ""
          : "scripts/dogfood/queue.ts\0";
      if (args[0] === "ls-files") return "";
      if (args[0] === "show") return args.includes("-z") ? "\none\n\n" : "one";
      if (args[0] === "commit") {
        sourceHead = candidate;
        return "";
      }
      return "";
    },
    async launch(role, config, prompt) {
      const stage = config.stateDirectory === current.paths.repair ? "repair" : "source";
      if (unchanged && role === "author")
        expect(config.author).toMatchObject({
          ...SELF_ROUTING.author[stage === "source" ? 0 : 1],
          rung: stage === "source" ? 0 : 1,
        });
      if (unchanged && role === "reviewer")
        if (config.reviewer.model === SELF_ROUTING.reviewer[0]!.model) {
          expect(stage).toBe("source");
          throw new QueueBlocked("provider-model-refused");
        } else expect(config.reviewer).toMatchObject({ ...SELF_ROUTING.reviewer[1], rung: 1 });
      workerEffects.push(`${stage}:${role}`);
      if (stage === "repair") {
        expect(config).toMatchObject({ base: candidate, mainBase: base });
        expect(prompt).toContain(
          role === "author"
            ? `distinct delivery main base remains ${base}`
            : `Delivery main base: ${base}`,
        );
        if (role === "reviewer")
          expect(prompt).toContain("Selected author attempt synthetic-repair-author");
      }
      return {
        id: `synthetic-${stage}-${role}`,
        pid: pid++,
        trace: resolve(config.stateDirectory, `${role}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, _config, attempt) {
      if (_config.stateDirectory === current.paths.repair)
        return {
          status: "passed",
          id: attempt.id,
          head: candidate,
          ...(role === "reviewer"
            ? { usage: { input_tokens: 5, output_tokens: 2 }, summary: deltaSummary }
            : {}),
        };
      return role === "author"
        ? {
            status: "passed",
            id: attempt.id,
            head: base,
            usage: { input_tokens: 11, output_tokens: 3 },
          }
        : {
            status: "failed",
            id: attempt.id,
            head: candidate,
            usage: { input_tokens: 8, output_tokens: 4, cost_usd: 1.25 },
            summary: sourceSummary,
          };
    },
    async checks() {
      return { head: candidate, checks: [] };
    },
  };
  const repairAdapter: RepairAdapter = {
    async dispatch() {
      await writeFile(
        resolve(current.paths.repair, "config.json"),
        JSON.stringify({
          config: {
            ...current.source,
            base: candidate,
            mainBase: base,
            stateDirectory: current.paths.repair,
          },
        }),
      );
      const rows = [
        {
          ordinal: 3,
          id: "synthetic-repair-author",
          role: "author" as const,
          head: candidate,
          usage: undefined,
        },
        {
          ordinal: 4,
          id: "synthetic-repair-reviewer",
          role: "reviewer" as const,
          head: repaired,
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      ];
      workerEffects.push(...rows.map((row) => `repair:${row.role}`));
      await writeFile(
        resolve(current.paths.repair, "candidate.json"),
        JSON.stringify({ head: repaired, changed: ["scripts/dogfood/queue.ts"] }),
      );
      for (const row of rows) {
        await Promise.all([
          writeFile(
            resolve(current.paths.repair, `${row.role}-attempt.json`),
            JSON.stringify({
              id: row.id,
              pid: row.ordinal + 100,
              trace: resolve(current.root, `${row.id}.jsonl`),
              launchedAt: 1,
            }),
          ),
          writeFile(
            resolve(current.paths.repair, `${row.role}-terminal.json`),
            JSON.stringify({
              status: "passed",
              id: row.id,
              head: row.head,
              ...(row.usage ? { usage: row.usage } : {}),
              ...(row.role === "reviewer" ? { summary: deltaSummary } : {}),
            }),
          ),
        ]);
      }
      return { status: "awaiting-publication" };
    },
  };
  const plan: DeliveryPlan = {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [
      {
        key: "ISS-SYNTHETIC-COMPLETION",
        issue: 350,
        title: "synthetic completion",
        body: "synthetic completion body",
        attributes: { milestone: "synthetic-M2" },
      },
    ],
    publication: {
      sourceBranch: "codex/synthetic-completion",
      baseBranch: "main",
      title: "synthetic completion",
      body: "synthetic completion body",
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: {
      worktrees: [current.paths.author, current.paths.review],
      branch: "codex/synthetic-completion",
    },
  };
  const mutationEffects: string[] = [];
  let draft = false;
  let published = false;
  let merged = false;
  let cleaned = false;
  let publicationDigest = "";
  const publication = (): PublicationEvidence => ({
    number: 350,
    url: "https://example.test/pull/350",
    head: repaired,
    repository: current.source.repository,
    sourceBranch: plan.publication.sourceBranch,
    baseBranch: plan.publication.baseBranch,
    title: plan.publication.title,
    body: plan.publication.body,
    planDigest: publicationDigest,
  });
  const delivery: DeliveryAdapter = {
    publicationUrl: (_config, number) => `https://example.test/pull/${number}`,
    async source(config) {
      return {
        head: repaired,
        reviewId: "synthetic-repair-reviewer",
        controller: current.source.owner,
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controllerRevision: stable,
        worktree: config.worktree,
        reviewWorktree: config.reviewWorktree,
        stateDirectory: config.stateDirectory,
        requiredChecks: [...config.requiredChecks],
      };
    },
    async verifyWorkspace() {
      return true;
    },
    async runGate(_config, name) {
      mutationEffects.push(`gate:${name}`);
      return "passed";
    },
    async observeDraft() {
      return draft ? { state: "confirmed", value: { issue: 350 } } : { state: "needs-mutation" };
    },
    async applyDraft() {
      mutationEffects.push("draft");
      draft = true;
    },
    async observePublication(_config, _plan, planDigest) {
      publicationDigest = planDigest;
      return published
        ? { state: "confirmed", value: publication() }
        : { state: "needs-mutation", target: "synthetic-absent" };
    },
    async publish() {
      mutationEffects.push("publish");
      published = true;
    },
    async checks(config) {
      return {
        head: repaired,
        checks: config.requiredChecks.map((name) => ({
          name,
          bucket: "pass" as const,
          link: `https://example.test/check/${name}`,
        })),
      };
    },
    async observeMerge() {
      return merged
        ? { state: "confirmed", value: { number: 350, head: repaired, mergeCommit } }
        : { state: "needs-mutation" };
    },
    async merge() {
      mutationEffects.push("merge");
      merged = true;
    },
    async observeCleanup() {
      return cleaned
        ? {
            state: "confirmed",
            value: { worktrees: [...plan.cleanup.worktrees], branch: plan.cleanup.branch },
          }
        : { state: "needs-mutation" };
    },
    async cleanup() {
      mutationEffects.push("cleanup");
      cleaned = true;
    },
  };
  const repository = repositoryQueueAdapter(current.config, current.paths.controller, {
    native,
    ...(unchanged ? {} : { repair: repairAdapter }),
    delivery,
    deliveryPolicy: {
      async plan() {
        return plan;
      },
    },
    assertExecutor: async () => {},
  });
  const componentEntries: string[] = [];
  const adapter: QueueAdapter = {
    async assertExecutor() {
      componentEntries.push("executor");
    },
    history: repository.history,
    async setup() {
      componentEntries.push("setup");
      return { status: "ready" };
    },
    async source(item) {
      componentEntries.push("source");
      return repository.source(item);
    },
    async repair(item) {
      componentEntries.push("repair");
      return repository.repair(item);
    },
    async delivery(item, accepted) {
      componentEntries.push("delivery");
      return repository.delivery(item, accepted);
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toEqual({
    status: "complete",
    run: current.config.run,
    cursor: 1,
    items: 1,
    participants: 4,
  });
  const completed = JSON.parse(
    await readFile(resolve(current.paths.queue, "attempt.json"), "utf8"),
  );
  if (unchanged) {
    expect(completed.authorFailures).toEqual({ count: 1, ids: ["synthetic-source-author"] });
    // Re-observing the predecessor FAIL must not charge the later corrective author.
    await expect(repository.source(current.item)).resolves.toMatchObject({
      status: "fixable-review",
    });
    expect(
      JSON.parse(await readFile(resolve(current.paths.queue, "attempt.json"), "utf8"))
        .authorFailures,
    ).toEqual(completed.authorFailures);
  }
  expect(Object.keys(completed).sort()).toEqual(
    [
      ...(unchanged ? ["authorFailures"] : []),
      "schemaVersion",
      "phase",
      "index",
      "item",
      "issue",
      "base",
      "history",
      "run",
      "head",
      "reviewId",
      "candidateAttempt",
      "findings",
      "retries",
      "acceptedStage",
      "stateDirectory",
    ].sort(),
  );
  expect(completed).toMatchObject({
    phase: "complete",
    run: current.config.run,
    issue: current.item.issue,
    head: repaired,
    reviewId: "synthetic-repair-reviewer",
    candidateAttempt: 2,
    retries: 0,
    acceptedStage: "repair",
    stateDirectory: current.paths.repair,
    history: [
      { id: "synthetic-source-author", outcome: "passed", usage: { costUsd: unavailable } },
      {
        id: "synthetic-source-reviewer",
        outcome: "failed",
        usage: { costUsd: { status: "known", value: 1.25 } },
      },
      { id: "synthetic-repair-author", outcome: "passed", usage: { costUsd: unavailable } },
      { id: "synthetic-repair-reviewer", outcome: "passed", usage: { costUsd: unavailable } },
    ],
  });
  expect(completed.history.map((participant: QueueParticipant) => participant.usage)).toEqual([
    {
      inputTokens: { status: "known", value: 11 },
      outputTokens: { status: "known", value: 3 },
      costUsd: unavailable,
    },
    {
      inputTokens: { status: "known", value: 8 },
      outputTokens: { status: "known", value: 4 },
      costUsd: { status: "known", value: 1.25 },
    },
    { inputTokens: unavailable, outputTokens: unavailable, costUsd: unavailable },
    {
      inputTokens: { status: "known", value: 5 },
      outputTokens: { status: "known", value: 2 },
      costUsd: unavailable,
    },
  ]);
  expect(mutationEffects).toEqual([
    "gate:typecheck",
    "gate:format:check",
    "gate:planning:check",
    "draft",
    "gate:planning:board-check",
    "publish",
    "merge",
    "cleanup",
  ]);
  expect(workerEffects).toEqual([
    "source:author",
    "source:reviewer",
    "repair:author",
    "repair:reviewer",
  ]);
  expect(componentEntries).toEqual(["executor", "setup", "source", "repair", "delivery"]);
  const queueFiles = (await readdir(current.paths.queue, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  expect(queueFiles).toEqual([
    "attempt.json",
    "participant-1-terminal.json",
    "participant-2-terminal.json",
    "participant-3-terminal.json",
    "participant-4-terminal.json",
  ]);
  const originalBytes = await Promise.all(
    queueFiles.map((name) => readFile(resolve(current.paths.queue, name), "utf8")),
  );
  const entriesAfterCompletion = componentEntries.length;
  const effectsAfterCompletion = mutationEffects.length;

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({ status: "complete" });
  expect(componentEntries.slice(entriesAfterCompletion)).toEqual(["executor"]);
  expect(mutationEffects).toHaveLength(effectsAfterCompletion);
  expect(workerEffects).toEqual([
    "source:author",
    "source:reviewer",
    "repair:author",
    "repair:reviewer",
  ]);
  expect(
    (await readdir(current.paths.queue, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort(),
  ).toEqual(queueFiles);
  expect(
    await Promise.all(
      queueFiles.map((name) => readFile(resolve(current.paths.queue, name), "utf8")),
    ),
  ).toEqual(originalBytes);
});

it("accepts and restarts a repair whose malformed review passes on its one retry", async () => {
  const sourceHistory: QueueParticipant[] = [
    {
      ordinal: 1,
      id: "source-author",
      item: "fixture-338",
      stage: "source",
      role: "author",
      outcome: "passed",
      usage: queueUsage({ input_tokens: 10, output_tokens: 2 }),
    },
    {
      ordinal: 2,
      id: "source-reviewer",
      item: "fixture-338",
      stage: "source",
      role: "reviewer",
      outcome: "failed",
      usage: queueUsage({ input_tokens: 8, output_tokens: 4, cost_usd: 1.25 }),
    },
  ];
  const current = await fixture(sourceHistory);
  const prompts: [string, string] = ["author prompt", "review prompt"];
  const fingerprint = sha(JSON.stringify({ config: current.source, prompts }));
  await Promise.all([
    ...sourceHistory.map((row) =>
      writeFile(
        resolve(current.paths.queue, `participant-${row.ordinal}-terminal.json`),
        `${JSON.stringify(row)}\n`,
      ),
    ),
    writeFile(
      resolve(current.paths.source, "config.json"),
      JSON.stringify({ fingerprint, config: current.source, host: "synthetic" }),
    ),
    writeFile(
      resolve(current.paths.source, "candidate.json"),
      JSON.stringify({ head: candidate, changed: current.source.allowedPaths }),
    ),
    writeFile(
      resolve(current.paths.source, "author-attempt.json"),
      JSON.stringify({ id: "source-author", pid: 1, trace: resolve(current.root, "author.jsonl") }),
    ),
    writeFile(
      resolve(current.paths.source, "reviewer-attempt.json"),
      JSON.stringify({
        id: "source-reviewer",
        pid: 2,
        trace: resolve(current.root, "reviewer.jsonl"),
      }),
    ),
  ]);
  const sourceSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: candidate,
    verdict: "FAIL",
    findings: [
      {
        file: current.source.allowedPaths[0],
        line: 1,
        severity: "blocking",
        text: "synthetic fixable defect",
      },
    ],
    g0: "The prescribed repair is the simplest change.",
  });
  await writeFile(
    resolve(current.paths.source, "reviewer-terminal.json"),
    JSON.stringify({
      status: "failed",
      id: "source-reviewer",
      head: candidate,
      summary: sourceSummary,
    }),
  );
  const deltaSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: repaired,
    verdict: "PASS",
    findings: [],
    g0: "The prescribed repair is the simplest change.",
  });
  let captured: any;
  const repairAdapter: RepairAdapter = {
    async dispatch(config, handoff) {
      captured = { config, handoff };
      const records = [
        { ordinal: 3, id: "repair-author", role: "author", head: candidate, stem: "author" },
        {
          ordinal: 4,
          id: "repair-reviewer-retry",
          role: "reviewer",
          head: repaired,
          stem: "reviewer",
        },
      ] as const;
      await writeFile(
        resolve(current.paths.repair, "candidate.json"),
        JSON.stringify({ head: repaired, changed: current.source.allowedPaths }),
      );
      for (const row of records) {
        await writeFile(
          resolve(current.paths.repair, `${row.stem}-attempt.json`),
          JSON.stringify({
            id: row.id,
            pid: row.ordinal,
            trace: resolve(current.root, `${row.id}.jsonl`),
          }),
        );
        await writeFile(
          resolve(current.paths.repair, `${row.stem}-terminal.json`),
          JSON.stringify({
            status: "passed",
            id: row.id,
            head: row.head,
            usage: { input_tokens: 5, output_tokens: 2 },
            ...(row.id === "repair-reviewer-retry" ? { summary: deltaSummary } : {}),
          }),
        );
      }
      return { status: "awaiting-publication", retries: 1 };
    },
  };
  const adapter = repositoryQueueAdapter(current.config, current.paths.controller, {
    native: { git: async () => "line\n" } as never,
    repair: repairAdapter,
  });

  await expect(adapter.repair(current.item)).resolves.toEqual({
    status: "accepted",
    head: repaired,
    reviewId: "repair-reviewer-retry",
    stateDirectory: current.paths.repair,
    retries: 1,
  });
  await expect(adapter.repair(current.item)).resolves.toEqual({
    status: "accepted",
    head: repaired,
    reviewId: "repair-reviewer-retry",
    stateDirectory: current.paths.repair,
    retries: 1,
  });
  expect(captured).toMatchObject({
    config: {
      owner: current.source.owner,
      base: candidate,
      stateDirectory: current.paths.repair,
    },
    handoff: {
      mainBase: base,
      correctiveBase: candidate,
      predecessorCompleteSweep: "source-reviewer",
      implementation: { attempts: 2, ceiling: 4 },
    },
  });
  expect((await adapter.history()).map((row) => row.id)).toEqual([
    "source-author",
    "source-reviewer",
    "repair-author",
    "repair-reviewer-retry",
  ]);
});

it("advances once when a malformed repair review retry returns a valid FAIL", async () => {
  const current = await fixture();
  const prompts: [string, string] = [current.source.author.prompt, current.source.reviewer.prompt];
  const fingerprint = sha(JSON.stringify({ config: current.source, prompts }));
  const sourceSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: candidate,
    verdict: "FAIL",
    findings: [
      {
        file: current.source.allowedPaths[0],
        line: 1,
        severity: "blocking",
        text: "repair the source candidate",
      },
    ],
    g0: "Repair is the smallest change.",
  });
  const retrySummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: repaired,
    verdict: "FAIL",
    findings: [
      {
        file: current.source.allowedPaths[0],
        line: 2,
        severity: "blocking",
        text: "repair remains incomplete",
      },
    ],
    g0: "Another candidate is required.",
  });
  const seedSource = async () => {
    const sourceParticipants = [
      {
        ordinal: 1,
        id: "source-author",
        item: current.item.id,
        stage: "source",
        role: "author",
        outcome: "passed",
        usage: queueUsage({ input_tokens: 3 }),
      },
      {
        ordinal: 2,
        id: "source-reviewer",
        item: current.item.id,
        stage: "source",
        role: "reviewer",
        outcome: "failed",
        usage: queueUsage({ output_tokens: 2 }),
      },
    ];
    await Promise.all([
      ...sourceParticipants.map((participant) =>
        writeFile(
          resolve(current.paths.queue, `participant-${participant.ordinal}-terminal.json`),
          JSON.stringify(participant),
        ),
      ),
      writeFile(
        resolve(current.paths.source, "config.json"),
        JSON.stringify({ fingerprint, config: current.source, host: "synthetic" }),
      ),
      writeFile(
        resolve(current.paths.source, "candidate.json"),
        JSON.stringify({ head: candidate, changed: current.source.allowedPaths }),
      ),
      writeFile(
        resolve(current.paths.source, "author-attempt.json"),
        JSON.stringify({
          id: "source-author",
          pid: 1,
          trace: resolve(current.root, "author.jsonl"),
          launchedAt: 1,
        }),
      ),
      writeFile(
        resolve(current.paths.source, "reviewer-attempt.json"),
        JSON.stringify({
          id: "source-reviewer",
          pid: 2,
          trace: resolve(current.root, "reviewer.jsonl"),
          launchedAt: 1,
        }),
      ),
      writeFile(
        resolve(current.paths.source, "reviewer-terminal.json"),
        JSON.stringify({
          status: "failed",
          id: "source-reviewer",
          head: candidate,
          summary: sourceSummary,
        }),
      ),
    ]);
  };
  const repairAdapter: RepairAdapter = {
    async dispatch() {
      const attempts = [
        {
          ordinal: 3,
          stem: "author",
          id: "repair-author",
          role: "author",
          status: "passed",
          head: candidate,
        },
        {
          ordinal: 4,
          stem: "reviewer",
          id: "repair-reviewer-retry",
          role: "reviewer",
          status: "failed",
          head: repaired,
        },
      ] as const;
      await writeFile(
        resolve(current.paths.repair, "candidate.json"),
        JSON.stringify({ head: repaired, changed: current.source.allowedPaths }),
      );
      for (const attempt of attempts) {
        await Promise.all([
          writeFile(
            resolve(current.paths.repair, `${attempt.stem}-attempt.json`),
            JSON.stringify({
              id: attempt.id,
              pid: attempt.ordinal,
              trace: resolve(current.root, `${attempt.id}.jsonl`),
            }),
          ),
          writeFile(
            resolve(current.paths.repair, `${attempt.stem}-terminal.json`),
            JSON.stringify({
              status: attempt.status,
              id: attempt.id,
              head: attempt.head,
              ...(attempt.id === "repair-reviewer-retry" ? { summary: retrySummary } : {}),
            }),
          ),
        ]);
      }
      throw new QueueBlocked("reviewer-failed", undefined, 1);
    },
  };
  const repository = repositoryQueueAdapter(current.config, current.paths.controller, {
    native: { git: async () => "line one\nline two\n" } as never,
    repair: repairAdapter,
  });
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    history: repository.history,
    async setup() {
      return { status: "ready" };
    },
    async source() {
      await seedSource();
      return {
        status: "fixable-review",
        head: candidate,
        reviewId: "source-reviewer",
        findings: JSON.parse(sourceSummary).findings,
      };
    },
    repair: repository.repair,
    async delivery() {
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "advancing-attempt",
    cursor: 2,
  });
  expect(
    JSON.parse(await readFile(resolve(current.paths.queue, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "failed",
    candidateAttempt: 2,
    head: repaired,
    reviewId: "repair-reviewer-retry",
    retries: 1,
  });
});

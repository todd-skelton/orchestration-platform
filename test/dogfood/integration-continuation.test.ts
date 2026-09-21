import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import type { Adapter } from "../../scripts/dogfood/flow.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import type { IntegrationContinuation } from "../../scripts/dogfood/continuation.js";
import {
  queueConfigFromLoop,
  queueStep,
  repositoryQueueAdapter,
  validateLoopConfig,
  type LoopConfig,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { SELF_ROUTING } from "../../scripts/dogfood/routing.mjs";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import {
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  stopCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";
import { snapshot } from "./fixtures/source-failure.js";

const execute = promisify(execFile);
let fixtureGit: Promise<string> | undefined;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

const RUN = "iss-104-integration-run";
const KEY = "ISS-104";
const NUMBER = 361;
const ISSUE = `https://github.com/fixture/repository/issues/${NUMBER}`;
const usage = (ordinal: number) => ({
  inputTokens: { status: "known" as const, value: ordinal },
  outputTokens: { status: "known" as const, value: 1 },
  costUsd: { status: "unavailable" as const },
});
function participant(
  ordinal: number,
  item: string,
  stage: QueueParticipant["stage"],
  role: "author" | "reviewer",
  outcome: QueueParticipant["outcome"],
): QueueParticipant {
  return {
    ordinal,
    // Worker identities are UUID-shaped, as the real observer records them.
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    item,
    stage,
    role,
    outcome,
    usage: usage(ordinal),
    routing: { row: "self" },
    placement: role === "author" ? SELF_ROUTING.author[0]! : SELF_ROUTING.reviewer[0]!,
    rung: 0,
  };
}

type Shape = "conflict" | "clean" | "outside-path" | "unsupported";

// The retained bytes of the run `m1-iss146-147-20260914T2325`, in synthetic form: a
// failed attempt 2 whose reviewed head met a conflict after resolution was consumed.
async function exhaustedFixture(shape: Shape = "conflict", spentRetry = false) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "integration-continuation-")));
  roots.push(root);
  const repository = resolve(root, "repository");
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  const gitExecutable = await (fixtureGit ??= execute(
    process.platform === "win32" ? "where.exe" : "which",
    ["git"],
  ).then((found) => found.stdout.trim().split(/\r?\n/)[0]!));
  const git = async (args: string[], tree = repository) =>
    (await execute(gitExecutable, ["-C", tree, ...args])).stdout.trim();
  await mkdir(resolve(repository, "docs"), { recursive: true });
  await git(["init", "-b", "main"]);
  await appendFile(
    resolve(repository, ".git/config"),
    "[user]\n\tname = Fixture\n\temail = fixture@example.test\n",
  );
  await writeFile(resolve(repository, ".gitignore"), "node_modules/\n");
  await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nKeep it small.\n");
  await writeFile(resolve(repository, "other.txt"), "shared\n");
  await git(["add", "."]);
  await git(["commit", "-m", "base"]);
  const base = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "-b", "reviewed"]);
  if (shape !== "clean")
    await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nReviewed feature.\n");
  if (shape === "outside-path") await writeFile(resolve(repository, "other.txt"), "reviewed\n");
  await writeFile(resolve(repository, "feature.txt"), "reviewed feature\n");
  await git(["add", "."]);
  await git(["commit", "-m", "reviewed feature"]);
  const reviewed = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  if (shape === "unsupported") await git(["rm", "-q", "docs/loop.md"]);
  else await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nIntegration main.\n");
  if (shape === "outside-path") await writeFile(resolve(repository, "other.txt"), "main\n");
  await git(["add", "."]);
  await git(["commit", "-m", "integration main"]);
  const main = await git(["rev-parse", "HEAD"]);
  await git(["branch", "-D", "reviewed"]);
  const remote = resolve(root, "remote.git");
  await execute(gitExecutable, ["clone", "--bare", repository, remote]);
  await git(["remote", "add", "origin", remote]);
  const loop: LoopConfig = {
    schemaVersion: "dogfood-loop/v1",
    run: RUN,
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: repository,
    stateRoot,
    worktreeRoot,
    codexExecutable: process.execPath,
    gitExecutable,
    nativeLaunchCeiling: 12,
    attemptCeiling: 4,
  };
  const runState = resolve(stateRoot, RUN);
  const attemptDirectory = resolve(runState, "iss-104-attempt-2");
  const sourceDirectory = resolve(attemptDirectory, "source");
  const refreshDirectory = resolve(sourceDirectory, `refresh-${main}`);
  await mkdir(refreshDirectory, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  const oldBranch = `codex/run-${createHash("sha256").update(RUN).digest("hex")}/iss-104-attempt-2`;
  const preserved = resolve(worktreeRoot, "iss-104-attempt-2-source");
  await git(["worktree", "add", "-b", oldBranch, preserved, reviewed]);
  const history = [
    participant(1, "ISS-104:1", "source", "author", "passed"),
    participant(2, "ISS-104:1", "source", "reviewer", "passed"),
    participant(3, "ISS-104:1", "refresh", "author", "failed"),
    { ...participant(4, "ISS-104:2", "source", "author", "passed"), rung: 1 },
    participant(5, "ISS-104:2", "source", "reviewer", "passed"),
  ];
  const reviewId = history[4]!.id;
  const attempt = {
    routing: { row: "self" },
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "failed",
    run: RUN,
    index: 0,
    item: "ISS-104:2",
    issue: ISSUE,
    base,
    candidateAttempt: 2,
    head: reviewed,
    reviewId,
    findings: [],
    history,
    retries: spentRetry ? 1 : 0,
    acceptedStage: null,
    stateDirectory: null,
    authorFailures: { count: 1, ids: [history[2]!.id] },
  };
  const put = (directory: string, name: string, value: unknown) =>
    writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  await put(attemptDirectory, "attempt", attempt);
  for (const p of history) await put(attemptDirectory, `participant-${p.ordinal}-terminal`, p);
  // Attempt 1 is the ISS-160 projection whose unresolved seed attempt 2 continued.
  const firstAttempt = resolve(runState, "iss-104-attempt-1");
  await mkdir(firstAttempt, { recursive: true });
  await put(firstAttempt, "attempt", {
    ...attempt,
    item: "ISS-104:1",
    candidateAttempt: 1,
    head: base,
    reviewId: history[1]!.id,
    history: history.slice(0, 3),
    authorFailures: { count: 1, ids: [history[2]!.id] },
  });
  for (const p of history.slice(0, 3))
    await put(firstAttempt, `participant-${p.ordinal}-terminal`, p);
  const sourceConfig = {
    owner: `loop:${RUN}`,
    run: RUN,
    issue: ISSUE,
    pilotRevision: base,
    base,
    mainBase: base,
    inheritedWorkerRetry: false,
    worktree: preserved,
    reviewWorktree: resolve(worktreeRoot, "iss-104-attempt-2-review"),
    stateDirectory: sourceDirectory,
    allowedPaths: ["."],
    repository: "fixture/repository",
    requiredChecks: ["Node 24 / ubuntu-latest"],
    localGates: ["typecheck", "format:check", "test"],
    routing: { row: "self" },
    authorFailures: attempt.authorFailures,
    author: { ...SELF_ROUTING.author[1], ladder: SELF_ROUTING.author, rung: 1, prompt: "old" },
    reviewer: {
      ...SELF_ROUTING.reviewer[0],
      ladder: SELF_ROUTING.reviewer,
      rung: 0,
      prompt: "old",
    },
    adapter: { kind: "codex-exec", executable: process.execPath },
  };
  await put(sourceDirectory, "config", {
    fingerprint: "f".repeat(64),
    config: sourceConfig,
    host: process.platform,
  });
  await put(sourceDirectory, "candidate", {
    head: reviewed,
    changed: shape === "clean" ? ["feature.txt"] : ["docs/loop.md", "feature.txt"],
  });
  await writeFile(resolve(sourceDirectory, "author.jsonl"), "old author trace\n");
  await writeFile(resolve(sourceDirectory, "reviewer.jsonl"), "old reviewer trace\n");
  await put(sourceDirectory, "author-attempt", {
    id: history[3]!.id,
    pid: 1,
    trace: resolve(sourceDirectory, "author.jsonl"),
    launchedAt: 1,
    routing: { row: "self" },
    placement: SELF_ROUTING.author[1],
    rung: 1,
  });
  await put(sourceDirectory, "author-terminal", {
    id: history[3]!.id,
    status: "passed",
    head: base,
  });
  await put(sourceDirectory, "reviewer-attempt", {
    id: reviewId,
    pid: 2,
    trace: resolve(sourceDirectory, "reviewer.jsonl"),
    launchedAt: 2,
    routing: { row: "self" },
    placement: SELF_ROUTING.reviewer[0],
    rung: 0,
  });
  await put(sourceDirectory, "reviewer-terminal", {
    id: reviewId,
    status: "passed",
    head: reviewed,
    summary: JSON.stringify({
      run: RUN,
      role: "reviewer",
      head: reviewed,
      verdict: "PASS",
      findings: [],
      g0: "No simpler shape.",
    }),
  });
  await put(sourceDirectory, "native-refresh", {
    main,
    previousHead: reviewed,
    previousReview: reviewId,
    previousDirectory: sourceDirectory,
    directory: refreshDirectory,
    flowRetried: false,
    retries: spentRetry ? 1 : 0,
    resolutionUsed: true,
  });
  // Supervision: the exhausted item stop is completed, and a later issue landed.
  const first = { cycle: 1, key: KEY, number: NUMBER, base };
  await put(runState, "cycle-1-selected", first);
  await put(runState, "cycle-1-stop-1", {
    selection: first,
    stop: 1,
    reason: "conflict-resolution-failed",
    attempts: 1,
    history: history.slice(0, 3),
    marker: `loop-stop:${RUN}:1:1`,
    body: `<!-- loop-stop:${RUN}:1:1 --> parked`,
  });
  await put(runState, "cycle-1-stop-1-complete", {
    selection: first,
    stop: 1,
    history: history.slice(0, 3),
  });
  const selection = { cycle: 2, key: KEY, number: NUMBER, base: main };
  const marker = `loop-stop:${RUN}:2:1`;
  await put(runState, "cycle-2-selected", selection);
  await put(runState, "cycle-2-stop-1", {
    selection,
    stop: 1,
    reason: "continuation-failed",
    attempts: 2,
    history,
    marker,
    body: `<!-- ${marker} --> The loop stopped on ${KEY} because \`continuation-failed\` after 2 implementation attempts. Diagnostic: "conflict-resolution-exhausted".`,
  });
  await put(runState, "cycle-2-stop-1-complete", { selection, stop: 1, history });
  const later = [
    ...history,
    participant(6, "ISS-105:1", "source", "author", "passed"),
    participant(7, "ISS-105:1", "source", "reviewer", "passed"),
  ];
  const third = { cycle: 3, key: "ISS-105", number: 362, base: main };
  await put(runState, "cycle-3-selected", third);
  await put(runState, "cycle-3-complete", { selection: third, history: later });
  const packet: IntegrationContinuation = {
    schemaVersion: "dogfood-integration-continuation/v1",
    repository: "fixture/repository",
    issueKey: KEY,
    issueUrl: ISSUE,
    run: RUN,
    attemptDirectory,
    absoluteAttempt: 2,
    stopMarker: marker,
    candidateHead: reviewed,
    reviewId,
    authorityUrl: "https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5703720584",
    allowedPaths: ["docs/loop.md"],
  };
  const retained = await snapshot(runState);
  const policy: RepositoryAdapter = {
    selectCandidates: () => [],
    issueContext: async () => ({
      title: "One config",
      body: "Synthetic integration work",
      acceptanceCriteria: ["Preserve both parents."],
      rules: "Keep the loop small.",
      routing: { row: "self" },
    }),
    branchName: ({ key, attempt }) =>
      `codex/${key.toLowerCase()}${attempt === 1 ? "" : `-attempt-${attempt}`}`,
    pullRequest: async () => {
      throw new Error("unused pullRequest");
    },
    requiredChecks: () => ["Node 24 / ubuntu-latest"],
    park: () => "add the `ready` label after acting on the note",
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: () => {},
  };
  const compose = (
    config: LoopConfig = { ...loop, integrationContinuation: packet },
    prior = later,
  ) =>
    queueConfigFromLoop(
      config,
      repository,
      { key: KEY, number: NUMBER, base: main },
      policy,
      prior,
    );
  const unchanged = async () => {
    for (const [path, bytes] of retained) expect(await readFile(path, "utf8")).toBe(bytes);
    // New run-state files belong to the integration directory or later supervision cycles.
    for (const path of (await snapshot(runState)).keys())
      if (!retained.has(path))
        expect(
          path.startsWith(`${resolve(attemptDirectory, "integration")}${sep}`) ||
            /cycle-4-/.test(path.slice(runState.length)),
        ).toBe(true);
    expect(await readdir(refreshDirectory)).toEqual([]);
    expect(await git(["rev-parse", "HEAD"], preserved)).toBe(reviewed);
    expect(await git(["status", "--porcelain"], preserved)).toBe("");
    expect(await git(["branch", "--show-current"], preserved)).toBe(oldBranch);
  };
  const advanceMain = async (file: string, content: string) => {
    const updater = resolve(root, `updater-${randomUUID()}`);
    await execute(gitExecutable, ["clone", remote, updater]);
    await git(["config", "user.name", "Fixture"], updater);
    await git(["config", "user.email", "fixture@example.test"], updater);
    await writeFile(resolve(updater, file), content);
    await git(["add", "."], updater);
    await git(["commit", "-m", "advance main"], updater);
    await git(["push", "origin", "main"], updater);
    return git(["rev-parse", "HEAD"], updater);
  };
  return {
    root,
    repository,
    gitExecutable,
    git,
    loop,
    packet,
    runState,
    attemptDirectory,
    sourceDirectory,
    base,
    reviewed,
    main,
    history,
    later,
    reviewId,
    marker,
    policy,
    compose,
    unchanged,
    advanceMain,
    put,
  };
}

it("composes one integration item from the retained reviewed attempt and claims it once", async () => {
  const f = await exhaustedFixture();
  const q = await f.compose();
  const item = q.items[0]!;
  expect(item).toMatchObject({
    id: "ISS-104:2",
    base: f.reviewed,
    implementationAttempt: 2,
    implementationAttemptCeiling: 4,
    integrationContinuation: {
      reviewId: f.reviewId,
      sourceDirectory: f.sourceDirectory,
      main: f.main,
    },
    source: {
      base: f.reviewed,
      mainBase: f.base,
      inheritedWorkerRetry: false,
      correctionPaths: ["docs/loop.md"],
      authorFailures: { count: 1 },
      author: { ...SELF_ROUTING.author[1], rung: 1 },
    },
    setup: {
      base: f.reviewed,
      sourceBranch: expect.stringMatching(/iss-104-attempt-2-integration$/),
    },
    delivery: { policy: { sourceBranch: "codex/iss-104-attempt-2" } },
  });
  expect(item.setup.sourceBranch).not.toContain("attempt-2-integration-");
  expect(q.stateDirectory).toBe(resolve(f.attemptDirectory, "integration"));
  expect(item.source.stateDirectory).toBe(resolve(f.attemptDirectory, "integration", "source"));
  expect(item.setup.sourceWorktree).toBe(
    resolve(f.loop.worktreeRoot, "iss-104-attempt-2-integration-source"),
  );
  expect(q.initialHistory).toEqual(f.later);
  for (const value of [
    f.reviewed,
    f.reviewId,
    f.main,
    f.packet.authorityUrl,
    f.marker,
    '["docs/loop.md"]',
  ])
    expect(item.integrationContinuation!.context).toContain(value);
  expect(item.source.author.prompt).toContain(item.integrationContinuation!.context);
  const claimName = `integration-continuation-${createHash("sha256")
    .update(JSON.stringify({ repository: "fixture/repository", issue: KEY }))
    .digest("hex")}.json`;
  const claim = await readFile(resolve(f.loop.stateRoot, claimName), "utf8");
  expect(JSON.parse(claim)).toEqual(f.packet);
  // Replay resumes the same integration; the retained attempt alone also seeds history.
  expect(await f.compose()).toEqual(q);
  expect((await f.compose(undefined, [])).initialHistory).toEqual(f.history);
  expect(await readFile(resolve(f.loop.stateRoot, claimName), "utf8")).toBe(claim);
  await f.unchanged();
  // A changed packet, a foreign run or another packet after this one cannot spend again.
  await expect(
    f.compose({
      ...f.loop,
      integrationContinuation: { ...f.packet, authorityUrl: `${f.packet.authorityUrl}1` },
    }),
  ).rejects.toThrow("integration-continuation-already-consumed");
  // N+1: a later exhausted-looking stop in the same lineage names a new marker.
  const again = { cycle: 4, key: KEY, number: NUMBER, base: f.main };
  const stop = JSON.parse(await readFile(resolve(f.runState, "cycle-2-stop-1.json"), "utf8"));
  await f.put(f.runState, "cycle-4-selected", again);
  await f.put(f.runState, "cycle-4-stop-1", {
    ...stop,
    selection: again,
    marker: `loop-stop:${RUN}:4:1`,
    body: stop.body.replaceAll(`loop-stop:${RUN}:2:1`, `loop-stop:${RUN}:4:1`),
  });
  await f.put(f.runState, "cycle-4-stop-1-complete", {
    selection: again,
    stop: 1,
    history: f.later,
  });
  await expect(
    f.compose({
      ...f.loop,
      integrationContinuation: { ...f.packet, stopMarker: `loop-stop:${RUN}:4:1` },
    }),
  ).rejects.toThrow("integration-continuation-already-consumed");
  await expect(f.compose({ ...f.loop, run: "fresh-run" })).rejects.toThrow(
    "integration-continuation-required",
  );
  expect(() =>
    validateLoopConfig({ ...f.loop, run: "fresh-run", integrationContinuation: f.packet }),
  ).toThrow("invalid-integration-continuation");
  // Removing the packet does not reopen attempt 3 for the claimed lineage.
  await expect(f.compose(f.loop)).rejects.toThrow("integration-continuation-required");
  await f.unchanged();
});

it("refuses the packet before any claim when the retained records do not match it", async () => {
  const f = await exhaustedFixture();
  const claimed = async () =>
    (await readdir(f.loop.stateRoot)).some((name) => name.startsWith("integration-continuation-"));
  const refuse = async (packet: Partial<IntegrationContinuation>, reason: string) => {
    await expect(
      f.compose({ ...f.loop, integrationContinuation: { ...f.packet, ...packet } }),
    ).rejects.toThrow(reason);
    expect(await claimed()).toBe(false);
    await f.unchanged();
  };
  await refuse({ candidateHead: f.main }, "integration-continuation-history-unavailable");
  await refuse({ reviewId: "another-review" }, "integration-continuation-history-unavailable");
  await refuse({ absoluteAttempt: 3 }, "integration-continuation-history-unavailable");
  await refuse({ stopMarker: `loop-stop:${RUN}:1:1` }, "integration-continuation-stop-mismatch");
  await refuse({ stopMarker: `loop-stop:${RUN}:2:2` }, "integration-continuation-stop-mismatch");
  await refuse({ issueUrl: `${ISSUE}0` }, "integration-continuation-issue-mismatch");
  for (const invalid of [
    { attemptDirectory: resolve(f.runState, "iss-104-attempt-9") },
    { attemptDirectory: resolve(f.loop.stateRoot, "other-run", "iss-104-attempt-2") },
    { run: "other-run" },
    { stopMarker: "loop-stop:other-run:2:1" },
    { allowedPaths: [] },
    { allowedPaths: ["../docs/loop.md"] },
    { authorityUrl: "https://example.test/ruling" },
    { extra: true } as object,
  ])
    expect(() =>
      validateLoopConfig({ ...f.loop, integrationContinuation: { ...f.packet, ...invalid } }),
    ).toThrow("invalid-integration-continuation");
  expect(() =>
    validateLoopConfig({
      ...f.loop,
      integrationContinuation: f.packet,
      prerequisite: {
        blockedCycle: 1,
        blockedKey: "ISS-1",
        blockedNumber: 1,
        stop: 1,
        key: "ISS-2",
        number: 2,
        authorityUrl: f.packet.authorityUrl,
      },
    }),
  ).toThrow("invalid-prerequisite");
  // Without the packet the same run refuses attempt 3 and a fresh run refuses attempt 1.
  await expect(f.compose(f.loop)).rejects.toThrow("integration-continuation-required");
  await expect(f.compose({ ...f.loop, run: "fresh-run" })).rejects.toThrow(
    "integration-continuation-required",
  );
  // Unrelated work in the same run composes as usual with the packet present.
  const other = await queueConfigFromLoop(
    { ...f.loop, integrationContinuation: f.packet },
    f.repository,
    { key: "ISS-106", number: 363, base: f.main },
    f.policy,
    f.later,
  );
  expect(other.items[0]).toMatchObject({ id: "ISS-106:1", implementationAttempt: 1 });
  expect(other.items[0]!.integrationContinuation).toBeUndefined();
  expect(await claimed()).toBe(false);
  // Non-PASS, published or pending sources are not reviewed-exhausted evidence.
  const terminal = resolve(f.sourceDirectory, "reviewer-terminal.json");
  const passed = await readFile(terminal, "utf8");
  await writeFile(terminal, JSON.stringify({ ...JSON.parse(passed), status: "failed" }));
  await expect(f.compose()).rejects.toThrow("integration-continuation-history-unavailable");
  await writeFile(terminal, passed);
  for (const name of ["publication", "publication-intent"]) {
    const path = resolve(f.sourceDirectory, `${name}.json`);
    await writeFile(path, JSON.stringify({ head: f.reviewed }));
    await expect(f.compose()).rejects.toThrow("integration-continuation-history-unavailable");
    await rm(path);
  }
  await rm(resolve(f.runState, "cycle-2-stop-1-complete.json"));
  await expect(f.compose()).rejects.toThrow("integration-continuation-stop-mismatch");
  expect(await claimed()).toBe(false);
});

it("re-enters the parked issue only through explicit unpark, skipping completed stops", async () => {
  const f = await exhaustedFixture();
  const loop = { ...f.loop, integrationContinuation: f.packet };
  let ready = false;
  const notes: string[] = [];
  const host: SupervisionAdapter = {
    currentMain: async () => f.main,
    issue: async () => ({
      state: "OPEN",
      key: KEY,
      labels: ready ? ["ready"] : [],
      comments: notes,
    }),
    removeReady: async () => {},
    close: async () => {
      throw new Error("must not close");
    },
    comment: async (_config, _number, body) => {
      notes.push(body);
    },
  };
  const policy = {
    ...f.policy,
    selectCandidates: () => (ready ? [{ key: KEY, number: NUMBER }] : []),
  };
  expect(await nextCycle(loop, f.repository, host, policy)).toBeUndefined();
  ready = true;
  const cycle = await nextCycle(loop, f.repository, host, policy);
  expect(cycle).toEqual({
    selection: { cycle: 4, key: KEY, number: NUMBER, base: f.main, planningRevision: f.main },
    initialHistory: f.later,
  });
  await persistCycle(loop, cycle!);
  expect(await reconcilePendingStop(loop, cycle!, host, policy)).toBeUndefined();
  const q = await queueConfigFromLoop(
    loop,
    f.repository,
    { key: KEY, number: NUMBER, base: f.main, planningRevision: f.main },
    policy,
    cycle!.initialHistory,
  );
  expect(q.items[0]!.integrationContinuation).toBeDefined();
  // A work stop on the integration parks the item and later resume skips its cycle.
  expect(await stopCycle(loop, cycle!, "continuation-failed", 2, host, policy)).toBe("item");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain(`loop-stop:${RUN}:4:1`);
  ready = false;
  expect(await nextCycle(loop, f.repository, host, policy)).toBeUndefined();
  await f.unchanged();
});

it("carries the integration's launches into an externally closed cycle completion", async () => {
  const f = await exhaustedFixture();
  const loop = { ...f.loop, integrationContinuation: f.packet };
  const q = await f.compose();
  const launched = [
    ...f.later,
    participant(8, "ISS-104:2", "refresh", "author", "passed"),
    participant(9, "ISS-104:2", "refresh", "reviewer", "passed"),
  ];
  for (const p of launched) await f.put(q.stateDirectory, `participant-${p.ordinal}-terminal`, p);
  const selection = { cycle: 4, key: KEY, number: NUMBER, base: f.main };
  await f.put(f.runState, "cycle-4-selected", selection);
  const host: SupervisionAdapter = {
    currentMain: async () => f.main,
    issue: async () => ({ state: "CLOSED", key: KEY, labels: [], comments: [] }),
    removeReady: async () => {},
    close: async () => {},
    comment: async () => {},
  };
  expect(await nextCycle(loop, f.repository, host, f.policy)).toBeUndefined();
  expect(JSON.parse(await readFile(resolve(f.runState, "cycle-4-complete.json"), "utf8"))).toEqual({
    selection,
    history: launched,
  });
  await f.unchanged();
});

type Mode =
  | "pass"
  | "clean"
  | "dead-retry"
  | "spent-retry"
  | "author-fail"
  | "review-fail"
  | "escape"
  | "outside-path"
  | "unsupported"
  | "moved-main"
  | "second-conflict"
  | "gate-fail"
  | "hosted-fail"
  | "no-change"
  | "lost-commit";

it.each<Mode>([
  "pass",
  "clean",
  "dead-retry",
  "spent-retry",
  "author-fail",
  "review-fail",
  "escape",
  "outside-path",
  "unsupported",
  "moved-main",
  "second-conflict",
  "gate-fail",
  "hosted-fail",
  "no-change",
  "lost-commit",
])("runs the exhausted reviewed integration through native delivery: %s", async (mode) => {
  const shape: Shape =
    mode === "clean"
      ? "clean"
      : mode === "outside-path" || mode === "unsupported"
        ? mode
        : "conflict";
  const f = await exhaustedFixture(shape, mode === "spent-retry");
  const q = await f.compose();
  expect(await f.compose()).toEqual(q);
  const item = q.items[0]!;
  const launches: string[] = [];
  const effects: string[] = [];
  let observing = true;
  let died = false;
  let lost = false;
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      const result = await f.git(args, tree);
      // The candidate commit's response is lost once; the seed commit is not.
      if (
        mode === "lost-commit" &&
        args[0] === "commit" &&
        args[2] === `dogfood: ${RUN}` &&
        !lost
      ) {
        lost = true;
        throw new Error("lost commit response");
      }
      return result;
    },
    async launch(role, config, prompt) {
      launches.push(role);
      expect(config.stateDirectory.startsWith(item.source.stateDirectory)).toBe(true);
      expect(config.worktree).toBe(item.source.worktree);
      expect(config.pilotRevision).toBe(item.source.pilotRevision);
      expect(prompt).toContain(f.packet.authorityUrl);
      expect(prompt).toContain(f.sourceDirectory);
      if (role === "author") {
        // A dead launch advances the ISS-158 ladder like any unsuccessful author launch.
        const rung = launches.filter((launch) => launch === "author").length === 2 ? 2 : 1;
        expect(config.author).toMatchObject({ ...SELF_ROUTING.author[rung], rung });
        expect(prompt).toContain('Allowed author paths: ["docs/loop.md"]');
        expect(prompt).toContain("Resolve only Git's marked conflicting hunks");
        if (mode !== "no-change")
          await writeFile(
            resolve(config.worktree, "docs/loop.md"),
            "# The loop\n\nReviewed feature and integration main.\n",
          );
        if (mode === "escape")
          await writeFile(resolve(config.worktree, "feature.txt"), "escaped\n");
      } else {
        expect(prompt.toLowerCase()).toContain("independent delta");
        expect(prompt).toContain(f.reviewed);
        expect(prompt).toContain("Selected author attempt ");
      }
      const trace = resolve(config.stateDirectory, `${role}-${randomUUID()}.jsonl`);
      await writeFile(trace, "synthetic worker execution\n");
      return { id: randomUUID(), pid: launches.length, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (observing) return { status: "running", id: attempt.id };
      if (role === "author") {
        if ((mode === "dead-retry" || mode === "spent-retry") && !died) {
          died = true;
          return { status: "dead", id: attempt.id, summary: "process vanished" };
        }
        return {
          status: mode === "author-fail" ? "failed" : "passed",
          id: attempt.id,
          head: config.base,
          summary: mode === "author-fail" ? "needs broader changes" : "",
        };
      }
      const head = await f.git(["rev-parse", "HEAD"], config.worktree);
      const fail = mode === "review-fail";
      return {
        status: fail ? "failed" : "passed",
        id: attempt.id,
        head,
        summary: JSON.stringify({
          run: config.run,
          role,
          head,
          verdict: fail ? "FAIL" : "PASS",
          findings: fail
            ? [{ file: "docs/loop.md", line: 1, severity: "blocking", text: "Lost main behavior." }]
            : [],
          g0: "Preserve both parents.",
        }),
      };
    },
    async checks() {
      throw new Error("no source publication");
    },
  };
  const delivery = githubDeliveryAdapter();
  delivery.verifyWorkspace = async (config, head) =>
    (await f.git(["rev-parse", "HEAD"], config.worktree)) === head &&
    (await f.git(["status", "--porcelain"], config.worktree)) === "";
  delivery.runGate = async (config, name, head) => {
    effects.push(`gate:${name}:${head}`);
    if (mode === "gate-fail" && name === "test")
      return {
        status: "failed",
        output: "attributed assertion",
        evidence: {
          head,
          log: resolve(config.stateDirectory, "candidate.log"),
          cause: "diagnostic",
          diagnostics: ["docs/loop.md:1: failed assertion"],
          command: { executable: process.execPath, argv: ["fixture"], cwd: config.worktree },
        },
      };
    return "passed";
  };
  delivery.attributeGate = async (config, _name, _evidence, main) => ({
    cause: "candidate",
    main,
    log: resolve(config.stateDirectory, "base-control.log"),
  });
  let draft = false;
  let published = false;
  let merged = false;
  let cleaned = false;
  let publishedHead = "";
  delivery.observeDraft = async () =>
    draft ? { state: "confirmed", value: { issue: NUMBER } } : { state: "needs-mutation" };
  delivery.applyDraft = async () => {
    draft = true;
    effects.push("draft");
  };
  delivery.observePublication = async (config, plan, planDigest) =>
    published
      ? {
          state: "confirmed",
          value: {
            number: 400,
            url: "https://github.com/fixture/repository/pull/400",
            head: publishedHead,
            repository: config.repository,
            sourceBranch: plan.sourceBranch,
            baseBranch: plan.baseBranch,
            title: plan.title,
            body: plan.body,
            planDigest,
          },
        }
      : { state: "needs-mutation", target: "absent" };
  delivery.publish = async (config) => {
    published = true;
    publishedHead = config.candidateHead;
    effects.push("publish");
    throw new Error("lost publish response");
  };
  delivery.checks = async (config) => ({
    head: publishedHead,
    checks: config.requiredChecks.map((name) => ({
      name,
      bucket: mode === "hosted-fail" ? "fail" : "pass",
      link: `https://example.test/check/${encodeURIComponent(name)}`,
    })),
  });
  delivery.failedCheckLog = async () => "synthetic failed job log\n";
  delivery.observeMerge = async () =>
    merged
      ? {
          state: "confirmed",
          value: { number: 400, head: publishedHead, mergeCommit: "e".repeat(40) },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    merged = true;
    effects.push("merge");
    throw new Error("lost merge response");
  };
  delivery.observeCleanup = async (_config, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    cleaned = true;
    effects.push("cleanup");
  };
  const adapter = () => {
    const bounded = repositoryQueueAdapter(q, f.repository, {
      native,
      setup,
      delivery,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
      repository: {
        ...f.policy,
        async afterMerge() {
          effects.push("deployment");
        },
      },
      deliveryPolicy: {
        async plan(config) {
          return {
            gates: { beforeMirror: ["typecheck", "format:check", "test"], afterMirror: [] },
            drafts: [
              { key: KEY, issue: NUMBER, title: "fixture", body: "fixture", attributes: {} },
            ],
            publication: {
              sourceBranch: "codex/iss-104-attempt-2",
              baseBranch: "main",
              title: "fixture",
              body: "fixture",
              draft: true,
            },
            mergePolicy: {},
            cleanup: {
              worktrees: [config.worktree, config.reviewWorktree],
              branch: config.localBranch!,
            },
          };
        },
      },
    });
    return {
      ...bounded,
      async source() {
        throw new Error("source author forbidden");
      },
      async repair() {
        throw new Error("repair forbidden");
      },
    };
  };
  const run = () => queueStep(q, adapter());
  const integrationAttempt = () =>
    readFile(resolve(q.stateDirectory, "attempt.json"), "utf8").then(JSON.parse);
  const refresh = () =>
    readFile(resolve(item.source.stateDirectory, "native-refresh.json"), "utf8").then(JSON.parse);
  const zeroLaunch = mode === "outside-path" || mode === "unsupported";
  if (zeroLaunch) {
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).rejects.toThrow("continuation-failed");
    expect(launches).toEqual([]);
    const saved = await refresh();
    expect(saved.resolutionUsed).toBe(true);
    if (mode === "outside-path") {
      expect(Object.keys(saved.conflict.files).sort()).toEqual(["docs/loop.md", "other.txt"]);
      expect(saved.conflict.seed).toBeUndefined();
    }
    expect(await integrationAttempt()).toMatchObject({
      phase: "failed",
      head: f.reviewed,
      reviewId: f.reviewId,
      history: f.later,
    });
    await f.unchanged();
    return;
  }
  // Setup, then the first worker launch, then a running observation on replay.
  for (let replay = 0; replay < 2; replay++)
    await expect(run()).resolves.toMatchObject({
      status: mode === "clean" ? "observing-reviewer" : "observing-author",
    });
  expect(launches).toEqual([mode === "clean" ? "reviewer" : "author"]);
  expect(await integrationAttempt()).toMatchObject({
    phase: "delivery",
    reviewId: f.reviewId,
    acceptedStage: "source",
    stateDirectory: item.source.stateDirectory,
    candidateAttempt: 2,
    authorFailures: { count: 1 },
  });
  const saved = await refresh();
  expect(saved).toMatchObject({
    main: f.main,
    previousHead: f.reviewed,
    previousReview: f.reviewId,
  });
  expect(saved.resolutionUsed).toBe(mode !== "clean");
  if (mode !== "clean") {
    // Captured before any worker: the current main and every unmerged file with its hunks.
    expect(Object.keys(saved.conflict.files)).toEqual(["docs/loop.md"]);
    expect(saved.conflict.files["docs/loop.md"]).toContain("<<<<<<<");
    expect(
      await f.git(["rev-list", "--parents", "-n", "1", saved.conflict.seed], item.source.worktree),
    ).toBe(`${saved.conflict.seed} ${f.reviewed} ${f.main}`);
  }
  expect(await f.git(["rev-parse", "HEAD"], f.repository)).toBe(f.main);
  observing = false;
  const workFailure: Record<string, string | undefined> = {
    "spent-retry": "continuation-failed",
    "author-fail": "continuation-failed",
    "review-fail": "continuation-failed",
    escape: "continuation-failed",
    "no-change": "continuation-failed",
    "second-conflict": "continuation-failed",
    "gate-fail": "continuation-failed",
    "hosted-fail": "continuation-failed",
  };
  // Main moving after the resolution review is an observation stop; the next replay
  // refreshes onto that main, and a second conflict is exhausted without renewal.
  if (mode === "second-conflict" || mode === "moved-main") {
    await f.advanceMain(
      mode === "second-conflict" ? "docs/loop.md" : "main.txt",
      "# The loop\n\nMain moved again.\n",
    );
    await expect(run()).rejects.toThrow("current-main-moved");
    expect(launches).toEqual(["author", "reviewer"]);
  }
  if (mode === "lost-commit") {
    await expect(run()).rejects.toThrow("lost commit response");
    expect(launches).toEqual(["author"]);
  }
  if (workFailure[mode]) {
    if (mode === "hosted-fail") {
      // Publication reconciles its lost response, then the red check parks the item.
      let parked = false;
      for (let poll = 0; poll < 6 && !parked; poll++) {
        try {
          await run();
        } catch (error) {
          parked = String(error).includes("continuation-failed");
          if (!parked) expect(String(error)).toMatch(/publication-outcome-unknown/);
        }
      }
      expect(parked).toBe(true);
    }
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).rejects.toThrow(workFailure[mode]);
    expect(launches).toEqual(
      mode === "spent-retry"
        ? ["author"]
        : ["author-fail", "no-change", "escape"].includes(mode)
          ? ["author"]
          : ["author", "reviewer"],
    );
    expect(effects.filter((e) => ["publish", "merge", "deployment"].includes(e))).toEqual(
      mode === "hosted-fail" ? ["publish"] : [],
    );
    const failed = await integrationAttempt();
    expect(failed).toMatchObject({ phase: "failed", candidateAttempt: 2, acceptedStage: null });
    expect(failed.history.length).toBe(f.later.length + launches.length);
    expect(failed.history.slice(0, f.later.length)).toEqual(f.later);
    expect(
      failed.history
        .slice(f.later.length)
        .every((p: QueueParticipant) => p.stage === "refresh" && p.item === "ISS-104:2"),
    ).toBe(true);
    if (mode === "second-conflict") {
      const twice = await refresh();
      expect(twice.main).not.toBe(f.main);
      expect(twice.previousHead).not.toBe(f.reviewed);
      expect(twice.resolutionUsed).toBe(true);
      expect(twice.head).toBeUndefined();
      expect(twice.conflict).toBeUndefined();
    }
    if (mode === "gate-fail") {
      const stop = JSON.parse(
        await readFile(resolve(item.source.stateDirectory, "gate-stop.json"), "utf8"),
      );
      expect(stop.reason).toBe("gate-correction-not-authorized");
    }
    // The parked integration cannot be replayed into another author or attempt.
    expect(await f.compose()).toEqual(q);
    await expect(f.compose(f.loop)).rejects.toThrow("integration-continuation-required");
    await f.unchanged();
    return;
  }
  let completed = false;
  for (let poll = 0; poll < 8 && !completed; poll++) {
    try {
      completed = (await run()).status === "complete";
    } catch (error) {
      expect(String(error)).toMatch(/publication-outcome-unknown|merge-outcome-unknown/);
    }
  }
  expect(completed).toBe(true);
  const after = [...effects];
  for (let replay = 0; replay < 2; replay++)
    await expect(run()).resolves.toMatchObject({ status: "complete" });
  expect(effects).toEqual(after);
  expect(effects.filter((e) => ["publish", "merge", "deployment"].includes(e))).toEqual([
    "publish",
    "merge",
    "deployment",
  ]);
  expect(
    effects
      .filter((e) => e.startsWith("gate:") && e.endsWith(publishedHead))
      .map((e) => e.split(":").slice(1, -1).join(":")),
  ).toEqual(["typecheck", "format:check", "test"]);
  expect(launches).toEqual(
    mode === "clean"
      ? ["reviewer"]
      : mode === "dead-retry"
        ? ["author", "author", "reviewer"]
        : mode === "moved-main"
          ? ["author", "reviewer", "reviewer"]
          : ["author", "reviewer"],
  );
  const complete = await integrationAttempt();
  expect(complete).toMatchObject({ phase: "complete", head: publishedHead });
  expect(complete.history.slice(0, f.later.length)).toEqual(f.later);
  expect(complete.history.length).toBe(f.later.length + launches.length);
  expect(complete.reviewId).not.toBe(f.reviewId);
  expect(
    await f.git(["merge-base", "--is-ancestor", f.reviewed, publishedHead], f.repository),
  ).toBe("");
  expect(await f.git(["merge-base", "--is-ancestor", f.main, publishedHead], f.repository)).toBe(
    "",
  );
  if (mode !== "clean")
    expect(await f.git(["show", `${publishedHead}:docs/loop.md`], f.repository)).toBe(
      "# The loop\n\nReviewed feature and integration main.",
    );
  expect(await f.compose()).toEqual(q);
  await f.unchanged();
});

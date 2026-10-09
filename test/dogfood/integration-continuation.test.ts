import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { unparkInstructions } from "../../adapters/self.mjs";
import type { Adapter } from "../../scripts/dogfood/flow.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import { DeliveryBlocked, type PublicationEvidence } from "../../scripts/dogfood/delivery.mjs";
import { executedHostedFixture } from "./fixtures/continuation.js";
import type {
  IntegrationContinuation,
  TerminalAttemptAdmission,
} from "../../scripts/dogfood/continuation.js";
import {
  ISS214_REFRESH_REVIEW_ALLOWANCE,
  admitExecutedHostedStop,
  admitPublishedConflict,
  failedDeliveryDiagnostic,
  QueueBlocked,
  evaluateTerminalAttempt,
  retainedRunHistory,
  queueConfigFromLoop,
  queueDigest,
  queueStep,
  repositoryQueueAdapter,
  validateLoopConfig,
  type LoopConfig,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { SELF_ROUTING } from "../../scripts/dogfood/routing.mjs";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import type { SetupAdapter } from "../../scripts/dogfood/setup.js";
import {
  completeCycle,
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
  vi.restoreAllMocks();
  syncBuiltinESMExports();
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

type Shape = "conflict" | "clean" | "outside-path" | "unsupported" | "overlap";

// The retained bytes of the run `m1-iss146-147-20260914T2325`, in synthetic form: a
// failed attempt 2 whose reviewed head met a conflict after resolution was consumed.
// `autocrlf` reproduces a Windows-style checkout, where the marker file the author
// resolves carries CRLF line endings outside the hunks.
async function exhaustedFixture(shape: Shape = "conflict", spentRetry = false, autocrlf = false) {
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
    "[user]\n\tname = Fixture\n\temail = fixture@example.test\n" +
      (autocrlf ? "[core]\n\tautocrlf = true\n" : ""),
  );
  await writeFile(resolve(repository, ".gitignore"), "node_modules/\n");
  await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nKeep it small.\n");
  await writeFile(resolve(repository, "other.txt"), "shared\n");
  const overlap = "first\n" + "stable\n".repeat(10) + "last\n";
  if (shape === "overlap") await writeFile(resolve(repository, "overlap.txt"), overlap);
  await git(["add", "."]);
  await git(["commit", "-m", "base"]);
  const base = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "-b", "reviewed"]);
  if (shape !== "clean")
    await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nReviewed feature.\n");
  if (shape === "outside-path") await writeFile(resolve(repository, "other.txt"), "reviewed\n");
  if (shape === "overlap")
    await writeFile(resolve(repository, "overlap.txt"), overlap.replace("first", "reviewed"));
  await writeFile(resolve(repository, "feature.txt"), "reviewed feature\n");
  await git(["add", "."]);
  await git(["commit", "-m", "reviewed feature"]);
  const reviewed = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  if (shape === "unsupported") await git(["rm", "-q", "docs/loop.md"]);
  else await writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nIntegration main.\n");
  if (shape === "outside-path") await writeFile(resolve(repository, "other.txt"), "main\n");
  if (shape === "overlap")
    await writeFile(resolve(repository, "overlap.txt"), overlap.replace("last", "main"));
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
    authorityUrl: "https://github.com/fixture/authority/issues/1#issuecomment-1",
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
    park: () => unparkInstructions,
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
            Number(/cycle-(\d+)-/.exec(path.slice(runState.length))?.[1]) >= 4,
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

// All ISS-215 IDs, repositories, comments, timestamps and bodies below are synthetic.
// No real external-authority observation is replaced or reinterpreted by this fixture.
// The persisted shape follows the run: a failed ISS-167 integration whose consumed ISS-200
// spent resolution failed again after publication, then the completed cycle-11 stop.
async function conflictSuccessorFixture(prior: 2 | 3 = 3, prefix: QueueParticipant[] = []) {
  const f = await exhaustedFixture();
  // Disposable synthetic records only; real Git supplies both parents, seed,
  // implemented successor and its separately refreshed reviewed head.
  await rm(f.runState, { recursive: true });
  await mkdir(f.runState);
  await f.git(["checkout", "-b", "synthetic-seed", f.reviewed]);
  await expect(f.git(["merge", "--no-commit", "main"])).rejects.toThrow();
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic conflict seed"]);
  const seed = await f.git(["rev-parse", "HEAD"]);
  await writeFile(resolve(f.repository, "docs/loop.md"), "# Synthetic resolved successor\n");
  await f.git(["commit", "-am", "synthetic successor"]);
  const authoredHead = await f.git(["rev-parse", "HEAD"]);
  await f.git(["checkout", "main"]);
  await writeFile(resolve(f.repository, "later-main.txt"), "Synthetic main movement\n");
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic later main"]);
  const base = await f.git(["rev-parse", "HEAD"]);
  await f.git(["checkout", "synthetic-seed"]);
  await f.git(["merge", "main", "-m", "synthetic refreshed successor"]);
  const terminalHead = await f.git(["rev-parse", "HEAD"]);
  await f.git(["checkout", "main"]);
  await f.git(["push", "origin", "main"]);
  const history: QueueParticipant[] = [...prefix];
  const directory = (n: number) => resolve(f.runState, `${KEY.toLowerCase()}-attempt-${n}`);
  const put = async (path: string, name: string, value: unknown) => {
    await mkdir(path, { recursive: true });
    await f.put(path, name, value);
  };
  let conflictId = "";
  for (let n = 1; n <= prior; n++) {
    const author = participant(history.length + 1, `${KEY}:${n}`, "source", "author", "passed");
    const reviewer = participant(history.length + 2, `${KEY}:${n}`, "source", "reviewer", "passed");
    history.push(author, reviewer);
    const source = resolve(directory(n), "source");
    const refresh = resolve(source, `refresh-${base}`);
    if (n === prior - 1) {
      const failed = participant(history.length + 1, `${KEY}:${n}`, "refresh", "author", "failed");
      conflictId = failed.id;
      history.push(failed);
      await put(source, "native-refresh", {
        main: f.main,
        directory: refresh,
        resolutionUsed: true,
        conflict: { seed },
        retries: 0,
      });
      await put(source, "gate-correction", { failedHead: f.reviewed });
      await put(refresh, "author-attempt", {
        id: failed.id,
        retries: 1,
        trace: resolve(refresh, "author.jsonl"),
      });
      await put(refresh, "author-terminal", { id: failed.id, head: seed, status: "failed" });
    }
    if (n === prior) {
      const delta = participant(history.length + 1, `${KEY}:${n}`, "refresh", "reviewer", "passed");
      history.push(delta);
      await put(source, "config", { config: { base: seed, mainBase: f.main } });
      await put(source, "author-attempt", {
        id: author.id,
        trace: resolve(source, "author.jsonl"),
      });
      await put(source, "author-terminal", { id: author.id, status: "passed", head: seed });
      await put(source, "candidate", { head: authoredHead, changed: ["docs/loop.md"] });
      await put(source, "reviewer-attempt", {
        id: reviewer.id,
        trace: resolve(source, "reviewer.jsonl"),
      });
      await put(source, "reviewer-terminal", {
        id: reviewer.id,
        status: "passed",
        head: authoredHead,
      });
      await put(source, "native-refresh", {
        main: base,
        head: terminalHead,
        directory: refresh,
        resolutionUsed: true,
      });
      await put(refresh, "reviewer-attempt", {
        id: delta.id,
        trace: resolve(refresh, "reviewer.jsonl"),
      });
      await put(refresh, "reviewer-terminal", {
        id: delta.id,
        status: "passed",
        head: terminalHead,
      });
    }
    await put(directory(n), "attempt", {
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      run: RUN,
      issue: ISSUE,
      item: `${KEY}:${n}`,
      index: 0,
      phase: "failed",
      base: n === prior ? seed : f.base,
      candidateAttempt: n,
      head: n === prior ? terminalHead : n === prior - 1 ? seed : f.reviewed,
      reviewId: reviewer.id,
      findings: [],
      history: [...history],
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
      authorFailures: { count: 1, ids: [conflictId || author.id] },
    });
    for (const p of history) await put(directory(n), `participant-${p.ordinal}-terminal`, p);
  }
  const terminalHistory = [...history];
  const terminalSelection = {
    cycle: 1,
    key: KEY,
    number: NUMBER,
    base: f.main,
    planningRevision: f.main,
  };
  const terminalMarker = `loop-stop:${RUN}:1:1`;
  const terminalBody = `<!-- ${terminalMarker} --> Synthetic controller admission gap after reviewed conflict successor.`;
  await put(f.runState, "cycle-1-selected", terminalSelection);
  await put(f.runState, "cycle-1-stop-1", {
    selection: terminalSelection,
    stop: 1,
    reason: "continuation-failed",
    attempts: prior,
    marker: terminalMarker,
    body: terminalBody,
    history: terminalHistory,
  });
  await put(f.runState, "cycle-1-stop-1-complete", {
    selection: terminalSelection,
    stop: 1,
    history: terminalHistory,
  });
  await put(f.runState, "cycle-1-complete", {
    selection: terminalSelection,
    history: terminalHistory,
  });
  history.push(participant(history.length + 1, "SYNTHETIC-OTHER:1", "source", "author", "passed"));
  const unrelated = { cycle: 2, key: "SYNTHETIC-OTHER", number: 999, base };
  await put(f.runState, "cycle-2-selected", unrelated);
  await put(f.runState, "cycle-2-complete", { selection: unrelated, history });
  const authorityBody =
    "SYNTHETIC host ruling: controller/admission gap, not a work rejection; authorize one next unused attempt from current main.";
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const packet: Extract<TerminalAttemptAdmission, { terminalKind: string }> = {
    schemaVersion: "dogfood-terminal-attempt-admission/v2",
    terminalKind: "conflict-successor",
    terminalHead,
    repository: f.loop.repository,
    issueKey: KEY,
    issueUrl: ISSUE,
    run: RUN,
    priorAbsoluteAttempt: prior,
    nextAbsoluteAttempt: prior === 2 ? 3 : 4,
    terminalMarker,
    terminalReceiptUrl: `${ISSUE}#issuecomment-9002`,
    terminalHistoryDigest: queueDigest(terminalHistory),
    priorPublication: null,
    authorityUrl: `${ISSUE}#issuecomment-9004`,
    authorityAuthor: "synthetic-delegator",
    authorityBodySha256: hash(authorityBody),
  };
  const loop: LoopConfig = { ...f.loop, nativeLaunchCeiling: 64, terminalAttemptAdmission: packet };
  const selected = { key: KEY, number: NUMBER, base, planningRevision: base };
  const authority = {
    id: "9004",
    url: packet.authorityUrl,
    author: packet.authorityAuthor,
    body: authorityBody,
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
  const receipt = {
    ...authority,
    id: "9002",
    url: packet.terminalReceiptUrl,
    body: `${terminalBody} To unpark, ${unparkInstructions}.`,
  };
  const issue = { number: NUMBER, url: ISSUE, state: "OPEN", title: "Synthetic issue" };
  const calls: string[] = [];
  const observe = async (url: string) => {
    calls.push(url);
    return url === packet.authorityUrl ? authority : receipt;
  };
  const observeIssue = async () => {
    calls.push("issue");
    return issue;
  };
  const compose = (
    config = loop,
    observer = observe,
    issueObserver = observeIssue,
    selection = selected,
  ) =>
    queueConfigFromLoop(
      config,
      f.repository,
      selection,
      f.policy,
      history,
      undefined,
      observer,
      async () => {
        throw new Error("unpublished terminal must not probe PR");
      },
      issueObserver,
    );
  const reservation = resolve(
    loop.stateRoot,
    `terminal-attempt-admission-${queueDigest({ repository: loop.repository, issue: KEY })}.json`,
  );
  return {
    ...f,
    loop,
    selected,
    packet,
    seed,
    authoredHead,
    terminalHead,
    terminalHistory,
    history,
    directory,
    put,
    authority,
    receipt,
    issue,
    calls,
    observe,
    observeIssue,
    compose,
    reservation,
    terminalBody,
    terminalSelection,
  };
}

it.each([
  "v2",
  "ceiling",
  "red again",
  "skipped again",
  "unexecuted again",
  "refresh",
  "pending receipt",
  "published conflict",
  "published CRLF conflict",
  "published CRLF outside hunk",
  "published pending receipt",
  "published outside hunk",
  "published semantic loss",
  "published lost seed response",
  "published lost publication response",
  "published unsupported conflict",
  "published unruled preservation",
  "published auto-merge semantic loss",
  "published later main conflict",
])("ISS-247 / ISS-246 SYNTHETIC native continuation: %s", async (mode) => {
  const publishedConflict = mode.startsWith("published");
  const autoMergeConflict = mode === "published auto-merge semantic loss";
  const f = await conflictSuccessorFixture();
  const crlf = mode.startsWith("published CRLF");
  const outsideHunk = mode.endsWith("outside hunk");
  // Reproduce the Windows checkout in a disposable repository on every OS.
  if (crlf) await f.git(["config", "core.autocrlf", "true"]);
  await writeFile(
    resolve(f.repository, "unrelated.test.ts"),
    "// SYNTHETIC unchanged failed test\n",
  );
  if (autoMergeConflict)
    await writeFile(
      resolve(f.repository, "auto.txt"),
      `api=1\nfeatureCaller=1\n${"stable padding\n".repeat(10)}mainCaller=none\n`,
    );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic unchanged test"]);
  await f.git(["push", "origin", "main"]);
  f.selected.base = await f.git(["rev-parse", "HEAD"]);
  f.selected.planningRevision = f.selected.base;
  f.policy.requiredChecks = () => [
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest",
  ];
  let q = await f.compose();
  const item = q.items[0]!;
  let loop = f.loop;
  if (mode === "ceiling") {
    // Synthetic ordinary attempt 4 uses the same native gates/delivery, without
    // the v2 packet, reservation or terminal continuation item.
    delete item.terminalAttemptAdmission;
    const { terminalAttemptAdmission: _packet, ...ordinary } = loop;
    loop = ordinary;
    await rm(f.reservation);
  }
  const terminalBytes = mode === "ceiling" ? undefined : await readFile(f.reservation, "utf8");
  const launches: string[] = [];
  const effects: string[] = [];
  const executedGateHeads: { name: string; head: string }[] = [];
  let publication: PublicationEvidence | undefined;
  let continued = false;
  let conflicting = false;
  let deltaPending = true;
  let green = false,
    merged = false,
    cleaned = false;
  const native: Adapter = {
    async preflight() {},
    git: (cwd, args) => f.git(args, cwd),
    async launch(role, config) {
      launches.push(role);
      if (role === "author" && continued && publishedConflict) {
        const path = resolve(config.worktree, "docs/loop.md");
        const marked = await readFile(path, "utf8");
        expect(marked).toContain("<<<<<<<");
        if (crlf) expect(marked).toContain("\r\n");
        let resolved = marked.replace(
          /^<<<<<<< .*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .*\r?\n/gm,
          mode === "published semantic loss" ? "$1" : "$1$2",
        );
        // Resolve the actual marker representation without normalizing fixed bytes.
        // The outside-hunk control must fail for its edit, not leftover markers.
        expect(resolved).not.toMatch(/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m);
        if (crlf) expect(resolved).toContain("\r\n");
        if (outsideHunk) resolved = `unruled outside-hunk edit\n${resolved}`;
        await writeFile(path, resolved);
      } else if (role === "author") {
        await appendFile(
          resolve(config.worktree, "docs/loop.md"),
          "\nSYNTHETIC ISS-246 candidate.\n",
        );
        await writeFile(resolve(config.worktree, "changed.test.ts"), "// SYNTHETIC changed file\n");
        if (autoMergeConflict) {
          const path = resolve(config.worktree, "auto.txt");
          await writeFile(
            path,
            (await readFile(path, "utf8"))
              .replace("api=1", "api=2")
              .replace("featureCaller=1", "featureCaller=2"),
          );
        }
      }
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "SYNTHETIC execution\n");
      return { id: randomUUID(), pid: 246, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (
        role === "reviewer" &&
        config.stateDirectory !== item.source.stateDirectory &&
        deltaPending
      )
        return { id: attempt.id, status: "running" };
      const head =
        role === "author" ? config.base : await f.git(["rev-parse", "HEAD"], config.worktree);
      const autoLoss =
        continued &&
        autoMergeConflict &&
        role === "reviewer" &&
        /api=2[\s\S]*mainCaller=1/.test(
          await readFile(resolve(config.worktree, "auto.txt"), "utf8"),
        );
      const semanticLoss =
        autoLoss ||
        (continued &&
          publishedConflict &&
          role === "reviewer" &&
          !(await readFile(resolve(config.worktree, "docs/loop.md"), "utf8")).includes(
            "SYNTHETIC ISS-247 main behavior.",
          ));
      return {
        id: attempt.id,
        status: semanticLoss ? "failed" : "passed",
        head,
        ...(role === "reviewer"
          ? {
              summary: JSON.stringify({
                run: RUN,
                role,
                head,
                verdict: semanticLoss ? "FAIL" : "PASS",
                findings: semanticLoss
                  ? [
                      {
                        severity: "blocking",
                        file: autoLoss ? "auto.txt" : "docs/loop.md",
                        line: 1,
                        text: "Retain main behavior from the other parent.",
                      },
                    ]
                  : [],
                g0: "No; synthetic bounded implementation.",
              }),
            }
          : {}),
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
  delivery.runGate = async (_config, name, head) => {
    effects.push(`gate:${name}`);
    executedGateHeads.push({ name, head });
    return "passed";
  };
  delivery.conflictingPublication = async () => conflicting;
  delivery.observePublication = async (config) =>
    publication
      ? config.candidateHead !== publication.head
        ? { state: "needs-mutation", target: "synthetic-refresh" }
        : { state: conflicting ? "conflicting" : "confirmed", value: publication }
      : { state: "needs-mutation", target: "absent" };
  delivery.publish = async (config, plan) => {
    effects.push("publish");
    if (publishedConflict) {
      if (continued) {
        expect(
          (await f.git(["ls-remote", "origin", `refs/heads/${plan.sourceBranch}`])).split("\t")[0],
        ).toBe(publication!.head);
        expect(await f.git(["merge-base", publication!.head, config.candidateHead])).toBe(
          publication!.head,
        );
      }
      await f.git(["push", "origin", `${config.candidateHead}:refs/heads/${plan.sourceBranch}`]);
    }
    const saved = JSON.parse(
      await readFile(resolve(config.stateDirectory, "delivery-plan.json"), "utf8"),
    );
    publication = {
      number: 246,
      url: `https://github.com/${config.repository}/pull/246`,
      head: config.candidateHead,
      repository: config.repository,
      sourceBranch: plan.sourceBranch,
      baseBranch: "main",
      title: plan.title,
      body: plan.body,
      planDigest: saved.digest,
    };
    if (continued && mode === "published lost publication response")
      throw new Error("SYNTHETIC lost completed push response");
  };
  delivery.checks = async (config) => {
    effects.push("checks");
    if (conflicting) throw new DeliveryBlocked("published-candidate-conflict");
    if (continued && mode === "unexecuted again")
      throw new DeliveryBlocked("hosted-check-never-executed");
    const e = executedHostedFixture(publication!, item.base, NUMBER, "");
    const rows = green ? e.data.greenJobs : e.data.jobs;
    const jobs = rows.map((row) => ({
      name: row.name,
      bucket:
        continued && mode === "skipped again" && row.name === "Node 24 / windows-latest"
          ? ("skipping" as const)
          : row.conclusion === "success"
            ? ("pass" as const)
            : ("fail" as const),
      link: row.html_url,
      actions: { run: 24601, attempt: green ? 2 : continued ? 3 : 1, job: row.id, workflow: 246 },
    }));
    // Put the failed shard first, as the complete census may legitimately do.
    jobs.sort(
      (a, b) =>
        Number(b.name.startsWith("Windows tests")) - Number(a.name.startsWith("Windows tests")),
    );
    return {
      head: config.candidateHead,
      checks: jobs.filter((job) => config.requiredChecks.includes(job.name)),
      jobs,
    };
  };
  delivery.failedCheckLog = async () =>
    "SYNTHETIC FAIL unrelated.test.ts:1 timed out; changed.test.ts passed\n";
  delivery.observeMerge = async () =>
    merged
      ? {
          state: "confirmed",
          value: { number: 246, head: publication!.head, mergeCommit: "e".repeat(40) },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    effects.push("merge");
    merged = true;
  };
  delivery.observeCleanup = async (_config, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    effects.push("cleanup");
    cleaned = true;
  };
  const adapter = () =>
    repositoryQueueAdapter(q, f.repository, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      repository: f.policy,
      async assertExecutor() {},
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
          return "succeeded";
        },
      }),
      deliveryPolicy: {
        async plan(config) {
          return {
            gates: {
              beforeMirror: ["typecheck", "format:check", "planning:check", "test"],
              afterMirror: publishedConflict ? ["planning:board-check"] : [],
            },
            drafts: [],
            publication: {
              sourceBranch: `codex/${KEY.toLowerCase()}-attempt-4`,
              baseBranch: "main",
              title: "SYNTHETIC",
              body: "SYNTHETIC",
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
  const reason =
    mode === "ceiling" ? "implementation-attempt-ceiling-exhausted" : "continuation-failed";
  const failure = await queueStep(q, adapter()).catch((error) => error);
  expect(failure).toMatchObject({ reason });
  const attemptPath = resolve(q.stateDirectory, "attempt.json");
  const failedBytes = await readFile(attemptPath, "utf8");
  const failed = JSON.parse(failedBytes);
  const cycle = {
    selection: { cycle: 3, ...f.selected },
    initialHistory: await adapter().history(),
  };
  await persistCycle(loop, cycle);
  const comments: string[] = [];
  let issueClosed = false;
  const supervisor: SupervisionAdapter = {
    async currentMain() {
      return f.selected.base;
    },
    async issue() {
      return { state: issueClosed ? "CLOSED" : "OPEN", key: KEY, labels: [], comments };
    },
    async removeReady() {},
    async close() {
      issueClosed = true;
    },
    async comment(_config, _number, body) {
      comments.push(body);
    },
  };
  await stopCycle(loop, cycle, reason, 4, supervisor, f.policy, failure.diagnostics);
  const baseline = process.env.ISS246_BASELINE === "1";
  if (baseline) {
    expect(failure.diagnostics).toBeUndefined();
    expect(comments[0]).not.toContain("Diagnostic:");
  } else {
    expect(comments[0]).toContain("Diagnostic:");
    expect(failure.diagnostics).toContain("hostedExecutedFailure");
    expect(failure.diagnostics).toContain("run 24601/1 job 24613");
    expect(failure.diagnostics.length).toBeLessThanOrEqual(500);
  }
  await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
  expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
  const before = await snapshot(f.runState);
  await f.git(["commit", "--allow-empty", "-m", "SYNTHETIC reviewed executor repair"]);
  if (publishedConflict) {
    if (mode === "published unsupported conflict") await f.git(["rm", "docs/loop.md"]);
    else
      await appendFile(
        resolve(f.repository, "docs/loop.md"),
        "\nSYNTHETIC ISS-247 main behavior.\n",
      );
    if (autoMergeConflict) {
      const path = resolve(f.repository, "auto.txt");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace("mainCaller=none", "mainCaller=1"),
      );
    }
    await f.git(["commit", "-am", "SYNTHETIC conflicting current main"]);
  }
  await f.git(["push", "origin", "main"]);
  const repair = await f.git(["rev-parse", "HEAD"]);
  const log = await readFile(resolve(item.source.stateDirectory, "hosted-failure.log"));
  const grant = {
    stateDirectory: item.source.stateDirectory,
    candidateHead: failed.head,
    repairSha: repair,
    authorityUrl: `${ISSUE}#issuecomment-246`,
    hostedExecutedFailure: {
      cycle: 3,
      stop: 1,
      actionsRun: 24601,
      runAttempt: 1,
      job: 24613,
      controlRun: 24602,
      greenRunAttempt: 2,
      candidateHead: failed.head,
      stoppedExecutorHead: f.selected.base,
      evidenceSha256: createHash("sha256").update(log).digest("hex"),
      failedTests: ["unrelated.test.ts"],
      publication: {
        number: 246,
        url: publication!.url,
        head: failed.head,
        sourceBranch: publication!.sourceBranch,
      },
    },
  };
  const granted = { ...loop, gateStopAuthorization: grant };
  if (baseline) {
    q = { ...q, controllerRevision: repair };
    item.setup.controllerRevision = repair;
    await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
    expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
    if (mode !== "ceiling") {
      const { hostedExecutedFailure: _kind, ...oldGrant } = grant;
      expect(() => validateLoopConfig({ ...loop, gateStopAuthorization: oldGrant })).toThrow(
        "terminal-attempt-admission-mismatch",
      );
    }
    expect(launches).toEqual(["author", "reviewer"]);
    return;
  }
  const e = executedHostedFixture(publication!, item.base, NUMBER, comments[0]!);
  if (publishedConflict) {
    const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
    const packet: IntegrationContinuation = {
      schemaVersion: "dogfood-integration-continuation/v1",
      repository: loop.repository,
      issueKey: KEY,
      issueUrl: ISSUE,
      run: RUN,
      attemptDirectory: q.stateDirectory,
      absoluteAttempt: 4,
      stopMarker: `loop-stop:${RUN}:3:1`,
      candidateHead: failed.head,
      reviewId: failed.reviewId,
      authorityUrl: `${ISSUE}#issuecomment-247`,
      allowedPaths: ["docs/loop.md"],
      publishedConflict: {
        kind: "published-conflict",
        sourceDirectory: item.source.stateDirectory,
        authorId: JSON.parse(
          await readFile(resolve(item.source.stateDirectory, "author-attempt.json"), "utf8"),
        ).id,
        originalBase: item.base,
        main: repair,
        originalConfig: JSON.stringify(loop),
        originalConfigSha256: queueDigest(loop),
        terminalReservationSha256: sha(terminalBytes!),
        terminalBindingDigest: queueDigest(JSON.parse(terminalBytes!).binding),
        terminalHistoryDigest: queueDigest(failed.history),
        selected: cycle.selection as any,
        receiptUrl: `${ISSUE}#issuecomment-2470`,
        authority: { id: "247", author: "todd-skelton", body: "", sha256: "" },
        hosted: {
          actionsRun: 24601,
          runAttempt: 1,
          job: 24613,
          greenRunAttempt: 2,
          controlRun: 24602,
          controlRunAttempt: 1,
          controlJob: 24613,
          evidenceSha256: sha(log),
          failedTests: ["unrelated.test.ts"],
          publication: grant.hostedExecutedFailure.publication,
        },
        resolutions: [
          {
            path: "docs/loop.md",
            semantics: "Preserve feature and main behavior in literal marked hunks.",
          },
        ],
        preservation:
          mode === "published unruled preservation"
            ? [
                {
                  path: "other.txt",
                  semantics: "Synthetic requested preservation outside eligible U.",
                },
              ]
            : [],
      },
    };
    const p = packet.publishedConflict!;
    p.authority.body = `SYNTHETIC independently interpreted recovery ${packet.stopMarker} ${p.sourceDirectory} ${p.originalConfigSha256} ${p.terminalReservationSha256} ${packet.candidateHead} ${p.main} ${p.terminalHistoryDigest} ${p.terminalBindingDigest} ${JSON.stringify(p.hosted)} ${JSON.stringify(p.resolutions)} ${JSON.stringify(p.preservation)} changedPathsExercised: yes`;
    p.authority.sha256 = sha(p.authority.body);
    const config = { ...loop, integrationContinuation: packet };
    if (process.env.ISS247_BASELINE === "1") {
      // Red at the recorded installed baseline: its closed config has no
      // published-conflict/v2 coexistence. No API read or claim is attempted.
      expect(() => validateLoopConfig(config)).not.toThrow();
      return;
    }
    let liveAuthorityBody = p.authority.body;
    const observations = {
      commands: e.commands,
      authority: async (url: string) => ({
        id: url === p.receiptUrl ? "2470" : "247",
        url,
        author: "todd-skelton",
        body: url === p.receiptUrl ? comments[0]! : liveAuthorityBody,
        capturedAt: new Date().toISOString(),
      }),
    };
    const claim = resolve(
      loop.stateRoot,
      `integration-continuation-${queueDigest({ repository: loop.repository, issue: KEY })}.json`,
    );
    const hef = resolve(item.source.stateDirectory, "gate-stop-continuation.json");
    const admit = () => admitPublishedConflict(config, f.selected, observations);
    for (const object of [
      p,
      p.selected,
      p.authority,
      p.hosted,
      p.hosted.publication,
      p.resolutions[0]!,
    ]) {
      (object as any).unknown = true;
      await expect(admit()).rejects.toMatchObject({ reason: "invalid-integration-continuation" });
      delete (object as any).unknown;
    }
    await expect(
      admitPublishedConflict(
        { ...config, providerOutageCeilingMs: 12345 },
        f.selected,
        observations,
      ),
    ).rejects.toMatchObject({
      reason: "integration-continuation-history-unavailable",
      diagnostics: "complete original configuration and recovery declaration",
    });
    await expect(
      admitPublishedConflict(
        config,
        { ...f.selected, base: repair, planningRevision: repair },
        observations,
      ),
    ).rejects.toMatchObject({
      reason: "integration-continuation-history-unavailable",
      diagnostics: "retained stop-cycle selection",
    });
    await f.put(item.source.stateDirectory, "gate-stop-continuation", {
      synthetic: "already spent",
    });
    await expect(admit()).rejects.toMatchObject({
      reason: "integration-continuation-already-consumed",
    });
    await rm(hef);
    await writeFile(
      claim,
      JSON.stringify({ schemaVersion: "dogfood-integration-continuation/v1" }),
    );
    await expect(admit()).rejects.toMatchObject({
      reason: "integration-continuation-already-consumed",
    });
    await rm(claim);
    const originalReceipt = comments[0]!;
    comments[0] += " ";
    await expect(admit()).rejects.toMatchObject({
      reason: "integration-continuation-history-unavailable",
      diagnostics: "complete ISS-216 receipt",
    });
    comments[0] = originalReceipt;
    await f.git(["push", "--force", "origin", `${repair}:refs/heads/${publication!.sourceBranch}`]);
    await expect(admit()).rejects.toMatchObject({ reason: "publication-state-unknown" });
    await f.git([
      "push",
      "--force",
      "origin",
      `${failed.head}:refs/heads/${publication!.sourceBranch}`,
    ]);
    liveAuthorityBody = "SYNTHETIC superseded decision";
    await expect(admit()).rejects.toMatchObject({
      reason: "integration-continuation-authority-mismatch",
    });
    liveAuthorityBody = p.authority.body;
    const controls: [string, () => void, string, string?][] = [
      [
        "log hash",
        () => {
          p.hosted.evidenceSha256 = "e".repeat(64);
        },
        "integration-continuation-history-unavailable",
        "failed log hash",
      ],
      [
        "history digest",
        () => {
          p.terminalHistoryDigest = "e".repeat(64);
        },
        "integration-continuation-history-unavailable",
        "failed hosted cursor and raw history",
      ],
      [
        "reservation digest",
        () => {
          p.terminalReservationSha256 = "e".repeat(64);
        },
        "integration-continuation-history-unavailable",
        "original reserved v2 and consumed resolution",
      ],
      [
        "source author",
        () => {
          p.authorId = "different-author";
        },
        "integration-continuation-history-unavailable",
        "source author and original base",
      ],
      [
        "source PASS",
        () => {
          packet.reviewId = "different-review";
        },
        "integration-continuation-history-unavailable",
        "failed hosted cursor and raw history",
      ],
      [
        "base",
        () => {
          p.originalBase = repair;
        },
        "integration-continuation-history-unavailable",
        "source author and original base",
      ],
      [
        "owning issue",
        () => {
          e.data.issue.state = "CLOSED";
        },
        "integration-continuation-history-unavailable",
        "open owning issue",
      ],
      [
        "publication head",
        () => {
          e.data.pr.headRefOid = repair;
        },
        "gate-stop-authorization-mismatch",
        "publication identity",
      ],
      [
        "publication ref",
        () => {
          e.data.pr.headRefName = "different";
        },
        "gate-stop-authorization-mismatch",
        "publication identity",
      ],
      [
        "draft",
        () => {
          e.data.pr.isDraft = false;
        },
        "gate-stop-authorization-mismatch",
        "publication identity",
      ],
      [
        "green pending",
        () => {
          e.data.green.status = "in_progress";
        },
        "gate-stop-authorization-mismatch",
        "failed/green workflow identity or result",
      ],
      [
        "green cancelled",
        () => {
          e.data.greenJobs[3]!.conclusion = "cancelled";
        },
        "gate-stop-authorization-mismatch",
        "green effective jobs must execute or retain failed-attempt successes",
      ],
      [
        "green skipped",
        () => {
          e.data.greenJobs[3]!.conclusion = "skipped";
        },
        "gate-stop-authorization-mismatch",
        "green effective jobs must execute or retain failed-attempt successes",
      ],
      [
        "green unexecuted",
        () => {
          e.data.greenJobs[3]!.runner_id = 0;
        },
        "gate-stop-authorization-mismatch",
        "green effective jobs must execute or retain failed-attempt successes",
      ],
      [
        "green empty steps",
        () => {
          e.data.greenJobs[3]!.steps = [];
        },
        "gate-stop-authorization-mismatch",
        "green effective jobs must execute or retain failed-attempt successes",
      ],
      [
        "foreign workflow",
        () => {
          e.data.green.workflow_id++;
        },
        "gate-stop-authorization-mismatch",
        "failed/green workflow identity or result",
      ],
      [
        "control base",
        () => {
          e.data.control.head_sha = failed.head;
        },
        "gate-stop-authorization-mismatch",
        "base control identity or result",
      ],
      [
        "extra failed job",
        () => {
          e.data.jobs[0]!.conclusion = "failure";
        },
        "gate-stop-authorization-mismatch",
        "failed attempt job Node 24 / ubuntu-latest",
      ],
    ];
    for (const [label, change, reason, diagnostics] of controls) {
      const oldPacket = structuredClone(packet),
        oldData = structuredClone(e.data);
      change();
      await expect(admit(), label).rejects.toMatchObject({
        reason,
        ...(diagnostics ? { diagnostics } : {}),
      });
      await expect(readFile(claim), label).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(attemptPath, "utf8"), label).toBe(failedBytes);
      Object.assign(packet, oldPacket);
      // Keep the bound case reference used by this fixture's authority transport.
      Object.assign(p, oldPacket.publishedConflict);
      packet.publishedConflict = p;
      Object.assign(e.data, oldData);
    }
    const later = resolve(f.runState, "cycle-4-complete.json");
    const laterSelection = { ...cycle.selection, cycle: 4, key: "ISS-999", number: 999 };
    await f.put(f.runState, "cycle-4-selected", laterSelection);
    const nearCeiling = [...failed.history];
    while (
      nearCeiling.filter((row: QueueParticipant) => row.item.startsWith(`${KEY}:`)).length < 63
    )
      nearCeiling.push(
        participant(nearCeiling.length + 1, `${KEY}:4`, "refresh", "reviewer", "passed"),
      );
    await writeFile(later, JSON.stringify({ selection: laterSelection, history: nearCeiling }));
    await expect(admit()).rejects.toMatchObject({ reason: "native-launch-ceiling-exhausted" });
    await rm(later);
    // A later unrelated cycle remains charged and precedes the new integration pair.
    const laterHistory = [
      ...failed.history,
      participant(failed.history.length + 1, "ISS-999:1", "source", "author", "failed"),
    ];
    await writeFile(later, JSON.stringify({ selection: laterSelection, history: laterHistory }));
    await expect(readFile(claim)).rejects.toMatchObject({ code: "ENOENT" });
    if (mode === "published unsupported conflict" || mode === "published unruled preservation") {
      await expect(admit()).rejects.toMatchObject({
        reason:
          mode === "published unsupported conflict"
            ? "conflict-resolution-unsupported"
            : "conflict-resolution-scope-escape",
      });
      await expect(readFile(claim)).rejects.toMatchObject({ code: "ENOENT" });
      expect(launches).toEqual(["author", "reviewer"]);
      expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
      return;
    }
    if (mode === "published conflict") {
      const write = filesystem.writeFile;
      const spy = vi
        .spyOn(filesystem, "writeFile")
        .mockImplementation(async (path, bytes, options) => {
          if (String(path) === claim) throw new Error("SYNTHETIC exclusive claim failure");
          return write(path, bytes, options);
        });
      syncBuiltinESMExports();
      await expect(admit()).rejects.toThrow("SYNTHETIC exclusive claim failure");
      spy.mockRestore();
      syncBuiltinESMExports();
      expect(launches).toEqual(["author", "reviewer"]);
      await expect(readdir(resolve(packet.attemptDirectory, "integration"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(claim)).rejects.toMatchObject({ code: "ENOENT" });
    }
    if (mode === "published pending receipt") {
      await rm(resolve(f.runState, "cycle-3-stop-1-complete.json"));
      expect(
        await nextCycle(config, f.repository, supervisor, f.policy, undefined, observations),
      ).toMatchObject({ selection: cycle.selection });
      await expect(readFile(claim)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await reconcilePendingStop(config, cycle, supervisor, f.policy, observations),
      ).toBeUndefined();
    } else {
      expect(
        await nextCycle(config, f.repository, supervisor, f.policy, undefined, observations),
      ).toMatchObject({ selection: cycle.selection });
    }
    const reserved = await readFile(claim, "utf8");
    expect(JSON.parse(reserved)).toMatchObject({
      failedAttemptBytes: failedBytes,
      resolutionUsed: true,
    });
    expect(JSON.parse(reserved).initialHistory).toEqual(laterHistory);
    expect(JSON.parse(reserved).charged).toBe(10);
    expect(JSON.parse(reserved).conflict.census.k).toEqual(["docs/loop.md"]);
    const reads = e.calls.length;
    await admit();
    expect(e.calls).toHaveLength(reads);
    expect(await readFile(claim, "utf8")).toBe(reserved);
    q = await f.compose(config);
    expect(q.stateDirectory).toBe(resolve(packet.attemptDirectory, "integration"));
    expect(q.items[0]!.implementationAttempt).toBe(4);
    continued = true;
    green = true;
    if (mode === "published lost seed response") {
      const rename = filesystem.rename;
      let interrupted = false;
      const spy = vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
        if (
          !interrupted &&
          String(to).endsWith("native-refresh.json") &&
          JSON.parse(await readFile(from, "utf8")).conflict?.seed
        ) {
          expect(await readFile(claim, "utf8")).toBe(reserved);
          await rename(from, to);
          interrupted = true;
          throw new Error("SYNTHETIC seed save response lost");
        }
        return rename(from, to);
      });
      syncBuiltinESMExports();
      await expect(queueStep(q, adapter())).rejects.toThrow("SYNTHETIC seed save response lost");
      spy.mockRestore();
      syncBuiltinESMExports();
      expect(interrupted).toBe(true);
      expect(launches).toHaveLength(2);
      q = await f.compose(config);
    }
    if (outsideHunk) {
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining("conflict-resolution-scope-escape"),
      });
      expect(launches).toEqual(["author", "reviewer", "author"]);
      const count = effects.length;
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: "continuation-failed",
      });
      expect(effects).toHaveLength(count);
      expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
      return;
    }
    expect(await queueStep(q, adapter())).toMatchObject({ status: "observing-reviewer" });
    expect(launches).toEqual(["author", "reviewer", "author", "reviewer"]);
    const refreshed = JSON.parse(
      await readFile(resolve(q.items[0]!.source.stateDirectory, "native-refresh.json"), "utf8"),
    );
    expect(await f.git(["rev-list", "--parents", "-n", "1", refreshed.conflict.seed])).toBe(
      `${refreshed.conflict.seed} ${failed.head} ${repair}`,
    );
    expect(await queueStep(q, adapter())).toMatchObject({ status: "observing-reviewer" });
    expect(launches).toHaveLength(4);
    if (mode === "published later main conflict") {
      await writeFile(
        resolve(f.repository, "docs/loop.md"),
        "Completely replaced later main behavior.\n",
      );
      await f.git(["commit", "-am", "SYNTHETIC later main conflict"]);
      await f.git(["push", "origin", "main"]);
      // Model remote main movement without upgrading the running executor.
      await f.git(["checkout", "--detach", repair]);
      deltaPending = false;
      await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason: "current-main-moved" });
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining("conflict-resolution-exhausted"),
      });
      expect(launches).toHaveLength(4);
      expect(effects.filter((effect) => effect === "publish")).toHaveLength(1);
      return;
    }
    deltaPending = false;
    if (mode.endsWith("semantic loss")) {
      if (autoMergeConflict) {
        expect(refreshed.conflict.census.u).toContain("auto.txt");
        expect(refreshed.conflict.census.k).toEqual(["docs/loop.md"]);
        expect(await f.git(["show", `${failed.head}:auto.txt`])).toContain("mainCaller=none");
        expect(await f.git(["show", `${repair}:auto.txt`])).toContain("api=1");
      }
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining("refresh-review-failed"),
      });
      expect(effects.filter((effect) => effect === "publish")).toHaveLength(1);
      expect(effects).not.toContain("merge");
      const count = effects.length;
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: "continuation-failed",
      });
      expect(effects).toHaveLength(count);
      await stopCycle(config, cycle, "continuation-failed", 4, supervisor, f.policy);
      await rm(resolve(f.runState, "cycle-3-stop-2-complete.json"));
      expect(await nextCycle(config, f.repository, supervisor, f.policy)).toMatchObject({
        selection: cycle.selection,
      });
      expect(await reconcilePendingStop(config, cycle, supervisor, f.policy)).toMatchObject({
        scope: "item",
        reason: "continuation-failed",
      });
      expect(comments).toHaveLength(2);
      expect(launches).toHaveLength(4);
      return;
    }
    expect(await queueStep(q, adapter())).toMatchObject({ status: "complete" });
    const result = await readFile(resolve(q.items[0]!.source.worktree, "docs/loop.md"), "utf8");
    expect(result).toContain("SYNTHETIC ISS-246 candidate.");
    expect(result).toContain("SYNTHETIC ISS-247 main behavior.");
    const finalHead = await f.git(["rev-parse", "HEAD"], q.items[0]!.source.worktree);
    expect(executedGateHeads.slice(-5)).toEqual(
      ["typecheck", "format:check", "planning:check", "test", "planning:board-check"].map(
        (name) => ({ name, head: finalHead }),
      ),
    );
    expect(finalHead).not.toBe(failed.head);
    const count = effects.length;
    expect(await queueStep(q, adapter())).toMatchObject({ status: "complete" });
    expect(effects).toHaveLength(count);
    expect(await nextCycle(config, f.repository, supervisor, f.policy)).toMatchObject({
      selection: cycle.selection,
    });
    await completeCycle(config, cycle, await adapter().history(), supervisor);
    const completedCycle = JSON.parse(
      await readFile(resolve(f.runState, "cycle-3-complete.json"), "utf8"),
    );
    expect(completedCycle.history).toHaveLength(laterHistory.length + 2);
    expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
    expect(await readFile(f.reservation, "utf8")).toBe(terminalBytes);
    expect(await readFile(claim, "utf8")).toBe(reserved);
    await expect(readFile(hef)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(resolve(f.runState, `${KEY.toLowerCase()}-attempt-5`, "attempt.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    return;
  }
  const authority = {
    id: "246",
    url: grant.authorityUrl,
    author: "todd-skelton",
    capturedAt: new Date().toISOString(),
    body: `SYNTHETIC host interpreted decision loop-stop:${RUN}:3:1 ${grant.stateDirectory} ${repair} ${JSON.stringify(grant.hostedExecutedFailure)} changedPathsExercised: no`,
  };
  const admit = (config = granted) =>
    admitExecutedHostedStop(config, f.selected, {
      commands: e.commands,
      authority: async () => authority,
    });
  const slot = resolve(item.source.stateDirectory, "gate-stop-continuation.json");
  if (mode === "v2") {
    // Every rejection changes one authority input, then restores it. No slot or
    // failed-to-delivery write may happen before all observations agree.
    for (const [label, change] of [
      [
        "hash",
        () => {
          grant.hostedExecutedFailure.evidenceSha256 = "e".repeat(64);
        },
      ],
      [
        "changed set",
        () => {
          grant.hostedExecutedFailure.failedTests = ["changed.test.ts"];
        },
      ],
      [
        "log path",
        () => {
          grant.hostedExecutedFailure.failedTests = ["absent.test.ts"];
        },
      ],
      [
        "closed issue",
        () => {
          e.data.issue.state = "CLOSED";
        },
      ],
      [
        "authority body",
        () => {
          authority.body = "SYNTHETIC changed body";
        },
      ],
      [
        "green pending",
        () => {
          e.data.green.status = "in_progress";
        },
      ],
      [
        "PR moved",
        () => {
          e.data.pr.headRefOid = "e".repeat(40);
        },
      ],
    ] as const) {
      const oldGrant = structuredClone(grant),
        oldData = structuredClone(e.data),
        oldAuthority = { ...authority };
      change();
      if (label !== "authority body")
        authority.body = `SYNTHETIC host interpreted decision loop-stop:${RUN}:3:1 ${grant.stateDirectory} ${repair} ${JSON.stringify(grant.hostedExecutedFailure)} changedPathsExercised: no`;
      await expect(admit(), label).rejects.toMatchObject({
        reason: "gate-stop-authorization-mismatch",
        diagnostics: (
          {
            hash: "hosted evidence hash",
            "changed set": "failed test is in changed set",
            "log path": "failed test absent from log",
            "closed issue": "owning issue and complete receipt",
            "authority body": "host decision binding",
            "green pending": "failed/green workflow identity or result",
            "PR moved": "publication identity",
          } as const
        )[label],
      });
      await expect(readFile(slot), label).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(attemptPath, "utf8"), label).toBe(failedBytes);
      Object.assign(grant, oldGrant);
      Object.assign(e.data, oldData);
      Object.assign(authority, oldAuthority);
    }
    const { terminalAttemptAdmission: _packet, ...missing } = granted;
    await expect(admit(missing)).rejects.toMatchObject({
      reason: "gate-stop-authorization-mismatch",
    });
    await expect(admit({ ...granted, providerOutageCeilingMs: 12345 })).rejects.toMatchObject({
      reason: "gate-stop-authorization-mismatch",
    });
    for (const [field, value] of [
      ["run", "synthetic-other-run"],
      ["issueKey", "ISS-999"],
      ["nextAbsoluteAttempt", 3],
    ] as const) {
      const different = JSON.parse(terminalBytes!);
      different.binding.packet[field] = value;
      await writeFile(f.reservation, JSON.stringify(different));
      await expect(admit(), `reserved ${field}`).rejects.toMatchObject({
        reason: "gate-stop-authorization-mismatch",
        diagnostics: "saved v2 admission binding",
      });
      await expect(readFile(slot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
      await writeFile(f.reservation, terminalBytes!);
    }
    const { hostedExecutedFailure: _kind, ...plain } = grant;
    for (const other of [
      { ...plain, executorRepair: { stoppedExecutorHead: f.selected.base } },
      {
        ...plain,
        hostedNonExecution: {
          cycle: 3,
          stop: 1,
          actionsRun: 24601,
          runAttempt: 1,
          job: 24613,
          stoppedExecutorHead: f.selected.base,
        },
      },
    ])
      expect(() => validateLoopConfig({ ...loop, gateStopAuthorization: other })).toThrow(
        "terminal-attempt-admission-mismatch",
      );
    for (const label of ["author FAIL", "blocking DELTA", "local gate", "conflict"]) {
      await writeFile(attemptPath, JSON.stringify({ ...failed, findings: [] }));
      await expect(admit(), label).rejects.toMatchObject({
        reason: "gate-stop-authorization-mismatch",
        diagnostics: "executed hosted-failure finding",
      });
      await expect(readFile(slot)).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(attemptPath, failedBytes);
    }
  }
  const observations = { commands: e.commands, authority: async () => authority };
  if (mode === "pending receipt") await rm(resolve(f.runState, "cycle-3-stop-1-complete.json"));
  expect(
    await nextCycle(granted, f.repository, supervisor, f.policy, undefined, observations),
  ).toMatchObject({ selection: cycle.selection });
  if (mode === "pending receipt") {
    await expect(readFile(slot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await reconcilePendingStop(granted, cycle, supervisor, f.policy, observations),
    ).toBeUndefined();
    expect(comments).toHaveLength(1);
  }
  const reservation = await admit();
  expect(reservation.failedAttemptBytes).toBe(failedBytes);
  expect(reservation.failedAttemptSha256).toBe(
    createHash("sha256").update(failedBytes).digest("hex"),
  );
  expect(await readFile(attemptPath, "utf8")).toBe(failedBytes);
  const reserved = await readFile(slot, "utf8");
  const reads = e.calls.length;
  await admit();
  expect(e.calls).toHaveLength(reads);
  expect(await readFile(slot, "utf8")).toBe(reserved);
  if (mode === "refresh") {
    await writeFile(resolve(f.repository, "synthetic-later-main.txt"), "SYNTHETIC later main\n");
    await f.git(["add", "."]);
    await f.git(["commit", "-m", "SYNTHETIC native refresh main"]);
    await f.git(["push", "origin", "main"]);
    conflicting = true;
  }
  expect(await nextCycle(granted, f.repository, supervisor, f.policy)).toMatchObject({
    selection: cycle.selection,
  });
  if (mode !== "ceiling") q = await f.compose(granted);
  else {
    q = { ...q, controllerRevision: repair, gateStopAuthorization: grant };
    item.setup.controllerRevision = repair;
  }
  green = !mode.endsWith("again");
  continued = true;
  const checkpoint = effects.length;
  let reopens = 0;
  const originalRename = filesystem.rename;
  const renameSpy = vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (String(to) === attemptPath) {
      const next = JSON.parse(await readFile(from, "utf8"));
      const current = JSON.parse(await readFile(to, "utf8"));
      if (current.phase === "failed" && next.phase === "delivery") {
        reopens++;
        expect(await readFile(slot, "utf8")).toBe(reserved);
        expect(next).toEqual({
          ...failed,
          phase: "delivery",
          acceptedStage: "source",
          stateDirectory: grant.stateDirectory,
        });
      }
    }
    return originalRename(from, to);
  });
  syncBuiltinESMExports();
  if (green) {
    if (mode === "refresh") {
      expect(await queueStep(q, adapter())).toMatchObject({ status: "observing-hosted-checks" });
      expect(await queueStep(q, adapter())).toMatchObject({ status: "observing-reviewer" });
      expect(launches).toEqual(["author", "reviewer", "reviewer"]);
      deltaPending = false;
      conflicting = false;
    }
    expect(await queueStep(q, adapter())).toMatchObject({ status: "complete" });
    expect(effects.slice(checkpoint)).toEqual(
      mode === "refresh"
        ? [
            "checks",
            "gate:typecheck",
            "gate:format:check",
            "gate:planning:check",
            "gate:test",
            "publish",
            "checks",
            "merge",
            "cleanup",
          ]
        : ["checks", "merge", "cleanup"],
    );
    for (const keep of [true, false]) {
      if (!keep) delete q.gateStopAuthorization;
      expect(await queueStep(q, adapter())).toMatchObject({ status: "complete" });
    }
    // Replay admission validates its immutable failed copy after the live cursor completed.
    await admit();
  } else {
    await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
    const terminal = await readFile(attemptPath, "utf8");
    expect(terminal).not.toBe(failedBytes);
    expect(await failedDeliveryDiagnostic(q.stateDirectory, JSON.parse(terminal))).toContain(
      "planning (ISS-221; hostedExecutedFailure consumed)",
    );
    if (mode === "red again")
      expect(
        await readFile(
          resolve(item.source.stateDirectory, "hosted-continuation-failure.log"),
          "utf8",
        ),
      ).toContain('"attempt":3');
    await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
    expect(await readFile(attemptPath, "utf8")).toBe(terminal);
    const withGrant = q;
    const { gateStopAuthorization: _grant, ...withoutGrant } = q;
    q = withoutGrant;
    await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
    expect(await readFile(attemptPath, "utf8")).toBe(terminal);
    q = withGrant;
    const changedGrant = {
      ...granted,
      gateStopAuthorization: { ...grant, authorityUrl: `${ISSUE}#issuecomment-247` },
    };
    await expect(admit(changedGrant)).rejects.toMatchObject({
      reason: "gate-stop-authorization-mismatch",
    });
    await expect(
      admit({
        ...granted,
        gateStopAuthorization: {
          ...grant,
          stateDirectory: resolve(grant.stateDirectory, `refresh-${repair}`),
        },
      }),
    ).rejects.toThrow();
  }
  renameSpy.mockRestore();
  syncBuiltinESMExports();
  expect(reopens).toBe(1);
  expect(launches).toEqual(
    mode === "refresh" ? ["author", "reviewer", "reviewer"] : ["author", "reviewer"],
  );
  for (const [path, bytes] of before)
    if (path !== attemptPath) expect(await readFile(path, "utf8"), path).toBe(bytes);
  if (terminalBytes) expect(await readFile(f.reservation, "utf8")).toBe(terminalBytes);
  const diagnostic = await failedDeliveryDiagnostic(q.stateDirectory, failed);
  expect(diagnostic.length).toBeLessThanOrEqual(500);
  expect(diagnostic).toContain(`loop-stop:${RUN}:3:1`);
  expect(diagnostic.indexOf("hostedExecutedFailure")).toBeLessThan(
    diagnostic.indexOf(item.source.stateDirectory),
  );
});

async function historyForkFixture(hostedCharges = 3, unrelatedPrefix = 0) {
  const key = "ISS-901";
  const issue = "https://github.com/fixture/repository/issues/901";
  const prefix = Array.from({ length: hostedCharges }, (_, i) =>
    participant(
      i + 1,
      `${key}:${i === 0 ? 1 : 2}`,
      "source",
      i > 0 && i % 2 === 0 ? "reviewer" : "author",
      i === 0 ? "failed" : "passed",
    ),
  );
  for (let i = 0; i < unrelatedPrefix; i++)
    prefix.push(participant(prefix.length + 1, "ISS-904:1", "source", "author", "passed"));
  const f = await conflictSuccessorFixture(3, prefix);
  // Move the unrelated terminal fixtures after the synthetic hosted stop. Cycle
  // numbers do not order execution: the cycle-1 completion was written last.
  for (const [from, to] of [
    [2, 4],
    [1, 3],
  ]) {
    for (const name of (await readdir(f.runState)).filter((name) =>
      name.startsWith(`cycle-${from}-`),
    )) {
      const value = JSON.parse(await readFile(resolve(f.runState, name), "utf8"));
      if (value.selection) value.selection.cycle = to;
      else value.cycle = to;
      if (value.marker) value.marker = value.marker.replace(`:${from}:`, `:${to}:`);
      if (value.body) value.body = value.body.replace(`:${from}:`, `:${to}:`);
      await f.put(f.runState, name.replace(`cycle-${from}-`, `cycle-${to}-`).slice(0, -5), value);
      await rm(resolve(f.runState, name));
    }
  }
  f.packet.terminalMarker = `loop-stop:${RUN}:3:1`;
  f.receipt.body = f.receipt.body.replace(`:${RUN}:1:1`, `:${RUN}:3:1`);
  const x = participant(prefix.length + 1, `${key}:3`, "source", "author", "failed");
  x.id = "10000000-0000-4000-8000-000000000901";
  x.rung = 1;
  x.placement = { model: "synthetic-author", effort: "high" };
  const branch = [...prefix, x];
  const predecessor = resolve(f.runState, "iss-901-attempt-2");
  const successor = resolve(f.runState, "iss-901-attempt-3");
  const selection = { cycle: 1, key, number: 901, base: f.base };
  const stop = {
    selection,
    stop: 1,
    reason: "hosted-check-log-unavailable:Synthetic check",
    attempts: 2,
    marker: `loop-stop:${RUN}:1:1`,
    body: "Synthetic hosted stop",
    history: prefix,
  };
  const receipt = { selection, stop: 1, history: prefix };
  const grant = {
    stateDirectory: resolve(predecessor, "source"),
    candidateHead: f.reviewed,
    repairSha: f.main,
    authorityUrl: `${issue}#issuecomment-9011`,
    hostedNonExecution: {
      cycle: 1,
      stop: 1,
      actionsRun: 901,
      runAttempt: 1,
      job: 902,
      stoppedExecutorHead: f.base,
    },
  };
  const job = {
    name: "Synthetic check",
    bucket: "cancel",
    link: "https://example.test/jobs/902",
    actions: { run: 901, attempt: 1, job: 902, workflow: 900 },
    nonExecution: {
      id: 902,
      run_id: 901,
      run_attempt: 1,
      head_sha: f.reviewed,
      name: "Synthetic check",
      html_url: "https://example.test/jobs/902",
      status: "completed",
      conclusion: "cancelled",
      runner_id: 0,
      steps: [],
    },
  };
  await f.put(f.runState, "cycle-1-selected", selection);
  await f.put(f.runState, "cycle-1-stop-1", stop);
  await f.put(f.runState, "cycle-1-stop-1-complete", receipt);
  await f.put(f.runState, "cycle-1-complete", { selection, history: branch });
  await f.put(f.runState, "cycle-2-selected", {
    ...selection,
    cycle: 2,
    key: "ISS-902",
    number: 902,
  });
  await f.put(f.runState, "cycle-2-complete", {
    selection: { ...selection, cycle: 2, key: "ISS-902", number: 902 },
    history: f.history,
  });
  await f.put(predecessor, "attempt", {
    run: RUN,
    item: `${key}:2`,
    issue,
    candidateAttempt: 2,
    phase: "failed",
    history: prefix,
    stateDirectory: grant.stateDirectory,
  });
  await f.put(resolve(predecessor, "source"), "gate-stop-continuation", {
    authorization: grant,
    stop,
    receipt,
    publication: { head: f.reviewed },
    authority: {
      id: "9011",
      url: grant.authorityUrl,
      author: "todd-skelton",
      body: "Synthetic retained ruling",
      capturedAt: "2026-01-01T01:00:00.000Z",
    },
    job,
    directory: grant.stateDirectory,
  });
  await f.put(successor, "attempt", {
    run: RUN,
    item: x.item,
    issue,
    candidateAttempt: 3,
    // A failed source terminal leaves the native queue in its source phase.
    phase: "source",
    base: f.base,
    head: f.base,
    history: branch,
    authorFailures: { count: 2, ids: [prefix[0]!.id, x.id] },
  });
  for (const p of branch) await f.put(successor, `participant-${p.ordinal}-terminal`, p);
  await f.put(resolve(successor, "source"), "config", {
    config: { run: RUN, issue, base: f.base },
  });
  await f.put(resolve(successor, "source"), "author-attempt", {
    id: x.id,
    rung: 1,
    placement: x.placement,
    routing: x.routing,
  });
  await f.put(resolve(successor, "source"), "author-terminal", {
    id: x.id,
    status: "failed",
    head: f.base,
    usage: x.usage,
  });
  return { ...f, x, prefix, branch, predecessor, successor, grant };
}

it("ISS-245 restores only the evidenced charge, reserves once, and retains it through a new cycle and restart", async () => {
  const f = await historyForkFixture();
  const before = await snapshot(f.runState);
  const view = await retainedRunHistory(f.loop);
  expect(view.history.map((p) => p.id)).toEqual([...f.history.map((p) => p.id), f.x.id]);
  expect(view.restored).toEqual([
    expect.objectContaining({
      participant: f.x,
      originalOrdinal: 4,
      effectiveOrdinal: f.history.length + 1,
      sourcePath: resolve(f.successor, "participant-4-terminal.json"),
    }),
  ]);
  expect(view.history.filter((p) => p.item.startsWith("ISS-901:"))).toHaveLength(4);
  expect(view.history.filter((p) => p.item.startsWith(`${KEY}:`))).toHaveLength(8);
  const audit = {};
  const evaluated = await evaluateTerminalAttempt(
    f.loop,
    f.selected,
    f.history,
    f.observe,
    undefined,
    f.observeIssue,
    audit,
  );
  expect(evaluated.replay).toBe(false);
  expect(evaluated.reservation.initialHistory).toEqual(view.history);
  expect(await snapshot(f.runState)).toEqual(before);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  const queue = await f.compose();
  expect(queue.initialHistory).toEqual(view.history);
  const bytes = await readFile(f.reservation);
  const calls = f.calls.length;
  expect((await f.compose()).initialHistory).toEqual(view.history);
  expect(f.calls).toHaveLength(calls);
  expect(await readFile(f.reservation)).toEqual(bytes);
  const reservation = JSON.parse(bytes.toString("utf8"));
  expect(reservation).toMatchObject({
    initialHistory: view.history,
    inheritedWorkerRetry: true,
    correctionUsed: true,
    resolutionUsed: true,
  });
  const item = queue.items[0]!;
  expect(item.id).toBe(`${KEY}:4`);
  const launches: { role: string; id: string }[] = [];
  const effects: string[] = [];
  const waiting = new Set(["author", "reviewer"]);
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    resolveLauncher: async () => ({ executable: process.execPath, prefixArgs: [] }),
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
      return "succeeded";
    },
  });
  const native: Adapter = {
    async preflight() {},
    git: (cwd, args) => f.git(args, cwd),
    async launch(role, config) {
      const id = randomUUID();
      launches.push({ role, id });
      if (role === "author") {
        expect(await f.git(["rev-parse", "HEAD"], config.worktree)).toBe(f.selected.base);
        await appendFile(resolve(config.worktree, "docs/loop.md"), "\nSynthetic fresh attempt.\n");
      }
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic execution evidence\n");
      return { id, pid: launches.length, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (waiting.has(role)) return { id: attempt.id, status: "running" };
      const head =
        role === "author" ? config.base : await f.git(["rev-parse", "HEAD"], config.worktree);
      return {
        id: attempt.id,
        status: "passed",
        head,
        summary:
          role === "author"
            ? ""
            : JSON.stringify({
                run: RUN,
                role,
                head,
                verdict: "PASS",
                findings: [],
                g0: "No; synthetic smallest implementation.",
              }),
      };
    },
    async checks() {
      throw new Error("source must not publish");
    },
  };
  const delivery = githubDeliveryAdapter();
  delivery.verifyWorkspace = async (config, head) =>
    (await f.git(["rev-parse", "HEAD"], config.worktree)) === head;
  delivery.runGate = async (_config, name) => {
    effects.push(`gate:${name}`);
    return "passed";
  };
  let publishedHead = "";
  let merged = false;
  let cleaned = false;
  delivery.observePublication = async (config, plan, planDigest) =>
    publishedHead
      ? {
          state: "confirmed",
          value: {
            number: 9006,
            url: "https://github.com/fixture/repository/pull/9006",
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
  delivery.publish = async (config, plan) => {
    expect(config.refresh).toBeUndefined();
    expect(plan.sourceBranch).toBe(`codex/${KEY.toLowerCase()}-attempt-4`);
    effects.push("publish");
    publishedHead = config.candidateHead;
    throw new Error("synthetic lost publication response");
  };
  delivery.checks = async (config) => ({
    head: publishedHead,
    checks: config.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: "https://example.test/synthetic-check",
    })),
  });
  delivery.observeMerge = async () =>
    merged
      ? {
          state: "confirmed",
          value: { number: 9006, head: publishedHead, mergeCommit: "e".repeat(40) },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    effects.push("merge");
    merged = true;
  };
  delivery.observeCleanup = async (_config, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    effects.push("cleanup");
    cleaned = true;
  };
  const adapter = (config: typeof queue) =>
    repositoryQueueAdapter(config, f.repository, {
      native,
      setup,
      delivery,
      gitExecutable: f.gitExecutable,
      repository: f.policy,
      deliveryPolicy: {
        async plan(config) {
          return {
            gates: { beforeMirror: ["typecheck", "format:check", "test"], afterMirror: [] },
            drafts: [],
            publication: {
              sourceBranch: `codex/${KEY.toLowerCase()}-attempt-4`,
              baseBranch: "main",
              title: "Synthetic fresh successor",
              body: "Synthetic acceptance",
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
  let closed = false;
  const supervisor: SupervisionAdapter = {
    currentMain: async () => f.selected.base,
    issue: async () => ({ key: KEY, state: closed ? "CLOSED" : "OPEN", labels: [], comments: [] }),
    async close() {
      effects.push("close");
      closed = true;
    },
    async removeReady() {
      throw new Error("successor replay must not change readiness");
    },
    async comment() {
      throw new Error("successful successor must not post a stop");
    },
  };
  const policy = {
    ...f.policy,
    selectCandidates: () => (closed ? [] : [{ key: KEY, number: NUMBER }]),
  };
  const cycle = (await nextCycle(f.loop, f.repository, supervisor, policy))!;
  expect(cycle).toEqual({ selection: { cycle: 5, ...f.selected }, initialHistory: view.history });
  await persistCycle(f.loop, cycle);
  const read = async (directory: string, name: string) =>
    JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  const assertAccounting = async (newCharges: number) => {
    const history = (await retainedRunHistory(f.loop)).history;
    expect(history.slice(0, view.history.length)).toEqual(view.history);
    expect(history.map((p) => p.id)).toEqual([
      ...view.history.map((p) => p.id),
      ...launches.slice(0, newCharges).map((p) => p.id),
    ]);
    expect(history.map((p) => p.ordinal)).toEqual(history.map((_p, i) => i + 1));
    expect(history.filter((p) => p.item.startsWith("ISS-901:"))).toHaveLength(4);
    expect(history.filter((p) => p.item.startsWith(`${KEY}:`))).toHaveLength(8 + newCharges);
    expect(await read(queue.stateDirectory, `participant-${view.history.length}-terminal`)).toEqual(
      { ...f.x, ordinal: view.history.length },
    );
    const attempt = await read(queue.stateDirectory, "attempt");
    expect(attempt.authorFailures).toEqual(reservation.authorFailures);
    expect(attempt.retries).toBe(1);
    return history;
  };
  // Real source dispatch seeds the restored row in a new queue. Each subsequent
  // step reconstructs composition and its adapter from the retained lifecycle.
  await expect(queueStep(queue, adapter(queue))).resolves.toMatchObject({
    status: "observing-author",
  });
  const pinned = await readFile(resolve(item.source.stateDirectory, "config.json"));
  await assertAccounting(0);
  const restart = async () => {
    const saved = await nextCycle(f.loop, f.repository, supervisor, policy);
    expect(saved?.selection).toEqual(cycle.selection);
    const config = await f.compose();
    expect(config).toEqual(queue);
    return queueStep(config, adapter(config));
  };
  await expect(restart()).resolves.toMatchObject({ status: "observing-author" });
  expect(launches.map((p) => p.role)).toEqual(["author"]);
  waiting.delete("author");
  await expect(restart()).resolves.toMatchObject({ status: "observing-reviewer" });
  await assertAccounting(1);
  await expect(restart()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(launches.map((p) => p.role)).toEqual(["author", "reviewer"]);
  expect(effects).toEqual([]);
  waiting.delete("reviewer");
  await expect(restart()).resolves.toMatchObject({
    status: "complete",
    participants: view.history.length + 2,
  });
  const history = await assertAccounting(2);
  expect((await read(queue.stateDirectory, "attempt")).phase).toBe("complete");
  await completeCycle(f.loop, cycle, history, supervisor);
  expect(await read(f.runState, "cycle-5-complete")).toEqual({
    selection: cycle.selection,
    history,
  });
  expect(effects).toEqual([
    "gate:typecheck",
    "gate:format:check",
    "gate:test",
    "publish",
    "merge",
    "cleanup",
    "close",
  ]);
  const completed = await snapshot(f.loop.stateRoot);
  // Both direct queue replay and ordinary supervision replay use native output;
  // the unchanged P+X branch remains admissible after new launches and completion.
  const { terminalAttemptAdmission: omitted, ...ordinary } = f.loop;
  for (const loop of [f.loop, ordinary, f.loop]) {
    expect(await nextCycle(loop, f.repository, supervisor, policy)).toBeUndefined();
    const config = await f.compose();
    await expect(queueStep(config, adapter(config))).resolves.toMatchObject({
      status: "complete",
      participants: history.length,
    });
    const restarted = await retainedRunHistory(loop);
    expect(restarted.history).toEqual(history);
    expect(restarted.restored).toEqual(view.restored);
    expect(await snapshot(f.loop.stateRoot)).toEqual(completed);
  }
  expect(launches.map((p) => p.role)).toEqual(["author", "reviewer"]);
  expect(effects).toHaveLength(7);
  expect(f.calls).toHaveLength(calls);
  expect(await readFile(f.reservation)).toEqual(bytes);
  expect(await readFile(resolve(item.source.stateDirectory, "config.json"))).toEqual(pinned);
  const after = await snapshot(f.runState);
  for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes);
  for (const path of after.keys())
    if (!before.has(path))
      expect(
        path.startsWith(`${queue.stateDirectory}${sep}`) ||
          path === resolve(f.runState, "cycle-5-selected.json") ||
          path === resolve(f.runState, "cycle-5-complete.json"),
        path,
      ).toBe(true);
});

it("ISS-245 historical fork reaches fresh v2 admission with every proved charge", async () => {
  const f = await historyForkFixture();
  const queue = await f.compose();
  expect(queue.initialHistory.map((p) => p.id)).toEqual([...f.history.map((p) => p.id), f.x.id]);
  expect(queue.initialHistory.at(-1)).toMatchObject({
    ordinal: f.history.length + 1,
    id: f.x.id,
    outcome: "failed",
  });
});

it("ISS-245 synthetic 75-entry snapshot restores the fourth hosted charge without spending unrelated headroom", async () => {
  const f = await historyForkFixture(3, 41);
  const spine = [...f.history];
  while (spine.length < 75)
    spine.push(participant(spine.length + 1, "ISS-905:1", "source", "author", "passed"));
  const completed = JSON.parse(
    await readFile(resolve(f.runState, "cycle-4-complete.json"), "utf8"),
  );
  await f.put(f.runState, "cycle-4-complete", { ...completed, history: spine });
  const before = await snapshot(f.runState);
  const view = await retainedRunHistory(f.loop);
  expect(view.history).toHaveLength(76);
  expect(view.history.filter((p) => p.item.startsWith("ISS-901:"))).toHaveLength(4);
  expect(view.history.filter((p) => p.item.startsWith(`${KEY}:`))).toHaveLength(8);
  expect(view.restored[0]).toMatchObject({
    originalOrdinal: 45,
    effectiveOrdinal: 76,
    participant: f.x,
  });
  expect(await snapshot(f.runState)).toEqual(before);
});

it.each([
  "prefix identity",
  "prefix outcome",
  "conflicting item",
  "conflicting role",
  "conflicting stage",
  "reordered prefix",
  "extra fork",
  "missing reservation",
  "wrong run",
  "wrong issue",
  "wrong stop",
  "wrong author",
  "second orphan",
])("ISS-245 refuses isolated retained fork defect: %s", async (fault) => {
  const f = await historyForkFixture();
  const change = async (directory: string, name: string, edit: (value: any) => void) => {
    const value = JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
    edit(value);
    await f.put(directory, name, value);
  };
  if (
    fault === "prefix identity" ||
    fault === "prefix outcome" ||
    fault === "conflicting item" ||
    fault === "conflicting role" ||
    fault === "conflicting stage" ||
    fault === "reordered prefix"
  )
    await change(f.runState, "cycle-2-complete", (v) => {
      if (fault === "prefix identity") v.history[0].id = "synthetic-wrong";
      if (fault === "prefix outcome") v.history[0].outcome = "passed";
      if (fault === "conflicting item") v.history[0].item = "ISS-999:1";
      if (fault === "conflicting role") v.history[0].role = "reviewer";
      if (fault === "conflicting stage") v.history[0].stage = "repair";
      if (fault === "reordered prefix") {
        [v.history[0], v.history[1]] = [v.history[1], v.history[0]];
        v.history[0].ordinal = 1;
        v.history[1].ordinal = 2;
      }
    });
  if (fault === "extra fork" || fault === "second orphan")
    await f.put(f.runState, "cycle-6-complete", {
      history: [
        ...f.prefix,
        {
          ...participant(
            f.prefix.length + 1,
            "ISS-909:1",
            "source",
            fault === "second orphan" ? "author" : "reviewer",
            "failed",
          ),
          id: "synthetic-extra-fork",
        },
      ],
    });
  if (fault === "missing reservation")
    await rm(resolve(f.predecessor, "source/gate-stop-continuation.json"));
  if (fault === "wrong run" || fault === "wrong issue")
    await change(f.successor, "attempt", (v) => {
      v[fault === "wrong run" ? "run" : "issue"] = "synthetic-wrong";
    });
  if (fault === "wrong stop")
    await change(resolve(f.predecessor, "source"), "gate-stop-continuation", (v) => {
      v.authorization.hostedNonExecution.stop = 2;
    });
  if (fault === "wrong author")
    await change(resolve(f.successor, "source"), "author-terminal", (v) => {
      v.id = "synthetic-wrong";
    });
  const before = await snapshot(f.runState);
  await expect(f.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  expect(await snapshot(f.runState)).toEqual(before);
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
});

it("ISS-245 counts the orphan against its own issue ceiling without changing unrelated headroom", async () => {
  const f = await historyForkFixture(63);
  const queue = await f.compose();
  expect(queue.initialHistory.filter((p) => p.item.startsWith("ISS-901:"))).toHaveLength(64);
  expect(queue.initialHistory.filter((p) => p.item.startsWith(`${KEY}:`))).toHaveLength(8);
  const exhausted = await historyForkFixture(64);
  await expect(exhausted.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  expect(exhausted.calls).toEqual([]);
  await expect(readFile(exhausted.reservation)).rejects.toMatchObject({ code: "ENOENT" });
});

it("ISS-245 actual preflight CLI is read-only, shares every predicate, and never authorizes changed inputs", async () => {
  const f = await historyForkFixture();
  const realRepository = "todd-skelton/orchestration-platform";
  // Synthetic numbers and bodies, with the self adapter's required repository.
  // Only GitHub transport is replaced; CLI, planning, evaluator and Git are real.
  for (const [path, bytes] of await snapshot(f.runState))
    await writeFile(path, bytes.replaceAll("fixture/repository", realRepository));
  const loop: LoopConfig = JSON.parse(
    JSON.stringify(f.loop).replaceAll("fixture/repository", realRepository),
  );
  const packet = loop.terminalAttemptAdmission!;
  const authority = JSON.parse(
    JSON.stringify(f.authority).replaceAll("fixture/repository", realRepository),
  );
  const receipt = JSON.parse(
    JSON.stringify(f.receipt).replaceAll("fixture/repository", realRepository),
  );
  const issue = JSON.parse(
    JSON.stringify(f.issue).replaceAll("fixture/repository", realRepository),
  );
  const root = resolve(import.meta.dirname, "../..");
  const entry = resolve(f.repository, "scripts/dogfood/admission-preflight.mjs");
  await mkdir(resolve(entry, ".."), { recursive: true });
  await writeFile(entry, await readFile(resolve(root, "scripts/dogfood/admission-preflight.mjs")));
  await mkdir(resolve(f.repository, "planning/drafts"), { recursive: true });
  await writeFile(
    resolve(f.repository, `planning/drafts/${KEY}.md`),
    `---\nkey: ${KEY}\ntitle: "Synthetic admission"\nlabels: ["type:slice"]\nmilestone: "Synthetic"\nblocked_by: []\n---\n\n## Done when\n\n- Synthetic outcome.\n`,
  );
  await writeFile(
    resolve(f.repository, "planning/roadmap.json"),
    JSON.stringify({
      schemaVersion: "orchestration-roadmap/v1",
      repository: realRepository,
      project: {
        id: "synthetic",
        number: 1,
        title: "Synthetic",
        url: "https://example.test/project/1",
      },
      milestones: [{ key: "M1", title: "Synthetic" }],
      issues: [{ key: KEY, file: `planning/drafts/${KEY}.md`, milestone: "M1", blockedBy: [] }],
    }),
  );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "Synthetic unready planning and real preflight entry"]);
  const base = await f.git(["rev-parse", "HEAD"]);
  await f.git(["push", "origin", "main"]);
  const selection = { ...f.selected, base, planningRevision: base };
  const request = resolve(f.root, "preflight-config.json");
  const response = resolve(f.root, "api-responses.json");
  const probes = resolve(f.root, "preflight-probes.jsonl");
  const preload = resolve(f.root, "preflight-transport.mjs");
  await writeFile(request, JSON.stringify(loop));
  await writeFile(response, JSON.stringify({ authority, receipt, issue }));
  await writeFile(
    preload,
    `
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const original = promisify(cp.execFile);
const append = fs.appendFile.bind(fs);
cp.execFile = Object.assign(function() { throw new Error('unexpected callback transport'); }, {
  [promisify.custom]: async (file, args, options) => {
    if (file !== 'gh') return original(file, args, options);
    await append(${JSON.stringify(probes)}, JSON.stringify(args) + '\\n');
    const responses = JSON.parse(await fs.readFile(${JSON.stringify(response)}, 'utf8'));
    if (responses.unavailable) throw new Error('synthetic transport unavailable');
    if (args[0] === 'api') {
      const value = args[1].endsWith('/9004') ? responses.authority : responses.receipt;
      return { stdout: JSON.stringify({ id: Number(value.id), html_url: value.url, user: { login: value.author }, body: value.body }) };
    }
    if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify(responses.issue) };
    throw new Error('unexpected GitHub mutation');
  }
});
for (const name of ['writeFile', 'mkdir', 'rename', 'rm', 'unlink', 'open']) {
  const original = fs[name].bind(fs);
  fs[name] = (...args) => {
    if (String(args[0]).startsWith(${JSON.stringify(loop.stateRoot)})) throw new Error('preflight attempted runtime write: ' + name);
    return original(...args);
  };
}
syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === ${JSON.stringify(pathToFileURL(entry).href)} && specifier.startsWith('.'))
    return { url: pathToFileURL(resolve(${JSON.stringify(resolve(root, "scripts/dogfood"))}, specifier)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}});
`,
  );
  let invocation = 0;
  const invoke = async () => {
    const path = resolve(f.root, `preflight-${++invocation}.json`);
    const errorPath = `${path}.stderr`;
    const output = await open(path, "wx");
    const errors = await open(errorPath, "wx");
    let code;
    try {
      code = await new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", pathToFileURL(preload).href, entry, request],
          { stdio: ["ignore", output.fd, errors.fd] },
        );
        child.on("error", reject);
        child.on("close", done);
      });
    } finally {
      await output.close();
      await errors.close();
    }
    const bytes = await readFile(path, "utf8");
    expect(bytes, await readFile(errorPath, "utf8")).not.toBe("");
    return { code, value: JSON.parse(bytes) };
  };
  const before = await snapshot(loop.stateRoot);
  // Independent, identical disposable inputs for the mutating half of parity.
  // Only location fields change; packet, trees, raw histories and probes do not.
  const twinRoot = await realpath(await mkdtemp(resolve(tmpdir(), "admission-parity-")));
  roots.push(twinRoot);
  await cp(f.root, twinRoot, { recursive: true });
  const encodedRoot = JSON.stringify(f.root).slice(1, -1);
  const encodedTwin = JSON.stringify(twinRoot).slice(1, -1);
  const twinLoop: LoopConfig = JSON.parse(
    JSON.stringify(loop).replaceAll(encodedRoot, encodedTwin),
  );
  for (const [path, bytes] of await snapshot(twinLoop.stateRoot))
    await writeFile(path, bytes.replaceAll(encodedRoot, encodedTwin));
  if (process.platform !== "win32") for (const path of before.keys()) await chmod(path, 0o444);
  const eligible = await invoke();
  expect(eligible.value, JSON.stringify(eligible)).toMatchObject({
    disposition: "eligible",
    selection,
    accounting: {
      count: f.history.length + 1,
      restored: [expect.objectContaining({ participant: f.x })],
    },
  });
  expect(eligible.code).toBe(0);
  expect(eligible.value.probes).toHaveLength(3);
  expect(eligible.value.probes[0].body).toBe(authority.body);
  expect(await snapshot(loop.stateRoot)).toEqual(before);
  const remote = resolve(f.root, "remote.git");
  const unknownMain = await f.git(
    [
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.test",
      "commit-tree",
      `${base}^{tree}`,
      "-p",
      base,
      "-m",
      "Synthetic remote-only main",
    ],
    remote,
  );
  await f.git(["update-ref", "refs/heads/main", unknownMain], remote);
  const localRefs = await f.git(["show-ref"]);
  expect(await invoke()).toMatchObject({
    code: 1,
    value: { disposition: "refused", reason: "current-main-unavailable" },
  });
  await expect(f.git(["cat-file", "-e", `${unknownMain}^{commit}`])).rejects.toThrow();
  expect(await f.git(["show-ref"])).toBe(localRefs);
  expect(await snapshot(loop.stateRoot)).toEqual(before);
  await f.git(["update-ref", "refs/heads/main", base], remote);
  const twinQueue = await queueConfigFromLoop(
    twinLoop,
    twinLoop.stableExecutorRoot,
    selection,
    f.policy,
    f.history,
    undefined,
    async (url) => (url === packet.authorityUrl ? authority : receipt),
    undefined,
    async () => issue,
  );
  expect(queueDigest(twinQueue.initialHistory)).toBe(
    eligible.value.accounting.effectiveHistoryDigest,
  );
  await writeFile(response, JSON.stringify({ authority, receipt, issue, unavailable: true }));
  const unavailable = await invoke();
  expect(unavailable).toMatchObject({
    code: 1,
    value: { disposition: "refused", reason: "terminal-attempt-admission-authority-unavailable" },
  });
  await writeFile(
    response,
    JSON.stringify({
      authority: { ...authority, body: "Synthetic changed ruling" },
      receipt,
      issue,
    }),
  );
  const refused = await invoke();
  expect(refused).toMatchObject({
    code: 1,
    value: { disposition: "refused", reason: "terminal-attempt-admission-mismatch" },
  });
  await writeFile(
    response,
    JSON.stringify({ authority, receipt, issue: { ...issue, state: "CLOSED" } }),
  );
  expect(await invoke()).toMatchObject({
    code: 1,
    value: { disposition: "refused", reason: "terminal-attempt-admission-mismatch" },
  });
  expect(await snapshot(loop.stateRoot)).toEqual(before);
  // Real admission repeats the probes; the earlier eligible receipt has no input.
  await expect(
    queueConfigFromLoop(
      loop,
      f.repository,
      selection,
      f.policy,
      f.history,
      undefined,
      async (url) =>
        url === packet.authorityUrl ? { ...authority, body: "Synthetic changed ruling" } : receipt,
      undefined,
      async () => issue,
    ),
  ).rejects.toMatchObject({ reason: "terminal-attempt-admission-mismatch" });
  expect(await snapshot(loop.stateRoot)).toEqual(before);
  await writeFile(response, JSON.stringify({ authority, receipt, issue }));
  const queue = await queueConfigFromLoop(
    loop,
    f.repository,
    selection,
    f.policy,
    f.history,
    undefined,
    async (url) => (url === packet.authorityUrl ? authority : receipt),
    undefined,
    async () => issue,
  );
  expect(queueDigest(queue.initialHistory)).toBe(eligible.value.accounting.effectiveHistoryDigest);
  const reserved = await snapshot(loop.stateRoot);
  const observed = await readFile(probes, "utf8");
  const replay = await invoke();
  expect(replay).toMatchObject({ code: 0, value: { disposition: "replay" } });
  expect(await readFile(probes, "utf8")).toBe(observed);
  expect(await snapshot(loop.stateRoot)).toEqual(reserved);
});

it.each([2, 3] as const)(
  "ISS-244 admits only the next unused attempt after successor %i and replays without observations",
  async (prior) => {
    const f = await conflictSuccessorFixture(prior);
    const retained = await snapshot(f.runState);
    const { terminalAttemptAdmission: omitted, ...ordinary } = f.loop;
    await expect(f.compose(ordinary)).rejects.toMatchObject({
      reason: "continuation-failed",
      diagnostics: expect.stringContaining("host-interpreted terminalAttemptAdmission"),
    });
    expect(f.calls).toEqual([]);
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-${prior + 1}`);
    const queue = await f.compose();
    const item = queue.items[0]!;
    expect(item.implementationAttempt).toBe(prior + 1);
    expect(item.base).toBe(f.selected.base);
    expect(item.source.base).toBe(f.selected.base);
    expect(item.setup.sourceBranch).toBe(
      `codex/run-${createHash("sha256").update(RUN).digest("hex")}/${KEY.toLowerCase()}-attempt-${prior + 1}`,
    );
    expect(item.delivery.policy).toMatchObject({
      sourceBranch: `codex/${KEY.toLowerCase()}-attempt-${prior + 1}`,
    });
    expect(item.source.author.prompt).toContain(`ordinary attempt ${prior + 1}`);
    expect(item.source.author.prompt).toContain(f.directory(prior - 1));
    expect(item.source.author.prompt).toContain(f.directory(prior));
    expect(item.source.author.prompt).not.toContain("Apply these reviewer-prescribed");
    expect(queue.initialHistory).toEqual(f.history);
    const saved = JSON.parse(await readFile(f.reservation, "utf8"));
    expect(saved).toMatchObject({
      binding: { packet: f.packet },
      initialHistory: f.history,
      inheritedWorkerRetry: true,
      resolutionUsed: true,
      correctionUsed: true,
      authorFailures: {
        ids: [f.history.find((p) => p.role === "author" && p.outcome === "failed")!.id],
      },
    });
    expect(f.calls).toHaveLength(3);
    expect(await f.compose()).toEqual(queue);
    expect(f.calls).toHaveLength(3);
    for (const [path, bytes] of retained) expect(await readFile(path, "utf8"), path).toBe(bytes);
  },
);

it("ISS-244 keeps v1 packets and reservations byte-readable without normalizing an implicit kind", async () => {
  const f = await terminalAdmissionFixture();
  const bytes = JSON.stringify(f.packet);
  validateLoopConfig(f.loop);
  const queue = await f.compose();
  const saved = JSON.parse(await readFile(f.reservation, "utf8"));
  expect(JSON.stringify(saved.binding.packet)).toBe(bytes);
  expect(JSON.stringify(f.packet)).toBe(bytes);
  const observations = f.calls.length;
  expect(await f.compose()).toEqual(queue);
  expect(f.calls).toHaveLength(observations);
  const { terminalAttemptAdmission: omitted, ...without } = f.loop;
  const old = await f.compose({ ...without, integrationContinuation: f.oldPacket });
  expect(old.items[0]!.implementationAttempt).toBe(2);
  await expect(queueStep(old, inertAdapter(f, old))).rejects.toMatchObject({
    reason: "continuation-failed",
  });
  expect(JSON.stringify(JSON.parse(await readFile(f.reservation, "utf8")).binding.packet)).toBe(
    bytes,
  );
  expect(() =>
    validateLoopConfig({
      ...f.loop,
      terminalAttemptAdmission: { ...f.packet, terminalKind: "integration" },
    } as unknown as LoopConfig),
  ).toThrow("terminal-attempt-admission-mismatch");
  const v2 = await conflictSuccessorFixture();
  expect(() =>
    validateLoopConfig({
      ...v2.loop,
      terminalAttemptAdmission: { ...v2.packet, claim: f.packet.claim },
    } as unknown as LoopConfig),
  ).toThrow("terminal-attempt-admission-mismatch");
  await f.unchanged();
});

it.each([
  "history",
  "head",
  "marker",
  "receipt-missing-suffix",
  "receipt-altered-suffix",
  "authority-author",
  "authority-hash",
  "next-not-successive",
  "next-above-ceiling",
  "source-fail",
  "repair-fail",
  "blocking-findings",
  "blocking-delta",
  "not-conflict",
  "publication-source",
  "publication-repair",
  "publication-refresh",
  "intent-source",
  "intent-repair",
  "intent-refresh",
  "later-work-stop",
  "missing-pin",
  "issue-closed",
  "foreign-declaration",
  "old-v1-reservation",
])("ISS-244 named admission guard: %s", async (fault) => {
  const f = await conflictSuccessorFixture();
  const source = resolve(f.directory(3), "source");
  const refresh = resolve(source, `refresh-${f.selected.base}`);
  const change = async (directory: string, name: string, key: string, value: unknown) => {
    const record = JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
    await f.put(directory, name, { ...record, [key]: value });
  };
  let selection = f.selected;
  switch (fault) {
    case "history":
      f.packet.terminalHistoryDigest = "a".repeat(64);
      break;
    case "head":
      f.packet.terminalHead = f.authoredHead;
      break;
    case "marker": {
      // Existing completed stop at the requested ordinal; only its marker disagrees.
      const stop = JSON.parse(await readFile(resolve(f.runState, "cycle-1-stop-1.json"), "utf8"));
      await f.put(f.runState, "cycle-1-stop-2", { ...stop, stop: 2 });
      await f.put(f.runState, "cycle-1-stop-2-complete", {
        selection: f.terminalSelection,
        stop: 2,
        history: f.terminalHistory,
      });
      f.packet.terminalMarker = `loop-stop:${RUN}:1:2`;
      break;
    }
    case "receipt-missing-suffix":
      f.receipt.body = f.terminalBody;
      break;
    case "receipt-altered-suffix":
      f.receipt.body += " ";
      break;
    case "authority-author":
      f.authority.author = "another-host";
      break;
    case "authority-hash":
      f.packet.authorityBodySha256 = "a".repeat(64);
      break;
    case "next-not-successive":
      Object.assign(f.packet, { nextAbsoluteAttempt: 3 });
      expect(() => validateLoopConfig(f.loop)).toThrow("terminal-attempt-admission-mismatch");
      break;
    case "next-above-ceiling":
      Object.assign(f.packet, { nextAbsoluteAttempt: 5 });
      expect(() => validateLoopConfig(f.loop)).toThrow("terminal-attempt-admission-mismatch");
      break;
    case "source-fail":
      await change(source, "author-terminal", "status", "failed");
      break;
    case "repair-fail":
      await change(f.directory(3), "attempt", "candidateAttempt", 4);
      break;
    case "blocking-findings":
      await change(f.directory(3), "attempt", "findings", [
        { file: "docs/loop.md", line: 1, severity: "blocking", text: "Synthetic rejection" },
      ]);
      break;
    case "blocking-delta":
      await change(refresh, "reviewer-terminal", "status", "failed");
      break;
    case "not-conflict":
      await change(resolve(f.directory(2), "source"), "native-refresh", "resolutionUsed", false);
      break;
    case "later-work-stop":
      await f.put(f.runState, "cycle-3-stop-1", {
        selection: { ...f.selected, cycle: 3 },
        reason: "continuation-failed",
        attempts: 3,
        history: f.history,
      });
      break;
    case "missing-pin": {
      const { planningRevision: omitted, ...unpinned } = f.selected;
      selection = unpinned as typeof selection;
      break;
    }
    case "issue-closed":
      f.issue.state = "CLOSED";
      break;
    case "foreign-declaration":
    case "old-v1-reservation": {
      await f.compose();
      const saved = JSON.parse(await readFile(f.reservation, "utf8"));
      await rm(f.directory(4), { recursive: true });
      const v1 =
        fault === "old-v1-reservation"
          ? (await terminalAdmissionFixture()).packet
          : { ...f.packet, authorityUrl: `${ISSUE}#issuecomment-9900` };
      await writeFile(
        f.reservation,
        JSON.stringify({
          ...saved,
          binding: { packet: v1, selected: f.selected, configDigest: queueDigest(f.loop) },
        }),
      );
      break;
    }
    default: {
      const [kind, place] = fault.split("-");
      await f.put(
        place === "refresh" ? refresh : resolve(f.directory(3), place!),
        kind === "intent" ? "publication-intent" : "publication",
        { head: f.terminalHead },
      );
    }
  }
  const before = await snapshot(f.runState);
  await expect(f.compose(f.loop, f.observe, f.observeIssue, selection)).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  if (!["foreign-declaration", "old-v1-reservation"].includes(fault))
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await snapshot(f.runState)).toEqual(before);
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
});

it.each(["comment", "issue"])(
  "ISS-244 unavailable %s read spends nothing and retries the same admission",
  async (what) => {
    const f = await conflictSuccessorFixture();
    const unavailable = async (): Promise<never> => {
      throw new Error("synthetic unavailable external read");
    };
    await expect(
      f.compose(
        f.loop,
        what === "comment" ? unavailable : f.observe,
        what === "issue" ? unavailable : f.observeIssue,
      ),
    ).rejects.toMatchObject({ reason: "terminal-attempt-admission-authority-unavailable" });
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
    expect((await f.compose()).items[0]!.implementationAttempt).toBe(4);
  },
);

it("ISS-244 requires two remaining issue launches before reservation", async () => {
  const f = await conflictSuccessorFixture();
  while (f.history.length < 64)
    f.history.push(participant(f.history.length + 1, `${KEY}:3`, "refresh", "reviewer", "failed"));
  expect(f.history.filter((p) => p.item.startsWith(`${KEY}:`))).toHaveLength(63);
  await expect(f.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls).toEqual([]);
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
});

it.each(["run", "worktree-root", "removed", "removed-new-run"])(
  "ISS-244 cannot renew reservation: %s",
  async (change) => {
    const f = await conflictSuccessorFixture();
    await f.compose();
    const bytes = await readFile(f.reservation, "utf8");
    const { terminalAttemptAdmission: omitted, ...without } = f.loop;
    const config =
      change === "run"
        ? { ...f.loop, run: "synthetic-new-run" }
        : change === "worktree-root"
          ? { ...f.loop, worktreeRoot: resolve(f.root, "different-worktrees") }
          : change === "removed"
            ? without
            : { ...without, run: "synthetic-new-run" };
    await expect(f.compose(config)).rejects.toMatchObject({
      reason: "terminal-attempt-admission-mismatch",
    });
    expect(await readFile(f.reservation, "utf8")).toBe(bytes);
    expect(f.calls).toHaveLength(3);
  },
);

it("ISS-244 real supervisor reports the complete zero-charge diagnostic, retries admission, and parks attempt 4 once", async () => {
  const f = await conflictSuccessorFixture();
  const entry = resolve(f.repository, "scripts/dogfood/supervise.mjs");
  await mkdir(resolve(entry, ".."), { recursive: true });
  await writeFile(
    entry,
    await readFile(resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs")),
  );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic canonical supervisor"]);
  const expectedBase = await f.git(["rev-parse", "HEAD"]);
  await f.git(["push", "origin", "main"]);
  const request = resolve(f.root, "loop.json");
  const controls = resolve(f.root, "controls.json");
  const { terminalAttemptAdmission: omitted, ...ordinary } = f.loop;
  await writeFile(request, JSON.stringify(ordinary));
  await writeFile(
    controls,
    JSON.stringify({
      number: NUMBER,
      key: KEY,
      ready: true,
      comments: [],
      launches: [],
      observations: [],
      unavailable: false,
      authority: f.authority,
      receipt: f.receipt,
      issue: f.issue,
      expectedBase,
      fullReview: true,
    }),
  );
  let invocation = 0;
  const invoke = async () => {
    const path = resolve(f.root, `supervisor-${++invocation}.log`);
    const output = await open(path, "wx");
    let code;
    try {
      code = await new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(resolve(import.meta.dirname, "supervise-fixtures/terminal-admission.mjs"))
              .href,
            entry,
            request,
          ],
          {
            env: { ...process.env, TERMINAL_ADMISSION_FIXTURE: controls },
            stdio: ["ignore", output.fd, output.fd],
          },
        );
        child.on("error", reject);
        child.on("close", done);
      });
    } finally {
      await output.close();
    }
    return { code, output: await readFile(path, "utf8") };
  };
  const readControl = async () => JSON.parse(await readFile(controls, "utf8"));
  const refused = await invoke();
  expect(refused.code, refused.output).toBe(0);
  const stop = JSON.parse(await readFile(resolve(f.runState, "cycle-3-stop-1.json"), "utf8"));
  const diagnostic = `Conflict successor attempt 3, head ${f.terminalHead}, seed ${f.seed}. Completed stop ${f.packet.terminalMarker}, attempts 3. ready alone re-raises this stop; re-entry requires host-interpreted terminalAttemptAdmission.`;
  expect(diagnostic.length).toBeLessThanOrEqual(500);
  expect(stop).toMatchObject({ reason: "continuation-failed", attempts: 0 });
  expect(stop.body).toContain(`Diagnostic: ${JSON.stringify(diagnostic)}.`);
  const control = await readControl();
  expect(control.comments).toHaveLength(1);
  expect(control.comments[0]).toContain(`Diagnostic: ${JSON.stringify(diagnostic)}.`);
  expect(control.launches).toEqual([]);
  expect(control.observations).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
  await writeFile(request, JSON.stringify(f.loop));
  await writeFile(controls, JSON.stringify({ ...control, ready: true, unavailable: true }));
  const unavailable = await invoke();
  expect(unavailable.code, unavailable.output).toBe(1);
  expect(
    JSON.parse(await readFile(resolve(f.runState, "cycle-4-stop-1.json"), "utf8")),
  ).toMatchObject({ reason: "terminal-attempt-admission-authority-unavailable", attempts: 3 });
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  const retry = await readControl();
  expect(retry.launches).toEqual([]);
  await writeFile(controls, JSON.stringify({ ...retry, unavailable: false, interrupt: true }));
  const interrupted = await invoke();
  expect(interrupted.code, interrupted.output).toBe(1);
  expect(
    JSON.parse(await readFile(resolve(f.runState, "cycle-4-stop-2.json"), "utf8")),
  ).toMatchObject({ reason: "queue-internal-error", attempts: 4 });
  const reserved = await readFile(f.reservation, "utf8");
  const interruptedControl = await readControl();
  expect(interruptedControl.launches).toEqual([]);
  expect(interruptedControl.observations).toHaveLength(4);
  await writeFile(controls, JSON.stringify({ ...interruptedControl, interrupt: false }));
  const admitted = await invoke();
  expect(admitted.code, admitted.output).toBe(0);
  const parked = JSON.parse(await readFile(resolve(f.runState, "cycle-4-stop-3.json"), "utf8"));
  expect(parked).toMatchObject({ reason: "continuation-failed", attempts: 4 });
  expect(parked.history.slice(0, f.history.length)).toEqual(f.history);
  expect(parked.history).toHaveLength(f.history.length + 2);
  const done = await readControl();
  expect(done.launches).toEqual(["author", "reviewer"]);
  expect(done.comments).toHaveLength(4);
  expect(done.observations).toEqual(interruptedControl.observations);
  const binding = await readFile(f.reservation, "utf8");
  expect(binding).toBe(reserved);
  const retained = await snapshot(f.runState);
  expect((await invoke()).code).toBe(0);
  expect(await readControl()).toEqual(done);
  expect(await readFile(f.reservation, "utf8")).toBe(binding);
  expect(await snapshot(f.runState)).toEqual(retained);
});

async function terminalAdmissionFixture() {
  const f = await spentFixture(true);
  f.loop.nativeLaunchCeiling = 64;
  // The real composition writes the consumed spent reservation and its packet.
  const old = await f.compose();
  const terminalDirectory = old.stateDirectory;
  const deliveryDirectory = resolve(terminalDirectory, "source", `refresh-${f.main}`);
  await mkdir(deliveryDirectory, { recursive: true });
  const history = [...f.later];
  for (let ordinal = 9; ordinal <= 25; ordinal++)
    history.push(participant(ordinal, `SYNTHETIC-${ordinal}:1`, "source", "author", "passed"));
  history.push(participant(26, `${KEY}:2`, "refresh", "reviewer", "passed"));
  const oldAttempt = JSON.parse(
    await readFile(resolve(f.old.stateDirectory, "attempt.json"), "utf8"),
  );
  const failed = {
    ...oldAttempt,
    base: f.seed,
    head: f.reviewed,
    reviewId: history[25]!.id,
    history,
  };
  await f.put(terminalDirectory, "attempt", failed);
  for (const p of history) await f.put(terminalDirectory, `participant-${p.ordinal}-terminal`, p);
  await f.put(resolve(terminalDirectory, "source"), "native-refresh", {
    directory: deliveryDirectory,
    main: f.main,
    head: f.reviewed,
    resolutionUsed: true,
  });
  await f.put(f.sourceDirectory, "gate-correction", { directory: "synthetic consumed correction" });
  const priorPublication = {
    number: 9001,
    url: "https://github.com/fixture/repository/pull/9001",
    sourceBranch: `codex/${KEY.toLowerCase()}-attempt-2`,
    head: f.reviewed,
    state: "OPEN" as const,
    isDraft: true as const,
  };
  await f.put(deliveryDirectory, "publication", {
    ...priorPublication,
    repository: f.loop.repository,
  });
  const terminalSelection = {
    cycle: 11,
    key: KEY,
    number: NUMBER,
    base: f.main,
    planningRevision: f.main,
  };
  const terminalMarker = `loop-stop:${RUN}:11:3`;
  // ISS-216: reproduce only the recorded byte relationship, with synthetic identities
  // and visibly synthetic content, never an altered real receipt.
  const terminalBody =
    `<!-- ${terminalMarker} --> Synthetic hosted failure after two attempts. `.padEnd(1222, "S");
  await f.put(f.runState, "cycle-11-stop-3", {
    selection: terminalSelection,
    stop: 3,
    reason: "continuation-failed",
    attempts: 2,
    history,
    marker: terminalMarker,
    body: terminalBody,
  });
  await f.put(f.runState, "cycle-11-stop-3-complete", {
    selection: terminalSelection,
    stop: 3,
    history,
  });
  await writeFile(
    resolve(f.repository, "repaired-brief.txt"),
    "Synthetic repaired current-main brief\n",
  );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic new main and repaired brief"]);
  const base = await f.git(["rev-parse", "HEAD"]);
  await f.git(["push", "origin", "main"]);
  const selected = { key: KEY, number: NUMBER, base, planningRevision: base };
  const originalContext = f.policy.issueContext;
  f.policy.issueContext = async (input) => ({
    ...(await originalContext(input)),
    body:
      input.planningRevision === base
        ? "Synthetic repaired current-main brief"
        : "Synthetic old brief",
    acceptanceCriteria: ["Implement the newly selected synthetic brief."],
  });
  const claim = `integration-continuation-${queueDigest({ repository: f.loop.repository, issue: KEY })}`;
  const claimPath = resolve(f.loop.stateRoot, `${claim}.json`);
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const authorityBody =
    "SYNTHETIC delegation: admit exactly ordinary attempt three; no fourth attempt.";
  const packet: TerminalAttemptAdmission = {
    schemaVersion: "dogfood-terminal-attempt-admission/v1",
    repository: f.loop.repository,
    issueKey: KEY,
    issueUrl: ISSUE,
    run: RUN,
    priorAbsoluteAttempt: 2,
    nextAbsoluteAttempt: 3,
    terminalMarker,
    terminalReceiptUrl: `${ISSUE}#issuecomment-9002`,
    claim,
    claimSha256: hash(await readFile(claimPath)),
    terminalHistoryDigest: queueDigest(history),
    priorPublication,
    authorityUrl: "https://github.com/fixture/synthetic-authority/issues/9003#issuecomment-9004",
    authorityAuthor: "synthetic-delegator",
    authorityBodySha256: hash(authorityBody),
  };
  const loop = { ...f.loop, terminalAttemptAdmission: packet };
  const calls: string[] = [];
  const authority = {
    id: "9004",
    url: packet.authorityUrl,
    author: packet.authorityAuthor,
    body: authorityBody,
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
  const receipt = {
    id: "9002",
    url: packet.terminalReceiptUrl,
    author: "synthetic-loop",
    body: `${terminalBody} To unpark, add the \`ready\` label after acting on the note.`,
    capturedAt: authority.capturedAt,
  };
  const observe = async (url: string) => {
    calls.push(url);
    return url === packet.authorityUrl ? authority : receipt;
  };
  const publication = { ...priorPublication };
  const observePublication = async () => {
    calls.push("synthetic-publication");
    return publication;
  };
  const compose = (config: LoopConfig = loop, observer = observe, selection = selected) =>
    queueConfigFromLoop(
      config,
      f.repository,
      selection,
      f.policy,
      history,
      undefined,
      observer,
      observePublication,
    );
  const retained = await snapshot(f.runState);
  const claimBytes = await readFile(claimPath, "utf8");
  const integrationWorktree = f.old.items[0]!.source.worktree;
  const unchanged = async () => {
    for (const [path, bytes] of retained) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await readFile(claimPath, "utf8")).toBe(claimBytes);
    const preserved = resolve(f.loop.worktreeRoot, `${KEY.toLowerCase()}-attempt-2-source`);
    expect(await f.git(["rev-parse", "HEAD"], preserved)).toBe(f.reviewed);
    expect(await f.git(["status", "--porcelain"], preserved)).toBe("");
    expect(await f.git(["rev-parse", "HEAD"], integrationWorktree)).toBe(f.seed);
    expect(await readFile(resolve(integrationWorktree, "overlap.txt"), "utf8")).toBe(
      "failed partial work\n",
    );
  };
  const reservation = resolve(
    f.loop.stateRoot,
    `terminal-attempt-admission-${queueDigest({ repository: f.loop.repository, issue: KEY })}.json`,
  );
  const { spentResolution, ...oldPacket } = f.packet;
  return {
    ...f,
    loop,
    packet,
    selected,
    history,
    failed,
    terminalDirectory,
    deliveryDirectory,
    terminalSelection,
    terminalBody,
    compose,
    authority,
    receipt,
    publication,
    calls,
    observe,
    reservation,
    claimPath,
    oldPacket: oldPacket as IntegrationContinuation,
    spentPacket: f.packet,
    unchanged,
  };
}

it("ISS-215 production composition: red without delegation, green only for fresh attempt 3; interruption/restart is one reservation", async () => {
  const f = await terminalAdmissionFixture();
  expect(Buffer.byteLength(f.terminalBody)).toBe(1222);
  expect(Buffer.byteLength(f.receipt.body)).toBe(1281);
  const { terminalAttemptAdmission: omitted, ...without } = f.loop;
  await expect(f.compose(without as typeof f.loop)).rejects.toMatchObject({
    reason: "integration-continuation-required",
  });
  const queue = await f.compose();
  expect(queue.initialHistory).toEqual(f.history);
  expect(queue.initialHistory).toHaveLength(26);
  const item = queue.items[0]!;
  expect(item.implementationAttempt).toBe(3);
  expect(item.implementationAttemptCeiling).toBe(4);
  expect(queue.nativeLaunchCeiling).toBe(64);
  expect(item.setup.base).toBe(f.selected.base);
  expect(item.source.mainBase).toBe(f.selected.base);
  expect(item.source.authorFailures).toEqual(f.failed.authorFailures);
  expect(item.source.author.rung).toBe(2);
  expect(item.source.inheritedWorkerRetry).toBe(true);
  expect(item.terminalAttemptAdmission).toEqual({ correctionUsed: true, resolutionUsed: true });
  expect(item.setup.sourceBranch).toBe(
    `codex/run-${createHash("sha256").update(RUN).digest("hex")}/${KEY.toLowerCase()}-attempt-3`,
  );
  expect(item.delivery.policy).toMatchObject({
    sourceBranch: `codex/${KEY.toLowerCase()}-attempt-3`,
  });
  expect(item.delivery.refresh).toBeUndefined();
  expect(item.source.author.prompt).toContain("Read-only predecessor evidence");
  expect(item.source.author.prompt).toContain("Synthetic repaired current-main brief");
  expect(item.source.author.prompt).not.toContain("Synthetic old brief");
  expect(item.source.author.prompt).not.toContain("Apply these reviewer-prescribed fixes");
  expect(f.calls).toHaveLength(3);
  const reservation = await readFile(f.reservation, "utf8");
  // Interrupt immediately after reservation, before any setup/worker record exists.
  await rm(queue.stateDirectory, { recursive: true });
  const restarted = await f.compose(structuredClone(f.loop), async () => {
    throw new Error("must not reobserve authority");
  });
  expect(restarted).toEqual(queue);
  expect(await f.compose()).toEqual(queue);
  expect(await readFile(f.reservation, "utf8")).toBe(reservation);
  expect(f.calls).toHaveLength(3);
  await f.unchanged();
});

it.each([
  "absent suffix",
  "wrong suffix",
  "edited original",
  "another stop",
  "truncated",
  "extra byte",
])("ISS-216 rejects only the changed receipt body: %s", async (fault) => {
  const f = await terminalAdmissionFixture();
  const original = f.receipt.body;
  const bodies: Record<string, string> = {
    "absent suffix": f.terminalBody,
    "wrong suffix": original.replace("`ready`", "`other`"),
    "edited original": original.replace("Synthetic hosted", "Synthetic edited"),
    "another stop": original.replace(f.packet.terminalMarker, `loop-stop:${RUN}:11:2`),
    truncated: original.slice(0, -1),
    "extra byte": `${original} `,
  };
  f.receipt.body = bodies[fault]!;
  const receiptBytes = JSON.stringify(f.receipt);
  f.policy.park = () => {
    throw new Error("admission must not park or change labels");
  };
  await expect(f.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  expect(f.calls).toEqual([
    f.packet.authorityUrl,
    f.packet.terminalReceiptUrl,
    "synthetic-publication",
  ]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-3`);
  expect(await readdir(f.loop.worktreeRoot)).not.toContain(`${KEY.toLowerCase()}-attempt-3-source`);
  expect(JSON.stringify(f.receipt)).toBe(receiptBytes);
  await f.unchanged();
  // Same state and bindings; restore ONLY body to prove no other guard caused refusal.
  f.receipt.body = original;
  const validReceipt = JSON.stringify(f.receipt);
  const queue = await f.compose();
  expect(queue.items[0]!.implementationAttempt).toBe(3);
  expect(queue.initialHistory).toEqual(f.history);
  expect(JSON.stringify(f.receipt)).toBe(validReceipt);
  await f.unchanged();
});

it.each(["retained", "future", "no-suffix"])(
  "ISS-216 production poster and admission round-trip with interrupted posting: %s self stop",
  async (shape) => {
    const f = await terminalAdmissionFixture();
    const cycle = {
      selection: { ...f.terminalSelection, cycle: shape === "retained" ? 11 : 12 },
      initialHistory: f.history,
    };
    const stop = shape === "retained" ? 3 : 1;
    const reason = shape === "no-suffix" ? "provider-unavailable" : "continuation-failed";
    const comments: string[] = [];
    let parks = 0;
    const repository = {
      ...f.policy,
      park: () => {
        parks++;
        return unparkInstructions;
      },
    };
    const supervisor: SupervisionAdapter = {
      currentMain: async () => f.main,
      issue: async () => ({ state: "OPEN", key: KEY, labels: [], comments }),
      removeReady: async () => {
        throw new Error("unexpected label mutation");
      },
      close: async () => {
        throw new Error("unexpected closure");
      },
      comment: async (_config, _number, body) => {
        comments.push(body);
        throw new Error("synthetic lost comment response");
      },
    };
    await expect(
      stopCycle(f.loop, cycle, reason, 2, supervisor, repository, undefined, stop),
    ).rejects.toThrow("synthetic lost comment response");
    const stopPath = resolve(f.runState, `cycle-${cycle.selection.cycle}-stop-${stop}.json`);
    const stopBytes = await readFile(stopPath, "utf8");
    const terminal = JSON.parse(stopBytes);
    if (shape === "retained") {
      expect(comments).toEqual([f.receipt.body]);
      await stopCycle(f.loop, cycle, reason, 2, supervisor, repository, undefined, stop);
    } else {
      await expect(reconcilePendingStop(f.loop, cycle, supervisor, repository)).resolves.toEqual({
        scope: shape === "no-suffix" ? "run" : "item",
        reason,
      });
    }
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe(
      terminal.body +
        (shape === "no-suffix"
          ? ""
          : " To unpark, add the `ready` label after acting on the note."),
    );
    expect(parks).toBe(shape === "no-suffix" ? 0 : 2);
    expect(await readFile(stopPath, "utf8")).toBe(stopBytes);
    f.packet.terminalMarker = terminal.marker;
    f.receipt.body = comments[0]!;
    const receiptBytes = JSON.stringify(f.receipt);
    f.policy.park = () => {
      throw new Error("admission must not park");
    };
    if (shape === "no-suffix") {
      // A host stop has no suffix, but it cannot establish a terminal item admission.
      await expect(f.compose()).rejects.toMatchObject({
        reason: "terminal-attempt-admission-mismatch",
      });
      await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
      expect(f.calls).toEqual([]);
    } else {
      const queue = await f.compose();
      expect(queue.items[0]!.implementationAttempt).toBe(3);
      expect(queue.initialHistory).toEqual(f.history);
      const saved = await readFile(f.reservation, "utf8");
      expect(JSON.parse(saved).receipt).toEqual(f.receipt);
      expect(await f.compose()).toEqual(queue);
      expect(f.calls).toHaveLength(3);
      expect(await readFile(f.reservation, "utf8")).toBe(saved);
    }
    expect(JSON.stringify(f.receipt)).toBe(receiptBytes);
    expect(await readFile(stopPath, "utf8")).toBe(stopBytes);
    await f.unchanged();
  },
);

it.each([
  "author",
  "body",
  "id",
  "url",
  "claim-bytes",
  "history",
  "receipt",
  "terminal",
  "terminal-stop",
  "terminal-cycle",
  "attempt",
  "publication-state",
  "publication-draft",
  "publication-head",
  "publication-ref",
  "publication-number",
  "publication-url",
  "later-attempt",
  "later-terminal",
  "old-pin",
  "old-admission",
])(
  "ISS-215 independently rejects synthetic pinned mismatch %s before reservation",
  async (fault) => {
    const f = await terminalAdmissionFixture();
    if (fault === "author") f.authority.author = "synthetic-other-author";
    if (fault === "body") f.authority.body += " changed";
    if (fault === "id") f.authority.id = "9005";
    if (fault === "url") f.authority.url += "0";
    if (fault === "claim-bytes") await appendFile(f.claimPath, " ");
    if (fault === "history") f.packet.terminalHistoryDigest = "a".repeat(64);
    if (fault === "receipt") f.receipt.body += " changed";
    if (fault === "terminal")
      await f.put(f.runState, "cycle-11-stop-3-complete", {
        selection: f.terminalSelection,
        stop: 2,
        history: f.history,
      });
    if (fault === "terminal-stop" || fault === "terminal-cycle") {
      const path = resolve(f.runState, "cycle-11-stop-3.json");
      const stop = JSON.parse(await readFile(path, "utf8"));
      if (fault === "terminal-stop") stop.stop = 2;
      else stop.selection.cycle = 10;
      await f.put(f.runState, "cycle-11-stop-3", stop);
    }
    if (fault === "attempt")
      await f.put(f.terminalDirectory, "attempt", { ...f.failed, phase: "delivery" });
    if (fault === "publication-state") Object.assign(f.publication, { state: "CLOSED" });
    if (fault === "publication-draft") Object.assign(f.publication, { isDraft: false });
    if (fault === "publication-head") f.publication.head = f.main;
    if (fault === "publication-ref") f.publication.sourceBranch += "-moved";
    if (fault === "publication-number") f.publication.number++;
    if (fault === "publication-url") f.publication.url += "0";
    if (fault === "later-attempt")
      await mkdir(resolve(f.runState, `${KEY.toLowerCase()}-attempt-3`));
    if (fault === "later-terminal")
      await f.put(f.runState, "cycle-12-stop-1", {
        selection: f.terminalSelection,
        reason: "continuation-failed",
        attempts: 2,
        history: f.history,
      });
    if (fault === "old-admission") await writeFile(f.reservation, JSON.stringify({ binding: {} }));
    const selection =
      fault === "old-pin" ? { ...f.selected, base: f.main, planningRevision: f.main } : f.selected;
    await expect(f.compose(f.loop, f.observe, selection)).rejects.toMatchObject({
      reason: "terminal-attempt-admission-mismatch",
    });
    if (fault !== "old-admission")
      await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(f.loop.worktreeRoot)).not.toContain(
      `${KEY.toLowerCase()}-attempt-3-source`,
    );
  },
);

it.each([1, 2, 4])("ISS-215 rejects absolute successor %i", async (number) => {
  const f = await terminalAdmissionFixture();
  Object.assign(f.packet, { nextAbsoluteAttempt: number });
  await expect(f.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
});

// A queue adapter for steps that must stop before any setup, launch or delivery.
function inertAdapter(
  f: Awaited<ReturnType<typeof terminalAdmissionFixture>>,
  queue: Awaited<ReturnType<typeof queueConfigFromLoop>>,
) {
  const refuse = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} must not run`);
  };
  const setup: SetupAdapter = {
    assertExecutor: refuse("setup"),
    observeWorktree: refuse("setup"),
    createWorktree: refuse("setup"),
    observeDependencies: refuse("setup"),
    installDependencies: refuse("setup"),
  };
  return repositoryQueueAdapter(queue, f.repository, {
    native: { launch: refuse("launch"), preflight: refuse("preflight") } as unknown as Adapter,
    setup,
    gitExecutable: f.gitExecutable,
    repository: f.policy,
    async assertExecutor() {},
    deliveryPolicy: { plan: refuse("delivery") },
  });
}

// AC1: each named non-authority input varies alone against the same retained state,
// with no declaration. Only the persisted claim and terminal lineage refuse.
it("ISS-215 no authority: a ready label through production selection retains the claim refusal", async () => {
  const f = await terminalAdmissionFixture();
  await completeTerminalCycles(f);
  const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
  const comments: string[] = [];
  let ready = true;
  const supervisor: SupervisionAdapter = {
    async currentMain() {
      return f.selected.base;
    },
    async issue() {
      return { state: "OPEN", key: KEY, labels: ready ? ["ready"] : [], comments };
    },
    async removeReady() {
      ready = false;
    },
    async close() {
      throw new Error("no issue closure");
    },
    async comment(_config, _number, body) {
      comments.push(body);
    },
  };
  const repository: RepositoryAdapter = {
    ...f.policy,
    selectCandidates: () => (ready ? [{ key: KEY, number: NUMBER }] : []),
    park: () => {
      ready = false;
      return "synthetic planning repair required";
    },
  };
  const selected = await nextCycle(loop, f.repository, supervisor, repository);
  expect(selected?.selection).toEqual({ ...f.selected, cycle: 12 });
  await persistCycle(loop, selected!);
  await expect(f.compose(loop)).rejects.toMatchObject({
    reason: "integration-continuation-required",
  });
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  // The claim refusal is a host stop: the label survives and nothing parks.
  expect(
    await stopCycle(
      loop,
      selected!,
      "integration-continuation-required",
      2,
      supervisor,
      repository,
    ),
  ).toBe("run");
  expect(ready).toBe(true);
  expect(comments).toHaveLength(1);
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-3`);
  await f.unchanged();
});

it("ISS-215 no authority: the consumed integration packet alone replays attempt 2 as terminal", async () => {
  const f = await terminalAdmissionFixture();
  const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
  const queue = await f.compose({ ...loop, integrationContinuation: f.oldPacket });
  const item = queue.items[0]!;
  expect(item.implementationAttempt).toBe(2);
  expect(item.integrationContinuation).toMatchObject({ reviewId: f.reviewId });
  expect(item.terminalAttemptAdmission).toBeUndefined();
  expect(queue.stateDirectory).toBe(f.old.stateDirectory);
  await expect(queueStep(queue, inertAdapter(f, queue))).rejects.toMatchObject({
    reason: "continuation-failed",
  });
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-3`);
  await f.unchanged();
});

it("ISS-215 no authority: a renewed spent resolution alone is already consumed; its replay stays terminal", async () => {
  const f = await terminalAdmissionFixture();
  const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
  const spent = f.spentPacket.spentResolution!;
  const renewed: IntegrationContinuation = {
    ...f.spentPacket,
    spentResolution: {
      ...spent,
      authorityUrl: "https://github.com/fixture/authority/issues/1#issuecomment-3",
      authorityBody: `${spent.authorityBody} Synthetic renewal after the terminal stop.`,
    },
  };
  let observations = 0;
  await expect(
    f.compose({ ...loop, integrationContinuation: renewed }, async () => {
      observations++;
      throw new Error("renewed authority must not be observed");
    }),
  ).rejects.toMatchObject({ reason: "integration-continuation-already-consumed" });
  expect(observations).toBe(0);
  const queue = await f.compose({ ...loop, integrationContinuation: f.spentPacket }, async () => {
    throw new Error("consumed authority must not be observed again");
  });
  expect(queue.items[0]!.implementationAttempt).toBe(2);
  expect(queue.stateDirectory).toBe(f.terminalDirectory);
  await expect(queueStep(queue, inertAdapter(f, queue))).rejects.toMatchObject({
    reason: "continuation-failed",
  });
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-3`);
  await f.unchanged();
});

it("ISS-215 no authority: an unused reviewer-only grant alone retains the claim refusal", async () => {
  const f = await terminalAdmissionFixture();
  const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
  await f.put(f.terminalDirectory, "refresh-review-grant", {
    unused: true,
    authority: "synthetic old reviewer-only grant",
  });
  await expect(f.compose(loop)).rejects.toMatchObject({
    reason: "integration-continuation-required",
  });
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  await f.unchanged();
});

it.each([4, 3])(
  "ISS-215 no authority: attempt headroom under ceiling %i alone retains the claim refusal",
  async (attemptCeiling) => {
    const f = await terminalAdmissionFixture();
    const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
    // Two consumed attempts leave headroom under either ceiling; neither reaches the
    // ordinary failed-attempt advancement or the ceiling stop.
    await expect(f.compose({ ...loop, attemptCeiling })).rejects.toMatchObject({
      reason: "integration-continuation-required",
    });
    expect(f.calls).toEqual([]);
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-3`);
    await f.unchanged();
  },
);

async function completeTerminalCycles(f: Awaited<ReturnType<typeof terminalAdmissionFixture>>) {
  // Fill synthetic intervening completed cycles so the real caller selects cycle 12.
  for (let cycle = 1; cycle <= 11; cycle++) {
    const path = resolve(f.runState, `cycle-${cycle}-selected.json`);
    const selection = await readFile(path, "utf8")
      .then(JSON.parse)
      .catch(() =>
        cycle === 11
          ? f.terminalSelection
          : { cycle, key: `SYNTHETIC-${cycle}`, number: 9100 + cycle, base: f.main },
      );
    if (cycle > 3) await f.put(f.runState, `cycle-${cycle}-selected`, selection);
    if (cycle !== 3)
      await f.put(f.runState, `cycle-${cycle}-complete`, {
        selection,
        history: cycle < 3 ? f.history.slice(0, 5) : f.history,
      });
  }
}

it("ISS-215 production supervision retries an unavailable admission and parks successor failure without selecting attempt 4", async () => {
  const f = await terminalAdmissionFixture();
  await completeTerminalCycles(f);
  const comments: string[] = [];
  let parked = false;
  const supervisor: SupervisionAdapter = {
    async currentMain() {
      return f.selected.base;
    },
    async issue() {
      return { state: "OPEN", key: KEY, labels: parked ? [] : ["ready"], comments };
    },
    async removeReady() {},
    async close() {
      throw new Error("no issue closure");
    },
    async comment(_config, _number, body) {
      comments.push(body);
    },
  };
  const repository: RepositoryAdapter = {
    ...f.policy,
    selectCandidates: () => (parked ? [] : [{ key: KEY, number: NUMBER }]),
    park: () => {
      parked = true;
      return "synthetic planning repair required";
    },
  };
  const selected = await nextCycle(f.loop, f.repository, supervisor, repository);
  expect(selected?.selection).toEqual({ ...f.selected, cycle: 12 });
  expect(selected?.initialHistory).toEqual(f.history);
  await persistCycle(f.loop, selected!);
  await expect(
    f.compose(f.loop, async () => {
      throw new Error("synthetic unavailable authority");
    }),
  ).rejects.toMatchObject({ reason: "terminal-attempt-admission-authority-unavailable" });
  expect(
    await stopCycle(
      f.loop,
      selected!,
      "terminal-attempt-admission-authority-unavailable",
      2,
      supervisor,
      repository,
    ),
  ).toBe("run");
  expect(parked).toBe(false);
  const restarted = await nextCycle(f.loop, f.repository, supervisor, repository);
  expect(restarted).toEqual(selected);
  expect(await reconcilePendingStop(f.loop, restarted!, supervisor, repository)).toBeUndefined();
  const queue = await f.compose();
  expect(queue.items[0]!.implementationAttempt).toBe(3);
  expect(
    await stopCycle(f.loop, restarted!, "continuation-failed", 3, supervisor, repository),
  ).toBe("item");
  expect(await nextCycle(f.loop, f.repository, supervisor, repository)).toBeUndefined();
  expect(await nextCycle(f.loop, f.repository, supervisor, repository)).toBeUndefined();
  expect(comments).toHaveLength(2);
  expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
});

it("ISS-215 real supervisor command retains attempt 2 on unavailable admission, resumes once and parks attempt 3", async () => {
  const f = await terminalAdmissionFixture();
  await completeTerminalCycles(f);
  const entry = resolve(f.repository, "scripts/dogfood/supervise.mjs");
  await mkdir(resolve(entry, ".."), { recursive: true });
  await writeFile(
    entry,
    await readFile(resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs")),
  );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic canonical supervisor"]);
  const request = resolve(f.root, "loop.json");
  const controls = resolve(f.root, "command-controls.json");
  await writeFile(request, JSON.stringify(f.loop));
  await writeFile(
    controls,
    JSON.stringify({
      number: NUMBER,
      key: KEY,
      ready: true,
      comments: [],
      launches: [],
      observations: [],
      unavailable: true,
      authority: f.authority,
      receipt: f.receipt,
      publication: f.publication,
    }),
  );
  const retained = await snapshot(f.runState);
  let invocation = 0;
  const invoke = async () => {
    const outputPath = resolve(f.root, `command-${++invocation}.log`);
    const output = await open(outputPath, "wx");
    let code: number | null;
    try {
      code = await new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(resolve(import.meta.dirname, "supervise-fixtures/terminal-admission.mjs"))
              .href,
            entry,
            request,
          ],
          {
            env: { ...process.env, TERMINAL_ADMISSION_FIXTURE: controls },
            stdio: ["ignore", output.fd, output.fd],
          },
        );
        child.on("error", reject);
        child.on("close", done);
      });
    } finally {
      await output.close();
    }
    return { code, output: await readFile(outputPath, "utf8") };
  };
  const unavailable = await invoke();
  expect(unavailable.code).toBe(1);
  expect(unavailable.output).toContain(
    '"reason":"terminal-attempt-admission-authority-unavailable"',
  );
  const refused = JSON.parse(await readFile(resolve(f.runState, "cycle-12-stop-1.json"), "utf8"));
  expect(refused).toMatchObject({ attempts: 2, history: f.history });
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  const control = JSON.parse(await readFile(controls, "utf8"));
  expect(control.launches).toEqual([]);
  expect(control.ready).toBe(true);
  await writeFile(controls, JSON.stringify({ ...control, unavailable: false }));
  const admitted = await invoke();
  expect(admitted.code, admitted.output).toBe(0);
  expect(admitted.output).toContain('"status":"idle"');
  const parked = JSON.parse(await readFile(resolve(f.runState, "cycle-12-stop-2.json"), "utf8"));
  expect(parked).toMatchObject({ reason: "continuation-failed", attempts: 3 });
  expect(parked.history.slice(0, 26)).toEqual(f.history);
  expect(parked.history).toHaveLength(27);
  const done = JSON.parse(await readFile(controls, "utf8"));
  expect(done.launches).toEqual(["author"]);
  expect(done.ready).toBe(false);
  const reservation = await readFile(f.reservation, "utf8");
  const after = await snapshot(f.runState);
  expect((await invoke()).code).toBe(0);
  expect(await readFile(controls, "utf8")).toBe(JSON.stringify(done));
  expect(await snapshot(f.runState)).toEqual(after);
  expect(await readFile(f.reservation, "utf8")).toBe(reservation);
  for (const [path, bytes] of retained) expect(after.get(path), path).toBe(bytes);
  await f.unchanged();
});

it("ISS-215 real supervisor command: interruption after reservation, then a changed configuration parks attempt 3 without a launch", async () => {
  const f = await terminalAdmissionFixture();
  await completeTerminalCycles(f);
  const entry = resolve(f.repository, "scripts/dogfood/supervise.mjs");
  await mkdir(resolve(entry, ".."), { recursive: true });
  await writeFile(
    entry,
    await readFile(resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs")),
  );
  await f.git(["add", "."]);
  await f.git(["commit", "-m", "synthetic canonical supervisor"]);
  const request = resolve(f.root, "loop.json");
  const controls = resolve(f.root, "command-controls.json");
  await writeFile(request, JSON.stringify(f.loop));
  await writeFile(
    controls,
    JSON.stringify({
      number: NUMBER,
      key: KEY,
      ready: true,
      comments: [],
      launches: [],
      observations: [],
      unavailable: false,
      interrupt: true,
      authority: f.authority,
      receipt: f.receipt,
      publication: f.publication,
    }),
  );
  const retained = await snapshot(f.runState);
  let invocation = 0;
  const invoke = async () => {
    const outputPath = resolve(f.root, `command-${++invocation}.log`);
    const output = await open(outputPath, "wx");
    let code: number | null;
    try {
      code = await new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(resolve(import.meta.dirname, "supervise-fixtures/terminal-admission.mjs"))
              .href,
            entry,
            request,
          ],
          {
            env: { ...process.env, TERMINAL_ADMISSION_FIXTURE: controls },
            stdio: ["ignore", output.fd, output.fd],
          },
        );
        child.on("error", reject);
        child.on("close", done);
      });
    } finally {
      await output.close();
    }
    return { code, output: await readFile(outputPath, "utf8") };
  };
  const interrupted = await invoke();
  expect(interrupted.code).toBe(1);
  expect(interrupted.output).toContain('"reason":"queue-internal-error"');
  const reservation = await readFile(f.reservation, "utf8");
  const control = JSON.parse(await readFile(controls, "utf8"));
  expect(control.launches).toEqual([]);
  expect(control.observations).toHaveLength(2);
  expect(control.ready).toBe(true);
  // The host changes the configuration after the successor was reserved.
  await writeFile(controls, JSON.stringify({ ...control, interrupt: false }));
  await writeFile(
    request,
    JSON.stringify({ ...f.loop, worktreeRoot: resolve(f.root, "renamed-worktrees") }),
  );
  const mismatched = await invoke();
  expect(mismatched.code, mismatched.output).toBe(0);
  expect(mismatched.output).toContain('"status":"idle"');
  const parked = JSON.parse(await readFile(resolve(f.runState, "cycle-12-stop-2.json"), "utf8"));
  expect(parked).toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
    attempts: 3,
    history: f.history,
  });
  const done = JSON.parse(await readFile(controls, "utf8"));
  expect(done.launches).toEqual([]);
  expect(done.observations).toHaveLength(2);
  expect(done.ready).toBe(false);
  expect(await readFile(f.reservation, "utf8")).toBe(reservation);
  for (const [path, bytes] of retained) expect(await readFile(path, "utf8"), path).toBe(bytes);
  await f.unchanged();
});

it("ISS-215 local record I/O failure during admission is a host error that spends nothing", async () => {
  const f = await terminalAdmissionFixture();
  // Replace the claim file by a directory of the same name: an unreadable record, not a
  // contradiction. Restore it byte for byte afterwards.
  const moved = `${f.claimPath}.moved`;
  await rename(f.claimPath, moved);
  await mkdir(f.claimPath);
  await expect(f.compose()).rejects.toSatisfy(
    (error: unknown) =>
      !(error instanceof QueueBlocked) && typeof (error as NodeJS.ErrnoException).code === "string",
  );
  expect(f.calls).toEqual([]);
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  await rm(f.claimPath, { recursive: true });
  await rename(moved, f.claimPath);
  const queue = await f.compose();
  expect(queue.items[0]!.implementationAttempt).toBe(3);
  expect(f.calls).toHaveLength(3);
  await f.unchanged();
});

it.each(["acceptedReplan", "integrationContinuation", "gateStopAuthorization"])(
  "ISS-215 rejects coexistence with %s",
  async (field) => {
    const f = await terminalAdmissionFixture();
    const packets = {
      integrationContinuation: f.oldPacket,
      gateStopAuthorization: {
        stateDirectory: resolve(f.terminalDirectory, "source"),
        candidateHead: f.reviewed,
        repairSha: f.selected.base,
        authorityUrl: f.packet.authorityUrl,
      },
      acceptedReplan: {
        schemaVersion: "dogfood-accepted-replan/v1",
        repository: f.loop.repository,
        issueKey: KEY,
        issueUrl: ISSUE,
        priorRun: "synthetic-prior-run",
        priorAttemptDirectory: resolve(
          f.loop.stateRoot,
          "synthetic-prior-run",
          `${KEY.toLowerCase()}-attempt-4`,
        ),
        priorAbsoluteAttempt: 4,
        priorHistoryDigest: "a".repeat(64),
        candidateHead: f.reviewed,
        targetRun: RUN,
        attemptSlug: `${KEY.toLowerCase()}-attempt-5`,
        nextAbsoluteAttempt: 5,
        absoluteCeiling: 5,
        authorityUrl: f.packet.authorityUrl,
        scope: "Synthetic accepted correction",
        allowedPaths: ["docs/loop.md"],
        publication: null,
        preReviewEvidence: null,
      },
    };
    const other = packets[field as keyof typeof packets];
    const { terminalAttemptAdmission: omitted, ...without } = f.loop;
    expect(() => validateLoopConfig({ ...without, [field]: other })).not.toThrow();
    expect(() => validateLoopConfig({ ...f.loop, [field]: other })).toThrow(
      "terminal-attempt-admission-mismatch",
    );
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("ISS-215 unavailable admission is retryable without spending; intervening attempt makes unchanged delegation stale", async () => {
  const f = await terminalAdmissionFixture();
  const unavailable = async () => {
    throw new Error("synthetic transport unavailable");
  };
  await expect(f.compose(f.loop, unavailable)).rejects.toMatchObject({
    reason: "terminal-attempt-admission-authority-unavailable",
  });
  await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
  await f.put(f.runState, "cycle-12-stop-1", {
    selection: f.selected,
    reason: "terminal-attempt-admission-authority-unavailable",
    attempts: 2,
    history: f.history,
  });
  const queue = await f.compose();
  expect(queue.items[0]!.implementationAttempt).toBe(3);
  const other = await terminalAdmissionFixture();
  await expect(other.compose(other.loop, unavailable)).rejects.toMatchObject({
    reason: "terminal-attempt-admission-authority-unavailable",
  });
  await mkdir(resolve(other.runState, `${KEY.toLowerCase()}-attempt-3`));
  await expect(other.compose()).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
});

it("ISS-215 cannot renew accounting with a new run, worktree root or removed declaration", async () => {
  const f = await terminalAdmissionFixture();
  await f.compose();
  await expect(f.compose({ ...f.loop, run: "synthetic-renamed-run" })).rejects.toMatchObject({
    reason: "terminal-attempt-admission-mismatch",
  });
  await expect(
    f.compose({ ...f.loop, worktreeRoot: resolve(f.root, "new-worktrees") }),
  ).rejects.toMatchObject({ reason: "terminal-attempt-admission-mismatch" });
  const { terminalAttemptAdmission: omitted, ...without } = f.loop;
  await expect(
    f.compose({ ...without, run: "synthetic-renamed-run" } as typeof f.loop),
  ).rejects.toMatchObject({ reason: "integration-continuation-required" });
  await f.unchanged();
});

it.each(["pass", "author-fail", "review-fail", "host-unknown", "dead", "gate-fail", "conflict"])(
  "ISS-215 ordinary native lifecycle and restarted caller: %s",
  async (mode) => {
    const f = await terminalAdmissionFixture();
    const q = await f.compose();
    const reservation = await readFile(f.reservation, "utf8");
    const item = q.items[0]!;
    const launches: string[] = [];
    const effects: string[] = [];
    let waiting = true;
    let unknown = mode === "host-unknown";
    const setup = gitSetupAdapter({
      gitExecutable: f.gitExecutable,
      async install(_launcher, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
        return "succeeded";
      },
    });
    const native: Adapter = {
      async preflight() {},
      git: (cwd, args) => f.git(args, cwd),
      async launch(role, config, prompt) {
        launches.push(role);
        expect(config.worktree).toBe(item.source.worktree);
        expect(prompt).toContain("Synthetic repaired current-main brief");
        expect(prompt).not.toContain("Apply these reviewer-prescribed fixes");
        if (role === "author") {
          expect(await f.git(["rev-parse", "HEAD"], config.worktree)).toBe(f.selected.base);
          await appendFile(
            resolve(config.worktree, "docs/loop.md"),
            "\nSynthetic attempt-three implementation.\n",
          );
        }
        const trace = resolve(config.stateDirectory, `${role}.jsonl`);
        await writeFile(trace, "synthetic execution evidence\n");
        return { id: randomUUID(), pid: launches.length, trace, launchedAt: 1 };
      },
      async observe(role, config, attempt) {
        if (waiting) return { id: attempt.id, status: "running" };
        if (mode === "dead")
          return {
            id: attempt.id,
            status: "dead",
            summary: "Synthetic death with consumed retry.",
          };
        if (unknown) {
          unknown = false;
          throw new QueueBlocked("provider-unavailable");
        }
        const fail = mode === `${role === "reviewer" ? "review" : role}-fail`;
        const head =
          role === "author" ? config.base : await f.git(["rev-parse", "HEAD"], config.worktree);
        if (mode === "conflict" && role === "reviewer")
          await f.advanceMain(
            "docs/loop.md",
            `${await readFile(resolve(f.repository, "docs/loop.md"), "utf8")}\nSynthetic conflicting main.\n`,
          );
        return {
          id: attempt.id,
          status: fail ? "failed" : "passed",
          head,
          summary:
            role === "author"
              ? ""
              : JSON.stringify({
                  run: RUN,
                  role,
                  head,
                  verdict: fail ? "FAIL" : "PASS",
                  findings: fail
                    ? [
                        {
                          file: "docs/loop.md",
                          line: 5,
                          severity: "blocking",
                          text: "Synthetic source rejection.",
                        },
                      ]
                    : [],
                  g0: "No; this is the synthetic smallest implementation.",
                }),
        };
      },
      async checks() {
        throw new Error("source must not publish");
      },
    };
    const delivery = githubDeliveryAdapter();
    delivery.verifyWorkspace = async (config, head) =>
      (await f.git(["rev-parse", "HEAD"], config.worktree)) === head;
    delivery.runGate = async (config, name, head) => {
      effects.push(`gate:${name}`);
      if (mode === "gate-fail" && name === "test")
        return {
          status: "failed",
          output: "synthetic assertion",
          evidence: {
            head,
            log: resolve(config.stateDirectory, "candidate.log"),
            cause: "diagnostic",
            diagnostics: ["docs/loop.md:5: synthetic assertion"],
            command: { executable: process.execPath, argv: ["synthetic"], cwd: config.worktree },
          },
        };
      return "passed";
    };
    delivery.attributeGate = async (config, _name, _evidence, main) => ({
      cause: "candidate",
      main,
      log: resolve(config.stateDirectory, "synthetic-control.log"),
    });
    let publishedHead = "";
    let merged = false;
    let cleaned = false;
    delivery.observePublication = async (config, plan, planDigest) =>
      publishedHead
        ? {
            state: "confirmed",
            value: {
              number: 9006,
              url: "https://github.com/fixture/repository/pull/9006",
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
    delivery.publish = async (config, plan) => {
      expect(config.refresh).toBeUndefined();
      expect(plan.sourceBranch).toBe(`codex/${KEY.toLowerCase()}-attempt-3`);
      effects.push("publish-new");
      publishedHead = config.candidateHead;
      throw new Error("synthetic lost publication response");
    };
    delivery.checks = async (config, publication) => {
      expect(publication.number).toBe(9006);
      return {
        head: publishedHead,
        checks: config.requiredChecks.map((name) => ({
          name,
          bucket: "pass",
          link: "https://example.test/synthetic-check",
        })),
      };
    };
    delivery.observeMerge = async () =>
      merged
        ? {
            state: "confirmed",
            value: { number: 9006, head: publishedHead, mergeCommit: "e".repeat(40) },
          }
        : { state: "needs-mutation" };
    delivery.merge = async () => {
      effects.push("merge-new");
      merged = true;
      throw new Error("synthetic lost merge response");
    };
    delivery.observeCleanup = async (_config, plan) =>
      cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
    delivery.cleanup = async () => {
      effects.push("cleanup-new");
      cleaned = true;
    };
    const adapter = (queue = q) =>
      repositoryQueueAdapter(queue, f.repository, {
        native,
        setup,
        delivery,
        gitExecutable: f.gitExecutable,
        repository: f.policy,
        async assertExecutor() {},
        deliveryPolicy: {
          async plan(config) {
            return {
              gates: { beforeMirror: ["typecheck", "format:check", "test"], afterMirror: [] },
              drafts: [],
              publication: {
                sourceBranch: `codex/${KEY.toLowerCase()}-attempt-3`,
                baseBranch: "main",
                title: "Synthetic new publication",
                body: "Synthetic acceptance",
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
    await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "observing-author" });
    expect(launches).toEqual(["author"]);
    const resumed = await f.compose();
    await expect(queueStep(resumed, adapter(resumed))).resolves.toMatchObject({
      status: "observing-author",
    });
    expect(launches).toEqual(["author"]);
    waiting = false;
    if (mode === "host-unknown")
      await expect(queueStep(resumed, adapter(resumed))).rejects.toMatchObject({
        reason: "provider-unavailable",
      });
    if (mode.endsWith("fail") || mode === "dead" || mode === "conflict") {
      await expect(queueStep(resumed, adapter(resumed))).rejects.toMatchObject({
        reason: "continuation-failed",
      });
      const failed = await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8");
      for (let replay = 0; replay < 2; replay++) {
        const again = await f.compose();
        await expect(queueStep(again, adapter(again))).rejects.toMatchObject({
          reason: "continuation-failed",
        });
      }
      expect(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8")).toBe(failed);
      if (mode === "gate-fail")
        expect(effects).toEqual(["gate:typecheck", "gate:format:check", "gate:test"]);
      else expect(effects).toEqual([]);
    } else {
      await expect(queueStep(resumed, adapter(resumed))).resolves.toMatchObject({
        status: "complete",
        participants: 28,
      });
      const before = [...effects];
      for (let replay = 0; replay < 2; replay++) {
        const again = await f.compose();
        await expect(queueStep(again, adapter(again))).resolves.toMatchObject({
          status: "complete",
          participants: 28,
        });
      }
      expect(effects).toEqual(before);
      expect(effects.filter((effect) => effect === "publish-new")).toHaveLength(1);
    }
    expect(launches).toEqual(
      mode === "author-fail" || mode === "dead" ? ["author"] : ["author", "reviewer"],
    );
    expect(await readdir(f.runState)).not.toContain(`${KEY.toLowerCase()}-attempt-4`);
    expect((await adapter().history()).slice(0, 26)).toEqual(f.history);
    expect(f.calls).toHaveLength(3);
    expect(await readFile(f.reservation, "utf8")).toBe(reservation);
    await f.unchanged();
  },
);

async function spentFixture(spentRetry = false, autocrlf = false) {
  const f = await exhaustedFixture("overlap", spentRetry, autocrlf);
  const old = await f.compose(); // Original ISS-167 claim remains byte-identical.
  const item = old.items[0]!;
  await f.git(["worktree", "add", "-b", item.setup.sourceBranch, item.source.worktree, f.reviewed]);
  await f
    .git(
      ["-c", "merge.conflictStyle=merge", "merge", "--no-commit", "--no-ff", f.main],
      item.source.worktree,
    )
    .catch(() => {});
  const files = {
    "docs/loop.md": await readFile(resolve(item.source.worktree, "docs/loop.md"), "utf8"),
  };
  await f.git(["add", "--all"], item.source.worktree);
  await f.git(["commit", "-m", "synthetic retained conflict seed"], item.source.worktree);
  const seed = await f.git(["rev-parse", "HEAD"], item.source.worktree);
  const failedDirectory = resolve(item.source.stateDirectory, `refresh-${f.main}`);
  await mkdir(failedDirectory, { recursive: true });
  const failedAuthor = { ...participant(8, "ISS-104:2", "refresh", "author", "failed"), rung: 1 };
  const later = [...f.later, failedAuthor];
  const attempt = JSON.parse(await readFile(resolve(f.attemptDirectory, "attempt.json"), "utf8"));
  await f.put(old.stateDirectory, "attempt", {
    ...attempt,
    base: f.reviewed,
    history: later,
    authorFailures: { count: 2, ids: [f.history[2]!.id, failedAuthor.id] },
  });
  for (const p of later) await f.put(old.stateDirectory, `participant-${p.ordinal}-terminal`, p);
  await f.put(item.source.stateDirectory, "native-refresh", {
    main: f.main,
    previousHead: f.reviewed,
    previousReview: f.reviewId,
    previousDirectory: f.sourceDirectory,
    directory: failedDirectory,
    flowRetried: spentRetry,
    retries: spentRetry ? 1 : 0,
    resolutionUsed: true,
    conflict: { files, seed },
  });
  await f.put(failedDirectory, "config", {
    config: { ...item.source, base: seed, mainBase: f.main, stateDirectory: failedDirectory },
  });
  await f.put(failedDirectory, "author-attempt", {
    id: failedAuthor.id,
    pid: 8,
    launchedAt: 8,
    trace: resolve(failedDirectory, "author.jsonl"),
    placement: SELF_ROUTING.author[1],
    rung: 1,
    retries: spentRetry ? 1 : 0,
  });
  await f.put(failedDirectory, "author-terminal", {
    id: failedAuthor.id,
    head: seed,
    status: "failed",
    summary: "Need unmarked preservation.",
  });
  await writeFile(resolve(failedDirectory, "author.jsonl"), "synthetic failed author execution\n");
  // Preserve dirty partial work; the next workspace must start from S instead.
  await writeFile(resolve(item.source.worktree, "overlap.txt"), "failed partial work\n");
  const stopMarker = `loop-stop:${RUN}:4:1`;
  const selection = { cycle: 4, key: KEY, number: NUMBER, base: f.main };
  await f.put(f.runState, "cycle-4-selected", selection);
  await f.put(f.runState, "cycle-4-stop-1", {
    selection,
    stop: 1,
    reason: "continuation-failed",
    attempts: 2,
    history: later,
    marker: stopMarker,
    body: "Synthetic failed conflict author.",
  });
  await f.put(f.runState, "cycle-4-stop-1-complete", { selection, stop: 1, history: later });
  const claim = resolve(
    f.loop.stateRoot,
    `integration-continuation-${createHash("sha256")
      .update(JSON.stringify({ repository: f.loop.repository, issue: KEY }))
      .digest("hex")}.json`,
  );
  const packet: IntegrationContinuation = {
    ...f.packet,
    spentResolution: {
      claim,
      stopMarker,
      failedAuthor: failedAuthor.id,
      main: f.main,
      seed,
      authorityUrl: "https://github.com/fixture/authority/issues/1#issuecomment-2",
      authorityBody:
        "Synthetic grant. docs/loop.md: Retain reviewed feature and main in K. overlap.txt: Preserve both endpoint edits in U.",
      resolutions: [{ path: "docs/loop.md", semantics: "Retain reviewed feature and main in K." }],
      preservation: [{ path: "overlap.txt", semantics: "Preserve both endpoint edits in U." }],
    },
  };
  let observations = 0;
  const authority = async () => {
    observations++;
    return {
      id: "2",
      url: packet.spentResolution!.authorityUrl,
      author: "todd-skelton",
      body: packet.spentResolution!.authorityBody,
      capturedAt: "2026-09-23T04:00:00.000Z",
    };
  };
  const retained = await snapshot(old.stateDirectory);
  const oldClaim = await readFile(claim, "utf8");
  const compose = (
    config: LoopConfig = { ...f.loop, integrationContinuation: packet },
    prior = later,
    observe = authority,
  ) =>
    queueConfigFromLoop(
      config,
      f.repository,
      { key: KEY, number: NUMBER, base: f.main },
      f.policy,
      prior,
      undefined,
      observe,
    );
  return {
    ...f,
    packet,
    later,
    compose,
    seed,
    failedDirectory,
    old,
    observations: () => observations,
    unchanged: async () => {
      await f.unchanged();
      for (const [path, bytes] of retained) expect(await readFile(path, "utf8")).toBe(bytes);
      expect(await readFile(claim, "utf8")).toBe(oldClaim);
      expect(await f.git(["rev-parse", "HEAD"], item.source.worktree)).toBe(seed);
      expect(await readFile(resolve(item.source.worktree, "overlap.txt"), "utf8")).toBe(
        "failed partial work\n",
      );
    },
  };
}

it.each([
  "absent-authority",
  "foreign-authority",
  "changed-body",
  "wrong-claim",
  "missing-claim",
  "wrong-author",
  "wrong-seed",
  "wrong-main",
  "wrong-stop",
  "missing-stop-receipt",
  "wrong-review",
  "nonfailed",
  "in-flight",
  "source-nonpass",
  "publication",
  "publication-intent",
  "wrong-run",
  "changed-original-ruling",
  "missing-config",
  "wrong-captured-k",
])("spent admission refuses one changed input before reservation: %s", async (fault) => {
  const f = await spentFixture();
  const packet = structuredClone(f.packet);
  let observe = async () => ({
    id: "2",
    url: packet.spentResolution!.authorityUrl,
    author: "todd-skelton",
    body: packet.spentResolution!.authorityBody,
    capturedAt: "2026-09-23T04:00:00.000Z",
  });
  const restores: (() => Promise<void>)[] = [];
  const change = async (directory: string, name: string, update: (value: any) => any) => {
    const path = resolve(directory, `${name}.json`);
    const bytes = await readFile(path, "utf8").catch(() => undefined);
    restores.push(async () => {
      if (bytes === undefined) await rm(path);
      else await writeFile(path, bytes);
    });
    const value = update(bytes === undefined ? undefined : JSON.parse(bytes));
    if (value === undefined) await rm(path);
    else await f.put(directory, name, value);
  };
  switch (fault) {
    case "absent-authority":
      observe = async () => {
        throw new Error("unavailable");
      };
      break;
    case "foreign-authority": {
      const original = observe;
      observe = async () => ({ ...(await original()), author: "someone-else" });
      break;
    }
    case "changed-body": {
      const original = observe;
      observe = async () => ({ ...(await original()), body: "not the ruling" });
      break;
    }
    case "wrong-claim":
      packet.spentResolution!.claim += "-other";
      break;
    case "missing-claim": {
      const path = packet.spentResolution!.claim;
      const bytes = await readFile(path, "utf8");
      await rm(path);
      restores.push(() => writeFile(path, bytes));
      break;
    }
    case "wrong-author":
      packet.spentResolution!.failedAuthor = randomUUID();
      break;
    case "wrong-seed":
      packet.spentResolution!.seed = f.reviewed;
      break;
    case "wrong-main":
      packet.spentResolution!.main = f.base;
      break;
    case "wrong-stop":
      packet.spentResolution!.stopMarker = `loop-stop:${RUN}:5:1`;
      break;
    case "missing-stop-receipt":
      await change(f.runState, "cycle-4-stop-1-complete", () => undefined);
      break;
    case "wrong-review":
      packet.reviewId = randomUUID();
      break;
    case "nonfailed":
      await change(f.failedDirectory, "author-terminal", (v) => ({ ...v, status: "passed" }));
      break;
    case "in-flight":
      await change(f.failedDirectory, "author-terminal", () => undefined);
      break;
    case "source-nonpass":
      await change(f.sourceDirectory, "author-terminal", (v) => ({ ...v, status: "failed" }));
      break;
    case "publication":
    case "publication-intent":
      await change(f.failedDirectory, fault, () => ({ head: f.seed }));
      break;
    case "wrong-run":
      packet.run = "foreign-run";
      break;
    case "changed-original-ruling":
      packet.authorityUrl += "1";
      break;
    case "missing-config":
      await change(f.failedDirectory, "config", () => undefined);
      break;
    case "wrong-captured-k":
      packet.spentResolution!.resolutions[0]!.path = "other.txt";
      break;
  }
  await expect(
    f.compose({ ...f.loop, integrationContinuation: packet }, f.later, observe),
  ).rejects.toThrow();
  const reservation = resolve(f.old.stateDirectory, "spent-resolution.json");
  await expect(readFile(reservation)).rejects.toMatchObject({ code: "ENOENT" });
  for (const restore of restores) await restore();
  // A matched positive control differs only in the input under test.
  const q = await f.compose();
  expect(q.items[0]!.base).toBe(f.seed);
  expect(q.items[0]!.source.authorFailures).toMatchObject({ count: 2 });
  expect(q.initialHistory).toEqual(f.later);
  const reserved = JSON.parse(await readFile(reservation, "utf8"));
  expect(reserved.authority).toMatchObject({
    author: "todd-skelton",
    body: f.packet.spentResolution!.authorityBody,
  });
  expect(await f.compose()).toEqual(q);
  expect(f.observations()).toBe(1);
  await f.unchanged();
});

it("resumes the reservation before setup without reprobe or another spend", async () => {
  const f = await spentFixture(true);
  const q = await f.compose();
  const item = q.items[0]!;
  expect(item.integrationContinuation!.spent!.launchLimit).toBe(2);
  expect(item.source.inheritedWorkerRetry).toBe(true);
  expect(item.source.author.rung).toBe(2);
  await rm(resolve(f.old.stateDirectory, "spent-resolution"), { recursive: true });
  expect(await f.compose()).toEqual(q);
  for (const field of ["authorityUrl", "authorityBody", "stopMarker"] as const) {
    const packet = structuredClone(f.packet);
    packet.spentResolution![field] += "1";
    await expect(f.compose({ ...f.loop, integrationContinuation: packet })).rejects.toThrow();
  }
  expect(f.observations()).toBe(1);
  await f.unchanged();
});

it("carries later completed cycles even when composition is called without supervisor history", async () => {
  const f = await spentFixture();
  const later = [
    ...f.later,
    participant(9, "ISS-107:1", "source", "author", "passed"),
    participant(10, "ISS-107:1", "source", "reviewer", "passed"),
  ];
  await f.put(f.runState, "cycle-5-complete", {
    selection: { cycle: 5, key: "ISS-107", number: 364, base: f.main },
    history: later,
  });
  const q = await f.compose({ ...f.loop, integrationContinuation: f.packet }, []);
  expect(q.initialHistory).toEqual(later);
  expect(q.nativeLaunchCeiling).toBe(f.loop.nativeLaunchCeiling);
  expect(await f.compose()).toEqual(q);
  await f.unchanged();
});

it("resumes saved spent selection, reconciles a lost stop response, and advances unrelated work", async () => {
  const f = await spentFixture();
  const loop = { ...f.loop, integrationContinuation: f.packet };
  let ready = true;
  const comments: string[] = [];
  let lost = false;
  let removeReady = 0;
  const host: SupervisionAdapter = {
    currentMain: async () => f.main,
    issue: async (_config, number) => ({
      state: "OPEN",
      key: number === NUMBER ? KEY : "ISS-107",
      labels: ready ? ["ready"] : [],
      comments,
    }),
    removeReady: async () => {
      ready = false;
      removeReady++;
    },
    close: async () => {
      throw new Error("closing is forbidden");
    },
    comment: async (_config, _number, body) => {
      comments.push(body);
      if (!lost) {
        lost = true;
        throw new Error("lost stop response");
      }
    },
  };
  const policy = {
    ...f.policy,
    park: async () => {
      if (ready) await host.removeReady(loop, NUMBER);
      return "explicit planning unpark";
    },
    selectCandidates: () =>
      ready ? [{ key: KEY, number: NUMBER }] : [{ key: "ISS-107", number: 364 }],
  };
  const cycle = await nextCycle(loop, f.repository, host, policy);
  expect(cycle!.selection.cycle).toBe(5);
  expect(cycle!.initialHistory).toEqual(f.later);
  await persistCycle(loop, cycle!);
  expect(await nextCycle(loop, f.repository, host, policy)).toEqual(cycle);
  const q = await f.compose();
  await expect(stopCycle(loop, cycle!, "continuation-failed", 2, host, policy)).rejects.toThrow(
    "lost stop response",
  );
  await reconcilePendingStop(loop, cycle!, host, policy);
  expect(comments).toHaveLength(1);
  expect(removeReady).toBe(1);
  const next = await nextCycle(loop, f.repository, host, policy);
  expect(next!.selection).toMatchObject({ cycle: 6, key: "ISS-107" });
  const other = await queueConfigFromLoop(
    loop,
    f.repository,
    { key: next!.selection.key, number: next!.selection.number, base: next!.selection.base },
    policy,
    next!.initialHistory,
  );
  expect(other.items[0]!.integrationContinuation).toBeUndefined();
  expect(await f.compose()).toEqual(q);
});

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

it.each(["ordinary", "spent", "removed"])(
  "carries integration launches into external closure: %s",
  async (mode) => {
    const spent = mode !== "ordinary";
    const f = spent ? await spentFixture() : await exhaustedFixture();
    const loop = mode === "removed" ? f.loop : { ...f.loop, integrationContinuation: f.packet };
    const q = await f.compose();
    const launched = [
      ...f.later,
      participant(f.later.length + 1, "ISS-104:2", "refresh", "author", "passed"),
      participant(f.later.length + 2, "ISS-104:2", "refresh", "reviewer", "passed"),
    ];
    for (const p of launched) await f.put(q.stateDirectory, `participant-${p.ordinal}-terminal`, p);
    const cycle = spent ? 5 : 4;
    const selection = { cycle, key: KEY, number: NUMBER, base: f.main };
    await f.put(f.runState, `cycle-${cycle}-selected`, selection);
    const host: SupervisionAdapter = {
      currentMain: async () => f.main,
      issue: async () => ({ state: "CLOSED", key: KEY, labels: [], comments: [] }),
      removeReady: async () => {},
      close: async () => {},
      comment: async () => {},
    };
    expect(await nextCycle(loop, f.repository, host, f.policy)).toBeUndefined();
    expect(
      JSON.parse(await readFile(resolve(f.runState, `cycle-${cycle}-complete.json`), "utf8")),
    ).toEqual({
      selection,
      history: launched,
    });
    expect(await nextCycle(loop, f.repository, host, f.policy)).toBeUndefined();
    await expect(readFile(resolve(q.stateDirectory, "attempt.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await f.unchanged();
  },
);

type Mode =
  | "published-allowance"
  | "published-allowance-declaration-faults"
  | "published-allowance-record-faults"
  | "published-allowance-history-faults"
  | "published-allowance-authority-faults"
  | "published-allowance-retry"
  | "published-allowance-nonpass"
  | "published-allowance-lost-launch"
  | "published-allowance-refusal"
  | "published-allowance-second-refresh"
  | "published-allowance-second-conflict"
  | "published-reentry"
  | "published-single-reentry"
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
  | "lost-commit"
  | "overlap-inside"
  | "overlap-outside"
  | "unruled-u"
  | "unchanged-u"
  | "outside-hunk"
  | "outside-u"
  | "retry-moved-main"
  | "spent-moved-main"
  | "capture-failure"
  | "review-stale"
  | "after-mirror-fail"
  | "host-gate-fail"
  | "binary-u"
  | "delete-u"
  | "mode-u"
  | "rename-u"
  | "added-path"
  | "lost-setup"
  | "lost-launch"
  | "lost-terminal"
  | "gate-interruption"
  | "crlf-dead-retry"
  | "dead-retry-fail"
  | "dead-retry-review-fail"
  | "review-interruption"
  | "gates-moved-main";

const integrationModes: Mode[] = [
  "published-reentry",
  "published-single-reentry",
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
  "overlap-inside",
  "overlap-outside",
];
it.each([
  ...integrationModes.map((mode) => ({ mode, spent: false })),
  ...integrationModes
    .filter(
      (mode) =>
        !["clean", "outside-path", "unsupported", "overlap-inside", "overlap-outside"].includes(
          mode,
        ),
    )
    .concat([
      "unruled-u",
      "unchanged-u",
      "outside-hunk",
      "outside-u",
      "retry-moved-main",
      "spent-moved-main",
      "capture-failure",
      "review-stale",
      "after-mirror-fail",
      "host-gate-fail",
      "binary-u",
      "delete-u",
      "mode-u",
      "rename-u",
      "added-path",
      "lost-setup",
      "lost-launch",
      "lost-terminal",
      "gate-interruption",
      "crlf-dead-retry",
      "dead-retry-fail",
      "dead-retry-review-fail",
      "review-interruption",
      "gates-moved-main",
      "published-allowance",
      "published-allowance-declaration-faults",
      "published-allowance-record-faults",
      "published-allowance-history-faults",
      "published-allowance-authority-faults",
      "published-allowance-retry",
      "published-allowance-nonpass",
      "published-allowance-lost-launch",
      "published-allowance-refusal",
      "published-allowance-second-refresh",
      "published-allowance-second-conflict",
    ])
    .map((mode) => ({ mode, spent: true })),
])("runs native integration delivery: $mode, spent=$spent", async ({ mode, spent }) => {
  const shape: Shape =
    mode === "clean"
      ? "clean"
      : mode.startsWith("overlap")
        ? "overlap"
        : mode === "outside-path" || mode === "unsupported"
          ? mode
          : "conflict";
  // The pass mode runs on a CRLF checkout, as the hosted Windows gate does for every mode.
  const autocrlf = mode === "pass" || mode === "crlf-dead-retry";
  const f = spent
    ? await spentFixture(mode === "spent-retry" || mode === "spent-moved-main", autocrlf)
    : await exhaustedFixture(shape, mode === "spent-retry", autocrlf);
  if (mode === "unruled-u") f.packet.spentResolution!.preservation = [];
  if (mode === "outside-u") {
    f.packet.spentResolution!.preservation[0]!.path = "feature.txt";
    f.packet.spentResolution!.authorityBody += " feature.txt";
  }
  if (mode === "overlap-inside") f.packet.allowedPaths.push("overlap.txt");
  if (mode.startsWith("published-")) {
    f.loop.nativeLaunchCeiling = 64;
    while (f.later.length < 23)
      f.later.push(participant(f.later.length + 1, "ISS-105:1", "refresh", "reviewer", "passed"));
  }
  const q = await f.compose();
  expect(await f.compose()).toEqual(q);
  const item = q.items[0]!;
  const launches: string[] = [];
  const effects: string[] = [];
  const allowanceMode = mode.startsWith("published-allowance");
  let allowance: typeof ISS214_REFRESH_REVIEW_ALLOWANCE | null = null;
  let authorityReads = 0;
  let authorityFault = "";
  const authority = {
    id: "314",
    url: "https://github.com/fixture/authority/issues/7#issuecomment-314",
    author: "fixture-decision-recorder",
    body: "Synthetic C1/C5: one refresh DELTA reviewer, same run and attempt. No retries or author.",
    capturedAt: "2030-01-02T03:04:05.000Z",
  };
  let observing = true;
  let reviewerWaiting = mode === "review-interruption";
  let died = false;
  let lost = false;
  let captureFailed = false;
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  const createWorktree = setup.createWorktree;
  const worktreeCreations: string[] = [];
  setup.createWorktree = async (config, role) => {
    worktreeCreations.push(role);
    await createWorktree(config, role);
    if (mode === "lost-setup" && role === "source" && !lost) {
      lost = true;
      throw new Error("synthetic lost setup response");
    }
  };
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (mode === "capture-failure" && args[0] === "ls-tree" && !captureFailed) {
        captureFailed = true;
        throw new Error("synthetic census acquisition failure");
      }
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
      if (allowanceMode && launches.length === 3) {
        expect(role).toBe("reviewer");
        expect(
          JSON.parse(
            await readFile(resolve(q.stateDirectory, "refresh-review-grant.json"), "utf8"),
          ),
        ).toMatchObject({ grant: allowance, directory: config.stateDirectory });
      }
      launches.push(role);
      if (mode === "published-allowance-lost-launch" && launches.length === 4)
        throw new Error("synthetic lost additional launch response");
      if (mode === "published-allowance-refusal" && launches.length === 4)
        throw new QueueBlocked("provider-model-refused");
      expect(config.stateDirectory.startsWith(item.source.stateDirectory)).toBe(true);
      expect(config.worktree).toBe(item.source.worktree);
      expect(config.pilotRevision).toBe(item.source.pilotRevision);
      expect(prompt).toContain(f.packet.spentResolution?.authorityUrl ?? f.packet.authorityUrl);
      expect(prompt).toContain(f.sourceDirectory);
      if (role === "author") {
        // A dead launch advances the ISS-158 ladder like any unsuccessful author launch.
        const rung = spent || launches.filter((launch) => launch === "author").length === 2 ? 2 : 1;
        expect(config.author).toMatchObject({ ...SELF_ROUTING.author[rung], rung });
        if (mode !== "unruled-u")
          expect(prompt).toContain(
            `Allowed author paths: ${JSON.stringify(item.source.correctionPaths)}`,
          );
        expect(prompt).toContain("Resolve only Git's marked conflict");
        if (mode !== "no-change") {
          // Git's checkout line endings outside the hunks are immutable text, so the
          // resolution keeps them; a core.autocrlf=true checkout has CRLF.
          const marked = await readFile(resolve(config.worktree, "docs/loop.md"), "utf8");
          if (autocrlf) expect(marked).toContain("\r\n");
          const eol = marked.includes("\r\n") ? "\r\n" : "\n";
          await writeFile(
            resolve(config.worktree, "docs/loop.md"),
            "# The loop\n\nReviewed feature and integration main.\n".replaceAll("\n", eol),
          );
        }
        if (mode === "escape")
          await writeFile(resolve(config.worktree, "feature.txt"), "escaped\n");
        if (mode === "outside-hunk")
          await writeFile(
            resolve(config.worktree, "docs/loop.md"),
            "# Changed outside\n\nReviewed feature and integration main.\n",
          );
        if (spent && mode !== "unchanged-u") {
          expect(prompt).toContain("Seed-bound conflict census");
          await writeFile(resolve(config.worktree, "overlap.txt"), "preserve reviewed and main\n");
        }
        if (mode === "binary-u")
          await writeFile(resolve(config.worktree, "overlap.txt"), "binary\0data");
        if (mode === "delete-u") await rm(resolve(config.worktree, "overlap.txt"));
        if (mode === "mode-u") {
          await f.git(["config", "core.filemode", "false"], config.worktree);
          await f.git(["update-index", "--chmod=+x", "overlap.txt"], config.worktree);
        }
        if (mode === "rename-u")
          await rename(
            resolve(config.worktree, "overlap.txt"),
            resolve(config.worktree, "renamed.txt"),
          );
        if (mode === "added-path")
          await writeFile(resolve(config.worktree, "added.txt"), "unrelated\n");
        if (mode.startsWith("overlap")) {
          expect(prompt).toContain("U is evidence, never edit authority");
          await writeFile(resolve(config.worktree, "overlap.txt"), "preserve reviewed and main\n");
        }
      } else {
        expect(prompt.toLowerCase()).toContain("independent delta");
        expect(prompt).toContain(f.reviewed);
        expect(prompt).toContain("Selected author attempt ");
      }
      const trace = resolve(config.stateDirectory, `${role}-${randomUUID()}.jsonl`);
      await writeFile(trace, "synthetic worker execution\n");
      if (mode === "lost-launch") throw new Error("synthetic lost launch response");
      return { id: randomUUID(), pid: launches.length, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (observing) return { status: "running", id: attempt.id };
      if (role === "reviewer" && reviewerWaiting) return { status: "running", id: attempt.id };
      if (mode === "published-allowance-retry" && launches.length === 4)
        return { status: "dead", id: attempt.id, summary: "Synthetic additional reviewer death." };
      if (mode === "lost-terminal" && role === "author" && !lost) {
        lost = true;
        throw new Error("synthetic interrupted terminal observation");
      }
      if (role === "author") {
        if (
          [
            "dead-retry",
            "spent-retry",
            "retry-moved-main",
            "crlf-dead-retry",
            "dead-retry-fail",
            "dead-retry-review-fail",
          ].includes(mode) &&
          !died
        ) {
          died = true;
          return { status: "dead", id: attempt.id, summary: "process vanished" };
        }
        return {
          status: ["author-fail", "dead-retry-fail"].includes(mode) ? "failed" : "passed",
          id: attempt.id,
          head: config.base,
          summary: mode === "author-fail" ? "needs broader changes" : "",
        };
      }
      const head =
        mode === "review-stale" ? f.reviewed : await f.git(["rev-parse", "HEAD"], config.worktree);
      const fail =
        mode === "review-fail" ||
        mode === "dead-retry-review-fail" ||
        (mode === "published-allowance-nonpass" && launches.length === 4);
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
    if (
      ((mode === "gate-interruption" && name === "test") ||
        (mode === "gates-moved-main" && name === "board")) &&
      !lost
    ) {
      lost = true;
      throw new Error("synthetic interrupted gate");
    }
    if (
      (["gate-fail", "host-gate-fail"].includes(mode) && name === "test") ||
      (mode === "after-mirror-fail" && name === "board")
    )
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
    cause: mode === "host-gate-fail" ? "host" : "candidate",
    main,
    log: resolve(config.stateDirectory, "base-control.log"),
  });
  let draft = false;
  let published = false;
  let merged = false;
  let cleaned = false;
  let publishedHead = "";
  let publishedConflict = false;
  let publicationObservations = 0;
  let hostedObservations = 0;
  delivery.conflictingPublication = async (config, publication) => {
    publicationObservations++;
    expect(config.candidateHead).toBe(publishedHead);
    expect(publication.head).toBe(publishedHead);
    return publishedConflict;
  };
  delivery.observeDraft = async () =>
    draft ? { state: "confirmed", value: { issue: NUMBER } } : { state: "needs-mutation" };
  delivery.applyDraft = async () => {
    draft = true;
    effects.push("draft");
  };
  delivery.observePublication = async (config, plan, planDigest) =>
    published && config.candidateHead === publishedHead
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
      : { state: "needs-mutation", target: published ? "forward" : "absent" };
  delivery.publish = async (config) => {
    if (published)
      expect(config.refresh).toMatchObject({
        head: publishedHead,
        number: 400,
        url: "https://github.com/fixture/repository/pull/400",
      });
    published = true;
    publishedHead = config.candidateHead;
    publishedConflict = false;
    effects.push("publish");
    throw new Error("lost publish response");
  };
  delivery.checks = async (config, publication) => {
    hostedObservations++;
    expect(publication).toMatchObject({ number: 400, head: config.candidateHead });
    if (publishedConflict) throw new DeliveryBlocked("published-candidate-conflict");
    return {
      head: publishedHead,
      checks: config.requiredChecks.map((name) => ({
        name,
        bucket:
          mode === "hosted-fail" ? "fail" : mode.startsWith("published-") ? "pending" : "pass",
        link: `https://example.test/check/${encodeURIComponent(name)}`,
      })),
    };
  };
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
  const adapter = (current = q) => {
    const bounded = repositoryQueueAdapter(current, f.repository, {
      native,
      setup,
      delivery,
      gitExecutable: f.gitExecutable,
      refreshReviewAllowance: allowance,
      async observeAuthority(url) {
        authorityReads++;
        expect(url).toBe(authority.url);
        if (authorityFault === "unreadable") throw new Error("synthetic unreadable comment");
        if (authorityFault === "absent") return undefined as never;
        return authorityFault
          ? { ...authority, [authorityFault]: "synthetic mismatch" }
          : authority;
      },
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
            gates: {
              beforeMirror: ["typecheck", "format:check", "test"],
              afterMirror: spent ? ["board"] : [],
            },
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
  const run = (current = q) => queueStep(current, adapter(current));
  const integrationAttempt = () =>
    readFile(resolve(q.stateDirectory, "attempt.json"), "utf8").then(JSON.parse);
  const refresh = () =>
    readFile(resolve(item.source.stateDirectory, "native-refresh.json"), "utf8").then(JSON.parse);
  const terminalReselection = async () => {
    const path = resolve(q.stateDirectory, "attempt.json");
    const before = await readFile(path, "utf8");
    const terminal = JSON.parse(before);
    const later = [
      ...terminal.history,
      participant(terminal.history.length + 1, "ISS-107:1", "source", "author", "passed"),
      participant(terminal.history.length + 2, "ISS-107:1", "source", "reviewer", "passed"),
    ];
    await f.put(f.runState, "cycle-5-complete", {
      selection: { cycle: 5, key: "ISS-107", number: 364, base: f.main },
      history: later,
    });
    await f.advanceMain("main.txt", "later unrelated main\n");
    const resumed = await f.compose({ ...f.loop, integrationContinuation: f.packet }, later);
    expect(resumed.initialHistory).toEqual(later);
    const commands = [...effects];
    const workers = [...launches];
    if (terminal.phase === "complete")
      await expect(run(resumed)).resolves.toMatchObject({
        status: "complete",
        participants: later.length,
      });
    else await expect(run(resumed)).rejects.toThrow("continuation-failed");
    expect(await adapter(resumed).history()).toEqual(later);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(effects).toEqual(commands);
    expect(launches).toEqual(workers);
  };
  const zeroLaunch = mode === "outside-path" || mode === "unsupported" || mode === "outside-u";
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
      head: item.base,
      reviewId: f.reviewId,
      history: f.later,
    });
    await f.unchanged();
    return;
  }
  if (mode === "capture-failure") {
    await expect(run()).rejects.toThrow("synthetic census acquisition failure");
    expect(launches).toEqual([]);
    expect((await refresh()).conflict.census).toBeUndefined();
  }
  if (mode === "lost-launch") {
    await expect(run()).rejects.toThrow("synthetic lost launch response");
    const partial = await readFile(resolve(item.source.worktree, "docs/loop.md"), "utf8");
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).rejects.toThrow("author-launch-identity-unknown-reconcile");
    expect(launches).toEqual(["author"]);
    expect(await readFile(resolve(item.source.worktree, "docs/loop.md"), "utf8")).toBe(partial);
    expect((await integrationAttempt()).phase).toBe("delivery");
    await f.unchanged();
    return;
  }
  // Setup, then the first worker launch, then a running observation on replay.
  for (let replay = 0; replay < 2; replay++)
    await expect(run(await f.compose())).resolves.toMatchObject({
      status: mode === "clean" ? "observing-reviewer" : "observing-author",
    });
  expect(launches).toEqual([mode === "clean" ? "reviewer" : "author"]);
  if (mode === "lost-setup") {
    expect(lost).toBe(true);
    expect(worktreeCreations).toEqual(["pilot", "source", "review"]);
  }
  expect(await integrationAttempt()).toMatchObject({
    phase: "delivery",
    reviewId: f.reviewId,
    acceptedStage: "source",
    stateDirectory: item.source.stateDirectory,
    candidateAttempt: 2,
    authorFailures: { count: spent ? 2 : 1 },
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
    expect(saved.conflict.census.u).toEqual(
      spent || mode.startsWith("overlap") ? ["overlap.txt"] : [],
    );
    expect(
      await f.git(["rev-list", "--parents", "-n", "1", saved.conflict.seed], item.source.worktree),
    ).toBe(`${saved.conflict.seed} ${f.reviewed} ${f.main}`);
  }
  expect(await f.git(["rev-parse", "HEAD"], f.repository)).toBe(f.main);
  observing = false;
  if (mode === "published-single-reentry") {
    const inProcess = adapter();
    await expect(queueStep(q, inProcess)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    const accepted = await integrationAttempt();
    expect(accepted).toMatchObject({ phase: "delivery", head: publishedHead, candidateAttempt: 2 });
    expect(accepted.reviewId).not.toBe(f.reviewId);
    expect(accepted.history).toHaveLength(25);
    const before = await snapshot(q.stateDirectory);
    const calls = [...effects];
    const checks = hostedObservations;
    for (let replay = 0; replay < 2; replay++)
      await expect(queueStep(q, inProcess)).resolves.toMatchObject({
        status: "observing-hosted-checks",
      });
    await expect(run(await f.compose())).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    expect(await snapshot(q.stateDirectory)).toEqual(before);
    expect(effects).toEqual(calls);
    expect(hostedObservations).toBe(checks + 3);
    expect(launches).toEqual(["author", "reviewer"]);
    expect(effects.filter((effect) => effect === "publish")).toHaveLength(1);
    await f.unchanged();
    return;
  }
  if (mode === "review-interruption") {
    for (let replay = 0; replay < 2; replay++)
      await expect(run(await f.compose())).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(launches).toEqual(["author", "reviewer"]);
    expect(effects).toEqual([]);
    reviewerWaiting = false;
  }
  const workFailure: Record<string, string | undefined> = {
    "spent-retry": "continuation-failed",
    "author-fail": "continuation-failed",
    "review-fail": "continuation-failed",
    escape: "continuation-failed",
    "no-change": "continuation-failed",
    "second-conflict": "continuation-failed",
    "gate-fail": "continuation-failed",
    "hosted-fail": "continuation-failed",
    "overlap-inside": "continuation-failed",
    "overlap-outside": "continuation-failed",
    "unruled-u": "continuation-failed",
    "outside-hunk": "continuation-failed",
    "retry-moved-main": "continuation-failed",
    "spent-moved-main": "continuation-failed",
    "review-stale": "continuation-failed",
    "after-mirror-fail": "continuation-failed",
    "binary-u": "continuation-failed",
    "delete-u": "continuation-failed",
    "mode-u": "continuation-failed",
    "rename-u": "continuation-failed",
    "added-path": "continuation-failed",
    "dead-retry-fail": "continuation-failed",
    "dead-retry-review-fail": "continuation-failed",
  };
  // Main moving after the resolution review is an observation stop; the next replay
  // refreshes onto that main, and a second conflict is exhausted without renewal.
  if (
    ["second-conflict", "moved-main", "retry-moved-main", "spent-moved-main"].includes(mode) ||
    mode === "published-reentry" ||
    allowanceMode
  ) {
    await f.advanceMain(
      mode === "second-conflict" ? "docs/loop.md" : "main.txt",
      "# The loop\n\nMain moved again.\n",
    );
    await expect(run()).rejects.toThrow("current-main-moved");
    expect(launches).toEqual(
      mode === "retry-moved-main" ? ["author", "author", "reviewer"] : ["author", "reviewer"],
    );
  }
  if (mode === "published-reentry" || allowanceMode) {
    const intermediate = await refresh();
    expect(intermediate.previousReview).toBe(f.reviewId);
    expect(
      JSON.parse(await readFile(resolve(intermediate.directory, "reviewer-terminal.json"), "utf8"))
        .status,
    ).toBe("passed");
    for (const name of ["delivery-source", "publication"])
      await expect(readFile(resolve(intermediate.directory, `${name}.json`))).rejects.toMatchObject(
        { code: "ENOENT" },
      );
    await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const current = await refresh();
    expect(current).toMatchObject({
      previousDirectory: intermediate.directory,
      previousHead: intermediate.head,
    });
    expect(current.previousReview).not.toBe(f.reviewId);
    const accepted = await integrationAttempt();
    expect(accepted).toMatchObject({ phase: "delivery", head: publishedHead, candidateAttempt: 2 });
    expect(accepted.reviewId).not.toBe(current.previousReview);
    expect(accepted.reviewId).not.toBe(f.reviewId);
    expect(accepted.history).toHaveLength(26);
    if (allowanceMode) {
      // The allowance modes start from this same persisted publication and carry
      // only their own post-publication work. The AC1/AC2 re-entry replays and
      // binding faults below stay with `published-reentry`: the hosted Windows
      // bootstrap spends roughly 45ms per real Git spawn, and one case that
      // repeated them (982 spawns) exceeded the fixed 30-second test timeout.
      await publishedAllowance(current, accepted);
      return;
    }
    const inProcess = adapter();
    await expect(queueStep(q, inProcess)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    expect(await integrationAttempt()).toEqual(accepted);
    const before = await snapshot(q.stateDirectory);
    const calls = [...effects];
    const checks = hostedObservations;
    for (let replay = 0; replay < 2; replay++)
      await expect(queueStep(q, inProcess)).resolves.toMatchObject({
        status: "observing-hosted-checks",
      });
    const reconstructed = await f.compose();
    await expect(run(reconstructed)).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(await snapshot(q.stateDirectory)).toEqual(before);
    expect(effects).toEqual(calls);
    expect(hostedObservations).toBe(checks + 3);
    expect(launches).toEqual(["author", "reviewer", "reviewer"]);
    expect(effects.filter((effect) => effect === "publish")).toHaveLength(1);

    // Change one binding at a time after the valid real-path re-entry. Each refusal
    // must precede another observation/mutation, with every other prerequisite intact.
    const refusal = "unreviewed-delivery-source";
    const faults: {
      label: string;
      directory: string;
      name: string;
      change?: (record: any) => any;
      reason: string;
    }[] = [
      {
        label: "missing original PASS",
        directory: f.sourceDirectory,
        name: "reviewer-terminal",
        reason: "missing-reviewer-terminal",
      },
      {
        label: "non-PASS original",
        directory: f.sourceDirectory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, status: "failed" }),
        reason: refusal,
      },
      {
        label: "original PASS body",
        directory: f.sourceDirectory,
        name: "reviewer-terminal",
        change: (r) => ({
          ...r,
          summary: JSON.stringify({
            ...JSON.parse(r.summary),
            verdict: "FAIL",
            findings: [
              { file: "feature.txt", line: 1, severity: "blocking", text: "Synthetic rejection." },
            ],
          }),
        }),
        reason: refusal,
      },
      {
        label: "original author completion",
        directory: f.sourceDirectory,
        name: "author-terminal",
        change: (r) => ({ ...r, status: "failed" }),
        reason: refusal,
      },
      {
        label: "original head",
        directory: f.sourceDirectory,
        name: "candidate",
        change: (r) => ({ ...r, head: f.base }),
        reason: refusal,
      },
      {
        label: "original review ID",
        directory: f.sourceDirectory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, id: "synthetic-other-review" }),
        reason: refusal,
      },
      {
        label: "missing current PASS",
        directory: current.directory,
        name: "reviewer-terminal",
        reason: "malformed-component-record:reviewer-terminal",
      },
      {
        label: "non-PASS current",
        directory: current.directory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, status: "failed" }),
        reason: refusal,
      },
      {
        label: "current PASS body",
        directory: current.directory,
        name: "reviewer-terminal",
        change: (r) => ({
          ...r,
          summary: JSON.stringify({
            ...JSON.parse(r.summary),
            verdict: "FAIL",
            findings: [
              { file: "feature.txt", line: 1, severity: "blocking", text: "Synthetic rejection." },
            ],
          }),
        }),
        reason: refusal,
      },
      {
        label: "current head",
        directory: current.directory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, head: f.reviewed }),
        reason: refusal,
      },
      {
        label: "current review ID",
        directory: current.directory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, id: "synthetic-other-review" }),
        reason: refusal,
      },
      {
        label: "missing delivery source",
        directory: current.directory,
        name: "delivery-source",
        reason: "malformed-component-record:delivery-source",
      },
      {
        label: "delivery source review",
        directory: current.directory,
        name: "delivery-source",
        change: (r) => ({ ...r, reviewId: f.reviewId }),
        reason: refusal,
      },
      {
        label: "delivery source head",
        directory: current.directory,
        name: "delivery-source",
        change: (r) => ({ ...r, head: intermediate.head }),
        reason: refusal,
      },
      {
        label: "delivery source directory",
        directory: current.directory,
        name: "delivery-source",
        change: (r) => ({ ...r, stateDirectory: intermediate.directory }),
        reason: refusal,
      },
      {
        label: "selected directory",
        directory: item.source.stateDirectory,
        name: "native-refresh",
        change: (r) => ({ ...r, directory: intermediate.directory }),
        reason: refusal,
      },
      {
        label: "previous directory",
        directory: item.source.stateDirectory,
        name: "native-refresh",
        change: (r) => ({ ...r, previousDirectory: f.sourceDirectory }),
        reason: refusal,
      },
      {
        label: "previous review",
        directory: item.source.stateDirectory,
        name: "native-refresh",
        change: (r) => ({ ...r, previousReview: f.reviewId }),
        reason: refusal,
      },
      {
        label: "previous head",
        directory: item.source.stateDirectory,
        name: "native-refresh",
        change: (r) => ({ ...r, previousHead: f.reviewed }),
        reason: refusal,
      },
      {
        label: "missing intermediate PASS",
        directory: intermediate.directory,
        name: "reviewer-terminal",
        reason: "malformed-component-record:reviewer-terminal",
      },
      {
        label: "non-PASS intermediate",
        directory: intermediate.directory,
        name: "reviewer-terminal",
        change: (r) => ({ ...r, status: "failed" }),
        reason: refusal,
      },
      {
        label: "current participant",
        directory: q.stateDirectory,
        name: "participant-26-terminal",
        change: (r) => ({ ...r, outcome: "failed" }),
        reason: "participant-history-drift",
      },
      {
        label: "intermediate participant",
        directory: q.stateDirectory,
        name: "participant-25-terminal",
        change: (r) => ({ ...r, outcome: "failed" }),
        reason: "participant-history-drift",
      },
      {
        label: "accepted review",
        directory: q.stateDirectory,
        name: "attempt",
        change: (r) => ({ ...r, reviewId: "synthetic-other-review" }),
        reason: refusal,
      },
      {
        label: "accepted head",
        directory: q.stateDirectory,
        name: "attempt",
        change: (r) => ({ ...r, head: f.reviewed }),
        reason: refusal,
      },
    ];
    const stale = JSON.parse(
      await readFile(resolve(f.sourceDirectory, "native-refresh.json"), "utf8"),
    );
    faults.push({
      label: "stale attempt-level selection",
      directory: item.source.stateDirectory,
      name: "native-refresh",
      change: () => stale,
      reason: refusal,
    });
    for (const fault of faults) {
      const path = resolve(fault.directory, `${fault.name}.json`);
      const bytes = await readFile(path, "utf8");
      try {
        if (fault.change) await f.put(fault.directory, fault.name, fault.change(JSON.parse(bytes)));
        else await rm(path);
        await expect(run(), fault.label).rejects.toMatchObject({ reason: fault.reason });
      } finally {
        await writeFile(path, bytes);
      }
      expect(effects, fault.label).toEqual(calls);
      expect(launches, fault.label).toEqual(["author", "reviewer", "reviewer"]);
    }
    // The intermediate PASS is complete review evidence, but it never entered
    // delivery. Selecting it coherently must still fail for the missing payload.
    const refreshPath = resolve(item.source.stateDirectory, "native-refresh.json");
    const attemptPath = resolve(q.stateDirectory, "attempt.json");
    const refreshBytes = await readFile(refreshPath, "utf8");
    const attemptBytes = await readFile(attemptPath, "utf8");
    try {
      await f.put(item.source.stateDirectory, "native-refresh", intermediate);
      await f.put(q.stateDirectory, "attempt", {
        ...accepted,
        head: intermediate.head,
        reviewId: current.previousReview,
      });
      await expect(run()).rejects.toMatchObject({
        reason: "malformed-component-record:delivery-source",
      });
    } finally {
      await writeFile(refreshPath, refreshBytes);
      await writeFile(attemptPath, attemptBytes);
    }
    expect(await snapshot(q.stateDirectory)).toEqual(before);
    await f.unchanged();
    return;
  }
  async function publishedAllowance(current: any, accepted: any) {
    const digestFile = async (path: string) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    const stopName = "cycle-6-stop-2";
    const stopMarker = `loop-stop:${RUN}:6:2`;
    const selection = { cycle: 6, key: KEY, number: NUMBER, base: current.main };
    await f.put(f.runState, stopName, {
      selection,
      stop: 2,
      marker: stopMarker,
      reason: "unreviewed-delivery-source",
      attempts: 2,
      history: accepted.history,
    });
    await f.put(f.runState, `${stopName}-complete`, {
      selection,
      stop: 2,
      history: accepted.history,
    });
    const reservationPath = resolve(q.stateDirectory, "../spent-resolution.json");
    const reservationBytes = await readFile(reservationPath, "utf8");
    const granted = {
      run: RUN,
      issue: ISSUE,
      item: item.id,
      stopMarker,
      authority: {
        id: authority.id,
        url: authority.url,
        author: authority.author,
        bodySha256: createHash("sha256").update(authority.body).digest("hex"),
      },
      reservationSha256: await digestFile(reservationPath),
      claimSha256: await digestFile(f.packet.spentResolution!.claim),
      stopSha256: await digestFile(resolve(f.runState, `${stopName}.json`)),
      publicationSha256: await digestFile(resolve(current.directory, "publication.json")),
    };
    allowance = granted;
    const grantPath = resolve(q.stateDirectory, "refresh-review-grant.json");
    await expect(readFile(grantPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(authorityReads).toBe(0); // No observation at composition, re-entry or unchanged main.
    await f.advanceMain("post-publication.txt", "new main after publication\n");
    publishedConflict = true;
    await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(
      JSON.parse(await readFile(resolve(current.directory, "publication-conflict.json"), "utf8")),
    ).toEqual({ head: accepted.head });
    expect(authorityReads).toBe(0);

    // Every negative reaches the same native launch boundary. Restore only
    // synthetic fixture state between independent faults, never live records.
    // Each group is one case: a fault costs one full delivery pass through Git.
    const admissionFaults: Partial<Record<Mode, string[]>> = {
      "published-allowance-declaration-faults": [
        "missing-declaration",
        "wrong-run",
        "wrong-issue",
        "wrong-attempt",
        "wrong-stop",
      ],
      // ISS-235's hosted remainder failure exceeded 30 seconds for all six
      // record faults in one case. Keep every fault and the positive control,
      // with three full delivery passes per case and the same timeout.
      "published-allowance-record-faults": ["reservation", "claim", "publication"],
      "published-allowance-history-faults": ["stop", "participant", "missing-stop-completion"],
      "published-allowance-authority-faults": [
        "absent",
        "unreadable",
        "id",
        "url",
        "author",
        "body",
      ],
    };
    const faults = admissionFaults[mode];
    if (faults) {
      for (const fault of faults) {
        const restores: (() => Promise<unknown>)[] = [];
        allowance = structuredClone(granted);
        authorityFault = ["absent", "unreadable", "id", "url", "author", "body"].includes(fault)
          ? fault
          : "";
        const change = async (path: string, update: (value: any) => any) => {
          const bytes = await readFile(path, "utf8");
          restores.push(() => writeFile(path, bytes));
          const value = update(JSON.parse(bytes));
          if (value === undefined) await rm(path);
          else await writeFile(path, JSON.stringify(value));
        };
        if (fault === "missing-declaration") allowance = null;
        if (fault === "wrong-run") allowance!.run = "synthetic-fresh-run";
        if (fault === "wrong-issue")
          allowance!.issue = "https://github.com/fixture/repository/issues/999";
        if (fault === "wrong-attempt") allowance!.item = "ISS-104:3";
        if (fault === "wrong-stop") allowance!.stopMarker = `loop-stop:${RUN}:7:1`;
        if (fault === "reservation")
          await change(reservationPath, (r) => ({ ...r, launchLimit: 4 }));
        if (fault === "claim")
          await change(f.packet.spentResolution!.claim, (r) => ({
            ...r,
            authorityUrl: authority.url,
          }));
        if (fault === "stop")
          await change(resolve(f.runState, `${stopName}.json`), (r) => ({
            ...r,
            marker: `loop-stop:${RUN}:7:1`,
          }));
        if (fault === "publication")
          await change(resolve(current.directory, "publication.json"), (r) => ({
            ...r,
            number: 401,
          }));
        if (fault === "participant")
          await change(resolve(q.stateDirectory, "participant-24-terminal.json"), (r) => ({
            ...r,
            usage: usage(999),
          }));
        if (fault === "missing-stop-completion")
          await change(resolve(f.runState, `${stopName}-complete.json`), () => undefined);
        const reads = authorityReads;
        await expect(run(), fault).rejects.toMatchObject({
          reason: "continuation-failed",
          diagnostics: expect.stringContaining("integration-continuation-launch-exhausted"),
        });
        expect(authorityReads - reads, fault).toBe(authorityFault ? 1 : 0);
        expect(launches, fault).toEqual(["author", "reviewer", "reviewer"]);
        await expect(readFile(grantPath)).rejects.toMatchObject({ code: "ENOENT" });
        for (const restore of restores) await restore();
        await f.put(q.stateDirectory, "attempt", accepted);
        const pending = await refresh();
        await rm(resolve(pending.directory, "reviewer-intent.json"), { force: true });
      }
    }
    allowance = granted;
    authorityFault = "";
    const reads = authorityReads;
    reviewerWaiting = true;
    if (mode === "published-allowance-refusal") {
      await expect(run()).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining("integration-continuation-launch-exhausted"),
      });
      const consumed = await readFile(grantPath, "utf8");
      for (let replay = 0; replay < 2; replay++)
        await expect(run(await f.compose())).rejects.toMatchObject({
          reason: "continuation-failed",
        });
      expect(authorityReads).toBe(reads + 1);
      expect(launches).toEqual(["author", "reviewer", "reviewer", "reviewer"]);
      expect(await adapter().history()).toHaveLength(26); // pre-worker refusal has no terminal
      expect(await readFile(grantPath, "utf8")).toBe(consumed);
      expect(await readFile(reservationPath, "utf8")).toBe(reservationBytes);
      await f.unchanged();
      return;
    }
    if (mode === "published-allowance-lost-launch") {
      await expect(run()).rejects.toThrow("synthetic lost additional launch response");
      const consumed = await readFile(grantPath, "utf8");
      for (let replay = 0; replay < 2; replay++)
        await expect(run(await f.compose())).rejects.toThrow(
          "reviewer-launch-identity-unknown-reconcile",
        );
      expect(await readFile(grantPath, "utf8")).toBe(consumed);
      expect(authorityReads).toBe(reads + 1);
      expect(launches).toEqual(["author", "reviewer", "reviewer", "reviewer"]);
      expect(await adapter().history()).toHaveLength(26); // no invented terminal
      await f.unchanged();
      return;
    }
    await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(authorityReads).toBe(reads + 1);
    const consumed = await readFile(grantPath, "utf8");
    expect(JSON.parse(consumed)).toMatchObject({ grant: granted, authority });
    expect(await adapter().history()).toHaveLength(26);
    expect(launches).toEqual(["author", "reviewer", "reviewer", "reviewer"]);
    if (faults) {
      // The control: with every fault restored, the same inputs admit once.
      expect(await readFile(reservationPath, "utf8")).toBe(reservationBytes);
      await f.unchanged();
      return;
    }
    // The second-movement modes carry the longest chain, so the steady-state
    // replays of the admitted reviewer and its publication stay with the others.
    const chainReplays = mode.startsWith("published-allowance-second") ? 0 : 2;
    for (let replay = 0; replay < chainReplays; replay++)
      await expect(run(await f.compose())).resolves.toMatchObject({
        status: "observing-reviewer",
      });
    expect(await readFile(grantPath, "utf8")).toBe(consumed);
    expect(authorityReads).toBe(reads + 1);
    reviewerWaiting = false;
    if (["published-allowance-retry", "published-allowance-nonpass"].includes(mode)) {
      await expect(run()).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining(
          mode.endsWith("retry")
            ? "integration-continuation-launch-exhausted"
            : "refresh-review-failed",
        ),
      });
      const failed = await integrationAttempt();
      expect(failed).toMatchObject({ phase: "failed", candidateAttempt: 2 });
      expect(failed.history).toHaveLength(27);
      for (let replay = 0; replay < 2; replay++)
        await expect(run(await f.compose())).rejects.toMatchObject({
          reason: "continuation-failed",
        });
    } else {
      await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      const advanced = await integrationAttempt();
      expect(advanced).toMatchObject({
        phase: "delivery",
        candidateAttempt: 2,
        retries: accepted.retries,
      });
      expect(advanced.head).not.toBe(accepted.head);
      expect(advanced.reviewId).not.toBe(accepted.reviewId);
      expect(advanced.history.slice(0, 26)).toEqual(accepted.history);
      expect(advanced.history).toHaveLength(27);
      expect(effects.filter((e) => e === "publish")).toHaveLength(2);
      expect(
        effects.filter((e) => e.startsWith("gate:") && e.endsWith(advanced.head)),
      ).toHaveLength(4);
      for (let replay = 0; replay < chainReplays; replay++)
        await expect(run(await f.compose())).resolves.toMatchObject({
          status: "observing-hosted-checks",
        });
      if (mode.startsWith("published-allowance-second")) {
        // Another main movement needs another review, or conflicts with the spent
        // resolution. Neither can consume this decision a second time.
        await f.advanceMain(
          mode.endsWith("second-conflict") ? "docs/loop.md" : "post-publication.txt",
          "another main\n",
        );
        publishedConflict = true;
        await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
        await expect(run()).rejects.toMatchObject({
          reason: "continuation-failed",
          diagnostics: expect.stringContaining(
            mode.endsWith("second-conflict")
              ? "conflict-resolution-exhausted"
              : "integration-continuation-launch-exhausted",
          ),
        });
        await expect(run(await f.compose())).rejects.toMatchObject({
          reason: "continuation-failed",
        });
      }
    }
    expect(publicationObservations).toBeGreaterThan(0);
    expect(authorityReads).toBe(reads + 1);
    expect(launches).toEqual(["author", "reviewer", "reviewer", "reviewer"]);
    expect(await readFile(grantPath, "utf8")).toBe(consumed);
    expect(await readFile(reservationPath, "utf8")).toBe(reservationBytes);
    await f.unchanged();
  }
  if (mode === "lost-commit") {
    await expect(run()).rejects.toThrow("lost commit response");
    expect(launches).toEqual(["author"]);
  }
  if (mode === "lost-terminal") {
    await expect(run()).rejects.toThrow("synthetic interrupted terminal observation");
    expect(launches).toEqual(["author"]);
  }
  if (["gate-interruption", "gates-moved-main"].includes(mode)) {
    await expect(run()).rejects.toThrow("delivery-state-unknown");
    expect(launches).toEqual(["author", "reviewer"]);
    expect(effects).not.toContain("publish");
    if (mode === "gates-moved-main") {
      expect(effects.filter((e) => e.startsWith("gate:"))).toHaveLength(4);
      await f.advanceMain("main.txt", "main moved after the local gates\n");
    }
  }
  if (mode === "host-gate-fail") {
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).rejects.toThrow("gate-host-failed:test");
    expect((await integrationAttempt()).phase).toBe("delivery");
    expect(launches).toEqual(["author", "reviewer"]);
    expect(effects).not.toContain("publish");
    await f.unchanged();
    return;
  }
  if (workFailure[mode]) {
    if (mode.startsWith("overlap"))
      await expect(run()).rejects.toMatchObject({
        reason: "continuation-failed",
        diagnostics: expect.stringContaining("conflict-resolution-scope-escape"),
      });
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
      ["retry-moved-main", "dead-retry-review-fail"].includes(mode)
        ? ["author", "author", "reviewer"]
        : mode === "dead-retry-fail"
          ? ["author", "author"]
          : mode === "review-stale"
            ? ["author", "reviewer", "reviewer"]
            : mode === "spent-retry"
              ? ["author"]
              : [
                    "author-fail",
                    "no-change",
                    "escape",
                    "overlap-inside",
                    "overlap-outside",
                    "unruled-u",
                    "outside-hunk",
                    "binary-u",
                    "delete-u",
                    "mode-u",
                    "rename-u",
                    "added-path",
                  ].includes(mode)
                ? ["author"]
                : ["author", "reviewer"],
    );
    expect(effects.filter((e) => ["publish", "merge", "deployment"].includes(e))).toEqual(
      mode === "hosted-fail" ? ["publish"] : [],
    );
    const failed = await integrationAttempt();
    expect(failed).toMatchObject({ phase: "failed", candidateAttempt: 2, acceptedStage: null });
    if (["dead-retry-fail", "dead-retry-review-fail"].includes(mode)) {
      expect(failed.retries).toBe(1);
      expect(failed.authorFailures.count).toBe(4);
      expect(new Set(failed.authorFailures.ids).size).toBe(4);
    }
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
    if (mode === "gate-fail" || mode === "after-mirror-fail") {
      const stop = JSON.parse(
        await readFile(resolve(item.source.stateDirectory, "gate-stop.json"), "utf8"),
      );
      expect(stop.reason).toBe("gate-correction-not-authorized");
    }
    // The parked integration cannot be replayed into another author or attempt.
    expect(await f.compose()).toEqual(q);
    await expect(f.compose(f.loop)).rejects.toThrow("integration-continuation-required");
    if (spent && ["author-fail", "dead-retry-fail"].includes(mode)) await terminalReselection();
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
  ).toEqual([
    "typecheck",
    "format:check",
    "test",
    ...(mode === "gate-interruption" ? ["test"] : []),
    ...(spent ? ["board"] : []),
  ]);
  expect(launches).toEqual(
    mode === "clean"
      ? ["reviewer"]
      : ["dead-retry", "crlf-dead-retry"].includes(mode)
        ? ["author", "author", "reviewer"]
        : ["moved-main", "gates-moved-main"].includes(mode)
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
  if (spent && mode === "pass") await terminalReselection();
  await f.unchanged();
});

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
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
import { afterEach, expect, it } from "vitest";
import type { Adapter } from "../../scripts/dogfood/flow.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import { DeliveryBlocked } from "../../scripts/dogfood/delivery.mjs";
import type {
  IntegrationContinuation,
  TerminalAttemptAdmission,
} from "../../scripts/dogfood/continuation.js";
import {
  ISS214_REFRESH_REVIEW_ALLOWANCE,
  QueueBlocked,
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
async function terminalAdmissionFixture() {
  const f = await exhaustedFixture("clean", true);
  f.loop.nativeLaunchCeiling = 64;
  const old = await f.compose();
  const terminalDirectory = resolve(old.stateDirectory, "spent-resolution");
  const deliveryDirectory = resolve(terminalDirectory, "source", `refresh-${f.main}`);
  await mkdir(deliveryDirectory, { recursive: true });
  const failedAuthor = participant(8, `${KEY}:2`, "refresh", "author", "failed");
  const history = [...f.later, failedAuthor];
  for (let ordinal = 9; ordinal <= 25; ordinal++)
    history.push(participant(ordinal, `SYNTHETIC-${ordinal}:1`, "source", "author", "passed"));
  history.push(participant(26, `${KEY}:2`, "refresh", "reviewer", "passed"));
  const oldAttempt = JSON.parse(
    await readFile(resolve(f.attemptDirectory, "attempt.json"), "utf8"),
  );
  const failed = {
    ...oldAttempt,
    head: f.reviewed,
    history,
    authorFailures: { count: 2, ids: [f.history[2]!.id, failedAuthor.id] },
  };
  await f.put(terminalDirectory, "attempt", failed);
  await f.put(old.stateDirectory, "spent-resolution", {
    directory: terminalDirectory,
    initialHistory: history.slice(0, 23),
    inheritedWorkerRetry: true,
    launchLimit: 3,
  });
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
  const terminalBody = `<!-- ${terminalMarker} --> Synthetic hosted failure after two attempts.`;
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
    body: terminalBody,
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
  const compose = (config = loop, observer = observe, selection = selected) =>
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
  const unchanged = async () => {
    for (const [path, bytes] of retained) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await readFile(claimPath, "utf8")).toBe(claimBytes);
    const preserved = resolve(f.loop.worktreeRoot, `${KEY.toLowerCase()}-attempt-2-source`);
    expect(await f.git(["rev-parse", "HEAD"], preserved)).toBe(f.reviewed);
    expect(await f.git(["status", "--porcelain"], preserved)).toBe("");
  };
  const reservation = resolve(
    f.loop.stateRoot,
    `terminal-attempt-admission-${queueDigest({ repository: f.loop.repository, issue: KEY })}.json`,
  );
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
    oldPacket: f.packet,
    unchanged,
  };
}

it("ISS-215 production composition: red without delegation, green only for fresh attempt 3; interruption/restart is one reservation", async () => {
  const f = await terminalAdmissionFixture();
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

it.each(["ready", "spent-resolution", "reviewer-only-grant", "ceiling-four"])(
  "ISS-215 no authority: %s alone retains the production claim refusal",
  async (control) => {
    const f = await terminalAdmissionFixture();
    const { terminalAttemptAdmission: omitted, ...loop } = f.loop;
    if (control === "ready") {
      const context = await f.policy.issueContext({
        repository: loop.repository,
        key: KEY,
        number: NUMBER,
        executorRoot: f.repository,
      });
      f.policy.issueContext = async () => ({
        ...context,
        body: `${context.body}\nSynthetic ready label present.`,
      });
    }
    if (control === "reviewer-only-grant")
      await f.put(f.terminalDirectory, "refresh-review-grant", {
        unused: true,
        authority: "synthetic old reviewer-only grant",
      });
    // The same valid spent reservation and ceiling four are present in every case.
    await expect(f.compose(loop as typeof f.loop)).rejects.toMatchObject({
      reason: "integration-continuation-required",
    });
    expect(f.calls).toEqual([]);
    await expect(readFile(f.reservation)).rejects.toMatchObject({ code: "ENOENT" });
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
        reason: refusal,
      },
      {
        label: "intermediate participant",
        directory: q.stateDirectory,
        name: "participant-25-terminal",
        change: (r) => ({ ...r, outcome: "failed" }),
        reason: refusal,
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
      "published-allowance-record-faults": [
        "reservation",
        "claim",
        "stop",
        "publication",
        "participant",
        "missing-stop-completion",
      ],
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

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  repositoryQueueAdapter,
  queueStep,
  queueUsage,
  type QueueConfig,
  type QueueItem,
} from "../../scripts/dogfood/queue.js";
import type { Adapter, Config, Attempt } from "../../scripts/dogfood/flow.js";
import { withinConflictHunks } from "../../scripts/dogfood/conflict.js";
import type {
  DeliveryAdapter,
  DeliveryConfig,
  PublicationEvidence,
} from "../../scripts/dogfood/delivery.js";
import { loadPlanningSnapshot, type PlanningSnapshot } from "../../scripts/planning/check.mjs";
import {
  expectedBoardItems,
  loadBoardSnapshot,
  loadProjectSnapshot,
  type BoardSnapshot,
} from "../../scripts/planning/board-check.mjs";
import { selfPlanFromSnapshots, requiredChecks } from "../../adapters/self.mjs";

vi.mock("../../scripts/planning/board-check.mjs", async (original) => ({
  ...(await original<object>()),
  loadBoardSnapshot: vi.fn(),
  loadProjectSnapshot: vi.fn(),
}));

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function planning(keys: string[]): PlanningSnapshot {
  return {
    roadmap: {
      schemaVersion: "orchestration-roadmap/v1",
      repository: "todd-skelton/orchestration-platform",
      project: {
        id: "PVT_fixture",
        number: 1,
        title: "Delivery",
        url: "https://example.test/project",
      },
      milestones: [{ key: "M1", title: "First" }],
      issues: keys.map((key) => ({
        key,
        file: `planning/drafts/${key}.md`,
        milestone: "M1",
        blockedBy: [],
      })),
    },
    issueDrafts: Object.fromEntries(
      keys.map((key) => [
        key,
        `---\nkey: ${key}\ntitle: "Do ${key}"\nlabels: ["type:slice", "ready"]\nmilestone: "First"\nblocked_by: []\n---\n\n## Why\n\nUseful.\n`,
      ]),
    ),
  };
}

async function fixture(seedKeys = ["ISS-100"], temporaryRoot = tmpdir(), routeList = false) {
  // Delivery expects canonical roots, including macOS /var and Windows temp aliases.
  const root = await realpath(await mkdtemp(resolve(temporaryRoot, "native-refresh-")));
  roots.push(root);
  const repo = resolve(root, "repo");
  const origin = resolve(root, "remote.git");
  const state = resolve(root, "state");
  const sourceState = resolve(state, "source");
  const sourceTree = resolve(root, "source");
  const reviewTree = resolve(root, "review");
  const pilot = resolve(root, "pilot");
  await mkdir(repo);
  await mkdir(sourceState, { recursive: true });
  const commands: string[][] = [];
  const git = async (cwd: string, args: string[]) => {
    commands.push(args);
    const actual =
      args[0] === "fetch" ? args.map((arg) => (arg === "origin" ? origin : arg)) : args;
    return (await exec("git", ["-C", cwd, ...actual])).stdout.trim();
  };
  const writePlanning = async (tree: string, snapshot: PlanningSnapshot) => {
    await mkdir(resolve(tree, "planning/drafts"), { recursive: true });
    await writeFile(
      resolve(tree, "planning/roadmap.json"),
      JSON.stringify(snapshot.roadmap, null, 2) + "\n",
    );
    for (const [key, draft] of Object.entries(snapshot.issueDrafts))
      await writeFile(resolve(tree, `planning/drafts/${key}.md`), draft);
  };
  const commit = async (tree: string) => {
    await git(tree, ["add", "."]);
    await git(tree, ["commit", "-m", "fixture"]);
    return git(tree, ["rev-parse", "HEAD"]);
  };
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "fixture@example.test"]);
  await git(repo, ["config", "user.name", "Fixture"]);
  await writePlanning(repo, planning(seedKeys));
  await writeFile(
    resolve(repo, "feature.txt"),
    routeList ? "const routes = [\n  'existing',\n];\n" : "old\n",
  );
  const base = await commit(repo);
  await git(repo, ["clone", "--bare", repo, origin]);
  await git(repo, [
    "remote",
    "add",
    "origin",
    "https://github.com/todd-skelton/orchestration-platform.git",
  ]);
  await git(repo, ["fetch", "origin", "refs/heads/main:refs/remotes/origin/main"]);
  await git(repo, ["worktree", "add", "--detach", pilot, base]);
  await git(repo, ["worktree", "add", "-b", "codex/iss-100", sourceTree, base]);
  const candidatePlanning = planning(seedKeys);
  candidatePlanning.issueDrafts["ISS-100"] += "\nCandidate planning delta.\n";
  await writePlanning(sourceTree, candidatePlanning);
  await writeFile(
    resolve(sourceTree, "feature.txt"),
    routeList ? "const routes = [\n  'existing',\n  'reviewed',\n];\n" : "candidate\n",
  );
  let head = await commit(sourceTree);
  await git(repo, ["worktree", "add", "--detach", reviewTree, head]);
  const checks = requiredChecks({ repository: planning([]).roadmap.repository }) as string[];
  const source: Config = {
    owner: "fixture",
    run: "refresh-fixture",
    issue: "https://github.com/todd-skelton/orchestration-platform/issues/100",
    pilotRevision: base,
    base,
    mainBase: base,
    worktree: sourceTree,
    reviewWorktree: reviewTree,
    stateDirectory: sourceState,
    allowedPaths: ["."],
    repository: planning([]).roadmap.repository,
    requiredChecks: checks,
    author: { model: "author", effort: "high", prompt: "Implement the feature" },
    reviewer: { model: "reviewer", effort: "high", prompt: "Review the feature" },
    adapter: { kind: "codex-exec", executable: resolve(root, "codex") },
  };
  const author = {
    id: randomUUID(),
    pid: 100,
    trace: resolve(sourceState, "author.jsonl"),
    launchedAt: 1,
  };
  const reviewer: Attempt = {
    id: randomUUID(),
    pid: 101,
    trace: resolve(sourceState, "reviewer.jsonl"),
    launchedAt: 1,
  };
  const summary = (candidate: string, verdict = "PASS") =>
    JSON.stringify({
      run: source.run,
      role: "reviewer",
      head: candidate,
      verdict,
      findings:
        verdict === "FAIL"
          ? [
              {
                file: "feature.txt",
                line: 1,
                severity: "blocking",
                text: "Integration changes the feature",
              },
            ]
          : [],
      g0: "No simpler way",
    });
  const record = (name: string, value: unknown) =>
    writeFile(resolve(sourceState, `${name}.json`), JSON.stringify(value));
  const pinSource = async () => {
    head = await git(sourceTree, ["rev-parse", "HEAD"]);
    await git(reviewTree, ["checkout", "--detach", head]);
    await record("config", { fingerprint: "a".repeat(64), config: source });
    await record("candidate", { head, changed: ["feature.txt", "planning/drafts/ISS-100.md"] });
    await record("author-attempt", author);
    await record("author-terminal", { id: author.id, head: base, status: "passed" });
    await record("reviewer-attempt", reviewer);
    await record("reviewer-terminal", {
      id: reviewer.id,
      head,
      status: "passed",
      summary: summary(head),
    });
    await writeFile(author.trace, "Captured original execution evidence\n");
  };
  await pinSource();
  const item: QueueItem = {
    id: "ISS-100:1",
    issue: source.issue,
    base,
    implementationAttempt: 1,
    implementationAttemptCeiling: 4,
    source,
    setup: {
      controller: source.owner,
      run: source.run,
      issue: source.issue,
      repository: source.repository,
      repositoryRoot: repo,
      controllerRoot: repo,
      controllerRevision: base,
      pilotRevision: base,
      base,
      baseBranch: "main",
      sourceBranch: "codex/iss-100",
      pilotWorktree: pilot,
      sourceWorktree: sourceTree,
      reviewWorktree: reviewTree,
      stateDirectory: resolve(state, "setup"),
    },
    repair: {
      stateDirectory: resolve(state, "repair"),
      acceptanceCriteria: ["Preserve the feature"],
      author: source.author,
      reviewer: source.reviewer,
    },
    delivery: {
      requiredChecks: checks,
      policy: { key: "ISS-100", number: 100, title: "Do ISS-100", sourceBranch: "codex/iss-100" },
    },
  };
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-config/v1",
    controller: source.owner,
    run: source.run,
    controllerRoot: repo,
    controllerRevision: base,
    stateDirectory: state,
    limit: 1,
    nativeLaunchCeiling: 8,
    initialHistory: [],
    items: [item],
  };
  for (const [index, participant] of [author, reviewer].entries())
    await writeFile(
      resolve(state, `participant-${index + 1}-terminal.json`),
      JSON.stringify({
        ordinal: index + 1,
        id: participant.id,
        item: item.id,
        stage: "source",
        role: index ? "reviewer" : "author",
        outcome: "passed",
        usage: queueUsage(undefined),
      }),
    );
  let board: BoardSnapshot;
  const updateBoard = async () => {
    const snapshot = await loadPlanningSnapshot(repo);
    board = {
      repository: source.repository,
      totalCount: snapshot.roadmap.issues.length,
      issues: expectedBoardItems(snapshot).map((row) => ({
        ...row,
        number: Number(row.key.slice(4)),
        state: "OPEN",
      })),
    };
  };
  await updateBoard();
  vi.mocked(loadBoardSnapshot).mockImplementation(async () => structuredClone(board));
  vi.mocked(loadProjectSnapshot).mockImplementation(async () => ({
    id: "PVT_fixture",
    title: "Delivery",
    totalCount: board.issues.length,
    items: board.issues.map((row) => ({
      id: String(row.number),
      repository: source.repository,
      number: row.number,
    })),
  }));
  const advanceMain = async (keys = ["ISS-100", "ISS-101"]) => {
    await writePlanning(repo, planning(keys));
    const main = await commit(repo);
    await git(repo, ["push", origin, "main"]);
    config.controllerRevision = main;
    item.setup.controllerRevision = main;
    await updateBoard();
    return main;
  };
  let running = false;
  let reviewRunning = false;
  let lostCommit: "input" | "resolution" | undefined;
  let failReview = false;
  let malformedReview = false;
  let unavailableMain = false;
  let moveDuringReview = false;
  let lostIntegrationResponse = false;
  const prompts: string[] = [];
  const authorPrompts: string[] = [];
  let resolution: (() => Promise<void>) | undefined;
  let failAuthor = false;
  const reviewerModels: string[] = [];
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (unavailableMain && args[0] === "fetch") throw new Error("offline");
      const result = await git(tree, args);
      if (
        args[0] === "commit" &&
        lostCommit &&
        args.at(-1)!.endsWith("conflict input") === (lostCommit === "input")
      ) {
        lostCommit = undefined;
        throw new Error("lost conflict commit response");
      }
      if (
        lostIntegrationResponse &&
        ["rebase", "merge"].includes(args[0]!) &&
        args[1] !== "--abort"
      ) {
        lostIntegrationResponse = false;
        throw new Error("lost completed integration response");
      }
      return result;
    },
    async launch(role, _config, prompt) {
      if (role === "author") {
        authorPrompts.push(prompt);
        await resolution?.();
      } else {
        reviewerModels.push(_config.reviewer.model);
        prompts.push(prompt);
      }
      return {
        id: randomUUID(),
        pid: 200 + prompts.length,
        trace: _config.stateDirectory.endsWith("gate-correction")
          ? resolve(_config.stateDirectory, `${role}.jsonl`)
          : resolve(state, `${role}-delta-${prompts.length + authorPrompts.length}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(_role, current, attempt) {
      if (running || (_role === "reviewer" && reviewRunning))
        return { id: attempt.id, status: "running" };
      if (_role === "author")
        return {
          id: attempt.id,
          status: failAuthor ? "failed" : "passed",
          head: current.base,
          summary: JSON.stringify({
            run: current.run,
            role: "author",
            head: current.base,
            verdict: failAuthor ? "FAIL" : "PASS",
            summary: "",
          }),
        };
      if (malformedReview) {
        malformedReview = false;
        return { id: attempt.id, status: "malformed" };
      }
      if (moveDuringReview) {
        moveDuringReview = false;
        await advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
      }
      const currentHead = await git(current.worktree, ["rev-parse", "HEAD"]);
      return {
        id: attempt.id,
        status: failReview ? "failed" : "passed",
        head: currentHead,
        summary: summary(currentHead, failReview ? "FAIL" : "PASS"),
      };
    },
    async checks() {
      throw new Error("unused");
    },
  };
  const realDelivery = githubDeliveryAdapter();
  let refreshPublication: DeliveryAdapter | undefined;
  let publicationDirty = false;
  let publication: PublicationEvidence | undefined;
  let plannedPublication: PublicationEvidence;
  let lostPublicationObservation = false;
  let publications = 0;
  let stopGate = false;
  let typecheckFailures = 0;
  let interruptGateRetry = false;
  let typechecks = 0;
  let withTypecheck = false;
  let drafts = 0;
  const gateHeads: string[] = [];
  const delivery: DeliveryAdapter = {
    ...realDelivery,
    async runGate(current, name, candidate) {
      gateHeads.push(candidate);
      if (name === "typecheck") {
        typechecks++;
        if (interruptGateRetry && typechecks === 2) throw new Error("interrupted gate retry");
        return typechecks <= typecheckFailures ? "failed" : "passed";
      }
      if (stopGate) throw new Error("interrupted gate observation");
      return realDelivery.runGate(current, name, candidate);
    },
    async observeDraft(_current, draft) {
      return board.issues.find((row) => row.number === draft.issue)?.body === draft.body
        ? { state: "confirmed", value: { issue: draft.issue } }
        : { state: "needs-mutation" };
    },
    async applyDraft(_current, draft) {
      drafts++;
      const row = board.issues.find((row) => row.number === draft.issue)!;
      Object.assign(row, {
        title: draft.title,
        body: draft.body,
        milestone: draft.attributes.milestone,
      });
    },
    async observePublication(current, plan, digest, target) {
      if (refreshPublication) {
        const observation = await refreshPublication.observePublication(
          current,
          plan,
          digest,
          target,
        );
        if (observation.state === "confirmed" || observation.state === "conflicting") {
          publication = observation.value;
          if (lostPublicationObservation) {
            lostPublicationObservation = false;
            throw new Error("lost publication observation");
          }
        }
        return observation;
      }
      if (publication && lostPublicationObservation) {
        lostPublicationObservation = false;
        throw new Error("lost publication observation");
      }
      plannedPublication = {
        number: 200,
        url: `https://github.com/${source.repository}/pull/200`,
        head: current.candidateHead,
        repository: source.repository,
        sourceBranch: plan.sourceBranch,
        baseBranch: plan.baseBranch,
        title: plan.title,
        body: plan.body,
        planDigest: digest,
      };
      return publication
        ? { state: "confirmed", value: publication }
        : { state: "needs-mutation", target: "absent" };
    },
    async publish(current, plan, target) {
      publications++;
      if (refreshPublication) return refreshPublication.publish(current, plan, target);
      publication = plannedPublication;
    },
    async conflictingPublication(current, value) {
      return refreshPublication
        ? refreshPublication.conflictingPublication!(current, value)
        : false;
    },
    async checks(current, value) {
      if (publicationDirty && refreshPublication) return refreshPublication.checks(current, value);
      return {
        head: current.candidateHead,
        checks: checks.map((name) => ({
          name,
          bucket: "pending",
          link: "https://example.test/check",
        })),
      };
    },
  };
  const policy = {
    async plan(current: DeliveryConfig) {
      const plan = selfPlanFromSnapshots(current, await loadPlanningSnapshot(sourceTree), board, {
        total: { added: 1, deleted: 1 },
        scripts: { added: 0, deleted: 0 },
        test: { added: 0, deleted: 0 },
      });
      // This fixture exercises the real self afterMirror gate; bootstrap gates have their own tests.
      plan.gates.beforeMirror = withTypecheck ? ["typecheck"] : [];
      // Model ISS-145's preserved PR branch while retaining the genuine self planning gate.
      if (current.refresh?.localBranch) plan.cleanup.branch = current.refresh.localBranch;
      return plan;
    },
  };
  const adapter = () =>
    repositoryQueueAdapter(config, repo, {
      native,
      delivery,
      deliveryPolicy: policy,
      async assertExecutor() {},
    });
  const enablePublicationRefresh = async () => {
    // Exercise the real forward-only publication and lease against a local bare remote.
    const ssh = resolve(root, "fixture-ssh.mjs");
    await writeFile(
      ssh,
      [
        'import { spawn } from "node:child_process";',
        `const repository = ${JSON.stringify(origin)};`,
        'const service = process.argv.some((value) => value.includes("git-receive-pack"))',
        '  ? "receive-pack" : "upload-pack";',
        'const child = spawn("git", [service, repository], { stdio: "inherit", windowsHide: true });',
        'child.once("error", () => process.exit(1));',
        'child.once("close", (code) => process.exit(code ?? 1));',
        "",
      ].join("\n"),
    );
    const commandPath = (value: string) =>
      `"${value.replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
    vi.stubEnv("GIT_SSH_COMMAND", `${commandPath(process.execPath)} ${commandPath(ssh)}`);
    vi.stubEnv("GIT_SSH_VARIANT", "ssh");
    await git(repo, [
      "remote",
      "set-url",
      "origin",
      `ssh://git@github.com/${source.repository}.git`,
    ]);
    await git(repo, ["push", origin, `${head}:refs/heads/codex/iss-100`]);
    const localBranch = "codex/accepted-correction";
    await git(sourceTree, ["checkout", "-b", localBranch]);
    const preserved = resolve(root, "preserved-source");
    await git(repo, ["worktree", "add", preserved, "codex/iss-100"]);
    item.delivery.refresh = {
      number: 200,
      url: `https://github.com/${source.repository}/pull/200`,
      head,
      localBranch,
    };
    let title = "Earlier rejected candidate";
    let body = "Earlier review evidence";
    const remoteHead = () => git(origin, ["rev-parse", "refs/heads/codex/iss-100"]);
    refreshPublication = githubDeliveryAdapter({
      async gh(_current, args) {
        expect(args.slice(0, 3)).toEqual(["pr", "edit", "200"]);
        title = args[args.indexOf("--title") + 1]!;
        body = await readFile(args[args.indexOf("--body-file") + 1]!, "utf8");
        return "";
      },
      async ghJson(_current, args) {
        const row = {
          number: 200,
          url: item.delivery.refresh!.url,
          headRefOid: await remoteHead(),
          headRefName: "codex/iss-100",
          baseRefName: "main",
          state: "OPEN",
          isDraft: true,
          title,
          body,
          ...(publicationDirty ? { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" } : {}),
        };
        return args[1] === "view" ? row : [row];
      },
    });
    return { remoteHead, preserved };
  };
  const deliver = () =>
    adapter().delivery(item, { head, reviewId: reviewer.id, stateDirectory: sourceState });
  const saveAttempt = async () =>
    writeFile(
      resolve(state, "attempt.json"),
      JSON.stringify({
        schemaVersion: "dogfood-bounded-queue-attempt/v1",
        phase: "delivery",
        run: config.run,
        index: 0,
        item: item.id,
        issue: item.issue,
        base,
        candidateAttempt: 1,
        head,
        reviewId: reviewer.id,
        findings: [],
        history: await adapter().history(),
        retries: 0,
        acceptedStage: "source",
        stateDirectory: sourceState,
      }),
    );
  return {
    root,
    repo,
    sourceTree,
    sourceState,
    state,
    source,
    config,
    delivery,
    native,
    policy,
    item,
    head,
    reviewer,
    git,
    commit,
    writePlanning,
    pinSource,
    advanceMain,
    deliver,
    commands,
    prompts,
    authorPrompts,
    loseCommit: (phase: "input" | "resolution") => {
      lostCommit = phase;
    },
    setReviewRunning: (value: boolean) => {
      reviewRunning = value;
    },
    setResolution: (callback: () => Promise<void>) => {
      resolution = callback;
    },
    failAuthor: () => {
      failAuthor = true;
    },
    reviewerModels,
    gateHeads,
    adapter,
    saveAttempt,
    enablePublicationRefresh,
    setPublicationDirty: (value: boolean) => {
      publicationDirty = value;
    },
    malformReview: () => {
      malformedReview = true;
    },
    losePublicationObservation: () => {
      lostPublicationObservation = true;
    },
    publications: () => publications,
    failTypecheck: (count: number, interrupt = false) => {
      withTypecheck = true;
      typecheckFailures = count;
      interruptGateRetry = interrupt;
    },
    loseIntegrationResponse: () => {
      lostIntegrationResponse = true;
    },
    board: () => board,
    drafts: () => drafts,
    publication: () => publication,
    setRunning: (value: boolean) => {
      running = value;
    },
    setFailReview: () => {
      failReview = true;
    },
    setUnavailable: () => {
      unavailableMain = true;
    },
    setMoving: () => {
      moveDuringReview = true;
    },
    setStopGate: (value: boolean) => {
      stopGate = value;
    },
  };
}

it("retains the chosen fallback reviewer for current-main delta review", async () => {
  const f = await fixture();
  f.source.reviewer = {
    model: "claude-opus-5",
    effort: "high",
    prompt: "review",
    fallback: { model: "gpt-5.6-sol", effort: "high" },
  };
  f.reviewer.placement = { model: "gpt-5.6-sol", effort: "high" };
  await f.pinSource();
  await f.advanceMain();
  await f.deliver();
  expect(f.reviewerModels).toEqual(["gpt-5.6-sol"]);
});

it("refreshes first and resumed self gates with current registrations and candidate planning, preserving mutations and review history", async () => {
  const f = await fixture();
  const original = await readFile(resolve(f.sourceState, "candidate.json"), "utf8");
  const main = await f.advanceMain();
  f.setStopGate(true);
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  const refreshed = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  expect(refreshed).not.toBe(f.head);
  expect(await f.git(f.sourceTree, ["merge-base", main, refreshed])).toBe(main);
  expect(
    (await loadPlanningSnapshot(f.sourceTree)).roadmap.issues.map(
      (row: { key: string }) => row.key,
    ),
  ).toEqual(["ISS-100", "ISS-101"]);
  expect(f.drafts()).toBe(1);
  f.setStopGate(false);
  // A registration window unrelated to this candidate cannot fail afterMirror.
  f.board().issues.push({
    number: 999,
    title: "new intake",
    body: "<!-- planning-key: ISS-999 -->",
    milestone: "First",
  });
  f.board().totalCount++;
  await expect(f.deliver()).resolves.toMatchObject({
    status: "observing-hosted-checks",
    head: refreshed,
  });
  await expect(f.deliver()).resolves.toMatchObject({
    status: "observing-hosted-checks",
    head: refreshed,
  });
  expect(f.gateHeads).toEqual([refreshed, refreshed]);
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0]).toContain("independent DELTA review");
  expect(f.prompts[0]).toContain(f.reviewer.id);
  expect(f.prompts[0]).toContain(
    `Captured execution trace: ${JSON.stringify(resolve(f.sourceState, "author.jsonl"))}.`,
  );
  expect(f.drafts()).toBe(1);
  expect(f.commands.filter((args) => args[0] === "rebase")).toHaveLength(1);
  expect(f.publication()?.head).toBe(refreshed);
  expect(await readFile(resolve(f.sourceState, "candidate.json"), "utf8")).toBe(original);
  expect((await f.adapter().history()).map((row) => [row.stage, row.outcome])).toEqual([
    ["source", "passed"],
    ["source", "passed"],
    ["refresh", "passed"],
  ]);
});

it.each([false, true])(
  "runs the first genuine self gate after a registration lands (temporary path alias: %s)",
  async (aliased) => {
    let temporaryRoot = tmpdir();
    if (aliased) {
      const root = await realpath(await mkdtemp(resolve(tmpdir(), "refresh-alias-")));
      roots.push(root);
      temporaryRoot = resolve(root, "alias");
      // Junctions also exercise a real filesystem alias on Windows without symlink privileges.
      await symlink(await realpath(tmpdir()), temporaryRoot, "junction");
    }
    const f = await fixture(undefined, temporaryRoot);
    const oldReceipt = JSON.stringify({ head: f.head, name: "planning:board-check" });
    await writeFile(resolve(f.sourceState, "gate-1.json"), oldReceipt);
    await f.advanceMain();
    await f.saveAttempt();
    const step = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
    await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.gateHeads).toHaveLength(1);
    expect(f.publication()?.head).toBe(f.gateHeads[0]);
    const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
    expect(attempt).toMatchObject({
      head: f.gateHeads[0],
      candidateAttempt: 1,
      acceptedStage: "source",
      stateDirectory: f.sourceState,
    });
    expect(attempt.reviewId).not.toBe(f.reviewer.id);
    expect(attempt.history).toHaveLength(3);
    expect(await readFile(resolve(f.sourceState, "gate-1.json"), "utf8")).toBe(oldReceipt);
  },
);

it("reconciles a completed rebase whose response was lost without repeating it", async () => {
  const f = await fixture();
  await f.advanceMain();
  f.loseIntegrationResponse();
  await expect(f.deliver()).rejects.toThrow("rebase-conflict");
  const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  expect(head).not.toBe(f.head);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks", head });
  expect(f.commands.filter((args) => args[0] === "rebase" && args[1] !== "--abort")).toHaveLength(
    1,
  );
});

it.each([false, true])(
  "refreshes an aged existing PR forward through real gates and publication (lost integration response: %s)",
  async (lostResponse) => {
    const f = await fixture();
    const { remoteHead, preserved } = await f.enablePublicationRefresh();
    await writeFile(resolve(f.sourceTree, "feature.txt"), "accepted correction\n");
    const correction = await f.commit(f.sourceTree);
    await f.pinSource();
    const original = await readFile(resolve(f.sourceState, "candidate.json"), "utf8");
    const main = await f.advanceMain();
    if (lostResponse) {
      f.loseIntegrationResponse();
      await expect(f.deliver()).rejects.toThrow("rebase-conflict");
      expect(f.gateHeads).toEqual([]);
    } else {
      f.setStopGate(true);
      await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
      f.setStopGate(false);
    }
    const refreshed = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
    expect(refreshed).not.toBe(correction);
    expect(await remoteHead()).toBe(f.head);
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: refreshed,
    });
    for (const ancestor of [f.head, correction, main])
      expect(await f.git(f.sourceTree, ["merge-base", ancestor, refreshed])).toBe(ancestor);
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: refreshed,
    });
    expect(await remoteHead()).toBe(refreshed);
    expect(f.publications()).toBe(1);
    expect(f.publication()?.head).toBe(refreshed);
    expect(new Set(f.gateHeads)).toEqual(new Set([refreshed]));
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain(refreshed);
    expect(f.prompts[0]).toContain(f.reviewer.id);
    expect(f.commands.filter((args) => args[0] === "merge" && args[1] !== "--abort")).toHaveLength(
      1,
    );
    expect(f.commands.some((args) => args[0] === "rebase")).toBe(false);
    expect(await f.git(preserved, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).toBe(
      "accepted correction\n",
    );
    expect(
      (await loadPlanningSnapshot(f.sourceTree)).roadmap.issues.map(
        (row: { key: string }) => row.key,
      ),
    ).toEqual(["ISS-100", "ISS-101"]);
    expect(await readFile(resolve(f.sourceState, "candidate.json"), "utf8")).toBe(original);
    expect((await f.adapter().history()).map((row) => [row.stage, row.outcome])).toEqual([
      ["source", "passed"],
      ["source", "passed"],
      ["refresh", "passed"],
    ]);
  },
);

it("reconciles a publication with a lost receipt before considering newer main", async () => {
  const f = await fixture();
  await f.advanceMain();
  f.losePublicationObservation();
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  const published = f.publication()!.head;
  await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
  await expect(f.deliver()).resolves.toMatchObject({
    status: "observing-hosted-checks",
    head: published,
  });
  expect(await f.git(f.sourceTree, ["rev-parse", "HEAD"])).toBe(published);
  expect(f.publications()).toBe(1);
  expect(f.prompts).toHaveLength(1);
});

it("does not refresh or launch a reviewer when main has not moved", async () => {
  const f = await fixture();
  await expect(f.deliver()).resolves.toMatchObject({
    status: "observing-hosted-checks",
    head: f.head,
  });
  expect(f.prompts).toEqual([]);
  expect(f.commands.some((args) => args[0] === "rebase")).toBe(false);
});

it.each(["missing board item", "omitted registration", "deleted registration"])(
  "rejects candidate-owned %s after refresh",
  async (mode) => {
    const f = await fixture(mode === "omitted registration" ? ["ISS-100"] : ["ISS-100", "ISS-103"]);
    if (mode === "deleted registration") {
      await f.writePlanning(f.sourceTree, planning(["ISS-100"]));
      await rm(resolve(f.sourceTree, "planning/drafts/ISS-103.md"));
    } else {
      const snapshot = await loadPlanningSnapshot(f.sourceTree);
      snapshot.issueDrafts["ISS-103"] =
        planning(["ISS-103"]).issueDrafts["ISS-103"]! + "\nCandidate change.\n";
      await f.writePlanning(f.sourceTree, snapshot);
    }
    await f.commit(f.sourceTree);
    await f.pinSource();
    if (mode === "deleted registration")
      await writeFile(resolve(f.repo, "unrelated.txt"), "main movement\n");
    await f.advanceMain(
      mode === "omitted registration"
        ? ["ISS-100", "ISS-101"]
        : mode === "deleted registration"
          ? ["ISS-100", "ISS-103"]
          : ["ISS-100", "ISS-103", "ISS-101"],
    );
    if (mode === "missing board item") {
      f.board().issues = f.board().issues.filter((row) => row.number !== 103);
      f.board().totalCount--;
    }
    await expect(f.deliver()).rejects.toThrow("gate-attribution-unknown:planning:board-check");
    expect(f.publication()).toBeUndefined();
  },
);

it("resumes an in-flight delta reviewer without another rebase or launch", async () => {
  const f = await fixture();
  await f.advanceMain();
  f.setRunning(true);
  await expect(f.deliver()).resolves.toEqual({ status: "observing-reviewer" });
  await expect(f.deliver()).resolves.toEqual({ status: "observing-reviewer" });
  f.setRunning(false);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.prompts).toHaveLength(1);
  expect(f.commands.filter((args) => args[0] === "rebase")).toHaveLength(1);
});

it("stops unavailable or moving main before gates and retains the reviewed intermediate head", async () => {
  const offline = await fixture();
  offline.setUnavailable();
  await expect(offline.deliver()).rejects.toThrow("current-main-unavailable");
  expect(offline.gateHeads).toEqual([]);
  const moving = await fixture();
  await moving.advanceMain();
  moving.setMoving();
  await expect(moving.deliver()).rejects.toThrow("current-main-moved");
  expect(moving.gateHeads).toEqual([]);
  await expect(moving.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(moving.prompts).toHaveLength(2);
  expect(
    (await readdir(moving.sourceState)).filter((name) => name.startsWith("refresh-")),
  ).toHaveLength(2);
});

it("retains a failed delta review and stops without starting another implementation", async () => {
  const f = await fixture();
  await f.advanceMain();
  f.setFailReview();
  await expect(f.deliver()).rejects.toThrow("refresh-review-failed");
  await expect(f.deliver()).rejects.toThrow("refresh-review-failed");
  expect(f.prompts).toHaveLength(1);
  expect(f.gateHeads).toEqual([]);
  expect((await f.adapter().history()).at(-1)).toMatchObject({
    stage: "refresh",
    outcome: "failed",
  });
});

it.each([
  { existingPR: false, autocrlf: false },
  { existingPR: true, autocrlf: false },
  { existingPR: false, autocrlf: true },
  { existingPR: true, autocrlf: true },
])(
  "resolves the recorded single-list-hunk conflict and preserves both parents (existing PR: $existingPR, autocrlf: $autocrlf)",
  async ({ existingPR, autocrlf }) => {
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.autocrlf");
    vi.stubEnv("GIT_CONFIG_VALUE_0", String(autocrlf));
    const f = await fixture(undefined, undefined, true);
    if (existingPR) await f.enablePublicationRefresh();
    const original = await readFile(resolve(f.sourceState, "candidate.json"), "utf8");
    await writeFile(
      resolve(f.repo, "feature.txt"),
      "const routes = [\n  'existing',\n  'incumbent',\n];\n",
    );
    const main = await f.advanceMain();
    // Git's checkout line endings outside the hunk are part of the immutable text.
    const resolved =
      "const routes = [\n  'existing',\n  'reviewed',\n  'incumbent',\n];\n".replaceAll(
        "\n",
        autocrlf ? "\r\n" : "\n",
      );
    f.setResolution(() => writeFile(resolve(f.sourceTree, "feature.txt"), resolved));
    await f.saveAttempt();
    const run = existingPR
      ? f.deliver
      : () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
    await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
    for (const parent of [main, f.head])
      expect(await f.git(f.sourceTree, ["merge-base", parent, head])).toBe(parent);
    expect(await f.git(f.sourceTree, ["status", "--porcelain"])).toBe("");
    expect(await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).toBe(resolved);
    expect(await readFile(resolve(f.sourceState, "candidate.json"), "utf8")).toBe(original);
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain(f.reviewer.id);
    expect(f.prompts[0]).toContain(resolve(f.sourceState, "author.jsonl"));
    expect(f.prompts[0]).toContain("author-delta-1.jsonl");
    expect(f.gateHeads).toEqual([head]);
    expect(f.publications()).toBe(1);
    const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
    expect(attempt.candidateAttempt).toBe(1);
    expect((await f.adapter().history()).map((row) => [row.stage, row.role])).toEqual([
      ["source", "author"],
      ["source", "reviewer"],
      ["refresh", "author"],
      ["refresh", "reviewer"],
    ]);
  },
);

async function conflictingFixture() {
  const f = await fixture();
  await writeFile(resolve(f.repo, "feature.txt"), "main\n");
  await f.advanceMain();
  f.setResolution(() => writeFile(resolve(f.sourceTree, "feature.txt"), "candidate\nmain\n"));
  return f;
}

it.each(["\n", "\r\n"])("limits edits to actual hunks with line ending %j", (eol) => {
  const before =
    "const routes = [\n<<<<<<< HEAD\n'a',\n=======\n'b',\n>>>>>>> main\n// Keep this assertion\n<<<<<<< HEAD\n'c',\n=======\n'd',\n>>>>>>> main\n];\n".replaceAll(
      "\n",
      eol,
    );
  const after = "const routes = [\n'a',\n'b',\n// Keep this assertion\n'c',\n'd',\n];\n".replaceAll(
    "\n",
    eol,
  );
  expect(withinConflictHunks(before, after)).toBe(true);
  for (const changed of [
    before,
    after.replace("const routes", "const disabled"),
    after.replace(`// Keep this assertion${eol}`, ""),
    after.replaceAll(eol, eol === "\n" ? "\r\n" : "\n"),
    after + "extra\n",
  ])
    expect(withinConflictHunks(before, changed)).toBe(false);
});

it.each([false, true])(
  "routes a published DIRTY candidate through bounded resolution and forward publication (lost receipt: %s)",
  async (lostReceipt) => {
    const f = await fixture();
    const { remoteHead, preserved } = await f.enablePublicationRefresh();
    await writeFile(resolve(f.sourceTree, "feature.txt"), "reviewed correction\n");
    const publishedHead = await f.commit(f.sourceTree);
    await f.pinSource();
    if (lostReceipt) {
      f.losePublicationObservation();
      await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    } else {
      await expect(f.deliver()).resolves.toMatchObject({
        status: "observing-hosted-checks",
        head: publishedHead,
      });
    }
    expect(await remoteHead()).toBe(publishedHead);
    await writeFile(resolve(f.repo, "feature.txt"), "new main\n");
    const main = await f.advanceMain();
    f.setPublicationDirty(true);
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: publishedHead,
    });
    const originalPublication = await readFile(resolve(f.sourceState, "publication.json"), "utf8");
    expect(f.publications()).toBe(1);
    f.setResolution(async () => {
      await writeFile(resolve(f.sourceTree, "feature.txt"), "reviewed correction\nnew main\n");
      f.setPublicationDirty(false);
    });
    // Lose the refresh observation too: restart must reconcile that exact remote head.
    f.losePublicationObservation();
    await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    const resolved = await remoteHead();
    expect(resolved).not.toBe(publishedHead);
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: resolved,
    });
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: resolved,
    });
    expect(f.publications()).toBe(2);
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(1);
    for (const parent of [publishedHead, main])
      expect(await f.git(f.sourceTree, ["merge-base", parent, resolved])).toBe(parent);
    expect(await f.git(preserved, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(await readFile(resolve(f.sourceState, "publication.json"), "utf8")).toBe(
      originalPublication,
    );
    expect(new Set(f.gateHeads)).toEqual(new Set([publishedHead, resolved]));
  },
);

it("resumes the conflict author and delta reviewer with partial edits and original participants", async () => {
  const f = await conflictingFixture();
  f.setRunning(true);
  await expect(f.deliver()).resolves.toEqual({ status: "observing-author" });
  await expect(f.deliver()).resolves.toEqual({ status: "observing-author" });
  expect(await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).toBe("candidate\nmain\n");
  f.setRunning(false);
  f.setReviewRunning(true);
  await expect(f.deliver()).resolves.toEqual({ status: "observing-reviewer" });
  await expect(f.deliver()).resolves.toEqual({ status: "observing-reviewer" });
  f.setReviewRunning(false);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
  expect(await f.adapter().history()).toHaveLength(4);
});

it("resumes a rebase interrupted at its actual conflict before the handoff record", async () => {
  const f = await conflictingFixture();
  const main = await f.git(f.repo, ["rev-parse", "HEAD"]);
  const directory = resolve(f.sourceState, `refresh-${main}`);
  await mkdir(directory);
  await writeFile(
    resolve(f.sourceState, "native-refresh.json"),
    JSON.stringify({
      main,
      previousHead: f.head,
      previousReview: f.reviewer.id,
      directory,
      flowRetried: false,
      retries: 0,
    }),
  );
  await expect(f.git(f.sourceTree, ["rebase", main])).rejects.toThrow();
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
});

it("charges conflict resolution to the existing native launch ceiling", async () => {
  const f = await conflictingFixture();
  f.config.nativeLaunchCeiling = 3;
  await expect(f.deliver()).rejects.toThrow("native-launch-ceiling-exhausted");
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toEqual([]);
  expect(await f.adapter().history()).toHaveLength(3);
  expect(f.publications()).toBe(0);
});

it.each(["input", "resolution"] as const)(
  "reconciles a lost %s commit response without a new resolution",
  async (phase) => {
    const f = await conflictingFixture();
    f.loseCommit(phase);
    await expect(f.deliver()).rejects.toThrow("lost conflict commit response");
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(1);
  },
);

it.each(["scope", "author", "review"])(
  "retains a failed bounded %s across restarts without another repair",
  async (failure) => {
    const f = await conflictingFixture();
    if (failure === "scope")
      f.setResolution(async () => {
        await writeFile(resolve(f.sourceTree, "feature.txt"), "candidate\nmain\n");
        await writeFile(resolve(f.sourceTree, "extra.txt"), "scope expansion\n");
      });
    if (failure === "author") f.failAuthor();
    if (failure === "review") f.setFailReview();
    const reason =
      failure === "scope"
        ? "conflict-resolution-scope-escape"
        : failure === "author"
          ? "conflict-resolution-failed"
          : "refresh-review-failed";
    await expect(f.deliver()).rejects.toThrow(reason);
    await expect(f.deliver()).rejects.toThrow(reason);
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(failure === "review" ? 1 : 0);
    expect(f.gateHeads).toEqual([]);
  },
);

it("cannot renew a consumed resolution when main conflicts again across restarts", async () => {
  const f = await conflictingFixture();
  f.setStopGate(true);
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  await writeFile(resolve(f.repo, "feature.txt"), "second main conflict\n");
  await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
  await expect(f.deliver()).rejects.toThrow("conflict-resolution-exhausted");
  await expect(f.deliver()).rejects.toThrow("conflict-resolution-exhausted");
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
});

it.each([false, true])("does not correct an untyped failure (refreshed: %s)", async (refresh) => {
  const f = await fixture();
  if (refresh) await f.advanceMain();
  await f.saveAttempt();
  f.failTypecheck(1);
  const run = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  for (let replay = 0; replay < 2; replay++)
    await expect(run()).rejects.toThrow("gate-attribution-unknown:typecheck");
  expect(f.publication()).toBeUndefined();
  expect(f.gateHeads).toHaveLength(1);
  expect(f.authorPrompts).toEqual([]);
  expect(JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"))).toMatchObject({
    candidateAttempt: 1,
    retries: 0,
  });
});

it("stops incompatible main history before integration or gates", async () => {
  const f = await fixture();
  await f.git(f.repo, ["checkout", "--orphan", "replacement"]);
  await f.git(f.repo, ["rm", "-rf", "."]);
  await f.writePlanning(f.repo, planning(["ISS-100"]));
  const main = await f.commit(f.repo);
  await f.git(f.repo, ["branch", "-M", "main"]);
  await f.git(f.repo, ["push", "--force", resolve(f.root, "remote.git"), "main"]);
  await f.git(f.repo, ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  f.config.controllerRevision = main;
  f.item.setup.controllerRevision = main;
  await expect(f.deliver()).rejects.toThrow("current-main-incompatible");
  expect(f.gateHeads).toEqual([]);
  expect(f.prompts).toEqual([]);
});

it("retains the delta reviewer retry across queue resume", async () => {
  const f = await fixture();
  await f.advanceMain();
  await f.saveAttempt();
  f.malformReview();
  const step = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
  expect(attempt).toMatchObject({ retries: 1, candidateAttempt: 1 });
  expect(f.prompts).toHaveLength(2);
  expect(attempt.history.map((row: { outcome: string }) => row.outcome)).toEqual([
    "passed",
    "passed",
    "malformed",
    "passed",
  ]);
});

async function gateCorrectionFixture(afterMirror = false, refresh = false) {
  const f = await fixture();
  if (refresh) await f.advanceMain();
  await f.saveAttempt();
  const gates: { head: string; gate: string; directory: string }[] = [];
  const controls: { head: string; main: string; gate: string }[] = [];
  let cause: "candidate" | "base" | "host" | "unknown" = "candidate";
  let secondGate: string | undefined;
  const plan = f.policy.plan;
  f.policy.plan = async (current) => {
    const value = await plan(current);
    value.gates = afterMirror
      ? { beforeMirror: ["typecheck"], afterMirror: ["planning:board-check", "test"] }
      : { beforeMirror: ["typecheck", "test"], afterMirror: ["planning:board-check"] };
    return value;
  };
  f.delivery.runGate = async (current, gate, head) => {
    gates.push({ head, gate, directory: current.stateDirectory });
    const corrected = (await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).includes(
      "fixed",
    );
    if ((!corrected && gate === "test") || (corrected && gate === secondGate)) {
      const log = resolve(current.stateDirectory, "full-gate.log");
      await writeFile(
        log,
        `FAIL feature.test.ts > preserves behavior\nAssertionError: wrong value\n${"full output\n".repeat(600)}`,
        { flag: "wx" },
      );
      return {
        status: "failed",
        output: "AssertionError: wrong value",
        evidence: {
          head,
          command: {
            executable: process.execPath,
            argv: ["fixture-pnpm", "run", gate],
            cwd: f.sourceTree,
          },
          log,
          cause: "diagnostic",
          diagnostics: ["feature.test.ts > preserves behavior"],
        },
      };
    }
    return "passed";
  };
  f.delivery.attributeGate = async (_config, gate, failure, main) => {
    controls.push({ head: failure.head, main, gate });
    return { cause, log: resolve(f.state, "base-control.log"), main };
  };
  f.setResolution(() => writeFile(resolve(f.sourceTree, "feature.txt"), "candidate fixed\n"));
  const run = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  return {
    ...f,
    run,
    gates,
    controls,
    setCause(value: typeof cause) {
      cause = value;
    },
    secondFailure(gate: string) {
      secondGate = gate;
    },
  };
}

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "corrects once with fresh review and resumes all gates (after mirror: %s, refresh: %s)",
  async (afterMirror, refresh) => {
    const f = await gateCorrectionFixture(afterMirror, refresh);
    const originals = await Promise.all(
      [
        "candidate",
        "author-attempt",
        "author-terminal",
        "reviewer-attempt",
        "reviewer-terminal",
      ].map(
        async (name) =>
          [name, await readFile(resolve(f.sourceState, `${name}.json`), "utf8")] as const,
      ),
    );
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    const capture = JSON.parse(
      await readFile(resolve(f.sourceState, "gate-correction.json"), "utf8"),
    );
    const log = await readFile(resolve(capture.delivery.stateDirectory, "full-gate.log"), "utf8");
    expect(log.length).toBeGreaterThan(4000);
    f.setRunning(true);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.authorPrompts[0]).toContain(capture.failedHead);
    expect(f.authorPrompts[0]).toContain(capture.main);
    expect(f.authorPrompts[0]).toContain("fixture-pnpm");
    expect(f.authorPrompts[0]).toContain("full-gate.log");
    expect(f.authorPrompts[0]).toContain(f.sourceState);
    f.setRunning(false);
    f.setReviewRunning(true);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    f.setReviewRunning(false);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const corrected = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
    expect(await f.git(f.sourceTree, ["merge-base", capture.failedHead, corrected])).toBe(
      capture.failedHead,
    );
    const result = JSON.parse(
      await readFile(resolve(f.sourceState, "gate-correction-result.json"), "utf8"),
    );
    expect(result).toMatchObject({ head: corrected, retries: 1 });
    expect(result.reviewId).not.toBe(capture.previousReview);
    expect(f.prompts.at(-1)).toContain("Independent DELTA review");
    expect(f.prompts.at(-1)).toContain(
      `Captured execution trace: ${JSON.stringify(resolve(capture.directory, "author.jsonl"))}.`,
    );
    expect(f.gates.filter((gate) => gate.head === corrected).map((gate) => gate.gate)).toEqual(
      afterMirror
        ? ["typecheck", "planning:board-check", "test"]
        : ["typecheck", "test", "planning:board-check"],
    );
    expect(f.controls).toEqual([{ head: capture.failedHead, main: capture.main, gate: "test" }]);
    const history = await f.adapter().history();
    const ids = history.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(history.slice(-2).map((row) => [row.role, row.outcome, row.placement?.model])).toEqual([
      ["author", "passed", "author"],
      ["reviewer", "passed", "reviewer"],
    ]);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect((await f.adapter().history()).map((row) => row.id)).toEqual(ids);
    expect(f.publications()).toBe(1);
    for (const [name, bytes] of originals)
      expect(await readFile(resolve(f.sourceState, `${name}.json`), "utf8")).toBe(bytes);
    expect(await readFile(resolve(capture.delivery.stateDirectory, "full-gate.log"), "utf8")).toBe(
      log,
    );
    expect(JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"))).toMatchObject({
      candidateAttempt: 1,
      head: corrected,
      reviewId: result.reviewId,
    });
  },
);

it.each(["base", "host", "unknown"] as const)(
  "stops %s attribution without consuming correction or publishing",
  async (cause) => {
    const f = await gateCorrectionFixture();
    f.setCause(cause);
    const reason = `gate-${cause === "base" ? "base-failed" : cause === "host" ? "host-failed" : "attribution-unknown"}:test`;
    await expect(f.run()).rejects.toThrow(reason);
    await f.advanceMain();
    await expect(f.run()).rejects.toThrow(reason);
    expect(f.authorPrompts).toEqual([]);
    expect(f.controls).toHaveLength(1);
    expect(f.publications()).toBe(0);
    await expect(readFile(resolve(f.sourceState, "gate-correction.json"))).rejects.toThrow();
  },
);

it("corrects an accepted review repair without changing its rejected predecessor or implementation count", async () => {
  const f = await gateCorrectionFixture();
  const acceptedHistory = await f.adapter().history();
  const prior = resolve(f.state, "prior-source");
  await mkdir(prior);
  f.item.source = { ...f.source, stateDirectory: prior };
  f.item.repair.stateDirectory = f.sourceState;
  const failedId = randomUUID();
  const history = [
    { ...acceptedHistory[0]!, ordinal: 1, id: randomUUID() },
    { ...acceptedHistory[1]!, ordinal: 2, id: failedId, outcome: "failed" },
    ...acceptedHistory.map((row) => ({ ...row, ordinal: row.ordinal + 2, stage: "repair" })),
  ];
  const rejected = JSON.stringify({
    id: failedId,
    head: f.head,
    status: "failed",
    summary: "Preserved blocking predecessor",
  });
  await writeFile(resolve(prior, "reviewer-terminal.json"), rejected);
  for (const row of history)
    await writeFile(
      resolve(f.state, `participant-${row.ordinal}-terminal.json`),
      JSON.stringify(row),
    );
  const path = resolve(f.state, "attempt.json");
  const attempt = JSON.parse(await readFile(path, "utf8"));
  await writeFile(
    path,
    JSON.stringify({ ...attempt, acceptedStage: "repair", candidateAttempt: 2, history }),
  );
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    candidateAttempt: 2,
    acceptedStage: "repair",
    retries: 1,
  });
  expect(await readFile(resolve(prior, "reviewer-terminal.json"), "utf8")).toBe(rejected);
  expect((await f.adapter().history()).map((row) => row.outcome)).toEqual([
    "passed",
    "failed",
    "passed",
    "passed",
    "passed",
    "passed",
  ]);
  expect(f.authorPrompts).toHaveLength(1);
});

it.each([false, true])(
  "retains the correction allowance and fresh authority when main moves again (second failure: %s)",
  async (secondFailure) => {
    const f = await gateCorrectionFixture(true);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    f.setMoving();
    if (secondFailure) f.secondFailure("typecheck");
    if (secondFailure) {
      await expect(f.run()).rejects.toThrow("gate-correction-exhausted:typecheck");
      await expect(f.run()).rejects.toThrow("gate-correction-exhausted:typecheck");
    } else {
      await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      const corrected = JSON.parse(
        await readFile(resolve(f.sourceState, "gate-correction-result.json"), "utf8"),
      );
      expect(f.publication()?.head).not.toBe(corrected.head);
      expect(f.gates.slice(-3).map((row) => row.head)).toEqual(
        Array(3).fill(f.publication()?.head),
      );
      expect(f.gates.slice(-3).map((row) => row.gate)).toEqual([
        "typecheck",
        "planning:board-check",
        "test",
      ]);
    }
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(2);
  },
);

it("reconciles the correction commit and completes delivery without repeating completed effects", async () => {
  const f = await gateCorrectionFixture();
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  f.loseCommit("resolution");
  await expect(f.run()).rejects.toThrow("lost conflict commit response");
  let merged = false;
  let cleaned = false;
  let mergeCount = 0;
  let cleanupCount = 0;
  f.delivery.checks = async (current) => ({
    head: current.candidateHead,
    checks: current.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: "https://example.test/check",
    })),
  });
  f.delivery.observeMerge = async (current, publication) =>
    merged
      ? {
          state: "confirmed",
          value: {
            number: publication.number,
            head: current.candidateHead,
            mergeCommit: current.candidateHead,
          },
        }
      : { state: "needs-mutation" };
  f.delivery.merge = async () => {
    mergeCount++;
    merged = true;
  };
  f.delivery.observeCleanup = async (_current, plan) =>
    cleaned
      ? { state: "confirmed", value: { worktrees: plan.worktrees, branch: plan.branch } }
      : { state: "needs-mutation" };
  f.delivery.cleanup = async () => {
    cleanupCount++;
    cleaned = true;
  };
  await expect(f.run()).resolves.toMatchObject({ status: "complete" });
  const attempt = await readFile(resolve(f.state, "attempt.json"), "utf8");
  await expect(f.run()).resolves.toMatchObject({ status: "complete" });
  await expect(f.deliver()).resolves.toMatchObject({ status: "complete" });
  expect(await readFile(resolve(f.state, "attempt.json"), "utf8")).toBe(attempt);
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
  expect([f.publications(), mergeCount, cleanupCount]).toEqual([1, 1, 1]);
});

it.each(["terminal-head", "report-head", "author-identity"])(
  "rejects correction review with stale %s",
  async (mode) => {
    const f = await gateCorrectionFixture();
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    const observe = f.native.observe;
    f.native.observe = async (role, current, attempt) => {
      const terminal = await observe(role, current, attempt);
      if (role === "reviewer") {
        if (mode === "terminal-head") terminal.head = f.head;
        if (mode === "report-head")
          terminal.summary = terminal.summary!.replace(terminal.head!, f.head);
        if (mode === "author-identity")
          terminal.id = JSON.parse(
            await readFile(resolve(current.stateDirectory, "author-attempt.json"), "utf8"),
          ).id;
      }
      return terminal;
    };
    const failure = await f.run().then(
      () => undefined,
      (error: Error & { reason: string }) => error,
    );
    expect({
      reason: failure?.reason,
      publications: f.publications(),
      gates: f.gates.length,
    }).toEqual({
      reason:
        mode === "terminal-head"
          ? "reviewer-wrong-head"
          : mode === "report-head"
            ? "reviewer-malformed"
            : "malformed-terminal",
      publications: 0,
      gates: 2,
    });
  },
);

it.each(["author", "reviewer", "second-gate", "launch-ceiling", "accepted-replan"])(
  "stops the correction at %s without a second pair",
  async (mode) => {
    const f = await gateCorrectionFixture(false, true);
    if (mode === "accepted-replan") f.item.acceptedReplan = "cs-7766-plan-8014";
    const run = mode === "accepted-replan" ? f.deliver : f.run;
    if (mode === "accepted-replan") {
      await expect(run()).rejects.toThrow("gate-correction-not-authorized");
      expect(f.authorPrompts).toEqual([]);
      return;
    }
    await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    if (mode === "author") f.failAuthor();
    if (mode === "reviewer") f.setFailReview();
    if (mode === "second-gate") f.secondFailure("typecheck");
    if (mode === "launch-ceiling") f.config.nativeLaunchCeiling = 3;
    const reason =
      mode === "author"
        ? "gate-correction-failed"
        : mode === "reviewer"
          ? "gate-correction-review-failed"
          : mode === "second-gate"
            ? "gate-correction-exhausted:typecheck"
            : "native-launch-ceiling-exhausted";
    await expect(run()).rejects.toThrow(reason);
    const ids = (await f.adapter().history()).map((row) => row.id);
    await expect(run()).rejects.toThrow(reason);
    expect((await f.adapter().history()).map((row) => row.id)).toEqual(ids);
    expect(f.authorPrompts.length).toBeLessThanOrEqual(1);
    expect(f.publications()).toBe(0);
  },
);

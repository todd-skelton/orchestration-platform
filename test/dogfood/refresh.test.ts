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

async function fixture(seedKeys = ["ISS-100"], temporaryRoot = tmpdir()) {
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
  await writeFile(resolve(repo, "feature.txt"), "old\n");
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
  await writeFile(resolve(sourceTree, "feature.txt"), "candidate\n");
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
  let failReview = false;
  let malformedReview = false;
  let unavailableMain = false;
  let moveDuringReview = false;
  let lostIntegrationResponse = false;
  const prompts: string[] = [];
  const reviewerModels: string[] = [];
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (unavailableMain && args[0] === "fetch") throw new Error("offline");
      const result = await git(tree, args);
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
      expect(role).toBe("reviewer");
      reviewerModels.push(_config.reviewer.model);
      prompts.push(prompt);
      return {
        id: randomUUID(),
        pid: 200 + prompts.length,
        trace: resolve(state, `delta-${prompts.length}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(_role, current, attempt) {
      if (running) return { id: attempt.id, status: "running" };
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
      if (stopGate) return { status: "failed", output: "interrupted gate" };
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
        if (observation.state === "confirmed") publication = observation.value;
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
    async checks(current) {
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
      async ghJson() {
        return [
          {
            number: 200,
            url: item.delivery.refresh!.url,
            headRefOid: await remoteHead(),
            headRefName: "codex/iss-100",
            baseRefName: "main",
            state: "OPEN",
            isDraft: true,
            title,
            body,
          },
        ];
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
    reviewerModels,
    gateHeads,
    adapter,
    saveAttempt,
    enablePublicationRefresh,
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
  await expect(f.deliver()).rejects.toThrow("gate-failed:planning:board-check");
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
      await expect(f.deliver()).rejects.toThrow("gate-failed:planning:board-check");
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
    await expect(f.deliver()).rejects.toThrow("gate-failed:planning:board-check");
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

it.each([false, true])(
  "uses the existing typed rebase conflict stop for the ISS-147 handoff (existing PR: %s)",
  async (existingPR) => {
    const f = await fixture();
    if (existingPR) await f.enablePublicationRefresh();
    await writeFile(resolve(f.repo, "feature.txt"), "conflicting main\n");
    await f.advanceMain();
    await expect(f.deliver()).rejects.toThrow("rebase-conflict");
    expect(await f.git(f.sourceTree, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(await f.git(f.sourceTree, ["status", "--porcelain"])).toBe("");
    expect(f.prompts).toEqual([]);
    expect(f.gateHeads).toEqual([]);
  },
);

it.each(["pass", "exhausted", "restart"])(
  "keeps a refreshed gate retry on its reviewed head: %s",
  async (mode) => {
    const f = await fixture();
    await f.advanceMain();
    await f.saveAttempt();
    f.failTypecheck(mode === "exhausted" ? 2 : 1, mode === "restart");
    const step = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
    if (mode === "exhausted") {
      await expect(step()).rejects.toThrow("gate-retry-exhausted:typecheck");
      expect(f.publication()).toBeUndefined();
    } else {
      if (mode === "restart") await expect(step()).rejects.toThrow("delivery-state-unknown");
      await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    }
    const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
    expect(attempt).toMatchObject({ retries: 1, candidateAttempt: 1, head: f.gateHeads[0] });
    expect(attempt.reviewId).not.toBe(f.reviewer.id);
    expect(f.prompts).toHaveLength(1);
    expect(new Set(f.gateHeads).size).toBe(1);
  },
);

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

it("retains the delta reviewer retry and gate retry across queue resume", async () => {
  const f = await fixture();
  await f.advanceMain();
  await f.saveAttempt();
  f.malformReview();
  f.failTypecheck(1, true);
  const step = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  await expect(step()).rejects.toThrow("delivery-state-unknown");
  await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
  expect(attempt).toMatchObject({ retries: 2, candidateAttempt: 1 });
  expect(f.prompts).toHaveLength(2);
  expect(attempt.history.map((row: { outcome: string }) => row.outcome)).toEqual([
    "passed",
    "passed",
    "malformed",
    "passed",
  ]);
});

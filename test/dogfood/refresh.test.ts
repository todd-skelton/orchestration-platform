import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { evidenceDescriptor, replanPacket, writeEvidence } from "./fixtures/continuation.js";
import {
  cp,
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
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  repositoryQueueAdapter,
  QueueBlocked,
  queueStep,
  queueUsage,
  type QueueConfig,
  type QueueItem,
} from "../../scripts/dogfood/queue.js";
import type { Adapter, Config, Attempt, NativeDbIdentity } from "../../scripts/dogfood/flow.js";
import {
  createNativeDbAdmission,
  nativeDbProfileAdapter,
} from "../../scripts/dogfood/supervise.mjs";
import {
  resolveConflict,
  withinConflictHunks,
  type Conflict,
} from "../../scripts/dogfood/conflict.js";
import type {
  DeliveryAdapter,
  DeliveryConfig,
  PublicationEvidence,
} from "../../scripts/dogfood/delivery.js";
import {
  loadPlanningSnapshot,
  parseFrontmatter,
  type PlanningSnapshot,
} from "../../scripts/planning/check.mjs";
import {
  expectedBoardItems,
  boardMismatches,
  validateBoardSnapshot,
  loadBoardSnapshot,
  loadProjectSnapshot,
  type BoardSnapshot,
} from "../../scripts/planning/board-check.mjs";
import { selfPlanFromSnapshots, requiredChecks } from "../../adapters/self.mjs";
import * as self from "../../adapters/self.mjs";
import { candidatePlanningBase } from "../../scripts/planning/candidate-board.mjs";
import { repositoryDeliveryPolicy } from "../../scripts/dogfood/repository-adapter.mjs";
import { isItemStopReason } from "../../scripts/dogfood/supervision.js";

vi.mock("../../scripts/planning/board-check.mjs", async (original) => ({
  ...(await original<object>()),
  loadBoardSnapshot: vi.fn(),
  loadProjectSnapshot: vi.fn(),
}));

const exec = promisify(execFile);
const gateAuthority = "https://github.com/fixture/repository/issues/494#issuecomment-5687186310";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
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
        `---\nkey: ${key}\ntitle: "Do ${key}"\nlabels: ["type:slice", "ready"]\nmilestone: "First"\nblocked_by: []\n---\n\n## Why\n\nUseful.\n\n## Done when\n\n- Preserve behavior.\n`,
      ]),
    ),
  };
}

async function fixture(
  seedKeys = ["ISS-100"],
  temporaryRoot = tmpdir(),
  routeList = false,
  fixed = { prefix: "", suffix: "" },
  snapshot?: PlanningSnapshot,
  selection = { key: "ISS-100", number: 100 },
  initialFiles: Record<string, string> = {},
) {
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
    return (
      await exec("git", [
        "-C",
        cwd,
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "user.name=Fixture",
        ...actual,
      ])
    ).stdout.trim();
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
  await mkdir(resolve(repo, "docs"));
  await writeFile(resolve(repo, "docs/loop.md"), "Fixture loop rules.\n");
  await writePlanning(repo, snapshot ?? planning(seedKeys));
  await writeFile(
    resolve(repo, "feature.txt"),
    routeList ? "const routes = [\n  'existing',\n];\n" : `${fixed.prefix}old\n${fixed.suffix}`,
  );
  for (const [file, contents] of Object.entries(initialFiles))
    await writeFile(resolve(repo, file), contents);
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
  const candidatePlanning = structuredClone(snapshot ?? planning(seedKeys));
  candidatePlanning.issueDrafts[selection.key] += "\nCandidate planning delta.\n";
  await writePlanning(sourceTree, candidatePlanning);
  await writeFile(
    resolve(sourceTree, "feature.txt"),
    routeList
      ? "const routes = [\n  'existing',\n  'reviewed',\n];\n"
      : `${fixed.prefix}candidate\n${fixed.suffix}`,
  );
  let head = await commit(sourceTree);
  await git(repo, ["worktree", "add", "--detach", reviewTree, head]);
  const checks = requiredChecks({ repository: planning([]).roadmap.repository }) as string[];
  const source: Config = {
    owner: "fixture",
    run: "refresh-fixture",
    issue: `https://github.com/todd-skelton/orchestration-platform/issues/${selection.number}`,
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
  const writeSourceEvidence = async () => {
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
  // The review worktree was just created at head; only later mutations need repinning.
  await writeSourceEvidence();
  const pinSource = async () => {
    head = await git(sourceTree, ["rev-parse", "HEAD"]);
    await git(reviewTree, ["checkout", "--detach", head]);
    await writeSourceEvidence();
  };
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
      policy: { ...selection, title: `Do ${selection.key}`, sourceBranch: "codex/iss-100" },
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
        number: row.key === selection.key ? selection.number : Number(row.key.slice(4)),
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
  // ISS-165: the run-owned channel composed onto this fixture's native adapter.
  // `receivers` are the actual objects delivery hands to flow and its callers.
  const receivers: Adapter[] = [];
  const channelInput = new PassThrough();
  const channelOutput = new PassThrough();
  const written: string[] = [];
  channelOutput.on("data", (chunk) => written.push(String(chunk)));
  const syntheticRun = "synthetic-native-component";
  const admission = createNativeDbAdmission(syntheticRun, channelInput, channelOutput, {
    approvedParents: [root],
  });
  const native: Adapter = nativeDbProfileAdapter(execution(), admission);
  function execution(): Adapter {
    return {
      async preflight() {},
      async git(tree, args) {
        if (!receivers.includes(this)) receivers.push(this);
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
  }
  const channel = {
    written,
    receivers,
    close: () => admission.close(),
    identity: (): NativeDbIdentity => ({
      profile: "reconciliation-pg16/v1",
      run: syntheticRun,
      issue: 100,
      attempt: 1,
      executorHead: "0".repeat(40),
      product: { repository: "fixture/repository", head: "1".repeat(40), tree: "2".repeat(40) },
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
      stagedInputDirectory: resolve(root, "staged-input"),
    }),
    async invoke(adapter: Adapter) {
      expect(typeof adapter.nativeDbProfile).toBe("function");
      const ordinal = written.length + 1;
      const pending = adapter.nativeDbProfile!(channel.identity());
      await new Promise((done) => setImmediate(done));
      expect(written).toHaveLength(ordinal);
      expect(JSON.parse(written[ordinal - 1]!)).toEqual({
        schemaVersion: "dogfood-native-db-request/v1",
        correlation: ordinal,
        ...channel.identity(),
      });
      channelInput.write(
        `${JSON.stringify({
          schemaVersion: "dogfood-native-db-reply/v1",
          correlation: ordinal,
          status: "refused",
          owner: null,
          evidencePath: null,
          diagnostic: "synthetic incumbent refusal",
        })}\n`,
      );
      expect(await pending).toEqual({
        correlation: ordinal,
        status: "refused",
        owner: null,
        evidencePath: null,
        diagnostic: "synthetic incumbent refusal",
      });
    },
  };
  const draftEdits: string[][] = [];
  const realDelivery = githubDeliveryAdapter({
    async ghJson(_current, args) {
      if (args[0] !== "issue" || args[1] !== "view") throw new Error("unexpected GitHub read");
      const row = board.issues.find((row) => row.number === Number(args[2]));
      return row && { ...row, milestone: row.milestone ? { title: row.milestone } : null };
    },
    async gh(_current, args) {
      if (args[0] !== "issue" || args[1] !== "edit") throw new Error("unexpected GitHub write");
      draftEdits.push(args);
      drafts++;
      const row = board.issues.find((row) => row.number === Number(args[2]))!;
      row.body = await readFile(args[args.indexOf("--body-file") + 1]!, "utf8");
      if (args.includes("--title")) row.title = args[args.indexOf("--title") + 1]!;
      if (args.includes("--milestone")) row.milestone = args[args.indexOf("--milestone") + 1]!;
      if (args.includes("--remove-milestone")) row.milestone = null;
      return "";
    },
  });
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
      const plan = await repositoryDeliveryPolicy(self, "git").plan(current);
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
    channel,
    policy,
    draftEdits,
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

// Recorded ISS-174 failure: these six drafts were OPEN and retained their native numbers.
const regressionSiblings = new Map([
  ["ISS-146", 457],
  ["ISS-164", 517],
  ["ISS-165", 518],
  ["ISS-167", 524],
  ["ISS-171", 525],
  ["ISS-176", 537],
]);

async function siblingRegression() {
  // Freeze the six real drafts at 11a165dc; removing these lines on live main must
  // not remove the regression's input. Other rows are synthetic closed scaffolding.
  const originals = new Map(
    await Promise.all(
      [...regressionSiblings.keys()].map(
        async (key) =>
          [
            key,
            await readFile(resolve(import.meta.dirname, `fixtures/iss-178/${key}.txt`), "utf8"),
          ] as const,
      ),
    ),
  );
  const keys = new Set(["ISS-174", ...originals.keys()]);
  for (const [key, draft] of originals)
    for (const dependency of parseFrontmatter(draft, key).blocked_by) keys.add(dependency);
  const base = planning([...keys]);
  const milestone = "Chase Sets delivery adapter";
  base.roadmap.milestones = [{ key: "M2", title: milestone }];
  for (const row of base.roadmap.issues) {
    row.milestone = "M2";
    const draft = originals.get(row.key);
    if (draft) {
      base.issueDrafts[row.key] = draft;
      row.blockedBy = parseFrontmatter(draft, row.key).blocked_by;
    } else
      base.issueDrafts[row.key] = base.issueDrafts[row.key]!.replace(
        'milestone: "First"',
        `milestone: "${milestone}"`,
      );
  }
  const f = await fixture(undefined, undefined, undefined, undefined, base, {
    key: "ISS-174",
    number: 529,
  });
  for (const row of f.board().issues) {
    const key = /planning-key: (ISS-\d+)/.exec(row.body)![1]!;
    row.state = key === "ISS-174" || regressionSiblings.has(key) ? "OPEN" : "CLOSED";
    row.number = regressionSiblings.get(key) ?? row.number;
  }
  const candidate = await loadPlanningSnapshot(f.sourceTree);
  for (const key of regressionSiblings.keys()) {
    const before = candidate.issueDrafts[key]!;
    const after = before.replace(/QUALITY_PROFILE: [^\r\n]+\r?\n\r?\n/, "");
    expect(after).not.toBe(before);
    candidate.issueDrafts[key] = after;
  }
  await f.writePlanning(f.sourceTree, candidate);
  await f.commit(f.sourceTree);
  await f.pinSource();
  const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  const config: DeliveryConfig = {
    controller: f.config.controller,
    run: f.config.run,
    issue: f.source.issue,
    repository: f.source.repository,
    repositoryRoot: f.repo,
    controllerRoot: f.repo,
    controllerRevision: f.config.controllerRevision,
    worktree: f.sourceTree,
    reviewWorktree: f.source.reviewWorktree,
    stateDirectory: f.sourceState,
    candidateHead: head,
    retries: 0,
    requiredChecks: f.source.requiredChecks,
    policy: f.item.delivery.policy,
  };
  const plan = await f.policy.plan(config);
  const fromSnapshots = selfPlanFromSnapshots(
    config,
    candidate,
    f.board(),
    {
      total: { added: 0, deleted: 12 },
      scripts: { added: 0, deleted: 0 },
      test: { added: 0, deleted: 0 },
    },
    await candidatePlanningBase(f.sourceTree, head),
  );
  expect(fromSnapshots.drafts).toEqual(plan.drafts);
  return { ...f, configForDelivery: config, plan, candidate, base, head };
}

it.each([false, true])(
  "mirrors the exact six ISS-174 deletions through native delivery before its scoped gate/publication (autocrlf: %s)",
  async (autocrlf) => {
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.autocrlf");
    vi.stubEnv("GIT_CONFIG_VALUE_0", String(autocrlf));
    const f = await siblingRegression();
    const selected = f.plan.drafts[0]!;
    const selectedRow = f.board().issues.find((row) => row.number === 529)!;
    selectedRow.body = selected.body;
    const problems = boardMismatches(f.candidate, f.board());
    expect(problems.sort()).toEqual(
      [...regressionSiblings.keys()].map((key) => `${key} body does not match its source draft`),
    );
    const diff = await f.git(f.sourceTree, [
      "diff",
      "--numstat",
      f.source.base,
      f.head,
      "--",
      ...[...regressionSiblings.keys()].map((key) => `planning/drafts/${key}.md`),
    ]);
    expect(diff.split("\n").map((line) => line.split("\t").slice(0, 2))).toEqual(
      Array(6).fill(["0", "2"]),
    );
    expect(f.plan.drafts.map((draft) => draft.issue)).toEqual([
      529,
      ...regressionSiblings.values(),
    ]);
    const before = structuredClone(f.board());
    await expect(f.deliver()).resolves.toMatchObject({
      status: "observing-hosted-checks",
      head: f.head,
    });
    expect(f.draftEdits.map((args) => Number(args[2]))).toEqual([...regressionSiblings.values()]);
    expect(f.draftEdits.every((args) => args.length === 5 && args[3] === "--body-file")).toBe(true);
    for (const [index, row] of f.board().issues.entries())
      expect({ ...row, body: before.issues[index]!.body }).toEqual(before.issues[index]);
    expect(boardMismatches(f.candidate, f.board())).toEqual([]);
    expect(f.publications()).toBe(1);
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.draftEdits).toHaveLength(6);
    expect(f.publications()).toBe(1);
  },
);

it("names the unmirrored sibling and refuses publication when only one mirror is suppressed", async () => {
  const f = await siblingRegression();
  const plan = f.policy.plan;
  f.policy.plan = async (current) => {
    const value = await plan(current);
    value.drafts = value.drafts.filter((draft) => draft.key !== "ISS-176");
    return value;
  };
  await expect(f.deliver()).rejects.toThrow("gate-attribution-unknown:planning:board-check");
  expect(await readFile(resolve(f.sourceState, "board-failure.log"), "utf8")).toContain(
    "ISS-176 body does not match its source draft",
  );
  expect(f.publications()).toBe(0);
});

it.each(["missing", "duplicate", "retargeted", "title", "milestone", "body"])(
  "refuses synthetic sibling %s at plan time without edits",
  async (mode) => {
    const f = await siblingRegression();
    const row = f.board().issues.find((row) => row.number === 457)!;
    if (mode === "missing") f.board().issues = f.board().issues.filter((item) => item !== row);
    if (mode === "duplicate") f.board().issues.push({ ...row, number: 999 });
    if (mode === "retargeted")
      row.body = row.body.replace("planning-key: ISS-146", "planning-key: ISS-999");
    if (mode === "title") row.title += " drift";
    if (mode === "milestone") row.milestone = "drift";
    if (mode === "body") row.body += "\nUnexpected prose.\n";
    f.board().totalCount = f.board().issues.length;
    await expect(f.deliver()).rejects.toThrow(/ISS-146/);
    expect(f.draftEdits).toHaveLength(0);
    expect(f.publications()).toBe(0);
  },
);

it.each([false, true])(
  "reobserves synthetic closure after plan persistence (partial mirror: %s)",
  async (partial) => {
    const f = await siblingRegression();
    const observe = f.delivery.observeDraft;
    let interrupted = false;
    f.delivery.observeDraft = async (current, draft) => {
      if (!interrupted && draft.key === (partial ? "ISS-165" : "ISS-174")) {
        interrupted = true;
        throw new Error("fixture interruption after persisted plan");
      }
      return observe(current, draft);
    };
    await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    const saved = await readFile(resolve(f.sourceState, "delivery-plan.json"), "utf8");
    expect(JSON.parse(saved).plan.drafts).toHaveLength(7);
    f.board().issues.find((row) => row.number === 537)!.state = "CLOSED";
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.draftEdits.some((args) => args[2] === "537")).toBe(false);
    expect(new Set(f.draftEdits.map((args) => args[2])).size).toBe(f.draftEdits.length);
    expect(await readFile(resolve(f.sourceState, "delivery-plan.json"), "utf8")).toBe(saved);
    expect(boardMismatches(f.candidate, f.board())).toEqual([]);
  },
);

it.each(["title", "milestone"])(
  "refuses synthetic OPEN %s drift on saved-plan replay even at target body",
  async (field) => {
    const f = await siblingRegression();
    const observe = f.delivery.observeDraft;
    let stop = true;
    f.delivery.observeDraft = async (current, draft) => {
      if (stop) throw new Error("fixture interruption");
      return observe(current, draft);
    };
    await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    stop = false;
    const row = f.board().issues.find((row) => row.number === 457)!;
    row.body = f.plan.drafts.find((draft) => draft.key === "ISS-146")!.body;
    if (field === "title") row.title += " drift";
    else row.milestone = "drift";
    await expect(f.deliver()).rejects.toThrow("self-sibling-refused:ISS-146");
    expect(f.draftEdits.filter((args) => args[2] !== "529")).toHaveLength(0);
    expect(f.publications()).toBe(0);
  },
);

it("reconciles a sibling edit's lost response without repeating its body write", async () => {
  const f = await siblingRegression();
  const apply = f.delivery.applyDraft;
  const observe = f.delivery.observeDraft;
  let lost = false;
  let unavailable = false;
  f.delivery.applyDraft = async (current, draft) => {
    await apply(current, draft);
    if (draft.key === "ISS-146" && !lost) {
      lost = true;
      unavailable = true;
      throw new Error("lost response");
    }
  };
  f.delivery.observeDraft = async (current, draft) => {
    if (unavailable) throw new Error("temporary read outage");
    return observe(current, draft);
  };
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  unavailable = false;
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.draftEdits.filter((args) => args[2] === "457")).toHaveLength(1);
  expect(f.draftEdits).toHaveLength(7);
});

async function syntheticSibling() {
  const f = await fixture(["ISS-100", "ISS-101", "ISS-102"]);
  const candidate = await loadPlanningSnapshot(f.sourceTree);
  candidate.issueDrafts["ISS-101"] += "\nReviewed synthetic sibling prose.\n";
  await f.writePlanning(f.sourceTree, candidate);
  await f.commit(f.sourceTree);
  await f.pinSource();
  const row = f.board().issues.find((row) => row.number === 101)!;
  return { ...f, row, candidate };
}

it.each(["title", "milestone", "body", "missing", "duplicate", "retarget", "reopened"])(
  "refuses synthetic %s during saved sibling replay, including a recorded no-op",
  async (mode) => {
    const f = await syntheticSibling();
    // Stop after all draft receipts, before afterMirror. The second call must observe again.
    f.setStopGate(true);
    await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    const writes = f.draftEdits.length;
    if (mode === "title") f.row.title += " drift";
    if (mode === "milestone") f.row.milestone = "drift";
    if (mode === "body") f.row.body += "\nUnexpected prose";
    if (mode === "missing") f.board().issues = f.board().issues.filter((row) => row !== f.row);
    if (mode === "duplicate") f.board().issues.push({ ...f.row, number: 999 });
    if (mode === "retarget") f.row.number = 998;
    if (mode === "reopened") f.row.reopenedEvent = "RE_fixture_2";
    f.board().totalCount = f.board().issues.length;
    f.setStopGate(false);
    await expect(f.deliver()).rejects.toThrow("self-sibling-refused:ISS-101");
    expect(f.draftEdits).toHaveLength(writes);
    expect(f.publications()).toBe(0);
  },
);

it.each(["base", "other", "target"])(
  "checks synthetic OPEN metadata separately from its %s body at mutation time",
  async (body) => {
    for (const field of ["title", "milestone"] as const) {
      const f = await syntheticSibling();
      const apply = f.delivery.applyDraft;
      f.delivery.applyDraft = async (current, draft) => {
        if (draft.key === "ISS-101") {
          f.row[field] += " drift";
          if (body === "other") f.row.body += "\nUnexpected prose";
          if (body === "target") f.row.body = draft.body;
        }
        return apply(current, draft);
      };
      await expect(f.deliver()).rejects.toThrow("self-sibling-refused:ISS-101");
      expect(f.draftEdits.filter((args) => args[2] === "101")).toHaveLength(0);
      expect(f.publications()).toBe(0);
    }
  },
);

it("leaves unchanged drift and initially CLOSED siblings untouched while full-board consumers refuse", async () => {
  const f = await syntheticSibling();
  f.row.state = "CLOSED";
  f.board().issues.find((row) => row.number === 102)!.body += "\nUnrelated drift";
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100"]);
  expect(() => validateBoardSnapshot(f.candidate, f.board())).toThrow("ISS-102 body");
  await expect(
    self.selectCandidates({
      repository: f.source.repository,
      planning: f.candidate,
      board: f.board(),
    }),
  ).rejects.toThrow("ISS-102 body");
});

it("keeps pinned saved selection while ahead bodies refuse fresh selection until published main", async () => {
  const f = await syntheticSibling();
  for (const row of f.board().issues) row.labels = ["ready"];
  const input = {
    repository: f.source.repository,
    key: "ISS-100",
    number: 100,
    executorRoot: f.repo,
    planningRevision: f.source.base,
  };
  const selected = await self.issueContext(input);
  f.setStopGate(true);
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  await expect(self.issueContext(input)).resolves.toEqual(selected);
  await expect(
    self.selectCandidates({
      repository: f.source.repository,
      executorRoot: f.repo,
      planningRevision: f.source.base,
    }),
  ).rejects.toThrow("body does not match");
  // Abandonment has the same refusal: there is no automatic body restoration.
  await expect(
    self.selectCandidates({
      repository: f.source.repository,
      executorRoot: f.repo,
      planningRevision: f.source.base,
    }),
  ).rejects.toThrow("body does not match");
  f.setStopGate(false);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  // Synthetic hosted/merge controls; this is selection behavior, not external CI evidence.
  f.delivery.checks = async () => ({
    head,
    checks: f.source.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: "https://fixture.test/check",
    })),
  });
  let merged = false;
  f.delivery.observeMerge = async () =>
    merged
      ? { state: "confirmed", value: { number: 200, head, mergeCommit: head } }
      : { state: "needs-mutation" };
  f.delivery.merge = async () => {
    await f.git(f.repo, ["merge", "--ff-only", head]);
    f.board().issues.find((row) => row.number === 100)!.state = "CLOSED";
    merged = true;
  };
  f.delivery.verifyWorkspace = async () => true;
  f.delivery.observeCleanup = async () => ({
    state: "confirmed",
    value: { worktrees: [f.sourceTree, f.source.reviewWorktree], branch: "codex/iss-100" },
  });
  await expect(f.deliver()).resolves.toMatchObject({ status: "complete" });
  await expect(f.deliver()).resolves.toMatchObject({ status: "complete" });
  expect(
    await self.selectCandidates({
      repository: f.source.repository,
      executorRoot: f.repo,
      planningRevision: head,
    }),
  ).toHaveLength(2);
  await expect(self.issueContext(input)).resolves.toEqual(selected);
  expect(f.draftEdits).toHaveLength(2);
});

it("refreshes retained partial sibling mirroring before new exact-head DELTA/gates and never applies stale prose", async () => {
  const f = await syntheticSibling();
  const observe = f.delivery.observeDraft;
  let stop = true;
  f.delivery.observeDraft = async (current, draft) => {
    if (stop && draft.key === "ISS-101") throw new Error("interrupted partial mirror");
    return observe(current, draft);
  };
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  const oldPlan = await readFile(resolve(f.sourceState, "delivery-plan.json"), "utf8");
  const originalHead = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  const mainPlanning = planning(["ISS-100", "ISS-101", "ISS-102", "ISS-103"]);
  mainPlanning.issueDrafts["ISS-101"] = mainPlanning.issueDrafts["ISS-101"]!.replace(
    "Useful.",
    "Main's new explanation.",
  );
  await f.writePlanning(f.repo, mainPlanning);
  const main = await f.commit(f.repo);
  await f.git(f.repo, ["push", resolve(f.root, "remote.git"), "main"]);
  f.config.controllerRevision = main;
  f.item.setup.controllerRevision = main;
  // Host published main's sibling body; the selected ahead body remains untouched.
  f.row.body = expectedBoardItems(mainPlanning).find((row) => row.key === "ISS-101")!.body;
  stop = false;
  f.setReviewRunning(true);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100"]);
  expect(f.gateHeads).toEqual([]);
  f.setReviewRunning(false);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  const refreshed = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  expect(refreshed).not.toBe(originalHead);
  expect(f.prompts).toHaveLength(1);
  expect(f.gateHeads).toEqual([refreshed]);
  expect(f.row.body).toContain("Main's new explanation.");
  expect(f.row.body).toContain("Reviewed synthetic sibling prose.");
  expect(f.draftEdits.filter((args) => args[2] === "101")).toHaveLength(1);
  expect(await readFile(resolve(f.sourceState, "delivery-plan.json"), "utf8")).toBe(oldPlan);
  expect((await f.adapter().history()).map((row) => row.stage)).toEqual([
    "source",
    "source",
    "refresh",
  ]);
});

it.each(["title", "labels", "dependency", "milestone", "project"])(
  "refuses synthetic candidate sibling %s changes without metadata writes",
  async (field) => {
    const f = await syntheticSibling();
    const snapshot = await loadPlanningSnapshot(f.sourceTree);
    if (field === "title")
      snapshot.issueDrafts["ISS-101"] = snapshot.issueDrafts["ISS-101"]!.replace(
        'title: "Do ISS-101"',
        'title: "Retitled"',
      );
    if (field === "labels")
      snapshot.issueDrafts["ISS-101"] = snapshot.issueDrafts["ISS-101"]!.replace(', "ready"', "");
    if (field === "dependency") {
      snapshot.issueDrafts["ISS-101"] = snapshot.issueDrafts["ISS-101"]!.replace(
        "blocked_by: []",
        "blocked_by: [ISS-100]",
      );
      snapshot.roadmap.issues.find((row: { key: string }) => row.key === "ISS-101")!.blockedBy = [
        "ISS-100",
      ];
    }
    if (field === "milestone") {
      snapshot.roadmap.milestones.push({ key: "M2", title: "Second" });
      snapshot.roadmap.issues.find((row: { key: string }) => row.key === "ISS-101")!.milestone =
        "M2";
      snapshot.issueDrafts["ISS-101"] = snapshot.issueDrafts["ISS-101"]!.replace(
        'milestone: "First"',
        'milestone: "Second"',
      );
    }
    if (field === "project") snapshot.roadmap.project.id = "PVT_other";
    await f.writePlanning(f.sourceTree, snapshot);
    await f.commit(f.sourceTree);
    await f.pinSource();
    await expect(f.deliver()).rejects.toThrow("self-sibling-refused:ISS-101");
    expect(f.draftEdits).toHaveLength(0);
  },
);

it("reobserves synthetic closure between observation and apply without issuing an edit", async () => {
  const f = await syntheticSibling();
  const apply = f.delivery.applyDraft;
  f.delivery.applyDraft = async (current, draft) => {
    if (draft.key === "ISS-101") f.row.state = "CLOSED";
    return apply(current, draft);
  };
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100"]);
});

it("reconciles pending publication with sibling receipts before newer main without duplicate writes", async () => {
  const f = await syntheticSibling();
  f.losePublicationObservation();
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  const mirrored = structuredClone(f.board().issues);
  const head = f.publication()!.head;
  await f.advanceMain(["ISS-100", "ISS-101", "ISS-102", "ISS-103"]);
  for (const row of f.board().issues) {
    const previous = mirrored.find((item) => item.number === row.number);
    if (previous) Object.assign(row, previous);
  }
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks", head });
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks", head });
  expect(f.publications()).toBe(1);
  expect(f.draftEdits).toHaveLength(2);
  expect(f.prompts).toHaveLength(0);
});

it("uses the same sibling plan from an accepted review-repair directory and preserves source evidence", async () => {
  const f = await syntheticSibling();
  const prior = await readFile(resolve(f.sourceState, "reviewer-terminal.json"), "utf8");
  const directory = f.item.repair.stateDirectory;
  await cp(f.sourceState, directory, { recursive: true });
  const pinned = JSON.parse(await readFile(resolve(directory, "config.json"), "utf8"));
  pinned.config.stateDirectory = directory;
  await writeFile(resolve(directory, "config.json"), JSON.stringify(pinned));
  let reviewId = "";
  for (const role of ["author", "reviewer"] as const) {
    const id = randomUUID();
    if (role === "reviewer") reviewId = id;
    for (const suffix of ["attempt", "terminal"]) {
      const path = resolve(directory, `${role}-${suffix}.json`);
      const record = JSON.parse(await readFile(path, "utf8"));
      record.id = id;
      if (suffix === "attempt") record.trace = resolve(directory, `${role}.jsonl`);
      await writeFile(path, JSON.stringify(record));
    }
  }
  const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  const run = () => f.adapter().delivery(f.item, { head, reviewId, stateDirectory: directory });
  f.setStopGate(true);
  await expect(run()).rejects.toThrow("delivery-state-unknown");
  f.setStopGate(false);
  await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100", "101"]);
  expect(await readFile(resolve(f.sourceState, "reviewer-terminal.json"), "utf8")).toBe(prior);
  expect(
    JSON.parse(await readFile(resolve(directory, "delivery-plan.json"), "utf8")).plan.drafts,
  ).toHaveLength(2);
  expect(f.prompts).toHaveLength(0);
});

it("reuses already mirrored siblings after a gate correction's fresh DELTA and scoped gate", async () => {
  const f = await gateCorrectionFixture(true, false, await syntheticSibling());
  const original = await readFile(resolve(f.sourceState, "reviewer-terminal.json"), "utf8");
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100", "101"]);
  f.setReviewRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.publications()).toBe(0);
  f.setReviewRunning(false);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.draftEdits.map((args) => args[2])).toEqual(["100", "101"]);
  const result = JSON.parse(
    await readFile(resolve(f.sourceState, "gate-correction-result.json"), "utf8"),
  );
  expect(f.gates.filter((gate) => gate.head === result.head).map((gate) => gate.gate)).toEqual([
    "typecheck",
    "planning:board-check",
    "test",
  ]);
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
  expect(await f.adapter().history()).toHaveLength(4);
  expect(await readFile(resolve(f.sourceState, "reviewer-terminal.json"), "utf8")).toBe(original);
});

async function savedGateStop(
  afterMirror = false,
  refreshed = false,
  corrected = false,
  repaired = false,
) {
  const f = await gateCorrectionFixture(afterMirror, refreshed);
  let acceptedDirectory = f.sourceState;
  if (repaired) {
    acceptedDirectory = f.item.repair.stateDirectory;
    await cp(f.sourceState, acceptedDirectory, { recursive: true });
    const pinned = JSON.parse(await readFile(resolve(acceptedDirectory, "config.json"), "utf8"));
    pinned.config.stateDirectory = acceptedDirectory;
    await writeFile(resolve(acceptedDirectory, "config.json"), JSON.stringify(pinned));
    const prior = await f.adapter().history();
    await writeFile(
      resolve(f.state, "participant-2-terminal.json"),
      JSON.stringify({ ...prior[1], outcome: "failed" }),
    );
    for (const [index, role] of (["author", "reviewer"] as const).entries()) {
      const id = randomUUID();
      for (const suffix of ["attempt", "terminal"]) {
        const path = resolve(acceptedDirectory, `${role}-${suffix}.json`);
        const record = JSON.parse(await readFile(path, "utf8"));
        if (suffix === "attempt") record.trace = resolve(acceptedDirectory, `${role}.jsonl`);
        await writeFile(path, JSON.stringify({ ...record, id }));
      }
      await writeFile(
        resolve(f.state, `participant-${index + 3}-terminal.json`),
        JSON.stringify({ ...prior[index], ordinal: index + 3, id, stage: "repair" }),
      );
    }
    const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
    const review = JSON.parse(
      await readFile(resolve(acceptedDirectory, "reviewer-attempt.json"), "utf8"),
    );
    await writeFile(
      resolve(f.state, "attempt.json"),
      JSON.stringify({
        ...attempt,
        acceptedStage: "repair",
        candidateAttempt: 2,
        stateDirectory: acceptedDirectory,
        reviewId: review.id,
        history: await f.adapter().history(),
      }),
    );
  }
  if (corrected) {
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
    f.secondFailure("typecheck");
  }
  f.setCause("unknown");
  const gate = corrected ? "typecheck" : "test";
  await expect(f.run()).rejects.toThrow(`gate-attribution-unknown:${gate}`);
  const stoppedHead = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  const failedDirectory = f.gates.at(-1)!.directory;
  const artifacts = resolve(
    failedDirectory,
    `gate-${createHash("sha256").update(gate).digest("hex")}`,
  );
  await mkdir(artifacts);
  // Synthetic execution artifacts with the production gate paths, not host verification.
  await writeFile(
    resolve(artifacts, "candidate.log"),
    await readFile(resolve(failedDirectory, "full-gate.log")),
  );
  await writeFile(
    resolve(artifacts, "candidate-terminal.json"),
    JSON.stringify({
      head: stoppedHead,
      command: {
        executable: process.execPath,
        argv: ["fixture-pnpm", "run", gate],
        cwd: f.sourceTree,
      },
      code: 1,
      signal: null,
    }),
  );
  const preserved = new Map<string, Buffer>();
  for (const directory of new Set([acceptedDirectory, failedDirectory, artifacts])) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (file.isFile())
        preserved.set(resolve(directory, file.name), await readFile(resolve(directory, file.name)));
    }
  }
  const main = await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
  const authorization = {
    stateDirectory: acceptedDirectory,
    candidateHead: stoppedHead,
    repairSha: main,
    authorityUrl: gateAuthority,
  };
  const grant = () => {
    f.config.gateStopAuthorization = authorization;
  };
  const gates: { head: string; gate: string; directory: string }[] = [];
  f.delivery.runGate = async (current, name, head) => {
    gates.push({ head, gate: name, directory: current.stateDirectory });
    return "passed";
  };
  return {
    ...f,
    sourceState: acceptedDirectory,
    grant,
    authorization,
    artifacts,
    preserved,
    gates,
    main,
    stoppedHead,
  };
}

it.each([
  [false, false, false, false],
  [true, false, false, false],
  [false, true, false, false],
  [true, true, false, false],
  [false, false, true, false],
  [true, false, false, true],
])(
  "continues a saved queue gate stop once with fresh DELTA and gates (mirror %s, refresh %s, correction %s, repaired %s)",
  async (afterMirror, refreshed, corrected, repaired) => {
    const f = await savedGateStop(afterMirror, refreshed, corrected, repaired);
    const oldPrompts = f.prompts.length;
    const oldAuthors = f.authorPrompts.length;
    const oldHistory = await f.adapter().history();
    await expect(f.run()).rejects.toThrow("gate-attribution-unknown:");
    expect(f.prompts).toHaveLength(oldPrompts);
    f.grant();
    f.setReviewRunning(true);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    const reservationPath = resolve(f.sourceState, "gate-stop-continuation.json");
    const reservation = await readFile(reservationPath, "utf8");
    const retained = JSON.parse(reservation);
    expect(retained.authorization).toEqual(f.authorization);
    expect(retained.sourceEvidence.head).toBe(f.stoppedHead);
    expect(f.prompts.at(-1)).toContain(resolve(f.artifacts, "candidate.log"));
    expect(f.prompts.at(-1)).toContain(resolve(f.artifacts, "candidate-terminal.json"));
    expect(f.prompts.at(-1)).toContain(f.main);
    expect(f.prompts.at(-1)).toContain(gateAuthority);
    expect(f.prompts.at(-1)).toContain("DELTA");
    expect(f.prompts.at(-1)).toContain("Captured execution trace:");
    expect(f.gates).toEqual([]);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(f.prompts).toHaveLength(oldPrompts + 1);
    f.setReviewRunning(false);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
    expect(head).not.toBe(f.stoppedHead);
    expect(await f.git(f.sourceTree, ["merge-base", head, f.main])).toBe(f.main);
    expect(f.gates.map((row) => row.gate)).toEqual(
      afterMirror
        ? ["typecheck", "planning:board-check", "test"]
        : ["typecheck", "test", "planning:board-check"],
    );
    expect(
      f.gates.every(
        (row) =>
          row.head === head &&
          row.directory.startsWith(resolve(f.sourceState, "gate-stop-continuation", "refresh-")),
      ),
    ).toBe(true);
    expect(f.authorPrompts).toHaveLength(oldAuthors);
    const history = await f.adapter().history();
    expect(history.slice(0, oldHistory.length)).toEqual(oldHistory);
    expect(history).toHaveLength(oldHistory.length + 1);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(await f.adapter().history()).toEqual(history);
    expect(f.publications()).toBe(1);
    expect(await readFile(reservationPath, "utf8")).toBe(reservation);
    for (const [path, bytes] of f.preserved) expect(await readFile(path)).toEqual(bytes);
  },
);

it.each([
  "absent",
  "directory",
  "head",
  "unavailable",
  "unchanged",
  "missing-repair",
  "included-repair",
  "work",
  "base",
  "legacy",
  "replan",
])(
  "refuses saved gate recovery with only %s changed before launches or publication",
  async (mode) => {
    const f = await savedGateStop();
    f.grant();
    let reason = "gate-attribution-unknown:test";
    if (mode === "absent") delete f.config.gateStopAuthorization;
    if (mode === "directory") f.config.gateStopAuthorization!.stateDirectory = f.state;
    if (mode === "head") {
      f.config.gateStopAuthorization!.candidateHead = f.source.base;
      reason = "gate-stop-head-mismatch";
    }
    if (mode === "unavailable") {
      f.setUnavailable();
      reason = "current-main-unavailable";
    }
    if (mode === "unchanged") {
      await f.git(f.repo, [
        "push",
        "--force",
        resolve(f.root, "remote.git"),
        `${f.source.base}:refs/heads/main`,
      ]);
      await f.git(f.repo, ["update-ref", "refs/remotes/origin/main", f.source.base]);
      reason = "gate-stop-repair-not-applicable";
    }
    if (mode === "missing-repair") {
      f.config.gateStopAuthorization!.repairSha = f.stoppedHead;
      reason = "gate-stop-repair-not-applicable";
    }
    if (mode === "included-repair") {
      f.config.gateStopAuthorization!.repairSha = f.source.base;
      reason = "gate-stop-repair-not-applicable";
    }
    if (["work", "base", "legacy"].includes(mode)) {
      reason =
        mode === "work"
          ? "gate-correction-exhausted:test"
          : mode === "base"
            ? "gate-base-failed:test"
            : "gate-failed:test";
      await writeFile(resolve(f.sourceState, "gate-stop.json"), JSON.stringify({ reason }));
    }
    if (mode === "replan") f.item.acceptedReplan = replanPacket(f.root, f.head);
    // Direct native adapter admission avoids unrelated accepted-replan config validation.
    await expect(f.deliver()).rejects.toThrow(reason);
    expect(f.prompts).toEqual([]);
    expect(f.authorPrompts).toEqual([]);
    expect(f.publications()).toBe(0);
    await expect(readFile(resolve(f.sourceState, "gate-stop-continuation.json"))).rejects.toThrow();
  },
);

it("retains a new failed DELTA stop without spending another recovery after main moves", async () => {
  const f = await savedGateStop();
  f.grant();
  f.setFailReview();
  await expect(f.run()).rejects.toThrow("refresh-review-failed");
  const reservation = await readFile(resolve(f.sourceState, "gate-stop-continuation.json"));
  const history = await f.adapter().history();
  await f.advanceMain(["ISS-100", "ISS-101", "ISS-102", "ISS-103"]);
  await expect(f.run()).rejects.toThrow("refresh-review-failed");
  expect(await f.adapter().history()).toEqual(history);
  expect(await readFile(resolve(f.sourceState, "gate-stop-continuation.json"))).toEqual(
    reservation,
  );
  expect(f.prompts).toHaveLength(1);
  expect(f.gates).toEqual([]);
  expect(f.publications()).toBe(0);
  for (const [path, bytes] of f.preserved) expect(await readFile(path)).toEqual(bytes);
});

it.each(["reservation", "integration", "gates"])(
  "resumes saved recovery after interruption at %s",
  async (mode) => {
    const f = await savedGateStop();
    f.grant();
    const git = f.native.git;
    const runGate = f.delivery.runGate;
    let fetches = 0;
    if (mode === "reservation")
      f.native.git = async (tree, args) => {
        if (args[0] === "fetch" && ++fetches === 2) throw new Error("host interrupted");
        return git(tree, args);
      };
    if (mode === "integration") f.loseIntegrationResponse();
    if (mode === "gates")
      f.delivery.runGate = async () => {
        throw new Error("host interrupted");
      };
    await expect(f.run()).rejects.toThrow(
      mode === "reservation"
        ? "current-main-unavailable"
        : mode === "integration"
          ? "rebase-conflict"
          : "delivery-state-unknown",
    );
    const reservation = await readFile(resolve(f.sourceState, "gate-stop-continuation.json"));
    f.native.git = git;
    f.delivery.runGate = runGate;
    await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.prompts).toHaveLength(1);
    expect(f.authorPrompts).toEqual([]);
    expect(f.publications()).toBe(1);
    expect(f.commands.filter((args) => args[0] === "rebase" && args[1] !== "--abort")).toHaveLength(
      1,
    );
    expect(await f.adapter().history()).toHaveLength(3);
    expect(await readFile(resolve(f.sourceState, "gate-stop-continuation.json"))).toEqual(
      reservation,
    );
  },
);

it.each(["gate", "stale-review", "launch-ceiling"])(
  "keeps recovery stopped after %s with no publication",
  async (mode) => {
    const f = await savedGateStop();
    f.grant();
    if (mode === "gate") f.delivery.runGate = async () => "failed";
    if (mode === "launch-ceiling") f.config.nativeLaunchCeiling = 2;
    if (mode === "stale-review") {
      const observe = f.native.observe;
      f.native.observe = async (role, current, attempt) => {
        const result = await observe(role, current, attempt);
        if (result.summary)
          result.summary = JSON.stringify({ ...JSON.parse(result.summary), head: f.stoppedHead });
        return result;
      };
    }
    const reason =
      mode === "gate"
        ? "gate-attribution-unknown:typecheck"
        : mode === "stale-review"
          ? "reviewer-malformed"
          : "native-launch-ceiling-exhausted";
    await expect(f.run()).rejects.toThrow(reason);
    const history = await f.adapter().history();
    f.delivery.runGate = async () => "passed";
    await expect(f.run()).rejects.toThrow(reason);
    expect(await f.adapter().history()).toEqual(history);
    expect(f.publications()).toBe(0);
    expect(
      JSON.parse(
        await readFile(resolve(f.sourceState, "gate-stop-continuation/gate-stop.json"), "utf8"),
      ),
    ).toMatchObject({ reason });
    if (mode !== "gate") expect(f.gates).toEqual([]);
  },
);

it("requires another DELTA and every gate for main movement without renewing recovery", async () => {
  const f = await savedGateStop(true);
  f.grant();
  const observe = f.native.observe;
  let moved = false;
  f.native.observe = async (...args) => {
    if (!moved) {
      moved = true;
      await f.advanceMain(["ISS-100", "ISS-101", "ISS-102", "ISS-103"]);
    }
    return observe(...args);
  };
  await expect(f.run()).rejects.toThrow("current-main-moved");
  const reservation = await readFile(resolve(f.sourceState, "gate-stop-continuation.json"));
  expect(f.gates).toEqual([]);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.prompts).toHaveLength(2);
  expect(f.gates.map((row) => row.gate)).toEqual(["typecheck", "planning:board-check", "test"]);
  expect(new Set(f.gates.map((row) => row.head)).size).toBe(1);
  expect(await readFile(resolve(f.sourceState, "gate-stop-continuation.json"))).toEqual(
    reservation,
  );
});

it("completes recovery and replays without another worker, publication or merge", async () => {
  const f = await savedGateStop();
  f.grant();
  let merges = 0;
  let cleanups = 0;
  f.delivery.checks = async (current) => ({
    head: current.candidateHead,
    checks: current.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: "https://example.test/check",
    })),
  });
  f.delivery.observeMerge = async (current, publication) =>
    merges
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
    merges++;
  };
  f.delivery.observeCleanup = async (_current, plan) =>
    cleanups
      ? { state: "confirmed", value: { worktrees: plan.worktrees, branch: plan.branch } }
      : { state: "needs-mutation" };
  f.delivery.cleanup = async () => {
    cleanups++;
  };
  await expect(f.run()).resolves.toMatchObject({ status: "complete" });
  const attempt = await readFile(resolve(f.state, "attempt.json"));
  await expect(f.run()).resolves.toMatchObject({ status: "complete" });
  await expect(f.deliver()).resolves.toMatchObject({ status: "complete" });
  expect(await readFile(resolve(f.state, "attempt.json"))).toEqual(attempt);
  expect([f.prompts.length, f.publications(), merges, cleanups]).toEqual([1, 1, 1, 1]);
});

it("retains failed hosted recovery evidence without dispatching a new implementation attempt", async () => {
  const f = await savedGateStop();
  f.grant();
  f.delivery.checks = async (current) => ({
    head: current.candidateHead,
    checks: current.requiredChecks.map((name) => ({
      name,
      bucket: "fail",
      link: "https://example.test/check",
    })),
  });
  f.delivery.failedCheckLog = async () => "Synthetic complete underlying job diagnostics\n";
  await expect(f.run()).rejects.toThrow("hosted-check-failed:");
  const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
  expect(attempt).toMatchObject({ phase: "delivery", candidateAttempt: 1 });
  await expect(f.run()).rejects.toThrow("hosted-check-failed:");
  expect(f.publications()).toBe(1);
  expect(f.prompts).toHaveLength(1);
  expect(f.authorPrompts).toEqual([]);
});

it("resumes the single bounded conflict author and its independent DELTA during recovery", async () => {
  const f = await savedGateStop();
  f.grant();
  await writeFile(resolve(f.repo, "feature.txt"), "main repair\n");
  const main = await f.advanceMain(["ISS-100", "ISS-101", "ISS-102", "ISS-103"]);
  f.setResolution(() =>
    writeFile(resolve(f.sourceTree, "feature.txt"), "candidate\nmain repair\n"),
  );
  f.setRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.authorPrompts[0]).toContain(f.authorization.repairSha);
  expect(f.authorPrompts[0]).toContain("only Git's marked conflicting hunks");
  f.setRunning(false);
  f.setReviewRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.publications()).toBe(0);
  f.setReviewRunning(false);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  const head = f.publication()!.head;
  for (const ancestor of [main, f.stoppedHead])
    expect(await f.git(f.sourceTree, ["merge-base", head, ancestor])).toBe(ancestor);
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0]).toContain(resolve(f.artifacts, "candidate.log"));
  expect(await f.adapter().history()).toHaveLength(4);
});

it("refuses recovery conflict authoring when the original refresh spent that resolution", async () => {
  const f = await conflictingFixture();
  await f.saveAttempt();
  f.delivery.runGate = async () => "failed";
  const run = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  await expect(run()).rejects.toThrow("gate-attribution-unknown:planning:board-check");
  const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  await writeFile(resolve(f.repo, "feature.txt"), "second main conflict\n");
  const main = await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
  f.config.gateStopAuthorization = {
    stateDirectory: f.sourceState,
    candidateHead: head,
    repairSha: main,
    authorityUrl: gateAuthority,
  };
  f.delivery.runGate = async () => "passed";
  await expect(run()).rejects.toThrow("conflict-resolution-exhausted");
  await expect(run()).rejects.toThrow("conflict-resolution-exhausted");
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.prompts).toHaveLength(1);
  expect(f.publications()).toBe(0);
});

it.each([false, true])(
  "retains the existing correction allowance during recovery (already used: %s)",
  async (used) => {
    const f = await savedGateStop(false, false, used);
    f.grant();
    f.setCause("candidate");
    let corrected = false;
    f.setResolution(async () => {
      await writeFile(resolve(f.sourceTree, "feature.txt"), "candidate fixed again\n");
      corrected = true;
    });
    f.delivery.runGate = async (current, gate, head) => {
      if (corrected || gate !== "test") return "passed";
      const log = resolve(current.stateDirectory, "fresh-failure.log");
      await writeFile(log, "FAIL feature.test.ts > fixture\nAssertionError: fixture\n");
      return {
        status: "failed",
        output: "fixture",
        evidence: {
          head,
          log,
          cause: "diagnostic",
          command: { executable: process.execPath, argv: ["fixture", gate], cwd: f.sourceTree },
          diagnostics: ["feature.test.ts > fixture"],
        },
      };
    };
    if (used) {
      await expect(f.run()).rejects.toThrow("gate-correction-exhausted:test");
      await expect(f.run()).rejects.toThrow("gate-correction-exhausted:test");
      expect(f.publications()).toBe(0);
    } else {
      await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
      await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      expect(f.publications()).toBe(1);
      expect(await f.adapter().history()).toHaveLength(5);
      expect(f.prompts.at(-1)).toContain("Independent DELTA review");
    }
    expect(f.authorPrompts).toHaveLength(1);
    for (const [path, bytes] of f.preserved) expect(await readFile(path)).toEqual(bytes);
  },
);

it("does not renew a reserved recovery when the authorization changes", async () => {
  const f = await savedGateStop();
  f.grant();
  f.setReviewRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  const reservation = await readFile(resolve(f.sourceState, "gate-stop-continuation.json"));
  f.config.gateStopAuthorization = {
    ...f.authorization,
    authorityUrl: "https://github.com/fixture/repository/issues/494#issuecomment-999999",
  };
  await expect(f.run()).rejects.toThrow("gate-stop-authorization-mismatch");
  expect(f.prompts).toHaveLength(1);
  expect(await readFile(resolve(f.sourceState, "gate-stop-continuation.json"))).toEqual(
    reservation,
  );
  f.grant();
  f.setReviewRunning(false);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.prompts).toHaveLength(1);
});

it.each(["pending", "published", "wrong-remote", "lease-moved"])(
  "reconciles %s publication before saved-stop recovery and preserves the same forward lease",
  async (mode) => {
    const f = await fixture();
    const { remoteHead, preserved } = await f.enablePublicationRefresh();
    await writeFile(resolve(f.sourceTree, "feature.txt"), "published correction\n");
    const stoppedHead = await f.commit(f.sourceTree);
    await f.pinSource();
    await f.saveAttempt();
    if (mode === "pending") f.losePublicationObservation();
    if (mode === "pending") await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
    else await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    // Synthetic retained stop alongside a publication whose receipt may be pending.
    const stopped = JSON.stringify({ reason: "gate-host-failed:test" });
    await writeFile(resolve(f.sourceState, "gate-stop.json"), stopped);
    const intent = await readFile(resolve(f.sourceState, "publication-intent.json"));
    const main = await f.advanceMain();
    f.config.gateStopAuthorization = {
      stateDirectory: f.sourceState,
      candidateHead: stoppedHead,
      repairSha: main,
      authorityUrl: gateAuthority,
    };
    const moveRemote = () =>
      f.git(resolve(f.root, "remote.git"), ["update-ref", "refs/heads/codex/iss-100", main]);
    if (mode === "wrong-remote") await moveRemote();
    if (mode === "lease-moved") {
      const runGate = f.delivery.runGate;
      f.delivery.runGate = async (...args) => {
        await moveRemote();
        return runGate(...args);
      };
    }
    const run = f.deliver;
    if (mode === "wrong-remote" || mode === "lease-moved") {
      await expect(run()).rejects.toThrow("publication-state-unknown");
      expect(f.publications()).toBe(1);
      expect(f.prompts).toHaveLength(mode === "wrong-remote" ? 0 : 1);
      expect(await remoteHead()).toBe(main);
    } else {
      await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      const head = await remoteHead();
      expect(head).not.toBe(f.head);
      for (const ancestor of [main, stoppedHead])
        expect(await f.git(f.sourceTree, ["merge-base", ancestor, head])).toBe(ancestor);
      await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      expect(f.publications()).toBe(2);
      expect(f.publication()?.number).toBe(200);
      expect(f.prompts).toHaveLength(1);
      expect(f.commands.some((args) => args[0] === "rebase")).toBe(false);
    }
    expect(await f.git(preserved, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(await readFile(resolve(f.sourceState, "publication-intent.json"))).toEqual(intent);
    expect(await readFile(resolve(f.sourceState, "gate-stop.json"), "utf8")).toBe(stopped);
  },
);

it("requires new exact-head host evidence after main refresh while reviewing the full implementation", async () => {
  const f = await fixture();
  const descriptor = evidenceDescriptor(resolve(f.root, "operator-evidence"));
  f.source.correctionPaths = ["feature.txt"];
  f.source.preReviewEvidence = descriptor;
  await f.pinSource();
  await writeEvidence(descriptor, f.source.repository, f.head);
  const main = await f.advanceMain();
  await expect(f.deliver()).rejects.toThrow("operator-evidence-authority");
  expect(f.prompts).toEqual([]);
  expect(f.authorPrompts).toEqual([]);
  expect(f.gateHeads).toEqual([]);
  const directory = resolve(f.sourceState, `refresh-${main}`);
  const candidate = JSON.parse(await readFile(resolve(directory, "candidate.json"), "utf8"));
  expect(candidate.head).not.toBe(f.head);
  expect(candidate.changed).toContain("planning/drafts/ISS-100.md");
  await writeEvidence(descriptor, f.source.repository, candidate.head);
  f.setReviewRunning(true);
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-reviewer" });
  await Promise.all(Object.values(descriptor.bundle).map((path) => rm(path)));
  await expect(f.deliver()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0]).toContain(resolve(directory, "pre-review-evidence/acceptance.json"));
  expect(f.authorPrompts).toEqual([]);
  f.setReviewRunning(false);
  await f.deliver();
  expect(f.gateHeads.every((head) => head === candidate.head)).toBe(true);
  expect(f.gateHeads.length).toBeGreaterThan(0);
});

it("retains the chosen fallback reviewer for current-main delta review", async () => {
  const f = await fixture();
  f.source.reviewer = {
    model: "claude-opus-5",
    effort: "high",
    prompt: "review",
    ladder: [
      { model: "claude-opus-5", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" },
    ],
  };
  f.reviewer.placement = { model: "gpt-5.6-sol", effort: "high" };
  f.reviewer.rung = 1;
  await f.pinSource();
  await f.advanceMain();
  await f.deliver();
  expect(f.reviewerModels).toEqual(["gpt-5.6-sol"]);
});

it("carries a delta review refusal forward when main moves again", async () => {
  const f = await fixture();
  f.source.reviewer = {
    model: "claude-opus-5",
    effort: "high",
    prompt: "review",
    ladder: [
      { model: "claude-opus-5", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" },
    ],
  };
  f.reviewer.placement = { model: "claude-opus-5", effort: "high" };
  f.reviewer.rung = 0;
  await f.pinSource();
  const launch = f.native.launch;
  const models: string[] = [];
  f.native.launch = async (role, config, prompt) => {
    models.push(config.reviewer.model);
    if (config.reviewer.model === "claude-opus-5") throw new QueueBlocked("provider-model-refused");
    return launch(role, config, prompt);
  };
  await f.advanceMain();
  f.setStopGate(true);
  await expect(f.deliver()).rejects.toThrow("delivery-state-unknown");
  await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
  f.setStopGate(false);
  await f.deliver();
  expect(models).toEqual(["claude-opus-5", "gpt-5.6-sol", "gpt-5.6-sol"]);
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

it("resumes saved delivery with ignored scratch without another worker or implementation attempt", async () => {
  const f = await fixture();
  await writeFile(resolve(f.repo, ".git/info/exclude"), "artifacts/\n");
  const scratch = resolve(f.sourceTree, "bounded-contexts/marketplace/artifacts/jpeg-corrective");
  await mkdir(scratch, { recursive: true });
  await f.saveAttempt();
  const history = await f.adapter().history();
  const oldRecords = Object.fromEntries(
    await Promise.all(
      [
        "author-attempt",
        "author-terminal",
        "reviewer-attempt",
        "reviewer-terminal",
        "candidate",
        "config",
      ].map(async (name) => [name, await readFile(resolve(f.sourceState, `${name}.json`), "utf8")]),
    ),
  );
  const step = () => queueStep(f.config, { ...f.adapter(), async assertExecutor() {} });
  for (let resume = 0; resume < 2; resume++) {
    await expect(step()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const attempt = JSON.parse(await readFile(resolve(f.state, "attempt.json"), "utf8"));
    expect(attempt).toMatchObject({
      candidateAttempt: 1,
      head: f.head,
      reviewId: f.reviewer.id,
      retries: 0,
      phase: "delivery",
    });
    expect(await f.adapter().history()).toEqual(history);
  }
  expect(f.prompts).toEqual([]);
  expect(f.gateHeads).toEqual([f.head]);
  for (const [name, contents] of Object.entries(oldRecords))
    expect(await readFile(resolve(f.sourceState, `${name}.json`), "utf8")).toBe(contents);
  expect(await readdir(scratch)).toEqual([]);
});

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
    await expect(f.deliver()).rejects.toThrow(
      mode === "omitted registration" ? "self-planning-invalid" : "self-sibling-refused:ISS-103",
    );
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

const overlapPath = "overlap with spaces.txt";
const overlapBase = "first\n" + "stable\n".repeat(10) + "last\n";

it("derives exact-path text eligibility from real immutable NUL-delimited trees", async () => {
  const f = await fixture();
  // Synthetic C/M/S objects, not historical incident identities. Construct trees
  // directly so tab names and symlink modes also work on Windows without checkout.
  const input = (args: string[], bytes: string) =>
    new Promise<string>((done, fail) => {
      const child = execFile(
        "git",
        [
          "-C",
          f.sourceTree,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          ...args,
        ],
        (error, stdout) => (error ? fail(error) : done(stdout.trim())),
      );
      child.stdin!.end(bytes);
    });
  type Entry = { text: string; mode?: string } | undefined;
  const rows: Record<string, [Entry, Entry, Entry]> = {};
  const regular = (text: string): Entry => ({ text });
  for (const file of ["space path", "tab\tpath", "empty"])
    rows[file] = [regular("candidate"), regular("main"), regular(file === "empty" ? "" : "both")];
  for (const side of [0, 1, 2]) {
    rows[`absent-${side}`] = [regular("candidate"), regular("main"), regular("seed")];
    rows[`absent-${side}`]![side] = undefined;
    rows[`nul-${side}`] = [regular("candidate"), regular("main"), regular("seed")];
    rows[`nul-${side}`]![side] = regular("binary\0");
    for (const mode of ["100755", "120000"]) {
      rows[`${mode}-${side}`] = [regular("candidate"), regular("main"), regular("seed")];
      rows[`${mode}-${side}`]![side] = { text: "other", mode };
    }
  }
  rows.executable = ["candidate", "main", "seed"].map((text) => ({ text, mode: "100755" })) as [
    Entry,
    Entry,
    Entry,
  ];
  rows["renamed-old"] = [regular("candidate"), undefined, undefined];
  rows["renamed-new"] = [undefined, regular("main"), regular("seed")];
  const marked = "<<<<<<< HEAD\ncandidate\n=======\nmain\n>>>>>>> main\n";
  rows["feature.txt"] = [regular("candidate\n"), regular("main\n"), regular(marked)];
  const ids: Record<string, string[]> = {};
  const trees: string[] = [];
  for (const side of [0, 1, 2]) {
    let records = "";
    for (const [path, entries] of Object.entries(rows)) {
      const entry = entries[side];
      if (!entry) continue;
      const blob = await input(["hash-object", "-w", "--stdin"], entry.text);
      (ids[path] ??= [])[side] = blob;
      records += `${entry.mode ?? "100644"} blob ${blob}\t${path}\0`;
    }
    trees.push(await input(["mktree", "-z"], records));
  }
  const candidate = await input(["commit-tree", trees[0]!, "-p", f.head], "candidate\n");
  const main = await input(["commit-tree", trees[1]!, "-p", f.head], "main\n");
  const seed = await input(["commit-tree", trees[2]!, "-p", candidate, "-p", main], "seed\n");
  const conflict: Conflict = { seed, files: { "feature.txt": marked } };
  const stateDirectory = resolve(f.state, "synthetic-seed");
  await mkdir(stateDirectory);
  const before = await f.git(f.sourceTree, ["status", "--porcelain"]);
  await expect(
    resolveConflict(
      { ...f.source, stateDirectory },
      f.native,
      f.item.setup.pilotWorktree,
      main,
      candidate,
      conflict,
      async () => {
        throw new Error("captured before launch");
      },
    ),
  ).rejects.toThrow("captured before launch");
  expect(conflict.census).toEqual({
    candidate,
    main,
    seed,
    k: ["feature.txt"],
    u: ["empty", "space path", "tab\tpath"],
    blobs: Object.fromEntries(
      ["feature.txt", "empty", "space path", "tab\tpath"].map((file) => [
        file,
        { candidate: ids[file]![0], main: ids[file]![1], seed: ids[file]![2] },
      ]),
    ),
  });
  expect(await f.git(f.sourceTree, ["rev-parse", "HEAD"])).toBe(f.head);
  expect(await f.git(f.sourceTree, ["status", "--porcelain"])).toBe(before);
  expect(f.authorPrompts).toEqual([]);
});

async function overlapFixture(published = false) {
  const f = await fixture(undefined, undefined, false, undefined, undefined, undefined, {
    [overlapPath]: overlapBase,
    "importer.txt": "import './feature.txt';\n",
    "same.txt": "base\n",
    "candidate-only.txt": "base\n",
    "main-only.txt": "base\n",
  });
  await writeFile(resolve(f.sourceTree, overlapPath), overlapBase.replace("first", "candidate"));
  await writeFile(resolve(f.sourceTree, "same.txt"), "same\n");
  await writeFile(resolve(f.sourceTree, "candidate-only.txt"), "candidate\n");
  const candidate = await f.commit(f.sourceTree);
  await f.pinSource();
  if (published) await f.enablePublicationRefresh();
  await writeFile(resolve(f.repo, overlapPath), overlapBase.replace("last", "main"));
  await writeFile(resolve(f.repo, "feature.txt"), "main\n");
  await writeFile(resolve(f.repo, "same.txt"), "same\n");
  await writeFile(resolve(f.repo, "main-only.txt"), "main\n");
  const main = await f.advanceMain();
  const record = resolve(f.sourceState, "native-refresh.json");
  const saved = async () => JSON.parse(await readFile(record, "utf8"));
  const resolveK = () => writeFile(resolve(f.sourceTree, "feature.txt"), "candidate\nmain\n");
  f.setResolution(resolveK);
  return { ...f, candidate, main, record, saved, resolveK };
}

it.each([false, true])(
  "captures immutable overlap before any author (published: %s)",
  async (published) => {
    const f = await overlapFixture(published);
    let captured: Conflict["census"];
    const git = f.native.git;
    const snapshots: string[][] = [];
    const snapshot = async () => [
      await f.git(f.sourceTree, ["rev-parse", "HEAD"]),
      await f.git(f.sourceTree, ["ls-files", "--stage", "-z"]),
      await readFile(resolve(f.sourceTree, "feature.txt"), "utf8"),
      await readFile(resolve(f.sourceTree, overlapPath), "utf8"),
    ];
    f.native.git = async (tree, args) => {
      if (args[0] === "ls-tree" && !snapshots.length) snapshots.push(await snapshot());
      return git(tree, args);
    };
    f.setResolution(async () => {
      const saved = await f.saved();
      captured = saved.conflict.census;
      expect(await snapshot()).toEqual(snapshots[0]);
      expect(captured).toMatchObject({
        candidate: f.candidate,
        main: f.main,
        seed: saved.conflict.seed,
        k: ["feature.txt"],
        u: [overlapPath],
      });
      expect(await f.git(f.sourceTree, ["rev-list", "--parents", "-n", "1", captured!.seed])).toBe(
        `${captured!.seed} ${f.candidate} ${f.main}`,
      );
      for (const file of [...captured!.k, ...captured!.u])
        for (const side of ["candidate", "main", "seed"] as const)
          expect(captured!.blobs[file]![side]).toBe(
            await f.git(f.sourceTree, ["rev-parse", `${captured![side]}:${file}`]),
          );
      // The importer of the marked module and S=C, S=M, C=M controls grant no U permission.
      expect(Object.keys(captured!.blobs).sort()).toEqual(["feature.txt", overlapPath]);
      await f.resolveK();
      await writeFile(resolve(f.sourceTree, overlapPath), "candidate and main preserved\n");
    });
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.authorPrompts[0]).toContain(JSON.stringify(captured));
    expect(f.authorPrompts[0]).toContain("U permits only necessary preservation edits");
    expect(f.authorPrompts[0]).not.toContain("Do not modify text outside those hunks");
    expect(f.prompts[0]).toContain(JSON.stringify(captured));
    expect(f.prompts[0]).toContain("every changed U file and its direct callers");
    expect(f.prompts[0]).toContain("author-delta-1.jsonl");
    const bytes = await readFile(f.record, "utf8");
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(await readFile(f.record, "utf8")).toBe(bytes);
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.prompts).toHaveLength(1);
  },
);

it.each([
  "unchanged",
  "unrelated",
  "k-binary",
  "binary",
  "markers",
  "delete",
  "rename",
  "mode",
  "symlink",
  "fence-inside",
  "fence-outside",
])("bounds an otherwise valid overlap resolution: %s", async (mode) => {
  const f = await overlapFixture();
  if (mode.startsWith("fence"))
    f.item.source.correctionPaths =
      mode === "fence-inside" ? ["feature.txt", overlapPath] : ["feature.txt"];
  if (mode.startsWith("fence")) await f.pinSource();
  f.setResolution(async () => {
    await f.resolveK();
    const path = resolve(f.sourceTree, overlapPath);
    if (mode === "unrelated") await writeFile(resolve(f.sourceTree, "importer.txt"), "unrelated\n");
    else if (mode === "k-binary")
      await writeFile(resolve(f.sourceTree, "feature.txt"), "binary\0\n");
    else if (mode === "binary") await writeFile(path, "binary\0\n");
    else if (mode === "markers") await writeFile(path, "<<<<<<< leftover\n");
    else if (mode === "delete") await rm(path);
    else if (mode === "rename") {
      await f.git(f.sourceTree, ["mv", overlapPath, "renamed.txt"]);
    } else if (mode === "mode") {
      await f.git(f.sourceTree, ["config", "core.filemode", "false"]);
      await f.git(f.sourceTree, ["update-index", "--chmod=+x", overlapPath]);
    } else if (mode === "symlink") {
      // Index control is portable to Windows without symlink creation privileges.
      const blob = await f.git(f.sourceTree, ["rev-parse", `HEAD:${overlapPath}`]);
      await f.git(f.sourceTree, ["config", "core.symlinks", "false"]);
      await f.git(f.sourceTree, ["update-index", "--cacheinfo", "120000", blob, overlapPath]);
    } else if (mode.startsWith("fence")) await writeFile(path, "candidate and main\n");
  });
  if (mode === "unchanged") {
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  } else {
    await expect(f.deliver()).rejects.toMatchObject({
      reason: "conflict-resolution-scope-escape",
      diagnostics: expect.stringContaining(f.record),
    });
    expect(f.prompts).toEqual([]);
    expect(f.gateHeads).toEqual([]);
  }
  expect((await f.saved()).conflict.census.u).toEqual([overlapPath]);
  expect(f.authorPrompts).toHaveLength(1);
  if (mode.startsWith("fence")) {
    expect(f.authorPrompts[0]).toContain("Resolve only Git's marked conflicting hunks");
    expect(f.authorPrompts[0]).toContain("U is evidence, never edit authority");
  }
});

it("keeps actual outside-hunk K bytes immutable while allowing U", async () => {
  const f = await fixture(
    undefined,
    undefined,
    false,
    { prefix: "fixed\n", suffix: "tail\n" },
    undefined,
    undefined,
    { [overlapPath]: overlapBase },
  );
  await writeFile(resolve(f.sourceTree, overlapPath), overlapBase.replace("first", "candidate"));
  await f.commit(f.sourceTree);
  await f.pinSource();
  await writeFile(resolve(f.repo, overlapPath), overlapBase.replace("last", "main"));
  await writeFile(resolve(f.repo, "feature.txt"), "fixed\nmain\ntail\n");
  await f.advanceMain();
  f.setResolution(async () => {
    await writeFile(resolve(f.sourceTree, "feature.txt"), "changed\ncandidate\nmain\ntail\n");
    await writeFile(resolve(f.sourceTree, overlapPath), "candidate and main\n");
  });
  await expect(f.deliver()).rejects.toMatchObject({
    reason: "conflict-resolution-scope-escape",
    diagnostics: expect.stringContaining("feature.txt"),
  });
});

it.each(["unchanged", "escape", "retry"])(
  "retains a legacy K-only worker contract: %s",
  async (mode) => {
    const f = await overlapFixture();
    const preflight = f.native.preflight;
    // Synthesize a pre-ISS-199 pinned configuration, with its original fingerprint.
    // No historical production record or worker is modified by this fixture.
    f.native.preflight = async (config) => {
      const retained = config.author.prompt
        .split("Retain independently reviewed feature ")[1]!
        .split(" Seed-bound conflict census:")[0]!;
      const original = {
        ...config,
        author: {
          ...config.author,
          prompt:
            "Resolve only Git's marked conflicting hunks. Preserve both reviewed feature behavior and current-main changes. Do not modify text outside those hunks, add files, redesign the feature or fix unrelated defects. If preservation needs broader changes, return FAIL. This is the single bounded conflict resolution, not a fresh implementation. Retain independently reviewed feature " +
            retained,
        },
        reviewer: {
          ...config.reviewer,
          prompt:
            "This is an independent DELTA review of conflict resolution. Check the resolved hunks and direct callers against both parents. Reject semantic scope expansion, dropped feature or current-main behavior, and missing execution evidence. Inherit the retained source review; do not restart a full source sweep or infer patch equivalence. Retain independently reviewed feature " +
            retained,
        },
      };
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            config: original,
            prompts: [original.author.prompt, original.reviewer.prompt],
          }),
        )
        .digest("hex");
      await writeFile(
        resolve(config.stateDirectory, "config.json"),
        JSON.stringify({ fingerprint, config: original, host: process.platform }),
      );
      const saved = await f.saved();
      delete saved.conflict.census;
      await writeFile(f.record, JSON.stringify(saved));
      throw new Error("synthetic legacy configuration pinned");
    };
    await expect(f.deliver()).rejects.toThrow("synthetic legacy configuration pinned");
    f.native.preflight = preflight;
    const git = f.native.git;
    f.native.git = async (tree, args) => {
      if (args[0] === "ls-tree") throw new Error("legacy census backfill forbidden");
      return git(tree, args);
    };
    f.setRunning(true);
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-author" });
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-author" });
    expect(f.authorPrompts).toHaveLength(1);
    expect(f.authorPrompts[0]).not.toContain("Seed-bound conflict census");
    f.setRunning(false);
    if (mode === "escape")
      await writeFile(
        resolve(f.sourceTree, overlapPath),
        "preservation edit forbidden to legacy worker\n",
      );
    if (mode === "retry") {
      const observe = f.native.observe;
      let retry = true;
      f.native.observe = async (role, config, attempt) => {
        if (role === "author" && retry) {
          retry = false;
          return { id: attempt.id, status: "malformed" };
        }
        return observe(role, config, attempt);
      };
    }
    if (mode === "escape")
      await expect(f.deliver()).rejects.toThrow("conflict-resolution-scope-escape");
    else {
      await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      expect(f.authorPrompts).toHaveLength(mode === "retry" ? 2 : 1);
      expect(f.prompts).toHaveLength(1);
    }
    expect((await f.saved()).conflict.census).toBeUndefined();
  },
);

it.each(["read", "save", "prelaunch", "retry", "commit"])(
  "resumes the same census after %s interruption",
  async (mode) => {
    const f = await overlapFixture();
    const git = f.native.git;
    let interrupted = false;
    f.native.git = async (tree, args) => {
      if (args[0] === "ls-tree") {
        if (mode === "read" && !interrupted) {
          interrupted = true;
          throw new Error("injected census read failure");
        }
      }
      return git(tree, args);
    };
    // Interrupt after the census was saved but before flow pins its configuration.
    const preflight = f.native.preflight;
    f.native.preflight = async (config) => {
      if (mode === "prelaunch" && !interrupted) {
        interrupted = true;
        throw new Error("injected prelaunch interruption");
      }
      return preflight(config);
    };
    if (mode === "save") {
      // Occupy the existing atomic save's temporary path after seed persistence.
      f.native.git = async (tree, args) => {
        const result = await git(tree, args);
        if (args[0] === "ls-tree" && !interrupted) {
          interrupted = true;
          await mkdir(`${f.record}.next`);
        }
        return result;
      };
    }
    f.setResolution(async () => {
      await f.resolveK();
      await writeFile(resolve(f.sourceTree, overlapPath), "candidate and main\n");
    });
    if (["read", "save", "prelaunch"].includes(mode)) {
      await expect(f.deliver()).rejects.toThrow(
        mode === "read"
          ? "injected census read failure"
          : mode === "prelaunch"
            ? "injected prelaunch interruption"
            : `${f.record}.next`,
      );
      expect(f.authorPrompts).toEqual([]);
      expect((await f.saved()).conflict.census === undefined).toBe(mode !== "prelaunch");
      if (mode === "save") await rm(`${f.record}.next`, { recursive: true });
    }
    if (mode === "retry") {
      const observe = f.native.observe;
      f.native.observe = async (role, config, attempt) => {
        if (role === "author" && !interrupted) {
          interrupted = true;
          return { id: attempt.id, status: "malformed", summary: "injected malformed completion" };
        }
        return observe(role, config, attempt);
      };
    }
    if (mode === "commit") f.loseCommit("resolution");
    if (mode === "commit")
      await expect(f.deliver()).rejects.toThrow("lost conflict commit response");
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    const saved = await f.saved();
    expect(saved.resolutionUsed).toBe(true);
    expect(saved.conflict.census).toMatchObject({
      candidate: f.candidate,
      main: f.main,
      u: [overlapPath],
    });
    expect(f.authorPrompts).toHaveLength(mode === "retry" ? 2 : 1);
    for (const prompt of [...f.authorPrompts, ...f.prompts])
      expect(prompt).toContain(JSON.stringify(saved.conflict.census));
    const reads = f.commands.filter((args) => args[0] === "ls-tree").length;
    await f.advanceMain(["ISS-100", "ISS-101", "ISS-102"]);
    await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
    expect(f.commands.filter((args) => args[0] === "ls-tree")).toHaveLength(reads);
  },
);

const conflictHunk = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n";
const marked = (...fixed: string[]) => fixed.join(conflictHunk);
const largeFixed =
  "literal .*+?^${}()|[]\\ near-match! ".repeat(8192).slice(0, 128 * 1024 - 1) + "\n";

describe.each(["\n", "\r\n"])("literal conflict boundaries with %j", (eol) => {
  const lines = (text: string) => text.replaceAll("\n", eol);
  const prefix = "prefix .*+?^${}()|[]\\ \t\n";
  const suffix = "suffix immutable\n";
  it.each([
    ["one hunk", marked(prefix, suffix), prefix + "resolved\n" + suffix],
    ["empty resolution", marked(prefix, suffix), prefix + suffix],
    ["multiple hunks", marked(prefix, "middle\n", suffix), prefix + "one\nmiddle\ntwo\n" + suffix],
    ["empty resolutions", marked(prefix, "middle\n", suffix), prefix + "middle\n" + suffix],
    ["adjacent hunks", marked(prefix, "", suffix), prefix + "resolved\n" + suffix],
    ["empty prefix", marked("", suffix), "resolved\n" + suffix],
    ["empty suffix", marked(prefix, ""), prefix + "resolved\n"],
    ["whole file", marked("", ""), "resolved\n"],
    ["empty whole file", marked("", ""), ""],
    ["empty adjacent whole-file hunks", marked("", "", ""), ""],
    [
      "repeated fixed segments",
      marked(prefix, "same\n", "same\n", suffix),
      prefix + "same\nsame\nsame\n" + suffix,
    ],
    [
      "suffix inside resolution",
      marked(prefix, "middle\n", suffix),
      prefix + suffix + "middle\n" + suffix + suffix,
    ],
    [
      "earliest middle match leaves room",
      marked(prefix, "middle\n", "last\n", suffix),
      prefix + "middle\nlast\nmiddle\n" + suffix,
    ],
  ])("accepts %s", (_name, before, after) => {
    expect(withinConflictHunks(lines(before!), lines(after!))).toBe(true);
  });

  const before = marked(prefix, "middle one\n", "middle two\n", suffix);
  const valid = prefix + "resolved\nmiddle one\nresolved\nmiddle two\nresolved\n" + suffix;
  it.each([
    ["prefix byte", valid.replace("prefix", "prefiX")],
    ["suffix interior byte", valid.replace("immutable", "immuTable")],
    ["middle byte", valid.replace("middle one", "middle One")],
    ["middle omission", valid.replace("middle one\n", "")],
    [
      "segment order",
      valid
        .replace("middle one", "placeholder")
        .replace("middle two", "middle one")
        .replace("placeholder", "middle two"),
    ],
    ["leading extra text", "extra\n" + valid],
    ["trailing extra text", valid + "extra\n"],
    ["literal metacharacter", valid.replace(".*+?", ".*+!")],
    ["fixed whitespace", valid.replace(" \t\n", "  \n")],
    ["retained opening marker", valid.replace("resolved", "<<<<<<< HEAD")],
    ["retained separator", valid.replace("resolved", "=======")],
    ["retained closing marker", valid.replace("resolved", ">>>>>>> main")],
  ])("rejects only a changed %s", (_name, after) => {
    expect(withinConflictHunks(lines(before), lines(valid))).toBe(true);
    expect(withinConflictHunks(lines(before), lines(after!))).toBe(false);
  });

  it("rejects only an outside-hunk line ending change", () => {
    const after = lines(valid);
    expect(withinConflictHunks(lines(before), after)).toBe(true);
    expect(
      withinConflictHunks(
        lines(before),
        after.replace(`middle one${eol}`, `middle one${eol === "\n" ? "\r\n" : "\n"}`),
      ),
    ).toBe(false);
  });

  it.each([
    ["no hunk", prefix + suffix, prefix + suffix],
    ["incomplete hunk", prefix + "<<<<<<< HEAD\nours\n=======\ntheirs\n", prefix],
    ["unchanged markers", before, before],
    ["prefix/suffix byte reuse", marked("same\n", "same\n"), "same\n"],
    ["middle/suffix byte reuse", marked(prefix, "same\n", "same\n"), prefix + "same\n"],
    ["reused middle", marked(prefix, "same\n", "same\n", suffix), prefix + "same\n" + suffix],
    [
      "overlapping middles",
      marked(prefix, "a\nb\n", "b\nc\n", suffix),
      prefix + "a\nb\nc\n" + suffix,
    ],
    ["middle overlaps suffix", marked(prefix, "a\nb\n", "b\nc\n"), prefix + "a\nb\nc\n"],
  ])("refuses %s", (_name, input, after) => {
    expect(withinConflictHunks(lines(input!), lines(after!))).toBe(false);
  });
});

it("matches a synthetic single contiguous 128 KiB fixed segment without compiling it", () => {
  expect(Buffer.byteLength(largeFixed)).toBe(128 * 1024);
  const before = marked(largeFixed, "fixed suffix\n");
  const after = largeFixed + "resolved\nfixed suffix\n";
  expect(withinConflictHunks(before, after)).toBe(true);
  expect(withinConflictHunks(before, after.replace("fixed suffix", "fixed suffiX"))).toBe(false);
});

it("scans a synthetic many-hunk MiB with near-matches and late failures", () => {
  const segment = "a".repeat(1010) + ".*+?[]\\!\n";
  const near = segment.replace("!", "?");
  const count = 1024;
  const before = marked("prefix\n", ...Array<string>(count).fill(segment), "fixed suffix\n");
  const after = "prefix\n" + (near + segment).repeat(count) + "fixed suffix\n";
  expect(Buffer.byteLength(before)).toBeGreaterThan(1024 * 1024);
  expect(withinConflictHunks(before, after)).toBe(true);
  expect(withinConflictHunks(before, after.replace("fixed suffix", "fixed suffiX"))).toBe(false);
  const last = after.lastIndexOf(segment);
  expect(withinConflictHunks(before, after.slice(0, last) + near + "fixed suffix\n")).toBe(false);
});

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

describe.each([false, true])(
  "large ordinary-text conflict lifecycle (autocrlf: %s)",
  (autocrlf) => {
    let f: Awaited<ReturnType<typeof fixture>>;
    const suffix = "fixed suffix stays immutable\n";
    // Preserve Git's checked-out fixed bytes, including Windows CRLF, in the author edit.
    const resolved = (largeFixed + "candidate\nmain\n" + suffix).replaceAll(
      "\n",
      autocrlf ? "\r\n" : "\n",
    );
    beforeEach(async () => {
      vi.stubEnv("GIT_CONFIG_COUNT", "1");
      vi.stubEnv("GIT_CONFIG_KEY_0", "core.autocrlf");
      vi.stubEnv("GIT_CONFIG_VALUE_0", String(autocrlf));
      f = await fixture(undefined, undefined, false, { prefix: largeFixed, suffix });
      await writeFile(resolve(f.repo, "feature.txt"), largeFixed + "main\n" + suffix);
      await f.advanceMain();
      f.setResolution(() => writeFile(resolve(f.sourceTree, "feature.txt"), resolved));
    });

    it.each(["fresh", "input", "resolution"] as const)(
      "validates large text before author and after author on %s delivery",
      async (phase) => {
        const original = await readFile(resolve(f.sourceState, "candidate.json"), "utf8");
        if (phase !== "fresh") {
          f.loseCommit(phase);
          await expect(f.deliver()).rejects.toThrow("lost conflict commit response");
        }
        await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
        await expect(f.deliver()).resolves.toMatchObject({ status: "observing-hosted-checks" });
        const head = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
        expect(await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).toBe(resolved);
        expect(await readFile(resolve(f.sourceState, "candidate.json"), "utf8")).toBe(original);
        expect(f.authorPrompts).toHaveLength(1);
        expect(f.prompts).toHaveLength(1);
        expect(f.prompts[0]).toContain(head);
        expect(f.gateHeads).toEqual([head]);
        expect(f.publication()?.head).toBe(head);
        expect(f.publications()).toBe(1);
        expect(await f.adapter().history()).toHaveLength(4);
      },
    );

    it.each(["author", "commit reconciliation"])(
      "rejects only an outside-hunk suffix edit during %s before review or publication",
      async (phase) => {
        const escaped = resolved.replace("immutable", "immuTable");
        if (phase === "author") {
          f.setResolution(() => writeFile(resolve(f.sourceTree, "feature.txt"), escaped));
        } else {
          f.loseCommit("resolution");
          await expect(f.deliver()).rejects.toThrow("lost conflict commit response");
          await writeFile(resolve(f.sourceTree, "feature.txt"), escaped);
        }
        await expect(f.deliver()).rejects.toThrow("conflict-resolution-scope-escape");
        await expect(f.deliver()).rejects.toThrow("conflict-resolution-scope-escape");
        expect(f.authorPrompts).toHaveLength(1);
        expect(f.prompts).toEqual([]);
        expect(f.gateHeads).toEqual([]);
        expect(f.publications()).toBe(0);
      },
    );
  },
);

it.each(["no-hunk", "binary", "missing-side", "unsupported-mode", "rename-delete", "symlink"])(
  "retains unsupported refusal for a %s Git conflict before author dispatch",
  async (mode) => {
    const f = await fixture(undefined, undefined, false, {
      prefix: mode === "binary" ? "binary\0" : "",
      suffix: "",
    });
    if (mode === "no-hunk") {
      // Git's binary merge attribute leaves unresolved index stages but no markers,
      // even when the file itself is ordinary text without NUL bytes.
      const attributes = await f.git(f.sourceTree, ["rev-parse", "--git-path", "info/attributes"]);
      await writeFile(resolve(f.sourceTree, attributes), "feature.txt -merge\n");
    }
    if (mode === "rename-delete") {
      await f.git(f.sourceTree, ["mv", "feature.txt", "candidate-name.txt"]);
      await f.commit(f.sourceTree);
      await f.pinSource();
      await f.git(f.repo, ["mv", "feature.txt", "main-name.txt"]);
    } else if (mode === "missing-side") await f.git(f.repo, ["rm", "feature.txt"]);
    else
      await writeFile(
        resolve(f.repo, "feature.txt"),
        `${mode === "binary" ? "binary\0" : ""}main\n`,
      );
    if (mode === "unsupported-mode") {
      // Index mode control also works on Windows filesystems without executable bits.
      await f.git(f.repo, ["config", "core.filemode", "false"]);
      await f.git(f.repo, ["update-index", "--chmod=+x", "feature.txt"]);
    }
    if (mode === "symlink") {
      await f.git(f.repo, ["config", "core.symlinks", "false"]);
      const blob = await f.git(f.repo, ["rev-parse", "HEAD:feature.txt"]);
      await f.git(f.repo, ["update-index", "--cacheinfo", "120000", blob, "feature.txt"]);
    }
    await f.advanceMain();
    await expect(f.deliver()).rejects.toThrow("conflict-resolution-unsupported");
    expect(f.authorPrompts).toEqual([]);
    expect(f.prompts).toEqual([]);
    expect(f.gateHeads).toEqual([]);
    expect(f.publications()).toBe(0);
    const saved = JSON.parse(await readFile(resolve(f.sourceState, "native-refresh.json"), "utf8"));
    expect(saved.conflict.census).toBeUndefined();
    expect(f.commands.some((args) => args[0] === "ls-tree")).toBe(false);
  },
);

describe.each([false, true])(
  "routes a published DIRTY candidate through bounded resolution and forward publication (lost receipt: %s)",
  (lostReceipt) => {
    let f: Awaited<ReturnType<typeof fixture>>;
    let remoteHead: () => Promise<string>;
    let preserved: string;
    let publishedHead: string;
    let main: string;
    let originalPublication: string;

    // ISS-154 hosted Windows failure: build the published-conflict fixture in
    // its own bounded hook so setup and recovery do not share one test timeout.
    beforeEach(async () => {
      f = await fixture();
      ({ remoteHead, preserved } = await f.enablePublicationRefresh());
      await writeFile(resolve(f.sourceTree, "feature.txt"), "reviewed correction\n");
      publishedHead = await f.commit(f.sourceTree);
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
      main = await f.advanceMain();
      f.setPublicationDirty(true);
      await expect(f.deliver()).resolves.toMatchObject({
        status: "observing-hosted-checks",
        head: publishedHead,
      });
      originalPublication = await readFile(resolve(f.sourceState, "publication.json"), "utf8");
      expect(f.publications()).toBe(1);
    });

    it("resolves and reconciles both refresh observations without repeating workers or publication", async () => {
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
    });
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

// ISS-165: delivery refresh, conflict resolution and gate correction hand flow
// the same composed adapter. The harness is the only caller, after each step.
it.each(["delta", "conflict", "gate-correction"])(
  "retains the composed native profile method through %s delivery entries without a request",
  async (entry) => {
    const f =
      entry === "conflict"
        ? await conflictingFixture()
        : entry === "gate-correction"
          ? await gateCorrectionFixture()
          : await fixture();
    const run =
      entry === "gate-correction"
        ? (f as Awaited<ReturnType<typeof gateCorrectionFixture>>).run
        : f.deliver;
    if (entry === "delta") {
      await f.advanceMain();
      f.setReviewRunning(true);
    } else if (entry === "conflict") f.setRunning(true);
    await expect(run()).resolves.toMatchObject({
      status: entry === "delta" ? "observing-reviewer" : "observing-author",
    });
    if (entry === "gate-correction") {
      f.setRunning(true);
      await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    }
    expect(f.channel.written).toEqual([]);
    // Delta review: the bounded refresh adapter. Conflict: that plus the conflict
    // wrapper. Gate correction: the bounded refresh adapters of both delivery steps.
    expect(f.channel.receivers).toHaveLength(entry === "delta" ? 1 : 2);
    expect(f.channel.receivers).not.toContain(f.native);
    for (const receiver of f.channel.receivers) {
      expect(receiver.launch).toBeDefined();
      expect(receiver.observe).toBeDefined();
      await f.channel.invoke(receiver);
    }
    const requests = f.channel.written.length;
    // Replay from retained records reaches fresh receivers and still never requests.
    const before = f.channel.receivers.length;
    await expect(run()).resolves.toMatchObject({
      status: entry === "delta" ? "observing-reviewer" : "observing-author",
    });
    expect(f.channel.receivers.length).toBeGreaterThan(before);
    expect(f.channel.written).toHaveLength(requests);
    f.channel.close();
    for (const receiver of f.channel.receivers.slice(before))
      expect(await receiver.nativeDbProfile!(f.channel.identity())).toMatchObject({
        correlation: null,
        status: "refused",
        diagnostic: "native-db-channel-closed",
      });
    expect(f.channel.written).toHaveLength(requests);
    expect(f.authorPrompts).toHaveLength(entry === "delta" ? 0 : 1);
    expect(f.prompts).toHaveLength(entry === "delta" ? 1 : 0);
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

// ISS-192: the recognized scoped static staleness failure, as the adapter returns it.
const staleArtifact = {
  gate: "verify:static:scoped",
  output: "Error: docs/SYNTHETIC_INDEX.md is stale",
  log: `[VERIFY_STATIC_RUN] check:synthetic-artifact-index\n$ node ./scripts/generate-synthetic-alpha-index.mjs --check\nError: docs/SYNTHETIC_INDEX.md is stale\n[ELIFECYCLE] Command failed with exit code 1.\n${"full output\n".repeat(600)}`,
  diagnostics: ["docs/SYNTHETIC_INDEX.md is stale"],
};

async function gateCorrectionFixture(
  afterMirror = false,
  refresh = false,
  provided?: Awaited<ReturnType<typeof fixture>>,
  staleness = false,
) {
  const f = provided ?? (await fixture());
  if (refresh) await f.advanceMain();
  await f.saveAttempt();
  const gates: { head: string; gate: string; directory: string }[] = [];
  const controls: { head: string; main: string; gate: string }[] = [];
  let cause: "candidate" | "base" | "host" | "unknown" = "candidate";
  let secondGate: string | undefined;
  const failing = staleness ? staleArtifact.gate : "test";
  const plan = f.policy.plan;
  f.policy.plan = async (current) => {
    const value = await plan(current);
    value.gates = afterMirror
      ? { beforeMirror: ["typecheck"], afterMirror: ["planning:board-check", failing] }
      : { beforeMirror: ["typecheck", failing], afterMirror: ["planning:board-check"] };
    return value;
  };
  const runGate = f.delivery.runGate;
  f.delivery.runGate = async (current, gate, head) => {
    gates.push({ head, gate, directory: current.stateDirectory });
    const corrected = (await readFile(resolve(f.sourceTree, "feature.txt"), "utf8")).includes(
      "fixed",
    );
    if ((!corrected && gate === failing) || (corrected && gate === secondGate)) {
      const log = resolve(current.stateDirectory, "full-gate.log");
      await writeFile(
        log,
        staleness
          ? staleArtifact.log
          : `FAIL feature.test.ts > preserves behavior\nAssertionError: wrong value\n${"full output\n".repeat(600)}`,
        { flag: "wx" },
      );
      return {
        status: "failed",
        output: staleness ? staleArtifact.output : "AssertionError: wrong value",
        evidence: {
          head,
          command: {
            executable: process.execPath,
            argv: ["fixture-pnpm", "run", gate],
            cwd: f.sourceTree,
          },
          log,
          cause: "diagnostic",
          diagnostics: staleness
            ? staleArtifact.diagnostics
            : ["feature.test.ts > preserves behavior"],
        },
      };
    }
    return gate === "planning:board-check" ? runGate(current, gate, head) : "passed";
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

it("corrects a recognized generated-artifact staleness failure once with fresh DELTA review", async () => {
  const f = await gateCorrectionFixture(false, false, undefined, true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  const capture = JSON.parse(
    await readFile(resolve(f.sourceState, "gate-correction.json"), "utf8"),
  );
  expect(capture.gate).toBe("verify:static:scoped");
  expect(f.controls).toEqual([
    { head: capture.failedHead, main: capture.main, gate: "verify:static:scoped" },
  ]);
  f.setRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  expect(f.authorPrompts).toHaveLength(1);
  expect(f.authorPrompts[0]).toContain(JSON.stringify(staleArtifact.diagnostics));
  expect(f.authorPrompts[0]).toContain(capture.failedHead);
  f.setRunning(false);
  f.setReviewRunning(true);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  f.setReviewRunning(false);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
  expect(f.prompts.at(-1)).toContain("Independent DELTA review");
  expect(f.authorPrompts).toHaveLength(1);
  const corrected = await f.git(f.sourceTree, ["rev-parse", "HEAD"]);
  expect(f.gates.filter((gate) => gate.head === corrected).map((gate) => gate.gate)).toEqual([
    "typecheck",
    "verify:static:scoped",
    "planning:board-check",
  ]);
  expect(f.controls).toHaveLength(1);
});

it.each(["base", "host", "unknown"] as const)(
  "stops %s scoped static attribution without correction, publication or parking",
  async (cause) => {
    const f = await gateCorrectionFixture(false, false, undefined, true);
    f.setCause(cause);
    const reason = `gate-${cause === "base" ? "base-failed" : cause === "host" ? "host-failed" : "attribution-unknown"}:verify:static:scoped`;
    await expect(f.run()).rejects.toMatchObject({ reason });
    await expect(f.run()).rejects.toMatchObject({ reason });
    expect(f.authorPrompts).toEqual([]);
    expect(f.controls).toHaveLength(1);
    expect(f.publications()).toBe(0);
    expect(isItemStopReason(reason)).toBe(false);
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
    if (mode === "accepted-replan")
      f.item.acceptedReplan = replanPacket(f.item.source.stateDirectory);
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

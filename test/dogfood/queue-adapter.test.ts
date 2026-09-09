import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { queueUsage, repositoryQueueAdapter } from "../../scripts/dogfood/queue.js";
import type {
  DeliveryAdapter,
  DeliveryPlan,
  PublicationEvidence,
} from "../../scripts/dogfood/delivery.js";
import type { Adapter, Attempt } from "../../scripts/dogfood/flow.js";
import type { RepairAdapter } from "../../scripts/dogfood/repair.js";
import { repairDigest } from "../../scripts/dogfood/repair-policy.js";
import type { SetupAdapter, SetupRole } from "../../scripts/dogfood/setup.js";
import {
  itemAuthority,
  participantIdentity,
  queueDigest,
  type QueueConfig,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";

const roots: string[] = [];
const stable = "a".repeat(40);
const base = "b".repeat(40);
const candidate = "c".repeat(40);
const repaired = "d".repeat(40);
const mergeCommit = "e".repeat(40);
const unavailable = { status: "unavailable" as const };

async function fixture(history: QueueParticipant[] = []) {
  const root = await mkdtemp(resolve(tmpdir(), "queue-adapter-fixture-"));
  roots.push(root);
  const paths = {
    repository: resolve(root, "repository"),
    controller: resolve(root, "controller"),
    queue: resolve(root, "queue"),
    setup: resolve(root, "setup"),
    source: resolve(root, "source"),
    repair: resolve(root, "repair"),
    pilot: resolve(root, "pilot"),
    author: resolve(root, "author"),
    review: resolve(root, "review"),
  };
  await Promise.all(Object.values(paths).map((path) => mkdir(path)));
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
    author: { model: "gpt-author", effort: "high", promptFile: resolve(paths.source, "author.md") },
    reviewer: {
      model: "gpt-reviewer",
      effort: "high",
      promptFile: resolve(paths.source, "reviewer.md"),
    },
    adapter: { kind: "codex-exec" as const, executable: resolve(root, "codex") },
  };
  const item: QueueItem = {
    id: "fixture-338",
    issue: source.issue,
    base,
    implementationAttempt: 1,
    setup: {
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
      authority: {
        schemaVersion: "dogfood-setup-authority/v1",
        controller: source.owner,
        run: source.run,
        issue: source.issue,
        repository: source.repository,
        controllerRevision: stable,
        pilotRevision: stable,
        base,
        baseBranch: "main",
        sourceBranch: "codex/fixture-338",
        repositoryRoot: paths.repository,
        controllerRoot: paths.controller,
        pilotWorktree: paths.pilot,
        sourceWorktree: paths.author,
        reviewWorktree: paths.review,
        stateDirectory: paths.setup,
        actions: ["worktrees", "dependencies"],
      },
    },
    source,
    repair: {
      stateDirectory: paths.repair,
      sourcePaths: ["scripts/dogfood/queue.ts"],
      acceptanceCriteria: ["criterion one", "criterion two"],
      author: {
        model: "gpt-repair",
        effort: "high",
        promptFile: resolve(paths.repair, "author.md"),
      },
      reviewer: {
        model: "gpt-delta",
        effort: "high",
        promptFile: resolve(paths.repair, "reviewer.md"),
      },
    },
    delivery: { requiredChecks: [...source.requiredChecks], policy: { kind: "fixture" } },
  };
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-request/v1",
    run: "synthetic-queue",
    controllerRoot: paths.controller,
    controllerRevision: stable,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: 8,
    initialHistory: history,
    items: [item],
    authority: undefined as never,
  };
  config.authority = {
    schemaVersion: "dogfood-bounded-queue-authority/v1",
    controller: source.owner,
    run: config.run,
    controllerRoot: config.controllerRoot,
    controllerRevision: stable,
    stateDirectory: paths.queue,
    limit: 1,
    nativeLaunchCeiling: 8,
    lineageDigest: queueDigest(history.map(participantIdentity)),
    itemsDigest: queueDigest([itemAuthority(item)]),
    actions: ["setup", "source", "repair", "delivery"],
  };
  return { root, paths, source, item, config };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
    async assertAuthority(_config, executingRoot) {
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

it("directly composes the accepted flow and delivery transitions with exact identities", async () => {
  const current = await fixture();
  await Promise.all([
    writeFile(current.source.author.promptFile, "author prompt"),
    writeFile(current.source.reviewer.promptFile, "review prompt"),
  ]);
  let sourceHead = base;
  let reviewHead = base;
  let pid = 10;
  const launches: string[] = [];
  const native: Adapter = {
    async preflight() {},
    async git(worktree, args) {
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
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return args.includes("--cached") ? "" : `scripts/dogfood/queue.ts\0`;
      if (args[0] === "ls-files") return "";
      if (args[0] === "commit") {
        sourceHead = candidate;
        return "";
      }
      return "";
    },
    async launch(role): Promise<Attempt> {
      const ordinal = launches.length + 1;
      expect(
        JSON.parse(
          await readFile(
            resolve(current.paths.queue, `participant-${ordinal}-intent.json`),
            "utf8",
          ),
        ),
      ).toMatchObject({ ordinal, item: current.item.id, stage: "source", role });
      launches.push(role);
      return { id: `source-${role}`, pid: pid++, trace: resolve(current.root, `${role}.jsonl`) };
    },
    async observe(role, _config, attempt) {
      return {
        status: "passed",
        id: attempt.id,
        head: role === "author" ? base : candidate,
        usage: {
          input_tokens: role === "author" ? 11 : 7,
          output_tokens: role === "author" ? 3 : 2,
        },
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
  let publishedDigest = "";
  let merged = false;
  let cleaned = false;
  const publication = (): PublicationEvidence => ({
    number: 338,
    url: "https://example.test/pull/338",
    head: candidate,
    repository: current.source.repository,
    sourceBranch: plan.publication.sourceBranch,
    baseBranch: plan.publication.baseBranch,
    title: plan.publication.title,
    body: plan.publication.body,
    planDigest: publishedDigest,
  });
  const delivery: DeliveryAdapter = {
    publicationUrl: (_config, number) => `https://example.test/pull/${number}`,
    async source(config) {
      return {
        head: candidate,
        reviewId: "source-reviewer",
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
    async runGate() {
      return "passed";
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
      published = true;
    },
    async checks(config) {
      return {
        head: candidate,
        checks: config.requiredChecks.map((name) => ({
          name,
          bucket: "pass" as const,
          link: `https://example.test/check/${name}`,
        })),
      };
    },
    async observeMerge() {
      return merged
        ? { state: "confirmed", value: { number: 338, head: candidate, mergeCommit } }
        : { state: "needs-mutation" };
    },
    async merge() {
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
    assertExecutor: async () => {},
  });

  const accepted = await adapter.source(current.item);
  expect(accepted).toEqual({
    status: "accepted",
    head: candidate,
    reviewId: "source-reviewer",
    stateDirectory: current.paths.source,
  });
  expect(await adapter.history()).toEqual([
    expect.objectContaining({
      ordinal: 1,
      id: "source-author",
      outcome: "passed",
      usage: {
        inputTokens: { status: "known", value: 11 },
        outputTokens: { status: "known", value: 3 },
        costUsd: unavailable,
      },
    }),
    expect.objectContaining({ ordinal: 2, id: "source-reviewer", outcome: "passed" }),
  ]);
  if (accepted.status !== "accepted") throw new Error("fixture source did not accept");
  await expect(adapter.delivery(current.item, accepted)).resolves.toMatchObject({
    status: "complete",
    head: candidate,
    reviewId: "source-reviewer",
    mergeCommit,
  });
  expect(launches).toEqual(["author", "reviewer"]);
  expect({ draft, published, merged, cleaned }).toEqual({
    draft: true,
    published: true,
    merged: true,
    cleaned: true,
  });
});

it("directly composes the accepted repair transition from a complete fixable review", async () => {
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
  const fingerprint = repairDigest({ config: current.source, prompts });
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
      JSON.stringify({ head: candidate, changed: current.item.repair.sourcePaths }),
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
  const pairs = Array.from({ length: 12 }, (_value, index) =>
    index === 0 ? ["BLOCK", "PASS", "F1"] : ["PASS", "PASS", "checked"],
  );
  const sourceSummary = JSON.stringify({
    v: 2,
    head: candidate,
    complete: true,
    scope: "complete",
    profile: "contract",
    g0: ["PASS", "smallest shape"],
    pairs,
    findings: [
      {
        file: current.item.repair.sourcePaths[0],
        line: 1,
        severity: "P1",
        defect: "synthetic fixable defect",
        verification: "hosted focused probe",
      },
    ],
    notes: [],
  });
  const deltaSummary = JSON.stringify({
    v: 2,
    head: repaired,
    complete: true,
    scope: "delta",
    profile: "contract",
    g0: ["PASS", "prescribed remedy only"],
    pairs: Array.from({ length: 12 }, () => ["PASS", "PASS", "checked"]),
    findings: [],
    notes: [],
  });
  let captured: any;
  const repairAdapter: RepairAdapter = {
    async loadSourceReview() {
      return {
        configRecord: { fingerprint, config: current.source, host: "synthetic" },
        candidate: { head: candidate, changed: current.item.repair.sourcePaths },
        authorAttempt: {
          id: "source-author",
          pid: 1,
          trace: resolve(current.root, "author.jsonl"),
        },
        reviewerAttempt: {
          id: "source-reviewer",
          pid: 2,
          trace: resolve(current.root, "reviewer.jsonl"),
        },
        terminal: {
          status: "failed",
          id: "source-reviewer",
          head: candidate,
          summary: sourceSummary,
        },
        changedFiles: current.item.repair.sourcePaths,
        lineCounts: { [current.item.repair.sourcePaths[0]!]: 10 },
        sourceHead: candidate,
        reviewHead: candidate,
        sourceClean: true,
        reviewClean: true,
        promptContents: prompts,
      };
    },
    async dispatch(config) {
      captured = config;
      const records = [
        { ordinal: 3, id: "repair-author", role: "author", head: candidate },
        { ordinal: 4, id: "repair-reviewer", role: "reviewer", head: repaired },
      ] as const;
      for (const row of records) {
        await writeFile(
          resolve(current.paths.queue, `participant-${row.ordinal}-intent.json`),
          JSON.stringify({
            schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
            ordinal: row.ordinal,
            item: current.item.id,
            stage: "repair",
            role: row.role,
          }),
        );
        await writeFile(
          resolve(current.paths.queue, `participant-${row.ordinal}-attempt.json`),
          JSON.stringify({
            schemaVersion: "dogfood-bounded-queue-participant/v1",
            ordinal: row.ordinal,
            id: row.id,
            item: current.item.id,
            stage: "repair",
            role: row.role,
          }),
        );
        await writeFile(
          resolve(current.paths.repair, `${row.role}-attempt.json`),
          JSON.stringify({
            id: row.id,
            pid: row.ordinal,
            trace: resolve(current.root, `${row.id}.jsonl`),
          }),
        );
        await writeFile(
          resolve(current.paths.repair, `${row.role}-terminal.json`),
          JSON.stringify({
            status: "passed",
            id: row.id,
            head: row.head,
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
        );
      }
      return { status: "awaiting-publication" };
    },
    async loadDeltaReview() {
      return {
        configRecord: { fingerprint, config: current.source, host: "synthetic" },
        candidate: { head: repaired, changed: current.item.repair.sourcePaths },
        authorAttempt: {
          id: "repair-author",
          pid: 3,
          trace: resolve(current.root, "repair-author.jsonl"),
        },
        reviewerAttempt: {
          id: "repair-reviewer",
          pid: 4,
          trace: resolve(current.root, "repair-reviewer.jsonl"),
        },
        terminal: {
          status: "passed",
          id: "repair-reviewer",
          head: repaired,
          summary: deltaSummary,
        },
        changedFiles: current.item.repair.sourcePaths,
        lineCounts: { [current.item.repair.sourcePaths[0]!]: 10 },
        sourceHead: repaired,
        reviewHead: repaired,
        sourceClean: true,
        reviewClean: true,
        launchContext: {
          schemaVersion: "dogfood-repair-launch-context/v1",
          run: current.source.run,
          role: "reviewer",
          ordinal: 4,
          head: repaired,
          model: current.item.repair.reviewer.model,
          effort: current.item.repair.reviewer.effort,
          predecessorReviewId: "source-reviewer",
        },
      };
    },
  };
  const adapter = repositoryQueueAdapter(current.config, current.paths.controller, {
    native: {} as never,
    repair: repairAdapter,
  });

  await expect(adapter.repair(current.item)).resolves.toEqual({
    status: "accepted",
    head: repaired,
    reviewId: "repair-reviewer",
    stateDirectory: current.paths.repair,
  });
  expect(captured).toMatchObject({
    mainBase: base,
    repairBase: candidate,
    implementationAttempts: 1,
    implementationAttemptCeiling: 4,
    history: [
      { ordinal: 1, id: "source-author" },
      { ordinal: 2, id: "source-reviewer" },
    ],
    admission: {
      consumed: 2,
      ceiling: 4,
      reservations: [
        { role: "author", ordinal: 3 },
        { role: "reviewer", ordinal: 4 },
      ],
    },
    authority: {
      source: {
        candidateHead: candidate,
        authorAttempt: "source-author",
        reviewerAttempt: "source-reviewer",
        disposition: "BLOCK_FIXABLE",
      },
    },
  });
  expect(captured.history[0].usage).toEqual({
    inputTokens: { status: "known", value: 10 },
    outputTokens: { status: "known", value: 2 },
    costUsd: { status: "unavailable" },
  });
  expect(captured.history[1].usage).toEqual({
    status: "known",
    inputTokens: 8,
    outputTokens: 4,
    costUsd: 1.25,
  });
  expect((await adapter.history()).map((row) => row.id)).toEqual([
    "source-author",
    "source-reviewer",
    "repair-author",
    "repair-reviewer",
  ]);
});

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  queueStep,
  queueUsage,
  reconcileCompletedQueue,
  repositoryQueueAdapter,
} from "../../scripts/dogfood/queue.js";
import type {
  DeliveryAdapter,
  DeliveryConfig,
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
  type QueueAdapter,
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
    exitReceiptWindowMs: 30_000,
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
  const corrected = "f".repeat(40);
  current.item.implementationAttempt = 2;
  current.item.delivery.refresh = {
    number: 337,
    url: "https://example.test/pull/337",
    head: current.item.base,
  };
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
      if (args[0] === "merge-base") return String(args[1]);
      if (args[0] === "diff") return args.includes("--cached") ? "" : `scripts/dogfood/queue.ts\0`;
      if (args[0] === "ls-files") return "";
      if (args[0] === "commit") {
        sourceHead = sourceHead === base ? candidate : corrected;
        return "";
      }
      return "";
    },
    async launch(role, selectedConfig, prompt): Promise<Attempt> {
      const ordinal = launches.length + 1;
      expect(
        JSON.parse(
          await readFile(
            resolve(current.paths.queue, `participant-${ordinal}-intent.json`),
            "utf8",
          ),
        ),
      ).toMatchObject({ ordinal, item: current.item.id, stage: "source", role });
      if (role === "reviewer") {
        expect(prompt).toContain("is there a simpler way?");
        expect(prompt).toContain(JSON.stringify(current.source.allowedPaths));
      }
      const selected = selectedConfig.artifactPrefix
        ? `${selectedConfig.artifactPrefix}-${role}`
        : role;
      launches.push(selected);
      return {
        id: `source-${selected}`,
        pid: pid++,
        trace: resolve(current.root, `${selected}.jsonl`),
      };
    },
    async observe(role, selectedConfig, attempt) {
      const correction = selectedConfig.artifactPrefix === "gate-retry";
      const terminalHead = correction
        ? role === "author"
          ? candidate
          : corrected
        : role === "author"
          ? base
          : candidate;
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
  let publishedDigest = "";
  let merged = false;
  let cleaned = false;
  const publication = (): PublicationEvidence => ({
    number: 338,
    url: "https://example.test/pull/338",
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
  const delivery: DeliveryAdapter = {
    publicationUrl: (_config, number) => `https://example.test/pull/${number}`,
    async source(config) {
      capturedDelivery = config;
      return {
        head: config.candidateHead,
        reviewId:
          config.candidateHead === corrected ? "source-gate-retry-reviewer" : "source-reviewer",
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
      gateCalls += 1;
      return gateCalls === 1 ? { status: "failed", output: "transient typecheck" } : "passed";
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
        ? { state: "confirmed", value: { number: 338, head: corrected, mergeCommit } }
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
    status: "observing-hosted-checks",
    head: corrected,
    reviewId: "source-gate-retry-reviewer",
  });
  const effectsAfterCorrection = { launches: [...launches], gateCalls };
  hostedReady = true;
  await expect(adapter.delivery(current.item, accepted)).resolves.toMatchObject({
    status: "complete",
    head: corrected,
    reviewId: "source-gate-retry-reviewer",
    mergeCommit,
  });
  expect({ launches, gateCalls }).toEqual(effectsAfterCorrection);
  expect(launches).toEqual(["author", "reviewer", "gate-retry-author", "gate-retry-reviewer"]);
  expect({ draft, published, merged, cleaned }).toEqual({
    draft: true,
    published: true,
    merged: true,
    cleaned: true,
  });
  expect(capturedDelivery).toMatchObject({
    refresh: current.item.delivery.refresh,
    authority: { refresh: current.item.delivery.refresh },
  });
});

it("persists the genuine adapter result and restarts four-participant completion without effects", async () => {
  const current = await fixture();
  const sourceSummary = JSON.stringify({
    run: current.source.run,
    role: "reviewer",
    head: candidate,
    verdict: "FAIL",
    findings: [
      {
        file: "scripts/dogfood/queue.ts",
        line: 1,
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
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return args.includes("--cached") ? "" : "scripts/dogfood/queue.ts\0";
      if (args[0] === "ls-files") return "";
      if (args[0] === "commit") {
        sourceHead = candidate;
        return "";
      }
      return "";
    },
    async launch(role) {
      workerEffects.push(`source:${role}`);
      return {
        id: `synthetic-source-${role}`,
        pid: pid++,
        trace: resolve(current.root, `synthetic-source-${role}.jsonl`),
      };
    },
    async observe(role, _config, attempt) {
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
  let sourceArtifacts: any;
  const repairAdapter: RepairAdapter = {
    async loadSourceReview() {
      if (!sourceArtifacts) {
        const read = async (name: string) =>
          JSON.parse(await readFile(resolve(current.paths.source, `${name}.json`), "utf8"));
        sourceArtifacts = {
          configRecord: await read("config"),
          candidate: await read("candidate"),
          authorAttempt: await read("author-attempt"),
          reviewerAttempt: await read("reviewer-attempt"),
          terminal: await read("reviewer-terminal"),
          changedFiles: ["scripts/dogfood/queue.ts"],
          lineCounts: { "scripts/dogfood/queue.ts": 10 },
          sourceHead: candidate,
          reviewHead: candidate,
          sourceClean: true,
          reviewClean: true,
          promptContents: [current.source.author.prompt, current.source.reviewer.prompt],
        };
      }
      return sourceArtifacts;
    },
    async dispatch(config) {
      const rows = [
        {
          ordinal: config.admission.reservations[0].ordinal,
          id: "synthetic-repair-author",
          role: "author" as const,
          head: candidate,
          usage: undefined,
        },
        {
          ordinal: config.admission.reservations[1].ordinal,
          id: "synthetic-repair-reviewer",
          role: "reviewer" as const,
          head: repaired,
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      ];
      workerEffects.push(...rows.map((row) => `repair:${row.role}`));
      for (const row of rows) {
        await Promise.all([
          writeFile(
            resolve(current.paths.queue, `participant-${row.ordinal}-intent.json`),
            JSON.stringify({
              schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
              ordinal: row.ordinal,
              item: current.item.id,
              stage: "repair",
              role: row.role,
            }),
          ),
          writeFile(
            resolve(current.paths.queue, `participant-${row.ordinal}-attempt.json`),
            JSON.stringify({
              schemaVersion: "dogfood-bounded-queue-participant/v1",
              ordinal: row.ordinal,
              id: row.id,
              item: current.item.id,
              stage: "repair",
              role: row.role,
            }),
          ),
          writeFile(
            resolve(current.paths.repair, `${row.role}-attempt.json`),
            JSON.stringify({
              id: row.id,
              pid: row.ordinal + 100,
              trace: resolve(current.root, `${row.id}.jsonl`),
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
    async loadDeltaReview(config) {
      return {
        configRecord: sourceArtifacts.configRecord,
        candidate: { head: repaired, changed: ["scripts/dogfood/queue.ts"] },
        authorAttempt: {
          id: "synthetic-repair-author",
          pid: config.admission.reservations[0].ordinal + 100,
          trace: resolve(current.root, "synthetic-repair-author.jsonl"),
        },
        reviewerAttempt: {
          id: "synthetic-repair-reviewer",
          pid: config.admission.reservations[1].ordinal + 100,
          trace: resolve(current.root, "synthetic-repair-reviewer.jsonl"),
        },
        terminal: {
          status: "passed",
          id: "synthetic-repair-reviewer",
          head: repaired,
          usage: { input_tokens: 5, output_tokens: 2 },
          summary: deltaSummary,
        },
        changedFiles: ["scripts/dogfood/queue.ts"],
        lineCounts: { "scripts/dogfood/queue.ts": 10 },
        sourceHead: repaired,
        reviewHead: repaired,
        sourceClean: true,
        reviewClean: true,
        launchContext: {
          schemaVersion: "dogfood-repair-launch-context/v1",
          run: config.run,
          role: "reviewer",
          ordinal: config.admission.reservations[1].ordinal,
          head: repaired,
          model: current.item.repair.reviewer.model,
          effort: current.item.repair.reviewer.effort,
          predecessorReviewId: "synthetic-source-reviewer",
        },
      };
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
    repair: repairAdapter,
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
    async assertAuthority() {
      componentEntries.push("authority");
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
    await readFile(resolve(current.paths.queue, "item-1-complete.json"), "utf8"),
  );
  expect(Object.keys(completed).sort()).toEqual(
    [
      "schemaVersion",
      "item",
      "issue",
      "base",
      "stage",
      "history",
      "status",
      "run",
      "head",
      "reviewId",
      "publication",
      "checks",
      "mergeCommit",
      "cleanup",
    ].sort(),
  );
  expect(completed).toMatchObject({
    status: "complete",
    run: current.source.run,
    issue: current.item.issue,
    head: repaired,
    reviewId: "synthetic-repair-reviewer",
    checks: current.source.requiredChecks.map((name) => ({ name, bucket: "pass" })),
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
  expect(completed.checks).toEqual(
    current.source.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: `https://example.test/check/${name}`,
    })),
  );
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
  expect(componentEntries).toEqual(["authority", "setup", "source", "repair", "delivery"]);
  const queueFiles = (await readdir(current.paths.queue)).sort();
  const originalBytes = await Promise.all(
    queueFiles.map((name) => readFile(resolve(current.paths.queue, name), "utf8")),
  );
  const entriesAfterCompletion = componentEntries.length;
  const effectsAfterCompletion = mutationEffects.length;

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({ status: "complete" });
  expect(componentEntries.slice(entriesAfterCompletion)).toEqual(["authority"]);
  expect(mutationEffects).toHaveLength(effectsAfterCompletion);
  const entriesBeforeReadOnly = componentEntries.length;
  await expect(
    reconcileCompletedQueue(current.config, { history: repository.history }),
  ).resolves.toMatchObject({ status: "complete", participants: 4 });
  expect(componentEntries).toHaveLength(entriesBeforeReadOnly);
  expect(mutationEffects).toHaveLength(effectsAfterCompletion);
  expect(workerEffects).toEqual([
    "source:author",
    "source:reviewer",
    "repair:author",
    "repair:reviewer",
  ]);
  expect((await readdir(current.paths.queue)).sort()).toEqual(queueFiles);
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
    async loadSourceReview() {
      return {
        configRecord: { fingerprint, config: current.source, host: "synthetic" },
        candidate: { head: candidate, changed: current.source.allowedPaths },
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
        changedFiles: current.source.allowedPaths,
        lineCounts: { [current.source.allowedPaths[0]!]: 10 },
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
        { ordinal: 3, id: "repair-author", role: "author", head: candidate, stem: "author" },
        { ordinal: 4, id: "repair-reviewer", role: "reviewer", head: repaired, stem: "reviewer" },
        {
          ordinal: 5,
          id: "repair-reviewer-retry",
          role: "reviewer",
          head: repaired,
          stem: "reviewer-retry",
        },
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
            status: row.id === "repair-reviewer" ? "malformed" : "passed",
            id: row.id,
            head: row.head,
            usage: { input_tokens: 5, output_tokens: 2 },
            ...(row.id === "repair-reviewer-retry" ? { summary: deltaSummary } : {}),
          }),
        );
      }
      await writeFile(
        resolve(current.paths.repair, "reviewer-retry-intent.json"),
        JSON.stringify({
          reason: "malformed-review",
          count: 1,
          head: repaired,
          parseError: "malformed-worker-verdict",
        }),
      );
      return { status: "awaiting-publication" };
    },
    async loadDeltaReview() {
      return {
        configRecord: { fingerprint, config: current.source, host: "synthetic" },
        candidate: { head: repaired, changed: current.source.allowedPaths },
        authorAttempt: {
          id: "repair-author",
          pid: 3,
          trace: resolve(current.root, "repair-author.jsonl"),
        },
        reviewerAttempt: {
          id: "repair-reviewer-retry",
          pid: 5,
          trace: resolve(current.root, "repair-reviewer-retry.jsonl"),
        },
        terminal: {
          status: "passed",
          id: "repair-reviewer-retry",
          head: repaired,
          summary: deltaSummary,
        },
        changedFiles: current.source.allowedPaths,
        lineCounts: { [current.source.allowedPaths[0]!]: 10 },
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
    reviewId: "repair-reviewer-retry",
    stateDirectory: current.paths.repair,
  });
  await expect(adapter.repair(current.item)).resolves.toEqual({
    status: "accepted",
    head: repaired,
    reviewId: "repair-reviewer-retry",
    stateDirectory: current.paths.repair,
  });
  expect(captured).toMatchObject({
    mainBase: base,
    repairBase: candidate,
    implementationAttempts: 2,
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
    "repair-reviewer-retry",
  ]);
});

it("advances once when a malformed repair review retry returns a valid FAIL", async () => {
  const current = await fixture();
  const prompts: [string, string] = [current.source.author.prompt, current.source.reviewer.prompt];
  const fingerprint = repairDigest({ config: current.source, prompts });
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
      ...sourceParticipants.flatMap((participant) => [
        writeFile(
          resolve(current.paths.queue, `participant-${participant.ordinal}-intent.json`),
          JSON.stringify({
            schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
            ordinal: participant.ordinal,
            item: participant.item,
            stage: participant.stage,
            role: participant.role,
          }),
        ),
        writeFile(
          resolve(current.paths.queue, `participant-${participant.ordinal}-attempt.json`),
          JSON.stringify({
            schemaVersion: "dogfood-bounded-queue-participant/v1",
            ordinal: participant.ordinal,
            id: participant.id,
            item: participant.item,
            stage: participant.stage,
            role: participant.role,
          }),
        ),
        writeFile(
          resolve(current.paths.queue, `participant-${participant.ordinal}-terminal.json`),
          JSON.stringify(participant),
        ),
      ]),
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
        }),
      ),
      writeFile(
        resolve(current.paths.source, "reviewer-attempt.json"),
        JSON.stringify({
          id: "source-reviewer",
          pid: 2,
          trace: resolve(current.root, "reviewer.jsonl"),
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
    async loadSourceReview() {
      return {
        configRecord: { fingerprint, config: current.source, host: "synthetic" },
        candidate: { head: candidate, changed: current.source.allowedPaths },
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
        changedFiles: current.source.allowedPaths,
        lineCounts: { [current.source.allowedPaths[0]!]: 10 },
        sourceHead: candidate,
        reviewHead: candidate,
        sourceClean: true,
        reviewClean: true,
        promptContents: prompts,
      };
    },
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
          id: "repair-reviewer",
          role: "reviewer",
          status: "malformed",
          head: repaired,
        },
        {
          ordinal: 5,
          stem: "reviewer-retry",
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
      await writeFile(
        resolve(current.paths.repair, "reviewer-retry-intent.json"),
        JSON.stringify({
          reason: "malformed-review",
          count: 1,
          head: repaired,
          parseError: "malformed-worker-verdict",
        }),
      );
      for (const attempt of attempts) {
        await Promise.all([
          writeFile(
            resolve(current.paths.queue, `participant-${attempt.ordinal}-intent.json`),
            JSON.stringify({
              schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
              ordinal: attempt.ordinal,
              item: current.item.id,
              stage: "repair",
              role: attempt.role,
            }),
          ),
          writeFile(
            resolve(current.paths.queue, `participant-${attempt.ordinal}-attempt.json`),
            JSON.stringify({
              schemaVersion: "dogfood-bounded-queue-participant/v1",
              ordinal: attempt.ordinal,
              id: attempt.id,
              item: current.item.id,
              stage: "repair",
              role: attempt.role,
            }),
          ),
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
      throw new Error("reviewer-failed");
    },
    async loadDeltaReview() {
      throw new Error("delta review must not load after the flow failure");
    },
  };
  const repository = repositoryQueueAdapter(current.config, current.paths.controller, {
    native: {} as never,
    repair: repairAdapter,
  });
  const adapter: QueueAdapter = {
    async assertAuthority() {},
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
    JSON.parse(await readFile(resolve(current.paths.queue, "item-1-failed.json"), "utf8")),
  ).toMatchObject({ candidateAttempt: 2, head: repaired, reviewer: "repair-reviewer-retry" });
});

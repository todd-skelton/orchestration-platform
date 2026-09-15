import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  QueueBlocked,
  queueStep,
  queueUsage,
  repositoryQueueAdapter,
} from "../../scripts/dogfood/queue.js";
import type {
  DeliveryAdapter,
  DeliveryConfig,
  DeliveryPlan,
  PublicationEvidence,
} from "../../scripts/dogfood/delivery.js";
import { sha, type Adapter, type Attempt } from "../../scripts/dogfood/flow.js";
import type { RepairAdapter } from "../../scripts/dogfood/repair-adapter.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import type { SetupAdapter, SetupRole } from "../../scripts/dogfood/setup.js";
import { isItemStopReason } from "../../scripts/dogfood/supervision.js";
import { codexAdapter } from "../../scripts/dogfood/dispatch-adapter.js";
import {
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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
      async failedCheckLog(config: DeliveryConfig, check: { name: string }) {
        expect(config.candidateHead).toBe(base);
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
  "lands after an author death and gate correction across restart (provider outage: %s)",
  async (providerFailure) => {
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
        if (role === "reviewer" && !correction) {
          expect(prompt).toContain("is there a simpler way?");
          expect(prompt).toContain(JSON.stringify(current.source.allowedPaths));
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
  expect(Object.keys(completed).sort()).toEqual(
    [
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

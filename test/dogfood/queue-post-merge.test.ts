import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  deliveryStep,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DeliveryPlan,
} from "../../scripts/dogfood/delivery.js";
import { retainedPostMergeDelivery, type LoopConfig } from "../../scripts/dogfood/queue.js";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const head = "a".repeat(40);
const base = "b".repeat(40);
const mergeCommit = "c".repeat(40);
const revision = "d".repeat(40);

async function fixture(localBranch = true, retained: "source" | "refresh" | "recovery" = "source") {
  const root = await mkdtemp(resolve(tmpdir(), "retained-post-merge-"));
  roots.push(root);
  const run = "synthetic-iss184";
  const stateRoot = resolve(root, "runtime");
  const directory = resolve(stateRoot, run, "cs-8041-attempt-1");
  const origin = resolve(directory, "source");
  const source =
    retained === "source"
      ? origin
      : resolve(origin, retained === "refresh" ? `refresh-${revision}` : "gate-stop-continuation");
  const controllerRoot = resolve(root, "executor");
  const worktree = resolve(root, "worktrees/source");
  const reviewWorktree = resolve(root, "worktrees/review");
  for (const path of [
    source,
    controllerRoot,
    worktree,
    reviewWorktree,
    resolve(directory, "setup"),
  ])
    await mkdir(path, { recursive: true });
  const issue = "https://github.com/chase-sets/chase-sets/issues/8041";
  const branch = "codex/8041-script-delivery-g1";
  const sourceBranch = localBranch ? "codex/run-synthetic/cs-8041-attempt-1" : branch;
  const config: DeliveryConfig = {
    controller: "synthetic-controller",
    run,
    issue,
    repository: "chase-sets/chase-sets",
    controllerRoot,
    repositoryRoot: controllerRoot,
    controllerRevision: revision,
    worktree,
    reviewWorktree,
    stateDirectory: source,
    candidateHead: head,
    retries: 1,
    ...(localBranch ? { localBranch: sourceBranch } : {}),
    requiredChecks: ["PR Required"],
    policy: { key: "cs-8041", number: 8041, title: "Script delivery", sourceBranch: branch },
  };
  const plan: DeliveryPlan = {
    gates: { beforeMirror: ["test"], afterMirror: [] },
    drafts: [],
    publication: {
      sourceBranch: branch,
      baseBranch: "main",
      title: "Script delivery",
      body: "Synthetic retained PR",
      draft: true,
    },
    mergePolicy: { method: "queue" },
    cleanup: { worktrees: [worktree, reviewWorktree], branch: sourceBranch },
  };
  const effects = { publish: 0, merge: 0, cleanup: 0, eligibility: 0, hook: 0 };
  let publication: any;
  const adapter: DeliveryAdapter = {
    publicationUrl: (_config, number) => `https://github.com/chase-sets/chase-sets/pull/${number}`,
    async source() {
      return {
        head,
        reviewId: "synthetic-review",
        controller: config.controller,
        run,
        issue,
        repository: config.repository,
        controllerRevision: revision,
        worktree,
        reviewWorktree,
        stateDirectory: source,
        requiredChecks: config.requiredChecks,
      };
    },
    async verifyWorkspace() {
      return true;
    },
    async runGate() {
      return "passed";
    },
    async observeDraft() {
      throw new Error("no drafts");
    },
    async applyDraft() {
      throw new Error("no drafts");
    },
    async observePublication() {
      return publication
        ? { state: "confirmed", value: publication }
        : { state: "needs-mutation", target: "synthetic-absent" };
    },
    async publish(_config, publishedPlan) {
      effects.publish++;
      publication = {
        number: 8055,
        url: adapter.publicationUrl(config, 8055),
        head,
        repository: config.repository,
        sourceBranch: branch,
        baseBranch: "main",
        title: publishedPlan.title,
        body: publishedPlan.body,
        planDigest: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
      };
    },
    async checks() {
      return {
        head,
        checks: [
          {
            name: "PR Required",
            bucket: "pass",
            link: "https://github.com/chase-sets/chase-sets/actions/runs/123/job/456",
          },
        ],
      };
    },
    async observeMerge() {
      return effects.merge
        ? { state: "confirmed", value: { number: 8055, head, mergeCommit } }
        : { state: "needs-mutation" };
    },
    async merge() {
      effects.merge++;
    },
    async observeCleanup() {
      return effects.cleanup
        ? { state: "confirmed", value: plan.cleanup }
        : { state: "needs-mutation" };
    },
    async cleanup() {
      effects.cleanup++;
      await rm(worktree, { recursive: true });
      await rm(reviewWorktree, { recursive: true });
    },
  };
  const history = ["synthetic-author-dead", "synthetic-author-pass", "synthetic-review"].map(
    (id, index) => ({
      ordinal: index + 1,
      id,
      item: "cs-8041:1",
      stage: "source",
      role: index === 2 ? "reviewer" : "author",
      outcome: index === 0 ? "dead" : "passed",
      usage: {
        inputTokens: { status: "unavailable" },
        outputTokens: { status: "unavailable" },
        costUsd: { status: "unavailable" },
      },
    }),
  );
  const save = async (path: string, value: unknown) =>
    writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  await save(resolve(directory, "attempt.json"), {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    run,
    index: 0,
    item: "cs-8041:1",
    issue,
    base,
    candidateAttempt: 1,
    phase: "delivery",
    head,
    reviewId: "synthetic-review",
    findings: [],
    history,
    retries: 1,
    acceptedStage: "source",
    stateDirectory: origin,
    authorFailures: { count: 1, ids: [history[0]!.id] },
  });
  for (const participant of history)
    await save(resolve(directory, `participant-${participant.ordinal}-terminal.json`), participant);
  await save(resolve(directory, "setup/setup-plan.json"), {
    schemaVersion: "dogfood-setup-plan/v1",
    run,
    issue,
    repository: config.repository,
    controllerRoot,
    repositoryRoot: controllerRoot,
    sourceBranch,
  });
  // These are untouched historical records, not inputs granting deployment authority.
  for (const name of ["candidate", "author-attempt", "reviewer-terminal"])
    await save(resolve(source, `${name}.json`), { retained: name });
  if (retained === "refresh")
    await save(resolve(origin, "native-refresh.json"), {
      directory: source,
      main: revision,
      head,
      retries: 1,
      resolutionUsed: true,
    });
  if (retained === "recovery") {
    const priorDelivery = { ...config, stateDirectory: origin };
    // A completed recovery supersedes the source's earlier correction pointer.
    // These old records are retained unchanged, not renewed admission.
    await save(resolve(origin, "gate-correction.json"), {
      directory: resolve(origin, "gate-correction"),
      delivery: priorDelivery,
    });
    await save(resolve(origin, "gate-correction-result.json"), {
      head,
      reviewId: "synthetic-review",
      retries: 1,
    });
    await save(resolve(origin, "gate-stop-continuation.json"), { delivery: priorDelivery });
  }
  await expect(
    deliveryStep(config, adapter, {
      async plan() {
        return plan;
      },
    }),
  ).resolves.toMatchObject({ status: "complete", mergeCommit });
  const loop: LoopConfig = {
    schemaVersion: "dogfood-loop/v1",
    run,
    adapter: "chase-sets",
    repository: config.repository,
    stableExecutorRoot: controllerRoot,
    stateRoot,
    worktreeRoot: resolve(root, "worktrees"),
    codexExecutable: process.execPath,
    gitExecutable: process.execPath,
    author: { model: "synthetic-author", effort: "high" },
    reviewer: { model: "synthetic-reviewer", effort: "high" },
    routingRows: [
      {
        row: 7,
        review: 11,
        author: [{ model: "synthetic-author", effort: "high" }],
        reviewer: [{ model: "synthetic-reviewer", effort: "high" }],
      },
    ],
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  const cycle = { selection: { cycle: 1, key: "cs-8041", number: 8041, base }, initialHistory: [] };
  await persistCycle(loop, cycle);
  const supervisor: SupervisionAdapter = {
    async currentMain() {
      return base;
    },
    async issue() {
      return { state: "CLOSED", key: "cs-8041", labels: [], comments: [] };
    },
    async close() {
      throw new Error("already closed");
    },
    async removeReady() {
      throw new Error("already closed");
    },
    async comment() {
      throw new Error("not a stopped cycle");
    },
  };
  const repository = {
    async selectCandidates() {
      effects.eligibility++;
      return [];
    },
    async issueContext() {
      effects.eligibility++;
      throw new Error("closed ops issue cannot be recomposed");
    },
    async afterMerge(value: any) {
      effects.hook++;
      expect(value.delivery.mergeCommit).toBe(mergeCommit);
    },
  } as unknown as RepositoryAdapter;
  const next = () => nextCycle(loop, controllerRoot, supervisor, repository, async () => {});
  return {
    config,
    loop,
    cycle,
    next,
    supervisor,
    repository,
    effects,
    directory,
    source,
    save,
    history,
  };
}

async function bytes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, file.name);
    if (file.isDirectory()) Object.assign(result, await bytes(path));
    else result[path] = await readFile(path, "utf8");
  }
  return result;
}

it.each([false, true])(
  "resumes only the pending native hook with a closed issue and absent worktrees (new branch: %s)",
  async (localBranch) => {
    const f = await fixture(localBranch);
    const preserved = await bytes(f.directory);
    expect(await f.next()).toEqual(f.cycle);
    const hook = vi
      .spyOn(f.repository, "afterMerge")
      .mockRejectedValueOnce(new Error("synthetic interruption in hook"));
    const retained = await retainedPostMergeDelivery(f.loop, f.cycle.selection);
    expect(retained).toBeDefined();
    await expect(f.repository.afterMerge(retained!)).rejects.toThrow("synthetic interruption");
    expect(await f.next()).toEqual(f.cycle);
    hook.mockRestore();
    const replay = await retainedPostMergeDelivery(f.loop, f.cycle.selection);
    await f.repository.afterMerge(replay!);
    // Interruption after hook, before cycle receipt, repeats only that hook (rule 9).
    expect(await f.next()).toEqual(f.cycle);
    await f.repository.afterMerge((await retainedPostMergeDelivery(f.loop, f.cycle.selection))!);
    await completeCycle(f.loop, f.cycle, replay!.history, f.supervisor);
    expect(await f.next()).toBeUndefined();
    expect(await f.next()).toBeUndefined();
    expect(await bytes(f.directory)).toEqual(preserved);
    expect(f.effects).toEqual({
      publish: 1,
      merge: 1,
      cleanup: 1,
      eligibility: 2,
      hook: 2,
    });
    const completion = JSON.parse(
      await readFile(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-complete.json"), "utf8"),
    );
    expect(completion.history).toEqual(f.history);
  },
);

it.each(["refresh", "recovery"] as const)(
  "resumes the retained %s delivery instead of its predecessor",
  async (mode) => {
    const f = await fixture(true, mode);
    const preserved = await bytes(f.directory);
    expect(await f.next()).toEqual(f.cycle);
    const retained = await retainedPostMergeDelivery(f.loop, f.cycle.selection);
    expect(retained!.config.stateDirectory).toBe(f.source);
    await f.repository.afterMerge(retained!);
    await completeCycle(f.loop, f.cycle, retained!.history, f.supervisor);
    expect(await f.next()).toBeUndefined();
    expect(await bytes(f.directory)).toEqual(preserved);
    expect(f.effects).toEqual({ publish: 1, merge: 1, cleanup: 1, eligibility: 1, hook: 1 });
  },
);

it.each([
  "merge",
  "cleanup",
  "delivery-source",
  "delivery-config",
  "delivery-plan",
  "delivery-plan-authorization",
  "publication",
  "hosted-checks",
  "gate-1",
])("refuses missing retained %s without completing a closed native obligation", async (name) => {
  const f = await fixture();
  await rm(resolve(f.source, `${name}.json`));
  const preserved = await bytes(f.directory);
  await expect(f.next()).rejects.toThrow();
  await expect(
    readFile(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-complete.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await bytes(f.directory)).toEqual(preserved);
  expect(f.effects).toEqual({
    publish: 1,
    merge: 1,
    cleanup: 1,
    eligibility: 0,
    hook: 0,
  });
});

it.each(["merge", "cleanup", "delivery-source"])("refuses mismatched retained %s", async (name) => {
  const f = await fixture();
  const path = resolve(f.source, `${name}.json`);
  await f.save(path, { ...JSON.parse(await readFile(path, "utf8")), head: "f".repeat(40) });
  await expect(f.next()).rejects.toThrow();
  expect(f.effects.hook).toBe(0);
});

it("retains external-closure behavior when there is no native merged/cleaned obligation", async () => {
  const f = await fixture();
  await rm(resolve(f.source, "merge.json"));
  await rm(resolve(f.source, "cleanup.json"));
  const preserved = await bytes(f.directory);
  expect(await f.next()).toBeUndefined();
  expect(f.effects.hook).toBe(0);
  expect(await bytes(f.directory)).toEqual(preserved);
});

it.each([false, true])(
  "the native supervisor command retains post-merge accounting before composition (hook fails: %s)",
  async (fails) => {
    const f = await fixture();
    const preserved = await bytes(f.directory);
    const runState = resolve(f.loop.stateRoot, f.loop.run);
    const request = resolve(f.loop.stateRoot, "loop.json");
    await f.save(request, f.loop);
    if (fails)
      await f.save(resolve(runState, "command-controls.json"), {
        postMergeStop: "deploy-not-verified",
      });
    await f.save(resolve(runState, "command-issue.json"), {
      state: "CLOSED",
      key: "cs-8041",
      labels: [],
      comments: [],
    });
    let invocation = 0;
    const command = async () => {
      const outPath = resolve(f.loop.stateRoot, `invoke-${++invocation}.stdout`);
      const errPath = resolve(f.loop.stateRoot, `invoke-${invocation}.stderr`);
      // Match the owning command fixtures: the Linux worker sandbox hides
      // socketpair stdout from Node's handle guess; file descriptors retain it.
      const stdout = await open(outPath, "wx");
      const stderr = await open(errPath, "wx");
      try {
        const code = await new Promise((done, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              pathToFileURL(resolve(import.meta.dirname, "supervise-fixtures/hook.mjs")).href,
              resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs"),
              request,
            ],
            {
              env: { ...process.env, SUPERVISE_FIXTURE_STATE: runState },
              stdio: ["ignore", stdout.fd, stderr.fd],
              timeout: 10_000,
              windowsHide: true,
            },
          );
          child.on("error", reject);
          child.on("close", done);
        });
        expect(code).toBe(fails ? 1 : 0);
      } finally {
        await stdout.close();
        await stderr.close();
      }
      return { stdout: await readFile(outPath, "utf8"), stderr: await readFile(errPath, "utf8") };
    };
    const first = await command();
    if (fails) {
      expect(JSON.parse(first.stderr)).toMatchObject({ reason: "deploy-not-verified" });
      const stopped = JSON.parse(await readFile(resolve(runState, "cycle-1-stop-1.json"), "utf8"));
      expect(stopped).toMatchObject({
        attempts: 1,
        history: f.history,
        reason: "deploy-not-verified",
      });
      expect(await bytes(f.directory)).toEqual(preserved);
      await expect(readFile(resolve(runState, "cycle-1-complete.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      return;
    }
    expect(JSON.parse(first.stdout)).toEqual({ status: "idle", run: f.loop.run });
    expect(first.stderr).toBe("");
    expect(await command()).toEqual(first);
    // The real supervisor and retained queue/delivery consumers ran. The command
    // effect fixture logs workspace composition and native launch/mutation entries.
    expect(await readFile(resolve(runState, "command-calls.log"), "utf8")).toBe(
      `issue:8041\npost-merge:${mergeCommit}\nissue:8041\n`,
    );
    expect(await bytes(f.directory)).toEqual(preserved);
    const completion = JSON.parse(
      await readFile(resolve(runState, "cycle-1-complete.json"), "utf8"),
    );
    expect(completion.history).toEqual(f.history);
  },
);

import { mkdtemp, realpath, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { correctGate, QueueBlocked, step, workerPrompt } from "../../scripts/dogfood/flow.js";
import type { Adapter, Check, Config, Role, Terminal } from "../../scripts/dogfood/flow.js";
import {
  deliveryStep,
  type DeliveryAdapter,
  type DeliveryConfig,
} from "../../scripts/dogfood/delivery.js";
import {
  repositoryDeliveryPolicy,
  type RepositoryAdapter,
} from "../../scripts/dogfood/repository-adapter.js";
import { parseTrace, waitForProvider } from "../../scripts/dogfood/dispatch-adapter.js";
import { stopCycle } from "../../scripts/dogfood/supervision.js";
import type { LoopConfig } from "../../scripts/dogfood/queue.js";
import { reviewedRepairAdapter } from "../../scripts/dogfood/repair-adapter.js";
import { SELF_ROUTING } from "../../scripts/dogfood/routing.mjs";
import { evidenceDescriptor, writeEvidence } from "./fixtures/continuation.js";

const base = "a".repeat(40),
  head = "b".repeat(40),
  pilotRevision = "c".repeat(40);
const cleanup: string[] = [];
const providerBaseUrl = "http://provider.test/v1";
function deadTrace(message: string, config: Config) {
  const trace =
    [
      { type: "thread.started", thread_id: "01a048fe-90c8-7cb3-8da5-938c1f5cb5f0" },
      { type: "turn.failed", error: { message } },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n";
  return parseTrace(trace, true, "author", config, undefined, true, providerBaseUrl);
}
it("pauses a completed author before reviewer intent and resumes once from a retained host snapshot", async () => {
  const f = await fixture();
  const e = evidenceDescriptor(resolve(f.config.stateDirectory, "external"));
  f.config.preReviewEvidence = e;
  f.config.correctionPaths = ["scripts/repair.mjs"];
  f.authorDone();
  for (let i = 0; i < 2; i++) await expect(f.run()).rejects.toThrow("operator-evidence-required");
  expect(f.launches).toEqual(["author"]);
  expect(f.commits).toHaveLength(1);
  await expect(
    readFile(resolve(f.config.stateDirectory, "reviewer-intent.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    JSON.parse(await readFile(resolve(f.config.stateDirectory, "candidate.json"), "utf8")).head,
  ).toBe(head);
  await writeEvidence(e, f.config.repository, head);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  const snapshot = resolve(f.config.stateDirectory, "pre-review-evidence");
  const saved = await readFile(resolve(snapshot, "acceptance.json"), "utf8");
  expect(JSON.parse(saved)).toMatchObject({
    head,
    passed: true,
    result: { tests: 386, skips: 0, cases: e.requiredCases },
  });
  for (const path of Object.values(e.bundle)) await rm(path);
  f.reviewerDone();
  await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication" });
  await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication" });
  expect(f.launches).toEqual(["author", "reviewer"]);
  expect(f.commits).toHaveLength(1);
  expect(f.launchPrompts[1]).toContain(resolve(snapshot, "acceptance.json"));
  expect(await readFile(resolve(snapshot, "acceptance.json"), "utf8")).toBe(saved);
  for (const name of ["receipt", "runMetadata", "preflightLog", "verifierLog"])
    expect((await readFile(resolve(snapshot, name))).length).toBeGreaterThan(0);
});

it.each([
  "wrong-head",
  "wrong-command",
  "wrong-repository",
  "duplicate-case",
  "duplicate-key",
  "contradictory",
  "malformed",
])("rejects %s host authority before review and retains the same author", async (mode) => {
  const f = await fixture();
  const e = evidenceDescriptor(resolve(f.config.stateDirectory, "external"));
  f.config.preReviewEvidence = e;
  f.authorDone();
  await expect(f.run()).rejects.toThrow("operator-evidence-required");
  await writeEvidence(
    e,
    f.config.repository,
    head,
    mode === "wrong-head"
      ? { head: base }
      : mode === "wrong-command"
        ? { command: { ...e.command, args: ["test:subset"] } }
        : mode === "wrong-repository"
          ? { repository: "other/repo" }
          : mode === "duplicate-case"
            ? { cases: [e.requiredCases[0], e.requiredCases[0]] }
            : {},
    mode === "contradictory"
      ? (receipt) => {
          receipt.tests = 1;
        }
      : undefined,
  );
  if (mode === "malformed") await writeFile(e.bundle.receipt, "{");
  if (mode === "duplicate-key") {
    const receipt = await readFile(e.bundle.receipt, "utf8");
    await writeFile(e.bundle.receipt, receipt.replace("{", '{"head":"' + head + '",'));
  }
  await expect(f.run()).rejects.toThrow("operator-evidence-authority");
  expect(f.launches).toEqual(["author"]);
  await expect(
    readFile(resolve(f.config.stateDirectory, "pre-review-evidence/acceptance.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await writeEvidence(e, f.config.repository, head);
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.launches).toEqual(["author", "reviewer"]);
});

it.each([
  { exitCode: 1 },
  { exitCode: -1 },
  { skips: 1 },
  { tests: 384 },
  { files: 17 },
  { cases: [] },
])("makes identity-valid failed execution %j irreversible for this candidate", async (changes) => {
  const f = await fixture();
  const e = evidenceDescriptor(resolve(f.config.stateDirectory, "external"));
  f.config.preReviewEvidence = e;
  f.authorDone();
  await writeEvidence(e, f.config.repository, head, changes);
  await expect(f.run()).rejects.toThrow("operator-evidence-failed");
  const path = resolve(f.config.stateDirectory, "pre-review-evidence/acceptance.json");
  const failure = await readFile(path, "utf8");
  await writeEvidence(e, f.config.repository, head);
  await expect(f.run()).rejects.toThrow("operator-evidence-failed");
  expect(await readFile(path, "utf8")).toBe(failure);
  expect(f.launches).toEqual(["author"]);
});

it("reconciles an interrupted final author commit without another author", async () => {
  const f = await fixture();
  f.config.correctionPaths = ["scripts/repair.mjs"];
  f.authorDone();
  const git = f.adapter.git;
  let interrupted = false;
  f.adapter.git = async (tree, args) => {
    if (args[0] === "rev-parse" && args[1]?.endsWith("^")) return base;
    const result = await git(tree, args);
    if (args[0] === "commit" && !interrupted) {
      interrupted = true;
      throw new Error("lost commit response");
    }
    return result;
  };
  await expect(f.run()).rejects.toThrow("lost commit response");
  await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(f.launches).toEqual(["author", "reviewer"]);
  expect(f.commits).toHaveLength(1);
});

it.each(["sibling", "untracked", "rename"])(
  "rejects %s outside the closed correction paths before committing or reviewing",
  async (mode) => {
    const f = await fixture();
    f.config.allowedPaths = ["."];
    f.config.correctionPaths = ["scripts/repair.mjs"];
    if (mode === "sibling") f.setChanged("scripts/sibling.mjs\0");
    if (mode === "untracked") f.setUntracked("scripts/new.mjs\0");
    if (mode === "rename") f.setChanged("scripts/repair.mjs\0scripts/renamed.mjs\0");
    f.authorDone();
    await expect(f.run()).rejects.toThrow("outside-footprint");
    expect(f.commits).toHaveLength(0);
    expect(f.launches).toEqual(["author"]);
  },
);

afterEach(async () => {
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-test-")));
  cleanup.push(root);
  const paths = ["pilot", "author", "reviewer", "state"].map((name) => resolve(root, name));
  for (const path of paths) await mkdir(path);
  const [pilot, worktree, reviewWorktree, stateDirectory] = paths as [
    string,
    string,
    string,
    string,
  ];
  const config: Config = {
    owner: "controller",
    run: "one-trial",
    issue: "ISS-071",
    pilotRevision,
    base,
    worktree,
    reviewWorktree,
    stateDirectory,
    allowedPaths: ["scripts/repair.mjs"],
    repository: "owner/repo",
    requiredChecks: ["linux", "macos", "windows"],
    author: { model: "test", effort: "low", prompt: "Improve the selected issue." },
    reviewer: { model: "test", effort: "low", prompt: "Improve the selected issue." },
    adapter: { kind: "codex-exec", executable: process.execPath },
  };
  let currentHead = base,
    reviewHead = base,
    changed = "scripts/repair.mjs\0",
    untracked = "",
    cached = "",
    ciHead = head;
  let unavailable = false,
    reviewerDirty = false,
    sameIdentity = false,
    authorDirty = false,
    authorComplete = false;
  const statuses: Record<Role, Terminal["status"]> = { author: "running", reviewer: "running" };
  let retryStatus: Terminal["status"] = "running";
  const summaries: Partial<Record<Role, unknown>> = {};
  let retrySummary: unknown;
  const launches: Role[] = [],
    observations: Role[] = [],
    launchPrompts: string[] = [];
  const staged: string[][] = [],
    commits: string[][] = [],
    resets: string[][] = [],
    cleans: string[][] = [];
  let checks: Check[] = config.requiredChecks.map((name) => ({
    name,
    bucket: "pass",
    link: `https://ci.example/${name}`,
  }));
  const adapter: Adapter = {
    async preflight() {
      if (unavailable) throw new Error("host-adapter-unavailable");
    },
    async git(tree, args) {
      if (args[1] === "--show-toplevel") return tree;
      if (args[0] === "status")
        return tree === reviewWorktree && reviewerDirty
          ? " M file"
          : tree === worktree &&
              (authorDirty || (authorComplete && (changed || cached || untracked))) &&
              currentHead === base
            ? " M source"
            : "";
      if (args[0] === "rev-parse")
        return tree === pilot ? pilotRevision : tree === worktree ? currentHead : reviewHead;
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return args.includes("--cached") ? cached : changed;
      if (args[0] === "ls-files") return untracked;
      if (args[0] === "--literal-pathspecs") {
        staged.push(args.slice(4));
        return "";
      }
      if (args[0] === "commit") {
        commits.push(args);
        currentHead = head;
        changed = staged.at(-1)!.join("\0") + "\0";
        untracked = "";
        cached = "";
        return "";
      }
      if (args[0] === "reset") {
        resets.push(args);
        currentHead = args[2]!;
        authorDirty = false;
        authorComplete = false;
        cached = "";
        return "";
      }
      if (args[0] === "clean") {
        cleans.push(args);
        untracked = "";
        return "";
      }
      if (args[0] === "checkout") {
        reviewHead = args[2]!;
        return "";
      }
      throw new Error(`unexpected git operation ${args}`);
    },
    async launch(role, selectedConfig, prompt) {
      expect(prompt).toContain(role === "author" ? selectedConfig.base : head);
      launches.push(role);
      launchPrompts.push(prompt);
      const count = launches.filter((launch) => launch === role).length;
      const retry = count > 1;
      return {
        id: retry
          ? `${role}-retry${count > 2 ? count : ""}`
          : role === "reviewer" && sameIdentity
            ? "author"
            : role,
        pid: 123,
        trace: resolve(selectedConfig.stateDirectory, `${role}-${count}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, _selectedConfig, attempt) {
      observations.push(role);
      const retry = attempt.id.startsWith(`${role}-retry`);
      const status = retry ? retryStatus : statuses[role];
      const summary = retry ? retrySummary : summaries[role];
      if (role === "author" && status === "dead") authorDirty = true;
      if (role === "author" && status === "passed") authorComplete = true;
      return {
        ...(status === "dead" ? deadTrace(String(summary ?? "worker exited"), config) : {}),
        status,
        id: attempt.id,
        ...(status === "running" ? {} : { head: role === "author" ? _selectedConfig.base : head }),
        ...(summary === undefined ? {} : { summary: summary as string }),
      };
    },
    async checks() {
      return { head: ciHead, checks };
    },
  };
  const run = () => step(config, adapter, pilot);
  const authorDone = () => {
    statuses.author = "passed";
  };
  const reviewerDone = () => {
    statuses.reviewer = "passed";
    summaries.reviewer ??= JSON.stringify({
      run: config.run,
      role: "reviewer",
      head,
      verdict: "PASS",
      findings: [],
      g0: "No simpler change.",
    });
  };
  const publish = () =>
    writeFile(
      resolve(stateDirectory, "publication.json"),
      JSON.stringify({ head, url: "https://github.com/owner/repo/pull/320" }),
    );
  return {
    config,
    adapter,
    run,
    launches,
    observations,
    launchPrompts,
    pilot,
    staged,
    commits,
    resets,
    cleans,
    authorDone,
    reviewerDone,
    publish,
    setHead: (value: string) => {
      currentHead = value;
    },
    setChanged: (value: string) => {
      changed = value;
    },
    setUntracked: (value: string) => {
      untracked = value;
    },
    setCached: (value: string) => {
      cached = value;
    },
    setCi: (value: Check[], exactHead = head) => {
      checks = value;
      ciHead = exactHead;
    },
    unavailable: () => {
      unavailable = true;
    },
    dirtyReview: () => {
      reviewerDirty = true;
    },
    sameIdentity: () => {
      sameIdentity = true;
    },
    statuses,
    retry: (status: Terminal["status"], summary?: unknown) => {
      retryStatus = status;
      retrySummary = summary;
    },
    summarize: (role: Role, value: unknown) => {
      summaries[role] = value;
    },
  };
}

it.each(["probe", "launch"])(
  "uses one reviewer fallback only for %s model refusal, retaining it on resume",
  async (refusal) => {
    const f = await fixture();
    f.config.routing = SELF_ROUTING;
    f.config.author = { ...SELF_ROUTING.author, prompt: "author" };
    f.config.reviewer = { ...SELF_ROUTING.reviewer, prompt: "reviewer" };
    const launch = f.adapter.launch;
    const observe = f.adapter.observe;
    const models: string[] = [];
    f.adapter.launch = async (role, config, prompt) => {
      models.push(config[role].model);
      if (role === "reviewer" && config.reviewer.model === "claude-opus-5" && refusal === "probe")
        throw new QueueBlocked("provider-model-refused");
      return launch(role, config, prompt);
    };
    f.adapter.observe = async (role, config, attempt) => {
      if (role === "reviewer") {
        if (config.reviewer.model === "claude-opus-5")
          return { id: attempt.id, status: "dead", modelRefused: true };
        expect(config.reviewer.model).toBe("gpt-5.6-sol");
        return { id: attempt.id, status: "running" };
      }
      return observe(role, config, attempt);
    };
    f.authorDone();
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(models).toEqual(["gpt-6-astra", "claude-opus-5", "gpt-5.6-sol"]);
    const attempt = JSON.parse(
      await readFile(resolve(f.config.stateDirectory, "reviewer-attempt.json"), "utf8"),
    );
    expect(attempt).toMatchObject({
      routing: { row: "self" },
      placement: { model: "gpt-5.6-sol", effort: "high" },
      models: { author: "gpt-6-astra", reviewer: "gpt-5.6-sol" },
    });
    expect(attempt.retries).toBeUndefined();
  },
);

it.each(["verdict", "malformed", "outage", "death"])(
  "does not change reviewer model after %s",
  async (failure) => {
    const f = await fixture();
    f.config.reviewer = { ...SELF_ROUTING.reviewer, prompt: "reviewer" };
    const launch = f.adapter.launch;
    const observe = f.adapter.observe;
    const models: string[] = [];
    f.adapter.launch = async (role, config, prompt) => {
      if (role === "reviewer") models.push(config.reviewer.model);
      return launch(role, config, prompt);
    };
    f.adapter.observe = async (role, config, attempt) => {
      if (role !== "reviewer") return observe(role, config, attempt);
      if (models.length > 1) return { id: attempt.id, status: "running" };
      if (failure === "verdict")
        return {
          id: attempt.id,
          status: "failed",
          head,
          summary: JSON.stringify({
            run: config.run,
            role,
            head,
            verdict: "FAIL",
            findings: [
              { file: "scripts/repair.mjs", line: 1, severity: "blocking", text: "Fix behavior" },
            ],
            g0: "Simplify",
          }),
        };
      if (failure === "malformed") return { id: attempt.id, status: "malformed", head };
      return {
        id: attempt.id,
        status: "dead",
        ...(failure === "outage" ? { providerFailure: true } : {}),
      };
    };
    f.authorDone();
    if (failure === "verdict") await expect(f.run()).rejects.toThrow("reviewer-failed");
    else await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(models).toEqual(
      failure === "verdict" ? ["claude-opus-5"] : ["claude-opus-5", "claude-opus-5"],
    );
  },
);

it("stops when the fallback is also refused and does not fall back for arbitrary launch errors", async () => {
  for (const reason of [
    "provider-model-refused",
    "provider-unavailable",
    "launch-identity-timeout-reconcile",
  ]) {
    const f = await fixture();
    f.config.reviewer = { ...SELF_ROUTING.reviewer, prompt: "reviewer" };
    const launch = f.adapter.launch;
    const models: string[] = [];
    f.adapter.launch = async (role, config, prompt) => {
      if (role === "reviewer") {
        models.push(config.reviewer.model);
        throw new QueueBlocked(reason);
      }
      return launch(role, config, prompt);
    };
    f.authorDone();
    await expect(f.run()).rejects.toThrow(reason);
    expect(models).toEqual(
      reason === "provider-model-refused" ? ["claude-opus-5", "gpt-5.6-sol"] : ["claude-opus-5"],
    );
  }
});

it("recognizes a model refusal only before the worker has produced work", async () => {
  const f = await fixture();
  const rows = [
    { type: "thread.started", thread_id: "01a048fe-90c8-7cb3-8da5-938c1f5cb5f0" },
    { type: "turn.failed", error: { message: "Model claude-opus-5 is not supported" } },
  ];
  const parse = () =>
    parseTrace(
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      true,
      "reviewer",
      f.config,
    );
  expect(parse()).toMatchObject({ status: "dead", modelRefused: true });
  rows.splice(1, 0, { type: "item.started", thread_id: "unused" });
  expect(parse().modelRefused).toBeUndefined();
});

it("keeps models endpoint outages in the provider wait while returning explicit refusals immediately", async () => {
  const f = await fixture();
  expect(deadTrace("models endpoint unavailable: HTTP 503", f.config).modelRefused).toBeUndefined();
  expect(deadTrace("model provider unavailable: HTTP 503", f.config).modelRefused).toBeUndefined();
  let calls = 0;
  let now = 0;
  const waits: number[] = [];
  await expect(
    waitForProvider(
      f.config,
      async () => {
        calls++;
        if (calls === 1) throw new Error("provider models probe returned HTTP 503");
        throw new QueueBlocked("provider-model-refused", "claude-opus-5");
      },
      {
        now: () => now,
        pause: async (ms) => {
          waits.push(ms);
          now += ms;
        },
      },
      () => {},
    ),
  ).rejects.toMatchObject({ reason: "provider-model-refused" });
  expect(waits).toEqual([10_000]);
  expect(calls).toBe(2);
});

async function expectAuthorEvidence(config: Config, prompt: string) {
  const author = JSON.parse(
    await readFile(resolve(config.stateDirectory, "author-attempt.json"), "utf8"),
  );
  expect(prompt).toContain(`Selected author attempt ${author.id}`);
  expect(prompt).toContain(`exact author base: ${config.base}; exact candidate: ${head}`);
  expect(prompt).toContain(`Captured execution trace: ${JSON.stringify(author.trace)}`);
  for (const name of ["author-attempt", "author-terminal", "candidate"])
    expect(prompt).toContain(JSON.stringify(resolve(config.stateDirectory, `${name}.json`)));
  expect(prompt).toContain("Read the relevant recorded commands and outputs");
  expect(prompt).toContain("Distinguish actual executed results from author claims");
  expect(prompt).toContain("unrun checks and sandbox limitations");
  expect(prompt).toContain("author PASS never determines your verdict");
  expect(prompt).toContain("missing or inadequate test results remain findings");
  expect(prompt).toContain("Leave the records and review worktree unchanged");
}

function fakeProvider(f: Awaited<ReturnType<typeof fixture>>, responses: (string | undefined)[]) {
  let now = 0;
  const polls: { at: number; launches: number }[] = [];
  const statuses: object[] = [];
  f.adapter.waitForProvider = (config) =>
    waitForProvider(
      config,
      async () => {
        polls.push({ at: now, launches: f.launches.length });
        const error = responses.shift();
        if (error) throw new Error(error);
      },
      {
        now: () => now,
        pause: async (ms) => {
          now += ms;
        },
      },
      (status) => {
        statuses.push(status);
      },
    );
  return { polls, statuses };
}

describe("supervised sequential pilot (fake attempts, never live acceptance)", () => {
  it.each([false, true])(
    "reviews an unchanged rejected candidate after author PASS (resume: %s)",
    async (resume) => {
      const f = await fixture();
      Object.assign(f.config, { base: head, mainBase: base });
      f.setHead(head);
      f.setChanged("");
      const git = f.adapter.git;
      f.adapter.git = async (tree, args) => {
        if (args[0] === "merge-base") return args[1]!;
        if (args[0] === "diff" && args.includes(base)) return "scripts/repair.mjs\0";
        return git(tree, args);
      };
      if (resume) await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
      f.authorDone();
      await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
      expect(f.commits).toEqual([]);
      expect(f.staged).toEqual([]);
      expect(
        JSON.parse(await readFile(resolve(f.config.stateDirectory, "candidate.json"), "utf8")),
      ).toEqual({ head, changed: ["scripts/repair.mjs"] });
      await expectAuthorEvidence(f.config, f.launchPrompts[1]!);
      expect(f.launchPrompts[1]).toContain(`Delivery main base: ${base}`);
      f.reviewerDone();
      await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication", head });
      await f.publish();
      await expect(f.run()).resolves.toMatchObject({ status: "ready", head });
      expect(f.launches).toEqual(["author", "reviewer"]);
    },
  );

  it.each(["failed-author", "failed-reviewer", "empty-implementation", "outside-footprint"])(
    "rejects unchanged corrective handoff: %s",
    async (failure) => {
      const f = await fixture();
      f.config.base = head;
      f.config.mainBase = base;
      f.setHead(head);
      f.setChanged("");
      const git = f.adapter.git;
      f.adapter.git = async (tree, args) => {
        if (args[0] === "merge-base") return args[1]!;
        if (args[0] === "diff" && args.includes(base))
          return failure === "empty-implementation"
            ? ""
            : failure === "outside-footprint"
              ? "unapproved/file\0"
              : "scripts/repair.mjs\0";
        return git(tree, args);
      };
      f.authorDone();
      if (failure === "failed-author") f.statuses.author = "failed";
      f.statuses.reviewer = "failed";
      f.summarize(
        "reviewer",
        JSON.stringify({
          run: f.config.run,
          role: "reviewer",
          head,
          verdict: "FAIL",
          findings: [
            {
              file: "scripts/repair.mjs",
              line: 1,
              severity: "blocking",
              text: "Execution evidence is still inadequate.",
            },
          ],
          g0: "Obtain the required evidence.",
        }),
      );
      await expect(f.run()).rejects.toThrow(
        failure === "failed-author"
          ? "author-failed"
          : failure === "failed-reviewer"
            ? "reviewer-failed"
            : "outside-footprint",
      );
      expect(f.commits).toEqual([]);
      expect(f.launches).toEqual(
        failure === "failed-reviewer" ? ["author", "reviewer"] : ["author"],
      );
    },
  );

  it("discovers persisted author execution records when initial review resumes after commit", async () => {
    const f = await fixture();
    await f.run();
    const author = JSON.parse(
      await readFile(resolve(f.config.stateDirectory, "author-attempt.json"), "utf8"),
    );
    const execution = JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "pnpm test -- ownership-mutant",
        exit_code: 1,
        aggregated_output: "fixture mutant red evidence, not an author assertion",
      },
    });
    await writeFile(author.trace, `${execution}\n`);
    f.authorDone();
    f.adapter.waitForProvider = async () => {
      throw new Error("pause before reviewer launch");
    };
    await expect(f.run()).rejects.toThrow("pause before reviewer launch");
    const before = await Promise.all(
      ["author-attempt", "author-terminal", "candidate"].map((name) =>
        readFile(resolve(f.config.stateDirectory, `${name}.json`), "utf8"),
      ),
    );
    f.adapter.waitForProvider = async () => {};
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer" });
    await expectAuthorEvidence(f.config, f.launchPrompts[1]!);
    expect(f.launchPrompts[1]).not.toContain(execution);
    expect(f.launchPrompts[0]).not.toContain("Selected author attempt");
    expect(await readFile(author.trace, "utf8")).toBe(`${execution}\n`);
    expect(
      await Promise.all(
        ["author-attempt", "author-terminal", "candidate"].map((name) =>
          readFile(resolve(f.config.stateDirectory, `${name}.json`), "utf8"),
        ),
      ),
    ).toEqual(before);
    expect(f.launches).toEqual(["author", "reviewer"]);
    expect(f.commits).toHaveLength(1);
  });

  it.each(["malformed", "dead"] as const)(
    "keeps selected repair evidence and delta scope discoverable across resume and %s reviewer retry",
    async (failure) => {
      const f = await fixture();
      const initialTrace = resolve(f.config.stateDirectory, "initial-author.jsonl");
      await writeFile(
        resolve(f.config.stateDirectory, "author-attempt.json"),
        JSON.stringify({ id: "initial-author", trace: initialTrace }),
      );
      f.config.stateDirectory = resolve(f.config.stateDirectory, "repair");
      await mkdir(f.config.stateDirectory);
      const handoff = {
        mainBase: pilotRevision,
        correctiveBase: base,
        failedReview: {
          findings: [
            {
              file: "scripts/repair.mjs",
              line: 1,
              severity: "blocking" as const,
              text: "show executed mutant evidence",
            },
          ],
        },
        predecessorCompleteSweep: "initial-reviewer",
        implementation: { attempts: 2, ceiling: 4 },
        sourcePaths: ["scripts/repair.mjs"],
        acceptanceCriteria: ["execute and restore the ownership/status mutants"],
      };
      const dispatch = () => reviewedRepairAdapter(f.adapter, f.pilot).dispatch(f.config, handoff);
      await expect(dispatch()).resolves.toMatchObject({ status: "observing-author" });
      f.authorDone();
      await expect(dispatch()).resolves.toMatchObject({ status: "observing-reviewer" });
      await expect(dispatch()).resolves.toMatchObject({ status: "observing-reviewer" });
      expect(f.launchPrompts[0]).toContain("Author PASS uses an empty summary");
      f.statuses.reviewer = failure;
      f.retry("running");
      await expect(dispatch()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
      for (const prompt of f.launchPrompts.slice(1)) {
        await expectAuthorEvidence(f.config, prompt);
        expect(prompt).not.toContain(JSON.stringify(initialTrace));
        expect(prompt).toContain("DELTA review inheriting complete predecessor initial-reviewer");
        expect(prompt).toContain(
          `Delivery main base: ${pilotRevision}; corrective author base: ${base}; implementation candidate 2 of 4`,
        );
        expect(prompt).toContain(JSON.stringify(handoff.failedReview.findings));
      }
      f.retry(
        "passed",
        JSON.stringify({
          run: f.config.run,
          role: "reviewer",
          head,
          verdict: "PASS",
          findings: [],
          g0: "No simpler change.",
        }),
      );
      await expect(dispatch()).resolves.toMatchObject({
        status: "awaiting-publication",
        retries: 1,
      });
      expect(f.launches).toEqual(["author", "reviewer", "reviewer"]);
      expect(f.commits).toHaveLength(1);
    },
  );

  it("waits before gate corrections and replaces a provider-dead correction", async () => {
    const f = await fixture();
    const probe = fakeProvider(f, [undefined, "offline", undefined]);
    f.statuses.author = "dead";
    f.summarize("author", "HTTP 502");
    f.retry("passed");
    const result = await correctGate(f.config, f.adapter, f.pilot, "typecheck", "type error");
    expect(result.status).toBe("observing-reviewer");
    expect(f.launches).toEqual(["author", "author", "reviewer"]);
    expect(f.launchPrompts[1]).toContain("type error");
    expect(probe.polls).toEqual([
      { at: 0, launches: 0 },
      { at: 0, launches: 1 },
      { at: 10_000, launches: 1 },
      { at: 10_000, launches: 2 },
    ]);
  });

  it("preserves the malformed-review retry prompt through a provider death after restart", async () => {
    const f = await fixture();
    fakeProvider(f, []);
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "malformed";
    f.retry("running");
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
    f.retry("dead", "stream disconnected");
    const observe = f.adapter.observe;
    f.adapter.observe = async (role, config, attempt) => {
      if (attempt.id === "reviewer-retry3")
        f.retry(
          "passed",
          JSON.stringify({
            run: config.run,
            role,
            head,
            verdict: "PASS",
            findings: [],
            g0: "No simpler change.",
          }),
        );
      return observe(role, config, attempt);
    };
    await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication", retries: 1 });
    expect(f.launches).toEqual(["author", "reviewer", "reviewer", "reviewer"]);
    expect(f.launchPrompts[2]).toContain("previous reviewer report could not be parsed");
    await expectAuthorEvidence(f.config, f.launchPrompts[2]!);
    expect(f.launchPrompts[3]).toBe(f.launchPrompts[2]);
  });
  it("waits out a provider-dead author and reaches publication and passing CI in the same attempt", async () => {
    const f = await fixture();
    const probe = fakeProvider(f, [undefined, "HTTP 503", "connection refused", undefined]);
    f.statuses.author = "dead";
    f.summarize("author", `stream disconnected before completion: ${providerBaseUrl}/responses`);
    f.retry("running");
    await expect(f.run()).resolves.toMatchObject({
      status: "observing-author",
      attempt: { id: "author-retry" },
    });
    expect(probe.polls).toEqual([
      { at: 0, launches: 0 },
      { at: 0, launches: 1 },
      { at: 10_000, launches: 1 },
      { at: 20_000, launches: 1 },
    ]);
    expect(probe.statuses).toEqual([
      {
        status: "waiting-provider",
        run: f.config.run,
        issue: f.config.issue,
        diagnostics: "HTTP 503",
      },
      {
        status: "waiting-provider",
        run: f.config.run,
        issue: f.config.issue,
        diagnostics: "connection refused",
      },
    ]);
    // Reload the attempt while its provider replacement is still running.
    expect(await f.run()).not.toHaveProperty("retries");
    f.retry("passed");
    await f.run();
    f.reviewerDone();
    expect(await f.run()).toMatchObject({ status: "awaiting-publication" });
    await f.publish();
    const landed = await f.run();
    expect(landed.status).toBe("ready");
    expect(landed).not.toHaveProperty("retries");
    expect(f.launches).toEqual(["author", "author", "reviewer"]);
    expect(f.launchPrompts[1]).toContain(f.launchPrompts[0]);
    expect(f.resets).toEqual([["reset", "--hard", base]]);
    expect(f.commits).toHaveLength(1);
    expect(probe.polls.at(-1)?.launches).toBe(2); // reviewer was probed too
  });

  it("stops a probe that never answers with provider-unavailable and posts a host note without parking", async () => {
    const f = await fixture();
    f.config.providerOutageCeilingMs = 25_000;
    const probe = fakeProvider(f, ["HTTP 503", "HTTP 502", "connection refused"]);
    let stopped: QueueBlocked | undefined;
    try {
      await f.run();
    } catch (error) {
      stopped = error as QueueBlocked;
    }
    expect(stopped).toMatchObject({
      reason: "provider-unavailable",
      diagnostics: "connection refused",
      retries: 0,
    });
    expect(probe.polls.map((poll) => poll.at)).toEqual([0, 10_000, 20_000]);
    expect(f.launches).toEqual([]);
    const comments: string[] = [];
    let parks = 0;
    await mkdir(resolve(f.config.stateDirectory, "..", f.config.run));
    const scope = await stopCycle(
      {
        run: f.config.run,
        stateRoot: resolve(f.config.stateDirectory, ".."),
        nativeLaunchCeiling: 4,
      } as LoopConfig,
      { selection: { cycle: 1, key: "ISS-129", number: 421, base }, initialHistory: [] },
      stopped!.reason,
      0,
      {
        currentMain: async () => base,
        issue: async () => ({ state: "OPEN", key: "ISS-129", labels: ["ready"], comments }),
        comment: async (_config, _number, body) => {
          comments.push(body);
        },
        removeReady: async () => {
          throw new Error("must remain ready");
        },
        close: async () => {
          throw new Error("must remain open");
        },
      },
      {
        park: () => {
          parks += 1;
          return "unpark";
        },
      } as unknown as RepositoryAdapter,
      stopped!.diagnostics,
    );
    expect(scope).toBe("run");
    expect(parks).toBe(0);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain("provider-unavailable");
    expect(comments[0]).toContain("connection refused");
    expect(comments[0]).not.toContain("To unpark");
    // The failed prelaunch probe did not reserve a launch intent.
    fakeProvider(f, []);
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author" });
  });

  it("preserves the one worker retry across provider deaths before and after it", async () => {
    const f = await fixture();
    const probe = fakeProvider(f, []);
    const observe = f.adapter.observe;
    const errors = ["HTTP 503", "worker process crashed", "stream disconnected"];
    f.retry("passed");
    f.adapter.observe = async (role, config, attempt) => {
      const message = role === "author" ? errors[f.launches.length - 1] : undefined;
      return message
        ? { ...deadTrace(message, config), id: attempt.id }
        : observe(role, config, attempt);
    };
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
    expect(f.launches).toEqual(["author", "author", "author", "author", "reviewer"]);
    expect(probe.polls).toHaveLength(5);
    expect(
      f.launchPrompts.slice(0, 4).every((prompt) => prompt.includes(f.launchPrompts[0]!)),
    ).toBe(true);
    for (const [index, id] of ["author", "author-retry", "author-retry3"].entries()) {
      const patch = resolve(f.config.stateDirectory, `author-retry-${id}.patch`);
      expect(await readFile(patch, "utf8")).not.toBe("");
      expect(f.launchPrompts[index + 1]).toContain(JSON.stringify(patch));
      expect(f.launchPrompts[index + 1]).toContain(
        JSON.stringify(resolve(f.config.stateDirectory, `author-${index + 1}.jsonl`)),
      );
    }
  });

  it("bounds a flapping provider only by native launches", async () => {
    const f = await fixture();
    fakeProvider(f, []);
    f.statuses.author = "dead";
    f.summarize("author", "HTTP 503");
    f.retry("dead", "HTTP 503");
    const launch = f.adapter.launch;
    f.adapter.launch = async (...args) => {
      if (f.launches.length === 3) throw new QueueBlocked("native-launch-ceiling-exhausted");
      return launch(...args);
    };
    await expect(f.run()).rejects.toMatchObject({
      reason: "native-launch-ceiling-exhausted",
      retries: 0,
    });
    expect(f.launches).toEqual(["author", "author", "author"]);
  });
  it("confines author scratch and states the reviewer's total serialized length cap", async () => {
    const f = await fixture();
    expect(workerPrompt(f.config, "author", base, "Improve the selected issue.")).toBe(
      `Improve the selected issue.\n\nPilot run one-trial; role author; exact base: ${base}.\n` +
        'Allowed author paths: ["scripts/repair.mjs"]. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n' +
        `Write all scratch, temporary fixtures, command captures and execution evidence under the existing attempt temp root ${JSON.stringify(resolve(f.config.stateDirectory, "author-temp"))}, outside the source tree. Reuse that path on correction and resume; do not create scratch directories in the source tree, even if ignored or empty. Product source and committed test fixtures still belong in the allowed author paths.\n` +
        `Explain substantive findings in progress messages before the final response; these remain in the captured trace. Final response must be ONLY JSON: {"run":"one-trial","role":"author","head":"${base}","verdict":"PASS","summary":""} (or verdict FAIL), with a short "summary" string of at most 2000 characters; use an empty string when there are no findings. Review every changed assertion independently. Before reporting, run \`pnpm typecheck\`, \`pnpm format:check\` and \`pnpm test\` in this worktree, and fix what fails.\n`,
    );
    expect(workerPrompt(f.config, "reviewer", head, "Improve the selected issue.")).toBe(
      `Improve the selected issue.\n\nPilot run one-trial; role reviewer; exact review head: ${head}.\n` +
        'Allowed author paths: ["scripts/repair.mjs"]. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n' +
        `Explain substantive findings in progress messages before the final response; these remain in the captured trace. Final response must be ONLY JSON: {"run":"one-trial","role":"reviewer","head":"${head}","verdict":"PASS","findings":[],"g0":"<is there a simpler way?>"} (or verdict FAIL). Return the JSON object alone; its serialized length (JSON.stringify) must be at most 2000 characters. Write findings and G0 to fit within that total. Each finding is exactly {"file":"<changed path>","line":1,"severity":"blocking"|"note","text":"<finding>"}. A blocking finding requires FAIL; notes never block. Review every changed assertion independently.\n`,
    );
  });
  it("leaves configured commit-bound gates to the executor while requiring honest source readiness", async () => {
    const f = await fixture();
    f.config.localGates = ["verify:static:scoped", "typecheck"];
    const prompt = workerPrompt(f.config, "author", base, "Improve the selected issue.");
    expect(prompt).toContain(
      "do not stage, commit, or change Git metadata; leave HEAD at the exact base",
    );
    expect(prompt).toContain("Before reporting, run applicable focused checks");
    expect(prompt).toContain("a remaining concrete source defect requires FAIL");
    expect(prompt).toContain(
      "The executor will commit the candidate and must run `pnpm verify:static:scoped` and `pnpm typecheck` before publication",
    );
    expect(prompt).toContain(
      "Checks that require a committed candidate or unavailable sandbox operations are not prerequisites for your source report",
    );
    expect(prompt).toContain(
      "describe their limitations and all observed failures honestly in progress messages and the final summary",
    );
    expect(prompt).toContain(
      "Do not claim an unrun or failed check passed, or change product source to evade a sandbox limitation",
    );
    expect(prompt).not.toContain("Before reporting, run `pnpm verify:static:scoped`");
    const { localGates: _gates, ...defaultConfig } = f.config;
    expect(workerPrompt(f.config, "reviewer", head, "Review independently.")).toBe(
      workerPrompt(defaultConfig, "reviewer", head, "Review independently."),
    );
  });
  it.each(["failed", undefined] as const)(
    "runs configured executor gates after committing and blocks publication for a %s gate result",
    async (gateResult) => {
      const f = await fixture();
      const events: string[] = [];
      f.config.localGates = ["verify:static:scoped", "typecheck"];
      const git = f.adapter.git;
      f.adapter.git = async (tree, args) => {
        const result = await git(tree, args);
        if (args[0] === "commit") events.push("executor-commit");
        return result;
      };
      f.authorDone();
      f.summarize(
        "author",
        "Focused checks passed; static gate requires the executor's committed candidate.",
      );
      f.reviewerDone();
      await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication" });
      expect(f.commits).toHaveLength(1);
      const config: DeliveryConfig = {
        controller: f.config.owner,
        run: f.config.run,
        issue: f.config.issue,
        repository: f.config.repository,
        controllerRoot: f.pilot,
        repositoryRoot: f.pilot,
        controllerRevision: pilotRevision,
        worktree: f.config.worktree,
        reviewWorktree: f.config.reviewWorktree,
        stateDirectory: f.config.stateDirectory,
        candidateHead: head,
        retries: 0,
        requiredChecks: f.config.requiredChecks,
        policy: { kind: "fixture" },
      };
      const unexpectedEffect = async () => {
        throw new Error("unexpected delivery effect before passing gates");
      };
      const repository: RepositoryAdapter = {
        selectCandidates: unexpectedEffect,
        issueContext: unexpectedEffect,
        branchName: unexpectedEffect,
        requiredChecks: unexpectedEffect,
        park: unexpectedEffect,
        afterMerge: unexpectedEffect,
        localGates: () => f.config.localGates!,
        pullRequest: () => ({
          sourceBranch: "codex/fixture",
          baseBranch: "main",
          title: "Fixture",
          body: "Fixture",
          draft: true,
        }),
        mergeMethod: () => ({ method: "squash" }),
      };
      const delivery: DeliveryAdapter = {
        publicationUrl: (_config, number) => `https://example.test/pull/${number}`,
        observeDraft: unexpectedEffect,
        applyDraft: unexpectedEffect,
        observePublication: unexpectedEffect,
        checks: unexpectedEffect,
        observeMerge: unexpectedEffect,
        merge: unexpectedEffect,
        observeCleanup: unexpectedEffect,
        cleanup: unexpectedEffect,
        async source() {
          return {
            head,
            reviewId: "reviewer",
            controller: config.controller,
            run: config.run,
            issue: config.issue,
            repository: config.repository,
            controllerRevision: config.controllerRevision,
            worktree: config.worktree,
            reviewWorktree: config.reviewWorktree,
            stateDirectory: config.stateDirectory,
            requiredChecks: config.requiredChecks,
          };
        },
        async verifyWorkspace() {
          return true;
        },
        async runGate(_config, gate, candidateHead) {
          expect(await f.adapter.git(f.config.worktree, ["rev-parse", "HEAD"])).toBe(head);
          expect(await f.adapter.git(f.config.worktree, ["status", "--porcelain"])).toBe("");
          expect(candidateHead).toBe(head);
          events.push(`gate:${gate}`);
          return gateResult as "failed";
        },
        async publish() {
          events.push("publish");
        },
      };
      await expect(
        deliveryStep(config, delivery, repositoryDeliveryPolicy(repository, "git")),
      ).rejects.toMatchObject({ reason: "gate-attribution-unknown:verify:static:scoped" });
      expect(events).toEqual(["executor-commit", "gate:verify:static:scoped"]);
      await expect(
        readFile(resolve(f.config.stateDirectory, "publication.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("drives author and independent exact-head review, hands off publication, and resumes without redispatch", async () => {
    const f = await fixture();
    expect((await f.run()).status).toBe("observing-author");
    // Each step reloads only durable files, modeling a fresh controller process.
    expect((await f.run()).status).toBe("observing-author");
    f.authorDone();
    expect((await f.run()).status).toBe("observing-reviewer");
    expect((await f.run()).status).toBe("observing-reviewer");
    f.reviewerDone();
    expect((await f.run()).status).toBe("awaiting-publication");
    await f.publish();
    expect((await f.run()).status).toBe("ready");
    expect((await f.run()).status).toBe("ready");
    expect(f.launches).toEqual(["author", "reviewer"]);
    expect(f.commits).toHaveLength(1);
    expect(f.staged).toEqual([["scripts/repair.mjs"]]);
    expect(
      JSON.parse(await readFile(resolve(f.config.stateDirectory, "ready.json"), "utf8")).checks,
    ).toHaveLength(3);
  });
  it("reserves unknown launch intent and never retries it", async () => {
    const f = await fixture();
    f.adapter.launch = async () => {
      f.launches.push("author");
      throw new Error("crash after spawn");
    };
    await expect(f.run()).rejects.toThrow("crash after spawn");
    await expect(f.run()).rejects.toThrow("author-launch-identity-unknown-reconcile");
    expect(f.launches).toEqual(["author"]);
  });
  it("relaunches one dead author with preserved patch and terminal context after clean-base discard", async () => {
    const f = await fixture();
    f.statuses.author = "dead";
    f.summarize("author", "upstream TLS handshake timed out");
    f.retry("running");

    await expect(f.run()).resolves.toMatchObject({
      status: "observing-author",
      attempt: { id: "author-retry", retries: 1 },
      retries: 1,
    });
    expect(
      JSON.parse(await readFile(resolve(f.config.stateDirectory, "author-attempt.json"), "utf8")),
    ).toMatchObject({ id: "author-retry", retries: 1 });
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author", retries: 1 });
    expect(f.launches).toEqual(["author", "author"]);

    f.retry("passed");
    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
    f.reviewerDone();
    await expect(f.run()).resolves.toMatchObject({
      status: "awaiting-publication",
      author: { id: "author-retry", retries: 1 },
      retries: 1,
    });
    expect(f.launches).toEqual(["author", "author", "reviewer"]);
    expect(f.launchPrompts[1]).toContain(f.launchPrompts[0]);
    await expectAuthorEvidence(f.config, f.launchPrompts[2]!);
    expect(f.launchPrompts[2]).not.toContain(
      JSON.stringify(resolve(f.config.stateDirectory, "author-1.jsonl")),
    );
    expect(f.resets).toEqual([["reset", "--hard", base]]);
    expect(f.cleans).toEqual([["clean", "-fd"]]);
    expect(
      JSON.parse(
        await readFile(resolve(f.config.stateDirectory, "author-retry-discard.json"), "utf8"),
      ),
    ).toMatchObject({
      base,
      discarded: " M source",
      patch: resolve(f.config.stateDirectory, "author-retry-author.patch"),
      attempt: { id: "author" },
      terminal: { status: "dead" },
    });
    expect(f.launchPrompts[1]).toContain(
      JSON.stringify(resolve(f.config.stateDirectory, "author-retry-author.patch")),
    );
    expect(f.launchPrompts[1]).toContain(
      JSON.stringify(resolve(f.config.stateDirectory, "author-1.jsonl")),
    );
    expect(
      await readFile(resolve(f.config.stateDirectory, "author-retry-author.patch"), "utf8"),
    ).not.toBe("");
  });
  it("stops after two dead launches with the last trace diagnostic", async () => {
    const f = await fixture();
    f.statuses.author = "dead";
    f.summarize("author", "first provider failure");
    f.retry("dead", "second provider failure");

    await expect(f.run()).rejects.toMatchObject({
      message: "launcher-failed",
      diagnostics: "second provider failure",
      retries: 1,
    });
    expect(f.launches).toEqual(["author", "author"]);
  });
  it("keeps the captured patch when replay resumes after the clean-base reset", async () => {
    const f = await fixture();
    await f.run();
    const path = resolve(f.config.stateDirectory, "author-retry-author.patch");
    const patch = "preserved tracked patch from before reset\n";
    await writeFile(path, patch);
    const git = f.adapter.git;
    f.adapter.git = async (tree, args) => (args.includes("--binary") ? "" : git(tree, args));
    f.statuses.author = "dead";
    f.retry("running");
    await expect(f.run()).resolves.toMatchObject({ status: "observing-author", retries: 1 });
    expect(await readFile(path, "utf8")).toBe(patch);
    expect(f.launchPrompts[1]).toContain(JSON.stringify(path));
  });
  it("relaunches once when restarting over a recorded dead launch", async () => {
    const f = await fixture();
    expect((await f.run()).status).toBe("observing-author");
    f.statuses.author = "dead";
    f.summarize("author", "recorded provider failure");
    f.retry("passed");

    await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
    expect(f.launches).toEqual(["author", "author", "reviewer"]);
    expect(f.launchPrompts[1]).toContain(f.launchPrompts[0]);
  });
  it("uses the same prompt when a recorded reviewer launch dies", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "dead";
    f.summarize("reviewer", "review worker crashed");
    f.retry(
      "passed",
      JSON.stringify({
        run: f.config.run,
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [],
        g0: "No simpler change.",
      }),
    );

    await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication", retries: 1 });
    expect(f.launches).toEqual(["author", "reviewer", "reviewer"]);
    expect(f.launchPrompts[2]).toBe(f.launchPrompts[1]);
    await expectAuthorEvidence(f.config, f.launchPrompts[2]!);
  });
  it("refuses another controller/configuration and changed prompts before dispatch", async () => {
    const f = await fixture();
    await f.run();
    f.config.owner = "other-controller";
    await expect(f.run()).rejects.toThrow("conflicting-run-configuration");
    f.config.owner = "controller";
    f.config.author.prompt = "Different instruction";
    await expect(f.run()).rejects.toThrow("conflicting-run-configuration");
    expect(f.launches).toEqual(["author"]);
  });
  it("refuses an unavailable adapter before any dispatch", async () => {
    const f = await fixture();
    f.unavailable();
    await expect(f.run()).rejects.toThrow("host-adapter-unavailable");
    expect(f.launches).toEqual([]);
  });
  it("refuses a state directory inside a checkout", async () => {
    const f = await fixture();
    f.config.stateDirectory = f.config.worktree;
    await expect(f.run()).rejects.toThrow("state-inside-checkout");
    expect(f.launches).toEqual([]);
  });
  it("refuses a state directory containing the author writable root", async () => {
    const f = await fixture();
    f.config.stateDirectory = resolve(f.config.worktree, "..");
    await expect(f.run()).rejects.toThrow("state-inside-checkout");
    expect(f.launches).toEqual([]);
  });
  it.each(["unapproved/file\0", "scripts/repair.mjs/extra\0", ""])(
    "blocks outside or empty footprint %j",
    async (changed) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      f.setChanged(changed);
      await expect(f.run()).rejects.toThrow(
        changed ? "outside-footprint" : "missing-candidate-commit",
      );
      expect(f.launches).toEqual(["author"]);
    },
  );
  it("rejects changed initial base without launching", async () => {
    const f = await fixture();
    f.setHead(head);
    await expect(f.run()).rejects.toThrow("changed-base");
    expect(f.launches).toEqual([]);
  });
  it("refuses an author-created commit before controller staging or review", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.setHead(head);
    await expect(f.run()).rejects.toThrow("author-head-moved");
    expect(f.staged).toEqual([]);
    expect(f.commits).toEqual([]);
    expect(f.launches).toEqual(["author"]);
  });
  it("rejects author-as-reviewer and changed author head", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.sameIdentity();
    await expect(f.run()).rejects.toThrow("author-is-reviewer");
    const other = await fixture();
    await other.run();
    other.authorDone();
    await other.run();
    other.setHead("d".repeat(40));
    await expect(other.run()).rejects.toThrow("candidate-head-moved");
  });
  it("rejects malformed and wrong-head terminal evidence", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.adapter.observe = async () => ({ status: "passed", id: "different", head });
    await expect(f.run()).rejects.toThrow("malformed-terminal");
    f.adapter.observe = async () => ({ status: "passed", id: "author", head });
    await expect(f.run()).rejects.toThrow("author-wrong-head");
  });
  it.each(["pilot-in-author", "review-in-author", "author-in-review"])(
    "refuses overlapping checkout layout %s before dispatch",
    async (layout) => {
      const f = await fixture();
      if (layout === "pilot-in-author") f.config.worktree = resolve(f.pilot, "..");
      if (layout === "review-in-author") {
        f.config.reviewWorktree = resolve(f.config.worktree, "nested-review");
        await mkdir(f.config.reviewWorktree);
      }
      if (layout === "author-in-review") {
        f.config.worktree = resolve(f.config.reviewWorktree, "nested-author");
        await mkdir(f.config.worktree);
      }
      // Keep state outside the common parent to exercise overlap specifically.
      const external = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-state-")));
      cleanup.push(external);
      f.config.stateDirectory = external;
      await expect(f.run()).rejects.toThrow("worktree-isolation");
      expect(f.launches).toEqual([]);
    },
  );
  it("refuses the obsolete author Git write root even when state is under it", async () => {
    const f = await fixture();
    Object.assign(f.config.adapter, { authorGitDirectory: resolve(f.config.stateDirectory, "..") });
    await expect(f.run()).rejects.toThrow("unsupported-adapter-configuration");
    expect(f.launches).toEqual([]);
  });
  it.each(["untracked", "deleted", "cached"])(
    "checks %s files before staging or committing",
    async (kind) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      if (kind === "untracked") f.setUntracked("outside/new-file\0");
      if (kind === "deleted") f.setChanged("outside/deleted-file\0");
      if (kind === "cached") f.setCached("outside/staged-file\0");
      await expect(f.run()).rejects.toThrow("outside-footprint");
      expect(f.staged).toEqual([]);
      expect(f.commits).toEqual([]);
      expect(f.launches).toEqual(["author"]);
    },
  );
  it("stages the exact in-scope deletion and untracked addition before one controller commit", async () => {
    const f = await fixture();
    f.config.allowedPaths = ["deleted.ts", "added.ts"];
    await f.run();
    f.authorDone();
    f.setChanged("deleted.ts\0");
    f.setUntracked("added.ts\0");
    expect((await f.run()).status).toBe("observing-reviewer");
    expect(f.staged).toEqual([["deleted.ts", "added.ts"]]);
    expect(f.commits).toHaveLength(1);
  });
  it("blocks a commit whose durable result is unknown without a second commit or review", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    const git = f.adapter.git;
    f.adapter.git = async (tree, args) => {
      const result = await git(tree, args);
      if (args[0] === "commit") throw new Error("crash after successful commit");
      return result;
    };
    await expect(f.run()).rejects.toThrow("crash after successful commit");
    await expect(f.run()).rejects.toThrow("commit-result-unknown-reconcile");
    expect(f.commits).toHaveLength(1);
    expect(f.launches).toEqual(["author"]);
  });
  it("rejects review FAIL and a reviewer-modified worktree", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "failed";
    f.summarize(
      "reviewer",
      JSON.stringify({
        run: f.config.run,
        role: "reviewer",
        head,
        verdict: "FAIL",
        findings: [{ file: "scripts/repair.mjs", line: 1, severity: "blocking", text: "finding" }],
        g0: "No simpler change.",
      }),
    );
    await expect(f.run()).rejects.toMatchObject({
      message: "reviewer-failed",
      diagnostics: expect.stringContaining('"verdict":"FAIL"'),
    });
    const other = await fixture();
    await other.run();
    other.authorDone();
    await other.run();
    other.reviewerDone();
    other.dirtyReview();
    await expect(other.run()).rejects.toThrow("reviewer-modified-worktree");
  });
  it.each([undefined, 2276, 2302])(
    "retries a malformed reviewer with its length diagnostic (%s) and resumes",
    async (length) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      await f.run();
      f.statuses.reviewer = "malformed";
      const diagnostic =
        length === undefined
          ? undefined
          : `Reviewer verdict serialized length is ${length} characters; maximum is 2000. Shorten findings and G0 to fit.`;
      if (diagnostic) f.summarize("reviewer", diagnostic);
      f.retry("running");
      await expect(f.run()).resolves.toMatchObject({ status: "observing-reviewer", retries: 1 });
      expect(
        JSON.parse(
          await readFile(resolve(f.config.stateDirectory, "reviewer-terminal.json"), "utf8"),
        ),
      ).toMatchObject({ status: "malformed", id: "reviewer", head });
      expect(f.launchPrompts.at(-1)).toContain("malformed-worker-verdict");
      if (diagnostic) {
        expect(f.launchPrompts.at(-1)).toContain(diagnostic);
        expect(
          JSON.parse(
            await readFile(resolve(f.config.stateDirectory, "reviewer-terminal.json"), "utf8"),
          ).summary,
        ).toBe(diagnostic);
        expect(
          JSON.parse(
            await readFile(resolve(f.config.stateDirectory, "reviewer-attempt.json"), "utf8"),
          ).retryContext,
        ).toContain(diagnostic);
      }
      expect(
        JSON.parse(
          await readFile(resolve(f.config.stateDirectory, "reviewer-attempt.json"), "utf8"),
        ),
      ).toMatchObject({ id: "reviewer-retry", retries: 1 });
      f.retry(
        "passed",
        JSON.stringify({
          run: f.config.run,
          role: "reviewer",
          head,
          verdict: "PASS",
          findings: [],
          g0: "No simpler change.",
        }),
      );
      await expect(f.run()).resolves.toMatchObject({
        status: "awaiting-publication",
        reviewer: { id: "reviewer-retry" },
        retries: 1,
      });
      await expect(f.run()).resolves.toMatchObject({
        status: "awaiting-publication",
        reviewer: { id: "reviewer-retry", retries: 1 },
        retries: 1,
      });
      expect(f.launches).toEqual(["author", "reviewer", "reviewer"]);
      expect(
        JSON.parse(
          await readFile(resolve(f.config.stateDirectory, "reviewer-attempt.json"), "utf8"),
        ),
      ).toMatchObject({ id: "reviewer-retry", retries: 1 });
    },
  );
  it("stops with a typed reason when the reviewer retry is malformed", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "malformed";
    f.retry("malformed");
    await expect(f.run()).rejects.toThrow("reviewer-malformed");
    await expect(f.run()).rejects.toThrow("reviewer-malformed");
    expect(f.launches).toEqual(["author", "reviewer", "reviewer"]);
  });
  it("retries a semantically invalid reviewer report", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.reviewerDone();
    f.summarize(
      "reviewer",
      JSON.stringify({
        run: f.config.run,
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [{ file: "scripts/repair.mjs", line: 1, severity: "blocking", text: "blocking" }],
        g0: "No simpler change.",
      }),
    );
    f.retry(
      "passed",
      JSON.stringify({
        run: f.config.run,
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [],
        g0: "No simpler change.",
      }),
    );

    await expect(f.run()).resolves.toMatchObject({ status: "awaiting-publication", retries: 1 });
    expect(f.launches).toEqual(["author", "reviewer", "reviewer"]);
  });
  it("keeps failure reasons authoritative while surfacing bounded advisory diagnostics", async () => {
    const failed = await fixture();
    await failed.run();
    failed.summarize("author", `PASS at the correct head:${"x".repeat(2100)}`);
    failed.statuses.author = "failed";
    await expect(failed.run()).rejects.toMatchObject({
      message: "author-failed",
      diagnostics: `PASS at the correct head:${"x".repeat(1975)}`,
    });

    const passed = await fixture();
    await passed.run();
    passed.summarize("author", "author finding");
    passed.authorDone();
    await passed.run();
    passed.summarize(
      "reviewer",
      JSON.stringify({
        run: passed.config.run,
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [],
        g0: "No simpler change.",
      }),
    );
    passed.reviewerDone();
    expect(await passed.run()).toMatchObject({
      status: "awaiting-publication",
      diagnostics: {
        author: "author finding",
        reviewer: expect.stringContaining('"verdict":"PASS"'),
      },
    });
  });
  it.each(["empty", "missing", "duplicate", "failed", "pending", "wrong-head"])(
    "fails closed or waits for %s CI",
    async (mode) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      await f.run();
      f.reviewerDone();
      await f.run();
      await f.publish();
      const checks = f.config.requiredChecks.map((name) => ({
        name,
        bucket: "pass",
        link: `https://ci.example/${name}`,
      }));
      if (mode === "empty") checks.splice(0);
      if (mode === "missing") checks.pop();
      if (mode === "duplicate") checks.push(checks[0]!);
      if (mode === "failed") checks[0]!.bucket = "fail";
      if (mode === "pending") checks[0]!.bucket = "pending";
      f.setCi(checks, mode === "wrong-head" ? base : head);
      if (mode === "pending") expect((await f.run()).status).toBe("observing-ci");
      else await expect(f.run()).rejects.toThrow();
      expect(f.launches).toEqual(["author", "reviewer"]);
    },
    30_000,
  );
});

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  queueStep,
  queueUsage,
  type QueueConfig,
  type QueueAdapter,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import { isItemStopReason } from "../../scripts/dogfood/supervision.js";
import {
  deliveryStep,
  DeliveryBlocked,
  hostedFailurePrompt,
  hostedFailureEvidence,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DeliveryPlan,
  type PublicationObservation,
  type PublicationEvidence,
  type CheckEvidence,
} from "../../scripts/dogfood/delivery.mjs";

const head = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const roots: string[] = [];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function fixture(candidate = head) {
  const head = candidate;
  const parent = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-fixture-")));
  roots.push(parent);
  const paths = await Promise.all(
    ["controller-", "author-", "reviewer-", "state-"].map((name) => mkdtemp(resolve(parent, name))),
  );
  const config: DeliveryConfig = {
    controller: "fixture-controller",
    run: "delivery-fixture",
    issue: "fixture-issue",
    repository: "fixture/repository",
    controllerRoot: paths[0]!,
    repositoryRoot: paths[0]!,
    controllerRevision: "c".repeat(40),
    worktree: paths[1]!,
    reviewWorktree: paths[2]!,
    stateDirectory: paths[3]!,
    candidateHead: head,
    retries: 0,
    requiredChecks: ["linux", "windows", "macos"],
    policy: { kind: "fixture" },
  };
  const plan: DeliveryPlan = {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [
      {
        key: "EPIC-FIXTURE",
        issue: 2,
        title: "epic",
        body: "epic body",
        attributes: { milestone: null },
      },
      {
        key: "ISS-074",
        issue: 332,
        title: "issue",
        body: "issue body",
        attributes: { milestone: "M2" },
      },
    ],
    publication: {
      sourceBranch: "codex/fixture",
      baseBranch: "main",
      title: "fixture PR",
      body: "fixture body",
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: { worktrees: [paths[1]!, paths[2]!], branch: "codex/fixture" },
  };
  const calls: string[] = [];
  const publication: PublicationEvidence = {
    number: 44,
    url: "https://example.test/pull/44",
    head,
    repository: config.repository,
    sourceBranch: plan.publication.sourceBranch,
    baseBranch: plan.publication.baseBranch,
    title: plan.publication.title,
    body: plan.publication.body,
    planDigest: digest(plan),
  };
  const state = {
    workspace: true,
    drafts: new Set<number>(),
    publication: undefined as PublicationEvidence | undefined,
    merged: false,
    cleanup: "present" as "present" | "partial" | "complete",
    publicationOutcome: "confirmed" as "confirmed" | "unknown",
    checks: "pass" as
      "pass" | "empty" | "pending" | "duplicate" | "missing" | "skipping" | "fail" | "cancel",
  };
  const adapter: DeliveryAdapter = {
    publicationUrl(_config, number) {
      return `https://example.test/pull/${number}`;
    },
    async source() {
      calls.push("source");
      return {
        head,
        reviewId: "review-fixture",
        controller: "fixture-controller",
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controllerRevision: config.controllerRevision,
        worktree: config.worktree,
        reviewWorktree: config.reviewWorktree,
        stateDirectory: config.stateDirectory,
        requiredChecks: [...config.requiredChecks],
      };
    },
    async verifyWorkspace() {
      calls.push("verify");
      return state.workspace;
    },
    async runGate(_config, name) {
      calls.push(`gate:${name}`);
      return "passed";
    },
    async observeDraft(_config, draft) {
      calls.push(`observe-draft:${draft.issue}`);
      return state.drafts.has(draft.issue)
        ? { state: "confirmed", value: { issue: draft.issue } }
        : { state: "needs-mutation" };
    },
    async applyDraft(_config, draft) {
      calls.push(`draft:${draft.issue}`);
      state.drafts.add(draft.issue);
    },
    async observePublication(): Promise<PublicationObservation> {
      calls.push("observe-publication");
      if (state.publicationOutcome === "unknown") return { state: "unknown" };
      return state.publication
        ? { state: "confirmed", value: state.publication }
        : { state: "needs-mutation", target: "fixture-absent" };
    },
    async publish() {
      calls.push("publish");
      state.publication = publication;
    },
    async checks() {
      calls.push("checks");
      if (state.checks === "empty") return { head, checks: [], workflowPending: true };
      const values = config.requiredChecks.map((name) => ({
        name,
        bucket: (["pending", "fail", "cancel"].includes(state.checks) && name === "macos"
          ? state.checks
          : "pass") as "pass" | "pending" | "fail" | "cancel",
        link: `https://github.com/fixture/repository/actions/runs/123/job/${name}`,
      }));
      if (state.checks === "duplicate") values.push({ ...values[0]! });
      if (state.checks === "missing") values.pop();
      if (state.checks === "skipping") values[0]!.bucket = "skipping" as never;
      return { head, checks: values };
    },
    async failedCheckLog() {
      throw new Error("unexpected failed check log");
    },
    async observeMerge() {
      calls.push("observe-merge");
      return state.merged
        ? {
            state: "confirmed" as const,
            value: { number: publication.number, head, mergeCommit },
          }
        : { state: "needs-mutation" as const };
    },
    async merge() {
      calls.push("merge");
      state.merged = true;
    },
    async observeCleanup() {
      calls.push("observe-cleanup");
      if (state.cleanup === "partial") return { state: "unknown" };
      return state.cleanup === "complete"
        ? {
            state: "confirmed" as const,
            value: { worktrees: [...plan.cleanup.worktrees], branch: plan.cleanup.branch },
          }
        : { state: "needs-mutation" as const };
    },
    async cleanup() {
      calls.push("cleanup");
      state.cleanup = "complete";
    },
  };
  const policy = {
    async plan() {
      calls.push("policy");
      return plan;
    },
  };
  return { config, plan, publication, adapter, policy, calls, state };
}

async function writeState(config: DeliveryConfig, name: string, value: unknown) {
  await writeFile(resolve(config.stateDirectory, `${name}.json`), `${JSON.stringify(value)}\n`);
}

// Synthetic Actions payloads for the ordinary command/consumer boundary.
function syntheticRun(publication: PublicationEvidence, status = "in_progress") {
  const repo = { id: 10, full_name: publication.repository };
  return {
    id: 123,
    workflow_id: 7,
    run_number: 1,
    run_attempt: 1,
    path: ".github/workflows/bootstrap.yml",
    event: "pull_request",
    head_sha: publication.head,
    head_branch: publication.sourceBranch,
    repository: repo,
    head_repository: repo,
    status,
    pull_requests: [
      {
        number: publication.number,
        url: `https://api.github.com/repos/${publication.repository}/pulls/${publication.number}`,
        head: { ref: publication.sourceBranch, sha: publication.head, repo: { id: 10 } },
        base: { ref: publication.baseBranch, repo: { id: 10 } },
      },
    ],
  };
}

async function aggregateFixture(
  pause: (ms: number) => Promise<void> = async () => {},
  required = ["PR Required"],
) {
  const f = await fixture();
  f.config.requiredChecks = required;
  f.publication.url = `https://github.com/${f.config.repository}/pull/${f.publication.number}`;
  f.adapter.publicationUrl = (_config, number) =>
    `https://github.com/${f.config.repository}/pull/${number}`;
  const evidence = {
    checks: [] as CheckEvidence[],
    runs: [syntheticRun(f.publication)],
    driftAfterWorkflow: false,
    log: "PR Required failed",
    logError: false,
    afterLog: () => {},
  };
  const requests: string[][] = [];
  let publicationHead = head;
  const provider = githubDeliveryAdapter(
    {
      async gh(_config, args) {
        requests.push(args);
        expect(args).toEqual([
          "run",
          "view",
          "123",
          "--attempt",
          String(evidence.runs[0]!.run_attempt),
          "--log-failed",
        ]);
        if (evidence.logError) throw new Error("log unavailable");
        evidence.afterLog();
        return evidence.log;
      },
      async ghJson(_config, args) {
        requests.push(args);
        if (args[0] === "api") {
          if (args[1]!.includes("/jobs?"))
            return [
              {
                jobs: evidence.checks.map((check, index) => ({
                  id: Number(check.link.split("/").at(-1)),
                  run_id: 123,
                  run_attempt: check.actions?.attempt ?? 1,
                  head_sha: head,
                  name: check.name,
                  html_url: check.link,
                  status: check.bucket === "pending" ? "in_progress" : "completed",
                  conclusion: {
                    pass: "success",
                    pending: null,
                    fail: "failure",
                    cancel: "cancelled",
                    skipping: "skipped",
                  }[check.bucket],
                })),
              },
            ];
          if (args[1]!.endsWith("/123")) return evidence.runs.find((run) => run.id === 123);
          expect(args).toEqual([
            "api",
            `repos/${f.config.repository}/actions/runs?head_sha=${head}&event=pull_request&per_page=100`,
            "--paginate",
            "--slurp",
          ]);
          if (evidence.driftAfterWorkflow) publicationHead = "f".repeat(40);
          return [{ workflow_runs: evidence.runs }];
        }
        return {
          number: f.publication.number,
          url: f.publication.url,
          headRefOid: publicationHead,
          headRefName: f.publication.sourceBranch,
          baseRefName: f.publication.baseBranch,
          state: "OPEN",
          title: f.publication.title,
          body: f.publication.body,
        };
      },
    },
    "git",
    pause,
  );
  f.adapter.checks = provider.checks;
  f.adapter.failedCheckLog = provider.failedCheckLog!.bind(provider);
  const check = (name: string, bucket: CheckEvidence["bucket"], job = 456): CheckEvidence => ({
    name,
    bucket,
    link: `https://github.com/${f.config.repository}/actions/runs/123/job/${job}`,
  });
  return { ...f, evidence, check, requests, provider };
}

// ISS-185 captured facts: iss183-ci-attribution-2132.json (21:30:58.920Z),
// iss183-pr566-checks-2132.json and attempt-3/source/hosted-failure.log.
// PR/run/job/SHA/branch identities below are retained observations, not CI liveness.
// Repo/workflow IDs, run_numbers and payload scaffolding are SYNTHETIC;
// all green/failure transitions and rerun variants in these tests are SYNTHETIC.
async function incidentFixture() {
  const f = await fixture("ab2fdadac4404814ccf0090b7b144ef80000ac3b");
  f.config.repository = "todd-skelton/orchestration-platform";
  f.config.requiredChecks = ["ubuntu", "windows", "macos"].map((os) => `Node 24 / ${os}-latest`);
  f.plan.publication.sourceBranch = "codex/iss-183-attempt-3";
  f.plan.cleanup.branch = f.plan.publication.sourceBranch;
  Object.assign(f.publication, {
    number: 566,
    repository: f.config.repository,
    url: "https://github.com/todd-skelton/orchestration-platform/pull/566",
    sourceBranch: f.plan.publication.sourceBranch,
    planDigest: digest(f.plan),
  });
  f.adapter.publicationUrl = (config, number) =>
    `https://github.com/${config.repository}/pull/${number}`;
  const current = { ...syntheticRun(f.publication), id: 35276352971, run_number: 102 };
  const old = {
    ...syntheticRun(
      {
        ...f.publication,
        number: 565,
        sourceBranch: "codex/iss-183-attempt-2",
      },
      "completed",
    ),
    id: 35270001390,
    run_number: 101,
  };
  const jobsFor = (run: typeof current, buckets: CheckEvidence["bucket"][], ids: number[]) =>
    f.config.requiredChecks.map((name, index) => ({
      id: ids[index]!,
      run_id: run.id,
      run_attempt: run.run_attempt,
      head_sha: run.head_sha,
      name,
      html_url: `https://github.com/${f.config.repository}/actions/runs/${run.id}/job/${ids[index]}`,
      status: buckets[index] === "pending" ? "in_progress" : "completed",
      conclusion: {
        pass: "success",
        pending: null,
        fail: "failure",
        cancel: "cancelled",
        skipping: "skipped",
      }[buckets[index]!],
    }));
  const oldJobs = jobsFor(old, ["pass", "fail", "pass"], [9001, 105366636997, 9003]);
  const currentJobs = jobsFor(
    current,
    ["pass", "pending", "pending"],
    [105387830071, 105387830221, 105387829846],
  );
  const state = {
    runs: [old, current],
    jobs: new Map([
      [old.id, oldJobs],
      [current.id, currentJobs],
    ]),
    projection: oldJobs.map((job) => ({
      name: job.name,
      bucket: job.conclusion === "failure" ? "fail" : "pass",
      link: job.html_url,
    })),
    waits: [] as number[],
    requests: [] as string[][],
    log: "complete selected Windows failure diagnostics\n",
    onWait: () => {},
    onLog: () => {},
    onJobs: () => {},
  };
  const commands = {
    async gh(_config: DeliveryConfig, args: string[]) {
      state.requests.push(args);
      if (args[0] === "pr" && args[1] === "checks") return JSON.stringify(state.projection);
      expect(args).toEqual([
        "run",
        "view",
        String(current.id),
        "--attempt",
        String(current.run_attempt),
        "--log-failed",
      ]);
      state.onLog();
      return state.log;
    },
    async ghJson(_config: DeliveryConfig, args: string[]) {
      state.requests.push(args);
      if (args[0] === "pr")
        return {
          number: 566,
          url: f.publication.url,
          headRefOid: f.publication.head,
          headRefName: f.publication.sourceBranch,
          baseRefName: "main",
          state: "OPEN",
          title: f.publication.title,
          body: f.publication.body,
        };
      const endpoint = args[1]!;
      if (endpoint.includes("runs?")) return structuredClone([{ workflow_runs: state.runs }]);
      const id = Number(endpoint.split("/runs/")[1]!.split("/")[0]);
      if (endpoint.includes("/jobs?")) {
        expect(endpoint).toContain("filter=latest");
        const result = structuredClone([{ jobs: state.jobs.get(id) }]);
        state.onJobs();
        return result;
      }
      return structuredClone(state.runs.find((run) => run.id === id));
    },
  };
  const provider = githubDeliveryAdapter(commands, "git", async (ms) => {
    state.waits.push(ms);
    state.onWait();
  });
  f.adapter.checks = provider.checks;
  f.adapter.failedCheckLog = provider.failedCheckLog!.bind(provider);
  const complete = (bucket: CheckEvidence["bucket"] = "pass") => {
    current.status = "completed";
    state.jobs.set(
      current.id,
      jobsFor(current, ["pass", bucket, "pass"], [105387830071, 105387830221, 105387829846]),
    );
  };
  return { ...f, hosted: state, current, old, jobsFor, complete, provider };
}

it("ISS-185 captured stale failure/current pending sequence resumes to its own green", async () => {
  const f = await incidentFixture();
  const legacyHistory = JSON.stringify({
    phase: "failed",
    candidateAttempt: 3,
    historyCount: 6,
    run: 35270001390,
    publication: 566,
  });
  const history = resolve(f.config.stateDirectory, "historical-stop.json");
  await writeFile(history, legacyHistory);
  for (let restart = 0; restart < 2; restart++) {
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
      retries: 0,
    });
    expect(f.calls).not.toContain("merge");
    expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
  }
  // Mixed old/new rollup rows cannot change the authoritative run selection.
  f.hosted.projection.push(
    ...f.hosted.jobs.get(f.current.id)!.map((job) => ({
      name: job.name,
      bucket: "pending",
      link: job.html_url,
    })),
  );
  f.complete();
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "complete",
  });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "complete",
  });
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  expect(await readFile(history, "utf8")).toBe(legacyHistory);
});

it.each(["absent", "pending", "failure"] as const)(
  "ISS-185 SYNTHETIC stale green cannot authorize current %s",
  async (mode) => {
    const f = await incidentFixture();
    f.hosted.projection.forEach((check) => {
      check.bucket = "pass";
    });
    if (mode === "absent") f.hosted.runs = [f.old];
    if (mode === "failure") f.complete("fail");
    const result = deliveryStep(f.config, f.adapter, f.policy);
    if (mode === "absent") {
      await expect(result).rejects.toMatchObject({ reason: "hosted-observation-unavailable" });
      expect(f.hosted.waits).toEqual(Array(12).fill(10_000));
    } else
      await expect(result).resolves.toMatchObject({
        status: mode === "failure" ? "failed" : "observing-hosted-checks",
      });
    expect(f.calls).not.toContain("merge");
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(
      mode === "failure" ? 1 : 0,
    );
    if (mode === "failure") {
      const log = await readFile(resolve(f.config.stateDirectory, "hosted-failure.log"), "utf8");
      expect(log).toContain("35276352971");
      expect(log).not.toContain("35270001390");
      expect(log).toContain(f.hosted.log);
    }
  },
);

it("SYNTHETIC foreign-only startup waits for current run visibility, including no jobs yet", async () => {
  const f = await incidentFixture();
  f.hosted.runs = [f.old];
  f.hosted.onWait = () => {
    if (f.hosted.waits.length === 3) f.hosted.runs.push(f.current);
  };
  f.hosted.jobs.set(f.current.id, []);
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
    checks: [],
  });
  expect(f.hosted.waits).toEqual([10_000, 10_000, 10_000]);
  expect(f.calls).not.toContain("merge");
});

it.each([
  "repository",
  "PR",
  "head",
  "source",
  "base",
  "unknown association",
  "duplicate run",
  "duplicate job",
  "duplicate name",
  "missing terminal job",
  "competing run",
  "acquisition",
] as const)("SYNTHETIC current %s uncertainty is a non-parking observation stop", async (mode) => {
  const f = await incidentFixture();
  f.complete();
  if (mode === "repository") f.current.repository.full_name = "other/repository";
  if (mode === "PR") f.current.pull_requests[0]!.number = 999;
  if (mode === "head") f.current.head_sha = "f".repeat(40);
  if (mode === "source") f.current.pull_requests[0]!.head.ref = "another-source";
  if (mode === "base") f.current.pull_requests[0]!.base.ref = "release";
  if (mode === "unknown association") f.current.pull_requests = [];
  if (mode === "duplicate run") f.hosted.runs.push(f.current);
  const jobs = f.hosted.jobs.get(f.current.id)!;
  if (mode === "duplicate job") jobs.push(jobs[0]!);
  if (mode === "duplicate name") jobs[1]!.name = jobs[0]!.name;
  if (mode === "missing terminal job") jobs.pop();
  if (mode === "competing run") f.hosted.runs.push({ ...f.current, id: 999 });
  if (mode === "acquisition")
    f.hosted.onJobs = () => {
      throw new Error("API unavailable");
    };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toMatchObject({
    reason: "hosted-observation-unavailable",
  });
  expect(isItemStopReason("hosted-observation-unavailable")).toBe(false);
  expect(f.calls).not.toContain("merge");
  expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
});

it.each(["pending", "fail", "pass"] as const)(
  "SYNTHETIC later same-PR workflow run selects its own %s jobs",
  async (bucket) => {
    const f = await incidentFixture();
    f.complete();
    // Deliberately smaller ID, but next run_number of the same owning workflow.
    const later = {
      ...f.current,
      id: 444,
      run_number: 103,
      status: bucket === "pending" ? "in_progress" : "completed",
    };
    f.hosted.runs.push(later);
    f.hosted.jobs.set(later.id, f.jobsFor(later, ["pass", bucket, "pass"], [801, 802, 803]));
    const result = await f.provider.checks(f.config, f.publication);
    expect(result.checks.map((check) => check.bucket)).toEqual(["pass", bucket, "pass"]);
    expect(result.checks.every((check) => check.actions?.run === 444)).toBe(true);
  },
);

it.each(["all", "failed-only"] as const)(
  "SYNTHETIC native rerun-%s uses the API effective job set at the current attempt",
  async (kind) => {
    const f = await incidentFixture();
    f.complete("fail");
    await expect(f.provider.checks(f.config, f.publication)).resolves.toMatchObject({
      checks: [{ bucket: "pass" }, { bucket: "fail" }, { bucket: "pass" }],
    });
    f.current.run_attempt = 2;
    f.current.status = "in_progress";
    const jobs = f.jobsFor(f.current, ["pass", "pending", "pass"], [901, 902, 903]);
    if (kind === "failed-only") {
      const prior = f.hosted.jobs.get(f.current.id)!;
      jobs[0] = prior[0]!;
      jobs[2] = prior[2]!;
    }
    f.hosted.jobs.set(f.current.id, jobs);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    expect(f.calls).not.toContain("merge");
    jobs[1]!.status = "completed";
    jobs[1]!.conclusion = "success";
    f.current.status = "completed";
    const selected = await f.provider.checks(f.config, f.publication);
    expect(selected.checks.every((check) => check.actions?.attempt === 2)).toBe(true);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "complete",
    });
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  },
);

it("SYNTHETIC pending rerun cannot borrow an all-green old effective set", async () => {
  const f = await incidentFixture();
  f.complete();
  f.current.run_attempt = 2;
  f.current.status = "queued";
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
  });
  expect(f.calls).not.toContain("merge");
});

it.each(["jobs", "logs"] as const)(
  "SYNTHETIC run attempt changes during %s acquisition refuse mixed evidence",
  async (during) => {
    const f = await incidentFixture();
    f.complete("fail");
    const change = () => {
      f.current.run_attempt++;
    };
    if (during === "jobs") f.hosted.onJobs = change;
    else f.hosted.onLog = change;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toMatchObject({
      reason:
        during === "jobs"
          ? "hosted-observation-unavailable"
          : "hosted-check-log-unavailable:Node 24 / windows-latest",
    });
    await expect(
      readFile(resolve(f.config.stateDirectory, "hosted-failure.log")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.calls).not.toContain("merge");
  },
);

it.each(["stale failure", "stale green", "current failure"] as const)(
  "SYNTHETIC owning queue preserves charges on restart with %s",
  async (mode) => {
    const f = await incidentFixture();
    const current = f.config;
    current.retries = 1;
    const stateDirectory = resolve(current.stateDirectory, "../queue");
    await mkdir(stateDirectory);
    const actor = { model: "fixture", effort: "high", prompt: "fixture" };
    const history: QueueParticipant[] = Array.from({ length: 6 }, (_, index) => ({
      ordinal: index + 1,
      id: index === 5 ? "review-fixture" : `participant-${index}`,
      item: index < 4 ? `prior-${Math.floor(index / 2)}` : "fixture",
      stage: "source",
      role: index % 2 ? "reviewer" : "author",
      outcome: index < 4 && index % 2 ? "failed" : "passed",
      rung: 0,
      usage: queueUsage(undefined),
    }));
    const queue: QueueConfig = {
      schemaVersion: "dogfood-bounded-queue-config/v1",
      controller: current.controller,
      run: current.run,
      controllerRoot: current.controllerRoot,
      controllerRevision: current.controllerRevision,
      stateDirectory,
      limit: 1,
      nativeLaunchCeiling: 8,
      initialHistory: history.slice(0, 4),
      items: [
        {
          id: "fixture",
          issue: current.issue,
          base: current.candidateHead,
          implementationAttempt: 3,
          implementationAttemptCeiling: 4,
          setup: {
            controller: current.controller,
            run: current.run,
            issue: current.issue,
            repository: current.repository,
            repositoryRoot: current.repositoryRoot,
            controllerRoot: current.controllerRoot,
            controllerRevision: current.controllerRevision,
            pilotRevision: current.controllerRevision,
            base: current.candidateHead,
            baseBranch: "main",
            sourceBranch: f.publication.sourceBranch,
            pilotWorktree: resolve(stateDirectory, "../pilot"),
            sourceWorktree: current.worktree,
            reviewWorktree: current.reviewWorktree,
            stateDirectory: resolve(stateDirectory, "setup"),
          },
          source: {
            owner: current.controller,
            run: current.run,
            issue: current.issue,
            pilotRevision: current.controllerRevision,
            base: current.candidateHead,
            worktree: current.worktree,
            reviewWorktree: current.reviewWorktree,
            stateDirectory: current.stateDirectory,
            allowedPaths: ["."],
            repository: current.repository,
            requiredChecks: current.requiredChecks,
            author: actor,
            reviewer: actor,
            adapter: { kind: "codex-exec", executable: process.execPath },
          },
          repair: {
            stateDirectory: resolve(stateDirectory, "repair"),
            acceptanceCriteria: ["fixture"],
            author: actor,
            reviewer: actor,
          },
          delivery: { requiredChecks: current.requiredChecks, policy: current.policy },
        },
      ],
    };
    const saved = {
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "delivery",
      run: queue.run,
      index: 0,
      item: "fixture",
      issue: current.issue,
      base: current.candidateHead,
      candidateAttempt: 3,
      head: current.candidateHead,
      reviewId: "review-fixture",
      findings: [],
      history,
      retries: 1,
      acceptedStage: "source",
      stateDirectory: current.stateDirectory,
      authorFailures: { count: 2, ids: ["participant-0", "participant-2"] },
    };
    const path = resolve(stateDirectory, "attempt.json");
    const bytes = `${JSON.stringify(saved, null, 2)}\n`;
    await writeFile(path, bytes);
    let workers = 0;
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return history;
      },
      async setup() {
        throw new Error("unexpected setup");
      },
      async source() {
        workers++;
        throw new Error("unexpected source launch");
      },
      async repair() {
        workers++;
        throw new Error("unexpected corrective launch");
      },
      async delivery() {
        return deliveryStep(current, f.adapter, f.policy);
      },
    };
    if (mode !== "stale failure")
      f.hosted.projection.forEach((row) => {
        row.bucket = "pass";
      });
    if (mode === "stale green") f.hosted.runs = [f.old];
    if (mode === "current failure") f.complete("fail");
    if (mode === "current failure") {
      await expect(queueStep(queue, adapter)).resolves.toMatchObject({
        status: "advancing-attempt",
        cursor: 3,
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        phase: "failed",
        candidateAttempt: 3,
        retries: 1,
        history,
      });
    } else {
      for (let resume = 0; resume < 2; resume++) {
        if (mode === "stale green")
          await expect(queueStep(queue, adapter)).rejects.toMatchObject({
            reason: "hosted-observation-unavailable",
          });
        else
          await expect(queueStep(queue, adapter)).resolves.toMatchObject({
            status: "observing-hosted-checks",
          });
        expect(await readFile(path, "utf8")).toBe(bytes);
      }
    }
    expect(workers).toBe(0);
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.calls).not.toContain("merge");
  },
);

it("SYNTHETIC predecessor-log acquisition cannot reuse a foreign failure", async () => {
  const f = await incidentFixture();
  await expect(hostedFailureEvidence(f.config, f.adapter, f.publication)).rejects.toThrow(
    "hosted-failure-evidence-unavailable",
  );
  expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
  f.complete("fail");
  const path = await hostedFailureEvidence(f.config, f.adapter, f.publication);
  expect(path).toBe(resolve(f.config.stateDirectory, "hosted-failure.log"));
  expect(await readFile(path!, "utf8")).toContain("35276352971");
  expect(await readFile(path!, "utf8")).not.toContain("35270001390");
  expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(1);
  await hostedFailureEvidence(f.config, f.adapter, f.publication);
  expect(f.hosted.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(1);
});

it("SYNTHETIC unfinished legacy green receipt requires fresh attribution on resume", async () => {
  const f = await incidentFixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  const saved = {
    head: f.config.candidateHead,
    checks: f.hosted.projection.map((row) => ({ ...row, bucket: "pass" })),
  };
  await writeState(f.config, "hosted-checks", saved);
  const path = resolve(f.config.stateDirectory, "hosted-checks.json");
  const bytes = await readFile(path, "utf8");
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
  });
  expect(await readFile(path, "utf8")).toBe(bytes);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls).not.toContain("merge");
});

it("SYNTHETIC same-PR later run cannot fill missing terminal jobs from its predecessor", async () => {
  const f = await incidentFixture();
  f.complete();
  const later = { ...f.current, id: 444, run_number: 103 };
  f.hosted.runs.push(later);
  f.hosted.jobs.set(
    later.id,
    f.jobsFor(later, ["pass", "pass", "pass"], [801, 802, 803]).slice(0, 2),
  );
  await expect(f.provider.checks(f.config, f.publication)).rejects.toMatchObject({
    reason: "hosted-observation-unavailable",
  });
});

it("SYNTHETIC later run appearing during job acquisition requires reobservation", async () => {
  const f = await incidentFixture();
  f.complete();
  f.hosted.onJobs = () => {
    f.hosted.runs.push({ ...f.current, id: 444, run_number: 103, status: "queued" });
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toMatchObject({
    reason: "hosted-observation-unavailable",
  });
  expect(f.calls).not.toContain("merge");
});

it("SYNTHETIC separate owning workflows retain every configured required context", async () => {
  const f = await incidentFixture();
  f.complete();
  const other = {
    ...f.current,
    id: 444,
    workflow_id: 8,
    run_number: 1000,
    path: ".github/workflows/windows.yml",
  };
  f.hosted.runs.push(other);
  const jobs = f.hosted.jobs.get(f.current.id)!;
  f.hosted.jobs.set(f.current.id, [jobs[0]!, jobs[2]!]);
  f.hosted.jobs.set(other.id, [f.jobsFor(other, ["pass", "pending", "pass"], [801, 802, 803])[1]!]);
  other.status = "in_progress";
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
    checks: [{ bucket: "pass" }, { bucket: "pending" }, { bucket: "pass" }],
  });
  expect(f.calls).not.toContain("merge");
});

function expectNoProviderAction(calls: string[]) {
  expect(calls).not.toContain("verify");
  expect(calls.filter((call) => call.startsWith("gate:"))).toEqual([]);
  expect(calls.filter((call) => call.startsWith("observe-draft:"))).toEqual([]);
  expect(calls.filter((call) => call.startsWith("draft:"))).toEqual([]);
  expect(calls).not.toContain("observe-publication");
  expect(calls).not.toContain("publish");
  expect(calls).not.toContain("checks");
  expect(calls).not.toContain("observe-merge");
  expect(calls).not.toContain("merge");
  expect(calls).not.toContain("observe-cleanup");
  expect(calls).not.toContain("cleanup");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("completes the authorized normal path once with intent-backed mutations", async () => {
  const f = await fixture();
  const result = await deliveryStep(f.config, f.adapter, f.policy);
  expect(result).toMatchObject({
    status: "complete",
    head,
    reviewId: "review-fixture",
    publication: { number: 44, url: "https://example.test/pull/44" },
    checks: [
      { name: "linux", bucket: "pass" },
      { name: "windows", bucket: "pass" },
      { name: "macos", bucket: "pass" },
    ],
    mergeCommit,
  });
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "cleanup")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  expect(f.calls.filter((call) => call.startsWith("draft:"))).toEqual(["draft:2", "draft:332"]);
  expect(f.calls.indexOf("gate:planning:check")).toBeLessThan(f.calls.indexOf("draft:2"));
  expect(f.calls.indexOf("draft:332")).toBeLessThan(f.calls.indexOf("gate:planning:board-check"));
});

it("delivers and resumes a separate local branch while retaining the published identity", async () => {
  const f = await fixture();
  f.config.localBranch = "codex/run-fresh/iss-074-attempt-1";
  f.plan.cleanup.branch = f.config.localBranch;
  f.publication.planDigest = digest(f.plan);
  const result = await deliveryStep(f.config, f.adapter, f.policy);
  expect(result).toMatchObject({ status: "complete", cleanup: { branch: f.config.localBranch } });
  expect(f.state.publication?.sourceBranch).toBe("codex/fixture");
  expect(await deliveryStep(f.config, f.adapter, f.policy)).toEqual(result);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "cleanup")).toHaveLength(1);
});

it("resumes completed delivery after deleted candidate worktrees without consulting source or policy", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  await Promise.all([
    rm(f.config.worktree, { recursive: true }),
    rm(f.config.reviewWorktree, { recursive: true }),
  ]);
  f.calls.length = 0;
  const result = await deliveryStep(f.config, f.adapter, {
    async plan() {
      throw new Error("must not be called");
    },
  });
  expect(result.status).toBe("complete");
  expect(f.calls).toEqual([]);
});

it("rejects a changed controller when resuming completed state without provider access", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  f.config.controller = "unknown-controller";
  await writeState(f.config, "delivery-config", { fingerprint: digest(f.config) });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("rejects a self-consistent saved plan that was not authorized by policy", async () => {
  const f = await fixture();
  const offPolicy = structuredClone(f.plan);
  offPolicy.publication.baseBranch = "release";
  await writeState(f.config, "delivery-plan", {
    head,
    digest: digest(offPolicy),
    plan: offPolicy,
  });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery-plan",
  );
  expect(f.calls).toEqual(["source", "policy"]);
});

it.each([false, true])(
  "handles a pre-G0 delivery plan on resume (authorized: %s)",
  async (authorized) => {
    const f = await fixture();
    const saved = { head, digest: digest(f.plan), plan: f.plan };
    await writeState(f.config, "delivery-plan", saved);
    if (authorized)
      await writeState(f.config, "delivery-plan-authorization", {
        head,
        digest: saved.digest,
        policyDigest: digest(f.config.policy),
        controller: f.config.controller,
      });
    const nextPlan = structuredClone(f.plan);
    nextPlan.publication.body += "\n\nReview G0: No, all stated constraints require this shape.";
    const policy = {
      async plan() {
        f.calls.push("new-policy");
        return nextPlan;
      },
    };
    if (authorized) {
      await expect(deliveryStep(f.config, f.adapter, policy)).resolves.toMatchObject({
        status: "complete",
      });
      expect(f.state.publication?.body).toBe(saved.plan.publication.body);
      expect(f.calls).not.toContain("new-policy");
    } else {
      await expect(deliveryStep(f.config, f.adapter, policy)).rejects.toThrow(
        "unauthorized-delivery-plan",
      );
      expect(f.calls).toEqual(["source", "new-policy"]);
      expectNoProviderAction(f.calls);
    }
    expect(
      JSON.parse(await readFile(resolve(f.config.stateDirectory, "delivery-plan.json"), "utf8")),
    ).toEqual(saved);
  },
);

it("observes check startup and pending checks without republishing", async () => {
  const f = await fixture();
  f.state.checks = "empty";
  expect(await deliveryStep(f.config, f.adapter, f.policy)).toMatchObject({
    status: "observing-hosted-checks",
    checks: [],
  });
  f.state.checks = "pending";
  expect(await deliveryStep(f.config, f.adapter, f.policy)).toMatchObject({
    status: "observing-hosted-checks",
  });
  expect(f.calls).not.toContain("merge");
  f.state.checks = "pass";
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
});

it("waits across intermediate jobs and job gaps for the real required aggregate without republishing", async () => {
  const f = await aggregateFixture();
  for (const [status, checks] of [
    ["queued", []],
    ["in_progress", [f.check("Change Scope", "pending")]],
    ["in_progress", [f.check("Change Scope", "pass")]],
    ["in_progress", [f.check("Static", "pass", 455), f.check("Unit", "pass")]],
  ] as const) {
    f.evidence.runs[0]!.status = status;
    f.evidence.checks = [...checks];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
      checks: [],
    });
    expect(f.calls).not.toContain("merge");
    await expect(
      readFile(resolve(f.config.stateDirectory, "hosted-checks.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
  f.evidence.checks = [f.check("PR Required", "pending")];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
    checks: f.evidence.checks,
  });
  f.evidence.runs[0]!.status = "completed";
  f.evidence.checks = [f.check("PR Required", "pass")];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "complete",
  });
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  expect(
    JSON.parse(await readFile(resolve(f.config.stateDirectory, "hosted-checks.json"), "utf8"))
      .checks,
  ).toEqual(f.evidence.checks);
});

it.each([false, true])(
  "reobserves invisible required-check startup with advisory rows=%s",
  async (advisory) => {
    const waits: number[] = [];
    const f = await aggregateFixture(async (ms) => {
      waits.push(ms);
      expect(f.calls).not.toContain("merge");
      if (waits.length === 3) f.evidence.runs = [syntheticRun(f.publication, "queued")];
    });
    f.evidence.runs = [];
    if (advisory)
      f.evidence.checks = [f.check("PR Scope", "pass", 455), f.check("Risk Review", "pending")];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
      checks: [],
      retries: 0,
    });
    expect(waits).toEqual([10_000, 10_000, 10_000]);
    expect(f.calls).not.toContain("merge");
    f.evidence.runs[0]!.status = "in_progress";
    f.evidence.checks = [f.check("PR Required", "pending")];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    f.evidence.runs[0]!.status = "completed";
    f.evidence.checks = [f.check("PR Required", "pass")];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "complete",
      retries: 0,
    });
    expect(waits).toHaveLength(3);
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
    expect(f.calls.filter((call) => call === "source")).toHaveLength(1);
    expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  },
);

it.each([false, true])(
  "bounds invisible workflow startup with advisory rows=%s",
  async (advisory) => {
    const waits: number[] = [];
    const f = await aggregateFixture(async (ms) => {
      waits.push(ms);
    });
    f.evidence.runs = [];
    if (advisory) f.evidence.checks = [f.check("PR Scope", "pass")];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "hosted-observation-unavailable",
    );
    expect(waits).toEqual(Array(12).fill(10_000));
    expect(f.calls).not.toContain("merge");
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  },
);

it.each([
  "terminal missing",
  "unknown workflow",
  "no workflow",
  "wrong workflow head",
  "wrong PR",
  "duplicate",
  "fail",
  "cancel",
  "skipping",
  "malformed",
  "publication drift",
])("refuses merge after waiting when aggregate evidence becomes %s", async (mode) => {
  const waits: number[] = [];
  const f = await aggregateFixture(async (ms) => {
    waits.push(ms);
  });
  f.evidence.checks = [f.check("Change Scope", "pass")];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
  });
  if (mode === "terminal missing") f.evidence.runs[0]!.status = "completed";
  if (mode === "unknown workflow") f.evidence.runs[0]!.status = "unknown";
  if (mode === "no workflow") f.evidence.runs = [];
  if (mode === "wrong workflow head") f.evidence.runs[0]!.head_sha = "f".repeat(40);
  if (mode === "wrong PR") f.evidence.runs[0]!.pull_requests[0]!.number += 1;
  if (mode === "publication drift") f.evidence.driftAfterWorkflow = true;
  if (mode === "duplicate")
    f.evidence.checks = [f.check("PR Required", "pass"), f.check("PR Required", "pass")];
  if (["fail", "cancel", "skipping"].includes(mode))
    f.evidence.checks = [f.check("PR Required", mode as CheckEvidence["bucket"])];
  if (mode === "malformed") f.evidence.checks = [{ ...f.check("PR Required", "pass"), link: "" }];
  if (mode === "fail" || mode === "cancel") f.evidence.runs[0]!.status = "completed";
  const result = deliveryStep(f.config, f.adapter, f.policy);
  if (mode === "fail" || mode === "cancel")
    await expect(result).resolves.toMatchObject({ status: "failed" });
  else
    await expect(result).rejects.toThrow(
      mode === "skipping" ? "hosted-check-failed:PR Required" : "hosted-observation-unavailable",
    );
  expect(f.calls).not.toContain("merge");
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(waits).toHaveLength(["no workflow", "wrong PR"].includes(mode) ? 12 : 0);
});

it("revalidates publication identity during the startup retry", async () => {
  const waits: number[] = [];
  const f = await aggregateFixture(async (ms) => {
    waits.push(ms);
    f.evidence.driftAfterWorkflow = true;
  });
  f.evidence.runs = [];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "hosted-observation-unavailable",
  );
  expect(waits).toEqual([10_000]);
  expect(f.calls).not.toContain("merge");
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
});

it.each([
  ["duplicate", "missing-or-duplicate-check:linux"],
  ["missing", "missing-or-duplicate-check:macos"],
  ["skipping", "hosted-check-failed:linux"],
] as const)("fails closed for %s required hosted checks", async (mode, reason) => {
  const f = await fixture();
  f.state.checks = mode;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
  expect(f.calls).not.toContain("merge");
});

it.each(["fail", "cancel"] as const)(
  "captures complete attributable %s logs once, and resumes without mutation",
  async (bucket) => {
    const f = await aggregateFixture(undefined, ["linux", "windows", "macos"]);
    f.evidence.runs[0]!.status = "completed";
    f.evidence.checks = [
      f.check("linux", "pass", 454),
      f.check("windows", bucket, 455),
      f.check("macos", bucket),
    ];
    f.evidence.log = `Static Checks: invalid source-line references\nUnit Tests: stale lockfileSha256\nE2E: pgvector pull TCP reset\n${"PR Required aggregate shell boilerplate\n".repeat(200)}`;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "failed",
      findings: [
        {
          file: "windows",
          text: hostedFailurePrompt(resolve(f.config.stateDirectory, "hosted-failure.log")),
        },
      ],
    });
    const path = resolve(f.config.stateDirectory, "hosted-failure.log");
    const saved = await readFile(path, "utf8");
    expect(saved).toContain(f.evidence.log);
    expect(JSON.parse(saved.split("\n")[0]!)).toMatchObject({
      head,
      publication: { number: 44 },
      checks: [
        { actions: { run: 123, attempt: 1, job: 455 } },
        { actions: { run: 123, attempt: 1, job: 456 } },
      ],
    });
    expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(1);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "failed",
    });
    expect(await readFile(path, "utf8")).toBe(saved);
    expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(1);
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.calls).not.toContain("merge");
  },
);

it.each(["fail", "cancel"] as const)(
  "waits for the attributed %s run to complete before acquiring logs",
  async (bucket) => {
    const f = await aggregateFixture();
    f.evidence.checks = [f.check("PR Required", bucket)];
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "observing-hosted-checks",
    });
    expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
    f.evidence.runs[0]!.status = "completed";
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "failed",
    });
    expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(1);
    expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(f.calls).not.toContain("merge");
  },
);

it.each(["empty log", "log error", "attempt changed"])(
  "blocks unavailable or inconsistent failure diagnostics: %s",
  async (mode) => {
    const f = await aggregateFixture();
    f.evidence.runs[0]!.status = "completed";
    f.evidence.checks = [f.check("PR Required", "fail")];
    if (mode === "empty log") f.evidence.log = " \n";
    if (mode === "log error") f.evidence.logError = true;
    if (mode === "attempt changed")
      f.evidence.afterLog = () => {
        f.evidence.runs[0]!.run_attempt++;
      };
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "hosted-check-log-unavailable:PR Required",
    );
    await expect(
      readFile(resolve(f.config.stateDirectory, "hosted-failure.log")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.calls).not.toContain("merge");
  },
);

it("refuses legacy failure evidence for an unfinished decision without changing its bytes", async () => {
  const f = await aggregateFixture();
  f.evidence.runs[0]!.status = "completed";
  f.evidence.checks = [f.check("PR Required", "fail")];
  const path = resolve(f.config.stateDirectory, "hosted-failure.log");
  const old =
    JSON.stringify({
      repository: f.config.repository,
      head,
      publication: f.publication,
      checks: [f.check("PR Required", "fail")],
    }) + "\nold same-SHA failure\n";
  await writeFile(path, old);
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "hosted-observation-unavailable",
  );
  expect(await readFile(path, "utf8")).toBe(old);
  expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
  expect(f.calls).not.toContain("merge");
});

it("invalidates readiness when hosted observation moves from the reviewed head", async () => {
  const f = await fixture();
  f.adapter.checks = async () => ({ head: "c".repeat(40), checks: [] });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow("hosted-head-drift");
  expect(f.calls).not.toContain("merge");
});

it("does not attach logs from a workflow run on a different candidate", async () => {
  const f = await aggregateFixture();
  f.evidence.runs[0]!.head_sha = "f".repeat(40);
  f.evidence.checks = [f.check("PR Required", "fail")];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "hosted-observation-unavailable",
  );
  expect(f.requests.filter((args) => args.includes("--log-failed"))).toHaveLength(0);
  await expect(
    readFile(resolve(f.config.stateDirectory, "hosted-failure.log")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.calls).not.toContain("merge");
});

it("does not retry an uncertain publication and reconciles it on restart", async () => {
  const f = await fixture();
  let observations = 0;
  f.adapter.observePublication = async () => {
    observations += 1;
    if (observations === 1) return { state: "needs-mutation", target: "fixture-absent" };
    if (observations === 2) return { state: "unknown" };
    return { state: "confirmed", value: f.publication };
  };
  f.adapter.publish = async () => {
    f.calls.push("publish");
    throw new Error("synthetic lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-outcome-unknown",
  );
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
});

it("retains an exact conflicting publication after a lost publish response without repeating mutation", async () => {
  const f = await fixture();
  let observations = 0;
  f.adapter.observePublication = async () =>
    ++observations === 1
      ? { state: "needs-mutation", target: "fixture-absent" }
      : { state: "conflicting", value: f.publication };
  f.adapter.publish = async () => {
    f.calls.push("publish");
    throw new Error("lost response");
  };
  f.adapter.checks = async () => {
    throw new DeliveryBlocked("published-candidate-conflict");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "published-candidate-conflict",
  );
  expect(
    JSON.parse(await readFile(resolve(f.config.stateDirectory, "publication.json"), "utf8")),
  ).toEqual(f.publication);
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "published-candidate-conflict",
  );
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls).not.toContain("merge");
});

it.each([false, true])(
  "reconciles a delayed reviewed refresh (separate local branch: %s)",
  async (separateBranch) => {
    const f = await fixture();
    const refresh = {
      number: f.publication.number,
      url: f.publication.url,
      head: "d".repeat(40),
      ...(separateBranch ? { localBranch: "codex/correction" } : {}),
    };
    f.config.refresh = refresh;
    if (separateBranch) f.plan.cleanup.branch = "codex/correction";
    f.publication.planDigest = digest(f.plan);
    let visible = false;
    let publications = 0;
    f.adapter.observePublication = async (_config, _plan, _digest, target) => {
      if (visible) return { state: "confirmed", value: f.publication };
      return target === undefined
        ? { state: "needs-mutation", target: `pr:${refresh.number}` }
        : { state: "unknown" };
    };
    f.adapter.publish = async () => {
      publications += 1;
    };

    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "publication-outcome-unknown",
    );
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "publication-state-unknown",
    );
    expect(publications).toBe(1);
    visible = true;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
      status: "complete",
      head,
      reviewId: "review-fixture",
    });
    expect(publications).toBe(1);
    expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  },
);

it("rejects a foreign refresh URL before source, policy, or provider access", async () => {
  const f = await fixture();
  f.config.refresh = {
    number: 44,
    url: "https://foreign.test/pull/44",
    head: "d".repeat(40),
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-refresh",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("persists a selected publication target and rejects its replacement on restart", async () => {
  const f = await fixture();
  const provider = githubDeliveryAdapter({
    async gh() {
      throw new Error("unexpected provider effect");
    },
    async ghJson() {
      if (uncertain) throw new Error("uncertain provider response");
      return [
        {
          number,
          url: `https://github.com/${f.config.repository}/pull/${number}`,
          headRefOid: head,
          headRefName: f.plan.publication.sourceBranch,
          baseRefName: f.plan.publication.baseBranch,
          state: "OPEN",
          isDraft: true,
          title: number === 44 ? "old title" : f.plan.publication.title,
          body: f.plan.publication.body,
        },
      ];
    },
  });
  let number = 44,
    uncertain = false;
  f.adapter.publicationUrl = provider.publicationUrl;
  f.adapter.observePublication = provider.observePublication;
  const targets: string[] = [];
  f.adapter.publish = async (_config, _plan, target) => {
    targets.push(target);
    uncertain = true;
    throw new Error("lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-outcome-unknown",
  );
  expect(
    JSON.parse(await readFile(resolve(f.config.stateDirectory, "publication-intent.json"), "utf8")),
  ).toMatchObject({ head, target: "pr:44" });
  number = 45;
  uncertain = false;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-state-unknown",
  );
  expect(targets).toEqual(["pr:44"]);
  expect(f.calls).not.toContain("checks");
});

it("refuses a legacy unbound publication intent before observing the provider", async () => {
  const f = await fixture();
  await writeState(f.config, "publication-intent", {
    head,
    operation: digest({ name: "publication", head }),
  });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-intent",
  );
  expect(f.calls).not.toContain("observe-publication");
  expect(f.calls).not.toContain("publish");
});

it("rejects a same-head publication receipt whose approved base identity changed", async () => {
  const f = await fixture();
  f.state.checks = "pending";
  await deliveryStep(f.config, f.adapter, f.policy);
  await writeState(f.config, "publication", {
    ...f.publication,
    baseBranch: "release",
  });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-receipt",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("rejects a receipt URL outside the adapter identity before provider effects", async () => {
  const f = await fixture();
  f.state.checks = "pending";
  await deliveryStep(f.config, f.adapter, f.policy);
  await writeState(f.config, "publication", {
    ...f.publication,
    url: "https://foreign.example/pull/44",
  });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-receipt",
  );
  expect(f.calls).toEqual([]);
});

it("does not double merge after a lost provider response", async () => {
  const f = await fixture();
  let observations = 0;
  f.adapter.observeMerge = async () => {
    observations += 1;
    if (observations === 1) return { state: "needs-mutation" };
    if (observations === 2) return { state: "unknown" };
    return {
      state: "confirmed",
      value: { number: 44, head, mergeCommit },
    };
  };
  f.adapter.merge = async () => {
    f.calls.push("merge");
    throw new Error("synthetic lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "merge-outcome-unknown",
  );
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
});

it("stops without a source finding or re-enqueue when an admitted pull request leaves the queue", async () => {
  const f = await fixture();
  f.plan.mergePolicy = { method: "queue" };
  f.publication.planDigest = digest(f.plan);
  let queued = false;
  f.adapter.observeMerge = async () =>
    f.state.merged
      ? {
          state: "confirmed",
          value: { number: 44, head, mergeCommit },
        }
      : queued
        ? { state: "pending" }
        : { state: "needs-mutation", detail: "absent" };
  f.adapter.merge = async () => {
    f.calls.push("merge");
    queued = true;
  };

  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "observing-hosted-checks",
  });
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  queued = false;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toMatchObject({
    reason: "merge-queue-removed",
  });
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
});

it("refuses partial cleanup and never starts a second cleanup mutation", async () => {
  const f = await fixture();
  f.adapter.cleanup = async () => {
    f.calls.push("cleanup");
    f.state.cleanup = "partial";
    throw new Error("synthetic partial cleanup");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "cleanup-outcome-unknown",
  );
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "cleanup-state-unknown",
  );
  expect(f.calls.filter((call) => call === "cleanup")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "policy")).toHaveLength(1);
});

it.each(["gate-4", "draft-ISS-074"])(
  "refuses a saved merge when the %s prerequisite receipt is absent",
  async (missing) => {
    const f = await fixture();
    await deliveryStep(f.config, f.adapter, f.policy);
    await Promise.all([
      rm(resolve(f.config.stateDirectory, "cleanup.json")),
      rm(resolve(f.config.stateDirectory, `${missing}.json`)),
    ]);
    f.calls.length = 0;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "incomplete-merge-prerequisites",
    );
    expect(f.calls).toEqual([]);
    expectNoProviderAction(f.calls);
  },
);

it("refuses completed status when a required phase receipt is absent", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  await rm(resolve(f.config.stateDirectory, "gate-2.json"));
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "incomplete-completed-delivery",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it.each(["duplicate", "omitted"] as const)(
  "rejects a newly observed cleanup receipt with %s targets",
  async (mode) => {
    const f = await fixture();
    f.adapter.observeCleanup = async () => ({
      state: "confirmed",
      value: {
        worktrees:
          mode === "duplicate"
            ? [f.plan.cleanup.worktrees[0]!, f.plan.cleanup.worktrees[0]!]
            : [f.plan.cleanup.worktrees[0]!],
        branch: f.plan.cleanup.branch,
      },
    });
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "malformed-cleanup-receipt",
    );
  },
);

it.each(["duplicate", "omitted"] as const)(
  "rejects a restarted completed delivery with %s cleanup targets",
  async (mode) => {
    const f = await fixture();
    await deliveryStep(f.config, f.adapter, f.policy);
    await writeFile(
      resolve(f.config.stateDirectory, "cleanup.json"),
      JSON.stringify({
        head,
        worktrees:
          mode === "duplicate"
            ? [f.plan.cleanup.worktrees[0]!, f.plan.cleanup.worktrees[0]!]
            : [f.plan.cleanup.worktrees[0]!],
        branch: f.plan.cleanup.branch,
      }),
    );
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "malformed-completed-delivery",
    );
  },
);

it("rejects cleanup plans that include the surviving controller checkout", async () => {
  const f = await fixture();
  f.plan.cleanup.worktrees = [f.config.controllerRoot, f.config.worktree];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-cleanup-plan",
  );
  expect(f.calls.some((call) => call === "cleanup" || call === "publish")).toBe(false);
});

it.each([
  ["blank controller", "controller", "   ", "invalid-controller"],
  ["null run", "run", null, "invalid-run"],
  ["false run", "run", false, "invalid-run"],
  ["true run", "run", true, "invalid-run"],
  ["numeric run", "run", 42, "invalid-run"],
  ["array repository", "repository", ["fixture/repository"], "invalid-repository"],
  ["array candidate head", "candidateHead", [head], "invalid-candidate-head"],
  [
    "array controller revision",
    "controllerRevision",
    ["c".repeat(40)],
    "invalid-controller-revision",
  ],
] as const)("rejects malformed %s", async (_case, field, value, reason) => {
  const f = await fixture();
  (f.config as unknown as Record<string, unknown>)[field] = value;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
  expect(f.calls).toEqual([]);
});

it("refuses candidate workspace drift before any gate or provider mutation", async () => {
  const f = await fixture();
  f.state.workspace = false;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "candidate-workspace-drift",
  );
  expect(f.calls.some((call) => call.startsWith("gate:") || call === "publish")).toBe(false);
});

it.each(["typecheck", "format:check", "planning:board-check"])(
  "retains an untyped %s failure without correction or replay",
  async (gate) => {
    const f = await fixture();
    let failures = 0;
    const run = f.adapter.runGate;
    f.adapter.runGate = async (config, name, head) => {
      if (name !== gate) return run(config, name, head);
      failures++;
      return { status: "failed", output: "first diagnostic" };
    };
    for (let replay = 0; replay < 2; replay++)
      await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toMatchObject({
        reason: `gate-attribution-unknown:${gate}`,
        diagnostics: "first diagnostic",
      });
    expect(failures).toBe(1);
    expect(f.calls).not.toContain("publish");
    expect(f.calls).not.toContain("merge");
  },
);

it("fails closed on a malformed external delivery record", async () => {
  const f = await fixture();
  await writeFile(resolve(f.config.stateDirectory, "delivery-config.json"), "not-json\n");
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-record:delivery-config",
  );
  expect(f.calls).toEqual([]);
});

it.each([
  ["publication", "null", null, "malformed-publication-receipt"],
  ["publication", "false", false, "malformed-publication-receipt"],
  ["publication", "object-shape-invalid", {}, "malformed-publication-receipt"],
  ["hosted-checks", "null", null, "malformed-hosted-checks-record"],
  ["hosted-checks", "false", false, "malformed-hosted-checks-record"],
  ["hosted-checks", "object-shape-invalid", {}, "malformed-hosted-checks-record"],
  ["merge", "null", null, "malformed-merge-receipt"],
  ["merge", "false", false, "malformed-merge-receipt"],
  ["merge", "object-shape-invalid", {}, "malformed-merge-receipt"],
] as const)(
  "rejects present %s state containing %s before any provider action",
  async (name, _shape, value, reason) => {
    const f = await fixture();
    await writeState(f.config, name, value);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
    expect(f.calls).toEqual([]);
    expectNoProviderAction(f.calls);
  },
);

it.each([
  ["gate-4", "null", null, "malformed-record:gate-4"],
  ["gate-4", "false", false, "malformed-record:gate-4"],
  ["gate-4", "object-shape-invalid", {}, "malformed-record:gate-4"],
  ["draft-ISS-074", "null", null, "malformed-record:draft-ISS-074"],
  ["draft-ISS-074", "false", false, "malformed-record:draft-ISS-074"],
  ["draft-ISS-074", "object-shape-invalid", {}, "malformed-record:draft-ISS-074"],
] as const)(
  "prevalidates a present %s %s receipt before gates, mirrors, or publication",
  async (name, _shape, value, reason) => {
    const f = await fixture();
    await writeState(f.config, name, value);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
    expect(f.calls).toEqual(["source", "policy"]);
    expectNoProviderAction(f.calls);
  },
);

it("imports the portable delivery composition directly in Node 24", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-import-")));
  roots.push(root);
  const output = resolve(root, "result.json");
  await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import("./scripts/dogfood/delivery.mjs").then(async m=>(await import("node:fs/promises")).writeFile(process.argv[1],JSON.stringify(typeof m.deliveryStep)))',
      output,
    ],
    { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
  );
  expect(JSON.parse(await readFile(output, "utf8"))).toBe("function");
});

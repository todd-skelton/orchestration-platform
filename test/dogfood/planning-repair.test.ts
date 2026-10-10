import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  planningStep,
  planningReviewers,
  recoveryHypothesis,
  validateProposal,
  type PlanningInput,
  type PlanningLevel,
  type PlanningOperation,
  type PlanningProposal,
} from "../../scripts/dogfood/planning-repair.js";
import { planningAuthority } from "../../scripts/dogfood/planning-context.mjs";
import { launchArguments } from "../../scripts/dogfood/dispatch-adapter.js";
import {
  queueStep,
  repositoryQueueAdapter,
  retainedSourceFailure,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import { QueueBlocked, type Config, type Terminal } from "../../scripts/dogfood/flow.js";
import { sourceFailureFixture, snapshot } from "./fixtures/source-failure.js";
import * as self from "../../adapters/self.mjs";
import * as chase from "../../adapters/chase-sets.mjs";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
it("loads planning queue composition with native Node type stripping", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await expect(
    promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(new URL("../../scripts/dogfood/queue.ts", import.meta.url).href)})`,
    ]),
  ).resolves.toMatchObject({ stdout: "", stderr: "" });
});
const main = "a".repeat(40);
const body =
  "\n## Decision\nPreserve the accepted outcome.\n\n## Done when\n- Observe an exact body.\n";
const proposal = (input: PlanningInput, level: PlanningLevel): PlanningProposal => ({
  schemaVersion: "planning-repair/v1",
  level,
  disposition: "REPLACED",
  reason: "The old work mixes observation and mutation; split their ownership.",
  approach: "Use a single immutable observation and a separate application boundary.",
  productQuestion: null,
  lineages: input.lineages.map((lineage) => ({
    key: lineage.key,
    body: `### recoveryHypothesis\nlastFailure: ${lineage.lastFailure}\npriorHypotheses: ${lineage.priorHypotheses.join("\n") || "none"}\nnewHypothesis: Observe immutable proposal bytes once before a separate application boundary.\nlevel: ${level}\n`,
  })),
  coverage: (level === "ISSUE" ? [input.lineages[0]!.key] : input.siblings).map((key) => ({
    key,
    findingsResponse: `Preserve ${key}'s accepted work and separate observation from its application.`,
  })),
  briefs: [
    {
      key: "NEW-001",
      body,
      dependencies: [],
      g0: "No. One observation is the smallest viable boundary.",
      notBuilt: ["No application or readmission."],
      dontRebuild: [
        {
          main: input.main,
          path: "existing.ts",
          evidence: "Current main and completed sibling already own application.",
        },
      ],
      constraints: ["Keep every terminal bound to exact bytes."],
      salvage: {
        branch: input.branch,
        head: input.head,
        reuse: [],
        forbidden: ["Never import a prior verdict or mutation."],
      },
      participants: [],
    },
  ],
});
async function fixture(level: PlanningLevel = "ISSUE") {
  const directory = await mkdtemp(resolve(tmpdir(), "planning-repair-"));
  roots.push(directory);
  const source: Config = {
    owner: "fixture",
    run: "planning-test",
    issue: "https://github.com/fixture/repo/issues/1",
    repository: "fixture/repo",
    base: main,
    pilotRevision: main,
    worktree: resolve(directory, "implementation"),
    reviewWorktree: resolve(directory, "review"),
    stateDirectory: resolve(directory, "source"),
    allowedPaths: ["."],
    requiredChecks: ["bootstrap"],
    adapter: { kind: "codex-exec", executable: process.execPath },
    author: {
      model: "gpt-6-astra",
      effort: "high",
      prompt: "implementation",
      ladder: [
        { model: "gpt-6-astra", effort: "high" },
        { model: "gpt-6-astra", effort: "xhigh" },
      ],
    },
    reviewer: {
      model: "claude-opus-5-5",
      effort: "high",
      prompt: "review",
      ladder: [
        { model: "claude-opus-5-5", effort: "high" },
        { model: "gpt-6.1-sol", effort: "high" },
      ],
    },
  };
  const input: PlanningInput = {
    observationStart: "2026-10-10T00:00:00Z",
    observationEnd: "2026-10-10T00:00:01Z",
    main,
    outcome: {
      path: resolve(directory, "outcome.json"),
      sha256: "b".repeat(64),
      value: {
        defectClass: { ISSUE: "brief", SET: "slice", EPIC: "design" }[level],
        evidenceStatus: "established",
      },
    },
    authority: {
      context: { body },
      planning: null,
      issues: [
        {
          key: "ISS-001",
          number: 1,
          body,
          updatedAt: "2026-10-10T00:00:00Z",
          blockedBy: { nodes: [] },
        },
        { key: "ISS-002", number: 2, body },
      ],
    },
    evidence: [],
    siblings: ["ISS-001", "ISS-002"],
    lineages: [{ key: "ISS-001", lastFailure: "b".repeat(64), priorHypotheses: [] }],
    history: [],
    branch: "codex/failed",
    head: "c".repeat(40),
  };
  const history: QueueParticipant[] = [];
  let output = proposal(input, level);
  let status: Terminal["status"] = "passed";
  let reviewStatus: Terminal["status"] = "passed";
  let running = false;
  let reviewIdentity: string | undefined;
  let onReview: (() => Promise<void>) | undefined;
  const prompts: string[] = [];
  const calls: string[] = [];
  const operation: PlanningOperation = {
    directory,
    source,
    outcome: input.outcome,
    acquire: async () => {
      calls.push("authority");
      return structuredClone(input);
    },
    history: async () => history,
    terminal: async (role, attempt, terminal) => {
      if (history.some((row) => row.id === attempt.id)) return;
      history.push({
        ordinal: history.length + 1,
        id: attempt.id,
        item: "ISS-001:1",
        stage: "planning",
        role,
        outcome: terminal.status as "passed",
        placement: attempt.placement!,
        usage: {
          inputTokens: { status: "unavailable" },
          outputTokens: { status: "unavailable" },
          costUsd: { status: "unavailable" },
        },
      });
    },
    native: {
      preflight: async () => {},
      git: async () => {
        throw new Error("Planning cannot use product Git gates");
      },
      checks: async () => {
        throw new Error("No hosted acceptance");
      },
      launch: async (role, config, prompt) => {
        calls.push(`launch:${role}`);
        prompts.push(prompt);
        expect(config.purpose).toBe("planning");
        expect(config.worktree).not.toBe(source.worktree);
        expect(config.worktree).toBe(config.reviewWorktree);
        if (role === "author")
          await writeFile(
            resolve(config.worktree, "proposal.json"),
            JSON.stringify(output, null, 2),
          );
        const trace = resolve(config.stateDirectory, `${role}.jsonl`);
        await writeFile(trace, "retained native trace\n");
        return {
          id: role === "reviewer" && reviewIdentity ? reviewIdentity : randomUUID(),
          trace,
          pid: 123,
          launchedAt: 1,
        };
      },
      observe: async (role, config, attempt) => {
        if (running) return { id: attempt.id, status: "running" };
        if (role === "reviewer") await onReview?.();
        const result = role === "author" ? status : reviewStatus;
        return {
          id: attempt.id,
          head: config.base,
          status: result,
          summary:
            role === "author"
              ? ""
              : JSON.stringify({
                  run: config.run,
                  role,
                  head: config.base,
                  verdict: result === "failed" ? "FAIL" : "PASS",
                  findings:
                    result === "failed"
                      ? [
                          {
                            file: "proposal.json",
                            line: 1,
                            severity: "blocking",
                            text: "No changed work hypothesis. Escalate to SET.",
                          },
                        ]
                      : [],
                  g0: "No. One artifact satisfies every acceptance criterion.",
                  defect:
                    result === "failed"
                      ? {
                          defectClass: "brief",
                          explanation: "Same work, only new wording.",
                          rootCause: "unchanged-work",
                          evidenceStatus: "established",
                          evidence: ["proposal.json:1"],
                        }
                      : null,
                }),
        };
      },
    },
  };
  return {
    directory,
    operation,
    input,
    history,
    calls,
    prompts,
    setProposal: (next: PlanningProposal) => {
      output = next;
    },
    setStatus: (next: Terminal["status"]) => {
      status = next;
    },
    setReviewStatus: (next: Terminal["status"]) => {
      reviewStatus = next;
    },
    setRunning: (next: boolean) => {
      running = next;
    },
    setReviewIdentity: (id: string) => {
      reviewIdentity = id;
    },
    onReview: (callback: () => Promise<void>) => {
      onReview = callback;
    },
    read: async () =>
      JSON.parse(await readFile(resolve(directory, "planning-recovery.json"), "utf8")),
  };
}

it.each(["ISSUE", "SET", "EPIC"] as const)(
  "retains native %s proposal/review states and repeated exact PASS reads without application",
  async (level) => {
    const f = await fixture(level);
    f.setRunning(true);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect((await f.read()).state).toBe("pending-author");
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect(f.calls.filter((row) => row === "launch:author")).toHaveLength(1);
    f.setRunning(false);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
    expect((await f.read()).state).toBe("proposal");
    f.setRunning(true);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
    expect((await f.read()).state).toBe("pending-reviewer");
    f.setRunning(false);
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    const accepted = await snapshot(f.directory);
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    expect(await snapshot(f.directory)).toEqual(accepted);
    expect(f.history.map((row) => [row.role, row.stage])).toEqual([
      ["author", "planning"],
      ["reviewer", "planning"],
    ]);
    const saved = await f.read();
    expect(saved.proposal.bodies).toEqual([
      { key: "NEW-001", sha256: hash(body), dependencies: [] },
    ]);
    expect(saved.review.proposal).toBe(saved.proposal.digest);
    expect(f.prompts[1]).toContain(saved.proposal.digest);
    expect(f.prompts[1]).toContain("EVERY prior hypothesis");
    expect(f.calls.filter((row) => row.startsWith("launch:"))).toHaveLength(2);
  },
);

it.each(
  ["self", "chase-sets"].flatMap((adapter) =>
    (["ISSUE", "SET", "EPIC"] as const).map((level) => ({ adapter, level })),
  ),
)(
  "validates $adapter native proposal contracts at $level through planning dispatch",
  async ({ adapter, level }) => {
    const f = await fixture(level);
    const p = proposal(f.input, level);
    if (adapter === "self") {
      const draft = (key: string) =>
        `---\nkey: ${key}\ntitle: "Observe proposals"\nlabels: ["type:slice"]\nmilestone: "Planning"\nblocked_by: []\n---\n${body}`;
      f.input.outcome.value.repository = "todd-skelton/orchestration-platform";
      f.input.authority.planning = {
        roadmap: {
          schemaVersion: "orchestration-roadmap/v1",
          repository: f.input.outcome.value.repository,
          project: {
            id: "project",
            number: 1,
            title: "Delivery",
            url: "https://example.test/project",
          },
          milestones: [{ key: "M1", title: "Planning" }],
          issues: [
            { key: "ISS-001", file: "planning/drafts/ISS-001.md", milestone: "M1", blockedBy: [] },
          ],
        },
        issueDrafts: { "ISS-001": draft("ISS-001") },
      };
      p.briefs[0]!.key = "ISS-003";
      p.briefs[0]!.body = draft("ISS-003");
    } else {
      f.input.outcome.value.repository = "chase-sets/chase-sets";
      p.briefs[0]!.body = body.replace("## Done when", "## Acceptance");
    }
    f.setProposal(p);
    const before = JSON.stringify(f.input.authority);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    expect(JSON.stringify(f.input.authority)).toBe(before);
    expect((await f.read()).proposal.bodies[0].sha256).toBe(hash(p.briefs[0]!.body));
  },
);

it.each(["missing", "duplicate", "out-of-order", "empty", "same"])(
  "refuses %s recovery hypotheses before review",
  async (kind) => {
    const f = await fixture();
    const p = proposal(f.input, "ISSUE");
    const row = p.lineages[0]!;
    if (kind === "missing") row.body = "No hypothesis.";
    if (kind === "duplicate") row.body += row.body;
    if (kind === "out-of-order")
      row.body = row.body
        .replace("priorHypotheses:", "temporary:")
        .replace("newHypothesis:", "priorHypotheses:")
        .replace("temporary:", "newHypothesis:");
    if (kind === "empty") row.body = row.body.replace("priorHypotheses: none", "priorHypotheses:");
    if (kind === "same") {
      const hypothesis = recoveryHypothesis(row.body).newHypothesis;
      f.input.lineages[0]!.priorHypotheses = [hypothesis];
      row.body = row.body.replace("priorHypotheses: none", `priorHypotheses: ${hypothesis}`);
    }
    f.setProposal(p);
    expect((await planningStep(f.operation)).status).toBe("planning-rejected");
    expect(f.calls).not.toContain("launch:reviewer");
    expect((await f.read()).nextLevel).toBe("SET");
  },
);

it("keeps genuine new requirements out of precision repairs and bounds non-completion", async () => {
  const f = await fixture();
  const p = proposal(f.input, "ISSUE");
  p.disposition = "REPAIR_IN_PLACE";
  p.briefs[0]!.key = "ISS-001";
  expect(() => validateProposal(p, f.input, "ISSUE")).not.toThrow();
  p.briefs[0]!.body += "- Implement a new requirement.\n";
  expect(() => validateProposal(p, f.input, "ISSUE")).toThrow("planning-proposal-invalid");
  const epic = proposal(f.input, "EPIC");
  epic.disposition = "RECOMMEND_NOT_COMPLETING";
  epic.briefs = [];
  epic.productQuestion = "Does accepted product scope permit changing the ownership boundary?";
  expect(() => validateProposal(epic, f.input, "EPIC")).not.toThrow();
  epic.briefs = p.briefs;
  expect(() => validateProposal(epic, f.input, "EPIC")).toThrow();
});

it.each(
  (["ISSUE", "SET", "EPIC"] as const).flatMap((level) =>
    ["during-author", "before-review", "during-review", "after-PASS"].flatMap((when) =>
      ["dependencies", "main"].map((change) => ({ level, when, change })),
    ),
  ),
)(
  "re-derives $level at the same level after $change drift $when, retaining work and charges",
  async ({ level, when, change: field }) => {
    const f = await fixture(level);
    f.operation.source.inheritedWorkerRetry = true;
    if (when === "during-author") f.setRunning(true);
    await planningStep(f.operation);
    const change = () => {
      if (field === "dependencies")
        f.input.authority.issues[0].blockedBy.nodes.push({ number: 2, state: "OPEN" });
      else f.input.main = "d".repeat(40);
    };
    if (when === "during-author") {
      change();
      expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
      expect(f.history).toHaveLength(0);
      f.setRunning(false);
    } else if (when === "before-review") change();
    else if (when === "during-review") f.onReview(async () => change());
    else {
      expect((await planningStep(f.operation)).status).toBe("planning-accepted");
      change();
    }
    const old = await f.read();
    const drafts = await snapshot(old.workers[0].config.worktree);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    const pending = await f.read();
    expect(pending.state).toBe("pending-author");
    expect(pending.level).toBe(level);
    expect(pending.nextLevel).toBeUndefined();
    expect(pending.proposal).toBeUndefined();
    expect(pending.review).toBeUndefined();
    expect(pending.retryUsed).toBe(true);
    expect(pending.superseded).toHaveLength(1);
    expect(pending.superseded[0].input).toEqual(old.input);
    expect(pending.superseded[0].proposal).toEqual(old.proposal);
    expect(pending.input.main).toBe(f.input.main);
    expect(pending.workers.every((worker: any) => worker.terminal.status === "passed")).toBe(true);
    const history = structuredClone(f.history);
    expect(history).toHaveLength(["during-review", "after-PASS"].includes(when) ? 2 : 1);
    const workers = await Promise.all(
      pending.workers.map((worker: any) => snapshot(worker.config.stateDirectory)),
    );
    f.onReview(async () => {});
    f.setProposal(proposal(f.input, level));
    f.setRunning(true);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect(f.calls.filter((row) => row === "launch:author")).toHaveLength(2);
    const next = (await f.read()).workers.at(-1);
    expect(next.config.worktree).not.toBe(old.workers[0].config.worktree);
    expect(next.config.base).toBe(f.input.main);
    expect(next.config.author.rung).toBe(old.workers[0].config.author.rung);
    f.setRunning(false);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    const accepted = await snapshot(f.directory);
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    expect(await snapshot(f.directory)).toEqual(accepted);
    expect(await snapshot(old.workers[0].config.worktree)).toEqual(drafts);
    expect(
      await Promise.all(
        pending.workers.map((worker: any) => snapshot(worker.config.stateDirectory)),
      ),
    ).toEqual(workers);
    expect(f.history.slice(0, history.length)).toEqual(history);
    expect(f.history.slice(history.length).map((row) => row.role)).toEqual(["author", "reviewer"]);
    expect((await f.read()).proposal.author).toBe(next.attempt.id);
  },
);

it("the exact-body negative control changes only proposal bytes after PASS", async () => {
  const f = await fixture();
  await planningStep(f.operation);
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  const path = resolve(f.directory, "planning-drafts/proposal.json");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace("Observe an exact body.", "Accept any body."),
  );
  expect((await planningStep(f.operation)).status).toBe("planning-rejected");
  expect((await f.read()).diagnostic).toContain("invalidate review");
  expect(f.calls.filter((row) => row.startsWith("launch:"))).toHaveLength(2);
});

it.each([
  "selected body",
  "selected update",
  "selected decision",
  "sibling",
  "epic",
  "epic child",
  "dependency",
  "transitive prerequisite",
  "dependent",
  "proposed dependency",
  "stopped lineage",
  "unrelated issue",
  "unrelated dependency consumer",
])("binds relevant authority after PASS: %s", async (change) => {
  const f = await fixture();
  const rows = f.input.authority.issues;
  for (let number = 3; number <= 12; number++)
    rows.push({ key: `ISS-${String(number).padStart(3, "0")}`, number, body });
  rows[0].parent = { number: 3 };
  rows[0].blockedBy.nodes = [{ number: 4, state: "OPEN" }];
  rows[0].blocking = { nodes: [{ number: 9, state: "OPEN" }] };
  rows[2].subIssues = { nodes: [{ number: 1 }, { number: 5 }] };
  rows[3].blockedBy = { nodes: [{ number: 7, state: "OPEN" }] };
  rows[3].blocking = { nodes: [{ number: 1 }, { number: 6 }] };
  rows[5].blockedBy = { nodes: [{ number: 4, state: "OPEN" }] };
  f.input.lineages.push({ key: "ISS-010", lastFailure: "prior-failure", priorHypotheses: [] });
  const p = proposal(f.input, "ISSUE");
  p.briefs[0]!.dependencies = ["ISS-008"];
  f.setProposal(p);
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  const accepted = await snapshot(f.directory);
  const index = {
    "selected body": 0,
    "selected update": 0,
    "selected decision": 0,
    sibling: 1,
    epic: 2,
    "epic child": 4,
    dependency: 3,
    "transitive prerequisite": 6,
    dependent: 8,
    "proposed dependency": 7,
    "stopped lineage": 9,
    "unrelated issue": 11,
    "unrelated dependency consumer": 5,
  }[change]!;
  if (change === "selected update") rows[index].updatedAt = "2026-10-10T01:00:00Z";
  else if (change === "selected body") rows[index].body += "Changed accepted decision.\n";
  else rows[index].comments = { nodes: [{ id: "decision", body: "New scope decision." }] };
  if (change.startsWith("unrelated")) {
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    expect(await snapshot(f.directory)).toEqual(accepted);
  } else {
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect((await f.read()).nextLevel).toBeUndefined();
  }
  expect(f.calls.filter((row) => row.startsWith("launch:"))).toHaveLength(2);
});

it("re-acquires changed sibling membership instead of accepting an earlier coverage set", async () => {
  const f = await fixture("SET");
  await planningStep(f.operation);
  await planningStep(f.operation);
  f.input.authority.issues.push({ key: "ISS-003", number: 3, body });
  f.input.siblings.push("ISS-003");
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  f.setProposal(proposal(f.input, "SET"));
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  expect(JSON.parse((await f.read()).proposal.raw).coverage.map((row: any) => row.key)).toEqual([
    "ISS-001",
    "ISS-002",
    "ISS-003",
  ]);
});

it("the self-review negative control changes only returned reviewer identity", async () => {
  const f = await fixture();
  await planningStep(f.operation);
  const id = (await f.read()).proposal.author;
  f.setReviewIdentity(id);
  await expect(planningStep(f.operation)).rejects.toMatchObject({
    reason: "planning-proposal-invalid",
    diagnostics: "Planning self-review prohibited.",
  });
  expect((await f.read()).state).not.toBe("accepted");
});

it("prefers unused independent reviewers, discloses history fallback, and refuses aliases of exact authors", async () => {
  const f = await fixture();
  const historical: QueueParticipant = {
    ordinal: 1,
    id: "earlier-opus",
    item: "ISS-002:1",
    stage: "source",
    role: "reviewer",
    outcome: "passed",
    placement: { model: "claude-opus-5", effort: "medium" },
    usage: {
      inputTokens: { status: "unavailable" },
      outputTokens: { status: "unavailable" },
      costUsd: { status: "unavailable" },
    },
  };
  const authors = [{ id: "author", model: "gpt-6-astra" }];
  expect(planningReviewers(f.operation.source, [historical], authors)[0]!.placement.model).toBe(
    "gpt-6.1-sol",
  );
  f.operation.source.reviewer.ladder = [{ model: "claude-opus-5-5", effort: "high" }];
  expect(planningReviewers(f.operation.source, [historical], authors)[0]!.prior).toBe(true);
  expect(
    planningReviewers(f.operation.source, [], [{ id: "repairer", model: "claude-opus-5" }]),
  ).toHaveLength(0);
  f.operation.source.reviewer.ladder = [{ model: "gpt-6-astra", effort: "xhigh" }];
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect(f.calls).not.toContain("launch:reviewer");
});

it("retains malformed/dead partial drafts and spends only the shared retry", async () => {
  const f = await fixture();
  f.setStatus("malformed");
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  const raw = await readFile(resolve(f.directory, "planning-drafts/proposal.json"), "utf8");
  f.operation.native.launch = async (role, config) => {
    expect(await readFile(resolve(config.worktree, "proposal.json"), "utf8")).toBe(raw);
    const trace = resolve(config.stateDirectory, "retry.jsonl");
    await writeFile(trace, "retry trace");
    return { id: randomUUID(), trace, pid: 123, launchedAt: 1 };
  };
  f.setStatus("dead");
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect(f.history.map((row) => row.outcome)).toEqual(["malformed", "dead"]);
  expect((await f.read()).retryUsed).toBe(true);
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect(f.history).toHaveLength(2);
});

it.each(["malformed", "dead"] as const)(
  "keeps the admitted reviewer placement for the shared %s retry",
  async (status) => {
    const f = await fixture();
    await planningStep(f.operation);
    f.setReviewStatus(status);
    await planningStep(f.operation);
    const first = f.history.find((row) => row.role === "reviewer")!;
    f.setReviewStatus("passed");
    expect((await planningStep(f.operation)).status).toBe("planning-accepted");
    const reviewers = f.history.filter((row) => row.role === "reviewer");
    expect(reviewers).toHaveLength(2);
    expect(reviewers[1]!.id).not.toBe(first.id);
    expect(reviewers[1]!.placement).toEqual(first.placement);
    expect((await f.read()).retryUsed).toBe(true);
  },
);

it("retains reviewer FAIL prescriptions and escalates without implementation repair", async () => {
  const f = await fixture("SET");
  f.setReviewStatus("failed");
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-rejected");
  const state = await f.read();
  expect(state.review.report.findings[0].text).toContain("No changed work hypothesis");
  expect(state.nextLevel).toBe("EPIC");
  expect((await planningStep(f.operation)).status).toBe("planning-rejected");
  expect(f.history).toHaveLength(2);
});

it("resumes pending input acquisition without losing the planning reservation", async () => {
  const f = await fixture();
  const acquire = f.operation.acquire;
  f.operation.acquire = async () => {
    throw new QueueBlocked("planning-context-unavailable");
  };
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect((await f.read()).state).toBe("pending-author");
  expect((await f.read()).input).toBeNull();
  expect(f.history).toHaveLength(0);
  f.operation.acquire = acquire;
  expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
});

it.each(["passed", "failed"] as const)(
  "charges an in-flight %s reviewer before re-deriving changed authority",
  async (status) => {
    const f = await fixture();
    await planningStep(f.operation);
    f.setRunning(true);
    await planningStep(f.operation);
    f.input.authority.issues[0].updatedAt = "2026-10-10T00:00:10Z";
    expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
    expect(f.history).toHaveLength(1);
    f.setReviewStatus(status);
    f.setRunning(false);
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect(f.history).toHaveLength(2);
    const saved = await f.read();
    expect(saved.workers.at(-1).terminal.status).toBe(status);
    expect(saved.superseded[0].review.report.verdict).toBe(status === "passed" ? "PASS" : "FAIL");
    expect(saved.nextLevel).toBeUndefined();
  },
);

it("finalizes a retained reviewer terminal after unavailable authority without a second reviewer", async () => {
  const f = await fixture();
  await planningStep(f.operation);
  const acquire = f.operation.acquire;
  f.onReview(async () => {
    f.operation.acquire = async () => {
      throw new QueueBlocked("planning-context-unavailable");
    };
  });
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect((await f.read()).workers.at(-1).terminal.status).toBe("passed");
  f.operation.acquire = acquire;
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  expect(f.calls.filter((row) => row === "launch:reviewer")).toHaveLength(1);
  expect(f.history).toHaveLength(2);
});

it("tries only admitted reviewer seats on native refusal, with a retained exhaustion blocker", async () => {
  const f = await fixture();
  await planningStep(f.operation);
  const placements: string[] = [];
  f.operation.native.launch = async (_role, config) => {
    placements.push(config.reviewer.model);
    throw new QueueBlocked("provider-model-refused");
  };
  expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
  expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect(placements).toEqual(["claude-opus-5-5", "gpt-6.1-sol"]);
  expect(f.history).toHaveLength(1); // probe refusals did not launch children
  expect((await f.read()).workers.filter((worker: any) => worker.refused)).toHaveLength(2);
});

it("uses native least-authority launcher arguments with no implementation workspace write root", async () => {
  const f = await fixture();
  await planningStep(f.operation);
  const config = (await f.read()).workers[0].config;
  const author = launchArguments(config, "author");
  const reviewer = launchArguments(config, "reviewer");
  expect(author).toContain("--skip-git-repo-check");
  expect(author).toContain("workspace-write");
  expect(reviewer).toContain("read-only");
  expect(author.join(" ")).not.toContain(f.operation.source.worktree);
  expect(reviewer).toContain("sandbox_workspace_write.writable_roots=[]");
});

it.each(["brief", "slice", "design"] as const)(
  "routes a native %s failure through production queue and supervised replay, preserving implementation",
  async (defectClass) => {
    const f = await sourceFailureFixture();
    roots.push(f.root);
    const observe = f.native.observe;
    const git = f.native.git;
    f.native.git = async (cwd, args) =>
      args[0] === "fetch"
        ? ""
        : args.some((arg) => arg.includes("refs/remotes/origin/main"))
          ? f.base
          : git(cwd, args);
    f.native.observe = async (role, config, attempt) =>
      config.purpose === "planning"
        ? { id: attempt.id, status: "running" }
        : {
            ...(await observe(role, config, attempt)),
            defect: {
              defectClass,
              explanation: "Observation and mutation are incorrectly coupled.",
              rootCause: "scope-coupling",
              evidenceStatus: "established",
              evidence: ["product.txt:1"],
            },
          };
    const launch = f.native.launch;
    f.native.launch = async (role, config, prompt) =>
      config.purpose === "planning"
        ? {
            id: randomUUID(),
            trace: resolve(config.stateDirectory, "planning.jsonl"),
            pid: 123,
            launchedAt: 1,
          }
        : launch(role, config, prompt);
    const authority = {
      context: {
        title: "Fixture",
        body,
        acceptanceCriteria: ["Observe an exact body."],
        rules: "Fixture",
      },
      planning: null,
      issues: [{ number: 110, body, updatedAt: "2026-10-10T00:00:00Z", milestone: null }],
    };
    f.policy.planningContext = async () => structuredClone(authority);
    const older = resolve(f.loop.stateRoot, "earlier-run", "fixture-110-attempt-1");
    await mkdir(older, { recursive: true });
    await writeFile(
      resolve(older, "attempt.json"),
      JSON.stringify({
        history: [
          {
            ordinal: 1,
            id: "older-author",
            item: "fixture-110:1",
            stage: "source",
            role: "author",
            outcome: "failed",
            placement: { model: "claude-opus-5", effort: "high" },
          },
        ],
      }),
    );
    const adapter = repositoryQueueAdapter(f.current.config, f.repository, {
      native: f.native,
      repository: f.policy,
      gitExecutable: f.loop.gitExecutable,
    });
    // Retain the existing real setup fixture; the production queue/native flow
    // supplies the failure classification and planning dispatch boundary.
    adapter.setup = f.current.adapter.setup;
    const result = await queueStep(f.current.config, adapter);
    expect(result.status).toBe("observing-planning-author");
    const path = resolve(f.current.config.stateDirectory, "planning-recovery.json");
    expect(JSON.parse(await readFile(path, "utf8")).level).toBe(
      { brief: "ISSUE", slice: "SET", design: "EPIC" }[defectClass],
    );
    expect(
      JSON.parse(await readFile(path, "utf8")).input.history.some(
        (row: any) => row.id === "older-author",
      ),
    ).toBe(true);
    expect((await adapter.history()).some((row) => row.id === "older-author")).toBe(false);
    expect(await retainedSourceFailure(f.loop, f.cycle.selection)).toBeUndefined();
    expect((await f.advance())!.selection).toEqual(f.cycle.selection);
    const reconstructed = await f.compose(f.cycle);
    reconstructed.adapter.planning = adapter.planning!;
    expect((await queueStep(reconstructed.config, reconstructed.adapter)).status).toBe(
      "observing-planning-author",
    );
    const implementation = await readFile(
      resolve(f.current.config.stateDirectory, "attempt.json"),
      "utf8",
    );
    f.native.observe = async (role, config, attempt) => {
      expect(config.purpose).toBe("planning");
      const recovery = JSON.parse(await readFile(path, "utf8"));
      if (role === "author")
        await writeFile(
          resolve(config.worktree, "proposal.json"),
          JSON.stringify(proposal(recovery.input, recovery.level), null, 2),
        );
      return {
        id: attempt.id,
        status: "passed",
        head: config.base,
        ...(role === "reviewer"
          ? {
              summary: JSON.stringify({
                run: config.run,
                role,
                head: config.base,
                verdict: "PASS",
                findings: [],
                g0: "No. Separate proposal and application ownership is required.",
                defect: null,
              }),
            }
          : {}),
      };
    };
    expect((await queueStep(reconstructed.config, reconstructed.adapter)).status).toBe(
      "observing-planning-reviewer",
    );
    expect((await queueStep(reconstructed.config, reconstructed.adapter)).status).toBe(
      "planning-accepted",
    );
    const accepted = await snapshot(f.current.config.stateDirectory);
    expect((await queueStep(reconstructed.config, reconstructed.adapter)).status).toBe(
      "planning-accepted",
    );
    expect(await snapshot(f.current.config.stateDirectory)).toEqual(accepted);
    expect(await readFile(resolve(f.current.config.stateDirectory, "attempt.json"), "utf8")).toBe(
      implementation,
    );
    expect((await adapter.history()).filter((row) => row.stage === "planning")).toHaveLength(2);
    authority.issues[0]!.updatedAt = "2026-10-10T01:00:00Z";
    expect((await queueStep(reconstructed.config, reconstructed.adapter)).status).toBe(
      "observing-planning-author",
    );
    const pending = JSON.parse(await readFile(path, "utf8"));
    expect(pending.level).toBe({ brief: "ISSUE", slice: "SET", design: "EPIC" }[defectClass]);
    expect(pending.nextLevel).toBeUndefined();
    expect(pending.input.evidence.some((row: any) => row.path === path)).toBe(false);
    const resumed = await f.compose(f.cycle);
    resumed.adapter.planning = adapter.planning!;
    expect((await queueStep(resumed.config, resumed.adapter)).status).toBe(
      "observing-planning-reviewer",
    );
    expect((await queueStep(resumed.config, resumed.adapter)).status).toBe("planning-accepted");
    expect((await queueStep(resumed.config, resumed.adapter)).status).toBe("planning-accepted");
    expect((await adapter.history()).filter((row) => row.stage === "planning")).toHaveLength(4);
    expect(await readFile(resolve(f.current.config.stateDirectory, "attempt.json"), "utf8")).toBe(
      implementation,
    );
    expect(f.calls.some((call) => /^(park|note|delivery):/.test(call))).toBe(false);
    expect(await f.git(f.current.config.items[0]!.source.worktree, ["status", "--porcelain"])).toBe(
      "",
    );
    expect((await readdir(f.runState)).some((name) => name.endsWith("-complete.json"))).toBe(false);
  },
);

it("collects paginated sibling decisions and refuses incomplete native lineage", async () => {
  const empty = { pageInfo: { hasNextPage: false }, nodes: [] };
  const issue = {
    number: 1,
    url: "https://github.com/fixture/repo/issues/1",
    title: "One",
    body,
    updatedAt: "2026-10-10T00:00:00Z",
    state: "OPEN",
    parent: null,
    subIssues: empty,
    blockedBy: empty,
    blocking: empty,
    comments: {
      pageInfo: { hasNextPage: true, endCursor: "comments-1" },
      nodes: [{ id: "first", body: "first decision" }],
    },
  };
  const calls: string[][] = [];
  const request = async (args: string[]) => {
    calls.push(args);
    if (args.includes("number=1"))
      return {
        data: {
          repository: {
            issue: {
              comments: {
                pageInfo: { hasNextPage: false },
                nodes: [{ id: "last", body: "latest decision" }],
              },
            },
          },
        },
      };
    return {
      data: {
        repository: {
          issues: { pageInfo: { hasNextPage: false }, nodes: [structuredClone(issue)] },
        },
      },
    };
  };
  const rows = await planningAuthority("fixture/repo", request);
  expect(rows[0].comments.nodes.map((row: any) => row.id)).toEqual(["first", "last"]);
  expect(calls).toHaveLength(2);
  issue.parent = { number: 2 } as any;
  await expect(planningAuthority("fixture/repo", request)).rejects.toThrow(
    "incomplete planning lineage",
  );
});

it("resumes the failure-to-planning gap without parking or creating an implementation attempt", async () => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  const observe = f.native.observe;
  f.native.observe = async (role, config, attempt) => ({
    ...(await observe(role, config, attempt)),
    defect: {
      defectClass: "brief",
      explanation: "The accepted scope has ambiguous ownership.",
      rootCause: "ambiguous-scope",
      evidenceStatus: "established",
      evidence: ["product.txt:1"],
    },
  });
  // Simulate interruption after native failure persistence, before the queue's
  // planning hook. Supervision and composition must rediscover the classification.
  delete f.current.adapter.planning;
  await f.fail();
  const original = await snapshot(f.current.config.items[0]!.source.stateDirectory);
  expect(await retainedSourceFailure(f.loop, f.cycle.selection)).toBeUndefined();
  const next = await f.advance();
  expect(next!.selection).toEqual(f.cycle.selection);
  const resumed = await f.compose(next!);
  expect(resumed.config.items[0]!.implementationAttempt).toBe(1);
  expect(await snapshot(f.current.config.items[0]!.source.stateDirectory)).toEqual(original);
  expect(f.calls.some((call) => /^(park|note|delivery):/.test(call))).toBe(false);
  expect((await readdir(f.runState)).some((name) => name.endsWith("-attempt-2"))).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "both production adapter readers scope authority and re-derive through fake GitHub",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "planning-adapters-"));
    roots.push(root);
    const queryLog = resolve(root, "queries.jsonl");
    const response = resolve(root, "issues.json");
    const empty = { pageInfo: { hasNextPage: false }, nodes: [] };
    const rows: any[] = [
      {
        number: 756,
        url: "https://github.com/todd-skelton/orchestration-platform/issues/756",
        title: "Plan",
        body:
          '<!-- planning-key: ISS-237 -->\n<!-- routing: {"version":1,"row":2,"review":11} -->\n' +
          body,
        updatedAt: "2026-10-10T00:00:00Z",
        state: "OPEN",
        parent: null,
        milestone: { number: 1 },
        labels: empty,
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: [{ id: "decision", body: "Keep publication host-owned." }],
        },
        subIssues: empty,
        blockedBy: empty,
        blocking: empty,
      },
    ];
    rows.push(
      {
        ...structuredClone(rows[0]),
        number: 999,
        body: "<!-- planning-key: ISS-999 -->\nUnrelated issue.",
        milestone: { number: 2 },
        blockedBy: { ...empty, nodes: [{ number: 755, state: "OPEN" }] },
      },
      {
        ...structuredClone(rows[0]),
        number: 755,
        body: "<!-- planning-key: ISS-236 -->\nRetained dependency.",
        milestone: { number: 2 },
        blocking: { ...empty, nodes: [{ number: 756 }, { number: 999 }] },
      },
    );
    await writeFile(response, JSON.stringify(rows));
    await writeFile(
      resolve(root, "gh"),
      `#!${process.execPath}
const fs=require('fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(queryLog)},JSON.stringify(args)+'\\n');
const rows=JSON.parse(fs.readFileSync(${JSON.stringify(response)},'utf8'));
const q=args.find(a=>a.startsWith('query='));
if(!q||args[0]!=='api')process.exit(4);
fs.writeFileSync(1,JSON.stringify({data:{repository:q.includes('issues(first:')?{issues:{pageInfo:{hasNextPage:false},nodes:rows}}:{issue:rows[0]}}}));
`,
    );
    await chmod(resolve(root, "gh"), 0o755);
    vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH ?? ""}`);
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const head = (
      await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
    ).stdout.trim();
    const selfContext = await self.planningContext({
      repository: "todd-skelton/orchestration-platform",
      key: "ISS-237",
      number: 756,
      main: head,
      executorRoot: repositoryRoot,
      gitExecutable: "git",
    });
    expect(selfContext.planning.issueDrafts["ISS-237"]).toContain(
      "Author and independently review bounded planning repairs",
    );
    expect(selfContext.issues.find((row: any) => row.number === 756).updatedAt).toBe(
      rows[0]!.updatedAt,
    );
    await mkdir(resolve(root, ".agents/skills/delivery"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/delivery/SKILL.md"), "Synthetic delivery skill.");
    await writeFile(resolve(root, "AGENTS.md"), "Synthetic product rules.");
    const chaseContext = await chase.planningContext({
      repository: "chase-sets/chase-sets",
      key: "cs-756",
      number: 756,
      main: head,
      executorRoot: root,
      gitExecutable: "git",
    });
    expect(chaseContext.issues.find((row: any) => row.number === 756).comments.nodes[0].body).toBe(
      "Keep publication host-owned.",
    );
    expect(chaseContext.context.body).toBe(rows[0]!.body);
    expect((await readFile(queryLog, "utf8")).trim().split("\n")).toHaveLength(3);
    for (const adapter of ["self", "chase-sets"] as const) {
      const f = await fixture();
      const isSelf = adapter === "self";
      const repository = isSelf ? "todd-skelton/orchestration-platform" : "chase-sets/chase-sets";
      const key = isSelf ? "ISS-237" : "cs-756";
      // Self dependencies come from immutable planning; product dependencies
      // come from GitHub. The common prerequisite also has an unrelated consumer.
      rows[0].blockedBy = { ...empty, nodes: isSelf ? [] : [{ number: 755, state: "OPEN" }] };
      await writeFile(response, JSON.stringify(rows));
      f.input.main = head;
      f.input.outcome.value.repository = repository;
      f.input.lineages[0]!.key = key;
      f.input.siblings = [key];
      f.operation.acquire = async () => {
        const authority = await (isSelf ? self : chase).planningContext({
          repository,
          key,
          number: 756,
          main: head,
          executorRoot: isSelf ? repositoryRoot : root,
          gitExecutable: "git",
        });
        authority.issues = authority.issues.map((row: any) => ({
          ...row,
          key: isSelf ? /planning-key: (ISS-\d+)/.exec(row.body)![1] : `cs-${row.number}`,
        }));
        return { ...structuredClone(f.input), authority };
      };
      const p = proposal(f.input, "ISSUE");
      p.disposition = "RECOMMEND_NOT_COMPLETING";
      p.briefs = [];
      f.setProposal(p);
      const unrelatedEdit = async () => {
        rows[1].body += "\nUnrelated edit.";
        rows[1].updatedAt = new Date(Date.parse(rows[1].updatedAt) + 1000).toISOString();
        rows[1].comments.nodes.push({ id: "unrelated", body: "Unrelated comment." });
        rows[1].labels = { ...empty, nodes: [{ name: "ready" }] };
        await writeFile(response, JSON.stringify(rows));
      };
      f.setRunning(true);
      expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
      await unrelatedEdit();
      f.setRunning(false);
      expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
      await unrelatedEdit();
      f.onReview(unrelatedEdit);
      expect((await planningStep(f.operation)).status).toBe("planning-accepted");
      const accepted = await snapshot(f.directory);
      for (let read = 0; read < 2; read++) {
        await unrelatedEdit();
        expect((await planningStep(f.operation)).status).toBe("planning-accepted");
        expect(await snapshot(f.directory)).toEqual(accepted);
      }
      expect(f.history).toHaveLength(2);
      rows[2].comments.nodes.push({ id: "changed-decision", body: "Change dependency ownership." });
      await writeFile(response, JSON.stringify(rows));
      expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
      expect((await f.read()).nextLevel).toBeUndefined();
      expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
      expect((await planningStep(f.operation)).status).toBe("planning-accepted");
      expect(f.history).toHaveLength(4);
    }
  },
);

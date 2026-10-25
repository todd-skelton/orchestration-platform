import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  externalIdentity,
  HOST_PLANNING_REVIEW_KEYS,
  planningHistoryDigest,
  planningStep,
  planningReviewers,
  recoveryHypothesis,
  validateProposal,
  type HostPlanningReview,
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
  type QueueConfig,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import { startCycle, stopCycle } from "../../scripts/dogfood/supervision.js";
import { QueueBlocked, type Config, type Terminal } from "../../scripts/dogfood/flow.js";
import { repairFailureFixture, sourceFailureFixture, snapshot } from "./fixtures/source-failure.js";
import { iss268BaselinePlanningContext } from "../fixtures/iss268.js";
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
const planningContextSource = resolve(
  import.meta.dirname,
  "../../scripts/dogfood/planning-context.mjs",
);
const iss268RealShapeProbe = Object.freeze({
  label: "host-captured-real-shape",
  path: "D:/Users/ToddS/Source/Repos/chase-sets/.orchestrator/logs/platform-iss268-plan-r2-probe.json",
  sha256: "1a96ced6606a62469c2d41baf522642e04ff50418bcb6d0b42a09469e24b723c",
});
async function planningAuthorityCopy(source: string, label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `planning-context-${label}-`));
  roots.push(root);
  const module = resolve(root, "planning-context.mjs");
  await mkdir(dirname(module), { recursive: true });
  await writeFile(module, source);
  return import(`${pathToFileURL(module).href}?${randomUUID()}`);
}
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

async function planningFamilyFixture() {
  const f = await fixture();
  const registryPath = resolve(f.directory, "model-registry.json");
  await writeFile(
    registryPath,
    await readFile(resolve(import.meta.dirname, "fixtures/model-registry.json"), "utf8"),
  );
  f.operation.source.modelRegistry = registryPath;
  f.operation.source.author = {
    family: "fable",
    effort: "high",
    prompt: "implementation",
    ladder: [{ family: "fable", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "opus",
    effort: "high",
    prompt: "review",
    ladder: [{ family: "opus", effort: "high" }],
  };
  const saveRegistry = async (mutate: (registry: any) => void) => {
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    mutate(registry);
    await writeFile(registryPath, JSON.stringify(registry));
  };
  return { ...f, registryPath, saveRegistry };
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

it("materializes planning family author and reviewer placements from the registry", async () => {
  const f = await fixture();
  f.operation.source.modelRegistry = resolve(import.meta.dirname, "fixtures/model-registry.json");
  f.operation.source.author = {
    family: "fable",
    effort: "high",
    prompt: "implementation",
    ladder: [{ family: "fable", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "opus",
    effort: "high",
    prompt: "review",
    ladder: [{ family: "opus", effort: "high" }],
  };
  const launched: { role: string; config: Config }[] = [];
  const launch = f.operation.native.launch;
  f.operation.native.launch = async (role, config, prompt) => {
    launched.push({ role, config: structuredClone(config) });
    return launch(role, config, prompt);
  };

  await planningStep(f.operation);
  await planningStep(f.operation);
  await planningStep(f.operation);

  expect(launched[0]!.config.author).toMatchObject({
    model: "claude-fable-5-1",
    family: "fable",
    generation: 7,
    authorityDigest: "synthetic-registry",
    rung: 0,
  });
  expect(launched[1]!.config.reviewer).toMatchObject({
    model: "claude-opus-5-5",
    family: "opus",
    generation: 7,
    authorityDigest: "synthetic-registry",
    rung: 0,
  });
  const state = await f.read();
  expect(state.workers[0]!.config.author).toMatchObject({ model: "claude-fable-5-1" });
  expect(state.workers[0]!.attempt).toMatchObject({
    placement: {
      model: "claude-fable-5-1",
      family: "fable",
      generation: 7,
      authorityDigest: "synthetic-registry",
    },
  });
});

const registryFailures = ["missing", "unreadable", "malformed"] as const;
async function breakRegistry(registryPath: string, kind: (typeof registryFailures)[number]) {
  if (kind === "missing") await rm(registryPath);
  else if (kind === "unreadable") {
    await rm(registryPath);
    await mkdir(registryPath);
  } else await writeFile(registryPath, JSON.stringify({ format: "model-registry/v1" }));
}

it.each(registryFailures)(
  "refuses a %s planning registry before saving an author intent",
  async (kind) => {
    const f = await planningFamilyFixture();
    await breakRegistry(f.registryPath, kind);
    await expect(planningStep(f.operation)).rejects.toMatchObject({
      reason: "model-registry-unavailable",
    });
    expect(f.calls).not.toContain("launch:author");
    expect(await f.read()).toMatchObject({ state: "pending-author", workers: [] });
    await expect(readdir(f.directory)).resolves.not.toContain("planning-worker-1");
  },
);

it.each(registryFailures)(
  "refuses a %s planning registry before saving a reviewer intent",
  async (kind) => {
    const f = await planningFamilyFixture();
    await planningStep(f.operation);
    expect(f.calls).toContain("launch:author");
    const recovery = resolve(f.directory, "planning-recovery.json");
    const before = await readFile(recovery, "utf8");
    await breakRegistry(f.registryPath, kind);
    await expect(planningStep(f.operation)).rejects.toMatchObject({
      reason: "model-registry-unavailable",
    });
    expect(f.calls).not.toContain("launch:reviewer");
    const state = await f.read();
    expect(state.state).toBe("proposal");
    expect(state.workers.map((worker: any) => worker.intent.role)).toEqual(["author"]);
    expect(f.history.map((row) => row.role)).toEqual(["author"]);
    await expect(readdir(f.directory)).resolves.not.toContain("planning-worker-2");
    expect(await readFile(recovery, "utf8")).toBe(before);
  },
);

it("refuses planning when every author family is unavailable without an intent or charge", async () => {
  const f = await planningFamilyFixture();
  await f.saveRegistry((registry) => {
    registry.families.fable.current = null;
  });
  let refused = 0;
  f.operation.native.authorRefused = async () => {
    refused++;
  };
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-pending-host-review",
    diagnostic: expect.stringContaining("provider-model-refused"),
  });
  const state = await f.read();
  expect(state.state).toBe("PENDING_HOST_REVIEW");
  expect(state.workers).toEqual([]);
  expect(refused).toBe(0);
  expect(f.calls).not.toContain("launch:author");
  expect(f.history).toHaveLength(0);
  await expect(readdir(f.directory)).resolves.not.toContain("planning-worker-1");
});

it.each(["null", "absent", "missing-current"] as const)(
  "skips an unavailable planning author family and advances to the next rung (%s)",
  async (kind) => {
    const f = await planningFamilyFixture();
    f.operation.source.author.ladder = [
      { family: "astra", effort: "high" },
      { family: "fable", effort: "high" },
    ];
    f.operation.source.author.family = "astra";
    f.operation.source.reviewer = {
      model: "claude-opus-5-5",
      effort: "high",
      prompt: "review",
      ladder: [{ model: "claude-opus-5-5", effort: "high" }],
    };
    await f.saveRegistry((registry) => {
      if (kind === "null") registry.families.astra.current = null;
      if (kind === "absent") delete registry.families.astra;
      if (kind === "missing-current") delete registry.families.astra.current;
    });
    let refused = 0;
    f.operation.native.authorRefused = async () => {
      refused++;
    };
    await expect(planningStep(f.operation)).resolves.toMatchObject({
      status: "observing-planning-reviewer",
    });
    const state = await f.read();
    expect(state.workers[0]!.config.author).toMatchObject({
      model: "claude-fable-5-1",
      family: "fable",
      rung: 1,
    });
    expect(state.workers[0]!.refused).toBeUndefined();
    expect(refused).toBe(0);
    expect(f.calls).toContain("launch:author");
  },
);

it("keeps a reviewer choice at its planning index when an earlier family is unavailable", async () => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "gpt-6-astra",
    effort: "high",
    prompt: "implementation",
    ladder: [{ model: "gpt-6-astra", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "fable",
    effort: "high",
    prompt: "review",
    ladder: [
      { family: "fable", effort: "high" },
      { family: "opus", effort: "high" },
    ],
  };
  await f.saveRegistry((registry) => {
    registry.families.fable.current = null;
  });
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-accepted",
  });
  const state = await f.read();
  expect(state.workers[1]!.config.reviewer).toMatchObject({
    model: "claude-opus-5-5",
    family: "opus",
    rung: 1,
  });
  expect(f.calls.filter((call) => call === "launch:reviewer")).toHaveLength(1);
});

it("refuses planning when every reviewer family is unavailable without an intent", async () => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "gpt-6-astra",
    effort: "high",
    prompt: "implementation",
    ladder: [{ model: "gpt-6-astra", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "fable",
    effort: "high",
    prompt: "review",
    ladder: [
      { family: "fable", effort: "high" },
      { family: "opus", effort: "high" },
    ],
  };
  await f.saveRegistry((registry) => {
    registry.families.fable.current = null;
    registry.families.opus.current = null;
  });
  await planningStep(f.operation);
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-pending-host-review",
  });
  const state = await f.read();
  expect(state.state).toBe("PENDING_HOST_REVIEW");
  expect(state.workers).toHaveLength(1);
  expect(state.workers.some((worker: any) => worker.intent.role === "reviewer")).toBe(false);
  expect(f.calls).not.toContain("launch:reviewer");
});

it("names reviewer non-independence before creating a planning reviewer intent", async () => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "claude-fable-5-1",
    effort: "high",
    prompt: "implementation",
  };
  f.operation.source.reviewer = {
    family: "fable",
    effort: "high",
    prompt: "review",
    ladder: [{ family: "fable", effort: "high" }],
  };
  await planningStep(f.operation);
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-pending-host-review",
    diagnostic: expect.stringContaining("routing-reviewer-not-independent"),
  });
  const state = await f.read();
  expect(state.workers).toHaveLength(1);
  expect(f.calls).not.toContain("launch:reviewer");
});

it.each(["malformed", "dead"] as const)(
  "advances a literal planning author ladder on the shared %s retry",
  async (status) => {
    const f = await fixture();
    f.setStatus(status);
    const launched: Config["author"][] = [];
    const launch = f.operation.native.launch;
    f.operation.native.launch = async (role, config, prompt) => {
      if (role === "author") launched.push(structuredClone(config.author));
      return launch(role, config, prompt);
    };
    expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
    expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
    expect(launched.map((row) => [row.model, row.effort, row.rung])).toEqual([
      ["gpt-6-astra", "high", 0],
      ["gpt-6-astra", "xhigh", 1],
    ]);
    const state = await f.read();
    expect(state.retryUsed).toBe(true);
    expect(state.workers[1]!.attempt.placement).toEqual({ model: "gpt-6-astra", effort: "xhigh" });
    expect(state.workers[1]!.attempt.rung).toBe(1);
  },
);

it.each(
  ["generation-change", "removed"].flatMap((change) =>
    ["malformed", "dead"].map((status) => ({ change, status })),
  ),
)(
  "retries a $status author family worker with its stored placement after the registry is $change",
  async ({ change, status }) => {
    const f = await planningFamilyFixture();
    f.setStatus(status as "malformed" | "dead");
    await planningStep(f.operation);
    const first = (await f.read()).workers[0]!.config.author;
    await f.saveRegistry((registry) => {
      if (change === "generation-change") {
        registry.generation = 8;
        registry.authorityDigest = "changed-registry";
        registry.families.fable.current = "changed-fable";
      } else {
        delete registry.families.fable;
      }
    });
    await expect(planningStep(f.operation)).resolves.toMatchObject({
      status: "planning-pending-host-review",
    });
    const state = await f.read();
    expect(state.workers[1]!.config.author).toMatchObject(first);
    expect(f.calls.filter((call) => call === "launch:author")).toHaveLength(2);
  },
);

it.each(
  ["generation-change", "removed"].flatMap((change) =>
    ["malformed", "dead"].map((status) => ({ change, status })),
  ),
)(
  "retries a $status reviewer family worker with its stored placement after the registry is $change",
  async ({ change, status }) => {
    const f = await planningFamilyFixture();
    f.setReviewStatus(status as "malformed" | "dead");
    await planningStep(f.operation);
    await planningStep(f.operation);
    const first = (await f.read()).workers[1]!.config.reviewer;
    await f.saveRegistry((registry) => {
      if (change === "generation-change") {
        registry.generation = 8;
        registry.authorityDigest = "changed-registry";
        registry.families.opus.current = "changed-opus";
      } else {
        delete registry.families.opus;
      }
    });
    await expect(planningStep(f.operation)).resolves.toMatchObject({
      status: "planning-pending-host-review",
    });
    const state = await f.read();
    expect(state.workers[2]!.config.reviewer).toMatchObject(first);
    expect(f.calls.filter((call) => call === "launch:reviewer")).toHaveLength(2);
  },
);

it("excludes a probe-refused family reviewer and selects the next planning choice", async () => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "gpt-6-astra",
    effort: "high",
    prompt: "implementation",
    ladder: [{ model: "gpt-6-astra", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "opus",
    effort: "high",
    prompt: "review",
    ladder: [
      { family: "opus", effort: "high" },
      { family: "sol", effort: "high" },
    ],
  };
  const launch = f.operation.native.launch;
  let refused = true;
  f.operation.native.launch = async (role, config, prompt) => {
    if (role === "reviewer" && refused) {
      refused = false;
      throw new QueueBlocked("provider-model-refused", "synthetic probe refusal");
    }
    return launch(role, config, prompt);
  };
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "observing-planning-reviewer",
  });
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-accepted",
  });
  const state = await f.read();
  expect(state.workers[1]!.refused).toBe(true);
  expect(state.workers[2]!.config.reviewer).toMatchObject({
    model: "gpt-6.1-sol",
    family: "sol",
    rung: 1,
  });
  expect(f.calls.filter((call) => call === "launch:reviewer")).toHaveLength(1);
});

const planningParticipant = (
  id: string,
  model: string,
  role: "author" | "reviewer" = "reviewer",
): QueueParticipant => ({
  ordinal: 1,
  id,
  item: "ISS-002:1",
  stage: "source",
  role,
  outcome: "passed",
  placement: { model, effort: "medium" },
  usage: {
    inputTokens: { status: "unavailable" },
    outputTokens: { status: "unavailable" },
    costUsd: { status: "unavailable" },
  },
});

it("filters a family reviewer choice that aliases an in-body repairer before any intent", async () => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "gpt-6-astra",
    effort: "high",
    prompt: "implementation",
    ladder: [{ model: "gpt-6-astra", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "opus",
    effort: "high",
    prompt: "review",
    ladder: [
      { family: "opus", effort: "high" },
      { family: "sol", effort: "high" },
    ],
  };
  f.history.push(planningParticipant("repairer", "claude-opus-5", "author"));
  const output = proposal(f.input, "ISSUE");
  output.briefs[0]!.participants = [{ id: "repairer", model: "claude-opus-5" }];
  f.setProposal(output);
  const launched: { role: string; config: Config }[] = [];
  const launch = f.operation.native.launch;
  f.operation.native.launch = async (role, config, prompt) => {
    launched.push({ role, config: structuredClone(config) });
    return launch(role, config, prompt);
  };
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-accepted",
  });
  expect(launched.map((row) => row.role)).toEqual(["author", "reviewer"]);
  expect(launched[1]!.config.reviewer).toMatchObject({
    model: "gpt-6.1-sol",
    family: "sol",
    generation: 7,
    rung: 1,
  });
  const state = await f.read();
  expect(state.workers).toHaveLength(2);
  expect(state.workers[1]!.config.reviewer.model).toBe("gpt-6.1-sol");
  expect(f.prompts[1]).toContain(
    "Full-history independent reviewer selected, including unused author rungs.",
  );
});

it.each([
  {
    label: "history",
    prepare: (f: Awaited<ReturnType<typeof planningFamilyFixture>>) => {
      f.history.push(planningParticipant("earlier-opus", "claude-opus-5-5"));
    },
  },
  {
    label: "a reserved literal author rung",
    prepare: (f: Awaited<ReturnType<typeof planningFamilyFixture>>) => {
      f.operation.source.author.ladder!.push({ model: "claude-opus-5", effort: "high" });
    },
  },
  {
    label: "a reserved family author rung against a literal reviewer ladder",
    prepare: (f: Awaited<ReturnType<typeof planningFamilyFixture>>) => {
      f.operation.source.author.ladder!.push({ family: "opus", effort: "high" });
      f.operation.source.reviewer = {
        model: "claude-opus-5",
        effort: "high",
        prompt: "review",
        ladder: [
          { model: "claude-opus-5", effort: "high" },
          { model: "gpt-6.1-sol", effort: "high" },
        ],
      };
    },
  },
])("deprioritizes a family reviewer choice that aliases $label", async ({ prepare }) => {
  const f = await planningFamilyFixture();
  f.operation.source.author = {
    model: "gpt-6-astra",
    effort: "high",
    prompt: "implementation",
    ladder: [{ model: "gpt-6-astra", effort: "high" }],
  };
  f.operation.source.reviewer = {
    family: "opus",
    effort: "high",
    prompt: "review",
    ladder: [
      { family: "opus", effort: "high" },
      { family: "sol", effort: "high" },
    ],
  };
  prepare(f);
  const launched: { role: string; config: Config }[] = [];
  const launch = f.operation.native.launch;
  f.operation.native.launch = async (role, config, prompt) => {
    launched.push({ role, config: structuredClone(config) });
    return launch(role, config, prompt);
  };
  await planningStep(f.operation);
  await expect(planningStep(f.operation)).resolves.toMatchObject({
    status: "planning-accepted",
  });
  expect(launched.map((row) => row.role)).toEqual(["author", "reviewer"]);
  expect(launched[1]!.config.reviewer).toMatchObject({ model: "gpt-6.1-sol", rung: 1 });
  const state = await f.read();
  expect(state.workers).toHaveLength(2);
  expect(state.workers[1]!.config.reviewer.model).toBe("gpt-6.1-sol");
  expect(f.prompts[1]).toContain(
    "Full-history independent reviewer selected, including unused author rungs.",
  );
});

it("keeps a completed family planning state inert when the registry disappears", async () => {
  const f = await planningFamilyFixture();
  await planningStep(f.operation);
  await planningStep(f.operation);
  await planningStep(f.operation);
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  await rm(f.registryPath);
  const before = await snapshot(f.directory);
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  expect(await snapshot(f.directory)).toEqual(before);
  expect(f.calls.filter((call) => call.startsWith("launch:")).length).toBe(2);
});

// ISS-270: the retained m1-iss259-20261020-r3/iss-267-attempt-3 shape. Two
// pre-ISS-269 family-only fable/high rung-2 authors died with no model, the
// shared mechanical retry is spent and the recovery waits in PENDING_HOST_REVIEW.
const retainedMain = "445b98b772edb4d66326cf6e47fc1ad1c44c4755";
const movedMain = "53e6ba495ded641e5b1395ab501b1b63d35dcd67";
const deadSummary =
  '{"error":{"code":"model_not_found","message":"unknown provider for model null","param":"model","type":"invalid_request_error"}}';
const fileHash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const jsonDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function hostReviewFixture(options: { currentMain?: string; retryUsed?: boolean } = {}) {
  const f = await planningFamilyFixture();
  f.operation.issueKey = "ISS-001";
  f.operation.source.author = {
    family: "fable",
    effort: "high",
    rung: 2,
    prompt: "implementation",
    ladder: [
      { family: "astra", effort: "high" },
      { family: "astra", effort: "xhigh" },
      { family: "fable", effort: "high" },
    ],
  };
  const retainedInput: PlanningInput = structuredClone({ ...f.input, main: retainedMain });
  const workspace = resolve(f.directory, "planning-drafts");
  await mkdir(resolve(workspace, "author-temp"), { recursive: true });
  const deadIds = ["1ecc51d3-60a5-4bd8-9dfc-c500227d2e5d", "098e5fc7-e48b-45a0-bbc2-05e122ea45e6"];
  const workers = [];
  for (const [index, id] of deadIds.entries()) {
    const stateDirectory = resolve(f.directory, `planning-worker-${index + 1}`);
    await mkdir(stateDirectory, { recursive: true });
    const attempt = {
      id,
      pid: 2759372 + index,
      trace: resolve(stateDirectory, `author-${id}.jsonl`),
      launchedAt: 1792820968206 + index,
      placement: { model: "fable", effort: "high" },
      rung: 2,
      models: { author: "fable", reviewer: null },
    };
    const terminal = { id, status: "dead", summary: deadSummary };
    await writeFile(
      resolve(stateDirectory, "author-attempt.json"),
      JSON.stringify(attempt, null, 2) + "\n",
    );
    await writeFile(
      resolve(stateDirectory, "author-terminal.json"),
      JSON.stringify(terminal, null, 2) + "\n",
    );
    workers.push({
      config: {
        ...f.operation.source,
        purpose: "planning",
        base: retainedMain,
        worktree: workspace,
        reviewWorktree: workspace,
        stateDirectory,
        allowedPaths: ["proposal.json"],
        author: { ...f.operation.source.author, prompt: "planning" },
        reviewer: { ...f.operation.source.reviewer, prompt: "planning" },
      },
      intent: { role: "author", input: jsonDigest(retainedInput), proposal: null },
      attempt,
      terminal,
    });
    f.history.push({
      ordinal: f.history.length + 1,
      id,
      item: "ISS-001:1",
      stage: "planning",
      role: "author",
      outcome: "dead",
      placement: { model: "fable", effort: "high" },
      rung: 2,
      usage: {
        inputTokens: { status: "unavailable" },
        outputTokens: { status: "unavailable" },
        costUsd: { status: "unavailable" },
      },
    });
  }
  const recoveryPath = resolve(f.directory, "planning-recovery.json");
  const recovery = {
    schemaVersion: "planning-recovery/v1",
    outcome: retainedInput.outcome,
    input: retainedInput,
    level: "ISSUE",
    state: "PENDING_HOST_REVIEW",
    workers,
    retryUsed: options.retryUsed ?? true,
    diagnostic:
      "PENDING_HOST_REVIEW: planning author dead; shared mechanical retry consumed. Partial drafts and charged native history retained.",
    nextLevel: "SET",
  };
  await writeFile(recoveryPath, JSON.stringify(recovery, null, 2) + "\n");
  // The immutable scheduler records the queue binds: the pinned selection and
  // the source configuration pinned for the failed implementation attempt.
  const selectionPath = resolve(f.directory, "cycle-8-selected.json");
  await writeFile(
    selectionPath,
    JSON.stringify(
      { cycle: 8, key: "ISS-001", number: 1, base: movedMain, planningRevision: movedMain },
      null,
      2,
    ) + "\n",
  );
  await mkdir(resolve(f.directory, "source"), { recursive: true });
  const configPath = resolve(f.directory, "source", "config.json");
  await writeFile(configPath, JSON.stringify({ config: f.operation.source }, null, 2) + "\n");
  f.input.main = options.currentMain ?? retainedMain;
  f.setProposal(proposal(f.input, "ISSUE"));
  f.input.binding = {
    selectionSha256: await fileHash(selectionPath),
    configSha256: await fileHash(configPath),
    decisionSha256: hash(body),
  };
  const authorityUrl = "https://github.com/fixture/repo/issues/1#issuecomment-5900000001";
  const authorityBody = `Host planning review for ISS-001 in planning-test: verdict platform-m1-iss267-recovery-decision-r1 at main ${f.input.main}. Host-side planning lineage attested; decision level ISSUE.`;
  const authority = {
    id: "5900000001",
    url: authorityUrl,
    author: "todd-skelton",
    body: authorityBody,
    capturedAt: "2026-10-24T00:00:00.000Z",
  };
  f.operation.observeAuthority = async (url) => {
    f.calls.push(`observeAuthority:${url}`);
    return structuredClone(authority);
  };
  const grant = async (): Promise<HostPlanningReview> => {
    const current = JSON.parse(await readFile(recoveryPath, "utf8"));
    return {
      schemaVersion: "host-planning-review/v1",
      repository: "fixture/repo",
      issueKey: "ISS-001",
      issueUrl: "https://github.com/fixture/repo/issues/1",
      run: "planning-test",
      recoveryPath,
      recoverySha256: await fileHash(recoveryPath),
      selectionSha256: f.input.binding!.selectionSha256,
      configSha256: f.input.binding!.configSha256,
      main: f.input.main,
      deadAttempts: await Promise.all(
        current.workers
          .filter((worker: any) => ["dead", "malformed"].includes(worker.terminal?.status))
          .map(async (worker: any) => ({
            id: worker.attempt.id,
            status: worker.terminal.status,
            terminalSha256: await fileHash(
              resolve(worker.config.stateDirectory, "author-terminal.json"),
            ),
          })),
      ),
      outcomeSha256: retainedInput.outcome.sha256,
      externalIdentitySha256: externalIdentity(current.input, current.proposal),
      decisionSha256: hash(body),
      level: "ISSUE",
      historySha256: planningHistoryDigest(current, f.history),
      verdictIdentity: "platform-m1-iss267-recovery-decision-r1",
      consumptionIdentity: `host-planning-review-${current.consumedHostReviewIdentities?.length ?? 0}`,
      authorityUrl,
      authorityAuthor: "todd-skelton",
      authorityBodySha256: hash(authorityBody),
    };
  };
  const grantPath = resolve(f.directory, "host-planning-review.json");
  const writeGrant = async (value: unknown) => {
    await rm(grantPath, { force: true });
    // The host's single exclusive create.
    await writeFile(grantPath, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  };
  const launched: { role: string; config: Config }[] = [];
  const launch = f.operation.native.launch;
  f.operation.native.launch = async (role, config, prompt) => {
    launched.push({ role, config: structuredClone(config) });
    return launch(role, config, prompt);
  };
  const retained = async () =>
    new Map([...(await snapshot(f.directory))].filter(([file]) => file !== grantPath));
  return {
    ...f,
    recoveryPath,
    grantPath,
    grant,
    writeGrant,
    launched,
    authority,
    retainedInput,
    deadIds,
    retained,
    authorityBody,
  };
}
const materializedFable = {
  model: "claude-fable-5-1",
  family: "fable",
  effort: "high",
  generation: 7,
  authorityDigest: "synthetic-registry",
  rung: 2,
};

it("host planning review: a missing grant refuses host-verdict-missing without launch, write or authority read", async () => {
  const f = await hostReviewFixture({ currentMain: movedMain });
  const before = await f.retained();
  const result = await planningStep(f.operation);
  expect(result.status).toBe("planning-pending-host-review");
  expect(result.diagnostic).toMatch(/^host-verdict-missing: /);
  expect(result.diagnostic).toContain("shared mechanical retry consumed");
  expect(await f.retained()).toEqual(before);
  expect(f.launched).toEqual([]);
  expect(f.calls.filter((call) => call.startsWith("observeAuthority"))).toEqual([]);
  expect(f.history).toHaveLength(2);
});

const schemaNegatives: [string, (grant: any) => unknown][] = [
  ...HOST_PLANNING_REVIEW_KEYS.map((key): [string, (grant: any) => unknown] => [
    `missing ${key}`,
    (grant) => {
      delete grant[key];
      return grant;
    },
  ]),
  ["extra key", (grant) => ({ ...grant, note: "host" })],
  ["schemaVersion v2", (grant) => ({ ...grant, schemaVersion: "host-planning-review/v2" })],
  [
    "uppercase digest",
    (grant) => ({ ...grant, recoverySha256: grant.recoverySha256.toUpperCase() }),
  ],
  ["short main", (grant) => ({ ...grant, main: grant.main.slice(0, 39) })],
  ["unknown level", (grant) => ({ ...grant, level: "PRODUCT_QUESTION" })],
  ["empty deadAttempts", (grant) => ({ ...grant, deadAttempts: [] })],
  [
    "duplicate dead attempt id",
    (grant) => ({ ...grant, deadAttempts: [grant.deadAttempts[0], grant.deadAttempts[0]] }),
  ],
  [
    "dead attempt extra key",
    (grant) => ({ ...grant, deadAttempts: [{ ...grant.deadAttempts[0], trace: "x" }] }),
  ],
  [
    "dead attempt passed status",
    (grant) => ({ ...grant, deadAttempts: [{ ...grant.deadAttempts[0], status: "passed" }] }),
  ],
  ["relative recoveryPath", (grant) => ({ ...grant, recoveryPath: "planning-recovery.json" })],
  [
    "issueUrl outside repository",
    (grant) => ({ ...grant, issueUrl: "https://github.com/other/repo/issues/1" }),
  ],
  [
    "authorityUrl outside the owning issue",
    (grant) => ({
      ...grant,
      authorityUrl: "https://github.com/fixture/repo/issues/2#issuecomment-5900000001",
    }),
  ],
  ["authorityAuthor with spaces", (grant) => ({ ...grant, authorityAuthor: "todd skelton" })],
  ["array body", () => [1]],
  ["string body", () => "host-planning-review/v1"],
];
it.each(schemaNegatives)(
  "host planning review: one-variable schema negative (%s) refuses host-verdict-malformed before any evidence read",
  async (_label, mutate) => {
    const f = await hostReviewFixture({ currentMain: movedMain });
    await f.writeGrant(mutate(await f.grant()));
    const before = await f.retained();
    const result = await planningStep(f.operation);
    expect(result.status).toBe("planning-pending-host-review");
    expect(result.diagnostic).toMatch(/^host-verdict-malformed: /);
    expect(await f.retained()).toEqual(before);
    expect(f.launched).toEqual([]);
    expect(f.calls.filter((call) => /^(authority|observeAuthority)/.test(call))).toEqual([]);
  },
);

it("host planning review: non-JSON bytes are malformed and an unreadable grant is unavailable", async () => {
  const f = await hostReviewFixture({ currentMain: movedMain });
  await writeFile(f.grantPath, "{ not json\n");
  const before = await f.retained();
  expect((await planningStep(f.operation)).diagnostic).toMatch(/^host-verdict-malformed: /);
  await rm(f.grantPath);
  await mkdir(f.grantPath);
  expect((await planningStep(f.operation)).diagnostic).toMatch(/^host-verdict-unavailable: /);
  expect(await f.retained()).toEqual(before);
  expect(f.launched).toEqual([]);
});

const bindingNegatives: [
  string,
  string,
  (grant: HostPlanningReview, f: any) => HostPlanningReview,
][] = [
  ["stale main", "host-verdict-stale", (grant) => ({ ...grant, main: retainedMain })],
  [
    "recovery bytes",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, recoverySha256: "0".repeat(64) }),
  ],
  [
    "selection record",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, selectionSha256: "1".repeat(64) }),
  ],
  [
    "source config",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, configSha256: "2".repeat(64) }),
  ],
  [
    "decision body",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, decisionSha256: "3".repeat(64) }),
  ],
  ["outcome", "host-verdict-mismatch", (grant) => ({ ...grant, outcomeSha256: "4".repeat(64) })],
  [
    "external identity",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, externalIdentitySha256: "5".repeat(64) }),
  ],
  ["history", "host-verdict-mismatch", (grant) => ({ ...grant, historySha256: "6".repeat(64) })],
  ["level", "host-verdict-mismatch", (grant) => ({ ...grant, level: "SET" })],
  [
    "dead terminal bytes",
    "host-verdict-mismatch",
    (grant) => ({
      ...grant,
      deadAttempts: [
        { ...grant.deadAttempts[0]!, terminalSha256: "7".repeat(64) },
        grant.deadAttempts[1]!,
      ],
    }),
  ],
  [
    "one dead attempt only",
    "host-verdict-mismatch",
    (grant) => ({ ...grant, deadAttempts: [grant.deadAttempts[0]!] }),
  ],
  [
    "dead attempt status",
    "host-verdict-mismatch",
    (grant) => ({
      ...grant,
      deadAttempts: [
        { ...grant.deadAttempts[0]!, status: "malformed" as const },
        grant.deadAttempts[1]!,
      ],
    }),
  ],
  ["run", "host-verdict-mismatch", (grant) => ({ ...grant, run: "other-run" })],
  ["issue key", "host-verdict-mismatch", (grant) => ({ ...grant, issueKey: "ISS-002" })],
  [
    "recovery path",
    "host-verdict-mismatch",
    (grant, f) => ({ ...grant, recoveryPath: resolve(f.directory, "other.json") }),
  ],
];
it.each(bindingNegatives)(
  "host planning review: %s refuses %s before authority capture, without launch or write",
  async (_label, reason, mutate) => {
    const f = await hostReviewFixture({ currentMain: movedMain });
    await f.writeGrant(mutate(await f.grant(), f));
    const before = await f.retained();
    const result = await planningStep(f.operation);
    expect(result.status).toBe("planning-pending-host-review");
    expect(result.diagnostic?.startsWith(`${reason}: `)).toBe(true);
    expect(result.diagnostic).toContain("retained planning recovery is unchanged");
    expect(await f.retained()).toEqual(before);
    expect(f.launched).toEqual([]);
    // Retained bindings are checked before the authority comment is read.
    expect(f.calls.filter((call) => call.startsWith("observeAuthority"))).toEqual([]);
    expect(f.history).toHaveLength(2);
  },
);

it("host planning review: a changed selection or config record refuses mismatch even with matching bytes elsewhere", async () => {
  const f = await hostReviewFixture({ currentMain: movedMain });
  await f.writeGrant(await f.grant());
  const before = await f.retained();
  f.input.binding = { ...f.input.binding!, selectionSha256: hash("another selection") };
  expect((await planningStep(f.operation)).diagnostic).toMatch(
    /^host-verdict-mismatch: selectionSha256 differ/,
  );
  delete f.input.binding;
  expect((await planningStep(f.operation)).diagnostic).toMatch(
    /^host-verdict-mismatch: selectionSha256, configSha256, decisionSha256 differ/,
  );
  expect(await f.retained()).toEqual(before);
  expect(f.launched).toEqual([]);
});

const authorityNegatives: [string, string, (f: any) => Promise<void>][] = [
  [
    "another author",
    "host-verdict-forged",
    async (f) => {
      f.authority.author = "someone-else";
    },
  ],
  [
    "a different body",
    "host-verdict-forged",
    async (f) => {
      f.authority.body = `${f.authorityBody} (edited)`;
    },
  ],
  [
    "a different comment id",
    "host-verdict-forged",
    async (f) => {
      f.authority.id = "5900000002";
    },
  ],
  [
    "a different comment url",
    "host-verdict-forged",
    async (f) => {
      f.authority.url = "https://github.com/fixture/repo/issues/1#issuecomment-5900000002";
    },
  ],
  [
    "an unreadable comment",
    "host-verdict-authority-unavailable",
    async (f) => {
      f.operation.observeAuthority = async () => {
        throw new Error("gh: connection reset");
      };
    },
  ],
  [
    "unavailable planning authority",
    "host-verdict-authority-unavailable",
    async (f) => {
      f.operation.acquire = async () => {
        throw new QueueBlocked("planning-context-unavailable", "gh offline");
      };
    },
  ],
];
it.each(authorityNegatives)(
  "host planning review: %s refuses %s after retained bindings match, without launch or write",
  async (_label, reason, mutate) => {
    const f = await hostReviewFixture({ currentMain: movedMain });
    await f.writeGrant(await f.grant());
    await mutate(f);
    const before = await f.retained();
    const result = await planningStep(f.operation);
    expect(result.status).toBe("planning-pending-host-review");
    expect(result.diagnostic?.startsWith(`${reason}: `)).toBe(true);
    expect(await f.retained()).toEqual(before);
    expect(f.launched).toEqual([]);
    expect(f.history).toHaveLength(2);
  },
);

it("host planning review: consumes an exact grant once, re-derives at the grant main and launches the retained rung materialized", async () => {
  const f = await hostReviewFixture({ currentMain: movedMain });
  const grant = await f.grant();
  await f.writeGrant(grant);
  const beforeState = await f.read();
  const beforeFiles = await f.retained();
  const grantBytes = await readFile(f.grantPath);
  f.setRunning(true);
  const result = await planningStep(f.operation);
  expect(result.status).toBe("observing-planning-author");
  // Exactly one launch, at the granted (current) main, in a fresh workspace,
  // with the retained fable/high rung 2 resolved to a concrete model.
  expect(f.launched).toHaveLength(1);
  expect(f.launched[0]!.config.base).toBe(movedMain);
  expect(f.launched[0]!.config.worktree).toBe(resolve(f.directory, "planning-drafts-2"));
  expect(f.launched[0]!.config.author).toMatchObject(materializedFable);
  expect(f.calls.filter((call) => call.startsWith("observeAuthority"))).toEqual([
    `observeAuthority:${grant.authorityUrl}`,
  ]);
  const state = await f.read();
  expect(state.state).toBe("pending-author");
  expect(state.input.main).toBe(movedMain);
  expect(state.superseded).toHaveLength(1);
  expect(state.superseded[0]).toMatchObject({
    state: "PENDING_HOST_REVIEW",
    input: beforeState.input,
    diagnostic: beforeState.diagnostic,
  });
  expect(state.hostReview).toEqual({
    grantSha256: createHash("sha256").update(grantBytes).digest("hex"),
    consumptionIdentity: grant.consumptionIdentity,
    consumedAt: expect.any(String),
    retainedAuthor: f.deadIds[1],
    placement: materializedFable,
    authority: {
      id: f.authority.id,
      url: f.authority.url,
      author: f.authority.author,
      bodySha256: hash(f.authorityBody),
      capturedAt: f.authority.capturedAt,
    },
  });
  expect(state.consumedHostReviewIdentities).toEqual([grant.consumptionIdentity]);
  // Accounting and history: the retry stays spent, the level, outcome and both
  // dead workers are byte-identical, and the continuation appended one worker.
  expect(state.retryUsed).toBe(true);
  expect(state.level).toBe("ISSUE");
  expect(state.outcome).toEqual(beforeState.outcome);
  expect(state.nextLevel).toBeUndefined();
  expect(JSON.stringify(state.workers.slice(0, 2))).toBe(JSON.stringify(beforeState.workers));
  expect(state.workers).toHaveLength(3);
  expect(state.workers[2].config.author).toMatchObject(materializedFable);
  expect(state.workers[2].attempt).toMatchObject({
    placement: {
      model: "claude-fable-5-1",
      effort: "high",
      family: "fable",
      generation: 7,
      authorityDigest: "synthetic-registry",
    },
    rung: 2,
  });
  const after = await f.retained();
  for (const [file, bytes] of beforeFiles)
    if (file !== f.recoveryPath) expect(after.get(file), file).toBe(bytes);
  expect(await readFile(f.grantPath)).toEqual(grantBytes);
  // A second observation is inert: no second consumption, launch or charge.
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  expect(f.launched).toHaveLength(1);
  expect((await f.read()).hostReview).toEqual(state.hostReview);
  expect((await f.read()).consumedHostReviewIdentities).toEqual([grant.consumptionIdentity]);
  // The ordinary lifecycle continues from the granted base through review.
  f.setRunning(false);
  expect((await planningStep(f.operation)).status).toBe("observing-planning-reviewer");
  expect((await planningStep(f.operation)).status).toBe("planning-accepted");
  expect(f.history.map((row) => [row.role, row.outcome])).toEqual([
    ["author", "dead"],
    ["author", "dead"],
    ["author", "passed"],
    ["reviewer", "passed"],
  ]);
  expect(f.history[2]!.placement).toEqual({
    model: "claude-fable-5-1",
    effort: "high",
    family: "fable",
    generation: 7,
    authorityDigest: "synthetic-registry",
  });
  expect(f.launched).toHaveLength(2);
  expect(f.launched[1]!.config.reviewer).toMatchObject({
    model: "claude-opus-5-5",
    family: "opus",
  });
});

it("host planning review: a same-main grant keeps the retained workspace and still materializes the rung", async () => {
  const f = await hostReviewFixture();
  await f.writeGrant(await f.grant());
  f.setRunning(true);
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  expect(f.launched).toHaveLength(1);
  expect(f.launched[0]!.config.base).toBe(retainedMain);
  expect(f.launched[0]!.config.worktree).toBe(resolve(f.directory, "planning-drafts"));
  expect(f.launched[0]!.config.author).toMatchObject(materializedFable);
  const state = await f.read();
  expect(state.superseded).toBeUndefined();
  expect(state.input.main).toBe(retainedMain);
  expect(state.workers).toHaveLength(3);
  expect(state.workers[2].intent.role).toBe("author");
});

it.each(["refused", "missing"] as const)(
  "host planning review: a %s registry refuses before reservation; no intent, worker directory or launch exists",
  async (kind) => {
    const f = await hostReviewFixture({ currentMain: movedMain });
    await f.writeGrant(await f.grant());
    if (kind === "refused")
      await f.saveRegistry((registry) => {
        registry.families.fable.current = null;
      });
    else await rm(f.registryPath);
    const before = await f.retained();
    await expect(planningStep(f.operation)).rejects.toMatchObject({
      reason: kind === "refused" ? "provider-model-refused" : "model-registry-unavailable",
    });
    expect(await f.retained()).toEqual(before);
    expect((await f.read()).hostReview).toBeUndefined();
    expect(f.launched).toEqual([]);
    await expect(readdir(f.directory)).resolves.not.toContain("planning-worker-3");
    expect(f.history).toHaveLength(2);
  },
);

it("host planning review: a re-entered pending state refuses the spent grant as duplicate and admits a fresh grant without re-resolving", async () => {
  const f = await hostReviewFixture();
  const first = await f.grant();
  await f.writeGrant(first);
  f.setStatus("dead");
  expect((await planningStep(f.operation)).status).toBe("planning-pending-host-review");
  expect(f.launched).toHaveLength(1);
  expect(f.history.map((row) => row.outcome)).toEqual(["dead", "dead", "dead"]);
  const reentered = await f.read();
  expect(reentered).toMatchObject({ state: "PENDING_HOST_REVIEW", retryUsed: true });
  expect(reentered.workers).toHaveLength(3);
  // The consumed grant still sits beside the recovery; it cannot be spent again.
  const before = await f.retained();
  expect((await planningStep(f.operation)).diagnostic).toMatch(/^host-verdict-duplicate: /);
  expect(await f.retained()).toEqual(before);
  // A new grant must rebind the changed recovery, all three failed launches and
  // a new consumption identity; reusing the spent identity is still a duplicate.
  const second = await f.grant();
  expect(second.deadAttempts).toHaveLength(3);
  expect(second.recoverySha256).not.toBe(first.recoverySha256);
  await f.writeGrant({ ...second, consumptionIdentity: first.consumptionIdentity });
  expect((await planningStep(f.operation)).diagnostic).toMatch(/^host-verdict-duplicate: /);
  expect(f.launched).toHaveLength(1);
  // The retained third author is already materialized: no registry read is needed.
  await rm(f.registryPath);
  await f.writeGrant(second);
  f.setRunning(true);
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  expect(f.launched).toHaveLength(2);
  expect(f.launched[1]!.config.author).toMatchObject(materializedFable);
  const state = await f.read();
  expect(state.hostReview).toMatchObject({
    consumptionIdentity: second.consumptionIdentity,
    retainedAuthor: reentered.workers[2].attempt.id,
    placement: materializedFable,
  });
  expect(state.consumedHostReviewIdentities).toEqual([
    first.consumptionIdentity,
    second.consumptionIdentity,
  ]);
  expect(state.retryUsed).toBe(true);
  expect(JSON.stringify(state.workers.slice(0, 3))).toBe(JSON.stringify(reentered.workers));
});

it("host planning review: an unmaterialized retained author placement stops before any intent instead of launching a null model", async () => {
  const f = await hostReviewFixture({ retryUsed: false });
  // Pre-ISS-269 shape with the shared retry still available: the ordinary retry
  // would reuse the family-only placement. It must not reach the launcher.
  const recovery = await f.read();
  recovery.state = "pending-author";
  delete recovery.diagnostic;
  delete recovery.nextLevel;
  await writeFile(f.recoveryPath, JSON.stringify(recovery, null, 2) + "\n");
  const result = await planningStep(f.operation);
  expect(result.status).toBe("planning-pending-host-review");
  expect(result.diagnostic).toContain(
    "planning placement is unmaterialized; no intent or launch is admitted",
  );
  expect(f.launched).toEqual([]);
  expect((await f.read()).workers).toHaveLength(2);
  await expect(readdir(f.directory)).resolves.not.toContain("planning-worker-3");
  // The resulting pending state is exactly what the host grant consumes.
  await f.writeGrant(await f.grant());
  f.setRunning(true);
  expect((await planningStep(f.operation)).status).toBe("observing-planning-author");
  expect(f.launched).toHaveLength(1);
  expect(f.launched[0]!.config.author).toMatchObject(materializedFable);
  expect((await f.read()).retryUsed).toBe(false);
});

it("host planning review: a pending yield without a failed author keeps planning-review-required and refuses a grant as mismatch", async () => {
  const f = await hostReviewFixture({ currentMain: movedMain });
  const recovery = await f.read();
  // A reviewer-unavailable yield: the proposal exists and the latest launch passed.
  recovery.workers[1].terminal = { ...recovery.workers[1].terminal, status: "passed", summary: "" };
  recovery.proposal = {
    raw: "{}",
    digest: hash("{}"),
    bodies: [],
    author: recovery.workers[1].attempt.id,
    participants: [],
  };
  recovery.diagnostic =
    "PENDING_HOST_REVIEW: no admitted distinct planning reviewer is available. No CLI fallback or parking.";
  await writeFile(f.recoveryPath, JSON.stringify(recovery, null, 2) + "\n");
  const before = await f.retained();
  const result = await planningStep(f.operation);
  expect(result).toEqual({
    status: "planning-pending-host-review",
    recovery: f.recoveryPath,
    diagnostic: recovery.diagnostic,
  });
  await f.writeGrant(await f.grant());
  expect((await planningStep(f.operation)).diagnostic).toMatch(
    /^host-verdict-mismatch: the retained pending state has no failed author launch to continue/,
  );
  expect(await f.retained()).toEqual(before);
  expect(f.launched).toEqual([]);
  expect(f.calls.filter((call) => /^(authority|observeAuthority)/.test(call))).toEqual([]);
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
    placements.push(config.reviewer.model!);
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

it("admits external relations by repository identity in both census callers", async () => {
  const realShape = {
    label: iss268RealShapeProbe.label,
    probe: iss268RealShapeProbe,
    platform: {
      repository: "todd-skelton/orchestration-platform",
      number: 517,
      relation: "blockedBy" as const,
    },
    chase: {
      repository: "chase-sets/chase-sets",
      number: 8040,
      relation: "blocking" as const,
    },
  };
  expect(realShape.label).toBe("host-captured-real-shape");
  expect(realShape.probe).toEqual(iss268RealShapeProbe);
  expect(realShape.probe.sha256).toBe(
    "1a96ced6606a62469c2d41baf522642e04ff50418bcb6d0b42a09469e24b723c",
  );
  const empty = { pageInfo: { hasNextPage: false }, nodes: [] };
  const issue = (
    number: number,
    relation: string,
    field: "blockedBy" | "blocking",
    includeIdentity = true,
  ) => ({
    number,
    url: `https://github.com/${relation}/issues/${number}`,
    title: "Lineage fixture",
    body,
    updatedAt: "2026-10-10T00:00:00Z",
    state: "CLOSED",
    parent: null,
    subIssues: empty,
    blockedBy:
      field === "blockedBy"
        ? {
            ...empty,
            nodes: [
              {
                number: 8040,
                state: "CLOSED",
                ...(includeIdentity
                  ? { repository: { nameWithOwner: "chase-sets/chase-sets" } }
                  : {}),
              },
            ],
          }
        : empty,
    blocking:
      field === "blocking"
        ? {
            ...empty,
            nodes: [
              {
                number: 517,
                state: "CLOSED",
                ...(includeIdentity
                  ? { repository: { nameWithOwner: "todd-skelton/orchestration-platform" } }
                  : {}),
              },
            ],
          }
        : empty,
    comments: empty,
  });
  const requests: string[] = [];
  const request = async (args: string[]) => {
    requests.push(args.join(" "));
    const owner = args.find((arg) => arg.startsWith("owner="))?.slice("owner=".length);
    const name = args.find((arg) => arg.startsWith("name="))?.slice("name=".length);
    const repository = `${owner}/${name}`;
    const includeIdentity = args.some((arg) => arg.includes("repository { nameWithOwner }"));
    const row =
      repository === "todd-skelton/orchestration-platform"
        ? issue(517, "todd-skelton/orchestration-platform", "blockedBy", includeIdentity)
        : issue(8040, "chase-sets/chase-sets", "blocking", includeIdentity);
    return { data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [row] } } } };
  };
  const platform = await planningAuthority(realShape.platform.repository, request);
  const chase = await planningAuthority(realShape.chase.repository, request);
  expect(platform[0]!.blockedBy.nodes[0]!.repository.nameWithOwner).toBe("chase-sets/chase-sets");
  expect(chase[0]!.blocking.nodes[0]!.repository.nameWithOwner).toBe(
    "todd-skelton/orchestration-platform",
  );
  expect(requests.some((args) => args.includes("repository { nameWithOwner }"))).toBe(true);

  // Inlined 53e6ba495ded641e5b1395ab501b1b63d35dcd67:scripts/dogfood/planning-context.mjs;
  // hosted bootstrap checks out one commit, so that history is not readable here.
  const baselineBlob = createHash("sha1")
    .update(`blob ${Buffer.byteLength(iss268BaselinePlanningContext)}\0`)
    .update(iss268BaselinePlanningContext)
    .digest("hex");
  expect(baselineBlob).toBe("27b3e0bc6d6a82e0788fd72b6f4b7f3f28ddf165");
  const baseline = await planningAuthorityCopy(iss268BaselinePlanningContext, "baseline");
  await expect(baseline.planningAuthority(realShape.platform.repository, request)).rejects.toThrow(
    "incomplete planning lineage",
  );

  const candidateSource = await readFile(planningContextSource, "utf8");
  const deletedIdentityMutant = candidateSource.replaceAll(" repository { nameWithOwner }", "");
  expect(deletedIdentityMutant).not.toBe(candidateSource);
  const mutant = await planningAuthorityCopy(deletedIdentityMutant, "relation-admission-deleted");
  await expect(mutant.planningAuthority(realShape.platform.repository, request)).rejects.toThrow(
    "incomplete planning lineage",
  );
  console.log(
    `ISS-268 evidence baseline-red=53e6ba4 candidate-green mutant-red=relation-admission-deleted probe=${realShape.probe.path} sha256=${realShape.probe.sha256}`,
  );
});

it.each([
  [
    "same-repository missing number",
    { number: 999, state: "CLOSED", repository: { nameWithOwner: "fixture/repo" } },
  ],
  ["missing identity", { number: 2, state: "CLOSED" }],
  [
    "localized external identity",
    { number: 2, state: "CLOSED", repository: { nameWithOwner: "fixture/repo/extra" } },
  ],
  [
    "case-only same-repository missing number",
    { number: 999, state: "CLOSED", repository: { nameWithOwner: "Fixture/Repo" } },
  ],
])("rejects synthetic malformed or incomplete lineage: %s", async (_label, relation) => {
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
    blockedBy: { ...empty, nodes: [relation] },
    blocking: empty,
    comments: empty,
  };
  const request = async () => ({
    data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue] } } },
  });
  await expect(planningAuthority("fixture/repo", request)).rejects.toThrow(
    "incomplete planning lineage",
  );
});

it("rejects a synthetic duplicate or colliding issue number", async () => {
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
    comments: empty,
  };
  const request = async () => ({
    data: {
      repository: {
        issues: { pageInfo: { hasNextPage: false }, nodes: [issue, structuredClone(issue)] },
      },
    },
  });
  await expect(planningAuthority("fixture/repo", request)).rejects.toThrow(
    "duplicate planning issue",
  );
});

it("rejects a synthetic nested page whose relation omits repository identity", async () => {
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
    blockedBy: { pageInfo: { hasNextPage: true, endCursor: "blocked-by-1" }, nodes: [] },
    blocking: empty,
    comments: empty,
  };
  const request = async (args: string[]) => {
    if (args.includes("number=1"))
      return {
        data: {
          repository: {
            issue: {
              blockedBy: {
                pageInfo: { hasNextPage: false },
                nodes: [{ number: 2, state: "CLOSED" }],
              },
            },
          },
        },
      };
    return {
      data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue] } } },
    };
  };
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
  "reads planning authority through both production adapters",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "planning-adapters-light-"));
    roots.push(root);
    const chaseBody =
      '<!-- routing: {"version":1,"row":2,"review":11} -->\n## Acceptance\n- Keep the proposal bounded.\n';
    const empty = { pageInfo: { hasNextPage: false }, nodes: [] };
    const row = {
      number: 756,
      url: "https://github.com/fixture/repo/issues/756",
      title: "Planning fixture",
      body: chaseBody,
      updatedAt: "2026-10-10T00:00:00Z",
      state: "OPEN",
      milestone: { number: 1, title: "Planning", description: "", state: "OPEN" },
      labels: empty,
      parent: null,
      subIssues: empty,
      blockedBy: empty,
      blocking: empty,
      comments: empty,
    };
    const selfDraft = await readFile(
      resolve(import.meta.dirname, "../../planning/drafts/ISS-237.md"),
      "utf8",
    );
    const selfBody = [
      "<!-- planning-key: ISS-237 -->",
      "",
      "Source draft: [`planning/drafts/ISS-237.md`](https://github.com/todd-skelton/orchestration-platform/blob/main/planning/drafts/ISS-237.md)",
      "",
      selfDraft,
    ].join("\n");
    const writeGh = async (body: string) => {
      const payload = JSON.stringify({
        data: {
          repository: {
            issues: { pageInfo: { hasNextPage: false }, nodes: [{ ...row, body }] },
            issue: { ...row, body },
          },
        },
      });
      await writeFile(resolve(root, "gh"), `#!/bin/sh\ncat <<'JSON'\n${payload}\nJSON\n`);
      await chmod(resolve(root, "gh"), 0o755);
    };
    await writeGh(selfBody);
    await mkdir(resolve(root, ".agents/skills/delivery"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/delivery/SKILL.md"), "fixture delivery rules\n");
    await writeFile(resolve(root, "AGENTS.md"), "fixture product rules\n");
    vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH ?? ""}`);
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const head = (
      await promisify(execFile)("git", ["-C", repositoryRoot, "rev-parse", "HEAD"])
    ).stdout.trim();
    const selfContext = await self.planningContext({
      repository: "todd-skelton/orchestration-platform",
      key: "ISS-237",
      number: 756,
      main: head,
      executorRoot: repositoryRoot,
      gitExecutable: "git",
    });
    expect(selfContext.issues.find((issue: any) => issue.number === 756)?.number).toBe(756);
    await writeGh(chaseBody);
    const chaseContext = await chase.planningContext({
      repository: "chase-sets/chase-sets",
      key: "cs-756",
      number: 756,
      main: head,
      executorRoot: root,
      gitExecutable: "git",
    });
    expect(chaseContext.context.body).toBe(chaseBody);
    expect(chaseContext.issues).toHaveLength(1);
  },
);

// ISS-255 stage fixtures. Only the failure classification is synthetic; the queue,
// native flow, retained readers and supervision below are production code.
type DefectClass = "brief" | "slice" | "design";
const levelOf = { brief: "ISSUE", slice: "SET", design: "EPIC" } as const;
const classified = (defectClass: DefectClass) => ({
  defectClass,
  explanation: "The accepted scope has ambiguous ownership.",
  rootCause: "ambiguous-scope",
  evidenceStatus: "established" as const,
  evidence: ["product.txt:1"],
});
const fixtureAuthority = () => ({
  context: {
    title: "Fixture",
    body,
    acceptanceCriteria: ["Observe an exact body."],
    rules: "Fixture",
  },
  planning: null,
  issues: [{ number: 110, body, updatedAt: "2026-10-10T00:00:00Z", milestone: null }],
});
const planningArtifacts = async (root: string) =>
  (await readdir(root, { recursive: true })).filter((name) =>
    /planning-(recovery|drafts|worker)/.test(String(name)),
  );
const launches = (calls: string[]) => calls.filter((call) => call.startsWith("launch:"));
type Fixture = Awaited<ReturnType<typeof sourceFailureFixture>>;
// Current main is read from refs/remotes/origin/main, as in production.
async function withOrigin(f: Fixture) {
  const remote = resolve(f.root, "remote.git");
  await f.git(f.repository, ["clone", "--bare", f.repository, remote]);
  await f.git(f.repository, ["remote", "add", "origin", remote]);
  return remote;
}
// The fixture's own adapter has no repository, so planning could never proceed
// there; this one supplies the production planning context and real setup.
function planningAdapter(
  f: Fixture,
  config: QueueConfig,
  extra: Partial<Parameters<typeof repositoryQueueAdapter>[2]> = {},
) {
  const adapter = repositoryQueueAdapter(config, f.repository, {
    native: f.native,
    repository: f.policy,
    gitExecutable: f.loop.gitExecutable,
    ...extra,
  });
  adapter.setup = f.current.adapter.setup;
  return adapter;
}
const attemptPhase = async (directory: string) =>
  JSON.parse(await readFile(resolve(directory, "attempt.json"), "utf8")).phase as string;
const retainedOutcome = async (directory: string) => {
  const names = (await readdir(directory)).filter((name) =>
    /^outcome-[a-f0-9]{64}\.json$/.test(name),
  );
  expect(names).toHaveLength(1);
  return JSON.parse(await readFile(resolve(directory, names[0]!), "utf8"));
};

it.each(["brief", "slice", "design"] as const)(
  "AC7: a classified repair-author %s failure never enters planning and keeps main's parking and replay",
  async (defectClass) => {
    const f = await repairFailureFixture();
    roots.push(f.root);
    const observe = f.native.observe;
    f.native.observe = async (role, config, attempt) => {
      const result = await observe(role, config, attempt);
      return role === "author" &&
        result.status === "failed" &&
        /[\\/]repair$/.test(config.stateDirectory)
        ? { ...result, defect: classified(defectClass) }
        : result;
    };
    const contexts: string[] = [];
    f.policy.planningContext = async ({ key }) => {
      contexts.push(key);
      return structuredClone(fixtureAuthority());
    };
    const adapter = planningAdapter(f, f.current.config);
    const directory = f.current.config.stateDirectory;
    await startCycle(f.loop, f.cycle, f.host);
    await expect(queueStep(f.current.config, adapter)).rejects.toMatchObject({
      reason: "author-failed",
    });
    f.cycle.initialHistory = await adapter.history();
    const launched = launches(f.calls);
    const repairAuthor = f.cycle.initialHistory.at(-1)!;
    expect(repairAuthor).toMatchObject({ stage: "repair", role: "author", outcome: "failed" });
    // Control: the retained classification is exactly the one planning would admit.
    expect(await retainedOutcome(resolve(directory, "repair"))).toMatchObject({
      identity: `author:${repairAuthor.id}`,
      defectClass,
      evidenceStatus: "established",
    });
    const unrouted = async () => {
      expect(contexts).toEqual([]);
      expect(await planningArtifacts(f.runState)).toEqual([]);
      expect((await adapter.history()).some((row) => row.stage === "planning")).toBe(false);
      expect(launches(f.calls)).toEqual(launched);
    };
    await unrouted();
    // Retained after terminal persistence: the attempt still reads repair and the
    // ISS-181 reader binds it, so the stop parks the item and replays nothing.
    expect(await attemptPhase(directory)).toBe("repair");
    expect(await retainedSourceFailure(f.loop, f.cycle.selection)).toMatchObject({
      attempts: 3,
      history: f.cycle.initialHistory,
    });
    await expect(queueStep(f.current.config, adapter)).rejects.toMatchObject({
      reason: "author-failed",
    });
    await unrouted();
    expect(await f.stop()).toBe("item");
    expect(f.calls).toContain("park:110");
    expect(f.rows[0]!.comments.at(-1)).toContain("3 implementation attempts");
    expect((await f.advance())!.selection.key).toBe("fixture-159");
    expect(f.rows[0]).toMatchObject({ ready: false, state: "OPEN" });
    await unrouted();
    // After phase=failed: explicit unpark composes the ordinary ISS-181 successor.
    f.rows[0]!.ready = true;
    const unparked = (await f.advance())!;
    expect(unparked.selection.key).toBe("fixture-110");
    const next = (await f.compose(unparked)).config;
    expect(await attemptPhase(directory)).toBe("failed");
    expect(next.stateDirectory).not.toBe(directory);
    expect(next.items[0]!.source.author.prompt).toContain("after terminal repair-author FAIL");
    expect(await retainedSourceFailure(f.loop, unparked.selection)).toBeUndefined();
    await expect(queueStep(f.current.config, adapter)).resolves.toMatchObject({
      status: "advancing-attempt",
    });
    await unrouted();
  },
);

it.each(["brief", "slice", "design"] as const)(
  "AC7: a classified repair-reviewer %s failure never enters planning and keeps main's attempt advancement",
  async (defectClass) => {
    const f = await repairFailureFixture();
    roots.push(f.root);
    let running: string | undefined;
    const observe = f.native.observe;
    f.native.observe = async (role, config, attempt) => {
      if (`${role}:${config.stateDirectory}` === running)
        return { id: attempt.id, status: "running" };
      const result = await observe(role, config, attempt);
      if (!/[\\/]repair$/.test(config.stateDirectory)) return result;
      if (role === "author") return { ...result, status: "passed", summary: "" };
      return {
        ...result,
        status: "failed",
        summary: JSON.stringify({
          run: config.run,
          role,
          head: result.head,
          verdict: "FAIL",
          findings: [
            {
              file: "product.txt",
              line: 1,
              severity: "blocking",
              text: "The repair does not preserve the invariant.",
            },
          ],
          g0: "No; the fixture requirement must hold.",
          defect: classified(defectClass),
        }),
      };
    };
    const contexts: string[] = [];
    f.policy.planningContext = async ({ key }) => {
      contexts.push(key);
      return structuredClone(fixtureAuthority());
    };
    const adapter = planningAdapter(f, f.current.config);
    const directory = f.current.config.stateDirectory;
    const repairDirectory = resolve(directory, "repair");
    const priorCalls = f.calls.length;
    await startCycle(f.loop, f.cycle, f.host);
    // Hold the repair reviewer so the attempt record is retained before its verdict.
    running = `reviewer:${repairDirectory}`;
    await expect(queueStep(f.current.config, adapter)).resolves.toMatchObject({
      status: "observing-reviewer",
    });
    const observing = await readFile(resolve(directory, "attempt.json"), "utf8");
    expect(JSON.parse(observing).phase).toBe("repair");
    running = undefined;
    await expect(queueStep(f.current.config, adapter)).resolves.toMatchObject({
      status: "advancing-attempt",
    });
    f.cycle.initialHistory = await adapter.history();
    const launched = launches(f.calls);
    const repairReviewer = f.cycle.initialHistory.at(-1)!;
    expect(repairReviewer).toMatchObject({ stage: "repair", role: "reviewer", outcome: "failed" });
    expect(await retainedOutcome(repairDirectory)).toMatchObject({
      identity: `reviewer:${repairReviewer.id}`,
      defectClass,
      evidenceStatus: "established",
    });
    const unrouted = async () => {
      expect(contexts).toEqual([]);
      expect(await planningArtifacts(f.runState)).toEqual([]);
      expect((await adapter.history()).some((row) => row.stage === "planning")).toBe(false);
    };
    await unrouted();
    // After phase=failed: re-entry advances; the ISS-161/181 reader stays silent.
    expect(await attemptPhase(directory)).toBe("failed");
    expect(await retainedSourceFailure(f.loop, f.cycle.selection)).toBeUndefined();
    await expect(queueStep(f.current.config, adapter)).resolves.toMatchObject({
      status: "advancing-attempt",
    });
    expect(launches(f.calls)).toEqual(launched);
    await unrouted();
    // Interrupted after terminal persistence, before the record advanced: the
    // retained reviewer terminal is observed again and still advances.
    const failed = await readFile(resolve(directory, "attempt.json"), "utf8");
    await writeFile(resolve(directory, "attempt.json"), observing);
    await expect(queueStep(f.current.config, adapter)).resolves.toMatchObject({
      status: "advancing-attempt",
    });
    expect(await readFile(resolve(directory, "attempt.json"), "utf8")).toBe(failed);
    expect(launches(f.calls)).toEqual(launched);
    await unrouted();
    // Main's successor: the verbatim third repair launches as an implementation author.
    const next = (await f.compose(f.cycle)).config;
    expect(next.stateDirectory).not.toBe(directory);
    expect(next.items[0]!.source.author.prompt).toContain(
      "Apply these reviewer-prescribed fixes verbatim",
    );
    running = `author:${next.items[0]!.source.stateDirectory}`;
    await expect(queueStep(next, planningAdapter(f, next))).resolves.toMatchObject({
      status: "observing-author",
    });
    expect(launches(f.calls)).toEqual([...launched, `launch:author:${next.items[0]!.issue}`]);
    await unrouted();
    expect(f.calls.slice(priorCalls).some((call) => /^(park|note):/.test(call))).toBe(false);
  },
);

it.each(["brief", "slice", "design"] as const)(
  "routes a classified source-reviewer %s FAIL into planning before repair, resuming through supervision",
  async (defectClass) => {
    const f = await sourceFailureFixture();
    roots.push(f.root);
    await withOrigin(f);
    const launch = f.native.launch;
    f.native.launch = async (role, config, prompt) => {
      if (config.purpose === "planning")
        return {
          id: randomUUID(),
          trace: resolve(config.stateDirectory, "planning.jsonl"),
          pid: 123,
          launchedAt: 1,
        };
      if (role === "author")
        await writeFile(resolve(config.worktree, "product.txt"), "rejected implementation\n");
      return launch(role, config, prompt);
    };
    const observe = f.native.observe;
    f.native.observe = async (role, config, attempt) => {
      if (config.purpose === "planning") return { id: attempt.id, status: "running" };
      const result = await observe(role, config, attempt);
      if (role === "author") return { ...result, status: "passed", summary: "" };
      return {
        ...result,
        status: "failed",
        summary: JSON.stringify({
          run: config.run,
          role,
          head: result.head,
          verdict: "FAIL",
          findings: [
            { file: "product.txt", line: 1, severity: "blocking", text: "Preserve the invariant." },
          ],
          g0: "No; the brief's ownership is ambiguous.",
          defect: classified(defectClass),
        }),
      };
    };
    f.policy.planningContext = async () => structuredClone(fixtureAuthority());
    const adapter = planningAdapter(f, f.current.config);
    const directory = f.current.config.stateDirectory;
    await startCycle(f.loop, f.cycle, f.host);
    expect((await queueStep(f.current.config, adapter)).status).toBe("observing-planning-author");
    const reviewer = (await adapter.history()).at(-1)!;
    expect(reviewer).toMatchObject({ stage: "source", role: "reviewer", outcome: "failed" });
    const path = resolve(directory, "planning-recovery.json");
    const recovery = JSON.parse(await readFile(path, "utf8"));
    expect(recovery.level).toBe(levelOf[defectClass]);
    expect(recovery.outcome.value.identity).toBe(`reviewer:${reviewer.id}`);
    expect(recovery.workers).toHaveLength(1);
    expect(recovery.workers[0].config.purpose).toBe("planning");
    // The fixable review stopped before repair: no repair author, no advancement.
    expect(await attemptPhase(directory)).toBe("source");
    expect(
      (await readdir(resolve(directory, "repair"))).filter((name) =>
        /^(author|reviewer)-/.test(name),
      ),
    ).toEqual([]);
    expect(launches(f.calls)).toEqual([
      `launch:author:${f.current.config.items[0]!.issue}`,
      `launch:reviewer:${f.current.config.items[0]!.issue}`,
    ]);
    expect((await readdir(f.runState)).some((name) => name.endsWith("-attempt-2"))).toBe(false);
    // Supervision resumes the same cycle; composition keeps the attempt on its
    // retained planning record rather than projecting a repair or a successor.
    expect((await f.advance())!.selection).toEqual(f.cycle.selection);
    const resumed = await f.compose(f.cycle);
    expect(resumed.config.stateDirectory).toBe(directory);
    expect((await queueStep(resumed.config, planningAdapter(f, resumed.config))).status).toBe(
      "observing-planning-author",
    );
    expect(JSON.parse(await readFile(path, "utf8")).workers).toHaveLength(1);
    expect(await attemptPhase(directory)).toBe("source");
    expect(f.calls.some((call) => /^(park|note|delivery):/.test(call))).toBe(false);
  },
);

// A real native source pair accepted, then a real delivery refresh whose conflict
// author or DELTA reviewer fails with a classification at the refresh stage.
async function deliveryFailureFixture(stage: "conflict" | "refresh", defectClass: DefectClass) {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  const remote = await withOrigin(f);
  const updater = resolve(f.root, "updater");
  await f.git(f.root, ["clone", remote, updater]);
  await appendFile(
    resolve(updater, ".git/config"),
    "[user]\n\tname = Fixture\n\temail = fixture@example.test\n",
  );
  const config = f.current.config;
  const sourceDirectory = config.items[0]!.source.stateDirectory;
  const launch = f.native.launch;
  f.native.launch = async (role, current, prompt) => {
    if (current.purpose === "planning")
      return {
        id: randomUUID(),
        trace: resolve(current.stateDirectory, "planning.jsonl"),
        pid: 123,
        launchedAt: 1,
      };
    if (role === "author" && current.stateDirectory === sourceDirectory)
      await writeFile(resolve(current.worktree, "product.txt"), "candidate\n");
    // Delivery binds native identities to UUIDs; the fixture serial is otherwise retained.
    return { ...(await launch(role, current, prompt)), id: randomUUID() };
  };
  const observe = f.native.observe;
  f.native.observe = async (role, current, attempt) => {
    if (current.purpose === "planning") return { id: attempt.id, status: "running" };
    const result = await observe(role, current, attempt);
    if (!/[\\/]refresh-[0-9a-f]{40}$/.test(current.stateDirectory))
      return role === "author" ? { ...result, status: "passed", summary: "" } : result;
    if (stage === "conflict" && role === "author")
      return {
        ...result,
        status: "failed",
        summary: "Both parents cannot be preserved inside the marked hunks.",
        defect: classified(defectClass),
      };
    if (stage === "refresh" && role === "reviewer")
      return {
        ...result,
        status: "failed",
        summary: JSON.stringify({
          run: current.run,
          role,
          head: result.head,
          verdict: "FAIL",
          findings: [
            {
              file: "product.txt",
              line: 1,
              severity: "blocking",
              text: "The rebased candidate drops main's behaviour.",
            },
          ],
          g0: "No; both parents must be preserved.",
          defect: classified(defectClass),
        }),
      };
    return result;
  };
  f.policy.planningContext = async () => structuredClone(fixtureAuthority());
  const delivery = githubDeliveryAdapter(undefined, f.loop.gitExecutable);
  delivery.verifyWorkspace = async (current, head) =>
    (await f.git(current.worktree, ["rev-parse", "HEAD"])) === head &&
    (await f.git(current.worktree, ["status", "--porcelain"])) === "";
  delivery.runGate = async () => "passed";
  const adapter = (current: QueueConfig) =>
    planningAdapter(f, current, {
      delivery,
      deliveryPolicy: {
        async plan(plan) {
          return {
            gates: { beforeMirror: ["synthetic-check"], afterMirror: [] },
            drafts: [],
            publication: {
              sourceBranch: "codex/fixture-110",
              baseBranch: "main",
              title: "fixture",
              body: "fixture",
              draft: true,
            },
            cleanup: {
              worktrees: [plan.worktree, plan.reviewWorktree],
              branch: plan.localBranch!,
            },
            mergePolicy: {},
          };
        },
      },
    });
  await startCycle(f.loop, f.cycle, f.host);
  await expect(
    queueStep(config, {
      ...adapter(config),
      async delivery() {
        throw new Error("accepted source reached delivery");
      },
    }),
  ).rejects.toThrow("accepted source reached delivery");
  expect(await attemptPhase(config.stateDirectory)).toBe("delivery");
  // Main moves after the exact-head PASS: a conflicting product edit, or an
  // unrelated file whose rebase is clean and needs only the DELTA reviewer.
  await writeFile(resolve(updater, stage === "conflict" ? "product.txt" : "main.txt"), "main\n");
  await f.git(updater, ["add", "."]);
  await f.git(updater, ["commit", "-m", "main moved"]);
  await f.git(updater, ["push", "origin", "main"]);
  const main = await f.git(updater, ["rev-parse", "HEAD"]);
  return {
    ...f,
    adapter,
    main,
    sourceDirectory,
    reason: stage === "conflict" ? "conflict-resolution-failed" : "refresh-review-failed",
    role: stage === "conflict" ? "author" : "reviewer",
  };
}

it.each([
  ["conflict", "slice"],
  ["refresh", "design"],
] as const)(
  "routes a classified %s-stage %s failure from delivery into planning without parking",
  async (stage, defectClass) => {
    const f = await deliveryFailureFixture(stage, defectClass);
    const config = f.current.config;
    const directory = config.stateDirectory;
    const launched = launches(f.calls);
    expect((await queueStep(config, f.adapter(config))).status).toBe("observing-planning-author");
    const worker = (await f.adapter(config).history()).at(-1)!;
    expect(worker).toMatchObject({ stage: "refresh", role: f.role, outcome: "failed" });
    const path = resolve(directory, "planning-recovery.json");
    const recovery = JSON.parse(await readFile(path, "utf8"));
    expect(recovery.level).toBe(levelOf[defectClass]);
    expect(recovery.outcome.value.identity).toBe(`${f.role}:${worker.id}`);
    expect(recovery.outcome.path.startsWith(resolve(f.sourceDirectory, `refresh-${f.main}`))).toBe(
      true,
    );
    expect(recovery.input.main).toBe(f.main);
    expect(launches(f.calls)).toEqual([...launched, `launch:${f.role}:${config.items[0]!.issue}`]);
    // The typed stop never reached supervision; the accepted delivery cursor and
    // the native refresh records stay as they were when the worker failed.
    expect(await attemptPhase(directory)).toBe("delivery");
    expect(f.calls.some((call) => /^(park|note):/.test(call))).toBe(false);
    expect((await f.advance())!.selection).toEqual(f.cycle.selection);
    const resumed = await f.compose(f.cycle);
    expect(resumed.config.stateDirectory).toBe(directory);
    expect((await queueStep(resumed.config, f.adapter(resumed.config))).status).toBe(
      "observing-planning-author",
    );
    expect(JSON.parse(await readFile(path, "utf8")).workers).toHaveLength(1);
    expect(await attemptPhase(directory)).toBe("delivery");
    expect((await readdir(f.runState)).some((name) => name.endsWith("-attempt-2"))).toBe(false);
  },
);

it.each([
  ["conflict", "brief"],
  ["refresh", "slice"],
] as const)(
  "re-reads a retained %s-stage %s failure through composition into planning instead of a successor",
  async (stage, defectClass) => {
    const f = await deliveryFailureFixture(stage, defectClass);
    const config = f.current.config;
    const directory = config.stateDirectory;
    // Interrupted before the planning hook: the ordinary typed stop parks the item.
    const interrupted = f.adapter(config);
    delete interrupted.planning;
    await expect(queueStep(config, interrupted)).rejects.toMatchObject({ reason: f.reason });
    f.cycle.initialHistory = await interrupted.history();
    expect(f.cycle.initialHistory.at(-1)).toMatchObject({
      stage: "refresh",
      role: f.role,
      outcome: "failed",
    });
    expect(await attemptPhase(directory)).toBe("delivery");
    expect(await stopCycle(f.loop, f.cycle, f.reason, 1, f.host, f.policy)).toBe("item");
    expect(f.calls).toContain("park:110");
    const retained = await snapshot(directory);
    // Explicit unpark: the retained conflict/refresh reader finds the classification
    // and leaves the attempt unprojected; the queue then resumes planning from it.
    f.rows[0]!.ready = true;
    const next = (await f.advance())!;
    expect(next.selection.key).toBe("fixture-110");
    const composed = await f.compose(next);
    expect(composed.config.stateDirectory).toBe(directory);
    expect(composed.config.items[0]!.implementationAttempt).toBe(1);
    expect(await snapshot(directory)).toEqual(retained);
    expect((await readdir(f.runState)).some((name) => name.endsWith("-attempt-2"))).toBe(false);
    const launched = launches(f.calls);
    expect((await queueStep(composed.config, f.adapter(composed.config))).status).toBe(
      "observing-planning-author",
    );
    const recovery = JSON.parse(
      await readFile(resolve(directory, "planning-recovery.json"), "utf8"),
    );
    expect(recovery.level).toBe(levelOf[defectClass]);
    expect(recovery.outcome.value.identity).toBe(`${f.role}:${f.cycle.initialHistory.at(-1)!.id}`);
    expect(launches(f.calls)).toEqual(launched);
    expect(await attemptPhase(directory)).toBe("delivery");
    // Composition after the planning record keeps the same attempt again.
    expect((await f.compose(next)).config.stateDirectory).toBe(directory);
    expect((await readdir(f.runState)).some((name) => name.endsWith("-attempt-2"))).toBe(false);
  },
);

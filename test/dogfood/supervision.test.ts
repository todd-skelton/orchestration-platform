import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as prettier from "prettier";
import { expectedBoardItems, type BoardSnapshot } from "../../scripts/planning/board-check.mjs";
import type { PlanningSnapshot } from "../../scripts/planning/check.mjs";
import type { LoopConfig, QueueParticipant } from "../../scripts/dogfood/queue.js";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  selectReadyIssue,
  startCycle,
  stopRecoveryActions,
  stopCycle,
  type IssueObservation,
  type SelectedIssue,
  type SupervisionAdapter,
  type SupervisedCycle,
} from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];

function draft(key: string, milestone: string, blockedBy: string[] = []) {
  return `---\nkey: ${key}\ntitle: "Do ${key}"\nlabels: ["type:slice"]\nmilestone: "${milestone}"\nblocked_by: [${blockedBy.join(", ")}]\n---\n\n## Why\n\nBecause.\n`;
}

function planning(): PlanningSnapshot {
  return {
    roadmap: {
      schemaVersion: "orchestration-roadmap/v1",
      repository: "todd-skelton/orchestration-platform",
      project: {
        id: "project-1",
        number: 1,
        title: "Delivery",
        url: "https://example.test/project",
      },
      milestones: [
        { key: "M1", title: "First" },
        { key: "M2", title: "Second" },
      ],
      issues: [
        { key: "ISS-100", file: "planning/drafts/ISS-100.md", milestone: "M1", blockedBy: [] },
        {
          key: "ISS-105",
          file: "planning/drafts/ISS-105.md",
          milestone: "M1",
          blockedBy: ["ISS-100"],
        },
        {
          key: "ISS-106",
          file: "planning/drafts/ISS-106.md",
          milestone: "M1",
          blockedBy: ["ISS-100"],
        },
        { key: "ISS-200", file: "planning/drafts/ISS-200.md", milestone: "M2", blockedBy: [] },
      ],
    },
    issueDrafts: {
      "ISS-100": draft("ISS-100", "First"),
      "ISS-105": draft("ISS-105", "First", ["ISS-100"]),
      "ISS-106": draft("ISS-106", "First", ["ISS-100"]),
      "ISS-200": draft("ISS-200", "Second"),
    },
  };
}

function board(
  source: PlanningSnapshot,
  rows: Record<string, { state: "OPEN" | "CLOSED"; ready?: boolean }>,
): BoardSnapshot {
  const expected = expectedBoardItems(source);
  return {
    repository: source.roadmap.repository,
    totalCount: expected.length,
    issues: expected.map((item, index) => ({
      number: index + 1,
      title: item.title,
      body: item.body,
      milestone: item.milestone,
      state: rows[item.key]!.state,
      labels: rows[item.key]!.ready ? ["ready"] : [],
    })),
  };
}

describe("ready issue selection", () => {
  it("orders by the earliest open milestone and key while skipping blocked work", () => {
    const source = planning();
    const snapshot = board(source, {
      "ISS-100": { state: "CLOSED" },
      "ISS-105": { state: "OPEN", ready: true },
      "ISS-106": { state: "OPEN", ready: true },
      "ISS-200": { state: "OPEN", ready: true },
    });
    expect(selectReadyIssue(source, snapshot)).toEqual({ key: "ISS-105", number: 2 });

    snapshot.issues[1]!.labels = [];
    expect(selectReadyIssue(source, snapshot)).toEqual({ key: "ISS-106", number: 3 });

    snapshot.issues[0]!.state = "OPEN";
    expect(selectReadyIssue(source, snapshot)).toBeUndefined();

    snapshot.issues[0]!.state = "CLOSED";
    snapshot.issues[1]!.state = "CLOSED";
    snapshot.issues[2]!.state = "CLOSED";
    expect(selectReadyIssue(source, snapshot)).toEqual({ key: "ISS-200", number: 4 });
  });
});

function loop(root: string): LoopConfig {
  return {
    schemaVersion: "dogfood-loop/v1",
    run: "selection-run",
    repository: "fixture/repository",
    stableExecutorRoot: root,
    stateRoot: resolve(root, "state"),
    worktreeRoot: resolve(root, "worktrees"),
    author: { model: "author", effort: "high" },
    reviewer: { model: "reviewer", effort: "high" },
    codexExecutable: resolve(root, "codex"),
    gitExecutable: resolve(root, "git"),
    exitReceiptWindowMs: 30_000,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
}

function selected(): SupervisedCycle {
  const selection: SelectedIssue = {
    cycle: 1,
    key: "ISS-105",
    number: 362,
    base: "a".repeat(40),
  };
  return { selection, initialHistory: [], persisted: false };
}

function fakeAdapter(observation: IssueObservation) {
  const calls = { remove: 0, restore: 0, close: 0, comment: 0 };
  const adapter: SupervisionAdapter = {
    async board() {
      throw new Error("board must not be read while a selected cycle is active");
    },
    async currentMain() {
      throw new Error("main must not be read while a selected cycle is active");
    },
    async issue() {
      return structuredClone(observation);
    },
    async removeReady() {
      calls.remove += 1;
      observation.labels = observation.labels.filter((label) => label !== "ready");
    },
    async restoreReady() {
      calls.restore += 1;
      if (!observation.labels.includes("ready")) observation.labels.push("ready");
    },
    async close() {
      calls.close += 1;
      observation.state = "CLOSED";
    },
    async comment(_config, _number, body) {
      calls.comment += 1;
      observation.comments.push(body);
    },
  };
  return { adapter, calls, observation };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("records selection before removing ready and resumes it without selecting again", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-selection-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  });

  await persistCycle(config, cycle);
  await startCycle(config, cycle, fixture.adapter);
  await persistCycle(config, cycle);
  await startCycle(config, cycle, fixture.adapter);
  expect(fixture.calls.remove).toBe(1);
  expect(
    JSON.parse(
      await readFile(resolve(config.stateRoot, config.run, "cycle-1-selected.json"), "utf8"),
    ),
  ).toEqual(cycle.selection);

  const resumed = await nextCycle(config, root, fixture.adapter);
  expect(resumed).toEqual({ ...cycle, persisted: true });
});

it("posts one learning note after an interrupted comment and restores ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  });
  await persistCycle(config, cycle);
  await startCycle(config, cycle, fixture.adapter);
  let interrupted = true;
  const comment = fixture.adapter.comment;
  fixture.adapter.comment = async (...args) => {
    await comment(...args);
    if (interrupted) {
      interrupted = false;
      throw new Error("lost comment receipt");
    }
  };

  await expect(
    stopCycle(config, cycle, "typecheck-failed-after-retry", 2, fixture.adapter),
  ).rejects.toThrow("lost comment receipt");
  await stopCycle(config, cycle, "typecheck-failed-after-retry", 2, fixture.adapter);

  expect(fixture.calls.comment).toBe(1);
  expect(fixture.calls.restore).toBe(1);
  expect(fixture.observation.labels).toContain("ready");
  expect(fixture.observation.comments[0]).toContain("typecheck-failed-after-retry");
  expect(fixture.observation.comments[0]).toContain("2 implementation attempts");
  expect(fixture.observation.comments[0]).toContain("open the saved typecheck gate record");
  expect(fixture.observation.comments[0]).toContain(resolve(config.stateRoot, config.run));
});

it("gives a dependency stop a concrete saved-record correction", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-dependency-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  await persistCycle(config, cycle);
  await stopCycle(config, cycle, "dependency-install-failed", 0, fixture.adapter);
  expect(fixture.observation.comments[0]).toContain("setup and dependency records");
  expect(fixture.observation.comments[0]).toContain("offline dependency failure");
  expect(fixture.observation.labels).toContain("ready");
});

it("points a source-review stop to the retained component records", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-source-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  await persistCycle(config, cycle);
  await stopCycle(config, cycle, "source-review-state-unknown", 1, fixture.adapter);
  expect(fixture.observation.comments[0]).toContain("source or repair candidate");
  expect(fixture.observation.comments[0]).toContain("reviewer terminal records");
  expect(fixture.observation.comments[0]).toContain("candidate or review-state mismatch");
});

it("has an exact recovery row for every finite emitted literal and fixed domain", async () => {
  const files = [
    "supervision.ts",
    "queue.ts",
    "setup.ts",
    "setup-adapter.ts",
    "flow.ts",
    "repair.ts",
    "repair-policy.ts",
    "repair-adapter.ts",
    "delivery.ts",
    "delivery-adapter.ts",
    "self-delivery-policy.mjs",
    "supervise.mjs",
  ];
  const reasons = new Set<string>();
  const calleeName = (node: any): string =>
    node?.type === "Identifier"
      ? node.name
      : node?.type === "MemberExpression" && !node.computed
        ? calleeName(node.property)
        : "";
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    let reason;
    if (
      node.type === "NewExpression" &&
      ["QueueBlocked", "SetupBlocked", "RepairBlocked", "DeliveryBlocked"].includes(
        calleeName(node.callee),
      )
    )
      reason = node.arguments?.[0];
    if (
      node.type === "CallExpression" &&
      ["demand", "requireThat", "requirePolicy"].includes(calleeName(node.callee))
    )
      reason = node.arguments?.[1];
    if (
      reason &&
      ["StringLiteral", "Literal"].includes(reason.type) &&
      typeof reason.value === "string"
    )
      reasons.add(reason.value);
    for (const [key, value] of Object.entries(node)) {
      if (["comments", "extra", "loc", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  for (const file of files) {
    const source = await readFile(
      resolve(import.meta.dirname, "../../scripts/dogfood", file),
      "utf8",
    );
    const parsed = await (prettier as any).__debug.parse(source, {
      parser: file.endsWith(".ts") ? "typescript" : "babel",
    });
    visit(parsed.ast);
  }
  const fixed = [
    "author-temp-unavailable",
    "author-offline-pnpm-unavailable",
    ...["typecheck", "format:check", "planning:check", "planning:board-check"].map(
      (gate) => `gate-failed:${gate}`,
    ),
    ...["typecheck", "format:check"].map((gate) => `gate-retry-exhausted:${gate}`),
    ...["Node 24 / ubuntu-latest", "Node 24 / windows-latest", "Node 24 / macos-latest"].flatMap(
      (check) => [
        `missing-or-duplicate-check:${check}`,
        `malformed-check:${check}`,
        `hosted-check-failed:${check}`,
      ],
    ),
    ...["merge", "cleanup"].flatMap((operation) => [
      `${operation}-state-unknown`,
      `${operation}-outcome-unknown`,
      `${operation}-unconfirmed-reconcile-before-retry`,
    ]),
    ...["pilot", "source", "review"].flatMap((role) => [
      `worktree-collision:${role}`,
      `worktree-state-unknown:${role}`,
      `worktree-state-drift:${role}`,
      `unowned-worktree:${role}`,
      `malformed-worktree-receipt:${role}`,
      `malformed-worktree-intent:${role}`,
      `malformed-dependency-receipt:${role}`,
      `malformed-dependency-intent:${role}`,
      `dependency-state-drift:${role}`,
      `dependency-state-unconfirmed:${role}`,
    ]),
    ...["author", "reviewer"].flatMap((role) => [
      `${role}-launch-identity-unknown-reconcile`,
      `${role}-wrong-head`,
    ]),
  ];
  fixed.forEach((reason) => reasons.add(reason));
  expect([...reasons].filter((reason) => !stopRecoveryActions.has(reason))).toEqual([]);
});

it("uses the explicit unmapped fallback for an external reason value", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-unmapped-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  await persistCycle(config, cycle);
  await stopCycle(config, cycle, "malformed-record:draft-ISS-999", 1, fixture.adapter);
  expect(fixture.observation.comments[0]).toContain("this stop reason is unmapped");
  expect(fixture.observation.comments[0]).toContain("newest retained queue/component record");
});

it("gives author sandbox preflight stops exact recovery actions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-author-preflight-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  await persistCycle(config, cycle);
  await stopCycle(config, cycle, "author-temp-unavailable", 1, fixture.adapter);
  await stopCycle(config, cycle, "author-offline-pnpm-unavailable", 1, fixture.adapter);
  expect(fixture.observation.comments[0]).toContain(
    "restore host write access to the run's private author-temp directory",
  );
  expect(fixture.observation.comments[1]).toContain(
    "install or cache the exact packageManager pnpm version",
  );
  expect(fixture.observation.comments[1]).toContain("matching installed npm_execpath");
});

it("gives the three prescribed stops exact actions without forbidden advice", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-prescribed-stops-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  await persistCycle(config, cycle);
  for (const reason of [
    "completed-issue-state-unknown",
    "issue-observation-unavailable",
    "selected-base-unavailable",
  ])
    await stopCycle(config, cycle, reason, 1, fixture.adapter);

  const [completed, observation, selectedBase] = fixture.observation.comments;
  expect(completed).toContain("if the PR merged, close the issue by hand and restart");
  expect(completed).not.toMatch(/reopen|open\/ready/i);
  expect(observation).toContain("restore `gh` authentication or network access and restart");
  expect(observation).not.toMatch(/edit (?:the )?issue|labels?|markers?/i);
  expect(selectedBase).toContain("fetch origin or otherwise restore its pinned base commit");
  expect(selectedBase).not.toMatch(/change (?:the )?selection|edit (?:the )?selection/i);
});

it("closes a completed issue and carries its participant history into the next cycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-complete-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const fixture = fakeAdapter({
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  });
  const unavailable = { status: "unavailable" as const };
  const history: QueueParticipant[] = [
    {
      ordinal: 1,
      id: "author-1",
      item: "ISS-105:1",
      stage: "source",
      role: "author",
      outcome: "passed",
      usage: { inputTokens: unavailable, outputTokens: unavailable, costUsd: unavailable },
    },
  ];
  await persistCycle(config, cycle);
  await startCycle(config, cycle, fixture.adapter);
  await completeCycle(config, cycle, history, fixture.adapter);
  expect(fixture.calls.close).toBe(1);
  expect(fixture.calls.restore).toBe(0);

  fixture.observation.state = "OPEN";
  fixture.observation.key = "ISS-106";
  fixture.observation.labels = [];
  const active: SelectedIssue = {
    cycle: 2,
    key: "ISS-106",
    number: 363,
    base: "b".repeat(40),
  };
  await writeFile(
    resolve(config.stateRoot, config.run, "cycle-2-selected.json"),
    `${JSON.stringify(active, null, 2)}\n`,
  );
  await expect(nextCycle(config, root, fixture.adapter)).resolves.toEqual({
    selection: active,
    initialHistory: history,
    persisted: true,
  });
});

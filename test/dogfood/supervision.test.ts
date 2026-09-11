import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectedBoardItems, type BoardSnapshot } from "../../scripts/planning/board-check.mjs";
import type { PlanningSnapshot } from "../../scripts/planning/check.mjs";
import type { LoopConfig } from "../../scripts/dogfood/queue.js";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  selectReadyIssue,
  startCycle,
  stopCycle,
  type IssueObservation,
  type SelectedIssue,
  type SupervisionAdapter,
  type SupervisedCycle,
} from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];

function draft(key: string, milestone: string, blockedBy: string[] = []) {
  return `---
key: ${key}
title: "Do ${key}"
labels: ["type:slice"]
milestone: "${milestone}"
blocked_by: [${blockedBy.join(", ")}]
---

## Why

Because.
`;
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
  return { selection, initialHistory: [] };
}

function fakeAdapter(observation: IssueObservation): SupervisionAdapter {
  return {
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
      observation.labels = observation.labels.filter((label) => label !== "ready");
    },
    async restoreReady() {
      if (!observation.labels.includes("ready")) observation.labels.push("ready");
    },
    async close() {
      observation.state = "CLOSED";
    },
    async comment(_config, _number, body) {
      observation.comments.push(body);
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

it("removes ready and resumes the selected cycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-selection-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const adapter = fakeAdapter(observation);

  await persistCycle(config, cycle);
  await startCycle(config, cycle, adapter);
  expect(observation.labels).not.toContain("ready");
  await expect(nextCycle(config, root, adapter)).resolves.toEqual(cycle);
});

it("posts one learning note after an interrupted comment and restores ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  const comment = adapter.comment;
  let interrupted = true;
  adapter.comment = async (...args) => {
    await comment(...args);
    if (interrupted) {
      interrupted = false;
      throw new Error("lost comment receipt");
    }
  };

  await persistCycle(config, cycle);
  await expect(stopCycle(config, cycle, "synthetic-stop", 2, adapter)).rejects.toThrow(
    "lost comment receipt",
  );
  await stopCycle(config, cycle, "synthetic-stop", 2, adapter);

  expect(observation.comments).toHaveLength(1);
  expect(observation.comments[0]).toContain("synthetic-stop");
  expect(observation.comments[0]).toContain("2 implementation attempts");
  expect(observation.labels).toContain("ready");
});

it("uses the generic fallback with the evidence directory and verbatim reason", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-generic-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);
  await stopCycle(config, cycle, "synthetic-unmapped-reason", 1, fakeAdapter(observation));
  expect(observation.comments[0]).toContain("synthetic-unmapped-reason");
  expect(observation.comments[0]).toContain(resolve(config.stateRoot, config.run));
});

it("gives the three prescribed stops exact actions without forbidden advice", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-prescribed-stops-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  await persistCycle(config, cycle);
  for (const reason of [
    "completed-issue-state-unknown",
    "issue-observation-unavailable",
    "selected-base-unavailable",
  ])
    await stopCycle(config, cycle, reason, 1, adapter);

  const [completed, unavailable, selectedBase] = observation.comments;
  expect(completed).toContain("if the PR merged, close the issue by hand and restart");
  expect(completed).not.toMatch(/reopen/i);
  expect(unavailable).toContain("restore `gh` authentication or network access and restart");
  expect(unavailable).not.toMatch(/edit (?:the )?issue/i);
  expect(selectedBase).toContain("fetch origin or otherwise restore its pinned base commit");
  expect(selectedBase).not.toMatch(/change (?:the )?selection/i);
});

it("closes a completed issue without restoring ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-complete-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);
  await completeCycle(config, cycle, [], fakeAdapter(observation));
  expect(observation.state).toBe("CLOSED");
  expect(observation.labels).not.toContain("ready");
});

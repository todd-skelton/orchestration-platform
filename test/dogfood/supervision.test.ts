import { execFile, type ExecFileOptions } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { expectedBoardItems, type BoardSnapshot } from "../../scripts/planning/board-check.mjs";
import { loadPlanningSnapshot, type PlanningSnapshot } from "../../scripts/planning/check.mjs";
import { QueueBlocked, type LoopConfig } from "../../scripts/dogfood/queue.js";
import { selectCandidates } from "../../adapters/self.mjs";
import {
  loadRepositoryAdapter,
  type RepositoryAdapter,
} from "../../scripts/dogfood/repository-adapter.js";
import {
  completeCycle,
  isItemStopReason,
  nextCycle,
  persistCycle,
  startCycle,
  stopCycle,
  type IssueObservation,
  type SelectedIssue,
  type SupervisionAdapter,
  type SupervisedCycle,
} from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];
const execute = (file: string, args: string[], options: ExecFileOptions) =>
  new Promise<void>((resolvePromise, reject) => {
    execFile(file, args, { ...options, encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) reject({ code: error.code, stderr });
      else resolvePromise();
    });
  });
const supervisorCommand = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const supervisorHook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");
const repositoryPolicy: RepositoryAdapter = {
  selectCandidates: () => [{ key: "ISS-105", number: 362 }],
  issueContext: async () => {
    throw new Error("unused");
  },
  branchName: () => "codex/iss-105",
  pullRequest: async () => {
    throw new Error("unused pullRequest");
  },
  requiredChecks: () => ["linux", "windows", "macos"],
  park: () => "add the `ready` label after acting on the note",
  mergeMethod: () => ({ method: "squash" }),
  afterMerge: () => {},
};

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
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: root,
    stateRoot: resolve(root, "state"),
    worktreeRoot: resolve(root, "worktrees"),
    author: { model: "author", effort: "high" },
    reviewer: { model: "reviewer", effort: "high" },
    codexExecutable: resolve(root, "codex"),
    gitExecutable: resolve(root, "git"),
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
    async currentMain() {
      throw new Error("main must not be read while a selected cycle is active");
    },
    async issue() {
      return structuredClone(observation);
    },
    async removeReady() {
      observation.labels = observation.labels.filter((label) => label !== "ready");
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
  it("orders by the earliest open milestone and key while skipping blocked work", async () => {
    const source = planning();
    const snapshot = board(source, {
      "ISS-100": { state: "CLOSED" },
      "ISS-105": { state: "OPEN", ready: true },
      "ISS-106": { state: "OPEN", ready: true },
      "ISS-200": { state: "OPEN", ready: true },
    });
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-105", number: 2 });

    snapshot.issues[1]!.labels = [];
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-106", number: 3 });

    snapshot.issues[0]!.state = "OPEN";
    expect(
      await selectCandidates({
        repository: source.roadmap.repository,
        planning: source,
        board: snapshot,
      }),
    ).toEqual([]);

    snapshot.issues[0]!.state = "CLOSED";
    snapshot.issues[1]!.state = "CLOSED";
    snapshot.issues[2]!.state = "CLOSED";
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-200", number: 4 });
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
  await expect(nextCycle(config, root, adapter, repositoryPolicy)).resolves.toEqual(cycle);
});

it("posts one current-main learning note before selection persistence and keeps ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-main-stop-"));
  roots.push(root);
  const repository = resolve(import.meta.dirname, "../..");
  const source = await loadPlanningSnapshot(repository);
  const config = { ...loop(root), repository: source.roadmap.repository };
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  adapter.currentMain = async () => {
    throw new QueueBlocked("current-main-unavailable");
  };

  await expect(nextCycle(config, repository, adapter, repositoryPolicy)).rejects.toThrow(
    "current-main-unavailable",
  );
  await expect(nextCycle(config, repository, adapter, repositoryPolicy)).rejects.toThrow(
    "current-main-unavailable",
  );
  expect(observation.comments).toHaveLength(1);
  expect(observation.comments[0]).toContain(
    "check the stableExecutorRoot and gitExecutable fields in the loop config",
  );
  expect(observation.comments[0]).toContain("after 0 implementation attempts");
  expect(observation.labels).toContain("ready");
});

it("posts one learning note after an interrupted comment and parks an item stop", async () => {
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
  await expect(
    stopCycle(config, cycle, "launcher-failed", 2, adapter, repositoryPolicy),
  ).rejects.toThrow("lost comment receipt");
  await stopCycle(config, cycle, "launcher-failed", 2, adapter, repositoryPolicy);

  expect(observation.comments).toHaveLength(1);
  expect(observation.comments[0]).toContain("launcher-failed");
  expect(observation.comments[0]).toContain("2 implementation attempts");
  expect(observation.comments[0]).toContain(
    "To unpark, add the `ready` label after acting on the note.",
  );
  expect(observation.labels).not.toContain("ready");
});

it("parks an item stop and advances selection to a different issue", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-park-next-"));
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
  adapter.currentMain = async () => "b".repeat(40);
  const parked: Array<{ number: number; reason: string }> = [];
  const candidates = [
    { key: "ISS-105", number: 362 },
    { key: "ISS-106", number: 363 },
  ];
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    selectCandidates: () =>
      candidates.filter(({ number }) => !parked.some((row) => row.number === number)),
    park: ({ number, reason }) => {
      parked.push({ number, reason });
      return "add the `ready` label after acting on the note";
    },
  };

  await persistCycle(config, cycle);
  await expect(
    stopCycle(config, cycle, "implementation-attempt-ceiling-exhausted", 4, adapter, repository),
  ).resolves.toBe("item");
  await expect(nextCycle(config, root, adapter, repository)).resolves.toMatchObject({
    selection: { cycle: 2, key: "ISS-106", number: 363, base: "b".repeat(40) },
  });
  expect(parked).toEqual([{ number: 362, reason: "implementation-attempt-ceiling-exhausted" }]);
  expect(observation.comments[0]).toContain(
    "apply the final blocking findings before unparking the issue",
  );
  expect(observation.comments[0]).not.toContain("restart");
  expect(observation.comments[0]).not.toContain("\n");
});

it("parks only the explicit item stop reasons", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-run-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  let parks = 0;
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    park: () => {
      parks += 1;
      return "unpark fixture";
    },
  };

  await persistCycle(config, cycle);
  await expect(
    stopCycle(
      config,
      cycle,
      "native-launch-ceiling-exhausted",
      2,
      fakeAdapter(observation),
      repository,
    ),
  ).resolves.toBe("run");
  expect(
    [
      "implementation-attempt-ceiling-exhausted",
      "gate-retry-exhausted:typecheck",
      "reviewer-malformed",
      "exit-receipt-timeout",
      "launcher-failed",
      "rebase-conflict",
      "hosted-check-failed:linux",
      "hosted-check-log-unavailable:windows",
      "deploy-not-verified",
      "source-finding-location-outside-candidate",
    ].every(isItemStopReason),
  ).toBe(true);
  expect(isItemStopReason("native-launch-ceiling-exhausted")).toBe(false);
  expect(isItemStopReason("unstable-executor")).toBe(false);
  expect(parks).toBe(0);
  expect(observation.comments[0]).not.toContain("To unpark");
  await expect(nextCycle(config, root, fakeAdapter(observation), repository)).resolves.toEqual(
    cycle,
  );
});

it("exits on an environmental stop without parking or selecting again", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-command-run-stop-"));
  roots.push(root);
  const config = loop(root);
  const runState = resolve(config.stateRoot, config.run);
  const fixtureState = resolve(root, "fixture-state");
  const request = resolve(root, "loop.json");
  const controlsPath = resolve(fixtureState, "command-controls.json");
  const issuePath = resolve(fixtureState, "command-issue.json");
  await mkdir(fixtureState, { recursive: true });
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    writeFile(
      controlsPath,
      `${JSON.stringify({
        main: "a".repeat(40),
        validationStopReason: "controller-executor-mismatch",
        parkCalls: 0,
      })}\n`,
    ),
    writeFile(
      issuePath,
      `${JSON.stringify({ state: "OPEN", key: "ISS-105", labels: ["ready"], comments: [] })}\n`,
    ),
  ]);

  let failure: { code?: number | string; stderr?: string } | undefined;
  try {
    await execute(
      process.execPath,
      ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
      {
        env: { ...process.env, SUPERVISE_FIXTURE_STATE: fixtureState },
        timeout: 10_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    failure = error as { code?: number | string; stderr?: string };
  }

  expect(failure).toMatchObject({ code: 1 });
  expect(JSON.parse(await readFile(controlsPath, "utf8"))).toMatchObject({
    parkCalls: 0,
    selectCalls: 1,
  });
  const issue = JSON.parse(await readFile(issuePath, "utf8"));
  expect(issue.comments).toHaveLength(1);
  expect(issue.comments[0]).toContain("controller-executor-mismatch");
  expect(issue.comments[0]).not.toContain("To unpark");
  expect(failure?.stderr).toContain('"reason":"controller-executor-mismatch"');
  await expect(
    readFile(resolve(runState, "cycle-1-stop-1-complete.json"), "utf8"),
  ).resolves.toEqual(expect.any(String));
});

it("exits after one selection when a stop happens before a cycle is active", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-command-pre-cycle-stop-"));
  roots.push(root);
  const config = loop(root);
  const runState = resolve(config.stateRoot, config.run);
  const request = resolve(root, "loop.json");
  const controlsPath = resolve(runState, "command-controls.json");
  const issuePath = resolve(runState, "command-issue.json");
  await mkdir(runState, { recursive: true });
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    writeFile(
      controlsPath,
      `${JSON.stringify({ selectionReason: "malformed-repository-candidates", selectCalls: 0 })}\n`,
    ),
    writeFile(
      issuePath,
      `${JSON.stringify({ state: "OPEN", key: "ISS-105", labels: ["ready"], comments: [] })}\n`,
    ),
  ]);

  let failure: { code?: number | string; stderr?: string } | undefined;
  try {
    await execute(
      process.execPath,
      ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
      {
        env: { ...process.env, SUPERVISE_FIXTURE_STATE: runState },
        timeout: 10_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    failure = error as { code?: number | string; stderr?: string };
  }

  expect(failure).toMatchObject({ code: 1 });
  expect(failure?.stderr).toContain('"reason":"malformed-repository-candidates"');
  expect(JSON.parse(await readFile(controlsPath, "utf8"))).toMatchObject({ selectCalls: 1 });
  expect(JSON.parse(await readFile(issuePath, "utf8")).comments).toEqual([]);
});

it("preserves adapter reasons in stop notes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-adapter-reason-"));
  roots.push(root);
  const adapterRoot = resolve(root, "adapter-root");
  await mkdir(resolve(adapterRoot, "adapters"), { recursive: true });
  await writeFile(
    resolve(adapterRoot, "adapters", "fixture.mjs"),
    `export const selectCandidates=()=>[];
export const issueContext=()=>{throw {reason:"missing-fixture-delivery-skill"}};
export const branchName=()=>"fixture";
export const pullRequest=()=>({});
export const requiredChecks=()=>[];
export const park=()=>{throw {reason:"fixture-park-unavailable"}};
export const mergeMethod=()=>({});
export const afterMerge=()=>{};\n`,
  );
  const repository = await loadRepositoryAdapter("fixture", adapterRoot);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);

  let reason = "queue-internal-error";
  try {
    await repository.issueContext({
      repository: config.repository,
      key: cycle.selection.key,
      number: cycle.selection.number,
      executorRoot: root,
    });
  } catch (error) {
    if (error instanceof QueueBlocked) reason = error.reason;
  }
  await expect(
    stopCycle(config, cycle, reason, 0, fakeAdapter(observation), repository),
  ).resolves.toBe("run");
  expect(observation.comments[0]).toContain("missing-fixture-delivery-skill");
  expect(observation.comments[0]).not.toContain("queue-internal-error");
  await expect(
    stopCycle(
      config,
      cycle,
      "implementation-attempt-ceiling-exhausted",
      1,
      fakeAdapter(observation),
      repository,
    ),
  ).rejects.toMatchObject({ reason: "fixture-park-unavailable" });
  expect(observation.comments[1]).toContain("fixture-park-unavailable");
  expect(observation.comments[1]).not.toContain("To unpark");
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
  await stopCycle(
    config,
    cycle,
    "synthetic-unmapped-reason",
    1,
    fakeAdapter(observation),
    repositoryPolicy,
    "provider refused the observation",
  );
  expect(observation.comments[0]).toContain("synthetic-unmapped-reason");
  expect(observation.comments[0]).toContain(resolve(config.stateRoot, config.run));
  expect(observation.comments[0]).toContain('Diagnostic: "provider refused the observation".');
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
    await stopCycle(config, cycle, reason, 1, adapter, repositoryPolicy);

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

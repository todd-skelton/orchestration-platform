import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { sourceFailureFixture, historicalStops, snapshot } from "./fixtures/source-failure.js";
import { queueStep } from "../../scripts/dogfood/queue.js";

const roots: string[] = [];

it.each(["terminal", "pending", "complete", "pilot-pending", "pilot-complete"] as const)(
  "retained source FAIL survives upgrade without source replay: %s",
  async (shape) => {
    const f = await sourceFailureFixture(5);
    roots.push(f.root);
    await f.fail();
    await historicalStops(f, shape);
    const old = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    await f.upgrade();
    // Old composition would enter the source flow with the new pilot revision.
    const replay = await f.compose(f.cycle);
    await expect(queueStep(replay.config, replay.adapter)).rejects.toMatchObject({
      reason: "pilot-revision-moved",
    });
    const calls = f.calls.length;
    const next = await f.advance();
    expect(next).toMatchObject({
      selection: { key: "fixture-159" },
      initialHistory: f.cycle.initialHistory,
    });
    expect(
      f.calls.slice(calls).every((call) => call.startsWith("park:") || call.startsWith("note:")),
    ).toBe(true);
    for (const [path, bytes] of old) expect(await readFile(path, "utf8"), path).toBe(bytes);
    for (const [path, bytes] of trees) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await f.advance()).toEqual(next);
    const names = await readdir(f.runState);
    expect(names.filter((name) => name.startsWith("fixture-110-attempt"))).toEqual([
      "fixture-110-attempt-1",
    ]);
    expect(names).not.toContain(
      `cycle-${f.cycle.selection.cycle}-stop-${shape.startsWith("pilot") ? 3 : 2}.json`,
    );
    expect(f.rows[0]).toMatchObject({ state: "OPEN", ready: false });
  },
);

it.each([false, true])("FAIL drains unrelated ready order: resumed=%s", async (resumed) => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  await f.fail();
  if (resumed) {
    await historicalStops(f, "pilot-pending");
    await f.upgrade();
  } else await f.stop();
  expect(await f.drain()).toEqual(["fixture-159", "fixture-160"]);
  expect(await f.drain()).toEqual([]);
  expect(f.rows.map(({ number, state, ready }) => ({ number, state, ready }))).toEqual([
    { number: 110, state: "OPEN", ready: false },
    { number: 159, state: "CLOSED", ready: false },
    { number: 160, state: "CLOSED", ready: false },
    { number: 999, state: "OPEN", ready: true },
  ]);
  expect(
    f.calls.filter((call) => call.startsWith("launch:") && call.endsWith("/110")),
  ).toHaveLength(1);
});
let runOrdinal = 0;
const command = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const hook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");

async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "supervise-command-fixture-")));
  roots.push(root);
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([stateRoot, worktreeRoot].map((path) => mkdir(path)));
  const config = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-command-run",
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: resolve(import.meta.dirname, "../.."),
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "claude-opus-5", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable: process.execPath,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  const request = resolve(root, "loop.json");
  const runState = resolve(stateRoot, config.run);
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    mkdir(runState, { recursive: true }).then(() =>
      Promise.all([
        writeFile(
          resolve(runState, "command-controls.json"),
          `${JSON.stringify({ main: "a".repeat(40) })}\n`,
        ),
        writeFile(
          resolve(runState, "command-issue.json"),
          `${JSON.stringify({
            state: "OPEN",
            key: "ISS-105",
            labels: ["ready"],
            comments: [],
          })}\n`,
        ),
      ]),
    ),
  ]);
  return { request, runState, worktreeRoot };
}

async function run(request: string) {
  const token = `command-${++runOrdinal}`;
  const stdoutPath = resolve(dirname(request), `${token}.stdout`);
  const stderrPath = resolve(dirname(request), `${token}.stderr`);
  const [stdoutFile, stderrFile] = await Promise.all([
    open(stdoutPath, "w"),
    open(stderrPath, "w"),
  ]);
  let code: number;
  try {
    code = await new Promise<number>((done, reject) => {
      let timedOut = false;
      const child = spawn(
        process.execPath,
        ["--import", pathToFileURL(hook).href, command, request],
        {
          windowsHide: true,
          stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
          env: {
            ...process.env,
            SUPERVISE_FIXTURE_STATE: resolve(request, "../state/synthetic-command-run"),
          },
        },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 25_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (status) => {
        clearTimeout(timer);
        done(timedOut ? 124 : (status ?? 1));
      });
    });
  } finally {
    await Promise.all([stdoutFile.close(), stderrFile.close()]);
  }
  return {
    code,
    stdout: await readFile(stdoutPath, "utf8"),
    stderr: await readFile(stderrPath, "utf8"),
  };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it("runs one selected issue through observation, completion and the next selection", async () => {
  const current = await fixture();
  const result = await run(current.request);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([
    { status: "observing-author", cursor: 0 },
    { status: "complete", cursor: 1, participants: 2 },
    { status: "idle", run: "synthetic-command-run" },
  ]);
}, 30_000);

async function savedSelection(options: {
  workspace: "stale" | "missing";
  successor?: boolean;
  state?: string;
  key?: string;
  observationStop?: string;
  pendingStop?: boolean;
  correctiveAttempt?: boolean;
}) {
  const current = await fixture();
  const { runState, worktreeRoot } = current;
  const selection = {
    cycle: 2,
    key: "ISS-129",
    number: 421,
    base: "1c50000722182d1345789849ec8271a02ef26249",
  };
  const prior = { cycle: 1, key: "ISS-128", number: 420, base: "a".repeat(40) };
  const history = Array.from({ length: options.correctiveAttempt ? 6 : 4 }, (_, index) => ({
    ordinal: index + 1,
    id: `saved-worker-${index + 1}`,
    item: index < 2 ? "ISS-128:1" : index < 4 ? "ISS-129:1" : "ISS-129:2",
    stage: "source",
    role: index % 2 === 0 ? "author" : "reviewer",
    outcome: options.correctiveAttempt && index === 3 ? "failed" : index === 5 ? "dead" : "passed",
    usage: {
      inputTokens: { status: "known", value: 123 },
      outputTokens: { status: "known", value: 45 },
      costUsd: { status: "unavailable" },
    },
  }));
  const preserved = new Map<string, string>();
  const save = async (path: string, value: unknown) => {
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    preserved.set(path, bytes);
  };
  await save(resolve(runState, "cycle-1-selected.json"), prior);
  await save(resolve(runState, "cycle-1-complete.json"), {
    selection: prior,
    history: history.slice(0, 2),
  });
  await save(resolve(runState, "cycle-2-selected.json"), selection);
  const stop = {
    selection,
    stop: 1,
    reason: "gate-failed:planning:board-check",
    attempts: 1,
    history: history.slice(0, 4),
    marker: "saved-stop-1",
    body: "Preserved first stop",
  };
  await save(resolve(runState, "cycle-2-stop-1.json"), stop);
  await save(resolve(runState, "cycle-2-stop-1-complete.json"), {
    selection,
    stop: 1,
    history: stop.history,
  });
  if (options.pendingStop !== false)
    await save(resolve(runState, "cycle-2-stop-2.json"), {
      ...stop,
      stop: 2,
      reason: "candidate-workspace-drift",
      marker: "saved-stop-2",
      body: "Preserved unfinished stop",
    });
  for (const attempt of options.correctiveAttempt ? [1, 2] : [1]) {
    const directory = resolve(runState, `iss-129-attempt-${attempt}`);
    const participants = history.slice(0, attempt === 1 ? 4 : 6);
    await save(resolve(directory, "attempt.json"), {
      phase: options.correctiveAttempt ? (attempt === 1 ? "failed" : "source") : "delivery",
      candidateAttempt: attempt,
      retries: 1,
      // Terminal history may be newer than the last queue step receipt.
      history: options.correctiveAttempt ? participants.slice(0, -1) : participants,
      findings: options.correctiveAttempt
        ? [{ file: "source.ts", line: 1, severity: "blocking", text: "Saved review" }]
        : [],
    });
    for (const participant of participants)
      await save(
        resolve(directory, `participant-${participant.ordinal}-terminal.json`),
        participant,
      );
    await save(resolve(directory, "source/candidate.json"), { head: "b".repeat(40) });
    await save(resolve(directory, "source/author-attempt.json"), { id: `saved-author-${attempt}` });
  }
  if (options.workspace === "stale")
    await save(
      resolve(
        worktreeRoot,
        `iss-129-attempt-${options.correctiveAttempt ? 2 : 1}-source/partial-edit.txt`,
      ),
      "unfinished work",
    );
  await writeFile(
    resolve(runState, "command-controls.json"),
    JSON.stringify({
      main: "a".repeat(40),
      observeImmediately: true,
      workspaceStops: {
        "ISS-129":
          options.workspace === "stale" ? "candidate-workspace-drift" : "source-worktree-missing",
      },
      issueObservations: {
        421: {
          state: options.state ?? "CLOSED",
          key: options.key ?? "ISS-129",
          labels: [],
          comments: [],
        },
      },
      issueObservationStops: options.observationStop ? { 421: options.observationStop } : {},
    }),
  );
  if (!options.successor)
    await writeFile(
      resolve(runState, "command-issue.json"),
      JSON.stringify({ state: "CLOSED", key: "ISS-105", labels: [], comments: [] }),
    );
  return { ...current, selection, history, preserved };
}

it.each(["stale", "missing"] as const)(
  "reconciles a saved closed selection with a %s workspace and pending stop, retaining history for its successor",
  async (workspace) => {
    const current = await savedSelection({ workspace, successor: true, correctiveAttempt: true });
    const result = await run(current.request);
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    const completionPath = resolve(current.runState, "cycle-2-complete.json");
    const completion = await readFile(completionPath, "utf8");
    expect(JSON.parse(completion)).toEqual({
      selection: current.selection,
      history: current.history,
    });
    const successor = JSON.parse(
      await readFile(resolve(current.runState, "cycle-3-complete.json"), "utf8"),
    );
    expect(successor.selection).toMatchObject({ cycle: 3, key: "ISS-105", number: 362 });
    expect(successor.history.slice(0, 6)).toEqual(current.history);
    expect(successor.history.map((row: { ordinal: number }) => row.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const calls = await readFile(resolve(current.runState, "command-calls.log"), "utf8");
    expect(calls.split("\n")[0]).toBe("issue:421");
    expect(calls).not.toContain("ISS-129");
    expect(calls).not.toContain("repair");
    expect(calls).toContain("source:ISS-105:1");
    expect(await readdir(resolve(current.runState, "iss-129-attempt-2/source"))).toEqual([
      "author-attempt.json",
      "candidate.json",
    ]);
    await expect(
      readFile(resolve(current.runState, "cycle-2-stop-2-complete.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    for (const [path, bytes] of current.preserved) expect(await readFile(path, "utf8")).toBe(bytes);

    const resumed = await run(current.request);
    expect(resumed).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(resumed.stdout)).toEqual({ status: "idle", run: "synthetic-command-run" });
    expect(await readFile(completionPath, "utf8")).toBe(completion);
    expect(await readFile(resolve(current.runState, "command-calls.log"), "utf8")).toBe(calls);
  },
);

it("reconciles external closure directly to exhausted idle without source or delivery evidence", async () => {
  const current = await savedSelection({ workspace: "missing" });
  for (let resume = 0; resume < 2; resume += 1) {
    const result = await run(current.request);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({ status: "idle", run: "synthetic-command-run" });
  }
  expect(await readFile(resolve(current.runState, "command-calls.log"), "utf8")).toBe(
    "issue:421\n",
  );
  expect(
    JSON.parse(await readFile(resolve(current.runState, "cycle-2-complete.json"), "utf8")),
  ).toEqual({
    selection: current.selection,
    history: current.history,
  });
  await expect(readFile(resolve(current.runState, "cycle-3-selected.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  for (const [path, bytes] of current.preserved) expect(await readFile(path, "utf8")).toBe(bytes);
});

it("resumes a still-open saved selection through ordinary source and delivery", async () => {
  const current = await fixture();
  await writeFile(
    resolve(current.runState, "cycle-1-selected.json"),
    `${JSON.stringify(
      {
        cycle: 1,
        key: "ISS-105",
        number: 362,
        base: "a".repeat(40),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(current.runState, "command-controls.json"),
    JSON.stringify({ observeImmediately: true }),
  );
  const result = await run(current.request);
  expect(result).toMatchObject({ code: 0, stderr: "" });
  const calls = await readFile(resolve(current.runState, "command-calls.log"), "utf8");
  expect(calls.split("\n").slice(0, 2)).toEqual(["issue:362", "workspace:ISS-105"]);
  expect(calls).toContain("source:ISS-105:1");
  expect(calls).toContain("delivery:ISS-105:1");
  expect(
    JSON.parse(await readFile(resolve(current.runState, "cycle-1-complete.json"), "utf8")).history,
  ).toHaveLength(2);
});

it.each([
  { state: "OPEN", reason: "candidate-workspace-drift", workspaceCalls: true },
  { state: "UNKNOWN", reason: "issue-observation-unavailable", workspaceCalls: false },
  {
    observationStop: "issue-observation-unavailable",
    reason: "issue-observation-unavailable",
    workspaceCalls: false,
  },
  { key: "ISS-999", reason: "selected-issue-identity-drift", workspaceCalls: false },
])("does not reconcile $reason as closure", async ({ reason, workspaceCalls, ...observation }) => {
  const current = await savedSelection({ workspace: "stale", pendingStop: false, ...observation });
  const result = await run(current.request);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "blocked", reason });
  await expect(readFile(resolve(current.runState, "cycle-2-complete.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(resolve(current.runState, "cycle-3-selected.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const calls = await readFile(resolve(current.runState, "command-calls.log"), "utf8");
  expect(calls.includes("workspace:ISS-129")).toBe(workspaceCalls);
  expect(calls).not.toContain("source:");
  for (const [path, bytes] of current.preserved) expect(await readFile(path, "utf8")).toBe(bytes);
});

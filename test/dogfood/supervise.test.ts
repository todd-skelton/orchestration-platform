import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { prerequisiteFixture, prerequisiteProof } from "./fixtures/prerequisite.js";
import {
  sourceFailureFixture,
  repairFailureFixture,
  historicalStops,
  snapshot,
} from "./fixtures/source-failure.js";

const roots: string[] = [];

it("ISS-187 enters through the supervisory command, completes one detour and holds the saved cycle", async () => {
  const f = await prerequisiteFixture();
  roots.push(f.root);
  const entry = resolve(f.repository, "scripts/dogfood/supervise.mjs");
  await writeFile(entry, await readFile(command));
  await f.git(f.repository, ["add", "scripts/dogfood/supervise.mjs"]);
  await f.git(f.repository, ["commit", "-m", "synthetic canonical entry"]);
  const config = resolve(f.root, "loop.json");
  const control = resolve(f.root, "command-control.json");
  await writeFile(config, JSON.stringify(f.loop));
  await writeFile(
    control,
    JSON.stringify({ rows: f.rows, gitExecutable: f.loop.gitExecutable, launches: [] }),
  );
  const hook = resolve(import.meta.dirname, "supervise-fixtures/prerequisite.mjs");
  let invocation = 0;
  const invoke = async () => {
    const outPath = resolve(f.root, `invoke-${++invocation}.stdout`);
    const errPath = resolve(f.root, `invoke-${invocation}.stderr`);
    const [stdout, stderr] = await Promise.all([open(outPath, "wx"), open(errPath, "wx")]);
    let code: number | null;
    try {
      code = await new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", pathToFileURL(hook).href, entry, config],
          {
            env: { ...process.env, PREREQUISITE_FIXTURE: control },
            stdio: ["ignore", stdout.fd, stderr.fd],
          },
        );
        child.on("error", reject);
        child.on("close", done);
      });
    } finally {
      await Promise.all([stdout.close(), stderr.close()]);
    }
    return { code, output: (await readFile(outPath, "utf8")) + (await readFile(errPath, "utf8")) };
  };
  const before = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  const result = await invoke();
  expect(result.output).toContain('"status":"complete"');
  expect(result.output).toContain('"reason":"prerequisite-held"');
  expect(result.code).toBe(1);
  const after = await snapshot(f.runState);
  for (const [path, bytes] of before)
    if (path !== resolve(f.current.config.stateDirectory, "attempt.json"))
      expect(after.get(path), path).toBe(bytes);
  const effects = await readFile(control, "utf8");
  expect(JSON.parse(effects).launches).toEqual([
    { role: "author", issue: "https://github.com/fixture/repository/issues/110" },
    { role: "reviewer", issue: "https://github.com/fixture/repository/issues/110" },
  ]);
  expect((await invoke()).output).toContain('"reason":"prerequisite-held"');
  expect(await readFile(control, "utf8")).toBe(effects);
  expect(await snapshot(f.runState)).toEqual(after);
  await prerequisiteProof(f, before, trees, "supervisory-entry");
});

it.each(["terminal", "pending", "complete", "pilot-pending", "pilot-complete"] as const)(
  "retained native repair FAIL parks without replay and drains unrelated work: %s",
  async (shape) => {
    const f = await repairFailureFixture();
    roots.push(f.root);
    await f.fail();
    expect(f.cycle.initialHistory).toHaveLength(6);
    expect(f.cycle.initialHistory.slice(-4)).toMatchObject([
      { role: "author", outcome: "passed" },
      { role: "reviewer", outcome: "malformed" },
      { ordinal: 5, role: "reviewer", stage: "source", outcome: "failed" },
      { ordinal: 6, role: "author", stage: "repair", outcome: "failed" },
    ]);
    await historicalStops(f, shape);
    const old = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    const launches = f.calls.filter((c) => c.startsWith("launch:"));
    if (shape === "terminal") {
      expect(await f.stop()).toBe("item");
      expect(f.rows[0]!.comments.at(-1)).toContain("3 implementation attempts");
    } else await f.upgrade();
    expect(await f.advance()).toMatchObject({
      selection: { key: "fixture-159" },
      initialHistory: f.cycle.initialHistory,
    });
    expect(f.rows[0]).toMatchObject({ ready: false, state: "OPEN" });
    const notes = [...f.rows[0]!.comments];
    await f.advance();
    expect(f.rows[0]!.comments).toEqual(notes);
    expect(f.calls.filter((c) => c.startsWith("launch:"))).toEqual(launches);
    for (const [path, bytes] of old) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
    expect(await f.drain()).toEqual(["fixture-159", "fixture-160"]);
    expect(await f.drain()).toEqual([]);
  },
);

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

// ISS-164: the attached parent and its private request stream. A Node child
// (parent.mjs) stands in for the Windows parent with the same redirected stdio
// shape; the real PowerShell/wsl.exe path is host-owned evidence after merge.
const parentScript = resolve(import.meta.dirname, "supervise-fixtures/parent.mjs");
const syntheticEntry = resolve(import.meta.dirname, "supervise-fixtures/synthetic-supervisor.mjs");
const incumbent = resolve(import.meta.dirname, "supervise-fixtures/incumbent.mjs");
const syntheticRun = "synthetic-native-component";
const hex = (seed: string, length: number) =>
  createHash("sha256").update(seed).digest("hex").slice(0, length);
let parentOrdinal = 0;

type ParentControl = {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  verifierWorktree?: {
    worktree: string;
    branch: string;
    head: string;
    wrapper: string;
    artifacts: string;
  };
  loss?: boolean;
};
type ParentRecord = {
  lines: Record<string, unknown>[];
  requests: { correlation: number; path: string }[];
  replies: Record<string, unknown>[];
  incumbent: { correlation: number; exit: number | null }[];
  unaccepted: string[];
  stderr: string;
  exit: { code: number | null; signal: string | null } | null;
  startFailure?: string;
  loss?: boolean;
  cancelled?: boolean;
};

function startParent(root: string, control: ParentControl) {
  const token = `parent-${++parentOrdinal}`;
  const controlPath = resolve(root, `${token}.json`);
  const record = resolve(root, `${token}.record.json`);
  const ready = writeFile(controlPath, JSON.stringify({ ...control, record }));
  const child = ready.then(() =>
    spawn(process.execPath, [parentScript, controlPath], {
      windowsHide: true,
      stdio: [process.platform === "win32" ? "pipe" : "ignore", "pipe", "pipe"],
    }),
  );
  const done = child.then(
    (parent) =>
      new Promise<{ code: number | null; record: ParentRecord }>((done, reject) => {
        let stderr = "";
        parent.stderr!.setEncoding("utf8");
        parent.stderr!.on("data", (chunk) => (stderr += chunk));
        parent.once("error", reject);
        parent.once("close", async (code) => {
          try {
            done({ code, record: JSON.parse(await readFile(record, "utf8")) });
          } catch (error) {
            reject(new Error(`parent exited ${code} without a record: ${stderr}`));
          }
        });
      }),
  );
  return { child, done };
}

async function syntheticRuntime(control: {
  mode?: string;
  incumbentMode?: string;
  wrapper?: string | null;
  anchor?: boolean;
  workerJson?: Record<string, unknown>;
  loss?: boolean;
  executable?: string;
}) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "native-db-harness-")));
  roots.push(root);
  const runtime = resolve(root, "runtime");
  const approved = resolve(root, "approved");
  await Promise.all([mkdir(runtime), mkdir(approved)]);
  await Promise.all([
    copyFile(command, resolve(runtime, "supervise.mjs")),
    copyFile(syntheticEntry, resolve(runtime, "synthetic-supervisor.mjs")),
  ]);
  const anchor = {
    worktree: resolve(root, "anchor"),
    branch: "synthetic/anchor",
    head: hex("synthetic anchor head", 40),
    wrapper: control.wrapper === undefined ? incumbent : (control.wrapper ?? ""),
    artifacts: resolve(root, "anchor/.orchestrator/native-db"),
  };
  const body = {
    profile: "reconciliation-pg16/v1",
    run: syntheticRun,
    issue: 2147483647,
    attempt: 1,
    executorHead: hex("synthetic executor head", 40),
    product: {
      repository: "synthetic/native-component",
      head: hex("synthetic product head", 40),
      tree: hex("synthetic product tree", 40),
    },
    declaration: {
      version: 1,
      profile: "reconciliation-pg16/v1",
      files: ["one", "two", "three"].map((name) => ({
        file: `reconciliation/${name}.db.test.ts`,
        cases: [`${name} reconciles`],
      })),
      mutants: [],
    },
    patchDigests: [],
    stagedInputDirectory: resolve(approved, "staged-input"),
  };
  const results = resolve(root, "results.json");
  const parent = startParent(root, {
    executable: control.executable ?? process.execPath,
    args: ["--import", pathToFileURL(hook).href, resolve(runtime, "synthetic-supervisor.mjs")],
    env: {
      SYNTHETIC_CONTROL: JSON.stringify({
        mode: control.mode ?? "request",
        run: syntheticRun,
        approvedParents: [approved],
        results,
        body,
        ...(control.workerJson ? { workerJson: control.workerJson } : {}),
      }),
      ...(control.incumbentMode ? { INCUMBENT_MODE: control.incumbentMode } : {}),
    },
    ...(control.anchor === false ? {} : { verifierWorktree: anchor }),
    ...(control.loss ? { loss: true } : {}),
  });
  return { root, anchor, body, results, ...parent };
}

async function eventually<T>(read: () => Promise<T>) {
  for (let count = 0; ; count += 1) {
    try {
      return await read();
    } catch (error) {
      if (count === 100) throw error;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}

it("production main offers the channel through the attached parent and never requests", async () => {
  const current = await fixture();
  const root = dirname(current.request);
  const { done } = startParent(root, {
    executable: process.execPath,
    args: ["--import", pathToFileURL(hook).href, command, current.request],
    env: { SUPERVISE_FIXTURE_STATE: current.runState },
    verifierWorktree: {
      worktree: resolve(root, "anchor"),
      branch: "synthetic/anchor",
      head: hex("anchor", 40),
      wrapper: incumbent,
      artifacts: resolve(root, "anchor/.orchestrator/native-db"),
    },
  });
  const { code, record } = await done;
  expect(record.stderr).toBe("");
  expect(code).toBe(0);
  expect(record.lines).toMatchObject([
    { status: "observing-author", cursor: 0 },
    { status: "complete", cursor: 1, participants: 2 },
    { status: "idle", run: "synthetic-command-run" },
  ]);
  expect(record).toMatchObject({ requests: [], replies: [], unaccepted: [] });
  // Inventory: main creates and closes the channel; only the test harness
  // requests. Item stops advancing the same run are the source-failure cases above.
  const source = await readFile(command, "utf8");
  expect(source.match(/createNativeDbAdmission\(/g)).toHaveLength(2);
  expect(source).not.toMatch(/admission\.request\(/);
  expect(source).toMatch(/admission\?\.close\(\)/);
}, 30_000);

it("copied-runtime harness requests once through the actual stream and reaches the inert incumbent", async () => {
  const workerJson = {
    type: "item.completed",
    item: { type: "agent_message", text: '{"verdict":"PASS"}' },
  };
  const current = await syntheticRuntime({ workerJson });
  const { code, record } = await current.done;
  expect(record.stderr).toBe("");
  expect(code).toBe(0);
  const results = JSON.parse(await readFile(current.results, "utf8"));
  const evidencePath = resolve(current.anchor.worktree, ".orchestrator/native-db/evidence-1");
  expect(results).toEqual([
    {
      correlation: 1,
      status: "completed",
      owner: {
        lockId: "0123456789abcdef0123456789abcdef",
        head: current.anchor.head,
        lane: syntheticRun,
      },
      evidencePath,
      diagnostic: null,
    },
  ]);
  expect(record.requests).toEqual([
    { correlation: 1, path: resolve(current.anchor.artifacts, `${syntheticRun}-1.json`) },
  ]);
  expect(JSON.parse(await readFile(record.requests[0]!.path, "utf8"))).toEqual({
    schemaVersion: "dogfood-native-db-request/v1",
    correlation: 1,
    ...current.body,
  });
  expect(record.replies).toEqual([
    {
      schemaVersion: "dogfood-native-db-reply/v1",
      correlation: 1,
      status: "completed",
      owner: {
        lockId: "0123456789abcdef0123456789abcdef",
        head: current.anchor.head,
        lane: syntheticRun,
      },
      evidencePath,
      diagnostic: null,
    },
  ]);
  // Worker-shaped JSON on the stream is a status line at most, never a request.
  expect(record.lines).toEqual([
    { status: "observing-author", cursor: 0 },
    workerJson,
    { status: "idle", run: syntheticRun },
  ]);
  expect(record.unaccepted).toEqual([]);
});

it("a second request in the same run gets the next correlation and its own request file", async () => {
  const current = await syntheticRuntime({ mode: "twice" });
  const { code, record } = await current.done;
  expect(code).toBe(0);
  const results = JSON.parse(await readFile(current.results, "utf8"));
  expect(
    results.map((r: { correlation: number; status: string }) => [r.correlation, r.status]),
  ).toEqual([
    [1, "completed"],
    [2, "completed"],
  ]);
  expect(record.requests.map((r) => r.correlation)).toEqual([1, 2]);
  expect(results[1].evidencePath).toBe(
    resolve(current.anchor.worktree, ".orchestrator/native-db/evidence-2"),
  );
});

it.each([
  { incumbentMode: "unknown", diagnostic: "synthetic incumbent could not determine the outcome" },
  { incumbentMode: "no-reply", diagnostic: "native-db-runner-no-reply" },
  { incumbentMode: "crash", diagnostic: "native-db-runner-no-reply" },
  { incumbentMode: "foreign-correlation", diagnostic: "native-db-runner-reply-invalid" },
  { incumbentMode: "outside-anchor", diagnostic: "native-db-runner-evidence-outside-anchor" },
])(
  "an incumbent outcome of $incumbentMode is unknown, never completion",
  async ({ incumbentMode, diagnostic }) => {
    const current = await syntheticRuntime({ incumbentMode });
    const { code, record } = await current.done;
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(current.results, "utf8"))).toEqual([
      { correlation: 1, status: "unknown", owner: null, evidencePath: null, diagnostic },
    ]);
    expect(record.requests).toHaveLength(1);
    expect(record.incumbent).toEqual([{ correlation: 1, exit: incumbentMode === "crash" ? 7 : 0 }]);
  },
);

it.each([
  { name: "absent runner", control: { wrapper: null }, diagnostic: "native-db-runner-absent" },
  { name: "absent anchor", control: { anchor: false }, diagnostic: "native-db-anchor-unsupported" },
])("$name is a typed refusal without a written request", async ({ control, diagnostic }) => {
  const current = await syntheticRuntime(control);
  const { code, record } = await current.done;
  expect(code).toBe(0);
  expect(JSON.parse(await readFile(current.results, "utf8"))).toEqual([
    { correlation: 1, status: "refused", owner: null, evidencePath: null, diagnostic },
  ]);
  expect(record.requests).toEqual([]);
  await expect(readdir(current.anchor.artifacts)).rejects.toMatchObject({ code: "ENOENT" });
});

it("parent loss during a request resolves unknown with the channel diagnostic", async () => {
  const current = await syntheticRuntime({ loss: true });
  const { code, record } = await current.done;
  expect(code).toBe(3);
  expect(record.loss).toBe(true);
  expect(record.replies).toEqual([]);
  const results = await eventually(async () => JSON.parse(await readFile(current.results, "utf8")));
  expect(results).toEqual([
    {
      correlation: 1,
      status: "unknown",
      owner: null,
      evidencePath: null,
      diagnostic: "native-db-channel-closed",
    },
  ]);
});

it("no request after close and no concurrent request ever reaches the parent", async () => {
  const closed = await syntheticRuntime({ mode: "after-close" });
  const closedOutcome = await closed.done;
  expect(closedOutcome.record.requests).toEqual([]);
  expect(JSON.parse(await readFile(closed.results, "utf8"))).toEqual([
    {
      correlation: null,
      status: "refused",
      owner: null,
      evidencePath: null,
      diagnostic: "native-db-channel-closed",
    },
  ]);
  const concurrent = await syntheticRuntime({ mode: "concurrent" });
  const concurrentOutcome = await concurrent.done;
  expect(concurrentOutcome.code).toBe(0);
  expect(concurrentOutcome.record.requests).toHaveLength(1);
  expect(JSON.parse(await readFile(concurrent.results, "utf8"))).toMatchObject([
    { correlation: 1, status: "completed" },
    { correlation: null, status: "refused", diagnostic: "native-db-request-pending" },
  ]);
});

it("cancelling the parent ends the stream and both processes exit", async () => {
  const current = await syntheticRuntime({ mode: "hold" });
  const parent = await current.child;
  await new Promise((done) => setTimeout(done, 500));
  // Ctrl+C on POSIX; Windows has no catchable signal, so the stand-in's stdin ends.
  if (process.platform === "win32") parent.stdin!.end();
  else parent.kill("SIGTERM");
  const { code, record } = await current.done;
  expect(record.cancelled).toBe(true);
  expect(record.exit).toEqual({ code: 0, signal: null });
  expect(code).toBe(0);
  expect(record.lines.at(-1)).toEqual({ status: "idle", run: syntheticRun });
  expect(JSON.parse(await readFile(current.results, "utf8"))).toEqual([
    { status: "unknown", diagnostic: "native-db-channel-closed" },
  ]);
});

it("a supervisor that fails to start ends the parent with a diagnostic", async () => {
  const current = await syntheticRuntime({ executable: resolve(tmpdir(), "missing-executor") });
  const { code, record } = await current.done;
  expect(code).toBe(1);
  expect(record.startFailure).toContain("ENOENT");
  expect(record.exit).toBeNull();
});

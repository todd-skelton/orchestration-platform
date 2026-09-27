import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { formatStatus, observeStatus, observeSupervisor } from "../../scripts/dogfood/status.mjs";
import { controlLoop } from "../../scripts/dogfood/control.mjs";
import { requestPause, pauseBeforeSelection } from "../../scripts/dogfood/pause.mjs";

const roots: string[] = [];
const now = Date.parse("2026-09-27T12:00:00Z");
const run = "status-fixture";
const repository = "chase-sets/chase-sets";
const issue = `https://github.com/${repository}/issues/7820`;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function put(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "loop-status-"));
  roots.push(root);
  const config = resolve(root, "loop.json");
  const state = resolve(root, "runtime", run);
  const source = resolve(state, "cs-7820-attempt-1/source");
  await mkdir(source, { recursive: true });
  await put(config, {
    schemaVersion: "dogfood-loop/v1",
    run,
    repository,
    adapter: "chase-sets",
    targetMilestone: 155,
    stateRoot: resolve(root, "runtime"),
  });
  await put(resolve(state, "cycle-1-selected.json"), {
    cycle: 1,
    key: "cs-7820",
    number: 7820,
    base: "a".repeat(40),
  });
  await put(resolve(source, "../attempt.json"), {
    run,
    issue,
    candidateAttempt: 1,
    phase: "source",
    stateDirectory: null,
  });
  await put(resolve(source, "author-attempt.json"), {
    id: "author",
    pid: 20,
    trace: resolve(source, "author.jsonl"),
    launchedAt: now - 60_000,
  });
  const log = resolve(root, "supervisor.log");
  const events = async (...rows: unknown[]) =>
    writeFile(log, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await events({
    run,
    pid: 10,
    status: "supervisor-started",
    observedAt: new Date(now - 90_000).toISOString(),
  });
  const preview = async () => ({
    candidates: [],
    scope: { number: 155 },
    outstanding: [{ key: "cs-7820", number: 7820, reasons: ["status:needs-operator"] }],
  });
  const supervisor = async () => ({ status: "running", pid: 10 });
  const observe = (options = {}) => observeStatus(config, { now, supervisor, preview, ...options });
  return { root, config, state, source, log, events, observe };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const row of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, row.name);
    if (row.isDirectory()) Object.assign(result, await snapshot(path));
    else result[path] = await readFile(path, "utf8");
  }
  return result;
}

it("observes an active author without mutation and does not count polling/log growth as progress", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  const first = await f.observe();
  expect(await snapshot(f.root)).toEqual(before);
  expect(first).toMatchObject({
    status: "running",
    phase: "observing-author",
    current: { attempt: 1 },
    progress: { ageSeconds: 60 },
    worker: { role: "author" },
  });
  await f.events(
    { run, pid: 10, status: "supervisor-started" },
    { run, pid: 10, status: "observing-author", observedAt: new Date(now).toISOString() },
  );
  const later = await f.observe({ now: now + 20_000 });
  expect(later.progress).toEqual({ ...first.progress, ageSeconds: 80 });
  expect(formatStatus(later)).toContain("worker health unknown");
  expect(formatStatus(later)).toContain("current, not reserved");
  const completion = { run, status: "complete", cursor: 1, items: 1, participants: 2 };
  await f.events(
    { ...completion, observedAt: new Date(now - 10_000).toISOString() },
    { ...completion, observedAt: new Date(now).toISOString() },
  );
  expect(await f.observe()).toMatchObject({ progress: { event: "complete", ageSeconds: 10 } });
  await writeFile(
    f.log,
    "x".repeat(1024 * 1024 + 1) +
      "\n" +
      JSON.stringify({ ...completion, observedAt: new Date(now).toISOString() }) +
      "\n",
  );
  expect(await f.observe()).toMatchObject({
    progress: { event: "author-launched", ageSeconds: 60 },
    progressMeaning: expect.stringContaining("truncated"),
  });
});

it("reports pending and acknowledged operator pause separately from process suspension", async () => {
  const f = await fixture();
  const loop = JSON.parse(await readFile(f.config, "utf8"));
  await requestPause(loop);
  const pending = await f.observe();
  expect(pending.status).toBe("running");
  expect(pending.pause.requestedAt).toEqual(expect.any(String));
  expect(pending.pause.acknowledgedAt).toBeNull();
  expect(formatStatus(pending)).toContain("pending (current issue continues)");
  await expect(pauseBeforeSelection(loop)).rejects.toThrow("pause-after-current");
  await f.events({ status: "paused", run, pid: 10 });
  const supervisor = async () => ({ status: "exited", pid: null });
  const paused = await f.observe({ supervisor });
  expect(paused.status).toBe("paused");
  expect(paused.pause.acknowledgedAt).toEqual(expect.any(String));
  await controlLoop(f.config, "resume", supervisor);
  expect((await f.observe({ supervisor })).pause).toMatchObject({
    requestedAt: null,
    acknowledgedAt: null,
  });
  // A new request cannot inherit the preceding acknowledgement.
  await requestPause(loop);
  expect((await f.observe({ supervisor })).pause.acknowledgedAt).toBeNull();
});

it("observes reviewer and check waits, retaining PR/check/deploy links without claiming green", async () => {
  const f = await fixture();
  await put(resolve(f.source, "author-terminal.json"), { status: "passed" });
  await put(resolve(f.source, "reviewer-attempt.json"), {
    pid: 21,
    trace: "review.jsonl",
    launchedAt: now - 30_000,
  });
  expect(await f.observe()).toMatchObject({
    phase: "observing-reviewer",
    progress: { ageSeconds: 30 },
    paths: { workerTrace: "review.jsonl" },
  });
  await put(resolve(f.source, "reviewer-terminal.json"), { status: "passed" });
  await put(resolve(f.source, "publication.json"), {
    number: 12,
    url: "https://github.com/chase-sets/chase-sets/pull/12",
    head: "b".repeat(40),
  });
  const publication = async () => ({
    status: "observed",
    pr: "https://github.com/chase-sets/chase-sets/pull/12",
    checks: [{ name: "PR Required", status: "PENDING", url: "https://github.com/check/12" }],
    deploy: [],
  });
  const waiting = await f.observe({ publication });
  expect(waiting.phase).toBe("observing-hosted-checks");
  expect(formatStatus(waiting)).toContain("https://github.com/check/12");
  await put(resolve(f.source, "merge.json"), { mergeCommit: "c".repeat(40) });
  expect(await f.observe({ publication })).toMatchObject({
    phase: "deploy-or-cleanup",
    completeness: "incomplete",
  });
});

it("shows a dead supervisor with saved work and a stop's recorded action", async () => {
  const f = await fixture();
  const supervisor = async () => ({ status: "exited", pid: null });
  expect(await f.observe({ supervisor })).toMatchObject({
    status: "exited",
    phase: "observing-author",
    operatorAction: expect.stringContaining("Saved work remains"),
  });
  await put(resolve(f.state, "cycle-1-stop-1.json"), {
    reason: "provider-unavailable",
    body: "Restore provider access, then authorize resume.",
  });
  expect(await f.observe({ supervisor })).toMatchObject({
    status: "stopped",
    stop: {
      reason: "provider-unavailable",
      operatorAction: "Restore provider access, then authorize resume.",
    },
  });
  // A parked item need not have a cycle completion. Keep its stop visible
  // even after selection finds no more work, alongside the historical idle.
  await put(resolve(f.state, "cycle-1-stop-1.json"), {
    reason: "continuation-failed",
    body: "Inspect the failed continuation and explicitly unpark.",
  });
  await put(resolve(f.state, "cycle-1-stop-1-complete.json"), { stop: 1 });
  await f.events({ run, status: "idle" });
  const parked = await f.observe({ supervisor });
  expect(parked).toMatchObject({
    status: "stopped",
    current: { key: "cs-7820" },
    stop: { reason: "continuation-failed" },
    lastLogObservation: { status: "idle", observedAt: null },
  });
  expect(formatStatus(parked)).toContain("Last run log: idle at unknown time");
});

it("reports provider waiting and OS suspension, not healthy delivery progress", async () => {
  const f = await fixture();
  await f.events(
    { run, pid: 10, status: "supervisor-started" },
    { run, pid: 10, issue, status: "waiting-provider", observedAt: new Date(now).toISOString() },
  );
  expect(await f.observe()).toMatchObject({
    phase: "waiting-provider",
    progress: { ageSeconds: 60 },
  });
  expect(
    await f.observe({ supervisor: async () => ({ status: "paused", pid: 10 }) }),
  ).toMatchObject({ status: "paused", phase: "waiting-provider" });
});

it("ignores old foreign logs and same-run final lines preceding a new live invocation", async () => {
  const f = await fixture();
  await f.events({ run: "old-run", status: "idle" }, { status: "blocked", reason: "old-stop" });
  expect(await f.observe()).toMatchObject({
    status: "running",
    stop: null,
    phase: "observing-author",
  });
  await f.events({ run, status: "idle", pid: 9 }, { run, status: "waiting-provider", pid: 9 });
  expect(await f.observe()).toMatchObject({
    status: "running",
    stop: null,
    phase: "observing-author",
  });
});

it("keeps scoped idle incomplete when current admitted work needs an operator", async () => {
  const f = await fixture();
  await put(resolve(f.state, "cycle-1-complete.json"), { selection: { cycle: 1 } });
  await f.events({ run, status: "idle" });
  const result = await f.observe({ supervisor: async () => ({ status: "exited", pid: null }) });
  expect(result).toMatchObject({
    status: "idle/exited",
    current: null,
    completeness: "incomplete",
    preview: {
      reservation: false,
      outstanding: [{ url: issue, reasons: ["status:needs-operator"] }],
    },
  });
  await f.events({
    run,
    status: "blocked",
    reason: "current-main-unavailable",
    diagnostics: "Restore access before resume.",
  });
  expect(
    await f.observe({ supervisor: async () => ({ status: "exited", pid: null }) }),
  ).toMatchObject({ status: "stopped", stop: { reason: "current-main-unavailable" } });
});

it("uses the completed attempt's publication and trace after cycle completion", async () => {
  const f = await fixture();
  const attemptPath = resolve(f.source, "../attempt.json");
  await put(attemptPath, {
    ...JSON.parse(await readFile(attemptPath, "utf8")),
    phase: "complete",
    stateDirectory: f.source,
  });
  await put(resolve(f.source, "publication.json"), { number: 12, url: "delivered-pr" });
  const later = resolve(f.state, "cs-7820-attempt-2/source");
  await put(resolve(later, "../attempt.json"), {
    run,
    issue,
    candidateAttempt: 2,
    phase: "source",
  });
  await put(resolve(later, "author-attempt.json"), {
    trace: "unfinished.jsonl",
    launchedAt: now - 5_000,
  });
  await put(resolve(later, "publication.json"), { number: 13, url: "other-pr" });
  const publication = async (_loop: unknown, saved: { url: string }) => ({
    status: "observed",
    pr: saved.url,
    checks: [],
    deploy: [],
  });
  expect(await f.observe({ publication })).toMatchObject({
    current: { attempt: 2 },
    paths: { workerTrace: "unfinished.jsonl" },
  });
  await put(resolve(f.state, "cycle-1-complete.json"), { selection: { cycle: 1 } });
  const before = await snapshot(f.root);
  const result = await f.observe({ publication });
  expect(result).toMatchObject({
    current: null,
    phase: "cycle-complete",
    paths: { attempt: attemptPath, workerTrace: resolve(f.source, "author.jsonl") },
    progress: { ageSeconds: 60 },
    links: { pr: "delivered-pr" },
    historicalPublications: [{ attempt: 2, url: "other-pr" }],
  });
  expect(formatStatus(result).split("\n")[0]).toBe(`${run} - running; cycle-complete`);
  expect(formatStatus(result)).toContain("Other attempt 2 PR other-pr (historical)");
  expect(await snapshot(f.root)).toEqual(before);
});

it.for([false, true])(
  "passes literal WSL argv without a shell through PowerShell (JSON: %s)",
  async (json, context) => {
    const exec = promisify(execFile);
    try {
      await exec("pwsh", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$PSVersionTable.PSVersion.Major",
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return context.skip();
      throw error;
    }
    const root = await mkdtemp(resolve(tmpdir(), "status-powershell-"));
    roots.push(root);
    const source = await readFile(
      resolve(import.meta.dirname, "../../scripts/executor/status-loop.ps1"),
      "utf8",
    );
    const launch = "$child = [System.Diagnostics.Process]::Start($info)";
    expect(source).toContain(launch);
    // Stop only at the process boundary: exercise the wrapper's actual
    // PowerShell argument construction without starting WSL or a live run.
    const script = resolve(root, "capture.ps1");
    await writeFile(
      script,
      source.replace(
        launch,
        `
        [pscustomobject]@{
          executable = $info.FileName
          arguments = @($info.ArgumentList)
          shell = $info.UseShellExecute
          stdout = $info.RedirectStandardOutput
          wslenv = $info.Environment["WSLENV"]
        } | ConvertTo-Json -Compress
        exit 0
      `,
      ),
    );
    const config = '/root/status fixtures/loop;$PATH "quoted".json';
    const executor = '/root/executor fixtures/with;$@ "quotes"';
    const { stdout, stderr } = await exec(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
        "-Config",
        config,
        "-ExecutorRoot",
        executor,
        ...(json ? ["-Json"] : []),
      ],
      { windowsHide: true, env: { ...process.env, WSLENV: "STATUS_FIXTURE" } },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      executable: "C:\\Windows\\System32\\wsl.exe",
      arguments: [
        "-d",
        "Ubuntu",
        "--exec",
        "/usr/bin/env",
        "PATH=/root/orchestration-m1/tools/git/bin:/root/orchestration-m1/tools/node-v24.15.0-linux-x64/bin:/root/orchestration-m1/tools/gh_2.93.0_linux_amd64/bin:/usr/local/bin:/usr/bin:/bin",
        "/root/orchestration-m1/tools/node-v24.15.0-linux-x64/bin/node",
        `${executor}/scripts/dogfood/status.mjs`,
        config,
        ...(json ? ["--json"] : []),
      ],
      shell: false,
      stdout: true,
      wslenv: "",
    });
  },
);

it("keeps inaccessible runtime/process/GitHub and absent progress timestamps unknown", async () => {
  const f = await fixture();
  await put(resolve(f.source, "author-attempt.json"), { pid: 20, trace: "trace.jsonl" });
  const result = await f.observe({
    supervisor: async () => ({ status: "unavailable", pid: null }),
    preview: async () => {
      throw new Error("GitHub unavailable");
    },
  });
  expect(result).toMatchObject({
    status: "unavailable",
    progress: { at: null, ageSeconds: null },
    completeness: "unknown",
    preview: { status: "unavailable" },
  });
  await rm(f.state, { recursive: true });
  const missing = await f.observe({
    supervisor: async () => ({ status: "unavailable", pid: null }),
  });
  expect(missing.unavailable).toContain(`${f.state}: ENOENT`);
  expect(missing.current).toBeNull();
});

it("follows current refresh records to a delta reviewer instead of selecting by file age", async () => {
  const f = await fixture();
  const directory = resolve(f.source, `refresh-${"d".repeat(40)}`);
  await put(resolve(f.source, "author-terminal.json"), { status: "passed" });
  await put(resolve(f.source, "native-refresh.json"), { directory });
  await put(resolve(directory, "reviewer-attempt.json"), {
    pid: 23,
    trace: "delta.jsonl",
    launchedAt: now - 5_000,
  });
  expect(await f.observe()).toMatchObject({
    phase: "observing-reviewer",
    paths: { workerTrace: "delta.jsonl" },
  });
});

it.skipIf(process.platform === "win32")(
  "reads process identity and paused state without sending a signal",
  async () => {
    const f = await fixture();
    const proc = resolve(f.root, "proc");
    const pid = resolve(proc, "100");
    await mkdir(pid, { recursive: true });
    await writeFile(resolve(pid, "cmdline"), `node\0scripts/dogfood/supervise.mjs\0${f.config}\0`);
    await symlink(f.root, resolve(pid, "cwd"));
    await writeFile(resolve(pid, "stat"), "100 (node) T 1 2 3");
    expect(await observeSupervisor(f.config, proc)).toEqual({ status: "paused", pid: 100 });
    const alias = resolve(f.root, "alias.json");
    await writeFile(alias, await readFile(f.config));
    await writeFile(resolve(pid, "cmdline"), `node\0scripts/dogfood/supervise.mjs\0${alias}\0`);
    expect(await observeSupervisor(f.config, proc)).toEqual({ status: "paused", pid: 100 });
    await expect(
      controlLoop(f.config, "start", (path) => observeSupervisor(path, proc)),
    ).rejects.toThrow("supervisor-paused");
    await put(alias, { run: "other-run", stateRoot: f.root });
    expect(await observeSupervisor(f.config, proc)).toEqual({ status: "exited", pid: null });
    await writeFile(
      resolve(pid, "cmdline"),
      "node\0scripts/dogfood/supervise.mjs\0/another/config\0",
    );
    expect(await observeSupervisor(f.config, proc)).toEqual({ status: "unavailable", pid: null });
    expect(await observeSupervisor(f.config, resolve(proc, "missing"))).toMatchObject({
      status: "unavailable",
    });
    await mkdir(resolve(proc, "1"));
    await writeFile(resolve(proc, "1/cmdline"), "bwrap\0--unshare-pid\0");
    expect(await observeSupervisor(f.config, proc)).toMatchObject({
      status: "unavailable",
      diagnostic: expect.stringContaining("private-process-namespace"),
    });
  },
);

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { observeStatus } from "../../scripts/dogfood/status.mjs";
import { githubNotifications, watchOnce, watchSettings } from "../../scripts/dogfood/watch.mjs";

const roots: string[] = [];
const now = Date.parse("2026-09-27T18:00:00Z");
const run = "watch-test-run";
const repository = "example/product";
const issue = `https://github.com/${repository}/issues/10`;
const destination = "https://github.com/example/operations/issues/20";
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function put(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "loop-watch-"));
  roots.push(root);
  const loopConfig = resolve(root, "loop.json");
  const config = resolve(root, "watch.json");
  const runtime = resolve(root, "runtime", run);
  const source = resolve(runtime, "cs-10-attempt-1/source");
  await put(loopConfig, {
    schemaVersion: "dogfood-loop/v1",
    run,
    repository,
    adapter: "chase-sets",
    stateRoot: resolve(root, "runtime"),
  });
  await put(config, { loopConfig, destination, intervalSeconds: 30, noProgressSeconds: 120 });
  await put(resolve(runtime, "cycle-1-selected.json"), { cycle: 1, key: "cs-10", number: 10 });
  await put(resolve(source, "../attempt.json"), {
    run,
    issue,
    candidateAttempt: 1,
    phase: "source",
  });
  await put(resolve(source, "author-attempt.json"), { id: "author", launchedAt: now - 30_000 });
  let supervisor = { status: "running", pid: 42 as number | null };
  let outstanding: { key: string; number: number; reasons: string[] }[] = [];
  let unavailable = false;
  const log = async (...events: object[]) =>
    writeFile(
      resolve(root, "supervisor.log"),
      events.map((event) => JSON.stringify({ run, pid: 42, ...event })).join("\n") + "\n",
    );
  await log({ status: "supervisor-started", observedAt: new Date(now - 60_000).toISOString() });
  const comments: { issue: string; body: string; html_url: string }[] = [];
  const commands: { args: string[]; input: string | undefined }[] = [];
  let fail = "";
  // Exercise the production GitHub transport shape, replacing only the command execution.
  const github = githubNotifications(async (executable, args, input) => {
    expect(executable).toBe("gh");
    commands.push({ args, input });
    if (fail === "read") throw new Error("private command stderr must not escape");
    const endpoint = args.find((arg) => arg.startsWith("repos/"))!;
    const url = `https://github.com/${endpoint.slice(6).replace(/\/comments$/, "")}`;
    if (args.includes("POST")) {
      if (fail === "post") throw new Error("secret post stderr");
      const body = JSON.parse(input!).body;
      comments.push({ issue: url, body, html_url: `${url}#issuecomment-${comments.length + 1}` });
      if (fail === "lost-response") throw new Error("response lost after acceptance");
      return comments.at(-1);
    }
    expect(args).toContain("--paginate");
    return [[], comments.filter((comment) => comment.issue === url)];
  });
  const reports: string[] = [];
  const observe = (at = now) =>
    observeStatus(loopConfig, {
      now: at,
      supervisor: async () => supervisor,
      preview: async () => {
        if (unavailable) throw new Error("network unavailable");
        return { candidates: [], outstanding, scope: null };
      },
      publication: async (_loop, _publication, merge) => ({
        status: "observed",
        pr: `https://github.com/${repository}/pull/30`,
        checks: [
          { status: "IN_PROGRESS", url: `https://github.com/${repository}/actions/runs/40` },
        ],
        deploy: merge
          ? [{ status: "queued", url: `https://github.com/${repository}/actions/runs/41` }]
          : [],
      }),
    });
  const poll = async (at = now) =>
    watchOnce(await watchSettings(config), {
      now: at,
      observe: () => observe(at),
      github,
      report: (message) => reports.push(message),
    });
  return {
    root,
    config,
    runtime,
    source,
    log,
    comments,
    commands,
    reports,
    poll,
    observe,
    github,
    supervisor: (status: string) => {
      supervisor = { status, pid: status === "running" ? 42 : null };
    },
    outstanding: (rows: typeof outstanding) => {
      outstanding = rows;
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
    fail: (value: string) => {
      fail = value;
    },
  };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (/^watch-[a-f0-9]+\.json(?:\.tmp)?$/.test(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(path));
    else result[path] = await readFile(path, "utf8");
  }
  return result;
}

it("demonstrates an opt-in alert and recovery on a disposable run, with restart deduplication and no delivery writes", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  expect(await f.poll()).toBe(true);
  expect(f.comments).toHaveLength(0);
  f.supervisor("exited");
  expect(await f.poll()).toBe(true);
  expect(f.comments).toHaveLength(1);
  expect(f.comments[0]).toMatchObject({
    issue: destination,
    body: expect.stringContaining("supervisor-exited"),
  });
  expect(f.comments[0]!.body).toContain(issue);
  expect(f.comments[0]!.body).toContain("age 30s");
  // Each poll reloads configuration and state, as a fresh watcher process does.
  await f.poll(now + 30_000);
  expect(f.comments).toHaveLength(1);
  f.supervisor("running");
  await f.poll(now + 60_000);
  await f.poll(now + 61_000);
  expect(f.comments).toHaveLength(2);
  expect(f.comments[1]!.body).toContain("Loop recovery");
  expect(f.reports).toEqual([
    "watch notification delivered: supervisor-exited",
    "watch notification delivered: recovery",
  ]);
  expect(await snapshot(f.root)).toEqual(before);
});

it("links a retained learning note and PR without copying its body or raw worker evidence", async () => {
  const f = await fixture();
  f.supervisor("exited");
  const marker = `loop-stop:${run}:1:1`;
  await put(resolve(f.runtime, "cycle-1-stop-1.json"), {
    marker,
    reason: "provider-unavailable",
    body: "sensitive diagnostic/transcript",
  });
  await put(resolve(f.source, "publication.json"), {
    number: 30,
    url: `https://github.com/${repository}/pull/30`,
    head: "a".repeat(40),
  });
  f.comments.push({
    issue,
    body: `<!-- ${marker} --> sensitive diagnostic/transcript`,
    html_url: `${issue}#issuecomment-99`,
  });
  await f.poll();
  const body = f.comments[1]!.body;
  expect(body).toContain(`${issue}#issuecomment-99`);
  expect(body).toContain("provider-unavailable");
  expect(body).toContain("/pull/30");
  expect(body).not.toContain("sensitive diagnostic/transcript");
  await f.poll(now + 30_000);
  expect(f.comments).toHaveLength(2);
  // A different retained stop warrants a new notification.
  await put(resolve(f.runtime, "cycle-1-stop-2.json"), {
    marker: `loop-stop:${run}:1:2`,
    reason: "hosted-observation-unavailable",
  });
  await f.poll();
  expect(f.comments).toHaveLength(3);
});

it("treats acknowledged pause and exhausted idle as quiet; a pending pause does not hide a host stop", async () => {
  const f = await fixture();
  f.supervisor("exited");
  await put(resolve(f.runtime, "operator/pause.json"), {
    id: "pause",
    requestedAt: new Date(now).toISOString(),
  });
  await put(resolve(f.runtime, "pause-acknowledgement.json"), {
    requestId: "pause",
    at: new Date(now).toISOString(),
  });
  await f.poll();
  expect(f.comments).toHaveLength(0);
  await rm(resolve(f.runtime, "operator/pause.json"));
  await put(resolve(f.runtime, "cycle-1-complete.json"), { cycle: 1 });
  await f.log({ status: "idle" });
  await f.poll();
  expect(f.comments).toHaveLength(0);
  await rm(resolve(f.runtime, "cycle-1-complete.json"));
  await put(resolve(f.runtime, "operator/pause.json"), {
    id: "new-pause",
    requestedAt: new Date(now).toISOString(),
  });
  await put(resolve(f.runtime, "cycle-1-stop-1.json"), { reason: "provider-unavailable" });
  await f.log({ status: "blocked", reason: "provider-unavailable" });
  await f.poll();
  expect(f.comments[0]!.body).toContain("reported-stop");
});

it("reports blocked idle once, ignores row order, and reports recovery when it is exhausted", async () => {
  const f = await fixture();
  f.supervisor("exited");
  await put(resolve(f.runtime, "cycle-1-complete.json"), { cycle: 1 });
  await f.log({ status: "idle" });
  const blocked = [
    { key: "cs-11", number: 11, reasons: ["status:needs-operator"] },
    { key: "cs-12", number: 12, reasons: ["not-ready"] },
  ];
  f.outstanding(blocked);
  await f.poll();
  expect(f.comments[0]!.body).toContain("blocked-idle");
  expect(f.comments[0]!.body).toContain("/issues/11");
  expect(f.comments[0]!.body).toContain("status:needs-operator");
  f.outstanding([...blocked].reverse());
  await f.poll();
  expect(f.comments).toHaveLength(1);
  f.unavailable(true);
  await f.poll();
  expect(f.comments).toHaveLength(1);
  f.unavailable(false);
  f.outstanding([]);
  await f.poll();
  expect(f.comments[1]!.body).toContain("Loop recovery");
});

it.each(["waiting-provider", "observing-hosted-checks", "deploy-or-cleanup"])(
  "warns on slow live %s without asserting death or renewing warnings each poll",
  async (phase) => {
    const f = await fixture();
    if (phase === "waiting-provider")
      await f.log({ status: "supervisor-started" }, { status: "waiting-provider", issue });
    else
      await put(resolve(f.source, "publication.json"), {
        number: 30,
        url: `https://github.com/${repository}/pull/30`,
        head: "a".repeat(40),
      });
    if (phase === "deploy-or-cleanup")
      await put(resolve(f.source, "merge.json"), { mergeCommit: "b".repeat(40) });
    const settings = await watchSettings(f.config);
    const poll = (at: number) =>
      watchOnce(settings, {
        now: at,
        observe: () => f.observe(at),
        github: f.github,
        report: () => {},
      });
    await poll(now);
    expect(f.comments).toHaveLength(0);
    await poll(now + 120_000);
    await poll(now + 150_000);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]!.body).toContain(`phase ${phase}`);
    expect(f.comments[0]!.body).toContain("no-progress");
    expect(f.comments[0]!.body).toContain("not evidence that a worker is dead");
    expect(f.comments[0]!.body).toContain(
      phase === "waiting-provider"
        ? "Known wait: provider admission"
        : phase === "deploy-or-cleanup"
          ? "/actions/runs/41"
          : "/actions/runs/40",
    );
    await put(resolve(f.source, "author-attempt.json"), {
      id: "new-author",
      launchedAt: now + 160_000,
    });
    await poll(now + 170_000);
    expect(f.comments[1]!.body).toContain("Loop recovery");
  },
);

it("uses a persisted first observation when no timestamp exists, explicitly retaining unknown progress", async () => {
  const f = await fixture();
  await put(resolve(f.source, "author-attempt.json"), { id: "author" });
  await f.poll();
  await f.poll(now + 90_000);
  expect(f.comments).toHaveLength(0);
  await f.poll(now + 120_000);
  expect(f.comments[0]!.body).toContain("Last evidenced progress: unknown; age unknown");
});

it("does not turn unavailable liveness or missing records into exit or recovery", async () => {
  const f = await fixture();
  f.supervisor("unavailable");
  await f.poll();
  expect(f.comments).toHaveLength(0);
  f.supervisor("exited");
  await f.poll();
  f.supervisor("unavailable");
  await f.poll();
  expect(f.comments).toHaveLength(1);
  expect(f.reports).toContain("watch observation incomplete; no recovery inferred");
  f.supervisor("exited");
  await rm(resolve(f.root, "supervisor.log"));
  await f.poll();
  expect(f.comments).toHaveLength(1);
});

it.each(["read", "post", "lost-response"])(
  "retains pending state on GitHub %s failure, retries on a later observation and reconciles accepted posts",
  async (failure) => {
    const f = await fixture();
    f.supervisor("exited");
    f.fail(failure);
    expect(await f.poll()).toBe(false);
    const settings = await watchSettings(f.config);
    expect(JSON.parse(await readFile(settings.state, "utf8")).pending).not.toBeNull();
    expect(f.commands.filter((command) => command.args.includes("POST")).length).toBe(
      failure === "read" ? 0 : 1,
    );
    expect(f.reports.at(-1)).toContain("retry at the next interval");
    expect(f.reports.join(" ")).not.toContain("secret");
    f.fail("");
    await f.poll(now + 30_000);
    await f.poll(now + 60_000);
    expect(f.comments).toHaveLength(1);
    expect(JSON.parse(await readFile(settings.state, "utf8")).pending).toBeNull();
  },
);

it("requires explicit destination and bounds the observation interval", async () => {
  const f = await fixture();
  const config = JSON.parse(await readFile(f.config, "utf8"));
  for (const patch of [
    { destination: "" },
    { destination: `${destination}?token=secret` },
    { intervalSeconds: 0 },
    { intervalSeconds: 29 },
    { noProgressSeconds: 1 },
  ]) {
    await put(f.config, { ...config, ...patch });
    await expect(watchSettings(f.config)).rejects.toThrow("watch-config");
  }
});

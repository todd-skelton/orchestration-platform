import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  queueConfigFromLoop,
  queueStep,
  repositoryQueueAdapter,
  type LoopConfig,
  type QueueParticipant,
} from "../../../scripts/dogfood/queue.js";
import { gitSetupAdapter } from "../../../scripts/dogfood/setup-adapter.js";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  startCycle,
  stopCycle,
  type SupervisionAdapter,
  type SupervisedCycle,
} from "../../../scripts/dogfood/supervision.js";
import type { RepositoryAdapter } from "../../../scripts/dogfood/repository-adapter.js";
import type { Adapter } from "../../../scripts/dogfood/flow.js";
import { SELF_ROUTING } from "../../../scripts/dogfood/routing.mjs";

// All issue identities, workers and delivery results in this fixture are synthetic.
export async function sourceFailureFixture(priorWorkers = 0, files: string[] = []) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "source-fail-native-")));
  const repository = resolve(root, "repository");
  await mkdir(repository);
  const execute = promisify(execFile);
  const gitExecutable = (
    await execute(process.platform === "win32" ? "where.exe" : "which", ["git"])
  ).stdout
    .trim()
    .split(/\r?\n/)[0]!;
  const git = async (cwd: string, args: string[]) =>
    (await execute(gitExecutable, ["-C", cwd, ...args])).stdout.trim();
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "Synthetic Fixture"]);
  await git(repository, ["config", "user.email", "fixture@example.test"]);
  await writeFile(resolve(repository, ".gitignore"), "node_modules/\n");
  await writeFile(resolve(repository, "product.txt"), "synthetic base\n");
  for (const file of files) {
    const path = resolve(repository, file);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, "synthetic preserved base\n");
  }
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "synthetic old executor"]);
  const base = await git(repository, ["rev-parse", "HEAD"]);
  const loop: LoopConfig = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-source-fail",
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: repository,
    stateRoot: resolve(root, "state"),
    worktreeRoot: resolve(root, "worktrees"),
    codexExecutable: process.execPath,
    gitExecutable,
    nativeLaunchCeiling: 16,
    attemptCeiling: 4,
    author: SELF_ROUTING.author[0]!,
    reviewer: SELF_ROUTING.reviewer[0]!,
  };
  const history: QueueParticipant[] = Array.from({ length: priorWorkers }, (_, index) => ({
    ordinal: index + 1,
    id: `synthetic-prior-${index}`,
    item: "fixture-prior:1",
    stage: "source",
    role: index % 2 ? "reviewer" : "author",
    outcome: index === 2 ? "failed" : "passed",
    placement: index % 2 ? SELF_ROUTING.reviewer[0]! : SELF_ROUTING.author[0]!,
    rung: 0,
    usage: {
      inputTokens: { status: "known", value: 100 + index },
      outputTokens: { status: "known", value: 10 },
      costUsd: { status: "unavailable" },
    },
  }));
  const rows = [110, 159, 160, 999].map((number) => ({
    key: `fixture-${number}`,
    number,
    ready: true,
    blocked: number === 999,
    state: "OPEN" as "OPEN" | "CLOSED",
    comments: [] as string[],
  }));
  const calls: string[] = [];
  const policy: RepositoryAdapter = {
    selectCandidates: () =>
      rows
        .filter((row) => row.ready && !row.blocked && row.state === "OPEN")
        .map(({ key, number }) => ({ key, number })),
    issueContext: async ({ key }) => {
      calls.push(`context:${key}`);
      return {
        title: key,
        body: "Synthetic source work",
        acceptanceCriteria: ["Do synthetic work"],
        rules: "Keep synthetic work scoped",
        routing: { row: "self" },
      };
    },
    branchName: ({ key }) => `codex/${key}`,
    requiredChecks: () => ["synthetic-check"],
    pullRequest: async () => {
      throw new Error("no publication in source-failure fixture");
    },
    park: ({ number }) => {
      calls.push(`park:${number}`);
      rows.find((row) => row.number === number)!.ready = false;
      return "explicitly restore planning readiness after resolving the source blocker";
    },
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: () => {},
  };
  const host: SupervisionAdapter = {
    currentMain: () => git(repository, ["rev-parse", "HEAD"]),
    async issue(_config, number) {
      const row = rows.find((row) => row.number === number)!;
      return {
        state: row.state,
        key: row.key,
        labels: row.ready ? ["ready"] : [],
        comments: [...row.comments],
      };
    },
    async removeReady(_config, number) {
      rows.find((row) => row.number === number)!.ready = false;
    },
    async close(_config, number) {
      rows.find((row) => row.number === number)!.state = "CLOSED";
    },
    async comment(_config, number, body) {
      calls.push(`note:${number}`);
      rows.find((row) => row.number === number)!.comments.push(body);
    },
  };
  const setup = gitSetupAdapter({
    gitExecutable,
    resolveLauncher: async () => ({ executable: process.execPath, prefixArgs: [] }),
    async install(_command, _args, cwd) {
      calls.push(`install:${cwd}`);
      await mkdir(resolve(cwd, "node_modules"));
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
      return "succeeded";
    },
  });
  let authorStatus: "running" | "failed" = "failed";
  let serial = 0;
  const native: Adapter = {
    git,
    async preflight() {},
    async waitForProvider(config) {
      calls.push(`probe:${config.issue}`);
    },
    async launch(role, config) {
      calls.push(`launch:${role}:${config.issue}`);
      if (role === "author" && !config.issue.endsWith("/110"))
        await writeFile(resolve(config.worktree, "product.txt"), `${config.issue}\n`);
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic execution trace\n");
      return { id: `synthetic-worker-${++serial}`, pid: 111, launchedAt: 1, trace };
    },
    async observe(role, config, attempt) {
      const head =
        role === "author" ? config.base : await git(config.worktree, ["rev-parse", "HEAD"]);
      return {
        id: attempt.id,
        head,
        status: role === "author" && config.issue.endsWith("/110") ? authorStatus : "passed",
        summary:
          role === "author"
            ? "Synthetic source blocker requires operator action"
            : JSON.stringify({
                run: config.run,
                role,
                head,
                verdict: "PASS",
                findings: [],
                g0: "The synthetic change is minimal.",
              }),
      };
    },
    async checks() {
      throw new Error("source cannot observe hosted checks");
    },
  };
  const compose = async (cycle: SupervisedCycle) => {
    const { key, number, base } = cycle.selection;
    const config = await queueConfigFromLoop(
      loop,
      repository,
      { key, number, base },
      policy,
      cycle.initialHistory,
    );
    const adapter = repositoryQueueAdapter(config, repository, { gitExecutable, native, setup });
    // Delivery is a synthetic boundary; native source, review, queue and supervision run.
    adapter.delivery = async (item, accepted) => {
      calls.push(`delivery:${item.id}`);
      return {
        status: "complete",
        run: item.source.run,
        issue: item.issue,
        head: accepted.head,
        reviewId: accepted.reviewId,
        publication: { number: 1, url: "https://example.test/synthetic-pr/1" },
        checks: [{ name: "synthetic-check", bucket: "pass", link: "https://example.test/check" }],
        mergeCommit: "d".repeat(40),
        cleanup: { status: "confirmed", branch: `codex/${item.id}` },
        retries: 0,
      };
    };
    return { config, adapter };
  };
  const cycle: SupervisedCycle = {
    selection: { cycle: priorWorkers ? 2 : 1, key: "fixture-110", number: 110, base },
    initialHistory: history,
  };
  const runState = resolve(loop.stateRoot, loop.run);
  await persistCycle(loop, cycle);
  if (priorWorkers) {
    const selection = { cycle: 1, key: "fixture-prior", number: 109, base };
    await writeFile(resolve(runState, "cycle-1-selected.json"), JSON.stringify(selection));
    await writeFile(
      resolve(runState, "cycle-1-complete.json"),
      JSON.stringify({ selection, history }),
    );
  }
  const current = await compose(cycle);
  const fail = async () => {
    await startCycle(loop, cycle, host);
    try {
      await queueStep(current.config, current.adapter);
      throw new Error("expected source failure");
    } catch (error) {
      if ((error as { reason?: string }).reason !== "author-failed") throw error;
    }
    cycle.initialHistory = await current.adapter.history();
  };
  const advance = () => nextCycle(loop, repository, host, policy);
  const drain = async () => {
    const selected: string[] = [];
    for (;;) {
      const next = await advance();
      if (!next) return selected;
      selected.push(next.selection.key);
      await persistCycle(loop, next);
      const nextQueue = await compose(next);
      await startCycle(loop, next, host);
      await queueStep(nextQueue.config, nextQueue.adapter);
      await completeCycle(loop, next, await nextQueue.adapter.history(), host);
    }
  };
  const stop = () => stopCycle(loop, cycle, "author-failed", 1, host, policy);
  const upgrade = async () => {
    await git(repository, ["commit", "--allow-empty", "-m", "synthetic upgraded executor"]);
  };
  return {
    root,
    repository,
    loop,
    base,
    rows,
    calls,
    host,
    policy,
    native,
    current,
    cycle,
    runState,
    git,
    compose,
    fail,
    advance,
    drain,
    stop,
    upgrade,
    setAuthorStatus: (status: typeof authorStatus) => {
      authorStatus = status;
    },
  };
}

export async function snapshot(directory: string): Promise<Map<string, string>> {
  const bytes = new Map<string, string>();
  for (const row of await readdir(directory, { withFileTypes: true })) {
    if (row.name === ".git") continue;
    const path = resolve(directory, row.name);
    if (row.isDirectory())
      for (const [file, content] of await snapshot(path)) bytes.set(file, content);
    else bytes.set(path, await readFile(path, "utf8"));
  }
  return bytes;
}

export async function historicalStops(
  f: Awaited<ReturnType<typeof sourceFailureFixture>>,
  shape: "terminal" | "pending" | "complete" | "pilot-pending" | "pilot-complete",
) {
  if (shape === "terminal") return;
  const selection = f.cycle.selection;
  const history = f.cycle.initialHistory;
  const attempt = JSON.parse(
    await readFile(resolve(f.current.config.stateDirectory, "attempt.json"), "utf8"),
  ).candidateAttempt;
  for (let stop = 1; stop <= (shape.startsWith("pilot-") ? 2 : 1); stop++) {
    const marker = `loop-stop:${f.loop.run}:${selection.cycle}:${stop}`;
    const body = `<!-- ${marker} --> Synthetic retained ${stop === 1 ? "author-failed" : "pilot-revision-moved"} stop after ${attempt} attempts; inspect retained diagnostics.`;
    await writeFile(
      resolve(f.runState, `cycle-${selection.cycle}-stop-${stop}.json`),
      JSON.stringify(
        {
          selection,
          stop,
          reason: stop === 1 ? "author-failed" : "pilot-revision-moved",
          attempts: attempt,
          history,
          marker,
          body,
        },
        null,
        2,
      ) + "\n",
    );
    if (shape === "pending" || (stop === 2 && shape === "pilot-pending")) continue;
    await writeFile(
      resolve(f.runState, `cycle-${selection.cycle}-stop-${stop}-complete.json`),
      JSON.stringify({ selection, stop, history }, null, 2) + "\n",
    );
    f.rows[0]!.comments.push(body);
  }
}

// A real native source rejection (including its malformed-review retry) then
// native repair FAIL in directory 2, candidate 3. No incident files are inputs.
export async function repairFailureFixture() {
  const f = await sourceFailureFixture(1);
  await f.fail();
  await f.stop();
  const remote = resolve(f.root, "remote.git");
  await f.git(f.repository, ["clone", "--bare", f.repository, remote]);
  await f.git(f.repository, ["remote", "add", "origin", remote]);
  f.rows[0]!.ready = true;
  const cycle = (await f.advance())!;
  await persistCycle(f.loop, cycle);
  const launch = f.native.launch;
  f.native.launch = async (role, config, prompt) => {
    if (role === "author" && config.issue.endsWith("/110"))
      await writeFile(
        resolve(config.worktree, "product.txt"),
        config.stateDirectory.endsWith("repair")
          ? "partial failed repair left dirty\n"
          : "synthetic rejected implementation\n",
      );
    return launch(role, config, prompt);
  };
  const observe = f.native.observe;
  let malformed: string | undefined;
  const findings = [
    { file: "product.txt", line: 1, severity: "blocking", text: "Use fixture mode legacy." },
    { file: "product.txt", line: 1, severity: "blocking", text: "Preserve the invariant." },
  ];
  f.native.observe = async (role, config, attempt) => {
    const result = await observe(role, config, attempt);
    if (!config.issue.endsWith("/110") || config.stateDirectory.endsWith("repair")) return result;
    if (role === "author") return { ...result, status: "passed", summary: "" };
    malformed ??= attempt.id;
    if (attempt.id === malformed) return { ...result, status: "passed", summary: "malformed" };
    return {
      ...result,
      status: "failed",
      summary: JSON.stringify({
        run: config.run,
        role,
        head: result.head,
        verdict: "FAIL",
        findings,
        g0: "No; both fixture requirements must hold.",
      }),
    };
  };
  const current = await f.compose(cycle);
  return {
    ...f,
    cycle,
    current,
    fail: async () => {
      await startCycle(f.loop, cycle, f.host);
      try {
        await queueStep(current.config, current.adapter);
        throw new Error("expected repair failure");
      } catch (error) {
        if ((error as { reason?: string }).reason !== "author-failed") throw error;
      }
      cycle.initialHistory = await current.adapter.history();
    },
    stop: () => stopCycle(f.loop, cycle, "author-failed", 3, f.host, f.policy),
  };
}

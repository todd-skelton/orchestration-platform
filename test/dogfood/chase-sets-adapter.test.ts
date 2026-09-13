import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import * as chaseSets from "../../adapters/chase-sets.mjs";
import { DeliveryBlocked, type DeliveryConfig } from "../../scripts/dogfood/delivery.js";
import { loadRepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { type LoopConfig } from "../../scripts/dogfood/queue.js";
import { nextCycle, type SupervisionAdapter } from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(digestConclusion = "success") {
  const root = await mkdtemp(resolve(tmpdir(), "chase-sets-adapter-"));
  roots.push(root);
  const scripts = resolve(root, "scripts");
  const tools = resolve(root, "tools");
  const deliverySkill = resolve(root, ".agents/skills/delivery");
  await Promise.all([mkdir(scripts), mkdir(tools), mkdir(deliverySkill, { recursive: true })]);
  await Promise.all([
    writeFile(resolve(root, "AGENTS.md"), "Product rules.\n"),
    writeFile(resolve(deliverySkill, "SKILL.md"), "Delivery skill.\n"),
    writeFile(
      resolve(scripts, "milestone-policy.mjs"),
      'export const isExecutableOutcome = (value) => value?.state === "open" && value?.description?.includes("committed");\n',
    ),
    writeFile(
      resolve(scripts, "backlog-classify.mjs"),
      'export const classified = (value) => value.labels.includes("kind:slice") && value.labels.some((label) => label.startsWith("priority:"));\n',
    ),
    writeFile(
      resolve(scripts, "dispatch-window.mjs"),
      [
        'import { isExecutableOutcome } from "./milestone-policy.mjs";',
        'import { classified } from "./backlog-classify.mjs";',
        'export const isRunnableRefined = (issue) => issue.state === "open" && isExecutableOutcome(issue.milestone) && issue.blockedBy.every((item) => item.state === "closed") && classified({ labels: issue.labels.map((item) => item.name) });',
        "export const derivePullWindow = ({ milestones, issues }) => milestones.filter((milestone) => isExecutableOutcome(milestone) && issues.some((issue) => issue.milestone?.id === milestone.id)).map(({ id, number, title }) => ({ id, number, title }));",
        "",
      ].join("\n"),
    ),
  ]);
  const executable = resolve(tools, "gh");
  await writeFile(
    executable,
    `#!/bin/sh
case "$*" in
  *milestones*) printf '%s' '{"data":{"repository":{"milestones":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"M1","number":7,"title":"Outcome","description":"committed","state":"OPEN"}]}}}}' ;;
  *graphql*) printf '%s' '{"data":{"repository":{"issues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"I5","number":5,"title":"Issue 5","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p1"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I9","number":9,"title":"Issue 9","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I11","number":11,"title":"Needs operator","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"},{"name":"status:needs-operator"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I12","number":12,"title":"Ops work","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:ops"},{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I3","number":3,"title":"Issue 3","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[{"number":2,"state":"OPEN"}]}}]}}}}' ;;
  *run*list*) printf '%s' '[{"databaseId":42,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","createdAt":"2026-09-11T00:00:00Z"}]' ;;
  *run*view*) printf '%s' '{"jobs":[{"name":"Deploy Staging","status":"completed","conclusion":"success","steps":${JSON.stringify(digestConclusion === "missing" ? [] : [{ name: "Verify immutable active release image", conclusion: digestConclusion }])}}]}' ;;
  *issue*edit*) printf '%s' "$*" > '${resolve(root, "park-call")}' ;;
  *issue*view*) printf '%s' '{"number":9,"title":"Issue 9","body":"## Context\\nFixture.\\n\\n## Acceptance Criteria\\n\\n- First result\\n- Second result\\n  with detail\\n"}' ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(executable, 0o755);
  const git = resolve(tools, "git-lines");
  await writeFile(
    git,
    "#!/bin/sh\nprintf '2\\t1\\tscripts/a.mjs\\n3\\t4\\ttest/a.test.mjs\\n5\\t2\\tapp/a.ts\\n'\n",
  );
  await chmod(git, 0o755);
  vi.stubEnv("PATH", `${tools}${delimiter}${process.env.PATH ?? ""}`);
  return root;
}

async function scopedFixture() {
  const executorRoot = await fixture();
  const runtime = await mkdtemp(resolve(tmpdir(), "chase-sets-scope-runtime-"));
  roots.push(runtime);
  const milestones = [148, 155].map((number) => ({
    id: `M${number}`,
    number,
    title: `Outcome ${number}`,
    description: "committed",
    state: "OPEN",
  }));
  const issue = (
    number: number,
    milestone: number,
    extraLabels: string[] = [],
    dependencies: number[] = [],
  ) => ({
    id: `I${number}`,
    number,
    title: `Issue ${number}`,
    body: "## Acceptance Criteria\n\n- Ship the result.\n",
    state: "OPEN",
    issueType: { name: "Slice" },
    milestone: { id: `M${milestone}`, number: milestone },
    labels: {
      pageInfo: { hasNextPage: false },
      nodes: ["kind:slice", "priority:p0", ...extraLabels].map((name) => ({ name })),
    },
    blockedBy: {
      pageInfo: { hasNextPage: false },
      nodes: dependencies.map((number) => ({ number, state: "OPEN" })),
    },
  });
  const issues = [issue(4382, 148), issue(7820, 155, ["status:needs-operator"])];
  const dataPath = resolve(runtime, "provider.json");
  const save = () => writeFile(dataPath, JSON.stringify({ milestones, issues }));
  await save();
  const callsPath = resolve(runtime, "calls.jsonl");
  const commentsPath = resolve(runtime, "comments.json");
  await writeFile(commentsPath, "[]");
  await writeFile(
    resolve(executorRoot, "tools/gh"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
const { milestones, issues } = JSON.parse(fs.readFileSync(${JSON.stringify(dataPath)}, "utf8"));
const commentsPath = ${JSON.stringify(commentsPath)};
const comments = JSON.parse(fs.readFileSync(commentsPath, "utf8"));
if (args[0] === "api") {
  const name = args.some((arg) => arg.includes("milestones(")) ? "milestones" : "issues";
  console.log(JSON.stringify({ data: { repository: { [name]: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: name === "milestones" ? milestones : issues } } } }));
} else if (args[0] === "issue" && args[1] === "view") {
  const issue = issues.find((issue) => issue.number === Number(args[2]));
  console.log(JSON.stringify({ ...issue, labels: issue.labels.nodes, comments }));
} else if (args[0] === "issue" && args[1] === "comment") {
  comments.push({ body: args[args.indexOf("--body") + 1] });
  fs.writeFileSync(commentsPath, JSON.stringify(comments));
} else { process.exit(2); }
`,
  );
  return { executorRoot, runtime, issues, issue, save, callsPath, commentsPath };
}

it.skipIf(process.platform === "win32")(
  "scopes native selection without admitting dependencies, needs labels, or ops work",
  async () => {
    const current = await scopedFixture();
    const input = { repository: "chase-sets/chase-sets", executorRoot: current.executorRoot };
    await expect(chaseSets.selectCandidates(input)).resolves.toEqual([
      { key: "cs-4382", number: 4382 },
    ]);
    await expect(chaseSets.selectCandidates({ ...input, targetMilestone: 155 })).resolves.toEqual(
      [],
    );
    current.issues.push(
      current.issue(7822, 155, [], [4382]),
      current.issue(7823, 155, ["status:needs-replan"]),
      current.issue(7824, 155, ["kind:ops"]),
      current.issue(7825, 155),
    );
    await current.save();
    const config = {
      repository: input.repository,
      stableExecutorRoot: input.executorRoot,
      stateRoot: current.runtime,
      run: "fresh",
      targetMilestone: 155,
    } as LoopConfig;
    const adapter = await loadRepositoryAdapter(
      "chase-sets",
      resolve(import.meta.dirname, "../.."),
    );
    const unused = async (): Promise<never> => {
      throw new Error("unexpected supervision action");
    };
    const supervisor: SupervisionAdapter = {
      currentMain: async () => "a".repeat(40),
      issue: unused,
      removeReady: unused,
      close: unused,
      comment: unused,
    };
    await expect(nextCycle(config, input.executorRoot, supervisor, adapter)).resolves.toMatchObject(
      { selection: { cycle: 1, key: "cs-7825", number: 7825 } },
    );
    await expect(
      adapter.issueContext({ ...input, targetMilestone: 155, key: "cs-7825", number: 7825 }),
    ).resolves.toMatchObject({ title: "Issue 7825" });
    current.issues[2]!.blockedBy.nodes[0]!.state = "CLOSED";
    await current.save();
    await expect(chaseSets.selectCandidates({ ...input, targetMilestone: 155 })).resolves.toEqual([
      { key: "cs-7822", number: 7822 },
      { key: "cs-7825", number: 7825 },
    ]);
    await expect(chaseSets.selectCandidates({ ...input, targetMilestone: 999 })).resolves.toEqual(
      [],
    );
  },
);

it.skipIf(process.platform === "win32")(
  "stops saved cycle 2 before dispatch and rederives scoped idle after the host archives its scheduling records",
  async () => {
    const { executorRoot, runtime, callsPath, commentsPath } = await scopedFixture();
    const controller = resolve(runtime, "controller");
    const source = resolve(import.meta.dirname, "../..");
    for (const name of ["scripts", "adapters"])
      await cp(resolve(source, name), resolve(controller, name), { recursive: true });
    await writeFile(resolve(controller, "package.json"), '{"type":"module"}');
    const execute = promisify(execFile);
    const hostGit = (await execute("which", ["git"])).stdout.trim();
    // The supervisor prepends Git's directory to PATH. Keep that directory
    // beside the fixture gh, even when the host installs Git and gh together.
    const gitExecutable = resolve(executorRoot, "tools/git");
    await symlink(hostGit, gitExecutable);
    const commit = async (root: string) => {
      for (const args of [
        ["init", "-b", "main"],
        ["config", "user.name", "Fixture"],
        ["config", "user.email", "fixture@example.test"],
        ["add", "."],
        ["commit", "-m", "fixture"],
      ])
        await execute(gitExecutable, ["-C", root, ...args]);
      return (await execute(gitExecutable, ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
    };
    await commit(controller);
    const base = await commit(executorRoot);
    const worktreeRoot = resolve(runtime, "worktrees");
    const config: LoopConfig = {
      schemaVersion: "dogfood-loop/v1",
      run: "m2-scope",
      adapter: "chase-sets",
      repository: "chase-sets/chase-sets",
      stableExecutorRoot: executorRoot,
      stateRoot: resolve(runtime, "state"),
      worktreeRoot,
      author: { model: "author", effort: "high" },
      reviewer: { model: "reviewer", effort: "high" },
      gitExecutable,
      codexExecutable: resolve(runtime, "author-must-not-launch"),
      nativeLaunchCeiling: 8,
      attemptCeiling: 4,
      targetMilestone: 155,
    };
    const runState = resolve(config.stateRoot, config.run);
    await mkdir(resolve(runState, "cs-4382-attempt-1"), { recursive: true });
    await mkdir(resolve(worktreeRoot, "interrupted-cs-4382"), { recursive: true });
    const preserved: Record<string, string> = {
      "cycle-1-selected.json": JSON.stringify({ cycle: 1, key: "cs-7821", number: 7821, base }),
      "cycle-1-complete.json": JSON.stringify({
        selection: { cycle: 1, key: "cs-7821", number: 7821, base },
        history: [],
      }),
      "cycle-2-selected.json":
        JSON.stringify({ cycle: 2, key: "cs-4382", number: 4382, base }, null, 2) + "\n",
      "cs-4382-attempt-1/attempt.json": '{"phase":"authoring","implementationAttempt":1}',
      "cs-4382-attempt-1/native-trace.jsonl": '{"status":"interrupted"}\n',
    };
    for (const [name, bytes] of Object.entries(preserved))
      await writeFile(resolve(runState, name), bytes);
    const configPath = resolve(runtime, "loop.json");
    await writeFile(configPath, JSON.stringify(config));
    const run = () =>
      execute(process.execPath, [resolve(controller, "scripts/dogfood/supervise.mjs"), configPath]);
    for (let restart = 1; restart <= 2; restart += 1) {
      await expect(run()).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('"reason":"selected-milestone-mismatch"'),
      });
      for (const [name, bytes] of Object.entries(preserved))
        await expect(readFile(resolve(runState, name), "utf8")).resolves.toBe(bytes);
      const stop = JSON.parse(
        await readFile(resolve(runState, `cycle-2-stop-${restart}.json`), "utf8"),
      );
      expect(stop).toMatchObject({
        reason: "selected-milestone-mismatch",
        selection: { number: 4382 },
      });
      expect(stop.body).toContain("outside target milestone 155");
      await expect(
        readFile(resolve(runState, `cycle-2-stop-${restart}-complete.json`), "utf8"),
      ).resolves.toContain('"stop"');
      await expect(readFile(resolve(runState, "cycle-2-complete.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readdir(worktreeRoot)).toEqual(["interrupted-cs-4382"]);
    }
    expect(JSON.parse(await readFile(commentsPath, "utf8"))).toHaveLength(2);
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(
      calls.every((args) => args[0] === "issue" && ["view", "comment"].includes(args[1]!)),
    ).toBe(true);
    // This is an explicit host recovery in the fixture, never an automatic loop migration.
    const archive = resolve(runtime, "archived-cycle-2");
    await mkdir(archive);
    for (const name of (await readdir(runState)).filter((name) => name.startsWith("cycle-2-")))
      await rename(resolve(runState, name), resolve(archive, name));
    await expect(run()).resolves.toMatchObject({
      stdout: expect.stringContaining('"status":"idle"'),
      stderr: "",
    });
    for (const [name, bytes] of Object.entries(preserved))
      await expect(
        readFile(resolve(name === "cycle-2-selected.json" ? archive : runState, name), "utf8"),
      ).resolves.toBe(bytes);
    expect(await readdir(worktreeRoot)).toEqual(["interrupted-cs-4382"]);
    await expect(readFile(resolve(runState, "cycle-2-selected.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(resolve(runState, "cycle-2-complete.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.skipIf(process.platform === "win32")(
  "uses product readers and provider facts for pull-window order and issue context",
  async () => {
    const executorRoot = await fixture();
    const direct = await promisify(execFile)(
      resolve(executorRoot, "tools/gh"),
      ["api", "graphql", "-f", "query=milestones("],
      { windowsHide: true },
    );
    expect({ stdout: direct.stdout, stderr: direct.stderr }).toMatchObject({
      stdout: expect.stringContaining('"id":"M1"'),
      stderr: "",
    });
    await expect(
      chaseSets.selectCandidates({ repository: "chase-sets/chase-sets", executorRoot }),
    ).resolves.toEqual([
      { key: "cs-9", number: 9 },
      { key: "cs-5", number: 5 },
    ]);
    await expect(
      chaseSets.issueContext({
        repository: "chase-sets/chase-sets",
        key: "cs-9",
        number: 9,
        executorRoot,
      }),
    ).resolves.toEqual({
      title: "Issue 9",
      body: "## Context\nFixture.\n\n## Acceptance Criteria\n\n- First result\n- Second result\n  with detail\n",
      acceptanceCriteria: ["First result", "Second result\nwith detail"],
      rules:
        "Lane mode applies. The loop owns publishing, landing, and deploy verification. " +
        "The worker finishes with the JSON report required by the prompt.\n\n" +
        "Product rules.\n\nDelivery skill.\n",
    });
    await expect(
      chaseSets.park({
        repository: "chase-sets/chase-sets",
        number: 9,
        reason: "implementation-attempt-ceiling-exhausted",
      }),
    ).resolves.toBe("remove the `status:needs-replan` label after acting on the note");
    await expect(readFile(resolve(executorRoot, "park-call"), "utf8")).resolves.toBe(
      "issue edit 9 --add-label status:needs-replan --repo chase-sets/chase-sets",
    );
    await expect(chaseSets.dryRun(executorRoot)).resolves.toEqual({
      milestone: { id: "M1", number: 7, title: "Outcome" },
      issue: { key: "cs-9", number: 9, title: "Issue 9" },
      branch: "codex/9-issue-9-g1",
      pullRequestTitle: "Issue 9",
    });
    const deliveryConfig = {
      repository: "chase-sets/chase-sets",
      issue: "https://github.com/chase-sets/chase-sets/issues/9",
      worktree: executorRoot,
      candidateHead: "b".repeat(40),
      requiredChecks: ["PR Required"],
      policy: {
        key: "cs-9",
        number: 9,
        title: "Issue 9",
        sourceBranch: "codex/9-issue-9-g1",
      },
    } as DeliveryConfig;
    await expect(
      chaseSets.pullRequest({
        config: deliveryConfig,
        gitExecutable: resolve(executorRoot, "tools/git-lines"),
      }),
    ).resolves.toEqual({
      sourceBranch: "codex/9-issue-9-g1",
      baseBranch: "main",
      title: "Issue 9",
      body:
        "Closes #9\n\nLine changes:\n" +
        "- Total: 10 added, 7 deleted, net +3\n" +
        "- Source (`scripts/`): 2 added, 1 deleted, net +1\n" +
        "- Tests (`test/`): 3 added, 4 deleted, net -1",
      draft: true,
    });
    await expect(
      chaseSets.afterMerge({
        config: deliveryConfig,
        delivery: { mergeCommit: "a".repeat(40) } as never,
      }),
    ).resolves.toBeUndefined();
  },
);

it.skipIf(process.platform === "win32").each(["missing", "failure", "skipped"])(
  "rejects a successful staging job with a %s immutable-image verification step",
  async (digestConclusion) => {
    await fixture(digestConclusion);
    const config = {
      repository: "chase-sets/chase-sets",
      issue: "https://github.com/chase-sets/chase-sets/issues/9",
      requiredChecks: ["PR Required"],
      policy: {
        key: "cs-9",
        number: 9,
        title: "Issue 9",
        sourceBranch: "codex/9-issue-9-g1",
      },
    } as DeliveryConfig;
    await expect(
      chaseSets.afterMerge({ config, delivery: { mergeCommit: "a".repeat(40) } as never }),
    ).rejects.toMatchObject({ reason: "deploy-not-verified" });
  },
);

it.skipIf(process.platform === "win32")(
  "reports a missing Chase Sets delivery skill with its typed reason",
  async () => {
    const executorRoot = await fixture();
    await rm(resolve(executorRoot, ".agents/skills/delivery/SKILL.md"));
    const error = await Promise.resolve(
      chaseSets.issueContext({
        repository: "chase-sets/chase-sets",
        key: "cs-9",
        number: 9,
        executorRoot,
      }),
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryBlocked);
    expect(error).toMatchObject({ reason: "missing-chase-sets-delivery-skill" });
  },
);

it.skipIf(process.platform === "win32")(
  "polls staging every 30 seconds for a 45 minute deploy window",
  async () => {
    const executorRoot = await fixture();
    const calls = resolve(executorRoot, "gh-calls");
    const executable = resolve(executorRoot, "tools/gh");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
printf '%s' '[]'
`,
    );
    await chmod(executable, 0o755);
    const deliveryConfig = {
      repository: "chase-sets/chase-sets",
      issue: "https://github.com/chase-sets/chase-sets/issues/9",
      requiredChecks: ["PR Required"],
      policy: {
        key: "cs-9",
        number: 9,
        title: "Issue 9",
        sourceBranch: "codex/9-issue-9-g1",
      },
    } as DeliveryConfig;
    const callCount = async () =>
      readFile(calls, "utf8")
        .then((value) => value.trim().split("\n").length)
        .catch(() => 0);
    const waitForCalls = async (count: number) => {
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        if ((await callCount()) === count) return;
        await new Promise((done) => setImmediate(done));
      }
      expect(await callCount()).toBe(count);
    };
    const waitForNextPoll = async () => {
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        if (vi.getTimerCount() === 1) return;
        await new Promise((done) => setImmediate(done));
      }
      expect(vi.getTimerCount()).toBe(1);
    };

    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(new Date("2026-09-12T00:00:00Z"));
    try {
      let outcome: unknown;
      const verification = Promise.resolve(
        chaseSets.afterMerge({
          config: deliveryConfig,
          delivery: { mergeCommit: "a".repeat(40) } as never,
        }),
      ).then(
        () => {
          outcome = "verified";
        },
        (error: unknown) => {
          outcome = error;
        },
      );
      await waitForCalls(1);
      await waitForNextPoll();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(await callCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await waitForCalls(2);
      await waitForNextPoll();

      for (let count = 3; count <= 90; count += 1) {
        await vi.advanceTimersToNextTimerAsync();
        await waitForCalls(count);
        await waitForNextPoll();
      }
      await vi.advanceTimersToNextTimerAsync();
      await waitForCalls(91);
      await verification;
      expect(Date.now()).toBe(new Date("2026-09-12T00:45:00Z").getTime());
      expect(outcome).toMatchObject({ reason: "deploy-not-verified" });
    } finally {
      vi.useRealTimers();
    }
  },
);

it("loads the complete Chase Sets seam and declares its delivery policy", async () => {
  const loaded = await loadRepositoryAdapter("chase-sets", resolve(import.meta.dirname, "../.."));
  for (const name of [
    "selectCandidates",
    "issueContext",
    "branchName",
    "pullRequest",
    "requiredChecks",
    "localGates",
    "park",
    "mergeMethod",
    "afterMerge",
  ] as const)
    expect(loaded[name]).toBeTypeOf("function");
  for (const name of [
    "pullRequest",
    "requiredChecks",
    "localGates",
    "mergeMethod",
    "afterMerge",
  ] as const)
    expect(loaded[name]).toBe(chaseSets[name]);

  const config = {
    repository: "chase-sets/chase-sets",
    issue: "https://github.com/chase-sets/chase-sets/issues/9",
    requiredChecks: ["PR Required"],
    policy: {
      key: "cs-9",
      number: 9,
      title: "Ship useful work",
      sourceBranch: "codex/9-ship-useful-work-g2",
    },
  } as DeliveryConfig;
  expect(
    chaseSets.branchName({ key: "cs-9", number: 9, title: "Ship useful work!", attempt: 2 }),
  ).toBe("codex/9-ship-useful-work-g2");
  expect(chaseSets.requiredChecks({ repository: config.repository })).toEqual(["PR Required"]);
  expect(chaseSets.localGates({ repository: config.repository })).toEqual([
    "verify:static:scoped",
    "typecheck",
  ]);
  expect(chaseSets.mergeMethod({ config })).toEqual({ method: "queue" });
});

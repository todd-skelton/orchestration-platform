import { execFile, spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
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
import {
  loadRepositoryAdapter,
  type RepositoryAdapter,
} from "../../scripts/dogfood/repository-adapter.js";
import {
  queueConfigFromLoop,
  type LoopConfig,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import {
  nextCycle,
  persistCycle,
  stopCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
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
  *'issue(number:'*) printf '%s' '{"data":{"repository":{"issue":{"number":9,"labels":{"pageInfo":{"hasNextPage":false},"nodes":[]},"title":"Issue 9","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->\\n## Context\\nFixture.\\n\\n## Acceptance Criteria\\n\\n- First result\\n- Second result\\n  with detail\\n"}}}}' ;;
  *milestones*) printf '%s' '{"data":{"repository":{"milestones":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"M1","number":7,"title":"Outcome","description":"committed","state":"OPEN"}]}}}}' ;;
  *graphql*) printf '%s' '{"data":{"repository":{"issues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"I5","number":5,"title":"Issue 5","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p1"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I9","number":9,"title":"Issue 9","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I11","number":11,"title":"Needs operator","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"},{"name":"status:needs-operator"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I12","number":12,"title":"Ops work","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:ops"},{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I3","number":3,"title":"Issue 3","body":"<!-- routing: {\\\"version\\\":1,\\\"row\\\":7,\\\"review\\\":11} -->","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[{"number":2,"state":"OPEN"}]}}]}}}}' ;;
  *run*list*) printf '%s' '[{"databaseId":42,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","createdAt":"2026-09-11T00:00:00Z"}]' ;;
  *run*view*) printf '%s' '{"jobs":[{"name":"Deploy Staging","status":"completed","conclusion":"success","steps":${JSON.stringify(digestConclusion === "missing" ? [] : [{ name: "Verify immutable active release image", conclusion: digestConclusion }])}}]}' ;;
  *issue*edit*) printf '%s' "$*" > '${resolve(root, "park-call")}' ;;
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
  // Model the product's refinement boundary, including eligible ops and honest types.
  await writeFile(
    resolve(executorRoot, "scripts/backlog-classify.mjs"),
    `
export const classified = ({ labels, issueTypeName }) =>
  issueTypeName !== "Epic" && !labels.includes("status:tracking-only") &&
  labels.some((label) => label.startsWith("kind:")) &&
  labels.some((label) => label.startsWith("priority:")) &&
  labels.some((label) => label.startsWith("area:"));
`,
  );
  const dispatchPath = resolve(executorRoot, "scripts/dispatch-window.mjs");
  await writeFile(
    dispatchPath,
    (await readFile(dispatchPath, "utf8")).replace(
      "classified({ labels:",
      "classified({ issueTypeName: issue.issueTypeName, labels:",
    ),
  );
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
    body: '<!-- routing: {"version":1,"row":7,"review":11} -->\n## Acceptance Criteria\n\n- Ship the result.\n',
    state: "OPEN",
    issueType: { name: "Slice" },
    milestone: { id: `M${milestone}`, number: milestone },
    labels: {
      pageInfo: { hasNextPage: false },
      nodes: ["kind:slice", "priority:p0", "area:infrastructure", ...extraLabels].map((name) => ({
        name,
      })),
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
if (args[0] === "api" && args.some((arg) => arg.includes("issue(number:"))) {
  const number = Number(args.find((arg) => arg.startsWith("number=")).slice(7));
  fs.writeFileSync(process.stdout.fd, JSON.stringify({ data: { repository: { issue: issues.find((issue) => issue.number === number) } } }) + "\\n");
} else if (args[0] === "api") {
  const name = args.some((arg) => arg.includes("milestones(")) ? "milestones" : "issues";
  fs.writeFileSync(process.stdout.fd, JSON.stringify({ data: { repository: { [name]: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: name === "milestones" ? milestones : issues } } } }) + "\\n");
} else if (args[0] === "issue" && args[1] === "view") {
  const issue = issues.find((issue) => issue.number === Number(args[2]));
  fs.writeFileSync(process.stdout.fd, JSON.stringify({ ...issue, labels: issue.labels.nodes, comments }) + "\\n");
} else if (args[0] === "issue" && args[1] === "comment") {
  comments.push({ body: args[args.indexOf("--body") + 1] });
  fs.writeFileSync(commentsPath, JSON.stringify(comments));
} else { process.exit(2); }
`,
  );
  return { executorRoot, runtime, milestones, issues, issue, save, callsPath, commentsPath };
}

it.skipIf(process.platform === "win32")(
  "excludes missing, duplicate and malformed planning routes with typed diagnostics",
  async () => {
    const current = await scopedFixture();
    const issue = current.issues.find((row) => row.number === 4382)!;
    const valid = issue.body;
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const [body, reason] of [
        ["No planning route", "routing-marker-absent"],
        [`${valid}\n${valid}`, "routing-marker-duplicate"],
        ["<!-- routing: invalid -->", "routing-marker-malformed"],
      ]) {
        issue.body = body!;
        await current.save();
        expect(
          await chaseSets.selectCandidates({
            repository: "chase-sets/chase-sets",
            executorRoot: current.executorRoot,
          }),
        ).toEqual([]);
        expect(output).toHaveBeenCalledWith(expect.stringContaining(`"reason":"${reason}"`));
        await expect(
          chaseSets.issueContext({
            repository: "chase-sets/chase-sets",
            executorRoot: current.executorRoot,
            key: "cs-4382",
            number: 4382,
          }),
        ).rejects.toMatchObject({ reason });
      }
    } finally {
      output.mockRestore();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "scopes native selection without admitting dependencies, needs labels, or ops work",
  async () => {
    const current = await scopedFixture();
    const input = { repository: "chase-sets/chase-sets", executorRoot: current.executorRoot };
    await expect(chaseSets.selectCandidates(input)).resolves.toEqual([
      { key: "cs-4382", number: 4382, routing: { row: 7, review: 11 } },
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
      { selection: { cycle: 1, key: "cs-7825", number: 7825, routing: { row: 7, review: 11 } } },
    );
    await expect(
      adapter.issueContext({ ...input, targetMilestone: 155, key: "cs-7825", number: 7825 }),
    ).resolves.toMatchObject({ title: "Issue 7825" });
    current.issues[2]!.blockedBy.nodes[0]!.state = "CLOSED";
    await current.save();
    await expect(chaseSets.selectCandidates({ ...input, targetMilestone: 155 })).resolves.toEqual([
      { key: "cs-7822", number: 7822, routing: { row: 7, review: 11 } },
      { key: "cs-7825", number: 7825, routing: { row: 7, review: 11 } },
    ]);
    await expect(chaseSets.selectCandidates({ ...input, targetMilestone: 999 })).resolves.toEqual(
      [],
    );
  },
);

const opsAdmission = {
  issueNumber: 9001,
  authorityUrl: "https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5707757731",
};

it.skipIf(process.platform === "win32")(
  "forwards current admission through fresh and saved native composition without changing history",
  async () => {
    const f = await scopedFixture();
    const ops = f.issue(9001, 155, ["kind:ops"]);
    ops.labels.nodes.find(({ name }) => name.startsWith("priority:"))!.name = "priority:p1";
    f.issues.push(ops);
    await f.save();
    const execute = promisify(execFile);
    const gitExecutable = (await execute("which", ["git"])).stdout.trim();
    for (const args of [
      ["init", "-b", "main"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.test"],
      ["add", "."],
      ["commit", "-m", "fixture"],
    ])
      await execute(gitExecutable, ["-C", f.executorRoot, ...args]);
    const base = (
      await execute(gitExecutable, ["-C", f.executorRoot, "rev-parse", "HEAD"])
    ).stdout.trim();
    const config: LoopConfig = {
      schemaVersion: "dogfood-loop/v1",
      run: "ops-admission",
      adapter: "chase-sets",
      repository: "chase-sets/chase-sets",
      stableExecutorRoot: f.executorRoot,
      stateRoot: resolve(f.runtime, "state"),
      worktreeRoot: resolve(f.runtime, "worktrees"),
      routingRows: [
        {
          row: 7,
          review: 11,
          author: [{ model: "author", effort: "high" }],
          reviewer: [{ model: "reviewer", effort: "high" }],
        },
      ],
      gitExecutable,
      codexExecutable: process.execPath,
      nativeLaunchCeiling: 8,
      attemptCeiling: 4,
      targetMilestone: 155,
      opsAdmission,
    };
    const adapter = await loadRepositoryAdapter(
      "chase-sets",
      resolve(import.meta.dirname, "../.."),
    );
    const comments: string[] = [];
    let closed = false;
    const forbidden = async (): Promise<never> => {
      throw new Error("must not mutate issue or park");
    };
    const supervisor: SupervisionAdapter = {
      currentMain: async () => base,
      issue: async () => ({
        state: closed ? "CLOSED" : "OPEN",
        key: "cs-9001",
        labels: ["kind:ops"],
        comments,
      }),
      removeReady: forbidden,
      close: forbidden,
      comment: async (_config, _number, body) => {
        comments.push(body);
      },
    };
    const first = (await nextCycle(config, f.executorRoot, supervisor, adapter))!;
    expect(first.selection.number).toBe(9001);
    const { opsAdmission: omitted, ...without } = config;
    expect(omitted).toEqual(opsAdmission);
    await expect(nextCycle(without, f.executorRoot, supervisor, adapter)).resolves.toBeUndefined();
    await persistCycle(config, first);
    const selected = { key: first.selection.key, number: first.selection.number, base };
    const compose = (loop = config, policy = adapter) =>
      queueConfigFromLoop(loop, f.executorRoot, selected, policy);
    const queue = await compose();
    expect(queue.items[0]!.source.author.model).toBe("author");
    expect(queue.nativeLaunchCeiling).toBe(8);
    expect(queue.items[0]!.implementationAttemptCeiling).toBe(4);
    expect(queue.items[0]!.source.author.prompt).toContain("Ship the result");
    const runState = resolve(config.stateRoot, config.run);
    const selectedBytes = await readFile(resolve(runState, "cycle-1-selected.json"), "utf8");
    // A pending host note is reconciled without parking or completing the selection.
    const interrupted = {
      ...supervisor,
      comment: async (...args: Parameters<SupervisionAdapter["comment"]>) => {
        await supervisor.comment(...args);
        throw new Error("lost note receipt");
      },
    };
    await expect(
      stopCycle(config, first, "selected-ops-not-admitted", 1, interrupted, adapter),
    ).rejects.toThrow("lost note receipt");
    const stopBytes = await readFile(resolve(runState, "cycle-1-stop-1.json"), "utf8");
    f.issues.push(f.issue(8999, 155));
    await f.save();
    expect(
      (
        await adapter.selectCandidates({
          repository: config.repository,
          executorRoot: f.executorRoot,
          targetMilestone: 155,
          opsAdmission,
        })
      )[0]!.number,
    ).toBe(8999);
    for (let replay = 0; replay < 2; replay++) {
      await expect(nextCycle(config, f.executorRoot, supervisor, adapter)).resolves.toEqual(first);
      expect((await compose()).items[0]!.id).toBe(queue.items[0]!.id);
      for (const [loop, reason] of [
        [without, "selected-ops-not-admitted"],
        [
          { ...config, opsAdmission: { ...opsAdmission, issueNumber: 9002 } },
          "selected-ops-not-admitted",
        ],
      ] as const) {
        await expect(compose(loop)).rejects.toMatchObject({ reason });
      }
      // Removing only the context forwarding edge must invalidate the positive.
      await expect(
        compose(config, {
          ...adapter,
          issueContext: ({ opsAdmission: _admission, ...input }) => adapter.issueContext(input),
        }),
      ).rejects.toMatchObject({ reason: "selected-ops-not-admitted" });
      expect(await readFile(resolve(runState, "cycle-1-selected.json"), "utf8")).toBe(
        selectedBytes,
      );
      expect(await readFile(resolve(runState, "cycle-1-stop-1.json"), "utf8")).toBe(stopBytes);
    }
    await expect(readFile(resolve(runState, "cycle-1-complete.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(config.worktreeRoot)).toEqual([]);
    const original = structuredClone(ops);
    const changes: Array<(row: typeof ops) => void> = [
      (row) => {
        row.labels.nodes.push({ name: "status:needs-operator" });
      },
      (row) => {
        row.blockedBy.nodes.push({ number: 1, state: "OPEN" });
      },
      (row) => {
        row.issueType.name = "Epic";
      },
      (row) => {
        row.body = "<!-- routing: malformed -->";
      },
    ];
    for (const change of changes) {
      Object.assign(ops, structuredClone(original));
      change(ops);
      await f.save();
      await expect(compose()).rejects.toMatchObject({ reason: "selected-ops-not-runnable" });
    }
    Object.assign(ops, structuredClone(original));
    ops.milestone = { id: "M148", number: 148 };
    await f.save();
    await expect(compose()).rejects.toMatchObject({ reason: "selected-milestone-mismatch" });
    Object.assign(ops, structuredClone(original));
    await f.save();
    expect(await readdir(config.worktreeRoot)).toEqual([]);
    const participant: QueueParticipant = {
      ordinal: 1,
      id: "prior-failed-review",
      item: "cs-9001:1",
      stage: "source",
      role: "reviewer",
      outcome: "failed",
      usage: {
        inputTokens: { status: "unavailable" },
        outputTokens: { status: "unavailable" },
        costUsd: { status: "unavailable" },
      },
    };
    const participantPath = resolve(queue.stateDirectory, "participant-1-terminal.json");
    await mkdir(queue.stateDirectory, { recursive: true });
    const participantBytes = JSON.stringify(participant) + "\n";
    await writeFile(participantPath, participantBytes);
    closed = true;
    // Closure precedes context revalidation even after admission is removed.
    for (let replay = 0; replay < 2; replay++)
      await expect(nextCycle(without, f.executorRoot, supervisor, adapter)).resolves.toMatchObject({
        selection: { cycle: 2, number: 8999 },
        initialHistory: [participant],
      });
    expect(await readFile(participantPath, "utf8")).toBe(participantBytes);
    expect(await readFile(resolve(runState, "cycle-1-selected.json"), "utf8")).toBe(selectedBytes);
    expect(await readFile(resolve(runState, "cycle-1-stop-1.json"), "utf8")).toBe(stopBytes);
    expect(comments).toHaveLength(1);
    expect(comments[0]).not.toContain("To unpark");
  },
);

it.skipIf(process.platform === "win32")(
  "admits only the named target ops through native selection and current context",
  async () => {
    const f = await scopedFixture();
    const ops = f.issue(9001, 155, ["kind:ops"]);
    ops.labels.nodes = ops.labels.nodes.filter(({ name }) => name !== "kind:slice");
    ops.issueType.name = "Bug";
    f.issues.push(ops, f.issue(9002, 155, ["kind:ops"]), f.issue(9003, 155));
    await f.save();
    const adapter = await loadRepositoryAdapter(
      "chase-sets",
      resolve(import.meta.dirname, "../.."),
    );
    const input: Parameters<RepositoryAdapter["selectCandidates"]>[0] = {
      repository: "chase-sets/chase-sets",
      executorRoot: f.executorRoot,
      targetMilestone: 155,
      opsAdmission,
    };
    const context: Parameters<RepositoryAdapter["issueContext"]>[0] = {
      ...input,
      key: "cs-9001",
      number: 9001,
    };
    const numbers = async (value = input) =>
      (await adapter.selectCandidates(value)).map(({ number }) => number);
    expect(await numbers()).toEqual([9001, 9003]);
    const { opsAdmission: omitted, ...without } = input;
    expect(omitted).toEqual(opsAdmission);
    expect(await numbers(without)).toEqual([9003]);
    expect(
      await numbers({ ...input, opsAdmission: { ...opsAdmission, issueNumber: 9999 } }),
    ).toEqual([9003]);
    expect(await numbers({ ...input, targetMilestone: 148 })).toEqual([4382]);
    expect(await numbers({ ...input, targetMilestone: 999 })).toEqual([]);
    const { targetMilestone: target, ...unscoped } = without;
    expect(target).toBe(155);
    expect(await numbers(unscoped)).toEqual([4382]);
    for (const value of [
      null,
      [],
      { ...opsAdmission, issueNumber: "9001" },
      { ...opsAdmission, extra: true },
      { ...opsAdmission, authorityUrl: "secret" },
    ]) {
      const invalid: Parameters<RepositoryAdapter["selectCandidates"]>[0] = JSON.parse(
        JSON.stringify({ ...input, opsAdmission: value }),
      );
      await expect(adapter.selectCandidates(invalid)).rejects.toMatchObject({
        reason: "invalid-ops-admission",
      });
      await expect(
        adapter.issueContext({ ...invalid, key: context.key, number: context.number }),
      ).rejects.toMatchObject({ reason: "invalid-ops-admission" });
    }
    await expect(adapter.selectCandidates({ ...unscoped, opsAdmission })).rejects.toMatchObject({
      reason: "invalid-ops-admission",
    });
    await expect(adapter.issueContext(context)).resolves.toMatchObject({ title: "Issue 9001" });
    // An admission naming non-ops does not change legacy non-ops context behavior.
    await expect(
      adapter.issueContext({
        ...context,
        key: "cs-7820",
        number: 7820,
        opsAdmission: { ...opsAdmission, issueNumber: 7820 },
      }),
    ).resolves.toMatchObject({ title: "Issue 7820" });
    await expect(
      adapter.issueContext({ ...without, key: context.key, number: context.number }),
    ).rejects.toMatchObject({ reason: "selected-ops-not-admitted" });
    await expect(
      adapter.issueContext({ ...context, opsAdmission: { ...opsAdmission, issueNumber: 9002 } }),
    ).rejects.toMatchObject({ reason: "selected-ops-not-admitted" });
    const original = structuredClone(ops);
    const mutations: Array<(row: typeof ops) => void> = [
      ...[
        "status:needs-operator",
        "status:needs-replan",
        "status:needs-design",
        "status:tracking-only",
      ].map((name) => (row: typeof ops) => {
        row.labels.nodes.push({ name });
      }),
      (row) => {
        row.blockedBy.nodes.push({ number: 1, state: "OPEN" });
      },
      (row) => {
        row.labels.nodes = row.labels.nodes.filter(({ name }) => !name.startsWith("area:"));
      },
      (row) => {
        row.issueType.name = "Epic";
      },
      (row) => {
        row.body = "No marker";
      },
      (row) => {
        row.body += row.body;
      },
      (row) => {
        row.body = "<!-- routing: malformed -->";
      },
    ];
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const mutate of mutations) {
        Object.assign(ops, structuredClone(original));
        mutate(ops);
        await f.save();
        expect(await numbers()).toEqual([9003]);
        await expect(adapter.issueContext(context)).rejects.toMatchObject({
          reason: "selected-ops-not-runnable",
          diagnostics: expect.stringContaining("Issue #9001; target 155;"),
        });
      }
    } finally {
      output.mockRestore();
    }
    Object.assign(ops, structuredClone(original));
    ops.blockedBy.nodes.push({ number: 1, state: "CLOSED" });
    await f.save();
    expect(await numbers()).toEqual([9001, 9003]);
    const milestone = f.milestones.find(({ number }) => number === 155)!;
    milestone.description = "not executable";
    await f.save();
    expect(await numbers()).toEqual([]);
    await expect(adapter.issueContext(context)).rejects.toMatchObject({
      reason: "selected-ops-not-runnable",
    });
    milestone.description = "committed";
    const targetIndex = f.milestones.indexOf(milestone);
    f.milestones.splice(targetIndex, 1);
    await f.save();
    expect(await numbers()).toEqual([]);
    await expect(adapter.issueContext(context)).rejects.toMatchObject({
      reason: "selected-ops-not-runnable",
    });
    f.milestones.splice(targetIndex, 0, milestone);
    ops.milestone = { id: "M148", number: 148 };
    await f.save();
    await expect(adapter.issueContext(context)).rejects.toMatchObject({
      reason: "selected-milestone-mismatch",
    });
    Object.assign(ops, structuredClone(original));
    for (const connection of [ops.labels, ops.blockedBy]) {
      connection.pageInfo.hasNextPage = true;
      await f.save();
      await expect(adapter.selectCandidates(input)).rejects.toMatchObject({
        reason: "issue-observation-unavailable",
      });
      await expect(adapter.issueContext(context)).rejects.toMatchObject({
        reason: "selected-ops-not-runnable",
      });
      connection.pageInfo.hasNextPage = false;
    }
    await f.save();
    await writeFile(
      resolve(f.executorRoot, "scripts/dispatch-window.mjs"),
      'throw new Error("synthetic-secret-body");',
    );
    // A different root avoids the module cache and proves raw reader errors stay private.
    const brokenRoot = resolve(f.runtime, "broken");
    await cp(f.executorRoot, brokenRoot, { recursive: true });
    for (const call of [
      () => adapter.selectCandidates({ ...input, executorRoot: brokenRoot }),
      () => adapter.issueContext({ ...context, executorRoot: brokenRoot }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        diagnostics: expect.stringContaining("authority-unavailable"),
      });
      await expect(call()).rejects.not.toThrow("synthetic-secret-body");
    }
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["selected-milestone-mismatch", "selected-ops-not-admitted", "selected-ops-not-runnable"])(
  "stops saved cycle 2 with %s before dispatch and preserves its scheduling records",
  async (reason) => {
    const { executorRoot, runtime, callsPath, commentsPath, issues, save } = await scopedFixture();
    if (reason !== "selected-milestone-mismatch") {
      issues[0]!.milestone = { id: "M155", number: 155 };
      issues[0]!.labels.nodes.push({ name: "kind:ops" });
      if (reason === "selected-ops-not-runnable")
        issues[0]!.labels.nodes.push({ name: "status:needs-replan" });
      await save();
    }
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
      routingRows: [],
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
      ...(reason === "selected-ops-not-runnable"
        ? { opsAdmission: { ...opsAdmission, issueNumber: 4382 } }
        : {}),
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
    const run = async () => {
      // Capture stdout to a file, as in supervise.test.ts: sandboxed Node children
      // can lose asynchronous output when stdout is a pipe.
      const stdoutPath = resolve(runtime, "supervise.stdout");
      const stdout = await open(stdoutPath, "w");
      let stderr = "";
      let code;
      try {
        code = await new Promise<number | null>((done, reject) => {
          const child = spawn(
            process.execPath,
            [resolve(controller, "scripts/dogfood/supervise.mjs"), configPath],
            {
              stdio: ["ignore", stdout.fd, "pipe"],
              timeout: 10_000,
            },
          );
          child.stderr!.on("data", (chunk) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("close", done);
        });
      } finally {
        await stdout.close();
      }
      if (code !== 0) throw { code, stderr };
      return { stdout: await readFile(stdoutPath, "utf8"), stderr };
    };
    for (let restart = 1; restart <= 2; restart += 1) {
      await expect(run()).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`"reason":"${reason}"`),
      });
      for (const [name, bytes] of Object.entries(preserved))
        await expect(readFile(resolve(runState, name), "utf8")).resolves.toBe(bytes);
      const stop = JSON.parse(
        await readFile(resolve(runState, `cycle-2-stop-${restart}.json`), "utf8"),
      );
      expect(stop).toMatchObject({
        reason,
        selection: { number: 4382 },
      });
      expect(stop.body).toContain(
        reason === "selected-milestone-mismatch"
          ? "outside target milestone 155"
          : "Issue #4382; target 155;",
      );
      expect(stop.body).not.toContain("To unpark");
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
      calls.every(
        (args) =>
          (args[0] === "issue" && ["view", "comment"].includes(args[1]!)) ||
          (args[0] === "api" && args[1] === "graphql"),
      ),
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
      { key: "cs-9", number: 9, routing: { row: 7, review: 11 } },
      { key: "cs-5", number: 5, routing: { row: 7, review: 11 } },
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
      routing: { row: 7, review: 11 },
      body: '<!-- routing: {"version":1,"row":7,"review":11} -->\n## Context\nFixture.\n\n## Acceptance Criteria\n\n- First result\n- Second result\n  with detail\n',
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
      run: "chase-sets-fixture",
      stateDirectory: executorRoot,
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
    await writeFile(
      resolve(executorRoot, "reviewer-terminal.json"),
      JSON.stringify({
        summary: JSON.stringify({
          run: deliveryConfig.run,
          role: "reviewer",
          head: deliveryConfig.candidateHead,
          verdict: "PASS",
          findings: [],
          g0: "No, the existing adapter seam is required.",
        }),
      }),
    );
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
        "- Tests (`test/`): 3 added, 4 deleted, net -1\n\n" +
        "Review G0: No, the existing adapter seam is required.",
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

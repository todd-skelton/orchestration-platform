import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { sha } from "../../scripts/dogfood/flow.js";
import {
  assertControllerExecutor,
  githubDeliveryAdapter,
} from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  deliveryStep,
  type DeliveryConfig,
  type DeliveryPlan,
  type PublicationEvidence,
} from "../../scripts/dogfood/delivery.mjs";
import { candidateLineChanges, selfPlanFromSnapshots } from "../../adapters/self.mjs";
import { repositoryDeliveryPolicy } from "../../scripts/dogfood/repository-adapter.mjs";

const head = "a".repeat(40);
const authorId = "11111111-1111-1111-1111-111111111111";
const reviewId = "22222222-2222-2222-2222-222222222222";
const roots: string[] = [];

function reviewerReport(
  current: DeliveryConfig,
  verdict: "PASS" | "FAIL" = "PASS",
  findings: { file: string; line: number; severity: "blocking" | "note"; text: string }[] = [],
) {
  return JSON.stringify({
    run: current.run,
    role: "reviewer",
    head: current.candidateHead,
    verdict,
    findings,
    g0: "The reviewed change is already the simplest implementation.",
  });
}

function config(root: string): DeliveryConfig {
  return {
    controller: "external-controller",
    run: "self-delivery-fixture",
    issue: "https://github.com/todd-skelton/orchestration-platform/issues/332",
    repository: "todd-skelton/orchestration-platform",
    controllerRoot: resolve(root, "controller"),
    repositoryRoot: resolve(root, "controller"),
    controllerRevision: "c".repeat(40),
    worktree: resolve(root, "author"),
    reviewWorktree: resolve(root, "reviewer"),
    stateDirectory: resolve(root, "state"),
    candidateHead: head,
    retries: 0,
    requiredChecks: [
      "Node 24 / ubuntu-latest",
      "Node 24 / windows-latest",
      "Node 24 / macos-latest",
    ],
    policy: {
      key: "ISS-074",
      number: 332,
      title: "Deliver",
      sourceBranch: "codex/iss-074-delivery",
    },
  };
}

function pilotConfig(current: DeliveryConfig) {
  return {
    owner: current.controller,
    run: current.run,
    issue: current.issue,
    repository: current.repository,
    pilotRevision: current.controllerRevision,
    base: "d".repeat(40),
    worktree: current.worktree,
    reviewWorktree: current.reviewWorktree,
    stateDirectory: current.stateDirectory,
    requiredChecks: [...current.requiredChecks],
  };
}

async function writePilotEvidence(
  current: DeliveryConfig,
  values: {
    author?: unknown;
    authorTerminal?: unknown;
    reviewerAttempt?: unknown;
    reviewerTerminal?: unknown;
    pinnedConfig?: unknown;
  } = {},
) {
  const pilot = pilotConfig(current);
  const author = values.author ?? {
    id: authorId,
    pid: 101,
    trace: resolve(current.stateDirectory, "author.jsonl"),
    launchedAt: 1,
  };
  const reviewerAttempt = values.reviewerAttempt ?? {
    id: reviewId,
    pid: 202,
    trace: resolve(current.stateDirectory, "reviewer.jsonl"),
    launchedAt: 1,
  };
  await Promise.all([
    writeFile(
      resolve(current.stateDirectory, "config.json"),
      JSON.stringify({ fingerprint: "e".repeat(64), config: values.pinnedConfig ?? pilot }),
    ),
    writeFile(
      resolve(current.stateDirectory, "candidate.json"),
      JSON.stringify({ head: current.candidateHead }),
    ),
    writeFile(resolve(current.stateDirectory, "author-attempt.json"), JSON.stringify(author)),
    writeFile(
      resolve(current.stateDirectory, "author-terminal.json"),
      JSON.stringify(
        values.authorTerminal ?? {
          id: (author as { id?: unknown }).id,
          status: "passed",
          head: pilot.base,
        },
      ),
    ),
    writeFile(
      resolve(current.stateDirectory, "reviewer-attempt.json"),
      JSON.stringify(reviewerAttempt),
    ),
    writeFile(
      resolve(current.stateDirectory, "reviewer-terminal.json"),
      JSON.stringify(
        values.reviewerTerminal ?? {
          id: (reviewerAttempt as { id?: unknown }).id,
          status: "passed",
          head: current.candidateHead,
          summary: reviewerReport(current),
        },
      ),
    ),
  ]);
}

async function cleanController(root: string) {
  const current = config(root);
  await Promise.all(
    [current.controllerRoot, current.worktree, current.reviewWorktree, current.stateDirectory].map(
      (path) => mkdir(path),
    ),
  );
  await promisify(execFile)("git", ["init", "--quiet"], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  await promisify(execFile)("git", ["branch", "-M", "main"], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  await promisify(execFile)("git", ["config", "core.autocrlf", "false"], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  await writeFile(resolve(current.controllerRoot, "stable.txt"), "stable\n");
  await promisify(execFile)("git", ["add", "stable.txt"], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  await promisify(execFile)(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "stable",
    ],
    { cwd: current.controllerRoot, windowsHide: true },
  );
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  current.controllerRevision = stdout.trim();
  return current;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repositoryFixture(remote: string) {
  // A regressed guard must still never contact a real provider from a fixture.
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "file");
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-repository-")));
  roots.push(root);
  const current = await cleanController(root);
  const git = async (args: string[], cwd = current.controllerRoot) =>
    (await promisify(execFile)("git", args, { cwd, windowsHide: true })).stdout.trim();
  await git(["remote", "add", "origin", remote]);
  await git(["worktree", "add", "-b", "codex/iss-074-delivery", current.worktree, "HEAD"]);
  await git(["worktree", "add", "--detach", current.reviewWorktree, "HEAD"]);
  current.candidateHead = current.controllerRevision;
  return { current, git };
}

async function localRemoteRepositoryFixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-cleanup-")));
  roots.push(root);
  const current = await cleanController(root);
  const remoteRoot = resolve(root, "remote.git");
  await mkdir(remoteRoot);
  await promisify(execFile)("git", ["init", "--bare", "--quiet"], {
    cwd: remoteRoot,
    windowsHide: true,
  });
  const ssh = resolve(root, "fixture-ssh.mjs");
  await writeFile(
    ssh,
    [
      'import { spawn } from "node:child_process";',
      `const repository = ${JSON.stringify(remoteRoot)};`,
      'const service = process.argv.some((value) => value.includes("git-receive-pack"))',
      '  ? "receive-pack"',
      '  : "upload-pack";',
      'const child = spawn("git", [service, repository], { stdio: "inherit", windowsHide: true });',
      'child.once("error", () => process.exit(1));',
      'child.once("close", (code) => process.exit(code ?? 1));',
      "",
    ].join("\n"),
  );
  const commandPath = (value: string) => `"${value.replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
  vi.stubEnv("GIT_SSH_COMMAND", `${commandPath(process.execPath)} ${commandPath(ssh)}`);
  vi.stubEnv("GIT_SSH_VARIANT", "ssh");
  const git = async (args: string[], cwd = current.controllerRoot) =>
    (await promisify(execFile)("git", args, { cwd, windowsHide: true })).stdout.trim();
  await git([
    "remote",
    "add",
    "origin",
    "ssh://git@github.com/todd-skelton/orchestration-platform.git",
  ]);
  await git(["worktree", "add", "-b", "codex/iss-074-delivery", current.worktree, "HEAD"]);
  await git(["worktree", "add", "--detach", current.reviewWorktree, "HEAD"]);
  current.candidateHead = current.controllerRevision;
  await git(["branch", "protected/fixture", current.candidateHead]);
  await git(["push", "origin", `${current.candidateHead}:refs/heads/codex/iss-074-delivery`]);
  await git(["push", "origin", `${current.candidateHead}:refs/heads/protected/fixture`]);
  return { current, git };
}

async function commitCandidate(
  current: DeliveryConfig,
  git: (args: string[], cwd?: string) => Promise<string>,
  contents = "reviewed refresh\n",
) {
  await writeFile(resolve(current.worktree, "refresh.txt"), contents);
  await git(["add", "refresh.txt"], current.worktree);
  await git(
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "reviewed refresh",
    ],
    current.worktree,
  );
  const candidate = await git(["rev-parse", "HEAD"], current.worktree);
  await git(["checkout", "--detach", candidate], current.reviewWorktree);
  current.candidateHead = candidate;
  return candidate;
}

async function stateSnapshot(directory: string) {
  const names = (await readdir(directory)).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(resolve(directory, name), "utf8")]),
    ),
  );
}

function publicationEvidence(current: DeliveryConfig): PublicationEvidence {
  return {
    number: 44,
    url: `https://github.com/${current.repository}/pull/44`,
    head: current.candidateHead,
    repository: current.repository,
    sourceBranch: "codex/iss-074-delivery",
    baseBranch: "main",
    title: "automate normal delivery",
    body: "reviewed delivery candidate",
    planDigest: "f".repeat(64),
  };
}

function publicationRow(current: PublicationEvidence, values: Record<string, unknown> = {}) {
  return {
    number: current.number,
    url: current.url,
    headRefOid: current.head,
    headRefName: current.sourceBranch,
    baseRefName: current.baseBranch,
    state: "OPEN",
    isDraft: true,
    title: current.title,
    body: current.body,
    mergeCommit: null,
    ...values,
  };
}

it.each([
  "https://github.com/todd-skelton/orchestration-platform.git",
  "git@github.com:todd-skelton/orchestration-platform.git",
  "ssh://git@github.com/todd-skelton/orchestration-platform.git",
])("accepts one authorized effective Git target using %s", async (remote) => {
  const { current } = await repositoryFixture(remote);
  await expect(
    githubDeliveryAdapter().verifyWorkspace(current, current.candidateHead),
  ).resolves.toBe(true);
});

it.each(["foreign-fetch", "foreign-push", "extra-push"] as const)(
  "rejects %s before publication or cleanup",
  async (mode) => {
    const authorized = "https://github.com/todd-skelton/orchestration-platform.git";
    const { current, git } = await repositoryFixture(authorized);
    if (mode === "foreign-fetch")
      await git(["remote", "set-url", "origin", "https://github.com/foreign/repository.git"]);
    else if (mode === "foreign-push")
      await git([
        "remote",
        "set-url",
        "--push",
        "origin",
        "https://github.com/foreign/repository.git",
      ]);
    else {
      await git(["remote", "set-url", "--push", "origin", authorized]);
      await git(["remote", "set-url", "--add", "--push", "origin", authorized]);
    }
    const adapter = githubDeliveryAdapter();
    await expect(adapter.verifyWorkspace(current, current.candidateHead)).resolves.toBe(false);
    await expect(
      adapter.publish(
        current,
        {
          sourceBranch: "codex/iss-074-delivery",
          baseBranch: "main",
          title: "fixture",
          body: "fixture",
          draft: true,
        },
        "absent",
      ),
    ).rejects.toThrow("candidate-workspace-drift");
    await expect(
      adapter.cleanup(
        current,
        {
          branch: "codex/iss-074-delivery",
          worktrees: [current.worktree, current.reviewWorktree],
        },
        { number: 44, head: current.candidateHead, mergeCommit: "b".repeat(40) },
      ),
    ).rejects.toThrow("delivery-repository-mismatch");
    await expect(readFile(resolve(current.worktree, "stable.txt"), "utf8")).resolves.toBe(
      "stable\n",
    );
    await expect(readFile(resolve(current.reviewWorktree, "stable.txt"), "utf8")).resolves.toBe(
      "stable\n",
    );
    await expect(
      readFile(resolve(current.stateDirectory, "approved-pull-request.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("revalidates full publication identity after checks before ready or merge effects", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const effects: string[][] = [];
  let drifted = false;
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      if (args[1] === "ready" || args[1] === "merge") effects.push(args);
      return "[]";
    },
    async ghJson() {
      return publicationRow(publication, drifted ? { baseRefName: "release" } : {});
    },
  });
  await expect(adapter.checks(current, publication)).resolves.toEqual({
    head: current.candidateHead,
    checks: [],
  });
  drifted = true;
  await expect(adapter.merge(current, publication, { method: "squash" })).rejects.toThrow(
    "merge-head-drift",
  );
  expect(effects).toEqual([]);
});

it("distinguishes the installed CLI no-check response from provider failure", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const noChecks = githubDeliveryAdapter({
    async gh() {
      throw Object.assign(new Error("no checks"), {
        code: 1,
        stdout: "",
        stderr: "no checks reported on the 'codex/iss-113' branch\n",
      });
    },
    async ghJson() {
      return publicationRow(publication);
    },
  });
  await expect(noChecks.checks(current, publication)).resolves.toEqual({
    head: current.candidateHead,
    checks: [],
  });

  const unavailable = githubDeliveryAdapter({
    async gh() {
      throw Object.assign(new Error("provider unavailable"), {
        code: 1,
        stdout: "",
        stderr: "provider unavailable\n",
      });
    },
    async ghJson() {
      return publicationRow(publication);
    },
  });
  await expect(unavailable.checks(current, publication)).rejects.toMatchObject({
    reason: "hosted-observation-unavailable",
    diagnostics: "provider unavailable",
  });
});

it("revalidates full publication identity after making a draft ready", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const effects: string[][] = [];
  let observations = 0;
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      return "";
    },
    async ghJson() {
      observations += 1;
      return publicationRow(
        publication,
        observations === 1 ? {} : { baseRefName: "release", isDraft: false },
      );
    },
  });
  await expect(adapter.merge(current, publication, { method: "squash" })).rejects.toThrow(
    "merge-head-drift",
  );
  expect(effects).toEqual([["pr", "ready", "44"]]);
  expect(effects.some((args) => args.includes("merge"))).toBe(false);
});

it("can resume merge for an already-ready PR with unchanged approved identity", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const effects: string[][] = [];
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      return "";
    },
    async ghJson() {
      return publicationRow(publication, { isDraft: false });
    },
  });
  await expect(adapter.merge(current, publication, { method: "squash" })).resolves.toBeUndefined();
  expect(effects).toEqual([
    ["pr", "merge", "44", "--squash", "--match-head-commit", current.candidateHead],
  ]);
});

it("enqueues an unchanged ready PR and observes its queue membership", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const effects: string[][] = [];
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      return "";
    },
    async ghJson(_config, args) {
      if (args[0] === "api") {
        expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
        expect(args[3]).toContain("mergeQueueEntry{state}");
        return {
          data: {
            repository: {
              pullRequest: publicationRow(publication, {
                isDraft: false,
                mergeQueueEntry: { state: "QUEUED" },
              }),
            },
          },
        };
      }
      return publicationRow(publication, { isDraft: false });
    },
  });
  await expect(adapter.observeMerge(current, publication, { method: "queue" })).resolves.toEqual({
    state: "pending",
  });
  await expect(adapter.merge(current, publication, { method: "queue" })).resolves.toBeUndefined();
  expect(effects).toEqual([["pr", "merge", "44", "--squash"]]);
});

it("observes when an unchanged ready PR is removed from the merge queue", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const adapter = githubDeliveryAdapter({
    async gh() {
      throw new Error("unexpected provider mutation");
    },
    async ghJson() {
      return {
        data: {
          repository: {
            pullRequest: publicationRow(publication, {
              isDraft: false,
              mergeQueueEntry: null,
            }),
          },
        },
      };
    },
  });
  await expect(adapter.observeMerge(current, publication, { method: "queue" })).resolves.toEqual({
    state: "needs-mutation",
    detail: "absent",
  });
});

it.each([undefined, null, "false", "true", 0, 1])(
  "rejects a malformed initial draft flag %s before ready or merge",
  async (isDraft) => {
    const { current } = await repositoryFixture(
      "https://github.com/todd-skelton/orchestration-platform.git",
    );
    const publication = publicationEvidence(current);
    const effects: string[][] = [];
    const adapter = githubDeliveryAdapter({
      async gh(_config, args) {
        effects.push(args);
        return "";
      },
      async ghJson() {
        return publicationRow(publication, { isDraft });
      },
    });
    await expect(adapter.merge(current, publication, { method: "squash" })).rejects.toThrow(
      "merge-head-drift",
    );
    expect(effects).toEqual([]);
  },
  30_000,
);

it.each([undefined, null, "false", "true", 0, 1])(
  "rejects a malformed post-ready draft flag %s before merge",
  async (isDraft) => {
    const { current } = await repositoryFixture(
      "https://github.com/todd-skelton/orchestration-platform.git",
    );
    const publication = publicationEvidence(current);
    const effects: string[][] = [];
    let observations = 0;
    const adapter = githubDeliveryAdapter({
      async gh(_config, args) {
        effects.push(args);
        return "";
      },
      async ghJson() {
        return publicationRow(publication, { isDraft: ++observations === 1 ? true : isDraft });
      },
    });
    await expect(adapter.merge(current, publication, { method: "squash" })).rejects.toThrow(
      "merge-head-drift",
    );
    expect(effects).toEqual([["pr", "ready", "44"]]);
  },
);

it.each(["replacement", "base", "head", "malformed", "absent"])(
  "refuses publication target %s after selecting an existing draft",
  async (mode) => {
    const { current } = await repositoryFixture(
      "https://github.com/todd-skelton/orchestration-platform.git",
    );
    const publication = publicationEvidence(current);
    const plan = {
      sourceBranch: publication.sourceBranch,
      baseBranch: publication.baseBranch,
      title: publication.title,
      body: publication.body,
      draft: true as const,
    };
    const effects: string[][] = [];
    const initial = publicationRow(publication, { title: "old title" });
    let rows = [initial];
    const adapter = githubDeliveryAdapter({
      async gh(_config, args) {
        effects.push(args);
        return "";
      },
      async ghJson() {
        return rows;
      },
    });
    const selected = await adapter.observePublication(current, plan, publication.planDigest);
    expect(selected).toEqual({ state: "needs-mutation", target: "pr:44" });
    if (selected.state !== "needs-mutation") throw new Error("expected target");
    rows =
      mode === "absent"
        ? []
        : [
            publicationRow(publication, {
              title: "old title",
              ...(mode === "replacement"
                ? { number: 45, url: `https://github.com/${current.repository}/pull/45` }
                : mode === "base"
                  ? { baseRefName: "release" }
                  : mode === "head"
                    ? { headRefOid: "b".repeat(40) }
                    : { number: "44" }),
            }),
          ];
    await expect(adapter.publish(current, plan, selected.target)).rejects.toThrow(
      "publication-target-drift",
    );
    expect(effects).toEqual([]);
    await expect(
      adapter.observePublication(current, plan, publication.planDigest, selected.target),
    ).resolves.toEqual({ state: "unknown" });
  },
);

it("refuses to edit a draft that appeared after an absence observation", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  const publication = publicationEvidence(current);
  const plan = {
    sourceBranch: publication.sourceBranch,
    baseBranch: publication.baseBranch,
    title: publication.title,
    body: publication.body,
    draft: true as const,
  };
  let rows: unknown[] = [];
  const effects: string[][] = [];
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      return "";
    },
    async ghJson() {
      return rows;
    },
  });
  await expect(adapter.observePublication(current, plan, publication.planDigest)).resolves.toEqual({
    state: "needs-mutation",
    target: "absent",
  });
  rows = [publicationRow(publication, { title: "unapproved title" })];
  await expect(adapter.publish(current, plan, "absent")).rejects.toThrow(
    "publication-target-drift",
  );
  expect(effects).toEqual([]);
});

it("refreshes one exact existing draft forward under its observed remote lease", async () => {
  const { current, git } = await localRemoteRepositoryFixture();
  const priorHead = current.candidateHead;
  const candidate = await commitCandidate(current, git);
  current.refresh = {
    number: 44,
    url: `https://github.com/${current.repository}/pull/44`,
    head: priorHead,
  };
  const publication = publicationEvidence(current);
  const plan = {
    sourceBranch: publication.sourceBranch,
    baseBranch: publication.baseBranch,
    title: publication.title,
    body: publication.body,
    draft: true as const,
  };
  const effects: string[][] = [];
  const remoteHead = async () =>
    (await git(["ls-remote", "--heads", "origin", `refs/heads/${plan.sourceBranch}`])).split(
      /\s+/,
    )[0]!;
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      return "";
    },
    async ghJson() {
      return [
        publicationRow(publication, {
          headRefOid: await remoteHead(),
          title: "earlier failed attempt",
        }),
      ];
    },
  });

  await expect(adapter.observePublication(current, plan, "f".repeat(64))).resolves.toEqual({
    state: "needs-mutation",
    target: "pr:44",
  });
  await expect(adapter.observePublication(current, plan, "f".repeat(64), "pr:44")).resolves.toEqual(
    { state: "unknown" },
  );
  await expect(adapter.publish(current, plan, "pr:44")).resolves.toBeUndefined();
  expect(await remoteHead()).toBe(candidate);
  expect(effects).toEqual([
    [
      "pr",
      "edit",
      "44",
      "--title",
      publication.title,
      "--body-file",
      resolve(current.stateDirectory, "approved-pull-request.md"),
    ],
  ]);
}, 30_000);

it.each([
  ["absent", () => []],
  [
    "closed",
    (publication: PublicationEvidence) => [publicationRow(publication, { state: "CLOSED" })],
  ],
  [
    "duplicate",
    (publication: PublicationEvidence) => [
      publicationRow(publication),
      publicationRow(publication),
    ],
  ],
  [
    "wrong number",
    (publication: PublicationEvidence) => [publicationRow(publication, { number: 45 })],
  ],
  [
    "wrong URL",
    (publication: PublicationEvidence) => [
      publicationRow(publication, { url: "https://github.com/foreign/repository/pull/44" }),
    ],
  ],
  [
    "wrong source",
    (publication: PublicationEvidence) => [
      publicationRow(publication, { headRefName: "codex/other-delivery" }),
    ],
  ],
  [
    "wrong base",
    (publication: PublicationEvidence) => [publicationRow(publication, { baseRefName: "release" })],
  ],
] as const)(
  "refuses a refresh with %s target without effects",
  async (_mode, rowsFor) => {
    const { current } = await repositoryFixture(
      "https://github.com/todd-skelton/orchestration-platform.git",
    );
    current.refresh = {
      number: 44,
      url: `https://github.com/${current.repository}/pull/44`,
      head: "b".repeat(40),
    };
    const publication = publicationEvidence(current);
    const plan = {
      sourceBranch: publication.sourceBranch,
      baseBranch: publication.baseBranch,
      title: publication.title,
      body: publication.body,
      draft: true as const,
    };
    const effects: string[][] = [];
    const before = await stateSnapshot(current.stateDirectory);
    const rows = rowsFor(publication);
    const adapter = githubDeliveryAdapter({
      async gh(_config, args) {
        effects.push(args);
        return "";
      },
      async ghJson() {
        return rows;
      },
    });

    await expect(
      adapter.observePublication(current, plan, publication.planDigest),
    ).resolves.toEqual({
      state: "unknown",
    });
    await expect(adapter.publish(current, plan, "pr:44")).rejects.toThrow(
      "publication-target-drift",
    );
    expect(effects).toEqual([]);
    expect(await stateSnapshot(current.stateDirectory)).toEqual(before);
  },
  30_000,
);

it("refuses a refresh when the exact remote lease has already moved", async () => {
  const { current, git } = await localRemoteRepositoryFixture();
  const priorHead = current.candidateHead;
  const candidate = await commitCandidate(current, git);
  current.refresh = {
    number: 44,
    url: `https://github.com/${current.repository}/pull/44`,
    head: priorHead,
  };
  await git(["push", "origin", `${candidate}:refs/heads/codex/iss-074-delivery`], current.worktree);
  const publication = publicationEvidence(current);
  const plan = {
    sourceBranch: publication.sourceBranch,
    baseBranch: publication.baseBranch,
    title: publication.title,
    body: publication.body,
    draft: true as const,
  };
  const adapter = githubDeliveryAdapter({
    async gh() {
      throw new Error("unexpected provider mutation");
    },
    async ghJson() {
      return [publicationRow(publication, { headRefOid: priorHead, title: "failed attempt" })];
    },
  });

  await expect(adapter.publish(current, plan, "pr:44")).rejects.toThrow(
    "publication-refresh-lease-drift",
  );
}, 30_000);

it("refuses a reviewed refresh that is not forward from the prior publication head", async () => {
  const { current, git } = await localRemoteRepositoryFixture();
  const rootHead = current.candidateHead;
  const priorHead = await commitCandidate(current, git, "prior publication\n");
  await git(["push", "origin", `${priorHead}:refs/heads/codex/iss-074-delivery`], current.worktree);
  await git(["checkout", "-B", "codex/iss-074-delivery", rootHead], current.worktree);
  const candidate = await commitCandidate(current, git, "divergent candidate\n");
  current.refresh = {
    number: 44,
    url: `https://github.com/${current.repository}/pull/44`,
    head: priorHead,
  };
  expect(candidate).not.toBe(priorHead);
  const publication = publicationEvidence(current);
  const plan = {
    sourceBranch: publication.sourceBranch,
    baseBranch: publication.baseBranch,
    title: publication.title,
    body: publication.body,
    draft: true as const,
  };
  const adapter = githubDeliveryAdapter({
    async gh() {
      throw new Error("unexpected provider mutation");
    },
    async ghJson() {
      return [publicationRow(publication, { headRefOid: priorHead, title: "failed attempt" })];
    },
  });

  await expect(adapter.publish(current, plan, "pr:44")).rejects.toThrow(
    "publication-refresh-not-forward",
  );
}, 30_000);

it("reconciles a lost merge through the engine and the real OPEN-only checks adapter", async () => {
  const { current } = await repositoryFixture(
    "https://github.com/todd-skelton/orchestration-platform.git",
  );
  await writePilotEvidence(current);
  const publication = publicationEvidence(current);
  const plan: DeliveryPlan = {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [{ key: "ISS-074", issue: 332, title: "issue", body: "body", attributes: {} }],
    publication: {
      sourceBranch: publication.sourceBranch,
      baseBranch: publication.baseBranch,
      title: publication.title,
      body: publication.body,
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: {
      worktrees: [current.worktree, current.reviewWorktree],
      branch: publication.sourceBranch,
    },
  };
  const effects: string[][] = [];
  let merged = false,
    lostObservation = false,
    ready = false,
    cleaned = false;
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      if (args[1] === "checks")
        return JSON.stringify(
          current.requiredChecks.map((name) => ({
            name,
            bucket: "pass",
            link: `https://example.test/check/${encodeURIComponent(name)}`,
          })),
        );
      if (args[1] === "ready") ready = true;
      if (args[1] === "merge") {
        merged = true;
        lostObservation = true;
        throw new Error("lost merge response");
      }
      return "";
    },
    async ghJson(_config, args) {
      if (lostObservation) {
        lostObservation = false;
        throw new Error("lost observation");
      }
      const row = publicationRow(publication, {
        state: merged ? "MERGED" : "OPEN",
        isDraft: !ready,
        mergeCommit: merged ? { oid: "b".repeat(40) } : null,
      });
      return args[1] === "list" ? [row] : row;
    },
  });
  adapter.runGate = async () => "passed";
  adapter.observeDraft = async (_config, draft) => ({
    state: "confirmed",
    value: { issue: draft.issue },
  });
  adapter.observeCleanup = async () =>
    cleaned ? { state: "confirmed", value: plan.cleanup } : { state: "needs-mutation" };
  adapter.cleanup = async () => {
    cleaned = true;
  };
  const policy = { plan: async () => plan };
  await expect(deliveryStep(current, adapter, policy)).rejects.toThrow("merge-outcome-unknown");
  expect(merged).toBe(true);
  await expect(
    readFile(resolve(current.stateDirectory, "merge.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  // The real checks adapter refuses MERGED. The engine must reconcile before calling it.
  await expect(adapter.checks(current, publication)).rejects.toThrow(
    "hosted-observation-unavailable",
  );
  await expect(deliveryStep(current, adapter, policy)).resolves.toMatchObject({
    status: "complete",
  });
  expect(effects.filter((args) => args[1] === "merge")).toHaveLength(1);
  expect(effects.filter((args) => args[1] === "checks")).toHaveLength(1);
  expect(cleaned).toBe(true);
  // Two engine cycles perform real Git identity checks; Windows CI exceeds the 5s default.
}, 30_000);

it("cleans real Git state, confirms exact absence, and restarts without effects", async () => {
  const { current, git } = await localRemoteRepositoryFixture();
  await writePilotEvidence(current);
  const publication = publicationEvidence(current);
  const plan: DeliveryPlan = {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [{ key: "ISS-074", issue: 332, title: "issue", body: "body", attributes: {} }],
    publication: {
      sourceBranch: publication.sourceBranch,
      baseBranch: publication.baseBranch,
      title: publication.title,
      body: publication.body,
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: {
      worktrees: [current.worktree, current.reviewWorktree],
      branch: publication.sourceBranch,
    },
  };
  const mergeEvidence = {
    number: publication.number,
    head: current.candidateHead,
    mergeCommit: "b".repeat(40),
  };
  const effects: string[][] = [];
  let providerReads = 0;
  let gateRuns = 0;
  let draftObservations = 0;
  let planCalls = 0;
  let merged = false;
  let ready = false;
  const adapter = githubDeliveryAdapter({
    async gh(_config, args) {
      effects.push(args);
      if (args[1] === "checks")
        return JSON.stringify(
          current.requiredChecks.map((name) => ({
            name,
            bucket: "pass",
            link: `https://example.test/check/${encodeURIComponent(name)}`,
          })),
        );
      if (args[1] === "ready") ready = true;
      if (args[1] === "merge") merged = true;
      return "";
    },
    async ghJson(_config, args) {
      providerReads += 1;
      const row = publicationRow(publication, {
        state: merged ? "MERGED" : "OPEN",
        isDraft: !ready,
        mergeCommit: merged ? { oid: "b".repeat(40) } : null,
      });
      return args[1] === "list" ? [row] : row;
    },
  });
  adapter.runGate = async () => {
    gateRuns += 1;
    return "passed";
  };
  adapter.observeDraft = async (_config, draft) => {
    draftObservations += 1;
    return { state: "confirmed", value: { issue: draft.issue } };
  };
  const policy = {
    async plan() {
      planCalls += 1;
      return plan;
    },
  };

  await expect(adapter.observeCleanup(current, plan.cleanup, mergeEvidence)).resolves.toEqual({
    state: "needs-mutation",
  });
  await expect(deliveryStep(current, adapter, policy)).resolves.toMatchObject({
    status: "complete",
    cleanup: { status: "confirmed", branch: plan.cleanup.branch },
  });
  await expect(adapter.observeCleanup(current, plan.cleanup, mergeEvidence)).resolves.toEqual({
    state: "confirmed",
    value: plan.cleanup,
  });

  await expect(readFile(resolve(current.worktree, "stable.txt"), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(
    readFile(resolve(current.reviewWorktree, "stable.txt"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const registered = await git(["worktree", "list", "--porcelain"]);
  const comparablePath = (value: string) => {
    const path = resolve(value);
    return process.platform === "win32" ? path.toLowerCase() : path;
  };
  const registeredPaths = registered
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => comparablePath(line.slice(9)));
  expect(registeredPaths).not.toContain(comparablePath(current.worktree));
  expect(registeredPaths).not.toContain(comparablePath(current.reviewWorktree));
  expect(
    await git(["for-each-ref", "--format=%(objectname)", `refs/heads/${plan.cleanup.branch}`]),
  ).toBe("");
  expect(await git(["ls-remote", "--heads", "origin", `refs/heads/${plan.cleanup.branch}`])).toBe(
    "",
  );
  expect(await git(["rev-parse", "refs/heads/protected/fixture"])).toBe(current.candidateHead);
  expect(await git(["ls-remote", "--heads", "origin", "refs/heads/protected/fixture"])).toBe(
    `${current.candidateHead}\trefs/heads/protected/fixture`,
  );

  const tree = await git(["rev-parse", `${current.candidateHead}^{tree}`]);
  const wrongHead = await git([
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit-tree",
    tree,
    "-p",
    current.candidateHead,
    "-m",
    "wrong cleanup head",
  ]);
  await git(["branch", plan.cleanup.branch, wrongHead]);
  await expect(adapter.observeCleanup(current, plan.cleanup, mergeEvidence)).resolves.toEqual({
    state: "unknown",
  });
  await git(["branch", "-D", plan.cleanup.branch]);

  const descendant = `${plan.cleanup.branch}/descendant`;
  await git(["branch", descendant, current.candidateHead]);
  await expect(adapter.observeCleanup(current, plan.cleanup, mergeEvidence)).resolves.toEqual({
    state: "unknown",
  });
  await git(["branch", "-D", descendant]);
  await expect(
    adapter.observeCleanup(current, { ...plan.cleanup, branch: "malformed branch" }, mergeEvidence),
  ).resolves.toEqual({ state: "unknown" });

  const malformedBranch = "malformed-cleanup-ref";
  const malformedRefPath = resolve(
    current.controllerRoot,
    await git(["rev-parse", "--git-path", `refs/heads/${malformedBranch}`]),
  );
  await mkdir(dirname(malformedRefPath), { recursive: true });
  await writeFile(malformedRefPath, "not-an-object\n");
  await expect(
    adapter.observeCleanup(current, { ...plan.cleanup, branch: malformedBranch }, mergeEvidence),
  ).resolves.toEqual({ state: "unknown" });
  await rm(malformedRefPath);
  await expect(adapter.observeCleanup(current, plan.cleanup, mergeEvidence)).resolves.toEqual({
    state: "confirmed",
    value: plan.cleanup,
  });

  const receipts = await stateSnapshot(current.stateDirectory);
  const effectCount = effects.length;
  const providerReadCount = providerReads;
  const gateRunCount = gateRuns;
  const draftObservationCount = draftObservations;
  const planCallCount = planCalls;
  await expect(deliveryStep(current, adapter, policy)).resolves.toMatchObject({
    status: "complete",
    cleanup: { status: "confirmed", branch: plan.cleanup.branch },
  });
  expect(await stateSnapshot(current.stateDirectory)).toEqual(receipts);
  expect(effects).toHaveLength(effectCount);
  expect(providerReads).toBe(providerReadCount);
  expect(gateRuns).toBe(gateRunCount);
  expect(draftObservations).toBe(draftObservationCount);
  expect(planCalls).toBe(planCallCount);
  expect(
    await git(["for-each-ref", "--format=%(objectname)", `refs/heads/${plan.cleanup.branch}`]),
  ).toBe("");
  expect(await git(["ls-remote", "--heads", "origin", `refs/heads/${plan.cleanup.branch}`])).toBe(
    "",
  );
  // Real Git cleanup and a completed engine restart exceed Vitest's 5s default on Windows CI.
}, 30_000);

it("rejects matching heads from a different Git worktree family", async () => {
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "file");
  const root = await mkdtemp(resolve(tmpdir(), "delivery-family-"));
  roots.push(root);
  const current = await cleanController(root);
  const remote = "https://github.com/todd-skelton/orchestration-platform.git";
  await promisify(execFile)("git", ["remote", "add", "origin", remote], {
    cwd: current.controllerRoot,
    windowsHide: true,
  });
  for (const cwd of [current.worktree, current.reviewWorktree]) {
    await promisify(execFile)("git", ["clone", "--local", current.controllerRoot, cwd], {
      windowsHide: true,
    });
    await promisify(execFile)("git", ["remote", "set-url", "origin", remote], {
      cwd,
      windowsHide: true,
    });
  }
  current.candidateHead = current.controllerRevision;
  await expect(
    githubDeliveryAdapter().verifyWorkspace(current, current.candidateHead),
  ).resolves.toBe(false);
});

it("verifies and cleans repository worktrees while leaving a separate controller untouched", async () => {
  const { current, git } = await localRemoteRepositoryFixture();
  const repositoryRoot = current.repositoryRoot;
  const externalController = resolve(repositoryRoot, "..", "external-controller");
  await mkdir(externalController);
  const controllerGit = async (args: string[]) =>
    (
      await promisify(execFile)("git", args, {
        cwd: externalController,
        windowsHide: true,
      })
    ).stdout.trim();
  await controllerGit(["init", "-b", "main", "--quiet"]);
  await writeFile(resolve(externalController, "controller.txt"), "platform controller\n");
  await controllerGit(["add", "."]);
  await controllerGit([
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "controller",
  ]);
  const controllerRevision = await controllerGit(["rev-parse", "HEAD"]);
  current.controllerRoot = externalController;
  current.controllerRevision = controllerRevision;
  const controllerWorktrees = await controllerGit(["worktree", "list", "--porcelain"]);

  const adapter = githubDeliveryAdapter();
  await expect(assertControllerExecutor(current, externalController)).resolves.toBeUndefined();
  await expect(adapter.verifyWorkspace(current, current.candidateHead)).resolves.toBe(true);
  await adapter.cleanup(
    current,
    {
      worktrees: [current.worktree, current.reviewWorktree],
      branch: "codex/iss-074-delivery",
    },
    { number: 44, head: current.candidateHead, mergeCommit: "b".repeat(40) },
  );

  expect(await controllerGit(["worktree", "list", "--porcelain"])).toBe(controllerWorktrees);
  expect(await controllerGit(["rev-parse", "HEAD"])).toBe(controllerRevision);
  expect(await controllerGit(["status", "--porcelain"])).toBe("");
  expect(await git(["worktree", "list", "--porcelain"], repositoryRoot)).not.toContain(
    current.worktree,
  );
}, 30_000);

it("keeps repository identities and mirror rules in the explicit private policy adapter", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const current = config(root);
  const issue = `---\nkey: ISS-074\ntitle: "Deliver"\nlabels: ["type:slice"]\nmilestone: "Minimum orchestration kernel"\nblocked_by: [ISS-073]\n---\n\n## Why\n\nFixture.\n`;
  const planning = {
    roadmap: {
      repository: current.repository,
      milestones: [{ key: "M2", title: "Minimum orchestration kernel" }],
      issues: [
        {
          key: "ISS-074",
          file: "planning/drafts/ISS-074.md",
          milestone: "M2",
          blockedBy: ["ISS-073"],
        },
      ],
    },
    issueDrafts: { "ISS-074": issue },
  };
  const board = {
    issues: [
      {
        number: 2,
        title: "closed history",
        body: "<!-- planning-key: ISS-001 -->\nold",
        state: "CLOSED",
      },
      { number: 332, title: "reserved seed", body: "reserved" },
    ],
  };
  const plan = selfPlanFromSnapshots(current, planning, board, {
    total: { added: 7, deleted: 6 },
    scripts: { added: 1, deleted: 3 },
    test: { added: 4, deleted: 2 },
  });
  expect(plan.gates).toEqual({
    beforeMirror: ["typecheck", "format:check", "test"],
    afterMirror: ["planning:board-check"],
  });
  expect(plan.drafts.map(({ key, issue: number }) => ({ key, number }))).toEqual([
    { key: "ISS-074", number: 332 },
  ]);
  expect(plan.drafts.map((draft) => draft.attributes.milestone)).toEqual([
    "Minimum orchestration kernel",
  ]);
  expect(plan.drafts[0]!.body.startsWith("<!-- planning-key: ISS-074 -->\n")).toBe(true);
  expect(plan.publication.body).toBe(
    "Closes #332\n\n" +
      "Line changes:\n" +
      "- Total: 7 added, 6 deleted, net +1\n" +
      "- Source (`scripts/`): 1 added, 3 deleted, net -2\n" +
      "- Tests (`test/`): 4 added, 2 deleted, net +2",
  );
  expect(plan.publication.body).not.toMatch(/quality packet|profile|pairs/i);
  expect(plan.mergePolicy).toEqual({ method: "squash" });
  expect(plan.cleanup).toEqual({
    worktrees: [current.worktree, current.reviewWorktree],
    branch: "codex/iss-074-delivery",
  });
  const portable = await readFile(
    resolve(import.meta.dirname, "../../scripts/dogfood/delivery.ts"),
    "utf8",
  );
  expect(portable).not.toMatch(
    /todd-skelton|ISS-074|EPIC-KERNEL|planning:board-check|squash|milestone|\bgh\b/,
  );
  const privatePolicy = await readFile(
    resolve(import.meta.dirname, "../../adapters/self.mjs"),
    "utf8",
  );
  expect(privatePolicy).not.toMatch(/ISS-074|\b332\b/);
});

it("uses the later-cycle merge base for repaired candidate line counts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-line-counts-"));
  roots.push(root);
  const current = await cleanController(root);
  const git = async (args: string[], cwd = current.controllerRoot) =>
    (await promisify(execFile)("git", args, { cwd, windowsHide: true })).stdout.trim();
  await Promise.all(
    ["scripts", "test", "notes"].map((directory) =>
      mkdir(resolve(current.controllerRoot, directory)),
    ),
  );
  await Promise.all([
    writeFile(resolve(current.controllerRoot, "scripts/old.ts"), "one\ntwo\nthree\n"),
    writeFile(resolve(current.controllerRoot, "test/old.test.ts"), "one\ntwo\n"),
    writeFile(resolve(current.controllerRoot, "notes/old.md"), "one\n"),
  ]);
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "later cycle base",
  ]);
  const selectedBase = await git(["rev-parse", "HEAD"]);
  await git(["update-ref", "refs/remotes/origin/main", selectedBase]);
  await git(["reset", "--hard", current.controllerRevision]);
  await git(["worktree", "add", "-b", "candidate", current.worktree, selectedBase]);
  await git(["worktree", "add", "--detach", current.reviewWorktree, selectedBase]);

  await Promise.all(
    ["scripts/old.ts", "test/old.test.ts", "notes/old.md"].map((path) =>
      rm(resolve(current.worktree, path)),
    ),
  );
  await Promise.all([
    writeFile(resolve(current.worktree, "scripts/new.ts"), "one\n"),
    writeFile(resolve(current.worktree, "test/new.test.ts"), "one\ntwo\nthree\nfour\n"),
    writeFile(resolve(current.worktree, "notes/new.md"), "one\ntwo\n"),
  ]);
  await git(["add", "-A"], current.worktree);
  await git(
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "candidate",
    ],
    current.worktree,
  );
  current.candidateHead = await git(["rev-parse", "HEAD"], current.worktree);

  const locator = process.platform === "win32" ? "where.exe" : "which";
  const exactGit = (
    await promisify(execFile)(locator, ["git"], { windowsHide: true })
  ).stdout.split(/\r?\n/)[0]!;
  await expect(candidateLineChanges(current, exactGit)).resolves.toEqual({
    total: { added: 7, deleted: 6 },
    scripts: { added: 1, deleted: 3 },
    test: { added: 4, deleted: 2 },
  });

  await Promise.all([
    writeFile(resolve(current.worktree, "scripts/repair.ts"), "one\ntwo\n"),
    writeFile(resolve(current.worktree, "test/repair.test.ts"), "one\n"),
  ]);
  await git(["add", "-A"], current.worktree);
  await git(
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "repair and gate correction",
    ],
    current.worktree,
  );
  current.candidateHead = await git(["rev-parse", "HEAD"], current.worktree);
  vi.stubEnv("PATH", root);
  const changes = await candidateLineChanges(current, exactGit);
  expect(changes).toEqual({
    total: { added: 10, deleted: 6 },
    scripts: { added: 3, deleted: 3 },
    test: { added: 5, deleted: 2 },
  });

  const issue = `---\nkey: ISS-074\ntitle: "Deliver"\nlabels: ["type:slice"]\nmilestone: "Minimum orchestration kernel"\nblocked_by: [ISS-073]\n---\n\n## Why\n\nFixture.\n`;
  const plan = selfPlanFromSnapshots(
    current,
    {
      roadmap: {
        repository: current.repository,
        milestones: [{ key: "M2", title: "Minimum orchestration kernel" }],
        issues: [
          {
            key: "ISS-074",
            file: "planning/drafts/ISS-074.md",
            milestone: "M2",
            blockedBy: ["ISS-073"],
          },
        ],
      },
      issueDrafts: { "ISS-074": issue },
    },
    { issues: [{ number: 332, title: "reserved seed", body: "reserved" }] },
    changes,
  );
  expect(plan.publication.body).toContain(
    "- Total: 10 added, 6 deleted, net +4\n" +
      "- Source (`scripts/`): 3 added, 3 deleted, net 0\n" +
      "- Tests (`test/`): 5 added, 2 deleted, net +3",
  );
});

it("fails self policy closed before provider access for the wrong repository or check set", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const wrongRepository = config(root);
  wrongRepository.repository = "other/repository";
  await expect(
    repositoryDeliveryPolicy(await import("../../adapters/self.mjs"), "git").plan(wrongRepository),
  ).rejects.toThrow("wrong-self-repository");
  const wrongChecks = config(root);
  wrongChecks.requiredChecks = ["linux", "windows", "macos"];
  await expect(
    repositoryDeliveryPolicy(await import("../../adapters/self.mjs"), "git").plan(wrongChecks),
  ).rejects.toThrow("wrong-self-hosted-checks");
});

it("reduces an exact primary reviewer report to delivery evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
  roots.push(root);
  const current = config(root);
  await Promise.all(
    [current.controllerRoot, current.worktree, current.reviewWorktree, current.stateDirectory].map(
      (path) => mkdir(path),
    ),
  );
  await writePilotEvidence(current, {
    reviewerTerminal: {
      id: reviewId,
      status: "passed",
      head,
      summary: reviewerReport(current),
    },
  });
  await expect(githubDeliveryAdapter().source(current)).resolves.toEqual({
    head,
    reviewId,
    controller: current.controller,
    run: current.run,
    issue: current.issue,
    repository: current.repository,
    controllerRevision: current.controllerRevision,
    worktree: current.worktree,
    reviewWorktree: current.reviewWorktree,
    stateDirectory: current.stateDirectory,
    requiredChecks: current.requiredChecks,
  });
});

it.each([
  [
    "PASS with a blocking finding",
    "PASS" as const,
    [{ file: "scripts/dogfood/queue.ts", line: 1, severity: "blocking" as const, text: "block" }],
  ],
  [
    "FAIL with only a note",
    "FAIL" as const,
    [{ file: "scripts/dogfood/queue.ts", line: 1, severity: "note" as const, text: "note" }],
  ],
])("rejects a contradictory primary reviewer report: %s", async (_name, verdict, findings) => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-review-verdict-"));
  roots.push(root);
  const current = config(root);
  await Promise.all(
    [current.controllerRoot, current.worktree, current.reviewWorktree, current.stateDirectory].map(
      (path) => mkdir(path),
    ),
  );
  await writePilotEvidence(current, {
    reviewerTerminal: {
      id: reviewId,
      status: "passed",
      head,
      summary: reviewerReport(current, verdict, findings),
    },
  });

  await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
    "unreviewed-delivery-source",
  );
});

it.each([
  ["missing author identity", {}, { id: reviewId, status: "passed", head }],
  ["malformed author identity", { id: "-".repeat(36) }, { id: reviewId, status: "passed", head }],
  ["missing reviewer identity", { id: authorId }, { status: "passed", head }],
  ["malformed reviewer identity", { id: authorId }, { id: "-".repeat(36), status: "passed", head }],
  ["duplicate identities", { id: authorId }, { id: authorId, status: "passed", head }],
  ["wrong review head", { id: authorId }, { id: reviewId, status: "passed", head: "b".repeat(40) }],
] as const)("rejects %s in pilot evidence", async (_case, author, reviewer) => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
  roots.push(root);
  const current = config(root);
  await mkdir(current.stateDirectory);
  await writePilotEvidence(current, {
    author: {
      pid: 101,
      trace: resolve(current.stateDirectory, "author.jsonl"),
      launchedAt: 1,
      ...author,
    },
    reviewerAttempt: {
      id: (reviewer as { id?: string }).id,
      pid: 202,
      trace: resolve(current.stateDirectory, "reviewer.jsonl"),
      launchedAt: 1,
    },
    reviewerTerminal: reviewer,
  });
  await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
    "unreviewed-delivery-source",
  );
});

it.each([{ fingerprint: ["e".repeat(64)] }, { fingerprint: "e".repeat(40) }])(
  "rejects malformed pilot fingerprint %j without provider access",
  async ({ fingerprint }) => {
    const root = await mkdtemp(resolve(tmpdir(), "delivery-fingerprint-"));
    roots.push(root);
    const current = config(root);
    await mkdir(current.stateDirectory);
    await writePilotEvidence(current);
    await writeFile(
      resolve(current.stateDirectory, "config.json"),
      JSON.stringify({ fingerprint, config: pilotConfig(current) }),
    );
    await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
      "unreviewed-delivery-source",
    );
  },
);

it.each(["reviewer-attempt", "run", "repository", "worktree", "controller"] as const)(
  "rejects pilot %s identity drift before provider effects",
  async (mode) => {
    const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
    roots.push(root);
    const current = config(root);
    await mkdir(current.stateDirectory);
    const pinned = pilotConfig(current);
    if (mode === "run") pinned.run = "unrelated-run";
    if (mode === "repository") pinned.repository = "foreign/repository";
    if (mode === "worktree") pinned.worktree = resolve(root, "unrelated-author");
    if (mode === "controller") pinned.owner = "unknown-controller";
    await writePilotEvidence(current, {
      pinnedConfig: pinned,
      ...(mode === "reviewer-attempt"
        ? {
            reviewerAttempt: {
              id: "33333333-3333-3333-3333-333333333333",
              pid: 303,
              trace: resolve(current.stateDirectory, "reviewer.jsonl"),
            },
            reviewerTerminal: { id: reviewId, status: "passed", head },
          }
        : {}),
    });
    await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
      "unreviewed-delivery-source",
    );
  },
);

it("requires the actual controller executor to remain at its clean authorized revision", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-executor-"));
  roots.push(root);
  const current = await cleanController(root);
  await expect(assertControllerExecutor(current, current.controllerRoot)).resolves.toBeUndefined();

  const revision = current.controllerRevision;
  current.controllerRevision = "d".repeat(40);
  await expect(assertControllerExecutor(current, current.controllerRoot)).rejects.toThrow(
    "controller-executor-revision-moved",
  );

  current.controllerRevision = revision;
  await writeFile(resolve(current.controllerRoot, "dirty.txt"), "dirty\n");
  await expect(assertControllerExecutor(current, current.controllerRoot)).rejects.toThrow(
    "dirty-controller-executor",
  );
});

it("imports both concrete delivery adapters directly in Node 24", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-adapter-import-")));
  roots.push(root);
  const output = resolve(root, "result.json");
  await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'Promise.all([import("./scripts/dogfood/delivery-adapter.mjs"),import("./adapters/self.mjs")]).then(async ([a,p])=>(await import("node:fs/promises")).writeFile(process.argv[1],JSON.stringify([typeof a.assertControllerExecutor,typeof a.githubDeliveryAdapter,typeof p.selectCandidates])))',
      output,
    ],
    { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
  );
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(["function", "function", "function"]);
});

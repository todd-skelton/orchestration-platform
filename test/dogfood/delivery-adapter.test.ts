import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertControllerExecutor,
  githubDeliveryAdapter,
} from "../../scripts/dogfood/delivery-adapter.mjs";
import type { DeliveryConfig } from "../../scripts/dogfood/delivery.mjs";
import {
  selfDeliveryPolicy,
  selfPlanFromSnapshots,
} from "../../scripts/dogfood/self-delivery-policy.mjs";

const head = "a".repeat(40);
const authorId = "11111111-1111-1111-1111-111111111111";
const reviewId = "22222222-2222-2222-2222-222222222222";
const roots: string[] = [];

function config(root: string): DeliveryConfig {
  return {
    run: "self-delivery-fixture",
    issue: "https://github.com/todd-skelton/orchestration-platform/issues/332",
    repository: "todd-skelton/orchestration-platform",
    controllerRoot: resolve(root, "controller"),
    controllerRevision: "c".repeat(40),
    worktree: resolve(root, "author"),
    reviewWorktree: resolve(root, "reviewer"),
    stateDirectory: resolve(root, "state"),
    candidateHead: head,
    requiredChecks: [
      "Node 24 / ubuntu-latest",
      "Node 24 / windows-latest",
      "Node 24 / macos-latest",
    ],
    authority: {
      schemaVersion: "dogfood-delivery-authority/v1",
      controller: "external-controller",
      run: "self-delivery-fixture",
      repository: "todd-skelton/orchestration-platform",
      controllerRevision: "c".repeat(40),
      head,
      actions: ["gates", "mirror", "publish", "merge", "cleanup"],
    },
    policy: {
      kind: "orchestration-platform-self/v1",
      planningKey: "ISS-074",
      planningIssue: 332,
      parentEpicKey: "EPIC-KERNEL",
      parentEpicIssue: 2,
      sourceBranch: "codex/iss-074-delivery",
      baseBranch: "main",
      pullRequestTitle: "automate normal delivery",
      pullRequestBody: "reviewed delivery candidate",
    },
  };
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
  current.authority.controllerRevision = current.controllerRevision;
  return current;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repositoryFixture(remote: string) {
  // A regressed guard must still never contact a real provider from a fixture.
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "file");
  const root = await mkdtemp(resolve(tmpdir(), "delivery-repository-"));
  roots.push(root);
  const current = await cleanController(root);
  const git = async (args: string[], cwd = current.controllerRoot) =>
    (await promisify(execFile)("git", args, { cwd, windowsHide: true })).stdout.trim();
  await git(["remote", "add", "origin", remote]);
  await git(["worktree", "add", "-b", "codex/iss-074-delivery", current.worktree, "HEAD"]);
  await git(["worktree", "add", "--detach", current.reviewWorktree, "HEAD"]);
  current.candidateHead = current.controllerRevision;
  current.authority.head = current.candidateHead;
  return { current, git };
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
      adapter.publish(current, {
        sourceBranch: "codex/iss-074-delivery",
        baseBranch: "main",
        title: "fixture",
        body: "fixture",
        draft: true,
      }),
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
  current.authority.head = current.candidateHead;
  await expect(
    githubDeliveryAdapter().verifyWorkspace(current, current.candidateHead),
  ).resolves.toBe(false);
});

it("keeps repository identities and mirror rules in the explicit private policy adapter", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const current = config(root);
  const epic = `---\nkey: EPIC-KERNEL\ntitle: "Kernel"\nchildren: [ISS-074]\n---\n\n## Outcome\n\nKernel.\n`;
  const issue = `---\nkey: ISS-074\ntitle: "Deliver"\nlabels: ["type:slice"]\nmilestone: "Minimum orchestration kernel"\nparent: EPIC-KERNEL\nblocked_by: [ISS-073]\n---\n\n## Scope and non-goals\n\nFixture.\n`;
  const planning = {
    roadmap: {
      repository: current.repository,
      milestones: [{ key: "M2", title: "Minimum orchestration kernel" }],
      epics: [{ key: "EPIC-KERNEL", file: "planning/drafts/EPIC-KERNEL.md" }],
      issues: [
        {
          key: "ISS-074",
          file: "planning/drafts/ISS-074.md",
          milestone: "M2",
          parent: "EPIC-KERNEL",
          blockedBy: ["ISS-073"],
        },
      ],
    },
    epicDrafts: { "EPIC-KERNEL": epic },
    issueDrafts: { "ISS-074": issue },
  };
  const board = {
    issues: [
      {
        number: 2,
        title: "old epic",
        body: "<!-- planning-key: EPIC-KERNEL -->\nold",
      },
      { number: 332, title: "reserved seed", body: "reserved" },
    ],
  };
  const plan = selfPlanFromSnapshots(current, planning, board);
  expect(plan.gates).toEqual({
    beforeMirror: ["typecheck", "format:check", "planning:check"],
    afterMirror: ["planning:board-check"],
  });
  expect(plan.drafts.map(({ key, issue: number }) => ({ key, number }))).toEqual([
    { key: "EPIC-KERNEL", number: 2 },
    { key: "ISS-074", number: 332 },
  ]);
  expect(plan.drafts.map((draft) => draft.attributes.milestone)).toEqual([
    null,
    "Minimum orchestration kernel",
  ]);
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
    resolve(import.meta.dirname, "../../scripts/dogfood/self-delivery-policy.mjs"),
    "utf8",
  );
  expect(privatePolicy).not.toMatch(/ISS-074|\b332\b/);
});

it("fails self policy closed before provider access for the wrong repository or check set", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const wrongRepository = config(root);
  wrongRepository.repository = "other/repository";
  await expect(selfDeliveryPolicy().plan(wrongRepository)).rejects.toThrow("wrong-self-repository");
  const wrongChecks = config(root);
  wrongChecks.requiredChecks = ["linux", "windows", "macos"];
  await expect(selfDeliveryPolicy().plan(wrongChecks)).rejects.toThrow("wrong-self-hosted-checks");
});

it("reduces existing pilot records to exact reviewed source evidence without worker prose", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
  roots.push(root);
  const current = config(root);
  await Promise.all(
    [current.controllerRoot, current.worktree, current.reviewWorktree, current.stateDirectory].map(
      (path) => mkdir(path),
    ),
  );
  await Promise.all([
    writeFile(resolve(current.stateDirectory, "candidate.json"), JSON.stringify({ head })),
    writeFile(
      resolve(current.stateDirectory, "reviewer-terminal.json"),
      JSON.stringify({
        id: reviewId,
        status: "passed",
        head,
        summary: "advisory prose must not cross the delivery boundary",
      }),
    ),
    writeFile(
      resolve(current.stateDirectory, "author-attempt.json"),
      JSON.stringify({ id: authorId }),
    ),
  ]);
  await expect(githubDeliveryAdapter().source(current)).resolves.toEqual({
    head,
    reviewId,
  });
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
  await Promise.all([
    writeFile(resolve(current.stateDirectory, "candidate.json"), JSON.stringify({ head })),
    writeFile(resolve(current.stateDirectory, "reviewer-terminal.json"), JSON.stringify(reviewer)),
    writeFile(resolve(current.stateDirectory, "author-attempt.json"), JSON.stringify(author)),
  ]);
  await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
    "unreviewed-delivery-source",
  );
});

it("rejects entrypoint execution from another checkout despite a clean matching declared controller", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-executor-"));
  roots.push(root);
  const current = await cleanController(root);
  const request = resolve(current.stateDirectory, "delivery-request.json");
  await writeFile(request, JSON.stringify(current));

  let stderr = "";
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve(import.meta.dirname, "../../scripts/dogfood/deliver.mjs"), request],
      { windowsHide: true },
    );
  } catch (error) {
    stderr = (error as { stderr?: string }).stderr ?? "";
  }
  expect(JSON.parse(stderr)).toEqual({
    status: "blocked",
    reason: "controller-executor-mismatch",
  });
});

it("requires the actual controller executor to remain at its clean authorized revision", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-executor-"));
  roots.push(root);
  const current = await cleanController(root);
  await expect(assertControllerExecutor(current, current.controllerRoot)).resolves.toBeUndefined();

  const revision = current.controllerRevision;
  current.controllerRevision = "d".repeat(40);
  current.authority.controllerRevision = current.controllerRevision;
  await expect(assertControllerExecutor(current, current.controllerRoot)).rejects.toThrow(
    "controller-executor-revision-moved",
  );

  current.controllerRevision = revision;
  current.authority.controllerRevision = revision;
  await writeFile(resolve(current.controllerRoot, "dirty.txt"), "dirty\n");
  await expect(assertControllerExecutor(current, current.controllerRoot)).rejects.toThrow(
    "dirty-controller-executor",
  );
});

it("imports both concrete delivery adapters directly in Node 24", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'Promise.all([import("./scripts/dogfood/delivery-adapter.mjs"),import("./scripts/dogfood/self-delivery-policy.mjs")]).then(([a,p])=>process.stdout.write(JSON.stringify([typeof a.assertControllerExecutor,typeof a.githubDeliveryAdapter,typeof p.selfDeliveryPolicy])))',
    ],
    { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
  );
  expect(JSON.parse(stdout)).toEqual(["function", "function", "function"]);
});

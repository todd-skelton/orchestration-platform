import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expectedBoardItems } from "../../../scripts/planning/board-check.mjs";
import { loadPlanningSnapshot } from "../../../scripts/planning/check.mjs";
import { loadRepositoryAdapter } from "../../../scripts/dogfood/repository-adapter.js";
import {
  repositorySupervisionAdapter,
  type SupervisionAdapter,
} from "../../../scripts/dogfood/supervision.js";
import { SELF_ROUTING } from "../../../scripts/dogfood/routing.mjs";
import type { LoopConfig } from "../../../scripts/dogfood/queue.js";

// Synthetic authority in real local Git; no hosted board or running loop is used.
export async function planningSelectionFixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "planning-selection-")));
  const remote = resolve(root, "remote");
  const executor = resolve(root, "executor");
  const execute = promisify(execFile);
  const gitExecutable = (
    await execute(process.platform === "win32" ? "where.exe" : "which", ["git"])
  ).stdout
    .trim()
    .split(/\r?\n/)[0]!;
  const git = async (cwd: string, args: string[]) =>
    (await execute(gitExecutable, ["-C", cwd, ...args])).stdout.trim();
  await mkdir(remote);
  await git(remote, ["init", "-b", "main"]);
  await git(remote, ["config", "user.name", "Synthetic Fixture"]);
  await git(remote, ["config", "user.email", "fixture@example.test"]);
  await mkdir(resolve(remote, "planning/drafts"), { recursive: true });
  await mkdir(resolve(remote, "docs"));
  await mkdir(resolve(remote, "adapters"));
  await writeFile(
    resolve(remote, "adapters/self.mjs"),
    'throw new Error("fetched code must never execute");\n',
  );
  await writeFile(resolve(remote, ".gitignore"), "node_modules/\n");
  const roadmap = {
    schemaVersion: "orchestration-roadmap/v1",
    repository: "todd-skelton/orchestration-platform",
    project: {
      id: "synthetic-project",
      number: 1,
      title: "Synthetic",
      url: "https://example.test/project",
    },
    milestones: [
      { key: "M1", title: "First" },
      { key: "M2", title: "Second" },
    ],
    issues: [] as { key: string; file: string; milestone: string; blockedBy: string[] }[],
  };
  const add = async (key: string, milestone = "M1", blockedBy: string[] = []) => {
    roadmap.issues.push({ key, file: `planning/drafts/${key}.md`, milestone, blockedBy });
    await writeFile(
      resolve(remote, `planning/drafts/${key}.md`),
      `---\nkey: ${key}\ntitle: "Synthetic ${key}"\nlabels: ["type:slice"]\nmilestone: "${milestone === "M1" ? "First" : "Second"}"\nblocked_by: [${blockedBy.join(", ")}]\n---\n\n## Done when\n\n1. Execute ${key}\n   Keep the pinned brief.\n\n## Out of scope\n\nNothing else.\n`,
    );
    await writeFile(resolve(remote, "planning/roadmap.json"), JSON.stringify(roadmap));
  };
  const commit = async (rules: string) => {
    await writeFile(resolve(remote, "docs/loop.md"), `${rules}\n`);
    await git(remote, ["add", "."]);
    await git(remote, ["commit", "-m", rules]);
    return git(remote, ["rev-parse", "HEAD"]);
  };
  await add("ISS-001");
  const old = await commit("Synthetic installed rules");
  await git(root, ["clone", remote, executor]);
  await add("ISS-002");
  await add("ISS-003", "M1", ["ISS-002"]);
  await add("ISS-004", "M2");
  // Change an existing brief as well, for the legacy fingerprint regression.
  const oldDraft = resolve(remote, "planning/drafts/ISS-001.md");
  await writeFile(
    oldDraft,
    (await readFile(oldDraft, "utf8")).replace("Execute ISS-001", "New criterion ISS-001"),
  );
  const current = await commit("Synthetic current rules describe uninstalled behavior");
  const loop: LoopConfig = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-planning",
    adapter: "self",
    repository: roadmap.repository,
    stableExecutorRoot: executor,
    stateRoot: resolve(root, "state"),
    worktreeRoot: resolve(root, "worktrees"),
    codexExecutable: process.execPath,
    gitExecutable,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
    author: SELF_ROUTING.author[0]!,
    reviewer: SELF_ROUTING.reviewer[0]!,
    routingRows: [SELF_ROUTING],
  };
  const policy = await loadRepositoryAdapter("self", resolve(import.meta.dirname, "../../.."));
  const board = async () => {
    const planning = await loadPlanningSnapshot(remote);
    const issues = expectedBoardItems(planning).map((item, index) => ({
      number: index + 1,
      title: item.title,
      body: item.body,
      milestone: item.milestone,
      state: item.key === "ISS-001" ? ("CLOSED" as const) : ("OPEN" as const),
      labels: ["ready"],
    }));
    return { repository: roadmap.repository, totalCount: issues.length, issues };
  };
  const forbidden = async () => {
    throw new Error("selection must not mutate issue authority");
  };
  const host: SupervisionAdapter = {
    ...repositorySupervisionAdapter(),
    issue: forbidden,
    removeReady: forbidden,
    close: forbidden,
    comment: forbidden,
  };
  const installed = async () => ({
    head: await git(executor, ["rev-parse", "HEAD"]),
    branch: await git(executor, ["branch", "--show-current"]),
    status: await git(executor, ["status", "--porcelain"]),
    index: await readFile(resolve(executor, ".git/index")),
    files: await retainedFiles(executor, true),
    worktrees: await git(executor, ["worktree", "list", "--porcelain"]),
  });
  return {
    root,
    remote,
    executor,
    git,
    loop,
    old,
    current,
    policy,
    host,
    board,
    add,
    commit,
    installed,
  };
}

export async function retainedFiles(root: string, skipGit = false) {
  const result = new Map<string, { ino: number; hash: string }>();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skipGit && entry.name === ".git") continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        result.set(path, {
          ino: (await stat(path)).ino,
          hash: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        });
    }
  };
  await walk(root);
  return result;
}

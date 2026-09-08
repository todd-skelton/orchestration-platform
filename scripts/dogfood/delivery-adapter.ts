import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { normalizeBody } from "../planning/board-check.mjs";
import { resolvePnpmLauncher } from "../pnpm-launcher.mjs";
import {
  DeliveryBlocked,
  type CleanupPlan,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DraftPlan,
  type MergeEvidence,
  type PublicationEvidence,
  type PublicationPlan,
} from "./delivery.mjs";

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const ATTEMPT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

async function run(executable: string, args: string[], cwd: string) {
  return exec(executable, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function git(config: DeliveryConfig, args: string[], cwd = config.controllerRoot) {
  return (await run("git", args, cwd)).stdout.trim();
}

async function gh(config: DeliveryConfig, args: string[]) {
  return (
    await run("gh", [...args, "--repo", `github.com/${config.repository}`], config.controllerRoot)
  ).stdout.trim();
}

async function ghJson(config: DeliveryConfig, args: string[]) {
  return JSON.parse(await gh(config, args));
}

async function json(path: string, reason: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new DeliveryBlocked(reason);
  }
}

async function stagedFile(config: DeliveryConfig, name: string, contents: string) {
  const path = resolve(config.stateDirectory, name);
  try {
    await writeFile(path, contents, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== contents)
      throw new DeliveryBlocked("conflicting-staged-mutation");
  }
  return path;
}

function publication(row: any): PublicationEvidence | undefined {
  return Number.isSafeInteger(row?.number) &&
    row.number > 0 &&
    typeof row.url === "string" &&
    row.url.startsWith("https://") &&
    SHA.test(row.headRefOid)
    ? { number: row.number, url: row.url, head: row.headRefOid }
    : undefined;
}

function samePath(left: string, right: string) {
  const normalize = (value: string) =>
    process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

function matchesRepository(remote: string, repository: string) {
  if (remote !== remote.trim()) return false;
  let path: string;
  const scp = remote.match(/^git@github\.com:([^\s?#]+)$/i);
  if (scp) path = scp[1]!;
  else {
    try {
      const url = new URL(remote);
      if (
        url.hostname.toLowerCase() !== "github.com" ||
        url.port !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        url.password !== "" ||
        !(
          (url.protocol === "https:" && url.username === "") ||
          (url.protocol === "ssh:" && url.username === "git")
        )
      )
        return false;
      path = url.pathname.slice(1);
    } catch {
      return false;
    }
  }
  path = path.replace(/\/$/, "").toLowerCase();
  return path === repository.toLowerCase() || path === `${repository.toLowerCase()}.git`;
}

async function assertGitTarget(config: DeliveryConfig, cwd: string) {
  try {
    for (const kind of [[], ["--push"]]) {
      const { stdout } = await run("git", ["remote", "get-url", ...kind, "--all", "origin"], cwd);
      const urls = stdout.replace(/\r?\n$/, "").split(/\r?\n/);
      if (urls.length !== 1 || !matchesRepository(urls[0]!, config.repository))
        throw new DeliveryBlocked("delivery-repository-mismatch");
    }
  } catch (error) {
    if (error instanceof DeliveryBlocked) throw error;
    throw new DeliveryBlocked("delivery-repository-unverified");
  }
}

async function assertWorktreeRepository(config: DeliveryConfig) {
  const common = await realpath(
    resolve(config.controllerRoot, await git(config, ["rev-parse", "--git-common-dir"])),
  );
  for (const cwd of [config.controllerRoot, config.worktree, config.reviewWorktree]) {
    const selected = await realpath(
      resolve(cwd, await git(config, ["rev-parse", "--git-common-dir"], cwd)),
    );
    if (!samePath(common, selected)) throw new DeliveryBlocked("delivery-worktree-family-mismatch");
    await assertGitTarget(config, cwd);
  }
}

async function worktrees(config: DeliveryConfig) {
  const output = await git(config, ["worktree", "list", "--porcelain"]);
  return output
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
      const branch = lines.find((line) => line.startsWith("branch "))?.slice(7);
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice(5);
      return { path, branch, head };
    });
}

async function branchHead(config: DeliveryConfig, branch: string) {
  try {
    return await git(config, ["show-ref", "--verify", "--hash", `refs/heads/${branch}`]);
  } catch (error) {
    if ((error as { code?: number }).code === 1) return undefined;
    throw error;
  }
}

async function remoteBranchHead(config: DeliveryConfig, branch: string) {
  await assertGitTarget(config, config.controllerRoot);
  const output = await git(config, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  if (output === "") return undefined;
  const rows = output.split(/\r?\n/);
  if (rows.length !== 1) throw new DeliveryBlocked("ambiguous-remote-cleanup-branch");
  const match = rows[0]!.match(/^([a-f0-9]{40})\s+refs\/heads\/(.+)$/);
  if (!match || match[2] !== branch) throw new DeliveryBlocked("malformed-remote-cleanup-branch");
  return match[1];
}

export async function assertControllerExecutor(config: DeliveryConfig, executingRoot: string) {
  try {
    const [actualRoot, configuredRoot] = await Promise.all([
      realpath(executingRoot),
      realpath(config.controllerRoot),
    ]);
    if (!samePath(actualRoot, configuredRoot))
      throw new DeliveryBlocked("controller-executor-mismatch");
    const repositoryRoot = await realpath(
      await git(config, ["rev-parse", "--show-toplevel"], actualRoot),
    );
    if (!samePath(repositoryRoot, actualRoot))
      throw new DeliveryBlocked("controller-executor-not-repository-root");
    if ((await git(config, ["rev-parse", "HEAD"], actualRoot)) !== config.controllerRevision)
      throw new DeliveryBlocked("controller-executor-revision-moved");
    if ((await git(config, ["status", "--porcelain"], actualRoot)) !== "")
      throw new DeliveryBlocked("dirty-controller-executor");
  } catch (error) {
    if (error instanceof DeliveryBlocked) throw error;
    throw new DeliveryBlocked("controller-executor-unverified");
  }
}

export function githubDeliveryAdapter(): DeliveryAdapter {
  const verifyWorkspace = async (config: DeliveryConfig, head: string) => {
    try {
      await assertWorktreeRepository(config);
      if (
        (await git(config, ["rev-parse", "HEAD"], config.controllerRoot)) !==
        config.controllerRevision
      )
        return false;
      if ((await git(config, ["status", "--porcelain"], config.controllerRoot)) !== "")
        return false;
      for (const cwd of [config.worktree, config.reviewWorktree]) {
        if ((await git(config, ["rev-parse", "HEAD"], cwd)) !== head) return false;
        if ((await git(config, ["status", "--porcelain"], cwd)) !== "") return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  return {
    async source(config) {
      const candidate = await json(
        resolve(config.stateDirectory, "candidate.json"),
        "missing-candidate-record",
      );
      const reviewer = await json(
        resolve(config.stateDirectory, "reviewer-terminal.json"),
        "missing-review-record",
      );
      const author = await json(
        resolve(config.stateDirectory, "author-attempt.json"),
        "missing-author-record",
      );
      if (
        candidate?.head !== config.candidateHead ||
        reviewer?.status !== "passed" ||
        reviewer?.head !== config.candidateHead ||
        typeof author?.id !== "string" ||
        !ATTEMPT_ID.test(author.id) ||
        typeof reviewer?.id !== "string" ||
        !ATTEMPT_ID.test(reviewer.id) ||
        author.id === reviewer.id
      )
        throw new DeliveryBlocked("unreviewed-delivery-source");
      return { head: candidate.head, reviewId: reviewer.id };
    },
    verifyWorkspace,
    async runGate(config, name, head) {
      if (!(await verifyWorkspace(config, head))) return "failed";
      try {
        const launcher = await resolvePnpmLauncher();
        await run(launcher.executable, [...launcher.prefixArgs, "run", name], config.worktree);
        return (await verifyWorkspace(config, head)) ? "passed" : "failed";
      } catch {
        return "failed";
      }
    },
    async observeDraft(config, draft) {
      try {
        const row = await ghJson(config, [
          "issue",
          "view",
          String(draft.issue),
          "--json",
          "number,title,body,milestone",
        ]);
        if (row?.number !== draft.issue) return { state: "unknown" };
        return row.title === draft.title &&
          normalizeBody(row.body) === normalizeBody(draft.body) &&
          (row.milestone?.title ?? null) === draft.attributes.milestone
          ? { state: "confirmed", value: { issue: draft.issue } }
          : { state: "needs-mutation" };
      } catch {
        return { state: "unknown" };
      }
    },
    async applyDraft(config, draft) {
      if (!(await verifyWorkspace(config, config.candidateHead)))
        throw new DeliveryBlocked("candidate-workspace-drift");
      const path = await stagedFile(config, `approved-${draft.key}.md`, draft.body);
      const milestone = draft.attributes.milestone;
      if (typeof milestone !== "string" && milestone !== null)
        throw new DeliveryBlocked("malformed-draft-policy");
      await gh(config, [
        "issue",
        "edit",
        String(draft.issue),
        "--title",
        draft.title,
        "--body-file",
        path,
        ...(milestone === null ? ["--remove-milestone"] : ["--milestone", milestone]),
      ]);
    },
    async observePublication(config, plan) {
      try {
        const rows = await ghJson(config, [
          "pr",
          "list",
          "--head",
          plan.sourceBranch,
          "--base",
          plan.baseBranch,
          "--state",
          "all",
          "--json",
          "number,url,headRefOid,state,isDraft,title,body",
        ]);
        if (!Array.isArray(rows) || rows.length > 1) return { state: "unknown" };
        if (rows.length === 0) return { state: "needs-mutation" };
        const value = publication(rows[0]);
        if (!value || rows[0]?.state !== "OPEN" || rows[0]?.isDraft !== true)
          return { state: "unknown" };
        return value.head === config.candidateHead &&
          rows[0]?.title === plan.title &&
          normalizeBody(rows[0]?.body) === normalizeBody(plan.body)
          ? { state: "confirmed", value }
          : { state: "needs-mutation" };
      } catch {
        return { state: "unknown" };
      }
    },
    async publish(config, plan) {
      if (!(await verifyWorkspace(config, config.candidateHead)))
        throw new DeliveryBlocked("candidate-workspace-drift");
      const branch = await git(config, ["branch", "--show-current"], config.worktree);
      if (branch !== plan.sourceBranch) throw new DeliveryBlocked("publication-branch-mismatch");
      const body = await stagedFile(config, "approved-pull-request.md", plan.body);
      await run(
        "git",
        [
          "push",
          "--no-follow-tags",
          "origin",
          `${config.candidateHead}:refs/heads/${plan.sourceBranch}`,
        ],
        config.worktree,
      );
      const rows = await ghJson(config, [
        "pr",
        "list",
        "--head",
        plan.sourceBranch,
        "--base",
        plan.baseBranch,
        "--state",
        "open",
        "--json",
        "number",
      ]);
      if (!Array.isArray(rows) || rows.length > 1)
        throw new DeliveryBlocked("ambiguous-publication");
      if (rows.length === 1) {
        await gh(config, [
          "pr",
          "edit",
          String(rows[0].number),
          "--title",
          plan.title,
          "--body-file",
          body,
        ]);
      } else {
        await gh(config, [
          "pr",
          "create",
          "--head",
          plan.sourceBranch,
          "--base",
          plan.baseBranch,
          "--title",
          plan.title,
          "--body-file",
          body,
          "--draft",
        ]);
      }
    },
    async checks(config, current) {
      const readHead = async () => {
        const row = await ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "headRefOid",
        ]);
        return row?.headRefOid;
      };
      try {
        const before = await readHead();
        let stdout: string;
        try {
          stdout = await gh(config, [
            "pr",
            "checks",
            String(current.number),
            "--json",
            "name,bucket,link",
          ]);
        } catch (error) {
          const result = error as { code?: number; stdout?: string };
          if (![1, 8].includes(result.code ?? -1) || typeof result.stdout !== "string") throw error;
          stdout = result.stdout;
        }
        const after = await readHead();
        if (!SHA.test(before) || before !== after) throw new Error("head moved");
        return { head: before, checks: JSON.parse(stdout) };
      } catch {
        throw new DeliveryBlocked("hosted-observation-unavailable");
      }
    },
    async observeMerge(config, current) {
      try {
        const row = await ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "number,headRefOid,state,mergeCommit",
        ]);
        if (row?.number !== current.number || row?.headRefOid !== config.candidateHead)
          return { state: "unknown" };
        if (row.state === "OPEN") return { state: "needs-mutation" };
        if (row.state !== "MERGED" || !SHA.test(row.mergeCommit?.oid)) return { state: "unknown" };
        return {
          state: "confirmed",
          value: {
            number: current.number,
            head: config.candidateHead,
            mergeCommit: row.mergeCommit.oid,
          },
        };
      } catch {
        return { state: "unknown" };
      }
    },
    async merge(config, current, policy) {
      if (!(await verifyWorkspace(config, config.candidateHead)))
        throw new DeliveryBlocked("candidate-workspace-drift");
      if (
        !policy ||
        typeof policy !== "object" ||
        Array.isArray(policy) ||
        Object.keys(policy).length !== 1 ||
        !Object.hasOwn(policy, "method") ||
        (policy as { method?: unknown }).method !== "squash"
      )
        throw new DeliveryBlocked("unsupported-self-merge-policy");
      const row = await ghJson(config, [
        "pr",
        "view",
        String(current.number),
        "--json",
        "headRefOid,isDraft,state",
      ]);
      if (row?.headRefOid !== config.candidateHead || row?.state !== "OPEN")
        throw new DeliveryBlocked("merge-head-drift");
      if (row.isDraft) await gh(config, ["pr", "ready", String(current.number)]);
      await gh(config, [
        "pr",
        "merge",
        String(current.number),
        "--squash",
        "--match-head-commit",
        config.candidateHead,
      ]);
    },
    async observeCleanup(config, plan) {
      try {
        await assertGitTarget(config, config.controllerRoot);
        const rows = await worktrees(config);
        if ((await git(config, ["status", "--porcelain"], config.controllerRoot)) !== "")
          return { state: "unknown" };
        if (
          rows.filter(
            (row) =>
              row.path &&
              samePath(row.path, config.controllerRoot) &&
              row.head === config.controllerRevision,
          ).length !== 1
        )
          return { state: "unknown" };
        const present = plan.worktrees.filter(
          (path) => rows.filter((row) => row.path && samePath(row.path, path)).length === 1,
        );
        const branch = await branchHead(config, plan.branch);
        const remoteBranch = await remoteBranchHead(config, plan.branch);
        if (present.length === 0 && branch === undefined && remoteBranch === undefined) {
          return {
            state: "confirmed",
            value: { worktrees: [...plan.worktrees], branch: plan.branch },
          };
        }
        return present.length === plan.worktrees.length &&
          branch === config.candidateHead &&
          [undefined, config.candidateHead].includes(remoteBranch)
          ? { state: "needs-mutation" }
          : { state: "unknown" };
      } catch {
        return { state: "unknown" };
      }
    },
    async cleanup(config, plan) {
      await assertGitTarget(config, config.controllerRoot);
      const rows = await worktrees(config);
      if (
        (await git(config, ["status", "--porcelain"], config.controllerRoot)) !== "" ||
        plan.worktrees.some(
          (path) => rows.filter((row) => row.path && samePath(row.path, path)).length !== 1,
        ) ||
        plan.worktrees.some((path) => samePath(path, config.controllerRoot)) ||
        !rows.some(
          (row) =>
            row.path &&
            samePath(row.path, config.controllerRoot) &&
            row.head === config.controllerRevision,
        ) ||
        (await branchHead(config, plan.branch)) !== config.candidateHead ||
        ![undefined, config.candidateHead].includes(await remoteBranchHead(config, plan.branch))
      )
        throw new DeliveryBlocked("cleanup-target-drift");
      for (const path of plan.worktrees) {
        if ((await git(config, ["status", "--porcelain"], path)) !== "")
          throw new DeliveryBlocked("cleanup-dirty-worktree");
        if ((await git(config, ["rev-parse", "HEAD"], path)) !== config.candidateHead)
          throw new DeliveryBlocked("cleanup-head-drift");
      }
      if ((await remoteBranchHead(config, plan.branch)) === config.candidateHead)
        await run(
          "git",
          [
            "push",
            "--no-follow-tags",
            `--force-with-lease=refs/heads/${plan.branch}:${config.candidateHead}`,
            "--delete",
            "origin",
            plan.branch,
          ],
          config.controllerRoot,
        );
      for (const path of plan.worktrees)
        await run("git", ["worktree", "remove", resolve(path)], config.controllerRoot);
      await run("git", ["branch", "-D", plan.branch], config.controllerRoot);
    },
  };
}

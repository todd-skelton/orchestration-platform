import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
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
const DIGEST = /^[a-f0-9]{64}$/;
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

export interface GithubDeliveryCommands {
  gh(config: DeliveryConfig, args: string[]): Promise<string>;
  ghJson(config: DeliveryConfig, args: string[]): Promise<any>;
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

function exactStringSet(value: unknown, expected: string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length &&
    value.every((item) => expected.includes(item)) &&
    expected.every((item) => value.includes(item))
  );
}

function validAttempt(value: any, config: DeliveryConfig, role: "author" | "reviewer") {
  return (
    value &&
    Object.keys(value).length === 3 &&
    ["id", "pid", "trace"].every((key) => Object.hasOwn(value, key)) &&
    typeof value.id === "string" &&
    ATTEMPT_ID.test(value.id) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.trace === "string" &&
    isAbsolute(value.trace) &&
    samePath(value.trace, resolve(config.stateDirectory, `${role}.jsonl`))
  );
}

function publicationUrl(config: DeliveryConfig, number: number) {
  return `https://github.com/${config.repository}/pull/${number}`;
}

function publication(
  row: any,
  config: DeliveryConfig,
  plan: PublicationPlan,
  planDigest: string,
): PublicationEvidence | undefined {
  return matchesPublicationTarget(row, config, plan) &&
    row.title === plan.title &&
    normalizeBody(row.body) === normalizeBody(plan.body) &&
    DIGEST.test(planDigest)
    ? {
        number: row.number,
        url: row.url,
        head: row.headRefOid,
        repository: config.repository,
        sourceBranch: plan.sourceBranch,
        baseBranch: plan.baseBranch,
        title: plan.title,
        body: plan.body,
        planDigest,
      }
    : undefined;
}

function matchesPublicationTarget(row: any, config: DeliveryConfig, plan: PublicationPlan) {
  return (
    Number.isSafeInteger(row?.number) &&
    row.number > 0 &&
    row.url === publicationUrl(config, row.number) &&
    row.headRefOid === config.candidateHead &&
    row.headRefName === plan.sourceBranch &&
    row.baseRefName === plan.baseBranch
  );
}

function matchesPublication(row: any, current: PublicationEvidence, config: DeliveryConfig) {
  return (
    current.repository === config.repository &&
    current.head === config.candidateHead &&
    current.url === publicationUrl(config, current.number) &&
    DIGEST.test(current.planDigest) &&
    row?.number === current.number &&
    row.url === current.url &&
    row.headRefOid === current.head &&
    row.headRefName === current.sourceBranch &&
    row.baseRefName === current.baseBranch &&
    row.title === current.title &&
    normalizeBody(row.body) === normalizeBody(current.body)
  );
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

export function githubDeliveryAdapter(
  commands: GithubDeliveryCommands = { gh, ghJson },
): DeliveryAdapter {
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
    publicationUrl,
    async source(config) {
      const pinned = await json(
        resolve(config.stateDirectory, "config.json"),
        "missing-pilot-config-record",
      );
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
      const reviewerAttempt = await json(
        resolve(config.stateDirectory, "reviewer-attempt.json"),
        "missing-reviewer-attempt-record",
      );
      const authorTerminal = await json(
        resolve(config.stateDirectory, "author-terminal.json"),
        "missing-author-terminal-record",
      );
      const pilot = pinned?.config;
      if (
        typeof pinned?.fingerprint !== "string" ||
        !DIGEST.test(pinned.fingerprint) ||
        !pilot ||
        pilot.owner !== config.authority.controller ||
        pilot.run !== config.run ||
        pilot.issue !== config.issue ||
        pilot.repository !== config.repository ||
        pilot.pilotRevision !== config.controllerRevision ||
        typeof pilot.worktree !== "string" ||
        !samePath(pilot.worktree, config.worktree) ||
        typeof pilot.reviewWorktree !== "string" ||
        !samePath(pilot.reviewWorktree, config.reviewWorktree) ||
        typeof pilot.stateDirectory !== "string" ||
        !samePath(pilot.stateDirectory, config.stateDirectory) ||
        typeof pilot.base !== "string" ||
        !SHA.test(pilot.base) ||
        !exactStringSet(pilot.requiredChecks, config.requiredChecks) ||
        candidate?.head !== config.candidateHead ||
        authorTerminal?.status !== "passed" ||
        authorTerminal?.id !== author?.id ||
        authorTerminal?.head !== pilot.base ||
        reviewer?.status !== "passed" ||
        reviewer?.head !== config.candidateHead ||
        !validAttempt(author, config, "author") ||
        !validAttempt(reviewerAttempt, config, "reviewer") ||
        reviewer?.id !== reviewerAttempt.id ||
        author.id === reviewerAttempt.id
      )
        throw new DeliveryBlocked("unreviewed-delivery-source");
      return {
        head: candidate.head,
        reviewId: reviewerAttempt.id,
        controller: config.authority.controller,
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controllerRevision: config.controllerRevision,
        worktree: config.worktree,
        reviewWorktree: config.reviewWorktree,
        stateDirectory: config.stateDirectory,
        requiredChecks: [...config.requiredChecks],
      };
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
        const row = await commands.ghJson(config, [
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
      await commands.gh(config, [
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
    async observePublication(config, plan, planDigest) {
      try {
        const rows = await commands.ghJson(config, [
          "pr",
          "list",
          "--head",
          plan.sourceBranch,
          "--base",
          plan.baseBranch,
          "--state",
          "all",
          "--json",
          "number,url,headRefOid,headRefName,baseRefName,state,isDraft,title,body",
        ]);
        if (!Array.isArray(rows) || rows.length > 1) return { state: "unknown" };
        if (rows.length === 0) return { state: "needs-mutation" };
        const value = publication(rows[0], config, plan, planDigest);
        if (
          !matchesPublicationTarget(rows[0], config, plan) ||
          rows[0]?.state !== "OPEN" ||
          rows[0]?.isDraft !== true
        )
          return { state: "unknown" };
        return value ? { state: "confirmed", value } : { state: "needs-mutation" };
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
      const rows = await commands.ghJson(config, [
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
        await commands.gh(config, [
          "pr",
          "edit",
          String(rows[0].number),
          "--title",
          plan.title,
          "--body-file",
          body,
        ]);
      } else {
        await commands.gh(config, [
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
      const readIdentity = async () => {
        const row = await commands.ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "number,url,headRefOid,headRefName,baseRefName,state,title,body",
        ]);
        if (row?.state !== "OPEN" || !matchesPublication(row, current, config))
          throw new Error("publication moved");
        return row;
      };
      try {
        const before = await readIdentity();
        let stdout: string;
        try {
          stdout = await commands.gh(config, [
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
        const after = await readIdentity();
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("publication moved");
        return { head: before.headRefOid, checks: JSON.parse(stdout) };
      } catch {
        throw new DeliveryBlocked("hosted-observation-unavailable");
      }
    },
    async observeMerge(config, current) {
      try {
        const row = await commands.ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "number,url,headRefOid,headRefName,baseRefName,state,isDraft,title,body,mergeCommit",
        ]);
        if (!matchesPublication(row, current, config)) return { state: "unknown" };
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
      const row = await commands.ghJson(config, [
        "pr",
        "view",
        String(current.number),
        "--json",
        "number,url,headRefOid,headRefName,baseRefName,isDraft,state,title,body",
      ]);
      if (!matchesPublication(row, current, config) || row?.state !== "OPEN")
        throw new DeliveryBlocked("merge-head-drift");
      if (row.isDraft) {
        await commands.gh(config, ["pr", "ready", String(current.number)]);
        const ready = await commands.ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "number,url,headRefOid,headRefName,baseRefName,isDraft,state,title,body",
        ]);
        if (
          !matchesPublication(ready, current, config) ||
          ready?.state !== "OPEN" ||
          ready?.isDraft
        )
          throw new DeliveryBlocked("merge-head-drift");
      }
      await commands.gh(config, [
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

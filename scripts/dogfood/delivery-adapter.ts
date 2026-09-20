import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { RepairBlocked, parseReview } from "./repair-policy.mjs";
import { loadBoardSnapshot, normalizeBody, planningKeyOf } from "../planning/board-check.mjs";
import { checkCandidateBoard } from "../planning/candidate-board.mjs";
import { resolvePnpmLauncher } from "../pnpm-launcher.mjs";
import {
  DeliveryBlocked,
  type CheckEvidence,
  type CleanupPlan,
  type DeliveryAdapter,
  type DeliveryConfig,
  type GateFailureEvidence,
  type DraftPlan,
  type MergeEvidence,
  type PublicationEvidence,
  type PublicationPlan,
  type PublicationObservation,
} from "./delivery.mjs";

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

// ISS-152: pipe directly to a runtime file, not execFile's bounded output buffer.
async function gateCommand(
  command: GateFailureEvidence["command"],
  log: string,
  env?: Record<string, string>,
) {
  const file = await open(log, "wx");
  try {
    return await new Promise<{ code: number | null; signal: string | null; startup?: string }>(
      (done) => {
        const child = spawn(command.executable, command.argv, {
          cwd: command.cwd,
          windowsHide: true,
          stdio: ["ignore", file.fd, file.fd],
          ...(env ? { env: { ...process.env, ...env } } : {}),
        });
        child.once("error", (error) => done({ code: null, signal: null, startup: error.message }));
        child.once("close", (code, signal) => done({ code, signal }));
      },
    );
  } finally {
    await file.sync();
    await file.close();
  }
}

const STATIC_SCOPED_GATE = "verify:static:scoped";
const STATIC_RUN_MARKER = /^\[VERIFY_STATIC_RUN\] (\S+)$/gm;

// ISS-192: the Chase Sets scoped static runner is fail-fast and marks each link,
// so the failing link is the last marked block.
function staticScopedFailingLink(output: string): string | undefined {
  return [...output.matchAll(STATIC_RUN_MARKER)].at(-1)?.[1];
}

// Recognize only a final block wholly made of `<path> is stale|missing` throws
// from a `generate-*.mjs --check` producer: its command echo, Node's uncaught
// throw frame and the pnpm lifecycle tail. Any other line keeps the failure unknown.
function staticArtifactDiagnostics(output: string): string[] {
  const block = output.split(/^(?=\[VERIFY_STATIC_RUN\] )/m);
  if (block.length < 2) return [];
  const lines = block.at(-1)!.split(/\r?\n/);
  const diagnostics: string[] = [];
  let producer = false;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (
      line.trim() === "" ||
      /^\s+at /.test(line) ||
      /^Node\.js v\d/.test(line) ||
      /^\[ELIFECYCLE\] Command failed with exit code \d+\.$/.test(line)
    )
      continue;
    if (line.startsWith("$ ")) {
      if (/\bgenerate-[\w.-]+\.mjs --check$/.test(line)) producer = true;
      continue;
    }
    if (/^(?:file:\/\/|\/|[A-Za-z]:[\\/])\S+:\d+$/.test(line)) {
      // Node's throw frame: location, thrown source, caret. A frame without its caret is unknown.
      while (lines[++index] !== undefined && !/^\s*\^+\s*$/.test(lines[index]!));
      if (index >= lines.length) return [];
      continue;
    }
    const match = /^(?:Error: )?((?:[\w.@-]+\/)*[\w.@-]+ is (?:stale|missing))$/.exec(line);
    if (!match) return [];
    diagnostics.push(match[1]!);
  }
  return producer ? diagnostics : [];
}

// Deliberately recognize only completed compiler, formatter, assertion and
// generated-artifact staleness diagnostics. Timeouts, resource failures and
// mixed causes have no candidate attribution.
export function gateDiagnostics(name: string, raw: string): string[] {
  const output = raw.replace(/\u001b\[[0-9;]*m/g, "");
  if (
    /timed?\s*out|TimeoutError:|(?:test|hook|command|process) timeout|timeout of \d+|ENOMEM|ENOSPC|EACCES|ENOENT|ECONN|heap out of memory|SIGKILL|Unhandled|unhandled|ELIFECYCLE.*signal|command not found|Cannot find (?:module|package)|ERR_PNPM|failed to (?:load|start|resolve)|Errors\s+[1-9]\d*\s+errors?|^(?:TypeError|ReferenceError|SyntaxError|FATAL ERROR):/im.test(
      output,
    )
  )
    return [];
  if (name === STATIC_SCOPED_GATE) return staticArtifactDiagnostics(output);
  if (name === "typecheck")
    return [...output.matchAll(/^([^\r\n]+\(\d+,\d+\): error TS\d+: .+)$/gm)].map((m) => m[1]!);
  if (name === "format:check" && output.includes("Code style issues found"))
    return [...output.matchAll(/^\[warn\] (\S+\.[a-z]+)$/gm)].map((m) => m[1]!);
  if (
    name === "test" &&
    /Test Files\s+\d+ failed/.test(output) &&
    /Tests\s+.*failed/.test(output) &&
    /AssertionError:|Error: expect\(/.test(output)
  ) {
    const tests = [
      ...output.matchAll(/^\s*FAIL\s+(.+\.(?:test|spec)\.[cm]?[jt]sx?\s+>\s+.+)$/gm),
    ].map((m) => m[1]!);
    // Every failed test must identify an assertion; setup/suite failures stay unknown.
    const count = output.match(/Tests\s+(\d+) failed/);
    const blocks = output.split(/^\s*FAIL\s+/m).slice(1);
    if (
      tests.length === Number(count?.[1]) &&
      blocks.length === tests.length &&
      blocks.every((block) => /AssertionError:|Error: expect\(/.test(block))
    )
      return tests;
  }
  return [];
}

function validPublicationTarget(target: unknown): target is string {
  return (
    typeof target === "string" &&
    (target === "absent" ||
      (/^pr:[1-9][0-9]*$/.test(target) && Number.isSafeInteger(Number(target.slice(3)))))
  );
}

async function run(executable: string, args: string[], cwd: string) {
  return exec(executable, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function git(
  executable: string,
  config: DeliveryConfig,
  args: string[],
  cwd = config.repositoryRoot,
) {
  return (await run(executable, args, cwd)).stdout.trim();
}

async function gh(config: DeliveryConfig, args: string[]) {
  return (
    await run(
      "gh",
      [...args, ...(args[0] === "api" ? [] : ["--repo", `github.com/${config.repository}`])],
      config.controllerRoot,
    )
  ).stdout.trim();
}

async function ghJson(config: DeliveryConfig, args: string[]) {
  return JSON.parse(await gh(config, args));
}

export interface GithubDeliveryCommands {
  gh(config: DeliveryConfig, args: string[]): Promise<string>;
  ghJson(config: DeliveryConfig, args: string[]): Promise<any>;
}

// ISS-185: the PR rollup is shared by SHA. Only Actions' structured association
// and effective jobs can establish whose result this is.
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function associatedRun(run: any, config: DeliveryConfig, current: PublicationEvidence) {
  if (
    run?.repository?.full_name !== config.repository ||
    run.head_repository?.full_name !== config.repository ||
    run.head_sha !== current.head ||
    run.event !== "pull_request" ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length === 0
  )
    throw new Error(`unknown workflow association: ${run?.id}`);
  const matches = run.pull_requests.filter((pull: any) => pull.number === current.number);
  if (matches.length === 0) {
    if (!run.pull_requests.every((pull: any) => positive(pull.number)))
      throw new Error(`malformed workflow association: ${run.id}`);
    return false;
  }
  const pull = matches[0];
  if (
    matches.length !== 1 ||
    pull.url !== `https://api.github.com/repos/${config.repository}/pulls/${current.number}` ||
    pull.head?.repo?.id !== run.head_repository.id ||
    pull.base?.repo?.id !== run.repository.id ||
    !positive(run.repository.id) ||
    !positive(run.head_repository.id) ||
    pull.head?.sha !== current.head ||
    pull.head?.ref !== current.sourceBranch ||
    pull.base?.ref !== current.baseBranch ||
    run.head_branch !== current.sourceBranch ||
    !positive(run.id) ||
    !positive(run.workflow_id) ||
    !positive(run.run_number) ||
    !positive(run.run_attempt) ||
    typeof run.path !== "string" ||
    !run.path.startsWith(".github/workflows/") ||
    !["queued", "in_progress", "waiting", "pending", "requested", "completed"].includes(run.status)
  )
    throw new Error(`contradictory workflow association: ${run.id}`);
  return true;
}

async function publicationRuns(
  commands: GithubDeliveryCommands,
  config: DeliveryConfig,
  current: PublicationEvidence,
) {
  const pages = await commands.ghJson(config, [
    "api",
    `repos/${config.repository}/actions/runs?head_sha=${current.head}&event=pull_request&per_page=100`,
    "--paginate",
    "--slurp",
  ]);
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some((page) => !Array.isArray(page?.workflow_runs))
  )
    throw new Error("malformed workflow observation");
  const workflows = new Map<number, any>();
  const ids = new Set<number>();
  for (const run of pages.flatMap((page) => page.workflow_runs)) {
    if (!associatedRun(run, config, current)) continue;
    if (ids.has(run.id)) throw new Error(`duplicate workflow run: ${run.id}`);
    ids.add(run.id);
    const prior = workflows.get(run.workflow_id);
    if (prior && (prior.path !== run.path || prior.run_number === run.run_number))
      throw new Error(`competing workflow runs: ${run.workflow_id}`);
    // run_number is GitHub's sequence within this workflow, not a global ID/date.
    if (!prior || prior.run_number < run.run_number) workflows.set(run.workflow_id, run);
  }
  return workflows;
}

async function attributedChecks(
  commands: GithubDeliveryCommands,
  config: DeliveryConfig,
  current: PublicationEvidence,
) {
  const workflows = await publicationRuns(commands, config, current);
  const checks: CheckEvidence[] = [];
  let workflowPending = false;
  for (const run of workflows.values()) {
    workflowPending ||= run.status !== "completed";
    const jobPages = await commands.ghJson(config, [
      "api",
      `repos/${config.repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      "--paginate",
      "--slurp",
    ]);
    if (
      !Array.isArray(jobPages) ||
      jobPages.length === 0 ||
      jobPages.some((page) => !Array.isArray(page?.jobs))
    )
      throw new Error(`malformed workflow jobs: ${run.id}`);
    const jobs = jobPages.flatMap((page) => page.jobs);
    const jobIds = new Set<number>();
    for (const job of jobs) {
      if (
        !positive(job.id) ||
        jobIds.has(job.id) ||
        job.run_id !== run.id ||
        job.head_sha !== current.head ||
        !positive(job.run_attempt) ||
        job.run_attempt > run.run_attempt ||
        (job.run_attempt < run.run_attempt && job.conclusion !== "success") ||
        typeof job.name !== "string" ||
        job.html_url !==
          `https://github.com/${config.repository}/actions/runs/${run.id}/job/${job.id}`
      )
        throw new Error(`contradictory workflow job: ${run.id}/${job.id}`);
      jobIds.add(job.id);
      let bucket: CheckEvidence["bucket"];
      if (
        ["queued", "in_progress", "waiting", "pending"].includes(job.status) &&
        job.conclusion === null
      )
        bucket = "pending";
      else if (job.status === "completed") {
        switch (job.conclusion) {
          case "success":
            bucket = "pass";
            break;
          case "failure":
          case "timed_out":
          case "action_required":
          case "startup_failure":
            bucket = "fail";
            break;
          case "cancelled":
            bucket = "cancel";
            break;
          case "skipped":
          case "neutral":
            bucket = "skipping";
            break;
          default:
            throw new Error(`unknown job conclusion: ${job.id}`);
        }
      } else throw new Error(`unknown job status: ${job.id}`);
      if (config.requiredChecks.includes(job.name))
        checks.push({
          name: job.name,
          bucket,
          link: job.html_url,
          actions: {
            run: run.id,
            attempt: run.run_attempt,
            job: job.id,
            workflow: run.workflow_id,
          },
        });
    }
    // The latest-jobs endpoint supplies the effective set for failed-only reruns.
    // Never combine jobs from separate runs or manually fill gaps with old jobs.
  }
  if (workflows.size > 0) {
    const after = await publicationRuns(commands, config, current);
    const signature = (runs: Map<number, any>) =>
      JSON.stringify(
        [...runs.values()]
          .sort((a, b) => a.workflow_id - b.workflow_id)
          .map((run) => [run.workflow_id, run.id, run.run_number, run.run_attempt, run.path]),
      );
    if (signature(workflows) !== signature(after))
      throw new Error("applicable workflow changed during observation; reobserve checks");
    // ISS-188: lifecycle progress preserves attribution, but sampled green is
    // insufficient when either validated observation is still pending.
    workflowPending ||= [...after.values()].some((run) => run.status !== "completed");
  }
  for (const name of config.requiredChecks) {
    const count = checks.filter((check) => check.name === name).length;
    if (count > 1 || (count === 0 && workflows.size > 0 && !workflowPending))
      throw new Error(`missing or duplicate current job: ${name}`);
  }
  return { checks, workflowPending, startupInvisible: workflows.size === 0 };
}

async function json(path: string, reason: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new DeliveryBlocked(reason);
  }
}

// ISS-172: publish the accepted review's existing answer, without another record.
export async function acceptedReviewG0(config: DeliveryConfig): Promise<string> {
  const terminal = await json(
    resolve(config.stateDirectory, "reviewer-terminal.json"),
    "missing-reviewer-terminal",
  );
  try {
    const review = parseReview(terminal?.summary, config.run, config.candidateHead);
    if (review.verdict === "PASS") return review.g0;
  } catch (error) {
    if (!(error instanceof RepairBlocked)) throw error;
  }
  throw new DeliveryBlocked("unreviewed-delivery-source");
}

function staticLinkRan(output: string, link: string) {
  return [...output.matchAll(STATIC_RUN_MARKER)].some((m) => m[1] === link);
}

// The candidate's derived static scope: the same name-status diff the runner
// reads, including both sides of renames.
async function changedFiles(
  gitExecutable: string,
  config: DeliveryConfig,
  main: string,
  head: string,
) {
  const tokens = (
    await git(
      gitExecutable,
      config,
      [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--diff-filter=ACMRTD",
        `${main}...${head}`,
        "--",
      ],
      config.worktree,
    )
  )
    .split("\0")
    .filter(Boolean);
  const files: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const paths = /^[RC]\d*$/.test(tokens[index++]!) ? 2 : 1;
    files.push(...tokens.slice(index, index + paths));
    index += paths;
  }
  return [...new Set(files)];
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

function validAttempt(
  value: any,
  config: DeliveryConfig,
  role: "author" | "reviewer",
  stateDirectory = config.stateDirectory,
) {
  return (
    value &&
    (value.retries === undefined || value.retries === 1) &&
    typeof value.id === "string" &&
    ATTEMPT_ID.test(value.id) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.trace === "string" &&
    isAbsolute(value.trace) &&
    samePath(resolve(value.trace, ".."), stateDirectory) &&
    new RegExp(`^${role}(?:-[0-9a-f-]{36})?\\.jsonl$`).test(
      value.trace.split(/[\\/]/).at(-1) ?? "",
    ) &&
    Number.isFinite(value.launchedAt) &&
    value.launchedAt > 0
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

function isConflicting(row: any) {
  return row.mergeable === "CONFLICTING" || row.mergeStateStatus === "DIRTY";
}

function matchesPublicationIdentity(
  row: any,
  config: DeliveryConfig,
  plan: PublicationPlan,
  number: number,
) {
  return (
    row?.number === number &&
    row.url === publicationUrl(config, number) &&
    row.headRefName === plan.sourceBranch &&
    row.baseRefName === plan.baseBranch
  );
}

function publicationRefresh(config: DeliveryConfig) {
  const refresh = config.refresh;
  if (refresh === undefined) return undefined;
  if (
    !Number.isSafeInteger(refresh.number) ||
    refresh.number <= 0 ||
    refresh.url !== publicationUrl(config, refresh.number) ||
    !SHA.test(refresh.head) ||
    refresh.head === config.candidateHead
  )
    throw new DeliveryBlocked("malformed-publication-refresh");
  return refresh;
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

async function assertGitTarget(executable: string, config: DeliveryConfig, cwd: string) {
  try {
    for (const kind of [[], ["--push"]]) {
      const { stdout } = await run(
        executable,
        ["remote", "get-url", ...kind, "--all", "origin"],
        cwd,
      );
      const urls = stdout.replace(/\r?\n$/, "").split(/\r?\n/);
      if (urls.length !== 1 || !matchesRepository(urls[0]!, config.repository))
        throw new DeliveryBlocked("delivery-repository-mismatch");
    }
  } catch (error) {
    if (error instanceof DeliveryBlocked) throw error;
    throw new DeliveryBlocked("delivery-repository-unverified");
  }
}

async function assertWorktreeRepository(executable: string, config: DeliveryConfig) {
  const common = await realpath(
    resolve(
      config.repositoryRoot,
      await git(executable, config, ["rev-parse", "--git-common-dir"]),
    ),
  );
  await assertGitTarget(executable, config, config.repositoryRoot);
  for (const cwd of [config.worktree, config.reviewWorktree]) {
    const selected = await realpath(
      resolve(cwd, await git(executable, config, ["rev-parse", "--git-common-dir"], cwd)),
    );
    if (!samePath(common, selected)) throw new DeliveryBlocked("delivery-worktree-family-mismatch");
    await assertGitTarget(executable, config, cwd);
  }
}

async function worktrees(executable: string, config: DeliveryConfig) {
  const output = await git(executable, config, ["worktree", "list", "--porcelain"]);
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

async function branchHead(executable: string, config: DeliveryConfig, branch: string) {
  await git(executable, config, ["check-ref-format", "--branch", branch]);
  const expectedRef = `refs/heads/${branch}`;
  const { stdout, stderr } = await run(
    executable,
    ["for-each-ref", "--count=2", "--format=%(refname)%00%(objectname)", expectedRef],
    config.repositoryRoot,
  );
  const output = stdout.trim();
  if (stderr.trim() !== "") throw new DeliveryBlocked("malformed-local-cleanup-branch");
  if (output === "") return undefined;

  const rows = output.split(/\r?\n/);
  if (rows.length !== 1) throw new DeliveryBlocked("ambiguous-local-cleanup-branch");
  const [actualRef, head, ...unexpected] = rows[0]!.split("\0");
  if (
    unexpected.length !== 0 ||
    !actualRef ||
    !head ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)
  )
    throw new DeliveryBlocked("malformed-local-cleanup-branch");
  if (actualRef !== expectedRef) {
    if (actualRef.startsWith(`${expectedRef}/`))
      throw new DeliveryBlocked("ambiguous-local-cleanup-branch");
    throw new DeliveryBlocked("malformed-local-cleanup-branch");
  }
  return head;
}

async function remoteBranchHead(executable: string, config: DeliveryConfig, branch: string) {
  await assertGitTarget(executable, config, config.repositoryRoot);
  const output = await git(executable, config, [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  if (output === "") return undefined;
  const rows = output.split(/\r?\n/);
  if (rows.length !== 1) throw new DeliveryBlocked("ambiguous-remote-cleanup-branch");
  const match = rows[0]!.match(/^([a-f0-9]{40})\s+refs\/heads\/(.+)$/);
  if (!match || match[2] !== branch) throw new DeliveryBlocked("malformed-remote-cleanup-branch");
  return match[1];
}

async function publicationRemoteBranchHead(
  executable: string,
  config: DeliveryConfig,
  branch: string,
) {
  await assertGitTarget(executable, config, config.worktree);
  const output = await git(
    executable,
    config,
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    config.worktree,
  );
  const match = output.match(/^([a-f0-9]{40})\s+refs\/heads\/(.+)$/);
  if (!match || match[2] !== branch || output.split(/\r?\n/).length !== 1)
    throw new DeliveryBlocked("publication-refresh-lease-unverified");
  return match[1];
}

async function assertForwardRefresh(executable: string, config: DeliveryConfig, priorHead: string) {
  try {
    await run(
      executable,
      ["merge-base", "--is-ancestor", priorHead, config.candidateHead],
      config.worktree,
    );
  } catch {
    throw new DeliveryBlocked("publication-refresh-not-forward");
  }
}

export async function assertControllerExecutor(
  config: DeliveryConfig,
  executingRoot: string,
  gitExecutable = "git",
) {
  try {
    const [actualRoot, configuredRoot, repositoryRoot] = await Promise.all([
      realpath(executingRoot),
      realpath(config.controllerRoot),
      realpath(config.repositoryRoot),
    ]);
    if (!samePath(actualRoot, configuredRoot))
      throw new DeliveryBlocked("controller-executor-mismatch");
    const controllerTop = await realpath(
      await git(gitExecutable, config, ["rev-parse", "--show-toplevel"], actualRoot),
    );
    if (!samePath(controllerTop, actualRoot))
      throw new DeliveryBlocked("controller-executor-not-repository-root");
    if (
      (await git(gitExecutable, config, ["rev-parse", "HEAD"], actualRoot)) !==
      config.controllerRevision
    )
      throw new DeliveryBlocked("controller-executor-revision-moved");
    if ((await git(gitExecutable, config, ["status", "--porcelain"], actualRoot)) !== "")
      throw new DeliveryBlocked("dirty-controller-executor");
    const repositoryTop = await realpath(
      await git(gitExecutable, config, ["rev-parse", "--show-toplevel"], repositoryRoot),
    );
    if (!samePath(repositoryTop, repositoryRoot))
      throw new DeliveryBlocked("delivery-repository-not-root");
    if (
      (await git(gitExecutable, config, ["branch", "--show-current"], repositoryRoot)) !== "main" ||
      (await git(gitExecutable, config, ["status", "--porcelain"], repositoryRoot)) !== ""
    )
      throw new DeliveryBlocked("unstable-delivery-repository");
  } catch (error) {
    if (error instanceof DeliveryBlocked) throw error;
    throw new DeliveryBlocked("controller-executor-unverified");
  }
}

export function githubDeliveryAdapter(
  commands: GithubDeliveryCommands = { gh, ghJson },
  gitExecutable = "git",
  pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): DeliveryAdapter {
  const observeSibling = async (config: DeliveryConfig, draft: DraftPlan) => {
    const refuse = () => new DeliveryBlocked(`self-sibling-refused:${draft.key}`);
    const board = await loadBoardSnapshot(config.repository);
    const rows = board.issues.filter((row) => planningKeyOf(row.body) === draft.key);
    if (rows.length !== 1 || rows[0]!.number !== draft.issue) throw refuse();
    const row = rows[0]!;
    if (row.state === "CLOSED")
      return { state: "confirmed" as const, value: { issue: draft.issue } };
    if (
      row.state !== "OPEN" ||
      (row.reopenedEvent ?? null) !== draft.attributes.reopenedEvent ||
      row.title !== draft.title ||
      row.milestone !== draft.attributes.milestone
    )
      throw refuse();
    if (normalizeBody(row.body) === normalizeBody(draft.body))
      return { state: "confirmed" as const, value: { issue: draft.issue } };
    if (normalizeBody(row.body) !== normalizeBody(draft.attributes.baseBody)) throw refuse();
    return { state: "needs-mutation" as const };
  };
  const verifyWorkspace = async (config: DeliveryConfig, head: string) => {
    try {
      await assertWorktreeRepository(gitExecutable, config);
      if (
        (await git(gitExecutable, config, ["rev-parse", "HEAD"], config.controllerRoot)) !==
        config.controllerRevision
      )
        return false;
      if (
        (await git(gitExecutable, config, ["status", "--porcelain"], config.controllerRoot)) !== ""
      )
        return false;
      if (
        (await git(gitExecutable, config, ["branch", "--show-current"], config.repositoryRoot)) !==
          "main" ||
        (await git(gitExecutable, config, ["status", "--porcelain"], config.repositoryRoot)) !== ""
      )
        return false;
      for (const cwd of [config.worktree, config.reviewWorktree]) {
        if ((await git(gitExecutable, config, ["rev-parse", "HEAD"], cwd)) !== head) return false;
        if ((await git(gitExecutable, config, ["status", "--porcelain"], cwd)) !== "") return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  return {
    publicationUrl,
    async conflictingPublication(config, current) {
      try {
        const row = await commands.ghJson(config, [
          "pr",
          "view",
          String(current.number),
          "--json",
          "number,url,headRefOid,headRefName,baseRefName,state,title,body,mergeable,mergeStateStatus",
        ]);
        if (
          !matchesPublication(row, current, config) ||
          row.state !== "OPEN" ||
          (await publicationRemoteBranchHead(gitExecutable, config, current.sourceBranch)) !==
            current.head
        )
          throw new Error("publication moved");
        return isConflicting(row);
      } catch {
        throw new DeliveryBlocked("publication-state-unknown");
      }
    },
    async source(config) {
      const pinned = await json(
        resolve(config.stateDirectory, "config.json"),
        "missing-pilot-config-record",
      );
      const candidate = await json(
        resolve(config.stateDirectory, "candidate.json"),
        "missing-candidate-record",
      );
      const author = await json(
        resolve(config.stateDirectory, "author-attempt.json"),
        "missing-author-record",
      );
      const authorTerminal = await json(
        resolve(config.stateDirectory, "author-terminal.json"),
        "missing-author-terminal-record",
      );
      const pilot = pinned?.config;
      const [reviewer, reviewerAttempt] = await Promise.all([
        json(resolve(config.stateDirectory, "reviewer-terminal.json"), "missing-reviewer-terminal"),
        json(resolve(config.stateDirectory, "reviewer-attempt.json"), "missing-reviewer-record"),
      ]);
      let reviewerReportAccepted = false;
      try {
        reviewerReportAccepted =
          parseReview(reviewer.summary, config.run, config.candidateHead).verdict === "PASS";
      } catch (error) {
        if (!(error instanceof RepairBlocked)) throw error;
      }
      if (
        typeof pinned?.fingerprint !== "string" ||
        !DIGEST.test(pinned.fingerprint) ||
        !pilot ||
        pilot.owner !== config.controller ||
        pilot.run !== config.run ||
        pilot.issue !== config.issue ||
        pilot.repository !== config.repository ||
        !SHA.test(pilot.pilotRevision) ||
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
        !reviewerReportAccepted ||
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
        controller: config.controller,
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
      if (!(await verifyWorkspace(config, head)))
        throw new DeliveryBlocked("candidate-workspace-drift");
      const directory = resolve(
        config.stateDirectory,
        `gate-${createHash("sha256").update(name).digest("hex")}`,
      );
      try {
        await mkdir(directory, { recursive: true });
      } catch (error) {
        throw new DeliveryBlocked(
          `gate-host-failed:${name}`,
          `${String(error)}; evidence directory: ${directory}`,
        );
      }
      const log = resolve(directory, "candidate.log");
      let command: GateFailureEvidence["command"];
      try {
        const launcher = await resolvePnpmLauncher();
        command = {
          executable: launcher.executable,
          argv: [...launcher.prefixArgs, "run", name],
          cwd: config.worktree,
        };
      } catch (error) {
        throw new DeliveryBlocked(`gate-host-failed:${name}`, String(error));
      }
      try {
        if (
          name === "planning:board-check" &&
          config.repository === "todd-skelton/orchestration-platform"
        ) {
          // This gate observes the live board and cannot be attributed by a local base control.
          try {
            await checkCandidateBoard(config.worktree, head, gitExecutable);
          } catch (error) {
            await stagedFile(config, `board-failure.log`, String(error));
            return { status: "failed", output: String(error) };
          }
          if (!(await verifyWorkspace(config, head)))
            throw new DeliveryBlocked("candidate-workspace-drift");
          return { status: "passed" };
        }
        const terminalPath = resolve(directory, "candidate-terminal.json");
        let saved;
        try {
          saved = JSON.parse(await readFile(terminalPath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (saved) {
          if (saved.head !== head) throw new DeliveryBlocked("gate-failure-head-drift");
          command = saved.command;
        }
        const result = saved ?? (await gateCommand(command, log));
        await stagedFile(
          config,
          `${directory.split(/[\\/]/).at(-1)}/candidate-terminal.json`,
          JSON.stringify({ head, command, ...result }),
        );
        const output = await readFile(log, "utf8");
        if (!(await verifyWorkspace(config, head)))
          throw new DeliveryBlocked("candidate-workspace-drift");
        if (result.code === 0 && !result.signal && !result.startup) return { status: "passed" };
        const diagnostics =
          result.code !== null && !result.signal && !result.startup
            ? gateDiagnostics(name, output)
            : [];
        // Tie every diagnostic to a file in the committed candidate, not an external path.
        let committed = diagnostics.length > 0;
        for (const diagnostic of diagnostics) {
          const path = diagnostic.split(/\(\d+,\d+\):| > |\s+is\s+(?:stale|missing)$/)[0]!;
          try {
            await git(
              gitExecutable,
              config,
              ["cat-file", "-e", `${head}:${path}`],
              config.worktree,
            );
          } catch {
            committed = false;
          }
        }
        const evidence: GateFailureEvidence = {
          head,
          command,
          log,
          diagnostics,
          cause:
            result.startup ||
            (/(?:tsc|prettier|vitest): (?:not found|command not found)|'(?:tsc|prettier|vitest)' is not recognized/.test(
              output,
            ) &&
              !/error TS\d+:|AssertionError:|Code style issues found/.test(output))
              ? "host"
              : committed
                ? "diagnostic"
                : "unknown",
        };
        return { status: "failed", output: result.startup ?? output, evidence };
      } catch (error) {
        if (error instanceof DeliveryBlocked) throw error;
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new DeliveryBlocked(
            `gate-attribution-unknown:${name}`,
            `Incomplete terminal observation; retained output: ${log}`,
          );
        throw new DeliveryBlocked(`gate-host-failed:${name}`, `${String(error)}; evidence: ${log}`);
      }
    },
    async attributeGate(config, name, evidence, main) {
      const directory = resolve(evidence.log, "..");
      const tree = resolve(directory, "base");
      const log = resolve(directory, "base.log");
      const result = { cause: "unknown" as "candidate" | "base" | "host" | "unknown", main, log };
      const savedPath = resolve(directory, "base-attribution.json");
      try {
        return JSON.parse(await readFile(savedPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (evidence.cause !== "diagnostic" || evidence.head !== config.candidateHead) return result;
      let added = false;
      try {
        // ISS-192: the scoped static runner derives its scope from the tree's own
        // merge-base, so a detached base tree selects nothing. The base control
        // must run the candidate's selection or it discriminates nothing.
        const link =
          name === STATIC_SCOPED_GATE
            ? staticScopedFailingLink(await readFile(evidence.log, "utf8"))
            : undefined;
        if (name === STATIC_SCOPED_GATE && !link) return result;
        // Dependencies and the script must be comparable. A changed toolchain stays unknown.
        for (const path of ["package.json", "pnpm-lock.yaml"]) {
          const before = await git(
            gitExecutable,
            config,
            ["show", `${main}:${path}`],
            config.worktree,
          );
          const after = await git(
            gitExecutable,
            config,
            ["show", `${evidence.head}:${path}`],
            config.worktree,
          );
          if (before !== after) return result;
        }
        await git(gitExecutable, config, ["worktree", "add", "--detach", tree, main]);
        added = true;
        const launcher = await resolvePnpmLauncher();
        const install = await gateCommand(
          {
            executable: launcher.executable,
            argv: [...launcher.prefixArgs, "install", "--offline", "--frozen-lockfile"],
            cwd: tree,
          },
          resolve(directory, "base-install.log"),
        );
        if (
          install.code !== 0 ||
          install.signal ||
          install.startup ||
          (await git(gitExecutable, config, ["rev-parse", "HEAD"], tree)) !== main ||
          (await git(gitExecutable, config, ["status", "--porcelain"], tree)) !== ""
        )
          result.cause = "host";
        else {
          const command = { ...evidence.command, cwd: tree };
          const env = link
            ? {
                CHANGED_FILES_JSON: JSON.stringify(
                  await changedFiles(gitExecutable, config, main, evidence.head),
                ),
              }
            : undefined;
          const terminal = await gateCommand(command, log, env);
          await stagedFile(
            config,
            `${directory.split(/[\\/]/).at(-1)}/base-terminal.json`,
            JSON.stringify({ head: main, command, ...terminal }),
          );
          const output = await readFile(log, "utf8");
          const clean =
            (await git(gitExecutable, config, ["status", "--porcelain"], tree)) === "" &&
            (await git(gitExecutable, config, ["rev-parse", "HEAD"], tree)) === main;
          if (!clean || terminal.startup) result.cause = "host";
          else if (terminal.code === 0 && !terminal.signal) {
            // A passing base is evidence only when the failing link actually ran there.
            if (!link || staticLinkRan(output, link)) result.cause = "candidate";
          } else if (
            terminal.code !== null &&
            !terminal.signal &&
            gateDiagnostics(name, output).length
          )
            result.cause = "base";
        }
      } catch (error) {
        result.cause = (error as NodeJS.ErrnoException).code === "EEXIST" ? "unknown" : "host";
      } finally {
        if (added) {
          try {
            await git(gitExecutable, config, ["worktree", "remove", "--force", tree]);
          } catch {
            result.cause = "host";
          }
        }
      }
      await stagedFile(
        config,
        `${directory.split(/[\\/]/).at(-1)}/base-attribution.json`,
        JSON.stringify(result),
      );
      return result;
    },
    async observeDraft(config, draft) {
      if (typeof draft.attributes.baseBody === "string") return observeSibling(config, draft);
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
      if (typeof draft.attributes.baseBody === "string") {
        // Reobserve even when called after a saved intent or a lost mutation response.
        if ((await observeSibling(config, draft)).state === "confirmed") return;
        const path = await stagedFile(config, `approved-${draft.key}.md`, draft.body);
        await commands.gh(config, ["issue", "edit", String(draft.issue), "--body-file", path]);
        return;
      }
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
    async observePublication(config, plan, planDigest, target) {
      try {
        const observed = async (
          row: any,
          value: PublicationEvidence,
        ): Promise<PublicationObservation> => {
          if (!isConflicting(row)) return { state: "confirmed", value };
          if (
            (await publicationRemoteBranchHead(gitExecutable, config, plan.sourceBranch)) !==
            value.head
          )
            return { state: "unknown" };
          return { state: "conflicting", value };
        };
        if (target !== undefined && !validPublicationTarget(target)) return { state: "unknown" };
        const refresh = publicationRefresh(config);
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
          "number,url,headRefOid,headRefName,baseRefName,state,isDraft,title,body,mergeable,mergeStateStatus",
        ]);
        if (!Array.isArray(rows) || rows.length > 1) return { state: "unknown" };
        if (rows.length === 0) {
          if (refresh) return { state: "unknown" };
          return target === undefined || target === "absent"
            ? { state: "needs-mutation", target: "absent" }
            : { state: "unknown" };
        }
        if (refresh) {
          const row = rows[0];
          const selectedTarget = `pr:${refresh.number}`;
          if (
            !matchesPublicationIdentity(row, config, plan, refresh.number) ||
            row?.state !== "OPEN" ||
            typeof row?.isDraft !== "boolean" ||
            (target !== undefined && target !== selectedTarget)
          )
            return { state: "unknown" };
          if (row.headRefOid === config.candidateHead) {
            const value = publication(row, config, plan, planDigest);
            return value
              ? await observed(row, value)
              : { state: "needs-mutation", target: selectedTarget };
          }
          return row.headRefOid === refresh.head && target === undefined
            ? { state: "needs-mutation", target: selectedTarget }
            : { state: "unknown" };
        }
        const value = publication(rows[0], config, plan, planDigest);
        // An exact published head can become conflicting after leaving draft state.
        // Reconcile it before applying the prerequisites for a new publication.
        if (
          value &&
          isConflicting(rows[0]) &&
          rows[0].state === "OPEN" &&
          (target === undefined || target === "absent" || target === `pr:${rows[0].number}`)
        )
          return await observed(rows[0], value);
        if (
          !matchesPublicationTarget(rows[0], config, plan) ||
          rows[0]?.state !== "OPEN" ||
          rows[0]?.isDraft !== true ||
          (target !== undefined && target !== "absent" && target !== `pr:${rows[0].number}`)
        ) {
          // ISS-151: retain the publication stop and identify its preserved local holder.
          if (config.localBranch) {
            const holder = (await worktrees(gitExecutable, config)).find(
              (row) => row.branch === `refs/heads/${plan.sourceBranch}`,
            );
            if (holder?.path)
              throw new DeliveryBlocked("publication-state-unknown", resolve(holder.path));
          }
          return { state: "unknown" };
        }
        if (value) return await observed(rows[0], value);
        if (target === "absent") return { state: "unknown" };
        return { state: "needs-mutation", target: `pr:${rows[0].number}` };
      } catch (error) {
        if (error instanceof DeliveryBlocked && error.reason === "publication-state-unknown")
          throw error;
        return { state: "unknown" };
      }
    },
    async publish(config, plan, target) {
      if (!(await verifyWorkspace(config, config.candidateHead)))
        throw new DeliveryBlocked("candidate-workspace-drift");
      if (!validPublicationTarget(target)) throw new DeliveryBlocked("publication-target-drift");
      const refresh = publicationRefresh(config);
      const branch = await git(
        gitExecutable,
        config,
        ["branch", "--show-current"],
        config.worktree,
      );
      if (branch !== (config.localBranch ?? refresh?.localBranch ?? plan.sourceBranch))
        throw new DeliveryBlocked("publication-branch-mismatch");
      const readTarget = async (expectedHead?: string) => {
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
        if (
          !Array.isArray(rows) ||
          rows.length > 1 ||
          (target === "absent"
            ? rows.length !== 0
            : rows.length !== 1 ||
              (refresh
                ? !matchesPublicationIdentity(rows[0], config, plan, refresh.number) ||
                  (expectedHead === undefined
                    ? ![refresh.head, config.candidateHead].includes(rows[0].headRefOid)
                    : rows[0].headRefOid !== expectedHead)
                : !matchesPublicationTarget(rows[0], config, plan)) ||
              target !== `pr:${rows[0].number}` ||
              rows[0].state !== "OPEN" ||
              (refresh ? typeof rows[0].isDraft !== "boolean" : rows[0].isDraft !== true) ||
              typeof rows[0].title !== "string" ||
              typeof rows[0].body !== "string")
        )
          throw new DeliveryBlocked("publication-target-drift");
        return rows;
      };
      if (refresh && target !== `pr:${refresh.number}`)
        throw new DeliveryBlocked("publication-target-drift");
      const initialRows = await readTarget(refresh ? undefined : config.candidateHead);
      const body = await stagedFile(config, "approved-pull-request.md", plan.body);
      const observedHead = initialRows[0]?.headRefOid;
      if (!refresh || observedHead === refresh.head) {
        if (refresh) {
          await assertForwardRefresh(gitExecutable, config, refresh.head);
          if (
            (await publicationRemoteBranchHead(gitExecutable, config, plan.sourceBranch)) !==
            refresh.head
          )
            throw new DeliveryBlocked("publication-refresh-lease-drift");
        }
        await run(
          gitExecutable,
          [
            "push",
            "--no-follow-tags",
            ...(refresh
              ? [`--force-with-lease=refs/heads/${plan.sourceBranch}:${refresh.head}`]
              : []),
            "origin",
            `${config.candidateHead}:refs/heads/${plan.sourceBranch}`,
          ],
          config.worktree,
        );
      } else if (observedHead !== config.candidateHead) {
        throw new DeliveryBlocked("publication-target-drift");
      }
      const rows = await readTarget(config.candidateHead);
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
          "number,url,headRefOid,headRefName,baseRefName,state,title,body,mergeable,mergeStateStatus",
        ]);
        if (row?.state !== "OPEN" || !matchesPublication(row, current, config))
          throw new Error("publication moved");
        if (isConflicting(row)) {
          if (
            (await publicationRemoteBranchHead(gitExecutable, config, current.sourceBranch)) !==
            current.head
          )
            throw new DeliveryBlocked("publication-state-unknown");
          throw new DeliveryBlocked("published-candidate-conflict");
        }
        // GitHub computes mergeability asynchronously; only publication identity
        // must stay equal across the hosted-check observation.
        const { mergeable: _mergeable, mergeStateStatus: _mergeStateStatus, ...identity } = row;
        return identity;
      };
      for (let retry = 0; ; retry += 1) {
        try {
          const before = await readIdentity();
          const { checks, workflowPending, startupInvisible } = await attributedChecks(
            commands,
            config,
            current,
          );
          const after = await readIdentity();
          if (JSON.stringify(before) !== JSON.stringify(after))
            throw new Error("publication moved");
          // ISS-143: GitHub can expose advisory checks before any required check or workflow run.
          if (startupInvisible && retry < 12) {
            await pause(10_000);
            continue;
          }
          if (startupInvisible)
            throw new Error("current publication workflow absent after 12 startup waits");
          return {
            head: before.headRefOid,
            checks,
            ...(workflowPending ? { workflowPending } : {}),
          };
        } catch (error) {
          if (
            error instanceof DeliveryBlocked &&
            ["published-candidate-conflict", "publication-state-unknown"].includes(error.reason)
          )
            throw error;
          const failure = error as { stderr?: string; message?: string };
          const detail = [failure.stderr, failure.message].find(
            (value) => typeof value === "string" && value.trim() !== "",
          );
          throw new DeliveryBlocked("hosted-observation-unavailable", detail?.trim().slice(0, 500));
        }
      }
    },
    async failedCheckLog(config, check, current) {
      try {
        if (!check.actions)
          throw new Error("missing current Actions attribution; reobserve checks");
        const selection = check.actions;
        const verify = async () => {
          const observed = await this.checks(config, current);
          if (!observed.checks.some((row) => JSON.stringify(row) === JSON.stringify(check)))
            throw new Error("selected failure changed; reobserve checks");
          const run = await commands.ghJson(config, [
            "api",
            `repos/${config.repository}/actions/runs/${selection.run}`,
          ]);
          if (!associatedRun(run, config, current) || run.run_attempt !== selection.attempt)
            throw new Error("selected run attempt changed; reobserve checks");
          return run.status === "completed";
        };
        if (!(await verify())) return null;
        const log = await commands.gh(config, [
          "run",
          "view",
          String(selection.run),
          "--attempt",
          String(selection.attempt),
          "--log-failed",
        ]);
        if (!(await verify())) throw new Error("workflow changed while fetching logs");
        return log;
      } catch (error) {
        const failure = error as { stderr?: string; message?: string };
        const detail = [failure.stderr, failure.message].find(
          (value) => typeof value === "string" && value.trim() !== "",
        );
        throw new DeliveryBlocked(
          `hosted-check-log-unavailable:${check.name}`,
          detail?.trim().slice(0, 500),
        );
      }
    },
    async observeMerge(config, current, policy) {
      try {
        const queued = (policy as { method?: unknown })?.method === "queue";
        const [owner, name] = config.repository.split("/");
        const response = await commands.ghJson(
          config,
          queued
            ? [
                "api",
                "graphql",
                "-f",
                `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number url headRefOid headRefName baseRefName state isDraft title body mergeCommit{oid} mergeQueueEntry{state}}}}`,
                "-F",
                `owner=${owner}`,
                "-F",
                `name=${name}`,
                "-F",
                `number=${current.number}`,
              ]
            : [
                "pr",
                "view",
                String(current.number),
                "--json",
                "number,url,headRefOid,headRefName,baseRefName,state,isDraft,title,body,mergeCommit",
              ],
        );
        const row = queued ? response?.data?.repository?.pullRequest : response;
        if (!matchesPublication(row, current, config)) return { state: "unknown" };
        if (row.state === "OPEN")
          return queued && typeof row.mergeQueueEntry?.state === "string"
            ? { state: "pending" }
            : {
                state: "needs-mutation",
                ...(queued ? { detail: String(row.mergeQueueEntry?.state ?? "absent") } : {}),
              };
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
        !["squash", "queue"].includes(String((policy as { method?: unknown }).method))
      )
        throw new DeliveryBlocked("unsupported-self-merge-policy");
      const row = await commands.ghJson(config, [
        "pr",
        "view",
        String(current.number),
        "--json",
        `${(policy as { method: string }).method === "queue" ? "id," : ""}number,url,headRefOid,headRefName,baseRefName,isDraft,state,title,body`,
      ]);
      if (
        !matchesPublication(row, current, config) ||
        row?.state !== "OPEN" ||
        typeof row.isDraft !== "boolean"
      )
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
          ready?.isDraft !== false
        )
          throw new DeliveryBlocked("merge-head-drift");
      }
      if ((policy as { method: string }).method === "queue") {
        try {
          if (typeof row.id !== "string" || !row.id)
            throw new Error("Missing approved pull request node ID.");
          const result = await commands.ghJson(config, [
            "api",
            "graphql",
            "-f",
            "query=mutation($pullRequestId:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$pullRequestId,expectedHeadOid:$head,jump:false}){mergeQueueEntry{id}}}",
            "-F",
            `pullRequestId=${row.id}`,
            "-F",
            `head=${config.candidateHead}`,
          ]);
          if (result?.errors?.length)
            throw new Error(
              result.errors.map((error: { message: string }) => error.message).join("; "),
            );
        } catch (error) {
          const failure = error as { stderr?: string; message?: string };
          throw new DeliveryBlocked(
            "merge-queue-admission-failed",
            (failure.stderr || failure.message || String(error)).trim().slice(0, 4_000),
          );
        }
      } else
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
        await assertGitTarget(gitExecutable, config, config.repositoryRoot);
        const rows = await worktrees(gitExecutable, config);
        if (
          (await git(gitExecutable, config, ["status", "--porcelain"], config.repositoryRoot)) !==
          ""
        )
          return { state: "unknown" };
        if (
          rows.filter((row) => row.path && samePath(row.path, config.repositoryRoot)).length !== 1
        )
          return { state: "unknown" };
        const present = plan.worktrees.filter(
          (path) => rows.filter((row) => row.path && samePath(row.path, path)).length === 1,
        );
        const branch = await branchHead(gitExecutable, config, plan.branch);
        const remoteBranch = await remoteBranchHead(gitExecutable, config, plan.branch);
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
      await assertGitTarget(gitExecutable, config, config.repositoryRoot);
      const rows = await worktrees(gitExecutable, config);
      if (
        (await git(gitExecutable, config, ["status", "--porcelain"], config.repositoryRoot)) !==
          "" ||
        plan.worktrees.some(
          (path) => rows.filter((row) => row.path && samePath(row.path, path)).length !== 1,
        ) ||
        plan.worktrees.some((path) => samePath(path, config.repositoryRoot)) ||
        !rows.some((row) => row.path && samePath(row.path, config.repositoryRoot)) ||
        (await branchHead(gitExecutable, config, plan.branch)) !== config.candidateHead ||
        ![undefined, config.candidateHead].includes(
          await remoteBranchHead(gitExecutable, config, plan.branch),
        )
      )
        throw new DeliveryBlocked("cleanup-target-drift");
      for (const path of plan.worktrees) {
        if ((await git(gitExecutable, config, ["status", "--porcelain"], path)) !== "")
          throw new DeliveryBlocked("cleanup-dirty-worktree");
        if (
          (await git(gitExecutable, config, ["rev-parse", "HEAD"], path)) !== config.candidateHead
        )
          throw new DeliveryBlocked("cleanup-head-drift");
      }
      if ((await remoteBranchHead(gitExecutable, config, plan.branch)) === config.candidateHead)
        await run(
          gitExecutable,
          [
            "push",
            "--no-follow-tags",
            `--force-with-lease=refs/heads/${plan.branch}:${config.candidateHead}`,
            "--delete",
            "origin",
            plan.branch,
          ],
          config.repositoryRoot,
        );
      for (const path of plan.worktrees)
        await run(gitExecutable, ["worktree", "remove", resolve(path)], config.repositoryRoot);
      await run(gitExecutable, ["branch", "-D", plan.branch], config.repositoryRoot);
    },
  };
}

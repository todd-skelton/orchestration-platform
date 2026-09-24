import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DeliveryBlocked } from "../scripts/dogfood/delivery.mjs";
import { acceptedReviewG0 } from "../scripts/dogfood/delivery-adapter.mjs";
import { parseRoutingMarker } from "../scripts/dogfood/routing.mjs";
import { validateOpsAdmission } from "../scripts/dogfood/repository-adapter.mjs";

const EXPECTED_REPOSITORY = "chase-sets/chase-sets";
const runFile = promisify(execFile);
const DEPLOY_WORKFLOW = "platform-production.yml";
const DEPLOY_JOB = "Deploy Staging";
const DIGEST_STEP = "Verify immutable active release image";
const DEPLOY_WINDOW_MS = 45 * 60_000;
const POLL_MS = 30_000;
const LANE_RULES =
  "Lane mode applies. The loop owns publishing, landing, and deploy verification. The worker finishes with the JSON report required by the prompt.";

const MILESTONES_QUERY = `
query($owner:String!, $name:String!, $after:String) {
  repository(owner:$owner, name:$name) {
    milestones(first:100, after:$after, states:[OPEN]) {
      pageInfo { hasNextPage endCursor }
      nodes { id number title description state }
    }
  }
}`;

const ISSUES_QUERY = `
query($owner:String!, $name:String!, $after:String) {
  repository(owner:$owner, name:$name) {
    issues(first:100, after:$after, states:[OPEN]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number title body state
        issueType { name }
        milestone { id number title description state }
        labels(first:100) { pageInfo { hasNextPage } nodes { name } }
        blockedBy(first:100) {
          pageInfo { hasNextPage }
          nodes { number state }
        }
      }
    }
  }
}`;

const ISSUE_CONTEXT_QUERY = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    issue(number:$number) {
      number title body
      milestone { number }
      labels(first:100) { pageInfo { hasNextPage } nodes { name } }
    }
  }
}`;

function requireRepository(repository) {
  if (repository !== EXPECTED_REPOSITORY) throw new Error("wrong-chase-sets-repository");
}

async function gh(args, repository = EXPECTED_REPOSITORY) {
  return (
    await runFile("gh", [...args, "--repo", repository], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();
}

async function graphqlPage(query, owner, name, after, number) {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
  ];
  if (after) args.push("-F", `after=${after}`);
  if (number !== undefined) args.push("-F", `number=${number}`);
  const response = JSON.parse(
    (
      await runFile("gh", args, {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout,
  );
  if (response.errors) throw new Error("incomplete-chase-sets-authority");
  return response;
}

async function connection(query, field, repository) {
  const [owner, name] = repository.split("/");
  const nodes = [];
  let after;
  do {
    const response = await graphqlPage(query, owner, name, after);
    const page = response?.data?.repository?.[field];
    if (!Array.isArray(page?.nodes) || typeof page?.pageInfo?.hasNextPage !== "boolean")
      throw new Error("malformed-chase-sets-authority");
    nodes.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
    if (page.pageInfo.hasNextPage && !after) throw new Error("malformed-chase-sets-authority");
  } while (after);
  return nodes;
}

async function readers(executorRoot) {
  const scripts = resolve(executorRoot, "scripts");
  const [dispatch, milestone, backlog] = await Promise.all([
    import(pathToFileURL(resolve(scripts, "dispatch-window.mjs")).href),
    import(pathToFileURL(resolve(scripts, "milestone-policy.mjs")).href),
    import(pathToFileURL(resolve(scripts, "backlog-classify.mjs")).href),
  ]);
  if (
    typeof dispatch.derivePullWindow !== "function" ||
    typeof dispatch.isRunnableRefined !== "function" ||
    typeof milestone.isExecutableOutcome !== "function" ||
    typeof backlog.classified !== "function"
  )
    throw new Error("invalid-chase-sets-readers");
  return { ...dispatch, ...milestone, ...backlog };
}

async function authority(repository, executorRoot, targetMilestone) {
  requireRepository(repository);
  const [milestoneRows, issueRows, product] = await Promise.all([
    connection(MILESTONES_QUERY, "milestones", repository),
    connection(ISSUES_QUERY, "issues", repository),
    readers(executorRoot),
  ]);
  const milestones = milestoneRows.map((row) => ({ ...row, state: row.state.toLowerCase() }));
  const milestoneById = new Map(milestones.map((row) => [row.id, row]));
  const issues = issueRows.map((row) => {
    if (
      row.labels?.pageInfo?.hasNextPage !== false ||
      row.blockedBy?.pageInfo?.hasNextPage !== false
    )
      throw new Error("incomplete-chase-sets-authority");
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      body: row.body,
      state: row.state.toLowerCase(),
      issueTypeName: row.issueType?.name ?? null,
      milestone: row.milestone ? milestoneById.get(row.milestone.id) : null,
      labels: row.labels.nodes,
      blockedBy: row.blockedBy.nodes.map((blocker) => ({
        ...blocker,
        state: blocker.state.toLowerCase(),
      })),
    };
  });
  const window = product.derivePullWindow({
    milestones:
      targetMilestone === undefined
        ? milestones
        : milestones.filter((milestone) => milestone.number === targetMilestone),
    issues,
  })[0];
  return { product, milestones, issues, window };
}

function priority(issue) {
  for (let value = 0; value <= 3; value += 1)
    if (issue.labels.some((label) => label.name.toLowerCase() === `priority:p${value}`))
      return value;
  return 4;
}

function isOps(issue) {
  return issue.labels.some((label) => label.name.toLowerCase() === "kind:ops");
}

function opsAdmitted(issue, targetMilestone, opsAdmission) {
  return opsAdmission?.issueNumber === issue.number && issue.milestone?.number === targetMilestone;
}

function runnable(issue, snapshot, targetMilestone, opsAdmission) {
  return (
    snapshot.window &&
    issue.milestone?.id === snapshot.window.id &&
    snapshot.product.isRunnableRefined(issue) &&
    !issue.labels.some((label) => label.name.toLowerCase().startsWith("status:needs-")) &&
    (!isOps(issue) || opsAdmitted(issue, targetMilestone, opsAdmission))
  );
}

function candidatesFromAuthority(snapshot, targetMilestone, opsAdmission) {
  if (!snapshot.window) return [];
  return snapshot.issues
    .filter((issue) => runnable(issue, snapshot, targetMilestone, opsAdmission))
    .sort((left, right) => priority(left) - priority(right) || left.number - right.number)
    .flatMap((issue) => {
      try {
        const routing = parseRoutingMarker(issue.body);
        return [{ key: `cs-${issue.number}`, number: issue.number, routing }];
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({ status: "not-runnable", issue: issue.number, ...(targetMilestone === undefined ? {} : { target: targetMilestone }), reason: error.reason })}\n`,
        );
        return [];
      }
    });
}

export async function selectCandidates({
  repository,
  executorRoot,
  targetMilestone,
  opsAdmission,
}) {
  validateOpsAdmission({ repository, targetMilestone, opsAdmission });
  try {
    const snapshot = await authority(repository, executorRoot, targetMilestone);
    return candidatesFromAuthority(snapshot, targetMilestone, opsAdmission);
  } catch {
    throw new DeliveryBlocked(
      "issue-observation-unavailable",
      `Issue #${opsAdmission?.issueNumber ?? "none"}; target ${targetMilestone ?? "none"}; authority-unavailable.`,
    );
  }
}

function listItems(section) {
  const items = [];
  let current;
  for (const line of section.split(/\r?\n/)) {
    const item = /^\s*(?:[-*+] |\d+[.)] )(.+)$/.exec(line);
    if (item) {
      if (current) items.push(current);
      current = item[1].replace(/^\[[ xX]\]\s*/, "").trim();
    } else if (current && /^\s+\S/.test(line)) current += `\n${line.trim()}`;
  }
  if (current) items.push(current);
  return items;
}

export async function issueContext({
  repository,
  key,
  number,
  executorRoot,
  targetMilestone,
  opsAdmission,
}) {
  validateOpsAdmission({ repository, targetMilestone, opsAdmission });
  requireRepository(repository);
  if (key !== `cs-${number}`) throw new Error("wrong-chase-sets-issue");
  let row;
  try {
    const [owner, name] = repository.split("/");
    row = (await graphqlPage(ISSUE_CONTEXT_QUERY, owner, name, undefined, number))?.data?.repository
      ?.issue;
  } catch {
    throw new DeliveryBlocked(
      "issue-observation-unavailable",
      `Issue #${number}; target ${targetMilestone ?? "none"}; context-unavailable.`,
    );
  }
  if (row?.number !== number || typeof row.title !== "string" || typeof row.body !== "string")
    throw new Error("malformed-chase-sets-issue");
  if (targetMilestone !== undefined && row.milestone?.number !== targetMilestone)
    throw new DeliveryBlocked(
      "selected-milestone-mismatch",
      `Issue #${number} belongs to milestone ${row.milestone?.number ?? "none"}, outside target milestone ${targetMilestone}. Preserve the saved cycle and scope before restarting.`,
    );
  if (row.labels?.pageInfo?.hasNextPage !== false || !Array.isArray(row.labels?.nodes))
    throw new DeliveryBlocked(
      "selected-ops-not-runnable",
      `Issue #${number}; target ${targetMilestone ?? "none"}; incomplete-labels.`,
    );
  row = { ...row, labels: row.labels.nodes };
  if (isOps(row)) {
    const refuse = (reason, detail) =>
      new DeliveryBlocked(
        reason,
        `Issue #${number}; target ${targetMilestone ?? "none"}; ${detail}.`,
      );
    if (!opsAdmitted(row, targetMilestone, opsAdmission))
      throw refuse("selected-ops-not-admitted", "admission-required");
    let current;
    let eligible;
    try {
      const snapshot = await authority(repository, executorRoot, targetMilestone);
      current = snapshot.issues.find((issue) => issue.number === number);
      eligible = current && runnable(current, snapshot, targetMilestone, opsAdmission);
    } catch {
      throw refuse("selected-ops-not-runnable", "authority-unavailable");
    }
    if (current?.milestone && current.milestone.number !== targetMilestone)
      throw refuse("selected-milestone-mismatch", "milestone-changed");
    if (!eligible) throw refuse("selected-ops-not-runnable", "eligibility-changed");
    try {
      parseRoutingMarker(current.body);
    } catch (error) {
      throw refuse("selected-ops-not-runnable", error.reason);
    }
    row = current;
  }
  const heading = /^#{1,6}\s+Acceptance(?: Criteria)?\s*$/im.exec(row.body);
  const routing = parseRoutingMarker(row.body);
  const section = heading
    ? row.body
        .slice(heading.index + heading[0].length)
        .split(/^#{1,6}\s+/m, 1)[0]
        .trim()
    : "";
  const acceptanceCriteria = listItems(section);
  let deliverySkill;
  try {
    deliverySkill = await readFile(
      resolve(executorRoot, ".agents/skills/delivery/SKILL.md"),
      "utf8",
    );
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      throw new DeliveryBlocked("missing-chase-sets-delivery-skill");
    throw error;
  }
  const productRules = await readFile(resolve(executorRoot, "AGENTS.md"), "utf8");
  return {
    title: row.title,
    routing,
    body: row.body,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : [row.body],
    rules: `${LANE_RULES}\n\n${productRules.trimEnd()}\n\n${deliverySkill}`,
  };
}

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
}

export function branchName({ number, title, attempt }) {
  const value = slug(title);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    !value ||
    !Number.isSafeInteger(attempt) ||
    attempt <= 0
  )
    throw new Error("unsupported-chase-sets-branch");
  return `codex/${number}-${value}-g${attempt}`;
}

export function requiredChecks({ repository }) {
  requireRepository(repository);
  return ["PR Required"];
}

export function localGates({ repository }) {
  requireRepository(repository);
  return ["verify:static:scoped", "typecheck"];
}

export async function park({ repository, number }) {
  requireRepository(repository);
  await gh(["issue", "edit", String(number), "--add-label", "status:needs-replan"], repository);
  return "remove the `status:needs-replan` label after acting on the note";
}

function policy(config) {
  requireRepository(config.repository);
  const value = config.policy;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 4 ||
    value.key !== `cs-${value.number}` ||
    !Number.isSafeInteger(value.number) ||
    value.number <= 0 ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    typeof value.sourceBranch !== "string" ||
    !new RegExp(`^codex/${value.number}-[a-z0-9-]+-g[1-9][0-9]*$`).test(value.sourceBranch) ||
    config.issue !== `https://github.com/${EXPECTED_REPOSITORY}/issues/${value.number}` ||
    config.requiredChecks?.length !== 1 ||
    config.requiredChecks[0] !== "PR Required"
  )
    throw new DeliveryBlocked("unsupported-chase-sets-delivery-policy");
  return value;
}

function describeLineChanges({ added, deleted }) {
  const net = added - deleted;
  return `${added} added, ${deleted} deleted, net ${net > 0 ? "+" : ""}${net}`;
}

async function lineChanges(config, gitExecutable) {
  const stdout = (
    await runFile(
      gitExecutable,
      [
        "-C",
        config.worktree,
        "diff",
        "--numstat",
        "--no-renames",
        `refs/remotes/origin/main...${config.candidateHead}`,
      ],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
  ).stdout;
  const changes = {
    total: { added: 0, deleted: 0 },
    scripts: { added: 0, deleted: 0 },
    test: { added: 0, deleted: 0 },
  };
  for (const row of stdout.trim().split(/\r?\n/)) {
    if (!row) continue;
    const [addedText, deletedText, ...pathParts] = row.split("\t");
    if (addedText === "-" && deletedText === "-") continue;
    const added = Number(addedText);
    const deleted = Number(deletedText);
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(deleted))
      throw new DeliveryBlocked("chase-sets-publication-diff-unavailable");
    changes.total.added += added;
    changes.total.deleted += deleted;
    const path = pathParts.join("\t");
    const group = path.startsWith("scripts/")
      ? changes.scripts
      : path.startsWith("test/")
        ? changes.test
        : undefined;
    if (group) {
      group.added += added;
      group.deleted += deleted;
    }
  }
  return changes;
}

export async function pullRequest({ config, gitExecutable }) {
  const value = policy(config);
  let changes;
  try {
    changes = await lineChanges(config, gitExecutable);
  } catch (error) {
    if (error instanceof DeliveryBlocked) throw error;
    throw new DeliveryBlocked("chase-sets-publication-diff-unavailable");
  }
  return {
    sourceBranch: value.sourceBranch,
    baseBranch: "main",
    title: value.title,
    body: `Closes #${value.number}\n\nLine changes:\n- Total: ${describeLineChanges(changes.total)}\n- Source (\`scripts/\`): ${describeLineChanges(changes.scripts)}\n- Tests (\`test/\`): ${describeLineChanges(changes.test)}\n\nReview G0: ${await acceptedReviewG0(config)}`,
    draft: true,
  };
}

export function mergeMethod({ config }) {
  policy(config);
  return { method: "queue" };
}

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function deployObservation(repository, mergeCommit) {
  const runs = await workflowRuns(repository, `&head_sha=${mergeCommit}`);
  if (!runs.length) return { status: "pending" };
  // Only the newest owning run can decide this commit, including reruns.
  const run = await deploymentRun(repository, runs[0]);
  evidence(run.head_sha === mergeCommit, "release commit mismatch");
  if (run.status !== "completed") return { status: "pending" };
  if (run.conclusion !== "success") return { status: "failed" };
  const jobs = await deploymentJobs(repository, run);
  const staging = named(jobs, DEPLOY_JOB);
  if (staging.status !== "completed") return { status: "pending" };
  if (staging.conclusion !== "skipped") {
    const verified = staging.conclusion === "success" && successfulStep(staging, DIGEST_STEP);
    await unchangedRun(repository, run);
    return { status: verified ? "verified" : "failed" };
  }
  const resolver = named(jobs, "Resolve Release");
  evidence(
    resolver.status === "completed" && resolver.conclusion === "success",
    "resolver job did not succeed",
  );
  const step = named(resolver.steps, "Resolve deployment scope");
  evidence(successfulStep(resolver, step.name), "scope step did not succeed");
  const output = await stepOutput(
    repository,
    resolver,
    step,
    "node ./scripts/release-deployment-scope.mjs",
  );
  evidence(
    output.command.includes(`--release-commit "${mergeCommit}"`),
    "scope release commit mismatch",
  );
  const text = output.lines.map((line) => line.text).join("\n");
  const start = text.search(/^\s*\{/m);
  evidence(start >= 0, "scope resolver JSON missing");
  // JSON.parse rejects truncation, duplicate results and trailing unrelated output.
  const scope = JSON.parse(text.slice(start));
  // The owning resolver emits JSON.stringify(output, null, 2). Requiring that
  // shape also rejects duplicate keys that JSON.parse would silently collapse.
  evidence(text.slice(start) === JSON.stringify(scope, null, 2), "ambiguous scope resolver JSON");
  evidence(scope.deploy === "false" || scope.deploy === "true", "scope deploy value missing");
  if (scope.deploy === "true") return { status: "failed" };
  const changedFiles = JSON.parse(scope.changed_files_json);
  evidence(
    Array.isArray(changedFiles) &&
      changedFiles.every((path) => typeof path === "string" && path.length),
    "scope changed files missing",
  );
  const skipped = [DEPLOY_JOB, "Build Release Image", "Deploy Production"].map((name) => {
    const job = named(jobs, name);
    evidence(
      job.status === "completed" && job.conclusion === "skipped",
      `inconsistent no-deploy job: ${name}`,
    );
    return { id: job.id, name: job.name };
  });
  const latestDeployment = await latestStagingDeployment(repository);
  await unchangedRun(repository, run);
  // Recheck selection as well as attempt: a newly dispatched run supersedes this one.
  const current = await workflowRuns(repository, `&head_sha=${mergeCommit}`);
  evidence(
    current[0]?.id === run.id &&
      current[0]?.run_attempt === run.run_attempt &&
      current[0]?.status === run.status &&
      current[0]?.conclusion === run.conclusion,
    "newer release run or attempt appeared",
  );
  return {
    status: "not-required",
    repository,
    mergeCommit,
    workflow: run.path,
    workflowId: run.workflow_id,
    run: run.id,
    attempt: run.run_attempt,
    job: resolver.id,
    step: { number: step.number, name: step.name },
    reason: "scoped",
    scope,
    changedFiles,
    skipped,
    deploymentLeg: "unexercised",
    latestDeployment,
    accounting: "Historical workflow evidence; live production/staging health remains host-owned.",
    observedAt: new Date().toISOString(),
  };
}

function evidence(condition, diagnostic) {
  if (!condition) throw new Error(diagnostic);
}

async function actions(repository, path, raw = false) {
  const { stdout } = await runFile("gh", ["api", `repos/${repository}/actions/${path}`], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return raw ? stdout : JSON.parse(stdout);
}

async function workflowRuns(repository, query = "", page = 1) {
  const result = await actions(
    repository,
    `workflows/${DEPLOY_WORKFLOW}/runs?per_page=100&page=${page}${query}`,
  );
  evidence(
    Array.isArray(result.workflow_runs) &&
      Number.isSafeInteger(result.total_count) &&
      result.total_count >= 0 &&
      result.workflow_runs.length ===
        Math.min(100, Math.max(0, result.total_count - (page - 1) * 100)),
    "workflow run census unavailable or incomplete",
  );
  return result.workflow_runs.sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  );
}

async function deploymentRun(repository, selected) {
  const run = await actions(repository, `runs/${selected.id}`);
  evidence(
    run.id === selected.id &&
      run.workflow_id === selected.workflow_id &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      run.path === `.github/workflows/${DEPLOY_WORKFLOW}` &&
      run.head_sha === selected.head_sha &&
      /^[a-f0-9]{40}$/.test(run.head_sha) &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0,
    "owning workflow/run identity mismatch",
  );
  return run;
}

async function unchangedRun(repository, run) {
  const current = await deploymentRun(repository, run);
  evidence(
    current.run_attempt === run.run_attempt &&
      current.status === run.status &&
      current.conclusion === run.conclusion,
    "workflow attempt changed while reading evidence",
  );
}

async function deploymentJobs(repository, run) {
  const result = await actions(
    repository,
    `runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  evidence(
    Array.isArray(result.jobs) &&
      result.jobs.length === result.total_count &&
      new Set(result.jobs.map((job) => job.id)).size === result.jobs.length &&
      result.jobs.every(
        (job) =>
          job.run_id === run.id &&
          job.run_attempt === run.run_attempt &&
          job.head_sha === run.head_sha,
      ),
    "incomplete or mixed-attempt deployment jobs",
  );
  return result.jobs;
}

function named(values, name) {
  const matches = values?.filter((value) => value.name === name);
  evidence(matches?.length === 1, `missing or duplicate ${name}`);
  return matches[0];
}

function successfulStep(job, name) {
  const steps = job.steps?.filter((step) => step.name === name);
  return (
    steps?.length === 1 && steps[0].status === "completed" && steps[0].conclusion === "success"
  );
}

// Raw Actions job logs delimit each command group before its output. Step times
// have only second precision, so timestamps alone cannot separate adjacent steps.
async function stepOutput(repository, job, step, command) {
  const raw = await actions(repository, `jobs/${job.id}/logs`, true);
  const lines = raw
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z) (.*)\r?$/.exec(line);
      // Provider logs include a BOM and unprefixed multiline output in other
      // steps. Only the selected command's output must bind to its step times.
      return { at: match?.[1], text: (match?.[2] ?? line).replace(/\x1b\[[0-9;]*m/g, "") };
    });
  const groups = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].text.startsWith("##[group]")) continue;
    const end = lines.findIndex((line, next) => next > index && line.text.startsWith("##[group]"));
    const group = lines.slice(index, end < 0 ? undefined : end);
    const boundary = group.findIndex((line) => line.text === "##[endgroup]");
    const header = group
      .slice(0, boundary)
      .map((line) => line.text)
      .join("\n");
    if (boundary < 0 || !header.includes(command) || !group[0].at) continue;
    if (
      group[0].at.slice(0, 19) < step.started_at?.slice(0, 19) ||
      group[0].at.slice(0, 19) > step.completed_at?.slice(0, 19)
    )
      continue;
    const output = group.slice(boundary + 1);
    evidence(
      output.length &&
        output.every(
          (line) =>
            line.at &&
            line.at.slice(0, 19) >= step.started_at?.slice(0, 19) &&
            line.at.slice(0, 19) <= step.completed_at?.slice(0, 19),
        ),
      "step log outside execution interval",
    );
    groups.push({ command: header, lines: output });
  }
  evidence(groups.length === 1, `missing or ambiguous step log: ${step.name}`);
  return groups[0];
}

async function latestStagingDeployment(repository) {
  let latest;
  for (let page = 1; ; page++) {
    const runs = await workflowRuns(repository, "", page);
    // Creation order is not execution order: an older run can be rerun today.
    // Read the census pages, but only acquire jobs that could supersede the
    // newest completed staging job already found.
    for (const selected of [...runs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      evidence(
        Number.isFinite(Date.parse(selected.updated_at)),
        "historical run timestamp missing",
      );
      if (latest && selected.updated_at < latest.job.completed_at) continue;
      const run = await deploymentRun(repository, selected);
      const jobs = await deploymentJobs(repository, run);
      const staging = jobs.filter((job) => job.name === DEPLOY_JOB);
      evidence(staging.length <= 1, "duplicate historical staging job");
      const job = staging[0];
      if (!job) {
        evidence(run.status !== "completed", "historical staging job missing");
        continue;
      }
      if (job.conclusion !== "success") continue;
      evidence(
        Number.isFinite(Date.parse(job.completed_at)),
        "historical staging timestamp missing",
      );
      if (latest && job.completed_at < latest.job.completed_at) continue;
      evidence(
        !latest || job.completed_at !== latest.job.completed_at,
        "ambiguous latest staging deployment",
      );
      evidence(
        job.status === "completed" && successfulStep(job, DIGEST_STEP),
        "latest staging image verification unavailable",
      );
      latest = { run, job };
    }
    if (runs.length < 100) break;
  }
  evidence(latest, "latest successful staging deployment unavailable");
  const { run, job } = latest;
  const step = named(job.steps, DIGEST_STEP);
  const output = await stepOutput(repository, job, step, "docker buildx imagetools inspect");
  const matches = output.lines.flatMap((line) => {
    const match =
      /^Verified immutable active release (\S+):([a-f0-9]{40})@(sha256:[a-f0-9]{64})\.$/.exec(
        line.text,
      );
    return match
      ? [{ image: match[1], commit: match[2], digest: match[3], verifiedAt: line.at }]
      : [];
  });
  evidence(
    matches.length === 1 && matches[0].commit === run.head_sha,
    "latest staging executed digest missing or mismatched",
  );
  await unchangedRun(repository, run);
  return {
    ...matches[0],
    workflow: run.path,
    workflowId: run.workflow_id,
    run: run.id,
    attempt: run.run_attempt,
    job: job.id,
    step: step.number,
    completedAt: job.completed_at,
  };
}

export async function afterMerge({ config, delivery }) {
  policy(config);
  const deadline = Date.now() + DEPLOY_WINDOW_MS;
  let diagnostic = "owning deployment workflow is pending or absent";
  do {
    try {
      const observation = await deployObservation(config.repository, delivery.mergeCommit);
      if (observation.status === "verified") return;
      if (observation.status === "not-required") {
        process.stderr.write(`${JSON.stringify(observation)}\n`);
        return;
      }
      if (observation.status === "failed") throw new DeliveryBlocked("deploy-not-verified");
    } catch (error) {
      if (error instanceof DeliveryBlocked) throw error;
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) break;
    await pause(POLL_MS);
  } while (true);
  throw new DeliveryBlocked("deploy-not-verified", diagnostic);
}

export async function dryRun(executorRoot = process.env.CHASE_SETS_ROOT) {
  if (!executorRoot) throw new Error("CHASE_SETS_ROOT is required");
  const snapshot = await authority(EXPECTED_REPOSITORY, executorRoot);
  const selected = candidatesFromAuthority(snapshot)[0];
  if (!snapshot.window || !selected) throw new Error("no-runnable-chase-sets-issue");
  const issue = snapshot.issues.find((candidate) => candidate.number === selected.number);
  const branch = branchName({ ...selected, title: issue.title, attempt: 1 });
  return {
    milestone: snapshot.window,
    issue: { key: selected.key, number: selected.number, title: issue.title },
    branch,
    pullRequestTitle: issue.title,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== "--dry-run")
    throw new Error("usage: node adapters/chase-sets.mjs --dry-run");
  process.stdout.write(`${JSON.stringify(await dryRun(), null, 2)}\n`);
}

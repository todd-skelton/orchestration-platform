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
  const runs = JSON.parse(
    await gh(
      [
        "run",
        "list",
        "--workflow",
        DEPLOY_WORKFLOW,
        "--commit",
        mergeCommit,
        "--limit",
        "100",
        "--json",
        "databaseId,headSha,status,conclusion,createdAt",
      ],
      repository,
    ),
  );
  if (!Array.isArray(runs)) throw new DeliveryBlocked("deploy-not-verified");
  for (const run of [...runs].sort((left, right) =>
    String(right.createdAt).localeCompare(String(left.createdAt)),
  )) {
    if (run.headSha !== mergeCommit) continue;
    const viewed = JSON.parse(
      await gh(["run", "view", String(run.databaseId), "--json", "jobs"], repository),
    );
    const job = viewed?.jobs?.find(
      (candidate) => candidate.name === DEPLOY_JOB && candidate.conclusion !== "skipped",
    );
    if (!job) continue;
    if (run.status !== "completed" || job.status !== "completed") return "pending";
    const digest = job.steps?.find((step) => step.name === DIGEST_STEP);
    return run.conclusion === "success" &&
      job.conclusion === "success" &&
      digest?.conclusion === "success"
      ? "verified"
      : "failed";
  }
  return "pending";
}

export async function afterMerge({ config, delivery }) {
  policy(config);
  const deadline = Date.now() + DEPLOY_WINDOW_MS;
  do {
    try {
      const observation = await deployObservation(config.repository, delivery.mergeCommit);
      if (observation === "verified") return;
      if (observation === "failed") throw new DeliveryBlocked("deploy-not-verified");
    } catch (error) {
      if (error instanceof DeliveryBlocked) throw error;
    }
    if (Date.now() >= deadline) break;
    await pause(POLL_MS);
  } while (true);
  throw new DeliveryBlocked("deploy-not-verified");
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

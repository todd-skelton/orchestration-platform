import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AcceptedReplan, PreReviewEvidence } from "../../../scripts/dogfood/continuation.js";
import type { PublicationEvidence } from "../../../scripts/dogfood/delivery.js";
import type { GithubDeliveryCommands } from "../../../scripts/dogfood/delivery-adapter.js";

// ISS-246: deliberately synthetic Actions/PR/issue identities, never live evidence.
export function executedHostedFixture(
  publication: PublicationEvidence,
  base: string,
  number: number,
  receipt: string,
) {
  const repository = publication.repository;
  const repo = { full_name: repository, id: 246 };
  const run = {
    id: 24601,
    workflow_id: 246,
    run_number: 1,
    run_attempt: 1,
    path: ".github/workflows/bootstrap.yml",
    event: "pull_request",
    head_sha: publication.head,
    head_branch: publication.sourceBranch,
    repository: repo,
    head_repository: repo,
    status: "completed",
    conclusion: "failure",
    pull_requests: [
      {
        number: publication.number,
        url: `https://api.github.com/repos/${repository}/pulls/${publication.number}`,
        head: { ref: publication.sourceBranch, sha: publication.head, repo },
        base: { ref: "main", repo },
      },
    ],
  };
  const names = [
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest",
    "Windows tests / remainder",
  ];
  const jobs = names.map((name, i) => ({
    id: 24610 + i,
    run_id: run.id,
    run_attempt: 1,
    head_sha: publication.head,
    name,
    html_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${24610 + i}`,
    status: "completed",
    conclusion: [1, 3].includes(i) ? "failure" : "success",
    runner_id: 246,
    steps: [{ name: "SYNTHETIC executed test step" }],
  }));
  const greenJobs = jobs.map((job, i) =>
    [1, 3].includes(i)
      ? {
          ...job,
          id: job.id + 10,
          run_attempt: 2,
          html_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${job.id + 10}`,
          conclusion: "success",
        }
      : { ...job },
  );
  const controlJobs = jobs.map((job) => ({
    ...job,
    run_id: 24602,
    head_sha: base,
    conclusion: "success",
    html_url: `https://github.com/${repository}/actions/runs/24602/job/${job.id}`,
  }));
  const data = {
    failed: run,
    green: { ...run, run_attempt: 2, conclusion: "success" },
    control: {
      ...run,
      id: 24602,
      head_sha: base,
      event: "push",
      head_branch: "main",
      conclusion: "success",
      pull_requests: [],
    },
    jobs,
    greenJobs,
    controlJobs,
    pr: {
      number: publication.number,
      url: publication.url,
      state: "OPEN",
      isDraft: true,
      headRefOid: publication.head,
      headRefName: publication.sourceBranch,
      baseRefName: "main",
    },
    issue: {
      number,
      url: `https://github.com/${repository}/issues/${number}`,
      state: "OPEN",
      comments: [{ body: receipt }],
    },
  };
  const calls: string[][] = [];
  const commands: GithubDeliveryCommands = {
    async gh() {
      throw new Error("ISS-246 no mutation or log command admitted");
    },
    async ghJson(_config, args) {
      calls.push(args);
      if (args[0] === "issue") return structuredClone(data.issue);
      if (args[0] === "pr") return structuredClone(data.pr);
      const path = args[1]!;
      if (path.includes("/jobs?")) {
        const rows = path.includes("/24602/")
          ? data.controlJobs
          : path.includes("/attempts/1/")
            ? data.jobs
            : data.greenJobs;
        return structuredClone([{ total_count: rows.length, jobs: rows }]);
      }
      if (path.endsWith("/attempts/1")) return structuredClone(data.failed);
      if (path.endsWith("/attempts/2")) return structuredClone(data.green);
      if (path.endsWith("/24602")) return structuredClone(data.control);
      throw new Error(`ISS-246 unexpected read ${path}`);
    },
  };
  return { data, commands, calls, names };
}

export const ACCEPTED_REPLAN = {
  run: "m2-jpeg-corrective-20260914T1402",
  priorRun: "m2-jpeg-20260914",
  slug: "cs-7766-replan-8014-attempt-5",
};
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
export function replanPacket(
  stateRoot: string,
  head = "b".repeat(40),
  history: unknown[] = [],
): AcceptedReplan {
  return {
    schemaVersion: "dogfood-accepted-replan/v1",
    repository: "chase-sets/chase-sets",
    issueKey: "cs-7766",
    issueUrl: "https://github.com/chase-sets/chase-sets/issues/7766",
    priorRun: ACCEPTED_REPLAN.priorRun,
    priorAttemptDirectory: resolve(stateRoot, ACCEPTED_REPLAN.priorRun, "cs-7766-attempt-4"),
    priorAbsoluteAttempt: 4,
    priorHistoryDigest: hash(JSON.stringify(history)),
    candidateHead: head,
    targetRun: ACCEPTED_REPLAN.run,
    attemptSlug: ACCEPTED_REPLAN.slug,
    nextAbsoluteAttempt: 5,
    absoluteCeiling: 5,
    authorityUrl: "https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5665159522",
    scope: "Correct the route-collision inventory failure only",
    allowedPaths: ["jpeg.txt"],
    publication: {
      number: 8005,
      url: "https://github.com/chase-sets/chase-sets/pull/8005",
      head,
      sourceBranch: "codex/7766-jpeg-g4",
    },
    preReviewEvidence: null,
  };
}
export function evidenceDescriptor(root: string): PreReviewEvidence {
  return {
    receiptSchema: "dogfood-host-verification/v1",
    workspace: "Ordering",
    gate: "real-postgresql",
    command: { executable: "pnpm", args: ["test:ordering"] },
    bundle: {
      receipt: resolve(root, "receipt.json"),
      runMetadata: resolve(root, "run.json"),
      preflightLog: resolve(root, "preflight.log"),
      verifierLog: resolve(root, "verifier.log"),
    },
    files: 18,
    tests: 386,
    skips: 0,
    requiredCases: [
      "purchase-limit-source-retry-concurrency day +0",
      "purchase-limit-source-retry-concurrency day +1",
    ],
  };
}
export async function writeEvidence(
  descriptor: PreReviewEvidence,
  repository: string,
  head: string,
  changes: Record<string, unknown> = {},
  mutate?: (receipt: Record<string, any>) => void,
) {
  const result = {
    repository,
    head,
    workspace: descriptor.workspace,
    gate: descriptor.gate,
    command: descriptor.command,
    runId: "host-run-1",
    exitCode: 0,
    files: descriptor.files,
    tests: descriptor.tests,
    skips: 0,
    cases: descriptor.requiredCases,
    ...changes,
  };
  const artifacts = {
    runMetadata: JSON.stringify({ schemaVersion: "dogfood-host-verification-run/v1", ...result }),
    preflightLog: "PostgreSQL preflight completed\n",
    verifierLog: "Complete Ordering execution\n",
  };
  const receipt = {
    schemaVersion: descriptor.receiptSchema,
    ...result,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, bytes]) => [name, hash(bytes)]),
    ),
  };
  mutate?.(receipt);
  const bundle = { receipt: JSON.stringify(receipt), ...artifacts };
  for (const name of Object.keys(bundle) as (keyof typeof bundle)[]) {
    const path = descriptor.bundle[name];
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bundle[name]);
  }
}

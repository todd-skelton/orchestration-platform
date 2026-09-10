import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
// @ts-expect-error Node 24 executes the private TypeScript composition directly.
import { step } from "./flow.ts";
import type { Adapter, Attempt, Config, Role } from "./flow.js";
import { ReviewRecoveryBlocked, selectedSourceReview } from "./review-recovery-adapter.mjs";
import type { RepairAdapter } from "./repair.mjs";
import {
  RepairBlocked,
  type RepairConfig,
  type RepairHandoff,
  type SourceReviewArtifacts,
  validateRepairConfig,
} from "./repair-policy.mjs";

const exec = promisify(execFile);
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const FLOW_REFUSALS = new Set([
  "author-launch-identity-unknown-reconcile",
  "reviewer-launch-identity-unknown-reconcile",
  "commit-result-unknown-reconcile",
  "dirty-author",
  "dirty-reviewer",
  "dirty-pilot",
  "changed-base",
  "candidate-head-moved",
  "author-head-moved",
  "author-wrong-head",
  "reviewer-wrong-head",
  "missing-candidate-commit",
  "outside-footprint",
  "malformed-terminal",
  "invalid-attempt-identity",
  "author-is-reviewer",
  "reviewer-modified-worktree",
  "pilot-revision-moved",
  "author-failed",
  "reviewer-failed",
]);
export const validDogfoodReviewPath = (path: string) =>
  /^scripts\/dogfood\/.+\.(?:ts|mts|mjs)$/.test(path) ||
  /^test\/dogfood\/.+\.(?:ts|mts|mjs)$/.test(path) ||
  /^docs\/planning\/.+\.md$/.test(path) ||
  /^planning\/(?:drafts|pressure-tests)\/.+\.md$/.test(path) ||
  path === "planning/roadmap.json";

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new RepairBlocked(reason);
}
const paths = (output: string) => output.split("\0").filter(Boolean);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function outside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function assertBoundedRoots(config: RepairConfig) {
  const roots = await Promise.all(
    [
      config.controllerRoot,
      config.worktree,
      config.reviewWorktree,
      config.stateDirectory,
      config.sourceStateDirectory,
      ...(config.selectedReviewStateDirectory ? [config.selectedReviewStateDirectory] : []),
    ].map((path) => realpath(path)),
  );
  demand(
    new Set(roots).size === roots.length &&
      roots.every((root, index) =>
        roots.every((other, otherIndex) => index === otherIndex || outside(root, other)),
      ),
    "overlapping-repair-paths",
  );
}

async function assertLoadedController(config: RepairConfig) {
  validateRepairConfig(config);
  demand(config.sourcePaths.every(validDogfoodReviewPath), "incompatible-repair-template");
  try {
    const [loadedRoot, authorizedRoot] = await Promise.all([
      realpath(resolve(import.meta.dirname, "../..")),
      realpath(config.controllerRoot),
    ]);
    demand(loadedRoot === authorizedRoot, "controller-executor-mismatch");
  } catch (error) {
    if (error instanceof RepairBlocked) throw error;
    throw new RepairBlocked("controller-executor-unverified");
  }
}

async function sourcePromptContents(config: RepairConfig): Promise<[string, string]> {
  let root: string;
  let prompts: [string, string];
  try {
    root = await realpath(config.sourceStateDirectory);
    prompts = (await Promise.all(
      [config.authority.source.author.promptFile, config.authority.source.reviewer.promptFile].map(
        (path) => realpath(path),
      ),
    )) as [string, string];
  } catch {
    throw new RepairBlocked("source-prompt-unavailable");
  }
  demand(
    prompts.every((path) => !outside(root, path) && path !== root),
    "source-prompt-outside-source-state",
  );
  return Promise.all(prompts.map((path) => readFile(path, "utf8"))) as Promise<[string, string]>;
}

async function readJson(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new RepairBlocked(`missing-review-record:${name}`);
    throw new RepairBlocked(`malformed-review-record:${name}`);
  }
}

async function optionalJson(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RepairBlocked(`malformed-repair-record:${name}`);
  }
}

async function writeOnce(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(path, bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    demand((await readFile(path, "utf8")) === bytes, `conflicting-repair-record:${name}`);
  }
}

async function git(worktree: string, args: string[]) {
  try {
    return (
      await exec("git", ["-C", worktree, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout;
  } catch {
    throw new RepairBlocked("source-review-git-state-unknown");
  }
}

const lineCount = (text: string) => {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
};

async function loadArtifacts(
  config: RepairConfig,
  directory: string,
  base: string,
  selectedReviewStateDirectory?: string,
): Promise<SourceReviewArtifacts> {
  const [configRecord, candidate, authorAttempt] = await Promise.all([
    readJson(directory, "config"),
    readJson(directory, "candidate"),
    readJson(directory, "author-attempt"),
  ]);
  let reviewerAttempt: any;
  let terminal: any;
  try {
    ({ attempt: reviewerAttempt, terminal } = await selectedSourceReview(
      configRecord.config,
      selectedReviewStateDirectory ?? directory,
    ));
  } catch (error) {
    throw new RepairBlocked(
      error instanceof ReviewRecoveryBlocked ? error.reason : "selected-review-state-unknown",
    );
  }
  demand(candidate && /^[a-f0-9]{40}$/.test(candidate.head), "source-candidate-mismatch");
  const [sourceHead, reviewHead, sourceStatus, reviewStatus, changedOutput, presentOutput] =
    await Promise.all([
      git(config.worktree, ["rev-parse", "HEAD"]),
      git(config.reviewWorktree, ["rev-parse", "HEAD"]),
      git(config.worktree, ["status", "--porcelain"]),
      git(config.reviewWorktree, ["status", "--porcelain"]),
      git(config.worktree, ["diff", "--name-only", "--no-renames", "-z", base, candidate.head]),
      git(config.worktree, [
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=d",
        "-z",
        base,
        candidate.head,
      ]),
    ]);
  const changedFiles = paths(changedOutput);
  const present = paths(presentOutput).filter((path) => config.sourcePaths.includes(path));
  const entries = await Promise.all(
    present.map(
      async (path) =>
        [
          path,
          lineCount(await git(config.worktree, ["show", `${candidate.head}:${path}`])),
        ] as const,
    ),
  );
  return {
    configRecord,
    candidate,
    authorAttempt,
    reviewerAttempt,
    terminal,
    changedFiles,
    lineCounts: Object.fromEntries(entries),
    sourceHead: sourceHead.trim(),
    reviewHead: reviewHead.trim(),
    sourceClean: sourceStatus === "",
    reviewClean: reviewStatus === "",
  };
}

function flowConfig(config: RepairConfig): Config {
  return {
    owner: config.authority.controller,
    run: config.run,
    issue: config.issue,
    pilotRevision: config.controllerRevision,
    base: config.repairBase,
    worktree: config.worktree,
    reviewWorktree: config.reviewWorktree,
    stateDirectory: config.stateDirectory,
    allowedPaths: config.allowedPaths,
    repository: config.repository,
    requiredChecks: config.requiredChecks,
    author: config.author,
    reviewer: config.reviewer,
    adapter: config.adapter,
  };
}

const reviewLocationContract = (reviewPaths: string[]) =>
  `Only findings and notes in changed files drawn from these exact authorized review paths are admissible: ${JSON.stringify(reviewPaths)}. Each path must exist at the reviewed Git head and each line is a valid one-based line at that head.`;

export function sourceReviewerReportPrompt(
  reviewPaths: string[],
  scope: "complete" | "delta" = "complete",
  inheritance: {
    run: string;
    author: string;
    review: string;
    head: string;
    scope: "complete";
    complete: true;
  } | null = null,
) {
  const inherited =
    scope === "delta"
      ? `This authorized DELTA inherits completed independent sweep ${inheritance?.review} from run ${inheritance?.run} at comparison head ${inheritance?.head}. `
      : "";
  return (
    inherited +
    "The following closed completion contract supersedes the generic review summary instruction. " +
    "The final summary must be a JSON-encoded object with exactly the keys v, head, complete, scope, profile, g0, pairs, findings and notes. " +
    `Require v 2, the exact review head, boolean complete, scope "${scope}", profile "contract", g0 ["PASS"|"BLOCK_REPLAN","<evidence>"], and exactly twelve quality pairs. A complete result sets complete true. ` +
    "Pairs are ordered SCOPE, ROBUSTNESS, DEPTH, READABILITY, TESTS, OBSERVABILITY, SECURITY, PERFORMANCE, ROLLOUT, CONSISTENCY, EXPERIENCE, LANGUAGE. " +
    "Evidence is at most 140 characters per pair and 200 for G0. Findings are at most eight exact objects {file,line,severity,defect,verification}; notes are at most eight {file,line,remedy}. " +
    reviewLocationContract(reviewPaths) +
    " Total decoded summary is at most 2000 characters. Never truncate the JSON or drop a required field, finding or note. If complete evidence cannot fit that boundary, return FAIL with complete false; it remains incomplete and is never promoted to PASS. PASS requires complete true, G0 PASS, no findings and no BLOCK; a fixable FAIL requires G0 PASS, at least one finding and a bound BLOCK; notes never block."
  );
}

function reviewerReportPrompt(handoff: RepairHandoff) {
  return (
    `This is a DELTA review inheriting complete predecessor ${handoff.predecessorCompleteSweep}. ` +
    `Inspect only the prescribed remedies ${JSON.stringify(handoff.failedReview.findings)} and their direct callers; preserve all acceptance criteria and assertions.\n` +
    "The following closed completion contract supersedes the generic empty-summary PASS instruction. " +
    'The final summary must be a JSON-encoded string exactly {"v":2,"head":"<exact review head>","complete":true,"scope":"delta","profile":"contract","g0":["PASS"|"BLOCK_REPLAN","<evidence>"],"pairs":[["PASS"|"BLOCK"|"NOTE"|"NA","PASS"|"BLOCK"|"NOTE"|"NA","<evidence>"],...12],"findings":[],"notes":[]}. ' +
    "Pairs are ordered SCOPE, ROBUSTNESS, DEPTH, READABILITY, TESTS, OBSERVABILITY, SECURITY, PERFORMANCE, ROLLOUT, CONSISTENCY, EXPERIENCE, LANGUAGE. " +
    "Evidence is at most 140 characters per pair and 200 for G0. Findings are at most eight exact objects {file,line,severity,defect,verification}; notes are at most eight {file,line,remedy}. " +
    reviewLocationContract(handoff.sourcePaths) +
    " Total decoded summary is at most 2000 characters. PASS requires complete true, G0 PASS, no findings and no BLOCK; notes never block."
  );
}

function boundedAdapter(config: RepairConfig, handoff: RepairHandoff, native: Adapter): Adapter {
  return {
    ...native,
    async launch(role: Role, current: Config, prompt: string): Promise<Attempt> {
      const reservation = config.admission.reservations[role === "author" ? 0 : 1];
      const head =
        role === "author"
          ? config.repairBase
          : (await readJson(config.stateDirectory, "candidate")).head;
      const context = {
        schemaVersion: "dogfood-repair-launch-context/v1",
        run: config.run,
        role,
        ordinal: reservation.ordinal,
        head,
        model: current[role].model,
        effort: current[role].effort,
        predecessorReviewId: handoff.predecessorCompleteSweep,
      };
      await writeOnce(config.stateDirectory, `${role}-launch-context`, context);
      const suffix =
        role === "author"
          ? `Correct only these validated source findings: ${JSON.stringify(handoff.failedReview.findings)}. Start from corrective base ${handoff.correctiveBase}; the distinct delivery main base remains ${handoff.mainBase}. Preserve these acceptance criteria verbatim: ${JSON.stringify(handoff.acceptanceCriteria)}. Authorized exact review paths are ${JSON.stringify(handoff.sourcePaths)}. Repairs consume no implementation attempt. Author PASS uses an empty summary. On FAIL, use only a JSON-encoded summary {"v":1,"head":"${handoff.correctiveBase}","complete":true,"findings":[{"file":"<changed authorized review path>","line":1,"severity":"P1","defect":"<at most 350 characters>","verification":"<at most 200 characters>"}]}; at most eight findings and 2000 decoded characters. Use complete false if incomplete; never include raw output, environment data or prose.`
          : reviewerReportPrompt(handoff);
      const attempt = await native.launch(role, current, `${prompt}\n\n${suffix}\n`);
      demand(IDENTITY.test(attempt.id), "invalid-repair-participant-identity");
      demand(
        !config.history.some((participant) => participant.id === attempt.id),
        "reused-participant-identity",
      );
      if (role === "reviewer") {
        const author = await readJson(config.stateDirectory, "author-attempt");
        demand(author.id !== attempt.id, "author-is-delta-reviewer");
      }
      return attempt;
    },
  };
}

export function reviewedRepairAdapter(native: Adapter): RepairAdapter {
  return {
    async loadSourceReview(config) {
      await assertLoadedController(config);
      await assertBoundedRoots(config);
      const prompts = await sourcePromptContents(config);
      return {
        ...(await loadArtifacts(
          config,
          config.sourceStateDirectory,
          config.mainBase,
          config.selectedReviewStateDirectory,
        )),
        promptContents: prompts,
      };
    },
    async dispatch(config, handoff) {
      await assertLoadedController(config);
      await assertBoundedRoots(config);
      demand(!(await optionalJson(config.stateDirectory, "publication")), "repair-cannot-publish");
      try {
        return await step(
          flowConfig(config),
          boundedAdapter(config, handoff, native),
          config.controllerRoot,
        );
      } catch (error) {
        if (error instanceof RepairBlocked) throw error;
        const reason = error instanceof Error ? error.message : "";
        throw new RepairBlocked(FLOW_REFUSALS.has(reason) ? reason : "repair-flow-state-unknown");
      }
    },
    async loadDeltaReview(config) {
      const artifacts = await loadArtifacts(config, config.stateDirectory, config.repairBase);
      const launchContext = await readJson(config.stateDirectory, "reviewer-launch-context");
      return { ...artifacts, launchContext };
    },
  };
}

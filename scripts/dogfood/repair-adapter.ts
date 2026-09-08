import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
// @ts-expect-error Node 24 executes the private TypeScript composition directly.
import { step } from "./flow.ts";
import type { Adapter, Attempt, Config, Role } from "./flow.js";
import type { RepairAdapter } from "./repair.mjs";
import {
  RepairBlocked,
  type RepairConfig,
  type RepairHandoff,
  type SourceReviewArtifacts,
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
): Promise<SourceReviewArtifacts> {
  const [configRecord, candidate, authorAttempt, reviewerAttempt, terminal] = await Promise.all([
    readJson(directory, "config"),
    readJson(directory, "candidate"),
    readJson(directory, "author-attempt"),
    readJson(directory, "reviewer-attempt"),
    readJson(directory, "reviewer-terminal"),
  ]);
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

function reviewerReportPrompt(handoff: RepairHandoff) {
  return (
    `This is a DELTA review inheriting complete predecessor ${handoff.predecessorCompleteSweep}. ` +
    `Inspect only the prescribed remedies ${JSON.stringify(handoff.failedReview.findings)} and their direct callers; preserve all acceptance criteria and assertions.\n` +
    "The following closed completion contract supersedes the generic empty-summary PASS instruction. " +
    'The final summary must be a JSON-encoded string exactly {"v":2,"head":"<exact review head>","complete":true,"scope":"delta","profile":"contract","g0":["PASS"|"BLOCK_REPLAN","<evidence>"],"pairs":[["PASS"|"BLOCK"|"NOTE"|"NA","PASS"|"BLOCK"|"NOTE"|"NA","<evidence>"],...12],"findings":[],"notes":[]}. ' +
    "Pairs are ordered SCOPE, ROBUSTNESS, DEPTH, READABILITY, TESTS, OBSERVABILITY, SECURITY, PERFORMANCE, ROLLOUT, CONSISTENCY, EXPERIENCE, LANGUAGE. " +
    "Evidence is at most 140 characters per pair and 200 for G0. Findings are at most eight exact objects {file,line,severity,defect,verification}; notes are at most eight {file,line,remedy}. " +
    "Only changed configured source paths and valid one-based lines are admissible. Total decoded summary is at most 2000 characters. PASS requires complete true, G0 PASS, no findings and no BLOCK; notes never block."
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
          ? `Correct only these validated source findings: ${JSON.stringify(handoff.failedReview.findings)}. Start from corrective base ${handoff.correctiveBase}; the distinct delivery main base remains ${handoff.mainBase}. Preserve these acceptance criteria verbatim: ${JSON.stringify(handoff.acceptanceCriteria)}. Repairs consume no implementation attempt. Author PASS uses an empty summary. On FAIL, use only a JSON-encoded summary {"v":1,"head":"${handoff.correctiveBase}","complete":true,"findings":[{"file":"<changed configured source path>","line":1,"severity":"P1","defect":"<at most 350 characters>","verification":"<at most 200 characters>"}]}; at most eight findings and 2000 decoded characters. Use complete false if incomplete; never include raw output, environment data or prose.`
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
      await assertBoundedRoots(config);
      return loadArtifacts(config, config.sourceStateDirectory, config.mainBase);
    },
    async dispatch(config, handoff) {
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

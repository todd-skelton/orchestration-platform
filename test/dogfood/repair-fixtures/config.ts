import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  repairDigest,
  type RepairConfig,
  type SourceReviewArtifacts,
} from "../../../scripts/dogfood/repair-policy.mjs";

export const mainBase = "a".repeat(40);
export const repairBase = "b".repeat(40);
export const repairedHead = "c".repeat(40);
export const controllerRevision = "d".repeat(40);
export const sourceFile = "scripts/dogfood/repairable.ts";

export function reviewSummary(verdict: "failed" | "passed", head: string) {
  const blocked = verdict === "failed";
  return JSON.stringify({
    run: "synthetic-source-run",
    role: "reviewer",
    head,
    verdict: blocked ? "FAIL" : "PASS",
    findings: blocked
      ? [
          {
            file: sourceFile,
            line: 2,
            severity: "blocking",
            text: "Synthetic fixture confirms one bounded fixable defect.",
          },
          {
            file: sourceFile,
            line: 3,
            severity: "note",
            text: "Retain this advisory follow-up.",
          },
        ]
      : [
          {
            file: sourceFile,
            line: 3,
            severity: "note",
            text: "Retain this advisory follow-up.",
          },
        ],
    g0: "The prescribed repair is the simplest change.",
  });
}

export async function repairFixture(root: string) {
  const paths = {
    controller: resolve(root, "controller"),
    source: resolve(root, "source"),
    review: resolve(root, "review"),
    state: resolve(root, "state"),
    priorState: resolve(root, "prior-state"),
  };
  await Promise.all(Object.values(paths).map((path) => mkdir(path)));
  const history = [
    {
      ordinal: 1,
      id: "synthetic-prior-author",
      role: "author" as const,
      outcome: "passed" as const,
      usage: { status: "known" as const, inputTokens: 10, outputTokens: 4, costUsd: 0.02 },
    },
    {
      ordinal: 2,
      id: "synthetic-prior-reviewer",
      role: "reviewer" as const,
      outcome: "failed" as const,
      usage: { status: "unavailable" as const },
    },
  ];
  const admission = {
    consumed: 2,
    ceiling: 4,
    reservations: [
      { role: "author" as const, ordinal: 3 },
      { role: "reviewer" as const, ordinal: 4 },
    ] as [{ role: "author"; ordinal: number }, { role: "reviewer"; ordinal: number }],
  };
  const common = {
    run: "synthetic-source-run",
    issue: "ISS-SYNTHETIC-076",
    repository: "synthetic/repository",
    controllerRevision,
    mainBase,
    repairBase,
    worktree: paths.source,
    reviewWorktree: paths.review,
    stateDirectory: paths.state,
    sourceStateDirectory: paths.priorState,
    allowedPaths: [sourceFile, "test/dogfood/repairable.test.ts"],
    sourcePaths: [sourceFile],
    acceptanceCriteria: ["Preserve the synthetic acceptance criterion."],
    requiredChecks: ["hosted-linux", "hosted-macos", "hosted-windows"],
  };
  const promptContents = [
    "Apply the original bounded change.\n",
    "Review the original bounded change.\n",
  ] as [string, string];
  const author = { model: "synthetic-author-model", effort: "high", prompt: "Repair it." };
  const reviewer = {
    model: "synthetic-reviewer-model",
    effort: "high",
    prompt: "Review the repair.",
  };
  const sourceAuthor = {
    model: "synthetic-old-author",
    effort: "high",
    prompt: promptContents[0],
  };
  const sourceReviewer = {
    model: "synthetic-old-reviewer",
    effort: "high",
    prompt: promptContents[1],
  };
  const adapter = { kind: "codex-exec" as const, executable: process.execPath };
  const priorConfig = {
    owner: "synthetic-controller",
    run: "synthetic-source-run",
    issue: common.issue,
    pilotRevision: controllerRevision,
    base: mainBase,
    worktree: paths.source,
    reviewWorktree: paths.review,
    stateDirectory: paths.priorState,
    allowedPaths: [...common.allowedPaths],
    repository: common.repository,
    requiredChecks: [...common.requiredChecks],
    author: sourceAuthor,
    reviewer: sourceReviewer,
    adapter: structuredClone(adapter),
  };
  const sourceFingerprint = repairDigest({ config: priorConfig, prompts: promptContents });
  const config = {
    schemaVersion: "dogfood-repair-request/v1",
    controller: "synthetic-controller",
    ...common,
    controllerRoot: paths.controller,
    history,
    implementationAttempts: 1,
    implementationAttemptCeiling: 4,
    admission,
    author,
    reviewer,
    adapter,
  } as RepairConfig;
  const source: SourceReviewArtifacts = {
    configRecord: {
      fingerprint: sourceFingerprint,
      config: priorConfig,
      host: "synthetic-host",
    },
    candidate: { head: repairBase, changed: [sourceFile] },
    authorAttempt: {
      id: history[0]!.id,
      pid: 101,
      trace: resolve(root, "old-author.jsonl"),
      launchedAt: 1,
    },
    reviewerAttempt: {
      id: history[1]!.id,
      pid: 102,
      trace: resolve(root, "old-reviewer.jsonl"),
      launchedAt: 1,
    },
    terminal: {
      status: "failed",
      id: history[1]!.id,
      head: repairBase,
      summary: reviewSummary("failed", repairBase),
    },
    changedFiles: [sourceFile],
    lineCounts: { [sourceFile]: 3 },
    sourceHead: repairBase,
    reviewHead: repairBase,
    sourceClean: true,
    reviewClean: true,
  };
  const delta: SourceReviewArtifacts & { launchContext: Record<string, any> } = {
    ...source,
    configRecord: {
      fingerprint: "f".repeat(64),
      config: priorConfig,
      host: "synthetic-host",
    },
    candidate: { head: repairedHead, changed: [sourceFile] },
    authorAttempt: {
      id: "synthetic-corrective-author",
      pid: 103,
      trace: resolve(root, "author.jsonl"),
      launchedAt: 1,
    },
    reviewerAttempt: {
      id: "synthetic-delta-reviewer",
      pid: 104,
      trace: resolve(root, "reviewer.jsonl"),
      launchedAt: 1,
    },
    terminal: {
      status: "passed",
      id: "synthetic-delta-reviewer",
      head: repairedHead,
      summary: reviewSummary("passed", repairedHead),
    },
    changedFiles: [sourceFile],
    lineCounts: { [sourceFile]: 4 },
    sourceHead: repairedHead,
    reviewHead: repairedHead,
    launchContext: {
      schemaVersion: "dogfood-repair-launch-context/v1",
      run: config.run,
      role: "reviewer",
      ordinal: 4,
      head: repairedHead,
      model: config.reviewer.model,
      effort: config.reviewer.effort,
      predecessorReviewId: history[1]!.id,
    },
  };
  return { config, source, delta, paths };
}

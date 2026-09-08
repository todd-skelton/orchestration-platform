import { mkdir, writeFile } from "node:fs/promises";
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

export function reviewSummary(scope: "complete" | "delta", head: string) {
  const blocked = scope === "complete";
  const pairs = Array.from({ length: 12 }, () => ["PASS", "PASS", "focused evidence"]);
  if (blocked) {
    pairs[0] = ["BLOCK", "PASS", "F1 incorrect source behavior"];
    pairs[7] = ["NOTE", "PASS", "N1 measured follow-up"];
  }
  return JSON.stringify({
    v: 2,
    head,
    complete: true,
    scope,
    profile: "contract",
    g0: ["PASS", "not-built list verified"],
    pairs,
    findings: blocked
      ? [
          {
            file: sourceFile,
            line: 2,
            severity: "P1",
            defect: "Synthetic fixture confirms one bounded fixable defect.",
            verification: "Hosted fixture observes the corrected transition.",
          },
        ]
      : [],
    notes: blocked
      ? [{ file: sourceFile, line: 3, remedy: "Retain this advisory follow-up." }]
      : [],
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
  const authorPrompt = resolve(root, "author.md");
  const reviewerPrompt = resolve(root, "reviewer.md");
  await Promise.all([
    writeFile(authorPrompt, "Apply only the validated corrective delta.\n"),
    writeFile(reviewerPrompt, "Review only the validated corrective delta.\n"),
  ]);
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
    run: "synthetic-repair-run",
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
  const config = {
    schemaVersion: "dogfood-repair-request/v1",
    ...common,
    controllerRoot: paths.controller,
    history,
    implementationAttempts: 1,
    implementationAttemptCeiling: 4,
    admission,
    author: { model: "synthetic-author-model", effort: "high", promptFile: authorPrompt },
    reviewer: { model: "synthetic-reviewer-model", effort: "high", promptFile: reviewerPrompt },
    adapter: { kind: "codex-exec", executable: process.execPath },
    authority: {
      schemaVersion: "dogfood-repair-authority/v1",
      controller: "synthetic-controller",
      ...common,
      allowedPaths: [...common.allowedPaths],
      sourcePaths: [...common.sourcePaths],
      acceptanceCriteria: [...common.acceptanceCriteria],
      requiredChecks: [...common.requiredChecks],
      source: {
        run: "synthetic-source-run",
        configFingerprint: "e".repeat(64),
        candidateHead: repairBase,
        authorAttempt: history[0]!.id,
        reviewerAttempt: history[1]!.id,
        reviewId: history[1]!.id,
        disposition: "BLOCK_FIXABLE",
      },
      author: { model: "synthetic-author-model", effort: "high" },
      reviewer: { model: "synthetic-reviewer-model", effort: "high" },
      implementationAttempts: 1,
      implementationAttemptCeiling: 4,
      admission: structuredClone(admission),
      historyDigest: repairDigest(history),
      actions: ["validate-source-review", "dispatch-author", "dispatch-delta-review"],
    },
  } as RepairConfig;
  const priorConfig = {
    owner: "synthetic-controller",
    run: config.authority.source.run,
    issue: config.issue,
    pilotRevision: controllerRevision,
    base: mainBase,
    worktree: paths.source,
    reviewWorktree: paths.review,
    stateDirectory: paths.priorState,
    allowedPaths: [...config.allowedPaths],
    repository: config.repository,
    requiredChecks: [...config.requiredChecks],
    author: { model: "synthetic-old-author", effort: "high", promptFile: authorPrompt },
    reviewer: { model: "synthetic-old-reviewer", effort: "high", promptFile: reviewerPrompt },
    adapter: config.adapter,
  };
  const source: SourceReviewArtifacts = {
    configRecord: {
      fingerprint: config.authority.source.configFingerprint,
      config: priorConfig,
      host: "synthetic-host",
    },
    candidate: { head: repairBase, changed: [sourceFile] },
    authorAttempt: { id: history[0]!.id, pid: 101, trace: resolve(root, "old-author.jsonl") },
    reviewerAttempt: { id: history[1]!.id, pid: 102, trace: resolve(root, "old-reviewer.jsonl") },
    terminal: {
      status: "failed",
      id: history[1]!.id,
      head: repairBase,
      summary: reviewSummary("complete", repairBase),
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
    },
    reviewerAttempt: {
      id: "synthetic-delta-reviewer",
      pid: 104,
      trace: resolve(root, "reviewer.jsonl"),
    },
    terminal: {
      status: "passed",
      id: "synthetic-delta-reviewer",
      head: repairedHead,
      summary: reviewSummary("delta", repairedHead),
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

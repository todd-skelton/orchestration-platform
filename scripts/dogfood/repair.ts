import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RepairBlocked,
  repairDigest,
  type RepairConfig,
  type RepairHandoff,
  type RepairPolicy,
  type SourceReviewArtifacts,
  validateRepairConfig,
} from "./repair-policy.mjs";

const ABSENT = Symbol("absent");
function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new RepairBlocked(reason);
}
const exact = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value: unknown, keys: string[]) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

async function optionalRecord(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new RepairBlocked(`malformed-repair-record:${name}`);
  }
}

async function record(directory: string, name: string, value: unknown) {
  const prior = await optionalRecord(directory, name);
  if (prior !== ABSENT) {
    demand(exact(prior, value), `conflicting-repair-record:${name}`);
    return;
  }
  await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    flush: true,
  });
}

export interface RepairAdapter {
  loadSourceReview(
    config: RepairConfig,
    requireCurrentCandidate?: boolean,
  ): Promise<SourceReviewArtifacts>;
  dispatch(config: RepairConfig, handoff: RepairHandoff): Promise<{ status: string }>;
  loadDeltaReview(
    config: RepairConfig,
  ): Promise<SourceReviewArtifacts & { launchContext: Record<string, any> }>;
}

export type RepairResult =
  | {
      status: "observing-author" | "observing-reviewer";
      phase: "author" | "reviewer";
      run: string;
      issue: string;
    }
  | {
      status: "awaiting-delivery";
      phase: "complete";
      run: string;
      issue: string;
      head: string;
      predecessorReviewId: string;
    };

function deltaReviewRecord(
  handoff: RepairHandoff,
  accepted: ReturnType<RepairPolicy["acceptDelta"]>,
) {
  return {
    schemaVersion: "dogfood-repair-delta-review/v1",
    head: accepted.head,
    reviewId: accepted.reviewerAttempt,
    predecessorReviewId: handoff.predecessorCompleteSweep,
    verdict: accepted.review.verdict,
    findings: accepted.review.findings,
    g0: accepted.review.g0,
  };
}

export async function repairStep(
  config: RepairConfig,
  adapter: RepairAdapter,
  policy: RepairPolicy,
): Promise<RepairResult> {
  validateRepairConfig(config);
  const directory = await realpath(config.stateDirectory);

  const [savedIntent, savedHandoff] = await Promise.all([
    optionalRecord(directory, "repair-intent"),
    optionalRecord(directory, "repair-handoff"),
  ]);
  demand(savedHandoff === ABSENT || savedIntent !== ABSENT, "orphaned-repair-handoff");
  // Initial source/workspace checks are read-only and precede repair intent. On
  // restart, immutable source records and candidate blobs are revalidated while
  // the reviewed flow owns the now-advancing worktree heads.
  const requireCurrentCandidate = savedHandoff === ABSENT;
  const source = await adapter.loadSourceReview(config, requireCurrentCandidate);
  const handoff = policy.prepare(config, source, requireCurrentCandidate);
  const handoffDigest = repairDigest(handoff);
  const intent = {
    schemaVersion: "dogfood-repair-intent/v1",
    run: config.run,
    issue: config.issue,
    controller: config.controller,
    handoffDigest,
    reservations: config.admission.reservations,
  };
  await record(directory, "repair-intent", intent);
  await record(directory, "repair-handoff", handoff);

  const completed = await optionalRecord(directory, "repair-complete");
  if (completed !== ABSENT) {
    demand(
      exactKeys(completed, [
        "schemaVersion",
        "run",
        "issue",
        "head",
        "predecessorReviewId",
        "reviewerAttempt",
      ]) &&
        completed.schemaVersion === "dogfood-repair-complete/v1" &&
        completed.run === config.run &&
        completed.issue === config.issue &&
        /^[a-f0-9]{40}$/.test(completed.head) &&
        completed.predecessorReviewId === handoff.predecessorCompleteSweep &&
        typeof completed.reviewerAttempt === "string",
      "malformed-repair-record:repair-complete",
    );
    const delta = await adapter.loadDeltaReview(config);
    const accepted = policy.acceptDelta(config, handoff, delta);
    demand(
      accepted.head === completed.head && accepted.reviewerAttempt === completed.reviewerAttempt,
      "completed-repair-drift",
    );
    const savedDelta = await optionalRecord(directory, "repair-delta-review");
    demand(
      savedDelta !== ABSENT && exact(savedDelta, deltaReviewRecord(handoff, accepted)),
      "completed-repair-drift",
    );
    return {
      status: "awaiting-delivery",
      phase: "complete",
      run: config.run,
      issue: config.issue,
      head: completed.head,
      predecessorReviewId: handoff.predecessorCompleteSweep,
    };
  }

  const result = await adapter.dispatch(config, handoff);
  if (result.status === "observing-author" || result.status === "observing-reviewer")
    return {
      status: result.status,
      phase: result.status === "observing-author" ? "author" : "reviewer",
      run: config.run,
      issue: config.issue,
    };
  demand(result.status === "awaiting-publication", "unexpected-repair-flow-status");

  const delta = await adapter.loadDeltaReview(config);
  const accepted = policy.acceptDelta(config, handoff, delta);
  await record(directory, "repair-delta-review", deltaReviewRecord(handoff, accepted));
  await record(directory, "repair-complete", {
    schemaVersion: "dogfood-repair-complete/v1",
    run: config.run,
    issue: config.issue,
    head: accepted.head,
    predecessorReviewId: handoff.predecessorCompleteSweep,
    reviewerAttempt: accepted.reviewerAttempt,
  });
  return {
    status: "awaiting-delivery",
    phase: "complete",
    run: config.run,
    issue: config.issue,
    head: accepted.head,
    predecessorReviewId: handoff.predecessorCompleteSweep,
  };
}

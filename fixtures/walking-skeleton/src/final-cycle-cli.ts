import {
  consumeFinalReviewCycle,
  observeConcurrentLeaseControl,
  observeMalformedFrontierControl,
  type FinalCycleInvocation,
} from "./final-cycle.js";

/** Private command composition used by the reserved root verification slot. */
export async function runSkeletonCycleCommand(input: FinalCycleInvocation) {
  const result = await consumeFinalReviewCycle(input);
  return {
    command: "skeleton:cycle" as const,
    exitCode: result.ok ? 0 : 1,
    result,
  };
}

export type SkeletonNegativeControlInput = Readonly<{
  concurrent: Readonly<{
    contender: Pick<FinalCycleInvocation, "cycleId" | "sessionId">;
    holder: FinalCycleInvocation;
  }>;
  malformed: FinalCycleInvocation;
  rejected: FinalCycleInvocation;
}>;

/** Private three-control composition; a passing control still returns a typed refusal. */
export async function runSkeletonNegativeControlsCommand(input: SkeletonNegativeControlInput) {
  const malformed = await observeMalformedFrontierControl(input.malformed);
  const rejected = await consumeFinalReviewCycle(input.rejected);
  const concurrent = await observeConcurrentLeaseControl(
    input.concurrent.holder,
    input.concurrent.contender,
  );
  const accepted =
    malformed.ok === false &&
    "reason" in malformed &&
    malformed.reason === "MALFORMED_FRONTIER" &&
    rejected.ok === false &&
    "reason" in rejected &&
    rejected.reason === "REVIEW_REJECTED" &&
    concurrent.ok === false &&
    "reason" in concurrent &&
    concurrent.reason === "SESSION_HELD";
  return {
    command: "skeleton:negative-controls" as const,
    controls: { concurrent, malformed, rejected },
    exitCode: accepted ? 0 : 1,
    ok: accepted,
  };
}

// Literal frontmatter, Acceptance and Not built sections from PR #647's draft:
// 1f2735ff251b6ca7b8f086d476bd225acfa4fdd4:planning/drafts/ISS-206.md.
// Keep the failed heading and ordered continuation text independent of live planning.
export const iss206Draft = `---
key: ISS-206
title: "Bound a hung hosted verification job so the loop repairs instead of stalling"
labels: ["type:slice"]
milestone: "Unattended self-improvement"
blocked_by: []
---

## Acceptance

1. The Bootstrap \`smoke\` job has a 100-minute \`timeout-minutes\` bound. Its
   three-OS matrix, \`fail-fast: false\`, steps and full verification command
   remain unchanged. No check, assertion or OS is skipped or weakened.
2. A focused Vitest config check fails when \`bootstrap.yml\` loses or changes
   \`timeout-minutes: 100\` at the \`smoke\` job level, as a sibling of \`runs-on\`,
   not inside a step. SYNTHETIC delivery tests use a fake \`gh\` whose
   \`--log-failed\` returns only \`failure\`, \`timed_out\`, \`startup_failure\`, or
   \`action_required\` job logs, and returns empty when the sole non-pass job
   is \`cancelled\`. With only Windows \`cancel\`, the current main rejects with
   \`hosted-check-log-unavailable:Node 24 / windows-latest\`; the fix returns
   \`status: "failed"\` and retains the Windows job log in \`hosted-failure.log\`.
   With macOS \`fail\` and Windows \`cancel\` in one run, that file contains both
   logs, with exactly one \`--log-failed\` call and one \`--job ... --log\` call.
   Update the exact-argument assertion and cancel fakes in
   \`test/dogfood/delivery.test.ts:272-285,1314-1320,1356-1395\` without dropping
   assertions; retain completed-run gating, genuine empty-log parking and
   resume idempotence. Add a \`timed_out\` -> \`fail\` row to the conclusion table
   at \`test/dogfood/delivery-adapter.test.ts:178-215\`, retaining the
   \`cancelled\` -> \`cancel\` row.
3. Run focused checks and \`pnpm typecheck\`, \`pnpm format:check\`,
   \`pnpm planning:check\`, and \`pnpm test\` at the candidate head. Independent
   exact-head review and final-head three-OS hosted Bootstrap green are still
   required before landing. At the final-head hosted lifecycle moment, capture
   the run/job IDs, exact head, observed UTC instant, job conclusions and
   durations; a timed-out or cancelled job is failure evidence, never green.

## Not built

- No retries, reruns, matrix reduction, skipped Windows job, loop-side
  cancellation of runs, or executor-side observation deadline.
- No diagnosis or repair of the ISS-184 candidate's Windows \`tsc\` hang or its
  macOS \`queue-post-merge.test.ts\` failure. Those belong to ISS-184 repair.
- No step-level timeout on \`pnpm run verify:bootstrap\`: it could make that
  step fail and appear in \`--log-failed\`, but leaves hangs in setup steps at
  GitHub's 360-minute job default and does not meet the whole-job bound.
- No local timeout increase, test skip, provider access, runtime edit, executor
  installation or restart by this planning lane.
`;

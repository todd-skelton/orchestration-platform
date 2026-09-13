# ISS-134: preserved M2 delivery recovery

Observed on 2026-09-13, before this fix was published or used on the product:

- Run: `/root/orchestration-m2/runtime/m2-payout-fees-replanned-20260913`.
- PR: `chase-sets/chase-sets#7973`, approved head
  `b3bd4bedf14be41eda8e836c891701ebe26704dc`; independent review and both
  committed-candidate gates passed. Required hosted checks passed.
- The queue-policy CLI command failed with `enablePullRequestAutoMerge`.
  The host observed no queue entry or added/removed queue timeline event.
- `cs-7821-attempt-1/attempt.json` incorrectly records phase `failed`, with
  a virtual `merge-queue:1` finding whose text is `absent`. Its genuine
  source/review/gate/publication evidence remains in `source/`.
- `cs-7821-attempt-2/attempt.json` records phase `source`. The host stopped
  its author and supervisor while its source checkout was still clean.

The recommended one-time host recovery, with the supervisor stopped, is:

1. Archive a byte-for-byte copy of the whole run directory outside the active
   run, retaining the false scheduling receipt, original merge intent, both
   attempts, traces, exits, and stop records. Record the archive location and
   both source checkout HEAD/status observations in the issue's recovery note.
2. Reobserve PR #7973's exact head, open/non-draft state, required checks, and
   queue membership/history. If it is already queued or merged, reconcile that
   observation instead of requesting another admission.
3. Restore only `cs-7821-attempt-1/attempt.json` to its accepted delivery phase:
   `phase: "delivery"`, `findings: []`, `acceptedStage: "source"`, and
   `stateDirectory` equal to that attempt's absolute `source` directory.
   Remove the derived `rebasedBase` field. Retain candidateAttempt `1`, original
   base `e27679b356ab603987387891645a89c2d83f91c8`, approved head, review ID,
   history, and retries `0`. The original false-failure receipt stays in the archive.
4. Only after confirming that the old intent never obtained admission, archive
   and remove its active `source/merge-intent.json` so the corrected native
   enqueue can make one new request. Preserve all source/review, gate, plan,
   publication, hosted-check, and stop records. Leave attempt 2 preserved and
   stopped; restoring attempt 1 makes it the first unfinished attempt selected
   by the existing loop, without converting any worker outcome to PASS.
5. Resume the same run with the reviewed fix installed on the stopped stable
   executor. It will reobserve required checks, enqueue with the exact approved
   head, and wait for actual merge. Any new admission error is a host stop with
   diagnostics; inspect it before any further admission request.

This author task changed no runtime files, product files, or GitHub state.

# The loop

One process improves a repository by picking an issue, dispatching an author,
getting an independent review, landing a PR through hosted CI, and moving on.
It starts on this repository and then runs Chase Sets through an adapter. New
capability is added only when a real cycle records a blocker.

## Rules

1. The loop is `scripts/dogfood/`. Its entry point is `loop:supervise` in
   `package.json`, which accepts one loop config and derives each phase.
2. An issue is runnable when it is open, labeled `ready`, every `blocked_by`
   in its draft is closed, and it belongs to the earliest open milestone.
3. Authors run `pnpm typecheck`, `pnpm format:check` and `pnpm test` in their
   worktree before handing off. The hosted three-OS `bootstrap` workflow is
   the only required check on a PR.
4. Review is a verdict (PASS or FAIL), findings with `file:line`, and a G0
   answer: is there a simpler way. A blocking finding fails the review. Two
   blocking rounds force a third repair that applies the reviewer's prescribed
   fixes verbatim.
5. Transient worker failures get one automatic retry inside the same attempt:
   an unparsable verdict or a delayed exit receipt. One candidate-caused local
   gate failure may receive the attributed correction and fresh review below;
   this replaces the old typecheck/format correction. Four attempts per issue,
   then stop.
6. Authority does not move. Workers never push, publish, merge, or edit the
   running loop. The executor is the checked-out stable `main`. The author
   never reviews its own work.
7. A stop caused by the work parks the issue with one paragraph: what stopped
   it, how many attempts, what a person should change, and how to unpark it;
   the loop then continues with the next runnable issue. A stop caused by the
   host or executor posts its paragraph without parking and exits. A recurring
   note becomes the next issue. That is the only intake.
8. Runtime state lives outside the checkout.
9. A restart may repeat the last in-flight step at the cost of one worker
   launch. Records exist so the loop can resume, not to prove anything to a
   second process: there is one operator, one host, and one writer. A check
   that guards against a hostile state directory, a hand-edited receipt, or
   the loop disagreeing with itself is a finding, not a safeguard.

ISS-161 records ISS-110's source-author FAIL and later `pilot-revision-moved`
stop in `m1-iss146-147-20260914T2325`. A matching native source-author FAIL
now parks the item through ordinary stop handling and advances to unrelated
ready work. Before reconstructing a saved source, supervision validates the
current executor and observes the saved attempt, source configuration and
matching failed author terminal. It reconciles pending notes and replays the
original author stop's marker, body and ordinal, including when an old run-stop
completion or a later pilot stop exists. An old note completion does not prove
parking. The ordinary cycle completion then retains accumulated participants;
repeated resume does not replay the failed source or launch attempt 2.

Old attempts, selections, source/setup records, terminals, stops and worktrees
remain unchanged. Failure counts and spent allowances remain history; later
launches still consume the run's ceiling. Missing or mismatched terminals,
unfinished authors and non-FAIL results cannot establish this transition.
Source pilot/configuration checks and executor drift refusals remain in force.
Parking leaves the self issue open and unready; only explicit planning unpark
can admit it again. This implementation does not retry or complete ISS-110,
establish M2 completion, restart a loop or install an executor. Independent
exact-head review and three-OS bootstrap green must precede host installation
with supervisors absent; resuming the preserved run requires separate host
authorization.

ISS-160 records ISS-146's unpublished conflict-author FAIL in
`m1-iss146-147-20260914T2325`. Before scanning failed attempts, composition
observes the matching failed author terminal at the pinned conflict seed and
advances the stale delivery projection to failed once. It retains the original
base, attempt number and historical review identity/findings, recovers native
participants, and clears the accepted stage and directory. Source, review,
refresh, worker, stop and completed-stop records and the old worktree remain
unchanged. Nonfailed and in-flight authors do not establish this transition.

Completed stops still skip their cycle, and pending notes reconcile before
composition. Only explicit planning unpark can select the issue again in the
same run. Ordinary setup then creates attempt 2 in new worktrees, based on the
unaccepted seed with its recorded integration main as the full-diff base.
This unresolved-seed continuation alone defers pre-author rebase until native
delivery refresh, which merges later main to retain both seed parents instead
of replaying the original conflict. No successful rebase is invented. The run's accumulated
history, including intervening issues, stays charged.

The successor uses native authoring, commit reconciliation and independent
exact-head DELTA review. Both parents, source review and execution trace, failed
conflict-author trace and the selected brief accompany the workers. A no-op
cannot accept the unresolved seed. Historical PASS and gate receipts never
authorize the successor. Conflict resolution remains consumed; worker retry
and local correction allowances carry forward into actual launch and delivery
decisions. Author FAIL or blocking DELTA parks without source repair or automatic
attempt 3. A new conflict or exhausted correction also stops. Current-main
integration requires fresh DELTA and all local and after-mirror gates, publication,
hosted checks, landing and applicable deployment at the final head. Replay uses
the same successor and ordinary mutation reconciliation.

Landing this repair does not ready, restart or complete #457, install an
executor, or alter its retained runtime or worktrees. Host installation requires
independent exact-head PASS and three-OS bootstrap green with supervisors absent;
#457 dispatch still requires Todd's amended answer and explicit planning unpark.

ISS-160's PR #509 Windows gate timed out in the `refresh-review-fail` lifecycle
fixture, followed by locked-worktree cleanup. Vitest now runs files serially
with one worker to bound competing real-Git fixtures. Every test and the existing
test/hook timeouts remain in place for local and hosted bootstrap gates.

ISS-155 records ISS-146's `queue-internal-error` in
`m1-iss146-147-20260914T2325`: compiling a large fixed source segment as a
regular expression exceeded the engine's pattern limit before conflict author
dispatch. Conflict boundaries now use anchored literal prefix/suffix checks
and an ordered, non-overlapping forward scan of the intervening fixed text.
The Git hunk grammar, immutable outside bytes and bounded resolution lifecycle
are unchanged; this does not restart or alter the preserved run.

ISS-151 records the pre-author `worktree-collision:source` stop for ISS-146 in
`m1-intake-refresh-20260914T1635`: a preserved worktree from an earlier run
still held `codex/iss-146`. New ordinary attempts use the local source branch
`codex/run-<sha256(run)>/<issue-key>-attempt-<attempt>`; the hash keeps every
accepted run name valid in a Git ref. Pilot and review remain detached.
Resume reads the branch from the existing setup plan, including legacy names.
Published branch names, PR identity and forward-only refresh rules stay the same;
delivery publishes the candidate to that existing name and cleans up its own
local branch. A preserved worktree is never removed, moved or reused by a fresh
attempt. A remaining branch checkout collision stops as `worktree-collision:source`
with the holder's path in the stop diagnostics. Worktree directory collisions
still stop; fresh runs need distinct worktree roots. If an existing PR fails
publication identity checks, `publication-state-unknown` also names any preserved
worktree holding that published branch; the local naming change does not admit
that PR. ISS-145's accepted-replan branch and preservation behavior are unchanged.

ISS-150 records the two `reviewer-malformed` launches for ISS-147 in
`m1-intake-refresh-20260914T1635`: one verdict exceeded the unstated length cap,
and its retry prefixed valid JSON with prose. Reviewer prompts now require the
JSON object alone, with `JSON.stringify(verdict).length` at most
`MAX_TERMINAL_SUMMARY_LENGTH` (2000) characters, including findings and G0.
Extraction accepts the last complete top-level JSON object in the final agent
message when prose precedes it, provided it is the only object and only
whitespace follows. Balanced non-JSON prefix fragments are ignored as a whole,
including any nested JSON objects. Trailing prose, multiple objects, missing objects and
invalid verdicts remain malformed; key, identity, head, enum and findings
checks remain unchanged. An otherwise valid over-length verdict remains
malformed with its measured length and cap in the terminal summary and the
existing single automatic retry context. Author prompts and parsing are unchanged.

ISS-139 records an evidence-discovery failure in M2 run `m2-jpeg-20260914`:
Chase Sets #7766 exhausted its implementation budget after two blocking reviews
reported missing mutant execution evidence already present in author traces.
The run reached idle without a PR, merge, deployment or issue completion; M2
remains incomplete. Preserve its failed records and candidate commits
`eee1509fdedea776d7afb557f7baf5d061b131a8` and
`bdc0e2973562a70a494d37b04c863230326bbc85`; this repair does not unpark or restart it.
Initial and delta reviewers now receive the selected author's captured trace
and existing attempt, terminal and candidate record paths, including on resume
and retry. Reviewers inspect relevant commands and outputs alongside the exact
candidate, distinguish execution from claims and sandbox limitations, and make
their own read-only verdict. Author PASS is not review authority; required but
missing or inadequate test evidence remains a finding.

ISS-140 records the next #7766 blocker: evidence-informed correction required
no material source edit, but the loop rejected an empty corrective delta.
A corrective author may now finish with PASS without changing the rejected
candidate. The controller reuses that commit, not an empty commit or an old
review verdict. The corrective author base stays distinct from the delivery
main base; after native continuation rebases, its existing attempt record
also retains the main revision used for that rebase. Review and footprint
checks retain the full implementation diff against that main base, not just
the latest correction. Initial no-op submissions and candidates with no real
implementation diff still fail. Fresh and resumed attempts require the current
author's completion and independent exact-head review with current execution
evidence, followed by all ordinary local gates, publication, hosted CI, merge
and deployment. Attempt ceilings, consumed attempts and rejected reviews remain
unchanged. This behavior does not unpark #7766 or restart its preserved run.

ISS-141 records the hosted-failure handoff blocker at
https://github.com/todd-skelton/orchestration-platform/issues/367#issuecomment-5660899933
(clarification: issue comment `5660913866`). Chase Sets PR #8002, exact head
`181c1d4c5f1bb3f4330cd4ae50f0fd688de3280e`, failed run `34818999245`;
the last 4000 log characters contained only PR Required aggregate boilerplate.
Actual diagnostics included stale source-line references, stale lockfile-bound
owner-context hashes, a grant-test timeout and an E2E DockerHub TCP reset.
Complete failed-run logs now live in the delivery runtime's `hosted-failure.log`,
with exact candidate, publication and failed check/run URLs. Each run is fetched
once even when several jobs fail. Corrective author and reviewer launches get
the absolute evidence path rather than raw logs in prompts or terminal reports.
They inspect underlying diagnostics independently; this supplies neither a
verdict nor a waiver, and all ordinary delivery gates remain mandatory.

For the stopped `cs-7766-attempt-4` author, the host preserves the runtime, trace
and partial fixture-path edit, installs the reviewed stable executor, then
restarts the same run with its existing records. For its receiptless author,
the observer validates the trace identity and waits the existing receipt window.
Only an absent PID with no terminal turn becomes `dead`; a still-live process,
unknown process/trace identity or completed turn is not reclassified. No exit
receipt or worker verdict is invented. The ordinary single dead-worker retry
acquires missing logs from attempt 3's existing publication before dispatch or
clean-base reset. Evidence is appended at launch, leaving the old findings and
source config fingerprint unchanged. Failure to acquire it stops the host
without launching an uninformed worker. Before the existing clean-base reset,
`author-retry-<attempt-id>.patch` captures tracked staged and unstaged changes
without overwriting that attempt's patch on replay; the existing
`author-retry-discard.json` also retains the interrupted attempt and terminal
context. The retry sees these paths and the old trace, reapplies useful work and
verifies it. Untracked files are not in that patch; host preservation is still
required. No historical verdict, implementation count or retry ceiling is reset.
This recovery requires the previous publication to remain on the recorded head
and GitHub to retain its logs until capture. Once captured, resumed worker
launches use the runtime file without refetching. This repair does not restart
the preserved run, fix JPEG, rerun CI or establish M2 completion.

ISS-142 records the next stopped delivery at
https://github.com/todd-skelton/orchestration-platform/issues/367#issuecomment-5661692847.
ISS-141 recovery reached author PASS and independent reviewer PASS for exact
candidate `ac2c54ce80865c0501d71aae4676c719b0d1eaf1`, but delivery rejected
the native author's `retryContext` field as `unreviewed-delivery-source`.
The delivery consumer now checks the identity and verdict fields it needs,
not an exact key count for the single writer's attempt record. Native author
and reviewer retry context does not invalidate an otherwise reviewed source.
The host can install the reviewed stable executor while stopped and resume
the same attempt 4 in delivery, retaining its one consumed worker retry and
all existing worker records. No record migration, new worker, fifth attempt,
imported verdict or budget reset is required. Exact-head independent review,
local gates, hosted checks, publication, merge and deployment remain required.
This repair does not restart the run or claim M2 completion.

ISS-143 records recurring hosted-check startup stops at
https://github.com/todd-skelton/orchestration-platform/issues/367#issuecomment-5662310822
and earlier comment `5660812394`. PR #8005's required check and linked workflow
became visible after the initial observation had stopped delivery. The initial
snapshot was not captured; advisory checks may already have been visible.
When all required checks and all workflow runs are absent, the checks adapter
now waits ten seconds and reobserves, at most twelve times in that observation
call (two minutes of waits, plus API request time). Advisory check rows do not
prevent this startup retry. Each poll revalidates exact publication identity.
Any visible workflow run or required-check row leaves startup retry and follows
the existing validation; wrong-head/PR, malformed, duplicate, failed or skipped
required evidence is not converted into success. Persistent absence still
stops at the existing missing-check error. A linked pending workflow follows
ordinary observation until actual required green, with no republishing or
worker/implementation retry budget consumed. A host interruption can repeat
this bounded in-flight observation under rule 9; no new runtime schema or
migration is required. This repair does not edit or restart the running loop.

ISS-144 records the 2026-09-14 handoff restart of self run
`m2-supervised-20260913`. Executor
`ff873c421d3e1467f68bea3c8bf86d9bd2eaa836`, PID `735161`, started at
`2026-09-14T13:11:31Z` and resumed cycle 2's ISS-129 (#421), which had closed
outside the unfinished run. It stopped with `candidate-workspace-drift` and
`lifecycleReason: stopped-issue-state-unknown`; the learning note is on #421.
Read-only inspection of the preserved runtime found cycle 1's completion,
four participant records, ISS-129 attempt 1 still in `delivery` at candidate
`473c301ad0ff1dd093fe19aea058f014a7ee54c9`, the completed first stop for
`gate-failed:planning:board-check`, and the pending second stop for workspace
drift. This is an observation of the stopped run, not a successful recovery.

Native resume now observes an unfinished saved selection's issue before
reconstructing its source workspace or replaying a pending stop. When that
same issue is closed, the existing cycle completion record carries forward
the accumulated participant history from its attempt directories, including
failed reviews and consumed launches. Selection then follows ordinary
eligibility to a successor or idle. Repeated resume skips the completed cycle.
Attempt, source and prior stop records remain unchanged, including a pending
stop; no author/reviewer verdict or delivery receipt is written. An open
issue follows ordinary recovery and all its checks. Unavailable or unknown
issue observations and mismatched identity do not establish closure.
This cycle completion recognizes external closure; it does not establish
native delivery, hosted green, merge, deployment or milestone exit evidence.
The host may resume the preserved run only after this reviewed implementation
lands and is installed as the stable executor. Workers do not restart it or
edit its runtime, worktrees or executor.

ISS-145 records the pre-author `worktree-collision:pilot` stop of
`m2-jpeg-corrective-20260914T1402` on executor
`ea27eb3b5ead377bde002775666ac9f4dc2be2af`, reported on Chase Sets #7766
in comment `5665208168`. Todd's ruling on #4388, comment `5665159522`,
accepted plan #8014 and #7766 comment `5665196633` authorize one correction
of the route-collision inventory failure on PR #8005 at
`ac2c54ce80865c0501d71aae4676c719b0d1eaf1`.

That historical continuation used `cs-7766-replan-8014-attempt-5`, retaining
all nine participants and the original main base. Its published candidate
used the existing forward-only refresh of PR #8005's `-g4` branch from a new
local `-g5` branch. Those records, branches and worktrees remain history;
the singleton string configuration is replaced by ISS-154's packet below.
No historical record migration or restart is authorized.

ISS-154 records the next closed ruling, Chase Sets #4388 comment `5681842811`.
#7844 exhausted four absolute attempts in `m2-purchase-limit-20260915T0132`.
Its final unpublished head is `25b602832b8d33768c6e1aab1b611c48ad4d3f21`;
absolute attempt 4 is the repair in `cs-7844-attempt-3`, not a directory named
attempt-4. Real PostgreSQL execution in comment `5678264608` ran 386 tests
with zero skips; only the two day +0/+1 source-retry concurrency cases failed
at the unsupported `fromVersion: 0` reads before the cancellation proof.
Todd authorizes one final Astra/high correction of those reads, followed by
exact-head host evidence and fresh Sol/high review. Any work non-PASS parks
at absolute ceiling five; there is no attempt six or second repair.

`LoopConfig.acceptedReplan` is now an exact-key object. Its closed fields are:

- `schemaVersion: "dogfood-accepted-replan/v1"`, `repository`, `issueKey`,
  `issueUrl`, `priorRun`, and absolute normalized `priorAttemptDirectory`.
  The directory is immediately beneath `stateRoot/priorRun` and names the
  actual queue attempt record, including a repair's containing directory.
- `priorAbsoluteAttempt: 4`, `nextAbsoluteAttempt: 5`, `absoluteCeiling: 5`,
  `candidateHead` (full immutable SHA), and `priorHistoryDigest` (SHA-256 of
  `JSON.stringify(prior.history)`). The failed prior attempt, repository,
  issue, head and accumulated participant history must agree. Source or
  repair evidence follows the prior absolute attempt; historical PASS is
  never imported as current authority.
- `targetRun` (equal to the loop's run), `attemptSlug` (a normalized name
  ending in `-attempt-5`), `authorityUrl` (the immutable ruling comment),
  `scope` (the ruled correction), and `allowedPaths`. Paths are unique exact
  repository-relative tracked regular files, not directories, globs, parent
  traversals or absolute paths. For #7844 the sole path is
  `bounded-contexts/ordering/features/orders/api/purchase-limits.db.test.ts`.
  Both sides of renames and untracked additions count against the boundary.
- `publication` is either `null` or exactly `{number, url, head, sourceBranch}`
  matching the prior publication. Published continuation retains its branch
  and forward-refresh lease; unpublished continuation invents no PR or receipt.
- `preReviewEvidence` is either `null` or the descriptor below. Ordinary
  loop routing supplies the ruled worker placements; the packet does not
  classify models or issue prose. The host must configure the ruled pair.

The ordinary loop config still caps `attemptCeiling` at four. Before setup,
composition reserves the exact packet in
`stateRoot/accepted-replan-<sha256({repository,issue})>.json`, outside both runs.
This single lineage reservation prevents changed run names, paths or packets
from spending another continuation. Replay uses the same attempt directory.
Fresh ordinary composition also refuses recorded exhausted lineages on this
host. The reservation and all prior records remain history. No running executor
or preserved runtime is edited to admit work.

The optional pre-review descriptor has exactly `receiptSchema` (currently
`"dogfood-host-verification/v1"`), `workspace`, `gate`, `command` (exactly
`{executable, args}`), `bundle` (absolute distinct paths named `receipt`,
`runMetadata`, `preflightLog`, `verifierLog`), positive complete-suite `files`
and `tests` counts, `skips: 0`, and unique `requiredCases` identities. The host
sets actual verifier identities and the complete workspace file count; a
subset or an inferred count is not accepted evidence.

The host verifier receipt has exactly `schemaVersion`, `repository`, `head`,
`workspace`, `gate`, `command`, `runId`, `exitCode`, `files`, `tests`, `skips`,
`cases` (executed case identities), and `artifacts`. `artifacts` binds SHA-256
digests of the raw `runMetadata`, `preflightLog` and `verifierLog` bytes. Run
metadata repeats every identity and result field, omits `artifacts`, and uses
`schemaVersion: "dogfood-host-verification-run/v1"`. Logs must be nonempty.
The platform consumes this closed host receipt contract; it does not infer
PostgreSQL execution from author claims or reinterpret a log as authority.
The installed host verifier must supply that contract before resume.

Author PASS pins the candidate and yields `operator-evidence-required` before
any reviewer intent or launch. Missing material keeps that non-parking stop.
Malformed, duplicate, wrong-identity or contradictory material stops as
`operator-evidence-authority`, also without parking or new authoring. An
identity-valid nonzero exit, skip, wrong complete-suite count or missing
required case is `operator-evidence-failed`: terminal failure and parking,
without review or another attempt. Valid bundles, including failed executions,
are atomically retained under `source/pre-review-evidence`, together with
`acceptance.json` (`dogfood-pre-review-acceptance/v1`) binding their digests,
parsed identities, results and decision. Replay and reviewer prompts use only
this snapshot. External replacement or removal cannot turn failure into PASS.

An accepted snapshot admits the ordinary independent reviewer lifecycle once.
No ordinary repair, gate correction, conflict author or chained continuation
is admitted. Current-main integration still requires delta review and, when
declared, new exact-head host evidence. Local gates, hosted green, native merge
and applicable actual deployment remain required. Host/authority observation
stops retain the same in-flight step; work failures record terminal history.

After this issue lands with three-OS bootstrap green, only the operator may
advance the stable executor while both supervisors are absent and write the
exact ruled continuation config. After author PASS the operator runs the
installed PostgreSQL host verifier and resumes the same run with its bundle.
This implementation does not author the product fix, start either loop,
install an executor, alter old records or milestone ownership, or claim M2
completion. The historical JPEG rollback remains intact.

ISS-148 records ISS-146's two `planning:board-check` stops in
`m1-accepted-replan-20260914T1416`: a later registration had landed on main,
but the gates still read the author's older roadmap. Native delivery now
fetches actual `refs/remotes/origin/main` before entering unpublished delivery
gates, including on resume. It rebases an aged candidate through the same
native rebase operation used for corrective continuation. When delivery refreshes
an existing PR, integration merges main instead, retaining the recorded published
head as an ancestor for the unchanged forward-only publication and remote-head
lease checks (ISS-145). Unavailable,
incompatible or moving main stops with `current-main-unavailable`,
`current-main-incompatible` or `current-main-moved`. Conflicts use the bounded
ISS-147 handoff below; other integration failures retain `rebase-conflict`.

The original source author, review, traces and attempt remain unchanged.
`native-refresh.json` in that source's runtime remembers the integration;
each resulting main base has a `refresh-<main>` directory for its delta review
and delivery evidence. Resume reconciles a completed integration and resumes an
in-flight reviewer rather than launching another author or spending another
implementation attempt. Delta reviewers use the ordinary native launch ceiling
and reviewer retry, retain prior participants (including failures), inherit
the original review and execution evidence, and inspect semantic changes and
direct callers at the exact resulting head. A clean rebase is not evidence of
semantic equivalence. A failed delta review stops as `refresh-review-failed`
and follows the ordinary work-caused stop and parking policy.
Main moving during review requires another refresh before any gates run.

A refreshed head requires new local gate receipts and its current delta review;
old gate receipts remain history. ISS-152's shared, attributed correction applies
to refreshed gates too, without renewing the allowance. Draft mutations are
observed before applying them, so an already matching mirror is not repeated.
Publication, hosted checks and merge/deploy remain bound to the resulting head.
Published delivery, including a pending publication intent whose response may
have been lost, resumes its existing reconciliation, checks and mutations; it
does not rewrite an in-flight publication merely because main moved. An exact
published conflict follows ISS-147 after publication reconciliation.

The self adapter's `afterMirror` board gate validates candidate planning locally
and checks only keys changed by its planning delta against the live board and
project. Ownership compares both sides of the diff, including deleted rows,
drafts, milestone changes and project changes. This uses current main plus the
candidate's own planning work after refresh; unrelated registration windows
cannot fail a live candidate, while candidate omissions, malformed planning,
incorrect board bodies and missing project membership still fail. The ordinary
`pnpm planning:board-check` and selection retain their full-board validation.
This behavior does not edit or restart the preserved ISS-146 run, change issue
order, waive hosted bootstrap or grant workers mutation authority.

ISS-147 records the `publication-outcome-unknown` stop for reviewed Chase Sets
candidate `42bac8439e31b8354447f2675edfaea72890d4b5` on PR #8005 in
`m2-jpeg-corrective-20260914T1402`. Read-only reconciliation found the published
head DIRTY/CONFLICTING against main `78848d23d610d3eba6c8f980fef81e6d82b56b42`,
with one list-hunk conflict in
`deployables/platform-api/__tests__/route-collision.test.ts`. Todd accepted
milestone 158 rollback and ordered this bounded capability in #4388 comment
`5666826318`; #7766 comment `5666729434` retains the original stop.

A reviewed delivery candidate's conflict now consumes one resolution in its
existing `native-refresh.json`. After aborting the conflicting integration, the
executor merges the reviewed head with that same current main and pins the
marked text as an intermediate merge commit. This input preserves both parents
and supplies a clean, repeatable base for the ordinary author lifecycle; it is
never an accepted delivery head. The existing author placement resolves only
the marked hunks. Text outside them (including line endings), other files and
file modes cannot change.
Only ordinary text conflicts with both sides present are supported; unsupported
conflicts stop as `conflict-resolution-unsupported`. Scope escape or author
failure stops as `conflict-resolution-scope-escape` or
`conflict-resolution-failed`.

The independent delta reviewer inherits the original review, author trace and
source records, plus the resolution author's captured execution evidence. It
checks the resolved hunks and direct callers for semantic expansion or lost
feature/main behavior at the exact resulting head. A failed review remains
`refresh-review-failed`; neither a clean merge nor author PASS supplies review
authority. The existing per-main refresh directory retains worker attempts,
terminals, candidate and review evidence. Restart resumes those workers and
reconciles interrupted commits; it does not reset implementation attempts,
participants or native launch charges. Ordinary worker retries remain inside
this resolution. A later conflict in the same delivery lineage stops as
`conflict-resolution-exhausted`, including across main movements and restarts.
Conflict-free refresh still uses the existing delta review without an author.

An exact remote/PR head with DIRTY or CONFLICTING status is a confirmed
publication with a conflict, including when a publish response was lost or the
PR already left draft state. Delivery retains its publication receipt and
`publication-conflict.json`, then revalidates actual remote and PR identity
before current-main integration. Unknown or wrong heads cannot authorize a
repeat mutation. The resolved head passes a new delta review and local gates,
then updates the same PR forward from its recorded remote head using the
existing lease. Hosted checks, native landing and verified deployment still
apply to the resulting head; prior gate and publication records remain history.

This capability does not reopen, unpark or restart the rolled-back JPEG run,
repair JPEG or PR #8005, alter preserved M2 runtime/worktrees, reset historical
reviews, or establish milestone completion. Milestone 158 remains incumbent-owned
and only milestone 155 remains platform-owned; milestone 159 needs Todd's
separate assignment. The historical rollback and stop evidence remain intact.

ISS-152 records ISS-146 (#457)'s `gate-failed:test` after author and independent
review PASS in `m1-iss146-147-20260914T2325`. Native delivery now captures the
complete gate output and terminal execution before considering correction.
The candidate terminal records the exact executable, arguments, working directory
and reviewed head. Recognized compiler, formatter or completed test assertion
diagnostics must name committed candidate files. The same command runs in an
isolated committed tree at the recorded delivery main base, with an offline,
frozen dependency install. Changed manifests or lockfiles remain unknown.
The candidate and base logs and terminal records remain in the delivery runtime.

Only a passing base control admits candidate attribution. Base reproduction
stops as `gate-base-failed:<gate>`. Startup, install, log I/O and cleanup failures
stop as `gate-host-failed:<gate>`; drift retains its workspace stop. Missing or
incomplete diagnostics, unsupported gates, timeouts, resource failures and mixed
causes stop as `gate-attribution-unknown:<gate>`. These stops do not dispatch a
correction or publish; host and unknown stops do not park the issue. No timeout
increase, test skip, passing subset or author opinion establishes attribution.

`gate-correction.json` beneath the accepted source reserves the existing single
local correction allowance across all gate names, original and refreshed
delivery, and gates before or after mirroring. Its author starts at the exact
failed head, retaining the main base and full implementation diff. The prompt
names the complete diagnostic artifact, command, failing identities, acceptance
and preserved source/review records and traces. Scope is the failure and its
direct causes. The ordinary native lifecycle retains attempts, terminals,
execution evidence and a descendant candidate in its `gate-correction` directory.
An independent DELTA reviewer inspects the correction and direct callers with
the predecessor review and correction execution evidence. Only this current
exact-head PASS authorizes changed code; the predecessor PASS stays unchanged.

All gates run again at the resulting reviewed head, including prior green gates
and after-mirror gates. Further main movement requires another delta review and
new receipts, without another correction allowance. Existing mirrors are observed
before mutation; publication intents still reconcile normally. Publication,
hosted checks, merge and applicable deployment remain mandatory at the final head.
Second candidate failure stops as `gate-correction-exhausted:<gate>`; author FAIL
or blocking DELTA review stops as `gate-correction-failed` or
`gate-correction-review-failed`. These are work stops with ordinary parking,
not another implementation attempt or pair. ISS-145's smaller authority refuses
the pair as `gate-correction-not-authorized`. Native launch ceilings, routing,
placements, participant history and bounded worker retries remain in force.

Resume observes the saved author or reviewer, reconciles an interrupted correction
commit, and uses `gate-correction-result.json` for subsequent delivery and refresh.
The first failure, original source and review records remain unchanged. `gate-stop.json`
retains a terminal gate stop; replay cannot bypass it by moving main. Completed
delivery reuses its receipts without another worker, publication or merge.
Legacy untyped failures supply no correction eligibility.

#457 remains unready until ISS-152 lands independently reviewed and hosted-green
and the host installs that stable executor. Landing permits the host to restore
readiness; it does not authorize restarting or editing the preserved run. Workers
do not change #457, its preserved records or worktrees, or the running executor.

ISS-156 records ISS-155's `gate-attribution-unknown:test` stop in
`m1-iss155-20260915T1900`: the provider fixture coupled a synthetic 10 ms
outage clock to real auth-process startup. A delayed synthetic helper reproduces
auth failure before HTTP; separating the real probe from logical error replay
reaches HTTP with the malformed payload and retains the same `[10]` wait.
The fixture checks helper invocation before HTTP and refreshed authorization
on each probe; the injected hanging-probe ceiling test and production behavior
are unchanged. This isolates the fixture race, not the retained aggregate's
load attribution. ISS-157 handles the separate saved-stop barrier; this repair
does not resume ISS-155 or alter its retained evidence.

ISS-157 records the separate saved-stop barrier in that same ISS-155 run.
Optional `gateStopAuthorization` has only `stateDirectory` (the accepted source
or repair directory holding `gate-stop.json`), `candidateHead` (the stopped
delivery head), `repairSha` (the landed repair), and `authorityUrl` (the host's
grant with review and executed hosted-green evidence). It stays outside source
fingerprints. Only ordinary delivery's `gate-host-failed:<gate>` and
`gate-attribution-unknown:<gate>` stops qualify, after fetching main and proving
the repair is present there and absent from the stopped head and base. Without
that grant the stop remains inert. A single `gate-stop-continuation.json`
reservation retains the original stop, gate logs/terminal, source/review and
history; its sibling directory owns fresh native refresh, independent exact-head
DELTA review and all local gates, including after-mirror gates. Replay resumes
workers and publication reconciliation with the existing PR and forward lease;
new failures retain a separate stop and cannot spend another recovery. Existing
correction, conflict, worker retry, native launch and implementation ceilings
remain in force. Pending learning notes finish before native admission. Hosted
checks, native landing and applicable deployment still bind the final head.
Only the host, after reviewed three-OS-green ISS-156/157 landing, may install
the stable executor with supervisors absent, supply the grant and resume the
same run. This change neither clears retained evidence nor restarts ISS-155,
changes its product work, or establishes M2 completion.

ISS-159 records the pre-worker `dependency-install-failed` stop for #8021 in
`m2-market-diagnostics-20260915T2345`; its old pnpm output remains unavailable.
Setup now retains each invocation's command, role, head, sanitized stdout/stderr
and terminal outcome in exclusive-create files inside that attempt's setup
directory. Bounded pipe pumps suppress credential markers through line endings,
URL authorities/tails through whitespace, and `file:` frames before any disk
write; capture failure terminates and reaps the child and cannot mean success.
Failure notes name only that role's evidence path, falling back to the existing
run-state anchor when the path exceeds the detail limit. Partial output is not
completion. Absent dependencies may replay once per native pass; present or
unknown dependencies without a completion receipt remain unknown. Pilot/source/
review order and offline frozen no-scripts flags are unchanged. At the same
controller root, a new validated executor may resume an old setup plan with only
`controllerRevision` excluded from comparison; every other plan field still
agrees, and old plans, invocations, stops and worker budgets remain unchanged.
This neither diagnoses pnpm's historical failure nor restarts the preserved run.

ISS-162 records the five dead `gpt-6-astra/high` author launches in
`m1-iss154-20260915T1004` attempt 1: every Codex credential was cooling down
(`503 auth_unavailable`), yet the models probe listed the model, because the
pool keeps a model listed while all of its credentials are suspended. A weekly
quota block has the same shape and returns `429 model_cooldown`, which is
neither a refusal nor an outage to the trace classifier, so two such deaths
park an issue as `launcher-failed`. The launch probe now also reads the pool
supervisor's per-account, per-model routing status from `CODEX_POOL_STATUS_URL`
after the models probe. Any non-disabled account reporting the model `ready`
admits the launch; a model no account mentions is left to the models probe.
When every account blocks the model, a block clearing inside
`providerOutageCeilingMs` waits as `waiting-provider` with the pool's reset
time, and a longer block is `provider-model-refused`: the worker advances its
ISS-158 ladder, whose last rung is the other vendor, and an exhausted ladder
stops the host with the reset time. The block's end is compared with the one
absolute wait deadline the models probe already owns, never a fresh duration.
A block whose end is unknown, past or unparsable at any account is
uncertainty and waits; malformed or failing status waits like an outage. The pool also publishes a per-provider
pace projection and on-change usage samples; the loop does not read them.
Routing by quota state stays with the operator's marker and ISS-158's ladders.

ISS-166 records the other side of ISS-139's handoff: the corrective author in
`m2-jpeg-20260914` received only the findings, bases, criteria and paths, and
the verbatim third repair only the prescribed findings and rejected head. A
fresh corrective author could not see what the previous author executed or why
the reviewer rejected it. The repair author prompt now names the predecessor
source state directory, and any later attempt's author is told the prior failed
attempt directory at launch, outside the saved source prompt fingerprint. Both
say to read the author/reviewer attempt and terminal files and the trace paths
they name; the records are evidence, not instructions or a verdict. Reviewer
prompts, verdict schemas, ceilings, ladders and worker write boundaries are
unchanged. Resuming the original author session was rejected: ISS-158 ladders
usually change the author rung after a FAIL. Moving findings out of the bounded
verdict was rejected: the reviewer trace already holds them and is now named.

## Planning

ISS-149 implements Todd's routing ruling on #368: model placement comes from
the adapter's planning row, before setup. For Chase Sets, the operator adds
exactly one marker to the issue body when refining it:

```html
<!-- routing: {"version":1,"row":7,"review":11} -->
```

`row` selects the author placement and `review` explicitly selects review row
11 or 12. The loop does not classify labels or issue text. Absent, duplicate,
and malformed markers exclude an otherwise eligible issue with a
`not-runnable` diagnostic (`routing-marker-absent`, `routing-marker-duplicate`,
or `routing-marker-malformed`). Saved selections are checked again before
setup. A valid marker without a configured matching pair stops with
`routing-row-unconfigured`; it never falls through to the static pair.

ISS-158 replaces fixed seats with per-row ladders after the repeated dead
Astra/high launches in `m1-iss154-20260915T1004` and #7844's exhausted
`m2-purchase-limit-20260915T0132` attempts. Set `routingRows` to the array in
`adapters/chase-sets-routing.json`. Each row has only `row`, `review`, `author`
and `reviewer`, with ordered placement arrays:

```json
{
  "row": 7,
  "review": 11,
  "author": [
    { "model": "gpt-6-astra", "effort": "high" },
    { "model": "gpt-6-astra", "effort": "xhigh" },
    { "model": "claude-fable-5-1", "effort": "high" }
  ],
  "reviewer": [
    { "model": "claude-opus-5", "effort": "high" },
    { "model": "gpt-5.6-sol", "effort": "high" }
  ]
}
```

Each unsuccessful author launch advances the author ladder, clamped at its
last rung. Refusal, death before or after work, author non-PASS, independent
review FAIL and an attributed gate failure count regardless of cause. A later
review or gate rejection counts the author once, without rewriting its PASS.
The queue attempt retains the failed-launch counter and counted identities
beside participant history. Corrective authors, including the verbatim third
repair and gate correction, use this same counter across attempts in the run.
No separate `repair` placement exists. Attempt and worker retry ceilings are
unchanged; a PASS never lowers the counter.

Reviewer ladders advance only on an explicit model refusal, before worker
items, or a models probe omission. Outages, unknown launch errors, malformed
reports, dead workers after work and verdicts never change reviewer placement.
Exhausted reviewer ladders stop with `provider-model-refused`. Refused workers
remain charged in participant history; probe refusals launch no worker.
Delta and corrective reviews retain the selected reviewer rung.

Empty ladders, repeated placements and the old fixed-seat shape are rejected;
there is no live-config migration. Reviewer models must be disjoint from all
author models. `routing-reviewer-not-independent` rejects overlap, and
`invalid-routing-fallback` rejects repeated reviewer models. The self ladder
is Astra/high, Astra/xhigh, Fable/high, with Opus/high then Sol/high review.
Static `author` and `reviewer` config fields remain the self adapter's fallback
only when its context has no routing row; Chase Sets requires `routingRows`.

Each launch persists a zero-based rung index before dispatch, then retains it
with the worker attempt and participant placement. Resume uses the recorded
rung. Learning notes include it; older records without a rung remain history.
`docs/model-selection.md` describes the shipped ladders and benchmark basis.
Workers still use the existing Codex launcher and account_pool provider.

`planning/roadmap.json` registers milestones and issues. Each issue has a
draft at `planning/drafts/<key>.md`:

```md
---
key: ISS-123
title: "Short imperative title"
labels: ["type:slice", "ready"]
milestone: "Exact milestone title"
blocked_by: [ISS-120, ISS-121]
---

## Why

## Done when

## Out of scope
```

`## Done when` accepts unordered `-`, `*`, or `+` items or ordinary top-level
`N.` ordered items, with indented continuation lines. The self adapter consumes
each item as one acceptance criterion; a section without supported list items
stops with `selected-issue-criteria-missing`, never a whole-body fallback.
ISS-153 fixes the ordered form recorded in ISS-152's pre-dispatch stop.

`pnpm planning:check` proves drafts and roadmap agree and the graph is
acyclic. `pnpm planning:board-check` proves every open registered issue on
GitHub carries the marker, the draft link and the verbatim draft, has the
right milestone, and sits on the delivery project once. Closed issues are
history and are not compared. The GitHub issue body is:

```md
<!-- planning-key: ISS-123 -->

Source draft: [`planning/drafts/ISS-123.md`](https://github.com/todd-skelton/orchestration-platform/blob/main/planning/drafts/ISS-123.md)

<verbatim draft>
```

To add work: write the draft, register it, create the issue with that body and
milestone, add it to the project, label it `ready` when unblocked. To park
work: close the issue with a note; leave nothing registered.

## Running

The loop runs on the WSL Ubuntu executor, not on Windows. The Windows Codex
sandbox refuses piped child output and its elevated setup needs a UAC prompt
that never completed, so the executor has its own Git 2.53, Node 24, pnpm,
`gh` and Codex CLI under `/root/orchestration-m1/tools`. Windows is covered by
hosted CI only.

- Executor checkout: `/root/orchestration-m1/repo` (this repository).
- Config: `/root/orchestration-m1/loop.json`; state under
  `/root/orchestration-m1/runtime/<run>`; worktrees under
  `/root/orchestration-m1/worktrees`; log `/root/orchestration-m1/supervisor.log`.
- Start from Windows (the launcher detaches itself and prints the PID):
  `wsl -d Ubuntu -- bash /root/orchestration-m1/repo/scripts/executor/run-loop.sh [config.json]`
- Check: `wsl -d Ubuntu -- tail -n 3 /root/orchestration-m1/supervisor.log`.
  A final `idle` line means nothing is runnable in the configured scope; it
  does not establish milestone completion while admitted work is blocked.
  A non-zero exit means a stop whose learning note is on the issue.
- Workers read `/root/orchestration-m1/codex-home/config.toml`, the executor's
  own Codex home, so that file selects the model provider. It routes through
  the local subscription pool on the Windows host, which listens on
  `127.0.0.1:8317` only, so `scripts/executor/pool-bridge.mjs` forwards the
  WSL-facing host address to it. Start the loop with
  `scripts/executor/start-loop.ps1` from Windows: it starts the bridge when
  needed. The versioned `scripts/executor/run-loop.sh` exports
  `CODEX_PROVIDER_BASE_URL` and `CODEX_PROVIDER_AUTH_COMMAND` (the same
  `/root/orchestration-m1/pool-key.sh` helper used by the Codex home) to the
  supervisor. Before each worker launch it probes the authenticated `/models`
  endpoint, printing `waiting-provider` every ten seconds while unavailable.
  `providerOutageCeilingMs` in the loop config defaults to thirty minutes;
  expiry posts a `provider-unavailable` note and exits without parking (ISS-129).
  `run-loop.sh` also exports `CODEX_POOL_STATUS_URL` (the supervisor's
  `/api/status` on port 8318, bridged like 8317); the launch probe admits a
  reported-ready model and otherwise defers genuinely unmentioned models to
  the authenticated models probe (ISS-162).
  Provider deaths spend native launches but preserve the implementation attempt
  and the single dead-worker retry. No worker holds a native Codex login.
- Chase Sets runs use `/root/orchestration-m2/repo` and
  `/root/orchestration-m2/loop.json` with the same tools (ISS-110).
- A Chase Sets config may set `"targetMilestone": 155`, using the positive
  repository milestone number, to limit the native pull window to that
  milestone (ISS-135). Product readiness, dependencies and exclusions still
  apply. An exhausted or blocked target reaches `idle` without selecting other
  outcomes. The default remains the unscoped native window; self runs omit
  this option. Queue composition verifies issue membership before worktree
  setup or author dispatch, including when resuming a saved selection. A
  mismatch stops the run with `selected-milestone-mismatch` and a host note;
  it does not park or complete the selected issue.

ISS-135 recovery for `m2-payout-fees-replanned-20260913`: with supervisors and
the interrupted #4382 author stopped, the host first preserves the runtime and
uses the reviewed stable executor with `targetMilestone: 155`. Restart with
the original `cycle-2-selected.json` present to verify the typed scope stop.
Preserve completed cycle 1 (#7821, PR #7973, merge `a9d697bd`, verified deploy
run `34767773892`) and the interrupted `cs-4382-attempt-1` records, source
worktree and traces unchanged. To rederive selection, the host explicitly
archives `cycle-2-selected.json` together with every `cycle-2-stop-*.json`
record, including stop completion receipts, outside the active scheduling
record locations. Those receipts belong to the original selection; leaving
them active can conflict with a later selection that reuses cycle 2. Restart
the same scoped run: with #7820 still `status:needs-operator`, it should reach
`idle`. Do not write a cycle 2 completion, invent a worker result, reset an
attempt budget, or delete the interrupted attempt. This is a specific host
reconciliation of the preserved incident, not an automatic migration. Seller
Payout Fees remains incomplete until its operator-blocked work is resolved.

## Milestones

| Key | Title                       | Exit evidence                                                                                                                                                                                                                             |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Unattended self-improvement | Three consecutive useful issues on this repo land through one `supervise` invocation with no per-item host script or manual step. The report states whether an automatic retry or restart occurred; planned restart recovery is separate. |
| M2  | Chase Sets delivery adapter | One low-risk Chase Sets milestone is delivered end to end through the loop with a `chase-sets` adapter.                                                                                                                                   |
| M3  | Chase Sets adoption         | Routine Chase Sets delivery runs on the platform; the `milestone-orchestrator` host loop is retired for routine work with a rollback.                                                                                                     |

## Not carried forward

Parked without registration on 2026-09-10; unpark only from a learning note:
N0 certification and self-promotion, credential broker, host custody and
reboot evidence, repository-protection receipts and verifier anchors, the
shadow-parity program, state import, portable-primitives and native-lock
experiments, module manifest and registry, routing engine, telemetry intake,
review calibration. The tree before the replan is tagged
`pre-replan-2026-09-10`.

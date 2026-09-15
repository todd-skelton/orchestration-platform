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
5. Transient failures get one automatic retry inside the same attempt: a
   failed typecheck or format gate, an unparsable verdict, a delayed exit
   receipt. Four attempts per issue, then stop.
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

The native config opt-in `"acceptedReplan": "cs-7766-plan-8014"` admits only
that plan, only in the recorded fresh run, with `targetMilestone: 158` and
`attemptCeiling: 4`. Native composition reads attempt 4, its publication,
source config and original `source/hosted-failure.log` from
`stateRoot/m2-jpeg-20260914/cs-7766-attempt-4`. Missing history or logs stops
before authoring. All nine prior participants, including failed reviews and
the dead author launch, remain charged to the native launch ceiling. The
original four attempts remain history; only this queue item admits attempt 5,
with ceiling 5. A current blocking review or hosted failure cannot dispatch
a sixth attempt or a repair pair. Ordinary transient retries remain bounded
inside this one attempt. Any stop exits this corrective invocation and its
note asks the host to propose rollback and wait for Todd.

The new queue uses `cs-7766-replan-8014-attempt-5` under the fresh run, with
matching pilot/source/review worktree names and a new `-g5` local branch.
Its author starts at the preserved rejected candidate, retaining the original
main base for the full implementation review. It does not rebase or edit the
old candidate/worktrees. Both workers receive the accepted scope and the
original attempt/source/trace and hosted-log paths. Current author completion
and independent exact-head review remain required. Native delivery uses the
existing forward-only PR refresh and observed remote-head lease to update
PR #8005's `-g4` branch from the new local branch. Cleanup removes only the
new source/review worktrees and local branch; it leaves the preserved local
`-g4` branch and worktrees intact. The published PR branch may remain remotely
unless GitHub deletes it after merge. Local gates, hosted green, native merge
and verified actual deployment remain mandatory.

To resume, the host first preserves both runtimes and all old worktrees while
the supervisors are stopped, then installs this reviewed implementation as
the stable platform executor. Add the opt-in above to the existing corrective
loop config; retain `run: "m2-jpeg-corrective-20260914T1402"`, the same
`stateRoot` and `worktreeRoot`, `targetMilestone: 158`, `attemptCeiling: 4`
and the existing native launch ceiling. Start from Windows using the canonical
`scripts/executor/start-loop.ps1 -Config <absolute-WSL-corrective-config-path>`.
Do not change or archive the old run's records or the fresh run's selection,
setup attempt or stop records. Native composition leaves them untouched and
resumes the dedicated attempt-5 directory. A repeated restart selects the
same attempt, including its failure or completion; changing the run name
cannot renew admission. Fresh #7766 authoring without this accepted replan
is refused. There is no new admission receipt or record migration.

This implementation does not restart either run, repair JPEG, touch PR #8005
from the host, or claim milestone 158 or ISS-110 exit evidence. After the
bounded cycle fails to land or a new loop defect stops it, the host proposes
rollback and waits for Todd; another config/run name is not authorization.

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
old gate receipts remain history. Its transient typecheck/format retry reruns
the same reviewed head once; a persistent failure stops, without an unreviewed
source correction or renewed implementation budget. Draft mutations are
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
the marked hunks. Text outside them, other files and file modes cannot change.
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

Set the loop config's `routingRows` to the array shipped in
`adapters/chase-sets-routing.json`. Each entry has `row`, `review`, author
`{model, effort}`, reviewer `{model, effort, fallback: {model, effort}}`, and
repair `{model, effort}`. For example:

```json
{
  "row": 7,
  "review": 11,
  "author": { "model": "gpt-6-astra", "effort": "high" },
  "reviewer": {
    "model": "gpt-5.6-sol",
    "effort": "high",
    "fallback": { "model": "claude-opus-5", "effort": "high" }
  },
  "repair": { "model": "gpt-6-astra", "effort": "high" }
}
```

The shipped author placements are Astra/high for rows 7, 14 and 15, Sol/high
for rows 4 and 10, Terra/medium for row 2, and Sonnet/medium for row 3. Review
11 is Sol/high with Opus/high fallback; review 12 is Opus/high with
Sonnet/medium fallback. Repair repeats the author placement. Rows 4 and 10
must use review 12; row 3 must use review 11. Other shipped author rows offer
both choices. The omitted combinations would make the primary or fallback
reviewer equal the author. Configuration rejects that overlap with either
author or repair, and rejects Terra and Fable reviewers.

The self adapter returns row `self`: Astra/high author and repair, Opus/high
reviewer with Sol/high fallback. Existing static `author` and `reviewer`
config fields remain accepted only as the self adapter's fallback when an
adapter context has no routing row. Chase Sets requires `routingRows` and
ignores any static pair. Workers still use the existing Codex launcher and
account_pool provider; no Claude Code launcher is introduced.

Reviewer fallback occurs only when the models probe omits the primary model
or the launch reports an explicit model refusal before any worker items.
An outage, unknown launch error, malformed report, dead worker after work,
or PASS/FAIL verdict does not select a different model. A refused launch
that created a worker remains charged in participant history; a probe refusal
does not launch a worker. A running fallback and its ordinary retries retain
the chosen placement on resume. There is only one fallback, and its refusal
stops the host. Corrective authors and gate corrections use the repair
placement; delta reviews use the selected reviewer policy.

Queue attempts retain the routing row and participant history; worker attempts
and participants retain exact model/effort placements and author/reviewer
models (reviewer is null until launched). Learning notes include the row and
actual launch placements and outcomes, including refused launches. Older
records without placements remain unrecorded history. This adds row defaults,
not incumbent quotas, reserves, spend accounting, or model classification.

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

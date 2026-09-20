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
   the only required check on a PR. The loop observes its own
   `REQUIRED_CHECKS` before merging, unchanged;
   `node scripts/planning/require-bootstrap-checks.mjs check` reports whether
   GitHub currently requires those same three contexts on `main` (ISS-175).
4. Review is a verdict (PASS or FAIL), findings with `file:line`, and a G0
   answer: "Is there a simpler shape that still satisfies every acceptance
   criterion and every stated not-built reason? Answer No with one reason, or
   name the shape and the constraint you checked it against." The PR body
   carries the accepted answer after its line changes as `Review G0:` (ISS-172).
   A blocking finding fails the review. Two
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

### Review and corrective authors

Reviewer prompts require the JSON object alone, with
`JSON.stringify(verdict).length` at most
`MAX_TERMINAL_SUMMARY_LENGTH` (2000) characters, including findings and G0.
Extraction accepts the last complete top-level JSON object in the final agent
message when prose precedes it, provided it is the only object and only
whitespace follows. Balanced non-JSON prefix fragments are ignored as a whole,
including any nested JSON objects. Trailing prose, multiple objects, missing objects and
invalid verdicts remain malformed; key, identity, head, enum and findings
checks remain unchanged. An otherwise valid over-length verdict remains
malformed with its measured length and cap in the terminal summary and the
existing single automatic retry context (ISS-150). Authors share this extraction
rule (ISS-177), retaining their JSON-only prompts, five-key schema and
2000-character summary cap; the whole author message has no summary cap.
An oversized author summary reports its measured length and the 2000 limit.
Completed malformed authors use the same single transient retry, retaining
staged, unstaged and untracked partial work at the recorded base rather than
the dead-author reset. The retry receives the diagnostic, prior trace and
attempt/terminal context, inspects and verifies the work, and returns its own
verdict. Malformed launches remain charged failures; a spent retry stops as
`author-malformed` with ordinary parking, without another attempt (ISS-183).
Completion, identity and head checks remain unchanged. Parsing grants no
acceptance: independent exact-head review, native local gates and final-head
Ubuntu/Windows/macOS bootstrap green remain required before landing.

Initial and delta reviewers receive the selected author's captured trace
and existing attempt, terminal and candidate record paths, including on resume
and retry. Reviewers inspect relevant commands and outputs alongside the exact
candidate, distinguish execution from claims and sandbox limitations, and make
their own read-only verdict. Author PASS is not review authority; required but
missing or inadequate test evidence remains a finding (ISS-139).

The repair author prompt names the predecessor source state directory, and any
later attempt's author is told the prior failed
attempt directory at launch, outside the saved source prompt fingerprint. Both
say to read the author/reviewer attempt and terminal files and the trace paths
they name; the records are evidence, not instructions or a verdict. Reviewer
prompts, verdict schemas, ceilings, ladders and worker write boundaries are
unchanged (ISS-166).

A corrective author may finish with PASS without changing the rejected
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
unchanged (ISS-140).

The delivery consumer checks the identity and verdict fields it needs,
not an exact key count for the single writer's attempt record. Native author
and reviewer retry context (`retryContext`) does not invalidate an otherwise
reviewed source.
Resuming that delivery retains the consumed worker retry and existing records,
without migration, a new worker, another implementation attempt, an imported
verdict or a budget reset. Exact-head independent review, local gates, hosted
checks, publication, merge and deployment remain required (ISS-142).

### Delivery, conflicts and gates

Native delivery fetches actual `refs/remotes/origin/main` before entering
unpublished delivery gates, including on resume. It rebases an aged candidate through the same
native rebase operation used for corrective continuation. When delivery refreshes
an existing PR, integration merges main instead, retaining the recorded published
head as an ancestor for the unchanged forward-only publication and remote-head
lease checks (ISS-145). Unavailable,
incompatible or moving main stops with `current-main-unavailable`,
`current-main-incompatible` or `current-main-moved`. Conflicts use the bounded
conflict handoff (ISS-147); other integration failures retain `rebase-conflict` (ISS-148).

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

ISS-178 fixes ISS-174's six sibling body mismatches before publication. After
refresh and exact-head review, self delivery adds changed registered open sibling
drafts to its existing mirror plan, using candidate versus refreshed-main bodies.
Sibling mirroring changes only the body: registration, frontmatter and project
changes refuse. Independent review must authorize the prose under the selected
brief; a changed path alone grants no authority. The selected issue retains its
seed and full-draft behavior.

Each sibling is observed again before applying or replaying the saved plan.
Missing, duplicate, reopened or retargeted identities refuse with the sibling key;
the issue census includes the latest reopening event for this comparison. Closed
siblings receive no writes and remain ignored by the scoped board gate. Open
title or milestone drift refuses even when the body matches. A target body is a
no-op, a main-base body permits one body-only edit, and any other body refuses.
Existing draft receipts reconcile lost responses; replay reobserves completed
drafts too. No new receipt format or migration is involved. Unchanged siblings
are never repaired. Later closure does not remove the candidate's authored hunk.

Ahead-of-main mirrored bodies still fail fresh full-board selection. The single
writer finishes delivery, then selection pins published main. Saved selections
keep their pinned brief and identity. Abandonment requires a separate host
decision authorizing restoration; there is no rollback or selection overlay.

A reviewed delivery candidate's conflict consumes one resolution in its
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
`conflict-resolution-failed` (ISS-147).

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

Conflict boundaries use anchored literal prefix/suffix checks
and an ordered, non-overlapping forward scan of the intervening fixed text.
The Git hunk grammar, immutable outside bytes and bounded resolution lifecycle
are unchanged (ISS-155).

Native delivery captures the complete gate output and terminal execution before
considering correction.
The candidate terminal records the exact executable, arguments, working directory
and reviewed head. Recognized compiler, formatter, completed test assertion or
Chase Sets scoped static generated-artifact staleness diagnostics
(`<repo-relative path> is stale|missing` from a `generate-*.mjs --check`
producer, wholly accounting for the final `[VERIFY_STATIC_RUN]` block) must
name committed candidate files. The same command runs in an
isolated committed tree at the recorded delivery main base, with an offline,
frozen dependency install. Changed manifests or lockfiles remain unknown.
The candidate and base logs and terminal records remain in the delivery runtime (ISS-152).

Only a passing base control admits candidate attribution. The scoped static
base control receives the candidate's derived changed-file set as
`CHANGED_FILES_JSON`, and its pass counts only when the failing link's
`[VERIFY_STATIC_RUN]` marker appears in the base log; a vacuous base selection
stays unknown (ISS-192). Base reproduction
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
not another implementation attempt or pair. Accepted-replan authority refuses
the pair as `gate-correction-not-authorized`. Native launch ceilings, routing,
placements, participant history and bounded worker retries remain in force.

Resume observes the saved author or reviewer, reconciles an interrupted correction
commit, and uses `gate-correction-result.json` for subsequent delivery and refresh.
The first failure, original source and review records remain unchanged. `gate-stop.json`
retains a terminal gate stop; replay cannot bypass it by moving main. Completed
delivery reuses its receipts without another worker, publication or merge.
Legacy untyped failures supply no correction eligibility.

Complete failed-run logs live in the delivery runtime's `hosted-failure.log`,
with exact candidate, publication and failed check/run URLs. Each run is fetched
once even when several jobs fail. Corrective author and reviewer launches get
the absolute evidence path rather than raw logs in prompts or terminal reports.
They inspect underlying diagnostics independently; this supplies neither a
verdict nor a waiver, and all ordinary delivery gates remain mandatory (ISS-141).

For a receiptless author, the observer validates the trace identity and waits
the existing receipt window.
Only an absent PID with no terminal turn becomes `dead`; a still-live process,
unknown process/trace identity or completed turn is not reclassified. No exit
receipt or worker verdict is invented. The ordinary single dead-worker retry
acquires missing logs from the previous attempt's existing publication before dispatch or
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
launches use the runtime file without refetching.

ISS-185 binds hosted decisions and failed logs to Actions' structured repository,
PR, source/base and head association. It selects the latest run within each
owning workflow and that run's current effective jobs, including failed-only
reruns; shared-SHA rollup rows supply no authority. Logs pin the selected attempt
and recheck it after acquisition. Unknown attribution stops observation without
parking or spending another attempt; old unattributed logs remain unchanged.
Same-selection lifecycle status changes keep ordinary observation pending when
either validated workflow snapshot is non-completed; immutable workflow/run/attempt
identity and publication/job validation still apply. Terminal non-success retains
its existing handling, with no extra polling or retry allowance (ISS-188).
When the current publication's workflow runs are absent, the checks adapter
waits ten seconds and reobserves, at most twelve times in that observation
call (two minutes of waits, plus API request time). Foreign and advisory rows do not
prevent this startup retry. Each poll revalidates exact publication identity.
An attributed current workflow run leaves startup retry and follows
the existing validation; wrong-head/PR, malformed, duplicate, failed or skipped
required evidence is not converted into success. Persistent absence still
stops through the non-parking hosted-observation path. A current pending workflow follows
ordinary observation until actual required green, with no republishing or
worker/implementation retry budget consumed. A host interruption can repeat
this bounded in-flight observation under rule 9; no new runtime schema or
migration is required (ISS-143).

### Saved-cycle recovery

ISS-187 permits one self prerequisite detour declared by `prerequisite` on the
existing 64-launch/four-attempt run: `blockedCycle`, `blockedKey`, `blockedNumber`,
completed run-scoped `stop`, prerequisite `key`/`number`, and `authorityUrl`.
Admission requires ordinary current eligibility, a retained pinned source FAIL
at attempt 1, and no live or uncertain competing owner. Its supervision records
live under `prerequisite/`; ordinary same-run queue paths retain the charges and
enter attempt 2, including native repair/advance through the existing ceiling.
Keep that executor installed throughout the detour. Delivery, parking and host
stops yield; restart resumes the same lineage. Terminal replay holds the saved
cycle until the operator removes the declaration and supplies
`blockedCycleResume: { cycle, authorityUrl }` with a different host grant, after
separately landing and installing its repair. Neither the declaration nor this
capability authorizes installation, readiness or preserved-run execution.

Native resume observes an unfinished saved selection's issue before
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
native delivery, hosted green, merge, deployment or milestone exit evidence (ISS-144).

A matching native source-author FAIL parks the item through ordinary stop
handling and advances to unrelated ready work. Before reconstructing a saved source, supervision validates the
current executor and observes the saved attempt, source configuration and
matching failed author terminal. It reconciles pending notes and replays the
original author stop's marker, body and ordinal, including when an old run-stop
completion or a later pilot stop exists. An old note completion does not prove
parking. The ordinary cycle completion then retains accumulated participants;
repeated resume does not replay the failed source or launch attempt 2 (ISS-161).

Old attempts, selections, source/setup records, terminals, stops and worktrees
remain unchanged. Failure counts and spent allowances remain history; later
launches still consume the run's ceiling. Missing or mismatched terminals,
unfinished authors and non-FAIL results cannot establish this transition.
Source pilot/configuration checks and executor drift refusals remain in force.
Parking leaves the self issue open and unready; only explicit planning unpark
can admit it again.
Terminal repair-author FAIL likewise parks through matching retained evidence; explicit same-run planning unpark admits only the next unused implementation attempt within the existing ceiling, preserving history and charged allowances (ISS-181).

Before scanning failed attempts, composition observes the matching failed
author terminal at the pinned conflict seed or a parked source-author failure
at its matching pinned configuration and base, and advances the attempt to failed
once (ISS-179). A source failure retains its history and author failure count,
with its base as head, an empty review identity and no findings. A conflict retains
the original base, attempt number and historical review identity/findings, recovers native
participants, and clears the accepted stage and directory. Source, review,
refresh, worker, stop and completed-stop records and the old worktree remain
unchanged. Nonfailed and in-flight authors do not establish this transition (ISS-160).
Composition also advances a parked delivery-phase refresh-review failure once,
at its reviewed refresh head and with the reviewer's findings, before scanning
failed attempts (ISS-195).

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

### Pinned self selection

Before each fresh self selection, supervision fetches current main and pins one
immutable commit as both the source base and `planningRevision`. Installed code
reads the full draft tree and roadmap through the configured Git executable,
then validates the complete board census. Queue composition reads the selected
brief and loop rules from that same commit, including after restart or later
main movement. No fetched JavaScript executes, checkout moves, or scratch
worktree is created for these reads. Rules may describe uninstalled behavior;
they grant no authority to execute it (ISS-163).

Before a selection is persisted, Git acquisition failure blocks with
`current-main-unavailable` and board acquisition failure (including incomplete
pagination/census) with `issue-observation-unavailable`. Acquired planning or
board mismatches remain `queue-internal-error`. All retain the originating
diagnostic in supervisor blocked output, without an issue note, parking,
fallback or polling. Registration ahead of its board item also refuses; the
operator may retry the same run once the two authorities agree.

Saved selections resume without selection or fetching. The optional
`planningRevision === base` is a transitional behavior marker, not separate
provenance. Its absence retains executor-root brief/rules reads, including
direct adapter calls, so existing source fingerprints remain strict and legacy
records remain byte-identical. There is no backfill, migration or fingerprint
waiver. Chase Sets selection, routing and context are unchanged. Retire the
producer and compatibility branch only at a reviewed stopped-install cutover
after an operator's read-only census finds zero unfinished or re-enterable
pre-cutover self cycles, legacy or marked; completed history stays readable.
This is not a time-based sunset and authorizes no census here.

## Running

Host installation requires independent exact-head PASS and three-OS bootstrap
green with supervisors absent. Landing a repair alone authorizes no executor
installation, restart, unpark or milestone exit. Preserved runs require separate
host authorization to resume; workers leave their runtime, worktrees, partial
work, candidate commits, stops and historical verdicts unchanged. Landing a
loop repair does not repair preserved product work, rerun its hosted CI or
establish M2 completion; existing rollback and milestone ownership remain intact (ISS-139, ISS-141, ISS-144,
ISS-147, ISS-154, ISS-160, ISS-161, ISS-163).

Readiness for ISS-146 requires independently reviewed, hosted-green ISS-152
landing and host installation of that executor; dispatch additionally requires
Todd's amended answer and explicit planning unpark (ISS-152, ISS-160).
Milestone 158 remains incumbent-owned, only milestone 155 remains platform-owned,
and milestone 159 requires Todd's separate assignment (ISS-147).

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

ISS-176 adds optional `opsAdmission: { issueNumber, authorityUrl }` only for
`chase-sets` on `chase-sets/chase-sets` with a positive `targetMilestone`.
The exact two-field object names one positive safe integer issue number and a
canonical HTTPS issue-comment URL in that repository (positive issue/comment
IDs, at most 500 characters, no query, credentials or whitespace). Invalid
admission stops as `invalid-ops-admission` before selection. The operator supplies
the ruled issue/target reference; URL shape is not approval.
Omission excludes all `kind:ops`. Admission relaxes only that exclusion for the
named issue in the target, preserving refinement, executable window, blockers,
needs labels, routing and ordinary priority order. Current ops context is checked
again before setup, including saved selections with admission removed; membership
is checked without displacing saved work with a higher-priority sibling.
`selected-ops-not-admitted` and `selected-ops-not-runnable` are non-parking host
stops; milestone drift retains `selected-milestone-mismatch`. Incomplete authority
cannot admit work. Existing records and fingerprints are not migrated. This
supplies no pilot readiness, installation or start authority; independent review,
local gates and final-head three-OS bootstrap remain required.

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

### Worktree setup and provider admission

New ordinary attempts use the local source branch
`codex/run-<sha256(run)>/<issue-key>-attempt-<attempt>`; the hash keeps every
accepted run name valid in a Git ref. Pilot and review remain detached.
Resume reads the branch and pilot revision from the existing setup plan, including
legacy names; matched same-checkout replay validates the live repository against
the current executor without repinning the pilot (ISS-180).
Published branch names, PR identity and forward-only refresh rules stay the same;
delivery publishes the candidate to that existing name and cleans up its own
local branch. A preserved worktree is never removed, moved or reused by a fresh
attempt. A remaining branch checkout collision stops as `worktree-collision:source`
with the holder's path in the stop diagnostics. Worktree directory collisions
still stop; fresh runs need distinct worktree roots. If an existing PR fails
publication identity checks, `publication-state-unknown` also names any preserved
worktree holding that published branch; the local naming change does not admit
that PR. ISS-145's accepted-replan branch and preservation behavior are unchanged (ISS-151).

Setup retains each invocation's command, role, head, sanitized stdout/stderr
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
agrees, and old plans, invocations, stops and worker budgets remain unchanged (ISS-159).

The pool keeps a model listed while all of its credentials are suspended.
A weekly quota block returns `429 model_cooldown`, which is neither a refusal
nor an outage to the trace classifier; two such worker deaths park an issue
as `launcher-failed`. The launch probe also reads the pool supervisor's per-account, per-model
routing status from `CODEX_POOL_STATUS_URL`
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
Routing by quota state stays with the operator's marker and ISS-158's ladders (ISS-162).

Vitest runs files serially with one worker to bound competing real-Git fixtures;
every test and the existing test/hook timeouts remain in place for local and
hosted bootstrap gates (ISS-160).

A delayed synthetic helper reproduces auth failure before HTTP; separating the
real probe from logical error replay reaches HTTP with the malformed payload
and retains the same `[10]` wait. The fixture checks helper invocation before
HTTP and refreshed authorization on each probe; the injected hanging-probe
ceiling test and production behavior are unchanged. This isolates the fixture
race, not the retained aggregate's load attribution (ISS-156).
Saved-stop recovery needs the separate authorization below (ISS-157).

### Accepted replans and stopped-gate recovery

Accepted replans retain the original main base and participant history;
published continuations use forward-only refresh from a new local branch to
the existing published branch. Historical records, branches and worktrees stay
unchanged, with no migration or restart authorized. The singleton string
configuration is replaced by the accepted-replan packet (ISS-145, ISS-154).

`LoopConfig.acceptedReplan` is an exact-key object (ISS-154). Its closed fields are:

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
  traversals or absolute paths. For the purchase-limit continuation the sole path is
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

The ruled purchase-limit continuation permits one final Astra/high correction
of the unsupported `fromVersion: 0` reads in the day +0/+1 source-retry
concurrency cases, followed by exact-head PostgreSQL host evidence and fresh
Sol/high review. Any work non-PASS parks at absolute ceiling five; there is no
attempt six or second repair. After reviewed three-OS-green landing, only the
operator may advance the stable executor with both supervisors absent and
write the exact ruled continuation config. After author PASS the operator runs
the installed PostgreSQL host verifier and resumes the same run with its bundle.

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
same run (ISS-157).

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

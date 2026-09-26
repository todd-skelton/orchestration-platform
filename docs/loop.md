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
`MAX_TERMINAL_SUMMARY_LENGTH` (4000) characters, including findings and G0.
That one constant, exported by `scripts/dogfood/terminal-summary.mjs` and
declared without restating its value, drives the adapter bounds, `parseReview`,
the flow length branch and every reviewer prompt. ISS-198 raised it to 4000
after `m1-iss167-20260921T1457` discarded a schema-valid 2036-character PASS
verdict; the bound stays finite and is not removed.
Extraction accepts the last complete top-level JSON object in the final agent
message when prose precedes it, provided it is the only object and only
whitespace follows, or the object sits alone inside one well-formed Markdown
fenced block: the opening fence line immediately precedes it and only the
closing fence follows (ISS-198, after the same run discarded a fenced
schema-valid verdict). Balanced non-JSON prefix fragments are ignored as a
whole, including any nested JSON objects. Trailing prose, a second fenced
block, multiple objects, missing objects and invalid verdicts remain malformed;
key, identity, head, enum and findings checks remain unchanged. An otherwise valid over-length verdict remains
malformed with its measured length and cap in the terminal summary and the
existing single automatic retry context (ISS-150). Every discard appends to its
reason a JSON-quoted excerpt of the discarded message, at most
`MAX_VERDICT_EXCERPT_LENGTH` (600) characters taken half from each end, so the
retry sees what was lost without an unbounded prompt (ISS-198). Authors share
this extraction rule (ISS-177), retaining their JSON-only prompts, five-key
schema and the same `MAX_TERMINAL_SUMMARY_LENGTH` summary cap; the whole
author message has no summary cap.
An oversized author summary reports its measured length and that limit.
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
ISS-211 addresses the draft/note observation stops in `m1-iss210-20260925T0020`:
only primary draft reads (including mutation confirmation) and learning-note
reads retry classified GitHub transport failures, with three attempts and
1-second then 2-second waits. Sibling census and other issue reads stay single-shot.
After any comment response, a fresh marker observation reconciles acceptance;
only a proved pre-send failure plus fresh absence permits one additional post
in that call. A comment HTTP 5xx is uncertain, never pre-send. Exhausted reads
or an unresolved post retain the non-parking unknown stop and pending intent;
saved records and restart reconciliation are unchanged.
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
never an accepted delivery head. The existing author placement resolves the
marked hunks; text outside those hunks (including line endings) stays immutable
in every captured conflict file K.
Only ordinary text conflicts with both sides present are supported; unsupported
conflicts stop as `conflict-resolution-unsupported`. Scope escape or author
failure stops as `conflict-resolution-scope-escape` or
`conflict-resolution-failed` (ISS-147).

ISS-199 admits necessary unmarked preservation edits after ISS-146's cycle-10
conflict author recorded that its hunk-only scope prohibited them. Before a
new conflict author, the existing refresh record retains a census bound to
reviewed candidate C, integration main M and seed S (whose parents are C and M).
K is exactly the native captured conflict set, never rederived. U contains
only paths outside K present at the same exact path in all three immutable
Git trees as mode `100644` blobs without NUL, with C different from M and S
different from each. Empty files are text. NUL-delimited tree records preserve
spaces and tabs; comparisons do not infer renames, inspect import graphs or
run gates on the marked tree. The record saves sorted K/U and each path's
C/M/S blob IDs before launch. Git/read/save failure retains ordinary setup
error handling; it cannot mean an empty census.

Ordinary unfenced resolution may edit U only to preserve both parents' intent.
Overlap is neither proof of breakage nor a repair obligation: U may remain
unchanged. Changed U files must remain regular text without conflict markers.
Additions, deletions, renames, mode changes, symlinks, binary conversions and
edits outside K union U remain scope escapes. K always retains its literal
hunk-only boundary. A separately ruled `correctionPaths`/`allowedPaths` fence
retains its narrower K-only contract even for a U path named in the packet;
the captured-K fence still runs before seed and launch. Unsupported native
capture never enters the census. The consumed ISS-146 packet gains no edit
permission, relaunch or resolution renewal.

Author and DELTA prompts retain the complete census; stop diagnostics point
to `native-refresh.json` while the ordinary published excerpt stays bounded.
Replay uses that saved census and seed, not newer main or author edits. A
missing census can be computed before the first worker configuration is pinned;
legacy pinned, in-flight and completed workers keep their old K-only contract
without backfill. Existing retry and commit reconciliation remain in place.

The independent delta reviewer inherits the original review, author trace and
source records, both parents and any saved census, plus the resolution author's
captured execution evidence. It checks the resolved K hunks, every changed U
file and their direct callers for semantic expansion or lost feature/main
behavior at the exact resulting head. Census membership and old PASS are not
acceptance. A failed review remains
`refresh-review-failed`; neither a clean merge nor author PASS supplies review
authority. The existing per-main refresh directory retains worker attempts,
terminals, candidate and review evidence. Restart resumes those workers and
reconciles interrupted commits; it does not reset implementation attempts,
participants or native launch charges. Ordinary worker retries remain inside
this resolution. A later conflict in the same delivery lineage stops as
`conflict-resolution-exhausted`, including across main movements and restarts.
Conflict-free refresh still uses the existing delta review without an author.

ISS-167 continues one such exhausted reviewed integration in the same run without
another source attempt, after #457's attempt 2 stopped as
`continuation-failed`/`conflict-resolution-exhausted` with its PASS review intact.
The optional closed `integrationContinuation` packet
(`dogfood-integration-continuation/v1`) names the repository, issue key and URL,
the same run, the retained attempt directory and absolute attempt, the completed
stop marker, the reviewed head and review identity, the ruling URL and the ruled
`allowedPaths`. It applies only when that issue is selected again through explicit
planning unpark; unrelated work composes as usual. Before setup, composition
observes the failed attempt record, its pinned source, candidate and PASS review
terminal, the refresh with `resolutionUsed` and no seed, head or publication, and
the completed stop; any mismatch refuses without a claim. The lineage is then
claimed once in a `wx` file under `stateRoot`, outside every run, so a changed
packet, marker, run or directory cannot spend it again, and no composition without
the packet renews a reviewed-exhausted attempt on this host
(`integration-continuation-required`). The old attempt, its worktree and the
run's accumulated participants (including later cycles) stay unchanged and charged.

The item keeps the attempt identity and starts delivery directly in one
`integration` directory beneath the retained attempt, with new worktrees and a new
local branch from the reviewed head; no source author, terminal or review is
invented. Ordinary native refresh merges current main, which must descend from the
recorded main, so the seed's parents are exactly the reviewed head and that main.
Its own single resolution allowance applies with the retained ISS-158 counter and
the one shared worker retry: unmerged files and hunks are captured before any
launch, an unmerged path outside `allowedPaths` stops as
`conflict-resolution-scope-escape` and a non-text conflict as
`conflict-resolution-unsupported` with zero launches, and the existing validator
restricts edits to marked hunks inside those paths. A clean merge needs only the
DELTA reviewer. Fresh exact-head DELTA PASS, all local and after-mirror gates,
publication, hosted checks and native landing remain mandatory; gate correction is
`gate-correction-not-authorized`, a later main conflict is exhausted without renewal,
and any work failure parks the issue as `continuation-failed` while unrelated work
advances. Replay resumes the same integration and its claim; a parked integration
cannot be replayed into another author, attempt or publication.

ISS-200 adds the optional `spentResolution` case to that same v1 packet for one
unpublished integration whose conflict author failed at its retained seed. The
original fields must still match the original lineage claim byte for byte. The
case names `claim`, the later completed `stopMarker`, `failedAuthor`, `main`,
`seed`, a fresh `authorityUrl` and exact `authorityBody`, and `resolutions` and
`preservation` arrays of `{path, semantics}`. Resolutions enumerate captured K;
preservation permits only the explicitly ruled subset of the seed-bound U census.
Old allowed paths and ordinary U membership grant no new permission. K's fixed
bytes and line endings remain immutable; unchanged U is permitted.

Before setup, admission matches the failed integration and seed-bound terminal,
source PASS, C/M/S, spent claim/resolution and completed stop, and refuses any
publication or publication intent. Before its first reservation it captures the
fresh GitHub comment's author (`todd-skelton`), ID, URL, body and UTC observation
time; the body must equal the packet and contain the enumerated semantics. The
host must interpret and authorize that ruling: text matching and URL syntax do
not establish approval. One exclusive-create `spent-resolution.json` under the
retained integration binds the packet, capture, inherited accounting and one
`spent-resolution/` directory. Replay uses that reservation without another
probe or allowance. Changed packets cannot spend it again. All old records,
worktrees, partial work and the original claim remain unchanged.

The new worktrees start at S. Native refresh saves a new ISS-199 census before
author dispatch, then uses the existing resolver and independent DELTA lifecycle.
No-op cannot accept S. The remaining shared mechanical retry and charged history
carry forward, allowing at most three launches (two if the retry was spent),
within the unchanged run ceiling. Later main must descend from M and is merged,
never rebased over S; a clean refresh needs a new DELTA within that same bound.
A further conflict or work failure parks as `continuation-failed`, with no source
repair, gate correction, new attempt or chained recovery. Host uncertainty keeps
its ordinary non-parking stop. Fresh final-head local and after-mirror gates,
publication, hosted checks, landing and deployment remain required. Delivered or
parked replay stays inert; external closure carries only participant history.
This capability supplies no #457 ruling, planning re-entry, installation or
preserved-run resume authority. Host installation still requires independent
exact-head PASS, three-OS bootstrap green and absent supervisors.

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
with exact candidate, publication and failed check/run URLs. Failed logs are fetched
once per run even when several jobs fail; cancelled logs are fetched separately
once per job because GitHub's `--log-failed` omits them (ISS-206). Both wait for
the completed run and revalidate attribution after acquisition. Bootstrap's
`smoke` matrix jobs have a 100-minute job limit; expiry is failure evidence,
never green. Corrective author and reviewer launches get
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

ISS-184 completes Chase Sets post-merge observation when the exact owning
Platform Deploy run succeeds with a successful release-scope step whose raw
job log reports `deploy="false"`, and staging, image build and production are
consistently skipped. Its supervisor log identifies the scope, cumulative paths
and skipped jobs as a deployment leg unexercised, separately from the latest
executed staging image verification's commit, digest and timestamp. Missing or
ambiguous accounting remains unresolved; historical Actions evidence is not a
fresh provider-health observation. Required deployment still needs successful
immutable-image verification, with the existing 45-minute/30-second polling.
Saved native merge/cleanup obligations precede external-closure completion and
fresh issue composition. Existing delivery records validate the retained head
before the repository hook runs, even after worker worktrees have been removed.
Only ordinary missing cycle completion is written; no worker, publication,
merge, cleanup, eligibility waiver or historical record rewrite is involved.
This grants no executor installation or preserved-run restart authority.

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
<!-- routing: {"version":1,"row":2,"review":11} -->
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
and `reviewer`, with ordered placement arrays (current ISS-203 row 2 shown):

```json
{
  "row": 2,
  "review": 11,
  "author": [
    { "model": "gpt-6-luna", "effort": "high" },
    { "model": "gpt-6-luna", "effort": "xhigh" },
    { "model": "gpt-6-sol", "effort": "medium" },
    { "model": "claude-sonnet-5", "effort": "medium" }
  ],
  "reviewer": [
    { "model": "claude-opus-5-5", "effort": "high" },
    { "model": "gpt-6-astra", "effort": "high" }
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
`invalid-routing-fallback` rejects repeated reviewer models. The current self ladder
is Astra/high, Astra/xhigh, Fable/high, with Opus 5.5/high then GPT-6 Sol/high review.
Static `author` and `reviewer` config fields remain the self adapter's fallback
only when its context has no routing row; Chase Sets requires `routingRows`.

ISS-203 applies the complete provisional matrix in `docs/model-selection.md`
to all fourteen Chase pairs, retaining self unchanged. Row 2 authors are
Luna/high, Luna/xhigh, Sol/medium, Sonnet/medium, with Opus then Astra review.
Row 3 authors are Opus/medium, Opus/high, Astra/medium, with Sol then Sonnet
review. Row 15 authors are Opus/high then Astra/high, with Sol then Sonnet
review; Opus/max is removed and later failures clamp at Astra/high. Rows 4,
7, 10 and 14 retain their existing ladders. Both review seats use high for
review 11 and medium for review 12, with models disjoint from every author rung.
Every author tail is the other vendor; row 15's benchmark-based Opus/max skip
joins the historical row-10 Sol/xhigh exception to effort-before-model.
Sonnet review tails provide weaker refusal-only continuity, never a quality
escalation. Reviewer exhaustion still stops the host with the pool reset time.

These placements use the September 23 research report cited in ISS-203, not
local quality certification. Weighted API benchmark USD/task is not subscription
spend or accepted-artifact cost; provider-fallback Opus/Fable cells do not
establish pure-model performance, reviewer recall, UI fit or a service bar.
The documented same-row checkpoint and quality, latency, resource and exhaustion
triggers require operator judgment, not automatic routing or trial authority.
Failure-count advancement, repair/delta behavior and all ceilings remain unchanged.

ISS-203 cutover is only for separately authorized fresh runs and paths, after
independent exact-head PASS and final-head three-OS bootstrap green, with
supervisors absent. Immediately before an authorized install, the host captures
native account_pool/CLI admission for every exact target model/effort, with UTC
instant, identity and result. Catalogue presence, earlier probes and fixtures
establish neither timely admission nor quality. Workers touch no live executor,
WSL run, provider or runtime. No installation, probe, start, unpark, host rotation
or attempt renewal is authorized here. Saved configurations, fingerprints,
histories, participant identities/rungs, attempts, retries, charges and ceilings
remain intact: same-config replay keeps its rung, and changed ladders still refuse
`conflicting-run-configuration` before launch, without alias, backfill or waiver.

Historically, ISS-202 applied Todd's successor ruling to the then-existing native ladders:
`gpt-5.6-luna` becomes `gpt-6-luna`, `gpt-5.6-sol` becomes `gpt-6-sol`, and
`claude-opus-5` becomes `claude-opus-5-5`, preserving roles, efforts and order.
Current ladder short labels Luna/Sol mean GPT-6 and Opus means Opus 5.5;
historical text and records retain their original identities. Replacement
transfers no predecessor benchmark, score, verdict or capability evidence,
and native Opus row 14/15 roles grant no incumbent permission or new roles.
Cutover is quiescent and for authorized fresh runs/paths only, after independent
exact-head review and three-OS bootstrap green, with supervisors absent.
Immediately before an authorized install the host captures native account_pool/CLI
admission for each exact successor model/effort with UTC instant and result;
catalogue presence and earlier probes do not establish admission or quality.
This grants no probe, installation, start, unpark or #457 renewal authority.
Old runs/configs, participant identities and all charges stay unchanged.
Same-config replay retains its saved placement/rung; changed ladders retain
`conflicting-run-configuration` before launch, without aliases, backfill or waiver.
Preserved-run continuation needs separate disposition: no automatic resume,
budget reset or exhausted-lineage re-entry. Generic operator strings remain
open configuration and static configs are not rewritten.

Each launch persists a zero-based rung index before dispatch, then retains it
with the worker attempt and participant placement. Resume uses the recorded
rung. Learning notes include it; older records without a rung remain history.
`docs/model-selection.md` describes the shipped ladders and historical benchmark basis.
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

## Decision

## Done when

## Out of scope
```

The optional `## Decision` section sits between Why and Done when and contains
one paragraph of exactly five sentences, in order: the constraint, the simplest
viable alternative, the option chosen, the downside accepted, and the observation
that would show the choice was wrong (ISS-174). It is expected for changes to
persisted records, published names, prompts or process rules; `planning:check`
does not validate it.

A `QUALITY_PROFILE` line or Quality Packet belongs to the Chase Sets delivery
skill; self drafts do not carry it, and a platform reviewer verifies every
packet claim independently and never adopts one as evidence.

`## Done when` accepts unordered `-`, `*`, or `+` items or ordinary top-level
`N.` ordered items, with indented continuation lines. The self adapter consumes
each item as one acceptance criterion; a section without supported list items
stops with `selected-issue-criteria-missing`, never a whole-body fallback.
ISS-153 fixes the ordered form recorded in ISS-152's pre-dispatch stop.

`pnpm planning:check` proves drafts and roadmap agree, the graph is acyclic,
and every registered draft has `## Done when` with items consumable by the
self adapter's shared criteria extractor, regardless of readiness or milestone (ISS-208).
`pnpm planning:board-check` proves every open registered issue on
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

### Zero-attempt recovery from a stale pinned self brief

ISS-209 documents the [ISS-206 recovery receipt](https://github.com/todd-skelton/orchestration-platform/issues/368#issuecomment-5818298416):
on 2026-09-24, resuming `m1-iss206-20260924T1545` through
`scripts/executor/start-loop.ps1` still refused `selected-issue-criteria-missing`
after heading-only PR #649 landed and the executor was upgraded. Its saved
`planningRevision` remained `886c30818e24ba7a58b837c7bffce78de79d24a3`, before
the fix at `e6b68871ab6153fdb124e2b0a29fc1e1f6d65e38`. The host reported zero
attempts and launches and preserved that run. Fresh run
`m1-iss206-20260924T1642` then refused a board-body mismatch until the host
synced #648's `## Acceptance` heading to the landed `## Done when` draft.
That was a host body sync, not an automatic ISS-178 delivery mirror.

The boundary is whether selection was saved. Before any saved selection,
repairing current-main planning and full-board agreement permits the ordinary,
host-authorized same-run retry through `scripts/executor/start-loop.ps1`.
With a persisted pinned selection, resume through that same entrypoint keeps
its brief and base: neither a later draft fix nor an executor upgrade changes
the pin. Missing-criteria parsing precedes author dispatch, but that stop
reason does not prove zero historical attempts or launch charges. Direct queue
composition is not a bypass.

For an entirely unattempted run and issue lineage, the host procedure is:

1. With supervisors absent, make a contemporaneous read-only inspection of
   the saved selection and pin, configs, attempts, worker and participant
   history, and stop records. Establish zero attempts, zero launches and no
   in-flight or uncertain work anywhere in the abandoned run, and no consumed
   earlier issue lineage. Any nonzero or unknown accounting stops this recipe:
   seek the existing separately authorized continuation or disposition. An
   absent author process is not evidence of zero charges; historical incident
   notes do not establish eligibility for a future recovery.
2. After an independently reviewed, final-head three-OS-bootstrap-green
   planning fix lands, check the live issue's verbatim draft, milestone,
   readiness, dependencies and project membership against current main.
   Capture that board evidence immediately before recovery; perform a needed
   board-body sync only with explicit authorization. If the issue is no longer
   eligible, stop rather than manufacture readiness.
3. Only a separate explicit host authorization permits a fresh config with a
   new `run` and distinct `worktreeRoot` (ISS-151). Keep `stateRoot`, placements,
   `attemptCeiling`, `nativeLaunchCeiling` and every other config field unchanged.
   Under explicit live-start authorization, use the canonical Windows entrypoint
   `scripts/executor/start-loop.ps1 -Config <fresh-config>`. Fresh selection
   applies the ordinary full-board gate and priority order; it does not
   force-select the old issue. A pre-selection board refusal follows the
   same-run boundary above.
4. Record old/new run IDs, pins, config differences, inspection and board
   evidence, authorizations and the result in the existing issue note. Count
   the recovery as host-assisted, not toward M1's three consecutive unattended
   issues. The [later ISS-206 receipt](https://github.com/todd-skelton/orchestration-platform/issues/368#issuecomment-5819507845)
   records delivery by PR #650; this recipe does not reopen #648.

All old runtime, worktrees, stops and config bytes remain unchanged. There is
no silent re-selection on resume, same-run re-pin, selected-file deletion or
archival to trick selection, fingerprint waiver, backfill or rewritten history.
No attempts, worker retries, launch charges or ceilings are reset or transferred;
no completion or PASS is invented, and old review authority does not transfer
to the new pin. A fresh name is neither a budget escape nor terminal-park
re-entry: a nonzero lineage is outside this recipe. This documentation grants
no installation, board mutation, live-run start or unpark authority. Existing
pinned-context tests remain the behavior contract; do not exercise a live
recovery as a documentation test.

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
- Start from Windows with `scripts/executor/start-loop.ps1 [-Config <config>]
  [-VerifierWorktree <path>]` (PowerShell 7). It stays attached to one
  `C:\Windows\System32\wsl.exe -d Ubuntu -- bash
  /root/orchestration-m1/repo/scripts/executor/run-loop.sh <config>` child
  through redirected stdio with `WSLENV` empty, and exits with the
  supervisor's code on idle, a terminal stop, cancel or a start failure
  (ISS-164). `run-loop.sh` no longer detaches: it keeps the provider and tool
  setup and runs the attached supervisor, whose stdout is exclusively the
  protocol stream while its stderr and the pnpm banner go to `supervisor.log`.
- Check: `wsl -d Ubuntu -- tail -n 3 /root/orchestration-m1/supervisor.log`.
  Every protocol line is also appended there, so the log still ends in the
  final status.
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

### Private request stream

ISS-164 gives one run one private request/reply stream between the attached
Windows parent and the supervisor, for the incumbent's native database
verification. `supervise.mjs` exports `createNativeDbAdmission(run, input,
output)`: one pending correlation per channel, increasing per run, and a typed
result `{correlation, status: completed|refused|unknown, owner, evidencePath,
diagnostic}`. Production main owns and closes the channel but never requests;
the first ordinary selected-issue request belongs to ISS-170 and adapter
composition to ISS-165. Worker JSON never reaches the stream: `launchObserver`
retains `stdio: "ignore"`, and a reply that is not a closed v1 reply resolves
the pending request `unknown`, as do EOF, a partial line and an oversize
line. Nothing after close is sent, and a second request while one is pending
is refused locally.

ISS-165 composes that channel onto the queue's native adapter. `flow.ts`
declares the optional typed `Adapter.nativeDbProfile(identity)` with closed
`NativeDbIdentity` and `NativeDbReply` types, and `supervise.mjs` exports
`nativeDbProfileAdapter(native, channel)`; main passes
`nativeDbProfileAdapter(codexAdapter(loop.gitExecutable), admission)` as
`options.native` to `repositoryQueueAdapter`. The existing `...native` spreads
in the bounded queue, repair and conflict adapters carry the method unchanged
to every source, repair, refresh, correction and reviewer entry; queue.ts,
dispatch-adapter.ts and repair-adapter.ts are byte-identical. An absent method
is unsupported, never success; the channel still owns schema, correlation and
parsing; and no production caller exists before ISS-170. Main's channel has no
approved parents, so a request before ISS-170 is a typed local refusal. Only
test harnesses invoke the method, through the actual composed adapter captured
at its existing entry.

The closed v1 request is `schemaVersion: dogfood-native-db-request/v1`,
`correlation`, `profile: reconciliation-pg16/v1`, `run`, `issue`,
`attempt`, `executorHead`, `product {repository, head, tree}`,
`declaration {version: 1, profile, files[3] {file, cases}, mutants[0..3] {id,
file, cases, assertion}}`, `patchDigests[0..3] {id, digest}` and
`stagedInputDirectory`. The reply is `schemaVersion:
dogfood-native-db-reply/v1`, `correlation`, `status`, `owner: null |
{lockId, head, lane}`, `evidencePath` and `diagnostic`; completed requires
owner and evidence path, and completion is lifecycle only, never PASS. Every
object is closed with the incumbent's bounds: 65536/8192 UTF-8 bytes, IDs 1..128
`[A-Za-z0-9._:-]`, repository segments 1..100, assertions and diagnostics
1..2048, cases 1..512 and unique per file, paths 1..1024 with absolute paths
under approved parents and relative paths without traversal, issue/attempt
1..2147483647, correlation a safe integer, 40 lowercase hex revisions, 64 hex
digests and 32 hex lock IDs. No command, environment, script, runner-path or
duration field exists.

The parent binds the first request's run, refuses a foreign run, a repeated
correlation or an unknown top-level key, and answers `refused` with
`native-db-anchor-unsupported` when `-VerifierWorktree` is absent or is not
a clean worktree on a live branch, and `native-db-runner-absent` when the
ROOT container has no `.orchestrator/invoke-heavy-verifier.ps1`. Otherwise it
writes the request under the anchor's ignored `.orchestrator/native-db` and
runs `invoke-heavy-verifier.ps1 -NativeDbProfile 'reconciliation-pg16/v1'
-NativeRequestPath <request> -Worktree <anchor> -Lane <run> -Branch <branch>
-ClaimedHead <head>` in branch mode, reading `<request>.reply.json`. A
missing, foreign or malformed reply is `unknown`. The parent never edits
`verify-lock.d`, releases an owner, signals Linux or authors cleanup facts; a
WSL exit is not Linux cleanup, and Linux survivors after Windows loss remain
the incumbent's responsibility. The test-only trigger is a disposable copied
runtime whose entry requests once through the actual factory with a Node
parent stand-in; there is no production selector, flag or declaration.
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
ISS-197 also recorded the pool omitting models from its `/models` catalog
while simultaneously serving them and reporting a non-disabled account `ready`;
that capture did not test the all-credentials-suspended condition.
A weekly quota block returns `429 model_cooldown`, which is neither a refusal
nor an outage to the trace classifier; two such worker deaths park an issue
as `launcher-failed`. The launch probe also reads the pool supervisor's per-account, per-model
routing status from `CODEX_POOL_STATUS_URL`
before the catalog check. Any non-disabled account reporting the model `ready`
admits it without a catalog membership check; the authenticated `/models`
request and body validation still run on that admission. A model no account
mentions is left to the catalog, as is every model without a configured status URL.
When every account blocks the model, a block clearing inside
`providerOutageCeilingMs` waits as `waiting-provider` with the pool's reset
time, and a longer block is `provider-model-refused`: the worker advances its
ISS-158 author ladder, whose last rung remains the other vendor under ISS-203,
or its independent refusal-only reviewer ladder, and an exhausted ladder
stops the host with the reset time. The block's end is compared with the one
absolute wait deadline the models probe already owns, never a fresh duration.
A block whose end is unknown, past or unparsable at any account is
uncertainty and waits; malformed or failing status waits like an outage. The pool also publishes a per-provider
pace projection and on-change usage samples; the loop does not read them.
Routing by quota state stays with the operator's marker and ISS-158's ladders (ISS-162).

Vitest runs files serially with one worker to bound competing real-Git fixtures;
every test and the existing test/hook timeouts remain in place for local and
hosted bootstrap gates (ISS-160).

ISS-210 partitions hosted Windows bootstrap across three standard runners:
refresh, queue, and the remainder from Vitest's canonical discovery. Each keeps
all four gates and serial tests; local defaults, Ubuntu and macOS stay full.
The unchanged required Windows name aggregates all three successes and embeds
cancelled-shard logs (or fails with `shard-log-unavailable`). No observer or
required-check contract changes. Landed-head latency and cost qualification
remain host-owned; the partition alone establishes neither target nor savings.

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

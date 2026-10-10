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
   never reviews its own work. Between completed self cycles, the attached
   wrapper may install the reviewed, green main admitted by ISS-250 below;
   workers have no installation authority.
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
   ISS-250 may re-execute a self supervisor inside the same attached wrapper
   binding after installation; saved cycles, reservations and allowances stay
   unchanged. This is distinct from a host restart or automatic worker retry.

### Failure classes

ISS-225 makes `scripts/dogfood/fault-class.ts` own stop classification and parking.

| Class | Who acts next | Disposition in this slice |
| --- | --- | --- |
| `attempt` | The loop: candidate or worker output was unacceptable | Parks |
| `replan` | A person: the brief or authority must change | Parks |
| `retry` | Nobody: unavailable or unknown external state can reconcile on same-run restart | Non-parking host stop |
| `wait` | A person, provider window or authority outside the loop | Non-parking host stop |
| `halt` | The host: records, configuration or executor disagree | Non-parking host stop |

Resolution is exact reason, then exact prefix ending in `:`, then halt-only
family, then `unclassified` (also `halt`). Families are prefixes `invalid-`,
`malformed-`, `conflicting-`, `duplicate-`, `unexpected-` and suffixes `-drift`,
`-mismatch`; exact entries win. A new stop reason lands with its table entry
in the same change; the parsed literal inventory is the test ratchet.
Parking means `attempt`, `replan`, or explicit `legacyParking`.

The recorded legacy-parking backlog is `exit-receipt-timeout` (retry; ISS-222),
`launcher-failed` (retry; ISS-162), `reviewer-malformed` (retry; restart recovery),
prefix `hosted-check-log-unavailable:` (retry), and `deploy-not-verified` (wait).
These still park until separately reviewed work resolves each entry.
ISS-230 narrows only the hosted-log backlog: proved never-executed cancellations
no longer emit that prefix. `hosted-check-never-executed` is retry, non-parking;
executed or unproved missing logs still use the parking prefix.
ISS-225 changes no park, retry, wait or stop behavior; classes authorize no
automatic recovery and change no saved records or posted bodies.

ISS-236 adds descriptive causal data alongside these authority classes. New
worker launches require `defect: null` on PASS and one closed `defect` object
on FAIL: `defectClass`, `explanation` (at most 1000 characters), `rootCause`
(at most 200), `evidenceStatus` (`established` or `unresolved`), and `evidence`
(1–16 source references, each at most 1024 characters). The single primary
class is `mechanical`, `environment-tooling`, `implementation-known-remedy`,
`brief`, `slice`, `design`, `product-scope`, or `external-dependency`. Mixed
failures keep all findings and name the cause determining the next step.
Unresolved attribution uses `environment-tooling` and `unresolved`; it is
neither candidate exoneration nor retry authority. Gate candidate attribution
still requires the existing same-command immutable-base control.

The shared `dogfood-outcome/v1` record is `outcome-<identity hash>.json` in
the existing runtime stage directory. It binds repository, issue, run,
attempt/stage directory, occurrence identity, exact head when available,
retained terminal evidence and the descriptive fields. Re-observation reads
the same record. Pending and PASS produce no failure classification; proved
hosted non-execution and verifier exit 73 are excluded. Malformed reports
retain their verbatim source trace and receive a mechanical protocol cause,
never an invented semantic verdict. Legacy launches keep their saved output
schema; legacy evidence can receive a new descriptive record without backfilling
terminals, prompts, configuration fingerprints or posted bodies. Classification
adds no launches, diagnostic gates, retries, charges or recovery authority;
the five fault classes, parking and all acceptance checks remain unchanged.

### Review and corrective authors

ISS-243 makes review locations severity-sensitive after LOC-NOTE-1 stopped
ISS-234's refreshed PASS. Blocking findings must name changed candidate files;
advisory notes may cite unchanged committed files. Both require a file (not a
tree) and a valid one-based line at the exact reviewed head. Notes remain in
reports and handoffs as explanatory context, outside the repair author's
blocking correction list; they expand neither authorized author paths nor
repair source paths. They supply no review identity, gate evidence or repair,
publication or landing authority. Invalid locations still refuse; recovery,
fault classification and all existing allowances are unchanged.

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
this extraction rule (ISS-177), retaining their JSON-only prompts, saved five-key
schema (with ISS-236's additional `defect` for new launches) and the same
`MAX_TERMINAL_SUMMARY_LENGTH` summary cap; the whole
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

ISS-231 collects Chase Sets' configured native local gates before reviewer
intent, including source, repair and integration/correction DELTA launches.
Reviewers receive the complete logs and command/head/result terminals;
worker-sandbox pnpm non-execution remains a sandbox limitation, not gate evidence.
Same-head retries read retained execution; refreshed heads own new evidence.
A failed gate prevents review. ISS-152's diagnostics and immutable-main control
decide attribution, and only candidate attribution admits the shared single
correction. First-review correction retains the original author evidence without
inventing a predecessor PASS or reviewer; all original review obligations and
configured gates remain required. Self review order and delivery's post-PASS
acceptance check are unchanged.

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
primary draft reads (including mutation confirmation) and learning-note
reads retry classified GitHub transport failures, with three attempts and
1-second then 2-second waits. ISS-248 extends the existing supervision issue-view
retry to default reads after cycle 27 of `m1-iss219-20260930T1030` stopped on
a classified connection failure while its stop-note reads recovered in-process.
This includes prerequisite admission and retained detours, saved-cycle resume,
and start/complete observations before and after ready removal or closure.
Only the read repeats, including already-classified non-pre-send transport;
mutations and acquired-response parsing remain outside the retry. Exhausted
default reads retain `issue-observation-unavailable`; note reads retain
`learning-note-state-unknown`. Pre-selection board/census, sibling census and
unrelated reads stay single-shot.
After any comment response, a fresh marker observation reconciles acceptance;
only a proved pre-send failure plus fresh absence permits one additional post
in that call. A comment HTTP 5xx is uncertain, never pre-send. Exhausted reads
or an unresolved post retain the non-parking unknown stop and pending intent;
saved records and restart reconciliation are unchanged.
ISS-223 applies the same classification and three-attempt, 1-second/2-second
bound to the whole hosted-check identity bracket in `checks()`, counted
separately from startup waits; exhausted transport stops as
`hosted-observation-unavailable` with the sanitized category diagnostic.
ISS-217's candidate repair retains the sanitized `GithubCommandFailure.message`
category for failed issue commands, and `malformed issue observation` for acquired
responses that fail parsing or shape checks. The existing diagnostic reaches the
stop body's bounded `Diagnostic:` and blocked output's `diagnostics`. A failed
learning-note lifecycle also reports its `QueueBlocked.diagnostics` as
`lifecycleDiagnostics` beside `lifecycleReason`; unrelated errors retain
`learning-note-state-unknown` without a diagnostic. ISS-248 retains these
diagnostics, non-transport and malformed-response refusals, and the existing
non-parking stop lifecycle. Pre-selection board/census and current-main
refusals are unchanged.
Published delivery, including a pending publication intent whose response may
have been lost, resumes its existing reconciliation, checks and mutations; it
does not rewrite an in-flight publication merely because main moved. An exact
published conflict follows ISS-147 after publication reconciliation.

For an admitted queued merge with complete saved green checks, the next
observation stays in `confirmMerge` while the PR is pending. It returns the
existing observing result without re-reading OPEN-only hosted checks; a
confirmed merge records the ordinary receipt and proceeds through cleanup.
An absent previously admitted entry stops as `merge-queue-removed`, including
removal caused by a conflict; it does not enter automatic conflict recovery
through the hosted-check reader. The operator must inspect that removal.

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
within the unchanged numeric ceiling (issue-local under ISS-235). Later main
must descend from M and is merged,
never rebased over S; a clean refresh needs a new DELTA within that same bound.
A further conflict or work failure parks as `continuation-failed`, with no source
repair, gate correction, new attempt or chained recovery. Host uncertainty keeps
its ordinary non-parking stop. Fresh final-head local and after-mirror gates,
publication, hosted checks, landing and deployment remain required. Delivered or
parked replay stays inert; external closure carries only participant history.
This capability supplies no #457 ruling, planning re-entry, installation or
preserved-run resume authority. Host installation still requires independent
exact-head PASS, three-OS bootstrap green and absent supervisors.

ISS-214 repairs `unreviewed-delivery-source` at
`loop-stop:m1-iss146-147-20260914T2325:11:2`: publication had advanced the
accepted review beyond the immutable source PASS. Integration delivery now
checks those identities separately. The original candidate, author terminal,
PASS and integration grant still bind the source. The accepted head/review
binds the continuation's selected `native-refresh.json` directory, native PASS,
delivery-source and charged reviewer; a preceding resolution DELTA binds its
own directory/head/review even when it never entered delivery. The stale
attempt-level refresh cannot supply current authority. Both ordinary and spent
continuations reconcile the same publication on repeated and restarted entry.

The FINAL delegated decision at Chase Sets #4388 comment `5843781301` grants
exactly one additional refresh DELTA reviewer for ISS-146, same run and absolute
attempt 2. The executor's declaration is outside saved configuration and the
consumed integration packet. It pins the decision's author, ID, URL and captured
body hash, and the recorded reservation, claim, cycle-11 stop and publication
bytes. Only native post-publication refresh after `published-candidate-conflict`
can admit it. At that launch boundary the executor checks the then-current
lineage and observes the live comment, then exclusive-creates
`integration/spent-resolution/refresh-review-grant.json` with the observation
and resulting reviewer head/directory before launch. Absent, unreadable or
mismatched authority retains `integration-continuation-launch-exhausted`.
Replay validates the retained binding and resumes the ordinary reviewer records
without another authority probe or launch; a lost launch response cannot renew
consumption. The old `spent-resolution.json`, its initial 23 participants and
`launchLimit: 3` remain unchanged; all 26 participants stay charged and the
additional reviewer is charged once through ordinary terminal accounting.
No author, repair, worker relaunch, further attempt or second review is admitted.
The shared retry history, implementation ceiling four and native ceiling 64
remain intact. Later conflict or non-PASS parks the continuation. Exact-head
gates, forward publication, hosted checks and native landing/deployment still
apply. Shipping this repair establishes neither #457 completion nor permission
for a worker to install an executor or resume the preserved run; those remain
host-only, separately gated actions after independent review and hosted green.

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
name committed candidate files. ISS-228 also recognizes the final `check:structure`
block with its exact chained structure/brand-proof command, successful parsed
Brand foil partition, contiguous path/message violations, rules footer and both
lifecycle tails. Every structure path must be a normalized committed regular
file changed against the recorded delivery main; all block lines must be accounted
for, and a later static link contradicts the fail-fast failure. Structure uses the
same candidate-selected base control and requires its positive `check:structure`
execution marker. The same command runs in an
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

ISS-246 addresses HOSTED-FLAKE-PARK-1 on #750: when executed hosted failure
has no next implementation attempt, both first failure and replay include a
bounded diagnostic naming attempt, head, review, failed stage, Actions run,
attempt and job, and a retained completed stop marker/count when present.
The closed candidate route `hostedExecutedFailure` (admission-checked, refusing
in-diff failures) precedes the absolute evidence path within 500 characters;
other failures point to planning. Reasons, historical bodies, unpark text and
ISS-216 receipt bytes remain unchanged. This diagnostic classifies no flake.

ISS-230 partitions the complete attributed effective-job census before requiring
logs when a required check is non-pass. Advisory failures and cancellations do
not widen the required-check merge gate. Only a current-attempt completed
`cancelled` job with an explicit
`runner_id` of zero or null and an actual empty `steps` array proves non-execution;
a populated job-level `started_at` is allowed. Complete paginated census and
publication/workflow/attempt equality are required, including reobservation
after metadata and log acquisition. Prior-attempt successes retain ISS-185's
failed-only rerun treatment; prior cancellations gain no exemption. Mixed runs
retain every executed failure, including non-required shards, and keep required
cancelled checks in the failed identity set. The log header's additive
`nonExecution` witnesses describe omitted jobs, never passing checks. Old headers
remain readable without rewriting or retroactive non-execution proof.

When a required check is non-pass, every non-success job is proved never-executed
and all owning workflows are complete, `checks()` shares ISS-223's two whole-observation retries and
one- and two-second waits with transport failures. Startup waits remain separate.
Exhaustion retains complete metadata in `hosted-non-execution-<digest>.json` and stops as
`hosted-check-never-executed`; it requests no logs, corrective author or rerun,
and charges no implementation attempt. Pending workflows remain observations.
Executed missing/empty logs still park as `hosted-check-log-unavailable:`.

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
its existing classification (ISS-188). Under ISS-230, a pending workflow snapshot
defers failure-log acquisition to the next ordinary observation; this adds no
polling or retry allowance.
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
existing 64-launch/four-attempt configuration (issue-local under ISS-235):
`blockedCycle`, `blockedKey`, `blockedNumber`,
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

ISS-217's candidate repair lets one host restart continue the saved open cycle
after reconciling an unfinished `issue-observation-unavailable` run-stop note.
Fresh issue/comment observation must establish marker acceptance before the
existing completion is written; unknown note state still stops. Repeated entry
skips that completed note without another comment or changes to retained attempts
and participants. Item stops, other run stops (including ungranted gate stops),
external closure and fresh delivery failures retain their existing paths. This
removes only the second restart recorded in ISS-217, not the host-owned first
restart. These diagnostics and continuation remain planned until this candidate
lands after independent review and hosted bootstrap; installation and preserved-run
start require separate host authority.

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
launches still consume the issue's same-run ceiling. Missing or mismatched terminals,
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

ISS-244 addresses SUCC-PARK-1: ordinary `ready` re-entry after a failed
conflict successor still stops as `continuation-failed` before configuration,
with zero new attempts or launches. Its diagnostic names the failed absolute
attempt and head, conflict seed, completed implementation stop marker and count,
and the host-interpreted `terminalAttemptAdmission` route; the entire diagnostic
fits the existing 500-character slot. The unpark suffix stays unchanged.
Only the v2 declaration below can admit the next unused attempt after the
demonstrated controller/admission gap; author FAIL and blocking DELTA remain
outside that kind. Shipping this repair grants no ISS-234 re-entry or live start.

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
and `reviewer`, with ordered placement arrays (ISS-203 row 2 with ISS-218 selectors shown):

```json
{
  "row": 2,
  "review": 11,
  "author": [
    { "model": "gpt-6-luna", "effort": "high" },
    { "model": "gpt-6-luna", "effort": "xhigh" },
    { "model": "gpt-6.1-sol", "effort": "medium" },
    { "model": "claude-sonnet-5-5", "effort": "medium" }
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
is Astra/high, Astra/xhigh, Fable/high, with Opus 5.5/high then Sol 6.1/high review.
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
Sonnet review tails retain refusal-only continuity, never a quality escalation
or a successor strength claim. Reviewer exhaustion still stops the host with
the pool reset time.

These placements use the September 23 research report cited in ISS-203, not
local quality certification. Its Sol and Sonnet comparisons describe
`gpt-6-sol` and `claude-sonnet-5`, not the ISS-218 successors; no score,
cost, sample count, benchmark, verdict or capability evidence transfers.
Weighted API benchmark USD/task is not subscription spend or accepted-artifact
cost; provider-fallback Opus/Fable cells do not
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
In current ladders Luna means Luna 6, Sol means Sol 6.1, Sonnet means
Sonnet 5.5 and Opus means Opus 5.5; historical text and records retain their
original identities. Replacement transfers no predecessor benchmark, score,
verdict or capability evidence,
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

ISS-218 applies Todd's September 28 Sonnet retirement and September 29 Sol
replacement ruling on [#8403](https://github.com/chase-sets/chase-sets/issues/8403)
and [its Sol ruling](https://github.com/chase-sets/chase-sets/issues/8403#issuecomment-5900473741).
Only the selectors change: `gpt-6-sol` to `gpt-6.1-sol` and
`claude-sonnet-5` to `claude-sonnet-5-5`. All fourteen Chase pairs and self
keep their roles, efforts, order and lengths, including Sonnet review tails.
Immediately before a separately authorized quiescent install, after independent
exact-head PASS and final-head three-OS bootstrap green with supervisors and
workers absent, the host captures `gpt-6.1-sol/medium`, `gpt-6.1-sol/high`,
`claude-sonnet-5-5/medium` and `claude-sonnet-5-5/high` through the target
executor's actual native Codex CLI/account_pool path. Each capture retains
requested/reported identity, effort, observed UTC instant, exit/result and
evidence path. Unavailable/refused admission stops installation, without
matrix changes or predecessor fallback. Skill catalogues, earlier probes and
fixtures establish neither timely native admission nor quality. This grants
no provider probe, installation or start authority. Only authorized fresh
runs/paths use the new defaults; saved configs, fingerprints, participant
identities and charges remain byte-identical. Changed-ladder resume still
refuses, with no automatic resume, version-changing dead-worker retry,
budget reset, exhausted-lineage re-entry or #457 renewal. Observing a pinned
worker permits no retired-worker relaunch; preserved runs need separate disposition.

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
green with supervisors absent. ISS-250 replaces the per-landing host scripts
recorded in #787 only at the completed self-cycle boundary. Before the next
selection, the supervisor fetches `origin/main` as S and requires S to descend
from the executor head. It walks only `git rev-list --first-parent head..S`:
each step must have a native `merge.json` witness from this executor's self
runs under `stateRoot`, or its complete first-parent diff must be confined to
`planning/`. Squash landings qualify by receipt; branch-side commits of a merge
are not separately evaluated. The latest push-event `bootstrap` run on S must
be complete with success for every self `REQUIRED_CHECKS` context, including
the Windows aggregate. Missing, unavailable or non-green evidence continues
the current executor and records `upgrade-deferred:<step>:<reason>` once per S;
non-fast-forward main records `upgrade-deferred:not-fast-forward`.

An admitted S exits the supervisor with `{status:"upgrade-ready", sha:S}`.
Every attached body, including Chase Sets, holds a shared `flock` on
`$TASK_ROOT/executor.lock`; fd 9 is closed for the supervisor pipeline and its
descendants. After its supervisor exits, the self installer releases that lock
and attempts a nonblocking exclusive lock. A peer defers the install and the
wrapper restarts the current executor, skipping that S at the resumed boundary
once; a later completed cycle may try it again.
A racing start waits up to ten minutes for its shared lock, then exits
`executor-busy`. Only self supervisors request installation: re-executing a
Chase Sets supervisor would reset its native-DB correlation counter within
the still-attached Windows parent.

With exclusive ownership, any diff touching `scripts/executor/`,
`scripts/dogfood/process-ownership.mjs`, `package.json` or `pnpm-lock.yaml`
stops as `upgrade-requires-restart` before mutation. The host's existing
installation procedure remains the fallback for these paths, including
Windows-side files. Otherwise the wrapper writes
`$TASK_ROOT/executor-install.json` with `{state:"installing", from, to, at}`,
fast-forwards to exactly S, runs `pnpm install --frozen-lockfile`, and checks
porcelain. Later movement of origin does not replace S. Failure retains the
state file with `state:"failed"` and its failed step. Every new body takes the
shared lock and checks that file before starting a supervisor: either state
blocks with `executor-install-failed` until the host repairs and removes it.
There is no rollback automation. The three wrapper stops are JSON protocol
lines with `status`, `run` and `observedAt`; busy and restart-required are
non-parking `wait`, installation failure is non-parking `halt`.

Success removes the state file and emits `executor-upgraded` with `from` and
`to` SHAs before re-executing the supervisor on the same config. The Windows
parent remains attached and the ISS-219 invocation binding and cgroup do not
change. ISS-133 resumes the saved run without rewriting receipts, reservations
or budgets. Reports list each such re-exec separately from retries and host
restarts. This capability itself needs the ordinary quiescent reviewed-green
host installation; the Windows terminal-status update takes effect on the
host's next start. It grants no installation during an issue, Windows-side
install, preserved-run start or new recovery allowance.

Outside this boundary, landing a repair alone authorizes no executor
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
  The terminal `blocked` line is also written to stdout after stderr, with a
  failed stdout write falling back to the retained stderr line.
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

### Read-only run status

ISS-136 addresses the repeated PID, trace, PR and operator-gate reconstruction
recorded in ISS-110 and ISS-135. From the installed executor checkout:

```sh
pnpm --silent loop:status /root/orchestration-m1/loop.json
pnpm --silent loop:status /root/orchestration-m2/loop-replanned.json --json
```

From Windows PowerShell 7, using this repository's read-only wrapper:

```powershell
./scripts/executor/status-loop.ps1 -Config /root/orchestration-m1/loop.json
./scripts/executor/status-loop.ps1 -Config /root/orchestration-m2/loop-replanned.json -Json
```

`-ExecutorRoot` optionally selects the WSL checkout containing the status command;
it defaults to `/root/orchestration-m1/repo`. The wrapper uses Ubuntu and the
existing executor tool paths. WSL `--exec` invokes `/usr/bin/env` with a literal
tool PATH and the absolute Node executable, script, config and optional `--json`
as separate arguments; no shell reparses them. It does not start the pool bridge,
source the mutating launch script, install code, dispatch workers or restart a run.
The command reads the config, retained runtime records, the adjacent
`supervisor.log`, the process table and GitHub. It writes neither Git metadata
nor runtime or GitHub state. Human and JSON renderings use the same observation.

`running` means an identified supervisor process exists, not that a worker is
healthy. `supervisor.status: paused` means Linux reports that process stopped (T/t).
The top-level `paused` can also mean an acknowledged pause-after-current with
an exited supervisor; the separate `pause` observation identifies that request.
`exited` with saved work needs inspection before any separately
authorized resume. `stopped` names the recorded stop and its operator action.
If parking leaves no cycle completion and later selection goes idle, the retained
stop stays visible as `stopped`; the historical last-log observation reports idle.
`idle/exited` needs both an absent supervisor and a matching run's idle evidence;
idle is not milestone completion. An inaccessible process table, private worker
PID namespace, missing records or unavailable WSL/GitHub remain unavailable.
The last run log observation is historical, with unknown time for legacy lines.
Runless lines cannot describe the requested run, and a live invocation ignores
previous final lines. New supervisor lines include run, PID and observation time;
the invocation's start line delimits its observations without changing receipts.

`observedAt` is the start of this read. `progress.at` and `ageSeconds` identify the
latest timestamped worker launch or delivery completion/attempt advancement
visible in retained records and the final 1 MiB of the log. Untimed later records
may exist; absent timestamps stay null. File modification times, repeated polls,
provider waits and growing traces/logs never advance this clock.
Repeated delivery-result identities retain their first
timestamp; when the log is truncated, progress uses retained launch timestamps
only because the first result observation may be outside the read window. Worker trace
paths and historical PRs remain useful even when their process or GitHub cannot
be observed. A completed cycle prefers its completed attempt for PR, trace and
launch-time evidence, even if a later unfinished attempt remains on disk.
Check and deploy links are observations, not required-green or
verified-deployment verdicts.

The preview is current, never reserved: each adapter reads one authority snapshot
and uses its ordinary eligibility and ordering implementation. Chase Sets retains
target milestone, needs labels, dependencies, routing and ops admission. Self
retains earliest-open-milestone ordering and full-board validation; status reads
remote main with `ls-remote` and reads that commit locally without fetching. If
the object is absent locally, preview is unavailable rather than falling back to
stale planning. Operator-blocked admitted work makes an idle run `incomplete`,
with issue links and reasons. No outstanding work alone does not prove milestone
exit, so the command never manufactures `complete`.

Observed read-only check, 2026-09-27T13:16:30.208Z: from the ISS-136 corrective
author checkout, using the wrapper's tool PATH and absolute Node executable,
`node scripts/dogfood/status.mjs
/root/orchestration-m2/loop-replanned.json --json` read the preserved detached
`m2-payout-fees-replanned-20260913` run, repository `chase-sets/chase-sets`, target
155. It found a completed saved cycle and a matching legacy `idle` log line with
no timestamp. Supervisor liveness was **unavailable** because this sandbox has
a private PID namespace. GitHub preview failed with `error connecting to
api.github.com`; completeness, current checks and deploy were therefore unknown.
The timestamped evidence reported was the completed attempt-1 reviewer launch at
2026-09-13T14:40:26.891Z (age 1204563 seconds at observation), not a delivery
completion time. Its trace was under
`/root/orchestration-m2/runtime/m2-payout-fees-replanned-20260913/cs-7821-attempt-1/source/reviewer-2d363840-702f-4e53-a925-f3e45f7834d0.jsonl`;
the log was `/root/orchestration-m2/supervisor.log`. The completed attempt retained
[PR #7973](https://github.com/chase-sets/chase-sets/pull/7973) and its saved
PR Required check link; those saved results do not establish current GitHub state.
No active M2 validation was interrupted and no preserved bytes were changed. The Windows
wrapper was not executed from this Linux worker. The PowerShell-gated argv tests
replace only process launch with argument capture and cover human/JSON flags and
literal paths with spaces and shell metacharacters; they skip where `pwsh` is
absent, including this worker. This observation supplies no host installation or
live-start authority.

### Native run process ownership

ISS-219 addresses the `m2-rollback-drill-r2-20260930` Launch B abort, where
the host gate found a SID/PGID member its frozen parent-chain census could not
account for. The loop now exposes kernel-backed membership identities for
external stops; it still sends no signal, holds no stop authority and issues no
stop verdict.

The canonical Linux entry `scripts/executor/run-loop.sh` runs only shell
builtins and parameter expansions before it `exec`s the tools' Node on
`scripts/dogfood/process-ownership.mjs`. That wrapper reads the loop config,
creates one fresh leaf `/sys/fs/cgroup/orchestration-platform/<invocation>`,
writes only its own PID to that leaf's `cgroup.procs`, reads the membership
back to confirm exactly itself, and then publishes
`<stateRoot>/<run>/process-ownership/<invocation>/binding.json` by exclusive
temporary write, fsync and rename. Only after publication does it start the
existing attached launcher body (`ip`/`awk`/`sed`, `pnpm`, `tee`, the
supervisor and every adapter, observer, worker and tool descendant) as its
first child with inherited stdio, so the ISS-164 protocol stream, `supervisor.log`
routing and supervisor exit-code propagation are unchanged. The binding records
the run, config path, invocation, boot ID, PID/cgroup/mount namespace
identities, cgroup path and device/inode, the wrapper's PID and `/proc`
starttime, and the UTC creation time. No live PID is moved by inference. A
non-Linux host, a config whose `run` the supervisor would refuse (including
`.` and `..`, so no record or leaf is created outside `<stateRoot>/<run>`), a
non-cgroup2 `/sys/fs/cgroup`, an unwritable root, a
failed enrollment read-back or a failed publication refuses the launch with
`ownership-launch-refused` before any child exists; there is no fallback to
parent-chain attribution, and a reserved invocation directory left by an
interrupted preparation remains unresolved rather than empty. Leaves and
bindings are never reused, overwritten or reclaimed; a later invocation of
the same run gets its own leaf and observes old survivors without adopting
them. Workers keep their existing sandbox and environment allowlist, which
grants no cgroup write access; `ORCHESTRATION_CGROUP_ROOT` is a test
injection of a plain directory, recorded as `substrate: injected-directory`,
and never reaches a worker. That directory records only the wrapper's own
enrollment write and can never learn a descendant, so a binding with that
substrate is composition evidence: an external consumer must require
`substrate: cgroup-v2` in every binding it acts on, and the human rendering
marks any other substrate `not kernel evidence`. The canonical
`start-loop.ps1`/`run-loop.sh` environment does not set that variable; a
production census bound to an injected directory is a misconfigured launch,
not a complete boundary.

`loop:status` (hence `status-loop.ps1`) gains the additive `processOwnership`
field with `status`, an optional bounded `diagnostic`, UTC `observationStart`
and `observationEnd`, and `invocations`: every retained invocation of the run
with its historical `binding` and its current `members`. A member row is the
kernel's `cgroup.procs` entry joined to `/proc/<pid>/stat`: `pid`, `starttime`
(decimal ticks since boot, not wall clock), `ppid`, `pgid`, `sid` and `state`;
`Z`/`X` states are reported distinctly, never as live. The census is one bounded
read, taken twice with no retry-until-quiet loop, freeze, signal or pause: a
changed invocation set, boot or namespace, a moved or non-leaf cgroup object,
an unresolved or foreign binding, an unreadable `cgroup.procs` or member row,
a changed membership set or a same-PID/different-starttime member makes the
whole observation `unavailable` with every `members` null while readable
historical bindings stay visible. An empty `members` array is reported only
with complete current evidence of the bound substrate, and only a `cgroup-v2`
binding makes that kernel evidence; a missing directory or binding is
`ownership-record-missing` or `ownership-invocation-unresolved`, not
emptiness. A live supervisor outside every bound membership (a direct
`loop:supervise` start beside retained bindings) is
`ownership-supervisor-outside-boundary`; the supervisor search can refuse
evidence but never adds a member. Legacy runs, direct `loop:supervise`
starts and non-Linux hosts read as `unavailable` (`ownership-record-missing`,
`ownership-linux-unsupported`) with no backfill, and the field never changes
progress, pause/resume, no-second-supervisor checks or any receipt.

The binding is historical: the wrapper tuple proves neither current liveness
nor exit. `members` is a current sample bound to the recorded boot,
namespaces and cgroup object. It is not a freeze, and it does not translate
into permission to signal a session or process group that also holds a
nonmember; a same-SID/PGID process absent from `cgroup.procs` is not a
recorded member, and no record retroactively admits the drill's PID
1525967. Repository tests prove ordering, refusal, reparented and detached
descendants and fail-closed guards through the real launcher entry, adapter
Git path, observer and status collector with an injected plain directory;
that fork, reparenting and `setsid` retain real cgroup membership is proven
only by a separately authorized host kernel qualification of the exact
reviewed launcher in a disposable WSL2 run, which must capture enrollment,
reparenting, detached grandchildren, launcher loss and post-exit membership
with the worker sandbox visible and unable to migrate. An external consumer
must freshly read status in the launch namespace and revalidate every member
immediately before an independently authorized signal, aborting on new,
unrecorded or ambiguous members. Landing this grants no installation, drill,
host POST-predicate change or ISS-111 adoption completion.

### Opt-in attention watcher

ISS-138 addresses the repeated host inspection in ISS-129, ISS-132, ISS-134
and ISS-110. `loop:watch` is a separate host process observing one configured
run through ISS-136 status. It continues observing after the supervisor exits.
It only writes its own notification state and comments on one explicitly
configured existing GitHub tracking issue; it never starts or resumes delivery,
changes priorities, edits scheduling records, or installs a service. Merging
this implementation neither installs nor enables a watcher.

After the ordinary reviewed-executor installation and explicit operator
activation, create a separate JSON file outside the checkout, for example
`/root/orchestration-m2/watch.json`:

```json
{
  "loopConfig": "/root/orchestration-m2/loop-replanned.json",
  "destination": "https://github.com/OWNER/REPO/issues/123",
  "intervalSeconds": 60,
  "noProgressSeconds": 1800
}
```

Replace the destination with the authorized existing tracking issue, and ensure
the host's existing `gh` authentication can read and comment there. The destination
may be in a different repository. Use an absolute loop config path. From the
installed WSL executor checkout, with its usual Node/pnpm/gh tool PATH:

```sh
pnpm --silent loop:watch /root/orchestration-m2/watch.json
```

Run it in a separate host terminal from the supervisor. For explicit detached
activation, the operator can instead run:

```sh
nohup pnpm --silent loop:watch /root/orchestration-m2/watch.json > /root/orchestration-m2/watch.log 2>&1 &
```

Record that shell's `$!` and inspect `watch.log`. To stop a foreground watcher,
use Ctrl-C. For the detached watcher, identify its Node watcher process with
`pgrep -af 'scripts/dogfood/watch.mjs'`, verify its config argument, then
`kill -TERM <watcher-node-pid>`; do not signal the supervisor. Disabling means
stopping that watcher and not launching it again. There is no automatic start,
restart or service registration. Run only one watcher for a run/destination;
the single-operator model does not provide a concurrent-watcher lock. Configuration
changes take effect on watcher restart. `--once` performs one bounded observation
and exits (nonzero for observation/notification failure), useful for an explicit
test activation. It can post a real comment to the configured destination.

The default observation interval is 60 seconds (configurable from 30 seconds
to one day), measured after each completed observation. No-progress defaults to
1800 seconds and must be at least that interval. Status and each GitHub command
have a two-minute command bound; observations never overlap. A failed observation
or notification is visible on stderr/the watcher log and retries only on a later
interval. This does not alter any delivery timeout, retry or launch allowance.

Attention comments identify the run, affected issue/PR, exact learning-note link
when readable (otherwise its issue), last evidenced progress and age, known
provider/CI/deploy waits, and the next operator action. The run has no hosted run
page: its identifier maps to the configured run's local status and runtime.
Comments summarize structured status fields, never stop bodies, credentials or
worker transcripts. Stops and confirmed unexpected supervisor exits notify even
on the first observation. Idle with blocked outstanding work requests operator
attention; acknowledged pause, process suspension, and exhausted idle are not
crashes. A pending pause does not excuse a host stop. A no-progress warning means
only that no newer timestamped progress is evidenced, even with a live supervisor;
if timestamps are absent, timing starts at the first retained running observation
and the message still says progress/age are unknown.

Minimal state is retained at
`<stateRoot>/<run>/operator/watch-<destination-hash>.json`, outside the checkout
and separate from delivery state. It holds the active condition, counter, pending
comment and first running observation. Unchanged conditions are silent across
restarts even as their age grows. A changed condition notifies once; a positively
observed return to running without a warning, intentional pause or exhausted idle
reports recovery once. Unavailable observations are logged locally and cannot
establish recovery. Recovery is not a worker-health or delivery verdict.
Before posting, the watcher saves a pending comment and checks its marker on the
tracking issue; later observations reconcile lost responses before retrying.
Pending notifications finish before newer transitions, so an outage can delay
an alert and its subsequent recovery. Keep the state when stopping/restarting;
deleting it can duplicate comments. GitHub does not offer atomic comment
idempotency: delayed visibility after an uncertain response can still duplicate
a post. Notifications depend on GitHub availability and the operator's issue
subscription/notification settings; a posted comment is not proof it was read.
A watcher on this host cannot alert while the whole host is powered off. This
is not remote uptime monitoring.

`test/dogfood/watch.test.ts` demonstrates explicit activation on a disposable
test run: live observation, supervisor loss, one tracking-issue alert, repeated
observation/restart without another alert, then one recovery. It exercises the
actual ISS-136 status reader and GitHub command arguments with a local fake
GitHub response transport and proves delivery files are unchanged. Additional
cases cover retained notes, pauses, blocked idle, slow work and provider/CI/deploy
waits, unavailable evidence and failed/lost GitHub responses. This is a local
test demonstration, not live GitHub notification delivery; it does not touch
the active M2 validation. A live demonstration requires the operator's explicit
test-run config and destination and the same opt-in commands above.

### Pause after current work and change priorities

ISS-137 addresses ISS-135's successor dispatch and ISS-110's manual same-run
recovery. One operator can request a stop at the next issue boundary, without
interrupting a worker. From Windows PowerShell 7, with the reviewed executor
installed and the ordinary host authorization for this run:

1. Inspect `./scripts/executor/status-loop.ps1 -Config <config> -Json`.
   Read current work, supervisor liveness, retained stops and the current
   selection preview; preview is not a reservation.
2. Request `./scripts/executor/start-loop.ps1 -Config <config> -PauseAfterCurrent`.
   This writes only operator intent; it starts neither bridges nor supervisors.
   Repeat status until `pause.acknowledgedAt` is present and
   `supervisor.status` is `exited`. While pending, current work continues through
   ordinary delivery or item-stop handling. No active selection means immediate
   pause at the next supervisor boundary. If already exited, an ordinary
   authorized start observes the request and acknowledges at that boundary;
   requesting pause alone does not start a stopped run. A host failure stays
   `blocked` with a nonzero exit and leaves the request pending, not acknowledged.
3. With the supervisor exited, make authorized changes to existing GitHub
   priorities or readiness. Chase Sets orders eligible work in the selected
   executable outcome by `priority:p0`, `p1`, `p2`, then `p3`, with lower issue
   numbers first on ties. Refinement, routing, dependency, needs-label, ops
   admission and configured target-milestone constraints still apply. Self uses
   the earliest open milestone, open `ready` issues whose dependencies are
   closed, then issue-key lexical order. Board card order and self priority
   labels do not schedule work. Self draft/body, roadmap and project agreement
   still have to pass the ordinary board gate.
4. Run status again to preview the next eligible issue under current authority.
   Unavailable GitHub or planning evidence is not a selection prediction. New
   selections read current authority; priority edits never preempt active work.
5. Explicitly resume with `./scripts/executor/start-loop.ps1 -Config <config> -Resume`
   (with the usual `-VerifierWorktree` if needed). It first requires an observed
   absent supervisor, clears only the operator request, then uses the existing
   bridge, attached launcher and recovery path. A live or suspended supervisor,
   or unknown liveness, refuses before clearing the request or starting another
   supervisor. An ordinary start performs the same liveness check but never
   clears a pause. One operator issues these commands sequentially; this is not
   a concurrent-launch lock.

The request is `<stateRoot>/<run>/operator/pause.json`; the supervisor writes
`pause-acknowledgement.json` beside its scheduling records, bound to that request.
Both are outside the checkout. Status shows pending intent and acknowledgement
in human and JSON output without advancing progress timestamps. Restart keeps
intent until explicit resume: saved active work resumes to its boundary, and
completed or parked work does not dispatch a successor while paused. Resume
does not edit selections, worker results, receipts, history, attempts, routing
progress or spent allowances. A subsequent request has its own acknowledgement.
No automatic restart follows idle, failure or pause. From the installed WSL
checkout, `node scripts/dogfood/control.mjs <config> pause` provides the same
request; its `start` and `resume` actions are launcher preflight only, not a
second launch path.

Target or other configuration changes require a stopped supervisor and an
authorized restart, and remain subject to existing configuration compatibility
checks. A saved selection is resumed or produces the existing typed scope stop;
pause/resume never discards it to apply new priorities or a target change.
Urgent interruption remains explicit host intervention: inspect both supervisor
and child processes and preserve their work before the existing recovery path.
An acknowledgement is not delivery, milestone-exit, installation or unpark
authority, and a pending pause does not override a host stop's recovery rules.

Disposable tests exercise the actual supervisor entry for pre-selection pause,
requests during work, item and host stops, restart, explicit resume and retained
history. Adapter fixtures change Chase Sets priorities between pause and resume
while keeping ineligible and other-target issues excluded. PowerShell-gated
tests capture the wrapper's process arguments; they skip when `pwsh` is absent.
These tests change no live priorities or executor and do not exercise a live
Windows/WSL start.

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

ISS-235 changes `nativeLaunchCeiling` from run-total admission to an allowance
per issue across all its attempts in the same run. The config remains unchanged:
`nativeLaunchCeiling` accepts 1..64 and `attemptCeiling` remains at most four.
The owning loop has one repository; its canonical `<issue-key>:<attempt>` item
identities share one allowance after removing only the numeric attempt suffix.
Exact keys are compared, so prefix-confusable issues stay separate. Direct bounded
queues retain their distinct opaque item identities, including across repositories.
Source, repair, correction, conflict and refresh workers, both roles and all
passed, failed, malformed, dead and unknown charged outcomes count once per worker
identity. A different attempt, stage, directory, cycle or restart never refunds
that issue's launches. Special grants retain their own allowances and terminal
boundaries; this accounting change grants no terminal re-entry.

Full run history keeps every participant in its original global ordinal order,
including ordinals above 64. The shared reader enumerates existing ordinal files
and reads each retained record once; gaps, duplicate identities, malformed records
and conflicting terminals still refuse. Composition, accepted-replan/integration/
terminal admission, verification continuation, participant synchronization, attempt
persistence and cycle completion/stop/resume use that same complete history and
validator. No record field, migration, backfill, renumbering or fingerprint waiver
is introduced. Unrelated launches remain visible but spend no selected allowance.

ISS-245 addresses HIST-PREFIX-1 recorded on #750: cycle number is selection
order, not execution order. Before returning an earlier admitted hosted
continuation, supervision reads the complete retained run history, including
later cycles. Completion, stop reconciliation, composition and native charging
use the same prefix accounting. Existing source/repair boundaries and special
continuation configuration seeds remain pinned; new launches append after the
complete accounting view, without rewriting old configuration or receipts.

The only admitted non-prefix history is the demonstrated singleton: a common
prefix P, one branch P plus a failed source author X, and a longer consistent
spine omitting X. Native hosted-non-execution reservation, original stop and
receipt, predecessor and successor attempts, source author attempt/terminal,
participant terminal and resumed-cycle completion must bind that same run,
issue and charge. Every retained history must fit those branches or their
prefixes. Accounting retains the spine and appends X once; its effective
ordinal is accounting order, not revised chronology. A later spine containing
that projection keeps X and subsequent launches in place. Fresh terminal
admission records retain X's complete original participant, source path and
original/effective ordinals. Original histories, digests, participant terminals,
author failures, usage, routing and spent allowances remain unchanged. Unknown
forks refuse; restoration grants neither author-FAIL re-entry nor a new attempt.

The recorded blocker is `m1-iss219-20260930T1030`, cycle 19 stop 1: 61 unrelated
launches left ISS-234's attempt-2 candidate without its reviewer. A completed
ordinary source budget stop at the old run-total boundary can resume its retained
reviewer intent when the selected issue has capacity and the complete saved stop
history still matches. Native dispatch writes reviewer artifacts before starting
a child; any reviewer artifact besides that intent retains the ordinary uncertain
launch refusal. The original source/setup configuration, author terminal, candidate,
prior failures and completed stop remain unchanged. The existing reviewer lifecycle
supplies the missing independent exact-head verdict before delivery. No worker
terminal or earlier PASS is substituted. This narrow pre-dispatch recovery neither
resumes special grants nor renews a launch with uncertain execution.

The ISS-235 disposable queue/supervision regressions demonstrate old admission
refusal and same-run recovery, not live recovery, hosted green or installation.
Independent exact-head review and normal final-head three-OS bootstrap green,
followed by a host-authorized quiescent executor install and same-run start, remain
required. The host separately records observed ISS-234 recovery. Preserve the live
candidate and runtime; actual issue-local exhaustion needs host disposition,
never a fresh run or state root to reset the budget.

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

ISS-231 adds one explicit `verificationOnly` grant with required `run`, `issueKey`,
`attemptDirectory`, `candidateHead`, `priorReviewId` and `authorityUrl`. The host
interprets and supplies the grant. Before exclusively creating
`verification-only.json` beneath the retained attempt, admission captures its
live comment identity, author, full body, UTC observation and owning open issue,
and matches the failed review, completed item stop and unchanged candidate tree.
Other recovery instruments cannot coexist with it. The saved cycle resumes
directly; readiness and reviewer prose grant no admission.

ISS-233 separates historical-cycle applicability from granted-stop validation
after VO-HISTORY-1 stopped discovery at an earlier same-key attempt. Without a
reservation, lookup chooses the latest retained same-key stop by numeric cycle,
then numeric stop ordinal within that cycle. Earlier stopped cycles keep their
ordinary completed-stop behavior; they are not validated as the granted attempt.
The target still requires the original identity, failed review, canonical marker,
completion and live authority checks, without fallback to an older matching stop.
An existing reservation keeps its bound stop. Pending-note reconciliation and
direct queue admission use that same lookup; no history or grant is rewritten.
Local fixtures establish behavior, not live admission or installation authority.

ISS-232 adds optional `briefRevision: { sha256, updatedAt }` to that same grant.
Immediately before reservation, the Chase Sets adapter reads the owning issue's
body and update instant together and applies its existing product refinement
reader, acceptance-item extraction and routing parser. The raw UTF-8 body hash
and exact timezone-bearing instant must match the grant; routing stays unchanged.
The host's captured ruling must bind both revision fields and the reviewed repair.
The existing reservation retains that issue observation, including the complete
body. The continuation replaces only the saved selected-brief section, retaining
all other prompt bytes, source records, traces and the full-diff base. Its saved
review configuration and fingerprint bind the effective body and revision to the
exact-head verdict, including after native main refresh. Replay reads the retained
body, never later live edits. Without the key, ISS-231's observation and saved
prompt content remain unchanged. The pinned path resolves the brief's literal
focused Vitest command and its package/config/test paths in the candidate tree;
it grants no author, correction, additional review or budget.

At the common reviewer launch, every Chase Sets role (including saved prompts,
retries, repairs and conflict/gate/continuation DELTAs) receives exactly once:
"Publication, required hosted final-head checks, merge and deployment run only
after review PASS and are enforced by the loop on the exact landing head. Their
absence before the verdict is not a finding; a red required hosted check after
PASS stops delivery. All pre-PASS evidence obligations, including executor-native
gate evidence and focused tests, remain findings when missing (ISS-139)."
This changes evidence timing, never independent judgment, available failed hosted
evidence, verdict schemas, self prompts or post-PASS hosted enforcement. Historical
prompts and fingerprints are not rewritten. NC3's synthetic missing-focused-result
fixture exercises the actual prompt, parser and non-PASS barrier, including a
discriminating bypass mutation. It proves wiring, not semantic review authority.
The ordinary independent implementation reviewer judges the synthetic absence
under ISS-139 after author completion and records that judgment separately from
candidate findings; no extra probe or earlier semantic verdict is required.
No installation or live continuation is authorized here.

New worktrees and records under that attempt's `verification/` retain the same
absolute attempt, participant history, routing counts and spent allowances.
Conflict-free native refresh precedes the configured gates and pinned brief's
focused test, whose package and paths are resolved in the exact candidate tree.
One independent DELTA challenges the retained FAIL, which remains unchanged.
There is no author, correction, attempt increment or ceiling increase. Only the
new PASS proceeds through ordinary delivery and hosted checks. Later main
movement or conflict requires another independent host decision, not a second
reviewer. Candidate failures park; host, environment and unknown failures do
not. Post-reservation stops stay in `verification-stop.json`; replay cannot
renew the continuation even after a host stop. Old records remain unchanged.
This supplies no live grant, installation, issue mutation, preserved-run start
or product ownership authority.

ISS-215 adds a bounded terminal-park admission to the candidate executor. It is
available to an installed host only after independent exact-head review and
final-head three-OS bootstrap green; landing alone grants no installation,
readiness, unpark or preserved-run start authority.

The optional closed `terminalAttemptAdmission` declaration names
`schemaVersion: "dogfood-terminal-attempt-admission/v1"`, `repository`,
`issueKey`, `issueUrl`, `run`, `priorAbsoluteAttempt: 2`,
`nextAbsoluteAttempt: 3`, `terminalMarker`, `terminalReceiptUrl`, `claim`,
`claimSha256`, `terminalHistoryDigest`, `priorPublication` (exactly `number`,
`url`, `sourceBranch`, `head`, `state: "OPEN"`, `isDraft: true`),
`authorityUrl`, `authorityAuthor` and `authorityBodySha256`. The host must
interpret and authorize the delegation before supplying it. It cannot coexist
with `integrationContinuation`, `acceptedReplan` or `gateStopAuthorization`.
The run retains its four implementation attempts and 64 native launches per
issue (ISS-235).

ISS-244 adds the separate closed
`schemaVersion: "dogfood-terminal-attempt-admission/v2"` shape, with required
`terminalKind: "conflict-successor"` and `terminalHead`. It retains the v1
fields except `claim` and `claimSha256`, which are absent; `priorPublication`
is exactly null. `priorAbsoluteAttempt` N is 2 or 3 and
`nextAbsoluteAttempt` is N+1 within the unchanged four-attempt ceiling.
V1's exact key list and implicit integration kind remain unchanged: no kind
is injected into historical packets or reservations.

V2 requires fresh self selection with `planningRevision === base`, only the
key's attempt-1 through attempt-N directories, and a failed attempt N bound
to run, issue, item, absolute attempt, `terminalHead` and history digest, with
empty findings and null accepted stage/directory. Attempt N-1 must match the
retained failed conflict author at its consumed resolution seed. The successor's
source base must be that seed, its author and source review must have passed,
and a refreshed terminal head must retain its matching passed DELTA. These
records establish the lineage kind, never merit or new acceptance: the host
must interpret a delegation identifying the controller/admission gap.
Author FAIL, repair FAIL and blocking DELTA cannot enter this route.
Any publication or publication intent under attempt N's source, repair or
refresh directories refuses before reservation.

The declaration binds the completed `continuation-failed` stop with attempts N,
matching selection and history, and its complete receipt. Later same-key stops
may only be pre-admission refusals: `continuation-failed` with attempts 0 and
no new attempt directory, or `terminal-attempt-admission-*` with attempts N.
Their histories remain charged. V2 freshly reads the open owning issue, terminal
receipt and authority comment at pre-reservation admission, capturing UTC
observation instants. Receipt bytes use the same ISS-216 rule below; author and
body hash bind the authority. Missing external reads remain retryable without
a reservation. Admission requires room for the author and independent reviewer
within the issue's same-run native allowance.

For v1, after fresh pinned self selection and before setup, admission matches
the latest completed implementation/integration stop, its
receipt, the exact claim bytes, the complete terminal history and the prior
publication. It freshly reads the authority comment's ID, URL, author and
complete body, the terminal receipt, and the PR's number, URL, source branch,
head, OPEN state and draft flag. Comment body and claim bytes use SHA-256;
terminal history uses `queueDigest`. Captures retain UTC observation instants.
Both versions use ISS-216 to compare the complete receipt byte for byte with
the retained stop body plus exactly ` To unpark, ${unpark}.`, using the self
adapter's deterministic unpark instructions and the poster's shared body
derivation. Admission never calls `park`. Only the already eligible self
`continuation-failed` item stop supplies this suffix; host stops post their
unchanged body and do not qualify. Missing or different suffixes, edited or
truncated bodies and extra bytes refuse; no trimming or prefix comparison is
permitted. Historical stop shapes and bytes remain unchanged.
This repair remains candidate behavior until reviewed, hosted-green landing
and separately authorized host installation. The host must then freshly
observe the complete receipt and all existing authority, history, claim and
publication bindings at pre-reservation admission; synthetic round-trip tests
establish neither live admission nor ISS-146 readiness or start authority.
An unavailable external read stops as
`terminal-attempt-admission-authority-unavailable`, without parking or spending
admission. A contradictory or stale binding stops as
`terminal-attempt-admission-mismatch` and parks; a local record read or write
failure stays an ordinary host error. A declared pre-admission refusal
reports the prior absolute attempt (2 for v1, N for v2), adds no charge and does
not supersede the implementation terminal. A stop after the successor
reservation reports its successor attempt (3 for v1, N+1 for v2).
Without a declaration, the integration lineage retains the
`integration-continuation-required` ordinary-composition exclusion: the
consumed integration packet or its spent resolution replays attempt 2 as
terminal, a renewed spent resolution is already consumed, and a `ready`
label, an unused reviewer-only grant or attempt headroom under the ceiling
admits nothing.

One exclusive-create `terminal-attempt-admission-<lineage digest>.json` under
`stateRoot` binds the declaration, selection, observations and inherited
accounting. Both kinds share this one reservation per repository/issue: a v1
admission cannot receive a second admission through v2. Replay uses the exact
unchanged declaration without another authority probe or spend. It
retains the entire run history, including intervening issues, failed-author
and reviewer routing progress, and consumed worker retry, correction and
resolution allowances. Changed runs/configurations cannot renew it. Historical
claims, attempts, reservations, stops, configs, worktrees and receipts remain
unchanged; the old integration remains terminal.

ISS-245 provides a read-only preflight for a proposed v2 configuration:

```sh
node scripts/dogfood/admission-preflight.mjs /absolute/proposed-loop.json
```

The host redirects stdout to an evidence path outside runtime. The command
observes remote main without fetching, reads its immutable local planning
objects, and resolves the declared registered issue without requiring `ready`
or selecting another issue. Missing local objects refuse. It validates the
executor and invokes the same complete admission evaluator used immediately
before the sole reservation write; it never composes a queue. No runtime,
Git metadata, worker, supervisor, readiness or GitHub mutation is performed.

Stdout contains one `dogfood-terminal-admission-preflight/v1` JSON receipt:
UTC observation bounds, executor commit, repository/run/issue, exact config and
packet digests, prospective selection/base/planning revision, retained evidence
paths and digests, raw and effective history digests, restored-ordinal
provenance, counts, inherited allowances and complete captured comment bodies.
`eligible` and matching-reservation `replay` exit zero; `refused` exits nonzero
with the refusal reason, including unavailable reads. Replay retains the saved
binding and observations without another authority probe or reservation. A
receipt is an observation, never an admission capability: actual admission
repeats fresh checks and rejects changed inputs. It certifies neither scheduler
readiness nor landing.

This is candidate behavior until independent exact-head implementation PASS,
local gates and executed final-head Ubuntu/Windows/macOS bootstrap green precede
a separately authorized quiescent installation. After installation the host
performs route B's separate check against that installed head and proposed v2
config, capturing preflight while #750 remains unready. Only later host
authority can restore readiness and resume the same run. A refusal leaves
readiness and runtime alone; retain the receipt rather than resetting records,
changing the run/key or blindly retrying. Rollback means withholding readiness
and start, then separately authorized quiescent executor rollback, never
reversing charges. ISS-245 supplies no authority comment, installation or live
start permission; M2 still waits for ISS-234 to land and be installed.

The successor enters ordinary creation at absolute attempt 3 for v1 or N+1 for v2 from
`attemptBase = selected.base`, with the newly pinned brief. It never projects
old failures, rebases the rejected candidate, starts from the marked seed or
imports prescribed findings. Old author/reviewer records and traces accompany
it only as read-only evidence; v2 names both attempts N-1 and N, including their
findings, author/reviewer terminals and trace paths. Its new source branch is
`codex/run-<sha256(run)>/<issue-key>-attempt-<successor>`; delivery creates a distinct PR
on `codex/<issue-key>-attempt-<successor>`. Prior publications remain open/draft and
unchanged: this mechanism neither moves their branches, reuses their
workspaces, marks them ready, closes them nor reruns their CI. Any later
disposition requires separate host authority.

The successor requires ordinary fresh source review, refresh DELTA when main
moves, final-head local and after-mirror gates, hosted checks and native
landing. Work non-PASS parks; host uncertainty remains non-parking. Repeated
failed or completed entry is terminal, with no automatic further attempt, second
admission, duplicate worker or second publication. ISS-167/200 instead continue
the same attempt's integration; acceptedReplan is the separate 4-to-5
instrument; gateStopAuthorization resumes an existing stopped gate and
publication. None supplies this new source attempt. ISS-215 repairs admission,
not the preserved issue's Windows gate failure or its planning readiness.
ISS-244 remains candidate behavior until independent exact-head review,
final-head three-OS bootstrap green and a separately authorized quiescent host
installation. Synthetic tests establish no live delegation, readiness, preserved
run start or observed ISS-234 recovery. ISS-179/181/195 ordinary FAIL projections,
fault classes, the four/64 ceilings and planning readiness are unchanged.

ISS-246 permits only the already-reserved v2 packet to coexist with the
`hostedExecutedFailure` gate-stop grant for that same run, issue and admitted
attempt. Its saved config digest compares the config with only that grant
omitted. All other changes refuse; a missing v2 packet cannot bypass its
reservation. This replays existing attempt admission and creates none.

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

ISS-229 adds only `executorRepair: { stoppedExecutorHead }` to that grant for
ordinary delivery stopped at `gate-attribution-unknown:verify:static:scoped`
with a complete final `check:structure` envelope. The host attests the exact
stop-time executor commit in its grant, bound to retained invocation evidence;
setup alone is not that witness. In the validated executor repository the
historical setup plan must agree, its controller revision must precede or equal
the witness, and `repairSha` must be included in the running executor but absent
from the witness. No executor SHA is resolved in product Git. The original
four-field product-repair grant keeps its ancestry requirements unchanged.
Before the existing single reservation, read-only recognition checks the full
saved terminal, command, head and log at the stopped delivery (including refresh
or correction siblings), re-deriving every diagnostic and its committed changed
path against the stopped base. Cached unknown diagnostics are neither trusted
nor rewritten. Missing or unknown evidence leaves the stop inert.

This continuation requires a fresh native exact-result DELTA even when product
main and the integrated head do not change. New gates use its own evidence
directory; only an actual same-command immutable-base control with the derived
scope and positive structure execution marker can authorize the remaining shared
ISS-152 correction. History, all spent allowances, publication leases and final
delivery obligations remain unchanged. A new stop cannot spend a second recovery.
Independent exact-head review, executed three-OS bootstrap, quiescent host
installation and a separately authorized, contemporaneously evidenced host grant
and same-run start remain required; this capability grants none of those actions.

ISS-230 adds `hostedNonExecution` to the same four-field grant, mutually exclusive
with `executorRepair`. Its closed fields are positive safe integers `cycle`,
`stop`, `actionsRun`, `runAttempt`, `job`, and a lowercase 40-hex
`stoppedExecutorHead`. The host's grant comment must bind that stop-time witness
to the retained stop, candidate, publication, job and invocation evidence.
Admission uses the validated executor repository: the historical setup pin
must precede or equal the witness, and the repair must be included in the
running executor and current executor main, but absent from the witness.
Setup or delivery provenance alone cannot supply the witness.

Only the exact retained hosted-log item stop with its reconciled completion,
open issue, unchanged publication and freshly proved cancelled job is admitted.
Supervision resumes that saved cycle; ungranted completed stops remain inert.
The existing `gate-stop-continuation.json` slot retains the grant, stop, receipt,
authority and publication observation without creating a gate failure or a new
delivery directory. Its next step observes the existing publication before any
refresh, worker or publication. Executed failures return to ordinary queue
attempt advancement when an ordinary next attempt exists. Otherwise they retain
the terminal stop and ISS-246 diagnostic; only the separately granted route
below can re-observe them. They do not enter the local-gate continuation's
terminal hosted-failure branch. Replay retains the reservation and completed log evidence.
Old records, histories, attempts and spent allowances remain unchanged. A changed
grant or later unrelated stop cannot renew it. Host installation, the specific
grant and a same-run start require separate authority; shipping this observer
repair supplies no ISS-221 readiness, recount, refund or recovery execution.

ISS-246 adds one mutually exclusive `hostedExecutedFailure` object to that
same four-field grant. Its closed fields are positive safe integers `cycle`,
`stop`, `actionsRun`, `runAttempt`, `job`, `controlRun`, `greenRunAttempt`;
lowercase 40-hex `candidateHead` and `stoppedExecutorHead`; `evidenceSha256`;
nonempty unique repository-relative `failedTests`; and `publication` exactly
`{number, url, head, sourceBranch}`. The later green attempt belongs to the
same Actions run, never a separate green run. It cannot coexist with
`executorRepair`, `hostedNonExecution`, `acceptedReplan`,
`integrationContinuation` or `verificationOnly`; the preceding already-reserved
v2 carve-out is the only terminal-admission exception.

Immediately before the sole reservation, admission matches the completed
`continuation-failed` or `implementation-attempt-ceiling-exhausted` item stop,
its ISS-216 receipt, failed attempt and hosted-log finding, source exact-head
PASS, all local gates and publication. It reads the live OPEN draft PR and
owning OPEN issue, failed and later green attempt censuses, base push control
and complete host authority comment. The retained log must match its SHA-256
and name every failed test; no such path may occur in the recorded base's
three-dot changed set. This is a necessary filter, never causal attribution.
The same workflow must have executed green on the exact unchanged head and
executed the same shard green on the recorded base. Every rerun job must be
completed success with a positive runner and nonempty steps. Only successes
from the failed attempt may carry forward; all required checks must be green,
and pending, cancelled or skipped effective jobs refuse. Other required checks
in the failed attempt must be green (the Windows aggregate may fail with its
failed Windows shard). No duration, error text or passing subset supplies this
control. Complete observations and their UTC bounds stay in the reservation.

The host interprets the evidence before issuing the grant. Its authority
comment includes the complete JSON `hostedExecutedFailure` object, stop marker,
source directory, repair SHA and `changedPathsExercised: yes` or
`changedPathsExercised: no`, with its explanation of whether the failed test
exercises changed paths. Text matching binds the capture; it establishes no
approval. The existing `gate-stop-continuation.json` at the accepted source
directory retains the exact failed `attempt.json` bytes and SHA-256 alongside
the stop, receipt, authority, publication and hosted observations. Only then
may one write restore that same cursor to `delivery`, re-deriving its source
stage/directory and preserving every other field. Replay rechecks the saved
failed copy, never the progressed cursor. A later failure cannot reopen it.
The original log stays byte-identical; a later executed red in that source
retains its ordinary complete evidence in `hosted-continuation-failure.log`.

The first continued operation freshly observes the existing publication's
required checks. Ordinary native refresh, independent DELTA, final-head gates,
hosted checks, merge and cleanup still apply. Admission charges no launch,
creates no author or attempt, refunds no counts and changes no ceilings. Refresh can require a DELTA reviewer,
but no conflict author or gate-correction author is authorized by this grant.
A later red, skipped or never-executed result returns to planning with
ISS-221 named; another comment, changed packet, refresh sibling or `ready` label
cannot buy another reservation. Completed replay is inert with or without
the grant. This grant family has no preflight: ISS-245's read-only preflight
evaluates terminal-attempt admission, not gate-stop grants; it is not a second
admission evaluator or evidence for this grant.

This remains candidate behavior until independent exact-head implementation
PASS, normal local gates and executed final-head Ubuntu/Windows/macOS bootstrap
green precede a separately authorized quiescent host installation. Landing
grants no ISS-234 re-entry, rerun, grant or start. The host separately executes
and records the exact-head green rerun, interprets the controls, posts authority,
places the grant in the SAME run config and resumes with `-Resume`. If the
fresh observation or any later continuation check is red, ISS-234 returns to
planning with ISS-221, never another grant. No timeout, shard, workflow, budget
or ISS-234 feature change is part of this repair.

## Milestones

| Key | Title                       | Exit evidence                                                                                                                                                                                                                             |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Unattended self-improvement | Three consecutive useful issues on this repo land through one attached `start-loop.ps1` invocation (one ISS-219 wrapper binding) with no per-item host script or manual step. The report lists each self-install supervisor re-exec with `from`/`to` SHAs separately from automatic retries and host restarts; planned restart recovery is separate. |
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

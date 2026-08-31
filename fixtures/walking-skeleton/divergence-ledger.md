# ISS-041 divergence ledger

Status: partial evidence only; full ISS-041 remains open. This is advisory
context for the later ISS-026 independent review, not a correctness dependency
or authority grant. The unchanged published protocol is
`docs/architecture/routine-cycle.md`.

| Protocol surface           | Current evidence and missing acceptance                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration before cycle | Existing pure loader admits external roots; provenance uses the public parser. No state service or lease is implemented.                                                                                                                                       |
| 2 project.snapshot         | Real branch and document-queue SDK fixtures produce configuration-bound project facts. No external provider or project CLI evidence is claimed.                                                                                                                |
| Input for 3                | Real SDK policy readers freshly observe source after a bound COMPLETE snapshot; Canonical outputs include project-breaker-facts/v1. This is observer evidence only, not implementation of routine step 3, generic breaker state/history, or recovery.          |
| 4 module.plan              | The public module descriptor/input/result seam binds actual COMPLETE observations, cycle intent, selected work ID and exact core/brief; normal no-action is a concrete public result. This is structural observer evidence, not authorized routine invocation. |
| 1, 3, 5–15                 | Unimplemented. No ordinal receipts, typed skips, terminal cycle, process execution, review reduction, mutation, or journal exists here.                                                                                                                        |
| Restart/reclaim            | Unimplemented. Exclusive state-directory creation is not a lease, crash recovery, or exactly-once side-effect protocol.                                                                                                                                        |

The executable gap census records `schemaVersion:unsupported` for
`event-journal/v1`,
and `cycle-receipt/v1`. Those records must come from
their owning public contracts before full-cycle parser evidence is possible;
existing unrelated schemas are never repurposed to fill the gap. A producer
adding support should update this gap test and ledger with its actual evidence.
ISS-002 now supplies pure structural `routine-step-skip/v1` parsing and digests;
this fixture still executes no skips and has no route, journal, or cycle authority.
ISS-002 also supplies the complete `worker-result-subject/v1` and
`release-candidate-subject/v1` structural parsers and their wrapper-free
`review-subject/v1` union. Empty placeholder records remain invalid. This fixture
still supplies no actual terminal/result materialization, subject production,
source admission, candidate certification, review, or full-cycle evidence.
ISS-002 also supplies pure `review-request/v1` parsing and request/inline-packet
identities. This fixture produces no review request and executes no review;
attempt results, authority, and all runtime evidence joins remain unimplemented.

ISS-013 supplies the consumed SDK snapshot/current-policy observations and public
configuration/facts binding. This fixture now consumes the public module input/result handoff; the SDK facts remain unchanged. The fixture copies the chosen row's actual
immutable subject and work.read capability; it never substitutes frontierDigest
or adds a snapshot-digest field. Snapshot or policy UNKNOWN/UNAVAILABLE, fresh
changed source, or substituted configuration/snapshot/policy binding produce no plan call or state output. Complete observations with no eligible work now produce a bound public no-action result. Tests retain exact canonical SDK policy
facts alongside the admitted full snapshot across the plan await. Branch and queue
policies may produce contrasting facts with identical observer briefs: NO_TRIP is
never permission, recovery, module admission, or capability use, and TRIP is not a
durable open receipt. ISS-013 AC7 and routine step 3 remain incomplete; undefined
generic history, reducer, and recovery contracts are not invented here.
SDK pagination, threshold, hostile-input, and deadline coverage remains with its
owner; project command success and full-cycle behavior remain
outside this fixture's evidence.

Future echo/review work must target a seeded earlier result from a distinct
author in a later review cycle. An implementation cannot approve its own result
in the same cycle. This partial packet implements neither role nor acceptance.

ISS-002 also supplies the complete structural review-attempt-result and claimed
review-authority parsers, their canonical identities, and a pure supplied-record
binding check. This fixture still has no actual review attempt, stable reduction,
history admission, or effective authority; valid supplied claims prove none of them.

Missing full acceptance: joined three-OS cycle journals, every-boundary
crash/resume matrix, frontier/rejecting-review/concurrent-lease refusals, and a
complete ordinal census. Current tests cover only the partial consumer's
records, malformed inputs, and bounded filesystem manifests. The ordinary
root test command includes them for subsequent three-OS CI; no hosted result
is asserted by this source ledger.

## Bounded session increment

The observer-only rows above remain unchanged for `consume.ts`. A separate
`session.ts` consumer now acquires an actual quarantined create-once claim and
produces public acquisition and step-1 health records from checked root/leaf
identity, retained handle bytes, reloaded configuration and injected clock
observations. Its source/provenance/paths, acquisition request, cycle request
and no-module cycle plan use public canonical contracts. A second holder gets
`REFUSED/SESSION_HELD`; malformed, missing, moved or conflicting observations
produce unknown evidence and retain the claim rather than taking over or
deleting another holder's state. This evidence is separate from the observer,
not a newly completed route from step 1 to step 2.

Known-current cleanup removes the checked claim and closes its handle; uncertain
cleanup closes without deletion. These are private fixture outcomes, not public
release receipts or native atomic deletion against hostile concurrent writers.
No lease renewal, production freshness/state admission, process execution,
journal start/replay, other ordinals or full crash/resume acceptance is claimed.
The fixture's unrenewed clock window does not grant runtime authority. Its
new session tests are authored evidence pending host execution and independent
review. The full-cycle gaps and both root capability placeholders remain.

The root-replacement control distinguishes an executed replacement from an
actual Windows `EPERM` rename denial while the claim is open. Executed replacement
requires unknown retention; observed denial requires exact unchanged identity
and bytes, healthy observation and normal cleanup. POSIX must execute the
replacement; Windows still executes the other poison controls. No handle is
dropped to force a mutation, and no denied mutation is labeled successful tampering.

## Public module seam increment

The observer replaces its private descriptor and core-to-brief call with the
complete public descriptor, input and wrapper-free result union. Its retained
input contains the actual configuration/provenance/snapshot/policy records,
caller cycle request and fixed descriptor. The one inline call chooses a READY
opaque work ID and subject; both the planner and caller bind the returned action
against the exact input. Missing eligible work produces public no-action with
no core or brief. Ten action outputs or eight no-action outputs round-trip;
setup and teardown remain outside the measured observer invocation.
The callable's only exports are descriptor/plan and its native Promise resolves
to the concrete public result. Parser-result wrappers remain internal; thrown
calls and malformed/wrapped results refuse before any observer output.

This explicitly follows the independently reviewed module ABI replan in the
contract ledger: actual observations replace undefined reduced facts, the
existing policy tuple replaces an undefined policy-code digest, and exact
compatibility tuples replace unspecified ranges. These records never assert
breaker permission, installed code identity, adapter module authorization,
worker launch, review or mutation. The separate session consumer is still not
composed with the observer. No private journal, partial public union, skip for
a missing parser, or complete-cycle claim is added. Current source checks are
subject to independent review and actual host/three-OS execution evidence.

## Joined session and observer increment

The new session-observer composition consumes its actual acquired cycle request
in the real snapshot/current-policy/public-module handoff. The fixed fixture
module census bounds requested IDs; default acquisition remains no-module.
Its initial public step-1 health record and a new live observation after the
async planner prevent using an altered claim for output. Only a claim-only root
can receive the thirteen action or eleven no-action canonical records. Cleanup
removes the known claim, retains unknown state and never removes other records.
This replaces the prior separation only for this new joined entrypoint; the
standalone observer and separate session APIs remain available and tested.

These records are not a journal and the post-call health observation does not
invent a later routine ordinal. No breaker reduction, worker, review, skip,
terminal or boundary-resume claim is made. Reused output refuses without
replacement, not exactly-once replay; the observer may have repeated its pure
read/plan work before that refusal. The concurrency/poison/frontier controls and
outside-state manifests are bounded fixture evidence subject to host execution,
independent review and three-OS CI, not production authority or isolation.

## Initial breaker observation increment

The separate `consumeInitialBreaker` path now executes a first reduction from
real SDK facts under the actual fixture lease. The owner retains exclusive
root creation and an initial empty census, then checks the live claim-only
root before its one permitted genesis observation. Existing empty/nonempty
roots, repeated observations and reused output refuse; a null predecessor
record itself proves nothing. First NO_TRIP becomes CLOSED; first TRIP becomes
OPEN with the exact cycle/policy opening digests. Both states round-trip through
the public complete breaker parser and supplied seven-record relation.

This resolves only fresh-fixture initial reduction. Generic history selection,
public journal beginning/current-end proof, recovery/probes, continuing from
held states and every-boundary resume remain absent. The separate module
observer is unchanged and does not consume this receipt as permission. No
complete routine cycle, installed authority, production genesis/reset or
ISS-041 completion is claimed. The evidence root remains disposable and no
production package imports the fixture.

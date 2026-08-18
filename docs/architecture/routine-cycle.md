# Routine cycle protocol v1

`routine-cycle/v1` is the exhaustive policy-neutral composition protocol. Each
step identity is the SHA-256 of canonical
`{cycleId, ordinal, kind, inputDigest, predecessorJournalDigest}`. A resume may
observe or complete the same step identity; it may not allocate a new identity
until the prior step has one terminal output.

| Ordinal/kind          | Owner                                                         | Typed input                                                                                                                                                 | Terminal output                                                                                                                                                                                         | Fresh authority point                                                                    | Next edge                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `session.verify`    | session                                                       | `cycle-request/v1`                                                                                                                                          | `session-health/v1`                                                                                                                                                                                     | immediately before cycle journal start                                                   | healthy → 2; stale/unknown → `FAILED_KNOWN`/`UNKNOWN`                                                                                                                             |
| 2 `project.snapshot`  | adapter SDK                                                   | adapter configuration                                                                                                                                       | `project-facts/v1`                                                                                                                                                                                      | live, paginated observation now                                                          | complete → 3; unavailable → named terminal                                                                                                                                        |
| 3 `breaker.reduce`    | breaker                                                       | facts + breaker history                                                                                                                                     | breaker holds/receipt                                                                                                                                                                                   | same facts/policy version                                                                | permitted capabilities → 4; all held → 14 no-work; unknown → `UNKNOWN`                                                                                                            |
| 4 `module.plan`       | portable module                                               | eligible opaque facts/capabilities                                                                                                                          | `module-action-plan/v1` + `dispatch-brief/v1`                                                                                                                                                           | exact snapshot digest                                                                    | action → 5; no eligible action → 14 no-work; invalid → `FAILED_KNOWN`                                                                                                             |
| 5 `route.select`      | routing                                                       | action capability + evidence snapshot                                                                                                                       | `route-selection/v1`                                                                                                                                                                                    | immediately before dispatch plan                                                         | route → 6; no supported route → `FAILED_KNOWN`; identity unknown → `UNKNOWN`                                                                                                      |
| 6 `project.preflight` | adapter SDK                                                   | action + route + subject                                                                                                                                    | `project-preflight/v1`                                                                                                                                                                                  | immediately before ownership publication                                                 | eligible unchanged subject → 7; refused/moved → `FAILED_KNOWN`                                                                                                                    |
| 7 `dispatch.plan`     | dispatch                                                      | action + route + unchanged preflight + role/credential references + digest-bound host-rendered `dispatch-brief/v1` bytes + optional immutable review target | `dispatch-plan/v1`                                                                                                                                                                                      | immediately before ownership publication                                                 | plan → 8; refused/moved → typed skips through 14 then 15; unknown → `UNKNOWN`                                                                                                     |
| 8 `worker.dispatch`   | dispatch/host                                                 | exact `dispatch-plan/v1` from step 7                                                                                                                        | launch/ownership receipt                                                                                                                                                                                | preflight and credential generation still current                                        | live → 9; start refused → typed failure then 11                                                                                                                                   |
| 9 `worker.observe`    | process/dispatch                                              | launch identity                                                                                                                                             | terminal receipt + immutable `worker-result-subject/v1` for implementation/observer, or `review-attempt-result/v1` for review                                                                           | exact process tree observation and result materialization                                | implementation result requiring review → 11 follow-up only; review result → 10; known failure → 11; identity conflict → `UNKNOWN`                                                 |
| 10 `review.reduce`    | review                                                        | `review-request/v1` binding immutable `review-subject/v1` + exact `review-attempt-result/v1`                                                                | `review-authority/v1` binding the target subject digest                                                                                                                                                 | target and attempt bytes unchanged                                                       | accepted/rejected → 11; unknown → `UNKNOWN`                                                                                                                                       |
| 11 `disposition.plan` | portable module                                               | action, exact action/review subject, worker terminal/attempt, and bound review authority or explicit skip                                                   | `action-disposition/v1` binding the same action-subject digest                                                                                                                                          | exact subject/receipt digests                                                            | apply request → 12; review-needed/repair/failure/no-action → 14 with `follow-up-cycle-request/v1`; invalid → `UNKNOWN`                                                            |
| 12 `mutation.plan`    | adapter SDK or release owner selected by disposition          | `action-disposition/v1` + same action-subject digest + fresh project/release facts                                                                          | `project-mutation-plan/v1` or `release-operation-plan/v1` (`assemble-certify` or `promote`), binding that digest                                                                                        | immediately before apply preflight; promotion only after accepted candidate review       | valid plan → 13; refused/moved → 14 with named refusal; unknown → `UNKNOWN`                                                                                                       |
| 13 `action.apply`     | same adapter/release owner that issued step 12                | exact plan/digest + same action-subject digest + review required by operation kind                                                                          | project apply, release candidate/certification, promotion, or refusal receipt binding the subject digest; successful promotion also emits mandatory successor-verification `follow-up-cycle-request/v1` | revalidate subject, plan, and every external authority immediately before first mutation | terminal → 14; interrupted known transaction → resume 13; stale/moved/substituted input → refuse then 14; unknown → `UNKNOWN`                                                     |
| 14 `resource.reclaim` | dispatch coordinating exact adapter and host resource owners  | all allocation, launch/process, terminal, disposition, and apply receipts                                                                                   | `resource-reclaim-receipt/v1` or retained-capacity refusal                                                                                                                                              | exact process tree dead before owner-specific reclaim                                    | reclaimed/no allocation → 15; live/unknown resource → retain capacity and `FAILED_KNOWN`/`UNKNOWN`                                                                                |
| 15 `cycle.terminal`   | engine/journal, with supervisor monitor for a recovery launch | all step/skip receipts + resource state + optional promotion fence/follow-up/recovery-launch pointer                                                        | `cycle-receipt/v1`; exact recovery-launch-terminal and fence-clear receipts are monitor outputs when a launch is attached                                                                               | journal prefix, resource census, promotion/broker read-back                              | complete/failure/no-work → current tick exits after its applicable fence handshake, then supervisor may schedule next tick; contradiction or uncleared required fence → `UNKNOWN` |

The host adapter renders the step-4 module-emitted `dispatch-brief/v1` into
the brief bytes during step-7 dispatch-plan construction, before ownership
publication; the rendered bytes are digest-bound in the dispatch plan and
launch identity. `ISS-011` owns the emitted structure, `ISS-021` owns the
versioned template and rendering goldens, and `ISS-008` owns digest binding.

The complete steps 7–10 block is skipped only for a typed action that requires
no worker or review; the module manifest must declare that capability and step
11's disposition schema must accept explicit skip receipts. After a step-8
launch refusal, only result observation and review (9–10) are skipped. After a
step-9 known worker failure, only review (10) is skipped. An implementation
result that requires review cannot mutate in its cycle: step 10 is skipped and
step 11 emits a later review-cycle request. A release promotion can never skip
exact-candidate independent review.
After successful promotion, step 13 records—but does not run—the successor-
verification follow-up. Steps 14 and 15 finish under predecessor N. Step 15
persists the terminal cycle receipt and verifies broker/resource state. With an
attached recovery launch, the child remains live while the supervisor monitor
advances the pointer to immutable `TERMINAL_COMPLETE`, clears the fence, and
allows child exit; archive/pointer cleanup requires exit proof. With no recovery
launch, the already-live ordinary predecessor clears the fence directly after
the same terminal proof and no launch record is invented. In both paths the
canonical activation cleanup gate remains until broker-internal authorization
revocation and gate archive/removal; the shim refuses the next ordinary tick
until then;
the current scheduler tick then exits. The next scheduler-authenticated tick is
the only actor that may start the follow-up cycle under N+1.
Every skip is an explicit terminal step receipt, not an omitted ordinal. Any
non-`UNKNOWN` outcome before step 15 emits a typed skip receipt for every
remaining inapplicable ordinal, while step 14 always emits either a no-allocation
receipt or an owner-specific reclaim result. The terminal receipt therefore
binds a complete ordinal census even for snapshot, routing, or preflight refusal.

Every allocation path passes step 14 before step 15, including pre-launch
refusal, start failure, worker failure, review rejection, stale mutation plan,
and interrupted apply. Review rejection cannot mutate in the same cycle: step 11
may emit only a `follow-up-cycle-request/v1`, which a later cycle replans from
fresh facts. Step 13 accepts only the step-12 plan identity from the same cycle;
a pre-worker/module plan, missing plan, moved subject, or stale external
observation refuses before mutation.

`cycle plan` creates only an authority-free `cycle-plan/v1`: cycle and
session request identities, this fixed protocol/version, allowed module/adapter
identities, and configuration digests. It contains no live facts, breaker
result, route, preflight, dispatch plan, worker result, or mutation authority.
Those values have exactly one producer in steps 2–13. A
`worker-result-subject/v1` is canonical immutable materialization of the exact
base revision, resulting tree or ordered patch/artifact digest, worker attempt,
and terminal receipt. A later worker-result review cycle carries that identical
target digest through steps 10–13; any rematerialization, byte/order change,
moved revision, or reused review refuses.
`review-subject/v1` is a closed union of that worker-result subject and
`release-candidate-subject/v1` (landed source SHA/tree, candidate/manifest/test-
bundle/certification digests). A review occurs in a distinct later cycle whose
step-7 plan binds the target and `review` role; step 9 materializes the review
attempt result, and step 10 authorizes only the unchanged target. The accepted
review cycle may then plan/apply the target mutation in steps 11–13.
Release `assemble-certify` is a typed no-worker/no-review operation over a fresh
landed-source subject and emits the immutable release-candidate subject plus
three-OS certification before terminal/reclaim. It cannot promote. A later
review cycle targets that candidate; only its accepted receipt permits a
`release-operation-plan/v1` of kind `promote` for the unchanged candidate.

## Exhaustive terminal and skip routing

`routine-step-skip/v1` binds cycle, skipped ordinal/kind, predecessor terminal
output digest, and one closed reason: `prior-known-terminal`, `no-worker`,
`no-review`, `no-mutation`, or `no-allocation`. It conveys no authority. For a
non-`UNKNOWN` outcome, these routes are exhaustive:

| Terminal source                          | Required remainder                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1 session known-unhealthy                | skip 2–13; 14 no-allocation; 15 `FAILED_KNOWN`                                                                    |
| 2 snapshot unavailable                   | skip 3–13; 14 no-allocation; 15 `FAILED_KNOWN`                                                                    |
| 3 all capabilities held                  | skip 4–13; 14 no-allocation; 15 `COMPLETED_NO_WORK`                                                               |
| 4 no action / invalid-known              | skip 5–13; 14 no-allocation; 15 no-work/known-failure                                                             |
| 5 unsupported route                      | skip 6–13; 14 no-allocation; 15 `FAILED_KNOWN`                                                                    |
| 6 preflight refused/moved-known          | skip 7–13; 14 no-allocation; 15 `FAILED_KNOWN`                                                                    |
| 7 dispatch plan refused/moved-known      | skip 8–13; 14 no-allocation; 15 `FAILED_KNOWN`                                                                    |
| 8 launch refused                         | 9 no-worker-result; 10 no-review; 11 failure disposition; skip 12–13; 14 reclaim/no-allocation; 15 `FAILED_KNOWN` |
| 9 worker known-failure                   | 10 no-review; 11 failure disposition; skip 12–13; 14 reclaim; 15 `FAILED_KNOWN`                                   |
| 9 implementation result requiring review | 10 no-review; 11 emits exact-target later review-cycle request; skip 12–13; 14 reclaim; 15 complete-follow-up     |
| 9 review-attempt result                  | 10 reduces authority for the pre-bound review target; continue through 11                                         |
| 10 review rejected                       | 11 follow-up disposition; skip 12–13; 14 reclaim; 15 `FAILED_KNOWN`                                               |
| 11 repair/failure/no-action              | skip 12–13; 14 reclaim/no-allocation; 15 known-failure/no-work                                                    |
| 12 mutation plan refused-known           | skip 13; 14 reclaim/no-allocation; 15 `FAILED_KNOWN`                                                              |
| 13 apply terminal/refused                | 14 reclaim/no-allocation; 15 complete/known-failure                                                               |
| 14 reclaim terminal/refused              | 15 complete/known-failure; live unknown resource makes 15 `UNKNOWN`                                               |

An `UNKNOWN` output journals that contradiction when the prefix remains safely
appendable and forbids further authoritative steps; it never fabricates skip
authority merely to complete the census. Launch refusal is not a no-worker
action: steps 7–8 are terminal receipts and only 9–10 are typed skips.

Terminal mapping is fixed:

- expected refusal with intact identity/resources → `FAILED_KNOWN` plus a typed
  repair, retry, or no-retry recommendation for a later cycle;
- complete frontier with no eligible permitted action and no allocation → `COMPLETED_NO_WORK`;
- applied terminal action and reclaimed/no-longer-needed resources → `COMPLETED`;
- missing, contradictory, moved-after-authorization, false-prefix, or unowned
  side effect → `UNKNOWN`, which prevents the supervisor from starting a new
  mutation cycle.

The supervisor—not the engine cycle—owns re-entry. It invokes one tick at a time
from an installed OS scheduler definition, proves the prior tick/cycle terminal
or safely resumable, and records cadence/restart evidence.

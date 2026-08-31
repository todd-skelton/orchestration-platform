# ISS-041 divergence ledger

Status: partial evidence only; full ISS-041 remains open. This is advisory
context for the later ISS-026 independent review, not a correctness dependency
or authority grant. The unchanged published protocol is
`docs/architecture/routine-cycle.md`.

| Protocol surface           | Current evidence and missing acceptance                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration before cycle | Existing pure loader admits external roots; provenance uses the public parser. No state service or lease is implemented.                                                                                                                                      |
| 2 project.snapshot         | Real branch and document-queue SDK fixtures produce configuration-bound project facts. No external provider or project CLI evidence is claimed.                                                                                                               |
| Input for 3                | Real SDK policy readers freshly observe source after a bound COMPLETE snapshot; six canonical outputs now include project-breaker-facts/v1. This is observer evidence only, not implementation of routine step 3, generic breaker state/history, or recovery. |
| 4 module.plan              | Fixture policy selects one eligible READY work.read row from COMPLETE facts and retains its subject in the real action core/brief. No module descriptor, input/result admission, or module-action-plan is claimed.                                            |
| 1, 3, 5–15                 | Unimplemented. No ordinal receipts, typed skips, terminal cycle, process execution, review reduction, mutation, or journal exists here.                                                                                                                       |
| Restart/reclaim            | Unimplemented. Exclusive state-directory creation is not a lease, crash recovery, or exactly-once side-effect protocol.                                                                                                                                       |

The executable gap census records `schemaVersion:unsupported` for
`event-journal/v1`, `worker-result-subject/v1`,
`review-request/v1`, `review-attempt-result/v1`, `review-authority/v1`,
and `cycle-receipt/v1`. Those records must come from
their owning public contracts before full-cycle parser evidence is possible;
existing unrelated schemas are never repurposed to fill the gap. A producer
adding support should update this gap test and ledger with its actual evidence.
ISS-002 now supplies pure structural `routine-step-skip/v1` parsing and digests;
this fixture still executes no skips and has no route, journal, or cycle authority.

ISS-013 supplies the consumed SDK snapshot/current-policy observations and public
configuration/facts binding. This fixture adds a private snapshot/policy-to-brief
handoff, not a new snapshot-to-action public contract. The fixture copies the chosen row's actual
immutable subject and work.read capability; it never substitutes frontierDigest
or adds a snapshot-digest field. Snapshot or policy UNKNOWN/UNAVAILABLE, fresh
changed source, substituted configuration/snapshot/policy binding, or no eligible
work produce no plan call or state output. Tests retain exact canonical SDK policy
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

Missing full acceptance: joined three-OS cycle journals, every-boundary
crash/resume matrix, frontier/rejecting-review/concurrent-lease refusals, and a
complete ordinal census. Current tests cover only the partial consumer's
records, malformed inputs, and bounded filesystem manifests. The ordinary
root test command includes them for subsequent three-OS CI; no hosted result
is asserted by this source ledger.

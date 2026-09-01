# Published ISS-041 skeleton step and boundary table

This table describes the quarantined fixture composition only. Public contract
parsers validate its records; the fixture grants no production authority.

Every ordinal writes and reads back STARTED before its owner runs, then writes
and reads back one TERMINAL with identical step bytes. Ordinal 1 has a null
step predecessor. Every later ordinal binds the OPJ1 prefix before STARTED.

| Ordinal | Kind                | Input identity               | Terminal arm     | Accepted path                         |
| ------- | ------------------- | ---------------------------- | ---------------- | ------------------------------------- |
| 1       | `session.verify`    | cycle request                | SESSION          | healthy retained fixture claim        |
| 2       | `project.snapshot`  | adapter configuration        | PROJECT_FACTS    | complete SDK snapshot                 |
| 3       | `breaker.reduce`    | project facts                | BREAKER          | fresh-root initial CLOSED capability  |
| 4       | `module.plan`       | complete review module input | MODULE           | fixed review action                   |
| 5       | `route.select`      | module action                | ROUTE            | fixed echo host selected              |
| 6       | `project.preflight` | route                        | PREFLIGHT        | exact seeded subject reread           |
| 7       | `dispatch.plan`     | preflight                    | DISPATCH_PLAN    | no credentials, one HOST input intent |
| 8       | `worker.dispatch`   | dispatch plan                | LAUNCH           | one fixed direct child                |
| 9       | `worker.observe`    | launch                       | WORKER_TERMINAL  | exit 0 plus review attempt            |
| 10      | `review.reduce`     | review attempt               | REVIEW_AUTHORITY | accepted distinct-author target       |
| 11      | `disposition.plan`  | complete disposition input   | DISPOSITION      | explicit nonmutating COMPLETE         |
| 12      | `mutation.plan`     | disposition                  | SKIP             | `no-mutation`                         |
| 13      | `action.apply`      | step-12 skip                 | SKIP             | `no-mutation`                         |
| 14      | `resource.reclaim`  | complete reclaim context     | RECLAIM          | input absent, child/handles closed    |
| 15      | `cycle.terminal`    | pre-15 reduced state         | CYCLE_TERMINAL   | COMPLETED after known reclaim         |

The rejected-review control differs only at steps 10 and 11: authority is
rejected, disposition is FOLLOW_UP/REPLAN with an actual caused
`follow-up-cycle-request/v1`, and the final receipt is FAILED_KNOWN. It never
applies a mutation.

## Retained evidence

- Step 7: `RENDERED_INPUT` from `rendered-input.bin`.
- Steps 9, 11 and 14: sorted `STDERR` and `STDOUT` from the exact retained
  capture files.
- All other events: empty evidence census.

The managed `echo-input.bin` is deleted at step 14. The separate rendered
evidence file remains so final replay does not depend on a reclaimed resource.

## Boundary matrix

The injection seam emits `JOURNAL_HEADER`, `STARTED:1` through `STARTED:15`,
and `TERMINAL:1` through `TERMINAL:15`, plus:

- `INPUT_ALLOCATED`
- `OWNERSHIP_PUBLISHED`
- `CHILD_SPAWNED`
- `CHILD_TERMINAL_OBSERVED`
- `RECLAIM_BEFORE_DELETE`
- `RECLAIM_AFTER_DELETE`
- `SESSION_CLOSED`

A process-level fault at any boundary before claim cleanup leaves the create-once
session claim. Read-only restart may parse and reduce `cycle.opj`, but a new owner
must receive `SESSION_HELD` before another source callback, child launch,
deletion or append. At the sole `SESSION_CLOSED` post-cleanup row, the complete
terminal journal and absent claim return `CYCLE_ALREADY_TERMINAL` without an
acquisition or effect. These are the named refusal/idempotent branches, not lease
adoption or production resume. A partial frame is retained and blocks append; a
lost acknowledgement of a complete identical event is idempotent.

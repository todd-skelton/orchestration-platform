<!-- Historical branch A identity: planning/pressure-tests/2026-08-17-round-34.md at cebe7249bc4ad9c5be99c796b96e9399356ed4cb. Superseded by reconciliation; no disposition here authorizes the reconciled head. -->

# Pressure test — round 34

**Disposition:** `BLOCK_REPLAN`

The thirty-fourth review was the packet's first proportionality review: it
attacked whether the specified machinery matches the declared single-writer,
single-host topology, whether the outlined work delivers observable value
early, and whether the review path the authority model depends on is ever
measured. Unlike rounds 1–33, its findings remove or right-size machinery
rather than adding it. The packet remains unregistered pending fresh review.

| Finding | Repair applied |
| --- | --- |
| `OP-R34-001` — Sparse authority trees, 256-sibling proofs, the node-inventory census, the singleton materialization coordinator, and the epoch-split commit run defend Byzantine/multi-writer threats the architecture already excludes with the kernel-exclusive lock; rounds 16–32 fixed defects this machinery itself introduced. | Replaced with one hash-chained append-only `authority-history/v1` log verified by a full walk from genesis; twelve pointer kinds; single-epoch commit runs; rotation terminalized by one `rotation-verification-receipt/v1`. Decisions amended in `contract-decisions.md`; `ISS-002/004/006/014/015/030` and dependents rewritten. |
| `OP-R34-002` — `DECIMAL_ASCII` arbitrary-precision ordinals purchase nothing: at the supervisor cadence the safe-integer bound exceeds any plausible installation lifetime by orders of magnitude. | Ordinals/counts are safe-integer-bounded decimal strings with explicit refusal above `2^53 - 1`. |
| `OP-R34-003` — Thirteen never-deployed superseded schema generations were frozen in a `diagnostic` namespace with parsers, refusal paths, and mutant coverage but no possible reader. | Pre-deployment superseded schemas are deleted, not archived; the shipped census is `v1` for every family; forward-compatibility refusal is recorded as a deliberate decision. `ISS-002` AC13 rewritten. |
| `OP-R34-004` — The dispatch brief — the one prose surface handed to a model worker — was the only unspecified schema in the packet. | `dispatch-brief/v1` added to `ISS-002`; modules emit closed structure (`ISS-011` AC), hosts render deterministically, rendered bytes are digest-bound in the dispatch plan (`ISS-008`). |
| `OP-R34-005` — No issue produced an observable end-to-end cycle before `ISS-026` (eleven blockers), and `@orchestration-platform/contracts` had no runtime consumer. | Added `ISS-041` walking-skeleton slice: disposable vertical fixture, first runtime consumer of the contracts package, divergence ledger feeds `ISS-026`. It blocks nothing. |
| `OP-R34-006` — No issue owned operator observability; the N1 health-summary module existed only as a change vehicle. | Added `ISS-042` operator status projection: read-only, advisory `operator-status/v1`, explicit `UNKNOWN` rendering, lands via the new shared-scaffold amendment path. |
| `OP-R34-007` — The authority model assumes independent review discriminates, but nothing measures it; the reviewer is itself a model run. | Added `ISS-043` review-discrimination calibration: seeded-defect corpus through the byte-identical production review path, advisory report with published floors, missed defects become permanent regression fixtures. |
| `OP-R34-008` — The engine/adapter vocabulary rule was enforced only by review. | `ISS-002` AC14 adds a generated vocabulary lint over engine contract field names and enum values, seeded-mutant verified. |
| `OP-R34-009` — The same native-store attack matrix was restated in six issues, guaranteeing drift. | `ISS-031` owns the single shared attack-suite fixture; `ISS-021/023/032/035/038` rerun it by reference. |
| `OP-R34-010` — `ISS-036` was labeled a probe but permanently configures production rulesets and a verifier anchor. | Relabeled `type:slice` and retitled; the ruleset and anchor are declared deliberate durable outputs, not probe residue. |
| `OP-R34-011` — `ISS-017` and `ISS-018` defined the shadow comparison window twice; epic child indexes had drifted from draft titles; `ISS-014`'s title still promised rollback removed by `OP-R2-008`; the release-layout decision still shipped undefined "skill" files. | `ISS-017` owns the published window and `ISS-018` references it; child indexes realigned; `ISS-014` retitled to forward recovery; release layout ships module files only and `ISS-011` retitled accordingly. |
| `OP-R34-012` — `ISS-000`-frozen shared scaffold had no declared amendment process, and the pressure-test protocol could only ratchet complexity upward (15 issues added, one behavior removed in 33 rounds). | `work-model.md` adds the shared-scaffold amendment path and the removal-round rule: at least one removal round per packet revision, and a packet is not `PASS` until its latest removal round is clean. |

## Deliberately retained

- Closed-record/array reflective snapshots: implemented, bounded, and
  load-bearing for total parsing; removal would be churn without simplification.
- The destination-owner/anchor CAS protocol: it guards the one real
  multi-writer boundary (two installation IDs, one physical destination).
- Fail-closed `UNKNOWN`, tombstoned removal, epoch fencing, and the
  stable-predecessor promotion protocol: proportionate and unchanged.

## Re-review focus

- Every draft reference to sparse trees, node inventory, the coordinator,
  epoch-split checkpoints, `DECIMAL_ASCII`, or the diagnostic namespace is
  gone; no dangling `Dnir`/`Dplan`/`Drh`/`Dhand` sigil survives.
- The linear chain closes the same attack set the trees closed for a single
  writer: fork, gap, reorder, truncation, head substitution, stale root.
- New issues `ISS-041/042/043` carry complete scope fences, executable
  evidence, and correct DAG registration without inflating the `ISS-019` gate.
- The next round must include a removal round per the amended protocol.

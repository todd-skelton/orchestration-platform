<!-- Historical branch A identity: planning/pressure-tests/2026-08-17-round-35.md at cebe7249bc4ad9c5be99c796b96e9399356ed4cb. Superseded by reconciliation; no disposition here authorizes the reconciled head. -->

# Pressure test — round 35

**Disposition:** `BLOCK_REPLAN`

The thirty-fifth independent review attacked the round-34 replacement authority
protocol for correctness. It found two unmitigated protocol defects, one
completeness-argument gap, and a set of consistency and executability defects.
The packet remains unregistered pending repair and a clean removal round.

| Finding | Repair applied |
| --- | --- |
| `OP-R35-001` — A rotation run's post-CAS checkpoint had no legal epoch: E(n) handles revoke at selection and a checkpoint under E(n+1) would be a forbidden two-epoch run, so every rotation left a permanently non-terminal run-current journal. | Decision amended: the rotation run performs the CAS as its final action and legitimately rests at CAS-armed; the first fresh new-epoch run's lock-held chain walk writes the rotation run's ordinary terminal resolution before any other mutation, which is not a two-epoch run. `ISS-002/004/006/014/015` rewritten to match. |
| `OP-R35-002` — A crash between chain append and authority CAS left an excess record indistinguishable from an injected one, permanently bricking chain verification with no written recovery path. | Decision amended: rotation is forward-only once appended; the walked chain may exceed the selected head by exactly one record matching the armed rotation intent, resumable only by the same transaction re-driving the same CAS; any other excess/gap/fork refuses. Mirrored into `ISS-002` AC10 and `ISS-004` AC4. |
| `OP-R35-003` — The chain walk's completeness argument silently depended on directory enumeration the governing decision declared nonexistent, and truncation refusal was unfounded without a stated walk direction. | Decision amended: records live at canonical ordinal-derived paths; the walk constructs record n+1's path and never enumerates; head+1 must be absent or match the armed intent, head+2 must be absent; off-path files carry no authority. `ISS-022` re-scoped to create-once/readback existence semantics at constructed paths. |
| `OP-R35-004` — `credential-broker.md` still shipped `/v2` schema names with no banner, contradicting the v1-everywhere census and two drafts. | Broker schema families renamed to `/v1`; `state-machines.md` citations fixed in the body rewrite. |
| `OP-R35-005` — `bootstrap-manifests.md` asserted a deleted append-receipt family as a current `v1` family. | Sentence deleted. |
| `OP-R35-006` — One live coordinator-lifecycle residue (`STARTED` in `ISS-022` AC9) and one deleted-machinery word ("batch" in `ISS-002` ownership) survived round 34. | Both removed. |
| `OP-R35-007` — `dispatch-brief/v1` had no renderer owner: `ISS-008` stated the binding without an AC, `ISS-011` carried a rendering AC it cannot own, and `ISS-021` still admitted "role-specific prompts". | `ISS-021` owns the versioned deterministic template with cross-OS rendering goldens and a prose-injection refusal AC; `ISS-008` gains the digest-binding AC; `ISS-011` narrowed to emitted structure; the `ISS-021` fence now reads "rendered `dispatch-brief/v1` bytes". |
| `OP-R35-008` — `ISS-041` required workspace membership the frozen scaffold forbids while disclaiming the edit. | Skeleton moved to `fixtures/walking-skeleton/` landing through one declared shared-scaffold amendment adding a predeclared `fixtures/*` glob with census updates. |
| `OP-R35-009` — `ISS-042`'s `status` family had no named handler-owner package against an exhaustive ownership table, and cited a nonexistent verification command. | Owner named: new `@orchestration-platform/status` package; the single scaffold amendment adds `status show` emitting `operator-status/v1` to the registry and every census table; the `bootstrap-manifests.md` table gains the row; evidence corrected to `pnpm run verify:bootstrap`. |
| `OP-R35-010` — `ISS-031` reproduced the probe-with-durable-outputs defect `OP-R34-010` fixed for `ISS-036`: a probe owning a permanent certification-time fixture with no addressed path. | `ISS-031` relabeled `type:slice`, retitled, and the suite declared a deliberate durable output at `probes/credentials/attack-suite/` with its digest recorded in the bootstrap manifest census. |
| `OP-R35-011` — Two pass/fail thresholds were "published" by nobody: the chain-walk time budget and the review-calibration floors. | `ISS-006` publishes the 1000-record golden budget (five seconds per walk on hosted runners); `ISS-043` publishes its floors (≥90% seeded-defect rejection per class, ≥80% known-good acceptance) with floor changes as reviewed replan decisions. |
| `OP-R35-012` — `ISS-041`/`ISS-043` asserted sequencing ("before X dispatches/relies") their blocks-nothing stance cannot enforce. | Both reworded: the divergence ledger and calibration report are declared inputs of the consuming issues' independent review packets; no phantom gates. |
| `OP-R35-013` — The removal-round rule was self-inconsistent: round 34 added machinery in the round that wrote the rule, and "clean" was ambiguous. | `work-model.md` amended: a removal round may add only strictly smaller replacements for what it deletes; clean means an evidence-backed nothing-further-removable finding; a general replan round does not count as the revision's removal round. |
| `OP-R35-014` — Two `EPIC-RUNTIME` child-index titles had drifted from their drafts. | Copied verbatim from the drafts. |
| `OP-R35-015` — `ISS-017` claimed ownership of the comparison window that `first-consumer.md` actually defines, relocating the `OP-R34-011` duplication instead of removing it. | `ISS-017` consumes and reports against the `first-consumer.md`-published window; `ISS-018` references the same publication. |

## Clean dimensions

Roadmap↔draft frontmatter, epic DAG mirrors, child membership, command census,
capability slots, and chain-record producer split (`ISS-004` appends, `ISS-020`
genesis) were verified consistent across all registered issues. The sigil sweep
found no dangling removed-machinery reference in drafts beyond `OP-R35-006`.

## Re-review focus

- The rotation rest-state and terminal-resolution semantics close
  `OP-R35-001/002` without reintroducing a second epoch or a receipt pair.
- The head-plus-one pending rule cannot be abused to smuggle a forged record:
  it must match the armed rotation intent bound to the CAS-armed run-current
  journal.
- The constructed-path walk needs only create-once/readback and reliable
  absence observation, which `ISS-022` now probes explicitly.

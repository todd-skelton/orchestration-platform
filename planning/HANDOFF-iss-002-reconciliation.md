# Handoff: reconcile the ISS-002 authority replan before resuming implementation

You were implementing `packages/contracts` against the **superseded** authority
design. Two independent simplification replans have since landed, they agree on
the replacement, and neither has been implemented. Stop implementing the old
model; reconcile the two replans first, then implement the reconciled one.

## Where things stand

- `origin/iss-002-versioned-contracts` is at **`e77fc77`** (merge of PR #57,
  which sits on PR #51). Call this **B**.
- Local branch `iss-002-versioned-contracts` is at **`cebe724`**, two commits
  that are not upstream. Call this **A**. It is 1 ahead / 5 behind `e77fc77`.
- `packages/contracts` (~15,000 lines) still implements the design **both**
  replans deleted: sparse Merkle authority trees, node inventory, the
  materialization coordinator, epoch-split commit runs, `DECIMAL_ASCII`
  ordinals, and the `diagnostic` namespace. Commit `7af15dd`
  ("close v3 authority evidence") is part of that superseded work.
- The GitHub board is synced to A's drafts and verified by
  `pnpm run planning:board-check`. Issue keys now match B for ISS-000..043.

## What both replans already agree on — treat as settled, do not relitigate

Authority history is one hash-chained append-only `authority-history/v1` log
selected by `state-mutation-authority-value/v1`, which binds the head ordinal
and head record digest. Records live at canonical ordinal-derived paths; the
walk constructs path `n+1` from `n` and never enumerates a directory.
Verification is a full walk from genesis against the selected head; head+1 must
be absent or match the armed rotation intent; head+2 must be absent; off-path
files carry no authority. Set completeness is proven by the walk alone.

Every commit run is single-epoch. Rotation runs under the old capability,
settles pending proposals on the other kinds, appends the chain record,
performs the authority CAS as its final action, executes no checkpoint after
that CAS, and rests at CAS-armed. Rotation is forward-only once appended; a
crash between append and CAS is resumable only by the same transaction
re-driving the same CAS. There is no rotation receipt, no handoff-receipt pair,
and no coordinator. `Drot` is derived, never caller-supplied. Ordinals are
canonical decimal strings bounded by the safe-integer range.

`dispatch-brief/v1`, the engine-vocabulary lint, the proportionality decision,
and the transitive reduction of `roadmap.json` are byte-identical in both.

## The reconciliation you must perform

Base on **B** (`e77fc77`) — it is already upstream. Apply the following.

### Take from B (do not carry A's variant)

1. **Record shape.** B's closed `GENESIS|ROTATION` union with shared `Dsc`
   (`state-mutation-successor-authority-core/v1`), derived `Dop`
   (`reviewed-authority-operation/v1`), `Dgb`
   (`authority-history-genesis-bootstrap-input/v1`), downstream `Dgse`
   (`authority-history-genesis-selection-evidence/v1`), and branch-tagged `Dh`
   (`0x00` GENESIS / `0x01` ROTATION). A's flat record is defective: it
   requires a retiring epoch on every record while ordinal 0 has none, and its
   own text contradicts itself on whether record 0 has a null predecessor or
   binds a genesis literal.
2. **Rotation terminalization.** B's closed
   `ORDINARY|AUTHORITY_ROTATION` `pointer-mutation-commit-evidence/v1` union,
   where the rotation arm binds only the old selected checkpoint-5 core and
   admits exactly `RESUMABLE|SELECTED|UNKNOWN` as **derived** terminal truth
   with no post-CAS write. Include the forbidden-not-ignored rule: checkpoint
   6/7/8 fields, an ordinary resolution, a post-checkpoint-5 selector
   observation, or any successor-epoch write for a rotation target is
   contradictory evidence that reduces to `UNKNOWN`. Include the `Dcommit`
   branch and packet-authority tags. Discard A's "each fresh new-epoch run
   writes the rotation run's terminal resolution" mechanism and everything
   built to support it (successor path recomputation, the phase-matrix
   exception, the resumability wording).
3. **Ordinal parse rule.** Validate grammar and compare the decimal string
   against `Number.MAX_SAFE_INTEGER` by length and lexicographic order
   **before any numeric conversion**, so an overflow value never reaches
   `Number`. Restore this in `compatibility.md`, the `F` framing bullet in
   `supervisor-contract.md`, and `ISS-002` AC2.
4. **Issue keys ISS-039..043 and the two issues at ISS-039/ISS-040.**

### Take from A (`cebe724`) — cherry-pick or port

1. **Delete retention and compaction entirely.** Registry drops to **eleven**
   kinds (`AUTHORITY_RETENTION` removed), the evidence packet to eleven slots,
   proposal classification to `PENDING|SELECTED|LOST_CONFLICT|UNKNOWN`, and
   `AUDIT_DEGRADED`, `TERMINAL_CHECKPOINT_ALLOWED`, `authority-retention/v1`,
   and `state-mutation-destination-owner-retention/v1` are removed. Every
   record class is FULL_REQUIRED; loss of a required record is `UNKNOWN` and
   blocks mutation. Rotation then settles "the other ten kinds". After this,
   re-check the "ten tombstone-enabled families" sentence — it becomes exact,
   and should name the excluded kind inline.
2. **The armed-rotation-intent equality set** (head+1 ordinal, predecessor
   digest equal to the head record digest, rotation identity and successor
   facts matching the selected CAS-armed journal plus its create-once intent
   record; with no armed intent selected, any head+1 file refuses). This
   composes with B's rotation arm.
3. **Two missing schemas** in the registry list:
   `recovery-authorization-archive/v1` and
   `recovery-authorization-attachment-archive/v1` — both already declared
   closed by `credential-broker.md`. This is a real gap in B.
4. **`dispatch-brief/v1` wiring**: into `routine-cycle/v1` steps 4 and 7 and
   `ISS-026` AC7, with ownership split `ISS-011` emits structure, `ISS-021`
   owns the template and rendering goldens, `ISS-008` owns the digest binding.
   Narrow `ISS-002` AC12 accordingly.
5. **Cleanups**: delete the `READY_ONLY` descriptor state (descriptor is
   `LIVE`-only, binding the CAS-selected reservation); fold the terminal
   summary into the `TERMINAL` attempt-log record; re-scope `ISS-022` off
   paginated directory enumeration onto create-once/readback existence and
   reliable absence at constructed paths; deduplicate the `ISS-035`/`ISS-038`
   physical reboot drill; bound the coordinated-substitution mutant sets to
   enumerated counts; delete the `platform-configuration/v0-fixture` migration
   and the `migrate` public entry point.
6. **Tooling and record**: `scripts/planning/board-check.mjs`,
   `scripts/planning/board-check.d.mts`, `test/board-contracts.test.ts`, the
   `planning:board-check` script, the transitively-implied-edge rule in
   `scripts/planning/check.mjs`, `planning/pressure-tests/2026-08-17-round-*`,
   and the work-model amendment paragraphs (removal-round protocol,
   shared-scaffold amendment path, board reconciliation contract).
7. **ISS-044 and ISS-045** (Claude Code worker-host probe and adapter), M4
   under `EPIC-ADOPTION`, blocked by `ISS-021` and `ISS-044` respectively.

### Adopt B's prose convention

Draft prose must match the reduced graph: write "Directly blocked by X; Y
remains its transitive prerequisite" rather than naming implied edges as
blockers. A's `ISS-002`, `ISS-004`, and the two renumbered kernel drafts
currently violate this.

## After reconciling

1. `pnpm run planning:check`, `pnpm run planning:board-check`,
   `pnpm run format:check`, `pnpm run typecheck`, `pnpm test`,
   `pnpm run verify:bootstrap` must all pass.
2. **Run a fresh independent pressure-test round.** Neither side's disposition
   survives the merge: A reached `PASS` at round 41 on A's design, and B's
   round 36 records that its first independent review returned `BLOCK_REPLAN`
   and its repaired head still requires new review. Per
   `docs/planning/work-model.md`, the packet is not `PASS` until its latest
   removal round is clean.
3. **Only then** implement `packages/contracts`. The reconciled design is the
   target; everything currently in `approved.ts`, `inventory.ts`, `v2.ts`,
   `diagnostic.ts`, and `registry.ts` that encodes sparse trees, the node
   inventory, the coordinator, epoch-split runs, `DECIMAL_ASCII`, the
   `retention` field, or the diagnostic namespace is deleted under `ISS-002`
   AC13, not migrated.

## Do not

- Do not resurrect the sparse-tree substrate, the coordinator, the node
  inventory, epoch-split runs, arbitrary-precision ordinals, or the diagnostic
  namespace. Both replans deleted them against a written proportionality
  standard.
- Do not reassign ISS-039 or ISS-040; PR #49/#57 own those keys.
- Do not edit the GitHub board by hand; change drafts and re-sync, then verify
  with `pnpm run planning:board-check`.

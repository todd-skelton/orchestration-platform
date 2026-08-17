# Work model

The repository uses a deliberately small vocabulary:

- Milestones are independently usable outcomes with explicit exit evidence.
- Epics are non-executable capabilities and own their child issues.
- Slices are bounded implementation outcomes.
- Probes gather evidence required before an implementation decision.
- The draft `parent` field expresses epic membership.
- The draft `blocked_by` edges express correctness dependencies.

Labels have one meaning each:

- `type:*`: epic, slice, probe, decision, bug.
- `area:*`: architecture, contracts, runtime, core, review, telemetry, modules,
  routing, release, integrations, quality.
- `priority:*`: p0 through p3, used only to resolve contention between runnable
  slices.
- `risk:*`: authority, security, compatibility, data-loss.
- `status:*`: blocked, tracking, needs-decision.

Sequencing belongs in dependencies and epic DAGs, not phase or wave labels.

The delivery program has five outcome milestones: portable substrate, minimum
orchestration kernel, self-hosting release, Chase Sets integration-ready, and
Chase Sets adoption. Milestone placement describes the evidence an issue helps
produce; native dependencies determine when the issue is runnable. Preparation
for a later outcome may proceed early when its own dependencies are satisfied.

Imported Chase Sets issues are provenance, not a second executable backlog.
Reusable acceptance outcomes consolidate into the current platform issue that
owns the capability. Consumer-specific policy remains in the Chase Sets
adapter or product backlog. A source issue may create a new platform slice only
when the current graph has no owner for its acceptance outcome.

The minimum kernel is the smallest complete authority chain that can select,
dispatch, independently review, journal, recover, and supervise one cycle.
Cost forecasting, autonomy experiments, multi-model optimization, alternate
recovery paths, and richer board projections remain advisory or parked until a
measured blocker requires them. This keeps self-orchestration on the critical
path without turning historical repairs into permanent platform machinery.

`planning/roadmap.json` is the authoritative registration graph. Each epic's
Chain DAG block is a generated, direct-edge mirror—not a transitive summary.
`pnpm run planning:check` rejects missing drafts, mismatched keys, parents or
milestones, dependency cycles, unlisted direct edges, and hand-edited DAG drift.

Shared scaffold owned by `ISS-000` (root wrappers, command registries, census
tables, build configuration) is amended only through a single reviewed change
that edits the registration and every census table restating it together, with
the owning issue named in the change. Frozen scaffold is not immutable
scaffold; an amendment without its census updates fails verification.

Pressure testing ratchets in both directions. A packet review round may add
machinery only against a named threat inside the declared topology. At least
one round per packet revision must be a removal round, whose only permitted
dispositions are deleting or simplifying states, schemas, receipts, proofs, or
issues — including strictly smaller replacements for what it deletes, never
net-new additions — or recording an explicit evidence-backed finding that
nothing further is removable. A removal round is clean only in that second
case; a round that produced removals is repaired and followed by another
removal round. A packet is not `PASS` until its latest removal round is clean.
A general replan round (such as round 34) does not count as the revision's
removal round even when it removes machinery. Complexity that only defends
against threats the architecture excludes is a finding, not a safeguard.

Registered blocked-by edges are the transitive reduction of correctness
dependencies; the checker treats a transitively implied direct edge as drift.
A draft's prose may name any consumed contract regardless of whether its edge
is direct.

Drafts are the source of truth and the registered board mirrors them. Each
board item opens with a `planning-key` marker, then its parent-epic reference
and source-draft link, then the verbatim draft. `pnpm run planning:board-check`
reconciles the two: it rejects a missing, duplicated, or unregistered item, a
title or milestone that disagrees with the draft and roadmap, and any body that
has drifted from its draft — including the labels and dependency edges the
draft frontmatter carries. Board and drafts change in the same reviewed
change; a board edited directly is drift, not authority.

# Work model

The repository uses a deliberately small vocabulary:

- Milestones are independently usable outcomes with explicit exit evidence.
- Epics are non-executable capabilities and own their child issues.
- Slices are bounded implementation outcomes.
- Probes gather evidence required before an implementation decision.
- Native sub-issues express epic membership.
- Native blocked-by relationships express correctness dependencies.

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

Every replan and independent review includes one bounded proportionality check.
For each retained or proposed mechanism, it records the concrete in-scope
threat, the deletion test, the smallest credible alternative, and why the
selected shape is smaller or better evidenced. A finding may delete machinery
or adopt a strictly smaller replacement in the same repair. The repaired packet
returns to the ordinary independent exact-head review gate; there is no
repeat-until-clean removal ritual. Complexity that only defends against threats
the architecture excludes is a finding, not a safeguard.

Portable planning standards also register a falsifiable prediction and
review-by horizon, express acceptance criteria as observable properties with
the cheapest discriminating evidence, and treat a prescribed replan mechanism
only as the floor of properties to preserve. A surface with no current
consumer must name either its consuming dependency or its parked unpark
condition; hypothetical future-consumer prose does not make it ready.

Registered blocked-by edges are the transitive reduction of correctness
dependencies; the checker treats a transitively implied direct edge as drift.
A draft's prose may name any consumed contract regardless of whether its edge
is direct.

Reduction audits classify lifecycle timing and external-authority admission as
correctness dependencies before removing edges. A direct edge is retained when
the alternate path does not itself establish that timing or authority; closure
alone is insufficient evidence to erase a semantically distinct gate.

Drafts are the source of truth and the registered board mirrors them. Each
board item opens with a `planning-key` marker, then its parent-epic reference
and source-draft link, then the verbatim draft. `pnpm run planning:board-check`
reconciles the two: it rejects a missing, duplicated, or unregistered item, a
title or milestone that disagrees with the draft and roadmap, incomplete or
duplicated pagination, and any body that has drifted from its draft — including
the labels and dependency edges the draft frontmatter carries. It also proves
each registered issue appears exactly once on Orchestration Platform Delivery
and every migrated source identity is absent from Chase Sets Delivery; Project
presentation status is not authority because no roadmap field owns it. Board
and drafts change in the same reviewed change; a board edited directly is
drift, not authority.

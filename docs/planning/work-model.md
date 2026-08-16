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

`planning/roadmap.json` is the authoritative registration graph. Each epic's
Chain DAG block is a generated, direct-edge mirror—not a transitive summary.
`pnpm run planning:check` rejects missing drafts, mismatched keys, parents or
milestones, dependency cycles, unlisted direct edges, and hand-edited DAG drift.

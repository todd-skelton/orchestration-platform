---
key: EPIC-MODULES
title: "Epic: Package portable planning, delivery, and routing modules"
labels: ["type:epic", "area:modules"]
children: [ISS-011, ISS-012, ISS-039, ISS-040, ISS-047]
---

## Outcome

Projects can consume versioned, provider-neutral planning, delivery, review,
and model-routing modules — embedded in a pinned platform release through the
static registry — whose contracts are independent from any one backlog or AI
vendor. Standalone module install/update tooling is deliberately out of scope
until a second consumer exists.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-013 → ISS-011`;
  `ISS-010, ISS-011, ISS-025 → ISS-012`;
  `ISS-009, ISS-011 → ISS-039`;
  `ISS-011 → ISS-040`;
  `ISS-010, ISS-011 → ISS-047`.
- Gate: modules consume engine contracts and project-adapter facts; they do not
  read a consumer repository's labels or file layout directly. Repository-local
  work-model templates are explicitly excluded from portable bundles.
- Parked: a public module marketplace; un-park after two independent consumers
  prove the packaging contract.
- Decision registry: none.
- Consumption: `ISS-019` directly consumes `ISS-039` and `ISS-040` before the
  immutable N0 certification census freezes. Deleting those edges permits the
  shipped module content to land after certification; routing through another
  slice adds machinery without preserving a fresher candidate boundary.

## Child index

- `ISS-011` — Package portable planning, delivery, and review modules.
- `ISS-012` — Implement provider-neutral model routing.
- `ISS-039` — Carry non-blocking simplification findings through review and repair modules.
- `ISS-040` — Enforce simplest-correct-solution and evidence-proportionality planning standards.
- `ISS-047` — Implement telemetry-driven discovery intake for replanning.

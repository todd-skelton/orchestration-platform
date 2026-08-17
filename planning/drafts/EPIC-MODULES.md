---
key: EPIC-MODULES
title: "Epic: Package portable planning, delivery, and routing modules"
labels: ["type:epic", "area:modules"]
children: [ISS-011, ISS-012, ISS-039]
---

## Outcome

Projects can install versioned, provider-neutral planning, delivery, review,
and model-routing modules whose contracts are independent from any one backlog
or AI vendor.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-002, ISS-006, ISS-013 → ISS-011`;
  `ISS-010, ISS-011, ISS-025 → ISS-012`;
  `ISS-009, ISS-011, ISS-013 → ISS-039`.
- Gate: modules consume engine contracts and project-adapter facts; they do not
  read a consumer repository's labels or file layout directly. Repository-local
  work-model templates are explicitly excluded from portable bundles.
- Parked: a public module marketplace; un-park after two independent consumers
  prove the packaging contract.
- Decision registry: none.

## Child index

- `ISS-011` — Package portable planning, delivery, and review skills.
- `ISS-012` — Implement provider-neutral model routing.
- `ISS-039` — Carry non-blocking simplification findings through the review and repair modules.

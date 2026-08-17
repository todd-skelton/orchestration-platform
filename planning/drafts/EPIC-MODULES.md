---
key: EPIC-MODULES
title: "Epic: Package portable planning, delivery, and routing modules"
labels: ["type:epic", "area:modules"]
children: [ISS-011, ISS-012]
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
  `ISS-010, ISS-011, ISS-025 → ISS-012`.
- Gate: modules consume engine contracts and project-adapter facts; they do not
  read a consumer repository's labels or file layout directly. Repository-local
  work-model templates are explicitly excluded from portable bundles.
- Parked: a public module marketplace; un-park after two independent consumers
  prove the packaging contract.
- Decision registry: none.
- Reserved PR49 topology: `ISS-039` (simplification findings) remains a
  Self-hosting release child blocked directly by `ISS-009` and `ISS-011`;
  `ISS-040` (evidence proportionality) remains a Self-hosting release child
  blocked directly by `ISS-011`. PR49 owns both draft files and registration
  rows, so this branch reserves their keys without duplicating those changes.

## Child index

- `ISS-011` — Package portable planning, delivery, and review modules.
- `ISS-012` — Implement provider-neutral model routing.

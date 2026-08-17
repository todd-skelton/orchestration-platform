---
key: EPIC-KERNEL
title: "Epic: Build the orchestration control-plane kernel"
labels: ["type:epic", "area:core"]
children: [ISS-025, ISS-007, ISS-008, ISS-009, ISS-010, ISS-026, ISS-030]
---

## Outcome

The engine can own one session, dispatch bounded workers, reduce exact-revision
review authority, and reconstruct its state from an append-only journal without
consumer-specific policy.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-002, ISS-004, ISS-013 → ISS-025`;
  `ISS-003, ISS-004, ISS-006 → ISS-007`;
  `ISS-005, ISS-007, ISS-013, ISS-025, ISS-032 → ISS-008`;
  `ISS-002, ISS-008 → ISS-009`;
  `ISS-002, ISS-003, ISS-004, ISS-007 → ISS-010`;
  `ISS-003, ISS-007, ISS-008, ISS-009, ISS-010, ISS-011, ISS-012, ISS-013, ISS-014,
  ISS-025, ISS-032 → ISS-026`;
  `ISS-003, ISS-004, ISS-005, ISS-006, ISS-007, ISS-010, ISS-026, ISS-032, ISS-038 → ISS-030`.
- Parallelism: review authority and the event journal may proceed in parallel
  once their gates are satisfied.
- Gate: no kernel module may invent a project priority, readiness, repository,
  branch, cleanliness, or deployment rule; dispatch consumes only opaque
  identities and preflight facts from `ISS-013`.
- Parked: distributed coordination across multiple machines; un-park after the
  single-host kernel is self-hosting.
- Recovery attempts are unlimited over installation lifetime but each operation
  verifies a bounded reservation/descriptor/summary/accumulator packet selected
  through ISS-004.
- Authority rotations and retained node inventory are also lifetime-unbounded:
  selected decimal counts and bounded sparse/page proofs replace capped tables;
  missing or injected history blocks cold-host work.

## Child index

- `ISS-025` — Implement policy-neutral circuit-breaker authority.
- `ISS-007` — Implement session leases and freshness.
- `ISS-008` — Implement worker dispatch and ownership.
- `ISS-009` — Implement immutable worker-result review authority.
- `ISS-010` — Implement the event journal and deterministic reducers.
- `ISS-026` — Implement the policy-neutral routine engine cycle.
- `ISS-030` — Implement cross-platform cycle supervision and cold-host re-entry.

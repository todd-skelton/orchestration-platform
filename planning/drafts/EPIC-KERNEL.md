---
key: EPIC-KERNEL
title: "Epic: Build the orchestration control-plane kernel"
labels: ["type:epic", "area:core"]
children: [ISS-025, ISS-007, ISS-008, ISS-009, ISS-010, ISS-026, ISS-030, ISS-041, ISS-042, ISS-043]
---

## Outcome

The engine can own one session, dispatch bounded workers, reduce exact-revision
review authority, reconstruct its state from an append-only journal without
consumer-specific policy, show the operator what it is doing, and measure that
its independent review actually discriminates.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-004, ISS-013 → ISS-025`;
  `ISS-003, ISS-004 → ISS-007`;
  `ISS-005, ISS-007, ISS-025, ISS-032 → ISS-008`;
  `ISS-008 → ISS-009`;
  `ISS-007 → ISS-010`;
  `ISS-012, ISS-014 → ISS-026`;
  `ISS-026, ISS-038 → ISS-030`;
  `ISS-003 → ISS-041`;
  `ISS-010 → ISS-042`;
  `ISS-009, ISS-021 → ISS-043`.
- Parallelism: review authority and the event journal may proceed in parallel
  once their gates are satisfied. The walking skeleton runs as soon as
  contracts and the CLI exist and blocks nothing; its divergence ledger is
  context for the engine cycle.
- Gate: no kernel module may invent a project priority, readiness, repository,
  branch, cleanliness, or deployment rule; dispatch consumes only opaque
  identities and preflight facts from `ISS-013`.
- Parked: distributed coordination across multiple machines; un-park after the
  single-host kernel is self-hosting.
- Parked: same-host concurrent cycles — more than one routine cycle, and so
  more than one worker, in flight per installation. Un-park when a measured
  cycle-throughput or worker-runtime blocker is recorded against self-host
  delivery or the `ISS-017` delivery-rate comparison. Replacement floor for
  that decision: fan out only observation steps (snapshot through review
  reduction), keep every authority-pointer mutation single-writer behind the
  `ISS-026` one-cycle fence, and weigh a dispatch/observe cycle split with
  workers detached from the tick process tree as the smallest credible
  alternative before any multi-writer machinery.
- Registered throughput ceiling: the supervisor contract binds a five-minute
  scheduler cadence with 30-minute native execution limits, a reviewed slice
  consumes about five serial cycles (implementation, worker-result review,
  assemble-certify, candidate review, verification), and in-cycle worker
  observation on Windows and Linux is bounded below the tick execution limit
  because the worker shares the tick's process tree. Decided route: re-entry
  becomes event-based with the periodic definition retained as fallback —
  each OS definition adds its native queued trigger and the shim emits one
  trigger from the persisted terminal receipt (`ISS-030`) — which removes
  inter-cycle wait from the serial slice chain while leaving tick and worker
  execution limits as the remaining levers. No pressure-test round has
  attacked throughput yet, so the next kernel replan's proportionality check
  must include this ceiling and the trigger surface.
- Recovery attempts are unlimited over installation lifetime; each operation
  verifies the selected reservation/descriptor and folded TERMINAL attempt-log records plus the
  append-only attempt log, whose full verification stays cheap because
  attempts are rare and ordinals are safe-integer bounded.
- Authority rotation history is one hash-chained append-only log verified by a
  full walk from genesis; missing or injected records block cold-host work.

## Child index

- `ISS-025` — Implement policy-neutral circuit-breaker authority.
- `ISS-007` — Implement session leases and freshness.
- `ISS-008` — Implement worker dispatch and ownership.
- `ISS-009` — Implement immutable worker-result review authority.
- `ISS-010` — Implement the event journal and deterministic reducers.
- `ISS-026` — Implement the policy-neutral routine engine cycle.
- `ISS-030` — Implement the installed supervisor and recovery runtime.
- `ISS-041` — Run the walking-skeleton cycle end to end.
- `ISS-042` — Implement the operator status projection.
- `ISS-043` — Calibrate independent review discrimination.

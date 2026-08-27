---
key: EPIC-RUNTIME
title: "Epic: Establish the portable runtime foundation"
labels: ["type:epic", "area:runtime"]
children:
  [
    ISS-000,
    ISS-001,
    ISS-002,
    ISS-003,
    ISS-006,
    ISS-022,
    ISS-004,
    ISS-005,
    ISS-031,
    ISS-032,
    ISS-035,
    ISS-038,
  ]
---

## Outcome

The platform has an executable repository, contract-first TypeScript runtime,
trusted three-OS harness, and proven configuration, state, locking, and
process-control behavior. A separately gated native credential broker then
extends that foundation for cold-session self-hosting without ambient secrets.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-000 → ISS-001`;
  `ISS-001 → ISS-002`;
  `ISS-006 → ISS-003`;
  `ISS-002 → ISS-006`;
  `ISS-006 → ISS-022`;
  `ISS-022 → ISS-031`;
  `ISS-003, ISS-004, ISS-031 → ISS-032`;
  `ISS-031 → ISS-035`;
  `ISS-032, ISS-035, ISS-036 → ISS-038`;
  `ISS-022 → ISS-004`;
  `ISS-022 → ISS-005`.
- Gate: the capability probe must prove the selected implementation can meet
  every required OS guarantee before state or process work dispatches.
- Parked: standalone native binaries and remote worker hosts; un-park after the
  local Node runtime reaches parity.
- Decisions: TypeScript, Node.js 24, pnpm, three equal operating-system targets.
  State authority additionally requires the ISS-022-proven fixed epoch lock;
  ISS-004 owns the eleven-kind selection surface, the hash-chained linear
  authority-history log, and single-epoch authority runs; ISS-032 only
  requests typed broker transitions.

## Child index

- `ISS-000` — Bootstrap the repository toolchain and executable verification surface.
- `ISS-001` — Capture the reference behavior and authority inventory.
- `ISS-002` — Define versioned configuration, state, and receipt contracts.
- `ISS-003` — Build the portable CLI and configuration loader.
- `ISS-006` — Establish the trusted cross-platform test harness.
- `ISS-022` — Probe portable filesystem and process guarantees.
- `ISS-004` — Implement atomic state, locking, and recovery primitives.
- `ISS-005` — Implement portable process ownership and termination.
- `ISS-031` — Select credential backends and publish the native-store attack suite.
- `ISS-032` — Implement confined credential broker and recovery authorization.
- `ISS-035` — Probe cross-platform host custody and reboot evidence.
- `ISS-038` — Implement host custody and signed reboot evidence.

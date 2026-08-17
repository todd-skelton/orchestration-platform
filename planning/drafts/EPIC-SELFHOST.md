---
key: EPIC-SELFHOST
title: "Epic: Release the platform through its stable predecessor"
labels: ["type:epic", "area:release"]
children:
  [
    ISS-014,
    ISS-029,
    ISS-020,
    ISS-023,
    ISS-021,
    ISS-036,
    ISS-033,
    ISS-019,
    ISS-037,
    ISS-034,
    ISS-027,
    ISS-015,
  ]
---

## Outcome

An independently authorized bootstrap release N0 is installed, then N0
orchestrates and promotes unchanged N1 through a reviewed, crash-recoverable
protocol. No candidate gains authority before promotion completes.

This milestone consumes the minimum orchestration kernel rather than every
future controller optimization. Cost forecasting, autonomy experiments,
advanced board projections, and multi-model planning experiments remain
post-self-host improvements unless a measured blocker promotes them.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-009, ISS-010 → ISS-014`;
  `ISS-038 → ISS-029`;
  `ISS-029, ISS-033 → ISS-020`;
  `ISS-012, ISS-031 → ISS-023`;
  `ISS-008, ISS-023 → ISS-021`;
  `ISS-013 → ISS-036`;
  `ISS-021, ISS-026, ISS-038 → ISS-033`;
  `ISS-020, ISS-030 → ISS-019`;
  `ISS-019 → ISS-037`;
  `ISS-037 → ISS-034`;
  `ISS-034 → ISS-027`;
  `ISS-027 → ISS-015`.
- Gate: all release evidence binds the same immutable candidate digest.
- Parked: automatic rollout to external consumers; un-park after the first
  consumer completes shadow adoption.
- Decision registry: bootstrap root, release layout, and predecessor authority
  are settled in `docs/architecture/contract-decisions.md`.
  Reviewed bootstrap owns state-authority genesis/reinstall; later authority
  rotation is a forward ISS-014 request. ISS-004 rotates in one single-epoch
  run under E(n) that appends the `authority-history/v1` record and performs
  the authority CAS as its final action, legitimately resting CAS-armed.
  Prior-selected/exact-pending evidence is resumable under E(n), while
  successor-selected/exact-`Drot`/`Dsc`-record/old-checkpoint-5 evidence derives
  `SELECTED`; otherwise truth is `UNKNOWN`. Rotation stage6–8, ordinary
  resolution, later selector evidence, and E(n+1) writes refuse.

## Child index

- `ISS-014` — Implement stable release promotion and forward recovery.
- `ISS-029` — Probe authenticated bootstrap workflow and operator-grant authority.
- `ISS-020` — Build and install the independently authorized N0 release.
- `ISS-023` — Probe the Codex CLI worker-host authority contract.
- `ISS-021` — Implement the first concrete Codex worker-host adapter.
- `ISS-036` — Establish live GitHub authority and the pre-N0 protection surface.
- `ISS-033` — Implement the concrete self-host project adapter.
- `ISS-019` — Certify bootstrap N0 on every supported operating system.
- `ISS-037` — Independently review the certified bootstrap N0 candidate.
- `ISS-034` — Provision and bind production N0 credential references.
- `ISS-027` — Authorize and install independently reviewed bootstrap N0.
- `ISS-015` — Complete the first stable-predecessor self-hosting release.

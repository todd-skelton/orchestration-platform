---
key: EPIC-SELFHOST
title: "Epic: Release the platform through its stable predecessor"
labels: ["type:epic", "area:release"]
children: [ISS-014, ISS-029, ISS-020, ISS-023, ISS-021, ISS-036, ISS-033, ISS-019, ISS-037, ISS-034, ISS-027, ISS-015]
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
  `ISS-004, ISS-009, ISS-010, ISS-032 → ISS-014`;
  `ISS-000, ISS-006, ISS-038 → ISS-029`;
  `ISS-006, ISS-014, ISS-021, ISS-029, ISS-032, ISS-033, ISS-038 → ISS-020`;
  `ISS-003, ISS-006, ISS-012, ISS-031 → ISS-023`;
  `ISS-005, ISS-008, ISS-011, ISS-012, ISS-013, ISS-023, ISS-032 → ISS-021`;
  `ISS-000, ISS-002, ISS-006, ISS-013 → ISS-036`;
  `ISS-003, ISS-004, ISS-005, ISS-008, ISS-010, ISS-011, ISS-013, ISS-014, ISS-021,
  ISS-026, ISS-032, ISS-036, ISS-038 → ISS-033`;
  `ISS-006, ISS-007, ISS-008, ISS-009, ISS-010, ISS-011, ISS-012, ISS-013,
  ISS-014, ISS-020, ISS-021, ISS-025, ISS-026, ISS-030, ISS-032, ISS-033,
  ISS-038 → ISS-019`;
  `ISS-019, ISS-023, ISS-038 → ISS-037`;
  `ISS-020, ISS-032, ISS-033, ISS-038, ISS-037 → ISS-034`;
  `ISS-019, ISS-034, ISS-037 → ISS-027`; `ISS-027, ISS-033 → ISS-015`.
- Gate: all release evidence binds the same immutable candidate digest.
- Parked: automatic rollout to external consumers; un-park after the first
  consumer completes shadow adoption.
- Decision registry: bootstrap root, release layout, and predecessor authority
  are settled in `docs/architecture/contract-decisions.md`.
  Reviewed bootstrap owns state-authority genesis/reinstall; later authority
  rotation is a forward ISS-014 request. ISS-004 preauthorizes/materializes
  under E(n), selects E(n+1), terminalizes the exact epoch-split run, and then
  finishes the singleton coordinator under E(n+1).

## Child index

- `ISS-014` — Build immutable release promotion and recovery.
- `ISS-029` — Probe authenticated bootstrap workflow and operator-grant authority.
- `ISS-020` — Implement and freeze the bootstrap root of trust.
- `ISS-023` — Probe the Codex CLI worker-host authority contract.
- `ISS-021` — Implement the first concrete Codex worker-host adapter.
- `ISS-036` — Probe live GitHub and Actions authority for self-hosting.
- `ISS-033` — Implement the concrete self-host project adapter.
- `ISS-019` — Certify bootstrap N0 on every supported OS.
- `ISS-037` — Independently review the certified bootstrap N0 candidate.
- `ISS-034` — Provision and bind production N0 credential references.
- `ISS-027` — Authorize and install independently reviewed bootstrap N0.
- `ISS-015` — Complete the first stable-predecessor self-hosting release.

---
key: EPIC-ADOPTION
title: "Epic: Adopt the platform through a versioned project adapter"
labels: ["type:epic", "area:integrations"]
children: [ISS-013, ISS-028, ISS-016, ISS-024, ISS-017, ISS-018, ISS-044, ISS-045]
---

## Outcome

Chase Sets first prepares its typed adapter, parity fixture, and import recovery
without live mutation. After the platform self-hosts, Chase Sets pins that
release, proves shadow parity, and cuts over with a rehearsed recovery path.

The readiness slices (`ISS-028`, `ISS-016`, and `ISS-024`) run as soon as their
native dependencies clear; they do not wait artificially for self-hosting.
Only live shadow and cutover (`ISS-017`, `ISS-018`) require the self-host release.

The second-host slices (`ISS-044`, `ISS-045`) restore the first consumer's
dual Codex/Claude lane routing surface under platform authority. They start
after the first concrete host lands, reuse its proven probe pattern without
inheriting any of its evidence, and sit off the self-host critical path.

## Orchestrator handoff

- Direct-edge DAG (generated from `planning/roadmap.json`):
  `ISS-003 → ISS-013`;
  `ISS-013 → ISS-028`;
  `ISS-025 → ISS-016`;
  `ISS-016, ISS-028 → ISS-024`;
  `ISS-015, ISS-016, ISS-028 → ISS-017`;
  `ISS-017, ISS-024 → ISS-018`;
  `ISS-021 → ISS-044`;
  `ISS-044 → ISS-045`.
- Gate: shadow comparison follows `docs/planning/first-consumer.md`,
  distinguishes authoritative decisions from advisory telemetry, and explains
  every authority difference.
- Gate: adapter workspace topology (`ISS-013`, `ISS-028`) keeps isolation
  keyed per workspace subject and must not hard-code a single concurrent
  subject, so un-parking same-host concurrency in `EPIC-KERNEL` requires no
  adapter contract change.
- Parked: second-consumer onboarding; un-park after the first cutover remains
  stable for its observation window.
- Decision registry: none.

## Child index

- `ISS-013` — Define and validate the project adapter SDK.
- `ISS-028` — Scaffold the first-consumer adapter composition root.
- `ISS-016` — Capture the first consumer parity fixture.
- `ISS-024` — Implement and fixture first-consumer state import recovery.
- `ISS-017` — Run authoritative shadow comparison for the first consumer.
- `ISS-018` — Cut over the first consumer with tested recovery.
- `ISS-044` — Probe the Claude Code CLI worker-host authority contract.
- `ISS-045` — Implement the second concrete Claude Code worker-host adapter.

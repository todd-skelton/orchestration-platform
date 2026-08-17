# Chase Sets orchestration-work migration

## Purpose

Move the reusable delivery controller out of the Chase Sets product program
without importing its historical implementation complexity into the portable
platform. Chase Sets remains the first consumer; it no longer owns the generic
orchestration backlog.

The migration is capability-preserving, not ticket-preserving. A chain of
superseded controller repairs maps to one current platform contract or slice.
Source issues keep their history and receive a destination link, but do not
become duplicate executable work on the new board.

## Completeness claim

The claim is bounded to the 183 open source issues observed on 2026-08-17; it
does not pretend to predict ideas filed after that census. Every observed issue
appears exactly once in the manifest's `ownershipGroups` as `CAPTURED`,
`PARKED`, or `COMPLETED_PROVENANCE`. Captured groups name their native platform
owners. Parked groups name both their future owners and an evidence-based
unpark condition. The planning checker rejects omissions, duplicate ownership,
unknown destinations, overlapping exclusions, and parked work without an
unpark condition.

New generic orchestration proposals must update the manifest or be filed
directly under a native platform epic. New Chase-specific proposals remain in
the consumer adapter/product backlog. This is the executable boundary between
"known future work is captured" and an unbounded promise about unknown future
requests.

## Destination outcomes

1. **Portable substrate** — contracts, CLI, state, filesystem, process, and
   three-OS evidence.
2. **Minimum orchestration kernel** — one complete lease-to-review-to-journal
   fixture cycle with recovery.
3. **Self-hosting release** — reviewed N0 produces and activates unchanged N1.
4. **Chase Sets integration-ready** — adapter, parity fixture, and import
   recovery are ready without live mutation.
5. **Chase Sets adoption** — shadow parity, cutover, and recovery evidence.

Milestones are outcome gates, not a ban on parallel preparation. In
particular, integration-ready work starts as soon as its own dependencies
clear, so self-host completion immediately unlocks live Chase Sets work.

## Source boundary

The exact provider-mutation census is
`planning/chase-sets-orchestration-migration.json`. It contains 183 open
source issues: 182 source-board items plus one orchestration issue that was
already absent from the board. The set is the complete open native sub-issue
census of these Chase Sets epics, all open generic controller issues, and the
named successor series below, observed on 2026-08-17:

- `chase-sets/chase-sets#6903` and child `#6403` — event-read authority.
- `#6904` and children `#6536`, `#6537`, `#6538`, `#6539`, `#6540`, `#6563`,
  `#6564`, `#6575`, `#6576`, `#6580`, `#6582`, `#6583`, `#6584` — controller
  launch/test evidence. The parked reporter-hardening chain stays parked unless
  a measured platform failure activates it.
- `#6905` and children `#6255`, `#6257`, `#6283`, `#6310`, `#6311`, `#6312`,
  `#6317`, `#6318`, `#6345`, `#6356`, `#6357`, `#6391`, `#6392`, `#6393`,
  `#6394`, `#6560`, `#6561`, `#6562`, `#6574`, `#6579`, `#6850`, `#6851`,
  `#6852`, `#6853`, `#6927`, `#6928` — delivery control.
- Decision/autonomy successors `#6993`–`#6997`, routing-cost successors
  `#6888`–`#6892`, session successors `#6785`–`#6786`, and current controller
  repairs `#6763`, `#6769`, `#6808`, `#6809`, `#6828`, `#6883`, `#6954`,
  `#6966`, `#6968`, `#6978`.
- Latest dispatch/release/breaker authority chains represented by `#6680`,
  `#6682`–`#6685`, `#6687`, `#6517`, `#6550`–`#6552`, `#6557`, `#6597`,
  `#6600`, `#6642`–`#6651`, and `#6653`. Earlier duplicate generations remain
  historical evidence and are removed from executable boards with the same
  destination as their latest successor.

Explicit exclusions stay on the Chase Sets delivery board:

- `#6906` and its product CI/deploy children;
- DOKS, staging, commerce, mobile, provider, and launch operations;
- consumer-specific merge qualification or production-deploy policy that is
  implemented through the Chase Sets adapter rather than the platform kernel.

## Capability consolidation

| Reusable source capability | Canonical platform destination |
| --- | --- |
| leases, session handoff, stale recovery | `ISS-007` |
| dispatch briefs, lane ownership, admission, worker launch | `ISS-008`, `ISS-021`, `ISS-023` |
| exact-head independent review and replan breaker | `ISS-009`, `ISS-037` |
| durable ledger, reducers, telemetry, decision records | `ISS-010` |
| portable planning/delivery/review skill | `ISS-011` |
| provider-neutral routing and advisory cost evidence | `ISS-012` |
| release installation, predecessor authority, rollback/recovery | `ISS-014`, `ISS-020`, `ISS-027` |
| circuit breakers and repair admission | `ISS-025` |
| routine cycle and supervision | `ISS-026`, `ISS-030` |
| GitHub board, issue, Actions, and protection authority | `ISS-033`, `ISS-036` |
| test/reporter hardening with demonstrated portable value | `ISS-006`; otherwise parked |
| Chase-specific policy and pipeline behavior | Chase Sets adapter/backlog; not platform core |

## Anti-overengineering rules

- Self-hosting requires the minimum complete authority chain, not every
  historical controller optimization.
- A source issue is imported as a new slice only when no current platform issue
  owns its acceptance outcome.
- Repeated fixes to the same source concept become regression cases under one
  platform issue, not new public schemas or pointer kinds by default.
- Advisory telemetry never becomes mutation authority.
- GitHub/provider details stay behind adapters; the kernel consumes typed
  capabilities.
- Park cost forecasting, autonomy experiments, multi-model ensembles, advanced
  board projections, and reporter polish until self-host evidence or a measured
  blocker makes them necessary.
- Prefer one obvious composition path and one recovery path. A second path
  requires an observed platform need and an explicit decision.

## Board mutation protocol

1. Create **Orchestration Platform Delivery** and add every open platform epic
   and issue.
2. Create the five outcome milestones above and assign platform issues from
   `planning/roadmap.json`.
3. Add the three source epics as temporary provenance items, then link each to
   this migration record and its canonical destinations.
4. For every source item in the canonical set, add a migration comment, remove
   it from **Chase Sets Delivery**, and either close it as superseded or retain
   it as non-executable history when an external decision/evidence record still
   needs to stay open.
5. Do not move excluded consumer work. Reconcile item counts and source issue
   numbers from complete paginated project and issue collections against the
   checked-in migration manifest.

The new board's executable frontier is always derived from native issue
dependencies and milestones. Imported source provenance never competes with a
platform slice for dispatch.

Destination keys `ISS-039` and `ISS-040` are reserved for PR49's post-census
simplification and evidence-proportionality issues. This note does not amend
the immutable 183-source snapshot or import PR49's `#6999/#7000` addendum; new
issues in this replan begin at `ISS-041`.

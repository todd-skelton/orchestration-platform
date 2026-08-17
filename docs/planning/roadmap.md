# Bootstrap roadmap

## Program outcome

Deliver a portable, self-hosting orchestration platform that can be adopted by
an external project through a pinned release and versioned adapter.

## Outcome 1: Portable substrate

The same CLI, configuration, state contracts, and operating-system primitives
pass conformance tests on current macOS, Windows, and Linux runners. The runtime
has no PowerShell dependency.

Exit evidence: the complete conformance suite passes on all three operating
systems from a clean checkout and produces equivalent normalized receipts.

## Outcome 2: Minimum orchestration kernel

A policy-neutral cycle acquires a lease, selects work through an adapter,
dispatches a concrete worker, obtains independent review, journals the result,
applies routing and breaker policy, and resumes correctly after interruption.

Exit evidence: one isolated end-to-end fixture completes with crash,
stale-authority, provider-boundary, and self-certification negative controls.

## Outcome 3: Self-hosting release

A stable release orchestrates implementation and independent review of its
successor, then promotes the unchanged candidate through a crash-recoverable
protocol without granting the candidate pre-promotion authority.

Preparatory M2 slices may start when their own dependencies clear. N0
authorization is gated by the complete Portable foundation exit evidence at
`ISS-019`, rather than by a blanket milestone entry gate.

Exit evidence: stable N produces and promotes N+1 in an isolated fixture, with
negative controls proving that moved, self-signed, or partially reviewed
candidates are refused.

## Outcome 4: Chase Sets integration-ready

The Chase Sets composition root, adapter contract, parity fixture, and
state-import recovery rehearsal are complete. This preparation may run in
parallel with kernel and self-host work whenever native dependencies clear, so
the repository can begin Chase Sets implementation immediately after the
self-hosting release exists.

Exit evidence: the adapter builds against the pinned SDK, the fixture covers
every authoritative incumbent decision, and a disposable import/recovery drill
passes without live Chase Sets mutation.

## Outcome 5: Chase Sets adoption

An external repository pins the platform, supplies a project adapter, proves
shadow-mode parity against its incumbent controller, and cuts over with a
tested rollback or forward-repair path.

Parity-fixture preparation may start when its own dependencies clear. Live
shadow and cutover activation remain gated by the self-hosting dependencies on
`ISS-017`.

Exit evidence: a sustained shadow comparison has no unexplained authoritative
decision differences, followed by a successful cutover drill.

## Capability epics

1. Portable runtime foundation.
2. Orchestration control-plane kernel.
3. Portable planning, delivery, and routing modules.
4. Self-hosted release and promotion.
5. Project adapters and consumer migration.

## Chain DAG

```text
repository bootstrap ─> reference inventory ─> contracts ─> CLI
          └───────────────────────────────> trusted OS harness
contracts + OS harness ─> capability probe ─> state, process ─> primitive conformance
contracts + OS harness + capability probe ─> credential-backend probe ─> credential broker
repository bootstrap + adapter contracts ─> live GitHub/Actions + protection probe
OS harness + capability + credential backend ─> host-custody probe
host-custody probe + credential broker + GitHub protection receipt ─> host-custody package

state ─> sessions ───────────────────────────────┐
contracts + state + project adapter ─> circuit breaker ─┐
process + sessions + project adapter + credential broker ─> dispatch ─> review authority
state + sessions ─> event journal ──────────────┤
contracts + project adapter ─> modules ─> routing
trusted OS harness + CLI contract ─> Codex host probe
dispatch + modules + routing + project adapter + host probe + credential broker ─> Codex host adapter
state + review + journal ─> release promotion
sessions + dispatch + review + journal + modules + routing + release + credential broker ─> engine cycle
engine cycle + OS harness + credential broker ─> cross-platform supervisor ─> repeated/cold-host cycles
runtime + engine + Codex host + credential broker + GitHub probe ─> concrete self-host adapter
repository bootstrap + OS harness + host custody ─> authenticated bootstrap-authority probe
release promotion + passed authority probe ─> frozen bootstrap root
all shipped capabilities + engine + supervisor + self-host adapter + frozen bootstrap root ─> final N0 certification
final N0 certification ─> independent exact-candidate review ─> production credential binding ─> authorized installed N0
installed N0 ─> N0-to-N1 self-hosting

reference inventory ─> first-consumer fixture ─> state import ──────┐
project adapter + self-hosting + certified release ─> shadow mode ─> cutover
```

## Settled decisions

- Bootstrap with TypeScript, Node.js 24, and pnpm.
- Support macOS, Windows, and Linux as equal CI targets from the first outcome.
- Keep consumer policy in versioned project adapters.
- Keep runtime state outside source repositories.
- Promote N+1 only through stable N plus independent exact-candidate review.
- Adopt incrementally through characterization, shadow mode, and cutover; no
  big-bang rewrite.
- Bootstrap N0 through the independent root-of-trust protocol in
  `docs/architecture/contract-decisions.md`.
- Treat `docs/planning/work-model.md` as repository-local policy excluded from
  portable packages.

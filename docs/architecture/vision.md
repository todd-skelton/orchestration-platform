# Architecture vision

## Outcome

One released platform coordinates software delivery across macOS, Windows, and
Linux, orchestrates its own successor, and can be adopted by projects through a
versioned adapter instead of copied project-local scripts.

## Layers

### Platform engine

The engine owns sessions, leases, dispatch, worker ownership, review authority,
event journals, reducers, routing, release promotion, and compatibility
contracts. It contains no consumer-specific milestone names, labels, deploy
rules, or domain terminology.

### Project adapter

A project adapter supplies work discovery, readiness, priority, repository and
worktree topology, CI and deployment observations, project policy, and operator
actions. Adapter contracts are versioned and tested independently from the
engine.

### Runtime state

Each installation owns a state root outside the source checkout. State includes
the active lease, worker ownership, append-only events, artifacts, receipts,
breakers, and the installed release manifest. State migrations are explicit,
versioned, crash-recoverable, and never inferred from directory shape.

## Initial technology decision

The bootstrap implementation uses TypeScript on Node.js 24 with pnpm.

Reasons:

- Node.js supports all three target operating systems and the required process,
  filesystem, Git, and GitHub integration surfaces.
- The first consumer already operates a Node.js and pnpm toolchain.
- TypeScript makes contract shapes and adapter boundaries explicit while
  retaining fast iteration for a behavior-preserving extraction.
- A later standalone executable can be evaluated without coupling the public
  contracts to the packaging mechanism.

Non-goal: translate each existing PowerShell script line-for-line. The existing
controller is behavioral evidence, not the target module structure.

## Trust model

Stable release N may plan, dispatch, test, and assemble candidate N+1. Candidate
N+1 may run only in isolated test or shadow mode before promotion. It cannot
write the stable lease, authorize its own review receipt, mutate the installed
manifest, or replace stable runtime bytes.

Promotion requires:

1. An immutable candidate identity.
2. Cross-platform conformance evidence bound to that identity.
3. Independent review bound to the same identity.
4. A stable-version preflight immediately before mutation.
5. Transactional installation and installed-byte verification.
6. A durable promotion receipt and recovery path.

## Release consumption

Consumers pin exact platform and adapter contract versions in a lock file.
Updates arrive as reviewable changes containing compatibility results,
migration requirements, expected behavior changes, and rollback or
forward-repair instructions. Consumers never execute an unreviewed moving
branch.

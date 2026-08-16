# Extraction assessment and recommendation

## Decision

Create the orchestration platform as a separate repository and product. Run two
isolated installations of the same released engine—not two independently
evolving orchestrator implementations:

1. The self-host installation uses the platform-repository adapter to plan,
   dispatch, review, certify, and promote the platform's next release.
2. A consumer installation pins an accepted platform release and uses its own
   adapter for work discovery, policy, CI, deployment, and cutover.

The self-host installation may produce a candidate, but only stable release N
and an independent exact-candidate review may promote N+1. Consumer
installations receive improvements through explicit reviewed version changes;
they never execute the self-host installation's moving branch or mutable state.

## Current embedded process compared with the extracted platform

| Concern | Embedded controller today | Separate self-hosting platform |
| --- | --- | --- |
| Ownership | Controller scripts, skills, state, and project workflow evolve near one consumer | Engine, portable modules, and release protocol have one neutral repository; consumer policy lives in adapters |
| Portability | Behavior is implemented primarily through Windows-oriented PowerShell, native task wiring, and machine-local conventions | TypeScript on Node.js 24 with equal Windows, macOS, and Linux conformance; OS-specific lifecycle code sits behind tested ports |
| Improvement loop | Controller improvement and consumer delivery share source, vocabulary, and operational blast radius | A self-adapter treats platform improvement as an ordinary implementation/review/release workload in an isolated installation |
| Upgrade flow | Controller changes can be consumed from colocated scripts or skill copies | Immutable candidates, cross-platform certification, independent review, stable-predecessor promotion, and pinned consumer upgrades |
| State | Machine-local orchestration state and script layout can become implicit contracts | Versioned records live outside source checkouts; all mutation uses create-once/CAS transactions and explicit recovery |
| Routing and planning | Useful behavior exists, but some policy is coupled to one repository's issue model and terminology | Provider-neutral planning/routing modules consume versioned adapter facts and emit closed plans/receipts |
| Trust boundary | The code being improved can be close to the authority that installs or runs it | Candidate N+1 cannot write N's lease, issue its own accepted review, or activate itself |
| Adoption risk | Replacing the incumbent risks a broad, coupled rewrite | Characterization fixtures, read-only shadow comparison, state import, single-writer cutover, and post-cutover comparison bound the transition |

## Findings

1. Repository separation is necessary but insufficient. Copying the existing
   scripts into a new repository would preserve platform assumptions, implicit
   state, and project policy while adding synchronization cost.
2. A permanently separate “loop improver” implementation would create two
   control planes, duplicate fixes, and eventually make its own results
   incomparable with the delivery controller.
3. The useful separation is release and authority isolation. The self-host and
   consumer installations should share code but never leases, state roots,
   credentials, active-release records, or mutation authority.
4. Self-application is safe only with a stable predecessor. Candidate code may
   build and test in isolation, but it cannot certify, review, or install itself.
5. Cross-platform support must be an initial contract and evidence gate, not a
   later port. Otherwise Windows process/task semantics become the accidental
   public interface.
6. The incumbent remains valuable as behavioral evidence. Its decisions should
   be characterized and shadow-compared, not translated file-for-file.
7. Improvements should reach consumers through normal release promotion and a
   pinned adapter compatibility check. Live shared source or auto-following a
   branch would collapse the intended safety boundary.

## Recommendations

1. Proceed with the separate repository and the single-engine/two-installation
   model captured in this roadmap.
2. Build the portable runtime and evidence contracts before extracting planning,
   routing, and delivery behavior; modules must depend on contracts, not host
   scripts or consumer issue vocabulary.
3. Establish the self-host path before production consumer cutover. The first
   meaningful platform release should prove that stable N can deliver and safely
   promote N+1.
4. Treat every platform release as an immutable supply-chain subject with
   three-OS evidence and an independent review receipt.
5. Keep consumer adoption reversible until the first mutation. Use sanitized
   parity fixtures, sustained read-only shadowing, deterministic state import,
   and a single-writer cutover transaction.
6. Keep the initial scope local-host and repository orchestration. Defer remote
   fleets, plugin marketplaces, standalone native binaries, and generalized
   workflow languages until the self-host and first-consumer outcomes pass.

## Principal risks and controls

| Risk | Control in this roadmap |
| --- | --- |
| Recursive self-authorization | Stable-predecessor promotion, distinct review identity, immutable candidate digest |
| Two installations racing on one project | Installation-scoped state/credentials plus adapter-owned single-writer cutover |
| Platform policy absorbing consumer policy | Provider-neutral module ABI and versioned project adapter boundary |
| Cross-platform behavior drifting | Trusted three-OS harness, capability probes, normalized receipts, real reboot evidence |
| Bootstrap authority being weaker than steady state | Independently reviewed pre-N0 custody kit and frozen root-of-trust protocol |
| Improvements silently breaking consumers | Pinned releases, adapter compatibility, shadow comparison, explicit upgrade receipts |

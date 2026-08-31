# Partial walking-skeleton contract consumer

This is a disposable ISS-041 integration fixture, not a cycle implementation.
ISS-041 remains open. Nothing here certifies a worker, review, release, or
mutation. No production package may import it; it has no public exports and
never enters a release bundle.

Run `pnpm --filter @orchestration-platform/walking-skeleton test`, or ordinary
root `pnpm test`. The existing Vitest transformer handles source `.js` imports;
there is no resolver hook, new build target, or added production export.

The fixture imports `@orchestration-platform/contracts` by name through a real
`workspace:*` dependency. Its inline descriptor and async `plan` have the
`orchestration-module/v1` entrypoint shape but do not claim its unpublished
descriptor/input/result schemas or registry admission. The input is a real
`dispatch-action-core/v1`; output is a real `dispatch-brief/v1`, checked by
`validateDispatchBriefBinding` against a fixed fixture catalog. The role is
observer, with a declared read-only footprint; no worker is launched.

`consume` calls the existing pure `createConfigurationLoader(adapter)` entrypoint
from `packages/config/src/loader.ts` through a direct test source import. The
fixture boundary supplies the host adapter and closed invocation; the consumer
does not read process globals. The existing pure provenance projection in
`resolver.ts` keeps raw resolved paths out of persisted configuration evidence.
These internal source imports are not a claim of a published config package
export. Production exports remain unchanged, and no CLI fallback is used.

The test prepares canonical input in an external temporary project, then the
consumer admits a separate absent state root and writes exactly three canonical
files there: configuration provenance, action core, and dispatch brief. Every
output goes through public serialization and byte parsing. Before/after hashes
cover tracked checkout files and the external fixture sandbox outside state;
the state directory has an exact output census. Malformed config/action and a
changed descriptor refuse before state creation. Setup and cleanup are outside
that measured invocation. Cleanup removes the external sandbox. This is bounded
filesystem evidence, not OS-wide isolation or a claim about unrelated processes.

The existing root `skeleton:cycle` and `skeleton:negative-controls` remain
owner-bearing placeholders. Complete cycle transcripts, leases, echo workers,
review, journal replay, and crash/resume remain missing acceptance evidence.
See [the divergence ledger](divergence-ledger.md), advisory context for ISS-026.

## Proportionality

The current threat is an unusable contract/configuration boundary hidden until
engine integration. Removing the by-name dependency, loader call, binding check,
or output manifest loses that evidence. A full fixture engine would invent
unsupported records and is larger; this small consumer is the bounded alternative.

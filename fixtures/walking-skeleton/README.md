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

The consumer now joins actual loaded configuration provenance to an
`adapter-configuration/v1` using `validateAdapterConfigurationBinding`, calls
the landed SDK snapshot reader, and checks the resulting `project-facts/v1`
with `validateProjectFactsBinding`. After a bound `COMPLETE` snapshot, it invokes
the real SDK current-policy reader, whose fixed fixture composition selects
policy version `1.0.0`, and binds its `project-breaker-facts/v1` to that exact
configuration and full snapshot with `validateProjectBreakerFactsBinding` and
the same static expected version. Only `COMPLETE` policy facts reach fixture
selection: the first `READY` row in the sorted frontier that supports `work.read`.
The selected row's capability and `immutableSubjectDigest` become the action
core. Selection is fixture policy, not a new public binding or authority rule.
The frontier digest is never used as the action subject, and no snapshot digest
field or module-input schema is invented. One parsed frozen action is retained
for both planning and persistence across the asynchronous plan call. The bound
policy facts are also detached and retained before that await.

Both `TRIP` and `NO_TRIP` can be recorded under this unchanged observer contract.
`NO_TRIP` grants no permission, recovery, module admission, or capability use;
`TRIP` is not a durable open receipt. Requiring `COMPLETE` facts here admits only
observer artifact construction, never dispatch or execution. No generic breaker
state, history, hold transition, or recovery behavior is inferred.

`consume` calls the existing pure `createConfigurationLoader(adapter)` entrypoint
from `packages/config/src/loader.ts` through a direct test source import. The
fixture boundary supplies the host adapter and closed invocation; the consumer
does not read process globals. The existing pure provenance projection in
`resolver.ts` keeps raw resolved paths out of persisted configuration evidence.
These internal source imports are not a claim of a published config package
export. Production exports remain unchanged, and no CLI fallback is used.
The test imports both landed branch and document-queue SDK snapshot and policy
fixture adapters from their fixed source paths, using the same private
source-import pattern.
The package still depends only on contracts; no SDK export or dependency changes.

The test prepares canonical input in an external temporary project, then the
consumer admits a separate absent state root and writes exactly six canonical
files there: configuration provenance, adapter configuration, project facts,
project breaker facts, action core, and dispatch brief. Every
output goes through public serialization and byte parsing. Before/after hashes
cover tracked checkout files and the external fixture sandbox outside state;
the state directory has an exact output census. Config/snapshot/policy binding
failures, malformed configuration, snapshot or policy `UNKNOWN`/`UNAVAILABLE`,
changed policy source, and no eligible work return
without invoking plan or creating state. Equivalent opaque work from both real
SDK adapters produces identical briefs alongside contrasting policy facts. Tests
check a new policy source read after the snapshot, exact full-snapshot binding
(including metadata), and canonical identity with the actual SDK result. A changed
subject changes the core and brief. Source or returned-policy-object mutation
across the plan await does not change retained records. SDK policy thresholds,
hostile-input cases, and deadlines remain covered by the SDK's own tests.
Setup and cleanup are outside
that measured invocation. Cleanup removes the external sandbox. This is bounded
filesystem evidence, not OS-wide isolation or a claim about unrelated processes.

The existing root `skeleton:cycle` and `skeleton:negative-controls` remain
owner-bearing placeholders. Complete cycle transcripts, leases, echo workers,
review, journal replay, and crash/resume remain missing acceptance evidence.
Routine step 3 and ISS-013 AC7 remain incomplete; this fact consumer supplies
neither generic breaker history nor recovery contracts.
See [the divergence ledger](divergence-ledger.md), advisory context for ISS-026.

## Proportionality

The current threat is a broken snapshot/current-policy-to-plan handoff hidden
until engine integration. Removing the configuration/snapshot/policy joins, real
SDK calls, or output manifest loses evidence of fresh exact-source binding and
retention. Copying SDK threshold/deadline/hostile-input matrices or inventing a
generic breaker reducer is larger; this slice tests only the observer handoff.

## Separate session consumer

`src/session.ts` adds a bounded create-once fixture lease; it does not change or
compose the six-record observer above. It uses the real configuration loader,
brackets that read with identical source bytes, and retains canonical source,
provenance and paths alongside the public acquisition request, cycle request,
cycle plan and acquisition receipt. The fixed adapter is `fixture.branches`;
the plan's module census is empty because this consumer invokes no module.
All returned records round-trip through the public workspace contract package.

One `session-claim.json` under the admitted external state root is opened with
`wx+` and contains the canonical acquisition request bytes. Its retained handle,
physical root/leaf identity and exact bytes are checked before step-1 health;
the configuration is loaded again and all three request bindings must still
agree. The file is a private create-once claim, not a newly published durable
lease schema or an acquisition receipt masquerading as lease state. Existing
valid claims refuse a contender; malformed, missing, moved or changed evidence
is unknown and never authorizes takeover. Once unknown, this handle cannot
restore health or delete the claim. Cleanup closes the handle and retains
uncertain state; normal cleanup removes only the checked claim, leaving the
disposable directory to the external test harness.

This is an isolated, cooperative fixture. It does not prove atomic safety
against a hostile replacement between path checks and unlink, native exclusion,
production selected state, renewal, recovery or clock authority. Injected clock
observations bound the fixture's unrenewed lifetime and refuse rollback, skew or
unavailability. Neither canonical success spelling nor a prior receipt replaces
live observation. No public exports, production APIs, module admission, journal,
complete ordinal census or terminal cycle are added; both skeleton commands
remain placeholders and full ISS-041 remains open.

The focused session tests cover the real claim and second-holder refusal,
configuration/entry joins, moved/malformed/unavailable state, clock negatives,
retention and cleanup. Root replacement must execute on POSIX. If Windows
actually denies that rename with `EPERM` while the claim remains open, the test
instead proves unchanged physical identities and bytes, healthy ownership and
normal cleanup; that denial is not replacement/poisoning evidence. A successful
rename on any OS still requires unknown retention, and the other poison mutants
remain mandatory on Windows. The healthy invocation compares tracked-checkout and
external-sandbox manifests outside state, with exactly one state file. Interfering
test setup and final sandbox removal are outside that measured invocation.
Deleting the physical/byte checks or configuration reload permits stale evidence
to appear healthy; the smaller implementation is this private handle and file,
not a state service or native locking protocol. Tests are authored here; host
verification and independent review supply execution/acceptance evidence.

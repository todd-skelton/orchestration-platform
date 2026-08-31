# Partial walking-skeleton contract consumers

This disposable ISS-041 fixture produces integration evidence, never authority.
ISS-041 remains open. Production packages must not import it; it has no public
exports and is excluded from release bundles. Run the fixture workspace tests
or ordinary root `pnpm test`; both skeleton capability commands remain placeholders.

The observer imports `@orchestration-platform/contracts` by workspace name.
Its fixed descriptor is now a complete public `module-descriptor/v1`, with
literal branch/queue compatibility, observer action, read-only brief catalog,
and no disposition codes. Its inline async plan takes `module-plan-input/v1`
and returns the concrete action or no-action arm of `module-plan-result/v1`.
The union has no stored wrapper. No installed registry or module admission is
claimed, and the declared worker-required action never launches a process here.
The callable exports only `descriptor` and `plan`, whose native Promise resolves
to a concrete public result, not a parser-result wrapper. Thrown calls become a
named fixture failure before output; malformed or wrapped returns are rejected.

`consume` still invokes the actual configuration loader and SDK snapshot/current-
policy readers. It validates the exact configuration/provenance, full snapshot,
and freshly read policy facts before constructing a public module input. The
caller supplies a cycle request, detached before any asynchronous observation;
the input parser binds its adapter, allowed module intent and provenance digest.
The separate session owner remains responsible for its source/path preimages
and live lease. This observer does not claim session acquisition or step 1.
Internal loader/SDK imports retain the existing fixture source-import pattern;
no production export, dependency, or CLI fallback is added.

One detached public input is retained across the plan await. The fixed planner
checks its descriptor identity, selects the first READY work.read row in the
sorted frontier, and binds its exact work ID and immutable subject to the core
and brief. It never uses frontierDigest as the action subject. The caller then
revalidates the result against the retained input before any state output.
No eligible row produces the public NO_ACTION/NO_ELIGIBLE_ACTION result with
no invented core or brief; it is not a terminal cycle receipt. Malformed input,
unknown/unavailable observations or mismatched returned records refuse.

The healthy action writes ten canonical files under one absent external state
root: provenance, adapter configuration, snapshot, policy facts, cycle request,
module descriptor, module input, concrete module result, action core and brief.
A no-action writes the first eight. Each round-trips through public serialization
and canonical-byte parsing. Both SDK adapters retain contrasting TRIP/NO_TRIP
facts with identical observer briefs. Neither fact grants permission or clears
history; generic breaker reduction and ISS-013 recovery remain absent.

Tests retain the actual SDK source/metadata and policy-binding checks, compare
tracked checkout and external-sandbox manifests outside state, and verify the
exact output census. They also check no-action, cycle intent substitution,
caller mutation during observation, and malformed/wrong-input/wrong-work results
across the plan await. Setup and final cleanup are outside the measured call;
this is bounded filesystem evidence, not OS-wide isolation. Source execution,
independent review and three-OS CI are separate acceptance gates.

Routine step 3, actual worker/review execution, journal append/replay, complete
ordinal/terminal census and every-boundary restart evidence remain missing.
See [the divergence ledger](divergence-ledger.md). Replacing only the private
module seam preserves the existing running consumer; a registry, general
loader, breaker reducer or process service would exceed this increment.

## Separate session consumer

`src/session.ts` adds a bounded create-once fixture lease; it does not change or
compose the observer above. It uses the real configuration loader,
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

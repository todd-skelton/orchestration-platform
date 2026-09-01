# Walking-skeleton contract consumers

This disposable ISS-041 fixture produces integration evidence, never authority.
Production packages must not import it; it has no public exports and is excluded
from release bundles. Existing partial consumers remain available for focused
compatibility evidence. The final composition and its negative controls run
through `pnpm run skeleton:cycle` and `pnpm run skeleton:negative-controls`.
ISS-041 remains open until independent review and all three OS transcripts land.

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

For this observer entrypoint, routine step 3, actual worker/review execution,
journal append/replay and complete ordinal/terminal evidence remain absent.
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
complete ordinal census or terminal cycle are added by this separate entrypoint;
the final composition below owns the activated skeleton commands.

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

## Joined session and observer

`consumeUnderSession` now joins the existing claim and observer in one bounded
runtime call. Acquisition requests only the fixed observer module ID from the
source-owned fixture census; the separate acquisition API still defaults to an
empty intent. The exact acquired cycle request becomes the public module input.
The session is observed before snapshot/policy/plan and checked again afterward,
before any output write. A second live holder therefore prevents all observation
and planning. The standalone `consume` retains its absent-directory behavior;
its read/plan/encode phase is shared without adding a second implementation.

After a healthy post-call check, the output root must contain only the held
claim. The joined writer creates cycle-plan, acquisition and initial step-1
health records alongside the existing observer records: thirteen for an action,
eleven for no-action. All use public canonical contracts, and writes are
create-once. Known cleanup removes only the checked claim. Unknown claim or
configuration identity retains the claim; partial output remains diagnostic.
A reused/nonempty output root refuses instead of overwriting or claiming replay.

Tests execute claim presence during the real module call, matching cycle intent,
public output joins, containment manifests, contender refusal before callbacks,
malformed frontier cleanup, changed claim across the plan await, no-action and
repeat-output refusal. This is cooperative fixture behavior: no hostile-writer
atomicity, native lease, production freshness, breaker permission, journal,
resume guarantee, worker, review or terminal cycle is claimed. An observer call
still merely constructs artifacts even when current policy reports TRIP. The
final composition below owns the root skeleton commands.

## Initial breaker observation

`consumeInitialBreaker` is a separate partial consumer of the actual lease,
configuration loader and SDK snapshot/current-policy readers. It calls the
shared `prepareModuleInput` observation phase but never invokes the module.
The session owner admits its first reduction only when this acquisition
exclusively created a previously absent external root, retained an empty
initial file census and now observes a healthy claim-only root. Its private
`observeInitialRoot` operation consumes one attempt, including a refusal.
A pre-existing empty root, a nonempty root, a repeated attempt or output reuse
cannot establish genesis. No caller-supplied null, flag, hash or empty history
is used as absence proof.

From the actual complete policy decisions the fixture constructs the first
CLOSED or OPEN checkpoint for each configured capability, then validates the
complete public seven-input breaker relation with a null predecessor. TRIP
retains its opening identities; NO_TRIP is initial CLOSED evidence only.
This is a fresh disposable fixture observation, never a production reset or
permission derived from a structurally valid receipt. No recovery or probe
operation is attempted.

Success writes nine public canonical records: cycle plan, acquisition, initial
health, configuration provenance, adapter configuration, snapshot, policy
facts, cycle request and breaker receipt. The checked claim alone is removed;
outputs remain for inspection. Uncertain claims remain retained, partial
writes are diagnostic and a later call refuses genesis on that existing root.
The original observer and joined module consumer retain their behavior.
No module dispatch, route, worker, review, public journal, terminal cycle or
resume implementation is added by this separate entrypoint.

# Echo execution increment (partial)

`src/echo-consumer.ts` composes actual lease/fresh-root admission, SDK facts,
initial breaker reduction, the inline public module, fixed host routing, a
second source observation for preflight and a fresh live session inspection.
The fixed Node child echoes stdin without a shell, imports, filesystem access,
credentials or descendants. Its owner retains the exact ChildProcess handle;
launch/terminal records bind the public plan and separately captured raw bytes.
No PID adoption or repeated launch is allowed on retained/reused roots.

The host allocates one input file and publishes the canonical dispatch plan
once as its ownership claim before spawn. These are cooperative disposable
fixture operations, not hostile-writer atomic primitives. Known exit permits
claim cleanup; unknown process/lease observations retain the claim. The input,
ownership and other evidence files remain diagnostic output for later reclaim
composition. Existing standalone entrypoints retain their behavior.

This increment stops at worker exit. It does not provide review reduction,
disposition, public event journaling/replay, reclaim receipts, final-cycle
authority or all-boundary crash/resume. The final composition below supplies
the command-owned continuation. Evidence
requires independent review and host/three-OS verification; source never
certifies itself.

## Seeded review continuation (partial)

The separate consumeReview path selects a second statically composed pure module
and reads explicit fixture-review-subject.json plus fixture-review-artifact.bin
from the admitted absolute project root. These files seed an earlier immutable
worker result; they do not claim an earlier cycle actually ran. The admitted
fixture materialization is one ARTIFACT with exact retained bytes and a fixed
fixture.seed.v1 source revision. Files are bounded, ordinary, single-link and
physically bracketed under the cooperative fixture assumptions.

The review target is reread for real REVIEW preflight and after actual echo
exit. A moved/unreadable target never gets a decided review. The exact public
review request is joined to preparation and the retained child records. A
separate fixed stub reduction compares the retained artifact with fixed expected
bytes, creating public attempt/claimed-authority records. Rejection returns
REVIEW_REJECTED; accepted is fixture evidence only, never effective production
review or permission. Both outcomes retain their raw finding/procedure evidence.

Existing consumeEcho remains the ordinary observer path. The optional pure
review-module disposition export is present but is not invoked by this partial
consumer: the actual step11 journal-prefix admission is still absent. This
increment itself does not complete disposition/follow-up, reclaim, public
journal append/replay, final cycle or all-boundary acceptance. The separate
final composition owns those commands, and production imports no fixture.

## Complete fixture-only review cycle

`consumeFinalReviewCycle` is the bounded final composition. It acquires the
existing cooperative create-once claim, uses actual SDK snapshot and policy
observations, reduces the fresh-root initial breaker, invokes the fixed review
module, routes and launches the fixed echo child, materializes a review attempt,
reduces the separate fixed review decision, invokes the reviewed disposition,
reclaims the one echo-input allocation, and terminalizes the cycle.

The target is a seeded immutable worker result whose author cycle and attempt
are distinct from the current review cycle and newly generated dispatch attempt;
that equality is checked again after ID generation. The target subject and
artifact are reread after child exit before an attempt is materialized. A change
emits UNKNOWN/TARGET_CHANGED and stops before decided authority. The accepted
path therefore does not let a worker certify its own result. Accepted authority
allows only the module's explicit nonmutating COMPLETE disposition. Steps 12
and 13 are real `no-mutation` skips. Rejected authority produces an actual
FOLLOW_UP/REPLAN request, skips mutation, reclaims the same resource and ends
FAILED_KNOWN.

The fixture owns `cycle.opj` with an exclusive retained file handle. It writes
the public OPJ1 header and each length-framed event with short-write handling,
syncs, rereads exact bytes, strictly parses the physical journal and reduces the
complete retained-evidence tuple before the next owner runs. A partial suffix
blocks append and is never truncated. The rendered dispatch input is retained
separately because the managed echo input is deleted during reclaim. Final
receipt construction follows the acyclic pre-15 reduced state, STARTED15,
terminalizing state, receipt and TERMINAL15 order.

The boundary seam covers the header, all 30 event boundaries, allocation,
ownership publication, spawn, terminal observation, resource deletion and
session cleanup. This fixture deliberately has no stale-claim adoption: at every
pre-cleanup killed-owner row, read-only replay remains possible but a restarted
contender gets the named `SESSION_HELD` refusal before repeating an effect. The
sole post-cleanup state has a complete terminal OPJ1 and no claim; restart
returns `CYCLE_ALREADY_TERMINAL` from replay without attempting acquisition or
an effect. These are bounded fail-closed/idempotent results, not production
resume.

Malformed frontier and concurrent lease controls stop before journal or worker
creation. The rejected-review control completes a known-failure journal without
mutation. All writes remain below a caller-provided disposable state root;
before/after manifests require the surrounding project inputs to remain byte
identical. See [the exact step and boundary table](step-table.md) and
[the divergence ledger](divergence-ledger.md).

This composition still supplies no production state service, lease recovery,
generic process-tree authority, hostile-filesystem atomicity, credential
service, module registry, mutation, release, promotion, scheduler, broker or
ISS-026 engine. Source records and parser success remain claims until their
actual owners and independent review admit them.

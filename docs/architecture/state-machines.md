# Authoritative bootstrap state machines

Every unlisted transition is refused. `UNKNOWN` is a terminal authority result
for the current observation, not an automatically recoverable state.

## State mutation

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `ABSENT` | create only | create-once identity | remain absent or read prepared record | create or inspect |
| `PREPARED` | exact transaction | intent plus predecessor/candidate hashes | resume compare-and-swap or abort before commit | verify predecessor |
| `COMMITTED` | readers | successor bytes and verified receipt | verify/read; never reapply | ordinary read |
| `ABORTED` | readers | pre-commit abort receipt | no resume | start new transaction |
| `UNKNOWN` | none | malformed, third-state, or moved evidence | external diagnosis | refuse mutation |

## Worker process and ownership

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `PLANNED` | dispatching session | validated plan, no ownership yet | discard without vacancy claim | publish ownership |
| `STARTING` | exact launch | create-once ownership before/with native launch | inspect exact child identity | confirm liveness |
| `START_FAILED` | reducer | launch failure before live identity plus terminal receipt | no live owner; ownership is terminal | workspace eligibility may be re-evaluated |
| `LIVE` | exact launch | liveness binds process tree and workspace subject | terminate exact tree or observe exit | monitor progress |
| `TERMINATING` | exact launch | bounded termination request | continue bounded observation | confirm exit |
| `TERMINATION_FAILED_LIVE` | exact launch | bounded termination expired while exact owner or descendant remains live | retain ownership and capacity claim; retry or diagnose exact tree | retry bounded termination or monitor |
| `EXITED` | reducer | exact owner terminal observation | idempotent read | workspace may become eligible |
| `UNKNOWN` | none | conflicting, partial, or aliased identity | external diagnosis | capacity refuses |

## Session lease

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `AVAILABLE` | one acquirer | absent/released predecessor | acquisition CAS | begin cycle |
| `HELD_FRESH` | exact session | acquisition or same-session renewal | renew within bounds | run one cycle |
| `HELD_STALE` | none for mutation | freshness or duration exceeded | eligible for one bound handoff | inspect/handoff |
| `HANDOFF_PREPARED` | exact successor transaction | stale predecessor plus CAS intent | resume same handoff only | install successor lease |
| `RELEASED` | readers/new acquirer | exact-session release receipt | none | acquire |
| `UNKNOWN` | none | skew, malformed, conflicting state | external diagnosis | refuse controller start |

## Owned resource reclamation

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `UNALLOCATED` | exact dispatch transaction | no resource identity or predecessor claim | remain absent | allocate |
| `ALLOCATED` | exact dispatch transaction | adapter/host allocation receipt with opaque resource identity | discard only through same transaction | bind launch or reclaim |
| `LAUNCH_BOUND` | exact worker owner | resource receipt bound to launch/process-tree identity | retain while any exact process may live | observe terminal process state |
| `RECLAIM_PENDING` | exact reclaim transaction | all bound process identities exactly dead | resume same idempotent owner-specific reclaim | verify absence |
| `RECLAIM_REFUSED_LIVE` | none for reclaim | exact owner or descendant remains live | retain resource and capacity claim | terminate/observe exact process tree |
| `RECLAIMED` | readers | adapter and host absence receipts bind reclaim transaction | idempotent read | workspace/capacity may become eligible |
| `UNKNOWN` | none | malformed, aliased, concurrent, or incomplete ownership evidence | external diagnosis | retain resource and capacity claim |

## Circuit breaker

The adapter supplies policy facts; the engine owns these transitions and never
interprets the project reason or threshold.

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `CLOSED` | exact session | current adapter policy permits affected capability | ordinary replay | evaluate next policy fact before use |
| `OPEN` | reducer | adapter trip fact plus affected opaque capability set | persist across restart | refuse affected capability; evaluate recovery policy |
| `RECOVERY_PENDING` | exact recovery transaction | current adapter recovery fact binds open receipt and policy version | resume same transaction only | run bounded recovery probe |
| `PROBE_IN_FLIGHT` | exact recovery transaction | one recovery probe identity | retain hold on interruption | classify probe |
| `CLOSED_RECOVERED` | readers/exact session | successful probe and recovery receipt | reduce to ordinary `CLOSED` on next cycle | next routine cycle reevaluates policy |
| `UNKNOWN` | none | malformed history, stale policy, moved open receipt, or contradictory probe | external diagnosis | affected capability remains blocked |

## Review authority

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `REQUESTED` | distinct reviewer | exact closed-union review subject (worker result or certified landed release candidate) and author attempt; optional revision materialization proves identical digest | re-observe unchanged subject/materialization | dispatch distinct review cycle |
| `IN_REVIEW` | same reviewer attempt | reviewer launch identity | resume same attempt or terminate incomplete | complete sweep |
| `ACCEPTED` | stable reducer | complete receipt binding the identical review-subject kind/digest | immutable history | target mutation/promotion may evaluate |
| `REJECTED` | planner/repair policy | complete findings receipt | immutable history | module chooses repair/replan |
| `SUPERSEDED` | none | subject moved after terminal receipt | no reuse | request new review |
| `UNKNOWN` | none | truncated, contradictory, or malformed history | external diagnosis | refuse promotion |

## Routine engine cycle

The adapter supplies frontier/policy facts and modules supply typed decisions;
the engine owns composition and never interprets consumer vocabulary.

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `PLANNED` | exact session | authority-free protocol/configuration skeleton only; no live facts, route, dispatch, review, or mutation authority | discard before execution or run exact skeleton | observe fresh facts in step 2 |
| `RUNNING` | exact session/cycle | cycle start binds plan and journal prefix | replay journal and resume exact cycle | invoke next typed step |
| `WAITING_WORKER` | exact worker owner | dispatch/launch receipt | observe or resume without redispatch | reduce terminal worker receipt |
| `WAITING_REVIEW` | distinct reviewer | exact-subject review request | observe/resume same attempt | reduce review authority |
| `WAITING_ACTION` | exact session | typed module action plan, including optional release promotion | re-observe external authority and same plan | apply/refuse through owning package |
| `COMPLETED` | readers | terminal receipt binds every step and resulting journal prefix | idempotent read | begin next cycle |
| `COMPLETED_NO_WORK` | readers | complete frontier plus policy facts prove no eligible action | idempotent read | begin next cycle after configured cadence |
| `FAILED_KNOWN` | exact session/readers | named terminal refusal with retained authorities/resources | execute named repair/retry policy in a new cycle | begin bounded follow-up cycle |
| `UNKNOWN` | none | missing/contradictory step, false prefix, moved plan, or unowned side effect | external diagnosis | refuse new mutation cycle |

## Cycle supervisor

The supervisor is invoked by an installed Windows Task Scheduler definition,
macOS LaunchAgent, or Linux systemd user timer/service. Exactly one tick owns
re-entry; the scheduler itself has no project mutation credential.

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `UNINSTALLED` | installation transaction | no scheduler definition or installation receipt | remain absent | plan/install |
| `INSTALLED_IDLE` | exact scheduler installation | verified OS definition plus no live tick | host restart preserves OS definition | wait for cadence/start event |
| `TICK_STARTING` | exact scheduler invocation | create-once tick identity before session acquisition | inspect exact process/tick | acquire/resume session |
| `TICK_ACTIVE` | exact tick/session | one cycle run/resume identity | journal replay after process interruption | reach cycle terminal |
| `TICK_TERMINAL` | readers/supervisor | terminal cycle + tick receipt, resources accounted | idempotent read | return to `INSTALLED_IDLE` |
| `STOPPING` | exact uninstall transaction | scheduler disabled before active tick termination | resume same transaction | verify no future invocation/live tick |
| `UNINSTALLED_VERIFIED` | readers | scheduler absence, terminal tick, and credential census | idempotent read | remain stopped or new install |
| `UNKNOWN` | none | duplicate tick, moved definition, missing terminal, or contradictory host state | external diagnosis | disable new mutation tick and refuse install overwrite |

## Journal and snapshot

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `JOURNAL_ONLY` | exact session append | valid prefix | ignore partial suffix with explicit health failure | append/reduce |
| `SNAPSHOT_CURRENT` | exact prefix readers | snapshot binds prefix digest | replay suffix | append/reduce |
| `SNAPSHOT_STALE` | readers | valid snapshot on older prefix | replay and replace atomically | ordinary reduce |
| `CORRUPT` | none | false prefix, invalid event, or third state | external diagnosis | refuse authority reduction |

## Release promotion

For bootstrap N0, `PINNED_BOOTSTRAP` means the exact default-branch workflow and
test-bundle bytes, distinct reviewer, operator grant, and reviewed bootstrap
installer. There is no stable predecessor. For N1 and later, the authority actor
is the installed stable predecessor. Candidate bytes are never the actor in
either path.

| State | N0 actor | N1+ actor | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|---|
| `ASSEMBLED` | pinned bootstrap build workflow | installed stable predecessor build path | immutable candidate manifest | rebuild new identity if changed | certify |
| `CONFORMED` | pinned bootstrap aggregator workflow | installed stable predecessor aggregator | all OS receipts bind candidate/test bundle | rerun failed environment | independent review |
| `REVIEWED` | distinct independent reviewer | distinct independent reviewer | exact-candidate acceptance | re-observe unchanged evidence | authorize |
| `AUTHORIZED` | human operator grant over exact digest, validated by reviewed bootstrap installer | installed stable predecessor preflight | fresh authority plus one-use recovery digest | abort only before first mutation | apply |
| `BOOTSTRAP_APPLYING` | reviewed bootstrap installer, same transaction | n/a | first N0 destination mutation | forward recovery only | install/verify N0 |
| `BOOTSTRAP_ACTIVE` | installed N0 | n/a | generation-zero `active-release/v1` + broker client + shim read-back + bootstrap receipt + recovery authorization revoked + cleanup gate absent/archive verified | ordinary recovery rules | first N0 no-work tick |
| `SUCCESSOR_STAGED_PRE_ACTIVATION` | n/a | installed stable predecessor | verified N+1 bytes + pending broker admission + `CONSUMED_BOUND` authorization + published recovery fence; gate `PENDING`, active pointer N | activation CASes gate `ACTIVATING`; abort CASes gate `ABORTING`; exactly one wins | `SUCCESSOR_ACTIVATING_PRE_POINTER` or abort |
| `SUCCESSOR_ACTIVATING_PRE_POINTER` | n/a | exact predecessor/fence-backed recovery transaction | gate `ACTIVATING`; active pointer still N; exact expected N+1 record | forward-only active-release CAS; abort refuses; mismatch becomes unknown | `SUCCESSOR_ACTIVE_HANDOFF` |
| `SUCCESSOR_ACTIVE_HANDOFF` | n/a | same live or shim-relaunched predecessor recovery transaction | atomic active pointer names N+1 while broker still names N | forward recovery only; ordinary ticks fenced | activate broker N+1, record follow-up, terminalize N cycle |
| `SUCCESSOR_ACTIVE` | n/a | installed N+1 successor | atomic `active-release/v1`, activated broker-client generation, shim read-back, cleared fence, terminal predecessor cycle receipt, recovery authorization revoked, and cleanup gate absent/archive verified | ordinary recovery rules | next scheduler tick runs successor verification follow-up |
| `BOOTSTRAP_ABORTING_PRE_MUTATION` | exact reviewed bootstrap abort command + broker internal reconciler | n/a | cleanup gate `ABORTING` and authoritative destination-absence plan | broker revokes; resumed command completes gate archive/head/removal | `ABORTED_PRE_MUTATION` |
| `SUCCESSOR_ABORTING_PRE_ACTIVATION` | n/a | exact predecessor transaction/shim + broker internal reconciler | gate `ABORTING`; active pointer N; shim-proven staging absence; publication discriminator frozen; any exact fence retained | no authorization attachment or broker client; terminalize/archive any pre-fence child, broker compare-removes bound pending admission and revokes, then shim clears an exact fence and completes gate | `ABORTED_PRE_ACTIVATION` |
| `ABORTED_PRE_MUTATION` | bootstrap installer or granting operator for exact transaction | installed stable predecessor for exact transaction | authoritative destination-absence + recovery authorization revocation + cleanup-gate archive/head/removal before first mutation | no resume | start new candidate transaction |
| `ABORTED_PRE_ACTIVATION` | n/a | installed stable predecessor for exact transaction | staged bytes/pending admission/fence removed, authorization `REVOKED`, cleanup-gate archive/head committed and canonical gate absent while active pointer remains N | no resume | start new candidate transaction |
| `BOOTSTRAP_RECOVERY_REQUIRED` | reviewed bootstrap installer, same transaction and existing `CONSUMED_BOUND` authorization | n/a | interrupted N0 post-mutation state | prove/reuse exact pre-bound authorization; never consume again; resume forward | reach `BOOTSTRAP_ACTIVE` |
| `SUCCESSOR_RECOVERY_PRE_ACTIVATION` | n/a | exact predecessor/shim transaction; narrowed consume only while gate `PENDING` | interrupted pre-fence work while active pointer remains N | `PENDING` uses closed pre-fence handoff; `ABORTING` uses clientless shim staging cleanup plus broker-internal admission removal/revoke | staged or `ABORTED_PRE_ACTIVATION` |
| `SUCCESSOR_RECOVERY_POST_ACTIVATION` | n/a | shim-launched exact predecessor recovery transaction/capability | pointer names N+1 and fence remains | forward recovery only | reach `SUCCESSOR_ACTIVE` |
| `UNKNOWN` | none | none | candidate/evidence movement or third state | external diagnosis | refuse install/start |

## Activation recovery launch

This table governs one canonical current pointer plus immutable transition
records per active promotion; the terminal archive permits the pointer path to
be reused by a later transaction.

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next operation |
| --- | --- | --- | --- | --- |
| `ABSENT` | scheduler-authenticated shim | no current pointer; either matching `NOT_PUBLISHED`/`PUBLISHING` pending gate plus proven original-owner absence, or matching published recovery fence | create source-specific generation-zero immutable record then pointer; live original owner waits and ambiguity refuses | generation-zero `READY` |
| `READY` | same shim/next scheduler shim | pointer names create-once source/attempt/argv/bindings before native child creation | write successor record then CAS pointer: adopt one exact matching child; prove owner+child absence; ambiguity → `UNKNOWN` | `LIVE` or `TERMINAL_RETRYABLE` |
| `LIVE` | owning/adopting shim monitor | pointer names exact immutable source, OS start token, and process tree | pre-fence: consume if required, CAS `PUBLISHING`, create/read back fence, CAS `PUBLISHED`, then handoff; abort → client denial/exit; fence-backed: observe until terminal cycle/broker/resource proof; known premature exit before source terminal proof → retryable; ambiguity → unknown | wait, `TERMINAL_HANDOFF`, `TERMINAL_ABORTED`, `TERMINAL_COMPLETE`, or `TERMINAL_RETRYABLE` |
| `HEAD_REBIND_REQUIRED` | owning/adopting shim monitor; child paused | gate or fence current head is exactly one immutable-history ordinal ahead of the launch's observed head under unchanged roots | write same-source `AUTHORITY_REBIND` record retaining lifecycle/attempt/process, CAS launch pointer, acknowledge child; no launch, attach, or broker/project call | prior `READY`/`LIVE`/terminal lifecycle with adjacent heads |
| `TERMINAL_RETRYABLE` | next scheduler-authenticated shim | exact exit/absence proof and terminal attempt-channel denial | create adjacent generation record then CAS pointer retaining all transaction bindings | generation N+1 `READY` |
| `TERMINAL_HANDOFF` | exact pre-fence transaction/shim cleanup | `cleanup-gate-pre-fence/v1`; exact gate/fence publication proof or unambiguous post-publication child absence | prove child exit; archive/verify only the pre-fence source chain; CAS-remove pointer | fresh fence-backed generation-zero `READY` |
| `TERMINAL_ABORTED` | exact pre-activation transaction/shim cleanup | either source; gate `ABORTING`; active record N; broker channel denied; exact exit/absence proof | archive/verify the source-specific chain; CAS-remove pointer before final gate cleanup | continue broker-internal abort reconciliation |
| `TERMINAL_COMPLETE` | exact transaction/shim cleanup | terminal cycle/broker/resource proof was recorded before fence clear; child may still be waiting | clear fence; observe child exit; wait for broker-internal recovery-authorization revocation; archive/verify complete immutable chain; CAS-remove current pointer | `ABSENT` for a later transaction |
| `UNKNOWN` | none | multiple/ambiguous process, moved binding, malformed record, or fence mismatch | external diagnosis only | refuse launch/start |

## Authority root/head initialization

This reducer applies independently to cleanup-gate and recovery-fence roots.

| Prefix | Required evidence | Permitted recovery | Next prefix |
| --- | --- | --- | --- |
| `ABSENT` | root, ordinal-zero history head, and canonical current pointer all authoritatively absent for the exact transaction | same authorized transaction creates/read-backs deterministic root | `ROOT_ONLY` |
| `ROOT_ONLY` | exact immutable root; head/current absent | create/read back ordinal-zero head with canonical-null predecessor | `ROOT_AND_HEAD` |
| `ROOT_AND_HEAD` | exact root and unique ordinal-zero head; current absent | CAS current pointer from absence and read back | `CURRENT` |
| `CURRENT` | exact root/head/current chain | enter the authority-specific state machine | gate `PENDING` or fence `PREPARED` |
| `UNKNOWN` | head without root, current without both, malformed/moved/multiple/extra/mixed bytes, or non-null ordinal-zero predecessor | external diagnosis only | refuse mutation/start |

## Activation cleanup gate

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next operation |
| --- | --- | --- | --- | --- |
| `ABSENT` | exact installer/stable predecessor | no canonical gate and no active activation transaction | create-once before irreversible boundary | `PENDING` |
| `PENDING` | exact installer/predecessor transaction | mode/transaction/authorization/expected active identity; fence publication `NOT_PUBLISHED`, `PUBLISHING`, or `PUBLISHED` | ordinary ticks refuse; consumed successor CASes `PUBLISHING` before fence create/read-back then `PUBLISHED`; successor activation and abort race one CAS | `ACTIVATING`, `ABORTING`, or observe terminal `REVOKED` |
| `ACTIVATING` | exact successor fence-backed transaction | gate binds exact N active record, expected N+1 record, published fence, pending admission, and recovery launch binding | forward-only active-release CAS and post-pointer recovery; abort refuses even before pointer CAS | `COMPLETE` after terminal activation cleanup |
| `ABORTING` | broker internal reconciler plus exact installer/shim cleanup | durable absence plan and observed publication state | no broker client/attachment; `PUBLISHING` deterministically completes exact fence then `PUBLISHED`; terminalize pre-fence child, prove staged-byte absence, broker compare-removes exact pending admission and revokes, then shim clears any published fence/marks `CLEARED` | `COMPLETE` |
| `COMPLETE` | exact installer/shim cleanup | authorization `REVOKED` plus matching abort/terminal proofs | archive/read-back then CAS-remove | `ABSENT` |
| `UNKNOWN` | none | mismatched/malformed/moved gate or contradictory authorization | external diagnosis | refuse ordinary start and new activation |

## Shadow discrepancy

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `OBSERVED` | comparator | correlated incumbent/shadow inputs and outputs | retain pending row | classify |
| `EXPLAINED_EXPECTED` | readers | approved policy difference | none | include in baseline |
| `FIXTURE_GAP` | fixture owner | missing representative input proven | add fixture and rerun | resolve |
| `ADAPTER_DEFECT` | adapter owner | reproduced translation error | fix and rerun | resolve |
| `PLATFORM_DEFECT` | platform owner | reproduced engine/module error | fix and rerun | resolve |
| `UNEXPLAINED` | none for cutover | insufficient or contradictory evidence | gather timed evidence | cutover refuses |
| `RESOLVED` | readers | regression fixture plus matching rerun | none | continue observation |

## Consumer cutover

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `PREPARED` | incumbent | current shadow pass and cutover plan | discard plan | refresh observations |
| `QUIESCED` | incumbent only | incumbent drained and mutation fence proven | restore incumbent before import mutation | capture/export and commit import |
| `AUTHORIZED` | exact cutover transaction | `IMPORT_COMMITTED`, one prospective writer, and fresh authorities | pre-consumer-mutation abort allowed | first successor consumer mutation |
| `ABORTED_PRE_MUTATION` | incumbent | abort receipt before successor's first consumer mutation | incumbent authority restored; transaction cannot resume; any committed import remains non-authoritative historical evidence | incumbent runs next routine cycle; a future cutover requires a new export/import transaction |
| `SUCCESSOR_MUTATING` | successor transaction | first mutation receipt | forward recovery only | complete first cycle |
| `SUCCESSOR_ACTIVE` | successor | terminal first-cycle and authority-transfer receipt | ordinary recovery rules | next routine cycle |
| `RECOVERY_REQUIRED` | same successor transaction | post-mutation interruption | resume successor | reach active |
| `UNKNOWN` | none | dual-writer, missing fence, or moved authority | external diagnosis | all mutations refuse |

## Consumer state import

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `NOT_STARTED` | incumbent readers | no export/import transaction exists | remain absent | capture quiescent export |
| `EXPORT_CAPTURED` | incumbent while authoritative | quiescent source census, schema, provenance, cursor/breaker/terminal-event inventory, and digest | recapture if source moves before preparation | validate mapping |
| `IMPORT_PREPARED` | exact cutover transaction | deterministic target plan binds export and absent/expected predecessors | pre-mutation abort allowed | apply target records |
| `IMPORT_APPLYING` | same transaction | first create-once/CAS target mutation | forward recovery only | finish same plan |
| `IMPORT_APPLIED` | same transaction | every target record written once | verify replay and record census | verify |
| `IMPORT_VERIFIED` | same transaction | replay, cursor, breaker, and terminal-event equivalence receipt | resume commit only | commit import identity |
| `IMPORT_COMMITTED` | successor | durable import receipt bound to cutover authority transfer | ordinary replay | successor runs first routine cycle |
| `ABORTED_PRE_MUTATION` | incumbent/exact transaction | abort before first target mutation | no resume | incumbent continues routine operation |
| `RECOVERY_REQUIRED` | same transaction | interruption after first target mutation | resume idempotently; no second export | reach `IMPORT_COMMITTED` |
| `UNKNOWN` | none | partial/moved/malformed export or target record not bound to transaction | external diagnosis | both import and authority transfer refuse |

## Incumbent comparator retirement

| State | Permitted authority | Trigger and durable evidence | Interruption/recovery | Next routine operation |
|---|---|---|---|---|
| `SHADOW_ACTIVE` | read-only comparator | correlated pre-cutover observation | retain credentials and process | continue shadow comparison |
| `POST_CUTOVER_READONLY` | credential-fenced comparator | successor authority transfer receipt | no mutation or controller-lease renewal | continue bounded comparison window |
| `TERMINAL_REPORT_WRITTEN` | retirement transaction | seven-day/100-decision report durably bound to both controllers | resume same retirement transaction | revoke comparator credentials |
| `CREDENTIALS_REVOKED` | retirement transaction | credential census proves no external or local mutation authority | retain process only for bounded exit | terminate comparator process |
| `STOPPED` | readers | exact process-tree terminal receipt and final credential census | idempotent read | successor runs next routine cycle alone |
| `UNKNOWN` | none | live process, credential, report, or identity cannot be reconciled | external diagnosis | successor mutation policy refuses where comparator authority cannot be excluded |

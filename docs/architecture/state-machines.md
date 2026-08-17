# Authoritative bootstrap state machines

Every unlisted transition is refused. `UNKNOWN` is a terminal authority result
for the current observation, not an automatically recoverable state.

## State mutation

Every authority pointer mutation holds the fixed kernel-exclusive installation
lock and uses the selected state-mutation epoch. Values, proposals, conflicts,
and tips form the acyclic `Dv/Dr/Dt` graph in `supervisor-contract.md`.

| Proposal classification | Required evidence                                            | Recovery/next operation                                  |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `PENDING`               | create-once value and proposal, no selected winner yet       | under the same epoch lock perform the real CAS/read-back |
| `SELECTED`              | canonical tip equals the proposed `Dv/Dr`                    | idempotent read; never reapply                           |
| `LOST_CONFLICT`         | a different selected winner and exact conflict receipt       | retain for census/audit                                  |
| `COMPACTED`             | selected retention plan and completion receipt               | retain the compacted classification proof                |
| `UNKNOWN`               | malformed, contradictory, missing, fake-lost, or mixed epoch | external diagnosis; refuse mutation/start                |

The `ORDINARY` durable commit resolution states are exactly:

| Resolution         | Required evidence                                                         | Authority                              |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------- |
| `SELECTED`         | complete nine-stage run, target tip equals expected `Dt/Dv/Dr`, one epoch | selected target result                 |
| `LOST_CONFLICT`    | complete run, real different winner, exact conflict receipt               | retain loser; winner remains authority |
| `UNKNOWN_TERMINAL` | fresh locked reconciliation, exact closed failure reason/evidence         | refuse mutation/start                  |

`PROPOSED` is only a live branded ISS-004 view before stage five. Persisted
stages zero through four after handle loss are `CRASH_PREFIX`; selected stage
five `CAS_ARMED` and stage six without classification are `CAS_AMBIGUOUS`.
Neither is a resolution. The nine
stages are current-authority read, target reconciliation, value readback,
proposal readback, pre-CAS authority read, CAS armed, post-CAS target readback,
proposal classification, and post-CAS authority read.

Every progress update selects `POINTER_MUTATION_RUN_CURRENT` through the generic
pointer graph. Immutable checkpoint cores exclude their selecting
value/proposal/tip; a downstream post-selection observation feeds only the next
core. Crash recovery always acquires a fresh lock/context and reads the selected
run-current tip. Expected target is selected, a real different winner is lost,
unchanged prior may retry under the same epoch, and malformed/impossible state
is terminal unknown. The meta pointer follows all generic rules except that it
does not recursively journal itself.

An ordinary commit rereads the same selected authority before and after target
selection. Rotation runs under the old private capability, resolves every
pending proposal among the other eleven kinds of the twelve-kind registry,
requires a complete zero-unrelated-PENDING/zero-UNKNOWN census, appends the
exact `authority-history-record/v1` record (with `Dh` under
`authority-history/v1`), and performs the authority CAS as its final action;
its run-current journal legitimately rests at the selected
`CAS_ARMED` checkpoint across the selection. Authority CAS revokes the old
context; selected authority, exact chain head, and the old CAS-armed checkpoint
derive terminal truth without a post-CAS write. Kernel owner death is
the only lock-loss recovery; PID, age, lease, and timeout are never authority.

### External destination owner and anchor

| Owner state | Required selected evidence                                                                                                        | Allowed transition                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ACTIVE`    | one destination winner, admitted current physical observation, anchor digest, owner post-selection review receipt for a successor | `CONSUME` or `RETIRE_UNUSED`                                                  |
| `CONSUMED`  | selected anchor CONSUMED, E0 graph/readbacks, exact transaction                                                                   | `RETIRE_CONSUMED` or exact reinstall/no transition                            |
| `RETIRED`   | selected anchor RETIRED and teardown archive                                                                                      | `ACTIVATE_SUCCESSOR` for a different installation and reviewed successor only |

Genesis is `ACTIVATE_GENESIS` from exact destination-owner absence. The owner
key is `Ddest(Dphys)` and remains the same across project, installation,
custody-instance, helper, and profile changes. A successor review core excludes
the new anchor; the anchor binds the core; owner ACTIVE binds both; its
post-selection receipt is required before anchor work. Competing installation
IDs serialize on one destination lock and only an observed winner makes the
loser `LOST_CONFLICT`.

| Anchor state | Required evidence                                                            | Allowed transition                                             |
| ------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ACTIVE`     | selected owner ACTIVE and downstream successor receipt where applicable      | pre-expiry use intent, `CONSUMED`, or absence-proven `RETIRED` |
| `CONSUMED`   | selected E0 and runtime/external post-selection receipts plus owner CONSUMED | exact reinstall/no transition or teardown to `RETIRED`         |
| `RETIRED`    | exact teardown archive and selected owner RETIRED                            | no reuse                                                       |

An ACTIVE use intent created before expiry may complete only its exact
transaction after expiry. Partial E0 cannot retire or start another install.
Exact reinstall reuses CONSUMED; RETIRED requires a new installation ID.

### State-authority history

The closed `authority-history-record/v1` union and every digest use the exact
field census and formulas in `supervisor-contract.md`. Both arms bind the same
closed successor-authority core `Dsc`. GENESIS binds `G`, ordinal zero, the
genesis literal, and `Dgb`; `Dgb` binds the selected destination-owner and
anchor ACTIVE triples, use intent, bootstrap identity/transaction/grant, and
`Dsc`. GENESIS has no retiring epoch. Its downstream genesis-selection evidence
then binds `Dbg`, selected E0 `Dp/Dt/Dv/Dr`, exact runtime readbacks and `Dgp`,
the ACTIVE and CONSUMED owner/anchor triples, consumption receipt, and consumed
readbacks. That downstream evidence is required for context admission but is
excluded from the record and E0 selection graph.

ROTATION binds ordinal greater than zero, exact prior selected head ordinal and
record digest, retiring `Dp/Dt/Dv/Dr`, derived `Drot`, and the same `Dsc`.
`Drot` is recomputed from `G`, rotation transaction, retiring authority/head,
successor ordinal, reviewed-operation `Dop`, and
`Dsc`; no caller-selected operation-identity field exists. Both records exclude
successor value/proposal/tip/head and downstream readbacks. The selected
successor value binds the record ordinal and digest. Current context validates
either the complete E0 external/runtime composition or the immediate append
transition. Records live at canonical ordinal-derived paths;
the walk constructs the path of record `n+1` from `n` and never enumerates a
directory. Verification walks the complete chain from genesis and compares the
selected head ordinal and digest: a missing record at or below the head
refuses, the path at head plus one must be absent or match the armed rotation
intent, the path at head plus two must be absent, and a file outside the
canonical ordinal paths carries no authority. Ordinals are canonical decimal
strings bounded by the safe-integer range; grammar, length, and lexicographic
comparison refuse above `Number.MAX_SAFE_INTEGER` before conversion.
Historical producer projections derive from the selected authority value and
the fully walked chain. `G` remains identical across rotations and excludes
rotating helper/profile/ABI/lock/state-component facts. Projections revoke
when the context/head changes.

The record `schemaVersion` is always `authority-history-record/v1`; the
similarly named `authority-history/v1` is only the branch-separated digest
domain. The supervisor ledger's literal member sets and absence rules are part
of every transition guard. No state-machine implementation may derive JSON
keys from the `G`/`Dop`/`Dsc`/`Dgb`/`Dgse`/`Drot`/`Dh` labels.

### Authority rotation

Every commit run is single-epoch, including authority rotation. The rotation
run under E(n) executes checkpoints 0–5, appends the chain record, and
performs the target authority CAS as its final action; it executes no
checkpoint after that CAS under either epoch, and its run-current journal
legitimately rests at the selected `CAS_ARMED` checkpoint across the
selection. Its `AUTHORITY_ROTATION` commit-evidence arm binds old E(n)
`Dp/Dt/Dv/Dr`, intent/run/target mutation, selected checkpoint-5 core and
META_LEAF graph/readbacks/`Dpost`, expected successor `Dv` and history head,
`Drot`, and `Dsc`.

| Rotation outcome | Required exact evidence                                                                                                                                       | Authority/capability                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `RESUMABLE`      | E(n) remains selected; its prior head matches; canonical head+1 record matches intent/target/`Drot`/`Dsc`; head+2 absent; authority registry slot equals E(n) | only same transaction's live E(n) capability may re-drive same CAS |
| `SELECTED`       | exact E(n+1) `Dp/Dt/Dv/Dr`; expected `Dv`; selected value head equals exact record; record readback verifies; authority slot equals E(n+1)                    | derived terminal truth; old capability revoked                     |
| `UNKNOWN`        | fixed-size unknown evidence; authority slot empty                                                                                                             | no capability; external diagnosis                                  |

Checkpoint 6–8, ordinary resolution, selector evidence after checkpoint 5, or
any E(n+1) write is forbidden for this arm. Rotation is forward-only once
appended; the matching pending record is the single permitted head-plus-one
excess. Any other excess, gap, fork, mismatch, or post-CAS E(n) capability is
`UNKNOWN`.

### Evidence packet purpose

| Purpose                    | Current commit                                                                                                  | Capability                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `HISTORICAL_READ`          | exactly null                                                                                                    | scoped read/projection methods only                                                |
| `MUTATION_COMMIT` ordinary | exact `Dcommit`, checkpoints 0–8, resolution, and target slot selected target / real winner / empty             | mutation methods for that ordinary target/meta selector only                       |
| `MUTATION_COMMIT` rotation | exact `Dcommit`, selected old checkpoint 5, successor/history proof, and authority slot old / successor / empty | same old CAS only for RESUMABLE; successor evidence for SELECTED; none for UNKNOWN |

Packet top authority and every identity field are cross-bound to the commit and
slot: E for ordinary, old/successor/null for rotation RESUMABLE/SELECTED/
UNKNOWN. `UNKNOWN` is a fixed-size closed `UNREADABLE|MALFORMED|IMPOSSIBLE` union
with a closed reason enum, observation digest, and safe decimal byte length;
arbitrary JSON, native text, paths, and arrays refuse. Packet arrays are bounded
by the closed evidence-slot census, not lifetime history. A structurally valid
serialized packet without the corresponding live ISS-004 handle grants no
authority.

The exact `pointer-mutation-commit-evidence/v1` member census in the supervisor
ledger makes outcome-to-slot equality executable. Ordinary SELECTED and
LOST_CONFLICT require the selected target or recomputed winner in the target
slot, while UNKNOWN_TERMINAL requires it empty; rotation RESUMABLE/SELECTED/
UNKNOWN require the old/successor/empty authority slot respectively. Wrong,
empty-at-positive, or nonempty-at-unknown slots refuse before capability
issuance.

## Worker process and ownership

| State                     | Permitted authority | Trigger and durable evidence                                             | Interruption/recovery                                             | Next routine operation                    |
| ------------------------- | ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| `PLANNED`                 | dispatching session | validated plan, no ownership yet                                         | discard without vacancy claim                                     | publish ownership                         |
| `STARTING`                | exact launch        | create-once ownership before/with native launch                          | inspect exact child identity                                      | confirm liveness                          |
| `START_FAILED`            | reducer             | launch failure before live identity plus terminal receipt                | no live owner; ownership is terminal                              | workspace eligibility may be re-evaluated |
| `LIVE`                    | exact launch        | liveness binds process tree and workspace subject                        | terminate exact tree or observe exit                              | monitor progress                          |
| `TERMINATING`             | exact launch        | bounded termination request                                              | continue bounded observation                                      | confirm exit                              |
| `TERMINATION_FAILED_LIVE` | exact launch        | bounded termination expired while exact owner or descendant remains live | retain ownership and capacity claim; retry or diagnose exact tree | retry bounded termination or monitor      |
| `EXITED`                  | reducer             | exact owner terminal observation                                         | idempotent read                                                   | workspace may become eligible             |
| `UNKNOWN`                 | none                | conflicting, partial, or aliased identity                                | external diagnosis                                                | capacity refuses                          |

## Session lease

| State              | Permitted authority         | Trigger and durable evidence        | Interruption/recovery          | Next routine operation  |
| ------------------ | --------------------------- | ----------------------------------- | ------------------------------ | ----------------------- |
| `AVAILABLE`        | one acquirer                | absent/released predecessor         | acquisition CAS                | begin cycle             |
| `HELD_FRESH`       | exact session               | acquisition or same-session renewal | renew within bounds            | run one cycle           |
| `HELD_STALE`       | none for mutation           | freshness or duration exceeded      | eligible for one bound handoff | inspect/handoff         |
| `HANDOFF_PREPARED` | exact successor transaction | stale predecessor plus CAS intent   | resume same handoff only       | install successor lease |
| `RELEASED`         | readers/new acquirer        | exact-session release receipt       | none                           | acquire                 |
| `UNKNOWN`          | none                        | skew, malformed, conflicting state  | external diagnosis             | refuse controller start |

## Owned resource reclamation

| State                  | Permitted authority        | Trigger and durable evidence                                     | Interruption/recovery                         | Next routine operation                 |
| ---------------------- | -------------------------- | ---------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `UNALLOCATED`          | exact dispatch transaction | no resource identity or predecessor claim                        | remain absent                                 | allocate                               |
| `ALLOCATED`            | exact dispatch transaction | adapter/host allocation receipt with opaque resource identity    | discard only through same transaction         | bind launch or reclaim                 |
| `LAUNCH_BOUND`         | exact worker owner         | resource receipt bound to launch/process-tree identity           | retain while any exact process may live       | observe terminal process state         |
| `RECLAIM_PENDING`      | exact reclaim transaction  | all bound process identities exactly dead                        | resume same idempotent owner-specific reclaim | verify absence                         |
| `RECLAIM_REFUSED_LIVE` | none for reclaim           | exact owner or descendant remains live                           | retain resource and capacity claim            | terminate/observe exact process tree   |
| `RECLAIMED`            | readers                    | adapter and host absence receipts bind reclaim transaction       | idempotent read                               | workspace/capacity may become eligible |
| `UNKNOWN`              | none                       | malformed, aliased, concurrent, or incomplete ownership evidence | external diagnosis                            | retain resource and capacity claim     |

## Circuit breaker

The adapter supplies policy facts; the engine owns these transitions and never
interprets the project reason or threshold.

| State              | Permitted authority        | Trigger and durable evidence                                                | Interruption/recovery                     | Next routine operation                               |
| ------------------ | -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `CLOSED`           | exact session              | current adapter policy permits affected capability                          | ordinary replay                           | evaluate next policy fact before use                 |
| `OPEN`             | reducer                    | adapter trip fact plus affected opaque capability set                       | persist across restart                    | refuse affected capability; evaluate recovery policy |
| `RECOVERY_PENDING` | exact recovery transaction | current adapter recovery fact binds open receipt and policy version         | resume same transaction only              | run bounded recovery probe                           |
| `PROBE_IN_FLIGHT`  | exact recovery transaction | one recovery probe identity                                                 | retain hold on interruption               | classify probe                                       |
| `CLOSED_RECOVERED` | readers/exact session      | successful probe and recovery receipt                                       | reduce to ordinary `CLOSED` on next cycle | next routine cycle reevaluates policy                |
| `UNKNOWN`          | none                       | malformed history, stale policy, moved open receipt, or contradictory probe | external diagnosis                        | affected capability remains blocked                  |

## Review authority

| State        | Permitted authority   | Trigger and durable evidence                                                                                                                                          | Interruption/recovery                        | Next routine operation                 |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| `REQUESTED`  | distinct reviewer     | exact closed-union review subject (worker result or certified landed release candidate) and author attempt; optional revision materialization proves identical digest | re-observe unchanged subject/materialization | dispatch distinct review cycle         |
| `IN_REVIEW`  | same reviewer attempt | reviewer launch identity                                                                                                                                              | resume same attempt or terminate incomplete  | complete sweep                         |
| `ACCEPTED`   | stable reducer        | complete receipt binding the identical review-subject kind/digest                                                                                                     | immutable history                            | target mutation/promotion may evaluate |
| `REJECTED`   | planner/repair policy | complete findings receipt                                                                                                                                             | immutable history                            | module chooses repair/replan           |
| `SUPERSEDED` | none                  | subject moved after terminal receipt                                                                                                                                  | no reuse                                     | request new review                     |
| `UNKNOWN`    | none                  | truncated, contradictory, or malformed history                                                                                                                        | external diagnosis                           | refuse promotion                       |

## Routine engine cycle

The adapter supplies frontier/policy facts and modules supply typed decisions;
the engine owns composition and never interprets consumer vocabulary.

| State               | Permitted authority   | Trigger and durable evidence                                                                                       | Interruption/recovery                            | Next routine operation                    |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| `PLANNED`           | exact session         | authority-free protocol/configuration skeleton only; no live facts, route, dispatch, review, or mutation authority | discard before execution or run exact skeleton   | observe fresh facts in step 2             |
| `RUNNING`           | exact session/cycle   | cycle start binds plan and journal prefix                                                                          | replay journal and resume exact cycle            | invoke next typed step                    |
| `WAITING_WORKER`    | exact worker owner    | dispatch/launch receipt                                                                                            | observe or resume without redispatch             | reduce terminal worker receipt            |
| `WAITING_REVIEW`    | distinct reviewer     | exact-subject review request                                                                                       | observe/resume same attempt                      | reduce review authority                   |
| `WAITING_ACTION`    | exact session         | typed module action plan, including optional release promotion                                                     | re-observe external authority and same plan      | apply/refuse through owning package       |
| `COMPLETED`         | readers               | terminal receipt binds every step and resulting journal prefix                                                     | idempotent read                                  | begin next cycle                          |
| `COMPLETED_NO_WORK` | readers               | complete frontier plus policy facts prove no eligible action                                                       | idempotent read                                  | begin next cycle after configured cadence |
| `FAILED_KNOWN`      | exact session/readers | named terminal refusal with retained authorities/resources                                                         | execute named repair/retry policy in a new cycle | begin bounded follow-up cycle             |
| `UNKNOWN`           | none                  | missing/contradictory step, false prefix, moved plan, or unowned side effect                                       | external diagnosis                               | refuse new mutation cycle                 |

## Cycle supervisor

The supervisor is invoked by an installed Windows Task Scheduler definition,
macOS LaunchAgent, or Linux systemd user timer/service. Exactly one tick owns
re-entry; the scheduler itself has no project mutation credential.

| State                  | Permitted authority          | Trigger and durable evidence                                                    | Interruption/recovery                     | Next routine operation                                 |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `UNINSTALLED`          | installation transaction     | no scheduler definition or installation receipt                                 | remain absent                             | plan/install                                           |
| `INSTALLED_IDLE`       | exact scheduler installation | verified OS definition plus no live tick                                        | host restart preserves OS definition      | wait for cadence/start event                           |
| `TICK_STARTING`        | exact scheduler invocation   | create-once tick identity before session acquisition                            | inspect exact process/tick                | acquire/resume session                                 |
| `TICK_ACTIVE`          | exact tick/session           | one cycle run/resume identity                                                   | journal replay after process interruption | reach cycle terminal                                   |
| `TICK_TERMINAL`        | readers/supervisor           | terminal cycle + tick receipt, resources accounted                              | idempotent read                           | return to `INSTALLED_IDLE`                             |
| `STOPPING`             | exact uninstall transaction  | scheduler disabled before active tick termination                               | resume same transaction                   | verify no future invocation/live tick                  |
| `UNINSTALLED_VERIFIED` | readers                      | scheduler absence, terminal tick, and credential census                         | idempotent read                           | remain stopped or new install                          |
| `UNKNOWN`              | none                         | duplicate tick, moved definition, missing terminal, or contradictory host state | external diagnosis                        | disable new mutation tick and refuse install overwrite |

## Journal and snapshot

| State              | Permitted authority  | Trigger and durable evidence                | Interruption/recovery                              | Next routine operation     |
| ------------------ | -------------------- | ------------------------------------------- | -------------------------------------------------- | -------------------------- |
| `JOURNAL_ONLY`     | exact session append | valid prefix                                | ignore partial suffix with explicit health failure | append/reduce              |
| `SNAPSHOT_CURRENT` | exact prefix readers | snapshot binds prefix digest                | replay suffix                                      | append/reduce              |
| `SNAPSHOT_STALE`   | readers              | valid snapshot on older prefix              | replay and replace atomically                      | ordinary reduce            |
| `CORRUPT`          | none                 | false prefix, invalid event, or third state | external diagnosis                                 | refuse authority reduction |

## Release promotion

For bootstrap N0, `PINNED_BOOTSTRAP` means the exact default-branch workflow and
test-bundle bytes, distinct reviewer, operator grant, and reviewed bootstrap
installer. There is no stable predecessor. For N1 and later, the authority actor
is the installed stable predecessor. Candidate bytes are never the actor in
either path.

| State                                | N0 actor                                                                                                                                                               | N1+ actor                                                                      | Trigger and durable evidence                                                                                                                                                                                                      | Interruption/recovery                                                                                                                                                                                 | Next routine operation                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ASSEMBLED`                          | pinned bootstrap build workflow                                                                                                                                        | installed stable predecessor build path                                        | immutable candidate manifest                                                                                                                                                                                                      | rebuild new identity if changed                                                                                                                                                                       | certify                                                    |
| `CONFORMED`                          | pinned bootstrap aggregator workflow                                                                                                                                   | installed stable predecessor aggregator                                        | all OS receipts bind candidate/test bundle                                                                                                                                                                                        | rerun failed environment                                                                                                                                                                              | independent review                                         |
| `REVIEWED`                           | distinct independent reviewer                                                                                                                                          | distinct independent reviewer                                                  | exact-candidate acceptance                                                                                                                                                                                                        | re-observe unchanged evidence                                                                                                                                                                         | authorize                                                  |
| `AUTHORIZED`                         | human operator grant over exact digest, validated by reviewed bootstrap installer                                                                                      | installed stable predecessor preflight                                         | fresh authority plus one-use recovery digest; for N0 exact `Dphys/Ddest`, owner/anchor review inputs                                                                                                                              | abort only before first mutation                                                                                                                                                                      | apply                                                      |
| `BOOTSTRAP_APPLYING`                 | reviewed bootstrap installer, same transaction                                                                                                                         | n/a                                                                            | selected owner/anchor ACTIVE, pre-expiry use intent, first N0 destination mutation                                                                                                                                                | forward recovery of the same owner/anchor/transaction only                                                                                                                                            | install/verify N0                                          |
| `BOOTSTRAP_ACTIVE`                   | installed N0                                                                                                                                                           | n/a                                                                            | selected owner/anchor CONSUMED, acyclic E0 core/proposal/tip and both post-selection receipts, genesis active-release, broker client, shim read-back, bootstrap receipt, authorization revoked, cleanup archive/tombstone         | ordinary recovery rules                                                                                                                                                                               | first N0 no-work tick                                      |
| `SUCCESSOR_STAGED_PRE_ACTIVATION`    | n/a                                                                                                                                                                    | installed stable predecessor                                                   | verified N+1 bytes, pending broker admission, selected `recovery-authorization-state/v1` `CONSUMED` with exact native-consume and post-selection consume receipts, and published recovery fence; gate `PENDING`, active pointer N | activation CASes gate `ACTIVATING`; abort CASes gate `ABORTING`; exactly one wins                                                                                                                     | `SUCCESSOR_ACTIVATING_PRE_POINTER` or abort                |
| `SUCCESSOR_ACTIVATING_PRE_POINTER`   | n/a                                                                                                                                                                    | exact predecessor/fence-backed recovery transaction                            | gate `ACTIVATING`; active pointer still N; exact expected N+1 record                                                                                                                                                              | forward-only active-release CAS; abort refuses; mismatch becomes unknown                                                                                                                              | `SUCCESSOR_ACTIVE_HANDOFF`                                 |
| `SUCCESSOR_ACTIVE_HANDOFF`           | n/a                                                                                                                                                                    | same live or shim-relaunched predecessor recovery transaction                  | atomic active pointer names N+1 while broker still names N                                                                                                                                                                        | forward recovery only; ordinary ticks fenced                                                                                                                                                          | activate broker N+1, record follow-up, terminalize N cycle |
| `SUCCESSOR_ACTIVE`                   | n/a                                                                                                                                                                    | installed N+1 successor                                                        | selected active-release, activated broker-client generation, shim read-back, cleared fence, terminal predecessor cycle receipt, recovery authorization revoked, and cleanup archive/tombstones selected                           | ordinary recovery rules                                                                                                                                                                               | next scheduler tick runs successor verification follow-up  |
| `BOOTSTRAP_ABORTING_PRE_MUTATION`    | exact reviewed bootstrap abort command + broker internal reconciler                                                                                                    | n/a                                                                            | cleanup gate `ABORTING` and authoritative destination-absence plan                                                                                                                                                                | broker revokes; resumed command selects gate archive head and durable tombstone                                                                                                                       | `ABORTED_PRE_MUTATION`                                     |
| `SUCCESSOR_ABORTING_PRE_ACTIVATION`  | n/a                                                                                                                                                                    | exact predecessor transaction/shim + broker internal reconciler                | gate `ABORTING`; active pointer N; shim-proven staging absence; publication discriminator frozen; any exact fence retained                                                                                                        | no authorization attachment or broker client; terminalize/archive any pre-fence child, broker compare-removes bound pending admission and revokes, then shim clears an exact fence and completes gate | `ABORTED_PRE_ACTIVATION`                                   |
| `ABORTED_PRE_MUTATION`               | bootstrap installer or granting operator for exact transaction                                                                                                         | installed stable predecessor for exact transaction                             | authoritative destination absence, recovery authorization revocation, selected cleanup-gate archive head, and durable tombstone before first mutation                                                                             | no resume                                                                                                                                                                                             | start new candidate transaction                            |
| `ABORTED_PRE_ACTIVATION`             | n/a                                                                                                                                                                    | installed stable predecessor for exact transaction                             | staged bytes/pending admission terminalized, authorization `REVOKED`, cleanup/fence archives and tombstones selected while active pointer remains N                                                                               | no resume                                                                                                                                                                                             | start new candidate transaction                            |
| `BOOTSTRAP_RECOVERY_REQUIRED`        | reviewed bootstrap installer, same transaction and selected `recovery-authorization-state/v1` `CONSUMED` plus exact native-consume and post-selection consume receipts | n/a                                                                            | interrupted N0 post-mutation state                                                                                                                                                                                                | prove/reuse exact pre-bound authorization; never consume again; resume forward                                                                                                                        | reach `BOOTSTRAP_ACTIVE`                                   |
| `SUCCESSOR_RECOVERY_PRE_ACTIVATION`  | n/a                                                                                                                                                                    | exact predecessor/shim transaction; narrowed consume only while gate `PENDING` | interrupted pre-fence work while active pointer remains N                                                                                                                                                                         | `PENDING` uses closed pre-fence handoff; `ABORTING` uses clientless shim staging cleanup plus broker-internal admission removal/revoke                                                                | staged or `ABORTED_PRE_ACTIVATION`                         |
| `SUCCESSOR_RECOVERY_POST_ACTIVATION` | n/a                                                                                                                                                                    | shim-launched exact predecessor recovery transaction/capability                | pointer names N+1 and fence remains                                                                                                                                                                                               | forward recovery only                                                                                                                                                                                 | reach `SUCCESSOR_ACTIVE`                                   |
| `UNKNOWN`                            | none                                                                                                                                                                   | none                                                                           | candidate/evidence movement or third state                                                                                                                                                                                        | external diagnosis                                                                                                                                                                                    | refuse install/start                                       |

## Activation recovery

### Attempt reservation

| State       | Permitted authority                | Required evidence                                                                                                                 | Next state          |
| ----------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `RESERVED`  | selected old-epoch proposal winner | transaction/source and predecessor terminal attempt-log triple or tagged genesis select one prebound UUIDv7 and descriptor inputs | `CONSUMED`          |
| `CONSUMED`  | exact launch transaction           | attempt-log `IN_PROGRESS` record binds reservation `Dt/Dv/Dr`                                                                     | `TERMINAL`          |
| `TERMINAL`  | exact terminal reducer             | selected `TERMINAL` attempt-log record                                                                                            | `TOMBSTONE`         |
| `TOMBSTONE` | readers/later transaction          | selected archive/tombstone proof                                                                                                  | no transition       |
| `UNKNOWN`   | none                               | collision, fork, malformed or wrong predecessor                                                                                   | refuse launch/start |

The same predecessor and bytes reuse the selected reservation. A competing
UUID proposal is classified lost. UUIDv7 supplies uniqueness only.

### Attempt and attempt log

| State                            | Required evidence                                                                                                                                                       | Next operation                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `LIVE` descriptor                | CAS-selected durable reservation and exact process identity                                                                                                             | attach or monitor                              |
| `IN_PROGRESS` attempt-log record | current reservation/descriptor; first has ordinal `"0"` and tagged genesis predecessor, later binds the previous selected `TERMINAL` record digest and ordinal plus one | produce one `TERMINAL` record                  |
| `TERMINAL` attempt-log record    | same descriptor plus folded terminal state/lineage, exit/absence, and channel-denial fields                                                                             | reserve from this terminal triple or tombstone |
| `UNKNOWN`                        | malformed, duplicate ID, moved process, stale pointer, or mixed transaction                                                                                             | refuse launch/start                            |

Attachment binds a selected LIVE descriptor, never a future terminal record.
The `TERMINAL` attempt-log record folds in descriptor, optional attachment,
terminal lineage, exit/absence, channel-denial, and revocation evidence; no
separate terminal-summary document exists. Each operation verifies the full
attempt-log chain, which stays small because attempts are rare; chained
ordinals refuse above `2^53 - 1`.

### Cleanup gate

The ten admissible lifecycle/publication pairs are PN, PI, PP, AP, BN, BI, BP,
BC, CN, and CC. Exactly these twelve mutation edges append:

```text
PN→PI  PN→BN  PN→CN  PI→PP  PI→BI  PP→AP
PP→BP  AP→CC  BN→CN  BI→BP  BP→BC  BC→CC
```

All other cells and all self-loop writes refuse. Crash resume of an already
selected pair is `NO_APPEND`. Fence state is `PREPARED→POST_ACTIVATION`; no
self-loop write is allowed. Root/head histories are complete, dense,
digest-linked arrays validated with the shared closed-array snapshot. Their
canonical selected pointers never CAS from bare absence after genesis.

### Retention and degraded audit

Destination owner/anchor, physical identity/observations, state-authority
history, and run-current audit are FULL_REQUIRED and may not be discarded.
Terminal attempt history may compact only after a selected checkpoint, selected
plan, exact deletion, verified receipt, and completion selection. Pending
proposals never compact.
Unexpected old terminal loss may select `AUDIT_DEGRADED` only after an eligible
checkpoint/tombstone. That state permits existing forward recovery, retry,
cleanup, selected attachment, and ordinary non-release ticks; it blocks new
promotion/bootstrap/certification, unrelated authorization/attachment,
compaction, and audit finalization. Any earlier or full-required loss is
`UNKNOWN` and blocks all mutation/start.

## Shadow discrepancy

| State                | Permitted authority | Trigger and durable evidence                   | Interruption/recovery | Next routine operation |
| -------------------- | ------------------- | ---------------------------------------------- | --------------------- | ---------------------- |
| `OBSERVED`           | comparator          | correlated incumbent/shadow inputs and outputs | retain pending row    | classify               |
| `EXPLAINED_EXPECTED` | readers             | approved policy difference                     | none                  | include in baseline    |
| `FIXTURE_GAP`        | fixture owner       | missing representative input proven            | add fixture and rerun | resolve                |
| `ADAPTER_DEFECT`     | adapter owner       | reproduced translation error                   | fix and rerun         | resolve                |
| `PLATFORM_DEFECT`    | platform owner      | reproduced engine/module error                 | fix and rerun         | resolve                |
| `UNEXPLAINED`        | none for cutover    | insufficient or contradictory evidence         | gather timed evidence | cutover refuses        |
| `RESOLVED`           | readers             | regression fixture plus matching rerun         | none                  | continue observation   |

## Consumer cutover

| State                  | Permitted authority        | Trigger and durable evidence                                      | Interruption/recovery                                                                                                       | Next routine operation                                                                       |
| ---------------------- | -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PREPARED`             | incumbent                  | current shadow pass and cutover plan                              | discard plan                                                                                                                | refresh observations                                                                         |
| `QUIESCED`             | incumbent only             | incumbent drained and mutation fence proven                       | restore incumbent before import mutation                                                                                    | capture/export and commit import                                                             |
| `AUTHORIZED`           | exact cutover transaction  | `IMPORT_COMMITTED`, one prospective writer, and fresh authorities | pre-consumer-mutation abort allowed                                                                                         | first successor consumer mutation                                                            |
| `ABORTED_PRE_MUTATION` | incumbent                  | abort receipt before successor's first consumer mutation          | incumbent authority restored; transaction cannot resume; any committed import remains non-authoritative historical evidence | incumbent runs next routine cycle; a future cutover requires a new export/import transaction |
| `SUCCESSOR_MUTATING`   | successor transaction      | first mutation receipt                                            | forward recovery only                                                                                                       | complete first cycle                                                                         |
| `SUCCESSOR_ACTIVE`     | successor                  | terminal first-cycle and authority-transfer receipt               | ordinary recovery rules                                                                                                     | next routine cycle                                                                           |
| `RECOVERY_REQUIRED`    | same successor transaction | post-mutation interruption                                        | resume successor                                                                                                            | reach active                                                                                 |
| `UNKNOWN`              | none                       | dual-writer, missing fence, or moved authority                    | external diagnosis                                                                                                          | all mutations refuse                                                                         |

## Consumer state import

| State                  | Permitted authority           | Trigger and durable evidence                                                                     | Interruption/recovery                        | Next routine operation                    |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------- |
| `NOT_STARTED`          | incumbent readers             | no export/import transaction exists                                                              | remain absent                                | capture quiescent export                  |
| `EXPORT_CAPTURED`      | incumbent while authoritative | quiescent source census, schema, provenance, cursor/breaker/terminal-event inventory, and digest | recapture if source moves before preparation | validate mapping                          |
| `IMPORT_PREPARED`      | exact cutover transaction     | deterministic target plan binds export and absent/expected predecessors                          | pre-mutation abort allowed                   | apply target records                      |
| `IMPORT_APPLYING`      | same transaction              | first create-once/CAS target mutation                                                            | forward recovery only                        | finish same plan                          |
| `IMPORT_APPLIED`       | same transaction              | every target record written once                                                                 | verify replay and record census              | verify                                    |
| `IMPORT_VERIFIED`      | same transaction              | replay, cursor, breaker, and terminal-event equivalence receipt                                  | resume commit only                           | commit import identity                    |
| `IMPORT_COMMITTED`     | successor                     | durable import receipt bound to cutover authority transfer                                       | ordinary replay                              | successor runs first routine cycle        |
| `ABORTED_PRE_MUTATION` | incumbent/exact transaction   | abort before first target mutation                                                               | no resume                                    | incumbent continues routine operation     |
| `RECOVERY_REQUIRED`    | same transaction              | interruption after first target mutation                                                         | resume idempotently; no second export        | reach `IMPORT_COMMITTED`                  |
| `UNKNOWN`              | none                          | partial/moved/malformed export or target record not bound to transaction                         | external diagnosis                           | both import and authority transfer refuse |

## Incumbent comparator retirement

| State                     | Permitted authority          | Trigger and durable evidence                                       | Interruption/recovery                   | Next routine operation                                                          |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| `SHADOW_ACTIVE`           | read-only comparator         | correlated pre-cutover observation                                 | retain credentials and process          | continue shadow comparison                                                      |
| `POST_CUTOVER_READONLY`   | credential-fenced comparator | successor authority transfer receipt                               | no mutation or controller-lease renewal | continue bounded comparison window                                              |
| `TERMINAL_REPORT_WRITTEN` | retirement transaction       | seven-day/100-decision report durably bound to both controllers    | resume same retirement transaction      | revoke comparator credentials                                                   |
| `CREDENTIALS_REVOKED`     | retirement transaction       | credential census proves no external or local mutation authority   | retain process only for bounded exit    | terminate comparator process                                                    |
| `STOPPED`                 | readers                      | exact process-tree terminal receipt and final credential census    | idempotent read                         | successor runs next routine cycle alone                                         |
| `UNKNOWN`                 | none                         | live process, credential, report, or identity cannot be reconciled | external diagnosis                      | successor mutation policy refuses where comparator authority cannot be excluded |

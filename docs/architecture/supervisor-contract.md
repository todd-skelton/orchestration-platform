# Cross-platform supervisor installation contract

The supervisor is user-scoped. “Cold-host re-entry” means the first eligible
session for the declared user after reboot; system/root services and unattended
pre-login execution are outside the bootstrap contract.

Every native definition binds one absolute Node 24 executable and one immutable
installation-scoped `orchestration-supervisor-shim.mjs`, their byte digests,
project/state roots, UUIDv7 installation identity, shim ABI
`supervisor-shim/v1`, and the exact argument vector:

```text
["<absolute-node>","<installed-supervisor-shim>","--project-root","<project-root>","--state-root","<state-root>","--installation","<uuidv7>"]
```

No shell interprets this vector. Generated files contain no credential or token.
The scheduler invokes every five minutes; tick create-once/CAS is the final
overlap authority, so native “ignore overlap” settings are defense in depth.

The shim contains no project or credential capability. On every invocation it
opens the non-symlink state-root record `installation/active-release.json`,
validates canonical `active-release/v1`, installation/project/state identities,
monotonic activation generation, `supervisor-shim/v1` compatibility, and the
absolute installed `orchestrate` path/digest, then launches the canonical tick
argv with no shell. Missing, partial, moved, incompatible, stale-generation, or
digest-mismatched active records refuse before child start.

The only handoff fence head is canonical
`<state-root>/installation/activation-recovery-fence.json` containing
`activation-recovery-fence-current/v1`. Before publication the transaction
precomputes and the cleanup-gate root binds immutable
`<state-root>/installation/activation-recovery-fence-roots/<transaction>.json`
(`activation-recovery-fence-root/v1`). Fence changes are create-once at
`<state-root>/installation/activation-recovery-fence-history/<transaction>/<ordinal>-<state>.json`
as `activation-recovery-fence-head/v1`; the current pointer CASes only to an
exact next ordinal/path/digest. Root and head records bind installation/project/state identities,
promotion transaction and recovery-reference digests, predecessor and successor
release/executable/operation-manifest digests, pending broker-admission identity,
predecessor active-record digest/generation, expected successor record digest/
generation, lifecycle `PREPARED` or `POST_ACTIVATION`, and create/update times.
Stable N creates the immutable root, initial `PREPARED` head, and current pointer
with create-once/CAS before active-release mutation. Pointer CAS is
allowed only from its recorded predecessor to expected successor. If a crash
leaves `PREPARED` while the pointer already names the successor, recovery
canonically reduces it to `POST_ACTIVATION`; it never infers rollback. Only the
bound predecessor transaction/recovery capability may update or remove it.
Absent fence root/current is ordinary operation only when no publication is
expected; any present malformed, mismatched, unknown,
or unbound fence makes the shim refuse child start. A valid fence does not
permit an ordinary tick. Recovery launch authority is the canonical current
pointer `<state-root>/installation/activation-recovery-launch.json` with schema
`activation-recovery-launch-current/v1`. It is closed on authority source and
binds immutable gate/fence root digests plus last-observed head ordinals/digests:
`recovery-fence/v1` requires matching fence and cleanup-gate roots and current
heads; `cleanup-gate-pre-fence/v1` requires the matching gate root/head with
`NOT_PUBLISHED` plus canonical fence absence, or `PUBLISHING` plus canonical
fence absence/the exact precomputed fence. Its pointer binds the expected fence
root digest from the gate but keeps fence-authority/current-head fields canonical
JSON `null` because the gate—not the fence—is its authority. After
successful publication, the existing chain alone may remain with matching
`PUBLISHED` gate/fence only to reach or clean up `TERMINAL_HANDOFF`; it cannot
launch another attempt, attach, or perform additional promotion work. The source is immutable for one pointer lifetime; a
pre-fence chain must terminalize, archive, and remove its pointer before a new
fence-backed chain can begin. The pointer also binds installation, promotion transaction,
cycle, current generation/attempt/state ordinal,
current immutable state-record path/digest, and prior-pointer digest. The state
record is create-once at
`<state-root>/installation/activation-recovery-launches/<transaction>/<source-token>/<generation>/<ordinal>-<state>.json`
with schema `activation-recovery-launch/v1`. Every state record binds all pointer
shared authority fields (installation, fence, transaction, cycle, generation,
attempt, and ordinal) plus predecessor executable/path/digest, active-record and
exact argv digests, prior pointer and previous state-record digests, process-tree identity where applicable,
start/heartbeat/terminal times, and lifecycle `READY`, `LIVE`,
`TERMINAL_RETRYABLE`, `TERMINAL_HANDOFF`, `TERMINAL_ABORTED`,
`TERMINAL_COMPLETE`, or `UNKNOWN`. `TERMINAL_HANDOFF` is valid only for
`cleanup-gate-pre-fence/v1`. `TERMINAL_ABORTED` is valid for either source only
when the gate is `ABORTING` and the active record still names N. A transition first
writes its immutable successor record and reads it back, then CASes the current
pointer from the exact prior digest. Only that subsequently constructed pointer
contains the new state-record path/digest; the state record never hashes or
contains its own digest. A failed pointer CAS leaves unreferenced
evidence but grants no authority; no state or attempt byte is overwritten.
The exhaustive path mapping is `recovery-fence/v1` → `recovery-fence-v1` and
`cleanup-gate-pre-fence/v1` → `cleanup-gate-pre-fence-v1`; any other token,
slash-bearing segment, encoding, or source/token mismatch refuses.

Gate/fence head advancement never changes a launch's immutable authority roots.
Before writing any next gate/fence head, every actor must prove the canonical
launch pointer absent for that transaction or already bound to the current head.
An adjacent old-pointer/current-head mismatch blocks every further authority-
head write until the shim completes rebind; nonadjacent mismatch is `UNKNOWN`.
If a canonical head is exactly one ordinal ahead and its immutable head record
names the launch pointer's prior head digest, the monitor writes a same-source
launch transition with `transitionKind: AUTHORITY_REBIND`, retaining lifecycle,
generation, attempt, process identity, roots, and every other binding while
advancing only that head ordinal/digest, then CASes the launch pointer. The child
pauses between the authority-head CAS and this acknowledgment. A rebind cannot
launch, attach/reattach, invoke a broker/project method, or skip an ordinal.
Crash in the old-pointer/new-head window resumes only this adjacent rebind;
missing history, a second unbound head advance, changed root/source/process, or
nonadjacent lineage is `UNKNOWN`. Ordinary launch transitions use
`transitionKind: LIFECYCLE`.

Gate and fence triples share one closed initialization reducer. Ordinal-zero
head records encode `previousHeadDigest` as canonical JSON `null`; later heads
require the exact lowercase SHA-256 digest of ordinal N-1. The canonical current
pointer is created only by CAS from absence after immutable root and ordinal-zero
head read-back. For the exact transaction, initialization recognizes only:

1. `ABSENT`: deterministic root, history directory/ordinal-zero head, and
   canonical current pointer are all absent; create/read back the root.
2. `ROOT_ONLY`: exact root present, ordinal-zero head and current absent;
   create/read back the uniquely derived head.
3. `ROOT_AND_HEAD`: exact root and ordinal-zero head present, current absent;
   CAS the current pointer from absence and read it back.
4. `CURRENT`: exact root/head/current chain present; continue normal reduction.

The same transaction/authorized initializer may resume only the missing suffix.
A head without root, current without both, wrong bytes/path/digest, non-null
ordinal-zero predecessor, extra/multiple ordinal-zero heads, unexpected later
head, or mixed transaction is `UNKNOWN`. “Absent” always means all three
deterministic current-transaction locations are authoritatively absent; retained
root/history for a separately archived transaction never satisfies or conflicts
with another transaction's unique paths.

Generation-zero ordinal-zero `READY` encodes both `priorPointerDigest` and
`previousStateRecordDigest` as canonical JSON `null`, and the current pointer is
created with create-once/CAS-from-absence. Every later transition—including a
later generation's ordinal-zero `READY`—requires lowercase 64-hex SHA-256 prior
pointer and previous-state-record digests. A digest at generation-zero ordinal-
zero, `null` on generation-zero `LIVE` or any later record, empty string, zero
digest, or omitted field refuses.

The first attempt writes generation-zero ordinal-zero `READY`, then creates the
current pointer before native launch. Child creation returns an OS start token/
process-tree identity; a new immutable record plus pointer CAS moves `READY` to
`LIVE`. If the shim dies around creation, the next shim performs one of three
closed reconciliations: adopt the single process whose executable, argv,
parent/installation marker, start token, and creation window match and advance
to `LIVE`; prove both launch owner and matching process absent and advance to
`TERMINAL_RETRYABLE`; or advance to `UNKNOWN` on zero proof, multiple matches,
moved identity, or ambiguous OS observation. A shim replacing a dead monitor
may observe/adopt an already `LIVE` child but never create another. Known process
exit may advance `LIVE` to `TERMINAL_RETRYABLE`.

Each later attempt within one authority source requires pointer CAS from an observed
`TERMINAL_RETRYABLE` to a create-once generation N+1 `READY`, carries the prior
terminal-record digest, and retains the same fence, transaction, cycle,
predecessor, active record, source, and argv. At most one pointer-authorized generation
may be `READY` or `LIVE`; malformed, mismatched, or `UNKNOWN` state blocks
another launch. There is no one-attempt lifetime cap: scheduler invocations may
sequentially retry the same forward-recovery transaction until complete, but
can never run concurrent attempts or change its bindings.

For `recovery-fence/v1`, a pre-activation `READY` or `LIVE` chain may be
terminalized as `TERMINAL_ABORTED` only if the gate's abort CAS won while the
active record still names N. The broker denies its channel; the monitor proves
child exit/absence, archives the source-specific chain, and CAS-removes the
pointer before broker-internal abort cleanup. Once gate `ACTIVATING` exists,
abort and `TERMINAL_ABORTED` refuse and recovery is forward-only. After
activation, step 15 orders completion as terminal cycle receipt, broker/resource read-back,
immutable `TERMINAL_COMPLETE` state plus pointer CAS, and only then fence clear.
A recovery child writes the terminal receipt while still live and waits; the
owning shim monitor (or a later shim after monitor death) proves that receipt and
broker/resource state, advances the pointer to `TERMINAL_COMPLETE`, clears the
fence, and signals completion. Child exit is not a prerequisite for terminal
pointer CAS; it is required before archive and pointer cleanup. Once the fence is absent, only a
pointer already naming `TERMINAL_COMPLETE` may proceed. The shim first waits for
the broker's exact `recovery-authorization/v1` `REVOKED` read-back; it has no
broker cleanup capability itself. Cleanup then writes and reads back
`activation-recovery-launch-archive/v1` at
`<state-root>/installation/activation-recovery-launches/<transaction>/<source-token>/archive.json`,
binding the ordered state-record path/digest chain, generation/transition
counts, terminal receipt, and fence-clear receipt, then CAS-removes the current
pointer after exact child-exit proof. A crash resumes only the missing suffix of this order. A later
promotion requires the current pointer absent and creates a new transaction's
generation-zero chain. Archived/different-transaction or unreferenced records
can never be continued; any fence-less nonterminal `recovery-fence/v1` pointer
is `UNKNOWN`.

For `cleanup-gate-pre-fence/v1`, successful consume and exact fence/gate
publication are a handoff, not recovery completion. After consumed read-back,
the child first CASes publication `NOT_PUBLISHED` → `PUBLISHING`, then creates
and reads back only the gate's precomputed canonical fence, then CASes
`PUBLISHING` → `PUBLISHED`. Restart from `PUBLISHING` accepts only fence absence
or that exact fence and resumes the missing suffix. The child writes
`pre-fence-handoff-receipt/v1` and waits. The monitor CASes the pointer to
`TERMINAL_HANDOFF`, signals and proves child exit, writes/reads a source-specific
`activation-recovery-launch-archive/v1`, then CAS-removes the pointer. If the
child dies after publication but before its receipt, exact `PUBLISHED` gate,
matching fence, and unambiguous child absence are sufficient for the monitor to
terminalize the same chain as `TERMINAL_HANDOFF`; ambiguity becomes `UNKNOWN`.
Only after pointer absence may the shim create a fresh `recovery-fence/v1`
generation-zero chain. A crash after any handoff write resumes that suffix; the
pre-fence chain never changes source and never attaches recovery authorization.
If abort wins, any pre-fence chain loses its consume client immediately, exits,
and the monitor records `TERMINAL_ABORTED`, archives the source-specific chain,
and removes its pointer before final gate cleanup. Exact child absence may
substitute for its abort receipt; ambiguous process state is `UNKNOWN`.

For every admitted generation, the shim verifies the retained predecessor
executable/path/digest and launches, with no shell:

```text
["<predecessor-orchestrate>","--project-root","<project-root>","--state-root","<state-root>","--output","json","--no-color","cycle","resume","--cycle","<cycle-id>"]
```

Only a `recovery-fence/v1` launch may receive the fence-bound recovery reference
through the closed broker channel. A pre-fence launch may receive only the
narrowed one-use consume client in the exact state described below; no secret
appears in argv/environment. Repeated scheduler
invocations observe the exact live/terminal generation, cannot create a
concurrent process, and may advance only a proven retryable terminal generation.
A pre-pointer recovery may resume or reach
`ABORTED_PRE_ACTIVATION`; a post-pointer recovery may only resume steps 13–15,
activate broker authority, terminalize the predecessor cycle, clear the fence,
and exit.

Every N0 activation and N1+ promotion also owns immutable
`<state-root>/installation/activation-cleanup-gate-roots/<transaction>.json`
(`activation-cleanup-gate-root/v1`) and canonical shim-readable current pointer
`<state-root>/installation/activation-cleanup-gate.json`
(`activation-cleanup-gate-current/v1`). Gate changes are create-once at
`<state-root>/installation/activation-cleanup-gate-history/<transaction>/<ordinal>-<lifecycle>-<publication>.json`
as `activation-cleanup-gate-head/v1`; the current pointer CASes only to an exact
next ordinal/path/digest. After recovery authorization is created but before it
is consumed, the installer/stable predecessor creates the immutable root and
initial `PENDING`/`NOT_PUBLISHED` head, binding
installation, mode, transaction, candidate/release, recovery-authorization
path/created digest/expected consumed digest, expected active record/generation,
deterministic archive path, prior cleanup-head digest, optional fence digest
(`null` for N0), fence publication `NOT_PUBLISHED`, `PUBLISHING`, `PUBLISHED`,
or `CLEARED`,
and times. Every head binds root digest, ordinal, previous-head digest, lifecycle
`PENDING`, `ACTIVATING`, `ABORTING`, or `COMPLETE`, and publication state.
A present gate always refuses an ordinary tick, even
after the recovery fence is absent and no recovery-launch pointer exists. After
mode-specific terminal proof and broker-internal authorization `REVOKED`, the
installer or shim CASes it to `COMPLETE` with the revocation receipt.

Successor activation must CAS the gate from `PENDING` to `ACTIVATING` with the
exact N active-record digest, `PUBLISHED` fence, pending admission, recovery-
authorization launch binding, and expected N+1 record before attempting the
active-release CAS. Abort may CAS only `PENDING` to `ABORTING` with the same N
read-back. These two gate CAS operations are the sole decision race: exactly one
wins. `ACTIVATING` is forward-only even while active-release still names N; a
mismatched third active record becomes `UNKNOWN`.

Pre-mutation/pre-activation abort after gate creation first CASes `PENDING` to
`ABORTING` with the exact absence plan. For successor abort, the shim or live
predecessor removes exact staged bytes while any published recovery fence
remains; the broker internally compare-and-removes the bound pending admission,
then revokes after absence read-back, and the shim clears the
fence. Caller death before revoke therefore remains fence-recoverable, while
death after revoke requires only shim-owned fence/gate cleanup. N0 has no fence;
broker-internal destination-absence reconciliation and the exact resumed
bootstrap abort command complete its gate. An earlier abort before gate creation
requires authoritative gate absence and client revocation of the unconsumed
capability.

For successor mode while the active pointer still names N, a present `PENDING`
gate with `fencePublication: NOT_PUBLISHED` or `PUBLISHING` admits exactly one
gate-bound predecessor continuation—not an ordinary tick. An `ABORTING` gate
admits only clientless shim cleanup, never a continuation child. The shim verifies the
current active N executable and exact transaction/cycle, proves the original
promotion process/tree absent with the process contract, and requires the
canonical recovery-launch pointer absent. A live original owner causes no new
launch; ambiguous owner state is `UNKNOWN`. Only then does it use the same
immutable launch/current-pointer machinery with authority source
`cleanup-gate-pre-fence/v1`, immutable gate root plus current head required, and
the expected immutable fence-root digest bound without granting fence authority.
`PENDING` plus `CREATED_UNCONSUMED` receives only the narrowed
recovery-admin consume client, consumes against that exact gate, and reads back
`CONSUMED_BOUND`; it receives no recovery or project capability. `PENDING` plus
`CONSUMED_BOUND` may only CAS to `PUBLISHING`, publish/read back the gate's
precomputed fence, CAS to `PUBLISHED`, terminalize as `TERMINAL_HANDOFF`, exit, archive,
and remove its pointer before normal fence-backed recovery begins.
`ABORTING` never attaches authorization and receives no broker client in either
authorization state. A CAS from `PENDING` to `ABORTING` retains the observed
publication discriminator. `NOT_PUBLISHED` proves fence absence. `PUBLISHING`
accepts only fence absence or the exact precomputed fence; the shim idempotently
creates/read-backs that exact fence when absent, then CASes `PUBLISHED`.
`PUBLISHED` requires that exact fence. The shim proves/removes the
exact staged bytes and terminalizes/cleans any pre-fence or fence-backed child;
either source reaches `TERMINAL_ABORTED`, archive, and pointer removal before the broker-
internal reconciler compare-and-removes the bound pending admission, then
revokes from the gate and absence proof. Any exact fence present under
`PUBLISHED` remains through revocation before the shim removes it and CASes
publication to `CLEARED`. Thus abort that wins at `NOT_PUBLISHED` creates no
fence, while a prior winning `PUBLISHING` CAS always completes the exact fence
before cleanup. Wrong/ambiguous fence state refuses. If `ACTIVATING` won first,
the abort CAS refuses and the fence-backed chain continues forward even while
the active record still names N.
Missing/wrong publication state, live/ambiguous original owner, simultaneous
gate/fence sources, or any project operation from the gate-bound continuation
refuses.

Completed or aborted cleanup is create-once at
`<state-root>/installation/activation-cleanup-gates/<transaction>.json` as
`activation-cleanup-gate-archive/v1`, binding the entire gate transition chain,
authorization revocation, mode-specific terminal/abort proofs, active-record
digest, and prior cleanup-head digest. The cleaner reads it back, CAS-updates
canonical `<state-root>/installation/activation-cleanup-head.json`
(`activation-cleanup-head/v1`) to that transaction/archive path/digest, then
CAS-removes the canonical gate. Every active-release record binds its activation
cleanup transaction and deterministic archive path; the shim always validates
the canonical head and linked archive chain against the current active record
before ordinary launch. A later aborted transaction may advance the head while
explicitly retaining that same active-record digest.

Malformed, moved, mismatched, missing-when-required, unknown, complete-but-
unarchived, missing/substituted/ambiguous head or archive state blocks ordinary
start. A later transaction requires the canonical gate absent and cannot
overwrite another transaction's archive. For both attached and null-launch
handoffs, gate archive/head/removal is the last activation cleanup and is
required before an ordinary successor tick.

## Windows Task Scheduler

- User-scoped task name: `OrchestrationPlatform-<installation-id>`.
- Triggers: current-user logon and a five-minute repetition with indefinite
  duration; `StartWhenAvailable=true`.
- Principal: exact declared user SID, `InteractiveToken`, least privilege,
  `RunLevel=LeastPrivilege`.
- Settings: `MultipleInstancesPolicy=IgnoreNew`, execution limit 30 minutes,
  battery/network defaults explicitly serialized rather than inherited.
- Action: `Exec` with exact executable and Windows-quoted arguments generated
  from the canonical array; project root is the working directory.
- Install/verify/uninstall uses Task Scheduler COM/native API, not PowerShell.

## macOS LaunchAgent

- User LaunchAgent label/file:
  `dev.orchestration-platform.<installation-id>` under the user's LaunchAgents.
- `ProgramArguments` is the canonical array; no `Program`/shell string.
- `RunAtLoad=true`, `StartInterval=300`, `KeepAlive=false`,
  `ProcessType=Background`, project-root `WorkingDirectory`.
- stdout/stderr files live under the state root and are non-authoritative.
- Install/verify/uninstall uses `launchctl bootstrap/print/bootout` for the exact
  user GUI domain and label.

## Linux systemd user service/timer

- Exact units:
  `orchestration-platform-<installation-id>.service` and `.timer` under the user
  configuration directory.
- Service: `Type=oneshot`, exact escaped `ExecStart`, project-root
  `WorkingDirectory`, `NoNewPrivileges=true`, 30-minute timeout.
- Timer: `OnStartupSec=0`, `OnUnitActiveSec=5min`, `Persistent=true`, exact unit,
  and install target `timers.target`.
- Install/verify/uninstall uses `systemctl --user daemon-reload`, enable/start,
  show/cat, disable/stop, and exact-unit absence checks. Linger is neither enabled
  nor required; re-entry occurs when the user's systemd manager starts.

## Install and removal transaction

`supervisor plan` emits exact target bytes/identities and current predecessor
census without mutation. `install` requires the fresh plan digest, writes one
definition transaction, invokes native registration, reads back semantic/native
state, then commits the installation receipt. Interruption resumes the same
transaction.

The N0 install writes the installation-scoped shim and native definition once.
Successor promotion does not rewrite OS scheduler definitions. Stable N stages
N+1 bytes, verifies `supervisor-shim/v1` compatibility, and prepares a canonical
next active-release record. The atomic durable replace of
`installation/active-release.json` is the sole activation point: before it, the
shim launches N; after it, the shim launches only N+1. A crash before activation
removes/ignores staged state and retains N; a crash after activation permits
only the same predecessor-owned forward-recovery transaction, relaunched by the
shim as specified above when necessary, including broker
authority activation, before the next ordinary tick. The shim refuses scheduled
start while the fence exists. Promotion records an immutable successor-
verification `follow-up-cycle-request/v1`; N0 then completes routine steps 14
and 15. Step 15 writes the terminal N0 cycle receipt and clears the fence under
the same transaction; a crash between those writes leaves the fence present and
recovery clears it only after read-back of the exact terminal receipt. N0's tick
then exits. The next scheduler-authenticated shim tick launches N1 and runs the
verification follow-up as cycle five; the following independent scheduler tick
must again launch the same N1 digest and produce steady-state evidence.

`uninstall` first disables future starts, fences a live/unknown tick, observes or
terminates the exact tick/process tree, removes native registration/files, and
commits absence plus credential/process census. Moved definitions, user/SID
changes, duplicate native entries, or unknown tick state refuse overwrite or
eligibility.

# Cross-platform supervisor installation contract

The supervisor is user-scoped. “Cold-host re-entry” means the first eligible
session for the declared user after reboot; system/root services and unattended
pre-login execution are outside this contract.

Every native definition binds one absolute Node 24 executable, one immutable
installation-scoped supervisor shim, their byte digests, project/state roots,
UUIDv7 installation identity, shim ABI, and one exact native argument vector.
No shell interprets the vector. The scheduler invokes every five minutes; the
state-mutation protocol below is the final overlap and mutation authority.

## State mutation trust and epoch fence

All authority-bearing pointer writes use the fixed non-symlink regular file
`<state-root>/installation/state-mutation.lock`. Its bytes, timestamps, PID,
age, and owner-written metadata grant no authority. A writer must hold the
kernel-exclusive handle under the exact OS lock profile/helper/custody bound by
the selected `STATE_MUTATION_AUTHORITY_ROTATION` pointer at
`installation/state-mutation-authority.json`.

The selected authority value binds installation/project/state identities,
helper executable/path/digest, state-component profile, ABI
`portable-state-cas/v2`, lock profile/helper, custody principal/ACL receipt,
handle-inheritance policy, the reviewed active-release `Dt/Dv/Dr`, and its
predecessor authority triple. Bootstrap genesis and exact-byte reinstall belong
only to the independently reviewed
bootstrap path. A selected stable predecessor performs forward rotation after
the new active release and independent review are selected; candidate or new
helper bytes never authorize themselves. The old helper holds the lock through
rotation selection/read-back and releases it before the new helper may use its
private capability.

Rollback is another independently reviewed forward rotation from the currently
selected epoch; restoring an old tip or capability refuses. Reinstall accepts
only exact selected bytes/custody under the reviewed-bootstrap transaction and
cannot create a parallel genesis.

Only the private, non-serializable state-mutation capability issued for the
selected authority epoch may write pointer values, proposals, conflicts, tips,
tombstones, or retention state. Receipts do not authenticate writers by
themselves; authority is canonical state-root custody, the private capability,
kernel exclusion, and selected exact bytes. If the required OS guarantee is not
proven by `ISS-022`, mutation is unsupported and no timeout, PID, lease, stale
age, or unsigned lock fallback is permitted.

An ordinary commit acquires the lock before observing authority, validates the
selected authority/capability/custody, reconciles the target proposal bucket,
writes/read-backs the deterministic value and proposal, re-reads the same
authority, CASes/read-backs the target tip, resolves proposal classification,
re-reads the same authority, then releases. `lockOperationId` is advisory only
and is excluded from every digest and decision.

Rotation acquires the same lock before observation. Under the old selected
capability it validates the selected new active release/review/helper/custody,
then performs a complete census of all other pointer kinds. Pending proposals
are deterministically completed under the old authority in registry/Dp/
predecessor/mutation order; a proposal becomes lost only after an actual
different winner is selected. Rotation requires zero `PENDING` and zero
`UNKNOWN`, selects/read-backs the new authority, and releases. Kernel owner
death releases the lock. A crash before authority selection resumes the old
epoch; a crash after selection resumes the new epoch. No target transition may
span both.

## Pointer value, proposal, tip, and conflict graph

All pointers use the exact framing function `F`: UTF-8 platform domain, NUL,
domain tag, NUL, unsigned 32-bit part count, then for each part its closed type
tag, unsigned 64-bit length, and bytes. Embedded digests are raw 32 bytes;
nullable raw digests use the closed null-part tag rather than text.

All pointers use an acyclic framed digest graph:

- `Dv` hashes the immutable family value under `pointer-value/v2`;
- `Dr` uses domain `pointer-receipt/v2` over the canonical pre-CAS
  `pointer-cas-proposal-receipt/v1` and its bound parts;
- `Dt` uses domain `pointer-tip/v2` over canonical
  `pointer-current-tip/v1` and its selected `Dv+Dr`.

Framing uses the platform domain, NUL-delimited tag, part count, typed
length-prefixed parts, raw 32-byte digests, and canonical JSON bytes. Values
never contain the proposal or tip that selects them.

The digest domains are closed and exact:

| Digest | Domain tag | Framed identifying parts |
| --- | --- | --- |
| `Dv` | `pointer-value/v2` | pointer-kind text, path-instance digest raw32, canonical value bytes |
| `Dr` | `pointer-receipt/v2` | pointer-kind text, path-instance digest raw32, mutation ID raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, position digest raw32, intent/outcome text, canonical `pointer-cas-proposal-receipt/v1` bytes |
| `Dt` | `pointer-tip/v2` | pointer-kind text, path-instance digest raw32, `Dv` raw32, `Dr` raw32, canonical `pointer-current-tip/v1` bytes |
| `Dp` | `pointer-instance/v2` | kind, canonical path, installation/project/state, transaction, source |
| mutation ID | `pointer-mutation-id/v2` | pointer kind, canonical path, `Dp` raw32, transaction ID/null, source token, position digest raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, outcome/intent |
| `Dc` | `pointer-conflict-receipt/v1` | `Dp` raw32, mutation ID raw32, losing `Dr/Dv`, observed winning `Dt/Dv/Dr`, conflict kind, selected authority epoch triple, conflict time, canonical create-once conflict bytes |
| accumulator first | `recovery-attempt-accumulator/v1` + byte `0x00` | raw terminal-summary digest |
| accumulator later | `recovery-attempt-accumulator/v1` + byte `0x01` | raw prior accumulator-value digest, raw terminal-summary digest |

The closed authority schemas are `pointer-current-tip/v1`,
`pointer-cas-proposal-receipt/v1`, `pointer-conflict-receipt/v1`,
`pointer-tombstone-value/v1`,
`active-release/v2`, `activation-cleanup-gate-root/v2`,
`activation-cleanup-gate-head/v2`, `activation-recovery-fence-root/v2`,
`activation-recovery-fence-head/v2`, `activation-recovery-launch/v2`,
`recovery-attempt-reservation/v1`, `recovery-attempt-descriptor/v1`,
`recovery-attempt-terminal-summary/v1`, `recovery-attempt-accumulator/v1`,
`activation-cleanup-archive-head/v2`, `authority-retention/v1`, and
`state-mutation-authority-value/v1`. Authorization schemas are closed in
`credential-broker.md`. Any old affected v1 authority schema is diagnostic only.

The pointer-instance digest binds kind, canonical pointer path, installation,
project, state-root digest, transaction, and the closed source token. The
deterministic mutation ID additionally binds position, prior triple, successor
`Dv`, and proposed outcome. Storage is:

```text
installation/pointer-cas/<instance-digest>/values/<mutation-id>.json
installation/pointer-cas/<instance-digest>/proposals/<prior-tip-or-genesis>/<mutation-id>.json
installation/pointer-cas/<instance-digest>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json
installation/pointer-cas/<instance-digest>/retention.json
```

Proposal intent is `VALUE_PROPOSED` or `TOMBSTONE_PROPOSED`. Its create-once
timestamp is reused byte-for-byte on retry. Classification is exactly
`PENDING`, `SELECTED`, `LOST_CONFLICT`, `COMPACTED`, or `UNKNOWN`. A conflict
receipt is valid only after it binds an actually observed winning canonical
triple. Malformed, contradictory, skipped, or fake-lost evidence is `UNKNOWN`.

A crash may leave a durable value/proposal before tip selection. It remains
`PENDING`; the next lock holder enumerates the deterministic predecessor bucket,
revalidates identical create-once bytes, and performs the real CAS or observes a
real winner. It never infers loss from age or manufactures a conflict. Census
includes every value, proposal, conflict, tip, archive, tombstone, and retention
record; an orphan value is retained until its proposal is classified, and an
orphan/malformed proposal is `UNKNOWN`. Selected and lost evidence is retained
until an authorized retention transition classifies it `COMPACTED`.

The closed pointer kinds are:

1. active release;
2. activation cleanup gate;
3. activation recovery fence;
4. activation recovery launch;
5. recovery authorization state;
6. recovery authorization attachment;
7. recovery attempt accumulator;
8. activation cleanup archive head;
9. authority retention;
10. recovery attempt reservation;
11. state mutation authority rotation.

The registry maps every kind to one exact canonical path constructor, permitted
value schemas, source tokens, roots, archives, and genesis rule. Unknown or
cross-family paths, schemas, tokens, encodings, case variants, or storage files
refuse. The only launch source tokens are `recovery-fence-v2` and
`cleanup-gate-pre-fence-v2`; every other pointer uses `none`.

The canonical authority-path census is closed:

| Pointer kind | Canonical tip path family |
| --- | --- |
| `ACTIVE_RELEASE` | `installation/active-release.json` |
| `ACTIVATION_CLEANUP_GATE` | `installation/activation-cleanup-gate.json` |
| `ACTIVATION_RECOVERY_FENCE` | `installation/activation-recovery-fence.json` |
| `ACTIVATION_RECOVERY_LAUNCH` | `installation/activation-recovery-launches/<transaction>/<source>/current.json` |
| `RECOVERY_AUTHORIZATION_STATE` | `installation/recovery-authorizations/<transaction>/state.json` |
| `RECOVERY_AUTHORIZATION_ATTACHMENT` | `installation/recovery-authorizations/<transaction>/attachment.json` |
| `RECOVERY_ATTEMPT_ACCUMULATOR` | `installation/activation-recovery-launches/<transaction>/<source>/accumulator.json` |
| `ACTIVATION_CLEANUP_ARCHIVE_HEAD` | `installation/activation-cleanup/archive-head.json` |
| `AUTHORITY_RETENTION` | `installation/authority-retention/<pointer-instance-digest>.json` |
| `RECOVERY_ATTEMPT_RESERVATION` | `installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json` |
| `STATE_MUTATION_AUTHORITY_ROTATION` | `installation/state-mutation-authority.json` |

Path components use the canonical contract path grammar and lowercase digest or
UUID text where declared. `predecessor-key` is the framed digest of the exact
predecessor accumulator `Dt/Dv/Dr`, or the tagged genesis value. The path census
walks every authority family and proposal bucket; uncatalogued files, duplicate
instances, missing selected tips, and old v1 records at current paths are
`UNKNOWN`. v1 remains readable only as historical diagnostic evidence.

## Tombstones and archives

There is no bare-absence authority after a pointer's first selection. Terminal
cleanup first writes/read-backs the family archive, then selects a durable
`REMOVED` tombstone value binding the prior triple, archive, and terminal proof.
The canonical tip remains. A later transaction CASes from that tombstone; it
never recreates from filesystem absence. A crash before tombstone selection
leaves the prior value authoritative; a crash after selection resumes from the
selected tombstone.

Cleanup-gate, recovery-fence, recovery-launch, authorization, and active-release
uninstall each retain their exact archive/revoke/uninstall record. The cleanup
archive head advances through the same pointer protocol and never scans.

## Gate and fence authority

Cleanup gate and recovery fence roots are immutable transaction records.
Their immutable heads retain the closed lifecycle/publication or fence-state
transition facts. Their canonical paths now hold generic selected tips whose
family values name the exact root/head. Initialization writes root and ordinal
zero head, then selects the genesis current value under the epoch lock.

Cleanup gate admissible pairs are exactly:

- `PENDING`: `NOT_PUBLISHED`, `PUBLISHING`, or `PUBLISHED`;
- `ACTIVATING`: `PUBLISHED`;
- `ABORTING`: all four publication states;
- `COMPLETE`: `NOT_PUBLISHED` or `CLEARED`.

The only mutation edges are PN→PI, PN→BN, PN→CN, PI→PP, PI→BI, PP→AP,
PP→BP, AP→CC, BN→CN, BI→BP, BP→BC, and BC→CC. Crash resume at an already
selected pair is `NO_APPEND`; it never writes a self-loop head.

Fence initialization is `PREPARED`; the only later state is
`POST_ACTIVATION`. Gate/fence values, proposals, receipts, and tips bind exact
root/head path, digest, ordinal, identities, and selected authority epoch. A
live launch must acknowledge an adjacent head through a launch state
`AUTHORITY_REBIND` before a second authority-head mutation may proceed.

## Recovery attempts and launch authority

Attempt order is cryptographic, not numeric. The supervisor requests the
`RECOVERY_ATTEMPT_RESERVATION` pointer keyed by transaction/source and the
predecessor accumulator triple (or tagged genesis). One competing proposal
selects a random UUIDv7 `attemptId`; UUID time is never ordering authority.
Reservation lifecycle is RESERVED→CONSUMED→TERMINAL→TOMBSTONE.

The selected reservation binds immutable descriptor inputs. The attempt writes
states under:

```text
installation/activation-recovery-launches/<transaction>/<source>/attempts/<attempt-id>/<ordinal>-<lifecycle>.json
```

A `recovery-attempt-descriptor/v1` is `READY_ONLY` or `LIVE`; LIVE binds the
READY and initial-LIVE records plus process tree/start identity. Attachment is
valid only for LIVE. A later terminal summary is distinct: it binds descriptor,
optional selected attachment, terminal state/lineage, exit/absence and channel
denial proofs. It cannot retroactively authorize attachment.

The attempt accumulator has exact `IN_PROGRESS` and `TERMINAL` values. First
IN_PROGRESS binds the selected reservation/descriptor and no terminal summary.
Later IN_PROGRESS binds the prior terminal accumulator triple/summary.
TERMINAL binds the same descriptor and new terminal summary. The rolling digest
uses the tagged first-summary formula or tagged prior-accumulator-`Dv` plus
summary formula. It contains no lifetime array or numeric generation cap.

Every broker/supervisor call verifies a bounded packet: selected authority and
lock facts, gate/fence tip/value/proposal, launch tip/value/proposal, reservation,
descriptor, attachment, accumulator, READY/initial LIVE, and at most the latest
terminal summary. Older history remains linked for audit but is not rescanned
for mutation authority.

Pre-fence source may consume the narrowed recovery capability and publish the
precomputed fence, but never attaches authorization. It terminalizes, archives,
and tombstones before the fresh fence-backed source reserves its first attempt.
Abort admits no broker client and terminalizes the exact source before broker
revocation. Fence-backed completion selects terminal launch state before fence
clear, then archives/tombstones after child exit and authorization revoke.

## Retention and degraded audit

Active release, cleanup head/gate, fence, authorization records, authority
rotation, current tips, and current proposals are `FULL_REQUIRED`. Only terminal
launch/attempt history may use `TERMINAL_CHECKPOINT_ALLOWED`. Authorized
compaction selects checkpoint, exact deletion plan, verified deletion receipt,
and completion through the retention pointer. Pending proposals are never
compacted.

Unexpected old loss is forward-nonblocking only after a selected terminal
checkpoint/tombstone and only as durable `AUDIT_DEGRADED`. Existing transaction
recovery/retry/cleanup, selected attachment calls, and ordinary non-release
ticks may continue. New bootstrap/promotion, certification, unrelated
authorization/attachment, compaction, and audit finalization refuse.
Loss under `FULL_REQUIRED` or before checkpoint is `UNKNOWN` and blocks all
mutation/start.

## Native scheduler definitions

All three definitions bind the canonical argv, executable/shim digests,
installation/project/state identities, and exact declared user. Generated files
contain no credential or token. Native overlap settings are defense in depth;
the epoch-fenced state protocol is final authority.

### Windows Task Scheduler

- User task `OrchestrationPlatform-<installation-id>` triggers at current-user
  logon and every five minutes with `StartWhenAvailable=true`.
- Principal is the exact user SID with `InteractiveToken` and least privilege;
  `MultipleInstancesPolicy=IgnoreNew` and a 30-minute execution limit are
  explicit.
- The action uses the exact executable plus Windows-quoted canonical arguments,
  with the project root as working directory. COM/native APIs perform install,
  verify, and removal; PowerShell is not authority.

### macOS LaunchAgent

- User LaunchAgent `dev.orchestration-platform.<installation-id>` uses exact
  `ProgramArguments`, `RunAtLoad=true`, `StartInterval=300`, `KeepAlive=false`,
  `ProcessType=Background`, and the project-root working directory.
- `launchctl bootstrap/print/bootout` operates on the exact GUI user domain and
  label. State-root stdout/stderr files are advisory.

### Linux systemd user service/timer

- Exact `.service`/`.timer` units are installation-scoped in the user
  configuration directory. The oneshot service has exact escaped `ExecStart`,
  project-root working directory, `NoNewPrivileges=true`, and a 30-minute limit.
- The timer uses `OnStartupSec=0`, `OnUnitActiveSec=5min`, `Persistent=true`,
  and `timers.target`. Install/verify/removal uses `systemctl --user`; linger is
  neither enabled nor required.

## Install and removal transaction

`supervisor plan` is non-mutating and binds exact target bytes/identities and
current census. Install accepts only its fresh digest, writes one transaction,
registers native state, reads it back, then selects the installation receipt.
An interruption resumes the same transaction.

N0 writes the immutable installation shim/native definition once. Successor
promotion never rewrites them; it selects `ACTIVE_RELEASE` through the common
pointer protocol, then completes broker activation and terminal recovery while
the fence blocks ordinary ticks. The next tick runs the selected successor
verification request and the following tick supplies independent steady-state
evidence.

Uninstall first disables starts, fences live/unknown work, proves or terminates
the exact process tree, archives release/authorization/cleanup evidence, selects
the active-release tombstone, removes the exact native registration/files, and
commits absence/custody/process receipts. The canonical selected tombstone and
archive remain authority. Moved definitions, changed user identity, duplicates,
pending/unknown proposals, or unknown process state refuse overwrite/removal.

## Ownership

`ISS-002` owns schemas and pure validators. `ISS-022` proves lock/custody/CAS
guarantees. `ISS-004` owns the private mutation capability and pointer protocol.
`ISS-014` produces active-release/gate/fence/cleanup transitions and requests
authority rotation. `ISS-030` owns reservation/launch/descriptor/summary/
accumulator behavior. `ISS-032` owns authorization and attachment production.
`ISS-020` owns reviewed-bootstrap genesis/reinstall. No worker, candidate,
adapter, or provider policy owns these mechanisms.

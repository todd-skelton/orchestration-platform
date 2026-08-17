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

All authority-bearing runtime pointer writes use the fixed non-symlink regular
file `<state-root>/installation/state-mutation.lock`. Its bytes, timestamps,
PID, age, and owner-written metadata grant no authority. A writer must hold the
kernel-exclusive handle under the exact OS lock/helper/custody facts bound by
the selected `STATE_MUTATION_AUTHORITY_ROTATION` tip at
`installation/state-mutation-authority.json`. If `ISS-022` cannot prove that
profile on a target, mutation is unsupported; timeout, PID, lease, stale age,
or unsigned lock bytes are never a fallback.

Receipts authenticate relationships, not writers. Runtime authority is the
combination of canonical state-root custody, the selected exact authority tip,
the kernel lock, and an ISS-004 private non-serializable capability. ISS-004 is
the sole in-process state service. It keeps current contexts, historical-read
handles, mutation-run handles, and producer projections in module-private
`WeakMap`s with live nonces. Constructors and nonces are not exported or
serialized. JSON, structured clone, worker/IPC transfer, proxying, copied
symbols, foreign service instances, lock release, process death, custody
movement, or authority rotation invalidate a handle. Consumers call the
in-process service; no filesystem/CAS primitive or generic capability is a
public API.

The service issues `VerifiedCurrentAuthorityContext` only while holding the
lock after it recomputes the canonical authority `Dp/Dv/Dr/Dt`, validates the
exact global installation/project/state/custody identity and either the E0
bootstrap branch or the En append branch described below, and reads back the
same selected bytes. It issues `VerifiedProducerEpochProjection` only from that
live context after a full walk of the hash-chained `authority-history/v1` log
selected by the context's exact current authority value. Serialized records
remain relative structural evidence; ISS-002 never labels them authority.

An ordinary mutation callback acquires the lock, creates a live context,
reconciles the deterministic proposal bucket, writes/read-backs value and
proposal, selects the run-current checkpoints below, rereads the same authority
before and after target CAS, resolves the proposal, revokes every handle, and
releases. `lockOperationId` is diagnostic only and excluded from every digest
and decision. Historical reads use a distinct bounded callback that exposes no
mutation method and revokes its handles before lock release.

Rotation holds the same lock under the old selected capability. It validates
the reviewed successor active release/helper/profile/ABI/custody, settles all
pending proposals among the other eleven pointer kinds in registry/`Dp`/
predecessor/mutation order, and requires zero unrelated `PENDING` or `UNKNOWN`.
It is an ordinary single-epoch commit run: it appends the exact
`authority-history/v1` chain record and then performs the authority CAS as its
final action, executes no checkpoint after that CAS under either epoch, and its
run-current journal legitimately rests at CAS-armed across the selection. After
authority CAS, every old handle is revoked. Terminal truth is derived from the
selected authority, exact chain head, and old CAS-armed checkpoint; no fresh
new-epoch run writes into the old run. Kernel owner death releases the lock. Before authority CAS the
old epoch remains current; after it the new epoch does. Rollback is another
independently reviewed forward rotation, never restored bytes or a stale
capability.

### External destination and E0 authority

Bootstrap ownership is selected outside the runtime root under the
ISS-022-admitted bootstrap-custody namespace. A stable
`physical-destination-identity/v1` binds only host/custody-root namespace, OS,
physical volume/filesystem, nearest stable existing non-symlink ancestor object,
and canonical physical leaf identity. It excludes helper/version, logical path,
case/Unicode profile, custody instance, receipt, and readback facts.

```text
Dphys = H(F("physical-destination-identity/v1", stable physical identity))
Ddest = H(F("bootstrap-destination-identity/v1", Dphys raw32))
```

The immutable identity is
`state-mutation-destination-identities/<Dphys>/identity.json`. Versioned
`physical-destination-locator-observation-receipt/v1` records live under
`.../<Dphys>/observations/<Dobs>.json` and bind `Dphys` to the admitted helper,
logical/resolved locator, case/Unicode profile, custody, native readbacks,
validity, and `ADMITTED|UNSUPPORTED|UNKNOWN` disposition. Multiple helpers or
profiles may produce different `Dobs` values for the same `Dphys`; the owner
key and lock do not move. Every owner transition requires a current admitted
observation under its lock.

```text
<bootstrap-custody-root>/state-mutation-destination-identities/<Dphys>/identity.json
<bootstrap-custody-root>/state-mutation-destination-identities/<Dphys>/observations/<Dobs>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/destination-owner.lock
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/current.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/values/<mutation-id>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/proposals/<prior-tip-or-genesis>/<mutation-id>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/teardown-archives/<owner-tip>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/successor-review-cores/<retired-tip>/<review-core-digest>.json
<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/successor-review-post-selection-receipts/<successor-tip>.json
```

`Dobs` uses `physical-destination-locator-observation-receipt/v1`; owner value,
proposal, tip, conflict, and mutation ID use the closed
`destination-owner-value/v1`, `destination-owner-receipt/v1`,
`destination-owner-tip/v1`, `destination-owner-conflict/v1`, and
`destination-owner-mutation-id/v1` domains. Their framed parts bind `Ddest`,
canonical path, prior triple/genesis, safe-integer-bounded owner ordinal,
transition, successor value, installation/anchor, and review/teardown evidence.

Every named digest in the following public tables is
`SHA256(F(domain, framed parts))`. The external identity/owner digests are exact:

| Digest | Schema/domain | Framed parts | Canonical path |
| --- | --- | --- | --- |
| `Dphys` | `physical-destination-identity/v1` | stable host/custody namespace raw32, OS, physical volume raw32, filesystem raw32, nearest stable non-symlink ancestor object raw32, leaf identity kind, canonical physical leaf bytes, canonical schema bytes | `state-mutation-destination-identities/<Dphys>/identity.json` |
| `Dobs` | `physical-destination-locator-observation-receipt/v1` | `Dphys` raw32, helper digest raw32, helper version text, logical-locator digest raw32, resolved-locator-readback digest raw32, case-comparison profile text, Unicode-normalization profile text, custody-instance digest raw32, custody-receipt digest raw32, native-identity-readback digest raw32, disposition text, canonical receipt bytes | `.../<Dphys>/observations/<Dobs>.json`; lock/time/validity remain fields inside canonical receipt bytes only |
| `Ddest` | `bootstrap-destination-identity/v1` | `Dphys` raw32 only | `state-mutation-destination-owners/<Ddest>/` |
| `Dov` | schema `state-mutation-destination-owner-value/v1`; domain `destination-owner-value/v1` | `Ddest` raw32, owner ordinal bounded decimal string, lifecycle, installation ID, anchor `Dba` raw32, canonical value bytes | `.../<Ddest>/values/<mutation-id>.json` |
| `Dor` | schema `state-mutation-destination-owner-cas-proposal/v1`; domain `destination-owner-receipt/v1` | `Ddest` raw32, mutation ID raw32, nullable prior `Dot` raw32, nullable prior `Dov` raw32, nullable prior `Dor` raw32, successor `Dov` raw32, transition text, position digest raw32, canonical proposal bytes | `.../<Ddest>/proposals/<prior-tip-or-genesis>/<mutation-id>.json` |
| `Dot` | schema `state-mutation-destination-owner-current-tip/v1`; domain `destination-owner-tip/v1` | `Ddest` raw32, `Dov` raw32, `Dor` raw32, canonical current-tip bytes | `.../<Ddest>/current.json` |
| `Doc` | schema `state-mutation-destination-owner-conflict-receipt/v1`; domain `destination-owner-conflict/v1` | `Ddest` raw32, mutation ID raw32, losing `Dor` raw32, losing `Dov` raw32, winning `Dot` raw32, winning `Dov` raw32, winning `Dor` raw32, canonical conflict bytes | `.../<Ddest>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json` |
| owner mutation ID | no record schema; domain `destination-owner-mutation-id/v1` | `Ddest` raw32, canonical current path text, nullable prior `Dot` raw32, nullable prior `Dov` raw32, nullable prior `Dor` raw32, owner ordinal bounded decimal string, transition text, successor `Dov` raw32, installation ID text, `Dba` raw32, source text, transition-evidence digest raw32 | selects the exact value/proposal path; timestamps/readbacks excluded |
| `Dsrc` | schema `state-mutation-destination-owner-successor-review-core/v1`; domain `destination-owner-successor-review-core/v1` | `Ddest` raw32, prior RETIRED `Dot` raw32, prior RETIRED `Dov` raw32, prior RETIRED `Dor` raw32, teardown-archive digest raw32, prior-installation canonical bytes, successor installation ID text, successor-authority canonical bytes, independent-review canonical bytes, canonical review-core bytes | `.../<Ddest>/successor-review-cores/<prior-retired-tip>/<Dsrc>.json`; excludes successor `Dba`, `Dov`, `Dor`, `Dot`, their readbacks, and `Dsrp` |
| `Dsrp` | schema `state-mutation-destination-owner-successor-review-post-selection-receipt/v1`; domain `destination-owner-successor-review-post-selection-receipt/v1` | `Dsrc` raw32, successor `Dba` raw32, successor `Dov` raw32, successor `Dor` raw32, successor `Dot` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, destination-lock/custody-observation digest raw32, canonical post-selection bytes | `.../<Ddest>/successor-review-post-selection-receipts/<successor-owner-tip>.json`; downstream and excluded from review core, anchor, and owner selection graph |

`physical-destination-identity/v1` excludes helper, path spelling, comparison
profile, custody instance, receipt, time, and readback. `Ddest` has no part other
than raw `Dphys`. Those changing observation/owner facts therefore cannot move
the destination lock. A successor review core excludes new `Dba` and the
successor owner graph; only its downstream post-selection receipt may bind them.

Exactly one FULL_REQUIRED destination-owner pointer and non-symlink
`destination-owner.lock` exist at
`<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/`. Its
generic value/proposal/conflict/retention storage and `current.json` use
`destination-owner-value/v1`, receipt, tip, and conflict domains. The owner
lifecycle is exactly `ACTIVE|CONSUMED|RETIRED` with edges
`ACTIVATE_GENESIS`, `CONSUME`, `RETIRE_UNUSED`, `RETIRE_CONSUMED`, and
`ACTIVATE_SUCCESSOR` (`RETIRED→ACTIVE`). The owner ordinal is a canonical
decimal string bounded by the safe-integer range. There is no bare absence
after genesis and
no deletion or degraded compaction of owner lineage.

A successor review is acyclic. The independently reviewed
`destination-owner-successor-review-core/v1` binds the prior selected RETIRED
triple/archive and intended successor facts but excludes the new anchor digest
and successor owner graph. The new anchor binds that review-core digest; the
successor ACTIVE owner value binds both. Only after selected owner-tip readback
does the installer create the non-embedded
`destination-owner-successor-review-post-selection-receipt/v1`. Anchor ACTIVE,
use intent, E0, and context issuance all refuse until that receipt is read back.
Crash after owner selection resumes the receipt without repeating owner CAS.

Lock order is destination-owner lock, installation-anchor lock, then runtime
state-mutation lock; release is reverse. Two installation IDs targeting one
physical destination therefore have one real winner. The loser retains an exact
`LOST_CONFLICT` proposal and cannot replay its grant or intent. A new owner is
legal only from the exact prior RETIRED triple, teardown archive, fresh anchor,
and independent successor review.

The per-installation external anchor has selected `ACTIVE|CONSUMED|RETIRED`
state. A create-once use intent, made while ACTIVE and unexpired, binds the
selected owner ACTIVE triple and exact bootstrap transaction before the first
runtime mutation. It permits only that transaction to finish after expiry.
Anchor CONSUMED binds the selected E0 graph; the destination owner then selects
CONSUMED; a downstream consumption receipt binds `Dba/Dbg/Dv/Dr/Dt/Dgp`, both
owner triples, both custody instances, transaction, and all readbacks. E0
context requires external anchor, selected owner CONSUMED, consumption receipt,
immutable E0 core, selected runtime E0, and runtime post-selection receipt.

The E0 graph is acyclic: external anchor → E0
`state-mutation-authority-value/v1`/`Dv` → immutable
`state-mutation-bootstrap-genesis-core/v1` →
`pointer-cas-proposal-receipt/v1`/`Dr` → tip/`Dt` → runtime post-selection
receipt. The core binds anchor, destination/owner, absence, E0 `Dv`, and the
genesis history record but excludes proposal/`Dr`/tip/`Dt`. E0's proposal producer is
`REVIEWED_BOOTSTRAP_GENESIS` with null selected epoch; every ordinary proposal
uses `SELECTED_EPOCH`. Anchor consumption occurs downstream of the runtime
post-selection receipt and introduces no cycle.

An expired ACTIVE anchor without a pre-expiry intent can only retire after
destination-absence proof. Partial mutation must reconcile the same intent.
Exact reinstall reuses selected owner/anchor CONSUMED and the original E0 graph;
it creates no genesis or new intent. RETIRED requires a new installation ID and
reviewed successor.

Anchor storage is canonical beneath
`<bootstrap-custody-root>/state-mutation-authority-anchors/<installation-id>/`:
`anchor.json`, `anchor.lock`, `current.json`, `use-intents/<transaction>.json`,
generic mutation-ID values and prior/genesis proposal/conflict buckets,
consumption/teardown receipts, and lifecycle archives. The closed domains are
`state-mutation-bootstrap-anchor/v1`, `bootstrap-anchor-value/v1`,
`bootstrap-anchor-receipt/v1`, `bootstrap-anchor-tip/v1`,
`bootstrap-anchor-conflict/v1`, `bootstrap-anchor-use-intent/v1`,
`bootstrap-anchor-consumption-receipt/v1`, and
`bootstrap-anchor-teardown-receipt/v1`.

The public anchor/E0 graph is exact:

| Digest | Schema/domain | Framed parts | Canonical path and exclusions |
| --- | --- | --- | --- |
| `Dba` | `state-mutation-bootstrap-anchor/v1` | `globalBootstrapIdentity` raw32, canonical anchor bytes | `state-mutation-authority-anchors/<installation>/anchor.json`; successor anchor binds review-core digest, never its post-selection receipt |
| `Dbav` | schema `state-mutation-bootstrap-anchor-lifecycle-value/v1`; domain `bootstrap-anchor-value/v1` | `Dba` raw32, lifecycle text, canonical lifecycle-value bytes | `.../<installation>/values/<mutation-id>.json`; selected value excludes proposal/receipt/tip/conflict |
| `Dbar` | schema `state-mutation-bootstrap-anchor-cas-proposal/v1`; domain `bootstrap-anchor-receipt/v1` | `Dba` raw32, mutation ID raw32, nullable prior `Dbat` raw32, nullable prior `Dbav` raw32, nullable prior `Dbar` raw32, successor `Dbav` raw32, transition text, canonical proposal bytes | `.../<installation>/proposals/<prior-tip-or-genesis>/<mutation-id>.json`; successor tip/readback excluded |
| `Dbat` | schema `state-mutation-bootstrap-anchor-current-tip/v1`; domain `bootstrap-anchor-tip/v1` | `Dba` raw32, `Dbav` raw32, `Dbar` raw32, canonical current-tip bytes | `.../<installation>/current.json` |
| `Dbac` | schema `state-mutation-bootstrap-anchor-conflict-receipt/v1`; domain `bootstrap-anchor-conflict/v1` | `Dba` raw32, mutation ID raw32, losing `Dbar` raw32, losing `Dbav` raw32, winning `Dbat` raw32, winning `Dbav` raw32, winning `Dbar` raw32, canonical conflict bytes | `.../<installation>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json`; requires an actual different selected winner |
| anchor use intent | schema `state-mutation-bootstrap-anchor-use-intent/v1`; domain `bootstrap-anchor-use-intent/v1` | `Dba` raw32, selected ACTIVE `Dbat` raw32, selected ACTIVE `Dbav` raw32, selected ACTIVE `Dbar` raw32, bootstrap transaction text, destination-state-root digest raw32, custody-instance digest raw32, proposed-genesis-input canonical bytes, expected E0 `Dv` raw32, reviewed-installer/helper canonical bytes, started-at text, expires-at text, canonical use-intent bytes | `.../<installation>/use-intents/<transaction>.json`; E0 proposal/`Dr`/tip/`Dt`/readbacks excluded |
| `Dbg` | `state-mutation-bootstrap-genesis-core/v1` | `Dba` raw32, global-identity digest raw32, transaction text, authority `Dp` raw32, E0 `Dv` raw32, genesis-position digest raw32, canonical core bytes | `installation/bootstrap/state-mutation-authority-genesis/<transaction>/core.json`; excludes proposal bytes, `Dr`, tip bytes, `Dt`, readbacks, and both post-selection receipts |
| `Dgp` | `state-mutation-bootstrap-genesis-post-selection-receipt/v1` | `Dba` raw32, `Dbg` raw32, authority `Dp` raw32, `Dv` raw32, `Dr` raw32, `Dt` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, canonical receipt bytes | `installation/bootstrap/state-mutation-authority-genesis/<transaction>/post-selection-receipt.json`; downstream and excluded from E0 value/core/proposal/tip |
| anchor consumption | schema `state-mutation-bootstrap-anchor-consumption-receipt/v1`; domain `bootstrap-anchor-consumption-receipt/v1` | `Dba` raw32, `Dbg` raw32, authority `Dp` raw32, `Dv` raw32, `Dr` raw32, `Dt` raw32, `Dgp` raw32, bootstrap transaction text, use-intent digest raw32, destination-state-root digest raw32, custody-instance digest raw32, runtime value-readback digest raw32, runtime proposal-readback digest raw32, runtime tip-readback digest raw32, runtime post-readback digest raw32, owner ACTIVE `Dot` raw32, owner ACTIVE `Dov` raw32, owner ACTIVE `Dor` raw32, owner CONSUMED `Dot` raw32, owner CONSUMED `Dov` raw32, owner CONSUMED `Dor` raw32, external anchor value-readback digest raw32, external anchor proposal-readback digest raw32, external anchor tip-readback digest raw32, external/runtime lock-helper-custody digest raw32, consumption-time text, canonical receipt bytes | `.../<installation>/consumption-receipts/<mutation-id>.json`; excluded from E0 and selected anchor CONSUMED graph |
| anchor teardown | schema `state-mutation-bootstrap-anchor-teardown-receipt/v1`; domain `bootstrap-anchor-teardown-receipt/v1` | `Dba` raw32, selected prior `Dbat` raw32, selected prior `Dbav` raw32, selected prior `Dbar` raw32, retirement transition text, `Ddest` raw32, selected owner `Dot` raw32, selected owner `Dov` raw32, selected owner `Dor` raw32, teardown-evidence digest raw32, process/custody-proof digest raw32, external archive digest raw32, canonical teardown-receipt bytes | `.../<installation>/teardown-receipts/<mutation-id>.json`; cannot authorize ACTIVE or CONSUMED |

Thus `Dba→E0 value/Dv→Dbg→proposal/Dr→tip/Dt→Dgp→anchor CONSUMED→owner
CONSUMED→external consumption receipt` is one-way. ACTIVE use intent is
create-once, binds selected owner/anchor ACTIVE and expiry, and contains no E0
selection result.

`globalBootstrapIdentity` is the exact raw32 projection selected by the external
reviewed-bootstrap anchor over its installation/project/destination/custody,
transaction, installer/review/grant, authority-path, lock/profile/helper/ABI,
and custody-receipt fields. Those fields remain closed in the canonical anchor
schema; `Dba` does not reframe them as additional top-level parts.

### Authority history and epoch validation

`state-mutation-authority-value/v1` binds the exact helper/profile/ABI/lock/
custody facts, reviewed active release, predecessor authority triple, authority
ordinal, and the selected `authority-history/v1` `headOrdinal` and
`headRecordDigest`. Ordinals and counts are canonical nonnegative decimal
strings bounded by `Number.MAX_SAFE_INTEGER`; grammar plus string length and
lexicographic comparison prove the bound before conversion. A value above the
bound refuses without reaching `Number`. E0 has ordinal `"0"`, a null authority
predecessor, and the genesis chain record as its selected head.

Runtime pointer history is one hash-chained, append-only `authority-history/v1`
log whose record is a closed union:

- `GENESIS` has ordinal `"0"`, the literal genesis predecessor, admitted
  external-bootstrap facts and successor core facts, and no retiring epoch.
- `ROTATION` has ordinal greater than zero, the exact preceding record digest,
  retiring epoch `Dp/Dt/Dv/Dr`, deterministic independently reviewed rotation
  identity, and successor core facts.

Both branches exclude the successor authority value, proposal, tip, and
selected head. For En, the old selected capability appends the `ROTATION`
record before the authority CAS. Rotation identity excludes generated
timestamps and binds global identity, predecessor triple/ordinal, successor
ordinal, selected active release, and reviewed successor
helper/profile/ABI/custody.

History uses FULL_REQUIRED content-addressed records at canonical
ordinal-derived paths beneath
`installation/state-mutation-authority-history/`. No history deletion,
compaction, or `AUDIT_DEGRADED` authority exists. The current selected
authority is trusted only through the live custody context; historical
producer projections derive from the selected authority value and the fully
walked chain. A stale head or projection refuses after rotation.

```text
installation/state-mutation-authority-history/records/<ordinal>.json
```

The walk constructs the path of record `n+1` from `n` and never enumerates a
directory. Verification walks the complete chain from genesis and compares the
selected head ordinal and record digest. A missing record at or below the head
refuses; the path at head plus one must be absent or match the armed rotation
intent; the path at head plus two must be absent; a file outside the canonical
ordinal paths carries no authority. Missing, forked, reordered, truncated, or
digest-mismatched chains refuse. Rotation occurs at most a few times per
release, so the deliberately O(n) full walk is bounded in practice; no membership proof, sparse
tree, secondary node inventory, or authenticated directory census exists.
Chain-record set completeness is proven by the walk alone; records are
ordinary content-addressed files and no materialization coordinator exists.

The exact history domains are `state-mutation-global-identity/v1`,
`state-mutation-authority-rotation-id/v1`, and `authority-history/v1`:

| Digest | Domain and framed parts | Canonical path/exclusion |
| --- | --- | --- |
| `G` | `state-mutation-global-identity/v1`: installation ID text, project ID text, state-root digest raw32, custody-instance digest raw32, canonical authority path text, authority `Dp` raw32 | lifetime-stable for one installation; helper digest/profile, lock profile, state-component profile, and ABI are deliberately excluded and remain rotation-bound authority-value facts; cross-install roots refuse |
| rotation ID | `state-mutation-authority-rotation-id/v1`: `G` raw32, old authority `Dp/Dt/Dv/Dr` raw32, successor ordinal bounded decimal string, reviewed-successor-subject digest raw32, independent-review digest raw32, rotation-operation-identity digest raw32 | derived identity with no record path; excludes successor `Dv/Dr/Dt` and timestamps |
| record digest | `authority-history/v1`: closed `GENESIS|ROTATION` discriminator, `G` raw32, bounded decimal ordinal, literal genesis predecessor plus external-bootstrap facts and no retiring epoch for `GENESIS`; exact prior record raw32 plus retiring `Dp/Dt/Dv/Dr` and reviewed rotation identity for `ROTATION`; successor core facts and canonical record bytes for both | `.../records/<ordinal>.json`; successor value/proposal/tip and selected head excluded |

`state-mutation-authority-value/v1` binds the head ordinal and record digest
without containing the record's selecting proposal or tip, so neither append
nor selection digest is cyclic. Current authority dispatch is `v1` for every
family; superseded pre-deployment generations are deleted from the contracts
package and its tests, and no diagnostic or archive namespace exists.

## Pointer value, proposal, tip, and conflict graph

All pointers use the exact framing function `F`: UTF-8 platform domain, NUL,
domain tag, NUL, unsigned 32-bit part count, then for each part its closed type
tag, unsigned 64-bit length, and bytes. Embedded digests are raw 32 bytes;
nullable raw digests use the closed null-part tag rather than text.

All pointers use an acyclic framed digest graph:

- `Dv` hashes the immutable family value under `pointer-value/v1`;
- `Dr` uses domain `pointer-receipt/v1` over the canonical pre-CAS
  `pointer-cas-proposal-receipt/v1` and its closed bootstrap/selected producer
  union;
- `Dt` uses domain `pointer-tip/v1` over canonical
  `pointer-current-tip/v1` and its selected `Dv+Dr`.

Framing uses the platform domain, NUL-delimited tag, part count, typed
length-prefixed parts, raw 32-byte digests, and canonical JSON bytes. Values
never contain the proposal or tip that selects them.

The digest domains are closed and exact:

| Digest | Domain tag | Framed identifying parts |
| --- | --- | --- |
| `Dv` | `pointer-value/v1` | pointer-kind text, path-instance digest raw32, canonical value bytes |
| `Dr` | `pointer-receipt/v1` | pointer-kind text, path-instance digest raw32, mutation ID raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, position digest raw32, intent/outcome text, canonical `pointer-cas-proposal-receipt/v1` bytes |
| `Dt` | `pointer-tip/v1` | pointer-kind text, path-instance digest raw32, `Dv` raw32, `Dr` raw32, canonical `pointer-current-tip/v1` bytes |
| `Dp` | `pointer-instance/v1` | kind, canonical path, installation/project/state, transaction, source |
| mutation ID | `pointer-mutation-id/v1` | pointer kind, canonical path, `Dp` raw32, transaction ID/null, source token, position digest raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, outcome/intent |
| `Dc` | `pointer-conflict-receipt/v1` | `Dp` raw32, mutation ID raw32, losing `Dr/Dv`, observed winning `Dt/Dv/Dr`, conflict kind, selected authority epoch triple, conflict time, canonical create-once conflict bytes |
| attempt-log genesis | `attempt-log/v1` + byte `0x00` | record ordinal `"0"`, canonical record bytes |
| attempt-log later | `attempt-log/v1` + byte `0x01` | raw predecessor record digest, record ordinal, canonical record bytes |

`F` additionally has a bounded decimal-string part for canonical nonnegative
decimal strings (`"0"|[1-9][0-9]*`) bounded by the JavaScript safe-integer
range. Grammar, length, and lexicographic comparison against
`Number.MAX_SAFE_INTEGER` occur before conversion; a larger value refuses.
Authority/history/run ordinals and counts never use JSON numbers or JavaScript
`Number`, and no arbitrary-precision numeric type exists.

The closed authority schemas include `pointer-current-tip/v1`,
`pointer-cas-proposal-receipt/v1`, `pointer-conflict-receipt/v1`,
`pointer-tombstone-value/v1`,
`active-release/v1`, `activation-cleanup-gate-root/v1`,
`activation-cleanup-gate-head/v1`, `activation-recovery-fence-root/v1`,
`activation-recovery-fence-head/v1`, `activation-recovery-launch/v1`,
`recovery-attempt-reservation/v1`, `recovery-attempt-descriptor/v1`,
`attempt-log/v1`,
`activation-cleanup-archive-head/v1`, `authority-retention/v1`,
`state-mutation-authority-value/v1`, the authority-history/bootstrap-owner
schemas above, `pointer-mutation-run-checkpoint-core/v1`,
`pointer-mutation-run-current-value/v1`, and
`pointer-mutation-run-selector-post-selection-observation/v1`. Authorization
schemas are closed in `credential-broker.md`. Superseded pre-deployment
generations are deleted from the contracts package and its tests; the current
census is `v1` for every family.

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

The closed runtime pointer kinds are exactly:

1. active release;
2. activation cleanup gate;
3. activation recovery fence;
4. activation recovery launch;
5. recovery authorization state;
6. recovery authorization attachment;
7. recovery attempt log;
8. activation cleanup archive head;
9. authority retention;
10. recovery attempt reservation;
11. state mutation authority rotation;
12. pointer mutation run current.

The registry maps every kind to one exact canonical path constructor, permitted
value schemas, source tokens, roots, archives, and genesis rule. Unknown or
cross-family paths, schemas, tokens, encodings, case variants, or storage files
refuse. `ACTIVATION_RECOVERY_LAUNCH`, `RECOVERY_ATTEMPT_LOG`, and
`RECOVERY_ATTEMPT_RESERVATION` each use exactly `recovery-fence` or
`cleanup-gate-pre-fence`; every other runtime pointer uses `none`.

The canonical authority-path census is closed:

| Pointer kind | Canonical tip path family |
| --- | --- |
| `ACTIVE_RELEASE` | `installation/active-release.json` |
| `ACTIVATION_CLEANUP_GATE` | `installation/activation-cleanup-gate.json` |
| `ACTIVATION_RECOVERY_FENCE` | `installation/activation-recovery-fence.json` |
| `ACTIVATION_RECOVERY_LAUNCH` | `installation/activation-recovery-launches/<transaction>/<source>/current.json` |
| `RECOVERY_AUTHORIZATION_STATE` | `installation/recovery-authorizations/<transaction>/state.json` |
| `RECOVERY_AUTHORIZATION_ATTACHMENT` | `installation/recovery-authorizations/<transaction>/attachment.json` |
| `RECOVERY_ATTEMPT_LOG` | `installation/activation-recovery-launches/<transaction>/<source>/attempt-log.json` |
| `ACTIVATION_CLEANUP_ARCHIVE_HEAD` | `installation/activation-cleanup/archive-head.json` |
| `AUTHORITY_RETENTION` | `installation/authority-retention/<pointer-instance-digest>.json` |
| `RECOVERY_ATTEMPT_RESERVATION` | `installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json` |
| `STATE_MUTATION_AUTHORITY_ROTATION` | `installation/state-mutation-authority.json` |
| `POINTER_MUTATION_RUN_CURRENT` | `installation/pointer-cas/<target-instance-digest>/commits/<target-mutation-id>/current-run.json` |

Path components use the canonical contract path grammar and lowercase digest or
UUID text where declared. `predecessor-key` is the framed digest of the exact
predecessor terminal attempt-log `Dt/Dv/Dr`, or the tagged genesis value. The
path census walks every authority family and proposal bucket; uncatalogued
files, duplicate instances, missing selected tips, and old records at current
paths are `UNKNOWN`. Superseded pre-deployment schemas are deleted; no
diagnostic namespace exists.

### Commit runs and evidence packets

Every target mutation has immutable segments and acyclic checkpoint cores. A
core binds the target, segment/audit digest, prior selected run-current triple,
prior post-selection observation, stage, phase, and optional terminal
resolution. It excludes the selector value/`Dv`, proposal/`Dr`, tip/`Dt`, and
their readbacks. The selected `POINTER_MUTATION_RUN_CURRENT` value binds the
core and uses the generic value/proposal/tip protocol. A downstream
post-selection observation binds core plus selected selector graph/readbacks;
only the next core may bind that observation.

`POINTER_MUTATION_RUN_CURRENT` is `META_LEAF`: it uses the exact generic
`values/<mutation-id>`, prior/genesis proposal/conflict buckets, classification,
tombstone, retention, and census rules, but does not recursively create a run
selector for itself. A one-use ISS-004 capability binds it to the exact parent
target/`Dp`/mutation/core/prior/epoch. Run audit is FULL_REQUIRED.

Stages are `CURRENT_AUTHORITY_READ`, `TARGET_RECONCILED`, `VALUE_READBACK`,
`PROPOSAL_READBACK`, `CURRENT_AUTHORITY_PRE_CAS_READ`, `CAS_ARMED`,
`TARGET_POST_CAS_READBACK`, `PROPOSAL_CLASSIFIED`, and
`CURRENT_AUTHORITY_POST_CAS_READ`. `CAS_ARMED` is selected before issuing target
CAS, so a crash is explicitly ambiguous. Fresh recovery reads the target:
expected winner becomes `SELECTED`, a real different winner becomes
`LOST_CONFLICT`, unchanged prior may retry under the same epoch, and malformed
or impossible evidence becomes exact terminal unknown.

The checkpoint phase matrix is exact; `E` is the one selected authority epoch
for the run:

| Stage ordinal | Stage | Durable phase | Producer epoch |
| ---: | --- | --- | --- |
| 0 | `CURRENT_AUTHORITY_READ` | `CRASH_PREFIX` | `E` |
| 1 | `TARGET_RECONCILED` | `CRASH_PREFIX` | `E` |
| 2 | `VALUE_READBACK` | `CRASH_PREFIX` | `E` |
| 3 | `PROPOSAL_READBACK` | `CRASH_PREFIX` | `E` |
| 4 | `CURRENT_AUTHORITY_PRE_CAS_READ` | `CRASH_PREFIX` | `E` |
| 5 | `CAS_ARMED` | `CAS_AMBIGUOUS` | `E` |
| 6 | `TARGET_POST_CAS_READBACK` | `CAS_AMBIGUOUS` | `E` |
| 7 | `PROPOSAL_CLASSIFIED` | `SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL` | `E` |
| 8 | `CURRENT_AUTHORITY_POST_CAS_READ` | the unchanged stage-7 terminal phase | `E` |

`PROPOSED` is only a live branded in-memory ISS-004 view before stage five.
After lock/process loss, checkpoints zero through four are `CRASH_PREFIX` and
the persisted stage-five and stage-six checkpoints are `CAS_AMBIGUOUS`.
Durable resolution is only
`SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL` and excludes the run-current graph
that selects its terminal core.

Every commit intent is `SINGLE_EPOCH` and all nine checkpoint selectors bind
one authority triple. For the `STATE_MUTATION_AUTHORITY_ROTATION` target, the
rotation run under the old capability executes checkpoints zero through five,
appends the exact `authority-history/v1` chain record, and then performs the
authority CAS as its final action. It executes no checkpoint after that CAS
under either epoch; its run-current journal legitimately rests at the selected
`CAS_ARMED` checkpoint across the selection. Terminal truth is a pure derived
union: prior authority selected plus the exact head-plus-one chain record
matching the CAS-armed transaction is resumable under the old epoch; successor
authority selected plus the exact selected chain record and the old CAS-armed
checkpoint is `SELECTED`; every other observation is `UNKNOWN`. No post-CAS
write occurs under the successor epoch. No separate rotation receipt, handoff
pair, terminal-resolution write, or materialization machinery exists, and
every commit run remains single-epoch.

Rotation is forward-only once appended. A crash between chain append and
authority CAS is resumable only by the same transaction under the old
capability re-driving the same CAS to completion; the pending record is the
single permitted head-plus-one excess, and any other excess, gap, fork, or
mismatch refuses.

The full walk is intentionally O(n). `ISS-006` owns the executable gate: a
1,000-record chain must verify within five seconds independently on macOS,
Windows, and Linux. Checkpointing remains parked until that gate fails on a
supported OS; no speculative checkpoint contract is part of the current
surface.

```text
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/intent.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/runs/<run-ordinal>-<run-id>/segment.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/checkpoints/<core-digest>.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/selector-observations/<selector-mutation-id>.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/resolution.json
```

The closed run domains are `pointer-mutation-run-id/v1`,
`pointer-mutation-run-segment/v1`, `pointer-mutation-run-audit/v1`,
`pointer-mutation-run-checkpoint-core/v1`,
`pointer-mutation-run-current-position/v1`,
`pointer-mutation-run-selector-post-selection-observation/v1`, and
`pointer-mutation-commit-resolution/v1`.

| Digest/value | Domain/formula | Required parts and exclusions |
| --- | --- | --- |
| run ID | `pointer-mutation-run-id/v1` | `G` raw32, target mutation ID raw32, run ordinal bounded decimal string, nullable prior checkpoint digest raw32, current authority `Dp` raw32, current authority `Dt` raw32, current authority `Dv` raw32, current authority `Dr` raw32; timestamps excluded |
| segment/audit | `pointer-mutation-run-segment/v1`; first `H(F(pointer-mutation-run-audit/v1, 0x00, segment))`, later `H(F(...,0x01, prior audit, segment))` | exact run stages/readbacks; full immutable audit retained |
| `Dcore` | `pointer-mutation-run-checkpoint-core/v1` | identity/audit/predecessor parts, stage, phase, nullable terminal resolution, canonical core bytes |
| selector `Dv/Dr/Dt` | ordinary `pointer-value/v1`, `pointer-receipt/v1`, `pointer-tip/v1` | value binds `Dcore`; proposal binds exact prior selector triple/genesis and META_LEAF position; tip selects them |
| `Dpost` | `pointer-mutation-run-selector-post-selection-observation/v1` | `Dcore` raw32, selector `Dp` raw32, selector mutation ID raw32, selector `Dv` raw32, selector `Dr` raw32, selector `Dt` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, canonical observation bytes |
| terminal resolution | `pointer-mutation-commit-resolution/v1` | target outcome/evidence and producer epoch; excludes selector value/`Dv`, proposal/`Dr`, tip/`Dt`, selector readbacks, and `Dpost` |

`Dcore` excludes its selector value/`Dv`, proposal/`Dr`, tip/`Dt`, their
readbacks, and its own `Dpost`. `Dpost` is downstream and only the next core may
bind it; `Dpost` excludes that next core and every later selector graph. Terminal
resolution excludes `Dcore`'s selector value/`Dv`, proposal/`Dr`, tip/`Dt`, all
selector readbacks, and `Dpost`. The acyclic order is segment/optional terminal
resolution → `Dcore` → selector value/`Dv` → proposal/`Dr` → tip/`Dt` → `Dpost`
→ next core.

META_LEAF uses the generic selector-instance storage exactly:

```text
installation/pointer-cas/<selector-Dp>/values/<selector-mutation-id>.json
installation/pointer-cas/<selector-Dp>/proposals/<prior-tip-or-genesis>/<selector-mutation-id>.json
installation/pointer-cas/<selector-Dp>/conflicts/<prior-tip-or-genesis>/<selector-mutation-id>.json
installation/pointer-cas/<selector-Dp>/retention.json
```

Only recursive journaling is excluded. Create-once retry, real-winner conflict,
classification, tombstone, retention, path census, producer epoch, and exact
selected tip rules are identical to every other runtime pointer.

`pointer-evidence-packet/v1` is an exact twelve-slot union. `HISTORICAL_READ`
requires `currentCommit=null` and exposes no mutation capability.
`MUTATION_COMMIT` requires current intent/checkpoint/run evidence and a live
mutation context. Its closed outcome binds the target registry slot exactly:
`SELECTED` carries the exact selected target, `LOST_CONFLICT` carries the exact
observed real winner, and packet `UNKNOWN` carries an empty slot. Packet-level
authority and the complete kind/path/install/project/state/transaction/source/
`Dp`/mutation/run identity tuple must equal the commit and selected-slot facts;
any cross-field mismatch refuses.

Packet `UNKNOWN` evidence is a fixed-size closed union with category
`UNREADABLE|MALFORMED|IMPOSSIBLE`, a category-specific closed reason enum, one
observation digest, and one canonical safe-length decimal string. Its reason
enums are `MISSING|IO_ERROR|PERMISSION_DENIED`,
`NON_CANONICAL|SCHEMA_INVALID|DIGEST_MISMATCH`, and
`IDENTITY_MISMATCH|STATE_CONTRADICTION|EPOCH_MISMATCH`, respectively. It admits
no arbitrary JSON, native error text, host path, or variable-length array.

Both purposes carry a fixed registry-derived evidence-slot census, not
lifetime history; historical producer projections derive from the selected
authority value and the fully walked authority-history chain. A null current
commit is illegal for mutation, and serialized packet success alone grants no
authority.

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
predecessor terminal attempt-log triple (or tagged genesis). One competing
proposal selects a random UUIDv7 `attemptId`; UUID time is never ordering
authority. Reservation lifecycle is RESERVED→CONSUMED→TERMINAL→TOMBSTONE.

The selected reservation is durable before process creation and binds the
immutable descriptor inputs. The attempt writes states under:

```text
installation/activation-recovery-launches/<transaction>/<source>/attempts/<attempt-id>/<ordinal>-<lifecycle>.json
```

A `recovery-attempt-descriptor/v1` exists only as `LIVE`; it binds the
CAS-selected reservation plus process tree/start identity. Attachment is valid
only for LIVE. The `TERMINAL` attempt-log record folds in the terminal fields:
it binds descriptor, optional selected attachment, terminal state/lineage, and
exit/absence and channel-denial proofs. No separate terminal-summary document
exists, so a summary can never be launch authority; a terminal record cannot
retroactively authorize attachment.

The attempt log is append-only. The `RECOVERY_ATTEMPT_LOG` pointer selects
exact `IN_PROGRESS` and `TERMINAL` `attempt-log/v1` records chained by
predecessor record digest and safe-integer ordinal. The first IN_PROGRESS
record has ordinal `"0"`, a tagged genesis predecessor, and binds the selected
reservation/descriptor. Every later record binds the predecessor record digest
and ordinal plus one; an ordinal above `2^53 - 1` refuses. TERMINAL binds the
same descriptor and the folded terminal fields. Every operation verifies the
full chain, which stays small because attempts are rare.

Every broker/supervisor call uses the purpose-specific packet and an ISS-004
live handle. The fixed slots cover current authority, gate/fence, launch,
reservation, descriptor, attachment, and the attempt log with at most the
latest predecessor TERMINAL record. Historical producer epochs use projections
derived from the selected authority value and the fully walked
authority-history chain. Older attempt evidence remains linked for audit but
is not rescanned for mutation authority.

Pre-fence source may consume the narrowed recovery capability and publish the
precomputed fence, but never attaches authorization. It terminalizes, archives,
and tombstones before the fresh fence-backed source reserves its first attempt.
Abort admits no broker client and terminalizes the exact source before broker
revocation. Fence-backed completion selects terminal launch state before fence
clear, then archives/tombstones after child exit and authorization revoke.

## Retention and degraded audit

Destination owner/anchor lineage, physical identity/observations, state
authority/history, run-current audit, active release, cleanup head/gate, fence,
authorization records, current tips, and current proposals are
`FULL_REQUIRED`. Only terminal launch/attempt history may use
`TERMINAL_CHECKPOINT_ALLOWED`. Authorized compaction selects checkpoint, exact
deletion plan, verified deletion receipt, and completion through the retention
pointer. Pending proposals are never compacted.

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

`ISS-002` owns schemas, canonical framing, chain-walk and state-machine pure
validators. `ISS-022` proves physical locator/custody and kernel lock/CAS
guarantees. `ISS-004` owns the revocable in-process state service, private
capabilities, runtime pointer protocol, run-current selection, and history
updates. `ISS-014` produces active-release/gate/fence/cleanup transitions and
reviewed rotation requests. `ISS-030` owns reservation/launch/descriptor/
attempt-log behavior. `ISS-032` owns authorization and attachment
production. `ISS-020` owns destination-owner/anchor lifecycle, externally
reviewed E0 genesis, exact reinstall, and teardown; `ISS-027` executes the
production transcript. No worker, candidate, adapter, or provider policy owns
these mechanisms.

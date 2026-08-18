# Public contract compatibility

`@orchestration-platform/contracts` is a provider-neutral, pure contract
package. It parses, snapshots, serializes, frames, hashes, and validates
authority evidence; it does not acquire locks, mutate files, issue private
capabilities, contact a broker, or launch a process.

## Canonical values and reflective closure

Authority JSON is UTF-8 without BOM, lexicographically sorted at every object,
has no insignificant whitespace, preserves array order, and ends with LF.
Numbers are non-negative safe integers unless declared decimal strings. Times
are RFC 3339 UTC with milliseconds; durable IDs are lowercase UUIDv7 and
digests lowercase SHA-256. Relative paths use `/` and refuse absolute/drive/URI
prefixes, alternate separators, empty/dot segments, NUL, and all C0/C1 controls.

Canonical decimal strings are bounded by `Number.MAX_SAFE_INTEGER`; parsers
validate grammar and compare length and lexicographic value before conversion,
so an overflow value never reaches `Number`.

Every public parser, serializer, migration, and evidence validator takes a
detached snapshot before semantic reads. Records allow only Object.prototype or
null prototype, own enumerable data properties, and exact fields. Arrays must
be same-realm exact Array.prototype values with dense indices plus `length`;
mutable, sealed, and frozen descriptors are accepted. Proxies, symbols, holes,
extras, accessors, custom iterators/prototypes, subclasses, cross-realm arrays,
exotics, and traps refuse without executing user code.

## Current registry

The current census is `v1` for every contract family. Before the first
deployed release, a superseded schema generation is deleted from the package
and its tests; no diagnostic or archive namespace exists, and no superseded
symbol is exported or reachable. After first deployment, superseded schemas
are refused at authority paths and become readable only through an explicitly
versioned migration decision. Unknown and future versions refuse; there is no
forward compatibility.

The current registry uses the approved authority contracts:

- pointer graph: `pointer-current-tip/v1`,
  `pointer-cas-proposal-receipt/v1`, `pointer-conflict-receipt/v1`,
  and `pointer-tombstone-value/v1`;
- epoch/history: `state-mutation-authority-value/v1`,
  `reviewed-authority-operation/v1`,
  `state-mutation-successor-authority-core/v1`,
  `authority-history-genesis-bootstrap-input/v1`,
  `authority-history-genesis-selection-evidence/v1`,
  `state-mutation-authority-rotation-id/v1`,
  `authority-history-record/v1` chain records (digested under
  `authority-history/v1`),
  `pointer-evidence-slot/v1`, and `pointer-evidence-packet/v1`;
- release/cleanup:
  `active-release/v1`, `activation-cleanup-gate-root/v1`,
  `activation-cleanup-gate-head/v1`,
  `activation-cleanup-archive-head/v1`,
  `activation-recovery-fence-root/v1`, and
  `activation-recovery-fence-head/v1`;
- attempts: `activation-recovery-launch/v1`,
  `recovery-attempt-reservation/v1`, `recovery-attempt-descriptor/v1`, and
  `attempt-log/v1`;
- authorization: `recovery-authorization-core/v1`,
  `recovery-authorization-state/v1`, `native-consume-receipt/v1`,
  `recovery-authorization-consume-receipt/v1`,
  `native-removal-receipt/v1`,
  `recovery-authorization-revoke-receipt/v1`, and
  `recovery-authorization-attachment/v1`, with the closed archives
  `recovery-authorization-archive/v1` and
  `recovery-authorization-attachment-archive/v1`;
- commit journal: `pointer-mutation-run-checkpoint-core/v1`,
  `pointer-mutation-run-current-value/v1`,
  `pointer-mutation-run-selector-post-selection-observation/v1`, and
  `pointer-mutation-commit-resolution/v1`, with the composed
  `pointer-mutation-run-checkpoint-evidence/v1` and
  `pointer-mutation-run-intent/v1`,
  `pointer-mutation-commit-evidence/v1` envelopes and closed
  `pointer-mutation-conflict-evidence/v1` / `pointer-mutation-unknown-evidence/v1`
  terminal unions;
- external bootstrap: `physical-destination-identity/v1`,
  `physical-destination-locator-observation-receipt/v1`,
  `state-mutation-destination-owner-value/v1`,
  `state-mutation-destination-owner-cas-proposal/v1`,
  `state-mutation-destination-owner-current-tip/v1`,
  `state-mutation-destination-owner-conflict-receipt/v1`,
  `state-mutation-destination-owner-teardown-archive/v1`,
  `state-mutation-destination-owner-successor-review-core/v1`,
  `destination-owner-prior-installation/v1`,
  `destination-owner-successor-authority/v1`,
  `destination-owner-independent-review/v1`,
  `state-mutation-destination-owner-successor-review-post-selection-receipt/v1`,
  `state-mutation-bootstrap-anchor/v1`,
  `state-mutation-bootstrap-anchor-lifecycle-value/v1`,
  `state-mutation-bootstrap-anchor-use-intent/v1`,
  `bootstrap-proposed-genesis-input/v1`,
  `bootstrap-reviewed-installer/v1`, `bootstrap-reviewed-helper/v1`,
  `state-mutation-bootstrap-anchor-cas-proposal/v1`,
  `state-mutation-bootstrap-anchor-current-tip/v1`,
  `state-mutation-bootstrap-anchor-conflict-receipt/v1`,
  `state-mutation-bootstrap-anchor-consumption-receipt/v1`,
  `state-mutation-bootstrap-anchor-teardown-receipt/v1`,
  `state-mutation-bootstrap-anchor-lifecycle-archive/v1`,
  `state-mutation-bootstrap-genesis-core/v1`, and
  `state-mutation-bootstrap-genesis-post-selection-receipt/v1`.

Superseded pre-deployment generations are deleted from the package and its
tests rather than frozen; an API-surface test proves no superseded symbol is
reachable. No migration exists because no superseded authority was deployed.

Exact current versions are readable. Missing, legacy, malformed, unknown,
and future versions are refused; a v0 record refuses like any unknown version.

## Pointer registry and framing

The closed runtime pointer registry has exactly eleven kinds and, for each kind,
exact tip path, roots, archives, genesis mode, source tokens, and value schemas.
Transaction path bindings are lowercase UUIDv7; unused/extra,
wrong-family, alternate, or partial bindings refuse. The fixed singleton lock is
`installation/state-mutation.lock`. `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_ATTEMPT_LOG`, and `RECOVERY_ATTEMPT_RESERVATION` each accept
exactly `recovery-fence` or `cleanup-gate-pre-fence`; all other runtime
kinds require `none`. Unknown, differently cased/encoded, cross-family, or
colliding paths/tokens refuse.

The eleven kinds are `ACTIVE_RELEASE`, `ACTIVATION_CLEANUP_GATE`,
`ACTIVATION_RECOVERY_FENCE`, `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_AUTHORIZATION_STATE`, `RECOVERY_AUTHORIZATION_ATTACHMENT`,
`RECOVERY_ATTEMPT_LOG`, `ACTIVATION_CLEANUP_ARCHIVE_HEAD`,
`RECOVERY_ATTEMPT_RESERVATION`,
`STATE_MUTATION_AUTHORITY_ROTATION`, and `POINTER_MUTATION_RUN_CURRENT`.

Public tip, root, and archive constructors expand placeholders even inside a
filename. They require the exact closed transaction, source, predecessor,
pointer-instance, or release bindings used by that template; missing, null,
aliased, case-shifted, and unused bindings refuse. Pure dispatch validators
cover every root/archive row and its exact genesis rule.

Each registry row also declares REQUIRED or NULL transaction policy, its exact
source policy, and one row-specific position domain. Mutation IDs accept closed
structured position evidence rather than caller-selected digest bytes; the
position is rederived from the selected family value. Reservation predecessor
keys are framed separately for tagged genesis versus an ordered prior Dt/Dv/Dr
and bind transaction plus source, so no cross-transaction or reordered alias is
accepted.

Framing `F` is UTF-8 `orchestration-platform`, NUL, domain, NUL, U32 part count,
then closed type tag, U64 byte length, and bytes for every part. Digests are raw
32 bytes; nullable text/digests have distinct typed nulls; attempt-log tags are
raw fixed bytes `00` and `01`, never text. Authority/history/run ordinals and
counts are canonical decimal strings (`"0"|[1-9][0-9]*`) bounded by the
JavaScript safe-integer range. Grammar, length, and lexicographic comparison
against `Number.MAX_SAFE_INTEGER` occur before any numeric conversion; an
overflow value never reaches `Number`, and no arbitrary-precision numeric type
exists. Goldens pin:

- Dp under `pointer-instance/v1`;
- Dv under `pointer-value/v1`;
- Dr under `pointer-receipt/v1` over
  `pointer-cas-proposal-receipt/v1`;
- Dt under `pointer-tip/v1` over `pointer-current-tip/v1`;
- mutation ID under `pointer-mutation-id/v1`;
- Dc under `pointer-conflict-receipt/v1`.

Values never contain the receipt/tip selecting them. Proposals are create-once
`VALUE_PROPOSED|TOMBSTONE_PROPOSED` and classify only as PENDING, SELECTED,
LOST_CONFLICT, or UNKNOWN from exact winner evidence. Terminal
authority selects `pointer-tombstone-value/v1`; the current tip is never deleted
and bare absence never regains authority. The ten tombstone-enabled families —
every registry kind except `STATE_MUTATION_AUTHORITY_ROTATION`, whose authority
pointer is never removed — use distinct ordinary and tombstone position domains
and closed per-kind field contracts. Ordinary values require
`VALUE_PROPOSED/SELECT`; tombstones require `TOMBSTONE_PROPOSED/REMOVE`, an
exact non-genesis selected ordinary predecessor, and closed
`pointer-terminal-proof/v1` plus `pointer-archive-record/v1` evidence. The
validator recomputes the predecessor Dp/Dv/Dr/Dt and family position, archive
path, and both evidence digests. It binds kind, canonical path,
installation/project/state identities, transaction, source, Dp, predecessor
and mutation authority epochs, family value schema, and terminal prior triple.

## Pure semantic validators

Cleanup admits exactly ten lifecycle/publication pairs and twelve mutation
edges; an already-selected pair reduces to NO_APPEND. Fence history is exactly
PREPARED then optional POST_ACTIVATION. Dense root/head histories bind ordinal,
previous canonical digest, and exact edge.

External bootstrap validators distinguish stable `Dphys` from versioned `Dobs`,
derive `Ddest` from raw `Dphys` alone, and validate FULL_REQUIRED destination-
owner/anchor `ACTIVE|CONSUMED|RETIRED` lifecycles. They prove one owner per
physical destination, acyclic successor review-core→anchor→owner→post-receipt,
pre-expiry use-intent recovery, E0 core→proposal→tip→post receipts, consumption,
teardown, and exact reinstall without parallel genesis.

State mutation validators pin the fixed lock sequence, revocable ISS-004
context identity, exact E0 bootstrap producer versus selected-stable rotation,
and the eleven-kind census. `state-mutation-authority-value/v1` binds the
selected `authority-history/v1` head ordinal and record digest. Both record
arms bind the exact shared successor core `Dsc`: `G`, authority `Dp`, successor
ordinal, release manifest/installed bytes/subject/review, derived reviewed-
operation `Dop`, helper/profile/ABI/lock/state-component, and custody instance/
observation. `Dop` is the closed BOOTSTRAP_INSTALL/STABLE_PROMOTION formula in
`supervisor-contract.md`, not caller input.

The normative simplified-authority schema ledger in `supervisor-contract.md`
pins the literal `schemaVersion`, canonical JSON member order, scalar type,
nullability/branch absence, enum census, storage disposition, digest domain,
ordered framed parts, and selecting/downstream exclusions for `Dop`, `Dsc`,
`Dgb`, `Dgse`, `Drot`, both `Dh` arms, the selected authority value, and both
`Dcommit` arms. Conceptual labels in this document are aliases for those exact
member names and never authorize an implementation-defined key. In particular,
history files parse only as `authority-history-record/v1`; the distinct literal
`authority-history/v1` is the `Dh` digest domain and is never accepted as a
record `schemaVersion`.

`GENESIS` binds ordinal zero, the genesis predecessor, and `Dgb`; `Dgb` binds
the selected destination-owner and anchor ACTIVE triples, use intent,
bootstrap identity/transaction/grant, and `Dsc`, with no retiring epoch. The
required downstream genesis-selection evidence binds the record, `Dbg`, exact
selected E0/readbacks/`Dgp`, owner/anchor ACTIVE and CONSUMED triples,
consumption receipt, and consumed readbacks without entering the record or E0
selection digest. `ROTATION` binds ordinal greater than zero, exact prior head
ordinal/record digest, retiring `Dp/Dt/Dv/Dr`, derived `Drot`, and `Dsc`.
`Drot` is recomputed from rotation transaction, retiring authority/head,
successor ordinal, `Dop`, and `Dsc`; the operation identity is fully derived
rather than supplied as an input. Both records exclude successor value/proposal/tip/head and
downstream artifacts. Verification
walks the complete chain from genesis against the selected head: a missing
record at or below the head, a head-ordinal or digest mismatch, or a fork,
gap, reorder, or truncation refuses. A head-plus-one record is accepted only
when its ordinal is head plus one, its predecessor digest equals the selected
head record digest, and its rotation identity and successor facts equal the
selected CAS-armed journal plus its create-once intent record. With no selected
armed intent, any head-plus-one file refuses; head plus two must be absent.
Lifetime-stable `G` excludes rotating
helper/profile/ABI/lock/state-component facts. En validates derived `Drot` and
the exact chain append. ISS-004 owns
locks, live handles, CAS, reconciliation, tombstones, history writes, and
context revocation.

Commit validators parse the closed `ORDINARY|AUTHORITY_ROTATION`
`pointer-mutation-commit-evidence/v1` union. ORDINARY composes immutable
segment→checkpoint core→selected `POINTER_MUTATION_RUN_CURRENT` graph→post-
selection observation for all nine stages and ends in exactly
`SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL`. Cores and ordinary terminal
resolutions exclude their selecting selector graph. `PROPOSED` is live-only;
persisted ordinary recovery remains `CRASH_PREFIX|CAS_AMBIGUOUS`.

`pointer-mutation-commit-evidence/v1` has no persistence path or selecting
pointer. The ledger's exact common members and branch-only members are embedded
in `pointer-evidence-packet/v1`; missing, null-for-absent, extra, or wrong-arm
members refuse before `Dcommit` is recomputed. ORDINARY binds its target slot to
the exact selected target, recomputed real winner, or empty slot for SELECTED,
LOST_CONFLICT, or UNKNOWN_TERMINAL. AUTHORITY_ROTATION binds the authority slot
to old, successor, or empty for RESUMABLE, SELECTED, or UNKNOWN. Structural
success without that outcome-to-slot equality never grants a capability.

AUTHORITY_ROTATION composes the old E(n) intent and selected checkpoint 5,
expected successor `Dv`/target mutation/head/record/`Drot`/`Dsc`, then exactly
RESUMABLE old authority plus matching pending record, SELECTED exact successor
authority plus record, or bounded UNKNOWN. Checkpoints 6–8, an ordinary
resolution, selector evidence after checkpoint 5, or a successor-epoch write
are schema errors. META_LEAF follows generic storage/classification
but does not recursively journal itself.

Recovery authorization core has closed BOOTSTRAP/SUCCESSOR unions. It excludes
gate/lifecycle/consume/revoke/attachment and
`candidateOperationManifestDigest`; every excluded-field insertion refuses.
The core digest is recomputed with the framed
`recovery-authorization-core/v1` domain. The cleanup gate binds the exact core
path/digest, recomputed selected CREATED Dp/Dt/Dv/Dr, and prebound
operation/native path. State validates CREATED, native-consume then
CONSUMED, native removal then REVOKED; CONSUMED/REVOKED values deliberately do
not contain later post receipts. External post-consume/revoke records bind the
actual recomputed selected Dt/Dv/Dr plus exact capability/native custody, broker service/
profile/client generation, and native/selected readbacks. Attachment binds that
consume receipt, reservation triple, the LIVE descriptor record, and optional
exact prior attachment/terminal attempt-log triples; it never binds a future
terminal record.

CREATED selects only from a null predecessor triple. CONSUMED selects from the
exact gate-bound CREATED triple, and REVOKED selects from the exact CONSUMED
triple. Core, transaction, gate, prebound operation/path, and native-consume
facts cannot change across those selections. Bootstrap and successor gate/core
mode unions compare their candidate, active/fence, admission, broker, release,
executable, and operation-manifest facts field for field.

Reservations bind one UUIDv7 (uniqueness only) to a predecessor terminal
attempt-log triple/genesis and have exact
RESERVED/CONSUMED/TERMINAL/TOMBSTONE fields. Launch, descriptor, attachment,
and attempt-log records separately bind transaction/source, roots/heads,
reservation, argv/process, predecessor, failure/recovery/idempotency, and
terminal proofs. Genesis/later attempt-log records use domain-separated raw
tags. A fixed packet verifies current gate/fence/launch, reservation,
descriptor, attachment, and the attempt log, whose chain is verified in full
and stays small because attempts are rare.

IN_PROGRESS attempt-log records have no folded terminal fields. TERMINAL
records fold the terminal-summary fields — descriptor, optional attachment,
terminal lineage, exit/absence, channel-denial, and revocation evidence — so
no separate terminal-summary document exists and summary-as-launch-authority
is structurally impossible.

The composed attempt-log check walks the full chain from its tagged genesis:
record `n` binds the digest of record `n-1` and ordinal `n`, ordinals are
contiguous safe integers that refuse above `2^53 - 1`, and the selected
reservation, descriptor, and predecessor TERMINAL record bind exactly. R0
IN_PROGRESS has a tagged genesis predecessor; Rn IN_PROGRESS advances from the
selected prior TERMINAL record; each TERMINAL record advances from its
same-attempt IN_PROGRESS record. Current and predecessor roles recompute the
same canonical attempt-log path/Dp and
installation/project/state/transaction/source identities, so no role swap,
stale sibling, or split claim is accepted. Each historical record retains and
digest-binds its own producer authority epoch; a valid E1 predecessor may be
advanced by an E2 proposal. Epoch equality is required only among the lock
observations and new proposal/readbacks of one commit. Each predecessor-key
reservation is a distinct create-once pointer instance, so its selected
RESERVED proposal must have a fully null prior triple; a TERMINAL-to-RESERVED
replay is never an allowed transition.

`pointer-evidence-packet/v1` is an exact purpose union. `HISTORICAL_READ`
requires `currentCommit=null` and a scoped read handle; `MUTATION_COMMIT`
requires exact `Dcommit`, closed commit-union bytes, and a purpose-compatible
live handle. ORDINARY carries the nine same-epoch checkpoints and binds packet
authority to E; its target slot is selected target, real winner, or empty.
AUTHORITY_ROTATION carries only old E(n) checkpoint 5 plus exact expected
successor/history evidence. Its packet authority and authority slot are old/
old for RESUMABLE, successor/successor for SELECTED, and null/empty for UNKNOWN.
Rotation checkpoints 6–8, resolution, later selector artifacts, and new-epoch
writes refuse. Every arm cross-binds the complete identity tuple. Unknown evidence is a fixed-size closed
`UNREADABLE|MALFORMED|IMPOSSIBLE` union with a category-specific closed reason,
observation digest, and safe decimal byte length; arbitrary JSON, native text,
paths, and arrays refuse. Historical envelopes keep their producer epoch and are
verified by the full authority-history chain walk in the live current
selection; no caller-chosen head or unsigned record authenticates them. Packet
evidence is bounded by the closed evidence-slot census. Tombstones
authenticate both removal and selected prior producers. Authority history
remains FULL_REQUIRED.

The packet serializes the exact global identity, selected current authority,
composed authority-history binding, eleven registry-ordered typed evidence
slots, and (for `MUTATION_COMMIT`) the exact `Dcommit` arm: nine-checkpoint
ordinary evidence or checkpoint-5-only rotation evidence.
Digest-only bags, reordered/duplicate slots, unselected producer triples, and
a mutation purpose without a current commit refuse.

Every record class is FULL_REQUIRED, including destination/anchor lineage,
physical identity/observations, authority history, run audit, and terminal
attempt history. No retention pointer, compaction protocol, or degraded-audit
mode exists. Loss of any required record is `UNKNOWN` and blocks mutation.

The external bootstrap graph remains acyclic: selected owner/anchor lifecycle
values do not embed the downstream successor-post or final consumption receipt.
Composed validators instead recompute those receipts after their referenced
owner/anchor tips exist and bind every value/proposal/tip readback. Owner
retirement first selects an anchor `RETIRED` value from an `ACTIVE` or
`CONSUMED` predecessor and archives only that exact prior owner triple. The
owner `RETIRED` value is selected afterward and binds the selected anchor
`Dt/Dv/Dr` plus the owner archive. Neither anchor archive nor receipt contains
a future owner value, so anchor retirement, owner retirement, and successor
activation remain acyclic and crash-resumable.

Physical destination identity accepts exactly one canonical leaf component.
Separators, dot components, alternate streams, Windows reserved names
(including `COM`/`LPT` superscript-digit aliases), trailing dot-or-space
aliases, noncanonical case, and mismatched Unicode/profile forms refuse before
`Dphys` computation. Windows uses Unicode lowercase NFC without an invalid
upper/lower round-trip (so a canonical leaf such as `straße` remains valid),
macOS lowercase NFD, and Linux case-sensitive NFC; the selected profile must
match the OS field. Case or normalization-distinct Linux identities remain
distinct rather than colliding.

Authority-history verification recomputes each record digest and authenticates
the chain against the exact selected current authority's `G`, `headOrdinal`,
and `headRecordDigest`. It recomputes the exact `Dop`, `Dsc`, `Dgb`, `Drot`,
and branch-specific `Dh` formulas above. GENESIS admission additionally
recomputes the downstream ACTIVE→E0→CONSUMED selection-evidence digest; ROTATION
checks exact prior selected head and retiring authority. Both exclude successor
selection and downstream artifacts. Every authority `Dp` equals the lifetime-
stable `Dp` committed by `G`. Records use the
content-addressed canonical
`installation/state-mutation-authority-history/records/<ordinal>.json` path;
the walk constructs the path of record `n+1` from `n` and never enumerates a
directory. The walk is deliberately O(n); `ISS-006` proves 1,000 records within
five seconds per supported OS. Checkpointing remains parked until that measured
gate fails.

Commit evidence includes a closed immutable intent. Every arm repeats and
validates target kind/path/install/project/state/transaction/source identity,
and run IDs are recomputed from selected authority and prior checkpoint.
ORDINARY retains all nine stages and its selected/lost/unknown resolution.
AUTHORITY_ROTATION retains only the selected old checkpoint 5, expected
successor/history, and its resumable/selected/unknown derived arm; ordinary
post-CAS artifacts refuse. Packet `UNKNOWN` is a fixed-size
closed `UNREADABLE|MALFORMED|IMPOSSIBLE` union containing only a category-
specific closed reason, observation digest, and safe decimal byte length; it
admits no arbitrary JSON, native error text, host path, or array. Packet
authority and registry slot follow the exact ordinary/rotation arm mapping
above. Every checkpoint preserves the full kind/path/install/project/state/
transaction/source/`Dp`/mutation/run identity tuple.

Every commit run is single-epoch. The rotation run appends the exact chain
record and performs the authority CAS as its final action; it executes no
checkpoint after that CAS under either epoch, and its run-current journal
legitimately rests at the selected CAS-armed checkpoint across the selection.
Its `Dcommit` derives RESUMABLE from prior authority plus exact head-plus-one
record matching the CAS-armed transaction, SELECTED from exact successor
authority/history/old checkpoint 5, and UNKNOWN otherwise. No post-CAS new-
epoch write or ordinary post-CAS artifact exists. Rotation is forward-only once appended: the pending record is the
single permitted head-plus-one excess, and any other excess, gap, fork, or
mismatch refuses.

## Review attack surface

Executable mutants cover missing/extra/partial fields, coordinated digest
substitution, domain/order/type/null framing changes, source/path collisions,
fake lost conflicts, pointer deletion/bare absence, invalid cleanup cells/edges,
mixed epochs, incomplete rotation census, candidate core fields, reordered
native/post receipts, attachment-to-terminal-record confusion, reservation
forks, ordinal overflow, chain-record forgery and head substitution,
run-current recursion, packet purpose overflow, retention/compaction/degraded-
audit exports or dispatch reachability, superseded symbols reachable after
deletion, and all hostile
reflective shapes. Cross-OS conformance reuses the same canonical goldens
without changing authority.

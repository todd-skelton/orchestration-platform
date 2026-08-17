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

Every public parser, serializer, migration, and evidence validator takes a
detached snapshot before semantic reads. Records allow only Object.prototype or
null prototype, own enumerable data properties, and exact fields. Arrays must
be same-realm exact Array.prototype values with dense indices plus `length`;
mutable, sealed, and frozen descriptors are accepted. Proxies, symbols, holes,
extras, accessors, custom iterators/prototypes, subclasses, cross-realm arrays,
exotics, and traps refuse without executing user code.

## Current and diagnostic registries

The current registry uses the approved v2 authority contracts:

- pointer graph: `pointer-current-tip/v1`,
  `pointer-cas-proposal-receipt/v2`, `pointer-conflict-receipt/v1`,
  `pointer-tombstone-value/v1`, and `authority-retention/v1`;
- epoch/history: `state-mutation-authority-value/v2`,
  `state-mutation-authority-successor-core/v1`,
  `authority-history-leaf/v1`, `authority-history-node/v1`,
  `authority-history-root/v1`, `authority-history-update-proof/v1`,
  `authority-history-append-receipt/v1`, and `pointer-evidence-packet/v2`;
- release/cleanup:
  `active-release/v2`, `activation-cleanup-gate-root/v2`,
  `activation-cleanup-gate-head/v2`,
  `activation-cleanup-archive-head/v2`,
  `activation-recovery-fence-root/v2`, and
  `activation-recovery-fence-head/v2`;
- attempts: `activation-recovery-launch/v2`,
  `recovery-attempt-reservation/v1`, `recovery-attempt-descriptor/v1`,
  `recovery-attempt-terminal-summary/v1`, and
  `recovery-attempt-accumulator/v1`;
- authorization: `recovery-authorization-core/v1`,
  `recovery-authorization-state/v2`, `native-consume-receipt/v1`,
  `recovery-authorization-consume-receipt/v1`,
  `native-removal-receipt/v1`,
  `recovery-authorization-revoke-receipt/v1`, and
  `recovery-authorization-attachment/v1`;
- commit journal: `pointer-mutation-run-checkpoint-core/v1`,
  `pointer-mutation-run-current-value/v1`,
  `pointer-mutation-run-selector-post-selection-observation/v1`, and
  `pointer-mutation-commit-resolution/v1`;
- external bootstrap: `physical-destination-identity/v1`,
  `physical-destination-locator-observation-receipt/v1`,
  `state-mutation-destination-owner-value/v1`,
  `state-mutation-destination-owner-cas-proposal/v1`,
  `state-mutation-destination-owner-current-tip/v1`,
  `state-mutation-destination-owner-conflict-receipt/v1`,
  `state-mutation-destination-owner-teardown-archive/v1`,
  `state-mutation-destination-owner-successor-review-core/v1`,
  `state-mutation-destination-owner-successor-review-post-selection-receipt/v1`,
  `state-mutation-destination-owner-retention/v1`,
  `state-mutation-bootstrap-anchor/v1`,
  `state-mutation-bootstrap-anchor-lifecycle-value/v1`,
  `state-mutation-bootstrap-anchor-use-intent/v1`,
  `state-mutation-bootstrap-anchor-cas-proposal/v1`,
  `state-mutation-bootstrap-anchor-current-tip/v1`,
  `state-mutation-bootstrap-anchor-conflict-receipt/v1`,
  `state-mutation-bootstrap-anchor-consumption-receipt/v1`,
  `state-mutation-bootstrap-anchor-teardown-receipt/v1`,
  `state-mutation-bootstrap-genesis-core/v1`, and
  `state-mutation-bootstrap-genesis-post-selection-receipt/v1`.

`pointer-cas-proposal-receipt/v1`, `state-mutation-authority-value/v1`, the
capped serialized authority-history table/packet, and the thirteen superseded
active-release, gate, fence, launch, cleanup-head, and authorization v1 schemas
exist only under the frozen `diagnostic` namespace. `diagnostic.parseContract`
may read their historical bytes. They are not ordinary/deep exports;
`parseContract` and every canonical authority path refuse them. No migration
exists because no v1 authority was deployed.

Exact current versions are readable. The named
`platform-configuration/v0-fixture` alone is migratable. Missing, diagnostic,
other legacy, malformed, unknown, and future versions are refused.

## Pointer registry and framing

The closed runtime pointer registry has exactly twelve kinds and, for each kind, exact
tip path, roots, archives, genesis mode, source tokens, retention class, and
value schemas. Transaction path bindings are lowercase UUIDv7; unused/extra,
wrong-family, alternate, or partial bindings refuse. The fixed singleton lock is
`installation/state-mutation.lock`. `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_ATTEMPT_ACCUMULATOR`, and `RECOVERY_ATTEMPT_RESERVATION` each accept
exactly `recovery-fence-v2` or `cleanup-gate-pre-fence-v2`; all other runtime
kinds require `none`. Unknown, differently cased/encoded, cross-family, or
colliding paths/tokens refuse.

The twelve kinds are `ACTIVE_RELEASE`, `ACTIVATION_CLEANUP_GATE`,
`ACTIVATION_RECOVERY_FENCE`, `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_AUTHORIZATION_STATE`, `RECOVERY_AUTHORIZATION_ATTACHMENT`,
`RECOVERY_ATTEMPT_ACCUMULATOR`, `ACTIVATION_CLEANUP_ARCHIVE_HEAD`,
`AUTHORITY_RETENTION`, `RECOVERY_ATTEMPT_RESERVATION`,
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
32 bytes; nullable text/digests have distinct typed nulls; accumulator tags are
raw fixed bytes `00` and `01`, never text. Authority/history/run ordinals and
counts use `DECIMAL_ASCII` (`"0"|[1-9][0-9]*`), decimal carry, and no numeric
lifetime cap. Goldens pin:

- Dp under `pointer-instance/v2`;
- Dv under `pointer-value/v2`;
- Dr under `pointer-receipt/v2` over
  `pointer-cas-proposal-receipt/v2`;
- Dt under `pointer-tip/v2` over `pointer-current-tip/v1`;
- mutation ID under `pointer-mutation-id/v2`;
- Dc under `pointer-conflict-receipt/v1`.

Values never contain the receipt/tip selecting them. Proposals are create-once
`VALUE_PROPOSED|TOMBSTONE_PROPOSED` and classify only as PENDING, SELECTED,
LOST_CONFLICT, COMPACTED, or UNKNOWN from exact winner evidence. Terminal
authority selects `pointer-tombstone-value/v1`; the current tip is never deleted
and bare absence never regains authority. The nine tombstone-enabled families
use distinct ordinary and tombstone position domains and closed per-kind field
contracts. Ordinary values require
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
and the twelve-kind census. `state-mutation-authority-value/v2` binds a
FULL_REQUIRED 256-depth sparse root. En validates deterministic rotation,
exact 256-sibling EMPTY→PRESENT update, append receipt, successor root/count,
and historical membership against the live current root. Serialized tables are
diagnostic only. ISS-004 owns locks, live handles, CAS, reconciliation,
tombstones, history writes, and context revocation.

Commit validators compose immutable segment→checkpoint core→selected
`POINTER_MUTATION_RUN_CURRENT` value/proposal/tip→post-selection observation.
Cores and terminal resolutions exclude their selecting selector graph.
`PROPOSED` is a live branded view only; persisted recovery is `CRASH_PREFIX` or
`CAS_AMBIGUOUS`, and final resolution is exactly
`SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL`. META_LEAF follows generic storage/
classification/retention but does not recursively journal itself.

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
consume receipt, reservation triple, READY/LIVE records, and optional exact
prior attachment/terminal accumulator triples; it never binds a future terminal
summary.

CREATED selects only from a null predecessor triple. CONSUMED selects from the
exact gate-bound CREATED triple, and REVOKED selects from the exact CONSUMED
triple. Core, transaction, gate, prebound operation/path, and native-consume
facts cannot change across those selections. Bootstrap and successor gate/core
mode unions compare their candidate, active/fence, admission, broker, release,
executable, and operation-manifest facts field for field.

Reservations bind one UUIDv7 (uniqueness only) to a predecessor accumulator
triple/genesis and have exact RESERVED/CONSUMED/TERMINAL/TOMBSTONE fields.
Launch, descriptor, terminal summary, attachment, and accumulator separately
bind transaction/source, roots/heads, reservation, argv/process, predecessor,
failure/recovery/idempotency, and terminal proofs.
First/later accumulator formulas use domain-separated raw digests. There is no
lifetime attempt array or generation cap; a fixed packet verifies only current
gate/fence/launch, reservation, descriptor, attachment, accumulator, initial
records, and at most one previous terminal summary.

IN_PROGRESS accumulator values have no terminal summary or rolling digest.
TERMINAL values require both; a composed validator recomputes R0 from the raw
first summary or Rn from the selected predecessor accumulator Dv plus the raw
summary. It also binds the selected reservation, descriptor, predecessor
accumulator, and predecessor summary.

The composed accumulator check receives selected current accumulator and
reservation envelopes plus two named roles: the current pointer predecessor and
the prior terminal lineage. R0 IN_PROGRESS has neither; R0 TERMINAL advances
from its same-attempt selected IN_PROGRESS value and has no lineage. Rn
IN_PROGRESS advances directly from the same selected prior TERMINAL value used
as lineage; Rn TERMINAL advances from its same-attempt selected IN_PROGRESS
value while retaining the prior TERMINAL lineage. The current proposal binds
only the current role; accumulator, reservation, prior summary, and rolling
digest bind only lineage. Both roles recompute the same canonical accumulator
path/Dp and installation/project/state/transaction/source identities. The fixed
packet carries at most those two envelopes and one prior summary, so verification
cost remains constant without accepting role swaps, stale siblings, or split
claims. A selected IN_PROGRESS accumulator also proves its own proposal ancestry:
null for R0 or the exact selected prior TERMINAL lineage for Rn. A TERMINAL value
therefore proves both its immediate same-attempt IN_PROGRESS predecessor and
that predecessor's ancestry. Each historical proposal retains and digest-binds
its own producer authority epoch; a valid E1 predecessor may be advanced by an
E2 proposal. Epoch equality is required only among the lock observations and
new proposal/readbacks of one commit. Each predecessor-key reservation is a
distinct create-once pointer instance, so its selected RESERVED proposal must
have a fully null prior triple; a TERMINAL-to-RESERVED replay is never an allowed
transition.

`pointer-evidence-packet/v2` is an exact purpose union. `HISTORICAL_READ`
requires `currentCommit=null` and a scoped read handle; `MUTATION_COMMIT`
requires exact intent/run/current selector plus a live mutation handle. The nine
same-epoch commit observations and new proposal/readbacks bind the live current
selection. Historical envelopes keep their producer epoch and use deduplicated
256-sibling membership projections rooted in that live selection; no caller-
chosen root or unsigned row authenticates them. Packet proof count is bounded by
the closed evidence-slot census, not lifetime rotations. Tombstones authenticate
both removal and selected prior producers. Authority history remains
FULL_REQUIRED.

Retention keeps destination/anchor lineage, physical identity/observations,
authority history, and run audit FULL_REQUIRED. Terminal attempt history alone
may use checkpoint compaction. Compaction requires selected non-pending
classification, checkpoint, plan, and completion in order and never applies to
PENDING/UNKNOWN.
AUDIT_DEGRADED permits only existing recovery/retry/cleanup, selected attachment,
and ordinary non-release ticks; it blocks new promotion/bootstrap/certification,
unrelated authorization/attachment, compaction, and audit finalization.

## Review attack surface

Executable mutants cover missing/extra/partial fields, coordinated digest
substitution, domain/order/type/null framing changes, source/path collisions,
fake lost conflicts, pointer deletion/bare absence, invalid cleanup cells/edges,
mixed epochs, incomplete rotation census, candidate core fields, reordered
native/post receipts, attachment-to-summary confusion, reservation forks,
lifetime caps, sparse-root/table substitution, run-current recursion, packet
purpose overflow, compaction ordering, v1 at authority paths, and all hostile
reflective shapes. Cross-OS conformance reuses the same canonical goldens
without changing authority.

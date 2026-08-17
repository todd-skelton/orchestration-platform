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

The authority version dispatch is unified and exact:

| Contract family | Current authority version | Diagnostic-only versions |
| --- | --- | --- |
| authority rotation identity | `state-mutation-authority-rotation-id/v2` | `v1` |
| authority value | `state-mutation-authority-value/v3` | `v1`, `v2` |
| history empty/nonempty root | `authority-history-empty-root/v2`, `authority-history-root/v2` | corresponding `v1` |
| authority successor core / append receipt | `state-mutation-authority-successor-core/v2`, `authority-history-append-receipt/v2` | corresponding `v1` |
| run intent / checkpoint core / current value | `pointer-mutation-run-intent/v2`, `pointer-mutation-run-checkpoint-core/v2`, `pointer-mutation-run-current-value/v2` | corresponding `v1` |
| commit evidence | `pointer-mutation-commit-evidence/v3` | `v1`, `v2` |
| evidence slot / packet | `pointer-evidence-slot/v3`, `pointer-evidence-packet/v3` | `v1` capped fixtures and `v2` twelve-slot records |
| node inventory, coordinator, and census | the named `v1` schemas in `supervisor-contract.md` | none |

Only current versions appear in ordinary exports/dispatch. Diagnostic versions
are readable only through `diagnostic`, cannot migrate, and refuse at every
current authority path.

The current registry uses the approved authority contracts:

- pointer graph: `pointer-current-tip/v1`,
  `pointer-cas-proposal-receipt/v2`, `pointer-conflict-receipt/v1`,
  `pointer-tombstone-value/v1`, and `authority-retention/v1`;
- epoch/history: `state-mutation-authority-value/v3`,
  `state-mutation-authority-successor-core/v2`,
  `authority-history-leaf/v1`, `authority-history-node/v1`,
  `authority-history-empty-root/v2`, `authority-history-root/v2`,
  `authority-history-update-proof/v1`,
  `authority-history-append-receipt/v2`, `authority-membership-evidence/v1`,
  `pointer-evidence-slot/v3`, and `pointer-evidence-packet/v3`;
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
- commit journal: `pointer-mutation-run-checkpoint-core/v2`,
  `pointer-mutation-run-current-value/v2`,
  `pointer-mutation-run-selector-post-selection-observation/v1`, and
  `pointer-mutation-commit-resolution/v1`, with the composed
  `pointer-mutation-run-checkpoint-evidence/v2` and
  `pointer-mutation-run-intent/v2`,
  `pointer-mutation-commit-evidence/v3` envelopes and closed
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
  `state-mutation-destination-owner-retention/v1`,
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

`pointer-cas-proposal-receipt/v1`, `state-mutation-authority-value/v1|v2`,
`authority-history-empty-root/v1`, `authority-history-root/v1`,
`authority-history-append-receipt/v1`, the capped serialized authority-history
table, `pointer-evidence-packet/v2`, `pointer-evidence-slot/v2`, run core/value
v1, run intent v1, commit evidence v1/v2, rotation identity v1, the twelve-slot
packet, and the thirteen superseded active-release, gate, fence, launch,
cleanup-head, and authorization v1 schemas
exist only under the frozen `diagnostic` namespace. `diagnostic.parseContract`
may read their historical bytes. They are not ordinary/deep exports;
`parseContract` and every canonical authority path refuse them. No migration
exists because no v1 authority was deployed.

Exact current versions are readable. The named
`platform-configuration/v0-fixture` alone is migratable. Missing, diagnostic,
other legacy, malformed, unknown, and future versions are refused.

## Pointer registry and framing

The closed runtime pointer registry has exactly thirteen kinds and, for each kind, exact
tip path, roots, archives, genesis mode, source tokens, retention class, and
value schemas. Transaction path bindings are lowercase UUIDv7; unused/extra,
wrong-family, alternate, or partial bindings refuse. The fixed singleton lock is
`installation/state-mutation.lock`. `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_ATTEMPT_ACCUMULATOR`, and `RECOVERY_ATTEMPT_RESERVATION` each accept
exactly `recovery-fence-v2` or `cleanup-gate-pre-fence-v2`; all other runtime
kinds require `none`. Unknown, differently cased/encoded, cross-family, or
colliding paths/tokens refuse.

The thirteen kinds are `ACTIVE_RELEASE`, `ACTIVATION_CLEANUP_GATE`,
`ACTIVATION_RECOVERY_FENCE`, `ACTIVATION_RECOVERY_LAUNCH`,
`RECOVERY_AUTHORIZATION_STATE`, `RECOVERY_AUTHORIZATION_ATTACHMENT`,
`RECOVERY_ATTEMPT_ACCUMULATOR`, `ACTIVATION_CLEANUP_ARCHIVE_HEAD`,
`AUTHORITY_RETENTION`, `RECOVERY_ATTEMPT_RESERVATION`,
`STATE_MUTATION_AUTHORITY_ROTATION`, `POINTER_MUTATION_RUN_CURRENT`, and
`AUTHORITY_NODE_MATERIALIZATION_RUN`.

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
and bare absence never regains authority. The ten tombstone-enabled families
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
and the thirteen-kind census. `state-mutation-authority-value/v3` binds
`historyRootKind=EMPTY|NONEMPTY`: E0 selects FULL_REQUIRED
`authority-history-empty-root/v2` (`Dhe`, count `"0"`) and empty `Dnir`, E1 proves
EMPTY→NONEMPTY, and later En proves NONEMPTY→NONEMPTY. Nonempty `Dh` requires
count `>=1` and latest ordinal `count-1`; membership against EMPTY refuses.
Lifetime-stable `G` excludes rotating helper/profile/ABI/lock/state-component
facts. En validates deterministic rotation, exact 256-sibling EMPTY→PRESENT
update, append receipt, successor root/count, and historical membership against
the live current root. Serialized tables are diagnostic only. ISS-004 owns
locks, live handles, CAS, reconciliation, tombstones, history writes, and
context revocation.

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

`pointer-evidence-packet/v3` is an exact purpose union. `HISTORICAL_READ`
requires `currentCommit=null` and a scoped read handle; `MUTATION_COMMIT`
requires exact intent/run/current selector plus a live mutation handle. The nine
same-epoch commit observations and new proposal/readbacks bind the live current
selection. Historical envelopes keep their producer epoch and use deduplicated
256-sibling membership projections rooted in that live selection; no caller-
chosen root or unsigned row authenticates them. Packet proof count is bounded by
the closed evidence-slot census, not lifetime rotations. Tombstones authenticate
both removal and selected prior producers. Authority history remains
FULL_REQUIRED.

The packet serializes the exact global identity, selected current authority,
composed authority-history binding, thirteen registry-ordered typed evidence
slots, deduplicated membership envelopes, and (for `MUTATION_COMMIT`) the
composed nine-checkpoint run. Digest-only bags, reordered/duplicate slots,
unselected producer triples, and a mutation purpose without a current commit
refuse. `ordinaryEpochSequence` and `validateEpochSequence` remain diagnostic
helpers only and are absent from the current root export.

Retention keeps destination/anchor lineage, physical identity/observations,
authority history, and run audit FULL_REQUIRED. Terminal attempt history alone
may use checkpoint compaction. Compaction requires selected non-pending
classification, checkpoint, plan, and completion in order and never applies to
PENDING/UNKNOWN.
AUDIT_DEGRADED permits only existing recovery/retry/cleanup, selected attachment,
and ordinary non-release ticks; it blocks new promotion/bootstrap/certification,
unrelated authorization/attachment, compaction, and audit finalization.

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

Authority membership recomputes each leaf epoch key and authenticates it
against the exact selected current authority's `G`, nonempty history root, and
count. Packet memberships are sorted by epoch key, deduplicated, and contain no
unused proofs. Append receipts, update proofs, and prior/successor root
kind/digest/count fields agree exactly, and every leaf authority `Dp` equals
the lifetime-stable authority `Dp` committed by `G`. Sparse nodes use the
content-addressed canonical `installation/state-mutation-authority-history/nodes/<node-digest>.json`
path. A single-update witness remains exactly 256 siblings; lifetime node
inventory uses sorted cursor pages of at most 256 nodes, so validation has no
lifetime rotation or node-count cap.

Commit evidence includes a closed immutable intent. Every segment and core
repeats and validates target kind/path/install/project/state/transaction/source
identity, and run IDs are recomputed from the selected authority and prior
checkpoint. The terminal evidence is a closed outcome union: `SELECTED`
carries the selected target; `LOST_CONFLICT` carries the recomputed proposed
loser value/receipt plus a real selected winner and conflict receipt, never a
loser tip; and `UNKNOWN_TERMINAL` carries the recomputed proposal plus a bounded
unknown observation and no selected target. A mutation packet's top authority
equals its commit authority. Its registry slot equals the selected target for
`SELECTED`, the real winner for `LOST_CONFLICT`, and is empty for an unknown
target. Every checkpoint preserves the full kind/path/install/project/state/
transaction/source/`Dp`/mutation/run identity tuple.

Current authority history additionally requires selected
`authority-node-inventory-empty-root/v1|authority-node-inventory-root/v1`,
materialization plan/filesystem observation/membership entry/batch schemas, the
singleton `authority-node-materialization-run-value/v1`, and authenticated
census page/terminal records. Filesystem dispositions and membership actions
are separate closed unions. Roots/counts are selected by history root v2 and
authority value v3; page chains cannot assert their own completeness.

The coordinator is one stable `AUTHORITY_DP`-scoped pointer whose ordinal never
resets. Exact lifecycle edges enforce one active plan and finish-only recovery.
Authority rotation alone uses the exact checkpoint-6 E(n)→E(n+1) handoff:
fresh E(n+1) reproduces `Drh`, terminalizes checkpoint 8, then produces `Dhand`
for coordinator FINISHING. All other commits remain single-epoch. Earlier
authority root/value/append/core/run/packet versions and the twelve-kind census
are diagnostic-only and refused at current paths.

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

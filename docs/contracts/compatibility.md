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

The current registry retains unaffected generic v1 contracts and adds these
ISS-002 authority contracts:

- pointer graph: `pointer-current-tip/v1`,
  `pointer-cas-proposal-receipt/v1`, `pointer-conflict-receipt/v1`,
  `pointer-tombstone-value/v1`, and `authority-retention/v1`;
- epoch/release/cleanup: `state-mutation-authority-value/v1`,
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
  `recovery-authorization-attachment/v1`.

The thirteen superseded active-release, gate, fence, launch, cleanup-head, and
recovery-authorization v1 schemas exist only in
`diagnosticSchemaDefinitions`. `parseDiagnosticContract` can read their exact
historical bytes. `parseContract` and every canonical authority path refuse
them. No migration exists because no v1 authority was deployed.

Exact current versions are readable. The named
`platform-configuration/v0-fixture` alone is migratable. Missing, diagnostic,
other legacy, malformed, unknown, and future versions are refused.

## Pointer registry and framing

The closed pointer registry has exactly eleven kinds and the canonical paths in
`supervisor-contract.md`; the fixed singleton lock is
`installation/state-mutation.lock`. Launch/accumulator/reservation sources are
exactly `recovery-fence-v2` or `cleanup-gate-pre-fence-v2`; all other kinds use
`none`. Unknown, differently cased/encoded, cross-family, or colliding paths and
tokens refuse.

Framing `F` is UTF-8 `orchestration-platform`, NUL, domain, NUL, U32 part count,
then closed type tag, U64 byte length, and bytes for every part. Digests are raw
32 bytes and nullable digests have a distinct null type. Goldens pin:

- Dp under `pointer-instance/v2`;
- Dv under `pointer-value/v2`;
- Dr under `pointer-receipt/v2` over
  `pointer-cas-proposal-receipt/v1`;
- Dt under `pointer-tip/v2` over `pointer-current-tip/v1`;
- mutation ID under `pointer-mutation-id/v2`;
- Dc under `pointer-conflict-receipt/v1`.

Values never contain the receipt/tip selecting them. Proposals are create-once
`VALUE_PROPOSED|TOMBSTONE_PROPOSED` and classify only as PENDING, SELECTED,
LOST_CONFLICT, COMPACTED, or UNKNOWN from exact winner evidence. Terminal
authority selects `pointer-tombstone-value/v1`; the current tip is never deleted
and bare absence never regains authority.

## Pure semantic validators

Cleanup admits exactly ten lifecycle/publication pairs and twelve mutation
edges; an already-selected pair reduces to NO_APPEND. Fence history is exactly
PREPARED then optional POST_ACTIVATION. Dense root/head histories bind ordinal,
previous canonical digest, and exact edge.

State mutation validators pin the fixed lock sequence, same authority epoch
rereads, and a rotation census containing all other ten pointer kinds with zero
PENDING/UNKNOWN. They validate evidence only; ISS-004 owns the kernel lock,
private capability, CAS, reconciliation, tombstones, and rotation writes.

Recovery authorization core has closed BOOTSTRAP/SUCCESSOR unions. It excludes
gate/lifecycle/consume/revoke/attachment and
`candidateOperationManifestDigest`; every excluded-field insertion refuses.
State validates CREATED, native-consume then CONSUMED plus post-consume receipt,
native removal then REVOKED plus post-revoke receipt. Attachment binds a LIVE
descriptor, not a future terminal summary.

Reservations bind one UUIDv7 (uniqueness only) to a predecessor accumulator
triple/genesis. Descriptor, terminal summary, and accumulator are separate.
First/later accumulator formulas use domain-separated raw digests. There is no
lifetime attempt array or generation cap; a fixed packet verifies only current
gate/fence/launch, reservation, descriptor, attachment, accumulator, initial
records, and at most one previous terminal summary.

Retention is FULL_REQUIRED except eligible terminal attempt history. Compaction
requires checkpoint, plan, completion in order and never applies to PENDING.
AUDIT_DEGRADED permits only existing recovery/retry/cleanup, selected attachment,
and ordinary non-release ticks; it blocks new promotion/bootstrap/certification,
unrelated authorization/attachment, compaction, and audit finalization.

## Review attack surface

Executable mutants cover missing/extra/partial fields, coordinated digest
substitution, domain/order/type/null framing changes, source/path collisions,
fake lost conflicts, pointer deletion/bare absence, invalid cleanup cells/edges,
mixed epochs, incomplete rotation census, candidate core fields, reordered
native/post receipts, attachment-to-summary confusion, reservation forks,
lifetime caps, packet overflow, compaction ordering, v1 at authority paths, and
all hostile reflective shapes. Cross-OS conformance reuses the same canonical
goldens without changing authority.

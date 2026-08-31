# Bootstrap contract decisions

These decisions are implementation authority for the bootstrap roadmap. A
worker may challenge one only by filing a replacement decision with evidence;
it may not silently choose another equally plausible contract.

## Encoding and identity

- Authority records use UTF-8 JSON with lexicographically ordered object keys,
  no insignificant whitespace, LF termination, and SHA-256 over the exact
  bytes.
- Timestamps use RFC 3339 UTC with exactly millisecond precision. Durations use
  integer milliseconds. Authority/history/run ordinals and counts use canonical
  decimal strings (`"0"|[1-9][0-9]*`) bounded by the JavaScript safe-integer
  range. Parsers validate grammar and compare the decimal string against
  `Number.MAX_SAFE_INTEGER` by length and lexicographic order before any
  numeric conversion; an out-of-range value refuses rather than wrapping or
  truncating. At the supervisor cadence that bound exceeds any plausible
  installation lifetime by many orders of magnitude. No arbitrary-precision
  numeric type exists in authority contracts.
- Durable identities use lowercase UUIDv7 text. Content identities use
  lowercase SHA-256 hex.
- Contract-relative paths use `/` separators and may not contain `..`, an
  absolute prefix, or a drive designator. Host paths cross a contract boundary
  only as canonical `file:` URLs.
- Unknown fields on authority records are refused. Advisory records preserve a
  named degraded result rather than guessing.

### Closed records and arrays

Public parse, serialize, and nested-evidence entry points first take a
detached closed-record snapshot. They reject proxies (including transparent
proxies), symbols, inherited or non-enumerable fields, accessors, exotic/class
instances, and descriptor/prototype traps. Null-prototype records are allowed
when their own enumerable data fields otherwise match exactly.

Arrays must be same-realm arrays with exactly `Array.prototype`, dense indices
plus `length` and no other `Reflect.ownKeys`. `length` is a non-enumerable,
non-configurable data descriptor whose `writable` is true or false. Every index
is an enumerable data descriptor; mutable, sealed, and frozen writable/
configurable combinations are accepted. Holes, symbols, extras, accessors,
custom iterators/prototypes, subclasses, cross-realm arrays, and proxies refuse.
Descriptor values alone are copied; user code is never invoked.

### Framed pointer digests

Pointer contracts use SHA-256 over UTF-8 `orchestration-platform`, NUL, the
closed domain tag, NUL, a big-endian unsigned 32-bit part count, then for each
part a closed one-byte type tag, big-endian unsigned 64-bit byte length, and
bytes. Digests embedded as parts are raw 32-byte values. Canonical JSON is an
explicit bytes part.

`Dv` hashes a family value, `Dr` hashes the create-once
`pointer-cas-proposal-receipt/v1` that binds the prior `Dt/Dv/Dr`, successor
`Dv`, and closed bootstrap/selected producer union, and `Dt` hashes a tip
containing `Dv+Dr`. Values do not contain their selecting proposal or tip.
Checkpoint cores and ordinary terminal resolutions likewise exclude the run-current
value/proposal/tip that selects them; only a downstream post-selection
observation may feed a later core. Pointer path, instance digest,
proposal/conflict paths, mutation ID, tombstone, archive, and FULL_REQUIRED preservation
are exactly those in `supervisor-contract.md`.

The `Normative external bootstrap schema ledger` in
`supervisor-contract.md` is incorporated into this decision authority. Its
literal external physical-identity, observation, destination-owner,
successor-review, anchor, and E0 member censuses, branch matrices, framed
formulas, persistence paths, exclusions, and cross-record equalities are not
implementer-selected. No other prose or digest-table label is a JSON member
name for those families.

### Authenticated common-CAS selected-object locator ledger

The common current tip exposes exact `Dp`, `Dv`, and `Dr`, and its canonical
bytes recompute `Dt`, but mutation-addressed immutable paths require a mutation
ID and proposal paths additionally require the prior-tip bucket. A selected
tip therefore cannot construct its own value/proposal bytes or any historical
prior tip from the mutation-addressed paths alone. Directory enumeration,
latest-file choice, an unauthenticated index/journal, symlink following, or a
caller-supplied mutation ID is not authority.

The existing common proposal parser enforces the two-row proposal invariant
before any locator or family composition runs: only
`VALUE_PROPOSED/SELECT` and `TOMBSTONE_PROPOSED/REMOVE` parse. Every crossed
intent/outcome pair refuses, and the public classifier returns `UNKNOWN` for
that malformed evidence rather than `PENDING`. This common closure is distinct
from the locator's additional equality between the trusted position mode and
the already-valid proposal row.

Every proposed selection writes the exact same canonical value, proposal, and
tip bytes to these create-once content-addressed object paths before attempting
the canonical current-tip CAS:

```text
installation/pointer-cas/<Dp>/objects/values/<Dv>.json
installation/pointer-cas/<Dp>/objects/proposals/<Dr>.json
installation/pointer-cas/<Dp>/objects/tips/<Dt>.json
```

`Dp`, `Dv`, `Dr`, and `Dt` are lowercase SHA-256 path components. These are
immutable byte aliases, not new records, schemas, envelopes, digests, indexes,
heads, or selection authority. Value and proposal bytes are byte-identical to
their mutation-addressed originals; tip bytes are byte-identical to the
candidate current-tip bytes. Existing bytes must match exactly. All three
aliases are written and read back before CAS. A losing candidate may leave
unselected aliases, but they grant nothing because no authenticated selected
tip names their exact digest tuple. No alias may be deleted or compacted.

A selected read starts only from canonical current-tip bytes obtained at the
registered pointer path plus the independently trusted pointer identity. The
pure locator validator has exactly four non-persisted inputs:

```text
expectedIdentity
proposal
tip
value
```

`expectedIdentity` is the existing closed eight-member pointer identity:

```text
canonicalPointerPath
installationId
pointerKind
positionEvidence
projectId
sourceToken
stateRootDigest
transactionId
```

The validator snapshots all four inputs, recomputes `Dp` from the exact
identity and registered canonical path/position rules, parses the closed tip
and proposal, and requires tip pointer kind/path instance equal the expected
kind/`Dp`. It also requires proposal `pointerKind` equal that trusted kind and
proposal `positionDigest` equal
`computePointerPositionDigest(expectedIdentity.pointerKind, expectedIdentity.positionEvidence)`.
The trusted position mode also fixes the only admitted proposal pair: `VALUE`
requires `VALUE_PROPOSED/SELECT`, and `TOMBSTONE` requires
`TOMBSTONE_PROPOSED/REMOVE`. Crossed intent/outcome pairs refuse even if the
proposal and tip are coherently rehashed.
It recomputes `Dv` under the trusted kind from the supplied value, `Dr` from
the supplied proposal, and `Dt` from the supplied tip; requires proposal
successor `Dv`, proposal `Dp`, tip `Dv`, and tip `Dr` equal those recomputed
values. It also recomputes the proposal mutation ID from the trusted identity,
trusted position, exact proposal prior tuple, recomputed successor `Dv`, and
proposal outcome using the existing outcome-only `pointer-mutation-id/v1`
formula, and requires exact equality to `proposal.mutationId`. Proposal intent
is derived from trusted position mode and is deliberately not a redundant
mutation-ID preimage part. The validator returns the exact recomputed
`Dp/Dv/Dr/Dt`, the exact nullable prior `Dt/Dv/Dr` triple, and the detached
parsed records.
The family composition validator must still parse the value under the exact
schema admitted by the pointer registry; generic location never treats an
open value object as semantically valid authority.

After the current node passes, its exact `Dp/Dv/Dr/Dt` constructs the three
object paths above. The pure ISS-002 validator owns one selected node only. It
requires the proposal prior `Dt/Dv/Dr` to be either complete or all null and
returns that tuple; it does not claim that null is an authorized family genesis
or that any non-null ancestor exists. ISS-004 iteratively constructs the prior
three paths, performs canonical byte reads, invokes the same single-node
validator, rejects digest/path mismatch and cycles, and continues until the
family composition proves an authorized null terminal. Missing, forked,
reordered, falsely terminated, or otherwise incomplete history is `UNKNOWN`.
This makes history iteratively constructible without adding a history
container, reader callback, mutation ID, enumeration, or second current head.

Canonical persistence is an ISS-004 byte-read obligation, not a claim of the
record-only pure validator. Each current or historical alias read must parse
exact canonical bytes, recompute the digest in its filename, and reproduce the
same single-node result before the record is used. Reordered JSON, whitespace,
invalid UTF-8, missing LF termination, or other noncanonical bytes refuse there.

The locator does not generically locate family root/archive records. Their
registered family paths are constructed only by the family composition from
the independently trusted identity and parsed selected value. For cleanup gate
and recovery fence, the trusted transaction identity constructs the exact root
path and the parsed selected head supplies the root digest; for other families
their independently reviewed ledger owns the corresponding bindings. Missing,
unreadable, noncanonical, conflicting, digest-mismatched, path-mismatched, or
semantically invalid selected objects or required family roots are
`FULL_REQUIRED UNKNOWN` and block mutation. Mutation-addressed originals are
not a fallback when the required content path cannot be constructed from
authenticated selected evidence.

The order has no authority cycle. Candidate code may materialize immutable
aliases, but only stable external authority may CAS the canonical current tip.
Alias bytes never enter the producer epoch, capability, or candidate verdict;
their existing `Dv/Dr/Dt` identities are already upstream of selection. A
candidate cannot certify itself by writing objects that no selected tip names.

This slice authorizes only the three pure path constructors and the total pure
four-input selected-evidence validator over supplied records. It authorizes no
filesystem read/write, directory enumeration, alias materialization, current-
tip read, proposal/CAS, conflict resolution, capability, command, broker call,
family root/archive composition, deletion, compaction, or runtime mutation.
ISS-004 owns later create-once alias write/read-back ordering and authenticated
current-tip/family-record reads under the stable release mutation path.

Compatibility evidence must pin all three paths and every digest component;
cross value/proposal/tip paths and `Dp/Dv/Dr/Dt`; mutate every expected-identity
member and every selected record member independently and in coordinated
rehashes; independently delete proposal-kind, proposal-position, mutation-ID,
and position-mode-to-intent/outcome equalities;
crossed-pair evidence must fail the common proposal parser and classify as
`UNKNOWN` before locator use;
return complete/null prior tuples and reject partial tuples, wrong-family,
hostile, and orphan current nodes; and prove generic validation alone cannot
admit an invalid family value. Structural multi-node tests may compose repeated
single-node calls only to prove path constructibility and tuple handoff; they
make no completeness, terminal, missing-object, or source-byte claim. ISS-004
tests own iterative missing/fork/reorder/cycle/false-terminal cases,
noncanonical persisted bytes, and their deletion mutants. Deleting any path
component, current-node identity/position/selected-graph equality, or prior-
tuple completeness check must make an ISS-002 committed mutant survive and
therefore fail the suite.

### Recovery-attempt reservation identity ledger

This ledger fixes only the constructible competition-bucket identity that must
exist before a recovery attempt can be reserved. It deliberately does not fix
`recovery-attempt-reservation/v1` value bytes, descriptor inputs, lifecycle
composition, attempt-log records, an archive, or a tombstone. Those downstream
records remain unauthorized until their own literal ledgers pass removal
review.

The pure predecessor-key function has exactly one closed non-persisted input
with these five members in ascending canonical JSON member order:

```text
predecessorReceiptDigest:nullable sha256
predecessorTipDigest:nullable sha256
predecessorValueDigest:nullable sha256
sourceToken:cleanup-gate-pre-fence|recovery-fence
transactionId:uuid-v7
```

The predecessor triple is exactly all null for tagged genesis or all non-null
for one selected predecessor attempt-log node. Partial triples refuse. This
structural function does not decide that a non-null triple is terminal,
selected, current, or in the same complete attempt-log history; the later
attempt composition owns those equalities.

The sole predecessor key is:

```text
Kreservation = SHA256(frame(
  "recovery-attempt-reservation-predecessor/v1",
  transactionId text,
  sourceToken text,
  0x00 genesis | 0x01 selected-predecessor,
  when selected: predecessorTipDigest raw32,
                 predecessorValueDigest raw32,
                 predecessorReceiptDigest raw32))
```

The branch tag is one fixed raw byte, not enum text or caller-selected numeric
data. Transaction and source remain explicit parts even though the constructed
path also contains them: the key is a reusable opaque path component and must
change under a moved transaction or source without relying on its parent
directory. UUID time and digest lexical order grant no attempt ordering.

The canonical reservation pointer path is exactly:

```text
installation/activation-recovery-launches/<transactionId>/<sourceToken>/reservations/<Kreservation>.json
```

The path constructor consumes the same parsed key input and never accepts a
caller-supplied key beside it. Alternate source spellings, raw predecessor
digests in the path, directory enumeration, latest-file selection, or a random
UUID path component grant nothing. Competing attempt UUIDs for the same
predecessor deliberately share this path and compete through the common CAS;
the future selected reservation value and common `Dv` distinguish them.

`RECOVERY_ATTEMPT_RESERVATION` is the one current pointer family whose
non-identity path component is intentionally absent from position. The common
pointer identity dispatcher therefore uses the existing canonical-path-derived
`Dp` route for this family: it parses the registered path template, requires
the path transaction and source equal the closed identity members, requires the
predecessor-key segment be lowercase SHA-256, reconstructs the exact path, and
then applies the unchanged `pointer-instance/v1` formula. The public common
`computePointerInstanceDigest`, `computeMutationId`, and selected-object locator
all use that same family dispatch; callers do not choose between two `Dp`
formulas. No digest formula or public identity census changes.

Canonical-path-derived `Dp` proves only structural path identity. It does not
prove that the key names the authorized predecessor. The later reservation
family composition must take the actual tagged-genesis or selected terminal
attempt-log predecessor evidence, recompute `Kreservation` and the whole path,
and require equality to the independently trusted identity before generic
locator success is used. A different well-formed key remains another
structurally valid identity, not evidence of a valid reservation lineage.

Reservation VALUE position evidence is exactly the closed record:

```json
{ "mode": "VALUE", "parts": {} }
```

It hashes only under the already-registered
`attempt-reservation-position/v1` domain. `attemptId` and `Kreservation` are
not duplicated in position: the future value `Dv` binds the attempt and the
pointer `Dp` already binds the constructed path containing the key. Missing or
extra outer/nested members, nonempty parts, TOMBSTONE mode, cross-family
evidence, or generic common-position bypass refuses. Reservation tombstone
position remains deferred to the later reservation archive ledger.

This slice authorizes only a total predecessor-key function, its exact
constructed reservation path, the closed empty-parts VALUE-position parser,
its specialized/common position-digest route, and the bounded common identity
dispatch above. It adds no schema or record
identity and authorizes no reservation value, UUID allocation, descriptor,
launch, attempt log, archive/tombstone, selected-history/currentness proof,
filesystem IO, proposal/CAS, capability, process start, broker call, command,
or runtime behavior.

Compatibility evidence must pin null and selected predecessor-key goldens;
cross every transaction/source/branch/triple input; refuse partial triples and
invalid scalar forms; prove the exact path changes with the recomputed key;
and cross empty/nonempty parts, VALUE/TOMBSTONE, nested extras, and another
family through both specialized and common position APIs. Hostile reflective
inputs are total. Constructed-path positives must produce one identical `Dp`
through the common identity helper, mutation ID, and selected-object locator
while retaining empty position. Malformed path keys or transaction/source
mismatch refuse structurally; a well-formed but wrong key is rejected only by
the later family composition. Deleting any key frame part, branch tag, path
relation, position closure, canonical-path identity dispatch, or common
position dispatch must make a committed mutant survive and therefore fail the
suite.

### Recovery-attempt reservation value ledger

This ledger fixes only the selected immutable values and pure lifecycle for
the reservation pointer whose identity is fixed above. Descriptor bytes,
launch/attempt-log records, authorization attachment, terminal archive and
tombstone composition, process creation/adoption, persistence, and mutation
authority remain separately unauthorized.

`recovery-attempt-reservation/v1` is a closed three-branch union. `RESERVED`
has exactly these eight members in ascending canonical JSON member order:

```text
activeReleaseTipDigest:sha256
attemptId:uuid-v7
cleanupGateTipDigest:sha256
lifecycle:RESERVED
predecessorAttemptLogTipDigest:nullable sha256
recordedAt:timestamp
recoveryFenceTipDigest:nullable sha256
schemaVersion:recovery-attempt-reservation/v1
```

`CONSUMED` and `TERMINAL` each have exactly the same eight members plus this
ninth member after `schemaVersion`:

```text
selectedAttemptLogTipDigest:sha256
```

Branch-only members are absent, never null. There is no reservation-schema
`TOMBSTONE` branch. After `TERMINAL`, later reviewed archive composition may
select the existing common `pointer-tombstone-value/v1`; bare absence or a
fourth reservation lifecycle never represents terminal state.

The value deliberately carries only selected `Dt` snapshot identities for
active release, cleanup gate, optional recovery fence, predecessor attempt
log, and selected current attempt log. For each family, independently trusted
pointer identity constructs `Dp`, and the authenticated common selected-object
locator reads the exact `Dt` object and derives its committed `Dv/Dr`. Copying
those triples into this value would add no locator or replay discriminator.
The later family composition must still parse each located value under its
exact family schema, walk required history, and prove currentness; a SHA-shaped
tip member alone grants nothing.

`attemptId` is the prebound random UUIDv7 selected by the reservation CAS.
UUID time provides uniqueness only and never orders attempts. The exact
reservation predecessor key and path do not contain the attempt ID; competing
attempt IDs for one predecessor therefore race one pointer selection.

The value has no second launch-definition, argv, executable, shim,
declared-user, or process-tree digest. The installed shim/native definition is
immutable after installation, already bound to installation/project/state/user
authority and read-back, and successors never rewrite it. The selected active
release plus trusted pointer identity therefore fixes the reviewed launch
implementation; copying another digest would add no mutable-input or replay
discriminator. The later LIVE descriptor binds the actual process-tree/start
observation and must still refuse moved installed definition bytes. No raw
argv, path, user, executable, or process ID enters this engine record.

`predecessorAttemptLogTipDigest` is null only for the structurally possible
first-attempt genesis and non-null for the structurally possible later-attempt
arm. The parser does not decide whether a non-null tip is selected or terminal.
Later composition derives the attempt-log `Dp` from the trusted transaction and
source, locates the tip, derives its `Dv/Dr`, requires a terminal value and
complete history, and recomputes the reservation predecessor key/path.

`recoveryFenceTipDigest` is null only for the structurally possible pre-fence
source and non-null only for the structurally possible fence-backed source.
Because source is already in the independently trusted pointer identity, it is
not copied into the value. Later composition equal-binds null to
`cleanup-gate-pre-fence` and non-null to `recovery-fence`. Transaction,
installation, project, and state-root identities are likewise owned by `Dp`
and are not copied into the value.

The only pure value transitions are:

```text
null -> RESERVED
RESERVED -> CONSUMED
CONSUMED -> TERMINAL
```

Every non-genesis edge preserves exact `activeReleaseTipDigest`, `attemptId`,
`cleanupGateTipDigest`, `predecessorAttemptLogTipDigest`, and
`recoveryFenceTipDigest`, and requires
prior `recordedAt <= next recordedAt`. `RESERVED -> CONSUMED` introduces the
selected IN_PROGRESS attempt-log `Dt`; `CONSUMED -> TERMINAL` replaces it with
the selected TERMINAL attempt-log `Dt`. Those lifecycle meanings are later
composition obligations, not claims of the pure transition validator.
Self-loops, skips, reverse edges, a second RESERVED, mutation of any preserved
input, or another lifecycle refuse.

The only permitted dependency order is acyclic: selected RESERVED reservation
→ immutable LIVE descriptor → selected IN_PROGRESS attempt-log tip → selected
CONSUMED reservation → selected TERMINAL attempt-log tip → selected TERMINAL
reservation → later archive/common tombstone. The future IN_PROGRESS record may
bind only the upstream RESERVED selection; the future TERMINAL record may bind
only upstream descriptor/IN_PROGRESS/CONSUMED evidence. No attempt-log record
may contain the reservation value that names that same log tip.

The record has no standalone digest. Detached
`serializeContract("recovery-attempt-reservation/v1", value)` fails closed with
exactly `serialization:pointer-context-required` and returns neither bytes nor
an untagged digest. After parsing, canonical value bytes gain identity only
through common `Dv = pointer-value/v1("RECOVERY_ATTEMPT_RESERVATION", Dp,
canonical value bytes)` using independently authenticated `Dp`. No
reservation-specific digest helper or alternate schema exists.

This slice authorizes only a total closed three-branch parser, the pure
three-edge transition validator, compatibility registration, exact generic
serialization refusal, canonical detached bytes, and common `Dv` evidence. It
authorizes no descriptor/launch/log/archive/tombstone schema, launch-definition
producer, selected-family composition, history/currentness claim, filesystem
IO, proposal/CAS, UUID allocation, capability, process operation, broker call,
command, package, or runtime behavior.

Compatibility evidence must remove, add, rename, null, reorder, cross-type, and
cross-branch every member; pin canonical detached bytes for all three values;
attack both nullable structural cells; cover every legal and illegal transition
including equal timestamps and each preserved-field mutation; prove exact
generic serializer refusal, no untagged or standalone digest, common `Dv`
equality and `Dp` sensitivity, hostile reflective totality, and absence of
`descriptorInputsDigest`, `launchDefinitionDigest`, copied selected triples,
raw launch vocabulary, `READY_ONLY`, a terminal summary, and a
reservation-schema TOMBSTONE. Deleting
any closure, branch census, scalar/nullability check, transition edge,
preserved-field equality, inclusive time comparison, serializer refusal, or
public-surface exclusion must make a committed mutant survive and therefore
fail the suite.

### Recovery-attempt LIVE descriptor ledger

This ledger fixes only the immutable post-start descriptor immediately after a
selected RESERVED reservation. It does not define the process-start
observation bytes, launch-pointer value, attempt-log records, authorization
attachment, terminal facts, persistence, process adoption, or mutation
authority.

`recovery-attempt-descriptor/v1` is one closed LIVE-only record with exactly
these eight members in ascending canonical JSON member order:

```text
attemptId:uuid-v7
lifecycle:LIVE
processStartObservationDigest:sha256
reservationPredecessorKey:sha256
reservationTipDigest:sha256
schemaVersion:recovery-attempt-descriptor/v1
sourceToken:cleanup-gate-pre-fence|recovery-fence
transactionId:uuid-v7
```

There is no READY, READY_ONLY, TERMINAL, UNKNOWN, or TOMBSTONE descriptor
branch. The selected reservation is the sole durable pre-launch record. A
descriptor exists only after a process-start observation has been produced and
is immutable thereafter.

Its only canonical path is:

```text
installation/activation-recovery-launches/<transactionId>/<sourceToken>/attempts/<attemptId>/descriptor.json
```

The path constructor accepts only canonical UUIDv7 transaction/attempt IDs and
the two closed recovery source tokens. The record's transaction, source, and
attempt must equal the path inputs; a descriptor cannot move between attempts,
sources, or transactions.

`processStartObservationDigest` is the opaque identity of the exact downstream
process-substrate observation. Later ISS-005/ISS-030 composition must parse that
observation under its independently reviewed contract and prove exact native
argument bytes, installed definition read-back, process-tree identity, and
start event before treating the descriptor as LIVE. A SHA-shaped member alone
grants none of those facts. Raw argv, executable, shim, path, declared user,
process ID, process-tree members, provider/adapter vocabulary, or installed
definition bytes do not enter this engine record.

`reservationPredecessorKey` makes the selected reservation constructibly
locatable after a crash without forbidden directory enumeration. Transaction,
source, and key reconstruct its canonical path and `Dp`; `reservationTipDigest`
then names the selected RESERVED common `Dt`. Later family composition locates
and validates that exact selected graph, parses the
reservation value, requires lifecycle RESERVED, and equal-binds its attempt ID,
transaction/source pointer identity, active release, cleanup gate, optional
fence, and predecessor lineage. It also recomputes the key from the actual
tagged-genesis or selected terminal predecessor and requires exact equality.
The descriptor copies no reservation `Dp/Dv/Dr` siblings, authority triple,
release/gate/fence tips, predecessor triple, launch-definition digest, or
descriptor-input digest.

The descriptor identity is the sole domain-separated digest:

```text
Ddescriptor = recovery-attempt-descriptor/v1(canonical descriptor bytes)
```

implemented as one canonical framed part under domain
`recovery-attempt-descriptor/v1`. Detached generic serialization returns the
canonical bytes and `Ddescriptor`; there is no untagged digest or alternate
schema. Start time exists only in the authenticated process-start observation;
later composition requires that time to be at or after the selected
reservation's `recordedAt`. The descriptor does not copy an unauthenticated
second timestamp.

This slice authorizes only a total closed parser, canonical path constructor,
domain-separated digest/serialization, compatibility registration, canonical
byte goldens, and structural exclusions. It authorizes no process observation
schema or producer, launch pointer, attempt log, attachment, selected-family
composition/currentness claim, filesystem IO, proposal/CAS, capability,
process operation/adoption, broker call, command, package, or runtime behavior.

Compatibility evidence must remove, add, rename, null, reorder, and cross-type
every member; attack every scalar and lifecycle/source enum; pin canonical
bytes, path, and digest goldens plus transaction/source/attempt path movement;
attack the reservation predecessor key and prove it reconstructs the selected
reservation path without enumeration;
prove hostile reflective totality; and prove the public absence of READY_ONLY,
descriptorInputsDigest, launchDefinitionDigest, raw launch/process vocabulary,
attachment/log/archive schemas, and runtime authority. Deleting any closure,
scalar/enum check, path binding, digest domain, or public-surface exclusion must
make a committed mutant survive and therefore fail the suite.

### Recovery attempt-log ledger

This ledger fixes the immutable append-only records selected by the existing
`RECOVERY_ATTEMPT_LOG` pointer after a LIVE descriptor exists. It replaces the
deleted rolling accumulator and separate terminal-summary document; it does
not define launch-pointer values, process/terminal observation bytes,
authorization attachment bytes, archive/tombstone composition, persistence,
or mutation authority.

`attempt-log/v1` is a closed two-branch union. `IN_PROGRESS` has exactly these
nine members in ascending canonical JSON member order:

```text
attemptId:uuid-v7
descriptorDigest:sha256
lifecycle:IN_PROGRESS
ordinal:canonical safe-integer decimal
predecessorRecordDigest:nullable sha256
recordedAt:timestamp
schemaVersion:attempt-log/v1
sourceToken:cleanup-gate-pre-fence|recovery-fence
transactionId:uuid-v7
```

`TERMINAL` has the same nine members plus exactly these six members in their
ascending canonical positions:

```text
attachmentTipDigest:nullable sha256
channelDenialEvidenceDigest:sha256
processTerminalObservationDigest:sha256
revocationEvidenceDigest:nullable sha256
terminalDisposition:RETRYABLE|HANDOFF|ABORTED|COMPLETE
terminalOutcomeEvidenceDigest:sha256
```

Thus the complete TERMINAL census is:

```text
attachmentTipDigest
attemptId
channelDenialEvidenceDigest
descriptorDigest
lifecycle
ordinal
predecessorRecordDigest
processTerminalObservationDigest
recordedAt
revocationEvidenceDigest
schemaVersion
sourceToken
terminalDisposition
terminalOutcomeEvidenceDigest
transactionId
```

Branch-only members are absent, never null. There is no READY, LIVE, UNKNOWN,
summary, accumulator, checkpoint, compaction, or attempt-log TOMBSTONE branch.
Later removal uses the common pointer tombstone only after independently
reviewed archive composition.

The first record is necessarily IN_PROGRESS with ordinal `"0"` and null
`predecessorRecordDigest`. Every positive ordinal requires one SHA-256
predecessor record digest. Ordinals use the existing canonical decimal grammar
and safe-integer bound; overflow refuses before conversion.

Every later record has the immediately prior record's digest and ordinal plus
one. The only pure append edges are:

```text
null -> IN_PROGRESS
IN_PROGRESS -> TERMINAL
TERMINAL -> IN_PROGRESS
```

IN_PROGRESS→TERMINAL preserves exact transaction, source, attempt ID, and
descriptor digest. TERMINAL→IN_PROGRESS preserves transaction/source but
requires a different attempt ID and permits a new descriptor digest. Both
non-genesis edges require prior `recordedAt <= next recordedAt`, exact adjacent
ordinal, and `next.predecessorRecordDigest = Dattempt(prior)`. Self-loops,
skips, reverse/crossed lifecycle edges, gaps, forks, decreasing time, or changed
same-attempt identity refuse. The supplied-chain validator additionally keeps
the set of all prior attempt IDs and refuses any later IN_PROGRESS attempt ID
that has appeared anywhere earlier in the chain, including non-adjacent A/B/A
reuse.

The only canonical record path is:

```text
installation/activation-recovery-launches/<transactionId>/<sourceToken>/attempts/<attemptId>/<ordinal>-<lifecycle>.json
```

The path constructor accepts only the parsed record's UUIDs, closed source,
bounded ordinal, and lifecycle. Moving any of them changes or refuses the path.

The standalone record digest is exactly one domain-separated canonical frame:

```text
Dattempt = attempt-log/v1(canonical record bytes)
```

The exact closed bytes already commit lifecycle, bounded ordinal, and nullable
predecessor without ambiguous concatenation. Repeating those values as a tag,
bounded-decimal part, or raw-32 part adds no substitution discriminator and is
forbidden. Generic serialization returns canonical bytes plus `Dattempt`; no
untagged, rolling, summary, or alternate digest exists.

The `RECOVERY_ATTEMPT_LOG` VALUE position is the exact closed empty-parts
record `{mode:"VALUE",parts:{}}`. Its existing family position domain supplies
the common position digest. Tombstone position and archive composition remain
unauthorized in this slice.

`descriptorDigest` transitively commits the selected RESERVED reservation and
its constructible predecessor key/tip; copying reservation `Dp/Dv/Dr/Dt`, gate,
fence, release, process-start, or descriptor members adds no replay
discriminator. Later composition constructs the descriptor path from the log
transaction/source/attempt, parses exact descriptor bytes, recomputes its
digest, then locates and validates the selected reservation.

TERMINAL folds the minimum downstream identities needed to distinguish one
terminal reduction. `attachmentTipDigest` is null when no selected attachment
applies and otherwise names its selected common `Dt`.
`processTerminalObservationDigest`, `channelDenialEvidenceDigest`, optional
`revocationEvidenceDigest`, and `terminalOutcomeEvidenceDigest` are opaque
structural identities only. Later ISS-005/ISS-030/ISS-032 composition must
parse independently reviewed source records, prove exact exit/absence,
process-tree death, denied channels, revocation applicability, and the selected
disposition. SHA-shaped members, parser success, or a candidate/worker report
grant none of those facts. A TERMINAL record cannot authorize a prior launch or
retroactively authorize attachment.

One total supplied-chain structural validator accepts a dense array, requires
at least one record, applies the exact genesis/edge rules and global attempt-ID
uniqueness through the final supplied node, and returns the parsed immutable
prefix. It performs no lookup and makes no fullness/currentness claim. A valid
prefix is structurally valid. ISS-004 later locates each selected pointer graph
under a live external handle and requires the supplied final record to equal
the authenticated selected current value; only that composition can classify
a valid truncated suffix or noncurrent prefix as FULL_REQUIRED `UNKNOWN`.

This slice authorizes only the two closed parsers, canonical record path,
domain-separated digest/serialization, empty VALUE position route, pure edge/supplied-chain
validators, compatibility registration, canonical goldens, and structural
exclusions. It authorizes no observation/attachment/launch/archive schema,
selected-family/currentness composition, filesystem IO, proposal/CAS,
capability, process operation, broker call, command, package, or runtime
behavior.

Compatibility evidence must close every branch member and scalar, every
branch-only absence, both predecessor structural arms, all legal/illegal
edges, ordinal zero/one/MAX/overflow, inclusive time, preserved fields,
different/global attempt requirement, path movement, exact digest domain/frame,
canonical bytes, generic serialization, empty position, hostile records and
arrays, supplied-chain fork/gap/non-adjacent ID reuse, registry entries, and public exclusion
of accumulator/checkpoint/summary/retention and raw process/adapter vocabulary.
Valid-prefix truncation/current-tail mutants belong only to later ISS-004
selected-current composition.
Deleting any required relation must make a committed mutant survive and fail
the suite.

## Configuration and state roots

- Project configuration is `.orchestration/project.json`.
- The environment prefix is `ORCHESTRATION_`; explicit CLI flags override
  environment, which overrides project configuration, which overrides defaults.
- Each project declares a UUIDv7 `projectId`; repository location is not project
  identity.
- Default state roots are `%LOCALAPPDATA%/orchestration-platform/<projectId>` on
  Windows, `$HOME/Library/Application Support/orchestration-platform/<projectId>`
  on macOS, and `${XDG_STATE_HOME:-$HOME/.local/state}/orchestration-platform/<projectId>`
  on Linux.
- Durable logs redact home-directory prefixes and secrets. An interactive
  `config paths --reveal` command may print exact local paths only to the current
  terminal and never to a receipt or journal.

## Time and sessions

- Recorded authority uses UTC from an injected clock; elapsed local deadlines
  use a monotonic clock.
- Default lease freshness is 60 minutes, maximum session duration is 24 hours,
  and tolerated observed wall-clock skew is five minutes. All are explicit
  configuration bounded by schema.
- Wall-clock rollback, excess forward skew, or a missing monotonic observation
  makes session authority unknown; it never extends a lease.

## Filesystem and process implementation

- Node.js APIs are the default implementation. A small native helper is allowed
  only if the capability probe proves Node cannot provide a required guarantee
  on a target OS and the helper has a versioned protocol plus the same
  cross-platform conformance coverage.
- Correctness relies on create-once identity, compare-and-swap, verified
  read-back, the selected state-mutation epoch, its private capability, and the
  kernel-exclusive `installation/state-mutation.lock`; directory age, PID,
  timeout, lease, or unsigned lock bytes never grant authority.
- ISS-004 is a singleton in-process state service. It owns module-private
  WeakMap/nonces for current, historical-read, mutation-run, and producer
  projection handles; no generic CAS API or serializable capability exists.
  Handles are callback/lock-run scoped and revoke on release, process death,
  custody movement, or rotation. ISS-002 structural proof success alone is not
  authority.
- Runtime pointer history is one hash-chained, append-only
  `authority-history/v1` log selected by `state-mutation-authority-value/v1`.
  Records form the exact closed `GENESIS|ROTATION` union in
  `supervisor-contract.md`. Both bind shared successor core `Dsc`, whose closed
  census is `G`, authority `Dp`, successor ordinal, reviewed release manifest/
  installed bytes/subject/review, derived BOOTSTRAP_INSTALL or STABLE_PROMOTION
  operation `Dop`, helper/profile/ABI/lock/state-component, and custody
  instance/observation. GENESIS binds ordinal zero, genesis literal, and `Dgb`;
  `Dgb` binds selected owner/anchor ACTIVE, use intent, and bootstrap identity/
  transaction/grant. Downstream genesis-selection evidence binds E0 core/
  selection/readbacks/post receipt and owner/anchor CONSUMED without entering
  the record. ROTATION binds exact prior head, retiring `Dp/Dt/Dv/Dr`, and
  `Drot`, deterministically recomputed from rotation transaction, retiring
  authority/head, successor ordinal, `Dop`, and `Dsc`. No caller-
  supplied rotation-operation identity exists. Both branches exclude successor
  value/proposal/tip/head and downstream artifacts.
  Records live at canonical ordinal-derived paths: the walk constructs the
  path of record `n+1` from `n` and never enumerates a directory.
  Verification walks the complete chain from genesis and compares the selected
  head ordinal and digest. A missing record at or below the head refuses; the
  path at head plus one must be absent or match the armed rotation intent; the
  path at head plus two must be absent; a file outside the canonical ordinal
  paths carries no authority. Rotation occurs at most a few times per release,
  so the deliberately O(n) full walk is bounded in practice; no membership proof, sparse tree,
  secondary node inventory, or authenticated directory census exists. Missing,
  forked, reordered, or truncated chains refuse; history is FULL_REQUIRED and
  never compacted.
- Global identity `G` is lifetime-stable: installation, project, state-root,
  custody-instance, canonical authority path, and authority `Dp`. Rotating
  helper/profile/ABI/lock/state-component facts are excluded from `G` and
  remain bound by each selected authority value; changing a `G` field is a
  different installation identity and rotation refuses.
- The runtime pointer registry has eleven kinds. There is no materialization
  coordinator or retention/compaction kind; authority-history records are
  ordinary content-addressed files whose set completeness is proven by the
  chain walk alone.
- Every commit run is single-epoch. Authority rotation is an ordinary
  single-epoch mutation under the old capability that appends the chain
  record and then performs the authority CAS as its final action; it executes
  no checkpoint after that CAS under either epoch, and its run-current journal
  legitimately rests at CAS-armed across the selection. Rotation terminal
  truth is derived without another write: prior authority still selected plus
  an exact head-plus-one record matching the CAS-armed transaction is resumable
  under the old epoch; successor authority selected plus its exact selected
  chain record and the old CAS-armed checkpoint is `SELECTED`; every other
  combination is `UNKNOWN`. The commit evidence contract is the closed
  `ORDINARY|AUTHORITY_ROTATION` union: ordinary evidence retains stages 0–8 and
  resolution, while rotation binds only selected old checkpoint 5, expected
  successor/history/registry slot, and RESUMABLE/SELECTED/UNKNOWN. Rotation
  stages 6–8, ordinary resolution, later selector artifacts, and successor-
  epoch writes refuse. No post-CAS write occurs under the new epoch, no
  separate rotation receipt or coordinator exists, and no run crosses epochs.
- The `Dcommit` outcome byte is declaration-ordered and exact. ORDINARY uses
  `0x00=SELECTED`, `0x01=LOST_CONFLICT`, and
  `0x02=UNKNOWN_TERMINAL`. AUTHORITY_ROTATION independently uses
  `0x00=RESUMABLE`, `0x01=SELECTED`, and `0x02=UNKNOWN`. These are raw fixed
  one-byte framed parts, not enum text or caller-selected numbers.
- In `pointer-evidence-packet/v1`, `currentAuthoritySelection` and
  `authorityHistoryBinding` are both nullable. They are both non-null and
  mutually cross-bound for HISTORICAL_READ, ORDINARY MUTATION_COMMIT, rotation
  RESUMABLE, and rotation SELECTED. Rotation UNKNOWN requires both exactly
  null, matching its UNKNOWN packet authority and empty authority registry
  slot; it exposes no historical-read or mutation capability. Partial nullability
  refuses.
- `pointer-mutation-commit-evidence/v1` carries nullable
  `priorCheckpointEvidence`, a closed
  `pointer-mutation-run-checkpoint-evidence/v1` record and the sole source of
  the prior-checkpoint input to `pointer-mutation-run-id/v1`. ORDINARY run
  ordinal zero requires null; every positive ordinary run ordinal requires the
  immediately prior run's evidence. Its recomputed `Dcore`, selected
  run-current `Dp/Dt/Dv/Dr`, and `Dpost` bind the new run ID and checkpoint-zero
  predecessor fields. AUTHORITY_ROTATION requires run ordinal exactly zero and
  null prior evidence: a crash keeps the same checkpoint-5 CAS-armed run and
  re-drives its same CAS rather than opening a second run. The prior ordinary
  evidence repeats the exact target, platform identity, and old-authority
  epoch, and its run ordinal is exactly one less. Every current checkpoint
  target `Dp` is recomputed from its existing kind/path/installation/project/
  state/transaction/source tuple. Copied `Dp`, run ID, or coordinated sibling
  copies never substitute for either derivation.
- The ordinary-only `pointer-mutation-commit-resolution/v1` record has exactly
  `conflictReceiptDigest`, `outcome`, `outcomeEvidenceDigest`,
  `producerAuthorityPathInstanceDigest`, `producerAuthorityReceiptDigest`,
  `producerAuthorityTipDigest`, `producerAuthorityValueDigest`, `resolvedAt`,
  `schemaVersion`, `selectedTargetTipDigest`, `targetMutationId`,
  `targetPathInstanceDigest`, and `unknownEvidenceDigest` in canonical member
  order. The four non-null producer-authority digests are the selected run
  epoch `Dp/Dt/Dv/Dr` under their named fields and must equal the ORDINARY
  commit's old/packet authority tuple. `SELECTED`, `LOST_CONFLICT`, and
  `UNKNOWN_TERMINAL` respectively require only selected-target-tip,
  conflict-receipt, or fixed unknown-evidence digest and require
  `outcomeEvidenceDigest` to equal that one non-null arm. Its digest is domain
  `pointer-mutation-commit-resolution/v1` over canonical record bytes only.
  There is no `producerEpochKey`, membership index/proof, sparse-root fact, or
  rotation arm.
- `pointer-mutation-run-intent/v1` is one create-once closed
  `ORDINARY|AUTHORITY_ROTATION` union. Its exact common canonical member order is
  `canonicalPointerPath`, `commitKind`, `createdAt`, `globalIdentityDigest`,
  `intentKind`, `oldAuthorityPathInstanceDigest`,
  `oldAuthorityReceiptDigest`, `oldAuthorityTipDigest`,
  `oldAuthorityValueDigest`, `schemaVersion`, `targetMutationId`,
  `targetPathInstanceDigest`, and `targetPointerKind`. `schemaVersion` is the
  named v1 literal; `intentKind` is `SINGLE_EPOCH`; the target kind is one of
  the eleven registry kinds; path, timestamp, and all digests use the closed
  platform scalar rules. ORDINARY requires a non-rotation target and no extra
  members. AUTHORITY_ROTATION requires that target and additionally has
  `expectedHeadOrdinal`, `expectedRecordDigest`,
  `expectedSuccessorValueDigest`, `rotationInput`, `rotationInputDigest`, and
  `successorCoreDigest` in the single merged canonical order. `rotationInput`
  is the exact closed `state-mutation-authority-rotation-id/v1` record;
  `rotationInputDigest` is its recomputed `Drot`; and its `G`, retiring tuple,
  successor ordinal, and `Dsc` equal the common/expected fields. The intent
  digest frames, in order, branch tag; `G`; target kind/path/`Dp`/mutation; old
  authority `Dp/Dt/Dv/Dr`; for rotation `Drot`, expected successor `Dv`,
  expected head ordinal/record digest, and `Dsc`; then
  canonical union bytes, all under domain `pointer-mutation-run-intent/v1`.
  Creation time is bound only by the canonical bytes. A caller-selected epoch
  key or rotation identity is forbidden.
- `pointer-mutation-conflict-evidence/v1` is a non-persisted closed composition
  with exact canonical members `conflictReceipt`, `losingProposal`,
  `schemaVersion`, `selectedWinner`, `targetMutationId`, and
  `targetPathInstanceDigest`. The three nested values are respectively a closed
  `pointer-conflict-receipt/v1`, a closed
  `pointer-cas-proposal-receipt/v1`, and a closed generic
  `{ proposal, tip, value }` selected graph for one target `Dp` and mutation ID.
  Its digest frames target `Dp`/mutation, losing `Dr/Dv`, winner `Dt/Dv/Dr`,
  recomputed conflict digest, and canonical evidence bytes under domain
  `pointer-mutation-conflict-evidence/v1`. A `pointer-evidence-slot/v1` has
  exactly `pointerKind`, `schemaVersion`, and nullable `selectedEvidence` in
  canonical order:
  `selectedEvidence` is either the generic closed value/proposal/tip selection
  or this conflict composition. LOST_CONFLICT requires the latter; positive
  non-conflict outcomes require the former; unknown/empty outcomes require
  null. For ORDINARY SELECTED, the selected proposal has the target mutation ID
  and its recomputed tip digest equals
  `ordinaryResolution.selectedTargetTipDigest`; its named producer
  `Dt/Dv/Dr` equals the common old/KNOWN packet and resolution producer tuple.
  For ORDINARY LOST_CONFLICT, the conflict composition's losing proposal has
  the target mutation ID, its recomputed conflict-receipt digest equals
  `ordinaryResolution.conflictReceiptDigest`, and the losing proposal plus
  conflict receipt named producer `Dt/Dv/Dr` each equal that same run/packet/
  resolution tuple. Producer `Dp` has no duplicate in the generic proposal or
  conflict schemas and remains equal-bound by the resolution and common
  old/KNOWN packet fields. Hashing both siblings without these equalities is
  insufficient and refuses.
- The packet's `authorityHistoryBinding` is the closed non-persisted
  `authority-history-binding/v1` record with exactly
  `genesisSelectionEvidence`, `globalIdentityDigest`, `headOrdinal`,
  `headRecordDigest`, `records`, and `schemaVersion` in canonical order. The
  first member is the closed genesis-selection record; `records` is the dense
  complete ordinal-ordered `authority-history-record/v1` array from zero
  through head. Its digest frames `G`, bounded head ordinal, head digest, each
  recomputed record digest in order, recomputed genesis-selection-evidence
  digest, and canonical binding bytes under domain
  `authority-history-binding/v1`. It validates the full linear chain and
  cross-binds `G` and head to the packet's selected current authority value. It
  adds no path, checkpoint, tree, inventory, compaction, or capability.
- Rotation is forward-only once appended. A crash between chain append and
  authority CAS is resumable only by the same transaction under the old
  capability re-driving the same CAS to completion; the pending record is the
  single permitted head-plus-one excess and any other excess, gap, fork, or
  mismatch refuses.
- Full-chain validation remains O(n). `ISS-006` must prove a 1,000-record walk
  completes within five seconds independently on macOS, Windows, and Linux.
  Checkpointing stays parked until that measured gate fails on a supported OS;
  a speculative checkpoint is not part of the current authority surface.
- Worker launch uses native argument arrays without a shell. Exact launch
  identity, not PID alone, owns the process lifecycle.

## Engine and adapter boundary

- The engine sees opaque project, workspace, subject, and mutation identities.
- An adapter supplies workspace eligibility, cleanliness if relevant, immutable
  subject identity, external-authority observations, and mutation plans.
- Git branches, worktrees, labels, milestones, queues, CI, and deployments are
  adapter vocabulary, never engine contract fields.
- Engine review authority is `accepted`, `rejected`, or `unknown`. Planning
  modules may map a rejection to repair or replan dispositions without changing
  engine authority.
- Worker role is a closed enum: `implementation`, `review`, or `observer`.
  Missing, malformed, or unknown role refuses before ownership or process
  launch. Only an explicit `implementation` role may receive project mutation
  capabilities; `review` and `observer` receive none.
- Resource ownership is explicit and opaque to the engine. The adapter allocates
  and reclaims project workspaces; the host adapter allocates and reclaims host
  temporary resources. Dispatch retains the ownership/capacity claim until all
  bound process identities are exactly dead and every owner reports reclamation.
- Circuit-breaker lifecycle is engine mechanism; trip thresholds, affected
  project capabilities, and recovery policy are adapter facts. Unknown or stale
  breaker authority blocks the affected capability and cannot silently clear.
- A dispatch brief is closed `dispatch-brief/v1` structure emitted by a
  planning module and rendered into worker input by the host adapter through a
  deterministic, versioned template. No free-form operator or module prose
  field exists; every human-readable section derives from typed fields. The
  rendered bytes are digest-bound in the dispatch plan and launch identity.
- The closed dispatch-brief ledger has one envelope and exactly three nested
  record schemas: four record types in total. Their `schemaVersion` literals
  are respectively `dispatch-brief/v1`, `dispatch-brief-action/v1`,
  `dispatch-brief-directive/v1`, and `dispatch-brief-resource/v1`; omission,
  null, wrong-family, wrong-case, unknown, and future values refuse at each
  level. The `dispatch-brief/v1` envelope has exactly `action`, `directives`,
  `footprint`, `role`, and `schemaVersion`. `role` is exactly
  `implementation|review|observer`. `action` is one closed action record;
  `directives` is a dense array of 1–256 closed directive records; and
  `footprint` is a dense array of 0–256 closed resource records. Unknown fields
  refuse.
- `dispatch-brief-action/v1` has exactly `actionCoreDigest`, `actionKind`,
  `capabilityName`, `immutableSubjectDigest`, `moduleDescriptorDigest`, and
  `schemaVersion`. The three digests are SHA-256. `actionKind` and
  `capabilityName` match `[a-z][a-z0-9._:-]{0,63}` and are admitted only when
  their exact pair is declared by the selected release-reviewed
  `module-descriptor/v1`; they are lookup keys and are never rendered.
- The enclosing `module-action-plan/v1` carries one closed
  `dispatch-action-core/v1` projection with exactly `actionKind`,
  `capabilityName`, `immutableSubjectDigest`, `moduleDescriptorDigest`,
  `requestedRole`, and `schemaVersion`, in that canonical JSON member order.
  `schemaVersion` is literal `dispatch-action-core/v1`; the two identifiers use
  the admitted 64-character grammar and pair; the two digests are SHA-256; and
  `requestedRole` is exactly `implementation|review|observer`.
  `actionCoreDigest` is domain `dispatch-action-core/v1` over these ordered
  framed parts: text `schemaVersion`, text `actionKind`, text `capabilityName`,
  raw-32 `immutableSubjectDigest`, raw-32 `moduleDescriptorDigest`, and text
  `requestedRole`. The projection excludes `dispatchBrief`, `actionCoreDigest`,
  rendered brief bytes/digest, dispatch/launch identity, host-renderer artifact
  digest, and every field derived from any of them; no other plan member enters
  the digest. Before journaling step 4, the brief action's kind, capability,
  immutable subject, descriptor digest, and action-core digest must equal that
  projection. A moved plan, descriptor, subject, action, capability, member,
  frame, or order refuses without constructing a second plan or digest.
- A release-reviewed module descriptor contains a finite, dense, unique
  `dispatchCatalog` of 1–256 closed entries. Each entry has exactly
  `actionKind`, `capabilityName`, `code`, `directiveKind`, `planAccessor`, and
  `templateId`. `directiveKind` uses the closed nine-kind union below;
  `planAccessor` is exactly `IMMUTABLE_SUBJECT_DIGEST|MODULE_DESCRIPTOR_DIGEST|`
  `REQUESTED_ROLE`; and every other value matches
  `[a-z][a-z0-9._:-]{0,63}`. The catalog is digest-bound in the module
  descriptor and release manifest. Rows are unique by the exact resolver key
  `(actionKind,capabilityName,directiveKind,code)`, and each such key selects
  exactly one `(planAccessor,templateId)` pair; duplicate keys refuse when the
  accessor, template, or both differ. The descriptor's separately declared
  worker-required action/capability pair census has no duplicates and exactly
  equals the distinct pair projection of this catalog.
- A present directive is admitted only by an exact catalog resolver key for the
  brief action pair. `planAccessor` selects the named nonempty digest or closed
  role from the same exact `dispatch-action-core/v1`; `templateId` selects one
  release-reviewed renderer in the selected installed worker-host artifact;
  the fixed UTF-8 template body is 1–8192 bytes. Each present rendering
  contains that nonempty fixed body and the canonical selected scalar. No
  catalog key is rendered. The selected host resolves the pair only from its
  installed static module/renderer registry; filesystem, network, adapter,
  dynamic, and arbitrary schema-family resolution are forbidden. Thus the
  brief has no open reference-schema, external-reference, empty-renderer, or
  empty-typed-value surface.
- `dispatch-brief-directive/v1` has exactly `code`, `directiveKind`,
  `presence`, `schemaVersion`, and `subjectDigest`. `directiveKind` is exactly
  `ACCEPTANCE_EVIDENCE|CONSTRAINT|DECISION|NON_GOAL|OPERATOR_ACTION|`
  `REVIEW_ATTACK|SCOPE_EXCLUDE|SCOPE_INCLUDE|VERIFICATION`; `presence` is
  exactly `PRESENT|ABSENT`; and `subjectDigest` is SHA-256 and equals the brief
  action's `immutableSubjectDigest`. For `PRESENT`, `code` matches the bounded
  catalog-key grammar and the exact `(actionKind,capabilityName,directiveKind,`
  `code)` catalog row must exist. For `ABSENT`, `code` is null, the kind must be
  `OPERATOR_ACTION`, and no present operator-action directive may coexist.
  Every non-operator kind has at least one `PRESENT` directive and no `ABSENT`
  directive. Operator action is an exhaustive XOR: either one or more unique
  `PRESENT` operator-action directives and zero absent records, or exactly one
  `ABSENT` operator-action directive and zero present operator-action
  directives. Present directives are unique by `(directiveKind,code)`;
  multiple typed inputs require distinct reviewed catalog codes rather than
  repeated codes with substituted content. No directive kind may be omitted.
- The host groups directives in the closed kind order above and renders only
  the reviewed text and typed values selected by each admitted catalog row.
  It never renders raw action, capability, code, accessor, template, schema, or
  resource values. Each worker-host build is the sole producer of its own
  `hostRendererArtifactDigest`: the SHA-256 of that exact host package artifact
  containing its compiled renderer table and every fixed template byte.
  ISS-021 is the first producer; any additional registered host, including
  ISS-045, produces a distinct reviewed artifact under the same contract.
- Each host build also emits one closed `worker-host-identity/v1` projection
  with exactly `capabilityNames`, `hostRendererArtifactDigest`, and
  `schemaVersion`, in that canonical order. `schemaVersion` is literal
  `worker-host-identity/v1`; `hostRendererArtifactDigest` is SHA-256; and
  `capabilityNames` is a dense array of 1–256 identifiers matching
  `[a-z][a-z0-9._:-]{0,63}`, strictly increasing in ASCII byte order and
  therefore duplicate-free and case-sensitive. These are release-reviewed
  lookup keys and are never rendered. `workerHostIdentityDigest` uses domain
  `worker-host-identity/v1` and these ordered framed parts: text
  `schemaVersion`, raw-32 `hostRendererArtifactDigest`, then canonical
  `capabilityNames` array bytes. The identity excludes provider/model names and
  selectors, executable/path identity, credentials, mutable evidence or
  telemetry, runtime configuration, route/dispatch/launch facts, worker output,
  and the identity digest itself. It is stable only for that exact reviewed
  artifact/capability pair: any artifact, capability, renderer, or template
  change creates a new identity. No host-supplied identity string is authority.
- `release-manifest/v1` contains a dense 1–16
  `workerHostRendererArtifacts` array of closed
  `worker-host-renderer-artifact/v1` records. Each record has exactly
  `capabilityNames`, `hostRendererArtifactDigest`, `schemaVersion`, and
  `workerHostIdentityDigest`, in that canonical order. The capability array uses
  the exact identity-projection rules, both digests are SHA-256, and the schema
  literal is `worker-host-renderer-artifact/v1`. Rows are unique by
  `workerHostIdentityDigest`. The total mapping admission relation snapshots
  the complete dense array, parses every closed row and capability array,
  recomputes each identity from that row's artifact digest plus canonical
  capability array, requires equality, and then proves the 1–16 and unique-key
  census; any unreadable row makes the whole mapping invalid. The route selects
  only the opaque identity digest; engine contracts never name a provider or
  executable. ISS-020 owns the reviewed N0 manifest and install read-back of
  this mapping; ISS-014 owns every reviewed successor manifest and install
  read-back. Installation proves every mapped artifact digest against installed
  bytes, applies the same total relation to the read-back, and binds it to the
  selected active release. A candidate, host, or worker cannot add, choose, or
  attest a row.
- At step 5, ISS-012 alone emits `route-selection/v1` with one
  `workerHostIdentityDigest` selected from the complete installed active-release
  mapping after applying the same total admission relation. The selected row's
  `capabilityNames` must contain the action core's exact case-sensitive
  `capabilityName`; zero, duplicate, unknown, stale, moved, or capability-
  incompatible rows refuse routing. Provider/model evidence may refine a route
  but cannot manufacture or substitute the opaque host identity.
- There is no separate template-registry digest. Before rendering or ownership
  publication, step 7 uses the route-selected `workerHostIdentityDigest` to
  select exactly one installed active-release mapping row, proves its executing
  host artifact digest equals that row, reapplies the identical total mapping
  relation and capability membership rule, and requires its role to equal both
  the step-4 requested role and brief role. `dispatch-plan/v1` binds the
  unchanged host identity, action-core, subject, descriptor, rendered-byte, and
  host-renderer artifact digests. Missing, duplicate, stale, wrong-package,
  candidate-supplied, self-reported, moved, capability/case-substituted,
  identity/artifact-coordinated, cross-host, manifest/read-back-substituted, or
  otherwise mismatched renderer authority refuses before launch.
- `dispatch-brief-resource/v1` has exactly `access`,
  `resourceIdentityDigest`, and `schemaVersion`. `access` is exactly
  `READ|CREATE|MODIFY|DELETE` and `resourceIdentityDigest` is SHA-256.
  Resources are unique by `(access,resourceIdentityDigest)` and remain opaque
  engine identities; no resource class, repository path, branch, worktree, or
  host path appears in this record.
- Engine contract field names, closed enum values, every value admitted to a
  module `dispatchCatalog`, and runtime action/capability/catalog lookup values
  are checked against the generated adapter-vocabulary denylist. Branch,
  worktree, label, milestone, queue, deployment, consumer product terms, and
  their registered abbreviations fail the contracts build or runtime admission.

### Project snapshot literal ledger proposal (ISS-013)

This subsection is a proposal for independent review, not authority conferred
by its author. It defines the read-only observation union for the existing
`project snapshot --adapter <file>` row. It does not complete ISS-013, define
step-3 breaker policy or step-4 module authorization, or authorize a partial
project command-family registration. Those existing outcomes remain open.

There are exactly two proposed public schema families:
`adapter-configuration/v1` and `project-facts/v1`. The frontier row and SDK
request/page shapes below are closed inline records, not separately versioned
schemas. There is no adapter descriptor, plugin registry, open settings/policy
payload, runtime import, provider selector, credential, state, or process field.

#### Scalars, canonical bytes, and adapter configuration

The closed-record/array rules above apply to every entry point. Every shown
member is required; absent, extra, wrong-type, or null members refuse unless
null is explicitly admitted. `UUID` means lowercase UUIDv7; `Digest` means
lowercase SHA-256 hex; `Time` uses the canonical UTC millisecond timestamp
above. `Name` matches `[a-z][a-z0-9._:-]{0,63}`. A name array is dense, contains
0–256 names, and is strictly ASCII sorted, hence unique. `Version` is a string
of at most 63 ASCII bytes matching `(0|[1-9][0-9]*)` three times separated by
literal dots; no range, alias, prerelease, build suffix, or numeric conversion
is admitted. These bounds are parser limits, not adapter policy.

`C(x)` is UTF-8 canonical JSON with lexicographically sorted object keys, no
BOM or insignificant whitespace, and exactly one final LF. Arrays retain their
specified order. `Dconfig = SHA256(C(configuration))`; `Dfrontier =
SHA256(C(frontier))`; `Dsnapshot = SHA256(C(projectFacts))`. The latter hashes
the entire result, including its schema, state, and observation bindings; it
is not an embedded self-digest. These are content identities, not attestations.

`adapter-configuration/v1` has exactly `adapterId, adapterVersion,
capabilityNames, engineVersion, projectId, schemaVersion` in canonical order.
`schemaVersion` is literal `adapter-configuration/v1`; `adapterId` reuses the
landed configuration grammar `[a-z0-9][a-z0-9._:@+-]{0,127}`; both versions use
`Version`; `projectId` is `UUID`; and `capabilityNames` is a name array. The
`--adapter` file contains exactly these canonical bytes, at most 65536 bytes.
It supplies data, never an executable or a path to adapter code or fixture data.
No field is nullable. File read failure uses the existing filesystem failure;
noncanonical or malformed bytes use `ADAPTER_CONFIGURATION_REFUSED` below.

Before the first adapter callback, the SDK compares project/adapter identities
and capability census with the successful ISS-003 configuration; all must
equal exactly. It then requires the requested engine version to equal the
executing build's version and the requested adapter ID/version to equal the
statically composed adapter's constants. That adapter's reviewed source must
explicitly support this exact engine version, both schema literals, and every
requested capability. These finite source constants are not another public
record or registry. Unknown, missing, incompatible, or duplicate selections
refuse without invoking the adapter. Exact-version support is the complete
negotiation for this slice; there is no range inference or version fallback.

#### Complete observation union and pagination

`project-facts/v1` has the following exhaustive union. Every arm has exactly
`adapterConfigurationDigest, observationId, observedAt, projectId,
schemaVersion, state` plus only the arm's members below. The digest is
`Dconfig`, both identities are `UUID`, `observedAt` is `Time`, and
`schemaVersion` is literal `project-facts/v1`. `projectId` equals the admitted
configuration. The SDK supplies a fresh observation ID and injected-clock time
when this invocation starts; pages echo that ID and the result retains both.

| State | Additional members and constraints |
| --- | --- |
| `COMPLETE` | `frontier, frontierDigest`; frontier is a dense 0–4096 row array, strictly sorted by `workId`; digest is `Dfrontier` recomputed from that array |
| `UNAVAILABLE` | `reason`, exactly `SOURCE_UNAVAILABLE` or `OBSERVATION_TIMEOUT` |
| `UNKNOWN` | `reason`, exactly `SOURCE_UNKNOWN`, `MALFORMED_OBSERVATION`, `INCOMPLETE_FRONTIER`, or `CHANGED_FRONTIER` |

Failure arms contain no frontier or digest, including no null or empty
substitute. No other state or reason exists. A public parser accepts the full
union structurally, but cannot establish that any observation was fresh or
authoritative. It verifies the COMPLETE digest and row census, not live source
provenance. The SDK additionally proves the invocation and page bindings.

Each frontier row has exactly `capabilityNames, immutableSubjectDigest,
readiness, workId`. `capabilityNames` is a name array and a subset of the
admitted configuration's capabilities; `immutableSubjectDigest` is `Digest`;
`workId` is `UUID`; and `readiness` is exactly `READY|NOT_READY|UNAVAILABLE|UNKNOWN`.
Work and immutable-subject identities are adapter-supplied opaque facts. Branch,
worktree, repository location, priority rules, CI, deployment, and provider
objects do not cross this boundary. An empty capability array grants nothing.
COMPLETE admits only READY/NOT_READY rows: a returned UNKNOWN row makes the
whole observation UNKNOWN/SOURCE_UNKNOWN; otherwise an UNAVAILABLE row makes
it UNAVAILABLE/SOURCE_UNAVAILABLE. Partial known rows are discarded on failure.

The sole observation callback is `readPage(request)`, returning a native
Promise of one page arm. Its closed request is exactly `cursor, observationId`.
`cursor` is null initially, otherwise a 1–256 ASCII byte token matching
`[A-Za-z0-9._:-]+`; tokens are opaque and never interpreted as paths or queries.
The callback's configuration is bound once by static composition, not supplied
again as mutable page data. Page arms are exactly:

| State | Complete member census |
| --- | --- |
| `COMPLETE` | `cursor, frontier, frontierDigest, nextCursor, observationId, state` |
| `UNAVAILABLE` | `observationId, reason, state`; reason is `SOURCE_UNAVAILABLE` |
| `UNKNOWN` | `observationId, reason, state`; reason is `SOURCE_UNKNOWN` |

A COMPLETE page has 0–64 frontier rows using the row shape above;
`frontierDigest` is the declared digest of the entire observation's canonical
sorted frontier, not just this page. Cursor values use the request grammar;
`nextCursor` is null only for the terminal page. The initial callback must
observe the fixture's current immutable input anew; every continuation belongs
to that same complete input. It must not return a cached prior invocation.
The SDK checks matching observation ID and requested cursor, one unchanged
frontier digest across pages, no repeated continuation token, unique work IDs
across all pages, and one terminal null continuation. It sorts the accumulated
rows by work ID and recomputes the declared digest before emitting COMPLETE.
An empty frontier succeeds only after a terminal page and the exact empty-array
digest have been checked. It is not by itself a routine-cycle no-work decision.

The invocation is bounded to 64 callbacks, 4096 total rows, and 5000 integer
milliseconds measured by an injected monotonic clock; the timeout bounds the
whole invocation, not each page. A pending callback past the deadline yields
UNAVAILABLE/OBSERVATION_TIMEOUT and is never resumed or used. Late completion
cannot replace a terminal result. These are fixed fixture-slice limits; no
provider timeout or retry policy is introduced. A non-null continuation at the
page limit, repeated cursor, or absent terminal census yields
UNKNOWN/INCOMPLETE_FRONTIER. Changed digest, duplicate work identity, or
wrong observation/request binding yields UNKNOWN/CHANGED_FRONTIER. Other
malformed pages, non-native promises, out-of-bound rows, or digest disagreement
yield UNKNOWN/MALFORMED_OBSERVATION. A callback throw/rejection yields
UNAVAILABLE/SOURCE_UNAVAILABLE; SDK defects use the existing INTERNAL_ERROR.
Validation checks closed shape and scalar limits before relational checks;
among relational faults observable from the current page and accumulated
prefix, the fixed priority is CHANGED_FRONTIER, then INCOMPLETE_FRONTIER, then
MALFORMED_OBSERVATION. Readiness is evaluated only if none of those faults is
present. No later callback is fetched to classify a fault or runs after a
terminal failure, and no failure becomes empty success.

#### CLI mapping and implementation boundary

Only COMPLETE maps to `success`/0 with a `project-facts/v1` result and empty
diagnostics. SDK failure arms map to the following closed diagnostics with
`result:null`; the SDK union remains available to its in-process consumer.
Each diagnostic has exactly `code,message`, and each handler error retains
ISS-003's exact `code,exitCode,message,outcome` shape. Messages contain no input.

| Condition | Outcome / exit | Code | Exact message |
| --- | --- | --- | --- |
| invalid adapter configuration | `invalid-input` / 2 | `ADAPTER_CONFIGURATION_REFUSED` | `adapter configuration refused` |
| project/adapter/capability binding differs from loaded configuration | `authority-refused` / 3 | `ADAPTER_BINDING_REFUSED` | `adapter binding refused` |
| unsupported static adapter, engine version, schema, or capability | `authority-refused` / 3 | `ADAPTER_COMPATIBILITY_REFUSED` | `adapter compatibility refused` |
| snapshot UNAVAILABLE | `external-unavailable` / 4 | `PROJECT_SNAPSHOT_UNAVAILABLE` | `project snapshot unavailable` |
| snapshot UNKNOWN | `authority-unknown` / 3 | `PROJECT_SNAPSHOT_UNKNOWN` | `project snapshot unknown` |

Earlier CLI/config-loader errors retain their existing rows. No configuration
result, failed facts arm, or wrong-command result can satisfy snapshot success.
The eventual implementation must amend the supported parsers, serializer,
envelope mapping, diagnostics, and every affected census together under ISS-013.

OPEN integration prerequisite: ISS-003 currently marks an entire command family
implemented or placeholder. Publishing only snapshot cannot silently add fake
plan/apply schemas or pretend the current registration accepts mixed rows.
ISS-013 must separately obtain bounded independent review of the concrete
registration representation change; until then this ledger does not authorize
snapshot publication. Existing plan/apply and other command outcomes remain
unchanged. No amendment to shared scaffold is made by this proposal.

Two statically composed fixture adapters must exercise this same SDK callback,
aggregation, parser, and CLI path: one may represent source-control work
internally; the other has no branch/worktree concepts. Their closed page
transcripts are fixture input, not live provider evidence. Neither input JSON,
adapter-returned digests, nor pure parser success grants session, module,
review, mutation, or promotion authority. Future provider observations still
require their owner's actual fresh-authority evidence. Policy/breaker facts
and module admission remain undefined here; no opaque digest substitutes for
those missing literal contracts or claims completion of routine steps 3–4.

## Proportionality and schema lifecycle

- State-mutation contracts defend exactly two boundaries: the single-writer,
  kernel-exclusive-lock topology this architecture mandates, and the one real
  multi-writer boundary where two installation IDs target one physical
  destination. Machinery justified only by Byzantine or multi-writer threats
  the architecture already excludes is out of contract; a proposal to add such
  machinery requires an observed platform need and a replacement decision.
- Before the first deployed release, a superseded schema is deleted from the
  contracts package and its tests. No diagnostic or archive namespace ships;
  the current census is `v1` for every family at N0. After first deployment,
  superseded schemas are refused at authority paths and become readable only
  through an explicitly versioned migration decision.
- There is no forward compatibility: unknown or future schema versions refuse,
  and every schema change is a release event mediated by the stable-predecessor
  promotion protocol. This is a deliberate decision, not an omission.

### Trusted cross-platform conformance harness ledger

ISS-006 is a bounded evidence harness, not a release certifier. A protected
default-branch `repository_dispatch` workflow selects one immutable candidate
subject, the stable harness/test bundles, and the complete required-job
registry. Candidate code may be the subject under test. It never selects a
job, expected vector, receipt writer, aggregate writer, capability, review, or
promotion outcome. The only pre-ISS-029 hosted provenance admitted here is the
GitHub provisional provider record, terminal-verifier PASS, and independent
review defined below. They are deliberately
non-promotional: no ISS-006 record can install, select, certify, promote, issue
a live capability, or mutate authority.

The portable conformance core owns nine closed `v1` records in
`@orchestration-platform/conformance`: bundle manifest, candidate subject,
contract-version census, vector census, required-job registry, environment
inventory, raw-artifact manifest, job receipt, and aggregate. The GitHub
Actions adapter owns three additional closed records: direct protected-ref,
full protection snapshot, and provisional provider record, plus its provisional
provider-run digest. The core sees only the opaque
`providerRunDigest`; repository, workflow, revision, run, job, and artifact
vocabulary never enters an engine-facing contract. ISS-002 continues to own
the underlying platform schemas and golden values. ISS-006 owns only the
stable census that executes those already-reviewed values on every supported
OS; it does not amend `packages/contracts`.

All records use the existing detached hostile-safe closed-record/closed-array
rules and canonical JSON. Member tables below are in ascending canonical JSON
order. All digests are lowercase SHA-256, all counts and provider numeric IDs
are canonical safe-integer decimal strings, all timestamps are canonical
millisecond UTC, and all portable IDs match `[a-z][a-z0-9-]{0,63}`. Unknown,
extra, missing, nullable where non-null is required, reflective, accessor,
symbol, exotic-prototype, sparse, duplicate, unsorted, or over-bound input
refuses without throwing.

#### Stable bundle and vector census

`conformance-bundle-manifest/v1` has exactly these three members:

| Member          | Exact rule                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------- |
| `files`         | dense nonempty array of at most 4,096 exact file rows, unique and sorted by UTF-8 path bytes |
| `purpose`       | exactly `HARNESS` or `TEST_BUNDLE`                                                           |
| `schemaVersion` | exactly `conformance-bundle-manifest/v1`                                                     |

Each file row has exactly `byteLength`, `path`, and `sha256Digest`.
`byteLength` is a canonical safe-integer decimal, `path` is a portable relative
path with `/` separators and no empty, dot, dot-dot, absolute, drive, or
backslash component, and `sha256Digest` hashes the exact raw file bytes. The
manifest file does not list itself; its trust comes from the protected workflow
revision. The stable workflow hashes every listed file before candidate
execution and again afterward. Missing, extra-in-census, changed, or moved
listed bytes refuse. Candidate files are never members of either stable
manifest.

`conformance-candidate-subject/v1` has exactly `files` and `schemaVersion`.
`files` is the complete candidate commit tree: a dense, nonempty array of at
most 65,536 exact rows, unique and sorted by UTF-8 path bytes. Each row has
exactly `byteLength`, `executable`, `path`, and `sha256Digest`; `executable` is
a boolean derived by the sole adapter mapping `type=blob,mode=100644` to false
and `type=blob,mode=100755` to true; the remaining rules match the bundle file
row. Mode `120000`, mode `160000`, every other mode/type, a truncated or
unterminated tree response, unlisted/duplicate tree entries, checkout-only
files, missing blobs, or a nonportable path refuses. The GitHub adapter
projects the resolved candidate commit into this portable manifest; Git
identities do not enter the record. Its identity is:

```text
Dsubject = conformance-candidate-subject/v1(canonical subject bytes)
```

`conformance-contract-versions/v1` has exactly `schemaVersion` and `versions`.
`versions` is a dense, nonempty array of at most 1,024 exact schema-version
strings, unique and sorted by UTF-8 bytes. It is derived from the stable
ISS-002 `schemaVersions` export in the test bundle, never the candidate's
declaration. The stable suite separately verifies candidate compatibility.
Its identity is:

```text
Dcontracts = conformance-contract-versions/v1(canonical census bytes)
```

Every `candidateSubjectDigest` and `contractVersionsDigest` below is exactly
`Dsubject` and `Dcontracts` respectively.

`conformance-vector-census/v1` has exactly `entries` and `schemaVersion`.
`entries` is a dense, nonempty array of at most 256 rows, unique and sorted by
`fixtureId`. Each row has exactly `expectedDisposition`, `fixtureDigest`,
`fixtureId`, `fixtureKind`, and `generatorParameters`; the dispositions are
`ACCEPT|REFUSE|CENSUS|MEASURE`, and kinds are `BYTES|GENERATOR`. A BYTES row
requires null parameters. A GENERATOR row requires an exact parameter record
whose members are `caseId`, `iterationCount`, and `seed`; `caseId` is a
portable ID, `iterationCount` is a positive canonical safe-integer decimal,
and `seed` is SHA-256. The fixture identities are:

```text
DfixtureBytes = conformance-vector-bytes/v1(exact raw fixture bytes)
DfixtureGenerator = conformance-vector-generator/v1(
  exact raw stable generator source bytes,
  canonical generator-parameter bytes
)
```

`fixtureDigest` must equal the formula selected by `fixtureKind`. Every row
must be executed exactly once by the named stable suite; an unexecuted,
duplicate, unknown, deleted, over-bound, or candidate-supplied row refuses
aggregation.

The initial ISS-002 vector census contains exactly these IDs:

```text
authority-history-linear
authority-rotation-resting-cas-armed
bootstrap-e0-core-post
canonical-decimal-boundaries
canonical-framing-boundaries
commit-run-single-epoch-prefixes
destination-owner-race
external-ledger-literals
full-required-loss
physical-destination-profile
pointer-digest-domains
pointer-kind-census
pointer-packet-purpose-handle
recovery-authorization-core
recovery-attempt-descriptor
recovery-attempt-log
recovery-attempt-reservation
recovery-archives-tombstones
reflective-arrays
reflective-records
run-current-crash-prefixes
walk-1000-records
```

These rows cover raw-32/NUL/tag/count/type/length framing boundaries, zero/one/
`2^53-1` decimal values and overflow refusal, all eleven pointer kinds and every
shipped pointer digest domain, authorization/reservation/descriptor/log/archive
bytes, every external-ledger branch, physical/helper/profile and two-owner
facts, E0 and commit identities, ordinary versus rotation commit unions,
single-epoch crash prefixes, FULL_REQUIRED loss, packet-purpose/handle
separation, hostile reflection, and the complete linear chain. Stable test
selectors and fixture/generator digests live in the census; broad category
prose is not a substitute for those executable rows.

The only identities for these records are:

```text
Dbundle = conformance-bundle-manifest/v1(canonical manifest bytes)
Dvector = conformance-vector-census/v1(canonical census bytes)
```

Each formula is one `framedDigest` canonical-record frame under its shown
domain. Raw JSON digests, field-wise alternatives, cross-purpose substitution,
or a candidate-computed manifest/census refuses.

#### Stable required-job registry

`conformance-required-job-registry/v1` has exactly `jobs`, `schemaVersion`, and
`suites`. `suites` contains at most 64 rows and `jobs` at most 256. Suite rows
have exactly `custodyRequirement`, `helperRequirement`, `ownerPackage`,
`runnerToken`, `suiteId`, `vectorCensusDigest`, and `walkRequirement`. The two
environment requirements are exactly `REQUIRED|UNUSED`; `walkRequirement` is
exactly `NONE|WALK_1000`. Job rows have exactly `environmentFamily`, `jobId`,
`requirement`, and `suiteId`. Arrays are dense, unique by their IDs, sorted by
ID, and contain no orphan suite/job. Every suite has at least one job.
`environmentFamily` is exactly `LINUX|MACOS|WINDOWS`; `requirement` is exactly
`REQUIRED`. `runnerToken` is a closed stable-handler catalog value, never argv
or a candidate package script.

The initial registry has one suite, `iss002-contracts`, owned by
`@orchestration-platform/contracts`, using runner token
`ISS002_CONTRACTS`, `UNUSED` custody/helper requirements,
`WALK_1000`, and exactly three required jobs:

```text
iss002-contracts-linux
iss002-contracts-macos
iss002-contracts-windows
```

Each job names the matching environment family and its suite row commits the
reviewed `Dvector`. A future package registers a suite by landing a reviewed
stable suite row, handler, vector census, requirement arms, and derived job
rows in the conformance bundle. It does not edit shared workflow logic.
Candidate discovery never creates, removes, renames, or downgrades a required
row. The identity is:

```text
Dregistry = conformance-required-job-registry/v1(canonical registry bytes)
```

The workflow matrix is derived only from the parsed stable registry. A
hard-coded alternate matrix, candidate registry, excluded row, `continue-on-
error`, advisory downgrade, or unmatched workflow job refuses the workflow
structure test and aggregate.

#### Environment and raw diagnostics

`conformance-environment/v1` has exactly these members:

```text
abiDigest
architecture
custodyObservationDigest
filesystemProfileDigest
helperProfileDigest
nodeVersion
operatingSystem
osImageDigest
packageManagerVersion
runnerClass
schemaVersion
```

`architecture` is exactly `ARM64|X64`, `operatingSystem` is exactly
`LINUX|MACOS|WINDOWS`, and `runnerClass` is exactly `EPHEMERAL_HOSTED`.
`nodeVersion` is canonical stable `24.x.y` semver and
`packageManagerVersion` is canonical stable `11.x.y` semver with no prefix,
prerelease, or build suffix. ABI and raw observed image inventory are required
SHA-256 digests. `filesystemProfileDigest` admits exactly SHA-256 or null, but
generic parser success grants no filesystem profile: ISS-002 and every
composition other than the exact ISS-022 diagnostic arm below continue to
require a non-null digest in their suite-specific join. Helper and custody
digests are each null only when the stable suite registry declares that
dimension unused, except for the same closed ISS-022 diagnostic arm; a suite
that requires either dimension otherwise requires its digest. ISS-002 contract
jobs require helper and custody null and filesystem profile non-null.
`osImageDigest` remains the digest of the exact provider-native raw environment
inventory bytes and supplies no filesystem-profile authority.

`conformance-raw-artifact-manifest/v1` has exactly `entries` and
`schemaVersion`. It has exactly four entries, unique and sorted by name, and
each row has exactly `byteLength`, `mediaType`, `name`, and `sha256Digest`:

| `name`        | Exact `mediaType`  | Bound bytes                                                    |
| ------------- | ------------------ | -------------------------------------------------------------- |
| `environment` | `APPLICATION_JSON` | exact raw provider image/environment inventory                 |
| `report`      | `APPLICATION_JSON` | exact stable-runner semantic report and executed-vector census |
| `stderr`      | `TEXT_PLAIN`       | exact captured candidate-process stderr bytes                  |
| `stdout`      | `TEXT_PLAIN`       | exact captured candidate-process stdout bytes                  |

`byteLength` and `sha256Digest` bind each exact raw byte string. The
environment row's `sha256Digest` must equal the parsed
`conformance-environment/v1.osImageDigest`; no fresh portable environment claim
may name different inventory bytes. The wrapper performs no newline, encoding,
path, locale, ordering, or diagnostic normalization before hashing.
Diagnostics are advisory but digest-bound; missing, extra, renamed,
cross-media, or substituted raw evidence refuses the receipt.

The identities are single canonical frames:

```text
Denv = conformance-environment/v1(canonical environment bytes)
Draw = conformance-raw-artifact-manifest/v1(canonical manifest bytes)
```

#### Job receipt and derived aggregate

`conformance-job-receipt/v1` has exactly these required members:

```text
candidateSubjectDigest
contractVersionsDigest
environmentDigest
harnessBundleDigest
jobId
maximumWalkDurationNanoseconds
normalizedResult
providerRunDigest
rawArtifactManifestDigest
requiredJobRegistryDigest
schemaVersion
suiteId
testBundleDigest
vectorCensusDigest
```

All identity members are SHA-256. `normalizedResult` is exactly
`PASS|FAIL|UNSUPPORTED|UNKNOWN`. `maximumWalkDurationNanoseconds` is non-null canonical
safe-integer decimal only when the suite has `walkRequirement:WALK_1000` and
the result is PASS; it is null for `walkRequirement:NONE` and every non-PASS
receipt. A PASS walk value is the maximum of the three exact raw-report
intervals and must be at most 5,000,000,000. Only the stable aggregator writes
a job receipt after re-reading provider metadata and raw observation bytes. A
candidate job emits only an untrusted observation artifact; its JSON never
parses as a receipt. Skipped, cancelled, timed-out, stale, neutral,
action-required, unreadable, or missing jobs yield no valid receipt. Every
`FAIL`, `UNSUPPORTED`, or `UNKNOWN` receipt remains diagnostic-only evidence and
cannot enter an aggregate; the aggregate reducer continues to require PASS for
every required receipt and emits only result PASS.

`conformance-aggregate/v1` has exactly these members:

```text
candidateSubjectDigest
contractVersionsDigest
harnessBundleDigest
jobReceiptDigests
providerRunDigest
requiredJobRegistryDigest
result
schemaVersion
testBundleDigest
```

`jobReceiptDigests` is the exact complete array in stable registry order;
`result` is the sole literal `PASS`. It is derived, never accepted from an
input. `Dregistry` commits every suite-to-vector mapping, so the aggregate does
not repeat one impossible global vector digest. The reducer requires exactly
one parsed receipt for each required row, no extra or duplicate, the exact row
job/suite/environment family, each receipt's vector digest equal its own suite
row, helper/custody nullability equal that suite's requirements, equality of
every global candidate/harness/test/registry/contract/provider-run identity,
the exact recomputed environment/raw/receipt digests, `PASS` for every receipt,
and the suite-selected timing arm. Any mismatch or non-PASS result returns a
closed refusal and no aggregate bytes.

The identities are:

```text
Djob = conformance-job-receipt/v1(canonical receipt bytes)
Daggregate = conformance-aggregate/v1(canonical aggregate bytes)
```

An aggregate alone is never hosted authority. Downstream use requires the
exact provisional provider record whose `aggregateDigest` equals recomputed
`Daggregate`, a PASS from the administrator-authenticated post-terminal
verifier, and an independent reviewed capability decision owned by ISS-022.
There is no signature, capability token, promotion verdict, certification
state, or mutation handle in any core record.

#### Protected GitHub provisional provider record and workflow topology

The in-run adapter record is
`github-conformance-provisional-provider-record/v1`. It is provisional input
to the required post-terminal verifier, never authority by itself. It remains
in the GitHub Actions adapter and is never admitted to engine vocabulary. Its
top-level members are exactly:

```text
aggregateDigest
artifacts
candidateRevision
candidateSubjectDigest
event
harnessBundleDigest
jobs
protectedRefDigest
recordedAt
repositoryId
requiredJobRegistryDigest
runAttempt
runId
schemaVersion
testBundleDigest
workflowPath
workflowRef
workflowRevision
```

`event` is exactly `repository_dispatch`; `workflowPath` is exactly
`.github/workflows/conformance.yml`; `workflowRef` is exactly this repository,
path, and `refs/heads/main`; candidate and workflow revisions are lowercase
40-hex commit IDs; provider IDs are positive canonical safe-integer decimals.
The record binds the canonical candidate source-manifest digest rather than
treating a Git revision as a portable engine identity.

`protectedRefDigest` identifies the distinct direct provider projection
`github-conformance-protected-ref/v1`, whose members are exactly
`refProtected`, `schemaVersion`, and `targetRef`. The only admitted values are
`true`, `github-conformance-protected-ref/v1`, and `refs/heads/main`. Its
identity is:

```text
DprotectedRef = github-conformance-protected-ref/v1(
  canonical protected-ref projection bytes
)
```

This marker proves only that GitHub reported protection for the triggering
ref. The plan and record jobs independently require the literal provider
environment value `GITHUB_REF_PROTECTED=true` and bind `DprotectedRef`; neither
claims to observe the full policy or its bypass list.

The post-terminal verifier alone projects
`github-conformance-protection-snapshot/v1`, whose members are exactly
`bypassActorCount`, `deletionBlocked`, `enforcement`,
`nonFastForwardBlocked`, `pullRequestRequired`, `schemaVersion`, and
`targetRef`. The only admitted values are canonical decimal `"0"`, booleans
`true`, `ACTIVE`, and `refs/heads/main` respectively.

Running outside Actions with an administrator-authenticated read, the verifier
reads the default-branch protection endpoint, terminally paginates every
repository/inherited ruleset summary, and fetches every ruleset detail. Summary
rows are not policy evidence. It requires `bypass_actors` to be present and
empty and rejects a hidden/omitted bypass field, unreadable detail/page,
inactive/unknown enforcement, unmatched target, administrator exemption, or
effective rules that do not require pull requests and block deletion/non-fast-
forward updates. Multiple applicable layers reduce by their effective union:
a required restriction remains true if any active layer imposes it, while any
bypass refuses before projection. The accepted projection is unique and has
the identity:

```text
Dprotection = github-conformance-protection-snapshot/v1(
  canonical protection projection bytes
)
```

`Dprotection` is terminal-only and is never inferred from `DprotectedRef`.
Before returning PASS, the verifier requires both the exact provisional record
and this full live projection. An unreadable policy, hidden bypass data, or
weakened restriction refuses even if every run artifact is otherwise valid.
Immediately before canonical provisional-provider-record serialization, the
record job performs its final current-attempt jobs
API GET and sets `recordedAt` to the canonical millisecond-UTC projection of
that HTTPS response's provider `Date` header (whole seconds become `.000Z`). A
missing, repeated, malformed, or non-UTC header refuses. Every artifact listed
inside the record has `expiresAt >= recordedAt + 30 complete days`.

Each job row has exactly `conclusion`, `logicalJobId`, `providerJobId`,
`providerJobName`, and `role`. Conclusion is exactly `SUCCESS`; role is
`PLAN|OBSERVATION|AGGREGATE`; the rows are the one plan job, every stable
registry job, and one aggregate job, sorted by logical ID, with a maximum of
258 rows. Logical/provider names are exactly `plan` / `Conformance / plan`,
each stable job ID / `Conformance / observation / <jobId>`, and `aggregate` /
`Conformance / aggregate`. Each artifact row has exactly `artifactDigest`,
`artifactId`, `artifactName`, `byteLength`, `expiresAt`, `logicalJobId`, and
`role`. Role is `OBSERVATION|AGGREGATE`; exact names are
`conformance-<runId>-<runAttempt>-<jobId>` and
`conformance-<runId>-<runAttempt>-aggregate`. The array contains every
required observation plus the sole aggregate, is sorted by name, and has at
most 257 rows. The provider API's SHA-256, byte length, run association,
non-expired state, and exact bytes must agree. Artifacts from any other run,
attempt, repository, workflow, job census, name, candidate, or harness refuse.

For observation and aggregate roles, `artifactDigest` and `byteLength` are the
provider API's exact ZIP archive identity and archive byte length, normalized
from the provider's `sha256:` value. After verifying those outer bytes, the
reader performs safe ZIP extraction with no traversal, absolute/backslash path,
symlink, duplicate, encryption, unsupported compression, or over-bound entry.
An observation archive has exactly these regular files at its root:

```text
environment
environment-record.json
raw-manifest.json
report
stderr
stdout
```

The four extensionless files are the exact bytes named by `Draw`; the two JSON
files are canonical `conformance-environment/v1` and
`conformance-raw-artifact-manifest/v1` bytes. An aggregate archive has exactly
`aggregate.json` plus one canonical `receipts/<jobId>.json` for every registry
job and no other regular file. Directory metadata is ignored; every regular
file path and extracted byte is exact. Cross-role, ZIP/inner-digest, reordered
receipt, extra-entry, and alternate-layout substitution refuses.

The provider-record artifact alone uses the reviewed upload action's explicit
single-file `archive:false` mode. Its provider API digest and byte length bind
the canonical bytes written to the sole attempt-qualified source filename
`conformance-<runId>-<runAttempt>-provider-record.json`. Under this mode the
action derives the artifact name from that filename and ignores its `name`
input, so the reviewed workflow omits `name` entirely. ZIP output, a fixed
`provider-record.json`, a supplied/overridden name, or any other source
basename/mode refuses. The post-job reader uses the correspondingly pinned
download behavior and never treats an archive digest as an inner-record digest.

The opaque core value is:

```text
DproviderRun = github-conformance-provisional-provider-run/v1(
  repositoryId,
  workflowPath,
  workflowRef,
  workflowRevision,
  runId,
  runAttempt,
  event,
  protectedRefDigest,
  candidateRevision,
  candidateSubjectDigest,
  harnessBundleDigest,
  testBundleDigest,
  requiredJobRegistryDigest
)
```

Every item is one framed text/raw-32 part in the shown order. The adapter
recomputes this value and requires equality to every receipt and the aggregate.
The provisional-provider-record identity is one canonical frame under
`github-conformance-provisional-provider-record/v1`; it binds `Daggregate` but
is not inserted into the aggregate, avoiding a digest cycle. Retrieval of the
provider record itself is verified against the same run through the provider
API.

The sole authoritative hosted topology is:

1. A `repository_dispatch` event of exact type `conformance_candidate` reaches
   the workflow that exists on the protected default branch. Its closed payload
   is a JSON record with the sole member `candidateRevision`, whose value is one
   lowercase 40-hex commit in this repository. Symbolic refs, forks, scalar
   payloads, alternate/extra members, and unresolved commits refuse.
2. The plan job requires `refs/heads/main`, `ref_protected=true`, the exact
   workflow path/ref, and `workflowRevision = GITHUB_WORKFLOW_SHA = GITHUB_SHA`.
   It checks out that exact stable revision and the candidate into separate
   roots with persisted credentials disabled, recomputes stable manifests, and
   derives the matrix only from `Dregistry`.
3. Workflow permissions are only `contents:read` and `actions:read`; there are
   no secrets, environments, caches, OIDC, write tokens, status writes, or
   self-hosted runners. Candidate child processes receive an allowlisted
   environment excluding all GitHub/Actions tokens and provider metadata.
   Every remote `uses:` dependency, including checkout, Node setup, artifact
   upload, and artifact download, is pinned to one independently reviewed full
   40-hex commit SHA. Tags, branches, shortened hashes, dependency installs
   outside the reviewed frozen lockfile/integrity graph, and unpinned remote
   executable downloads in workflow steps refuse the workflow structure test.
4. Each ephemeral hosted observation job invokes a stable runner token against
   candidate bytes in a separate temporary tree outside the checkout. Before
   any candidate process starts, the stable wrapper exclusively owns a fresh
   external parent, reads each candidate file through an identity-checked
   regular-file handle, copies only bytes matching the adapter-authenticated
   candidate subject into a fresh child, and consumes that child into the
   suite's external execution artifact. The materialized path is never
   supplied to candidate code, never returned as evidence, and is deleted
   before the candidate artifact is launched; a partial copy, changed
   parent/root identity, cleanup failure, or unconsumed path refuses. Local
   file mode is not authority on Windows: `executable` remains bound only by
   the adapter's authenticated `100644|100755` projection. The candidate
   receives only the consumed artifact and allowlisted environment.

   The isolation boundary for ISS-006 is the provider-fresh per-job runner
   virtual machine plus protected-main admission of the independently reviewed
   candidate revision (Round 234). Candidate vectors execute in fresh child
   Node processes started by the stable parent; every candidate response is
   hostile data. Only the stable parent owns expected values, selected-head
   equality, exact output parsing, timing, result normalization, raw
   observation serialization, or receipt authority. Candidate stdout cannot be
   a receipt or PASS assertion. The stable parent measures each interval with
   its captured monotonic clock from immediately before child-process launch
   through terminal exit and complete response read; process startup, module
   load, IPC, parse, full validation, and selected-head response are all
   inside the five-second ceiling. Candidate-reported time is ignored, and the
   stable parent requires terminal child exit before another interval.

   No job performs a privileged operating-system operation, and the repository
   contains no compiled executable: everything executed builds from reviewed
   source. Same-host OS-principal isolation — transient UIDs, AppContainer
   SIDs, Job Objects, privileged setup/teardown helpers, and isolation
   brokers — is parked, not refused. Its unpark condition is a slice that must
   execute candidate bytes which are not an independently reviewed revision of
   this repository; that condition is owned by the self-host promotion path
   and is revisited no later than ISS-019. Same-principal Node permissions,
   textual dependency scans, `vm`, and candidate self-report remain explicitly
   not isolation substitutes if that machinery unparks.

   Stable tests/vectors and candidate implementation bytes never share
   authorship. After the child processes exit, the stable wrapper captures raw
   bytes, measures the suite, rechecks the stable bundle, and uploads one
   attempt-qualified immutable observation artifact with explicit
   `archive:true`. Candidate output is data, never executed by later jobs.

5. A fresh stable-only aggregate job downloads the exact current-attempt
   artifact census, parses all inputs hostile-safe, recomputes identities, and
   writes receipts and at most one aggregate, uploaded with explicit
   `archive:true`. It never checks out or executes candidate code.
6. A final stable-only record job queries the provider run, current-attempt job,
   and artifact APIs after aggregate upload, verifies the exact census, repeats
   the direct `GITHUB_REF_PROTECTED=true` requirement, and verifies at least 30
   days remaining retention for the already-listed artifacts. It writes then
   uploads with explicit `archive:false` the provisional provider record as
   exact artifact
   `conformance-<runId>-<runAttempt>-provider-record.json`; the source file has
   that exact basename and the upload step has no `name` input. Rerunning only a
   subset cannot combine attempts because every artifact name and API query is
   attempt-qualified.

The provisional provider record cannot attest its own completed writer job or
artifact without a cycle. The required post-job verifier therefore takes only the
expected repository ID, run ID, run attempt, and workflow revision, queries the
provider after the whole run is terminal, and requires:

- overall run conclusion SUCCESS under the exact repository/workflow/ref/SHA;
- exactly one logical `record` job in that attempt, with the reviewed stable
  job name and SUCCESS conclusion;
- exactly one provider-record artifact with the name above, same run
  association, API SHA-256/length equal to downloaded canonical bytes, creation
  under `archive:false`, non-expired status, and `expiresAt` at least 30 days
  after the record's `recordedAt`;
- the downloaded provisional provider record, every listed job/artifact,
  `DproviderRun`, `DprotectedRef`, `Dprotection`, and `Daggregate` all
  revalidate from live provider responses and retained bytes; ruleset summaries
  are expanded to details and omitted `bypass_actors` refuses.

The artifact API does not assert its uploader job. The constructive join is the
immutable reviewed workflow's unique attempt-qualified upload step plus unique
artifact name, successful record job/run, and same-run API association. The
exact inclusive time relation is
`recordJob.startedAt <= recordedAt <= artifact.createdAt <= recordJob.completedAt`;
all four values are provider fields/projections, not runner wall clock. Any
ambiguity, duplicate, or boundary violation refuses. The verifier emits only a
PASS/refusal result for independent review; it creates no downstream authority
record, so the chain terminates without a self-reference.

Movement of the default branch after dispatch does not substitute bytes: the
exact immutable `workflowRevision` remains the stable subject for the run.
Deletion, expiry, API unreadability, protection loss, or absence of any raw
artifact, receipt, aggregate, or provisional provider record becomes
`UNKNOWN`/unusable; it never normalizes to pass.

GitHub check names are presentation only. Required status checks cannot prove
this topology because the provider does not bind a check name to one event or
workflow. ISS-006 therefore creates no status authority. The independently
reviewed provisional provider record, terminal-verifier PASS, and protected-main
full policy snapshot are the bounded pre-ISS-029 evidence. ISS-029 may later
replace this bounded provider evidence
with authenticated OIDC/artifact attestation; ISS-006 does not pre-claim that
result.

#### Local mode, timing, retention, and exclusions

The local entrypoint creates no contract record. It writes a diagnostic stream
whose first exact line is `ADVISORY CONFORMANCE RESULT`, then returns the
closed exit mapping `0` only when every selected local suite reports PASS and
`1` for FAIL, UNSUPPORTED, malformed input, or internal refusal. It cannot invoke a
hosted serializer or provider verifier and never emits canonical job-receipt,
aggregate, or provisional-provider-record bytes. Every hosted parser rejects the diagnostic
stream before semantic reads. Local mode is deterministic development evidence
only; deleting the marker or routing local output to a hosted parser is an
executable refusal mutant.

The `walk-1000-records` row uses one fixed canonical 1,000-record
`authority-history/v1` vector and selected head. On each OS, three fresh child
Node processes run under the stable parent. The stable parent uses its captured
`process.hrtime.bigint()` around the complete launch-to-terminal-response
interval, including process startup, module load, child IPC, JSON parse,
full validation from genesis, selected-head response, and process exit.
Dependency installation and pre-launch artifact construction remain excluded.
There is no warmup, averaging, best-of, or retry. Every one of the three trusted
parent intervals must be at most 5,000,000,000 nanoseconds; candidate-reported
time, timeout, overflow, refusal, or one slower
interval makes the required job non-PASS. Checkpoints or indexes remain deleted
until this exact fresh-process measurement fails on a supported hosted OS.

Raw observations, job receipts, aggregate, provisional provider record, stable
manifests,
registry/census, provider metadata snapshot, and workflow-mutation outputs are
retained for at least 30 days. The record job verifies already-listed artifact
expiry; the post-job verifier independently verifies the provider-record
artifact expiry. Neither trusts requested retention. Evidence is usable only
before the earliest bound artifact expiry; downstream durable certification
belongs to ISS-019.

The implementation adds no release candidate/certification/grant schema,
signature system, OIDC claim, promotion route, package discovery authority,
general workflow scheduler, filesystem/runtime primitive, state mutation,
checkpoint, compaction, database, or consumer adapter. The engine remains
provider-neutral. A candidate never certifies itself.

Deletion evidence must independently kill every schema member/domain/enum,
stable-manifest file row, vector row, registry suite/job row, workflow event/ref/
permission/checkout separation, matrix cell, attempt join, provider API
equality, artifact archive/inner digest/length/layout/expiry, full action SHA,
inclusive provider-time relation, Git mode/tree projection, result reduction,
raw-diagnostic byte, reflection case, stable-parent timing relation, and timing
interval. Mutation fixtures also add
`continue-on-error`, candidate checkout before stable selection, candidate
matrix/aggregate writers, mutable action refs, ZIP/non-archive substitution,
same-name prior-attempt artifacts, local-hosted substitution, skipped/cancelled/
unsupported jobs, forged candidate duration/PASS, a reintroduced privileged
isolation operation or committed compiled executable, and a spoofed check name;
all must refuse without producing hosted PASS evidence.

## Portable primitives probe and capability ledger

ISS-022 is one bounded Node 24 capability probe. It does not implement the
runtime state service, persistent custody, a helper, or principal isolation.
The stable ISS-006 parent owns the fresh runner-temp custody root, expected
bytes, barriers, clocks, process handles, normalization, and receipts. Candidate
output is hostile data. No candidate verdict or local result can select a
profile.

The exact candidates and selectable tokens are:

| Capability               | Exact Node candidate                                                                                                  | PASS token                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| physical identity        | `realpath`, `lstat/stat({bigint:true})`, `statfs({bigint:true})`, and the Unicode 15 canonical leaf decoder           | `NODE_REALPATH_BIGINT_STATFS_LEAF_V1`          |
| create once              | `open(path, O_CREAT plus O_EXCL plus O_RDWR, 0o600)`, exact write, `FileHandle.sync()`, close, reopen/readback        | `NODE_OPEN_EXCL_SYNC_READBACK_V1`              |
| atomic replace           | sibling `O_EXCL` temp, exact write, file sync, close, `rename`, parent-directory open/sync, reopen/readback           | `NODE_TEMP_SYNC_RENAME_DIRSYNC_V1`             |
| destination/runtime lock | one `O_EXCL` lock-file handle; after holder death the same path is acquired once without deletion or retry            | `NODE_EXCL_OWNER_DEATH_LOCK_V1`                |
| CAS                      | admitted lock, exact predecessor read, create-once proposal, admitted replace, exact readback                         | `NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1` |
| process                  | direct non-detached `ChildProcess` handle, private IPC nonce, `kill("SIGTERM")`, and provider-observed `exit`/`close` | `NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1`      |
| handle confinement       | probe-local `WeakMap` plus 32-byte nonce callback handle                                                              | `NODE_WEAKMAP_NONCE_CALLBACK_V1`               |
| absence                  | `lstat` returning `ENOENT` for two registered unused paths while the admitted lock is held                            | `NODE_LOCKED_LSTAT_ENOENT_V1`                  |
| parser equivalence       | stable parent plus three fresh children parse the same ISS-002 canonical/hostile bytes                                | `NODE_FRESH_CHILD_CANONICAL_PARSE_V1`          |
| helper                   | reviewed `process.execPath` bytes and Node 24 built-ins only                                                          | `NODE24_BUILTIN_FS_CHILD_PROCESS_V1`           |
| helper ABI               | exact Node `modules` and `napi` version pair                                                                          | `NODE24_MODULES_NAPI_V1`                       |
| custody                  | stable-parent exclusive root plus create-once namespace file and handle readback                                      | `STABLE_PARENT_EXCLUSIVE_NAMESPACE_FILE_V1`    |

No token is a promise that Node supplies the property. A vector emits
UNSUPPORTED when the exact candidate lacks it. In particular, an `O_EXCL` lock
path that survives holder death and the absence of an independently observable
grandchild handle are discriminating Node gaps; neither may be repaired by PID,
age, IPC text, deletion, retry, shell commands, or an unreviewed helper.

### Literal physical, helper, ABI, and custody derivation

All multibyte integers below are fixed-width big-endian. `u64(x)` requires a
nonnegative bigint below `2^64`; `u32(x)` requires a nonnegative bigint below
`2^32`; an out-of-range or unreadable stat is UNKNOWN. `statfs.type` alone uses
`u64(BigInt.asUintN(64,type))` so a provider's signed spelling has one byte
projection. Every `fixed`, `text`, `raw32`, and `canonical` item below is the
existing `framedDigest` frame of that type, in shown order.

The stable parent creates an exclusive real custody root, opens it, and creates
`.orchestration-custody-namespace` exactly once with 32 random bytes, file sync,
close, and readback before candidate launch. The file is probe input, not a
secret. Production may instantiate the same profile only in an independently
admitted custody root and must preserve those bytes across helper/custody
rotation. The probe target is exactly one canonical leaf below that root; for
both existing and absent target rows, the root is the ancestor object. An absent
target is never discovered by directory enumeration: the stable parent
constructs the one path, requires the root to exist, and requires exactly
`lstat -> ENOENT` for the leaf.

```text
DhostNamespace = portable-host-custody-namespace/v1(
  fixed(namespace file's exact 32 bytes)
)

Dvolume = portable-physical-volume-identity/v1(
  raw32(DhostNamespace), text(operatingSystem), u64(rootStat.dev)
)

Dfilesystem = portable-filesystem-identity/v1(
  raw32(Dvolume), text(operatingSystem),
  u64(BigInt.asUintN(64, rootStatfs.type))
)

Dancestor = portable-ancestor-object-identity/v1(
  raw32(Dvolume), raw32(Dfilesystem), u64(rootStat.dev),
  u64(rootStat.ino), u32(rootStat.mode)
)

DlogicalLocator = portable-logical-locator/v1(
  raw32(DhostNamespace), fixed(canonicalPhysicalLeafBytes)
)

DresolvedLocatorReadback = portable-resolved-locator-readback/v1(
  raw32(Dancestor), fixed(canonicalPhysicalLeafBytes)
)

DnativeIdentityReadback = portable-native-identity-readback/v1(
  raw32(Dvolume), raw32(Dfilesystem), raw32(Dancestor),
  text(leafIdentityKind)
)
```

The stable parent retains the original root handle across every physical
barrier and compares before/after `fstat` identity on that handle; it also
reopens the locator and requires the same `realpath`, `dev`, `ino`, `mode`,
`statfs.type`, and namespace bytes. Handle values themselves are never compared.
A changed field is UNKNOWN. The exact
`physical-destination-identity/v1` record uses `Dancestor`, the canonical leaf
bytes, `Dfilesystem`, `DhostNamespace`, the observed leaf kind,
`DARWIN|LINUX|WINDOWS`, and `Dvolume`; `Dphys` is then the already-landed
`physical-destination-identity/v1` framed formula and
`Ddest = bootstrap-destination-identity/v1(raw32(Dphys))`. The probe never
invents a second physical formula.

The stable parent resolves and reads `process.execPath` through one regular-file
handle and hashes the exact bytes. It accepts only canonical Node `24.x.y` and
canonical decimal `process.versions.modules` and `process.versions.napi`.

```text
Dabi = portable-node-abi/v1(
  text(nodeVersion), text(modulesVersion), text(napiVersion)
)

Dhelper = portable-node-helper/v1(
  raw32(sha256(exact executable bytes)), text(nodeVersion), raw32(Dabi)
)

DhelperProfile = portable-node-helper-profile/v1(
  text(NODE24_BUILTIN_FS_CHILD_PROCESS_V1), raw32(Dhelper), raw32(Dabi)
)

DosProfile = portable-primitives-os-profile/v1(
  text(operatingSystem), raw32(Dhelper), raw32(Dabi), u64(rootStat.dev),
  u64(BigInt.asUintN(64, rootStatfs.type)), text(caseComparisonProfile),
  text(unicodeNormalizationProfile), raw32(vectorCensusDigest)
)

DpreCustodyEnvironment = portable-primitives-pre-custody-environment/v1(
  raw32(Dabi), text(architecture), raw32(DosProfile),
  raw32(DhelperProfile), text(nodeVersion), text(operatingSystem),
  raw32(sha256(exact raw provider environment inventory bytes)),
  text(packageManagerVersion), text(EPHEMERAL_HOSTED)
)

DrootReadback = portable-custody-root-readback/v1(
  raw32(DhostNamespace), raw32(Dvolume), raw32(Dfilesystem), raw32(Dancestor)
)

DcustodyInstance = portable-probe-custody-instance/v1(
  raw32(DhostNamespace), raw32(DpreCustodyEnvironment),
  raw32(DproviderRun), text(jobId), raw32(DrootReadback)
)

DcustodyProfile = portable-custody-profile/v1(
  text(STABLE_PARENT_EXCLUSIVE_NAMESPACE_FILE_V1)
)
```

`portable-primitives-os-profile/v1` has exactly `caseComparisonProfile`,
`filesystemTypeBytes`, `helperAbiDigest`, `helperDigest`, `operatingSystem`,
`schemaVersion`, `statDeviceBytes`, `unicodeNormalizationProfile`, and
`vectorCensusDigest`. Its two byte fields are the exact 8-byte values framed
above; the remaining values use the existing closed environment/locator enums.
`DpreCustodyEnvironment` is an identity only, not a record or selectable
profile. It is recomputed from the exact values of every variable final
environment member except `custodyObservationDigest`; `schemaVersion` is the
fixed `conformance-environment/v1` literal. It is never accepted from a caller.

`Dphys` in the custody receipt and admitted locator is only the
`PHYSICAL_ABSENT_LEAF` row's identity; the other physical rows are hostile
comparison evidence and never alternate the selected destination. The
`portable-probe-custody-receipt/v1` has exactly `custodyInstanceDigest`,
`helperAbiDigest`, `helperDigest`, `observedAt`, `osProfileDigest`,
`physicalDestinationIdentityDigest`, `rootReadbackDigest`, and `schemaVersion`.
Its identity is:

```text
DcustodyReceipt = portable-probe-custody-receipt/v1(
  raw32(custodyInstanceDigest), raw32(physicalDestinationIdentityDigest),
  raw32(helperDigest), raw32(helperAbiDigest), raw32(osProfileDigest),
  raw32(rootReadbackDigest), text(observedAt), canonical(receipt)
)
```

An ADMITTED synthetic
`physical-destination-locator-observation-receipt/v1` uses `Dhelper`, canonical
Node version, `DlogicalLocator`, `DresolvedLocatorReadback`, the OS-fixed case
and Unicode profiles, `DcustodyInstance`, `DcustodyReceipt`, and
`DnativeIdentityReadback`. Its `observedAt` is the stable-parent observation
time, `validFrom` equals that exact timestamp, and `validUntil` is null; no other
time bytes are valid. Any unstable or unsupported physical/custody input uses
the existing all-null UNSUPPORTED/UNKNOWN observation arm and cannot select a
profile. The suite's `conformance-environment/v1` uses
`helperProfileDigest=DhelperProfile` and
`custodyObservationDigest=DcustodyReceipt`. Consumers must create and verify
their own actual custody instance and receipt; probe custody bytes never
authorize a production destination.

The ISS-022 suite composition has exactly two environment arms, selected only
after parsing the complete stable 21-row report. For `selection` non-null, the
stable parent first derives `Dabi`, `DhelperProfile`, `DosProfile`, the exact raw
environment inventory digest, and `DpreCustodyEnvironment`; then derives
`DrootReadback`, `DcustodyInstance`, `DcustodyReceipt`, and the locator; then
constructs the final environment with `abiDigest=Dabi`,
`filesystemProfileDigest=DosProfile`,
`helperProfileDigest=DhelperProfile`, and
`custodyObservationDigest=DcustodyReceipt`; and only then computes `Denv` for
the observation and job receipt. Every digest is non-null and equal-bound
through the report, environment, locator, custody receipt, and job receipt.
Neither `environmentDigest` nor `DpreCustodyEnvironment` is caller input. For
`selection:null`, executable custody still requires exact non-null
`abiDigest=Dabi` and `helperProfileDigest=DhelperProfile`, while
`filesystemProfileDigest` and `custodyObservationDigest` are exactly null. That
arm requires the complete ordered 21-row report, at least one of its six
physical rows normalized `UNKNOWN|UNSUPPORTED`, and a non-PASS suite
observation and job receipt. It selects no OS profile, custody receipt, locator
observation, profile/custody/locator token, or decision-core OS-profile slot.

The ISS-022 suite/job-receipt join, not the generic environment parser, enforces
that correspondence. A caller-filled null, null paired with six PASS physical
rows, null in ISS-002 or another suite, a mixed `selection`/environment arm, a
sentinel digest, or synthetic environment, time, or details refuses. The arm
adds no schema member and does not reinterpret `osImageDigest` as profile
evidence.

### Finite vectors and reduction

The vector census is exactly this order:

```text
PHYSICAL_EXISTING
PHYSICAL_ABSENT_LEAF
PHYSICAL_CASE_ALIAS
PHYSICAL_UNICODE_ALIAS
PHYSICAL_SYMLINK_SWAP
PHYSICAL_PARENT_SWAP
CREATE_ONCE_32_CONTENDERS
LOCK_TWO_UNRELATED_PROCESSES
LOCK_HOLDER_DEATH
LOCK_DEFAULT_NON_INHERITANCE
REPLACE_BEFORE_CREATE
REPLACE_AFTER_CREATE
REPLACE_AFTER_FILE_SYNC
REPLACE_AFTER_RENAME
REPLACE_AFTER_DIRECTORY_SYNC
CAS_PREDECESSOR_MISMATCH
CAS_TWO_CONTENDERS
ABSENCE_HEAD_PLUS_ONE_TWO
PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP
HANDLE_CLONE_TRANSFER_REUSE
PARSER_EQUIVALENCE
```

The one-component leaf corpus is the following exact canonical JSON array of
lowercase hexadecimal byte strings. Its canonical bytes include the final LF,
and `DphysicalLeafCorpus = portable-physical-leaf-corpus/v1(canonical(array))`
is exactly `f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe`.

```json
[
  "6578697374696e672d6c656166",
  "616273656e742d6c656166",
  "41",
  "61",
  "c3a9",
  "65cc81",
  "6c696e6b2d6c656166",
  "706172656e742d6c656166"
]
```

The entries decode respectively to `existing-leaf`, `absent-leaf`, `A`, `a`,
NFC `é`, NFD `e` plus combining acute, `link-leaf`, and `parent-leaf`.
Symlink/junction and replaced-parent locators are hostile alternate routes to
those leaves; they are never admitted as the real custody root. Link-target and
parent replacement occur only at stable-parent barriers. An alias is PASS when
stable observations prove the OS-expected identical or distinct result,
UNSUPPORTED when identity cannot be proved, and UNKNOWN when observations move
or contradict.

File payloads are one byte: predecessor `41`, successor `42`. Barrier IDs are
only `READY`, `ACQUIRED`, `AFTER_CREATE`, `AFTER_FILE_SYNC`, `AFTER_RENAME`, and
`AFTER_DIRECTORY_SYNC`. Create once yields one `41` winner and 31 `EEXIST`
losers. Lock contention yields one acquisition and one `EEXIST`.
`LOCK_DEFAULT_NON_INHERITANCE` spawns with the default non-inherited descriptor
set and refuses any child access to the stable holder; it never intentionally
duplicates or transfers the holder. After provider-observed holder exit, the
next lock acquisition is attempted exactly once. No cleanup or retry occurs.

The replace target starts at `41`. Crashes before create, after create, and
after file sync must reopen as `41`; crashes after rename and after directory
sync must reopen as `42`. Two CAS contenders start behind one barrier; exactly
one selects `42`, and the other observes predecessor mismatch. The process row
uses only the direct `ChildProcess` handle returned to the stable parent. A
grandchild identity supplied only by child IPC/stdout is hostile and therefore
derives UNSUPPORTED; the probe does not force PID reuse or claim tree
termination. Ten seconds is only a runner bound; expiry is UNKNOWN, never proof
of death. Reboot, mount creation, cross-volume mutation, persistent-host
re-entry, and native process enumeration belong to later reviewed selection.

`EEXIST` is admitted only for the registered exclusive-creation loser and
`ENOENT` only for registered absence. `ENOTSUP|EOPNOTSUPP|ENOSYS|EINVAL|EPERM|
EACCES` is UNSUPPORTED for the exact attempted operation. Every other code,
missing code, timeout, signal, malformed output, or unreadable observation is
UNKNOWN. Neither status becomes PASS.

`portable-primitives-vector-inputs/v1` has exactly `barriers`, `caseId`,
`contenderCount`, `corpusDigest`, `crashPoint`, `expectedReadbackHex`,
`operationToken`, `payloadHex`, `predecessorHex`, `schemaVersion`, and
`timeoutMilliseconds`.
Unused scalar arms are null. Counts and milliseconds are canonical bounded
decimals; byte values are `41|42`; barriers/crash points are the closed IDs
above; operation tokens are the closed candidate tokens. `corpusDigest` is
non-null only for physical rows and equals
`portable-physical-leaf-corpus/v1(canonical ordered corpus above)`. The parser
admits only the 21 literal rows below; it is not a caller-filled matrix.
`predecessorHex` is non-null only for CAS: `42` deliberately mismatches the
current `41` in `CAS_PREDECESSOR_MISMATCH`, while `41` is the shared predecessor
for `CAS_TWO_CONTENDERS`.

Each line below is one complete canonical record; key order and final LF are
canonicalized by the landed ISS-002 rules.

```text
{"barriers":["READY"],"caseId":"PHYSICAL_EXISTING","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PHYSICAL_ABSENT_LEAF","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PHYSICAL_CASE_ALIAS","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PHYSICAL_UNICODE_ALIAS","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PHYSICAL_SYMLINK_SWAP","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PHYSICAL_PARENT_SWAP","contenderCount":null,"corpusDigest":"f0e0569a39206775cf61c8f61ee916e00f5dd0ad41cb094aaf6c21f5221a84fe","crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_REALPATH_BIGINT_STATFS_LEAF_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"CREATE_ONCE_32_CONTENDERS","contenderCount":"32","corpusDigest":null,"crashPoint":null,"expectedReadbackHex":"41","operationToken":"NODE_OPEN_EXCL_SYNC_READBACK_V1","payloadHex":"41","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","ACQUIRED"],"caseId":"LOCK_TWO_UNRELATED_PROCESSES","contenderCount":"2","corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_EXCL_OWNER_DEATH_LOCK_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","ACQUIRED"],"caseId":"LOCK_HOLDER_DEATH","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_EXCL_OWNER_DEATH_LOCK_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["ACQUIRED"],"caseId":"LOCK_DEFAULT_NON_INHERITANCE","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_EXCL_OWNER_DEATH_LOCK_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"REPLACE_BEFORE_CREATE","contenderCount":null,"corpusDigest":null,"crashPoint":"READY","expectedReadbackHex":"41","operationToken":"NODE_TEMP_SYNC_RENAME_DIRSYNC_V1","payloadHex":"42","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","AFTER_CREATE"],"caseId":"REPLACE_AFTER_CREATE","contenderCount":null,"corpusDigest":null,"crashPoint":"AFTER_CREATE","expectedReadbackHex":"41","operationToken":"NODE_TEMP_SYNC_RENAME_DIRSYNC_V1","payloadHex":"42","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","AFTER_CREATE","AFTER_FILE_SYNC"],"caseId":"REPLACE_AFTER_FILE_SYNC","contenderCount":null,"corpusDigest":null,"crashPoint":"AFTER_FILE_SYNC","expectedReadbackHex":"41","operationToken":"NODE_TEMP_SYNC_RENAME_DIRSYNC_V1","payloadHex":"42","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","AFTER_CREATE","AFTER_FILE_SYNC","AFTER_RENAME"],"caseId":"REPLACE_AFTER_RENAME","contenderCount":null,"corpusDigest":null,"crashPoint":"AFTER_RENAME","expectedReadbackHex":"42","operationToken":"NODE_TEMP_SYNC_RENAME_DIRSYNC_V1","payloadHex":"42","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","AFTER_CREATE","AFTER_FILE_SYNC","AFTER_RENAME","AFTER_DIRECTORY_SYNC"],"caseId":"REPLACE_AFTER_DIRECTORY_SYNC","contenderCount":null,"corpusDigest":null,"crashPoint":"AFTER_DIRECTORY_SYNC","expectedReadbackHex":"42","operationToken":"NODE_TEMP_SYNC_RENAME_DIRSYNC_V1","payloadHex":"42","predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["ACQUIRED"],"caseId":"CAS_PREDECESSOR_MISMATCH","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":"41","operationToken":"NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1","payloadHex":"42","predecessorHex":"42","schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY","ACQUIRED"],"caseId":"CAS_TWO_CONTENDERS","contenderCount":"2","corpusDigest":null,"crashPoint":null,"expectedReadbackHex":"42","operationToken":"NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1","payloadHex":"42","predecessorHex":"41","schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["ACQUIRED"],"caseId":"ABSENCE_HEAD_PLUS_ONE_TWO","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_LOCKED_LSTAT_ENOENT_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PROCESS_DIRECT_CHILD_AND_GRANDCHILD_GAP","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":"10000"}
{"barriers":["READY"],"caseId":"HANDLE_CLONE_TRANSFER_REUSE","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_WEAKMAP_NONCE_CALLBACK_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
{"barriers":["READY"],"caseId":"PARSER_EQUIVALENCE","contenderCount":null,"corpusDigest":null,"crashPoint":null,"expectedReadbackHex":null,"operationToken":"NODE_FRESH_CHILD_CANONICAL_PARSE_V1","payloadHex":null,"predecessorHex":null,"schemaVersion":"portable-primitives-vector-inputs/v1","timeoutMilliseconds":null}
```

```text
DprimitiveInputs = portable-primitives-vector-inputs/v1(
  text(caseId), canonical(input record)
)
```

`portable-primitives-vector/v1` is a closed record with exactly `caseId`,
`expectedResult`, `inputsDigest`, `profileToken`, and `schemaVersion`.
`expectedResult` is the sole literal PASS; UNSUPPORTED/UNKNOWN are measured
dispositions, not pre-authorized expectations.

```text
DprimitiveVector = portable-primitives-vector/v1(
  text(caseId), text(profileToken), raw32(inputsDigest),
  text(expectedResult), canonical(vector record)
)
```

`portable-primitives-observation/v1` has exactly `caseId`, `detailsDigest`,
`environmentDigest`, `normalizedResult`, `observedAt`, `operatingSystem`,
`schemaVersion`, and `vectorDigest`; result is `PASS|UNSUPPORTED|UNKNOWN` and OS
is `LINUX|MACOS|WINDOWS`. For each present vector,
`detailsDigest = portable-primitives-observation-details/v1(raw32(Draw),
text(caseId))`, where `Draw` is the already-recomputed raw artifact manifest
digest whose report bytes contain the complete stable vector census and raw
observations.

```text
DprimitiveObservation = portable-primitives-observation/v1(
  text(caseId), text(operatingSystem), raw32(environmentDigest),
  raw32(vectorDigest), text(normalizedResult), raw32(detailsDigest),
  text(observedAt), canonical(observation record)
)
```

The stable reducer emits at most the expected 63 observations in required-job
registry order then vector order. It never synthesizes environment, time, or
details for a missing job/artifact. Missing, extra, duplicate, malformed, or
spoofed rows instead enter the authenticated diagnostic provider census below.

### Capability decision and authenticated diagnostic arm

`portable-primitives-capability-decision-core/v1` has exactly
`aggregateDigest`, `candidateSubjectDigest`, `contractVersionsDigest`,
`custodyProfileDigest`, `decision`, `decisionWriterDigest`,
`diagnosticTerminalDigest`, `harnessBundleDigest`, `helperAbiDigests`,
`helperDigests`, `observationDigests`, `osProfileDigests`, `profile`,
`providerRunDigest`, `requiredJobRegistryDigest`, `schemaVersion`,
`stableHarnessSubjectDigest`, and `testBundleDigest`. The three digest arrays
have exactly three nullable SHA-256 slots in `LINUX`, `MACOS`, `WINDOWS`
registry order and bind each OS's exact `Dabi`, `Dhelper`, and `DosProfile`.
`custodyProfileDigest` must equal recomputed `DcustodyProfile` in both decision
arms. `profile` is closed with keys `absence`, `atomicReplace`, `cas`,
`createOnce`, `custody`, `destinationLock`, `handleConfinement`, `helper`,
`helperAbi`, `parserEquivalence`, `physicalIdentity`, `process`, and
`runtimeLock` and uses only this exact mapping or null:

```text
absence = NODE_LOCKED_LSTAT_ENOENT_V1
atomicReplace = NODE_TEMP_SYNC_RENAME_DIRSYNC_V1
cas = NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1
createOnce = NODE_OPEN_EXCL_SYNC_READBACK_V1
custody = STABLE_PARENT_EXCLUSIVE_NAMESPACE_FILE_V1
destinationLock = NODE_EXCL_OWNER_DEATH_LOCK_V1
handleConfinement = NODE_WEAKMAP_NONCE_CALLBACK_V1
helper = NODE24_BUILTIN_FS_CHILD_PROCESS_V1
helperAbi = NODE24_MODULES_NAPI_V1
parserEquivalence = NODE_FRESH_CHILD_CANONICAL_PARSE_V1
physicalIdentity = NODE_REALPATH_BIGINT_STATFS_LEAF_V1
process = NODE_DIRECT_CHILD_HANDLE_TERMINATION_V1
runtimeLock = NODE_EXCL_OWNER_DEATH_LOCK_V1
```

`decisionWriterDigest` is recomputed as:

```text
DstableHarnessSubject = portable-primitives-stable-harness-subject/v1(
  raw32(harnessBundleDigest), raw32(testBundleDigest),
  raw32(requiredJobRegistryDigest), raw32(contractVersionsDigest)
)

DprimitiveDecisionWriter = portable-primitives-decision-writer/v1(
  raw32(DstableHarnessSubject), raw32(harnessBundleDigest),
  raw32(testBundleDigest), raw32(contractVersionsDigest)
)
```

The core's `stableHarnessSubjectDigest` must equal recomputed
`DstableHarnessSubject` from the exact ISS-006 run identities. The
administrator-authenticated terminal command must run from a protected-main
checkout whose stable bundle, tests, registry, and contracts reproduce those
same inputs; the candidate checkout cannot supply or replace them. PASS requires
`aggregateDigest` non-null, `diagnosticTerminalDigest:null`, all 63 observation
digests in exact order and PASS, every helper/ABI/OS-profile slot and profile
token non-null, and per-OS equality from each slot through its environment,
observations, locator, and custody receipt. BLOCK_REPLAN requires
`aggregateDigest:null`, a non-null diagnostic terminal digest, every profile
member null, zero through 63 available observation digests in stable subset
order, nullable helper/ABI slots only where that OS evidence is missing, every
OS-profile slot null for a `selection:null` environment, and at least one
authenticated non-PASS/missing job, artifact, or row. Exact helper/ABI evidence
may remain non-null in that diagnostic arm but grants no profile. A mixed
profile, synthetic observation, or combined run is invalid. If neither terminal
arm authenticates, no core bytes exist and the planning disposition is
BLOCK_REPLAN.

```text
DprimitiveDecisionCore = portable-primitives-capability-decision-core/v1(
  canonical decision-core bytes
)
```

`portable-primitives-independent-review/v1` has exactly `decisionCoreDigest`,
`providerReviewDigest`, `reviewDisposition`, `reviewedAt`,
`reviewerSubjectDigest`, and `schemaVersion`. `reviewDisposition` is
`AUTHORIZE_PASS|RECORD_BLOCK_REPLAN` and must equal the core's PASS or
BLOCK_REPLAN arm respectively. Its identity is:

```text
DprimitiveReview = portable-primitives-independent-review/v1(
  raw32(decisionCoreDigest), raw32(providerReviewDigest),
  text(reviewDisposition), text(reviewedAt), raw32(reviewerSubjectDigest),
  canonical review bytes
)
```

The provider adapter for that receipt is
`github-portable-primitives-independent-review/v1`, with exactly
`candidateSubjectDigest`, `coreBytesDigest`, `corePath`,
`corePullRequestAuthorId`, `decisionCoreDigest`, `mergeCommitRevision`,
`providerRunDigest`, `pullRequestNumber`, `repositoryId`,
`reviewCommitRevision`, `reviewId`, `reviewedAt`, `reviewerId`, `schemaVersion`,
and `state`. Provider/review/actor/PR IDs are positive canonical decimals,
revisions are lowercase 40-hex, digest fields are SHA-256, `state` is
`APPROVED`, and
`reviewerId != corePullRequestAuthorId`. The authenticated GitHub API must prove
the review applies to `reviewCommitRevision`, that exact head contains only the
canonical core file for this publication slice, and the reviewed head merged by
PR into protected `main` before the receipt is projected. `corePath` is exactly
`planning/decisions/ISS-022/<DprimitiveDecisionCore>/decision-core.json` and
`coreBytesDigest` is SHA-256 of those exact bytes. The adapter identities are:

```text
DproviderReview = github-portable-primitives-independent-review/v1(
  canonical provider review bytes
)

DreviewerSubject = github-reviewer-subject/v1(
  text(repositoryId), text(reviewerId)
)
```

The provider-neutral review requires `providerReviewDigest=DproviderReview`,
`reviewerSubjectDigest=DreviewerSubject`, exact core/candidate/provider-run
equality, and the provider `reviewedAt`. GitHub vocabulary never enters the
engine record.

`portable-primitives-capability-decision/v1` has exactly
`decisionCoreDigest`, `independentReviewReceiptDigest`, and `schemaVersion`.

```text
DprimitiveDecision = portable-primitives-capability-decision/v1(
  raw32(decisionCoreDigest), raw32(independentReviewReceiptDigest),
  canonical decision bytes
)
```

Publication is two reviewable protected-main PRs to avoid a digest cycle. The
existing ISS-006 stable harness checkout, never the candidate checkout, first
runs the exact command
`node scripts/conformance/run-bundled.mts terminal
portable-primitives-decision <repositoryId> <runId> <runAttempt>
<workflowRevision>` with required absolute
`PORTABLE_PRIMITIVES_OUTPUT_ROOT` outside every checkout. The four values after
the mode are the same bounded terminal arguments already authenticated by
ISS-006. Before writing, the stable bundle recomputes
`DstableHarnessSubject` and requires equality to the run/core. It writes only
`portable-primitives-<runId>-<runAttempt>-decision-core.json` below the output
root. Those bytes must equal `DprimitiveDecisionCore` and are copied unchanged
to the exact core path in the core-only PR.

After that PR receives an APPROVED review from a different actor and merges,
the same exact stable harness checkout runs
`node scripts/conformance/run-bundled.mts terminal
portable-primitives-review <repositoryId> <corePullRequestNumber>
<decisionCoreDigest> <mergeCommitRevision>` with the same external-output and
stable-subject checks. The four values after the mode are the only review
arguments. It authenticates the live review and writes only
`independent-review.json` and `decision.json`. A second PR adds those two
files beside the core at the same digest-addressed directory; protected-main
merge publishes the immutable three-file census. Any moved stable checkout,
bundle/registry/contracts mismatch, extra decision file, source-tree terminal
output, candidate writer, changed core, stale review, unmerged head,
self-review, or alternate path refuses. No installed release or N0 state is a
prerequisite.

ISS-004, ISS-005, ISS-020, and ISS-031 read the three files only from their
reviewed stable release, recompute all three digests, require PASS, select their
own OS slot, hash their actual Node executable/ABI and filesystem/statfs/case/
Unicode profile to the same `DosProfile`, and require their actual locator and
custody receipt to equal-bind those values and `DcustodyProfile`. A diagnostic
decision grants no mechanism or capability.

The GitHub adapter adds
`github-conformance-diagnostic-provider-record/v1` with exactly `artifacts`,
`candidateRevision`, `candidateSubjectDigest`, `event`, `harnessBundleDigest`,
`jobs`, `missingArtifactNames`, `missingLogicalJobIds`, `protectedRefDigest`,
`recordedAt`, `repositoryId`, `requiredJobRegistryDigest`, `runAttempt`, `runId`,
`schemaVersion`, `testBundleDigest`, `workflowPath`, `workflowRef`, and
`workflowRevision`. It uses the successful provider record's exact scalar,
protection, provider-run, job-name, artifact-name, digest/length, retention, and
time rules. Job conclusions additionally admit only GitHub's terminal
`FAILURE|CANCELLED|SKIPPED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE|STALE|
NEUTRAL`; present job and artifact rows are sorted exact subsets, while the two
missing arrays are the sorted exact complements of the stable expected census.
At least one non-SUCCESS conclusion or missing member is required.

```text
DdiagnosticProviderRecord = github-conformance-diagnostic-provider-record/v1(
  canonical diagnostic provider record bytes
)
```

The existing record job runs with `if:always()` after plan/observation/
aggregate. It writes the existing provisional record only for a valid aggregate;
otherwise it writes one attempt-qualified, `archive:false`
`conformance-<runId>-<runAttempt>-diagnostic-provider-record.json`. It never
executes candidate bytes. The workflow keeps the same plan, observation,
aggregate, and record jobs, permissions, hosted runners, and isolation boundary.

After the run is terminal, the administrator-authenticated diagnostic verifier
takes the same four bounded arguments as the successful verifier. It requires
overall run FAILURE, the exact protected workflow/ref/SHA and provider-run
identity, a successful unique record job, the unique diagnostic artifact, full
live ruleset detail with zero bypass, every live current-attempt job/artifact
equal to the record's present/missing census, at least 30 days remaining
retention for every present artifact, and the same inclusive writer time join.
It outputs closed `github-conformance-diagnostic-terminal-verification/v1` with
exactly `diagnosticProviderRecordDigest`, `protectionSnapshotDigest`,
`providerRunDigest`, `repositoryId`, `runAttempt`, `runId`, `schemaVersion`,
`verifiedAt`, and `workflowRevision`. `verifiedAt` is the canonical millisecond-
UTC projection of the final authenticated provider response's HTTPS `Date`
header; missing, repeated, malformed, or non-UTC dates refuse.

```text
DdiagnosticTerminal = github-conformance-diagnostic-terminal-verification/v1(
  canonical verification bytes
)
```

This record authenticates a failure census only; it never becomes PASS or
promotion authority. If the diagnostic record job itself is absent or non-
SUCCESS, the run remains unusable and produces no decision bytes. Exact
workflow-structure, record/parser, terminal-API, artifact-layout, missing-row,
writer-identity, protection, expiry, cross-run, and result-normalization mutants
must refuse.

The stable registry adds suite `iss022-portable-primitives`, owner package
`@orchestration-platform/portable-primitives`, runner token
`ISS022_PORTABLE_PRIMITIVES`, required helper and custody observations,
`walkRequirement:NONE`, the vector census above, and exactly
`iss022-portable-primitives-linux`, `-macos`, and `-windows`. All mutations stay
under the provider-fresh runner-temp root and cleanup proves that root absent.
No source-checkout write, compiled executable, native addon, broker, privilege,
same-host principal, reboot, credential, cache, or secret is authorized.

## Release layout and root of trust

- Before runtime state exists, ISS-022 derives immutable
  `physical-destination-identity/v1` from stable host/custody-root namespace and
  physical ancestor/leaf identity. Helper, path, case/Unicode, custody, and
  readback facts live in versioned admitted observation receipts, so helper or
  profile rotation cannot create another destination key. `Ddest` is framed
  from raw `Dphys` alone.
- A FULL_REQUIRED custody-root destination-owner pointer and one destination
  lock serialize all installation IDs for that physical destination. Its exact
  states are `ACTIVE|CONSUMED|RETIRED`; a successor requires the selected prior
  RETIRED triple/archive and an independent acyclic review core. The successor
  anchor binds that core, owner ACTIVE binds both, and a downstream
  post-selection receipt must exist before anchor/E0 work begins.
- Each installation anchor has selected `ACTIVE|CONSUMED|RETIRED` state. A
  pre-expiry use intent preserves recovery of only that transaction. E0 uses an
  immutable core that excludes its proposal/receipt/tip, a bootstrap-producer
  proposal with no selected epoch, and downstream runtime/external consumption
  receipts. Exact reinstall reuses selected CONSUMED evidence; it never creates
  parallel genesis.

- A release is an immutable bundle containing npm tarballs, module files,
  contract schemas, stable test-bundle digest, source revision, build
  provenance, and manifest hashes. No skill artifact kind exists; prose skills
  were replaced by typed `orchestration-module/v1` modules.
- Installed releases live under `<state-root>/releases/<release-digest>/`.
  Canonical `<state-root>/installation/active-release.json` is the sole
  `ACTIVE_RELEASE` tip; its selected value binds the active-release family
  record and reviewed installed-byte proof. It advances only through the common
  epoch-fenced pointer protocol. No symlink, package-manager link, second
  pointer, or candidate-owned record has authority.

### Active-release authority ledger

`active-release/v1` is the direct reviewed-release value selected by the
`ACTIVE_RELEASE` pointer. It has exactly these seven required, non-null members
in ascending canonical JSON member order; no nested proof record, optional
member, branch member, or additional installed-release schema exists:

| Member                           | Exact scalar rule           |
| -------------------------------- | --------------------------- |
| `independentReviewReceiptDigest` | SHA-256                     |
| `installedBytesDigest`           | SHA-256                     |
| `releaseDigest`                  | SHA-256                     |
| `releaseManifestDigest`          | SHA-256                     |
| `releaseSubjectDigest`           | SHA-256                     |
| `reviewedInstallerDigest`        | SHA-256                     |
| `schemaVersion`                  | literal `active-release/v1` |

`installedBytesDigest` is the reviewed installer's canonical read-back digest
of the complete installed release tree, not a candidate assertion or a digest
of proposed staging bytes. `releaseDigest` is the immutable release-directory
identity and equals `releaseSubjectDigest`; the latter name remains explicit so
the selected value is directly equal-bound to the independently reviewed
release subject without another record or lookup. The selected release root is
exactly `releases/<releaseDigest>/`. Missing, extra, renamed, null, future,
unknown, wrong-type, unequal release/subject, or noncanonical records refuse
before any pointer digest is admitted.

The record has no standalone digest domain. Its selected value digest is the
common `Dv = pointer-value/v1("ACTIVE_RELEASE", Dp, canonical active-release
bytes)`. The active-release pointer identity is stable across the installation:
kind `ACTIVE_RELEASE`, path `installation/active-release.json`, the exact
installation/project/state-root identities, `transactionId` equal to the
installation ID, and source token `none`. VALUE position evidence is exactly
`{ "mode": "VALUE", "parts": {} }` under the registered
`active-release-position/v1` domain. The mutation ID, proposal `Dr`, and tip
`Dt` use the common formulas; the selected proposal and tip both carry that
exact `Dp/Dv`, and `Dt` carries the recomputed `Dr`. Persist the value and
proposal at the common constructed `Dp`/mutation paths, the selected tip only
at `installation/active-release.json`, and the immutable bytes only under the
release root above. No directory enumeration or second pointer is authority.

The initial N0 graph is the only `ACTIVE_RELEASE` proposal admitted with
`producerKind=REVIEWED_BOOTSTRAP_GENESIS`. It has a null prior `Dt/Dv/Dr`, null
authority-epoch `Dt/Dv/Dr`, `VALUE_PROPOSED`, `SELECT`, and the exact external
reviewed-bootstrap `producerDigest = Dsc`. E0 recomputes that `Dsc` from the
same exact `BOOTSTRAP_INSTALL` reviewed operation/successor core it consumes;
the digest is never supplied by the candidate, host, or active-release value. The
generic proposal contract admits this bootstrap producer kind only through the
closed reviewed-bootstrap branches below. They include the initial
`ACTIVE_RELEASE` and `STATE_MUTATION_AUTHORITY_ROTATION` selections and the
bounded pre-E0 recovery/abort transactions needed to reach or safely decline
that genesis. Every later active-release mutation requires
`producerKind=SELECTED_EPOCH`, a non-null exact prior selected triple at the
same `Dp`, and the non-null selected stable-predecessor authority epoch triple.
A candidate's own verdict can therefore enter neither its initial selection nor
its later promotion.

E0 consumes the actual closed active-release value, proposal, and tip rather
than a caller-supplied four-digest expectation. It recomputes `Dp/Dv/Dr/Dt`, the
VALUE position digest, mutation ID, null bootstrap prior/epoch branches, and
reviewed-bootstrap producer digest. It then requires the E0 authority value's
four active-release members to equal that recomputed selected graph and directly
equal-binds the active-release value to the exact parsed `BOOTSTRAP_INSTALL`
reviewed operation and `Dsc` as follows:

| Active-release member            | Required exact equality                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `releaseDigest`                  | `releaseSubjectDigest` and reviewed operation/Dsc `reviewedReleaseSubjectDigest`   |
| `releaseSubjectDigest`           | reviewed operation `releaseSubjectDigest` and Dsc `reviewedReleaseSubjectDigest`   |
| `releaseManifestDigest`          | reviewed operation `releaseManifestDigest` and Dsc `reviewedReleaseManifestDigest` |
| `installedBytesDigest`           | reviewed operation `installedBytesDigest` and Dsc `reviewedInstalledBytesDigest`   |
| `independentReviewReceiptDigest` | reviewed operation/Dsc `independentReviewReceiptDigest`                            |
| `reviewedInstallerDigest`        | reviewed operation `reviewedInstallerDigest`                                       |

The bootstrap transaction, anchor, global identity, destination/physical
identity, owner/anchor provenance, and successor-review bindings already fixed
for E0 remain unchanged. The active-release graph adds no E0-specific record,
digest, receipt, capability, self epoch, cleanup/gate/fence record, or recovery
authority. The recovery-authorization immutable core and cleanup-gate/recovery-
fence root/head ledgers are decided below. Recovery-authorization state/native/
post-selection/archive records, cleanup archives, and later promotion receipts
remain separately unauthorized until their own literal ledgers pass removal
review.

### Reviewed-bootstrap pre-E0 producer boundary

Before E0 is selected, no stable authority epoch exists. Nevertheless the
reviewed bootstrap must durably create and consume its one-use recovery
authorization before the first destination mutation, and it must be able to
revoke and archive that exact transaction if the canonical bootstrap abort
command wins before the mutation. Requiring `SELECTED_EPOCH` for those records
is impossible, while manufacturing a bootstrap epoch would let the candidate
certify the authority intended to constrain it.

The sole pre-E0 producer is therefore the already-reviewed bootstrap successor
core `Dsc`. Every admitted proposal uses
`producerKind=REVIEWED_BOOTSTRAP_GENESIS`, `producerDigest = Dsc`, and an
all-null authority-epoch `Dt/Dv/Dr` triple. The validator recomputes `Dsc` from
the actual closed `BOOTSTRAP_INSTALL` reviewed operation and successor core,
including `G`, authority `Dp`, installation/project/state-root, target custody,
reviewed installer, release manifest/installed bytes/subject, and independent
review. A copied digest, candidate verdict, host assertion, unsigned receipt,
or caller-provided producer expectation is never sufficient.

The closed semantic branches are exactly:

| Pointer kind                        | Admitted reviewed-bootstrap branch                                                                                                                                                | Exact prior rule                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RECOVERY_AUTHORIZATION_STATE`      | initial `CREATED`; normal bootstrap `CREATED -> CONSUMED`; pre-mutation abort from `CREATED` or `CONSUMED` to `REVOKED`; exact abort archive/tombstone completion after `REVOKED` | initial `CREATED` has a null prior; every later branch carries the complete immediately selected prior `Dt/Dv/Dr` at the same transaction-scoped `Dp`                 |
| `ACTIVATION_CLEANUP_GATE`           | initial `PENDING/NOT_PUBLISHED`; pre-mutation abort `PENDING/NOT_PUBLISHED -> ABORTING/NOT_PUBLISHED -> COMPLETE/NOT_PUBLISHED`; exact abort archive/tombstone completion         | initial `PENDING/NOT_PUBLISHED` has a null prior; every later branch carries the complete immediately selected prior triple at the same installation-scoped gate `Dp` |
| `ACTIVATION_CLEANUP_ARCHIVE_HEAD`   | the exact terminal bootstrap-abort archive-head selection after authorization `REVOKED`, gate `COMPLETE/NOT_PUBLISHED`, destination absence, and all required archive read-backs  | null only when the installation archive head has never been selected; otherwise the complete immediately selected archive-head prior triple is required               |
| `ACTIVE_RELEASE`                    | the already-decided initial N0 selection                                                                                                                                          | null, as fixed by the active-release ledger                                                                                                                           |
| `STATE_MUTATION_AUTHORITY_ROTATION` | the already-decided initial E0 authority selection                                                                                                                                | null, as fixed by the genesis authority ledger                                                                                                                        |

No other pointer kind, cleanup cell, lifecycle edge, publication state,
recovery-fence state, release mutation, attachment, launch, reservation,
attempt-log mutation, later cleanup, uninstall, or later transaction admits the
reviewed-bootstrap producer. `ACTIVATION_RECOVERY_FENCE` is successor-only and
always requires the selected stable predecessor. Pre-gate abort revokes and
archives authorization without manufacturing a cleanup gate. Post-gate abort
derives the same transaction and paths from the immutable
`bootstrap-install-input/v1`, requires a fresh authoritative destination-
absence observation proving that the first destination mutation has not
occurred, and follows only the tabled `ABORTING` branch. Once the first
destination mutation is observed, abort and every new recovery/gate/archive
proposal under `Dsc` refuse; restart may only read back or idempotently finish
the already-proposed same mutation and then recover forward to E0 from the
selected `CONSUMED` authorization.

These branches use the common deterministic `Dp`, `Dv`, mutation ID, `Dr`,
`Dt`, constructed paths, conflict classification, and exact selected-tip
read-back. They do **not** enter the ordinary selected-epoch
`pointer-mutation-commit-evidence/v1`, mutation packet, or
`POINTER_MUTATION_RUN_CURRENT` protocol: making that meta pointer the producer
of the authority needed to select itself would reintroduce a cycle. The
reviewed bootstrap installer instead re-drives the same deterministic proposal
under the external destination/bootstrap lock and its existing immutable
transaction journal. A moved input, different transaction, changed prior,
different bytes, conflict, unknown read-back, or incomplete tuple refuses; it
never resolves a conflict by age or by writing another proposal.

After E0 selection, every new mutation of these families requires the exact
selected stable authority epoch and the ordinary run-current/commit protocol.
Already-selected reviewed-bootstrap records remain immutable historical
evidence but grant no live handle. Public proposal bytes are evidence, not a
capability: the reviewed installer or abort path must additionally hold the
external target-bound grant, admitted custody and kernel exclusion required by
ISS-020/ISS-022/ISS-027. Candidate N0, candidate N+1, a receipt, or knowledge of
`Dsc` alone cannot perform the CAS.

This section decides only the producer topology and branch boundary. The exact
recovery-authorization immutable core and cleanup-gate/recovery-fence root/head
bytes are fixed by the next two ledgers. Recovery-authorization state/native/
post-selection/archive records, cleanup-archive records, and their composed
equality matrices remain unauthorized until their own removal rounds pass;
implementation may not infer those bytes from this branch table.

### Recovery-authorization immutable-core literal ledger

This ledger fixes only the immutable `recovery-authorization-core/v1` evidence
record, its canonical path, and its digest. It deliberately excludes lifecycle,
gate selection, native consume/removal, post-selection observation, attachment,
archive, tombstone, selected epoch, proposal, receipt, tip, and read-back facts.
Those downstream facts cannot enter the core without creating a cycle or making
future evidence part of the authority that precedes it.

The scalar names below use the global closed `sha256`, `uuid-v7`,
`safe-decimal`, and `timestamp` grammars. The record is a closed mode union.
Every branch has all and only these fifteen common members
in ascending canonical JSON member order:

```text
candidateDigest:sha256
capabilityDigest:sha256
capabilityReferenceDigest:sha256
expiresAt:timestamp
hostIdentityDigest:sha256
installationId:uuid-v7
issuedAt:timestamp
mode:BOOTSTRAP|SUCCESSOR
nativeGeneration:safe-decimal
producerDigest:sha256
projectId:uuid-v7
schemaVersion:recovery-authorization-core/v1
stateRootDigest:sha256
transactionId:uuid-v7
userIdentityDigest:sha256
```

The `BOOTSTRAP` branch additionally has exactly these three members, interleaved
with the common members in ascending canonical JSON member order:

```text
destinationDigest:sha256
grantDigest:sha256
installerDigest:sha256
```

The `SUCCESSOR` branch instead additionally has exactly these twelve members,
again interleaved canonically:

```text
admissionDigest:sha256
cycleId:uuid-v7
expectedActiveGeneration:safe-decimal
predecessorBrokerGeneration:safe-decimal
predecessorExecutableDigest:sha256
predecessorOperationManifestDigest:sha256
predecessorReleaseDigest:sha256
recoveryFenceRootDigest:sha256
successorBrokerGeneration:safe-decimal
successorExecutableDigest:sha256
successorOperationManifestDigest:sha256
successorReleaseDigest:sha256
```

Mode members from the other branch are absent, not null. Inserting any
BOOTSTRAP-only member into a SUCCESSOR core, any SUCCESSOR-only member into a
BOOTSTRAP core, `candidateOperationManifestDigest`, a candidate verdict, a raw
capability/reference, a selected authority tuple, or any unknown member is a
closed-record failure. The engine treats every identity digest as opaque;
repository, code-host, operating-system credential-store, and provider names
are adapter vocabulary and are not core members.

`issuedAt` is strictly less than `expiresAt`. The structural parser proves only
that internal order and consults no clock. Later composition must supply an
authenticated admission time and require `issuedAt <= admittedAt < expiresAt`.
After exact native consumption and selected `CONSUMED` state, the later
authorization is non-expiring transaction evidence rather than a bearer
secret. `nativeGeneration` and all SUCCESSOR generations use canonical safe-
decimal strings. In SUCCESSOR mode, `successorBrokerGeneration` is exactly
`predecessorBrokerGeneration + 1`; grammar, bounds, and increment are checked
before numeric conversion. Equality of `expectedActiveGeneration` to an actual
broker read-back belongs to the later composed validator, not this structural
core parser.

The canonical core path is exactly:

```text
installation/recovery-authorizations/<transactionId>/core.json
```

where `<transactionId>` is the exact canonical UUIDv7 member. The path is
constructed evidence, not a filesystem lookup protocol or mutation authority.
Symlinks, alternate roots, caller paths, enumeration, and latest-file
conventions grant nothing.

The sole core digest is:

```text
Dac = SHA256(frame("recovery-authorization-core/v1", canonical core bytes))
```

The frame has exactly one canonical-record part after the literal domain. Raw
JSON text, untagged canonical digest, field-wise reframing, cross-domain reuse,
or a second core identity refuses. In BOOTSTRAP mode, later composition must
recompute `producerDigest = Dsc` from the reviewed `BOOTSTRAP_INSTALL` operation
and bind grant, installer, candidate, destination, host/user, state-root, and
transaction identities to their authenticated sources. In SUCCESSOR mode,
later composition must recompute the stable-promotion `Dsc`, bind the actual
selected predecessor/candidate release and broker/admission graphs, require the
transaction's exact constructed recovery-fence root path
`installation/activation-recovery-fence-roots/<transactionId>.json`, and bind
`recoveryFenceRootDigest = Dfr`. That derivable path is not a core member.
Consistently copied core fields or a supplied expected digest are never an
equality source.

The digest order is acyclic. A SUCCESSOR recovery-fence root is computed before
`Dac`; `Dac` and the selected CREATED authorization triple are then upstream of
the cleanup-gate root `Dgr`. Neither `Dgr` nor a selected authorization value is
a core member. BOOTSTRAP has no recovery-fence member. No branch lets a
candidate, receipt, host assertion, or the core itself certify its producer.

This slice authorizes only a total closed core parser, the deterministic core
path constructor, and `Dac` computation. It authorizes no authorization-state,
native receipt, post-selection receipt, archive, tombstone, attachment,
composed equality validator, persistence lookup, credential-broker operation,
live capability, pointer proposal, CAS, runtime mutation, or candidate self-
certification. Those surfaces remain fail-closed until their later literal
ledgers and independent removal rounds pass.

Compatibility evidence for this core slice must remove, add, rename, reorder,
cross-type, or cross-mode every member; attack both exact branch censuses,
strict issue/expiry order, zero/max/overflow generation strings, successor
generation adjacency, canonical path construction, hostile reflective inputs,
and the forbidden `candidateOperationManifestDigest`. Exact-byte goldens must
pin one BOOTSTRAP core and one SUCCESSOR core plus both `Dac` values. Deleting
the domain tag, branch closure, timing check, safe-decimal bound, generation
increment, or exact path relation must make a committed mutant pass and
therefore fail the suite. Upstream grant/review/release/broker/fence equality
mutants belong only to the later closed composition matrix.

### Recovery-authorization state literal ledger

This ledger fixes only the selected value bytes for the transaction-scoped
`RECOVERY_AUTHORIZATION_STATE` pointer, its exact VALUE position, and pure
value-to-value lifecycle checks. Native consume/removal receipts,
post-selection receipts, archive/tombstone bytes, selected proposal/receipt/tip
composition, persistent discovery, broker operations, and live mutation remain
separately unauthorized. Every digest naming one of those deferred records is
opaque structural evidence here and grants no authority until its own literal
ledger and the closed composed equality matrix pass removal review.

`recovery-authorization-state/v1` is a closed three-branch union. The scalar
names below use the global closed `sha256`, `uuid-v7`, and `timestamp` grammars.
Every branch contains all and only the members listed for it in ascending
canonical JSON member order.

`CREATED` has exactly seven members:

```text
authorizationCoreDigest:sha256
consumeOperationId:uuid-v7
lifecycle:CREATED
mode:BOOTSTRAP|SUCCESSOR
recordedAt:timestamp
schemaVersion:recovery-authorization-state/v1
transactionId:uuid-v7
```

The broker producer prebinds `consumeOperationId` before CREATED is proposed;
the structural parser proves only its canonical UUIDv7 grammar. It does not
derive or execute the operation.

`CONSUMED` has exactly nine members:

```text
authorizationCoreDigest:sha256
cleanupGateRootDigest:sha256
consumeOperationId:uuid-v7
lifecycle:CONSUMED
mode:BOOTSTRAP|SUCCESSOR
nativeConsumeReceiptDigest:sha256
recordedAt:timestamp
schemaVersion:recovery-authorization-state/v1
transactionId:uuid-v7
```

`REVOKED` has exactly twelve members:

```text
authorizationCoreDigest:sha256
cleanupGateRootDigest:nullable sha256
consumeOperationId:uuid-v7
consumePostSelectionReceiptDigest:nullable sha256
lifecycle:REVOKED
mode:BOOTSTRAP|SUCCESSOR
nativeConsumeReceiptDigest:nullable sha256
nativeRemovalReceiptDigest:sha256
recordedAt:timestamp
removalOperationId:uuid-v7
schemaVersion:recovery-authorization-state/v1
transactionId:uuid-v7
```

In REVOKED, `consumePostSelectionReceiptDigest` and
`nativeConsumeReceiptDigest` are exactly both null or both non-null. When they
are non-null, `cleanupGateRootDigest` is also non-null. A null consume pair with
a null gate denotes the structurally possible pre-gate CREATED revocation; a
null consume pair with a non-null gate denotes the structurally possible
post-gate CREATED revocation. The all-non-null arm is the only structurally
possible revocation after CONSUMED. These are nullability rules only: this
slice does not authenticate which upstream receipt or gate the digests name.

`REMOVED` is not a `recovery-authorization-state/v1` lifecycle value. Terminal
removal is represented only by the common selected `pointer-tombstone-value/v1`
after the later recovery-authorization archive ledger is satisfied. A
`REMOVED` state record, bare absence, deletion, or an archive digest inserted
into this value schema refuses. The existing public recovery-authorization
lifecycle type/list is narrowed to exactly `CREATED|CONSUMED|REVOKED`, and the
legacy string-only `REVOKED -> REMOVED` transition is deleted. There is one
public parsed-value transition contract, not a second legacy state machine.

The only pure value transitions are:

```text
null -> CREATED
CREATED -> CONSUMED
CREATED -> REVOKED
CONSUMED -> REVOKED
```

Every non-genesis transition preserves exact `authorizationCoreDigest`,
`consumeOperationId`, `mode`, and `transactionId`, and requires prior
`recordedAt <= next recordedAt`. `CREATED -> REVOKED` requires the REVOKED
consume pair to be null. `CONSUMED -> REVOKED` requires the REVOKED consume
pair and gate to be non-null, equal-binds `cleanupGateRootDigest` and
`nativeConsumeReceiptDigest` to the CONSUMED value, and keeps the same
prebound consume operation. Self-loops, skips, reverse edges, a second CREATED,
and every future lifecycle refuse. The pure transition validator consumes only
the two parsed values and does not claim selected-history continuity,
currentness, or mutation authority.

The canonical pointer path remains exactly:

```text
installation/recovery-authorizations/<transactionId>/state.json
```

where the path transaction equals the canonical value `transactionId`. The
exact VALUE position evidence is the closed record:

```json
{ "mode": "VALUE", "parts": {} }
```

It hashes only under the already-registered
`authorization-state-position/v1` domain. Missing/extra outer or nested
members, nonempty `parts`, another mode, a cleanup/fence position, and any
TOMBSTONE position refuse. The common path-instance and pointer-value formulas
remain the sole `Dp`/`Dv` authority; this ledger adds no standalone state digest
and no alternate pointer path. Tombstone position and archive equality remain
deferred to the archive ledger.

Because `Dv` requires authenticated pointer context absent from a detached
state record, generic
`serializeContract("recovery-authorization-state/v1", value)` fails closed with
exactly `serialization:pointer-context-required` and returns neither bytes nor
a digest. It must not return the untagged canonical digest, synthesize a `Dp`,
or expose a state-specific digest helper. After the detached value parses,
canonical state bytes use the existing canonical byte primitive; the sole
authority identity is then computed by the existing common
`computePointerValueDigest("RECOVERY_AUTHORIZATION_STATE", Dp, value)` with the
caller's independently authenticated `Dp`. `parseCanonicalContractBytes`
continues to admit only exact canonical detached bytes and grants no identity.

This slice authorizes only a total closed state parser, exact VALUE-position
parser/common position-digest dispatch, and the pure lifecycle transition
validator. It also authorizes the bounded public-API closure above: generic
state serialization refusal and removal/replacement of the obsolete
string-only REMOVED lifecycle surface. It authorizes no native or
post-selection receipt parser, archive, tombstone, composed core/gate/receipt
equality, selected proposal/receipt/tip validator, persistence lookup, broker
call, capability, pointer proposal, CAS, command, filesystem mutation, or
runtime recovery.

Compatibility evidence must remove, add, rename, reorder, null, or cross-type
every member in all three branches; insert every opposite-branch member; attack
the three REVOKED nullability cells; and pin exact canonical bytes for CREATED,
CONSUMED, and all three REVOKED structural cells. Position goldens must kill an
empty/nonempty-parts, VALUE/TOMBSTONE, or domain-dispatch substitution. Pure
transition tests must cover all four legal edges, every illegal edge,
inclusive timestamp equality, all preserved-field substitutions, both direct-
CREATED revocation cells, the CONSUMED revocation equality edges, and hostile
reflective inputs. Deleting any branch closure, nullability implication,
transition edge, preserved-field equality, inclusive time comparison, or
position closure must make a committed mutant survive and therefore fail the
suite. Public-API evidence must prove exact generic serializer refusal, no
untagged state digest or standalone state-digest helper, canonical detached
bytes for all five structural cells, common `Dv` equality and `Dp` sensitivity,
and the absence of `REMOVED`, `REVOKED -> REMOVED`, or a second legacy
transition entry point.

### Recovery-authorization native-receipt literal ledger

This ledger fixes only the two immutable, non-secret native-operation receipts
that precede selected `CONSUMED` or `REVOKED` authorization state. It does not
define the downstream post-selection receipts, authorization archive,
tombstone, selected-state composition, credential-broker IPC, native-provider
implementation, or runtime mutation. A receipt is evidence that later
composition must authenticate; possession of its bytes or digest is never a
capability and never selects authorization state.

The scalar names below use the global closed `sha256`, `uuid-v7`,
`safe-decimal`, and `timestamp` grammars. Every record contains all and only
the listed members in ascending canonical JSON member order. Identity digests
are opaque engine vocabulary; operating-system, credential-store, service,
endpoint, provider, and repository names are not members.

`native-consume-receipt/v1` has exactly six members:

```text
authorizationCoreDigest:sha256
nativeGeneration:safe-decimal
operationId:uuid-v7
recordedAt:timestamp
schemaVersion:native-consume-receipt/v1
transactionId:uuid-v7
```

The record exists only after the native provider has successfully consumed the
one-use authorization at exactly `nativeGeneration` and the reviewed broker has
read back the resulting non-secret evidence. `recordedAt` is the durable
receipt-creation time after that native operation and read-back, not a caller
request time. Attempted, denied, partial, unknown, or caller-asserted outcomes
produce no authenticated receipt. The structural parser proves only the closed
census and scalar grammars; ISS-032 later authenticates the provider operation,
read-back, and receipt-creation time, and the ISS-004 composition must parse the
actual core, recompute `Dac`, equal-bind `authorizationCoreDigest`, and require
the core `issuedAt <= recordedAt < expiresAt`.

`native-removal-receipt/v1` has exactly nine members:

```text
authorizationCoreDigest:sha256
nativeConsumeReceiptDigest:nullable sha256
operationId:uuid-v7
priorNativeGeneration:safe-decimal
recordedAt:timestamp
removalDisposition:ABSENT|DISABLED
schemaVersion:native-removal-receipt/v1
successorNativeGeneration:safe-decimal
transactionId:uuid-v7
```

`successorNativeGeneration` is exactly `priorNativeGeneration + 1` under the
canonical safe-integer rules. Null `nativeConsumeReceiptDigest` is the sole
structural arm for removal from CREATED; non-null is the sole structural arm
for removal after CONSUMED. This parser does not decide which arm is current.
Later composition must bind null/non-null to the actual selected prior state,
bind a non-null digest to the actual parsed native-consume receipt, require
`priorNativeGeneration` equal the core/native-consume generation, and
authenticate the provider-specific `ABSENT` or `DISABLED` read-back under the
reviewed adapter. Neither disposition permits bare absence or a future
generation to restore authority.

The receipts deliberately do not repeat core `capabilityDigest`,
`capabilityReferenceDigest`, `hostIdentityDigest`, `installationId`,
`projectId`, `stateRootDigest`, or `userIdentityDigest`. The actual parsed core
and recomputed `Dac` are the sole source for those facts; copied receipt fields
would add no independent provenance and would expand the public equality matrix
without discriminating an attack. ISS-032's later native-provider ledger may
define additional authenticated read-back evidence, but it may not silently
insert that provider vocabulary into these records.

Both receipt paths are constructed beneath the immutable transaction root:

```text
installation/recovery-authorizations/<transactionId>/native/<operationId>.json
```

Structurally, each receipt constructs its own path from its own canonical
`transactionId` and `operationId`; another otherwise valid UUIDv7 pair is
another valid structural receipt and path. Later ISS-004 composition alone
requires consume `operationId` equal the prebound state `consumeOperationId`,
removal `operationId` equal the REVOKED state `removalOperationId`, and the two
operation IDs for one transaction be distinct. The shared directory is not an
ambiguity once those relations are authenticated: the expected schema
discriminator, exact operation ID, canonical bytes, and domain-tagged digest
all have to match. Alternate caller paths, enumeration, latest-file selection,
another schema at the selected path, a moved transaction, or a duplicate
operation ID grant nothing.

The sole receipt identities are:

```text
Dnc = SHA256(frame("native-consume-receipt/v1", canonical consume receipt bytes))
Dnr = SHA256(frame("native-removal-receipt/v1", canonical removal receipt bytes))
```

Each frame has exactly one canonical-record part after the literal domain.
Untagged canonical digests, raw JSON text, cross-receipt domain reuse,
field-wise framing, or common pointer `Dv` framing refuse. Generic
`serializeContract` for either exact schema returns its domain-tagged digest
and canonical bytes through the existing public `SerializationResult` success
arm `{ ok: true, bytes, digest }`, where `digest` is respectively `Dnc` or
`Dnr`. There is no additional receipt-specific envelope or digest helper, no
untagged fallback identity, and no third native-receipt domain.

Both records are create-once immutable `FULL_REQUIRED` evidence. Retrying the
same operation may only read back byte-identical canonical bytes at the same
path; different bytes, another schema, or a second operation result is a
conflict and refuses. Missing, truncated, noncanonical, or unreadable bytes are
`UNKNOWN`, never evidence of absence or successful consume/removal. Whether a
later reviewed archive may replace live receipt lookup is deferred to the
authorization-archive ledger; this slice defines no deletion, compaction, or
retention shortcut.

Those are normative future persistence requirements, not claims made by the
structural parser. ISS-032 owns the native provider call, create-once write,
byte-identical retry/read-back, provider disposition authentication, and
receipt-creation timestamp. ISS-004 owns selected-state composition and must
turn missing, conflicting, or unreadable required evidence into fail-closed
`UNKNOWN`. Until those independently reviewed implementations exist,
structurally parseable bytes—including a caller-asserted `ABSENT` or `DISABLED`
literal—are unauthenticated evidence and grant no authority.

The operation order remains acyclic and is not executed by this slice. Native
consume writes and read-backs `Dnc` before a later state proposal may contain
it; native removal writes and read-backs `Dnr` before a later REVOKED state may
contain it. The downstream post-selection receipts then bind the actual
selected state triples and these native receipts, so neither post-selection
receipt can enter a native receipt preimage. Removal time must later satisfy
actual prior-state `recordedAt <= native removal recordedAt <= REVOKED
recordedAt`; consume time must satisfy actual CREATED `recordedAt <= native
consume recordedAt <= CONSUMED recordedAt`. Equality is allowed for durable
operations recorded at one canonical instant.

This slice authorizes only total closed parsers, deterministic native receipt
path construction, the two domain-separated digest functions, canonical
serialization, and compatibility registration. It authorizes no native
provider call, secret/reference materialization, post-selection receipt,
archive, tombstone, selected proposal/receipt/tip composition, persistent
lookup, broker service, capability, pointer proposal, CAS, command, filesystem
mutation, or runtime recovery. Those surfaces remain fail closed until their
own literal ledgers and independent removal rounds pass.

Compatibility evidence must remove, add, rename, reorder, null, or cross-type
every member; pin exact canonical bytes and `Dnc`/`Dnr` goldens; prove each
receipt's canonical path changes with its own transaction or operation ID; and
attack zero/max/overflow and non-adjacent removal generations,
consume/removal schema and digest-domain substitution, nullable consume arms,
and hostile reflective inputs without throwing. Public serializer tests pin
the existing exact success-arm shape and tagged digest for both schemas and
kill an untagged fallback. Deleting either domain tag, branch closure,
safe-decimal bound, generation increment, path input, or serializer route must
make a committed mutant survive and therefore fail the suite. Structural tests
accept any otherwise valid UUIDv7 pair and make no cross-operation refusal,
persistence, provider, disposition-authentication, or time-composition claim.
Core/state/receipt equalities, operation-ID distinctness, selected path/schema
read-back, time order, selected-history currentness, and native-provider
outcomes belong only to the named later ISS-004/ISS-032 matrices.

### Recovery-authorization post-selection receipt literal ledger

This ledger fixes only the two immutable observations written after an actual
authorization-state selection has been read back. The records close the crash
gap between a native operation, the selected state CAS, and a durable broker
observation of that selection. They are evidence, not authority: neither bytes
nor digest can select state, authenticate a native provider, manufacture a
producer epoch, issue a capability, or let a candidate certify itself.

`recovery-authorization-consume-receipt/v1` and
`recovery-authorization-revoke-receipt/v1` each have exactly these five
members in ascending canonical JSON member order:

```text
operationId:uuid-v7
recordedAt:timestamp
schemaVersion:recovery-authorization-consume-receipt/v1|recovery-authorization-revoke-receipt/v1
selectedStateTipDigest:sha256
transactionId:uuid-v7
```

The schema literal is branch-local; a consume record cannot carry the revoke
literal or vice versa. The two records intentionally do not copy
`authorizationCoreDigest`, gate, native-receipt, lifecycle, mode, generation,
or removal-disposition fields. Later composition must parse the actual selected
state value/proposal/tip, reconstruct its canonical path and empty VALUE
position, recompute `Dp/Dv/Dr/Dt`, require receipt
`selectedStateTipDigest = Dt`, and then read the core and native receipts named
by that state. `Dt` directly commits the exact `Dp/Dv/Dr` through the closed
current-tip record and framing. Copying `Dp`, `Dv`, or `Dr` beside it would add
no independent source, locator, or replay discriminator and would recreate the
proof-bag surface deleted by the proportionality replans. `Dt` alone is the
selected snapshot identity, including its pointer-instance context.

The canonical paths are:

```text
installation/recovery-authorizations/<transactionId>/receipts/<operationId>.json
```

Structurally, each receipt constructs its own path from its own canonical UUIDv7
members and accepts any otherwise valid pair. ISS-004 later requires consume
`operationId` equal the selected state's prebound `consumeOperationId`, revoke
`operationId` equal selected REVOKED `removalOperationId`, and transaction/path
identity equal the selected state. A consume and revoke operation for one
transaction remain distinct. A structural parser cannot decide those
relations and must not reject another valid UUIDv7 pair.

The sole identities are:

```text
Drcp = SHA256(frame("recovery-authorization-consume-receipt/v1", canonical consume post-selection receipt bytes))
Drrp = SHA256(frame("recovery-authorization-revoke-receipt/v1", canonical revoke post-selection receipt bytes))
```

Each frame has exactly one canonical-record part after its literal domain.
Generic `serializeContract` uses the existing
`{ ok: true, bytes, digest }` success arm and returns exactly `Drcp` or `Drrp`.
Untagged canonical digests, raw JSON, swapped domains, field-wise framing,
common pointer `Dv`, another helper identity, or a third post-selection domain
refuse.

`recordedAt` is the durable receipt-creation time after exact selected-tip
read-back, not proposal time or caller request time. ISS-032 owns create-once
write, byte-identical retry, selected read-back observation, and receipt-time
production. ISS-004 owns the later closed composition and must require actual
selected state `recordedAt <= post-selection recordedAt`, exact operation/path
equality, and the complete recomputed state graph. Parser success alone does
not authenticate that read-back or time.

Both records are immutable `FULL_REQUIRED` evidence. Missing, conflicting,
noncanonical, truncated, or unreadable bytes are fail-closed `UNKNOWN` in the
later ISS-004/ISS-032 flow; bare absence never means that consume or revoke
completed. Those persistence and composition obligations are normative future
requirements, not behavior authorized in this structural slice. Archive and
tombstone treatment remains separately gated and grants no deletion or
compaction shortcut here.

The order is acyclic. Native receipt precedes selected state; selected state
precedes its post-selection receipt. The post-selection receipt contains only
digests already fixed by that selection, and no selected state, native receipt,
core, gate, proposal, or tip contains the downstream post-selection digest.
For the later CONSUMED-to-REVOKED edge, the selected REVOKED state may carry the
already-existing consume post-selection digest, but the downstream revoke
post-selection receipt never enters the REVOKED state preimage.

This slice authorizes only total closed parsers, receipt-own path construction,
the two domain-separated digest functions, canonical serializer routes, and
compatibility registration. It authorizes no selected-state graph validator,
provider read-back, persistent lookup/write, broker operation, native receipt
authentication, archive, tombstone, capability, pointer proposal, CAS,
command, filesystem mutation, or runtime recovery.

Compatibility evidence must remove, add, rename, reorder, null, or cross-type
every member; pin both canonical byte/path/digest goldens; prove each path is
sensitive to its own transaction and operation IDs while accepting any valid
pair; swap schemas and digest domains; kill an untagged serializer fallback;
and cover hostile reflective input without throwing. Deleting a closure,
domain tag, path input, schema-specific serializer route, or exact schema
literal must make a committed mutant survive and therefore fail the suite.
Structural tests make no operation-equality, selected-graph, lifecycle,
currentness, timing, persistence, provider, native-receipt, or archive claim;
those remain in the named later ISS-004/ISS-032 composition matrices.

### Recovery-authorization archive literal ledger

This ledger fixes only the immutable transaction archive written after the
selected REVOKED state and its revoke post-selection receipt have both been
read back. The archive is evidence, not authority. It cannot select a
tombstone, delete state, authenticate a provider, issue a capability, or let a
candidate certify itself.

`recovery-authorization-archive/v1` has exactly these four members in ascending
canonical JSON member order:

```text
archivedAt:timestamp
revokePostSelectionReceiptDigest:sha256
schemaVersion:recovery-authorization-archive/v1
transactionId:uuid-v7
```

The archive intentionally does not copy `Dp`, `Dv`, `Dr`, `Dt`, `Dac`, native
receipt, gate, lifecycle, mode, generation, operation, or removal-disposition
fields. Later composition parses the actual revoke post-selection receipt,
recomputes `Drrp`, requires archive
`revokePostSelectionReceiptDigest = Drrp`, follows its selected `Dt`, parses
the actual REVOKED value/proposal/tip, and recomputes the complete
`Dp/Dv/Dr/Dt` graph. Because
`Drrp` commits the receipt's exact selected `Dt`, operation, transaction, and
receipt time, copying any of those facts into the archive would add no
independent source or replay discriminator.

The canonical path is:

```text
installation/recovery-authorizations/<transactionId>/archive.json
```

The sole archive identity is:

```text
Draa = SHA256(frame("recovery-authorization-archive/v1", canonical archive bytes))
```

The frame has exactly one canonical-record part after its literal domain.
Generic `serializeContract` uses the existing
`{ ok: true, bytes, digest }` success arm and returns exactly `Draa`. An
untagged canonical digest, raw JSON, field-wise framing, another archive
domain, common pointer `Dv`, or any second archive identity refuses.

`archivedAt` is the durable archive-creation time after exact revoke-receipt
read-back. ISS-032 owns create-once write, byte-identical retry, read-back, and
time production. ISS-004 owns later composition and must require the parsed
revoke receipt's `transactionId` equal the archive transaction, its
`recordedAt <= archivedAt`, its operation equal selected REVOKED
`removalOperationId`, and its `selectedStateTipDigest` equal the recomputed
REVOKED `Dt`. It must independently mutate the archive digest field, actual
receipt bytes, and both together with every affected downstream digest
recomputed; each refuses at the direct `Drrp` equality or another authenticated
upstream seam. Parser success alone authenticates none of those relations.

The recovery-authorization tombstone position is exactly the closed record:

```json
{ "mode": "TOMBSTONE", "parts": {} }
```

It hashes only under the already-registered
`authorization-state-position-tombstone/v1` domain. The empty parts avoid
copying archive or terminal-proof digests already committed by the successor
`pointer-tombstone-value/v1` and common mutation ID. VALUE continues to use its
distinct empty-parts `authorization-state-position/v1` domain. Cross-mode,
nonempty-parts, cross-family, or untagged positions refuse.

Later ISS-004 terminal composition, not this ledger, must parse the actual
archive and tombstone, recompute `Draa`, and require the tombstone's
`pointerKind = RECOVERY_AUTHORIZATION_STATE`, `archiveDigest = Draa`, prior
`Dt/Dv/Dr` equal the actual selected REVOKED graph, and
`terminalProofDigest = Drrp`. It also requires `archivedAt <= tombstonedAt`,
the same transaction-scoped `Dp`, a `TOMBSTONE_PROPOSED/REMOVE` proposal under
the stable external mutation epoch, exact selected read-back, and no
candidate/self-certification path. A selected tombstone is FULL_REQUIRED;
bare absence, deletion, truncation, conflict, or unreadable archive/tombstone
is `UNKNOWN`, never successful removal. No retention or compaction authority
is introduced.

The order is acyclic: selected REVOKED state -> revoke post-selection receipt
`Drrp` -> archive `Draa` -> common tombstone proposal/selection. The archive
contains only upstream `Drrp`; the revoke receipt and REVOKED graph contain no
archive or tombstone digest. The generic tombstone carries the upstream archive
and terminal proof, but neither is downstream of that tombstone.

This slice authorizes only a total closed archive parser, the existing
transaction archive-path constructor, `Draa`, its canonical serializer route,
compatibility registration, and the exact empty-parts TOMBSTONE-position
parser/digest route. It authorizes no selected-state/revoke/archive/tombstone
composition, provider read-back, persistent lookup/write, broker operation,
pointer proposal, CAS, deletion, capability, command, filesystem mutation, or
runtime recovery.

Compatibility evidence must remove, add, rename, reorder, null, and cross-type
all four archive members; reject every deleted copied field; pin canonical
bytes/path/`Draa`; kill domain and untagged-serializer fallbacks; cross VALUE,
TOMBSTONE, nonempty-parts, and other-family positions through both specialized
and common digest APIs; and cover hostile reflective inputs without throwing.
Deleting a closure, domain, path input, schema-specific serializer route,
position-mode/parts check, or schema literal must make a committed mutant
survive and therefore fail the suite. Structural tests make no receipt/state
equality, currentness, timing, persistence, tombstone selection, deletion, or
runtime claim; those remain in the named later ISS-004/ISS-032 matrices.

### Cleanup-gate and recovery-fence literal ledger

This ledger fixes only the two immutable roots and their bounded state-history
values. It deliberately does not copy terminal proofs, broker receipts,
authorization receipts, selected release records, or archive records into the
heads. Those facts remain required inputs to the composed transition validator
and later downstream archive, but the selected state value is not a proof bag.
This deletes the superseded v2 head's nullable proof bundle and avoids a
head/archive digest cycle.

The scalar names below use the global closed `sha256`, `uuid-v7`,
`safe-decimal`, and `timestamp` grammars. `nullable sha256` means exactly null
or a lowercase SHA-256 digest. Each row is one closed record with all and only
the listed members in ascending canonical JSON member order:

| Schema                              | Exact members and types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activation-cleanup-gate-root/v1`   | `authorizationCoreDigest:sha256`, `authorizationCreatedReceiptDigest:sha256`, `authorizationCreatedTipDigest:sha256`, `authorizationCreatedValueDigest:sha256`, `candidateActiveReleaseValueDigest:sha256`, `cleanupArchivePredecessorReceiptDigest:nullable sha256`, `cleanupArchivePredecessorTipDigest:nullable sha256`, `cleanupArchivePredecessorValueDigest:nullable sha256`, `createdAt:timestamp`, `installationId:uuid-v7`, `mode:BOOTSTRAP\|SUCCESSOR`, `predecessorActiveReleaseReceiptDigest:nullable sha256`, `predecessorActiveReleaseTipDigest:nullable sha256`, `predecessorActiveReleaseValueDigest:nullable sha256`, `projectId:uuid-v7`, `recoveryFenceRootDigest:nullable sha256`, `schemaVersion:activation-cleanup-gate-root/v1`, `stateRootDigest:sha256`, `successorCoreDigest:sha256`, `transactionId:uuid-v7` |
| `activation-cleanup-gate-head/v1`   | `lifecycle:PENDING\|ACTIVATING\|ABORTING\|COMPLETE`, `ordinal:safe-decimal`, `priorHeadValueDigest:nullable sha256`, `publication:NOT_PUBLISHED\|PUBLISHING\|PUBLISHED\|CLEARED`, `recordedAt:timestamp`, `rootDigest:sha256`, `schemaVersion:activation-cleanup-gate-head/v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `activation-recovery-fence-root/v1` | `candidateActiveReleaseValueDigest:sha256`, `candidateBrokerAdmissionDigest:sha256`, `cleanupArchivePredecessorReceiptDigest:sha256`, `cleanupArchivePredecessorTipDigest:sha256`, `cleanupArchivePredecessorValueDigest:sha256`, `createdAt:timestamp`, `installationId:uuid-v7`, `predecessorActiveReleaseReceiptDigest:sha256`, `predecessorActiveReleaseTipDigest:sha256`, `predecessorActiveReleaseValueDigest:sha256`, `predecessorBrokerGeneration:safe-decimal`, `projectId:uuid-v7`, `schemaVersion:activation-recovery-fence-root/v1`, `stateRootDigest:sha256`, `successorBrokerGeneration:safe-decimal`, `successorCoreDigest:sha256`, `transactionId:uuid-v7`                                                                                                                                                              |
| `activation-recovery-fence-head/v1` | `ordinal:safe-decimal`, `priorHeadValueDigest:nullable sha256`, `recordedAt:timestamp`, `rootDigest:sha256`, `schemaVersion:activation-recovery-fence-head/v1`, `state:PREPARED\|POST_ACTIVATION`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

All non-nullable members are required. Missing, extra, renamed, duplicate,
wrong-type, noncanonical, unknown/future-schema, partial nullable group, or
unsafe-ordinal records refuse before any digest is used. No nested record,
array, path, executable, operation manifest, candidate verdict, capability,
selected epoch, proposal, receipt, tip, archive, tombstone, or read-back member
is present in any of the four records.

The cleanup-root structural nullability matrix is exact:

| Root mode   | Cleanup-archive predecessor triple | Predecessor active-release triple | Recovery-fence root |
| ----------- | ---------------------------------- | --------------------------------- | ------------------- |
| `BOOTSTRAP` | all null or all non-null           | all null                          | null                |
| `SUCCESSOR` | all non-null                       | all non-null                      | non-null            |

The three members of each nullable triple are all null or all non-null. This
matrix is a parser rule only. In particular, the BOOTSTRAP all-null archive arm
does not prove that the canonical archive head has never been selected, and an
all-non-null arm does not prove which archive it selects. The later cleanup-
archive composition ledger must distinguish first-ever absence from a selected
archive or tombstone and from missing, corrupt, or otherwise `UNKNOWN`
FULL_REQUIRED history. Bare filesystem absence, a caller Boolean, or a copied
digest is never that proof.

No root-field equality to authorization, active-release, cleanup-archive,
fence, admission, generation, `Dsc`, or create-once time is implementation-
authorized by this slice. Those fields remain closed typed bytes so their
canonical root digest is stable, but they grant no authority until a later
closed composition input census and exhaustive branch proof matrix bind them to
actual authenticated upstream records. A digest copied consistently across a
root and caller expectations is not an equality source.

The recovery-fence root is successor-only and every member is non-null. Its
broker generations are canonical safe-decimal strings and the successor is
exactly the predecessor plus one. The fence root excludes authorization
core/state and all gate facts so the eventual composed graph can compute it
before authorization CREATED and the gate root without a digest back-edge.
Equality to the actual predecessor/candidate active-release graphs, cleanup
archive, admission read-back, and recomputed STABLE_PROMOTION `Dsc` is deferred
with that composed graph and is not performed by the structural parser.

The only standalone root digests are:

```text
Dgr = SHA256(frame("activation-cleanup-gate-root/v1", canonical gate-root bytes))
Dfr = SHA256(frame("activation-recovery-fence-root/v1", canonical fence-root bytes))
```

Each formula has exactly one canonical-record framed part after the literal
domain. Member-wise reframing, raw JSON text, untagged canonical digest, a v2
domain, or swapping the two domains refuses. The head schemas have no second
standalone digest. Their sole identity is the common pointer value digest
`Dv = pointer-value/v1(kind, Dp, canonical head bytes)`. Consequently
`priorHeadValueDigest` is the prior head's recomputed common `Dv`, not an
untagged hash or a second head ID.

The gate history starts only at `PENDING/NOT_PUBLISHED`; its admissible ten
cells and twelve non-self edges remain exactly the existing closed graph. The
fence history starts only at `PREPARED` and has at most the single
`PREPARED -> POST_ACTIVATION` edge. For both histories:

- ordinal zero requires `priorHeadValueDigest:null`;
- every positive ordinal is exactly prior ordinal plus one and carries the
  immediately prior head's recomputed `Dv`;
- `rootDigest` is constant and equals the recomputed immutable `Dgr` or `Dfr`;
- `recordedAt` is greater than or equal to root `createdAt` and never less than
  the prior head's time;
- a repeated request for the already-selected same state is `NO_APPEND`; and
- cleanup history contains one through six records, while fence history
  contains exactly one or two. Any extension beyond those graph bounds,
  self-loop, fork, gap, reorder, start/interior omission, wrong root, wrong
  prior `Dv`, or unsafe ordinal refuses. A valid shorter prefix is a valid
  earlier history state; this structural validator cannot claim that it is the
  current complete suffix. Tail completeness/currentness is deferred to the
  authenticated common-CAS selected-evidence locator decision.

For a transaction's ordinal-zero head, the generic proposal prior triple is
null only if the canonical tip has never been selected. If an earlier
transaction left a selected FULL_REQUIRED tombstone, the new proposal carries
that exact tombstone `Dt/Dv/Dr`; the new head's `priorHeadValueDigest` is still
null because its bounded history begins at ordinal zero. The root's selected
cleanup-archive predecessor is the cross-transaction lineage source. For every
positive head ordinal, the proposal prior triple selects the immediately prior
head and the head's `priorHeadValueDigest` equals that proposal's prior `Dv`.

VALUE position evidence is closed and exact:

```json
{ "mode": "VALUE", "parts": { "ordinal": "<safe-decimal>", "rootDigest": "<Dgr-or-Dfr>" } }
```

It hashes under the already-registered `cleanup-gate-position/v1` or
`recovery-fence-position/v1` domain. The common mutation ID separately binds
the successor `Dv` and prior selected triple, so position does not duplicate a
caller-supplied head digest. Tombstone position is deferred to the cleanup-
archive ledger and cannot be inferred here.

The strings
`installation/activation-cleanup-gate-roots/<transaction>.json`,
`installation/activation-recovery-fence-roots/<transaction>.json`,
`installation/activation-cleanup-gate.json`, and
`installation/activation-recovery-fence.json` remain registered future runtime
paths, not a lookup protocol authorized by this slice. Common immutable values
and proposals remain mutation-ID-addressed, but the independently reviewed
common-CAS selected-object locator makes value/proposal/tip history
constructible from authenticated `Dp/Dv/Dr/Dt` without mutation IDs. It does
not locate family roots. Cleanup/fence composition must construct the exact
transaction root path from the independently trusted pointer identity and
equal-bind its recomputed root digest to the parsed selected head. Directory
enumeration, caller-selected paths, unauthenticated indexes/journals, duplicate
family-head files, alternate tips, symlinks, and latest-file conventions remain
non-authority. No filesystem read or mutation is authorized until the
corresponding family composition passes review.

The pure bounded-history validator receives the parsed root and a dense array
of parsed head records as explicit inputs. It recomputes the root digest and
each common head `Dv`, then checks only the closed lifecycle edge, ordinal,
prior-head-`Dv`, root, time, and length rules above. Supplied bytes are evidence
to validate, not proof that they came from canonical persistence. The
structural validator performs no authorization, active-release, archive,
fence, admission, terminal, absence, custody, or broker composition.

The later composition ledger must provide a closed non-persisted input census
and an exhaustive required/forbidden proof matrix for every admitted gate cell
and edge and both fence cells. It must bind the selected actual graphs rather
than caller expectations. Its time rules are inclusive: a selected PREPARED
fence used by `PUBLISHED` has `recordedAt <=` the gate head `recordedAt`, and
every other ordered proof edge must state its own inclusive comparison
explicitly. It must also name the exact BOOTSTRAP pre-mutation abort active-
release/absence evidence and the distinct terminal proof set for bootstrap
post-E0 completion, successor activation, and each abort publication branch.
The later cleanup archive remains downstream of final gate/fence selection, so
a head never contains or hashes its downstream archive.

Until the common-CAS locator implementation, cleanup-archive ledger, remaining recovery-
authorization state/receipt/archive ledger, and composed proof matrix each pass
independent removal review, this slice authorizes only the four structural
parsers, two root digests, exact
VALUE position parsing/digests, common `Dv` computation for supplied heads, and
bounded relative history walking over supplied records. It authorizes no
composed root/gate/fence validator, persistence lookup, tombstone, archive,
filesystem mutation, broker call, live capability, release selection,
promotion, or runtime state transition.

Compatibility evidence for this structural slice must cover every literal
member/census/enum/nullability and structural mode row; exact root-domain and
common-`Dv` byte goldens; all ten/twelve gate cells/edges and the one fence
edge; zero/max/overflow ordinals; one/six and one/two history bounds;
root/time/prior-`Dv` substitutions; position-member add/remove/reorder attacks;
and hostile reflective inputs without throwing. Equal head/root timestamps are
positive cases. Deleting any structural comparison or graph edge, restoring
untagged `canonicalDigest`, restoring the v2 proof bundle/numeric generations,
or adding a persistence/lookup claim must make a committed mutant pass and
therefore fail the suite. Upstream graph substitutions, branch-only proof
absence, first-ever archive lineage, and composed time edges belong to the
later exact composition matrices and are not acceptance evidence for this
slice.

- Bootstrap N0 is built by pinned GitHub Actions workflow bytes from an exact
  source revision, certified on all required OS runners, independently reviewed
  by an identity distinct from the author/build attempts, and installed by a
  minimal bootstrap installer reviewed as part of the same immutable source.
- Bootstrap build, aggregation, independent-review, and operator grant authority are authenticated
  by the exact GitHub OIDC/artifact-attestation and protected-environment
  contract admitted by `ISS-029`; unsigned JSON and environment labels are not
  authority. Pinned `.github/workflows/bootstrap-review.yml` runs after
  certification with a distinct role/credential and emits an OIDC-attested
  exact-candidate review receipt; it has no build, install, or grant capability.
  The production grant comes only from pinned
  `.github/workflows/bootstrap-authorize.yml` after approval in protected
  environment `bootstrap-n0`, binding repository/workflow/run/environment,
  numeric actor identities, target host/user/state-root identities, exact
  candidate/certification/review/installer digests, a maximum-15-minute expiry,
  UUIDv7 nonce, and one-use transaction. The workflow emits a grant artifact
  only; installation occurs later on that bound target host.
- The reviewed installer verifies the pinned attestation bundle/claims before
  consuming the grant nonce with create-once state. Replay, expiry, moved
  workflow/run/subject, wrong actor/environment, or verifier substitution
  refuses before mutation. It emits a bootstrap receipt binding source,
  artifact, test bundle, OS receipts, reviewer, installed bytes, capabilities,
  attested grant, and nonce-consumption receipt.
- Before any bootstrap or later promotion mutation, the reviewed installer
  creates a 256-bit one-use recovery capability in the probe-admitted broker-
  custody native credential backend. Durable transaction state contains only its
  credential reference, generation, and digest, bound to target-host
  fingerprint, installer/candidate/transaction IDs, and destination state root.
  The raw capability is never in argv, environment, source, journal, or artifact.
  Before N0's first destination mutation or N1+'s recovery fence is published,
  the
  installer performs the ordered native consume, selected non-expiring
  `CONSUMED` authorization, and post-selection receipt protocol. `recover`
  resolves and proves that already-consumed selection after restart—never
  consuming it again—before resuming only that transaction. The broker performs
  native removal, selected `REVOKED`, and its post-selection receipt after
  terminal verification. Missing, locked, copied, replayed, wrong-host,
  wrong-user, or substituted capability leaves recovery required and refuses
  all new install/promotion mutation. From N0 onward, stable predecessor N owns
  the otherwise identical promotion protocol.
- Bootstrap cancellation is only canonical `orchestration-bootstrap abort
--input <bootstrap-install-input/v1>` before first destination mutation. It
  derives and reads back the deterministic transaction state rather than
  accepting a hand-authored abort envelope, then either refuses when no
  authorization exists, revokes pre-gate unconsumed authority, or persists/
  resumes gate `ABORTING`; no prose-only cancellation, post-mutation abort, or
  alternate cleanup command exists.
- The installation-scoped supervisor shim and native scheduler definition do
  not change during N0→N1. Stable N stages/verifies N+1 and pending broker-client
  admission, then requests selection of canonical `active-release/v1` through
  the epoch-fenced pointer protocol; this is the sole activation point. N1+
  staging bytes and pending admission are explicitly
  non-authoritative and may be removed by `ABORTED_PRE_ACTIVATION` until the
  cleanup gate CASes from `PENDING` to `ACTIVATING`. Abort races that decision
  only through `PENDING` → `ABORTING`; once `ACTIVATING` wins, recovery is
  forward-only even before the active pointer CAS. The active pointer remains
  the sole active-release identity. This does not weaken bootstrap N0's forward-
  only rule after its first destination mutation.
  After it, the shim recovery fence refuses ordinary ticks while the same N
  transaction forward-activates the broker's N+1 client generation and revokes
  N ordinary authority. N records a successor-verification follow-up, completes
  its own routine steps 14–15, clears the fence only as part of terminalization,
  and exits. The next scheduler tick runs that verification cycle under N+1;
  the following scheduler tick supplies independent steady-state evidence.

## First worker host

The first real self-hosting path uses the locally installed OpenAI Codex CLI
through a versioned worker-host adapter. Dispatch binds the requested selector,
provider-reported model identity when available, CLI version, worker role,
credential capability, and launch identity. Implementation and review use
distinct attempts and isolated credentials.

The first probe requests the documented selector `gpt-5.6-luna`. A selector or
alias is routing input, not immutable model identity. Exact model authority
requires a provider-authenticated resolved snapshot/version observed during
startup; if the CLI/provider exposes none, model identity is advisory and the
probe must narrow the host authority claim before implementation. Selector
equality alone never grants authority.

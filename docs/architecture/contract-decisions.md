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
  the digest. Before journaling step 4, when a worker-required action carries
  a non-null brief, the brief action's kind, capability, immutable subject,
  descriptor digest, and action-core digest must equal that projection.
  A workerless action carries no brief; its core and other plan bindings
  remain required. A moved plan, descriptor, subject, action, capability, member,
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
- For worker-required actions, at step 5 ISS-012 alone emits a selected
  `route-selection/v1` with one
  `workerHostIdentityDigest` selected from the complete installed active-release
  mapping after applying the same total admission relation. The selected row's
  `capabilityNames` must contain the action core's exact case-sensitive
  `capabilityName`; zero, duplicate, unknown, stale, moved, or capability-
  incompatible rows refuse routing. Provider/model evidence may refine a route
  but cannot manufacture or substitute the opaque host identity.
  Workerless actions use the explicit `NO_WORKER` route arm below; they
  retain step 5 and preflight at step 6 without inventing a host.
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
step-3 breaker policy or step-4 module authorization. The bounded mixed-row
registration amendment below addresses snapshot publication only; other
existing outcomes remain open.

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

ISS-013's bounded representation amendment retains registration v1. An
implemented family contains at least one executable command and exactly one
handler. The reviewed public command census fixes each expected row before
candidate metadata is inspected: snapshot has null `placeholderOwner` and
exact `resultSchema:"project-facts/v1"`; plan/apply retain owner ISS-013 and
their exact schema-free shapes. Executable rows require the family handler;
placeholder rows receive no handler and derive their refusal owner from that
same admitted registration. Missing/null/future/mismatched schemas, missing
handlers, downgraded family state, and extra row handlers refuse the registry;
none becomes a placeholder. Config and all other rows remain unchanged.
No row-state field, new version, second registry, or plan/apply schema exists.
The amendment updates ISS-003, ISS-013, ISS-000 and every existing census in
one ordinary independently reviewed change; its author cannot certify it.

The concrete adapter-file port uses the supplied host path, relative to the
invocation cwd when relative, for an ordinary read-only regular-file read. It
reads at most 65537 bytes to enforce the 65536-byte cap before canonical parsing
and closes its handle on every path. File failures use the existing filesystem
row. No root containment, symlink/reparse authority, executable input, or fixture
path is added. Only the fixed fixture IDs and their current immutable source
inputs are composed; each initial SDK page obtains a fresh detached snapshot.

Two statically composed fixture adapters must exercise this same SDK callback,
aggregation, parser, and CLI path: one may represent source-control work
internally; the other has no branch/worktree concepts. Their closed page
transcripts are fixture input, not live provider evidence. Neither input JSON,
adapter-returned digests, nor pure parser success grants session, module,
review, mutation, or promotion authority. Future provider observations still
require their owner's actual fresh-authority evidence. Policy/breaker facts
and module admission remain undefined here; no opaque digest substitutes for
those missing literal contracts or claims completion of routine steps 3–4.

### Project current-policy/trip literal ledger proposal (ISS-013)

This bounded proposal supplies project-side inputs for ISS-025 and routine
step 3. It does not implement that step or confer authority by authoring a
ledger. It adds exactly one public family, `project-breaker-facts/v1`, and
closed inline SDK records. The snapshot subsection's exclusion of breaker
facts still applies to snapshot itself; this subsection defines only current
policy evaluation and trip observations over its complete neutral frontier.
No project threshold or recovery criterion enters an engine schema.

Generic breaker history, open receipts, recovery transactions, probes, and
recovery receipts remain **UNDEFINED** literal contracts owned by ISS-025.
Recovery observations are excluded until ISS-025 defines their complete
receipt bytes, validation, policy binding, replay, and transition conditions;
ISS-013 must then define the project recovery-fact binding against them. An
opaque receipt digest cannot replace those definitions or count as verified
receipt authority. No arm below requests recovery, clears a hold, or establishes
`CLOSED`/`CLOSED_RECOVERED`. ISS-013 AC7 remains incomplete.

#### One closed fact union

Reuse `UUID`, `Digest`, `Time`, `Name`, `Version`, name arrays, `C`, `Dconfig`,
`Dfrontier`, and `Dsnapshot` from the snapshot ledger without widening their
bounds. All records/arrays obey the detached closed rules above. Every listed
member is required, and no member below is nullable. Unknown members, enums,
schemas, nulls, hostile descriptors, and out-of-range values refuse.

Every `project-breaker-facts/v1` arm has exactly
`adapterConfigurationDigest, observationId, observedAt, policyVersion,
projectFactsDigest, projectId, schemaVersion, state`, plus the arm's members:

| State | Additional members and constraints |
| --- | --- |
| `COMPLETE` | `decisions`; dense 0–256 decision rows, strictly ASCII sorted by capability name |
| `UNAVAILABLE` | `reason`; exactly `SOURCE_UNAVAILABLE` or `OBSERVATION_TIMEOUT` |
| `UNKNOWN` | `reason`; exactly `SOURCE_UNKNOWN`, `MALFORMED_OBSERVATION`, `CHANGED_BINDING`, `CHANGED_SOURCE`, or `INCOMPLETE_CAPABILITIES` |

The schema literal is exactly `project-breaker-facts/v1`; configuration and
project-facts digests are `Digest`; both identities are `UUID`; `observedAt`
is `Time`; and `policyVersion` is `Version`. The SDK supplies a fresh
observation ID and start time for this invocation, distinct from the snapshot
observation ID. `projectFactsDigest` is recomputed `Dsnapshot` over the exact
admitted COMPLETE `project-facts/v1`, including its observation metadata;
`adapterConfigurationDigest` is recomputed `Dconfig`; `projectId` equals both
configuration and snapshot. None is a caller-selected expected hash.

Each decision row has exactly `capabilityName, trip`. `capabilityName` is
`Name`; `trip` is exactly `TRIP|NO_TRIP`. The SDK requires exactly one row for
every configured capability, including capabilities with no frontier rows;
no omission, duplicate, extra capability, or subset succeeds. With an empty
configured census only an empty decision array succeeds. `NO_TRIP` means
only that the current adapter policy did not request a trip. It grants no
capability, overrides no existing hold, and is not recovery evidence. `TRIP`
identifies an affected opaque capability for the later generic reducer, not
a durable open receipt. Failure arms contain no decisions, even empty/null
substitutes; the consumer must treat the entire configured census as
unresolved, never as permission. No reducer or persistence behavior is added.

`DbreakerFacts = SHA256(C(projectBreakerFacts))` hashes every member of every
arm; no self-digest is embedded. A public parser/serializer checks exact shape,
scalar bounds, decision ordering/uniqueness, and produces these canonical
bytes. Cross-record equality and exact capability coverage require the SDK's
configuration and snapshot inputs. Neither parsing nor matching content hashes
proves freshness, policy execution, history validity, or production authority.

The policy identity is the exact tuple `(adapterId, adapterVersion,
policyVersion)`: the first two come from the admitted configuration and the
last from statically composed reviewed source. Each tuple names exactly one
policy implementation; changing its semantics requires a new policy version
and reviewed source change. The tuple is not a policy payload, algorithm
selector supplied by input JSON, or substitute for a policy definition.
There is no policy digest: the two fixture algorithms below are the complete
definitions for the only proposed implementations. Other policies require
their own reviewed adapter source, not engine-schema edits.

#### SDK admission, fresh source binding, and bounded callback

The in-process reader takes configuration, successful loaded configuration
provenance, a COMPLETE project snapshot, and injected clocks. Static composition
binds one callback, adapter ID/version, current policy version, and finite
engine/schema/capability support constants; none comes from runtime payloads.
Reapply the snapshot SDK's exact configuration/provenance and compatibility
checks before invoking the callback, additionally requiring explicit support
for `project-breaker-facts/v1` and the composed current policy version. A valid
snapshot must bind this project/configuration, have its frontier digest
recomputed, and use only configured capabilities. Failure/partial snapshots
cannot enter the callback. No generic descriptor or registry is introduced.

The SDK returns exactly `{ok:true,facts}` for any public fact arm, or exactly
`{code,ok:false}` for local admission/SDK failure. Codes are checked in this
order: `ADAPTER_CONFIGURATION_REFUSED`, `ADAPTER_BINDING_REFUSED`,
`ADAPTER_COMPATIBILITY_REFUSED`, `PROJECT_SNAPSHOT_REFUSED`; the last includes
malformed/non-COMPLETE snapshots and snapshot/configuration relational
mismatches. Clock/identity-generation defects use `INTERNAL_ERROR`, never a
fact arm. Admission failure causes zero adapter calls. These inline outcomes
introduce no CLI command, command diagnostic, envelope mapping, or registry
amendment; the landed snapshot/plan/apply rows remain unchanged.

The sole callback is `readCurrentPolicy(request)`, returning a native Promise
of one response. The closed request is exactly `capabilityNames, observationId,
policyVersion, projectFacts`. `capabilityNames` is a detached copy of the exact
admitted configuration census, using the existing dense, strictly ASCII-sorted
0–256 name-array shape; it is not inferred from frontier rows or a digest.
The other members are the SDK's fresh ID, composed version, and detached
admitted COMPLETE snapshot. The callback evaluates every requested capability.
Callback response common members are exactly
`observationId, policyVersion, projectFactsDigest, state`, plus:

| State | Additional members and constraints |
| --- | --- |
| `COMPLETE` | `decisions, frontier`; decisions use the public row shape; frontier uses the COMPLETE snapshot's 0–4096 strictly work-ID-sorted frontier row shape |
| `UNAVAILABLE` | `reason`; exactly `SOURCE_UNAVAILABLE` |
| `UNKNOWN` | `reason`; exactly `SOURCE_UNKNOWN` |

Common scalars use the public grammars. Every response, including failure,
must echo the request ID/version and the recomputed digest of its full
`projectFacts`. A COMPLETE callback freshly reads its own current immutable
fixture input once, maps its complete neutral frontier, and evaluates the
current policy on that same detached frontier. No cached prior invocation,
partial input, or separate source read for the decisions is allowed. The SDK
checks the returned frontier against the admitted snapshot's canonical
frontier bytes and recomputed digest before accepting decisions; a changed
work identity, subject, readiness, capability, or census is `CHANGED_SOURCE`.
The callback frontier is invocation-local evidence, not a second public schema
or persisted source record. Returning its literal rows lets the SDK recompute
the source binding; a substituted opaque source digest is insufficient.

Freshness here is that new bounded source read and policy evaluation for this
request, not a timestamp age heuristic. An older snapshot with still-identical
frontier may bind a fresh evaluation; moving even only its metadata changes
`Dsnapshot` and therefore the required echo/result binding. `observedAt` records
invocation start, not lease expiry or hold-clearance time. Reusing the result in
a later cycle is not fresh evaluation. The future routine consumer must obtain
a new invocation and validate its own current history/policy relation; this
proposal cannot prove those undefined contracts. A callback echo is checked
binding evidence under the reviewed fixture source, not provider attestation.

Allow exactly one callback, no pagination/retry, and 5000 integer milliseconds
from invocation start through source validation, measured by an injected
monotonic clock. Monotonic readings must be nonnegative safe integers and
nondecreasing; wall time must satisfy `Time` and UUIDv7 construction bounds.
Observe elapsed time before callback entry and before accepting its result;
elapsed time **at least** 5000 wins as `UNAVAILABLE/OBSERVATION_TIMEOUT`.
Never invoke a callback after the deadline. Synchronous throw or Promise
rejection before it yields `UNAVAILABLE/SOURCE_UNAVAILABLE`; a non-native
Promise/thenable is `UNKNOWN/MALFORMED_OBSERVATION` without invoking its `then`.
At most one terminal result is returned, with no late replacement or retry.
Pending native rejections must be observed after timeout to avoid an unhandled
rejection. This deadline bounds result admission, not preemption of arbitrary
synchronous code; only the bounded reviewed fixture callback is in scope.

After the deadline check, closed shape/scalar validation precedes relations.
For well-shaped replies the fixed order is `CHANGED_BINDING` (any echo differs),
`CHANGED_SOURCE` (COMPLETE frontier differs), then `INCOMPLETE_CAPABILITIES`
(COMPLETE decision census differs). Duplicate/unsorted/oversized rows or a
wrong trip enum fail shape as `MALFORMED_OBSERVATION`; a sorted omitted or
extra valid capability fails census. Only after these checks does the SDK
accept a callback failure reason or COMPLETE. All public bindings on failure
are SDK-owned expected values, never the substituted response values. No
success, source failure, or timeout authorizes use of an already held capability.

#### Two executable-test-shaped policy fixtures

Extend the already composed `fixture.branches` and `fixture.queue` adapters at
adapter version `1.0.0`, with initial policy version `1.0.0` in each. They share
the same SDK and neutral records. Their existing private source models remain
private; `fixture.queue` has no Git, branch, or worktree concept. For each
configured capability, the branch fixture trips when **at least one** current
frontier row bearing it is `NOT_READY`; the queue fixture trips when **at least
two** such rows are `NOT_READY`. Otherwise each returns `NO_TRIP`. The count is
of distinct work rows in the validated frontier, not capability occurrences;
READY rows and rows without the capability do not count. These thresholds are
fixture adapter policy only, not engine limits or recommended consumer policy.
Zero matching rows yields `NO_TRIP` without claiming work/capability permission.

Use matching neutral frontiers (same work IDs, subjects, capability arrays, and
readiness) translated into the two private source models. For capability
`work.read`, 0/1/2 NOT_READY rows must yield respectively
`NO_TRIP/NO_TRIP`, `TRIP/NO_TRIP`, and `TRIP/TRIP` (branch/queue), with identical
frontier canonical bytes and schema/member census across adapters. Complete
fact digests differ as expected because each configuration binds its adapter.
Include all-ready, empty, missing capability, changed private source between
snapshot and callback, and independent source UNKNOWN/UNAVAILABLE cases.
Each fixture must prove a fresh source read on every callback and none after
admission refusal; a source read counter is evidence, not a public field.
For each fixture with a freshly observed empty frontier, admitted configuration
`capabilityNames:[]` must supply request `capabilityNames:[]` and accept exactly
`decisions:[]`; admitted configuration `capabilityNames:["work.read"]` must
supply that same request census and accept exactly
`decisions:[{capabilityName:"work.read",trip:"NO_TRIP"}]`. Swapping those decision
censuses yields `UNKNOWN/INCOMPLETE_CAPABILITIES` in both directions. Neither
case changes the empty frontier bytes or grants capability/hold clearance.

Golden canonical bytes/digests must cover every fact arm. Mutation vectors
must cover hostile nested input; every required field and scalar bound;
config/project/adapter/version/capability/snapshot substitution; every callback
arm with moved echoes; sorted missing/extra versus duplicate/unsorted decisions;
changed current frontier; and a valid wrong echo combined with changed source
and missing decisions (exactly `UNKNOWN/CHANGED_BINDING`). Clock vectors cover
4999/5000 milliseconds, regression, invalid wall time, rejection, thenables,
and late settlement. Identical fixture transcripts must yield identical bytes
on Windows, macOS, and Linux. These are future compatibility/SDK acceptance
evidence, not tests claimed executed by this documentation packet.

This contract deliberately supplies no recovery fixture arm: testing actual
trip/recovery lifecycle contrast and replay belongs to the later ISS-013 /
ISS-025 composition after the undefined generic contracts are resolved.

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

### Bounded native-lock experiment (ISS-022, selected 2026-08-31)

Todd approved the source-built in-process binding experiment on 2026-08-31.
This subsection closes that experiment's interface and evidence, subject to
independent literal-ledger review before implementation. It grants no production
selection. It does not amend the original Node-only candidates, 21 vectors,
63-observation PASS join, or capability/review/publication records above.
Run `33350413483` and core
`2e08babc6c141ef071eb26e1de399a603ec35f433473d3b60bcf7aa78da62a92`
remain evidence of the prior `BLOCK_REPLAN`; PR #158 and the frozen e827 writer
and its physical path remain separate and unchanged.

#### Interface, ownership, and OS operations

The experiment interface identifier is `iss022-native-lock-experiment/v1`,
not a selectable helper, ABI, custody, or capability token. Use Node 24 and
the C Node-API at `NAPI_VERSION=8`; no C++ wrapper dependency, FFI package,
background thread, helper process, or native installation. Node-API's ABI
stability does not establish this experiment's behavioral compatibility;
record the actual Node executable/version/modules/napi/architecture and build
inputs on each OS. [Node-API documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/n-api.html)

The candidate module exports exactly `interfaceVersion`, `openFixedLock(path)`,
`tryLock(handle)`, `release(handle)`, `close(handle)`, and `describe(handle)`.
The stable fixture supplies the one exact absolute path; the module admits one
open handle per Node environment and does not accept another path during that
environment's lifetime. The handle is a branded, environment-bound native
object, never a caller-supplied descriptor. No create, write, rename, unlink,
duplication, transfer, range, blocking, retry, or process operation is exported.
Invalid arity/type, NUL, relative path, foreign/copied/stale handle, double
open, reentrant call, or invalid state throws `TypeError` before an OS call.

`openFixedLock` returns `{handle, facts}` (handle null on failure); other
operations return `facts`. Facts are an ordered array of native-call records,
each having exactly `operation`, `returnValue`, `errorCode`, `identity`,
`nativeHandle`, and `nonInheritable`. `operation` is
`OPEN|IDENTIFY|FLAGS|TRY_LOCK|UNLOCK|CLOSE|DESCRIBE`, naming the failed internal
operation when opening/describing cannot finish. Return/error values are exact
decimal strings captured at the OS call (error `0` on success); no errno text,
exception message, or candidate-derived verdict is authority. `identity` is
the tuple below or null if unavailable. `nativeHandle` is its unsigned decimal
descriptor/HANDLE value only while open, otherwise null; it is diagnostic data,
never an input accepted by this candidate interface. `nonInheritable` is the
read-back Boolean or null when unavailable. No partial open publishes a handle:
close a newly opened resource on an identity/flags error, append that close's
record even if it too fails, and refuse the case. Successful try/release/close
returns one call record; open/describe record each fixed identity/flags call
in source order. No unlisted OS operation or output record is admitted.

The state machine is `UNOPENED -> OPEN -> LOCKED -> OPEN -> CLOSED`.
Only `OPEN` admits one `tryLock` per parent command; contention leaves `OPEN`.
`release` admits only `LOCKED`, performs the exact unlock once, and leaves
`OPEN` only on success. `close` admits only `OPEN`, invalidates the brand before
closing once, and never retries a failed/ambiguous close. A failed operation
ends the case; exception/GC/finalizer cleanup cannot count as observed release.
The stable fixture roots the object until explicit close or process death.
Environment cleanup may best-effort close it, but the death case uses forced
termination and must execute neither `release` nor a cleanup acknowledgement.

| Boundary | macOS and Linux | Windows |
| --- | --- | --- |
| Open existing file | `open(path, O_RDWR | O_CLOEXEC | O_NOFOLLOW)`; no create/truncate flag; `fstat` must be regular with link count 1 | `CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL)`; no delete sharing, overlapped I/O, delete-on-close, or inherited security attributes |
| Identity | `fstat` tuple `{kind:"POSIX",device,inode}` using full unsigned decimal `st_dev/st_ino`, plus regular-file/link-count/size checks | `GetFileInformationByHandleEx(FileIdInfo)` tuple `{kind:"WINDOWS",volumeSerialNumber,fileIdHex}`; volume is unsigned decimal, file ID is the 16 bytes in returned order as 32 lowercase hex digits; `FileStandardInfo` must report a non-directory, not delete-pending, link count 1, size 1; `FileAttributeTagInfo` must have no reparse flag |
| Non-inheritance | `fcntl(fd, F_GETFD)` must contain `FD_CLOEXEC`; no `dup`/`fork` operation in the binding | `SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0)` then `GetHandleInformation` must read that bit clear |
| Try exactly once | `flock(fd, LOCK_EX | LOCK_NB)` on the whole fixed file; do not substitute `fcntl` locks | `LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &ov)`; zero-initialize every `OVERLAPPED` field, including offset/high offset and event; range is exactly byte `[0,1)` |
| Normal release | `flock(fd, LOCK_UN)`, then separate `close(fd)` | `UnlockFileEx(h, 0, 1, 0, &ov)` with the same zero offset/range, then separate `CloseHandle(h)` |

These are cooperating-process locks on the named resource, not hostile-writer
isolation. Apple describes advisory exclusion and shared references after
duplication/fork; Linux documents the distinction from `fcntl` locks.
[Apple flock](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html),
[Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html),
[Linux locking notes](https://docs.kernel.org/filesystems/locks.html).
Windows uses the full file ID and volume pair to compare independently opened
handles. Lock release after termination can lag observed process termination:
one post-death attempt may fail. That is a finding, never permission to delay,
retry, delete, or infer stale ownership.
[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info),
[LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex),
[UnlockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-unlockfileex).

#### Stable custody, witnesses, and the finite case census

Stable N creates one exclusive child of provider `runner.temp`, outside every
checkout/build source root, and one fixed `native-lock` leaf containing byte
`41`. All four cases on that OS reuse this exact file, without replacement,
truncation, rename, or deletion. The parent retains its witness's non-inherited
independently opened handle through all four rows, compares native identity
through that witness, and rechecks the root/ancestor chain, leaf identity,
type, link count and size before
each barrier and after terminal events. For the death row only, the post-close
custody read occurs immediately **after** the single acquisition, so metadata
work cannot insert a release-timing workaround. Moving/unreadable custody refuses.
Do not read byte zero through another Windows handle while it is locked;
initial and final unlocked byte readback must both be `41`.

The stable native witness is a separately authored, independently reviewed
small C Node-API source with the same OS operations and identity inspection.
It is built from stable N, never candidate source, and loaded in the stable
parent. Candidate bytes are loaded only in candidate children. The stable
witness also has one diagnostic `inspectNativeHandle(decimal)` operation for
the stable holder/child fixtures: read identity and inheritance flags or the
native invalid-handle error, without opening, closing, locking, or duplicating
that handle. This is a test-only inspector, not a production interface. Its
source and tests cannot share candidate implementation authorship.
For stable custody readback only, witness `describeCustody()` takes no argument
and inspects the already-bound fixed file's parent directory: POSIX opens it
with `O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW`, then `fstat`; Windows
uses `CreateFileW` with `FILE_READ_ATTRIBUTES`, read/write sharing, null security
attributes, `OPEN_EXISTING`, and
`FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT`, then `FileIdInfo`
and `FileAttributeTagInfo`. Require an ordinary non-reparse directory, capture
the full identity tuple, and close that temporary metadata handle once. Only
this fixed parent is accepted; ancestor checks reuse the existing stable
root/chain checks. This adds no arbitrary-path filesystem operation.

`describeCustody()` returns exactly `{identity, facts}`. Its `facts` array uses
the unchanged six-member native-call records and retains every actual call in
order, including close. `identity` is the full directory identity tuple only
after every required native call, ordinary-directory/non-reparse policy check,
and close succeeds; otherwise it is null. Every successful temporary open is
paired with one close on every return path, including a metadata policy
refusal; no resource handle escapes this operation. A successful metadata call
that reveals a policy mismatch keeps its actual successful return/error values
in `facts`; do not synthesize errno, append a fake native call, or encode policy
failure in exception properties. Null identity cannot be recovered from a
successful identity-bearing call in `facts`: the stable parent records null in
the existing `CUSTODY.rootIdentity` slot, refuses the barrier, and yields
`UNKNOWN`. A failed close is retained and likewise forbids success, without
retry. This wrapper is specific to the stable witness's custody operation;
candidate `openFixedLock` and `describe` result shapes remain unchanged.

Stable-authored JS fixtures control the holder and contender lifecycle; the
candidate contributes only the addon. All paths, launch options, expected
results and barriers come from the stable parent. Spawn Node directly, with
`shell:false`, `detached:false`, `windowsHide:true` and
`stdio:["ignore","pipe","pipe","ipc"]`; clear `NODE_OPTIONS`, `NODE_PATH`,
loader/preload variables and inherited candidate environment. No holder
descriptor is included in stdio or a Windows handle list. Candidate stdout,
facts and addon state remain claims challenged by stable native calls.

Execute these rows in this order, once per OS. Fresh holder/contender processes
use independent opens, never an inherited lock description. Parent-owned
monotonic sequence numbers order all commands, calls and terminal events.
`READY` means module/handle/identity/flags checked and process paused; `HELD`
requires candidate acquisition plus a stable witness's independently opened
same-file `CONTENDED` result. Any missing prerequisite stops subsequent rows;
it is recorded as missing evidence, never an invented observation.

| Case ID | Stable-controlled chronology | Required observation |
| --- | --- | --- |
| `NATIVE_UNRELATED_EXCLUSION` | Two sibling children reach `READY`; command holder once; witness establishes `HELD`; command contender once while holder stays paused; inspect both identities; release/close holder normally | Holder acquisition, stable contention, and contender contention on the identical file; no second holder, no open/share error disguised as lock contention |
| `NATIVE_NORMAL_RELEASE` | Fresh holder reaches `HELD`; parent commands `release`, observes its return, then commands witness once **before holder exits**; unlock witness but retain its handle, close holder and observe clean holder terminal events | Stable witness acquires after explicit unlock while the former holder is still alive; a release claim while retaining the lock fails |
| `NATIVE_DEFAULT_NON_INHERITANCE` | Fresh holder reaches `HELD`; stable inspector in that holder reads its exported native handle/flags; the stable holder fixture spawns one default child using the options above; child loads only stable inspector/fixture bytes and inspects that numeric handle **before opening this file**; parent challenges exclusion again while both live; then stable fixture observes child clean exit and releases holder normally | Holder flags are non-inheritable; child's handle is invalid (`EBADF`/`ERROR_INVALID_HANDLE`) or belongs to a different file; same-file access or unreadable inspection refuses; witness still contends, proving no premature unlock |
| `NATIVE_HOLDER_DEATH_ONCE` | Fresh holder reaches `HELD`; parent witness already has its independently opened, identity-checked, unlocked handle; parent calls the exact holder `ChildProcess.kill("SIGKILL")`, waits for that handle's `exit` **and** `close`, then immediately performs one synchronous witness `tryLock`; record identity/result, unlock/close witness if acquired | Exactly one post-death OS acquisition attempt on the same file, with no candidate unlock/close beforehand; witness acquisition is the observed property; contention after death is a violation, including on Windows |

The last row is last so no subsequent acquisition can obscure its one-attempt
census. After `close`, the next operation is that one lock attempt: no sleep,
timer gate, polling, fresh process startup, retry, or pre-attempt cleanup. The
pre-opened witness is a separate open description, never a duplicate of the
holder resource. A failed termination request, inconsistent terminal sequence,
unexpected natural exit, missing close event, or watchdog expiry is `UNKNOWN`,
not evidence of death. A 10,000 ms parent watchdog bounds each row; it grants
no ownership authority and does not postpone the post-death attempt.

The default-child row observes only inheritance under this reviewed fixture.
The stable holder fixture owns that child's handle and forwards its stable
inspection/terminal transcript; candidate PID/IPC text cannot substitute for
it. No independent process-tree identity, hostile-native isolation, surviving
descendant cleanup proof, or ISS-005 reclamation claim follows. Intentional
handle transfer is not tested or added to the threat model. After final
observations are frozen and all known fixture handles are closed, normal
runner-temp cleanup may occur; cleanup failure stays visible and cannot repair
a failed measurement or trigger another acquisition.

#### Build identity and hosted execution

Ordinary source review first lands the stable observer, witness, driver,
negative controls and their complete bundle/dispatch censuses. That protected
revision is N for the experiment; the independently reviewed candidate source
revision is N+1. N may build/test N+1 without installing or selecting it.
Until N contains the independently authored witness and tests, hosted execution
is not ready. Candidate native bytes never enter N's parent, reducer, record
job, or loader search path. This ordering adds no release bootstrap or grant.
The holder fixture may load N's inspector alongside the candidate addon solely
to inspect that holder's native handle; the default child loads only N's
inspector. This does not load candidate bytes into any stable-only process.

Use a single stable build script with two explicit inputs: stable witness C
source and candidate binding C source. Materialize the latter through the
existing authenticated candidate-file/consume-delete path; never run a
candidate build script, package lifecycle hook, compiler flag or dependency
resolver. Compile from source into separate fresh runner-temp build directories.
The Node headers (and Windows architecture-matching `node.lib`) must be from
the official distribution matching the **actual exact** Node version used for
the run, checked against its retained `SHASUMS256.txt` bytes. No prebuilt addon,
downloaded executable helper, package-native install, cache or committed binary.
Use the hosted image's unprivileged compiler/SDK; unavailable prerequisites
produce `UNSUPPORTED`, not installation or an OS-command lock fallback.

The stable script owns these argument arrays, expanding only verified absolute
input/include/output paths. No shell command construction or caller flags:

| OS | Compile/link recipe for each source |
| --- | --- |
| Linux | Resolved hosted `cc`: `-std=c11 -O2 -fPIC -shared -DNAPI_VERSION=8 -I <node-include> <source.c> -o <output.node>` |
| macOS | Resolved hosted `clang`: `-std=c11 -O2 -fPIC -bundle -undefined dynamic_lookup -DNAPI_VERSION=8 -I <node-include> <source.c> -o <output.node>` |
| Windows | Resolved hosted `cl.exe`: `/nologo /TC /std:c11 /O2 /MD /LD /DNAPI_VERSION=8 /I<node-include> <source.c> <node.lib> kernel32.lib /link /OUT:<output.node>`; all intermediate output paths stay in that build's temp directory |

Each build's working directory is its own temp directory; compiler environment
comes only from the captured hosted toolchain. Clear inherited `CC`, `CFLAGS`,
`CPPFLAGS`, `LDFLAGS`, `CL`, `_CL_` and loader injection variables. Stable code
sets required SDK/include/library paths explicitly. No mutable candidate PATH
entry participates in compiler, linker or module resolution.

Record exact source bytes/revisions, stable JS fixture/build/loader bytes,
Node header/archive/import-library bytes, command argv, compiler/SDK versions,
Node executable identity and output bytes. Keep a sorted complete input and
output file census; retain referenced source/header/output bytes alongside the
report, recomputing every length and SHA-256 from them. Compiler/SDK version
strings describe the provider image assumption, not a toolchain attestation or
reproducible-build claim. Only the two expected `.node` outputs can load;
intermediates are non-executable diagnostic build outputs, never candidates.
Rehash each module from an identity-checked regular file immediately before
absolute-path load and after the case census; refuse source/output changes,
extra loadable files, wrong architecture/Node ABI, dynamic external package
resolution, missing source, changed flags, or a moved parent. N's reviewed
loader resolves no candidate-relative dependencies. No system-library trust
framework or same-principal tamper isolation is claimed.

Reuse ISS-006's protected-main dispatch, stable/candidate separation,
provider-fresh VM, manifest and materialization checks and four-job topology.
Add only an explicit experiment action `iss022_native_lock_experiment`, a
literal diagnostic runner `ISS022_NATIVE_LOCK_EXPERIMENT`, and its fixed
`iss022-native-lock-experiment-{linux,macos,windows}` required-job census.
The ordinary `conformance_candidate` action, original registry and report
remain unchanged. No input-supplied matrix, candidate registry, optional OS,
single-OS inference or mixed attempt is admitted. The experiment arm never
calls a capability receipt/core/profile serializer or the frozen writer.

Each observation job uploads one immutable
`iss022-native-lock-<runId>-<runAttempt>-<os>` diagnostic archive, with its report
and retained build/transcript bytes (`os` is `linux|macos|windows`). A stable-only aggregate runs even when a
row fails, downloads exactly those three archives, and reduces them without
loading native or candidate code. The stable-only record job retains the
existing provider adapters' run/job/artifact/protection responses, including
digest/length, attempt, terminal conclusions and expiry. After the run is
terminal, N's diagnostic verifier reuses those adapters to check the exact
reviewed workflow/action/revisions, three observation jobs, artifact bytes,
at least 30 days remaining retention, and successful collector/record jobs.
There is no new provider receipt, signature, certification or authority join:
these retained inputs support independent review of an exploratory result only.
Missing provider evidence is `UNKNOWN`; success of diagnostic collection says
nothing about whether the lock property held. The implementation's single
scaffold amendment updates dispatch/registry/build/bundle/artifact censuses and
their existing refusal tests together, naming ISS-022.
The aggregate and record archives use that same prefix with suffix `aggregate`
and `record`: exactly five archives in the attempt, with no inner executable
loaded by either job. The terminal diagnostic reduction is written outside
the checkout after rereading the completed record job; it does not attempt
to attest its own output or amend an existing canonical decision.

#### Inline records, normalization, and refusal controls

Use complete inline experiment records, not new public schema families or
opaque details digests. JSON uses existing canonical encoding; all record
members below are exact, arrays have the specified order, integers are
canonical decimal strings, and byte hashes are lowercase SHA-256. Unsupported
or missing evidence has null **facts**, never a fabricated OS observation.
The diagnostic report has exactly:

| Member | Closed contents |
| --- | --- |
| `experiment` | Literal `iss022-native-lock-experiment/v1` |
| `coordinates` | `{repositoryId,runId,runAttempt,workflowRevision,candidateRevision,jobId,operatingSystem,architecture,nodeVersion,nodeModulesVersion,nodeNapiVersion}`; identities equal the stable plan/provider/actual process inputs, OS is `LINUX|MACOS|WINDOWS` |
| `builds` | Two records in `STABLE_WITNESS,CANDIDATE_BINDING` order, each `{role,revision,inputs,argv,toolchain,outputs,loaded,result}`; inputs/outputs/loaded are sorted `{path,byteLength,sha256}` arrays binding retained files; `loaded` is exactly that role's `.node` output; `toolchain` is `{compilerPath,compilerVersion,sdkVersion}` from stable capture; result is `BUILT|UNSUPPORTED|UNKNOWN`; unavailable inputs/argv/toolchain/outputs/loaded are null, never invented; role/revision remain bound |
| `custody` | `{rootPath,leafName,initialIdentity,finalIdentity,initialByteHex,finalByteHex}`; leaf is `native-lock`, successful identities match, bytes are `41`; initial/final null is permitted only with the corresponding missing-evidence result |
| `cases` | Four ordered `{caseId,events,result}` records, with exactly the case IDs above; an unexecuted row has `events:[]` and `result:"UNKNOWN"`, except a verified unsupported build/prerequisite propagates `UNSUPPORTED` without inventing an observation |
| `controls` | Ordered `{controlId,refused}` records for the finite census below; `refused` is Boolean, never a supplied PASS verdict |
| `result` | Stable recomputed `OBSERVED|VIOLATED|UNSUPPORTED|UNKNOWN`; even `OBSERVED` selects nothing |

Every retained-file path is artifact-relative, unique and free of empty/dot/
parent components; links and path escape refuse. The archive manifest covers
the report and every referenced file; hashes never substitute for retained
bytes. Native error numbers are interpreted using stable OS constants, never
a candidate-provided name-to-number table.

Every event has exactly `{sequence,actor,kind,data}`. Sequence starts at `0`
and increases by one across that report. Actor is
`PARENT|HOLDER|CONTENDER|DEFAULT_CHILD`; instances are scoped to the case and
the parent's exact captured process handles, never caller-selected PIDs.
`kind` closes `data` as follows: `COMMAND` has `{name}` from that row's
`READY|ACQUIRE|RELEASE|SPAWN_DEFAULT_CHILD|TERMINATE|CLOSE` sequence;
`CALL` has the six native facts fields above; `CUSTODY` has
`{rootIdentity,leafIdentity,regularFile,linkCount,size}` with full OS identity
tuples and literal expected `true,"1","1"`; `EXIT` and `CLOSE` have
`{exitCode,signal}` from the captured ChildProcess events (nullable canonical
integer/literal signal); `TERMINATION` has `{signal,accepted}` with literal
`SIGKILL` and the actual Boolean return from the parent's kill request;
`WATCHDOG` has `{limitMilliseconds,elapsedNanoseconds}` with literal `"10000"`
and the parent monotonic measurement, and always forces `UNKNOWN`;
`INSPECTION` has
`{nativeHandle,identity,nonInheritable,errorCode}` from stable inspector code.
Each barrier carries a fresh `CUSTODY` read. Root identity is the same OS tuple
shape as the leaf but must denote the original directory; chain verification
failure refuses before a barrier. Captured stdout/stderr are retained raw
files, not event sources unless the stable fixture parses the exact expected
native facts/inspection message at the pending command. Unexpected message,
ordering, duplicate, extra field, or trailing bytes refuses. No event can
authorize a command that the stable parent did not issue.
The death row requires one accepted `TERMINATION` after its command and before
the expected forced-exit/close events; an absent, rejected or natural-exit
sequence refuses. Signal/exit interpretation follows the stable Node 24
ChildProcess adapter on that OS, never a candidate PID or reported status.

Reduce raw calls as follows. A successful try is `ACQUIRED`; only
`EWOULDBLOCK` (including its `EAGAIN` alias) from POSIX `flock`, or Windows
`ERROR_LOCK_VIOLATION` (`33`) from `LockFileEx`, is `CONTENDED`. Neither an
open/share error nor `EEXIST` is contention. `ENOSYS|ENOTSUP|EOPNOTSUPP` and
Windows `ERROR_NOT_SUPPORTED` (`50`)/`ERROR_INVALID_FUNCTION` (`1`) mean
`UNSUPPORTED` for the attempted fixed operation. Access denial
`EACCES|EPERM`/`ERROR_ACCESS_DENIED` (`5`) means environment `UNSUPPORTED`,
never proof of exclusion. Every other failure, including `EINTR`, `EINVAL`,
`ERROR_IO_PENDING` (`997`), missing/malformed code, ABI/load failure, timing or
unreadable identity, is `UNKNOWN`; no EINTR retry. Invalid-handle codes are
accepted only for the child-inspection observation. Unexpected success,
identity/range/flag mismatch or a valid `CONTENDED` after release/death is
`VIOLATED`. Reducers check operation/context before assigning any meaning.

The whole report/reduction uses precedence
`UNKNOWN > VIOLATED > UNSUPPORTED > OBSERVED`, retaining every individual
failure even when a higher-precedence failure exists. `OBSERVED` requires all
four rows observed, every refusal control refused and intact identity/build
evidence in that OS report. The final inline reduction has exactly
`{experiment,reports,providerEvidence,result}`; reports are the complete three
records in `LINUX,MACOS,WINDOWS` order (a missing report is a null slot and
forces `UNKNOWN`, never a synthesized report), providerEvidence is a sorted array of
the same retained-file `{path,byteLength,sha256}` entries for the already
parsed provider/workflow/manifest inputs, and experiment has the same literal
identifier. The verifier rereads/revalidates those bytes rather than trusting
their hashes. Its `OBSERVED` additionally requires the complete same-attempt
three-OS/provider census and equal revisions. A well-formed
control that is not refused is `VIOLATED`; a missing/unreadable control is
`UNKNOWN`. No candidate-normalized result is accepted.

The bounded control census is exactly the following order on each OS. Stable
tests use one fixture or captured-record mutant per row, retaining its input
and stable rejection. Run these controls before the four observation rows,
releasing their known resources on the same fixed file before the next fixture.
The first three use stable-authored JS call-interception fixtures and real
witness calls; all others mutate captured inputs to the actual guard/parser.
They add no alternate native binary, intentional inheritance or additional
holder-death run. Do not repeat the death case to find a favorable result.

| Control ID | Cheapest discriminating evidence / required refusal |
| --- | --- |
| `BYPASS_LOCK` | Candidate fixture claims acquisition without calling the lock; real stable witness acquires, so `HELD` refuses |
| `PREMATURE_UNLOCK` | Candidate unlocks before the parent release/death command; witness challenge acquires and refuses |
| `RETAIN_AFTER_RELEASE` | Candidate claims release while retaining its lock; real witness contends and refuses |
| `INHERITABLE_FLAGS` | Mutate stable inspection's read-back non-inheritance flag to false; guard refuses before child launch; do not intentionally transfer a live lock |
| `INHERITED_IDENTITY` | Mutate child inspection to same-file identity, even with claimed non-inherit flags; reducer refuses |
| `WRONG_CUSTODY` | Substitute leaf/root native identity in a captured barrier; refuse before lock/death authority |
| `WRONG_RANGE_OR_FLAGS` | Mutate reviewed call/compile parameters; source/build census refuses; no blocking-lock fallback |
| `BUILD_OR_LOADER_SUBSTITUTION` | Substitute candidate bytes for witness output or change a retained loaded byte; pre-load/retained-byte rehash refuses |
| `MALFORMED_OR_FORGED_FACTS` | Extra member, unknown error or candidate verdict in a pending call; hostile-safe parser refuses |
| `FALSE_DEATH_OR_RETRY` | Transcript lacks exact exit/close, moves attempt before close, or contains two post-death calls; reducer refuses |
| `MISSING_OR_MIXED_CENSUS` | Missing/duplicate/extra case, control, OS archive or differing attempt/revision; diagnostic verifier refuses |
| `CAPABILITY_CONFUSION` | Feed experiment report/OBSERVED into existing profile/core/publication parsers; unchanged parsers refuse |

These mutation rows also cover their named structural variants deterministically
in one test invocation; no fuzz campaign, transfer mechanism or new security
framework is required. They must fail if their corresponding guard is deleted.
An incomplete control census cannot yield `OBSERVED`.
Retained control inputs and observed rejection transcripts have fixed paths
`controls/<controlId>/input.json` and `controls/<controlId>/observation.json`;
case stdout/stderr use `transcripts/<caseId>/<actor>.stdout` and `.stderr` for
that case's actual child actors. The stable collector derives this finite
file census from the report, builds and fixtures, hashes every retained file
using the existing artifact manifest, and refuses missing/extra files. A
`refused` Boolean without its replayable guard input or real witness transcript
is missing evidence. Guard replay uses stable code and data only; native
process measurements are not rerun by the reducer.

#### Disposition, proportionality, and stop boundary

The prediction is falsifiable at the first complete three-OS reduction:
these fixed-file native locks may remove the exclusive-create residue while
still failing the unchanged immediate one-attempt owner-death property.
`OBSERVED` is exploratory evidence only. All selectable capability/profile
slots remain null; ISS-004/005/020/031 remain blocked until their existing full
selection requirements are met. CAS, replacement, same-lock absence, process
tree ownership, production custody, reboot/network-filesystem behavior and
credentials are not inferred. ISS-004's fixed lock/singleton/revocable handles/
CAS/readback/fail-closed recovery and ISS-005's exact descendant-death
requirement remain intact.

The measured threat is lost exclusion after holder death. Removing the native
binding restores residue failure; removing the independent witness allows
bypassed locks to self-report success. Retaining `BLOCK_REPLAN` is the smallest
alternative; a JavaScript mutex cannot test unrelated-process exclusion.
The two small independently authored native sources are justified by that
specific witness need, not by a reusable helper platform. Scope permits only
the binding, witness, stable driver/build/fixtures, and inseparable existing
harness/registry/census amendments. No service, sidecar, global sequencer,
general filesystem API, privileged setup, new account, installed release or
committed binary. Round 234's isolation remains parked until ISS-019.

One bounded pressure round and at most one after a named blocker repair apply.
A larger diff than one review sitting, unavailable independent witness,
required privilege/general helper, changed native primitive, relaxed death
property, or need for retries is a concrete replan boundary. Source/build/loader
substitution, false holder identity, inheritance, Windows release lag, forged
barriers and evidence-to-authority confusion are the review attack surface.
Independent review decides acceptance of this ledger; the author does not
certify it. This docs packet executes no build, probe, hosted run or publication.

## Routine contract census and first literal ledger (ISS-002 additive scope)

This section is the first bounded ledger for Todd's additive ISS-002 scope
approved 2026-08-31. It preserves ISS-002's original completion. It is subject
to independent review before implementation; no parser, cycle, or authority
is delivered by this documentation packet. Sources are `routine-cycle.md`'s
15-step protocol, `module-abi.md`, `bootstrap-manifests.md`'s consumer contracts,
the existing engine/adapter decisions above, and ISS-041's unchanged acceptance.

### Finite consumer census before coding

The table exhausts the non-project contract surfaces needed for the accepted
fixture's session acquisition, complete ordinal journal/replay, echo-worker
and distinct later review paths, rejection/malformed-frontier/concurrent-lease
controls, and boundary resume. “Remaining” names an entire future literal
group, not an open payload or supported partial schema. Each group requires
its own independent literal review before its code. A fixture cannot substitute
private records for these public contracts and claim complete acceptance.

| Step / consumer         | Already defined and reused unchanged                                                                                                                          | Remaining named surface and actual consumer                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cycle entry / 1         | `platform-configuration/v1`, `platform-configuration-source/v1`, `configuration-provenance/v1`, `configuration-paths/v1` as applicable configuration inputs   | `cycle-request/v1`, `cycle-plan/v1`, `session-acquire-request/v1`, `session-receipt/v1`, `session-health/v1`: ISS-041's lease acquisition/refusal and session check; ISS-007/026 are runtime owners                                                                                                                                                                                                                 |
| All steps / replay / 15 | closed-record, canonical-byte, digest primitives                                                                                                              | `orchestration-event/v1`, `event-journal/v1`, `reduced-state/v1`, `cycle-receipt/v1`: ISS-041 append/replay, boundary resume and complete terminal census; ISS-010/026 own production                                                                                                                                                                                                                               |
| 3                       | project current-policy facts are supplied by ISS-013, not generic breaker authority                                                                           | `breaker-receipt/v1`: the newly named generic reduction output, with its closed hold/history evidence; ISS-041 step 3 and ISS-025/026. History entries belong to the event union, not a second breaker-history family                                                                                                                                                                                               |
| 4                       | `dispatch-action-core/v1`; `dispatch-brief/v1` and its `dispatch-brief-action/v1`, `dispatch-brief-directive/v1`, `dispatch-brief-resource/v1` nested records | `module-descriptor/v1`, `module-plan-input/v1`, `module-plan-result/v1`, `module-action-plan/v1`, `module-no-action/v1`: inline module input, declared effects, complete action/no-action/refusal output; ISS-041 and ISS-011/026                                                                                                                                                                                   |
| 5                       | `worker-host-identity/v1`, `worker-host-renderer-artifact/v1`, their existing closed mapping and membership relation                                          | `route-selection/v1`: exact opaque host choice/refusal; ISS-041 and ISS-012/008                                                                                                                                                                                                                                                                                                                                     |
| 7–9                     | unchanged action-core/brief/host contracts                                                                                                                    | `dispatch-plan/v1`, `worker-launch-receipt/v1`, `worker-terminal-receipt/v1`: bound plan, launch/ownership, terminal observation and refusal; ISS-041 and ISS-008/005. Allocation/process/credential-reference evidence needs closed inline shapes here, not new generic envelope families                                                                                                                          |
| 9–10                    | existing canonical identity primitives; no review authority is reusable from a worker                                                                         | `worker-result-subject/v1`, `review-subject/v1`, `release-candidate-subject/v1`, `review-request/v1`, `review-attempt-result/v1`, `review-authority/v1`: exact worker target, distinct later review attempt and accepted/rejected/unknown result; ISS-041 and ISS-009. Candidate subject is required only to close the already specified review-subject union; no candidate execution or release operation is added |
| 11                      | exact action-core and immutable review/worker target from preceding rows                                                                                      | `action-disposition/v1`, `follow-up-cycle-request/v1`: apply/no-action/refusal or later exact-target review/repair request; ISS-041 and ISS-011/026. Every existing follow-up kind must be structurally closed, including successor verification; parsing it does not schedule it                                                                                                                                   |
| 14                      | exact preceding plan, owner, terminal and disposition evidence                                                                                                | `resource-reclaim-receipt/v1`: full reclaimed/no-allocation/retained-capacity result; ISS-041 and ISS-008, coordinating ISS-013/005 owners                                                                                                                                                                                                                                                                          |
| Skipped ordinals        | no existing public skip family                                                                                                                                | `routine-step-skip/v1` plus the inline identity below: ISS-041 complete ordinal census and later ISS-010/026 replay                                                                                                                                                                                                                                                                                                 |

Step 2's `adapter-configuration/v1`, `project-facts/v1`, and
`project-breaker-facts/v1` are already public ISS-013 families. Steps 6, 12 and
13 require ISS-013's remaining `project-preflight/v1`,
`project-mutation-request/v1`, `project-mutation-plan/v1`, and
`project-apply-receipt/v1`, plus its allocation/reclaim facts where consumed.
They stay outside this addition, even when the fixture needs their refusal
arms. A typed skip cannot be used merely because a required parser is missing.

`routine-cycle/v1` is the fixed protocol identifier and
`orchestration-module/v1` the callable ABI, not additional JSON envelopes.
`module-plan-result/v1` denotes the complete action/no-action/typed-refusal
union; `review-subject/v1` denotes the complete worker-result/candidate union.
Their later ledgers must fix their public parse/serialization dispatch without
inventing duplicate wrapper records. Refusals, finding rows, ownership/resource
censuses, breaker history/probe evidence, route evidence, and follow-up reasons
must be closed inline shapes or existing union arms, never arbitrary objects,
schema-name strings permitting arbitrary payloads, or new convenience families.

The census excludes optional CLI-only `worker-health/v1`,
`journal-append-receipt/v1`, and `snapshot-receipt/v1`: the fixture uses terminal
observations, the actual journal rows, and full replay, not those commands or
snapshot caching. Session renewal/handoff command families, production module
manifest/registry admission, release assembly/certification/promotion/recovery
records, recovery-launch/fence supervision, and broker/physical authority
families are not executed by ISS-041. Their existing owners and gates remain.
In particular no `release-operation-plan/v1` or promotion receipt is needed by
the admitted project path; closing candidate-subject/follow-up union arms does
not admit that alternate path. The existing command-result envelope and command
census remain unchanged: public parser support cannot activate a CLI command.

### First complete literal group: identity and skip

`C(x)` is the existing canonical UTF-8 JSON encoding: recursively sorted keys,
no insignificant whitespace or BOM, one final LF, no CR, duplicate keys, or
noncanonical number/string encoding. Existing detached closed-record rules
apply at every entry point and nested record; no input code is invoked.
`Uuid` matches lowercase UUIDv7
`[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`;
`Digest` matches exactly `[0-9a-f]{64}`. All fields below are required; absent,
extra, wrong-case, wrong-type, or null fields refuse except the stated null cell.

The step identity preimage is one inline closed record with exactly these
five members in canonical order. It has no `schemaVersion`, timestamp,
attempt counter, self digest, result, or extension member and is not a new
persisted/public schema family.

| Member                     | Exact rule                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `cycleId`                  | `Uuid`                                                                                                                               |
| `inputDigest`              | non-null `Digest`; identity of the exact admitted input; for a skip it is the immediately preceding ordinal's terminal output digest |
| `kind`                     | the exact literal paired with `ordinal` below                                                                                        |
| `ordinal`                  | one canonical decimal string `"1"` through `"15"`; numbers, zero, signs, padding and fractions refuse                                |
| `predecessorJournalDigest` | null exactly at ordinal `"1"`; otherwise non-null `Digest` of the exact journal prefix before this step's first event                |

| `ordinal` | `kind`             | `ordinal` | `kind`              | `ordinal` | `kind`             |
| --------- | ------------------ | --------- | ------------------- | --------- | ------------------ |
| `"1"`     | `session.verify`   | `"6"`     | `project.preflight` | `"11"`    | `disposition.plan` |
| `"2"`     | `project.snapshot` | `"7"`     | `dispatch.plan`     | `"12"`    | `mutation.plan`    |
| `"3"`     | `breaker.reduce`   | `"8"`     | `worker.dispatch`   | `"13"`    | `action.apply`     |
| `"4"`     | `module.plan`      | `"9"`     | `worker.observe`    | `"14"`    | `resource.reclaim` |
| `"5"`     | `route.select`     | `"10"`    | `review.reduce`     | `"15"`    | `cycle.terminal`   |

`Dstep = SHA256(C(step))`, lowercase hex, is exactly the existing routine
protocol's untagged preimage hash; do not silently add a domain frame or include
a derived `Dstep`. Resume retains these same bytes and identity, including the
original prefix, even after an observation has appended more journal rows.
There is no new identity until the preceding step has one terminal output.
The later journal ledger owns the literal prefix digest and initial cycle-start
binding; null is initial position, not proof of a healthy session or empty disk.

`routine-step-skip/v1` has exactly three members in this canonical order:

| Member          | Exact rule                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `reason`        | one literal in the complete five-row union below; non-null                                                                   |
| `schemaVersion` | literal `routine-step-skip/v1`                                                                                               |
| `step`          | the exact five-member non-null inline record above, restricted to ordinals `"2"` through `"13"` and the reason's ordinal set |

The predecessor terminal output digest is precisely `step.inputDigest`; no
second copied digest, cycle ID or ordinal is stored. For a skip following a
skip, this is the prior skip's `Dskip`, not the original failure's digest.
There are no other nested records or arrays in this family. All reason arms
have these same three members; branch-specific extra fields refuse.

| `reason`               | Structurally allowed ordinal(s) | Exact later composition requirement                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prior-known-terminal` | `"2"`–`"13"`                    | Exhaustive early-stop route after known terminal source 1–7; all remaining 2–13 ordinals as applicable. Also step 13 after step-12 known plan refusal. Never UNKNOWN                                                                                           |
| `no-allocation`        | `"7"`                           | The existing allowed 7–10 skip block for an action whose admitted manifest/descriptor declares neither worker nor review; steps 1–6 otherwise reached their successful continuation. This literal assignment skips dispatch planning, not resource reclamation |
| `no-worker`            | `"8"`, `"9"`                    | Steps 8–9 in that same declared no-worker/no-review block; or step 9 after an actual step-8 launch-refusal terminal                                                                                                                                            |
| `no-review`            | `"10"`                          | Declared no-review action, launch refusal, known worker failure, or implementation/observer result requiring a distinct later review cycle. An accepted review cannot be invented by this skip                                                                          |
| `no-mutation`          | `"12"`, `"13"`                  | Step 11 actually produced its review-needed, repair/follow-up, failure, no-action or explicit nonmutating COMPLETE disposition, including a review-rejection follow-up; no same-cycle apply                                                                                                             |

Known early-stop routing takes precedence over the action-specific block.
A continuing worker path always has actual step-7 and step-8 terminals; launch
refusal skips only 9–10 before actual disposition. Every route still produces
an actual step-14 `resource-reclaim-receipt/v1` (including no allocation), then
step 15. None of 1, 14 or 15 can be a skip. `no-allocation` does not declare
resources absent. This assignment closes the previously unnamed reason choice
inside the existing step-7 skip edge; it adds no edge or resource authority.

`Dskip` is SHA-256 over exactly
`UTF8("orchestration-platform") || 00 || UTF8("routine-step-skip/v1") || 00 ||
u32be(1) || 07 || u64be(byteLength(C(skip))) || C(skip)`.
This is one existing canonical-record framed part under the literal family
domain, including nested step bytes and the final LF. It contains no raw-32 or
field-wise parts. Generic serialization returns these bytes and `Dskip`, never
the untagged canonical hash. The bytes contain neither `Dskip` nor `Dstep`.
Object insertion order may differ on input; persisted byte parsing requires
exact canonical order/encoding. Future/unknown schema versions refuse.

For example the following is the complete canonical byte spelling of a
structurally valid skip, with exactly one LF following the final `}`:

<!-- prettier-ignore -->
```json
{"reason":"prior-known-terminal","schemaVersion":"routine-step-skip/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000001","inputDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"project.snapshot","ordinal":"2","predecessorJournalDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
```

The hashes in that example are structural values, not claims that their
preimages exist. Before a future consumer uses a skip, it must parse the actual
predecessor terminal and journal, recompute both identities, prove the same
cycle and immediate predecessor ordinal, and equal-bind both digests. It must
also check the actual earlier source output and descriptor/action/role/review
evidence for the table's route; digest-shaped assertions are insufficient.
A same-identity different output, skipped/moved prefix, missing terminal,
illegal reason, or UNKNOWN source refuses continuation. A skip grants no
mutation/review/capacity authority and never repairs an incomplete prefix.
Those composed validators wait for the later literal groups; this first group
can implement only total inline/skip parsing, `Dstep`, `Dskip`, canonical
serialization and the local ordinal/kind/reason restrictions.

### Acceptance vectors and proportionality

Prediction: the five-member inline record and three-member skip suffice, with
no standalone identity envelope or generic payload. Review this prediction
before its parser packet; review each remaining group's literal shapes and
bindings before any corresponding code. This packet claims no executed vector.

| Future vector                                   | Required observation / deletion attack                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closed inputs                                   | remove/add/rename/null/cross-type each outer and nested member; proxies, inherited fields, accessors and exotic records refuse without input-code execution                                                                                           |
| Identity census                                 | all 15 exact pairs; cross every other ordinal/kind pairing; reject numeric/zero/16/padded ordinals and wrong UUID/digest grammar; null prefix succeeds only at 1                                                                                      |
| Complete skip union                             | pin one canonical byte/digest golden per reason and each permitted ordinal; cross every reason against 1–15; no unsupported arm disguised as a successful v1 parser                                                                                   |
| Canonical identity                              | shuffled object insertion preserves bytes; persisted shuffle, CRLF, BOM, whitespace, duplicate key or missing LF refuses; one changed preimage member changes Dstep; field-wise/wrong-domain/untagged Dskip framing disagrees                         |
| Repeated skips and resume                       | recompute each immediate prior terminal digest, never reuse the initial stop digest through a chain; identical replay retains Dstep/Dskip, changed input/cycle/prefix/ordinal/result refuses later binding                                            |
| Route separation, when later groups exist       | no-allocation at 14, no-worker at 7, launch refusal skipping disposition, no-review substituting for mandatory later review, no-mutation without actual disposition, malformed/missing descriptor, and UNKNOWN padded to a complete census all refuse |
| Immutable later review, when later groups exist | same-cycle/same-attempt author-reviewer, changed target, rejected review followed by apply, and worker-result acceptance reused as candidate acceptance refuse; structural parse alone never grants authority                                         |

The concrete threat is fabricated complete-cycle evidence or substitution of
a skip for work, review or reclaim. Deleting closure/digest/binding checks
admits those mutations. The smaller alternative to a new step-identity family
is the inline preimage used here; the smaller alternative to full runtime
machinery is pure contracts followed by ISS-041's disposable consumer. No new
planner, test framework, filesystem path, process service, module admission,
CLI mapping, schema ownership, or release authority is introduced.

### Second complete literal group: cycle entry and session observations

This bounded proposal closes the five cycle-entry names in the census:
`cycle-request/v1`, `cycle-plan/v1`, `session-acquire-request/v1`,
`session-receipt/v1`, and `session-health/v1`. Independent literal review is
required before their parser increment. The first identity/skip group's
delivered parsing is unchanged. Nothing here implements a lease, journal,
state transition, command, or native gate. The receipt union includes acquire,
renew, and release because the existing CLI census already returns this same
family for all three; supporting only acquisition would publish a partial v1.
It adds no renewal/handoff request family or handoff receipt, no CLI mapping,
and no production execution to ISS-041.

#### Exact input and plan records

`C`, `Uuid`, `Digest`, and detached closed-record/array rules are as above.
Every member below is required; no extra, absent, undefined, or null value is
accepted except an explicit null cell. `Time` is a real Gregorian UTC instant
with exact spelling `YYYY-MM-DDTHH:mm:ss.sssZ`, four-digit year 0001–9999,
no leap second, offset, rollover, or alternative precision. `Id` uses the
existing adapter grammar `[a-z0-9][a-z0-9._:@+-]{0,127}`; module IDs use that
same opaque grammar, not a policy vocabulary. All listed field sequences are
canonical key order; every nested record is closed by its named definition.

`session-acquire-request/v1` has exactly five members:

| Member | Exact rule |
| --- | --- |
| `configurationPathsDigest` | non-null `Digest` of the existing `configuration-paths/v1` record |
| `configurationProvenanceDigest` | non-null `Digest` of the existing `configuration-provenance/v1` record |
| `configurationSourceDigest` | non-null `Digest` of the existing `platform-configuration-source/v1` record |
| `schemaVersion` | literal `session-acquire-request/v1` |
| `sessionId` | `Uuid`, the requested durable session identity |

Those three configuration identities are each `SHA256(C(record))`, using the
existing generic configuration serialization, not newly framed aliases.
The source is the admitted project source record before effective resolution;
its nullable `stateRoot` and provenance's existing `fieldSources` retain their
current meaning. Do not substitute the older resolved
`platform-configuration/v1` for that source. No copied clock settings, project
ID, absolute host path, credentials, holder PID, expiry claim, or caller-chosen
state namespace enters this request. The configuration record definitions and
their path redaction/token algorithm remain unchanged.

`cycle-request/v1` has exactly five members:

| Member | Exact rule |
| --- | --- |
| `adapterId` | non-null `Id` |
| `allowedModuleIds` | dense array of 0–64 non-null `Id` strings, strictly ascending ASCII order and therefore unique; empty permits no module invocation |
| `cycleId` | non-null `Uuid` |
| `schemaVersion` | literal `cycle-request/v1` |
| `sessionRequest` | complete non-null `session-acquire-request/v1` record above |

`cycle-plan/v1` has exactly `protocol, request, schemaVersion` in that order:
`protocol` is literal `routine-cycle/v1`; `request` is the complete non-null
`cycle-request/v1`; `schemaVersion` is literal `cycle-plan/v1`. No other plan
arm exists. Rejection produces no plan; a future CLI owner uses its existing
failure channel. The nested request supplies all cycle/session request,
adapter/module and configuration identities without copied digests or IDs.
This plan contains no live facts, breaker decision, route, preflight,
dispatch/result/review subject, follow-up payload, mutation plan, active
release, epoch, or authority evidence. Later review/follow-up targets remain
the census's separate subject/request families and their later ledger's
step-input/journal binding; an entry plan cannot authorize or erase a target.

#### Complete session operation receipt union

`session-receipt/v1` has exactly these seven members in every arm. It reports
an operation result, not the durable lease record or a pointer CAS receipt.
There are no nested payloads, arrays, message strings, or extension objects.

| Member | Exact rule |
| --- | --- |
| `acquireRequestDigest` | non-null `Digest` of the input request for `ACQUIRE`; exactly null for `RENEW/RELEASE`, whose existing command inputs are session identities rather than acquisition requests |
| `operation` | exactly `ACQUIRE`, `RENEW`, or `RELEASE` |
| `outcome` | exactly `ACQUIRED`, `RENEWED`, `RELEASED`, `REFUSED`, or `UNKNOWN`, with only the pairings below |
| `reason` | null on success; otherwise exactly one matrix reason |
| `recordedAt` | `Time`, except null is permitted only for `UNKNOWN` |
| `schemaVersion` | literal `session-receipt/v1` |
| `sessionId` | non-null `Uuid` of the requested session, including refusal/unknown |

The following is the complete operation/outcome/reason matrix. A comma means
separate permitted literals, not an array. All unlisted combinations refuse.

| `operation` | `outcome` | `reason` |
| --- | --- | --- |
| `ACQUIRE` | `ACQUIRED` | null |
| `RENEW` | `RENEWED` | null |
| `RELEASE` | `RELEASED` | null |
| `ACQUIRE` | `REFUSED` | `SESSION_HELD`, `SESSION_STALE`, `HANDOFF_PENDING`, `CONFIGURATION_MISMATCH` |
| `RENEW` | `REFUSED` | `SESSION_NOT_FOUND`, `SESSION_MISMATCH`, `SESSION_RELEASED`, `SESSION_STALE`, `DURATION_EXCEEDED`, `HANDOFF_PENDING`, `CONFIGURATION_MISMATCH` |
| `RELEASE` | `REFUSED` | `SESSION_NOT_FOUND`, `SESSION_MISMATCH`, `HANDOFF_PENDING`, `CONFIGURATION_MISMATCH` |
| any of the three | `UNKNOWN` | `STATE_UNREADABLE`, `IDENTITY_CONFLICT`, `CLOCK_ROLLBACK`, `CLOCK_SKEW`, `MONOTONIC_UNAVAILABLE` |

`CONFIGURATION_MISMATCH` means admitted input configuration disagrees with the
operation's bound context; `SESSION_NOT_FOUND` means no matching lease exists;
`SESSION_MISMATCH` means a different holder is selected. Held/stale/released/
handoff reasons report those existing lease states, and `DURATION_EXCEEDED`
reports the maximum-duration bound. An unreadable or contradictory state is
unknown, never not-found. Missing monotonic evidence or clock discontinuity
uses the corresponding unknown reason, never a freshness extension. Choosing
between simultaneously applicable known refusals does not grant a transition;
the runtime owner must prove the selected reason from actual observations.

For `ACQUIRE`, the input digest stays non-null even on refusal or unknown:
the caller supplied a structurally valid acquisition request. Its actual bytes
must later rederive that digest and equal-bind `sessionId`. A malformed input
cannot become this family by inventing either value; it fails parsing before
an operation receipt. For `RENEW/RELEASE`, the operation and requested session
are the entire input identity exposed by the existing command contract; null
does not assert absent acquisition evidence or permission to create a session.
`UNKNOWN` never changes to `REFUSED` merely because some identity fields were
syntactically readable.

This result contains no predecessor, lease-value, or handoff-proof digest.
Durable-state evidence has its own owner and admission boundary; requiring an
acquisition receipt for every holder would exclude a legitimate handoff
successor. Later ISS-007/004 admission must independently
prove the actual selected lease/predecessor, exact holder, clock bounds and
allowed transition; none is derivable from `Dsession`. Receipt sequences are
not a lease state machine. The existing runtime owners retain renewal/retry
identity and idempotence, release races, stale handoff, and their actual state
contracts. A known contender's refusal cannot select a successor or change
the other holder. Recording or replaying any outcome never reacquires,
renews, releases, or extends a lease.

#### Complete session health union and step-1 binding

`session-health/v1` has exactly eight members in every arm:

| Member | Exact rule |
| --- | --- |
| `holderSessionId` | observed holder `Uuid` or null, as below |
| `leaseState` | exactly `AVAILABLE`, `HELD_FRESH`, `HELD_STALE`, `HANDOFF_PREPARED`, `RELEASED`, or `UNKNOWN` |
| `observedAt` | `Time`; only `UNKNOWN` may instead use null |
| `outcome` | exactly `HEALTHY`, `REFUSED`, or `UNKNOWN`, paired below |
| `reason` | null or one exact matrix reason |
| `schemaVersion` | literal `session-health/v1` |
| `step` | null for read-only session inspection, otherwise the complete five-member inline step identity from the first group, restricted to ordinal `"1"`, kind `session.verify`, and null predecessor prefix |
| `targetSessionId` | `Uuid` or null; null only when `step` is null and inspection did not request an identity |

`holderSessionId` is null for `AVAILABLE/UNKNOWN` and non-null for the other
four states; for `RELEASED` it identifies the released holder and for
`HANDOFF_PREPARED` the stale predecessor. For `UNKNOWN`, dropping the untrusted
holder assertion is deliberate; a syntactically valid caller's target and
step remain bound even when observed identity cannot be trusted. There is no
free-form evidence payload or opaque "health proof" standing in for a missing
contract, and no assumption that a holder came from acquire rather than handoff.

| `leaseState` | `outcome` | `reason` and target relation |
| --- | --- | --- |
| `AVAILABLE` | `REFUSED` | `SESSION_NOT_FOUND` |
| `HELD_FRESH` | `HEALTHY` | null; target is null or equals holder and bound configuration agrees at runtime |
| `HELD_FRESH` | `REFUSED` | `SESSION_MISMATCH`; non-null target differs from holder |
| `HELD_FRESH` | `REFUSED` | `CONFIGURATION_MISMATCH`; target is null or equals holder but admitted configuration disagrees with the lease's bound context |
| `HELD_STALE` | `REFUSED` | `FRESHNESS_EXPIRED` or `DURATION_EXCEEDED` when target is null or equals holder; otherwise `SESSION_MISMATCH` |
| `HANDOFF_PREPARED` | `REFUSED` | `HANDOFF_PENDING` when target is null or equals holder; otherwise `SESSION_MISMATCH` |
| `RELEASED` | `REFUSED` | `SESSION_RELEASED` when target is null or equals holder; otherwise `SESSION_MISMATCH` |
| `UNKNOWN` | `UNKNOWN` | `STATE_UNREADABLE`, `IDENTITY_CONFLICT`, `CLOCK_ROLLBACK`, `CLOCK_SKEW`, or `MONOTONIC_UNAVAILABLE` |

Only the matrix's enums, nullability, and target/holder equality are structural
checks. State, configuration, time and health claims require later admission;
the parser does not read external state to accept or reject either fresh arm.

These states are the complete existing lease-state census; an inspection of
handoff-prepared state does not execute handoff or define its request/receipt.
Later composition equal-binds the health record's step to the actual step-1
identity: `step.cycleId = plan.request.cycleId` and `step.inputDigest = Drequest`.
`targetSessionId` equals `plan.request.sessionRequest.sessionId`. A healthy
continuation additionally requires the holder to equal that target and actual
runtime admission of its current lease under the bound configuration. Neither
an old acquisition/renewal receipt nor an earlier healthy observation can
substitute for that check. An inspector record with null step cannot be
relabeled as step-1 output. `HEALTHY` allows step 2 only
after fresh runtime admission; known refusal takes existing skips 2–13,
actual step 14, then failed-known step 15. `UNKNOWN` follows the existing
unknown rule and cannot be padded with skips. No ordinal or edge changes.

#### Framing, composition boundary, and required evidence

For each row below the only digest is SHA-256 of exactly
`UTF8("orchestration-platform") || 00 || UTF8(domain) || 00 || u32be(1) ||
07 || u64be(byteLength(C(record))) || C(record)`. Each is one canonical-record
part including the final LF, not field-wise parts or an untagged hash.

| Symbol | Exact domain and record family |
| --- | --- |
| `Dacquire` | `session-acquire-request/v1` |
| `Drequest` | `cycle-request/v1` |
| `Dplan` | `cycle-plan/v1` |
| `Dsession` | `session-receipt/v1` |
| `Dhealth` | `session-health/v1` |

All five are standalone structural records eligible for generic canonical
serialization after review/implementation; no pointer context or path is
invented. Serialization returns exact canonical bytes and the row's framed
digest, never an embedded self-digest. Nested request bytes contribute in
place; they do not carry their separate derived digest. `Dstep` stays the
existing untagged inline hash. Future cycle-run admission compares its supplied
plan ID to `Dplan`; the journal ledger must bind this plan and step-1
`Drequest/Dstep/Dhealth` without creating a cycle in the digest graph. Storage
paths, initial journal-prefix encoding, and selected-state discovery remain
the existing runtime/journal owners' work, not implicit parser features.

Before any future use, ISS-007/026 obtain the actual source/provenance/paths
records, recompute all three existing configuration hashes, and equal-bind the
request. The admitted loader must prove source-to-effective provenance and
path-token bindings with its actual configuration/path resolution; matching
digest-shaped strings is insufficient. Adapter ID equals admitted provenance;
project identity, capabilities, clock limits, and state root come only from
that admission. Requested module IDs must be a subset of the installed,
reviewed static registry and later current policy; a request never installs,
chooses a version, dynamically loads, or proves eligibility for a module.

ISS-007/026 and ISS-004 retain actual lease acquisition/renewal/release, selected
state, state-root containment, currentness, fresh injected UTC/monotonic clock
checks, one-session/one-cycle concurrency, native exclusion, and external
stable mutation authority. Missing observations, rollback, excessive skew,
unreadable state, or conflicting identity cannot extend freshness or duration.
A supplied `HEALTHY/ACQUIRED/RENEWED` spelling is not evidence that those checks
ran. No public parser, serializer, or local equality check may grant health,
ownership, a lease, epoch, or mutation authority. ISS-041 may demonstrate its
existing quarantined create-once lease/refusal; it cannot certify those runtime
gates. Renew/release schema arms add no such fixture acceptance requirement.

Required future executable evidence, after independent review:

| Vector / removal attack | Required result |
| --- | --- |
| Complete closed census | member deletion/addition/rename/null/type mutants at every depth; scalar grammar boundaries; all 0/1/64 module-list bounds plus 65, unsorted/duplicate entries, holes/proxies/accessors/exotic inputs; no input code invoked |
| Input/plan goldens | fixed canonical byte, complete frame-hex and expected digest goldens for each of acquisition request, cycle request and cycle plan, with nested request equality, empty/nonempty module lists and the three actual configuration preimages; expected values are pinned independently of the serializer under test |
| Complete union | canonical bytes and fixed expected digest goldens for every operation/outcome/reason row and every health state/reason/target relation, including acquire refusal, renewal/release, handoff observation, and all unknown reasons; crossed operation/outcome/reason, holder nullability and invented arms refuse |
| Timestamp/refusal cells | valid calendar/precision endpoints, invalid leap day/rollover/leap second/offset; null timestamp only unknown; every operation/input-digest nullability cell tested independently; malformed input never becomes a receipt |
| Canonical binding | shuffled object insertion preserves bytes/digest; persisted shuffled keys, BOM, CRLF, duplicate keys, whitespace, missing/extra LF or future version refuse; pin full preimage frame hex and expected digest, reject wrong family/tag/part count/raw-32/untagged framing; single-field and nested-field changes alter the appropriate identity |
| Configuration and plan composition | independently swap source/provenance/paths, redact-token binding, adapter, module, session or cycle; removing any actual-byte/hash/equality/admission check permits a mutant and fails the later composition suite; an unknown module or a different supplied Dplan never runs |
| Receipt and observation binding | swap acquire request bytes/session ID; swap operation or requested session on renewal/release; later admission rejects acquisition over a held/stale predecessor, a supplied receipt in place of current lease evidence, and a healthy record borrowed from another request/cycle or null-step inspector; valid handoff successors are not rejected merely for lacking an acquisition receipt |
| Runtime separation and routing | later consumer tests reject fabricated healthy fields without fresh state/clock/authority, clock discontinuity, concurrent acquisition, moved selected state, unknown-to-refused coercion, and UNKNOWN padded to 15; parser-only evidence cannot satisfy any of these runtime tests |

This documentation packet runs no vector. Prediction: five closed records,
one existing inline step shape and the existing configuration records suffice;
no generic lease-evidence payload, new envelope, native receipt or execution
type is needed. Removing a configuration/receipt/step binding admits a concrete
substitution, while removing copied live proof fields loses nothing because
none are added. Remaining census groups are journal/replay/terminal, breaker,
module planning, route selection, dispatch/worker, immutable subjects/review,
disposition/follow-up, and reclaim; ISS-013's project groups remain separate.
Durable session-state/handoff admission, journal-start and later-target
composition are explicit remaining dependencies,
not a claim of complete cycle execution or a change to issue prerequisites.

### Third complete literal group: immutable review subjects

The journal/replay/terminal census is not yet a complete literal group.
`orchestration-event/v1` must close the breaker history/probe and actual typed
step-output arms, including worker/review subjects and reclaim; `event-journal/v1`
must bind those events, `reduced-state/v1` must fold their complete semantics,
and `cycle-receipt/v1` must bind the resulting ordinal/resource census. A
generic payload, unchecked schema-name/digest pair, or fixture-only event union
would conceal those dependencies. None of those four families is defined or
made parseable here. Their later ledger must also settle the acyclic terminal
receipt/journal-prefix binding before implementation.

This prerequisite group instead closes three names already in the finite
census: `worker-result-subject/v1`, `release-candidate-subject/v1`, and the
complete `review-subject/v1` union of those two concrete records. It fixes
immutable targets only. Review requests, attempts, authority, event history,
follow-up and step-9 output composition remain separate complete groups;
neither a journal reducer nor a subject materializer is added. Independent
literal review precedes the corresponding pure parser increment.

#### Closed source reference and worker-result record

`C`, `Uuid`, `Digest`, `Id`, and detached closed-record/array rules are as in
the preceding groups. All members are required and non-null, including every
nested member. Field sequences below are canonical key order. Unknown fields,
versions, result kinds, missing values and input code execution refuse.

An inline source reference has exactly `adapterId, projectId, revision`.
`adapterId` and `revision` use `Id`; `projectId` is `Uuid` from the admitted
project configuration. `revision` is an opaque immutable revision token in
that adapter/project namespace, not a portable authority identity. A Git
adapter supplies the exact lowercase full source commit SHA here; other
adapters may supply their own immutable token under the same grammar. The
parser cannot distinguish an immutable token from a branch-shaped string:
actual immutable-source admission belongs to the adapter, and a mutable name,
abbreviation, moved token or unresolved source never suffices for later use.
No host path, repository URL, provider ID, schema tag, timestamp or extra
payload enters this inline record. It is not a third persisted family.

`worker-result-subject/v1` has exactly six members:

| Member | Exact rule |
| --- | --- |
| `authorAttemptId` | `Uuid` of the exact implementation or observer attempt |
| `authorCycleId` | `Uuid` of the cycle that observed that attempt's terminal result |
| `baseSource` | complete inline source reference above, identifying the admitted immutable base |
| `result` | complete two-arm inline materialization union below |
| `schemaVersion` | literal `worker-result-subject/v1` |
| `terminalReceiptDigest` | `Digest` of that attempt's actual `worker-terminal-receipt/v1` under its owning ledger's digest function |

`result` is exactly one of these closed records. Opposite-arm members are
absent, not null. There is no common optional payload or third arm.

| `kind` | Complete member census and rules |
| --- | --- |
| `TREE` | exactly `kind, treeDigest`; `treeDigest` is `Digest` of the retained canonical result-tree materialization bytes |
| `ORDERED_PATCH_ARTIFACTS` | exactly `entries, kind`; `entries` is a dense array of 1–4096 closed records, each exactly `contentDigest, kind`, with `contentDigest:Digest` and `kind` exactly `PATCH` or `ARTIFACT` |

Tree and entry content digests are SHA-256 over the exact retained bytes, not
a Git object ID, an unbound filename, or a hash of a digest's hex spelling.
Those content bytes are not JSON payload fields and have no newly invented
public schema. The responsible adapter/materializer owns their deterministic
format and exact-base relation; this ledger does not authorize a format or
materializer implementation. Content whose interpretation requires paths,
names, ordering or other metadata must bind that information in the retained
materialization bytes; a bare blob plus mutable out-of-band metadata does not
prove an immutable target. The portable parser treats content as a reference,
not executable patch instructions or a filesystem locator.

Entry order is semantic and is never sorted or deduplicated. Repeated entries
are structurally allowed and retain every occurrence: identical content may
occur twice in an ordered result. A different kind, multiplicity or ordering
changes the subject bytes; swapping two byte-identical entries changes
nothing. A result tree identical to the base is allowed for an observer; the
parser does not require a source change. An empty ordered result refuses;
missing materialization cannot be repaired by fabricating a digest.

#### Closed release-candidate record and wrapper-free union

`release-candidate-subject/v1` has exactly eight members:

| Member | Exact rule |
| --- | --- |
| `assemblyCycleId` | `Uuid` of the cycle that assembled/certified this candidate |
| `candidateDigest` | `Digest` of the actual immutable `release-candidate/v1` |
| `certificationDigest` | `Digest` of the actual complete `release-certification/v1` |
| `landedSource` | complete inline source reference above for the final landed revision |
| `landedTreeDigest` | `Digest`, SHA-256 of the exact retained canonical landed-tree materialization bytes |
| `manifestDigest` | `Digest` of the actual `release-manifest/v1` |
| `schemaVersion` | literal `release-candidate-subject/v1` |
| `testBundleDigest` | `Digest` of the exact stable test bundle bound by that certification |

Candidate, certification, manifest and test-bundle identities use their
existing owning contracts; this group defines no replacement hash, release
record, OS-receipt union or certification format. All four references are
non-null even though this parser cannot authenticate their preimages. A
pre-merge worker result or uncertified candidate is not a third subject arm.
The assembly cycle is not a worker attempt: release assembly's existing
no-worker/no-review route does not invent an author worker to fill a field.
Actual build/assembly/certification producer identities must instead be
obtained from the authentic referenced evidence for later independence checks.

`review-subject/v1` is the exact union of the two concrete records above,
discriminated solely by their existing `schemaVersion`. Its public union
parser delegates to the corresponding complete concrete parser and returns
the same detached value. Canonical byte parsing and serialization retain that
concrete schema version. There is no JSON record whose `schemaVersion` is
`review-subject/v1`, no `{kind,subject}` wrapper, no copied subject digest,
and no separate union digest. Such an invented record refuses, including
through generic parsing. Later request/authority fields must carry or name the
concrete arm without granting worker-result review candidate authority.

#### Digest graph, later joins, and admission boundary

`DworkerSubject` and `DcandidateSubject` are SHA-256 of exactly
`UTF8("orchestration-platform") || 00 || UTF8(domain) || 00 || u32be(1) ||
07 || u64be(byteLength(C(subject))) || C(subject)`, under respectively
`worker-result-subject/v1` and `release-candidate-subject/v1`. Each is one
canonical-record part including the final LF; there are no field-wise or
raw-32 parts. Generic serialization returns that concrete arm's bytes and
framed digest. The union identity is that same digest, never a rehash under
`review-subject/v1`. Nested source/result/entry bytes contribute in place;
there are no separate source-reference, result-list or entry schema/digest
families. No subject embeds its own identity, review, selecting journal
prefix or downstream follow-up.

The acyclic worker graph is actual launch/attempt and terminal observation,
then immutable subject, then later review request/attempt/authority and
disposition. `worker-terminal-receipt/v1` must not depend on the subject that
references it; its future ledger must bind the actual observed attempt/result
without including `DworkerSubject`. The step-9 composition later binds both
terminal receipt and subject, not a replacement generic output. The candidate
graph is landed source, candidate/manifest/test bundle and certification,
then candidate subject, then independent candidate review and promotion.
Upstream candidate/certification evidence must not depend on this downstream
subject or its review. This adds no selection, signing or trust protocol.

Before use, the owning ISS-008/009/013/014/026 compositions must obtain actual
canonical records and retained content, recompute their designated identities,
and equal-bind every reference. For a worker subject they prove the same
attempt and author cycle through dispatch/launch/terminal evidence, the
implementation/observer role, exact base adapter/project/revision and the
actual materialized result. Review-role attempts produce the separate
`review-attempt-result/v1`, never a worker subject to review themselves. For a
candidate they prove assembly cycle, fresh final landed SHA/token and tree,
unchanged candidate/manifest, the exact stable test bundle and authenticated
complete three-OS certification. Matching digest-shaped strings is not proof.
No copied field is independently trusted when its source record is missing.

ISS-009 additionally proves a distinct later review cycle and attempt,
unchanged concrete subject and review packet, complete attempt/history, and
identity non-aliasing; unequal UUID text alone does not prove independent
actors. Candidate reviewers must be independent of its actual producer
identities, not merely of a nonexistent author worker. Optional code-host
materialization must prove identical result bytes/tree immediately before
review reduction and mutation; a moved revision or new materialization cannot
inherit an earlier pass. Worker-result acceptance cannot certify a candidate.
Stable promotion and current external authority remain mandatory. Parsing,
serializing or retaining any subject neither accepts a review nor admits a
module, launches a worker, mutates a project, certifies or promotes a release.

#### Required future evidence and proportionality

| Acceptance / removal attack | Cheapest discriminating evidence after separate review |
| --- | --- |
| Exact shapes and branches | Positive TREE, mixed PATCH/ARTIFACT, repeated-entry and candidate records; deletion/addition/rename/type/null mutants at every depth; crossed result fields/kinds and future versions refuse; hostile records/arrays invoke no input code |
| Canonical identities | Independently pinned canonical bytes, full frame hex and expected digest for both worker arms and the candidate; shuffled input insertion is equivalent, noncanonical persisted bytes refuse; wrong domain/tag/count, raw-32 framing, missing LF, untagged and union-rehash alternatives differ/refuse |
| Ordered result and bounds | 1/4096 entries succeed, 0/4097 refuse; swapping distinct entries, deleting an occurrence, PATCH-to-ARTIFACT, one-byte content or base/attempt/cycle/terminal substitution changes identity; swapping identical entries preserves it; no sorting or deduplication |
| Complete union dispatch | Both concrete arms round-trip through their specialized, union and generic entry points with identical bytes/digest; a concrete parser refuses the opposite arm; alias-tagged records, wrappers, hybrid members and unknown versions refuse; later request binding rejects substitution of an otherwise valid opposite arm |
| Actual subject joins, later composition | Independently replace each referenced record/content preimage, namespace, immutable revision, cycle, attempt, role or terminal; remove one comparison and the corresponding substitution must be admitted and fail the suite; parser-only shape success is not join evidence |
| Independence and candidate gates, later owners | Same-cycle/same-attempt or aliased author-reviewer, review-role self-targeting, missing/partial certification, pre-merge/moved landed source, changed manifest/bundle/candidate, rematerialized result, and worker review reused for release all refuse; valid distinct later reviews remain possible |

This documentation packet executes no vector. Prediction: two concrete record
parsers, one existing-name union dispatcher, the inline source/result shapes,
two framed identities and focused contract vectors suffice for the later pure
increment. Removing a source/attempt/materialization/reference binding admits
the named substitution; adding a wrapper, generic payload, event mechanism,
copied trust verdict or new materialization family buys no discriminator here.
Its footprint is this subsection and ISS-002's additive scope only. All four
journal/replay/terminal families, breaker/module/route/dispatch/reclaim,
review request/result/authority, disposition/follow-up and ISS-013's remaining
project groups stay explicitly open. ISS-041 remains partial; production
journal/state/runtime work and ISS-010/026 acceptance remain unchanged.

### Fourth complete literal group: review evidence records

This bounded proposal closes the literal records for `review-request/v1`,
`review-attempt-result/v1`, and `review-authority/v1` in the approved census.
Independent review precedes their pure implementation. The preceding subject
group's exclusions describe that earlier tranche, not permission to implement
this one without review. This packet defines structural evidence and claimed
authority records; it does not implement issuance, history reduction, dispatch,
journal propagation, identity authentication, or a review CLI.

#### Scalars, retained evidence, and immutable request

Reuse `C`, `Uuid`, `Digest`, `Id` and all detached closed-record/array rules.
All members are required and non-null unless a matrix explicitly permits null.
Every field sequence below is canonical key order. Unknown fields, versions,
enum arms, omitted/undefined members and hostile nested values refuse.

An inline retained-content reference has exactly `byteLength, contentDigest`.
`byteLength` is a canonical decimal string from `"0"` to
`"9007199254740991"`; validate grammar/range before numeric conversion.
`contentDigest:Digest` is SHA-256 of the exact retained bytes, including zero
bytes when length is zero. It is neither a framed record identity nor a hash
of a filename or digest spelling. A content list is a dense ordered array of
these references. Bounds are specified at each use; repeats remain present,
and lists are never sorted or deduplicated. Changing order/multiplicity changes
bytes except when interchanging byte-identical entries. There is no content
schema tag, locator, media-type override, executable instruction, or open JSON
payload. Retained bytes may document evidence; reading them grants no authority
and never authorizes executing a reproduced procedure.

`review-request/v1` has exactly `packet, reviewCycleId, schemaVersion`.
`schemaVersion` is literal `review-request/v1`; `reviewCycleId:Uuid` names
the intended later review cycle. `packet` is the complete closed inline record
`brief, evidence, subject`:

| Member | Exact rule |
| --- | --- |
| `brief` | Existing complete `dispatch-brief/v1`; `role` must be `review` |
| `evidence` | Content list of 0–256 retained supplemental review inputs; empty means none |
| `subject` | Concrete worker-result or release-candidate record admitted by the existing wrapper-free `review-subject/v1` parser |

Let `Dsubject` be the concrete subject's existing framed identity, never a
union rehash. Require `packet.brief.action.immutableSubjectDigest = Dsubject`;
the brief's existing directive/subject and complete shape rules also apply.
Require `reviewCycleId != subject.authorCycleId` for a worker target, or
`reviewCycleId != subject.assemblyCycleId` for a candidate. This inequality
refuses same-cycle review but proves neither chronology nor independence.
No synthetic author attempt is added to a candidate.

The packet deliberately consists of these three components together. It is
not just a prompt, a dispatch brief, a rendered byte string, or a provider
artifact. `Dpacket = SHA256(C(packet))`, including the final LF, is its sole
inline identity; there is no `review-packet/v1` schema or framed domain.
Subject and brief bytes are carried, not replaced by copied expected digests.
Supplemental inputs carry exact byte references; the subject's existing
materialization/certification references remain mandatory even with an empty
supplemental list. This packet adds no new rendering, materialization, or
evidence interpretation format. The responsible module/adapter must admit
the retained content's meaning and availability before review use.

The request is immutable and exists before its step-7 dispatch plan. It
contains no dispatch, launch, attempt-result, authority, rendered-byte,
journal, or self digest. Retries may bind the same request only through
distinct admitted attempts; complete-history rules cannot be bypassed by
issuing another request for the same target. A changed subject, brief, input
byte reference/order, or intended cycle requires a new request identity.

#### Complete attempt-result and blocking finding shapes

`review-attempt-result/v1` has exactly these ten members:

| Member | Exact rule |
| --- | --- |
| `attemptId` | `Uuid` of the actual review-role attempt |
| `cycleId` | `Uuid` of that review cycle |
| `dispatchPlanDigest` | `Digest` of its actual `dispatch-plan/v1` |
| `launchReceiptDigest` | `Digest` of its actual `worker-launch-receipt/v1` |
| `packetDigest` | `Digest`, equal to the request's `Dpacket` on binding |
| `requestDigest` | `Digest`, equal to the request's `DreviewRequest` on binding |
| `result` | Exactly one complete inline arm below |
| `schemaVersion` | Literal `review-attempt-result/v1` |
| `subjectDigest` | `Digest`, equal to the same concrete `Dsubject` on binding |
| `terminalReceiptDigest` | `Digest` of this attempt's actual `worker-terminal-receipt/v1` |

The dispatch/launch/terminal digests use their owning ledgers' designated
functions; no substitute hash is specified here. Those literal ledgers and
actual preimages remain deferred; their absence does not make these required
references nullable or give a shape parser provenance evidence.

| `result.kind` | Complete member census | Required content |
| --- | --- | --- |
| `SWEEP_COMPLETE` | `evidence, kind` | `evidence`: content list 1–256 documenting a completed sweep with no blocking finding |
| `BLOCKED` | `evidence, findings, kind` | `evidence`: content list 1–256 documenting the completed sweep; `findings`: 1–256 findings below |
| `INCOMPLETE` | `evidence, kind` | `evidence`: content list 1–256 documenting a sweep that did not complete |
| `FAILED` | `evidence, kind` | `evidence`: content list 1–256 documenting the known failed review attempt |
| `MALFORMED` | `evidence, kind` | `evidence`: content list 1–256 retaining the exact invalid worker output plus any capture diagnosis |

Opposite-arm members are absent, never null. No findings, partial blocking
receipt, reason string, severity flag, or authority verdict may be added to
the other four arms. An unfinished sweep with a suspected block is
`INCOMPLETE`; its retained report may record that suspicion but cannot become
a `BLOCKED` receipt. `SWEEP_COMPLETE` is worker evidence, not acceptance.
`BLOCKED` does not select repair/replan or authorize a mutation.

Each finding is exactly `disposition, evidence, findingId`.
`findingId:Id` is an immutable module-assigned key scoped to this packet and
the brief's module descriptor. Findings must be strictly ascending ASCII
`findingId` order, hence unique. A repeated key with changed finding bytes
within that scope is conflicting evidence, not a replacement of an old block;
cross-attempt stability/conflict admission belongs to the later history owner.
`disposition` is exactly `code, moduleDescriptorDigest`: `code` matches
`[a-z][a-z0-9._:-]{0,63}`; `moduleDescriptorDigest:Digest` must equal the
request brief's `action.moduleDescriptorDigest` on binding. The code is an
opaque bounded lookup key owned by that reviewed module, never engine repair/
replan vocabulary, free prose, an arbitrary payload, or a dynamic loader.
The later module ledger must declare/admit its finite disposition-code census;
no descriptor field or runtime dispatch behavior is guessed here.

Finding `evidence` is exactly `expected, observed, procedure`, each one
retained-content reference. The bytes bind the expected requirement/result,
actual reproduced observation, and reproduction procedure respectively for
this exact target. Hash-shaped strings alone do not prove reproduction; the
later admitted reviewer/evidence owner verifies these bytes and their relation.
The packet/report content lists and this three-reference record are distinct
shapes; substituting one for the other refuses. Optional advisory findings,
including ISS-039 simplification advice, remain module-owned non-blocking
telemetry outside these authority records. They cannot change a result kind.

Step 9's stable observation/materialization owner produces the record from
the actual review attempt and retained output; worker bytes cannot declare
the enclosing attempt/launch/terminal identities trusted. `MALFORMED` is a
valid capture of invalid worker output, not permission to repair or admit a
malformed `review-attempt-result/v1` record. Missing/unreadable/contradictory
launch or terminal evidence cannot be replaced by a fabricated digest: no
usable attempt result exists, and later reduction remains unknown. Pre-launch
refusal follows the existing dispatch/skip path, not a synthetic review attempt.

#### Claimed authority record and complete unknown arm

`review-authority/v1` has exactly
`outcome, packetDigest, requestDigest, schemaVersion, subjectDigest`.
The three digest members are `Digest` of that exact packet, request and
concrete subject; `schemaVersion` is literal `review-authority/v1`.
`outcome` is exactly one of these closed records:

| `outcome.kind` | Complete member census and rules |
| --- | --- |
| `accepted` | `attemptResultDigest, kind`; non-null `Digest` of an exact bound `SWEEP_COMPLETE` result |
| `rejected` | `attemptResultDigest, kind`; non-null `Digest` of an exact bound `BLOCKED` result including every finding |
| `unknown` | `attemptResultDigest, evidence, kind, reason`; nullable result reference as below; `evidence` is content list 1–256 of retained diagnostic observations |

No uppercase lifecycle state, fourth verdict, copied findings, caller
completeness flag, issuer assertion, signature-shaped string, or promotion
permission is admitted. The unknown arm's exact reason/nullability census is:

| `reason` | `attemptResultDigest` | Meaning of the retained diagnostic evidence |
| --- | --- | --- |
| `RESULT_UNAVAILABLE` | null | No readable attempt result available |
| `RESULT_INVALID` | null | Supplied result bytes fail parsing or request/target/packet binding |
| `RESULT_NONCOMPLETE` | non-null `Digest` | Exactly bound `INCOMPLETE`, `FAILED` or `MALFORMED` result |
| `HISTORY_UNPROVEN` | null | Missing, truncated, conflicting, future-version, or ambiguously ordered history; no row selected as authoritative |
| `INDEPENDENCE_UNPROVEN` | `Digest` or null | Later-cycle/actor/credential non-aliasing admission unavailable or failed |
| `TARGET_CHANGED` | `Digest` or null | Actual immutable target or required immediate materialization no longer matches |
| `EVIDENCE_UNPROVEN` | `Digest` or null | Any other missing, unauthenticated, stale, contradictory or mismatched required evidence join |

Every non-null reference names a structurally valid, exactly bound result;
invalid/unbound bytes can only be retained as diagnostic content, never
referenced as an admitted result. Null means no result selected, not an
assertion that none ever existed. More than one unresolved obligation may
exist; `reason` names one supported failure, with no priority rule or claim
that others passed. Diagnostic evidence must be an actual retained observation
of the problem, never a hash of asserted absence. If the request itself is
invalid or cannot be obtained, no bound authority record is fabricated;
the owning operation refuses with unknown authority through its failure path.

The stable reducer alone may issue an effective accepted/rejected receipt
after every admission below. A supplied literal of either kind remains only
a claimed record. Unknown grants nothing even when its shape is valid.
This group defines no provenance proof for the authority producer, history
commitment, signing key, selected current receipt, or runtime issuance API.

#### Canonical identities, exact supplied relations, and deferred admission

`DreviewRequest`, `DreviewAttempt`, and `DreviewAuthority` each hash exactly
`UTF8("orchestration-platform") || 00 || UTF8(domain) || 00 || u32be(1) ||
07 || u64be(byteLength(C(record))) || C(record)`. The respective domains are
`review-request/v1`, `review-attempt-result/v1`, and `review-authority/v1`.
These are one canonical-record part including LF, with no field-wise/raw-32
parts. Generic serialization returns canonical bytes and that framed digest.
Nested records hash in place; none embeds its own digest. `Dpacket` remains
the explicitly unframed inline hash above, not a fourth family.

A later pure supplied-record relation takes exactly the tuple
`(request, attemptResult|null, authority)`, parses every supplied record, and
recomputes identities from those actual detached values. Require all three
authority references to equal the request's derived request/packet/subject
identities. Require null attempt input iff `outcome.attemptResultDigest` is
null; otherwise recompute `DreviewAttempt` and require equality. For any
non-null result, require its request/packet/subject references to equal those
same derived identities, `cycleId = request.reviewCycleId`, and, for a worker
subject, `attemptId != subject.authorAttemptId`. Require every finding's
module descriptor equality above. Apply the accepted/rejected/noncomplete
kind matrix; other unknown reasons permit any of the five bound result kinds.
Absent/malformed/substituted input or any mismatch refuses the relation.
This optional later relation checks supplied structure only, not history
completeness, authenticity, chronology, stable issuance, or live authority.

Before real use, ISS-008/005/009/026 must obtain actual plan, launch, terminal,
cycle and retained output evidence and recompute each owning identity. The
step-7 plan must prebind this request, packet, concrete target, review cycle
and attempt, with role `review`; the action core and packet brief must equal
the actual admitted core/brief, and installed host/rendered-byte bindings must
pass unchanged. Those owners must close their literal evidence fields before
such joins can run. A record echoing expected digests supplies no preimage.

The graph is subject/packet/request, then dispatch plan, launch and terminal
observation, then review-attempt result, then authority and disposition.
The terminal receipt must not include the downstream review-attempt digest;
later step-9 composition binds both. Neither request nor packet depends on its
dispatch plan or result. Actual role/credential/actor evidence must prove
reviewer independence and a distinct later cycle, with no attempt reuse across
requests or targets; replay may observe the same bound attempt. UUID
inequality/order and worker-host artifact identity cannot prove actors
are independent. Candidate admission uses real build/assembly/certification
producer identities, never a fabricated author attempt.

ISS-009 and history owners still owe a closed complete-history input census,
authenticated beginning/end, ordering, duplicate/conflict/reuse rules and
discovery of all relevant attempts, requests and supersessions. No latest-row
selection, UUID sorting, caller completeness Boolean, or this tuple relation
closes that obligation. Full stable reduction remains parked until those
inputs and actual identity/provenance sources have reviewed contracts.
Request/subject content and finding/report/diagnostic bytes must be obtained,
length/hash verified and semantically admitted by their actual owners.
Unavailable or contradictory joins yield unknown, never fixture acceptance.

Optional code-host materialization still proves identical retained target
immediately before reduction and mutation. Worker review cannot become
candidate authority. Existing external review, authenticated certification,
stable promotion and current authority gates remain unchanged; this packet
adds no account or provider-review requirement. Internal exact-head review
does not substitute for required external authority.

#### Required future vectors and bounded implementation prediction

| Acceptance / removal attack | Discriminating evidence after independent review |
| --- | --- |
| Complete shapes | Valid requests for TREE, ordered worker and candidate targets; all five result kinds, both decided outcomes, and every unknown reason/nullability row; deleting/adding/renaming/type-changing every nested member, cross-arm fields, future schemas and hostile records/arrays refuse |
| Bytes and identities | Independently pinned canonical bytes, full frame hex and expected digest for each family/arm plus inline packet hash; insertion order equivalent, persisted noncanonical bytes refuse; wrong domain/tag/count, LF, untagged family hash or framed packet differs/refuses |
| Content and finding bounds | Packet lists 0/256, other lists 1/256 and findings 1/256 succeed; below/above bounds refuse; decimal zero/max succeed, padded/negative/unsafe values refuse; repeated content retained, reordered distinct references change identity; duplicate/unsorted finding IDs refuse |
| Supplied target chain | Independently substitute each request, concrete subject arm, packet brief/input, cycle, attempt, authority/result digest and finding module descriptor; each mismatch refuses; same author attempt/cycle refuses while candidate needs no author field |
| Result/authority separation | Complete sweep binds accepted and block binds rejected; swap either to another kind or noncomplete reason to a complete kind and refuse; malformed worker capture parses, malformed enclosing record refuses; null result with decided outcome or non-null result with null-only reason refuses |
| Actual joins, later owners | Replace each retained byte/length, plan/core/brief/rendered input, launch, terminal, identity or provenance source independently; remove the corresponding equality/admission and require its discriminator to fail |
| History and stable gates, later owners | Truncated/missing/forked/future/duplicate/conflicting/reordered history, reused attempt, aliased reviewer, earlier review cycle, moved materialization, worker-to-candidate reuse and candidate self-review never grant authority |

Prediction: three total record parsers, their inline unions, three framed
identities, the inline packet hash and focused structural vectors suffice;
the optional supplied-record relation adds only the exact comparisons above.
Coordinated forged records may satisfy structure but never prove issuance.
Each implemented equality requires its own removal mutant. Runtime tests
cannot be replaced by these shape vectors or a supplied accepted record.
The footprint here is this subsection and ISS-002's additive note only; no
tests, build, probe or executed acceptance is claimed. Host verification and
independent exact-head review remain required. Journal/replay/terminal,
dispatch/process/module/reclaim/disposition and identity/history issuance
contracts remain separate; ISS-002's addition and ISS-041 are not complete.

### Fifth complete literal group proposal: portable module structures

This packet proposes the five module census names only. It is an explicit
bounded ABI replan, subject to independent review before implementation.
The existing fixture already consumes admitted configuration, snapshot and
current-policy facts and produces a real action core and brief; its inline
descriptor is not a public descriptor or installed module. Replacing those
fixture seams with closed supplied records is useful without inventing a
breaker receipt, history, registry, runtime invocation or complete cycle.

#### Explicit replan and unchanged authority boundary

The ABI's undefined "canonical reduced facts" input is replaced here with
actual complete ISS-013 project observations, named as such, plus their actual
configuration and provenance. They are not `reduced-state/v1`. Its undefined
"adapter policy digest" is replaced with the existing exact policy tuple
`(adapterId, adapterVersion, policyVersion)` and the complete observed policy
fact record. The fact digest identifies an observation, never policy code.
Compatibility "ranges" mean the finite exact-version tuples below, not a new
range interpreter; this deliberately narrows the earlier summary. Host
compatibility uses the existing worker capability/renderer contracts, without
inventing host version fields. These choices require approval as replans,
not inference from the earlier ABI prose.

The ordinary planner receives the full configured capability census, not a
caller-asserted permitted subset. Neither COMPLETE nor NO_TRIP grants a
capability or overrides TRIP or prior holds. Actual routine invocation still
requires step 3's current authenticated breaker reduction, exact session,
adapter-authorized module choice, and installed static registry admission.
Result use must also pass that actual capability gate. None is encoded by a
Boolean, empty history, copied digest or parsed descriptor here. Missing
authority remains fail-closed; the quarantined observer fixture is not an
exception permitting routine execution. Production manifest/generator/loading,
breaker/history/recovery, routing and effect owners remain unchanged.

#### Shared scalars and complete descriptor

Reuse `C, Uuid, Digest, Id` above and ISS-013's `Name, Version` without
widening them. `Name` is also the finding-disposition code grammar
`[a-z][a-z0-9._:-]{0,63}`. Newly declared members are required and non-null
except the three explicit outer null cells below. Reused contracts retain
all their existing nullability, including an ABSENT OPERATOR_ACTION directive's
`code:null`. Every listed field sequence is canonical key
order. Closed detached record/array rules apply recursively. Counts include
both endpoints; tuple ordering is lexicographic comparison of the named ASCII
strings, never numeric version ordering. Unknown fields, arms, versions,
symbols, accessors, proxies, holes and exotic values refuse without input code.

`module-descriptor/v1` has exactly:

| Member | Complete rule |
| --- | --- |
| `abi` | literal `orchestration-module/v1` |
| `actions` | dense 1–256 action rows below; strictly sorted by `(actionKind, capabilityName)`, hence unique by that pair |
| `compatibility` | dense 1–256 compatibility rows below; strictly sorted by `(adapterId, adapterVersion, engineVersion, policyVersion)`, hence unique |
| `dispatchCatalog` | existing complete dense 1–256 catalog; preserve order; exact existing resolver-key uniqueness and row rules |
| `dispositionCodes` | dense 0–256 `Name` strings, strictly ASCII sorted and unique; empty declares no blocking disposition code |
| `inputSchemas` | exactly `["module-plan-input/v1"]` |
| `moduleId` | `Id` |
| `moduleVersion` | `Version` |
| `outputSchemas` | exactly `["module-action-plan/v1","module-no-action/v1"]` |
| `schemaVersion` | literal `module-descriptor/v1` |

Each compatibility row is exactly
`adapterId, adapterVersion, engineVersion, policyVersion`: `Id` followed by
three `Version` strings. Rows enumerate supported whole tuples; components
from different rows cannot be combined. These are descriptor claims, not a
policy implementation selector or evidence that installed code matches them.
The fixed input/output schemas and their complete nested v1 contracts close
schema compatibility; arbitrary schema IDs, fallback versions and payloads
are absent. All declared lookup values retain the existing vocabulary checks.

Each action row is exactly
`actionKind, capabilityName, requestedRole, reviewRequired, workerRequired`.
The first two are `Name`; role is the unchanged
`implementation|review|observer`; the last two are literal Booleans:

| `workerRequired` | `requestedRole` | `reviewRequired` |
| --- | --- | --- |
| true | implementation or observer | true or false |
| true | review | false |
| false | observer | false |

No other cell is valid. In the no-worker cell, observer is the least-authority
requested-role value in the unchanged mandatory action core; it does not
assert a worker exists. The cell requires explicit downstream skips, never a
synthetic launch. A review action already performs review; its false flag
does not authorize skipping that review or promoting an unreviewed candidate.

Project `actions` to exact `{actionKind,capabilityName}` pairs for rows with
`workerRequired:true`; require equality with the catalog's distinct pair
projection under the existing catalog validator. There is no second copied
worker-pair array. Catalog bounds remain 1–256, so at least one worker pair
must exist even if other declared actions are workerless; this proposal does
not silently permit an empty-catalog, workerless-only descriptor. Required
capability names are the distinct projection of all action rows. Host
compatibility for worker actions requires the same capability in an admitted
existing worker-host identity and exact renderer coverage for this catalog;
actual host selection and installed artifact proof remain the routing owner.

A code in `dispositionCodes` has only module-owned lookup meaning. When the
later review owner admits a blocking finding, its code must be in this exact
descriptor's list and its module descriptor digest must equal this descriptor's
computed identity. No engine repair/replan enumeration, dynamic loader or
interpretation of retained procedure bytes is introduced.

#### One complete module input

`module-plan-input/v1` has exactly these eight members:

| Member | Complete rule |
| --- | --- |
| `adapterConfiguration` | existing complete `adapter-configuration/v1` |
| `configurationProvenance` | existing complete `configuration-provenance/v1` |
| `cycleRequest` | existing complete `cycle-request/v1`, including its session request |
| `descriptor` | complete descriptor above, not an expected digest |
| `policyFacts` | existing `project-breaker-facts/v1`, restricted to COMPLETE |
| `projectFacts` | existing `project-facts/v1`, restricted to COMPLETE |
| `reviewSubject` | null for ordinary frontier planning; otherwise one complete existing concrete worker-result or release-candidate subject |
| `schemaVersion` | literal `module-plan-input/v1` |

Input parsing performs the existing configuration/provenance equality,
project-facts/configuration binding and policy-facts/configuration/snapshot
binding, recomputing actual `Dconfig, Dsnapshot, Dfrontier`. Policy decisions
must cover exactly the full configuration capability census; their TRIP values
are retained unchanged. Require `cycleRequest.adapterId` equal the actual
configuration adapter; require its nested
`sessionRequest.configurationProvenanceDigest = SHA256(C(configurationProvenance))`.
Other session-request configuration preimages and real lease/currentness
remain the session owner; their digests are not reinterpreted here.

Require one descriptor compatibility row equal the actual configuration's
adapter ID/version and engine version plus `policyFacts.policyVersion`.
Require its module ID in `cycleRequest.allowedModuleIds` and all its required
capabilities in the configuration census. Those comparisons prove supplied
intent/compatibility only. Empty allowed modules refuses this input. Actual
loaded descriptor equality and adapter module authorization remain external.

For a non-null review subject, require `cycleRequest.cycleId` distinct from
its author cycle or candidate assembly cycle, exactly as for review requests.
This added existing-subject slot is necessary to carry a later review target;
a frontier digest cannot replace it. Its actual follow-up provenance and
independent reviewer admission remain the existing later owners. There is no
new follow-up family or fabricated candidate author attempt. Ordinary input
contains no review target, and no input embeds its own digest or a plan result.

#### Complete action, no-action and typed refusal results

`module-action-plan/v1` has exactly
`actionCore, dispatchBrief, inputDigest, schemaVersion, workId`.
`actionCore` is the unchanged complete `dispatch-action-core/v1`;
`inputDigest:Digest` references the exact complete input; `schemaVersion`
is literal `module-action-plan/v1`. `dispatchBrief` is null or an existing
complete `dispatch-brief/v1`; `workId` is null or `Uuid`.

Intrinsic parsing requires null brief only with core role observer. Every
non-null brief must equal the core's action kind, capability, immutable
subject, descriptor digest and designated action-core digest, and its role
must equal requestedRole; existing brief directive/subject rules also apply.
No rendered bytes, host/route, dispatch, launch, result, authority, mutation,
advisory prose or output self-digest appears.

`module-no-action/v1` has exactly
`inputDigest, outcome, reason, schemaVersion`. The input reference is non-null
`Digest`; schema is literal `module-no-action/v1`; only these cells exist:

| `outcome` | `reason` | Claimed result |
| --- | --- | --- |
| NO_ACTION | NO_ELIGIBLE_ACTION | This module found no eligible action in the supplied input |
| REFUSED | INPUT_REFUSED | Valid structural input was not usable by the module's reviewed planning rules |
| REFUSED | PLANNING_FAILED | The module reports known inability to produce a valid plan |

This is an explicit naming choice: the no-action family contains both normal
absence of an action and typed refusal; they are never equivalent terminal
outcomes. It closes all three required result cases without adding a sixth
schema. None asserts a complete history, clearance, resource reclamation or
successful cycle. Malformed/unobtainable input cannot yield a fabricated
input digest or bound refusal; the owning caller uses its existing failure
path. A thrown call or malformed return is not silently repaired into one of
these literals. No outcome/reason is nullable.

`module-plan-result/v1` is the wrapper-free union of those two concrete
families, with action, no-action and both refusal cells above. Its public union
parser, canonical byte parser and serializer dispatch solely on the concrete
`schemaVersion`, return/persist that same concrete value, and use its identity.
No record is tagged `module-plan-result/v1`; no wrapper, generic payload,
union digest or separate registry persistence row exists. Future/unknown arms
refuse. Concrete-family parsers refuse the opposite family.

#### Identities and exact supplied relations

Each of the four concrete families above has one identity:
`UTF8("orchestration-platform") || 00 || UTF8(schemaVersion) || 00 ||
u32be(1) || 07 || u64be(byteLength(C(record))) || C(record)`, hashed by SHA-256.
Generic serialization returns that canonical record and framed identity.
The union uses its concrete identity. Existing action-core, subject, snapshot,
configuration and policy-fact identities retain their designated functions;
in particular policy facts remain unframed observation content identities.
The graph is descriptor/configuration/observations/cycle/optional subject,
then input, then result; descriptor/catalog never reference downstream plans.

A pure supplied relation takes exactly `(input, result)`, parses both detached
values and requires `result.inputDigest = Dinput`. For an action additionally:

1. Require core `moduleDescriptorDigest = Ddescriptor`; find exactly one
   declared action/capability pair and require identical requested role.
2. Require core capability in the configured census. For workerRequired true,
   require a non-null brief and validate the complete existing core/brief/catalog
   binding against the descriptor's derived worker pairs. For workerRequired
   false, require observer role, reviewRequired false and null brief; do not
   invoke the non-null brief binder or fabricate a brief. Descriptor catalog/
   worker-pair validation and all core, action, target and capability bindings
   remain required in both cases.
3. If input reviewSubject is null, require non-null workId naming one actual
   READY frontier row, core capability in that row, and core subject equal
   that row's immutable subject. A review role refuses without a review subject.
4. If input reviewSubject is non-null, require null workId, review role and
   workerRequired true; core subject equals the concrete subject's designated
   digest. Worker-result and candidate targets never cross-bind.

No-action/refusal output has no action or target field. The relation does not
prove the module's reason or reproduce its planning algorithm. A result may
refer to well-formed invented facts and still satisfy structure; no freshness,
history, installed-source identity, reviewer independence, deterministic call,
effect isolation or runtime authority is thereby established. Runtime must
prove the exact descriptor and input used by its one invocation, current
breaker permission and all existing downstream gates before using any action.
Review-required flags retain their existing distinct later review behavior;
the false flag cannot relax operation-specific mandatory candidate review.

#### Required vectors, footprint and replan boundary

| Property / removal attack | Cheapest discriminating evidence after review |
| --- | --- |
| Complete structure | Every descriptor row/cell, ordinary and both review-subject inputs, worker/direct actions, no-action and both refusals; remove/add/rename/type-change every nested member; unknown versions, cross-arm fields, hostile arrays/records all refuse |
| Reused nulls and workerless binding | Ordinary worker action with ABSENT OPERATOR_ACTION code:null succeeds; preserve all reused null rules and mutate each of the three new outer null cells. Workerless action in a valid mixed descriptor succeeds with null brief; core/role/review-flag/brief-null mutants refuse without invoking a non-null brief binder |
| Canonical identity | Independently pinned bytes, complete frame hex and digest for four families/all result cells; union preserves concrete bytes/digest; insertion-order equivalence; noncanonical persisted bytes and wrong domain/tag/count/LF refuse or differ |
| Bounds and catalog | Every 0/1/256/257 applicable boundary; ordered/duplicate compatibility/action/code lists; exact schema arrays; existing catalog duplicate-key/accessor/template and pair-census mutants; no empty catalog exception |
| Input joins | Independently substitute config/provenance/project/snapshot metadata/frontier/policy version/decision census/cycle/module intent/compatibility component; actual scalar shapes remain valid and each removed equality has its own failing mutant |
| Output joins | Recompute outer result references when mutating descriptor/core/brief/row/work/capability/role/subject bindings; test both null cells, non-READY work, swapped review target and same subject cycle; delete each equality independently |
| Evidence versus authority | Both TRIP and NO_TRIP retain their factual values; structural acceptance never supplies breaker permission; no module invocation, registry admission, host loading, scheduling or mutation follows from a literal |
| Actual fixture continuation | After parser review/implementation, replace only its private descriptor/input/result seam and preserve both real SDK adapters, retained exact rows and canonical outputs; this is observer evidence, not completion of routine steps 3–4 |

Prediction: four concrete parsers, one union dispatcher, four framed identities
and one supplied-input/result relation suffice. No general resolver, expression
language, manifest generator, new schema, issue edge or owner is needed.
A required new authority source or contract outside this boundary is replan
evidence, not permission to expand it. Footprint is this subsection, the
ISS-002 additive note, the explicit ABI correction and round 381 only.
Independent exact-head review precedes implementation; the author claims no
tests, builds, probes, runtime acceptance or ISS-041 completion.

### Sixth literal group proposal: breaker checkpoints and recovery observations

This bounded proposal closes only `breaker-receipt/v1`, the existing step-3
census name. It explicitly replans the underspecified breaker instance,
transition, recovery-input and history boundaries; independent review precedes
implementation. Per-capability checkpoints inside one project receipt are the
smallest match for the existing complete capability decision census. No new
public family, production reducer, SDK callback, probe, journal or authority
is delivered. The first consumer remains the quarantined fresh-root fixture.

#### Model, history boundary and explicit replans

The five known states apply separately to each configured capability.
UNKNOWN is a whole-reduction result: every capability is blocked, including
unreadable historical scope. It retains the exact readable predecessor by
reference, never replaces its holds with an empty successful census. This is
a representation of the existing sixth state, not a new recovery state.
All configuration or policy-identity changes become UNKNOWN; this conservative
boundary deliberately defines no migration/reset path. A removed capability
cannot disappear from retained evidence. Policy migration remains external
diagnosis and separately reviewed future work, not an inferred CLOSED edge.

Each new checkpoint advances at most one recovery phase per capability and
uses a distinct cycle from its predecessor. This makes interruption/replay
unambiguous for the current consumer: a resume re-observes the same immutable
receipt from its original inputs; it does not allocate another transaction,
probe or step output. RECOVERY_PENDING and PROBE_IN_FLIGHT remain held between
cycles. CLOSED_RECOVERED is retained recovery evidence; ordinary capability
use waits for the next cycle's fresh policy evaluation and CLOSED checkpoint.

The actual public journal prefix selects the predecessor; selected facts and
that predecessor produce a receipt; a later `orchestration-event/v1` carries
that receipt. The receipt never names its own enclosing event or self digest.
There is no private history array, second history family or history-complete
Boolean. The later complete event/journal union must carry these exact closed
receipts and operation observations, prove beginning/current end and discover
all transaction/probe reuse. This packet adds no partial event parser.

Null predecessor is a claimed initial checkpoint, not absence authority.
Only the quarantined fixture's actual exclusive creation of a previously absent
disposable root, lease ownership and retained initial file census may admit
its first genesis observation. A caller's null, empty array, GENESIS token or
hash of asserted absence is insufficient. Reuse/nonempty-root controls must
refuse; resume cannot create a replacement root or select genesis again.
Production root creation never erases project holds. Production genesis,
history selection/currentness and reset remain unavailable through this packet.

#### Scalars and complete receipt envelope

Reuse `C, Uuid, Digest, Id, Time, Name, Version` and all existing detached rules.
Every newly listed member is required and non-null except priorReceiptDigest;
reused public records retain their own nullability. Field sequences are
canonical key order; arrays are dense. Unknown/extra/future members or arms,
wrong types, hostile records/arrays and noncanonical persisted bytes refuse.

`breaker-receipt/v1` has exactly:

| Member | Rule |
| --- | --- |
| `adapterConfigurationDigest` | Existing unframed `Dconfig` of actual adapter configuration |
| `cycleId` | `Uuid` of the reduction cycle |
| `cycleRequestDigest` | Existing designated identity of the actual complete cycle request |
| `operations` | 0–256 closed operation rows below, strictly ASCII sorted and unique by capabilityName |
| `policyFactsDigest` | Existing unframed identity of actual `project-breaker-facts/v1`, including failure arms |
| `policyIdentity` | Exactly `adapterId, adapterVersion, policyVersion`: existing `Id, Version, Version`; tuple identity, not a digest or selector |
| `priorReceiptDigest` | Null when no readable predecessor is selected; otherwise `Digest` of the actual parsed preceding breaker receipt |
| `result` | One complete result arm below |
| `schemaVersion` | Literal `breaker-receipt/v1` |
| `sessionId` | `Uuid`, equal to the cycle request's nested session ID |

KNOWN result is exactly `capabilities, kind`, with literal kind `KNOWN`
and 0–256 checkpoint rows, strictly ASCII sorted and unique by capabilityName.
Its name census equals the actual configuration census. UNKNOWN result is
exactly `blockedCapabilityNames, kind, reason`: literal kind `UNKNOWN`,
0–512 strictly sorted unique Names, and one reason from the matrix below.
The names are the union of current configured names and all names in a
readable KNOWN predecessor. They are the known affected names, not a claim
that unreadable history has no others; UNKNOWN globally prevents step 4.
With no readable predecessor only the current names can be enumerated.
No fresh receipt binds an UNKNOWN predecessor: retain that terminal unknown
and use the existing failure path until separately admitted diagnosis.

Checkpoint rows contain exactly the members for their state:

| State | Complete member census |
| --- | --- |
| CLOSED | `capabilityName, state` |
| OPEN | `capabilityName, opening, state` |
| RECOVERY_PENDING | `capabilityName, opening, recovery, state` |
| PROBE_IN_FLIGHT | `capabilityName, opening, probe, recovery, state` |
| CLOSED_RECOVERED | `capabilityName, completion, opening, probe, recovery, state` |

capabilityName is `Name`; state is its exact table literal. Opposite-state
members are absent, not null. Opening is exactly
`cycleRequestDigest, policyFactsDigest`, both Digests. A new opening copies
the actual current envelope identities for a TRIP decision on that capability.
Its identical bytes survive OPEN and both recovery states, failed probes,
and CLOSED_RECOVERED. It is not a hash of an asserted opening or a self-reference.
The birth receipt and its actual policy preimages remain discoverable through
the later selected public history, never inferred from these two strings.

#### Closed operations and paired ISS-013 observation literals

Each operation is exactly `capabilityName, kind, observation`; its name is
configured, and at most one operation names a capability in a receipt.
kind is `REQUEST_RECOVERY|START_PROBE|FINISH_PROBE`; observation is the
corresponding complete record below. No operation means retain/evaluate by
the transition table, not an omitted history event or permission.

REQUEST_RECOVERY observation is exactly
`adapterConfigurationDigest, capabilityName, decision, observationId,
observedAt, openReceiptDigest, policyIdentity, projectFactsDigest, transactionId`.
Digests use existing identities; names/time/UUIDs and policyIdentity use the
rules above. decision is `ALLOW_RECOVERY|KEEP_HOLD|UNAVAILABLE|UNKNOWN`.
A successful permission observation is itself the complete inline recovery
transaction evidence: the checkpoint's recovery is this unchanged record with
decision ALLOW_RECOVERY. No separate transaction schema or copied wrapper exists.
`Drecovery = SHA256(C(recovery))` identifies those exact inline bytes only.

ISS-013 owns this project observation and its later source/policy admission.
Its closed in-process request is exactly
`adapterConfiguration, capabilityName, observationId, openReceipt,
policyIdentity, projectFacts, transactionId`, using complete existing public
records and this receipt family; openReceipt must be a KNOWN receipt with an
OPEN row for the requested capability. The response is the complete observation
above. Every response, including UNAVAILABLE/UNKNOWN, binds the request ID,
transaction, capability, policy tuple, actual open-receipt identity and
recomputed configuration/snapshot identities. observedAt records the actual
observation; its observationId differs from snapshot/current-policy observation
IDs. Missing, malformed, substituted or unavailable source evidence cannot be
repaired into permission.

This defines data, not callback execution or a new public family. The future
SDK owner must statically bind a reviewed adapter/policy implementation, obtain
a fresh current source observation for that exact request and semantically
admit its response. Existing trip-only fixture policies do not acquire recovery
semantics by keeping their version. Adding/changing recovery or probe semantics
requires reviewed policy source and an appropriate policy-version change.
NO_TRIP is never converted to ALLOW_RECOVERY. No predicate, threshold,
loader, provider algorithm or current-policy record extension is invented here.

START_PROBE observation is exactly `probeId, recoveryDigest, startedAt`:
Uuid, Digest and Time. FINISH_PROBE observation is exactly
`finishedAt, outcome, probeId, recoveryDigest, startedAt`; outcome is
`SUCCEEDED|FAILED|UNKNOWN`, with the same other scalars and Time finishedAt.
Require inclusive startedAt <= finishedAt. Probe IDs identify the actual one
probe under the exact transaction; recoveryDigest equals actual Drecovery.
The checkpoint's probe and completion retain those exact observed records.

Intrinsic parsing requires every checkpoint recovery to have ALLOW_RECOVERY
and its containing capabilityName. Its probe recoveryDigest must equal the
actual inline Drecovery; a CLOSED_RECOVERED completion must be SUCCEEDED and
copy its probe ID, recoveryDigest and startedAt. Operations retain their actual
observations; cross-input/phase mismatches are handled by the supplied relation,
not repaired during parsing. These checks require no history or source lookup.

The generic recovery owner captures actual start/completion evidence and checks
it against the actual adapter-defined probe invocation. SUCCESS cannot come
from a caller's desired outcome or from the permission observation. Actual
probe semantics/source provenance, one-call execution, interruption and terminal
observation remain their owners' runtime obligations. No process, credential,
executable instruction or second probe is supplied by these JSON records.
A missing/unreadable completion is unknown authority, never fabricated success.

#### Exact supplied tuple, transition and refusal matrix

The pure supplied relation takes exactly
`(configurationProvenance, adapterConfiguration, cycleRequest, projectFacts,
policyFacts, priorReceipt|null, receipt)`. Parse every record; malformed input
refuses the operation rather than fabricating a bound receipt. Project facts
must be COMPLETE (otherwise step 2 already terminalizes). Reuse configuration/
provenance, project/configuration and complete policy/configuration/snapshot
validators unchanged, including policy observation distinction and exact
capability coverage. A policy failure arm is retained, not an empty decision list.

Require actual config/project/policy identities and tuple components to equal
the receipt references. Bind receipt cycle/session to the complete request;
bind its adapter and nested provenance digest to the supplied configuration/
provenance, exactly as for module input. Recompute priorReceiptDigest from the
actual selected parsed predecessor, or require null for null input.
Actual predecessor selection, authentic genesis, source freshness and complete
history cannot be proved by this tuple. A known transition below is only a
structural claim until those external obligations pass.

For any readable prior, require new cycleId != prior.cycleId. Same original
inputs may reproduce the same receipt; a newly allocated same-cycle receipt
refuses. Compare current Dconfig and the full policy tuple with the KNOWN prior.
Only equal configuration/policy and COMPLETE current facts permit KNOWN output.
For each current capability, apply exactly one row below; any invalid operation
or unresolved observation makes the whole result UNKNOWN, never partial KNOWN.

| Prior checkpoint | Current input/operation | Exact next checkpoint |
| --- | --- | --- |
| No predecessor, externally admitted initial history | COMPLETE policy, no operations | NO_TRIP → CLOSED; TRIP → new OPEN |
| CLOSED | no operation | NO_TRIP → CLOSED; TRIP → new OPEN |
| OPEN | no operation | same OPEN under either trip value |
| OPEN | REQUEST_RECOVERY, ALLOW_RECOVERY | RECOVERY_PENDING, preserving opening and adding exact recovery observation |
| OPEN | REQUEST_RECOVERY, KEEP_HOLD | same OPEN |
| RECOVERY_PENDING | no operation | same RECOVERY_PENDING |
| RECOVERY_PENDING | START_PROBE | PROBE_IN_FLIGHT with unchanged opening/recovery and exact start observation |
| PROBE_IN_FLIGHT | no operation | same PROBE_IN_FLIGHT; hold retained, not probe restart |
| PROBE_IN_FLIGHT | FINISH_PROBE, SUCCEEDED | CLOSED_RECOVERED with unchanged opening/recovery/probe and exact completion |
| PROBE_IN_FLIGHT | FINISH_PROBE, FAILED | OPEN with unchanged opening; failed completion remains in operations/history |
| CLOSED_RECOVERED | next cycle, no operation | fresh NO_TRIP → CLOSED; fresh TRIP → new OPEN |
| UNKNOWN predecessor | any fresh request | no new receipt or clearance; retain existing UNKNOWN and fail closed |
| Any unlisted state/operation pair | structurally valid but wrong-phase input | UNKNOWN / INVALID_TRANSITION |

Current TRIP/NO_TRIP never clears OPEN or either recovery state. Recovery
permission/probe success are independent adapter-owned evidence; a completed
recovery still waits for the next cycle's fresh policy before ordinary use.
Within KNOWN, only CLOSED rows may supply the step-3 permitted set; all other
rows remain unavailable to ordinary action selection in this packet.

REQUEST_RECOVERY must name the exact prior OPEN receipt and same capability,
current Dconfig, policy tuple and Dsnapshot; its transaction is stable and
must not be reused from another recovery under the later complete history.
START_PROBE binds the prior recovery's actual Drecovery and has
startedAt >= recovery.observedAt. FINISH_PROBE exactly preserves the prior
probe's ID, recoveryDigest and startedAt and has finishedAt >= startedAt.
Retained checkpoint members must be byte-identical canonical values. History
must separately refuse any non-adjacent transaction/probe reuse, fork, truncation
or conflicting replay; local UUID inequality cannot prove those properties.

UNKNOWN reasons are exactly the following. If several supplied failures apply,
use the first applicable structural row in this order; external missing-history
admission takes precedence. A claimed external reason must be supported by the
actual owner before any use; the pure parser cannot authenticate it.

| Reason | Condition / retained effect |
| --- | --- |
| HISTORY_UNPROVEN | No admitted initial/selected current prefix, unreadable/contradictory history or missing actual predecessor; no selected predecessor may be invented |
| CONFIGURATION_CHANGED | Actual Dconfig differs from readable KNOWN predecessor; retain predecessor including removed capabilities |
| POLICY_CHANGED | Full policy tuple differs from readable KNOWN predecessor |
| INPUT_UNAVAILABLE | Existing current-policy arm UNAVAILABLE |
| INPUT_UNKNOWN | Existing current-policy arm UNKNOWN |
| INVALID_TRANSITION | Wrong phase/capability, mismatched operation joins, cross-record causal time mismatch or any unlisted transition |
| RECOVERY_UNAVAILABLE | Correctly bound permission observation decision UNAVAILABLE |
| RECOVERY_UNKNOWN | Correctly bound permission observation decision UNKNOWN |
| PROBE_UNKNOWN | Correctly bound completion outcome UNKNOWN, or actual probe evidence admission unavailable |

All new receipt fields still require valid scalar/record shape. Invalid
enclosing records refuse parsing; UNKNOWN is not permission to admit malformed
JSON, replace failed joins with expected hashes or issue a terminal probe.
A non-null predecessor reference always names an actual parsed supplied
receipt. If it is unavailable, only HISTORY_UNPROVEN with null reference and
the current known capability census is constructible; global UNKNOWN retains
the unresolved hold obligation rather than certifying historical absence.

#### Evidence, footprint and proportionality

Required future vectors cover every state/transition/reason and cross-arm null/
field mutant, 0/1/256/257 bounds (UNKNOWN union additionally 512/513), sorted/
duplicate capability/operation censuses, exact config and all policy components,
opening persistence, failed and contradictory probes, actual-preimage/digest
substitution, two recovered-next-cycle trip outcomes, non-adjacent reuse,
and changed config that removes a held capability. Independently pin canonical
bytes/full frames/digests for all receipt arms. Replaying a proper prefix cannot
stand in for authenticated current-end evidence. Each implemented equality
gets a removal mutant; actual fresh-root and re-entry guards get real fixture
controls after separate implementation review.

Dreceipt is SHA-256 of the existing one-canonical-record frame with domain
`breaker-receipt/v1`, including final LF. Inline operations/checkpoints hash
in place; Drecovery alone is the explicit unframed inline identity. No receipt
can certify its own history, producer, fresh source, recovery or live authority.
The expected first increment is a complete shape/parser plus exact supplied
transition comparisons; the fixture initially uses only actual fresh-root
genesis. Recovery execution and complete public event/replay remain gated.

Footprint is this ledger, the minimal lifecycle clarification, bounded
ISS-002/013/025 ownership notes and round 387. No code, manifests, CLI, new
family/issue/edge, provider/probe, authority grant or ISS-041 completion.
This explicit per-capability/fail-closed model avoids a policy interpreter and
a second history mechanism. If complete closure needs another public family or
runtime authority source, stop and replan rather than broaden this packet.
Independent exact-head review and host document verification precede code;
the author claims no verifier, test, build, probe or self-PASS.

### Route selection literal proposal and workerless amendment (ISS-002)

This bounded prerequisite closes only the existing `route-selection/v1`
census family. Its registered consumer is ISS-041's active module-input/action
observer continuation, followed by a supplied-host-mapping handoff. It does
not implement ISS-012 routing, installed host admission or a routine cycle.
Independent exact-head review precedes parser implementation.

#### Explicit workerless amendment and record census

The old unconditional selected-host requirement conflicts with the admitted
module action whose `workerRequired` is false. This amendment restricts that
requirement to selected worker routes and adds the terminal `NO_WORKER` arm.
Step 5 still executes, then step 6 still preflights the same action/subject.
The existing declared workerless skips at 7–10 remain mandatory. No new skip
at 5, synthetic worker, host identity, launch or accepted review is introduced.

Reuse `C`, `Digest` and detached closed-record rules above; `Digest` is exactly
64 lowercase hexadecimal characters. Every newly listed member is required;
null is allowed only for `hostMappingDigest` in the specified arms. Every
listed member sequence is canonical key order. Unknown/extra/omitted members,
versions, enum cells, symbols, accessors, proxies and exotic values refuse
without running input code. `route-selection/v1` has exactly four members:

| Member | Exact rule |
| --- | --- |
| `actionPlanDigest` | Non-null designated identity of the actual complete `module-action-plan/v1` |
| `hostMappingDigest` | Non-null `Digest` of the complete ordered supplied mapping, or null per the matrix below |
| `outcome` | Exactly one closed inline arm below |
| `schemaVersion` | Literal `route-selection/v1` |

The complete outcome/nullability matrix is:

| `outcome.kind` | Complete outcome members and literals | `hostMappingDigest` |
| --- | --- | --- |
| `SELECTED` | `kind, workerHostIdentityDigest`; non-null `Digest` | Non-null |
| `REFUSED` | `kind, reason`; reason exactly `NO_SUPPORTED_HOST` | Non-null |
| `UNKNOWN` | `kind, reason`; reason exactly `MAPPING_UNAVAILABLE` | Null |
| `UNKNOWN` | `kind, reason`; reason exactly `MAPPING_INVALID` | Null |
| `UNKNOWN` | `kind, reason`; reason exactly `ADMISSION_UNPROVEN` | Non-null |
| `NO_WORKER` | `kind` only | Null |

Branch-only members are absent, never null. Selected identity appears exactly
once, inside the selected arm. No other arm carries a host, artifact, provider,
model, selector, executable/path, credential or renderer proof. The route
copies no capability, role, subject, descriptor, cycle or configuration fields
already bound by the actual action plan and its input. There is no output
self-digest, arbitrary evidence payload, timestamp or completeness Boolean.

`MAPPING_UNAVAILABLE` reports no obtainable mapping observation. `MAPPING_INVALID`
reports a supplied observation refused by the existing total mapping parser;
it is not an admitted empty census. `ADMISSION_UNPROVEN` reports structurally
valid mapping bytes whose installed/current-release/artifact/renderer
admission is missing, stale, moved or contradictory. These are claimed
diagnostics; actual observations remain with their runtime owners. No arm
turns parser success or a diagnostic spelling into authority. Unobtainable or
invalid module input/action cannot yield a fabricated `actionPlanDigest`:
the owning caller uses its existing failure path without a route record.

#### Identities and exact supplied relation

`Dmapping = SHA256(C(mapping))` uses the actual complete ordered array of
`worker-host-renderer-artifact/v1` rows, including final LF. Preserve array
order; do not sort, filter, deduplicate or hash just the selected row. This is
one inline content commitment, not a new schema, manifest or identity domain.
Each row retains its existing artifact digest and designated worker-host
identity formula; no route-local rehash replaces that identity.

`Droute` hashes exactly
`UTF8("orchestration-platform") || 00 || UTF8("route-selection/v1") || 00 ||
u32be(1) || 07 || u64be(byteLength(C(route))) || C(route)`.
Generic serialization returns those canonical record bytes and `Droute`.
The graph is module input/action and supplied mapping, then route; none of
its inputs references the route. No union wrapper or additional digest exists.

One pure relation takes exactly `(moduleInput, actionPlan, mappingInput, route)`.
The first two must parse under their complete existing families and pass
`validateModulePlanBinding`; a no-action/refusal module result is not an action
plan and cannot enter step 5. Parse the route and recompute its plan reference
from the actual detached action plan. Derive the unique action declaration
and capability from that exact bound descriptor/core, never caller flags.

For `workerRequired:false`, require `NO_WORKER`, `mappingInput:null`, observer
role, `reviewRequired:false`, and the module relation's null brief. Perform
no host lookup; irrelevant mapping failure cannot block this route. Conversely
every other route arm requires `workerRequired:true`. `NO_WORKER` cannot be
used because a worker host or required observation is missing.

For worker-required arms, the following cases are exhaustive:

- `MAPPING_UNAVAILABLE`: require `mappingInput` exactly null, not undefined,
  an empty array or an asserted absence digest.
- `MAPPING_INVALID`: require non-null, non-undefined supplied input on which
  the existing `parseWorkerHostRendererArtifacts` total parser fails. Do not canonicalize
  or hash rejected input into `Dmapping`, repair rows or select a readable
  subset. The route remains a valid unknown diagnostic, not usable host facts.
- `SELECTED`, `REFUSED`, or `ADMISSION_UNPROVEN`: require the entire supplied
  mapping to pass that parser and require `hostMappingDigest = Dmapping`.
  Its existing 1–16 bound, unique identity keys, complete closed rows, sorted
  1–256 capability census and identity recomputation are unchanged. An empty
  mapping is invalid, never `NO_SUPPORTED_HOST`.
- For `SELECTED`, apply the existing `selectWorkerHostForCapability` relation
  to that whole mapping, the selected digest and the exact core capability.
  For `NO_SUPPORTED_HOST`, require zero rows whose capability census contains
  that exact case-sensitive capability. `ADMISSION_UNPROVEN` makes no host
  choice and asserts neither zero eligible rows nor a particular live defect.

All mismatches refuse the supplied relation. Passing it establishes supplied
structure/identity only, not completeness against installed state, currency,
renderer coverage, capability permission, a deterministic routing algorithm or
effective issuance. A fixture may choose its first compatible supplied row
deterministically; that fixture policy is not imposed by the public parser.
Provider/model evidence may refine ISS-012's later choice but never constructs
a host key or changes these joins; telemetry outages remain advisory.

#### Runtime owners, acceptance evidence and bounded footprint

ISS-021/045 own exact host package artifact bytes, compiled renderer tables
and fixed templates. ISS-020/014 own complete release-manifest membership,
install read-back and selected active-release binding. The supplied host row
contains no literal template coverage or installed proof. Those owners must
obtain and validate actual preimages before ISS-012 issues a usable selected
route or known no-supported-host refusal; coordinated forged rows can pass
this pure relation and grant nothing.
Missing currentness/admission stays unknown, never a known empty installation.

ISS-013 still owns step-6 preflight. For a selected worker route, ISS-008 must
freshly re-admit the same mapping/identity, executing artifact, requested/brief
role and exact rendered bytes before step-7 ownership publication. Steps 8–9
still require actual launch, process and terminal observations, plus the exact
review request/subject when applicable. The route cannot substitute for any
of those missing literals or producers, breaker permission or journal evidence.
Parsing `NO_WORKER` grants no preflight, mutation, reclamation or review skip
authority; only the actual admitted declared action permits the existing route.

| Acceptance/removal attack | Required future discriminating evidence |
| --- | --- |
| Complete shape | All six matrix rows, each required member/type/null cell, crossed arm members, future schema and hostile record/array refusals |
| Bytes and identities | Independently pinned canonical bytes/full frames/digests for every arm; insertion-order equivalence; noncanonical bytes, wrong domain/tag/count/LF and selected-row-only or reordered mapping commitments refuse/differ |
| Actual plan relation | Substitute module input, action plan, result family, descriptor/core role/capability or action identity independently; no copied expected digest replaces actual preimages |
| Complete host census | First/two-host selections; valid 1/16 and invalid 0/17 mappings; missing/extra/duplicate/case-substituted capabilities and coordinated host/artifact changes against the retained mapping fail the relevant join |
| Outcome separation | Unknown selected key, unsupported capability, supported row with no-host refusal, malformed/null/empty mapping exchanged between unknown arms, and valid mapping whose admission is unproven never fabricate selected authority |
| Workerless continuation | Mixed descriptor's declared workerless action produces `NO_WORKER` without host lookup; worker-required action, non-null mapping/brief or role substitution refuses; the future composition retains 5/6 then typed skips 7–10 |
| Authority boundary | Structurally coherent forged mapping may parse but supplies no installed/currentness/renderer proof; later runtime admission must reject missing, moved, stale and candidate-supplied preimages |

Scope here is this subsection, the selected-host qualifier above, minimal
routine-cycle/ISS-012 workerless wording, ISS-002's additive note and round 389.
No code, CLI mapping, registry, new family, issue/edge, model router, provider,
pricing, credential, host probe, state service or release/ISS-026 implementation
is included. Host verification is planning/board reconciliation, targeted
formatting and whitespace checks; the author runs no verifier, tests, builds
or probes and claims no independent PASS or ISS-041 completion.

Prediction: one complete parser, one framed identity, the inline mapping hash
and one supplied relation suffice before the next observer handoff. Review
that footprint at parser/consumer review. Deleting the plan/full-mapping joins
permits cross-plan/partial-census substitution; adding a request schema or
generic proof service provides no additional discriminator. `NO_WORKER` is
smaller than demanding a fictional host for an action that launches none.
New required authority sources or families are named replan boundaries, not
permission to expand this packet.

### Project preflight literal proposal (ISS-013)

This bounded consumer-led proposal closes only `project-preflight/v1`, the
existing ISS-013-owned step-6 name excluded from ISS-002's additive census.
It follows the complete module/route contracts and serves the current ISS-041
consumer. Independent literal review precedes parser or fixture integration.
It supplies no SDK service, dispatch/allocation/mutation contract, runtime
authority, public observation family, journal substitute or candidate execution.

#### Explicit interpretation and replan fence

Step 6 consumes either an admitted selected worker route or the declared
`NO_WORKER` route; workerless actions still undergo preflight before the
existing 7–10 skips. Failed/unknown routes cannot enter preflight. The routine
table's previously unnamed unknown preflight case is made explicit below;
unknown still forbids authoritative continuation under its existing rule.

“Eligible unchanged subject” is narrowed for ordinary frontier actions to
the same READY work/subject/capability in an entirely unchanged canonical
frontier. Unrelated row changes also refuse with `FRONTIER_CHANGED`. This is
an explicit conservative replan: the module ABI permits arbitrary pure
selection over the supplied frontier, so checking only the chosen row cannot
prove the old choice survives other changes. Reinvoking the module or adding
a dependency-expression language would be larger and belongs to a later
reviewed proposal. The observation ID must differ as specified below while
time/frontier bytes may remain identical; a snapshot digest is not a frontier
digest or policy ID.

Review actions instead re-observe their exact existing concrete immutable
subject; they have no `workId` and cannot manufacture an ordinary frontier
row. That subject's own source namespace remains unchanged. No equality
between its source namespace and the invoking adapter configuration is newly
imposed by this packet: actual source support/materialization admission stays
with the existing responsible adapter/release owners. An adapter invocation
does not gain candidate/certification authority by carrying those bytes.

#### Complete public record and inline observations

Reuse `C`, `Digest`, `Uuid`, `Time` and the detached, bounded closed-record
rules above. Digest is 64 lowercase hex; Uuid is canonical lowercase UUIDv7;
Time is the existing canonical UTC millisecond timestamp. Every listed field
is required, each listed sequence is canonical key order, and all newly
declared fields are non-null except `observationDigest` in the exact matrix
cells below. Reused contracts retain all their existing null and array rules.
Unknown versions/fields/enums, omissions, symbols, accessors, proxies, sparse
or exotic arrays/records refuse without invoking input code. No free-form
text, numeric fields or arrays are newly introduced by this family.

`project-preflight/v1` has exactly five members:

| Member | Exact rule |
| --- | --- |
| `actionPlanDigest` | Designated `Digest` of the complete actual `module-action-plan/v1` |
| `observationDigest` | Full inline observation commitment below, or null only as specified |
| `outcome` | One exact closed arm from the matrix below |
| `routeDigest` | Designated `Digest` of the complete actual `route-selection/v1` |
| `schemaVersion` | Literal `project-preflight/v1` |

There is no copied cycle, work, capability, role, target, host, descriptor or
configuration reference: those are bound through the actual action/input and
route. The result contains no observation payload, self-digest, permission
Boolean, allocation, ownership, freshness deadline or executable locator.

The supplied observation is exactly one closed inline arm, not a persisted
public schema or arbitrary payload:

| `kind` | Complete member census and rules |
| --- | --- |
| `PROJECT` | `facts, kind`; `facts` is one complete existing `project-facts/v1` record, including all COMPLETE/UNAVAILABLE/UNKNOWN arms |
| `REVIEW` | `adapterConfigurationDigest, kind, observationId, observedAt, result`; configuration reference is `Digest`, observation ID is `Uuid`, time is `Time`; result is the closed union below |

The REVIEW result is exactly `{kind:"AVAILABLE", subject}` with a complete
existing concrete `worker-result-subject/v1` or `release-candidate-subject/v1`,
or exactly `{kind:"UNAVAILABLE"}`, or exactly `{kind:"UNKNOWN"}`. A missing
subject/materialization is not an AVAILABLE record containing a bare digest.
AVAILABLE claims only the observed concrete record; actual retained content
and upstream evidence still require their owning admission. No alias-tagged
`review-subject/v1` record, extra wrapper, replacement hash or null subject
exists. UNAVAILABLE/UNKNOWN carry no subject or inferred partial identity.

All PROJECT bounds/order are unchanged: 0–4096 strictly work-ID-sorted rows,
0–256 strictly sorted capability names, full recomputed frontier digest, and
only READY/NOT_READY rows in COMPLETE. REVIEW retains the complete subject
union's TREE/ORDERED_PATCH_ARTIFACTS or candidate shapes, including its dense
1–4096 ordered entries, repetition semantics and non-null candidate references.
This packet adds no arrays and does not truncate, filter, deduplicate or sort
an admitted nested sequence differently from its existing contract.

The complete outcome/nullability matrix is:

| `outcome.kind` | Complete outcome members and reason literals | `observationDigest` |
| --- | --- | --- |
| `ELIGIBLE` | `kind` only | Non-null |
| `REFUSED` | `kind, reason`; exactly `WORK_MISSING`, `TARGET_CHANGED`, `CAPABILITY_REMOVED`, `NOT_READY`, or `FRONTIER_CHANGED` | Non-null |
| `UNKNOWN` | `kind, reason`; exactly `OBSERVATION_UNAVAILABLE` | Null |
| `UNKNOWN` | `kind, reason`; exactly `OBSERVATION_INVALID` | Null |
| `UNKNOWN` | `kind, reason`; exactly `SOURCE_UNAVAILABLE` or `SOURCE_UNKNOWN` | Non-null |
| `UNKNOWN` | `kind, reason`; exactly `ADMISSION_UNPROVEN` | Non-null |

Branch-only fields are absent, not null. Intrinsic public parsing checks this
entire shape and matrix; it does not independently establish any reason.
`OBSERVATION_UNAVAILABLE` means no supplied observation could be obtained;
source failure means a well-formed, correctly bound failure observation was
obtained. Neither means known missing work. `ADMISSION_UNPROVEN` preserves
uncertainty about actual source/currentness/materialization, even when claimed
bytes look healthy. An invalid/unobtainable action, module input or route
cannot yield invented digests; the caller takes its existing failure path
without fabricating this record.

#### Identities and exact supplied relation

`Dobs = SHA256(C(observation))` over the full inline record, including every
observation ID/time, failure arm and nested byte plus final LF. It is an
unframed content commitment, not the existing Dsnapshot/Dfrontier, a policy
identity, source receipt or new schema domain. Preserve nested designated
subject identities; the REVIEW target is not hashed as an alias/wrapper.
`Dpreflight` hashes exactly
`UTF8("orchestration-platform") || 00 || UTF8("project-preflight/v1") || 00 ||
u32be(1) || 07 || u64be(byteLength(C(preflight))) || C(preflight)`.
Generic serialization returns those exact bytes and Dpreflight. The acyclic
graph is module input/action and mapping, then route, then observation and
preflight, then future dispatch/event outputs. No input references preflight
or a future event; retaining these inline preimages creates no private journal.

One pure relation takes exactly `(moduleInput, actionPlan, mappingInput,
route, observationInput, preflight)`. Parse the existing full input/action/
route and apply the complete route supplied relation, which includes module
binding. Require route kind SELECTED or NO_WORKER; all other route outcomes
refuse this relation. Require the parsed preflight's two references equal
the designated identities of those actual action and route records. Derive
ordinary/review context from `moduleInput.reviewSubject`, never caller flags.

Define a *bound observation* solely by these structural checks, not live
admission: its complete inline parser succeeds; PROJECT is required exactly
when the input review subject is null, REVIEW otherwise. PROJECT facts must
pass the existing full project-facts/configuration binding against the actual
module configuration, including failure-arm project/configuration equality
and COMPLETE capability subset. REVIEW's adapterConfigurationDigest must
equal SHA256(C(the actual module configuration)). In either arm require the
observation ID distinct from both original projectFacts.observationId and
policyFacts.observationId. No timestamp ordering/age heuristic is added;
distinct IDs and well-formed times do not prove a fresh read or invocation.

The observation/null matrix in the supplied relation is exhaustive:

- OBSERVATION_UNAVAILABLE requires `observationInput` exactly null, not
  undefined, an empty record or an asserted absence digest.
- OBSERVATION_INVALID requires non-null, non-undefined supplied input that
  fails the bound-observation checks just defined. This includes malformed
  bytes/shape, wrong context/configuration/project, extra capabilities, or
  reused observation ID. Do not hash rejected input or repair a readable
  subset. A wrong but syntactically valid observation cannot be ELIGIBLE.
- Every other outcome requires the full bound observation and exact Dobs.
  ADMISSION_UNPROVEN is allowed for any such observation as an external
  uncertainty claim; the pure relation cannot establish its cause. For all
  other outcomes the following deterministic table is mandatory.

| Bound observation | Required outcome, evaluated in the listed order |
| --- | --- |
| PROJECT UNAVAILABLE / REVIEW UNAVAILABLE | UNKNOWN/SOURCE_UNAVAILABLE |
| PROJECT UNKNOWN / REVIEW UNKNOWN | UNKNOWN/SOURCE_UNKNOWN |
| PROJECT COMPLETE, action workId absent from its frontier | REFUSED/WORK_MISSING |
| PROJECT COMPLETE, selected row's immutableSubjectDigest differs from action core | REFUSED/TARGET_CHANGED |
| PROJECT COMPLETE, selected row lacks exact core capability | REFUSED/CAPABILITY_REMOVED |
| PROJECT COMPLETE, selected row is NOT_READY | REFUSED/NOT_READY |
| PROJECT COMPLETE, canonical complete frontier differs from original module input frontier | REFUSED/FRONTIER_CHANGED |
| PROJECT COMPLETE, none of the preceding conditions | ELIGIBLE |
| REVIEW AVAILABLE, subject concrete schema or designated digest differs from original review subject | REFUSED/TARGET_CHANGED |
| REVIEW AVAILABLE, same concrete schema and designated digest | ELIGIBLE |

The module relation already proves the original ordinary row is READY, the
work ID/capability/target join, and the review role/null-work-ID/target join.
No supplied expected digest replaces those preimages. A fresh observation ID
and unchanged frontier can therefore produce a new Dobs and ELIGIBLE;
rehashing a changed frontier must still trigger the specified refusal. For
review, changed result ordering, base/source namespace, author/assembly cycle,
terminal/candidate evidence or materialization references change the target.
The full subject digest includes those fields; no subset comparison suffices.

#### Owners, required evidence and proportionality

ISS-013 owns actual project source reads and invocation/configuration
admission. Its existing snapshot SDK's bounded fresh pagination is reusable
for PROJECT; a caller-supplied COMPLETE record alone is not a fresh read.
REVIEW materialization remains with the existing ISS-008/009/013/014 owners:
the actual base/result/terminal or landed tree/candidate/manifest/test bundle/
certification preimages must be obtained and verified before use. This packet
defines data only, not a review-source callback, source resolver, release SDK
service or candidate producer. Missing admission remains UNKNOWN, regardless
of whether the supplied relation can be made coherent.

ELIGIBLE here proves supplied consistency only. Runtime must still prove
current breaker permission, session/module/route admission and unchanged
observations at the existing authority point. It proves no free capacity,
exclusive workspace, independent review, ownership or mutation permission.
ISS-008's multiply-owned-resource refusal and immediate pre-publication and
pre-launch checks remain mandatory; undefined allocation/dispatch literals
are not replaced by a preflight Boolean. Workerless ELIGIBLE likewise grants
no step-11 disposition, step-12 plan or step-13 apply authority. REFUSED uses
the existing step-6 known-failure/skip route only after actual source admission;
UNKNOWN stops authoritative continuation and does not fabricate skip receipts.

| Acceptance/removal attack | Required future discriminating evidence |
| --- | --- |
| Full shape/dispatch | Every outcome/reason/null cell and PROJECT/REVIEW arm; all reused subject arms/failure states; required/extra/type/enum/hostile input mutations at every depth, no input code execution |
| Canonical identity | Independently pinned bytes/full frame/digest for every public outcome cell, inline observation hashes for project/failure/worker TREE/ordered/candidate cases; insertion-order equivalence; noncanonical bytes and wrong domain/tag/count/LF or subset/metadata-free hashes refuse/differ |
| Actual input/action/route | Independently mutate input, descriptor, work ID, subject, role, capability, action digest, mapping and route; rehash downstream records where needed; SELECTED and declared NO_WORKER pass, refused/unknown route and worker/workerless substitutions cannot enter step 6 |
| Observation binding | Null versus undefined/malformed, wrong arm/config/project/capability census, reused original/policy ID, and valid source failures have the exact matrix outcomes; a new ID with identical time/frontier can pass structure without claiming freshness |
| Ordinary refusal priority | Delete selected row; change subject; remove selected capability; mark NOT_READY; independently change/add/remove an unrelated row; combine mutations and require the first applicable reason; unchanged frontier passes, original empty frontier cannot bind an action |
| Review target stability | Both worker result arms and candidate unchanged pass; valid opposite arm, reordered distinct entries, source/base/attempt/cycle/terminal/candidate-reference substitutions refuse TARGET_CHANGED even after Dobs rehash; repeated identical entries retain existing semantics |
| Bounds and authority | Existing 0/1/4096/4097 frontier, 0/1/256/257 capability and 1/4096/0/4097 ordered-subject limits; detached results; coordinated forged inputs may satisfy structure but grant no fresh source, exclusive resource, breaker clearance or candidate authority |
| Later consumer gate | Actual fixture-owned fresh read after route for worker and workerless actions; moved/unavailable/unknown input stops at step 6 with no allocation/launch; full journal/skip/runtime integration remains deferred until its public contracts exist |

Scope/footprint is this subsection, the minimal step-6 unknown qualifier in
routine-cycle, the owning ISS-013 draft note and round 395. No CLI/result
mapping, ISS-002 scope change, registry/code, roadmap/issue/edge, provider,
allocation/mutation family or ISS-026 work is included. Later implementation
predicts one complete contracts parser, one framed identity, one inline
observation helper/hash and one supplied relation with focused compatibility
tests and inseparable supported-parser/census/harness amendments. No SDK
runtime service is authorized by this literal packet. The host owns document
format/planning/whitespace verification and independent exact-head review;
this author claims no tests, runtime evidence, self-PASS or ISS-041 completion.

This prediction is reviewed before parser/consumer integration. Removing the
actual action/route/observation joins permits cross-cycle or stale-target
substitution; comparing only the selected row silently trusts an unchanged
module choice. One inline finite observation union is smaller than a second
public receipt/request or arbitrary resolver. Needing additional ownership,
provider, recovery or release authority is a concrete replan boundary, not
permission to expand this packet.

### Dispatch, launch and terminal literal proposal (ISS-002)

This consumer-led group closes only the three existing step-7/8/9 families
`dispatch-plan/v1`, `worker-launch-receipt/v1` and
`worker-terminal-receipt/v1`. The current ISS-041 consumer is its fixed
worker-required observer echo action. Every role and outcome is structurally
closed, but no production process, credential, ownership or resume authority
is selected. Independent literal review precedes code. Step 14's existing
`resource-reclaim-receipt/v1` remains a separate complete group.

#### Explicit bounded replans and scalar rules

One `attemptId:Uuid`, allocated before planning by the actual dispatch owner,
is also this dispatch transaction/launch-attempt key. No additional launch UUID
is invented. Runtime must create it once, bind one immutable plan, refuse reuse
for another launch, and retain the exact native observation handles. Equal UUID
text alone proves none of that. Plan resource intents precede allocation;
allocation claims bind the attempt and enter the launch record, never its plan
preimage. This resolves the previously unspecified transaction chronology.

Process records below are complete *supplied claims*: an opaque incarnation
ID, parent relation and declared census/state, not a PID, OS birth token or
serializable native handle. No ID, completeness label or empty array grants
process death, absence, exclusive ownership or resume authority. Generic
descendant observation remains ISS-005-owned and unselected by this packet.
The fixture may execute only its fixed reviewed source using one retained
direct ChildProcess handle, no shell and no child-spawning code. It may claim
one direct process only while its owner observes that exact handle and source;
lost handles/crash or possible unknown children produce UNKNOWN, never PID
adoption, a fresh attempt, descendant probing or an inferred empty census.

The fixed reviewed echo host requires no credentials and forbids credential
injection. NONE below is a claim requiring that source/environment evidence;
observer role and `[]` do not establish it. Nonempty reference rows are bounded
claims only, not a partial credential-reference parser or ISS-032 service.
Rendered/captured bytes are retained separately from validated immutable
worker materialization or review results. Process exit never certifies either.

Reuse `C`, `Digest`, `Uuid`, `Time`, canonical decimal strings and existing
detached closed-record/array rules. Every field is required; sequences below
are canonical key order. Newly declared nulls are only the enumerated cells;
reused contracts preserve their own nulls. Unknown fields/versions/enums,
missing values, symbols, accessors, proxies and sparse/exotic values refuse
without invoking input code. `Name` is `[a-z][a-z0-9._:-]{0,63}`; `Dec(a,b)`
is an unsigned canonical decimal string, inclusively bounded by a and b.
Every stated string grammar matches the whole string, with no trailing bytes.
Intrinsic parsers enforce every local shape/null/bound/outcome rule below;
predicates naming another actual record are enforced by the supplied relations.

An inline content reference is exactly `byteLength, contentDigest`, with
byteLength `Dec(0,1048576)` and contentDigest SHA-256 of the exact retained raw
bytes. Rendered input additionally requires nonzero length. It is not the
canonical brief hash or a path. All arrays below are dense, at most 256 rows;
only explicitly stated nonempty arrays have a lower bound of one.

#### Complete preparation and dispatch plan

A resource intent is exactly `owner, resourceIdentityDigest`, owner being
ADAPTER or HOST and the identity Digest. Intents are strictly sorted by the
ASCII pair `(owner,resourceIdentityDigest)`, with no repeated pair. ADAPTER
means the actual bound project configuration's owner; HOST means the actual
selected host. This census requests allocations; the existing brief READ/
CREATE/MODIFY/DELETE footprint is intended access and is not an allocation.
Existing resources accessed read-only do not thereby become new allocations.
The census covers owner-managed execution workspaces/temporary artifacts;
zero rows do not assert that no OS resources exist. Native process/stdio handle
closure remains the process owner's duty; retained journal/evidence records
are not worker allocations to erase. Actual owners admit the requested scope.

Credentials are exactly `{kind:"NONE"}` or `{kind:"REFERENCES", references}`.
REFERENCES has 1–256 rows strictly sorted/unique by credentialId. Each row is
exactly `access, capabilityNames, credentialId, generation, referenceDigest,
role`: access is READ_ONLY or PROJECT_MUTATION; capabilityNames is 1–256
strictly ASCII-sorted unique Names; credentialId is Uuid; generation is
Dec(0,9007199254740991); referenceDigest is Digest; role is the unchanged
implementation/review/observer enum. Only implementation may claim
PROJECT_MUTATION. There is no release/promotion-administration access arm.
Role/capability/access are requests/claims to equal-bind against actual
ISS-032 authority before use, not authority inferred from Name spelling.
referenceDigest uses its future owning credential contract's identity; no
replacement hash or backend/secret payload is specified or accepted here.

`dispatch-plan/v1` has exactly `actionPlanDigest, attemptId, outcome,
preflightDigest, reviewRequestDigest, routeDigest, schemaVersion,
sessionHealthDigest`. All references are Digest except reviewRequestDigest,
which is Digest or null. The schema literal is `dispatch-plan/v1`.

| outcome.kind | Complete outcome members and exact rules |
| --- | --- |
| PLANNED | `credentials, hostRendererArtifactDigest, kind, renderedInput, resourceIntents, workerHostIdentityDigest`; credentials/intent census/content reference as above; both host fields Digest |
| REFUSED | `kind, reason`; reason PRECONDITION_MOVED, RENDERING_REFUSED, CREDENTIALS_REFUSED or RESOURCES_REFUSED |
| UNKNOWN | `kind, reason`; reason OBSERVATION_UNAVAILABLE, OBSERVATION_INVALID or ADMISSION_UNPROVEN |

Opposite-arm fields are absent, never null. Refusal reasons are diagnosed
producer claims after a valid input handoff, not mechanically proved by their
spelling. Invalid/missing upstream records cannot yield fabricated references.
This closed failure union does not authorize invoking the preparation owner.

The full plan relation takes `(moduleInput, actionPlan, mappingInput, route,
observationInput, preflight, cyclePlan, health, reviewRequestOrNull,
renderedInputBytesOrNull, plan)`. Reuse the complete preflight supplied relation;
require ELIGIBLE and SELECTED, hence a declared worker-required action. NO_WORKER
instead takes the existing typed 7–10 skips, never a null-host plan. Require:

1. The actual cyclePlan parses and its request is canonically identical to
   moduleInput.cycleRequest. The actual health parses as HEALTHY with step:null,
   targetSessionId and holderSessionId both equal
   moduleInput.cycleRequest.sessionRequest.sessionId.
   Initial ordinal-1 health cannot be relabeled or borrowed as this inspection.
   Plan sessionHealthDigest equals its designated identity; actual fresh lease/
   source/path/configuration authority remains the session owner's duty.
2. Plan action/preflight/route references equal their actual designated
   identities. Core requested role equals brief role by the reused module
   binder. For review require the complete actual review-request, its cycle
   equal the actual cycle, packet.brief canonically equal the actual brief,
   and packet.subject canonically equal the actual concrete input/preflight
   target. For a worker-result review require plan.attemptId distinct from the
   subject's authorAttemptId, reusing the review-result rule; no fictional
   author attempt is imposed on a candidate. Bind reviewRequestDigest to the
   actual request's designated identity. For implementation/observer require
   reviewRequestOrNull and reviewRequestDigest both null.
3. For PLANNED, use the actual selected mapping row: both host identities
   equal that row, with its existing capability/identity recomputation. Every
   credential row role equals the core/brief role. Require actual owned raw
   rendered bytes and recompute the full reference, including byte length.
   Renderer determinism, installed artifact equality, admitted credentials and
   completeness/eligibility of resource intents remain producer admission.
   For REFUSED/UNKNOWN require renderedInputBytesOrNull exactly null; no
   partial successful preparation is smuggled into those arms.

Raw byte arguments throughout are detached copies of actual bounded native
Uint8Array bytes, without shared backing or executable input hooks; null is
allowed only where named, never undefined. No unparsed JSON record, caller
expected digest or decoded/re-encoded text replaces the actual raw bytes.

#### Allocation, ownership and process claims at launch

An allocation row is exactly `allocationId, owner, ownerTransactionId,
resourceIdentityDigest, state`. Owner/identity reuse the intent; transaction
is Uuid and equals plan.attemptId. State is NOT_ALLOCATED, ALLOCATED or UNKNOWN.
NOT_ALLOCATED requires allocationId:null; ALLOCATED requires Uuid; UNKNOWN
allows Uuid or null and retains any known ID. Non-null IDs are unique within
the census. Rows preserve the exact full sorted intent census, including
unattempted/refused resources: omission cannot establish absence. IDs are
owner-issued opaque allocation claims stable through later reclaim.

A process census is exactly `completeness, entries`. Completeness is COMPLETE
or UNKNOWN. Each entry is exactly `parentProcessId, processId, state`:
processId is Uuid, parentProcessId is Uuid or null, state LIVE, DEAD or UNKNOWN.
Entries are strictly processId-sorted/unique. A nonempty census has exactly
one null-parent root; every other parent names another entry, no self-edge or
cycle. COMPLETE forbids UNKNOWN entry states. Empty COMPLETE means a supplied
no-process claim; empty UNKNOWN means no trustworthy census. Neither is proof.
The fixture's only admitted nonempty census has one null-parent entry backed
by its retained handle; the parser may structurally admit larger claims but
does not grant a descendant primitive or a history/currentness proof.

`worker-launch-receipt/v1` has exactly `attemptId, dispatchPlanDigest,
observedAt, outcome, ownership, processes, resources, schemaVersion`.
attemptId is Uuid, plan reference Digest; processes/resources use the complete
inline shapes above. Ownership is UNPUBLISHED, PUBLISHED or UNKNOWN, meaning
the exact attempt's create-once ownership claim. observedAt is Time, or null
only for UNKNOWN. Schema is literal `worker-launch-receipt/v1`.

| outcome.kind | Complete members and exact supplied constraints |
| --- | --- |
| LIVE | `kind`; PUBLISHED, every resource ALLOCATED, nonempty COMPLETE process census whose root is LIVE |
| START_FAILED | `kind, reason`; reason ALLOCATION_REFUSED, OWNERSHIP_REFUSED, SPAWN_REFUSED or STARTUP_EXITED; exact matrix below |
| UNKNOWN | `kind, reason`; reason OBSERVATION_UNAVAILABLE, OBSERVATION_INVALID, IDENTITY_CONFLICT, STARTUP_UNPROVEN or HANDLE_LOST; retain all known claims, grant no vacancy |

The explicit step-8 sequence is allocate intents in canonical order, publish
ownership once, then native launch/observe. This is a bounded chronology
replan, not an allocation or filesystem primitive selection. START_FAILED is:

| reason | Resources / ownership / process census |
| --- | --- |
| ALLOCATION_REFUSED | nonempty census: zero or more ALLOCATED rows then one or more NOT_ALLOCATED; UNPUBLISHED; empty COMPLETE processes |
| OWNERSHIP_REFUSED | all ALLOCATED; UNPUBLISHED; empty COMPLETE processes |
| SPAWN_REFUSED | all ALLOCATED; PUBLISHED; empty COMPLETE processes |
| STARTUP_EXITED | all ALLOCATED; PUBLISHED; nonempty COMPLETE, every process DEAD |

These are supplied claims only. Possibly created processes, conflicting owner
publication or unknown allocation cannot become a known start failure. No
empty census substitutes for observing that no native child was created.
The launch relation `(plan, launch)` requires a PLANNED plan, its actual
designated digest, equal attempt ID and the exact intent/allocation census,
then enforces the matrices. It does not replay the full preparation tuple;
the consumer must additionally pass that relation and actual owner admission.

#### Complete terminal observation, capture and acyclic failure

An exit cause is exactly `{kind:"EXIT_CODE", value}` with value
Dec(0,4294967295), or `{kind:"SIGNAL", value}` with value matching
`SIG[A-Z0-9]{1,16}`. This bounded signal token is a source claim, not a portable
termination API or inference from a platform's conventional exit code. Missing,
contradictory or unadmitted code/signal remains UNKNOWN/EXIT_UNPROVEN.
A stream capture is exactly `{content, kind}` for kind COMPLETE or TRUNCATED,
with the full content reference above, or exactly `{kind:"UNAVAILABLE"}`.
TRUNCATED retains the actual bounded prefix, not a claimed complete output.
Capture is exactly `stderr, stdout`; the streams are never merged or reordered.

`worker-terminal-receipt/v1` has exactly `attemptId, capture,
dispatchPlanDigest, launchReceiptDigest, observedAt, outcome, processes,
schemaVersion`. References are Digest; attemptId Uuid; capture/processes are
the closed shapes above. Time is non-null except UNKNOWN may use null.
Schema is literal `worker-terminal-receipt/v1`.

| outcome.kind | Complete members and exact supplied constraints |
| --- | --- |
| EXITED | `exit, kind`; exit is a complete cause; launch was LIVE; nonempty COMPLETE process census, all DEAD |
| START_FAILED | `exit, kind`; launch was START_FAILED; canonically identical process census; exit:null for proven no-child reasons, complete exit cause for STARTUP_EXITED |
| TERMINATION_FAILED_LIVE | `kind, termination`; launch was LIVE; COMPLETE census with at least one LIVE process; termination exactly `elapsedMilliseconds, limitMilliseconds`, respectively Dec(1,86400000) and Dec(1,60000), elapsed >= limit |
| UNKNOWN | `kind, reason`; reason OBSERVATION_UNAVAILABLE, OBSERVATION_INVALID, IDENTITY_CONFLICT, HANDLE_LOST, PROCESS_TREE_UNPROVEN or EXIT_UNPROVEN; no death or vacancy claim |

“Terminal” names the completed observation/termination operation, not automatic
worker death. TERMINATION_FAILED_LIVE and UNKNOWN retain capacity; later
bounded observation may continue only under actual ownership. Runtime preserves
at most one immutable final EXITED/START_FAILED record per attempt; repeated
reads return it. Live/unknown diagnostic observations never stand in for that
final record, and these pure relations do not establish history or retry rights.

For known start failure, step 8 first emits its launch record, then this
START_FAILED terminal referencing it. It emits no step-9 receipt: 9/10 remain
typed skips and disposition proceeds at 11. A future complete event union may
bind both step-8 records. Launch never references terminal; terminal never
references downstream worker subject/review result. A possibly started child
instead yields UNKNOWN and cannot take that known-failure skip route.

The terminal relation `(plan, launch, stdoutBytesOrNull, stderrBytesOrNull,
terminal)` applies the launch relation, exact plan/launch digests and attempt
equality. Every launch process ID/parent remains in terminal, with no DEAD to
LIVE reversal; new descendant entries may be added under the same root,
never a substituted root. An empty launch census cannot acquire a root except
for UNKNOWN terminal claims (no known finality is inferred). Known terminal
time must be >= known launch time; clock contradiction remains an
UNKNOWN/OBSERVATION_INVALID observation, not a fabricated monotonic duration.
START_FAILED/no-child requires
both captures UNAVAILABLE; other outcomes permit every capture arm independently.
For UNAVAILABLE require the corresponding byte argument exactly null; for
COMPLETE/TRUNCATED require actual bytes and recompute length/hash. Capture
failure does not negate known process exit, but cannot supply a complete worker
result. Actual bounded termination timing requires the owner's monotonic
observation; these numeric claims alone prove no timeout or termination action.

#### Owner gates, required evidence and footprint

ISS-008 owns plan/ownership/attempt uniqueness and the complete resource claim;
ISS-013 and the selected host own their actual allocations and eventual absence;
ISS-005 owns actual native process observation; ISS-032 retains credential
admission. Session, breaker, installed module/route/renderer and exact review
request/target admission remain mandatory immediately before publication and
launch. Shape, closed claims, scalar order or digest equality grants none.
No production tree identity, native lease, broker, backend, credential family,
workspace resolver, command argv, worker-health/CLI implementation or private
history is supplied. The later step-14 family must consume the same intent,
allocation, owner transaction, launch and process references plus actual
disposition/apply and owner absence records; EXITED and caller `[]` cannot
clear it. No-worker and pre-launch failure still require actual step 14.

The fixture launches only its fixed reviewed no-child-spawning echo source,
with native argument array, bounded rendered bytes written to stdin then
closed, separately piped/capped stdout and stderr and exact handle exit/close
observation. It never evaluates received bytes or injects credentials.
Source/handle identity, true zero allocations and absence of credential
injection require fixture-owned evidence;
none is asserted by a caller flag. Unavailable handles, uncertain descendants,
ambiguous exit or interrupted observation give named UNKNOWN/refusal with no
redispatch/adoption. Runtime/capture source and full crash-boundary evidence
remain separate reviewed implementation; this packet runs no child or probe.

| Acceptance/removal attack | Required future discriminating evidence |
| --- | --- |
| Complete families | Every plan/launch/terminal reason, null/ownership/census/exit/capture cell; all three roles; remove/add/type/enum/hostile nested mutations refuse |
| Identity graph | Independently pinned canonical bytes/full frames/digests for every outcome cell; inline claim mutations change identity; no launch-to-terminal or terminal-to-subject/review-result back-reference; noncanonical bytes and wrong framing differ/refuse |
| Supplied preparation | Valid SELECTED/ELIGIBLE full tuple; NO_WORKER, failed preflight/route, old ordinal-1 health, wrong session/cycle/request/brief/host/role/rendered bytes and coordinated single-edge substitutions refuse |
| Credentials/resources | NONE versus nonempty claims; role/access/generation/capability bounds; exact sorted intent/allocated census, prefix refusal, missing/extra/duplicate IDs, wrong owner/transaction and UNKNOWN-to-NOT_ALLOCATED substitutions |
| Process and terminal | 0/1/256/257, duplicate/root/parent/cycle/UNKNOWN-state cases; root substitution, dropped known child, DEAD-to-LIVE, live child with dead root, false no-child, start-failure step-8 pair and retained-capacity deadline cases |
| Bytes versus results | 0/1/1048576/1048577 byte bounds; stdout/stderr swap, truncation/absence, UTF-8 re-encoding and hash/length mutations; exit zero never fabricates worker subject or completed review |
| Actual fixture boundary | Fixed source/handle and closed stdin; argument echo/stream capture; possible start, lost handle/crash and foreign PID/UUID claims refuse without adoption; genuine zero allocation/credentials independently observed, never inferred from arrays |

Each family's designated identity is SHA-256 of
`UTF8("orchestration-platform") || 00 || UTF8(its schemaVersion) || 00 ||
u32be(1) || 07 || u64be(byteLength(C(record))) || C(record)`; generic
serialization returns that exact concrete record and digest. Inline claims
have no new schema or digest domain. Upstream identities remain their existing
designated functions; retained byte references use raw SHA-256 as above.

Footprint now is this bounded subsection, the minimal worker-state clarification,
additive owning ISS-002/005/008/013/032 notes and round 398. Later implementation
predicts three complete parsers/identities and three supplied relations with
bounded inline helpers/tests plus inseparable registry/census/harness updates.
No runtime/CLI/shared manifest/roadmap/issue/provider/native case changes occur
here. Host owns planning/format/whitespace checks, independent exact-head
review and adjacent board reconciliation; author claims no tests, self-PASS,
production authority or ISS-041 completion. Requiring another public family,
credential service, process primitive or a larger resolver is a named replan
boundary. Closed inline claims are smaller than those mechanisms; removing
their actual-input joins or owner-admission gates would conceal uncertainty.

### Disposition and follow-up literal proposal (ISS-002/011)

This bounded proposal closes only `action-disposition/v1` and
`follow-up-cycle-request/v1`, already in the routine census. Its current
ISS-041 consumer seeds an earlier immutable author result and observes a
distinct later review-cycle echo, then either a nonapplying rejection follow-up
or explicitly declared nonmutating completion. Seeded history is fixture input,
not evidence of an executed earlier cycle or effective production review.
Independent literal review precedes code; no new public input family, runtime
service, scheduler, mutation/release implementation or authority is supplied.

#### Explicit callable and subject-phase replans

The existing step-4 `descriptor`/`plan` exports, byte contracts and behavior
remain valid. `inputSchemas` and `outputSchemas` describe that step-4 plan
interface only. An additional statically source-owned export `disposition`
may exist only when the descriptor's existing dispositionCodes is nonempty;
it takes the complete closed inline input below and returns a native Promise
of one complete action-disposition. No other export is admitted. Plan-only
modules remain valid partial ABI implementations, including descriptors with
nonempty codes; they cannot claim a full cycle requiring step 11. Full-routine
admission must prove the exact installed callable and code census before
worker effects or workerless action effects, not discover a missing handler
after launch. Code strings neither locate code nor create an export.

The callable has the same purity/effect prohibition as plan: no ambient
filesystem, process, network, clock, randomness, credential, adapter, host or
mutation access. Its one invocation is bound to the actual step-11 identity
and detached canonical input: ordinal `"11"`, kind `"disposition.plan"`, actual cycle,
inputDigest SHA256(C(input)), and the actual predecessor journal prefix under
the existing step-identity contract. No copy of that identity is added to input.
Throw/rejection/malformed return follows the
owning caller's UNKNOWN path, never a fabricated regular disposition. This
optional phase is an explicit ABI replan, not a silent enlargement of the
existing module-plan-input/result unions or mandatory third export.

The original action core's opaque pre-worker subject and the newly materialized
worker-result identity are distinct. A worker-result embeds its later terminal
reference and cannot be forced to equal its pre-worker core digest. Review
actions already target the exact earlier concrete immutable subject. The
rules below retain both the original action and the proper downstream target;
no new subject wrapper/schema or circular result identity is introduced.

Reuse `C`, `Digest`, `Uuid`, `Id`, `Name` and closed detached record/array rules.
All fields are required, all listed member orders are canonical, and newly
declared nulls exist only where stated; reused contracts retain their own
rules. Name is the exact finding-code grammar `[a-z][a-z0-9._:-]{0,63}`;
Id is `[a-z0-9][a-z0-9._:@+-]{0,127}`. Whole-string, exact-length digest/UUID
rules apply. Unknown fields/versions/enums, omissions and hostile input refuse
without running input code. No arbitrary prose, payload or expression is added.

#### Complete inline input and supplied context relation

The inline input has exactly `actionPlan, moduleInput, preflight, review,
route, skips, worker`. The first three and route are the complete existing
module-action-plan/module-plan-input/project-preflight/route-selection records.
`worker` is null or exactly `launch, plan, resultSubject, terminal`: complete
worker-launch-receipt, dispatch-plan and worker-terminal-receipt records, plus
resultSubject null or a complete worker-result-subject (never a candidate).
`review` is null or exactly `attempt, authority, request`: complete existing
review-attempt-result or null, review-authority and review-request records.
`skips` is a dense 0–4 array of complete routine-step-skip records, restricted
to ordinals 7–10 in strictly increasing numeric ordinal order. There is no
schemaVersion, caller phase/flag, currentness Boolean or self-digest on input.

One pure context/disposition relation takes exactly
`(input, stdoutBytesOrNull, stderrBytesOrNull, disposition)`. Intrinsic input
shape covers all nested arms; the following comparisons additionally bind
actual supplied records and classify which outcome cells may be used:

1. Apply validateModulePlanBinding to the actual input/action. Require route
   actionPlanDigest and preflight actionPlanDigest equal the action's actual
   designated identity; preflight routeDigest equals the actual route identity;
   require ELIGIBLE. Derive the unique action declaration and its role/worker/
   review flags from the exact descriptor. SELECTED is required for worker
   actions, NO_WORKER otherwise. Complete preparation/current mapping/source/
   health/installed renderer admission remains upstream as in the launch
   binder; these records are not substituted proof for its missing preimages.
2. For a worker action require worker non-null and apply the actual terminal
   supplied relation to worker.plan/launch/terminal and the two captured raw
   byte arguments. Thus the actual plan/launch/terminal identities, attempt,
   allocation/process census and stream length/hash joins all remain required.
   Also require worker.plan action/preflight/route references equal the actual
   context records. Non-worker requires worker:null and both raw arguments null.
3. A non-null resultSubject requires an ordinary implementation/observer action,
   authorCycleId equal the actual cycle, authorAttemptId equal worker.plan.attemptId,
   and terminalReceiptDigest equal the actual terminal identity. Its baseSource
   adapterId/projectId equal the actual module configuration. START_FAILED has
   no resultSubject because step 9 did not run. The adapter/materializer still
   proves the old opaque target's actual base and retained result bytes; no
   revision-to-digest formula or equality to the new subject is fabricated.
4. For non-null review require review role, worker non-null, resultSubject:null,
   and apply validateReviewResultBinding to the actual request/attempt/authority.
   Request cycle equals the current cycle; packet brief equals the actual action
   brief and packet subject equals the actual concrete moduleInput.reviewSubject.
   worker.plan reviewRequestDigest equals the request's designated identity.
   Each non-null attempt additionally has the exact worker plan/launch/terminal
   digests, current cycle and plan attemptId. Existing distinct author/assembly
   cycle and worker-author attempt rules remain; no candidate author is invented.
   Every finding code must be in the actual descriptor dispositionCodes, with
   its moduleDescriptorDigest equal that descriptor and the request brief.
   The entire finding/evidence census is retained, not just its first code.
5. An ordinary action requires review:null and a null plan reviewRequestDigest
   when a worker exists. A review action's plan retains non-null request identity
   even if known start/process failure means no review reduction ran; that
   failed branch carries review:null and actual skips rather than fake authority.
   Actual request/preparation admission in that case remains its upstream owner.

The complete route/skip census is fixed below. A successful process observation
here means EXITED with EXIT_CODE value `"0"`; it is not semantic worker success.
Nonzero EXIT_CODE or SIGNAL is a known process failure for this composition.
This conservative classification does not turn exit zero into review acceptance.

| Actual supplied path | Required review/result and exact skips |
| --- | --- |
| Declared workerless | worker/review null; skips 7 no-allocation, 8 no-worker, 9 no-worker, 10 no-review |
| Known START_FAILED launch/terminal pair at step 8 | resultSubject/review null; skips 9 no-worker, 10 no-review |
| Ordinary worker EXITED | review null; skip 10 no-review; a materialized result may be retained even for known process failure, without granting apply |
| Review worker EXITED with code zero | review non-null, resultSubject null; skips empty |
| Review worker EXITED with nonzero code or signal | review/resultSubject null; skip 10 no-review, no decided review |
| UNKNOWN launch/terminal or TERMINATION_FAILED_LIVE | no skips, no known completion/failure route; any supplied review must still pass its joins; only UNKNOWN disposition can bind |

Known early terminal at steps 1–7 does not enter this context or fabricate
step 11. Review authority unknown permits only UNKNOWN disposition. These
diagnostic supplied contexts cannot establish that routine step 11 was reached:
runtime stops authoritative progression at an earlier UNKNOWN or live worker.
No module call or journal padding repairs that earlier gate.

For every supplied skip, require the actual cycle ID and the exact reason,
ordinal and kind above. Its inputDigest references the immediately preceding
actual primary output: Dpreflight at 6, Dlaunch at 8, Dterminal at 9, or the
preceding Dskip. This explicitly fixes primary-output identity for composite
steps: a step-8 known-failure event later binds both launch and its dependent
terminal; a step-9 event later binds terminal and materialized subject/attempt.
Neither requires a new output wrapper hash or a record back-reference. The
actual predecessorJournalDigest still requires the complete public event/
journal owner; this tuple cannot authenticate a supplied prefix or create a
private journal. Missing/extra/cross-cycle/unjoined skips refuse.

#### Complete disposition record and target/outcome matrix

`action-disposition/v1` has exactly `actionPlanDigest, code, inputDigest,
outcome, schemaVersion, subjectDigest, subjectKind`. References are Digest,
code is Name, schemaVersion is its literal family. subjectKind is exactly
ACTION, WORKER_RESULT or RELEASE_CANDIDATE. Recompute inputDigest as
`SHA256(C(the complete inline input))`, with final LF and all nested records,
not a schema/digest-name list. Require actionPlanDigest equal the actual action.
Code must belong to the actual nonempty descriptor dispositionCodes. It is a
module-owned decision key, not an engine policy or arbitrary function selector.

The target is deterministic: if moduleInput.reviewSubject is non-null, use its
concrete WORKER_RESULT/RELEASE_CANDIDATE kind and designated identity; otherwise
if worker.resultSubject is non-null use its WORKER_RESULT identity; otherwise
use ACTION and the original core immutableSubjectDigest. Original action/core
identity remains separately committed, including when the downstream target
differs. A caller-supplied expected target cannot replace this selection.

| outcome.kind | Complete outcome members and literal constraints |
| --- | --- |
| APPLY | `kind, operation`; operation PROJECT, ASSEMBLE_CERTIFY or PROMOTE |
| REVIEW_NEEDED | `followUp, kind`; non-null REVIEW intent below |
| FOLLOW_UP | `followUp, kind`; non-null REPAIR, REPLAN or RETRY intent |
| FAILURE | `followUp, kind`; followUp null (no retry requested), or REPAIR/REPLAN/RETRY intent |
| NO_ACTION | `kind` only; a declined eligible action, not proof of an empty frontier |
| COMPLETE | `kind` only; explicit nonmutating observer/review completion route, conditional on remaining owner/reclaim/journal gates, never inferred from a missing apply |
| UNKNOWN | `kind, reason`; reason INPUT_UNPROVEN, RESULT_UNPROVEN, AUTHORITY_UNPROVEN or DISPOSITION_FAILED |

Only REVIEW_NEEDED, FOLLOW_UP and FAILURE carry followUp; only FAILURE permits
null. Intrinsic parsing
closes this whole union and all inline intents; the supplied relation enforces
the following ordered admissibility matrix, not the module's choice of code:

| Bound evidence / action | Admissible disposition |
| --- | --- |
| Any earlier unknown/live-worker diagnostic or unknown review authority | UNKNOWN only; no follow-up/apply/skip permission |
| Known start or process failure | FAILURE or UNKNOWN; no APPLY, COMPLETE or invented successful result |
| Review rejected | FOLLOW_UP with REPAIR/REPLAN/RETRY, or UNKNOWN; never APPLY, COMPLETE, NO_ACTION or a waived follow-up |
| Ordinary successful process, resultSubject null | UNKNOWN/RESULT_UNPROVEN only |
| Ordinary successful materialized result, reviewRequired=true (implementation **or observer**) | REVIEW_NEEDED or UNKNOWN; no current-cycle apply/completion/waived review |
| Other eligible workerless, ordinary successful materialized result with reviewRequired=false, or accepted review | Remaining cells subject to the restrictions below; REVIEW_NEEDED is not available here |

COMPLETE at step 11 is a disposition, not proof that reclamation already ran.
It is restricted to observer actions with reviewRequired=false, or review
actions with accepted authority. Worker completion/materialization or genuine
workerless skips above remain mandatory. APPLY/PROJECT permits ACTION or
WORKER_RESULT target, never a candidate. APPLY/ASSEMBLE_CERTIFY requires the
declared workerless observer/no-review path and ACTION target. APPLY/PROMOTE
requires review role, accepted authority and the exact RELEASE_CANDIDATE
target. No false flag waives candidate independent review. All other applying
paths still need actual step-12 owner planning and step-13 fresh apply authority.
These closed operation choices execute no project or release operation here.

For every non-null follow-up intent, the kind-specific target below must equal
the actual disposition target. REVIEW_NEEDED specifically carries the full
actual new worker.resultSubject, preserving bytes/order/base/attempt/terminal.
Rejected-review follow-ups keep the original reviewed target; they do not
mutate it in the rejected cycle or inherit acceptance for a changed target.
Module-owned runtime policy must substantiate regular COMPLETE/FAILURE/code
claims; parsing a mechanically consistent record does not prove its issuance.

#### Closed follow-up intents, request and acyclic causes

The inline intent is exactly one of these shapes; no future cycle/session ID,
lease, schedule, credential, arbitrary payload or execution path is included:

| intent.kind | Complete members and constraints |
| --- | --- |
| REVIEW | `kind, moduleId, subject`; moduleId Id, subject the existing complete concrete worker-result or release-candidate record |
| REPAIR / REPLAN / RETRY | `kind, moduleId, subjectDigest, subjectKind`; moduleId Id, Digest and the exact ACTION/WORKER_RESULT/RELEASE_CANDIDATE enum |
| SUCCESSOR_VERIFICATION | `installationId, kind, promotionTransactionId, successorReleaseDigest`; two Uuids and Digest |

REVIEW intent's target identity is the concrete subject's designated identity;
other ordinary intents carry the kind/digest derived from actual supplied
context. moduleId is desired later module intent, not installed admission or a
loader key; the later owner must freshly select/admit source/configuration and
allocate a distinct cycle/session as required. This group grants no repair,
replan, retry or release-lane execution/intake. It chooses no retry policy.

`follow-up-cycle-request/v1` has exactly `cause, intent, schemaVersion,
sourceCycleId`; schemaVersion is literal `follow-up-cycle-request/v1`.
sourceCycleId is Uuid of the causing cycle, never the future
cycle. Cause is exactly `digest, kind`, with Digest and kind DISPOSITION or
PROMOTION. DISPOSITION requires a REVIEW/REPAIR/REPLAN/RETRY intent; PROMOTION
requires SUCCESSOR_VERIFICATION. There are no opposite-cause fields or nulls.
Promotion cause digest names the actual owning promotion receipt under its
own designated identity; no replacement hash, production release parser or
opaque approval grant is invented. The complete structural arm is required
by the finite census while release/promotion execution remains expressly out
of ISS-041 scope. Its later owner must verify actual promotion/installation/
transaction/successor preimages and scheduler/fence/broker/reclaim gates.

A separate supplied relation takes `(input, stdoutBytesOrNull,
stderrBytesOrNull, disposition, request)`, applies the complete disposition
relation, requires a non-null disposition followUp, and requires DISPOSITION
cause with digest Ddisposition, sourceCycleId equal the actual current cycle,
and request.intent canonically identical to that inline intent. It refuses
PROMOTION causes: the production promotion-cause binder remains with its later
owner, not a partial generic release parser here. A disposition never contains
DfollowUpRequest; inline intent precedes disposition, then the request names
it. Source/target/code changes cannot reuse the old request identity.

Ddisposition and DfollowUpRequest each use SHA-256 of
`UTF8("orchestration-platform") || 00 || UTF8(its schemaVersion) || 00 ||
u32be(1) || 07 || u64be(byteLength(C(record))) || C(record)`. Generic canonical
serialization retains the concrete family and exact framed identity. Inline
input/intent/cause records introduce no schema, union wrapper or digest domain.
Only the full input has the explicit unframed commitment above.

#### Explicit terminal amendment, evidence and footprint

The applied-only terminal bullet conflicts with the existing complete-follow-up
row and with completed read-only/review work. This proposal explicitly permits
COMPLETE and a successful materialized REVIEW_NEEDED to reach COMPLETED only
after all required worker/review and actual step-14 reclaim gates plus the
complete journal/terminal census. That COMPLETED means nonmutating completion
or complete-follow-up; it is not an applied action or mutation receipt. Applied
completion still requires the actual step-13 apply receipt. FAILURE, FOLLOW_UP
and NO_ACTION after an eligible action yield FAILED_KNOWN after their required
reclaim; NO_ACTION is not COMPLETED_NO_WORK. That latter outcome retains its
existing no-eligible-permitted-action/no-allocation proof requirement.

All non-APPLY known dispositions require actual no-mutation skips at 12/13,
including COMPLETE; skip 12 binds Ddisposition, skip 13 binds Dskip12. Runtime
retains the real journal prefix at each edge. UNKNOWN issues no such skips;
14/15 never skip. A successful review, no apply request, or empty array alone
does not certify completion. Full project-mutation-request/plan/apply families
and event/journal/reduced-state/cycle-receipt/reclaim groups remain required
by the public census even when this fixture selects no mutation branch.

| Acceptance/removal attack | Required future discriminating evidence |
| --- | --- |
| ABI/source boundary | Plan-only compatibility unchanged; optional export with empty codes, unknown export, missing full-cycle handler, wrong artifact/census or effectful call refuses before worker effects |
| Complete literals | Every outcome/operation/follow-up/cause/target/null/code cell, hostile/missing/extra/type/enum inputs, 0/4/5 skip bounds and all reused record bounds; independent canonical bytes/full frames/digests plus inline input hash |
| Actual context | Each module/action/route/preflight/plan/launch/terminal/raw stream/review/cycle/attempt reference substituted independently, with downstream rehash; exact joins or outcome matrix refuse |
| Subject/code/flag separation | Original target differs from materialized result; current review target stays exact; unknown/foreign code, missing finding membership, observer reviewRequired bypass, candidate-as-worker apply and same-author attempt refuse |
| Real skips | Workerless full 7–10 chain, same-step-8 start-failure pair, ordinary/review/process-failure paths; missing/extra/wrong primary digest/cycle/reason, old skip reused at 12/13 and UNKNOWN padding refuse |
| No unauthorized completion | Accepted review can choose admitted COMPLETE without apply; rejection cannot apply/complete or discard its follow-up; live worker, absent result/reclaim/journal, NO_ACTION and mere absence of apply never claim applied/empty-frontier completion |
| Follow-up causality | All five intent kinds parse; step-11 binder binds actual disposition/intent/source cycle, rejects mismatched cause/target and every PROMOTION cause; parsing successor verification schedules nothing |

Footprint is this subsection and the older no-mutation qualifier, minimal
module-ABI/routine corrections, additive owning ISS-002/011/009/013 notes and
round 401. No code, manifests, roadmap/issue/edge, provider, probe, service,
CLI, runtime mutation/release/scheduler or ISS-026 work. Prediction: two complete
parsers/identities, one closed inline input/intent set and two supplied relations
with focused tests and inseparable parser/census wiring after review. Host owns
format/planning/whitespace verification, independent exact-head review and
adjacent board reconciliation. Author claims no tests, self-PASS, production
authority or ISS-041 completion. Another family, open payload or authority
source is a named replan boundary, not permission to expand this packet.

### Complete project mutation request, plan and apply literals (round 404)

This proposal closes the three existing project families together. It selects
no SDK executor, provider, credential, native primitive, runtime journal or
release operation. The ISS-041 COMPLETE path still takes genuine skips 12/13;
its complete event union must nevertheless parse every declared project arm.
Project records cannot represent ASSEMBLE_CERTIFY or PROMOTE. Those operation
choices retain their release owner and must refuse the project supplied binder.

#### Bounded operation representation and owner boundary

The previously unspecified inspectable operation is explicitly a bounded
`COMPARE_REPLACE` of a complete adapter-owned byte resource. This is a proposal
for v1's finite representation, not a generic program, shell command, JSON patch
or production filesystem protocol. The adapter's admitted source maps opaque
resource IDs to its complete replaceable project records and performs semantic
validation. A branch-record adapter and queue-record adapter can expose their
complete canonical records as bytes; neither engine nor JSON chooses a path,
provider, parser, method or executable. An adapter lacking that complete mapping
must refuse UNSUPPORTED_ACTION. Partial projections, credential/authority state,
installation/release pointers and effects omitted from the census cannot enter
this protocol. Larger or different operations require a versioned replan, not
an unbounded payload or external digest whose preimage is unspecified.

Reuse closed detached records/dense arrays, C with final LF, Digest, Uuid, Time,
Name and Id as in round401. Scalar grammars match the whole string; unknown
fields, symbols, accessors, proxies, sparse arrays and wrong versions refuse
without input code. Hex means lowercase hexadecimal pairs, 0–4096 decoded
bytes (0–8192 characters); empty bytes differ from absence. All fields are
required; new nulls occur only in named cells. This deliberately small complete
byte preimage is inspectable before writes; a hash or path cannot replace it.

An inline value is exactly `{kind:"ABSENT"}` or `{bytes:Hex,kind:"PRESENT"}`.
A resource observation is exactly `resourceId, value`, with resourceId Id and
value that union. An effect is exactly `after, before, kind, resourceId`, kind
COMPARE_REPLACE, before/after complete values. At least one is PRESENT and the
two values must differ canonically: absence→presence creates, presence→absence
removes, presence→different presence replaces. Resource lists/effects are
strictly ASCII resourceId-sorted and unique, at most64 entries. Planned effects
are nonempty. Resource identity is the pair of the actual adapter configuration
identity and resourceId; the string alone is never a global resource or path.

No relation proves that supplied bytes came from a project, exhaust all effects,
encode a semantically valid record or materialize the exact worker result.
Actual adapter/source admission must prove the entire mapping, scope and bytes
before planning/apply. This explicit authority boundary cannot be replaced by
boolean claims, familiar ID spellings, matching hashes or empty arrays.

#### Complete request and fresh observation

`project-mutation-request/v1` has exactly `actionPlanDigest,
adapterConfigurationDigest, dispositionDigest, schemaVersion, sourceCycleId,
subjectDigest, subjectKind, transactionId`. The four digest fields are Digest; schemaVersion is its literal; sourceCycleId and
transactionId are Uuid; subjectKind is ACTION or WORKER_RESULT, never candidate.
The mutation owner allocates transactionId once before plan, retains one
immutable request/plan for it and never issues a fresh transaction to disguise
an interrupted apply. It is neither a dispatch attempt nor a future cycle.

The request relation takes `(dispositionInput, stdoutBytesOrNull,
stderrBytesOrNull, disposition, request)`. Apply the complete round401 disposition
relation, require APPLY/PROJECT, and bind actionPlanDigest/dispositionDigest to
the actual designated identities. Bind adapterConfigurationDigest to the actual
moduleInput adapter configuration, sourceCycleId to its cycle, and subject kind/
digest to the bound disposition target. The same old-action/new-result and
review joins remain. Nonapplying/wrong-owner/rejected/unknown/candidate contexts
refuse before a project request can be admitted. Allocation/current transaction
uniqueness and actual source/credential authority remain the caller's duty.

An inline mutation observation has exactly `adapterConfigurationDigest,
observationId, observedAt, result`. It uses Digest, Uuid, Time and this union:

| result.kind | Complete members |
| --- | --- |
| COMPLETE | `kind, projectFacts, resources`; complete existing project-facts/v1 in state COMPLETE, plus the complete sorted 0–64 resource observations |
| UNAVAILABLE | `kind, reason`; SOURCE_UNAVAILABLE or OBSERVATION_TIMEOUT |
| UNKNOWN | `kind, reason`; SOURCE_UNKNOWN or OBSERVATION_INVALID |

The nested project facts use their own actual source observation identity;
outer observationId identifies the complete resource read. Each observation's
outer and nested IDs must differ, and both must differ from the original module
snapshot/policy IDs and every earlier dry/pre/post observation ID supplied to
the relation. The outer configuration digest and actual project-facts binding
must equal the request's actual configuration/project. A complete resource
observation is a supplied full census for this operation, not a global source
census. New source IDs/times and exact bytes still do not prove currentness.

#### Complete dry-run plan

`project-mutation-plan/v1` has exactly `observationDigest, outcome, requestDigest,
schemaVersion, transactionId`. Request is Digest, transaction Uuid, literal
schema; observationDigest is Digest except the two null cases below. Inline
observation identity is SHA256(C(the full observation)), without a new schema.

| outcome.kind | Complete members / rules |
| --- | --- |
| PLANNED | `effects, kind, resourceIntents`; complete nonempty effect list and the managed allocation census below |
| REFUSED | `kind, reason`; TARGET_MOVED, CAPABILITY_REMOVED, POLICY_REFUSED, UNSUPPORTED_ACTION or RESOURCE_CONFLICT |
| UNKNOWN | `kind, reason`; OBSERVATION_UNAVAILABLE, OBSERVATION_INVALID, SOURCE_UNAVAILABLE, SOURCE_UNKNOWN or ADMISSION_UNPROVEN |

UNKNOWN/OBSERVATION_UNAVAILABLE and UNKNOWN/OBSERVATION_INVALID alone require
observationDigest:null; all other cells require Digest. Opposite-arm fields are
absent. The full plan relation takes `(dispositionInput, stdoutBytesOrNull,
stderrBytesOrNull, disposition, request, observationOrNull, plan)` and applies
the request relation. Plan requestDigest/transactionId equal the actual request.
For OBSERVATION_UNAVAILABLE require observation input exactly null. For
OBSERVATION_INVALID require present non-null input that fails observation shape
or configuration/ID binding. A valid observation cannot claim that reason.
All other outcomes require its actual bound full observation and equal digest.

UNAVAILABLE observations permit only UNKNOWN/SOURCE_UNAVAILABLE; UNKNOWN
observations permit only UNKNOWN/SOURCE_UNKNOWN. A COMPLETE observation permits
PLANNED, REFUSED or UNKNOWN/ADMISSION_UNPROVEN. For PLANNED, its resource IDs must
exactly equal the effects' complete census and each actual value must equal
that effect's before value. The original action capability must still be present
in the configuration; a complete observation with no effect cannot masquerade
as a plan. Semantics of the target/code-to-effect mapping and refusal diagnostics
are source-owner claims, never granted by matching this relation. They must be
substantiated before the real owner acts. The entire actual worker-result
materialization/review/context remains bound through the request relation.

This plan contains every before/after byte preimage before the first write.
It is a dry run, not permission, a successful apply, or a new project snapshot
claiming an unobserved future state. Effect order is the canonical resource
order and does not imply a multi-resource atomic primitive.

#### Complete exact-plan apply receipt and interrupted effects

`project-apply-receipt/v1` has exactly `afterObservationDigest,
beforeObservationDigest, completedEffectCount, outcome, phase, planDigest,
requestDigest, resources, schemaVersion, transactionId`. Plan/request are Digest,
transaction Uuid, literal schema; observation references are Digest or null by
the cells below. completedEffectCount is a canonical decimal string0–64.
Phase is BEFORE_WRITE, WRITING or AFTER_WRITE. An owner may claim WRITING even
before the first effect completes; an attempted uncertain write is not a
proven no-write refusal. Completed count records a claimed known contiguous
prefix in canonical effect order; it is not independent progress authority.

| outcome.kind | Complete members / exact phase and observation constraints |
| --- | --- |
| APPLIED | `kind`; AFTER_WRITE, both observation references non-null, count equals the entire planned effect length |
| REFUSED | `kind, reason`; PRECONDITION_MOVED, POLICY_REFUSED, SESSION_UNHEALTHY, CREDENTIALS_REFUSED or PLAN_REFUSED; BEFORE_WRITE, count0, before reference non-null, after reference null |
| UNKNOWN | `kind, reason`; OBSERVATION_UNAVAILABLE, OBSERVATION_INVALID, AUTHORITY_UNPROVEN, WRITE_UNPROVEN, READBACK_UNPROVEN or PROGRESS_UNPROVEN; BEFORE_WRITE requires count0 and after:null; WRITING/AFTER_WRITE permit either observation null; all phases retain any supplied observations |

UNKNOWN AFTER_WRITE requires count equal effect length, while WRITING permits
0 through length. REFUSED diagnoses a proven no-write stop; possibly issued or
partial effects can only be UNKNOWN. No FAILED/APPLIED_WITH_WARNINGS or false
success cell hides partial mutations. Unknown counts and phases are retained
claims, not a right to retry, reclaim resources or complete the cycle.

The apply relation takes `(dispositionInput, stdoutBytesOrNull,
stderrBytesOrNull, disposition, request, dryObservationOrNull, plan,
expectedPlanDigest, beforeObservationOrNull, afterObservationOrNull, receipt)`.
First apply the full plan relation, require PLANNED, recompute the exact actual
plan identity and equal it to the supplied canonical expectedPlanDigest (the
future CLI --plan-id). Bind receipt plan/request identities and transaction to
those actual records; count cannot exceed effect length. No fresh plan is
created by this relation. Missing/moved/wrong-owner upstream data refuses
without fabricating receipt references.

Every present before/after observation must pass its complete intrinsic and
configuration/ID binding, with IDs distinct across all supplied earlier phases;
its digest must equal the corresponding receipt reference. A null observation
requires a null reference and conversely. An unparseable observation may be
reported only as omitted evidence in UNKNOWN; its private diagnostic bytes
cannot obtain a canonical observation identity. Known observations' outer
clock order is dry<=before<=after whenever both compared records are present;
contradictory ordering refuses rather than manufacturing elapsed time.

APPLIED requires COMPLETE before and after observations. Before projectFacts'
frontierDigest equals the dry-run COMPLETE project's full frontierDigest;
before resource census/values equal the entire dry-run census. After census is
exactly the effect IDs with each value equal its planned after value. Its actual
complete projectFacts is retained and bound to the same owner/project, never
computed from the effects as though observed. The adapter must additionally
prove those complete project facts faithfully reflect all actual resource
changes and the immutable subject. Matching postimage alone does not prove
this transaction performed it, nor permit a receipt from another transaction.

REFUSED requires a COMPLETE before observation. PRECONDITION_MOVED requires
its full project frontier or resource census/values differ from dry-run.
Other refusal reasons may have unchanged bytes but require actual external
owner evidence of their named gate and proof no write was attempted; pure
structure does not establish that evidence. An unavailable/unknown before
observation cannot yield known refusal. UNKNOWN may retain any intrinsically
valid observation state or omit unavailable evidence; it grants no effect,
absence, completion or recovery permission even if every byte matches.

Runtime must revalidate the exact plan/target, live session, breaker, installed
source, complete materialization/review and current credential generation/scope
immediately before its first effect. Review workers never receive mutation
credentials; the actual project adapter owner executes. On interruption the
same transaction/plan may continue only from authentic current known progress;
completed effects are read back and never reapplied. An already committed
transaction returns its identical immutable receipt/preimages, not a new
application. Unknown progress, unowned change or possibly repeated effect
refuses/retains UNKNOWN. Caller counts, arrays, directories, IDs or a private
transaction journal cannot establish that proof; actual public event/history
and owner admission remain required. No production recovery primitive is
selected here.

Managed execution allocations are separate from project resources changed by
the effects. A plan's resourceIntents reuse round398's complete sorted inline
intent array, here restricted to ADAPTER and at most64 rows. Its owner is the
actual bound project adapter. Every apply receipt additionally contains
`resources`, the exact full round398 allocation-claim array in plan-intent
order, with ownerTransactionId equal this mutation transactionId. All field,
ID/state/null/uniqueness rules are reused. The apply relation requires exact
intent/census equality, including refused/unattempted/uncertain rows; omission
cannot prove no allocation. APPLIED requires every intent ALLOCATED. REFUSED
permits an ALLOCATED prefix then NOT_ALLOCATED suffix, never UNKNOWN. UNKNOWN
retains all claims and every known ID without granting absence. Partial
allocation can therefore precede known no-project-write refusal, while
ambiguous allocation cannot be a known refusal. Zero intents/claims are allowed
only when the actual owner proves that this operation needs no managed
allocation; empty arrays, read-only access or omitted effects do not prove it.
The plan is still allocation-free; actual allocation occurs under the same
owner before mutation in step13. Native handle closure remains its owner's
duty. Step14 must join the full dispatch and mutation allocation censuses and
cannot discard the latter after partial/unknown apply. These claims select no
allocator or reclamation primitive and never certify their own completeness.
Retained public evidence is not a worker allocation to delete. Actual resources
allocated by dispatch/apply owners still require step14's complete reclaim
receipt, including failed/unknown paths. APPLIED does not certify reclamation,
release activation, independent review or final-cycle authority.

#### Canonical identities, verification and footprint

All three family identities are SHA256 of
`UTF8("orchestration-platform") || 00 || UTF8(schemaVersion) || 00 || u32be(1)
|| 07 || u64be(byteLength(C(record))) || C(record)`.
Nested value/effect/observation records introduce no public family or wrapper.
The request→plan→receipt graph is acyclic; none embeds its own ID or a downstream
receipt. Complete canonical serializers/parsers retain every refusal/unknown
arm and all actual inline byte preimages.

This group's predicted implementation is one bounded contract file, generic
parser/registry/harness wiring and independently authored compatibility tests.
Required vectors include all create/remove/replace/value/observation/phase/
outcome/null cells; unknown fields/versions/scalars/hostile objects; empty and
maximum byte/effect bounds; independently generated complete frames/hashes;
actual context/raw-review/target/request/config/plan-id/transaction/observation
substitutions; exact pre/post values; known no-write versus partial UNKNOWN;
and wrong release-owner/candidate admission. Runtime idempotency, complete
source/effect mapping and authority are explicit later execution gates, not
claimed by structural vectors.

The source proposal touches this ledger, an additive ISS013 note and round404
only. No runtime, dependency, command, service, provider, compiler/probe,
production apply or ISS026 work. Independent literal review and host planning/
format/board checks precede code/landing. The author claims no self-PASS or
completed ISS041. Unknown projection semantics or another public family is a
named replan boundary rather than permission to invent an executor.
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

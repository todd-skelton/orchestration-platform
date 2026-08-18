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
pending proposals among the other ten pointer kinds in registry/`Dp`/
predecessor/mutation order, and requires zero unrelated `PENDING` or `UNKNOWN`.
It is an ordinary single-epoch commit run: it appends the exact
`authority-history-record/v1` record (with `Dh` under `authority-history/v1`)
and then performs the authority CAS as its final action, executes no checkpoint
after that CAS under either epoch, and its
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

| Digest            | Schema/domain                                                                                                                                               | Framed parts                                                                                                                                                                                                                                                                                                                                   | Canonical path                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dphys`           | `physical-destination-identity/v1`                                                                                                                          | stable host/custody namespace raw32, OS, physical volume raw32, filesystem raw32, nearest stable non-symlink ancestor object raw32, leaf identity kind, canonical physical leaf bytes, canonical schema bytes                                                                                                                                  | `state-mutation-destination-identities/<Dphys>/identity.json`                                                                                                  |
| `Dobs`            | `physical-destination-locator-observation-receipt/v1`                                                                                                       | `Dphys` raw32, helper digest raw32, helper version text, logical-locator digest raw32, resolved-locator-readback digest raw32, case-comparison profile text, Unicode-normalization profile text, custody-instance digest raw32, custody-receipt digest raw32, native-identity-readback digest raw32, disposition text, canonical receipt bytes | `.../<Dphys>/observations/<Dobs>.json`; lock/time/validity remain fields inside canonical receipt bytes only                                                   |
| `Ddest`           | `bootstrap-destination-identity/v1`                                                                                                                         | `Dphys` raw32 only                                                                                                                                                                                                                                                                                                                             | `state-mutation-destination-owners/<Ddest>/`                                                                                                                   |
| `Dov`             | schema `state-mutation-destination-owner-value/v1`; domain `destination-owner-value/v1`                                                                     | `Ddest` raw32, owner ordinal bounded decimal string, lifecycle, installation ID, anchor `Dba` raw32, canonical value bytes                                                                                                                                                                                                                     | `.../<Ddest>/values/<mutation-id>.json`                                                                                                                        |
| `Dor`             | schema `state-mutation-destination-owner-cas-proposal/v1`; domain `destination-owner-receipt/v1`                                                            | `Ddest` raw32, mutation ID raw32, nullable prior `Dot` raw32, nullable prior `Dov` raw32, nullable prior `Dor` raw32, successor `Dov` raw32, transition text, position digest raw32, canonical proposal bytes                                                                                                                                  | `.../<Ddest>/proposals/<prior-tip-or-genesis>/<mutation-id>.json`                                                                                              |
| `Dot`             | schema `state-mutation-destination-owner-current-tip/v1`; domain `destination-owner-tip/v1`                                                                 | `Ddest` raw32, `Dov` raw32, `Dor` raw32, canonical current-tip bytes                                                                                                                                                                                                                                                                           | `.../<Ddest>/current.json`                                                                                                                                     |
| `Doc`             | schema `state-mutation-destination-owner-conflict-receipt/v1`; domain `destination-owner-conflict/v1`                                                       | `Ddest` raw32, mutation ID raw32, losing `Dor` raw32, losing `Dov` raw32, winning `Dot` raw32, winning `Dov` raw32, winning `Dor` raw32, canonical conflict bytes                                                                                                                                                                              | `.../<Ddest>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json`                                                                                              |
| owner mutation ID | no record schema; domain `destination-owner-mutation-id/v1`                                                                                                 | `Ddest` raw32, canonical current path text, nullable prior `Dot` raw32, nullable prior `Dov` raw32, nullable prior `Dor` raw32, owner ordinal bounded decimal string, transition text, successor `Dov` raw32, installation ID text, `Dba` raw32, source text, transition-evidence digest raw32                                                 | selects the exact value/proposal path; timestamps/readbacks excluded                                                                                           |
| `Dsrc`            | schema `state-mutation-destination-owner-successor-review-core/v1`; domain `destination-owner-successor-review-core/v1`                                     | `Ddest` raw32, prior RETIRED `Dot` raw32, prior RETIRED `Dov` raw32, prior RETIRED `Dor` raw32, teardown-archive digest raw32, prior-installation canonical bytes, successor installation ID text, successor-authority canonical bytes, independent-review canonical bytes, canonical review-core bytes                                        | `.../<Ddest>/successor-review-cores/<prior-retired-tip>/<Dsrc>.json`; excludes successor `Dba`, `Dov`, `Dor`, `Dot`, their readbacks, and `Dsrp`               |
| `Dsrp`            | schema `state-mutation-destination-owner-successor-review-post-selection-receipt/v1`; domain `destination-owner-successor-review-post-selection-receipt/v1` | `Dsrc` raw32, successor `Dba` raw32, successor `Dov` raw32, successor `Dor` raw32, successor `Dot` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, destination-lock/custody-observation digest raw32, canonical post-selection bytes                                                            | `.../<Ddest>/successor-review-post-selection-receipts/<successor-owner-tip>.json`; downstream and excluded from review core, anchor, and owner selection graph |

#### Normative external bootstrap schema ledger

This ledger is incorporated by `contract-decisions.md` and is the sole source
of literal JSON member names for the external bootstrap family. Every listed
record is a detached closed record. Members below are listed in ascending UTF-16
code-unit order, which is also canonical JSON order. Omission, addition,
renaming, null outside a declared nullable position, wrong scalar, wrong-case or
future enum, and a conceptual label substituted for a literal member all
refuse before digest comparison.

The scalar names used only in this ledger mean:

- `sha256`, `uuid-v7`, `safe-decimal`, and `timestamp` have the global closed
  grammars in `contract-decisions.md`;
- `external-token` is 1--128 ASCII characters matching
  `[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}` and is case-sensitive;
- `leaf-bytes` is unpadded RFC 4648 base64url text whose decode is 1--3072
  bytes and whose re-encoding is byte-for-byte identical; and
- `record<X>` is one nested closed record of exact schema `X`, never a digest,
  path, open object, or array.

Physical identity and observation have these exact censuses:

| Schema                                                | Exact members and types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `physical-destination-identity/v1`                    | `ancestorObjectIdentityDigest:sha256`, `canonicalPhysicalLeafBytes:leaf-bytes`, `filesystemIdentityDigest:sha256`, `hostCustodyNamespaceDigest:sha256`, `leafIdentityKind:EXISTING_DIRECTORY_ENTRY\|ABSENT_DIRECTORY_ENTRY`, `operatingSystem:DARWIN\|LINUX\|WINDOWS`, `physicalVolumeIdentityDigest:sha256`, `schemaVersion:physical-destination-identity/v1`                                                                                                                                                                                                                                                                    |
| `physical-destination-locator-observation-receipt/v1` | `caseComparisonProfile:CASE_INSENSITIVE_LOWERCASE\|CASE_SENSITIVE`, `custodyInstanceDigest:nullable sha256`, `custodyReceiptDigest:nullable sha256`, `disposition:ADMITTED\|UNSUPPORTED\|UNKNOWN`, `helperDigest:sha256`, `helperVersion:external-token`, `logicalLocatorDigest:sha256`, `nativeIdentityReadbackDigest:nullable sha256`, `observedAt:timestamp`, `physicalDestinationIdentityDigest:sha256`, `resolvedLocatorReadbackDigest:nullable sha256`, `schemaVersion:physical-destination-locator-observation-receipt/v1`, `unicodeNormalizationProfile:NFC\|NFD`, `validFrom:timestamp`, `validUntil:nullable timestamp` |

The physical leaf is exactly one decoded component. It must contain neither `/`
nor `\\`, `.` or `..`, an alternate-stream separator, NUL, a drive or URI
prefix, a trailing dot/space, nor a platform-reserved spelling. Its selected
profile is exactly `DARWIN + CASE_INSENSITIVE_LOWERCASE + NFD`,
`WINDOWS + CASE_INSENSITIVE_LOWERCASE + NFC`, or
`LINUX + CASE_SENSITIVE + NFC`; all other combinations refuse. The two leaf
kinds distinguish an existing non-symlink directory entry from a single absent
canonical child of the named stable ancestor. Symlinks, junctions, reparse
points, aliases, and multi-component suffixes refuse rather than choosing a
third kind.

For `ADMITTED`, all four nullable observation digests are non-null,
`validFrom <= observedAt`, and `validUntil` is null or strictly later than
`observedAt`. For `UNSUPPORTED|UNKNOWN`, all four are null. A mutation requires
an `ADMITTED` receipt whose interval contains the injected current UTC and whose
helper/profile/custody fields equal the selected probe admission. Observation
time and interval fields remain inside canonical receipt bytes and are not
separate framed parts.

`Dphys` frames, in order, `hostCustodyNamespaceDigest`, `operatingSystem`,
`physicalVolumeIdentityDigest`, `filesystemIdentityDigest`,
`ancestorObjectIdentityDigest`, `leafIdentityKind`, the decoded raw leaf bytes,
and canonical identity bytes under domain `physical-destination-identity/v1`.
`Dobs` frames `physicalDestinationIdentityDigest`, `helperDigest`,
`helperVersion`, `logicalLocatorDigest`, `resolvedLocatorReadbackDigest`,
`caseComparisonProfile`, `unicodeNormalizationProfile`,
`custodyInstanceDigest`, `custodyReceiptDigest`,
`nativeIdentityReadbackDigest`, `disposition`, and canonical observation bytes
under domain `physical-destination-locator-observation-receipt/v1`. `Ddest`
continues to frame raw `Dphys` alone. The identity and observation persist only
at the two paths already stated above and are FULL_REQUIRED.

The destination-owner records have these exact censuses:

| Schema                                                 | Exact members and types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-mutation-destination-owner-value/v1`            | `anchorDigest:sha256`, `anchorReceiptDigest:nullable sha256`, `anchorTipDigest:nullable sha256`, `anchorValueDigest:nullable sha256`, `destinationDigest:sha256`, `installationId:uuid-v7`, `lifecycle:ACTIVE\|CONSUMED\|RETIRED`, `ownerOrdinal:safe-decimal`, `schemaVersion:state-mutation-destination-owner-value/v1`, `successorReviewCoreDigest:nullable sha256`, `teardownArchiveDigest:nullable sha256`                                                                                                                                         |
| `state-mutation-destination-owner-cas-proposal/v1`     | `destinationDigest:sha256`, `mutationId:sha256`, `observationDigest:sha256`, `positionDigest:sha256`, `priorReceiptDigest:nullable sha256`, `priorTipDigest:nullable sha256`, `priorValueDigest:nullable sha256`, `proposedAt:timestamp`, `schemaVersion:state-mutation-destination-owner-cas-proposal/v1`, `source:BOOTSTRAP_GENESIS\|ANCHOR_CONSUMED\|ANCHOR_RETIRED\|SUCCESSOR_REVIEW`, `successorValueDigest:sha256`, `transition:ACTIVATE_GENESIS\|CONSUME\|RETIRE_UNUSED\|RETIRE_CONSUMED\|ACTIVATE_SUCCESSOR`, `transitionEvidenceDigest:sha256` |
| `state-mutation-destination-owner-current-tip/v1`      | `destinationDigest:sha256`, `proposalReceiptDigest:sha256`, `schemaVersion:state-mutation-destination-owner-current-tip/v1`, `valueDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `state-mutation-destination-owner-conflict-receipt/v1` | `conflictAt:timestamp`, `destinationDigest:sha256`, `losingProposalReceiptDigest:sha256`, `losingSuccessorValueDigest:sha256`, `mutationId:sha256`, `schemaVersion:state-mutation-destination-owner-conflict-receipt/v1`, `winningProposalReceiptDigest:sha256`, `winningTipDigest:sha256`, `winningValueDigest:sha256`                                                                                                                                                                                                                                 |
| `state-mutation-destination-owner-teardown-archive/v1` | `anchorRetiredReceiptDigest:sha256`, `anchorRetiredTipDigest:sha256`, `anchorRetiredValueDigest:sha256`, `destinationDigest:sha256`, `installationId:uuid-v7`, `observationDigest:sha256`, `priorOwnerReceiptDigest:sha256`, `priorOwnerTipDigest:sha256`, `priorOwnerValueDigest:sha256`, `schemaVersion:state-mutation-destination-owner-teardown-archive/v1`, `teardownReceiptDigest:sha256`                                                                                                                                                         |

The owner transition matrix is exhaustive:

| Transition           | Prior triple                                                                                     | Successor value                                                                                                          | Required branch evidence                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVATE_GENESIS`   | all three prior members null; no current tip; owner ordinal `"0"`                                | `ACTIVE`; anchor triple, successor review, and teardown archive all null                                                 | source `BOOTSTRAP_GENESIS`; `transitionEvidenceDigest` equals the reviewed bootstrap-grant digest; observation is current `ADMITTED` |
| `CONSUME`            | all non-null and select `ACTIVE` for the same destination, installation, anchor, and ordinal `n` | `CONSUMED`, ordinal `n+1`; selected anchor `CONSUMED` tip/value/receipt are all non-null; review/archive null            | source `ANCHOR_CONSUMED`; evidence equals the selected anchor-consumed tip digest                                                    |
| `RETIRE_UNUSED`      | all non-null and select `ACTIVE`                                                                 | `RETIRED`, ordinal `n+1`; selected anchor `RETIRED` triple and teardown archive are non-null; review null                | source `ANCHOR_RETIRED`; evidence equals the archive digest                                                                          |
| `RETIRE_CONSUMED`    | all non-null and select `CONSUMED`                                                               | same requirements as `RETIRE_UNUSED`                                                                                     | source `ANCHOR_RETIRED`; evidence equals the archive digest                                                                          |
| `ACTIVATE_SUCCESSOR` | all non-null and select `RETIRED`                                                                | `ACTIVE`, ordinal `n+1`, a different installation and anchor; anchor triple/archive null; successor review core non-null | source `SUCCESSOR_REVIEW`; evidence equals the successor-review-core digest                                                          |

Every non-genesis proposal has an all-non-null exact prior `Dot/Dov/Dor` triple;
mixed nullability refuses. The successor ordinal is exactly zero for genesis and
exactly prior plus one otherwise. The proposal's destination, successor value,
transition branch, installation/anchor facts, observation, review/archive, and
prior triple must equal the recomputed value and selected readbacks. A same
mutation and same canonical bytes is idempotent; a different selected winner is
represented only by the closed conflict receipt.

`Dov`, `Dor`, `Dot`, and `Doc` use the domains and framed-part order in the
external digest table immediately above. The teardown-archive digest uses
domain `state-mutation-destination-owner-teardown-archive/v1` and frames, in
order, destination, prior owner tip/value/receipt, installation, selected anchor
RETIRED tip/value/receipt, teardown receipt, observation, and canonical archive
bytes. The owner mutation ID uses domain `destination-owner-mutation-id/v1` and
frames destination, canonical current path, nullable prior tip/value/receipt,
owner ordinal, transition, successor value, installation, anchor, source, and
transition evidence. Proposed/read-back timestamps never enter that identity.

The successor-review records have these exact censuses:

| Schema                                                                        | Exact members and types                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `destination-owner-prior-installation/v1`                                     | `anchorDigest:sha256`, `anchorRetiredReceiptDigest:sha256`, `anchorRetiredTipDigest:sha256`, `anchorRetiredValueDigest:sha256`, `installationId:uuid-v7`, `projectId:uuid-v7`, `schemaVersion:destination-owner-prior-installation/v1`, `stateRootDigest:sha256`                                                                                                                                                                                             |
| `destination-owner-successor-authority/v1`                                    | `bootstrapGrantDigest:sha256`, `bootstrapTransactionId:uuid-v7`, `globalBootstrapIdentityDigest:sha256`, `installationId:uuid-v7`, `projectId:uuid-v7`, `reviewedInstallerDigest:sha256`, `reviewedReleaseManifestDigest:sha256`, `reviewedReleaseSubjectDigest:sha256`, `schemaVersion:destination-owner-successor-authority/v1`, `stateRootDigest:sha256`                                                                                                  |
| `destination-owner-independent-review/v1`                                     | `authorIdentityDigest:sha256`, `candidateDigest:sha256`, `reviewReceiptDigest:sha256`, `reviewedAt:timestamp`, `reviewerIdentityDigest:sha256`, `schemaVersion:destination-owner-independent-review/v1`                                                                                                                                                                                                                                                      |
| `state-mutation-destination-owner-successor-review-core/v1`                   | `destinationDigest:sha256`, `independentReview:record<destination-owner-independent-review/v1>`, `priorInstallation:record<destination-owner-prior-installation/v1>`, `priorRetiredReceiptDigest:sha256`, `priorRetiredTipDigest:sha256`, `priorRetiredValueDigest:sha256`, `schemaVersion:state-mutation-destination-owner-successor-review-core/v1`, `successorAuthority:record<destination-owner-successor-authority/v1>`, `teardownArchiveDigest:sha256` |
| `state-mutation-destination-owner-successor-review-post-selection-receipt/v1` | `destinationLockCustodyObservationDigest:sha256`, `observedAt:timestamp`, `proposalReadbackDigest:sha256`, `reviewCoreDigest:sha256`, `schemaVersion:state-mutation-destination-owner-successor-review-post-selection-receipt/v1`, `successorAnchorDigest:sha256`, `successorOwnerProposalReceiptDigest:sha256`, `successorOwnerTipDigest:sha256`, `successorOwnerValueDigest:sha256`, `tipReadbackDigest:sha256`, `valueReadbackDigest:sha256`              |

The independent-review author and reviewer digests must differ. `candidateDigest`
equals the canonical digest of the other review inputs excluding the review
record itself; the authenticated `reviewReceiptDigest` is issued externally by
the admitted review path and cannot be candidate-produced. Prior installation
and RETIRED anchor/owner triples equal the teardown archive and selected prior
records. Successor authority installation differs from the prior installation;
its destination remains the same and its anchor is not present in the core.

`Dsrc` uses the already-stated domain and frames destination, prior RETIRED
tip/value/receipt, teardown archive, canonical prior-installation record,
successor installation ID, canonical successor-authority record, canonical
independent-review record, and canonical core bytes. `Dsrp` uses its stated
domain and frames review core, successor anchor, successor owner
value/proposal/tip, the three readbacks, destination-lock/custody observation,
and canonical receipt bytes. Its observed time remains only inside canonical
bytes. The post-selection receipt is created only after the selected owner tip
and exact readbacks exist; no member of it may enter `Dsrc`, the successor
anchor, or the owner value/proposal/tip graph.

The bootstrap-anchor and E0 records have these exact censuses:

| Schema                                                       | Exact members and types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state-mutation-bootstrap-anchor/v1`                         | `abiDigest:sha256`, `authorityPathInstanceDigest:sha256`, `bootstrapGrantDigest:sha256`, `bootstrapTransactionId:uuid-v7`, `custodyInstanceDigest:sha256`, `custodyReceiptDigest:sha256`, `destinationDigest:sha256`, `globalBootstrapIdentityDigest:sha256`, `helperDigest:sha256`, `helperProfileDigest:sha256`, `independentReviewReceiptDigest:sha256`, `installationId:uuid-v7`, `lockProfileDigest:sha256`, `projectId:uuid-v7`, `reviewedInstallerDigest:sha256`, `schemaVersion:state-mutation-bootstrap-anchor/v1`, `stateComponentProfileDigest:sha256`, `stateRootDigest:sha256`, `successorReviewCoreDigest:nullable sha256`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `state-mutation-bootstrap-anchor-lifecycle-value/v1`         | `anchorDigest:sha256`, `bootstrapGenesisCoreDigest:nullable sha256`, `lifecycle:ACTIVE\|CONSUMED\|RETIRED`, `lifecycleOrdinal:safe-decimal`, `schemaVersion:state-mutation-bootstrap-anchor-lifecycle-value/v1`, `selectedAuthorityPathInstanceDigest:nullable sha256`, `selectedAuthorityReceiptDigest:nullable sha256`, `selectedAuthorityTipDigest:nullable sha256`, `selectedAuthorityValueDigest:nullable sha256`, `selectionPostReceiptDigest:nullable sha256`, `teardownReceiptDigest:nullable sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `state-mutation-bootstrap-anchor-cas-proposal/v1`            | `anchorDigest:sha256`, `mutationId:sha256`, `priorReceiptDigest:nullable sha256`, `priorTipDigest:nullable sha256`, `priorValueDigest:nullable sha256`, `proposedAt:timestamp`, `schemaVersion:state-mutation-bootstrap-anchor-cas-proposal/v1`, `source:BOOTSTRAP_CREATE\|E0_SELECTION\|TEARDOWN`, `successorValueDigest:sha256`, `transition:ACTIVATE\|CONSUME\|RETIRE_UNUSED\|RETIRE_CONSUMED`, `transitionEvidenceDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `state-mutation-bootstrap-anchor-current-tip/v1`             | `anchorDigest:sha256`, `proposalReceiptDigest:sha256`, `schemaVersion:state-mutation-bootstrap-anchor-current-tip/v1`, `valueDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `state-mutation-bootstrap-anchor-conflict-receipt/v1`        | `anchorDigest:sha256`, `conflictAt:timestamp`, `losingProposalReceiptDigest:sha256`, `losingSuccessorValueDigest:sha256`, `mutationId:sha256`, `schemaVersion:state-mutation-bootstrap-anchor-conflict-receipt/v1`, `winningProposalReceiptDigest:sha256`, `winningTipDigest:sha256`, `winningValueDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `bootstrap-proposed-genesis-input/v1`                        | `authorityPathInstanceDigest:sha256`, `bootstrapGenesisCoreDigest:sha256`, `expectedAuthorityValueDigest:sha256`, `genesisBootstrapInputDigest:sha256`, `genesisHistoryRecordDigest:sha256`, `genesisPositionDigest:sha256`, `globalIdentityDigest:sha256`, `schemaVersion:bootstrap-proposed-genesis-input/v1`, `successorCoreDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bootstrap-reviewed-installer/v1`                            | `installerArtifactDigest:sha256`, `installerSourceDigest:sha256`, `reviewReceiptDigest:sha256`, `schemaVersion:bootstrap-reviewed-installer/v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bootstrap-reviewed-helper/v1`                               | `abiDigest:sha256`, `helperDigest:sha256`, `helperProfileDigest:sha256`, `lockProfileDigest:sha256`, `schemaVersion:bootstrap-reviewed-helper/v1`, `stateComponentProfileDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `state-mutation-bootstrap-anchor-use-intent/v1`              | `anchorActiveReceiptDigest:sha256`, `anchorActiveTipDigest:sha256`, `anchorActiveValueDigest:sha256`, `anchorDigest:sha256`, `bootstrapTransactionId:uuid-v7`, `custodyInstanceDigest:sha256`, `destinationDigest:sha256`, `destinationOwnerActiveReceiptDigest:sha256`, `destinationOwnerActiveTipDigest:sha256`, `destinationOwnerActiveValueDigest:sha256`, `destinationStateRootDigest:sha256`, `expectedAuthorityValueDigest:sha256`, `expiresAt:timestamp`, `proposedGenesisInput:record<bootstrap-proposed-genesis-input/v1>`, `reviewedHelper:record<bootstrap-reviewed-helper/v1>`, `reviewedInstaller:record<bootstrap-reviewed-installer/v1>`, `schemaVersion:state-mutation-bootstrap-anchor-use-intent/v1`, `startedAt:timestamp`                                                                                                                                                                                                                                                                                                         |
| `state-mutation-bootstrap-anchor-consumption-receipt/v1`     | `anchorDigest:sha256`, `bootstrapGenesisCoreDigest:sha256`, `bootstrapTransactionId:uuid-v7`, `consumedAt:timestamp`, `custodyInstanceDigest:sha256`, `destinationOwnerActiveReceiptDigest:sha256`, `destinationOwnerActiveTipDigest:sha256`, `destinationOwnerActiveValueDigest:sha256`, `destinationOwnerConsumedReceiptDigest:sha256`, `destinationOwnerConsumedTipDigest:sha256`, `destinationOwnerConsumedValueDigest:sha256`, `destinationStateRootDigest:sha256`, `externalAnchorProposalReadbackDigest:sha256`, `externalAnchorTipReadbackDigest:sha256`, `externalAnchorValueReadbackDigest:sha256`, `externalRuntimeCustodyDigest:sha256`, `runtimePostSelectionReceiptDigest:sha256`, `runtimeProposalReadbackDigest:sha256`, `runtimeReceiptDigest:sha256`, `runtimeTipDigest:sha256`, `runtimeTipReadbackDigest:sha256`, `runtimeValueDigest:sha256`, `runtimeValueReadbackDigest:sha256`, `schemaVersion:state-mutation-bootstrap-anchor-consumption-receipt/v1`, `selectedAuthorityPathInstanceDigest:sha256`, `useIntentDigest:sha256` |
| `state-mutation-bootstrap-anchor-teardown-receipt/v1`        | `anchorDigest:sha256`, `destinationDigest:sha256`, `externalArchiveDigest:sha256`, `priorAnchorReceiptDigest:sha256`, `priorAnchorTipDigest:sha256`, `priorAnchorValueDigest:sha256`, `processCustodyProofDigest:sha256`, `retirementTransition:RETIRE_UNUSED\|RETIRE_CONSUMED`, `schemaVersion:state-mutation-bootstrap-anchor-teardown-receipt/v1`, `selectedOwnerReceiptDigest:sha256`, `selectedOwnerTipDigest:sha256`, `selectedOwnerValueDigest:sha256`, `teardownEvidenceDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `state-mutation-bootstrap-anchor-lifecycle-archive/v1`       | `anchorDigest:sha256`, `archivedReceiptDigest:sha256`, `archivedTipDigest:sha256`, `archivedValueDigest:sha256`, `lifecycle:ACTIVE\|CONSUMED`, `schemaVersion:state-mutation-bootstrap-anchor-lifecycle-archive/v1`, `teardownReceiptDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `state-mutation-bootstrap-genesis-core/v1`                   | `anchorDigest:sha256`, `authorityPathInstanceDigest:sha256`, `authorityValueDigest:sha256`, `bootstrapTransactionId:uuid-v7`, `destinationAbsenceDigest:sha256`, `destinationDigest:sha256`, `destinationOwnerActiveReceiptDigest:sha256`, `destinationOwnerActiveTipDigest:sha256`, `destinationOwnerActiveValueDigest:sha256`, `genesisBootstrapInputDigest:sha256`, `genesisHistoryRecordDigest:sha256`, `genesisPositionDigest:sha256`, `globalIdentityDigest:sha256`, `schemaVersion:state-mutation-bootstrap-genesis-core/v1`, `successorCoreDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `state-mutation-bootstrap-genesis-post-selection-receipt/v1` | `anchorDigest:sha256`, `authorityPathInstanceDigest:sha256`, `bootstrapGenesisCoreDigest:sha256`, `observedAt:timestamp`, `proposalReadbackDigest:sha256`, `receiptDigest:sha256`, `schemaVersion:state-mutation-bootstrap-genesis-post-selection-receipt/v1`, `tipDigest:sha256`, `tipReadbackDigest:sha256`, `valueDigest:sha256`, `valueReadbackDigest:sha256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

`globalBootstrapIdentityDigest` uses domain `global-bootstrap-identity/v1` and
frames, in order, installation, project, destination, state root, custody
instance, bootstrap transaction, reviewed installer, independent review,
bootstrap grant, authority path, lock profile, helper, helper profile, ABI,
state-component profile, and custody receipt. It excludes the identity digest,
schema literal, successor review, anchor digest, owner/anchor lifecycle, E0,
readbacks, and timestamps. `Dba` then frames that raw digest and canonical
anchor bytes under `state-mutation-bootstrap-anchor/v1`. Genesis anchors require
`successorReviewCoreDigest:null`; successor anchors require it non-null and equal
the exact `Dsrc` that names the same successor authority. No `Dsrp` is admitted
into either digest.

The anchor lifecycle matrix is exhaustive:

| Transition        | Prior triple                                    | Successor value                                                       | Required branch evidence                                                       |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ACTIVATE`        | all three prior members null and no current tip | `ACTIVE`, ordinal `"0"`; all E0 and teardown members null             | source `BOOTSTRAP_CREATE`; evidence equals the anchor's bootstrap-grant digest |
| `CONSUME`         | all non-null and select `ACTIVE`                | `CONSUMED`, ordinal `n+1`; all six E0 members non-null; teardown null | source `E0_SELECTION`; evidence equals `selectionPostReceiptDigest` (`Dgp`)    |
| `RETIRE_UNUSED`   | all non-null and select `ACTIVE`                | `RETIRED`, ordinal `n+1`; E0 members null; teardown non-null          | source `TEARDOWN`; evidence equals teardown receipt                            |
| `RETIRE_CONSUMED` | all non-null and select `CONSUMED`              | `RETIRED`, ordinal `n+1`; E0 members null; teardown non-null          | source `TEARDOWN`; evidence equals teardown receipt                            |

The six E0 members beginning with `bootstrapGenesisCoreDigest` and ending with
`selectionPostReceiptDigest` in the lifecycle value are an all-null/all-non-null
group. In `CONSUMED`, they select the same authority `Dp/Dv/Dr/Dt` and `Dgp`
named by `Dbg`, the use intent, and readbacks. An anchor never returns from
RETIRED, never re-activates in place, and never has a bare-absence successor.
All non-genesis proposal prior members are non-null and select exactly the named
lifecycle/ordinal; mixed nullability refuses.

`Dbav`, `Dbar`, `Dbat`, and `Dbac` use the domains and exact framed-part orders
in the anchor digest table below. The anchor mutation ID uses domain
`bootstrap-anchor-mutation-id/v1` and frames anchor, canonical current path,
nullable prior tip/value/receipt, lifecycle ordinal, transition, successor
value, source, and transition evidence. It excludes timestamps/readbacks. The
lifecycle archive digest uses its schema literal as domain and frames anchor,
archived tip/value/receipt, archived lifecycle, teardown receipt, and canonical
archive bytes.

The use intent is create-once while both owner and anchor ACTIVE triples are
selected and read back under destination-then-anchor lock order. `startedAt`
must precede `expiresAt`; the interval is at most 15 minutes. Its destination,
installation (through `Dba`), transaction, state root, custody, helper, and
reviewed installer equal the anchor and selected bootstrap grant. Its proposed
genesis input recomputes `Dsc`, `Dgb`, GENESIS `Dh`, expected E0 `Dv`, `Dbg`,
and genesis-position digest; the separately repeated expected value equals the
nested value. The use-intent digest uses domain
`bootstrap-anchor-use-intent/v1` and frames Dba, anchor ACTIVE tip/value/receipt,
owner ACTIVE tip/value/receipt, transaction, destination/state root, custody,
canonical proposed-genesis input, expected E0 value, canonical reviewed
installer, canonical reviewed helper, start, expiry, and canonical intent
bytes. It excludes every E0 proposal/receipt/tip/readback and every CONSUMED
record.

`Dbg` uses domain `state-mutation-bootstrap-genesis-core/v1` and frames, in
order, anchor, global identity, transaction, authority path, E0 value,
genesis-position digest, and canonical core bytes. Every additional core member
is equal-bound through those canonical bytes to `Dgb`, GENESIS `Dh`, `Dsc`, the
selected owner ACTIVE triple, and the exact destination absence observation.
The core excludes its digest, proposal, `Dr`, tip, `Dt`, readbacks, `Dgp`, every
CONSUMED fact, and the final consumption receipt.

The E0 proposal is the existing closed
`pointer-cas-proposal-receipt/v1` bootstrap-producer arm. It has null selected
epoch, producer kind `REVIEWED_BOOTSTRAP_GENESIS`, target authority `Dp`,
successor `Dv`, and producer digest equal `Dbg`; no worker/candidate verdict is
a producer. `Dgp` uses domain
`state-mutation-bootstrap-genesis-post-selection-receipt/v1` and frames anchor,
`Dbg`, authority path, value, receipt, tip, the three readbacks, and canonical
receipt bytes. `observedAt` remains only inside canonical bytes. Every digest
and readback is recomputed from the exact selected E0 graph.

The anchor consumption receipt uses domain
`bootstrap-anchor-consumption-receipt/v1` and frames, in order, Dba, Dbg,
authority Dp/Dv/Dr/Dt, Dgp, transaction, use intent, destination state root,
custody, runtime value/proposal/tip/post readbacks, owner ACTIVE
tip/value/receipt, owner CONSUMED tip/value/receipt, external anchor
value/proposal/tip readbacks, external/runtime custody, consumption time, and
canonical receipt bytes. The anchor teardown receipt uses domain
`bootstrap-anchor-teardown-receipt/v1` and frames Dba, prior anchor
tip/value/receipt, retirement transition, destination, selected owner
tip/value/receipt, teardown evidence, process/custody proof, external archive,
and canonical receipt bytes.

The final cross-record order and equality matrix is normative:

1. A current `ADMITTED` observation selects one `Dphys/Ddest`; under the sole
   destination lock, genesis owner ACTIVE selects one installation and `Dba`.
2. A successor owner requires selected prior owner RETIRED, exact teardown
   archive, `Dsrc`, a new anchor that embeds `Dsrc`, selected successor owner
   ACTIVE that embeds both, and downstream `Dsrp`. Anchor ACTIVE, use intent,
   E0, and context issuance all refuse until `Dsrp` is read back.
3. A create-once unexpired use intent equal-binds owner ACTIVE, anchor ACTIVE,
   transaction, grant, proposed `Dgb/Dsc/Dh/Dbg`, expected E0 value, helper,
   review, custody, and state root. Expiry without such an intent permits only
   teardown after a fresh destination-absence proof; a pre-expiry intent permits
   recovery only of its exact transaction.
4. E0 selects the precomputed value and immutable core, then `Dgp` binds its
   selected proposal/tip/readbacks. Anchor CONSUMED embeds E0 and `Dgp`; owner
   CONSUMED embeds that exact anchor triple; only then is the final consumption
   receipt created and read back. No upstream record contains that downstream
   receipt.
5. Retirement selects anchor RETIRED from ACTIVE or CONSUMED, writes its
   lifecycle archive and teardown receipt, writes the owner teardown archive,
   then selects owner RETIRED bound to the anchor triple/archive. No receipt or
   archive names a future owner value.
6. Exact reinstall requires the same physical identity, selected owner and
   anchor CONSUMED triples, final consumption receipt, original use intent,
   original `Dbg`, original E0 `Dp/Dv/Dr/Dt`, and original `Dgp`. It creates no
   owner, anchor, intent, core, proposal, history record, or capability.
7. Any moved physical identity, stale/expired unmatched intent, different
   transaction/installation/project/state root, mismatched observation or
   custody, missing readback/archive/post receipt, mixed nullability, forked
   prior triple, reused grant, author-equals-reviewer, or self-produced review
   refuses before E0 context issuance.

All records in this ledger are FULL_REQUIRED at the canonical paths in the two
external tables and `externalAuthorityPaths`; the three nested review records
and three nested use-intent records exist only inside their parent canonical
bytes. There is no enumeration, alternate path, deletion, compaction,
diagnostic namespace, receipt alias, migration, or READY-only form. The ledger
defines structural contracts only and grants no lock, live handle,
installation, promotion, runtime mutation, or self-certification authority.

`physical-destination-identity/v1` excludes helper, path spelling, comparison
profile, custody instance, receipt, time, and readback. `Ddest` has no part other
than raw `Dphys`. Those changing observation/owner facts therefore cannot move
the destination lock. A successor review core excludes new `Dba` and the
successor owner graph; only its downstream post-selection receipt may bind them.

Exactly one FULL_REQUIRED destination-owner pointer and non-symlink
`destination-owner.lock` exist at
`<bootstrap-custody-root>/state-mutation-destination-owners/<Ddest>/`. Its
generic value/proposal/conflict storage and `current.json` use
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

| Digest             | Schema/domain                                                                                                     | Framed parts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Canonical path and exclusions                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Dba`              | `state-mutation-bootstrap-anchor/v1`                                                                              | `globalBootstrapIdentity` raw32, canonical anchor bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `state-mutation-authority-anchors/<installation>/anchor.json`; successor anchor binds review-core digest, never its post-selection receipt                                     |
| `Dbav`             | schema `state-mutation-bootstrap-anchor-lifecycle-value/v1`; domain `bootstrap-anchor-value/v1`                   | `Dba` raw32, lifecycle text, canonical lifecycle-value bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `.../<installation>/values/<mutation-id>.json`; selected value excludes proposal/receipt/tip/conflict                                                                          |
| `Dbar`             | schema `state-mutation-bootstrap-anchor-cas-proposal/v1`; domain `bootstrap-anchor-receipt/v1`                    | `Dba` raw32, mutation ID raw32, nullable prior `Dbat` raw32, nullable prior `Dbav` raw32, nullable prior `Dbar` raw32, successor `Dbav` raw32, transition text, canonical proposal bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `.../<installation>/proposals/<prior-tip-or-genesis>/<mutation-id>.json`; successor tip/readback excluded                                                                      |
| `Dbat`             | schema `state-mutation-bootstrap-anchor-current-tip/v1`; domain `bootstrap-anchor-tip/v1`                         | `Dba` raw32, `Dbav` raw32, `Dbar` raw32, canonical current-tip bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `.../<installation>/current.json`                                                                                                                                              |
| `Dbac`             | schema `state-mutation-bootstrap-anchor-conflict-receipt/v1`; domain `bootstrap-anchor-conflict/v1`               | `Dba` raw32, mutation ID raw32, losing `Dbar` raw32, losing `Dbav` raw32, winning `Dbat` raw32, winning `Dbav` raw32, winning `Dbar` raw32, canonical conflict bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `.../<installation>/conflicts/<prior-tip-or-genesis>/<mutation-id>.json`; requires an actual different selected winner                                                         |
| anchor use intent  | schema `state-mutation-bootstrap-anchor-use-intent/v1`; domain `bootstrap-anchor-use-intent/v1`                   | `Dba` raw32, selected ACTIVE `Dbat` raw32, selected ACTIVE `Dbav` raw32, selected ACTIVE `Dbar` raw32, bootstrap transaction text, destination-state-root digest raw32, custody-instance digest raw32, proposed-genesis-input canonical bytes, expected E0 `Dv` raw32, reviewed-installer/helper canonical bytes, started-at text, expires-at text, canonical use-intent bytes                                                                                                                                                                                                                                                                                                                                                                                                            | `.../<installation>/use-intents/<transaction>.json`; E0 proposal/`Dr`/tip/`Dt`/readbacks excluded                                                                              |
| `Dbg`              | `state-mutation-bootstrap-genesis-core/v1`                                                                        | `Dba` raw32, global-identity digest raw32, transaction text, authority `Dp` raw32, E0 `Dv` raw32, genesis-position digest raw32, canonical core bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `installation/bootstrap/state-mutation-authority-genesis/<transaction>/core.json`; excludes proposal bytes, `Dr`, tip bytes, `Dt`, readbacks, and both post-selection receipts |
| `Dgp`              | `state-mutation-bootstrap-genesis-post-selection-receipt/v1`                                                      | `Dba` raw32, `Dbg` raw32, authority `Dp` raw32, `Dv` raw32, `Dr` raw32, `Dt` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, canonical receipt bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `installation/bootstrap/state-mutation-authority-genesis/<transaction>/post-selection-receipt.json`; downstream and excluded from E0 value/core/proposal/tip                   |
| anchor consumption | schema `state-mutation-bootstrap-anchor-consumption-receipt/v1`; domain `bootstrap-anchor-consumption-receipt/v1` | `Dba` raw32, `Dbg` raw32, authority `Dp` raw32, `Dv` raw32, `Dr` raw32, `Dt` raw32, `Dgp` raw32, bootstrap transaction text, use-intent digest raw32, destination-state-root digest raw32, custody-instance digest raw32, runtime value-readback digest raw32, runtime proposal-readback digest raw32, runtime tip-readback digest raw32, runtime post-readback digest raw32, owner ACTIVE `Dot` raw32, owner ACTIVE `Dov` raw32, owner ACTIVE `Dor` raw32, owner CONSUMED `Dot` raw32, owner CONSUMED `Dov` raw32, owner CONSUMED `Dor` raw32, external anchor value-readback digest raw32, external anchor proposal-readback digest raw32, external anchor tip-readback digest raw32, external/runtime lock-helper-custody digest raw32, consumption-time text, canonical receipt bytes | `.../<installation>/consumption-receipts/<mutation-id>.json`; excluded from E0 and selected anchor CONSUMED graph                                                              |
| anchor teardown    | schema `state-mutation-bootstrap-anchor-teardown-receipt/v1`; domain `bootstrap-anchor-teardown-receipt/v1`       | `Dba` raw32, selected prior `Dbat` raw32, selected prior `Dbav` raw32, selected prior `Dbar` raw32, retirement transition text, `Ddest` raw32, selected owner `Dot` raw32, selected owner `Dov` raw32, selected owner `Dor` raw32, teardown-evidence digest raw32, process/custody-proof digest raw32, external archive digest raw32, canonical teardown-receipt bytes                                                                                                                                                                                                                                                                                                                                                                                                                    | `.../<installation>/teardown-receipts/<mutation-id>.json`; cannot authorize ACTIVE or CONSUMED                                                                                 |

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

The shared closed `state-mutation-successor-authority-core/v1` record has
exactly these fields, in this order for digest framing: `G`, authority `Dp`,
successor authority ordinal, reviewed release manifest digest, reviewed
installed-bytes digest, reviewed release-subject digest, independent-review
receipt digest, reviewed-operation kind, reviewed-operation digest, successor
helper digest, helper-profile digest, ABI digest, lock-profile digest,
state-component-profile digest, custody-instance digest, and admitted custody-
observation digest. `reviewed-operation kind` is the closed union
`BOOTSTRAP_INSTALL|STABLE_PROMOTION`. Its digest `Dop` is derived, never
caller-supplied:

#### Normative simplified-authority schema ledger

This ledger is authoritative for the simplified current authority surfaces.
Every table lists canonical JSON member names in ascending UTF-16 code-unit
order, which is also their canonical serialized order. A branch has exactly the
listed members: an unlisted member is forbidden, and a member is nullable only
when its type explicitly says nullable. `sha256` is a lowercase 64-hex string,
`safe-decimal` is the bounded canonical decimal string defined below,
`uuid-v7`, `timestamp`, and `relative-path` use the platform scalar rules, and
`record<S>` means a recursively closed record whose `schemaVersion` literal is
`S`. Formula names such as `G`, `Dp`, and `Dsc` are explanatory aliases, never
JSON member names. The literal names here replace every conceptual label used
elsewhere in this document.

`reviewed-authority-operation/v1` is a closed two-arm record. Its
`BOOTSTRAP_INSTALL` member census is:

| JSON member                      | Type / literal                            |
| -------------------------------- | ----------------------------------------- |
| `bootstrapGrantDigest`           | `sha256`                                  |
| `bootstrapTransactionId`         | `uuid-v7`                                 |
| `independentReviewReceiptDigest` | `sha256`                                  |
| `installedBytesDigest`           | `sha256`                                  |
| `operationKind`                  | literal `BOOTSTRAP_INSTALL`               |
| `releaseManifestDigest`          | `sha256`                                  |
| `releaseSubjectDigest`           | `sha256`                                  |
| `reviewedInstallerDigest`        | `sha256`                                  |
| `schemaVersion`                  | literal `reviewed-authority-operation/v1` |

Its `STABLE_PROMOTION` member census is:

| JSON member                                  | Type / literal                            |
| -------------------------------------------- | ----------------------------------------- |
| `independentReviewReceiptDigest`             | `sha256`                                  |
| `installedBytesDigest`                       | `sha256`                                  |
| `operationKind`                              | literal `STABLE_PROMOTION`                |
| `predecessorActiveReleasePathInstanceDigest` | `sha256`                                  |
| `predecessorActiveReleaseReceiptDigest`      | `sha256`                                  |
| `predecessorActiveReleaseTipDigest`          | `sha256`                                  |
| `predecessorActiveReleaseValueDigest`        | `sha256`                                  |
| `promotionTransactionId`                     | `uuid-v7`                                 |
| `releaseManifestDigest`                      | `sha256`                                  |
| `releaseSubjectDigest`                       | `sha256`                                  |
| `schemaVersion`                              | literal `reviewed-authority-operation/v1` |
| `successorActiveReleasePathInstanceDigest`   | `sha256`                                  |
| `successorActiveReleaseReceiptDigest`        | `sha256`                                  |
| `successorActiveReleaseTipDigest`            | `sha256`                                  |
| `successorActiveReleaseValueDigest`          | `sha256`                                  |

It is a composed input with no persistence path. `Dop` uses digest domain
`reviewed-authority-operation/v1`; its framed parts are the branch byte, then
the non-`schemaVersion` members in the semantic order shown by the two formulas
immediately below. It excludes authority-history facts, successor-authority
value/proposal/tip, registry slots, readbacks, and timestamps.

`state-mutation-successor-authority-core/v1` (`Dsc`) has this exact census:

| JSON member                        | Type / literal                                       |
| ---------------------------------- | ---------------------------------------------------- |
| `abiDigest`                        | `sha256`                                             |
| `admittedCustodyObservationDigest` | `sha256`                                             |
| `authorityPathInstanceDigest`      | `sha256`                                             |
| `custodyInstanceDigest`            | `sha256`                                             |
| `globalIdentityDigest`             | `sha256`                                             |
| `independentReviewReceiptDigest`   | `sha256`                                             |
| `lockProfileDigest`                | `sha256`                                             |
| `operationKind`                    | enum `BOOTSTRAP_INSTALL`, `STABLE_PROMOTION`         |
| `reviewedInstalledBytesDigest`     | `sha256`                                             |
| `reviewedOperationDigest`          | `sha256` (`Dop`)                                     |
| `reviewedReleaseManifestDigest`    | `sha256`                                             |
| `reviewedReleaseSubjectDigest`     | `sha256`                                             |
| `schemaVersion`                    | literal `state-mutation-successor-authority-core/v1` |
| `stateComponentProfileDigest`      | `sha256`                                             |
| `successorAuthorityOrdinal`        | `safe-decimal`                                       |
| `successorHelperDigest`            | `sha256`                                             |
| `successorHelperProfileDigest`     | `sha256`                                             |

It is a composed input with no persistence path. `Dsc` uses digest domain
`state-mutation-successor-authority-core/v1`; framed parts are, in order,
`globalIdentityDigest`, `authorityPathInstanceDigest`,
`successorAuthorityOrdinal`, `reviewedReleaseManifestDigest`,
`reviewedInstalledBytesDigest`, `reviewedReleaseSubjectDigest`,
`independentReviewReceiptDigest`, the `operationKind` branch byte,
`reviewedOperationDigest`, `successorHelperDigest`,
`successorHelperProfileDigest`, `abiDigest`, `lockProfileDigest`,
`stateComponentProfileDigest`, `custodyInstanceDigest`,
`admittedCustodyObservationDigest`, and canonical core bytes. It excludes every
predecessor/history field and every successor selecting or downstream field.

`authority-history-genesis-bootstrap-input/v1` (`Dgb`) has this exact census:

| JSON member                           | Type / literal                                         |
| ------------------------------------- | ------------------------------------------------------ |
| `bootstrapAnchorActiveReceiptDigest`  | `sha256`                                               |
| `bootstrapAnchorActiveTipDigest`      | `sha256`                                               |
| `bootstrapAnchorActiveValueDigest`    | `sha256`                                               |
| `bootstrapAnchorDigest`               | `sha256` (`Dba`)                                       |
| `bootstrapGrantDigest`                | `sha256`                                               |
| `bootstrapTransactionId`              | `uuid-v7`                                              |
| `destinationDigest`                   | `sha256` (`Ddest`)                                     |
| `destinationOwnerActiveReceiptDigest` | `sha256`                                               |
| `destinationOwnerActiveTipDigest`     | `sha256`                                               |
| `destinationOwnerActiveValueDigest`   | `sha256`                                               |
| `globalBootstrapIdentityDigest`       | `sha256`                                               |
| `schemaVersion`                       | literal `authority-history-genesis-bootstrap-input/v1` |
| `successorCoreDigest`                 | `sha256` (`Dsc`)                                       |
| `useIntentDigest`                     | `sha256`                                               |

It is a composed input with no persistence path. `Dgb` uses the same literal as
its digest domain. Its ordered framed parts are `destinationDigest`, owner
ACTIVE tip/value/receipt, `bootstrapAnchorDigest`, anchor ACTIVE
tip/value/receipt, `useIntentDigest`, `globalBootstrapIdentityDigest`,
`bootstrapTransactionId`, `bootstrapGrantDigest`, `successorCoreDigest`, and
canonical input bytes. E0 selection, CONSUMED facts, consumption, and all
readbacks are excluded.

`authority-history-genesis-selection-evidence/v1` (`Dgse`) is a non-persisted
composed validation record with this exact census:

| JSON member                               | Type / literal                                            |
| ----------------------------------------- | --------------------------------------------------------- |
| `anchorConsumedProposalReadbackDigest`    | `sha256`                                                  |
| `anchorConsumedReceiptDigest`             | `sha256`                                                  |
| `anchorConsumedTipDigest`                 | `sha256`                                                  |
| `anchorConsumedTipReadbackDigest`         | `sha256`                                                  |
| `anchorConsumedValueDigest`               | `sha256`                                                  |
| `anchorConsumedValueReadbackDigest`       | `sha256`                                                  |
| `anchorConsumptionReceiptDigest`          | `sha256`                                                  |
| `bootstrapAnchorActiveReceiptDigest`      | `sha256`                                                  |
| `bootstrapAnchorActiveTipDigest`          | `sha256`                                                  |
| `bootstrapAnchorActiveValueDigest`        | `sha256`                                                  |
| `bootstrapAnchorDigest`                   | `sha256`                                                  |
| `bootstrapGenesisCoreDigest`              | `sha256` (`Dbg`)                                          |
| `bootstrapGrantDigest`                    | `sha256`                                                  |
| `bootstrapTransactionId`                  | `uuid-v7`                                                 |
| `destinationDigest`                       | `sha256`                                                  |
| `destinationOwnerActiveReceiptDigest`     | `sha256`                                                  |
| `destinationOwnerActiveTipDigest`         | `sha256`                                                  |
| `destinationOwnerActiveValueDigest`       | `sha256`                                                  |
| `genesisBootstrapInputDigest`             | `sha256` (`Dgb`)                                          |
| `globalBootstrapIdentityDigest`           | `sha256`                                                  |
| `historyRecordDigest`                     | `sha256` (`Dh`)                                           |
| `ownerConsumedProposalReadbackDigest`     | `sha256`                                                  |
| `ownerConsumedReceiptDigest`              | `sha256`                                                  |
| `ownerConsumedTipDigest`                  | `sha256`                                                  |
| `ownerConsumedTipReadbackDigest`          | `sha256`                                                  |
| `ownerConsumedValueDigest`                | `sha256`                                                  |
| `ownerConsumedValueReadbackDigest`        | `sha256`                                                  |
| `schemaVersion`                           | literal `authority-history-genesis-selection-evidence/v1` |
| `selectedAuthorityPathInstanceDigest`     | `sha256`                                                  |
| `selectedAuthorityProposalReadbackDigest` | `sha256`                                                  |
| `selectedAuthorityReceiptDigest`          | `sha256`                                                  |
| `selectedAuthorityTipDigest`              | `sha256`                                                  |
| `selectedAuthorityTipReadbackDigest`      | `sha256`                                                  |
| `selectedAuthorityValueDigest`            | `sha256`                                                  |
| `selectedAuthorityValueReadbackDigest`    | `sha256`                                                  |
| `selectionPostReceiptDigest`              | `sha256` (`Dgp`)                                          |
| `successorCoreDigest`                     | `sha256` (`Dsc`)                                          |
| `useIntentDigest`                         | `sha256`                                                  |

`Dgse` uses the same literal as its digest domain. Its framed parts are exactly
the fields in the semantic order in the `Dgse` formula below followed by
canonical evidence bytes. It has no canonical path, pointer, receipt, or
mutation authority. It excludes any new pointer/proposal/tip that would select
`Dgse` and any field downstream of owner/anchor CONSUMED readback.

`state-mutation-authority-rotation-id/v1` (`Drot`) has this exact census:

| JSON member                           | Type / literal                                    |
| ------------------------------------- | ------------------------------------------------- |
| `globalIdentityDigest`                | `sha256`                                          |
| `priorHeadOrdinal`                    | `safe-decimal`                                    |
| `priorRecordDigest`                   | `sha256`                                          |
| `retiringAuthorityPathInstanceDigest` | `sha256`                                          |
| `retiringAuthorityReceiptDigest`      | `sha256`                                          |
| `retiringAuthorityTipDigest`          | `sha256`                                          |
| `retiringAuthorityValueDigest`        | `sha256`                                          |
| `reviewedOperationDigest`             | `sha256` (`Dop`)                                  |
| `rotationTransactionId`               | `uuid-v7`                                         |
| `schemaVersion`                       | literal `state-mutation-authority-rotation-id/v1` |
| `successorAuthorityOrdinal`           | `safe-decimal`                                    |
| `successorCoreDigest`                 | `sha256` (`Dsc`)                                  |

It is a composed input with no persistence path. `Drot` uses the same literal
as its digest domain. Its framed parts are `globalIdentityDigest`,
`rotationTransactionId`, retiring authority path/tip/value/receipt,
`priorHeadOrdinal`, `priorRecordDigest`, `successorAuthorityOrdinal`,
`reviewedOperationDigest`, and `successorCoreDigest`. It excludes target
mutation ID, successor authority value/receipt/tip, history-record digest,
registry slots, readbacks, and timestamps.

The serialized history record always has `schemaVersion` literal
`authority-history-record/v1`; `authority-history/v1` is only its digest domain
and is not a parseable record version. GENESIS has exactly:

| JSON member                   | Type / literal                        |
| ----------------------------- | ------------------------------------- |
| `genesisBootstrapInputDigest` | `sha256` (`Dgb`)                      |
| `globalIdentityDigest`        | `sha256`                              |
| `ordinal`                     | literal `"0"`                         |
| `predecessorKind`             | literal `GENESIS_LITERAL`             |
| `recordKind`                  | literal `GENESIS`                     |
| `schemaVersion`               | literal `authority-history-record/v1` |
| `successorCoreDigest`         | `sha256` (`Dsc`)                      |

ROTATION has exactly:

| JSON member                           | Type / literal                        |
| ------------------------------------- | ------------------------------------- |
| `globalIdentityDigest`                | `sha256`                              |
| `ordinal`                             | positive `safe-decimal`               |
| `predecessorKind`                     | literal `RECORD`                      |
| `priorHeadOrdinal`                    | `safe-decimal`, exactly `ordinal - 1` |
| `priorRecordDigest`                   | `sha256`                              |
| `recordKind`                          | literal `ROTATION`                    |
| `retiringAuthorityPathInstanceDigest` | `sha256`                              |
| `retiringAuthorityReceiptDigest`      | `sha256`                              |
| `retiringAuthorityTipDigest`          | `sha256`                              |
| `retiringAuthorityValueDigest`        | `sha256`                              |
| `rotationInputDigest`                 | `sha256` (`Drot`)                     |
| `schemaVersion`                       | literal `authority-history-record/v1` |
| `successorCoreDigest`                 | `sha256` (`Dsc`)                      |

Both persist only at
`installation/state-mutation-authority-history/records/<ordinal>.json`.
GENESIS `Dh` uses domain `authority-history/v1` and parts `0x00`,
`globalIdentityDigest`, `ordinal`, the `GENESIS_LITERAL` tag,
`genesisBootstrapInputDigest`, `successorCoreDigest`, and canonical record
bytes. ROTATION uses that domain and parts `0x01`, `globalIdentityDigest`,
`ordinal`, `priorHeadOrdinal`, `priorRecordDigest`, retiring authority
path/tip/value/receipt, `rotationInputDigest`, `successorCoreDigest`, and
canonical record bytes. Both exclude the successor value/proposal/tip/head,
registry slots, selector evidence, and downstream receipts/readbacks.

The selected `state-mutation-authority-value/v1` has exactly:

| JSON member                        | Type / literal                              |
| ---------------------------------- | ------------------------------------------- |
| `activeReleasePathInstanceDigest`  | `sha256`                                    |
| `activeReleaseReceiptDigest`       | `sha256`                                    |
| `activeReleaseTipDigest`           | `sha256`                                    |
| `activeReleaseValueDigest`         | `sha256`                                    |
| `admittedCustodyObservationDigest` | `sha256`                                    |
| `authorityOrdinal`                 | `safe-decimal`                              |
| `custodyInstanceDigest`            | `sha256`                                    |
| `globalIdentityDigest`             | `sha256`                                    |
| `headOrdinal`                      | `safe-decimal`, equal to `authorityOrdinal` |
| `headRecordDigest`                 | `sha256` (`Dh`)                             |
| `helperAbiDigest`                  | `sha256`                                    |
| `helperDigest`                     | `sha256`                                    |
| `helperProfileDigest`              | `sha256`                                    |
| `installationId`                   | `uuid-v7`                                   |
| `lockProfileDigest`                | `sha256`                                    |
| `priorAuthorityReceiptDigest`      | nullable `sha256`                           |
| `priorAuthorityTipDigest`          | nullable `sha256`                           |
| `priorAuthorityValueDigest`        | nullable `sha256`                           |
| `projectId`                        | `uuid-v7`                                   |
| `schemaVersion`                    | literal `state-mutation-authority-value/v1` |
| `stateComponentProfileDigest`      | `sha256`                                    |
| `stateRootDigest`                  | `sha256`                                    |

The three predecessor members are all null only for GENESIS and all non-null
only for ROTATION. The generic `pointer-value/v1` digest binds this record to
the authority `Dp`; generic `pointer-cas-proposal-receipt/v1` and
`pointer-current-tip/v1` select it. Its immutable value bytes persist at
`installation/pointer-cas/<authority-Dp>/values/<mutation-id>.json`; the
selected tip is the sole `installation/state-mutation-authority.json`. No
separate head record exists. The value
excludes its selecting proposal/receipt/tip, successor registry slot,
post-selection readbacks, `Dgse`, and any later chain record.

The adjacent simplified public-v1 rows were audited for conceptual-only names.
No additional implementer-chosen label remains: `state-mutation-global-identity/v1`
uses the literal installation/project/state/custody/authority-path members in
the `G` formula; `pointer-mutation-run-checkpoint-evidence/v1` uses literal
`segment`, `core`, `selectorSelection`, `postSelectionObservation`, and nullable
`terminalResolution`; `pointer-evidence-slot/v1` uses literal `schemaVersion`,
`pointerKind`, and nullable `selectedEvidence`; and
`pointer-evidence-packet/v1` uses literal `schemaVersion`, `purpose`,
`globalIdentity`, `currentAuthoritySelection`, `authorityHistoryBinding`,
`currentCommit`, and `evidenceSlots`. The fixed
`pointer-mutation-unknown-evidence/v1` record uses only `schemaVersion`,
`targetPathInstanceDigest`, `targetMutationId`, `category`, `reason`,
`observationDigest`, `observedByteLength`, and `observedAt`; there is no
`observation`, message, path, or array member. Those established rows retain
their existing digest formulas and paths; this amendment introduces no alias
or second representation for them.

```text
BOOTSTRAP_INSTALL Dop = H(F(reviewed-authority-operation/v1,
  0x00, bootstrap-transaction-id text, bootstrap-grant-digest raw32,
  reviewed-installer-digest raw32, release-subject-digest raw32,
  independent-review-receipt-digest raw32, release-manifest-digest raw32,
  installed-bytes-digest raw32))

STABLE_PROMOTION Dop = H(F(reviewed-authority-operation/v1,
  0x01, promotion-transaction-id text,
  predecessor-active-release Dp/Dt/Dv/Dr raw32,
  successor-active-release Dp/Dt/Dv/Dr raw32,
  release-subject-digest raw32, independent-review-receipt-digest raw32,
  release-manifest-digest raw32, installed-bytes-digest raw32))
```

The successor-core digest is:

```text
Dsc = H(F(state-mutation-successor-authority-core/v1,
  G raw32, authority Dp raw32, successor ordinal bounded-decimal,
  release manifest raw32, installed bytes raw32, release subject raw32,
  independent review raw32, operation-kind tag, Dop raw32, helper raw32,
  helper profile raw32, ABI raw32, lock profile raw32,
  state-component profile raw32, custody instance raw32,
  custody observation raw32, canonical core bytes))
```

Both history arms use this exact schema and digest. It excludes predecessor
authority, history predecessor/head, history record digest, successor authority
value/`Dv`, proposal/`Dr`, tip/`Dt`, and every selector readback.
The parser recomputes `Dop` and `Dsc`; every repeated `G`, authority `Dp`,
ordinal, release, review, operation, helper/profile/ABI/lock/state-component,
and custody field must equal its enclosing record, selected authority value,
and admitted observation. A mismatch refuses rather than choosing one copy.

`authority-history/v1` is one FULL_REQUIRED append-only chain of the closed
`authority-history-record/v1` union:

- `GENESIS` has exactly `recordKind=GENESIS`, `G`, ordinal `"0"`,
  `predecessorKind=GENESIS_LITERAL`, `Dgb`, and `Dsc`; it has no predecessor
  record digest, retiring authority, or `Drot`. `Dgb` is:

  ```text
  H(F(authority-history-genesis-bootstrap-input/v1,
    Ddest raw32, selected owner ACTIVE Dot/Dov/Dor raw32, Dba raw32,
    selected anchor ACTIVE Dbat/Dbav/Dbar raw32, use-intent digest raw32,
    globalBootstrapIdentity raw32, bootstrap transaction ID text,
    bootstrap grant digest raw32, Dsc raw32, canonical input bytes))
  ```

  The GENESIS record digest is:

  ```text
  Dh = H(F(authority-history/v1, 0x00, G raw32, "0" bounded-decimal,
    GENESIS_LITERAL tag, Dgb raw32, Dsc raw32, canonical record bytes))
  ```

- `ROTATION` has exactly `recordKind=ROTATION`, `G`, ordinal greater than zero,
  prior-head ordinal, prior-record digest, retiring authority `Dp/Dt/Dv/Dr`,
  `Drot`, and `Dsc`. Its prior-head ordinal is exactly ordinal minus one and its
  prior-record digest is both the chain predecessor and the head record digest
  selected by the retiring authority value. `Drot` is derived as:

  ```text
  Drot = H(F(state-mutation-authority-rotation-id/v1,
    G raw32, rotation-transaction-id text, retiring Dp/Dt/Dv/Dr raw32,
    prior-head ordinal bounded-decimal, prior-record digest raw32,
    successor ordinal bounded-decimal, Dop raw32, Dsc raw32))
  ```

  There is no separate or caller-selected rotation-operation identity. Target mutation ID and expected
  successor authority `Dv` are cross-bound with `Drot` only downstream in the
  CAS-armed commit intent/evidence and are excluded from `Drot` and the record, avoiding a
  `Dh→Dv→Dh` cycle. The ROTATION record digest is:

  ```text
  Dh = H(F(authority-history/v1, 0x01, G raw32, ordinal bounded-decimal,
    prior-head ordinal bounded-decimal, prior-record digest raw32,
    retiring Dp/Dt/Dv/Dr raw32, Drot raw32, Dsc raw32,
    canonical record bytes))
  ```

Both record arms exclude the successor authority value, proposal, tip,
selected head, selector readbacks, and any downstream receipt. The selected
successor authority value alone binds `headOrdinal=record.ordinal` and
`headRecordDigest=Dh`.

GENESIS admission additionally requires the downstream closed
`authority-history-genesis-selection-evidence/v1` composition. Its digest is:

```text
Dgse = H(F(authority-history-genesis-selection-evidence/v1,
  Dgb raw32, Dh raw32, Dsc raw32, Dbg raw32,
  Ddest raw32, selected owner ACTIVE Dot/Dov/Dor raw32, Dba raw32,
  selected anchor ACTIVE Dbat/Dbav/Dbar raw32, use-intent digest raw32,
  globalBootstrapIdentity raw32, bootstrap transaction ID text,
  bootstrap grant digest raw32,
  selected E0 authority Dp/Dt/Dv/Dr raw32,
  E0 value/proposal/tip readback digests raw32, Dgp raw32,
  selected anchor CONSUMED Dbat/Dbav/Dbar raw32,
  selected owner CONSUMED Dot/Dov/Dor raw32,
  anchor-consumption receipt digest raw32,
  anchor CONSUMED value/proposal/tip readback digest raw32 each,
  owner CONSUMED value/proposal/tip readback digest raw32 each,
  canonical evidence bytes))
```

This downstream digest
is required to issue the live E0 context but is excluded from `Dgb`, `Dh`,
`Dsc`, the E0 value, `Dbg`, proposal, and tip. ACTIVE facts therefore bind the
upstream GENESIS record while CONSUMED/post-selection facts close admission
without a digest cycle.
`Dgse` is a pure composed-validation digest over existing selected/read-back
records; it has no canonical storage path, selected pointer, or receipt file.
Every repeated `Ddest`, ACTIVE triple, `Dba`, use intent, bootstrap identity/
transaction/grant, and `Dsc` in `Dgse` must equal `Dgb`; its E0 `Dp/Dv` and
`Dh` must equal the selected authority value, and every readback digest must
match the bytes parsed for that named record.

History uses FULL_REQUIRED content-addressed records at canonical
ordinal-derived paths beneath
`installation/state-mutation-authority-history/`. No history deletion,
compaction, or degraded-audit mode exists. The current selected
authority is trusted only through the live custody context; historical
producer projections derive from the selected authority value and the fully
walked chain. A stale head or projection refuses after rotation.

```text
installation/state-mutation-authority-history/records/<ordinal>.json
```

The walk constructs the path of record `n+1` from `n` and never enumerates a
directory. Verification walks the complete chain from genesis and compares the
selected head ordinal and record digest. A missing record at or below the head
refuses. A head-plus-one record is accepted only when its ordinal is head plus
one, its predecessor digest equals the selected head record digest, and its
`Drot`, `Dsc`, and successor facts equal the selected CAS-armed journal and its
create-once intent record. With no selected armed intent, any head-plus-one
file refuses. The path at head plus two must be absent; a file outside the canonical
ordinal paths carries no authority. Missing, forked, reordered, truncated, or
digest-mismatched chains refuse. Rotation occurs at most a few times per
release, so the deliberately O(n) full walk is bounded in practice; no membership proof, sparse
tree, secondary node inventory, or authenticated directory census exists.
Chain-record set completeness is proven by the walk alone; records are
ordinary content-addressed files and no materialization coordinator exists.

The exact history domains are `state-mutation-global-identity/v1`,
`reviewed-authority-operation/v1`,
`state-mutation-successor-authority-core/v1`,
`authority-history-genesis-bootstrap-input/v1`,
`authority-history-genesis-selection-evidence/v1`,
`state-mutation-authority-rotation-id/v1`, and `authority-history/v1`:

| Digest | Domain and framed parts                                                                                                                                                                 | Canonical path/exclusion                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `G`    | `state-mutation-global-identity/v1`: installation ID text, project ID text, state-root digest raw32, custody-instance digest raw32, canonical authority path text, authority `Dp` raw32 | lifetime-stable for one installation; helper digest/profile, lock profile, state-component profile, and ABI are deliberately excluded and remain rotation-bound authority-value facts; cross-install roots refuse |
| `Dop`  | closed formula above under `reviewed-authority-operation/v1`                                                                                                                            | deterministic reviewed bootstrap/promotion operation; no caller-selected digest                                                                                                                                   |
| `Dsc`  | exact successor-core fields/formula above                                                                                                                                               | shared by both record arms; excludes history and successor selection graph                                                                                                                                        |
| `Dgb`  | `authority-history-genesis-bootstrap-input/v1`: exact selected owner/anchor ACTIVE, use intent, bootstrap identity/transaction/grant, and `Dsc`                                         | GENESIS-only upstream bootstrap input; excludes E0 and every CONSUMED/post-selection fact                                                                                                                         |
| `Drot` | exact `state-mutation-authority-rotation-id/v1` formula above                                                                                                                           | ROTATION-only deterministic operation identity; excludes successor `Dv/Dr/Dt`, record digest, and timestamps                                                                                                      |
| `Dh`   | exact branch-specific `authority-history/v1` formula above                                                                                                                              | `.../records/<ordinal>.json`; selector graph and downstream evidence excluded                                                                                                                                     |
| `Dgse` | exact `authority-history-genesis-selection-evidence/v1` formula above                                                                                                                   | downstream admission only; never a history-record or authority-value part                                                                                                                                         |

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

| Digest              | Domain tag                     | Framed identifying parts                                                                                                                                                                                         |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dv`                | `pointer-value/v1`             | pointer-kind text, path-instance digest raw32, canonical value bytes                                                                                                                                             |
| `Dr`                | `pointer-receipt/v1`           | pointer-kind text, path-instance digest raw32, mutation ID raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, position digest raw32, intent/outcome text, canonical `pointer-cas-proposal-receipt/v1` bytes |
| `Dt`                | `pointer-tip/v1`               | pointer-kind text, path-instance digest raw32, `Dv` raw32, `Dr` raw32, canonical `pointer-current-tip/v1` bytes                                                                                                  |
| `Dp`                | `pointer-instance/v1`          | kind, canonical path, installation/project/state, transaction, source                                                                                                                                            |
| mutation ID         | `pointer-mutation-id/v1`       | pointer kind, canonical path, `Dp` raw32, transaction ID/null, source token, position digest raw32, nullable prior `Dt/Dv/Dr`, successor `Dv` raw32, outcome/intent                                              |
| `Dc`                | `pointer-conflict-receipt/v1`  | `Dp` raw32, mutation ID raw32, losing `Dr/Dv`, observed winning `Dt/Dv/Dr`, conflict kind, selected authority epoch triple, conflict time, canonical create-once conflict bytes                                  |
| attempt-log genesis | `attempt-log/v1` + byte `0x00` | record ordinal `"0"`, canonical record bytes                                                                                                                                                                     |
| attempt-log later   | `attempt-log/v1` + byte `0x01` | raw predecessor record digest, record ordinal, canonical record bytes                                                                                                                                            |

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
`activation-cleanup-archive-head/v1`,
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
```

Proposal intent is `VALUE_PROPOSED` or `TOMBSTONE_PROPOSED`. Its create-once
timestamp is reused byte-for-byte on retry. Classification is exactly
`PENDING`, `SELECTED`, `LOST_CONFLICT`, or `UNKNOWN`. A conflict
receipt is valid only after it binds an actually observed winning canonical
triple. Malformed, contradictory, skipped, or fake-lost evidence is `UNKNOWN`.

A crash may leave a durable value/proposal before tip selection. It remains
`PENDING`; the next lock holder enumerates the deterministic predecessor bucket,
revalidates identical create-once bytes, and performs the real CAS or observes a
real winner. It never infers loss from age or manufactures a conflict. Census
includes every value, proposal, conflict, tip, archive, and tombstone record;
an orphan value is retained until its proposal is classified, and an
orphan/malformed proposal is `UNKNOWN`. Every record class is FULL_REQUIRED.

The closed runtime pointer kinds are exactly:

1. active release;
2. activation cleanup gate;
3. activation recovery fence;
4. activation recovery launch;
5. recovery authorization state;
6. recovery authorization attachment;
7. recovery attempt log;
8. activation cleanup archive head;
9. recovery attempt reservation;
10. state mutation authority rotation;
11. pointer mutation run current.

The registry maps every kind to one exact canonical path constructor, permitted
value schemas, source tokens, roots, archives, and genesis rule. Unknown or
cross-family paths, schemas, tokens, encodings, case variants, or storage files
refuse. `ACTIVATION_RECOVERY_LAUNCH`, `RECOVERY_ATTEMPT_LOG`, and
`RECOVERY_ATTEMPT_RESERVATION` each use exactly `recovery-fence` or
`cleanup-gate-pre-fence`; every other runtime pointer uses `none`.

The canonical authority-path census is closed:

| Pointer kind                        | Canonical tip path family                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ACTIVE_RELEASE`                    | `installation/active-release.json`                                                                     |
| `ACTIVATION_CLEANUP_GATE`           | `installation/activation-cleanup-gate.json`                                                            |
| `ACTIVATION_RECOVERY_FENCE`         | `installation/activation-recovery-fence.json`                                                          |
| `ACTIVATION_RECOVERY_LAUNCH`        | `installation/activation-recovery-launches/<transaction>/<source>/current.json`                        |
| `RECOVERY_AUTHORIZATION_STATE`      | `installation/recovery-authorizations/<transaction>/state.json`                                        |
| `RECOVERY_AUTHORIZATION_ATTACHMENT` | `installation/recovery-authorizations/<transaction>/attachment.json`                                   |
| `RECOVERY_ATTEMPT_LOG`              | `installation/activation-recovery-launches/<transaction>/<source>/attempt-log.json`                    |
| `ACTIVATION_CLEANUP_ARCHIVE_HEAD`   | `installation/activation-cleanup/archive-head.json`                                                    |
| `RECOVERY_ATTEMPT_RESERVATION`      | `installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json` |
| `STATE_MUTATION_AUTHORITY_ROTATION` | `installation/state-mutation-authority.json`                                                           |
| `POINTER_MUTATION_RUN_CURRENT`      | `installation/pointer-cas/<target-instance-digest>/commits/<target-mutation-id>/current-run.json`      |

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
tombstone and census rules, but does not recursively create a run
selector for itself. A one-use ISS-004 capability binds it to the exact parent
target/`Dp`/mutation/core/prior/epoch. Run audit is FULL_REQUIRED.

The `ORDINARY` commit arm alone uses all nine stages:
`CURRENT_AUTHORITY_READ`, `TARGET_RECONCILED`, `VALUE_READBACK`,
`PROPOSAL_READBACK`, `CURRENT_AUTHORITY_PRE_CAS_READ`, `CAS_ARMED`,
`TARGET_POST_CAS_READBACK`, `PROPOSAL_CLASSIFIED`, and
`CURRENT_AUTHORITY_POST_CAS_READ`. `CAS_ARMED` is selected before issuing target
CAS, so a crash is explicitly ambiguous. Fresh recovery reads the target:
expected winner becomes `SELECTED`, a real different winner becomes
`LOST_CONFLICT`, unchanged prior may retry under the same epoch, and malformed
or impossible evidence becomes exact terminal unknown.

The ordinary checkpoint phase matrix is exact; `E` is the one selected
authority epoch for the run:

| Stage ordinal | Stage                             | Durable phase                                      | Producer epoch |
| ------------: | --------------------------------- | -------------------------------------------------- | -------------- |
|             0 | `CURRENT_AUTHORITY_READ`          | `CRASH_PREFIX`                                     | `E`            |
|             1 | `TARGET_RECONCILED`               | `CRASH_PREFIX`                                     | `E`            |
|             2 | `VALUE_READBACK`                  | `CRASH_PREFIX`                                     | `E`            |
|             3 | `PROPOSAL_READBACK`               | `CRASH_PREFIX`                                     | `E`            |
|             4 | `CURRENT_AUTHORITY_PRE_CAS_READ`  | `CRASH_PREFIX`                                     | `E`            |
|             5 | `CAS_ARMED`                       | `CAS_AMBIGUOUS`                                    | `E`            |
|             6 | `TARGET_POST_CAS_READBACK`        | `CAS_AMBIGUOUS`                                    | `E`            |
|             7 | `PROPOSAL_CLASSIFIED`             | `SELECTED`, `LOST_CONFLICT`, or `UNKNOWN_TERMINAL` | `E`            |
|             8 | `CURRENT_AUTHORITY_POST_CAS_READ` | the unchanged stage-7 terminal phase               | `E`            |

For an ordinary run, `PROPOSED` is only a live branded in-memory ISS-004 view before stage five.
After lock/process loss, checkpoints zero through four are `CRASH_PREFIX` and
the persisted stage-five and stage-six checkpoints are `CAS_AMBIGUOUS`.
Its durable resolution is only
`SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL` and excludes the run-current graph
that selects its terminal core.

Every commit intent is `SINGLE_EPOCH`. Every ordinary run's nine checkpoint
selectors bind one authority triple. For the `STATE_MUTATION_AUTHORITY_ROTATION` target, the
rotation run under the old capability executes checkpoints zero through five,
appends the exact `authority-history-record/v1` record (with `Dh` under
`authority-history/v1`), and then performs the authority CAS as its final
action. It executes no checkpoint after that CAS
under either epoch; its run-current journal legitimately rests at the selected
`CAS_ARMED` checkpoint across the selection. Terminal truth is a pure derived
union. The closed `pointer-mutation-commit-evidence/v1` schema has common
identity fields `commitKind`, target kind/path/`Dp`/mutation ID, intent digest,
run ID, run ordinal, old authority `Dp/Dt/Dv/Dr`, and packet authority
as the closed `KNOWN(Dp/Dt/Dv/Dr)|UNKNOWN(null)` union; it then admits exactly
one arm. ORDINARY requires KNOWN E. Rotation requires KNOWN old/successor for
RESUMABLE/SELECTED and UNKNOWN for UNKNOWN:

- `ORDINARY` requires target kind other than
  `STATE_MUTATION_AUTHORITY_ROTATION`, the composed checkpoints 0–8 and their
  selected selector graphs/readbacks, and one ordinary resolution
  `SELECTED|LOST_CONFLICT|UNKNOWN_TERMINAL`. `SELECTED` binds the expected
  selected target `Dp/Dt/Dv/Dr`; `LOST_CONFLICT` binds the proposed loser plus
  actual winner and conflict receipt; `UNKNOWN_TERMINAL` binds the fixed-size
  unknown union and no selected target. The ordinary rules above are unchanged.
- `AUTHORITY_ROTATION` requires that exact target kind and binds the old E(n)
  selected `CAS_ARMED` intent, checkpoint-5 `Dcore`, its selected META_LEAF
  selector `Dp/Dt/Dv/Dr`, its selector readbacks and `Dpost`, expected successor
  authority `Dv`, target mutation ID, expected successor head ordinal and
  record digest, `Drot`, and `Dsc`. It admits exactly
  `RESUMABLE|SELECTED|UNKNOWN`:
  - `RESUMABLE` binds the still-selected old authority `Dp/Dt/Dv/Dr`, its exact
    selected prior head ordinal/record digest, the exact canonical head-plus-one
    ROTATION record whose `Drot`, `Dsc`, ordinal, and predecessor match the
    expected record bound by the armed intent/target mutation/successor `Dv`,
    an absent head-plus-two observation,
    and the authority registry slot equal to that old selected triple. It
    exposes only the live old-epoch capability for the same transaction to
    re-drive the same authority CAS.
  - `SELECTED` binds the exact selected successor authority `Dp/Dt/Dv/Dr`,
    requires its `Dv` to equal expected successor `Dv`, requires its selected
    value's head ordinal/digest to equal the expected ROTATION record, verifies
    the canonical record readback against `Drot` and `Dsc`, and binds the
    authority registry slot to that successor triple. The old capability is
    revoked; this is derived terminal truth, not a stored resolution.
  - `UNKNOWN` binds the fixed-size closed unknown evidence and an empty
    authority registry slot; it exposes no capability.

For `AUTHORITY_ROTATION`, fields or files for checkpoint 6, 7, or 8, an
ordinary commit resolution, a selector observation after checkpoint 5, or any
successor-epoch write are forbidden rather than ignored. The closed union
therefore derives rotation truth without a post-CAS artifact. No separate
rotation receipt, handoff pair, terminal-resolution write, or materialization
machinery exists, and every commit run remains single-epoch.

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

The create-once `pointer-mutation-run-intent/v1` record is a closed two-arm
union. Both arms have this exact common census:

| JSON member                      | Type / literal                           |
| -------------------------------- | ---------------------------------------- |
| `canonicalPointerPath`           | `relative-path`                          |
| `commitKind`                     | enum `ORDINARY`, `AUTHORITY_ROTATION`    |
| `createdAt`                      | `timestamp`                              |
| `globalIdentityDigest`           | `sha256`                                 |
| `intentKind`                     | literal `SINGLE_EPOCH`                   |
| `oldAuthorityPathInstanceDigest` | `sha256`                                 |
| `oldAuthorityReceiptDigest`      | `sha256`                                 |
| `oldAuthorityTipDigest`          | `sha256`                                 |
| `oldAuthorityValueDigest`        | `sha256`                                 |
| `schemaVersion`                  | literal `pointer-mutation-run-intent/v1` |
| `targetMutationId`               | `sha256`                                 |
| `targetPathInstanceDigest`       | `sha256`                                 |
| `targetPointerKind`              | one of the exact eleven registry kinds   |

ORDINARY requires a target kind other than
`STATE_MUTATION_AUTHORITY_ROTATION` and has no branch-only members.
AUTHORITY_ROTATION requires that target kind and adds exactly:

| JSON member                    | Type / literal                                    |
| ------------------------------ | ------------------------------------------------- |
| `expectedHeadOrdinal`          | positive `safe-decimal`                           |
| `expectedRecordDigest`         | `sha256`                                          |
| `expectedSuccessorValueDigest` | `sha256`                                          |
| `rotationInput`                | `record<state-mutation-authority-rotation-id/v1>` |
| `rotationInputDigest`          | `sha256` (`Drot`)                                 |
| `successorCoreDigest`          | `sha256` (`Dsc`)                                  |

`rotationInputDigest` is recomputed from `rotationInput`; its `G`, retiring
authority tuple, successor ordinal, and `Dsc` equal the common fields and the
expected head-plus-one operation. `expectedHeadOrdinal` equals the rotation
input successor ordinal and `expectedRecordDigest` is the digest of the exact
ROTATION record that those fields determine. The expected successor `Dv` is
cross-bound downstream to the target proposal and rotation commit. No caller-
selected epoch key or rotation-operation digest is accepted.

The intent digest is:

```text
H(F(pointer-mutation-run-intent/v1,
  branch-tag, G raw32, target-kind text, target-path text, target-Dp raw32,
  target-mutation-id raw32, old-authority Dp/Dt/Dv/Dr raw32,
  Drot/expected-successor-Dv/expected-head/expected-record/Dsc
    when AUTHORITY_ROTATION,
  canonical union bytes))
```

The branch tag is `0x00` ORDINARY or `0x01` AUTHORITY_ROTATION. Creation time
is bound only through canonical union bytes. The intent has the existing
`intent.json` path below and grants no authority by itself.

```text
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/intent.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/runs/<run-ordinal>-<run-id>/segment.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/checkpoints/<core-digest>.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/selector-observations/<selector-mutation-id>.json
installation/pointer-cas/<target-Dp>/commits/<target-mutation-id>/resolution.json
```

`resolution.json` and selector observations after checkpoint 5 exist only for
`ORDINARY`. Their presence for `AUTHORITY_ROTATION` is contradictory evidence
and reduces to `UNKNOWN`; it is never treated as harmless residue.

The closed run domains are `pointer-mutation-run-id/v1`,
`pointer-mutation-run-segment/v1`, `pointer-mutation-run-audit/v1`,
`pointer-mutation-run-checkpoint-core/v1`,
`pointer-mutation-run-current-position/v1`,
`pointer-mutation-run-selector-post-selection-observation/v1`, and
`pointer-mutation-commit-resolution/v1`, composed by the closed
`pointer-mutation-commit-evidence/v1` union.

The ordinary-only `pointer-mutation-commit-resolution/v1` record has this exact
canonical member census:

| JSON member                           | Type / literal                                       |
| ------------------------------------- | ---------------------------------------------------- |
| `conflictReceiptDigest`               | nullable `sha256`                                    |
| `outcome`                             | enum `SELECTED`, `LOST_CONFLICT`, `UNKNOWN_TERMINAL` |
| `outcomeEvidenceDigest`               | `sha256`                                             |
| `producerAuthorityPathInstanceDigest` | `sha256` (`Dp`)                                      |
| `producerAuthorityReceiptDigest`      | `sha256` (`Dr`)                                      |
| `producerAuthorityTipDigest`          | `sha256` (`Dt`)                                      |
| `producerAuthorityValueDigest`        | `sha256` (`Dv`)                                      |
| `resolvedAt`                          | canonical millisecond UTC timestamp                  |
| `schemaVersion`                       | literal `pointer-mutation-commit-resolution/v1`      |
| `selectedTargetTipDigest`             | nullable `sha256`                                    |
| `targetMutationId`                    | `sha256`                                             |
| `targetPathInstanceDigest`            | `sha256` (`Dp` of the target)                        |
| `unknownEvidenceDigest`               | nullable `sha256`                                    |

All four producer-authority fields are required and equal the selected
single-epoch authority tuple carried by the ORDINARY commit's common old and
KNOWN packet authority fields. For `SELECTED`, only
`selectedTargetTipDigest` is non-null and equals `outcomeEvidenceDigest`; for
`LOST_CONFLICT`, only `conflictReceiptDigest` is non-null and equals
`outcomeEvidenceDigest`; for `UNKNOWN_TERMINAL`, only
`unknownEvidenceDigest` is non-null and equals `outcomeEvidenceDigest`. The
resolution digest is
`H(F("pointer-mutation-commit-resolution/v1", canonical resolution bytes))`.
It excludes its selecting run-current value/proposal/tip and readbacks, `Dpost`,
packet wrappers, membership material, and every rotation field. The deleted
`producerEpochKey` has no replacement alias: the exact four-digest tuple above
is the only producer-epoch representation.

`Dcommit` is always:

```text
Dcommit = H(F(pointer-mutation-commit-evidence/v1,
  branch-tag, target-kind text, target-path text, target-Dp raw32,
  target-mutation-id raw32, intent-digest raw32, run-id raw32,
  run-ordinal bounded-decimal, nullable prior-checkpoint Dcore raw32,
  old-authority Dp/Dt/Dv/Dr raw32,
  packet-authority-tag, nullable packet-authority Dp/Dt/Dv/Dr raw32,
  branch-parts, canonical union bytes))
```

The serialized `pointer-mutation-commit-evidence/v1` union is itself
non-persisted composed evidence: it has no commit path or selecting pointer and
appears only as a recursively closed value inside `pointer-evidence-packet/v1`.
Both branches first carry this exact common census (canonical member order):

| JSON member                         | Type / literal                                                 |
| ----------------------------------- | -------------------------------------------------------------- |
| `canonicalPointerPath`              | `relative-path`                                                |
| `commitKind`                        | enum `ORDINARY`, `AUTHORITY_ROTATION`                          |
| `intentDigest`                      | `sha256`                                                       |
| `oldAuthorityPathInstanceDigest`    | `sha256`                                                       |
| `oldAuthorityReceiptDigest`         | `sha256`                                                       |
| `oldAuthorityTipDigest`             | `sha256`                                                       |
| `oldAuthorityValueDigest`           | `sha256`                                                       |
| `packetAuthorityKind`               | enum `KNOWN`, `UNKNOWN`                                        |
| `packetAuthorityPathInstanceDigest` | nullable `sha256`                                              |
| `packetAuthorityReceiptDigest`      | nullable `sha256`                                              |
| `packetAuthorityTipDigest`          | nullable `sha256`                                              |
| `packetAuthorityValueDigest`        | nullable `sha256`                                              |
| `priorCheckpointEvidence`           | nullable `record<pointer-mutation-run-checkpoint-evidence/v1>` |
| `runId`                             | `sha256`                                                       |
| `runOrdinal`                        | `safe-decimal`                                                 |
| `schemaVersion`                     | literal `pointer-mutation-commit-evidence/v1`                  |
| `targetMutationId`                  | `sha256`                                                       |
| `targetPathInstanceDigest`          | `sha256`                                                       |
| `targetPointerKind`                 | one of the exact eleven registry kinds                         |

For either branch, canonical JSON order is the single ascending UTF-16 merge
of this common table, its branch table, and its one applicable outcome table;
the tables are not serialized as concatenated groups.

`packetAuthorityKind=KNOWN` requires all four packet-authority digests;
`UNKNOWN` requires all four null. In addition to the common members, ORDINARY
has exactly these members:

| JSON member          | Type / literal                                                                        |
| -------------------- | ------------------------------------------------------------------------------------- |
| `checkpoints`        | exact-length-9 ordered array of `record<pointer-mutation-run-checkpoint-evidence/v1>` |
| `ordinaryResolution` | `record<pointer-mutation-commit-resolution/v1>`                                       |
| `outcome`            | enum `SELECTED`, `LOST_CONFLICT`, `UNKNOWN_TERMINAL`                                  |
| `targetRegistrySlot` | `record<pointer-evidence-slot/v1>` for `targetPointerKind`                            |

ORDINARY requires `packetAuthorityKind=KNOWN` and the packet-authority tuple to
equal the single run epoch. `targetRegistrySlot` contains the exact selected
target for SELECTED, the recomputed real winner plus conflict receipt for
LOST_CONFLICT, and is empty for UNKNOWN_TERMINAL. An empty/wrong-kind/stale
slot for the first two outcomes or a nonempty slot for UNKNOWN_TERMINAL
refuses. Rotation-only members are absent, not null.

In addition to the common members, AUTHORITY_ROTATION always has exactly:

| JSON member                    | Type / literal                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `authorityRegistrySlot`        | `record<pointer-evidence-slot/v1>` for `STATE_MUTATION_AUTHORITY_ROTATION`                                                          |
| `checkpoint5`                  | `record<pointer-mutation-run-checkpoint-evidence/v1>` with ordinal `"5"`, stage `CAS_ARMED`, phase `CAS_AMBIGUOUS`, null resolution |
| `expectedHeadOrdinal`          | positive `safe-decimal`                                                                                                             |
| `expectedRecordDigest`         | `sha256`                                                                                                                            |
| `expectedSuccessorValueDigest` | `sha256`                                                                                                                            |
| `rotationInputDigest`          | `sha256` (`Drot`)                                                                                                                   |
| `rotationOutcome`              | enum `RESUMABLE`, `SELECTED`, `UNKNOWN`                                                                                             |
| `successorCoreDigest`          | `sha256` (`Dsc`)                                                                                                                    |

Its outcome adds one exact direct-field set. RESUMABLE adds:

| JSON member                               | Type / literal                                     |
| ----------------------------------------- | -------------------------------------------------- |
| `headPlusTwoAbsent`                       | literal `true`                                     |
| `pendingRecord`                           | `record<authority-history-record/v1>` ROTATION arm |
| `pendingRecordReadbackDigest`             | `sha256`, canonical bytes of `pendingRecord`       |
| `resumableOldAuthorityPathInstanceDigest` | `sha256`                                           |
| `resumableOldAuthorityReceiptDigest`      | `sha256`                                           |
| `resumableOldAuthorityTipDigest`          | `sha256`                                           |
| `resumableOldAuthorityValueDigest`        | `sha256`                                           |
| `resumablePriorHeadOrdinal`               | `safe-decimal`                                     |
| `resumablePriorRecordDigest`              | `sha256`                                           |

RESUMABLE requires KNOWN packet authority, all four resumable authority fields
equal the common old-authority tuple, and `authorityRegistrySlot` equal that
same selected tuple. SELECTED instead adds:

| JSON member                                    | Type / literal                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `selectedHistoryRecord`                        | `record<authority-history-record/v1>` ROTATION arm             |
| `selectedHistoryRecordReadbackDigest`          | `sha256`, canonical bytes of `selectedHistoryRecord`           |
| `selectedSuccessorAuthorityPathInstanceDigest` | `sha256`                                                       |
| `selectedSuccessorAuthorityReceiptDigest`      | `sha256`                                                       |
| `selectedSuccessorAuthorityTipDigest`          | `sha256`                                                       |
| `selectedSuccessorAuthorityValue`              | `record<state-mutation-authority-value/v1>`                    |
| `selectedSuccessorAuthorityValueDigest`        | `sha256`, equal to `expectedSuccessorValueDigest`              |
| `selectedSuccessorValueReadbackDigest`         | `sha256`, canonical bytes of `selectedSuccessorAuthorityValue` |

SELECTED requires KNOWN packet authority and `authorityRegistrySlot` both equal
the selected successor path/tip/value/receipt tuple. UNKNOWN instead adds only:

| JSON member       | Type / literal                                        |
| ----------------- | ----------------------------------------------------- |
| `unknownEvidence` | closed `record<pointer-mutation-unknown-evidence/v1>` |

UNKNOWN requires UNKNOWN/null packet authority and an empty
`authorityRegistrySlot`. Its unknown record is the fixed category/reason/
observation-digest/safe-length union defined below; it cannot carry JSON,
native text, a path, or an array. Fields belonging to either other rotation
outcome are absent. Every AUTHORITY_ROTATION arm forbids checkpoints 6–8,
ordinary resolution, a selector observation after checkpoint 5, and any
successor-epoch write.

The `Dcommit` digest domain is exactly
`pointer-mutation-commit-evidence/v1`. Framed parts are the branch byte;
`targetPointerKind`; `canonicalPointerPath`; `targetPathInstanceDigest`;
`targetMutationId`; `intentDigest`; `runId`; `runOrdinal`; the nullable
recomputed prior-checkpoint `Dcore`; old authority
path/tip/value/receipt; the packet-authority byte; nullable packet authority
path/tip/value/receipt; then the branch parts in the order below; finally
canonical union bytes.

For ORDINARY, `priorCheckpointEvidence` is null exactly when `runOrdinal` is
zero. A positive ordinary run ordinal carries the complete closed selected
checkpoint evidence from the immediately prior run: its core run ordinal
increments to the current run ordinal; its kind/path/installation/project/
state/transaction/source, target `Dp` and mutation, `G`, and selected authority
epoch equal the current run; and its recomputed selector `Dp/Dt/Dv/Dr` plus
`Dpost` are the initial predecessor fields of current checkpoint zero. The
run-ID prior-checkpoint part is the recomputed prior `Dcore`, never a caller-
supplied digest. AUTHORITY_ROTATION instead requires `runOrdinal="0"` and
`priorCheckpointEvidence=null`. Its selected checkpoint 5 remains the same
CAS-armed run across a crash; the same transaction may re-drive the same final
CAS but may not open another rotation run or add checkpoints 0–4 to `Dcommit`.
Every current checkpoint target `Dp` is independently recomputed from its
existing kind/path/installation/project/state/transaction/source tuple before
sequence or packet acceptance.

- ORDINARY branch parts: for checkpoint ordinals zero through eight, the
  recomputed digest of that closed checkpoint evidence in ordinal order; the
  recomputed `ordinaryResolution` digest; the outcome byte; and canonical
  `targetRegistrySlot` bytes.
- AUTHORITY_ROTATION branch parts: recomputed checkpoint-5 `Dcore`, selected
  selector path/tip/value/receipt, selector value/proposal/tip readback
  digests, `Dpost`, `expectedSuccessorValueDigest`, `expectedHeadOrdinal`,
  `expectedRecordDigest`, `rotationInputDigest`, `successorCoreDigest`, the
  outcome byte, then the outcome members in their table order and canonical
  `authorityRegistrySlot` bytes.

`Dcommit` excludes the packet wrapper/handle/capability, every unrelated
registry slot, and every artifact later than the selected outcome. Its
canonical bytes bind `schemaVersion` and branch member absence; its framed
parts bind the semantically ordered evidence. Neither representation may
substitute for the other.

`branch-tag` is `0x00` ORDINARY or
`0x01` AUTHORITY_ROTATION; `packet-authority-tag` is `0x00` UNKNOWN or `0x01`
KNOWN and the four authority parts must be all absent or all present.
The ORDINARY outcome byte is `0x00` SELECTED, `0x01` LOST_CONFLICT, or
`0x02` UNKNOWN_TERMINAL. The AUTHORITY_ROTATION outcome byte is independently
`0x00` RESUMABLE, `0x01` SELECTED, or `0x02` UNKNOWN. Every tag is a raw fixed
one-byte framed part; enum text and any other numeric assignment refuse.

ORDINARY `branch-parts` are, in order, the digest of closed
`pointer-mutation-run-checkpoint-evidence/v1` over the nine ordered stage
ordinals/names, each `Dcore`, selected selector `Dp/Dt/Dv/Dr`, selector
value/proposal/tip readback digests, and `Dpost`; ordinary resolution digest;
outcome tag; and target-slot union containing exact selected target
`Dp/Dt/Dv/Dr`, exact real winner `Dp/Dt/Dv/Dr` plus conflict digest, or null.
AUTHORITY_ROTATION `branch-parts` are selected checkpoint-5 `Dcore`, selector
`Dp/Dt/Dv/Dr`, its three readback digests and `Dpost`; expected successor `Dv`;
expected head ordinal and record digest; `Drot`; `Dsc`; rotation outcome tag;
then the exact RESUMABLE old authority/prior head/pending-record readback/head+2
absence/old slot, SELECTED successor authority/value readback/record readback/
successor slot, or UNKNOWN evidence/empty slot fields declared above. Closed
record parsing rejects every omitted, extra, duplicated, reordered, or
wrong-arm field before hashing.
`Dcommit` is a pure composed-validation digest embedded with its canonical
union bytes in `pointer-evidence-packet/v1`; it creates no additional commit
file. The underlying ordinary artifacts or rotation checkpoint-5/readback
evidence remain the only inputs.

| Digest/value                 | Domain/formula                                                                                                                              | Required parts and exclusions                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run ID                       | `pointer-mutation-run-id/v1`                                                                                                                | `G` raw32, target mutation ID raw32, run ordinal bounded decimal string, nullable prior checkpoint digest raw32, current authority `Dp` raw32, current authority `Dt` raw32, current authority `Dv` raw32, current authority `Dr` raw32; timestamps excluded                                              |
| segment/audit                | `pointer-mutation-run-segment/v1`; first `H(F(pointer-mutation-run-audit/v1, 0x00, segment))`, later `H(F(...,0x01, prior audit, segment))` | exact run stages/readbacks; full immutable audit retained                                                                                                                                                                                                                                                 |
| `Dcore`                      | `pointer-mutation-run-checkpoint-core/v1`                                                                                                   | identity/audit/predecessor parts, stage, phase, nullable ordinary terminal resolution, canonical core bytes; rotation permits only stage 0–5 and requires null resolution                                                                                                                                 |
| selector `Dv/Dr/Dt`          | ordinary `pointer-value/v1`, `pointer-receipt/v1`, `pointer-tip/v1`                                                                         | value binds `Dcore`; proposal binds exact prior selector triple/genesis and META_LEAF position; tip selects them                                                                                                                                                                                          |
| `Dpost`                      | `pointer-mutation-run-selector-post-selection-observation/v1`                                                                               | `Dcore` raw32, selector `Dp` raw32, selector mutation ID raw32, selector `Dv` raw32, selector `Dr` raw32, selector `Dt` raw32, value-readback digest raw32, proposal-readback digest raw32, tip-readback digest raw32, canonical observation bytes                                                        |
| ordinary terminal resolution | `pointer-mutation-commit-resolution/v1`                                                                                                     | ordinary target outcome/evidence and producer epoch; excludes selector value/`Dv`, proposal/`Dr`, tip/`Dt`, selector readbacks, and `Dpost`; forbidden for rotation                                                                                                                                       |
| `Dcommit`                    | `pointer-mutation-commit-evidence/v1`                                                                                                       | branch tag; common target/intent/run/old-authority/packet-authority fields; for ORDINARY, checkpoints 0–8 plus ordinary resolution; for AUTHORITY_ROTATION, checkpoint 5 plus expected successor/record/`Drot`/`Dsc`, outcome tag, and exact RESUMABLE/SELECTED/UNKNOWN arm fields; canonical union bytes |

`Dcore` excludes its selector value/`Dv`, proposal/`Dr`, tip/`Dt`, their
readbacks, and its own `Dpost`. `Dpost` is downstream and only the next core may
bind it; `Dpost` excludes that next core and every later selector graph. Terminal
ordinary resolution excludes `Dcore`'s selector value/`Dv`, proposal/`Dr`, tip/`Dt`, all
selector readbacks, and `Dpost`. The acyclic order is segment/optional terminal
resolution → `Dcore` → selector value/`Dv` → proposal/`Dr` → tip/`Dt` → `Dpost`
→ next core. Rotation `Dcommit` composes already selected/read-back evidence;
it is not selected into the old run-current graph and grants no authority by
itself.

META_LEAF uses the generic selector-instance storage exactly:

```text
installation/pointer-cas/<selector-Dp>/values/<selector-mutation-id>.json
installation/pointer-cas/<selector-Dp>/proposals/<prior-tip-or-genesis>/<selector-mutation-id>.json
installation/pointer-cas/<selector-Dp>/conflicts/<prior-tip-or-genesis>/<selector-mutation-id>.json
```

Only recursive journaling is excluded. Create-once retry, real-winner conflict,
classification, tombstone, path census, producer epoch, and exact
selected tip rules are identical to every other runtime pointer.

`pointer-mutation-conflict-evidence/v1` is non-persisted composed evidence with
this exact canonical member census:

| JSON member                | Type / literal                                      |
| -------------------------- | --------------------------------------------------- |
| `conflictReceipt`          | `record<pointer-conflict-receipt/v1>`               |
| `losingProposal`           | `record<pointer-cas-proposal-receipt/v1>`           |
| `schemaVersion`            | literal `pointer-mutation-conflict-evidence/v1`     |
| `selectedWinner`           | closed `{ proposal, tip, value }` selected evidence |
| `targetMutationId`         | `sha256`                                            |
| `targetPathInstanceDigest` | `sha256`                                            |

The losing proposal has the target `Dp` and mutation ID. `selectedWinner` is
the exact generic selected value/proposal/tip graph for the same pointer
instance. The conflict receipt recomputes from the losing `Dr/Dv`, selected
winner `Dt/Dv/Dr`, target identity, producer epoch, kind, and timestamp. Its
composed digest is:

```text
H(F(pointer-mutation-conflict-evidence/v1,
  target-Dp raw32, target-mutation-id raw32,
  losing Dr raw32, losing Dv raw32,
  winner Dt raw32, winner Dv raw32, winner Dr raw32,
  conflict-receipt digest raw32, canonical evidence bytes))
```

It creates no path or capability and cannot substitute a caller-asserted
winner or conflict.

`pointer-evidence-slot/v1` has exactly `pointerKind`, `schemaVersion`, and
nullable `selectedEvidence` in canonical order. `schemaVersion` is literal
`pointer-evidence-slot/v1`; `pointerKind` is one exact registry kind.
`selectedEvidence` is either null, a closed generic `{ proposal, tip, value }`
selection of that kind, or a closed
`pointer-mutation-conflict-evidence/v1` whose loser and winner have that kind.
For ORDINARY SELECTED, rotation RESUMABLE, and rotation SELECTED, the applicable
slot requires the generic selection. ORDINARY LOST_CONFLICT requires the
conflict composition. ORDINARY UNKNOWN_TERMINAL and rotation UNKNOWN require
null. Historical-read slots admit only null or the generic selection.

The ORDINARY outcome-to-slot equalities are mandatory. For SELECTED,
`targetRegistrySlot.selectedEvidence.proposal.mutationId` equals the common
`targetMutationId`, and the recomputed selected tip digest equals
`ordinaryResolution.selectedTargetTipDigest`. The selected proposal's
`authorityEpochTipDigest`, `authorityEpochValueDigest`, and
`authorityEpochReceiptDigest` respectively equal the common old/KNOWN packet
authority `Dt/Dv/Dr` and the correspondingly named resolution producer fields.
For LOST_CONFLICT, the conflict composition's losing proposal mutation equals
the common target mutation; the recomputed digest of its `conflictReceipt`
equals `ordinaryResolution.conflictReceiptDigest`; and both the losing
proposal's and conflict receipt's three named authority-epoch digests equal the
same old/KNOWN packet and resolution producer `Dt/Dv/Dr`. The producer `Dp` is
not duplicated in the generic proposal or conflict-receipt schemas; it remains
equal-bound by the resolution and common old/KNOWN packet fields. A valid
resolution paired with a different valid selected graph, conflict receipt, or
producer epoch refuses before `Dcommit` is accepted.

The packet's `authorityHistoryBinding` is the non-persisted closed
`authority-history-binding/v1` record with exactly:

| JSON member                | Type / literal                                            |
| -------------------------- | --------------------------------------------------------- |
| `genesisSelectionEvidence` | `record<authority-history-genesis-selection-evidence/v1>` |
| `globalIdentityDigest`     | `sha256` (`G`)                                            |
| `headOrdinal`              | `safe-decimal`                                            |
| `headRecordDigest`         | `sha256`                                                  |
| `records`                  | dense array of `record<authority-history-record/v1>`      |
| `schemaVersion`            | literal `authority-history-binding/v1`                    |

`records` has exactly `headOrdinal + 1` entries in ordinal order beginning at
GENESIS zero. Each record digest, predecessor, `G`, branch, ordinal, `Dsc`, and
when applicable `Drot` is recomputed by the full linear walk. The final digest
equals `headRecordDigest`; the genesis record and
`genesisSelectionEvidence` cross-bind `Dgb`, `Dh`, `Dsc`, E0 selection and
external ACTIVE/CONSUMED evidence. The packet's selected current authority
value must carry the same `G`, `headOrdinal`, and `headRecordDigest`.

Its composed digest is:

```text
H(F(authority-history-binding/v1,
  G raw32, head ordinal bounded-decimal, head record digest raw32,
  each recomputed record digest raw32 in ordinal order,
  recomputed genesis-selection-evidence digest raw32,
  canonical binding bytes))
```

The binding has no storage path, selecting pointer, checkpoint, compacted arm,
membership proof, inventory, or mutation authority.

`pointer-evidence-packet/v1` is an exact eleven-slot union. `HISTORICAL_READ`
requires `currentCommit=null` and exposes no mutation capability.
`MUTATION_COMMIT` requires exact `Dcommit`, the corresponding closed commit
union bytes, and a purpose-compatible live context. For `ORDINARY`, packet
authority equals the run's E and the target slot is the exact selected target,
real winner, or empty for `SELECTED`, `LOST_CONFLICT`, or `UNKNOWN_TERMINAL`.
For `AUTHORITY_ROTATION`, packet authority/authority-registry slot are the old
triple/old triple for `RESUMABLE`, successor triple/successor triple for
`SELECTED`, and null/empty for `UNKNOWN`. RESUMABLE exposes only the same old-
epoch transaction's CAS method; SELECTED is evidence usable by a separately
created successor-epoch context; UNKNOWN exposes none. A rotation packet that
contains ordinary checkpoints 6–8, ordinary resolution, post-checkpoint-5
selector artifacts, or a successor-epoch write refuses.

The outer `currentAuthoritySelection` and `authorityHistoryBinding` members are
both nullable. HISTORICAL_READ, ORDINARY MUTATION_COMMIT, rotation RESUMABLE,
and rotation SELECTED require both non-null; the selected authority value and
the complete binding have the same `G`, head ordinal, and head record digest.
Rotation UNKNOWN requires both exactly null, together with UNKNOWN/null packet
authority and the empty authority registry slot. One null without the other,
either non-null UNKNOWN member, or any attempt to issue a historical-read or
mutation capability from that arm refuses.

Packet authority and the complete kind/path/install/project/state/transaction/
source/`Dp`/mutation/run identity tuple must equal `Dcommit` and selected-slot
facts; any cross-field mismatch refuses. The target occupies its one exact
registry-ordered slot. The remaining ten registry slots retain their exact
registry-ordered current evidence and may not duplicate or substitute the
target slot.

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

## Required record retention

Every record class is `FULL_REQUIRED`: destination owner/anchor lineage,
physical identity/observations, state authority/history, run-current audit,
active release, cleanup head/gate, fence, authorization records, terminal
launch/attempt history, current tips, and current proposals alike. No
compaction protocol, retention pointer, or degraded-audit mode exists;
terminal attempt history grows only with rare attempts and is never compacted.
Unexpected loss of any required record is `UNKNOWN` and blocks all
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

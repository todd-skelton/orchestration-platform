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
authority. The cleanup-gate and recovery-fence root/head ledger is decided
below. Recovery-authorization records, cleanup archives, and later promotion
receipts remain separately unauthorized until their own literal ledgers pass
removal review.

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
cleanup-gate and recovery-fence root/head bytes are fixed by the next ledger.
Recovery-authorization and cleanup-archive member ledgers and their composed
equality matrices remain unauthorized until their own removal rounds pass;
implementation may not infer those bytes from this branch table.

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
  self-loop, fork, gap, reorder, truncation, wrong root, wrong prior `Dv`, or
  unsafe ordinal refuses.

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
and proposals are mutation-ID-addressed, while `pointer-current-tip/v1` does
not expose that mutation ID or the transaction needed by the root path.
Therefore no reader may claim that selected `Dp/Dv/Dr` fetches a root, head,
proposal, or full history. Directory enumeration, a caller-selected path,
unauthenticated index or journal, duplicate family-head file, alternate tip,
symlink, and latest-file convention are not authority. A later independently
reviewed common-CAS locator decision must make exact bytes constructible from
authenticated selected evidence and define deletion/loss handling before any
filesystem read or mutation is authorized.

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

Until the common-CAS locator, cleanup-archive ledger, recovery-authorization
ledger, and composed proof matrix each pass independent removal review, this
slice authorizes only the four structural parsers, two root digests, exact
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

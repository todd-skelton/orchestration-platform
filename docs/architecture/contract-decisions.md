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
  arbitrary-precision decimal strings (`"0"|[1-9][0-9]*`) and the framed
  `DECIMAL_ASCII` type. They are compared by digit length then ASCII order and
  incremented by decimal carry; they never pass through JavaScript `Number` and
  have no semantic lifetime maximum.
- Durable identities use lowercase UUIDv7 text. Content identities use
  lowercase SHA-256 hex.
- Contract-relative paths use `/` separators and may not contain `..`, an
  absolute prefix, or a drive designator. Host paths cross a contract boundary
  only as canonical `file:` URLs.
- Unknown fields on authority records are refused. Advisory records preserve a
  named degraded result rather than guessing.

### Closed records and arrays

Public parse, serialize, migrate, and nested-evidence entry points first take a
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
`pointer-cas-proposal-receipt/v2` that binds the prior `Dt/Dv/Dr`, successor
`Dv`, and closed bootstrap/selected producer union, and `Dt` hashes a tip
containing `Dv+Dr`. Values do not contain their selecting proposal or tip.
Checkpoint cores and terminal resolutions likewise exclude the run-current
value/proposal/tip that selects them; only a downstream post-selection
observation may feed a later core. Pointer path, instance digest,
proposal/conflict paths, mutation ID, tombstone, archive, and retention behavior
are exactly those in `supervisor-contract.md`.

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
- Runtime pointer history uses selected `state-mutation-authority-value/v2`
  roots over a fixed-depth sparse tree. One proof has exactly 256 siblings;
  content-addressed history is FULL_REQUIRED. This bounds each call without a
  lifetime rotation cap or self-authenticating serialized table.
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

- A release is an immutable bundle containing npm tarballs, skill/module files,
  contract schemas, stable test-bundle digest, source revision, build
  provenance, and manifest hashes.
- Installed releases live under `<state-root>/releases/<release-digest>/`.
  Canonical `<state-root>/installation/active-release.json` is the sole
  `ACTIVE_RELEASE` tip; its selected value binds the active-release family
  record and reviewed installed-byte proof. It advances only through the common
  epoch-fenced pointer protocol. No symlink, package-manager link, second
  pointer, or candidate-owned record has authority.
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
  admission, then requests selection of canonical `active-release/v2` through
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

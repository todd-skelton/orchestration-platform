# Bootstrap contract decisions

These decisions are implementation authority for the bootstrap roadmap. A
worker may challenge one only by filing a replacement decision with evidence;
it may not silently choose another equally plausible contract.

## Encoding and identity

- Authority records use UTF-8 JSON with lexicographically ordered object keys,
  no insignificant whitespace, LF termination, and SHA-256 over the exact
  bytes.
- Timestamps use RFC 3339 UTC with exactly millisecond precision. Durations use
  integer milliseconds. Values outside JavaScript's safe integer range are
  decimal strings validated by schema.
- Durable identities use lowercase UUIDv7 text. Content identities use
  lowercase SHA-256 hex.
- Contract-relative paths use `/` separators and may not contain `..`, an
  absolute prefix, or a drive designator. Host paths cross a contract boundary
  only as canonical `file:` URLs.
- Unknown fields on authority records are refused. Advisory records preserve a
  named degraded result rather than guessing.

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
- Correctness relies on create-once identity, compare-and-swap, and verified
  read-back rather than directory age or PID files.
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

- A release is an immutable bundle containing npm tarballs, skill/module files,
  contract schemas, stable test-bundle digest, source revision, build
  provenance, and manifest hashes.
- Installed releases live under `<state-root>/releases/<release-digest>/`;
  canonical `<state-root>/installation/active-release.json` containing
  `active-release/v1` is the only active-identity pointer and is atomically
  replaced only after installed-byte verification. No `current.json`, symlink,
  package-manager link, or second pointer has authority.
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
  installer atomically consumes it into the exact durable, non-expiring
  `CONSUMED_BOUND` transaction authorization. `recover` resolves and proves that
  already-consumed binding after restart—never consuming it again—before
  resuming only that transaction. The broker internally revokes/removes it
  after terminal verification. Missing, locked, copied, replayed, wrong-host,
  wrong-user, or substituted capability leaves `RECOVERY_REQUIRED` and refuses
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
  admission, then atomically replaces canonical `active-release/v1`; this is the
  sole activation point. N1+ staging bytes and pending admission are explicitly
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

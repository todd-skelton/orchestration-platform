# Public contract compatibility

This document describes the executable compatibility boundary exported by
`@orchestration-platform/contracts`. The implementation is provider-neutral and
uses no repository-local path or project policy as authority.

## Canonical authority bytes

Every authority record is a closed JSON object with an exact `schemaVersion`.
Its only valid durable encoding is UTF-8 without a byte-order mark,
lexicographically sorted object keys at every depth, no insignificant
whitespace, JSON array order preserved, and one trailing LF. SHA-256 identities
cover those exact bytes. Parsers refuse malformed UTF-8, noncanonical JSON,
unknown or missing fields, unsafe numbers, invalid Unicode scalar sequences,
and unknown schema versions.

Numbers are non-negative JavaScript safe integers unless a field is explicitly
a decimal string. Numeric external identities use canonical decimal strings so
they remain exact outside the safe-integer range. Times are RFC 3339 UTC with
exactly millisecond precision. Durable IDs are lowercase UUIDv7 and content
IDs are lowercase SHA-256 hex.

Contract-relative paths use `/`, are never absolute, and refuse empty, `.`,
`..`, drive-designator, URI, alternate-separator, NUL, and every C0/C1 control
character. A host path may cross the configuration boundary only as a canonical
`file:` URL. Runtime state remains outside source checkouts.

## Closed schema census

The registry contains 38 authority families:

| Area                            | Schema versions                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and base state    | `platform-configuration/v1`, `adapter-declaration/v1`, `installed-release/v1`, `session-lease/v1`, `worker-ownership/v1`, `journal-event/v1`                                                                                                                     |
| Review, promotion, and dispatch | `review-receipt/v1`, `promotion-receipt/v1`, `dispatch-plan/v1`, `breaker-authority/v1`, `owned-resource/v1`                                                                                                                                                     |
| Portability transactions        | `export-manifest/v1`, `import-plan/v1`, `import-receipt/v1`                                                                                                                                                                                                      |
| Module ABI                      | `module-descriptor/v1`, `module-plan-input/v1`, `module-plan-result/v1`, `module-action-plan/v1`, `module-no-action/v1`                                                                                                                                          |
| Installed successor identity    | `supervisor-shim/v1`, `active-release/v1`, `broker-active-client/v1`, `pending-successor/v1`, `successor-admission/v1`                                                                                                                                           |
| Recovery fence and launch       | `activation-recovery-fence-root/v1`, `activation-recovery-fence-head/v1`, `activation-recovery-fence-current/v1`, `activation-recovery-launch/v1`, `activation-recovery-launch-current/v1`, `activation-recovery-launch-archive/v1`, `recovery-authorization/v1` |
| Activation cleanup              | `activation-cleanup-gate-root/v1`, `activation-cleanup-gate-head/v1`, `activation-cleanup-gate-current/v1`, `activation-cleanup-gate-archive/v1`, `activation-cleanup-head/v1`                                                                                   |
| External protection root        | `repository-protection-receipt/v1`, `bootstrap-verifier-anchor/v1`                                                                                                                                                                                               |

All enums are closed. In particular, a dispatch role is exactly
`implementation`, `review`, or `observer`; an absent or unknown role refuses
before resource ownership. Module inputs contain canonical fact and policy
digests rather than ambient host, clock, process, network, credential, or
mutation access.

## Compatibility matrix

| Observed version                               | Disposition                                      |
| ---------------------------------------------- | ------------------------------------------------ |
| Exact supported family `v1`                    | `readable`                                       |
| Named `platform-configuration/v0-fixture`      | `migratable` through the exported pure migration |
| Any other legacy spelling                      | `refused`                                        |
| Missing, malformed, unknown, or future version | `refused`                                        |

The named fixture migration is deterministic, does not mutate its input, and
accepts only a plain own-data-property snapshot. Accessors, proxies, class
instances, and exotic objects refuse. Its result must pass the current closed
parser. No other implicit migration exists. A later writer must add the complete
pairwise matrix before emitting another version.

## Recovery and cleanup paths

Canonical current pointers are unique:

| Record                        | Contract-relative path                         |
| ----------------------------- | ---------------------------------------------- |
| Recovery fence current        | `installation/activation-recovery-fence.json`  |
| Recovery launch current       | `installation/activation-recovery-launch.json` |
| Cleanup gate current          | `installation/activation-cleanup-gate.json`    |
| Verified cleanup archive head | `installation/activation-cleanup-head.json`    |

Create-once transaction evidence is equally exact:

| Record family           | Contract-relative path template                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Recovery fence root     | `installation/activation-recovery-fence-roots/<transaction>.json`                                                |
| Recovery fence history  | `installation/activation-recovery-fence-history/<transaction>/<ordinal>-<state>.json`                            |
| Recovery launch state   | `installation/activation-recovery-launches/<transaction>/<source-token>/<generation>/<ordinal>-<lifecycle>.json` |
| Recovery launch archive | `installation/activation-recovery-launches/<transaction>/<source-token>/archive.json`                            |
| Cleanup gate root       | `installation/activation-cleanup-gate-roots/<transaction>.json`                                                  |
| Cleanup gate history    | `installation/activation-cleanup-gate-history/<transaction>/<ordinal>-<lifecycle>-<publication>.json`            |
| Cleanup gate archive    | `installation/activation-cleanup-gates/<transaction>.json`                                                       |
| Recovery authorization  | `installation/recovery-authorizations/<transaction>.json`                                                        |

Immutable roots, heads, launch transitions, authorizations, and archives use
the exported transaction-derived path functions. Launch source tokens are an
exhaustive mapping: `recovery-fence/v1` maps to `recovery-fence-v1`, while
`cleanup-gate-pre-fence/v1` maps to `cleanup-gate-pre-fence-v1`. Source/token,
transaction, generation, ordinal, or path mismatch refuses.

Ordinal-zero heads have canonical-null predecessors. Each new cleanup/fence
transaction creates its ordinal-zero current pointer by CAS from absence,
regardless of active generation; later head ordinals require an exact prior
pointer digest. Recovery-launch CAS from absence is narrower: only generation
zero ordinal zero. The initialization reducer recognizes only
all-absent, root-only, root-plus-initial-head, and fully-current prefixes; mixed,
extra, or reordered histories reduce to `UNKNOWN`.

Fence state is exactly `PREPARED` or `POST_ACTIVATION`. Launch records bind both
the prior immutable state-record digest and the prior current-pointer digest;
generation-zero ordinal-zero is only `READY` and both predecessors are `null`.
Every later transition requires both nonzero digests. A retry advances one
generation and resets the ordinal, while an authority rebind retains process and
lifecycle identity and advances exactly one adjacent gate or fence head.
Observed authority compares both the digest and ordinal of each gate/fence head.
A pre-fence handoff requires gate `PENDING` plus `PUBLISHED`; `ABORTING` can
terminalize only as `TERMINAL_ABORTED`. Recovery fence roots separately bind the
predecessor and successor operation-manifest digests.

Recovery authorization is a closed union on `bootstrap-n0` or `successor`.
Mode-inapplicable bindings are canonical `null`; successor launch attachment is
either entirely absent or a complete fence-backed READY/LIVE identity. Its
broker generations are adjacent, duplicated gate/fence authority roots must be
equal, attachment generation and attempt match the exact launch/current chain,
and consumed authority has no expiry. Cleanup ordinal zero is exactly
`PENDING`/`NOT_PUBLISHED`; promotion roots require their predecessor cleanup
head. Cleanup archives bind the root, ordered head-chain digest, revocation
proof, one exclusive activated/aborted proof union, and the active record
retained by the canonical cleanup head.

Recovery authorization attachment validates the complete canonical READY to
LIVE transition against a parsed `active-release/v1`, cleanup gate
root/head/current chain, recovery fence root/head/current chain, and the
caller's canonical argv digest. It recomputes every supplied immutable record
digest and requires every shared current-pointer authority field to equal the
LIVE record. Invalid, accessor-backed, reflective, or unreadable evidence
refuses before semantic fields or canonical digests are read.

Cleanup lifecycle and publication are one closed state pair. The only pairs are
`PENDING` with `NOT_PUBLISHED`, `PUBLISHING`, or `PUBLISHED`; `ACTIVATING` with
`PUBLISHED`; `ABORTING` with any of the four publication states; and `COMPLETE`
with `NOT_PUBLISHED` or `CLEARED`. The transition matrix admits crash-resume at
each pair plus only the publication, activation, abort, fence-clear, and
completion edges declared by the activation cleanup state machine. Cleanup
heads carry no fence or revocation proof at `PENDING`/`NOT_PUBLISHED`; later
heads admit only the proofs authorized by their exact pair.

Repository-protection authority pins API version `2022-11-28`, protected
environment `host-custody-bootstrap-root`, and verifier version `2.93.0`. The
anchor digest equals the protected variable value, whose API update is at or
strictly before producer start; producer start is strictly before receipt issue.

## Review attack surface

Compatibility tests attack missing and extra fields, future/legacy confusion,
role widening, noncanonical bytes, unsafe integer and timestamp forms, absolute
or alternate paths, transaction substitution, stale and skipped generations,
source-token mismatch, partial lifecycle authority, absent predecessor/CAS
digests, cleanup publication without fence evidence, anchor provenance changes,
and custom or candidate-provided verifier roots. These checks are local; later
cross-OS conformance executes the same canonical byte goldens without changing
their authority.

The exact serialized fixture bytes for all 38 families are pinned by one
ordered SHA-256 golden root. Changing any fixture byte, schema family order, or
canonical serializer rule requires an intentional compatibility update.

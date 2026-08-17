# Credential reference and recovery-authorization contract

Secret bytes remain inside the custody topology admitted by `ISS-031`.
Runtime state contains only closed `credential-reference/v1` values, native
receipt digests, and the pointer records defined here. A reference binds the
installation, project, closed capability set, allowed roles, backend and
principal, expiry, revocation generation, and non-secret fingerprint. A native
store reference is never itself an isolation boundary.

`ISS-032` implements the exact cross-principal topology selected by `ISS-031`.
Its IPC endpoint is mutually authenticated, manifest-listed, replay fenced, and
not discoverable authority. Secret bytes never enter argv, environment,
journals, receipts, or worker processes. Missing, expired, moved, copied,
wrong-principal, extra-capability, or malformed references refuse.

## Production broker lifecycle

The private broker is statically composed, has no package export, dynamic
operation registration, CLI surface, or network listener, and admits only the
exact topology selected by ISS-031:

| OS | Custody/native lifecycle | IPC proof target |
| --- | --- | --- |
| Windows x64 | no-login virtual service account; SCM service hosted by pinned WinSW with wrapper/Node/broker/config/release digests | local named pipe with frozen SDDL and verified client process/token |
| macOS | dedicated no-login account; root-owned LaunchDaemon | root-owned Unix socket with peer credentials and verified client executable |
| Linux | dedicated no-login account; hardened systemd service/private runtime directory | AF_UNIX socket with peer credentials and verified client executable |

The passed ISS-031 artifact freezes exact identities, fields, confinement,
assets, architecture support, restart/teardown, endpoint ownership, and client
attestation. Inability to distinguish reviewed installed bytes from a worker or
copy is `BLOCK_REPLAN`. ISS-032 implements broker/service definitions and
transactional lifecycle; ISS-020 composes the reviewed bootstrap executable;
production provisioning uses a one-use broker-owned channel and retains only
non-secret receipts.

External adapters call only statically registered bounded operations by reviewed
operation ID. No callback or arbitrary endpoint is accepted. Each tick starts
with an empty credential environment and receives only availability/capability
receipts. Unattended pre-login access is not promised.

## Credential reference lifecycle

| State | Authority/evidence | Next operation |
| --- | --- | --- |
| `UNBOUND` | exact operator bind transaction and no durable reference | bind through admitted provisioning flow |
| `BOUND_AVAILABLE` | broker lookup plus exact custody/fingerprint/capability/role match | execute one bounded operation |
| `BOUND_LOCKED` | native item exists but declared user session cannot unlock it | later tick rechecks without mutation |
| `REVOKED` | selected generation/revocation and native absence/disable receipt | refuse; provision a new identity |
| `EXPIRED` | bounded expiry reached | revoke and replace |
| `UNKNOWN` | moved/conflicting identity, wrong user, malformed or extra capability | external diagnosis; refuse all access |

Provisioning accepts no secret flag/file/stdin payload. One-use recovery
capability creation is internal to the reviewed bootstrap/release client: the OS
CSPRNG bytes are written directly to broker custody and only their closed
reference/digest/bindings leave it.

## Recovery authorization core

`recovery-authorization-core/v1` is a domain-separated immutable projection.
Its exact common field census is transaction, installation, project, state-root
digest, host, user, issued/expiry times, capability reference/digest, native
generation, mode, and reviewed producer identity.

The `BOOTSTRAP` mode union additionally contains grant, installer, candidate,
and destination identities. The `SUCCESSOR` union additionally contains
candidate/cycle/admission identities, prior and successor broker generations,
expected active generation, predecessor and successor release/executable
digests, distinct predecessor and successor operation-manifest digests,
and the precomputable recovery-fence path and digest. The core excludes cleanup
gate digest, lifecycle, consumption/revocation evidence, and attachment.

`candidateOperationManifestDigest` is not a core field. Its presence, including
a value coordinated with other candidate fields, is an unknown-field failure;
candidate identity is already bound by the reviewed candidate/release evidence.

The core digest is:

```text
SHA256(frame("recovery-authorization-core/v1", canonical-core-bytes))
```

This breaks the former gate/authorization digest cycle. The cleanup gate binds
the selected `CREATED` authorization tip, value, and proposal receipt plus the
core digest. The authorization value may then bind the gate root.

## Authorization state pointer

The canonical pointer is transaction-scoped beneath
`installation/recovery-authorizations/`. It uses
`RECOVERY_AUTHORIZATION_STATE` and the common pointer CAS protocol. Its closed
states are `CREATED`, `CONSUMED`, `REVOKED`, and `REMOVED`.

Its closed schemas are `recovery-authorization-core/v1`,
`recovery-authorization-state/v1`, `native-consume-receipt/v1`,
`recovery-authorization-consume-receipt/v1`, `native-removal-receipt/v1`,
`recovery-authorization-revoke-receipt/v1`, and
`recovery-authorization-archive/v1`. Native and post-selection receipts use
deterministic canonical paths beneath
`installation/recovery-authorizations/<transaction>/native/<operation-id>.json`
and `.../receipts/<operation-id>.json`; their schema discriminator prevents a
consume/removal or pre/post-selection path collision.

Before `CREATED`, the broker prebinds a deterministic `consumeOperationId` and
native consume-receipt path. Consumption is ordered:

1. the broker performs native consume and writes/read-backs the native receipt;
2. the old selected authority proposes and selects `CONSUMED`, whose value
   contains that receipt digest, core digest, and gate binding;
3. the broker writes a post-selection consume receipt binding the selected
   `Dt/Dv/Dr`, native receipt, core, gate, principal, and exact operation.

`CONSUMED` is non-expiring transaction authority; it is not a bearer secret.
Restart resolves that selected state and receipt rather than consuming again.
Revocation similarly writes/read-backs a native-removal receipt first, selects
`REVOKED`, then writes the post-selection revoke receipt. Terminal cleanup
archives the evidence and selects the durable `REMOVED` tombstone. Bare absence
never restores authority.

Partial, mixed-lifecycle, null-at-required, duplicate, wrong-principal,
wrong-generation, wrong-core, wrong-gate, reordered, or self-asserted receipts
refuse. Receipt files do not grant mutation authority; the selected state
mutation epoch and live ISS-004 mutation handle do. Every authorization-state
selection also advances the exact `POINTER_MUTATION_RUN_CURRENT` meta pointer;
the terminal resolution excludes that selector graph and the downstream
post-selection observation completes it.

## Attachment pointer

Authorization attachment is a separate
`RECOVERY_AUTHORIZATION_ATTACHMENT` pointer with `UNATTACHED`, `ATTACHED`,
`TERMINAL`, and `REMOVED` values. `ATTACHED` binds a selected LIVE attempt
descriptor and its reservation, launch, gate, fence, active-release, broker,
argv, process, and current authority triples. It never binds a future terminal
record. `TERMINAL` later binds the selected `TERMINAL` attempt-log record —
which folds in the terminal state/lineage, exit/absence, and channel-denial
fields — and exact revocation/exit evidence; no separate terminal-summary
document exists.

Its value and archive schemas are
`recovery-authorization-attachment/v1` and
`recovery-authorization-attachment-archive/v1`; the canonical tip is exactly
`installation/recovery-authorizations/<transaction>/attachment.json`.

The first attempt may bind explicit attempt-log genesis. Every later attachment
binds the predecessor selected `TERMINAL` attempt-log record. A
`MUTATION_COMMIT` packet proves the current descriptor/attachment and latest
predecessor `TERMINAL` attempt-log record plus the exact selected run-current
checkpoint. Its top authority and complete identity tuple cross-bind to the
exact registry slot: selected target, observed real winner, or empty for
`SELECTED`, `LOST_CONFLICT`, or `UNKNOWN`. Broker paths never accept packet
UNKNOWN details beyond the fixed-size closed category/reason/digest/safe-length
union. Historical
producer epochs are verified by the full authority-history chain walk in the
live current authority context; the attempt log stays small and is verified in
full.

Pre-fence recovery may consume the narrowed capability and publish the
precomputed fence, but cannot attach. It must terminalize and tombstone before a
fence-backed attempt reserves authority. Abort admits no broker client and
requires terminal abort plus native revocation. Promotion recovery may call
only the already-reviewed successor activation operation; it cannot gain any
unrelated credential capability.

## Active client and rotation bindings

`broker-active-client/v1` binds the selected active release, installed
executable and operation manifest, activation generation, custody principal,
and exact selected `ACTIVE_RELEASE` pointer triple. Stable N alone may prepare a
non-active N+1 admission. The selected activation transaction may activate it
only after active-release selection and exact recovery/gate/fence validation.
Candidate N+1 never activates itself.

Every broker mutation executes through the ISS-004 state service with a live
`MUTATION_COMMIT` handle and verifies the selected state-mutation authority
epoch, kernel lock custody, run-current and target graphs, and current release
identity. A historical-only handle exposes no broker mutation. Authority
rotation revokes all old handles/projections and does not rotate broker
authority implicitly; broker rotation remains a separate reviewed transition
whose cross-bindings must be selected/read back before use.

## Ownership and verification

`ISS-002` owns schemas and pure validators. `ISS-004` owns the revocable state
service, run-current selection, pointer mutation, and private capabilities.
`ISS-014` supplies release/gate/fence facts. `ISS-020` owns destination-owner,
anchor, reviewed-bootstrap genesis, and reinstall. `ISS-030` supplies selected
reservation, descriptor, and attempt-log facts. `ISS-031` selects and
proves custody topology. `ISS-032` produces core/state/native receipts,
attachment, revocation, and active-client transitions. `ISS-022` proves the
physical locator and cross-process lock/custody prerequisites.

Compatibility tests must attack the complete core field census, both mode
unions, the consume/revoke ordering, wrong native receipt, coordinated digest
substitution, cyclic/self-selected authority, attachment-to-terminal-record
confusion, ordinal-overflow assumptions, and every malformed closed
record/array.
The negative census inserts every excluded lifecycle, gate, consume, revoke,
attachment, and candidate-operation-manifest field individually and in
coordinated groups; every insertion must fail as unknown before digest use.

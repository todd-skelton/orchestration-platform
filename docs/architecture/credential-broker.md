# Credential reference and broker contract

Runtime records never contain secret bytes. `credential-reference/v1` binds a
UUIDv7 credential identity, project, closed capability set, allowed worker
roles, backend kind/reference, provisioner identity, creation/expiry, revocation
generation, and non-secret fingerprint. Missing/extra capabilities fail closed.

The admitted custody topology and backends are selected by `ISS-031` from:

- Windows Credential Manager generic credential through native CredRead/CredWrite
  APIs, exact target name and custody-principal SID;
- macOS Keychain generic password through Security framework, exact service and
  account;
- Linux Secret Service through the session D-Bus collection/item identity;
- role-specific Codex home reference protected by the probe-admitted role boundary, exact path/
  file census, and Codex authentication metadata without durable token capture.

Same-user possession of a native-store reference is never an isolation boundary.
Admission requires direct Windows `CredReadW`, macOS `SecItemCopyMatching`, or
Linux Secret Service D-Bus extraction attempts from every worker role to be
enforced-denied. If a current-user store permits one attempt, that topology is
ineligible; `ISS-031` must prove and select a separately confined broker
principal/process and role boundary before implementation may proceed. A mere
private package export, sanitized environment, or cooperative prompt is not
confinement.

When the selected topology crosses a process/principal boundary, the `ISS-031`
decision artifact freezes its native IPC kind, endpoint/handle creation, owner
and ACL identities, client/process attestation, request framing, replay fence,
restart behavior, and teardown. Only a pre-opened or mutually authenticated
channel bound to a manifest-listed client is admissible; a discoverable same-
user endpoint or bearer token is not. `ISS-032` implements that exact artifact
and repeats direct endpoint, handle-duplication, process-impersonation, replay,
and wrong-principal attacks on all three OSes.

## Production broker lifecycle

If `ISS-031` admits only cross-principal custody, the release contains the
private executable statically composed from
`bootstrap/build/broker-service-composition.ts` and the `ISS-032` broker core,
compiled to
`packages/credentials/dist/orchestration-credential-broker.mjs`. It has no CLI
command surface, package export, dynamic operation registration, or network
listener. The mandatory target topology is:

| OS | Custody identity and native lifecycle | IPC candidate that must pass `ISS-031` |
| --- | --- | --- |
| Windows x64 | no-login virtual service account; SCM service `OrchestrationCredentialBroker` hosted by pinned `WinSW-x64.exe` v2.12.0, with exact wrapper/Node/broker/config/release digests and automatic start | local named pipe created by the service with frozen SDDL and verified client process/token identity |
| macOS | dedicated no-login `_orchestration_broker` account; root-owned LaunchDaemon `dev.orchestration-platform.credential-broker` | root-owned Unix-domain socket with peer credentials and verified client executable identity |
| Linux | dedicated no-login `orchestration-broker` system account; systemd unit `orchestration-credential-broker.service` with `NoNewPrivileges`, `ProtectSystem=strict`, and private runtime directory | AF_UNIX socket in the private runtime directory with `SO_PEERCRED` and verified client executable identity |

The exact account/service/socket/pipe fields, confinement options, and client
attestation algorithm are frozen by the passed `ISS-031` artifact; the table is
not permission to weaken them. If any row cannot distinguish the reviewed
bootstrap/installed runtime from a worker or copied executable, the probe
returns `BLOCK_REPLAN`.

`ISS-031` must prove the exact WinSW 2.12.0 asset SHA-256, XML/SCM controls,
startup/stop/restart/failure behavior, service-account execution of the bound
absolute Node 24 executable plus `.mjs`, and unsupported-architecture refusal.
`ISS-032` owns the broker core, the pinned WinSW asset/package/license and three
service-definition generators, install/upgrade/restart/teardown transaction
library, IPC protocol, and synthetic lifecycle tests. `ISS-020` owns the final
static broker-service composition/output and exposes reviewed bootstrap commands that
plan/apply/verify/remove only those exact definitions. In production `ISS-034`
runs broker installation before credential provisioning or N0 installation,
performs provisioning only through a one-use local broker-owned channel, proves
cold-reboot availability and attacks, and retains non-secret receipts. An
interrupted broker install resumes or removes the same digest-bound transaction;
it cannot leave a second principal, service, endpoint, or writable binary.

External API adapters invoke only a statically registered
`withCredential(reference, capability, operationId, input)` operation inside
the admitted broker custody boundary. An operation ID names reviewed code; no
caller-supplied callback or arbitrary endpoint is accepted. Secret bytes are
zeroed there after the bounded operation and never cross the custody boundary or
enter argv, journals, receipts, or ambient process environment. The Codex host
receives only its admitted role-specific `CODEX_HOME` reference; no token
environment variable is used, and `ISS-023` independently proves that other
roles cannot read its storage through filesystem or native-store APIs.

The supervisor installation stores only credential-reference identities. Each
tick starts with an empty ambient credential environment, asks the broker for a
fresh availability/capability receipt, and refuses external reads/writes before
access if the native store/home is missing, locked, moved, expired, revoked,
wrong-user, extra-capability, or unknown. A store unlocked at the declared user
session may proceed; unattended pre-login access is not promised.

Project/API credential references are installation-scoped, not release-scoped:
they bind installation, project, role, closed capabilities, adapter contract,
custody identity, expiry, and revocation generation. A separate
`broker-active-client/v1` record binds the installation's current release,
installed self-host executable/operation-manifest digests, activation generation,
and exact `active-release/v1` digest. Both must match on every ordinary
credential/canary/mutation operation.

Stable N alone receives the closed `release.successor-admin` client. Before
install mutation it may call `prepareSuccessorClient` to create a non-active N+1
admission bound to the reviewed candidate and promotion transaction. N remains
the sole ordinary client. After the supervisor active-release record atomically
switches to N+1, the same already-live N transaction calls
`activateSuccessorClient` with that record and promotion receipt; the broker
atomically activates N+1 and revokes N ordinary authority. A pre-activation
abort removes pending admission. A post-activation crash is forward-recovered
by only that transaction/recovery capability; the supervisor shim fence blocks
ordinary N+1 ticks until activation completes. No raw secret is re-provisioned
or crosses custody. Replay, wrong candidate/installation/generation, N1 self-
activation, moved executable/operation manifest, skipped active-record switch,
or concurrent successor refuses.

There is exactly one mismatch exception: after pointer CAS and before broker
activation, the already-open predecessor N IPC transaction—or one fresh channel
from the current `LIVE` generation of the canonical
`activation-recovery-launch/v1` record bound to the same fence/cycle/transaction/
recovery capability—may call only
the existing `activateSuccessorClient(pending, activeRecord, promotionReceipt)`
method while
`active-release/v1` names N+1 and `broker-active-client/v1` still names N. The
broker authenticates the pre-CAS predecessor executable/channel, pending-
admission identity, promotion transaction, recovery capability, predecessor and
successor digests, fence, active-record digest, adjacent activation generations,
and exact recovery-launch generation/attempt/argv/process identity. There is no
additional recovery method or dynamically registered recovery form. The
installed predecessor composition reconstructs the same privately branded
`SuccessorAdminClientV1`; the current recovery channel supplies its launch
identity, while all method arguments are re-read from the durable transaction.
The method is idempotent only for the same pending admission/transaction/target:
if activation already committed, it returns the byte-identical durable receipt;
otherwise it performs the one permitted CAS. The one-use recovery capability is
consumed once into the durable `CONSUMED_BOUND` authorization defined below;
later launch generations may prove and use that binding but cannot receive,
consume again, replace, or widen the capability. A terminal
attempt's channel is invalid. After the shim proves that attempt
`TERMINAL_RETRYABLE` and CAS-creates the next generation, only that new matching
channel is admitted; sequential retries do not mint or change the underlying
one-use recovery capability. It returns no project credential operation. An
unrecorded or stale-attempt channel, concurrent generation, fresh ordinary N
call, any ordinary N method,
N1 self-activation, abort after pointer CAS, missing fence/recovery binding, or
non-adjacent/mixed record refuses. Successful CAS of broker-active-client to N+1
ends the exception permanently.

## Credential reference lifecycle

| State | Permitted authority | Trigger/evidence | Interruption/recovery | Next operation |
|---|---|---|---|---|
| `UNBOUND` | operator bind transaction | no durable reference | remain absent | bind reference |
| `BOUND_AVAILABLE` | admitted broker custody identity | native lookup + custody/fingerprint/capability/role match | reacquire per operation | execute bounded operation |
| `BOUND_LOCKED` | none for external access | native store/home exists but is locked/unavailable | wait for declared user unlock; no retry mutation | later tick rechecks |
| `REVOKED` | readers/operator | generation/revocation receipt and native absence/disable | idempotent read | refuse; provision new identity |
| `EXPIRED` | readers | monotonic/wall-clock bounded expiry reached | no extension | revoke/new bind |
| `UNKNOWN` | none | moved identity, fingerprint conflict, wrong user, malformed reference, or extra capability | external diagnosis | refuse all referenced access |

Provisioning is an explicit operator action using the probe-admitted broker
provisioning flow or `codex login` under the exact isolated role home. Platform `credential bind`
validates and records only the reference/capability receipt; it does not accept a
secret flag/file/stdin payload.

There are exactly two non-operator creation paths. The first is the internal, non-CLI
`createOneUseRecoveryCapability(request)` API for the reviewed bootstrap/release
installer. The broker generates 256 random bits through the OS CSPRNG and writes
them directly to the admitted broker-custody native store before returning only
`one-use-recovery-reference/v1` (identity, backend item, generation, digest,
target host/user, installer/candidate/transaction/state-root bindings). Raw bytes
never cross the broker boundary. `consumeOneUseRecoveryCapability(reference,
bindings)` atomically compare-and-swaps generation to consumed, verifies the
stored digest/bindings in-process, and returns only an opaque authorization
result. `revokeOneUseRecoveryCapability` removes/invalidates the item after
terminal verification. These APIs require the closed `release.recovery-admin`
caller capability; adapters, workers, CLI credential handlers, and arbitrary
package callers cannot invoke them.

The non-secret authority record is canonical
`<state-root>/installation/recovery-authorizations/<transaction>.json` with
closed schema `recovery-authorization/v1`. `@orchestration-platform/credentials`
owns its parser and CAS lifecycle. It binds installation/host/user/state root,
capability reference/digest/native generation, issued time, optional pre-
consumption expiry, and
state `CREATED_UNCONSUMED`, `CONSUMED_BOUND`, `REVOKED`, or `UNKNOWN`. Raw
capability bytes remain only in native custody.

It is a closed union on `mode`. `bootstrap-n0` additionally requires bootstrap
installer/candidate/grant/transaction/destination-state-root identities and
encodes predecessor, successor, pending admission, promotion cycle/fence,
active-record/broker generations, and recovery launch as canonical JSON `null`.
`successor` requires predecessor/successor executable/manifest, pending
admission, promotion transaction/cycle/fence, expected active-record/broker
generations, and recovery-launch binding; bootstrap installer/grant fields are
canonical `null`. Null in a required mode field, non-null in an inapplicable
field, omission, or mixed-mode binding refuses.

For successor mode before any recovery launch exists, `CONSUMED_BOUND` encodes
`recoveryLaunch: null` canonically. After the shim create-once writes and
authenticates the current generation N `READY`→`LIVE` immutable chain and
current pointer, the launched predecessor opens its broker-authenticated channel.
Before returning any recovery client, the broker permits exactly one CAS from
null to `{source, generation:N, attempt, readyRecordDigest,
initialLiveStateRecordDigest, gateRootDigest, fenceRootDigest}`. These fields are
the immutable attempt identity, not a mutable current-pointer digest. Later attachment updates require the prior attached
attempt terminal and CAS directly to the adjacent generation's authenticated
READY→LIVE chain. The shim has no broker client and never performs attachment.
N may exceed zero only when every earlier immutable attempt is terminal-
retryable and the authorization has remained null; this permits recovery after
one or more children die before their broker handshake. A second null
attachment, concurrent attachment, skipped attached generation, non-LIVE
current target, nonterminal prior attempt, broken READY→LIVE chain, or
mismatched transaction refuses; failed attachment makes the child exit without
recovery authority and the monitor terminalizes it retryable. A
transaction that never needs recovery reaches terminal revocation with the null
binding unchanged.

For every call on an attached channel, the broker validates that the canonical
launch pointer descends from the attached initial LIVE record through the exact
same-source immutable transition chain. `AUTHORITY_REBIND` records may advance
only adjacent gate/fence head digests under unchanged roots and do not update or
reattach `recoveryAuthorization.recoveryLaunch`. Lifecycle transitions remain
subject to their own closed rules. Missing/nonadjacent history, changed attempt/
source/root/process, or a second attachment refuses before the broker operation.

Successor recovery attachment requires a `recovery-fence/v1` LIVE chain, gate
`PENDING` or `ACTIVATING` with publication `PUBLISHED`, and the exact canonical
fence. A `cleanup-gate-pre-fence/v1` chain
never attaches recovery authorization, even after it consumes the one-use
capability. It must terminalize and be archived/removed before a fresh fence-
backed generation-zero chain can perform the first attachment.

The gate-bound predecessor continuation may reconstruct a recovery-admin client
only for `PENDING` plus the matching `CREATED_UNCONSUMED` record. That client
exposes only `consumeOneUseRecoveryCapability`; successful consume/read-back
must precede fence publication and the pre-fence chain's terminal handoff.
`ABORTING` never admits this client or any broker client: unconsumed and consumed
abort revocation remain broker-internal.

For successor `PENDING` plus `CONSUMED_BOUND`, the broker admits no recovery
attachment but recognizes the gate's exact `NOT_PUBLISHED` → `PUBLISHING` →
`PUBLISHED` CAS sequence. `PUBLISHING` may coexist only with canonical fence
absence or the exact precomputed fence. Publication does not change or attach
the authorization; only a later fresh fence-backed LIVE chain may attach it.

`consumeOneUseRecoveryCapability` verifies native bytes/bindings and CASes
`CREATED_UNCONSUMED` to `CONSUMED_BOUND` only after read-back of the matching
immutable cleanup-gate root and current `PENDING` head's created/expected-
consumed digests, then returns
authorization. A crash
is resolved by exact native/reference/record read-back: the same transaction may
observe its already-consumed binding but cannot consume again. Each recovery
channel must prove the current immutable launch identity and descendant current-
pointer chain; the broker updates the attached attempt identity by CAS only after
the prior attempt is terminal. Cross-transaction, skipped/replayed generation, changed
fence/candidate/executable, expired unconsumed, revoked, or unknown records
refuse. Consumption must complete before N0's first destination mutation or
before an N1+ recovery fence becomes visible. Once `CONSUMED_BOUND`, that exact forward-recovery
authorization has no wall/monotonic expiry and remains confined to its immutable
transaction until broker-internal terminal revocation; time cannot convert an
irreversible post-activation state into an unrecoverable one.

Before cleanup-gate creation, the exact `release.recovery-admin` client may call
`revokeOneUseRecoveryCapability` only for `CREATED_UNCONSUMED` after proving the
canonical gate and irreversible mutation absent. Once a gate exists, every
client-side abort/revoke operation refuses. Recovery attachment remains limited
to the exact `PENDING`/`ACTIVATING`, `PUBLISHED`, fence-backed LIVE chain above;
`ABORTING` denies an existing channel and every new attachment. Abort first
CASes `PENDING` to `ABORTING`; activation instead CASes `PENDING` to
`ACTIVATING`. These are mutually exclusive and the broker's
internal reconciler is the sole revocation initiator for either
`CREATED_UNCONSUMED` or `CONSUMED_BOUND`. N0 requires authoritative destination
absence. Successor mode requires active pointer still N, gate `ABORTING`, and
shim-proven staging absence. The reconciler compare-and-removes only the gate's
exact pending successor admission and reads back its absence before revocation.
`NOT_PUBLISHED` additionally requires authoritative canonical-fence absence.
`PUBLISHING` accepts only canonical fence absence or the exact precomputed fence;
the shim idempotently completes exact fence create/read-back and CASes
`PUBLISHED` even after abort wins.
`PUBLISHED` requires the exact fence retained through revocation. After
revocation the shim removes any retained fence and CASes publication to
`CLEARED`. The reconciler removes
the native item, CASes
`REVOKED`, and emits the abort revocation receipt. Broker restart resumes this
same ordered admission-remove → native-item-remove → authorization-`REVOKED`
transaction from durable per-step receipts. Death before or after every step
resumes the missing suffix; a moved/different admission or false staging absence
refuses. For successor abort, the shim must first terminalize, archive, and
remove any pre-fence or fence-backed launch as `TERMINAL_ABORTED`; the broker
validates that proof or authoritative pointer absence. If `ACTIVATING` won,
abort refuses even while the active record still names N and forward recovery
continues. Once N0 has any destination mutation or the
successor pointer boundary is crossed, abort refuses and only the internal
mode-specific terminal reconciler may revoke.

Terminal revocation is mode- and attachment-specific. Bootstrap N0 requires the
exact bootstrap receipt/verification, installed generation-zero active release/
broker client, and authoritative absence of any recovery-launch pointer.
Successor mode with `recoveryLaunch:null` requires successor active/broker,
terminal predecessor cycle, fence absence, and authoritative launch-pointer
absence. An attached successor requires those successor proofs plus its matching
launch `TERMINAL_COMPLETE`; launch archive may still be pending. The broker
service's internal reconciler—not a client method—then removes the native item
and CASes the record to `REVOKED`; the non-secret
terminal record remains immutable evidence. Successful broker activation ends
the predecessor activation exception immediately, and the consumed binding can
never authorize a project operation or a fourth client method. The always-on
broker reconciler watches only its bound installation state; restart resumes the
same cleanup. Every mode binds the immutable cleanup-gate root and its canonical
current/head chain; until the exact
revocation receipt exists and that gate is archived/removed, the supervisor
refuses the first ordinary N0/N1 tick. An attached recovery additionally retains
its terminal launch pointer. A crash at
cleanup resumes this exact suffix without predecessor ordinary authority.

The second is the internal host-custody surface:
`createHostEvidenceKey(enrollment)` generates Ed25519 inside the broker and
writes PKCS#8 bytes directly to the admitted native store;
`signHostEvidence(reference, canonicalReceiptDigest)` returns only the public
key and signature; `revokeHostEvidenceKey(reference)` advances generation and
removes/disables the key. Creation/revocation require
`host.evidence-admin`; signing requires `host.evidence-sign` plus exact
host/user/state/collector/enrollment bindings. Raw private bytes never leave the
broker. Host-custody package calls these APIs and may not access a native item
directly.

The reviewed bootstrap binder may call
`verifyBoundCapability(reference, capability, canaryId)` under closed
`bootstrap.credential-verify`. The broker resolves the secret only inside the
statically registered, certified adapter/host canary callback and returns
`credential-capability-proof/v1`; the binder never receives secret bytes.
Canaries are read-only and exact: provider identity/read scope, CI/artifact read,
and Codex authenticated preflight for the bound role home. No arbitrary callback,
mutation capability, token echo, or caller-selected endpoint is accepted.
All caller issuance, sole grantees, object-capability confinement, and canary
registrations are exhaustive in `docs/architecture/broker-client-manifest.md`.

One-use recovery references add `CREATED_UNCONSUMED`, `CONSUMED_BOUND`,
`REVOKED`, and `UNKNOWN`; host-evidence references use their separately closed
created/active/revoked lifecycle. Create and consume are durable native-store/
state compare-and-swap transactions. A crash before create commit is absent;
after commit it resumes by
the same reference. A crash during consume is resolved by read-back to exactly
unconsumed or consumed—never guessed or regenerated.

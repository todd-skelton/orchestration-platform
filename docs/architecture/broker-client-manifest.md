# Broker client and bootstrap canary manifest

`broker-client-manifest/v1` is closed and generated into released/bootstrap
composition bundles; runtime registration is forbidden.

| Client capability | Sole grantee composition | Allowed broker methods |
|---|---|---|
| `release.recovery-admin` | reviewed `orchestration-bootstrap` installer and installed stable `@orchestration-platform/release` composition | create/consume/revoke one-use recovery capability |
| `release.successor-admin` | installed stable `@orchestration-platform/release` composition only | prepare/activate/abort one exact successor client admission |
| `host.evidence-admin` | independently reviewed pre-N0 or installed `@orchestration-platform/host-custody` enrollment/teardown composition | create/revoke host evidence key |
| `host.evidence-sign` | independently reviewed pre-N0 or installed `@orchestration-platform/host-custody` collector composition | sign canonical host evidence only |
| `bootstrap.credential-verify` | independently reviewed `orchestration-bootstrap bind-credentials` composition | invoke exact static canary IDs and receive non-secret proofs |

The exported authority-free type `RecoveryAdminClientV1` contains exactly
`createOneUseRecoveryCapability(request)`,
`consumeOneUseRecoveryCapability(reference, bindings)`, and
`revokeOneUseRecoveryCapability(reference)`.
The exported authority-free `SuccessorAdminClientV1` contains exactly
`prepareSuccessorClient(request)`, `activateSuccessorClient(pending, activeRecord,
promotionReceipt)`, and `abortSuccessorClient(pending)`.
`abortSuccessorClient` is valid only before cleanup-gate creation and only for
the exact inactive admission; once the gate exists or is `ABORTING`, it refuses.
Post-gate admission removal and recovery revocation are broker-internal and no
client composition exposes them.
`activateSuccessorClient` is the sole activation and recovery activation method:
on a broker-authenticated current recovery-launch channel it re-reads durable
arguments and is byte-idempotent for the already-committed identical target.
No `recover*` method or runtime extension exists.
`@orchestration-platform/release` exports
`createReleaseService({ recoveryAdminClient, successorAdminClient })`; only
private-WeakSet clients created by an authorized composition pass runtime brand checks.
`ISS-032` owns this type, brand, and injection contract; `ISS-014` consumes it
and cannot construct, deserialize, discover, or substitute a client.

`broker-operation-manifest/v1` is the exhaustive service-side registry. Every
row names reviewed code that executes inside broker custody; arbitrary callback,
endpoint, operation ID, or runtime registration is forbidden.

| Operation ID | Descriptor/implementation owner | Allowed capability/result |
| --- | --- | --- |
| `codex.authenticated-preflight/v1` | `@orchestration-platform/host-codex` `./bootstrap-canaries` | authenticated role-home identity → redacted proof |
| `github.viewer-identity/v1` | `@orchestration-platform/adapter-self` `./bootstrap-canaries` | `code-host.read` → actor/repository proof |
| `github.permission-introspection/v1` | same | bound capability census → permission proof |
| `github.actions-artifact-read/v1` | same | `artifact.read` → artifact identity proof |
| `github.code-host-read/v1` | `@orchestration-platform/adapter-self` `./broker-operations` | `code-host.read` → typed paginated facts |
| `github.branch-pr-write/v1` | same | `code-host.branch-pr-write` → typed mutation receipt |
| `github.merge/v1` | same | `code-host.merge` → typed merge receipt |
| `github.ci-read/v1` | same | `ci.read` → typed check/workflow facts |
| `github.ci-dispatch/v1` | same | `ci.dispatch` → typed dispatch receipt |
| `github.artifact-read/v1` | same | `artifact.read` → typed artifact bytes/identity |
| `github.artifact-write/v1` | same | `artifact.write` → typed upload receipt |

The pre-N0 service does not use that registry. Its exhaustive
`host-method-manifest/v1` contains exactly these core methods:

| Method ID | Required client capability | Result boundary |
| --- | --- | --- |
| `createHostEvidenceKey` | `host.evidence-admin` | non-secret public key, native reference, generation |
| `signHostEvidence` | `host.evidence-sign` | signature over one canonical host-evidence subject |
| `revokeHostEvidenceKey` | `host.evidence-admin` | non-secret revocation generation and receipt |

`@orchestration-platform/credentials` owns two mutually exclusive closed
service factories. `createHostCustodyBootstrapBrokerService({
hostMethodManifest })` accepts only the exact three-row manifest and stamps
profile `host-custody-bootstrap/v1`; it has no operation-registry parameter or
downstream operation dispatch path. `createCredentialBrokerService({
operationRegistry })` accepts only `broker-operation-manifest/v1` and stamps
profile `production/v1`. Service identity, endpoint handshake, client brand,
reference, request, receipt, and upgrade plan all bind one profile and manifest
digest. Cross-profile clients/references/requests, adding an operation registry
to the reduced factory, omitting a production operation, or invoking any
downstream operation through the reduced service refuses before native-store or
network access.

`@orchestration-platform/credentials` owns
`createCredentialBrokerService({ operationRegistry })`, native backends, IPC,
and exact registry validation in `ISS-032`; it is not an executable and its
tests use closed synthetic operations only. `ISS-020` owns
`bootstrap/build/broker-service-composition.ts`, which statically imports the
exact descriptors/implementations from `ISS-021` and `ISS-033`, emits the sole
service executable, and proves an exact manifest/bundle/method census. The
service refuses startup on any missing, extra, duplicate, moved, digest-
mismatched, callback-bearing, or capability-expanded row.

`@orchestration-platform/credentials` exports no token constructor or dynamic
registration API. Its build-only `packages/credentials/build/compose.ts` is
reachable solely through the three client-composition aliases/entrypoints frozen in the
bootstrap manifest. It verifies the exact manifest digest and source census,
then emits a closed bundle whose private factory creates in-memory
object capabilities in a private `WeakSet`, binds methods to the declared
composition ID and transaction/installation, then injects only those narrowed
clients while assembling the exact executable bundle. Capabilities are
non-serializable, absent from environment/argv/state, and reconstructed after
restart only by the same reviewed installed executable and manifest digest.
The bootstrap entrypoint is owned by `ISS-020`; the installed self-host runtime
entrypoint is owned by `ISS-033`; the pre-N0 host-custody entrypoint is owned by
`ISS-038` and receives only host-evidence clients. Build alias and empty entrypoint declarations
are owned by `ISS-000`; generator implementation is owned by `ISS-032`. Deep
imports, alternate bundler entries, unlisted packages, forged/lookalike
objects, cross-client method calls, and generic callback registration fail the
build census or broker identity check before native-store access.

`bootstrap-canary-manifest/v1` is also closed:

| Canary ID | Implementation owner | Exact read-only proof |
|---|---|---|
| `codex.authenticated-preflight/v1` | `@orchestration-platform/host-codex` | pinned CLI authenticated identity/role-home preflight from the passed `ISS-023` surface; no work dispatch |
| `github.viewer-identity/v1` | `@orchestration-platform/adapter-self` | repository/current numeric actor identity under the passed `ISS-036` API matrix |
| `github.permission-introspection/v1` | `@orchestration-platform/adapter-self` | exact GitHub app/token installation permissions covering each bound read/write capability without performing a write |
| `github.actions-artifact-read/v1` | `@orchestration-platform/adapter-self` | exact fixture workflow/artifact metadata and attested subject read from the passed `ISS-036` matrix |

Each owner exports only a typed registration descriptor and the exact broker-
side implementation containing canary ID,
input/result schemas, implementation digest, allowed credential capability, and
fixed endpoint/CLI operation. `ISS-020` statically imports those exact
descriptors into the reviewed bootstrap bundle and rejects missing, extra,
duplicate, moved, runtime-discovered, or callback-bearing rows. Canary secrets
are injected and consumed inside the broker callback; implementations may emit
only the schema-redacted `credential-capability-proof/v1`.

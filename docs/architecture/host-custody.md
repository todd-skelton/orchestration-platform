# Host custody and reboot evidence contract

`host-custody/v1` is the sole authority identity for a designated test, review,
or production target host. Enrollment records exact OS kind/image, canonical
host fingerprint, user identity, state-root digest, evidence public key, native
key reference, enrollment workflow/run/artifact IDs, operator comparison, and
expiry/revocation generation.

Canonical identities are computed as follows:

- Windows host input is registry `MachineGuid`; user input is the current token
  SID in uppercase canonical `S-...` form.
- macOS host input is IOPlatformUUID uppercase without braces; user input is
  numeric UID plus Directory Services GeneratedUID.
- Linux host input is lowercase 32-hex `/etc/machine-id`; user input is decimal
  UID plus the account name returned for that UID.
- The raw host input is never retained. `hostFingerprint` is SHA-256 of canonical
  JSON `{domain:"orchestration-host/v1",osKind,hostInput}`. `userIdentity` is
  canonical JSON of the OS-specific user fields. `stateRootDigest` is SHA-256 of
  the UTF-8 canonical absolute `file:` URL after symlink/final-path resolution.

At enrollment, `@orchestration-platform/host-custody` calls the broker's closed
`createHostEvidenceKey` under `host.evidence-admin`; the broker generates
Ed25519 with OS CSPRNG and stores PKCS#8 private bytes directly in the admitted
probe-admitted broker-custody native store. Host custody receives only public key/reference and
uses `signHostEvidence` under `host.evidence-sign`. A pinned enrollment workflow supplies a
one-use nonce, verifies a local signed challenge, and emits an OIDC-attested
enrollment receipt. Todd compares the locally displayed and workflow-attested
fingerprints before admitting the host. Missing native Ed25519 custody on any
required OS is `BLOCK_REPLAN`, not a plaintext-key fallback.

## Independently reviewed pre-N0 custody kit

`ISS-038` emits two exact private bundles before `ISS-029`:
`orchestration-host-custody-bootstrap.mjs`, whose build-only composition receives
only `host.evidence-admin` and `host.evidence-sign`, and
`orchestration-host-custody-broker.mjs`, a reduced `ISS-032` service composition
containing only host-evidence core methods. The latter has no project credential,
release recovery/successor, bootstrap verification, downstream operation
registry, or network listener. Both bundles, broker lifecycle definitions,
Node/WinSW assets, and independent review receipt are exact digest inputs to all
host evidence and later final N0 certification.

The exact review producer is the protected GitHub pull-request review plus
`.github/workflows/host-custody-bootstrap-build.yml` and
`.github/workflows/host-custody-bootstrap-review.yml`. The build workflow runs
only for a landed `main` commit, proves that commit's tree equals the reviewed PR
head tree, builds both bundles and all lifecycle definitions, and emits a
GitHub artifact attestation over a closed build inventory. The review workflow
runs only from the successful build workflow, reads the complete non-dismissed
GitHub review history through the API, and accepts exactly one `APPROVED` review
whose commit/tree matches the inventory and whose numeric actor differs from
source author, committer, and build actor. The repository ruleset requires that
review, dismisses it on new commits, prevents self-approval, and forbids admin
bypass for these paths. Before either workflow may run, `ISS-036` must produce
`repository-protection-receipt/v1` proving the exact ruleset/path-policy,
ISS-036 synthetic probe workflow,
dismissal/self-review/admin-bypass behavior, workflow permissions/triggers,
complete review pagination, artifact-attestation permission, and the synthetic
positive/negative run. The receipt is a required input to both workflows.

The result is `host-custody-bootstrap-review-receipt/v1`, binding repository,
landed commit/tree, PR and review numeric IDs, reviewer numeric actor, build and
review workflow paths/refs/commit/digests/run/attempt IDs, build-attestation identity,
both bundle digests, `host-method-manifest/v1` digest, Windows/macOS/Linux
service-definition digests, absolute Node 24 asset/version/digest, WinSW 2.12.0
asset/license/digest, review prompt/schema digest, lifecycle contract digest,
the `repository-protection-receipt/v1` digest, and disposition `ACCEPTED`.
The review workflow's built-in, run-scoped GitHub token performs the complete
read-only PR/review/ruleset API census inside GitHub Actions and is never
exported. Target verification uses the operator-retained
`bootstrap-verifier-anchor/v1`, created before the kit candidate and stored at
`<state-root>/bootstrap/verifier-anchor.json`. It pins GitHub CLI 2.93.0 plus the
official per-OS asset/checksum identities and requires the CLI's independently
embedded/default online Sigstore/TUF trust bootstrap; kit bytes cannot supply a
custom root, verifier, or expected digest. The target invokes
`gh attestation verify` against the downloaded public bundle with `--bundle`,
`--repo`, `--predicate-type`, `--signer-workflow`, `--signer-digest`,
`--source-digest`, `--source-ref refs/heads/main`, and
`--deny-self-hosted-runners`. Only certificate/source/signer/timestamp claims are treated as
cryptographically asserted. Review predicate fields are accepted only because
the verified signer/source digests name the exact protected, independently
reviewed workflow that performs the closed GitHub API reducer. Verification
performs no project-authenticated API call and accepts no local token. `ISS-036` must prove
that this credential-free public-bundle verification works on all three target
OSes or return `BLOCK_REPLAN`. Network/TUF unavailability, anchor/verifier/root/
bundle combined substitution, unsigned, rejected, dismissed, stale,
self-authored, incomplete-
pagination, protection/tree/workflow/digest-substituted receipts refuse. This
review authority can attest or refuse;
it cannot build, install, enroll, sign host evidence, or grant project authority.

The kit's complete command and state surface is:

| Canonical argv | Actor | Input → output | Required transition |
| --- | --- | --- | --- |
| `service-plan --request <file> --output <file>` | reviewed kit plus operator | `host-custody-service-plan-request/v1` containing accepted review, target, and current census → `host-custody-service-plan/v1` | `ABSENT` → `PLANNED` |
| `service-install --plan <file> --plan-id <sha256> --output <file>` | reviewed kit with explicit OS administration | exact fresh plan → `host-custody-service-install-receipt/v1` or exit-6 recovery record | `PLANNED` → `INSTALLED_REDUCED` |
| `service-verify --receipt <file> --output <file>` | reviewed kit/readers | install receipt plus live principal/service/endpoint/profile read-back → `host-custody-service-verification/v1` | `INSTALLED_REDUCED` → `INSTALLED_REDUCED` |
| `enroll --request <file> --output <file>` | reviewed kit plus operator | verified service, one-use workflow nonce, host/user/state bindings → `host-custody-enrollment-receipt/v1` | `INSTALLED_REDUCED` → `ENROLLED` |
| `challenge --request <file> --output <file>` | reviewed kit plus operator | enrollment plus expected reboot/tick bindings → `host-custody-challenge/v1` | `ENROLLED` → `CHALLENGE_ARMED` |
| `verify-reentry --request <file> --output <file>` | reviewed kit/readers | challenge plus signed collector record/read-back → `host-reentry-verification/v1` | `CHALLENGE_ARMED` → `REENTRY_VERIFIED` |
| `teardown --request <file> --output <file>` | reviewed kit with explicit OS administration | exact latest lifecycle receipt plus disposition `retain-for-n0` or `remove` → `host-custody-retention-receipt/v1` or `host-custody-removal-receipt/v1` | `REENTRY_VERIFIED` → `RETAINED_FOR_N0`; `PLANNED`, `INSTALLED_REDUCED`, `ENROLLED`, `CHALLENGE_ARMED`, or `REENTRY_VERIFIED` → `REMOVED` |

Every shown flag is required exactly once; unknown, duplicate, positional, or
extra flags refuse before state creation. Root wrapper
`pnpm run host-custody:bootstrap --` forwards bytes and adds no defaults. Every
record binds the accepted review receipt, service profile
`host-custody-bootstrap/v1`, exact prior record digest, transaction/generation,
host/user/state identity, and current read-back. `retain-for-n0` removes the
test collector, challenge, uploader, and test scheduler but preserves exactly
the reviewed reduced service/principal/store and host-key public reference/
generation — usable only through its closed profile — for the N0 upgrade.
`remove` is predecessor-specific: from `PLANNED`
it cancels the exact plan and proves service/key absence; from
`INSTALLED_REDUCED` it removes the exact service/principal/endpoint after
proving no key exists; from `ENROLLED`, `CHALLENGE_ARMED`, or
`REENTRY_VERIFIED` it first revokes the exact key through broker
`revokeHostEvidenceKey`, proves signing denial, then
removes all service/principal/endpoint/test definitions after exact absence
read-back. Each path retains its distinct signed retention or state-bound
removal receipt. Missing
or extra residue, references from another installation, or unknown process/key
state blocks terminalization.

An interrupted mutating command emits its command-specific exit-6 recovery
record and may resume only the same transaction/argv target to one of the states
shown above. No second plan or teardown disposition may supersede a live or
unknown transaction. Repeating a terminal command returns byte-identical
read-back; it does not create a new generation or silently change disposition.

Service mutation requires explicit OS administration and the exact `ISS-032`
transaction library; enrollment/signing uses private object clients and the
confined service. Source-tree, unreviewed, extra-command/method, alternate
target, runtime import, cross-profile value, or missing review refuses.

The reduced service may remain installed through bootstrap authorization only
with a `host-custody-retention-receipt/v1`. `ISS-034` supplies that receipt to
the final `ISS-020` `broker-plan`; the plan CAS-binds the reviewed reduced
service/profile/manifest/executable/generation and target production
profile/operation-manifest/executable. `broker-install` performs the same-
principal/store forward upgrade and emits `broker-upgrade-receipt/v1`.
`broker-verify` proves the production profile, operation manifest, process and
endpoint, unchanged non-exportable host-key public key/reference/generation,
and absence of reduced-byte start/connect authority. Any stale plan, changed
key/reference/generation, profile substitution, concurrent service mutation,
or private-key copy/export blocks the upgrade and leaves the reduced service in
its last verified state.

Before reboot, the collector writes a create-once challenge binding installation,
release, expected next tick, scheduler-definition digest, credential-set digest,
boot generation, and monotonic/wall times. At the first eligible user session,
the scheduler-invoked installed collector reads OS boot identity, recomputes
host/user/state identities, records scheduler/process/tick/credential outcomes,
signs `host-reentry-receipt/v1` with the native key, and writes it atomically
under the state root. A separately credentialed evidence uploader may upload
only that signed non-secret receipt by exact run/artifact target; upload success
is not part of local authority. Operator collection from the explicit path is
the fallback. Receipt verification checks signature, nonce, boot movement,
identities, exact installed bytes, and lifecycle timestamps.
Moved/cloned key, unchanged boot identity, wrong user/state root,
manual collector start, unsigned output, upload-only evidence, receipt replay,
or evidence from the opposite teardown disposition is unknown/refused.

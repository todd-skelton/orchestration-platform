# Bootstrap package, CLI, and compatibility manifests

These tables are authoritative for the bootstrap issues. Changes require a
reviewed planning decision rather than an implementation-lane choice.

## Workspace packages

| Package | Canonical path | Primary public exports | Owning issue |
|---|---|---|---|
| `@orchestration-platform/contracts` | `packages/contracts/` | schemas, canonical JSON, identities, compatibility | `ISS-002` |
| `@orchestration-platform/config` | `packages/config/` | config discovery, precedence, provenance | `ISS-003` |
| `@orchestration-platform/cli` | `packages/cli/` | `orchestrate` entrypoint and output envelope | `ISS-003` |
| `@orchestration-platform/conformance` | `packages/conformance/` | harness registry, receipt aggregation, suite census | `ISS-006`, `ISS-019` |
| `@orchestration-platform/state` | `packages/state/` | create-once, compare-and-swap, atomic replace, durable append | `ISS-004` |
| `@orchestration-platform/process` | `packages/process/` | native launch, identity, census, bounded termination | `ISS-005` |
| `@orchestration-platform/session` | `packages/session/` | lease transitions and health reducer | `ISS-007` |
| `@orchestration-platform/adapter-sdk` | `packages/adapter-sdk/` | adapter interfaces, facts, plans, conformance | `ISS-013` |
| `@orchestration-platform/dispatch` | `packages/dispatch/` | dispatch plans, ownership, occupancy reducer | `ISS-008` |
| `@orchestration-platform/breaker` | `packages/breaker/` | breaker lifecycle, capability holds, recovery receipts | `ISS-025` |
| `@orchestration-platform/engine` | `packages/engine/` | routine cycle planning, execution, resume, inspection | `ISS-026` |
| `@orchestration-platform/supervisor` | `packages/supervisor/` | cadence, scheduler installation, cold-host tick receipts | `ISS-030` |
| `@orchestration-platform/credentials` | `packages/credentials/` | export exactly `.`; credential references, native broker, capability receipts; build-only `packages/credentials/build/compose.ts` is never exported or shipped standalone | `ISS-032` |
| `@orchestration-platform/host-custody` | `packages/host-custody/` | export exactly `.`; host/user/state identity, enrollment, signed reboot evidence | `ISS-038` |
| `@orchestration-platform/review` | `packages/review/` | review receipts and exact-subject reducer | `ISS-009` |
| `@orchestration-platform/journal` | `packages/journal/` | event append, replay, reducers, snapshots | `ISS-010` |
| `@orchestration-platform/routing` | `packages/routing/` | provider contract, evidence matrix, route selection | `ISS-012` |
| `@orchestration-platform/release` | `packages/release/` | candidate assembly, certification inputs, promotion, recovery | `ISS-014` |
| `@orchestration-platform/host-codex` | `packages/host-codex/` | exports exactly `.`, `./bootstrap-canaries`; Codex CLI discovery, launch, identity, terminal receipts | `ISS-021` |
| `@orchestration-platform/adapter-self` | `adapters/self/` | exports exactly `.`, `./workspace`, `./code-host`, `./certification`, `./bootstrap-canaries`, `./broker-operations`; platform-repository frontier, workspace, GitHub/CI, certification, and mutation policy | `ISS-000`, `ISS-033` |
| `@orchestration-platform/adapter-first-consumer` | `adapters/first-consumer/` | first-consumer composition plus `./shadow`, `./import`, `./mutation` | `ISS-000`, `ISS-028` |

Portable workflow modules live under `modules/` and are release-manifest
artifacts rather than npm library exports. Their exact static entrypoints,
execution ABI, registry, and admission rules are defined in
`docs/architecture/module-abi.md`.

The shared native-store attack-suite fixture is `ISS-031`-owned at the
canonical path `probes/credentials/attack-suite/`; its digest binding is
recorded in its manifest row.

`ISS-000` creates every package manifest, empty public entrypoint, and root
script. It also creates an empty `modules/manifest.json`, a deterministic
placeholder `modules/build/generate-registry.mjs`, and placeholder composition
entrypoints. The placeholder generator accepts only the empty manifest, emits
the fixed empty `modules/.generated/registry.ts`, and identifies `ISS-011` for
any non-empty row. This makes skeleton builds executable without pretending the
modules exist; `ISS-011` replaces the manifest/generator contract and adds the
four entrypoints. Later owners otherwise fill only their predeclared package and tests.

The root build graph predeclares three private client-composition entrypoints:
`bootstrap/build/composition.ts` (`ISS-020`) and
`adapters/self/build/composition.ts` (`ISS-033`), plus
`packages/host-custody/build/composition.ts` (`ISS-038`). A build-only alias
available only to those three bundler targets maps `#broker-compose` to
`packages/credentials/build/compose.ts`; it is absent from Node/package exports,
TypeScript runtime resolution, published tarballs, and installed source maps.
Those targets emit closed bundles containing only their narrowed clients. A
fourth private entrypoint,
`bootstrap/build/broker-service-composition.ts` (`ISS-020`), statically composes
the `ISS-032` broker core with the exact downstream operation descriptors and
emits the production broker service executable; it cannot resolve
`#broker-compose`. A fifth,
`packages/host-custody/build/broker-service-composition.ts` (`ISS-038`), emits
the pre-N0 reduced broker service containing only host-evidence core methods and
no downstream operation registry or release/credential-verification client.
No runtime import or dynamic composition exists.

## Private composition build contract

The bootstrap pins `esbuild@0.28.2` exactly in the lockfile. `ISS-000` owns
`scripts/build/private-compositions.mjs` and
`config/private-compositions.json`; no package may provide or override bundler
options. The configuration contains exactly these entries and outputs:

| Target ID | Entry point | Installed output |
| --- | --- | --- |
| `bootstrap` | `bootstrap/build/composition.ts` | `bootstrap/dist/orchestration-bootstrap.mjs` |
| `self-host` | `adapters/self/build/composition.ts` | `adapters/self/dist/orchestration-self.mjs` |
| `credential-broker` | `bootstrap/build/broker-service-composition.ts` | `packages/credentials/dist/orchestration-credential-broker.mjs` |
| `host-custody-bootstrap` | `packages/host-custody/build/composition.ts` | `packages/host-custody/dist/orchestration-host-custody-bootstrap.mjs` |
| `host-custody-broker` | `packages/host-custody/build/broker-service-composition.ts` | `packages/host-custody/dist/orchestration-host-custody-broker.mjs` |

For all five targets the immutable options are `bundle: true`, `platform: "node"`,
`format: "esm"`, `target: "node24"`, `splitting: false`, `sourcemap: false`,
`minify: false`, `treeShaking: false`, `packages: "bundle"`, and
`external: ["node:*"]`. The script rejects additional entries, outputs,
plugins, aliases, external packages, and option overrides. Its sole resolver
plugin maps the exact specifier `#broker-compose` only when the importer graph
roots at one of the three client-composition entrypoints; broker-service and every
other importer receive a build
error. Builds use `write: false`, inspect the single JavaScript output and
esbuild metafile, reject emitted private specifiers/paths or extra outputs, then
atomically write only the named `.mjs`. Metafiles remain test evidence outside
release/install artifacts.

Before the `self-host` target only, the root script runs the exact
`modules/build/generate-registry.mjs` contract from
`docs/architecture/module-abi.md`; esbuild receives the resulting literal static
imports through the composition entrypoint. The broker resolver remains the
only esbuild plugin. No module-list plugin, dynamic import, or hand-maintained
adapter registry is permitted.

The three-OS bootstrap suite rebuilds all five outputs from a clean checkout and
compares byte hashes. It also runs third-entry, direct/deep import, alternate
config/plugin, externalization, emitted-specifier, tarball, installed-file, and
source-map mutants against this exact script. A general-purpose root `esbuild`
command and package-local build override are forbidden.

## CLI command ownership

The CLI owns parsing, global flags, output envelopes, and a static command
registry. Each owning package exports a typed command-handler registration;
the CLI composes only those registrations declared here. `ISS-000` creates the
registry declarations and placeholders, while the implementation issue replaces
only its named placeholder. Runtime discovery, filesystem scanning, and
last-registration-wins behavior are forbidden.

| Command family | Handler owner |
|---|---|
| `config` | `@orchestration-platform/config` (`ISS-003`) |
| `session` | `@orchestration-platform/session` (`ISS-007`) |
| `worker` | `@orchestration-platform/dispatch` (`ISS-008`) |
| `review` | `@orchestration-platform/review` (`ISS-009`) |
| `journal` | `@orchestration-platform/journal` (`ISS-010`) |
| `project` | `@orchestration-platform/adapter-sdk` (`ISS-013`) |
| `release` | `@orchestration-platform/release` (`ISS-014`) |
| `cycle` | `@orchestration-platform/engine` (`ISS-026`) |
| `supervisor` | `@orchestration-platform/supervisor` (`ISS-030`) |
| `credential` | `@orchestration-platform/credentials` (`ISS-032`) |
| `status` | `@orchestration-platform/status` (`ISS-042`) |

## CLI grammar

The executable is `orchestrate`. Global flags precede the command:

`--project-root <path>`, `--state-root <path>`, `--config <path>`,
`--output json|text`, and `--no-color`.

Global flags are optional, may appear at most once, and have the discovery/
default behavior defined in the configuration contract. In the table below,
every command-local flag shown without brackets is required exactly once.

Every file argument is a named flag whose value is a host path. Every identity
argument is lowercase UUIDv7 except source revisions and content digests, which
are lowercase hex. Options may not be positional or inferred. These invocations
and result schema families are exhaustive:

| Canonical argv after global flags | Input schema | Result schema |
|---|---|---|
| `config validate` | project/config records | `configuration-provenance/v1` |
| `config paths [--reveal]` | project/config records | `configuration-paths/v1` |
| `session acquire --request <file>` | `session-acquire-request/v1` | `session-receipt/v1` |
| `session renew --session <id>` | identity | `session-receipt/v1` |
| `session inspect [--session <id>]` | optional identity | `session-health/v1` |
| `session release --session <id>` | identity | `session-receipt/v1` |
| `session handoff --predecessor <file> --successor <file>` | `session-handoff-intent/v1` pair | `session-handoff-receipt/v1` |
| `worker dispatch --plan <file>` | `dispatch-plan/v1` | `worker-launch-receipt/v1` |
| `worker inspect --launch <id>` | identity | `worker-health/v1` |
| `worker terminate --launch <id>` | identity | `worker-terminal-receipt/v1` |
| `review reduce --subject <id> --journal <file>` | subject identity + `event-journal/v1` | `review-authority/v1` |
| `journal append --event <file>` | `orchestration-event/v1` | `journal-append-receipt/v1` |
| `journal reduce --journal <file>` | `event-journal/v1` | `reduced-state/v1` |
| `journal snapshot --journal <file> --output <file>` | `event-journal/v1` | `snapshot-receipt/v1` |
| `project snapshot --adapter <file>` | `adapter-configuration/v1` | `project-facts/v1` |
| `project plan --request <file>` | `project-mutation-request/v1` | `project-mutation-plan/v1` |
| `project apply --plan <file> --plan-id <sha256>` | `project-mutation-plan/v1` | `project-apply-receipt/v1` |
| `release assemble --source-revision <sha> --output <file>` | exact revision | `release-candidate/v1` |
| `release certify --candidate <file> --output <file>` | `release-candidate/v1` | `release-certification/v1` |
| `release promote --input <file>` | `release-promotion-input/v1` | `release-promotion-receipt/v1` |
| `release recover --input <file>` | `release-recovery-input/v1` | `release-recovery-receipt/v1` |
| `cycle plan --request <file>` | `cycle-request/v1` | `cycle-plan/v1` |
| `cycle run --plan <file> --plan-id <sha256>` | `cycle-plan/v1` | `cycle-receipt/v1` |
| `cycle resume --cycle <id>` | identity | `cycle-receipt/v1` |
| `cycle inspect --cycle <id>` | identity | `cycle-health/v1` |
| `supervisor plan --request <file>` | `supervisor-request/v1` | `supervisor-install-plan/v1` |
| `supervisor install --plan <file> --plan-id <sha256>` | `supervisor-install-plan/v1` | `supervisor-install-receipt/v1` |
| `supervisor tick --installation <id>` | identity | `supervisor-tick-receipt/v1` |
| `supervisor inspect --installation <id>` | identity | `supervisor-health/v1` |
| `supervisor uninstall --installation <id>` | identity | `supervisor-uninstall-receipt/v1` |
| `credential bind --request <file>` | `credential-bind-request/v1` containing reference/capabilities, never a secret | `credential-reference-receipt/v1` |
| `credential inspect --credential <id>` | identity | `credential-health/v1` |
| `credential revoke --credential <id>` | identity | `credential-revocation-receipt/v1` |
| `status show` | none | `operator-status/v1` |

Duplicate flags, positional substitutes, missing values, unknown commands, or
unknown flags are invalid input. Project discovery walks from the
explicit/current directory to the filesystem root and requires exactly one
`.orchestration/project.json`; multiple candidates, project-ID conflict, broken
symlink resolution, or a root outside the selected checkout refuses before
state creation.

## Output and exit codes

JSON output is one canonical envelope:

```json
{
  "schemaVersion": "orchestration-command-result/v1",
  "command": "config validate",
  "outcome": "success",
  "result": {},
  "diagnostics": []
}
```

Allowed outcomes and exits:

| Exit | Outcome |
|---:|---|
| 0 | `success` |
| 2 | `invalid-input` |
| 3 | `authority-refused` or `authority-unknown` |
| 4 | `external-unavailable` |
| 5 | `operation-failed` |
| 6 | `recovery-required` |
| 70 | `internal-error` |

Diagnostics never carry secrets or unredacted home paths. Text mode is a human
projection of the same envelope and is not authority evidence.

## Bootstrap compatibility

Current authority dispatch uses the exact versions selected by the architecture
as amended by the `Proportionality and schema lifecycle` decisions: every
family is `v1`, including `state-mutation-authority-value/v1`, the
`authority-history/v1` chain, rotation identity, run intent/current
value/core, commit evidence, evidence slot/packet, and the twelve-kind
registry. Superseded
pre-deployment generations are deleted, not archived; no diagnostic API
exists. No authority version is implicitly migrated and no old record may be
selected by bootstrap.

| Observed version | Disposition |
|---|---|
| exact current schema at its current path | readable/selectable |
| explicit legacy non-authority fixture with a named pure migration | migratable only through that migration |
| missing, malformed, unknown, future, or old authority at a current path | refused |
| pre-platform incumbent state | imported only through the first-consumer adapter; never read as a platform record |

ISS-002 owns schema/compatibility changes. ISS-004 owns chain appends, run
CAS, crash recovery, and full-chain verification. ISS-020 creates the E0
genesis record. ISS-022 proves the lock, create-once/readback existence
semantics at constructed paths, and custody semantics. No root wrapper or
package manifest changes are required for this amendment.

## Bootstrap authority CLI

The bootstrap executable is `orchestration-bootstrap`; root pnpm scripts are
literal argument-forwarding wrappers and add no defaults or authority. It uses
the same canonical envelope and exit mapping as `orchestrate`. Its complete
surface is:

| Canonical argv | Actor | Input/result schemas |
|---|---|---|
| `candidate --source <file> --output <file>` | pinned bootstrap build workflow | `bootstrap-source-subject/v1` → `release-candidate/v1` |
| `certify --candidate <file> --output <file>` | pinned bootstrap aggregator workflow | `release-candidate/v1` → `release-certification/v1` |
| `broker-plan --request <file> --output <file>` | independently reviewed bootstrap executable plus operator | `broker-install-plan-request/v1` containing accepted candidate/review, exact `ISS-031` topology/host, and required `host-custody-retention-receipt/v1` → `broker-install-plan/v1` CAS-binding the reduced and production identities |
| `broker-install --plan <file> --output <file>` | independently reviewed bootstrap executable with explicit OS administration | fresh `broker-install-plan/v1` → `broker-upgrade-receipt/v1` (or new-install `broker-install-receipt/v1` only on an explicitly absent fixture host) or exit-6 `broker-install-recovery/v1` |
| `broker-verify --receipt <file>` | reviewed bootstrap executable/readers | upgrade/install receipt + live service/principal/endpoint/profile/manifest/key read-back → `broker-verification/v1` |
| `broker-remove --receipt <file> --output <file>` | reviewed bootstrap executable with explicit OS administration | exact installation + fenced clients → `broker-removal-receipt/v1` |
| `bind-credentials --request <file> --output <file>` | independently reviewed bootstrap executable on the bound target host | `bootstrap-credential-bind-request/v1` containing native references + accepted review → `bootstrap-credential-set-receipt/v1` |
| `authorize --candidate <file> --certification <file> --review <file> --grant <file> --output <file>` | reviewed bootstrap installer validating protected-environment attestation | bound inputs + `bootstrap-grant-attestation/v1` → `bootstrap-install-input/v1` |
| `install --input <file> --output <file>` | reviewed bootstrap installer | `bootstrap-install-input/v1` → `bootstrap-receipt/v1` or exit-6 `bootstrap-recovery-transaction/v1` |
| `abort --input <file> --output <file>` | same reviewed bootstrap installer plus operator before first destination mutation | existing immutable `bootstrap-install-input/v1`; derive its deterministic transaction/authorization/gate paths, read back the authoritative destination census, and emit `bootstrap-abort-receipt/v1`; authorization-absent refusal, pre-gate revoke, or idempotent post-gate `ABORTING` resume |
| `recover --transaction <file> --output <file>` | same reviewed bootstrap installer on the bound target host | `bootstrap-recovery-transaction/v1` + broker-held one-use capability → `bootstrap-receipt/v1` |
| `verify --receipt <file>` | readers/operator | `bootstrap-receipt/v1` → `bootstrap-verification/v1` |

Every shown flag is required exactly once. Unknown, missing, duplicate,
positional, or extra arguments refuse before state creation. The source-subject
record is emitted by trusted workflow context and contains an exact lowercase
40-hex Git revision plus workflow/test-bundle digests; symbolic revisions such
as `HEAD` are invalid. `ISS-020` owns this executable and wrappers.
Production candidate, certification, and grant inputs carry the authenticated
attestation bundles/claims admitted by `ISS-029`; fixture-generated unsigned
records are accepted only under an unmistakable test capability and can never
target the production state root.

## Self-contained release commands

Bootstrap candidate certification:

```text
pnpm run bootstrap:fixture-source
pnpm run bootstrap -- candidate --source .artifacts/bootstrap-source.json --output .artifacts/n0-candidate.json
pnpm run bootstrap -- certify --candidate .artifacts/n0-candidate.json --output .artifacts/n0-certification.json
```

Bootstrap installation:

```text
pnpm run bootstrap -- broker-plan --request .artifacts/n0-broker-install-request.json --output .artifacts/n0-broker-install-plan.json
pnpm run bootstrap -- broker-install --plan .artifacts/n0-broker-install-plan.json --output .artifacts/n0-broker-install-receipt.json
pnpm run bootstrap -- broker-verify --receipt .artifacts/n0-broker-install-receipt.json
pnpm run bootstrap -- bind-credentials --request .artifacts/n0-credential-bind-request.json --output .artifacts/n0-credential-set-receipt.json
pnpm run bootstrap -- authorize --candidate .artifacts/n0-candidate.json --certification .artifacts/n0-certification.json --review .artifacts/n0-review.json --grant .artifacts/n0-grant-attestation.bundle --output .artifacts/n0-install-input.json
pnpm run bootstrap -- install --input .artifacts/n0-install-input.json --output .artifacts/n0-bootstrap-receipt.json
pnpm run bootstrap -- abort --input .artifacts/n0-install-input.json --output .artifacts/n0-abort-receipt.json
pnpm run bootstrap -- recover --transaction .artifacts/n0-recovery-transaction.json --output .artifacts/n0-bootstrap-receipt.json
pnpm run bootstrap -- verify --receipt .artifacts/n0-bootstrap-receipt.json
```

`recover` is invoked only after `install` exits 6 and names the durable recovery
transaction. A successful uninterrupted install does not invoke it. The
`abort` example is an alternate cancellation transcript and is never invoked
after a successful mutation/install; rerunning it resumes only the same
pre-mutation abort and returns the byte-identical receipt.
The
transaction contains a credential reference and capability digest, never raw
capability bytes; the native broker resolves it only for the exact target host,
custody/user identities, installer digest, transaction, and destination state root.
`broker-remove` is a recovery/uninstall operation and is not run after a healthy
N0 installation; its transaction is nevertheless exercised by bootstrap tests.

Root verification also includes `pnpm run modules:test` and
`pnpm run planning:check`. The first executes portable module tests without a
fictional npm package; the second validates the roadmap, draft frontmatter,
milestone/epic membership, direct dependency edges, cycles, command census, and
the generated direct-edge DAG blocks in epics.

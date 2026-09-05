# Portable module execution ABI

## Closed runtime contract

Portable modules implement `orchestration-module/v1`. Each source entrypoint
exports `descriptor` and `plan`. The bounded disposition proposal below permits
one additional optional `disposition` export under its explicit admission rule;
there are no other exports:

```ts
interface OrchestrationModuleV1 {
  readonly descriptor: ModuleDescriptorV1;
  plan(input: Readonly<ModulePlanInputV1>): Promise<ModulePlanResultV1>;
  disposition?(input: Readonly<ActionDispositionInputV1>): Promise<ActionDispositionV1>;
}
```

`module-descriptor/v1` binds the module ID/version, ABI `orchestration-module/v1`,
accepted engine/adapter/contract compatibility, closed input and output schema IDs,
declared action kinds, whether an action needs worker/review, and required
capability names. The fifth literal-group proposal in `contract-decisions.md`
explicitly replans the previously undefined "canonical reduced facts" and
"adapter policy digest": `module-plan-input/v1` carries the actual complete
ISS-013 snapshot/current-policy observations, configuration/provenance,
cycle/session request, descriptor and nullable concrete review subject.
Snapshot facts are not `reduced-state/v1`; the existing policy tuple identifies
the policy, while a policy-fact digest identifies only its observation.
Compatibility uses finite exact-version tuples instead of an undefined range
interpreter; host compatibility retains the existing capability/renderer
contracts. These proposed corrections require independent review and grant
no breaker clearance or installed module admission. `module-plan-result/v1`
is exactly one canonical
`module-action-plan/v1`, `module-no-action/v1`, or typed refusal. `plan` has no
ambient filesystem, process, network, clock, random, credential, adapter, host,
or mutation access; those effects remain with their owning packages.

The `Disposition and follow-up literal proposal` in `contract-decisions.md`
explicitly adds the optional, statically source-owned disposition phase without
changing plan input/output bytes. The descriptor's fixed inputSchemas and
outputSchemas describe step 4 only. A disposition export is allowed only with
nonempty dispositionCodes; it is not required merely to preserve a plan-only
module's ABI validity. The inline ActionDispositionInputV1 is the ledger's
closed tuple of actual existing records, not a new public JSON schema. This
call has the same purity/effect restrictions as plan and is bound to one actual
step-11 identity. Full-routine admission must prove this exact installed handler
and code census before worker or workerless action effects. A plan-only module
with no admitted handler remains a partial ABI implementation, not a full-cycle
module. Code membership cannot resolve or load a function. Unknown exports,
an export with empty codes, moved source or missing full-cycle handler refuse.
This conditional export/callable replan requires independent review before code.

## Static admission and loading

`ISS-011` owns `modules/manifest.json` and these baseline entrypoints:

| Module ID  | Source entrypoint               |
| ---------- | ------------------------------- |
| `planning` | `modules/planning/src/index.ts` |
| `delivery` | `modules/delivery/src/index.ts` |
| `review`   | `modules/review/src/index.ts`   |
| `repair`   | `modules/repair/src/index.ts`   |

The manifest is an ordered closed list. For each row it records the source-tree
digest, emitted-module digest, descriptor digest, ABI/schema IDs, and
compatibility/capability declarations. Release assembly recomputes those values
and binds the whole manifest digest into `release-manifest/v1`.

### Closed manifest row and ordered build

`modules/manifest.json` contains one canonical JSON array and a final LF. N0 has
exactly four rows in the table order above. A row has exactly these members in
canonical key order:

| Member                | Complete rule                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `abi`                 | literal `orchestration-module/v1`                                                        |
| `capabilityNames`     | the descriptor action rows' distinct capability projection, strictly ASCII sorted        |
| `compatibility`       | the descriptor's complete ordered exact-version tuple array                              |
| `descriptorDigest`    | the existing framed `module-descriptor/v1` digest                                        |
| `emittedEntryPoint`   | literal `modules/<moduleId>/dist/index.mjs`                                              |
| `emittedModuleDigest` | SHA-256 of the exact emitted entrypoint bytes                                            |
| `inputSchemas`        | exact descriptor projection, currently `["module-plan-input/v1"]`                        |
| `moduleId`            | exact table ID; rows are strictly ordered `planning, delivery, review, repair`           |
| `moduleVersion`       | exact descriptor version                                                                 |
| `outputSchemas`       | exact descriptor projection, currently `["module-action-plan/v1","module-no-action/v1"]` |
| `sourceEntryPoint`    | literal `modules/<moduleId>/src/index.ts`                                                |
| `sourceTreeDigest`    | source-census digest below                                                               |

All strings retain the existing `Id`, `Name`, `Version`, schema-ID, and digest
grammars. Compatibility rows retain their complete descriptor rules and order.
Every direct projection must equal the parsed descriptor; matching a copied
digest never repairs a differing declaration. Unknown fields, a noncanonical
file, wrong row order, a duplicate ID/path, a moved path, or any path containing
an absolute component, backslash, dot segment, percent escape, URL syntax, or
non-ASCII byte refuses before a module is loaded or emitted.

For one module, the source census is every tracked regular `.ts` file below its
literal `modules/<moduleId>/src/` root. Directories and files are traversed by
strict ASCII slash path; symlinks, reparse points, hard-link aliases, untracked
entries, other extensions, empty censuses, duplicate normalized paths, and
entries outside that root refuse. Each tracked text file is normalized through
the repository's existing tracked-text LF normalizer. The private census is an
ordered array of exact `{path,sha256,size}` rows, where `path` is relative to the
module root, `sha256` hashes the normalized UTF-8 bytes, and `size` is their
safe integer byte length. `sourceTreeDigest = SHA256(C(census))`. The census is
build input and test evidence; it is not another public schema or shipped
registry.

The one generator performs these stages serially in manifest order:

1. read and canonical-byte-parse the manifest; seal its file identity and the
   complete source censuses and retain their normalized bytes before awaiting
   build work;
2. statically inspect each source graph from its fixed entrypoint and refuse
   dynamic imports, computed specifiers, imports outside that module or the
   public contracts package, and imports of filesystem, process, network,
   clock, random, credential, host, adapter, mutation, child-process, worker,
   native-addon, or package-resolution APIs;
3. emit one ESM Node-24 artifact per row from only those retained bytes with the repository's fixed build
   options and no caller-supplied resolver, option, define, plugin, environment,
   banner, footer, source map, or output path;
4. recheck every sealed source/manifest identity, then compare the source,
   emitted, and parsed descriptor digests plus all direct projections with that
   exact row;
5. only after every row passes, atomically replace each ignored `dist`
   entrypoint and replace the sole generated registry last.

Failure before publication leaves prior outputs unchanged. A publication write
failure aborts the build; ignored partial outputs are not admitted and the next
invocation must remove them before rebuilding the complete set. Temporary
output is created exclusively beside its fixed ignored destination and removed
on failure. The registry is the final commit marker: the self-host build starts
only after a post-publication census rechecks every final byte against every
manifest row. A repeated run from identical tracked input must produce
byte-identical emitted modules and registry. A stale, missing, extra,
hand-edited, partially replaced, or nondeterministic output refuses the
self-host build. Build outputs grant no runtime or release authority; installed
use still requires the stable release path and the exact release-manifest joins
below.

### First runtime consumer: neutral planning

The first source tranche is only `modules/planning/src/index.ts`. It is grounded
in the existing two ISS-013 fixture adapters and walking-skeleton module
consumer. It remains quarantined from `modules/manifest.json` and the generated
registry; final manifest activation still requires all four baseline source
entrypoints. Delivery and repair semantics remain undefined until their own
executable consumers start; the next review tranche is defined below. Its
descriptor is exact:

- `moduleId: planning`, `moduleVersion: 0.0.0`, ABI and schema arrays as above,
  and empty `dispositionCodes` (there is no optional disposition export);
- compatibility tuples for `fixture.branches` and `fixture.queue`, each adapter
  version `1.0.0`, engine version `0.0.0`, and policy version `1.0.0`, in that
  order;
- one action: `actionKind: planning.implement`, `capabilityName: work.read`,
  `requestedRole: implementation`, `workerRequired: true`, and
  `reviewRequired: true`;
- one catalog row for each existing required non-operator directive kind, in
  the existing directive order, with code and template ID
  `planning.<lowercase-hyphenated-directive-kind>` (ASCII lowercase with each
  underscore changed to a hyphen) and accessor
  `IMMUTABLE_SUBJECT_DIGEST`. `OPERATOR_ACTION` remains the required absent
  directive in the emitted brief and has no catalog row.

`plan` first parses the complete supplied input and requires byte-equal
descriptor identity with the exported descriptor. It accepts only ordinary
frontier planning (`reviewSubject:null`). It considers rows in the already
canonical `projectFacts.frontier` order and selects the first `READY` row that
declares `work.read` only when the complete policy census has `work.read` as
`NO_TRIP`. No row or a tripped capability returns the exact bound
`NO_ACTION/NO_ELIGIBLE_ACTION` result. A parse-valid alternate descriptor,
non-null review subject, or other valid-but-unusable input returns the exact
bound `REFUSED/INPUT_REFUSED` result. Missing exact compatibility, incomplete
policy census, invalid allowed-module intent, and every other structural or
relational input refusal remain caller failures: no input digest or module
result is fabricated. An internal inability after full admission returns
`REFUSED/PLANNING_FAILED`; a thrown call or malformed return remains the
caller's failure.

The selected action binds that row's work ID and immutable subject, the exact
descriptor/input digests, and a complete closed implementation-role dispatch
brief. Every present directive uses the fixed catalog lookup and the immutable
subject as its subject; the footprint is one `READ` resource with that same
identity. The module does not render prose, inspect project/provider data,
choose a host/model/route, launch work, request credentials, mutate state, or
claim current breaker clearance. The engine must independently recheck current
policy and installed registry authority before using the result.

For the same canonical input bytes, `plan` must produce byte-identical output
bytes and digest on every supported OS and repeated invocation. Selection uses
no time, randomness, locale, object insertion order, ambient configuration, or
iteration outside the canonical arrays. Single-axis fixtures cover descriptor,
adapter tuple, policy decision, row readiness/capability/order, review subject,
and every returned core/brief binding.

The first source packet's focused integration test must use the existing actual
preparation seam rather than constructing module input by hand: run the
ISS-013 branch and queue snapshot/current-policy readers through
`loadFixtureConfiguration`, `observeFixtureSnapshot`, and
`observeFixturePolicy`; call `composeFixtureModuleInput` with the new exported
descriptor; retain that exact parsed input across `await plan(input)`; then run
`validateModulePlanBinding` on the retained input and returned value. Pin a
branch fixture with one READY and one NOT_READY `work.read` row to its policy's
TRIP and the bound no-action result. Pin the equivalent queue fixture to its
one-NOT_READY NO_TRIP and the implementation action for the READY row. Also run
an all-READY NO_TRIP corpus through both adapters and require the same selected
work/action/core/brief projection; only the necessarily different
adapter-bound input digest may differ. Consumer source fields and terminology
must be absent from every retained public record and comparison.

### Next runtime consumer: neutral worker-result review planning

Round 443 defines only the initial quarantined source tranche,
`modules/review/src/index.ts`. It extracts the step-4 behavior already consumed
from `fixtures/walking-skeleton/src/review-module.ts`; it does not replace that
fixture module, copy its disposition, or enter a running cycle. At that tranche
the entrypoint exports exactly `descriptor` and `plan`, with no `disposition`
export. Its empty `dispositionCodes` makes it a partial ABI implementation;
Round 446 below defines the separate descriptor and handler change required for
full-routine admission before worker effects.
Planning's Round 439 source and identity remain unchanged, and both modules
remain absent from the empty manifest and registry.

The complete descriptor uses the existing closed `module-descriptor/v1`
members and no extensions:

- `schemaVersion: module-descriptor/v1`, `abi: orchestration-module/v1`,
  `moduleId: review`, and `moduleVersion: 0.0.0`;
- `inputSchemas: ["module-plan-input/v1"]`,
  `outputSchemas: ["module-action-plan/v1","module-no-action/v1"]`, and, for
  the initial plan-only tranche, `dispositionCodes: []`; Round 446 replaces
  only that last array with its ordered three-code census;
- exactly two compatibility rows, in order `fixture.branches`, then
  `fixture.queue`, each with adapter version `1.0.0`, engine version
  `0.0.0`, and policy version `1.0.0`;
- exactly one action: `actionKind: review.worker-result`,
  `capabilityName: work.read`, `requestedRole: review`,
  `workerRequired: true`, and `reviewRequired: false`. The last value is
  required by the existing review-role contract; it does not certify the target
  or waive the distinct-author and exact-target review authority gates;
- exactly eight catalog rows, in existing directive order:
  `ACCEPTANCE_EVIDENCE`, `CONSTRAINT`, `DECISION`, `NON_GOAL`,
  `REVIEW_ATTACK`, `SCOPE_EXCLUDE`, `SCOPE_INCLUDE`, `VERIFICATION`.
  Each row has the action/capability pair above, accessor
  `IMMUTABLE_SUBJECT_DIGEST`, and equal code/template ID formed as
  `review.` plus ASCII-lowercase directive kind with every underscore changed
  to a hyphen. There is no `OPERATOR_ACTION` catalog row.

The complete step-4 result policy is:

1. Parse the entire supplied input with `parseModulePlanInput` and retain that
   detached public value. Every structural or relational parser refusal,
   including incomplete snapshot/policy, unsupported compatibility, invalid
   module intent, unconfigured capability, or a subject authored in the current
   cycle, is a caller failure. Do not fabricate an input digest or module result
   from rejected input.
2. Require canonical-byte-equal identity between the parsed input descriptor
   and the exported descriptor. A parse-valid alternate descriptor, null review
   subject, or `release-candidate-subject/v1` returns exactly the bound
   `module-no-action/v1` with the retained input digest,
   `outcome: REFUSED`, and `reason: INPUT_REFUSED`.
3. Otherwise the exact `worker-result-subject/v1` is the sole action target.
   Return one `module-action-plan/v1` with `workId: null` and the retained
   input digest. Its core has schema `dispatch-action-core/v1`, the declared
   action/capability/role, the exported descriptor digest, and
   `immutableSubjectDigest = computeWorkerResultSubjectDigest(reviewSubject)`.
   Never substitute a frontier row, author attempt, artifact content digest,
   terminal receipt digest, or frontier digest for that complete subject.
4. The brief has schema `dispatch-brief/v1` and role `review`. Its action
   record binds the exact core digest, pair, subject, and descriptor under
   `dispatch-brief-action/v1`. Its nine directives use the existing complete
   order and `dispatch-brief-directive/v1`; the eight catalog kinds are
   `PRESENT` with their exact codes, while `OPERATOR_ACTION` is `ABSENT`
   with `code: null`. Every directive, including the absent one, binds the
   same subject digest. The footprint is exactly one
   `dispatch-brief-resource/v1` with `access: READ` and that same
   `resourceIdentityDigest`. Validate the result against the retained input.

Both `TRIP` and `NO_TRIP` on `work.read` preserve this action decision,
matching the existing review fixture. The complete policy observation is bound
into the input digest but never interpreted as execution permission here.
Unlike frontier planning, review planning neither selects a frontier row nor
requires its readiness; a parse-valid empty or changed frontier cannot replace
the supplied target. The engine's later current-policy/breaker, installed
registry, preflight, distinct-author, and exact-target gates remain mandatory.
The module never emits a success, acceptance, review authority, disposition,
follow-up, or cycle receipt. This tranche has no `NO_ACTION` decision cell:
the ABI output schema census remains fixed even though this policy emits only
an action or `REFUSED/INPUT_REFUSED`. An unexpected throw or malformed return
is a caller failure, not silently converted to another result.

The source packet must consume the existing walking-skeleton preparation seam:
actual branch and queue configuration loaders and SDK snapshot/current-policy
readers through `loadFixtureConfiguration`, `observeFixtureSnapshot`,
`observeFixturePolicy`, and `composeFixtureModuleInput`, using the new
descriptor and a concrete prior worker-result subject. Retain the exact parsed
input across `await plan(input)` and apply `validateModulePlanBinding`
afterward. Keep the two real adapter policy projections, including contrasting
TRIP/NO_TRIP observations, and assert the same action/role/catalog shape with
each output bound to its own complete input and target digests. Seeded prior
subjects are explicit fixture input, never proof that an author cycle executed.

The focused vectors must pin complete descriptor and output bytes/digests;
valid descriptor/null/candidate refusals; parser refusals without bound output;
same-cycle denial; both policy arms; empty, reordered, and changed frontier
noninterference; repeated-input byte equality; exact worker-result substitution;
and every result core/brief/directive/footprint binding. A changed subject with
unchanged result must fail binding; a valid changed subject replanned must bind
the new complete digest. Required descriptor/capability/policy checks cannot be
omitted to manufacture an otherwise invalid test input. Consumer terminology
stays outside public output. Tests exercise the new module through preparation,
not only hand-built module inputs or tests of the old fixture module.

Source admission reuses the Round 438/439 boundary: normalize the exact tracked
review entrypoint and require its independently reviewed SHA-256 immediately
before every new review `plan` invocation. Independent exact-head review
recomputes that identity and inspects those exact production bytes for the sole
public-contract static dependency and absence of ambient/effect access.
Seeded static/dynamic import, `require`, clock, random, process, network,
`navigator`, `WebSocket`, and an intentionally unlisted-byte mutation prove
only identity change; there is no source classifier, scanner, sandbox, VM, or
complete global-name inventory. The pin cannot confer semantic, installation,
execution, release, or authority status. Final reviewed manifest admission
eventually replaces it.

The source footprint is exactly this review entrypoint, focused additions to
`fixtures/walking-skeleton/test/consumer.test.ts`, and one pressure record.
No public contracts, fixture runtime, planning source/pin, manifest, generator,
generated stub, root configuration, dependency, or authority surface changes.
Local verification is typecheck, planning, reconciled board, targeted formatting,
and diff checks; execution evidence is the hosted focused/full suite on Linux,
macOS, and Windows. The definition and following source each require independent
exact-head review. Release-candidate planning, disposition, delivery, repair,
ISS-039 advisory findings, module activation, and ISS-011 closure remain later
work.

### Following consumer: neutral worker-result review disposition

Round 446 defines the smallest full-routine extension already exercised by the
walking-skeleton review consumer. It carries forward Rounds 401 and 434 through
444, including both abandoned planning-source rounds and their review/hosted
evidence. The independently reviewed Round 444 source identity applies only to
that exact plan-only entrypoint. Adding this phase changes the source and the
descriptor, so no old source hash, descriptor digest, action-core digest,
brief digest, plan digest, or golden authorizes the following source.

The review descriptor otherwise remains declaratively equal to the Round 443
descriptor, but its ordered `dispositionCodes` becomes exactly
`["review.complete","review.reject","review.unknown"]`. The entrypoint then
exports exactly `descriptor`, `disposition`, and `plan`. The step-4 selection
policy, action, compatibility, catalog, schemas, role, target and result shapes
do not change. Their canonical bytes and every descriptor-derived identity do
change and must be recomputed from independently authored literals.

`disposition` is the existing optional pure ABI phase. It first calls
`parseDispositionInput` and retains that detached closed value. Parser refusal
throws and returns no `action-disposition/v1`. It then requires canonical-byte
equality between `moduleInput.descriptor` and the newly exported descriptor and
requires `moduleInput.reviewSubject` to be `worker-result-subject/v1`; either
mismatch throws without a disposition. These are the handler's owned admission
checks. Parsing alone does not prove that route, preflight, worker, review or
captured-stream evidence is authentic or mutually bound.

For the admitted subject, the output always binds
`actionPlanDigest = computeModuleActionPlanDigest(actionPlan)`,
`inputDigest = computeDispositionInputDigest(input)`, and the complete
`computeWorkerResultSubjectDigest(reviewSubject)` with subject kind
`WORKER_RESULT`. The exact review-authority matrix is:

| Supplied review authority | Code              | Outcome                                                                                |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `accepted`                | `review.complete` | `{kind:"COMPLETE"}`                                                                    |
| `rejected`                | `review.reject`   | `FOLLOW_UP` with `REPLAN`, module `review`, and the same complete worker-result target |
| absent or `unknown`       | `review.unknown`  | `{kind:"UNKNOWN",reason:"AUTHORITY_UNPROVEN"}`                                         |

The handler parses the constructed disposition before returning it. The caller
retains the exact disposition input and separately captured stdout/stderr bytes
across the await, then calls `validateActionDispositionBinding` with those four
preimages. That existing binder, not the module parser, validates all action,
route, preflight, dispatch, launch, terminal, review request/attempt/authority,
skip, code and outcome relations. A structurally valid input can therefore
produce a structural disposition which the caller still refuses. No raw byte,
filesystem, provider, history or authenticity claim is added to the ABI input.

The following source tests must exercise a production-descriptor tuple rather
than relabel the existing `fixture.review-consumer`/`fixture.review` tuple.
`fixtures/walking-skeleton/test/consumer.test.ts` supplies the actual branch and
queue loader, snapshot, policy and composition seam and obtains the production
review plan. Test-local composition in
`fixtures/walking-skeleton/test/review-consumer.test.ts` must reuse the current
review evidence builders and public binders to carry that exact production
module input/action through coherent route, preflight, worker and review
records, retaining actual captured stream bytes for the post-await disposition
binder. The fixture runtime remains unchanged. If that coherent seam cannot be
made in those two test files, source stops for a fresh footprint replan rather
than hand-building an unrelated authority tuple.

The complete vectors cover all three authority cells, absent review, malformed
input, alternate descriptor, candidate/null/changed worker-result subject,
action/route/preflight/worker/request/attempt/authority/stream substitutions,
declared-code changes, repeated canonical equality and complete target changes.
Deleting any authority arm, complete-target join, code declaration, parser
refusal, descriptor/subject comparison or external raw-byte binding must make
its matching vector fail. Accepted `COMPLETE` remains only the module's
nonmutating disposition; final completion still requires journal, mutation-skip
and reclaim evidence. Rejected `REPLAN` allocates no cycle and unknown authority
permits no follow-up or effect.

The predicted source footprint is exactly
`modules/review/src/index.ts`,
`fixtures/walking-skeleton/test/consumer.test.ts`,
`fixtures/walking-skeleton/test/review-consumer.test.ts`, and one source pressure
record. It must rebaseline the normalized review-source identity and every
descriptor/core/brief/plan golden affected by the code census. The planning
source and pin, fixture runtime, public contracts, empty manifest, generator,
generated stub, root configuration and dependencies remain unchanged.
Delivery, repair, release-candidate disposition, worker launch, routing,
mutation, journal/reclaim ownership, registry activation and ISS-011 closure
remain outside this tranche.

`ISS-011` owns the only registry generator at
`modules/build/generate-registry.mjs`. It parses the closed manifest and exact
descriptors, verifies every recorded digest, and emits
`modules/.generated/registry.ts` containing literal static imports in manifest
order plus a frozen descriptor/digest table. The generated directory is ignored
source-build output and is never edited or accepted as input. The root private-
composition build calls this generator before the self-host esbuild target and
rejects a dirty, missing, stale, extra, or nondeterministic output; no esbuild
plugin resolves modules.

The installed self-host composition build generates a frozen in-memory registry
from that exact manifest and statically imports its listed entrypoints. The
bootstrap build verifies and installs the same release-manifest/module digests
but never invokes modules. The installed runtime compares its embedded registry/
entrypoint/descriptor digests with the installed release manifest before a
session begins. There is no filesystem
scan, package lookup, configuration-supplied path, `import()` of a data value,
last-registration-wins behavior, or candidate-module execution. A new module is
usable only after it is present in a reviewed release, compiled into that
release's composition bundle, promoted, installed, and verified.

At routine step 4, `@orchestration-platform/engine` selects only a registry ID
already authorized by the adapter's canonical policy facts, validates input
against the descriptor, invokes `plan` once under the bound cycle identity, and
validates the result before journaling it. Missing, moved, duplicate, unlisted,
dynamically supplied, digest-mismatched, incompatible, extra-capability, or
effectful modules refuse before invocation.

## Self-host baseline and successor fixture

The N0 self-host bundle statically contains exactly the four baseline modules.
The bounded N1 change adds `modules/health-summary/src/index.ts` and one manifest
row, then runs the same generator so the candidate N1 bundle contains the fifth
literal import without an adapter/composition source edit. N0 may build and test
those candidate bytes but cannot load the new module.
Only the promoted and installed N1 composition may admit it. Five-cycle evidence
includes negative controls for missing/moved/unlisted/dynamic modules, changed
descriptor or emitted bytes, candidate loading under N0, and a registry/release-
manifest mismatch.

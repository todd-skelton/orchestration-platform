# Portable module execution ABI

## Closed runtime contract

Portable modules implement `orchestration-module/v1`. Each source entrypoint
exports exactly `descriptor` and `plan`:

```ts
interface OrchestrationModuleV1 {
  readonly descriptor: ModuleDescriptorV1;
  plan(input: Readonly<ModulePlanInputV1>): Promise<ModulePlanResultV1>;
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

## Static admission and loading

`ISS-011` owns `modules/manifest.json` and these baseline entrypoints:

| Module ID | Source entrypoint |
| --- | --- |
| `planning` | `modules/planning/src/index.ts` |
| `delivery` | `modules/delivery/src/index.ts` |
| `review` | `modules/review/src/index.ts` |
| `repair` | `modules/repair/src/index.ts` |

The manifest is an ordered closed list. For each row it records the source-tree
digest, emitted-module digest, descriptor digest, ABI/schema IDs, and
compatibility/capability declarations. Release assembly recomputes those values
and binds the whole manifest digest into `release-manifest/v1`.

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

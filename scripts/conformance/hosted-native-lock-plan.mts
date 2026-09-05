import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  createConformanceBundleManifest,
  parseConformanceRequiredJobRegistry,
  sha256Bytes,
} from "../../packages/conformance/src/index.js";
import { nativeLockBuildRequiredInputs } from "../build/native-lock-experiment.mjs";

export const hostedNativeLockAction = "iss022_native_lock_experiment" as const;
export const hostedNativeLockRunnerToken = "ISS022_NATIVE_LOCK_EXPERIMENT" as const;
export const hostedNativeLockSuiteId = "iss022-native-lock-experiment" as const;

export const hostedNativeLockCaseIds = Object.freeze([
  "NATIVE_UNRELATED_EXCLUSION",
  "NATIVE_NORMAL_RELEASE",
  "NATIVE_DEFAULT_NON_INHERITANCE",
  "NATIVE_HOLDER_DEATH_ONCE",
] as const);

export const hostedNativeLockControlIds = Object.freeze([
  "BYPASS_LOCK",
  "PREMATURE_UNLOCK",
  "RETAIN_AFTER_RELEASE",
  "INHERITABLE_FLAGS",
  "INHERITED_IDENTITY",
  "WRONG_CUSTODY",
  "WRONG_RANGE_OR_FLAGS",
  "BUILD_OR_LOADER_SUBSTITUTION",
  "MALFORMED_OR_FORGED_FACTS",
  "FALSE_DEATH_OR_RETRY",
  "MISSING_OR_MIXED_CENSUS",
  "CAPABILITY_CONFUSION",
] as const);

const harnessPaths = Object.freeze([
  "packages/conformance/src/contracts.ts",
  "packages/conformance/src/github-actions.ts",
  "packages/conformance/src/github-actions/index.ts",
  "packages/conformance/src/index.ts",
  "packages/conformance/src/manifest.ts",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/runtime.ts",
  "probes/portable-primitives/experiment/capture.mjs",
  "probes/portable-primitives/experiment/case-context.mjs",
  "probes/portable-primitives/experiment/cases.mjs",
  "probes/portable-primitives/experiment/facts.mjs",
  "probes/portable-primitives/experiment/fixture.mjs",
  "probes/portable-primitives/experiment/io.mjs",
  "probes/portable-primitives/experiment/reduction.mjs",
  "probes/portable-primitives/experiment/session.mjs",
  "probes/portable-primitives/native/native-lock-candidate.c",
  "probes/portable-primitives/native/native-lock-witness.c",
  "scripts/build/native-lock-distribution.mjs",
  "scripts/build/native-lock-experiment.mjs",
  "scripts/build/native-lock-headers.mjs",
  "scripts/build/native-lock-inputs.mjs",
  "scripts/conformance/hosted-native-lock-acquisition.mts",
  "scripts/conformance/hosted-native-lock-plan.mts",
  "scripts/conformance/hosted-plan.mts",
] as const);

const testPaths = Object.freeze([
  "test/conformance/contracts.test.ts",
  "test/conformance/hosted-native-lock-acquisition.test.ts",
  "test/conformance/hosted-plan.test.ts",
  "test/native-lock-experiment/build.test.ts",
  "test/native-lock-experiment/candidate.test.mjs",
  "test/native-lock-experiment/cases.test.mjs",
  "test/native-lock-experiment/distribution.test.ts",
  "test/native-lock-experiment/fixture-foundation.test.mjs",
  "test/native-lock-experiment/headers.test.ts",
  "test/native-lock-experiment/inputs.test.ts",
  "test/native-lock-experiment/reduction.test.mjs",
  "test/native-lock-experiment/witness.test.mjs",
] as const);

const runnerByFamily = Object.freeze({
  LINUX: "ubuntu-latest",
  MACOS: "macos-latest",
  WINDOWS: "windows-latest",
} as const);

function privateDigest(domain: string, value: unknown): string {
  return sha256Bytes(
    new TextEncoder().encode(canonicalJson(Object.freeze({ domain, value } as const))),
  );
}

export function createHostedNativeLockRegistry(vectorCensusDigest: string): ContractRecord {
  const registry = Object.freeze({
    jobs: Object.freeze(
      (["LINUX", "MACOS", "WINDOWS"] as const).map((environmentFamily) =>
        Object.freeze({
          environmentFamily,
          jobId: `${hostedNativeLockSuiteId}-${environmentFamily.toLowerCase()}`,
          requirement: "REQUIRED",
          suiteId: hostedNativeLockSuiteId,
        }),
      ),
    ),
    schemaVersion: "conformance-required-job-registry/v1",
    suites: Object.freeze([
      Object.freeze({
        custodyRequirement: "REQUIRED",
        helperRequirement: "REQUIRED",
        ownerPackage: "@orchestration-platform/portable-primitives",
        runnerToken: hostedNativeLockRunnerToken,
        suiteId: hostedNativeLockSuiteId,
        vectorCensusDigest,
        walkRequirement: "NONE",
      }),
    ]),
  });
  const parsed = parseConformanceRequiredJobRegistry(registry);
  if (!parsed.ok) throw new TypeError("native-lock-plan:registry-refused");
  return parsed.value;
}

export function createHostedNativeLockMatrix(
  registryInput: unknown,
): Readonly<{ include: readonly ContractRecord[] }> {
  const parsed = parseConformanceRequiredJobRegistry(registryInput);
  if (!parsed.ok) throw new TypeError("native-lock-plan:registry-refused");
  const expectedDigest = (parsed.value.suites as readonly ContractRecord[])[0]?.vectorCensusDigest;
  if (typeof expectedDigest !== "string") throw new TypeError("native-lock-plan:census-refused");
  const expected = createHostedNativeLockRegistry(expectedDigest);
  if (canonicalJson(parsed.value) !== canonicalJson(expected))
    throw new TypeError("native-lock-plan:registry-substitution-refused");
  return Object.freeze({
    include: Object.freeze(
      (parsed.value.jobs as readonly ContractRecord[]).map((job) =>
        Object.freeze({
          jobId: String(job.jobId),
          runner: runnerByFamily[job.environmentFamily as keyof typeof runnerByFamily],
          runnerToken: hostedNativeLockRunnerToken,
          suiteId: hostedNativeLockSuiteId,
        }),
      ),
    ),
  });
}

export async function loadHostedNativeLockPlanInputs(stableRoot: string) {
  const [harness, tests] = await Promise.all([
    createConformanceBundleManifest(stableRoot, harnessPaths, "HARNESS"),
    createConformanceBundleManifest(stableRoot, testPaths, "TEST_BUNDLE"),
  ]);
  if (!harness.ok || !tests.ok) throw new TypeError("native-lock-plan:bundle-refused");
  const caseCensusDigest = privateDigest(
    "iss022-native-lock-case-census/v1",
    hostedNativeLockCaseIds,
  );
  const controlCensusDigest = privateDigest(
    "iss022-native-lock-control-census/v1",
    hostedNativeLockControlIds,
  );
  const prerequisiteCensusDigest = privateDigest(
    "iss022-native-lock-prerequisite-census/v1",
    Object.freeze({
      action: hostedNativeLockAction,
      harnessPaths,
      nativeLockBuildRequiredInputs,
      runnerToken: hostedNativeLockRunnerToken,
      testPaths,
    }),
  );
  const vectorCensusDigest = privateDigest(
    "iss022-native-lock-vector-census/v1",
    Object.freeze({ caseCensusDigest, controlCensusDigest, prerequisiteCensusDigest }),
  );
  const registry = createHostedNativeLockRegistry(vectorCensusDigest);
  return Object.freeze({
    caseCensusDigest,
    controlCensusDigest,
    harnessBundleDigest: computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      harness.value,
    ),
    matrix: createHostedNativeLockMatrix(registry),
    prerequisiteCensusDigest,
    registry,
    requiredJobRegistryDigest: computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      registry,
    ),
    testBundleDigest: computeConformanceRecordDigest("conformance-bundle-manifest/v1", tests.value),
    vectorCensusDigest,
  });
}

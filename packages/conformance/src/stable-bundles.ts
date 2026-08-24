import type { ContractRecord } from "@orchestration-platform/contracts";
import {
  createConformanceBundleManifest,
  type ConformanceBundleManifestResult,
} from "./manifest.js";
import { iss002HarnessPaths, iss002TestBundlePaths } from "./iss002-bundle-paths.mjs";

export { iss002HarnessPaths, iss002TestBundlePaths };

export type Iss002StableBundleManifestsResult =
  | {
      readonly ok: true;
      readonly harnessManifest: ContractRecord;
      readonly testBundleManifest: ContractRecord;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function prefixed(prefix: string, result: ConformanceBundleManifestResult): readonly string[] {
  return result.ok ? [] : result.issues.map((issue) => `${prefix}.${issue}`);
}

export async function createIss002StableBundleManifests(
  stableRoot: string,
): Promise<Iss002StableBundleManifestsResult> {
  const harness = await createConformanceBundleManifest(stableRoot, iss002HarnessPaths, "HARNESS");
  if (!harness.ok) return { ok: false, issues: Object.freeze([...prefixed("harness", harness)]) };
  const testBundle = await createConformanceBundleManifest(
    stableRoot,
    iss002TestBundlePaths,
    "TEST_BUNDLE",
  );
  if (!testBundle.ok)
    return { ok: false, issues: Object.freeze([...prefixed("testBundle", testBundle)]) };
  return {
    ok: true,
    harnessManifest: harness.value,
    testBundleManifest: testBundle.value,
  };
}

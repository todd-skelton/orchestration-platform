import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import * as conformance from "../../packages/conformance/src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function stableSnapshot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-stable-bundles-"));
  temporaryRoots.push(root);
  for (const path of [...conformance.iss002HarnessPaths, ...conformance.iss002TestBundlePaths]) {
    const destination = resolve(root, ...path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(repositoryRoot, ...path.split("/")), destination);
  }
  return root;
}

async function filesBelow(relativeRoot: string): Promise<readonly string[]> {
  const entries = await readdir(resolve(repositoryRoot, relativeRoot), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(repositoryRoot, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

describe("stable ISS-002 bundle path censuses", () => {
  test("partitions every conformance source byte into harness or test ownership", async () => {
    const conformanceSources = await filesBelow("packages/conformance/src");
    const harnessSources = conformance.iss002HarnessPaths.filter((path) =>
      path.startsWith("packages/conformance/src/"),
    );
    const testSources = conformance.iss002TestBundlePaths.filter((path) =>
      path.startsWith("packages/conformance/src/"),
    );
    expect(harnessSources).toEqual([
      "packages/conformance/src/candidate-materialization.ts",
      "packages/conformance/src/contracts.ts",
      "packages/conformance/src/github-actions.ts",
      "packages/conformance/src/github-actions/index.ts",
      "packages/conformance/src/github-artifacts.ts",
      "packages/conformance/src/github-protection.ts",
      "packages/conformance/src/github-terminal.ts",
      "packages/conformance/src/index.ts",
      "packages/conformance/src/iss002-bundle-paths.mts",
      "packages/conformance/src/iss002-handler.ts",
      "packages/conformance/src/iss002-native-candidate-walk.ts",
      "packages/conformance/src/iss022-handler.ts",
      "packages/conformance/src/iss022-profile.ts",
      "packages/conformance/src/manifest.ts",
      "packages/conformance/src/observation.ts",
      "packages/conformance/src/reducer.ts",
      "packages/conformance/src/stable-bundles.ts",
      "packages/conformance/src/stable.ts",
      "packages/conformance/src/walk.ts",
    ]);
    expect(testSources).toEqual([
      "packages/conformance/src/iss002-vector-generator.mjs",
      "packages/conformance/src/iss002-walk-child.mjs",
    ]);
    const owned = [...harnessSources, ...testSources].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    expect(owned).toEqual(conformanceSources);
    expect(new Set(owned).size).toBe(owned.length);
  });

  test("owns the complete contracts implementation and exact stable test suite", async () => {
    const contractSources = await filesBelow("packages/contracts/src");
    expect(
      conformance.iss002HarnessPaths.filter((path) => path.startsWith("packages/contracts/src/")),
    ).toEqual(contractSources);
    const stableTests = (await filesBelow("test/contracts")).filter((path) =>
      path.endsWith(".test.ts"),
    );
    expect(
      conformance.iss002TestBundlePaths.filter((path) => path.startsWith("test/contracts/")),
    ).toEqual(stableTests);
    expect(conformance.iss002TestBundlePaths).not.toContain("test/contracts/run-tests.mjs");
    expect(
      conformance.iss002TestBundlePaths.filter((path) => path.startsWith("test/conformance/")),
    ).toEqual([
      "test/conformance/iss002-native-candidate-walk.test.ts",
      "test/conformance/iss022-handler.test.ts",
      "test/conformance/iss022-profile.test.ts",
    ]);
    const portableSources = await filesBelow("probes/portable-primitives/src");
    expect(
      conformance.iss002HarnessPaths.filter((path) =>
        path.startsWith("probes/portable-primitives/src/"),
      ),
    ).toEqual(portableSources);
    const portableTests = await filesBelow("test/portable-primitives");
    expect(
      conformance.iss002TestBundlePaths.filter((path) =>
        path.startsWith("test/portable-primitives/"),
      ),
    ).toEqual(portableTests);
  });

  test("keeps parked isolation paths and compiled executables absent", async () => {
    const tracked = (await execFileAsync("git", ["ls-files"], { cwd: repositoryRoot })).stdout
      .trim()
      .split(/\r?\n/);
    for (const path of [
      "packages/conformance/src/windows-isolation-broker.c",
      "packages/conformance/src/windows-isolation-broker-x64.exe",
      "packages/conformance/src/macos-principal-helper.c",
      "packages/conformance/src/linux-account-custody.ts",
      "packages/conformance/src/linux-dac-custody.ts",
      "packages/conformance/src/linux-execution-custody.ts",
      "packages/conformance/src/linux-process-custody.ts",
      "packages/conformance/src/native-isolated-walk.ts",
      "packages/conformance/src/windows-isolation-authority.ts",
      "packages/conformance/src/linux-isolation-authority.ts",
    ])
      expect(tracked).not.toContain(path);
    expect(tracked.filter((path) => /\.(?:exe|dll|dylib|so)$/i.test(path))).toEqual([]);
  });

  test("pins the package and frozen toolchain inputs without unrelated root files", () => {
    expect(conformance.iss002HarnessPaths.filter((path) => !path.includes("/"))).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
    expect(conformance.iss002HarnessPaths.filter((path) => path.endsWith("/package.json"))).toEqual(
      [
        "packages/conformance/package.json",
        "packages/contracts/package.json",
        "probes/portable-primitives/package.json",
      ],
    );
    expect(
      conformance.iss002HarnessPaths.filter((path) => path.endsWith("/tsconfig.json")),
    ).toEqual([
      "packages/conformance/tsconfig.json",
      "packages/contracts/tsconfig.json",
      "probes/portable-primitives/tsconfig.json",
    ]);
    expect(conformance.iss002HarnessPaths.filter((path) => path.startsWith("scripts/"))).toEqual([
      "scripts/conformance/hosted-aggregate.mts",
      "scripts/conformance/hosted-candidate.mts",
      "scripts/conformance/hosted-observation.mts",
      "scripts/conformance/hosted-plan.mts",
      "scripts/conformance/hosted-record-api.mts",
      "scripts/conformance/hosted-record.mts",
      "scripts/conformance/hosted-terminal.mts",
      "scripts/conformance/hosted.mts",
      "scripts/conformance/iss002-executor.mts",
      "scripts/conformance/iss002-workspace.mts",
      "scripts/conformance/run-bundled.mts",
      "scripts/harness-test.mts",
    ]);
  });

  test("pins every stable bundle checkout byte to LF on every OS", async () => {
    const paths = [...conformance.iss002HarnessPaths, ...conformance.iss002TestBundlePaths];
    const { stdout } = await execFileAsync("git", ["check-attr", "eol", "--", ...paths], {
      cwd: repositoryRoot,
    });
    expect(stdout.trim().split(/\r?\n/)).toEqual(paths.map((path) => `${path}: eol: lf`));
  });

  test("constructs both manifests only from the stable root", async () => {
    const result = await conformance.createIss002StableBundleManifests(await stableSnapshot());
    if (!result.ok) throw new Error(result.issues.join("\n"));
    expect(result.harnessManifest.purpose).toBe("HARNESS");
    expect(result.testBundleManifest.purpose).toBe("TEST_BUNDLE");
    expect(
      (result.harnessManifest.files as readonly Readonly<Record<string, unknown>>[]).map(
        (row) => row.path,
      ),
    ).toEqual(conformance.iss002HarnessPaths);
    expect(
      (result.testBundleManifest.files as readonly Readonly<Record<string, unknown>>[]).map(
        (row) => row.path,
      ),
    ).toEqual(conformance.iss002TestBundlePaths);
  }, 600_000);
});

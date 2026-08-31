import { beforeAll, describe, expect, test } from "vitest";
import {
  loadBootstrapSnapshot,
  validateBootstrapSnapshot,
} from "../scripts/verify/bootstrap-contracts.mjs";
import { resolvePnpmLauncher } from "../scripts/pnpm-launcher.mjs";
import { normalizeTrackedText } from "../scripts/tracked-text.mjs";

let baseline: Awaited<ReturnType<typeof loadBootstrapSnapshot>>;

function mutant(): any {
  return structuredClone(baseline);
}

function asCrLf(value: string) {
  return normalizeTrackedText(value).replace(/\n/g, "\r\n");
}

beforeAll(async () => {
  baseline = await loadBootstrapSnapshot();
}, 300_000);

describe("bootstrap manifest graph", () => {
  test("accepts CRLF tracked text contracts without changing their semantics", async () => {
    const snapshot = mutant();
    snapshot.workspace = asCrLf(snapshot.workspace);
    snapshot.moduleManifestSource = asCrLf(snapshot.moduleManifestSource);
    snapshot.workflow = asCrLf(snapshot.workflow);
    await expect(validateBootstrapSnapshot(snapshot)).resolves.toBeUndefined();
  });

  test.each([
    [
      "mixed line endings",
      (snapshot: any) => {
        snapshot.workspace = normalizeTrackedText(snapshot.workspace).replace("\n", "\r\n");
      },
    ],
    [
      "lone carriage return",
      (snapshot: any) => {
        snapshot.moduleManifestSource = "[]\r";
      },
    ],
    [
      "semantic text change",
      (snapshot: any) => {
        snapshot.workflow = snapshot.workflow.replace("name: bootstrap", "name: changed");
      },
    ],
  ])("rejects %s tracked text", async (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    await expect(validateBootstrapSnapshot(snapshot)).rejects.toThrow(
      /BOOTSTRAP_CONTRACT_MISMATCH/,
    );
  });

  test("uses native Windows pnpm executables without a Node prefix", async () => {
    await expect(resolvePnpmLauncher("C:\\pnpm\\pnpm.exe")).resolves.toEqual({
      executable: "C:\\pnpm\\pnpm.exe",
      prefixArgs: [],
    });
  });

  test("uses JavaScript pnpm entrypoints through Node", async () => {
    await expect(resolvePnpmLauncher("/opt/pnpm/dist/pnpm.mjs")).resolves.toEqual({
      executable: process.execPath,
      prefixArgs: ["/opt/pnpm/dist/pnpm.mjs"],
    });
  });

  test("matches the authoritative package, build, and handler censuses", async () => {
    await expect(validateBootstrapSnapshot(baseline)).resolves.toBeUndefined();
  });

  test.each([
    ["extra package path", (snapshot: any) => snapshot.packageDirectories.push("packages/extra")],
    [
      "missing export",
      (snapshot: any) =>
        delete snapshot.manifests["@orchestration-platform/adapter-self"].exports["./workspace"],
    ],
    [
      "extra export",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/credentials"].exports["./build"] =
          "./build/compose.ts";
      },
    ],
    [
      "credential private build files allowlist",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/credentials"].files = ["src", "build"];
      },
    ],
    [
      "package-local build",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/credentials"].scripts.build =
          "esbuild build/compose.ts";
      },
    ],
    [
      "missing conformance esbuild pin",
      (snapshot: any) => {
        delete snapshot.manifests["@orchestration-platform/conformance"].dependencies.esbuild;
      },
    ],
    [
      "changed contracts compatibility entrypoint",
      (snapshot: any) => {
        snapshot.rootPackage.scripts["contracts:compatibility-check"] =
          "node scripts/capability-not-implemented.mjs ISS-002 contracts:compatibility-check";
      },
    ],
    [
      "changed contracts package test entrypoint",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/contracts"].scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-002 @orchestration-platform/contracts:test";
      },
    ],
    [
      "changed CLI package test entrypoint",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/cli"].scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-003 @orchestration-platform/cli:test";
      },
    ],
    [
      "changed config package test entrypoint",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/config"].scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-003 @orchestration-platform/config:test";
      },
    ],
    [
      "changed root harness entrypoint",
      (snapshot: any) => {
        snapshot.rootPackage.scripts["harness:test"] =
          "node scripts/capability-not-implemented.mjs ISS-006 harness:test";
      },
    ],
    [
      "changed ISS-022 probe entrypoint",
      (snapshot: any) => {
        snapshot.rootPackage.scripts["probe:portable-primitives"] =
          "node scripts/capability-not-implemented.mjs ISS-022 probe:portable-primitives";
      },
    ],
    [
      "changed ISS-022 receipt verification entrypoint",
      (snapshot: any) => {
        snapshot.rootPackage.scripts["probe:portable-primitives:verify-receipts"] =
          "node scripts/capability-not-implemented.mjs ISS-022 probe:portable-primitives:verify-receipts";
      },
    ],
    [
      "changed workflow mutation entrypoint",
      (snapshot: any) => {
        snapshot.rootPackage.scripts["test:harness-workflow-mutations"] =
          "node scripts/capability-not-implemented.mjs ISS-006 test:harness-workflow-mutations";
      },
    ],
    [
      "changed conformance harness entrypoint",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/conformance"].scripts.test =
          "node ../../scripts/capability-not-implemented.mjs ISS-006 @orchestration-platform/conformance:test";
      },
    ],
    [
      "changed conformance esbuild pin",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/conformance"].dependencies.esbuild = "0.28.3";
      },
    ],
    [
      "runtime alias",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/credentials"].imports = {
          "#broker-compose": "./build/compose.ts",
        };
      },
    ],
    [
      "sixth build target",
      (snapshot: any) => {
        snapshot.buildConfiguration.targets.push({
          id: "extra",
          entryPoint: "extra.ts",
          output: "extra.mjs",
        });
      },
    ],
    [
      "build option override",
      (snapshot: any) => {
        snapshot.buildConfiguration.options.sourcemap = true;
      },
    ],
    [
      "alternate esbuild plugin",
      (snapshot: any) => {
        snapshot.buildScriptSource = snapshot.buildScriptSource.replace(
          "plugins: [brokerComposeResolver(target.id)]",
          "plugins: [brokerComposeResolver(target.id), alternatePlugin]",
        );
      },
    ],
    [
      "broker alias allowlist widening",
      (snapshot: any) => {
        snapshot.buildScriptSource = snapshot.buildScriptSource.replace(
          'const aliasTargets = new Set(["bootstrap", "self-host", "host-custody-bootstrap"]);',
          'const aliasTargets = new Set(["bootstrap", "self-host", "host-custody-bootstrap", "credential-broker"]);',
        );
      },
    ],
    [
      "moved broker composition destination",
      (snapshot: any) => {
        snapshot.buildScriptSource = snapshot.buildScriptSource.replace(
          "packages/credentials/build/compose.ts",
          "packages/credentials/build/moved-compose.ts",
        );
      },
    ],
    ["non-empty module row", (snapshot: any) => snapshot.moduleManifest.push({ id: "planning" })],
    [
      "missing OS smoke lane",
      (snapshot: any) => {
        snapshot.workflow = snapshot.workflow.replace(", macos-latest", "");
      },
    ],
    ["missing CLI handler", (snapshot: any) => snapshot.cliRegistry.pop()],
    [
      "dynamic CLI registry discovery",
      (snapshot: any) => {
        snapshot.cliRegistrySource += '\nvoid import("./dynamic-handler.mjs");\n';
      },
    ],
    [
      "extra unregistered handler file",
      (snapshot: any) => {
        snapshot.handlerFiles.push("packages/state/src/command-handler.mjs");
        snapshot.handlerFiles.sort();
      },
    ],
    [
      "missing registered handler file",
      (snapshot: any) => {
        snapshot.handlerFiles = snapshot.handlerFiles.filter(
          (file: string) => file !== "packages/config/src/command-handler.mjs",
        );
      },
    ],
    [
      "duplicate CLI family",
      (snapshot: any) => {
        snapshot.cliRegistry[1] = structuredClone(snapshot.cliRegistry[0]);
      },
    ],
    [
      "moved CLI owner",
      (snapshot: any) => {
        snapshot.cliRegistry[0].owner = "@orchestration-platform/engine";
      },
    ],
    [
      "invalid handler implementation",
      (snapshot: any) => {
        snapshot.cliRegistry[0].implementation = "in-progress";
      },
    ],
    [
      "changed CLI flag",
      (snapshot: any) => {
        snapshot.cliRegistry[1].commands[0].required[0] = "--input";
      },
    ],
    [
      "missing abort command",
      (snapshot: any) => {
        snapshot.bootstrapRegistry[0].commands.splice(9, 1);
      },
    ],
    [
      "default-adding bootstrap flag",
      (snapshot: any) => {
        snapshot.bootstrapRegistry[0].commands[9].optional.push({
          name: "--state-root",
          takesValue: true,
        });
      },
    ],
    [
      "extra host-custody command",
      (snapshot: any) => {
        snapshot.hostRegistry[0].commands.push({ argv: ["clean"], required: [], optional: [] });
      },
    ],
    [
      "private build tarball path",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.packFiles.push("build/compose.ts");
        snapshot.credentialPackageInventory.packFiles.sort();
      },
    ],
    [
      "installed source map",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.installedFiles.push("src/index.js.map");
        snapshot.credentialPackageInventory.installedFiles.sort();
      },
    ],
    [
      "installed private bytes",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.forbiddenByteMatches.push("src/index.ts");
      },
    ],
    [
      "tarball private bytes",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.tarballForbiddenByteMatches.push("src/index.ts");
      },
    ],
    [
      "installed private export",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.installedManifest.exports["./build"] =
          "./build/compose.ts";
      },
    ],
    [
      "successful deep runtime import",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.deepImports[0].status = 0;
        snapshot.credentialPackageInventory.deepImports[0].stderr = "";
      },
    ],
    [
      "changed repeated tarball bytes",
      (snapshot: any) => {
        snapshot.credentialPackageInventory.repeatedTarballDigest = "0".repeat(64);
      },
    ],
  ])("rejects the %s mutant", async (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    await expect(validateBootstrapSnapshot(snapshot)).rejects.toThrow(
      /BOOTSTRAP_CONTRACT_MISMATCH/,
    );
  });

  test.each([
    ["CLI", "cliRegistry"],
    ["bootstrap", "bootstrapRegistry"],
    ["host-custody", "hostRegistry"],
  ])("accepts implemented %s handler registrations", async (_label, registryName) => {
    const snapshot = mutant();
    snapshot[registryName][0].implementation = "implemented";
    await expect(validateBootstrapSnapshot(snapshot)).resolves.toBeUndefined();
  });
});

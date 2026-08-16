import { beforeAll, describe, expect, test } from "vitest";
import {
  loadBootstrapSnapshot,
  validateBootstrapSnapshot,
} from "../scripts/verify/bootstrap-contracts.mjs";

let baseline: Awaited<ReturnType<typeof loadBootstrapSnapshot>>;

function mutant(): any {
  return structuredClone(baseline);
}

beforeAll(async () => {
  baseline = await loadBootstrapSnapshot();
});

describe("bootstrap manifest graph", () => {
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
      "package-local build",
      (snapshot: any) => {
        snapshot.manifests["@orchestration-platform/credentials"].scripts.build =
          "esbuild build/compose.ts";
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
    ["non-empty module row", (snapshot: any) => snapshot.moduleManifest.push({ id: "planning" })],
    [
      "missing OS smoke lane",
      (snapshot: any) => {
        snapshot.workflow = snapshot.workflow.replace(", macos-latest", "");
      },
    ],
    ["missing CLI handler", (snapshot: any) => snapshot.cliRegistry.pop()],
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
  ])("rejects the %s mutant", async (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    await expect(validateBootstrapSnapshot(snapshot)).rejects.toThrow(
      /BOOTSTRAP_CONTRACT_MISMATCH/,
    );
  });
});

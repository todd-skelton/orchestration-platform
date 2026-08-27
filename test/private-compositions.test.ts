import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const buildScript = resolve(root, "scripts/build/private-compositions.mjs");
const outputs = [
  ["bootstrap/dist/orchestration-bootstrap.mjs", "ISS-020"],
  ["adapters/self/dist/orchestration-self.mjs", "ISS-033"],
  ["packages/credentials/dist/orchestration-credential-broker.mjs", "ISS-020"],
  ["packages/host-custody/dist/orchestration-host-custody-bootstrap.mjs", "ISS-038"],
  ["packages/host-custody/dist/orchestration-host-custody-broker.mjs", "ISS-038"],
] as const;

function build() {
  return spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function hashes() {
  return Promise.all(
    outputs.map(async ([path]) =>
      createHash("sha256")
        .update(await readFile(resolve(root, path)))
        .digest("hex"),
    ),
  );
}

describe("private composition build", () => {
  test("builds the five targets deterministically without private emitted specifiers", async () => {
    const firstBuild = build();
    expect(firstBuild.status, firstBuild.stderr).toBe(0);
    const firstHashes = await hashes();
    const secondBuild = build();
    expect(secondBuild.status, secondBuild.stderr).toBe(0);
    expect(await hashes()).toEqual(firstHashes);

    for (const [path, issue] of outputs) {
      const bytes = await readFile(resolve(root, path), "utf8");
      expect(bytes).not.toContain("#broker-compose");
      expect(bytes).not.toMatch(/(?:packages|adapters|bootstrap|modules)\//);
      expect(bytes).not.toContain("sourceMappingURL");
      const result = spawnSync(process.execPath, [resolve(root, path)], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(issue);
    }
  }, 120_000);

  test("rejects build option and target arguments", () => {
    const result = spawnSync(process.execPath, [buildScript, "--target", "bootstrap"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("accept no target, plugin, alias, or option overrides");
  });

  test("ordinary Node and package consumers cannot resolve the private alias", () => {
    const alias = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", 'await import("#broker-compose")'],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(alias.status).not.toBe(0);

    const deepImport = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await import("@orchestration-platform/credentials/build/compose")',
      ],
      { cwd: resolve(root, "packages/cli"), encoding: "utf8", windowsHide: true },
    );
    expect(deepImport.status).not.toBe(0);
    expect(deepImport.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });
});

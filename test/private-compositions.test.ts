import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const buildScript = resolve(root, "scripts/build/private-compositions.mjs");
const outputs = [
  ["bootstrap/dist/orchestration-bootstrap.mjs", "ISS-020"],
  ["adapters/self/dist/orchestration-self.mjs", "ISS-033"],
  ["packages/credentials/dist/orchestration-credential-broker.mjs", "ISS-020"],
  ["packages/host-custody/dist/orchestration-host-custody-bootstrap.mjs", "ISS-038"],
  ["packages/host-custody/dist/orchestration-host-custody-broker.mjs", "ISS-038"],
  ["packages/cli/dist/orchestrate.mjs", null],
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
  test("production sources cannot import or export the fixture-only final cycle", async () => {
    const files: string[] = [];
    async function visit(path: string) {
      for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
        const child = `${path}/${entry.name}`;
        if (entry.isDirectory()) await visit(child);
        else if (/\.(?:[cm]?[jt]s|json)$/.test(entry.name)) files.push(child);
      }
    }
    for (const directory of ["packages", "adapters", "bootstrap", "modules"])
      await visit(directory);
    for (const path of files) {
      const source = await readFile(resolve(root, path), "utf8");
      expect(source, path).not.toMatch(
        /fixtures[\\/]walking-skeleton|walking-skeleton[\\/](?:src[\\/])?(?:final-cycle|journal-owner)/,
      );
    }
    const fixturePackage = JSON.parse(
      await readFile(resolve(root, "fixtures/walking-skeleton/package.json"), "utf8"),
    );
    expect(fixturePackage).toMatchObject({ private: true, exports: {} });
    expect(await readFile(resolve(root, "packages/journal/src/index.ts"), "utf8")).toBe(
      'export { commandHandlerRegistration } from "./command-handler.mjs";\n',
    );
    expect(
      JSON.stringify(
        JSON.parse(await readFile(resolve(root, "config/private-compositions.json"), "utf8")),
      ),
    ).not.toMatch(/walking-skeleton|final-cycle|journal-owner/);
  });

  test("annotation cleanup retains runtime data and refuses private path values", async () => {
    const source = await readFile(buildScript, "utf8");
    const cleanup = source.slice(
      source.indexOf("function removeSourcePathAnnotations("),
      source.indexOf("async function buildTarget("),
    );
    const targetBuilder = source.slice(
      source.indexOf("async function buildTarget("),
      source.indexOf("\nif (process.argv.length"),
    );
    const output = resolve(root, "packages/cli/dist/orchestrate.mjs");
    for (const [emitted, expected] of [
      [
        'var init_config_command = __esm({\n  "packages/config/src/config-command.ts"() {\n    const value = "installation/bootstrap/core.json";\n  }\n});',
        'var init_config_command = __esm({\n  "bundled module"() {\n    const value = "installation/bootstrap/core.json";\n  }\n});',
      ],
      ['const value = {\n  "packages/config/src/config-command.ts"() {\n  }\n};', null],
      ['const value = "packages/config/src/config-command.ts";', null],
      ['const value = "bootstrap/build/composition.ts";', null],
      ['const value = "#broker-compose";', null],
    ] as const) {
      const write = vi.fn();
      // Execute the actual cleanup and target inspection with an in-memory
      // esbuild output; no source mutation or second bundler policy is needed.
      const inspect = runInNewContext(`${cleanup}\n(${targetBuilder})`, {
        repositoryRoot: root,
        resolve,
        TextEncoder,
        assertInsideRepository: () => {},
        brokerComposeResolver: () => ({}),
        atomicWrite: write,
        build: async () => ({
          outputFiles: [{ path: output, text: emitted }],
          metafile: { outputs: { [output]: {} } },
        }),
      });
      const pending = inspect(
        {
          id: "cli",
          entryPoint: "packages/cli/build/composition.ts",
          output: "packages/cli/dist/orchestrate.mjs",
        },
        {},
      );
      if (expected === null) {
        await expect(pending).rejects.toThrow(
          "leaked a private specifier, source path, or source map",
        );
        expect(write).not.toHaveBeenCalled();
      } else {
        await pending;
        expect(write).toHaveBeenCalledExactlyOnceWith(output, new TextEncoder().encode(expected));
      }
    }
  });

  test("builds the six targets deterministically without private emitted specifiers", async () => {
    const firstBuild = build();
    expect(firstBuild.status, firstBuild.stderr).toBe(0);
    const firstHashes = await hashes();
    const secondBuild = build();
    expect(secondBuild.status, secondBuild.stderr).toBe(0);
    expect(await hashes()).toEqual(firstHashes);

    for (const [path, issue] of outputs) {
      const bytes = await readFile(resolve(root, path), "utf8");
      expect(bytes).not.toContain("#broker-compose");
      expect(bytes).not.toMatch(/(?:^|["'`])(?:packages|adapters|bootstrap|modules)\//m);
      expect(bytes).not.toMatch(/\bimport\s*\(/);
      expect(bytes).not.toContain("sourceMappingURL");
      const result = spawnSync(process.execPath, [resolve(root, path)], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).not.toBe(0);
      if (issue === null) {
        expect(result.status).toBe(2);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(
          '{"command":"","diagnostics":[{"code":"ARGV_REFUSED","message":"command line refused"}],"outcome":"invalid-input","result":null,"schemaVersion":"orchestration-command-result/v1"}\n',
        );
      } else {
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(issue);
      }
    }
  }, 20_000);

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

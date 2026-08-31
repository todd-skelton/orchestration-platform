import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { canonicalJson, computeConfigurationPathToken } from "../packages/contracts/src/index.js";

const root = resolve(import.meta.dirname, "..");

function run(script: string, argv: string[]) {
  return spawnSync(process.execPath, [resolve(root, script), ...argv], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

describe("live config CLI composition", () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let configPath: string;
  let stateRoot: string;
  const source = {
    adapterId: "fixture.adapter",
    capabilityNames: ["cap.read"],
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
    schemaVersion: "platform-configuration-source/v1",
    stateRoot: null,
    wallClockSkewMs: 1000,
  };

  beforeAll(async () => {
    // The global setup owns native compilation; this suite obtains its JS
    // output explicitly without relying on another worker's build order.
    const built = run("scripts/build/private-compositions.mjs", []);
    expect(built.status, built.stderr).toBe(0);
    fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), "cli-path-canary-")));
    projectRoot = resolve(fixtureRoot, "project with spaces");
    configPath = resolve(projectRoot, ".orchestration", "project.json");
    stateRoot = resolve(fixtureRoot, "absent state");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, canonicalJson(source), "utf8");
  }, 30_000);

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  function cli(argv: string[], overrides: NodeJS.ProcessEnv = {}) {
    return spawnSync(
      process.execPath,
      [resolve(root, "packages/cli/bin/orchestrate.mjs"), ...argv],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: undefined,
          LOCALAPPDATA: undefined,
          XDG_STATE_HOME: undefined,
          ORCHESTRATION_CONFIG: undefined,
          ORCHESTRATION_PROJECT_ROOT: undefined,
          ORCHESTRATION_STATE_ROOT: stateRoot,
          ...overrides,
        },
        encoding: "utf8",
        windowsHide: true,
      },
    );
  }

  const pathToken = (path: string) => computeConfigurationPathToken(pathToFileURL(path).href);

  test.each(["paths", "validate"])(
    "config %s emits one canonical redacted success without state creation",
    async (operation) => {
      const result = cli(["--output", "json", "config", operation]);
      const expectedResult =
        operation === "paths"
          ? {
              configPath: pathToken(configPath),
              projectRoot: pathToken(projectRoot),
              schemaVersion: "configuration-paths/v1",
              stateRoot: pathToken(stateRoot),
            }
          : {
              ...source,
              fieldSources: {
                adapterId: "PROJECT",
                capabilityNames: "PROJECT",
                leaseFreshnessMs: "PROJECT",
                maximumSessionMs: "PROJECT",
                projectId: "PROJECT",
                stateRoot: "ENVIRONMENT",
                wallClockSkewMs: "PROJECT",
              },
              projectRoot: pathToken(projectRoot),
              schemaVersion: "configuration-provenance/v1",
              stateRoot: pathToken(stateRoot),
            };
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        canonicalJson({
          command: `config ${operation}`,
          diagnostics: [],
          outcome: "success",
          result: expectedResult,
          schemaVersion: "orchestration-command-result/v1",
        }),
      );
      expect(result.stdout).not.toContain("cli-path-canary");
      await expect(lstat(stateRoot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(configPath, "utf8")).toBe(canonicalJson(source));
    },
  );

  test.each([
    [
      "unknown argv",
      ["unknown", "path-canary"],
      {},
      "",
      "ARGV_REFUSED",
      "command line refused",
      "invalid-input",
      2,
    ],
    [
      "text output",
      ["--output", "text", "config", "paths"],
      {},
      "",
      "ARGV_REFUSED",
      "command line refused",
      "invalid-input",
      2,
    ],
    [
      "empty environment",
      ["config", "paths"],
      { HOME: "" },
      "config paths",
      "CONFIG_REFUSED",
      "configuration refused",
      "invalid-input",
      2,
    ],
    [
      "relative state",
      ["--state-root", "path-canary", "config", "paths"],
      {},
      "config paths",
      "PATH_REFUSED",
      "path refused",
      "authority-refused",
      3,
    ],
  ] as const)(
    "emits the exact %s refusal",
    (_label, argv, environment, command, code, message, outcome, exitCode) => {
      const result = cli([...argv], environment);
      expect(result.status).toBe(exitCode);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        canonicalJson({
          command,
          diagnostics: [{ code, message }],
          outcome,
          result: null,
          schemaVersion: "orchestration-command-result/v1",
        }),
      );
    },
  );

  test("public CLI resolves a declared placeholder to its owning issue", () => {
    const result = cli([
      "--output",
      "json",
      "session",
      "handoff",
      "--predecessor",
      "a.json",
      "--successor",
      "b.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      '{"command":"session handoff","diagnostics":[{"code":"CAPABILITY_NOT_IMPLEMENTED","owner":"ISS-007"}],"outcome":"operation-failed","result":null,"schemaVersion":"orchestration-command-result/v1"}\n',
    );
  });
});

describe("static bootstrap placeholder runners", () => {
  test("bootstrap abort is declared with no inferred defaults", () => {
    const result = run("bootstrap/bin/orchestration-bootstrap.mjs", [
      "abort",
      "--input",
      "install.json",
      "--output",
      "abort.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('"owner":"ISS-020"');
  });

  test("host-custody service install is predeclared", () => {
    const result = run("packages/host-custody/bin/orchestration-host-custody-bootstrap.mjs", [
      "service-install",
      "--plan",
      "plan.json",
      "--plan-id",
      "abc",
      "--output",
      "receipt.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('"owner":"ISS-038"');
  });

  test.each([
    ["missing", ["abort", "--input", "install.json"]],
    ["duplicate", ["abort", "--input", "a", "--input", "b", "--output", "c"]],
    ["extra", ["abort", "--input", "a", "--output", "b", "--force"]],
    ["positional", ["abort", "a", "b"]],
    ["undeclared", ["cancel", "--input", "a", "--output", "b"]],
  ])("refuses %s bootstrap arguments before placeholder dispatch", (_name, argv) => {
    const result = run("bootstrap/bin/orchestration-bootstrap.mjs", argv);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"outcome":"invalid-input"');
    expect(result.stderr).not.toContain("CAPABILITY_NOT_IMPLEMENTED");
  });
});

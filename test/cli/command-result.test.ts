import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  canonicalJson,
  computeConfigurationPathToken,
  parseContract,
  parseOrchestrationCommandResult,
} from "../../packages/contracts/src/index.js";
import { commandRegistry } from "../../packages/cli/src/registry.mjs";
import {
  prepareArgvRefusal,
  prepareCommandResult,
  preparePlaceholderResult,
  type PreparedCommandEmission,
} from "../../packages/cli/src/command-result.js";

const failures = [
  ["ARGV_REFUSED", 2, "command line refused", "invalid-input"],
  ["CONFIG_REFUSED", 2, "configuration refused", "invalid-input"],
  ["PROJECT_ROOT_REFUSED", 3, "project root refused", "authority-refused"],
  ["PATH_REFUSED", 3, "path refused", "authority-refused"],
  ["FILESYSTEM_OPERATION_FAILED", 5, "filesystem operation failed", "operation-failed"],
  ["INTERNAL_ERROR", 70, "internal error", "internal-error"],
] as const;

function goldenFailure(command: string, code: string, message: string, outcome: string) {
  return `{"command":${JSON.stringify(command)},"diagnostics":[{"code":"${code}","message":"${message}"}],"outcome":"${outcome}","result":null,"schemaVersion":"orchestration-command-result/v1"}\n`;
}

function internal(command = "config paths") {
  return {
    stdout: goldenFailure(command, "INTERNAL_ERROR", "internal error", "internal-error"),
    stderr: "",
    exitCode: 70,
  };
}

function paths() {
  const parsed = parseContract("configuration-paths/v1", {
    configPath: computeConfigurationPathToken(
      "file:///work/private-canary/.orchestration/project.json",
    ),
    projectRoot: computeConfigurationPathToken("file:///work/private-canary"),
    schemaVersion: "configuration-paths/v1",
    stateRoot: computeConfigurationPathToken("file:///state/private-canary"),
  });
  if (!parsed.ok) throw new Error("invalid fixture");
  return parsed.value;
}

function provenance() {
  const parsed = parseContract("configuration-provenance/v1", {
    adapterId: "fixture.adapter",
    capabilityNames: ["read"],
    fieldSources: {
      adapterId: "PROJECT",
      capabilityNames: "PROJECT",
      leaseFreshnessMs: "PROJECT",
      maximumSessionMs: "PROJECT",
      projectId: "PROJECT",
      stateRoot: "CLI",
      wallClockSkewMs: "PROJECT",
    },
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
    projectRoot: paths().projectRoot,
    schemaVersion: "configuration-provenance/v1",
    stateRoot: paths().stateRoot,
    wallClockSkewMs: 1000,
  });
  if (!parsed.ok) throw new Error("invalid fixture");
  return parsed.value;
}

function canonicalEmission(prepared: PreparedCommandEmission) {
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.getPrototypeOf(prepared)).toBe(Object.prototype);
  expect(Object.keys(prepared).sort()).toEqual(["exitCode", "stderr", "stdout"]);
  expect(prepared.stderr).toBe("");
  expect(prepared.stdout.endsWith("\n")).toBe(true);
  expect(prepared.stdout.slice(0, -1)).not.toContain("\n");
  const bytes = Buffer.from(prepared.stdout, "utf8");
  expect(bytes[0]).toBe(0x7b);
  expect(bytes.at(-1)).toBe(0x0a);
  const record: unknown = JSON.parse(prepared.stdout);
  const parsed = parseOrchestrationCommandResult(record);
  expect(parsed.ok).toBe(true);
  expect(prepared.stdout).toBe(canonicalJson(record));
  expect(prepared.stdout).not.toContain("private-canary");
}

describe("prepared canonical CLI emission (no I/O)", () => {
  test.each([
    ["ADAPTER_CONFIGURATION_REFUSED", 2, "adapter configuration refused", "invalid-input"],
    ["ADAPTER_BINDING_REFUSED", 3, "adapter binding refused", "authority-refused"],
    ["ADAPTER_COMPATIBILITY_REFUSED", 3, "adapter compatibility refused", "authority-refused"],
    ["PROJECT_SNAPSHOT_UNAVAILABLE", 4, "project snapshot unavailable", "external-unavailable"],
    ["PROJECT_SNAPSHOT_UNKNOWN", 3, "project snapshot unknown", "authority-unknown"],
  ] as const)(
    "project %s has exact closed bytes and cannot escape its command",
    (code, exitCode, message, outcome) => {
      const value = { ok: false, error: { code, exitCode, message, outcome } };
      expect(prepareCommandResult("project snapshot", value)).toEqual({
        exitCode,
        stderr: "",
        stdout: goldenFailure("project snapshot", code, message, outcome),
      });
      expect(prepareCommandResult("config paths", value)).toEqual(internal());
      expect(prepareCommandResult("project plan", value)).toEqual(internal("project plan"));
    },
  );

  test("pre-command argv refusal is fixed and contains no untrusted command", () => {
    const prepared = prepareArgvRefusal();
    expect(prepared).toEqual({
      stdout: goldenFailure("", "ARGV_REFUSED", "command line refused", "invalid-input"),
      stderr: "",
      exitCode: 2,
    });
    canonicalEmission(prepared);
  });

  test.each(failures)("exact %s golden and exit", (code, exitCode, message, outcome) => {
    const prepared = prepareCommandResult("config paths", {
      ok: false,
      error: { code, exitCode, message, outcome },
    });
    expect(prepared).toEqual({
      stdout: goldenFailure("config paths", code, message, outcome),
      stderr: "",
      exitCode,
    });
    canonicalEmission(prepared);
  });

  test.each(["config paths", "config validate"])("typed frozen %s success", (command) => {
    const result = command === "config paths" ? paths() : provenance();
    const prepared = prepareCommandResult(command, { ok: true, result });
    expect(prepared.exitCode).toBe(0);
    expect(prepared.stdout).toBe(
      `{"command":"${command}","diagnostics":[],"outcome":"success","result":${canonicalJson(result).slice(0, -1)},"schemaVersion":"orchestration-command-result/v1"}\n`,
    );
    canonicalEmission(prepared);
  });

  test("every existing placeholder has its registration-owned golden", () => {
    let count = 0;
    for (const registration of commandRegistry) {
      if (registration.family === "config") continue;
      for (const shape of registration.commands) {
        const command = shape.argv.join(" ");
        if (command === "project snapshot") continue;
        const prepared = preparePlaceholderResult(command, registration.issue);
        expect(prepared).toEqual({
          stdout: `{"command":"${command}","diagnostics":[{"code":"CAPABILITY_NOT_IMPLEMENTED","owner":"${registration.issue}"}],"outcome":"operation-failed","result":null,"schemaVersion":"orchestration-command-result/v1"}\n`,
          stderr: "",
          exitCode: 5,
        });
        canonicalEmission(prepared);
        count += 1;
      }
    }
    expect(count).toBe(30);
  });

  test("placeholder owner cannot be substituted or supplied by an implemented handler", () => {
    expect(preparePlaceholderResult("project snapshot", "ISS-999")).toEqual(
      internal("project snapshot"),
    );
    expect(preparePlaceholderResult("config paths", "ISS-003")).toEqual(internal());
    expect(
      prepareCommandResult("project snapshot", {
        ok: false,
        error: { code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-013" },
      }),
    ).toEqual(internal("project snapshot"));
    expect(prepareCommandResult("project snapshot", { ok: true, result: paths() })).toEqual(
      internal("project snapshot"),
    );
  });

  test("input refusal neither calls getters/coercion nor leaks canaries", () => {
    let calls = 0;
    const dangerous = {
      toString() {
        calls += 1;
        throw new Error("private-canary");
      },
    };
    const accessor = Object.defineProperty({}, "ok", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("private-canary");
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const cases: unknown[] = [
      null,
      undefined,
      "private-canary",
      Symbol("private-canary"),
      dangerous,
      accessor,
      revoked.proxy,
      new Proxy(
        { ok: true, result: paths() },
        {
          ownKeys() {
            calls += 1;
            throw new Error("private-canary");
          },
        },
      ),
      { ok: true, result: paths(), extra: "private-canary" },
      { ok: true, result: { ...paths() } },
      { ok: true, result: Object.freeze({ ...paths(), configPath: "/private-canary" }) },
      { ok: true, result: Object.freeze({ ...provenance(), capabilityNames: ["read"] }) },
      { ok: "true", result: paths() },
      {
        ok: false,
        error: {
          code: "PATH_REFUSED",
          exitCode: 70,
          message: "path refused",
          outcome: "authority-refused",
        },
      },
      {
        ok: false,
        error: {
          code: "PATH_REFUSED",
          exitCode: 3,
          message: "private-canary",
          outcome: "authority-refused",
        },
      },
      {
        ok: false,
        error: {
          code: "PATH_REFUSED",
          exitCode: 3,
          message: "path refused",
          outcome: "authority-refused",
          extra: true,
        },
      },
    ];
    for (const input of cases)
      expect(prepareCommandResult("config paths", input)).toEqual(internal());
    for (const command of [
      dangerous,
      revoked.proxy,
      Symbol("private-canary"),
      "private-canary",
      "",
    ]) {
      expect(prepareCommandResult(command, { ok: true, result: paths() })).toEqual(
        prepareArgvRefusal(),
      );
      expect(preparePlaceholderResult(command, "ISS-013")).toEqual(prepareArgvRefusal());
    }
    expect(preparePlaceholderResult("project snapshot", dangerous)).toEqual(
      internal("project snapshot"),
    );
    expect(calls).toBe(0);
  });

  test("a shallow-frozen valid provenance result is not a frozen handler result", () => {
    const result = Object.freeze({ ...provenance(), capabilityNames: ["read"] });
    expect(parseContract("configuration-provenance/v1", result).ok).toBe(true);
    expect(prepareCommandResult("config validate", { ok: true, result })).toEqual(
      internal("config validate"),
    );
  });

  test("module stays internal and cannot perform writes or change process state", async () => {
    const source = await readFile(
      new URL("../../packages/cli/src/command-result.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /node:(?:fs|process|child_process)|process\.(?:stdout|stderr|exit|env|argv)|writeFile|\.write\(/,
    );
    const root = await readFile(
      new URL("../../packages/cli/src/index.ts", import.meta.url),
      "utf8",
    );
    expect(root).not.toContain("command-result");
  });
});

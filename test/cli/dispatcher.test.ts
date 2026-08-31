import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, test, vi } from "vitest";

import {
  canonicalJson,
  computeConfigurationPathToken,
} from "../../packages/contracts/src/index.js";
import { createCommandDispatcher } from "../../packages/cli/src/dispatcher.js";
import { commandRegistry } from "../../packages/cli/src/registry.mjs";
import {
  configCommandHandler,
  type CommandHandlerInput,
} from "../../packages/config/src/config-command.js";
import type { LoadConfiguration } from "../../packages/config/src/loader.js";
import { resolveConfigurationFromAdmittedPaths } from "../../packages/config/src/resolver.js";

const context = Object.freeze({
  cwd: "/private-canary/project",
  operatingSystem: "LINUX" as const,
  environment: Object.freeze({
    HOME: "/private-canary/home",
    LOCALAPPDATA: null,
    ORCHESTRATION_CONFIG: null,
    ORCHESTRATION_PROJECT_ROOT: null,
    ORCHESTRATION_STATE_ROOT: null,
    XDG_STATE_HOME: null,
  }),
});
function configuration() {
  const resolved = resolveConfigurationFromAdmittedPaths(
    {
      environment: context.environment,
      operatingSystem: "LINUX",
      flags: { configPath: null, projectRoot: null, stateRoot: "/private-canary/state" },
    },
    {
      adapterId: "fixture.adapter",
      capabilityNames: ["read"],
      leaseFreshnessMs: 30_000,
      maximumSessionMs: 3_600_000,
      projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    },
    {
      projectRoot: context.cwd,
      configPath: `${context.cwd}/.orchestration/project.json`,
      stateRoot: "/private-canary/state",
      stateRootDisposition: "ABSENT",
    },
  );
  if (!resolved.ok) throw new Error("configuration fixture refused");
  return resolved;
}

function registrations(handler: unknown = configCommandHandler) {
  return commandRegistry.map((row) =>
    row.family !== "config"
      ? structuredClone(row)
      : {
          ...structuredClone(row),
          implementation: "implemented",
          handler,
          commands: row.commands.map((shape) => ({
            ...structuredClone(shape),
            resultSchema:
              shape.argv[1] === "paths" ? "configuration-paths/v1" : "configuration-provenance/v1",
          })),
        },
  );
}

function setup(
  handler: unknown = configCommandHandler,
  registry: unknown = registrations(handler),
) {
  const load = vi.fn<LoadConfiguration>(async () => configuration());
  return { load, dispatch: createCommandDispatcher(registry, load) };
}

function expectedFailure(
  command: string,
  code = "INTERNAL_ERROR",
  exitCode = 70,
  message = "internal error",
  outcome = "internal-error",
) {
  return {
    stdout: `{"command":${JSON.stringify(command)},"diagnostics":[{"code":"${code}","message":"${message}"}],"outcome":"${outcome}","result":null,"schemaVersion":"orchestration-command-result/v1"}\n`,
    stderr: "",
    exitCode,
  };
}

describe("ISS-003 pure dispatcher and config handler", () => {
  test.each(["paths", "validate"])(
    "actual config %s projection and replacement ABI",
    async (operation) => {
      let input: CommandHandlerInput | undefined;
      const handler = vi.fn(async (...args: [CommandHandlerInput]) => {
        expect(args).toHaveLength(1);
        [input] = args;
        return configCommandHandler(input);
      });
      const { load, dispatch } = setup(handler);
      const output = await dispatch(["config", operation], context);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledTimes(1);
      expect(input).toEqual({
        command: `config ${operation}`,
        configuration: configuration().value,
        options: {},
      });
      expect(Object.keys(input!).sort()).toEqual(["command", "configuration", "options"]);
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(input!.options)).toBe(true);
      expect(Object.isFrozen(input!.configuration)).toBe(true);
      expect(Object.isFrozen(input!.configuration.configuration.capabilityNames)).toBe(true);
      const parsed = JSON.parse(output.stdout);
      expect(output.exitCode).toBe(0);
      expect(output.stderr).toBe("");
      expect(output.stdout).toBe(canonicalJson(parsed));
      expect(output.stdout).not.toContain("private-canary");
      expect(parsed.result.projectRoot).toBe(
        computeConfigurationPathToken("file:///private-canary/project"),
      );
      expect(parsed.result.stateRoot).toBe(
        computeConfigurationPathToken("file:///private-canary/state"),
      );
      expect(parsed.result.schemaVersion).toBe(
        operation === "paths" ? "configuration-paths/v1" : "configuration-provenance/v1",
      );
      if (operation === "validate") expect(parsed.result.fieldSources.stateRoot).toBe("CLI");
    },
  );

  test("globals become one detached frozen loader invocation and never command options", async () => {
    const { load, dispatch } = setup();
    await dispatch(
      [
        "--config",
        "/config",
        "--project-root",
        "/project",
        "--state-root",
        "/state",
        "--no-color",
        "--output",
        "json",
        "config",
        "paths",
      ],
      context,
    );
    expect(load).toHaveBeenCalledExactlyOnceWith({
      ...context,
      flags: { configPath: "/config", projectRoot: "/project", stateRoot: "/state" },
    });
    const invocation = load.mock.calls[0]![0];
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.flags)).toBe(true);
    expect(Object.isFrozen(invocation.environment)).toBe(true);
    expect(invocation.environment).not.toBe(context.environment);
  });

  test.each([
    [[], ""],
    [["config paths"], ""],
    [["config validate"], ""],
    [["unknown", "private-canary"], ""],
    [["--output", "text", "config", "paths"], ""],
    [["--config"], ""],
    [["--config", "--state-root", "/state", "config", "paths"], ""],
    [["--no-color", "--no-color", "config", "paths"], ""],
    [["--output", "json", "--output", "json", "config", "paths"], ""],
    [["config", "paths", "private-canary"], "config paths"],
    [["config", "paths", "--output", "json"], "config paths"],
    [["project", "apply", "--plan", "p"], "project apply"],
    [["project", "snapshot", "--adapter", "a", "--adapter", "b"], "project snapshot"],
  ] as const)("argv refusal %j", async (argv, command) => {
    const handler = vi.fn(configCommandHandler);
    const { load, dispatch } = setup(handler);
    expect(await dispatch(argv, context)).toEqual(
      expectedFailure(command, "ARGV_REFUSED", 2, "command line refused", "invalid-input"),
    );
    expect(load).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  test("closed argv and context never invoke caller code and classify environment separately", async () => {
    const trap = vi.fn(() => {
      throw new Error("private-canary");
    });
    const { load, dispatch } = setup();
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    for (const argv of [
      revoked.proxy,
      new Proxy(["config", "paths"], { get: trap }),
      Object.assign(["config", "paths"], { extra: true }),
      ["config", , "paths"],
      Object.defineProperty(["config", "paths"], "0", { get: trap }),
    ]) {
      expect(await dispatch(argv, context)).toEqual(
        expectedFailure("", "ARGV_REFUSED", 2, "command line refused", "invalid-input"),
      );
    }
    for (const value of [
      { ...context, extra: true },
      { ...context, operatingSystem: { toString: trap } },
      new Proxy(context, { ownKeys: trap }),
      Object.defineProperty({ ...context }, "cwd", { get: trap }),
    ]) {
      expect(await dispatch(["config", "paths"], value)).toEqual(
        expectedFailure("config paths", "ARGV_REFUSED", 2, "command line refused", "invalid-input"),
      );
    }
    for (const environment of [
      { ...context.environment, HOME: "" },
      { ...context.environment, extra: true },
      new Proxy(context.environment, { ownKeys: trap }),
      Object.defineProperty({ ...context.environment }, "HOME", { get: trap }),
    ]) {
      expect(await dispatch(["config", "paths"], { ...context, environment })).toEqual(
        expectedFailure(
          "config paths",
          "CONFIG_REFUSED",
          2,
          "configuration refused",
          "invalid-input",
        ),
      );
    }
    expect(trap).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("all 31 placeholders retain their owner golden after configuration admission", async () => {
    const handler = vi.fn(configCommandHandler);
    const { load, dispatch } = setup(handler);
    let count = 0;
    for (const row of commandRegistry.filter((entry) => entry.family !== "config")) {
      for (const shape of row.commands) {
        const command = shape.argv.join(" ");
        const output = await dispatch(
          [...shape.argv, ...shape.required.flatMap((name) => [name, "value"])],
          context,
        );
        expect(output).toEqual({
          stdout: `{"command":"${command}","diagnostics":[{"code":"CAPABILITY_NOT_IMPLEMENTED","owner":"${row.issue}"}],"outcome":"operation-failed","result":null,"schemaVersion":"orchestration-command-result/v1"}\n`,
          stderr: "",
          exitCode: 5,
        });
        count += 1;
      }
    }
    expect(count).toBe(31);
    expect(load).toHaveBeenCalledTimes(31);
    expect(handler).not.toHaveBeenCalled();
  });

  test.each([
    ["ARGV_REFUSED", 2, "command line refused", "invalid-input"],
    ["CONFIG_REFUSED", 2, "configuration refused", "invalid-input"],
    ["PROJECT_ROOT_REFUSED", 3, "project root refused", "authority-refused"],
    ["PATH_REFUSED", 3, "path refused", "authority-refused"],
    ["FILESYSTEM_OPERATION_FAILED", 5, "filesystem operation failed", "operation-failed"],
  ] as const)(
    "loader %s precedes registry drift and a valid placeholder",
    async (code, exitCode, message, outcome) => {
      const load = vi.fn(
        async () => ({ ok: false, error: { code, exitCode, message, outcome } }) as const,
      );
      for (const registry of [registrations(), []]) {
        const dispatch = createCommandDispatcher(registry, load as LoadConfiguration);
        expect(await dispatch(["project", "snapshot", "--adapter", "a"], context)).toEqual(
          expectedFailure("project snapshot", code, exitCode, message, outcome),
        );
      }
    },
  );

  test.each([
    ["missing family", (rows: any[]) => rows.pop()],
    ["duplicate family", (rows: any[]) => rows.push(rows[0])],
    ["missing command", (rows: any[]) => rows[0].commands.pop()],
    ["duplicate command", (rows: any[]) => rows[0].commands.push(rows[0].commands[0])],
    ["missing handler", (rows: any[]) => delete rows[0].handler],
    ["extra registration member", (rows: any[]) => (rows[0].extra = true)],
    [
      "unknown schema",
      (rows: any[]) => (rows[0].commands[0].resultSchema = "configuration-provenance/v2"),
    ],
    [
      "mismatched schema",
      (rows: any[]) => (rows[0].commands[0].resultSchema = "configuration-paths/v1"),
    ],
    ["owner substitution", (rows: any[]) => (rows[1].issue = "ISS-999")],
    ["option substitution", (rows: any[]) => (rows[1].commands[0].required = [])],
    ["placeholder handler", (rows: any[]) => (rows[5].handler = configCommandHandler)],
    [
      "project config success",
      (rows: any[]) => {
        rows[5].implementation = "implemented";
        rows[5].handler = configCommandHandler;
        rows[5].commands.forEach((shape: any) => (shape.resultSchema = "configuration-paths/v1"));
      },
    ],
  ])("refuses registry %s before any handler call", async (_name, mutate) => {
    const handler = vi.fn(configCommandHandler);
    const rows = registrations(handler);
    mutate(rows);
    const { dispatch } = setup(handler, rows);
    expect(await dispatch(["config", "paths"], context)).toEqual(expectedFailure("config paths"));
    expect(handler).not.toHaveBeenCalled();
  });

  test("registration functions/data are snapshotted once without invoking accessors", async () => {
    const first = vi.fn(configCommandHandler),
      second = vi.fn(configCommandHandler);
    const rows = registrations(first);
    const { dispatch } = setup(first, rows);
    Object.assign(rows[0]!, { handler: second, issue: "ISS-999" });
    expect((await dispatch(["config", "paths"], context)).exitCode).toBe(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    const trap = vi.fn(() => {
      throw new Error("private-canary");
    });
    for (const registry of [
      new Proxy(registrations(), { ownKeys: trap }),
      Object.defineProperty(registrations(), "0", { get: trap }),
      [
        Object.defineProperty(registrations()[0]!, "handler", { get: trap }),
        ...registrations().slice(1),
      ],
    ]) {
      expect(await setup(undefined, registry).dispatch(["config", "paths"], context)).toEqual(
        expectedFailure("config paths"),
      );
    }
    expect(trap).not.toHaveBeenCalled();
  });

  test.each([
    ["sync", () => ({ ok: true, result: {} })],
    [
      "thenable",
      () => ({
        then() {
          throw new Error("private-canary");
        },
      }),
    ],
    [
      "throw",
      () => {
        throw new Error("private-canary");
      },
    ],
    [
      "reject",
      async () => {
        throw new Error("private-canary");
      },
    ],
    ["foreign promise", () => runInNewContext("Promise.resolve({ok:true,result:{}})")],
    ["promise subclass", () => new (class extends Promise<unknown> {})((resolve) => resolve({}))],
    ["result drift", async () => ({ ok: true, result: {}, extra: true })],
    [
      "failure drift",
      async () => ({
        ok: false,
        error: {
          code: "PATH_REFUSED",
          exitCode: 3,
          message: "private-canary",
          outcome: "authority-refused",
        },
      }),
    ],
  ])("handler %s is the fixed internal failure", async (_name, implementation) => {
    const handler = vi.fn(implementation);
    expect(await setup(handler).dispatch(["config", "paths"], context)).toEqual(
      expectedFailure("config paths"),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("pure slice leaves live bootstrap/registry untouched and cannot write output", async () => {
    expect(commandRegistry.every((row) => row.implementation === "placeholder")).toBe(true);
    for (const path of [
      "packages/cli/src/dispatcher.ts",
      "packages/config/src/config-command.ts",
    ]) {
      const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /node:(?:fs|process|child_process)|process\.(?:stdout|stderr|exit|env|argv)|writeFile|\.write\(/,
      );
    }
  });
});

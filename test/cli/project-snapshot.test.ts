import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  parseOrchestrationCommandResult,
} from "../../packages/contracts/src/index.js";
import { createCommandDispatcher } from "../../packages/cli/src/dispatcher.js";
import {
  prepareCommandResult,
  preparePlaceholderResult,
} from "../../packages/cli/src/command-result.js";
import { commandRegistry } from "../../packages/cli/src/registry.mjs";
import { projectSnapshotCommandHandler } from "../../packages/adapter-sdk/src/project-command.js";
import { resolveConfigurationFromAdmittedPaths } from "../../packages/config/src/resolver.js";

const control = vi.hoisted(() => ({ state: "COMPLETE" }));
vi.mock("../../packages/adapter-sdk/src/fixtures.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../packages/adapter-sdk/src/fixtures.js")>();
  return {
    ...actual,
    createBranchFixtureSnapshot: (
      ...args: Parameters<typeof actual.createBranchFixtureSnapshot>
    ) => {
      const reader = actual.createBranchFixtureSnapshot(...args);
      return async (...inputs: Parameters<typeof reader>) => {
        const result = await reader(...inputs);
        if (!result.ok || result.facts.state !== "COMPLETE" || control.state === "COMPLETE")
          return result;
        const { frontier: _frontier, frontierDigest: _digest, ...common } = result.facts;
        return {
          ok: true,
          facts: Object.freeze({
            ...common,
            state: control.state,
            reason: control.state === "UNKNOWN" ? "SOURCE_UNKNOWN" : "SOURCE_UNAVAILABLE",
          }),
        };
      };
    },
  };
});

const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const context = Object.freeze({
  cwd: "/fixture-project",
  operatingSystem: "LINUX",
  environment: Object.freeze({
    HOME: "/fixture-home",
    LOCALAPPDATA: null,
    ORCHESTRATION_CONFIG: null,
    ORCHESTRATION_PROJECT_ROOT: null,
    ORCHESTRATION_STATE_ROOT: null,
    XDG_STATE_HOME: null,
  }),
});
const adapterConfiguration = (adapterId = "fixture.branches") => ({
  adapterId,
  adapterVersion: "1.0.0",
  capabilityNames: ["work.read"],
  engineVersion: "0.0.0",
  projectId,
  schemaVersion: "adapter-configuration/v1",
});
function loaded(adapterId = "fixture.branches") {
  const result = resolveConfigurationFromAdmittedPaths(
    {
      environment: context.environment,
      operatingSystem: "LINUX",
      flags: { configPath: null, projectRoot: null, stateRoot: "/fixture-state" },
    },
    {
      adapterId,
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30000,
      maximumSessionMs: 3600000,
      projectId,
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    },
    {
      projectRoot: context.cwd,
      configPath: "/fixture-project/.orchestration/project.json",
      stateRoot: "/fixture-state",
      stateRootDisposition: "ABSENT",
    },
  );
  if (!result.ok) throw new Error("fixture configuration refused");
  return result;
}
function registrations(handler = vi.fn(projectSnapshotCommandHandler)): any[] {
  return commandRegistry.map((row) =>
    "handler" in row
      ? {
          ...structuredClone({ ...row, handler: null }),
          handler: row.family === "project" ? handler : row.handler,
        }
      : structuredClone(row),
  );
}

let root: string;
let path: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "snapshot-cli-canary-"));
  path = join(root, "adapter.json");
});
afterEach(() => {
  control.state = "COMPLETE";
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function run(bytes = canonicalJson(adapterConfiguration()), adapterId = "fixture.branches") {
  await writeFile(path, bytes);
  const handler = vi.fn(projectSnapshotCommandHandler);
  const dispatch = createCommandDispatcher(registrations(handler), async () => loaded(adapterId));
  return { emission: await dispatch(["project", "snapshot", "--adapter", path], context), handler };
}
function diagnostic(
  emission: Awaited<ReturnType<typeof run>>["emission"],
  code: string,
  exitCode: number,
) {
  expect(emission.exitCode).toBe(exitCode);
  expect(emission.stderr).toBe("");
  const record = JSON.parse(emission.stdout);
  expect(parseOrchestrationCommandResult(record).ok).toBe(true);
  expect(record.result).toBeNull();
  expect(record.diagnostics[0].code).toBe(code);
  expect(emission.stdout).toBe(canonicalJson(record));
  expect(emission.stdout).not.toContain("canary");
}

describe("ISS-013 mixed project registration and data-only snapshot command", () => {
  test.each(["fixture.branches", "fixture.queue"])(
    "%s produces fresh complete fixture facts",
    async (adapterId) => {
      const first = await run(canonicalJson(adapterConfiguration(adapterId)), adapterId);
      const second = await run(canonicalJson(adapterConfiguration(adapterId)), adapterId);
      expect(first.handler).toHaveBeenCalledTimes(1);
      expect(first.emission.exitCode).toBe(0);
      const record = JSON.parse(first.emission.stdout);
      expect(parseOrchestrationCommandResult(record).ok).toBe(true);
      expect(first.emission.stdout).toBe(canonicalJson(record));
      expect(record.result.frontier).toHaveLength(adapterId === "fixture.branches" ? 3 : 2);
      expect(record.result.frontierDigest).toBe(canonicalDigest(record.result.frontier));
      expect(record.result.adapterConfigurationDigest).toBe(
        canonicalDigest(adapterConfiguration(adapterId)),
      );
      expect(record.result.observationId).not.toBe(
        JSON.parse(second.emission.stdout).result.observationId,
      );
      expect(first.emission.stdout).not.toMatch(/branch|document|ticket|canary/);
      for (const command of ["config paths", "project plan", "project apply"])
        expect(parseOrchestrationCommandResult({ ...record, command }).ok).toBe(false);
      expect(preparePlaceholderResult("project snapshot", "ISS-013").exitCode).toBe(70);
    },
  );

  test.each([
    ["missing schema", (row: any) => delete row.commands[0].resultSchema],
    ["null schema", (row: any) => (row.commands[0].resultSchema = null)],
    ["future schema", (row: any) => (row.commands[0].resultSchema = "project-facts/v2")],
    ["config schema", (row: any) => (row.commands[0].resultSchema = "configuration-paths/v1")],
    ["missing handler", (row: any) => delete row.handler],
    ["null handler", (row: any) => (row.handler = null)],
    ["downgraded family", (row: any) => (row.implementation = "placeholder")],
    ["changed family", (row: any) => (row.family = "other")],
    ["plan schema", (row: any) => (row.commands[1].resultSchema = "project-facts/v1")],
    ["apply schema", (row: any) => (row.commands[2].resultSchema = "project-facts/v1")],
    ["plan handler", (row: any) => (row.commands[1].handler = row.handler)],
    ["apply handler", (row: any) => (row.commands[2].handler = row.handler)],
  ])("%s cannot downgrade or upgrade an expected row", async (_name, mutate) => {
    const handler = vi.fn(projectSnapshotCommandHandler);
    const rows = registrations(handler);
    mutate(rows.find((row) => row.family === "project"));
    const dispatch = createCommandDispatcher(rows, async () => loaded());
    const emission = await dispatch(["project", "snapshot", "--adapter", path], context);
    diagnostic(emission, "INTERNAL_ERROR", 70);
    expect(handler).not.toHaveBeenCalled();
  });

  test.each([
    ["plan", ["--request", "unused"]],
    ["apply", ["--plan", "unused", "--plan-id", "unused"]],
  ] as const)(
    "%s remains an exact owner placeholder without handler calls",
    async (operation, flags) => {
      const handler = vi.fn(projectSnapshotCommandHandler);
      const dispatch = createCommandDispatcher(registrations(handler), async () => loaded());
      expect(await dispatch(["project", operation, ...flags], context)).toEqual({
        exitCode: 5,
        stderr: "",
        stdout: canonicalJson({
          command: `project ${operation}`,
          diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-013" }],
          outcome: "operation-failed",
          result: null,
          schemaVersion: "orchestration-command-result/v1",
        }),
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  test.each([
    "{",
    "{}\n",
    " " + canonicalJson(adapterConfiguration()),
    canonicalJson(adapterConfiguration()).trimEnd(),
    "\ufeff" + canonicalJson(adapterConfiguration()),
    "x".repeat(65537),
  ])("invalid bytes refuse with fixed diagnostics (%#)", async (bytes) => {
    diagnostic((await run(bytes)).emission, "ADAPTER_CONFIGURATION_REFUSED", 2);
  });
  test("invalid UTF-8, missing files and directories never become snapshots", async () => {
    await writeFile(path, Buffer.from([0xff]));
    const dispatch = createCommandDispatcher(registrations(), async () => loaded());
    diagnostic(
      await dispatch(["project", "snapshot", "--adapter", path], context),
      "ADAPTER_CONFIGURATION_REFUSED",
      2,
    );
    for (const file of [root, join(root, "missing")])
      diagnostic(
        await dispatch(["project", "snapshot", "--adapter", file], context),
        "FILESYSTEM_OPERATION_FAILED",
        5,
      );
  });
  test.each([
    ["binding", { projectId: "018f0f4d-7b2d-7a11-8a2b-000000000099" }, "ADAPTER_BINDING_REFUSED"],
    ["version", { adapterVersion: "2.0.0" }, "ADAPTER_COMPATIBILITY_REFUSED"],
  ])("%s refuses before producing facts", async (_name, change, code) => {
    diagnostic(
      (await run(canonicalJson({ ...adapterConfiguration(), ...change }))).emission,
      code,
      3,
    );
  });
  test.each([
    ["UNKNOWN", "PROJECT_SNAPSHOT_UNKNOWN", 3],
    ["UNAVAILABLE", "PROJECT_SNAPSHOT_UNAVAILABLE", 4],
  ] as const)(
    "%s facts map to their fixed failure and never success",
    async (state, code, exitCode) => {
      control.state = state;
      const output = (await run()).emission;
      diagnostic(output, code, exitCode);
      expect(JSON.parse(output.stdout).outcome).toBe(
        state === "UNKNOWN" ? "authority-unknown" : "external-unavailable",
      );
      expect(
        prepareCommandResult("config paths", {
          ok: false,
          error: {
            code,
            exitCode,
            message:
              state === "UNKNOWN" ? "project snapshot unknown" : "project snapshot unavailable",
            outcome: state === "UNKNOWN" ? "authority-unknown" : "external-unavailable",
          },
        }).exitCode,
      ).toBe(70);
    },
  );
});

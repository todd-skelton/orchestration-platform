import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as c from "@orchestration-platform/contracts";
import {
  createBranchFixtureCurrentPolicy,
  createBranchFixtureSnapshot,
} from "../../../packages/adapter-sdk/src/fixtures.js";
import {
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { consumeEcho } from "../src/echo-consumer.js";
import { echoMapping } from "../src/echo-worker.js";
import { acquireFixtureSession } from "../src/session.js";

const roots: string[] = [],
  leases: Array<{ close(): Promise<unknown> }> = [];
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const os =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  os === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(os);
const clocks = { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 };
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-echo-")));
  roots.push(root);
  const projectRoot = join(root, "project"),
    stateRoot = join(root, "state"),
    configPath = join(projectRoot, ".orchestration", "project.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    c.canonicalJson({
      adapterId: "fixture.branches",
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30000,
      maximumSessionMs: 3600000,
      projectId: uuid(1),
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    }),
  );
  const invocation: ConfigurationLoaderInvocation = {
    cwd: projectRoot,
    operatingSystem: os,
    flags: { configPath, projectRoot, stateRoot },
    environment: {
      HOME: null,
      LOCALAPPDATA: null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: null,
    },
  };
  const configuration = {
    adapterId: "fixture.branches",
    adapterVersion: "1.0.0",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: uuid(1),
    schemaVersion: "adapter-configuration/v1",
  };
  const rows: c.ProjectFrontierRow[] = [
    {
      workId: uuid(4),
      immutableSubjectDigest: "a".repeat(64),
      capabilityNames: ["work.read"],
      readiness: "READY",
    },
  ];
  const raw = () =>
    rows.map((row) => ({
      workId: row.workId,
      branch: "fixture/opaque",
      revisionDigest: row.immutableSubjectDigest,
      blocked: row.readiness !== "READY",
      capabilityNames: row.capabilityNames,
    }));
  const snapshot = vi.fn(createBranchFixtureSnapshot(raw)),
    policy = vi.fn(createBranchFixtureCurrentPolicy(raw));
  const run = () =>
    consumeEcho(adapter, invocation, configuration, snapshot, policy, clocks, uuid(2), uuid(3));
  return {
    root,
    stateRoot,
    invocation,
    rows,
    snapshot,
    policy,
    run,
    claim: join(stateRoot, "session-claim.json"),
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const lease of leases.splice(0)) await lease.close();
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-echo-")))
      throw new Error("cleanup outside echo fixture");
    await rm(root, { recursive: true, force: true });
  }
});
async function manifest(root: string, excluded: string | null = null): Promise<string[]> {
  const entries: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        name = `${prefix}/${entry.name}`;
      if (absolute === excluded) continue;
      if (entry.isDirectory()) {
        entries.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile())
        entries.push(
          `${name}:${createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")}`,
        );
      else throw new Error("unexpected echo fixture path kind");
    }
  }
  await visit(root, "");
  return entries.sort();
}
function parsed<T extends c.ContractRecord>(value: c.ParseResult<T>): T {
  if (!value.ok) throw new Error(value.issues.join(","));
  return value.value;
}
async function record(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const bytes = await readFile(join(f.stateRoot, name)),
    schema = JSON.parse(bytes.toString("utf8")).schemaVersion;
  const value = parsed(c.parseCanonicalContractBytes(schema, bytes));
  expect(c.canonicalJson(value)).toBe(bytes.toString("utf8"));
  expect(bytes.toString("utf8")).not.toContain(f.root);
  return value;
}
async function noEcho(f: Awaited<ReturnType<typeof fixture>>) {
  const names = await readdir(f.stateRoot);
  for (const name of [
    "echo-input.bin",
    "echo-ownership.json",
    "dispatch-plan.json",
    "worker-launch.json",
    "worker-terminal.json",
    "stdout.bin",
    "stderr.bin",
  ])
    expect(names).not.toContain(name);
  expect(names).not.toContain("session-claim.json");
}

test("real fixed echo binds the entire preparation/launch/terminal tuple and retains exact evidence", async () => {
  const f = await fixture(),
    outside = await manifest(f.root, f.stateRoot);
  expect(await f.run()).toMatchObject({
    ok: true,
    acquisition: { outcome: "ACQUIRED" },
    health: { outcome: "HEALTHY", step: null },
    cleanup: "REMOVED",
    worker: { retained: false },
  });
  expect(f.snapshot).toHaveBeenCalledTimes(2);
  expect(f.policy).toHaveBeenCalledTimes(1);
  expect(f.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
    f.policy.mock.invocationCallOrder[0]!,
  );
  expect(f.policy.mock.invocationCallOrder[0]).toBeLessThan(
    f.snapshot.mock.invocationCallOrder[1]!,
  );
  const names = (await readdir(f.stateRoot)).sort();
  expect(names).toEqual(
    [
      "platform-configuration-source.json",
      "configuration-provenance.json",
      "configuration-paths.json",
      "session-acquire-request.json",
      "cycle-request.json",
      "cycle-plan.json",
      "session-receipt.json",
      "session-health.json",
      "adapter-configuration.json",
      "project-facts.json",
      "project-breaker-facts.json",
      "breaker-receipt.json",
      "module-descriptor.json",
      "module-input.json",
      "module-result.json",
      "route-selection.json",
      "worker-host.json",
      "preflight-project-facts.json",
      "project-preflight.json",
      "dispatch-session-health.json",
      "dispatch-plan.json",
      "echo-input.bin",
      "echo-ownership.json",
      "worker-launch.json",
      "worker-terminal.json",
      "stdout.bin",
      "stderr.bin",
    ].sort(),
  );
  for (const name of names.filter((name) => name.endsWith(".json"))) await record(f, name);
  const input = parsed(c.parseModulePlanInput(await record(f, "module-input.json"))),
    action = parsed(c.parseModuleActionPlan(await record(f, "module-result.json")));
  const route = await record(f, "route-selection.json"),
    host = await record(f, "worker-host.json"),
    preflight = await record(f, "project-preflight.json");
  const facts = parsed(c.parseProjectFacts(await record(f, "preflight-project-facts.json"))),
    observation = { kind: "PROJECT", facts };
  expect(facts.observationId).not.toBe(input.projectFacts.observationId);
  expect(facts.observationId).not.toBe(input.policyFacts.observationId);
  expect(facts.observedAt).toBe(input.projectFacts.observedAt);
  if (facts.state !== "COMPLETE") throw new Error("complete preflight required");
  expect(facts.frontier).toEqual(input.projectFacts.frontier);
  expect(host).toEqual(echoMapping[0]);
  expect(
    c.validateProjectPreflightBinding(input, action, [host], route, observation, preflight).ok,
  ).toBe(true);
  expect(
    c.validateBreakerReceiptBinding(
      input.configurationProvenance,
      input.adapterConfiguration,
      input.cycleRequest,
      input.projectFacts,
      input.policyFacts,
      null,
      await record(f, "breaker-receipt.json"),
    ).ok,
  ).toBe(true);
  const cycle = await record(f, "cycle-plan.json"),
    inspection = await record(f, "dispatch-session-health.json"),
    dispatch = parsed(c.parseDispatchPlan(await record(f, "dispatch-plan.json")));
  expect(inspection).toMatchObject({
    outcome: "HEALTHY",
    step: null,
    targetSessionId: uuid(2),
    holderSessionId: uuid(2),
  });
  expect(await record(f, "session-health.json")).toMatchObject({
    step: { ordinal: "1", kind: "session.verify" },
  });
  const rendered = await readFile(join(f.stateRoot, "echo-input.bin"));
  expect(rendered.toString("utf8")).toBe(c.canonicalJson(action.dispatchBrief));
  expect(await record(f, "echo-ownership.json")).toEqual(dispatch);
  expect(
    c.validateDispatchPlanBinding(
      input,
      action,
      [host],
      route,
      observation,
      preflight,
      cycle,
      inspection,
      null,
      rendered,
      dispatch,
    ),
  ).toEqual({ ok: true, value: dispatch });
  const launch = parsed(c.parseWorkerLaunchReceipt(await record(f, "worker-launch.json"))),
    terminal = parsed(c.parseWorkerTerminalReceipt(await record(f, "worker-terminal.json")));
  const stdout = await readFile(join(f.stateRoot, "stdout.bin")),
    stderr = await readFile(join(f.stateRoot, "stderr.bin"));
  expect(stdout).toEqual(rendered);
  expect(stderr).toEqual(Buffer.alloc(0));
  expect(c.validateWorkerLaunchReceiptBinding(dispatch, launch).ok).toBe(true);
  expect(
    c.validateWorkerTerminalReceiptBinding(dispatch, launch, stdout, stderr, terminal),
  ).toEqual({ ok: true, value: terminal });
  expect(launch).toMatchObject({
    outcome: { kind: "LIVE" },
    ownership: "PUBLISHED",
    resources: [{ owner: "HOST", ownerTransactionId: dispatch.attemptId, state: "ALLOCATED" }],
  });
  expect(launch.processes.entries).toHaveLength(1);
  expect(terminal.processes.entries).toEqual([{ ...launch.processes.entries[0], state: "DEAD" }]);
  expect(terminal.outcome).toEqual({ kind: "EXITED", exit: { kind: "EXIT_CODE", value: "0" } });
  expect(terminal.capture).toMatchObject({
    stdout: { kind: "COMPLETE" },
    stderr: { kind: "COMPLETE" },
  });
  expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
  const retained = await manifest(f.root);
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    cleanup: "REMOVED",
  });
  expect(await manifest(f.root)).toEqual(retained);
}, 30000);

test("a held lease refuses concurrent consumption before source callbacks or echo allocation", async () => {
  const f = await fixture(),
    held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!held.ok || !held.lease) throw new Error("holder required");
  leases.push(held.lease);
  const before = await manifest(f.root);
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_NOT_ACQUIRED",
    acquisition: { outcome: "REFUSED", reason: "SESSION_HELD" },
  });
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.policy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
  expect(await held.lease.inspect()).toMatchObject({ outcome: "HEALTHY", step: null });
});

test.each(["malformed", "trip", "no-action", "moved"] as const)(
  "%s stops before any echo allocation",
  async (control) => {
    const f = await fixture(),
      outside = await manifest(f.root, f.stateRoot);
    if (control === "malformed") f.rows[0] = { ...f.rows[0]!, immutableSubjectDigest: "bad" };
    if (control === "trip") f.rows.push({ ...f.rows[0]!, workId: uuid(5), readiness: "NOT_READY" });
    if (control === "no-action") f.rows.splice(0);
    if (control === "moved") {
      const original = f.snapshot.getMockImplementation()!;
      let reads = 0;
      f.snapshot.mockImplementation(async (...input) => {
        if (++reads === 2) f.rows[0] = { ...f.rows[0]!, immutableSubjectDigest: "b".repeat(64) };
        return original(...input);
      });
    }
    const reasons = {
      malformed: "OBSERVATION_REFUSED",
      trip: "BREAKER_NOT_CLOSED",
      "no-action": "NO_ELIGIBLE_ACTION",
      moved: "PREFLIGHT_NOT_ELIGIBLE",
    };
    expect(await f.run()).toMatchObject({
      ok: false,
      reason: reasons[control],
      cleanup: "REMOVED",
    });
    await noEcho(f);
    expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
    if (control === "malformed") {
      expect(f.policy).not.toHaveBeenCalled();
      expect(await readdir(f.stateRoot)).toEqual([]);
    }
    if (control === "trip")
      expect(await record(f, "breaker-receipt.json")).toMatchObject({
        result: { kind: "KNOWN", capabilities: [{ state: "OPEN" }] },
      });
    if (control === "moved")
      expect(await record(f, "project-preflight.json")).toMatchObject({
        outcome: { kind: "REFUSED", reason: "TARGET_CHANGED" },
      });
  },
);

test("foreign input allocation collision retains uncertainty and never overwrites owner evidence", async () => {
  const f = await fixture(),
    original = f.snapshot.getMockImplementation()!;
  let reads = 0;
  f.snapshot.mockImplementation(async (...input) => {
    const value = await original(...input);
    if (++reads === 2) await writeFile(join(f.stateRoot, "echo-input.bin"), "foreign input\n");
    return value;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_RETAINED_UNKNOWN",
    cleanup: "RETAINED_UNKNOWN",
    observation: { ok: false, reason: "WORKER_OBSERVATION_UNPROVEN" },
  });
  expect(await readFile(join(f.stateRoot, "echo-input.bin"), "utf8")).toBe("foreign input\n");
  const names = await readdir(f.stateRoot);
  expect(names).toContain("session-claim.json");
  expect(names).not.toContain("echo-ownership.json");
  for (const name of ["worker-terminal.json", "stdout.bin", "stderr.bin"])
    expect(names).not.toContain(name);
  expect(await record(f, "worker-launch.json")).toMatchObject({
    outcome: { kind: "UNKNOWN", reason: "STARTUP_UNPROVEN" },
    ownership: "UNPUBLISHED",
    resources: [{ state: "UNKNOWN", allocationId: null }],
  });
  const before = await manifest(f.root);
  expect(await f.run()).toMatchObject({ ok: false, reason: "SESSION_NOT_ACQUIRED" });
  expect(await manifest(f.root)).toEqual(before);
});

test("NODE_OPTIONS cannot inject a preload into the real fixed echo child", async () => {
  const f = await fixture(),
    sentinel = join(f.root, "preload.cjs"),
    marker = join(f.root, "preload-executed");
  await writeFile(
    sentinel,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unexpected preload");\n`,
  );
  vi.stubEnv("NODE_OPTIONS", `--require "${sentinel.replaceAll("\\", "/")}"`);
  const outside = await manifest(f.root, f.stateRoot);
  expect(await f.run()).toMatchObject({
    ok: true,
    cleanup: "REMOVED",
    worker: { retained: false },
  });
  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
  expect(await readFile(join(f.stateRoot, "stdout.bin"))).toEqual(
    await readFile(join(f.stateRoot, "echo-input.bin")),
  );
}, 30000);

test.each(["poison", "retain"] as const)(
  "step-null inspection uses the actual handle and preserves %s uncertainty",
  async (mode) => {
    const f = await fixture(),
      held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
    if (!held.ok || !held.lease) throw new Error("holder required");
    leases.push(held.lease);
    const before = await readFile(f.claim),
      health = await held.lease.inspect();
    expect(c.parseSessionHealth(health)).toEqual({ ok: true, value: health });
    expect(health).toMatchObject({
      step: null,
      outcome: "HEALTHY",
      holderSessionId: uuid(20),
      targetSessionId: uuid(20),
    });
    expect(await held.lease.observe()).toMatchObject({
      step: { ordinal: "1" },
      outcome: "HEALTHY",
    });
    if (mode === "poison") await writeFile(f.claim, "{}\n");
    else expect(await held.lease.retain()).toBe("RETAINED_UNKNOWN");
    expect(await held.lease.inspect()).toMatchObject({ step: null, outcome: "UNKNOWN" });
    expect(await held.lease.close()).toBe("RETAINED_UNKNOWN");
    expect(await readFile(f.claim)).toEqual(mode === "poison" ? Buffer.from("{}\n") : before);
  },
);

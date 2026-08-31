import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  canonicalJson,
  computeCycleRequestDigest,
  parseCanonicalContractBytes,
  validateModulePlanBinding,
  validateSessionHealthBinding,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";
import {
  createBranchFixtureCurrentPolicy,
  createBranchFixtureSnapshot,
} from "../../../packages/adapter-sdk/src/fixtures.js";
import {
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { consumeUnderSession } from "../src/session-observer.js";
import { acquireFixtureSession } from "../src/session.js";
import * as fixtureModule from "../src/index.js";

const roots: string[] = [];
const leases: Array<{ close(): Promise<unknown> }> = [];
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const os =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  os === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(os);
const clocks = { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 };
const checkout = resolve(import.meta.dirname, "../../..");

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-joined-")));
  roots.push(root);
  const projectRoot = join(root, "project");
  const stateRoot = join(root, "state");
  const configPath = join(projectRoot, ".orchestration", "project.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    canonicalJson({
      adapterId: "fixture.branches",
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30_000,
      maximumSessionMs: 3_600_000,
      projectId: uuid(1),
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1_000,
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
  const rows: ProjectFrontierRow[] = [
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
  const snapshot = vi.fn(createBranchFixtureSnapshot(raw));
  const policy = vi.fn(createBranchFixtureCurrentPolicy(raw));
  const run = () =>
    consumeUnderSession(
      adapter,
      invocation,
      configuration,
      snapshot,
      policy,
      clocks,
      uuid(2),
      uuid(3),
    );
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
  for (const lease of leases.splice(0)) await lease.close();
  const temporaryParent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (
      dirname(root) !== temporaryParent ||
      !root.startsWith(join(temporaryParent, "walking-joined-"))
    )
      throw new Error("cleanup outside fixture");
    await rm(root, { recursive: true, force: true });
  }
});

async function manifest(root: string, excluded: string | null = null): Promise<string[]> {
  const result: string[] = [];
  async function visit(path: string, name: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        key = `${name}/${entry.name}`;
      if (absolute === excluded) continue;
      if (entry.isDirectory()) {
        result.push(`directory:${key}`);
        await visit(absolute, key);
      } else if (entry.isFile())
        result.push(
          `${key}:${createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")}`,
        );
      else throw new Error("unexpected fixture path kind");
    }
  }
  await visit(root, "");
  return result.sort();
}

async function trackedManifest() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean);
  return Promise.all(
    files.map(
      async (file) =>
        `${file}:${createHash("sha256")
          .update(await readFile(join(checkout, file)))
          .digest("hex")}`,
    ),
  );
}

async function record(f: Awaited<ReturnType<typeof fixture>>, name: string, schema: string) {
  const bytes = await readFile(join(f.stateRoot, name));
  const parsed = parseCanonicalContractBytes(schema, bytes);
  if (!parsed.ok) throw new Error("public record refused");
  expect(canonicalJson(parsed.value)).toBe(bytes.toString("utf8"));
  expect(bytes.toString("utf8")).not.toContain(f.root);
  return parsed.value;
}

test("actual held session joins public cycle intent to observation and planning, then removes only its claim", async () => {
  const f = await fixture();
  const outside = await manifest(f.root, f.stateRoot),
    tracked = await trackedManifest();
  const original = fixtureModule.plan;
  const spy = vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
    const claim = parseCanonicalContractBytes(
      "session-acquire-request/v1",
      await readFile(f.claim),
    );
    expect(claim.ok).toBe(true);
    if (claim.ok) expect(input.cycleRequest.sessionRequest).toEqual(claim.value);
    expect(input.cycleRequest.allowedModuleIds).toEqual([fixtureModule.descriptor.moduleId]);
    return original(input);
  });
  const result = await f.run();
  expect(result).toMatchObject({
    ok: true,
    acquisition: { outcome: "ACQUIRED" },
    health: { outcome: "HEALTHY" },
    cleanup: "REMOVED",
  });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  expect(f.policy).toHaveBeenCalledTimes(1);
  expect(f.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
    f.policy.mock.invocationCallOrder[0]!,
  );
  const names = await readdir(f.stateRoot);
  expect(names).toHaveLength(13);
  expect(names).not.toContain("session-claim.json");
  for (const name of names) {
    const bytes = await readFile(join(f.stateRoot, name));
    const schema = JSON.parse(bytes.toString("utf8")).schemaVersion;
    expect(parseCanonicalContractBytes(schema, bytes).ok).toBe(true);
  }
  const plan = await record(f, "cycle-plan.json", "cycle-plan/v1");
  const request = await record(f, "cycle-request.json", "cycle-request/v1");
  const health = await record(f, "session-health.json", "session-health/v1");
  expect(plan.request).toEqual(request);
  expect(health.step).toMatchObject({
    inputDigest: computeCycleRequestDigest(request),
    ordinal: "1",
  });
  expect(validateSessionHealthBinding(health, plan).ok).toBe(true);
  const input = await record(f, "module-input.json", "module-plan-input/v1");
  expect(input.cycleRequest).toEqual(request);
  expect(
    validateModulePlanBinding(input, await record(f, "module-result.json", "module-plan-result/v1"))
      .ok,
  ).toBe(true);
  expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
  expect(await trackedManifest()).toEqual(tracked);
}, 30_000);

test("a live contender refuses before snapshot, module or output", async () => {
  const f = await fixture();
  const holder = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!holder.ok || !holder.lease) throw new Error("holder required");
  leases.push(holder.lease);
  const before = await manifest(f.root);
  const plan = vi.spyOn(fixtureModule, "plan");
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_NOT_ACQUIRED",
    acquisition: { outcome: "REFUSED", reason: "SESSION_HELD" },
  });
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
  expect((await holder.lease.observe()).outcome).toBe("HEALTHY");
});

test("malformed frontier observation cleans up the owned claim without emitting plan artifacts", async () => {
  const f = await fixture();
  f.rows[0] = { ...f.rows[0]!, immutableSubjectDigest: "bad" };
  const before = await manifest(f.root, f.stateRoot);
  const plan = vi.spyOn(fixtureModule, "plan");
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "OBSERVATION_REFUSED",
    cleanup: "REMOVED",
  });
  expect(plan).not.toHaveBeenCalled();
  expect(f.policy).not.toHaveBeenCalled();
  expect(await readdir(f.stateRoot)).toEqual([]);
  expect(await manifest(f.root, f.stateRoot)).toEqual(before);
});

test("claim mutation across the actual module await retains uncertainty and writes no observer record", async () => {
  const f = await fixture();
  const original = fixtureModule.plan;
  vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
    const result = await original(input);
    await writeFile(f.claim, "{}\n");
    return result;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_RETAINED_UNKNOWN",
    health: { outcome: "UNKNOWN" },
    cleanup: "RETAINED_UNKNOWN",
  });
  expect(await readdir(f.stateRoot)).toEqual(["session-claim.json"]);
  expect(await readFile(f.claim, "utf8")).toBe("{}\n");
});

test("no-action joins the same session; repeated output never overwrites or masquerades as replay", async () => {
  const f = await fixture();
  f.rows[0] = { ...f.rows[0]!, readiness: "NOT_READY" };
  expect(await f.run()).toMatchObject({ ok: true, cleanup: "REMOVED" });
  expect(await record(f, "module-result.json", "module-plan-result/v1")).toMatchObject({
    outcome: "NO_ACTION",
    reason: "NO_ELIGIBLE_ACTION",
  });
  expect(await readdir(f.stateRoot)).toHaveLength(11);
  const before = await manifest(f.root);
  expect(await f.run()).toMatchObject({ ok: false, reason: "WRITE_REFUSED", cleanup: "REMOVED" });
  expect(await manifest(f.root)).toEqual(before);
});

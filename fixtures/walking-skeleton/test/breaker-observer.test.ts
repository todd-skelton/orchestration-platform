import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  canonicalJson,
  computeCycleRequestDigest,
  canonicalDigest,
  parseCanonicalContractBytes,
  validateBreakerReceiptBinding,
  validateSessionHealthBinding,
  validateSessionReceiptBinding,
  type ContractRecord,
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
import { consumeInitialBreaker } from "../src/breaker-observer.js";
import { acquireFixtureSession } from "../src/session.js";
import * as fixtureModule from "../src/index.js";

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
const files = [
  "adapter-configuration.json",
  "breaker-receipt.json",
  "configuration.json",
  "cycle-plan.json",
  "cycle-request.json",
  "project-breaker-facts.json",
  "project-facts.json",
  "session-acquisition.json",
  "session-health.json",
];

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-breaker-")));
  roots.push(root);
  const projectRoot = join(root, "project"),
    stateRoot = join(root, "state");
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
  const snapshot = vi.fn(createBranchFixtureSnapshot(raw)),
    policy = vi.fn(createBranchFixtureCurrentPolicy(raw));
  const run = () =>
    consumeInitialBreaker(
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
    configPath,
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
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-breaker-")))
      throw new Error("cleanup outside breaker fixture");
    await rm(root, { recursive: true, force: true });
  }
});

async function manifest(root: string, excluded: string | null = null): Promise<string[]> {
  const result: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        name = `${prefix}/${entry.name}`;
      if (absolute === excluded) continue;
      if (entry.isDirectory()) {
        result.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile())
        result.push(
          `${name}:${createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")}`,
        );
      else throw new Error("unexpected fixture entry");
    }
  }
  await visit(root, "");
  return result.sort();
}

async function records(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await readdir(f.stateRoot)).sort()).toEqual(files);
  const result: Record<string, ContractRecord> = {};
  for (const name of files) {
    const bytes = await readFile(join(f.stateRoot, name));
    const parsed = parseCanonicalContractBytes(
      JSON.parse(bytes.toString("utf8")).schemaVersion,
      bytes,
    );
    if (!parsed.ok) throw new Error(`public record refused: ${name}`);
    expect(canonicalJson(parsed.value)).toBe(bytes.toString("utf8"));
    expect(bytes.toString("utf8")).not.toContain(f.root);
    result[name] = parsed.value;
  }
  return result;
}

test.each(["READY", "NOT_READY"] as const)(
  "actual fresh root binds initial policy %s without module planning",
  async (readiness) => {
    const f = await fixture();
    f.rows[0] = { ...f.rows[0]!, readiness };
    const before = await manifest(f.root, f.stateRoot),
      plan = vi.spyOn(fixtureModule, "plan");
    expect(await f.run()).toMatchObject({
      ok: true,
      acquisition: { outcome: "ACQUIRED" },
      health: { outcome: "HEALTHY" },
      cleanup: "REMOVED",
    });
    expect(plan).not.toHaveBeenCalled();
    expect(f.snapshot).toHaveBeenCalledTimes(1);
    expect(f.policy).toHaveBeenCalledTimes(1);
    expect(f.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      f.policy.mock.invocationCallOrder[0]!,
    );
    const r = await records(f),
      cycle = r["cycle-request.json"]!,
      breaker = r["breaker-receipt.json"]!;
    expect(r["cycle-plan.json"]!.request).toEqual(cycle);
    expect(
      validateSessionReceiptBinding(
        r["session-acquisition.json"],
        "ACQUIRE",
        uuid(2),
        cycle.sessionRequest,
      ).ok,
    ).toBe(true);
    expect(validateSessionHealthBinding(r["session-health.json"], r["cycle-plan.json"]).ok).toBe(
      true,
    );
    expect(
      validateBreakerReceiptBinding(
        r["configuration.json"],
        r["adapter-configuration.json"],
        cycle,
        r["project-facts.json"],
        r["project-breaker-facts.json"],
        null,
        breaker,
      ),
    ).toEqual({ ok: true, value: breaker });
    expect(breaker.operations).toEqual([]);
    expect(breaker.priorReceiptDigest).toBeNull();
    expect(breaker.result).toEqual({
      kind: "KNOWN",
      capabilities: [
        {
          capabilityName: "work.read",
          state: readiness === "READY" ? "CLOSED" : "OPEN",
          ...(readiness === "READY"
            ? {}
            : {
                opening: {
                  cycleRequestDigest: computeCycleRequestDigest(cycle),
                  policyFactsDigest: canonicalDigest(r["project-breaker-facts.json"]),
                },
              }),
        },
      ],
    });
    expect(await manifest(f.root, f.stateRoot)).toEqual(before);
    const retained = await manifest(f.root);
    expect(await f.run()).toMatchObject({
      ok: false,
      reason: "HISTORY_UNPROVEN",
      cleanup: "REMOVED",
    });
    expect(await manifest(f.root)).toEqual(retained);
  },
);

test.each([false, true])(
  "pre-existing root never proves genesis (nonempty=%s)",
  async (nonempty) => {
    const f = await fixture();
    await mkdir(f.stateRoot);
    if (nonempty) await writeFile(join(f.stateRoot, "foreign.txt"), "retain foreign evidence\n");
    const before = await manifest(f.root),
      plan = vi.spyOn(fixtureModule, "plan");
    expect(await f.run()).toMatchObject({
      ok: false,
      reason: "HISTORY_UNPROVEN",
      cleanup: "REMOVED",
    });
    expect(plan).not.toHaveBeenCalled();
    expect(await manifest(f.root)).toEqual(before);
  },
);

test("live holder refuses a contender before either SDK callback", async () => {
  const f = await fixture(),
    held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!held.ok || !held.lease) throw new Error("holder required");
  leases.push(held.lease);
  const before = await manifest(f.root),
    plan = vi.spyOn(fixtureModule, "plan");
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_NOT_ACQUIRED",
    acquisition: { outcome: "REFUSED", reason: "SESSION_HELD" },
  });
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.policy).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
  expect((await held.lease.observe()).outcome).toBe("HEALTHY");
});

test("malformed frontier refuses without policy or output and removes its owned claim", async () => {
  const f = await fixture(),
    plan = vi.spyOn(fixtureModule, "plan");
  f.rows[0] = { ...f.rows[0]!, immutableSubjectDigest: "bad" };
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "OBSERVATION_REFUSED",
    cleanup: "REMOVED",
  });
  expect(f.policy).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
  expect(await readdir(f.stateRoot)).toEqual([]);
});

test("claim mutation across the real policy await retains uncertainty and emits no record", async () => {
  const f = await fixture(),
    original = f.policy.getMockImplementation()!;
  f.policy.mockImplementation(async (...input) => {
    const observed = await original(...input);
    await writeFile(f.claim, "{}\n");
    return observed;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_RETAINED_UNKNOWN",
    cleanup: "RETAINED_UNKNOWN",
  });
  expect(await readdir(f.stateRoot)).toEqual(["session-claim.json"]);
  expect(await readFile(f.claim, "utf8")).toBe("{}\n");
});

test("a foreign entry during SDK observation prevents claim-only genesis and is preserved", async () => {
  const f = await fixture(),
    original = f.policy.getMockImplementation()!;
  f.policy.mockImplementation(async (...input) => {
    const observed = await original(...input);
    await writeFile(join(f.stateRoot, "foreign.txt"), "unadmitted history\n");
    return observed;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    cleanup: "REMOVED",
  });
  expect(await readdir(f.stateRoot)).toEqual(["foreign.txt"]);
  expect(await readFile(join(f.stateRoot, "foreign.txt"), "utf8")).toBe("unadmitted history\n");
});

test("private initial-root evidence is one-shot, including overlapping calls and reacquisition", async () => {
  const f = await fixture(),
    held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!held.ok || !held.lease) throw new Error("holder required");
  leases.push(held.lease);
  const [first, repeated] = await Promise.all([
    held.lease.observeInitialRoot(),
    held.lease.observeInitialRoot(),
  ]);
  expect(first).toMatchObject({ ok: true, health: { outcome: "HEALTHY" } });
  expect(repeated).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    health: { outcome: "HEALTHY" },
  });
  expect(await held.lease.close()).toBe("REMOVED");
  expect(await readdir(f.stateRoot)).toEqual([]);
  const next = await acquireFixtureSession(adapter, f.invocation, uuid(22), uuid(23), clocks);
  if (!next.ok || !next.lease) throw new Error("next holder required");
  leases.push(next.lease);
  expect(await next.lease.observeInitialRoot()).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    health: { outcome: "HEALTHY" },
  });
  expect(await next.lease.close()).toBe("REMOVED");
});

test("a refused initial-root attempt stays consumed after foreign evidence is removed", async () => {
  const f = await fixture(),
    held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!held.ok || !held.lease) throw new Error("holder required");
  leases.push(held.lease);
  const foreign = join(f.stateRoot, "foreign.txt");
  await writeFile(foreign, "unadmitted history\n");
  expect(await held.lease.observeInitialRoot()).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    health: { outcome: "HEALTHY" },
  });
  await rm(foreign);
  expect(await readdir(f.stateRoot)).toEqual(["session-claim.json"]);
  expect(await held.lease.observeInitialRoot()).toMatchObject({
    ok: false,
    reason: "HISTORY_UNPROVEN",
    health: { outcome: "HEALTHY" },
  });
  expect(await held.lease.close()).toBe("REMOVED");
  expect(await readdir(f.stateRoot)).toEqual([]);
});

test("root mutation across the SDK await is retained, or actual Windows denial leaves the owned root intact", async () => {
  const f = await fixture(),
    originalPolicy = f.policy.getMockImplementation()!,
    moved = join(f.root, "state-original");
  let denied = false;
  let claimBytes: Buffer = Buffer.alloc(0);
  f.policy.mockImplementation(async (...input) => {
    const observed = await originalPolicy(...input),
      identity = await lstat(f.stateRoot, { bigint: true });
    claimBytes = await readFile(f.claim);
    try {
      await rename(f.stateRoot, moved);
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM")
        throw error;
      expect(error).toMatchObject({
        code: "EPERM",
        syscall: "rename",
        path: f.stateRoot,
        dest: moved,
      });
      denied = true;
      expect(await lstat(f.stateRoot, { bigint: true })).toMatchObject({
        dev: identity.dev,
        ino: identity.ino,
        mode: identity.mode,
      });
      expect(await readFile(f.claim)).toEqual(claimBytes);
      await expect(lstat(moved)).rejects.toMatchObject({ code: "ENOENT" });
      return observed;
    }
    await mkdir(f.stateRoot);
    await writeFile(f.claim, "foreign replacement\n");
    return observed;
  });
  const result = await f.run();
  if (denied) {
    expect(result).toMatchObject({ ok: true, health: { outcome: "HEALTHY" }, cleanup: "REMOVED" });
    await records(f);
  } else {
    expect(result).toMatchObject({
      ok: false,
      reason: "SESSION_RETAINED_UNKNOWN",
      cleanup: "RETAINED_UNKNOWN",
    });
    expect(await readdir(f.stateRoot)).toEqual(["session-claim.json"]);
    expect(await readFile(f.claim, "utf8")).toBe("foreign replacement\n");
    expect(await readFile(join(moved, "session-claim.json"))).toEqual(claimBytes);
  }
});

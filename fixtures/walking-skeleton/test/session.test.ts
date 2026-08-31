import { execFileSync } from "node:child_process";
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
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  canonicalJson,
  computeCycleRequestDigest,
  parseCanonicalContractBytes,
  serializeContract,
  validateCyclePlanBinding,
  validateSessionHealthBinding,
} from "@orchestration-platform/contracts";
import {
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { acquireFixtureSession } from "../src/session.js";

const checkout = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
const sessions: Array<{ close(): Promise<unknown> }> = [];
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const operatingSystem =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  operatingSystem === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(operatingSystem);
const source = {
  schemaVersion: "platform-configuration-source/v1",
  adapterId: "fixture.branches",
  projectId: uuid(1),
  capabilityNames: ["work.read"],
  stateRoot: null,
  leaseFreshnessMs: 30_000,
  maximumSessionMs: 3_600_000,
  wallClockSkewMs: 1_000,
};

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-session-")));
  roots.push(root);
  const project = join(root, "project");
  const configPath = join(project, ".orchestration", "project.json");
  const state = join(root, "state");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, canonicalJson(source));
  const invocation: ConfigurationLoaderInvocation = {
    cwd: project,
    operatingSystem,
    flags: { configPath, projectRoot: project, stateRoot: state },
    environment: {
      HOME: null,
      LOCALAPPDATA: null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: null,
    },
  };
  const clocks = { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 };
  const acquire = async (session = 2, cycle = 3) => {
    const result = await acquireFixtureSession(
      adapter,
      invocation,
      uuid(session),
      uuid(cycle),
      clocks,
    );
    if (result.ok && result.lease) sessions.push(result.lease);
    return result;
  };
  return {
    root,
    state,
    configPath,
    invocation,
    clocks,
    acquire,
    claim: join(state, "session-claim.json"),
  };
}

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  const temporaryParent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (
      dirname(root) !== temporaryParent ||
      !root.startsWith(join(temporaryParent, "walking-session-"))
    )
      throw new Error("session test cleanup escaped its disposable root");
    await rm(root, { recursive: true, force: true });
  }
});

async function acquired(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.acquire();
  if (!result.ok || !result.lease) throw new Error("expected an actual fixture claim");
  expect(result.acquisition.outcome).toBe("ACQUIRED");
  return { ...result, lease: result.lease };
}
async function outsideManifest(f: Awaited<ReturnType<typeof fixture>>) {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean)
    .map((name) => join(checkout, name));
  files.push(f.configPath);
  return {
    entries: (await readdir(f.root)).filter((name) => name !== "state").sort(),
    files: await Promise.all(
      files.map(
        async (file) =>
          `${file}:${createHash("sha256")
            .update(await readFile(file))
            .digest("hex")}`,
      ),
    ),
  };
}

test("actual claim binds loader preimages, public entry records, live step 1, and bounded writes", async () => {
  const f = await fixture();
  const before = await outsideManifest(f);
  const result = await acquired(f);
  expect(result.evidence.map(({ schema }) => schema)).toEqual([
    "platform-configuration-source/v1",
    "configuration-provenance/v1",
    "configuration-paths/v1",
    "session-acquire-request/v1",
    "cycle-request/v1",
    "cycle-plan/v1",
    "session-receipt/v1",
  ]);
  for (const record of result.evidence) {
    expect(parseCanonicalContractBytes(record.schema, record.bytes)).toEqual({
      ok: true,
      value: record.value,
    });
    expect(Buffer.from(record.bytes).toString()).not.toContain(f.root);
  }
  expect(await readFile(f.claim)).toEqual(Buffer.from(result.evidence[3]!.bytes));
  expect(await readdir(f.state)).toEqual(["session-claim.json"]);
  const health = await result.lease.observe();
  expect(health).toMatchObject({
    outcome: "HEALTHY",
    holderSessionId: uuid(2),
    targetSessionId: uuid(2),
    step: {
      cycleId: uuid(3),
      ordinal: "1",
      inputDigest: computeCycleRequestDigest(result.plan.request),
      predecessorJournalDigest: null,
    },
  });
  expect(validateSessionHealthBinding(health, result.plan).ok).toBe(true);
  const encoded = serializeContract("session-health/v1", health);
  if (!encoded.ok) throw new Error("expected public health bytes");
  expect(parseCanonicalContractBytes("session-health/v1", encoded.bytes)).toEqual({
    ok: true,
    value: health,
  });
  for (const field of [
    "configurationSourceDigest",
    "configurationProvenanceDigest",
    "configurationPathsDigest",
  ] as const) {
    const moved = {
      ...result.plan,
      request: {
        ...result.plan.request,
        sessionRequest: { ...result.plan.request.sessionRequest, [field]: "f".repeat(64) },
      },
    };
    const encodedPlan = serializeContract("cycle-plan/v1", moved);
    if (!encodedPlan.ok) throw new Error("mutant must be structurally valid");
    expect(
      validateCyclePlanBinding(
        moved,
        result.evidence[0]!.value,
        result.evidence[1]!.value,
        result.evidence[2]!.value,
        [],
        encodedPlan.digest,
      ).ok,
    ).toBe(false);
  }
  expect(await result.lease.close()).toBe("REMOVED");
  expect(await readdir(f.state)).toEqual([]);
  expect(await outsideManifest(f)).toEqual(before);
});

test("second holder receives typed refusal without changing the actual holder", async () => {
  const f = await fixture();
  const owner = await acquired(f);
  const bytes = await readFile(f.claim);
  const contender = await f.acquire(4, 5);
  if (!contender.ok) throw new Error("valid contender must receive an operation receipt");
  expect(contender.acquisition).toMatchObject({
    outcome: "REFUSED",
    reason: "SESSION_HELD",
    sessionId: uuid(4),
  });
  expect(contender.lease).toBeNull();
  expect(await readFile(f.claim)).toEqual(bytes);
  expect((await owner.lease.observe()).outcome).toBe("HEALTHY");
});

test.each(["malformed", "replacement", "missing", "directory", "configuration"])(
  "%s observation poisons the claim and retains uncertain state instead of reacquiring or deleting",
  async (change) => {
    const f = await fixture();
    const owner = await acquired(f);
    const bytes = await readFile(f.claim);
    if (change === "malformed") await writeFile(f.claim, "not canonical JSON");
    if (change === "replacement") {
      await rename(f.claim, `${f.claim}.original`);
      await writeFile(f.claim, bytes);
    }
    if (change === "missing") await rm(f.claim);
    if (change === "directory") {
      await rm(f.claim);
      await mkdir(f.claim);
    }
    if (change === "configuration")
      await writeFile(f.configPath, canonicalJson({ ...source, wallClockSkewMs: 999 }));
    expect(await owner.lease.observe()).toMatchObject({
      outcome: "UNKNOWN",
      holderSessionId: null,
      leaseState: "UNKNOWN",
    });
    // Old successful receipts remain evidence only; the retained handle never restores health.
    expect(owner.acquisition.outcome).toBe("ACQUIRED");
    expect(await owner.lease.close()).toBe("RETAINED_UNKNOWN");
    if (!["missing", "directory"].includes(change))
      expect(await readFile(f.claim)).toEqual(
        change === "malformed" ? Buffer.from("not canonical JSON") : bytes,
      );
  },
);

test("root replacement poisons ownership, or an actual Windows denial preserves the unchanged holder", async () => {
  const f = await fixture();
  const owner = await acquired(f);
  const bytes = await readFile(f.claim);
  const rootBefore = await lstat(f.state, { bigint: true });
  const claimBefore = await lstat(f.claim, { bigint: true });
  const original = `${f.state}-original`;
  try {
    await rename(f.state, original);
  } catch (error) {
    // Windows can deny moving a directory with this retained claim open. That is
    // an observed no-mutation outcome, not an executed replacement or a skipped test.
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM")
      throw error;
    expect(error).toMatchObject({
      code: "EPERM",
      syscall: "rename",
      path: f.state,
      dest: original,
    });
    expect(await lstat(f.state, { bigint: true })).toMatchObject({
      dev: rootBefore.dev,
      ino: rootBefore.ino,
      mode: rootBefore.mode,
    });
    expect(await lstat(f.claim, { bigint: true })).toMatchObject({
      dev: claimBefore.dev,
      ino: claimBefore.ino,
      mode: claimBefore.mode,
    });
    expect(await readdir(f.state)).toEqual(["session-claim.json"]);
    expect(await readFile(f.claim)).toEqual(bytes);
    await expect(lstat(original)).rejects.toHaveProperty("code", "ENOENT");
    expect(await owner.lease.observe()).toMatchObject({
      outcome: "HEALTHY",
      leaseState: "HELD_FRESH",
      holderSessionId: uuid(2),
      targetSessionId: uuid(2),
    });
    expect(await owner.lease.close()).toBe("REMOVED");
    expect(await readdir(f.state)).toEqual([]);
    return;
  }
  // POSIX must reach this executed replacement; Windows does too if rename succeeds.
  await mkdir(f.state);
  await writeFile(f.claim, bytes);
  expect(await owner.lease.observe()).toMatchObject({
    outcome: "UNKNOWN",
    holderSessionId: null,
    leaseState: "UNKNOWN",
  });
  expect(await owner.lease.close()).toBe("RETAINED_UNKNOWN");
  expect(await readFile(f.claim)).toEqual(bytes);
  expect(await readFile(join(original, "session-claim.json"))).toEqual(bytes);
});

test("a malformed existing claim is UNKNOWN, never a known holder or permission to remove it", async () => {
  const f = await fixture();
  await mkdir(f.state);
  await writeFile(f.claim, "{}");
  const result = await f.acquire();
  if (!result.ok) throw new Error("expected bound operation evidence");
  expect(result.acquisition).toMatchObject({ outcome: "UNKNOWN", reason: "IDENTITY_CONFLICT" });
  expect(result.lease).toBeNull();
  expect(await readFile(f.claim, "utf8")).toBe("{}");
});

test("unavailable clock refuses acquisition before state creation", async () => {
  const f = await fixture();
  f.clocks.monotonicNow = () => NaN;
  const result = await f.acquire();
  if (!result.ok) throw new Error("expected valid bound unknown receipt");
  expect(result.acquisition).toMatchObject({ outcome: "UNKNOWN", reason: "MONOTONIC_UNAVAILABLE" });
  await expect(readdir(f.state)).rejects.toHaveProperty("code", "ENOENT");
});

test.each(["unavailable", "rollback", "skew", "expired"])(
  "%s clock never refreshes the fixture lease",
  async (kind) => {
    const f = await fixture();
    const owner = await acquired(f);
    if (kind === "unavailable")
      f.clocks.wallNow = () => {
        throw new Error("clock unavailable");
      };
    if (kind === "rollback") f.clocks.wallNow = () => "2026-08-31T00:59:59.000Z";
    if (kind === "skew") f.clocks.wallNow = () => "2026-08-31T01:00:02.000Z";
    if (kind === "expired") {
      f.clocks.wallNow = () => "2026-08-31T01:00:30.000Z";
      f.clocks.monotonicNow = () => 30_000;
    }
    expect(await owner.lease.observe()).toMatchObject(
      kind === "expired"
        ? { outcome: "REFUSED", reason: "FRESHNESS_EXPIRED", leaseState: "HELD_STALE" }
        : { outcome: "UNKNOWN", leaseState: "UNKNOWN" },
    );
    if (kind === "expired") {
      f.clocks.wallNow = () => "2026-08-31T01:00:00.000Z";
      f.clocks.monotonicNow = () => 0;
      expect(await owner.lease.observe()).toMatchObject({
        outcome: "UNKNOWN",
        reason: "CLOCK_ROLLBACK",
      });
    }
    if (kind !== "expired") expect(await owner.lease.close()).toBe("RETAINED_UNKNOWN");
  },
);

test("invalid entry identities or configuration produce no acquisition and no writes", async () => {
  const f = await fixture();
  const invalid = await acquireFixtureSession(
    adapter,
    f.invocation,
    "not-a-session",
    uuid(3),
    f.clocks,
  );
  expect(invalid.ok).toBe(false);
  await expect(readdir(f.state)).rejects.toHaveProperty("code", "ENOENT");
  await writeFile(f.configPath, "not configuration");
  expect((await f.acquire()).ok).toBe(false);
  await expect(readdir(f.state)).rejects.toHaveProperty("code", "ENOENT");
});

test("a state root in this checkout is refused before any fixture write", async () => {
  const f = await fixture();
  const before = await outsideManifest(f);
  const result = await acquireFixtureSession(
    adapter,
    { ...f.invocation, flags: { ...f.invocation.flags, stateRoot: checkout } },
    uuid(2),
    uuid(3),
    f.clocks,
  );
  if (!result.ok) throw new Error("expected a bound unknown operation");
  expect(result.acquisition).toMatchObject({ outcome: "UNKNOWN", reason: "IDENTITY_CONFLICT" });
  expect(result.lease).toBeNull();
  expect(await outsideManifest(f)).toEqual(before);
});

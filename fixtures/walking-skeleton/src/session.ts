import { type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  canonicalDigest,
  computeCyclePlanDigest,
  computeCycleRequestDigest,
  computeSessionAcquireRequestDigest,
  isCanonicalTimestamp,
  parseCanonicalContractBytes,
  parseCyclePlan,
  serializeContract,
  snapshotClosedArray,
  validateCyclePlanBinding,
  validateSessionAcquireRequestBinding,
  validateSessionHealthBinding,
  validateSessionReceiptBinding,
  type ContractRecord,
  type SessionHealth,
} from "@orchestration-platform/contracts";
import {
  createConfigurationLoader,
  type ConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import {
  projectConfigurationPaths,
  projectConfigurationProvenance,
} from "../../../packages/config/src/resolver.js";
import { descriptor } from "./index.js";

type Reason =
  | "STATE_UNREADABLE"
  | "IDENTITY_CONFLICT"
  | "CLOCK_ROLLBACK"
  | "CLOCK_SKEW"
  | "MONOTONIC_UNAVAILABLE";
export interface FixtureSessionClocks {
  wallNow(): string;
  monotonicNow(): number;
}
class UnknownObservation extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
const unknown = (error: unknown): Reason =>
  error instanceof UnknownObservation ? error.reason : "STATE_UNREADABLE";
const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;

function encoded(schema: string, value: unknown) {
  const serialized = serializeContract(schema, value);
  if (!serialized.ok) throw new Error(serialized.issues.join(","));
  const parsed = parseCanonicalContractBytes(schema, serialized.bytes);
  if (!parsed.ok) throw new Error(parsed.issues.join(","));
  return { schema, bytes: serialized.bytes, value: parsed.value };
}

// Explicit fixture paths only. Bracket the real loader's read with identical source bytes;
// this is isolated/cooperative fixture evidence, not hostile-writer atomic admission.
async function context(
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
) {
  if (!invocation.flags.configPath) throw new UnknownObservation("STATE_UNREADABLE");
  const before = await readFile(invocation.flags.configPath);
  const loaded = await createConfigurationLoader(adapter)(invocation);
  if (!loaded.ok) throw new UnknownObservation("STATE_UNREADABLE");
  const after = await readFile(loaded.value.configPath);
  if (!before.equals(after)) throw new UnknownObservation("IDENTITY_CONFLICT");
  const source = parseCanonicalContractBytes("platform-configuration-source/v1", after);
  const provenance = projectConfigurationProvenance(loaded.value);
  const paths = projectConfigurationPaths(loaded.value);
  if (
    !source.ok ||
    !provenance.ok ||
    !paths.ok ||
    provenance.value.adapterId !== "fixture.branches"
  )
    throw new UnknownObservation("IDENTITY_CONFLICT");
  return {
    loaded: loaded.value,
    source: source.value,
    provenance: provenance.value,
    paths: paths.value,
  };
}

function clock(clocks: FixtureSessionClocks) {
  let mono: number;
  try {
    mono = clocks.monotonicNow();
  } catch {
    throw new UnknownObservation("MONOTONIC_UNAVAILABLE");
  }
  if (!Number.isFinite(mono) || mono < 0) throw new UnknownObservation("MONOTONIC_UNAVAILABLE");
  let wall: string;
  try {
    wall = clocks.wallNow();
  } catch {
    throw new UnknownObservation("CLOCK_SKEW");
  }
  if (!isCanonicalTimestamp(wall) || wall.startsWith("0000-"))
    throw new UnknownObservation("CLOCK_SKEW");
  return { mono, wall };
}

async function claimBytes(handle: FileHandle): Promise<Buffer> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 4096n)
    throw new UnknownObservation("IDENTITY_CONFLICT");
  const buffer = Buffer.alloc(4097);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const after = await handle.stat({ bigint: true });
  if (!sameFile(before, after) || before.size !== after.size || BigInt(bytesRead) !== before.size)
    throw new UnknownObservation("IDENTITY_CONFLICT");
  return buffer.subarray(0, bytesRead);
}

/** Private fixture only: one create-once claim; no takeover, renewal, production lease or cycle. */
export async function acquireFixtureSession(
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  sessionId: string,
  cycleId: string,
  clocks: FixtureSessionClocks,
  allowedModuleIds: readonly string[] = [],
) {
  const modules = snapshotClosedArray(allowedModuleIds);
  if (!modules.ok) return modules;
  // Detach the caller's invocation before asynchronous work; it is still validated by the loader.
  const retained = {
    ...invocation,
    flags: { ...invocation.flags },
    environment: { ...invocation.environment },
  };
  let admitted: Awaited<ReturnType<typeof context>>;
  try {
    admitted = await context(adapter, retained);
  } catch (error) {
    return { ok: false as const, issues: [`fixture:configuration:${unknown(error)}`] };
  }
  const request = validateSessionAcquireRequestBinding(
    {
      schemaVersion: "session-acquire-request/v1",
      sessionId,
      configurationSourceDigest: canonicalDigest(admitted.source),
      configurationProvenanceDigest: canonicalDigest(admitted.provenance),
      configurationPathsDigest: canonicalDigest(admitted.paths),
    },
    admitted.source,
    admitted.provenance,
    admitted.paths,
  );
  if (!request.ok) return request;
  const acquisitionRequest = request.value;
  const parsedPlan = parseCyclePlan({
    schemaVersion: "cycle-plan/v1",
    protocol: "routine-cycle/v1",
    request: {
      schemaVersion: "cycle-request/v1",
      cycleId,
      sessionRequest: acquisitionRequest,
      adapterId: "fixture.branches",
      allowedModuleIds: modules.value,
    },
  });
  if (!parsedPlan.ok) return parsedPlan;
  // Fixed fixture source census; the default separate session still requests no module.
  const plan = validateCyclePlanBinding(
    parsedPlan.value,
    admitted.source,
    admitted.provenance,
    admitted.paths,
    [descriptor.moduleId],
    computeCyclePlanDigest(parsedPlan.value),
  );
  if (!plan.ok) return plan;
  const admittedPlan = plan.value;
  const evidence = [
    encoded("platform-configuration-source/v1", admitted.source),
    encoded("configuration-provenance/v1", admitted.provenance),
    encoded("configuration-paths/v1", admitted.paths),
    encoded("session-acquire-request/v1", acquisitionRequest),
    encoded("cycle-request/v1", plan.value.request),
    encoded("cycle-plan/v1", plan.value),
  ];
  const receipt = (
    outcome: "ACQUIRED" | "REFUSED" | "UNKNOWN",
    reason: Reason | "SESSION_HELD" | null,
    recordedAt: string | null,
  ) => {
    const result = validateSessionReceiptBinding(
      {
        schemaVersion: "session-receipt/v1",
        acquireRequestDigest: computeSessionAcquireRequestDigest(acquisitionRequest),
        operation: "ACQUIRE",
        sessionId,
        outcome,
        reason,
        recordedAt,
      },
      "ACQUIRE",
      sessionId,
      acquisitionRequest,
    );
    if (!result.ok) throw new Error(result.issues.join(","));
    evidence.push(encoded("session-receipt/v1", result.value));
    return result.value;
  };
  const root = admitted.loaded.stateRoot;
  const path = join(root, "session-claim.json");
  const bytes = Buffer.from(evidence[3]!.bytes);
  let handle: FileHandle | undefined;
  let rootIdentity: BigIntStats;
  let claimIdentity: BigIntStats;
  let started: ReturnType<typeof clock>;
  let poisoned: Reason | null = null;
  let closed = false;
  let freshRoot = false;
  let initialEntries: readonly string[] = [];
  let initialObserved = false;

  async function physical() {
    if (closed || !handle) throw new UnknownObservation("IDENTITY_CONFLICT");
    const currentRoot = await lstat(root, { bigint: true });
    const currentClaim = await lstat(path, { bigint: true });
    if (
      !sameFile(rootIdentity, currentRoot) ||
      (await realpath(root)) !== root ||
      !currentClaim.isFile() ||
      !sameFile(claimIdentity, currentClaim) ||
      !sameFile(claimIdentity, await handle.stat({ bigint: true })) ||
      !(await claimBytes(handle)).equals(bytes)
    )
      throw new UnknownObservation("IDENTITY_CONFLICT");
  }
  async function unchanged() {
    await physical();
    const current = await context(adapter, retained);
    if (
      !validateSessionAcquireRequestBinding(
        acquisitionRequest,
        current.source,
        current.provenance,
        current.paths,
      ).ok
    )
      throw new UnknownObservation("IDENTITY_CONFLICT");
    await physical();
  }
  try {
    const fromCheckout = relative(resolve(import.meta.dirname, "../../.."), root);
    if (
      fromCheckout === "" ||
      (fromCheckout !== ".." && !fromCheckout.startsWith(`..${sep}`) && !isAbsolute(fromCheckout))
    )
      throw new UnknownObservation("IDENTITY_CONFLICT");
    started = clock(clocks);
    try {
      await mkdir(root);
      freshRoot = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    rootIdentity = await lstat(root, { bigint: true });
    initialEntries = Object.freeze(await readdir(root));
    if (
      !rootIdentity.isDirectory() ||
      rootIdentity.isSymbolicLink() ||
      (await realpath(root)) !== root
    )
      throw new UnknownObservation("IDENTITY_CONFLICT");
    try {
      handle = await open(path, "wx+", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await lstat(path, { bigint: true });
      if (!existing.isFile()) throw new UnknownObservation("IDENTITY_CONFLICT");
      const observer = await open(path, "r");
      try {
        if (!sameFile(existing, await observer.stat({ bigint: true })))
          throw new UnknownObservation("IDENTITY_CONFLICT");
        const held = parseCanonicalContractBytes(
          "session-acquire-request/v1",
          await claimBytes(observer),
        );
        if (
          !held.ok ||
          !validateSessionAcquireRequestBinding(
            held.value,
            admitted.source,
            admitted.provenance,
            admitted.paths,
          ).ok ||
          !sameFile(existing, await lstat(path, { bigint: true })) ||
          !sameFile(rootIdentity, await lstat(root, { bigint: true }))
        )
          throw new UnknownObservation("IDENTITY_CONFLICT");
      } finally {
        await observer.close();
      }
      return {
        ok: true as const,
        plan: plan.value,
        evidence,
        acquisition: receipt("REFUSED", "SESSION_HELD", clock(clocks).wall),
        lease: null,
      };
    }
    await handle.writeFile(bytes);
    await handle.sync();
    claimIdentity = await handle.stat({ bigint: true });
    await unchanged();
  } catch (error) {
    // Even a partly written claim stays in place; no rollback or takeover from uncertain state.
    await handle?.close();
    return {
      ok: true as const,
      plan: plan.value,
      evidence,
      acquisition: receipt("UNKNOWN", unknown(error), null),
      lease: null,
    };
  }
  async function observeHealth(): Promise<SessionHealth> {
    let outcome: ContractRecord;
    try {
      if (poisoned) throw new UnknownObservation(poisoned);
      await unchanged();
      const now = clock(clocks);
      const elapsed = now.mono - started.mono;
      const wallElapsed = Date.parse(now.wall) - Date.parse(started.wall);
      if (now.mono < lastClock.mono || Date.parse(now.wall) < Date.parse(lastClock.wall))
        throw new UnknownObservation("CLOCK_ROLLBACK");
      if (Math.abs(elapsed - wallElapsed) > Number(admitted.provenance.wallClockSkewMs))
        throw new UnknownObservation("CLOCK_SKEW");
      const stale = elapsed >= Number(admitted.provenance.leaseFreshnessMs);
      lastClock = now;
      outcome = {
        holderSessionId: sessionId,
        leaseState: stale ? "HELD_STALE" : "HELD_FRESH",
        observedAt: now.wall,
        outcome: stale ? "REFUSED" : "HEALTHY",
        reason: stale ? "FRESHNESS_EXPIRED" : null,
      };
    } catch (error) {
      poisoned = unknown(error);
      outcome = {
        holderSessionId: null,
        leaseState: "UNKNOWN",
        observedAt: null,
        outcome: "UNKNOWN",
        reason: poisoned,
      };
    }
    const health = validateSessionHealthBinding(
      {
        ...outcome,
        schemaVersion: "session-health/v1",
        targetSessionId: sessionId,
        step: {
          cycleId,
          ordinal: "1",
          kind: "session.verify",
          inputDigest: computeCycleRequestDigest(admittedPlan.request),
          predecessorJournalDigest: null,
        },
      },
      plan.value,
    );
    if (!health.ok) throw new Error(health.issues.join(","));
    encoded("session-health/v1", health.value);
    return health.value;
  }

  const acquisition = receipt("ACQUIRED", null, started.wall);
  let lastClock = started;
  return {
    ok: true as const,
    plan: plan.value,
    evidence,
    acquisition,
    lease: {
      observe: observeHealth,
      async observeInitialRoot() {
        // One private initial admission attempt, not a public history-complete token.
        const alreadyObserved = initialObserved;
        initialObserved = true;
        const health = await observeHealth();
        if (health.outcome !== "HEALTHY")
          return { ok: false as const, reason: "SESSION_UNHEALTHY" as const, health };
        if (alreadyObserved || !freshRoot || initialEntries.length !== 0)
          return { ok: false as const, reason: "HISTORY_UNPROVEN" as const, health };
        let entries: string[];
        try {
          entries = await readdir(root);
        } catch {
          poisoned = "STATE_UNREADABLE";
          return {
            ok: false as const,
            reason: "SESSION_UNHEALTHY" as const,
            health: await observeHealth(),
          };
        }
        const after = await observeHealth();
        if (after.outcome !== "HEALTHY")
          return { ok: false as const, reason: "SESSION_UNHEALTHY" as const, health: after };
        if (entries.length !== 1 || entries[0] !== "session-claim.json")
          return { ok: false as const, reason: "HISTORY_UNPROVEN" as const, health: after };
        return { ok: true as const, health: after };
      },
      async close(): Promise<"REMOVED" | "RETAINED_UNKNOWN"> {
        try {
          if (poisoned || closed) return "RETAINED_UNKNOWN";
          await unchanged();
          // Cooperating fixture only: no atomic hostile-replacement guarantee between check/unlink.
          await unlink(path);
          return "REMOVED";
        } catch (error) {
          poisoned = unknown(error);
          return "RETAINED_UNKNOWN";
        } finally {
          if (!closed) {
            closed = true;
            await handle!.close();
          }
        }
      },
    },
  };
}

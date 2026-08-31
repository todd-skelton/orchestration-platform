import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCanonicalContractBytes,
  serializeContract,
  type SessionHealth,
} from "@orchestration-platform/contracts";
import { prepareObservation } from "./consume.js";
import { descriptor } from "./index.js";
import { acquireFixtureSession } from "./session.js";

function encoded(name: string, schema: string, value: unknown) {
  const result = serializeContract(schema, value);
  if (!result.ok || !parseCanonicalContractBytes(schema, result.bytes).ok)
    throw new Error("fixture session observation encoding refused");
  return { name, bytes: result.bytes };
}

// Joins the real private claim to the observer only. No journal or completed routine cycle.
export async function consumeUnderSession(
  ...input: [...OmitLast<Parameters<typeof prepareObservation>>, sessionId: string, cycleId: string]
) {
  const [adapter, invocation, configuration, snapshot, policy, clocks, sessionId, cycleId] = input;
  const retainedInvocation = {
    ...invocation,
    flags: { ...invocation.flags },
    environment: { ...invocation.environment },
  };
  const session = await acquireFixtureSession(
    adapter,
    retainedInvocation,
    sessionId,
    cycleId,
    clocks,
    [descriptor.moduleId],
  );
  if (!session.ok) return session;
  if (!session.lease)
    return {
      ok: false as const,
      reason: "SESSION_NOT_ACQUIRED" as const,
      acquisition: session.acquisition,
    };
  let health: SessionHealth | null = null;
  let failurePhase: "OBSERVATION_REFUSED" | "WRITE_REFUSED" = "OBSERVATION_REFUSED";
  let result:
    | { ok: true; files: string[] }
    | {
        ok: false;
        reason: "SESSION_UNHEALTHY" | "OBSERVATION_REFUSED" | "WRITE_REFUSED";
        observation?: unknown;
      };
  try {
    health = await session.lease.observe();
    if (health.outcome !== "HEALTHY") result = { ok: false, reason: "SESSION_UNHEALTHY" };
    else {
      const prepared = await prepareObservation(
        adapter,
        retainedInvocation,
        configuration,
        snapshot,
        policy,
        clocks,
        session.plan.request,
      );
      if (!prepared.ok)
        result = { ok: false, reason: "OBSERVATION_REFUSED", observation: prepared };
      else {
        // Recheck the actual claim/configuration after all async observation and planning.
        const beforeWrite = await session.lease.observe();
        if (beforeWrite.outcome !== "HEALTHY") {
          health = beforeWrite;
          result = { ok: false, reason: "SESSION_UNHEALTHY" };
        } else {
          failurePhase = "WRITE_REFUSED";
          const entries = await readdir(prepared.stateRoot);
          if (entries.length !== 1 || entries[0] !== "session-claim.json")
            throw new Error("fixture output root is not claim-only");
          const records = [
            encoded("cycle-plan.json", "cycle-plan/v1", session.plan),
            encoded("session-acquisition.json", "session-receipt/v1", session.acquisition),
            encoded("session-health.json", "session-health/v1", health),
            ...prepared.output,
          ];
          for (const record of records)
            await writeFile(join(prepared.stateRoot, record.name), record.bytes, { flag: "wx" });
          result = { ok: true, files: records.map((record) => record.name) };
        }
      }
    }
  } catch {
    // Partial outputs remain diagnostic; never delete uncertain files or retry the observation.
    result = { ok: false, reason: failurePhase };
  }
  let cleanup: "REMOVED" | "RETAINED_UNKNOWN";
  try {
    cleanup = await session.lease.close();
  } catch {
    cleanup = "RETAINED_UNKNOWN";
  }
  if (cleanup !== "REMOVED")
    return {
      ok: false as const,
      reason: "SESSION_RETAINED_UNKNOWN" as const,
      acquisition: session.acquisition,
      health,
      cleanup,
    };
  return { ...result, acquisition: session.acquisition, health, cleanup };
}

type OmitLast<T extends readonly unknown[]> = T extends [...infer Rest, unknown] ? Rest : never;

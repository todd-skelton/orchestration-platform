import { initialBreaker } from "./initial-breaker.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCanonicalContractBytes,
  serializeContract,
  type BreakerReceipt,
  type SessionHealth,
} from "@orchestration-platform/contracts";
import { prepareModuleInput } from "./consume.js";
import { descriptor } from "./index.js";
import { acquireFixtureSession } from "./session.js";

function encoded(name: string, schema: string, value: unknown) {
  const result = serializeContract(schema, value);
  if (!result.ok || !parseCanonicalContractBytes(schema, result.bytes).ok)
    throw new Error("fixture breaker observation encoding refused");
  return { name, bytes: result.bytes };
}

// First reduction only, admitted by this acquisition's actual fresh root. No replay or module call.
export async function consumeInitialBreaker(
  ...args: [...OmitLast<Parameters<typeof prepareModuleInput>>, sessionId: string, cycleId: string]
) {
  const [adapter, invocation, configuration, snapshot, policy, clocks, sessionId, cycleId] = args;
  const retained = {
    ...invocation,
    flags: { ...invocation.flags },
    environment: { ...invocation.environment },
  };
  const session = await acquireFixtureSession(adapter, retained, sessionId, cycleId, clocks, [
    descriptor.moduleId,
  ]);
  if (!session.ok) return session;
  if (!session.lease)
    return {
      ok: false as const,
      reason: "SESSION_NOT_ACQUIRED" as const,
      acquisition: session.acquisition,
    };
  let health: SessionHealth | null = null;
  let phase: "OBSERVATION_REFUSED" | "WRITE_REFUSED" = "OBSERVATION_REFUSED";
  let result:
    | { ok: true; files: string[]; breaker: BreakerReceipt }
    | {
        ok: false;
        reason: "SESSION_UNHEALTHY" | "HISTORY_UNPROVEN" | "OBSERVATION_REFUSED" | "WRITE_REFUSED";
        observation?: unknown;
      };
  try {
    health = await session.lease.observe();
    if (health.outcome !== "HEALTHY") result = { ok: false, reason: "SESSION_UNHEALTHY" };
    else {
      const prepared = await prepareModuleInput(
        adapter,
        retained,
        configuration,
        snapshot,
        policy,
        clocks,
        session.plan.request,
      );
      if (!prepared.ok)
        result = { ok: false, reason: "OBSERVATION_REFUSED", observation: prepared };
      else {
        const genesis = await session.lease.observeInitialRoot();
        if (!genesis.ok) {
          health = genesis.health;
          result = { ok: false, reason: genesis.reason };
        } else {
          const input = prepared.input;
          const breaker = initialBreaker(input);
          if (!breaker.ok) throw new Error("fixture initial reduction refused");
          const records = [
            encoded("cycle-plan.json", "cycle-plan/v1", session.plan),
            encoded("session-acquisition.json", "session-receipt/v1", session.acquisition),
            encoded("session-health.json", "session-health/v1", health),
            encoded(
              "configuration.json",
              "configuration-provenance/v1",
              input.configurationProvenance,
            ),
            encoded(
              "adapter-configuration.json",
              "adapter-configuration/v1",
              input.adapterConfiguration,
            ),
            encoded("project-facts.json", "project-facts/v1", input.projectFacts),
            encoded("project-breaker-facts.json", "project-breaker-facts/v1", input.policyFacts),
            encoded("cycle-request.json", "cycle-request/v1", input.cycleRequest),
            encoded("breaker-receipt.json", "breaker-receipt/v1", breaker.value),
          ];
          phase = "WRITE_REFUSED";
          for (const record of records)
            await writeFile(join(prepared.stateRoot, record.name), record.bytes, { flag: "wx" });
          result = {
            ok: true,
            files: records.map((record) => record.name),
            breaker: breaker.value,
          };
        }
      }
    }
  } catch {
    // Partial output is diagnostic; a second call cannot select genesis on the retained root.
    result = { ok: false, reason: phase };
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

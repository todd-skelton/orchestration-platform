import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalJson,
  computeDispatchContentReference,
  computeModuleActionPlanDigest,
  computeProjectPreflightDigest,
  computeProjectPreflightObservationDigest,
  computeRouteMappingDigest,
  computeRouteSelectionDigest,
  computeSessionHealthDigest,
  parseCanonicalContractBytes,
  serializeContract,
  validateDispatchPlanBinding,
  validateModulePlanBinding,
  validateProjectPreflightBinding,
  validateRouteSelectionBinding,
  type ParseResult,
  type ProjectPreflight,
  type SessionHealth,
} from "@orchestration-platform/contracts";
import { prepareModuleInput } from "./consume.js";
import { echoMapping, echoResource, fixtureId, runEcho } from "./echo-worker.js";
import { initialBreaker } from "./initial-breaker.js";
import { descriptor, plan } from "./index.js";
import { acquireFixtureSession } from "./session.js";

const required = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.value;
};
type OmitLast<T extends readonly unknown[]> = T extends [...infer Rest, unknown] ? Rest : never;

/** Actual fixture-only execution through worker exit. No review, journal, replay or final cycle. */
export async function consumeEcho(
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
  const lease = session.lease;
  const files: string[] = [];
  let health: SessionHealth | null = null;
  let uncertain = false;
  let phase = "OBSERVATION_REFUSED";
  const inspect = async () => {
    health = await lease.inspect();
    if (health.outcome !== "HEALTHY") {
      uncertain = true;
      return false;
    }
    return true;
  };
  const execute = async () => {
    health = await lease.observe();
    if (health.outcome !== "HEALTHY") return { ok: false as const, reason: "SESSION_UNHEALTHY" };
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
      return { ok: false as const, reason: "OBSERVATION_REFUSED", observation: prepared };
    const initial = await lease.observeInitialRoot();
    if (!initial.ok) return { ok: false as const, reason: initial.reason };
    const input = prepared.input;
    const record = async (name: string, schema: string, value: unknown) => {
      if (!(await inspect())) throw new Error("fixture session changed");
      const encoded = serializeContract(schema, value);
      if (!encoded.ok || !parseCanonicalContractBytes(schema, encoded.bytes).ok)
        throw new Error("fixture output encoding refused");
      phase = "WRITE_REFUSED";
      await writeFile(join(prepared.stateRoot, name), encoded.bytes, { flag: "wx" });
      files.push(name);
    };
    const firstHealth = health;
    const breaker = required(initialBreaker(input));
    for (const evidence of session.evidence)
      await record(`${evidence.schema.split("/")[0]}.json`, evidence.schema, evidence.value);
    await record("session-health.json", "session-health/v1", firstHealth);
    await record(
      "adapter-configuration.json",
      "adapter-configuration/v1",
      input.adapterConfiguration,
    );
    await record("project-facts.json", "project-facts/v1", input.projectFacts);
    await record("project-breaker-facts.json", "project-breaker-facts/v1", input.policyFacts);
    await record("breaker-receipt.json", "breaker-receipt/v1", breaker);
    phase = "PLAN_REFUSED";
    const action = required(validateModulePlanBinding(input, await plan(input)));
    await record("module-descriptor.json", "module-descriptor/v1", descriptor);
    await record("module-input.json", "module-plan-input/v1", input);
    await record("module-result.json", "module-plan-result/v1", action);
    if (action.schemaVersion !== "module-action-plan/v1")
      return { ok: false as const, reason: "NO_ELIGIBLE_ACTION" };
    if (
      breaker.result.kind !== "KNOWN" ||
      !breaker.result.capabilities.some(
        (row) => row.capabilityName === action.actionCore.capabilityName && row.state === "CLOSED",
      )
    )
      return { ok: false as const, reason: "BREAKER_NOT_CLOSED" };
    const route = required(
      validateRouteSelectionBinding(input, action, echoMapping, {
        actionPlanDigest: computeModuleActionPlanDigest(action),
        hostMappingDigest: computeRouteMappingDigest(echoMapping),
        outcome: {
          kind: "SELECTED",
          workerHostIdentityDigest: echoMapping[0]!.workerHostIdentityDigest,
        },
        schemaVersion: "route-selection/v1",
      }),
    );
    await record("route-selection.json", "route-selection/v1", route);
    await record("worker-host.json", "worker-host-renderer-artifact/v1", echoMapping[0]);
    phase = "PREFLIGHT_REFUSED";
    const current = await snapshot(
      input.adapterConfiguration,
      input.configurationProvenance,
      clocks,
    );
    if (!current.ok)
      return { ok: false as const, reason: "PREFLIGHT_OBSERVATION_REFUSED", observation: current };
    const observation = { kind: "PROJECT" as const, facts: current.facts };
    const row = current.facts.frontier.find((item) => item.workId === action.workId);
    let outcome: ProjectPreflight["outcome"];
    if (current.facts.state === "UNAVAILABLE")
      outcome = { kind: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" };
    else if (current.facts.state === "UNKNOWN")
      outcome = { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" };
    else if (!row) outcome = { kind: "REFUSED", reason: "WORK_MISSING" };
    else if (row.immutableSubjectDigest !== action.actionCore.immutableSubjectDigest)
      outcome = { kind: "REFUSED", reason: "TARGET_CHANGED" };
    else if (!row.capabilityNames.includes(action.actionCore.capabilityName))
      outcome = { kind: "REFUSED", reason: "CAPABILITY_REMOVED" };
    else if (row.readiness !== "READY") outcome = { kind: "REFUSED", reason: "NOT_READY" };
    else if (current.facts.frontierDigest !== input.projectFacts.frontierDigest)
      outcome = { kind: "REFUSED", reason: "FRONTIER_CHANGED" };
    else outcome = { kind: "ELIGIBLE" };
    const preflight = required(
      validateProjectPreflightBinding(input, action, echoMapping, route, observation, {
        actionPlanDigest: computeModuleActionPlanDigest(action),
        observationDigest: computeProjectPreflightObservationDigest(observation),
        outcome,
        routeDigest: computeRouteSelectionDigest(route),
        schemaVersion: "project-preflight/v1",
      }),
    );
    await record("preflight-project-facts.json", "project-facts/v1", current.facts);
    await record("project-preflight.json", "project-preflight/v1", preflight);
    if (preflight.outcome.kind !== "ELIGIBLE")
      return { ok: false as const, reason: "PREFLIGHT_NOT_ELIGIBLE", preflight };
    if (!(await inspect())) return { ok: false as const, reason: "SESSION_UNHEALTHY" };
    const inspection = health!;
    if (action.dispatchBrief === null) throw new Error("fixed echo needs brief");
    const rendered = Buffer.from(canonicalJson(action.dispatchBrief));
    const attemptId = fixtureId();
    const dispatch = required(
      validateDispatchPlanBinding(
        input,
        action,
        echoMapping,
        route,
        observation,
        preflight,
        session.plan,
        inspection,
        null,
        rendered,
        {
          actionPlanDigest: computeModuleActionPlanDigest(action),
          attemptId,
          outcome: {
            credentials: { kind: "NONE" },
            hostRendererArtifactDigest: echoMapping[0]!.hostRendererArtifactDigest,
            kind: "PLANNED",
            renderedInput: computeDispatchContentReference(rendered),
            resourceIntents: [echoResource(attemptId)],
            workerHostIdentityDigest: echoMapping[0]!.workerHostIdentityDigest,
          },
          preflightDigest: computeProjectPreflightDigest(preflight),
          reviewRequestDigest: null,
          routeDigest: computeRouteSelectionDigest(route),
          schemaVersion: "dispatch-plan/v1",
          sessionHealthDigest: computeSessionHealthDigest(inspection),
        },
      ),
    );
    await record("dispatch-session-health.json", "session-health/v1", inspection);
    await record("dispatch-plan.json", "dispatch-plan/v1", dispatch);
    phase = "WORKER_OBSERVATION_UNPROVEN";
    uncertain = true;
    const worker = await runEcho(prepared.stateRoot, dispatch, rendered, clocks.wallNow, inspect);
    uncertain = worker.retained;
    await record("worker-launch.json", "worker-launch-receipt/v1", worker.launch);
    if (worker.terminal)
      await record("worker-terminal.json", "worker-terminal-receipt/v1", worker.terminal);
    for (const key of ["stdout", "stderr"] as const) {
      if (worker[key] === null) continue;
      if (!(await inspect())) throw new Error("session changed after worker");
      await writeFile(join(prepared.stateRoot, `${key}.bin`), worker[key], { flag: "wx" });
      files.push(`${key}.bin`);
    }
    if (worker.retained || worker.terminal?.outcome.kind !== "EXITED")
      return { ok: false as const, reason: "WORKER_OBSERVATION_UNPROVEN", worker };
    if (
      worker.terminal.outcome.exit.kind !== "EXIT_CODE" ||
      worker.terminal.outcome.exit.value !== "0" ||
      worker.stdout === null ||
      worker.stderr === null ||
      !Buffer.from(worker.stdout).equals(rendered) ||
      worker.stderr.length !== 0
    )
      return { ok: false as const, reason: "ECHO_RESULT_REFUSED", worker };
    return { ok: true as const, worker, preflight, route, dispatch };
  };
  let result;
  try {
    result = await execute();
  } catch {
    result = { ok: false as const, reason: phase };
  }
  let cleanup: "REMOVED" | "RETAINED_UNKNOWN";
  try {
    cleanup = uncertain ? await lease.retain() : await lease.close();
  } catch {
    cleanup = "RETAINED_UNKNOWN";
  }
  if (cleanup !== "REMOVED")
    return {
      ok: false as const,
      reason: "SESSION_RETAINED_UNKNOWN",
      files,
      acquisition: session.acquisition,
      health,
      cleanup,
      observation: result,
    };
  return { ...result, files, acquisition: session.acquisition, health, cleanup };
}

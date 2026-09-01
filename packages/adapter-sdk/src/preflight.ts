import { types } from "node:util";
import {
  canonicalDigest,
  canonicalJson,
  closedRecord,
  computeModuleActionPlanDigest,
  computeProjectPreflightObservationDigest,
  computeRouteSelectionDigest,
  computeWorkerResultSubjectDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
  parseProjectPreflightObservation,
  parseWorkerResultSubject,
  parseWorkerHostRendererArtifacts,
  snapshotJson,
  validateProjectFactsBinding,
  validateProjectPreflightBinding,
  validateRouteSelectionBinding,
  type ProjectPreflight,
  type ProjectPreflightObservation,
  type ContractRecord,
  type WorkerResultSubject,
} from "@orchestration-platform/contracts";
import type { SnapshotClocks, SnapshotReader, SnapshotResult } from "./snapshot.js";

export type ProjectPreflightResult =
  | Readonly<{
      ok: true;
      observation: Extract<ProjectPreflightObservation, { kind: "PROJECT" }>;
      preflight: ProjectPreflight;
    }>
  | Readonly<{
      ok: false;
      code: "PREFLIGHT_ADMISSION_REFUSED" | "PREFLIGHT_OBSERVATION_REFUSED";
      observation: SnapshotResult | null;
    }>;

export type WorkerResultPreflightRead = () => unknown;
export type WorkerResultPreflightResult =
  | Readonly<{
      ok: true;
      observation: Extract<ProjectPreflightObservation, { kind: "REVIEW" }>;
      preflight: ProjectPreflight;
    }>
  | Readonly<{
      ok: false;
      code: "PREFLIGHT_ADMISSION_REFUSED" | "PREFLIGHT_OBSERVATION_REFUSED";
      observation: Extract<ProjectPreflightObservation, { kind: "REVIEW" }> | null;
    }>;

/**
 * Reads one fresh PROJECT observation and binds it to an already admitted
 * module/action/route tuple. ELIGIBLE is consistency evidence only; this
 * helper performs no allocation, dispatch, mutation or authority decision.
 */
export async function observeProjectPreflight(
  moduleInput: unknown,
  actionPlan: unknown,
  mapping: unknown,
  route: unknown,
  snapshot: SnapshotReader,
  clocks: SnapshotClocks,
): Promise<ProjectPreflightResult> {
  const input = parseModulePlanInput(moduleInput);
  const action = parseModuleActionPlan(actionPlan);
  const routeBinding = validateRouteSelectionBinding(moduleInput, actionPlan, mapping, route);
  const retainedMapping =
    routeBinding.ok && routeBinding.value.outcome.kind === "SELECTED"
      ? parseWorkerHostRendererArtifacts(mapping)
      : null;
  if (
    !input.ok ||
    !action.ok ||
    input.value.reviewSubject !== null ||
    !routeBinding.ok ||
    (routeBinding.value.outcome.kind !== "SELECTED" &&
      routeBinding.value.outcome.kind !== "NO_WORKER") ||
    (routeBinding.value.outcome.kind === "SELECTED" && !retainedMapping?.ok)
  )
    return {
      ok: false,
      code: "PREFLIGHT_ADMISSION_REFUSED",
      observation: null,
    };
  const admittedMapping =
    routeBinding.value.outcome.kind === "SELECTED" && retainedMapping?.ok
      ? retainedMapping.value
      : null;

  let supplied: unknown;
  try {
    supplied = await snapshot(
      input.value.adapterConfiguration,
      input.value.configurationProvenance,
      clocks,
    );
  } catch {
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };
  }
  const captured = snapshotJson(supplied);
  if (
    !captured.ok ||
    captured.value === null ||
    typeof captured.value !== "object" ||
    Array.isArray(captured.value)
  )
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };
  const current = captured.value as ContractRecord;
  if (current.ok !== true)
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation:
        current.ok === false &&
        closedRecord(current, ["code", "ok"]).length === 0 &&
        [
          "ADAPTER_CONFIGURATION_REFUSED",
          "ADAPTER_BINDING_REFUSED",
          "ADAPTER_COMPATIBILITY_REFUSED",
          "INTERNAL_ERROR",
        ].includes(String(current.code))
          ? (current as SnapshotResult)
          : null,
    };
  if (closedRecord(current, ["facts", "ok"]).length)
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };

  const facts = validateProjectFactsBinding(current.facts, input.value.adapterConfiguration);
  if (!facts.ok)
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };

  const observation = { kind: "PROJECT" as const, facts: facts.value };
  const row =
    facts.value.state === "COMPLETE"
      ? facts.value.frontier.find((entry) => entry.workId === action.value.workId)
      : undefined;
  let outcome: ProjectPreflight["outcome"];
  if (facts.value.state === "UNAVAILABLE")
    outcome = { kind: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" };
  else if (facts.value.state === "UNKNOWN") outcome = { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" };
  else if (!row) outcome = { kind: "REFUSED", reason: "WORK_MISSING" };
  else if (row.immutableSubjectDigest !== action.value.actionCore.immutableSubjectDigest)
    outcome = { kind: "REFUSED", reason: "TARGET_CHANGED" };
  else if (!row.capabilityNames.includes(String(action.value.actionCore.capabilityName)))
    outcome = { kind: "REFUSED", reason: "CAPABILITY_REMOVED" };
  else if (row.readiness !== "READY") outcome = { kind: "REFUSED", reason: "NOT_READY" };
  else if (canonicalJson(facts.value.frontier) !== canonicalJson(input.value.projectFacts.frontier))
    outcome = { kind: "REFUSED", reason: "FRONTIER_CHANGED" };
  else outcome = { kind: "ELIGIBLE" };

  const preflight = {
    actionPlanDigest: computeModuleActionPlanDigest(action.value),
    observationDigest: computeProjectPreflightObservationDigest(observation),
    outcome,
    routeDigest: computeRouteSelectionDigest(routeBinding.value),
    schemaVersion: "project-preflight/v1" as const,
  };
  const bound = validateProjectPreflightBinding(
    input.value,
    action.value,
    admittedMapping,
    routeBinding.value,
    observation,
    preflight,
  );
  return bound.ok
    ? Object.freeze({ ok: true, observation, preflight: bound.value })
    : {
        ok: false,
        code: "PREFLIGHT_OBSERVATION_REFUSED",
        observation: { ok: true, facts: facts.value },
      };
}

/**
 * Reads one fresh worker-result target for the existing REVIEW preflight path.
 * The callback is fixed trusted composition, never loaded adapter code. This
 * helper proves only current target consistency and grants no review authority.
 */
export async function observeWorkerResultPreflight(
  moduleInput: unknown,
  actionPlan: unknown,
  mapping: unknown,
  route: unknown,
  readCurrentSubject: WorkerResultPreflightRead,
  nextObservationId: () => string,
  clocks: Pick<SnapshotClocks, "wallNow">,
): Promise<WorkerResultPreflightResult> {
  const input = parseModulePlanInput(moduleInput);
  const action = parseModuleActionPlan(actionPlan);
  const routeBinding = validateRouteSelectionBinding(moduleInput, actionPlan, mapping, route);
  const retainedMapping =
    routeBinding.ok && routeBinding.value.outcome.kind === "SELECTED"
      ? parseWorkerHostRendererArtifacts(mapping)
      : null;
  if (
    !input.ok ||
    !action.ok ||
    input.value.reviewSubject?.schemaVersion !== "worker-result-subject/v1" ||
    input.value.reviewSubject.baseSource.adapterId !== input.value.adapterConfiguration.adapterId ||
    input.value.reviewSubject.baseSource.projectId !== input.value.adapterConfiguration.projectId ||
    !routeBinding.ok ||
    routeBinding.value.outcome.kind !== "SELECTED" ||
    !retainedMapping?.ok
  )
    return {
      ok: false,
      code: "PREFLIGHT_ADMISSION_REFUSED",
      observation: null,
    };
  const target = input.value.reviewSubject,
    admittedMapping = retainedMapping.value;

  let current: WorkerResultSubject | null = null;
  try {
    const pending = readCurrentSubject();
    if (
      types.isPromise(pending) &&
      Object.getPrototypeOf(pending) === Promise.prototype &&
      !Object.hasOwn(pending, "constructor")
    ) {
      const settled = (await Promise.prototype.then.call(
        pending,
        (value: unknown) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      )) as Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;
      if (settled.ok) {
        const parsed = parseWorkerResultSubject(settled.value);
        if (parsed.ok) current = parsed.value;
      }
    }
  } catch {
    /* typed source uncertainty below */
  }

  let observation: Extract<ProjectPreflightObservation, { kind: "REVIEW" }>;
  try {
    observation = {
      adapterConfigurationDigest: canonicalDigest(input.value.adapterConfiguration),
      kind: "REVIEW",
      observationId: nextObservationId(),
      observedAt: clocks.wallNow(),
      result: current ? { kind: "AVAILABLE", subject: current } : { kind: "UNKNOWN" },
    };
  } catch {
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };
  }
  const parsedObservation = parseProjectPreflightObservation(observation);
  if (!parsedObservation.ok)
    return {
      ok: false,
      code: "PREFLIGHT_OBSERVATION_REFUSED",
      observation: null,
    };
  observation = parsedObservation.value as Extract<ProjectPreflightObservation, { kind: "REVIEW" }>;
  const outcome: ProjectPreflight["outcome"] = current
    ? computeWorkerResultSubjectDigest(current) === computeWorkerResultSubjectDigest(target)
      ? { kind: "ELIGIBLE" }
      : { kind: "REFUSED", reason: "TARGET_CHANGED" }
    : { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" };
  const preflight = {
    actionPlanDigest: computeModuleActionPlanDigest(action.value),
    observationDigest: computeProjectPreflightObservationDigest(observation),
    outcome,
    routeDigest: computeRouteSelectionDigest(routeBinding.value),
    schemaVersion: "project-preflight/v1" as const,
  };
  const bound = validateProjectPreflightBinding(
    input.value,
    action.value,
    admittedMapping,
    routeBinding.value,
    observation,
    preflight,
  );
  return bound.ok
    ? Object.freeze({ ok: true, observation, preflight: bound.value })
    : {
        ok: false,
        code: "PREFLIGHT_OBSERVATION_REFUSED",
        observation,
      };
}

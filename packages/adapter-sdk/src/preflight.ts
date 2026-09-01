import {
  canonicalJson,
  closedRecord,
  computeModuleActionPlanDigest,
  computeProjectPreflightObservationDigest,
  computeRouteSelectionDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
  parseWorkerHostRendererArtifacts,
  snapshotJson,
  validateProjectFactsBinding,
  validateProjectPreflightBinding,
  validateRouteSelectionBinding,
  type ProjectPreflight,
  type ProjectPreflightObservation,
  type ContractRecord,
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

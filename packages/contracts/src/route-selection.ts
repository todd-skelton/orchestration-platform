import { parseWorkerHostRendererArtifacts, selectWorkerHostForCapability } from "./dispatch.js";
import {
  computeModuleActionPlanDigest,
  parseModuleActionPlan,
  parseModulePlanInput,
  validateModulePlanBinding,
} from "./module-plan.js";
import {
  canonicalDigest,
  frame,
  framedDigest,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const routeSelectionSchemaVersions = Object.freeze(["route-selection/v1"] as const);
export const routeSelectionSchemaFields = Object.freeze({
  route: Object.freeze([
    "actionPlanDigest",
    "hostMappingDigest",
    "outcome",
    "schemaVersion",
  ] as const),
  selected: Object.freeze(["kind", "workerHostIdentityDigest"] as const),
  refused: Object.freeze(["kind", "reason"] as const),
  noWorker: Object.freeze(["kind"] as const),
});
export const routeUnknownReasons = Object.freeze([
  "MAPPING_UNAVAILABLE",
  "MAPPING_INVALID",
  "ADMISSION_UNPROVEN",
] as const);
export type RouteSelection = Readonly<{
  actionPlanDigest: string;
  hostMappingDigest: string | null;
  outcome:
    | Readonly<{ kind: "SELECTED"; workerHostIdentityDigest: string }>
    | Readonly<{ kind: "REFUSED"; reason: "NO_SUPPORTED_HOST" }>
    | Readonly<{ kind: "UNKNOWN"; reason: (typeof routeUnknownReasons)[number] }>
    | Readonly<{ kind: "NO_WORKER" }>;
  schemaVersion: "route-selection/v1";
}>;
const digest = (value: JsonValue | undefined): boolean => isSha256(value) && value.length === 64;
function invalid(...issues: readonly string[]): ParseResult<RouteSelection> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
const prefixed = (prefix: string, issues: readonly string[]) =>
  issues.map((issue) => `${prefix}.${issue}`);

/** Complete route structure only; no host observation or installed-state authority. */
export function parseRouteSelection(input: unknown): ParseResult<RouteSelection> {
  const parsed = snapshotClosedRecord(input, routeSelectionSchemaFields.route);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "route-selection/v1") issues.push("schemaVersion:mismatch");
  if (!digest(record.actionPlanDigest)) issues.push("actionPlanDigest:invalid");
  const value = record.outcome;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return invalid(...issues, "outcome:invalid");
  const kind = (value as ContractRecord).kind;
  const fields =
    kind === "SELECTED"
      ? routeSelectionSchemaFields.selected
      : kind === "NO_WORKER"
        ? routeSelectionSchemaFields.noWorker
        : kind === "REFUSED" || kind === "UNKNOWN"
          ? routeSelectionSchemaFields.refused
          : null;
  if (!fields) return invalid(...issues, "outcome.kind:invalid");
  const outcome = snapshotClosedRecord(value, fields);
  if (!outcome.ok) return invalid(...issues, ...prefixed("outcome", outcome.issues));
  if (kind === "SELECTED" && !digest(outcome.value.workerHostIdentityDigest))
    issues.push("outcome.workerHostIdentityDigest:invalid");
  if (kind === "REFUSED" && outcome.value.reason !== "NO_SUPPORTED_HOST")
    issues.push("outcome.reason:invalid");
  if (
    kind === "UNKNOWN" &&
    !(routeUnknownReasons as readonly JsonValue[]).includes(outcome.value.reason!)
  )
    issues.push("outcome.reason:invalid");
  const requiresNull =
    kind === "NO_WORKER" || (kind === "UNKNOWN" && outcome.value.reason !== "ADMISSION_UNPROVEN");
  if (requiresNull ? record.hostMappingDigest !== null : !digest(record.hostMappingDigest))
    issues.push("hostMappingDigest:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as RouteSelection };
}

export function computeRouteSelectionDigest(input: unknown): string {
  const parsed = parseRouteSelection(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("route-selection/v1", [frame.canonical(parsed.value)]);
}

/** Inline commitment to the whole ordered supplied mapping, never an installed census proof. */
export function computeRouteMappingDigest(input: unknown): string {
  const mapping = parseWorkerHostRendererArtifacts(input);
  if (!mapping.ok) throw new TypeError(mapping.issues.join(","));
  return canonicalDigest(mapping.value);
}

/** Checks exactly four supplied preimages; a coherent claim cannot establish live routing admission. */
export function validateRouteSelectionBinding(
  moduleInput: unknown,
  actionPlan: unknown,
  mappingInput: unknown,
  routeInput: unknown,
): ParseResult<RouteSelection> {
  const input = parseModulePlanInput(moduleInput);
  if (!input.ok) return invalid(...prefixed("moduleInput", input.issues));
  const plan = parseModuleActionPlan(actionPlan);
  if (!plan.ok) return invalid(...prefixed("actionPlan", plan.issues));
  const binding = validateModulePlanBinding(input.value, plan.value);
  if (!binding.ok) return invalid(...prefixed("actionPlan", binding.issues));
  const route = parseRouteSelection(routeInput);
  if (!route.ok) return route;
  if (route.value.actionPlanDigest !== computeModuleActionPlanDigest(plan.value))
    return invalid("actionPlanDigest:mismatch");
  const core = plan.value.actionCore;
  const declaration = input.value.descriptor.actions.find(
    (row) => row.actionKind === core.actionKind && row.capabilityName === core.capabilityName,
  );
  if (!declaration) return invalid("actionPlan:undeclared-action");
  const outcome = route.value.outcome;
  if (!declaration.workerRequired) {
    return outcome.kind === "NO_WORKER" && mappingInput === null
      ? route
      : invalid("outcome:no-worker-required");
  }
  if (outcome.kind === "NO_WORKER") return invalid("outcome:worker-required");
  if (outcome.kind === "UNKNOWN" && outcome.reason === "MAPPING_UNAVAILABLE")
    return mappingInput === null ? route : invalid("mapping:null-required");
  if (outcome.kind === "UNKNOWN" && outcome.reason === "MAPPING_INVALID") {
    if (mappingInput === null || mappingInput === undefined)
      return invalid("mapping:observation-required");
    return parseWorkerHostRendererArtifacts(mappingInput).ok
      ? invalid("mapping:invalid-observation-required")
      : route;
  }
  const mapping = parseWorkerHostRendererArtifacts(mappingInput);
  if (!mapping.ok) return invalid(...prefixed("mapping", mapping.issues));
  if (route.value.hostMappingDigest !== canonicalDigest(mapping.value))
    return invalid("hostMappingDigest:mismatch");
  if (outcome.kind === "SELECTED") {
    const selected = selectWorkerHostForCapability(
      mapping.value,
      outcome.workerHostIdentityDigest,
      core.capabilityName,
    );
    if (!selected.ok) return invalid(...prefixed("selected", selected.issues));
  } else if (
    outcome.kind === "REFUSED" &&
    mapping.value.some((row) =>
      (row.capabilityNames as readonly string[]).includes(String(core.capabilityName)),
    )
  )
    return invalid("outcome:supported-host-present");
  // ADMISSION_UNPROVEN is deliberately only a claim about unavailable external admission.
  return route;
}

export function parseRouteSelectionContract(
  schema: string,
  input: unknown,
): ParseResult<RouteSelection> | null {
  return schema === "route-selection/v1" ? parseRouteSelection(input) : null;
}

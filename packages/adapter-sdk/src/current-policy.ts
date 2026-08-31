import { randomBytes } from "node:crypto";
import { types } from "node:util";
import {
  canonicalDigest,
  canonicalJson,
  closedRecord,
  isCanonicalTimestamp,
  parseAdapterConfiguration,
  parseProjectBreakerFacts,
  parseProjectFacts,
  snapshotJson,
  validateAdapterConfigurationBinding,
  validateProjectBreakerFactsBinding,
  validateProjectFactsBinding,
  type ContractRecord,
  type ProjectBreakerDecision,
  type ProjectBreakerFacts,
  type ProjectFacts,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";
import type { SnapshotClocks } from "./snapshot.js";

export type CurrentPolicyRequest = Readonly<{
  capabilityNames: readonly string[];
  observationId: string;
  policyVersion: string;
  projectFacts: Extract<ProjectFacts, { state: "COMPLETE" }>;
}>;
export type CurrentPolicyRead = (request: CurrentPolicyRequest) => unknown;
export type CurrentPolicyResult =
  | Readonly<{ ok: true; facts: ProjectBreakerFacts }>
  | Readonly<{
      ok: false;
      code:
        | "ADAPTER_CONFIGURATION_REFUSED"
        | "ADAPTER_BINDING_REFUSED"
        | "ADAPTER_COMPATIBILITY_REFUSED"
        | "PROJECT_SNAPSHOT_REFUSED"
        | "INTERNAL_ERROR";
    }>;
export type CurrentPolicyReader = (
  configuration: unknown,
  loadedProvenance: unknown,
  projectFacts: unknown,
  clocks: SnapshotClocks,
) => Promise<CurrentPolicyResult>;
type Response = Readonly<{
  observationId: string;
  policyVersion: string;
  projectFactsDigest: string;
}> &
  (
    | Readonly<{
        state: "COMPLETE";
        decisions: readonly ProjectBreakerDecision[];
        frontier: readonly ProjectFrontierRow[];
      }>
    | Readonly<{ state: "UNKNOWN"; reason: "SOURCE_UNKNOWN" }>
    | Readonly<{ state: "UNAVAILABLE"; reason: "SOURCE_UNAVAILABLE" }>
  );
type Arm =
  | Pick<Extract<ProjectBreakerFacts, { state: "COMPLETE" }>, "state" | "decisions">
  | Pick<Extract<ProjectBreakerFacts, { state: "UNKNOWN" }>, "state" | "reason">
  | Pick<Extract<ProjectBreakerFacts, { state: "UNAVAILABLE" }>, "state" | "reason">;
type Settlement =
  { kind: "RESPONSE"; value: unknown } | { kind: "REJECTED" | "TIMEOUT" | "INTERNAL" };

const engineVersion = "0.0.0";
const schemas = ["adapter-configuration/v1", "project-facts/v1", "project-breaker-facts/v1"];
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;
const timeoutArm = { state: "UNAVAILABLE", reason: "OBSERVATION_TIMEOUT" } as const;

// Reuse public scalar/row grammars without giving an adapter-selected echo authority.
function parseResponse(
  input: unknown,
  projectFacts: CurrentPolicyRequest["projectFacts"],
): Response | null {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return null;
  const value = snapshot.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as ContractRecord;
  const complete = response.state === "COMPLETE";
  if (
    closedRecord(value, [
      "observationId",
      "policyVersion",
      "projectFactsDigest",
      "state",
      ...(complete ? ["decisions", "frontier"] : ["reason"]),
    ]).length
  )
    return null;
  if (
    !complete &&
    !(
      (response.state === "UNKNOWN" && response.reason === "SOURCE_UNKNOWN") ||
      (response.state === "UNAVAILABLE" && response.reason === "SOURCE_UNAVAILABLE")
    )
  )
    return null;
  const facts = parseProjectBreakerFacts({
    adapterConfigurationDigest: projectFacts.adapterConfigurationDigest,
    projectId: projectFacts.projectId,
    observedAt: projectFacts.observedAt,
    schemaVersion: "project-breaker-facts/v1",
    observationId: response.observationId,
    policyVersion: response.policyVersion,
    projectFactsDigest: response.projectFactsDigest,
    state: response.state,
    ...(complete ? { decisions: response.decisions } : { reason: response.reason }),
  });
  if (!facts.ok) return null;
  if (
    complete &&
    !parseProjectFacts({
      ...projectFacts,
      frontier: response.frontier,
      frontierDigest: canonicalDigest(response.frontier!),
    }).ok
  )
    return null;
  return response as Response;
}

function freshObservationId(observedAt: string, snapshotId: string): string {
  const milliseconds = Date.parse(observedAt);
  if (milliseconds < 0 || milliseconds > 0xffffffffffff) throw new Error("clock refused");
  const bytes = randomBytes(16);
  bytes.writeUIntBE(milliseconds, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (id === snapshotId) throw new Error("identity refused");
  return id;
}

/**
 * Private fixed-source composition, not a registry or runtime policy selector.
 * A fresh reviewed callback supplies current fixture evidence only. No arm
 * grants capability, clears a hold, or proves generic breaker history/recovery.
 */
export function createProjectCurrentPolicyReader(
  readCurrentPolicy: CurrentPolicyRead,
  adapterId: string,
  adapterVersion: string,
  policyVersion: string,
  supportedEngines: readonly string[],
  supportedSchemas: readonly string[],
  supportedCapabilities: readonly string[],
  supportedPolicyVersions: readonly string[],
): CurrentPolicyReader {
  const engines = [...supportedEngines];
  const schemaNames = [...supportedSchemas];
  const capabilities = [...supportedCapabilities];
  const policies = [...supportedPolicyVersions];
  return async (configurationInput, provenanceInput, projectFactsInput, clocks) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const configuration = parseAdapterConfiguration(configurationInput);
      if (!configuration.ok) return { ok: false, code: "ADAPTER_CONFIGURATION_REFUSED" };
      if (!validateAdapterConfigurationBinding(configuration.value, provenanceInput).ok)
        return { ok: false, code: "ADAPTER_BINDING_REFUSED" };
      const config = configuration.value;
      if (
        config.adapterId !== adapterId ||
        config.adapterVersion !== adapterVersion ||
        config.engineVersion !== engineVersion ||
        !engines.includes(engineVersion) ||
        schemas.some((schema) => !schemaNames.includes(schema)) ||
        config.capabilityNames.some((name) => !capabilities.includes(name)) ||
        !policies.includes(policyVersion) ||
        policyVersion.length > 63 ||
        !versionPattern.test(policyVersion) ||
        [engines, schemaNames, capabilities, policies].some(
          (values) => new Set(values).size !== values.length,
        )
      )
        return { ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" };
      const projectFacts = validateProjectFactsBinding(projectFactsInput, config);
      if (!projectFacts.ok || projectFacts.value.state !== "COMPLETE")
        return { ok: false, code: "PROJECT_SNAPSHOT_REFUSED" };
      const retained = projectFacts.value;

      const monotonicNow = clocks.monotonicNow;
      let lastTime = monotonicNow();
      if (!Number.isSafeInteger(lastTime) || lastTime < 0) throw new Error("clock refused");
      const started = lastTime;
      let clockFailed = false;
      const remaining = () => {
        if (clockFailed) throw new Error("clock refused");
        try {
          const now = monotonicNow();
          if (!Number.isSafeInteger(now) || now < lastTime) throw new Error("clock refused");
          lastTime = now;
          return 5000 - (now - started);
        } catch (error) {
          clockFailed = true;
          throw error;
        }
      };
      const observedAt = clocks.wallNow();
      if (!isCanonicalTimestamp(observedAt)) throw new Error("clock refused");
      const common = {
        adapterConfigurationDigest: canonicalDigest(config),
        observationId: freshObservationId(observedAt, retained.observationId),
        observedAt,
        policyVersion,
        projectFactsDigest: canonicalDigest(retained),
        projectId: config.projectId,
        schemaVersion: "project-breaker-facts/v1" as const,
      };
      const finish = (arm: Arm): CurrentPolicyResult => {
        const selected = remaining() <= 0 ? timeoutArm : arm;
        const bound = validateProjectBreakerFactsBinding(
          { ...common, ...selected },
          config,
          retained,
          policyVersion,
        );
        if (!bound.ok) throw new Error("SDK facts refused");
        if (remaining() <= 0 && selected !== timeoutArm) return finish(timeoutArm);
        return Object.freeze({ ok: true, facts: bound.value });
      };
      const unknown = (reason: Extract<Arm, { state: "UNKNOWN" }>["reason"]) =>
        finish({ state: "UNKNOWN", reason });
      const unavailable = () => finish({ state: "UNAVAILABLE", reason: "SOURCE_UNAVAILABLE" });
      const request: CurrentPolicyRequest = Object.freeze({
        capabilityNames: Object.freeze([...config.capabilityNames]),
        observationId: common.observationId,
        policyVersion,
        projectFacts: retained,
      });
      // Initial clock failure terminates before entering adapter code.
      const delay = remaining();
      if (delay <= 0) return finish(timeoutArm);
      const timeout = new Promise<Settlement>((resolve) => {
        const check = () => {
          try {
            const remainingMs = remaining();
            if (remainingMs <= 0) resolve({ kind: "TIMEOUT" });
            else timer = setTimeout(check, remainingMs);
          } catch {
            resolve({ kind: "INTERNAL" });
          }
        };
        timer = setTimeout(check, delay);
      });
      if (remaining() <= 0) return finish(timeoutArm);
      let pending: unknown;
      try {
        pending = readCurrentPolicy(request);
      } catch {
        return unavailable();
      }
      // Never assimilate thenables or invoke callback-supplied then/constructor.
      if (
        !types.isPromise(pending) ||
        Object.getPrototypeOf(pending) !== Promise.prototype ||
        Object.hasOwn(pending, "constructor")
      )
        return unknown("MALFORMED_OBSERVATION");
      const settled: Settlement = await Promise.race([
        Promise.prototype.then.call(
          pending,
          (value: unknown): Settlement => ({ kind: "RESPONSE", value }),
          (): Settlement => ({ kind: "REJECTED" }),
        ) as Promise<Settlement>,
        timeout,
      ]);
      if (settled.kind === "INTERNAL") return { ok: false, code: "INTERNAL_ERROR" };
      if (remaining() <= 0 || settled.kind === "TIMEOUT") return finish(timeoutArm);
      if (settled.kind === "REJECTED") return unavailable();
      if (settled.kind !== "RESPONSE") throw new Error("unreachable settlement");
      const response = parseResponse(settled.value, retained);
      if (remaining() <= 0) return finish(timeoutArm);
      if (!response) return unknown("MALFORMED_OBSERVATION");
      if (
        response.observationId !== common.observationId ||
        response.policyVersion !== policyVersion ||
        response.projectFactsDigest !== common.projectFactsDigest
      )
        return unknown("CHANGED_BINDING");
      if (response.state === "COMPLETE") {
        if (
          canonicalDigest(response.frontier) !== canonicalDigest(retained.frontier) ||
          canonicalJson(response.frontier) !== canonicalJson(retained.frontier)
        )
          return unknown("CHANGED_SOURCE");
        if (
          response.decisions.length !== config.capabilityNames.length ||
          response.decisions.some(
            (row, index) => row.capabilityName !== config.capabilityNames[index],
          )
        )
          return unknown("INCOMPLETE_CAPABILITIES");
        return finish({ state: "COMPLETE", decisions: response.decisions });
      }
      return response.state === "UNKNOWN" ? unknown("SOURCE_UNKNOWN") : unavailable();
    } catch {
      return { ok: false, code: "INTERNAL_ERROR" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

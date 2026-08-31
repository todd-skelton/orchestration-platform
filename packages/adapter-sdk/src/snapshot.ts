import { randomBytes } from "node:crypto";
import { types } from "node:util";
import {
  canonicalDigest,
  closedRecord,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  parseAdapterConfiguration,
  projectSnapshotSchemaFields,
  snapshotJson,
  validateAdapterConfigurationBinding,
  type ContractRecord,
  type ProjectFacts,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";

export type SnapshotRequest = Readonly<{ cursor: string | null; observationId: string }>;
export type SnapshotReadPage = (request: SnapshotRequest) => unknown;
export type SnapshotClocks = Readonly<{
  wallNow: () => string;
  monotonicNow: () => number;
}>;
export type SnapshotResult =
  | Readonly<{ ok: true; facts: ProjectFacts }>
  | Readonly<{
      ok: false;
      code:
        | "ADAPTER_CONFIGURATION_REFUSED"
        | "ADAPTER_BINDING_REFUSED"
        | "ADAPTER_COMPATIBILITY_REFUSED"
        | "INTERNAL_ERROR";
    }>;
export type SnapshotReader = (
  configuration: unknown,
  loadedProvenance: unknown,
  clocks: SnapshotClocks,
) => Promise<SnapshotResult>;
type ObservationRow = Omit<ProjectFrontierRow, "readiness"> & {
  readonly readiness: "READY" | "NOT_READY" | "UNKNOWN" | "UNAVAILABLE";
};
type Page =
  | Readonly<{
      state: "COMPLETE";
      cursor: string | null;
      nextCursor: string | null;
      observationId: string;
      frontier: readonly ObservationRow[];
      frontierDigest: string;
    }>
  | Readonly<{ state: "UNKNOWN"; observationId: string; reason: "SOURCE_UNKNOWN" }>
  | Readonly<{ state: "UNAVAILABLE"; observationId: string; reason: "SOURCE_UNAVAILABLE" }>;
type Settlement = { kind: "PAGE"; value: unknown } | { kind: "REJECTED" | "TIMEOUT" | "INTERNAL" };

const engineVersion = "0.0.0";
const schemas = ["adapter-configuration/v1", "project-facts/v1"] as const;
const cursorPattern = /^[A-Za-z0-9._:-]{1,256}(?![\s\S])/;
const namePattern = /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/;
const cursorValid = (value: unknown) =>
  value === null || (typeof value === "string" && cursorPattern.test(value));

// Shape/scalar validation is deliberately separate from cross-page relations.
function parsePage(input: unknown): Page | null {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return null;
  const value = snapshot.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as ContractRecord;
  const complete = page.state === "COMPLETE";
  if (
    closedRecord(
      value,
      complete
        ? ["cursor", "frontier", "frontierDigest", "nextCursor", "observationId", "state"]
        : ["observationId", "reason", "state"],
    ).length ||
    !isUuidV7(page.observationId) ||
    page.observationId.length !== 36
  )
    return null;
  if (!complete)
    return (page.state === "UNKNOWN" && page.reason === "SOURCE_UNKNOWN") ||
      (page.state === "UNAVAILABLE" && page.reason === "SOURCE_UNAVAILABLE")
      ? (page as Page)
      : null;
  if (
    !cursorValid(page.cursor) ||
    !cursorValid(page.nextCursor) ||
    !isSha256(page.frontierDigest) ||
    page.frontierDigest.length !== 64 ||
    !Array.isArray(page.frontier) ||
    page.frontier.length > 64
  )
    return null;
  for (const row of page.frontier) {
    if (closedRecord(row, projectSnapshotSchemaFields.frontierRow).length) return null;
    if (
      !isUuidV7(row.workId) ||
      row.workId.length !== 36 ||
      !isSha256(row.immutableSubjectDigest) ||
      row.immutableSubjectDigest.length !== 64 ||
      !["READY", "NOT_READY", "UNKNOWN", "UNAVAILABLE"].includes(row.readiness) ||
      !Array.isArray(row.capabilityNames) ||
      row.capabilityNames.length > 256 ||
      row.capabilityNames.some(
        (name: unknown, index: number) =>
          typeof name !== "string" ||
          !namePattern.test(name) ||
          (index > 0 && row.capabilityNames[index - 1] >= name),
      )
    )
      return null;
  }
  return page as Page;
}

function freshObservationId(observedAt: string): string {
  const milliseconds = Date.parse(observedAt);
  if (milliseconds < 0 || milliseconds > 0xffffffffffff) throw new Error("clock refused");
  const bytes = randomBytes(16);
  bytes.writeUIntBE(milliseconds, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Trusted source composition, not a data descriptor or plugin registration.
 * Bind reviewed constants to their actual callback once. This API grants no
 * authority and must never receive support claims loaded from configuration.
 */
export function createProjectSnapshotReader(
  readPage: SnapshotReadPage,
  adapterId: string,
  adapterVersion: string,
  supportedEngines: readonly string[],
  supportedSchemas: readonly string[],
  supportedCapabilities: readonly string[],
): SnapshotReader {
  const engines = [...supportedEngines];
  const schemaNames = [...supportedSchemas];
  const capabilities = [...supportedCapabilities];
  return async (configurationInput, provenanceInput, clocks) => {
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
        [engines, schemaNames, capabilities].some(
          (values) => new Set(values).size !== values.length,
        )
      )
        return { ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" };

      const monotonicNow = clocks.monotonicNow;
      let lastTime = monotonicNow();
      if (!Number.isSafeInteger(lastTime) || lastTime < 0) throw new Error("clock refused");
      const started = lastTime;
      const remaining = () => {
        const now = monotonicNow();
        if (!Number.isSafeInteger(now) || now < lastTime) throw new Error("clock refused");
        lastTime = now;
        return 5000 - (now - started);
      };
      const observedAt = clocks.wallNow();
      if (!isCanonicalTimestamp(observedAt)) throw new Error("clock refused");
      const common = {
        adapterConfigurationDigest: canonicalDigest(config),
        observationId: freshObservationId(observedAt),
        observedAt,
        projectId: config.projectId,
        schemaVersion: "project-facts/v1" as const,
      };
      const unknown = (
        reason: Extract<ProjectFacts, { state: "UNKNOWN" }>["reason"],
      ): SnapshotResult =>
        remaining() <= 0
          ? unavailable("OBSERVATION_TIMEOUT")
          : {
              ok: true,
              facts: Object.freeze({ ...common, state: "UNKNOWN", reason }),
            };
      const unavailable = (
        reason: Extract<ProjectFacts, { state: "UNAVAILABLE" }>["reason"],
      ): SnapshotResult => ({
        ok: true,
        facts: Object.freeze({
          ...common,
          state: "UNAVAILABLE",
          reason: remaining() <= 0 ? "OBSERVATION_TIMEOUT" : reason,
        }),
      });
      // Initial clock failure must terminate synchronously, before readPage.
      const initialDelay = remaining();
      const timeout = new Promise<Settlement>((resolve) => {
        const check = () => {
          try {
            const delay = remaining();
            if (delay <= 0) resolve({ kind: "TIMEOUT" });
            else timer = setTimeout(check, delay);
          } catch {
            resolve({ kind: "INTERNAL" });
          }
        };
        if (initialDelay <= 0) resolve({ kind: "TIMEOUT" });
        else timer = setTimeout(check, initialDelay);
      });
      const frontier: ProjectFrontierRow[] = [];
      const workIds = new Set<string>();
      const continuations = new Set<string>();
      const allowed = new Set(config.capabilityNames);
      let cursor: string | null = null;
      let declaredDigest: string | undefined;
      for (let pageCount = 1; pageCount <= 64; pageCount++) {
        if (remaining() <= 0) return unavailable("OBSERVATION_TIMEOUT");
        let pending: unknown;
        try {
          pending = readPage(Object.freeze({ cursor, observationId: common.observationId }));
        } catch {
          return remaining() <= 0
            ? unavailable("OBSERVATION_TIMEOUT")
            : unavailable("SOURCE_UNAVAILABLE");
        }
        // No thenable assimilation or callback-supplied .then/constructor code.
        if (
          !types.isPromise(pending) ||
          Object.getPrototypeOf(pending) !== Promise.prototype ||
          Object.hasOwn(pending, "constructor")
        )
          return unknown("MALFORMED_OBSERVATION");
        const settled: Settlement = await Promise.race([
          Promise.prototype.then.call(
            pending,
            (value: unknown): Settlement => ({ kind: "PAGE", value }),
            (): Settlement => ({ kind: "REJECTED" }),
          ) as Promise<Settlement>,
          timeout,
        ]);
        if (settled.kind === "INTERNAL") return { ok: false, code: "INTERNAL_ERROR" };
        if (remaining() <= 0 || settled.kind === "TIMEOUT")
          return unavailable("OBSERVATION_TIMEOUT");
        if (settled.kind === "REJECTED") return unavailable("SOURCE_UNAVAILABLE");
        if (settled.kind !== "PAGE") throw new Error("unreachable settlement");
        const page = parsePage(settled.value);
        if (remaining() <= 0) return unavailable("OBSERVATION_TIMEOUT");
        if (!page) return unknown("MALFORMED_OBSERVATION");
        if (page.observationId !== common.observationId) return unknown("CHANGED_FRONTIER");
        if (page.state !== "COMPLETE")
          return page.state === "UNKNOWN"
            ? unknown("SOURCE_UNKNOWN")
            : unavailable("SOURCE_UNAVAILABLE");
        const currentIds = new Set(page.frontier.map((row) => row.workId));
        // Relations: CHANGED > INCOMPLETE > MALFORMED; readiness comes last.
        if (
          page.cursor !== cursor ||
          (declaredDigest !== undefined && page.frontierDigest !== declaredDigest) ||
          currentIds.size !== page.frontier.length ||
          page.frontier.some((row) => workIds.has(row.workId))
        )
          return unknown("CHANGED_FRONTIER");
        if (page.nextCursor !== null && (pageCount === 64 || continuations.has(page.nextCursor)))
          return unknown("INCOMPLETE_FRONTIER");
        const combined = [...frontier, ...page.frontier].sort((a, b) =>
          a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0,
        );
        if (
          combined.length > 4096 ||
          page.frontier.some((row) => row.capabilityNames.some((name) => !allowed.has(name))) ||
          (page.nextCursor === null && canonicalDigest(combined) !== page.frontierDigest)
        )
          return unknown("MALFORMED_OBSERVATION");
        if (page.frontier.some((row) => row.readiness === "UNKNOWN"))
          return unknown("SOURCE_UNKNOWN");
        if (page.frontier.some((row) => row.readiness === "UNAVAILABLE"))
          return unavailable("SOURCE_UNAVAILABLE");
        if (remaining() <= 0) return unavailable("OBSERVATION_TIMEOUT");
        frontier.push(...(page.frontier as readonly ProjectFrontierRow[]));
        if (page.nextCursor === null)
          return {
            ok: true,
            facts: Object.freeze({
              ...common,
              state: "COMPLETE",
              frontier: Object.freeze(combined as ProjectFrontierRow[]),
              frontierDigest: page.frontierDigest,
            }),
          };
        for (const workId of currentIds) workIds.add(workId);
        continuations.add(page.nextCursor);
        cursor = page.nextCursor;
        declaredDigest = page.frontierDigest;
      }
      return unknown("INCOMPLETE_FRONTIER");
    } catch {
      return { ok: false, code: "INTERNAL_ERROR" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

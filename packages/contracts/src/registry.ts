import { legacySchemaDefinitions } from "./definitions.js";
import { v2Definitions } from "./v2.js";
import type { SchemaDefinition } from "./runtime.js";

export const supersededAuthorityVersions = Object.freeze([
  "activation-cleanup-gate-archive/v1",
  "activation-cleanup-gate-current/v1",
  "activation-cleanup-gate-head/v1",
  "activation-cleanup-gate-root/v1",
  "activation-cleanup-head/v1",
  "activation-recovery-fence-current/v1",
  "activation-recovery-fence-head/v1",
  "activation-recovery-fence-root/v1",
  "activation-recovery-launch-archive/v1",
  "activation-recovery-launch-current/v1",
  "activation-recovery-launch/v1",
  "active-release/v1",
  "recovery-authorization/v1",
] as const);

const superseded = new Set<string>(supersededAuthorityVersions);

export const diagnosticSchemaDefinitions: Readonly<Record<string, SchemaDefinition>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(legacySchemaDefinitions).filter(([schemaVersion]) =>
        superseded.has(schemaVersion),
      ),
    ),
  );

export const schemaDefinitions: Readonly<Record<string, SchemaDefinition>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(legacySchemaDefinitions).filter(
      ([schemaVersion]) => !superseded.has(schemaVersion),
    ),
  ),
  ...v2Definitions,
});

export const schemaVersions = Object.freeze(Object.keys(schemaDefinitions).sort());
export const diagnosticSchemaVersions = Object.freeze(
  Object.keys(diagnosticSchemaDefinitions).sort(),
);

export type CompatibilityDisposition = "readable" | "migratable" | "refused";
export function compatibilityDisposition(
  expectedSchemaVersion: string,
  observedSchemaVersion: string | null,
): CompatibilityDisposition {
  if (!Object.hasOwn(schemaDefinitions, expectedSchemaVersion)) return "refused";
  if (observedSchemaVersion === expectedSchemaVersion) return "readable";
  if (
    expectedSchemaVersion === "platform-configuration/v1" &&
    observedSchemaVersion === "platform-configuration/v0-fixture"
  )
    return "migratable";
  return "refused";
}

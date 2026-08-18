import { compatibilityDisposition, schemaDefinitions, schemaVersions } from "./registry.js";
import {
  canonicalBytes,
  canonicalDigest,
  parseCanonicalBytes,
  snapshotClosedRecord,
  validateDefinition,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

export * from "./definitions.js";
export * from "./pointer.js";
export * from "./vocabulary.js";
export type * from "./runtime.js";
export {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  closedArray,
  closedRecord,
  compareCanonicalDecimal,
  frame,
  framedBytes,
  framedDigest,
  incrementCanonicalDecimal,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUnicodeScalarSequence,
  isUuidV7,
  parseCanonicalDecimal,
  snapshotClosedArray,
  snapshotClosedRecord,
  snapshotJson,
} from "./runtime.js";
export { compatibilityDisposition, schemaDefinitions, schemaVersions } from "./registry.js";

export function parseContract(expectedSchemaVersion: string, input: unknown): ParseResult {
  const definition = schemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:unsupported"] };
  try {
    return validateDefinition(definition, input);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export function parseCanonicalContractBytes(
  expectedSchemaVersion: string,
  bytes: Uint8Array,
): ParseResult {
  const definition = schemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:unsupported"] };
  try {
    return parseCanonicalBytes(definition, bytes);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export type SerializationResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };
export function serializeContract(
  expectedSchemaVersion: string,
  input: unknown,
): SerializationResult {
  const parsed = parseContract(expectedSchemaVersion, input);
  if (!parsed.ok) return parsed;
  return { ok: true, bytes: canonicalBytes(parsed.value), digest: canonicalDigest(parsed.value) };
}

export interface CompatibilityRow {
  readonly expectedSchemaVersion: string;
  readonly observedSchemaVersion: string | null;
  readonly disposition: "readable" | "migratable" | "refused";
}
export const compatibilityMatrix: readonly CompatibilityRow[] = Object.freeze(
  schemaVersions.flatMap((expectedSchemaVersion) => {
    const family = expectedSchemaVersion.slice(0, expectedSchemaVersion.lastIndexOf("/"));
    return [expectedSchemaVersion, `${family}/v0-fixture`, `${family}/v999`, null].map(
      (observedSchemaVersion) =>
        Object.freeze({
          expectedSchemaVersion,
          observedSchemaVersion,
          disposition: compatibilityDisposition(expectedSchemaVersion, observedSchemaVersion),
        }),
    );
  }),
);

export type MigrationResult =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };
export function migrateNamedLegacyFixture(input: unknown): MigrationResult {
  try {
    const closed = snapshotClosedRecord(input, [
      "schemaVersion",
      "adapterId",
      "projectId",
      "stateRoot",
    ]);
    if (!closed.ok) return { ok: false, issues: closed.issues.map((issue) => `legacy:${issue}`) };
    if (closed.value.schemaVersion !== "platform-configuration/v0-fixture")
      return { ok: false, issues: ["legacy:not-named-fixture"] };
    const migrated = {
      schemaVersion: "platform-configuration/v1",
      adapterId: closed.value.adapterId,
      capabilityNames: [],
      leaseFreshnessMs: 3_600_000,
      maximumSessionMs: 86_400_000,
      projectId: closed.value.projectId,
      stateRoot: closed.value.stateRoot,
      wallClockSkewMs: 300_000,
    };
    const parsed = parseContract("platform-configuration/v1", migrated);
    return parsed.ok ? parsed : { ok: false, issues: parsed.issues };
  } catch {
    return { ok: false, issues: ["legacy:unreadable"] };
  }
}

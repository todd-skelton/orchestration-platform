import { isUuidV7, type ContractDefinition, type ContractRecord } from "./runtime.js";

const platformConfiguration: ContractDefinition = Object.freeze({
  schemaVersion: "platform-configuration/v1",
  fields: Object.freeze([
    "schemaVersion",
    "adapterId",
    "capabilityNames",
    "leaseFreshnessMs",
    "maximumSessionMs",
    "projectId",
    "stateRoot",
    "wallClockSkewMs",
  ]),
  validate(record: ContractRecord): readonly string[] {
    const issues: string[] = [];
    if (
      typeof record.adapterId !== "string" ||
      !/^[a-z0-9][a-z0-9._:@+-]{0,127}$/.test(record.adapterId)
    )
      issues.push("adapterId:invalid");
    if (
      !Array.isArray(record.capabilityNames) ||
      record.capabilityNames.some((item) => typeof item !== "string")
    )
      issues.push("capabilityNames:invalid");
    if (!isUuidV7(record.projectId)) issues.push("projectId:invalid");
    if (typeof record.stateRoot !== "string" || !record.stateRoot.startsWith("file:///"))
      issues.push("stateRoot:invalid");
    for (const name of ["leaseFreshnessMs", "maximumSessionMs", "wallClockSkewMs"] as const)
      if (
        typeof record[name] !== "number" ||
        !Number.isSafeInteger(record[name]) ||
        Number(record[name]) < 0
      )
        issues.push(`${name}:invalid`);
    if (
      Number(record.leaseFreshnessMs) <= 0 ||
      Number(record.leaseFreshnessMs) > Number(record.maximumSessionMs)
    )
      issues.push("leaseFreshnessMs:out-of-range");
    if (Number(record.maximumSessionMs) <= 0 || Number(record.maximumSessionMs) > 86_400_000)
      issues.push("maximumSessionMs:out-of-range");
    if (Number(record.wallClockSkewMs) > 300_000) issues.push("wallClockSkewMs:out-of-range");
    return Object.freeze(issues);
  },
});

export const schemaDefinitions: Readonly<Record<string, ContractDefinition>> = Object.freeze({
  [platformConfiguration.schemaVersion]: platformConfiguration,
});
export const schemaVersions = Object.freeze(Object.keys(schemaDefinitions).sort());
export type CompatibilityDisposition = "readable" | "migratable" | "refused";
export function compatibilityDisposition(
  expectedSchemaVersion: string,
  observedSchemaVersion: string | null,
): CompatibilityDisposition {
  if (!Object.hasOwn(schemaDefinitions, expectedSchemaVersion)) return "refused";
  if (observedSchemaVersion === expectedSchemaVersion) return "readable";
  return expectedSchemaVersion === "platform-configuration/v1" &&
    observedSchemaVersion === "platform-configuration/v0-fixture"
    ? "migratable"
    : "refused";
}

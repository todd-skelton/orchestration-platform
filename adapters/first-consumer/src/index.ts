import { types } from "node:util";

export const firstConsumerAdapterId = "first-consumer" as const;
export const firstConsumerAdapterVersion = "0.0.0" as const;
export const firstConsumerSdkVersion = "0.0.0" as const;
export const firstConsumerEngineVersions = Object.freeze(["0.0.0"] as const);
export const firstConsumerCapabilityNames = Object.freeze([
  "project.import",
  "project.mutation",
  "project.shadow",
] as const);
export const firstConsumerSchemaVersions = Object.freeze([
  "adapter-configuration/v1",
  "configuration-provenance/v1",
  "project-breaker-facts/v1",
  "project-facts/v1",
] as const);

export const firstConsumerExtensions = Object.freeze([
  Object.freeze({
    capabilityName: "project.import",
    exportPath: "./import",
    extensionId: "import",
    owner: "ISS-024",
  }),
  Object.freeze({
    capabilityName: "project.mutation",
    exportPath: "./mutation",
    extensionId: "mutation",
    owner: "ISS-018",
  }),
  Object.freeze({
    capabilityName: "project.shadow",
    exportPath: "./shadow",
    extensionId: "shadow",
    owner: "ISS-017",
  }),
] as const);

export type FirstConsumerCompatibility = Readonly<{
  adapterId: typeof firstConsumerAdapterId;
  adapterVersion: typeof firstConsumerAdapterVersion;
  capabilityNames: typeof firstConsumerCapabilityNames;
  engineVersion: (typeof firstConsumerEngineVersions)[number];
  schemaVersions: typeof firstConsumerSchemaVersions;
  sdkVersion: typeof firstConsumerSdkVersion;
}>;

export type FirstConsumerCompatibilityResult =
  | Readonly<{ ok: true; value: FirstConsumerCompatibility }>
  | Readonly<{ ok: false; code: "ADAPTER_COMPATIBILITY_REFUSED" }>;

const compatibilityFields = Object.freeze([
  "adapterId",
  "adapterVersion",
  "capabilityNames",
  "engineVersion",
  "schemaVersions",
  "sdkVersion",
] as const);

function exactArray(value: unknown, expected: readonly string[]): boolean {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)),
    ) ||
    lengthDescriptor?.value !== expected.length
  )
    return false;
  return expected.every((entry, index) => {
    const descriptor = descriptors[String(index)];
    return (
      descriptor !== undefined &&
      Object.hasOwn(descriptor, "value") &&
      descriptor.value === entry &&
      descriptor.enumerable === true
    );
  });
}

/**
 * Pure static admission only. It invokes no adapter, extension, filesystem,
 * process, network, clock, credential, or mutation boundary.
 */
export function admitFirstConsumerCompatibility(input: unknown): FirstConsumerCompatibilityResult {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      types.isProxy(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    )
      throw new TypeError("record refused");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      Reflect.ownKeys(descriptors).length !== compatibilityFields.length ||
      compatibilityFields.some((field) => {
        const descriptor = descriptors[field];
        return (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true
        );
      }) ||
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== "string" || !compatibilityFields.includes(key as never),
      )
    )
      throw new TypeError("fields refused");
    const value = input as Record<string, unknown>;
    if (
      value.adapterId !== firstConsumerAdapterId ||
      value.adapterVersion !== firstConsumerAdapterVersion ||
      value.engineVersion !== firstConsumerEngineVersions[0] ||
      value.sdkVersion !== firstConsumerSdkVersion ||
      !exactArray(value.capabilityNames, firstConsumerCapabilityNames) ||
      !exactArray(value.schemaVersions, firstConsumerSchemaVersions)
    )
      throw new TypeError("compatibility refused");
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        adapterId: firstConsumerAdapterId,
        adapterVersion: firstConsumerAdapterVersion,
        capabilityNames: firstConsumerCapabilityNames,
        engineVersion: firstConsumerEngineVersions[0],
        schemaVersions: firstConsumerSchemaVersions,
        sdkVersion: firstConsumerSdkVersion,
      }),
    });
  } catch {
    return Object.freeze({ ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" });
  }
}

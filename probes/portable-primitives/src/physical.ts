import {
  computeBootstrapDestinationIdentityDigest,
  computePhysicalDestinationIdentityDigest,
  frame,
  framedDigest,
  isSha256,
  parsePhysicalDestinationIdentity,
  type ContractRecord,
} from "@orchestration-platform/contracts";
import { computePortableHostCustodyNamespaceDigest } from "./profiles.js";

export type PortablePhysicalOperatingSystem = "DARWIN" | "LINUX" | "WINDOWS";
export type PortableLeafIdentityKind = "ABSENT_DIRECTORY_ENTRY" | "EXISTING_DIRECTORY_ENTRY";
export type PortableConformanceArchitecture = "ARM64" | "X64";
export type PortableConformanceOperatingSystem = "LINUX" | "MACOS" | "WINDOWS";

const jobIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const u32Limit = 1n << 32n;
const u64Limit = 1n << 64n;

function digest(value: string, name: string): string {
  if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function operatingSystem(value: PortablePhysicalOperatingSystem): PortablePhysicalOperatingSystem {
  if (value !== "DARWIN" && value !== "LINUX" && value !== "WINDOWS")
    throw new TypeError("operatingSystem:invalid");
  return value;
}

function unsignedHex(value: bigint, limit: bigint, bytes: 4 | 8, name: string): string {
  if (typeof value !== "bigint" || value < 0n || value >= limit)
    throw new TypeError(`${name}:invalid`);
  return value.toString(16).padStart(bytes * 2, "0");
}

export function portableU64Hex(value: bigint, name = "u64"): string {
  return unsignedHex(value, u64Limit, 8, name);
}

export function portableU32Hex(value: bigint, name = "u32"): string {
  return unsignedHex(value, u32Limit, 4, name);
}

export function portableStatfsTypeU64Hex(value: bigint): string {
  if (typeof value !== "bigint") throw new TypeError("filesystemType:invalid");
  return BigInt.asUintN(64, value).toString(16).padStart(16, "0");
}

function canonicalLeafHex(
  canonicalPhysicalLeafBytes: string,
  os: PortablePhysicalOperatingSystem,
): string {
  const parsed = parsePhysicalDestinationIdentity({
    ancestorObjectIdentityDigest: "0".repeat(64),
    canonicalPhysicalLeafBytes,
    filesystemIdentityDigest: "0".repeat(64),
    hostCustodyNamespaceDigest: "0".repeat(64),
    leafIdentityKind: "ABSENT_DIRECTORY_ENTRY",
    operatingSystem: operatingSystem(os),
    physicalVolumeIdentityDigest: "0".repeat(64),
    schemaVersion: "physical-destination-identity/v1",
  });
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return Buffer.from(canonicalPhysicalLeafBytes, "base64url").toString("hex");
}

export function computePortablePhysicalVolumeDigest(
  hostCustodyNamespaceDigest: string,
  os: PortablePhysicalOperatingSystem,
  rootStatDevice: bigint,
): string {
  return framedDigest("portable-physical-volume-identity/v1", [
    frame.raw32(digest(hostCustodyNamespaceDigest, "hostCustodyNamespaceDigest")),
    frame.text(operatingSystem(os)),
    frame.fixed(portableU64Hex(rootStatDevice, "rootStatDevice")),
  ]);
}

export function computePortableFilesystemDigest(
  physicalVolumeIdentityDigest: string,
  os: PortablePhysicalOperatingSystem,
  filesystemType: bigint,
): string {
  return framedDigest("portable-filesystem-identity/v1", [
    frame.raw32(digest(physicalVolumeIdentityDigest, "physicalVolumeIdentityDigest")),
    frame.text(operatingSystem(os)),
    frame.fixed(portableStatfsTypeU64Hex(filesystemType)),
  ]);
}

export function computePortableAncestorObjectDigest(
  physicalVolumeIdentityDigest: string,
  filesystemIdentityDigest: string,
  rootStatDevice: bigint,
  rootStatInode: bigint,
  rootStatMode: bigint,
): string {
  return framedDigest("portable-ancestor-object-identity/v1", [
    frame.raw32(digest(physicalVolumeIdentityDigest, "physicalVolumeIdentityDigest")),
    frame.raw32(digest(filesystemIdentityDigest, "filesystemIdentityDigest")),
    frame.fixed(portableU64Hex(rootStatDevice, "rootStatDevice")),
    frame.fixed(portableU64Hex(rootStatInode, "rootStatInode")),
    frame.fixed(portableU32Hex(rootStatMode, "rootStatMode")),
  ]);
}

export function computePortableLogicalLocatorDigest(
  hostCustodyNamespaceDigest: string,
  canonicalPhysicalLeafBytes: string,
  os: PortablePhysicalOperatingSystem,
): string {
  return framedDigest("portable-logical-locator/v1", [
    frame.raw32(digest(hostCustodyNamespaceDigest, "hostCustodyNamespaceDigest")),
    frame.fixed(canonicalLeafHex(canonicalPhysicalLeafBytes, os)),
  ]);
}

export function computePortableResolvedLocatorReadbackDigest(
  ancestorObjectIdentityDigest: string,
  canonicalPhysicalLeafBytes: string,
  os: PortablePhysicalOperatingSystem,
): string {
  return framedDigest("portable-resolved-locator-readback/v1", [
    frame.raw32(digest(ancestorObjectIdentityDigest, "ancestorObjectIdentityDigest")),
    frame.fixed(canonicalLeafHex(canonicalPhysicalLeafBytes, os)),
  ]);
}

export function computePortableNativeIdentityReadbackDigest(
  physicalVolumeIdentityDigest: string,
  filesystemIdentityDigest: string,
  ancestorObjectIdentityDigest: string,
  leafIdentityKind: PortableLeafIdentityKind,
): string {
  if (
    leafIdentityKind !== "ABSENT_DIRECTORY_ENTRY" &&
    leafIdentityKind !== "EXISTING_DIRECTORY_ENTRY"
  )
    throw new TypeError("leafIdentityKind:invalid");
  return framedDigest("portable-native-identity-readback/v1", [
    frame.raw32(digest(physicalVolumeIdentityDigest, "physicalVolumeIdentityDigest")),
    frame.raw32(digest(filesystemIdentityDigest, "filesystemIdentityDigest")),
    frame.raw32(digest(ancestorObjectIdentityDigest, "ancestorObjectIdentityDigest")),
    frame.text(leafIdentityKind),
  ]);
}

export function computePortableCustodyRootReadbackDigest(
  hostCustodyNamespaceDigest: string,
  physicalVolumeIdentityDigest: string,
  filesystemIdentityDigest: string,
  ancestorObjectIdentityDigest: string,
): string {
  return framedDigest("portable-custody-root-readback/v1", [
    frame.raw32(digest(hostCustodyNamespaceDigest, "hostCustodyNamespaceDigest")),
    frame.raw32(digest(physicalVolumeIdentityDigest, "physicalVolumeIdentityDigest")),
    frame.raw32(digest(filesystemIdentityDigest, "filesystemIdentityDigest")),
    frame.raw32(digest(ancestorObjectIdentityDigest, "ancestorObjectIdentityDigest")),
  ]);
}

export function computePortablePrimitivesPreCustodyEnvironmentDigest(
  helperAbiDigest: string,
  architecture: PortableConformanceArchitecture,
  osProfileDigest: string,
  helperProfileDigest: string,
  nodeVersion: string,
  os: PortableConformanceOperatingSystem,
  osImageDigest: string,
  packageManagerVersion: string,
): string {
  if (architecture !== "ARM64" && architecture !== "X64")
    throw new TypeError("architecture:invalid");
  if (os !== "LINUX" && os !== "MACOS" && os !== "WINDOWS")
    throw new TypeError("operatingSystem:invalid");
  if (!/^24\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(nodeVersion))
    throw new TypeError("nodeVersion:invalid");
  if (!/^11\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(packageManagerVersion))
    throw new TypeError("packageManagerVersion:invalid");
  return framedDigest("portable-primitives-pre-custody-environment/v1", [
    frame.raw32(digest(helperAbiDigest, "helperAbiDigest")),
    frame.text(architecture),
    frame.raw32(digest(osProfileDigest, "osProfileDigest")),
    frame.raw32(digest(helperProfileDigest, "helperProfileDigest")),
    frame.text(nodeVersion),
    frame.text(os),
    frame.raw32(digest(osImageDigest, "osImageDigest")),
    frame.text(packageManagerVersion),
    frame.text("EPHEMERAL_HOSTED"),
  ]);
}

export function computePortableProbeCustodyInstanceDigest(
  hostCustodyNamespaceDigest: string,
  preCustodyEnvironmentDigest: string,
  providerRunDigest: string,
  jobId: string,
  rootReadbackDigest: string,
): string {
  if (typeof jobId !== "string" || !jobIdPattern.test(jobId)) throw new TypeError("jobId:invalid");
  return framedDigest("portable-probe-custody-instance/v1", [
    frame.raw32(digest(hostCustodyNamespaceDigest, "hostCustodyNamespaceDigest")),
    frame.raw32(digest(preCustodyEnvironmentDigest, "preCustodyEnvironmentDigest")),
    frame.raw32(digest(providerRunDigest, "providerRunDigest")),
    frame.text(jobId),
    frame.raw32(digest(rootReadbackDigest, "rootReadbackDigest")),
  ]);
}

export interface PortablePhysicalDerivationInput {
  readonly canonicalPhysicalLeafBytes: string;
  readonly filesystemType: bigint;
  readonly leafIdentityKind: PortableLeafIdentityKind;
  readonly namespaceFileHex: string;
  readonly operatingSystem: PortablePhysicalOperatingSystem;
  readonly rootStatDevice: bigint;
  readonly rootStatInode: bigint;
  readonly rootStatMode: bigint;
}

export interface PortablePhysicalDerivation {
  readonly ancestorObjectIdentityDigest: string;
  readonly destinationDigest: string;
  readonly filesystemIdentityDigest: string;
  readonly filesystemTypeBytes: string;
  readonly hostCustodyNamespaceDigest: string;
  readonly logicalLocatorDigest: string;
  readonly nativeIdentityReadbackDigest: string;
  readonly physicalDestinationIdentity: ContractRecord;
  readonly physicalDestinationIdentityDigest: string;
  readonly physicalVolumeIdentityDigest: string;
  readonly resolvedLocatorReadbackDigest: string;
  readonly rootReadbackDigest: string;
  readonly statDeviceBytes: string;
}

export function derivePortablePhysicalIdentity(
  input: PortablePhysicalDerivationInput,
): PortablePhysicalDerivation {
  const hostCustodyNamespaceDigest = computePortableHostCustodyNamespaceDigest(
    input.namespaceFileHex,
  );
  const physicalVolumeIdentityDigest = computePortablePhysicalVolumeDigest(
    hostCustodyNamespaceDigest,
    input.operatingSystem,
    input.rootStatDevice,
  );
  const filesystemIdentityDigest = computePortableFilesystemDigest(
    physicalVolumeIdentityDigest,
    input.operatingSystem,
    input.filesystemType,
  );
  const ancestorObjectIdentityDigest = computePortableAncestorObjectDigest(
    physicalVolumeIdentityDigest,
    filesystemIdentityDigest,
    input.rootStatDevice,
    input.rootStatInode,
    input.rootStatMode,
  );
  const physicalDestinationIdentity = Object.freeze({
    ancestorObjectIdentityDigest,
    canonicalPhysicalLeafBytes: input.canonicalPhysicalLeafBytes,
    filesystemIdentityDigest,
    hostCustodyNamespaceDigest,
    leafIdentityKind: input.leafIdentityKind,
    operatingSystem: input.operatingSystem,
    physicalVolumeIdentityDigest,
    schemaVersion: "physical-destination-identity/v1",
  });
  const parsed = parsePhysicalDestinationIdentity(physicalDestinationIdentity);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const physicalDestinationIdentityDigest = computePhysicalDestinationIdentityDigest(parsed.value);
  return Object.freeze({
    ancestorObjectIdentityDigest,
    destinationDigest: computeBootstrapDestinationIdentityDigest(physicalDestinationIdentityDigest),
    filesystemIdentityDigest,
    filesystemTypeBytes: portableStatfsTypeU64Hex(input.filesystemType),
    hostCustodyNamespaceDigest,
    logicalLocatorDigest: computePortableLogicalLocatorDigest(
      hostCustodyNamespaceDigest,
      input.canonicalPhysicalLeafBytes,
      input.operatingSystem,
    ),
    nativeIdentityReadbackDigest: computePortableNativeIdentityReadbackDigest(
      physicalVolumeIdentityDigest,
      filesystemIdentityDigest,
      ancestorObjectIdentityDigest,
      input.leafIdentityKind,
    ),
    physicalDestinationIdentity: parsed.value,
    physicalDestinationIdentityDigest,
    physicalVolumeIdentityDigest,
    resolvedLocatorReadbackDigest: computePortableResolvedLocatorReadbackDigest(
      ancestorObjectIdentityDigest,
      input.canonicalPhysicalLeafBytes,
      input.operatingSystem,
    ),
    rootReadbackDigest: computePortableCustodyRootReadbackDigest(
      hostCustodyNamespaceDigest,
      physicalVolumeIdentityDigest,
      filesystemIdentityDigest,
      ancestorObjectIdentityDigest,
    ),
    statDeviceBytes: portableU64Hex(input.rootStatDevice, "rootStatDevice"),
  });
}

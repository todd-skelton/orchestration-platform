import { createRequire } from "node:module";
import { resolve, win32 } from "node:path";

export type WindowsReparseFact = Readonly<{
  identity: Readonly<{
    fileId: string;
    nodeDevice: UnsignedCoordinate;
    nodeInode: UnsignedCoordinate;
    volumeSerialNumber: string;
  }>;
  kind: "DIRECTORY" | "FILE";
  reparsePoint: boolean;
  reparseTag: number | null;
}>;

export type UnsignedCoordinate = Readonly<{
  decimal: string;
  hexadecimal: string;
}>;

export type WindowsReparseFactResult =
  | Readonly<{ ok: true; value: WindowsReparseFact }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "OBSERVATION_REFUSED" | "UNSUPPORTED" }>;
    }>;

export type WindowsReparseFactAdapter = Readonly<{
  observe(path: unknown): WindowsReparseFactResult;
}>;

type NativeBinding = Readonly<{ observe: (path: string) => unknown }>;

const artifactPath = resolve(
  import.meta.dirname,
  "../../../.artifacts/native/windows-reparse-fact/windows_reparse_fact.node",
);
const require = createRequire(import.meta.url);
let binding: NativeBinding | undefined;
let bindingRefused = false;

function ownData(value: object, keys: readonly string[]): PropertyDescriptorMap | undefined {
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
      Object.keys(descriptors).sort().join("\0") !== [...keys].sort().join("\0") ||
      Object.values(descriptors).some(
        (descriptor) => !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      return undefined;
    }
    return descriptors;
  } catch {
    return undefined;
  }
}

function exactHex(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/.test(value);
}

function parseCoordinate(
  value: unknown,
  hexadecimalLength: number,
  maximum: bigint,
): UnsignedCoordinate | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const coordinate = ownData(value, ["decimal", "hexadecimal"]);
  const decimal = coordinate?.decimal?.value;
  const hexadecimal = coordinate?.hexadecimal?.value;
  if (
    coordinate === undefined ||
    typeof decimal !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(decimal) ||
    decimal.length > 20 ||
    !exactHex(hexadecimal, hexadecimalLength)
  ) {
    return undefined;
  }
  try {
    const decimalValue = BigInt(decimal);
    if (decimalValue > maximum || decimalValue !== BigInt(`0x${hexadecimal}`)) return undefined;
  } catch {
    return undefined;
  }
  return Object.freeze({ decimal, hexadecimal });
}

export function parseWindowsReparseFactForTesting(value: unknown): WindowsReparseFact | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fact = ownData(value, ["identity", "kind", "reparsePoint", "reparseTag"]);
  if (fact === undefined) return undefined;
  const identityValue = fact.identity?.value;
  if (typeof identityValue !== "object" || identityValue === null) return undefined;
  const identity = ownData(identityValue, [
    "fileId",
    "nodeDevice",
    "nodeInode",
    "volumeSerialNumber",
  ]);
  const fileId = identity?.fileId?.value;
  const nodeDevice = parseCoordinate(identity?.nodeDevice?.value, 8, 0xffff_ffffn);
  const nodeInode = parseCoordinate(identity?.nodeInode?.value, 16, 0xffff_ffff_ffff_ffffn);
  const volumeSerialNumber = identity?.volumeSerialNumber?.value;
  const kind = fact.kind?.value;
  const reparsePoint = fact.reparsePoint?.value;
  const reparseTag = fact.reparseTag?.value;
  if (
    identity === undefined ||
    !exactHex(fileId, 32) ||
    nodeDevice === undefined ||
    nodeInode === undefined ||
    !exactHex(volumeSerialNumber, 16) ||
    BigInt(nodeDevice.decimal) !== (BigInt(`0x${volumeSerialNumber}`) & 0xffff_ffffn) ||
    (kind !== "DIRECTORY" && kind !== "FILE") ||
    typeof reparsePoint !== "boolean" ||
    (reparsePoint
      ? typeof reparseTag !== "number" ||
        !Number.isInteger(reparseTag) ||
        reparseTag <= 0 ||
        reparseTag > 0xffff_ffff
      : reparseTag !== null)
  ) {
    return undefined;
  }
  return Object.freeze({
    identity: Object.freeze({
      fileId,
      nodeDevice,
      nodeInode,
      volumeSerialNumber,
    }),
    kind,
    reparsePoint,
    reparseTag,
  });
}

function inspectBinding(value: unknown): NativeBinding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const inspected = ownData(value, ["observe"]);
  return inspected !== undefined && typeof inspected.observe?.value === "function"
    ? Object.freeze({ observe: inspected.observe.value as (path: string) => unknown })
    : undefined;
}

function loadBinding(): NativeBinding | undefined {
  if (binding !== undefined) return binding;
  if (bindingRefused) return undefined;
  try {
    binding = inspectBinding(require(artifactPath));
  } catch {
    binding = undefined;
  }
  bindingRefused = binding === undefined;
  return binding;
}

function admittedLocalAbsolutePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("/") ||
    !win32.isAbsolute(value) ||
    win32.normalize(value) !== value
  ) {
    return false;
  }
  return /^[A-Za-z]:\\$/.test(win32.parse(value).root);
}

const unsupported = Object.freeze({
  error: Object.freeze({ code: "UNSUPPORTED" as const }),
  ok: false as const,
});
const refused = Object.freeze({
  error: Object.freeze({ code: "OBSERVATION_REFUSED" as const }),
  ok: false as const,
});

function observeWindowsReparseFact(path: unknown): WindowsReparseFactResult {
  if (!admittedLocalAbsolutePath(path)) return refused;
  const native = loadBinding();
  if (native === undefined) return refused;
  try {
    const value = parseWindowsReparseFactForTesting(native.observe(path));
    return value === undefined ? refused : Object.freeze({ ok: true, value });
  } catch {
    return refused;
  }
}

export function createWindowsReparseFactAdapter(
  hostOperatingSystem: unknown,
): WindowsReparseFactAdapter {
  if (hostOperatingSystem !== "WINDOWS") {
    return Object.freeze({ observe: () => unsupported });
  }
  return Object.freeze({ observe: observeWindowsReparseFact });
}

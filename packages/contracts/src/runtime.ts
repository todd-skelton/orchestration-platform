import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ContractRecord = Readonly<Record<string, JsonValue>>;
export type ParseResult<T extends ContractRecord = ContractRecord> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };
export interface ContractDefinition {
  readonly schemaVersion: string;
  readonly fields: readonly string[];
  readonly closedValues?: readonly string[];
  readonly validate?: (record: ContractRecord) => readonly string[];
}
export type SnapshotResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

const MAX_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4096;
const MAX_SAFE_DECIMAL = "9007199254740991";
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;

function fail<T>(...issues: readonly string[]): SnapshotResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function isUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function snapshotValue(
  input: unknown,
  seen: Set<object>,
  depth: number,
): SnapshotResult<JsonValue> {
  if (typeof input === "string")
    return isUnicodeScalarSequence(input)
      ? { ok: true, value: input }
      : fail("value:invalid-unicode");
  if (input === null || typeof input === "boolean") return { ok: true, value: input };
  if (typeof input === "number")
    return Number.isSafeInteger(input) && !Object.is(input, -0)
      ? { ok: true, value: input }
      : fail("value:noncanonical-number");
  if (typeof input !== "object") return fail("value:non-json");
  if (depth > MAX_DEPTH) return fail("value:maximum-depth");
  try {
    if (nodeTypes.isProxy(input)) return fail("value:proxy-refused");
    if (seen.has(input)) return fail("value:cycle-refused");
    const isArray = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      return fail(isArray ? "array:exact-prototype-required" : "record:plain-object-required");
    seen.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) return fail("value:symbol-field-refused");
    if (isArray) {
      const lengthDescriptor = descriptors.length;
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.enumerable !== false ||
        lengthDescriptor.configurable !== false
      )
        return fail("array:length-descriptor-refused");
      const length = lengthDescriptor.value as unknown;
      if (!Number.isSafeInteger(length) || Number(length) < 0 || Number(length) > MAX_ARRAY_LENGTH)
        return fail("array:length-refused");
      const expected = new Set<string>([
        ...Array.from({ length: Number(length) }, (_, index) => String(index)),
        "length",
      ]);
      if (keys.length !== expected.size || keys.some((key) => !expected.has(String(key))))
        return fail("array:keys-refused");
      const copy: JsonValue[] = [];
      for (let index = 0; index < Number(length); index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
          return fail(`array:${index}:descriptor-refused`);
        const nested = snapshotValue(descriptor.value, seen, depth + 1);
        if (!nested.ok) return fail(...nested.issues.map((issue) => `array:${index}:${issue}`));
        copy.push(nested.value);
      }
      seen.delete(input);
      return { ok: true, value: Object.freeze(copy) };
    }
    const copy: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as string[]) {
      if (!isUnicodeScalarSequence(key)) return fail("record:invalid-unicode-field");
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) return fail(`${key}:accessor-refused`);
      if (descriptor.enumerable !== true) return fail(`${key}:non-enumerable-refused`);
      const nested = snapshotValue(descriptor.value, seen, depth + 1);
      if (!nested.ok) return fail(...nested.issues.map((issue) => `${key}:${issue}`));
      copy[key] = nested.value;
    }
    seen.delete(input);
    return { ok: true, value: Object.freeze(copy) };
  } catch {
    return fail("value:unreadable");
  }
}

export function snapshotJson(input: unknown): SnapshotResult<JsonValue> {
  return snapshotValue(input, new Set(), 0);
}

export function snapshotClosedArray(input: unknown): SnapshotResult<readonly JsonValue[]> {
  const snapshot = snapshotJson(input);
  return snapshot.ok && Array.isArray(snapshot.value)
    ? { ok: true, value: snapshot.value }
    : fail(...(snapshot.ok ? ["array:array-required"] : snapshot.issues));
}

export function snapshotClosedRecord(
  input: unknown,
  expectedFields: readonly string[],
): SnapshotResult<ContractRecord> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  )
    return fail("record:object-required");
  const record = snapshot.value as ContractRecord;
  const observed = Object.keys(record).sort();
  const expected = [...expectedFields].sort();
  const issues = [
    ...expected.filter((field) => !Object.hasOwn(record, field)).map((field) => `${field}:missing`),
    ...observed
      .filter((field) => !expected.includes(field))
      .map((field) => `${field}:unknown-field`),
  ];
  return issues.length === 0 ? { ok: true, value: record } : fail(...issues);
}

export function closedRecord(
  input: JsonValue,
  expectedFields: readonly string[],
  prefix = "record",
): readonly string[] {
  if (input === null || Array.isArray(input) || typeof input !== "object")
    return [`${prefix}:object-required`];
  const observed = Object.keys(input);
  return Object.freeze([
    ...expectedFields
      .filter((field) => !Object.hasOwn(input, field))
      .map((field) => `${prefix}.${field}:missing`),
    ...observed
      .filter((field) => !expectedFields.includes(field))
      .map((field) => `${prefix}.${field}:unknown-field`),
  ]);
}

export function closedArray(
  input: JsonValue,
  maximum: number,
  prefix = "array",
): readonly string[] {
  if (!Array.isArray(input)) return [`${prefix}:array-required`];
  return input.length <= maximum ? [] : [`${prefix}:limit-exceeded`];
}

export function isSha256(value: JsonValue | undefined): value is string {
  return typeof value === "string" && sha256.test(value);
}
export function isUuidV7(value: JsonValue | undefined): value is string {
  return typeof value === "string" && uuidV7.test(value);
}
export function isCanonicalTimestamp(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const instant = new Date(value);
  return Number.isFinite(instant.valueOf()) && instant.toISOString() === value;
}
export function isCanonicalDecimal(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  return (
    value.length < MAX_SAFE_DECIMAL.length ||
    (value.length === MAX_SAFE_DECIMAL.length && value <= MAX_SAFE_DECIMAL)
  );
}
export function parseCanonicalDecimal(value: unknown): number {
  if (typeof value !== "string" || !isCanonicalDecimal(value))
    throw new TypeError("decimal:invalid");
  return Number(value);
}
export function compareCanonicalDecimal(left: string, right: string): -1 | 0 | 1 {
  if (!isCanonicalDecimal(left) || !isCanonicalDecimal(right))
    throw new TypeError("decimal:invalid");
  return left.length < right.length
    ? -1
    : left.length > right.length
      ? 1
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
}
export function incrementCanonicalDecimal(value: string): string {
  const parsed = parseCanonicalDecimal(value);
  if (parsed === Number.MAX_SAFE_INTEGER) throw new TypeError("decimal:overflow");
  return String(parsed + 1);
}
export function isContractRelativePath(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (
    !isUnicodeScalarSequence(value) ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
    return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function canonicalValue(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key]!)}`)
    .join(",")}}`;
}
export function canonicalJson(input: unknown): string {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) throw new TypeError(snapshot.issues.join(","));
  return `${canonicalValue(snapshot.value)}\n`;
}
export function canonicalBytes(input: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(input));
}
export function canonicalDigest(input: unknown): string {
  return createHash("sha256").update(canonicalBytes(input)).digest("hex");
}
export function validateDefinition(definition: ContractDefinition, input: unknown): ParseResult {
  const snapshot = snapshotClosedRecord(input, definition.fields);
  if (!snapshot.ok) return snapshot;
  const issues: string[] = [];
  if (snapshot.value.schemaVersion !== definition.schemaVersion)
    issues.push("schemaVersion:mismatch");
  if (definition.validate) issues.push(...definition.validate(snapshot.value));
  return issues.length === 0
    ? { ok: true, value: snapshot.value }
    : { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
export function parseCanonicalBytes(
  definition: ContractDefinition,
  bytes: Uint8Array,
): ParseResult {
  if (!(bytes instanceof Uint8Array)) return { ok: false, issues: ["encoding:bytes-required"] };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { ok: false, issues: ["encoding:bom-refused"] };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, issues: ["encoding:invalid-utf8"] };
  }
  if (text.startsWith("\ufeff")) return { ok: false, issues: ["encoding:bom-refused"] };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["encoding:invalid-json"] };
  }
  const parsed = validateDefinition(definition, parsedJson);
  if (!parsed.ok) return parsed;
  return canonicalJson(parsed.value) === text
    ? parsed
    : { ok: false, issues: ["encoding:noncanonical"] };
}

export type FramePart =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "nullable-text"; readonly value: string | null }
  | { readonly type: "raw32"; readonly value: string }
  | { readonly type: "nullable-raw32"; readonly value: string | null }
  | { readonly type: "raw-fixed"; readonly value: string }
  | { readonly type: "decimal-ascii"; readonly value: string }
  | { readonly type: "canonical"; readonly value: JsonValue };
const encoder = new TextEncoder();
const partTags: Readonly<Record<FramePart["type"], number>> = Object.freeze({
  text: 1,
  "nullable-text": 2,
  raw32: 3,
  "nullable-raw32": 4,
  "raw-fixed": 5,
  "decimal-ascii": 6,
  canonical: 7,
});
function unsigned(value: number, bytes: 4 | 8): Uint8Array {
  const output = new Uint8Array(bytes);
  const view = new DataView(output.buffer);
  if (bytes === 4) view.setUint32(0, value);
  else view.setBigUint64(0, BigInt(value));
  return output;
}
function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
function framePartBytes(part: FramePart): Uint8Array {
  if ((part.type === "nullable-text" || part.type === "nullable-raw32") && part.value === null)
    return new Uint8Array([0]);
  if (
    (part.type === "text" || part.type === "nullable-text") &&
    !isUnicodeScalarSequence(part.value!)
  )
    throw new TypeError("frame:invalid-unicode");
  if (part.type === "decimal-ascii" && !isCanonicalDecimal(part.value))
    throw new TypeError("frame:invalid-decimal");
  if (part.type === "raw32" || part.type === "nullable-raw32") {
    if (!sha256.test(part.value!)) throw new TypeError("frame:invalid-digest");
    return Uint8Array.from(part.value!.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
  }
  if (part.type === "raw-fixed") {
    if (!/^(?:[0-9a-f]{2})+$/.test(part.value)) throw new TypeError("frame:invalid-fixed");
    return Uint8Array.from(part.value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
  }
  if (part.type === "canonical") return canonicalBytes(part.value);
  return encoder.encode(part.value!);
}
export function framedBytes(domain: string, parts: readonly FramePart[]): Uint8Array {
  if (!/^[a-z][a-z0-9-]*\/v1$/.test(domain)) throw new TypeError("frame:domain-refused");
  const chunks: Uint8Array[] = [
    encoder.encode("orchestration-platform\0"),
    encoder.encode(`${domain}\0`),
    unsigned(parts.length, 4),
  ];
  for (const part of parts) {
    const payload = framePartBytes(part);
    chunks.push(new Uint8Array([partTags[part.type]]), unsigned(payload.length, 8), payload);
  }
  return concatenate(chunks);
}
export function framedDigest(domain: string, parts: readonly FramePart[]): string {
  return createHash("sha256").update(framedBytes(domain, parts)).digest("hex");
}
export const frame = Object.freeze({
  text: (value: string): FramePart => Object.freeze({ type: "text", value }),
  nullableText: (value: string | null): FramePart =>
    Object.freeze({ type: "nullable-text", value }),
  raw32: (value: string): FramePart => Object.freeze({ type: "raw32", value }),
  nullableRaw32: (value: string | null): FramePart =>
    Object.freeze({ type: "nullable-raw32", value }),
  fixed: (value: string): FramePart => Object.freeze({ type: "raw-fixed", value }),
  decimal: (value: string): FramePart => Object.freeze({ type: "decimal-ascii", value }),
  canonical: (value: JsonValue): FramePart => Object.freeze({ type: "canonical", value }),
});

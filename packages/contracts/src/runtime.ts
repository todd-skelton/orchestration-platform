import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ContractRecord = Readonly<Record<string, JsonValue>>;

export type ScalarKind =
  | "boolean"
  | "bounded-string"
  | "decimal"
  | "file-url"
  | "integer"
  | "json"
  | "opaque"
  | "positive-integer"
  | "relative-path"
  | "schema-id"
  | "semver"
  | "sha256"
  | "timestamp"
  | "uuid-v7";

export interface FieldRule {
  readonly kind: ScalarKind;
  readonly nullable?: boolean;
  readonly array?: boolean;
  readonly values?: readonly string[];
  readonly unique?: boolean;
}

export interface SchemaDefinition {
  readonly schemaVersion: string;
  readonly authority: true;
  readonly fields: Readonly<Record<string, FieldRule>>;
  readonly validate?: (record: ContractRecord) => readonly string[];
}

export type ParseResult<T extends ContractRecord = ContractRecord> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;
const decimal = /^(?:0|[1-9][0-9]*)$/;
const opaque = /^[a-z0-9](?:[a-z0-9._:@+-]{0,126}[a-z0-9])?$/;
const schemaId = /^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/;
const semver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const drivePrefix = /^[a-z]:/i;

export type ClosedRecordSnapshotResult =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

export type ClosedArraySnapshotResult =
  | { readonly ok: true; readonly value: readonly JsonValue[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export function snapshotClosedArray(input: unknown): ClosedArraySnapshotResult {
  return snapshotClosedArrayInternal(input, new Set(), 0);
}

function snapshotClosedArrayInternal(
  input: unknown,
  seen: Set<object>,
  depth: number,
): ClosedArraySnapshotResult {
  try {
    if (input === null || typeof input !== "object" || nodeTypes.isProxy(input))
      return { ok: false, issues: ["array:array-required"] };
    if (depth > 64) return { ok: false, issues: ["array:maximum-depth"] };
    if (seen.has(input)) return { ok: false, issues: ["array:cycle-refused"] };
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype)
      return { ok: false, issues: ["array:exact-prototype-required"] };
    seen.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      lengthDescriptor.enumerable !== false ||
      lengthDescriptor.configurable !== false ||
      (lengthDescriptor.writable !== true && lengthDescriptor.writable !== false)
    )
      return { ok: false, issues: ["array:length-descriptor-refused"] };
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 4096)
      return { ok: false, issues: ["array:length-refused"] };
    const expectedKeys = new Set<PropertyKey>([
      ...Array.from({ length }, (_, index) => String(index)),
      "length",
    ]);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key)))
      return { ok: false, issues: ["array:keys-refused"] };
    const copy: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true)
        return { ok: false, issues: [`array:${index}:descriptor-refused`] };
      const value = snapshotJsonValue(descriptor.value, seen, depth + 1);
      if (!value.ok)
        return { ok: false, issues: value.issues.map((issue) => `array:${index}:${issue}`) };
      copy.push(value.value);
    }
    seen.delete(input);
    return { ok: true, value: Object.freeze(copy) };
  } catch {
    return { ok: false, issues: ["array:unreadable"] };
  }
}

type JsonSnapshotResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly issues: readonly string[] };

function snapshotJsonValue(
  input: unknown,
  seen: Set<object> = new Set(),
  depth = 0,
): JsonSnapshotResult {
  if (
    input === null ||
    typeof input === "boolean" ||
    typeof input === "string" ||
    (typeof input === "number" && Number.isSafeInteger(input) && !Object.is(input, -0))
  )
    return { ok: true, value: input as JsonPrimitive };
  if (typeof input !== "object") return { ok: false, issues: ["non-json-value"] };
  if (depth > 64) return { ok: false, issues: ["maximum-depth"] };
  if (nodeTypes.isProxy(input)) return { ok: false, issues: ["proxy-refused"] };
  if (Array.isArray(input)) return snapshotClosedArrayInternal(input, seen, depth);
  if (seen.has(input)) return { ok: false, issues: ["cycle-refused"] };
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    return { ok: false, issues: ["plain-object-required"] };
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string"))
    return { ok: false, issues: ["symbol-field-refused"] };
  const copy: Record<string, JsonValue> = {};
  seen.add(input);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true)
      return { ok: false, issues: [`${key}:descriptor-refused`] };
    const value = snapshotJsonValue(descriptor.value, seen, depth + 1);
    if (!value.ok) return { ok: false, issues: value.issues.map((issue) => `${key}:${issue}`) };
    copy[key] = value.value;
  }
  seen.delete(input);
  return { ok: true, value: Object.freeze(copy) };
}

export function snapshotClosedRecord(
  input: unknown,
  expectedFields: readonly string[],
): ClosedRecordSnapshotResult {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return { ok: false, issues: ["record:object-required"] };
    if (nodeTypes.isProxy(input)) return { ok: false, issues: ["record:proxy-refused"] };
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false, issues: ["record:plain-object-required"] };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const issues: string[] = [];
    if (keys.some((name) => typeof name !== "string")) issues.push("record:symbol-field-refused");
    const observed = keys.filter((name): name is string => typeof name === "string").sort();
    const expected = [...expectedFields].sort();
    for (const name of expected) {
      if (!Object.hasOwn(descriptors, name)) issues.push(`${name}:missing`);
    }
    for (const name of observed) {
      if (!expected.includes(name)) issues.push(`${name}:unknown-field`);
      const descriptor = descriptors[name]!;
      if (!Object.hasOwn(descriptor, "value")) issues.push(`${name}:accessor-refused`);
      if (descriptor.enumerable !== true) issues.push(`${name}:non-enumerable-refused`);
    }
    if (issues.length > 0) return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
    const snapshot = Object.fromEntries(
      observed.map((name) => {
        const value = snapshotJsonValue(descriptors[name]!.value);
        if (!value.ok) throw new TypeError(value.issues.join(","));
        return [name, value.value];
      }),
    ) as ContractRecord;
    return { ok: true, value: Object.freeze(snapshot) };
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    if (nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}

export function isContractRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (
    !validUnicode(value) ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    drivePrefix.test(value)
  )
    return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function isCanonicalFileUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("file:///")) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "file:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.href === value &&
      !value.includes("\\")
    );
  } catch {
    return false;
  }
}

function validScalar(kind: ScalarKind, value: unknown): boolean {
  switch (kind) {
    case "boolean":
      return typeof value === "boolean";
    case "bounded-string":
      return (
        typeof value === "string" && value.length > 0 && value.length <= 512 && validUnicode(value)
      );
    case "decimal":
      return typeof value === "string" && decimal.test(value);
    case "file-url":
      return isCanonicalFileUrl(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "json":
      return value !== undefined;
    case "opaque":
      return typeof value === "string" && opaque.test(value);
    case "positive-integer":
      return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    case "relative-path":
      return isContractRelativePath(value);
    case "schema-id":
      return typeof value === "string" && schemaId.test(value);
    case "semver":
      return typeof value === "string" && semver.test(value);
    case "sha256":
      return typeof value === "string" && sha256.test(value);
    case "timestamp":
      return isCanonicalTimestamp(value);
    case "uuid-v7":
      return typeof value === "string" && uuidV7.test(value);
  }
}

function validateField(name: string, rule: FieldRule, value: unknown): readonly string[] {
  if (value === null) return rule.nullable ? [] : [`${name}:null-refused`];
  const values = rule.array ? (Array.isArray(value) ? value : undefined) : [value];
  if (!values) return [`${name}:array-required`];
  if (rule.array && values.length > 256) return [`${name}:array-too-large`];
  const issues: string[] = [];
  for (const entry of values) {
    if (rule.values) {
      if (typeof entry !== "string" || !rule.values.includes(entry))
        issues.push(`${name}:unknown-enum`);
    } else if (!validScalar(rule.kind, entry)) {
      issues.push(`${name}:invalid-${rule.kind}`);
    }
  }
  if (rule.array && rule.unique === true) {
    const encoded = values.map((entry) => JSON.stringify(entry));
    if (new Set(encoded).size !== encoded.length) issues.push(`${name}:duplicate-array-entry`);
  }
  return issues;
}

export function validateAgainstSchema(definition: SchemaDefinition, input: unknown): ParseResult {
  const expected = Object.keys(definition.fields).sort();
  const closed = snapshotClosedRecord(input, expected);
  if (!closed.ok) return closed;
  const snapshot = closed.value;
  const issues: string[] = [];
  for (const name of expected) {
    if (Object.hasOwn(snapshot, name))
      issues.push(...validateField(name, definition.fields[name]!, snapshot[name]));
  }
  if (snapshot.schemaVersion !== definition.schemaVersion) issues.push("schemaVersion:mismatch");
  if (issues.length === 0 && definition.validate)
    issues.push(...definition.validate(snapshot as ContractRecord));
  return issues.length === 0
    ? { ok: true, value: Object.freeze(snapshot as ContractRecord) }
    : { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function canonicalValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0))
      throw new TypeError("noncanonical number");
    return String(value);
  }
  if (typeof value === "string") {
    if (!validUnicode(value)) throw new TypeError("invalid unicode scalar sequence");
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === undefined) throw new TypeError("non-JSON value");
  if (seen.has(value)) throw new TypeError("cyclic JSON value");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    const snapshot = snapshotClosedArray(value);
    if (!snapshot.ok) throw new TypeError(snapshot.issues.join(","));
    result = `[${snapshot.value.map((entry) => canonicalValue(entry, seen)).join(",")}]`;
  } else if (isPlainRecord(value)) {
    const snapshot = snapshotJsonValue(value);
    if (!snapshot.ok || snapshot.value === null || Array.isArray(snapshot.value))
      throw new TypeError("noncanonical record");
    const recordSnapshot = snapshot.value as { readonly [key: string]: JsonValue };
    result = `{${Object.keys(recordSnapshot)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(recordSnapshot[key], seen)}`)
      .join(",")}}`;
  } else {
    throw new TypeError("non-plain JSON object");
  }
  seen.delete(value);
  return result;
}

export function canonicalJson(value: JsonValue): string {
  return `${canonicalValue(value, new Set())}\n`;
}

export function canonicalBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function canonicalDigest(value: JsonValue): string {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

export function parseCanonicalBytes(definition: SchemaDefinition, bytes: Uint8Array): ParseResult {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { ok: false, issues: ["encoding:bom-refused"] };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, issues: ["encoding:invalid-utf8"] };
  }
  if (text.startsWith("\ufeff")) return { ok: false, issues: ["encoding:bom-refused"] };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["encoding:invalid-json"] };
  }
  const parsed = validateAgainstSchema(definition, input);
  if (!parsed.ok) return parsed;
  try {
    if (canonicalJson(parsed.value) !== text)
      return { ok: false, issues: ["encoding:noncanonical"] };
  } catch {
    return { ok: false, issues: ["encoding:noncanonical"] };
  }
  return parsed;
}

import { compatibilityDisposition, schemaDefinitions, schemaVersions } from "./registry.js";
import {
  canonicalBytes,
  canonicalDigest,
  canonicalJson,
  parseCanonicalBytes,
  validateDefinition,
  type ParseResult,
} from "./runtime.js";
import { parseSimplifiedAuthorityContract } from "./authority.js";
import { parseDispatchContract } from "./dispatch.js";
import { parsePointerGraphContract } from "./pointer.js";

export * from "./authority.js";
export * from "./definitions.js";
export * from "./dispatch.js";
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
export {
  compatibilityDisposition,
  schemaDefinitions,
  schemaVersions,
  schemaVocabularyDefinitions,
} from "./registry.js";

export function parseContract(expectedSchemaVersion: string, input: unknown): ParseResult {
  const authority = parseSimplifiedAuthorityContract(expectedSchemaVersion, input);
  if (authority) return authority;
  const dispatch = parseDispatchContract(expectedSchemaVersion, input);
  if (dispatch) return dispatch;
  const pointer = parsePointerGraphContract(expectedSchemaVersion, input);
  if (pointer) return pointer;
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
  try {
    if (definition) return parseCanonicalBytes(definition, bytes);
    if (!schemaVersions.includes(expectedSchemaVersion))
      return { ok: false, issues: ["schemaVersion:unsupported"] };
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
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return { ok: false, issues: ["encoding:invalid-json"] };
    }
    const parsed = parseContract(expectedSchemaVersion, input);
    if (!parsed.ok) return parsed;
    return canonicalJson(parsed.value) === text
      ? parsed
      : { ok: false, issues: ["encoding:noncanonical"] };
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
  readonly disposition: "readable" | "refused";
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

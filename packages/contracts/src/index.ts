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
import { parseCommitContract } from "./commit.js";
import { parseDispatchContract } from "./dispatch.js";
import { parseEvidenceContract } from "./evidence.js";
import { parseExternalContract } from "./external.js";
import { parseDestinationOwnerContract } from "./owner.js";
import { parseDestinationOwnerSuccessorContract } from "./successor.js";
import { parseBootstrapAnchorContract } from "./anchor.js";
import { parseBootstrapUseIntentContract } from "./intent.js";
import { parseBootstrapAnchorTeardownContract } from "./teardown.js";
import { parseBootstrapGenesisContract } from "./genesis.js";
import { parseBootstrapConsumptionContract } from "./consumption.js";
import { parsePacketContract } from "./packet.js";
import { parsePointerGraphContract } from "./pointer.js";
import { parseGateFenceContract } from "./definitions.js";

export * from "./authority.js";
export * from "./commit.js";
export * from "./definitions.js";
export * from "./dispatch.js";
export * from "./evidence.js";
export * from "./packet.js";
export * from "./external.js";
export * from "./owner.js";
export * from "./successor.js";
export * from "./anchor.js";
export * from "./intent.js";
export * from "./teardown.js";
export * from "./genesis.js";
export * from "./consumption.js";
export * from "./selection.js";
export * from "./retirement.js";
export * from "./pointer.js";
export * from "./recovery.js";
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
  const commit = parseCommitContract(expectedSchemaVersion, input);
  if (commit) return commit;
  const dispatch = parseDispatchContract(expectedSchemaVersion, input);
  if (dispatch) return dispatch;
  const evidence = parseEvidenceContract(expectedSchemaVersion, input);
  if (evidence) return evidence;
  const external = parseExternalContract(expectedSchemaVersion, input);
  if (external) return external;
  const owner = parseDestinationOwnerContract(expectedSchemaVersion, input);
  if (owner) return owner;
  const successor = parseDestinationOwnerSuccessorContract(expectedSchemaVersion, input);
  if (successor) return successor;
  const anchor = parseBootstrapAnchorContract(expectedSchemaVersion, input);
  if (anchor) return anchor;
  const intent = parseBootstrapUseIntentContract(expectedSchemaVersion, input);
  if (intent) return intent;
  const teardown = parseBootstrapAnchorTeardownContract(expectedSchemaVersion, input);
  if (teardown) return teardown;
  const genesis = parseBootstrapGenesisContract(expectedSchemaVersion, input);
  if (genesis) return genesis;
  const consumption = parseBootstrapConsumptionContract(expectedSchemaVersion, input);
  if (consumption) return consumption;
  const packet = parsePacketContract(expectedSchemaVersion, input);
  if (packet) return packet;
  const pointer = parsePointerGraphContract(expectedSchemaVersion, input);
  if (pointer) return pointer;
  const gateFence = parseGateFenceContract(expectedSchemaVersion, input);
  if (gateFence) return gateFence;
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

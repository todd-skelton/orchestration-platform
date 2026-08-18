import { createHash } from "node:crypto";
import type { ContractDefinition } from "./runtime.js";

const adapterTerms = Object.freeze([
  "branch",
  "worktree",
  "label",
  "milestone",
  "queue",
  "deployment",
]);

function forbiddenDigest(value: string): string {
  return createHash("sha256")
    .update("forbidden-vocabulary/v1\0")
    .update(value.normalize("NFKC").toLowerCase())
    .update("\0")
    .digest("hex");
}

function candidates(value: string): ReadonlySet<string> {
  const normalized = value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const result = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]+(?:[._:@/-][a-z0-9]+)*/g)) result.add(match[0]);
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
      const span = words.slice(start, start + length);
      for (const separator of [" ", "-", ""]) result.add(span.join(separator));
    }
  }
  return result;
}

export function engineVocabularyFindings(
  definitions: Readonly<Record<string, ContractDefinition>>,
  forbiddenDigests: readonly string[] = [],
): readonly string[] {
  const hashes = new Set(forbiddenDigests);
  const findings: string[] = [];
  for (const [schemaVersion, definition] of Object.entries(definitions)) {
    for (const [kind, value] of [
      ...definition.fields.map((field) => ["field", field] as const),
      ...(definition.closedValues ?? []).map((closedValue) => ["enum", closedValue] as const),
    ]) {
      const adapter = adapterTerms.find((term) => candidates(value).has(term));
      const consumer = [...candidates(value)].find((candidate) =>
        hashes.has(forbiddenDigest(candidate)),
      );
      if (adapter) findings.push(`${schemaVersion}:${kind}:${value}:adapter:${adapter}`);
      else if (consumer) findings.push(`${schemaVersion}:${kind}:${value}:consumer`);
    }
  }
  return Object.freeze(findings.sort());
}

export const engineAdapterVocabulary = adapterTerms;

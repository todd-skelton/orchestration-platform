import { types as nodeTypes } from "node:util";
import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isContractRelativePath,
  isSha256,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  computeConformanceRecordDigest,
  parseConformanceCandidateSubject,
  sha256Bytes,
} from "./contracts.js";

export const githubConformanceProtectionSchemaVersion =
  "github-conformance-protection-snapshot/v1" as const;
export const githubConformanceProviderRecordSchemaVersion =
  "github-conformance-provider-record/v1" as const;

const protectionFields = Object.freeze([
  "bypassActorCount",
  "deletionBlocked",
  "enforcement",
  "nonFastForwardBlocked",
  "pullRequestRequired",
  "schemaVersion",
  "targetRef",
] as const);

const providerRunFields = Object.freeze([
  "candidateRevision",
  "candidateSubjectDigest",
  "event",
  "harnessBundleDigest",
  "protectionSnapshotDigest",
  "repositoryId",
  "requiredJobRegistryDigest",
  "runAttempt",
  "runId",
  "testBundleDigest",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
] as const);

const candidateProjectionFields = Object.freeze(["entries", "truncated"] as const);
const candidateProjectionEntryFields = Object.freeze(["bytes", "mode", "path", "type"] as const);

function refusal(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function accepted(value: ContractRecord): ParseResult {
  return { ok: true, value };
}

function positiveDecimal(value: JsonValue | undefined): value is string {
  return isCanonicalDecimal(value) && value !== "0";
}

function commitRevision(value: JsonValue | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function githubWorkflowRef(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/conformance\.yml@refs\/heads\/main$/.test(
      value,
    )
  );
}

export function parseGithubConformanceProtectionSnapshot(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, protectionFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  if (value.bypassActorCount !== "0") issues.push("bypassActorCount:must-be-zero");
  if (value.deletionBlocked !== true) issues.push("deletionBlocked:required");
  if (value.enforcement !== "ACTIVE") issues.push("enforcement:must-be-active");
  if (value.nonFastForwardBlocked !== true) issues.push("nonFastForwardBlocked:required");
  if (value.pullRequestRequired !== true) issues.push("pullRequestRequired:required");
  if (value.schemaVersion !== githubConformanceProtectionSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (value.targetRef !== "refs/heads/main") issues.push("targetRef:mismatch");
  return issues.length === 0 ? accepted(value) : refusal(...issues);
}

export function computeGithubConformanceProtectionDigest(input: unknown): string {
  const parsed = parseGithubConformanceProtectionSnapshot(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(githubConformanceProtectionSchemaVersion, [frame.canonical(parsed.value)]);
}

export function parseGithubProviderRunContext(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, providerRunFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  if (!commitRevision(value.candidateRevision)) issues.push("candidateRevision:invalid");
  for (const field of [
    "candidateSubjectDigest",
    "harnessBundleDigest",
    "protectionSnapshotDigest",
    "requiredJobRegistryDigest",
    "testBundleDigest",
  ] as const)
    if (!isSha256(value[field])) issues.push(`${field}:invalid`);
  if (value.event !== "repository_dispatch") issues.push("event:mismatch");
  if (!positiveDecimal(value.repositoryId)) issues.push("repositoryId:invalid");
  if (!positiveDecimal(value.runAttempt)) issues.push("runAttempt:invalid");
  if (!positiveDecimal(value.runId)) issues.push("runId:invalid");
  if (value.workflowPath !== ".github/workflows/conformance.yml")
    issues.push("workflowPath:mismatch");
  if (!githubWorkflowRef(value.workflowRef)) issues.push("workflowRef:invalid");
  if (!commitRevision(value.workflowRevision)) issues.push("workflowRevision:invalid");
  return issues.length === 0 ? accepted(value) : refusal(...issues);
}

export function computeGithubProviderRunDigest(input: unknown): string {
  const parsed = parseGithubProviderRunContext(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const value = parsed.value;
  return framedDigest("github-conformance-provider-run/v1", [
    frame.text(String(value.repositoryId)),
    frame.text(String(value.workflowPath)),
    frame.text(String(value.workflowRef)),
    frame.text(String(value.workflowRevision)),
    frame.text(String(value.runId)),
    frame.text(String(value.runAttempt)),
    frame.text(String(value.event)),
    frame.raw32(String(value.protectionSnapshotDigest)),
    frame.text(String(value.candidateRevision)),
    frame.raw32(String(value.candidateSubjectDigest)),
    frame.raw32(String(value.harnessBundleDigest)),
    frame.raw32(String(value.testBundleDigest)),
    frame.raw32(String(value.requiredJobRegistryDigest)),
  ]);
}

type CandidateProjectionResult =
  | {
      readonly ok: true;
      readonly value: ContractRecord;
      readonly digest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function exactDataRecord(
  input: unknown,
  fields: readonly string[],
):
  | { readonly ok: true; readonly values: Readonly<Record<string, unknown>> }
  | { readonly ok: false } {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return { ok: false };
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return { ok: false };
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
      return { ok: false };
    values[field] = descriptor.value;
  }
  return { ok: true, values: Object.freeze(values) };
}

function projectionEntry(
  input: unknown,
  index: number,
):
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly executable: boolean;
      readonly path: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const parsed = exactDataRecord(input, candidateProjectionEntryFields);
  if (!parsed.ok)
    return {
      ok: false,
      issues: [`entries.${index}:closed-data-record-required`],
    };
  const row = parsed.values;
  const issues: string[] = [];
  const bytes = row.bytes as unknown;
  if (
    !(bytes instanceof Uint8Array) ||
    nodeTypes.isProxy(bytes) ||
    Object.getPrototypeOf(bytes) !== Uint8Array.prototype
  )
    issues.push(`entries.${index}.bytes:exact-uint8array-required`);
  if (row.type !== "blob") issues.push(`entries.${index}.type:must-be-blob`);
  const executable = row.mode === "100755";
  if (!(row.mode === "100644" || executable)) issues.push(`entries.${index}.mode:refused`);
  if (typeof row.path !== "string" || !isContractRelativePath(row.path))
    issues.push(`entries.${index}.path:invalid`);
  return issues.length === 0
    ? { ok: true, bytes: bytes as Uint8Array, executable, path: String(row.path) }
    : { ok: false, issues };
}

export function projectGithubCandidateSubject(input: unknown): CandidateProjectionResult {
  try {
    const parsed = exactDataRecord(input, candidateProjectionFields);
    if (!parsed.ok) return { ok: false, issues: ["projection:closed-data-record-required"] };
    if (parsed.values.truncated !== false)
      return { ok: false, issues: ["projection:complete-tree-required"] };
    const entries = parsed.values.entries;
    if (
      !Array.isArray(entries) ||
      nodeTypes.isProxy(entries) ||
      Object.getPrototypeOf(entries) !== Array.prototype ||
      entries.length === 0 ||
      entries.length > 65_536
    )
      return { ok: false, issues: ["entries:length-or-array-refused"] };
    const entryDescriptors = Object.getOwnPropertyDescriptors(entries);
    const entryKeys = Reflect.ownKeys(entryDescriptors);
    const expectedEntryKeys = new Set([
      ...Array.from({ length: entries.length }, (_, index) => String(index)),
      "length",
    ]);
    if (
      entryKeys.some((key) => typeof key !== "string") ||
      (entryKeys as string[]).some((key) => !expectedEntryKeys.has(key)) ||
      entryKeys.length !== expectedEntryKeys.size
    )
      return { ok: false, issues: ["entries:exact-dense-array-required"] };
    const rows: ContractRecord[] = [];
    const issues: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const descriptor = entryDescriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        issues.push(`entries.${index}:data-element-required`);
        continue;
      }
      const projected = projectionEntry(descriptor.value, index);
      if (!projected.ok) {
        issues.push(...projected.issues);
        continue;
      }
      rows.push(
        Object.freeze({
          byteLength: String(projected.bytes.byteLength),
          executable: projected.executable,
          path: projected.path,
          sha256Digest: sha256Bytes(projected.bytes),
        }),
      );
    }
    if (issues.length > 0) return { ok: false, issues: Object.freeze(issues.sort()) };
    rows.sort((left, right) =>
      Buffer.compare(
        Buffer.from(String(left.path), "utf8"),
        Buffer.from(String(right.path), "utf8"),
      ),
    );
    const candidate = Object.freeze({
      files: Object.freeze(rows),
      schemaVersion: "conformance-candidate-subject/v1",
    });
    const validated = parseConformanceCandidateSubject(candidate);
    if (!validated.ok) return validated;
    return {
      ok: true,
      value: validated.value,
      digest: computeConformanceRecordDigest("conformance-candidate-subject/v1", validated.value),
    };
  } catch {
    return { ok: false, issues: ["projection:unreadable"] };
  }
}

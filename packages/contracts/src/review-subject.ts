import {
  frame,
  framedDigest,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

// Only these two concrete records persist. review-subject/v1 is a parser alias.
export const reviewSubjectSchemaVersions = Object.freeze([
  "worker-result-subject/v1",
  "release-candidate-subject/v1",
] as const);
export const reviewSubjectSchemaFields = Object.freeze({
  source: Object.freeze(["adapterId", "projectId", "revision"] as const),
  worker: Object.freeze([
    "authorAttemptId",
    "authorCycleId",
    "baseSource",
    "result",
    "schemaVersion",
    "terminalReceiptDigest",
  ] as const),
  tree: Object.freeze(["kind", "treeDigest"] as const),
  ordered: Object.freeze(["entries", "kind"] as const),
  entry: Object.freeze(["contentDigest", "kind"] as const),
  candidate: Object.freeze([
    "assemblyCycleId",
    "candidateDigest",
    "certificationDigest",
    "landedSource",
    "landedTreeDigest",
    "manifestDigest",
    "schemaVersion",
    "testBundleDigest",
  ] as const),
});

export type ReviewSubjectSource = Readonly<{
  adapterId: string;
  projectId: string;
  revision: string;
}>;
export type WorkerResultEntry = Readonly<{
  contentDigest: string;
  kind: "PATCH" | "ARTIFACT";
}>;
export type WorkerResultMaterialization =
  | Readonly<{ kind: "TREE"; treeDigest: string }>
  | Readonly<{ entries: readonly WorkerResultEntry[]; kind: "ORDERED_PATCH_ARTIFACTS" }>;
export type WorkerResultSubject = Readonly<{
  authorAttemptId: string;
  authorCycleId: string;
  baseSource: ReviewSubjectSource;
  result: WorkerResultMaterialization;
  schemaVersion: "worker-result-subject/v1";
  terminalReceiptDigest: string;
}>;
export type ReleaseCandidateSubject = Readonly<{
  assemblyCycleId: string;
  candidateDigest: string;
  certificationDigest: string;
  landedSource: ReviewSubjectSource;
  landedTreeDigest: string;
  manifestDigest: string;
  schemaVersion: "release-candidate-subject/v1";
  testBundleDigest: string;
}>;
export type ReviewSubject = WorkerResultSubject | ReleaseCandidateSubject;

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
const idPattern = /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/;
const uuid = (value: JsonValue | undefined): boolean => isUuidV7(value) && value.length === 36;
const digest = (value: JsonValue | undefined): boolean => isSha256(value) && value.length === 64;

function sourceIssues(input: unknown, prefix: string): readonly string[] {
  const parsed = snapshotClosedRecord(input, reviewSubjectSchemaFields.source);
  if (!parsed.ok) return parsed.issues.map((issue) => `${prefix}.${issue}`);
  const issues: string[] = [];
  for (const field of ["adapterId", "revision"] as const)
    if (typeof parsed.value[field] !== "string" || !idPattern.test(parsed.value[field]))
      issues.push(`${prefix}.${field}:invalid`);
  if (!uuid(parsed.value.projectId)) issues.push(`${prefix}.projectId:invalid`);
  return issues;
}

// Called only with a detached snapshot; no property access observes caller objects.
function resultIssues(input: JsonValue): readonly string[] {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return ["result:object-required"];
  const record = input as ContractRecord;
  if (record.kind !== "TREE" && record.kind !== "ORDERED_PATCH_ARTIFACTS")
    return ["result.kind:invalid"];
  const parsed = snapshotClosedRecord(
    record,
    record.kind === "TREE" ? reviewSubjectSchemaFields.tree : reviewSubjectSchemaFields.ordered,
  );
  if (!parsed.ok) return parsed.issues.map((issue) => `result.${issue}`);
  if (record.kind === "TREE") return digest(record.treeDigest) ? [] : ["result.treeDigest:invalid"];
  if (!Array.isArray(record.entries)) return ["result.entries:array-required"];
  if (record.entries.length < 1 || record.entries.length > 4096)
    return ["result.entries:length-refused"];
  const issues: string[] = [];
  for (const [index, entry] of record.entries.entries()) {
    const prefix = `result.entries.${index}`;
    const parsedEntry = snapshotClosedRecord(entry, reviewSubjectSchemaFields.entry);
    if (!parsedEntry.ok) {
      issues.push(...parsedEntry.issues.map((issue) => `${prefix}.${issue}`));
      continue;
    }
    if (!digest(parsedEntry.value.contentDigest)) issues.push(`${prefix}.contentDigest:invalid`);
    if (parsedEntry.value.kind !== "PATCH" && parsedEntry.value.kind !== "ARTIFACT")
      issues.push(`${prefix}.kind:invalid`);
  }
  return issues;
}

/** Shape only: does not authenticate the attempt, immutable base, terminal, or retained content. */
export function parseWorkerResultSubject(input: unknown): ParseResult<WorkerResultSubject> {
  const snapshot = snapshotClosedRecord(input, reviewSubjectSchemaFields.worker);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues = [
    ...sourceIssues(record.baseSource, "baseSource"),
    ...resultIssues(record.result!),
  ];
  if (record.schemaVersion !== "worker-result-subject/v1") issues.push("schemaVersion:mismatch");
  for (const field of ["authorAttemptId", "authorCycleId"] as const)
    if (!uuid(record[field])) issues.push(`${field}:invalid`);
  if (!digest(record.terminalReceiptDigest)) issues.push("terminalReceiptDigest:invalid");
  return issues.length ? invalid(...issues) : { ok: true, value: record as WorkerResultSubject };
}

/** Shape only: does not authenticate landed source, assembly, or complete certification. */
export function parseReleaseCandidateSubject(input: unknown): ParseResult<ReleaseCandidateSubject> {
  const snapshot = snapshotClosedRecord(input, reviewSubjectSchemaFields.candidate);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues = [...sourceIssues(record.landedSource, "landedSource")];
  if (record.schemaVersion !== "release-candidate-subject/v1")
    issues.push("schemaVersion:mismatch");
  if (!uuid(record.assemblyCycleId)) issues.push("assemblyCycleId:invalid");
  for (const field of [
    "candidateDigest",
    "certificationDigest",
    "landedTreeDigest",
    "manifestDigest",
    "testBundleDigest",
  ] as const)
    if (!digest(record[field])) issues.push(`${field}:invalid`);
  return issues.length
    ? invalid(...issues)
    : { ok: true, value: record as ReleaseCandidateSubject };
}

/** Wrapper-free union: returns the concrete detached record, never an alias-tagged envelope. */
export function parseReviewSubject(input: unknown): ParseResult<ReviewSubject> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  )
    return invalid("record:object-required");
  const record = snapshot.value as ContractRecord;
  if (record.schemaVersion === "worker-result-subject/v1") return parseWorkerResultSubject(record);
  if (record.schemaVersion === "release-candidate-subject/v1")
    return parseReleaseCandidateSubject(record);
  return invalid("schemaVersion:unsupported");
}

export function computeWorkerResultSubjectDigest(input: unknown): string {
  const parsed = parseWorkerResultSubject(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("worker-result-subject/v1", [frame.canonical(parsed.value)]);
}

export function computeReleaseCandidateSubjectDigest(input: unknown): string {
  const parsed = parseReleaseCandidateSubject(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("release-candidate-subject/v1", [frame.canonical(parsed.value)]);
}

export function parseReviewSubjectContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  if (schemaVersion === "worker-result-subject/v1") return parseWorkerResultSubject(input);
  if (schemaVersion === "release-candidate-subject/v1") return parseReleaseCandidateSubject(input);
  return schemaVersion === "review-subject/v1" ? parseReviewSubject(input) : null;
}

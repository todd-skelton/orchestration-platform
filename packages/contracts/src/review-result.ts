import {
  computeReviewPacketDigest,
  computeReviewRequestDigest,
  parseReviewRequest,
  reviewRequestSchemaFields,
  type ReviewContentReference,
} from "./review-request.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
} from "./review-subject.js";
import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const reviewResultSchemaVersions = Object.freeze([
  "review-attempt-result/v1",
  "review-authority/v1",
] as const);
export const reviewResultKinds = Object.freeze([
  "SWEEP_COMPLETE",
  "BLOCKED",
  "INCOMPLETE",
  "FAILED",
  "MALFORMED",
] as const);
export const reviewAuthorityUnknownReasons = Object.freeze([
  "RESULT_UNAVAILABLE",
  "RESULT_INVALID",
  "RESULT_NONCOMPLETE",
  "HISTORY_UNPROVEN",
  "INDEPENDENCE_UNPROVEN",
  "TARGET_CHANGED",
  "EVIDENCE_UNPROVEN",
] as const);
export const reviewResultSchemaFields = Object.freeze({
  attempt: Object.freeze([
    "attemptId",
    "cycleId",
    "dispatchPlanDigest",
    "launchReceiptDigest",
    "packetDigest",
    "requestDigest",
    "result",
    "schemaVersion",
    "subjectDigest",
    "terminalReceiptDigest",
  ] as const),
  result: Object.freeze(["evidence", "kind"] as const),
  blocked: Object.freeze(["evidence", "findings", "kind"] as const),
  finding: Object.freeze(["disposition", "evidence", "findingId"] as const),
  disposition: Object.freeze(["code", "moduleDescriptorDigest"] as const),
  findingEvidence: Object.freeze(["expected", "observed", "procedure"] as const),
  authority: Object.freeze([
    "outcome",
    "packetDigest",
    "requestDigest",
    "schemaVersion",
    "subjectDigest",
  ] as const),
  decided: Object.freeze(["attemptResultDigest", "kind"] as const),
  unknown: Object.freeze(["attemptResultDigest", "evidence", "kind", "reason"] as const),
});
export type ReviewFinding = Readonly<{
  disposition: Readonly<{ code: string; moduleDescriptorDigest: string }>;
  evidence: Readonly<{
    expected: ReviewContentReference;
    observed: ReviewContentReference;
    procedure: ReviewContentReference;
  }>;
  findingId: string;
}>;
export type ReviewAttemptResult = Readonly<{
  attemptId: string;
  cycleId: string;
  dispatchPlanDigest: string;
  launchReceiptDigest: string;
  packetDigest: string;
  requestDigest: string;
  result: Readonly<{ evidence: readonly ReviewContentReference[] }> &
    (
      | Readonly<{ kind: "BLOCKED"; findings: readonly ReviewFinding[] }>
      | Readonly<{ kind: Exclude<(typeof reviewResultKinds)[number], "BLOCKED"> }>
    );
  schemaVersion: "review-attempt-result/v1";
  subjectDigest: string;
  terminalReceiptDigest: string;
}>;
export type ReviewAuthority = Readonly<{
  packetDigest: string;
  requestDigest: string;
  schemaVersion: "review-authority/v1";
  subjectDigest: string;
  outcome:
    | Readonly<{ attemptResultDigest: string; kind: "accepted" | "rejected" }>
    | (Readonly<{ evidence: readonly ReviewContentReference[]; kind: "unknown" }> &
        (
          | Readonly<{
              attemptResultDigest: null;
              reason: "RESULT_UNAVAILABLE" | "RESULT_INVALID" | "HISTORY_UNPROVEN";
            }>
          | Readonly<{ attemptResultDigest: string; reason: "RESULT_NONCOMPLETE" }>
          | Readonly<{
              attemptResultDigest: string | null;
              reason: "INDEPENDENCE_UNPROVEN" | "TARGET_CHANGED" | "EVIDENCE_UNPROVEN";
            }>
        ));
}>;

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}
const digest = (value: JsonValue | undefined): boolean => isSha256(value) && value.length === 64;
const uuid = (value: JsonValue | undefined): boolean => isUuidV7(value) && value.length === 36;
const isRecord = (value: JsonValue | undefined): value is ContractRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const idPattern = /^[a-z0-9][a-z0-9._:@+-]{0,127}(?![\s\S])/;
const codePattern = /^[a-z][a-z0-9._:-]{0,63}(?![\s\S])/;

function content(input: unknown, label: string, issues: string[]): void {
  const parsed = snapshotClosedRecord(input, reviewRequestSchemaFields.content);
  if (!parsed.ok) {
    issues.push(...parsed.issues.map((issue) => `${label}.${issue}`));
    return;
  }
  const { byteLength, contentDigest } = parsed.value;
  if (!isCanonicalDecimal(byteLength) || /[^0-9]/.test(byteLength))
    issues.push(`${label}.byteLength:invalid`);
  if (!digest(contentDigest)) issues.push(`${label}.contentDigest:invalid`);
}
function contentList(input: JsonValue | undefined, label: string, issues: string[]): void {
  // The enclosing snapshot has already rejected holes, accessors, proxies and exotic arrays.
  if (!Array.isArray(input)) issues.push(`${label}:array-required`);
  else if (input.length < 1 || input.length > 256) issues.push(`${label}:length-refused`);
  else input.forEach((entry, index) => content(entry, `${label}.${index}`, issues));
}
function findings(input: JsonValue | undefined, issues: string[]): void {
  if (!Array.isArray(input)) {
    issues.push("result.findings:array-required");
    return;
  }
  if (input.length < 1 || input.length > 256) {
    issues.push("result.findings:length-refused");
    return;
  }
  let previous: string | null = null;
  input.forEach((entry, index) => {
    const label = `result.findings.${index}`;
    const finding = snapshotClosedRecord(entry, reviewResultSchemaFields.finding);
    if (!finding.ok) {
      issues.push(...finding.issues.map((issue) => `${label}.${issue}`));
      return;
    }
    const { findingId, disposition, evidence } = finding.value;
    if (typeof findingId !== "string" || !idPattern.test(findingId))
      issues.push(`${label}.findingId:invalid`);
    else {
      if (previous !== null && previous >= findingId)
        issues.push(`${label}.findingId:order-refused`);
      previous = findingId;
    }
    const parsedDisposition = snapshotClosedRecord(
      disposition,
      reviewResultSchemaFields.disposition,
    );
    if (!parsedDisposition.ok)
      issues.push(...parsedDisposition.issues.map((issue) => `${label}.disposition.${issue}`));
    else {
      if (
        typeof parsedDisposition.value.code !== "string" ||
        !codePattern.test(parsedDisposition.value.code)
      )
        issues.push(`${label}.disposition.code:invalid`);
      if (!digest(parsedDisposition.value.moduleDescriptorDigest))
        issues.push(`${label}.disposition.moduleDescriptorDigest:invalid`);
    }
    const parsedEvidence = snapshotClosedRecord(evidence, reviewResultSchemaFields.findingEvidence);
    if (!parsedEvidence.ok)
      issues.push(...parsedEvidence.issues.map((issue) => `${label}.evidence.${issue}`));
    else
      for (const field of reviewResultSchemaFields.findingEvidence)
        content(parsedEvidence.value[field], `${label}.evidence.${field}`, issues);
  });
}

/** Parses supplied structure only; no actual dispatch, terminal, or completed sweep is proved. */
export function parseReviewAttemptResult(input: unknown): ParseResult<ReviewAttemptResult> {
  const snapshot = snapshotClosedRecord(input, reviewResultSchemaFields.attempt);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "review-attempt-result/v1") issues.push("schemaVersion:mismatch");
  for (const field of ["attemptId", "cycleId"])
    if (!uuid(record[field])) issues.push(`${field}:invalid`);
  for (const field of [
    "dispatchPlanDigest",
    "launchReceiptDigest",
    "packetDigest",
    "requestDigest",
    "subjectDigest",
    "terminalReceiptDigest",
  ])
    if (!digest(record[field])) issues.push(`${field}:invalid`);
  const result = record.result;
  if (!isRecord(result)) issues.push("result:record-required");
  else {
    const parsed = snapshotClosedRecord(
      result,
      result.kind === "BLOCKED"
        ? reviewResultSchemaFields.blocked
        : reviewResultSchemaFields.result,
    );
    if (!parsed.ok) issues.push(...parsed.issues.map((issue) => `result.${issue}`));
    else {
      if (!(reviewResultKinds as readonly JsonValue[]).includes(result.kind!))
        issues.push("result.kind:invalid");
      contentList(result.evidence, "result.evidence", issues);
      if (result.kind === "BLOCKED") findings(result.findings, issues);
    }
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ReviewAttemptResult };
}

/** Even a valid accepted/rejected literal is only a claim, never effective authority. */
export function parseReviewAuthority(input: unknown): ParseResult<ReviewAuthority> {
  const snapshot = snapshotClosedRecord(input, reviewResultSchemaFields.authority);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "review-authority/v1") issues.push("schemaVersion:mismatch");
  for (const field of ["packetDigest", "requestDigest", "subjectDigest"])
    if (!digest(record[field])) issues.push(`${field}:invalid`);
  const outcome = record.outcome;
  if (!isRecord(outcome)) issues.push("outcome:record-required");
  else {
    const parsed = snapshotClosedRecord(
      outcome,
      outcome.kind === "unknown"
        ? reviewResultSchemaFields.unknown
        : reviewResultSchemaFields.decided,
    );
    if (!parsed.ok) issues.push(...parsed.issues.map((issue) => `outcome.${issue}`));
    else if (outcome.kind === "accepted" || outcome.kind === "rejected") {
      if (!digest(outcome.attemptResultDigest)) issues.push("outcome.attemptResultDigest:invalid");
    } else if (outcome.kind === "unknown") {
      if (!(reviewAuthorityUnknownReasons as readonly JsonValue[]).includes(outcome.reason!))
        issues.push("outcome.reason:invalid");
      const nullOnly = ["RESULT_UNAVAILABLE", "RESULT_INVALID", "HISTORY_UNPROVEN"].includes(
        outcome.reason as string,
      );
      if (
        nullOnly
          ? outcome.attemptResultDigest !== null
          : outcome.reason === "RESULT_NONCOMPLETE"
            ? !digest(outcome.attemptResultDigest)
            : outcome.attemptResultDigest !== null && !digest(outcome.attemptResultDigest)
      )
        issues.push("outcome.attemptResultDigest:invalid");
      contentList(outcome.evidence, "outcome.evidence", issues);
    } else issues.push("outcome.kind:invalid");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ReviewAuthority };
}
export function computeReviewAttemptResultDigest(input: unknown): string {
  const parsed = parseReviewAttemptResult(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("review-attempt-result/v1", [frame.canonical(parsed.value)]);
}
export function computeReviewAuthorityDigest(input: unknown): string {
  const parsed = parseReviewAuthority(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("review-authority/v1", [frame.canonical(parsed.value)]);
}
export function parseReviewResultContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  if (schemaVersion === "review-attempt-result/v1") return parseReviewAttemptResult(input);
  if (schemaVersion === "review-authority/v1") return parseReviewAuthority(input);
  return null;
}

/** Supplied-record equality only. No history, actor independence, issuance, or live authority. */
export function validateReviewResultBinding(
  requestInput: unknown,
  attemptInput: unknown,
  authorityInput: unknown,
): ParseResult<ReviewAuthority> {
  const request = parseReviewRequest(requestInput);
  const authority = parseReviewAuthority(authorityInput);
  const attempt = attemptInput === null ? null : parseReviewAttemptResult(attemptInput);
  const issues: string[] = [];
  if (!request.ok) issues.push(...request.issues.map((issue) => `request.${issue}`));
  if (!authority.ok) issues.push(...authority.issues.map((issue) => `authority.${issue}`));
  if (attempt && !attempt.ok) issues.push(...attempt.issues.map((issue) => `attempt.${issue}`));
  if (!request.ok || !authority.ok || (attempt && !attempt.ok)) return invalid(...issues);
  const subject = request.value.packet.subject;
  const identities = {
    packetDigest: computeReviewPacketDigest(request.value.packet),
    requestDigest: computeReviewRequestDigest(request.value),
    subjectDigest:
      subject.schemaVersion === "worker-result-subject/v1"
        ? computeWorkerResultSubjectDigest(subject)
        : computeReleaseCandidateSubjectDigest(subject),
  };
  for (const [field, value] of Object.entries(identities))
    if (authority.value[field as keyof typeof identities] !== value)
      issues.push(`authority.${field}:mismatch`);
  const outcome = authority.value.outcome;
  if ((attempt === null) !== (outcome.attemptResultDigest === null))
    issues.push("attempt:presence-mismatch");
  if (attempt?.ok) {
    if (outcome.attemptResultDigest !== computeReviewAttemptResultDigest(attempt.value))
      issues.push("authority.outcome.attemptResultDigest:mismatch");
    for (const [field, value] of Object.entries(identities))
      if (attempt.value[field as keyof typeof identities] !== value)
        issues.push(`attempt.${field}:mismatch`);
    if (attempt.value.cycleId !== request.value.reviewCycleId)
      issues.push("attempt.cycleId:mismatch");
    if (
      subject.schemaVersion === "worker-result-subject/v1" &&
      attempt.value.attemptId === subject.authorAttemptId
    )
      issues.push("attempt.attemptId:same-author-attempt");
    const result = attempt.value.result;
    if (result.kind === "BLOCKED") {
      const action = request.value.packet.brief.action as ContractRecord;
      for (const [index, finding] of result.findings.entries())
        if (finding.disposition.moduleDescriptorDigest !== action.moduleDescriptorDigest)
          issues.push(
            `attempt.result.findings.${index}.disposition.moduleDescriptorDigest:mismatch`,
          );
    }
    if (
      (outcome.kind === "accepted" && result.kind !== "SWEEP_COMPLETE") ||
      (outcome.kind === "rejected" && result.kind !== "BLOCKED") ||
      (outcome.kind === "unknown" &&
        outcome.reason === "RESULT_NONCOMPLETE" &&
        (result.kind === "SWEEP_COMPLETE" || result.kind === "BLOCKED"))
    )
      issues.push("authority.outcome:result-kind-mismatch");
  }
  return issues.length ? invalid(...issues) : authority;
}

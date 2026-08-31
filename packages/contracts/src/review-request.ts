import { parseDispatchBrief } from "./dispatch.js";
import {
  computeReleaseCandidateSubjectDigest,
  computeWorkerResultSubjectDigest,
  parseReviewSubject,
  type ReviewSubject,
} from "./review-subject.js";
import {
  canonicalDigest,
  frame,
  framedDigest,
  isCanonicalDecimal,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

export const reviewRequestSchemaVersions = Object.freeze(["review-request/v1"] as const);
export const reviewRequestSchemaFields = Object.freeze({
  request: Object.freeze(["packet", "reviewCycleId", "schemaVersion"] as const),
  packet: Object.freeze(["brief", "evidence", "subject"] as const),
  content: Object.freeze(["byteLength", "contentDigest"] as const),
});

export type ReviewContentReference = Readonly<{
  byteLength: string;
  contentDigest: string;
}>;
export type ReviewPacket = Readonly<{
  // The complete existing dispatch-brief parser owns this nested contract.
  brief: ContractRecord;
  evidence: readonly ReviewContentReference[];
  subject: ReviewSubject;
}>;
export type ReviewRequest = Readonly<{
  packet: ReviewPacket;
  reviewCycleId: string;
  schemaVersion: "review-request/v1";
}>;

function invalid<T extends ContractRecord>(...issues: readonly string[]): ParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

/** Inline shape and target equality only; does not admit retained bytes or their meaning. */
export function parseReviewPacket(input: unknown): ParseResult<ReviewPacket> {
  const snapshot = snapshotClosedRecord(input, reviewRequestSchemaFields.packet);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  const brief = parseDispatchBrief(record.brief);
  const subject = parseReviewSubject(record.subject);
  if (!brief.ok) issues.push(...brief.issues.map((issue) => `brief.${issue}`));
  else if (brief.value.role !== "review") issues.push("brief.role:review-required");
  if (!subject.ok) issues.push(...subject.issues.map((issue) => `subject.${issue}`));
  if (brief.ok && subject.ok) {
    const subjectDigest =
      subject.value.schemaVersion === "worker-result-subject/v1"
        ? computeWorkerResultSubjectDigest(subject.value)
        : computeReleaseCandidateSubjectDigest(subject.value);
    const action = brief.value.action as ContractRecord;
    if (action.immutableSubjectDigest !== subjectDigest)
      issues.push("brief.action.immutableSubjectDigest:mismatch");
  }

  // The outer snapshot has already enforced dense, closed, detached arrays.
  if (!Array.isArray(record.evidence)) issues.push("evidence:array-required");
  else if (record.evidence.length > 256) issues.push("evidence:length-refused");
  else
    for (const [index, content] of record.evidence.entries()) {
      const parsed = snapshotClosedRecord(content, reviewRequestSchemaFields.content);
      if (!parsed.ok) {
        issues.push(...parsed.issues.map((issue) => `evidence.${index}.${issue}`));
        continue;
      }
      const { byteLength, contentDigest } = parsed.value;
      if (!isCanonicalDecimal(byteLength) || /[^0-9]/.test(byteLength))
        issues.push(`evidence.${index}.byteLength:invalid`);
      if (!isSha256(contentDigest) || contentDigest.length !== 64)
        issues.push(`evidence.${index}.contentDigest:invalid`);
    }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ReviewPacket };
}

/** Does not prove chronology, actor independence, dispatch, or effective review authority. */
export function parseReviewRequest(input: unknown): ParseResult<ReviewRequest> {
  const snapshot = snapshotClosedRecord(input, reviewRequestSchemaFields.request);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const packet = parseReviewPacket(record.packet);
  const issues = packet.ok ? [] : packet.issues.map((issue) => `packet.${issue}`);
  if (record.schemaVersion !== "review-request/v1") issues.push("schemaVersion:mismatch");
  if (!isUuidV7(record.reviewCycleId) || record.reviewCycleId.length !== 36)
    issues.push("reviewCycleId:invalid");
  if (packet.ok) {
    const subject = packet.value.subject;
    const subjectCycleId =
      subject.schemaVersion === "worker-result-subject/v1"
        ? subject.authorCycleId
        : subject.assemblyCycleId;
    if (record.reviewCycleId === subjectCycleId) issues.push("reviewCycleId:same-subject-cycle");
  }
  return issues.length ? invalid(...issues) : { ok: true, value: record as ReviewRequest };
}

/** The packet is inline, with no schema alias or framed identity. */
export function computeReviewPacketDigest(input: unknown): string {
  const parsed = parseReviewPacket(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return canonicalDigest(parsed.value);
}

export function computeReviewRequestDigest(input: unknown): string {
  const parsed = parseReviewRequest(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("review-request/v1", [frame.canonical(parsed.value)]);
}

export function parseReviewRequestContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "review-request/v1" ? parseReviewRequest(input) : null;
}

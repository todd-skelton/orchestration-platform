import {
  canonicalBytes,
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isSha256,
  snapshotClosedRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";
import { sha256Bytes } from "./contracts.js";
import {
  computePortablePrimitivesCapabilityDecisionCoreDigest,
  joinPortablePrimitivesIndependentReviewToCore,
  parsePortablePrimitivesCapabilityDecisionCore,
  parsePortablePrimitivesIndependentReview,
  serializePortablePrimitivesCapabilityDecisionCore,
} from "./portable-primitives-decision.js";

export const githubPortablePrimitivesIndependentReviewSchemaVersion =
  "github-portable-primitives-independent-review/v1" as const;

const providerReviewFields = Object.freeze([
  "candidateSubjectDigest",
  "coreBytesDigest",
  "corePath",
  "corePullRequestAuthorId",
  "decisionCoreDigest",
  "mergeCommitRevision",
  "providerRunDigest",
  "pullRequestNumber",
  "repositoryId",
  "reviewCommitRevision",
  "reviewId",
  "reviewedAt",
  "reviewerId",
  "schemaVersion",
  "state",
] as const);

type SerializedProviderReview =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" && isCanonicalDecimal(value) && value !== "0";
}

function revision(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function exactBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype;
}

export function parseGithubPortablePrimitivesIndependentReview(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, providerReviewFields);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues: string[] = [];
  for (const field of [
    "candidateSubjectDigest",
    "coreBytesDigest",
    "decisionCoreDigest",
    "providerRunDigest",
  ] as const)
    if (!isSha256(value[field])) issues.push(`${field}:invalid`);
  for (const field of [
    "corePullRequestAuthorId",
    "pullRequestNumber",
    "repositoryId",
    "reviewId",
    "reviewerId",
  ] as const)
    if (!positiveDecimal(value[field])) issues.push(`${field}:invalid`);
  for (const field of ["mergeCommitRevision", "reviewCommitRevision"] as const)
    if (!revision(value[field])) issues.push(`${field}:invalid`);
  if (!isCanonicalTimestamp(value.reviewedAt)) issues.push("reviewedAt:invalid");
  if (value.schemaVersion !== githubPortablePrimitivesIndependentReviewSchemaVersion)
    issues.push("schemaVersion:mismatch");
  if (value.state !== "APPROVED") issues.push("state:approved-required");
  if (value.reviewerId === value.corePullRequestAuthorId)
    issues.push("reviewerId:author-self-review-refused");
  if (
    isSha256(value.decisionCoreDigest) &&
    value.corePath !==
      `planning/decisions/ISS-022/${String(value.decisionCoreDigest)}/decision-core.json`
  )
    issues.push("corePath:decision-core-address-mismatch");
  return issues.length === 0 ? { ok: true, value } : failure(...issues);
}

export function computeGithubPortablePrimitivesIndependentReviewDigest(input: unknown): string {
  const parsed = parseGithubPortablePrimitivesIndependentReview(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest(githubPortablePrimitivesIndependentReviewSchemaVersion, [
    frame.canonical(parsed.value),
  ]);
}

export function computeGithubReviewerSubjectDigest(
  repositoryId: string,
  reviewerId: string,
): string {
  if (!positiveDecimal(repositoryId)) throw new TypeError("repositoryId:invalid");
  if (!positiveDecimal(reviewerId)) throw new TypeError("reviewerId:invalid");
  return framedDigest("github-reviewer-subject/v1", [
    frame.text(repositoryId),
    frame.text(reviewerId),
  ]);
}

export function serializeGithubPortablePrimitivesIndependentReview(
  input: unknown,
): SerializedProviderReview {
  const parsed = parseGithubPortablePrimitivesIndependentReview(input);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    bytes: canonicalBytes(parsed.value),
    digest: computeGithubPortablePrimitivesIndependentReviewDigest(parsed.value),
  };
}

/**
 * Joins only the canonical provider record to actual portable core/review
 * records and core bytes. It does not authenticate a live GitHub response,
 * protected-main merge, pull request file census, or review freshness.
 */
export function joinGithubPortablePrimitivesIndependentReviewRecords(
  providerReview: unknown,
  decisionCore: unknown,
  independentReview: unknown,
  coreBytes: unknown,
): ParseResult {
  try {
    const provider = parseGithubPortablePrimitivesIndependentReview(providerReview);
    const core = parsePortablePrimitivesCapabilityDecisionCore(decisionCore);
    const review = parsePortablePrimitivesIndependentReview(independentReview);
    if (!provider.ok) return provider;
    if (!core.ok) return failure(...core.issues.map((issue) => `decisionCore.${issue}`));
    if (!review.ok) return failure(...review.issues.map((issue) => `independentReview.${issue}`));
    if (!exactBytes(coreBytes)) return failure("coreBytes:exact-bytes-required");
    const serializedCore = serializePortablePrimitivesCapabilityDecisionCore(core.value);
    if (!serializedCore.ok) return failure("decisionCore:serialization-refused");
    const issues: string[] = [];
    if (!Buffer.from(serializedCore.bytes).equals(Buffer.from(coreBytes)))
      issues.push("coreBytes:canonical-core-mismatch");
    const coreDigest = computePortablePrimitivesCapabilityDecisionCoreDigest(core.value);
    if (provider.value.decisionCoreDigest !== coreDigest)
      issues.push("decisionCoreDigest:core-mismatch");
    if (provider.value.coreBytesDigest !== sha256Bytes(coreBytes))
      issues.push("coreBytesDigest:bytes-mismatch");
    if (provider.value.candidateSubjectDigest !== core.value.candidateSubjectDigest)
      issues.push("candidateSubjectDigest:core-mismatch");
    if (provider.value.providerRunDigest !== core.value.providerRunDigest)
      issues.push("providerRunDigest:core-mismatch");
    const providerDigest = computeGithubPortablePrimitivesIndependentReviewDigest(provider.value);
    if (review.value.providerReviewDigest !== providerDigest)
      issues.push("independentReview.providerReviewDigest:mismatch");
    if (review.value.reviewedAt !== provider.value.reviewedAt)
      issues.push("independentReview.reviewedAt:mismatch");
    const reviewerSubjectDigest = computeGithubReviewerSubjectDigest(
      String(provider.value.repositoryId),
      String(provider.value.reviewerId),
    );
    if (review.value.reviewerSubjectDigest !== reviewerSubjectDigest)
      issues.push("independentReview.reviewerSubjectDigest:mismatch");
    const portableJoin = joinPortablePrimitivesIndependentReviewToCore(review.value, core.value);
    if (!portableJoin.ok)
      issues.push(...portableJoin.issues.map((issue) => `independentReview.${issue}`));
    return issues.length === 0 ? provider : failure(...issues);
  } catch {
    return failure("providerReviewRecordJoin:unreadable");
  }
}

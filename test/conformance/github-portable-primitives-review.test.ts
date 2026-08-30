import { describe, expect, test } from "vitest";
import * as github from "../../packages/conformance/src/github-actions/index.js";
import * as decision from "../../packages/conformance/src/portable-primitives-decision.js";
import { sha256Bytes } from "../../packages/conformance/src/contracts.js";

const d = (value: string): string => value.repeat(64);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const reviewedAt = "2026-08-30T12:00:00.000Z";

const harness = d("3");
const tests = d("4");
const registry = d("5");
const contracts = d("6");
const stable = decision.computePortablePrimitivesStableHarnessSubjectDigest(
  harness,
  tests,
  registry,
  contracts,
);
const core = Object.freeze({
  aggregateDigest: null,
  candidateSubjectDigest: d("1"),
  contractVersionsDigest: contracts,
  custodyProfileDigest: "d01b36552a70cdb11cd1e8baf9df096c515158ca0dd3019176c2c83b6d7eb33d",
  decision: "BLOCK_REPLAN",
  decisionWriterDigest: decision.computePortablePrimitivesDecisionWriterDigest(
    stable,
    harness,
    tests,
    contracts,
  ),
  diagnosticTerminalDigest: d("7"),
  harnessBundleDigest: harness,
  helperAbiDigests: [null, null, null],
  helperDigests: [null, null, null],
  observationDigests: [],
  osProfileDigests: [null, null, null],
  profile: Object.freeze(
    Object.fromEntries(
      Object.keys(decision.portablePrimitivesCapabilityProfile).map((key) => [key, null]),
    ),
  ),
  providerRunDigest: d("2"),
  requiredJobRegistryDigest: registry,
  schemaVersion: decision.portablePrimitivesDecisionCoreSchemaVersion,
  stableHarnessSubjectDigest: stable,
  testBundleDigest: tests,
});
const serializedCore = decision.serializePortablePrimitivesCapabilityDecisionCore(core);
if (!serializedCore.ok) throw new Error(serializedCore.issues.join(","));
const coreDigest = serializedCore.digest;
const provider = Object.freeze({
  candidateSubjectDigest: core.candidateSubjectDigest,
  coreBytesDigest: sha256Bytes(serializedCore.bytes),
  corePath: `planning/decisions/ISS-022/${coreDigest}/decision-core.json`,
  corePullRequestAuthorId: "41",
  decisionCoreDigest: coreDigest,
  mergeCommitRevision: "b".repeat(40),
  providerRunDigest: core.providerRunDigest,
  pullRequestNumber: "119",
  repositoryId: "1335330680",
  reviewCommitRevision: "c".repeat(40),
  reviewId: "33181450469",
  reviewedAt,
  reviewerId: "42",
  schemaVersion: github.githubPortablePrimitivesIndependentReviewSchemaVersion,
  state: "APPROVED",
});
const providerDigest = github.computeGithubPortablePrimitivesIndependentReviewDigest(provider);
const review = Object.freeze({
  decisionCoreDigest: coreDigest,
  providerReviewDigest: providerDigest,
  reviewDisposition: "RECORD_BLOCK_REPLAN",
  reviewedAt,
  reviewerSubjectDigest: github.computeGithubReviewerSubjectDigest(
    provider.repositoryId,
    provider.reviewerId,
  ),
  schemaVersion: decision.portablePrimitivesIndependentReviewSchemaVersion,
});

describe("GitHub portable primitives independent review adapter", () => {
  test("pins canonical provider-review and reviewer-subject identities", () => {
    const serialized = github.serializeGithubPortablePrimitivesIndependentReview(provider);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.digest).toBe(
      "7911fb99a8a047ea05146f80655bc281b3cfe28e578922f7551f3c2e39521b64",
    );
    expect(github.computeGithubReviewerSubjectDigest("1335330680", "42")).toBe(
      "c0e2f31219a95eeed37358f6c989e4d2621cacef35a787f49d24ff2a7cbf13c5",
    );
  });

  test("refuses provider schema, path, actor, revision, approval, and decimal mutants", () => {
    expect(github.parseGithubPortablePrimitivesIndependentReview(provider).ok).toBe(true);
    for (const mutant of [
      { ...provider, extra: true },
      { ...provider, corePath: "planning/decisions/ISS-022/decision-core.json" },
      { ...provider, corePath: `planning/decisions/ISS-022/${d("f")}/decision-core.json` },
      { ...provider, reviewerId: provider.corePullRequestAuthorId },
      { ...provider, corePullRequestAuthorId: "0" },
      { ...provider, pullRequestNumber: "01" },
      { ...provider, repositoryId: "0" },
      { ...provider, reviewId: "0" },
      { ...provider, reviewerId: "0" },
      { ...provider, mergeCommitRevision: "B".repeat(40) },
      { ...provider, reviewCommitRevision: "C".repeat(40) },
      { ...provider, state: "COMMENTED" },
      { ...provider, reviewedAt: "2026-08-30" },
    ])
      expect(github.parseGithubPortablePrimitivesIndependentReview(mutant).ok).toBe(false);
  });

  test("joins actual canonical core, provider, and portable review records only", () => {
    expect(
      github.joinGithubPortablePrimitivesIndependentReviewRecords(
        provider,
        core,
        review,
        serializedCore.bytes,
      ).ok,
    ).toBe(true);
    for (const [providerRecord, coreRecord, reviewRecord, exactCoreBytes] of [
      [{ ...provider, candidateSubjectDigest: d("9") }, core, review, serializedCore.bytes],
      [{ ...provider, providerRunDigest: d("9") }, core, review, serializedCore.bytes],
      [{ ...provider, coreBytesDigest: d("9") }, core, review, serializedCore.bytes],
      [provider, core, { ...review, providerReviewDigest: d("9") }, serializedCore.bytes],
      [provider, core, { ...review, reviewedAt: "2026-08-30T12:00:01.000Z" }, serializedCore.bytes],
      [provider, core, { ...review, reviewerSubjectDigest: d("9") }, serializedCore.bytes],
      [provider, core, { ...review, reviewDisposition: "AUTHORIZE_PASS" }, serializedCore.bytes],
      [provider, core, review, bytes("substituted core\n")],
    ] as const)
      expect(
        github.joinGithubPortablePrimitivesIndependentReviewRecords(
          providerRecord,
          coreRecord,
          reviewRecord,
          exactCoreBytes,
        ).ok,
      ).toBe(false);
  });
});

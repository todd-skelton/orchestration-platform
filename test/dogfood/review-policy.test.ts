import { expect, it } from "vitest";
import {
  sourceReviewAuthority,
  sourceReviewBinding,
  validateSourceReviewAuthority,
  validateSourceReviewBinding,
} from "../../scripts/dogfood/review-policy.mjs";
import { classifyReview } from "../../scripts/dogfood/repair-policy.mjs";

const head = "c".repeat(40);
const base = "b".repeat(40);
const input = {
  controller: "stable-controller",
  run: "corrective-source",
  stateDirectory: "/external/corrective-source",
  configFingerprint: "d".repeat(64),
  authorAttempt: "corrective-author",
  candidateHead: head,
  comparisonBase: base,
  executorRevision: "a".repeat(40),
  scope: "delta" as const,
  inheritance: {
    run: "completed-sweep",
    author: "sweep-author",
    review: "independent-review",
    head: base,
    scope: "complete" as const,
    complete: true as const,
  },
};

it("binds DELTA to exact source identity and completed comparison ancestry", () => {
  const authority = sourceReviewAuthority(input);
  expect(validateSourceReviewAuthority(authority, input)).toEqual({
    scope: "delta",
    inheritance: input.inheritance,
  });
  for (const mutation of [
    { candidateHead: "e".repeat(40) },
    { comparisonBase: "f".repeat(40) },
    { inheritance: { ...input.inheritance, review: "stale-review" } },
  ])
    expect(() => validateSourceReviewAuthority(authority, { ...input, ...mutation })).toThrow(
      "invalid-source-review-authority",
    );
});

it("fails closed for unbound or malformed DELTA inheritance", () => {
  expect(() => sourceReviewAuthority({ ...input, inheritance: null })).toThrow(
    "invalid-source-review-authority-input",
  );
  expect(() =>
    sourceReviewAuthority({
      ...input,
      inheritance: { ...input.inheritance, head: "f".repeat(40) },
    }),
  ).toThrow("invalid-source-review-authority-input");
  expect(() =>
    sourceReviewAuthority({
      ...input,
      inheritance: { ...input.inheritance, review: input.authorAttempt },
    }),
  ).toThrow("invalid-source-review-authority-input");
});

it("preserves legacy COMPLETE bindings and requires the v2 selection join for DELTA", () => {
  const common = {
    run: input.run,
    stateDirectory: input.stateDirectory,
    configFingerprint: input.configFingerprint,
    authorAttempt: input.authorAttempt,
    candidateHead: input.candidateHead,
    originalReview: "malformed-review",
    selectedReview: "replacement-review",
    selectedDisposition: "passed" as const,
  };
  expect(sourceReviewBinding(common)).toMatchObject({
    schemaVersion: "dogfood-source-review-binding/v1",
  });
  const reviewContract = { scope: input.scope, inheritance: input.inheritance };
  const selected = sourceReviewBinding({ ...common, reviewContract });
  expect(selected).toMatchObject({
    schemaVersion: "dogfood-source-review-binding/v2",
    reviewContract,
  });
  expect(() => validateSourceReviewBinding(selected, { ...common, reviewContract })).not.toThrow();
  expect(() =>
    validateSourceReviewBinding(selected, {
      ...common,
      reviewContract: {
        ...reviewContract,
        inheritance: { ...input.inheritance, review: "substituted-review" },
      },
    }),
  ).toThrow("invalid-source-review-binding");
});

it("keeps scope substitution, incomplete reports and malformed payloads distinct", () => {
  const report = {
    v: 2,
    head,
    complete: true,
    scope: "delta",
    profile: "contract",
    g0: ["PASS", "authorized delta"],
    pairs: Array.from({ length: 12 }, () => ["PASS", "PASS", "checked"]),
    findings: [],
    notes: [],
  };
  expect(classifyReview(JSON.stringify(report), head, "delta").disposition).toBe("complete");
  expect(classifyReview(JSON.stringify(report), head, "complete").disposition).toBe("malformed");
  expect(
    classifyReview(JSON.stringify({ ...report, complete: false, pairs: [] }), head, "delta")
      .disposition,
  ).toBe("incomplete");
  expect(
    classifyReview(
      JSON.stringify({
        ...report,
        pairs: Array.from({ length: 12 }, () => ["INVALID", "INVALID", "bad codes"]),
        findings: [
          {
            file: "scripts/dogfood/queue.ts",
            line: 1,
            severity: "P1",
            defect: "x".repeat(351),
            verification: "bounded",
          },
        ],
      }),
      head,
      "delta",
    ).disposition,
  ).toBe("malformed");
});

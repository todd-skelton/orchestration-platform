import { expect, it } from "vitest";
import {
  parseReview,
  RepairBlocked,
  validateLocations,
} from "../../scripts/dogfood/repair-policy.js";

const run = "synthetic-run";
const head = "a".repeat(40);
const finding = {
  file: "scripts/dogfood/repair-policy.ts",
  line: 2,
  severity: "blocking" as const,
  text: "Keep the review contract small.",
};

const summary = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    run,
    role: "reviewer",
    head,
    verdict: "FAIL",
    findings: [finding],
    g0: "This is the simplest version.",
    ...overrides,
  });

it("parses the verdict, findings and G0 contract", () => {
  expect(parseReview(summary(), run, head)).toEqual({
    run,
    role: "reviewer",
    head,
    verdict: "FAIL",
    findings: [finding],
    g0: "This is the simplest version.",
  });
});

it.each([
  ["malformed JSON", "{"],
  ["the wrong run", summary({ run: "other-run" })],
  ["the wrong head", summary({ head: "b".repeat(40) })],
  ["an inconsistent verdict", summary({ verdict: "PASS" })],
  ["an extra report key", summary({ extra: true })],
  ["an invalid finding", summary({ findings: [{ ...finding, line: 0 }] })],
])("rejects %s", (_name, report) => {
  expect(() => parseReview(report, run, head)).toThrow(RepairBlocked);
});

it("accepts findings only on existing lines in changed candidate files", () => {
  const review = parseReview(summary(), run, head);
  expect(() =>
    validateLocations(review, { changed: [finding.file] }, { [finding.file]: 2 }),
  ).not.toThrow();
  expect(() => validateLocations(review, { changed: [] }, { [finding.file]: 2 })).toThrow(
    "source-finding-location-outside-candidate",
  );
  expect(() =>
    validateLocations(review, { changed: [finding.file] }, { [finding.file]: 1 }),
  ).toThrow("source-finding-location-outside-candidate");
});

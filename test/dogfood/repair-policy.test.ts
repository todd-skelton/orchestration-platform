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

it("ISS-243 accepts unchanged-file notes without admitting unchanged-file blockers", () => {
  const note = { ...finding, severity: "note" };
  const review = parseReview(summary({ verdict: "PASS", findings: [note] }), run, head);
  expect(() => validateLocations(review, { changed: [] }, { [note.file]: 2 })).not.toThrow();
  const blocker = parseReview(summary(), run, head);
  expect(() => validateLocations(blocker, { changed: [] }, { [note.file]: 2 })).toThrow(
    "source-finding-location-outside-candidate",
  );
});

it.each([{}, { [finding.file]: 1 }])("ISS-243 validates note existence and EOF: %j", (counts) => {
  const review = parseReview(
    summary({ verdict: "PASS", findings: [{ ...finding, severity: "note" }] }),
    run,
    head,
  );
  expect(() => validateLocations(review, { changed: [] }, counts)).toThrow(
    "source-finding-location-outside-candidate",
  );
});

it.each([{ file: "../escape" }, { line: 0 }, { line: 1.5 }, { line: "1" }])(
  "ISS-243 keeps malformed note parsing: %j",
  (override) => {
    expect(() =>
      parseReview(
        summary({ verdict: "PASS", findings: [{ ...finding, severity: "note", ...override }] }),
        run,
        head,
      ),
    ).toThrow("malformed-source-finding");
  },
);

it("ISS-243 notes cannot excuse PASS with a blocker", () => {
  expect(() =>
    parseReview(
      summary({ verdict: "PASS", findings: [finding, { ...finding, severity: "note" }] }),
      run,
      head,
    ),
  ).toThrow("inconsistent-source-review-verdict");
});

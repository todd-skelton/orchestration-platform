import { expect, it } from "vitest";
import { sourceReviewerReportPrompt } from "../../scripts/dogfood/repair-adapter.js";

it("keeps the source review location contract in the reviewer prompt", () => {
  const paths = ["scripts/dogfood/queue.ts"];
  expect(sourceReviewerReportPrompt(paths)).toContain(JSON.stringify(paths));
  expect(sourceReviewerReportPrompt(paths)).toContain(
    "Each path must exist at the reviewed Git head",
  );
});

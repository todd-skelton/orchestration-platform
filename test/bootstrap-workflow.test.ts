import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("bounds each bootstrap smoke matrix job to 100 minutes (ISS-206)", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/bootstrap.yml", import.meta.url),
    "utf8",
  );
  const smoke = workflow.match(/^  smoke:\r?\n((?: {4}[^\n]*\n|\r?\n)*)/m)?.[1];
  expect(smoke).toBeDefined();
  expect(smoke).toMatch(/^ {4}runs-on: .+\r?$/m);
  expect(smoke).toMatch(/^ {4}timeout-minutes: 100\r?$/m);
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runPinnedPrettier, validateFormatterInputs } from "../scripts/format.mjs";

const root = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];

async function fixture(source: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "orchestration-format-eol-"));
  temporaryRoots.push(directory);
  const file = resolve(directory, "fixture.ts");
  await writeFile(file, source);
  return file;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("formatter line ending policy", () => {
  test.each(["\n", "\r\n"])("accepts formatted %j sources", async (lineEnding) => {
    const file = await fixture(`export const value = "ok";${lineEnding}`);
    await expect(validateFormatterInputs([file])).resolves.toBeUndefined();
  });

  test.each([
    ["CR-only", 'export const value = "ok";\r'],
    ["a lone carriage return", 'export const value = "ok";\rconst other = 1;\n'],
    ["CRLF followed by LF", 'export const value = "ok";\r\nconst other = 1;\n'],
    ["LF followed by CRLF", 'export const value = "ok";\nconst other = 1;\r\n'],
  ])("rejects %s sources", async (_name, source) => {
    const file = await fixture(source);
    await expect(validateFormatterInputs([file])).rejects.toThrow(/invalid line endings/);
  });

  test("rejects a real formatting defect", async () => {
    const file = await fixture("export const value={ok:true};\n");
    await expect(runPinnedPrettier("check", [file])).rejects.toThrow();
  });
});

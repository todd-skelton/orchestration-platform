import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runPinnedPrettier, validateFormatterInputs } from "../scripts/format.mjs";

const root = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];

async function fixture(source: string, path = "fixture.ts") {
  const directory = await mkdtemp(resolve(tmpdir(), "orchestration-format-eol-"));
  temporaryRoots.push(directory);
  const file = resolve(directory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
  return { directory, file };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("formatter line ending policy", () => {
  test.each(["\n", "\r\n"])("accepts formatted %j sources", async (lineEnding) => {
    const { file } = await fixture(`export const value = "ok";${lineEnding}`);
    await expect(validateFormatterInputs([file])).resolves.toBeUndefined();
  });

  test.each([
    ["CR-only Markdown", "fixture.md", "# title\r"],
    ["a lone carriage return in CSS", "fixture.css", "a {}\rbody {}\n"],
    ["CRLF followed by LF in HTML", "fixture.html", "<p>one</p>\r\n<p>two</p>\n"],
    ["LF followed by CRLF in Markdown", "fixture.md", "# one\n# two\r\n"],
  ])("rejects %s sources", async (_name, path, source) => {
    const { file } = await fixture(source, path);
    await expect(validateFormatterInputs([file])).rejects.toThrow(/invalid line endings/);
  });

  test.each(["dist/ignored.ts", "modules/.generated/ignored.ts", "fixture.bin"])(
    "ignores malformed %s sources that Prettier skips",
    async (path) => {
      const { directory, file } = await fixture('export const value = "ok";\r', path);
      const ignorePath = resolve(directory, ".prettierignore");
      await writeFile(ignorePath, "dist\nmodules/.generated\n");
      await expect(validateFormatterInputs([file], { ignorePath })).resolves.toBeUndefined();
    },
  );

  test("rejects a real formatting defect", async () => {
    const { file } = await fixture("export const value={ok:true};\n");
    await expect(runPinnedPrettier("check", [file])).rejects.toThrow();
  });
});

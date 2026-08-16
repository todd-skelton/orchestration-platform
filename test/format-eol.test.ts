import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

async function symlinkFixture(target: string, path: string, type: "file" | "directory") {
  try {
    await symlink(
      target,
      path,
      process.platform === "win32" && type === "directory" ? "junction" : type,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot create ${type} symlink fixture: ${message}`);
  }
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

  test.each(["file", "tree"])(
    "skips malformed symlinked %s sources that Prettier skips",
    async (kind) => {
      const { directory } = await fixture('export const value = "ok";\n', "scan/good.ts");
      const external = resolve(directory, "external");
      const scan = resolve(directory, "scan");
      const malformed = resolve(external, "bad.ts");
      await mkdir(external, { recursive: true });
      await writeFile(malformed, 'export const value = "bad";\r');
      if (kind === "file") {
        await symlinkFixture(malformed, resolve(scan, "bad.ts"), "file");
      } else {
        await symlinkFixture(external, resolve(scan, "linked"), "directory");
      }
      await expect(validateFormatterInputs([scan])).resolves.toBeUndefined();
      await expect(runPinnedPrettier("check", [scan])).resolves.toMatchObject({});
    },
  );

  test("does not recurse through a symlink cycle", async () => {
    const { directory } = await fixture('export const value = "ok";\n', "scan/good.ts");
    const scan = resolve(directory, "scan");
    await symlinkFixture(scan, resolve(scan, "cycle"), "directory");
    await expect(validateFormatterInputs([scan])).resolves.toBeUndefined();
  });

  test("rejects a real formatting defect", async () => {
    const { file } = await fixture("export const value={ok:true};\n");
    await expect(runPinnedPrettier("check", [file])).rejects.toThrow();
  });
});

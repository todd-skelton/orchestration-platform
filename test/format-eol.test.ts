import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const prettier = resolve(root, "node_modules/prettier/bin/prettier.cjs");
const temporaryRoots: string[] = [];

async function fixture(source: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "orchestration-format-eol-"));
  temporaryRoots.push(directory);
  const file = resolve(directory, "fixture.ts");
  await writeFile(file, source);
  return file;
}

function check(file: string) {
  return spawnSync(
    process.execPath,
    [prettier, "--config", resolve(root, ".prettierrc.json"), "--check", file],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("formatter line ending policy", () => {
  test.each(["\n", "\r\n"])("accepts formatted %j sources", async (lineEnding) => {
    const file = await fixture(`export const value = "ok";${lineEnding}`);
    expect(check(file).status).toBe(0);
  });

  test("rejects a real formatting defect", async () => {
    const file = await fixture("export const value={ok:true};\n");
    expect(check(file).status).not.toBe(0);
  });
});

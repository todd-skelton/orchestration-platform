import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const temporaryRoots: string[] = [];

async function fixture(manifest: unknown) {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-modules-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "modules/build"), { recursive: true });
  const source = await readFile(
    resolve(import.meta.dirname, "../modules/build/generate-registry.mjs"),
    "utf8",
  );
  await writeFile(resolve(root, "modules/build/generate-registry.mjs"), source);
  await writeFile(resolve(root, "modules/manifest.json"), `${JSON.stringify(manifest)}\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("empty module registry bootstrap", () => {
  test("emits byte-identical fixed empty registries", async () => {
    const root = await fixture([]);
    const script = resolve(root, "modules/build/generate-registry.mjs");
    expect(spawnSync(process.execPath, [script], { cwd: root }).status).toBe(0);
    const first = await readFile(resolve(root, "modules/.generated/registry.ts"));
    expect(spawnSync(process.execPath, [script], { cwd: root }).status).toBe(0);
    const second = await readFile(resolve(root, "modules/.generated/registry.ts"));
    expect(second.equals(first)).toBe(true);
  });

  test("refuses a non-empty module row with ISS-011", async () => {
    const root = await fixture([{ id: "planning" }]);
    const result = spawnSync(
      process.execPath,
      [resolve(root, "modules/build/generate-registry.mjs")],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ISS-011");
  });

  test("refuses dynamic generator arguments with ISS-011", async () => {
    const root = await fixture([]);
    const result = spawnSync(
      process.execPath,
      [resolve(root, "modules/build/generate-registry.mjs"), "planning"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ISS-011");
  });

  test("refuses an edited generated stub with ISS-011", async () => {
    const root = await fixture([]);
    await mkdir(resolve(root, "modules/.generated"), { recursive: true });
    await writeFile(
      resolve(root, "modules/.generated/registry.ts"),
      "export const forged = true;\n",
    );
    const result = spawnSync(
      process.execPath,
      [resolve(root, "modules/build/generate-registry.mjs")],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ISS-011");
  });
});

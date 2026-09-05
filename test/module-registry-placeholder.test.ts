import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const temporaryRoots: string[] = [];
const emptyRegistry = "export const moduleRegistry = Object.freeze([]) as readonly never[];\n";
const emptyRegistryDigest = "ec5fd221aaf493285cd3a81e35cc7e46ab9c99d589741093471035586ae66b40";
const malformedManifest = "CAPABILITY_NOT_IMPLEMENTED: ISS-011 owns malformed module manifests";
const editedManifest = "CAPABILITY_NOT_IMPLEMENTED: ISS-011 owns edited module manifests";
const moduleArguments = "CAPABILITY_NOT_IMPLEMENTED: ISS-011 does not accept module arguments";
const editedStub = "CAPABILITY_NOT_IMPLEMENTED: ISS-011 refuses an edited generated stub";

async function fixture(manifest: unknown, lineEnding = "\n") {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-modules-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "modules/build"), { recursive: true });
  const source = await readFile(
    resolve(import.meta.dirname, "../modules/build/generate-registry.mjs"),
    "utf8",
  );
  await writeFile(resolve(root, "modules/build/generate-registry.mjs"), source);
  const normalizer = await readFile(resolve(import.meta.dirname, "../scripts/tracked-text.mjs"));
  await mkdir(resolve(root, "scripts"), { recursive: true });
  await writeFile(resolve(root, "scripts/tracked-text.mjs"), normalizer);
  await writeFile(
    resolve(root, "modules/manifest.json"),
    `${JSON.stringify(manifest)}${lineEnding}`,
  );
  return root;
}

function runGenerator(root: string, argv: string[] = [], cwd = root) {
  return spawnSync(
    process.execPath,
    [resolve(root, "modules/build/generate-registry.mjs"), ...argv],
    {
      cwd,
      encoding: "utf8",
    },
  );
}

function refusalMessage(stderr: string) {
  return stderr.match(/^Error: (.+)$/m)?.[1];
}

function expectRefusal(result: ReturnType<typeof runGenerator>, expectedMessage: string) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(refusalMessage(result.stderr)).toBe(expectedMessage);
}

async function modulePaths(root: string) {
  const modulesRoot = resolve(root, "modules");
  const paths: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else {
        paths.push(relative(modulesRoot, entryPath).replaceAll("\\", "/"));
      }
    }
  }
  await visit(modulesRoot);
  return paths.sort();
}

async function trackedSourceFiles(root: string) {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", ".generated"].includes(entry.name)) continue;
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (
        [".ts", ".mts", ".mjs", ".js"].some((extension) => entry.name.endsWith(extension))
      ) {
        files.push(entryPath);
      }
    }
  }
  for (const directory of ["modules", "adapters", "packages", "bootstrap", "scripts"]) {
    await visit(resolve(root, directory));
  }
  return files;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("empty module registry bootstrap", () => {
  test.each(["\n", "\r\n"])(
    "emits canonical byte-identical registries from %j manifests",
    async (lineEnding) => {
      const root = await fixture([], lineEnding);
      expect(runGenerator(root).status).toBe(0);
      const first = await readFile(resolve(root, "modules/.generated/registry.ts"));
      expect(first.toString("utf8")).toBe(emptyRegistry);
      expect(runGenerator(root).status).toBe(0);
      const second = await readFile(resolve(root, "modules/.generated/registry.ts"));
      expect(second.equals(first)).toBe(true);
    },
  );

  test.each([
    ["missing manifest", undefined, malformedManifest],
    ["mixed line endings", "[]\r\n\n", malformedManifest],
    ["lone carriage return", "[]\r", malformedManifest],
    ["missing final LF", "[]", editedManifest],
    ["byte-order mark", "﻿[]\n", editedManifest],
    ["whitespace-edited manifest", "[ ]\n", editedManifest],
    ["extra final LF", "[]\n\n", editedManifest],
    ["semantic manifest", "{}\n", editedManifest],
  ])("refuses %s with its complete category message", async (_name, manifestSource, message) => {
    const root = await fixture([]);
    if (manifestSource === undefined) {
      await unlink(resolve(root, "modules/manifest.json"));
    } else {
      await writeFile(resolve(root, "modules/manifest.json"), manifestSource);
    }
    expectRefusal(runGenerator(root), message);
  });

  test("refuses a non-empty manifest by the empty-manifest byte rule", async () => {
    const root = await fixture([{ id: "planning" }]);
    expectRefusal(runGenerator(root), editedManifest);
  });

  test("refuses generator arguments with its complete category message", async () => {
    const root = await fixture([]);
    expectRefusal(runGenerator(root, ["planning"]), moduleArguments);
  });

  test("refuses an edited generated stub with its complete category message", async () => {
    const root = await fixture([]);
    const forged = "export const forged = true;\n";
    await mkdir(resolve(root, "modules/.generated"), { recursive: true });
    await writeFile(resolve(root, "modules/.generated/registry.ts"), forged);
    expectRefusal(runGenerator(root), editedStub);
    expect(await readFile(resolve(root, "modules/.generated/registry.ts"), "utf8")).toBe(forged);
  });

  test("censuses the sole emitted registry output", async () => {
    const root = await fixture([]);
    expect(runGenerator(root).status).toBe(0);
    const output = resolve(root, "modules/.generated/registry.ts");
    const bytes = await readFile(output);
    expect(await readdir(resolve(root, "modules/.generated"))).toEqual(["registry.ts"]);
    expect(bytes.byteLength).toBe(69);
    expect(bytes.toString("utf8")).toBe(emptyRegistry);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(emptyRegistryDigest);
    expect(await modulePaths(root)).toEqual([
      ".generated/registry.ts",
      "build/generate-registry.mjs",
      "manifest.json",
    ]);
  });

  test.each([
    ["missing manifest", undefined],
    ["mixed line endings", "[]\r\n\n"],
    ["lone carriage return", "[]\r"],
    ["missing final LF", "[]"],
    ["byte-order mark", "﻿[]\n"],
    ["whitespace-edited manifest", "[ ]\n"],
    ["extra final LF", "[]\n\n"],
    ["semantic manifest", "{}\n"],
    ["non-empty manifest", '[{"id":"planning"}]\n'],
  ])("leaves a prior registry unchanged on %s refusal", async (_name, manifestSource) => {
    const root = await fixture([]);
    const output = resolve(root, "modules/.generated/registry.ts");
    await mkdir(resolve(root, "modules/.generated"), { recursive: true });
    await writeFile(output, emptyRegistry);
    if (manifestSource === undefined) {
      await unlink(resolve(root, "modules/manifest.json"));
    } else {
      await writeFile(resolve(root, "modules/manifest.json"), manifestSource);
    }
    expect(runGenerator(root).status).toBe(1);
    expect(await readFile(output, "utf8")).toBe(emptyRegistry);
    expect(
      (await readdir(resolve(root, "modules/.generated"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  test("leaves a prior registry unchanged on an argument refusal", async () => {
    const root = await fixture([]);
    const output = resolve(root, "modules/.generated/registry.ts");
    await mkdir(resolve(root, "modules/.generated"), { recursive: true });
    await writeFile(output, emptyRegistry);
    expect(runGenerator(root, ["planning"]).status).toBe(1);
    expect(await readFile(output, "utf8")).toBe(emptyRegistry);
    expect(
      (await readdir(resolve(root, "modules/.generated"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  test.each([
    ["missing manifest", undefined],
    ["mixed line endings", "[]\r\n\n"],
    ["lone carriage return", "[]\r"],
    ["missing final LF", "[]"],
    ["byte-order mark", "﻿[]\n"],
    ["whitespace-edited manifest", "[ ]\n"],
    ["extra final LF", "[]\n\n"],
    ["semantic manifest", "{}\n"],
    ["non-empty manifest", '[{"id":"planning"}]\n'],
  ])("does not create generated output on %s refusal", async (_name, manifestSource) => {
    const root = await fixture([]);
    if (manifestSource === undefined) {
      await unlink(resolve(root, "modules/manifest.json"));
    } else {
      await writeFile(resolve(root, "modules/manifest.json"), manifestSource);
    }
    expect(runGenerator(root).status).toBe(1);
    await expect(stat(resolve(root, "modules/.generated"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("does not create generated output on an argument refusal", async () => {
    const root = await fixture([]);
    expect(runGenerator(root, ["planning"]).status).toBe(1);
    await expect(stat(resolve(root, "modules/.generated"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("repeats byte-identically over a pre-seeded correct registry", async () => {
    const root = await fixture([]);
    const output = resolve(root, "modules/.generated/registry.ts");
    await mkdir(resolve(root, "modules/.generated"), { recursive: true });
    await writeFile(output, emptyRegistry);
    expect(runGenerator(root).status).toBe(0);
    expect(await readFile(output, "utf8")).toBe(emptyRegistry);
  });

  test("writes from its repository root when invoked from an unrelated directory", async () => {
    const root = await fixture([]);
    const unrelated = await mkdtemp(resolve(tmpdir(), "orchestration-unrelated-"));
    temporaryRoots.push(unrelated);
    expect(runGenerator(root, [], unrelated).status).toBe(0);
    expect(await readFile(resolve(root, "modules/.generated/registry.ts"), "utf8")).toBe(
      emptyRegistry,
    );
    expect(await readdir(unrelated)).toEqual([]);
  });

  test("censuses the generator as the only generated-registry writer", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "..");
    const sourceFiles = await trackedSourceFiles(repositoryRoot);
    const references = (
      await Promise.all(
        sourceFiles.map(async (path) => ({
          path: relative(repositoryRoot, path).replaceAll("\\", "/"),
          source: await readFile(path, "utf8"),
        })),
      )
    )
      .filter(({ source }) => source.includes("modules/.generated"))
      .map(({ path }) => path)
      .sort();
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(references).toEqual([
      "adapters/self/build/composition.ts",
      "modules/build/generate-registry.mjs",
    ]);
  });
});

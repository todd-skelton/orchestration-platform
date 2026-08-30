import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { buildWindowsReparseFact } from "../../scripts/build/windows-reparse-fact.mjs";
import {
  createWindowsReparseFactAdapter,
  parseWindowsReparseFactForTesting,
  type WindowsReparseFact,
} from "../../packages/config/src/windows-reparse-fact.js";

type MutantBinding = Readonly<{
  aclMutant(path: string): {
    observation: unknown;
    readWriteDenied: boolean;
    renameAllowed: boolean;
  };
  replaceRestore(
    original: string,
    replacement: string,
  ): Readonly<Record<"after" | "before" | "during" | "replacement", unknown>>;
}>;

const repositoryRoot = resolve(import.meta.dirname, "../..");
const artifactRoot = resolve(repositoryRoot, ".artifacts/native/windows-reparse-fact");
const require = createRequire(import.meta.url);
const execute = promisify(execFile);
let root = "";
let mutants: MutantBinding | undefined;
const adapter = createWindowsReparseFactAdapter(
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX",
);

function fact(value: unknown): WindowsReparseFact {
  const parsed = parseWindowsReparseFactForTesting(value);
  expect(parsed).toBeDefined();
  return parsed!;
}

beforeAll(async () => {
  const built = await buildWindowsReparseFact();
  if (process.platform === "win32") {
    expect(built.status).toBe("BUILT");
    mutants = require(resolve(artifactRoot, "windows_reparse_fact_mutants.node")) as MutantBinding;
    root = await realpath(await mkdtemp(resolve(tmpdir(), "iss003-native-reparse-")));
  } else {
    expect(built.status).toBe("UNSUPPORTED");
  }
}, 120_000);

afterAll(async () => {
  if (root !== "") {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  }
});

describe("Windows reparse fact closed boundary", () => {
  test("refuses malformed native facts without retaining caller data", () => {
    const valid = {
      identity: { fileId: "1".repeat(32), volumeSerialNumber: "2".repeat(16) },
      kind: "DIRECTORY",
      reparsePoint: false,
      reparseTag: null,
    };
    expect(fact(valid)).toEqual(valid);
    expect(Object.isFrozen(fact(valid))).toBe(true);
    expect(Object.isFrozen(fact(valid).identity)).toBe(true);

    for (const malformed of [
      null,
      Object.create(null),
      { ...valid, extra: true },
      { ...valid, identity: { ...valid.identity, fileId: "A".repeat(32) } },
      { ...valid, reparsePoint: true },
      { ...valid, reparseTag: 1 },
      Object.defineProperty({ ...valid }, "kind", { enumerable: true, get: () => "DIRECTORY" }),
      new Proxy(valid, {
        ownKeys: () => {
          throw new Error("trap");
        },
      }),
    ]) {
      expect(parseWindowsReparseFactForTesting(malformed)).toBeUndefined();
    }
  });

  test("returns explicit unsupported behavior without loading a Windows addon", () => {
    if (process.platform !== "win32") {
      expect(adapter.observe("C:\\project")).toEqual({
        error: { code: "UNSUPPORTED" },
        ok: false,
      });
    }
  });

  test.runIf(process.platform === "win32")("refuses malformed path input as closed data", () => {
    for (const input of [null, 1, "", ".", "C:/project", "\\\\server\\share", "C:\\a\\..\\b"])
      expect(adapter.observe(input)).toEqual({
        error: { code: "OBSERVATION_REFUSED" },
        ok: false,
      });
  });

  test.runIf(process.platform === "win32")(
    "observes an ordinary directory and an actual junction without following it",
    async () => {
      const ordinary = resolve(root, "ordinary");
      const target = resolve(root, "target");
      const junction = resolve(root, "junction");
      await mkdir(ordinary);
      await mkdir(target);
      await symlink(target, junction, "junction");

      const ordinaryResult = adapter.observe(ordinary);
      expect(ordinaryResult.ok).toBe(true);
      if (!ordinaryResult.ok) return;
      expect(ordinaryResult.value).toMatchObject({
        kind: "DIRECTORY",
        reparsePoint: false,
        reparseTag: null,
      });

      const junctionResult = adapter.observe(junction);
      expect(junctionResult.ok).toBe(true);
      if (!junctionResult.ok) return;
      expect(junctionResult.value.kind).toBe("DIRECTORY");
      expect(junctionResult.value.reparsePoint).toBe(true);
      expect(junctionResult.value.reparseTag).toBe(0xa0000003);
      expect(junctionResult.value.identity).not.toEqual(ordinaryResult.value.identity);
    },
  );

  test.runIf(process.platform === "win32")(
    "binds identity to a retained handle across replace and restore",
    async () => {
      const original = resolve(root, "replace-original");
      const replacement = resolve(root, "replace-candidate");
      await mkdir(original);
      await mkdir(replacement);
      const observed = mutants!.replaceRestore(original, replacement);
      expect(fact(observed.before).identity).toEqual(fact(observed.during).identity);
      expect(fact(observed.before).identity).toEqual(fact(observed.after).identity);
      expect(fact(observed.before).identity).not.toEqual(fact(observed.replacement).identity);
      expect((await realpath(original)).toLowerCase()).toBe(original.toLowerCase());
      expect((await realpath(replacement)).toLowerCase()).toBe(replacement.toLowerCase());
    },
  );

  test.runIf(process.platform === "win32")(
    "observes correctly when write-data is denied but pathname rename remains allowed",
    async () => {
      const target = resolve(root, "acl-mutant.txt");
      await writeFile(target, "reviewed source", "utf8");
      const observed = mutants!.aclMutant(target);
      expect(observed.readWriteDenied).toBe(true);
      expect(observed.renameAllowed).toBe(true);
      expect(fact(observed.observation)).toMatchObject({
        kind: "FILE",
        reparsePoint: false,
        reparseTag: null,
      });
    },
  );
});

describe("Windows reparse fact source custody", () => {
  test("tracks reviewed source and no compiled native artifact", async () => {
    const tracked = (await execute("git", ["ls-files", "-z"], { cwd: repositoryRoot })).stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"));
    expect(tracked.filter((path) => /\.(?:dll|dylib|exe|node|so)$/i.test(path))).toEqual([]);
    expect(tracked).toEqual(
      expect.arrayContaining([
        "packages/config/native/windows-reparse-fact/addon.cc",
        "packages/config/native/windows-reparse-fact/manifest.json",
        "packages/config/native/windows-reparse-fact/observation-core.h",
        "packages/config/native/windows-reparse-fact/windows-reparse-fact.gyp",
        "test/config/native/windows-reparse-fact-mutants.cc",
      ]),
    );
  });

  test("keeps runtime observation free of executables and subprocesses", async () => {
    const sources = await Promise.all(
      [
        "packages/config/src/windows-reparse-fact.ts",
        "packages/config/native/windows-reparse-fact/addon.cc",
        "packages/config/native/windows-reparse-fact/observation-core.h",
      ].map(async (path) =>
        (await import("node:fs/promises")).readFile(resolve(repositoryRoot, path), "utf8"),
      ),
    );
    expect(sources.join("\n")).not.toMatch(/child_process|powershell|fsutil|\.exe\b/i);
  });
});

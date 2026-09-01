import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildNativeLockExperiment,
  nativeLockBuildRequiredInputs,
  type NativeLockBuildFile,
  type NativeLockBuildRequest,
} from "../../scripts/build/native-lock-experiment.mjs";
import { createPhaseWatchdog } from "../support/phase-watchdog.js";

type Invocation = {
  file: string;
  argv: string[];
  options: { cwd: string; env: Record<string, string>; shell: boolean; windowsHide: boolean };
};
const synthetic = vi.hoisted(() => ({
  calls: [] as Invocation[],
  marks: new Map<string, (phase: string) => void>(),
  mode: "output" as "output" | "compile-error" | "spawn-missing" | "no-output" | "extra-output",
  mutate: null as ((call: Invocation) => Promise<void>) | null,
}));

// A scoped synthetic compiler adapter exercises the real builder and real files.
// Its output is deliberately NOT a native module. These tests make no native-property,
// successful real compiler, official-distribution, ABI, or load-acceptance claim.
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const { writeFile } = await import("node:fs/promises");
  const fake = Object.assign(
    () => {
      throw new Error("unexpected raw compiler call");
    },
    {
      [promisify.custom]: async (file: string, argv: string[], options: Invocation["options"]) => {
        const mark =
          [...synthetic.marks.entries()].find(([root]) => options.cwd.startsWith(root))?.[1] ??
          (() => undefined);
        mark("compiler.callback:start");
        const call = { file, argv: [...argv], options };
        synthetic.calls.push(call);
        if (synthetic.mode === "spawn-missing")
          throw Object.assign(new Error("synthetic unavailable executable"), { code: "ENOENT" });
        if (synthetic.mode === "compile-error")
          throw Object.assign(new Error("synthetic compiler rejected source"), {
            code: 2,
            stdout: Buffer.from("diagnostic"),
            stderr: Buffer.from("compile failed"),
          });
        const output = argv.at(-1)!.replace(/^\/OUT:/, "");
        if (synthetic.mode !== "no-output") await writeFile(output, "synthetic output; never load");
        if (synthetic.mode === "extra-output")
          await writeFile(resolve(options.cwd, "unexpected.node"), "extra");
        if (synthetic.mutate) {
          mark("compiler.callback.mutation:start");
          await synthetic.mutate(call);
          mark("compiler.callback.mutation:complete");
        }
        mark("compiler.callback:complete");
        return { stdout: Buffer.from("synthetic invocation only"), stderr: Buffer.alloc(0) };
      },
    },
  );
  return { execFile: fake };
});

const roots: string[] = [];
const phases = createPhaseWatchdog("native-lock-build");
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function reference(path: string): Promise<NativeLockBuildFile> {
  const bytes = await readFile(path);
  return { path, byteLength: String(bytes.length), sha256: hash(bytes) };
}
async function file(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return reference(path);
}

async function fixture(): Promise<NativeLockBuildRequest> {
  const root = await phases.within("root.create", async () =>
    realpath(await mkdtemp(resolve(tmpdir(), "native-build-synthetic-"))),
  );
  roots.push(root);
  const stableRoot = resolve(root, "stable");
  const candidateRoot = resolve(root, "candidate");
  const runnerTemp = resolve(root, "runner");
  const sdk = resolve(root, "sdk");
  phases.mark("fixture.materialize:start");
  await mkdir(runnerTemp);
  await mkdir(sdk);
  const stableSource = await file(
    resolve(stableRoot, "probes/portable-primitives/native/native-lock-witness.c"),
    "/* synthetic witness source */",
  );
  const candidateSource = await file(
    resolve(candidateRoot, "probes/portable-primitives/native/native-lock-candidate.c"),
    "/* synthetic candidate source */",
  );
  const stableBuild = await file(
    resolve(stableRoot, "scripts/build/native-lock-experiment.mjs"),
    "// synthetic retained stable build bytes",
  );
  const includeRoot = resolve(root, "distribution/include/node");
  const version = process.version.slice(1).split(".");
  const headers = [];
  for (const name of [
    "node_api.h",
    "node_api_types.h",
    "js_native_api.h",
    "js_native_api_types.h",
    "node_version.h",
  ]) {
    const content =
      name === "node_version.h"
        ? `#define NODE_MAJOR_VERSION ${version[0]}\n#define NODE_MINOR_VERSION ${version[1]}\n#define NODE_PATCH_VERSION ${version[2]}\n#define NODE_MODULE_VERSION ${process.versions.modules}\n`
        : "/* synthetic header */\n";
    headers.push({ ...(await file(resolve(includeRoot, name), content)), path: name });
  }
  const archive = await file(
    resolve(root, `distribution/node-${process.version}-headers.tar.gz`),
    "synthetic archive; extraction proof belongs to stable coordinator",
  );
  const importLibrary =
    process.platform === "win32"
      ? await file(resolve(root, "distribution/node.lib"), "synthetic import library")
      : null;
  const shasums = await file(
    resolve(root, "distribution/SHASUMS256.txt"),
    `${archive.sha256}  node-${process.version}-headers.tar.gz\n${importLibrary ? `${importLibrary.sha256}  win-${process.arch}/node.lib\n` : ""}`,
  );
  phases.mark("fixture.materialize:complete");
  const executable = await phases.within("fixture.readback", () => reference(process.execPath));
  return {
    runnerTemp,
    artifactRoot: resolve(runnerTemp, "artifact"),
    stableRoot,
    candidateRoot,
    stableRevision: "a".repeat(40),
    candidateRevision: "b".repeat(40),
    node: {
      executablePath: process.execPath,
      version: process.version,
      modules: process.versions.modules,
      napi: process.versions.napi!,
      architecture: process.arch,
      platform: process.platform,
      byteLength: executable.byteLength,
      sha256: executable.sha256,
    },
    stableSource,
    candidateSource,
    stableFiles: [{ ...stableBuild, path: "scripts/build/native-lock-experiment.mjs" }],
    distribution: { archive, shasums, includeRoot, headers, importLibrary },
    toolchain: {
      compilerPath: process.execPath,
      compilerVersion: "synthetic adapter only",
      sdkVersion: "synthetic SDK only",
      path: [dirname(process.execPath)],
      include: process.platform === "win32" ? [sdk] : [],
      lib: process.platform === "win32" ? [sdk] : [],
      sdkRoot: process.platform === "darwin" ? sdk : null,
      systemRoot: process.platform === "win32" ? sdk : null,
    },
  };
}

async function instrumentedBuild(input: NativeLockBuildRequest) {
  const mark = phases.scoped();
  synthetic.marks.set(input.artifactRoot, mark);
  mark("build.invoke:start");
  try {
    const result = await buildNativeLockExperiment(input);
    mark("build.source-cleanup:complete");
    return result;
  } catch (error) {
    mark("build.invoke:error");
    throw error;
  } finally {
    synthetic.marks.delete(input.artifactRoot);
  }
}

beforeEach((context) => {
  phases.start(context.task.name);
  synthetic.calls.length = 0;
  synthetic.mode = "output";
  synthetic.mutate = null;
});
afterEach(async () => {
  phases.mark("afterEach.cleanup:start");
  vi.unstubAllEnvs();
  try {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    phases.mark("afterEach.cleanup:complete");
  } finally {
    phases.finish();
  }
});

describe("native-lock private builder: synthetic invocation and byte-custody controls", () => {
  test("uses both fixed role recipes in fresh directories, retains complete bytes, and never marks a load", async () => {
    const input = await fixture();
    const result = await instrumentedBuild(input);
    expect(
      result.builds.map((build) => [build.role, build.revision, build.result, build.loaded]),
    ).toEqual([
      ["STABLE_WITNESS", input.stableRevision, "BUILT", null],
      ["CANDIDATE_BINDING", input.candidateRevision, "BUILT", null],
    ]);
    expect(synthetic.calls).toHaveLength(2);
    expect(new Set(synthetic.calls.map((call) => call.options.cwd)).size).toBe(2);
    for (const [i, call] of synthetic.calls.entries()) {
      const build = result.builds[i]!;
      const sourceName = i === 0 ? "native-lock-witness" : "native-lock-candidate";
      const include = resolve(input.artifactRoot, "inputs/headers");
      const source = resolve(input.artifactRoot, `inputs/${build.role}/${sourceName}.c`);
      const output = resolve(call.options.cwd, `${sourceName}.node`);
      const expected =
        process.platform === "win32"
          ? [
              "/nologo",
              "/TC",
              "/std:c11",
              "/O2",
              "/MD",
              "/LD",
              "/DNAPI_VERSION=8",
              `/I${include}`,
              source,
              resolve(input.artifactRoot, "inputs/distribution/node.lib"),
              "kernel32.lib",
              "/link",
              `/OUT:${output}`,
            ]
          : [
              "-std=c11",
              "-O2",
              "-fPIC",
              ...(process.platform === "darwin"
                ? ["-bundle", "-undefined", "dynamic_lookup"]
                : ["-shared"]),
              "-DNAPI_VERSION=8",
              "-I",
              include,
              source,
              "-o",
              output,
            ];
      expect(call.argv).toEqual(expected);
      expect(build.argv).toEqual(expected);
      expect(call.options).toMatchObject({ shell: false, windowsHide: true });
      for (const census of [build.inputs!, build.outputs!]) {
        expect(census.map((entry) => entry.path)).toEqual(census.map((entry) => entry.path).sort());
        for (const entry of census)
          expect(await reference(resolve(input.artifactRoot, entry.path))).toEqual({
            ...entry,
            path: resolve(input.artifactRoot, entry.path),
          });
      }
      expect(build.outputs!.filter((entry) => entry.path.endsWith(".node"))).toHaveLength(1);
    }
    expect(JSON.stringify(result)).not.toContain("PASS");
    expect(nativeLockBuildRequiredInputs.join(" ")).toContain("entry-to-header byte equality");
    expect(nativeLockBuildRequiredInputs.join(" ")).toContain("loaded:null");
  });

  test("scrubs inherited compiler and loader injection variables", async () => {
    for (const name of [
      "CC",
      "CFLAGS",
      "CPPFLAGS",
      "LDFLAGS",
      "CL",
      "_CL_",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "CPATH",
      "LIBRARY_PATH",
      "PATH",
    ])
      vi.stubEnv(name, "candidate-injection");
    expect(
      (await instrumentedBuild(await fixture())).builds.every((build) => build.result === "BUILT"),
    ).toBe(true);
    for (const call of synthetic.calls) {
      expect(JSON.stringify(call.options.env)).not.toContain("candidate-injection");
      expect(call.options.env.TMP).toBe(call.options.cwd);
      expect(Object.keys(call.options.env).sort()).toEqual(
        [
          "PATH",
          "LANG",
          "LC_ALL",
          "TMP",
          "TEMP",
          "TMPDIR",
          ...(process.platform === "win32" ? ["SystemRoot", "WINDIR", "INCLUDE", "LIB"] : []),
          ...(process.platform === "darwin" ? ["SDKROOT"] : []),
        ].sort(),
      );
    }
  });

  test.each([
    "extra-flags",
    "toolchain-flags",
    "wrong-node",
    "wrong-architecture",
    "source-hash",
    "header-hash",
    "archive-hash",
    "changed-header-version",
    "extra-header",
    "reused-output",
    "source-overlap",
  ])("refuses %s before compiler invocation", async (mutation) => {
    const input = await fixture();
    if (mutation === "extra-flags") Object.assign(input, { flags: ["-O0"] });
    if (mutation === "toolchain-flags") Object.assign(input.toolchain!, { CL: "/DUNREVIEWED" });
    if (mutation === "wrong-node") input.node.version = "v24.0.0-fake";
    if (mutation === "wrong-architecture") input.node.architecture = "wrong";
    if (mutation === "source-hash") input.candidateSource.sha256 = "0".repeat(64);
    if (mutation === "header-hash") input.distribution.headers[0]!.sha256 = "0".repeat(64);
    if (mutation === "archive-hash") input.distribution.archive.sha256 = "0".repeat(64);
    if (mutation === "changed-header-version") {
      const path = resolve(input.distribution.includeRoot, "node_version.h");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(
          /NODE_MAJOR_VERSION [0-9]+/,
          "NODE_MAJOR_VERSION 23",
        ),
      );
      const index = input.distribution.headers.findIndex(
        (entry) => entry.path === "node_version.h",
      );
      input.distribution.headers[index] = { ...(await reference(path)), path: "node_version.h" };
    }
    if (mutation === "extra-header")
      await file(resolve(input.distribution.includeRoot, "injected.h"), "extra");
    if (mutation === "reused-output") await mkdir(input.artifactRoot);
    if (mutation === "source-overlap") input.artifactRoot = resolve(input.stableRoot, "artifact");
    expect((await instrumentedBuild(input)).builds.map((build) => build.result)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(synthetic.calls).toHaveLength(0);
  });

  test.each([
    "missing-capture",
    "missing-compiler",
    "missing-sdk",
    "spawn-missing",
    "compile-error",
  ])(
    "distinguishes prerequisite absence from compiler failure: %s",
    async (mode) => {
      const input = await fixture();
      if (mode === "missing-capture") input.toolchain = null;
      if (mode === "missing-compiler")
        input.toolchain!.compilerPath = resolve(input.runnerTemp, "missing-compiler");
      if (mode === "missing-sdk")
        input.toolchain!.path = [resolve(input.runnerTemp, "missing-sdk")];
      if (mode === "spawn-missing" || mode === "compile-error") synthetic.mode = mode;
      const result = await instrumentedBuild(input);
      expect(result.builds.map((build) => build.result)).toEqual(
        mode === "compile-error" ? ["UNKNOWN", "UNKNOWN"] : ["UNSUPPORTED", "UNSUPPORTED"],
      );
      if (mode.startsWith("missing-")) {
        expect(synthetic.calls).toHaveLength(0);
        expect(
          result.builds.map((build) => [build.argv, build.toolchain, build.outputs, build.loaded]),
        ).toEqual([
          [null, null, null, null],
          [null, null, null, null],
        ]);
      }
      if (mode === "compile-error")
        expect(
          await readFile(
            resolve(input.artifactRoot, "builds/STABLE_WITNESS/compiler.stderr"),
            "utf8",
          ),
        ).toBe("compile failed");
    },
    30_000,
  );

  test.each([
    "no-output",
    "extra-output",
    "changed-source",
    "changed-staged-source",
    "moved-parent",
  ])(
    "refuses %s without treating it as native evidence",
    async (mode) => {
      const input = await fixture();
      if (mode === "no-output" || mode === "extra-output") synthetic.mode = mode;
      if (mode === "changed-source")
        synthetic.mutate = async () => {
          await writeFile(input.candidateSource.path, "changed source");
        };
      if (mode === "changed-staged-source")
        synthetic.mutate = async (call) => {
          const path = call.argv.find((arg) => arg.endsWith(".c"))!;
          await writeFile(path, "changed staged source");
        };
      if (mode === "moved-parent")
        synthetic.mutate = async () => {
          const parent = dirname(input.candidateSource.path);
          await rename(parent, `${parent}-moved`);
          await mkdir(parent);
          await writeFile(input.candidateSource.path, "/* synthetic candidate source */");
        };
      const result = await instrumentedBuild(input);
      expect(result.builds.map((build) => build.result)).toEqual(["UNKNOWN", "UNKNOWN"]);
      expect(result.builds.every((build) => build.loaded === null)).toBe(true);
    },
    30_000,
  );
});

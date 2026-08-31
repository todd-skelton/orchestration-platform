import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  prepareNativeLockBuild,
  type NativeLockInputRequest,
  type NativeLockToolchainCapture,
} from "../../scripts/build/native-lock-inputs.mjs";

type Call = {
  file: string;
  argv: string[];
  options: { cwd: string; env: Record<string, string>; shell: boolean; windowsHide: boolean };
};
const faults = vi.hoisted(() => ({
  calls: [] as Call[],
  buildCreates: 0,
  missingStable: "",
  changedStable: false,
  onCompile: null as ((call: Call) => Promise<void>) | null,
  onReadDirectory: null as ((path: string) => Promise<void>) | null,
  cleanupFailure: false,
}));
// Synthetic compiler outputs only. The real builder owns argv/environment; never load these bytes.
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const { writeFile } = await import("node:fs/promises");
  return {
    execFile: Object.assign(
      () => {
        throw new Error("unexpected command");
      },
      {
        [promisify.custom]: async (file: string, argv: string[], options: Call["options"]) => {
          const call = { file, argv: [...argv], options };
          faults.calls.push(call);
          await writeFile(argv.at(-1)!.replace(/^\/OUT:/, ""), "synthetic output; never load");
          if (faults.onCompile) await faults.onCompile(call);
          return { stdout: Buffer.from("synthetic compiler output"), stderr: Buffer.alloc(0) };
        },
      },
    ),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (String(args[0]).endsWith(`${(await import("node:path")).sep}build`))
        faults.buildCreates++;
      return actual.mkdir(...args);
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (faults.onReadDirectory) await faults.onReadDirectory(String(args[0]));
      return actual.readdir(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (faults.cleanupFailure)
        throw Object.assign(new Error("synthetic cleanup denial"), { code: "EPERM" });
      return actual.unlink(...args);
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: ((...args: Parameters<typeof actual.lstatSync>) => {
      if (
        faults.missingStable &&
        String(args[0]).replaceAll("\\", "/").endsWith(faults.missingStable)
      )
        throw Object.assign(new Error("synthetic missing stable source"), { code: "ENOENT" });
      return actual.lstatSync(...args);
    }) as typeof actual.lstatSync,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      const bytes = actual.readFileSync(...args);
      // Scoped read fault; canonical source files are never modified.
      return faults.changedStable && Buffer.isBuffer(bytes)
        ? Buffer.concat([bytes, Buffer.from("changed")])
        : bytes;
    }) as typeof actual.readFileSync,
  };
});
const roots: string[] = [];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const ref = (path: string, bytes: Buffer | string) => ({
  path,
  byteLength: String(Buffer.byteLength(bytes)),
  sha256: hash(bytes),
});
async function put(path: string, bytes: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return ref(path, bytes);
}
function tarRecord(path: string, payload: string | null) {
  const bytes = Buffer.from(payload ?? ""),
    header = Buffer.alloc(512);
  header.write(path + (payload === null ? "/" : ""), 0, 100, "ascii");
  for (const [offset, width, value] of [
    [100, 8, 0o755],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, bytes.length],
    [136, 12, 0],
  ] as const)
    header.write(value.toString(8).padStart(width - 1, "0") + "\0", offset, width, "ascii");
  header.write(payload === null ? "5" : "0", 156, "ascii");
  header.write("ustar  \0", 257, "ascii");
  header.fill(32, 148, 156);
  header.write(
    header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
    "ascii",
  );
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}
function archive(version = process.version, omit = "") {
  const root = `node-${version}`,
    include = `${root}/include/node`,
    parts = version.slice(1).split(".");
  const payloads = [
    "node_api.h",
    "node_api_types.h",
    "js_native_api.h",
    "js_native_api_types.h",
    "extra.h",
    "config.gypi",
  ]
    .filter((name) => name !== omit)
    .map((name) => tarRecord(`${include}/${name}`, "/* synthetic input */"));
  payloads.push(
    tarRecord(
      `${include}/node_version.h`,
      `#define NODE_MAJOR_VERSION ${parts[0]}\n#define NODE_MINOR_VERSION ${parts[1]}\n#define NODE_PATCH_VERSION ${parts[2]}\n#define NODE_MODULE_VERSION ${process.versions.modules}\n`,
    ),
  );
  const zipped = gzipSync(
    Buffer.concat([
      ...[root, `${root}/include`, include, `${include}/empty`].map((path) =>
        tarRecord(path, null),
      ),
      ...payloads,
      Buffer.alloc(1024),
    ]),
  );
  zipped[3] = 8;
  return Buffer.concat([
    zipped.subarray(0, 10),
    Buffer.from(`${root}-headers.tar\0`),
    zipped.subarray(10),
  ]);
}
async function fixture(available = false) {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "native-inputs-synthetic-")));
  roots.push(base);
  const candidateRoot = resolve(base, "candidate"),
    runnerTemp = resolve(base, "runner"),
    sdk = resolve(base, "sdk");
  await mkdir(runnerTemp);
  await mkdir(sdk);
  const sourcePath = "probes/portable-primitives/native/native-lock-candidate.c" as const;
  const source = await put(
    resolve(candidateRoot, sourcePath),
    "/* distinct synthetic candidate C */",
  );
  const archiveFile = await put(
    resolve(base, `distribution/node-${process.version}-headers.tar.gz`),
    archive(),
  );
  const library =
    process.platform === "win32"
      ? await put(resolve(base, "distribution/node.lib"), "synthetic library")
      : null;
  const sums = await put(
    resolve(base, "distribution/SHASUMS256.txt"),
    `${archiveFile.sha256}  node-${process.version}-headers.tar.gz\n${library ? `${library.sha256}  win-${process.arch}/node.lib\n` : ""}`,
  );
  const capturePath = resolve(base, "capture/host.json");
  const stdout = await put(
    resolve(base, "capture/compiler.stdout"),
    "synthetic version observation",
  );
  const stderr = await put(resolve(base, "capture/compiler.stderr"), "");
  const capture: NativeLockToolchainCapture = {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    state: available ? "AVAILABLE" : "UNAVAILABLE",
    toolchain: available
      ? {
          compilerPath: process.execPath,
          compilerVersion: "synthetic compiler identity",
          sdkVersion: "synthetic SDK identity",
          path: [dirname(process.execPath)],
          include: process.platform === "win32" ? [sdk] : [],
          lib: process.platform === "win32" ? [sdk] : [],
          sdkRoot: process.platform === "darwin" ? sdk : null,
          systemRoot: process.platform === "win32" ? sdk : null,
        }
      : null,
    observations: available
      ? ["COMPILER", "SDK"].map((purpose) => ({
          kind: "COMMAND" as const,
          purpose: purpose as "COMPILER" | "SDK",
          executablePath: process.execPath,
          argv: ["--version"],
          cwd: sdk,
          exitCode: "0",
          signal: null,
          errorCode: null,
          stdout: { ...stdout, path: "compiler.stdout" },
          stderr: { ...stderr, path: "compiler.stderr" },
        }))
      : [
          {
            kind: "LOOKUP",
            purpose: "COMPILER",
            searchDirectories: [sdk],
            selectedPath: null,
            errorCode: "ENOENT",
          },
        ],
  };
  await put(capturePath, JSON.stringify(capture));
  const input: NativeLockInputRequest = {
    runnerTemp,
    candidateRoot,
    stableRevision: "a".repeat(40),
    candidateRevision: "b".repeat(40),
    candidateFile: {
      path: sourcePath,
      byteLength: source.byteLength,
      sha256Digest: source.sha256,
      executable: false,
    },
    distribution: {
      archivePath: archiveFile.path,
      shasumsPath: sums.path,
      importLibraryPath: library?.path ?? null,
    },
    toolchainCapture: capturePath,
  };
  return { input, capture, base, capturePath, sdk };
}
beforeEach(() => {
  faults.calls.length = 0;
  faults.buildCreates = 0;
  faults.missingStable = "";
  faults.changedStable = false;
  faults.onCompile = null;
  faults.onReadDirectory = null;
  faults.cleanupFailure = false;
});
afterEach(async () => {
  faults.onCompile = null;
  faults.onReadDirectory = null;
  faults.cleanupFailure = false;
  faults.changedStable = false;
  faults.missingStable = "";
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("private composed preparation, synthetic evidence only", () => {
  test("real unavailable builder retains two roles and exact stable/input census, pending outer deletion", async () => {
    const { input } = await fixture();
    const result = await prepareNativeLockBuild(input);
    expect(result.status).toBe("PENDING_CANDIDATE_CONSUME");
    expect(faults.buildCreates).toBe(1);
    expect(faults.calls).toHaveLength(0);
    expect(
      result.helper.builds.map((row) => [
        row.role,
        row.revision,
        row.result,
        row.argv,
        row.toolchain,
        row.outputs,
        row.loaded,
      ]),
    ).toEqual([
      ["STABLE_WITNESS", input.stableRevision, "UNSUPPORTED", null, null, null, null],
      ["CANDIDATE_BINDING", input.candidateRevision, "UNSUPPORTED", null, null, null, null],
    ]);
    expect(result.helper.node).toMatchObject({
      executablePath: process.execPath,
      version: process.version,
      architecture: process.arch,
    });
    expect(result.buildRoot).toBe(resolve(input.runnerTemp, "build"));
    expect(result.buildPathPrefix).toBe("build/");
    expect(await readdir(input.runnerTemp)).toEqual(["build", "preparation"]);
    expect(result.stableFiles.map((row) => row.path)).toEqual([
      "packages/contracts/src/runtime.ts",
      "probes/portable-primitives/experiment/facts.mjs",
      "probes/portable-primitives/experiment/fixture.mjs",
      "probes/portable-primitives/experiment/io.mjs",
      "probes/portable-primitives/experiment/session.mjs",
      "scripts/build/native-lock-distribution.mjs",
      "scripts/build/native-lock-experiment.mjs",
      "scripts/build/native-lock-headers.mjs",
      "scripts/build/native-lock-inputs.mjs",
    ]);
    expect(result.extraction.headers.map((row) => row.path)).toContain("config.gypi");
    expect(result.extraction.headers.map((row) => row.path)).toContain("extra.h");
    expect(result.retainedFiles.map((row) => row.path)).toEqual(
      result.retainedFiles.map((row) => row.path).sort(),
    );
    for (const row of result.retainedFiles)
      expect(ref(row.path, await readFile(resolve(input.runnerTemp, row.path)))).toEqual(row);
    expect(result.retainedFiles.some((row) => row.path === "preparation/capture.json")).toBe(true);
    expect(
      result.retainedFiles.filter((row) => row.path.startsWith("build/inputs/stable/")),
    ).toHaveLength(9);
    expect(
      await readFile(
        resolve(result.buildRoot, "inputs/CANDIDATE_BINDING/native-lock-candidate.c"),
        "utf8",
      ),
    ).toContain("distinct synthetic candidate");
  });
  test("available capture composes two fixed synthetic invocations with no ambient influence or load", async () => {
    const { input } = await fixture(true);
    for (const key of [
      "PATH",
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
    ])
      vi.stubEnv(key, "candidate-injection");
    const result = await prepareNativeLockBuild(input);
    expect(faults.calls).toHaveLength(2);
    expect(new Set(faults.calls.map((call) => call.options.cwd)).size).toBe(2);
    for (const [index, call] of faults.calls.entries()) {
      expect(call.file).toBe(process.execPath);
      expect(call.argv).toEqual(result.helper.builds[index]!.argv);
      expect(call.options).toMatchObject({ shell: false, windowsHide: true });
      expect(Object.values(call.options.env)).not.toContain("candidate-injection");
      expect(result.helper.builds[index]).toMatchObject({ result: "BUILT", loaded: null });
      expect(call.argv).toContain(
        process.platform === "win32" ? "/DNAPI_VERSION=8" : "-DNAPI_VERSION=8",
      );
    }
    expect(
      result.retainedFiles.filter((row) => /compiler\.(stdout|stderr)$/.test(row.path)),
    ).toHaveLength(6);
  });
  test.each(["node", "stableRoot", "stableFiles", "argv", "build", "loader"])(
    "rejects caller-selected %s before effects",
    async (key) => {
      const { input } = await fixture();
      await expect(prepareNativeLockBuild({ ...input, [key]: "substitute" })).rejects.toThrow();
      expect(faults.buildCreates).toBe(0);
    },
  );
  test("rejects proxies, accessors and symbol extras without invoking them", async () => {
    const { input } = await fixture();
    let touched = false;
    const getter = { ...input };
    Object.defineProperty(getter, "candidateFile", {
      enumerable: true,
      get: () => {
        touched = true;
        return input.candidateFile;
      },
    });
    for (const value of [
      getter,
      new Proxy(input, {
        ownKeys: () => {
          touched = true;
          return [];
        },
      }),
      { ...input, [Symbol("extra")]: 1 },
    ])
      await expect(prepareNativeLockBuild(value)).rejects.toThrow();
    expect(touched).toBe(false);
    expect(await readdir(input.runnerTemp)).toEqual([]);
  });
  test.each([
    "null",
    "unknown",
    "no-observation",
    "unclassified",
    "version",
    "sdk",
    "signal",
    "exit",
    "raw-text",
    "escape",
    "candidate-search",
  ])("capture %s never launders into unsupported", async (mutation) => {
    const { input, capture, capturePath } = await fixture(true);
    const compiler = capture.observations[0]!;
    if (mutation === "null") input.toolchainCapture = null;
    if (mutation === "unknown") {
      capture.state = "UNKNOWN";
      capture.toolchain = null;
    }
    if (mutation === "no-observation") {
      capture.state = "UNAVAILABLE";
      capture.toolchain = null;
      capture.observations = [];
    }
    if (mutation === "unclassified" && compiler.kind === "COMMAND") {
      capture.state = "UNAVAILABLE";
      capture.toolchain = null;
      compiler.exitCode = null;
      compiler.errorCode = "EIO";
    }
    if (mutation === "version") capture.nodeVersion = "v24.0.0-substitute";
    if (mutation === "sdk") capture.toolchain!.sdkVersion = "";
    if (mutation === "signal" && compiler.kind === "COMMAND")
      compiler.signal = "made-up" as NodeJS.Signals;
    if (mutation === "exit" && compiler.kind === "COMMAND") compiler.exitCode = "00";
    if (mutation === "raw-text" && compiler.kind === "COMMAND")
      Object.assign(compiler, { stdout: "copied text" });
    if (mutation === "escape" && compiler.kind === "COMMAND") compiler.stdout.path = "../escape";
    if (mutation === "candidate-search") capture.toolchain!.path = [input.candidateRoot];
    await writeFile(capturePath, JSON.stringify(capture));
    await expect(prepareNativeLockBuild(input)).rejects.toThrow();
    expect(faults.calls).toHaveLength(0);
  });
  test.each([
    "missing",
    "duplicate",
    "wrong-version",
    "library",
    "candidate-row",
    "candidate-bytes",
    "overlap",
    "stable-missing",
  ])("refuses %s input binding", async (mutation) => {
    const { input } = await fixture();
    if (mutation === "missing") await writeFile(input.distribution.shasumsPath, "");
    if (mutation === "duplicate")
      await writeFile(
        input.distribution.shasumsPath,
        (await readFile(input.distribution.shasumsPath, "utf8")).repeat(2),
      );
    if (mutation === "wrong-version") {
      const bytes = archive("v24.0.0");
      await writeFile(input.distribution.archivePath, bytes);
      await writeFile(
        input.distribution.shasumsPath,
        `${hash(bytes)}  node-${process.version}-headers.tar.gz\n`,
      );
    }
    if (mutation === "library")
      input.distribution.importLibraryPath =
        process.platform === "win32" ? null : input.distribution.archivePath;
    if (mutation === "candidate-row")
      Object.assign(input.candidateFile, {
        path: "probes/portable-primitives/native/native-lock-witness.c",
      });
    if (mutation === "candidate-bytes")
      await writeFile(resolve(input.candidateRoot, input.candidateFile.path), "changed");
    if (mutation === "overlap") input.runnerTemp = input.candidateRoot;
    if (mutation === "stable-missing")
      faults.missingStable = "scripts/build/native-lock-experiment.mjs";
    await expect(prepareNativeLockBuild(input)).rejects.toThrow();
    expect(faults.calls).toHaveLength(0);
  });
  test.each(["before", "during"])(
    "empty directory mutation %s builder poisons composed result",
    async (when) => {
      const { input } = await fixture(true),
        headerRoot = resolve(input.runnerTemp, "headers"),
        empty = resolve(headerRoot, `node-${process.version}/include/node/empty`);
      if (when === "before") {
        let reads = 0;
        faults.onReadDirectory = async (path) => {
          if (path === headerRoot && ++reads === 2) await rmdir(empty);
        };
      } else
        faults.onCompile = async () => {
          faults.onCompile = null;
          await rmdir(empty);
        };
      await expect(prepareNativeLockBuild(input)).rejects.toThrow();
      if (when === "before") expect(faults.calls).toHaveLength(0);
      else expect(faults.calls).toHaveLength(2); // Builder's file-only census cannot see this mutation.
    },
  );
  test.each(["capture", "retained", "extra", "header", "stable", "cleanup"])(
    "post-build %s failure cannot escape as pending success",
    async (mutation) => {
      const { input, capturePath } = await fixture(true);
      faults.onCompile = async () => {
        faults.onCompile = null;
        if (mutation === "capture") await writeFile(capturePath, "changed");
        if (mutation === "retained")
          await writeFile(resolve(input.runnerTemp, "preparation/compiler.stdout"), "changed");
        if (mutation === "extra")
          await writeFile(resolve(input.runnerTemp, "preparation/unexpected"), "extra");
        if (mutation === "header")
          await writeFile(
            resolve(input.runnerTemp, `headers/node-${process.version}/include/node/config.gypi`),
            "changed",
          );
        if (mutation === "stable") faults.changedStable = true;
        if (mutation === "cleanup") faults.cleanupFailure = true;
      };
      await expect(prepareNativeLockBuild(input)).rejects.toMatchObject({
        message: "native-lock-inputs:preparation-refused",
        residualPaths: expect.arrayContaining([resolve(input.runnerTemp, "headers")]),
      });
      expect(faults.calls.length).toBeGreaterThan(0);
    },
  );
});

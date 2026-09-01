import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  acquireHostedNativeLockInputs,
  type HostedNativeLockAcquisitionBoundary,
  type NativeLockExecutableLookup,
  type NativeLockCommandResult,
} from "../../scripts/conformance/hosted-native-lock-acquisition.mjs";

const sealFaults = vi.hoisted(() => ({
  onReadDirectory: null as ((path: string) => Promise<void>) | null,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const rows = await actual.readdir(...args);
      if (sealFaults.onReadDirectory) await sealFaults.onReadDirectory(String(args[0]));
      return rows;
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  sealFaults.onReadDirectory = null;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const parent = await realpath(
    await mkdtemp(resolve(tmpdir(), "hosted-native-lock-acquisition-")),
  );
  roots.push(parent);
  const root = resolve(parent, "acquisition");
  const bin = resolve(parent, "bin");
  const include = resolve(parent, "include");
  const lib = resolve(parent, "lib");
  const sdk = resolve(parent, "MacOSX15.4.sdk");
  const systemRoot = resolve(parent, "system-root");
  await Promise.all([root, bin, include, lib, sdk, systemRoot].map((path) => mkdir(path)));
  for (const name of ["cc", "clang", "xcrun", "cl.exe"])
    await writeFile(resolve(bin, name), "stable synthetic executable", "utf8");
  const environment: Record<string, string> = {
    PATH: bin,
    CANDIDATE_INJECTION: "must-not-reach-command",
  };
  if (process.platform === "win32")
    Object.assign(environment, {
      INCLUDE: include,
      LIB: lib,
      SystemRoot: systemRoot,
      WindowsSDKVersion: "10.0.26100.0\\",
    });
  return { bin, environment, include, lib, parent, root, sdk, systemRoot };
}

function exactResponse(
  body: ConstructorParameters<typeof Response>[0],
  url: string,
  init: ResponseInit = { status: 200 },
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { configurable: false, value: url });
  return response;
}

function command(
  stdout = "stable compiler output\n",
  changes: Partial<NativeLockCommandResult> = {},
): NativeLockCommandResult {
  return {
    errorCode: null,
    exitCode: 0,
    signal: null,
    stderr: new Uint8Array(),
    stdout: new TextEncoder().encode(stdout),
    ...changes,
  };
}

describe("hosted native-lock acquisition", () => {
  test("acquires only exact Node inputs and retains a closed hosted toolchain capture", async () => {
    const value = await fixture();
    const urls: string[] = [];
    const executions: Array<{
      file: string;
      argv: readonly string[];
      environment: Readonly<Record<string, string>>;
    }> = [];
    const boundary: HostedNativeLockAcquisitionBoundary = {
      async fetch(url) {
        urls.push(url);
        const bytes = new TextEncoder().encode(`retained:${url}`);
        return exactResponse(bytes, url, {
          headers: { "content-length": String(bytes.byteLength) },
          status: 200,
        });
      },
      async resolveExecutable(name) {
        return { path: resolve(value.bin, name), state: "FOUND" };
      },
      async execute(file, argv, options) {
        executions.push({ file, argv, environment: options.env });
        if (process.platform === "darwin" && argv.includes("--show-sdk-path"))
          return command(`${value.sdk}\n`);
        return command();
      },
    };
    const result = await acquireHostedNativeLockInputs(
      { environment: value.environment, root: value.root },
      boundary,
    );
    expect(result).toMatchObject({ ok: true, state: "AVAILABLE" });
    if (!result.ok || result.state !== "AVAILABLE") return;
    expect(urls).toEqual([
      `https://nodejs.org/dist/${process.version}/SHASUMS256.txt`,
      `https://nodejs.org/dist/${process.version}/node-${process.version}-headers.tar.gz`,
      ...(process.platform === "win32"
        ? [`https://nodejs.org/dist/${process.version}/win-${process.arch}/node.lib`]
        : []),
    ]);
    expect(result.importLibraryPath === null).toBe(process.platform !== "win32");
    expect(result.retainedFiles.map((row) => row.path)).toEqual(
      result.retainedFiles.map((row) => row.path).sort(),
    );
    const capture = JSON.parse(await readFile(result.capturePath, "utf8"));
    expect(capture).toMatchObject({
      architecture: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
      state: "AVAILABLE",
    });
    expect(capture.observations).toHaveLength(2);
    expect(capture.toolchain.compilerPath).toMatch(/(?:cc|clang|cl\.exe)$/);
    for (const execution of executions) {
      expect(execution.environment).not.toHaveProperty("CANDIDATE_INJECTION");
      expect(execution.environment).not.toHaveProperty("NODE_OPTIONS");
      expect(execution.environment).not.toHaveProperty("PATH");
    }
  });

  test("classifies missing official inputs and ambiguous command failures without inventing paths", async () => {
    for (const mode of ["missing-distribution", "unknown-toolchain"] as const) {
      const value = await fixture();
      const boundary: HostedNativeLockAcquisitionBoundary = {
        async fetch(url) {
          return mode === "missing-distribution" && url.endsWith("SHASUMS256.txt")
            ? exactResponse(null, url, { status: 404 })
            : exactResponse("retained", url, { status: 200 });
        },
        async resolveExecutable(name) {
          return { path: resolve(value.bin, name), state: "FOUND" };
        },
        async execute(file, argv) {
          if (mode === "unknown-toolchain")
            return command("", { errorCode: "ETIMEDOUT", exitCode: null });
          if (process.platform === "darwin" && argv.includes("--show-sdk-path"))
            return command(`${value.sdk}\n`);
          return command();
        },
      };
      const result = await acquireHostedNativeLockInputs(
        { environment: value.environment, root: value.root },
        boundary,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.state).toBe(mode === "missing-distribution" ? "UNSUPPORTED" : "UNKNOWN");
      expect(result).not.toHaveProperty("archivePath");
      expect(result).not.toHaveProperty("shasumsPath");
    }
  });

  test("rejects redirects, non-200 responses, malformed lengths and unbounded streams", async () => {
    const oversize = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 33; index += 1) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const mutants: Array<readonly [string, (url: string) => Response]> = [
      [
        "redirect",
        (url) => {
          const response = exactResponse("retained", `${url}/other`, { status: 200 });
          Object.defineProperty(response, "redirected", { value: true });
          return response;
        },
      ],
      ["non-200", (url) => exactResponse("retained", url, { status: 500 })],
      [
        "malformed-length",
        (url) =>
          exactResponse("retained", url, {
            headers: { "content-length": "01" },
            status: 200,
          }),
      ],
      [
        "mismatched-length",
        (url) =>
          exactResponse("retained", url, {
            headers: { "content-length": "99" },
            status: 200,
          }),
      ],
      ["unbounded-stream", (url) => exactResponse(oversize, url, { status: 200 })],
    ];
    for (const [name, response] of mutants) {
      const value = await fixture();
      const boundary: HostedNativeLockAcquisitionBoundary = {
        async fetch(url) {
          return response(url);
        },
        async resolveExecutable(executable) {
          return { path: resolve(value.bin, executable), state: "FOUND" };
        },
        async execute() {
          return command();
        },
      };
      const result = await acquireHostedNativeLockInputs(
        { environment: value.environment, root: value.root },
        boundary,
      );
      expect(result, name).toMatchObject({ ok: true, state: "UNKNOWN" });
    }
  });

  test("distinguishes unavailable lookup from ambiguous or moved executable identity", async () => {
    for (const mode of ["EACCES", "EIO", "MOVED"] as const) {
      const value = await fixture();
      let moved = false;
      const lookup: NativeLockExecutableLookup =
        mode === "MOVED"
          ? {
              path: resolve(
                value.bin,
                process.platform === "darwin"
                  ? "clang"
                  : process.platform === "win32"
                    ? "cl.exe"
                    : "cc",
              ),
              state: "FOUND",
            }
          : { errorCode: mode, state: mode === "EACCES" ? "UNAVAILABLE" : "UNKNOWN" };
      const boundary: HostedNativeLockAcquisitionBoundary = {
        async fetch(url) {
          return exactResponse("retained", url, { status: 200 });
        },
        async resolveExecutable(name) {
          if (mode === "MOVED" && process.platform === "darwin" && name === "xcrun")
            return { path: resolve(value.bin, name), state: "FOUND" };
          return lookup;
        },
        async execute(file, argv) {
          if (!moved && mode === "MOVED") {
            moved = true;
            await rename(file, `${file}.moved`);
          }
          if (process.platform === "darwin" && argv.includes("--show-sdk-path"))
            return command(`${value.sdk}\n`);
          return command();
        },
      };
      const result = await acquireHostedNativeLockInputs(
        { environment: value.environment, root: value.root },
        boundary,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toBe(mode === "EACCES" ? "UNSUPPORTED" : "UNKNOWN");
    }
  });

  test("bounds semantic versions and refuses an extra retained-tree file", async () => {
    for (const mode of ["long-version", "extra-file"] as const) {
      const value = await fixture();
      let injected = false;
      const boundary: HostedNativeLockAcquisitionBoundary = {
        async fetch(url) {
          return exactResponse("retained", url, { status: 200 });
        },
        async resolveExecutable(name) {
          return { path: resolve(value.bin, name), state: "FOUND" };
        },
        async execute(file, argv) {
          if (mode === "extra-file" && !injected) {
            injected = true;
            await writeFile(resolve(value.root, "extra"), "unretained", "utf8");
          }
          if (process.platform === "darwin" && argv.includes("--show-sdk-path"))
            return command(`${value.sdk}\n`);
          return command(mode === "long-version" ? `${"x".repeat(1025)}\n` : undefined);
        },
      };
      const result = await acquireHostedNativeLockInputs(
        { environment: value.environment, root: value.root },
        boundary,
      );
      expect(result).toMatchObject(
        mode === "extra-file"
          ? { issues: ["native-lock-acquisition:census-refused"], ok: false }
          : { ok: true, state: "UNKNOWN" },
      );
    }
  });

  test("rechecks an already visited child after the complete tree readback", async () => {
    const value = await fixture();
    let injected = false;
    sealFaults.onReadDirectory = async (path) => {
      if (!injected && path.replaceAll("\\", "/").endsWith("/toolchain")) {
        injected = true;
        await writeFile(resolve(value.root, "distribution", "late-extra"), "unretained", "utf8");
      }
    };
    const boundary: HostedNativeLockAcquisitionBoundary = {
      async fetch(url) {
        return exactResponse("retained", url, { status: 200 });
      },
      async resolveExecutable(name) {
        return { path: resolve(value.bin, name), state: "FOUND" };
      },
      async execute(_file, argv) {
        if (process.platform === "darwin" && argv.includes("--show-sdk-path"))
          return command(`${value.sdk}\n`);
        return command();
      },
    };

    const result = await acquireHostedNativeLockInputs(
      { environment: value.environment, root: value.root },
      boundary,
    );

    expect(injected).toBe(true);
    expect(result).toEqual({
      issues: ["native-lock-acquisition:census-refused"],
      ok: false,
    });
  });

  test("fails closed on reused roots and classifies malformed PATH", async () => {
    const reused = await fixture();
    await writeFile(resolve(reused.root, "existing"), "x", "utf8");
    const never: HostedNativeLockAcquisitionBoundary = {
      async fetch() {
        throw new Error("must not fetch");
      },
      async resolveExecutable() {
        throw new Error("must not resolve");
      },
      async execute() {
        throw new Error("must not execute");
      },
    };
    expect(
      await acquireHostedNativeLockInputs(
        { environment: reused.environment, root: reused.root },
        never,
      ),
    ).toEqual({ issues: ["native-lock-acquisition:root-not-empty"], ok: false });

    const malformed = await fixture();
    const boundary: HostedNativeLockAcquisitionBoundary = {
      async fetch(url) {
        return exactResponse("retained", url, { status: 200 });
      },
      async resolveExecutable() {
        return { errorCode: "ENOENT", state: "UNAVAILABLE" };
      },
      async execute() {
        throw new Error("must not execute");
      },
    };
    expect(
      await acquireHostedNativeLockInputs(
        {
          environment: { PATH: ["relative", malformed.bin].join(delimiter) },
          root: malformed.root,
        },
        boundary,
      ),
    ).toMatchObject({ ok: true, state: "UNKNOWN" });
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as packageRoot from "../../packages/conformance/src/index.js";
import type {
  Iss002IsolatedWalkRunInput,
  Iss002IsolatedWalkRunResult,
  Iss002StableIsolationAuthority,
} from "../../packages/conformance/src/isolated-walk.js";
import type {
  LinuxIsolationAuthority,
  LinuxIsolationAuthorityOptions,
} from "../../packages/conformance/src/linux-isolation-authority.js";
import type { WindowsIsolationAuthorityOptions } from "../../packages/conformance/src/windows-isolation-authority.js";

interface Dependencies {
  readonly linuxFactory: (
    options: LinuxIsolationAuthorityOptions,
  ) => Promise<LinuxIsolationAuthority>;
  readonly platform: NodeJS.Platform;
  readonly run: (
    input: Iss002IsolatedWalkRunInput,
    authority: Iss002StableIsolationAuthority,
  ) => Promise<Iss002IsolatedWalkRunResult>;
  readonly windowsFactory: (
    options: WindowsIsolationAuthorityOptions,
  ) => Promise<Iss002StableIsolationAuthority>;
}

interface TestModule {
  runCore(
    input: unknown,
    configuration: unknown,
    dependencies: Dependencies,
  ): Promise<Iss002IsolatedWalkRunResult>;
}

interface ProductionTestModule {
  runNativeIss002IsolatedWalk(
    input: Iss002IsolatedWalkRunInput,
    configuration: unknown,
  ): Promise<Iss002IsolatedWalkRunResult>;
}

const sourcePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/native-isolated-walk.ts",
);
const fixtureGlobalKey = "__orchestrationNativeWalkFixture";
const temporaryRoots: string[] = [];
const input = Object.freeze({
  candidateArtifactPath: resolve(import.meta.dirname, "candidate.mjs"),
  rpcRunnerPath: resolve(import.meta.dirname, "runner.mjs"),
});
const linuxConfiguration = Object.freeze({
  accountHelperPath: resolve(import.meta.dirname, "account-helper"),
  accountStateRoot: resolve(import.meta.dirname, "account-state"),
  cleanupHelperPath: resolve(import.meta.dirname, "cleanup-helper"),
  dacHelperPath: resolve(import.meta.dirname, "dac-helper"),
  dacStateRoot: resolve(import.meta.dirname, "dac-state"),
  executionParent: resolve(import.meta.dirname, "executions"),
  executionStateRoot: resolve(import.meta.dirname, "execution-state"),
  pidfdHelperPath: resolve(import.meta.dirname, "pidfd-helper"),
  runtimePath: resolve(import.meta.dirname, "node"),
});
const windowsConfiguration = Object.freeze({
  executionParent: resolve(import.meta.dirname, "windows-executions"),
  runtimePath: resolve(import.meta.dirname, "node.exe"),
  stateRoot: resolve(import.meta.dirname, "windows-state"),
});
const success = Object.freeze({
  durationsNanoseconds: Object.freeze(["7", "11", "9"]),
  maximumWalkDurationNanoseconds: "11",
  ok: true as const,
});

afterEach(async () => {
  delete (globalThis as unknown as Record<string, unknown>)[fixtureGlobalKey];
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

async function testModule(): Promise<TestModule> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-native-walk-"));
  temporaryRoots.push(root);
  const output = resolve(root, "native-isolated-walk.mjs");
  await build({
    bundle: true,
    entryPoints: [sourcePath],
    footer: { js: "export { runCore };" },
    format: "esm",
    outfile: output,
    platform: "node",
    target: "node24",
  });
  return (await import(`${pathToFileURL(output).href}?test=1`)) as TestModule;
}

async function productionTestModule(platform: "linux" | "win32"): Promise<ProductionTestModule> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-native-walk-production-"));
  temporaryRoots.push(root);
  const output = resolve(root, `native-isolated-walk-${platform}.mjs`);
  await build({
    bundle: true,
    define: { "process.platform": JSON.stringify(platform) },
    entryPoints: [sourcePath],
    format: "esm",
    outfile: output,
    platform: "node",
    plugins: [
      {
        name: "fixed-native-walk-dependencies",
        setup(context) {
          context.onResolve(
            {
              filter: /^\.\/(?:linux-isolation-authority|windows-isolation-authority)\.js$/,
            },
            (args) => ({ namespace: "fixed-native-walk-dependencies", path: args.path }),
          );
          context.onLoad({ filter: /.*/, namespace: "fixed-native-walk-dependencies" }, (args) => {
            const member = args.path.includes("linux-isolation-authority")
              ? "linuxFactory"
              : "windowsFactory";
            const exportName =
              member === "linuxFactory"
                ? "createLinuxIsolationAuthority"
                : "createWindowsIsolationAuthority";
            return {
              contents: `export async function ${exportName}(...args) { return await globalThis[${JSON.stringify(
                fixtureGlobalKey,
              )}].${member}(...args); }`,
              loader: "js",
            };
          });
        },
      },
    ],
    target: "node24",
  });
  return (await import(
    `${pathToFileURL(output).href}?production=${platform}`
  )) as ProductionTestModule;
}

function authority(close: () => Promise<void> = async () => undefined): LinuxIsolationAuthority {
  return {
    close,
    createPrincipal: vi.fn(async () => Object.freeze({ principal: "opaque" })),
    launch: vi.fn(async () => Object.freeze({ observation: "opaque" })),
    prepare: vi.fn(async () => undefined),
    teardownPrincipal: vi.fn(async () => undefined),
  };
}

function dependencies(
  platform: NodeJS.Platform,
  overrides: Partial<Dependencies> = {},
): Dependencies {
  return {
    linuxFactory: vi.fn(async () => authority()),
    platform,
    run: vi.fn(async () => success),
    windowsFactory: vi.fn(async () => authority()),
    ...overrides,
  };
}

describe("native ISS-002 isolated-walk composition", () => {
  test("keeps the composer private and free of downstream authority vocabulary", async () => {
    expect(packageRoot).not.toHaveProperty("runNativeIss002IsolatedWalk");
    const source = await readFile(sourcePath, "utf8");
    for (const forbidden of [
      "repository_dispatch",
      "github",
      "workflow",
      "provider",
      "receipt",
      "promotion",
      '"PASS"',
    ])
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  test.each([
    ["linux", linuxConfiguration],
    ["win32", windowsConfiguration],
  ] as const)(
    "binds the production %s wrapper to its fixed factory and coordinator",
    async (platform, configuration) => {
      const module = await productionTestModule(platform);
      const events: string[] = [];
      let principalOrdinal = 0;
      const close = vi.fn(async () => {
        events.push("close");
      });
      const createPrincipal = vi.fn(async () => {
        const principal = Object.freeze({ ordinal: principalOrdinal++ });
        events.push(`create:${principal.ordinal}`);
        return principal;
      });
      const prepare = vi.fn(async (principal: unknown, _request: unknown) => {
        events.push(`prepare:${(principal as { readonly ordinal: number }).ordinal}`);
      });
      const launch = vi.fn(async (principal: unknown, _request: unknown) => {
        events.push(`launch:${(principal as { readonly ordinal: number }).ordinal}`);
        return Object.freeze({
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: '{"issues":[]}',
        });
      });
      const teardownPrincipal = vi.fn(async (principal: unknown) => {
        events.push(`teardown:${(principal as { readonly ordinal: number }).ordinal}`);
      });
      const fixedAuthority: LinuxIsolationAuthority = {
        close,
        createPrincipal,
        launch,
        prepare,
        teardownPrincipal,
      };
      const fixture = {
        linuxFactory: vi.fn<Dependencies["linuxFactory"]>(async () => fixedAuthority),
        windowsFactory: vi.fn<Dependencies["windowsFactory"]>(async () => fixedAuthority),
      };
      (globalThis as unknown as Record<string, unknown>)[fixtureGlobalKey] = fixture;

      const result = await module.runNativeIss002IsolatedWalk(input, configuration);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.durationsNanoseconds).toHaveLength(3);
      expect(result.durationsNanoseconds.every((value) => /^(?:0|[1-9][0-9]*)$/.test(value))).toBe(
        true,
      );
      expect(result.maximumWalkDurationNanoseconds).toBe(
        result.durationsNanoseconds.reduce((maximum, value) =>
          BigInt(value) > BigInt(maximum) ? value : maximum,
        ),
      );
      expect(createPrincipal).toHaveBeenCalledTimes(3);
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(launch).toHaveBeenCalledTimes(3);
      expect(teardownPrincipal).toHaveBeenCalledTimes(3);
      for (let index = 0; index < 3; index += 1) {
        const request = prepare.mock.calls[index]![1];
        expect(request).toMatchObject({
          candidateArtifactPath: input.candidateArtifactPath,
          rpcRunnerPath: input.rpcRunnerPath,
          timeoutMilliseconds: 5000,
        });
        expect(launch.mock.calls[index]![1]).toBe(request);
      }
      expect(events.filter((event) => event.startsWith("teardown:"))).toEqual([
        "teardown:0",
        "teardown:1",
        "teardown:2",
      ]);
      if (platform === "linux") {
        expect(fixture.linuxFactory).toHaveBeenCalledOnce();
        expect(fixture.windowsFactory).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(events.at(-1)).toBe("close");
      } else {
        expect(fixture.windowsFactory).toHaveBeenCalledOnce();
        expect(fixture.linuxFactory).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(events.at(-1)).toBe("teardown:2");
      }
    },
  );

  test.each([
    ["darwin", "native-isolated-walk:macos-authority-unavailable"],
    ["freebsd", "native-isolated-walk:unsupported-platform"],
  ] as const)("refuses %s before reading hostile caller objects", async (platform, issue) => {
    const module = await testModule();
    const hostile = new Proxy(Object.create(null) as object, {
      getOwnPropertyDescriptor: () => {
        throw new Error("caller object was read");
      },
      getPrototypeOf: () => {
        throw new Error("caller object was read");
      },
      ownKeys: () => {
        throw new Error("caller object was read");
      },
    });
    const deps = dependencies(platform);
    await expect(module.runCore(hostile, hostile, deps)).resolves.toEqual({
      issues: [issue],
      ok: false,
    });
    expect(deps.linuxFactory).not.toHaveBeenCalled();
    expect(deps.windowsFactory).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  test("reconstructs exact Linux custody options, detaches inputs, and closes after the run", async () => {
    const module = await testModule();
    let releaseFactory!: (value: LinuxIsolationAuthority) => void;
    const factoryGate = new Promise<LinuxIsolationAuthority>((resolveGate) => {
      releaseFactory = resolveGate;
    });
    const close = vi.fn(async () => undefined);
    const linuxAuthority = authority(close);
    const linuxFactory = vi.fn<Dependencies["linuxFactory"]>(async () => await factoryGate);
    const run = vi.fn(async () => {
      expect(close).not.toHaveBeenCalled();
      return success;
    });
    const mutableInput = { ...input };
    const mutableConfiguration = { ...linuxConfiguration };
    const pending = module.runCore(
      mutableInput,
      mutableConfiguration,
      dependencies("linux", { linuxFactory, run }),
    );
    mutableInput.candidateArtifactPath = resolve(import.meta.dirname, "mutated-candidate.mjs");
    mutableConfiguration.accountStateRoot = resolve(import.meta.dirname, "mutated-state");
    releaseFactory(linuxAuthority);
    await expect(pending).resolves.toEqual(success);
    expect(linuxFactory).toHaveBeenCalledOnce();
    expect(linuxFactory).toHaveBeenCalledWith({
      account: {
        accountHelperPath: linuxConfiguration.accountHelperPath,
        stateRoot: linuxConfiguration.accountStateRoot,
      },
      dac: {
        dacHelperPath: linuxConfiguration.dacHelperPath,
        stateRoot: linuxConfiguration.dacStateRoot,
      },
      execution: {
        accountStateRoot: linuxConfiguration.accountStateRoot,
        cleanupHelperPath: linuxConfiguration.cleanupHelperPath,
        executionParent: linuxConfiguration.executionParent,
        stateRoot: linuxConfiguration.executionStateRoot,
      },
      process: {
        pidfdHelperPath: linuxConfiguration.pidfdHelperPath,
        stateRoot: linuxConfiguration.accountStateRoot,
      },
      runtimePath: linuxConfiguration.runtimePath,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(input, linuxAuthority);
    expect(close).toHaveBeenCalledOnce();
    expect(Reflect.ownKeys(linuxFactory.mock.calls[0]![0])).toEqual([
      "account",
      "dac",
      "execution",
      "process",
      "runtimePath",
    ]);
  });

  test("closes Linux authority exactly once across coordinator outcomes", async () => {
    const module = await testModule();
    const cases: readonly {
      readonly closeThrows: boolean;
      readonly expected: Iss002IsolatedWalkRunResult;
      readonly run: () => Promise<Iss002IsolatedWalkRunResult>;
    }[] = [
      {
        closeThrows: false,
        expected: { issues: ["stable:refused"], ok: false },
        run: async () => ({ issues: ["stable:refused"], ok: false }),
      },
      {
        closeThrows: false,
        expected: { issues: ["native-isolated-walk:coordinator-refused"], ok: false },
        run: async () => {
          throw new Error("coordinator failed");
        },
      },
      {
        closeThrows: true,
        expected: {
          issues: ["stable:refused", "native-isolated-walk:linux-close-refused"],
          ok: false,
        },
        run: async () => ({ issues: ["stable:refused"], ok: false }),
      },
      {
        closeThrows: true,
        expected: {
          issues: [
            "native-isolated-walk:coordinator-refused",
            "native-isolated-walk:linux-close-refused",
          ],
          ok: false,
        },
        run: async () => {
          throw new Error("coordinator failed");
        },
      },
      {
        closeThrows: true,
        expected: { issues: ["native-isolated-walk:linux-close-refused"], ok: false },
        run: async () => success,
      },
    ];
    for (const fixture of cases) {
      const close = vi.fn(async () => {
        if (fixture.closeThrows) throw new Error("close failed");
      });
      const linuxAuthority = authority(close);
      const deps = dependencies("linux", {
        linuxFactory: vi.fn(async () => linuxAuthority),
        run: vi.fn(fixture.run),
      });
      await expect(module.runCore(input, linuxConfiguration, deps)).resolves.toEqual(
        fixture.expected,
      );
      expect(close).toHaveBeenCalledOnce();
    }
  });

  test("selects only the Windows factory and returns only detached coordinator results", async () => {
    const module = await testModule();
    const windowsAuthority = authority();
    const windowsFactory = vi.fn(async () => windowsAuthority);
    const run = vi.fn(async () => success);
    const deps = dependencies("win32", { run, windowsFactory });
    await expect(
      module.runCore(Object.seal({ ...input }), windowsConfiguration, deps),
    ).resolves.toEqual(success);
    expect(deps.linuxFactory).not.toHaveBeenCalled();
    expect(windowsFactory).toHaveBeenCalledOnce();
    expect(windowsFactory).toHaveBeenCalledWith(windowsConfiguration);
    expect(run).toHaveBeenCalledWith(input, windowsAuthority);
    expect(windowsAuthority.teardownPrincipal).not.toHaveBeenCalled();

    const hostileResult = {
      durationsNanoseconds: ["7", "11", "9"],
      maximumWalkDurationNanoseconds: "11",
      ok: true,
      promotion: "candidate-controls-stable",
    };
    const hostileDeps = dependencies("win32", {
      windowsFactory,
      run: vi.fn(async () => hostileResult as unknown as Iss002IsolatedWalkRunResult),
    });
    await expect(module.runCore(input, windowsConfiguration, hostileDeps)).resolves.toEqual({
      issues: ["native-isolated-walk:coordinator-refused"],
      ok: false,
    });
  });

  test("fails closed for factory and coordinator failures on Windows", async () => {
    const module = await testModule();
    await expect(
      module.runCore(
        input,
        windowsConfiguration,
        dependencies("win32", {
          windowsFactory: vi.fn(async () => {
            throw new Error("factory failed");
          }),
        }),
      ),
    ).resolves.toEqual({ issues: ["native-isolated-walk:windows-factory-refused"], ok: false });
    await expect(
      module.runCore(
        input,
        windowsConfiguration,
        dependencies("win32", {
          run: vi.fn(async () => {
            throw new Error("coordinator failed");
          }),
        }),
      ),
    ).resolves.toEqual({ issues: ["native-isolated-walk:coordinator-refused"], ok: false });
  });

  test("rejects malformed hostile inputs before selecting an authority", async () => {
    const module = await testModule();
    const accessor = Object.defineProperty({}, "candidateArtifactPath", {
      enumerable: true,
      get: () => input.candidateArtifactPath,
    });
    Object.defineProperty(accessor, "rpcRunnerPath", {
      enumerable: true,
      value: input.rpcRunnerPath,
    });
    const symbol = { ...input, [Symbol("extra")]: "x" };
    const customPrototype = Object.assign(Object.create({ inherited: true }) as object, input);
    const malformedInputs: readonly unknown[] = [
      null,
      { ...input, extra: true },
      { ...input, candidateArtifactPath: "relative.mjs" },
      accessor,
      symbol,
      customPrototype,
      new Proxy({ ...input }, {}),
    ];
    for (const malformed of malformedInputs) {
      const deps = dependencies("linux");
      await expect(module.runCore(malformed, linuxConfiguration, deps)).resolves.toEqual({
        issues: ["native-isolated-walk:input-refused"],
        ok: false,
      });
      expect(deps.linuxFactory).not.toHaveBeenCalled();
    }

    for (const malformed of [
      { ...linuxConfiguration, commandRunner: vi.fn() },
      { ...linuxConfiguration, accountStateRoot: "relative" },
      new Proxy({ ...linuxConfiguration }, {}),
    ]) {
      const deps = dependencies("linux");
      await expect(module.runCore(input, malformed, deps)).resolves.toEqual({
        issues: ["native-isolated-walk:configuration-refused"],
        ok: false,
      });
      expect(deps.linuxFactory).not.toHaveBeenCalled();
    }
  });

  test("rejects malformed coordinator result shapes and impossible duration maxima", async () => {
    const module = await testModule();
    const malformed: readonly unknown[] = [
      { durationsNanoseconds: ["7", "11"], maximumWalkDurationNanoseconds: "11", ok: true },
      { durationsNanoseconds: ["7", "11", "9"], maximumWalkDurationNanoseconds: "9", ok: true },
      { durationsNanoseconds: ["07", "11", "9"], maximumWalkDurationNanoseconds: "11", ok: true },
      { issues: [], ok: false },
      { issues: ["x"], ok: false, receipt: "forbidden" },
      { ok: "PASS" },
    ];
    for (const result of malformed) {
      const deps = dependencies("win32", {
        run: vi.fn(async () => result as Iss002IsolatedWalkRunResult),
      });
      await expect(module.runCore(input, windowsConfiguration, deps)).resolves.toEqual({
        issues: ["native-isolated-walk:coordinator-refused"],
        ok: false,
      });
    }
  });
});

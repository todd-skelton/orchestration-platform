import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { canonicalJson } from "../../packages/contracts/src/index.js";
import { createWindowsReparseFactAdapter } from "../../packages/config/src/windows-reparse-fact.js";
import {
  createConfigurationLoader,
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../packages/config/src/loader.js";

const roots: string[] = [];

async function observedFact(path: string) {
  const value = await lstat(path, { bigint: true });
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      identity: Object.freeze({
        fileId: value.ino.toString(16).padStart(32, "0").slice(-32),
        nodeDevice: Object.freeze({
          decimal: value.dev.toString(10),
          hexadecimal: value.dev.toString(16).padStart(8, "0").slice(-8),
        }),
        nodeInode: Object.freeze({
          decimal: value.ino.toString(10),
          hexadecimal: value.ino.toString(16).padStart(16, "0").slice(-16),
        }),
        volumeSerialNumber: value.dev.toString(16).padStart(16, "0").slice(-16),
      }),
      kind: value.isDirectory() ? ("DIRECTORY" as const) : ("FILE" as const),
      reparsePoint: value.isSymbolicLink(),
      reparseTag: value.isSymbolicLink() ? 1 : null,
    }),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function source(stateRoot: string | null = null) {
  return {
    adapterId: "fixture.adapter",
    capabilityNames: ["cap.read", "cap.write"],
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
    schemaVersion: "platform-configuration-source/v1",
    stateRoot,
    wallClockSkewMs: 1_000,
  } as const;
}

function environment() {
  return {
    HOME: null,
    LOCALAPPDATA: null,
    ORCHESTRATION_CONFIG: null,
    ORCHESTRATION_PROJECT_ROOT: null,
    ORCHESTRATION_STATE_ROOT: null,
    XDG_STATE_HOME: null,
  } as const;
}

function invocation(
  operatingSystem: "WINDOWS" | "LINUX",
  projectRoot: string,
  configPath: string,
  stateRoot: string,
): ConfigurationLoaderInvocation {
  return {
    cwd: projectRoot,
    environment: environment(),
    flags: { configPath, projectRoot, stateRoot },
    operatingSystem,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchestration-config-loader-"));
  roots.push(root);
  const projectRoot = resolve(root, "project");
  const configPath = resolve(projectRoot, ".orchestration", "project.json");
  const stateRoot = resolve(root, "state");
  await mkdir(dirname(configPath), { recursive: true });
  await mkdir(stateRoot);
  await writeFile(configPath, canonicalJson(source()), "utf8");
  return { configPath, projectRoot, root, stateRoot };
}

describe("ISS-003 concrete configuration loader", () => {
  test("refuses malformed closed input before calling the host adapter", async () => {
    let calls = 0;
    const loader = createConfigurationLoader({
      operatingSystem: "WINDOWS",
      async observeReparseFact(path: string) {
        calls += 1;
        return observedFact(path);
      },
    });
    const malformed = {
      cwd: "C:\\project",
      environment: environment(),
      flags: { configPath: null, projectRoot: null, stateRoot: null },
      operatingSystem: "WINDOWS",
      extra: true,
    };
    await expect(loader(malformed as never)).resolves.toEqual({
      error: {
        code: "ARGV_REFUSED",
        exitCode: 2,
        message: "command line refused",
        outcome: "invalid-input",
      },
      ok: false,
    });
    expect(calls).toBe(0);
  });

  test.skipIf(process.platform !== "win32")(
    "captures the exact adapter callback once at construction",
    async () => {
      const input = await fixture();
      const adapter = {
        operatingSystem: "WINDOWS" as const,
        async observeReparseFact(path: string) {
          return observedFact(path);
        },
      };
      const loader = createConfigurationLoader(adapter);
      adapter.observeReparseFact = async () => {
        throw new Error("replacement callback reached");
      };
      const result = await loader(
        invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    },
  );

  test.skipIf(process.platform !== "win32")(
    "bounds a never-settling adapter observation with the exact path row",
    async () => {
      const input = await fixture();
      const loader = createConfigurationLoader({
        operatingSystem: "WINDOWS",
        observeReparseFact: () => new Promise(() => undefined),
      });
      await expect(
        loader(invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot)),
      ).resolves.toEqual({
        error: {
          code: "PATH_REFUSED",
          exitCode: 3,
          message: "path refused",
          outcome: "authority-refused",
        },
        ok: false,
      });
    },
    10_000,
  );

  test.skipIf(process.platform !== "win32")(
    "refuses malformed and substituted Node handle coordinates",
    async () => {
      const input = await fixture();
      const makeLoader = (mutation: "MALFORMED" | "SUBSTITUTED") =>
        createConfigurationLoader({
          operatingSystem: "WINDOWS",
          async observeReparseFact(path: string) {
            const observed = await observedFact(path);
            if (path !== input.configPath) return observed;
            const inode = BigInt(observed.value.identity.nodeInode.decimal);
            const substituted = inode + 1n;
            return {
              ok: true as const,
              value: {
                ...observed.value,
                identity: {
                  ...observed.value.identity,
                  nodeInode:
                    mutation === "MALFORMED"
                      ? {
                          decimal: `0${inode.toString(10)}`,
                          hexadecimal: observed.value.identity.nodeInode.hexadecimal,
                        }
                      : {
                          decimal: substituted.toString(10),
                          hexadecimal: substituted.toString(16).padStart(16, "0"),
                        },
                },
              },
            };
          },
        });

      for (const mutation of ["MALFORMED", "SUBSTITUTED"] as const) {
        await expect(
          makeLoader(mutation)(
            invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot),
          ),
        ).resolves.toMatchObject({ error: { code: "PATH_REFUSED" }, ok: false });
      }
    },
  );

  test.skipIf(process.platform !== "win32")(
    "refuses a synchronized replace-and-restore fact on every matching observation",
    async () => {
      const input = await fixture();
      const held = resolve(input.root, "synchronized-held.json");
      const replacement = resolve(input.root, "synchronized-replacement.json");
      await writeFile(replacement, canonicalJson(source()), "utf8");
      let substitutions = 0;
      const loader = createConfigurationLoader({
        operatingSystem: "WINDOWS",
        async observeReparseFact(path: string) {
          if (path !== input.configPath) return observedFact(path);
          substitutions += 1;
          await rename(input.configPath, held);
          await rename(replacement, input.configPath);
          try {
            return await observedFact(input.configPath);
          } finally {
            await rename(input.configPath, replacement);
            await rename(held, input.configPath);
          }
        },
      });
      await expect(
        loader(invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot)),
      ).resolves.toMatchObject({ error: { code: "PATH_REFUSED" }, ok: false });
      expect(substitutions).toBe(1);
    },
  );

  test("refuses accessor, proxy, extra, and malformed construction adapters", async () => {
    const accessor = { operatingSystem: "WINDOWS" } as Record<string, unknown>;
    Object.defineProperty(accessor, "observeReparseFact", {
      enumerable: true,
      get: () => async () => ({ inode: "0", reparsePoint: false }),
    });
    const valid = {
      operatingSystem: "WINDOWS" as const,
      async observeReparseFact(path: string) {
        return observedFact(path);
      },
    };
    for (const mutant of [accessor, new Proxy(valid, {}), { ...valid, extra: true }]) {
      const loader = createConfigurationLoader(mutant as never);
      await expect(loader({} as never)).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          exitCode: 70,
          message: "internal error",
          outcome: "internal-error",
        },
        ok: false,
      });
    }
  });

  test.skipIf(process.platform === "win32")(
    "loads an explicitly selected canonical source through retained POSIX handles",
    async () => {
      const input = await fixture();
      const loader = createConfigurationLoader(createPortableConfigurationHostAdapter("LINUX"));
      const result = await loader(
        invocation("LINUX", input.projectRoot, input.configPath, input.stateRoot),
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          configPath: input.configPath,
          fieldSources: { stateRoot: "CLI" },
          projectRoot: input.projectRoot,
          stateRoot: input.stateRoot,
          stateRootDisposition: "DIRECTORY",
        },
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  test.skipIf(process.platform === "win32")(
    "binds CLI precedence and canonical source bytes before resolution",
    async () => {
      const input = await fixture();
      const loader = createConfigurationLoader(createPortableConfigurationHostAdapter("LINUX"));
      const result = await loader({
        cwd: input.projectRoot,
        environment: {
          ...environment(),
          ORCHESTRATION_CONFIG: "/lower/config.json",
          ORCHESTRATION_PROJECT_ROOT: "/lower/project",
          ORCHESTRATION_STATE_ROOT: "/lower/state",
        },
        flags: {
          configPath: input.configPath,
          projectRoot: input.projectRoot,
          stateRoot: input.stateRoot,
        },
        operatingSystem: "LINUX",
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          configPath: input.configPath,
          fieldSources: { stateRoot: "CLI" },
          projectRoot: input.projectRoot,
          stateRoot: input.stateRoot,
        },
      });
      await writeFile(input.configPath, `${canonicalJson(source())}\n`, "utf8");
      await expect(
        loader(invocation("LINUX", input.projectRoot, input.configPath, input.stateRoot)),
      ).resolves.toMatchObject({ error: { code: "CONFIG_REFUSED" }, ok: false });
    },
  );

  test.skipIf(process.platform === "win32")(
    "admits an absent state root but refuses aliases and either overlap direction",
    async () => {
      const input = await fixture();
      const loader = createConfigurationLoader(createPortableConfigurationHostAdapter("LINUX"));
      await rm(input.stateRoot, { recursive: true });
      await expect(
        loader(invocation("LINUX", input.projectRoot, input.configPath, input.stateRoot)),
      ).resolves.toMatchObject({
        ok: true,
        value: { stateRoot: input.stateRoot, stateRootDisposition: "ABSENT" },
      });

      for (const stateRoot of [input.projectRoot, dirname(input.projectRoot)]) {
        await expect(
          loader(invocation("LINUX", input.projectRoot, input.configPath, stateRoot)),
        ).resolves.toMatchObject({ error: { code: "PATH_REFUSED" }, ok: false });
      }

      const alias = resolve(input.root, "project-alias");
      await symlink(input.projectRoot, alias, "dir");
      await expect(
        loader(
          invocation(
            "LINUX",
            alias,
            resolve(alias, ".orchestration", "project.json"),
            input.stateRoot,
          ),
        ),
      ).resolves.toMatchObject({ error: { code: "PATH_REFUSED" }, ok: false });
    },
  );

  test.skipIf(process.platform !== "win32")(
    "loads an explicitly selected canonical source through the protected Windows adapter",
    async () => {
      const input = await fixture();
      const adapter = createWindowsConfigurationHostAdapter();
      const loader = createConfigurationLoader(adapter);
      const result = await loader(
        invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result).toMatchObject({
        ok: true,
        value: {
          configPath: input.configPath,
          fieldSources: { stateRoot: "CLI" },
          projectRoot: input.projectRoot,
          stateRoot: input.stateRoot,
          stateRootDisposition: "DIRECTORY",
        },
      });
      expect(JSON.stringify(result)).not.toContain(await readFile(input.configPath, "utf8"));
    },
    120_000,
  );

  test.skipIf(process.platform !== "win32")(
    "refuses target replacement and restoration observed by the reviewed native adapter",
    async () => {
      const input = await fixture();
      const held = resolve(input.root, "held.json");
      const replacement = resolve(input.root, "replacement.json");
      await writeFile(replacement, canonicalJson(source()), "utf8");
      const native = createWindowsReparseFactAdapter("WINDOWS");
      let replaced = false;
      const loader = createConfigurationLoader({
        operatingSystem: "WINDOWS",
        async observeReparseFact(path: string) {
          if (!replaced && path === input.configPath) {
            replaced = true;
            await rename(input.configPath, held);
            await rename(replacement, input.configPath);
            const fact = native.observe(path);
            await rename(input.configPath, replacement);
            await rename(held, input.configPath);
            return fact;
          }
          return native.observe(path);
        },
      });
      await expect(
        loader(invocation("WINDOWS", input.projectRoot, input.configPath, input.stateRoot)),
      ).resolves.toMatchObject({ error: { code: "PATH_REFUSED" }, ok: false });
      expect(await readFile(input.configPath, "utf8")).toBe(canonicalJson(source()));
    },
    120_000,
  );

  test.skipIf(process.platform !== "win32")(
    "refuses a real Windows junction component",
    async () => {
      const input = await fixture();
      const linked = resolve(input.root, "linked-project");
      await symlink(input.projectRoot, linked, "junction");
      const linkedConfig = resolve(linked, ".orchestration", "project.json");
      const loader = createConfigurationLoader(createWindowsConfigurationHostAdapter());
      await expect(
        loader(invocation("WINDOWS", linked, linkedConfig, input.stateRoot)),
      ).resolves.toEqual({
        error: {
          code: "PATH_REFUSED",
          exitCode: 3,
          message: "path refused",
          outcome: "authority-refused",
        },
        ok: false,
      });
    },
    120_000,
  );

  test.skipIf(process.platform === "win32")(
    "discovers exactly one ancestor project and keeps absent markers absent",
    async () => {
      const input = await fixture();
      const nested = resolve(input.projectRoot, "a", "b");
      await mkdir(nested, { recursive: true });
      const loader = createConfigurationLoader(createPortableConfigurationHostAdapter("LINUX"));
      const result = await loader({
        cwd: nested,
        environment: environment(),
        flags: { configPath: null, projectRoot: null, stateRoot: input.stateRoot },
        operatingSystem: "LINUX",
      });
      expect(result).toMatchObject({ ok: true, value: { projectRoot: input.projectRoot } });
    },
  );

  test.skipIf(process.platform === "win32")(
    "classifies zero and multiple discovered project files as project-root refusal",
    async () => {
      const input = await fixture();
      const nested = resolve(input.projectRoot, "nested");
      await mkdir(resolve(nested, ".orchestration"), { recursive: true });
      const loader = createConfigurationLoader(createPortableConfigurationHostAdapter("LINUX"));
      const base = {
        cwd: nested,
        environment: environment(),
        flags: { configPath: null, projectRoot: null, stateRoot: input.stateRoot },
        operatingSystem: "LINUX" as const,
      };
      await writeFile(
        resolve(nested, ".orchestration", "project.json"),
        canonicalJson(source()),
        "utf8",
      );
      await expect(loader(base)).resolves.toMatchObject({
        error: { code: "PROJECT_ROOT_REFUSED" },
        ok: false,
      });
      await rm(input.configPath);
      await rm(resolve(nested, ".orchestration", "project.json"));
      await expect(loader(base)).resolves.toMatchObject({
        error: { code: "PROJECT_ROOT_REFUSED" },
        ok: false,
      });
    },
  );
});

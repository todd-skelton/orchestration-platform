import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockedOwnership = vi.hoisted(() => ({ root: "", stableUid: 1001n }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const adjusted = <Value extends object>(value: Value, path: string): Value =>
    mockedOwnership.root && resolve(path).startsWith(resolve(mockedOwnership.root))
      ? (new Proxy(value, {
          get(target, property, receiver) {
            if (property === "uid") return mockedOwnership.stableUid;
            if (property === "gid") return mockedOwnership.stableUid;
            if (property === "mode") {
              const mode = Reflect.get(target, property, receiver) as bigint;
              const isDirectory = Reflect.get(target, "isDirectory", receiver) as () => boolean;
              return (mode & ~0o777n) | (isDirectory.call(target) ? 0o700n : 0o600n);
            }
            return Reflect.get(target, property, receiver);
          },
        }) as Value)
      : value;
  return {
    ...actual,
    async lstat(path: string, options?: unknown) {
      return adjusted(
        await (actual.lstat as (path: string, options?: unknown) => Promise<object>)(path, options),
        path,
      );
    },
    async open(path: string, ...arguments_: unknown[]) {
      const handle = await (actual.open as (...arguments_: unknown[]) => Promise<any>)(
        path,
        ...arguments_,
      );
      if (!mockedOwnership.root || !resolve(path).startsWith(resolve(mockedOwnership.root)))
        return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "stat")
            return async (...statArguments: unknown[]) =>
              adjusted(await target.stat(...statArguments), path);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  createMacosHelperCustody,
  createMacosHelperCustodyTestFixture,
  runMacosHelperCommandTestFixture,
  type MacosHelperCommandRequest,
  type MacosHelperFileProfile,
} from "../../packages/conformance/src/macos-helper-custody.js";

const roots: string[] = [];
const fixedSha = "11".repeat(32);

afterEach(async () => {
  mockedOwnership.root = "";
  mockedOwnership.stableUid = 1001n;
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true })));
});

function profile(
  inode: number,
  owner: "ROOT" | "STABLE",
  overrides: Partial<MacosHelperFileProfile> = {},
): MacosHelperFileProfile {
  return Object.freeze({
    ctimeNanoseconds: "1",
    device: "1",
    gid: owner === "ROOT" ? "0" : "1001",
    inode: String(inode),
    linkCount: "1",
    mode: String(owner === "ROOT" ? 0o100755 : 0o100700),
    sha256: fixedSha,
    size: "8",
    uid: owner === "ROOT" ? "0" : "1001",
    ...overrides,
  });
}

async function layout() {
  const base = await mkdtemp(resolve(tmpdir(), "macos-helper-custody-"));
  roots.push(base);
  mockedOwnership.root = base;
  const stateRoot = resolve(base, "state");
  const helperRoot = resolve(base, "helpers");
  const sourcePath = resolve(base, "source.c");
  const runtimePath = resolve(base, "node");
  const clangPath = resolve(base, "clang");
  await mkdir(stateRoot);
  await mkdir(helperRoot);
  await Promise.all([
    chmod(stateRoot, 0o700),
    chmod(helperRoot, 0o700),
    writeFile(sourcePath, "source"),
    writeFile(runtimePath, "runtime"),
    writeFile(clangPath, "clang"),
  ]);
  const commands: MacosHelperCommandRequest[] = [];
  const events: string[] = [];
  const rooted = new Set<string>();
  const retainedPaths = new WeakMap<object, string>();
  const profileMutator: {
    value?: (
      path: string,
      owner: "ROOT" | "STABLE",
      observed: MacosHelperFileProfile,
    ) => MacosHelperFileProfile;
  } = {};
  const inodeByPath = new Map<string, number>();
  let nextInode = 10;
  const profileReader = async (
    path: string,
    owner: "ROOT" | "STABLE",
  ): Promise<MacosHelperFileProfile> => {
    events.push(`profile:${path}:${owner}`);
    if (!inodeByPath.has(path)) inodeByPath.set(path, nextInode++);
    if (path.startsWith(helperRoot)) {
      const bytes = await readFile(path);
      const observed = profile(inodeByPath.get(path)!, rooted.has(path) ? "ROOT" : owner, {
        gid: rooted.has(path) ? "0" : "1001",
        mode: String(0o100500),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: String(bytes.byteLength),
        uid: rooted.has(path) ? "0" : "1001",
      });
      return profileMutator.value?.(path, owner, observed) ?? observed;
    }
    const observed = profile(inodeByPath.get(path)!, owner);
    return profileMutator.value?.(path, owner, observed) ?? observed;
  };
  const commandRunner: (request: MacosHelperCommandRequest) => Promise<unknown> = async (
    request,
  ) => {
    commands.push(Object.freeze({ ...request, arguments: [...request.arguments] }));
    events.push(`command:${request.file}`);
    if (request.file === runtimePath)
      return { exitCode: 0, signal: null, stderr: "", stdout: "v24.15.0\n" };
    if (request.file === "/usr/bin/xcrun")
      return { exitCode: 0, signal: null, stderr: "", stdout: "/fixture/clang\n" };
    if (request.file === clangPath) {
      await writeFile(request.arguments.at(-1)!, "compiled");
      return { exitCode: 0, signal: null, stderr: "", stdout: "" };
    }
    if (request.file === "/usr/bin/sudo") {
      rooted.add(request.arguments.at(-1)!);
      return { exitCode: 0, signal: null, stderr: "", stdout: "" };
    }
    throw new Error(`unexpected command: ${request.file}`);
  };
  const options = {
    authorityRoot: base,
    helperRoot,
    helperSourcePath: sourcePath,
    runtimePath,
    stateRoot,
  };
  const dependencies = {
    architecture: "arm64" as const,
    chmodRetained: async (handle: import("node:fs/promises").FileHandle, mode: number) => {
      events.push(`chmod-retained:${mode.toString(8)}`);
      await chmod(retainedPaths.get(handle)!, mode);
    },
    commandRunner,
    directorySecurityReader: async (path: string) => {
      events.push(`directory-security:${path}`);
      return { aclEntries: 0, flags: "0" };
    },
    fileSecurityReader: async (path: string) => {
      events.push(`file-security:${path}`);
      return { aclEntries: 0, flags: "0" };
    },
    hostPlatform: "darwin",
    nodeMajor: 24,
    profileReader,
    retainDirectory: async (path: string) =>
      ({
        async close() {},
        async stat(options?: unknown) {
          return await import("node:fs/promises").then(({ lstat }) =>
            lstat(path, options as never),
          );
        },
      }) as unknown as import("node:fs/promises").FileHandle,
    retainFile: async (path: string) => {
      const handle = {
        async close() {},
        async stat(options?: unknown) {
          return await import("node:fs/promises").then(({ lstat }) =>
            lstat(path, options as never),
          );
        },
        async sync() {
          events.push(`sync-retained:${path}`);
        },
      } as unknown as import("node:fs/promises").FileHandle;
      retainedPaths.set(handle, path);
      return handle;
    },
    resolveClangPath: async () => clangPath,
    stableGid: 1001,
    stableUid: 1001,
    syncDirectory: async (path: string) => {
      events.push(`sync:${path}`);
    },
    token: () => "0123456789abcdef",
    unlinkRetained: async (
      path: string,
      handle: import("node:fs/promises").FileHandle,
      retainedProfile: MacosHelperFileProfile,
    ) => {
      events.push(`unlink-retained:${path}`);
      if (retainedPaths.get(handle) !== path) throw new TypeError("fixture:retained-path-refused");
      const observed = await profileReader(path, retainedProfile.uid === "0" ? "ROOT" : "STABLE");
      if (observed.device !== retainedProfile.device || observed.inode !== retainedProfile.inode)
        throw new TypeError("macos-helper:unlink-entry-moved");
      await rm(path, { force: false });
    },
    verifyArchitecture: async (path: string, architecture: "arm64" | "x86_64") => {
      events.push(`architecture:${path}:${architecture}`);
    },
    verifyRetainedProfile: async (
      _handle: import("node:fs/promises").FileHandle,
      retainedProfile: MacosHelperFileProfile,
    ) => {
      events.push(`retained:${retainedProfile.device}:${retainedProfile.inode}`);
    },
  };
  return {
    base,
    clangPath,
    commands,
    dependencies,
    events,
    helperRoot,
    options,
    profileMutator,
    rooted,
    sourcePath,
    stateRoot,
  };
}

describe("macOS helper build custody", () => {
  test("keeps production authority seams fixed outside caller options", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../packages/conformance/src/macos-helper-custody.ts"),
      "utf8",
    );
    const options = source.slice(
      source.indexOf("export interface MacosHelperCustodyOptions"),
      source.indexOf("export interface MacosHelperCustody {"),
    );
    expect(options).not.toContain("commandRunner");
    expect(options).not.toContain("profileReader");
    expect(options).not.toContain("token");
    const production = source.slice(
      source.indexOf("export async function createMacosHelperCustody("),
    );
    expect(production).toContain("commandRunner: nativeCommandRunner");
    expect(production).toContain("profileReader: defaultProfileReader");
    expect(production).toContain("token: () => randomBytes(8)");
  });

  test.runIf(process.platform !== "darwin")(
    "production refuses off Darwin before observing hostile options",
    async () => {
      let traps = 0;
      const options = new Proxy(Object.create(null) as never, {
        get() {
          traps += 1;
          throw new Error("option trap");
        },
      });
      await expect(createMacosHelperCustody(options)).rejects.toThrow("unsupported-platform");
      expect(traps).toBe(0);
    },
  );

  test("builds with exact architecture argv, roots the output, and removes it on close", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    expect(custody.helperPath).toBe(
      resolve(value.helperRoot, "macos-principal-helper-0123456789abcdef"),
    );
    expect(value.commands.map(({ file }) => file)).toEqual([
      value.options.runtimePath,
      "/usr/bin/xcrun",
      value.clangPath,
      "/usr/bin/sudo",
    ]);
    expect(value.commands[0]).toMatchObject({
      arguments: ["--version"],
      file: value.options.runtimePath,
      inputText: "",
    });
    expect(value.commands[1]).toMatchObject({
      arguments: ["--find", "clang"],
      cwd: value.helperRoot,
      file: "/usr/bin/xcrun",
      inputText: "",
    });
    expect(value.commands[2]!.arguments).toEqual([
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-arch",
      "arm64",
      value.sourcePath,
      "-o",
      custody.helperPath,
    ]);
    expect(value.commands[3]!.arguments).toEqual([
      "-n",
      "--",
      "/usr/sbin/chown",
      "0:0",
      custody.helperPath,
    ]);
    await expect(readFile(custody.helperPath, "utf8")).resolves.toBe("compiled");
    await custody.requireCustody();
    await custody.close();
    await expect(readFile(custody.helperPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(custody.requireCustody()).rejects.toThrow("closed");
  });

  test("syncs a cleanup intent before compiler and ownership authority", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    const stateSync = `sync:${value.stateRoot}`;
    const helperSync = `sync:${value.helperRoot}`;
    const compiler = `command:${value.clangPath}`;
    const chown = "command:/usr/bin/sudo";
    expect(value.events.indexOf(stateSync)).toBeLessThan(value.events.indexOf(compiler));
    expect(value.events.indexOf(helperSync)).toBeLessThan(value.events.indexOf(chown));
    const intent = await readFile(
      resolve(value.stateRoot, "macos-helper-intent-macos-principal-helper-0123456789abcdef.json"),
      "utf8",
    );
    const lines = intent.trimEnd().split("\n");
    expect(lines[0]).toBe(
      JSON.stringify({
        helperName: "macos-principal-helper-0123456789abcdef",
        helperPath: custody.helperPath,
      }),
    );
    expect(lines.slice(1).map((line) => line.split(":", 1)[0])).toEqual([
      "BUILD",
      "OUTPUT",
      "MODE",
      "MODE_PROFILE",
      "OWNER",
      "ROOT_PROFILE",
    ]);
    await custody.close();
    expect(value.events.filter((event) => event === stateSync).length).toBeGreaterThanOrEqual(2);
  });

  test("refuses a selected runtime that does not prove exact Node 24", async () => {
    const value = await layout();
    const original = value.dependencies.commandRunner;
    value.dependencies.commandRunner = async (request) =>
      request.file === value.options.runtimePath
        ? { exitCode: 0, signal: null, stderr: "", stdout: "v23.11.0\n" }
        : await original(request);
    await expect(
      createMacosHelperCustodyTestFixture(value.options, value.dependencies),
    ).rejects.toThrow("runtime-node-24-refused");
    expect(value.commands.map(({ file }) => file)).toEqual([]);
    await expect(readFile(value.options.runtimePath, "utf8")).resolves.toBe("runtime");
  });

  test("refuses hard-linked source, runtime, or generated output before custody", async () => {
    for (const selected of ["SOURCE", "RUNTIME", "OUTPUT"] as const) {
      const value = await layout();
      value.profileMutator.value = (path, _owner, observed) =>
        (selected === "SOURCE" && path === value.options.helperSourcePath) ||
        (selected === "RUNTIME" && path === value.options.runtimePath) ||
        (selected === "OUTPUT" && path.startsWith(`${value.helperRoot}${sep}`))
          ? { ...observed, linkCount: "2" }
          : observed;
      await expect(
        createMacosHelperCustodyTestFixture(value.options, value.dependencies),
      ).rejects.toThrow();
    }
  });

  test("refuses helper link-count drift during mode and owner transitions", async () => {
    const duringMode = await layout();
    let modeReads = 0;
    duringMode.profileMutator.value = (path, _owner, observed) => {
      if (path.startsWith(`${duringMode.helperRoot}${sep}`)) {
        modeReads += 1;
        if (modeReads >= 2) return { ...observed, linkCount: "2" };
      }
      return observed;
    };
    await expect(
      createMacosHelperCustodyTestFixture(duringMode.options, duringMode.dependencies),
    ).rejects.toThrow();

    const duringOwner = await layout();
    duringOwner.profileMutator.value = (path, _owner, observed) =>
      path.startsWith(`${duringOwner.helperRoot}${sep}`) && observed.uid === "0"
        ? { ...observed, linkCount: "2" }
        : observed;
    await expect(
      createMacosHelperCustodyTestFixture(duringOwner.options, duringOwner.dependencies),
    ).rejects.toThrow();
  });

  test("recovers a prior durable output before selecting a new helper", async () => {
    const value = await layout();
    const oldName = "macos-principal-helper-fedcba9876543210";
    const oldPath = resolve(value.helperRoot, oldName);
    await writeFile(oldPath, "old");
    await writeFile(
      resolve(value.stateRoot, `macos-helper-intent-${oldName}.json`),
      `${JSON.stringify({ helperName: oldName, helperPath: oldPath })}\nBUILD\n`,
      { mode: 0o600 },
    );
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    await expect(readFile(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(value.events.indexOf(`sync:${value.helperRoot}`)).toBeLessThan(
      value.events.indexOf(`command:${value.clangPath}`),
    );
    await custody.close();
  });

  test("refuses a preexisting unjournaled helper-root entry", async () => {
    const value = await layout();
    await writeFile(resolve(value.helperRoot, "foreign"), "foreign");
    await expect(
      createMacosHelperCustodyTestFixture(value.options, value.dependencies),
    ).rejects.toThrow("helper-root-census-refused");
    expect(value.commands.map(({ file }) => file)).toEqual([
      value.options.runtimePath,
      "/usr/bin/xcrun",
    ]);
  });

  test("refuses and retains authority when the compiler leaves an unjournaled output", async () => {
    const value = await layout();
    const original = value.dependencies.commandRunner;
    const foreign = resolve(value.helperRoot, "foreign");
    value.dependencies.commandRunner = async (request) => {
      const result = await original(request);
      if (request.file === value.clangPath) await writeFile(foreign, "foreign");
      return result;
    };
    await expect(
      createMacosHelperCustodyTestFixture(value.options, value.dependencies),
    ).rejects.toThrow("build-reversal-refused");
    await expect(readFile(foreign, "utf8")).resolves.toBe("foreign");
  });

  test("retries unlink-plus-directory-sync ambiguity without losing the durable profile", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    const originalSync = value.dependencies.syncDirectory;
    let failHelperSync = true;
    value.dependencies.syncDirectory = async (path) => {
      if (path === value.helperRoot && failHelperSync) {
        failHelperSync = false;
        throw new Error("injected helper sync refusal");
      }
      await originalSync(path);
    };
    await expect(custody.close()).rejects.toThrow("injected helper sync refusal");
    await expect(custody.requireCustody()).rejects.toThrow("closing");
    await expect(custody.close()).resolves.toBeUndefined();
  });

  test("refuses output substitution after an ambiguous unlink instead of deleting it", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    const originalSync = value.dependencies.syncDirectory;
    let failHelperSync = true;
    value.dependencies.syncDirectory = async (path) => {
      if (path === value.helperRoot && failHelperSync) {
        failHelperSync = false;
        throw new Error("injected helper sync refusal");
      }
      await originalSync(path);
    };
    await expect(custody.close()).rejects.toThrow("injected helper sync refusal");
    await writeFile(custody.helperPath, "substituted");
    value.rooted.add(custody.helperPath);
    await expect(custody.close()).rejects.toThrow("recovery-output-refused");
    await expect(readFile(custody.helperPath, "utf8")).resolves.toBe("substituted");
  });

  test("rejects device/inode aliases, wrong root GID, and noncanonical durable JSON", async () => {
    const alias = await layout();
    alias.dependencies.profileReader = async (_path, owner) => profile(1, owner);
    await expect(
      createMacosHelperCustodyTestFixture(alias.options, alias.dependencies),
    ).rejects.toThrow("file-alias-refused");

    const gid = await layout();
    gid.dependencies.stableGid = 1002;
    await expect(
      createMacosHelperCustodyTestFixture(gid.options, gid.dependencies),
    ).rejects.toThrow("private-root-refused");

    const intent = await layout();
    const oldName = "macos-principal-helper-fedcba9876543210";
    const oldPath = resolve(intent.helperRoot, oldName);
    await writeFile(oldPath, "old");
    await writeFile(
      resolve(intent.stateRoot, `macos-helper-intent-${oldName}.json`),
      `{"helperName":"${oldName}","helperName":"${oldName}","helperPath":${JSON.stringify(oldPath)}}\nBUILD\n`,
      { mode: 0o600 },
    );
    await expect(
      createMacosHelperCustodyTestFixture(intent.options, intent.dependencies),
    ).rejects.toThrow("intent-refused");
  });

  test("refuses ancestor ACL/flags and stable-file ACL/flags on every custody check", async () => {
    const directory = await layout();
    directory.dependencies.directorySecurityReader = async () => ({
      aclEntries: 1,
      flags: "0",
    });
    await expect(
      createMacosHelperCustodyTestFixture(directory.options, directory.dependencies),
    ).rejects.toThrow("directory-security-refused");

    const file = await layout();
    file.dependencies.fileSecurityReader = async () => ({ aclEntries: 0, flags: "1" });
    await expect(
      createMacosHelperCustodyTestFixture(file.options, file.dependencies),
    ).rejects.toThrow("file-security-refused");

    const moved = await layout();
    const custody = await createMacosHelperCustodyTestFixture(moved.options, moved.dependencies);
    moved.dependencies.directorySecurityReader = async () => ({ aclEntries: 1, flags: "0" });
    await expect(custody.requireCustody()).rejects.toThrow("directory-security-refused");
  });

  test("latches overflow, post-spawn error, and timeout until child close and group absence", async () => {
    class FakeChild extends EventEmitter {
      readonly pid = 123;
      readonly stderr = new PassThrough();
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
    }
    const request = { arguments: [], cwd: "/", file: "/tool", inputText: "" };
    const dependenciesFor = (child: FakeChild, timeoutMilliseconds = 10_000) => ({
      delay: async () => {},
      groupSignal: (_processGroup: number, signal: NodeJS.Signals | 0) => {
        if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      },
      spawnChild: (() => child) as unknown as typeof import("node:child_process").spawn,
      timeoutMilliseconds,
    });

    const overflowChild = new FakeChild();
    const overflow = runMacosHelperCommandTestFixture(request, dependenciesFor(overflowChild));
    overflowChild.stdout.write(Buffer.alloc(1024 * 1024 + 1));
    overflowChild.emit("close", 0, null);
    await expect(overflow).resolves.toMatchObject({ signal: "OUTPUT_LIMIT", stdout: "" });

    const errorChild = new FakeChild();
    const errored = runMacosHelperCommandTestFixture(request, dependenciesFor(errorChild));
    let settled = false;
    void errored.finally(() => {
      settled = true;
    });
    errorChild.emit("error", new Error("post-spawn"));
    await Promise.resolve();
    expect(settled).toBe(false);
    errorChild.emit("close", null, null);
    await expect(errored).resolves.toMatchObject({ signal: "SPAWN_ERROR" });

    vi.useFakeTimers();
    try {
      const timeoutChild = new FakeChild();
      const timedOut = runMacosHelperCommandTestFixture(request, dependenciesFor(timeoutChild, 5));
      await vi.advanceTimersByTimeAsync(5);
      let timeoutSettled = false;
      void timedOut.finally(() => {
        timeoutSettled = true;
      });
      await Promise.resolve();
      expect(timeoutSettled).toBe(false);
      timeoutChild.emit("close", null, "SIGKILL");
      await expect(timedOut).resolves.toMatchObject({ signal: "TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("repeats group kill and retains the journal when quiescent absence is not proved", async () => {
    class FakeChild extends EventEmitter {
      readonly pid = 456;
      readonly stderr = new PassThrough();
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
    }
    const child = new FakeChild();
    const signals: Array<NodeJS.Signals | 0> = [];
    const result = runMacosHelperCommandTestFixture(
      { arguments: [], cwd: "/", file: "/tool", inputText: "" },
      {
        delay: async () => {},
        groupSignal: (_processGroup, signal) => {
          signals.push(signal);
        },
        spawnChild: (() => child) as unknown as typeof import("node:child_process").spawn,
        timeoutMilliseconds: 10_000,
      },
    );
    child.emit("close", null, "SIGKILL");
    await expect(result).resolves.toMatchObject({ signal: "TERMINATION_FAILED" });
    expect(signals.filter((signal) => signal === 0)).toHaveLength(100);
    expect(signals.filter((signal) => signal === "SIGKILL")).toHaveLength(100);

    const value = await layout();
    const original = value.dependencies.commandRunner;
    value.dependencies.commandRunner = async (request) => {
      const observed = await original(request);
      return request.file === value.clangPath
        ? { exitCode: null, signal: "TERMINATION_FAILED", stderr: "", stdout: "" }
        : observed;
    };
    await expect(
      createMacosHelperCustodyTestFixture(value.options, value.dependencies),
    ).rejects.toThrow("command-nonterminal");
    await expect(
      readFile(resolve(value.helperRoot, "macos-principal-helper-0123456789abcdef"), "utf8"),
    ).resolves.toBe("compiled");
    await expect(
      readFile(
        resolve(
          value.stateRoot,
          "macos-helper-intent-macos-principal-helper-0123456789abcdef.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("\nBUILD\n");
  });

  test("retains authority on component movement during security or compiler execution", async () => {
    const duringSecurity = await layout();
    let changed = false;
    duringSecurity.dependencies.directorySecurityReader = async () => {
      if (!changed) {
        changed = true;
        mockedOwnership.stableUid = 1002n;
      }
      return { aclEntries: 0, flags: "0" };
    };
    await expect(
      createMacosHelperCustodyTestFixture(duringSecurity.options, duringSecurity.dependencies),
    ).rejects.toThrow();
    expect(duringSecurity.commands).toEqual([]);
    mockedOwnership.stableUid = 1001n;

    const duringCompiler = await layout();
    const original = duringCompiler.dependencies.commandRunner;
    duringCompiler.dependencies.commandRunner = async (request) => {
      const result = await original(request);
      if (request.file === duringCompiler.clangPath) mockedOwnership.stableUid = 1002n;
      return result;
    };
    await expect(
      createMacosHelperCustodyTestFixture(duringCompiler.options, duringCompiler.dependencies),
    ).rejects.toThrow("private-root-moved");
    mockedOwnership.stableUid = 1001n;
    await expect(
      readFile(resolve(duringCompiler.helperRoot, "macos-principal-helper-0123456789abcdef")),
    ).resolves.toBeDefined();
  });

  test("refuses substituted output before removal and leaves file plus intent intact", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    let helperReads = 0;
    value.profileMutator.value = (path, _owner, observed) => {
      if (path === custody.helperPath) {
        helperReads += 1;
        if (helperReads >= 2) return { ...observed, inode: "999" };
      }
      return observed;
    };
    await expect(custody.close()).rejects.toThrow("recovery-output-refused");
    await expect(readFile(custody.helperPath, "utf8")).resolves.toBe("compiled");
    await expect(
      readFile(
        resolve(
          value.stateRoot,
          "macos-helper-intent-macos-principal-helper-0123456789abcdef.json",
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("rebinds the pathname to the retained inode at the exact unlink boundary", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    const originalUnlink = value.dependencies.unlinkRetained;
    value.dependencies.unlinkRetained = async (path, handle, retainedProfile) => {
      await rename(path, `${path}.retained-original`);
      await writeFile(path, "replacement");
      value.profileMutator.value = (observedPath, _owner, observed) =>
        observedPath === path ? { ...observed, inode: "999" } : observed;
      await originalUnlink(path, handle, retainedProfile);
    };
    await expect(custody.close()).rejects.toThrow("unlink-entry-moved");
    await expect(readFile(custody.helperPath, "utf8")).resolves.toBe("replacement");
    await expect(readFile(`${custody.helperPath}.retained-original`, "utf8")).resolves.toBe(
      "compiled",
    );
    await expect(
      readFile(
        resolve(
          value.stateRoot,
          "macos-helper-intent-macos-principal-helper-0123456789abcdef.json",
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("never launders an escaped retained inode through an absent-path retry", async () => {
    const value = await layout();
    const custody = await createMacosHelperCustodyTestFixture(value.options, value.dependencies);
    const escaped = resolve(value.base, "escaped-helper");
    value.dependencies.unlinkRetained = async (path) => {
      await rename(path, escaped);
      await writeFile(path, "replacement");
      await rm(path, { force: false });
      throw new TypeError("macos-helper:post-unlink-refused");
    };
    await expect(custody.close()).rejects.toThrow("post-unlink-refused");
    await expect(custody.close()).rejects.toThrow("output-absence-unproved");
    await expect(readFile(escaped, "utf8")).resolves.toBe("compiled");
    await expect(
      readFile(
        resolve(
          value.stateRoot,
          "macos-helper-intent-macos-principal-helper-0123456789abcdef.json",
        ),
        "utf8",
      ),
    ).resolves.not.toContain("UNLINK_PROVED");
  });

  test("reverses compiler and chown ambiguity while retaining refusal", async () => {
    for (const failedFile of ["CLANG", "/usr/bin/sudo"] as const) {
      const value = await layout();
      const original = value.dependencies.commandRunner;
      value.dependencies.commandRunner = async (request) => {
        const result = await original(request);
        if (
          (failedFile === "CLANG" && request.file === value.clangPath) ||
          request.file === failedFile
        )
          return { exitCode: 1, signal: null, stderr: "refused", stdout: "" };
        return result;
      };
      await expect(
        createMacosHelperCustodyTestFixture(value.options, value.dependencies),
      ).rejects.toThrow("command-refused");
      await expect(
        readFile(resolve(value.helperRoot, "macos-principal-helper-0123456789abcdef")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("refuses malformed resolver, architecture, profile, token, and hostile result", async () => {
    const cases: Array<(value: Awaited<ReturnType<typeof layout>>) => void> = [
      (value) => {
        value.dependencies.token = () => "ABC";
      },
      (value) => {
        value.dependencies.verifyArchitecture = async () => {
          throw new TypeError("architecture-refused");
        };
      },
      (value) => {
        value.dependencies.chmodRetained = async () => {
          throw new TypeError("mode-refused");
        };
      },
      (value) => {
        value.dependencies.commandRunner = async (request) =>
          request.file === "/usr/bin/xcrun"
            ? { exitCode: 0, signal: null, stderr: "", stdout: "clang\n" }
            : { exitCode: 0, signal: null, stderr: "", stdout: "" };
      },
      (value) => {
        value.dependencies.profileReader = async () => ({ ...profile(1, "ROOT"), inode: "01" });
      },
      (value) => {
        value.dependencies.commandRunner = async () =>
          new Proxy(Object.create(null), {
            ownKeys() {
              throw new Error("result trap");
            },
          });
      },
    ];
    for (const mutate of cases) {
      const value = await layout();
      mutate(value);
      await expect(
        createMacosHelperCustodyTestFixture(value.options, value.dependencies),
      ).rejects.toThrow();
    }
  });

  test("retains the helper custody module outside the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(publicSurface).not.toHaveProperty("createMacosHelperCustody");
  });
});

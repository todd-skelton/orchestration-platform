import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

interface MockIdentity {
  absent?: boolean;
  gid?: bigint;
  ino?: bigint;
  mode?: bigint;
  uid?: bigint;
}

const mockedDac = vi.hoisted(() => ({
  events: [] as string[],
  identities: new Map<string, MockIdentity>(),
  stateRoots: new Set<string>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const adjusted = <Value extends object>(value: Value, path: string): Value => {
    const profile = mockedDac.identities.get(resolve(path));
    if (!profile) return value;
    return new Proxy(value, {
      get(target, property, receiver) {
        if (property === "uid" && profile.uid !== undefined) return profile.uid;
        if (property === "gid" && profile.gid !== undefined) return profile.gid;
        if (property === "ino" && profile.ino !== undefined) return profile.ino;
        if (property === "mode" && profile.mode !== undefined)
          return ((Reflect.get(target, property, receiver) as bigint) & ~0o7777n) | profile.mode;
        return Reflect.get(target, property, receiver);
      },
    });
  };
  return {
    ...actual,
    async lstat(path: string, options?: unknown) {
      const profile = mockedDac.identities.get(resolve(path));
      if (profile?.absent) {
        const error = new Error("absent") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
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
      return new Proxy(handle, {
        get(target, property) {
          if (property === "stat")
            return async (...statArguments: unknown[]) =>
              adjusted(await target.stat(...statArguments), path);
          if (property === "sync")
            return async () => {
              mockedDac.events.push(`file-sync:${String(path).split(/[\\/]/).at(-1)}`);
              await target.sync();
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async readdir(path: string, options?: unknown) {
      const entries = await (
        actual.readdir as (path: string, options?: unknown) => Promise<unknown[]>
      )(path, options);
      const scratch = mockedDac.identities.get(resolve(path, "scratch"));
      if (!scratch?.absent) return entries;
      return entries.filter((entry) =>
        typeof entry === "string"
          ? entry !== "scratch"
          : (entry as { name: string }).name !== "scratch",
      );
    },
  };
});

import {
  createLinuxDacCustody,
  createLinuxDacCustodyTestFixture,
  runLinuxAuthorityCommand,
  type LinuxDacCommandRequest,
  type LinuxDacHelperProfile,
  type LinuxDacPrincipal,
} from "../../packages/conformance/src/linux-dac-custody.js";

const roots: string[] = [];
const principal: LinuxDacPrincipal = Object.freeze({
  gid: "1100000001",
  name: "orch6-0000000000000001",
  uid: "1000001",
});
const helperProfile: LinuxDacHelperProfile = Object.freeze({
  ctimeNanoseconds: "1",
  device: "2",
  gid: "0",
  inode: "3",
  mode: String(0o100755),
  size: "4",
  uid: "0",
});

interface HelperRequest {
  ancestors: Identity[];
  candidate: Identity;
  gid: string;
  operation: "PREPARE" | "RESTORE";
  parent: Identity;
  root: Identity;
  rpcRunner: Identity;
  runtime: Identity;
  scratch: Identity;
  stableGid: string;
  stableUid: string;
  uid: string;
}

interface Identity {
  device: string;
  gid: string;
  inode: string;
  mode: string;
  path: string;
  type: "DIRECTORY" | "FILE";
  uid: string;
}

afterEach(async () => {
  mockedDac.events.splice(0);
  mockedDac.identities.clear();
  mockedDac.stateRoots.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

function installIdentity(path: string, mode: number): void {
  mockedDac.identities.set(resolve(path), { gid: 1001n, mode: BigInt(mode), uid: 1001n });
}

async function createRoots() {
  const stateRoot = await mkdtemp(resolve(tmpdir(), "orchestration-linux-dac-state-"));
  const parent = await mkdtemp(resolve(tmpdir(), "orchestration-linux-dac-parent-"));
  const rootPath = resolve(parent, "execution");
  roots.push(stateRoot, parent);
  await chmod(stateRoot, 0o700);
  await chmod(parent, 0o700);
  await mkdir(rootPath, { mode: 0o700 });
  await writeFile(resolve(rootPath, "candidate.mjs"), "export {};", { mode: 0o600 });
  await writeFile(resolve(rootPath, "rpc-runner.mjs"), "export {};", { mode: 0o600 });
  await writeFile(resolve(rootPath, "node"), "runtime", { mode: 0o600 });
  await mkdir(resolve(rootPath, "scratch"), { mode: 0o700 });
  installIdentity(stateRoot, 0o700);
  mockedDac.stateRoots.add(resolve(stateRoot));
  installIdentity(parent, 0o700);
  installIdentity(rootPath, 0o700);
  installIdentity(resolve(rootPath, "candidate.mjs"), 0o600);
  installIdentity(resolve(rootPath, "rpc-runner.mjs"), 0o600);
  installIdentity(resolve(rootPath, "node"), 0o600);
  installIdentity(resolve(rootPath, "scratch"), 0o700);
  return { parent, rootPath, stateRoot };
}

function mutate(request: HelperRequest): void {
  const values =
    request.operation === "PREPARE"
      ? {
          candidate: { gid: BigInt(request.gid), mode: 0o550n, uid: 0n },
          parent: {
            gid: BigInt(request.gid),
            mode: 0o710n,
            uid: BigInt(request.stableUid),
          },
          root: { gid: BigInt(request.gid), mode: 0o510n, uid: 0n },
          rpcRunner: { gid: BigInt(request.gid), mode: 0o550n, uid: 0n },
          runtime: { gid: BigInt(request.gid), mode: 0o550n, uid: 0n },
          scratch: { gid: BigInt(request.gid), mode: 0o700n, uid: BigInt(request.uid) },
        }
      : {
          candidate: {
            gid: BigInt(request.stableGid),
            mode: 0o600n,
            uid: BigInt(request.stableUid),
          },
          parent: {
            gid: BigInt(request.stableGid),
            mode: 0o700n,
            uid: BigInt(request.stableUid),
          },
          root: { gid: BigInt(request.stableGid), mode: 0o700n, uid: BigInt(request.stableUid) },
          rpcRunner: {
            gid: BigInt(request.stableGid),
            mode: 0o600n,
            uid: BigInt(request.stableUid),
          },
          runtime: {
            gid: BigInt(request.stableGid),
            mode: 0o600n,
            uid: BigInt(request.stableUid),
          },
          scratch: { gid: BigInt(request.stableGid), mode: 0o700n, uid: BigInt(request.stableUid) },
        };
  for (const field of ["candidate", "parent", "root", "rpcRunner", "runtime", "scratch"] as const) {
    const profile = mockedDac.identities.get(resolve(request[field].path));
    if (!profile) throw new Error(`missing ${field}`);
    Object.assign(profile, values[field]);
  }
  mockedDac.identities.get(resolve(request.scratch.path))!.absent = request.operation === "RESTORE";
}

function success() {
  return { exitCode: 0, signal: null, stderr: "", stdout: '{"ok":true}' };
}

async function custodyAt(
  stateRoot: string,
  run: (request: LinuxDacCommandRequest) => Promise<unknown>,
  profileReader: () => Promise<LinuxDacHelperProfile> = async () => helperProfile,
  syncStateDirectory: () => Promise<void> = async () => {
    mockedDac.events.push("directory-sync");
  },
) {
  return await createLinuxDacCustodyTestFixture(
    {
      commandRunner: run,
      dacHelperPath: resolve(
        import.meta.dirname,
        "../../packages/conformance/src/linux-principal-dac.py",
      ),
      profileReader,
      stateRoot,
    },
    {
      stableGid: 1001,
      stableUid: 1001,
      syncStateDirectory,
    },
  );
}

describe("Linux stable POSIX DAC cleanup-intent custody", () => {
  test.runIf(process.platform !== "linux")(
    "hard-refuses off Linux before any injectable authority seam",
    async () => {
      const commandRunner = vi.fn();
      const profileReader = vi.fn();
      await expect(
        createLinuxDacCustody({
          commandRunner,
          dacHelperPath: "C:/forged-helper.py",
          profileReader,
          stateRoot: "C:/forged-state",
        }),
      ).rejects.toThrow("unsupported-platform");
      expect(commandRunner).not.toHaveBeenCalled();
      expect(profileReader).not.toHaveBeenCalled();
    },
  );

  test("fsyncs RESTORE intent before PREPARE and retains it until exact restoration", async () => {
    const created = await createRoots();
    const calls: HelperRequest[] = [];
    const custody = await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      calls.push(request);
      mockedDac.events.push(`command:${request.operation}`);
      expect(command.file).toBe("/usr/bin/sudo");
      expect(command.arguments.slice(0, 4)).toEqual([
        "-n",
        process.platform === "linux" ? await realpath("/usr/bin/python3") : "/usr/bin/python3",
        "-I",
        "-B",
      ]);
      if (request.operation === "PREPARE") {
        const entries = await readdir(created.stateRoot);
        expect(entries).toEqual([`linux-dac-intent-${principal.name}.json`]);
        const persisted = JSON.parse(
          await readFile(resolve(created.stateRoot, entries[0]!), "utf8"),
        ) as { request: HelperRequest };
        expect(persisted.request.operation).toBe("RESTORE");
      }
      mutate(request);
      return success();
    });
    const lease = await custody.prepareAccess({ principal, rootPath: created.rootPath });
    expect(calls[0]).toMatchObject({
      gid: principal.gid,
      operation: "PREPARE",
      stableGid: "1001",
      stableUid: "1001",
      uid: principal.uid,
    });
    expect(calls[0]!.root).toMatchObject({ gid: "1001", mode: String(0o700), uid: "1001" });
    expect(mockedDac.identities.get(resolve(created.parent))).toMatchObject({
      gid: BigInt(principal.gid),
      mode: 0o710n,
      uid: 1001n,
    });
    expect(mockedDac.events.indexOf("directory-sync")).toBeLessThan(
      mockedDac.events.indexOf("command:PREPARE"),
    );
    await custody.restoreAccess(lease);
    expect(mockedDac.identities.get(resolve(created.parent))).toMatchObject({
      gid: 1001n,
      mode: 0o700n,
      uid: 1001n,
    });
    expect(calls.map((value) => value.operation)).toEqual(["PREPARE", "RESTORE"]);
    expect(await readdir(created.stateRoot)).toEqual([]);
  });

  test("refuses a sibling in the dedicated parent before writing intent or granting search", async () => {
    const created = await createRoots();
    const sibling = resolve(created.parent, "sibling");
    await mkdir(sibling, { mode: 0o700 });
    const runner = vi.fn(async () => success());
    const custody = await custodyAt(created.stateRoot, runner);
    await expect(custody.prepareAccess({ principal, rootPath: created.rootPath })).rejects.toThrow(
      "parent-census-refused",
    );
    expect(runner).not.toHaveBeenCalled();
    expect(await readdir(created.stateRoot)).toEqual([]);
    expect((await readdir(created.parent)).sort()).toEqual(["execution", "sibling"]);
  });

  test("reverses an ambiguous PREPARE and removes intent only after exact RESTORE", async () => {
    const created = await createRoots();
    const calls: string[] = [];
    const custody = await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      calls.push(request.operation);
      mutate(request);
      return request.operation === "PREPARE"
        ? { exitCode: 1, signal: null, stderr: "lost", stdout: "" }
        : success();
    });
    await expect(custody.prepareAccess({ principal, rootPath: created.rootPath })).rejects.toThrow(
      "prepare-refused",
    );
    expect(calls).toEqual(["PREPARE", "RESTORE"]);
    expect(await readdir(created.stateRoot)).toEqual([]);
  });

  test("retains a failed RESTORE intent and the same lease can retry", async () => {
    const created = await createRoots();
    let refuseRestore = true;
    const custody = await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      if (request.operation === "RESTORE" && refuseRestore)
        return { exitCode: 1, signal: null, stderr: "lost", stdout: "" };
      mutate(request);
      return success();
    });
    const lease = await custody.prepareAccess({ principal, rootPath: created.rootPath });
    await expect(custody.restoreAccess(lease)).rejects.toThrow("restore-refused");
    expect(await readdir(created.stateRoot)).toHaveLength(1);
    refuseRestore = false;
    await custody.restoreAccess(lease);
    expect(await readdir(created.stateRoot)).toEqual([]);
    await expect(custody.restoreAccess(lease)).rejects.toThrow("lease-refused");
  });

  test("retries after unlink succeeds but directory fsync fails", async () => {
    const created = await createRoots();
    let failSync = false;
    const custody = await custodyAt(
      created.stateRoot,
      async (command) => {
        const request = JSON.parse(command.inputText) as HelperRequest;
        mutate(request);
        return success();
      },
      async () => helperProfile,
      async () => {
        mockedDac.events.push("directory-sync");
        if (failSync) {
          failSync = false;
          throw new Error("lost fsync result");
        }
      },
    );
    const lease = await custody.prepareAccess({ principal, rootPath: created.rootPath });
    failSync = true;
    await expect(custody.restoreAccess(lease)).rejects.toThrow("lost fsync result");
    expect(await readdir(created.stateRoot)).toEqual([]);
    await custody.restoreAccess(lease);
    await expect(custody.restoreAccess(lease)).rejects.toThrow("lease-refused");
  });

  test("an intermediate ancestor identity substitution refuses teardown", async () => {
    const created = await createRoots();
    let request: HelperRequest | undefined;
    const custody = await custodyAt(created.stateRoot, async (command) => {
      request = JSON.parse(command.inputText) as HelperRequest;
      mutate(request);
      return success();
    });
    const lease = await custody.prepareAccess({ principal, rootPath: created.rootPath });
    const ancestor = request!.ancestors.at(-2)!;
    mockedDac.identities.set(resolve(ancestor.path), { ino: BigInt(ancestor.inode) + 1n });
    await expect(custody.restoreAccess(lease)).rejects.toThrow("ancestor-handle-moved");
    expect(await readdir(created.stateRoot)).toHaveLength(1);
    mockedDac.identities.set(resolve(ancestor.path), { ino: BigInt(ancestor.inode) });
    await custody.restoreAccess(lease);
  });

  test("recovers an exact prior intent before returning new authority", async () => {
    const created = await createRoots();
    let persisted = "";
    const first = await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      mutate(request);
      return success();
    });
    const lease = await first.prepareAccess({ principal, rootPath: created.rootPath });
    persisted = await readFile(
      resolve(created.stateRoot, `linux-dac-intent-${principal.name}.json`),
      "utf8",
    );
    await first.restoreAccess(lease);
    const intentPath = resolve(created.stateRoot, `linux-dac-intent-${principal.name}.json`);
    await writeFile(intentPath, persisted, { mode: 0o600 });
    installIdentity(intentPath, 0o600);
    const parsed = JSON.parse(persisted) as { request: HelperRequest };
    mutate({ ...parsed.request, operation: "PREPARE" });
    const calls: string[] = [];
    await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      calls.push(request.operation);
      mutate(request);
      return success();
    });
    expect(calls).toEqual(["RESTORE"]);
    expect(await readdir(created.stateRoot)).toEqual([]);
  });

  test("retains noncanonical or malformed recovery intent without mutation", async () => {
    const created = await createRoots();
    const intentPath = resolve(created.stateRoot, `linux-dac-intent-${principal.name}.json`);
    await writeFile(intentPath, '{ "name": "bad" }', { mode: 0o600 });
    installIdentity(intentPath, 0o600);
    const runner = vi.fn();
    await expect(custodyAt(created.stateRoot, runner)).rejects.toThrow("intent-refused");
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(intentPath, "utf8")).toBe('{ "name": "bad" }');
  });

  test("detaches hostile helper profiles and command results without invoking traps", async () => {
    const created = await createRoots();
    const accessor = { ...helperProfile };
    let getterCalls = 0;
    Object.defineProperty(accessor, "inode", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "3";
      },
    });
    await expect(
      custodyAt(
        created.stateRoot,
        async () => success(),
        async () => accessor,
      ),
    ).rejects.toThrow("helper-profile-refused");
    expect(getterCalls).toBe(0);

    let proxyCalls = 0;
    const custody = await custodyAt(created.stateRoot, async (command) => {
      const request = JSON.parse(command.inputText) as HelperRequest;
      if (request.operation === "RESTORE") {
        mutate(request);
        return success();
      }
      return new Proxy(success(), {
        ownKeys() {
          proxyCalls += 1;
          throw new Error("trap");
        },
      });
    });
    await expect(
      custody.prepareAccess({ principal, rootPath: created.rootPath }),
    ).rejects.toThrow();
    expect(proxyCalls).toBe(0);
  });

  test.each(["stdout", "stderr"])(
    "latches oversized %s even when the child exits cleanly",
    async (stream) => {
      await expect(
        runLinuxAuthorityCommand({
          arguments: [resolve(import.meta.dirname, "linux-dac-output-fixture.mjs"), stream],
          file: process.execPath,
          inputText: "",
        }),
      ).rejects.toThrow("command-output-limit-refused");
    },
  );
});

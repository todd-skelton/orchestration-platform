import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockedFileOwnership = vi.hoisted(() => ({ events: [] as string[], root: "", uid: 1001n }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const adjusted = <Value extends object>(value: Value, path: string): Value =>
    mockedFileOwnership.root && resolve(path).startsWith(resolve(mockedFileOwnership.root))
      ? (new Proxy(value, {
          get(target, property, receiver) {
            if (property === "uid") return mockedFileOwnership.uid;
            if (property === "mode")
              return (Reflect.get(target, property, receiver) as bigint) & ~0o77n;
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
      if (!mockedFileOwnership.root || !resolve(path).startsWith(resolve(mockedFileOwnership.root)))
        return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "stat")
            return async (...statArguments: unknown[]) =>
              adjusted(await target.stat(...statArguments), path);
          if (property === "sync")
            return async () => {
              mockedFileOwnership.events.push(`file-sync:${String(path).split(/[\\/]/).at(-1)}`);
              await target.sync();
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  createLinuxAccountCustody,
  createLinuxAccountCustodyTestFixture,
  type LinuxAccountCommandRequest,
  type LinuxHelperProfile,
} from "../../packages/conformance/src/linux-account-custody.js";

const roots: string[] = [];

const profile: LinuxHelperProfile = Object.freeze({
  ctimeNanoseconds: "1",
  device: "2",
  gid: "0",
  inode: "3",
  mode: String(0o100755),
  size: "4",
  uid: "0",
});

afterEach(async () => {
  mockedFileOwnership.root = "";
  mockedFileOwnership.events.splice(0);
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

async function fixture(
  run: (request: LinuxAccountCommandRequest) => Promise<unknown>,
  token = "0000000000000001",
  syncStateDirectory?: () => Promise<void>,
) {
  const stateRoot = await mkdtemp(resolve(tmpdir(), "orchestration-linux-account-state-"));
  roots.push(stateRoot);
  await chmod(stateRoot, 0o700);
  mockedFileOwnership.root = stateRoot;
  mockedFileOwnership.events.splice(0);
  return {
    custody: await custodyAt(stateRoot, run, token, async () => profile, syncStateDirectory),
    events: mockedFileOwnership.events,
    stateRoot,
  };
}

async function custodyAt(
  stateRoot: string,
  run: (request: LinuxAccountCommandRequest) => Promise<unknown>,
  token: string,
  profileReader: () => Promise<LinuxHelperProfile> = async () => profile,
  syncStateDirectory: () => Promise<void> = async () => {
    mockedFileOwnership.events.push("directory-sync");
  },
) {
  return await createLinuxAccountCustodyTestFixture(
    {
      accountHelperPath: resolve(
        import.meta.dirname,
        "../../packages/conformance/src/linux-principal-account.py",
      ),
      commandRunner: run,
      principalToken: () => token,
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

function success(stdout: string) {
  return { exitCode: 0, signal: null, stderr: "", stdout };
}

describe("Linux stable account cleanup-intent custody", () => {
  test.runIf(process.platform !== "linux")(
    "hard-refuses off Linux before any injectable authority seam",
    async () => {
      const commandRunner = vi.fn();
      const profileReader = vi.fn();
      await expect(
        createLinuxAccountCustody({
          accountHelperPath: "C:/forged-helper.py",
          commandRunner,
          profileReader,
          stateRoot: "C:/forged-state",
        }),
      ).rejects.toThrow("unsupported-platform");
      expect(commandRunner).not.toHaveBeenCalled();
      expect(profileReader).not.toHaveBeenCalled();
    },
  );

  test("fsyncs intent before CREATE and retains it until exact DELETE", async () => {
    const calls: string[] = [];
    let stateRoot = "";
    const created = await fixture(async (request) => {
      const operation = request.arguments[3]!;
      calls.push(operation);
      mockedFileOwnership.events.push(`command:${operation}`);
      const entries = await readdir(stateRoot);
      expect(entries).toHaveLength(2);
      const intent = entries.find((entry) => entry.startsWith("linux-principal-intent-"));
      expect(intent).toBeDefined();
      expect(JSON.parse(await readFile(resolve(stateRoot, intent!), "utf8"))).toEqual({
        gid: "1100000001",
        name: "orch6-0000000000000001",
        uid: "1000001",
      });
      return success(
        operation === "CREATE"
          ? '{"gid":"1100000001","name":"orch6-0000000000000001","uid":"1000001"}'
          : '{"ok":true}',
      );
    });
    stateRoot = created.stateRoot;
    const principal = await created.custody.createPrincipal();
    expect(await readdir(stateRoot)).toHaveLength(2);
    await created.custody.deletePrincipal(principal);
    expect(await readdir(stateRoot)).toEqual(["linux-principal-used-orch6-0000000000000001.json"]);
    expect(calls).toEqual(["CREATE", "DELETE"]);
    expect(created.events.slice(0, 6)).toEqual([
      "directory-sync",
      "file-sync:linux-principal-used-orch6-0000000000000001.json",
      "directory-sync",
      "file-sync:linux-principal-intent-orch6-0000000000000001.json",
      "directory-sync",
      "command:CREATE",
    ]);
  });

  test("reverses ambiguous CREATE and retains intent after ambiguous DELETE", async () => {
    let deletionFails = false;
    const created = await fixture(async (request) => {
      const operation = request.arguments[3];
      if (operation === "CREATE") return { exitCode: 1, signal: null, stderr: "lost", stdout: "" };
      return deletionFails
        ? { exitCode: 1, signal: null, stderr: "lost", stdout: "" }
        : success('{"ok":true}');
    });
    await expect(created.custody.createPrincipal()).rejects.toThrow();
    expect(await readdir(created.stateRoot)).toEqual([
      "linux-principal-used-orch6-0000000000000001.json",
    ]);

    let failDelete = false;
    const successful = await fixture(async (request) => {
      if (request.arguments[3] === "CREATE")
        return success('{"gid":"1100000001","name":"orch6-0000000000000001","uid":"1000001"}');
      return failDelete
        ? { exitCode: 1, signal: null, stderr: "lost", stdout: "" }
        : success('{"ok":true}');
    });
    const principal = await successful.custody.createPrincipal();
    failDelete = true;
    // A failed deletion command cannot authorize removing its persisted intent.
    await expect(successful.custody.deletePrincipal(principal)).rejects.toThrow();
    expect(await readdir(successful.stateRoot)).toHaveLength(2);
    failDelete = false;
    await successful.custody.deletePrincipal(principal);
    expect(await readdir(successful.stateRoot)).toEqual([
      "linux-principal-used-orch6-0000000000000001.json",
    ]);
  });

  test("retries deletion after intent unlink succeeds but directory fsync fails", async () => {
    let deletionSyncs = 0;
    let failDeletionSync = false;
    const calls: string[] = [];
    const created = await fixture(
      async (request) => {
        const operation = request.arguments[3]!;
        calls.push(operation);
        return success(
          operation === "CREATE"
            ? '{"gid":"1100000001","name":"orch6-0000000000000001","uid":"1000001"}'
            : '{"ok":true}',
        );
      },
      "0000000000000001",
      async () => {
        mockedFileOwnership.events.push("directory-sync");
        if (failDeletionSync) {
          deletionSyncs += 1;
          if (deletionSyncs === 1) throw new Error("lost intent unlink directory fsync");
        }
      },
    );
    const principal = await created.custody.createPrincipal();
    failDeletionSync = true;
    await expect(created.custody.deletePrincipal(principal)).rejects.toThrow(
      "lost intent unlink directory fsync",
    );
    expect(await readdir(created.stateRoot)).toEqual([
      "linux-principal-used-orch6-0000000000000001.json",
    ]);
    await created.custody.deletePrincipal(principal);
    expect(calls).toEqual(["CREATE", "DELETE", "DELETE"]);
  });

  test("recovers a persisted prior intent before new authority use", async () => {
    const calls: string[] = [];
    const created = await fixture(async (request) => {
      calls.push(request.arguments[3]!);
      return success('{"ok":true}');
    });
    const name = "orch6-0000000000000009";
    await writeFile(
      resolve(created.stateRoot, `linux-principal-used-${name}.json`),
      JSON.stringify({ gid: "1100000009", name, uid: "1000009" }),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      resolve(created.stateRoot, `linux-principal-intent-${name}.json`),
      JSON.stringify({ gid: "1100000009", name, uid: "1000009" }),
      { encoding: "utf8", mode: 0o600 },
    );
    await created.custody.recover();
    expect(calls).toEqual(["DELETE"]);
    expect(await readdir(created.stateRoot)).toEqual([
      "linux-principal-used-orch6-0000000000000009.json",
    ]);
  });

  test("recovery retry fsyncs an already-unlinked intent before accepting absence", async () => {
    let recoverySyncs = 0;
    let failRecoveryUnlinkSync = false;
    const calls: string[] = [];
    const created = await fixture(
      async (request) => {
        calls.push(request.arguments[3]!);
        return success('{"ok":true}');
      },
      "0000000000000001",
      async () => {
        mockedFileOwnership.events.push("directory-sync");
        if (failRecoveryUnlinkSync) {
          recoverySyncs += 1;
          if (recoverySyncs === 2) throw new Error("lost recovery unlink directory fsync");
        }
      },
    );
    const name = "orch6-0000000000000009";
    const bytes = JSON.stringify({ gid: "1100000009", name, uid: "1000009" });
    await writeFile(resolve(created.stateRoot, `linux-principal-used-${name}.json`), bytes, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(resolve(created.stateRoot, `linux-principal-intent-${name}.json`), bytes, {
      encoding: "utf8",
      mode: 0o600,
    });
    failRecoveryUnlinkSync = true;
    await expect(created.custody.recover()).rejects.toThrow("lost recovery unlink directory fsync");
    expect(await readdir(created.stateRoot)).toEqual([`linux-principal-used-${name}.json`]);
    await created.custody.recover();
    expect(calls).toEqual(["DELETE"]);
    expect(recoverySyncs).toBe(3);
    expect(await readdir(created.stateRoot)).toEqual([`linux-principal-used-${name}.json`]);
  });

  test("persists never-reuse across custody reconstruction", async () => {
    const run = async (request: LinuxAccountCommandRequest) =>
      success(
        request.arguments[3] === "CREATE"
          ? '{"gid":"1100000001","name":"orch6-0000000000000001","uid":"1000001"}'
          : '{"ok":true}',
      );
    const created = await fixture(run);
    const principal = await created.custody.createPrincipal();
    await created.custody.deletePrincipal(principal);
    const reconstructed = await custodyAt(created.stateRoot, run, "0000000000000001");
    await expect(reconstructed.createPrincipal()).rejects.toThrow("identity-reuse-refused");
  });

  test("detaches hostile profiles and command results without invoking traps", async () => {
    const created = await fixture(async () => success('{"ok":true}'));
    let getterCalls = 0;
    const accessor = { ...profile };
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
        async () => success('{"ok":true}'),
        "0000000000000002",
        async () => accessor,
      ),
    ).rejects.toThrow("helper-profile-refused");
    expect(getterCalls).toBe(0);

    let proxyCalls = 0;
    let commandCalls = 0;
    const hostile = await custodyAt(
      created.stateRoot,
      async () => {
        commandCalls += 1;
        if (commandCalls > 1) return success('{"ok":true}');
        return new Proxy(success(""), {
          ownKeys() {
            proxyCalls += 1;
            throw new Error("trap");
          },
        });
      },
      "0000000000000002",
    );
    await expect(hostile.createPrincipal()).rejects.toThrow();
    expect(proxyCalls).toBe(0);
    expect(await readdir(created.stateRoot)).toContain(
      "linux-principal-used-orch6-0000000000000002.json",
    );
  });

  test("retains malformed recovery state and movement intents", async () => {
    const created = await fixture(async () => success('{"ok":true}'));
    const name = "orch6-0000000000000003";
    const value = { gid: "1100000003", name, uid: "1000003" };
    await writeFile(
      resolve(created.stateRoot, `linux-principal-used-${name}.json`),
      JSON.stringify(value),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      resolve(created.stateRoot, `linux-principal-intent-${name}.json`),
      JSON.stringify({ ...value, extra: true }),
      { encoding: "utf8", mode: 0o600 },
    );
    await expect(created.custody.recover()).rejects.toThrow("intent-refused");
    expect(await readdir(created.stateRoot)).toHaveLength(2);

    const movedRoot = await mkdtemp(resolve(tmpdir(), "orchestration-linux-account-state-"));
    roots.push(movedRoot);
    await chmod(movedRoot, 0o700);
    mockedFileOwnership.root = movedRoot;
    let moved = false;
    const movedProfile = { ...profile, inode: "4" };
    const custody = await custodyAt(
      movedRoot,
      async () => {
        moved = true;
        return success('{"gid":"1100000004","name":"orch6-0000000000000004","uid":"1000004"}');
      },
      "0000000000000004",
      async () => (moved ? movedProfile : profile),
    );
    await expect(custody.createPrincipal()).rejects.toThrow("create-reversal-refused");
    expect(await readdir(movedRoot)).toHaveLength(2);
  });
});

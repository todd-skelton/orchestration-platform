import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockedState = vi.hoisted(() => ({ gid: 1001n, root: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const adjusted = <Value extends object>(value: Value, path: string): Value =>
    mockedState.root && resolve(path).startsWith(resolve(mockedState.root))
      ? (new Proxy(value, {
          get(target, property, receiver) {
            if (property === "uid") return 1001n;
            if (property === "gid") return mockedState.gid;
            if (property === "mode")
              return (
                ((Reflect.get(target, property, receiver) as bigint) & ~0o7777n) |
                (resolve(path) === resolve(mockedState.root) ? 0o700n : 0o600n)
              );
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
      if (!mockedState.root || !resolve(path).startsWith(resolve(mockedState.root))) return handle;
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
  createLinuxProcessCustody,
  createLinuxProcessCustodyTestFixture,
} from "../../packages/conformance/src/linux-process-custody.js";
import type { LinuxAccountPrincipal } from "../../packages/conformance/src/linux-account-custody.js";
import type {
  LinuxDacCommandRequest,
  LinuxDacHelperProfile,
} from "../../packages/conformance/src/linux-dac-custody.js";

const roots: string[] = [];
const helperProfile: LinuxDacHelperProfile = Object.freeze({
  ctimeNanoseconds: "1",
  device: "2",
  gid: "0",
  inode: "3",
  mode: String(0o100755),
  size: "4",
  uid: "0",
});

afterEach(async () => {
  mockedState.root = "";
  mockedState.gid = 1001n;
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

function success() {
  return { exitCode: 0, signal: null, stderr: "", stdout: '{"ok":true}' };
}

function principalAt(stateRoot: string, token = "0000000000000001"): LinuxAccountPrincipal {
  const numeric = BigInt(`0x${token}`);
  const name = `orch6-${token}`;
  return Object.freeze({
    gid: String(1_100_000_000n + (numeric % 500_000_000n)),
    intentPath: resolve(stateRoot, `linux-principal-intent-${name}.json`),
    name,
    uid: String(1_000_000n + (numeric % 500_000_000n)),
  });
}

async function persist(principal: LinuxAccountPrincipal): Promise<void> {
  const bytes = JSON.stringify({ gid: principal.gid, name: principal.name, uid: principal.uid });
  await writeFile(principal.intentPath, bytes, { mode: 0o600 });
  await writeFile(
    resolve(principal.intentPath, `../linux-principal-used-${principal.name}.json`),
    bytes,
    { mode: 0o600 },
  );
}

async function createStateRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-linux-process-state-"));
  roots.push(root);
  await chmod(root, 0o700);
  mockedState.root = root;
  return root;
}

async function custodyAt(
  stateRoot: string,
  run: (request: LinuxDacCommandRequest) => Promise<unknown>,
  profileReader: () => Promise<LinuxDacHelperProfile> = async () => helperProfile,
  dependencies = { stableGid: 1001, stableUid: 1001 },
) {
  mockedState.gid = BigInt(dependencies.stableGid);
  return await createLinuxProcessCustodyTestFixture(
    {
      commandRunner: run,
      pidfdHelperPath: resolve(
        import.meta.dirname,
        "../../packages/conformance/src/linux-pidfd-quiesce.py",
      ),
      profileReader,
      stateRoot,
    },
    dependencies,
  );
}

describe("Linux stable pidfd process custody", () => {
  test.runIf(process.platform !== "linux")(
    "hard-refuses off Linux before any injectable authority seam",
    async () => {
      const commandRunner = vi.fn();
      const profileReader = vi.fn();
      await expect(
        createLinuxProcessCustody({
          commandRunner,
          pidfdHelperPath: "C:/forged-helper.py",
          profileReader,
          stateRoot: "C:/forged-state",
        }),
      ).rejects.toThrow("unsupported-platform");
      expect(commandRunner).not.toHaveBeenCalled();
      expect(profileReader).not.toHaveBeenCalled();
    },
  );

  test("invokes only the authenticated pidfd helper for a persisted exact principal", async () => {
    const stateRoot = await createStateRoot();
    const calls: LinuxDacCommandRequest[] = [];
    const processCustody = await custodyAt(stateRoot, async (request) => {
      calls.push(request);
      return success();
    });
    const principal = principalAt(stateRoot);
    await persist(principal);
    await processCustody.quiesce(principal);
    expect(calls).toEqual([
      {
        arguments: [
          "-n",
          process.platform === "linux" ? await realpath("/usr/bin/python3") : "/usr/bin/python3",
          "-I",
          "-B",
          resolve(import.meta.dirname, "../../packages/conformance/src/linux-pidfd-quiesce.py"),
          principal.uid,
        ],
        file: "/usr/bin/sudo",
        inputText: "",
      },
    ]);
  });

  test("automatically quiesces every prior account intent before returning authority", async () => {
    const stateRoot = await createStateRoot();
    const first = principalAt(stateRoot, "0000000000000001");
    const second = principalAt(stateRoot, "0000000000000002");
    await persist(second);
    await persist(first);
    const calls: string[] = [];
    await custodyAt(stateRoot, async (request) => {
      calls.push(request.arguments.at(-1)!);
      return success();
    });
    expect(calls).toEqual([first.uid, second.uid]);
  });

  test("preflights every recovery pair before the first process mutation", async () => {
    const stateRoot = await createStateRoot();
    const first = principalAt(stateRoot, "0000000000000001");
    const second = principalAt(stateRoot, "0000000000000002");
    await persist(first);
    await persist(second);
    await rm(resolve(second.intentPath, `../linux-principal-used-${second.name}.json`));
    const runner = vi.fn(async () => success());
    await expect(custodyAt(stateRoot, runner)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  test("preflights a later stable-equal recovery pair before quiescing an earlier UID", async () => {
    const stateRoot = await createStateRoot();
    const first = principalAt(stateRoot, "0000000000000001");
    const second = principalAt(stateRoot, "0000000000000002");
    await persist(first);
    await persist(second);
    const runner = vi.fn(async () => success());
    await expect(
      custodyAt(stateRoot, runner, async () => helperProfile, {
        stableGid: Number(second.gid),
        stableUid: 1001,
      }),
    ).rejects.toThrow("identity-equality-refused");
    expect(runner).not.toHaveBeenCalled();
  });

  test("missing, malformed, moved, or mismatched intents refuse before mutation", async () => {
    const stateRoot = await createStateRoot();
    const runner = vi.fn(async () => success());
    const processCustody = await custodyAt(stateRoot, runner);
    const principal = principalAt(stateRoot);
    await expect(processCustody.quiesce(principal)).rejects.toThrow();
    await persist(principal);
    await expect(processCustody.quiesce({ ...principal, uid: "1000002" })).rejects.toThrow();
    await expect(
      processCustody.quiesce({ ...principal, intentPath: resolve(stateRoot, "wrong.json") }),
    ).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  test("missing, mismatched, or noncanonical used tombstones refuse before mutation", async () => {
    const stateRoot = await createStateRoot();
    const runner = vi.fn(async () => success());
    const processCustody = await custodyAt(stateRoot, runner);
    const principal = principalAt(stateRoot);
    await persist(principal);
    const usedPath = resolve(
      principal.intentPath,
      `../linux-principal-used-${principal.name}.json`,
    );
    await rm(usedPath);
    await expect(processCustody.quiesce(principal)).rejects.toThrow();
    await writeFile(
      usedPath,
      JSON.stringify({ gid: principal.gid, name: principal.name, uid: "1000002" }),
      { mode: 0o600 },
    );
    await expect(processCustody.quiesce(principal)).rejects.toThrow();
    await writeFile(
      usedPath,
      ` ${JSON.stringify({ gid: principal.gid, name: principal.name, uid: principal.uid })}`,
      { mode: 0o600 },
    );
    await expect(processCustody.quiesce(principal)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  test("candidate GID equality with the stable authority refuses before mutation", async () => {
    const stateRoot = await createStateRoot();
    const principal = principalAt(stateRoot);
    const runner = vi.fn(async () => success());
    const processCustody = await custodyAt(stateRoot, runner, async () => helperProfile, {
      stableGid: Number(principal.gid),
      stableUid: 1001,
    });
    await persist(principal);
    await expect(processCustody.quiesce(principal)).rejects.toThrow("identity-equality-refused");
    expect(runner).not.toHaveBeenCalled();
  });

  test("checks state, intent, and every helper profile after authority use", async () => {
    const stateRoot = await createStateRoot();
    const principal = principalAt(stateRoot);
    let moved = false;
    const movedProfile = Object.freeze({ ...helperProfile, inode: "4" });
    const processCustody = await custodyAt(
      stateRoot,
      async () => {
        moved = true;
        return success();
      },
      async () => (moved ? movedProfile : helperProfile),
    );
    await persist(principal);
    await expect(processCustody.quiesce(principal)).rejects.toThrow("helper-moved");
  });

  test("detaches hostile helper profiles and results without invoking traps", async () => {
    const stateRoot = await createStateRoot();
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
        stateRoot,
        async () => success(),
        async () => accessor,
      ),
    ).rejects.toThrow("helper-profile-refused");
    expect(getterCalls).toBe(0);

    const principal = principalAt(stateRoot);
    let trapCalls = 0;
    const processCustody = await custodyAt(
      stateRoot,
      async () =>
        new Proxy(success(), {
          ownKeys() {
            trapCalls += 1;
            throw new Error("trap");
          },
        }),
    );
    await persist(principal);
    await expect(processCustody.quiesce(principal)).rejects.toThrow("quiescence-refused");
    expect(trapCalls).toBe(0);
  });

  test("unknown terminal status, signal, diagnostics, or output always refuses", async () => {
    for (const result of [
      { exitCode: null, signal: null, stderr: "", stdout: '{"ok":true}' },
      { exitCode: 0, signal: "SIGKILL", stderr: "", stdout: '{"ok":true}' },
      { exitCode: 0, signal: null, stderr: "diagnostic", stdout: '{"ok":true}' },
      { exitCode: 0, signal: null, stderr: "", stdout: '{"ok":true}\n' },
    ]) {
      const stateRoot = await createStateRoot();
      const processCustody = await custodyAt(stateRoot, async () => result);
      const principal = principalAt(stateRoot);
      await persist(principal);
      await expect(processCustody.quiesce(principal)).rejects.toThrow("quiescence-refused");
      mockedState.root = "";
    }
  });
});

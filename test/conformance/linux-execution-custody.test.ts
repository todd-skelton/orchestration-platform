import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  accountMode: 0o700n,
  accountRoot: "",
  base: "",
  events: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const adjusted = <Value extends object>(value: Value, path: string): Value => {
    if (!mocked.base || !resolve(path).startsWith(resolve(mocked.base))) return value;
    const file = /(?:\.json|\.mjs|\.py)$/.test(String(path));
    return new Proxy(value, {
      get(target, property, receiver) {
        if (property === "uid" || property === "gid") return 1001n;
        if (property === "mode")
          return (
            ((Reflect.get(target, property, receiver) as bigint) & ~0o7777n) |
            (file
              ? 0o600n
              : resolve(path) === resolve(mocked.accountRoot)
                ? mocked.accountMode
                : 0o700n)
          );
        return Reflect.get(target, property, receiver);
      },
    });
  };
  return {
    ...actual,
    async lstat(path: string, options?: unknown) {
      return adjusted(
        await (actual.lstat as (path: string, options?: unknown) => Promise<object>)(path, options),
        path,
      );
    },
    async open(path: string, ...values: unknown[]) {
      const handle = await (actual.open as (...arguments_: unknown[]) => Promise<any>)(
        path,
        ...values,
      );
      if (!mocked.base || !resolve(path).startsWith(resolve(mocked.base))) return handle;
      const file = /(?:\.json|\.mjs|\.py)$/.test(String(path));
      return new Proxy(handle, {
        get(target, property) {
          if (property === "stat")
            return async (...arguments_: unknown[]) =>
              adjusted(await target.stat(...arguments_), path);
          if (property === "sync")
            return async () => {
              mocked.events.push(`sync:${basename(path)}`);
              if (file) await target.sync();
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import type { LinuxAccountPrincipal } from "../../packages/conformance/src/linux-account-custody.js";
import type {
  LinuxDacCommandRequest,
  LinuxDacHelperProfile,
} from "../../packages/conformance/src/linux-dac-custody.js";
import {
  createLinuxExecutionCustody,
  createLinuxExecutionCustodyTestFixture,
  type LinuxExecutionCustody,
  type LinuxExecutionCustodyOptions,
} from "../../packages/conformance/src/linux-execution-custody.js";

const roots: string[] = [];
const custodies: LinuxExecutionCustody[] = [];
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
  await Promise.allSettled(custodies.splice(0).map(async (custody) => await custody.close()));
  mocked.base = "";
  mocked.accountMode = 0o700n;
  mocked.accountRoot = "";
  mocked.events = [];
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

async function fixture() {
  const base = await mkdtemp(resolve(tmpdir(), "orchestration-execution-custody-"));
  roots.push(base);
  mocked.base = base;
  const accountStateRoot = resolve(base, "account-state");
  mocked.accountRoot = accountStateRoot;
  const stateRoot = resolve(base, "state");
  const executionParent = resolve(base, "executions");
  const sourceRoot = resolve(base, "sources");
  for (const path of [accountStateRoot, stateRoot, executionParent, sourceRoot]) {
    await mkdir(path);
    await chmod(path, 0o700);
  }
  const candidateArtifactPath = resolve(sourceRoot, "candidate.mjs");
  const rpcRunnerPath = resolve(sourceRoot, "rpc.mjs");
  await writeFile(candidateArtifactPath, "export const candidate = true;", { mode: 0o600 });
  await writeFile(rpcRunnerPath, "export const rpc = true;", { mode: 0o600 });
  const principal: LinuxAccountPrincipal = Object.freeze({
    gid: "1100000001",
    intentPath: resolve(accountStateRoot, "linux-principal-intent-orch6-0000000000000001.json"),
    name: "orch6-0000000000000001",
    uid: "1000001",
  });
  const principalBytes = JSON.stringify({
    gid: principal.gid,
    name: principal.name,
    uid: principal.uid,
  });
  await writeFile(principal.intentPath, principalBytes, { mode: 0o600 });
  await writeFile(
    resolve(accountStateRoot, `linux-principal-used-${principal.name}.json`),
    principalBytes,
    {
      mode: 0o600,
    },
  );
  return {
    accountStateRoot,
    base,
    candidateArtifactPath,
    executionParent,
    principal,
    rpcRunnerPath,
    stateRoot,
  };
}

function success() {
  return { exitCode: 0, signal: null, stderr: "", stdout: '{"ok":true}' };
}

async function removeRequestedRoot(request: LinuxDacCommandRequest): Promise<void> {
  const value = JSON.parse(request.inputText) as {
    ancestors: { path: string }[];
    executionName: string;
  };
  await rm(resolve(value.ancestors.at(-1)!.path, value.executionName), {
    force: true,
    recursive: true,
  });
}

async function custodyAt(
  value: Awaited<ReturnType<typeof fixture>>,
  run: (request: LinuxDacCommandRequest) => Promise<unknown>,
  syncStateDirectory: (path: string) => Promise<void> = async () => {},
  token = "0000000000000001",
  profileReader: () => Promise<LinuxDacHelperProfile> = async () => helperProfile,
  overrides: Partial<LinuxExecutionCustodyOptions> = {},
) {
  const custody = await createLinuxExecutionCustodyTestFixture(
    {
      accountStateRoot: value.accountStateRoot,
      cleanupHelperPath: resolve(
        import.meta.dirname,
        "../../packages/conformance/src/linux-execution-cleanup.py",
      ),
      commandRunner: run,
      executionParent: value.executionParent,
      profileReader,
      stateRoot: value.stateRoot,
      token: () => token,
      ...overrides,
    },
    { stableGid: 1001, stableUid: 1001, syncStateDirectory },
  );
  custodies.push(custody);
  return custody;
}

async function custodyWithOverrides(
  value: Awaited<ReturnType<typeof fixture>>,
  run: (request: LinuxDacCommandRequest) => Promise<unknown>,
  overrides: Partial<LinuxExecutionCustodyOptions>,
) {
  return await custodyAt(
    value,
    run,
    async () => {},
    "0000000000000001",
    async () => helperProfile,
    overrides,
  );
}

describe("Linux durable execution-root custody", () => {
  test.runIf(process.platform !== "linux")(
    "hard-refuses off Linux before injected filesystem authority",
    async () => {
      const commandRunner = vi.fn();
      const profileReader = vi.fn();
      await expect(
        createLinuxExecutionCustody({
          accountStateRoot: "C:/forged-account-state",
          cleanupHelperPath: "C:/forged.py",
          commandRunner,
          executionParent: "C:/forged-execution",
          profileReader,
          stateRoot: "C:/forged-state",
        }),
      ).rejects.toThrow("unsupported-platform");
      expect(commandRunner).not.toHaveBeenCalled();
      expect(profileReader).not.toHaveBeenCalled();
    },
  );

  test("refuses equality and both nesting directions for every authority root pair", async () => {
    const value = await fixture();
    const nested = {
      accountInExecution: resolve(value.executionParent, "account-state"),
      accountInState: resolve(value.stateRoot, "account-state"),
      executionInAccount: resolve(value.accountStateRoot, "executions"),
      executionInState: resolve(value.stateRoot, "executions"),
      stateInAccount: resolve(value.accountStateRoot, "execution-state"),
      stateInExecution: resolve(value.executionParent, "execution-state"),
    };
    for (const path of Object.values(nested)) {
      await mkdir(path);
      await chmod(path, 0o700);
    }
    const cases: Partial<LinuxExecutionCustodyOptions>[] = [
      { accountStateRoot: value.stateRoot },
      { accountStateRoot: value.executionParent },
      { stateRoot: value.executionParent },
      { accountStateRoot: nested.accountInState },
      { stateRoot: nested.stateInAccount },
      { accountStateRoot: nested.accountInExecution },
      { executionParent: nested.executionInAccount },
      { stateRoot: nested.stateInExecution },
      { executionParent: nested.executionInState },
    ];
    for (const overrides of cases) {
      const runner = vi.fn(async () => success());
      const before = await Promise.all(
        [value.accountStateRoot, value.stateRoot, value.executionParent].map(async (path) =>
          (await readdir(path)).sort(),
        ),
      );
      await expect(custodyWithOverrides(value, runner, overrides)).rejects.toThrow(
        "root-separation-refused",
      );
      expect(runner).not.toHaveBeenCalled();
      expect(
        await Promise.all(
          [value.accountStateRoot, value.stateRoot, value.executionParent].map(async (path) =>
            (await readdir(path)).sort(),
          ),
        ),
      ).toEqual(before);
    }
  });

  test("refuses a writable or replaced account authority root before helper use", async () => {
    const value = await fixture();
    const runner = vi.fn(async () => success());
    mocked.accountMode = 0o770n;
    await expect(custodyAt(value, runner)).rejects.toThrow("state-root-refused");
    expect(runner).not.toHaveBeenCalled();

    mocked.accountMode = 0o700n;
    const custody = await custodyAt(value, runner);
    await custody.recoverAfterRevocation();
    await rename(value.accountStateRoot, `${value.accountStateRoot}-moved`);
    await mkdir(value.accountStateRoot);
    await chmod(value.accountStateRoot, 0o700);
    await expect(custody.create(value)).rejects.toThrow("state-root-moved");
    expect(runner).not.toHaveBeenCalled();
    expect(await readdir(value.executionParent)).toEqual([]);
    expect(await readdir(value.stateRoot)).toEqual([]);
  });

  test("refuses a principal intent bound to execution state before allocation", async () => {
    const value = await fixture();
    const runner = vi.fn(async () => success());
    const custody = await custodyAt(value, runner);
    await custody.recoverAfterRevocation();
    await expect(
      custody.create({
        ...value,
        principal: Object.freeze({
          ...value.principal,
          intentPath: resolve(
            value.stateRoot,
            `linux-principal-intent-${value.principal.name}.json`,
          ),
        }),
      }),
    ).rejects.toThrow("principal-refused");
    expect(runner).not.toHaveBeenCalled();
    expect(await readdir(value.executionParent)).toEqual([]);
    expect(await readdir(value.stateRoot)).toEqual([]);
  });

  test("refuses candidate and RPC sources inside account authority state", async () => {
    const value = await fixture();
    const runner = vi.fn(async () => success());
    const candidateInside = resolve(value.accountStateRoot, "candidate-inside.mjs");
    const rpcInside = resolve(value.accountStateRoot, "rpc-inside.mjs");
    await writeFile(candidateInside, "export {};", { mode: 0o600 });
    await writeFile(rpcInside, "export {};", { mode: 0o600 });
    const custody = await custodyAt(value, runner);
    await custody.recoverAfterRevocation();
    await expect(
      custody.create({ ...value, candidateArtifactPath: candidateInside }),
    ).rejects.toThrow("source-root-refused");
    await expect(custody.create({ ...value, rpcRunnerPath: rpcInside })).rejects.toThrow(
      "source-root-refused",
    );
    expect(runner).not.toHaveBeenCalled();
    expect(await readdir(value.executionParent)).toEqual([]);
    expect(await readdir(value.stateRoot)).toEqual([]);
  });

  test("requires recovery before allocation and writes CREATED identity before returning", async () => {
    const value = await fixture();
    const calls: LinuxDacCommandRequest[] = [];
    const custody = await custodyAt(value, async (request) => {
      calls.push(request);
      await removeRequestedRoot(request);
      return success();
    });
    await expect(custody.create(value)).rejects.toThrow("recovery-required");
    await custody.recoverAfterRevocation();
    const lease = await custody.create(value);
    expect(await readdir(lease.rootPath)).toEqual(["candidate.mjs", "rpc-runner.mjs", "scratch"]);
    expect(await readFile(lease.candidateArtifactPath, "utf8")).toBe(
      await readFile(value.candidateArtifactPath, "utf8"),
    );
    const entries = await readdir(value.stateRoot);
    expect(entries).toContain(`linux-execution-used-${lease.executionName}.json`);
    expect(entries).toContain(`linux-execution-intent-${lease.executionName}.json`);
    expect(entries).toContain(`linux-execution-created-${lease.executionName}.json`);
    expect((await readdir(value.accountStateRoot)).sort()).toEqual([
      `linux-principal-intent-${value.principal.name}.json`,
      `linux-principal-used-${value.principal.name}.json`,
    ]);
    const created = JSON.parse(
      await readFile(
        resolve(value.stateRoot, `linux-execution-created-${lease.executionName}.json`),
        "utf8",
      ),
    ) as { candidate: { digest: string; inode: string }; root: { inode: string } };
    expect(created.candidate.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(created.candidate.inode).not.toBe(created.root.inode);
    await custody.cleanupAfterRevocation(lease);
    expect(JSON.parse(calls.at(-1)!.inputText)).toMatchObject({ mode: "CREATED" });
    expect(await readdir(value.executionParent)).toEqual([]);
    const finalEntries = await readdir(value.stateRoot);
    expect(finalEntries).not.toContain(`linux-execution-intent-${lease.executionName}.json`);
    expect(finalEntries).not.toContain(`linux-execution-created-${lease.executionName}.json`);
    expect(finalEntries).toContain(`linux-execution-used-${lease.executionName}.json`);
    expect((await readdir(value.accountStateRoot)).sort()).toEqual([
      `linux-principal-intent-${value.principal.name}.json`,
      `linux-principal-used-${value.principal.name}.json`,
    ]);
  });

  test("recovers a crash before CREATED persistence through PARTIAL cleanup", async () => {
    const value = await fixture();
    let syncs = 0;
    const first = await custodyAt(
      value,
      async () => {
        throw new Error("cleanup interrupted");
      },
      async () => {
        syncs += 1;
        if (syncs === 3) throw new Error("CREATED directory sync interrupted");
      },
    );
    await first.recoverAfterRevocation();
    syncs = 0;
    await expect(first.create(value)).rejects.toThrow("create-reversal-refused");
    const executionName = "orch6-exec-0000000000000001";
    await rm(resolve(value.stateRoot, `linux-execution-created-${executionName}.json`));
    await rm(resolve(value.executionParent, executionName, "rpc-runner.mjs"));
    await rm(resolve(value.executionParent, executionName, "scratch"), { recursive: true });
    const calls: LinuxDacCommandRequest[] = [];
    const reconstructed = await custodyAt(
      value,
      async (request) => {
        calls.push(request);
        await removeRequestedRoot(request);
        return success();
      },
      async () => {},
      "0000000000000002",
    );
    await reconstructed.recoverAfterRevocation();
    expect(JSON.parse(calls[0]!.inputText)).toMatchObject({ mode: "PARTIAL" });
    expect(await readdir(value.executionParent)).toEqual([]);
  });

  test("untracked or preexisting parent entries refuse without deletion", async () => {
    const value = await fixture();
    const preexisting = resolve(value.executionParent, "orch6-exec-0000000000000001");
    await mkdir(preexisting);
    await writeFile(resolve(preexisting, "unrelated"), "keep");
    const runner = vi.fn(async () => success());
    const custody = await custodyAt(value, runner);
    await expect(custody.recoverAfterRevocation()).rejects.toThrow("untracked-root-refused");
    expect(await readFile(resolve(preexisting, "unrelated"), "utf8")).toBe("keep");
    expect(runner).not.toHaveBeenCalled();
  });

  test("tampered CREATED allocation binding refuses before cleanup", async () => {
    const value = await fixture();
    const first = await custodyAt(value, async (request) => {
      await removeRequestedRoot(request);
      return success();
    });
    await first.recoverAfterRevocation();
    const lease = await first.create(value);
    const createdPath = resolve(
      value.stateRoot,
      `linux-execution-created-${lease.executionName}.json`,
    );
    const created = JSON.parse(await readFile(createdPath, "utf8")) as Record<string, unknown>;
    await writeFile(createdPath, JSON.stringify({ ...created, allocationDigest: "0".repeat(64) }));
    const runner = vi.fn(async () => success());
    const reconstructed = await custodyAt(value, runner, async () => {}, "0000000000000002");
    await expect(reconstructed.recoverAfterRevocation()).rejects.toThrow(
      "created-allocation-mismatch",
    );
    expect(runner).not.toHaveBeenCalled();
    await first.cleanupAfterRevocation(lease);
  });

  test("orphan CREATED state refuses before helper use", async () => {
    const value = await fixture();
    await writeFile(
      resolve(value.stateRoot, "linux-execution-created-orch6-exec-0000000000000001.json"),
      "{}",
      { mode: 0o600 },
    );
    const runner = vi.fn(async () => success());
    const custody = await custodyAt(value, runner);
    await expect(custody.recoverAfterRevocation()).rejects.toThrow("orphan-created-refused");
    expect(runner).not.toHaveBeenCalled();
  });

  test("missing account tombstone refuses before allocation or cleanup", async () => {
    const value = await fixture();
    await rm(resolve(value.accountStateRoot, `linux-principal-used-${value.principal.name}.json`));
    const runner = vi.fn(async () => success());
    const custody = await custodyAt(value, runner);
    await custody.recoverAfterRevocation();
    await expect(custody.create(value)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  test("retries after CREATED unlink succeeds but state-directory fsync fails", async () => {
    const value = await fixture();
    let failSync = false;
    const calls: string[] = [];
    const custody = await custodyAt(
      value,
      async (request) => {
        calls.push((JSON.parse(request.inputText) as { mode: string }).mode);
        await removeRequestedRoot(request);
        return success();
      },
      async () => {
        if (failSync) {
          failSync = false;
          throw new Error("lost directory fsync");
        }
      },
    );
    await custody.recoverAfterRevocation();
    const lease = await custody.create(value);
    failSync = true;
    await expect(custody.cleanupAfterRevocation(lease)).rejects.toThrow("lost directory fsync");
    await custody.cleanupAfterRevocation(lease);
    expect(calls.slice(-2)).toEqual(["CREATED", "CREATED"]);
    expect(await readdir(value.executionParent)).toEqual([]);
  });

  test("helper movement after cleanup refuses and retains durable state", async () => {
    const value = await fixture();
    let moved = false;
    let moveOnRun = true;
    const movedProfile = Object.freeze({ ...helperProfile, inode: "4" });
    const custody = await custodyAt(
      value,
      async (request) => {
        await removeRequestedRoot(request);
        if (moveOnRun) moved = true;
        return success();
      },
      async () => {},
      "0000000000000001",
      async () => (moved ? movedProfile : helperProfile),
    );
    await custody.recoverAfterRevocation();
    const lease = await custody.create(value);
    await expect(custody.cleanupAfterRevocation(lease)).rejects.toThrow("helper-moved");
    expect(await readdir(value.stateRoot)).toContain(
      `linux-execution-intent-${lease.executionName}.json`,
    );
    moveOnRun = false;
    moved = false;
    await custody.cleanupAfterRevocation(lease);
  });

  test("durably constructs entries before CREATED and persists root deletion before state removal", async () => {
    const value = await fixture();
    const custody = await custodyAt(
      value,
      async (request) => {
        await removeRequestedRoot(request);
        return success();
      },
      async () => {
        mocked.events.push("sync:state-directory");
      },
    );
    await custody.recoverAfterRevocation();
    mocked.events = [];
    const lease = await custody.create(value);
    const createdSync = mocked.events.indexOf(
      `sync:linux-execution-created-${lease.executionName}.json`,
    );
    expect(createdSync).toBeGreaterThan(-1);
    for (const required of ["sync:scratch", `sync:${lease.executionName}`, "sync:executions"])
      expect(mocked.events.indexOf(required)).toBeLessThan(createdSync);

    mocked.events = [];
    await custody.cleanupAfterRevocation(lease);
    expect(mocked.events[0]).toBe("sync:executions");
    expect(mocked.events.indexOf("sync:state-directory")).toBeGreaterThan(0);
  });

  test("active recovery and close refuse before mutation and preserve cleanup retry", async () => {
    const value = await fixture();
    const runner = vi.fn(async (request: LinuxDacCommandRequest) => {
      await removeRequestedRoot(request);
      return success();
    });
    const custody = await custodyAt(value, runner);
    await custody.recoverAfterRevocation();
    const lease = await custody.create(value);
    await expect(custody.recoverAfterRevocation()).rejects.toThrow("active-recovery-refused");
    await expect(custody.close()).rejects.toThrow("active-close-refused");
    expect(runner).not.toHaveBeenCalled();
    await custody.cleanupAfterRevocation(lease);
    expect(runner).toHaveBeenCalledTimes(1);
    await custody.close();
  });

  test("keeps execution custody off the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(publicSurface).not.toHaveProperty("createLinuxExecutionCustody");
  });
});

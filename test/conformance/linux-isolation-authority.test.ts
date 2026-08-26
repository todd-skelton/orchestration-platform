import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { LinuxAccountPrincipal } from "../../packages/conformance/src/linux-account-custody.js";
import type { LinuxDacHelperProfile } from "../../packages/conformance/src/linux-dac-custody.js";
import {
  createLinuxIsolationAuthority,
  createLinuxIsolationAuthorityTestFixture,
  runLinuxCandidateCommandTestFixture,
  type LinuxCandidateLaunchCommand,
  type LinuxIsolationAuthorityOptions,
} from "../../packages/conformance/src/linux-isolation-authority.js";

const roots: string[] = [];
const profile: LinuxDacHelperProfile = Object.freeze({
  ctimeNanoseconds: "1",
  device: "2",
  gid: "0",
  inode: "3",
  mode: String(0o100755),
  size: "4",
  uid: "0",
});

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
  vi.restoreAllMocks();
});

async function layout() {
  const base = await mkdtemp(resolve(tmpdir(), "orchestration-linux-isolation-"));
  roots.push(base);
  const accountStateRoot = resolve(base, "account-state");
  const dacStateRoot = resolve(base, "dac-state");
  const executionStateRoot = resolve(base, "execution-state");
  const executionParent = resolve(base, "executions");
  const sourceRoot = resolve(base, "sources");
  for (const path of [
    accountStateRoot,
    dacStateRoot,
    executionStateRoot,
    executionParent,
    sourceRoot,
  ]) {
    await mkdir(path);
    await chmod(path, 0o700);
  }
  const paths = {
    accountHelperPath: resolve(sourceRoot, "account.py"),
    candidateArtifactPath: resolve(sourceRoot, "candidate.mjs"),
    cleanupHelperPath: resolve(sourceRoot, "cleanup.py"),
    dacHelperPath: resolve(sourceRoot, "dac.py"),
    environmentPath: resolve(sourceRoot, "env"),
    pidfdHelperPath: resolve(sourceRoot, "pidfd.py"),
    rpcRunnerPath: resolve(sourceRoot, "rpc.mjs"),
    runtimePath: resolve(sourceRoot, "node"),
    setprivPath: resolve(sourceRoot, "setpriv"),
    sudoPath: resolve(sourceRoot, "sudo"),
  };
  for (const [path, bytes] of Object.entries(paths).map(([name, path]) => [path, name] as const))
    await writeFile(path, bytes, { mode: 0o600 });
  const options: LinuxIsolationAuthorityOptions = {
    account: { accountHelperPath: paths.accountHelperPath, stateRoot: accountStateRoot },
    dac: { dacHelperPath: paths.dacHelperPath, stateRoot: dacStateRoot },
    execution: {
      accountStateRoot,
      cleanupHelperPath: paths.cleanupHelperPath,
      executionParent,
      stateRoot: executionStateRoot,
    },
    process: { pidfdHelperPath: paths.pidfdHelperPath, stateRoot: accountStateRoot },
    profileReader: async () => profile,
    runtimePath: paths.runtimePath,
  };
  const principal: LinuxAccountPrincipal = Object.freeze({
    gid: "1100000001",
    intentPath: resolve(accountStateRoot, "linux-principal-intent-orch6-0000000000000001.json"),
    name: "orch6-0000000000000001",
    uid: "1000001",
  });
  return { base, options, paths, principal };
}

function terminal() {
  return { exitCode: 0, signal: null, stderr: "", stdout: '{"issues":[]}' };
}

function fakeDependencies(
  value: Awaited<ReturnType<typeof layout>>,
  events: string[],
  commands: LinuxCandidateLaunchCommand[],
  failOnce?: { phase: string; used: boolean },
  launch: (command: LinuxCandidateLaunchCommand) => Promise<unknown> = async (command) => {
    commands.push(command);
    events.push("launch");
    return terminal();
  },
  onQuiesce: () => void | Promise<void> = () => {},
) {
  const phase = async (name: string) => {
    events.push(name);
    if (failOnce && !failOnce.used && failOnce.phase === name) {
      failOnce.used = true;
      throw new Error(`failed:${name}`);
    }
  };
  return {
    accountFactory: async () => {
      events.push("recover:account");
      return {
        async createPrincipal() {
          await phase("account:create");
          return value.principal;
        },
        async deletePrincipal() {
          await phase("account:delete");
        },
        async recover() {
          await phase("account:recover-explicit");
        },
      };
    },
    dacFactory: async () => {
      events.push("recover:dac");
      return {
        async prepareAccess(input: {
          readonly principal: { readonly gid: string; readonly name: string; readonly uid: string };
        }) {
          expect(input.principal).toEqual({
            gid: value.principal.gid,
            name: value.principal.name,
            uid: value.principal.uid,
          });
          expect(Object.keys(input.principal).sort()).toEqual(["gid", "name", "uid"]);
          await phase("dac:prepare");
          return Object.freeze({ name: value.principal.name });
        },
        async recover() {
          await phase("dac:recover-explicit");
        },
        async restoreAccess() {
          await phase("dac:restore");
        },
      };
    },
    environmentPath: value.paths.environmentPath,
    executionFactory: async () => {
      events.push("recover:execution-construct");
      return {
        async cleanupAfterRevocation() {
          await phase("execution:cleanup");
        },
        async close() {
          await phase("execution:close");
        },
        async create(input: { readonly runtimePath: string }) {
          expect(input.runtimePath).toBe(value.paths.runtimePath);
          await phase("execution:create");
          const rootPath = resolve(
            value.options.execution.executionParent,
            "orch6-exec-0000000000000001",
          );
          return Object.freeze({
            candidateArtifactPath: resolve(rootPath, "candidate.mjs"),
            executionName: "orch6-exec-0000000000000001",
            rootPath,
            rpcRunnerPath: resolve(rootPath, "rpc-runner.mjs"),
            runtimePath: resolve(rootPath, "node"),
            scratchPath: resolve(rootPath, "scratch"),
          });
        },
        async recoverAfterRevocation() {
          await phase("recover:execution");
        },
      };
    },
    launchRunner: launch,
    processFactory: async () => {
      events.push("recover:process");
      return {
        async quiesce() {
          await phase("process:quiesce");
          await onQuiesce();
        },
        async recover() {
          await phase("process:recover-explicit");
        },
      };
    },
    setprivPath: value.paths.setprivPath,
    sudoPath: value.paths.sudoPath,
  };
}

async function authorityAt(
  value: Awaited<ReturnType<typeof layout>>,
  events: string[],
  commands: LinuxCandidateLaunchCommand[] = [],
  failOnce?: { phase: string; used: boolean },
  launch?: (command: LinuxCandidateLaunchCommand) => Promise<unknown>,
) {
  return await createLinuxIsolationAuthorityTestFixture(
    value.options,
    fakeDependencies(value, events, commands, failOnce, launch),
  );
}

function request(value: Awaited<ReturnType<typeof layout>>) {
  return Object.freeze({
    candidateArtifactPath: value.paths.candidateArtifactPath,
    inputText: '{"challenge":true}',
    rpcRunnerPath: value.paths.rpcRunnerPath,
    timeoutMilliseconds: 5000 as const,
  });
}

function nativeCommand(
  value: Awaited<ReturnType<typeof layout>>,
  source: string,
  ...arguments_: string[]
): LinuxCandidateLaunchCommand {
  return Object.freeze({
    arguments: Object.freeze(["--eval", source, ...arguments_]),
    cwd: value.base,
    file: process.execPath,
    inputText: "native-input",
    timeoutMilliseconds: 5000,
  });
}

describe("Linux stable isolation lifecycle composition", () => {
  test.runIf(process.platform !== "linux")(
    "production guard refuses before injected authority can be reached",
    async () => {
      const profileReader = vi.fn(async () => profile);
      await expect(
        createLinuxIsolationAuthority({
          account: { accountHelperPath: "C:/forged.py", stateRoot: "C:/account" },
          dac: { dacHelperPath: "C:/forged.py", stateRoot: "C:/dac" },
          execution: {
            accountStateRoot: "C:/account",
            cleanupHelperPath: "C:/forged.py",
            executionParent: "C:/executions",
            stateRoot: "C:/execution-state",
          },
          process: { pidfdHelperPath: "C:/forged.py", stateRoot: "C:/account" },
          profileReader,
          runtimePath: "C:/node.exe",
        }),
      ).rejects.toThrow("unsupported-platform");
      expect(profileReader).not.toHaveBeenCalled();
    },
  );

  test("recovers in process, DAC, execution, account dependency order", async () => {
    const value = await layout();
    const events: string[] = [];
    const authority = await authorityAt(value, events);
    expect(events).toEqual([
      "recover:process",
      "recover:dac",
      "recover:execution-construct",
      "recover:execution",
      "recover:account",
    ]);
    await authority.close();
  });

  test("keeps raw custody private and enforces exact launch and teardown order", async () => {
    const value = await layout();
    const events: string[] = [];
    const commands: LinuxCandidateLaunchCommand[] = [];
    const authority = await authorityAt(value, events, commands);
    events.splice(0);
    const handle = await authority.createPrincipal();
    expect(Object.getPrototypeOf(handle)).toBeNull();
    expect(Reflect.ownKeys(handle as object)).toEqual([]);
    await authority.prepare(handle, request(value));
    await expect(authority.launch(handle, request(value))).resolves.toEqual(terminal());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      file: value.paths.sudoPath,
      inputText: request(value).inputText,
      timeoutMilliseconds: 5000,
    });
    expect(commands[0]!.cwd).toBe(value.options.execution.executionParent);
    expect(commands[0]!.arguments.slice(0, 18)).toEqual([
      "-n",
      "-D",
      resolve(value.options.execution.executionParent, "orch6-exec-0000000000000001/scratch"),
      value.paths.setprivPath,
      "--reuid",
      value.principal.uid,
      "--regid",
      value.principal.gid,
      "--clear-groups",
      "--no-new-privs",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
      value.paths.environmentPath,
      "-i",
      "../node",
      "../rpc-runner.mjs",
      "./candidate.mjs",
    ]);
    expect(commands[0]!.arguments).toContain("--linux-principal");
    expect(commands[0]!.arguments).not.toContain(value.paths.candidateArtifactPath);
    expect(commands[0]!.arguments).not.toContain(value.paths.rpcRunnerPath);
    await authority.teardownPrincipal(handle);
    expect(events).toEqual([
      "account:create",
      "execution:create",
      "dac:prepare",
      "launch",
      "process:quiesce",
      "dac:restore",
      "dac:recover-explicit",
      "execution:cleanup",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  test("launch requires one exact stable preparation and refuses request substitution", async () => {
    const value = await layout();
    const events: string[] = [];
    const commands: LinuxCandidateLaunchCommand[] = [];
    const authority = await authorityAt(value, events, commands);
    const handle = await authority.createPrincipal();
    await expect(authority.launch(handle, request(value))).rejects.toThrow(
      "launch-preparation-refused",
    );
    await authority.prepare(handle, request(value));
    await expect(authority.prepare(handle, request(value))).rejects.toThrow(
      "preparation-reuse-refused",
    );
    await expect(
      authority.launch(handle, { ...request(value), inputText: '{"substituted":true}' }),
    ).rejects.toThrow("launch-preparation-refused");
    expect(commands).toEqual([]);
    await authority.launch(handle, request(value));
    await authority.teardownPrincipal(handle);
    await authority.close();
  });

  test("preparation failure tears down only already-created authority in dependency order", async () => {
    const value = await layout();
    const events: string[] = [];
    const failOnce = { phase: "dac:prepare", used: false };
    const authority = await authorityAt(value, events, [], failOnce);
    const handle = await authority.createPrincipal();
    events.splice(0);
    await expect(authority.prepare(handle, request(value))).rejects.toThrow("failed:dac:prepare");
    await authority.teardownPrincipal(handle);
    expect(events).toEqual([
      "execution:create",
      "dac:prepare",
      "process:quiesce",
      "dac:recover-explicit",
      "execution:cleanup",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  test("ambiguous execution creation runs recovery before account deletion", async () => {
    const value = await layout();
    const events: string[] = [];
    const failOnce = { phase: "none", used: false };
    const authority = await authorityAt(value, events, [], failOnce);
    const handle = await authority.createPrincipal();
    events.splice(0);
    failOnce.phase = "execution:create";
    await expect(authority.prepare(handle, request(value))).rejects.toThrow(
      "failed:execution:create",
    );
    await authority.teardownPrincipal(handle);
    expect(events).toEqual([
      "execution:create",
      "process:quiesce",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  for (const failedPhase of [
    "process:quiesce",
    "dac:restore",
    "dac:recover-explicit",
    "execution:cleanup",
    "recover:execution",
    "account:delete",
  ])
    test(`retains teardown authority and ordering when ${failedPhase} fails`, async () => {
      const value = await layout();
      const events: string[] = [];
      const failOnce = { phase: "none", used: false };
      const authority = await authorityAt(value, events, [], failOnce);
      const handle = await authority.createPrincipal();
      await authority.prepare(handle, request(value));
      await authority.launch(handle, request(value));
      events.splice(0);
      failOnce.phase = failedPhase;
      await expect(authority.teardownPrincipal(handle)).rejects.toThrow(`failed:${failedPhase}`);
      const failedIndex = events.indexOf(failedPhase);
      expect(failedIndex).toBeGreaterThanOrEqual(0);
      const teardownOrder = [
        "process:quiesce",
        "dac:restore",
        "dac:recover-explicit",
        "execution:cleanup",
        "recover:execution",
        "account:delete",
      ];
      const later = teardownOrder.slice(teardownOrder.indexOf(failedPhase) + 1);
      for (const phase of later) expect(events).not.toContain(phase);
      await authority.teardownPrincipal(handle);
      expect(events.at(-1)).toBe("account:delete");
      await authority.close();
    });

  test("records terminal root exit before rejecting post-launch helper movement", async () => {
    const value = await layout();
    const events: string[] = [];
    let moved = false;
    value.options = {
      ...value.options,
      profileReader: async () => (moved ? { ...profile, inode: "4" } : profile),
    };
    const authority = await authorityAt(value, events, [], undefined, async () => {
      moved = true;
      return terminal();
    });
    const handle = await authority.createPrincipal();
    await authority.prepare(handle, request(value));
    await expect(authority.launch(handle, request(value))).rejects.toThrow("launch-helper-moved");
    moved = false;
    await authority.teardownPrincipal(handle);
    expect(events.slice(-6)).toEqual([
      "process:quiesce",
      "dac:restore",
      "dac:recover-explicit",
      "execution:cleanup",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  test("malformed launch result refuses evidence but still permits ordered recovery teardown", async () => {
    const value = await layout();
    const events: string[] = [];
    const authority = await authorityAt(value, events, [], undefined, async () => ({ ok: true }));
    const handle = await authority.createPrincipal();
    await authority.prepare(handle, request(value));
    await expect(authority.launch(handle, request(value))).rejects.toThrow(
      "terminal-observation-refused",
    );
    events.splice(0);
    await authority.teardownPrincipal(handle);
    expect(events).toEqual([
      "process:quiesce",
      "dac:restore",
      "dac:recover-explicit",
      "execution:cleanup",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  test("native runner returns only after clean terminal stdout, stderr, and inherited pipe close", async () => {
    const value = await layout();
    const result = await runLinuxCandidateCommandTestFixture(
      nativeCommand(
        value,
        `
const { spawn } = require("node:child_process");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write("root:" + input);
  process.stderr.write("root-stderr");
  const descendant = spawn(process.execPath, ["--eval", "setTimeout(() => process.stdout.write(' descendant'), 100)"], {
    detached: true,
    env: {},
    stdio: ["ignore", "inherit", "inherit"],
  });

  descendant.unref();
  process.exit(0);
});
`,
      ),
    );
    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "root-stderr",
      stdout: "root:native-input descendant",
    });
  });

  test("post-spawn error cannot settle launch or permit DAC before delayed close", async () => {
    const value = await layout();
    const events: string[] = [];
    class FakeChild extends EventEmitter {
      readonly stderr = new PassThrough();
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      readonly kill = vi.fn(() => false);
    }
    const child = new FakeChild();
    const spawnMock = vi.fn(() => child);
    const spawnChild = spawnMock as unknown as typeof import("node:child_process").spawn;
    const launch = async () =>
      await runLinuxCandidateCommandTestFixture(
        nativeCommand(value, "process.exit(0);"),
        spawnChild,
      );
    const authority = await createLinuxIsolationAuthorityTestFixture(
      value.options,
      fakeDependencies(value, events, [], undefined, launch),
    );
    const handle = await authority.createPrincipal();
    await authority.prepare(handle, request(value));
    events.splice(0);
    const pendingLaunch = authority.launch(handle, request(value));
    const launchRefusal = expect(pendingLaunch).rejects.toThrow("post-spawn kill failed");
    while (!spawnMock.mock.calls.length) await Promise.resolve();
    child.emit("error", new Error("post-spawn kill failed"));
    let launchSettled = false;
    void pendingLaunch.then(
      () => {
        launchSettled = true;
      },
      () => {
        launchSettled = true;
      },
    );
    await Promise.resolve();
    expect(launchSettled).toBe(false);

    const pendingTeardown = authority.teardownPrincipal(handle);
    const teardownResult = expect(pendingTeardown).resolves.toBeUndefined();
    await Promise.resolve();
    expect(events).toEqual(["process:quiesce"]);
    expect(events).not.toContain("dac:restore");

    child.emit("close", null, null);
    await launchRefusal;
    await teardownResult;
    expect(events.slice(-5)).toEqual([
      "dac:restore",
      "dac:recover-explicit",
      "execution:cleanup",
      "recover:execution",
      "account:delete",
    ]);
    await authority.close();
  });

  for (const stream of ["stdout", "stderr"] as const)
    test(`native runner bounds oversize ${stream} before terminal return`, async () => {
      const value = await layout();
      const result = await runLinuxCandidateCommandTestFixture(
        nativeCommand(value, `process.${stream}.write("x".repeat(4 * 1024 * 1024 + 1));`),
      );
      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe("OUTPUT_LIMIT");
      expect(Buffer.byteLength(result[stream], "utf8")).toBeLessThanOrEqual(4 * 1024 * 1024);
    });

  test("privileged UID quiescence bounds a hanging or descendant-held launch pipe", async () => {
    vi.useFakeTimers();
    try {
      for (const source of [
        `
const { existsSync } = require("node:fs");
setInterval(() => { if (existsSync(process.argv[1])) process.exit(0); }, 10);
`,
        `
const { spawn } = require("node:child_process");
const childSource = 'const { existsSync } = require("node:fs"); setInterval(() => { if (existsSync(process.argv[1])) process.exit(0); }, 10);';
const descendant = spawn(process.execPath, ["--eval", childSource, process.argv[1]], {
  detached: true,
  env: {},
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
process.exit(0);
`,
      ]) {
        const value = await layout();
        const events: string[] = [];
        const marker = resolve(value.base, "quiesced");
        const launch = async () =>
          await runLinuxCandidateCommandTestFixture(nativeCommand(value, source, marker));
        const dependencies = fakeDependencies(
          value,
          events,
          [],
          undefined,
          launch,
          async () => await writeFile(marker, "quiesced"),
        );
        const authority = await createLinuxIsolationAuthorityTestFixture(
          value.options,
          dependencies,
        );
        const handle = await authority.createPrincipal();
        await authority.prepare(handle, request(value));
        events.splice(0);
        const pending = authority.launch(handle, request(value));
        await vi.advanceTimersByTimeAsync(5000);
        await expect(pending).resolves.toMatchObject({ exitCode: null, signal: "TIMEOUT" });
        expect(events).toEqual(["process:quiesce"]);
        await authority.teardownPrincipal(handle);
        expect(events.slice(-6)).toEqual([
          "process:quiesce",
          "dac:restore",
          "dac:recover-explicit",
          "execution:cleanup",
          "recover:execution",
          "account:delete",
        ]);
        await authority.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("watchdog quiescence failure refuses launch and teardown retries custody", async () => {
    vi.useFakeTimers();
    try {
      const value = await layout();
      const events: string[] = [];
      const failOnce = { phase: "none", used: false };
      let release: ((value: unknown) => void) | undefined;
      const dependencies = fakeDependencies(
        value,
        events,
        [],
        failOnce,
        async () =>
          await new Promise<unknown>((resolvePromise) => {
            release = resolvePromise;
          }),
      );
      const authority = await createLinuxIsolationAuthorityTestFixture(value.options, dependencies);
      const handle = await authority.createPrincipal();
      await authority.prepare(handle, request(value));
      failOnce.phase = "process:quiesce";
      const pending = authority.launch(handle, request(value));
      const refusal = expect(pending).rejects.toThrow("failed:process:quiesce");
      await vi.advanceTimersByTimeAsync(5000);
      await refusal;
      const teardown = authority.teardownPrincipal(handle);
      const teardownResult = expect(teardown).resolves.toBeUndefined();
      await Promise.resolve();
      expect(events.slice(-1)).toEqual(["process:quiesce"]);
      expect(events).not.toContain("dac:restore");
      release?.(terminal());
      await teardownResult;
      expect(events.at(-1)).toBe("account:delete");
      await authority.close();
    } finally {
      vi.useRealTimers();
    }
  });

  test("oversize terminal output refuses before evidence and cleanup remains available", async () => {
    const value = await layout();
    const events: string[] = [];
    const authority = await authorityAt(value, events, [], undefined, async () => ({
      ...terminal(),
      stdout: "x".repeat(4 * 1024 * 1024 + 1),
    }));
    const handle = await authority.createPrincipal();
    await authority.prepare(handle, request(value));
    await expect(authority.launch(handle, request(value))).rejects.toThrow(
      "terminal-observation-refused",
    );
    await authority.teardownPrincipal(handle);
    await authority.close();
  });

  test("rejects cross-custody root mismatch and nesting before factories", async () => {
    const value = await layout();
    const events: string[] = [];
    for (const mismatched of [
      {
        ...value.options,
        process: { ...value.options.process, stateRoot: value.options.dac.stateRoot },
      },
      {
        ...value.options,
        execution: {
          ...value.options.execution,
          accountStateRoot: value.options.dac.stateRoot,
        },
      },
    ]) {
      await expect(
        createLinuxIsolationAuthorityTestFixture(mismatched, fakeDependencies(value, events, [])),
      ).rejects.toThrow("account-state-composition-refused");
      expect(events).toEqual([]);
    }

    const accountRoot = value.options.account.stateRoot;
    const dacRoot = value.options.dac.stateRoot;
    const executionStateRoot = value.options.execution.stateRoot;
    const executionParent = value.options.execution.executionParent;
    const nested = {
      accountInDac: resolve(dacRoot, "account-state"),
      dacInAccount: resolve(accountRoot, "dac-state"),
      dacInExecutionParent: resolve(executionParent, "dac-state"),
      dacInExecutionState: resolve(executionStateRoot, "dac-state"),
      executionParentInDac: resolve(dacRoot, "executions"),
      executionStateInDac: resolve(dacRoot, "execution-state"),
    };
    for (const path of Object.values(nested)) {
      await mkdir(path);
      await chmod(path, 0o700);
    }
    const accountAt = (root: string): LinuxIsolationAuthorityOptions => ({
      ...value.options,
      account: { ...value.options.account, stateRoot: root },
      execution: { ...value.options.execution, accountStateRoot: root },
      process: { ...value.options.process, stateRoot: root },
    });
    const separated: LinuxIsolationAuthorityOptions[] = [
      { ...value.options, dac: { ...value.options.dac, stateRoot: accountRoot } },
      { ...value.options, dac: { ...value.options.dac, stateRoot: executionStateRoot } },
      { ...value.options, dac: { ...value.options.dac, stateRoot: executionParent } },
      { ...value.options, dac: { ...value.options.dac, stateRoot: nested.dacInAccount } },
      accountAt(nested.accountInDac),
      {
        ...value.options,
        dac: { ...value.options.dac, stateRoot: nested.dacInExecutionState },
      },
      {
        ...value.options,
        execution: { ...value.options.execution, stateRoot: nested.executionStateInDac },
      },
      {
        ...value.options,
        dac: { ...value.options.dac, stateRoot: nested.dacInExecutionParent },
      },
      {
        ...value.options,
        execution: { ...value.options.execution, executionParent: nested.executionParentInDac },
      },
    ];
    for (const options of separated) {
      await expect(
        createLinuxIsolationAuthorityTestFixture(options, fakeDependencies(value, events, [])),
      ).rejects.toThrow("root-separation-refused");
      expect(events).toEqual([]);
    }
  });

  test("rejects aliased or hostile launch-helper profiles before recovery factories", async () => {
    const value = await layout();
    const events: string[] = [];
    await expect(
      createLinuxIsolationAuthorityTestFixture(
        { ...value.options, runtimePath: value.paths.setprivPath },
        fakeDependencies(value, events, []),
      ),
    ).rejects.toThrow("launch-helper-alias-refused");
    expect(events).toEqual([]);

    let trapCalls = 0;
    const hostile = new Proxy(profile, {
      ownKeys() {
        trapCalls += 1;
        throw new Error("profile trap");
      },
    });
    await expect(
      createLinuxIsolationAuthorityTestFixture(
        { ...value.options, profileReader: async () => hostile },
        fakeDependencies(value, events, []),
      ),
    ).rejects.toThrow("launch-helper-profile-refused");
    expect(trapCalls).toBe(0);
    expect(events).toEqual([]);
  });

  test("keeps Linux isolation composition off the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(publicSurface).not.toHaveProperty("createLinuxIsolationAuthority");
  });
});

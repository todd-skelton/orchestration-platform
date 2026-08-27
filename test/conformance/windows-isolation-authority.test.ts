import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { build } from "esbuild";
import * as packageRoot from "../../packages/conformance/src/index.js";
import {
  createIss002WalkChallenge,
  runIss002IsolatedWalk,
} from "../../packages/conformance/src/isolated-walk.js";

const authorityPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/windows-isolation-authority.ts",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

async function exactRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.push(root);
  const account = spawnSync("whoami.exe", { encoding: "utf8", windowsHide: true });
  if (account.status !== 0) throw new Error(`whoami failed: ${account.stderr}`);
  for (const args of [
    [root, "/inheritance:r"],
    [root, "/grant:r", "SYSTEM:(OI)(CI)F", `${account.stdout.trim()}:(OI)(CI)F`],
    [root, "/setintegritylevel", "(OI)(CI)M"],
  ]) {
    const result = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(`icacls failed: ${result.stderr}`);
  }
  return root;
}

async function exactFile(path: string): Promise<void> {
  const account = spawnSync("whoami.exe", { encoding: "utf8", windowsHide: true });
  if (account.status !== 0) throw new Error(`whoami failed: ${account.stderr}`);
  for (const args of [
    [path, "/inheritance:r"],
    [path, "/grant:r", "SYSTEM:F", `${account.stdout.trim()}:F`],
    [path, "/setintegritylevel", "M"],
  ]) {
    const result = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(`icacls failed: ${result.stderr}`);
  }
}

async function protectedAuthorityModule(): Promise<
  typeof import("../../packages/conformance/src/windows-isolation-authority.js")
> {
  const root = await exactRoot("orchestration-windows-authority-bundle-");
  const source = resolve(root, "windows-isolation-broker.c");
  const image = resolve(root, "windows-isolation-broker-x64.exe");
  const authority = resolve(root, "windows-isolation-authority.mjs");
  await Promise.all([
    copyFile(
      resolve(import.meta.dirname, "../../packages/conformance/src/windows-isolation-broker.c"),
      source,
    ),
    copyFile(
      resolve(
        import.meta.dirname,
        "../../packages/conformance/src/windows-isolation-broker-x64.exe",
      ),
      image,
    ),
  ]);
  await build({
    bundle: true,
    entryPoints: [authorityPath],
    format: "esm",
    outfile: authority,
    platform: "node",
    target: "node24",
  });
  await Promise.all([source, image, authority].map(exactFile));
  return await import(`${pathToFileURL(authority).href}?custody=1`);
}

async function parserModule(): Promise<{
  requirePreparePayload(payload: Buffer, executionParent: string): void;
  terminalObservation(payload: Buffer): unknown;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-authority-parser-"));
  temporaryRoots.push(root);
  const output = resolve(root, "parser.mjs");
  await build({
    bundle: true,
    entryPoints: [authorityPath],
    footer: {
      js: "export { requirePreparePayload, terminalObservation };",
    },
    format: "esm",
    outfile: output,
    platform: "node",
    target: "node24",
  });
  return (await import(`${pathToFileURL(output).href}?parser=1`)) as {
    requirePreparePayload(payload: Buffer, executionParent: string): void;
    terminalObservation(payload: Buffer): unknown;
  };
}

async function brokerCommandModule(): Promise<{
  abortThenRecover(
    broker: { hardAbort(): Promise<void> },
    stateRoot: string,
  ): Promise<{
    readonly abortFailure: unknown | undefined;
    readonly recoveryFailure: unknown | undefined;
  }>;
  BrokerCommand: new (mode: "RECOVER" | "SERVE") => {
    hardAbort(): Promise<void>;
    settle(expectedCode: number): Promise<void>;
    write(bytes: Buffer, end: boolean): Promise<void>;
  };
  runRecovery(stateRoot: string): Promise<void>;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-command-owner-"));
  temporaryRoots.push(root);
  const output = resolve(root, "command-owner.mjs");
  const childProcessFixture = resolve(
    import.meta.dirname,
    "windows-authority-child-process-fixture.mjs",
  );
  await build({
    bundle: true,
    entryPoints: [authorityPath],
    footer: { js: "export { abortThenRecover, BrokerCommand, runRecovery };" },
    format: "esm",
    outfile: output,
    platform: "node",
    plugins: [
      {
        name: "fixed-child-process-fixture",
        setup(context) {
          context.onResolve({ filter: /^node:child_process$/ }, () => ({
            path: childProcessFixture,
          }));
        },
      },
    ],
    target: "node24",
  });
  return (await import(`${pathToFileURL(output).href}?command=1`)) as {
    abortThenRecover(
      broker: { hardAbort(): Promise<void> },
      stateRoot: string,
    ): Promise<{
      readonly abortFailure: unknown | undefined;
      readonly recoveryFailure: unknown | undefined;
    }>;
    BrokerCommand: new (mode: "RECOVER" | "SERVE") => {
      hardAbort(): Promise<void>;
      settle(expectedCode: number): Promise<void>;
      write(bytes: Buffer, end: boolean): Promise<void>;
    };
    runRecovery(stateRoot: string): Promise<void>;
  };
}

class FakeBrokerChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly failOutput: boolean;
  readonly omitEnd: "BOTH" | "DIAGNOSTIC" | "NONE" | "OUTPUT";

  constructor(failOutput = false, omitEnd: "BOTH" | "DIAGNOSTIC" | "NONE" | "OUTPUT" = "NONE") {
    super();
    this.failOutput = failOutput;
    this.omitEnd = omitEnd;
  }

  kill(): boolean {
    this.signalCode = "SIGTERM";
    if (this.failOutput) this.stdout.emit("error", new Error("output failed"));
    if (this.omitEnd !== "OUTPUT" && this.omitEnd !== "BOTH") this.stdout.end();
    if (this.omitEnd !== "DIAGNOSTIC" && this.omitEnd !== "BOTH") this.stderr.end();
    queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    return true;
  }

  closeNormally(stderr = ""): void {
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end(stderr);
    queueMicrotask(() => this.emit("close", 0, null));
  }
}

class RecoveryBrokerChild extends FakeBrokerChild {
  constructor(succeed = true) {
    super();
    this.stdin.once("finish", () => {
      const response = Buffer.alloc(16);
      response.write("OPWB", 0, "ascii");
      response[4] = 1;
      response[5] = 2;
      response[6] = 3;
      response[7] = succeed ? 0 : 65;
      this.stdout.end(response);
      this.stderr.end();
      this.exitCode = succeed ? 0 : 65;
      queueMicrotask(() => this.emit("close", this.exitCode, null));
    });
  }
}

class OrderedAbortChild extends FakeBrokerChild {
  readonly events: string[];

  constructor(events: string[]) {
    super(false, "BOTH");
    this.events = events;
    this.once("close", () => events.push("ABORT_CLOSE"));
  }

  override kill(): boolean {
    this.events.push("ABORT_KILL");
    return super.kill();
  }
}

function validPreparePayload(executionParent: string): Buffer {
  const token = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const moniker = Buffer.from(`orch6-${token.subarray(0, 29).toString("hex")}`, "ascii");
  const sid = Buffer.alloc(16);
  sid[0] = 1;
  sid[1] = 2;
  sid[7] = 15;
  sid.writeUInt32LE(2, 8);
  sid.writeUInt32LE(123, 12);
  const sidText = Buffer.from("S-1-15-2-123", "ascii");
  const folder = Buffer.from("\\\\?\\C:\\profile", "utf16le");
  const execution = Buffer.from(`${executionParent}\\orch6-execution-${"a".repeat(64)}`, "utf16le");
  const payload = Buffer.alloc(
    104 +
      2 +
      sid.byteLength +
      2 +
      sidText.byteLength +
      2 +
      folder.byteLength +
      2 +
      execution.byteLength +
      32,
  );
  payload.write("OPWR", 0, "ascii");
  payload[4] = 1;
  payload[5] = 2;
  token.copy(payload, 8);
  moniker.copy(payload, 40);
  let cursor = 104;
  payload.writeUInt16LE(sid.byteLength, cursor);
  cursor += 2;
  sid.copy(payload, cursor);
  cursor += sid.byteLength;
  payload.writeUInt16LE(sidText.byteLength, cursor);
  cursor += 2;
  sidText.copy(payload, cursor);
  cursor += sidText.byteLength;
  payload.writeUInt16LE(folder.byteLength / 2, cursor);
  cursor += 2;
  folder.copy(payload, cursor);
  cursor += folder.byteLength;
  payload.writeUInt16LE(execution.byteLength / 2, cursor);
  cursor += 2;
  execution.copy(payload, cursor);
  cursor += execution.byteLength;
  Buffer.alloc(32, 7).copy(payload, cursor);
  return payload;
}

describe("private Windows isolation authority boundary", () => {
  test("keeps the authority private and fixes the tracked two-mode broker", async () => {
    expect("createWindowsIsolationAuthority" in packageRoot).toBe(false);
    const source = await readFile(authorityPath, "utf8");
    expect(source).toContain('new BrokerCommand("RECOVER")');
    expect(source).toContain('new BrokerCommand("SERVE")');
    expect(source).not.toMatch(/new BrokerCommand\("(?!RECOVER|SERVE)/);
    for (const forbidden of ["repository_dispatch", "receipt", "PASS"])
      expect(source).not.toContain(forbidden);
    expect(source.match(/\bspawn\(/g)).toHaveLength(1);
    expect(source).toContain("spawn(imagePath, [mode]");
  });

  test.runIf(process.platform !== "win32")("refuses off Windows before options", async () => {
    const { createWindowsIsolationAuthority } =
      await import("../../packages/conformance/src/windows-isolation-authority.js");
    const hostile = Object.defineProperty({}, "stateRoot", {
      get() {
        throw new Error("options were read");
      },
    });
    await expect(createWindowsIsolationAuthority(hostile as never)).rejects.toThrow(
      "windows-isolation:unsupported-platform",
    );
  });

  test("strictly binds native preparation and terminal payloads", async () => {
    const parser = await parserModule();
    const executionParent = "\\\\?\\C:\\execution";
    const prepared = validPreparePayload(executionParent);
    const sidMismatch = Buffer.from(prepared);
    const sidTextOffset = sidMismatch.indexOf(Buffer.from("S-1-15-2-123", "ascii"));
    expect(sidTextOffset).toBeGreaterThan(0);
    sidMismatch[sidTextOffset + "S-1-15-2-123".length - 1] = 0x34;
    expect(() => parser.requirePreparePayload(prepared, executionParent)).not.toThrow();
    for (const mutant of [
      Buffer.concat([prepared, Buffer.from([0])]),
      Buffer.from(prepared).fill(0, 40, 41),
      Buffer.from(prepared).fill(0, 122, 123),
      sidMismatch,
    ])
      expect(() => parser.requirePreparePayload(mutant, executionParent)).toThrow();
    expect(() => parser.requirePreparePayload(prepared, "\\\\?\\C:\\other")).toThrow(
      "windows-isolation:broker-execution-root-refused",
    );
    expect(() =>
      parser.requirePreparePayload(
        validPreparePayload(`${executionParent}\\intervening`),
        executionParent,
      ),
    ).toThrow("windows-isolation:broker-execution-root-refused");

    const terminal = Buffer.alloc(18);
    terminal.writeUInt32LE(0, 4);
    terminal.writeUInt32LE(1, 8);
    terminal.writeUInt32LE(1, 12);
    terminal[16] = 0x6f;
    terminal[17] = 0x65;
    expect(parser.terminalObservation(terminal)).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "e",
      stdout: "o",
    });
    for (const mutant of [
      Buffer.from(terminal).fill(1, 1, 2),
      Buffer.from(terminal).fill(2, 0, 1),
      Buffer.from(terminal).fill(0xff, 16, 17),
      Buffer.concat([terminal, Buffer.from([0])]),
    ])
      expect(() => parser.terminalObservation(mutant)).toThrow();
    const timeout = Buffer.alloc(16);
    timeout[0] = 1;
    expect(parser.terminalObservation(timeout)).toEqual({
      exitCode: null,
      signal: "TIMEOUT",
      stderr: "",
      stdout: "",
    });
  });

  test("owns close-bound abort and late control-pipe failures", async () => {
    const module = await brokerCommandModule();
    const globalWithSpawn = globalThis as typeof globalThis & {
      __orchestrationWindowsAuthoritySpawn?: (...arguments_: readonly unknown[]) => FakeBrokerChild;
    };
    try {
      let child = new FakeBrokerChild();
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => child;
      const clean = new module.BrokerCommand("SERVE");
      await expect(clean.hardAbort()).resolves.toBeUndefined();

      child = new FakeBrokerChild(true);
      const failedDrain = new module.BrokerCommand("SERVE");
      await expect(failedDrain.hardAbort()).rejects.toThrow(
        "windows-isolation:broker-drain-refused",
      );

      const outputMissingChild = new FakeBrokerChild(false, "OUTPUT");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => outputMissingChild;
      const outputMissing = new module.BrokerCommand("SERVE");
      const diagnosticMissingChild = new FakeBrokerChild(false, "DIAGNOSTIC");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => diagnosticMissingChild;
      const diagnosticMissing = new module.BrokerCommand("SERVE");
      const bothMissingChild = new FakeBrokerChild(false, "BOTH");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => bothMissingChild;
      const bothMissing = new module.BrokerCommand("SERVE");
      const errorAndTimeoutChild = new FakeBrokerChild(true, "DIAGNOSTIC");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => errorAndTimeoutChild;
      const errorAndTimeout = new module.BrokerCommand("SERVE");
      const capture = async (promise: Promise<void>) => {
        try {
          await promise;
          throw new Error("expected command refusal");
        } catch (error) {
          return error as { readonly errors: readonly unknown[]; readonly message: string };
        }
      };
      const [outputError, diagnosticError, bothError, combinedError] = await Promise.all([
        capture(outputMissing.hardAbort()),
        capture(diagnosticMissing.hardAbort()),
        capture(bothMissing.hardAbort()),
        capture(errorAndTimeout.hardAbort()),
      ]);
      expect(
        [outputError, diagnosticError, bothError, combinedError].map((error) => ({
          errors: error.errors.map((nested) => (nested as Error).message),
          message: error.message,
        })),
      ).toEqual([
        {
          errors: ["windows-isolation:broker-output-end-timeout"],
          message: "windows-isolation:broker-drain-refused",
        },
        {
          errors: ["windows-isolation:broker-diagnostic-end-timeout"],
          message: "windows-isolation:broker-drain-refused",
        },
        {
          errors: [
            "windows-isolation:broker-output-end-timeout",
            "windows-isolation:broker-diagnostic-end-timeout",
          ],
          message: "windows-isolation:broker-drain-refused",
        },
        {
          errors: [
            "windows-isolation:broker-output-trailing",
            "windows-isolation:broker-diagnostic-end-timeout",
          ],
          message: "windows-isolation:broker-drain-refused",
        },
      ]);

      const recovery = new RecoveryBrokerChild();
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => recovery;
      await expect(module.runRecovery("\\\\?\\C:\\state")).resolves.toBeUndefined();

      const successfulEvents: string[] = [];
      const successfulAbortChild = new OrderedAbortChild(successfulEvents);
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => successfulAbortChild;
      const successfulAbort = new module.BrokerCommand("SERVE");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => {
        successfulEvents.push("RECOVER_SPAWN");
        return new RecoveryBrokerChild();
      };
      const successfulComposition = await module.abortThenRecover(
        successfulAbort,
        "\\\\?\\C:\\state",
      );
      expect(successfulEvents).toEqual(["ABORT_KILL", "ABORT_CLOSE", "RECOVER_SPAWN"]);
      expect(successfulComposition.abortFailure).toBeInstanceOf(AggregateError);
      expect(successfulComposition.recoveryFailure).toBeUndefined();

      const failedEvents: string[] = [];
      const failedAbortChild = new OrderedAbortChild(failedEvents);
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => failedAbortChild;
      const failedAbort = new module.BrokerCommand("SERVE");
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => {
        failedEvents.push("RECOVER_SPAWN");
        return new RecoveryBrokerChild(false);
      };
      const failedComposition = await module.abortThenRecover(failedAbort, "\\\\?\\C:\\state");
      expect(failedEvents).toEqual(["ABORT_KILL", "ABORT_CLOSE", "RECOVER_SPAWN"]);
      expect(failedComposition.abortFailure).toBeInstanceOf(AggregateError);
      expect(failedComposition.recoveryFailure).toBeInstanceOf(TypeError);

      child = new FakeBrokerChild();
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => child;
      const lateDiagnostic = new module.BrokerCommand("RECOVER");
      child.closeNormally("late diagnostic");
      await expect(lateDiagnostic.settle(0)).rejects.toThrow(
        "windows-isolation:broker-drain-refused",
      );

      child = new FakeBrokerChild();
      globalWithSpawn.__orchestrationWindowsAuthoritySpawn = () => child;
      const failedInput = new module.BrokerCommand("RECOVER");
      child.stdin.destroy(new Error("input failed"));
      await expect(failedInput.write(Buffer.from([1]), true)).rejects.toThrow();
      child.kill();
    } finally {
      delete globalWithSpawn.__orchestrationWindowsAuthoritySpawn;
    }
  });

  test.runIf(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.env.OP_WINDOWS_ISOLATION_AUTHORITY_DIAGNOSTIC === "1",
  )(
    "runs three real production cycles without producing authority",
    async () => {
      const stateRoot = await exactRoot("orchestration-windows-authority-state-");
      const executionParent = await exactRoot("orchestration-windows-authority-execution-");
      const sources = await exactRoot("orchestration-windows-authority-sources-");
      const runtimePath = resolve(sources, "node-source.exe");
      const rpcRunnerPath = resolve(sources, "rpc-source.mjs");
      const candidateArtifactPath = resolve(sources, "candidate-source.mjs");
      await copyFile(process.execPath, runtimePath);
      await copyFile(
        resolve(
          import.meta.dirname,
          "../../packages/conformance/src/iss002-isolated-walk-child.mjs",
        ),
        rpcRunnerPath,
      );
      await writeFile(
        candidateArtifactPath,
        "export function validateAuthorityHistoryChain() { return []; }\n",
      );
      await Promise.all([runtimePath, rpcRunnerPath, candidateArtifactPath].map(exactFile));
      const { createWindowsIsolationAuthority } = await protectedAuthorityModule();
      const authority = await createWindowsIsolationAuthority({
        executionParent,
        runtimePath,
        stateRoot,
      });
      const result = await runIss002IsolatedWalk(
        Object.freeze({ candidateArtifactPath, rpcRunnerPath }),
        authority,
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result).not.toHaveProperty("receipt");
      expect(result).not.toHaveProperty("authority");
      expect(result).not.toHaveProperty("promotion");

      const request = Object.freeze({
        candidateArtifactPath,
        inputText: createIss002WalkChallenge().inputText,
        rpcRunnerPath,
        timeoutMilliseconds: 5000 as const,
      });
      const failed = await authority.createPrincipal();
      await expect(authority.createPrincipal()).rejects.toThrow(
        "windows-isolation:active-principal-refused",
      );
      await expect(
        authority.prepare(
          failed,
          Object.freeze({ ...request, timeoutMilliseconds: 4999 }) as never,
        ),
      ).rejects.toThrow("windows-isolation:launch-request-refused");
      await expect(authority.launch(failed, request)).rejects.toThrow(
        "windows-isolation:launch-order-refused",
      );
      await authority.teardownPrincipal(failed);

      const prepared = await authority.createPrincipal();
      const preparation = authority.prepare(prepared, request);
      await expect(authority.prepare(prepared, request)).rejects.toThrow(
        "windows-isolation:operation-overlap-refused",
      );
      await preparation;
      const teardown = authority.teardownPrincipal(prepared);
      await expect(authority.teardownPrincipal(prepared)).rejects.toThrow(
        "windows-isolation:operation-overlap-refused",
      );
      await teardown;
    },
    240_000,
  );
});

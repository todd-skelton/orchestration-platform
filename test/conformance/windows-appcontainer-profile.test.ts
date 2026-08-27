import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { createIss002WalkChallenge } from "../../packages/conformance/src/isolated-walk.js";

const imagePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/windows-isolation-broker-x64.exe",
);
const buildPath = resolve(import.meta.dirname, "../../scripts/build/windows-isolation-broker.mjs");
const fixturePath = resolve(import.meta.dirname, "windows-isolation-broker-fixture.c");
const rpcRunnerSourcePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/iss002-isolated-walk-child.mjs",
);
const clangPath = "C:/Program Files/LLVM/bin/clang-cl.exe";
const linkerPath = "C:/Program Files/LLVM/bin/lld-link.exe";
const sdkLibraryPath = "C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64";
const sdkLibraries = [
  "kernel32.lib",
  "userenv.lib",
  "api-ms-win-net-isolation-l1-1-0.lib",
  "advapi32.lib",
  "ole32.lib",
  "bcrypt.lib",
];

const profileScope = (path: string): Buffer => {
  const pathBytes = Buffer.from(path, "utf16le");
  const payload = Buffer.alloc(12 + pathBytes.byteLength);
  payload.write("OPWP", 0, "ascii");
  payload[4] = 1;
  payload[5] = 1;
  payload.writeUInt16LE(path.length, 8);
  pathBytes.copy(payload, 12);
  return payload;
};

const executionPrepare = (paths: readonly [string, string, string, string, string]): Buffer => {
  const values = paths.map((path) => Buffer.from(path, "utf16le"));
  const payload = Buffer.alloc(20 + values.reduce((total, value) => total + value.byteLength, 0));
  payload.write("OPWE", 0, "ascii");
  payload[4] = 1;
  payload[5] = 1;
  let cursor = 20;
  for (const [index, value] of values.entries()) {
    payload.writeUInt16LE(paths[index]!.length, 8 + index * 2);
    value.copy(payload, cursor);
    cursor += value.byteLength;
  }
  return payload;
};

const frame = (operation: number, payload: Buffer<ArrayBufferLike> = Buffer.alloc(0)): Buffer => {
  const result = Buffer.alloc(16 + payload.byteLength);
  result.write("OPWB", 0, "ascii");
  result[4] = 1;
  result[5] = 1;
  result[6] = operation;
  result.writeUInt32LE(payload.byteLength, 8);
  payload.copy(result, 16);
  return result;
};

const readExactly = async (
  output: NodeJS.ReadableStream & {
    read(size?: number): string | Buffer | null;
    readableLength: number;
  },
  length: number,
): Promise<Buffer> => {
  while (output.readableLength < length) await once(output, "readable");
  const result = output.read(length);
  if (!Buffer.isBuffer(result) || result.byteLength !== length)
    throw new Error("short broker output");
  return result;
};

const readResponse = async (
  output: NodeJS.ReadableStream & {
    read(size?: number): string | Buffer | null;
    readableLength: number;
  },
) => {
  const header = await readExactly(output, 16);
  expect(header.subarray(0, 4).toString("ascii")).toBe("OPWB");
  expect(header[4]).toBe(1);
  expect(header[5]).toBe(2);
  expect(header.readUInt32LE(12)).toBe(0);
  const length = header.readUInt32LE(8);
  return { header, payload: length === 0 ? Buffer.alloc(0) : await readExactly(output, length) };
};

const closeProcess = async (child: ReturnType<typeof spawn>): Promise<number | null> => {
  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  return code;
};

const sha256File = async (path: string): Promise<string> =>
  await new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });

type ExactCustody = Readonly<{
  access: ReadonlyArray<
    Readonly<{ inherited: boolean; rights: number; sid: string; type: string }>
  >;
  owner: string;
  protected: boolean;
  streams: ReadonlyArray<Readonly<{ length: number; name: string }>>;
}>;

const inspectExactCustody = (path: string, stableAccount: string): ExactCustody => {
  const script = [
    "$acl=if ([System.IO.Directory]::Exists($env:OP_CUSTODY_PATH)) { [System.IO.Directory]::GetAccessControl($env:OP_CUSTODY_PATH) } else { [System.IO.File]::GetAccessControl($env:OP_CUSTODY_PATH) }",
    "$stable=([System.Security.Principal.NTAccount]::new($env:OP_STABLE_ACCOUNT)).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "$access=@($acl.Access | ForEach-Object { [ordered]@{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; rights=[int]$_.FileSystemRights; type=$_.AccessControlType.ToString(); inherited=$_.IsInherited } } | Sort-Object sid)",
    "$streams=@(Get-Item -LiteralPath $env:OP_CUSTODY_PATH -Stream * | ForEach-Object { [ordered]@{ name=$_.Stream; length=[long]$_.Length } })",
    "$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "if ($owner -ne $stable) { throw 'owner mismatch' }",
    "$value=[ordered]@{ owner=$owner; protected=$acl.AreAccessRulesProtected; access=$access; streams=$streams }",
    "$value | ConvertTo-Json -Depth 5 -Compress",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, OP_CUSTODY_PATH: path, OP_STABLE_ACCOUNT: stableAccount },
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error(`custody inspection failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as ExactCustody;
};

const assertExactStableCustody = (
  path: string,
  stableAccount: string,
  expectedSize: number | undefined,
): void => {
  const observed = inspectExactCustody(path, stableAccount);
  const stableSid = observed.owner;
  expect({
    ...observed,
    access: [...observed.access].sort((left, right) => left.sid.localeCompare(right.sid)),
  }).toEqual({
    owner: stableSid,
    protected: true,
    access: [
      { sid: "S-1-5-18", rights: 2032127, type: "Allow", inherited: false },
      { sid: stableSid, rights: 2032127, type: "Allow", inherited: false },
    ].sort((left, right) => left.sid.localeCompare(right.sid)),
    streams: expectedSize === undefined ? [] : [{ name: ":$DATA", length: expectedSize }],
  });
  const acl = spawnSync("icacls.exe", [path], { encoding: "utf8", windowsHide: true });
  expect(acl.status).toBe(0);
  expect(acl.stdout).toContain("Mandatory Label\\Medium Mandatory Level:(NW)");
};

type ProfileIdentity = Readonly<{
  executionBinding: Buffer;
  executionRoot: string;
  folder: string;
  moniker: string;
  sid: Buffer;
  sidText: string;
}>;

const prepareExactRoot = async (): Promise<{ extended: string; root: string }> => {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-profile-"));
  const whoami = spawnSync("whoami.exe", { encoding: "utf8", windowsHide: true });
  if (whoami.status !== 0) throw new Error(`whoami failed: ${whoami.stderr}`);
  const stableAccount = whoami.stdout.trim();
  for (const args of [
    [root, "/inheritance:r"],
    [root, "/grant:r", "SYSTEM:(OI)(CI)F", `${stableAccount}:(OI)(CI)F`],
    [root, "/setintegritylevel", "(OI)(CI)M"],
  ]) {
    const result = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.status !== 0)
      throw new Error(`icacls ${args.slice(1).join(" ")} failed: ${result.stderr}`);
  }
  return { extended: `\\\\?\\${root}`, root };
};

const assertPreparePayload = (payload: Buffer): ProfileIdentity => {
  expect(payload.subarray(0, 4).toString("ascii")).toBe("OPWR");
  expect([...payload.subarray(4, 8)]).toEqual([1, 2, 0, 0]);
  const token = payload.subarray(8, 40);
  const moniker = payload.subarray(40, 104).toString("ascii");
  expect(token.byteLength).toBe(32);
  expect(moniker).toMatch(/^orch6-[0-9a-f]{58}$/);
  expect(moniker.slice(6)).toBe(token.subarray(0, 29).toString("hex"));
  let cursor = 104;
  const sidLength = payload.readUInt16LE(cursor);
  cursor += 2;
  expect(sidLength).toBeGreaterThanOrEqual(8);
  expect(sidLength).toBeLessThanOrEqual(68);
  const sid = Buffer.from(payload.subarray(cursor, cursor + sidLength));
  cursor += sidLength;
  const sidTextLength = payload.readUInt16LE(cursor);
  cursor += 2;
  const sidText = payload.subarray(cursor, cursor + sidTextLength).toString("ascii");
  expect(sidText).toMatch(/^S-/);
  cursor += sidTextLength;
  const folderUnits = payload.readUInt16LE(cursor);
  cursor += 2;
  const folder = payload.subarray(cursor, cursor + folderUnits * 2).toString("utf16le");
  expect(folder).toMatch(/^\\\\\?\\[A-Z]:\\/);
  cursor += folderUnits * 2;
  const executionRootUnits = payload.readUInt16LE(cursor);
  cursor += 2;
  const executionRoot = payload
    .subarray(cursor, cursor + executionRootUnits * 2)
    .toString("utf16le");
  expect(executionRoot).toMatch(/\\orch6-execution-[0-9a-f]{64}$/);
  cursor += executionRootUnits * 2;
  const executionBinding = Buffer.from(payload.subarray(cursor, cursor + 32));
  expect(executionBinding).not.toEqual(Buffer.alloc(32));
  cursor += 32;
  expect(cursor).toBe(payload.byteLength);
  return { executionBinding, executionRoot, folder, moniker, sid, sidText };
};

const verifierPayload = ({ folder, moniker, sid }: ProfileIdentity): Buffer => {
  const folderBytes = Buffer.from(folder, "utf16le");
  const header = Buffer.alloc(72);
  header.write("OPWV", 0, "ascii");
  header.writeUInt16LE(sid.byteLength, 4);
  header.writeUInt16LE(folder.length, 6);
  header.write(moniker, 8, "ascii");
  return Buffer.concat([header, sid, folderBytes]);
};

const assertNativeAbsence = (verifier: string, identity: ProfileIdentity): void => {
  const result = spawnSync(verifier, { input: verifierPayload(identity), windowsHide: true });
  expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toEqual({
    status: 0,
    stderr: Buffer.alloc(0),
    stdout: Buffer.alloc(0),
  });
};

const identityFromCreatedRecord = async (root: string, token: string): Promise<ProfileIdentity> => {
  const record = await readFile(resolve(root, `windows-profile-${token}-02-profile-created.opwj`));
  expect(record.subarray(0, 4).toString("ascii")).toBe("OPWJ");
  expect(record[5]).toBe(3);
  const moniker = record.subarray(108, 172).toString("ascii");
  let cursor = 172;
  const sidLength = record.readUInt16LE(cursor);
  cursor += 2;
  const sid = Buffer.from(record.subarray(cursor, cursor + sidLength));
  cursor += sidLength;
  const sidTextLength = record.readUInt16LE(cursor);
  cursor += 2;
  const sidText = record.subarray(cursor, cursor + sidTextLength).toString("ascii");
  cursor += sidTextLength;
  const folderUnits = record.readUInt16LE(cursor);
  cursor += 2;
  const folder = record.subarray(cursor, cursor + folderUnits * 2).toString("utf16le");
  return {
    executionBinding: Buffer.alloc(32),
    executionRoot: "",
    folder,
    moniker,
    sid,
    sidText,
  };
};

const waitForDiagnostic = async (
  stream: NodeJS.ReadableStream,
  expected: string,
): Promise<void> => {
  let observed = "";
  for (;;) {
    const [chunk] = (await once(stream, "data")) as [Buffer];
    observed += chunk.toString("utf8");
    if (observed.includes(expected)) return;
  }
};

const buildVerifier = (root: string): string => {
  const object = resolve(root, "absence-verifier.obj");
  const executable = resolve(root, "absence-verifier.exe");
  execFileSync(
    clangPath,
    [
      "/nologo",
      "/c",
      "/TC",
      "/std:c11",
      "/W4",
      "/WX",
      "/O1",
      "/Oi-",
      "/Gs9999999",
      "/clang:-fno-builtin",
      "/GS-",
      "/Zl",
      "/Brepro",
      "/DUNICODE",
      "/D_UNICODE",
      "/DOP_WINDOWS_ABSENCE_VERIFIER",
      `/Fo${object}`,
      fixturePath,
    ],
    { windowsHide: true },
  );
  execFileSync(
    linkerPath,
    [
      "/nologo",
      `/out:${executable}`,
      `/libpath:${sdkLibraryPath}`,
      "/entry:verifier_entry",
      "/subsystem:console",
      "/machine:x64",
      "/nodefaultlib",
      "/dynamicbase",
      "/nxcompat",
      "/highentropyva",
      "/Brepro",
      "/opt:ref",
      object,
      ...sdkLibraries,
    ],
    { windowsHide: true },
  );
  return executable;
};

describe("opt-in real Windows AppContainer profile custody diagnostic", () => {
  test.runIf(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.env.OP_WINDOWS_APPCONTAINER_DIAGNOSTIC === "1",
  )(
    "creates, probes, tears down, and recovers without producing authority",
    async () => {
      const { extended, root } = await prepareExactRoot();
      const toolRoot = await mkdtemp(resolve(tmpdir(), "orchestration-windows-profile-tools-"));
      const executionParent = await mkdtemp(
        resolve(tmpdir(), "orchestration-windows-execution-parent-"),
      );
      const sourceRoot = await mkdtemp(resolve(tmpdir(), "orchestration-windows-sources-"));
      const runtimeSource = resolve(sourceRoot, "node-source.exe");
      const rpcSource = resolve(sourceRoot, "rpc-source.mjs");
      const candidateSource = resolve(sourceRoot, "candidate-source.mjs");
      await copyFile(process.execPath, runtimeSource);
      await copyFile(rpcRunnerSourcePath, rpcSource);
      const validCandidateSource =
        "export function validateAuthorityHistoryChain() { return []; }\n";
      await writeFile(candidateSource, validCandidateSource);
      const challenge = Buffer.from(createIss002WalkChallenge().inputText, "utf8");
      const account = spawnSync("whoami.exe", { encoding: "utf8", windowsHide: true });
      expect(account.status).toBe(0);
      for (const path of [executionParent, sourceRoot, runtimeSource, rpcSource, candidateSource]) {
        for (const args of [
          [path, "/inheritance:r"],
          [path, "/grant:r", "SYSTEM:F", `${account.stdout.trim()}:F`],
          [path, "/setintegritylevel", "M"],
        ]) {
          const acl = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
          expect({ args, status: acl.status, stderr: acl.stderr }).toEqual({
            args,
            status: 0,
            stderr: "",
          });
        }
      }
      const preparePayload = executionPrepare([
        extended,
        `\\\\?\\${executionParent}`,
        `\\\\?\\${runtimeSource}`,
        `\\\\?\\${rpcSource}`,
        `\\\\?\\${candidateSource}`,
      ]);
      let recoveryProved = false;
      let activeBroker: ReturnType<typeof spawn> | undefined;
      try {
        const verifier = buildVerifier(toolRoot);
        const pauseAfterAttempted = resolve(toolRoot, "pause-after-attempted.exe");
        const pauseAfterCreate = resolve(toolRoot, "pause-after-create.exe");
        const pauseAfterExecutionAttempted = resolve(
          toolRoot,
          "pause-after-execution-attempted.exe",
        );
        const pauseAfterExecutionMkdir = resolve(toolRoot, "pause-after-execution-mkdir.exe");
        const pauseAfterExecutionCreated = resolve(toolRoot, "pause-after-execution-created.exe");
        const forceTerminalJoinAmbiguity = resolve(toolRoot, "force-terminal-join-ambiguity.exe");
        const admissionCrashes = [
          {
            executable: resolve(toolRoot, "pause-after-admission-grant-attempted.exe"),
            marker: "pause-after-admission-grant-attempted",
            variant: "pause-after-admission-grant-attempted",
          },
          {
            executable: resolve(toolRoot, "pause-after-admission-granted.exe"),
            marker: "pause-after-admission-granted",
            variant: "pause-after-admission-granted",
          },
          {
            executable: resolve(toolRoot, "pause-after-admission-job-attempted.exe"),
            marker: "pause-after-admission-job-attempted",
            variant: "pause-after-admission-job-attempted",
          },
          {
            executable: resolve(toolRoot, "pause-after-admission-launch-created.exe"),
            marker: "pause-after-admission-launch-created",
            variant: "pause-after-admission-launch-created",
          },
          {
            executable: resolve(toolRoot, "pause-after-admission-resume.exe"),
            marker: "pause-after-admission-resume",
            variant: "pause-after-admission-resume",
          },
          {
            executable: resolve(toolRoot, "pause-after-admission-terminal-response.exe"),
            marker: "pause-after-admission-terminal-response",
            variant: "pause-after-admission-terminal-response",
          },
        ] as const;
        execFileSync(process.execPath, [buildPath, pauseAfterAttempted, "pause-after-attempted"], {
          windowsHide: true,
        });
        execFileSync(process.execPath, [buildPath, pauseAfterCreate, "pause-after-create"], {
          windowsHide: true,
        });
        for (const [output, variant] of [
          [pauseAfterExecutionAttempted, "pause-after-execution-attempted"],
          [pauseAfterExecutionMkdir, "pause-after-execution-mkdir"],
          [pauseAfterExecutionCreated, "pause-after-execution-created"],
        ] as const) {
          execFileSync(process.execPath, [buildPath, output, variant], { windowsHide: true });
        }
        for (const crash of admissionCrashes)
          execFileSync(process.execPath, [buildPath, crash.executable, crash.variant], {
            windowsHide: true,
          });
        execFileSync(
          process.execPath,
          [buildPath, forceTerminalJoinAmbiguity, "force-terminal-join-ambiguity"],
          { windowsHide: true },
        );
        const first = spawn(imagePath, ["SERVE"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        activeBroker = first;
        const firstExit = closeProcess(first);
        const firstDiagnostics: Buffer[] = [];
        first.stderr.on("data", (chunk: Buffer) => firstDiagnostics.push(chunk));
        first.stdin.write(frame(1, preparePayload));
        const prepared = await readResponse(first.stdout);
        expect(prepared.header[6]).toBe(1);
        if (prepared.header[7] !== 0) {
          await firstExit;
          const acl = spawnSync("icacls.exe", [root], { encoding: "utf8", windowsHide: true });
          const records = (await readdir(root)).sort();
          throw new Error(
            `PREPARE status ${prepared.header[7]}; records ${JSON.stringify(records)}; ` +
              `diagnostic ${Buffer.concat(firstDiagnostics).toString("utf8")}; ` +
              `temporary root ACL:\n${acl.stdout}${acl.stderr}`,
          );
        }
        const firstIdentity = assertPreparePayload(prepared.payload);
        const stableAccount = account.stdout.trim();
        assertExactStableCustody(executionParent, stableAccount, undefined);
        assertExactStableCustody(firstIdentity.executionRoot, stableAccount, undefined);
        expect((await readdir(firstIdentity.executionRoot)).sort()).toEqual([
          "candidate.mjs",
          "node.exe",
          "rpc-runner.mjs",
        ]);
        for (const [target, source] of [
          ["node.exe", runtimeSource],
          ["rpc-runner.mjs", rpcSource],
          ["candidate.mjs", candidateSource],
        ] as const) {
          const sourceSize = (await stat(source)).size;
          expect(await sha256File(resolve(firstIdentity.executionRoot, target))).toBe(
            await sha256File(source),
          );
          assertExactStableCustody(
            resolve(firstIdentity.executionRoot, target),
            stableAccount,
            sourceSize,
          );
          const acl = spawnSync("icacls.exe", [resolve(firstIdentity.executionRoot, target)], {
            encoding: "utf8",
            windowsHide: true,
          });
          expect(acl.status).toBe(0);
          expect(acl.stdout).not.toContain(firstIdentity.sidText);
        }
        const executionAcl = spawnSync("icacls.exe", [firstIdentity.executionRoot], {
          encoding: "utf8",
          windowsHide: true,
        });
        expect(executionAcl.status).toBe(0);
        expect(executionAcl.stdout).not.toContain(firstIdentity.sidText);
        first.stdin.write(frame(2, challenge));
        const launch = await readResponse(first.stdout);
        if (launch.header[7] !== 0) {
          const records = (await readdir(root)).sort();
          const executionAcl = spawnSync("icacls.exe", [firstIdentity.executionRoot], {
            encoding: "utf8",
            windowsHide: true,
          });
          throw new Error(
            `LAUNCH status ${launch.header[7]}; records ${JSON.stringify(records)}; ` +
              `diagnostic ${Buffer.concat(firstDiagnostics).toString("utf8")}; ` +
              `execution ACL:\n${executionAcl.stdout}${executionAcl.stderr}`,
          );
        }
        expect([...launch.header.subarray(6, 8)]).toEqual([2, 0]);
        expect(launch.payload.byteLength).toBeGreaterThanOrEqual(16);
        expect([...launch.payload.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
        expect(launch.payload.readUInt32LE(4)).toBe(0);
        const stdoutLength = launch.payload.readUInt32LE(8);
        const stderrLength = launch.payload.readUInt32LE(12);
        expect(launch.payload.byteLength).toBe(16 + stdoutLength + stderrLength);
        expect(launch.payload.subarray(16, 16 + stdoutLength).toString("utf8")).toBe(
          '{"issues":[]}',
        );
        expect(stderrLength).toBe(0);
        first.stdin.end(frame(3));
        const teardown = await readResponse(first.stdout);
        expect([...teardown.header.subarray(6, 12)]).toEqual([3, 0, 0, 0, 0, 0]);
        expect(teardown.payload).toEqual(Buffer.alloc(0));
        expect(await firstExit).toBe(0);
        activeBroker = undefined;
        assertNativeAbsence(verifier, firstIdentity);

        const runTimeoutCandidate = async (source: string): Promise<void> => {
          await writeFile(candidateSource, source);
          const child = spawn(imagePath, ["SERVE"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          activeBroker = child;
          const exited = closeProcess(child);
          const diagnostics: Buffer[] = [];
          child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk));
          child.stdin.write(frame(1, preparePayload));
          const prepared = await readResponse(child.stdout);
          if (prepared.header[7] !== 0)
            throw new Error(
              `timeout PREPARE ${prepared.header[7]}: ${Buffer.concat(diagnostics).toString("utf8")}`,
            );
          const identity = assertPreparePayload(prepared.payload);
          child.stdin.write(frame(2, challenge));
          const launch = await readResponse(child.stdout);
          expect([...launch.header.subarray(6, 8)]).toEqual([2, 0]);
          expect(launch.payload).toEqual(
            Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          );
          child.stdin.end(frame(3));
          const teardown = await readResponse(child.stdout);
          expect([...teardown.header.subarray(6, 12)]).toEqual([3, 0, 0, 0, 0, 0]);
          expect(await exited).toBe(0);
          activeBroker = undefined;
          assertNativeAbsence(verifier, identity);
        };
        const runRefusedCandidate = async (
          source: string,
          expectedDiagnostics: string,
        ): Promise<void> => {
          await writeFile(candidateSource, source);
          const child = spawn(imagePath, ["SERVE"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          activeBroker = child;
          const exited = closeProcess(child);
          const diagnostics: Buffer[] = [];
          child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk));
          child.stdin.write(frame(1, preparePayload));
          const prepared = await readResponse(child.stdout);
          expect(prepared.header[7]).toBe(0);
          const identity = assertPreparePayload(prepared.payload);
          child.stdin.write(frame(2, challenge));
          const launch = await readResponse(child.stdout);
          expect({
            header: [...launch.header.subarray(6, 12)],
            diagnostics: Buffer.concat(diagnostics).toString("utf8"),
          }).toEqual({ header: [2, 65, 0, 0, 0, 0], diagnostics: expectedDiagnostics });
          expect(launch.payload).toEqual(Buffer.alloc(0));
          child.stdin.end(frame(3));
          const teardown = await readResponse(child.stdout);
          expect([...teardown.header.subarray(6, 12)]).toEqual([3, 0, 0, 0, 0, 0]);
          expect(await exited).toBe(0);
          activeBroker = undefined;
          assertNativeAbsence(verifier, identity);
        };
        await runTimeoutCandidate(
          "setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport function validateAuthorityHistoryChain() { return []; }\n",
        );
        await runTimeoutCandidate(
          'import { spawn } from "node:child_process";\nconst child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });\nchild.unref();\nexport function validateAuthorityHistoryChain() { return []; }\n',
        );
        await runTimeoutCandidate(
          'import { spawn } from "node:child_process";\nconst child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "inherit" });\nchild.unref();\nexport function validateAuthorityHistoryChain() { return []; }\n',
        );
        await runRefusedCandidate(
          "await new Promise((resolve) => process.stdout.write(Buffer.alloc(4194305, 97), resolve));\nexport function validateAuthorityHistoryChain() { return []; }\n",
          "windows-broker:terminal-stdin-failed:00000000\n" +
            "windows-broker:terminal-stdout-failed:00000000\n" +
            "windows-broker:terminal-stderr-failed:00000000\n" +
            "windows-broker:terminal-stdout-overflow:00000001\n" +
            "windows-broker:terminal-stderr-overflow:00000000\n",
        );
        await runRefusedCandidate(
          "await new Promise((resolve) => process.stderr.write(Buffer.alloc(4194305, 98), resolve));\nexport function validateAuthorityHistoryChain() { return []; }\n",
          "windows-broker:terminal-stdin-failed:00000000\n" +
            "windows-broker:terminal-stdout-failed:00000000\n" +
            "windows-broker:terminal-stderr-failed:00000000\n" +
            "windows-broker:terminal-stdout-overflow:00000000\n" +
            "windows-broker:terminal-stderr-overflow:00000001\n",
        );
        await writeFile(
          candidateSource,
          "setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport function validateAuthorityHistoryChain() { return []; }\n",
        );
        {
          const interrupted = spawn(forceTerminalJoinAmbiguity, ["SERVE"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          activeBroker = interrupted;
          const interruptedExit = closeProcess(interrupted);
          interrupted.stdin.write(frame(1, preparePayload));
          const prepared = await readResponse(interrupted.stdout);
          expect(prepared.header[7]).toBe(0);
          const identity = assertPreparePayload(prepared.payload);
          interrupted.stdin.end(frame(2, challenge));
          expect(await interruptedExit).toBe(70);
          activeBroker = undefined;
          const recovered = spawnSync(imagePath, ["RECOVER"], {
            input: frame(3, profileScope(extended)),
            windowsHide: true,
            timeout: 60_000,
          });
          expect({ status: recovered.status, stderr: recovered.stderr.toString("utf8") }).toEqual({
            status: 0,
            stderr: "",
          });
          const expected = frame(3);
          expected[5] = 2;
          expect(recovered.stdout).toEqual(expected);
          assertNativeAbsence(verifier, identity);
        }
        await writeFile(candidateSource, validCandidateSource);

        for (const crash of [
          { executable: pauseAfterAttempted, marker: "pause-after-attempted" },
          { executable: pauseAfterCreate, marker: "pause-after-create" },
          {
            executable: pauseAfterExecutionAttempted,
            marker: "pause-after-execution-attempted",
          },
          { executable: pauseAfterExecutionMkdir, marker: "pause-after-execution-mkdir" },
          { executable: pauseAfterExecutionCreated, marker: "pause-after-execution-created" },
        ]) {
          const before = new Set(await readdir(root));
          const interrupted = spawn(crash.executable, ["SERVE"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          activeBroker = interrupted;
          const interruptedExit = closeProcess(interrupted);
          const paused = waitForDiagnostic(interrupted.stderr, crash.marker);
          interrupted.stdin.write(frame(1, preparePayload));
          await paused;
          expect(interrupted.kill()).toBe(true);
          await interruptedExit;
          activeBroker = undefined;
          const recovered = spawnSync(imagePath, ["RECOVER"], {
            input: frame(3, profileScope(extended)),
            windowsHide: true,
          });
          expect(recovered.status).toBe(0);
          expect(recovered.stderr).toEqual(Buffer.alloc(0));
          const expected = frame(3);
          expected[5] = 2;
          expect(recovered.stdout).toEqual(expected);
          const newUsed = (await readdir(root)).filter(
            (name) => name.endsWith("-00-used.opwj") && !before.has(name),
          );
          expect(newUsed).toHaveLength(1);
          const token = /^windows-profile-([0-9a-f]{64})-00-used\.opwj$/.exec(newUsed[0]!)?.[1];
          expect(token).toMatch(/^[0-9a-f]{64}$/);
          assertNativeAbsence(verifier, await identityFromCreatedRecord(root, token!));
        }
        for (const crash of admissionCrashes) {
          const before = new Set(await readdir(root));
          const interrupted = spawn(crash.executable, ["SERVE"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
          activeBroker = interrupted;
          const interruptedExit = closeProcess(interrupted);
          interrupted.stdin.write(frame(1, preparePayload));
          const prepared = await readResponse(interrupted.stdout);
          expect(prepared.header[7]).toBe(0);
          const interruptedIdentity = assertPreparePayload(prepared.payload);
          const paused = waitForDiagnostic(interrupted.stderr, crash.marker);
          interrupted.stdin.write(frame(2, challenge));
          await paused;
          expect(interrupted.kill()).toBe(true);
          await interruptedExit;
          activeBroker = undefined;
          const recovered = spawnSync(imagePath, ["RECOVER"], {
            input: frame(3, profileScope(extended)),
            windowsHide: true,
            timeout: 60_000,
          });
          expect({ status: recovered.status, stderr: recovered.stderr.toString("utf8") }).toEqual({
            status: 0,
            stderr: "",
          });
          const expected = frame(3);
          expected[5] = 2;
          expect(recovered.stdout).toEqual(expected);
          const newUsed = (await readdir(root)).filter(
            (name) => name.endsWith("-00-used.opwj") && !before.has(name),
          );
          expect(newUsed).toHaveLength(1);
          assertNativeAbsence(verifier, interruptedIdentity);
        }
        recoveryProved = true;

        const records = (await readdir(root)).sort();
        expect(records).toHaveLength(233);
        expect(records.filter((name) => name.endsWith("-00-used.opwj"))).toHaveLength(18);
        expect(
          records.filter((name) => name.endsWith("-04-profile-absence-proved.opwj")),
        ).toHaveLength(18);
        expect(records.filter((name) => name.endsWith("-00-attempted.opwx"))).toHaveLength(16);
        expect(records.filter((name) => name.endsWith("-01-created.opwx"))).toHaveLength(14);
        expect(records.filter((name) => name.endsWith("-02-delete-attempted.opwx"))).toHaveLength(
          16,
        );
        expect(records.filter((name) => name.endsWith("-03-absence-proved.opwx"))).toHaveLength(16);
        for (const [suffix, count] of [
          ["-00-grant-attempted.opwl", 13],
          ["-01-granted.opwl", 12],
          ["-02-job-attempted.opwl", 11],
          ["-03-launch-attempted.opwl", 10],
          ["-04-admission-proved.opwl", 9],
          ["-05-revoke-attempted.opwl", 13],
          ["-06-absence-proved.opwl", 13],
        ] as const) {
          expect(records.filter((name) => name.endsWith(suffix))).toHaveLength(count);
        }
        expect(records.every((name) => !name.endsWith(".pending"))).toBe(true);
      } finally {
        if (
          activeBroker !== undefined &&
          activeBroker.exitCode === null &&
          activeBroker.signalCode === null
        ) {
          const exited = closeProcess(activeBroker);
          activeBroker.kill();
          await exited;
        }
        if (!recoveryProved) {
          const finalRecovery = spawnSync(imagePath, ["RECOVER"], {
            input: frame(3, profileScope(extended)),
            windowsHide: true,
          });
          recoveryProved = finalRecovery.status === 0;
        }
        if (recoveryProved) await rm(root, { force: true, recursive: true });
        await rm(toolRoot, { force: true, recursive: true });
        if (recoveryProved) await rm(executionParent, { force: true, recursive: true });
        await rm(sourceRoot, { force: true, recursive: true });
      }
    },
    420_000,
  );
});

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const imagePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/windows-isolation-broker-x64.exe",
);
const buildPath = resolve(import.meta.dirname, "../../scripts/build/windows-isolation-broker.mjs");
const fixturePath = resolve(import.meta.dirname, "windows-isolation-broker-fixture.c");
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

type ProfileIdentity = Readonly<{ folder: string; moniker: string; sid: Buffer }>;

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
  expect([...payload.subarray(4, 8)]).toEqual([1, 1, 0, 0]);
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
  expect(payload.subarray(cursor, cursor + sidTextLength).toString("ascii")).toMatch(/^S-/);
  cursor += sidTextLength;
  const folderUnits = payload.readUInt16LE(cursor);
  cursor += 2;
  const folder = payload.subarray(cursor, cursor + folderUnits * 2).toString("utf16le");
  expect(folder).toMatch(/^\\\\\?\\[A-Z]:\\/);
  cursor += folderUnits * 2;
  expect(cursor).toBe(payload.byteLength);
  return { folder, moniker, sid };
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
  cursor += 2 + sidTextLength;
  const folderUnits = record.readUInt16LE(cursor);
  cursor += 2;
  const folder = record.subarray(cursor, cursor + folderUnits * 2).toString("utf16le");
  return { folder, moniker, sid };
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
  )("creates, probes, tears down, and recovers without producing authority", async () => {
    const { extended, root } = await prepareExactRoot();
    const toolRoot = await mkdtemp(resolve(tmpdir(), "orchestration-windows-profile-tools-"));
    let recoveryProved = false;
    try {
      const verifier = buildVerifier(toolRoot);
      const pauseAfterAttempted = resolve(toolRoot, "pause-after-attempted.exe");
      const pauseAfterCreate = resolve(toolRoot, "pause-after-create.exe");
      execFileSync(process.execPath, [buildPath, pauseAfterAttempted, "pause-after-attempted"], {
        windowsHide: true,
      });
      execFileSync(process.execPath, [buildPath, pauseAfterCreate, "pause-after-create"], {
        windowsHide: true,
      });
      const first = spawn(imagePath, ["SERVE"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const firstExit = closeProcess(first);
      const firstDiagnostics: Buffer[] = [];
      first.stderr.on("data", (chunk: Buffer) => firstDiagnostics.push(chunk));
      first.stdin.write(frame(1, profileScope(extended)));
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
      first.stdin.write(frame(2));
      const launch = await readResponse(first.stdout);
      expect([...launch.header.subarray(6, 12)]).toEqual([2, 78, 0, 0, 0, 0]);
      expect(launch.payload).toEqual(Buffer.alloc(0));
      first.stdin.end(frame(3));
      const teardown = await readResponse(first.stdout);
      expect([...teardown.header.subarray(6, 12)]).toEqual([3, 0, 0, 0, 0, 0]);
      expect(await firstExit).toBe(0);
      assertNativeAbsence(verifier, firstIdentity);

      for (const crash of [
        { executable: pauseAfterAttempted, marker: "pause-after-attempted" },
        { executable: pauseAfterCreate, marker: "pause-after-create" },
      ]) {
        const before = new Set(await readdir(root));
        const interrupted = spawn(crash.executable, ["SERVE"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        const interruptedExit = closeProcess(interrupted);
        const paused = waitForDiagnostic(interrupted.stderr, crash.marker);
        interrupted.stdin.write(frame(1, profileScope(extended)));
        await paused;
        expect(interrupted.kill()).toBe(true);
        await interruptedExit;
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
      recoveryProved = true;

      const records = (await readdir(root)).sort();
      expect(records).toHaveLength(15);
      expect(records.filter((name) => name.endsWith("-00-used.opwj"))).toHaveLength(3);
      expect(
        records.filter((name) => name.endsWith("-04-profile-absence-proved.opwj")),
      ).toHaveLength(3);
      expect(records.every((name) => !name.endsWith(".pending"))).toBe(true);
    } finally {
      if (!recoveryProved) {
        const finalRecovery = spawnSync(imagePath, ["RECOVER"], {
          input: frame(3, profileScope(extended)),
          windowsHide: true,
        });
        recoveryProved = finalRecovery.status === 0;
      }
      if (recoveryProved) await rm(root, { force: true, recursive: true });
      await rm(toolRoot, { force: true, recursive: true });
    }
  });
});

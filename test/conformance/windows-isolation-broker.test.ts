import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const sourcePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/windows-isolation-broker.c",
);
const imagePath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/windows-isolation-broker-x64.exe",
);
const buildPath = resolve(import.meta.dirname, "../../scripts/build/windows-isolation-broker.mjs");
const clangPath = "C:/Program Files/LLVM/bin/clang-cl.exe";
const linkerPath = "C:/Program Files/LLVM/bin/lld-link.exe";
const fixturePath = resolve(import.meta.dirname, "windows-isolation-broker-fixture.c");
const sdkLibraries = [
  "kernel32.lib",
  "userenv.lib",
  "api-ms-win-net-isolation-l1-1-0.lib",
  "advapi32.lib",
  "ole32.lib",
  "bcrypt.lib",
].map((name) => `C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64/${name}`);
const roots: string[] = [];

const brokerFrame = (
  operation: number,
  payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): Buffer => {
  const frame = Buffer.alloc(16 + payload.byteLength);
  frame.write("OPWB", 0, "ascii");
  frame[4] = 1;
  frame[5] = 1;
  frame[6] = operation;
  frame.writeUInt32LE(payload.byteLength, 8);
  payload.copy(frame, 16);
  return frame;
};

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

const responseFrame = (operation: number, status: number): Buffer => {
  const response = brokerFrame(operation);
  response[5] = 2;
  response[7] = status;
  return response;
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
    throw new Error("short fixture output");
  return result;
};

const waitForExit = async (child: ReturnType<typeof spawn>): Promise<number | null> => {
  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  return code;
};

type PeSection = Readonly<{
  rawOffset: number;
  rawSize: number;
  virtualAddress: number;
  virtualSize: number;
}>;

const readCString = (image: Buffer, offset: number): string => {
  const end = image.indexOf(0, offset);
  if (end < 0) throw new Error("unterminated PE string");
  return image.subarray(offset, end).toString("ascii");
};

const peCensus = (image: Buffer) => {
  const peOffset = image.readUInt32LE(0x3c);
  const sectionCount = image.readUInt16LE(peOffset + 6);
  const optionalSize = image.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  const sectionOffset = optionalOffset + optionalSize;
  const sections: PeSection[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * 40;
    sections.push({
      virtualSize: image.readUInt32LE(offset + 8),
      virtualAddress: image.readUInt32LE(offset + 12),
      rawSize: image.readUInt32LE(offset + 16),
      rawOffset: image.readUInt32LE(offset + 20),
    });
  }
  const rawOffsetFor = (rva: number): number => {
    const section = sections.find(
      (candidate) =>
        rva >= candidate.virtualAddress &&
        rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize),
    );
    if (!section) throw new Error(`unmapped PE RVA ${rva}`);
    const offset = section.rawOffset + rva - section.virtualAddress;
    if (offset >= section.rawOffset + section.rawSize) throw new Error(`unbacked PE RVA ${rva}`);
    return offset;
  };
  const directory = (index: number) => ({
    rva: image.readUInt32LE(optionalOffset + 112 + index * 8),
    size: image.readUInt32LE(optionalOffset + 116 + index * 8),
  });
  const importDirectory = directory(1);
  if (importDirectory.rva === 0 || importDirectory.size < 40)
    throw new Error("missing PE import directory");
  const importOffset = rawOffsetFor(importDirectory.rva);
  const importLimit = importOffset + importDirectory.size;
  const imports: Array<{ library: string; symbols: string[] }> = [];
  for (let descriptor = importOffset; descriptor + 20 <= importLimit; descriptor += 20) {
    const fields = Array.from({ length: 5 }, (_, index) =>
      image.readUInt32LE(descriptor + index * 4),
    );
    if (fields.every((field) => field === 0)) break;
    const lookupRva = fields[0]!;
    const nameRva = fields[3]!;
    const addressRva = fields[4]!;
    if (nameRva === 0 || (lookupRva === 0 && addressRva === 0))
      throw new Error("malformed PE import descriptor");
    const symbols: string[] = [];
    let thunk = rawOffsetFor(lookupRva || addressRva);
    for (;;) {
      const value = image.readBigUInt64LE(thunk);
      if (value === 0n) break;
      if ((value & (1n << 63n)) !== 0n) throw new Error("ordinal PE import refused");
      const nameOffset = rawOffsetFor(Number(value));
      symbols.push(readCString(image, nameOffset + 2));
      thunk += 8;
    }
    imports.push({ library: readCString(image, rawOffsetFor(nameRva)), symbols });
  }
  const terminator = importOffset + imports.length * 20;
  if (
    terminator + 20 > importLimit ||
    !Array.from({ length: 5 }, (_, index) => image.readUInt32LE(terminator + index * 4)).every(
      (field) => field === 0,
    )
  )
    throw new Error("unterminated PE import descriptor census");
  return {
    delayImports: directory(13),
    dllCharacteristics: image.readUInt16LE(optionalOffset + 70),
    importDirectory,
    imports,
    relocations: directory(5),
  };
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

describe("private Windows isolation broker bootstrap", () => {
  test("pins one deterministic X64 PE with a closed Kernel32 import census", async () => {
    const image = await readFile(imagePath);
    expect(image.subarray(0, 2).toString("ascii")).toBe("MZ");
    const peOffset = image.readUInt32LE(0x3c);
    expect(image.subarray(peOffset, peOffset + 4).toString("binary")).toBe("PE\0\0");
    expect(image.readUInt16LE(peOffset + 4)).toBe(0x8664);
    expect(image.readUInt16LE(peOffset + 24)).toBe(0x20b);
    expect(image.byteLength).toBe(95232);
    expect(createHash("sha256").update(image).digest("hex")).toBe(
      "4df6df24b316e2b534dfa09dc9334d33fe1d9b17818c9536a40e35d011333aa8",
    );
    const census = peCensus(image);
    expect(census).toEqual({
      delayImports: { rva: 0, size: 0 },
      dllCharacteristics: expect.any(Number),
      importDirectory: { rva: expect.any(Number), size: 140 },
      imports: [
        {
          library: "KERNEL32.dll",
          symbols: [
            "CloseHandle",
            "CreateDirectoryW",
            "CreateEventW",
            "CreateFileW",
            "CreateJobObjectW",
            "CreatePipe",
            "CreateProcessW",
            "CreateThread",
            "DeleteProcThreadAttributeList",
            "ExitProcess",
            "FindClose",
            "FindFirstFileW",
            "FindFirstStreamW",
            "FindNextFileW",
            "FindNextStreamW",
            "FlushFileBuffers",
            "GetCommandLineW",
            "GetCurrentProcess",
            "GetCurrentThread",
            "GetDriveTypeW",
            "GetExitCodeProcess",
            "GetFileAttributesW",
            "GetFileInformationByHandle",
            "GetFileInformationByHandleEx",
            "GetFileSizeEx",
            "GetFinalPathNameByHandleW",
            "GetHandleInformation",
            "GetLastError",
            "GetModuleFileNameW",
            "GetProcessHeap",
            "GetStdHandle",
            "GetTickCount64",
            "GetWindowsDirectoryW",
            "HeapAlloc",
            "HeapFree",
            "InitializeProcThreadAttributeList",
            "IsProcessInJob",
            "LocalFree",
            "OpenJobObjectW",
            "QueryInformationJobObject",
            "ReadFile",
            "ResumeThread",
            "SetFileInformationByHandle",
            "SetFilePointer",
            "SetHandleInformation",
            "SetInformationJobObject",
            "SetLastError",
            "Sleep",
            "TerminateJobObject",
            "UpdateProcThreadAttribute",
            "WaitForSingleObject",
            "WriteFile",
          ],
        },
        {
          library: "USERENV.dll",
          symbols: [
            "CreateAppContainerProfile",
            "DeleteAppContainerProfile",
            "DeriveAppContainerSidFromAppContainerName",
            "GetAppContainerFolderPath",
          ],
        },
        {
          library: "api-ms-win-net-isolation-l1-1-0.dll",
          symbols: ["NetworkIsolationEnumAppContainers", "NetworkIsolationFreeAppContainers"],
        },
        {
          library: "ADVAPI32.dll",
          symbols: [
            "AccessCheck",
            "AllocateAndInitializeSid",
            "ConvertSidToStringSidW",
            "ConvertStringSecurityDescriptorToSecurityDescriptorW",
            "CopySid",
            "DuplicateTokenEx",
            "EqualSid",
            "FreeSid",
            "GetAce",
            "GetAclInformation",
            "GetLengthSid",
            "GetSecurityDescriptorControl",
            "GetSecurityDescriptorDacl",
            "GetSecurityDescriptorGroup",
            "GetSecurityDescriptorLength",
            "GetSecurityDescriptorOwner",
            "GetSecurityDescriptorSacl",
            "GetSecurityInfo",
            "GetTokenInformation",
            "ImpersonateLoggedOnUser",
            "IsValidSid",
            "MakeSelfRelativeSD",
            "MapGenericMask",
            "OpenProcessToken",
            "OpenThreadToken",
            "RevertToSelf",
            "SetKernelObjectSecurity",
          ],
        },
        { library: "ole32.dll", symbols: ["CoTaskMemFree"] },
        {
          library: "bcrypt.dll",
          symbols: [
            "BCryptCloseAlgorithmProvider",
            "BCryptCreateHash",
            "BCryptDestroyHash",
            "BCryptFinishHash",
            "BCryptGenRandom",
            "BCryptGetProperty",
            "BCryptHashData",
            "BCryptOpenAlgorithmProvider",
          ],
        },
      ],
      relocations: { rva: expect.any(Number), size: 64 },
    });
    expect(census.dllCharacteristics & 0x160).toBe(0x160);
    expect(census.importDirectory.rva).toBeGreaterThan(0);
    expect(census.relocations.rva).toBeGreaterThan(0);
    const strings = image.toString("latin1");
    for (const forbidden of ["cmd.exe", "powershell", "ShellExecute", "WinExec"])
      expect(strings).not.toContain(forbidden);
  });

  test("source exposes exactly SERVE and RECOVER and no general command surface", async () => {
    const source = await readFile(sourcePath, "utf8");
    expect([...source.matchAll(/wide_equal\(mode, ([a-z_]+)\)/g)].map((match) => match[1])).toEqual(
      ["serve_mode", "recover_mode"],
    );
    for (const forbidden of [
      "system(",
      "ShellExecute",
      "WinExec",
      "LoadLibrary",
      "IsTokenRestricted",
      "TokenHasRestrictions",
    ])
      expect(source).not.toContain(forbidden);
    expect(source.match(/\bCreateProcessW\(/g)).toHaveLength(2);
    expect(source.match(/\bResumeThread\(/g)).toHaveLength(2);
    expect(source.match(/L"--preserve-symlinks"/g)).toHaveLength(1);
    expect(source.match(/L"--preserve-symlinks-main"/g)).toHaveLength(1);
    expect(source.indexOf('L"--preserve-symlinks"')).toBeLessThan(
      source.indexOf('L"--preserve-symlinks-main"'),
    );
    expect(source).not.toContain("NODE_OPTIONS");
    expect(source).toContain('#error "windows-isolation-broker.c is Windows-only"');
    expect(source).toContain('#error "windows-isolation-broker.c requires X64"');
  });

  test("keeps fake OS substitutions outside the exact production source", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    expect(fixture).toContain(
      '#include "../../packages/conformance/src/windows-isolation-broker.c"',
    );
    expect(fixture.indexOf("#define NetworkIsolationEnumAppContainers")).toBeLessThan(
      fixture.indexOf("#include"),
    );
    expect(fixture.indexOf("#define NetworkIsolationFreeAppContainers")).toBeLessThan(
      fixture.indexOf("#include"),
    );
    expect(fixture).toContain("OP_WINDOWS_ADMISSION_OS_FIXTURE");
    for (const forbidden of ["receipt", "promotion", "certification"])
      expect(fixture).not.toContain(forbidden);
  });

  test.runIf(process.platform === "win32")(
    "executes compiled admission transition and hostile-buffer mutants",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-admission-fixture-"));
      roots.push(root);
      const object = resolve(root, "admission-fixture.obj");
      const executable = resolve(root, "admission-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/clang:-Wno-unused-function",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_ADMISSION_FIXTURE",
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
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          object,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      expect(spawnSync(executable, [], { windowsHide: true })).toMatchObject({
        status: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.alloc(0),
      });
    },
    120_000,
  );

  test.runIf(process.platform === "win32")(
    "executes exact-source fake-OS admission and recovery mutants",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-admission-os-"));
      roots.push(root);
      const object = resolve(root, "admission-os-fixture.obj");
      const executable = resolve(root, "admission-os-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/clang:-Wno-unused-function",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_ADMISSION_OS_FIXTURE",
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
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          object,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      expect(spawnSync(executable, [], { windowsHide: true })).toMatchObject({
        status: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.alloc(0),
      });
    },
    120_000,
  );

  test.runIf(process.platform === "win32")(
    "executes raw target census cardinality and unrelated duplicate mutants",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-broker-fixture-"));
      roots.push(root);
      const object = resolve(root, "fixture.obj");
      const executable = resolve(root, "fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
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
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          object,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      for (const scenario of [
        "enum-error",
        "overbound",
        "unrelated-duplicate",
        "unrelated-name-conflict",
        "unrelated-sid-conflict",
        "target-one",
        "target-duplicate",
        "target-name-only",
        "target-sid-only",
        "target-capability",
        "malformed-late",
        "free-error",
        "complete-empty",
        "complete-duplicate",
        "complete-unjournaled",
        "complete-terminal",
        "complete-group-duplicate",
        "complete-cross-group",
        "pointer-mismatch",
        "record-folder-arms",
        "target-null-user",
        "target-wrong-user",
        "target-malformed-user",
      ]) {
        const result = spawnSync(executable, [scenario], { windowsHide: true });
        expect({
          scenario,
          status: result.status,
          stderr: result.stderr,
          stdout: result.stdout,
        }).toEqual({
          scenario,
          status: 0,
          stderr: Buffer.alloc(0),
          stdout: Buffer.alloc(0),
        });
      }

      const durableRoot = await mkdtemp(resolve(tmpdir(), "orchestration-windows-broker-durable-"));
      roots.push(durableRoot);
      const account = spawnSync("whoami.exe", { encoding: "utf8", windowsHide: true });
      expect(account.status).toBe(0);
      for (const args of [
        [durableRoot, "/inheritance:r"],
        [durableRoot, "/grant:r", "SYSTEM:(OI)(CI)F", `${account.stdout.trim()}:(OI)(CI)F`],
        [durableRoot, "/setintegritylevel", "(OI)(CI)M"],
      ]) {
        const acl = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
        expect({ args, status: acl.status, stderr: acl.stderr }).toEqual({
          args,
          status: 0,
          stderr: "",
        });
      }
      const durable = spawnSync(executable, ["durable-publication"], {
        input: brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
        windowsHide: true,
      });
      expect({ status: durable.status, stderr: durable.stderr, stdout: durable.stdout }).toEqual({
        status: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.alloc(0),
      });
      expect((await readdir(durableRoot)).sort()).toEqual([
        expect.stringMatching(/-00-used\.opwj$/),
        expect.stringMatching(/-01-profile-attempted\.opwj$/),
        expect.stringMatching(/-02-profile-created\.opwj$/),
        expect.stringMatching(/-03-profile-delete-attempted\.opwj$/),
        expect.stringMatching(/-04-profile-absence-proved\.opwj$/),
      ]);
      for (const name of await readdir(durableRoot)) await rm(resolve(durableRoot, name));

      const faultObject = resolve(root, "fault-fixture.obj");
      const faultExecutable = resolve(root, "fault-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/clang:-Wno-unused-function",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_FAULT_FIXTURE",
          `/Fo${faultObject}`,
          fixturePath,
        ],
        { windowsHide: true },
      );
      execFileSync(
        linkerPath,
        [
          "/nologo",
          `/out:${faultExecutable}`,
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          faultObject,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      for (let phase = 1; phase <= 5; phase += 1) {
        for (let fault = 1; fault <= 13; fault += 1) {
          const result = spawnSync(faultExecutable, ["fault-publication"], {
            input: Buffer.concat([
              Buffer.from([phase, fault]),
              brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
            ]),
            windowsHide: true,
          });
          expect({ phase, fault, status: result.status, stderr: result.stderr }).toEqual({
            phase,
            fault,
            status: 0,
            stderr: Buffer.alloc(0),
          });
          const names = await readdir(durableRoot);
          expect(names.filter((name) => name.endsWith(".pending"))).toEqual([]);
          expect(names).toHaveLength(5);
          for (const name of names) await rm(resolve(durableRoot, name));
        }
      }
      for (let phase = 1; phase <= 4; phase += 1) {
        for (let fault = 1; fault <= 12; fault += 1) {
          const result = spawnSync(faultExecutable, ["fault-execution-publication"], {
            input: Buffer.concat([
              Buffer.from([phase, fault]),
              brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
            ]),
            windowsHide: true,
          });
          expect({ phase, fault, status: result.status, stderr: result.stderr }).toEqual({
            phase,
            fault,
            status: 0,
            stderr: Buffer.alloc(0),
          });
          const names = await readdir(durableRoot);
          expect(names.filter((name) => name.endsWith(".pending"))).toEqual([]);
          for (const name of names) await rm(resolve(durableRoot, name));
        }
      }
      const admissionTransitions: ReadonlyArray<readonly [number, number]> = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [1, 6],
        [2, 6],
        [3, 6],
        [4, 6],
        [5, 6],
        [6, 7],
      ];
      for (const [predecessor, target] of admissionTransitions) {
        for (let fault = 1; fault <= 13; fault += 1) {
          const result = spawnSync(faultExecutable, ["fault-admission-publication"], {
            input: Buffer.concat([
              Buffer.from([predecessor, target, fault]),
              brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
            ]),
            windowsHide: true,
          });
          expect({
            predecessor,
            target,
            fault,
            status: result.status,
            stderr: result.stderr,
          }).toEqual({
            predecessor,
            target,
            fault,
            status: 0,
            stderr: Buffer.alloc(0),
          });
          const names = await readdir(durableRoot);
          expect(names.filter((name) => name.endsWith(".pending"))).toEqual([]);
          for (const name of names) await rm(resolve(durableRoot, name));
        }
      }
      for (let fault = 14; fault <= 22; fault += 1) {
        const result = spawnSync(faultExecutable, ["fault-resources"], {
          input: Buffer.concat([
            Buffer.from([fault]),
            brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
          ]),
          windowsHide: true,
        });
        expect({ fault, status: result.status, stderr: result.stderr }).toEqual({
          fault,
          status: 0,
          stderr: Buffer.alloc(0),
        });
        const names = await readdir(durableRoot);
        expect(names.filter((name) => name.endsWith(".pending"))).toEqual([]);
        expect(names).toHaveLength(5);
        for (const name of names) await rm(resolve(durableRoot, name));
      }

      const profileObject = resolve(root, "profile-fixture.obj");
      const profileExecutable = resolve(root, "profile-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/clang:-Wno-unused-function",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_PROFILE_FIXTURE",
          `/Fo${profileObject}`,
          fixturePath,
        ],
        { windowsHide: true },
      );
      execFileSync(
        linkerPath,
        [
          "/nologo",
          `/out:${profileExecutable}`,
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          profileObject,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      const profileCases = [
        { profileCase: 1, mode: 0 },
        ...Array.from({ length: 36 }, (_, index) => ({ profileCase: index + 4, mode: 0 })),
        { profileCase: 1, mode: 1 },
        { profileCase: 1, mode: 2 },
        ...Array.from({ length: 36 }, (_, index) => ({ profileCase: index + 4, mode: 1 })),
        ...Array.from({ length: 31 }, (_, index) => ({ profileCase: index + 8, mode: 2 })),
      ];
      for (let variant = 1; variant <= 5; variant += 1) {
        const result = spawnSync(profileExecutable, ["mixed-recovery"], {
          input: Buffer.concat([
            Buffer.from([variant]),
            brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
          ]),
          windowsHide: true,
        });
        expect({ variant, status: result.status, stderr: result.stderr }).toEqual({
          variant,
          status: 0,
          stderr: Buffer.alloc(0),
        });
        for (const name of await readdir(durableRoot)) await rm(resolve(durableRoot, name));
      }
      for (const profile of profileCases) {
        const result = spawnSync(profileExecutable, ["profile-control"], {
          input: Buffer.concat([
            Buffer.from([profile.profileCase, profile.mode]),
            brokerFrame(1, profileScope(`\\\\?\\${durableRoot}`)),
          ]),
          windowsHide: true,
        });
        expect({ ...profile, status: result.status, stderr: result.stderr }).toEqual({
          ...profile,
          status: 0,
          stderr: Buffer.alloc(0),
        });
        const names = await readdir(durableRoot);
        expect(names.filter((name) => name.endsWith(".pending"))).toEqual([]);
        expect(names).toHaveLength(5);
        for (const name of names) await rm(resolve(durableRoot, name));
      }
      for (let variant = 1; variant <= 3; variant += 1) {
        const substitutionRoot = await mkdtemp(
          resolve(tmpdir(), "orchestration-windows-broker-substitution-"),
        );
        roots.push(substitutionRoot);
        for (const args of [
          [substitutionRoot, "/inheritance:r"],
          [substitutionRoot, "/grant:r", "SYSTEM:(OI)(CI)F", `${account.stdout.trim()}:(OI)(CI)F`],
          [substitutionRoot, "/setintegritylevel", "(OI)(CI)M"],
        ]) {
          expect(spawnSync("icacls.exe", args, { windowsHide: true }).status).toBe(0);
        }
        const moved =
          variant === 1
            ? `${substitutionRoot}-moved`
            : `${substitutionRoot}-${variant === 2 ? "final" : "pending"}-moved.opwj`;
        const result = spawnSync(profileExecutable, ["substitution"], {
          input: Buffer.concat([
            Buffer.from([variant]),
            brokerFrame(1, profileScope(`\\\\?\\${substitutionRoot}`)),
          ]),
          windowsHide: true,
        });
        expect({ variant, status: result.status, stderr: result.stderr }).toEqual({
          variant,
          status: 0,
          stderr: Buffer.alloc(0),
        });
        const rootState = await stat(substitutionRoot).catch(() => undefined);
        const movedState = await stat(moved).catch(() => undefined);
        expect({
          variant,
          rootDirectory: rootState?.isDirectory(),
          movedDirectory: movedState?.isDirectory(),
        }).toEqual({
          variant,
          rootDirectory: true,
          movedDirectory: variant === 1,
        });
        await rm(substitutionRoot, { force: true, recursive: true });
        await rm(moved, { force: true, recursive: true });
      }

      const lifecycleObject = resolve(root, "lifecycle-fixture.obj");
      const lifecycleExecutable = resolve(root, "lifecycle-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_LIFECYCLE_FIXTURE",
          "/clang:-Wno-unused-function",
          `/Fo${lifecycleObject}`,
          fixturePath,
        ],
        { windowsHide: true },
      );
      execFileSync(
        linkerPath,
        [
          "/nologo",
          `/out:${lifecycleExecutable}`,
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          lifecycleObject,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      const prepare = brokerFrame(
        1,
        executionPrepare([
          "\\\\?\\C:\\fixture-authority-state",
          "\\\\?\\C:\\fixture-execution-parent",
          "\\\\?\\C:\\fixture-node.exe",
          "\\\\?\\C:\\fixture-rpc-runner.mjs",
          "\\\\?\\C:\\fixture-candidate.mjs",
        ]),
      );
      const oversized = brokerFrame(2);
      oversized.writeUInt32LE(1024 * 1024 + 1, 8);
      const truncatedBody = brokerFrame(2);
      truncatedBody.writeUInt32LE(1, 8);
      for (const lifecycle of [
        { scenario: "lifecycle-clean", input: prepare, exit: 65, secondStatus: undefined },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, Buffer.from("OPW", "ascii")]),
          exit: 65,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, oversized]),
          exit: 65,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, truncatedBody]),
          exit: 65,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, prepare]),
          exit: 65,
          secondStatus: 65,
        },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, brokerFrame(3)]),
          exit: 0,
          secondStatus: 0,
        },
        {
          scenario: "lifecycle-clean",
          input: Buffer.concat([prepare, brokerFrame(2)]),
          exit: 78,
          secondStatus: 78,
          admission: true,
        },
        {
          scenario: "lifecycle-cleanup-failure",
          input: prepare,
          exit: 70,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-root-close-failure",
          input: prepare,
          exit: 70,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-execution-cleanup-failure",
          input: prepare,
          exit: 70,
          secondStatus: undefined,
        },
        {
          scenario: "lifecycle-admission-ambiguous",
          input: Buffer.concat([prepare, brokerFrame(2)]),
          exit: 70,
          secondStatus: 70,
          ambiguousAdmission: true,
        },
        {
          scenario: "lifecycle-admission-refused",
          input: Buffer.concat([prepare, brokerFrame(2)]),
          exit: 65,
          secondStatus: 65,
          admission: true,
        },
      ]) {
        const result = spawnSync(lifecycleExecutable, [lifecycle.scenario], {
          input: lifecycle.input,
          windowsHide: true,
        });
        const expectedDiagnostics =
          "ambiguousAdmission" in lifecycle
            ? "fixture:retain-root\nfixture:preflight\nfixture:create-profile\n" +
              "fixture:admission\nfixture:release-root\n"
            : "admission" in lifecycle
              ? "fixture:retain-root\nfixture:preflight\nfixture:create-profile\n" +
                "fixture:admission\nfixture:cleanup-profile\nfixture:release-root\n"
              : lifecycle.scenario === "lifecycle-execution-cleanup-failure"
                ? "fixture:retain-root\nfixture:preflight\nfixture:create-profile\n" +
                  "fixture:cleanup-execution\nfixture:release-root\n"
                : "fixture:retain-root\nfixture:preflight\nfixture:create-profile\n" +
                  "fixture:cleanup-profile\nfixture:release-root\n";
        expect({
          scenario: lifecycle.scenario,
          status: result.status,
          stderr: result.stderr.toString("utf8"),
        }).toEqual({
          scenario: lifecycle.scenario,
          status: lifecycle.exit,
          stderr: expectedDiagnostics,
        });
        expect(result.stderr.toString("utf8")).toBe(expectedDiagnostics);
        expect(result.stdout.subarray(0, 4).toString("ascii")).toBe("OPWB");
        expect(result.stdout[7]).toBe(0);
        const firstLength = 16 + result.stdout.readUInt32LE(8);
        if (lifecycle.secondStatus === undefined) {
          expect(result.stdout.byteLength).toBe(firstLength);
        } else {
          expect(result.stdout.subarray(firstLength, firstLength + 4).toString("ascii")).toBe(
            "OPWB",
          );
          expect(result.stdout[firstLength + 7]).toBe(lifecycle.secondStatus);
          expect(result.stdout.byteLength).toBe(firstLength + 16);
        }
      }

      for (const brokenOutput of ["prepare", "launch"] as const) {
        const child = spawn(lifecycleExecutable, ["lifecycle-clean"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        const diagnostics: Buffer[] = [];
        child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk));
        child.stdin.on("error", () => {});
        const exited = waitForExit(child);
        if (brokenOutput === "prepare") {
          child.stdout.destroy();
          await once(child.stdout, "close");
          child.stdin.end(prepare);
        } else {
          child.stdin.write(prepare);
          const header = await readExactly(child.stdout, 16);
          await readExactly(child.stdout, header.readUInt32LE(8));
          child.stdout.destroy();
          await once(child.stdout, "close");
          child.stdin.end(brokerFrame(2));
        }
        expect(await exited).toBe(65);
        expect(Buffer.concat(diagnostics).toString("utf8")).toBe(
          "fixture:retain-root\nfixture:preflight\nfixture:create-profile\n" +
            (brokenOutput === "launch" ? "fixture:admission\n" : "") +
            "fixture:cleanup-profile\nfixture:release-root\n",
        );
      }

      const executionObject = resolve(root, "execution-fixture.obj");
      const executionExecutable = resolve(root, "execution-fixture.exe");
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
          "/Gy",
          "/Gs9999999",
          "/clang:-fno-builtin",
          "/clang:-Wno-unused-function",
          "/GS-",
          "/Zl",
          "/Brepro",
          "/DUNICODE",
          "/D_UNICODE",
          "/DOP_WINDOWS_EXECUTION_FIXTURE",
          `/Fo${executionObject}`,
          fixturePath,
        ],
        { windowsHide: true },
      );
      execFileSync(
        linkerPath,
        [
          "/nologo",
          `/out:${executionExecutable}`,
          "/libpath:C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64",
          "/entry:fixture_entry",
          "/subsystem:console",
          "/machine:x64",
          "/nodefaultlib",
          "/dynamicbase",
          "/nxcompat",
          "/highentropyva",
          "/Brepro",
          "/opt:ref",
          executionObject,
          ...sdkLibraries.map((library) => library.slice(library.lastIndexOf("/") + 1)),
        ],
        { windowsHide: true },
      );
      const executionCases = [...Array.from({ length: 41 }, (_, index) => index + 1)];
      for (const executionCase of executionCases) {
        const executionState = await mkdtemp(
          resolve(tmpdir(), "orchestration-windows-execution-fixture-state-"),
        );
        const executionParent = await mkdtemp(
          resolve(tmpdir(), "orchestration-windows-execution-fixture-parent-"),
        );
        const sources = await mkdtemp(
          resolve(tmpdir(), "orchestration-windows-execution-fixture-sources-"),
        );
        roots.push(executionState, executionParent, sources);
        const sourceNames =
          executionCase % 2 === 1
            ? ["node.exe", "rpc-runner.mjs", "candidate.mjs"]
            : [
                "source-00-attempted.opwx.pending",
                "source-01-created.opwx.pending",
                "source-02-delete-attempted.opwx.pending",
              ];
        const runtime = resolve(sources, sourceNames[0]!);
        const rpc = resolve(sources, sourceNames[1]!);
        const candidate = resolve(sources, sourceNames[2]!);
        const sourceBytes = [
          Buffer.from("fixture-node-runtime\n"),
          Buffer.from("export default 'rpc';\n"),
          Buffer.from("export default 'candidate';\n"),
        ];
        await writeFile(runtime, sourceBytes[0]!);
        await writeFile(rpc, sourceBytes[1]!);
        await writeFile(candidate, sourceBytes[2]!);
        for (const path of [executionState, executionParent, sources, runtime, rpc, candidate]) {
          for (const args of [
            [path, "/inheritance:r"],
            [path, "/grant:r", "SYSTEM:F", `${account.stdout.trim()}:F`],
            [path, "/setintegritylevel", "M"],
          ]) {
            expect(spawnSync("icacls.exe", args, { windowsHide: true }).status).toBe(0);
          }
        }
        const input = Buffer.concat([
          Buffer.from([executionCase]),
          brokerFrame(
            1,
            executionPrepare([
              `\\\\?\\${executionState}`,
              `\\\\?\\${executionParent}`,
              `\\\\?\\${runtime}`,
              `\\\\?\\${rpc}`,
              `\\\\?\\${candidate}`,
            ]),
          ),
        ]);
        const result = spawnSync(executionExecutable, { input, windowsHide: true });
        expect({
          executionCase,
          status: result.status,
          stderr: result.stderr,
          stdout: result.stdout,
        }).toEqual({
          executionCase,
          status: 0,
          stderr: Buffer.alloc(0),
          stdout: Buffer.alloc(0),
        });
        expect(await Promise.all([runtime, rpc, candidate].map((path) => readFile(path)))).toEqual(
          sourceBytes,
        );
      }
    },
    600_000,
  );

  test.runIf(process.platform === "win32")(
    "refuses non-modes and requires one canonical frame for both modes",
    () => {
      for (const value of [[], ["UNKNOWN"], ["SERVE", "extra"], ["RECOVER", "extra"]]) {
        const result = spawnSync(imagePath, value, { encoding: "utf8", windowsHide: true });
        expect(result).toMatchObject({
          status: 64,
          stderr: "windows-broker:arguments\n",
          stdout: "",
        });
      }
      expect(
        spawnSync(imagePath, ["SERVE"], { encoding: "utf8", windowsHide: true }),
      ).toMatchObject({
        status: 65,
        stderr: "windows-broker:protocol\n",
        stdout: "",
      });
      expect(
        spawnSync(imagePath, ["RECOVER"], { encoding: "utf8", windowsHide: true }),
      ).toMatchObject({ status: 65, stderr: "windows-broker:protocol\n", stdout: "" });
    },
  );

  test.runIf(process.platform === "win32")(
    "refuses wrong-order operations and nonexistent authenticated state roots",
    () => {
      for (const operation of [2, 3]) {
        const request = brokerFrame(
          operation,
          operation === 2 ? Buffer.from("x", "utf8") : undefined,
        );
        const result = spawnSync(imagePath, ["SERVE"], {
          input: request,
          windowsHide: true,
        });
        expect(result.status).toBe(65);
        expect(result.stderr).toEqual(Buffer.alloc(0));
        expect(result.stdout).toEqual(responseFrame(operation, 65));
      }
      const missingRoot = "\\\\?\\C:\\orchestration-missing-profile-root";
      const missingPrepare = executionPrepare([
        missingRoot,
        "\\\\?\\C:\\orchestration-missing-execution-parent",
        "\\\\?\\C:\\orchestration-missing-node.exe",
        "\\\\?\\C:\\orchestration-missing-rpc.mjs",
        "\\\\?\\C:\\orchestration-missing-candidate.mjs",
      ]);
      const prepare = spawnSync(imagePath, ["SERVE"], {
        input: brokerFrame(1, missingPrepare),
        windowsHide: true,
      });
      expect(prepare).toMatchObject({ status: 65, stderr: Buffer.alloc(0) });
      expect(prepare.stdout).toEqual(responseFrame(1, 65));
      const recover = spawnSync(imagePath, ["RECOVER"], {
        input: brokerFrame(3, profileScope(missingRoot)),
        windowsHide: true,
      });
      expect(recover).toMatchObject({ status: 65, stderr: Buffer.alloc(0) });
      expect(recover.stdout).toEqual(responseFrame(3, 65));
    },
  );

  test.runIf(process.platform === "win32")(
    "refuses malformed, unknown, oversized, and truncated frames without a response",
    () => {
      const wrongMagic = Array.from({ length: 4 }, (_, index) => {
        const frame = brokerFrame(1);
        frame[index] = 0;
        return frame;
      });
      const wrongVersion = brokerFrame(1);
      wrongVersion[4] = 2;
      const wrongKind = brokerFrame(1);
      wrongKind[5] = 2;
      const requestStatus = brokerFrame(1);
      requestStatus[7] = 1;
      const reserved = Array.from({ length: 4 }, (_, index) => {
        const frame = brokerFrame(1);
        frame[12 + index] = 1;
        return frame;
      });
      const oversized = brokerFrame(1);
      oversized.writeUInt32LE(4 * 1024 * 1024 + 1, 8);
      const truncated = brokerFrame(1);
      truncated.writeUInt32LE(1, 8);
      const partialMultiChunk = brokerFrame(1, Buffer.alloc(4096));
      partialMultiChunk.writeUInt32LE(4097, 8);
      for (const input of [
        ...Array.from({ length: 16 }, (_, index) => brokerFrame(1).subarray(0, index)),
        ...wrongMagic,
        brokerFrame(0),
        brokerFrame(4),
        brokerFrame(255),
        wrongVersion,
        wrongKind,
        requestStatus,
        ...reserved,
        oversized,
        truncated,
        partialMultiChunk,
      ]) {
        const result = spawnSync(imagePath, ["SERVE"], { input, windowsHide: true });
        expect(result.status).toBe(65);
        expect(result.stderr.toString("utf8")).toBe("windows-broker:protocol\n");
        expect(result.stdout).toEqual(Buffer.alloc(0));
      }
    },
  );

  test.runIf(process.platform === "win32")(
    "accepts only the closed five-path execution-prepare arm",
    () => {
      const canonicalPaths = [
        "\\\\?\\C:\\orchestration-missing-profile-root",
        "\\\\?\\C:\\orchestration-missing-execution-parent",
        "\\\\?\\C:\\orchestration-missing-node.exe",
        "\\\\?\\C:\\orchestration-missing-rpc.mjs",
        "\\\\?\\C:\\orchestration-missing-candidate.mjs",
      ] as const;
      const canonical = executionPrepare(canonicalPaths);
      const byteMutants = Array.from({ length: 20 }, (_, index) => {
        const mutant = Buffer.from(canonical);
        mutant[index] = mutant[index]! ^ 0xff;
        return mutant;
      });
      const countZero = Buffer.from(canonical);
      countZero.writeUInt16LE(0, 8);
      const countOverBound = Buffer.from(canonical);
      countOverBound.writeUInt16LE(1025, 8);
      const trailing = Buffer.concat([canonical, Buffer.from([0])]);
      const invalidPaths = [
        "\\\\?\\c:\\lower-drive",
        "\\\\?\\C:\\",
        "\\\\?\\C:\\trailing\\",
        "\\\\?\\C:\\empty\\\\segment",
        "\\\\?\\C:\\.\\segment",
        "\\\\?\\C:\\..\\segment",
        "\\\\?\\C:\\forward/slash",
        "\\\\?\\C:\\alternate:stream",
        "\\\\?\\C:\\wild*card",
        "\\\\?\\C:\\nul\0unit",
        `\\\\?\\C:\\surrogate${String.fromCharCode(0xd800)}`,
      ].map((path) =>
        executionPrepare([
          path,
          canonicalPaths[1],
          canonicalPaths[2],
          canonicalPaths[3],
          canonicalPaths[4],
        ]),
      );
      for (const payload of [
        ...byteMutants,
        countZero,
        countOverBound,
        trailing,
        ...invalidPaths,
      ]) {
        const result = spawnSync(imagePath, ["SERVE"], {
          input: brokerFrame(1, payload),
          windowsHide: true,
        });
        expect(result.status).toBe(65);
        expect(result.stderr.toString("utf8")).toBe("windows-broker:protocol\n");
        expect(result.stdout).toEqual(Buffer.alloc(0));
      }
    },
  );

  test.runIf(process.platform === "win32")(
    "rebuilds byte-identically with the reviewed development toolchain",
    async () => {
      execFileSync(clangPath, ["--version"], { windowsHide: true });
      await Promise.all(sdkLibraries.map(async (library) => await readFile(library)));
      const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-broker-test-"));
      roots.push(root);
      for (const name of ["first.exe", "second.exe"]) {
        const output = resolve(root, name);
        execFileSync(process.execPath, [buildPath, output], { windowsHide: true });
        expect(await readFile(output)).toEqual(await readFile(imagePath));
      }
    },
  );

  test("keeps broker implementation outside the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(Object.keys(publicSurface).sort()).toEqual([
      "addCompleteDays",
      "canonicalByteLength",
      "computeConformanceRecordDigest",
      "computeConformanceVectorBytesDigest",
      "computeConformanceVectorGeneratorDigest",
      "conformanceArchitectures",
      "conformanceBundlePurposes",
      "conformanceEnvironmentFamilies",
      "conformanceFixtureDispositions",
      "conformanceFixtureKinds",
      "conformanceRequirementKinds",
      "conformanceResults",
      "conformanceRunnerTokens",
      "conformanceSchemaFields",
      "conformanceSchemaVersions",
      "conformanceWalkRequirements",
      "consumeConformanceCandidateMaterialization",
      "createConformanceBundleManifest",
      "createConformanceJobEvidence",
      "createIss002ContractVersions",
      "createIss002RequiredJobRegistry",
      "createIss002StableBundleManifests",
      "createIss002VectorCensus",
      "environmentFamilyForJob",
      "iss002HarnessPaths",
      "iss002TestBundlePaths",
      "iss002VectorIds",
      "parseCanonicalConformanceBytes",
      "parseConformanceAggregate",
      "parseConformanceBundleManifest",
      "parseConformanceCandidateSubject",
      "parseConformanceContract",
      "parseConformanceContractVersions",
      "parseConformanceEnvironment",
      "parseConformanceJobReceipt",
      "parseConformanceRawArtifactManifest",
      "parseConformanceRequiredJobRegistry",
      "parseConformanceVectorCensus",
      "reduceConformanceAggregate",
      "runIss002CrossRootWalk",
      "runIss002WalkIntervals",
      "serializeConformanceContract",
      "sha256Bytes",
      "verifyConformanceBundleManifest",
    ]);
    expect(
      JSON.parse(
        await readFile(
          resolve(import.meta.dirname, "../../packages/conformance/package.json"),
          "utf8",
        ),
      ).exports,
    ).toEqual({
      ".": { default: "./src/index.ts", types: "./src/index.ts" },
      "./github-actions": {
        default: "./src/github-actions/index.ts",
        types: "./src/github-actions/index.ts",
      },
    });
  });
});

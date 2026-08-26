import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const sdkLibrary = "C:/Program Files (x86)/Windows Kits/10/Lib/10.0.18362.0/um/x64/kernel32.lib";
const roots: string[] = [];

const brokerFrame = (operation: number, payload = Buffer.alloc(0)): Buffer => {
  const frame = Buffer.alloc(16 + payload.byteLength);
  frame.write("OPWB", 0, "ascii");
  frame[4] = 1;
  frame[5] = 1;
  frame[6] = operation;
  frame.writeUInt32LE(payload.byteLength, 8);
  payload.copy(frame, 16);
  return frame;
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
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true })));
});

describe("private Windows isolation broker bootstrap", () => {
  test("pins one deterministic X64 PE with a closed Kernel32 import census", async () => {
    const image = await readFile(imagePath);
    expect(image.subarray(0, 2).toString("ascii")).toBe("MZ");
    const peOffset = image.readUInt32LE(0x3c);
    expect(image.subarray(peOffset, peOffset + 4).toString("binary")).toBe("PE\0\0");
    expect(image.readUInt16LE(peOffset + 4)).toBe(0x8664);
    expect(image.readUInt16LE(peOffset + 24)).toBe(0x20b);
    expect(image.byteLength).toBe(4096);
    expect(createHash("sha256").update(image).digest("hex")).toBe(
      "dd36eb25deb580d3de3c796e60d3bd7eca4f57bfa447517197c2c9d3a9c2bad0",
    );
    const census = peCensus(image);
    expect(census).toEqual({
      delayImports: { rva: 0, size: 0 },
      dllCharacteristics: expect.any(Number),
      importDirectory: { rva: expect.any(Number), size: 40 },
      imports: [
        {
          library: "KERNEL32.dll",
          symbols: ["ExitProcess", "GetCommandLineW", "GetStdHandle", "ReadFile", "WriteFile"],
        },
      ],
      relocations: { rva: expect.any(Number), size: 12 },
    });
    expect(census.dllCharacteristics & 0x160).toBe(0x160);
    expect(census.importDirectory.rva).toBeGreaterThan(0);
    expect(census.relocations.rva).toBeGreaterThan(0);
    const strings = image.toString("latin1");
    for (const forbidden of ["cmd.exe", "powershell", "CreateProcess", "ShellExecute", "WinExec"])
      expect(strings).not.toContain(forbidden);
  });

  test("source exposes exactly SERVE and RECOVER and no general command surface", async () => {
    const source = await readFile(sourcePath, "utf8");
    expect([...source.matchAll(/same_text\(mode, ([a-z_]+)\)/g)].map((match) => match[1])).toEqual([
      "serve_mode",
      "recover_mode",
    ]);
    for (const forbidden of ["system(", "CreateProcess", "ShellExecute", "WinExec", "LoadLibrary"])
      expect(source).not.toContain(forbidden);
    expect(source).toContain('#error "windows-isolation-broker.c is Windows-only"');
    expect(source).toContain('#error "windows-isolation-broker.c requires X64"');
  });

  test.runIf(process.platform === "win32")(
    "refuses non-modes and reports both unwired modes",
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
      ).toMatchObject({
        status: 78,
        stderr: "windows-broker:recover-not-implemented\n",
        stdout: "",
      });
    },
  );

  test.runIf(process.platform === "win32")(
    "admits only the three closed transition frame opcodes and grants none authority",
    () => {
      for (const operation of [1, 2, 3]) {
        const payload =
          operation === 1
            ? Buffer.alloc(1024 * 1024, 165)
            : operation === 2
              ? Buffer.from([operation, 0, 255])
              : Buffer.alloc(0);
        const request = brokerFrame(operation, payload);
        const result = spawnSync(imagePath, ["SERVE"], {
          input: request,
          windowsHide: true,
        });
        const response = brokerFrame(operation);
        response[5] = 2;
        response[7] = 78;
        expect(result.status).toBe(78);
        expect(result.stderr).toEqual(Buffer.alloc(0));
        expect(result.stdout).toEqual(response);
      }
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
      oversized.writeUInt32LE(1024 * 1024 + 1, 8);
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
    "rebuilds byte-identically with the reviewed development toolchain",
    async () => {
      execFileSync(clangPath, ["--version"], { windowsHide: true });
      await readFile(sdkLibrary);
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

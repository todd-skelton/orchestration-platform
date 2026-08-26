import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const clang = "C:/Program Files/LLVM/bin/clang-cl.exe";
const linker = "C:/Program Files/LLVM/bin/lld-link.exe";
const sdk = "C:/Program Files (x86)/Windows Kits/10";
const sdkVersion = "10.0.18362.0";
const source = resolve(repositoryRoot, "packages/conformance/src/windows-isolation-broker.c");
const destination = resolve(
  repositoryRoot,
  "packages/conformance/src/windows-isolation-broker-x64.exe",
);

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Windows X64 development host required");

const root = await mkdtemp(resolve(tmpdir(), "orchestration-windows-broker-"));
const object = resolve(root, "windows-isolation-broker.obj");
const output = process.argv[2] ? resolve(process.argv[2]) : destination;
const diagnosticVariant = process.argv[3];
const diagnosticDefine =
  diagnosticVariant === undefined
    ? undefined
    : diagnosticVariant === "pause-after-attempted"
      ? "/DOP_WINDOWS_PAUSE_AFTER_ATTEMPTED"
      : diagnosticVariant === "pause-after-create"
        ? "/DOP_WINDOWS_PAUSE_AFTER_CREATE"
        : (() => {
            throw new Error("unknown Windows broker diagnostic variant");
          })();

try {
  const version = await execFileAsync(clang, ["--version"], { windowsHide: true });
  if (!version.stdout.startsWith("clang version 22.1.8 "))
    throw new Error("exact LLVM 22.1.8 required");
  const linkerVersion = await execFileAsync(linker, ["--version"], { windowsHide: true });
  if (!linkerVersion.stdout.startsWith("LLD 22.1.8")) throw new Error("exact LLD 22.1.8 required");
  await execFileAsync(
    clang,
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
      ...(diagnosticDefine === undefined ? [] : [diagnosticDefine]),
      `/Fo${object}`,
      `/I${resolve(sdk, "Include", sdkVersion, "shared")}`,
      `/I${resolve(sdk, "Include", sdkVersion, "um")}`,
      `/I${resolve(sdk, "Include", sdkVersion, "ucrt")}`,
      source,
    ],
    { windowsHide: true },
  );
  await execFileAsync(
    linker,
    [
      "/nologo",
      `/out:${output}`,
      `/libpath:${resolve(sdk, "Lib", sdkVersion, "um", "x64")}`,
      "/entry:broker_entry",
      "/subsystem:console",
      "/machine:x64",
      "/nodefaultlib",
      "/dynamicbase",
      "/nxcompat",
      "/highentropyva",
      "/Brepro",
      object,
      "kernel32.lib",
      "userenv.lib",
      "api-ms-win-net-isolation-l1-1-0.lib",
      "advapi32.lib",
      "ole32.lib",
      "bcrypt.lib",
    ],
    { windowsHide: true },
  );
  if ((await readFile(output)).byteLength === 0) throw new Error("empty broker image");
} finally {
  await rm(root, { force: true, recursive: true });
}

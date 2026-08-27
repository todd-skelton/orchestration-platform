import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, toNamespacedPath } from "node:path";
import { types as nodeTypes } from "node:util";
import type {
  Iss002IsolatedTerminalObservation,
  Iss002IsolationLaunchRequest,
  Iss002StableIsolationAuthority,
} from "./isolated-walk.js";

const nativeHostPlatform = process.platform;
const maximumChallengeBytes = 4 * 1024 * 1024;
const maximumControlDiagnosticBytes = 64 * 1024;
const maximumTerminalPayloadBytes = 16 + 2 * maximumChallengeBytes;
const controlWatchdogMilliseconds = 20_000;
const expectedSourceDigest = "8767cd1116a193beca552a26fa397da6ae7f4ef8161d98705a90c16a887a5396";
const expectedImageDigest = "feb5c14f30a5ef289a5fb357e345673917c30c22c4ab7e1800f6e502c8cd03a4";
const sourcePath = fileURLToPath(new URL("./windows-isolation-broker.c", import.meta.url));
const imagePath = fileURLToPath(new URL("./windows-isolation-broker-x64.exe", import.meta.url));

const prepareOperation = 1;
const launchOperation = 2;
const teardownOperation = 3;

export interface WindowsIsolationAuthorityOptions {
  readonly executionParent: string;
  readonly runtimePath: string;
  readonly stateRoot: string;
}

interface ExactFileIdentity {
  readonly ctimeNanoseconds: string;
  readonly device: string;
  readonly inode: string;
  readonly links: string;
  readonly mtimeNanoseconds: string;
  readonly size: string;
}

interface RetainedBundle {
  readonly image: FileHandle;
  readonly imageIdentity: ExactFileIdentity;
  readonly source: FileHandle;
  readonly sourceIdentity: ExactFileIdentity;
}

interface DetachedRequest extends Iss002IsolationLaunchRequest {
  readonly candidateArtifactPath: string;
  readonly rpcRunnerPath: string;
}

interface PrincipalState {
  broker: BrokerCommand;
  bundle: RetainedBundle;
  busy: boolean;
  lifecycle:
    | "CREATED"
    | "PREPARING"
    | "PREPARED"
    | "LAUNCHING"
    | "AWAIT_TEARDOWN"
    | "RECOVERY_REQUIRED"
    | "TEARING_DOWN"
    | "PERMANENT_FAILURE";
  prepared?: DetachedRequest;
}

interface ResponseFrame {
  readonly operation: number;
  readonly payload: Buffer<ArrayBufferLike>;
  readonly status: number;
}

function refusal(label: string): TypeError {
  return new TypeError(`windows-isolation:${label}`);
}

function exactIdentity(value: BigIntStats): ExactFileIdentity {
  if (!value.isFile() || value.isDirectory() || value.isSymbolicLink() || value.nlink !== 1n)
    throw refusal("bundle-profile-refused");
  if (value.size <= 0n || value.size > 512n * 1024n * 1024n) throw refusal("bundle-size-refused");
  return Object.freeze({
    ctimeNanoseconds: String(value.ctimeNs),
    device: String(value.dev),
    inode: String(value.ino),
    links: String(value.nlink),
    mtimeNanoseconds: String(value.mtimeNs),
    size: String(value.size),
  });
}

function sameIdentity(left: ExactFileIdentity, right: ExactFileIdentity): boolean {
  return (Object.keys(left) as (keyof ExactFileIdentity)[]).every(
    (field) => left[field] === right[field],
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const expectedImports = Object.freeze([
  Object.freeze({
    library: "KERNEL32.dll",
    symbols: Object.freeze([
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
    ]),
  }),
  Object.freeze({
    library: "USERENV.dll",
    symbols: Object.freeze([
      "CreateAppContainerProfile",
      "DeleteAppContainerProfile",
      "DeriveAppContainerSidFromAppContainerName",
      "GetAppContainerFolderPath",
    ]),
  }),
  Object.freeze({
    library: "api-ms-win-net-isolation-l1-1-0.dll",
    symbols: Object.freeze([
      "NetworkIsolationEnumAppContainers",
      "NetworkIsolationFreeAppContainers",
    ]),
  }),
  Object.freeze({
    library: "ADVAPI32.dll",
    symbols: Object.freeze([
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
    ]),
  }),
  Object.freeze({ library: "ole32.dll", symbols: Object.freeze(["CoTaskMemFree"]) }),
  Object.freeze({
    library: "bcrypt.dll",
    symbols: Object.freeze([
      "BCryptCloseAlgorithmProvider",
      "BCryptCreateHash",
      "BCryptDestroyHash",
      "BCryptFinishHash",
      "BCryptGenRandom",
      "BCryptGetProperty",
      "BCryptHashData",
      "BCryptOpenAlgorithmProvider",
    ]),
  }),
]);

function requireClosedImports(
  image: Buffer,
  optionalOffset: number,
  optionalBytes: number,
  sectionCount: number,
): void {
  const sectionOffset = optionalOffset + optionalBytes;
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const offset = sectionOffset + index * 40;
    return Object.freeze({
      rawOffset: image.readUInt32LE(offset + 20),
      rawSize: image.readUInt32LE(offset + 16),
      virtualAddress: image.readUInt32LE(offset + 12),
      virtualSize: image.readUInt32LE(offset + 8),
    });
  });
  const rawOffsetFor = (rva: number): number => {
    const section = sections.find(
      (value) =>
        rva >= value.virtualAddress &&
        rva < value.virtualAddress + Math.max(value.virtualSize, value.rawSize),
    );
    if (!section) throw refusal("image-import-rva-refused");
    const offset = section.rawOffset + rva - section.virtualAddress;
    if (offset < section.rawOffset || offset >= section.rawOffset + section.rawSize)
      throw refusal("image-import-rva-refused");
    return offset;
  };
  const importRva = image.readUInt32LE(optionalOffset + 112 + 8);
  const importSize = image.readUInt32LE(optionalOffset + 116 + 8);
  const importOffset = rawOffsetFor(importRva);
  const importLimit = importOffset + importSize;
  if (importLimit > image.byteLength) throw refusal("image-import-bound-refused");
  const readCString = (offset: number): string => {
    if (offset < 0 || offset >= image.byteLength) throw refusal("image-import-string-refused");
    const end = image.indexOf(0, offset);
    if (end < offset || end - offset > 256) throw refusal("image-import-string-refused");
    const bytes = image.subarray(offset, end);
    if ([...bytes].some((byte) => byte < 0x20 || byte > 0x7e))
      throw refusal("image-import-string-refused");
    return bytes.toString("ascii");
  };
  const observed: Array<{ library: string; symbols: string[] }> = [];
  for (let descriptor = importOffset; descriptor + 20 <= importLimit; descriptor += 20) {
    const fields = Array.from({ length: 5 }, (_, index) =>
      image.readUInt32LE(descriptor + index * 4),
    );
    if (fields.every((field) => field === 0)) break;
    const lookupRva = fields[0]!;
    const nameRva = fields[3]!;
    const addressRva = fields[4]!;
    if (nameRva === 0 || (lookupRva === 0 && addressRva === 0))
      throw refusal("image-import-descriptor-refused");
    const symbols: string[] = [];
    let thunk = rawOffsetFor(lookupRva || addressRva);
    for (let count = 0; count < 256; count += 1) {
      if (thunk + 8 > image.byteLength) throw refusal("image-import-thunk-refused");
      const value = image.readBigUInt64LE(thunk);
      if (value === 0n) break;
      if ((value & (1n << 63n)) !== 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
        throw refusal("image-import-thunk-refused");
      symbols.push(readCString(rawOffsetFor(Number(value)) + 2));
      thunk += 8;
      if (count === 255) throw refusal("image-import-count-refused");
    }
    observed.push({ library: readCString(rawOffsetFor(nameRva)), symbols });
  }
  if (JSON.stringify(observed) !== JSON.stringify(expectedImports))
    throw refusal("image-import-census-refused");
}

function requireReviewedImage(image: Buffer): void {
  if (image.byteLength !== 97_792 || sha256(image) !== expectedImageDigest)
    throw refusal("image-digest-refused");
  if (image.subarray(0, 2).toString("ascii") !== "MZ" || image.byteLength < 0x40)
    throw refusal("image-format-refused");
  const peOffset = image.readUInt32LE(0x3c);
  if (
    peOffset < 0x40 ||
    peOffset + 24 > image.byteLength ||
    image.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0" ||
    image.readUInt16LE(peOffset + 4) !== 0x8664
  )
    throw refusal("image-machine-refused");
  const sectionCount = image.readUInt16LE(peOffset + 6);
  const optionalBytes = image.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  if (
    sectionCount === 0 ||
    sectionCount > 32 ||
    optionalBytes < 240 ||
    optionalOffset + optionalBytes + sectionCount * 40 > image.byteLength ||
    image.readUInt16LE(optionalOffset) !== 0x20b ||
    (image.readUInt16LE(optionalOffset + 70) & 0x160) !== 0x160 ||
    image.readUInt32LE(optionalOffset + 112 + 8) === 0 ||
    image.readUInt32LE(optionalOffset + 116 + 8) !== 140 ||
    image.readUInt32LE(optionalOffset + 112 + 5 * 8) === 0 ||
    image.readUInt32LE(optionalOffset + 116 + 5 * 8) !== 72 ||
    image.readUInt32LE(optionalOffset + 112 + 13 * 8) !== 0 ||
    image.readUInt32LE(optionalOffset + 116 + 13 * 8) !== 0
  )
    throw refusal("image-layout-refused");
  requireClosedImports(image, optionalOffset, optionalBytes, sectionCount);
  const text = image.toString("latin1");
  for (const forbidden of ["cmd.exe", "powershell", "ShellExecute", "WinExec"])
    if (text.includes(forbidden)) throw refusal("image-command-surface-refused");
}

async function readRetained(handle: FileHandle): Promise<Buffer> {
  const identity = exactIdentity(await handle.stat({ bigint: true }));
  const size = Number(identity.size);
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) throw refusal("bundle-short-read");
    offset += result.bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  if ((await handle.read(trailing, 0, 1, size)).bytesRead !== 0)
    throw refusal("bundle-growth-refused");
  if (!sameIdentity(identity, exactIdentity(await handle.stat({ bigint: true }))))
    throw refusal("bundle-handle-moved");
  return bytes;
}

async function openReviewedBundle(): Promise<RetainedBundle> {
  let source: FileHandle | undefined;
  let image: FileHandle | undefined;
  try {
    source = await open(sourcePath, "r");
    image = await open(imagePath, "r");
    const sourceIdentity = exactIdentity(await source.stat({ bigint: true }));
    const imageIdentity = exactIdentity(await image.stat({ bigint: true }));
    const sourceBytes = await readRetained(source);
    const imageBytes = await readRetained(image);
    if (sha256(sourceBytes) !== expectedSourceDigest) throw refusal("source-digest-refused");
    requireReviewedImage(imageBytes);
    const retained = Object.freeze({ image, imageIdentity, source, sourceIdentity });
    await verifyReviewedBundle(retained);
    return retained;
  } catch (error) {
    const closes = await Promise.allSettled(
      [source, image]
        .filter((handle): handle is FileHandle => handle !== undefined)
        .map(async (handle) => await handle.close()),
    );
    const closeFailures = closes.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (closeFailures.length !== 0)
      throw new AggregateError(
        [error, ...closeFailures],
        "windows-isolation:bundle-open-close-refused",
      );
    throw error;
  }
}

async function verifyCurrentFile(
  path: string,
  retained: FileHandle,
  identity: ExactFileIdentity,
  expectedDigest: string,
): Promise<Buffer> {
  const retainedBytes = await readRetained(retained);
  if (
    !sameIdentity(identity, exactIdentity(await retained.stat({ bigint: true }))) ||
    sha256(retainedBytes) !== expectedDigest
  )
    throw refusal("bundle-retained-drift");
  const current = await open(path, "r");
  try {
    const currentIdentity = exactIdentity(await current.stat({ bigint: true }));
    const currentBytes = await readRetained(current);
    if (!sameIdentity(identity, currentIdentity) || !currentBytes.equals(retainedBytes))
      throw refusal("bundle-path-moved");
    return currentBytes;
  } finally {
    await current.close();
  }
}

async function verifyReviewedBundle(bundle: RetainedBundle): Promise<void> {
  const [sourceBytes, imageBytes] = await Promise.all([
    verifyCurrentFile(sourcePath, bundle.source, bundle.sourceIdentity, expectedSourceDigest),
    verifyCurrentFile(imagePath, bundle.image, bundle.imageIdentity, expectedImageDigest),
  ]);
  if (sha256(sourceBytes) !== expectedSourceDigest) throw refusal("source-digest-refused");
  requireReviewedImage(imageBytes);
}

async function closeReviewedBundle(bundle: RetainedBundle): Promise<void> {
  await verifyReviewedBundle(bundle);
  const results = await Promise.allSettled([bundle.source.close(), bundle.image.close()]);
  if (results.some((result) => result.status === "rejected")) throw refusal("bundle-close-refused");
}

function ownDataObject(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    value[field] = descriptor.value;
  }
  return value;
}

async function canonicalPath(value: unknown): Promise<string> {
  if (typeof value !== "string" || !isAbsolute(value)) throw refusal("path-refused");
  const canonical = await realpath(value);
  const namespaced = toNamespacedPath(canonical);
  if (!/^\\\\\?\\[A-Z]:\\/.test(namespaced) || namespaced.endsWith("\\"))
    throw refusal("path-canonical-refused");
  if (namespaced.length > 1024) throw refusal("path-length-refused");
  return namespaced;
}

async function detachedOptions(
  input: unknown,
): Promise<Readonly<WindowsIsolationAuthorityOptions>> {
  const value = ownDataObject(input, ["executionParent", "runtimePath", "stateRoot"]);
  if (!value) throw refusal("options-refused");
  return Object.freeze({
    executionParent: await canonicalPath(value.executionParent),
    runtimePath: await canonicalPath(value.runtimePath),
    stateRoot: await canonicalPath(value.stateRoot),
  });
}

async function detachedRequest(input: unknown): Promise<DetachedRequest> {
  const value = ownDataObject(input, [
    "candidateArtifactPath",
    "inputText",
    "rpcRunnerPath",
    "timeoutMilliseconds",
  ]);
  if (
    !value ||
    typeof value.inputText !== "string" ||
    value.timeoutMilliseconds !== 5000 ||
    Buffer.byteLength(value.inputText, "utf8") < 1 ||
    Buffer.byteLength(value.inputText, "utf8") > maximumChallengeBytes
  )
    throw refusal("launch-request-refused");
  return Object.freeze({
    candidateArtifactPath: await canonicalPath(value.candidateArtifactPath),
    inputText: value.inputText,
    rpcRunnerPath: await canonicalPath(value.rpcRunnerPath),
    timeoutMilliseconds: 5000,
  });
}

function sameRequest(left: DetachedRequest, right: DetachedRequest): boolean {
  return (
    left.candidateArtifactPath === right.candidateArtifactPath &&
    left.inputText === right.inputText &&
    left.rpcRunnerPath === right.rpcRunnerPath &&
    left.timeoutMilliseconds === right.timeoutMilliseconds
  );
}

function requestFrame(
  operation: number,
  payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): Buffer {
  if (payload.byteLength > maximumChallengeBytes) throw refusal("frame-size-refused");
  const frame = Buffer.alloc(16 + payload.byteLength);
  frame.write("OPWB", 0, "ascii");
  frame[4] = 1;
  frame[5] = 1;
  frame[6] = operation;
  frame.writeUInt32LE(payload.byteLength, 8);
  payload.copy(frame, 16);
  return frame;
}

function pathPayload(magic: "OPWP" | "OPWE", paths: readonly string[]): Buffer {
  const values = paths.map((path) => Buffer.from(path, "utf16le"));
  if (paths.some((path) => path.length < 1 || path.length > 1024))
    throw refusal("path-length-refused");
  const prefix = magic === "OPWP" ? 12 : 20;
  if ((magic === "OPWP" && paths.length !== 1) || (magic === "OPWE" && paths.length !== 5))
    throw refusal("path-count-refused");
  const payload = Buffer.alloc(prefix + values.reduce((sum, value) => sum + value.byteLength, 0));
  payload.write(magic, 0, "ascii");
  payload[4] = 1;
  payload[5] = 1;
  let cursor = prefix;
  for (const [index, value] of values.entries()) {
    payload.writeUInt16LE(paths[index]!.length, 8 + index * 2);
    value.copy(payload, cursor);
    cursor += value.byteLength;
  }
  return payload;
}

class BoundedDiagnostic {
  readonly chunks: Buffer[] = [];
  bytes = 0;
  failed = false;
  ended = false;
  private readonly waiters = new Set<() => void>();

  constructor(stream: NodeJS.ReadableStream) {
    stream.on("data", (chunk: Buffer) => {
      const copy = Buffer.from(chunk);
      this.bytes += copy.byteLength;
      if (this.bytes > maximumControlDiagnosticBytes) this.failed = true;
      if (!this.failed) this.chunks.push(copy);
    });
    stream.once("error", () => {
      this.failed = true;
      this.wake();
    });
    stream.once("end", () => {
      this.ended = true;
      this.wake();
    });
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private async changed(): Promise<void> {
    await new Promise<void>((resolvePromise) => this.waiters.add(resolvePromise));
  }

  requireEmpty(): void {
    if (this.failed || this.bytes !== 0) throw refusal("broker-diagnostic-refused");
  }

  async requireEnd(): Promise<void> {
    while (!this.ended && !this.failed) await this.changed();
    this.requireEmpty();
  }
}

class BoundedReader {
  private readonly chunks: Buffer[] = [];
  private ended = false;
  private failure: unknown;
  private length = 0;
  private readonly waiters = new Set<() => void>();

  constructor(stream: NodeJS.ReadableStream) {
    stream.on("data", (chunk: Buffer) => {
      const copy = Buffer.from(chunk);
      if (this.length + copy.byteLength > maximumTerminalPayloadBytes + 32) {
        this.failure = refusal("broker-output-overflow");
        this.chunks.length = 0;
        this.length = 0;
        this.wake();
        return;
      }
      this.chunks.push(copy);
      this.length += copy.byteLength;
      this.wake();
    });
    stream.once("end", () => {
      this.ended = true;
      this.wake();
    });
    stream.once("error", (error) => {
      this.failure = error;
      this.wake();
    });
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private async changed(): Promise<void> {
    await new Promise<void>((resolvePromise) => this.waiters.add(resolvePromise));
  }

  async read(length: number): Promise<Buffer> {
    while (this.length < length && !this.ended && this.failure === undefined) await this.changed();
    if (this.failure !== undefined) throw refusal("broker-output-error");
    if (this.length < length) throw refusal("broker-output-truncated");
    const output = Buffer.allocUnsafe(length);
    let cursor = 0;
    while (cursor < length) {
      const chunk = this.chunks[0]!;
      const count = Math.min(length - cursor, chunk.byteLength);
      chunk.copy(output, cursor, 0, count);
      cursor += count;
      this.length -= count;
      if (count === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = Buffer.from(chunk.subarray(count));
    }
    return output;
  }

  async requireEnd(): Promise<void> {
    while (!this.ended && this.failure === undefined) await this.changed();
    if (this.failure !== undefined || this.length !== 0) throw refusal("broker-output-trailing");
  }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(refusal(label)), controlWatchdogMilliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class BrokerCommand {
  readonly child: ChildProcessWithoutNullStreams;
  readonly reader: BoundedReader;
  readonly stderr: BoundedDiagnostic;
  private readonly closed: Promise<readonly [number | null, NodeJS.Signals | null]>;
  private failure: unknown;
  private inputEnded = false;

  constructor(mode: "RECOVER" | "SERVE") {
    this.child = spawn(imagePath, [mode], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      env: Object.create(null) as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.reader = new BoundedReader(this.child.stdout);
    this.stderr = new BoundedDiagnostic(this.child.stderr);
    this.child.once("error", (error) => {
      this.failure = error;
    });
    this.child.stdin.once("error", (error) => {
      this.failure = error;
    });
    this.closed = new Promise((resolvePromise) => {
      this.child.once("close", (code, signal) => resolvePromise([code, signal]));
    });
  }

  requireNoDiagnostic(): void {
    this.stderr.requireEmpty();
    if (this.failure !== undefined) throw refusal("broker-control-refused");
  }

  async write(bytes: Buffer<ArrayBufferLike>, end: boolean): Promise<void> {
    if (this.inputEnded || this.failure !== undefined) throw refusal("broker-write-state-refused");
    await bounded(
      new Promise<void>((resolvePromise, reject) => {
        this.child.stdin.write(bytes, (error) => {
          if (error) reject(refusal("broker-write-refused"));
          else resolvePromise();
        });
      }),
      "broker-write-timeout",
    );
    if (end) {
      this.inputEnded = true;
      await bounded(
        new Promise<void>((resolvePromise, reject) => {
          this.child.stdin.end((error?: Error | null) => {
            if (error) reject(refusal("broker-input-end-refused"));
            else resolvePromise();
          });
        }),
        "broker-input-end-timeout",
      );
    }
    if (this.failure !== undefined) throw refusal("broker-control-refused");
  }

  async settle(expectedCode: number): Promise<void> {
    const [code, signal] = await bounded(this.closed, "broker-close-timeout");
    const drains = await Promise.allSettled([
      bounded(this.reader.requireEnd(), "broker-output-end-timeout"),
      bounded(this.stderr.requireEnd(), "broker-diagnostic-end-timeout"),
    ]);
    const failures = drains.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length !== 0)
      throw new AggregateError(failures, "windows-isolation:broker-drain-refused");
    if (this.failure !== undefined || code !== expectedCode || signal !== null)
      throw refusal("broker-terminal-refused");
  }

  async hardAbort(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null && !this.child.kill())
      throw refusal("broker-terminate-refused");
    await bounded(
      this.closed.then(() => undefined),
      "broker-terminate-timeout",
    );
    const drains = await Promise.allSettled([
      bounded(this.reader.requireEnd(), "broker-output-end-timeout"),
      bounded(this.stderr.requireEnd(), "broker-diagnostic-end-timeout"),
    ]);
    const failures = drains.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length !== 0)
      throw new AggregateError(failures, "windows-isolation:broker-drain-refused");
  }
}

async function readResponse(reader: BoundedReader, maximum: number): Promise<ResponseFrame> {
  const header = await bounded(reader.read(16), "broker-response-timeout");
  if (
    header.subarray(0, 4).toString("ascii") !== "OPWB" ||
    header[4] !== 1 ||
    header[5] !== 2 ||
    header[6] === undefined ||
    header[7] === undefined ||
    header.readUInt32LE(12) !== 0
  )
    throw refusal("broker-response-header-refused");
  const length = header.readUInt32LE(8);
  if (length > maximum) throw refusal("broker-response-size-refused");
  return Object.freeze({
    operation: header[6],
    payload:
      length === 0
        ? Buffer.alloc(0)
        : await bounded(reader.read(length), "broker-response-timeout"),
    status: header[7],
  });
}

function requireResponse(
  frame: ResponseFrame,
  operation: number,
  status: number,
  empty: boolean,
): void {
  if (
    frame.operation !== operation ||
    frame.status !== status ||
    (empty && frame.payload.byteLength !== 0)
  )
    throw refusal("broker-response-refused");
}

function requireAscii(bytes: Buffer<ArrayBufferLike>, pattern: RegExp): string {
  if ([...bytes].some((byte) => byte > 0x7f)) throw refusal("broker-ascii-refused");
  const value = bytes.toString("ascii");
  if (!pattern.test(value)) throw refusal("broker-ascii-refused");
  return value;
}

function readCanonicalWide(
  payload: Buffer<ArrayBufferLike>,
  cursor: number,
  units: number,
): string {
  if (units < 1 || units > 1024 || cursor + units * 2 > payload.byteLength)
    throw refusal("broker-path-refused");
  for (let index = 0; index < units; index += 1) {
    const unit = payload.readUInt16LE(cursor + index * 2);
    if (unit === 0 || (unit >= 0xd800 && unit <= 0xdfff)) throw refusal("broker-path-refused");
  }
  const path = payload.subarray(cursor, cursor + units * 2).toString("utf16le");
  if (!/^\\\\\?\\[A-Z]:\\/.test(path) || path.endsWith("\\")) throw refusal("broker-path-refused");
  return path;
}

function binarySidText(sid: Buffer<ArrayBufferLike>): string {
  if (
    sid.byteLength < 8 ||
    sid[0] !== 1 ||
    sid[1] === undefined ||
    sid.byteLength !== 8 + sid[1] * 4
  )
    throw refusal("broker-sid-refused");
  let authority = 0n;
  for (let index = 2; index < 8; index += 1) authority = authority * 256n + BigInt(sid[index]!);
  const parts = ["S", "1", String(authority)];
  for (let index = 0; index < sid[1]; index += 1)
    parts.push(String(sid.readUInt32LE(8 + index * 4)));
  return parts.join("-");
}

function requirePreparePayload(payload: Buffer<ArrayBufferLike>, executionParent: string): void {
  if (
    payload.byteLength < 8 + 32 + 64 + 2 + 8 + 2 + 3 + 2 + 16 + 2 + 16 + 32 ||
    payload.subarray(0, 4).toString("ascii") !== "OPWR" ||
    !payload.subarray(4, 8).equals(Buffer.from([1, 2, 0, 0]))
  )
    throw refusal("broker-prepare-payload-refused");
  const token = payload.subarray(8, 40);
  if (token.equals(Buffer.alloc(32))) throw refusal("broker-token-refused");
  const moniker = requireAscii(payload.subarray(40, 104), /^orch6-[0-9a-f]{58}$/);
  if (moniker.slice(6) !== token.subarray(0, 29).toString("hex"))
    throw refusal("broker-moniker-refused");
  let cursor = 104;
  const sidLength = payload.readUInt16LE(cursor);
  cursor += 2;
  if (sidLength < 8 || sidLength > 68 || cursor + sidLength > payload.byteLength)
    throw refusal("broker-sid-refused");
  const sid = payload.subarray(cursor, cursor + sidLength);
  const canonicalSidText = binarySidText(sid);
  cursor += sidLength;
  if (cursor + 2 > payload.byteLength) throw refusal("broker-sid-text-refused");
  const sidTextLength = payload.readUInt16LE(cursor);
  cursor += 2;
  if (sidTextLength < 3 || sidTextLength > 184 || cursor + sidTextLength > payload.byteLength)
    throw refusal("broker-sid-text-refused");
  const sidText = requireAscii(
    payload.subarray(cursor, cursor + sidTextLength),
    /^S-(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*))+$/,
  );
  if (sidText !== canonicalSidText) throw refusal("broker-sid-binding-refused");
  cursor += sidTextLength;
  if (cursor + 2 > payload.byteLength) throw refusal("broker-folder-refused");
  const folderUnits = payload.readUInt16LE(cursor);
  cursor += 2;
  readCanonicalWide(payload, cursor, folderUnits);
  cursor += folderUnits * 2;
  if (cursor + 2 > payload.byteLength) throw refusal("broker-execution-root-refused");
  const executionUnits = payload.readUInt16LE(cursor);
  cursor += 2;
  const execution = readCanonicalWide(payload, cursor, executionUnits);
  const executionPrefix = `${executionParent}\\orch6-execution-`;
  if (
    !execution.startsWith(executionPrefix) ||
    execution.length !== executionPrefix.length + 64 ||
    !/^[0-9a-f]{64}$/.test(execution.slice(executionPrefix.length))
  )
    throw refusal("broker-execution-root-refused");
  cursor += executionUnits * 2;
  if (cursor + 32 !== payload.byteLength || payload.subarray(cursor).equals(Buffer.alloc(32)))
    throw refusal("broker-execution-binding-refused");
}

function terminalObservation(payload: Buffer<ArrayBufferLike>): Iss002IsolatedTerminalObservation {
  if (payload.byteLength < 16 || payload[1] !== 0 || payload[2] !== 0 || payload[3] !== 0)
    throw refusal("terminal-metadata-refused");
  const kind = payload[0];
  const exitCode = payload.readUInt32LE(4);
  const stdoutLength = payload.readUInt32LE(8);
  const stderrLength = payload.readUInt32LE(12);
  if (
    stdoutLength > maximumChallengeBytes ||
    stderrLength > maximumChallengeBytes ||
    16 + stdoutLength + stderrLength !== payload.byteLength
  )
    throw refusal("terminal-length-refused");
  if (kind === 1) {
    if (exitCode !== 0 || stdoutLength !== 0 || stderrLength !== 0)
      throw refusal("terminal-timeout-refused");
    return Object.freeze({ exitCode: null, signal: "TIMEOUT", stderr: "", stdout: "" });
  }
  if (kind !== 0) throw refusal("terminal-kind-refused");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let stdout: string;
  let stderr: string;
  try {
    stdout = decoder.decode(payload.subarray(16, 16 + stdoutLength));
    stderr = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      payload.subarray(16 + stdoutLength),
    );
  } catch {
    throw refusal("terminal-utf8-refused");
  }
  return Object.freeze({ exitCode, signal: null, stderr, stdout });
}

async function runRecovery(stateRoot: string): Promise<void> {
  const command = new BrokerCommand("RECOVER");
  try {
    await command.write(requestFrame(teardownOperation, pathPayload("OPWP", [stateRoot])), true);
    const response = await readResponse(command.reader, 0);
    requireResponse(response, teardownOperation, 0, true);
    await command.settle(0);
  } catch (error) {
    try {
      await command.hardAbort();
    } catch (abortError) {
      throw new AggregateError([error, abortError], "windows-isolation:recovery-terminal-refused");
    }
    throw error;
  }
}

interface AbortRecoveryResult {
  readonly abortFailure: unknown | undefined;
  readonly recoveryFailure: unknown | undefined;
}

async function abortThenRecover(
  broker: BrokerCommand,
  stateRoot: string,
): Promise<AbortRecoveryResult> {
  let abortFailure: unknown;
  let recoveryFailure: unknown;
  try {
    await broker.hardAbort();
  } catch (error) {
    abortFailure = error;
  }
  try {
    await runRecovery(stateRoot);
  } catch (error) {
    recoveryFailure = error;
  }
  return Object.freeze({ abortFailure, recoveryFailure });
}

function enter(state: PrincipalState): void {
  if (state.busy) throw refusal("operation-overlap-refused");
  if (state.lifecycle === "PERMANENT_FAILURE") throw refusal("permanent-failure");
  state.busy = true;
}

function leave(state: PrincipalState): void {
  state.busy = false;
}

export async function createWindowsIsolationAuthority(
  input: WindowsIsolationAuthorityOptions,
): Promise<Iss002StableIsolationAuthority> {
  if (nativeHostPlatform !== "win32") throw refusal("unsupported-platform");
  const options = await detachedOptions(input);
  const active = new WeakMap<object, PrincipalState>();
  let activePrincipal: object | undefined;
  let creating = false;

  const authority: Iss002StableIsolationAuthority = {
    async createPrincipal() {
      if (creating || activePrincipal !== undefined) throw refusal("active-principal-refused");
      creating = true;
      let bundle: RetainedBundle | undefined;
      try {
        bundle = await openReviewedBundle();
        await runRecovery(options.stateRoot);
        await verifyReviewedBundle(bundle);
        const broker = new BrokerCommand("SERVE");
        const handle = Object.freeze(Object.create(null) as object);
        active.set(handle, {
          broker,
          bundle,
          busy: false,
          lifecycle: "CREATED",
        });
        activePrincipal = handle;
        return handle;
      } catch (error) {
        if (bundle) {
          try {
            await closeReviewedBundle(bundle);
          } catch (closeError) {
            throw new AggregateError(
              [error, closeError],
              "windows-isolation:create-custody-close-refused",
            );
          }
        }
        throw error;
      } finally {
        creating = false;
      }
    },

    async prepare(handle, requestInput) {
      const state = active.get(handle as object);
      if (!state) throw refusal("principal-handle-refused");
      enter(state);
      try {
        if (state.lifecycle !== "CREATED") throw refusal("preparation-order-refused");
        state.lifecycle = "PREPARING";
        const request = await detachedRequest(requestInput);
        await verifyReviewedBundle(state.bundle);
        const payload = pathPayload("OPWE", [
          options.stateRoot,
          options.executionParent,
          options.runtimePath,
          request.rpcRunnerPath,
          request.candidateArtifactPath,
        ]);
        await state.broker.write(requestFrame(prepareOperation, payload), false);
        const response = await readResponse(state.broker.reader, 4096);
        requireResponse(response, prepareOperation, 0, false);
        requirePreparePayload(response.payload, options.executionParent);
        state.broker.requireNoDiagnostic();
        await verifyReviewedBundle(state.bundle);
        state.prepared = request;
        state.lifecycle = "PREPARED";
      } catch (error) {
        state.lifecycle = "RECOVERY_REQUIRED";
        throw error;
      } finally {
        leave(state);
      }
    },

    async launch(handle, requestInput) {
      const state = active.get(handle as object);
      if (!state) throw refusal("principal-handle-refused");
      enter(state);
      try {
        if (state.lifecycle !== "PREPARED" || !state.prepared)
          throw refusal("launch-order-refused");
        state.lifecycle = "LAUNCHING";
        const request = await detachedRequest(requestInput);
        if (!sameRequest(state.prepared, request)) throw refusal("launch-preparation-refused");
        await verifyReviewedBundle(state.bundle);
        await state.broker.write(
          requestFrame(launchOperation, Buffer.from(request.inputText, "utf8")),
          false,
        );
        const response = await readResponse(state.broker.reader, maximumTerminalPayloadBytes);
        requireResponse(response, launchOperation, 0, false);
        const observation = terminalObservation(response.payload);
        state.broker.requireNoDiagnostic();
        await verifyReviewedBundle(state.bundle);
        state.lifecycle = "AWAIT_TEARDOWN";
        return observation;
      } catch (error) {
        state.lifecycle = "RECOVERY_REQUIRED";
        throw error;
      } finally {
        leave(state);
      }
    },

    async teardownPrincipal(handle) {
      const state = active.get(handle as object);
      if (!state) throw refusal("principal-handle-refused");
      enter(state);
      const prior = state.lifecycle;
      state.lifecycle = "TEARING_DOWN";
      let operationFailure: unknown;
      let nativeClean = false;
      try {
        if (prior === "PREPARED" || prior === "AWAIT_TEARDOWN") {
          await state.broker.write(requestFrame(teardownOperation), true);
          const response = await readResponse(state.broker.reader, 0);
          requireResponse(response, teardownOperation, 0, true);
          await state.broker.settle(0);
          nativeClean = true;
        }
      } catch (error) {
        operationFailure = error;
      }
      if (!nativeClean) {
        const recovery = await abortThenRecover(state.broker, options.stateRoot);
        if (recovery.recoveryFailure !== undefined) {
          state.lifecycle = "RECOVERY_REQUIRED";
          leave(state);
          throw new AggregateError(
            [operationFailure, recovery.abortFailure, recovery.recoveryFailure].filter(
              (error) => error !== undefined,
            ),
            "windows-isolation:teardown-recovery-refused",
          );
        }
        nativeClean = true;
        if (recovery.abortFailure !== undefined)
          operationFailure = new AggregateError(
            [operationFailure, recovery.abortFailure].filter((error) => error !== undefined),
            "windows-isolation:teardown-control-refused",
          );
      }
      try {
        await closeReviewedBundle(state.bundle);
      } catch (closeError) {
        state.lifecycle = "PERMANENT_FAILURE";
        leave(state);
        throw new AggregateError(
          operationFailure === undefined ? [closeError] : [operationFailure, closeError],
          "windows-isolation:teardown-custody-refused",
        );
      }
      active.delete(handle as object);
      activePrincipal = undefined;
      leave(state);
      if (operationFailure !== undefined) throw operationFailure;
    },
  };
  return Object.freeze(authority);
}

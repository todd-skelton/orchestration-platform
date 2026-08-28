import { spawn, type ChildProcess } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";

export const portablePrimitiveWorkerModes = Object.freeze([
  "ABSENCE",
  "CAS",
  "EXCLUSIVE_CREATE",
  "LOCK_ATTEMPT",
  "LOCK_HOLDER",
  "REPLACE",
] as const);
export type PortablePrimitiveWorkerMode = (typeof portablePrimitiveWorkerModes)[number];

const eventFields = Object.freeze([
  "barrier",
  "errorCode",
  "event",
  "headPlusOneCode",
  "headPlusTwoCode",
  "mode",
  "readbackHex",
  "schemaVersion",
] as const);
const eventNames = Object.freeze([
  "ABSENCE_OBSERVED",
  "ACQUIRED",
  "CREATED",
  "ERROR",
  "PREDECESSOR_MISMATCH",
  "REACHED_BARRIER",
  "SELECTED",
] as const);
const barriers = Object.freeze([
  "READY",
  "ACQUIRED",
  "AFTER_CREATE",
  "AFTER_FILE_SYNC",
  "AFTER_RENAME",
  "AFTER_DIRECTORY_SYNC",
] as const);
const errorCode = /^[A-Z][A-Z0-9_]{0,63}$/;

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function parsePortablePrimitiveRawChildEvent(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, eventFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "portable-primitives-raw-child-event/v1")
    issues.push("schemaVersion:mismatch");
  if (!(
    typeof record.mode === "string" &&
    portablePrimitiveWorkerModes.includes(record.mode as PortablePrimitiveWorkerMode)
  ))
    issues.push("mode:invalid");
  if (!(
    typeof record.event === "string" &&
    eventNames.includes(record.event as (typeof eventNames)[number])
  ))
    issues.push("event:invalid");
  if (
    record.barrier !== null &&
    !(
      typeof record.barrier === "string" &&
      barriers.includes(record.barrier as (typeof barriers)[number])
    )
  )
    issues.push("barrier:invalid");
  for (const field of ["errorCode", "headPlusOneCode", "headPlusTwoCode"] as const)
    if (
      record[field] !== null &&
      !(typeof record[field] === "string" && errorCode.test(record[field]))
    )
      issues.push(`${field}:invalid`);
  if (record.readbackHex !== null && record.readbackHex !== "41" && record.readbackHex !== "42")
    issues.push("readbackHex:invalid");
  if (record.event === "ERROR" ? record.errorCode === null : record.errorCode !== null)
    issues.push("errorCode:arm-mismatch");
  if (record.event === "REACHED_BARRIER" ? record.barrier === null : record.barrier !== null)
    issues.push("barrier:arm-mismatch");
  if (record.event === "ABSENCE_OBSERVED") {
    if (record.headPlusOneCode === null || record.headPlusTwoCode === null)
      issues.push("absenceCodes:required");
  } else if (record.headPlusOneCode !== null || record.headPlusTwoCode !== null)
    issues.push("absenceCodes:forbidden");
  const allowedEvents = Object.freeze({
    ABSENCE: Object.freeze(["ABSENCE_OBSERVED", "ERROR"]),
    CAS: Object.freeze(["ERROR", "PREDECESSOR_MISMATCH", "SELECTED"]),
    EXCLUSIVE_CREATE: Object.freeze(["CREATED", "ERROR"]),
    LOCK_ATTEMPT: Object.freeze(["ACQUIRED", "ERROR"]),
    LOCK_HOLDER: Object.freeze(["ACQUIRED", "ERROR"]),
    REPLACE: Object.freeze(["ERROR", "REACHED_BARRIER"]),
  } as const);
  if (
    typeof record.mode === "string" &&
    Object.hasOwn(allowedEvents, record.mode) &&
    !allowedEvents[record.mode as keyof typeof allowedEvents].includes(record.event as never)
  )
    issues.push("modeEvent:invalid");
  if (record.event === "CREATED" && record.readbackHex !== "41")
    issues.push("readbackHex:create-mismatch");
  else if (record.event === "SELECTED" && record.readbackHex !== "42")
    issues.push("readbackHex:selection-mismatch");
  else if (record.event === "PREDECESSOR_MISMATCH" && record.readbackHex === null)
    issues.push("readbackHex:mismatch-required");
  else if (
    !["CREATED", "PREDECESSOR_MISMATCH", "SELECTED"].includes(String(record.event)) &&
    record.readbackHex !== null
  )
    issues.push("readbackHex:forbidden");
  return issues.length === 0 ? parsed : failure(...issues);
}

export function bindPortablePrimitiveRawChildEvent(
  input: unknown,
  requestedMode: PortablePrimitiveWorkerMode,
  requestedArguments: readonly string[],
): ParseResult {
  const parsed = parsePortablePrimitiveRawChildEvent(input);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (parsed.value.mode !== requestedMode) issues.push("mode:request-mismatch");
  if (
    requestedMode === "REPLACE" &&
    parsed.value.event === "REACHED_BARRIER" &&
    parsed.value.barrier !== requestedArguments[0]
  )
    issues.push("barrier:request-mismatch");
  if (requestedMode === "CAS") {
    if (
      parsed.value.event === "PREDECESSOR_MISMATCH" &&
      parsed.value.readbackHex === requestedArguments[0]
    )
      issues.push("readbackHex:not-mismatch");
    if (parsed.value.event === "SELECTED" && parsed.value.readbackHex !== requestedArguments[1])
      issues.push("readbackHex:proposal-mismatch");
  }
  return issues.length === 0 ? parsed : failure(...issues);
}

export interface PortablePrimitiveChildExecution {
  readonly event: ContractRecord | null;
  readonly exitCode: number | null;
  readonly outputLimitExceeded: boolean;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}

export const portablePrimitiveWorkerPath = fileURLToPath(
  new URL("./filesystem-worker.mjs", import.meta.url),
);

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

export async function canonicalPortablePrimitiveCustodyRoot(custodyRoot: string): Promise<string> {
  if (!isAbsolute(custodyRoot) || resolve(custodyRoot) !== custodyRoot)
    throw new TypeError("custodyRoot:absolute-normalized-required");
  const identity = await lstat(custodyRoot);
  if (!identity.isDirectory() || identity.isSymbolicLink())
    throw new TypeError("custodyRoot:unsafe");
  const [realCustodyRoot, realSourceRoot] = await Promise.all([
    realpath(custodyRoot),
    realpath(resolve(dirname(portablePrimitiveWorkerPath), "../../..")),
  ]);
  if (within(realSourceRoot, realCustodyRoot) || within(realCustodyRoot, realSourceRoot))
    throw new TypeError("custodyRoot:source-overlap");
  return realCustodyRoot;
}

export function portablePrimitiveChildEnvironment(): NodeJS.ProcessEnv {
  return Object.freeze({
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  }) as NodeJS.ProcessEnv;
}

export interface PortablePrimitiveLiveChild {
  readonly child: ChildProcess;
  readonly event: ContractRecord;
}

const providerObservedClosedChildren = new WeakSet<ChildProcess>();

export function portablePrimitiveChildProviderObservedClosed(child: ChildProcess): boolean {
  return providerObservedClosedChildren.has(child);
}

export async function startPortablePrimitiveLockHolder(
  custodyRoot: string,
): Promise<PortablePrimitiveLiveChild> {
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const child = spawn(
    process.execPath,
    [portablePrimitiveWorkerPath, "LOCK_HOLDER", realCustodyRoot],
    {
      cwd: realCustodyRoot,
      env: portablePrimitiveChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.once("close", () => providerObservedClosedChildren.add(child));
  const event = await new Promise<ContractRecord>((resolveEvent, reject) => {
    let settled = false;
    let byteLength = 0;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => void finishFailure(new Error("lock-holder:event-timeout")),
      10_000,
    );
    const finishFailure = async (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        await terminatePortablePrimitiveChild(child);
        reject(error);
      } catch (cleanupError) {
        reject(
          new AggregateError([error, cleanupError], "lock-holder:start-failure-cleanup-refused"),
        );
      }
    };
    const finishSuccess = (value: ContractRecord) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveEvent(value);
    };
    child.once("error", (error) => void finishFailure(error));
    child.once("close", () => void finishFailure(new Error(`lock-holder:closed:${stderr}`)));
    child.stderr!.on("data", (chunk: Buffer) => {
      byteLength += chunk.byteLength;
      stderr += chunk.toString("utf8");
      if (byteLength > 64 * 1024) void finishFailure(new Error("lock-holder:output-limit"));
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      byteLength += chunk.byteLength;
      stdout += chunk.toString("utf8");
      if (byteLength > 64 * 1024) return void finishFailure(new Error("lock-holder:output-limit"));
      if (!stdout.includes("\n")) return;
      if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n"))
        return void finishFailure(new Error("lock-holder:stdout-census"));
      try {
        const parsed = bindPortablePrimitiveRawChildEvent(JSON.parse(stdout), "LOCK_HOLDER", []);
        if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
        if (parsed.value.event !== "ACQUIRED")
          return void finishFailure(new Error("lock-holder:not-acquired"));
        finishSuccess(parsed.value);
      } catch (error) {
        void finishFailure(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  return Object.freeze({ child, event });
}

export async function terminatePortablePrimitiveChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || providerObservedClosedChildren.has(child)) return;
  const completion = new Promise<void>((resolveCompletion, reject) => {
    const timeout = setTimeout(() => reject(new Error("child:termination-timeout")), 10_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolveCompletion();
    });
  });
  if (
    child.signalCode === null &&
    !child.kill("SIGKILL") &&
    child.exitCode === null &&
    child.signalCode === null
  )
    throw new Error("child:termination-refused");
  await completion;
}

const descriptorEventFields = Object.freeze([
  "accessResult",
  "errorCode",
  "readbackHex",
  "schemaVersion",
] as const);

export function parsePortablePrimitiveLockDescriptorChildEvent(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, descriptorEventFields);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (parsed.value.schemaVersion !== "portable-primitives-lock-descriptor-child-event/v1")
    issues.push("schemaVersion:mismatch");
  if (parsed.value.accessResult !== "REFUSED" && parsed.value.accessResult !== "ACCESSED")
    issues.push("accessResult:invalid");
  if (
    parsed.value.errorCode !== null &&
    !(typeof parsed.value.errorCode === "string" && errorCode.test(parsed.value.errorCode))
  )
    issues.push("errorCode:invalid");
  if (
    parsed.value.readbackHex !== null &&
    !(
      typeof parsed.value.readbackHex === "string" &&
      /^(?:[0-9a-f]{2}){0,32}$/.test(parsed.value.readbackHex)
    )
  )
    issues.push("readbackHex:invalid");
  if (
    parsed.value.accessResult === "REFUSED"
      ? parsed.value.errorCode === null || parsed.value.readbackHex !== null
      : parsed.value.errorCode !== null || parsed.value.readbackHex === null
  )
    issues.push("accessResult:arm-mismatch");
  return issues.length === 0 ? parsed : failure(...issues);
}

async function observePortablePrimitiveChild(
  child: ChildProcess,
  parseEvent: (stdout: string) => ContractRecord | null,
  killAfterFirstLine: boolean,
  timedOut: () => boolean,
): Promise<PortablePrimitiveChildExecution> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let byteLength = 0;
  let outputLimitExceeded = false;
  const collect = (target: Buffer[], chunk: Buffer) => {
    byteLength += chunk.byteLength;
    if (byteLength > 64 * 1024) {
      outputLimitExceeded = true;
      child.kill("SIGKILL");
    } else target.push(chunk);
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    collect(stdout, chunk);
    if (killAfterFirstLine && Buffer.concat(stdout).includes(0x0a)) child.kill("SIGKILL");
  });
  child.stderr!.on("data", (chunk: Buffer) => collect(stderr, chunk));
  const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveCompletion, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveCompletion({ code, signal }));
    },
  );
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  return Object.freeze({
    event: byteLength <= 64 * 1024 ? parseEvent(stdoutText) : null,
    exitCode: completion.code,
    outputLimitExceeded,
    signal: completion.signal,
    stderr: stderrText,
    stdout: stdoutText,
    timedOut: timedOut(),
  });
}

async function observePortablePrimitiveChildWithoutKill(
  child: ChildProcess,
  parseEvent: (stdout: string) => ContractRecord | null,
): Promise<PortablePrimitiveChildExecution> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let byteLength = 0;
  let outputLimitExceeded = false;
  const collect = (target: Buffer[], chunk: Buffer) => {
    byteLength += chunk.byteLength;
    if (byteLength > 64 * 1024) outputLimitExceeded = true;
    else target.push(chunk);
  };
  child.stdout!.on("data", (chunk: Buffer) => collect(stdout, chunk));
  child.stderr!.on("data", (chunk: Buffer) => collect(stderr, chunk));
  const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveCompletion, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveCompletion({ code, signal }));
    },
  );
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  return Object.freeze({
    event: outputLimitExceeded ? null : parseEvent(stdoutText),
    exitCode: completion.code,
    outputLimitExceeded,
    signal: completion.signal,
    stderr: Buffer.concat(stderr).toString("utf8"),
    stdout: stdoutText,
    timedOut: false,
  });
}

function parseBoundChildOutput(
  stdout: string,
  mode: PortablePrimitiveWorkerMode,
  arguments_: readonly string[],
): ContractRecord | null {
  return parseChildOutput(stdout, (input) =>
    bindPortablePrimitiveRawChildEvent(input, mode, arguments_),
  );
}

function parseDescriptorChildOutput(stdout: string): ContractRecord | null {
  return parseChildOutput(stdout, parsePortablePrimitiveLockDescriptorChildEvent);
}

function parseChildOutput(
  stdout: string,
  parser: (input: unknown) => ParseResult,
): ContractRecord | null {
  try {
    if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) return null;
    const parsed = parser(JSON.parse(stdout));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

async function observePortablePrimitiveChildWithTimer(
  child: ChildProcess,
  parseEvent: (stdout: string) => ContractRecord | null,
  killAfterFirstLine = false,
): Promise<PortablePrimitiveChildExecution> {
  let didTimeOut = false;
  const observation = observePortablePrimitiveChild(
    child,
    parseEvent,
    killAfterFirstLine,
    () => didTimeOut,
  );
  const timeout = setTimeout(() => {
    didTimeOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  try {
    return await observation;
  } finally {
    clearTimeout(timeout);
  }
}

export async function executePortablePrimitiveLockAttemptWithoutTimer(
  custodyRoot: string,
): Promise<PortablePrimitiveChildExecution> {
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const mode = "LOCK_ATTEMPT";
  const child = spawn(process.execPath, [portablePrimitiveWorkerPath, mode, realCustodyRoot], {
    cwd: realCustodyRoot,
    env: portablePrimitiveChildEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return observePortablePrimitiveChildWithoutKill(child, (stdout) =>
    parseBoundChildOutput(stdout, mode, []),
  );
}

export async function executePortablePrimitiveLockDescriptorChild(
  custodyRoot: string,
  targetDescriptor: number,
  descriptorToInherit: number | null,
): Promise<PortablePrimitiveChildExecution> {
  if (
    !Number.isSafeInteger(targetDescriptor) ||
    targetDescriptor < 3 ||
    targetDescriptor > 99_999 ||
    (descriptorToInherit !== null &&
      (!Number.isSafeInteger(descriptorToInherit) || descriptorToInherit < 3))
  )
    throw new TypeError("descriptor:invalid");
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const child = spawn(
    process.execPath,
    [
      portablePrimitiveWorkerPath,
      "LOCK_DESCRIPTOR_PROBE",
      realCustodyRoot,
      String(targetDescriptor),
      "32",
    ],
    {
      cwd: realCustodyRoot,
      env: portablePrimitiveChildEnvironment(),
      stdio:
        descriptorToInherit === null
          ? ["ignore", "pipe", "pipe"]
          : ["ignore", "pipe", "pipe", descriptorToInherit],
      windowsHide: true,
    },
  );
  return observePortablePrimitiveChildWithTimer(child, parseDescriptorChildOutput);
}

export async function executePortablePrimitiveChild(
  mode: PortablePrimitiveWorkerMode,
  custodyRoot: string,
  arguments_: readonly string[] = [],
): Promise<PortablePrimitiveChildExecution> {
  if (!portablePrimitiveWorkerModes.includes(mode)) throw new TypeError("mode:invalid");
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const expectedArgumentCount = mode === "CAS" ? 2 : mode === "REPLACE" ? 1 : 0;
  if (
    arguments_.length !== expectedArgumentCount ||
    arguments_.some((value) => /[\u0000-\u001f\u007f]/.test(value))
  )
    throw new TypeError("arguments:invalid");
  const child = spawn(
    process.execPath,
    [portablePrimitiveWorkerPath, mode, realCustodyRoot, ...arguments_],
    {
      cwd: realCustodyRoot,
      env: portablePrimitiveChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  return observePortablePrimitiveChildWithTimer(
    child,
    (stdout) => parseBoundChildOutput(stdout, mode, arguments_),
    mode === "REPLACE",
  );
}

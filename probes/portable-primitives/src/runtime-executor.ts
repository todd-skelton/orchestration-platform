import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { snapshotClosedRecord, type ParseResult } from "@orchestration-platform/contracts";
import {
  canonicalPortablePrimitiveCustodyRoot,
  portablePrimitiveChildEnvironment,
} from "./executor.js";

const runtimeWorkerPath = fileURLToPath(new URL("./runtime-worker.mjs", import.meta.url));
const noncePattern = /^[0-9a-f]{64}$/;
const canonicalPositiveDecimal = /^[1-9][0-9]*$/;
const outputLimit = 64 * 1024;
const childTimeoutMilliseconds = 10_000;
const childCleanupMilliseconds = 9_000;

function failure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function parsePortablePrimitiveProcessChildEvent(
  input: unknown,
  expectedNonce: string,
): ParseResult {
  if (!noncePattern.test(expectedNonce)) throw new TypeError("expectedNonce:invalid");
  const parsed = snapshotClosedRecord(input, [
    "event",
    "grandchildClaim",
    "nonce",
    "schemaVersion",
  ]);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  if (parsed.value.schemaVersion !== "portable-primitive-process-child-event/v1")
    issues.push("schemaVersion:mismatch");
  if (parsed.value.event !== "READY") issues.push("event:mismatch");
  if (parsed.value.nonce !== expectedNonce) issues.push("nonce:mismatch");
  if (
    typeof parsed.value.grandchildClaim !== "string" ||
    !canonicalPositiveDecimal.test(parsed.value.grandchildClaim)
  )
    issues.push("grandchildClaim:invalid");
  return issues.length === 0 ? parsed : failure(...issues);
}

export interface PortablePrimitiveProcessRawFacts {
  readonly closeCode: number | null;
  readonly closeObserved: boolean;
  readonly closeSignal: NodeJS.Signals | null;
  readonly directChildHandleOwned: true;
  readonly eventOrder: readonly ("close" | "exit")[];
  readonly exitCode: number | null;
  readonly exitObserved: boolean;
  readonly exitSignal: NodeJS.Signals | null;
  readonly forcedKillAccepted: boolean | null;
  readonly grandchildClaimAcceptedAsAuthority: false;
  readonly grandchildClaimPresent: boolean;
  readonly ipcNonceMatched: boolean;
  readonly killAccepted: boolean;
  readonly killRequestedSignal: "SIGTERM";
  readonly messageCount: number;
  readonly outputLimitExceeded: boolean;
  readonly responseAccepted: boolean;
  readonly timedOut: boolean;
}

interface ProcessCollectionBounds {
  readonly cleanupAfterMilliseconds: number;
  readonly timeoutMilliseconds: number;
}

const productionCollectionBounds = Object.freeze({
  cleanupAfterMilliseconds: childCleanupMilliseconds,
  timeoutMilliseconds: childTimeoutMilliseconds,
});

function validateCollectionBounds(bounds: ProcessCollectionBounds): void {
  if (
    !Number.isSafeInteger(bounds.cleanupAfterMilliseconds) ||
    !Number.isSafeInteger(bounds.timeoutMilliseconds) ||
    bounds.cleanupAfterMilliseconds < 1 ||
    bounds.cleanupAfterMilliseconds >= bounds.timeoutMilliseconds
  )
    throw new TypeError("processCollectionBounds:invalid");
}

function spawnRuntimeWorker(
  mode: "HANDLE_REPLAY" | "PROCESS_TARGET",
  custodyRoot: string,
): ChildProcess {
  return spawn(process.execPath, [runtimeWorkerPath, mode], {
    cwd: custodyRoot,
    env: portablePrimitiveChildEnvironment(),
    stdio:
      mode === "PROCESS_TARGET"
        ? ["ignore", "ignore", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
}

function sendNonceChallenge(child: ChildProcess, nonce: string): void {
  if (!child.connected) throw new Error("child:ipc-not-connected");
  child.send({ nonce }, (error) => {
    if (error !== null) void child.kill("SIGKILL");
  });
}

export async function collectPortablePrimitiveProcessFacts(
  child: ChildProcess,
  nonce: string,
  bounds: ProcessCollectionBounds = productionCollectionBounds,
): Promise<PortablePrimitiveProcessRawFacts> {
  if (!noncePattern.test(nonce)) throw new TypeError("nonce:invalid");
  validateCollectionBounds(bounds);
  const eventOrder: ("close" | "exit")[] = [];
  const messages: unknown[] = [];
  let outputBytes = 0;
  let outputLimitExceeded = false;
  let timedOut = false;
  let killAccepted = false;
  let forcedKillAccepted: boolean | null = null;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let closeCode: number | null = null;
  let closeSignal: NodeJS.Signals | null = null;
  let ipcNonceMatched = false;
  let grandchildClaimPresent = false;
  let firstResponseAccepted = false;

  const requestForcedTermination = () => {
    if (forcedKillAccepted === null) forcedKillAccepted = child.kill("SIGKILL");
  };
  const completion = new Promise<void>((resolveCompletion, reject) => {
    child.once("error", reject);
    child.on("message", (message) => {
      messages.push(message);
      try {
        outputBytes += Buffer.byteLength(JSON.stringify(message) ?? "");
      } catch {
        requestForcedTermination();
        return;
      }
      if (outputBytes > outputLimit) {
        outputLimitExceeded = true;
        requestForcedTermination();
        return;
      }
      const parsed = parsePortablePrimitiveProcessChildEvent(message, nonce);
      if (messages.length !== 1 || !parsed.ok) {
        requestForcedTermination();
        return;
      }
      firstResponseAccepted = true;
      ipcNonceMatched = true;
      grandchildClaimPresent = true;
      killAccepted = child.kill("SIGTERM");
      if (!killAccepted) requestForcedTermination();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > outputLimit) {
        outputLimitExceeded = true;
        requestForcedTermination();
      }
    });
    child.once("exit", (code, signal) => {
      eventOrder.push("exit");
      exitCode = code;
      exitSignal = signal;
    });
    child.once("close", (code, signal) => {
      eventOrder.push("close");
      closeCode = code;
      closeSignal = signal;
      resolveCompletion();
    });
  });
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const cleanupTimer = setTimeout(() => {
    timedOut = true;
    requestForcedTermination();
  }, bounds.cleanupAfterMilliseconds);
  const deadlineTimer = setTimeout(
    () => rejectDeadline!(new Error("process:terminal-deadline-exceeded")),
    bounds.timeoutMilliseconds,
  );
  try {
    sendNonceChallenge(child, nonce);
    await Promise.race([completion, deadline]);
  } finally {
    clearTimeout(cleanupTimer);
    clearTimeout(deadlineTimer);
  }
  return Object.freeze({
    closeCode,
    closeObserved: eventOrder.includes("close"),
    closeSignal,
    directChildHandleOwned: true,
    eventOrder: Object.freeze([...eventOrder]),
    exitCode,
    exitObserved: eventOrder.includes("exit"),
    exitSignal,
    forcedKillAccepted,
    grandchildClaimAcceptedAsAuthority: false,
    grandchildClaimPresent,
    ipcNonceMatched,
    killAccepted,
    killRequestedSignal: "SIGTERM",
    messageCount: messages.length,
    outputLimitExceeded,
    responseAccepted:
      firstResponseAccepted &&
      messages.length === 1 &&
      killAccepted &&
      !outputLimitExceeded &&
      !timedOut,
    timedOut,
  });
}

export async function executePortablePrimitiveProcessProbe(
  custodyRoot: string,
): Promise<PortablePrimitiveProcessRawFacts> {
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const nonce = randomBytes(32).toString("hex");
  const child = spawnRuntimeWorker("PROCESS_TARGET", realCustodyRoot);
  return collectPortablePrimitiveProcessFacts(child, nonce);
}

interface ProbeHandleEntry {
  active: boolean;
  readonly callback: () => void;
  readonly nonce: string;
}

async function replayHandleNonce(custodyRoot: string, nonce: string): Promise<unknown> {
  const child = spawnRuntimeWorker("HANDLE_REPLAY", custodyRoot);
  const stdout: Buffer[] = [];
  let outputBytes = 0;
  let outputLimitExceeded = false;
  let forcedKillAccepted: boolean | null = null;
  const requestForcedTermination = () => {
    if (forcedKillAccepted === null) forcedKillAccepted = child.kill("SIGKILL");
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > outputLimit) {
      outputLimitExceeded = true;
      requestForcedTermination();
    } else stdout.push(chunk);
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > outputLimit) {
      outputLimitExceeded = true;
      requestForcedTermination();
    }
  });
  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveCompletion, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveCompletion({ code, signal }));
    },
  );
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const cleanupTimer = setTimeout(requestForcedTermination, childCleanupMilliseconds);
  const deadlineTimer = setTimeout(
    () => rejectDeadline!(new Error("handle-replay:terminal-deadline-exceeded")),
    childTimeoutMilliseconds,
  );
  let terminal;
  try {
    sendNonceChallenge(child, nonce);
    terminal = await Promise.race([completion, deadline]);
  } finally {
    clearTimeout(cleanupTimer);
    clearTimeout(deadlineTimer);
  }
  if (
    terminal.code !== 0 ||
    terminal.signal !== null ||
    outputLimitExceeded ||
    forcedKillAccepted !== null
  )
    throw new Error("handle-replay:child-refused");
  const text = Buffer.concat(stdout).toString("utf8");
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n"))
    throw new Error("handle-replay:stdout-census");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("handle-replay:json-refused");
  }
  const parsed = snapshotClosedRecord(input, ["nonce", "schemaVersion"]);
  if (
    !parsed.ok ||
    parsed.value.schemaVersion !== "portable-primitive-handle-replay/v1" ||
    parsed.value.nonce !== nonce
  )
    throw new Error("handle-replay:record-refused");
  return parsed.value.nonce;
}

export interface PortablePrimitiveHandleRawFacts {
  readonly callbackInvocations: number;
  readonly crossProcessReplayRejected: boolean;
  readonly directInvocationAccepted: boolean;
  readonly nonceByteLength: 32;
  readonly reuseAfterReleaseRejected: boolean;
  readonly serializationRejected: boolean;
  readonly structuredCloneRejected: boolean;
  readonly workerTransferRejected: boolean;
  readonly wrappedFunctionRejected: boolean;
}

export async function executePortablePrimitiveHandleConfinementProbe(
  custodyRoot: string,
): Promise<PortablePrimitiveHandleRawFacts> {
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const entries = new WeakMap<Function, ProbeHandleEntry>();
  let callbackInvocations = 0;
  const nonce = randomBytes(32).toString("hex");
  const handle = () => invoke(handle, nonce);
  entries.set(handle, {
    active: true,
    callback: () => {
      callbackInvocations += 1;
    },
    nonce,
  });
  const invoke = (candidate: unknown, suppliedNonce: string): boolean => {
    if (typeof candidate !== "function" || !noncePattern.test(suppliedNonce)) return false;
    const entry = entries.get(candidate);
    if (!entry?.active || entry.nonce !== suppliedNonce) return false;
    entry.callback();
    return true;
  };

  const directInvocationAccepted = handle();
  const wrappedFunctionRejected = !invoke(() => handle(), nonce);
  let structuredCloneRejected = false;
  try {
    structuredClone(handle);
  } catch {
    structuredCloneRejected = true;
  }
  const serializationRejected = JSON.stringify(handle) === undefined;
  const worker = new Worker(
    'const { parentPort } = require("node:worker_threads"); parentPort.on("message", () => {});',
    { eval: true },
  );
  let workerTransferRejected = false;
  try {
    worker.postMessage(handle);
  } catch {
    workerTransferRejected = true;
  } finally {
    await worker.terminate();
  }
  const replayedNonce = await replayHandleNonce(realCustodyRoot, nonce);
  const crossProcessReplayRejected = !invoke(replayedNonce, nonce);
  const entry = entries.get(handle)!;
  entry.active = false;
  entries.delete(handle);
  const reuseAfterReleaseRejected = !handle();
  return Object.freeze({
    callbackInvocations,
    crossProcessReplayRejected,
    directInvocationAccepted,
    nonceByteLength: 32,
    reuseAfterReleaseRejected,
    serializationRejected,
    structuredCloneRejected,
    workerTransferRejected,
    wrappedFunctionRejected,
  });
}

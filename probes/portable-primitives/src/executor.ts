import { spawn } from "node:child_process";
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
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

export const portablePrimitiveWorkerPath = fileURLToPath(
  new URL("./filesystem-worker.mjs", import.meta.url),
);

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

export async function executePortablePrimitiveChild(
  mode: PortablePrimitiveWorkerMode,
  custodyRoot: string,
  arguments_: readonly string[] = [],
): Promise<PortablePrimitiveChildExecution> {
  if (!portablePrimitiveWorkerModes.includes(mode)) throw new TypeError("mode:invalid");
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
      env: Object.freeze({
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      }) as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let byteLength = 0;
  const collect = (target: Buffer[], chunk: Buffer) => {
    byteLength += chunk.byteLength;
    if (byteLength > 64 * 1024) child.kill("SIGKILL");
    else target.push(chunk);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    collect(stdout, chunk);
    if (mode === "REPLACE" && Buffer.concat(stdout).includes(0x0a)) child.kill("SIGKILL");
  });
  child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveCompletion, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveCompletion({ code, signal }));
    },
  );
  clearTimeout(timeout);
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  let event: ContractRecord | null = null;
  try {
    if (!stdoutText.endsWith("\n") || stdoutText.slice(0, -1).includes("\n"))
      throw new TypeError("stdout:census");
    const parsed = bindPortablePrimitiveRawChildEvent(JSON.parse(stdoutText), mode, arguments_);
    if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
    event = byteLength <= 64 * 1024 ? parsed.value : null;
  } catch {
    event = null;
  }
  return Object.freeze({
    event,
    exitCode: completion.code,
    signal: completion.signal,
    stderr: stderrText,
    stdout: stdoutText,
  });
}

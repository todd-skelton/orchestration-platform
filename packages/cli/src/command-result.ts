import { types as nodeTypes } from "node:util";

import {
  canonicalJson,
  orchestrationCommandCensus,
  parseOrchestrationCommandResult,
  snapshotClosedRecord,
  type ContractRecord,
} from "@orchestration-platform/contracts";

export interface PreparedCommandEmission {
  readonly stdout: string;
  readonly stderr: "";
  readonly exitCode: 0 | 2 | 3 | 5 | 70;
}

const failureRows = Object.freeze({
  ARGV_REFUSED: Object.freeze({
    code: "ARGV_REFUSED",
    exitCode: 2,
    message: "command line refused",
    outcome: "invalid-input",
  }),
  CONFIG_REFUSED: Object.freeze({
    code: "CONFIG_REFUSED",
    exitCode: 2,
    message: "configuration refused",
    outcome: "invalid-input",
  }),
  PROJECT_ROOT_REFUSED: Object.freeze({
    code: "PROJECT_ROOT_REFUSED",
    exitCode: 3,
    message: "project root refused",
    outcome: "authority-refused",
  }),
  PATH_REFUSED: Object.freeze({
    code: "PATH_REFUSED",
    exitCode: 3,
    message: "path refused",
    outcome: "authority-refused",
  }),
  FILESYSTEM_OPERATION_FAILED: Object.freeze({
    code: "FILESYSTEM_OPERATION_FAILED",
    exitCode: 5,
    message: "filesystem operation failed",
    outcome: "operation-failed",
  }),
  INTERNAL_ERROR: Object.freeze({
    code: "INTERNAL_ERROR",
    exitCode: 70,
    message: "internal error",
    outcome: "internal-error",
  }),
} as const);
type FailureCode = keyof typeof failureRows;
const commands = new Set(orchestrationCommandCensus.map((row) => row.command));

function knownCommand(input: unknown): input is string {
  return typeof input === "string" && commands.has(input);
}

function emission(
  record: unknown,
  exitCode: PreparedCommandEmission["exitCode"],
): PreparedCommandEmission | null {
  const parsed = parseOrchestrationCommandResult(record);
  if (!parsed.ok) return null;
  return Object.freeze({ stdout: canonicalJson(parsed.value), stderr: "", exitCode });
}

function failure(command: string, code: FailureCode): PreparedCommandEmission {
  const row = failureRows[code];
  // All members here are trusted literals or an already-admitted command identity.
  const prepared = emission(
    {
      command,
      diagnostics: [{ code: row.code, message: row.message }],
      outcome: row.outcome,
      result: null,
      schemaVersion: "orchestration-command-result/v1",
    },
    row.exitCode,
  );
  if (prepared === null) throw new Error("command-result:internal-contract-drift");
  return prepared;
}

const argvRefusal = failure("", "ARGV_REFUSED");

/** Prepared bytes only: the eventual CLI bootstrap owns the single UTF-8 write. */
export function prepareArgvRefusal(): PreparedCommandEmission {
  return argvRefusal;
}

function frozenTree(input: unknown, depth = 0): boolean {
  if (input === null || typeof input !== "object") return true;
  if (depth > 64 || nodeTypes.isProxy(input) || !Object.isFrozen(input)) return false;
  // Called only after the public parser has refused cycles, accessors, exotic
  // prototypes and non-JSON values; descriptors avoid invoking input code.
  return Object.values(Object.getOwnPropertyDescriptors(input)).every(
    (descriptor) => "value" in descriptor && frozenTree(descriptor.value, depth + 1),
  );
}

function failureCode(error: ContractRecord): FailureCode | null {
  if (typeof error.code !== "string" || !Object.hasOwn(failureRows, error.code)) return null;
  const code = error.code as FailureCode;
  const row = failureRows[code];
  return error.exitCode === row.exitCode &&
    error.message === row.message &&
    error.outcome === row.outcome
    ? code
    : null;
}

/** Reduces a settled handler result or loader failure; never invokes a handler or performs I/O. */
export function prepareCommandResult(
  commandInput: unknown,
  input: unknown,
): PreparedCommandEmission {
  if (!knownCommand(commandInput)) return argvRefusal;
  try {
    const success = snapshotClosedRecord(input, ["ok", "result"]);
    if (success.ok && success.value.ok === true) {
      const prepared = emission(
        {
          command: commandInput,
          diagnostics: [],
          outcome: "success",
          result: success.value.result,
          schemaVersion: "orchestration-command-result/v1",
        },
        0,
      );
      const descriptor = Object.getOwnPropertyDescriptor(input, "result");
      if (prepared !== null && descriptor && "value" in descriptor && frozenTree(descriptor.value))
        return prepared;
      return failure(commandInput, "INTERNAL_ERROR");
    }
    const refused = snapshotClosedRecord(input, ["ok", "error"]);
    if (refused.ok && refused.value.ok === false) {
      const error = snapshotClosedRecord(refused.value.error, [
        "code",
        "exitCode",
        "message",
        "outcome",
      ]);
      const code = error.ok ? failureCode(error.value) : null;
      if (code !== null) return failure(commandInput, code);
    }
  } catch {
    // No input exception, parser detail, raw path or result fragment is emitted.
  }
  return failure(commandInput, "INTERNAL_ERROR");
}

/** The dispatcher supplies its validated registration.issue; no owner registry is added. */
export function preparePlaceholderResult(
  commandInput: unknown,
  issue: unknown,
): PreparedCommandEmission {
  if (!knownCommand(commandInput)) return argvRefusal;
  try {
    const prepared = emission(
      {
        command: commandInput,
        diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: issue }],
        outcome: "operation-failed",
        result: null,
        schemaVersion: "orchestration-command-result/v1",
      },
      5,
    );
    if (prepared !== null) return prepared;
  } catch {
    // The public envelope parser verifies the exact existing command/owner row.
  }
  return failure(commandInput, "INTERNAL_ERROR");
}

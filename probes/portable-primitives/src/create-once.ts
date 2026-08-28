import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalPortablePrimitiveCustodyRoot,
  executePortablePrimitiveChild,
  type PortablePrimitiveChildExecution,
} from "./executor.js";

export interface PortablePrimitiveCreateOnceRawFacts {
  readonly caseId: "CREATE_ONCE_32_CONTENDERS";
  readonly contenderCount: "32";
  readonly contenders: readonly PortablePrimitiveChildExecution[];
  readonly finalReadbackErrorCode: string | null;
  readonly finalReadbackHex: string | null;
  readonly schemaVersion: "portable-primitives-create-once-raw/v1";
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

export async function executePortablePrimitiveCreateOnceProbe(
  custodyRoot: string,
): Promise<PortablePrimitiveCreateOnceRawFacts> {
  const realCustodyRoot = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 32 }, () =>
      executePortablePrimitiveChild("EXCLUSIVE_CREATE", realCustodyRoot),
    ),
  );
  const failures = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      "create-once:child-execution-refused",
    );
  const contenders = Object.freeze(
    outcomes.map(
      (outcome) => (outcome as PromiseFulfilledResult<PortablePrimitiveChildExecution>).value,
    ),
  );
  let finalReadbackErrorCode: string | null = null;
  let finalReadbackHex: string | null = null;
  try {
    finalReadbackHex = (await readFile(resolve(realCustodyRoot, "create-once"))).toString("hex");
  } catch (error) {
    finalReadbackErrorCode = errorCode(error);
  }
  return Object.freeze({
    caseId: "CREATE_ONCE_32_CONTENDERS",
    contenderCount: "32",
    contenders,
    finalReadbackErrorCode,
    finalReadbackHex,
    schemaVersion: "portable-primitives-create-once-raw/v1",
  });
}

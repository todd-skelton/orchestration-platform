import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalPortablePrimitiveCustodyRoot,
  executePortablePrimitiveChild,
  type PortablePrimitiveChildExecution,
} from "./executor.js";

export const portablePrimitiveReplaceCases = Object.freeze([
  Object.freeze({ caseId: "REPLACE_BEFORE_CREATE", requestedBarrier: "READY" }),
  Object.freeze({ caseId: "REPLACE_AFTER_CREATE", requestedBarrier: "AFTER_CREATE" }),
  Object.freeze({ caseId: "REPLACE_AFTER_FILE_SYNC", requestedBarrier: "AFTER_FILE_SYNC" }),
  Object.freeze({ caseId: "REPLACE_AFTER_RENAME", requestedBarrier: "AFTER_RENAME" }),
  Object.freeze({
    caseId: "REPLACE_AFTER_DIRECTORY_SYNC",
    requestedBarrier: "AFTER_DIRECTORY_SYNC",
  }),
] as const);

export type PortablePrimitiveReplaceCaseId =
  (typeof portablePrimitiveReplaceCases)[number]["caseId"];
export type PortablePrimitiveReplaceBarrier =
  (typeof portablePrimitiveReplaceCases)[number]["requestedBarrier"];

export interface PortablePrimitiveReplaceRawFacts {
  readonly caseId: PortablePrimitiveReplaceCaseId;
  readonly child: PortablePrimitiveChildExecution;
  readonly finalReadbackErrorCode: string | null;
  readonly finalReadbackHex: string | null;
  readonly initialReadbackHex: "41";
  readonly requestedBarrier: PortablePrimitiveReplaceBarrier;
  readonly schemaVersion: "portable-primitives-replace-raw/v1";
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

async function seedTarget(rowRoot: string): Promise<"41"> {
  const target = await open(
    resolve(rowRoot, "replace-target"),
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    0o600,
  );
  try {
    await target.writeFile(Buffer.from("41", "hex"));
    await target.sync();
  } finally {
    await target.close();
  }
  const readback = (await readFile(resolve(rowRoot, "replace-target"))).toString("hex");
  if (readback !== "41") throw new Error("replace:initial-readback-refused");
  return readback;
}

async function executeReplaceRow(
  custodyRoot: string,
  definition: (typeof portablePrimitiveReplaceCases)[number],
): Promise<PortablePrimitiveReplaceRawFacts> {
  const rowRoot = resolve(custodyRoot, definition.caseId.toLowerCase().replaceAll("_", "-"));
  await mkdir(rowRoot);
  const initialReadbackHex = await seedTarget(rowRoot);
  const child = await executePortablePrimitiveChild("REPLACE", rowRoot, [
    definition.requestedBarrier,
  ]);
  let finalReadbackErrorCode: string | null = null;
  let finalReadbackHex: string | null = null;
  try {
    finalReadbackHex = (await readFile(resolve(rowRoot, "replace-target"))).toString("hex");
  } catch (error) {
    finalReadbackErrorCode = errorCode(error);
  }
  return Object.freeze({
    caseId: definition.caseId,
    child,
    finalReadbackErrorCode,
    finalReadbackHex,
    initialReadbackHex,
    requestedBarrier: definition.requestedBarrier,
    schemaVersion: "portable-primitives-replace-raw/v1",
  });
}

export async function executePortablePrimitiveReplaceProbe(
  custodyRoot: string,
): Promise<readonly PortablePrimitiveReplaceRawFacts[]> {
  const root = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const rows: PortablePrimitiveReplaceRawFacts[] = [];
  for (const definition of portablePrimitiveReplaceCases)
    rows.push(await executeReplaceRow(root, definition));
  return Object.freeze(rows);
}

import { mkdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalPortablePrimitiveCustodyRoot,
  executePortablePrimitiveChild,
  type PortablePrimitiveChildExecution,
} from "./executor.js";

export interface PortablePrimitiveAbsenceRawFacts {
  readonly caseId: "ABSENCE_HEAD_PLUS_ONE_TWO";
  readonly child: PortablePrimitiveChildExecution;
  readonly headPlusOneLeaf: "authority-head-plus-one";
  readonly headPlusTwoLeaf: "authority-head-plus-two";
  readonly providerPostChildHeadPlusOneCode: string;
  readonly providerPostChildHeadPlusTwoCode: string;
  readonly schemaVersion: "portable-primitives-absence-raw/v1";
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

async function lstatCode(path: string): Promise<string> {
  try {
    await lstat(path);
    return "PRESENT";
  } catch (error) {
    return errorCode(error);
  }
}

export async function executePortablePrimitiveAbsenceProbe(
  custodyRoot: string,
): Promise<PortablePrimitiveAbsenceRawFacts> {
  const root = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const rowRoot = resolve(root, "absence-head-plus-one-two");
  await mkdir(rowRoot);
  const child = await executePortablePrimitiveChild("ABSENCE", rowRoot);
  const headPlusOneLeaf = "authority-head-plus-one";
  const headPlusTwoLeaf = "authority-head-plus-two";
  const providerPostChildHeadPlusOneCode = await lstatCode(resolve(rowRoot, headPlusOneLeaf));
  const providerPostChildHeadPlusTwoCode = await lstatCode(resolve(rowRoot, headPlusTwoLeaf));
  return Object.freeze({
    caseId: "ABSENCE_HEAD_PLUS_ONE_TWO",
    child,
    headPlusOneLeaf,
    headPlusTwoLeaf,
    providerPostChildHeadPlusOneCode,
    providerPostChildHeadPlusTwoCode,
    schemaVersion: "portable-primitives-absence-raw/v1",
  });
}

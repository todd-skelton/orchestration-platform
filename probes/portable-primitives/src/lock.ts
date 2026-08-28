import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContractRecord } from "@orchestration-platform/contracts";
import {
  canonicalPortablePrimitiveCustodyRoot,
  executePortablePrimitiveChild,
  executePortablePrimitiveLockAttemptWithoutTimer,
  executePortablePrimitiveLockDescriptorChild,
  portablePrimitiveChildProviderObservedClosed,
  startPortablePrimitiveLockHolder,
  terminatePortablePrimitiveChild,
  type PortablePrimitiveChildExecution,
} from "./executor.js";

export interface PortablePrimitiveLockContentionRawFacts {
  readonly caseId: "LOCK_TWO_UNRELATED_PROCESSES";
  readonly contender: PortablePrimitiveChildExecution;
  readonly holderCloseObserved: true;
  readonly holderEvent: ContractRecord;
  readonly schemaVersion: "portable-primitives-lock-contention-raw/v1";
}

export interface PortablePrimitiveLockHolderDeathRawFacts {
  readonly acquisitionAttemptCount: "1";
  readonly caseId: "LOCK_HOLDER_DEATH";
  readonly holderCloseObserved: true;
  readonly holderEvent: ContractRecord;
  readonly postDeathAttempt: PortablePrimitiveChildExecution;
  readonly prohibitedActions: readonly PortablePrimitiveProhibitedAction[];
  readonly schemaVersion: "portable-primitives-lock-holder-death-raw/v1";
}

export type PortablePrimitiveProhibitedAction =
  "DELETE" | "RETRY" | "PID" | "AGE" | "LEASE" | "STALE_OWNER_INFERENCE";

export interface PortablePrimitiveLockNonInheritanceRawFacts {
  readonly caseId: "LOCK_DEFAULT_NON_INHERITANCE";
  readonly child: PortablePrimitiveChildExecution;
  readonly parentReadbackHex: string;
  readonly probeNonceHex: string;
  readonly schemaVersion: "portable-primitives-lock-non-inheritance-raw/v1";
}

export type PortablePrimitiveLockRawFacts =
  | PortablePrimitiveLockContentionRawFacts
  | PortablePrimitiveLockHolderDeathRawFacts
  | PortablePrimitiveLockNonInheritanceRawFacts;

async function lockRowRoot(custodyRoot: string, leaf: string): Promise<string> {
  const rowRoot = resolve(custodyRoot, leaf);
  await mkdir(rowRoot);
  return rowRoot;
}

async function closeHolder(child: Parameters<typeof terminatePortablePrimitiveChild>[0]) {
  await terminatePortablePrimitiveChild(child);
  if (!portablePrimitiveChildProviderObservedClosed(child))
    throw new Error("lock-holder:close-not-provider-observed");
}

async function executeContention(
  custodyRoot: string,
): Promise<PortablePrimitiveLockContentionRawFacts> {
  const holder = await startPortablePrimitiveLockHolder(custodyRoot);
  let contender: PortablePrimitiveChildExecution;
  try {
    contender = await executePortablePrimitiveChild("LOCK_ATTEMPT", custodyRoot);
  } finally {
    await closeHolder(holder.child);
  }
  return Object.freeze({
    caseId: "LOCK_TWO_UNRELATED_PROCESSES",
    contender,
    holderCloseObserved: true,
    holderEvent: holder.event,
    schemaVersion: "portable-primitives-lock-contention-raw/v1",
  });
}

async function executeHolderDeath(
  custodyRoot: string,
): Promise<PortablePrimitiveLockHolderDeathRawFacts> {
  const holder = await startPortablePrimitiveLockHolder(custodyRoot);
  await closeHolder(holder.child);
  const postDeathAttempt = await executePortablePrimitiveLockAttemptWithoutTimer(custodyRoot);
  return Object.freeze({
    acquisitionAttemptCount: "1",
    caseId: "LOCK_HOLDER_DEATH",
    holderCloseObserved: true,
    holderEvent: holder.event,
    postDeathAttempt,
    prohibitedActions: Object.freeze([]),
    schemaVersion: "portable-primitives-lock-holder-death-raw/v1",
  });
}

async function executeNonInheritance(
  custodyRoot: string,
): Promise<PortablePrimitiveLockNonInheritanceRawFacts> {
  const probeNonce = randomBytes(32);
  const holder = await open(
    resolve(custodyRoot, "owner-lock"),
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    0o600,
  );
  let child: PortablePrimitiveChildExecution;
  let parentReadbackHex: string;
  try {
    await holder.write(probeNonce, 0, probeNonce.length, 0);
    await holder.sync();
    child = await executePortablePrimitiveLockDescriptorChild(custodyRoot, holder.fd, null);
    const readback = Buffer.alloc(probeNonce.length);
    const { bytesRead } = await holder.read(readback, 0, readback.length, 0);
    parentReadbackHex = readback.subarray(0, bytesRead).toString("hex");
  } finally {
    await holder.close();
  }
  return Object.freeze({
    caseId: "LOCK_DEFAULT_NON_INHERITANCE",
    child,
    parentReadbackHex,
    probeNonceHex: probeNonce.toString("hex"),
    schemaVersion: "portable-primitives-lock-non-inheritance-raw/v1",
  });
}

export async function executePortablePrimitiveLockProbe(
  custodyRoot: string,
): Promise<
  readonly [
    PortablePrimitiveLockContentionRawFacts,
    PortablePrimitiveLockHolderDeathRawFacts,
    PortablePrimitiveLockNonInheritanceRawFacts,
  ]
> {
  const root = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const contention = await executeContention(await lockRowRoot(root, "lock-contention"));
  const holderDeath = await executeHolderDeath(await lockRowRoot(root, "lock-holder-death"));
  const nonInheritance = await executeNonInheritance(
    await lockRowRoot(root, "lock-default-non-inheritance"),
  );
  return Object.freeze([contention, holderDeath, nonInheritance] as const);
}

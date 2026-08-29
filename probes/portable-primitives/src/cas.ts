import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContractRecord } from "@orchestration-platform/contracts";
import {
  canonicalPortablePrimitiveCustodyRoot,
  executePortablePrimitiveChild,
  startPortablePrimitiveCasBarrierChild,
  type PortablePrimitiveChildExecution,
} from "./executor.js";

export interface PortablePrimitiveCasMismatchRawFacts {
  readonly caseId: "CAS_PREDECESSOR_MISMATCH";
  readonly child: PortablePrimitiveChildExecution;
  readonly finalReadbackErrorCode: string | null;
  readonly finalReadbackHex: string | null;
  readonly initialReadbackHex: "41";
  readonly predecessorHex: "42";
  readonly proposalHex: "42";
  readonly schemaVersion: "portable-primitives-cas-mismatch-raw/v1";
}

export interface PortablePrimitiveCasContentionRawFacts {
  readonly barrierEventOrder: readonly string[];
  readonly caseId: "CAS_TWO_CONTENDERS";
  readonly contenderCount: "2";
  readonly contenders: readonly [
    PortablePrimitiveCasBarrierContenderRawFacts,
    PortablePrimitiveCasBarrierContenderRawFacts,
  ];
  readonly finalReadbackErrorCode: string | null;
  readonly finalReadbackHex: string | null;
  readonly initialReadbackHex: "41";
  readonly predecessorHex: "41";
  readonly proposalHex: "42";
  readonly schemaVersion: "portable-primitives-cas-contention-raw/v1";
}

export interface PortablePrimitiveCasBarrierContenderRawFacts {
  readonly contenderId: "0" | "1";
  readonly readyEvent: ContractRecord;
  readonly releaseEvent: ContractRecord;
  readonly terminal: PortablePrimitiveChildExecution;
}

export type PortablePrimitiveCasRawFacts =
  PortablePrimitiveCasMismatchRawFacts | PortablePrimitiveCasContentionRawFacts;

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

async function rowRoot(custodyRoot: string, leaf: string): Promise<string> {
  const root = resolve(custodyRoot, leaf);
  await mkdir(root);
  return root;
}

async function seedTarget(root: string): Promise<"41"> {
  const handle = await open(
    resolve(root, "cas-target"),
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    0o600,
  );
  try {
    await handle.writeFile(Buffer.from("41", "hex"));
    await handle.sync();
  } finally {
    await handle.close();
  }
  const readback = (await readFile(resolve(root, "cas-target"))).toString("hex");
  if (readback !== "41") throw new Error("cas:initial-readback-refused");
  return readback;
}

async function finalReadback(root: string) {
  try {
    return Object.freeze({
      finalReadbackErrorCode: null,
      finalReadbackHex: (await readFile(resolve(root, "cas-target"))).toString("hex"),
    });
  } catch (error) {
    return Object.freeze({ finalReadbackErrorCode: errorCode(error), finalReadbackHex: null });
  }
}

export async function executePortablePrimitiveCasProbe(
  custodyRoot: string,
): Promise<
  readonly [PortablePrimitiveCasMismatchRawFacts, PortablePrimitiveCasContentionRawFacts]
> {
  const root = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const mismatchRoot = await rowRoot(root, "cas-predecessor-mismatch");
  const mismatchInitialReadbackHex = await seedTarget(mismatchRoot);
  const mismatchChild = await executePortablePrimitiveChild("CAS", mismatchRoot, ["42", "42"]);
  const mismatchFinal = await finalReadback(mismatchRoot);

  const contentionRoot = await rowRoot(root, "cas-two-contenders");
  const contentionInitialReadbackHex = await seedTarget(contentionRoot);
  const readyOrder: string[] = [];
  const liveContenders = await Promise.all(
    (["0", "1"] as const).map(async (contenderId) => {
      const live = await startPortablePrimitiveCasBarrierChild(contentionRoot);
      readyOrder.push(`CONTENDER_${contenderId}_READY`);
      return Object.freeze({ contenderId, live });
    }),
  );
  const barrierEventOrder = Object.freeze([...readyOrder, "RELEASE"]);
  const releaseEvents = await Promise.all(liveContenders.map(({ live }) => live.release()));
  const terminals = await Promise.all(liveContenders.map(({ live }) => live.execution));
  const contenders = liveContenders.map(({ contenderId, live }, index) =>
    Object.freeze({
      contenderId,
      readyEvent: live.readyEvent,
      releaseEvent: releaseEvents[index]!,
      terminal: terminals[index]!,
    }),
  );
  const contentionFinal = await finalReadback(contentionRoot);

  return Object.freeze([
    Object.freeze({
      caseId: "CAS_PREDECESSOR_MISMATCH",
      child: mismatchChild,
      ...mismatchFinal,
      initialReadbackHex: mismatchInitialReadbackHex,
      predecessorHex: "42",
      proposalHex: "42",
      schemaVersion: "portable-primitives-cas-mismatch-raw/v1",
    }),
    Object.freeze({
      barrierEventOrder,
      caseId: "CAS_TWO_CONTENDERS",
      contenderCount: "2",
      contenders: Object.freeze(contenders) as readonly [
        PortablePrimitiveCasBarrierContenderRawFacts,
        PortablePrimitiveCasBarrierContenderRawFacts,
      ],
      ...contentionFinal,
      initialReadbackHex: contentionInitialReadbackHex,
      predecessorHex: "41",
      proposalHex: "42",
      schemaVersion: "portable-primitives-cas-contention-raw/v1",
    }),
  ] as const);
}

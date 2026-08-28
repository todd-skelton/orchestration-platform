import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  executePortablePrimitiveHandleConfinementProbe,
  executePortablePrimitiveProcessProbe,
  parsePortablePrimitiveProcessChildEvent,
} from "../../probes/portable-primitives/src/index.js";
import { collectPortablePrimitiveProcessFacts } from "../../probes/portable-primitives/src/runtime-executor.js";

const roots: string[] = [];
const mutantWorkerPath = fileURLToPath(
  new URL("./fixtures/runtime-worker-mutant.mjs", import.meta.url),
);

async function root(label: string) {
  const value = await mkdtemp(resolve(tmpdir(), `orchestration-${label}-`));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

function spawnMutant(mode: string, custodyRoot: string): ChildProcess {
  return spawn(process.execPath, [mutantWorkerPath, mode], {
    cwd: custodyRoot,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
}

describe("ISS-022 raw process and handle probes", () => {
  test("binds termination only to the direct ChildProcess handle and provider terminal events", async () => {
    const facts = await executePortablePrimitiveProcessProbe(await root("process"));
    expect(facts).toEqual({
      closeCode: null,
      closeObserved: true,
      closeSignal: "SIGTERM",
      directChildHandleOwned: true,
      eventOrder: ["exit", "close"],
      exitCode: null,
      exitObserved: true,
      exitSignal: "SIGTERM",
      forcedKillAccepted: null,
      grandchildClaimAcceptedAsAuthority: false,
      grandchildClaimPresent: true,
      ipcNonceMatched: true,
      killAccepted: true,
      killRequestedSignal: "SIGTERM",
      messageCount: 1,
      outputLimitExceeded: false,
      responseAccepted: true,
      timedOut: false,
    });
    expect(Object.keys(facts)).not.toContain("grandchildPid");
    expect(JSON.stringify(facts)).not.toContain("PASS");
  });

  test("confines the probe-local callback handle to one WeakMap key and nonce lifetime", async () => {
    const facts = await executePortablePrimitiveHandleConfinementProbe(await root("handle"));
    expect(facts).toEqual({
      callbackInvocations: 1,
      crossProcessReplayRejected: true,
      directInvocationAccepted: true,
      nonceByteLength: 32,
      reuseAfterReleaseRejected: true,
      serializationRejected: true,
      structuredCloneRejected: true,
      workerTransferRejected: true,
      wrappedFunctionRejected: true,
    });
    expect(JSON.stringify(facts)).not.toContain("PASS");
  });

  test("refuses source-overlapping and noncanonical custody roots for every new probe", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../..");
    await expect(executePortablePrimitiveProcessProbe("relative")).rejects.toThrow();
    await expect(executePortablePrimitiveHandleConfinementProbe(sourceRoot)).rejects.toThrow(
      /source-overlap/,
    );
  });

  test("closes the process child event over nonce, fields, and scalar values", () => {
    const nonce = "1".repeat(64);
    const valid = {
      event: "READY",
      grandchildClaim: "1",
      nonce,
      schemaVersion: "portable-primitive-process-child-event/v1",
    };
    expect(parsePortablePrimitiveProcessChildEvent(valid, nonce).ok).toBe(true);
    for (const mutant of [
      { ...valid, nonce: "2".repeat(64) },
      { ...valid, event: "PASS" },
      { ...valid, grandchildClaim: "01" },
      { ...valid, extra: true },
      { event: "READY" },
    ])
      expect(parsePortablePrimitiveProcessChildEvent(mutant, nonce).ok).toBe(false);
  });

  test.each([
    ["NONCE_MISMATCH", "nonce"],
    ["MALFORMED", "malformed"],
    ["MULTIPLE", "multiple"],
    ["OVERFLOW", "overflow"],
    ["TIMEOUT", "timeout"],
  ] as const)("retains and refuses the %s hostile process arm", async (mode, expected) => {
    const custodyRoot = await root(`process-${mode.toLowerCase()}`);
    const child = spawnMutant(mode, custodyRoot);
    const facts = await collectPortablePrimitiveProcessFacts(
      child,
      randomBytes(32).toString("hex"),
      { cleanupAfterMilliseconds: 500, timeoutMilliseconds: 2_000 },
    );
    expect(facts.responseAccepted).toBe(false);
    expect(facts.closeObserved).toBe(true);
    expect(facts.grandchildClaimAcceptedAsAuthority).toBe(false);
    if (expected === "nonce") expect(facts.ipcNonceMatched).toBe(false);
    if (expected === "malformed") expect(facts.messageCount).toBe(1);
    if (expected === "multiple") expect(facts.messageCount).toBe(2);
    if (expected === "overflow") expect(facts.outputLimitExceeded).toBe(true);
    if (expected === "timeout") expect(facts.timedOut).toBe(true);
  });

  test("rejects at the absolute deadline even when forced termination is refused", async () => {
    const custodyRoot = await root("process-kill-refusal");
    const child = spawnMutant("TIMEOUT", custodyRoot);
    const originalKill = child.kill.bind(child);
    Object.defineProperty(child, "kill", { configurable: true, value: () => false });
    try {
      await expect(
        collectPortablePrimitiveProcessFacts(child, randomBytes(32).toString("hex"), {
          cleanupAfterMilliseconds: 50,
          timeoutMilliseconds: 200,
        }),
      ).rejects.toThrow(/terminal-deadline-exceeded/);
    } finally {
      Object.defineProperty(child, "kill", { configurable: true, value: originalKill });
      if (child.exitCode === null && child.signalCode === null) originalKill("SIGKILL");
      await once(child, "close");
    }
  });
});

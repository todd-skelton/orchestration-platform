import { constants } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  bindPortablePrimitiveRawChildEvent,
  executePortablePrimitiveCasProbe,
  executePortablePrimitiveChild,
  executePortablePrimitiveCreateOnceProbe,
  executePortablePrimitiveLockDescriptorChild,
  parsePortablePrimitiveRawChildEvent,
  startPortablePrimitiveLockHolder,
  terminatePortablePrimitiveChild,
} from "../../probes/portable-primitives/src/index.js";

const roots: string[] = [];

async function root(label: string) {
  const value = await mkdtemp(resolve(tmpdir(), `orchestration-${label}-`));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("ISS-022 raw filesystem executor", () => {
  test("records one winner and 31 raw EEXIST losers from 32 fresh child attempts", async () => {
    const custodyRoot = await root("create-once");
    const rawFacts = await executePortablePrimitiveCreateOnceProbe(custodyRoot);
    const results = rawFacts.contenders;
    expect(rawFacts).toMatchObject({
      caseId: "CREATE_ONCE_32_CONTENDERS",
      contenderCount: "32",
      finalReadbackErrorCode: null,
      finalReadbackHex: "41",
      schemaVersion: "portable-primitives-create-once-raw/v1",
    });
    expect(results.filter(({ event }) => event?.event === "CREATED")).toHaveLength(1);
    expect(
      results.filter(({ event }) => event?.event === "ERROR" && event.errorCode === "EEXIST"),
    ).toHaveLength(31);
    expect(await readFile(resolve(custodyRoot, "create-once"), "hex")).toBe("41");
    expect(results.every(({ stdout }) => !stdout.includes("PASS"))).toBe(true);
  }, 60_000);

  test("records the persistent O_EXCL owner-death gap without deletion or retry", async () => {
    const custodyRoot = await root("owner-death");
    const holder = await startPortablePrimitiveLockHolder(custodyRoot);
    let terminated = false;
    try {
      expect(holder.event).toMatchObject({ event: "ACQUIRED", mode: "LOCK_HOLDER" });
      const contender = await executePortablePrimitiveChild("LOCK_ATTEMPT", custodyRoot);
      expect(contender.event).toMatchObject({ event: "ERROR", errorCode: "EEXIST" });
      await terminatePortablePrimitiveChild(holder.child);
      terminated = true;
      const afterDeath = await executePortablePrimitiveChild("LOCK_ATTEMPT", custodyRoot);
      expect(afterDeath.event).toMatchObject({ event: "ERROR", errorCode: "EEXIST" });
    } finally {
      if (!terminated) await terminatePortablePrimitiveChild(holder.child);
    }
  }, 30_000);

  test("closes a non-acquired holder before rejecting startup", async () => {
    const custodyRoot = await root("holder-refusal");
    await writeFile(resolve(custodyRoot, "owner-lock"), "occupied");
    await expect(startPortablePrimitiveLockHolder(custodyRoot)).rejects.toThrow(
      /lock-holder:not-acquired/,
    );
    await rm(custodyRoot, { recursive: true });
  });

  test("observes an explicitly mapped parent lock descriptor and its exact nonce", async () => {
    const custodyRoot = await root("lock-explicit-descriptor");
    const nonce = Buffer.from("cd".repeat(32), "hex");
    const holder = await open(
      resolve(custodyRoot, "owner-lock"),
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    try {
      await holder.write(nonce, 0, nonce.length, 0);
      await holder.sync();
      const result = await executePortablePrimitiveLockDescriptorChild(custodyRoot, 3, holder.fd);
      expect(result.event).toMatchObject({
        accessResult: "ACCESSED",
        readbackHex: nonce.toString("hex"),
      });
    } finally {
      await holder.close();
    }
  });

  test("keeps the post-death lock attempt timer- and kill-free with one spawn", async () => {
    const executorSource = await readFile(
      resolve(import.meta.dirname, "../../probes/portable-primitives/src/executor.ts"),
      "utf8",
    );
    const noTimer = executorSource.slice(
      executorSource.indexOf(
        "export async function executePortablePrimitiveLockAttemptWithoutTimer",
      ),
      executorSource.indexOf("export async function executePortablePrimitiveLockDescriptorChild"),
    );
    expect(noTimer).not.toMatch(
      /setTimeout|clearTimeout|\.kill\(|executePortablePrimitiveChild(?:WithTimer)?|observePortablePrimitiveChild(?:WithTimer)?\(/,
    );
    expect(noTimer.match(/observePortablePrimitiveChildWithoutKill\(/g)).toHaveLength(1);
    expect(noTimer.match(/\bspawn\(/g)).toHaveLength(1);
    expect(noTimer.match(/"LOCK_ATTEMPT"/g)).toHaveLength(1);
    const observerWithoutKill = executorSource.slice(
      executorSource.indexOf("async function observePortablePrimitiveChildWithoutKill("),
      executorSource.indexOf("function parseBoundChildOutput"),
    );
    expect(observerWithoutKill).not.toMatch(/setTimeout|clearTimeout|\.kill\(/);
    expect(observerWithoutKill).toMatch(/outputLimitExceeded = true/);
    expect(observerWithoutKill).toMatch(/else target\.push\(chunk\)/);

    const reachableHelpers = [
      [
        "export async function canonicalPortablePrimitiveCustodyRoot",
        "export function portablePrimitiveChildEnvironment",
      ],
      [
        "export function portablePrimitiveChildEnvironment",
        "export interface PortablePrimitiveLiveChild",
      ],
      [
        "export function bindPortablePrimitiveRawChildEvent",
        "export interface PortablePrimitiveChildExecution",
      ],
      ["function parseBoundChildOutput", "function parseDescriptorChildOutput"],
      ["function parseChildOutput", "async function observePortablePrimitiveChildWithTimer"],
    ]
      .map(([start, end]) =>
        executorSource.slice(executorSource.indexOf(start!), executorSource.indexOf(end!)),
      )
      .join("\n");
    expect(reachableHelpers).not.toMatch(/setTimeout|clearTimeout|\.kill\(/);

    const boundedObserver = executorSource.slice(
      executorSource.indexOf("async function observePortablePrimitiveChild("),
      executorSource.indexOf("async function observePortablePrimitiveChildWithoutKill("),
    );
    expect(boundedObserver).toMatch(/child\.kill\("SIGKILL"\)/);

    const lockSource = await readFile(
      resolve(import.meta.dirname, "../../probes/portable-primitives/src/lock.ts"),
      "utf8",
    );
    const death = lockSource.slice(
      lockSource.indexOf("async function executeHolderDeath"),
      lockSource.indexOf("async function executeNonInheritance"),
    );
    expect(death).not.toMatch(/setTimeout|unlink|\brm\b|\bpid\b|\bage\b|\blease\b|stale/i);
    expect(death.match(/executePortablePrimitiveLockAttemptWithoutTimer\(/g)).toHaveLength(1);
    expect(death).not.toMatch(/executePortablePrimitiveChild\(/);
  });

  test.each([
    ["READY", "41"],
    ["AFTER_CREATE", "41"],
    ["AFTER_FILE_SYNC", "41"],
    ["AFTER_RENAME", "42"],
    ["AFTER_DIRECTORY_SYNC", "42"],
  ] as const)(
    "records replace crash barrier %s with raw readback %s",
    async (barrier, expected) => {
      const custodyRoot = await root(`replace-${barrier.toLowerCase()}`);
      await writeFile(resolve(custodyRoot, "replace-target"), Buffer.from("41", "hex"));
      const result = await executePortablePrimitiveChild("REPLACE", custodyRoot, [barrier]);
      if (result.event?.event === "ERROR") return;
      expect(result.event).toMatchObject({ event: "REACHED_BARRIER", barrier });
      expect(result.signal).toBe("SIGKILL");
      expect(await readFile(resolve(custodyRoot, "replace-target"), "hex")).toBe(expected);
    },
  );

  test("records the exact provider-owned two-row CAS census", async () => {
    const [mismatch, contention] = await executePortablePrimitiveCasProbe(await root("cas"));
    expect(mismatch).toMatchObject({
      caseId: "CAS_PREDECESSOR_MISMATCH",
      finalReadbackHex: "41",
      initialReadbackHex: "41",
      predecessorHex: "42",
      proposalHex: "42",
    });
    expect(mismatch.child.event).toMatchObject({
      event: "PREDECESSOR_MISMATCH",
      readbackHex: "41",
    });
    expect(contention).toMatchObject({
      caseId: "CAS_TWO_CONTENDERS",
      contenderCount: "2",
      finalReadbackHex: "42",
      initialReadbackHex: "41",
      predecessorHex: "41",
      proposalHex: "42",
    });
    expect(contention.barrierEventOrder[2]).toBe("RELEASE");
    expect(new Set(contention.barrierEventOrder.slice(0, 2))).toEqual(
      new Set(["CONTENDER_0_READY", "CONTENDER_1_READY"]),
    );
    expect(
      contention.contenders.filter(
        ({ terminal }) =>
          terminal.event?.event === "ERROR" && terminal.event.errorCode === "EEXIST",
      ),
    ).toHaveLength(1);
    const nonExisting = contention.contenders.find(
      ({ terminal }) =>
        !(terminal.event?.event === "ERROR" && terminal.event.errorCode === "EEXIST"),
    )?.terminal;
    expect(
      nonExisting?.event?.event === "SELECTED" ||
        (nonExisting?.event?.event === "ERROR" &&
          ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(
            String(nonExisting.event.errorCode),
          )),
    ).toBe(true);
    expect(
      [mismatch.child, ...contention.contenders.map(({ terminal }) => terminal)].every(
        ({ stdout }) => !stdout.includes("PASS"),
      ),
    ).toBe(true);

    const worker = await readFile(
      resolve(import.meta.dirname, "../../probes/portable-primitives/src/filesystem-worker.mjs"),
      "utf8",
    );
    const cas = worker.slice(
      worker.indexOf("async function cas("),
      worker.indexOf("async function absence("),
    );
    const selectedRead = cas.indexOf("const selectedReadback");
    const selectedClose = cas.indexOf("await lockHandle.close()", selectedRead);
    expect(selectedRead).toBeGreaterThan(-1);
    expect(selectedClose).toBeGreaterThan(selectedRead);
    expect(cas.indexOf('event("SELECTED"', selectedClose)).toBeGreaterThan(selectedClose);
    const mismatchSource = cas.slice(cas.indexOf("const readback"), cas.indexOf("const proposal"));
    expect(mismatchSource.indexOf("await readFile(target)")).toBeLessThan(
      mismatchSource.indexOf("await lockHandle.close()"),
    );
    expect(mismatchSource).not.toMatch(/writeFile|rename/);
  });

  test("records exact head-plus-one and head-plus-two absence errno", async () => {
    const custodyRoot = await root("absence");
    const result = await executePortablePrimitiveChild("ABSENCE", custodyRoot);
    expect(result.event).toMatchObject({
      event: "ABSENCE_OBSERVED",
      headPlusOneCode: "ENOENT",
      headPlusTwoCode: "ENOENT",
    });
  });

  test("refuses malformed child events and arbitrary roots or argument widening", async () => {
    const valid = {
      barrier: null,
      errorCode: null,
      event: "CREATED",
      headPlusOneCode: null,
      headPlusTwoCode: null,
      mode: "EXCLUSIVE_CREATE",
      readbackHex: "41",
      schemaVersion: "portable-primitives-raw-child-event/v1",
    };
    expect(parsePortablePrimitiveRawChildEvent(valid).ok).toBe(true);
    for (const mutant of [
      { ...valid, event: "PASS" },
      { ...valid, mode: "ABSENCE", event: "SELECTED", readbackHex: "42" },
      { ...valid, mode: "CAS", event: "CREATED" },
      { ...valid, mode: "CAS", event: "SELECTED", readbackHex: null },
      { ...valid, mode: "CAS", event: "SELECTED", readbackHex: "41" },
      { ...valid, mode: "CAS", event: "PREDECESSOR_MISMATCH", readbackHex: null },
      { ...valid, errorCode: "EEXIST" },
      { ...valid, barrier: "READY" },
      { ...valid, extra: true },
    ])
      expect(parsePortablePrimitiveRawChildEvent(mutant).ok).toBe(false);
    expect(
      bindPortablePrimitiveRawChildEvent(
        {
          ...valid,
          mode: "REPLACE",
          event: "REACHED_BARRIER",
          barrier: "AFTER_CREATE",
          readbackHex: null,
        },
        "REPLACE",
        ["AFTER_FILE_SYNC"],
      ).ok,
    ).toBe(false);
    expect(
      bindPortablePrimitiveRawChildEvent(
        { ...valid, mode: "CAS", event: "PREDECESSOR_MISMATCH", readbackHex: "41" },
        "CAS",
        ["41", "42"],
      ).ok,
    ).toBe(false);
    expect(bindPortablePrimitiveRawChildEvent(valid, "ABSENCE", []).ok).toBe(false);
    await expect(executePortablePrimitiveChild("ABSENCE", "relative")).rejects.toThrow();
    await expect(
      executePortablePrimitiveChild("ABSENCE", resolve(import.meta.dirname, "../..")),
    ).rejects.toThrow(/source-overlap/);
    const custodyRoot = await root("arguments");
    await expect(
      executePortablePrimitiveChild("ABSENCE", custodyRoot, ["one", "two", "three"]),
    ).rejects.toThrow();
  });
});

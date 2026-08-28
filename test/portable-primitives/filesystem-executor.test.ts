import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  bindPortablePrimitiveRawChildEvent,
  executePortablePrimitiveChild,
  parsePortablePrimitiveRawChildEvent,
  portablePrimitiveWorkerPath,
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
    const results = await Promise.all(
      Array.from({ length: 32 }, () =>
        executePortablePrimitiveChild("EXCLUSIVE_CREATE", custodyRoot),
      ),
    );
    expect(results.filter(({ event }) => event?.event === "CREATED")).toHaveLength(1);
    expect(
      results.filter(({ event }) => event?.event === "ERROR" && event.errorCode === "EEXIST"),
    ).toHaveLength(31);
    expect(await readFile(resolve(custodyRoot, "create-once"), "hex")).toBe("41");
    expect(results.every(({ stdout }) => !stdout.includes("PASS"))).toBe(true);
  });

  test("records the persistent O_EXCL owner-death gap without deletion or retry", async () => {
    const custodyRoot = await root("owner-death");
    const holder = spawn(
      process.execPath,
      [portablePrimitiveWorkerPath, "LOCK_HOLDER", custodyRoot],
      { cwd: custodyRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const line = await new Promise<string>((resolveLine, reject) => {
      holder.once("error", reject);
      holder.stdout.once("data", (chunk: Buffer) => resolveLine(chunk.toString("utf8")));
    });
    expect(parsePortablePrimitiveRawChildEvent(JSON.parse(line)).ok).toBe(true);
    expect(JSON.parse(line).event).toBe("ACQUIRED");
    const contender = await executePortablePrimitiveChild("LOCK_ATTEMPT", custodyRoot);
    expect(contender.event).toMatchObject({ event: "ERROR", errorCode: "EEXIST" });
    holder.kill("SIGKILL");
    await new Promise<void>((resolveClose) => holder.once("close", () => resolveClose()));
    const afterDeath = await executePortablePrimitiveChild("LOCK_ATTEMPT", custodyRoot);
    expect(afterDeath.event).toMatchObject({ event: "ERROR", errorCode: "EEXIST" });
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

  test("records CAS mismatch, selection, and persistent-lock contention as raw facts", async () => {
    const mismatchRoot = await root("cas-mismatch");
    await writeFile(resolve(mismatchRoot, "cas-target"), Buffer.from("41", "hex"));
    const mismatch = await executePortablePrimitiveChild("CAS", mismatchRoot, ["42", "42"]);
    expect(mismatch.event).toMatchObject({
      event: "PREDECESSOR_MISMATCH",
      readbackHex: "41",
    });

    const selectionRoot = await root("cas-selection");
    await writeFile(resolve(selectionRoot, "cas-target"), Buffer.from("41", "hex"));
    const results = await Promise.all([
      executePortablePrimitiveChild("CAS", selectionRoot, ["41", "42"]),
      executePortablePrimitiveChild("CAS", selectionRoot, ["41", "42"]),
    ]);
    expect(
      results.filter(({ event }) => event?.event === "ERROR" && event.errorCode === "EEXIST"),
    ).toHaveLength(1);
    const winner = results.find(
      ({ event }) => !(event?.event === "ERROR" && event.errorCode === "EEXIST"),
    );
    expect(winner?.event?.event === "SELECTED" || winner?.event?.event === "ERROR").toBe(true);
    if (winner?.event?.event === "ERROR")
      expect(["EACCES", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"]).toContain(
        winner.event.errorCode,
      );
    expect(await readFile(resolve(selectionRoot, "cas-target"), "hex")).toBe("42");
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
    const sourceOverlap = await executePortablePrimitiveChild(
      "ABSENCE",
      resolve(import.meta.dirname, "../.."),
    );
    expect(sourceOverlap.event).toBeNull();
    expect(sourceOverlap.stderr).toContain("root:source-overlap");
    const custodyRoot = await root("arguments");
    await expect(
      executePortablePrimitiveChild("ABSENCE", custodyRoot, ["one", "two", "three"]),
    ).rejects.toThrow();
  });
});

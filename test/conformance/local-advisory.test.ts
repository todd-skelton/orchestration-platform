import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { iss002TestBundlePaths } from "../../packages/conformance/src/stable-bundles.js";
import type { Iss002WalkResult } from "../../packages/conformance/src/walk.js";
import {
  runLocalHarness,
  runLocalWalk,
  runStableContractTests,
} from "../../scripts/harness-test.mjs";

const passWalk: Iss002WalkResult = Object.freeze({
  durationsNanoseconds: Object.freeze(["1", "2", "3"]),
  maximumWalkDurationNanoseconds: "3",
  ok: true,
});

async function invoke(contractsOk: boolean, walk: Iss002WalkResult = passWalk) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runLocalHarness({
    executeContracts: async () => ({
      ok: contractsOk,
      stderr: contractsOk ? "" : "candidate diagnostic",
      stdout: "stable runner diagnostic\n",
    }),
    executeWalk: async () => walk,
    writeStderr: (value: string) => stderr.push(value),
    writeStdout: (value: string) => stdout.push(value),
  });
  return { exitCode, stderr: stderr.join(""), stdout: stdout.join("") };
}

describe("local advisory conformance entrypoint", () => {
  test("passes every reviewed contract test path individually without directory discovery", async () => {
    let arguments_: readonly string[] = [];
    const result = await runStableContractTests(async (_executable, observedArguments) => {
      arguments_ = observedArguments;
      return { stderr: "", stdout: "" };
    });
    expect(result.ok).toBe(true);
    const expected = iss002TestBundlePaths.filter((path) => path.startsWith("test/contracts/"));
    expect(arguments_.slice(2, 2 + expected.length)).toEqual(expected);
    expect(arguments_).not.toContain("test/contracts");
    expect(arguments_.filter((value) => value.startsWith("test/contracts/"))).toHaveLength(40);
  });

  test("starts with the exact marker, emits no hosted record, and returns zero only for all-pass", async () => {
    const passed = await invoke(true);
    expect(passed.exitCode).toBe(0);
    expect(passed.stdout.startsWith("ADVISORY CONFORMANCE RESULT\n")).toBe(true);
    expect(passed.stdout).not.toMatch(/schemaVersion|providerRunDigest|aggregateDigest/);
    expect(JSON.parse(passed.stdout.trim().split("\n").at(-1)!)).toEqual({
      advisory: true,
      contracts: "PASS",
      maximumWalkDurationNanoseconds: "3",
      walk: "PASS",
    });
    for (const result of [
      await invoke(false),
      await invoke(true, { issues: ["refused"], ok: false }),
    ])
      expect(result.exitCode).toBe(1);
  });

  test("normalizes thrown walk execution to advisory failure without a hosted serializer", async () => {
    const stdout: string[] = [];
    const exitCode = await runLocalHarness({
      executeContracts: async () => ({ ok: true, stderr: "", stdout: "" }),
      executeWalk: async () => {
        stdout.push("import-time diagnostic\n");
        throw new Error("walk failed");
      },
      writeStderr: () => undefined,
      writeStdout: (value: string) => stdout.push(value),
    });
    expect(exitCode).toBe(1);
    expect(stdout.join("").startsWith("ADVISORY CONFORMANCE RESULT\n")).toBe(true);
    const source = await readFile(
      resolve(import.meta.dirname, "../../scripts/harness-test.mts"),
      "utf8",
    );
    expect(source).not.toMatch(/createConformanceJobEvidence|reduceConformanceAggregate|github-/);
    const contractFailureOutput: string[] = [];
    expect(
      await runLocalHarness({
        executeContracts: async () => {
          throw new Error("contract runner failed");
        },
        executeWalk: async () => passWalk,
        writeStderr: () => undefined,
        writeStdout: (value: string) => contractFailureOutput.push(value),
      }),
    ).toBe(1);
    expect(contractFailureOutput.join("").startsWith("ADVISORY CONFORMANCE RESULT\n")).toBe(true);
  });

  test("refuses an in-checkout temp parent before creating roots", async () => {
    let creationCalls = 0;
    await expect(
      runLocalWalk({
        makeTemporaryRoot: async () => {
          creationCalls += 1;
          return "unused";
        },
        temporaryParent: resolve(import.meta.dirname, "../.."),
      }),
    ).rejects.toThrow(/temporary parent must be external/);
    expect(creationCalls).toBe(0);

    const target = await mkdtemp(resolve(tmpdir(), "orchestration-local-temp-target-"));
    const container = await mkdtemp(resolve(tmpdir(), "orchestration-local-temp-link-"));
    const linkedParent = resolve(container, "linked-parent");
    try {
      await symlink(target, linkedParent, "junction");
      await expect(
        runLocalWalk({
          makeTemporaryRoot: async () => {
            creationCalls += 1;
            return "unused";
          },
          temporaryParent: linkedParent,
        }),
      ).rejects.toThrow(/temporary parent must be external/);
      expect(creationCalls).toBe(0);
    } finally {
      await Promise.all([
        rm(container, { force: true, recursive: true }),
        rm(target, { force: true, recursive: true }),
      ]);
    }
  });

  test("cleans the first root when second-root creation fails and attempts every cleanup", async () => {
    const removed: string[] = [];
    let creationCalls = 0;
    await expect(
      runLocalWalk({
        loadWalk: async () =>
          ({
            runIss002CrossRootWalk: async () => passWalk,
          }) as never,
        makeTemporaryRoot: async () => {
          creationCalls += 1;
          if (creationCalls === 2) throw new Error("second root refused");
          return resolve(tmpdir(), "injected-first-root");
        },
        removeTree: async (path) => {
          removed.push(String(path));
        },
      }),
    ).rejects.toThrow(/second root refused/);
    expect(removed).toEqual([resolve(tmpdir(), "injected-first-root")]);

    let removalCalls = 0;
    await expect(
      runLocalWalk({
        copyTree: async () => undefined,
        loadWalk: async () =>
          ({
            runIss002CrossRootWalk: async () => passWalk,
          }) as never,
        makeDirectory: async () => undefined,
        makeTemporaryRoot: async (prefix) => `${prefix}${++creationCalls}`,
        removeTree: async () => {
          removalCalls += 1;
          if (removalCalls === 1) throw new Error("cleanup refused");
        },
      }),
    ).rejects.toThrow(/temporary-root cleanup refused/);
    expect(removalCalls).toBe(2);
  });
});

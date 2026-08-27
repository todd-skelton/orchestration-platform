import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  executeIss002ContractSelection,
  prepareIss002WorkspaceDependencies,
  type Iss002Process,
} from "../../scripts/conformance/iss002-executor.mjs";
import { iss002StableVectorSelections } from "../../packages/conformance/src/index.js";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-iss002-executor-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("ISS-002 fixed-selector process executor", () => {
  test("prepares dependencies only through the frozen offline graph", async () => {
    const root = await workspace();
    const calls: Parameters<Iss002Process>[] = [];
    const result = await prepareIss002WorkspaceDependencies(root, root, async (...arguments_) => {
      calls.push(arguments_);
      return {
        stderr: new Uint8Array(),
        stdout:
          calls.length === 1
            ? new TextEncoder().encode(`${resolve(root, "store")}\n`)
            : new Uint8Array(),
      };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const corepackEntry = resolve(process.execPath, "../node_modules/corepack/dist/corepack.js");
    expect(calls[0]?.[0]).toBe(process.execPath);
    expect(calls[0]?.[1]).toEqual([corepackEntry, "pnpm", "store", "path", "--silent"]);
    expect(calls[1]?.[1]).toEqual([
      corepackEntry,
      "pnpm",
      "--store-dir",
      resolve(root, "store"),
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
    ]);
    expect(calls[1]?.[2]).toMatchObject({ cwd: root, encoding: "buffer", windowsHide: true });
    expect(calls[1]?.[2].env).not.toHaveProperty("GITHUB_TOKEN");
    expect(calls[1]?.[2].env).not.toHaveProperty("GITHUB_RUN_ID");
  });

  test("runs an exact stable selector in a fresh Node child with a scrubbed environment", async () => {
    const root = await workspace();
    const selection = iss002StableVectorSelections[0]!;
    let observed: Parameters<Iss002Process> | undefined;
    const result = await executeIss002ContractSelection(root, selection, async (...arguments_) => {
      observed = arguments_;
      return { stderr: Uint8Array.from([3]), stdout: Uint8Array.from([1, 2]) };
    });
    expect(result).toEqual({
      normalizedResult: "PASS",
      stderrBytes: Uint8Array.from([3]),
      stdoutBytes: Uint8Array.from([1, 2]),
      walkDurationsNanoseconds: null,
    });
    expect(observed?.[0]).toBe(process.execPath);
    expect(observed?.[1]).toEqual([
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/contracts/authority.test.ts",
      "--testTimeout=600000",
      "--hookTimeout=600000",
    ]);
    expect(Object.keys(observed?.[2].env ?? {}).sort()).toEqual(
      [
        ...(process.env.SystemRoot ? ["SystemRoot"] : []),
        ...(process.env.WINDIR ? ["WINDIR"] : []),
        "LANG",
        "LC_ALL",
        "TEMP",
        "TMP",
        "TMPDIR",
        "TZ",
      ].sort(),
    );
    expect(observed?.[2].env).not.toHaveProperty("PATH");
    expect(observed?.[2].env).not.toHaveProperty("GITHUB_TOKEN");
  });

  test("refuses selector substitution and retains exact failed child streams", async () => {
    const root = await workspace();
    let calls = 0;
    const substituted = await executeIss002ContractSelection(
      root,
      { ...iss002StableVectorSelections[0]!, testFiles: ["candidate.test.ts"] },
      async () => {
        calls += 1;
        return { stderr: new Uint8Array(), stdout: new Uint8Array() };
      },
    );
    expect(substituted.normalizedResult).toBe("FAIL");
    expect(calls).toBe(0);
    const failed = await executeIss002ContractSelection(
      root,
      iss002StableVectorSelections[0]!,
      async () => {
        throw Object.assign(new Error("candidate failure"), {
          stderr: Uint8Array.from([0xff]),
          stdout: Uint8Array.from([0x00, 0x01]),
        });
      },
    );
    expect(failed).toEqual({
      normalizedResult: "FAIL",
      stderrBytes: Uint8Array.from([0xff]),
      stdoutBytes: Uint8Array.from([0x00, 0x01]),
      walkDurationsNanoseconds: null,
    });
  });
});

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  runIss002NativeCandidateObservation,
  runIss002NativeCandidateWalk,
} from "../../packages/conformance/src/iss002-native-candidate-walk.js";

const roots: string[] = [];
async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

describe("ISS-002 reviewed candidate fresh-child walk", () => {
  test("materializes reviewed bytes, launches fresh children, and removes artifacts", async () => {
    const candidateSourceRoot = await root("orchestration-reviewed-candidate-");
    const materializationParent = await root("orchestration-materialization-");
    const executionParent = await root("orchestration-execution-");
    await mkdir(resolve(candidateSourceRoot, "packages"));
    await cp(
      resolve(import.meta.dirname, "../../packages/contracts"),
      resolve(candidateSourceRoot, "packages/contracts"),
      { recursive: true },
    );
    const files: Array<Readonly<Record<string, unknown>>> = [];
    for (const entry of await readdir(candidateSourceRoot, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const path = resolve(entry.parentPath, entry.name);
      const bytes = await readFile(path);
      files.push(
        Object.freeze({
          byteLength: String(bytes.byteLength),
          executable: false,
          path: path.slice(candidateSourceRoot.length + 1).replaceAll("\\", "/"),
          sha256Digest: createHash("sha256").update(bytes).digest("hex"),
        }),
      );
    }
    files.sort((left, right) =>
      Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))),
    );
    const result = await runIss002NativeCandidateWalk({
      candidateSourceRoot,
      candidateSubject: Object.freeze({
        files: Object.freeze(files),
        schemaVersion: "conformance-candidate-subject/v1",
      }),
      executionParent,
      materializationParent,
    });
    expect(result.ok).toBe(true);
    expect(await readdir(executionParent)).toEqual([]);
    expect(await readdir(materializationParent)).toEqual([]);
  }, 120_000);

  test("returns stable-parent raw streams only through the observation API", async () => {
    const candidateSourceRoot = await root("orchestration-reviewed-observation-");
    const materializationParent = await root("orchestration-observation-materialization-");
    const executionParent = await root("orchestration-observation-execution-");
    await mkdir(resolve(candidateSourceRoot, "packages"));
    await cp(
      resolve(import.meta.dirname, "../../packages/contracts"),
      resolve(candidateSourceRoot, "packages/contracts"),
      { recursive: true },
    );
    const files: Array<Readonly<Record<string, unknown>>> = [];
    for (const entry of await readdir(candidateSourceRoot, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const path = resolve(entry.parentPath, entry.name);
      const bytes = await readFile(path);
      files.push(
        Object.freeze({
          byteLength: String(bytes.byteLength),
          executable: false,
          path: path.slice(candidateSourceRoot.length + 1).replaceAll("\\", "/"),
          sha256Digest: createHash("sha256").update(bytes).digest("hex"),
        }),
      );
    }
    files.sort((left, right) =>
      Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))),
    );
    const observed = await runIss002NativeCandidateObservation({
      candidateSourceRoot,
      candidateSubject: Object.freeze({
        files: Object.freeze(files),
        schemaVersion: "conformance-candidate-subject/v1",
      }),
      executionParent,
      materializationParent,
    });
    expect(observed.ok).toBe(true);
    expect(observed.stdoutBytes.byteLength).toBeGreaterThan(0);
    expect(observed.stderrBytes.byteLength).toBe(0);
    expect(await readdir(executionParent)).toEqual([]);
    expect(await readdir(materializationParent)).toEqual([]);
  }, 120_000);

  test("rejects malformed input without creating an execution artifact", async () => {
    const executionParent = await root("orchestration-execution-refusal-");
    const result = await runIss002NativeCandidateWalk({
      candidateSourceRoot: "relative",
      candidateSubject: {},
      executionParent,
      materializationParent: await root("orchestration-materialization-refusal-"),
    });
    expect(result).toEqual({ issues: ["candidate-walk:input-refused"], ok: false });
    expect(await readdir(executionParent)).toEqual([]);
  });

  test("contains no same-host isolation authority", async () => {
    const source = await readFile(
      resolve(
        import.meta.dirname,
        "../../packages/conformance/src/iss002-native-candidate-walk.ts",
      ),
      "utf8",
    );
    for (const term of [
      "AppContainer",
      "sudo",
      "setpriv",
      "principal",
      "isolation-authority",
      "broker",
    ])
      expect(source).not.toContain(term);
  });
});

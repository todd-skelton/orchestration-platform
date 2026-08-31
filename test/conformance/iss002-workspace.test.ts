import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  executeIss002ContractSelection,
  prepareIss002WorkspaceDependencies,
} from "../../scripts/conformance/iss002-executor.mjs";
import { withIss002ExecutionWorkspace } from "../../scripts/conformance/iss002-workspace.mjs";
import { iss002StableVectorSelections } from "../../packages/conformance/src/index.js";

const roots: string[] = [];
const stableRoot = resolve(import.meta.dirname, "../..");

async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(value);
  return value;
}

async function candidate(): Promise<{
  readonly root: string;
  readonly subject: Readonly<Record<string, unknown>>;
}> {
  const candidateRoot = await root("orchestration-workspace-candidate-");
  await mkdir(resolve(candidateRoot, "packages"));
  await cp(
    resolve(stableRoot, "packages/contracts"),
    resolve(candidateRoot, "packages/contracts"),
    {
      recursive: true,
    },
  );
  await writeFile(
    resolve(candidateRoot, "packages/contracts/package.json"),
    '{"candidatePackage":true}',
    "utf8",
  );
  const files: Array<Readonly<Record<string, unknown>>> = [];
  for (const entry of await readdir(candidateRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    const value = await readFile(path);
    files.push(
      Object.freeze({
        byteLength: String(value.byteLength),
        executable: false,
        path: path.slice(candidateRoot.length + 1).replaceAll("\\", "/"),
        sha256Digest: createHash("sha256").update(value).digest("hex"),
      }),
    );
  }
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))),
  );
  return {
    root: candidateRoot,
    subject: Object.freeze({
      files: Object.freeze(files),
      schemaVersion: "conformance-candidate-subject/v1",
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

describe("ISS-002 external execution workspace", () => {
  test("combines stable tests with authenticated candidate source and removes both temporary roots", async () => {
    const source = await candidate();
    const executionParent = await root("orchestration-workspace-execution-");
    const materializationParent = await root("orchestration-workspace-materialization-");
    let workspaceRoot = "";
    let preparation: Awaited<ReturnType<typeof prepareIss002WorkspaceDependencies>> | undefined;
    let execution: Awaited<ReturnType<typeof executeIss002ContractSelection>> | undefined;
    const result = await withIss002ExecutionWorkspace({
      candidateSourceRoot: source.root,
      candidateSubject: source.subject,
      executionParent,
      materializationParent,
      stableRoot,
      async consume(workspace) {
        workspaceRoot = workspace;
        expect(await readdir(materializationParent)).toEqual([]);
        expect(await readFile(resolve(workspace, "packages/contracts/src/index.ts"), "utf8")).toBe(
          await readFile(resolve(source.root, "packages/contracts/src/index.ts"), "utf8"),
        );
        expect(
          await readFile(resolve(workspace, "packages/contracts/package.json"), "utf8"),
        ).not.toContain("candidatePackage");
        expect(
          await readFile(resolve(workspace, "test/contracts/authority.test.ts"), "utf8"),
        ).toContain('from "vitest"');
        preparation = await prepareIss002WorkspaceDependencies(stableRoot, workspace);
        if (!preparation.ok) return "preparation-refused";
        execution = await executeIss002ContractSelection(
          workspace,
          iss002StableVectorSelections[0]!,
        );
        return "prepared";
      },
    });
    expect(preparation).toEqual({ ok: true });
    expect(execution?.normalizedResult).toBe("PASS");
    expect(execution?.stdoutBytes.byteLength).toBeGreaterThan(0);
    expect(result).toEqual({ ok: true, value: "prepared" });
    await expect(readFile(resolve(workspaceRoot, "package.json"))).rejects.toThrow();
    expect(await readdir(executionParent)).toEqual([]);
    expect(await readdir(materializationParent)).toEqual([]);
  }, 600_000);

  test("refuses a changed subject without invoking the consumer or leaving a workspace", async () => {
    const source = await candidate();
    const executionParent = await root("orchestration-workspace-refusal-");
    const materializationParent = await root("orchestration-workspace-refusal-materialization-");
    let calls = 0;
    const result = await withIss002ExecutionWorkspace({
      candidateSourceRoot: source.root,
      candidateSubject: { ...source.subject, files: [] },
      executionParent,
      materializationParent,
      stableRoot,
      async consume() {
        calls += 1;
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
    expect(await readdir(executionParent)).toEqual([]);
    expect(await readdir(materializationParent)).toEqual([]);
  });

  test("removes the workspace when its stable consumer fails", async () => {
    const source = await candidate();
    const executionParent = await root("orchestration-workspace-consumer-failure-");
    const result = await withIss002ExecutionWorkspace({
      candidateSourceRoot: source.root,
      candidateSubject: source.subject,
      executionParent,
      materializationParent: await root("orchestration-workspace-consumer-materialization-"),
      stableRoot,
      async consume() {
        throw new Error("injected stable consumer failure");
      },
    });
    expect(result).toEqual({ issues: ["workspace:consumer-failed"], ok: false });
    expect(await readdir(executionParent)).toEqual([]);
  }, 30_000);
});

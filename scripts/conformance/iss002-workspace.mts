import type { BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ContractRecord } from "../../packages/contracts/src/index.js";
import { consumeConformanceCandidateMaterialization } from "../../packages/conformance/src/candidate-materialization.js";
import { iss002TestBundlePaths } from "../../packages/conformance/src/iss002-bundle-paths.mjs";
import { readConformanceBundleFile } from "../../packages/conformance/src/manifest.js";

export type Iss002ExecutionWorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export type Iss002ExecutionWorkspaceConsumer<T> = (workspaceRoot: string) => Promise<T>;

const stableWorkspacePaths = Object.freeze([
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
  "packages/conformance/src/iss002-vector-generator.mjs",
  ...iss002TestBundlePaths.filter((path) => path.startsWith("test/contracts/")),
]);

function refusal<T>(...issues: readonly string[]): Iss002ExecutionWorkspaceResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function sameDirectory(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function writeStableFile(stableRoot: string, workspaceRoot: string, path: string) {
  const source = await readConformanceBundleFile(stableRoot, path);
  const destination = resolve(workspaceRoot, ...path.split("/"));
  if (!within(workspaceRoot, destination) || destination === workspaceRoot)
    throw new TypeError("workspace:stable-path-refused");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, source.bytes, { flag: "wx", mode: 0o644 });
}

async function writeCandidateSources(
  materializedRoot: string,
  workspaceRoot: string,
  candidateSubject: unknown,
): Promise<void> {
  const files = (candidateSubject as ContractRecord).files as readonly ContractRecord[];
  const sourcePaths = files
    .map((row) => String(row.path))
    .filter((path) => path.startsWith("packages/contracts/src/"));
  if (!sourcePaths.includes("packages/contracts/src/index.ts"))
    throw new TypeError("workspace:candidate-entrypoint-missing");
  for (const path of sourcePaths) {
    const source = await readConformanceBundleFile(materializedRoot, path);
    const destination = resolve(workspaceRoot, ...path.split("/"));
    if (!within(workspaceRoot, destination) || destination === workspaceRoot)
      throw new TypeError("workspace:candidate-path-refused");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source.bytes, { flag: "wx", mode: 0o644 });
  }
}

export async function withIss002ExecutionWorkspace<T>(input: {
  readonly candidateSourceRoot: string;
  readonly candidateSubject: unknown;
  readonly executionParent: string;
  readonly materializationParent: string;
  readonly stableRoot: string;
  readonly consume: Iss002ExecutionWorkspaceConsumer<T>;
}): Promise<Iss002ExecutionWorkspaceResult<T>> {
  let workspaceRoot: string | undefined;
  let workspaceIdentity: BigIntStats | undefined;
  let result: Iss002ExecutionWorkspaceResult<T> = refusal("workspace:preparation-refused");
  try {
    if (
      ![
        input.candidateSourceRoot,
        input.executionParent,
        input.materializationParent,
        input.stableRoot,
      ].every((path) => typeof path === "string" && isAbsolute(path)) ||
      typeof input.consume !== "function"
    )
      return refusal("workspace:input-refused");
    const roots = await Promise.all(
      [
        input.candidateSourceRoot,
        input.executionParent,
        input.materializationParent,
        input.stableRoot,
      ].map(async (path) => {
        const identity = await lstat(path);
        const real = await realpath(path);
        if (!identity.isDirectory() || identity.isSymbolicLink())
          throw new TypeError("workspace:regular-root-required");
        return real;
      }),
    );
    for (let left = 0; left < roots.length; left += 1)
      for (let right = left + 1; right < roots.length; right += 1)
        if (within(roots[left]!, roots[right]!) || within(roots[right]!, roots[left]!))
          return refusal("workspace:separate-roots-required");
    workspaceRoot = await mkdtemp(resolve(roots[1]!, "orchestration-iss002-workspace-"));
    workspaceIdentity = await lstat(workspaceRoot, { bigint: true });
    if (!workspaceIdentity.isDirectory() || workspaceIdentity.isSymbolicLink())
      throw new TypeError("workspace:root-refused");
    for (const path of stableWorkspacePaths) await writeStableFile(roots[3]!, workspaceRoot, path);
    const materialized = await consumeConformanceCandidateMaterialization(
      roots[0]!,
      roots[2]!,
      input.candidateSubject,
      async (root) => await writeCandidateSources(root, workspaceRoot!, input.candidateSubject),
    );
    if (!materialized.ok) result = refusal("workspace:candidate-materialization-refused");
    else {
      try {
        result = { ok: true, value: await input.consume(workspaceRoot) };
      } catch {
        result = refusal("workspace:consumer-failed");
      }
    }
  } catch {
    result = refusal("workspace:preparation-refused");
  }
  if (workspaceRoot)
    try {
      const current = await lstat(workspaceRoot, { bigint: true });
      if (
        !workspaceIdentity ||
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameDirectory(workspaceIdentity, current)
      )
        return refusal("workspace:cleanup-ancestor-refused");
      await rm(workspaceRoot, { recursive: true });
    } catch {
      return refusal("workspace:cleanup-refused");
    }
  return result;
}

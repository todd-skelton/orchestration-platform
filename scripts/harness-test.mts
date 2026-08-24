import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type * as WalkModule from "../packages/conformance/src/walk.js";
import type { Iss002WalkResult } from "../packages/conformance/src/walk.js";
import type * as StableBundleModule from "../packages/conformance/src/iss002-bundle-paths.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const advisoryMarker = "ADVISORY CONFORMANCE RESULT\n";

interface ContractExecutionResult {
  readonly ok: boolean;
  readonly stderr: string;
  readonly stdout: string;
}

interface LocalHarnessDependencies {
  readonly executeContracts?: () => Promise<ContractExecutionResult>;
  readonly executeWalk?: () => Promise<Iss002WalkResult>;
  readonly writeStderr?: (value: string) => unknown;
  readonly writeStdout?: (value: string) => unknown;
}

interface ContractProcess {
  (
    executable: string,
    arguments_: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly stderr: string; readonly stdout: string }>;
}

interface WalkExecutionDependencies {
  readonly copyTree?: typeof cp;
  readonly loadWalk?: () => Promise<typeof WalkModule>;
  readonly makeDirectory?: typeof mkdir;
  readonly makeTemporaryRoot?: (prefix: string) => Promise<string>;
  readonly removeTree?: typeof rm;
  readonly temporaryParent?: string;
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

async function defaultContractProcess(
  executable: string,
  arguments_: readonly string[],
  options: Readonly<Record<string, unknown>>,
) {
  return await execFileAsync(executable, [...arguments_], options);
}

export async function runStableContractTests(
  executeFile: ContractProcess = defaultContractProcess,
): Promise<ContractExecutionResult> {
  try {
    const stableBundles = (await import(
      new URL("../packages/conformance/src/iss002-bundle-paths.mts", import.meta.url).href
    )) as typeof StableBundleModule;
    const testPaths = stableBundles.iss002TestBundlePaths.filter((path) =>
      path.startsWith("test/contracts/"),
    );
    const result = await executeFile(
      process.execPath,
      [
        resolve(repositoryRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        ...testPaths,
        "--testTimeout=600000",
        "--hookTimeout=600000",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 900_000,
        windowsHide: true,
      },
    );
    return { ok: true, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as {
      readonly message?: unknown;
      readonly stderr?: unknown;
      readonly stdout?: unknown;
    };
    return {
      ok: false,
      stderr: String(failure.stderr ?? failure.message ?? error),
      stdout: String(failure.stdout ?? ""),
    };
  }
}

export async function runLocalWalk({
  copyTree = cp,
  loadWalk = async () =>
    (await import(
      new URL("../packages/conformance/src/walk.ts", import.meta.url).href
    )) as typeof WalkModule,
  makeDirectory = mkdir,
  makeTemporaryRoot = async (prefix) => await mkdtemp(prefix),
  removeTree = rm,
  temporaryParent = tmpdir(),
}: WalkExecutionDependencies = {}): Promise<Iss002WalkResult> {
  let candidateRoot: string | undefined;
  let executionParent: string | undefined;
  try {
    const [temporaryParentIdentity, realTemporaryParent, realRepositoryRoot] = await Promise.all([
      lstat(temporaryParent),
      realpath(temporaryParent),
      realpath(repositoryRoot),
    ]);
    if (
      !temporaryParentIdentity.isDirectory() ||
      temporaryParentIdentity.isSymbolicLink() ||
      within(realRepositoryRoot, realTemporaryParent) ||
      within(realTemporaryParent, realRepositoryRoot)
    )
      throw new TypeError("local harness temporary parent must be external");
    const walkModule = await loadWalk();
    candidateRoot = await makeTemporaryRoot(
      resolve(realTemporaryParent, "orchestration-local-candidate-"),
    );
    executionParent = await makeTemporaryRoot(
      resolve(realTemporaryParent, "orchestration-local-execution-"),
    );
    await makeDirectory(resolve(candidateRoot, "packages"));
    await copyTree(
      resolve(repositoryRoot, "packages/contracts"),
      resolve(candidateRoot, "packages/contracts"),
      { recursive: true },
    );
    return await walkModule.runIss002CrossRootWalk({
      candidateRoot,
      executionParent,
      stableRoot: repositoryRoot,
    });
  } finally {
    const cleanup = await Promise.allSettled(
      [candidateRoot, executionParent]
        .filter((path): path is string => path !== undefined)
        .map((path) => removeTree(path, { force: true, recursive: true })),
    );
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error("local harness temporary-root cleanup refused");
  }
}

export async function runLocalHarness({
  executeContracts = runStableContractTests,
  executeWalk = runLocalWalk,
  writeStderr = (value) => process.stderr.write(value),
  writeStdout = (value) => process.stdout.write(value),
}: LocalHarnessDependencies = {}): Promise<0 | 1> {
  writeStdout(advisoryMarker);
  let contracts: ContractExecutionResult;
  try {
    contracts = await executeContracts();
  } catch (error) {
    contracts = { ok: false, stderr: String(error), stdout: "" };
  }
  if (contracts.stdout) writeStdout(contracts.stdout);
  if (contracts.stderr) writeStderr(contracts.stderr);
  let walk: Iss002WalkResult;
  try {
    walk = await executeWalk();
  } catch (error) {
    walk = { issues: [String(error)], ok: false };
  }
  const ok = contracts.ok === true && walk.ok === true;
  writeStdout(
    `${JSON.stringify({
      advisory: true,
      contracts: contracts.ok === true ? "PASS" : "FAIL",
      maximumWalkDurationNanoseconds: walk.ok ? walk.maximumWalkDurationNanoseconds : null,
      walk: walk.ok === true ? "PASS" : "FAIL",
    })}\n`,
  );
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runLocalHarness();

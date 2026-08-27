import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import {
  iss002StableVectorSelections,
  type Iss002StableExecutionResult,
  type Iss002StableVectorSelection,
} from "../../packages/conformance/src/index.js";

const execFileAsync = promisify(execFile);

export interface Iss002ProcessOptions {
  readonly cwd: string;
  readonly encoding: "buffer";
  readonly env: NodeJS.ProcessEnv;
  readonly maxBuffer: number;
  readonly timeout: number;
  readonly windowsHide: true;
}

export type Iss002Process = (
  executable: string,
  arguments_: readonly string[],
  options: Iss002ProcessOptions,
) => Promise<Readonly<{ stderr: Uint8Array; stdout: Uint8Array }>>;

export type Iss002PreparationResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

async function defaultProcess(
  executable: string,
  arguments_: readonly string[],
  options: Iss002ProcessOptions,
): Promise<Readonly<{ stderr: Uint8Array; stdout: Uint8Array }>> {
  const result = (await execFileAsync(executable, [...arguments_], options)) as unknown as {
    readonly stderr: Uint8Array;
    readonly stdout: Uint8Array;
  };
  return Object.freeze({
    stderr: Uint8Array.from(result.stderr),
    stdout: Uint8Array.from(result.stdout),
  });
}

function refusal(...issues: readonly string[]): Iss002PreparationResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function environment(workspaceRoot: string, includeToolchainPaths: boolean): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const ambient = includeToolchainPaths
    ? [
        "APPDATA",
        "COREPACK_HOME",
        "HOME",
        "LOCALAPPDATA",
        "PATH",
        "PNPM_HOME",
        "SystemRoot",
        "USERPROFILE",
        "WINDIR",
      ]
    : ["SystemRoot", "WINDIR"];
  for (const key of ambient) if (process.env[key]) value[key] = process.env[key];
  value.TEMP = workspaceRoot;
  value.TMP = workspaceRoot;
  value.TMPDIR = workspaceRoot;
  value.LANG = "C";
  value.LC_ALL = "C";
  value.TZ = "UTC";
  return value;
}

function packageManagerInvocation(command: string):
  | {
      readonly arguments_: readonly string[];
      readonly executable: string;
    }
  | undefined {
  if (process.platform !== "win32") return { arguments_: command.split(" "), executable: "pnpm" };
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  return windowsRoot
    ? {
        arguments_: ["/d", "/s", "/c", `pnpm ${command}`],
        executable: resolve(windowsRoot, "System32/cmd.exe"),
      }
    : undefined;
}

function storePath(stdout: Uint8Array): string | undefined {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(stdout).trim();
    return value.length > 0 && !/[\r\n]/.test(value) && isAbsolute(value)
      ? resolve(value)
      : undefined;
  } catch {
    return undefined;
  }
}

async function regularWorkspace(workspaceRoot: string): Promise<boolean> {
  if (!isAbsolute(workspaceRoot)) return false;
  try {
    const identity = await lstat(workspaceRoot);
    return identity.isDirectory() && !identity.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function prepareIss002WorkspaceDependencies(
  stableRoot: string,
  workspaceRoot: string,
  execute: Iss002Process = defaultProcess,
): Promise<Iss002PreparationResult> {
  if (!(await regularWorkspace(stableRoot)) || !(await regularWorkspace(workspaceRoot)))
    return refusal("executor:workspace-refused");
  try {
    const query = packageManagerInvocation("store path --silent");
    const install = packageManagerInvocation(
      "install --offline --frozen-lockfile --ignore-scripts",
    );
    if (!(query && install)) return refusal("executor:package-manager-refused");
    const queried = await execute(query.executable, query.arguments_, {
      cwd: stableRoot,
      encoding: "buffer",
      env: environment(stableRoot, true),
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    });
    const exactStorePath = storePath(queried.stdout);
    if (!exactStorePath) return refusal("executor:store-path-refused");
    const installEnvironment = environment(workspaceRoot, true);
    installEnvironment.npm_config_store_dir = exactStorePath;
    await execute(install.executable, install.arguments_, {
      cwd: workspaceRoot,
      encoding: "buffer",
      env: installEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
      windowsHide: true,
    });
    return { ok: true };
  } catch {
    return refusal("executor:frozen-install-failed");
  }
}

function exactSelection(
  input: Iss002StableVectorSelection,
): Iss002StableVectorSelection | undefined {
  const expected = iss002StableVectorSelections.find(
    (selection) => selection.fixtureId === input.fixtureId,
  );
  if (
    !expected ||
    expected.fixtureId === "walk-1000-records" ||
    !Array.isArray(input.testFiles) ||
    input.testFiles.length !== expected.testFiles.length ||
    input.testFiles.some((path, index) => path !== expected.testFiles[index])
  )
    return undefined;
  return expected;
}

export async function executeIss002ContractSelection(
  workspaceRoot: string,
  selectionInput: Iss002StableVectorSelection,
  execute: Iss002Process = defaultProcess,
): Promise<Iss002StableExecutionResult> {
  const selection = exactSelection(selectionInput);
  if (!(selection && (await regularWorkspace(workspaceRoot))))
    return Object.freeze({
      normalizedResult: "FAIL" as const,
      stderrBytes: new Uint8Array(),
      stdoutBytes: new Uint8Array(),
      walkDurationsNanoseconds: null,
    });
  try {
    const result = await execute(
      process.execPath,
      [
        resolve(workspaceRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        ...selection.testFiles,
        "--testTimeout=600000",
        "--hookTimeout=600000",
      ],
      {
        cwd: workspaceRoot,
        encoding: "buffer",
        env: environment(workspaceRoot, false),
        maxBuffer: 64 * 1024 * 1024,
        timeout: 900_000,
        windowsHide: true,
      },
    );
    return Object.freeze({
      normalizedResult: "PASS" as const,
      stderrBytes: Uint8Array.from(result.stderr),
      stdoutBytes: Uint8Array.from(result.stdout),
      walkDurationsNanoseconds: null,
    });
  } catch (error) {
    const output = error as { readonly stderr?: unknown; readonly stdout?: unknown };
    return Object.freeze({
      normalizedResult: "FAIL" as const,
      stderrBytes:
        output.stderr instanceof Uint8Array ? Uint8Array.from(output.stderr) : new Uint8Array(),
      stdoutBytes:
        output.stdout instanceof Uint8Array ? Uint8Array.from(output.stdout) : new Uint8Array(),
      walkDurationsNanoseconds: null,
    });
  }
}

import { execFile } from "node:child_process";
import { copyFile, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, types as nodeTypes } from "node:util";
import { build, type Plugin } from "esbuild";

const execFileAsync = promisify(execFile);

export interface Iss002WalkInput {
  readonly candidateModuleUrl: string;
  readonly childScriptPath: string;
  readonly stableModuleUrl: string;
  readonly workingDirectory: string;
}

export interface Iss002CrossRootWalkInput {
  readonly candidateRoot: string;
  readonly executionParent: string;
  readonly stableRoot: string;
}

export type Iss002WalkResult =
  | {
      readonly ok: true;
      readonly durationsNanoseconds: readonly string[];
      readonly maximumWalkDurationNanoseconds: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): Iss002WalkResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function detachedWalkInput(input: unknown): Iss002WalkInput | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = [
    "candidateModuleUrl",
    "childScriptPath",
    "stableModuleUrl",
    "workingDirectory",
  ] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const values: Record<(typeof fields)[number], string> = Object.create(null) as Record<
    (typeof fields)[number],
    string
  >;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    )
      return undefined;
    values[field] = descriptor.value;
  }
  return Object.freeze({ ...values });
}

function detachedCrossRootInput(input: unknown): Iss002CrossRootWalkInput | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["candidateRoot", "executionParent", "stableRoot"] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const values: Record<(typeof fields)[number], string> = Object.create(null) as Record<
    (typeof fields)[number],
    string
  >;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    )
      return undefined;
    values[field] = descriptor.value;
  }
  return Object.freeze({ ...values });
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

const dynamicDependencyPattern =
  /(?:\b(?:import|require)\s*\(|\b(?:createRequire|getBuiltinModule)\b)/;

function confinedContractPlugin(packageRoot: string, realPackageRoot: string): Plugin {
  return {
    name: "confined-contract-source",
    setup(context) {
      context.onResolve({ filter: /.*/ }, (arguments_) => {
        if (arguments_.kind === "entry-point") return undefined;
        if (["node:crypto", "node:util"].includes(arguments_.path))
          return { external: true, path: arguments_.path };
        if (!arguments_.path.startsWith("."))
          return { errors: [{ text: "contract import is outside the closed dependency census" }] };
        const requested = resolve(arguments_.resolveDir, arguments_.path);
        return within(packageRoot, requested)
          ? undefined
          : { errors: [{ text: "contract import escapes its candidate package root" }] };
      });
      context.onLoad({ filter: /.*/ }, async (arguments_) => {
        const identity = await lstat(arguments_.path);
        const real = await realpath(arguments_.path);
        const expectedReal = resolve(
          realPackageRoot,
          relative(packageRoot, resolve(arguments_.path)),
        );
        if (
          !identity.isFile() ||
          identity.isSymbolicLink() ||
          !within(realPackageRoot, real) ||
          relative(expectedReal, real) !== ""
        )
          return { errors: [{ text: "contract source is not a confined regular file" }] };
        return dynamicDependencyPattern.test(await readFile(arguments_.path, "utf8"))
          ? { errors: [{ text: "contract source contains a dynamic dependency" }] }
          : undefined;
      });
    },
  };
}

async function bundleContracts(root: string, output: string): Promise<void> {
  const packageRoot = resolve(root, "packages/contracts");
  const packageIdentity = await lstat(packageRoot);
  const realPackageRoot = await realpath(packageRoot);
  const realRoot = await realpath(root);
  if (
    !packageIdentity.isDirectory() ||
    packageIdentity.isSymbolicLink() ||
    !within(realRoot, realPackageRoot)
  )
    throw new TypeError("contract-package-root:refused");
  await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [resolve(packageRoot, "src/index.ts")],
    external: [],
    format: "esm",
    logLevel: "silent",
    minify: false,
    outfile: output,
    platform: "node",
    plugins: [confinedContractPlugin(packageRoot, realPackageRoot)],
    sourcemap: false,
    target: "node24",
    treeShaking: false,
  });
  const bundledSource = await readFile(output, "utf8");
  if (dynamicDependencyPattern.test(bundledSource))
    throw new TypeError("contract-dynamic-dependency:refused");
}

function childEnvironment(workingDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of ["SystemRoot", "WINDIR"])
    if (process.env[key]) environment[key] = process.env[key];
  environment.TEMP = workingDirectory;
  environment.TMP = workingDirectory;
  environment.TMPDIR = workingDirectory;
  environment.LANG = "C";
  environment.LC_ALL = "C";
  environment.TZ = "UTC";
  return environment;
}

function environmentScrubber(environment: NodeJS.ProcessEnv): string {
  const expected = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const source = `const expected=${JSON.stringify(expected)};
for (const key of Object.keys(process.env)) delete process.env[key];
for (const [key,value] of Object.entries(expected)) process.env[key]=value;
`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function parseChildOutput(
  stdout: string,
  stderr: string,
  index: number,
):
  | { readonly ok: true; readonly duration: string }
  | { readonly ok: false; readonly issues: readonly string[] } {
  if (stderr !== "") return { ok: false, issues: [`walk.${index}:stderr-nonempty`] };
  let input: unknown;
  try {
    input = JSON.parse(stdout);
  } catch {
    return { ok: false, issues: [`walk.${index}:json-refused`] };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return { ok: false, issues: [`walk.${index}:record-required`] };
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "durationNanoseconds\0issues\0recordCount")
    return { ok: false, issues: [`walk.${index}:field-census-refused`] };
  if (
    record.recordCount !== "1000" ||
    typeof record.durationNanoseconds !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(record.durationNanoseconds) ||
    !Number.isSafeInteger(Number(record.durationNanoseconds)) ||
    !Array.isArray(record.issues) ||
    record.issues.length !== 0
  )
    return { ok: false, issues: [`walk.${index}:result-refused`] };
  if (BigInt(record.durationNanoseconds) > 5_000_000_000n)
    return { ok: false, issues: [`walk.${index}:duration-limit-exceeded`] };
  return { ok: true, duration: record.durationNanoseconds };
}

export async function runIss002WalkIntervals(input: Iss002WalkInput): Promise<Iss002WalkResult> {
  const detached = detachedWalkInput(input);
  if (!detached) return refusal("walk:input-refused");
  if (!isAbsolute(detached.workingDirectory)) return refusal("workingDirectory:absolute-required");
  const durations: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    try {
      const environment = childEnvironment(detached.workingDirectory);
      const result = await execFileAsync(
        process.execPath,
        [
          `--import=${environmentScrubber(environment)}`,
          detached.childScriptPath,
          detached.stableModuleUrl,
          detached.candidateModuleUrl,
        ],
        {
          cwd: detached.workingDirectory,
          encoding: "utf8",
          env: environment,
          maxBuffer: 1024 * 1024,
          timeout: 15_000,
          windowsHide: true,
        },
      );
      const parsed = parseChildOutput(result.stdout, result.stderr, index);
      if (!parsed.ok) return refusal(...parsed.issues);
      durations.push(parsed.duration);
    } catch {
      return refusal(`walk.${index}:child-failed`);
    }
  }
  return {
    ok: true,
    durationsNanoseconds: Object.freeze(durations),
    maximumWalkDurationNanoseconds: durations.reduce((maximum, value) =>
      BigInt(value) > BigInt(maximum) ? value : maximum,
    ),
  };
}

export async function runIss002CrossRootWalk(
  input: Iss002CrossRootWalkInput,
): Promise<Iss002WalkResult> {
  const detached = detachedCrossRootInput(input);
  if (!detached) return refusal("walk:cross-root-input-refused");
  const stableRoot = resolve(detached.stableRoot);
  const candidateRoot = resolve(detached.candidateRoot);
  const executionParent = resolve(detached.executionParent);
  let executionRoot: string | undefined;
  let result: Iss002WalkResult = refusal("walk:cross-root-build-refused");
  try {
    const [
      stableIdentity,
      candidateIdentity,
      executionParentIdentity,
      realStableRoot,
      realCandidateRoot,
      realExecutionParent,
    ] = await Promise.all([
      lstat(stableRoot),
      lstat(candidateRoot),
      lstat(executionParent),
      realpath(stableRoot),
      realpath(candidateRoot),
      realpath(executionParent),
    ]);
    if (
      !stableIdentity.isDirectory() ||
      stableIdentity.isSymbolicLink() ||
      !candidateIdentity.isDirectory() ||
      candidateIdentity.isSymbolicLink() ||
      !executionParentIdentity.isDirectory() ||
      executionParentIdentity.isSymbolicLink() ||
      within(realStableRoot, realCandidateRoot) ||
      within(realCandidateRoot, realStableRoot) ||
      within(realStableRoot, realExecutionParent) ||
      within(realCandidateRoot, realExecutionParent) ||
      within(realExecutionParent, realStableRoot) ||
      within(realExecutionParent, realCandidateRoot)
    )
      result = refusal("walk:separate-regular-roots-required");
    else {
      executionRoot = await mkdtemp(resolve(executionParent, "orchestration-iss002-execution-"));
      const realExecutionRoot = await realpath(executionRoot);
      if (
        within(realStableRoot, realExecutionRoot) ||
        within(realCandidateRoot, realExecutionRoot) ||
        within(realExecutionRoot, realStableRoot) ||
        within(realExecutionRoot, realCandidateRoot)
      )
        result = refusal("walk:external-execution-root-required");
      else {
        const stableModule = resolve(executionRoot, "stable-contracts.mjs");
        const candidateModule = resolve(executionRoot, "candidate-contracts.mjs");
        const childScript = resolve(executionRoot, "iss002-walk-child.mjs");
        await bundleContracts(stableRoot, stableModule);
        await bundleContracts(candidateRoot, candidateModule);
        const childSource = resolve(stableRoot, "packages/conformance/src/iss002-walk-child.mjs");
        const [childIdentity, realChildSource] = await Promise.all([
          lstat(childSource),
          realpath(childSource),
        ]);
        const expectedChildSource = resolve(
          realStableRoot,
          "packages/conformance/src/iss002-walk-child.mjs",
        );
        if (
          !childIdentity.isFile() ||
          childIdentity.isSymbolicLink() ||
          relative(expectedChildSource, realChildSource) !== ""
        )
          throw new TypeError("walk-child-source:refused");
        await copyFile(childSource, childScript);
        result = await runIss002WalkIntervals({
          candidateModuleUrl: pathToFileURL(candidateModule).href,
          childScriptPath: childScript,
          stableModuleUrl: pathToFileURL(stableModule).href,
          workingDirectory: executionRoot,
        });
      }
    }
  } catch {
    result = refusal("walk:cross-root-build-refused");
  }
  if (executionRoot)
    try {
      await rm(executionRoot, { force: true, recursive: true });
    } catch {
      return refusal("walk:execution-root-cleanup-refused");
    }
  return result;
}

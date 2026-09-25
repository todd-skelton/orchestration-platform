import { execFile, spawn } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolvePnpmLauncher } from "../pnpm-launcher.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const singletons = {
  refresh: "test/dogfood/refresh.test.ts",
  queue: "test/dogfood/queue.test.ts",
};

export function parseShard(args) {
  if (args.length === 0) return undefined;
  if (
    args.length !== 2 ||
    args[0] !== "--windows-shard" ||
    !["refresh", "queue", "remainder"].includes(args[1])
  )
    throw new Error("expected no arguments or --windows-shard refresh|queue|remainder");
  return args[1];
}

export function partition(files) {
  for (const file of Object.values(singletons)) {
    if (!files.includes(file)) throw new Error(`missing singleton: ${file}`);
  }
  return {
    refresh: [singletons.refresh],
    queue: [singletons.queue],
    remainder: files.filter((file) => !Object.values(singletons).includes(file)),
  };
}

export function validatePartition(full, shards) {
  const seen = new Set();
  for (const files of Object.values(shards)) {
    if (files.length === 0) throw new Error("empty shard selection");
    for (const file of files) {
      if (seen.has(file)) throw new Error(`overlapping shard selection: ${file}`);
      seen.add(file);
    }
  }
  if (seen.size !== full.length || full.some((file) => !seen.has(file)))
    throw new Error("shard union differs from full discovery");
}

export function validateSelection(expected, actual) {
  if (actual.length !== expected.length || actual.some((file) => !expected.includes(file)))
    throw new Error("Vitest filters differ from exact shard selection");
}

// Gates inherit stdio: progress survives job cancellation, rather than waiting
// for execFile's completion buffer.
export function run(executable, args, { cwd = repositoryRoot } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`${executable} exited ${code ?? signal}`));
    });
  });
}

export async function discover(filters = [], cwd = repositoryRoot) {
  // The same globTestSpecifications operation used by `vitest list --filesOnly`.
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", { root: cwd, watch: false });
  try {
    return (await vitest.globTestSpecifications(filters)).map((spec) =>
      relative(cwd, spec.moduleId).replaceAll("\\", "/"),
    );
  } finally {
    await vitest.close();
  }
}

async function status() {
  const result = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  return result.stdout;
}

export async function bootstrap(
  args,
  { execute = run, sourceStatus = status, list = discover, launcher } = {},
) {
  const shard = parseShard(args);
  const pnpm = launcher ?? (await resolvePnpmLauncher());
  const before = await sourceStatus();
  try {
    for (const script of ["format:check", "typecheck", "test", "planning:check"]) {
      let testArgs = [];
      if (script === "test" && shard) {
        const full = await list();
        const shards = partition(full);
        validatePartition(full, shards);
        testArgs = shards[shard];
        validateSelection(testArgs, await list(testArgs));
        console.log(`Windows shard ${shard}: ${JSON.stringify(testArgs)}`);
        // Complete per-test identities, outcomes and timings also survive as an artifact.
        if (process.env.RUNNER_TEMP)
          testArgs = [
            ...testArgs,
            "--reporter=default",
            "--reporter=json",
            `--outputFile=${resolve(process.env.RUNNER_TEMP, `bootstrap-${shard}.json`)}`,
          ];
      }
      await execute(pnpm.executable, [...pnpm.prefixArgs, "run", script, ...testArgs]);
    }
  } finally {
    if ((await sourceStatus()) !== before)
      throw new Error("verification changed tracked or untracked source status");
  }
  console.log("format, typecheck, tests and planning verified without source-tree status changes");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await bootstrap(process.argv.slice(2));

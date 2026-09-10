import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolvePnpmLauncher } from "../pnpm-launcher.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function status() {
  const result = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  return result.stdout;
}

async function run(executable, args) {
  const result = await execFileAsync(executable, args, {
    cwd: repositoryRoot,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  }).catch(async (error) => {
    // Drain captured output before Node renders (and may shorten) the original error.
    if (error.stdout) await new Promise((done) => process.stdout.write(error.stdout, done));
    if (error.stderr) await new Promise((done) => process.stderr.write(error.stderr, done));
    throw error;
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (process.argv.length !== 2) throw new Error("verify:bootstrap accepts no arguments");
const pnpmLauncher = await resolvePnpmLauncher();

const before = await status();
for (const script of ["format:check", "typecheck", "test", "planning:check"]) {
  await run(pnpmLauncher.executable, [...pnpmLauncher.prefixArgs, "run", script]);
}
const after = await status();
if (after !== before) {
  throw new Error("verification changed tracked or untracked source status");
}
process.stdout.write(
  "format, typecheck, tests and planning verified without source-tree status changes\n",
);

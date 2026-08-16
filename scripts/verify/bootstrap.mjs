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
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (process.argv.length !== 2) throw new Error("verify:bootstrap accepts no arguments");
const pnpmLauncher = await resolvePnpmLauncher();

const before = await status();
await run(process.execPath, [resolve(repositoryRoot, "scripts/verify/bootstrap-contracts.mjs")]);
for (const script of ["format:check", "typecheck", "test", "build", "planning:check"]) {
  await run(pnpmLauncher.executable, [...pnpmLauncher.prefixArgs, "run", script]);
}
const after = await status();
if (after !== before) {
  throw new Error("bootstrap verification changed tracked or untracked source status");
}
process.stdout.write("complete bootstrap suite verified without source-tree status changes\n");

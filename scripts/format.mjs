import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getFileInfo } from "prettier";
import { normalizeTrackedText } from "./tracked-text.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../..");
const ignorePaths = [
  resolve(repositoryRoot, ".gitignore"),
  resolve(repositoryRoot, ".prettierignore"),
];

export const formatterTargets = Object.freeze([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
  ".prettierrc.json",
  ".github/workflows/bootstrap.yml",
  "scripts",
  "packages",
  "adapters",
  "fixtures",
  "bootstrap",
  "modules",
  "config",
  "test",
]);

async function collectFiles(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) return [];
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) return [];
  const files = [];
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) files.push(...(await collectFiles(resolve(path, entry.name))));
  }
  return files;
}

export async function validateFormatterInputs(paths, { ignorePath = ignorePaths } = {}) {
  for (const path of paths) {
    for (const file of await collectFiles(path)) {
      const fileInfo = await getFileInfo(file, { ignorePath });
      if (fileInfo.ignored || !fileInfo.inferredParser) continue;
      try {
        normalizeTrackedText(await readFile(file, "utf8"));
      } catch (error) {
        throw new Error(
          `formatter input ${relative(repositoryRoot, file)} has invalid line endings: ${error.message}`,
        );
      }
    }
  }
}

export async function runPinnedPrettier(mode, targets = formatterTargets) {
  return execFileAsync(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/prettier/bin/prettier.cjs"),
      "--config",
      resolve(repositoryRoot, ".prettierrc.json"),
      `--${mode}`,
      ...targets,
    ],
    { cwd: repositoryRoot, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  if ((mode !== "check" && mode !== "write") || process.argv.length !== 3) {
    throw new Error("format wrapper accepts exactly one mode: check or write");
  }
  const targets = formatterTargets.map((target) => resolve(repositoryRoot, target));
  await validateFormatterInputs(targets);
  const result = await runPinnedPrettier(mode);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

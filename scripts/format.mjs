import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeTrackedText } from "./tracked-text.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../..");
const supportedExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".ts",
  ".yaml",
  ".yml",
]);

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
  "bootstrap",
  "modules",
  "config",
  "test",
]);

async function collectFiles(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return supportedExtensions.has(extname(path)) ? [path] : [];
  if (!metadata.isDirectory()) return [];
  const files = [];
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) files.push(...(await collectFiles(resolve(path, entry.name))));
  return files;
}

export async function validateFormatterInputs(paths) {
  for (const path of paths) {
    for (const file of await collectFiles(path)) {
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

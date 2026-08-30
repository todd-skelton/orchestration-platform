import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const targets = Object.freeze({
  hosted: "hosted.mts",
  terminal: "hosted-terminal.mts",
});

const [target, ...arguments_] = process.argv.slice(2);
if (!target || !(target in targets)) throw new Error("CONFORMANCE_BUNDLE_TARGET_REFUSED");
if (
  (target === "hosted" && arguments_.length !== 1) ||
  (target === "terminal" &&
    arguments_.length !== 4 &&
    !(arguments_.length === 5 && arguments_[0] === "portable-primitives-decision"))
)
  throw new Error("CONFORMANCE_BUNDLE_ARGUMENTS_REFUSED");

const runnerTemp = process.env.RUNNER_TEMP;
const parent = runnerTemp && isAbsolute(runnerTemp) ? resolve(runnerTemp) : resolve(tmpdir());
const stableRequire = createRequire(resolve(process.cwd(), "package.json"));
const stableEsbuildUrl = pathToFileURL(stableRequire.resolve("esbuild")).href;
await mkdir(parent, { recursive: true });
const root = await mkdtemp(resolve(parent, "orchestration-conformance-bundle-"));
try {
  const output = resolve(root, "entry.mjs");
  const result = await build({
    absWorkingDir: process.cwd(),
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, targets[target as keyof typeof targets])],
    external: ["node:*"],
    format: "esm",
    logLevel: "silent",
    minify: false,
    packages: "bundle",
    platform: "node",
    plugins: [
      {
        name: "stable-esbuild-provider",
        setup(context) {
          context.onResolve({ filter: /^esbuild$/ }, () => ({
            external: true,
            path: stableEsbuildUrl,
          }));
        },
      },
    ],
    sourcemap: false,
    splitting: false,
    target: "node24",
    treeShaking: false,
    write: false,
  });
  if (result.outputFiles.length !== 1) throw new Error("CONFORMANCE_BUNDLE_CENSUS_REFUSED");
  await writeFile(output, result.outputFiles[0]!.contents, { flag: "wx" });
  const child = spawn(process.execPath, [output, ...arguments_], {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  const exitCode = await new Promise<number>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal || code === null) reject(new Error("CONFORMANCE_BUNDLE_CHILD_REFUSED"));
      else accept(code);
    });
  });
  process.exitCode = exitCode;
} finally {
  await rm(root, { recursive: true });
}

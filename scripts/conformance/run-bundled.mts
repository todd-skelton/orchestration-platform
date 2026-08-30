import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";

const targets = Object.freeze({
  hosted: "hosted.mts",
  terminal: "hosted-terminal.mts",
});

export async function buildConformanceBundle(entryPoint: string): Promise<Uint8Array> {
  const stableRequire = createRequire(resolve(process.cwd(), "package.json"));
  const stableEsbuildUrl = pathToFileURL(stableRequire.resolve("esbuild")).href;
  const sourceRelativeExecutors = new Set(
    ["executor.ts", "runtime-executor.ts"].map((name) =>
      resolve(import.meta.dirname, "../../probes/portable-primitives/src", name),
    ),
  );
  const result = await build({
    absWorkingDir: process.cwd(),
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    bundle: true,
    entryPoints: [entryPoint],
    external: ["node:*"],
    format: "esm",
    logLevel: "silent",
    minify: false,
    packages: "bundle",
    platform: "node",
    plugins: [
      {
        name: "stable-probe-source-urls",
        setup(context) {
          context.onLoad({ filter: /(?:^|[\\/])(?:runtime-)?executor\.ts$/ }, async ({ path }) => {
            if (!sourceRelativeExecutors.has(path)) return;
            // These two modules locate reviewed worker sources and the source-root
            // overlap guard. The temporary bundle is neither of those locations.
            const transformed = await transform(await readFile(path, "utf8"), {
              define: { "import.meta.url": JSON.stringify(pathToFileURL(path).href) },
              loader: "ts",
              target: "node24",
            });
            return { contents: transformed.code, loader: "js" };
          });
        },
      },
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
  return result.outputFiles[0]!.contents;
}

async function main(): Promise<void> {
  const [target, ...arguments_] = process.argv.slice(2);
  if (!target || !Object.hasOwn(targets, target))
    throw new Error("CONFORMANCE_BUNDLE_TARGET_REFUSED");
  if (
    (target === "hosted" && arguments_.length !== 1) ||
    (target === "terminal" &&
      arguments_.length !== 4 &&
      !(arguments_.length === 5 && arguments_[0] === "portable-primitives-decision"))
  )
    throw new Error("CONFORMANCE_BUNDLE_ARGUMENTS_REFUSED");

  const runnerTemp = process.env.RUNNER_TEMP;
  const parent = runnerTemp && isAbsolute(runnerTemp) ? resolve(runnerTemp) : resolve(tmpdir());
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "orchestration-conformance-bundle-"));
  try {
    const output = resolve(root, "entry.mjs");
    const bytes = await buildConformanceBundle(
      resolve(import.meta.dirname, targets[target as keyof typeof targets]),
    );
    await writeFile(output, bytes, { flag: "wx" });
    const child = spawn(process.execPath, [output, ...arguments_], {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    process.exitCode = await new Promise<number>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (signal || code === null) reject(new Error("CONFORMANCE_BUNDLE_CHILD_REFUSED"));
        else accept(code);
      });
    });
  } finally {
    await rm(root, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();

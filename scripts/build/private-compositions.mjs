import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configurationPath = resolve(repositoryRoot, "config/private-compositions.json");
const brokerCompositionPath = resolve(repositoryRoot, "packages/credentials/build/compose.ts");
const aliasTargets = new Set(["bootstrap", "self-host", "host-custody-bootstrap"]);

const expectedConfiguration = Object.freeze({
  schemaVersion: "private-compositions/v1",
  options: {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    splitting: false,
    sourcemap: false,
    minify: false,
    treeShaking: false,
    packages: "bundle",
    external: ["node:*"],
  },
  targets: [
    {
      id: "bootstrap",
      entryPoint: "bootstrap/build/composition.ts",
      output: "bootstrap/dist/orchestration-bootstrap.mjs",
    },
    {
      id: "self-host",
      entryPoint: "adapters/self/build/composition.ts",
      output: "adapters/self/dist/orchestration-self.mjs",
    },
    {
      id: "credential-broker",
      entryPoint: "bootstrap/build/broker-service-composition.ts",
      output: "packages/credentials/dist/orchestration-credential-broker.mjs",
    },
    {
      id: "host-custody-bootstrap",
      entryPoint: "packages/host-custody/build/composition.ts",
      output: "packages/host-custody/dist/orchestration-host-custody-bootstrap.mjs",
    },
    {
      id: "host-custody-broker",
      entryPoint: "packages/host-custody/build/broker-service-composition.ts",
      output: "packages/host-custody/dist/orchestration-host-custody-broker.mjs",
    },
  ],
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function assertInsideRepository(path, label) {
  const fromRoot = relative(repositoryRoot, path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    resolve(path) !== path
  ) {
    throw new Error(`${label} must be a normalized path below the repository root`);
  }
}

async function atomicWrite(path, bytes) {
  assertInsideRepository(path, "build output");
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function brokerComposeResolver(targetId) {
  return {
    name: "broker-compose-closed-resolver",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^#broker-compose$/ }, () => {
        if (!aliasTargets.has(targetId)) {
          return { errors: [{ text: `#broker-compose is forbidden for target ${targetId}` }] };
        }
        return { path: brokerCompositionPath };
      });
    },
  };
}

function removeSourcePathAnnotations(text) {
  return text
    .split("\n")
    .filter((line) => !/^\/\/ [a-zA-Z0-9_.@/-]+\.[cm]?[jt]sx?$/.test(line))
    .join("\n");
}

async function buildTarget(target, options) {
  if (target.id === "self-host") {
    await execFileAsync(
      process.execPath,
      [resolve(repositoryRoot, "modules/build/generate-registry.mjs")],
      {
        cwd: repositoryRoot,
        windowsHide: true,
      },
    );
  }

  const entryPoint = resolve(repositoryRoot, target.entryPoint);
  const output = resolve(repositoryRoot, target.output);
  assertInsideRepository(entryPoint, "entry point");
  assertInsideRepository(output, "output");

  const result = await build({
    ...options,
    absWorkingDir: repositoryRoot,
    entryPoints: [entryPoint],
    outfile: output,
    write: false,
    metafile: true,
    plugins: [brokerComposeResolver(target.id)],
    logLevel: "silent",
  });

  if (result.outputFiles.length !== 1 || Object.keys(result.metafile.outputs).length !== 1) {
    throw new Error(`target ${target.id} emitted an unexpected output census`);
  }
  const outputFile = result.outputFiles[0];
  if (!outputFile || resolve(outputFile.path) !== output) {
    throw new Error(`target ${target.id} emitted an unexpected output path`);
  }

  const emittedText = removeSourcePathAnnotations(outputFile.text);
  if (
    /#[a-z-]+-compose/.test(emittedText) ||
    /(?:^|["'`])(?:packages|adapters|bootstrap|modules)\//m.test(emittedText) ||
    /sourceMappingURL/.test(emittedText)
  ) {
    throw new Error(`target ${target.id} leaked a private specifier, source path, or source map`);
  }
  await atomicWrite(output, new TextEncoder().encode(emittedText));
}

if (process.argv.length !== 2) {
  throw new Error(
    "private composition builds accept no target, plugin, alias, or option overrides",
  );
}

const observedConfiguration = JSON.parse(await readFile(configurationPath, "utf8"));
if (
  JSON.stringify(stable(observedConfiguration)) !== JSON.stringify(stable(expectedConfiguration))
) {
  throw new Error("private composition configuration does not match the immutable contract");
}

for (const target of expectedConfiguration.targets) {
  await buildTarget(target, expectedConfiguration.options);
}

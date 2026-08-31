import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolvePnpmLauncher } from "../pnpm-launcher.mjs";
import { normalizeTrackedText } from "../tracked-text.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

export const packageContract = Object.freeze([
  ["@orchestration-platform/contracts", "packages/contracts", "ISS-002", ["."]],
  ["@orchestration-platform/config", "packages/config", "ISS-003", ["."]],
  ["@orchestration-platform/cli", "packages/cli", "ISS-003", ["."]],
  [
    "@orchestration-platform/conformance",
    "packages/conformance",
    "ISS-006",
    [".", "./github-actions"],
  ],
  ["@orchestration-platform/state", "packages/state", "ISS-004", ["."]],
  ["@orchestration-platform/process", "packages/process", "ISS-005", ["."]],
  ["@orchestration-platform/session", "packages/session", "ISS-007", ["."]],
  ["@orchestration-platform/adapter-sdk", "packages/adapter-sdk", "ISS-013", ["."]],
  ["@orchestration-platform/dispatch", "packages/dispatch", "ISS-008", ["."]],
  ["@orchestration-platform/breaker", "packages/breaker", "ISS-025", ["."]],
  ["@orchestration-platform/engine", "packages/engine", "ISS-026", ["."]],
  ["@orchestration-platform/supervisor", "packages/supervisor", "ISS-030", ["."]],
  ["@orchestration-platform/credentials", "packages/credentials", "ISS-032", ["."]],
  ["@orchestration-platform/host-custody", "packages/host-custody", "ISS-038", ["."]],
  ["@orchestration-platform/review", "packages/review", "ISS-009", ["."]],
  ["@orchestration-platform/journal", "packages/journal", "ISS-010", ["."]],
  ["@orchestration-platform/routing", "packages/routing", "ISS-012", ["."]],
  ["@orchestration-platform/release", "packages/release", "ISS-014", ["."]],
  ["@orchestration-platform/portable-primitives", "probes/portable-primitives", "ISS-022", ["."]],
  ["@orchestration-platform/walking-skeleton", "fixtures/walking-skeleton", "ISS-041", []],
  [
    "@orchestration-platform/host-codex",
    "packages/host-codex",
    "ISS-021",
    [".", "./bootstrap-canaries"],
  ],
  [
    "@orchestration-platform/adapter-self",
    "adapters/self",
    "ISS-033",
    [
      ".",
      "./workspace",
      "./code-host",
      "./certification",
      "./bootstrap-canaries",
      "./broker-operations",
    ],
  ],
  [
    "@orchestration-platform/adapter-first-consumer",
    "adapters/first-consumer",
    "ISS-028",
    [".", "./shadow", "./import", "./mutation"],
  ],
]);

const expectedBuildConfiguration = {
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
    ["bootstrap", "bootstrap/build/composition.ts", "bootstrap/dist/orchestration-bootstrap.mjs"],
    [
      "self-host",
      "adapters/self/build/composition.ts",
      "adapters/self/dist/orchestration-self.mjs",
    ],
    [
      "credential-broker",
      "bootstrap/build/broker-service-composition.ts",
      "packages/credentials/dist/orchestration-credential-broker.mjs",
    ],
    [
      "host-custody-bootstrap",
      "packages/host-custody/build/composition.ts",
      "packages/host-custody/dist/orchestration-host-custody-bootstrap.mjs",
    ],
    [
      "host-custody-broker",
      "packages/host-custody/build/broker-service-composition.ts",
      "packages/host-custody/dist/orchestration-host-custody-broker.mjs",
    ],
    ["cli", "packages/cli/build/composition.ts", "packages/cli/dist/orchestrate.mjs"],
  ].map(([id, entryPoint, output]) => ({ id, entryPoint, output })),
};

const expectedWorkflow = `name: bootstrap

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  smoke:
    name: Node 24 / \${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 24
      - run: corepack enable
      - run: corepack prepare pnpm@11.22.0 --activate
      - run: corepack pnpm install --frozen-lockfile
      - run: pnpm run verify:bootstrap
`;

const expectedCliFamilies = [
  ["config", "@orchestration-platform/config", "ISS-003", 2],
  ["session", "@orchestration-platform/session", "ISS-007", 5],
  ["worker", "@orchestration-platform/dispatch", "ISS-008", 3],
  ["review", "@orchestration-platform/review", "ISS-009", 1],
  ["journal", "@orchestration-platform/journal", "ISS-010", 3],
  ["project", "@orchestration-platform/adapter-sdk", "ISS-013", 3],
  ["release", "@orchestration-platform/release", "ISS-014", 4],
  ["cycle", "@orchestration-platform/engine", "ISS-026", 4],
  ["supervisor", "@orchestration-platform/supervisor", "ISS-030", 5],
  ["credential", "@orchestration-platform/credentials", "ISS-032", 3],
];

const expectedRegistryImports = [
  ["config", "@orchestration-platform/config"],
  ["session", "@orchestration-platform/session"],
  ["worker", "@orchestration-platform/dispatch"],
  ["review", "@orchestration-platform/review"],
  ["journal", "@orchestration-platform/journal"],
  ["project", "@orchestration-platform/adapter-sdk"],
  ["release", "@orchestration-platform/release"],
  ["cycle", "@orchestration-platform/engine"],
  ["supervisor", "@orchestration-platform/supervisor"],
  ["credential", "@orchestration-platform/credentials"],
];

const commandHandlerOwners = [
  "packages/config",
  "packages/session",
  "packages/dispatch",
  "packages/review",
  "packages/journal",
  "packages/adapter-sdk",
  "packages/release",
  "packages/engine",
  "packages/supervisor",
  "packages/credentials",
];

const expectedCliCommands = [
  "config validate||",
  "config paths||",
  "session acquire|--request|",
  "session renew|--session|",
  "session inspect||--session:true",
  "session release|--session|",
  "session handoff|--predecessor,--successor|",
  "worker dispatch|--plan|",
  "worker inspect|--launch|",
  "worker terminate|--launch|",
  "review reduce|--subject,--journal|",
  "journal append|--event|",
  "journal reduce|--journal|",
  "journal snapshot|--journal,--output|",
  "project snapshot|--adapter|",
  "project plan|--request|",
  "project apply|--plan,--plan-id|",
  "release assemble|--source-revision,--output|",
  "release certify|--candidate,--output|",
  "release promote|--input|",
  "release recover|--input|",
  "cycle plan|--request|",
  "cycle run|--plan,--plan-id|",
  "cycle resume|--cycle|",
  "cycle inspect|--cycle|",
  "supervisor plan|--request|",
  "supervisor install|--plan,--plan-id|",
  "supervisor tick|--installation|",
  "supervisor inspect|--installation|",
  "supervisor uninstall|--installation|",
  "credential bind|--request|",
  "credential inspect|--credential|",
  "credential revoke|--credential|",
];

const expectedBootstrapCommands = [
  "candidate|--source,--output|",
  "certify|--candidate,--output|",
  "broker-plan|--request,--output|",
  "broker-install|--plan,--output|",
  "broker-verify|--receipt|",
  "broker-remove|--receipt,--output|",
  "bind-credentials|--request,--output|",
  "authorize|--candidate,--certification,--review,--grant,--output|",
  "install|--input,--output|",
  "abort|--input,--output|",
  "recover|--transaction,--output|",
  "verify|--receipt|",
];

const expectedHostCustodyCommands = [
  "service-plan|--request,--output|",
  "service-install|--plan,--plan-id,--output|",
  "service-verify|--receipt,--output|",
  "enroll|--request,--output|",
  "challenge|--request,--output|",
  "verify-reentry|--request,--output|",
  "teardown|--request,--output|",
];

function fail(message) {
  throw new Error(`BOOTSTRAP_CONTRACT_MISMATCH: ${message}`);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeContractText(value) {
  try {
    return normalizeTrackedText(value);
  } catch {
    fail("text contract contains malformed or mixed line endings");
  }
}

async function runPnpm(args, cwd) {
  const launcher = await resolvePnpmLauncher();
  const result = await execFileAsync(launcher.executable, [...launcher.prefixArgs, ...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout;
}

async function listFiles(directory, prefix = "") {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      result.push(...(await listFiles(resolve(directory, entry.name), path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function hash(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function readTarballFiles(path) {
  const archive = gunzipSync(await readFile(path));
  const files = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) fail("package tarball has an invalid file size");
    const type = text(156, 1);
    offset += 512;
    if (type === "" || type === "0") {
      const publicPath = name.replace(/^package\//, "");
      if (!publicPath || files.has(publicPath)) fail("package tarball has duplicate file paths");
      files.set(publicPath, archive.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function parsePackResult(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) fail("pnpm pack did not emit a JSON inventory");
  return JSON.parse(stdout.slice(start));
}

async function collectCredentialPackageInventory(root) {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "orchestration-package-inventory-"));
  try {
    const firstDestination = resolve(temporaryRoot, "pack-a");
    const secondDestination = resolve(temporaryRoot, "pack-b");
    const first = parsePackResult(
      await runPnpm(
        [
          "--filter",
          "@orchestration-platform/credentials",
          "pack",
          "--pack-destination",
          firstDestination,
          "--json",
        ],
        root,
      ),
    );
    const second = parsePackResult(
      await runPnpm(
        [
          "--filter",
          "@orchestration-platform/credentials",
          "pack",
          "--pack-destination",
          secondDestination,
          "--json",
        ],
        root,
      ),
    );
    const tarballDigest = await hash(first.filename);
    const repeatedTarballDigest = await hash(second.filename);
    const tarballFiles = await readTarballFiles(first.filename);

    await writeFile(
      resolve(temporaryRoot, "package.json"),
      `${JSON.stringify({ name: "inventory-consumer", private: true, type: "module" })}\n`,
    );
    await runPnpm(["add", "--offline", "--ignore-scripts", first.filename], temporaryRoot);

    const installedRoot = resolve(
      temporaryRoot,
      "node_modules/@orchestration-platform/credentials",
    );
    const installedFiles = await listFiles(installedRoot);
    const forbiddenByteMatches = [];
    for (const file of installedFiles) {
      const text = (await readFile(resolve(installedRoot, file))).toString("utf8");
      if (
        text.includes("#broker-compose") ||
        text.includes("packages/credentials/build") ||
        text.includes("composeBrokerClient") ||
        text.includes("sourceMappingURL")
      ) {
        forbiddenByteMatches.push(file);
      }
    }
    const tarballForbiddenByteMatches = [];
    for (const [file, bytes] of tarballFiles) {
      const text = bytes.toString("utf8");
      if (
        text.includes("#broker-compose") ||
        text.includes("packages/credentials/build") ||
        text.includes("composeBrokerClient") ||
        text.includes("sourceMappingURL")
      ) {
        tarballForbiddenByteMatches.push(file);
      }
    }

    const publicImport = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'process.stdout.write(import.meta.resolve("@orchestration-platform/credentials"))',
      ],
      { cwd: temporaryRoot, windowsHide: true },
    ).then(
      () => ({ status: 0, stderr: "" }),
      (error) => ({ status: error.code ?? 1, stderr: error.stderr ?? error.message }),
    );
    const deepImports = [];
    for (const specifier of [
      "@orchestration-platform/credentials/build/compose",
      "@orchestration-platform/credentials/build/compose.ts",
    ]) {
      deepImports.push(
        await execFileAsync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`,
          ],
          { cwd: temporaryRoot, windowsHide: true },
        ).then(
          () => ({ specifier, status: 0, stderr: "" }),
          (error) => ({
            specifier,
            status: error.code ?? 1,
            stderr: error.stderr ?? error.message,
          }),
        ),
      );
    }

    return {
      packFiles: first.files.map(({ path }) => path).sort(),
      repeatedPackFiles: second.files.map(({ path }) => path).sort(),
      tarballFiles: [...tarballFiles.keys()].sort(),
      installedFiles,
      installedManifest: JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8")),
      forbiddenByteMatches,
      tarballForbiddenByteMatches,
      tarballDigest,
      repeatedTarballDigest,
      publicImport,
      deepImports,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function findHandlerFiles(root) {
  const files = [];
  for (const [, packagePath] of packageContract) {
    const sourceRoot = resolve(root, packagePath, "src");
    for (const file of await listFiles(sourceRoot)) {
      if (file.endsWith("command-handler.mjs") || file.endsWith("command-handler.d.mts")) {
        files.push(`${packagePath}/src/${file}`);
      }
    }
  }
  return files.sort();
}

export async function loadBootstrapSnapshot(root = defaultRoot) {
  const manifests = {};
  for (const [name, path] of packageContract) {
    manifests[name] = JSON.parse(await readFile(resolve(root, path, "package.json"), "utf8"));
  }
  const packageDirectories = (await readdir(resolve(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`);
  const adapterDirectories = (await readdir(resolve(root, "adapters"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `adapters/${entry.name}`);
  const probeDirectories = (await readdir(resolve(root, "probes"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `probes/${entry.name}`);
  const fixtureDirectories = (await readdir(resolve(root, "fixtures"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `fixtures/${entry.name}`);
  const cliRegistryUrl = `${pathToFileURL(resolve(root, "packages/cli/src/registry.mjs")).href}?census=${Date.now()}`;
  const bootstrapRegistryUrl = `${pathToFileURL(resolve(root, "bootstrap/src/command-registry.mjs")).href}?census=${Date.now()}`;
  const hostRegistryUrl = `${pathToFileURL(resolve(root, "packages/host-custody/src/bootstrap-command-registry.mjs")).href}?census=${Date.now()}`;
  const handlerFiles = await findHandlerFiles(root);
  const handlerSources = {};
  for (const file of handlerFiles.filter((file) => file.endsWith(".mjs"))) {
    handlerSources[file] = await readFile(resolve(root, file), "utf8");
  }
  return {
    rootPackage: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    workspace: await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8"),
    baseTsconfig: JSON.parse(await readFile(resolve(root, "tsconfig.base.json"), "utf8")),
    manifests,
    packageDirectories: [
      ...packageDirectories,
      ...probeDirectories,
      ...adapterDirectories,
      ...fixtureDirectories,
    ].sort(),
    buildConfiguration: JSON.parse(
      await readFile(resolve(root, "config/private-compositions.json"), "utf8"),
    ),
    moduleManifestSource: await readFile(resolve(root, "modules/manifest.json"), "utf8"),
    moduleManifest: JSON.parse(await readFile(resolve(root, "modules/manifest.json"), "utf8")),
    workflow: await readFile(resolve(root, ".github/workflows/bootstrap.yml"), "utf8"),
    cliRegistrySource: await readFile(resolve(root, "packages/cli/src/registry.mjs"), "utf8"),
    buildScriptSource: await readFile(
      resolve(root, "scripts/build/private-compositions.mjs"),
      "utf8",
    ),
    handlerFiles,
    handlerSources,
    credentialPackageInventory: await collectCredentialPackageInventory(root),
    cliRegistry: (await import(cliRegistryUrl)).commandRegistry,
    bootstrapRegistry: (await import(bootstrapRegistryUrl)).bootstrapCommandRegistry,
    hostRegistry: (await import(hostRegistryUrl)).hostCustodyBootstrapCommandRegistry,
    root,
  };
}

function assertRegistry(registry, expected, label) {
  if (registry.length !== expected.length) fail(`${label} handler count mismatch`);
  const seenFamilies = new Set();
  const seenCommands = new Set();
  for (let index = 0; index < expected.length; index += 1) {
    const observed = registry[index];
    const [family, owner, issue, commandCount] = expected[index];
    if (
      observed.schemaVersion !== "orchestration-command-handler-registration/v1" ||
      observed.family !== family ||
      observed.owner !== owner ||
      observed.issue !== issue ||
      !["placeholder", "implemented"].includes(observed.implementation) ||
      observed.commands.length !== commandCount
    ) {
      fail(`${label} registration mismatch for ${family}`);
    }
    if (seenFamilies.has(family)) fail(`${label} duplicate family ${family}`);
    seenFamilies.add(family);
    if (label === "CLI") {
      const implemented = family === "config" || family === "project";
      const fields = ["commands", "family", "implementation", "issue", "owner", "schemaVersion"];
      if (implemented) fields.push("handler");
      if (
        !equal(Object.keys(observed).sort(), fields.sort()) ||
        observed.implementation !== (implemented ? "implemented" : "placeholder") ||
        (implemented && typeof observed.handler !== "function")
      )
        fail(`${label} closed handler registration mismatch for ${family}`);
    }
    for (const command of observed.commands) {
      const key = command.argv.join(" ");
      if (seenCommands.has(key)) fail(`${label} duplicate command ${key}`);
      if (label === "CLI" && command.argv[0] !== family) fail(`${label} moved command ${key}`);
      if (label === "CLI") {
        const fields = ["argv", "optional", "required"];
        const resultSchema =
          key === "config validate"
            ? "configuration-provenance/v1"
            : key === "config paths"
              ? "configuration-paths/v1"
              : key === "project snapshot"
                ? "project-facts/v1"
                : null;
        if (resultSchema !== null) fields.push("resultSchema");
        if (
          !equal(Object.keys(command).sort(), fields.sort()) ||
          (resultSchema !== null && command.resultSchema !== resultSchema)
        )
          fail(`${label} result schema registration mismatch for ${key}`);
      }
      seenCommands.add(key);
    }
  }
}

function registrySignatures(registry) {
  return registry.flatMap((registration) =>
    registration.commands.map(
      (command) =>
        `${command.argv.join(" ")}|${command.required.join(",")}|${command.optional
          .map(({ name, takesValue }) => `${name}:${takesValue}`)
          .join(",")}`,
    ),
  );
}

function validateCliRegistrySource(source) {
  const expectedImports = expectedRegistryImports
    .map(
      ([binding, moduleName]) =>
        `import { commandHandlerRegistration as ${binding} } from "${moduleName}";`,
    )
    .join("\n");
  const expectedBindings = expectedRegistryImports.map(([binding]) => `  ${binding},`).join("\n");
  const expectedSource = `${expectedImports}\n\nexport const commandRegistry = Object.freeze([\n${expectedBindings}\n]);\n`;
  if (source.replace(/\r\n/g, "\n") !== expectedSource) {
    fail("CLI registry is not one literal frozen static handler list");
  }
}

function validateHandlerSources(handlerFiles, handlerSources) {
  const expectedFiles = commandHandlerOwners
    .flatMap((path) => [`${path}/src/command-handler.d.mts`, `${path}/src/command-handler.mjs`])
    .sort();
  if (!equal(handlerFiles, expectedFiles)) fail("command handler file census mismatch");
  for (const file of expectedFiles.filter((path) => path.endsWith(".mjs"))) {
    const source = handlerSources[file];
    if (typeof source !== "string") fail(`missing command handler source ${file}`);
    let normalized = source.replace(/\r\n/g, "\n");
    if (
      file === "packages/config/src/command-handler.mjs" ||
      file === "packages/adapter-sdk/src/command-handler.mjs"
    ) {
      // These two fixed implementation imports defer execution until invocation;
      // the source registration census does not need TypeScript resolution.
      const project = file === "packages/adapter-sdk/src/command-handler.mjs";
      const binding = project ? "projectSnapshotCommandHandler" : "configCommandHandler";
      const target = project ? "project-command" : "config-command";
      const handler = `  handler: async (input) => {
    const { ${binding} } = await import("./${target}.ts");
    return ${binding}(input);
  },
`;
      if (!normalized.includes(handler)) fail("command handler implementation binding mismatch");
      normalized = normalized.replace(handler, "");
    }
    if (
      !normalized.startsWith("export const commandHandlerRegistration = Object.freeze({\n") ||
      !normalized.endsWith("});\n") ||
      (normalized.match(/\bexport\s+const\b/g) ?? []).length !== 1 ||
      (normalized.match(/\bObject\.freeze\s*\(/g) ?? []).length !== 1 ||
      /\b(?:import|require)\s*\(|\bawait\b|=>|\bfunction\b/.test(normalized)
    ) {
      fail(`${file} contains dynamic registration or discovery statements`);
    }
  }
}

function validateBuildScriptSource(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const expectedBrokerCompositionPath =
    'const brokerCompositionPath = resolve(repositoryRoot, "packages/credentials/build/compose.ts");';
  const expectedAliasTargets =
    'const aliasTargets = new Set(["bootstrap", "self-host", "host-custody-bootstrap"]);';
  const expectedResolver = `function brokerComposeResolver(targetId) {
  return {
    name: "broker-compose-closed-resolver",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^#broker-compose$/ }, () => {
        if (!aliasTargets.has(targetId)) {
          return { errors: [{ text: \`#broker-compose is forbidden for target \${targetId}\` }] };
        }
        return { path: brokerCompositionPath };
      });
    },
  };
}`;
  const expectedInvocation = `const result = await build({
    ...options,
    absWorkingDir: repositoryRoot,
    entryPoints: [entryPoint],
    outfile: output,
    write: false,
    metafile: true,
    plugins: [brokerComposeResolver(target.id)],
    logLevel: "silent",
  });`;
  if (
    !normalized.includes(expectedBrokerCompositionPath) ||
    !normalized.includes(expectedAliasTargets) ||
    !normalized.includes(expectedResolver) ||
    !normalized.includes(expectedInvocation) ||
    (normalized.match(/\bbuild\s*\(/g) ?? []).length !== 1 ||
    (normalized.match(/\.onResolve\s*\(/g) ?? []).length !== 1 ||
    (normalized.match(/\.onLoad\s*\(/g) ?? []).length !== 0 ||
    (normalized.match(/\bplugins\s*:/g) ?? []).length !== 1 ||
    /\bimport\s*\(/.test(normalized)
  ) {
    fail("private build must register exactly the broker-compose resolver plugin");
  }
}

function validateCredentialPackageInventory(inventory) {
  const expectedFiles = [
    "package.json",
    "src/command-handler.d.mts",
    "src/command-handler.mjs",
    "src/index.ts",
  ];
  if (
    !equal(inventory.packFiles, expectedFiles) ||
    !equal(inventory.repeatedPackFiles, expectedFiles) ||
    !equal(inventory.tarballFiles, expectedFiles) ||
    !equal(inventory.installedFiles, expectedFiles)
  ) {
    fail("credential package tarball/installed file census mismatch");
  }
  if (
    inventory.packFiles.some((path) => /(^|\/)(build|dist)(\/|$)|\.map$/i.test(path)) ||
    inventory.installedFiles.some((path) => /(^|\/)(build|dist)(\/|$)|\.map$/i.test(path))
  ) {
    fail("credential package contains private build, distribution, or source-map paths");
  }
  if (
    inventory.forbiddenByteMatches.length !== 0 ||
    inventory.tarballForbiddenByteMatches.length !== 0
  ) {
    fail("credential package installed/tarball bytes contain private composition material");
  }
  if (
    inventory.tarballDigest !== inventory.repeatedTarballDigest ||
    !/^[a-f0-9]{64}$/.test(inventory.tarballDigest)
  ) {
    fail("credential package tarball bytes are nondeterministic");
  }
  if (
    !equal(inventory.installedManifest.files, ["src"]) ||
    !equal(Object.keys(inventory.installedManifest.exports), ["."]) ||
    inventory.installedManifest.imports
  ) {
    fail("installed credential package manifest widens files, exports, or runtime imports");
  }
  if (inventory.publicImport.status !== 0) fail("installed credential package public export fails");
  if (
    inventory.deepImports.length !== 2 ||
    inventory.deepImports.some(
      (result) => result.status === 0 || !result.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED"),
    )
  ) {
    fail("installed credential package admits a private runtime/deep import");
  }
}

export async function validateBootstrapSnapshot(snapshot) {
  if (
    snapshot.rootPackage.packageManager !== "pnpm@11.22.0" ||
    snapshot.rootPackage.engines?.node !== ">=24 <25" ||
    snapshot.rootPackage.devDependencies?.esbuild !== "0.28.2" ||
    snapshot.rootPackage.scripts?.build !==
      "node scripts/build/windows-reparse-fact.mjs && node scripts/build/private-compositions.mjs" ||
    snapshot.rootPackage.scripts?.["contracts:compatibility-check"] !==
      "vitest run test/contracts/compatibility.test.ts" ||
    snapshot.rootPackage.scripts?.["harness:test"] !== "node scripts/harness-test.mts" ||
    snapshot.rootPackage.scripts?.["probe:portable-primitives"] !==
      "node scripts/conformance/portable-primitives-verification.mts probe" ||
    snapshot.rootPackage.scripts?.["probe:portable-primitives:verify-receipts"] !==
      "node scripts/conformance/portable-primitives-verification.mts receipts" ||
    snapshot.rootPackage.scripts?.["test:harness-workflow-mutations"] !==
      "vitest run test/conformance/workflow-structure.test.ts"
  ) {
    fail("root runtime metadata, esbuild pin, or harness entrypoint census mismatch");
  }
  for (const dependency of ["@types/node", "esbuild", "prettier", "typescript", "vitest"]) {
    const version = snapshot.rootPackage.devDependencies[dependency];
    if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`${dependency} is not exactly pinned`);
  }
  if (
    normalizeContractText(snapshot.workspace) !==
    'packages:\n  - "packages/*"\n  - "probes/*"\n  - "modules/*"\n  - "adapters/*"\n  - "fixtures/*"\n\nallowBuilds:\n  esbuild: true\n'
  ) {
    fail("workspace globs are not the exact predeclared set");
  }
  if (snapshot.baseTsconfig.compilerOptions?.strict !== true)
    fail("TypeScript strict mode is disabled");
  if (
    snapshot.baseTsconfig.compilerOptions?.paths ||
    snapshot.baseTsconfig.compilerOptions?.baseUrl
  ) {
    fail("TypeScript must not expose a private composition alias");
  }

  const expectedDirectories = packageContract.map(([, path]) => path).sort();
  if (!equal(snapshot.packageDirectories, expectedDirectories))
    fail("workspace package path census mismatch");
  for (const [name, path, issue, exportKeys] of packageContract) {
    const manifest = snapshot.manifests[name];
    if (
      name === "@orchestration-platform/walking-skeleton" &&
      (manifest.private !== true ||
        !equal(manifest.dependencies, { "@orchestration-platform/contracts": "workspace:*" }))
    ) {
      fail("walking skeleton must remain private with its real contracts workspace dependency");
    }
    for (const kind of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      if (manifest[kind]?.["@orchestration-platform/walking-skeleton"] !== undefined) {
        fail("production packages must not depend on the walking skeleton");
      }
    }
    if (manifest.name !== name || manifest.version !== "0.0.0" || manifest.type !== "module") {
      fail(`${name} identity mismatch`);
    }
    const expectedFiles = name === "@orchestration-platform/cli" ? ["src", "bin"] : ["src"];
    if (!equal(manifest.files, expectedFiles)) fail(`${name} package files census mismatch`);
    if (!equal(Object.keys(manifest.exports), exportKeys)) fail(`${name} export census mismatch`);
    if (manifest.imports || manifest.exports["#broker-compose"])
      fail(`${name} exposes private alias`);
    if (
      manifest.scripts?.build ||
      manifest.devDependencies?.esbuild ||
      (manifest.dependencies?.esbuild && name !== "@orchestration-platform/conformance")
    ) {
      fail(`${name} has a package-local private build override`);
    }
    if (
      name === "@orchestration-platform/conformance" &&
      manifest.dependencies?.esbuild !== "0.28.2"
    ) {
      fail("@orchestration-platform/conformance esbuild pin mismatch");
    }
    const expectedTest =
      name === "@orchestration-platform/contracts"
        ? "pnpm --dir ../.. exec vitest run test/contracts"
        : name === "@orchestration-platform/adapter-sdk"
          ? "pnpm --dir ../.. exec vitest run test/adapter-sdk"
        : name === "@orchestration-platform/walking-skeleton"
          ? "pnpm --dir ../.. exec vitest run fixtures/walking-skeleton/test"
          : name === "@orchestration-platform/config"
            ? "pnpm --dir ../.. exec vitest run test/config"
            : name === "@orchestration-platform/cli"
              ? "pnpm --dir ../.. exec vitest run test/cli"
              : name === "@orchestration-platform/conformance"
                ? "node ../../scripts/harness-test.mts"
                : `node ../../scripts/capability-not-implemented.mjs ${issue} ${name}:test`;
    if (manifest.scripts?.test !== expectedTest) fail(`${name} test placeholder owner mismatch`);
    for (const [exportKey, value] of Object.entries(manifest.exports)) {
      const expectedTarget =
        exportKey === "." ? "./src/index.ts" : `./src/${exportKey.slice(2)}/index.ts`;
      if (value.types !== expectedTarget || value.default !== expectedTarget) {
        fail(`${name} moved export ${exportKey}`);
      }
      const target = value.default;
      await access(resolve(snapshot.root, path, target));
    }
    const packageTsconfig = JSON.parse(
      await readFile(resolve(snapshot.root, path, "tsconfig.json"), "utf8"),
    );
    if (
      packageTsconfig.extends !== "../../tsconfig.base.json" ||
      !equal(packageTsconfig.include, ["src/**/*.ts"])
    ) {
      fail(`${name} TypeScript skeleton mismatch`);
    }
  }

  if (!equal(snapshot.buildConfiguration, expectedBuildConfiguration)) {
    fail("private composition target/options contract mismatch");
  }
  validateBuildScriptSource(snapshot.buildScriptSource);
  if (!Array.isArray(snapshot.moduleManifest) || snapshot.moduleManifest.length !== 0) {
    fail("bootstrap module manifest must be the exact empty list");
  }
  if (normalizeContractText(snapshot.moduleManifestSource) !== "[]\n")
    fail("bootstrap module manifest bytes mismatch");
  if (normalizeContractText(snapshot.workflow) !== expectedWorkflow)
    fail("three-OS bootstrap workflow mismatch");
  validateCliRegistrySource(snapshot.cliRegistrySource);
  validateHandlerSources(snapshot.handlerFiles, snapshot.handlerSources);
  validateCredentialPackageInventory(snapshot.credentialPackageInventory);
  assertRegistry(snapshot.cliRegistry, expectedCliFamilies, "CLI");
  if (!equal(registrySignatures(snapshot.cliRegistry), expectedCliCommands)) {
    fail("CLI command/flag census mismatch");
  }
  assertRegistry(
    snapshot.bootstrapRegistry,
    [["bootstrap", "orchestration-bootstrap", "ISS-020", 12]],
    "bootstrap",
  );
  if (!equal(registrySignatures(snapshot.bootstrapRegistry), expectedBootstrapCommands)) {
    fail("bootstrap command/flag census mismatch");
  }
  assertRegistry(
    snapshot.hostRegistry,
    [["host-custody-bootstrap", "@orchestration-platform/host-custody", "ISS-038", 7]],
    "host-custody bootstrap",
  );
  if (!equal(registrySignatures(snapshot.hostRegistry), expectedHostCustodyCommands)) {
    fail("host-custody command/flag census mismatch");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("bootstrap contract checker accepts no arguments");
  await validateBootstrapSnapshot(await loadBootstrapSnapshot());
  process.stdout.write("bootstrap manifests and registries verified\n");
}

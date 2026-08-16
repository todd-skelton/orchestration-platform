import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const packageContract = Object.freeze([
  ["@orchestration-platform/contracts", "packages/contracts", "ISS-002", ["."]],
  ["@orchestration-platform/config", "packages/config", "ISS-003", ["."]],
  ["@orchestration-platform/cli", "packages/cli", "ISS-003", ["."]],
  ["@orchestration-platform/conformance", "packages/conformance", "ISS-006", ["."]],
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

const expectedCliCommands = [
  "config validate||",
  "config paths||--reveal:false",
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
  const cliRegistryUrl = `${pathToFileURL(resolve(root, "packages/cli/src/registry.mjs")).href}?census=${Date.now()}`;
  const bootstrapRegistryUrl = `${pathToFileURL(resolve(root, "bootstrap/src/command-registry.mjs")).href}?census=${Date.now()}`;
  const hostRegistryUrl = `${pathToFileURL(resolve(root, "packages/host-custody/src/bootstrap-command-registry.mjs")).href}?census=${Date.now()}`;
  return {
    rootPackage: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    workspace: await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8"),
    baseTsconfig: JSON.parse(await readFile(resolve(root, "tsconfig.base.json"), "utf8")),
    manifests,
    packageDirectories: [...packageDirectories, ...adapterDirectories].sort(),
    buildConfiguration: JSON.parse(
      await readFile(resolve(root, "config/private-compositions.json"), "utf8"),
    ),
    moduleManifestSource: await readFile(resolve(root, "modules/manifest.json"), "utf8"),
    moduleManifest: JSON.parse(await readFile(resolve(root, "modules/manifest.json"), "utf8")),
    workflow: await readFile(resolve(root, ".github/workflows/bootstrap.yml"), "utf8"),
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
      observed.implementation !== "placeholder" ||
      observed.commands.length !== commandCount
    ) {
      fail(`${label} registration mismatch for ${family}`);
    }
    if (seenFamilies.has(family)) fail(`${label} duplicate family ${family}`);
    seenFamilies.add(family);
    for (const command of observed.commands) {
      const key = command.argv.join(" ");
      if (seenCommands.has(key)) fail(`${label} duplicate command ${key}`);
      if (label === "CLI" && command.argv[0] !== family) fail(`${label} moved command ${key}`);
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

export async function validateBootstrapSnapshot(snapshot) {
  if (
    snapshot.rootPackage.packageManager !== "pnpm@11.22.0" ||
    snapshot.rootPackage.engines?.node !== ">=24 <25" ||
    snapshot.rootPackage.devDependencies?.esbuild !== "0.28.2"
  ) {
    fail("root runtime metadata or esbuild pin mismatch");
  }
  for (const dependency of ["@types/node", "esbuild", "prettier", "typescript", "vitest"]) {
    const version = snapshot.rootPackage.devDependencies[dependency];
    if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`${dependency} is not exactly pinned`);
  }
  if (
    snapshot.workspace !==
    'packages:\n  - "packages/*"\n  - "modules/*"\n  - "adapters/*"\n\nallowBuilds:\n  esbuild: true\n'
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
    if (manifest.name !== name || manifest.version !== "0.0.0" || manifest.type !== "module") {
      fail(`${name} identity mismatch`);
    }
    if (!equal(Object.keys(manifest.exports), exportKeys)) fail(`${name} export census mismatch`);
    if (manifest.imports || manifest.exports["#broker-compose"])
      fail(`${name} exposes private alias`);
    if (
      manifest.scripts?.build ||
      manifest.devDependencies?.esbuild ||
      manifest.dependencies?.esbuild
    ) {
      fail(`${name} has a package-local private build override`);
    }
    const expectedTest = `node ../../scripts/capability-not-implemented.mjs ${issue} ${name}:test`;
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
  if (!Array.isArray(snapshot.moduleManifest) || snapshot.moduleManifest.length !== 0) {
    fail("bootstrap module manifest must be the exact empty list");
  }
  if (snapshot.moduleManifestSource !== "[]\n") fail("bootstrap module manifest bytes mismatch");
  if (snapshot.workflow !== expectedWorkflow) fail("three-OS bootstrap workflow mismatch");
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

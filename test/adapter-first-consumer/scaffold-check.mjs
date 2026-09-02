import { execFile } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  admitFirstConsumerCompatibility,
  createFirstConsumerConfiguration,
  firstConsumerAdapterId,
  firstConsumerAdapterVersion,
  firstConsumerCapabilityNames,
  firstConsumerEngineVersions,
  firstConsumerExtensions,
  firstConsumerSchemaVersions,
  firstConsumerSdkVersion,
} from "../../adapters/first-consumer/src/index.ts";
import * as importExtension from "../../adapters/first-consumer/src/import/index.ts";
import * as mutationExtension from "../../adapters/first-consumer/src/mutation/index.ts";
import * as shadowExtension from "../../adapters/first-consumer/src/shadow/index.ts";
import { resolvePnpmLauncher } from "../../scripts/pnpm-launcher.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath = resolve(repositoryRoot, "adapters/first-consumer/package.json");
const sourceRoot = resolve(repositoryRoot, "adapters/first-consumer/src");
const sdkPackagePath = resolve(repositoryRoot, "packages/adapter-sdk/package.json");
const enginePackagePath = resolve(repositoryRoot, "packages/engine/package.json");
const emptyFixtureProjectId = "01900000-0000-7000-8000-000000000028";

function fail(message) {
  throw new Error(`first-consumer-scaffold:${message}`);
}

function request(overrides = {}) {
  return {
    adapterId: firstConsumerAdapterId,
    adapterVersion: firstConsumerAdapterVersion,
    capabilityNames: [...firstConsumerCapabilityNames],
    engineVersion: firstConsumerEngineVersions[0],
    schemaVersions: [...firstConsumerSchemaVersions],
    sdkVersion: firstConsumerSdkVersion,
    ...overrides,
  };
}

function arrayMutant(source, mutate) {
  const value = [...source];
  mutate(value);
  return value;
}

function assertClosedPlaceholder(moduleNamespace, exportName, owner) {
  if (JSON.stringify(Object.keys(moduleNamespace)) !== JSON.stringify([exportName]))
    fail("extension-module-export-census");
  const placeholder = moduleNamespace[exportName];
  const descriptors = Object.getOwnPropertyDescriptors(placeholder);
  if (
    Object.getPrototypeOf(placeholder) !== Object.prototype ||
    !Object.isFrozen(placeholder) ||
    JSON.stringify(Reflect.ownKeys(descriptors).sort()) !== JSON.stringify(["outcome", "owner"]) ||
    Reflect.ownKeys(descriptors).some((key) => {
      const descriptor = descriptors[key];
      return !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true;
    }) ||
    descriptors.outcome.value !== "CAPABILITY_NOT_IMPLEMENTED" ||
    descriptors.owner.value !== owner
  )
    fail("extension-placeholder-census");
}

async function packageSourceCensus(directory = sourceRoot, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await packageSourceCensus(path, root)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else fail("package-source-kind");
  }
  return files.sort();
}

function parsePackResult(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) fail("package-pack-json");
  return JSON.parse(stdout.slice(start));
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
    if (!Number.isSafeInteger(size) || size < 0) fail("package-tar-size");
    const type = text(156, 1);
    offset += 512;
    if (type === "" || type === "0") {
      const publicPath = name.replace(/^package\//, "");
      if (!publicPath || files.has(publicPath)) fail("package-tar-census");
      files.set(publicPath, archive.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function containsSensitiveOrLocalText(text) {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /gh[pousr]_[A-Za-z0-9]{20,}/.test(text) ||
    /github_pat_[A-Za-z0-9_]{20,}/.test(text) ||
    /npm_[A-Za-z0-9]{20,}/.test(text) ||
    /(?:^|[\s"'`(=])(?:[A-Za-z]:\\Users\\[^\\\s"'`]+(?:\\[^\s"'`]*)?|\/Users\/[^/\s"'`]+(?:\/[^\s"'`]*)?|\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?)/m.test(
      text,
    ) ||
    /file:\/\/\/(?:[A-Za-z]:\/Users|Users|home)\/[^/\s"'`]+/i.test(text)
  );
}

function containsFirstConsumerReference(text) {
  return text.includes("first-consumer");
}

function assertBoundaryDetectorFixtures() {
  const sensitive = [
    "-----BEGIN PRIVATE KEY-----",
    `ghp_${"a".repeat(20)}`,
    `github_pat_${"a_b".repeat(10)}`,
    `npm_${"a".repeat(36)}`,
    "C:\\Users\\fixture-user\\repository\\secret.txt",
    "/Users/fixture-user/repository/secret.txt",
    "/home/fixture-user/repository/secret.txt",
    "file:///home/fixture-user/repository/secret.txt",
  ];
  const benign = [
    "https://example.test/home/fixture-user/repository",
    "https://example.test/Users/fixture-user/repository",
    "the /home/ page",
    "ghp_short",
    "github_pat_short",
    "npm_install",
    "-----BEGIN PUBLIC KEY-----",
    "C:\\Program Files\\fixture\\readme.txt",
  ];
  if (sensitive.some((value) => !containsSensitiveOrLocalText(value)))
    fail("sensitive-detector-positive");
  if (benign.some((value) => containsSensitiveOrLocalText(value)))
    fail("sensitive-detector-negative");
  const references = [
    "@orchestration-platform/adapter-first-consumer",
    "../../first-consumer/src/index.js",
    "../../../adapters/first-consumer/src/index.js",
    'adapterId: "first-consumer"',
  ];
  const unrelated = ["consumer-first", "first_consumer", "first.consumer", "consumer"];
  if (references.some((value) => !containsFirstConsumerReference(value)))
    fail("platform-reference-detector-positive");
  if (unrelated.some((value) => containsFirstConsumerReference(value)))
    fail("platform-reference-detector-negative");
}

export async function runFirstConsumerScaffoldCheck() {
  const fixture = createFirstConsumerConfiguration(emptyFixtureProjectId);
  if (!fixture.ok) fail("empty-configuration-refused");
  if (
    !Object.isFrozen(fixture) ||
    !Object.isFrozen(fixture.value) ||
    JSON.stringify(Object.keys(fixture.value).sort()) !==
      JSON.stringify([
        "adapterId",
        "adapterVersion",
        "capabilityNames",
        "engineVersion",
        "projectId",
        "schemaVersion",
      ]) ||
    JSON.stringify(fixture.value) !==
      '{"adapterId":"first-consumer","adapterVersion":"0.0.0","capabilityNames":["project.import","project.mutation","project.shadow"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000028","schemaVersion":"adapter-configuration/v1"}'
  )
    fail("empty-configuration-census");
  for (const projectId of [
    null,
    {},
    "01900000-0000-6000-8000-000000000028",
    "01900000-0000-7000-7000-000000000028",
    "01900000-0000-7000-8ABC-000000000028",
  ])
    if (createFirstConsumerConfiguration(projectId).ok) fail("project-id-mutant-accepted");
  if (!admitFirstConsumerCompatibility(request()).ok) fail("exact-compatibility-refused");
  if (
    !admitFirstConsumerCompatibility(
      Object.freeze(
        request({
          capabilityNames: Object.freeze([...firstConsumerCapabilityNames]),
          schemaVersions: Object.freeze([...firstConsumerSchemaVersions]),
        }),
      ),
    ).ok ||
    !admitFirstConsumerCompatibility(
      Object.seal(
        request({
          capabilityNames: Object.seal([...firstConsumerCapabilityNames]),
          schemaVersions: Object.seal([...firstConsumerSchemaVersions]),
        }),
      ),
    ).ok
  )
    fail("benign-closed-compatibility-refused");
  let proxyTrapInvoked = false;
  const hostileProxy = new Proxy(request(), {
    getPrototypeOf() {
      proxyTrapInvoked = true;
      throw new Error("must not inspect proxy");
    },
  });
  let recordAccessorInvoked = false;
  const recordAccessor = request();
  Object.defineProperty(recordAccessor, "adapterId", {
    enumerable: true,
    get() {
      recordAccessorInvoked = true;
      throw new Error("must not invoke record accessor");
    },
  });
  const recordSymbol = request();
  recordSymbol[Symbol("unexpected")] = true;
  let arrayProxyTrapInvoked = false;
  const arrayProxy = new Proxy([...firstConsumerCapabilityNames], {
    getPrototypeOf() {
      arrayProxyTrapInvoked = true;
      throw new Error("must not inspect array proxy");
    },
  });
  let arrayAccessorInvoked = false;
  const arrayAccessor = [...firstConsumerCapabilityNames];
  Object.defineProperty(arrayAccessor, "0", {
    enumerable: true,
    get() {
      arrayAccessorInvoked = true;
      throw new Error("must not invoke array accessor");
    },
  });
  const mutants = [
    request({ adapterId: "other" }),
    request({ adapterVersion: "0.0.1" }),
    request({ capabilityNames: firstConsumerCapabilityNames.slice(1) }),
    request({ capabilityNames: [...firstConsumerCapabilityNames].reverse() }),
    request({ capabilityNames: arrayProxy }),
    request({ capabilityNames: arrayAccessor }),
    request({
      capabilityNames: arrayMutant(firstConsumerCapabilityNames, (value) =>
        Object.setPrototypeOf(value, {}),
      ),
    }),
    request({
      capabilityNames: arrayMutant(firstConsumerCapabilityNames, (value) => delete value[1]),
    }),
    request({
      capabilityNames: arrayMutant(firstConsumerCapabilityNames, (value) => value.push("extra")),
    }),
    request({
      capabilityNames: arrayMutant(firstConsumerCapabilityNames, (value) => {
        value[1] = value[0];
      }),
    }),
    request({ engineVersion: "0.0.1" }),
    request({ schemaVersions: firstConsumerSchemaVersions.slice(1) }),
    request({ schemaVersions: [...firstConsumerSchemaVersions].reverse() }),
    request({
      schemaVersions: arrayMutant(firstConsumerSchemaVersions, (value) => {
        value[1] = value[0];
      }),
    }),
    request({ sdkVersion: "0.0.1" }),
    { ...request(), extra: true },
    Object.assign(Object.create(null), request()),
    hostileProxy,
    recordAccessor,
    recordSymbol,
  ];
  for (const mutant of mutants)
    if (admitFirstConsumerCompatibility(mutant).ok) fail("compatibility-mutant-accepted");
  if (proxyTrapInvoked || arrayProxyTrapInvoked) fail("proxy-trap-invoked");
  if (recordAccessorInvoked || arrayAccessorInvoked) fail("accessor-invoked");

  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const sdkPackage = JSON.parse(await readFile(sdkPackagePath, "utf8"));
  const enginePackage = JSON.parse(await readFile(enginePackagePath, "utf8"));
  if (
    packageJson.version !== firstConsumerAdapterVersion ||
    sdkPackage.version !== firstConsumerSdkVersion ||
    enginePackage.version !== firstConsumerEngineVersions[0]
  )
    fail("workspace-version-binding");
  const expectedExports = [".", "./import", "./mutation", "./shadow"];
  if (JSON.stringify(Object.keys(packageJson.exports).sort()) !== JSON.stringify(expectedExports))
    fail("package-export-census");
  if (JSON.stringify(packageJson.files) !== JSON.stringify(["src"])) fail("package-files-census");
  const sourceCensus = await packageSourceCensus();
  const expectedSources = ["import/index.ts", "index.ts", "mutation/index.ts", "shadow/index.ts"];
  if (JSON.stringify(sourceCensus) !== JSON.stringify(expectedSources))
    fail("package-source-census");
  for (const name of sourceCensus) {
    const source = await readFile(resolve(sourceRoot, name), "utf8");
    if (containsSensitiveOrLocalText(source)) fail("package-sensitive-source");
  }

  const expectedExtensions = Object.freeze([
    Object.freeze({
      capabilityName: "project.import",
      exportPath: "./import",
      extensionId: "import",
      owner: "ISS-024",
    }),
    Object.freeze({
      capabilityName: "project.mutation",
      exportPath: "./mutation",
      extensionId: "mutation",
      owner: "ISS-018",
    }),
    Object.freeze({
      capabilityName: "project.shadow",
      exportPath: "./shadow",
      extensionId: "shadow",
      owner: "ISS-017",
    }),
  ]);
  if (!Object.isFrozen(firstConsumerExtensions)) fail("extension-table-not-frozen");
  if (JSON.stringify(firstConsumerExtensions) !== JSON.stringify(expectedExtensions))
    fail("extension-table-census");
  for (const row of firstConsumerExtensions) {
    const descriptors = Object.getOwnPropertyDescriptors(row);
    if (
      Object.getPrototypeOf(row) !== Object.prototype ||
      !Object.isFrozen(row) ||
      JSON.stringify(Reflect.ownKeys(descriptors).sort()) !==
        JSON.stringify(["capabilityName", "exportPath", "extensionId", "owner"]) ||
      Reflect.ownKeys(descriptors).some((key) => {
        const descriptor = descriptors[key];
        return !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true;
      })
    )
      fail("extension-row-shape");
  }
  if (
    JSON.stringify(firstConsumerExtensions.map((row) => row.capabilityName)) !==
    JSON.stringify(firstConsumerCapabilityNames)
  )
    fail("extension-capability-projection");
  const placeholderByPath = new Map([
    ["./import", [importExtension, "importExtensionPlaceholder", "ISS-024"]],
    ["./mutation", [mutationExtension, "mutationExtensionPlaceholder", "ISS-018"]],
    ["./shadow", [shadowExtension, "shadowExtensionPlaceholder", "ISS-017"]],
  ]);
  for (const row of firstConsumerExtensions) {
    const expected = placeholderByPath.get(row.exportPath);
    if (!expected || expected[2] !== row.owner) fail("extension-owner-census");
    const target = packageJson.exports[row.exportPath]?.default;
    if (target !== `./src/${row.extensionId}/index.ts`) fail("extension-export-target");
    assertClosedPlaceholder(expected[0], expected[1], row.owner);
  }
  return Object.freeze({ extensions: firstConsumerExtensions.length, outcome: "PASS" });
}

export async function runFirstConsumerFootprintCollisionCheck() {
  const owners = new Set(),
    paths = new Set();
  for (const row of firstConsumerExtensions) {
    const path = `adapters/first-consumer/src/${row.extensionId}/index.ts`;
    if (owners.has(row.owner) || paths.has(path)) fail("extension-footprint-collision");
    owners.add(row.owner);
    paths.add(path);
  }
  if (paths.has("adapters/first-consumer/src/index.ts")) fail("composition-root-collision");
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "first-consumer-collision-"));
  try {
    const baseFiles = await packageSourceCensus();
    const changedPaths = await Promise.all(
      firstConsumerExtensions.map(async (row) => {
        const tree = resolve(temporaryRoot, row.extensionId);
        await cp(sourceRoot, tree, { recursive: true });
        const target = resolve(tree, row.extensionId, "index.ts");
        const before = await readFile(target, "utf8");
        await writeFile(
          target,
          `${before}\nexport const representative${row.extensionId[0].toUpperCase()}${row.extensionId.slice(1)}Patch = Object.freeze({ capabilityName: ${JSON.stringify(row.capabilityName)}, outcome: "REPRESENTATIVE_ONLY" });\n`,
        );
        const observedFiles = await packageSourceCensus(tree);
        if (JSON.stringify(observedFiles) !== JSON.stringify(baseFiles))
          fail("representative-patch-file-census");
        const changed = [];
        for (const file of baseFiles)
          if (
            !(await readFile(resolve(tree, file))).equals(await readFile(resolve(sourceRoot, file)))
          )
            changed.push(`adapters/first-consumer/src/${file}`);
        return changed;
      }),
    );
    const expectedPaths = firstConsumerExtensions.map(
      (row) => `adapters/first-consumer/src/${row.extensionId}/index.ts`,
    );
    if (
      changedPaths.some((changed) => changed.length !== 1) ||
      JSON.stringify(changedPaths.flat().sort()) !== JSON.stringify(expectedPaths.sort())
    )
      fail("representative-patch-collision");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return Object.freeze({ paths: Object.freeze([...paths].sort()), outcome: "PASS" });
}

export async function runFirstConsumerPackageBoundaryCheck() {
  assertBoundaryDetectorFixtures();
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (
    JSON.stringify(packageJson.scripts) !==
    JSON.stringify({
      test: "node ../../scripts/capability-not-implemented.mjs ISS-028 @orchestration-platform/adapter-first-consumer:test",
    })
  )
    fail("package-script-census");
  const sourceFiles = await packageSourceCensus();
  const launcher = await resolvePnpmLauncher();
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "first-consumer-package-"));
  try {
    const { stdout } = await execFileAsync(
      launcher.executable,
      [
        ...launcher.prefixArgs,
        "--filter",
        "@orchestration-platform/adapter-first-consumer",
        "pack",
        "--pack-destination",
        temporaryRoot,
        "--json",
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, npm_config_ignore_scripts: "true" },
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    const packed = parsePackResult(stdout);
    const packedPath = resolve(packed.filename);
    if (!packedPath.startsWith(`${temporaryRoot}${sep}`) || !(await stat(packedPath)).isFile())
      fail("package-tar-path");
    const expectedFiles = ["package.json", ...sourceFiles.map((file) => `src/${file}`)];
    const reportedFiles = packed.files.map(({ path }) => path).sort();
    if (JSON.stringify(reportedFiles) !== JSON.stringify(expectedFiles.sort()))
      fail("package-reported-census");
    const tarballFiles = await readTarballFiles(packedPath);
    if (JSON.stringify([...tarballFiles.keys()].sort()) !== JSON.stringify(expectedFiles.sort()))
      fail("package-tar-census");
    for (const bytes of tarballFiles.values())
      if (containsSensitiveOrLocalText(bytes.toString("utf8"))) fail("package-sensitive-tar-byte");

    const tracked = await execFileAsync(
      "git",
      [
        "ls-files",
        "bootstrap",
        "adapters/self",
        "packages",
        "modules",
        "config/private-compositions.json",
      ],
      { cwd: repositoryRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    for (const file of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
      if (!/\.(?:[cm]?[jt]s|json)$/.test(file)) continue;
      const text = await readFile(resolve(repositoryRoot, file), "utf8");
      if (containsFirstConsumerReference(text)) fail("platform-artifact-input-leak");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return Object.freeze({ outcome: "PASS" });
}

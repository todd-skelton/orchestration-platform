import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitFirstConsumerCompatibility,
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath = resolve(repositoryRoot, "adapters/first-consumer/package.json");
const sourceRoot = resolve(repositoryRoot, "adapters/first-consumer/src");
const sdkPackagePath = resolve(repositoryRoot, "packages/adapter-sdk/package.json");
const enginePackagePath = resolve(repositoryRoot, "packages/engine/package.json");

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

async function packageSourceCensus(directory = sourceRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await packageSourceCensus(path)));
    else if (entry.isFile()) files.push(relative(sourceRoot, path).replaceAll("\\", "/"));
    else fail("package-source-kind");
  }
  return files.sort();
}

export async function runFirstConsumerScaffoldCheck() {
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
    if (
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source) ||
      /gh[pousr]_[A-Za-z0-9]{20,}/.test(source) ||
      /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\s"']+/.test(source)
    )
      fail("package-sensitive-source");
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
  return Object.freeze({ paths: Object.freeze([...paths].sort()), outcome: "PASS" });
}

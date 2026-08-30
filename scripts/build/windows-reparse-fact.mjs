import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const packageRoot = resolve(repositoryRoot, "packages/config");
const manifestPath = resolve(packageRoot, "native/windows-reparse-fact/manifest.json");
const artifactRoot = resolve(repositoryRoot, ".artifacts/native/windows-reparse-fact");
const transientBuildRoot = resolve(artifactRoot, "build-root");
const trackedGyp = resolve(packageRoot, "native/windows-reparse-fact/windows-reparse-fact.gyp");

function closedManifest(value) {
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.join("\0") !==
      [
        "coordinateMembers",
        "identityMembers",
        "productionArtifact",
        "productionSources",
        "schemaVersion",
        "testArtifact",
        "testSources",
      ]
        .sort()
        .join("\0") ||
    value.schemaVersion !== "windows-reparse-fact-build/v2" ||
    JSON.stringify(value.coordinateMembers) !== JSON.stringify(["decimal", "hexadecimal"]) ||
    JSON.stringify(value.identityMembers) !==
      JSON.stringify(["fileId", "nodeDevice", "nodeInode", "volumeSerialNumber"]) ||
    value.productionArtifact !==
      ".artifacts/native/windows-reparse-fact/windows_reparse_fact.node" ||
    value.testArtifact !==
      ".artifacts/native/windows-reparse-fact/windows_reparse_fact_mutants.node" ||
    JSON.stringify(value.productionSources) !==
      JSON.stringify([
        "packages/config/native/windows-reparse-fact/addon.cc",
        "packages/config/native/windows-reparse-fact/observation-core.h",
        "packages/config/native/windows-reparse-fact/windows-reparse-fact.gyp",
      ]) ||
    JSON.stringify(value.testSources) !==
      JSON.stringify(["test/config/native/windows-reparse-fact-mutants.cc"])
  ) {
    return undefined;
  }
  return value;
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function buildWindowsReparseFact() {
  if (process.platform !== "win32") return Object.freeze({ status: "UNSUPPORTED" });
  const manifest = closedManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest === undefined) throw new Error("Windows reparse build manifest refused");
  for (const source of [...manifest.productionSources, ...manifest.testSources]) {
    if (!(await regularFile(resolve(repositoryRoot, source)))) {
      throw new Error("Windows reparse build source census refused");
    }
  }

  const nodeGypCandidates = [
    resolve(dirname(process.execPath), "node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"),
    resolve(
      dirname(process.execPath),
      "../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js",
    ),
  ];
  const nodeGypIndex = (await Promise.all(nodeGypCandidates.map(regularFile))).findIndex(Boolean);
  const nodeGyp = nodeGypCandidates[nodeGypIndex];
  if (nodeGyp === undefined) throw new Error("Node distribution node-gyp refused");
  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(transientBuildRoot, { recursive: true });
  await copyFile(trackedGyp, resolve(transientBuildRoot, "binding.gyp"));
  try {
    await execute(
      process.execPath,
      [
        nodeGyp,
        "rebuild",
        "--directory",
        transientBuildRoot,
        "--",
        `-Dsource_root=${repositoryRoot.replaceAll("\\", "/")}`,
      ],
      {
        cwd: repositoryRoot,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    await copyFile(
      resolve(transientBuildRoot, "out/windows_reparse_fact.node"),
      resolve(repositoryRoot, manifest.productionArtifact),
    );
    await copyFile(
      resolve(transientBuildRoot, "out/windows_reparse_fact_mutants.node"),
      resolve(repositoryRoot, manifest.testArtifact),
    );
  } finally {
    await rm(transientBuildRoot, { force: true, recursive: true });
  }
  if (
    !(await regularFile(resolve(repositoryRoot, manifest.productionArtifact))) ||
    !(await regularFile(resolve(repositoryRoot, manifest.testArtifact)))
  ) {
    throw new Error("Windows reparse build artifact census refused");
  }
  return Object.freeze({ status: "BUILT" });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const result = await buildWindowsReparseFact();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

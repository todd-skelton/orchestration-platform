import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrackedText } from "../../scripts/tracked-text.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(repositoryRoot, "modules/manifest.json");
const outputPath = resolve(repositoryRoot, "modules/.generated/registry.ts");
const emptyRegistry = "export const moduleRegistry = Object.freeze([]) as readonly never[];\n";

if (process.argv.length !== 2) {
  throw new Error("CAPABILITY_NOT_IMPLEMENTED: ISS-011 does not accept module arguments");
}

let manifestSource;
try {
  manifestSource = normalizeTrackedText(await readFile(manifestPath, "utf8"));
} catch {
  throw new Error("CAPABILITY_NOT_IMPLEMENTED: ISS-011 owns malformed module manifests");
}
if (manifestSource !== "[]\n") {
  throw new Error("CAPABILITY_NOT_IMPLEMENTED: ISS-011 owns edited module manifests");
}
const manifest = JSON.parse(manifestSource);
if (!Array.isArray(manifest) || manifest.length !== 0) {
  throw new Error("CAPABILITY_NOT_IMPLEMENTED: ISS-011 owns non-empty module rows");
}

await mkdir(dirname(outputPath), { recursive: true });
try {
  const existing = await readFile(outputPath, "utf8");
  if (existing !== emptyRegistry) {
    throw new Error("CAPABILITY_NOT_IMPLEMENTED: ISS-011 refuses an edited generated stub");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, emptyRegistry, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, outputPath);
} finally {
  await rm(temporaryPath, { force: true });
}

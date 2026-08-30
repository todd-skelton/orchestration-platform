import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWindowsReparseFact } from "../build/windows-reparse-fact.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const artifactRoot = resolve(repositoryRoot, ".artifacts/native/windows-reparse-fact");
const productionArtifact = resolve(artifactRoot, "windows_reparse_fact.node");
const mutantArtifact = resolve(artifactRoot, "windows_reparse_fact_mutants.node");

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export default async function setupWindowsReparseFact() {
  const built = await buildWindowsReparseFact();
  if (process.platform === "win32") {
    if (
      built.status !== "BUILT" ||
      !(await regularFile(productionArtifact)) ||
      !(await regularFile(mutantArtifact))
    ) {
      throw new Error("Windows reparse test artifact census refused");
    }
  } else if (built.status !== "UNSUPPORTED") {
    throw new Error("Windows reparse test platform refusal");
  }

  return async () => {
    await rm(artifactRoot, { force: true, recursive: true });
  };
}

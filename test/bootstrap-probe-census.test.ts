import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  collectWorkspacePackageDirectories,
  packageContract,
} from "../scripts/verify/bootstrap-contracts.mjs";

let root: string;

const authoritativePackageDirectories = packageContract.map(([, path]) => path).sort();

beforeEach(async () => {
  const canonicalTemporaryParent = await realpath(tmpdir());
  root = await realpath(
    await mkdtemp(resolve(canonicalTemporaryParent, "bootstrap-probe-census-")),
  );
  await Promise.all(
    ["packages", "probes", "adapters", "fixtures"].map((path) =>
      mkdir(resolve(root, path), { recursive: true }),
    ),
  );
  await Promise.all(
    authoritativePackageDirectories.map((path) => mkdir(resolve(root, path), { recursive: true })),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("bootstrap probe directory census", () => {
  test("keeps the authoritative package census with the optional source container absent or present", async () => {
    await expect(collectWorkspacePackageDirectories(root)).resolves.toEqual(
      authoritativePackageDirectories,
    );

    await mkdir(resolve(root, "probes/self-host-github/src"), { recursive: true });

    await expect(collectWorkspacePackageDirectories(root)).resolves.toEqual(
      authoritativePackageDirectories,
    );
  });

  test("rejects an unknown probe sibling", async () => {
    await mkdir(resolve(root, "probes/unknown-source"));

    await expect(collectWorkspacePackageDirectories(root)).rejects.toThrow(
      "BOOTSTRAP_CONTRACT_MISMATCH: workspace package path census mismatch",
    );
  });

  test("rejects a missing registered package", async () => {
    await rm(resolve(root, "probes/portable-primitives"), { recursive: true });

    await expect(collectWorkspacePackageDirectories(root)).rejects.toThrow(
      "BOOTSTRAP_CONTRACT_MISMATCH: workspace package path census mismatch",
    );
  });

  test("rejects a package manifest in the approved source container", async () => {
    const sourceContainer = resolve(root, "probes/self-host-github");
    await mkdir(sourceContainer);
    await writeFile(resolve(sourceContainer, "package.json"), "{}\n");

    await expect(collectWorkspacePackageDirectories(root)).rejects.toThrow(
      "BOOTSTRAP_CONTRACT_MISMATCH: probes/self-host-github must remain a manifestless source container",
    );
  });

  test.each(["PACKAGE.JSON", "Package.Json"])(
    "rejects alternate-case package manifest %s in the approved source container",
    async (manifestName) => {
      const sourceContainer = resolve(root, "probes/self-host-github");
      await mkdir(sourceContainer);
      await writeFile(resolve(sourceContainer, manifestName), "{}\n");

      await expect(collectWorkspacePackageDirectories(root)).rejects.toThrow(
        "BOOTSTRAP_CONTRACT_MISMATCH: probes/self-host-github must remain a manifestless source container",
      );
    },
  );
});

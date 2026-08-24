import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, test } from "vitest";
import * as conformance from "../../packages/conformance/src/index.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-bundle-manifest-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "empty"), new Uint8Array());
  await writeFile(resolve(root, "src/a.ts"), "a\n", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stable bundle manifests", () => {
  test("hashes the exact reviewed path census including empty files", async () => {
    const root = await fixture();
    const created = await conformance.createConformanceBundleManifest(
      root,
      ["empty", "src/a.ts"],
      "HARNESS",
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.files).toEqual([
      {
        byteLength: "0",
        path: "empty",
        sha256Digest: conformance.sha256Bytes(new Uint8Array()),
      },
      {
        byteLength: "2",
        path: "src/a.ts",
        sha256Digest: conformance.sha256Bytes(new TextEncoder().encode("a\n")),
      },
    ]);
    expect((await conformance.verifyConformanceBundleManifest(root, created.value)).ok).toBe(true);
  });

  test("refuses changed, missing, moved, symlinked, unsorted, duplicate, and escaping files", async () => {
    const root = await fixture();
    const created = await conformance.createConformanceBundleManifest(
      root,
      ["empty", "src/a.ts"],
      "TEST_BUNDLE",
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await writeFile(resolve(root, "src/a.ts"), "moved\n", "utf8");
    expect((await conformance.verifyConformanceBundleManifest(root, created.value)).ok).toBe(false);
    await rm(resolve(root, "src/a.ts"));
    expect((await conformance.verifyConformanceBundleManifest(root, created.value)).ok).toBe(false);
    await symlink(resolve(root, "empty"), resolve(root, "src/a.ts"), "file");
    expect((await conformance.verifyConformanceBundleManifest(root, created.value)).ok).toBe(false);
    for (const paths of [["src/a.ts", "empty"], ["empty", "empty"], ["../escape"], ["C:/escape"]])
      expect((await conformance.createConformanceBundleManifest(root, paths, "HARNESS")).ok).toBe(
        false,
      );
  });

  test("refuses a regular file reached through a symlinked directory", async () => {
    const root = await fixture();
    const outside = await mkdtemp(resolve(tmpdir(), "orchestration-bundle-outside-"));
    roots.push(outside);
    await writeFile(resolve(outside, "a.ts"), "outside\n", "utf8");
    await symlink(outside, resolve(root, "linked"), "junction");
    expect(
      (await conformance.createConformanceBundleManifest(root, ["linked/a.ts"], "HARNESS")).ok,
    ).toBe(false);
  });

  test("accepts ordinary mutable, sealed, and frozen path arrays", async () => {
    const root = await fixture();
    for (const paths of [
      ["empty", "src/a.ts"],
      Object.seal(["empty", "src/a.ts"]),
      Object.freeze(["empty", "src/a.ts"]),
    ])
      expect((await conformance.createConformanceBundleManifest(root, paths, "HARNESS")).ok).toBe(
        true,
      );
  });

  test("refuses hostile path arrays without invoking accessors", async () => {
    const root = await fixture();
    const extra = ["empty", "src/a.ts"];
    Object.defineProperty(extra, "candidate", { value: true });
    const symbolic = ["empty", "src/a.ts"];
    Object.defineProperty(symbolic, Symbol("candidate"), { value: true });
    let getterCalls = 0;
    const accessor = ["empty", "src/a.ts"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "empty";
      },
    });
    const crossRealm = vm.runInNewContext('["empty","src/a.ts"]') as string[];
    for (const paths of [extra, symbolic, accessor, new Proxy(["empty"], {}), crossRealm])
      expect((await conformance.createConformanceBundleManifest(root, paths, "HARNESS")).ok).toBe(
        false,
      );
    expect(getterCalls).toBe(0);
  });
});

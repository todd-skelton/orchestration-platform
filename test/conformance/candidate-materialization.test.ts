import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as conformance from "../../packages/conformance/src/index.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "orchestration-candidate-materialization-"));
  roots.push(value);
  return value;
}

async function fixture() {
  const value = await root();
  const outputParent = await root();
  await mkdir(resolve(value, "src"));
  await writeFile(resolve(value, "empty"), new Uint8Array());
  await writeFile(resolve(value, "src/a.ts"), "a\n", "utf8");
  const subject = Object.freeze({
    files: Object.freeze([
      Object.freeze({
        byteLength: "0",
        executable: false,
        path: "empty",
        sha256Digest: conformance.sha256Bytes(new Uint8Array()),
      }),
      Object.freeze({
        byteLength: "2",
        executable: false,
        path: "src/a.ts",
        sha256Digest: conformance.sha256Bytes(new TextEncoder().encode("a\n")),
      }),
    ]),
    schemaVersion: "conformance-candidate-subject/v1",
  });
  return { outputParent, root: value, subject };
}

async function consume(
  input: Awaited<ReturnType<typeof fixture>>,
  consumer: conformance.StableCandidateConsumer = async () => {},
) {
  return await conformance.consumeConformanceCandidateMaterialization(
    input.root,
    input.outputParent,
    input.subject,
    consumer,
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

describe("candidate subject filesystem materialization", () => {
  test("keeps opened-byte helpers behind the scoped public operation", () => {
    expect(conformance).not.toHaveProperty("readConformanceBundleFile");
    expect(conformance).not.toHaveProperty("readConformanceBundleFileRow");
  });

  test("scopes a complete stable-owned snapshot to its stable consumer", async () => {
    const input = await fixture();
    let materializedRoot = "";
    let consumedBytes = "";
    const result = await consume(input, async (root, subject) => {
      materializedRoot = root;
      expect(subject).toEqual(input.subject);
      await writeFile(resolve(input.root, "src/a.ts"), "changed after copy\n", "utf8");
      consumedBytes = await readFile(resolve(root, "src/a.ts"), "utf8");
    });
    expect(result).toEqual({ ok: true, subject: input.subject });
    expect(consumedBytes).toBe("a\n");
    await expect(lstat(materializedRoot)).rejects.toThrow();
    expect(result).not.toHaveProperty("materializedRoot");
  });

  test("refuses missing, extra, changed, final-link, and parent-link bytes", async () => {
    const missing = await fixture();
    await rm(resolve(missing.root, "empty"));
    expect((await consume(missing)).ok).toBe(false);

    const extra = await fixture();
    await writeFile(resolve(extra.root, "extra"), "extra", "utf8");
    expect((await consume(extra)).ok).toBe(false);

    const changed = await fixture();
    await writeFile(resolve(changed.root, "src/a.ts"), "b\n", "utf8");
    expect((await consume(changed)).ok).toBe(false);

    const finalLink = await fixture();
    await rm(resolve(finalLink.root, "src/a.ts"));
    await symlink(resolve(finalLink.root, "empty"), resolve(finalLink.root, "src/a.ts"), "file");
    expect((await consume(finalLink)).ok).toBe(false);

    const parentLink = await fixture();
    const outside = await root();
    await writeFile(resolve(outside, "a.ts"), "a\n", "utf8");
    await rm(resolve(parentLink.root, "src"), { recursive: true });
    await symlink(outside, resolve(parentLink.root, "src"), "junction");
    expect((await consume(parentLink)).ok).toBe(false);
  });

  test("refuses linked, nested, and source-containing roots", async () => {
    const input = await fixture();
    const container = await root();
    const linkedRoot = resolve(container, "candidate");
    const linkedOutput = resolve(container, "output");
    await symlink(input.root, linkedRoot, "junction");
    await symlink(input.outputParent, linkedOutput, "junction");
    expect(
      (
        await conformance.consumeConformanceCandidateMaterialization(
          linkedRoot,
          input.outputParent,
          input.subject,
          async () => {},
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await conformance.consumeConformanceCandidateMaterialization(
          input.root,
          linkedOutput,
          input.subject,
          async () => {},
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await conformance.consumeConformanceCandidateMaterialization(
          input.root,
          resolve(input.root, "src"),
          input.subject,
          async () => {},
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await conformance.consumeConformanceCandidateMaterialization(
          input.root,
          resolve(input.root, ".."),
          input.subject,
          async () => {},
        )
      ).ok,
    ).toBe(false);
  });

  test("refuses malformed subjects and missing stable consumers without throwing", async () => {
    const input = await fixture();
    await expect(
      conformance.consumeConformanceCandidateMaterialization(
        input.root,
        input.outputParent,
        null,
        async () => {},
      ),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      conformance.consumeConformanceCandidateMaterialization(
        input.root,
        input.outputParent,
        input.subject,
        null as never,
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  test("deletes the scoped root after a consumer refusal or mutation", async () => {
    const thrown = await fixture();
    let thrownRoot = "";
    const thrownResult = await consume(thrown, async (root) => {
      thrownRoot = root;
      throw new Error("consumer refused");
    });
    expect(thrownResult.ok).toBe(false);
    await expect(lstat(thrownRoot)).rejects.toThrow();

    const mutated = await fixture();
    let mutatedRoot = "";
    const mutatedResult = await consume(mutated, async (root) => {
      mutatedRoot = root;
      await writeFile(resolve(root, "src/a.ts"), "mutated by consumer\n", "utf8");
    });
    expect(mutatedResult.ok).toBe(false);
    await expect(lstat(mutatedRoot)).rejects.toThrow();
  });

  test("cleanup failure is a refusal and never returns the scoped root", async () => {
    const input = await fixture();
    let materializedRoot = "";
    const result = await consume(input, async (root) => {
      materializedRoot = root;
      await writeFile(resolve(root, "untracked"), "not owned by cleanup", "utf8");
    });
    expect(result).toEqual({ issues: ["candidate-root:cleanup-refused"], ok: false });
    expect(result).not.toHaveProperty("materializedRoot");
  });
});

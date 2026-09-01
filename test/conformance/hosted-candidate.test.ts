import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { withHostedCandidateSource } from "../../scripts/conformance/hosted-candidate.mjs";
import {
  loadHostedCandidateSnapshot,
  type HostedCandidateSnapshot,
} from "../../scripts/conformance/hosted-plan.mjs";
import { createPhaseWatchdog } from "../support/phase-watchdog.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const stableRoot = resolve(import.meta.dirname, "../..");
const phases = createPhaseWatchdog("hosted-candidate");

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await phases.within(`root.create:${prefix}`, () =>
    mkdtemp(resolve(tmpdir(), prefix)),
  );
  roots.push(root);
  return root;
}

async function candidateRepository(): Promise<{
  readonly revision: string;
  readonly root: string;
}> {
  const root = await temporaryRoot("orchestration-hosted-candidate-repository-");
  await phases.within("git.init", () => execFileAsync("git", ["init", "--quiet", root]));
  await phases.within("fixture.materialize", async () => {
    await mkdir(resolve(root, "nested"));
    await writeFile(resolve(root, "nested/data.txt"), Uint8Array.from([0, 10, 13, 255]));
    await writeFile(resolve(root, "runner.sh"), "#!/bin/sh\nprintf raw\n", "utf8");
    await chmod(resolve(root, "runner.sh"), 0o755);
  });
  await phases.within("git.add", () => execFileAsync("git", ["-C", root, "add", "."]));
  await phases.within("git.update-index", () =>
    execFileAsync("git", ["-C", root, "update-index", "--chmod=+x", "runner.sh"]),
  );
  await phases.within("git.commit", () =>
    execFileAsync("git", [
      "-C",
      root,
      "-c",
      "user.name=Conformance Test",
      "-c",
      "user.email=conformance@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "candidate",
    ]),
  );
  const revision = await phases.within("git.rev-parse", async () =>
    (
      await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })
    ).stdout.trim(),
  );
  return { revision, root };
}

beforeEach((context) => phases.start(context.task.name));
afterEach(async () => {
  phases.mark("afterEach.cleanup:start");
  try {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    phases.mark("afterEach.cleanup:complete");
  } finally {
    phases.finish();
  }
});

describe("hosted raw Git candidate source", () => {
  test("reconstructs exact authenticated blobs under an external parent and removes the root", async () => {
    const candidate = await candidateRepository();
    const externalParent = await temporaryRoot("orchestration-hosted-source-parent-");
    const loaded = await phases.within("snapshot.load", () =>
      loadHostedCandidateSnapshot(candidate.root, candidate.revision),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.files.map((file) => [file.path, file.executable])).toEqual([
      ["nested/data.txt", false],
      ["runner.sh", true],
    ]);
    await writeFile(resolve(candidate.root, "nested/data.txt"), "checkout mutation", "utf8");
    let sourceRoot = "";
    const consumed = await phases.within("source.materialize-readback-cleanup", () =>
      withHostedCandidateSource(loaded.value, externalParent, stableRoot, async (root, subject) =>
        phases.within("consumer.callback", async () => {
          sourceRoot = root;
          expect(subject).toEqual(loaded.value.subject);
          expect([...(await readFile(resolve(root, "nested/data.txt")))]).toEqual([0, 10, 13, 255]);
          expect(await readFile(resolve(root, "runner.sh"), "utf8")).toBe(
            "#!/bin/sh\nprintf raw\n",
          );
          return "consumed";
        }),
      ),
    );
    phases.mark("source.cleanup:readback");
    expect(consumed).toEqual({ ok: true, value: "consumed" });
    await expect(readFile(resolve(sourceRoot, "runner.sh"))).rejects.toThrow();
    expect(await readdir(externalParent)).toEqual([]);
    expect((await loadHostedCandidateSnapshot(candidate.root, candidate.revision)).ok).toBe(false);
  });

  test("refuses changed snapshot bytes and overlapping roots before consumer invocation", async () => {
    const candidate = await candidateRepository();
    const externalParent = await temporaryRoot("orchestration-hosted-source-refusal-");
    const loaded = await phases.within("snapshot.load", () =>
      loadHostedCandidateSnapshot(candidate.root, candidate.revision),
    );
    if (!loaded.ok) throw new Error(loaded.issues.join(","));
    const tampered: HostedCandidateSnapshot = {
      ...loaded.value,
      files: [
        { ...loaded.value.files[0]!, bytes: Uint8Array.from([1]) },
        ...loaded.value.files.slice(1),
      ],
    };
    let calls = 0;
    expect(
      (
        await withHostedCandidateSource(tampered, externalParent, stableRoot, async () => {
          calls += 1;
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await withHostedCandidateSource(loaded.value, externalParent, externalParent, async () => {
          calls += 1;
        })
      ).ok,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(await readdir(externalParent)).toEqual([]);
  });

  test("removes the reconstructed root when the stable consumer fails", async () => {
    const candidate = await candidateRepository();
    const externalParent = await temporaryRoot("orchestration-hosted-source-cleanup-");
    const loaded = await phases.within("snapshot.load", () =>
      loadHostedCandidateSnapshot(candidate.root, candidate.revision),
    );
    if (!loaded.ok) throw new Error(loaded.issues.join(","));
    const result = await phases.within("source.materialize-readback-cleanup", () =>
      withHostedCandidateSource(loaded.value, externalParent, stableRoot, async () => {
        phases.mark("consumer.callback:start");
        throw new Error("injected stable consumer failure");
      }),
    );
    expect(result).toEqual({ issues: ["candidate-source:consumer-failed"], ok: false });
    expect(await readdir(externalParent)).toEqual([]);
  });
});

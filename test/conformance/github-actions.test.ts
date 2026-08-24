import { describe, expect, test } from "vitest";
import * as core from "../../packages/conformance/src/index.js";
import * as github from "../../packages/conformance/src/github-actions/index.js";

const d = (value: string): string => value.repeat(64);
const revision = (value: string): string => value.repeat(40);

const protection = Object.freeze({
  bypassActorCount: "0",
  deletionBlocked: true,
  enforcement: "ACTIVE",
  nonFastForwardBlocked: true,
  pullRequestRequired: true,
  schemaVersion: "github-conformance-protection-snapshot/v1",
  targetRef: "refs/heads/main",
});

const providerRun = Object.freeze({
  candidateRevision: revision("a"),
  candidateSubjectDigest: d("1"),
  event: "repository_dispatch",
  harnessBundleDigest: d("2"),
  protectionSnapshotDigest: github.computeGithubConformanceProtectionDigest(protection),
  repositoryId: "123456",
  requiredJobRegistryDigest: d("3"),
  runAttempt: "2",
  runId: "789012",
  testBundleDigest: d("4"),
  workflowPath: ".github/workflows/conformance.yml",
  workflowRef:
    "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
  workflowRevision: revision("b"),
});

describe("GitHub Actions conformance adapter", () => {
  test("keeps provider exports out of the portable core entrypoint", () => {
    expect(Object.keys(core).some((name) => /github|protection/i.test(name))).toBe(false);
    expect(Object.keys(github)).toContain("computeGithubProviderRunDigest");
  });

  test("closes the accepted zero-bypass protection projection", () => {
    expect(github.parseGithubConformanceProtectionSnapshot(protection).ok).toBe(true);
    expect(github.computeGithubConformanceProtectionDigest(protection)).toBe(
      "f58515790fb89e46233ead35721e08a67562fd30fcd43ae9e49fcce13874653d",
    );
    for (const mutation of [
      { ...protection, bypassActorCount: "1" },
      { ...protection, deletionBlocked: false },
      { ...protection, enforcement: "DISABLED" },
      { ...protection, nonFastForwardBlocked: false },
      { ...protection, pullRequestRequired: false },
      { ...protection, targetRef: "refs/heads/candidate" },
      { ...protection, extra: true },
    ])
      expect(github.parseGithubConformanceProtectionSnapshot(mutation).ok).toBe(false);
  });

  test("pins the provider-run join order and rejects ambient authority", () => {
    expect(github.parseGithubProviderRunContext(providerRun).ok).toBe(true);
    expect(github.computeGithubProviderRunDigest(providerRun)).toBe(
      "dcbf1a1a7c354bff3c14a2d9a590f10ee2a52ece684b0878486ef0c32f888359",
    );
    expect(
      github.parseGithubProviderRunContext({ ...providerRun, triggeringActorId: "9" }).ok,
    ).toBe(false);
    for (const mutation of [
      { ...providerRun, candidateRevision: "refs/heads/main" },
      { ...providerRun, event: "push" },
      { ...providerRun, repositoryId: "0" },
      { ...providerRun, runAttempt: "02" },
      { ...providerRun, workflowPath: ".github/workflows/bootstrap.yml" },
      { ...providerRun, workflowRef: `${providerRun.workflowRef}@candidate` },
      { ...providerRun, workflowRevision: revision("A") },
    ])
      expect(github.parseGithubProviderRunContext(mutation).ok).toBe(false);
  });

  test("projects only complete regular Git trees into the portable subject", () => {
    const projected = github.projectGithubCandidateSubject({
      entries: [
        { bytes: new TextEncoder().encode("b"), mode: "100755", path: "bin/b", type: "blob" },
        { bytes: new TextEncoder().encode("a"), mode: "100644", path: "a", type: "blob" },
      ],
      truncated: false,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.value).toEqual({
      files: [
        {
          byteLength: "1",
          executable: false,
          path: "a",
          sha256Digest: core.sha256Bytes(new TextEncoder().encode("a")),
        },
        {
          byteLength: "1",
          executable: true,
          path: "bin/b",
          sha256Digest: core.sha256Bytes(new TextEncoder().encode("b")),
        },
      ],
      schemaVersion: "conformance-candidate-subject/v1",
    });
    expect(projected.digest).toBe(
      core.computeConformanceRecordDigest("conformance-candidate-subject/v1", projected.value),
    );
  });

  test("refuses truncated, non-blob, nonportable, reflective, and alternate-mode trees", () => {
    const entry = {
      bytes: new Uint8Array(),
      mode: "100644",
      path: "file",
      type: "blob",
    };
    for (const input of [
      { entries: [entry], truncated: true },
      { entries: [{ ...entry, type: "tree" }], truncated: false },
      { entries: [{ ...entry, mode: "120000" }], truncated: false },
      { entries: [{ ...entry, mode: "160000" }], truncated: false },
      { entries: [{ ...entry, path: "../escape" }], truncated: false },
      { entries: [{ ...entry, extra: true }], truncated: false },
      { entries: [entry], truncated: false, extra: true },
      new Proxy({ entries: [entry], truncated: false }, {}),
    ])
      expect(github.projectGithubCandidateSubject(input).ok).toBe(false);
    const entries = [entry];
    Object.defineProperty(entries, Symbol.iterator, { value: () => [][Symbol.iterator]() });
    expect(github.projectGithubCandidateSubject({ entries, truncated: false }).ok).toBe(false);
  });

  test("is total for hostile provider values", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], hostile]) {
      expect(() => github.parseGithubConformanceProtectionSnapshot(input)).not.toThrow();
      expect(() => github.parseGithubProviderRunContext(input)).not.toThrow();
      expect(() => github.projectGithubCandidateSubject(input)).not.toThrow();
    }
  });
});

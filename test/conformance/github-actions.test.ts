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
const protectedRef = Object.freeze({
  refProtected: true,
  schemaVersion: "github-conformance-protected-ref/v1",
  targetRef: "refs/heads/main",
});

const providerRun = Object.freeze({
  candidateRevision: revision("a"),
  candidateSubjectDigest: d("1"),
  event: "repository_dispatch",
  harnessBundleDigest: d("2"),
  protectedRefDigest: github.computeGithubConformanceProtectedRefDigest(protectedRef),
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

const registry = Object.freeze({
  jobs: Object.freeze(
    ["linux", "macos", "windows"].map((environment) =>
      Object.freeze({
        environmentFamily: environment.toUpperCase(),
        jobId: `iss002-contracts-${environment}`,
        requirement: "REQUIRED",
        suiteId: "iss002-contracts",
      }),
    ),
  ),
  schemaVersion: "conformance-required-job-registry/v1",
  suites: Object.freeze([
    Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "iss002-contracts",
      vectorCensusDigest: d("5"),
      walkRequirement: "WALK_1000",
    }),
  ]),
});
const registryDigest = core.computeConformanceRecordDigest(
  "conformance-required-job-registry/v1",
  registry,
);
const providerRecordRun = Object.freeze({
  ...providerRun,
  requiredJobRegistryDigest: registryDigest,
});
const recordedAt = "2026-08-23T12:00:00.000Z";
const expiresAt = core.addCompleteDays(recordedAt, 30);
const artifactPrefix = `conformance-${providerRecordRun.runId}-${providerRecordRun.runAttempt}-`;
const providerRecord = Object.freeze({
  aggregateDigest: d("6"),
  artifacts: Object.freeze(
    ["aggregate", ...registry.jobs.map((job) => job.jobId)]
      .map((logicalJobId, index) =>
        Object.freeze({
          artifactDigest: String(index + 6).repeat(64),
          artifactId: String(index + 10),
          artifactName: `${artifactPrefix}${logicalJobId}`,
          byteLength: String(index + 100),
          expiresAt,
          logicalJobId,
          role: logicalJobId === "aggregate" ? "AGGREGATE" : "OBSERVATION",
        }),
      )
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.artifactName), Buffer.from(right.artifactName)),
      ),
  ),
  candidateRevision: providerRecordRun.candidateRevision,
  candidateSubjectDigest: providerRecordRun.candidateSubjectDigest,
  event: providerRecordRun.event,
  harnessBundleDigest: providerRecordRun.harnessBundleDigest,
  jobs: Object.freeze(
    [
      { logicalJobId: "aggregate", providerJobName: "Conformance / aggregate", role: "AGGREGATE" },
      ...registry.jobs.map((job) => ({
        logicalJobId: job.jobId,
        providerJobName: `Conformance / observation / ${job.jobId}`,
        role: "OBSERVATION",
      })),
      { logicalJobId: "plan", providerJobName: "Conformance / plan", role: "PLAN" },
    ]
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.logicalJobId), Buffer.from(right.logicalJobId)),
      )
      .map((job, index) =>
        Object.freeze({
          conclusion: "SUCCESS",
          ...job,
          providerJobId: String(index + 20),
        }),
      ),
  ),
  protectedRefDigest: providerRecordRun.protectedRefDigest,
  recordedAt,
  repositoryId: providerRecordRun.repositoryId,
  requiredJobRegistryDigest: providerRecordRun.requiredJobRegistryDigest,
  runAttempt: providerRecordRun.runAttempt,
  runId: providerRecordRun.runId,
  schemaVersion: "github-conformance-provisional-provider-record/v1",
  testBundleDigest: providerRecordRun.testBundleDigest,
  workflowPath: providerRecordRun.workflowPath,
  workflowRef: providerRecordRun.workflowRef,
  workflowRevision: providerRecordRun.workflowRevision,
});
const { aggregateDigest: _aggregateDigest, ...providerRecordWithoutAggregate } = providerRecord;
const diagnosticProviderRecord = Object.freeze({
  ...providerRecordWithoutAggregate,
  jobs: Object.freeze(
    providerRecord.jobs.map((job) =>
      job.logicalJobId === "aggregate" ? Object.freeze({ ...job, conclusion: "FAILURE" }) : job,
    ),
  ),
  missingArtifactNames: Object.freeze([]),
  missingLogicalJobIds: Object.freeze([]),
  schemaVersion: "github-conformance-diagnostic-provider-record/v1",
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

  test("keeps the direct protected-ref marker distinct from the full policy snapshot", () => {
    expect(github.parseGithubConformanceProtectedRef(protectedRef).ok).toBe(true);
    expect(github.computeGithubConformanceProtectedRefDigest(protectedRef)).not.toBe(
      github.computeGithubConformanceProtectionDigest(protection),
    );
    for (const mutation of [
      { ...protectedRef, refProtected: false },
      { ...protectedRef, targetRef: "refs/heads/candidate" },
      { ...protectedRef, extra: true },
    ])
      expect(github.parseGithubConformanceProtectedRef(mutation).ok).toBe(false);
  });

  test("pins the provider-run join order and rejects ambient authority", () => {
    expect(github.parseGithubProviderRunContext(providerRun).ok).toBe(true);
    expect(github.computeGithubProviderRunDigest(providerRun)).toBe(
      "a8aad6f17514ab59aed88929abce3366e466eb7f5323cf2141aa15641ab62520",
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

  test("closes the provider record and joins the exact stable registry census", () => {
    expect(github.parseGithubConformanceProviderRecord(providerRecord).ok).toBe(true);
    expect(
      github.validateGithubConformanceProviderRecord(providerRecord, {
        aggregateDigest: providerRecord.aggregateDigest,
        providerRun: providerRecordRun,
        registry,
      }).ok,
    ).toBe(true);
    expect(github.computeGithubConformanceProviderRecordDigest(providerRecord)).toBe(
      "475f4d0f47403abc7100aac40da9f793680382ebdbbb996df8abd4131e49a262",
    );
    expect(
      github.validateGithubConformanceProviderRecord(
        { ...providerRecord, aggregateDigest: d("9") },
        {
          aggregateDigest: providerRecord.aggregateDigest,
          providerRun: providerRecordRun,
          registry,
        },
      ).ok,
    ).toBe(false);
  });

  test("closes diagnostic provider subsets, complements, and non-success evidence", () => {
    expect(github.parseGithubConformanceDiagnosticProviderRecord(diagnosticProviderRecord).ok).toBe(
      true,
    );
    expect(
      github.validateGithubConformanceDiagnosticProviderRecord(diagnosticProviderRecord, {
        providerRun: providerRecordRun,
        registry,
      }).ok,
    ).toBe(true);
    expect(
      github.computeGithubConformanceDiagnosticProviderRecordDigest(diagnosticProviderRecord),
    ).toMatch(/^[0-9a-f]{64}$/);
    for (const mutation of [
      { ...diagnosticProviderRecord, aggregateDigest: d("6") },
      { ...diagnosticProviderRecord, jobs: providerRecord.jobs },
      { ...diagnosticProviderRecord, missingArtifactNames: ["fixed"] },
      { ...diagnosticProviderRecord, missingLogicalJobIds: ["aggregate"] },
      {
        ...diagnosticProviderRecord,
        jobs: diagnosticProviderRecord.jobs.map((job) =>
          job.logicalJobId === "aggregate" ? { ...job, conclusion: "UNKNOWN" } : job,
        ),
      },
    ])
      expect(
        github.validateGithubConformanceDiagnosticProviderRecord(mutation, {
          providerRun: providerRecordRun,
          registry,
        }).ok,
      ).toBe(false);
  });

  test("refuses provider record census, naming, retention, and context substitutions", () => {
    const firstArtifact = providerRecord.artifacts[0]!;
    const firstJob = providerRecord.jobs[0]!;
    for (const [index, mutation] of [
      {
        ...providerRecord,
        artifacts: [
          { ...firstArtifact, artifactName: "fixed-name" },
          ...providerRecord.artifacts.slice(1),
        ],
      },
      {
        ...providerRecord,
        artifacts: [
          { ...firstArtifact, expiresAt: recordedAt },
          ...providerRecord.artifacts.slice(1),
        ],
      },
      {
        ...providerRecord,
        jobs: [{ ...firstJob, conclusion: "FAILURE" }, ...providerRecord.jobs.slice(1)],
      },
      {
        ...providerRecord,
        jobs: [
          firstJob,
          { ...providerRecord.jobs[1], providerJobId: firstJob.providerJobId },
          ...providerRecord.jobs.slice(2),
        ],
      },
      {
        ...providerRecord,
        artifacts: [
          firstArtifact,
          { ...providerRecord.artifacts[1], artifactId: firstArtifact.artifactId },
          ...providerRecord.artifacts.slice(2),
        ],
      },
      { ...providerRecord, event: "push" },
      { ...providerRecord, recordedAt: "2026-08-23T12:00:00Z" },
      { ...providerRecord, recordedAt: "9999-12-31T23:59:59.999Z" },
      { ...providerRecord, triggeringActorId: "9" },
    ].entries())
      expect(github.parseGithubConformanceProviderRecord(mutation).ok, String(index)).toBe(false);
    for (const mutation of [
      { ...providerRecord, artifacts: providerRecord.artifacts.slice(1) },
      { ...providerRecord, jobs: providerRecord.jobs.slice(1) },
    ])
      expect(
        github.validateGithubConformanceProviderRecord(mutation, {
          aggregateDigest: providerRecord.aggregateDigest,
          providerRun: providerRecordRun,
          registry,
        }).ok,
      ).toBe(false);
    expect(
      github.validateGithubConformanceProviderRecord(providerRecord, {
        aggregateDigest: providerRecord.aggregateDigest,
        providerRun: { ...providerRecordRun, runAttempt: "3" },
        registry,
      }).ok,
    ).toBe(false);
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
      expect(() => github.parseGithubConformanceProviderRecord(input)).not.toThrow();
      expect(() => github.projectGithubCandidateSubject(input)).not.toThrow();
    }
  });
});

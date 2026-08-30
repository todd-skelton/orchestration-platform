import { describe, expect, test } from "vitest";
import * as core from "../../packages/conformance/src/index.js";
import * as github from "../../packages/conformance/src/github-actions/index.js";
import {
  canonicalGithubDateHeader,
  readGithubHostedArtifactCensus,
  readGithubHostedArtifacts,
  readGithubHostedJobCensus,
  readGithubHostedJobs,
  type GithubFetch,
} from "../../scripts/conformance/hosted-record-api.mjs";

const d = (value: string): string => value.repeat(64);
const revision = (value: string): string => value.repeat(40);
const registry = Object.freeze({
  jobs: Object.freeze([
    Object.freeze({
      environmentFamily: "LINUX",
      jobId: "iss002-contracts-linux",
      requirement: "REQUIRED",
      suiteId: "iss002-contracts",
    }),
  ]),
  schemaVersion: "conformance-required-job-registry/v1",
  suites: Object.freeze([
    Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "iss002-contracts",
      vectorCensusDigest: d("1"),
      walkRequirement: "WALK_1000",
    }),
  ]),
});
const providerRun = Object.freeze({
  candidateRevision: revision("a"),
  candidateSubjectDigest: d("2"),
  event: "repository_dispatch",
  harnessBundleDigest: d("3"),
  protectedRefDigest: d("4"),
  repositoryId: "123",
  requiredJobRegistryDigest: core.computeConformanceRecordDigest(
    "conformance-required-job-registry/v1",
    registry,
  ),
  runAttempt: "2",
  runId: "456",
  testBundleDigest: d("5"),
  workflowPath: ".github/workflows/conformance.yml",
  workflowRef:
    "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
  workflowRevision: revision("b"),
});
const context = Object.freeze({
  ...providerRun,
  contractVersionsDigest: d("6"),
  providerRunDigest: github.computeGithubProviderRunDigest(providerRun),
  repository: "todd-skelton/orchestration-platform",
  schemaVersion: "hosted-conformance-plan-context/v1",
  vectorCensusDigest: d("7"),
});
const date = "Thu, 27 Aug 2026 12:00:00 GMT";

function responseJson(value: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", ...headers },
    status: 200,
  });
}

function job(name: string, id: number) {
  const record = name === "record";
  return Object.freeze({
    conclusion: record ? null : "success",
    head_sha: context.workflowRevision,
    id,
    name,
    run_attempt: 2,
    run_id: 456,
    status: record ? "in_progress" : "completed",
    workflow_name: "Conformance",
  });
}
const jobs = Object.freeze([
  job("plan", 10),
  job("observation / iss002-contracts-linux", 11),
  job("aggregate", 12),
  job("record", 13),
]);

function jobsFetch(rows: readonly unknown[], dateHeader = date): GithubFetch {
  return async () => responseJson({ jobs: rows, total_count: rows.length }, { date: dateHeader });
}

const prefix = `conformance-${context.runId}-${context.runAttempt}-`;
function artifact(name: string, id: number) {
  return Object.freeze({
    archive_download_url: `https://api.github.com/repos/${context.repository}/actions/artifacts/${id}/zip`,
    digest: `sha256:${id === 20 ? d("8") : d("9")}`,
    expired: false,
    expires_at: "2026-09-27T12:00:00Z",
    id,
    name,
    size_in_bytes: id,
    workflow_run: Object.freeze({
      head_sha: context.workflowRevision,
      id: 456,
      repository_id: 123,
    }),
  });
}
const artifacts = Object.freeze([
  artifact(`${prefix}aggregate`, 20),
  artifact(`${prefix}iss002-contracts-linux`, 21),
]);

function artifactsFetch(rows: readonly unknown[]): GithubFetch {
  return async (url) => {
    if (url.includes("/artifacts?"))
      return responseJson({ artifacts: rows, total_count: rows.length });
    const id = url.endsWith("/20/zip") ? 20 : 21;
    return new Response(Uint8Array.from([id]), { status: 200 });
  };
}

describe("hosted provider API projection", () => {
  test("projects the exact current-attempt job census and provider Date", async () => {
    const result = await readGithubHostedJobs({
      context,
      fetcher: jobsFetch(jobs),
      registry,
      token: "token",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        jobs: [
          {
            conclusion: "SUCCESS",
            providerJobId: "10",
            providerJobName: "Conformance / plan",
          },
          {
            conclusion: "SUCCESS",
            providerJobId: "11",
            providerJobName: "Conformance / observation / iss002-contracts-linux",
          },
          {
            conclusion: "SUCCESS",
            providerJobId: "12",
            providerJobName: "Conformance / aggregate",
          },
        ],
        recordedAt: "2026-08-27T12:00:00.000Z",
      },
    });
  });

  test("requires one in-progress record job and exact workflow/revision association", async () => {
    for (const rows of [
      jobs.slice(0, -1),
      jobs.map((row) => (row.name === "record" ? { ...row, status: "completed" } : row)),
      jobs.map((row) => (row.name === "plan" ? { ...row, workflow_name: "bootstrap" } : row)),
      jobs.map((row) => (row.name === "aggregate" ? { ...row, head_sha: revision("c") } : row)),
      [...jobs, job("extra", 14)],
    ]) {
      const result = await readGithubHostedJobs({
        context,
        fetcher: jobsFetch(rows),
        registry,
        token: "token",
      });
      expect(result.ok).toBe(false);
    }
    expect(
      (
        await readGithubHostedJobs({
          context,
          fetcher: jobsFetch(jobs, "2026-08-27T12:00:00Z"),
          registry,
          token: "token",
        })
      ).ok,
    ).toBe(false);
  });

  test("preserves terminal diagnostic conclusions and exact missing complements", async () => {
    const failed = jobs.map((row) =>
      row.name === "aggregate" ? { ...row, conclusion: "failure" } : row,
    );
    const jobResult = await readGithubHostedJobCensus({
      context,
      fetcher: jobsFetch(failed),
      registry,
      token: "token",
    });
    expect(jobResult.ok).toBe(true);
    if (!jobResult.ok) throw new Error(jobResult.issues.join(","));
    expect(jobResult.value.jobs.find((row) => row.providerJobId === "12")?.conclusion).toBe(
      "FAILURE",
    );
    expect(jobResult.value.missingLogicalJobIds).toEqual([]);

    const artifactResult = await readGithubHostedArtifactCensus({
      context,
      fetcher: artifactsFetch(artifacts.slice(1)),
      registry,
      token: "token",
    });
    expect(artifactResult.ok).toBe(true);
    if (!artifactResult.ok) throw new Error(artifactResult.issues.join(","));
    expect(artifactResult.value.missingArtifactNames).toEqual([`${prefix}aggregate`]);
  });

  test("projects and downloads only the attempt-qualified artifact census", async () => {
    const result = await readGithubHostedArtifacts({
      context,
      fetcher: artifactsFetch(artifacts),
      registry,
      token: "token",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((row) => [row.artifactName, [...row.archiveBytes]])).toEqual([
      [`${prefix}aggregate`, [20]],
      [`${prefix}iss002-contracts-linux`, [21]],
    ]);
    expect(result.value.every((row) => row.expiresAt === "2026-09-27T12:00:00.000Z")).toBe(true);
  });

  test("refuses missing, duplicate, expired, wrong-run, and malformed artifact evidence", async () => {
    const mutations = [
      artifacts.slice(1),
      [artifacts[0], artifacts[0]],
      [{ ...artifacts[0], expired: true }, artifacts[1]],
      [
        {
          ...artifacts[0],
          workflow_run: { ...artifacts[0]!.workflow_run, repository_id: 124 },
        },
        artifacts[1],
      ],
      [{ ...artifacts[0], digest: d("8") }, artifacts[1]],
      [...artifacts, artifact(`${prefix}extra`, 22)],
    ];
    for (const rows of mutations) {
      const result = await readGithubHostedArtifacts({
        context,
        fetcher: artifactsFetch(rows),
        registry,
        token: "token",
      });
      expect(result.ok).toBe(false);
    }
  });

  test("accepts only a canonical provider HTTP Date header", () => {
    expect(canonicalGithubDateHeader(date)).toBe("2026-08-27T12:00:00.000Z");
    for (const value of [null, "Thu, 27 Aug 2026 12:00:00 UTC", `${date}, ${date}`])
      expect(canonicalGithubDateHeader(value)).toBeUndefined();
  });
});

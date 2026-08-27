import { describe, expect, test } from "vitest";
import {
  readGithubTerminalArtifacts,
  readGithubTerminalJobs,
  readGithubTerminalRun,
  type HostedTerminalExpected,
  type HostedTerminalRuntime,
} from "../../scripts/conformance/hosted-terminal.mjs";

const revision = "b".repeat(40);
const expected: HostedTerminalExpected = Object.freeze({
  repositoryId: "123",
  runAttempt: "2",
  runId: "456",
  workflowRevision: revision,
});
const repository = "todd-skelton/orchestration-platform";

function json(value: unknown, withDate = false): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      ...(withDate ? { date: "Thu, 27 Aug 2026 12:00:00 GMT" } : {}),
    },
    status: 200,
  });
}

function runtime(fetcher: HostedTerminalRuntime["fetcher"]): HostedTerminalRuntime {
  return Object.freeze({
    fetcher,
    async projectProtection() {
      throw new Error("unused");
    },
  });
}

describe("post-terminal GitHub API projection", () => {
  test("projects the completed protected workflow run", async () => {
    const result = await readGithubTerminalRun(
      repository,
      expected,
      "token",
      runtime(async () =>
        json({
          conclusion: "success",
          event: "repository_dispatch",
          head_sha: revision,
          id: 456,
          path: ".github/workflows/conformance.yml",
          repository: { id: 123 },
          run_attempt: 2,
          status: "completed",
        }),
      ),
    );
    expect(result).toEqual({
      conclusion: "SUCCESS",
      event: "repository_dispatch",
      repositoryId: "123",
      runAttempt: "2",
      runId: "456",
      status: "COMPLETED",
      workflowPath: ".github/workflows/conformance.yml",
      workflowRef:
        "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
      workflowRevision: revision,
    });
  });

  test("projects exact terminal job names and provider timestamps", async () => {
    const rows = [
      {
        completed_at: "2026-08-27T12:01:00Z",
        conclusion: "success",
        head_sha: revision,
        id: 10,
        name: "plan",
        run_attempt: 2,
        run_id: 456,
        started_at: "2026-08-27T12:00:00Z",
        workflow_name: "Conformance",
      },
      {
        completed_at: "2026-08-27T12:02:00Z",
        conclusion: "success",
        head_sha: revision,
        id: 11,
        name: "record",
        run_attempt: 2,
        run_id: 456,
        started_at: "2026-08-27T12:01:00Z",
        workflow_name: "Conformance",
      },
    ];
    const result = await readGithubTerminalJobs(
      repository,
      expected,
      "token",
      runtime(async () => json({ jobs: rows, total_count: 2 }, true)),
    );
    expect(result).toEqual([
      {
        completedAt: "2026-08-27T12:01:00.000Z",
        conclusion: "SUCCESS",
        providerJobId: "10",
        providerJobName: "Conformance / plan",
        startedAt: "2026-08-27T12:00:00.000Z",
      },
      {
        completedAt: "2026-08-27T12:02:00.000Z",
        conclusion: "SUCCESS",
        providerJobId: "11",
        providerJobName: "Conformance / record",
        startedAt: "2026-08-27T12:01:00.000Z",
      },
    ]);
  });

  test("downloads the unique attempt-qualified non-archive provider record", async () => {
    const name = "conformance-456-2-provider-record.json";
    const bytes = new TextEncoder().encode("provider-record");
    const result = await readGithubTerminalArtifacts(
      repository,
      expected,
      "token",
      runtime(async (url) => {
        if (url.endsWith("/20/zip")) return new Response(bytes, { status: 200 });
        return json({
          artifacts: [
            {
              archive_download_url: `https://api.github.com/repos/${repository}/actions/artifacts/20/zip`,
              created_at: "2026-08-27T12:01:30Z",
              digest: `sha256:${"a".repeat(64)}`,
              expired: false,
              expires_at: "2026-09-27T12:00:00Z",
              id: 20,
              name,
              size_in_bytes: bytes.byteLength,
              workflow_run: { head_sha: revision, id: 456, repository_id: 123 },
            },
          ],
          total_count: 1,
        });
      }),
    );
    expect([...result.providerRecordBytes]).toEqual([...bytes]);
    expect(result.artifacts).toEqual([
      {
        artifactDigest: "a".repeat(64),
        artifactId: "20",
        artifactName: name,
        byteLength: String(bytes.byteLength),
        createdAt: "2026-08-27T12:01:30.000Z",
        expired: false,
        expiresAt: "2026-09-27T12:00:00.000Z",
        runAttempt: "2",
        runId: "456",
      },
    ]);
  });

  test("refuses a changed workflow association", async () => {
    await expect(
      readGithubTerminalJobs(
        repository,
        expected,
        "token",
        runtime(async () =>
          json(
            {
              jobs: [
                {
                  completed_at: "2026-08-27T12:01:00Z",
                  conclusion: "success",
                  head_sha: "c".repeat(40),
                  id: 10,
                  name: "plan",
                  run_attempt: 2,
                  run_id: 456,
                  started_at: "2026-08-27T12:00:00Z",
                  workflow_name: "Conformance",
                },
              ],
              total_count: 1,
            },
            true,
          ),
        ),
      ),
    ).rejects.toThrow("provider:job-association-refused");
  });
});

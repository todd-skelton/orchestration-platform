import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  exerciseDecisionOutputCustodyForTest,
  parseHostedTerminalArguments,
  readGithubTerminalArtifacts,
  readGithubTerminalVerifiedAt,
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
const stableRoot = resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "op-decision-output-"));
  temporaryRoots.push(root);
  return root;
}

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
  test("accepts only the four bounded terminal-verifier arguments", () => {
    expect(parseHostedTerminalArguments(["123", "456", "2", revision])).toEqual({
      ok: true,
      value: expected,
    });
    for (const arguments_ of [
      [],
      ["123", "456", "2"],
      ["0", "456", "2", revision],
      ["123", "0456", "2", revision],
      ["123", "456", "2", "refs/heads/main"],
    ])
      expect(parseHostedTerminalArguments(arguments_)).toEqual({ ok: false });
  });

  test("the direct entrypoint emits only a refusal result without authority inputs", () => {
    const path = resolve(import.meta.dirname, "../../scripts/conformance/run-bundled.mts");
    const result = spawnSync(process.execPath, [path, "terminal", "123", "456", "2", revision], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_TOKEN: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ issues: ["input:refused"], result: "REFUSED" });
    const decision = spawnSync(
      process.execPath,
      [path, "terminal", "portable-primitives-decision", "123", "456", "2", revision],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_TOKEN: "token",
          PORTABLE_PRIMITIVES_OUTPUT_ROOT: resolve(import.meta.dirname, "../.."),
        },
      },
    );
    expect(decision.status).toBe(1);
    expect(decision.stderr).toBe("");
    expect(JSON.parse(decision.stdout)).toEqual({
      issues: ["decisionOutput:refused"],
      result: "REFUSED",
    });
  }, 30_000);

  test("commits one external file and refuses foreign checkout and canonical aliases", async () => {
    const root = await temporaryRoot();
    const output = resolve(root, "output");
    await mkdir(output);
    expect(await exerciseDecisionOutputCustodyForTest(output, stableRoot)).toEqual({ ok: true });
    expect(await readdir(output)).toEqual(["custody-mechanics-probe.json"]);

    const foreignDirectory = resolve(root, "foreign-directory");
    const foreignDirectoryOutput = resolve(foreignDirectory, "output");
    await mkdir(resolve(foreignDirectory, ".git"), { recursive: true });
    await mkdir(foreignDirectoryOutput);
    expect(await exerciseDecisionOutputCustodyForTest(foreignDirectoryOutput, stableRoot)).toEqual({
      issues: ["decisionOutput:refused"],
      ok: false,
    });
    expect(await readdir(foreignDirectoryOutput)).toEqual([]);

    const foreignGitfile = resolve(root, "foreign-gitfile");
    const foreignGitfileOutput = resolve(foreignGitfile, "output");
    await mkdir(foreignGitfile);
    await writeFile(resolve(foreignGitfile, ".git"), "gitdir: ../authority\n");
    await mkdir(foreignGitfileOutput);
    expect(await exerciseDecisionOutputCustodyForTest(foreignGitfileOutput, stableRoot)).toEqual({
      issues: ["decisionOutput:refused"],
      ok: false,
    });

    expect(
      await exerciseDecisionOutputCustodyForTest(resolve(stableRoot, ".."), stableRoot),
    ).toEqual({ issues: ["decisionOutput:refused"], ok: false });

    const target = resolve(root, "symlink-target");
    const alias = resolve(root, "symlink-alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    expect(await exerciseDecisionOutputCustodyForTest(alias, stableRoot)).toEqual({
      issues: ["decisionOutput:refused"],
      ok: false,
    });
    expect(await readdir(target)).toEqual([]);
  });

  test("cleans its exact file after extra-entry refusal and surfaces moved-root cleanup refusal", async () => {
    const root = await temporaryRoot();
    const changedOutput = resolve(root, "changed-output");
    await mkdir(changedOutput);
    const changed = await exerciseDecisionOutputCustodyForTest(changedOutput, stableRoot, {
      async afterFinalize(outputRoot, filename) {
        await writeFile(resolve(outputRoot, filename), "changed");
      },
    });
    expect(changed).toEqual({ issues: ["decisionOutput:refused"], ok: false });
    expect(await readdir(changedOutput)).toEqual([]);

    const extraOutput = resolve(root, "extra-output");
    await mkdir(extraOutput);
    const extra = await exerciseDecisionOutputCustodyForTest(extraOutput, stableRoot, {
      async afterFinalize(outputRoot) {
        await writeFile(resolve(outputRoot, "foreign-entry"), "foreign");
      },
    });
    expect(extra).toEqual({ issues: ["decisionOutput:cleanup-refused"], ok: false });
    expect(await readdir(extraOutput)).toEqual(["foreign-entry"]);

    const collisionOutput = resolve(root, "collision-output");
    await mkdir(collisionOutput);
    const collision = await exerciseDecisionOutputCustodyForTest(collisionOutput, stableRoot, {
      async afterPendingWrite(outputRoot) {
        await writeFile(resolve(outputRoot, "custody-mechanics-probe.json"), "foreign");
      },
    });
    expect(collision).toEqual({ issues: ["decisionOutput:cleanup-refused"], ok: false });
    expect(await readdir(collisionOutput)).toEqual(["custody-mechanics-probe.json"]);
    expect(await readFile(resolve(collisionOutput, "custody-mechanics-probe.json"), "utf8")).toBe(
      "foreign",
    );

    const movedOutput = resolve(root, "moved-output");
    const movedAside = resolve(root, "moved-aside");
    await mkdir(movedOutput);
    const moved = await exerciseDecisionOutputCustodyForTest(movedOutput, stableRoot, {
      async afterPendingWrite(outputRoot) {
        await rename(outputRoot, movedAside);
        await mkdir(outputRoot);
      },
    });
    expect(moved).toEqual({ issues: ["decisionOutput:cleanup-refused"], ok: false });
    expect(await readdir(movedOutput)).toEqual([]);
    expect(await readdir(movedAside)).toEqual([".custody-mechanics-probe.json.pending"]);

    const finalizedOutput = resolve(root, "finalized-output");
    const finalizedAside = resolve(root, "finalized-aside");
    await mkdir(finalizedOutput);
    const finalized = await exerciseDecisionOutputCustodyForTest(finalizedOutput, stableRoot, {
      async afterFinalize(outputRoot) {
        await rename(outputRoot, finalizedAside);
        await mkdir(outputRoot);
      },
    });
    expect(finalized).toEqual({ issues: ["decisionOutput:cleanup-refused"], ok: false });
    expect(await readdir(finalizedOutput)).toEqual([]);
    expect(await readdir(finalizedAside)).toEqual(["custody-mechanics-probe.json"]);
  });

  test("projects the completed protected workflow run", async () => {
    const result = await readGithubTerminalRun(
      repository,
      expected,
      "token",
      runtime(async () =>
        json({
          conclusion: "success",
          created_at: "2026-08-27T11:59:00Z",
          event: "repository_dispatch",
          head_sha: revision,
          id: 456,
          path: ".github/workflows/conformance.yml",
          repository: { id: 123 },
          run_attempt: 2,
          run_started_at: "2026-08-27T11:59:30Z",
          status: "completed",
          updated_at: "2026-08-27T12:02:00Z",
        }),
      ),
    );
    expect(result).toEqual({
      conclusion: "SUCCESS",
      createdAt: "2026-08-27T11:59:00.000Z",
      event: "repository_dispatch",
      repositoryId: "123",
      runAttempt: "2",
      runId: "456",
      runStartedAt: "2026-08-27T11:59:30.000Z",
      status: "COMPLETED",
      updatedAt: "2026-08-27T12:02:00.000Z",
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
        status: "completed",
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
        status: "completed",
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
        status: "COMPLETED",
      },
      {
        completedAt: "2026-08-27T12:02:00.000Z",
        conclusion: "SUCCESS",
        providerJobId: "11",
        providerJobName: "Conformance / record",
        startedAt: "2026-08-27T12:01:00.000Z",
        status: "COMPLETED",
      },
    ]);
    const queued = await readGithubTerminalJobs(
      repository,
      expected,
      "token",
      runtime(async () =>
        json(
          {
            jobs: [
              {
                ...rows[0],
                completed_at: null,
                conclusion: null,
                status: "queued",
              },
            ],
            total_count: 1,
          },
          true,
        ),
      ),
    );
    expect(queued[0]?.status).toBe("QUEUED");
    expect(queued[0]?.conclusion).toBeNull();
    await expect(
      readGithubTerminalJobs(
        repository,
        expected,
        "token",
        runtime(async () =>
          json({ jobs: [{ ...rows[0], status: "mystery" }], total_count: 1 }, true),
        ),
      ),
    ).rejects.toThrow("provider:job-association-refused");
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

  test("selects exactly one diagnostic provider artifact", async () => {
    const name = "conformance-456-2-diagnostic-provider-record.json";
    const bytes = new TextEncoder().encode("diagnostic-provider-record");
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
    expect(result.diagnosticProviderRecordBytes).toEqual(bytes);
    expect(result.providerRecordBytes).toEqual(bytes);
  });

  test("takes diagnostic verifiedAt only from the final authenticated current-attempt response", async () => {
    const run = Object.freeze({
      conclusion: "failure",
      created_at: "2026-08-27T11:59:00Z",
      head_sha: revision,
      id: 456,
      run_attempt: 2,
      run_started_at: "2026-08-27T11:59:30Z",
      status: "completed",
      updated_at: "2026-08-27T11:59:59Z",
    });
    const finalResponse = (value: unknown, date?: string) =>
      new Response(JSON.stringify(value), {
        headers: {
          "content-type": "application/json",
          ...(date ? { date } : {}),
        },
        status: 200,
      });
    const verifiedAt = await readGithubTerminalVerifiedAt(
      repository,
      expected,
      "token",
      runtime(async (_url, init) => {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
        return finalResponse(run, "Thu, 27 Aug 2026 12:00:00 GMT");
      }),
    );
    expect(verifiedAt).toBe("2026-08-27T12:00:00.000Z");
    for (const [record, date] of [
      [run, undefined],
      [run, "Thu, 27 Aug 2026 12:00:00 UTC"],
      [run, "Thu, 27 Aug 2026 12:00:00 GMT, Thu, 27 Aug 2026 12:00:01 GMT"],
      [{ ...run, run_attempt: 1 }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, head_sha: "c".repeat(40) }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, status: "in_progress" }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, conclusion: "success" }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, updated_at: "2026-08-27T12:00:01Z" }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, created_at: "2026-08-27T11:59:31Z" }, "Thu, 27 Aug 2026 12:00:00 GMT"],
      [{ ...run, run_started_at: "2026-08-27T12:00:01Z" }, "Thu, 27 Aug 2026 12:00:00 GMT"],
    ] as const)
      await expect(
        readGithubTerminalVerifiedAt(
          repository,
          expected,
          "token",
          runtime(async () => finalResponse(record, date)),
        ),
      ).rejects.toThrow("provider:diagnostic-final-response-refused");
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
                  status: "completed",
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

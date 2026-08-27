import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  finalizeHostedPlan,
  parseGitTreeOutput,
  parseHostedDispatchContext,
  selectHostedPlan,
  type HostedDispatchContext,
  type HostedPlanApi,
  type HostedPlanSelection,
} from "../../scripts/conformance/hosted-plan.mjs";
import { projectGithubProtectionSnapshot } from "../../packages/conformance/src/github-actions/index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const revision = "a".repeat(40);
const repository = "todd-skelton/orchestration-platform";
const workflowRef = `${repository}/.github/workflows/conformance.yml@refs/heads/main`;
const branchProtection = Object.freeze({
  allow_deletions: Object.freeze({ enabled: false }),
  allow_force_pushes: Object.freeze({ enabled: false }),
  enforce_admins: Object.freeze({ enabled: true }),
  required_pull_request_reviews: Object.freeze({ bypass_pull_request_allowances: null }),
});

function environment(overrides: Readonly<Record<string, string | undefined>> = {}) {
  return {
    GITHUB_EVENT_NAME: "repository_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "2",
    GITHUB_SHA: revision,
    GITHUB_WORKFLOW_REF: workflowRef,
    GITHUB_WORKFLOW_SHA: revision,
    ...overrides,
  };
}

function event(payload: unknown = { candidateRevision: revision }) {
  return { action: "conformance_candidate", client_payload: payload, repository: { id: 1 } };
}

function context(): HostedDispatchContext {
  const parsed = parseHostedDispatchContext(environment(), event());
  if (!parsed.ok) throw new Error(parsed.issues.join(","));
  return parsed.value;
}

function protectionInput() {
  return {
    branchProtection,
    branchProtectionStatus: "FOUND" as const,
    rulesetPages: [[]],
    rulesetPaginationTerminal: true,
    targetRef: "refs/heads/main",
  };
}

function api(overrides: Partial<HostedPlanApi> = {}): HostedPlanApi {
  return {
    projectProtection: async () => protectionInput(),
    resolveCommit: async (_repository, candidateRevision) => candidateRevision,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("hosted conformance plan", () => {
  test("accepts only the closed protected-main dispatch context", () => {
    expect(parseHostedDispatchContext(environment(), event()).ok).toBe(true);
    for (const [environmentMutation, eventMutation] of [
      [{ GITHUB_EVENT_NAME: "workflow_dispatch" }, event()],
      [{ GITHUB_REF: "refs/heads/candidate" }, event()],
      [{ GITHUB_REF_PROTECTED: "false" }, event()],
      [{ GITHUB_WORKFLOW_SHA: "b".repeat(40) }, event()],
      [{ GITHUB_WORKFLOW_REF: `${repository}/other.yml@refs/heads/main` }, event()],
      [{ GITHUB_RUN_ATTEMPT: "01" }, event()],
      [{}, { ...event(), action: "other" }],
      [{}, event({ candidateRevision: revision, extra: true })],
      [{}, event({ candidateRevision: "main" })],
      [{}, event(null)],
    ] as const)
      expect(parseHostedDispatchContext(environment(environmentMutation), eventMutation).ok).toBe(
        false,
      );
  });

  test("selects only an exact resolved commit under zero-bypass protection", async () => {
    const selected = await selectHostedPlan(context(), "token", api());
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.candidateRevision).toBe(revision);
    expect(selected.value.protectionSnapshotDigest).toMatch(/^[0-9a-f]{64}$/);

    expect(
      (
        await selectHostedPlan(
          context(),
          "token",
          api({ resolveCommit: async () => "b".repeat(40) }),
        )
      ).ok,
    ).toBe(false);
    expect((await selectHostedPlan(context(), "", api())).ok).toBe(false);
    expect(
      (
        await selectHostedPlan(
          context(),
          "token",
          api({
            projectProtection: async () => ({
              ...protectionInput(),
              branchProtection: {
                ...branchProtection,
                enforce_admins: { enabled: false },
              },
            }),
          }),
        )
      ).ok,
    ).toBe(false);
  });

  test("parses only complete NUL-terminated Git tree rows", () => {
    const valid = Buffer.from(`100644 blob ${"b".repeat(40)}\tpath/file.ts\0`, "utf8");
    expect(parseGitTreeOutput(valid)).toMatchObject({ ok: true });
    expect(parseGitTreeOutput(valid.subarray(0, valid.length - 1))).toMatchObject({ ok: false });
    expect(
      parseGitTreeOutput(Buffer.from(`120000 blob ${"b".repeat(40)}\tlink\0`, "utf8")),
    ).toMatchObject({ ok: true });
    expect(parseGitTreeOutput(Buffer.from("bad\0", "utf8"))).toMatchObject({ ok: false });
    expect(parseGitTreeOutput(Uint8Array.from([0xff, 0]))).toMatchObject({ ok: false });
  });

  test("finalizes manifests, candidate subject, provider run, and registry-derived matrix", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "orchestration-hosted-plan-"));
    roots.push(temporary);
    const candidateRoot = resolve(temporary, "candidate");
    const stableRoot = resolve(import.meta.dirname, "../..");
    await execFileAsync("git", [
      "clone",
      "--local",
      "--no-hardlinks",
      "--quiet",
      stableRoot,
      candidateRoot,
    ]);
    const { stdout } = await execFileAsync("git", ["-C", candidateRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    const candidateRevision = stdout.trim();
    const projection = projectGithubProtectionSnapshot(protectionInput());
    if (!projection.ok) throw new Error(projection.issues.join(","));
    const selection: HostedPlanSelection = Object.freeze({
      ...context(),
      candidateRevision,
      event: "repository_dispatch",
      protectionSnapshot: projection.value,
      protectionSnapshotDigest: projection.digest,
      schemaVersion: "hosted-conformance-plan-selection/v1",
      workflowRevision: candidateRevision,
    });
    const finalized = await finalizeHostedPlan({ candidateRoot, selection, stableRoot });
    if (!finalized.ok) throw new Error(finalized.issues.join(","));
    expect(finalized.ok).toBe(true);
    expect(finalized.value.context.candidateSubjectDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.value.context.providerRunDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.value.matrix.include).toEqual([
      {
        jobId: "iss002-contracts-linux",
        runner: "ubuntu-latest",
        runnerToken: "ISS002_CONTRACTS",
        suiteId: "iss002-contracts",
      },
      {
        jobId: "iss002-contracts-macos",
        runner: "macos-latest",
        runnerToken: "ISS002_CONTRACTS",
        suiteId: "iss002-contracts",
      },
      {
        jobId: "iss002-contracts-windows",
        runner: "windows-latest",
        runnerToken: "ISS002_CONTRACTS",
        suiteId: "iss002-contracts",
      },
    ]);
    expect(Buffer.from(finalized.value.encodedContext, "base64url").toString("utf8")).toContain(
      finalized.value.context.providerRunDigest,
    );
  }, 120_000);
});

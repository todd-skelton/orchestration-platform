import { execFile } from "node:child_process";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  finalizeHostedNativeLockPlan,
  finalizeHostedPlan,
  parseGitTreeOutput,
  parseHostedDispatchContext,
  parseHostedNativeLockDispatchContext,
  readGithubProtection,
  selectHostedNativeLockPlan,
  selectHostedPlan,
  type HostedDispatchContext,
  type HostedNativeLockPlanSelection,
  type HostedPlanApi,
  type HostedPlanSelection,
} from "../../scripts/conformance/hosted-plan.mjs";
import {
  createHostedNativeLockMatrix,
  createHostedNativeLockRegistry,
  hostedNativeLockControlIds,
} from "../../scripts/conformance/hosted-native-lock-plan.mjs";
import {
  computeGithubConformanceProtectedRefDigest,
  projectGithubProtectionSnapshot,
} from "../../packages/conformance/src/github-actions/index.js";

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

function nativeEvent(payload: unknown = { candidateRevision: revision }) {
  return {
    action: "iss022_native_lock_experiment",
    client_payload: payload,
    repository: { id: 1 },
  };
}

function context(): HostedDispatchContext {
  const parsed = parseHostedDispatchContext(environment(), event());
  if (!parsed.ok) throw new Error(parsed.issues.join(","));
  return parsed.value;
}

function api(overrides: Partial<HostedPlanApi> = {}): HostedPlanApi {
  return {
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

  test("selects only an exact resolved commit under the direct protected-ref marker", async () => {
    const selected = await selectHostedPlan(context(), "token", api());
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.candidateRevision).toBe(revision);
    expect(selected.value.protectedRefDigest).toMatch(/^[0-9a-f]{64}$/);

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
          { ...context(), protectedRef: { ...context().protectedRef, refProtected: false } },
          "token",
          api(),
        )
      ).ok,
    ).toBe(false);
  });

  test("registers only the literal native-lock action under a distinct selection", async () => {
    const parsed = parseHostedNativeLockDispatchContext(environment(), nativeEvent());
    expect(parsed.ok).toBe(true);
    expect(parseHostedNativeLockDispatchContext(environment(), event()).ok).toBe(false);
    expect(
      parseHostedNativeLockDispatchContext(
        environment(),
        nativeEvent({ candidateRevision: revision, matrix: [] }),
      ).ok,
    ).toBe(false);
    if (!parsed.ok) return;
    const selected = await selectHostedNativeLockPlan(parsed.value, "token", api());
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value).toMatchObject({
      action: "iss022_native_lock_experiment",
      candidateRevision: revision,
      schemaVersion: "hosted-native-lock-plan-selection/v1",
    });
    expect((await selectHostedNativeLockPlan(parsed.value, "", api())).ok).toBe(false);
    expect(
      (
        await selectHostedNativeLockPlan(
          parsed.value,
          "token",
          api({ resolveCommit: async () => "b".repeat(40) }),
        )
      ).ok,
    ).toBe(false);
  });

  test("pins the native-lock runner token, three required OS rows, and matrix order", () => {
    expect(hostedNativeLockControlIds).toHaveLength(12);
    const registry = createHostedNativeLockRegistry("a".repeat(64));
    expect(createHostedNativeLockMatrix(registry).include).toEqual([
      {
        jobId: "iss022-native-lock-experiment-linux",
        runner: "ubuntu-latest",
        runnerToken: "ISS022_NATIVE_LOCK_EXPERIMENT",
        suiteId: "iss022-native-lock-experiment",
      },
      {
        jobId: "iss022-native-lock-experiment-macos",
        runner: "macos-latest",
        runnerToken: "ISS022_NATIVE_LOCK_EXPERIMENT",
        suiteId: "iss022-native-lock-experiment",
      },
      {
        jobId: "iss022-native-lock-experiment-windows",
        runner: "windows-latest",
        runnerToken: "ISS022_NATIVE_LOCK_EXPERIMENT",
        suiteId: "iss022-native-lock-experiment",
      },
    ]);
    type RegistryMutant = {
      jobs: Array<Record<string, unknown>>;
      suites: Array<Record<string, unknown>>;
    };
    const mutants: Array<(value: RegistryMutant) => unknown> = [
      (value) => (value.suites[0]!.runnerToken = "ISS022_PORTABLE_PRIMITIVES"),
      (value) => (value.jobs[0]!.jobId = "iss022-native-lock-experiment-other"),
      (value) => (value.jobs[0]!.environmentFamily = "WINDOWS"),
      (value) => (value.jobs[0]!.requirement = "UNUSED"),
      (value) => value.jobs.reverse(),
      (value) => value.jobs.pop(),
      (value) => value.jobs.push(structuredClone(value.jobs[0]!)),
    ];
    for (const mutate of mutants) {
      const value = structuredClone(registry) as unknown as RegistryMutant;
      mutate(value);
      expect(() => createHostedNativeLockMatrix(value)).toThrow(/native-lock-plan/);
    }
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

  test("terminal protection reads replace ruleset summaries with authenticated details", async () => {
    const rulesetId = 21694457;
    const detail = {
      bypass_actors: [],
      conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
      enforcement: "active",
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request" }],
      target: "branch",
    };
    const read = async (rulesetDetail: unknown) =>
      await readGithubProtection(repository, "token", async (url) => {
        if (url.endsWith("/branches/main/protection"))
          return new Response(JSON.stringify(branchProtection), { status: 200 });
        if (url.includes("/rulesets?"))
          return new Response(
            JSON.stringify([
              {
                _links: {
                  self: {
                    href: `https://api.github.com/repos/${repository}/rulesets/${rulesetId}`,
                  },
                },
                id: rulesetId,
              },
            ]),
            { status: 200 },
          );
        if (url.endsWith(`/rulesets/${rulesetId}`))
          return new Response(JSON.stringify(rulesetDetail), { status: 200 });
        return new Response(null, { status: 404 });
      });
    expect(projectGithubProtectionSnapshot(await read(detail)).ok).toBe(true);
    const opaqueDetail = {
      conditions: detail.conditions,
      enforcement: detail.enforcement,
      rules: detail.rules,
      target: detail.target,
    };
    expect(projectGithubProtectionSnapshot(await read(opaqueDetail)).ok).toBe(false);
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
    const dispatchContext = context();
    const selection: HostedPlanSelection = Object.freeze({
      ...dispatchContext,
      candidateRevision,
      event: "repository_dispatch",
      protectedRefDigest: computeGithubConformanceProtectedRefDigest(dispatchContext.protectedRef),
      schemaVersion: "hosted-conformance-plan-selection/v1",
      workflowRevision: candidateRevision,
    });
    const finalized = await finalizeHostedPlan({ candidateRoot, selection, stableRoot });
    if (!finalized.ok) throw new Error(finalized.issues.join(","));
    expect(finalized.ok).toBe(true);
    expect(finalized.value.context.schemaVersion).toBe("hosted-conformance-plan-context/v1");
    expect(finalized.value.context).not.toHaveProperty("action");
    expect(finalized.value.context.candidateSubjectDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.value.context.providerRunDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.value.matrix.include).toEqual([
      {
        jobId: "iss022-portable-primitives-linux",
        runner: "ubuntu-latest",
        runnerToken: "ISS022_PORTABLE_PRIMITIVES",
        suiteId: "iss022-portable-primitives",
      },
      {
        jobId: "iss022-portable-primitives-macos",
        runner: "macos-latest",
        runnerToken: "ISS022_PORTABLE_PRIMITIVES",
        suiteId: "iss022-portable-primitives",
      },
      {
        jobId: "iss022-portable-primitives-windows",
        runner: "windows-latest",
        runnerToken: "ISS022_PORTABLE_PRIMITIVES",
        suiteId: "iss022-portable-primitives",
      },
    ]);
    expect(Buffer.from(finalized.value.encodedContext, "base64url").toString("utf8")).toContain(
      finalized.value.context.providerRunDigest,
    );
  }, 600_000);

  test("finalizes the native-lock plan without activating an observation runner", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "orchestration-native-lock-plan-"));
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
    const dispatch = parseHostedNativeLockDispatchContext(environment(), nativeEvent());
    if (!dispatch.ok) throw new Error(dispatch.issues.join(","));
    const selection: HostedNativeLockPlanSelection = Object.freeze({
      ...dispatch.value,
      candidateRevision,
      event: "repository_dispatch",
      protectedRefDigest: computeGithubConformanceProtectedRefDigest(dispatch.value.protectedRef),
      schemaVersion: "hosted-native-lock-plan-selection/v1",
      workflowRevision: candidateRevision,
    });
    const finalized = await finalizeHostedNativeLockPlan({ candidateRoot, selection, stableRoot });
    if (!finalized.ok) throw new Error(finalized.issues.join(","));
    expect(finalized.value.context).toMatchObject({
      action: "iss022_native_lock_experiment",
      candidateRevision,
      schemaVersion: "hosted-native-lock-plan-context/v1",
    });
    for (const field of [
      "caseCensusDigest",
      "controlCensusDigest",
      "harnessBundleDigest",
      "prerequisiteCensusDigest",
      "providerRunDigest",
      "requiredJobRegistryDigest",
      "testBundleDigest",
      "vectorCensusDigest",
    ] as const)
      expect(finalized.value.context[field]).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.value.matrix.include).toHaveLength(3);
    expect(Buffer.from(finalized.value.encodedContext, "base64url").toString("utf8")).toContain(
      '"action":"iss022_native_lock_experiment"',
    );
    for (const [name, path] of [
      ["catalog", "packages/conformance/src/contracts.ts"],
      ["dispatcher", "scripts/conformance/hosted-plan.mts"],
    ] as const) {
      const mutatedStableRoot = resolve(temporary, `stable-${name}`);
      await execFileAsync("git", [
        "clone",
        "--local",
        "--no-hardlinks",
        "--quiet",
        stableRoot,
        mutatedStableRoot,
      ]);
      await appendFile(resolve(mutatedStableRoot, path), "\n// stable-root mutant\n", "utf8");
      const mutated = await finalizeHostedNativeLockPlan({
        candidateRoot,
        selection,
        stableRoot: mutatedStableRoot,
      });
      if (!mutated.ok) throw new Error(mutated.issues.join(","));
      expect(mutated.value.context.harnessBundleDigest).not.toBe(
        finalized.value.context.harnessBundleDigest,
      );
      expect(mutated.value.context.providerRunDigest).not.toBe(
        finalized.value.context.providerRunDigest,
      );
    }
  }, 600_000);
});

import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  setupStep,
  type SetupAdapter,
  type SetupConfig,
  type SetupRole,
} from "../../scripts/dogfood/setup.mjs";

const roots: string[] = [];
const pilot = "a".repeat(40);
const base = "b".repeat(40);

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "setup-engine-fixture-"));
  roots.push(root);
  const paths = {
    repository: resolve(root, "repository"),
    controller: resolve(root, "controller"),
    state: resolve(root, "state"),
    pilot: resolve(root, "pilot"),
    source: resolve(root, "source"),
    review: resolve(root, "review"),
  };
  await Promise.all([paths.repository, paths.controller, paths.state].map((path) => mkdir(path)));
  const config: SetupConfig = {
    controller: "synthetic-controller",
    run: "synthetic-setup-run",
    issue: "fixture-075",
    repository: "fixture/repository",
    repositoryRoot: paths.repository,
    controllerRoot: paths.controller,
    controllerRevision: pilot,
    pilotRevision: pilot,
    base,
    baseBranch: "main",
    sourceBranch: "fixture/iss-075",
    pilotWorktree: paths.pilot,
    sourceWorktree: paths.source,
    reviewWorktree: paths.review,
    stateDirectory: paths.state,
  };
  const present = new Set<SetupRole>();
  const dependencies = new Set<SetupRole>();
  const calls: string[] = [];
  let interrupted: SetupRole | undefined;
  let installOutcome: "succeeded" | "failed" | "unknown" = "succeeded";
  const dependencyEffects = new Set<SetupRole>();
  const adapter: SetupAdapter = {
    async assertExecutor(_config, executingRoot) {
      calls.push(`executor:${executingRoot}`);
    },
    async observeWorktree(_config, role) {
      calls.push(`observe:${role}`);
      return present.has(role)
        ? {
            state: "confirmed",
            head: role === "pilot" ? pilot : base,
            branch: role === "source" ? "fixture/iss-075" : null,
          }
        : { state: "absent" };
    },
    async createWorktree(current, role) {
      calls.push(`create:${role}`);
      expect(
        JSON.parse(
          await readFile(resolve(current.stateDirectory, `worktree-${role}-intent.json`), "utf8"),
        ).role,
      ).toBe(role);
      present.add(role);
      if (interrupted === role) throw new Error("synthetic interruption");
    },
    async observeDependencies(_config, role) {
      calls.push(`observe-dependencies:${role}`);
      return dependencies.has(role) ? "present" : "absent";
    },
    async installDependencies(current, role) {
      calls.push(`install:${role}`);
      expect(
        JSON.parse(
          await readFile(resolve(current.stateDirectory, `dependency-${role}-intent.json`), "utf8"),
        ).args,
      ).toEqual(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
      if (installOutcome === "succeeded" || dependencyEffects.has(role)) dependencies.add(role);
      return installOutcome;
    },
  };
  return {
    config,
    adapter,
    calls,
    present,
    dependencies,
    interrupt(role?: SetupRole) {
      interrupted = role;
    },
    setInstallOutcome(outcome: "succeeded" | "failed" | "unknown") {
      installOutcome = outcome;
    },
    leaveDependencyEffect(role: SetupRole) {
      dependencyEffects.add(role);
    },
  };
}

async function hostPathIsCaseSensitive(root: string) {
  const probe = resolve(root, "CaseSensitivityProbe");
  await mkdir(probe);
  try {
    await lstat(resolve(root, "casesensitivityprobe"));
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function selectCaseAliasWorktrees(
  current: Awaited<ReturnType<typeof fixture>>,
  pilotWorktree: string,
  sourceWorktree: string,
) {
  current.config.pilotWorktree = pilotWorktree;
  current.config.sourceWorktree = sourceWorktree;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("rejects a malformed controller before recording intent or calling the adapter", async () => {
  const current = await fixture();
  current.config.controller = "   ";
  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "invalid-controller" });
  expect(current.calls).toEqual([]);
  await expect(
    readFile(resolve(current.config.stateDirectory, "setup-plan.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("writes ownership intent before every bounded worktree and dependency mutation", async () => {
  const current = await fixture();
  const result = await setupStep(current.config, current.adapter, current.config.controllerRoot);

  expect(result).toEqual({
    status: "ready",
    run: current.config.run,
    issue: current.config.issue,
    heads: { pilot, source: base, review: base },
    worktrees: {
      pilot: current.config.pilotWorktree,
      source: current.config.sourceWorktree,
      review: current.config.reviewWorktree,
    },
    phase: "complete",
  });
  expect(current.calls.filter((call) => call.startsWith("create:"))).toEqual([
    "create:pilot",
    "create:source",
    "create:review",
  ]);
  expect(current.calls.filter((call) => call.startsWith("install:"))).toEqual([
    "install:pilot",
    "install:source",
    "install:review",
  ]);
});

it("reconciles an interrupted worktree creation and does not duplicate mutations on resume", async () => {
  const current = await fixture();
  current.interrupt("source");

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({
    status: "ready",
  });
  current.interrupt();
  const mutations = current.calls.filter(
    (call) => call.startsWith("create:") || call.startsWith("install:"),
  );

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({
    status: "ready",
  });
  expect(
    current.calls.filter((call) => call.startsWith("create:") || call.startsWith("install:")),
  ).toEqual(mutations);
});

it("exercises the observed host filesystem case-mode branch", async () => {
  const current = await fixture();
  const root = resolve(current.config.pilotWorktree, "..");
  const caseSensitive = await hostPathIsCaseSensitive(root);

  if (caseSensitive) {
    selectCaseAliasWorktrees(
      current,
      resolve(root, "CaseDistinctWorktree"),
      resolve(root, "casedistinctworktree"),
    );

    await expect(
      setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).resolves.toMatchObject({ status: "ready" });
    expect(current.calls.filter((call) => call.startsWith("create:"))).toEqual([
      "create:pilot",
      "create:source",
      "create:review",
    ]);
  } else {
    selectCaseAliasWorktrees(
      current,
      resolve(root, "CaseAliasWorktree"),
      resolve(root, "casealiasworktree"),
    );

    await expect(
      setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).rejects.toMatchObject({ reason: "overlapping-setup-paths" });
    expect(current.calls.filter((call) => call.startsWith("create:"))).toEqual([]);
    await expect(lstat(current.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(current.config.sourceWorktree)).rejects.toMatchObject({ code: "ENOENT" });
  }

  console.log(
    JSON.stringify({
      dogfoodSetupCaseFixture: {
        caseSensitive,
        branch: caseSensitive ? "distinct-paths" : "alias-refusal",
        assertionsPassed: true,
      },
    }),
  );
});

it.each([
  ["failed", "dependency-install-failed"],
  ["unknown", "dependency-install-unknown"],
] as const)(
  "keeps a %s installer outcome incomplete and resumes convergently",
  async (outcome, reason) => {
    const current = await fixture();
    current.setInstallOutcome(outcome);

    expect(
      await setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).toMatchObject({
      status: "incomplete",
      phase: "dependencies",
      reason,
    });
    expect(current.dependencies.size).toBe(0);

    current.setInstallOutcome("succeeded");
    expect(
      await setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).toMatchObject({
      status: "ready",
    });
    expect(current.calls.filter((call) => call === "create:pilot")).toHaveLength(1);
  },
);

it("does not repeat an uncertain post-effect install or write a success receipt on resume", async () => {
  const current = await fixture();
  current.setInstallOutcome("unknown");
  current.leaveDependencyEffect("pilot");

  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).resolves.toMatchObject({
    status: "incomplete",
    phase: "dependencies",
    reason: "dependency-install-unknown",
  });
  expect(current.calls.filter((call) => call === "install:pilot")).toHaveLength(1);
  await expect(
    readFile(resolve(current.config.stateDirectory, "dependency-pilot.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });

  current.setInstallOutcome("succeeded");
  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).resolves.toMatchObject({
    status: "incomplete",
    phase: "dependencies",
    reason: "dependency-install-unknown",
  });
  expect(current.calls.filter((call) => call === "install:pilot")).toHaveLength(1);
  await expect(
    readFile(resolve(current.config.stateDirectory, "dependency-pilot.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("preflights dependency receipts before creating any worktree", async () => {
  const current = await fixture();
  await writeFile(
    resolve(current.config.stateDirectory, "dependency-pilot.json"),
    `${JSON.stringify({ status: "complete" })}\n`,
  );

  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "malformed-dependency-receipt:pilot" });
  expect(current.calls.filter((call) => call.startsWith("create:"))).toEqual([]);
});

it("refuses unexpected external state", async () => {
  const unrelated = await fixture();
  await writeFile(resolve(unrelated.config.stateDirectory, "unrelated.txt"), "preserve me\n");
  await expect(
    setupStep(unrelated.config, unrelated.adapter, unrelated.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "unexpected-setup-state" });
  expect(await readFile(resolve(unrelated.config.stateDirectory, "unrelated.txt"), "utf8")).toBe(
    "preserve me\n",
  );
});

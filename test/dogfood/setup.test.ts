import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.mjs";
import {
  setupStep,
  SetupBlocked,
  type SetupAdapter,
  type SetupConfig,
  type SetupRole,
} from "../../scripts/dogfood/setup.mjs";

const roots: string[] = [];
const pilot = "a".repeat(40);
const base = "b".repeat(40);

const controlledGit = vi.hoisted(() => ({
  execute: undefined as
    ((args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>) | undefined,
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execute = promisify(actual.execFile);
  const injected = actual.execFile.bind(null);
  Object.defineProperty(injected, promisify.custom, {
    value: (
      executable: string,
      args: string[],
      options: import("node:child_process").ExecFileOptions,
    ) =>
      executable === "deferred-setup-git"
        ? controlledGit.execute!(args, String(options.cwd))
        : execute(executable, args, options),
  });
  return { ...actual, execFile: injected };
});

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
  controlledGit.execute = undefined;
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it.each(["pilotRevision", "base", "sourceBranch", "worktree", "aliased worktree"] as const)(
  "waits for real adapter children before setupStep refuses %s without mutation",
  async (scenario) => {
    const failure = scenario === "aliased worktree" ? "worktree" : scenario;
    const { config } = await fixture();
    await mkdir(resolve(config.repositoryRoot, ".git"));
    if (failure === "worktree") await mkdir(config.pilotWorktree);
    else config[failure] = failure === "sourceBranch" ? "invalid..ref" : "f".repeat(40);
    if (scenario === "aliased worktree") {
      const target = config.pilotWorktree;
      config.pilotWorktree = resolve(target, "../pilot-alias");
      await symlink(target, config.pilotWorktree, "junction");
    }
    const pilotWorktree = failure === "worktree" ? await realpath(config.pilotWorktree) : undefined;
    const calls: string[][] = [];
    const children: ReturnType<typeof Promise.withResolvers<void>>[] = [];
    const started = Promise.withResolvers<void>();
    let pending = 0;
    controlledGit.execute = async (args, cwd) => {
      calls.push(args);
      if (args[0] === "worktree")
        return {
          stdout:
            failure === "worktree" ? `worktree ${config.pilotWorktree}\0HEAD ${pilot}\0\0` : "",
          stderr: "",
        };
      if (args.includes("--git-common-dir"))
        return { stdout: resolve(config.repositoryRoot, ".git"), stderr: "" };
      const observing = cwd === pilotWorktree;
      const invalid =
        failure === "worktree"
          ? observing && args.includes("HEAD")
          : args.includes(
              failure === "sourceBranch" ? config.sourceBranch : `${config[failure]}^{commit}`,
            );
      if (invalid) throw new Error("invalid setup read");
      const hold =
        failure === "worktree"
          ? observing
          : failure === "sourceBranch"
            ? args[0] === "status"
            : args.includes("HEAD");
      if (hold) {
        const child = Promise.withResolvers<void>();
        children.push(child);
        pending += 1;
        if (children.length === 2) started.resolve();
        try {
          await child.promise;
        } finally {
          pending -= 1;
        }
      }
      let stdout = "";
      if (args.includes("--show-toplevel")) stdout = cwd;
      else if (args.includes("HEAD")) stdout = pilot;
      else if (args.includes("--verify")) stdout = args[2]!.split("^")[0]!;
      else if (args[0] === "branch") stdout = observing ? "" : config.baseBranch;
      else if (args[0] !== "status" && args[0] !== "check-ref-format")
        throw new Error(`unexpected Git read: ${args.join(" ")}`);
      return { stdout, stderr: "" };
    };
    const adapter = gitSetupAdapter({ gitExecutable: "deferred-setup-git" });
    const observe = vi.spyOn(adapter, "observeWorktree");
    const create = vi.spyOn(adapter, "createWorktree");
    const dependencies = vi.spyOn(adapter, "observeDependencies");
    const install = vi.spyOn(adapter, "installDependencies");
    let settled = false;
    const outcome = setupStep(config, adapter, config.controllerRoot).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await Promise.race([started.promise, outcome]);
      await new Promise<void>((done) => setImmediate(done));
      expect(settled).toBe(false);
      expect(pending).toBe(2);
      expect(await readdir(config.stateDirectory)).toEqual([]);
      children[0]!.reject(new Error("late sibling failure"));
      await new Promise<void>((done) => setImmediate(done));
      expect(settled).toBe(false);
      expect(pending).toBe(1);
      children[1]!.resolve();
      const refusal = await outcome;
      expect(refusal).toBeInstanceOf(SetupBlocked);
      expect(refusal).toMatchObject({
        reason: failure === "worktree" ? "worktree-state-unknown:pilot" : "setup-state-unverified",
      });
      expect(pending).toBe(0);
      expect(calls).toHaveLength(failure === "worktree" ? 19 : failure === "sourceBranch" ? 13 : 9);
      expect(observe).toHaveBeenCalledTimes(failure === "worktree" ? 1 : 0);
      expect(create).not.toHaveBeenCalled();
      expect(dependencies).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(await readdir(config.stateDirectory)).toEqual([]);
    } finally {
      for (const child of children) child.resolve();
      await outcome;
    }
  },
);

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

it("does not infer completion or reinstall from a marker without prior intent", async () => {
  const current = await fixture();
  current.dependencies.add("pilot");
  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({ status: "incomplete", reason: "dependency-install-unknown" });
  expect(current.calls.filter((call) => call.startsWith("install:"))).toEqual([]);
});

it.each(["base", "ignoreScripts"])(
  "compares saved %s independently when only controllerRevision may change",
  async (field) => {
    const current = await fixture();
    current.setInstallOutcome("failed");
    await setupStep(current.config, current.adapter, current.config.controllerRoot);
    const path = resolve(current.config.stateDirectory, "setup-plan.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (field === "base") saved.base = "c".repeat(40);
    else saved.dependencies.ignoreScripts = false;
    await writeFile(path, JSON.stringify(saved, null, 2) + "\n");
    const calls = [...current.calls];
    await expect(
      setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).rejects.toMatchObject({ reason: "conflicting-record:setup-plan" });
    expect(current.calls).toEqual(calls);
  },
);

it.each(["directory", "unowned-name"])(
  "rejects an invocation census %s without installing",
  async (kind) => {
    const current = await fixture();
    const name =
      kind === "directory"
        ? "dependency-source-install-1700000000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json"
        : "unrelated.stdout.log";
    const path = resolve(current.config.stateDirectory, name);
    if (kind === "directory") await mkdir(path);
    else await writeFile(path, "unrelated");
    await expect(
      setupStep(current.config, current.adapter, current.config.controllerRoot),
    ).rejects.toMatchObject({ reason: "unexpected-setup-state" });
    expect(current.calls.filter((call) => call.startsWith("install:"))).toEqual([]);
  },
);

it.each(["absent", "present", "unknown"] as const)(
  "keeps interrupted output nonterminal with %s dependencies",
  async (observation) => {
    const current = await fixture();
    current.setInstallOutcome("failed");
    await setupStep(current.config, current.adapter, current.config.controllerRoot);
    const prefix = resolve(
      current.config.stateDirectory,
      "dependency-pilot-install-1700000000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    await writeFile(`${prefix}.json`, '{"role":"pilot"}\n');
    await writeFile(`${prefix}.stdout.log`, "interrupted partial output\n");
    current.adapter.observeDependencies = async () => observation;
    const installs = current.calls.filter((call) => call.startsWith("install:")).length;
    const result = await setupStep(current.config, current.adapter, current.config.controllerRoot);
    expect(result).toMatchObject({
      status: "incomplete",
      reason: observation === "absent" ? "dependency-install-failed" : "dependency-install-unknown",
    });
    expect(current.calls.filter((call) => call.startsWith("install:"))).toHaveLength(
      installs + (observation === "absent" ? 1 : 0),
    );
    if (observation !== "absent") expect(result.diagnostics).toBe(`${prefix}.json`);
    await expect(
      readFile(resolve(current.config.stateDirectory, "dependency-pilot.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(`${prefix}.stdout.log`, "utf8")).toBe("interrupted partial output\n");
  },
);

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

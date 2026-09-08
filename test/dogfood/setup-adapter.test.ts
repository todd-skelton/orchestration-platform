import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.mjs";
import { setupStep, type SetupConfig } from "../../scripts/dogfood/setup.mjs";

const run = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]) {
  return (
    await run("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trim();
}

function synchronizeAuthority(config: SetupConfig) {
  Object.assign(config.authority, {
    controllerRevision: config.controllerRevision,
    pilotRevision: config.pilotRevision,
    base: config.base,
    baseBranch: config.baseBranch,
    sourceBranch: config.sourceBranch,
    repositoryRoot: config.repositoryRoot,
    controllerRoot: config.controllerRoot,
    pilotWorktree: config.pilotWorktree,
    sourceWorktree: config.sourceWorktree,
    reviewWorktree: config.reviewWorktree,
    stateDirectory: config.stateDirectory,
  });
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "setup-git-fixture-"));
  roots.push(root);
  const repository = resolve(root, "portable repository");
  const controller = resolve(root, "stable controller");
  const state = resolve(root, "external state");
  await mkdir(repository);
  await git(repository, ["init", "--quiet"]);
  await git(repository, ["branch", "-M", "main"]);
  await git(repository, ["config", "core.autocrlf", "false"]);
  await writeFile(resolve(repository, ".gitignore"), "node_modules/\n");
  await writeFile(resolve(repository, "fixture.txt"), "portable fixture\n");
  await git(repository, ["add", ".gitignore", "fixture.txt"]);
  await git(repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "stable pilot",
  ]);
  const pilotRevision = await git(repository, ["rev-parse", "HEAD"]);
  await git(repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "tree-equivalent base",
  ]);
  const base = await git(repository, ["rev-parse", "HEAD"]);
  await git(repository, ["worktree", "add", "--quiet", "--detach", controller, pilotRevision]);
  await mkdir(state);

  const config: SetupConfig = {
    run: "synthetic-native-setup",
    issue: "fixture-333",
    repository: "fixture/repository",
    repositoryRoot: repository,
    controllerRoot: controller,
    controllerRevision: pilotRevision,
    pilotRevision,
    base,
    baseBranch: "main",
    sourceBranch: "synthetic/iss-075",
    pilotWorktree: resolve(root, "pilot ü"),
    sourceWorktree: resolve(root, "source space"),
    reviewWorktree: resolve(root, "review worktree"),
    stateDirectory: state,
    authority: {
      schemaVersion: "dogfood-setup-authority/v1",
      controller: "synthetic-external-controller",
      run: "synthetic-native-setup",
      issue: "fixture-333",
      repository: "fixture/repository",
      controllerRevision: pilotRevision,
      pilotRevision,
      base,
      baseBranch: "main",
      sourceBranch: "synthetic/iss-075",
      repositoryRoot: repository,
      controllerRoot: controller,
      pilotWorktree: resolve(root, "pilot ü"),
      sourceWorktree: resolve(root, "source space"),
      reviewWorktree: resolve(root, "review worktree"),
      stateDirectory: state,
      actions: ["worktrees", "dependencies"],
    },
  };
  let installs = 0;
  const adapter = gitSetupAdapter({
    async install(_launcher, args, cwd) {
      installs += 1;
      expect(args).toEqual(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  return { root, repository, controller, config, adapter, installs: () => installs };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("prepares three real portable Git worktrees and resumes without duplicate setup", async () => {
  const current = await fixture();

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({ status: "ready", phase: "complete" });
  expect(await git(current.config.pilotWorktree, ["rev-parse", "HEAD"])).toBe(
    current.config.pilotRevision,
  );
  expect(await git(current.config.sourceWorktree, ["rev-parse", "HEAD"])).toBe(current.config.base);
  expect(await git(current.config.sourceWorktree, ["branch", "--show-current"])).toBe(
    current.config.sourceBranch,
  );
  expect(await git(current.config.reviewWorktree, ["branch", "--show-current"])).toBe("");
  expect(current.installs()).toBe(3);

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({ status: "ready", phase: "complete" });
  expect(current.installs()).toBe(3);
  expect(
    JSON.parse(
      await readFile(resolve(current.config.stateDirectory, "dependency-review.json"), "utf8"),
    ),
  ).toMatchObject({
    role: "review",
    head: current.config.base,
    offline: true,
    frozenLockfile: true,
    ignoreScripts: true,
    status: "complete",
  });

  await rm(resolve(current.config.pilotWorktree, "node_modules/.modules.yaml"));
  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "dependency-state-drift:pilot" });
  expect(current.installs()).toBe(3);
}, 30_000);

it("rejects path and branch collisions before creating any selected worktree", async () => {
  const pathCollision = await fixture();
  await mkdir(pathCollision.config.sourceWorktree);
  await writeFile(resolve(pathCollision.config.sourceWorktree, "unrelated.txt"), "preserve\n");
  await expect(
    setupStep(pathCollision.config, pathCollision.adapter, pathCollision.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "worktree-collision:source" });
  await expect(access(pathCollision.config.pilotWorktree)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    await readFile(resolve(pathCollision.config.sourceWorktree, "unrelated.txt"), "utf8"),
  ).toBe("preserve\n");

  const branchCollision = await fixture();
  await git(branchCollision.repository, ["branch", branchCollision.config.sourceBranch]);
  await expect(
    setupStep(
      branchCollision.config,
      branchCollision.adapter,
      branchCollision.config.controllerRoot,
    ),
  ).rejects.toMatchObject({ reason: "worktree-collision:source" });
  await expect(access(branchCollision.config.pilotWorktree)).rejects.toMatchObject({
    code: "ENOENT",
  });
}, 30_000);

it("fails closed on a moving base and on dirty reconciled state", async () => {
  const moving = await fixture();
  await git(moving.repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "moving base",
  ]);
  await expect(
    setupStep(moving.config, moving.adapter, moving.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "setup-authority-head-drift" });
  await expect(access(moving.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });

  const dirty = await fixture();
  await setupStep(dirty.config, dirty.adapter, dirty.config.controllerRoot);
  await writeFile(resolve(dirty.config.reviewWorktree, "unrelated.txt"), "dirty\n");
  await expect(
    setupStep(dirty.config, dirty.adapter, dirty.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "worktree-collision:review" });
  expect(await readFile(resolve(dirty.config.reviewWorktree, "unrelated.txt"), "utf8")).toBe(
    "dirty\n",
  );
}, 30_000);

it("rejects checkout-contained state before Git or installer mutation", async () => {
  const current = await fixture();
  current.config.stateDirectory = resolve(current.repository, "contained state");
  await mkdir(current.config.stateDirectory);
  synchronizeAuthority(current.config);

  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "overlapping-setup-paths" });
  expect(current.installs()).toBe(0);
  await expect(access(current.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });
});

it("loads the TypeScript composition directly in Node and emits only a bounded refusal", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "setup-composition-fixture-"));
  roots.push(root);
  const request = resolve(root, "setup-request.json");
  await writeFile(request, "{}\n");

  await expect(
    run(
      process.execPath,
      [resolve(import.meta.dirname, "../../scripts/dogfood/prepare.mjs"), request],
      {
        windowsHide: true,
      },
    ),
  ).rejects.toMatchObject({
    stderr: `${JSON.stringify({ status: "blocked", reason: "malformed-setup-config" })}\n`,
  });
});

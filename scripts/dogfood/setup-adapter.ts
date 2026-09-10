import { execFile, spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { resolvePnpmLauncher, type PnpmLauncher } from "../pnpm-launcher.mjs";
import {
  SetupBlocked,
  type SetupAdapter,
  type SetupConfig,
  type SetupRole,
  type WorktreeObservation,
} from "./setup.mjs";

const exec = promisify(execFile);

export interface SetupAdapterOptions {
  gitExecutable?: string;
  install?: (
    launcher: PnpmLauncher,
    args: string[],
    cwd: string,
  ) => Promise<"succeeded" | "failed" | "unknown">;
}

async function command(executable: string, args: string[], cwd: string) {
  return exec(executable, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function git(
  executable: string,
  config: SetupConfig,
  args: string[],
  cwd = config.repositoryRoot,
) {
  return (await command(executable, args, cwd)).stdout.trim();
}

function rolePath(config: SetupConfig, role: SetupRole) {
  if (role === "pilot") return config.pilotWorktree;
  if (role === "source") return config.sourceWorktree;
  return config.reviewWorktree;
}

function roleHead(config: SetupConfig, role: SetupRole) {
  return role === "pilot" ? config.pilotRevision : config.base;
}

function roleBranch(config: SetupConfig, role: SetupRole) {
  return role === "source" ? config.sourceBranch : null;
}

function comparable(path: string) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function overlaps(left: string, right: string) {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  const outside = (value: string) =>
    value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
  return !outside(fromLeft) || !outside(fromRight);
}

async function canonicalFuture(path: string) {
  let cursor = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(cursor.slice(parent.length).replace(/^[/\\]/, ""));
      cursor = parent;
    }
  }
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

interface GitWorktree {
  path: string;
  head?: string;
  branch?: string;
}

async function worktrees(executable: string, config: SetupConfig) {
  const fields = (await git(executable, config, ["worktree", "list", "--porcelain", "-z"])).split(
    "\0",
  );
  const rows: GitWorktree[] = [];
  let row: GitWorktree | undefined;
  for (const field of fields) {
    if (field === "") {
      if (row) rows.push(row);
      row = undefined;
    } else if (field.startsWith("worktree ")) {
      if (row) rows.push(row);
      row = { path: field.slice(9) };
    } else if (field.startsWith("HEAD ") && row) row.head = field.slice(5);
    else if (field.startsWith("branch ") && row) row.branch = field.slice(7);
  }
  if (row) rows.push(row);
  return rows;
}

async function branchHead(executable: string, config: SetupConfig, branch: string) {
  await git(executable, config, ["check-ref-format", "--branch", branch]);
  const expectedRef = `refs/heads/${branch}`;
  const output = await git(executable, config, [
    "for-each-ref",
    "--count=1",
    "--format=%(refname)%00%(objectname)",
    expectedRef,
  ]);
  if (output === "") return undefined;

  const [actualRef, head, ...unexpected] = output.split("\0");
  if (
    unexpected.length !== 0 ||
    !actualRef ||
    !head ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ||
    (actualRef !== expectedRef && !actualRef.startsWith(`${expectedRef}/`))
  )
    throw new Error("malformed branch lookup");
  return actualRef === expectedRef ? head : undefined;
}

async function commonDirectory(executable: string, config: SetupConfig, cwd: string) {
  return realpath(
    resolve(cwd, await git(executable, config, ["rev-parse", "--git-common-dir"], cwd)),
  );
}

async function assertClean(executable: string, config: SetupConfig, cwd: string) {
  if (
    (await git(executable, config, ["status", "--porcelain", "--untracked-files=all"], cwd)) !== ""
  )
    throw new SetupBlocked("dirty-setup-repository");
}

async function defaultInstall(launcher: PnpmLauncher, args: string[], cwd: string) {
  return new Promise<"succeeded" | "failed" | "unknown">((done) => {
    let settled = false;
    const child = spawn(launcher.executable, [...launcher.prefixArgs, ...args], {
      cwd,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", () => {
      if (!settled) {
        settled = true;
        done("unknown");
      }
    });
    child.once("close", (code) => {
      if (!settled) {
        settled = true;
        done(code === 0 ? "succeeded" : "failed");
      }
    });
  });
}

export function gitSetupAdapter(options: SetupAdapterOptions = {}): SetupAdapter {
  const install = options.install ?? defaultInstall;
  const gitExecutable = options.gitExecutable ?? "git";

  return {
    async assertAuthority(config, executingRoot) {
      try {
        const [actualExecuting, controller, repository, state] = await Promise.all([
          realpath(executingRoot),
          realpath(config.controllerRoot),
          realpath(config.repositoryRoot),
          realpath(config.stateDirectory),
        ]);
        if (comparable(actualExecuting) !== comparable(controller))
          throw new SetupBlocked("controller-path-mismatch");
        const [controllerCommon, repositoryCommon] = await Promise.all([
          commonDirectory(gitExecutable, config, controller),
          commonDirectory(gitExecutable, config, repository),
        ]);
        if (comparable(controllerCommon) !== comparable(repositoryCommon))
          throw new SetupBlocked("setup-repository-mismatch");
        const [statePath, ...requestedPaths] = await Promise.all(
          [
            config.stateDirectory,
            config.pilotWorktree,
            config.sourceWorktree,
            config.reviewWorktree,
          ].map(async (path) => comparable(await canonicalFuture(path))),
        );
        const registered = await worktrees(gitExecutable, config);
        const registeredPaths = await Promise.all(
          registered.map(async (row) => comparable(await canonicalFuture(row.path))),
        );
        const commonPath = comparable(repositoryCommon);
        const existingCheckoutPaths = [...registeredPaths, commonPath];
        if (existingCheckoutPaths.some((checkout) => overlaps(statePath!, checkout)))
          throw new SetupBlocked("setup-path-inside-existing-checkout");
        if (
          requestedPaths.some(
            (path) =>
              overlaps(path, commonPath) ||
              registeredPaths.some((checkout) => path !== checkout && overlaps(path, checkout)),
          )
        )
          throw new SetupBlocked("setup-path-overlaps-existing-checkout");

        const [controllerHead, repositoryHead, repositoryBranch, pilotObject, baseObject] =
          await Promise.all([
            git(gitExecutable, config, ["rev-parse", "HEAD"], controller),
            git(gitExecutable, config, ["rev-parse", "HEAD"], repository),
            git(gitExecutable, config, ["branch", "--show-current"], repository),
            git(gitExecutable, config, [
              "rev-parse",
              "--verify",
              `${config.pilotRevision}^{commit}`,
            ]),
            git(gitExecutable, config, ["rev-parse", "--verify", `${config.base}^{commit}`]),
          ]);
        if (
          controllerHead !== config.controllerRevision ||
          pilotObject !== config.pilotRevision ||
          repositoryHead !==
            (comparable(repository) === comparable(controller)
              ? config.controllerRevision
              : config.base) ||
          baseObject !== config.base ||
          repositoryBranch !== config.baseBranch
        )
          throw new SetupBlocked("setup-authority-head-drift");
        await Promise.all([
          git(gitExecutable, config, ["check-ref-format", "--branch", config.baseBranch]),
          git(gitExecutable, config, ["check-ref-format", "--branch", config.sourceBranch]),
          assertClean(gitExecutable, config, controller),
          assertClean(gitExecutable, config, repository),
        ]);
      } catch (error) {
        if (error instanceof SetupBlocked) throw error;
        throw new SetupBlocked("setup-authority-unverified");
      }
    },

    async observeWorktree(config, role, owned): Promise<WorktreeObservation> {
      try {
        const target = comparable(await canonicalFuture(rolePath(config, role)));
        const rows = await worktrees(gitExecutable, config);
        const matches: GitWorktree[] = [];
        for (const row of rows) {
          if (comparable(await canonicalFuture(row.path)) === target) matches.push(row);
        }
        if (matches.length > 1) return { state: "collision" };
        const expectedBranch = roleBranch(config, role);
        if (matches.length === 1) {
          const row = matches[0]!;
          if (!(await exists(rolePath(config, role)))) return { state: "collision" };
          const actual = await realpath(rolePath(config, role));
          if (comparable(actual) !== target) return { state: "collision" };
          const common = await commonDirectory(gitExecutable, config, actual);
          const repositoryCommon = await commonDirectory(
            gitExecutable,
            config,
            config.repositoryRoot,
          );
          if (comparable(common) !== comparable(repositoryCommon)) return { state: "collision" };
          const [head, branch, dirty] = await Promise.all([
            git(gitExecutable, config, ["rev-parse", "HEAD"], actual),
            git(gitExecutable, config, ["branch", "--show-current"], actual),
            git(gitExecutable, config, ["status", "--porcelain", "--untracked-files=all"], actual),
          ]);
          if (
            row.head !== head ||
            head !== roleHead(config, role) ||
            (expectedBranch === null
              ? branch !== "" || row.branch !== undefined
              : branch !== expectedBranch || row.branch !== `refs/heads/${expectedBranch}`) ||
            dirty !== ""
          )
            return { state: "collision" };
          return { state: "confirmed", head, branch: expectedBranch };
        }

        if (await exists(rolePath(config, role))) return { state: "collision" };
        if (expectedBranch !== null) {
          const existingHead = await branchHead(gitExecutable, config, expectedBranch);
          if (existingHead !== undefined) {
            if (!owned || existingHead !== roleHead(config, role)) return { state: "collision" };
            if (rows.some((row) => row.branch === `refs/heads/${expectedBranch}`))
              return { state: "collision" };
          }
        }
        return { state: "absent" };
      } catch {
        return { state: "unknown" };
      }
    },

    async createWorktree(config, role) {
      const path = rolePath(config, role);
      if (role === "source") {
        const existing = await branchHead(gitExecutable, config, config.sourceBranch);
        if (existing === undefined)
          await git(gitExecutable, config, [
            "-c",
            "core.autocrlf=false",
            "worktree",
            "add",
            "-b",
            config.sourceBranch,
            path,
            config.base,
          ]);
        else {
          if (existing !== config.base) throw new SetupBlocked("source-branch-head-drift");
          await git(gitExecutable, config, [
            "-c",
            "core.autocrlf=false",
            "worktree",
            "add",
            path,
            config.sourceBranch,
          ]);
        }
      } else {
        await git(gitExecutable, config, [
          "-c",
          "core.autocrlf=false",
          "worktree",
          "add",
          "--detach",
          path,
          roleHead(config, role),
        ]);
      }
    },

    async observeDependencies(config, role) {
      try {
        const marker = await lstat(resolve(rolePath(config, role), "node_modules/.modules.yaml"));
        return marker.isFile() ? "present" : "unknown";
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown";
      }
    },

    async installDependencies(config, role) {
      try {
        const launcher = await resolvePnpmLauncher();
        return await install(
          launcher,
          ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
          rolePath(config, role),
        );
      } catch {
        return "unknown";
      }
    },
  };
}

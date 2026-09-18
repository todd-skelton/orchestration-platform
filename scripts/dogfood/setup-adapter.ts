import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, realpath, writeFile, type FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { resolvePnpmLauncher, type PnpmLauncher } from "../pnpm-launcher.mjs";
import {
  SetupBlocked,
  type SetupAdapter,
  type SetupConfig,
  type SetupRole,
  type WorktreeObservation,
  type InstallResult,
} from "./setup.mjs";

const exec = promisify(execFile);

export interface SetupAdapterOptions {
  gitExecutable?: string;
  resolveLauncher?: () => Promise<PnpmLauncher>;
  writeInstallOutput?: (file: FileHandle, bytes: Buffer) => Promise<void>;
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

// Setup alone owns this byte filter. Pending lookahead is at most 19 bytes;
// suppression holds no line, URL or secret, regardless of its length.
export class SetupOutputSanitizer {
  private pending: { byte: number; field: number }[] = [];
  private suppression: "line" | "url" | undefined;
  private readonly markers = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "_authtoken",
    "_auth",
    "_password",
    "//",
    "file:",
  ];

  private readonly emit: (byte: number, field: number) => void;

  constructor(emit: (byte: number, field: number) => void) {
    this.emit = emit;
  }

  write(bytes: Uint8Array, field = 0) {
    for (const byte of bytes) {
      if (this.suppression) {
        const delimiter =
          this.suppression === "line"
            ? byte === 10 || byte === 13
            : byte === 32 || (byte >= 9 && byte <= 13);
        if (delimiter) {
          this.suppression = undefined;
          this.emit(byte, field);
        }
        continue;
      }
      this.pending.push({ byte, field });
      while (this.pending.length) {
        const prefix = String.fromCharCode(...this.pending.map(({ byte }) => byte)).toLowerCase();
        const match = this.markers.find((marker) => marker === prefix);
        if (match) {
          for (const byte of Buffer.from("[REDACTED]")) this.emit(byte, this.pending[0]!.field);
          this.pending = [];
          this.suppression = match === "//" || match === "file:" ? "url" : "line";
          break;
        }
        if (this.markers.some((marker) => marker.startsWith(prefix))) break;
        const safe = this.pending.shift()!;
        this.emit(safe.byte, safe.field);
      }
    }
  }

  end() {
    for (const { byte, field } of this.pending) this.emit(byte, field);
    this.pending = [];
  }
}

function sanitizeFields(fields: string[]) {
  const output = fields.map(() => [] as number[]);
  const sanitizer = new SetupOutputSanitizer((byte, field) => output[field]!.push(byte));
  fields.forEach((field, index) => sanitizer.write(Buffer.from(field), index));
  sanitizer.end();
  return output.map((bytes) => Buffer.from(bytes).toString("utf8"));
}

function safeError(error: unknown) {
  const value = error as NodeJS.ErrnoException | undefined;
  return Object.fromEntries(
    ["code", "syscall", "path"].flatMap((key) => {
      const field = value?.[key as keyof NodeJS.ErrnoException];
      return typeof field === "string" ? [[key, sanitizeFields([field])[0]]] : [];
    }),
  );
}

async function readable(stream: Readable) {
  if (stream.readableEnded) return;
  await new Promise<void>((done, fail) => {
    const cleanup = () => {
      stream.off("readable", ready);
      stream.off("end", ready);
      stream.off("close", ready);
      stream.off("error", failed);
    };
    const ready = () => {
      cleanup();
      done();
    };
    const failed = (error: Error) => {
      cleanup();
      fail(error);
    };
    stream.once("readable", ready);
    stream.once("end", ready);
    stream.once("close", ready);
    stream.once("error", failed);
  });
}

async function defaultInstall(
  config: SetupConfig,
  role: SetupRole,
  options: SetupAdapterOptions,
): Promise<InstallResult> {
  const prefix = resolve(
    config.stateDirectory,
    `dependency-${role}-install-${Date.now()}-${randomUUID()}`,
  );
  const diagnostics = `${prefix}.json`;
  const stdout = `${prefix}.stdout.log`;
  const stderr = `${prefix}.stderr.log`;
  const terminal = `${prefix}.terminal.json`;
  const cwd = rolePath(config, role);
  const args = ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"];
  const files: FileHandle[] = [];
  let launcher: PnpmLauncher | undefined;
  let failure: { stage: string; error: ReturnType<typeof safeError> } | undefined;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let stage = "launcher";
  let metadataWritten = false;
  try {
    launcher = await (options.resolveLauncher ?? resolvePnpmLauncher)();
  } catch (error) {
    failure = { stage, error: safeError(error) };
  }
  const metadata = {
    role,
    head: roleHead(config, role),
    cwd: sanitizeFields([cwd])[0],
    executable: launcher ? sanitizeFields([launcher.executable])[0] : null,
    argv: sanitizeFields([...(launcher?.prefixArgs ?? []), ...args]),
    stdout: sanitizeFields([stdout])[0],
    stderr: sanitizeFields([stderr])[0],
    terminal: sanitizeFields([terminal])[0],
  };
  try {
    stage = "capture";
    await writeFile(diagnostics, JSON.stringify(metadata, null, 2) + "\n", {
      flag: "wx",
      flush: true,
    });
    metadataWritten = true;
    for (const path of [stdout, stderr]) files.push(await open(path, "wx"));
    if (launcher && !failure) {
      stage = "spawn";
      const child = spawn(launcher.executable, [...launcher.prefixArgs, ...args], {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = new Promise<void>((done) => {
        child.once("error", (error) => {
          failure ??= { stage: "spawn", error: safeError(error) };
        });
        child.once("close", (code, childSignal) => {
          exitCode = code;
          signal = childSignal;
          done();
        });
      });
      const pump = async (stream: Readable, file: FileHandle) => {
        // Keep a readable listener even while awaiting disk backpressure. Node's
        // child-exit flush otherwise resumes the pipe and discards unread bytes.
        const keepPaused = () => {};
        const captureError = (error: Error) => {
          failure ??= { stage: "capture", error: safeError(error) };
          child.kill("SIGKILL");
        };
        stream.on("readable", keepPaused);
        stream.on("error", captureError);
        let output: number[] = [];
        const sanitizer = new SetupOutputSanitizer((byte) => output.push(byte));
        const flush = async () => {
          if (!output.length) return;
          const bytes = Buffer.from(output);
          output = [];
          await (options.writeInstallOutput ?? ((file, bytes) => file.writeFile(bytes)))(
            file,
            bytes,
          );
        };
        try {
          while (!stream.readableEnded && !stream.destroyed) {
            const bytes = stream.read(
              Math.min(16 * 1024, stream.readableLength || 16 * 1024),
            ) as Buffer | null;
            if (bytes === null) {
              await readable(stream);
              continue;
            }
            sanitizer.write(bytes);
            await flush();
          }
          sanitizer.end();
          await flush();
        } catch (error) {
          failure ??= { stage: "capture", error: safeError(error) };
          // Reap the owned process and drain both pipes before closing files.
          child.kill("SIGKILL");
          stream.off("readable", keepPaused);
          stream.resume();
        } finally {
          stream.off("readable", keepPaused);
        }
      };
      await Promise.all([pump(child.stdout, files[0]!), pump(child.stderr, files[1]!), closed]);
    }
  } catch (error) {
    failure ??= { stage, error: safeError(error) };
  } finally {
    for (const file of files) {
      try {
        await file.sync();
      } catch (error) {
        failure ??= { stage: "flush", error: safeError(error) };
      }
      try {
        await file.close();
      } catch (error) {
        failure ??= { stage: "close", error: safeError(error) };
      }
    }
  }
  const status = failure ? "unknown" : exitCode === 0 ? "succeeded" : "failed";
  try {
    await writeFile(
      terminal,
      JSON.stringify(
        { ...metadata, status, exitCode, signal, ...(failure ? { failure } : {}) },
        null,
        2,
      ) + "\n",
      { flag: "wx", flush: true },
    );
  } catch {
    throw new SetupBlocked("dependency-install-unknown", diagnostics);
  }
  return { status, diagnostics: metadataWritten ? diagnostics : terminal };
}

export function gitSetupAdapter(options: SetupAdapterOptions = {}): SetupAdapter {
  const gitExecutable = options.gitExecutable ?? "git";

  return {
    async assertExecutor(config, executingRoot, matchedReplay = false) {
      try {
        const [actualExecuting, controller, repository, state] = await Promise.all([
          realpath(executingRoot),
          realpath(config.controllerRoot),
          realpath(config.repositoryRoot),
          realpath(config.stateDirectory),
        ]);
        if (comparable(actualExecuting) !== comparable(controller))
          throw new SetupBlocked("controller-path-mismatch");
        const repositoryCommon = await commonDirectory(gitExecutable, config, repository);
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

        const [
          controllerTop,
          controllerHead,
          repositoryTop,
          repositoryHead,
          repositoryBranch,
          pilotObject,
          baseObject,
        ] = await Promise.all([
          git(gitExecutable, config, ["rev-parse", "--show-toplevel"], controller),
          git(gitExecutable, config, ["rev-parse", "HEAD"], controller),
          git(gitExecutable, config, ["rev-parse", "--show-toplevel"], repository),
          git(gitExecutable, config, ["rev-parse", "HEAD"], repository),
          git(gitExecutable, config, ["branch", "--show-current"], repository),
          git(gitExecutable, config, ["rev-parse", "--verify", `${config.pilotRevision}^{commit}`]),
          git(gitExecutable, config, ["rev-parse", "--verify", `${config.base}^{commit}`]),
        ]);
        if (
          comparable(await realpath(controllerTop)) !== comparable(controller) ||
          controllerHead !== config.controllerRevision ||
          comparable(await realpath(repositoryTop)) !== comparable(repository) ||
          pilotObject !== config.pilotRevision ||
          repositoryHead !==
            (matchedReplay && comparable(repository) === comparable(controller)
              ? config.controllerRevision
              : config.pilotRevision) ||
          baseObject !== config.base ||
          repositoryBranch !== config.baseBranch
        )
          throw new SetupBlocked("setup-head-drift");
        await Promise.all([
          git(gitExecutable, config, ["check-ref-format", "--branch", config.baseBranch]),
          git(gitExecutable, config, ["check-ref-format", "--branch", config.sourceBranch]),
          assertClean(gitExecutable, config, controller),
          assertClean(gitExecutable, config, repository),
        ]);
      } catch (error) {
        if (error instanceof SetupBlocked) throw error;
        throw new SetupBlocked("setup-state-unverified");
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
          const holder = rows.find((row) => row.branch === `refs/heads/${expectedBranch}`);
          if (holder) return { state: "collision", collisionPath: resolve(holder.path) };
          const existingHead = await branchHead(gitExecutable, config, expectedBranch);
          if (existingHead !== undefined) {
            if (!owned || existingHead !== roleHead(config, role)) return { state: "collision" };
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
      if (!options.install) return defaultInstall(config, role, options);
      try {
        const launcher = await (options.resolveLauncher ?? resolvePnpmLauncher)();
        return await options.install(
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

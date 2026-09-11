import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolvePnpmLauncher, type PnpmLauncher } from "../pnpm-launcher.mjs";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked } from "./flow.ts";
import type { Adapter, Attempt, Config, Role, Terminal } from "./flow.js";
import { MAX_TERMINAL_SUMMARY_LENGTH, terminalSummary } from "./terminal-summary.mjs";

const exec = promisify(execFile);
const EXIT_RECEIPT_WINDOW_MS = 30_000;
const check = (ok: unknown, reason: string) => {
  if (!ok) throw new QueueBlocked(reason);
};
async function optionalText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const artifact = (config: Config, role: Role, launch: string, suffix: string) =>
  resolve(config.stateDirectory, `${role}-${launch}.${suffix}`);
const attemptArtifact = (attempt: Attempt, suffix: string) =>
  `${attempt.trace.slice(0, -"jsonl".length)}${suffix}`;
export const authorTemporaryRoot = (config: Config) =>
  resolve(config.stateDirectory, "author-temp");
const toml = (value: string) => JSON.stringify(value);
const shell = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
function authorEnvironment(config: Config, environment: NodeJS.ProcessEnv) {
  const temporary = authorTemporaryRoot(config);
  return {
    ...environment,
    PATH: `${temporary}${delimiter}${environment.PATH ?? ""}`,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
  };
}
const expectedPnpmVersion = async (config: Config) => {
  const value = JSON.parse(
    await readFile(resolve(config.worktree, "package.json"), "utf8"),
  ).packageManager;
  check(
    typeof value === "string" && /^pnpm@\d+\.\d+\.\d+$/.test(value),
    "author-offline-pnpm-unavailable",
  );
  return value.slice("pnpm@".length);
};
function pnpmWrapper(launcher: PnpmLauncher) {
  return `const { spawnSync } = require("node:child_process");
const result = spawnSync(${JSON.stringify(launcher.executable)}, ${JSON.stringify(launcher.prefixArgs)}.concat(process.argv.slice(2)), { stdio: "inherit", env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
}
export async function prepareAuthorRuntime(
  config: Config,
  launcherResolver: () => Promise<PnpmLauncher> = resolvePnpmLauncher,
) {
  const temporary = authorTemporaryRoot(config);
  try {
    await mkdir(temporary, { recursive: true });
    const probe = await mkdtemp(resolve(temporary, "preflight-"));
    await rm(probe, { recursive: true });
  } catch {
    throw new QueueBlocked("author-temp-unavailable");
  }
  let launcher: PnpmLauncher;
  try {
    launcher = await launcherResolver();
  } catch {
    throw new QueueBlocked("author-offline-pnpm-unavailable");
  }
  const wrapper = resolve(temporary, "pnpm.cjs");
  try {
    const files = [
      [wrapper, pnpmWrapper(launcher)],
      [resolve(temporary, "pnpm.cmd"), `@"${process.execPath}" "${wrapper}" %*\r\n`],
      [
        resolve(temporary, "pnpm"),
        `#!/bin/sh\nexec ${shell(process.execPath)} ${shell(wrapper)} "$@"\n`,
      ],
    ] as const;
    for (const [path, bytes] of files) {
      try {
        await writeFile(path, bytes, { flag: "wx" });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readFile(path, "utf8")) !== bytes
        )
          throw error;
      }
    }
    await chmod(resolve(temporary, "pnpm"), 0o755);
  } catch {
    throw new QueueBlocked("author-temp-unavailable");
  }
  let versionDirectory: string;
  try {
    versionDirectory = await mkdtemp(resolve(temporary, "pnpm-version-"));
  } catch {
    throw new QueueBlocked("author-temp-unavailable");
  }
  try {
    const versionPath = resolve(versionDirectory, "stdout.txt");
    const output = await open(versionPath, "w");
    try {
      await new Promise<void>((done, reject) => {
        let timedOut = false;
        const child = spawn(launcher.executable, [...launcher.prefixArgs, "--version"], {
          cwd: config.worktree,
          windowsHide: true,
          stdio: ["ignore", output.fd, "ignore"],
          env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, 15_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (timedOut || code !== 0) reject(new Error("pnpm version unavailable"));
          else done();
        });
      });
    } finally {
      await output.close();
    }
    const version = (await readFile(versionPath, "utf8")).trim();
    check(version === (await expectedPnpmVersion(config)), "author-offline-pnpm-unavailable");
  } catch {
    throw new QueueBlocked("author-offline-pnpm-unavailable");
  } finally {
    try {
      await rm(versionDirectory, { recursive: true, force: true });
    } catch {
      throw new QueueBlocked("author-temp-unavailable");
    }
  }
}
// POSIX copies only these exact spellings. Windows environment names are
// case-insensitive, so an allowed alias is copied once under this canonical spelling.
export const WORKER_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "CODEX_HOME",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;
// libuv supplies these Windows startup names from its own process if omitted.
// Make them explicit, rather than treating native additions as unknown inheritance.
export const WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST = [
  "LOGONSERVER",
  "SYSTEMDRIVE",
  "USERDOMAIN",
  "USERNAME",
] as const;
export function workerEnvironment(
  environment: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = Object.create(null);
  const names = Object.keys(environment);
  const allowedNames = [
    ...WORKER_ENVIRONMENT_ALLOWLIST,
    ...(platform === "win32" ? WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST : []),
  ];
  for (const allowed of allowedNames) {
    const name =
      names.find((candidate) => candidate === allowed) ??
      (platform === "win32"
        ? names.find((candidate) => candidate.toUpperCase() === allowed)
        : undefined);
    if (name !== undefined && environment[name] !== undefined) child[allowed] = environment[name];
  }
  // Node normally copies ambient coverage even with an explicit env. An own,
  // non-enumerable undefined entry prevents that copy and is never transported.
  Object.defineProperty(child, "NODE_V8_COVERAGE", { value: undefined });
  // Refuse any later JS-runtime attempt to append non-allowlisted environment.
  return Object.freeze(child);
}
export async function launchObserver(
  request: string,
  observer = fileURLToPath(new URL("./observe-process.mjs", import.meta.url)),
  environment = process.env,
) {
  const child = spawn(process.execPath, [observer, request], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: workerEnvironment(environment),
  });
  await new Promise<void>((done, reject) => {
    child.once("spawn", done);
    child.once("error", reject);
  });
  child.unref();
}
export function launchArguments(
  config: Config,
  role: Role,
  platform = process.platform,
  schema = resolve(config.stateDirectory, `${role}.output-schema.json`),
) {
  check(
    Object.keys(config.adapter).every((key) => ["kind", "executable"].includes(key)),
    "unsupported-adapter-configuration",
  );
  return [
    "exec",
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "-C",
    role === "author" ? config.worktree : config.reviewWorktree,
    "-m",
    config[role].model,
    "-c",
    `model_reasoning_effort=${config[role].effort}`,
    "-c",
    'approval_policy="never"',
    ...(platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []),
    "-c",
    "sandbox_workspace_write.exclude_slash_tmp=true",
    "-c",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c",
    role === "author"
      ? `sandbox_workspace_write.writable_roots=[${toml(authorTemporaryRoot(config))}]`
      : "sandbox_workspace_write.writable_roots=[]",
    ...(role === "author"
      ? [
          "-c",
          `shell_environment_policy.set={ TEMP=${toml(authorTemporaryRoot(config))}, TMP=${toml(authorTemporaryRoot(config))}, TMPDIR=${toml(authorTemporaryRoot(config))}, PATH=${toml(`${authorTemporaryRoot(config)}${delimiter}${process.env.PATH ?? ""}`)}, COREPACK_ENABLE_NETWORK="0" }`,
        ]
      : []),
    "--output-schema",
    schema,
    "-s",
    role === "author" ? "workspace-write" : "read-only",
    "-",
  ];
}
function events(trace: string, complete: boolean): any[] {
  const lines = trace.split(/\r?\n/);
  if (!complete && !trace.endsWith("\n")) lines.pop();
  return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
}
export function parseTrace(
  trace: string,
  complete: boolean,
  role: Role,
  config: Config,
  expected?: string,
): Terminal {
  const rows = events(trace, complete);
  const ids = rows.filter((row) => row.type === "thread.started").map((row) => row.thread_id);
  check(
    ids.length === 1 && typeof ids[0] === "string" && /^[a-f0-9-]{36}$/.test(ids[0]),
    "missing-or-ambiguous-thread-identity",
  );
  const id = ids[0] as string;
  check(expected === undefined || id === expected, "attempt-identity-changed");
  if (!complete) return { id, status: "running" };
  const turns = rows.filter((row) => row.type === "turn.completed");
  check(
    turns.length === 1 && !rows.some((row) => ["turn.failed", "error"].includes(row.type)),
    "missing-successful-terminal",
  );
  const messages = rows.filter(
    (row) => row.type === "item.completed" && row.item?.type === "agent_message",
  );
  let verdict: any;
  try {
    verdict = JSON.parse(messages.at(-1)?.item.text ?? "null");
  } catch {
    throw new Error("malformed-worker-verdict");
  }
  check(
    verdict &&
      typeof verdict.run === "string" &&
      typeof verdict.role === "string" &&
      /^[a-f0-9]{40}$/.test(verdict.head) &&
      ["PASS", "FAIL"].includes(verdict.verdict),
    "malformed-worker-verdict",
  );
  check(
    verdict.run === config.run && verdict.role === role,
    "worker-verdict-identity-mismatch:malformed-worker-verdict-compatibility",
  );
  check(
    role === "reviewer"
      ? Object.keys(verdict).length === 6 &&
          ["run", "role", "head", "verdict", "findings", "g0"].every((key) =>
            Object.hasOwn(verdict, key),
          ) &&
          Array.isArray(verdict.findings) &&
          typeof verdict.g0 === "string" &&
          JSON.stringify(verdict).length <= MAX_TERMINAL_SUMMARY_LENGTH
      : Object.keys(verdict).length === 5 &&
          ["run", "role", "head", "verdict", "summary"].every((key) =>
            Object.hasOwn(verdict, key),
          ) &&
          typeof verdict.summary === "string" &&
          verdict.summary.length <= MAX_TERMINAL_SUMMARY_LENGTH,
    "malformed-worker-verdict",
  );
  const summary = role === "reviewer" ? JSON.stringify(verdict) : terminalSummary(verdict.summary);
  return {
    id,
    status: verdict.verdict === "PASS" ? "passed" : "failed",
    head: verdict.head,
    usage: turns[0].usage,
    ...(summary ? { summary } : {}),
  };
}
export function outputSchema(config: Config, role: Role) {
  if (role === "reviewer")
    return {
      type: "object",
      additionalProperties: false,
      required: ["run", "role", "head", "verdict", "findings", "g0"],
      properties: {
        run: { type: "string", enum: [config.run] },
        role: { type: "string", enum: [role] },
        head: { type: "string", pattern: "^[a-f0-9]{40}$" },
        verdict: { type: "string", enum: ["PASS", "FAIL"] },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["file", "line", "severity", "text"],
            properties: {
              file: { type: "string" },
              line: { type: "integer", minimum: 1 },
              severity: { type: "string", enum: ["blocking", "note"] },
              text: { type: "string" },
            },
          },
        },
        g0: { type: "string" },
      },
    };
  return {
    type: "object",
    additionalProperties: false,
    required: ["run", "role", "head", "verdict", "summary"],
    properties: {
      run: { type: "string", enum: [config.run] },
      role: { type: "string", enum: [role] },
      head: { type: "string", enum: [config.base] },
      verdict: { type: "string", enum: ["PASS", "FAIL"] },
      summary: {
        type: "string",
        maxLength: MAX_TERMINAL_SUMMARY_LENGTH,
        description: "Short actionable findings; advisory only. Use an empty string when none.",
      },
    },
  };
}
export function codexAdapter(gitExecutable = "git", now = Date.now): Adapter {
  const git = async (worktree: string, gitArgs: string[]) => {
    const { stdout } = await exec(gitExecutable, ["-C", worktree, ...gitArgs], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return gitArgs.includes("-z") ? stdout : stdout.trim();
  };
  return {
    git,
    async preflight(config) {
      launchArguments(config, "author");
      check(
        config.adapter?.kind === "codex-exec" && isAbsolute(config.adapter.executable),
        "host-adapter-unavailable",
      );
      const help = (
        await exec(config.adapter.executable, ["exec", "--help"], { windowsHide: true })
      ).stdout;
      for (const flag of [
        "--json",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "--output-schema",
      ])
        check(help.includes(flag), "incompatible-codex-cli");
      await prepareAuthorRuntime(config);
    },
    async launch(role, config, prompt) {
      const launch = randomUUID();
      await writeFile(artifact(config, role, launch, "prompt.txt"), prompt, { flag: "wx" });
      await writeFile(
        artifact(config, role, launch, "output-schema.json"),
        JSON.stringify(outputSchema(config, role)),
        { flag: "wx" },
      );
      const trace = artifact(config, role, launch, "jsonl");
      const request = artifact(config, role, launch, "request.json");
      await writeFile(
        request,
        JSON.stringify({
          executable: config.adapter.executable,
          args: launchArguments(
            config,
            role,
            process.platform,
            artifact(config, role, launch, "output-schema.json"),
          ),
          stdin: artifact(config, role, launch, "prompt.txt"),
          stdout: trace,
          stderr: artifact(config, role, launch, "err.log"),
          identity: artifact(config, role, launch, "process.json"),
          done: artifact(config, role, launch, "exit.json"),
        }),
        { flag: "wx" },
      );
      await launchObserver(
        request,
        undefined,
        role === "author" ? authorEnvironment(config, process.env) : process.env,
      );
      for (let count = 0; count < 120; count++) {
        const identity = await optionalText(artifact(config, role, launch, "process.json"));
        const text = await optionalText(trace);
        if (identity && text.includes('"thread.started"')) {
          const terminal = parseTrace(text, false, role, config);
          return { id: terminal.id, pid: JSON.parse(identity).pid, trace, launchedAt: now() };
        }
        check(
          !(await optionalText(artifact(config, role, launch, "exit.json"))),
          "launcher-exited-before-identity-reconcile",
        );
        await pause(1000);
      }
      throw new QueueBlocked("launch-identity-timeout-reconcile");
    },
    async observe(role, config, attempt: Attempt) {
      const exit = await optionalText(attemptArtifact(attempt, "exit.json"));
      if (exit) check(JSON.parse(exit).code === 0, "launcher-failed");
      else {
        try {
          process.kill(attempt.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            if (now() - attempt.launchedAt < EXIT_RECEIPT_WINDOW_MS)
              return { id: attempt.id, status: "running" };
            throw new QueueBlocked("exit-receipt-timeout");
          }
          throw error;
        }
      }
      const trace = await readFile(attempt.trace, "utf8");
      try {
        return parseTrace(trace, Boolean(exit), role, config, attempt.id);
      } catch (error) {
        if (
          role === "reviewer" &&
          Boolean(exit) &&
          error instanceof Error &&
          error.message === "malformed-worker-verdict"
        )
          return {
            id: attempt.id,
            status: "malformed",
            head: await git(config.reviewWorktree, ["rev-parse", "HEAD"]),
            usage: events(trace, true).find((row) => row.type === "turn.completed")?.usage,
          };
        throw error;
      }
    },
    async checks(config, url) {
      const head = async () =>
        JSON.parse(
          (
            await exec(
              "gh",
              ["pr", "view", url, "--repo", config.repository, "--json", "headRefOid"],
              { windowsHide: true },
            )
          ).stdout,
        ).headRefOid;
      const before = await head();
      let stdout: string;
      try {
        stdout = (
          await exec(
            "gh",
            ["pr", "checks", url, "--repo", config.repository, "--json", "name,bucket,link"],
            { windowsHide: true },
          )
        ).stdout;
      } catch (error) {
        const result = error as { code?: number; stdout?: string };
        if (![1, 8].includes(result.code ?? -1) || !result.stdout) throw error;
        stdout = result.stdout;
      }
      check((await head()) === before, "ci-head-changed-during-observation");
      return { head: before, checks: JSON.parse(stdout) };
    },
  };
}

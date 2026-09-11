import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Adapter, Attempt, Config, Role, Terminal } from "./flow.js";
import { MAX_TERMINAL_SUMMARY_LENGTH, terminalSummary } from "./terminal-summary.mjs";

const exec = promisify(execFile);
const check = (ok: unknown, reason: string) => {
  if (!ok) throw new Error(reason);
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
const artifact = (config: Config, role: Role, suffix: string) =>
  resolve(
    config.stateDirectory,
    `${config.artifactPrefix ? `${config.artifactPrefix}.` : ""}${role}.${suffix}`,
  );
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
) {
  const child = spawn(process.execPath, [observer, request], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: workerEnvironment(process.env),
  });
  await new Promise<void>((done, reject) => {
    child.once("spawn", done);
    child.once("error", reject);
  });
  child.unref();
}
export function launchArguments(config: Config, role: Role, platform = process.platform) {
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
    ...(platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : []),
    "-c",
    "sandbox_workspace_write.exclude_slash_tmp=true",
    "-c",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c",
    "sandbox_workspace_write.writable_roots=[]",
    "--output-schema",
    artifact(config, role, "output-schema.json"),
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
    },
    async launch(role, config, prompt) {
      await writeFile(artifact(config, role, "prompt.txt"), prompt, { flag: "wx" });
      await writeFile(
        artifact(config, role, "output-schema.json"),
        JSON.stringify(outputSchema(config, role)),
        { flag: "wx" },
      );
      const trace = artifact(config, role, "jsonl");
      const request = artifact(config, role, "request.json");
      await writeFile(
        request,
        JSON.stringify({
          executable: config.adapter.executable,
          args: launchArguments(config, role),
          stdin: artifact(config, role, "prompt.txt"),
          stdout: trace,
          stderr: artifact(config, role, "err.log"),
          identity: artifact(config, role, "process.json"),
          done: artifact(config, role, "exit.json"),
        }),
        { flag: "wx" },
      );
      await launchObserver(request);
      for (let count = 0; count < 120; count++) {
        const identity = await optionalText(artifact(config, role, "process.json"));
        const text = await optionalText(trace);
        if (identity && text.includes('"thread.started"')) {
          const terminal = parseTrace(text, false, role, config);
          return { id: terminal.id, pid: JSON.parse(identity).pid, trace };
        }
        check(
          !(await optionalText(artifact(config, role, "exit.json"))),
          "launcher-exited-before-identity-reconcile",
        );
        await pause(1000);
      }
      throw new Error("launch-identity-timeout-reconcile");
    },
    async observe(role, config, attempt: Attempt) {
      const exit = await optionalText(artifact(config, role, "exit.json"));
      if (exit) check(JSON.parse(exit).code === 0, "launcher-failed");
      else {
        try {
          process.kill(attempt.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            const waitPath = artifact(config, role, "exit-wait.json");
            const saved = await optionalText(waitPath);
            const observedAt = now();
            if (!saved) {
              await writeFile(
                waitPath,
                JSON.stringify({
                  reason: "delayed-exit-receipt",
                  count: 1,
                  attempt: attempt.id,
                  observedAt,
                }),
                { flag: "wx", flush: true },
              );
              return { id: attempt.id, status: "running" };
            }
            const wait = JSON.parse(saved);
            check(
              wait?.reason === "delayed-exit-receipt" &&
                wait.count === 1 &&
                wait.attempt === attempt.id &&
                Number.isFinite(wait.observedAt),
              "malformed-exit-wait-record",
            );
            if (observedAt - wait.observedAt < config.exitReceiptWindowMs)
              return { id: attempt.id, status: "running" };
            throw new Error("exit-receipt-timeout");
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

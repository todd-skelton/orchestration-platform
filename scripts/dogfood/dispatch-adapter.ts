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
  resolve(config.stateDirectory, `${role}.${suffix}`);
export function workerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = { ...environment };
  const parentContext = new Set([
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_PERMISSION_PROFILE",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_CI",
    "CODEX_SHELL",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
  ]);
  for (const key of Object.keys(child)) if (parentContext.has(key.toUpperCase())) delete child[key];
  return child;
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
  const verdict = JSON.parse(messages.at(-1)?.item.text ?? "null");
  check(
    verdict &&
      verdict.run === config.run &&
      verdict.role === role &&
      /^[a-f0-9]{40}$/.test(verdict.head) &&
      ["PASS", "FAIL"].includes(verdict.verdict),
    "malformed-worker-verdict",
  );
  const summary = terminalSummary(verdict.summary);
  return {
    id,
    status: verdict.verdict === "PASS" ? "passed" : "failed",
    head: verdict.head,
    usage: turns[0].usage,
    ...(summary ? { summary } : {}),
  };
}
export function outputSchema(config: Config, role: Role) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["run", "role", "head", "verdict", "summary"],
    properties: {
      run: { type: "string", enum: [config.run] },
      role: { type: "string", enum: [role] },
      head:
        role === "author"
          ? { type: "string", enum: [config.base] }
          : { type: "string", pattern: "^[a-f0-9]{40}$" },
      verdict: { type: "string", enum: ["PASS", "FAIL"] },
      summary: {
        type: "string",
        maxLength: MAX_TERMINAL_SUMMARY_LENGTH,
        description: "Short actionable findings; advisory only. Use an empty string when none.",
      },
    },
  };
}
export function codexAdapter(): Adapter {
  const git = async (worktree: string, gitArgs: string[]) => {
    const { stdout } = await exec("git", ["-C", worktree, ...gitArgs], {
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
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./observe-process.mjs", import.meta.url)), request],
        { detached: true, windowsHide: true, stdio: "ignore" },
      );
      await new Promise<void>((done, reject) => {
        child.once("spawn", done);
        child.once("error", reject);
      });
      child.unref();
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
          if ((error as NodeJS.ErrnoException).code === "ESRCH")
            throw new Error("missing-terminal-reconcile");
          throw error;
        }
      }
      return parseTrace(
        await readFile(attempt.trace, "utf8"),
        Boolean(exit),
        role,
        config,
        attempt.id,
      );
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

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
export const DEFAULT_PROVIDER_OUTAGE_CEILING_MS = 30 * 60_000;
type ProviderProbe = (signal: AbortSignal) => Promise<void>;

// ISS-129 recorded multi-minute pool outages; a launch-time probe alone was insufficient.
export async function waitForProvider(
  config: Config,
  probe: ProviderProbe,
  clock = { now: Date.now, pause },
  report: (status: object) => void = (status) =>
    process.stdout.write(`${JSON.stringify(status)}\n`),
) {
  const deadline =
    clock.now() + (config.providerOutageCeilingMs ?? DEFAULT_PROVIDER_OUTAGE_CEILING_MS);
  for (;;) {
    try {
      await probe(AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - clock.now()))));
      return;
    } catch (error) {
      if (error instanceof QueueBlocked && error.reason === "provider-model-refused") throw error;
      const diagnostics = error instanceof Error ? error.message : String(error);
      report({ status: "waiting-provider", run: config.run, issue: config.issue, diagnostics });
      if (clock.now() >= deadline) throw new QueueBlocked("provider-unavailable", diagnostics);
      await clock.pause(Math.min(10_000, deadline - clock.now()));
      if (clock.now() >= deadline) throw new QueueBlocked("provider-unavailable", diagnostics);
    }
  }
}

export async function probeProvider(
  baseUrl: string,
  authCommand: string,
  signal: AbortSignal,
  request = fetch,
  model?: string,
) {
  let token: string;
  try {
    // The executor's Codex home uses this same command for provider auth.
    token = (await exec(authCommand, [], { signal, windowsHide: true })).stdout.trim();
  } catch {
    throw new Error("provider authentication command failed");
  }
  const response = await request(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`provider models probe returned HTTP ${response.status}`);
  }
  if (model) {
    const models = (await response.json()) as { data?: { id: string }[] } | null;
    if (
      !Array.isArray(models?.data) ||
      !models.data.every(
        (entry) => entry && typeof entry.id === "string" && entry.id.trim().length > 0,
      )
    )
      throw new Error("malformed provider models response");
    if (!models.data.some((entry) => entry.id === model))
      throw new QueueBlocked("provider-model-refused", model);
  } else await response.body?.cancel();
}

export function modelRefused(message: string) {
  return /(?:\bmodel\b[^\n]*(?:not found|does not exist|not supported|unsupported|not allowed|access denied)|(?:unsupported|unknown|invalid) model\b|\bmodel_not_found\b)/i.test(
    message,
  );
}

function providerFailure(message: string, baseUrl?: string) {
  return Boolean(
    (baseUrl && message.includes(baseUrl.replace(/\/$/, ""))) ||
    /\b5\d\d\b|\b5xx\b|\bstream disconnect(?:ed|ion)?\b/i.test(message),
  );
}
const artifact = (config: Config, role: Role, launch: string, suffix: string) =>
  resolve(config.stateDirectory, `${role}-${launch}.${suffix}`);
const attemptArtifact = (attempt: Attempt, suffix: string) =>
  `${attempt.trace.slice(0, -"jsonl".length)}${suffix}`;
export const authorTemporaryRoot = (config: Config) =>
  resolve(config.stateDirectory, "author-temp");
const toml = (value: string) => JSON.stringify(value);
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
    "--ignore-rules",
    "-C",
    role === "author" ? config.worktree : config.reviewWorktree,
    "-m",
    config[role].model,
    "-c",
    `model_reasoning_effort=${config[role].effort}`,
    "-c",
    'approval_policy="never"',
    // Captured child-process output is refused by the unelevated Windows sandbox.
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
          `shell_environment_policy.set={ TEMP=${toml(authorTemporaryRoot(config))}, TMP=${toml(authorTemporaryRoot(config))}, TMPDIR=${toml(authorTemporaryRoot(config))}, COREPACK_ENABLE_NETWORK="0" }`,
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
  launcherFailed = false,
  providerBaseUrl = process.env.CODEX_PROVIDER_BASE_URL,
): Terminal {
  const rows = events(trace, complete && !launcherFailed);
  const ids = rows.filter((row) => row.type === "thread.started").map((row) => row.thread_id);
  const receiptOnlyIdentity =
    launcherFailed && (ids.length !== 1 || ids[0] !== expected) ? expected : undefined;
  check(
    (typeof receiptOnlyIdentity === "string" && /^[a-f0-9-]{36}$/.test(receiptOnlyIdentity)) ||
      (ids.length === 1 && typeof ids[0] === "string" && /^[a-f0-9-]{36}$/.test(ids[0])),
    "missing-or-ambiguous-thread-identity",
  );
  const id = receiptOnlyIdentity ?? (ids[0] as string);
  check(
    receiptOnlyIdentity !== undefined || expected === undefined || id === expected,
    "attempt-identity-changed",
  );
  const turns = rows.filter((row) => row.type === "turn.completed");
  const dead = launcherFailed || (turns.length === 0 && rows.at(-1)?.type === "turn.failed");
  if (dead) {
    let summary: string | undefined;
    let outage = false;
    let refusal = false;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.type !== "error" && row?.type !== "turn.failed") continue;
      const message = row?.error?.message ?? row?.message;
      if (typeof message === "string" && message.trim()) {
        outage = providerFailure(message, providerBaseUrl);
        refusal =
          modelRefused(message) &&
          !rows.some(
            (event) =>
              event.type === "item.started" ||
              event.type === "item.completed" ||
              event.type === "turn.completed",
          );
        summary = terminalSummary(message);
        break;
      }
    }
    return {
      id,
      status: "dead",
      ...(summary ? { summary } : {}),
      ...(outage ? { providerFailure: true } : {}),
      ...(refusal ? { modelRefused: true } : {}),
    };
  }
  if (!complete) return { id, status: "running" };
  check(
    turns.length === 1 && !rows.some((row) => row.type === "turn.failed"),
    "missing-successful-terminal",
  );
  const messages = rows.filter(
    (row) => row.type === "item.completed" && row.item?.type === "agent_message",
  );
  let verdict: any;
  try {
    const message = messages.at(-1)?.item.text ?? "null";
    // ISS-150: tolerate reviewer prose before the sole top-level object. Parsing
    // the whole suffix rejects trailing text and additional objects without
    // salvaging a nested object or skipping an earlier verdict.
    const start = role === "reviewer" ? message.indexOf("{") : 0;
    check(start >= 0, "malformed-worker-verdict");
    verdict = JSON.parse(message.slice(start));
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
          typeof verdict.g0 === "string"
      : Object.keys(verdict).length === 5 &&
          ["run", "role", "head", "verdict", "summary"].every((key) =>
            Object.hasOwn(verdict, key),
          ) &&
          typeof verdict.summary === "string" &&
          verdict.summary.length <= MAX_TERMINAL_SUMMARY_LENGTH,
    "malformed-worker-verdict",
  );
  const summary = role === "reviewer" ? JSON.stringify(verdict) : terminalSummary(verdict.summary);
  if (role === "reviewer" && summary && summary.length > MAX_TERMINAL_SUMMARY_LENGTH)
    throw new QueueBlocked(
      "malformed-worker-verdict",
      `Reviewer verdict serialized length is ${summary.length} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}. Shorten findings and G0 to fit.`,
    );
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
    async waitForProvider(config) {
      const baseUrl = process.env.CODEX_PROVIDER_BASE_URL;
      const authCommand = process.env.CODEX_PROVIDER_AUTH_COMMAND;
      check(baseUrl && authCommand, "provider-configuration-unavailable");
      await waitForProvider(config, (signal) => probeProvider(baseUrl!, authCommand!, signal));
    },
    async preflight(config) {
      launchArguments(config, "author");
      check(
        config.adapter?.kind === "codex-exec" && isAbsolute(config.adapter.executable),
        "host-adapter-unavailable",
      );
      const help = (
        await exec(config.adapter.executable, ["exec", "--help"], { windowsHide: true })
      ).stdout;
      for (const flag of ["--json", "--ignore-rules", "--sandbox", "--output-schema"])
        check(help.includes(flag), "incompatible-codex-cli");
    },
    async launch(role, config, prompt) {
      const baseUrl = process.env.CODEX_PROVIDER_BASE_URL;
      const authCommand = process.env.CODEX_PROVIDER_AUTH_COMMAND;
      if (baseUrl && authCommand)
        await waitForProvider(config, (signal) =>
          probeProvider(baseUrl, authCommand, signal, fetch, config[role].model),
        );
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
      await launchObserver(request);
      for (let count = 0; count < 120; count++) {
        const identity = await optionalText(artifact(config, role, launch, "process.json"));
        const text = await optionalText(trace);
        const exit = await optionalText(artifact(config, role, launch, "exit.json"));
        if (identity && exit && JSON.parse(exit).code !== 0)
          return { id: launch, pid: JSON.parse(identity).pid, trace, launchedAt: now() };
        if (identity && text.includes('"thread.started"')) {
          const terminal = parseTrace(text, false, role, config);
          return { id: terminal.id, pid: JSON.parse(identity).pid, trace, launchedAt: now() };
        }
        check(!exit, "launcher-exited-before-identity-reconcile");
        await pause(1000);
      }
      throw new QueueBlocked("launch-identity-timeout-reconcile");
    },
    async observe(role, config, attempt: Attempt) {
      const exit = await optionalText(attemptArtifact(attempt, "exit.json"));
      const trace = await readFile(attempt.trace, "utf8");
      const launcherFailed = Boolean(exit) && JSON.parse(exit).code !== 0;
      let terminal: Terminal;
      try {
        terminal = parseTrace(trace, Boolean(exit), role, config, attempt.id, launcherFailed);
        if (
          launcherFailed &&
          terminal.status === "dead" &&
          !events(trace, false).some(
            (event) =>
              event.type === "item.started" ||
              event.type === "item.completed" ||
              event.type === "turn.completed",
          )
        ) {
          const stderr = await optionalText(attemptArtifact(attempt, "err.log"));
          if (modelRefused(stderr)) terminal.modelRefused = true;
        }
      } catch (error) {
        const summary =
          error instanceof QueueBlocked ? terminalSummary(error.diagnostics) : undefined;
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
            ...(summary ? { summary } : {}),
          };
        throw error;
      }
      if (!exit && terminal.status !== "dead") {
        try {
          process.kill(attempt.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            if (now() - attempt.launchedAt < EXIT_RECEIPT_WINDOW_MS)
              return { id: attempt.id, status: "running" };
            // ISS-141: the stopped host left a known author without a receipt or terminal turn.
            if (
              role === "author" &&
              !events(trace, false).some((row) =>
                ["turn.completed", "turn.failed"].includes(row.type),
              )
            )
              return {
                id: attempt.id,
                status: "dead",
                summary: "Author process exited without an exit receipt or terminal turn.",
              };
            throw new QueueBlocked("exit-receipt-timeout");
          }
          throw error;
        }
      }
      return terminal;
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

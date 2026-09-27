// ISS-138: one opt-in observer, separate from delivery and its scheduling records.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const issuePattern = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)$/;
const token = (value) => (/^[\w.:#-]{1,128}$/.test(value ?? "") ? value : "unknown");
const link = (value) =>
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull|actions\/runs)\/\d+(?:\/job\/\d+)?(?:#issuecomment-\d+)?$/.test(
    value ?? "",
  )
    ? value
    : null;

async function read(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value) + "\n");
  await rename(`${path}.tmp`, path);
}

export async function watchSettings(path) {
  const config = await read(path);
  if (
    !config ||
    !isAbsolute(config.loopConfig ?? "") ||
    !issuePattern.test(config.destination ?? "")
  )
    throw new Error("watch-config: require absolute loopConfig and a GitHub destination issue URL");
  const intervalSeconds = config.intervalSeconds ?? 60;
  const noProgressSeconds = config.noProgressSeconds ?? 1800;
  if (
    !Number.isSafeInteger(intervalSeconds) ||
    intervalSeconds < 30 ||
    intervalSeconds > 86400 ||
    !Number.isSafeInteger(noProgressSeconds) ||
    noProgressSeconds < intervalSeconds
  )
    throw new Error(
      "watch-config: intervalSeconds must be 30..86400; noProgressSeconds must be at least the interval",
    );
  const loop = await read(config.loopConfig);
  if (
    loop?.schemaVersion !== "dogfood-loop/v1" ||
    !/^[\w.-]{1,64}$/.test(loop.run ?? "") ||
    !isAbsolute(loop.stateRoot ?? "")
  )
    throw new Error("watch-config: invalid loop identity");
  return {
    ...config,
    intervalSeconds,
    noProgressSeconds,
    run: loop.run,
    state: resolve(
      loop.stateRoot,
      loop.run,
      "operator",
      `watch-${digest(config.destination).slice(0, 16)}.json`,
    ),
  };
}

async function command(executable, args, input) {
  const result = exec(executable, args, {
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  // gh receives JSON on stdin, never shell-interpolated prose or credentials.
  result.child.stdin.on("error", () => {});
  result.child.stdin.end(input);
  try {
    return JSON.parse((await result).stdout);
  } catch {
    throw new Error("watch-command-failed (output withheld; check local status/gh authentication)");
  }
}
export function githubNotifications(runCommand = command) {
  const endpoint = (url) => {
    const match = issuePattern.exec(url);
    if (!match) throw new Error("invalid-notification-issue");
    return `repos/${match[1]}/issues/${match[2]}/comments`;
  };
  return {
    async find(url, marker) {
      const pages = await runCommand("gh", ["api", endpoint(url), "--paginate", "--slurp"]);
      const found = pages.flat().find((comment) => comment.body?.includes(marker));
      return found ? { url: link(found.html_url) } : null;
    },
    async post(url, body) {
      await runCommand(
        "gh",
        ["api", "--method", "POST", endpoint(url), "--input", "-"],
        JSON.stringify({ body }),
      );
    },
  };
}

// null means positively quiet; undefined means observation cannot establish recovery.
function attention(value, state, settings, now) {
  if (value.status === "stopped")
    return {
      key: digest(["stop", value.current?.number, value.stop?.marker, value.stop?.reason]),
      kind: "reported-stop",
    };
  if (value.supervisor.status === "unavailable" || value.pause?.status === "unavailable")
    return undefined;
  if (value.status === "paused") return null;
  if (value.status === "idle/exited") {
    if (value.preview.status !== "observed") return undefined;
    const blocked = value.preview.outstanding.filter((row) => row.reasons.length);
    if (blocked.length)
      return {
        key: digest([
          "blocked-idle",
          blocked.map((row) => [row.number, [...row.reasons].sort()]).sort((a, b) => a[0] - b[0]),
        ]),
        kind: "blocked-idle",
        blocked,
      };
    return value.preview.outstanding.length ? undefined : null;
  }
  if (value.status === "exited") {
    if (value.unavailable.length) return undefined;
    return { key: "supervisor-exited", kind: "supervisor-exited" };
  }
  if (value.status !== "running") return undefined;
  state.firstRunningAt ??= now;
  const age = value.progress.ageSeconds ?? Math.floor((now - state.firstRunningAt) / 1000);
  if (age >= settings.noProgressSeconds)
    return { key: digest(["no-progress", value.current?.number]), kind: "no-progress" };
  return value.unavailable.length || value.preview.status !== "observed" ? undefined : null;
}

function message(value, condition, previous, note) {
  const recovery = !condition;
  const actions = {
    "reported-stop":
      "Read the linked learning note and local status; resolve its prerequisite and obtain any required host authorization before resuming.",
    "supervisor-exited":
      "Inspect local status, the supervisor log and retained work before an authorized resume.",
    "blocked-idle":
      "Todd: inspect the blocked issues and resolve their operator decisions or readiness constraints, then authorize any resume.",
    "no-progress":
      "Inspect the known wait and local status. This is an attention warning, not evidence that a worker is dead; leave timeouts and retry budgets unchanged.",
  };
  const rows = [
    `Loop ${recovery ? "recovery" : "attention"}: **${recovery ? previous.kind : condition.kind}**.`,
    `Run \`${token(value.run)}\`; observed ${value.observedAt}; supervisor ${token(value.supervisor.status)}; phase ${token(value.phase)}.`,
  ];
  const references = [link(value.current?.url), link(value.links.pr)].filter(Boolean);
  if (references.length) rows.push(`Work: ${references.join(" · ")}.`);
  if (value.stop)
    rows.push(
      `Stop: \`${token(value.stop.reason)}\`. Learning note: ${note ?? link(value.current?.url) ?? "not yet available; inspect local status"}${note ? "" : " (exact comment unavailable)"}.`,
    );
  rows.push(
    `Last evidenced progress: ${value.progress.at ?? "unknown"}; age ${value.progress.ageSeconds === null ? "unknown" : `${value.progress.ageSeconds}s`}; event ${token(value.progress.event)}. Newer untimed work may exist.`,
  );
  if (condition?.blocked) {
    rows.push(
      ...condition.blocked
        .slice(0, 5)
        .map(
          (row) =>
            `${link(row.url) ?? `Issue #${row.number}`}: ${row.reasons.slice(0, 3).map(token).join(", ")}.`,
        ),
    );
    if (condition.blocked.length > 5)
      rows.push(`${condition.blocked.length - 5} more blocked issues; inspect status.`);
  }
  const waits = [...value.links.checks, ...value.links.deploy].filter((row) =>
    /^(?:PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED)$/i.test(row.status ?? ""),
  );
  if (waits.length)
    rows.push(
      `Known CI/deploy waits (observations only): ${waits
        .slice(0, 5)
        .map((row) => `${token(row.status)} ${link(row.url) ?? "(link unavailable)"}`)
        .join(" · ")}.`,
    );
  if (value.phase === "waiting-provider") rows.push("Known wait: provider admission.");
  if (value.links.status === "unavailable")
    rows.push(
      "Current GitHub checks/deploy observation unavailable; retained links may be historical.",
    );
  rows.push(
    recovery
      ? "The preceding attention condition is no longer observed (running, intentionally paused, or exhausted idle). This is not a delivery or worker-health verdict."
      : actions[condition.kind],
  );
  return rows.join("\n\n");
}

export async function watchOnce(settings, options = {}) {
  const now = options.now ?? Date.now();
  const github = options.github ?? githubNotifications();
  const observe =
    options.observe ??
    ((path) =>
      command(process.execPath, [
        fileURLToPath(new URL("./status.mjs", import.meta.url)),
        path,
        "--json",
      ]));
  const report = options.report ?? ((text) => console.error(`${new Date().toISOString()} ${text}`));
  try {
    const state = (await read(settings.state)) ?? {
      sequence: 0,
      active: null,
      pending: null,
      firstRunningAt: null,
    };
    const value = await observe(settings.loopConfig);
    if (value.run !== settings.run)
      throw new Error("watch-run-changed; restart with the intended config");
    const condition = attention(value, state, settings, now);
    if (value.status !== "running") state.firstRunningAt = null;
    if (condition === undefined) report("watch observation incomplete; no recovery inferred");
    if (
      !state.pending &&
      condition !== undefined &&
      (condition?.key ?? null) !== (state.active?.key ?? null)
    ) {
      let note = null;
      if (value.stop?.marker && link(value.current?.url)) {
        try {
          note =
            (await github.find(value.current.url, `<!-- ${value.stop.marker} -->`))?.url ?? null;
        } catch {
          report("watch learning-note link unavailable; linking affected issue");
        }
      }
      state.sequence += 1;
      const marker = `<!-- loop-watch:${digest(settings.state).slice(0, 24)}:${state.sequence} -->`;
      state.pending = {
        marker,
        body: `${marker}\n${message(value, condition, state.active, note)}`,
        condition: condition ? { key: condition.key, kind: condition.kind } : null,
      };
    }
    // Save the exact pending message before sending. A lost reply/restart reconciles its marker.
    await save(settings.state, state);
    if (state.pending) {
      const pending = state.pending;
      if (!(await github.find(settings.destination, pending.marker)))
        await github.post(settings.destination, pending.body);
      state.active = pending.condition;
      state.pending = null;
      await save(settings.state, state);
      report(`watch notification delivered: ${state.active?.kind ?? "recovery"}`);
    }
    return condition !== undefined;
  } catch {
    report(
      "watch observation/notification failed; pending state retained; retry at the next interval (raw output withheld)",
    );
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [path, mode] = process.argv.slice(2);
    if (!path || (mode && mode !== "--once") || process.argv.length > 4)
      throw new Error("usage: loop:watch <watch-config.json> [--once]");
    const settings = await watchSettings(resolve(path));
    console.error(
      `Watching ${settings.run}; destination ${settings.destination}; state ${settings.state}; Ctrl-C stops only the watcher.`,
    );
    do {
      const ok = await watchOnce(settings);
      if (mode === "--once") {
        process.exitCode = ok ? 0 : 1;
        break;
      }
      await delay(settings.intervalSeconds * 1000);
    } while (true);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

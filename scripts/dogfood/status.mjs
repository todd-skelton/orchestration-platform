// ISS-136: observation only. Never compose a queue or call an adapter mutation.
import { execFile } from "node:child_process";
import { open, readFile, readdir, readlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { observePause } from "./pause.mjs";

const exec = promisify(execFile);
const commandOptions = { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true };
const diagnostic = (error) =>
  typeof error?.code === "string"
    ? error.code
    : String(error?.reason ?? error?.stderr?.trim() ?? error?.message ?? error).slice(0, 1000);

async function json(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// /proc supplies command identity as well as liveness; signal zero alone cannot.
// Unsupported platforms and unreadable process tables remain unknown.
export async function observeSupervisor(configPath, procRoot = "/proc") {
  try {
    const configured = await json(configPath);
    const matches = [];
    let inaccessible = false;
    // The ISS-136 worker check runs under bwrap's private PID namespace.
    // Its empty census cannot establish that the host supervisor exited.
    const init = await readFile(resolve(procRoot, "1/cmdline"), "utf8").catch(() => "");
    const isolated = /(?:bwrap|codex-linux-sandbox)/.test(init);
    for (const pid of (await readdir(procRoot)).filter((name) => /^\d+$/.test(name))) {
      try {
        const args = (await readFile(resolve(procRoot, pid, "cmdline"), "utf8")).split("\0");
        const script = args.findIndex((arg) =>
          /(?:^|\/)scripts\/dogfood\/supervise\.mjs$/.test(arg),
        );
        if (script < 0 || !args[script + 1]) continue;
        const cwd = await readlink(resolve(procRoot, pid, "cwd"));
        const otherPath = resolve(cwd, args[script + 1]);
        if (otherPath !== resolve(configPath)) {
          const other = await json(otherPath);
          if (!other) {
            inaccessible = true;
            continue;
          }
          if (other.run !== configured?.run || other.stateRoot !== configured?.stateRoot) continue;
        }
        const stat = await readFile(resolve(procRoot, pid, "stat"), "utf8");
        const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
        if (state === "Z" || state === "X") continue;
        matches.push({
          pid: Number(pid),
          status: state === "T" || state === "t" ? "paused" : "running",
        });
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") inaccessible = true;
      }
    }
    if (matches.length === 1) return matches[0];
    return {
      status: matches.length || inaccessible || isolated ? "unavailable" : "exited",
      pid: null,
      ...(isolated
        ? { diagnostic: "private-process-namespace; host supervisor liveness unavailable" }
        : {}),
    };
  } catch (error) {
    return { status: "unavailable", pid: null, diagnostic: diagnostic(error) };
  }
}

async function logEvents(path, run) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - 1024 * 1024);
    const bytes = Buffer.alloc(size - start);
    await file.read(bytes, 0, bytes.length, start);
    const lines = bytes.toString("utf8").split("\n");
    if (start) lines.shift();
    const events = lines.flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row.run === run && row.status ? [row] : [];
      } catch {
        return [];
      }
    });
    return { events, truncated: start > 0 };
  } finally {
    await file.close();
  }
}

export async function previewWork(loop) {
  // Load installed policy code, never JavaScript from fetched main.
  const adapter = await import(new URL(`../../adapters/${loop.adapter}.mjs`, import.meta.url));
  if (!adapter.previewWork) throw new Error("adapter-preview-unavailable");
  let planningRevision;
  if (loop.adapter === "self") {
    // Read remote main without fetch: a missing local object is unavailable, not stale fallback.
    const { stdout } = await exec(
      loop.gitExecutable,
      ["-C", loop.stableExecutorRoot, "ls-remote", "origin", "refs/heads/main"],
      commandOptions,
    );
    planningRevision = stdout.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/.test(planningRevision)) throw new Error("current-main-unavailable");
  }
  return {
    ...(await adapter.previewWork({
      repository: loop.repository,
      executorRoot: loop.stableExecutorRoot,
      gitExecutable: loop.gitExecutable,
      planningRevision,
      targetMilestone: loop.targetMilestone,
      opsAdmission: loop.opsAdmission,
    })),
    planningRevision: planningRevision ?? null,
  };
}

async function publicationObservation(loop, publication, merge) {
  const { stdout } = await exec(
    "gh",
    [
      "pr",
      "view",
      String(publication.number),
      "--repo",
      loop.repository,
      "--json",
      "url,headRefOid,state,statusCheckRollup",
    ],
    commandOptions,
  );
  const pr = JSON.parse(stdout);
  if (pr.url !== publication.url || pr.headRefOid !== publication.head)
    throw new Error("publication-head-mismatch");
  const checks = (pr.statusCheckRollup ?? []).map((check) => ({
    name: check.name ?? check.context,
    status: check.conclusion || check.status || check.state,
    url: check.detailsUrl ?? check.targetUrl ?? null,
  }));
  let deploy = [];
  if (merge && loop.adapter === "chase-sets") {
    const result = await exec(
      "gh",
      [
        "run",
        "list",
        "--repo",
        loop.repository,
        "--workflow",
        "platform-production.yml",
        "--commit",
        merge.mergeCommit,
        "--json",
        "url,status,conclusion,headSha",
      ],
      commandOptions,
    );
    deploy = JSON.parse(result.stdout).filter((run) => run.headSha === merge.mergeCommit);
  }
  // Links and raw observations only; the delivery adapter alone establishes required green/deploy.
  return { status: "observed", pr: pr.url, state: pr.state, checks, deploy };
}

export async function observeStatus(configPath, options = {}) {
  const observedAt = new Date(options.now ?? Date.now()).toISOString();
  const loop = JSON.parse(await readFile(configPath, "utf8"));
  if (
    loop.schemaVersion !== "dogfood-loop/v1" ||
    !loop.run ||
    !loop.stateRoot ||
    !loop.repository ||
    !["self", "chase-sets"].includes(loop.adapter)
  )
    throw new Error("invalid-loop-status-config");
  const directory = resolve(loop.stateRoot, loop.run);
  const log = resolve(dirname(configPath), "supervisor.log");
  const unavailable = [];
  const read = async (path) => {
    try {
      return await json(path);
    } catch (error) {
      unavailable.push(`${path}: ${diagnostic(error)}`);
      return null;
    }
  };
  const supervisor = await (options.supervisor ?? observeSupervisor)(configPath);
  let pause;
  try {
    pause = { status: "observed", ...(await observePause(loop)) };
  } catch (error) {
    pause = { status: "unavailable", diagnostic: diagnostic(error) };
    unavailable.push(`Pause: ${pause.diagnostic}`);
  }
  let events = [];
  let truncatedLog = false;
  try {
    const observation = await logEvents(log, loop.run);
    events = observation.events;
    truncatedLog = observation.truncated;
  } catch (error) {
    unavailable.push(`${log}: ${diagnostic(error)}`);
  }
  // A live invocation invalidates all preceding final log lines, including same-run restarts.
  const start = events.findLastIndex(
    (row) => row.status === "supervisor-started" && row.pid === supervisor.pid,
  );
  const live = supervisor.status === "running" || supervisor.status === "paused";
  const currentEvents = live
    ? start < 0
      ? []
      : events.slice(start).filter((row) => row.pid === supervisor.pid)
    : events;
  const event = currentEvents.at(-1);
  let names = [];
  let attemptDirectories = [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    names = entries.map((entry) => entry.name);
    attemptDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    unavailable.push(`${directory}: ${diagnostic(error)}`);
  }
  const cycles = names
    .filter((name) => /^cycle-\d+-selected\.json$/.test(name))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  const selectedPath = cycles.length ? resolve(directory, cycles.at(-1)) : null;
  const selection = selectedPath ? await read(selectedPath) : null;
  const completed =
    selection && Boolean(await read(resolve(directory, `cycle-${selection.cycle}-complete.json`)));
  const stops = selection
    ? names
        .filter((name) => new RegExp(`^cycle-${selection.cycle}-stop-\\d+\\.json$`).test(name))
        .sort((a, b) => Number(a.split("-")[3]) - Number(b.split("-")[3]))
    : [];
  const stop = stops.length ? await read(resolve(directory, stops.at(-1))) : null;
  const attempts = [];
  if (selection)
    for (const name of attemptDirectories) {
      const path = resolve(directory, name, "attempt.json");
      const value = await read(path);
      if (
        value?.run === loop.run &&
        value.issue === `https://github.com/${loop.repository}/issues/${selection.number}`
      )
        attempts.push({ ...value, path });
    }
  attempts.sort((a, b) => a.candidateAttempt - b.candidateAttempt);
  const attempt =
    (completed && attempts.findLast((row) => row.phase === "complete")) || attempts.at(-1);
  const historicalPublications = [];
  for (const prior of attempts.filter((row) => row !== attempt)) {
    for (const stage of ["source", "repair"]) {
      const retained = await read(resolve(dirname(prior.path), stage, "publication.json"));
      if (retained)
        historicalPublications.push({ attempt: prior.candidateAttempt, url: retained.url });
    }
  }
  let phase = completed
    ? "cycle-complete"
    : (attempt?.phase ?? (selection ? "selected" : "unknown"));
  let worker = null;
  let publication = null;
  let merge = null;
  let savedChecks = [];
  const progress = [];
  if (attempt) {
    let state =
      attempt.stateDirectory ??
      resolve(dirname(attempt.path), attempt.phase === "repair" ? "repair" : "source");
    if (loop.integrationContinuation?.issueKey === selection.key) {
      const integration = resolve(loop.integrationContinuation.attemptDirectory, "integration");
      state = loop.integrationContinuation.spentResolution
        ? resolve(integration, "spent-resolution")
        : integration;
    }
    // Follow the writer's selected continuation, not the newest file's mtime.
    for (;;) {
      const currentPublication = await read(resolve(state, "publication.json"));
      publication = currentPublication ?? publication;
      const currentMerge = await read(resolve(state, "merge.json"));
      merge = currentMerge ?? merge;
      const checks = await read(resolve(state, "hosted-checks.json"));
      if (checks)
        savedChecks = checks.checks.map((row) => ({
          name: row.name,
          status: row.bucket,
          url: row.link,
          evidence: "saved",
        }));
      for (const role of ["author", "reviewer"]) {
        const recordPath = resolve(state, `${role}-attempt.json`);
        const record = await read(recordPath);
        if (!record) continue;
        const terminal = await read(resolve(state, `${role}-terminal.json`));
        if (Number.isFinite(record.launchedAt))
          progress.push({ at: record.launchedAt, evidence: recordPath, event: `${role}-launched` });
        worker = {
          role,
          pid: record.pid,
          trace: record.trace,
          terminal: terminal?.status ?? null,
          record: recordPath,
        };
        if (!terminal || terminal.status === "running") phase = `observing-${role}`;
        else if (role === "reviewer" && terminal.status === "passed") phase = "local-gates";
        else phase = `${role}-${terminal.status}`;
      }
      if (currentPublication) {
        phase = currentMerge ? "deploy-or-cleanup" : "observing-hosted-checks";
        if (!currentMerge && (await read(resolve(state, "merge-intent.json")))) phase = "merging";
      } else if (await read(resolve(state, "publication-intent.json"))) phase = "publishing";
      const correction = await read(resolve(state, "gate-correction.json"));
      const refresh = await read(resolve(state, "native-refresh.json"));
      const gateContinuation = await read(resolve(state, "gate-stop-continuation.json"));
      const next = gateContinuation
        ? resolve(state, "gate-stop-continuation")
        : (correction?.directory ?? refresh?.directory);
      if (!next) break;
      state = next;
    }
    if (completed) phase = "cycle-complete";
  }
  if (
    live &&
    event?.status === "waiting-provider" &&
    event.issue === `https://github.com/${loop.repository}/issues/${selection?.number}`
  )
    phase = "waiting-provider";
  const seenProgress = new Set();
  for (const row of truncatedLog ? [] : events) {
    if (!["complete", "advancing-attempt"].includes(row.status)) continue;
    // Replaying an already evidenced result after restart is not new progress.
    const identity = JSON.stringify([
      row.status,
      row.issue,
      row.item,
      row.cursor,
      row.items,
      row.participants,
    ]);
    if (seenProgress.has(identity)) continue;
    seenProgress.add(identity);
    const at = Date.parse(row.observedAt);
    if (Number.isFinite(at)) progress.push({ at, evidence: log, event: row.status });
  }
  progress.sort((a, b) => a.at - b.at);
  const last = progress.filter((row) => row.at <= Date.parse(observedAt)).at(-1);
  let preview;
  try {
    const value = await (options.preview ?? previewWork)(loop);
    const link = (row) => ({
      ...row,
      url: `https://github.com/${loop.repository}/issues/${row.number}`,
    });
    preview = {
      status: "observed",
      reservation: false,
      ...value,
      candidates: value.candidates.map(link),
      outstanding: value.outstanding.map(link),
    };
  } catch (error) {
    preview = { status: "unavailable", reservation: false, diagnostic: diagnostic(error) };
  }
  let links = {
    status: "unavailable",
    pr: publication?.url ?? null,
    checks: savedChecks,
    deploy: [],
  };
  if (publication) {
    try {
      links = await (options.publication ?? publicationObservation)(loop, publication, merge);
    } catch (error) {
      links.diagnostic = diagnostic(error);
    }
  }
  const retainedStop = completed ? null : stop;
  const stopped = !live && ((retainedStop && !pause.acknowledgedAt) || event?.status === "blocked");
  const status = live
    ? supervisor.status
    : supervisor.status === "unavailable"
      ? "unavailable"
      : stopped
        ? "stopped"
        : pause.acknowledgedAt
          ? "paused"
          : event?.status === "idle" && (!selection || completed)
            ? "idle/exited"
            : "exited";
  const reason = stopped ? (retainedStop?.reason ?? event?.reason) : null;
  return {
    observedAt,
    run: loop.run,
    repository: loop.repository,
    scope: { adapter: loop.adapter, targetMilestone: loop.targetMilestone ?? null },
    status,
    supervisor,
    pause,
    lastLogObservation: event
      ? { status: event.status, observedAt: event.observedAt ?? null }
      : null,
    current:
      selection && !completed && !pause.acknowledgedAt
        ? {
            ...selection,
            url: `https://github.com/${loop.repository}/issues/${selection.number}`,
            attempt: attempt?.candidateAttempt ?? null,
          }
        : null,
    phase,
    stop: stopped
      ? {
          reason,
          operatorAction:
            retainedStop?.body ??
            event?.diagnostics ??
            "Inspect the saved stop and log before an authorized resume.",
        }
      : null,
    operatorAction:
      !live && selection && !completed && !stopped && !pause.acknowledgedAt
        ? "Saved work remains. Inspect its records before an authorized resume; no automatic restart."
        : null,
    progress: last
      ? {
          at: new Date(last.at).toISOString(),
          ageSeconds: Math.floor((Date.parse(observedAt) - last.at) / 1000),
          evidence: last.evidence,
          event: last.event,
        }
      : { at: null, ageSeconds: null, evidence: null, event: null },
    progressMeaning: `Last timestamped delivery event; newer untimed records may exist.${truncatedLog ? " Log history is truncated; progress uses retained launch timestamps only." : ""} Polls, log growth and PID liveness are not worker health or delivery progress.`,
    completeness:
      preview.status === "observed" && preview.outstanding.length ? "incomplete" : "unknown",
    preview,
    links,
    historicalPublications,
    paths: {
      log,
      state: directory,
      selection: selectedPath,
      attempt: attempt?.path ?? null,
      workerTrace: worker?.trace ?? null,
    },
    worker,
    unavailable,
  };
}

export function formatStatus(value) {
  const lines = [
    `${value.run} - ${value.status}; ${value.phase}`,
    `${value.repository}; scope ${value.scope.targetMilestone ?? "adapter default"}; ${value.completeness}`,
    `Observed ${value.observedAt}; supervisor ${value.supervisor.status} (PID ${value.supervisor.pid ?? "unknown"}; worker health unknown)`,
    `Current ${value.current ? `${value.current.key} attempt ${value.current.attempt ?? "unknown"} ${value.current.url}` : "none evidenced"}`,
    `Progress ${value.progress.at ?? "unknown"}; age ${value.progress.ageSeconds === null ? "unknown" : `${value.progress.ageSeconds}s`} (${value.progress.event ?? "no timestamped event"})`,
  ];
  if (value.stop) lines.push(`Stop ${value.stop.reason}: ${value.stop.operatorAction}`);
  if (value.pause?.status === "unavailable")
    lines.push(`Pause unavailable: ${value.pause.diagnostic}`);
  else if (value.pause?.requestedAt)
    lines.push(
      `Pause requested ${value.pause.requestedAt}; acknowledged ${value.pause.acknowledgedAt ?? "pending (current issue continues)"}`,
    );
  if (value.supervisor.diagnostic)
    lines.push(`Supervisor evidence: ${value.supervisor.diagnostic}`);
  if (value.lastLogObservation)
    lines.push(
      `Last run log: ${value.lastLogObservation.status} at ${value.lastLogObservation.observedAt ?? "unknown time"} (historical observation)`,
    );
  if (value.operatorAction) lines.push(value.operatorAction);
  lines.push(
    `Preview (current, not reserved): ${value.preview.status === "observed" ? (value.preview.candidates[0]?.url ?? "no eligible work") : `unavailable: ${value.preview.diagnostic}`}`,
  );
  for (const row of (value.preview.outstanding ?? []).slice(0, 10))
    lines.push(`  ${row.url}: ${row.reasons.join(", ") || "eligible"}`);
  if (value.preview.outstanding?.length > 10)
    lines.push(
      `  ${value.preview.outstanding.length - 10} more open issues; use --json for the full preview.`,
    );
  lines.push(
    `PR ${value.links.pr ?? "unknown"}; GitHub ${value.links.status}${value.links.diagnostic ? `: ${value.links.diagnostic}` : ""}`,
  );
  for (const row of value.links.checks)
    lines.push(`  Check ${row.name}: ${row.status} ${row.url ?? ""}`);
  for (const row of value.links.deploy)
    lines.push(`  Deploy ${row.status}/${row.conclusion ?? "unknown"} ${row.url}`);
  for (const row of value.historicalPublications)
    lines.push(`Other attempt ${row.attempt} PR ${row.url} (historical)`);
  lines.push(
    `Log ${value.paths.log}`,
    `Trace ${value.paths.workerTrace ?? "unknown"}`,
    value.progressMeaning,
  );
  for (const row of value.unavailable) lines.push(`Unavailable ${row}`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [config, flag, extra] = process.argv.slice(2);
  try {
    if (!config || (flag && flag !== "--json") || extra)
      throw new Error("usage: loop:status <loop-config> [--json]");
    const value = await observeStatus(resolve(config));
    process.stdout.write(
      `${flag === "--json" ? JSON.stringify(value, null, 2) : formatStatus(value)}\n`,
    );
  } catch (error) {
    const value = {
      status: "unavailable",
      observedAt: new Date().toISOString(),
      diagnostic: diagnostic(error),
    };
    process.stdout.write(
      `${flag === "--json" ? JSON.stringify(value) : `Status unavailable: ${value.diagnostic}`}\n`,
    );
    process.exitCode = 1;
  }
}

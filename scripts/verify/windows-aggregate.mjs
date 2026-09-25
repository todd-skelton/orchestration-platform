import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const shards = {
  windows_refresh: "Windows tests / refresh",
  windows_queue: "Windows tests / queue",
  windows_remainder: "Windows tests / remainder",
};

// The latest endpoint is the effective job set for this run attempt, including
// successful earlier-attempt jobs retained by a failed-only rerun.
export async function aggregate({
  env = process.env,
  request = fetch,
  log = console.log,
  pause = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: run,
    GITHUB_RUN_ATTEMPT: attempt,
    BOOTSTRAP_HEAD: head,
    GH_TOKEN: token,
  } = env;
  const needs = JSON.parse(env.WINDOWS_NEEDS);
  const api = `https://api.github.com/repos/${repository}/actions`;
  async function get(url) {
    const response = await request(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Actions HTTP ${response.status}`);
    return response;
  }
  log(`Windows aggregate repository=${repository} run=${run} attempt=${attempt} head=${head}`);
  let jobs = [];
  try {
    for (let page = 1; ; page++) {
      const data = await (
        await get(`${api}/runs/${run}/jobs?filter=latest&per_page=100&page=${page}`)
      ).json();
      if (!Array.isArray(data.jobs)) throw new Error("missing Actions jobs");
      jobs.push(...data.jobs);
      if (jobs.length >= data.total_count) break;
      if (data.jobs.length === 0) throw new Error("incomplete Actions jobs");
    }
  } catch (error) {
    jobs = [];
    log(`shard-jobs-unavailable: ${error.message}`);
  }
  let success = true;
  for (const [key, name] of Object.entries(shards)) {
    const matches = jobs.filter((job) => job.name === name);
    const job = matches.length === 1 ? matches[0] : undefined;
    const valid =
      job &&
      Number.isSafeInteger(job.id) &&
      job.id > 0 &&
      job.run_id === Number(run) &&
      job.head_sha === head &&
      Number.isSafeInteger(job.run_attempt) &&
      job.run_attempt > 0 &&
      job.run_attempt <= Number(attempt) &&
      (job.run_attempt === Number(attempt) || job.conclusion === "success") &&
      job.html_url === `https://github.com/${repository}/actions/runs/${run}/job/${job.id}`;
    const green =
      needs[key]?.result === "success" &&
      valid &&
      job.status === "completed" &&
      job.conclusion === "success";
    if (green) continue;
    success = false;
    log(
      `${name}: conclusion=${job?.conclusion ?? (job ? job.status : "missing")} needs=${needs[key]?.result ?? "missing"}` +
        (job
          ? ` job=${job.id} url=${job.html_url} attempt=${job.run_attempt}`
          : " job=missing url=unavailable"),
    );
    if (!valid) log(`${name}: missing or invalid current effective job identity`);
    if (job && ["cancelled", "timed_out"].includes(job.conclusion)) {
      let body;
      if (valid) {
        for (let retry = 0; retry < 3; retry++) {
          try {
            body = await (await get(`${api}/jobs/${job.id}/logs`)).text();
            if (!body.trim()) throw new Error("empty job log");
            break;
          } catch {
            body = undefined;
            if (retry < 2) await pause(1_000);
          }
        }
      }
      if (body === undefined) log(`shard-log-unavailable:${name} job=${job.id}`);
      else {
        // Job output is data, not workflow commands (including commands from PR tests).
        const marker = randomUUID();
        log(`::stop-commands::${marker}`);
        log(body);
        log(`::${marker}::`);
      }
    }
  }
  return success ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await aggregate();

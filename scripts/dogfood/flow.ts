import { createHash } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseReview, RepairBlocked } from "./repair-policy.mjs";
import { MAX_TERMINAL_SUMMARY_LENGTH, terminalSummary } from "./terminal-summary.mjs";

export type Role = "author" | "reviewer";
export interface Config {
  owner: string;
  run: string;
  issue: string;
  pilotRevision: string;
  base: string;
  worktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  allowedPaths: string[];
  repository: string;
  requiredChecks: string[];
  author: { model: string; effort: string; prompt: string };
  reviewer: { model: string; effort: string; prompt: string };
  adapter: { kind: "codex-exec"; executable: string };
}
export interface Attempt {
  id: string;
  pid: number;
  trace: string;
  launchedAt: number;
  retries?: 1;
}
export interface Terminal {
  status: "running" | "passed" | "failed" | "malformed";
  id: string;
  head?: string;
  usage?: unknown;
  summary?: string;
}
export interface Check {
  name: string;
  bucket: string;
  link: string;
}
export interface Adapter {
  preflight(config: Config): Promise<void>;
  git(worktree: string, args: string[]): Promise<string>;
  launch(role: Role, config: Config, prompt: string): Promise<Attempt>;
  observe(role: Role, config: Config, attempt: Attempt): Promise<Terminal>;
  checks(config: Config, url: string): Promise<{ head: string; checks: Check[] }>;
}

export class QueueBlocked extends Error {
  readonly reason: string;
  readonly diagnostics: string | undefined;
  readonly retries: number;
  constructor(reason: string, diagnostics?: string, retries = 0) {
    super(reason);
    this.reason = reason;
    this.diagnostics = diagnostics;
    this.retries = retries;
  }
}

export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new QueueBlocked(reason);
}
export function outside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}
export async function readOptional(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
// Immutable, exclusive stage records reserve dispatch before any side effect.
// They are local trial bookkeeping under one authorized controller, not receipts.
async function record(directory: string, name: string, value: unknown) {
  await writeFile(resolve(directory, `${name}.json`), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    flush: true,
  });
}
async function replace(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const temporary = `${path}.next`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flush: true });
  await rename(temporary, path);
}
export function validateConfig(config: Config) {
  requireThat(config && /^[\w.-]{1,64}$/.test(config.run), "invalid-run");
  requireThat(
    config.adapter &&
      Object.keys(config.adapter).every((key) => ["kind", "executable"].includes(key)),
    "unsupported-adapter-configuration",
  );
  for (const name of ["owner", "issue", "repository"] as const)
    requireThat(typeof config[name] === "string" && config[name].length > 0, `invalid-${name}`);
  for (const name of ["base", "pilotRevision"] as const)
    requireThat(/^[a-f0-9]{40}$/.test(config[name]), `invalid-${name}`);
  for (const name of ["worktree", "reviewWorktree", "stateDirectory"] as const)
    requireThat(typeof config[name] === "string" && isAbsolute(config[name]), `invalid-${name}`);
  requireThat(
    Array.isArray(config.allowedPaths) && config.allowedPaths.length > 0,
    "empty-footprint",
  );
  requireThat(
    config.allowedPaths.every(
      (p) =>
        typeof p === "string" &&
        p.length > 0 &&
        !p.startsWith("/") &&
        !p.includes("\\") &&
        !p.split("/").includes(".."),
    ),
    "invalid-footprint",
  );
  requireThat(
    Array.isArray(config.requiredChecks) &&
      config.requiredChecks.length > 0 &&
      config.requiredChecks.every((s) => typeof s === "string" && s.length > 0) &&
      new Set(config.requiredChecks).size === config.requiredChecks.length,
    "invalid-required-checks",
  );
  for (const role of ["author", "reviewer"] as const) {
    const actor = config[role];
    requireThat(
      actor &&
        [actor.model, actor.effort, actor.prompt].every(
          (s) => typeof s === "string" && s.length > 0,
        ),
      `invalid-${role}`,
    );
  }
}

export function workerPrompt(config: Config, role: Role, head: string, prompt: string): string {
  const localVerification =
    role === "author"
      ? " Before reporting, run `pnpm typecheck`, `pnpm format:check` and `pnpm test` in this worktree, and fix what fails."
      : "";
  const report =
    role === "author"
      ? `Final response must be ONLY JSON: {"run":"${config.run}","role":"author","head":"${head}","verdict":"PASS","summary":""} (or verdict FAIL), with a short "summary" string of at most ${MAX_TERMINAL_SUMMARY_LENGTH} characters; use an empty string when there are no findings.`
      : `Final response must be ONLY JSON: {"run":"${config.run}","role":"reviewer","head":"${head}","verdict":"PASS","findings":[],"g0":"<is there a simpler way?>"} (or verdict FAIL). Each finding is exactly {"file":"<changed path>","line":1,"severity":"blocking"|"note","text":"<finding>"}. A blocking finding requires FAIL; notes never block.`;
  return (
    `${prompt}\n\nPilot run ${config.run}; role ${role}; exact ${role === "author" ? "base" : "review head"}: ${head}.\n` +
    `Allowed author paths: ${JSON.stringify(config.allowedPaths)}. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n` +
    `Explain substantive findings in progress messages before the final response; these remain in the captured trace. ${report} Review every changed assertion independently.${localVerification}\n`
  );
}
function footprint(config: Config, changed: string[]) {
  requireThat(
    changed.length > 0 &&
      changed.every((file) =>
        config.allowedPaths.some(
          (allowed) =>
            allowed === "." ||
            file === allowed ||
            (allowed.endsWith("/") && file.startsWith(allowed)),
        ),
      ),
    "outside-footprint",
  );
  return changed;
}
const paths = (output: string) => output.split("\0").filter(Boolean);
async function candidate(config: Config, adapter: Adapter) {
  requireThat(
    (await adapter.git(config.worktree, ["status", "--porcelain"])) === "",
    "dirty-author",
  );
  const head = await adapter.git(config.worktree, ["rev-parse", "HEAD"]);
  requireThat(/^[a-f0-9]{40}$/.test(head) && head !== config.base, "missing-candidate-commit");
  requireThat(
    (await adapter.git(config.worktree, ["merge-base", config.base, head])) === config.base,
    "changed-base",
  );
  const changed = footprint(
    config,
    paths(
      await adapter.git(config.worktree, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        config.base,
        head,
      ]),
    ),
  );
  return { head, changed };
}
async function runStep(config: Config, adapter: Adapter, pilotRoot: string) {
  validateConfig(config);
  const roots = await Promise.all(
    [pilotRoot, config.worktree, config.reviewWorktree].map((p) => realpath(p)),
  );
  for (const root of roots) {
    requireThat(
      (await realpath(await adapter.git(root, ["rev-parse", "--show-toplevel"]))) === root,
      "worktree-must-be-repository-root",
    );
  }
  const directory = await realpath(config.stateDirectory); // Controller reserves the external directory.
  requireThat(
    roots.every((root) => outside(root, directory) && outside(directory, root)),
    "state-inside-checkout",
  );
  requireThat(
    roots.every((root, index) =>
      roots.every((other, otherIndex) => index === otherIndex || outside(root, other)),
    ),
    "worktree-isolation",
  );
  requireThat(
    (await adapter.git(pilotRoot, ["rev-parse", "HEAD"])) === config.pilotRevision,
    "pilot-revision-moved",
  );
  requireThat((await adapter.git(pilotRoot, ["status", "--porcelain"])) === "", "dirty-pilot");
  const prompts: [string, string] = [config.author.prompt, config.reviewer.prompt];
  requireThat(
    prompts.every((p) => p.trim()),
    "empty-prompt",
  );
  const fingerprint = sha(JSON.stringify({ config, prompts }));
  let pinned = await readOptional(resolve(directory, "config.json"));
  if (!pinned) {
    await adapter.preflight(config);
    await record(directory, "config", { fingerprint, config, host: process.platform });
    pinned = { fingerprint };
  }
  requireThat(pinned.fingerprint === fingerprint, "conflicting-run-configuration");
  const get = (name: string) => readOptional(resolve(directory, `${name}.json`));
  const put = (name: string, value: unknown) => record(directory, name, value);
  let retries = 0;
  const finish = async (status: string, detail: object = {}) => ({
    status,
    run: config.run,
    issue: config.issue,
    ...(retries ? { retries } : {}),
    ...detail,
  });
  for (const role of ["author", "reviewer"] as const) {
    const reviewed = await get("candidate");
    let attempt: Attempt | undefined = await get(`${role}-attempt`);
    let terminal: Terminal | undefined = await get(`${role}-terminal`);
    if (role === "reviewer" && attempt?.retries === 1) retries = 1;
    let parseError: string | undefined;
    for (let iteration = 0; iteration < (role === "reviewer" ? 2 : 1); iteration += 1) {
      const retry = iteration === 1;
      if (retry) {
        retries = 1;
        attempt = undefined;
        terminal = undefined;
      }
      if (!attempt) {
        let reviewerHead: string | undefined;
        if (!retry) {
          requireThat(!(await get(`${role}-intent`)), `${role}-launch-identity-unknown-reconcile`);
          // Reserve before the first launch. A retry is deliberately disposable:
          // Rule 9 allows a restart to repeat it once.
          const intentHead = role === "author" ? config.base : reviewed?.head;
          await put(`${role}-intent`, {
            at: new Date().toISOString(),
            fingerprint,
            role,
            head: intentHead,
          });
        }
        if (role === "author") {
          requireThat(
            (await adapter.git(config.worktree, ["rev-parse", "HEAD"])) === config.base,
            "changed-base",
          );
          requireThat(
            (await adapter.git(config.worktree, ["status", "--porcelain"])) === "",
            "dirty-author",
          );
        } else {
          requireThat(reviewed, "candidate-head-moved");
          const candidateHead = (await candidate(config, adapter)).head;
          requireThat(candidateHead === reviewed.head, "candidate-head-moved");
          reviewerHead = candidateHead;
          if (!retry) {
            requireThat(
              (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
              "dirty-reviewer",
            );
            await adapter.git(config.reviewWorktree, ["checkout", "--detach", reviewed.head]);
          }
        }
        const reviewHead = role === "author" ? config.base : reviewerHead;
        requireThat(typeof reviewHead === "string", "review-head-identity-unknown");
        const retryContext = retry
          ? `\nThe previous reviewer report could not be parsed (${parseError ?? "malformed-review-report"}). Review the unchanged candidate independently and return one valid report.\n`
          : "";
        const prompt = `${workerPrompt(
          config,
          role,
          reviewHead,
          prompts[role === "author" ? 0 : 1],
        )}${retryContext}`;
        const launched = await adapter.launch(role, config, prompt);
        attempt = retry ? { ...launched, retries: 1 } : launched;
        if (!retry) await put(`${role}-attempt`, attempt);
      }
      requireThat(
        typeof attempt.id === "string" &&
          attempt.id.length > 0 &&
          Number.isSafeInteger(attempt.pid) &&
          attempt.pid > 0 &&
          typeof attempt.trace === "string" &&
          isAbsolute(attempt.trace) &&
          Number.isFinite(attempt.launchedAt) &&
          attempt.launchedAt > 0 &&
          (attempt.retries === undefined || attempt.retries === 1),
        "invalid-attempt-identity",
      );
      const author: Attempt | undefined = await get("author-attempt");
      requireThat(
        role !== "reviewer" || (author && author.id !== attempt.id),
        "author-is-reviewer",
      );
      if (!terminal) {
        terminal = await adapter.observe(role, config, attempt);
        requireThat(
          terminal &&
            terminal.id === attempt.id &&
            ["running", "passed", "failed", "malformed"].includes(terminal.status),
          "malformed-terminal",
        );
        const oversizedReviewSummary =
          role === "reviewer" &&
          typeof terminal.summary === "string" &&
          terminal.summary.length > MAX_TERMINAL_SUMMARY_LENGTH;
        const summary = oversizedReviewSummary ? undefined : terminalSummary(terminal.summary);
        delete terminal.summary;
        if (oversizedReviewSummary) {
          terminal.status = "malformed";
          parseError = "source-review-summary-out-of-bounds";
        } else if (summary) terminal.summary = summary;
        if (terminal.status === "running") return finish(`observing-${role}`, { attempt });
      }
      if (role === "reviewer" && ["passed", "failed"].includes(terminal.status)) {
        try {
          parseReview(terminal.summary, config.run, reviewed.head);
        } catch (error) {
          terminal = { ...terminal, status: "malformed" };
          parseError =
            error instanceof RepairBlocked ? error.reason : "malformed-source-review-report";
        }
      }
      if (role === "reviewer" && terminal.status === "malformed") {
        parseError ??= "malformed-worker-verdict";
        if (!retry) {
          if (!(await get(`${role}-terminal`))) await put(`${role}-terminal`, terminal);
          continue;
        }
        throw new QueueBlocked("reviewer-malformed", undefined, retries);
      }
      if (retry) {
        await replace(directory, `${role}-attempt`, attempt);
        await replace(directory, `${role}-terminal`, terminal);
      } else if (!(await get(`${role}-terminal`))) await put(`${role}-terminal`, terminal);
      break;
    }
    requireThat(attempt && terminal, `${role}-state-incomplete`);
    const summary = terminalSummary(terminal.summary);
    if (terminal.id !== attempt.id || terminal.status === "malformed")
      throw new QueueBlocked(`${role}-malformed`);
    if (terminal.status !== "passed") throw new QueueBlocked(`${role}-failed`, summary, retries);
    if (role === "author") {
      requireThat(terminal.head === config.base, "author-wrong-head");
      if (!reviewed) {
        requireThat(!(await get("commit-intent")), "commit-result-unknown-reconcile");
        requireThat(
          (await adapter.git(config.worktree, ["rev-parse", "HEAD"])) === config.base,
          "author-head-moved",
        );
        const changed = footprint(config, [
          ...new Set([
            ...paths(
              await adapter.git(config.worktree, [
                "diff",
                "--name-only",
                "--no-renames",
                "-z",
                "HEAD",
              ]),
            ),
            ...paths(
              await adapter.git(config.worktree, [
                "diff",
                "--cached",
                "--name-only",
                "--no-renames",
                "-z",
              ]),
            ),
            ...paths(
              await adapter.git(config.worktree, [
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
              ]),
            ),
          ]),
        ]);
        await put("commit-intent", { base: config.base, changed });
        await adapter.git(config.worktree, [
          "--literal-pathspecs",
          "add",
          "--all",
          "--",
          ...changed,
        ]);
        await adapter.git(config.worktree, ["commit", "-m", `dogfood: ${config.run}`]);
        await put("candidate", await candidate(config, adapter));
      }
      const current = await candidate(config, adapter);
      requireThat(current.head === (await get("candidate")).head, "candidate-head-moved");
      continue;
    }
    const current = await candidate(config, adapter);
    requireThat(terminal.head === current.head, `${role}-wrong-head`);
    if (role === "reviewer") {
      requireThat(reviewed.head === current.head, "candidate-head-moved");
      requireThat(
        (await adapter.git(config.reviewWorktree, ["rev-parse", "HEAD"])) === current.head &&
          (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
        "reviewer-modified-worktree",
      );
    }
  }
  const reviewed = await get("candidate");
  const publication = await get("publication");
  const selectedReviewer = {
    attempt: await get("reviewer-attempt"),
    terminal: await get("reviewer-terminal"),
  };
  requireThat(selectedReviewer.attempt && selectedReviewer.terminal, "reviewer-state-incomplete");
  const diagnostics = Object.fromEntries(
    (
      await Promise.all(
        (["author", "reviewer"] as const).map(async (role) => [
          role,
          terminalSummary((await get(`${role}-terminal`))?.summary),
        ]),
      )
    ).filter((entry): entry is [Role, string] => typeof entry[1] === "string"),
  );
  const evidence = {
    head: reviewed.head,
    author: await get("author-attempt"),
    reviewer: selectedReviewer.attempt,
    ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
  };
  if (!publication) return finish("awaiting-publication", evidence);
  requireThat(
    publication.head === reviewed.head &&
      typeof publication.url === "string" &&
      publication.url.startsWith(`https://github.com/${config.repository}/pull/`) &&
      /\/\d+$/.test(publication.url),
    "publication-mismatch",
  );
  const ci = await adapter.checks(config, publication.url);
  requireThat(ci.head === reviewed.head, "ci-head-moved");
  requireThat(Array.isArray(ci.checks) && ci.checks.length > 0, "empty-ci-checks");
  for (const name of config.requiredChecks) {
    const matches = ci.checks.filter((check) => check.name === name);
    requireThat(matches.length === 1, `missing-or-ambiguous-check:${name}`);
    const check = matches[0]!;
    requireThat(
      typeof check.link === "string" &&
        check.link.startsWith("https://") &&
        ["pass", "pending", "fail", "cancel", "skipping"].includes(check.bucket),
      "malformed-check",
    );
    requireThat(!["fail", "cancel", "skipping"].includes(check.bucket), `ci-failed:${name}`);
  }
  const ready = config.requiredChecks.every(
    (name) => ci.checks.find((check) => check.name === name)!.bucket === "pass",
  );
  const result = await finish(ready ? "ready" : "observing-ci", {
    ...evidence,
    publication,
    checks: ci.checks,
  });
  if (ready && !(await get("ready"))) await put("ready", result);
  return result;
}

export async function step(config: Config, adapter: Adapter, pilotRoot: string) {
  return runStep(config, adapter, pilotRoot);
}

export async function correctGate(
  config: Config,
  adapter: Adapter,
  pilotRoot: string,
  gate: string,
  output: string,
  resume = false,
) {
  validateConfig(config);
  requireThat(
    (await adapter.git(pilotRoot, ["rev-parse", "HEAD"])) === config.pilotRevision &&
      (await adapter.git(pilotRoot, ["status", "--porcelain"])) === "",
    "pilot-revision-moved",
  );
  requireThat(
    (await adapter.git(config.worktree, ["rev-parse", "HEAD"])) === config.base &&
      (resume || (await adapter.git(config.worktree, ["status", "--porcelain"])) === ""),
    "candidate-workspace-drift",
  );
  const prompt = `${workerPrompt(config, "author", config.base, config.author.prompt)}\nCorrect the ${gate} gate failure on this same branch. The gate output was:\n${output}\n`;
  const attempt = await adapter.launch("author", config, prompt);
  requireThat(
    typeof attempt.id === "string" &&
      attempt.id.length > 0 &&
      Number.isSafeInteger(attempt.pid) &&
      attempt.pid > 0 &&
      isAbsolute(attempt.trace) &&
      Number.isFinite(attempt.launchedAt) &&
      attempt.launchedAt > 0,
    "invalid-attempt-identity",
  );
  let terminal: Terminal;
  for (;;) {
    terminal = await adapter.observe("author", config, attempt);
    requireThat(
      terminal.id === attempt.id && ["running", "passed", "failed"].includes(terminal.status),
      "malformed-terminal",
    );
    if (terminal.status !== "running") break;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  if (terminal.status !== "passed")
    throw new QueueBlocked("gate-correction-failed", terminalSummary(terminal.summary));
  requireThat(terminal.head === config.base, "author-wrong-head");
  const changedPaths = [
    ...new Set([
      ...paths(
        await adapter.git(config.worktree, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
      ),
      ...paths(
        await adapter.git(config.worktree, [
          "diff",
          "--cached",
          "--name-only",
          "--no-renames",
          "-z",
        ]),
      ),
      ...paths(
        await adapter.git(config.worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
      ),
    ]),
  ];
  if (resume && changedPaths.length === 0) {
    requireThat(
      (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
      "dirty-reviewer",
    );
    await adapter.git(config.reviewWorktree, ["checkout", "--detach", config.base]);
    return { head: config.base, attempt, terminal };
  }
  const changed = footprint(config, changedPaths);
  await adapter.git(config.worktree, ["--literal-pathspecs", "add", "--all", "--", ...changed]);
  await adapter.git(config.worktree, ["commit", "-m", `dogfood: ${config.run} gate correction`]);
  const corrected = await candidate(config, adapter);
  requireThat(
    (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
    "dirty-reviewer",
  );
  await adapter.git(config.reviewWorktree, ["checkout", "--detach", corrected.head]);
  return { head: corrected.head, attempt, terminal };
}

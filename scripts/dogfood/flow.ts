import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
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
  exitReceiptWindowMs: number;
  author: { model: string; effort: string; prompt: string };
  reviewer: { model: string; effort: string; prompt: string };
  adapter: { kind: "codex-exec"; executable: string };
  // Private adapter-only artifact namespace. Persisted source configurations
  // never set this; a bounded replacement review uses it to avoid overwriting
  // the original review transport.
  artifactPrefix?: "review-retry" | "gate-retry" | "gate-review-retry";
}
export interface Attempt {
  id: string;
  pid: number;
  trace: string;
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

export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
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

export async function selectedSourceReview(
  config: Pick<Config, "stateDirectory">,
  recordPrefix = "",
) {
  const retryAttempt = await readOptional(
    resolve(config.stateDirectory, `${recordPrefix}reviewer-retry-attempt.json`),
  );
  const retryTerminal = await readOptional(
    resolve(config.stateDirectory, `${recordPrefix}reviewer-retry-terminal.json`),
  );
  if (retryAttempt || retryTerminal) {
    requireThat(retryAttempt && retryTerminal, "reviewer-retry-state-incomplete");
    return { attempt: retryAttempt as Attempt, terminal: retryTerminal as Terminal };
  }
  const attempt = await readOptional(
    resolve(config.stateDirectory, `${recordPrefix}reviewer-attempt.json`),
  );
  const terminal = await readOptional(
    resolve(config.stateDirectory, `${recordPrefix}reviewer-terminal.json`),
  );
  requireThat(attempt && terminal, "reviewer-state-incomplete");
  return { attempt: attempt as Attempt, terminal: terminal as Terminal };
}
export function validateConfig(config: Config) {
  requireThat(config && /^[\w.-]{1,64}$/.test(config.run), "invalid-run");
  requireThat(config.artifactPrefix === undefined, "persisted-artifact-prefix-forbidden");
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
  requireThat(
    Number.isSafeInteger(config.exitReceiptWindowMs) &&
      config.exitReceiptWindowMs >= 0 &&
      config.exitReceiptWindowMs <= 300_000,
    "invalid-exit-receipt-window",
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
async function runStep(
  config: Config,
  adapter: Adapter,
  pilotRoot: string,
  recordPrefix = "",
  artifactPrefix?: Config["artifactPrefix"],
) {
  validateConfig(config);
  const runtimeConfig = artifactPrefix ? { ...config, artifactPrefix } : config;
  const key = (name: string) => `${recordPrefix}${name}`;
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
  let pinned = await readOptional(resolve(directory, `${key("config")}.json`));
  if (!pinned) {
    await adapter.preflight(config);
    await record(directory, key("config"), { fingerprint, config, host: process.platform });
    pinned = { fingerprint };
  }
  requireThat(pinned.fingerprint === fingerprint, "conflicting-run-configuration");
  const get = (name: string) => readOptional(resolve(directory, `${key(name)}.json`));
  const put = (name: string, value: unknown) => record(directory, key(name), value);
  const finish = async (status: string, detail: object = {}) => ({
    status,
    run: config.run,
    issue: config.issue,
    ...detail,
  });
  const normalizeReviewer = (terminal: Terminal, head: string) => {
    if (terminal.status === "malformed")
      return { terminal, parseError: "malformed-worker-verdict" };
    if (!["passed", "failed"].includes(terminal.status)) return { terminal };
    try {
      parseReview(terminal.summary, config.run, head);
      return { terminal };
    } catch (error) {
      const parseError = error instanceof RepairBlocked ? error.reason : "malformed-review-report";
      return { terminal: { ...terminal, status: "malformed" as const }, parseError };
    }
  };
  for (const role of ["author", "reviewer"] as const) {
    const reviewed = await get("candidate");
    let attempt: Attempt | undefined = await get(`${role}-attempt`);
    if (!attempt) {
      let reviewerHead: string | undefined;
      requireThat(!(await get(`${role}-intent`)), `${role}-launch-identity-unknown-reconcile`);
      // Reserve before checkout/prompt/launch; a crash here is deliberately not retried.
      const intentHead = role === "author" ? config.base : reviewed?.head;
      await put(`${role}-intent`, {
        at: new Date().toISOString(),
        fingerprint,
        role,
        head: intentHead,
      });
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
        requireThat(
          (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
          "dirty-reviewer",
        );
        await adapter.git(config.reviewWorktree, ["checkout", "--detach", reviewed.head]);
      }
      const head = role === "author" ? config.base : reviewerHead;
      if (typeof head !== "string") throw new Error("review-head-identity-unknown");
      const prompt = workerPrompt(config, role, head, prompts[role === "author" ? 0 : 1]);
      attempt = await adapter.launch(role, runtimeConfig, prompt);
      await put(`${role}-attempt`, attempt);
    }
    requireThat(
      attempt &&
        typeof attempt.id === "string" &&
        attempt.id.length > 0 &&
        Number.isSafeInteger(attempt.pid) &&
        attempt.pid > 0 &&
        typeof attempt.trace === "string" &&
        isAbsolute(attempt.trace),
      "invalid-attempt-identity",
    );
    const author: Attempt | undefined = await get("author-attempt");
    requireThat(role !== "reviewer" || (author && author.id !== attempt.id), "author-is-reviewer");
    let terminal: Terminal | undefined = await get(`${role}-terminal`);
    let parseError: string | undefined;
    if (!terminal) {
      terminal = await adapter.observe(role, runtimeConfig, attempt);
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
      if (role === "reviewer") {
        const normalized = normalizeReviewer(terminal, reviewed.head);
        terminal = normalized.terminal;
        parseError = normalized.parseError ?? parseError;
      }
      await put(`${role}-terminal`, terminal);
    } else if (role === "reviewer") {
      const normalized = normalizeReviewer(terminal, reviewed.head);
      terminal = normalized.terminal;
      parseError = normalized.parseError;
    }
    if (role === "reviewer" && terminal.status === "malformed") {
      const original = attempt;
      const intent = {
        reason: "malformed-review",
        count: 1,
        head: reviewed.head,
        parseError: parseError ?? "malformed-review-report",
      };
      const savedIntent = await get("reviewer-retry-intent");
      let retryAttempt: Attempt | undefined = await get("reviewer-retry-attempt");
      if (!savedIntent) {
        requireThat(!retryAttempt, "reviewer-retry-attempt-without-intent");
        await put("reviewer-retry-intent", intent);
      } else {
        requireThat(
          savedIntent.reason === intent.reason &&
            savedIntent.count === intent.count &&
            savedIntent.head === intent.head &&
            typeof savedIntent.parseError === "string" &&
            savedIntent.parseError.length > 0,
          "reviewer-retry-intent-drift",
        );
        intent.parseError = savedIntent.parseError;
        requireThat(retryAttempt, "reviewer-retry-launch-identity-unknown-reconcile");
      }
      const retryArtifactPrefix =
        artifactPrefix === "gate-retry" ? "gate-review-retry" : "review-retry";
      const retryConfig: Config = { ...config, artifactPrefix: retryArtifactPrefix };
      if (!retryAttempt) {
        const prompt = `${workerPrompt(config, "reviewer", reviewed.head, config.reviewer.prompt)}\nThe previous reviewer report could not be parsed (${intent.parseError}). Review the unchanged candidate independently and return one valid report.\n`;
        retryAttempt = await adapter.launch("reviewer", retryConfig, prompt);
        requireThat(
          retryAttempt.id !== original.id && retryAttempt.id !== author?.id,
          "reviewer-retry-participant-mismatch",
        );
        await put("reviewer-retry-attempt", retryAttempt);
      }
      requireThat(
        retryAttempt.id !== original.id && retryAttempt.id !== author?.id,
        "reviewer-retry-participant-mismatch",
      );
      let retryTerminal: Terminal | undefined = await get("reviewer-retry-terminal");
      if (!retryTerminal) {
        retryTerminal = await adapter.observe("reviewer", retryConfig, retryAttempt);
        requireThat(
          retryTerminal &&
            retryTerminal.id === retryAttempt.id &&
            ["running", "passed", "failed", "malformed"].includes(retryTerminal.status),
          "malformed-terminal",
        );
        if (retryTerminal.status === "running")
          return finish("observing-reviewer", { attempt: retryAttempt });
        const normalized = normalizeReviewer(retryTerminal, reviewed.head);
        retryTerminal = normalized.terminal;
        await put("reviewer-retry-terminal", retryTerminal);
      }
      requireThat(retryTerminal.status !== "malformed", "reviewer-retry-exhausted");
      attempt = retryAttempt;
      terminal = retryTerminal;
    }
    const summary = terminalSummary(terminal.summary);
    if (terminal.id !== attempt.id || terminal.status === "malformed")
      throw new Error(`${role}-malformed`);
    if (terminal.status !== "passed")
      throw Object.assign(new Error(`${role}-failed`), summary ? { diagnostics: summary } : {});
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
  const selectedReviewer = await selectedSourceReview(config, recordPrefix);
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

export async function gateCorrectionStep(config: Config, adapter: Adapter, pilotRoot: string) {
  return runStep(config, adapter, pilotRoot, "gate-retry-", "gate-retry");
}

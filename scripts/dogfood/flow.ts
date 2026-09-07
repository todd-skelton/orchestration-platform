import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

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
  author: { model: string; effort: string; promptFile: string };
  reviewer: { model: string; effort: string; promptFile: string };
  adapter: { kind: "codex-exec"; executable: string };
}
export interface Attempt {
  id: string;
  pid: number;
  trace: string;
}
export interface Terminal {
  status: "running" | "passed" | "failed";
  id: string;
  head?: string;
  usage?: unknown;
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
        [actor.model, actor.effort, actor.promptFile].every(
          (s) => typeof s === "string" && s.length > 0,
        ),
      `invalid-${role}`,
    );
    requireThat(isAbsolute(actor.promptFile), "prompt-path-not-absolute");
  }
}
function footprint(config: Config, changed: string[]) {
  requireThat(
    changed.length > 0 &&
      changed.every((file) =>
        config.allowedPaths.some(
          (allowed) => file === allowed || (allowed.endsWith("/") && file.startsWith(allowed)),
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
export async function step(config: Config, adapter: Adapter, pilotRoot: string) {
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
  const prompts = await Promise.all(
    [config.author.promptFile, config.reviewer.promptFile].map((p) => readFile(p, "utf8")),
  );
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
  const finish = async (status: string, detail: object = {}) => ({
    status,
    run: config.run,
    issue: config.issue,
    ...detail,
  });
  for (const role of ["author", "reviewer"] as const) {
    const reviewed = await get("candidate");
    let attempt: Attempt | undefined = await get(`${role}-attempt`);
    if (!attempt) {
      requireThat(!(await get(`${role}-intent`)), `${role}-launch-identity-unknown-reconcile`);
      // Reserve before checkout/prompt/launch; a crash here is deliberately not retried.
      await record(directory, `${role}-intent`, { at: new Date().toISOString(), fingerprint });
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
        requireThat(
          reviewed && (await candidate(config, adapter)).head === reviewed.head,
          "candidate-head-moved",
        );
        requireThat(
          (await adapter.git(config.reviewWorktree, ["status", "--porcelain"])) === "",
          "dirty-reviewer",
        );
        await adapter.git(config.reviewWorktree, ["checkout", "--detach", reviewed.head]);
      }
      const head = role === "author" ? config.base : reviewed.head;
      const prompt =
        `${prompts[role === "author" ? 0 : 1]}\n\nPilot run ${config.run}; role ${role}; exact ${role === "author" ? "base" : "review head"}: ${head}.\n` +
        `Allowed author paths: ${JSON.stringify(config.allowedPaths)}. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n` +
        `Explain substantive findings in progress messages before the final response; these remain in the captured trace. Final response must be ONLY JSON: {"run":"${config.run}","role":"${role}","head":"${head}","verdict":"PASS"} (or verdict FAIL). Review every changed assertion independently; do not run local test runners/native builds.\n`;
      attempt = await adapter.launch(role, config, prompt);
      await record(directory, `${role}-attempt`, attempt);
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
    if (!terminal) {
      terminal = await adapter.observe(role, config, attempt);
      requireThat(
        terminal &&
          terminal.id === attempt.id &&
          ["running", "passed", "failed"].includes(terminal.status),
        "malformed-terminal",
      );
      if (terminal.status === "running") return finish(`observing-${role}`, { attempt });
      await record(directory, `${role}-terminal`, terminal);
    }
    requireThat(terminal.id === attempt.id && terminal.status === "passed", `${role}-failed`);
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
        await record(directory, "commit-intent", { base: config.base, changed });
        await adapter.git(config.worktree, [
          "--literal-pathspecs",
          "add",
          "--all",
          "--",
          ...changed,
        ]);
        await adapter.git(config.worktree, ["commit", "-m", `dogfood: ${config.run}`]);
        await record(directory, "candidate", await candidate(config, adapter));
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
  const evidence = {
    head: reviewed.head,
    author: await get("author-attempt"),
    reviewer: await get("reviewer-attempt"),
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
  if (ready && !(await get("ready"))) await record(directory, "ready", result);
  return result;
}

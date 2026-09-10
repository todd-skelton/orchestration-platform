import { mkdtemp, realpath, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { step, workerPrompt } from "../../scripts/dogfood/flow.js";
import type { Adapter, Check, Config, Role, Terminal } from "../../scripts/dogfood/flow.js";

const base = "a".repeat(40),
  head = "b".repeat(40),
  pilotRevision = "c".repeat(40);
const cleanup: string[] = [];
afterEach(async () => {
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-test-")));
  cleanup.push(root);
  const paths = ["pilot", "author", "reviewer", "state"].map((name) => resolve(root, name));
  for (const path of paths) await mkdir(path);
  const [pilot, worktree, reviewWorktree, stateDirectory] = paths as [
    string,
    string,
    string,
    string,
  ];
  const promptFile = resolve(root, "prompt.txt");
  await writeFile(promptFile, "Improve the selected issue.");
  const config: Config = {
    owner: "controller",
    run: "one-trial",
    issue: "ISS-071",
    pilotRevision,
    base,
    worktree,
    reviewWorktree,
    stateDirectory,
    allowedPaths: ["scripts/repair.mjs"],
    repository: "owner/repo",
    requiredChecks: ["linux", "macos", "windows"],
    author: { model: "test", effort: "low", promptFile },
    reviewer: { model: "test", effort: "low", promptFile },
    adapter: { kind: "codex-exec", executable: process.execPath },
  };
  let currentHead = base,
    reviewHead = base,
    changed = "scripts/repair.mjs\0",
    untracked = "",
    cached = "",
    ciHead = head;
  let unavailable = false,
    reviewerDirty = false,
    sameIdentity = false;
  const statuses: Record<Role, Terminal["status"]> = { author: "running", reviewer: "running" };
  const summaries: Partial<Record<Role, unknown>> = {};
  const launches: Role[] = [],
    observations: Role[] = [];
  const staged: string[][] = [],
    commits: string[][] = [];
  let checks: Check[] = config.requiredChecks.map((name) => ({
    name,
    bucket: "pass",
    link: `https://ci.example/${name}`,
  }));
  const adapter: Adapter = {
    async preflight() {
      if (unavailable) throw new Error("host-adapter-unavailable");
    },
    async git(tree, args) {
      if (args[1] === "--show-toplevel") return tree;
      if (args[0] === "status")
        return tree === reviewWorktree && reviewerDirty
          ? " M file"
          : tree === worktree && statuses.author === "passed" && currentHead === base
            ? " M source"
            : "";
      if (args[0] === "rev-parse")
        return tree === pilot ? pilotRevision : tree === worktree ? currentHead : reviewHead;
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return args.includes("--cached") ? cached : changed;
      if (args[0] === "ls-files") return untracked;
      if (args[0] === "--literal-pathspecs") {
        staged.push(args.slice(4));
        return "";
      }
      if (args[0] === "commit") {
        commits.push(args);
        currentHead = head;
        changed = staged.at(-1)!.join("\0") + "\0";
        untracked = "";
        cached = "";
        return "";
      }
      if (args[0] === "checkout") {
        reviewHead = args[2]!;
        return "";
      }
      throw new Error(`unexpected git operation ${args}`);
    },
    async launch(role, _config, prompt) {
      expect(prompt).toContain(role === "author" ? base : head);
      launches.push(role);
      return {
        id: role === "reviewer" && sameIdentity ? "author" : role,
        pid: 123,
        trace: resolve(root, `${role}.jsonl`),
      };
    },
    async observe(role, _config, attempt) {
      observations.push(role);
      return {
        status: statuses[role],
        id: attempt.id,
        ...(statuses[role] === "running" ? {} : { head: role === "author" ? base : head }),
        ...(summaries[role] === undefined ? {} : { summary: summaries[role] as string }),
      };
    },
    async checks() {
      return { head: ciHead, checks };
    },
  };
  const run = () => step(config, adapter, pilot);
  const authorDone = () => {
    statuses.author = "passed";
  };
  const reviewerDone = () => {
    statuses.reviewer = "passed";
  };
  const publish = () =>
    writeFile(
      resolve(stateDirectory, "publication.json"),
      JSON.stringify({ head, url: "https://github.com/owner/repo/pull/320" }),
    );
  return {
    config,
    adapter,
    run,
    launches,
    observations,
    pilot,
    staged,
    commits,
    authorDone,
    reviewerDone,
    publish,
    setHead: (value: string) => {
      currentHead = value;
    },
    setChanged: (value: string) => {
      changed = value;
    },
    setUntracked: (value: string) => {
      untracked = value;
    },
    setCached: (value: string) => {
      cached = value;
    },
    setCi: (value: Check[], exactHead = head) => {
      checks = value;
      ciHead = exactHead;
    },
    unavailable: () => {
      unavailable = true;
    },
    dirtyReview: () => {
      reviewerDirty = true;
    },
    sameIdentity: () => {
      sameIdentity = true;
    },
    statuses,
    summarize: (role: Role, value: unknown) => {
      summaries[role] = value;
    },
  };
}
describe("supervised sequential pilot (fake attempts, never live acceptance)", () => {
  it("requires local author verification and otherwise preserves the reviewer prompt", async () => {
    const f = await fixture();
    expect(workerPrompt(f.config, "author", base, "Improve the selected issue.")).toBe(
      `Improve the selected issue.\n\nPilot run one-trial; role author; exact base: ${base}.\n` +
        'Allowed author paths: ["scripts/repair.mjs"]. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n' +
        `Explain substantive findings in progress messages before the final response; these remain in the captured trace. Final response must be ONLY JSON: {"run":"one-trial","role":"author","head":"${base}","verdict":"PASS","summary":""} (or verdict FAIL), with a short "summary" string of at most 2000 characters; use an empty string when there are no findings. Review every changed assertion independently. Before reporting, run \`pnpm typecheck\`, \`pnpm format:check\` and \`pnpm test\` in this worktree, and fix what fails.\n`,
    );
    expect(workerPrompt(f.config, "reviewer", head, "Improve the selected issue.")).toBe(
      `Improve the selected issue.\n\nPilot run one-trial; role reviewer; exact review head: ${head}.\n` +
        'Allowed author paths: ["scripts/repair.mjs"]. Author may edit source only: do not stage, commit, or change Git metadata; leave HEAD at the exact base. Reviewer must leave its worktree unchanged. Never push, publish, merge, or change credentials.\n' +
        `Explain substantive findings in progress messages before the final response; these remain in the captured trace. Final response must be ONLY JSON: {"run":"one-trial","role":"reviewer","head":"${head}","verdict":"PASS","findings":[],"g0":"<is there a simpler way?>"} (or verdict FAIL). Each finding is exactly {"file":"<changed path>","line":1,"severity":"blocking"|"note","text":"<finding>"}. A blocking finding requires FAIL; notes never block. Review every changed assertion independently.\n`,
    );
  });
  it("drives author and independent exact-head review, hands off publication, and resumes without redispatch", async () => {
    const f = await fixture();
    expect((await f.run()).status).toBe("observing-author");
    // Each step reloads only durable files, modeling a fresh controller process.
    expect((await f.run()).status).toBe("observing-author");
    f.authorDone();
    expect((await f.run()).status).toBe("observing-reviewer");
    expect((await f.run()).status).toBe("observing-reviewer");
    f.reviewerDone();
    expect((await f.run()).status).toBe("awaiting-publication");
    await f.publish();
    expect((await f.run()).status).toBe("ready");
    expect((await f.run()).status).toBe("ready");
    expect(f.launches).toEqual(["author", "reviewer"]);
    expect(f.commits).toHaveLength(1);
    expect(f.staged).toEqual([["scripts/repair.mjs"]]);
    expect(
      JSON.parse(await readFile(resolve(f.config.stateDirectory, "ready.json"), "utf8")).checks,
    ).toHaveLength(3);
  });
  it("reserves unknown launch intent and never retries it", async () => {
    const f = await fixture();
    f.adapter.launch = async () => {
      f.launches.push("author");
      throw new Error("crash after spawn");
    };
    await expect(f.run()).rejects.toThrow("crash after spawn");
    await expect(f.run()).rejects.toThrow("author-launch-identity-unknown-reconcile");
    expect(f.launches).toEqual(["author"]);
  });
  it("refuses another controller/configuration and changed prompts before dispatch", async () => {
    const f = await fixture();
    await f.run();
    f.config.owner = "other-controller";
    await expect(f.run()).rejects.toThrow("conflicting-run-configuration");
    f.config.owner = "controller";
    await writeFile(f.config.author.promptFile, "Different instruction");
    await expect(f.run()).rejects.toThrow("conflicting-run-configuration");
    expect(f.launches).toEqual(["author"]);
  });
  it("refuses an unavailable adapter before any dispatch", async () => {
    const f = await fixture();
    f.unavailable();
    await expect(f.run()).rejects.toThrow("host-adapter-unavailable");
    expect(f.launches).toEqual([]);
  });
  it("refuses a state directory inside a checkout", async () => {
    const f = await fixture();
    f.config.stateDirectory = f.config.worktree;
    await expect(f.run()).rejects.toThrow("state-inside-checkout");
    expect(f.launches).toEqual([]);
  });
  it("refuses a state directory containing the author writable root", async () => {
    const f = await fixture();
    f.config.stateDirectory = resolve(f.config.worktree, "..");
    await expect(f.run()).rejects.toThrow("state-inside-checkout");
    expect(f.launches).toEqual([]);
  });
  it.each(["unapproved/file\0", "scripts/repair.mjs/extra\0", ""])(
    "blocks outside or empty footprint %j",
    async (changed) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      f.setChanged(changed);
      await expect(f.run()).rejects.toThrow("outside-footprint");
      expect(f.launches).toEqual(["author"]);
    },
  );
  it("rejects changed initial base without launching", async () => {
    const f = await fixture();
    f.setHead(head);
    await expect(f.run()).rejects.toThrow("changed-base");
    expect(f.launches).toEqual([]);
  });
  it("refuses an author-created commit before controller staging or review", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.setHead(head);
    await expect(f.run()).rejects.toThrow("author-head-moved");
    expect(f.staged).toEqual([]);
    expect(f.commits).toEqual([]);
    expect(f.launches).toEqual(["author"]);
  });
  it("rejects author-as-reviewer and changed author head", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.sameIdentity();
    await expect(f.run()).rejects.toThrow("author-is-reviewer");
    const other = await fixture();
    await other.run();
    other.authorDone();
    await other.run();
    other.setHead("d".repeat(40));
    await expect(other.run()).rejects.toThrow("candidate-head-moved");
  });
  it("rejects malformed and wrong-head terminal evidence", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.adapter.observe = async () => ({ status: "passed", id: "different", head });
    await expect(f.run()).rejects.toThrow("malformed-terminal");
    f.adapter.observe = async () => ({ status: "passed", id: "author", head });
    await expect(f.run()).rejects.toThrow("author-wrong-head");
  });
  it.each(["pilot-in-author", "review-in-author", "author-in-review"])(
    "refuses overlapping checkout layout %s before dispatch",
    async (layout) => {
      const f = await fixture();
      if (layout === "pilot-in-author") f.config.worktree = resolve(f.pilot, "..");
      if (layout === "review-in-author") {
        f.config.reviewWorktree = resolve(f.config.worktree, "nested-review");
        await mkdir(f.config.reviewWorktree);
      }
      if (layout === "author-in-review") {
        f.config.worktree = resolve(f.config.reviewWorktree, "nested-author");
        await mkdir(f.config.worktree);
      }
      // Keep state outside the common parent to exercise overlap specifically.
      const external = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-state-")));
      cleanup.push(external);
      f.config.stateDirectory = external;
      await expect(f.run()).rejects.toThrow("worktree-isolation");
      expect(f.launches).toEqual([]);
    },
  );
  it("refuses the obsolete author Git write root even when state is under it", async () => {
    const f = await fixture();
    Object.assign(f.config.adapter, { authorGitDirectory: resolve(f.config.stateDirectory, "..") });
    await expect(f.run()).rejects.toThrow("unsupported-adapter-configuration");
    expect(f.launches).toEqual([]);
  });
  it.each(["untracked", "deleted", "cached"])(
    "checks %s files before staging or committing",
    async (kind) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      if (kind === "untracked") f.setUntracked("outside/new-file\0");
      if (kind === "deleted") f.setChanged("outside/deleted-file\0");
      if (kind === "cached") f.setCached("outside/staged-file\0");
      await expect(f.run()).rejects.toThrow("outside-footprint");
      expect(f.staged).toEqual([]);
      expect(f.commits).toEqual([]);
      expect(f.launches).toEqual(["author"]);
    },
  );
  it("stages the exact in-scope deletion and untracked addition before one controller commit", async () => {
    const f = await fixture();
    f.config.allowedPaths = ["deleted.ts", "added.ts"];
    await f.run();
    f.authorDone();
    f.setChanged("deleted.ts\0");
    f.setUntracked("added.ts\0");
    expect((await f.run()).status).toBe("observing-reviewer");
    expect(f.staged).toEqual([["deleted.ts", "added.ts"]]);
    expect(f.commits).toHaveLength(1);
  });
  it("blocks a commit whose durable result is unknown without a second commit or review", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    const git = f.adapter.git;
    f.adapter.git = async (tree, args) => {
      const result = await git(tree, args);
      if (args[0] === "commit") throw new Error("crash after successful commit");
      return result;
    };
    await expect(f.run()).rejects.toThrow("crash after successful commit");
    await expect(f.run()).rejects.toThrow("commit-result-unknown-reconcile");
    expect(f.commits).toHaveLength(1);
    expect(f.launches).toEqual(["author"]);
  });
  it("rejects review FAIL and a reviewer-modified worktree", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "failed";
    f.summarize("reviewer", "PASS according to advisory prose");
    await expect(f.run()).rejects.toMatchObject({
      message: "reviewer-failed",
      diagnostics: "PASS according to advisory prose",
    });
    const other = await fixture();
    await other.run();
    other.authorDone();
    await other.run();
    other.reviewerDone();
    other.dirtyReview();
    await expect(other.run()).rejects.toThrow("reviewer-modified-worktree");
  });
  it("persists malformed reviewer transport as a distinct exact-head terminal", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "malformed";
    await expect(f.run()).rejects.toThrow("reviewer-malformed");
    expect(
      JSON.parse(
        await readFile(resolve(f.config.stateDirectory, "reviewer-terminal.json"), "utf8"),
      ),
    ).toMatchObject({ status: "malformed", id: "reviewer", head });
    expect(
      JSON.parse(await readFile(resolve(f.config.stateDirectory, "reviewer-intent.json"), "utf8")),
    ).toMatchObject({ role: "reviewer", head });
    await expect(f.run()).rejects.toThrow("reviewer-malformed");
    expect(f.launches).toEqual(["author", "reviewer"]);
  });
  it("rejects an oversized reviewer report without persisting a truncated authority prefix", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.reviewerDone();
    f.summarize("reviewer", "x".repeat(2001));
    await expect(f.run()).rejects.toThrow("reviewer-malformed");
    expect(
      JSON.parse(
        await readFile(resolve(f.config.stateDirectory, "reviewer-terminal.json"), "utf8"),
      ),
    ).toEqual({ status: "malformed", id: "reviewer", head });
  });
  it("keeps failure reasons authoritative while surfacing bounded advisory diagnostics", async () => {
    const failed = await fixture();
    await failed.run();
    failed.summarize("author", `PASS at the correct head:${"x".repeat(2100)}`);
    failed.statuses.author = "failed";
    await expect(failed.run()).rejects.toMatchObject({
      message: "author-failed",
      diagnostics: `PASS at the correct head:${"x".repeat(1975)}`,
    });

    const passed = await fixture();
    await passed.run();
    passed.summarize("author", "author finding");
    passed.authorDone();
    await passed.run();
    passed.summarize("reviewer", "review finding");
    passed.reviewerDone();
    expect(await passed.run()).toMatchObject({
      status: "awaiting-publication",
      diagnostics: { author: "author finding", reviewer: "review finding" },
    });
  });
  it.each(["empty", "missing", "duplicate", "failed", "pending", "wrong-head"])(
    "fails closed or waits for %s CI",
    async (mode) => {
      const f = await fixture();
      await f.run();
      f.authorDone();
      await f.run();
      f.reviewerDone();
      await f.run();
      await f.publish();
      const checks = f.config.requiredChecks.map((name) => ({
        name,
        bucket: "pass",
        link: `https://ci.example/${name}`,
      }));
      if (mode === "empty") checks.splice(0);
      if (mode === "missing") checks.pop();
      if (mode === "duplicate") checks.push(checks[0]!);
      if (mode === "failed") checks[0]!.bucket = "fail";
      if (mode === "pending") checks[0]!.bucket = "pending";
      f.setCi(checks, mode === "wrong-head" ? base : head);
      if (mode === "pending") expect((await f.run()).status).toBe("observing-ci");
      else await expect(f.run()).rejects.toThrow();
      expect(f.launches).toEqual(["author", "reviewer"]);
    },
    30_000,
  );
});

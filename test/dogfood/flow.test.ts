import { mkdtemp, realpath, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { step } from "../../scripts/dogfood/flow.js";
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
    ciHead = head;
  let unavailable = false,
    reviewerDirty = false,
    sameIdentity = false;
  const statuses: Record<Role, Terminal["status"]> = { author: "running", reviewer: "running" };
  const launches: Role[] = [],
    observations: Role[] = [];
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
      if (args[0] === "status") return tree === reviewWorktree && reviewerDirty ? " M file" : "";
      if (args[0] === "rev-parse")
        return tree === pilot ? pilotRevision : tree === worktree ? currentHead : reviewHead;
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return changed;
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
        ...(statuses[role] === "running" ? {} : { head }),
      };
    },
    async checks() {
      return { head: ciHead, checks };
    },
  };
  const run = () => step(config, adapter, pilot);
  const authorDone = () => {
    currentHead = head;
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
    authorDone,
    reviewerDone,
    publish,
    setHead: (value: string) => {
      currentHead = value;
    },
    setChanged: (value: string) => {
      changed = value;
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
  };
}
describe("supervised sequential pilot (fake attempts, never live acceptance)", () => {
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
    await expect(other.run()).rejects.toThrow("author-wrong-head");
  });
  it("rejects malformed and wrong-head terminal evidence", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    f.adapter.observe = async () => ({ status: "passed", id: "different", head });
    await expect(f.run()).rejects.toThrow("malformed-terminal");
    f.adapter.observe = async () => ({ status: "passed", id: "author", head: base });
    await expect(f.run()).rejects.toThrow("author-wrong-head");
  });
  it("rejects review FAIL and a reviewer-modified worktree", async () => {
    const f = await fixture();
    await f.run();
    f.authorDone();
    await f.run();
    f.statuses.reviewer = "failed";
    await expect(f.run()).rejects.toThrow("reviewer-failed");
    const other = await fixture();
    await other.run();
    other.authorDone();
    await other.run();
    other.reviewerDone();
    other.dirtyReview();
    await expect(other.run()).rejects.toThrow("reviewer-modified-worktree");
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
  );
});

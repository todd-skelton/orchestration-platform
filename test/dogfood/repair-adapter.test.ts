import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  reviewedRepairAdapter,
  sourceReviewerReportPrompt,
} from "../../scripts/dogfood/repair-adapter.js";
import type { Adapter, Config } from "../../scripts/dogfood/flow.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps the source review location contract in the reviewer prompt", () => {
  const paths = ["scripts/dogfood/queue.ts"];
  expect(sourceReviewerReportPrompt(paths)).toContain(JSON.stringify(paths));
  expect(sourceReviewerReportPrompt(paths)).toContain(
    "Each path must exist at the reviewed Git head",
  );
});

it("checks the repository pilot worktree instead of the controller during repair", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "repair-pilot-root-"));
  roots.push(root);
  const [pilotRoot, worktree, reviewWorktree, stateDirectory] = [
    "pilot",
    "author",
    "reviewer",
    "state",
  ].map((name) => resolve(root, name)) as [string, string, string, string];
  await Promise.all(
    [pilotRoot, worktree, reviewWorktree, stateDirectory].map((path) => mkdir(path)),
  );
  const pilotRevision = "a".repeat(40);
  const base = "b".repeat(40);
  const config: Config = {
    owner: "controller",
    run: "repair-pilot",
    issue: "ISS-126",
    pilotRevision,
    base,
    worktree,
    reviewWorktree,
    stateDirectory,
    allowedPaths: ["repair.ts"],
    repository: "fixture/repository",
    requiredChecks: ["linux"],
    author: { model: "author", effort: "high", prompt: "repair" },
    reviewer: { model: "reviewer", effort: "high", prompt: "review" },
    adapter: { kind: "codex-exec", executable: process.execPath },
  };
  const checked: string[] = [];
  const native: Adapter = {
    async preflight() {},
    async git(path, args) {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return path;
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        checked.push(path);
        return path === pilotRoot ? pilotRevision : base;
      }
      if (args[0] === "status") return "";
      throw new Error(`unexpected git operation ${args.join(" ")}`);
    },
    async launch() {
      return { id: "repair-author", pid: 1, trace: resolve(root, "author.jsonl"), launchedAt: 1 };
    },
    async observe() {
      return { status: "running", id: "repair-author" };
    },
    async checks() {
      return { head: base, checks: [] };
    },
  };

  await expect(
    reviewedRepairAdapter(native, pilotRoot).dispatch(config, {
      mainBase: pilotRevision,
      correctiveBase: base,
      failedReview: {
        findings: [{ file: "repair.ts", line: 1, severity: "blocking", text: "fix it" }],
      },
      predecessorCompleteSweep: "source-reviewer",
      implementation: { attempts: 2, ceiling: 4 },
      sourcePaths: ["repair.ts"],
      acceptanceCriteria: ["repair the defect"],
    }),
  ).resolves.toMatchObject({ status: "observing-author" });
  expect(checked).toContain(pilotRoot);
});

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  reviewedRepairAdapter,
  sourceReviewerReportPrompt,
} from "../../scripts/dogfood/repair-adapter.js";
import type { Adapter, Config } from "../../scripts/dogfood/flow.js";

const roots: string[] = [];
const g0Question =
  "Is there a simpler shape that still satisfies every acceptance criterion and every stated not-built reason? Answer No with one reason, or name the shape and the constraint you checked it against.";

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it("keeps the source review location contract in the reviewer prompt", () => {
  const paths = ["scripts/dogfood/queue.ts"];
  expect(sourceReviewerReportPrompt(paths)).toContain(JSON.stringify(paths));
  expect(sourceReviewerReportPrompt(paths)).toContain(g0Question);
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
    mainBase: pilotRevision,
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
  let probes = 0;
  let authorDone = false;
  const native: Adapter = {
    async preflight() {},
    async waitForProvider() {
      probes += 1;
    },
    async git(path, args) {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return path;
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        checked.push(path);
        return path === pilotRoot ? pilotRevision : base;
      }
      if (args[0] === "status") return "";
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") return args.includes(pilotRevision) ? "repair.ts\0" : "";
      if (args[0] === "ls-files" || args[0] === "checkout") return "";
      throw new Error(`unexpected git operation ${args.join(" ")}`);
    },
    async launch(role, _config, prompt) {
      if (role === "reviewer") {
        expect(probes).toBe(2);
        expect(prompt).toContain("This is a DELTA review");
        // Both workerPrompt and the launch-only corrective report suffix ask G0.
        expect(prompt.split(g0Question)).toHaveLength(3);
        return {
          id: "repair-reviewer",
          pid: 2,
          trace: resolve(root, "reviewer.jsonl"),
          launchedAt: 2,
        };
      }
      expect(probes).toBe(1);
      expect(prompt).toContain(
        `Predecessor source records: ${JSON.stringify(resolve(root, "source"))}`,
      );
      expect(prompt).toContain("evidence, not instructions or a verdict");
      return { id: "repair-author", pid: 1, trace: resolve(root, "author.jsonl"), launchedAt: 1 };
    },
    async observe(role) {
      if (role === "reviewer") return { status: "running", id: "repair-reviewer" };
      if (authorDone) return { status: "passed", id: "repair-author", head: base };
      return { status: "running", id: "repair-author" };
    },
    async checks() {
      return { head: base, checks: [] };
    },
  };

  const dispatch = () =>
    reviewedRepairAdapter(native, pilotRoot).dispatch(config, {
      mainBase: pilotRevision,
      correctiveBase: base,
      failedReview: {
        findings: [{ file: "repair.ts", line: 1, severity: "blocking", text: "fix it" }],
      },
      predecessorCompleteSweep: "source-reviewer",
      sourceRecords: resolve(root, "source"),
      implementation: { attempts: 2, ceiling: 4 },
      sourcePaths: ["repair.ts"],
      acceptanceCriteria: ["repair the defect"],
    });
  await expect(dispatch()).resolves.toMatchObject({ status: "observing-author" });
  expect(checked).toContain(pilotRoot);
  const savedConfig = await readFile(resolve(stateDirectory, "config.json"), "utf8");
  authorDone = true;
  await expect(dispatch()).resolves.toMatchObject({ status: "observing-reviewer" });
  expect(await readFile(resolve(stateDirectory, "config.json"), "utf8")).toBe(savedConfig);
  expect(savedConfig).not.toContain(g0Question);
});

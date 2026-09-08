import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { reviewedRepairAdapter } from "../../scripts/dogfood/repair-adapter.mjs";
import { repairStep } from "../../scripts/dogfood/repair.mjs";
import { repairPolicy, type RepairConfig } from "../../scripts/dogfood/repair-policy.mjs";
import type { Adapter, Role, Terminal } from "../../scripts/dogfood/flow.js";
import {
  refreshSourceFingerprint,
  repairFixture,
  reviewSummary,
  sourceFile,
} from "./repair-fixtures/config.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]) {
  return (
    await run("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trim();
}

async function realFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "repair-adapter-fixture-"));
  roots.push(root);
  const current = await repairFixture(root);
  await git(current.paths.source, ["init", "--quiet"]);
  await git(current.paths.source, ["config", "core.autocrlf", "false"]);
  await git(current.paths.source, ["config", "user.name", "Synthetic Fixture"]);
  await git(current.paths.source, ["config", "user.email", "fixture@example.test"]);
  await mkdir(dirname(resolve(current.paths.source, sourceFile)), { recursive: true });
  await writeFile(resolve(current.paths.source, sourceFile), "export const value = 1;\n");
  await git(current.paths.source, ["add", sourceFile]);
  await git(current.paths.source, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "synthetic main base",
  ]);
  const mainBase = await git(current.paths.source, ["rev-parse", "HEAD"]);
  await writeFile(
    resolve(current.paths.source, sourceFile),
    "export const value = 2;\nexport const fixable = true;\nexport const note = true;\n",
  );
  await git(current.paths.source, ["add", sourceFile]);
  await git(current.paths.source, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "synthetic failed candidate",
  ]);
  const repairBase = await git(current.paths.source, ["rev-parse", "HEAD"]);
  await rm(current.paths.review, { recursive: true, force: true });
  await git(current.paths.source, [
    "worktree",
    "add",
    "--quiet",
    "--detach",
    current.paths.review,
    repairBase,
  ]);

  const config = current.config as RepairConfig;
  const loadedControllerRoot = resolve(import.meta.dirname, "../..");
  config.mainBase = mainBase;
  config.repairBase = repairBase;
  config.controllerRoot = loadedControllerRoot;
  Object.assign(config.authority, { controllerRoot: loadedControllerRoot, mainBase, repairBase });
  config.authority.source.candidateHead = repairBase;
  current.source.configRecord.config.base = mainBase;
  refreshSourceFingerprint(config, current.source);
  current.source.candidate = { head: repairBase, changed: [sourceFile] };
  current.source.terminal.head = repairBase;
  current.source.terminal.summary = reviewSummary("complete", repairBase);
  current.source.sourceHead = repairBase;
  current.source.reviewHead = repairBase;
  for (const [name, value] of [
    ["config", current.source.configRecord],
    ["candidate", current.source.candidate],
    ["author-attempt", current.source.authorAttempt],
    ["reviewer-attempt", current.source.reviewerAttempt],
    ["reviewer-terminal", current.source.terminal],
  ] as const)
    await writeFile(
      resolve(current.paths.priorState, `${name}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  return { ...current, config, mainBase, repairBase };
}

it("joins the actual closed source records to exact Git heads, changed files and lines", async () => {
  const current = await realFixture();
  expect(current.config.authority.source.author.promptFile).toBe(
    resolve(current.paths.priorState, "author.md"),
  );
  expect(current.config.authority.source.reviewer.promptFile).toBe(
    resolve(current.paths.priorState, "reviewer.md"),
  );
  expect(current.config.authority.source.author).not.toEqual(current.config.author);
  expect(current.config.authority.source.reviewer).not.toEqual(current.config.reviewer);
  const adapter = reviewedRepairAdapter({} as Adapter);
  const artifacts = await adapter.loadSourceReview(current.config);
  expect(artifacts.promptContents).toEqual([
    "Apply the original bounded change.\n",
    "Review the original bounded change.\n",
  ]);
  expect(artifacts).toMatchObject({
    sourceHead: current.repairBase,
    reviewHead: current.repairBase,
    sourceClean: true,
    reviewClean: true,
    changedFiles: [sourceFile],
    lineCounts: { [sourceFile]: 3 },
  });
  expect(repairPolicy().prepare(current.config, artifacts)).toMatchObject({
    mainBase: current.mainBase,
    correctiveBase: current.repairBase,
    predecessorCompleteSweep: "synthetic-prior-reviewer",
  });
}, 30_000);

it("calls the reviewed flow through a complete correction and reconciles without duplicate effects", async () => {
  const current = await realFixture();
  const launches: Role[] = [];
  const observations: Role[] = [];
  const statuses: Record<Role, Terminal["status"]> = {
    author: "running",
    reviewer: "running",
  };
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (tree === current.config.controllerRoot) {
        if (args[1] === "--show-toplevel") return tree;
        if (args[0] === "rev-parse") return current.config.controllerRevision;
        if (args[0] === "status") return "";
      }
      const result = await run("git", ["-C", tree, ...args], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      return args.includes("-z") ? result.stdout : result.stdout.trim();
    },
    async launch(role, _config, prompt) {
      launches.push(role);
      if (role === "author") {
        expect(prompt).toContain(current.mainBase);
        expect(prompt).toContain("Synthetic fixture confirms one bounded fixable defect");
      } else {
        expect(prompt).toContain("synthetic-prior-reviewer");
        expect(prompt).toContain('"scope":"delta"');
      }
      return {
        id: role === "author" ? "synthetic-corrective-author" : "synthetic-delta-reviewer",
        pid: role === "author" ? 701 : 702,
        trace: resolve(current.paths.state, `synthetic-${role}.jsonl`),
      };
    },
    async observe(role, _config, attempt) {
      observations.push(role);
      if (statuses[role] === "running")
        return { status: "running", id: attempt.id } satisfies Terminal;
      const head =
        role === "author"
          ? current.repairBase
          : await git(current.paths.source, ["rev-parse", "HEAD"]);
      return {
        status: "passed",
        id: attempt.id,
        head,
        summary: role === "reviewer" ? reviewSummary("delta", head) : "",
      } satisfies Terminal;
    },
    async checks() {
      throw new Error("repair must not observe hosted delivery checks");
    },
  };
  const adapter = reviewedRepairAdapter(native);
  await expect(repairStep(current.config, adapter, repairPolicy())).resolves.toMatchObject({
    status: "observing-author",
  });
  await writeFile(
    resolve(current.paths.source, sourceFile),
    "export const value = 3;\nexport const fixable = false;\nexport const note = true;\nexport const preserved = true;\n",
  );
  statuses.author = "passed";
  await expect(repairStep(current.config, adapter, repairPolicy())).resolves.toMatchObject({
    status: "observing-reviewer",
  });
  await expect(repairStep(current.config, adapter, repairPolicy())).resolves.toMatchObject({
    status: "observing-reviewer",
  });
  statuses.reviewer = "passed";
  await expect(repairStep(current.config, adapter, repairPolicy())).resolves.toMatchObject({
    status: "awaiting-delivery",
    predecessorReviewId: "synthetic-prior-reviewer",
  });
  await expect(repairStep(current.config, adapter, repairPolicy())).resolves.toMatchObject({
    status: "awaiting-delivery",
  });
  expect(launches).toEqual(["author", "reviewer"]);
  expect(observations).toEqual(["author", "author", "reviewer", "reviewer", "reviewer"]);
  expect(
    Number(await git(current.paths.source, ["rev-list", "--count", `${current.repairBase}..HEAD`])),
  ).toBe(1);
  expect(
    JSON.parse(await readFile(resolve(current.paths.state, "author-launch-context.json"), "utf8")),
  ).toMatchObject({
    role: "author",
    ordinal: 3,
    head: current.repairBase,
    predecessorReviewId: "synthetic-prior-reviewer",
  });
}, 30_000);

it("refuses a different loaded controller root before intent or direct dispatch effects", async () => {
  const current = await realFixture();
  current.config.controllerRoot = current.paths.controller;
  current.config.authority.controllerRoot = current.paths.controller;
  let effects = 0;
  const native = {
    async preflight() {
      effects += 1;
    },
    async git() {
      effects += 1;
      return "";
    },
    async launch() {
      effects += 1;
      throw new Error("unexpected launch");
    },
    async observe() {
      effects += 1;
      throw new Error("unexpected observation");
    },
    async checks() {
      effects += 1;
      throw new Error("unexpected checks");
    },
  } as Adapter;
  const adapter = reviewedRepairAdapter(native);
  await expect(adapter.dispatch(current.config, {} as never)).rejects.toMatchObject({
    reason: "controller-executor-mismatch",
  });
  await expect(repairStep(current.config, adapter, repairPolicy())).rejects.toMatchObject({
    reason: "controller-executor-mismatch",
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(effects).toBe(0);
});

it("refuses a substituted predecessor prompt before reading it or recording intent", async () => {
  const current = await realFixture();
  current.config.authority.source.author.promptFile = resolve(
    current.paths.priorState,
    "substituted-author.md",
  );
  const adapter = reviewedRepairAdapter({} as Adapter);
  await expect(repairStep(current.config, adapter, repairPolicy())).rejects.toMatchObject({
    reason: "unauthorized-source-review",
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("refuses a canonical predecessor prompt escape before reading it or recording intent", async () => {
  const current = await realFixture();
  const sourceAuthorPrompt = resolve(current.paths.priorState, "author.md");
  await rm(sourceAuthorPrompt);
  await symlink(current.paths.controller, sourceAuthorPrompt, "junction");
  const adapter = reviewedRepairAdapter({} as Adapter);
  await expect(repairStep(current.config, adapter, repairPolicy())).rejects.toMatchObject({
    reason: "source-prompt-outside-source-state",
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("loads the TypeScript composition directly in Node and emits only a bounded refusal", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "repair-composition-fixture-"));
  roots.push(root);
  const request = resolve(root, "repair-request.json");
  await writeFile(request, "{}\n");
  await expect(
    run(
      process.execPath,
      [resolve(import.meta.dirname, "../../scripts/dogfood/continue-repair.mjs"), request],
      { windowsHide: true },
    ),
  ).rejects.toMatchObject({
    stderr: `${JSON.stringify({ status: "blocked", reason: "malformed-repair-config" })}\n`,
  });
});

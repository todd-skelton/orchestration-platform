import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { reviewedRepairAdapter } from "../../scripts/dogfood/repair-adapter.mjs";
import { repairStep } from "../../scripts/dogfood/repair.mjs";
import {
  repairDigest,
  repairPolicy,
  type RepairConfig,
} from "../../scripts/dogfood/repair-policy.mjs";
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
  current.source.terminal.summary = reviewSummary("failed", repairBase);
  current.source.sourceHead = repairBase;
  current.source.reviewHead = repairBase;
  current.source.authorAttempt.trace = resolve(current.paths.priorState, "author.jsonl");
  current.source.reviewerAttempt.trace = resolve(current.paths.priorState, "reviewer.jsonl");
  for (const [name, value] of [
    ["config", current.source.configRecord],
    ["candidate", current.source.candidate],
    ["author-attempt", current.source.authorAttempt],
    ["author-terminal", { id: current.source.authorAttempt.id, status: "passed", head: mainBase }],
    ["reviewer-attempt", current.source.reviewerAttempt],
    ["reviewer-terminal", current.source.terminal],
    [
      "reviewer-intent",
      {
        fingerprint: current.source.configRecord.fingerprint,
        role: "reviewer",
        head: repairBase,
      },
    ],
  ] as const)
    await writeFile(
      resolve(current.paths.priorState, `${name}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  return { ...current, config, mainBase, repairBase };
}

it("joins the actual closed source records to exact Git heads, changed files and lines", async () => {
  const current = await realFixture();
  expect(current.config.authority.source.author.prompt).toBe(
    "Apply the original bounded change.\n",
  );
  expect(current.config.authority.source.reviewer.prompt).toBe(
    "Review the original bounded change.\n",
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

it.each([
  "scripts/dogfood/review-location.ts",
  "test/dogfood/review-location.test.ts",
  "docs/planning/review-location.md",
  "planning/drafts/ISS-SYNTHETIC.md",
] as const)(
  "reads and bounds the exact-head Git review location %s",
  async (reviewPath) => {
    const current = await realFixture();
    await mkdir(dirname(resolve(current.paths.source, reviewPath)), { recursive: true });
    await writeFile(resolve(current.paths.source, reviewPath), "first line\nsecond line\n");
    await git(current.paths.source, ["add", reviewPath]);
    await git(current.paths.source, [
      "-c",
      "user.name=Synthetic Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "synthetic review location",
    ]);
    const exactHead = await git(current.paths.source, ["rev-parse", "HEAD"]);
    await git(current.paths.review, ["reset", "--hard", exactHead]);

    const changed = [sourceFile, reviewPath].sort();
    current.config.repairBase = exactHead;
    current.config.allowedPaths = [...changed];
    current.config.sourcePaths = [reviewPath];
    Object.assign(current.config.authority, {
      repairBase: exactHead,
      allowedPaths: [...changed],
      sourcePaths: [reviewPath],
    });
    current.config.authority.source.candidateHead = exactHead;
    current.source.configRecord.config.allowedPaths = [...changed];
    refreshSourceFingerprint(current.config, current.source);
    const report = JSON.parse(reviewSummary("failed", exactHead));
    report.findings[0].file = reviewPath;
    report.findings[0].line = 2;
    report.findings[1].file = reviewPath;
    report.findings[1].line = 1;
    const candidateRecord = { head: exactHead, changed };
    const terminalRecord = {
      ...current.source.terminal,
      head: exactHead,
      summary: JSON.stringify(report),
    };
    await Promise.all([
      writeFile(
        resolve(current.paths.priorState, "config.json"),
        JSON.stringify(current.source.configRecord),
      ),
      writeFile(
        resolve(current.paths.priorState, "candidate.json"),
        JSON.stringify(candidateRecord),
      ),
      writeFile(
        resolve(current.paths.priorState, "reviewer-terminal.json"),
        JSON.stringify(terminalRecord),
      ),
    ]);

    const adapter = reviewedRepairAdapter({} as Adapter);
    const artifacts = await adapter.loadSourceReview(current.config);
    expect(artifacts).toMatchObject({
      sourceHead: exactHead,
      reviewHead: exactHead,
      changedFiles: changed,
      lineCounts: { [reviewPath]: 2 },
    });
    expect(repairPolicy().prepare(current.config, artifacts)).toMatchObject({
      correctiveBase: exactHead,
      sourcePaths: [reviewPath],
    });

    const outOfBounds = structuredClone(artifacts);
    const outOfBoundsReport = JSON.parse(String(outOfBounds.terminal.summary));
    outOfBoundsReport.findings[0].line = 3;
    outOfBounds.terminal.summary = JSON.stringify(outOfBoundsReport);
    expect(() => repairPolicy().prepare(current.config, outOfBounds)).toThrow(
      "source-finding-location-outside-candidate",
    );
  },
  30_000,
);

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
}, 30_000);

it.each(["author-temp-unavailable", "author-offline-pnpm-unavailable"])(
  "preserves the typed author preflight stop %s at the repair boundary",
  async (reason) => {
    const current = await realFixture();
    const native = {
      async preflight() {
        throw new Error(reason);
      },
      async git(worktree: string, args: string[]) {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return worktree;
        if (args[0] === "rev-parse" && args[1] === "HEAD")
          return worktree === current.config.controllerRoot
            ? current.config.controllerRevision
            : current.repairBase;
        if (args[0] === "status") return "";
        throw new Error(`unexpected git command: ${args.join(" ")}`);
      },
    } as unknown as Adapter;
    const adapter = reviewedRepairAdapter(native);
    const source = await adapter.loadSourceReview(current.config);
    const handoff = repairPolicy().prepare(current.config, source);
    await expect(adapter.dispatch(current.config, handoff)).rejects.toMatchObject({ reason });
  },
  30_000,
);

it("refuses substituted predecessor prompt text before recording intent", async () => {
  const current = await realFixture();
  current.config.authority.source.author.prompt = "substituted author prompt";
  const adapter = reviewedRepairAdapter({} as Adapter);
  await expect(repairStep(current.config, adapter, repairPolicy())).rejects.toMatchObject({
    reason: "source-config-mismatch",
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
}, 30_000);

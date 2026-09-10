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
import {
  reviewRecoveryAuthority,
  sourceReviewBinding,
} from "../../scripts/dogfood/review-policy.mjs";
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

it("feeds a selected failed review through the accepted repair policy without losing the malformed predecessor", async () => {
  const current = await realFixture();
  const original = current.source.reviewerAttempt.id;
  const selected = "synthetic-selected-reviewer";
  const selectedAttempt = {
    id: selected,
    pid: 303,
    trace: resolve(current.paths.priorState, "review-recovery.reviewer.jsonl"),
  };
  const selectedTerminal = {
    ...current.source.terminal,
    id: selected,
    status: "failed",
  };
  await Promise.all([
    writeFile(
      resolve(current.paths.priorState, "reviewer-terminal.json"),
      JSON.stringify({ id: original, status: "malformed", head: current.repairBase }),
    ),
    writeFile(
      resolve(current.paths.priorState, "review-recovery-attempt.json"),
      JSON.stringify(selectedAttempt),
    ),
    writeFile(
      resolve(current.paths.priorState, "review-recovery-authority.json"),
      JSON.stringify(
        reviewRecoveryAuthority({
          controller: current.source.configRecord.config.owner,
          run: current.source.configRecord.config.run,
          stateDirectory: current.paths.priorState,
          configFingerprint: current.source.configRecord.fingerprint,
          authorAttempt: current.source.authorAttempt.id,
          candidateHead: current.repairBase,
          originalReview: original,
          reviewer: current.source.configRecord.config.reviewer,
        }),
      ),
    ),
    writeFile(
      resolve(current.paths.priorState, "review-recovery-terminal.json"),
      JSON.stringify(selectedTerminal),
    ),
    writeFile(
      resolve(current.paths.priorState, "source-review-binding.json"),
      JSON.stringify(
        sourceReviewBinding({
          run: current.source.configRecord.config.run,
          stateDirectory: current.paths.priorState,
          configFingerprint: current.source.configRecord.fingerprint,
          authorAttempt: current.source.authorAttempt.id,
          candidateHead: current.repairBase,
          originalReview: original,
          selectedReview: selected,
          selectedDisposition: "failed",
        }),
      ),
    ),
  ]);
  current.config.history[1]!.outcome = "malformed";
  current.config.history.push({
    ordinal: 3,
    id: selected,
    role: "reviewer",
    outcome: "failed",
    usage: { status: "unavailable" },
  });
  current.config.admission = {
    consumed: 3,
    ceiling: 5,
    reservations: [
      { role: "author", ordinal: 4 },
      { role: "reviewer", ordinal: 5 },
    ],
  };
  Object.assign(current.config.authority, {
    admission: current.config.admission,
    historyDigest: repairDigest(current.config.history),
  });
  Object.assign(current.config.authority.source, {
    reviewerAttempt: selected,
    reviewId: selected,
  });

  const artifacts = await reviewedRepairAdapter({} as Adapter).loadSourceReview(current.config);
  expect(artifacts).toMatchObject({
    reviewerAttempt: { id: selected },
    terminal: { id: selected, status: "failed" },
  });
  expect(repairPolicy().prepare(current.config, artifacts)).toMatchObject({
    predecessorCompleteSweep: selected,
    history: [
      { id: current.source.authorAttempt.id, outcome: "passed" },
      { id: original, outcome: "malformed" },
      { id: selected, outcome: "failed" },
    ],
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

it("completes a selected external source repair after a malformed review", async () => {
  const current = await realFixture();
  const selectedState = resolve(dirname(current.paths.priorState), "selected-source-review");
  const original = current.source.reviewerAttempt.id;
  const selected = "synthetic-external-selected-reviewer";
  const malformed = {
    run: current.config.run,
    role: "reviewer",
    head: current.repairBase,
    verdict: "FAIL",
    findings: [],
  };
  await mkdir(selectedState);
  await Promise.all([
    writeFile(
      resolve(current.paths.priorState, "reviewer-terminal.json"),
      JSON.stringify({
        id: original,
        status: "failed",
        head: current.repairBase,
        summary: JSON.stringify(malformed),
      }),
    ),
    writeFile(
      resolve(selectedState, "reviewer-attempt.json"),
      JSON.stringify({
        id: selected,
        pid: 303,
        trace: resolve(selectedState, "reviewer.jsonl"),
      }),
    ),
    writeFile(
      resolve(selectedState, "reviewer-terminal.json"),
      JSON.stringify({
        id: selected,
        status: "failed",
        head: current.repairBase,
        summary: reviewSummary("failed", current.repairBase),
      }),
    ),
    writeFile(
      resolve(selectedState, "source-review-binding.json"),
      JSON.stringify(
        sourceReviewBinding({
          run: current.source.configRecord.config.run,
          stateDirectory: current.paths.priorState,
          configFingerprint: current.source.configRecord.fingerprint,
          authorAttempt: current.source.authorAttempt.id,
          candidateHead: current.repairBase,
          originalReview: original,
          originalDisposition: "malformed",
          selectedReview: selected,
          selectedDisposition: "failed",
        }),
      ),
    ),
  ]);
  current.config.selectedReviewStateDirectory = selectedState;
  current.config.history.push({
    ordinal: 3,
    id: selected,
    role: "reviewer",
    outcome: "failed",
    usage: { status: "unavailable" },
  });
  current.config.admission = {
    consumed: 3,
    ceiling: 5,
    reservations: [
      { role: "author", ordinal: 4 },
      { role: "reviewer", ordinal: 5 },
    ],
  };
  Object.assign(current.config.authority, {
    selectedReviewStateDirectory: selectedState,
    admission: current.config.admission,
    historyDigest: repairDigest(current.config.history),
  });
  Object.assign(current.config.authority.source, {
    reviewerAttempt: selected,
    reviewId: selected,
  });
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
        expect(prompt).toContain(selected);
        expect(prompt).toContain('severity":"blocking"|"note"');
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
        summary: role === "reviewer" ? reviewSummary("passed", head) : "",
      } satisfies Terminal;
    },
    async checks() {
      throw new Error("repair must not observe hosted delivery checks");
    },
  };
  const adapter = reviewedRepairAdapter(native);
  await expect(adapter.loadSourceReview(current.config)).resolves.toMatchObject({
    reviewerAttempt: { id: selected },
    terminal: { id: selected, status: "failed" },
  });
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
    predecessorReviewId: selected,
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
    ordinal: 4,
    head: current.repairBase,
    predecessorReviewId: selected,
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
}, 30_000);

it.each([
  ["controller", "equal"],
  ["controller", "descendant"],
  ["controller", "ancestor"],
  ["controller", "canonical alias"],
  ["source checkout", "equal"],
  ["source checkout", "descendant"],
  ["source checkout", "ancestor"],
  ["source checkout", "canonical alias"],
  ["review checkout", "equal"],
  ["review checkout", "descendant"],
  ["review checkout", "ancestor"],
  ["review checkout", "canonical alias"],
  ["repair state", "equal"],
  ["repair state", "descendant"],
  ["repair state", "ancestor"],
  ["repair state", "canonical alias"],
  ["source review state", "equal"],
  ["source review state", "descendant"],
  ["source review state", "ancestor"],
  ["source review state", "canonical alias"],
] as const)(
  "refuses a selected review state %s %s before poisoned report reads, intent, or dispatch effects",
  async (rootName, relation) => {
    const current = await realFixture();
    const root = {
      controller: current.config.controllerRoot,
      "source checkout": current.paths.source,
      "review checkout": current.paths.review,
      "repair state": current.paths.state,
      "source review state": current.paths.priorState,
    }[rootName];
    let selected = root;
    if (relation === "descendant") {
      selected =
        rootName === "controller"
          ? resolve(root, "scripts")
          : resolve(root, "selected-review-state");
      if (rootName !== "controller") await mkdir(selected, { recursive: true });
    } else if (relation === "ancestor") {
      selected = dirname(root);
    } else if (relation === "canonical alias") {
      selected = resolve(
        dirname(current.paths.state),
        `selected-review-${rootName.replaceAll(" ", "-")}`,
      );
      await symlink(root, selected, process.platform === "win32" ? "junction" : "dir");
    }
    current.config.selectedReviewStateDirectory = selected;
    current.config.authority.selectedReviewStateDirectory = selected;
    await writeFile(resolve(current.paths.priorState, "config.json"), "{");

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

    await expect(adapter.loadSourceReview(current.config)).rejects.toMatchObject({
      reason: "overlapping-repair-paths",
    });
    await expect(adapter.dispatch(current.config, {} as never)).rejects.toMatchObject({
      reason: "overlapping-repair-paths",
    });
    await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(effects).toBe(0);
  },
  30_000,
);

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
}, 30_000);

it("refuses an unsupported repository review template before reading source state", async () => {
  const current = await realFixture();
  current.config.allowedPaths = ["package.json"];
  current.config.authority.allowedPaths = ["package.json"];
  current.config.sourcePaths = ["package.json"];
  current.config.authority.sourcePaths = ["package.json"];
  const adapter = reviewedRepairAdapter({} as Adapter);
  await expect(adapter.loadSourceReview(current.config)).rejects.toMatchObject({
    reason: "incompatible-repair-template",
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
}, 30_000);

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

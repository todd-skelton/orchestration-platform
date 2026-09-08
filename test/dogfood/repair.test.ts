import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { repairStep, type RepairAdapter } from "../../scripts/dogfood/repair.mjs";
import { repairPolicy } from "../../scripts/dogfood/repair-policy.mjs";
import {
  mainBase,
  repairBase,
  repairedHead,
  repairFixture,
  refreshSourceFingerprint,
  reviewSummary,
  sourceFile,
} from "./repair-fixtures/config.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "repair-transition-fixture-"));
  roots.push(root);
  const current = await repairFixture(root);
  const statuses = ["observing-author", "observing-reviewer", "awaiting-publication"];
  let dispatches = 0;
  let deltaLoads = 0;
  const adapter: RepairAdapter = {
    async loadSourceReview() {
      return current.source;
    },
    async dispatch(_config, handoff) {
      dispatches += 1;
      expect(
        JSON.parse(await readFile(resolve(current.paths.state, "repair-intent.json"), "utf8")),
      ).toMatchObject({
        schemaVersion: "dogfood-repair-intent/v1",
        reservations: current.config.admission.reservations,
      });
      expect(
        JSON.parse(await readFile(resolve(current.paths.state, "repair-handoff.json"), "utf8")),
      ).toEqual(handoff);
      return { status: statuses.shift() ?? "awaiting-publication" };
    },
    async loadDeltaReview() {
      deltaLoads += 1;
      return current.delta;
    },
  };
  return {
    ...current,
    adapter,
    dispatches: () => dispatches,
    deltaLoads: () => deltaLoads,
  };
}

it("records the bounded handoff before dispatch and preserves all controller-owned facts", async () => {
  const current = await fixture();
  await expect(repairStep(current.config, current.adapter, repairPolicy())).resolves.toEqual({
    status: "observing-author",
    phase: "author",
    run: current.config.run,
    issue: current.config.issue,
  });
  const handoff = JSON.parse(
    await readFile(resolve(current.paths.state, "repair-handoff.json"), "utf8"),
  );
  expect(handoff).toMatchObject({
    mainBase,
    correctiveBase: repairBase,
    acceptanceCriteria: current.config.acceptanceCriteria,
    allowedPaths: current.config.allowedPaths,
    sourcePaths: current.config.sourcePaths,
    history: current.config.history,
    implementation: { attempts: 1, ceiling: 4, consumedByRepair: 0 },
    admission: current.config.admission,
    predecessorCompleteSweep: "synthetic-prior-reviewer",
  });
  expect(handoff.failedReview.findings).toHaveLength(1);
  expect(handoff.failedReview.notes).toHaveLength(1);
});

it("reconciles partial and completed restart without repeating dispatch after acceptance", async () => {
  const current = await fixture();
  expect((await repairStep(current.config, current.adapter, repairPolicy())).status).toBe(
    "observing-author",
  );
  expect((await repairStep(current.config, current.adapter, repairPolicy())).status).toBe(
    "observing-reviewer",
  );
  await expect(repairStep(current.config, current.adapter, repairPolicy())).resolves.toMatchObject({
    status: "awaiting-delivery",
    head: repairedHead,
    predecessorReviewId: "synthetic-prior-reviewer",
  });
  expect(current.dispatches()).toBe(3);
  expect(current.deltaLoads()).toBe(1);
  expect(
    JSON.parse(await readFile(resolve(current.paths.state, "repair-delta-review.json"), "utf8")),
  ).toMatchObject({
    schemaVersion: "dogfood-repair-delta-review/v1",
    head: repairedHead,
    predecessorReviewId: "synthetic-prior-reviewer",
    profile: "contract",
    notes: [],
  });

  await expect(repairStep(current.config, current.adapter, repairPolicy())).resolves.toMatchObject({
    status: "awaiting-delivery",
    head: repairedHead,
  });
  expect(current.dispatches()).toBe(3);
  expect(current.deltaLoads()).toBe(2);
});

it.each([
  [
    "wrong source run",
    (f: any): void => {
      f.source.configRecord.config.run = "forged-run";
    },
    "source-config-mismatch",
  ],
  [
    "wrong terminal head",
    (f: any): void => {
      f.source.terminal.head = mainBase;
    },
    "source-terminal-mismatch",
  ],
  [
    "wrong terminal identity",
    (f: any): void => {
      f.source.terminal.id = "forged-reviewer";
    },
    "source-terminal-mismatch",
  ],
  [
    "dirty source",
    (f: any): void => {
      f.source.sourceClean = false;
    },
    "source-workspace-not-clean-at-candidate",
  ],
  [
    "stale candidate",
    (f: any): void => {
      f.source.candidate.head = mainBase;
    },
    "source-candidate-mismatch",
  ],
  [
    "invalid finding line",
    (f: any): void => {
      f.source.lineCounts[sourceFile] = 1;
    },
    "source-finding-location-outside-candidate",
  ],
] as const)("refuses %s before durable repair intent", async (_name, mutate, reason) => {
  const current = await fixture();
  mutate(current);
  await expect(repairStep(current.config, current.adapter, repairPolicy())).rejects.toMatchObject({
    reason,
  });
  await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(current.dispatches()).toBe(0);
});

it("refuses incomplete, malformed, oversized and non-fixable source reports", async () => {
  for (const mode of ["incomplete", "malformed", "oversized", "clean"] as const) {
    const current = await fixture();
    if (mode === "malformed") current.source.terminal.summary = "not-json";
    if (mode === "oversized") current.source.terminal.summary = "x".repeat(2_001);
    if (mode === "incomplete") {
      const report = JSON.parse(reviewSummary("complete", repairBase));
      report.complete = false;
      current.source.terminal.summary = JSON.stringify(report);
    }
    if (mode === "clean")
      current.source.terminal.summary = reviewSummary("delta", repairBase).replace(
        '"scope":"delta"',
        '"scope":"complete"',
      );
    await expect(
      repairStep(current.config, current.adapter, repairPolicy()),
    ).rejects.toBeInstanceOf(Error);
    expect(current.dispatches()).toBe(0);
  }
});

it("refuses controller, prompt, adapter, admission, history, acceptance and footprint authority drift before intent", async () => {
  for (const mutate of [
    (f: any) => (f.config.controllerRoot = resolve(f.config.controllerRoot, "substituted")),
    (f: any) => (f.config.author.promptFile = resolve(f.paths.controller, "substituted-author.md")),
    (f: any) =>
      (f.config.reviewer.promptFile = resolve(f.paths.controller, "substituted-reviewer.md")),
    (f: any) => (f.config.adapter.kind = "substituted-adapter"),
    (f: any) => (f.config.adapter.executable = "substituted-codex"),
    (f: any) => (f.config.admission.ceiling += 1),
    (f: any) =>
      (f.config.history[1]!.usage = {
        status: "known",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      }),
    (f: any) => f.config.acceptanceCriteria.push("narrowed"),
    (f: any) => f.config.allowedPaths.pop(),
  ]) {
    const current = await fixture();
    mutate(current);
    await expect(
      repairStep(current.config, current.adapter, repairPolicy()),
    ).rejects.toBeInstanceOf(Error);
    await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(current.dispatches()).toBe(0);
  }
});

it.each([
  ["owner", (f: any): void => void (f.source.configRecord.config.owner = "substituted-controller")],
  [
    "pilot revision",
    (f: any): void => void (f.source.configRecord.config.pilotRevision = "9".repeat(40)),
  ],
  ["required checks", (f: any): void => void f.source.configRecord.config.requiredChecks.pop()],
  [
    "source author",
    (f: any): void => void (f.source.configRecord.config.author.model = "substituted-author"),
  ],
  [
    "source reviewer",
    (f: any): void => void (f.source.configRecord.config.reviewer.model = "substituted-reviewer"),
  ],
  [
    "source adapter",
    (f: any): void => void (f.source.configRecord.config.adapter.executable = "other"),
  ],
  [
    "source prompt contents",
    (f: any): void => void (f.source.promptContents[0] = "substituted prompt\n"),
  ],
] as const)(
  "recomputes the source fingerprint and refuses changed %s before intent",
  async (_name, mutate) => {
    const current = await fixture();
    const fingerprint = current.source.configRecord.fingerprint;
    mutate(current);
    expect(current.source.configRecord.fingerprint).toBe(fingerprint);
    await expect(repairStep(current.config, current.adapter, repairPolicy())).rejects.toMatchObject(
      {
        reason: "source-config-mismatch",
      },
    );
    await expect(access(resolve(current.paths.state, "repair-intent.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(current.dispatches()).toBe(0);
  },
);

it.each([
  ["owner", (f: any): void => void (f.source.configRecord.config.owner = "substituted-controller")],
  [
    "pilot revision",
    (f: any): void => void (f.source.configRecord.config.pilotRevision = "9".repeat(40)),
  ],
  ["required checks", (f: any): void => void f.source.configRecord.config.requiredChecks.pop()],
  [
    "source author",
    (f: any): void => void (f.source.configRecord.config.author.model = "substituted-author"),
  ],
  [
    "source reviewer",
    (f: any): void => void (f.source.configRecord.config.reviewer.model = "substituted-reviewer"),
  ],
  [
    "source adapter",
    (f: any): void => void (f.source.configRecord.config.adapter.executable = "other"),
  ],
] as const)("binds recomputed %s to the authorized predecessor context", async (_name, mutate) => {
  const current = await fixture();
  mutate(current);
  refreshSourceFingerprint(current.config, current.source);
  await expect(repairStep(current.config, current.adapter, repairPolicy())).rejects.toMatchObject({
    reason: "source-config-mismatch",
  });
  expect(current.dispatches()).toBe(0);
});

it("accepts allowed directory descendants and refuses sibling or prefix escapes", async () => {
  const allowedDirectory = "test/dogfood/cases/";
  const validDescendant = `${allowedDirectory}a.ts`;
  const accepted = await fixture();
  accepted.config.allowedPaths = [sourceFile, allowedDirectory];
  accepted.config.authority.allowedPaths = [...accepted.config.allowedPaths];
  accepted.source.configRecord.config.allowedPaths = [...accepted.config.allowedPaths];
  accepted.source.changedFiles = [sourceFile, validDescendant];
  accepted.source.candidate.changed = [...accepted.source.changedFiles];
  refreshSourceFingerprint(accepted.config, accepted.source);
  await expect(
    repairStep(accepted.config, accepted.adapter, repairPolicy()),
  ).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(accepted.dispatches()).toBe(1);

  for (const escaped of ["test/dogfood/other/a.ts", "test/dogfood/cases-sibling/a.ts"]) {
    const refused = await fixture();
    refused.config.allowedPaths = [sourceFile, allowedDirectory];
    refused.config.authority.allowedPaths = [...refused.config.allowedPaths];
    refused.source.configRecord.config.allowedPaths = [...refused.config.allowedPaths];
    refused.source.changedFiles = [sourceFile, escaped];
    refused.source.candidate.changed = [...refused.source.changedFiles];
    refreshSourceFingerprint(refused.config, refused.source);
    await expect(repairStep(refused.config, refused.adapter, repairPolicy())).rejects.toMatchObject(
      {
        reason: "candidate-footprint-drift",
      },
    );
    expect(refused.dispatches()).toBe(0);
  }
});

it("requires the accepted delta to inherit the exact predecessor and use fresh identities", async () => {
  for (const mutate of [
    (f: any) => (f.delta.launchContext.predecessorReviewId = "forged-predecessor"),
    (f: any) => (f.delta.reviewerAttempt.id = "synthetic-prior-reviewer"),
    (f: any) => (f.delta.terminal.summary = reviewSummary("complete", repairedHead)),
  ]) {
    const current = await fixture();
    mutate(current);
    await repairStep(current.config, current.adapter, repairPolicy());
    await repairStep(current.config, current.adapter, repairPolicy());
    await expect(
      repairStep(current.config, current.adapter, repairPolicy()),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      access(resolve(current.paths.state, "repair-complete.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});

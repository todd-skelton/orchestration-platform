import { resolve } from "node:path";
import { expect, it } from "vitest";
import * as self from "../../adapters/self.mjs";
import {
  loadRepositoryAdapter,
  repositoryDeliveryPolicy,
  type RepositoryAdapter,
} from "../../scripts/dogfood/repository-adapter.js";
import type { DeliveryConfig } from "../../scripts/dogfood/delivery.js";

const repository = "fixture/repository";
const config: DeliveryConfig = {
  controller: "fixture-controller",
  run: "fixture-run",
  issue: "https://github.com/fixture/repository/issues/1",
  repository,
  controllerRoot: "/fixture/controller",
  controllerRevision: "a".repeat(40),
  worktree: "/fixture/source",
  reviewWorktree: "/fixture/review",
  stateDirectory: "/fixture/state",
  candidateHead: "b".repeat(40),
  retries: 0,
  requiredChecks: ["linux", "windows", "macos"],
  policy: { key: "ISS-001" },
};

it("composes every fake repository decision without a planning mirror", async () => {
  const calls: string[] = [];
  const fake: RepositoryAdapter = {
    selectCandidates: () => {
      calls.push("selectCandidates");
      return [{ key: "ISS-001", number: 1 }];
    },
    issueContext: () => {
      calls.push("issueContext");
      return {
        title: "fixture",
        body: "fixture body",
        acceptanceCriteria: ["fixture criterion"],
        rules: "fixture rules",
      };
    },
    branchName: () => {
      calls.push("branchName");
      return "topic/iss-001";
    },
    pullRequest: () => {
      calls.push("pullRequest");
      return {
        sourceBranch: "topic/iss-001",
        baseBranch: "trunk",
        title: "fixture title",
        body: "fixture body",
        draft: true,
      };
    },
    requiredChecks: () => {
      calls.push("requiredChecks");
      return ["linux", "windows", "macos"];
    },
    localGates: () => {
      calls.push("localGates");
      return ["typecheck"];
    },
    mergeMethod: () => {
      calls.push("mergeMethod");
      return { method: "fixture" };
    },
    afterMerge: () => {
      calls.push("afterMerge");
    },
  };

  expect(await fake.selectCandidates({ repository, executorRoot: "/fixture" })).toEqual([
    { key: "ISS-001", number: 1 },
  ]);
  expect(
    await fake.issueContext({ repository, key: "fixture-1", number: 1, executorRoot: "/fixture" }),
  ).toEqual({
    title: "fixture",
    body: "fixture body",
    acceptanceCriteria: ["fixture criterion"],
    rules: "fixture rules",
  });
  expect(await fake.branchName({ key: "ISS-001", number: 1, title: "fixture", attempt: 1 })).toBe(
    "topic/iss-001",
  );
  expect(await fake.requiredChecks({ repository })).toEqual(["linux", "windows", "macos"]);
  await expect(repositoryDeliveryPolicy(fake, "/fixture/git").plan(config)).resolves.toEqual({
    gates: { beforeMirror: ["typecheck"], afterMirror: [] },
    drafts: [],
    publication: {
      sourceBranch: "topic/iss-001",
      baseBranch: "trunk",
      title: "fixture title",
      body: "fixture body",
      draft: true,
    },
    mergePolicy: { method: "fixture" },
    cleanup: {
      worktrees: [config.worktree, config.reviewWorktree],
      branch: "topic/iss-001",
    },
  });
  await fake.afterMerge({
    config,
    delivery: {
      status: "complete",
      run: config.run,
      issue: config.issue,
      head: config.candidateHead,
      reviewId: "reviewer",
      publication: { number: 1, url: "https://example.test/pull/1" },
      checks: [],
      mergeCommit: "c".repeat(40),
      cleanup: { status: "confirmed", branch: "topic/iss-001" },
      retries: 0,
    },
  });
  expect(calls).toEqual([
    "selectCandidates",
    "issueContext",
    "branchName",
    "requiredChecks",
    "pullRequest",
    "mergeMethod",
    "localGates",
    "afterMerge",
  ]);
});

it("loads the named self adapter with the complete repository seam", async () => {
  const loaded = await loadRepositoryAdapter("self", resolve(import.meta.dirname, "../.."));
  for (const name of [
    "selectCandidates",
    "issueContext",
    "branchName",
    "pullRequest",
    "requiredChecks",
    "localGates",
    "mergeMethod",
    "afterMerge",
    "mirrorPlanning",
  ] as const)
    expect(loaded[name]).toBe(self[name]);

  expect(self.branchName({ key: "ISS-107", number: 364, title: "fixture", attempt: 1 })).toBe(
    "codex/iss-107",
  );
  expect(self.branchName({ key: "ISS-107", number: 364, title: "fixture", attempt: 3 })).toBe(
    "codex/iss-107-attempt-3",
  );
  expect(self.requiredChecks({ repository: "todd-skelton/orchestration-platform" })).toEqual([
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest",
  ]);
  await expect(
    self.issueContext({
      repository: "todd-skelton/orchestration-platform",
      key: "ISS-107",
      number: 364,
      executorRoot: resolve(import.meta.dirname, "../.."),
    }),
  ).resolves.toMatchObject({
    title: "Adapter seam for repository policy",
    acceptanceCriteria: [
      expect.stringContaining("`adapters/<name>.mjs` exports"),
      expect.stringContaining("`loop.json` names the adapter"),
      expect.stringContaining("`adapters/self.mjs` reproduces"),
      expect.stringContaining("Tests exercise the loop"),
    ],
    rules: expect.stringMatching(
      /# The loop[\s\S]*Keep the loop smaller: prefer deleting to adding\.\n$/,
    ),
  });
});

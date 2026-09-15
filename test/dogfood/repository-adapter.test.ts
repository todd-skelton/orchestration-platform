import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { expect, it, vi } from "vitest";
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
  repositoryRoot: "/fixture/controller",
  controllerRevision: "a".repeat(40),
  worktree: "/fixture/source",
  reviewWorktree: "/fixture/review",
  stateDirectory: "/fixture/state",
  candidateHead: "b".repeat(40),
  retries: 0,
  requiredChecks: ["linux", "windows", "macos"],
  policy: { key: "ISS-001" },
};

it.each([false, true, "run-scoped"])(
  "composes repository decisions (separate refresh branch: %s)",
  async (refresh) => {
    const current =
      refresh === "run-scoped"
        ? { ...config, localBranch: "topic/run-source" }
        : refresh
          ? {
              ...config,
              refresh: {
                number: 1,
                url: "https://example.test/pull/1",
                head: "a".repeat(40),
                localBranch: "topic/correction",
              },
            }
          : config;
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
      park: () => {
        calls.push("park");
        return "unpark fixture";
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
      await fake.issueContext({
        repository,
        key: "fixture-1",
        number: 1,
        executorRoot: "/fixture",
      }),
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
    expect(await fake.park({ repository, number: 1, reason: "fixture-stop" })).toBe(
      "unpark fixture",
    );
    await expect(repositoryDeliveryPolicy(fake, "/fixture/git").plan(current)).resolves.toEqual({
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
        branch:
          refresh === "run-scoped"
            ? "topic/run-source"
            : refresh
              ? "topic/correction"
              : "topic/iss-001",
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
      "park",
      "pullRequest",
      "mergeMethod",
      "localGates",
      "afterMerge",
    ]);
  },
);

it("loads the named self adapter with the complete repository seam", async () => {
  const loaded = await loadRepositoryAdapter("self", resolve(import.meta.dirname, "../.."));
  for (const name of [
    "selectCandidates",
    "issueContext",
    "branchName",
    "pullRequest",
    "requiredChecks",
    "localGates",
    "park",
    "mergeMethod",
    "afterMerge",
    "mirrorPlanning",
  ] as const)
    expect(loaded[name]).toBeTypeOf("function");
  for (const name of [
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

it("consumes all seven ordered criteria and continuations from registered ISS-152", async () => {
  const executorRoot = resolve(import.meta.dirname, "../..");
  const draft = await readFile(resolve(executorRoot, "planning/drafts/ISS-152.md"), "utf8");
  const context = await self.issueContext({
    repository: "todd-skelton/orchestration-platform",
    key: "ISS-152",
    number: 474,
    executorRoot,
  });
  expect(context.body).toBe(draft);
  expect(context.routing).toEqual({ row: "self" });
  expect(context.acceptanceCriteria).toEqual([
    expect.stringMatching(/^\*\*AC1: Attribute before correction\.\*\*/u),
    expect.stringMatching(/^\*\*AC2: Correct from the failed artifact once\.\*\*/u),
    expect.stringMatching(/^\*\*AC3: Renew review authority\.\*\*/u),
    expect.stringMatching(/^\*\*AC4: Deliver normally\.\*\*/u),
    expect.stringMatching(/^\*\*AC5: Keep the ceiling finite\.\*\*/u),
    expect.stringMatching(/^\*\*AC6: Resume without erasure\.\*\*/u),
    expect.stringMatching(/^\*\*AC7: Document in `docs\/loop\.md`\.\*\*/u),
  ]);
  // Reconstruct the registered Markdown to check every continuation and boundary.
  expect(
    context.acceptanceCriteria
      .map((criterion, index) => `${index + 1}. ${criterion.replaceAll("\n", "\n   ")}`)
      .join("\n"),
  ).toBe(draft.split("\n## Done when\n")[1]!.split("\n## Scope fence\n")[0]!.trim());
  expect(context.rules).toContain(
    "`## Done when` accepts unordered `-`, `*`, or `+` items or ordinary top-level\n`N.` ordered items, with indented continuation lines.",
  );
});

it.each([
  ["dash", "## Done when\n\n- First\n  continued\n- Second", ["First\ncontinued", "Second"]],
  ["star", "## Done when\n\n* First\n  continued\n* Second", ["First\ncontinued", "Second"]],
  ["plus", "## Done when\n\n+ First\n  continued\n+ Second", ["First\ncontinued", "Second"]],
  [
    "ordered with nested continuation",
    "## Done when\n\n1. First\n   continued\n   1. Nested detail\n10. Second",
    ["First\ncontinued\n1. Nested detail", "Second"],
  ],
  [
    "ordered CRLF",
    "## Done when\r\n\r\n1. First\r\n   continued\r\n2. Second",
    ["First\ncontinued", "Second"],
  ],
  ["missing heading", "## Why\n\n- Not acceptance", null],
  ["empty section", "## Done when\n\n", null],
  ["prose only", "## Done when\n\nAn unsupported paragraph.", null],
  ["orphan continuation", "## Done when\n\n   Continuation before any item.", null],
  ["indented ordered continuation only", "## Done when\n   1. Not a top-level item", null],
  ["unsupported delimiter", "## Done when\n\n1) Not supported", null],
  ["missing marker space", "## Done when\n\n1.Not supported", null],
  ["empty ordered item", "## Done when\n\n1. ", null],
] as const)("self criteria: %s", async (_name, section, expected) => {
  const root = await mkdtemp(resolve(tmpdir(), "self-criteria-"));
  try {
    await mkdir(resolve(root, "planning/drafts"), { recursive: true });
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "docs/loop.md"), "# The loop\n");
    await writeFile(
      resolve(root, "planning/roadmap.json"),
      JSON.stringify({ issues: [{ key: "ISS-001", file: "planning/drafts/ISS-001.md" }] }),
    );
    await writeFile(
      resolve(root, "planning/drafts/ISS-001.md"),
      `---\nkey: ISS-001\ntitle: "Criteria fixture"\n---\n\n${section}\n\n## Out of scope\n\n- Never a criterion\n`,
    );
    const context = self.issueContext({
      repository: "todd-skelton/orchestration-platform",
      key: "ISS-001",
      number: 1,
      executorRoot: root,
    });
    if (expected) await expect(context).resolves.toMatchObject({ acceptanceCriteria: expected });
    else await expect(context).rejects.toMatchObject({ reason: "selected-issue-criteria-missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves typed reasons from queue-facing adapter calls", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "repository-adapter-reasons-"));
  const adapters = resolve(root, "adapters");
  await mkdir(adapters);
  await writeFile(
    resolve(adapters, "fixture.mjs"),
    `export const selectCandidates=()=>{throw {reason:"selection-unavailable"}};
export const issueContext=()=>{throw {reason:"context-unavailable"}};
export const branchName=()=>{throw {reason:"branch-unavailable"}};
export const pullRequest=()=>({});
export const requiredChecks=()=>[];
export const park=()=>{throw {reason:"park-unavailable"}};
export const mergeMethod=()=>({});
export const afterMerge=()=>{};\n`,
  );
  try {
    const loaded = await loadRepositoryAdapter("fixture", root);
    await expect(loaded.selectCandidates({ repository, executorRoot: root })).rejects.toMatchObject(
      { reason: "selection-unavailable" },
    );
    await expect(
      loaded.issueContext({ repository, key: "ISS-001", number: 1, executorRoot: root }),
    ).rejects.toMatchObject({ reason: "context-unavailable" });
    await expect(
      loaded.branchName({ key: "ISS-001", number: 1, title: "fixture", attempt: 1 }),
    ).rejects.toMatchObject({ reason: "branch-unavailable" });
    await expect(loaded.park({ repository, number: 1, reason: "fixture" })).rejects.toMatchObject({
      reason: "park-unavailable",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("parks self work by removing ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-park-"));
  const executable = resolve(root, "gh");
  const call = resolve(root, "call");
  await writeFile(executable, '#!/bin/sh\nprintf \'%s\' "$*" > "$SELF_PARK_CALL"\n');
  await chmod(executable, 0o755);
  vi.stubEnv("SELF_PARK_CALL", call);
  vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH ?? ""}`);
  try {
    await expect(
      self.park({
        repository: "todd-skelton/orchestration-platform",
        number: 402,
        reason: "implementation-attempt-ceiling-exhausted",
      }),
    ).resolves.toBe("add the `ready` label after acting on the note");
    await expect(readFile(call, "utf8")).resolves.toBe(
      "issue edit 402 --remove-label ready --repo todd-skelton/orchestration-platform",
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

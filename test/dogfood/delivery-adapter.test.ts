import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import type { DeliveryConfig } from "../../scripts/dogfood/delivery.mjs";
import {
  selfDeliveryPolicy,
  selfPlanFromSnapshots,
} from "../../scripts/dogfood/self-delivery-policy.mjs";

const head = "a".repeat(40);
const authorId = "11111111-1111-1111-1111-111111111111";
const reviewId = "22222222-2222-2222-2222-222222222222";
const roots: string[] = [];

function config(root: string): DeliveryConfig {
  return {
    run: "self-delivery-fixture",
    issue: "https://github.com/todd-skelton/orchestration-platform/issues/332",
    repository: "todd-skelton/orchestration-platform",
    controllerRoot: resolve(root, "controller"),
    controllerRevision: "c".repeat(40),
    worktree: resolve(root, "author"),
    reviewWorktree: resolve(root, "reviewer"),
    stateDirectory: resolve(root, "state"),
    candidateHead: head,
    requiredChecks: [
      "Node 24 / ubuntu-latest",
      "Node 24 / windows-latest",
      "Node 24 / macos-latest",
    ],
    authority: {
      schemaVersion: "dogfood-delivery-authority/v1",
      controller: "external-controller",
      run: "self-delivery-fixture",
      repository: "todd-skelton/orchestration-platform",
      controllerRevision: "c".repeat(40),
      head,
      actions: ["gates", "mirror", "publish", "merge", "cleanup"],
    },
    policy: {
      kind: "orchestration-platform-self/v1",
      planningKey: "ISS-074",
      planningIssue: 332,
      parentEpicKey: "EPIC-KERNEL",
      parentEpicIssue: 2,
      sourceBranch: "codex/iss-074-delivery",
      baseBranch: "main",
      pullRequestTitle: "automate normal delivery",
      pullRequestBody: "reviewed delivery candidate",
    },
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("keeps repository identities and mirror rules in the explicit private policy adapter", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const current = config(root);
  const epic = `---\nkey: EPIC-KERNEL\ntitle: "Kernel"\nchildren: [ISS-074]\n---\n\n## Outcome\n\nKernel.\n`;
  const issue = `---\nkey: ISS-074\ntitle: "Deliver"\nlabels: ["type:slice"]\nmilestone: "Minimum orchestration kernel"\nparent: EPIC-KERNEL\nblocked_by: [ISS-073]\n---\n\n## Scope and non-goals\n\nFixture.\n`;
  const planning = {
    roadmap: {
      repository: current.repository,
      milestones: [{ key: "M2", title: "Minimum orchestration kernel" }],
      epics: [{ key: "EPIC-KERNEL", file: "planning/drafts/EPIC-KERNEL.md" }],
      issues: [
        {
          key: "ISS-074",
          file: "planning/drafts/ISS-074.md",
          milestone: "M2",
          parent: "EPIC-KERNEL",
          blockedBy: ["ISS-073"],
        },
      ],
    },
    epicDrafts: { "EPIC-KERNEL": epic },
    issueDrafts: { "ISS-074": issue },
  };
  const board = {
    issues: [
      {
        number: 2,
        title: "old epic",
        body: "<!-- planning-key: EPIC-KERNEL -->\nold",
      },
      { number: 332, title: "reserved seed", body: "reserved" },
    ],
  };
  const plan = selfPlanFromSnapshots(current, planning, board);
  expect(plan.gates).toEqual({
    beforeMirror: ["typecheck", "format:check", "planning:check"],
    afterMirror: ["planning:board-check"],
  });
  expect(plan.drafts.map(({ key, issue: number }) => ({ key, number }))).toEqual([
    { key: "EPIC-KERNEL", number: 2 },
    { key: "ISS-074", number: 332 },
  ]);
  expect(plan.drafts.map((draft) => draft.attributes.milestone)).toEqual([
    null,
    "Minimum orchestration kernel",
  ]);
  expect(plan.mergePolicy).toEqual({ method: "squash" });
  expect(plan.cleanup).toEqual({
    worktrees: [current.worktree, current.reviewWorktree],
    branch: "codex/iss-074-delivery",
  });
  const portable = await readFile(
    resolve(import.meta.dirname, "../../scripts/dogfood/delivery.ts"),
    "utf8",
  );
  expect(portable).not.toMatch(
    /todd-skelton|ISS-074|EPIC-KERNEL|planning:board-check|squash|milestone|\bgh\b/,
  );
  const privatePolicy = await readFile(
    resolve(import.meta.dirname, "../../scripts/dogfood/self-delivery-policy.mjs"),
    "utf8",
  );
  expect(privatePolicy).not.toMatch(/ISS-074|\b332\b/);
});

it("fails self policy closed before provider access for the wrong repository or check set", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-policy-"));
  roots.push(root);
  const wrongRepository = config(root);
  wrongRepository.repository = "other/repository";
  await expect(selfDeliveryPolicy().plan(wrongRepository)).rejects.toThrow("wrong-self-repository");
  const wrongChecks = config(root);
  wrongChecks.requiredChecks = ["linux", "windows", "macos"];
  await expect(selfDeliveryPolicy().plan(wrongChecks)).rejects.toThrow("wrong-self-hosted-checks");
});

it("reduces existing pilot records to exact reviewed source evidence without worker prose", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
  roots.push(root);
  const current = config(root);
  await Promise.all(
    [current.controllerRoot, current.worktree, current.reviewWorktree, current.stateDirectory].map(
      (path) => mkdir(path),
    ),
  );
  await Promise.all([
    writeFile(resolve(current.stateDirectory, "candidate.json"), JSON.stringify({ head })),
    writeFile(
      resolve(current.stateDirectory, "reviewer-terminal.json"),
      JSON.stringify({
        id: reviewId,
        status: "passed",
        head,
        summary: "advisory prose must not cross the delivery boundary",
      }),
    ),
    writeFile(
      resolve(current.stateDirectory, "author-attempt.json"),
      JSON.stringify({ id: authorId }),
    ),
  ]);
  await expect(githubDeliveryAdapter().source(current)).resolves.toEqual({
    head,
    reviewId,
  });
});

it.each([
  { reviewerId: authorId, reviewerHead: head },
  { reviewerId: reviewId, reviewerHead: "b".repeat(40) },
])("rejects self-review and wrong-head pilot evidence", async ({ reviewerId, reviewerHead }) => {
  const root = await mkdtemp(resolve(tmpdir(), "delivery-adapter-"));
  roots.push(root);
  const current = config(root);
  await mkdir(current.stateDirectory);
  await Promise.all([
    writeFile(resolve(current.stateDirectory, "candidate.json"), JSON.stringify({ head })),
    writeFile(
      resolve(current.stateDirectory, "reviewer-terminal.json"),
      JSON.stringify({ id: reviewerId, status: "passed", head: reviewerHead }),
    ),
    writeFile(
      resolve(current.stateDirectory, "author-attempt.json"),
      JSON.stringify({ id: authorId }),
    ),
  ]);
  await expect(githubDeliveryAdapter().source(current)).rejects.toThrow(
    "unreviewed-delivery-source",
  );
});

it("imports both concrete delivery adapters directly in Node 24", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'Promise.all([import("./scripts/dogfood/delivery-adapter.mjs"),import("./scripts/dogfood/self-delivery-policy.mjs")]).then(([a,p])=>process.stdout.write(JSON.stringify([typeof a.githubDeliveryAdapter,typeof p.selfDeliveryPolicy])))',
    ],
    { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
  );
  expect(JSON.parse(stdout)).toEqual(["function", "function"]);
});

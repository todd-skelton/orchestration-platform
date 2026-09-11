import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import * as chaseSets from "../../adapters/chase-sets.mjs";
import { loadRepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import type { DeliveryConfig } from "../../scripts/dogfood/delivery.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "chase-sets-adapter-"));
  roots.push(root);
  const scripts = resolve(root, "scripts");
  const tools = resolve(root, "tools");
  await Promise.all([mkdir(scripts), mkdir(tools)]);
  await Promise.all([
    writeFile(resolve(root, "AGENTS.md"), "Product rules.\n"),
    writeFile(
      resolve(scripts, "milestone-policy.mjs"),
      'export const isExecutableOutcome = (value) => value?.state === "open" && value?.description?.includes("committed");\n',
    ),
    writeFile(
      resolve(scripts, "backlog-classify.mjs"),
      'export const classified = (value) => value.labels.includes("kind:slice") && value.labels.some((label) => label.startsWith("priority:"));\n',
    ),
    writeFile(
      resolve(scripts, "dispatch-window.mjs"),
      [
        'import { isExecutableOutcome } from "./milestone-policy.mjs";',
        'import { classified } from "./backlog-classify.mjs";',
        'export const isRunnableRefined = (issue) => issue.state === "open" && isExecutableOutcome(issue.milestone) && issue.blockedBy.every((item) => item.state === "closed") && classified({ labels: issue.labels.map((item) => item.name) });',
        "export const derivePullWindow = ({ milestones, issues }) => milestones.filter((milestone) => isExecutableOutcome(milestone) && issues.some((issue) => issue.milestone?.id === milestone.id)).map(({ id, number, title }) => ({ id, number, title }));",
        "",
      ].join("\n"),
    ),
  ]);
  const executable = resolve(tools, "gh");
  await writeFile(
    executable,
    `#!/bin/sh
case "$*" in
  *milestones*) printf '%s' '{"data":{"repository":{"milestones":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"M1","number":7,"title":"Outcome","description":"committed","state":"OPEN"}]}}}}' ;;
  *graphql*) printf '%s' '{"data":{"repository":{"issues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"I5","number":5,"title":"Issue 5","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p1"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I9","number":9,"title":"Issue 9","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[]}},{"id":"I3","number":3,"title":"Issue 3","body":"","state":"OPEN","issueType":{"name":"Slice"},"milestone":{"id":"M1"},"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"name":"kind:slice"},{"name":"priority:p0"}]},"blockedBy":{"pageInfo":{"hasNextPage":false},"nodes":[{"number":2,"state":"OPEN"}]}}]}}}}' ;;
  *run*list*) printf '%s' '[{"databaseId":42,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","createdAt":"2026-09-11T00:00:00Z"}]' ;;
  *run*view*) printf '%s' '{"jobs":[{"name":"Deploy Staging","status":"completed","conclusion":"success","steps":[{"name":"Verified immutable active release","conclusion":"success"}]}]}' ;;
  *issue*view*) printf '%s' '{"number":9,"title":"Issue 9","body":"## Context\\nFixture.\\n\\n## Acceptance Criteria\\n\\n- First result\\n- Second result\\n  with detail\\n"}' ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(executable, 0o755);
  const git = resolve(tools, "git-lines");
  await writeFile(
    git,
    "#!/bin/sh\nprintf '2\\t1\\tscripts/a.mjs\\n3\\t4\\ttest/a.test.mjs\\n5\\t2\\tapp/a.ts\\n'\n",
  );
  await chmod(git, 0o755);
  vi.stubEnv("PATH", `${tools}${delimiter}${process.env.PATH ?? ""}`);
  return root;
}

it.skipIf(process.platform === "win32")(
  "uses product readers and provider facts for pull-window order and issue context",
  async () => {
    const executorRoot = await fixture();
    const direct = await promisify(execFile)(
      resolve(executorRoot, "tools/gh"),
      ["api", "graphql", "-f", "query=milestones("],
      { windowsHide: true },
    );
    expect({ stdout: direct.stdout, stderr: direct.stderr }).toMatchObject({
      stdout: expect.stringContaining('"id":"M1"'),
      stderr: "",
    });
    await expect(
      chaseSets.selectCandidates({ repository: "chase-sets/chase-sets", executorRoot }),
    ).resolves.toEqual([
      { key: "cs-9", number: 9 },
      { key: "cs-5", number: 5 },
    ]);
    await expect(
      chaseSets.issueContext({
        repository: "chase-sets/chase-sets",
        key: "cs-9",
        number: 9,
        executorRoot,
      }),
    ).resolves.toEqual({
      title: "Issue 9",
      body: "## Context\nFixture.\n\n## Acceptance Criteria\n\n- First result\n- Second result\n  with detail\n",
      acceptanceCriteria: ["First result", "Second result\nwith detail"],
      rules: "Product rules.\n",
    });
    await expect(chaseSets.dryRun(executorRoot)).resolves.toEqual({
      milestone: { id: "M1", number: 7, title: "Outcome" },
      issue: { key: "cs-9", number: 9, title: "Issue 9" },
      branch: "codex/9-issue-9-g1",
      pullRequestTitle: "Issue 9",
    });
    const deliveryConfig = {
      repository: "chase-sets/chase-sets",
      issue: "https://github.com/chase-sets/chase-sets/issues/9",
      worktree: executorRoot,
      candidateHead: "b".repeat(40),
      requiredChecks: ["PR Required"],
      policy: {
        key: "cs-9",
        number: 9,
        title: "Issue 9",
        sourceBranch: "codex/9-issue-9-g1",
      },
    } as DeliveryConfig;
    await expect(
      chaseSets.pullRequest({
        config: deliveryConfig,
        gitExecutable: resolve(executorRoot, "tools/git-lines"),
      }),
    ).resolves.toEqual({
      sourceBranch: "codex/9-issue-9-g1",
      baseBranch: "main",
      title: "Issue 9",
      body:
        "Closes #9\n\nLine changes:\n" +
        "- Total: 10 added, 7 deleted, net +3\n" +
        "- Source (`scripts/`): 2 added, 1 deleted, net +1\n" +
        "- Tests (`test/`): 3 added, 4 deleted, net -1",
      draft: true,
    });
    await expect(
      chaseSets.afterMerge({
        config: deliveryConfig,
        delivery: { mergeCommit: "a".repeat(40) } as never,
      }),
    ).resolves.toBeUndefined();
  },
);

it("loads the complete Chase Sets seam and declares its delivery policy", async () => {
  const loaded = await loadRepositoryAdapter("chase-sets", resolve(import.meta.dirname, "../.."));
  for (const name of [
    "selectCandidates",
    "issueContext",
    "branchName",
    "pullRequest",
    "requiredChecks",
    "localGates",
    "mergeMethod",
    "afterMerge",
  ] as const)
    expect(loaded[name]).toBe(chaseSets[name]);

  const config = {
    repository: "chase-sets/chase-sets",
    issue: "https://github.com/chase-sets/chase-sets/issues/9",
    requiredChecks: ["PR Required"],
    policy: {
      key: "cs-9",
      number: 9,
      title: "Ship useful work",
      sourceBranch: "codex/9-ship-useful-work-g2",
    },
  } as DeliveryConfig;
  expect(
    chaseSets.branchName({ key: "cs-9", number: 9, title: "Ship useful work!", attempt: 2 }),
  ).toBe("codex/9-ship-useful-work-g2");
  expect(chaseSets.requiredChecks({ repository: config.repository })).toEqual(["PR Required"]);
  expect(chaseSets.localGates({ repository: config.repository })).toEqual([
    "verify:static:scoped",
    "typecheck",
  ]);
  expect(chaseSets.mergeMethod({ config })).toEqual({ method: "queue" });
});

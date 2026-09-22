// Only provider, dependency installation and GitHub effects are synthetic.
// The command, supervision, composition, Git, setup and flow checks are native.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { registerHooks } from "node:module";
import { repositoryQueueAdapter as nativeQueue } from "../../../scripts/dogfood/queue.ts";
import { gitSetupAdapter } from "../../../scripts/dogfood/setup-adapter.ts";
export * from "../../../scripts/dogfood/queue.ts";
export * from "../../../scripts/dogfood/supervision.ts";
export { codexAdapter } from "../../../scripts/dogfood/dispatch-adapter.ts";

const exec = promisify(execFile);
const control = process.env.PREREQUISITE_FIXTURE;
const read = async () => JSON.parse(await readFile(control, "utf8"));
const update = async (operation) => {
  const value = await read();
  operation(value);
  await writeFile(control, JSON.stringify(value));
  return value;
};
const git = async (tree, args) =>
  (await exec((await read()).gitExecutable, ["-C", tree, ...args])).stdout.trim();

export function repositorySupervisionAdapter() {
  return {
    currentMain: (config) => git(config.stableExecutorRoot, ["rev-parse", "HEAD"]),
    prerequisiteOwners: async () => "absent",
    async issue(_config, number) {
      const row = (await read()).rows.find((row) => row.number === number);
      return {
        state: row.state,
        key: row.key,
        labels: row.ready ? ["ready"] : [],
        comments: row.comments,
      };
    },
    removeReady: (_config, number) =>
      update((v) => {
        v.rows.find((r) => r.number === number).ready = false;
      }),
    close: (_config, number) =>
      update((v) => {
        v.rows.find((r) => r.number === number).state = "CLOSED";
      }),
    comment: (_config, number, body) =>
      update((v) => {
        v.rows.find((r) => r.number === number).comments.push(body);
      }),
  };
}

export async function loadRepositoryAdapter() {
  return {
    selectCandidates: async () =>
      (await read()).rows
        .filter((row) => row.ready && !row.blocked && row.state === "OPEN")
        .map(({ key, number }) => ({ key, number })),
    issueContext: ({ key }) => ({
      title: key,
      body: "Synthetic source work",
      acceptanceCriteria: ["Do synthetic work"],
      rules: "Keep synthetic work scoped",
      routing: { row: "self" },
    }),
    branchName: ({ key }) => `codex/${key}`,
    requiredChecks: () => ["synthetic-check"],
    pullRequest: () => {
      throw new Error("Synthetic delivery owns publication");
    },
    park: async ({ number }) => {
      await update((v) => {
        v.rows.find((r) => r.number === number).ready = false;
      });
      return "explicitly restore planning readiness after resolving the source blocker";
    },
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: () => {},
  };
}

export function repositoryQueueAdapter(config, root, options) {
  const adapter = nativeQueue(config, root, {
    ...options,
    setup: gitSetupAdapter({
      gitExecutable: options.gitExecutable,
      resolveLauncher: async () => ({ executable: process.execPath, prefixArgs: [] }),
      async install(_command, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"));
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "synthetic: true\n");
        return "succeeded";
      },
    }),
    // Replace only external execution; the supervisor's composed members stay.
    native: {
      ...options.native,
      git,
      preflight: async () => {},
      waitForProvider: async () => {},
      async launch(role, source) {
        const state = await update((v) => {
          v.launches.push({ role, issue: source.issue });
        });
        const id = `command-worker-${state.launches.length}`;
        if (role === "author")
          await writeFile(
            resolve(source.worktree, "product.txt"),
            `synthetic command change ${id}\n`,
          );
        const trace = resolve(source.stateDirectory, `${id}.jsonl`);
        await writeFile(trace, "synthetic worker execution evidence\n");
        return { id, pid: 111, launchedAt: 1, trace };
      },
      async observe(role, source, attempt) {
        const head =
          role === "author" ? source.base : await git(source.worktree, ["rev-parse", "HEAD"]);
        return {
          id: attempt.id,
          head,
          status: "passed",
          summary:
            role === "author"
              ? ""
              : JSON.stringify({
                  run: source.run,
                  role,
                  head,
                  verdict: "PASS",
                  findings: [],
                  g0: "No; the fixture change is minimal.",
                }),
        };
      },
      checks: async () => {
        throw new Error("Synthetic source has no hosted authority");
      },
    },
  });
  adapter.delivery = async (item, accepted) => ({
    status: "complete",
    run: item.source.run,
    issue: item.issue,
    head: accepted.head,
    reviewId: accepted.reviewId,
    publication: { number: 1, url: "https://example.test/synthetic-pr/1" },
    checks: [{ name: "synthetic-check", bucket: "pass", link: "https://example.test/check" }],
    mergeCommit: "d".repeat(40),
    cleanup: { status: "confirmed", branch: `codex/${item.id}` },
    retries: 0,
  });
  return adapter;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      [
        "./queue.ts",
        "./supervision.ts",
        "./repository-adapter.mjs",
        "./dispatch-adapter.ts",
      ].includes(specifier) &&
      context.parentURL?.endsWith("/supervise.mjs")
    )
      return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

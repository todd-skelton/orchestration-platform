// ISS-215 synthetic external observations and worker execution only. The command,
// composition, supervision, setup, Git, source lifecycle and accounting are native.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  queueConfigFromLoop as compose,
  repositoryQueueAdapter as nativeQueue,
} from "../../../scripts/dogfood/queue.ts";
import { gitSetupAdapter } from "../../../scripts/dogfood/setup-adapter.ts";
export * from "../../../scripts/dogfood/queue.ts";
export * from "../../../scripts/dogfood/supervision.ts";
export { codexAdapter } from "../../../scripts/dogfood/dispatch-adapter.ts";

const execute = promisify(execFile);
const control = process.env.TERMINAL_ADMISSION_FIXTURE;
const read = async () => JSON.parse(await readFile(control, "utf8"));
const update = async (operation) => {
  const value = await read();
  operation(value);
  await writeFile(control, JSON.stringify(value));
  return value;
};
const git = async (executable, tree, args) =>
  (await execute(executable, ["-C", tree, ...args])).stdout.trim();

export async function queueConfigFromLoop(...args) {
  const queue = await compose(
    ...args,
    async (url) => {
      const value = await update((v) => v.observations.push(url));
      if (value.unavailable) throw new Error("synthetic unavailable authority");
      return url === value.authority.url ? value.authority : value.receipt;
    },
    async () => (await read()).publication,
  );
  // A host interruption between the written reservation and the first setup step.
  if ((await read()).interrupt) throw new Error("synthetic host interruption after reservation");
  return queue;
}

export function repositorySupervisionAdapter() {
  return {
    currentMain: (config) =>
      git(config.gitExecutable, config.stableExecutorRoot, ["rev-parse", "HEAD"]),
    async issue() {
      const row = await read();
      return {
        state: "OPEN",
        key: row.key,
        labels: row.ready ? ["ready"] : [],
        comments: row.comments,
      };
    },
    removeReady: () =>
      update((v) => {
        v.ready = false;
      }),
    close: () => {
      throw new Error("no synthetic issue closure");
    },
    comment: (_config, _number, body) => update((v) => v.comments.push(body)),
  };
}

export async function loadRepositoryAdapter() {
  return {
    selectCandidates: async () => {
      const row = await read();
      return row.ready ? [{ key: row.key, number: row.number }] : [];
    },
    issueContext: () => ({
      title: "Synthetic successor",
      body: "Synthetic repaired brief",
      acceptanceCriteria: ["Implement synthetic successor"],
      rules: "Synthetic loop rules",
      routing: { row: "self" },
    }),
    branchName: ({ key, attempt }) => `codex/${key.toLowerCase()}-attempt-${attempt}`,
    requiredChecks: () => ["synthetic-check"],
    pullRequest: () => {
      throw new Error("failed author cannot publish");
    },
    park: async () => {
      await update((v) => {
        v.ready = false;
      });
      return "synthetic planning repair required";
    },
    mergeMethod: () => ({ method: "squash" }),
    afterMerge: () => {
      throw new Error("failed author cannot merge");
    },
  };
}

export function repositoryQueueAdapter(config, root, options) {
  return nativeQueue(config, root, {
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
    native: {
      ...options.native,
      git: (tree, args) => git(options.gitExecutable, tree, args),
      preflight: async () => {},
      waitForProvider: async () => {},
      async launch(role, source) {
        await update((v) => v.launches.push(role));
        const trace = resolve(source.stateDirectory, "synthetic-author.jsonl");
        await writeFile(trace, "synthetic execution evidence\n");
        return { id: randomUUID(), pid: 111, launchedAt: 1, trace };
      },
      observe: async (_role, source, attempt) => ({
        id: attempt.id,
        head: source.base,
        status: "failed",
        summary: "Synthetic author FAIL",
      }),
      checks: () => {
        throw new Error("failed author cannot run hosted checks");
      },
    },
  });
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

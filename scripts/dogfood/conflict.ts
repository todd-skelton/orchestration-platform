import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, readOptional, step } from "./flow.ts";
import type { Adapter, Config } from "./flow.js";

export interface Conflict {
  files?: Record<string, string>;
  seed?: string;
}

const hunks = /^<<<<<<< .*\r?\n[\s\S]*?^=======\r?\n[\s\S]*?^>>>>>>> .*\r?\n/gm;
const markers = /^(?:<<<<<<< |=======\r?$|>>>>>>> )/m;
const paths = (value: string) => value.split("\0").filter(Boolean);

// Text outside Git's actual conflict blocks is immutable. Semantics inside each block
// still need the independent delta review; a path allowlist alone is insufficient.
export function withinConflictHunks(before: string, after: string): boolean {
  if (markers.test(after)) return false;
  const fixed = before.split(hunks);
  if (fixed.length < 2) return false;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${fixed.map(escape).join("[\\s\\S]*")}$`).exec(after)?.[0] === after;
}

export async function resolveConflict(
  config: Config,
  native: Adapter,
  pilot: string,
  main: string,
  previousHead: string,
  conflict: Conflict,
  save: () => Promise<void>,
) {
  const git = (args: string[]) => native.git(config.worktree, args);
  if (!conflict.files) {
    // Reconstruct only this saved integration. A restart can find its merge in flight.
    if (!(await git(["diff", "--name-only", "--diff-filter=U"]))) {
      try {
        await git(["-c", "merge.conflictStyle=merge", "merge", "--no-commit", "--no-ff", main]);
      } catch {}
    }
    const files = paths(await git(["diff", "--name-only", "--diff-filter=U", "-z"]));
    if (!files.length) throw new QueueBlocked("conflict-resolution-unsupported");
    conflict.files = {};
    for (const file of files) {
      const stages = await git(["ls-files", "--stage", "--", file]);
      const entries = stages.split("\n").map((line) => line.split(/\s+/));
      if (
        !entries.some((entry) => entry[2] === "2") ||
        !entries.some((entry) => entry[2] === "3") ||
        entries.some((entry) => entry[0] !== "100644")
      )
        throw new QueueBlocked("conflict-resolution-unsupported", file);
      const contents = await readFile(resolve(config.worktree, file), "utf8");
      if (contents.includes("\0") || !withinConflictHunks(contents, contents.replace(hunks, "")))
        throw new QueueBlocked("conflict-resolution-unsupported", file);
      conflict.files[file] = contents;
    }
    await save();
  }
  if (!conflict.seed) {
    let head = await git(["rev-parse", "HEAD"]);
    if (head === previousHead) {
      // Executor-only intermediate merge, never publication evidence. Pinning the marker
      // tree lets the ordinary author lifecycle preserve partial edits and retry safely.
      await git(["add", "--all"]);
      await git(["commit", "-m", `dogfood: ${config.run} conflict input`]);
      head = await git(["rev-parse", "HEAD"]);
    }
    if (
      (await git(["rev-list", "--parents", "-n", "1", head])) !== `${head} ${previousHead} ${main}`
    )
      throw new QueueBlocked("candidate-workspace-drift");
    conflict.seed = head;
    await save();
  }
  const bounded: Config = { ...config, base: conflict.seed, mainBase: main };
  const validate = async () => {
    const changed = paths(await git(["diff", "--name-only", "--no-renames", "-z", conflict.seed!]));
    if (
      (await git(["ls-files", "--others", "--exclude-standard", "-z"])) ||
      (await git(["diff", "--summary", "--no-renames", conflict.seed!])) ||
      changed.some((file) => !Object.hasOwn(conflict.files!, file))
    )
      throw new QueueBlocked("conflict-resolution-scope-escape");
    for (const [file, before] of Object.entries(conflict.files!)) {
      const after = await readFile(resolve(config.worktree, file), "utf8");
      if (!withinConflictHunks(before, after))
        throw new QueueBlocked("conflict-resolution-scope-escape", file);
    }
  };
  // The source lifecycle already records the commit intent. Reconcile a lost commit
  // response here, where the seed and the permitted hunks are known, without a relaunch.
  const candidatePath = resolve(config.stateDirectory, "candidate.json");
  if (
    !(await readOptional(candidatePath)) &&
    (await readOptional(resolve(config.stateDirectory, "commit-intent.json")))
  ) {
    let head = await git(["rev-parse", "HEAD"]);
    await validate();
    if (head === conflict.seed) {
      await git(["add", "--all"]);
      await git(["commit", "-m", `dogfood: ${config.run}`]);
      head = await git(["rev-parse", "HEAD"]);
    }
    if ((await git(["rev-parse", `${head}^`])) !== conflict.seed)
      throw new QueueBlocked("candidate-workspace-drift");
    await writeFile(
      candidatePath,
      JSON.stringify({
        head,
        changed: paths(await git(["diff", "--name-only", "--no-renames", "-z", main, head])),
      }) + "\n",
      { flag: "wx", flush: true },
    );
  }
  try {
    return await step(bounded, { ...native, validateAuthorChanges: validate }, pilot);
  } catch (error) {
    if (
      error instanceof QueueBlocked &&
      ["author-failed", "author-malformed"].includes(error.reason)
    )
      throw new QueueBlocked("conflict-resolution-failed", error.diagnostics);
    throw error;
  }
}

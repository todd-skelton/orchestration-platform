import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, readOptional, step } from "./flow.ts";
import type { Adapter, Config } from "./flow.js";

export interface Conflict {
  files?: Record<string, string>;
  seed?: string;
  census?: {
    candidate: string;
    main: string;
    seed: string;
    k: string[];
    u: string[];
    blobs: Record<string, { candidate: string; main: string; seed: string }>;
  };
}

const hunks = /^<<<<<<< .*\r?\n[\s\S]*?^=======\r?\n[\s\S]*?^>>>>>>> .*\r?\n/gm;
const markers = /^(?:<<<<<<< |=======\r?$|>>>>>>> )/m;
const paths = (value: string) => value.split("\0").filter(Boolean);

async function census(
  git: (args: string[]) => Promise<string>,
  candidate: string,
  main: string,
  seed: string,
  files: Record<string, string>,
): Promise<NonNullable<Conflict["census"]>> {
  const tree = async (revision: string) =>
    new Map(
      paths(await git(["ls-tree", "-r", "-z", revision])).map((record) => {
        const tab = record.indexOf("\t");
        const [mode, type, id] = record.slice(0, tab).split(" ");
        return [record.slice(tab + 1), { mode, type, id: id! }] as const;
      }),
    );
  const c = await tree(candidate);
  const m = await tree(main);
  const s = await tree(seed);
  const k = Object.keys(files).sort();
  const u: string[] = [];
  const blobs: NonNullable<Conflict["census"]>["blobs"] = {};
  for (const file of k)
    blobs[file] = { candidate: c.get(file)!.id, main: m.get(file)!.id, seed: s.get(file)!.id };
  for (const file of [...s.keys()].sort()) {
    if (Object.hasOwn(files, file)) continue;
    const parents = [c.get(file), m.get(file), s.get(file)];
    if (parents.some((entry) => entry?.mode !== "100644" || entry.type !== "blob")) continue;
    const [cb, mb, sb] = parents.map((entry) => entry!.id) as [string, string, string];
    if (cb === mb || sb === cb || sb === mb) continue;
    let text = true;
    for (const id of [cb, mb, sb])
      if ((await git(["cat-file", "blob", id])).includes("\0")) text = false;
    if (!text) continue;
    u.push(file);
    blobs[file] = { candidate: cb, main: mb, seed: sb };
  }
  return { candidate, main, seed, k, u, blobs };
}

// Text outside Git's actual conflict blocks is immutable. Semantics inside each block
// still need the independent delta review; a path allowlist alone is insufficient.
export function withinConflictHunks(before: string, after: string): boolean {
  if (markers.test(after)) return false;
  const fixed = before.split(hunks);
  if (fixed.length < 2) return false;
  const prefix = fixed[0]!;
  const suffix = fixed.at(-1)!;
  if (!after.startsWith(prefix) || !after.endsWith(suffix)) return false;
  const end = after.length - suffix.length;
  let cursor = prefix.length;
  if (cursor > end) return false;
  // Reserve the anchored suffix so no interior match can reuse its bytes.
  // Earliest literal matches leave maximal room for later segments; the cursor
  // only advances, scanning at most this window once, without placement retries.
  const window = after.slice(0, end);
  for (const segment of fixed.slice(1, -1)) {
    const start = window.indexOf(segment, cursor);
    if (start < 0) return false;
    cursor = start + segment.length;
  }
  return true;
}

export async function resolveConflict(
  config: Config,
  native: Adapter,
  pilot: string,
  main: string,
  previousHead: string,
  conflict: Conflict,
  save: () => Promise<void>,
  ruledPreservation?: { path: string; semantics: string }[],
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
  // ISS-167: a ruled fence bounds which captured files may be resolved. Checked before
  // any seed or launch, so an outside-path conflict stops with its evidence saved.
  for (const file of Object.keys(conflict.files))
    if (config.correctionPaths && !config.correctionPaths.includes(file))
      throw new QueueBlocked("conflict-resolution-scope-escape", file);
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
  // A pinned worker configuration (including a launch interrupted before its receipt)
  // retains the old contract. Never backfill authority into that lifecycle.
  if (!conflict.census && !(await readOptional(resolve(config.stateDirectory, "config.json")))) {
    conflict.census = await census(git, previousHead, main, conflict.seed, conflict.files);
    await save();
  }
  if (ruledPreservation && !(await readOptional(resolve(config.stateDirectory, "config.json")))) {
    // Setup checks out S with autocrlf disabled; the original native capture may
    // contain CRLF. Restore that representation before pinning the first worker,
    // never on an in-flight author's replay. Its fixed bytes are the K contract.
    for (const [file, contents] of Object.entries(conflict.files)) {
      if (contents.includes("\0") || !withinConflictHunks(contents, contents.replace(hunks, "")))
        throw new QueueBlocked("conflict-resolution-unsupported", file);
      await writeFile(resolve(config.worktree, file), contents);
    }
    await git(["--literal-pathspecs", "add", "--", ...Object.keys(conflict.files)]);
  }
  if (ruledPreservation?.some((rule) => !conflict.census?.u.includes(rule.path)))
    throw new QueueBlocked("conflict-resolution-scope-escape");
  const preservation = ruledPreservation
    ? ruledPreservation.map((rule) => rule.path)
    : config.correctionPaths
      ? []
      : (conflict.census?.u ?? []);
  const authorRule = preservation.length
    ? "Resolve only Git's marked conflicting hunks in K; all outside-hunk bytes and line endings in K are immutable. U permits only necessary preservation edits retaining both parents' intent, not redesign or unrelated fixes. U membership is not a defect or a repair obligation; U may remain unchanged. Changed U files must remain regular text without NUL or conflict markers. Do not add, delete or rename files, change modes, or edit outside K union U. If preservation needs broader changes, return FAIL. This is the single bounded conflict resolution, not a fresh implementation."
    : "Resolve only Git's marked conflicting hunks. Preserve both reviewed feature behavior and current-main changes. Do not modify text outside those hunks, add files, redesign the feature or fix unrelated defects. If preservation needs broader changes, return FAIL. This is the single bounded conflict resolution, not a fresh implementation.";
  const reviewRule =
    "This is an independent DELTA review of conflict resolution. Check the resolved hunks and direct callers against both parents. Reject semantic scope expansion, dropped feature or current-main behavior, and missing execution evidence. Inherit the retained source review; do not restart a full source sweep or infer patch equivalence.";
  const context = conflict.census
    ? ` Seed-bound conflict census: ${JSON.stringify(conflict.census)}. ${ruledPreservation ? `Only these fresh ruled U preservation semantics grant permission: ${JSON.stringify(ruledPreservation)}. Review each changed U file and direct callers; semantic expansion is FAIL.` : config.correctionPaths ? "The ruled path fence remains hunk-only: U is evidence, never edit authority, even when named in the fence." : "Check every changed U file and its direct callers for preservation of both parents, not semantic expansion. Census membership, old PASS and a clean merge are not acceptance."}`
    : "";
  const bounded: Config = {
    ...config,
    base: conflict.seed,
    mainBase: main,
    author: { ...config.author, prompt: `${authorRule} ${config.author.prompt}${context}` },
    reviewer: { ...config.reviewer, prompt: `${reviewRule} ${config.reviewer.prompt}${context}` },
  };
  const validate = async () => {
    const changed = paths(await git(["diff", "--name-only", "--no-renames", "-z", conflict.seed!]));
    if (
      (await git(["ls-files", "--others", "--exclude-standard", "-z"])) ||
      (await git(["diff", "--summary", "--no-renames", conflict.seed!])) ||
      changed.some((file) => !Object.hasOwn(conflict.files!, file) && !preservation.includes(file))
    )
      throw new QueueBlocked("conflict-resolution-scope-escape");
    for (const [file, before] of Object.entries(conflict.files!)) {
      const after = await readFile(resolve(config.worktree, file), "utf8");
      if (after.includes("\0") || !withinConflictHunks(before, after))
        throw new QueueBlocked("conflict-resolution-scope-escape", file);
    }
    for (const file of changed.filter((file) => preservation.includes(file))) {
      const path = resolve(config.worktree, file);
      if (!(await lstat(path)).isFile())
        throw new QueueBlocked("conflict-resolution-scope-escape", file);
      const after = await readFile(path, "utf8");
      if (after.includes("\0") || markers.test(after))
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
      throw new QueueBlocked("conflict-resolution-failed", error.diagnostics, error.retries);
    throw error;
  }
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, readOptional, reviewRefresh } from "./flow.ts";
import type { Adapter, Config } from "./flow.js";
import type { DeliveryConfig, SourceEvidence } from "./delivery.js";
import { parseReview } from "./repair-policy.mjs";

type Git = (args: string[]) => Promise<string>;

export async function currentMain(git: Git): Promise<string> {
  try {
    const ref = "refs/remotes/origin/main";
    await git(["fetch", "--no-tags", "origin", `refs/heads/main:${ref}`]);
    const head = await git(["rev-parse", "--verify", `${ref}^{commit}`]);
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("missing main");
    return head;
  } catch {
    throw new QueueBlocked("current-main-unavailable");
  }
}

export async function rebaseOnto(git: Git, main: string) {
  try {
    await git(["rebase", main]);
    return await git(["rev-parse", "HEAD"]);
  } catch {
    try {
      await git(["rebase", "--abort"]);
    } catch {}
    // Shared with corrective continuation; ISS-147 can route this one native stop.
    throw new QueueBlocked("rebase-conflict");
  }
}

async function save(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  await writeFile(`${path}.next`, JSON.stringify(value, null, 2) + "\n", { flush: true });
  await rename(`${path}.next`, path);
}

interface Refresh {
  main: string;
  previousHead: string;
  previousReview: string;
  directory: string;
  flowRetried: boolean;
  retries: number;
  head?: string;
}

// ISS-148: one saved integration at a time. Prior source and delivery records remain evidence.
export async function refreshDelivery(
  delivery: DeliveryConfig,
  source: Config,
  evidence: SourceEvidence,
  native: Adapter,
  pilot: string,
  sourceRetries: number,
): Promise<
  | { status: "observing-reviewer" }
  | { status: "ready"; config: DeliveryConfig; evidence: SourceEvidence; flowRetried: boolean }
> {
  const origin = delivery.stateDirectory;
  const git = (args: string[]) => native.git(delivery.worktree, args);
  let active: Refresh | undefined = await readOptional(resolve(origin, "native-refresh.json"));
  let directory = active?.directory ?? origin;
  // Published delivery is already past its gates; do not rewrite an in-flight publication.
  const published = await readOptional(resolve(directory, "publication.json"));
  const publishing = await readOptional(resolve(directory, "publication-intent.json"));
  const complete = await readOptional(resolve(directory, "cleanup.json"));
  if (!published && !publishing && !complete) {
    const main = await currentMain(git);
    // Finish an in-flight review before admitting another main movement.
    const reviewed = active && (await readOptional(resolve(directory, "reviewer-terminal.json")));
    const reviewer = active && (await readOptional(resolve(directory, "reviewer-attempt.json")));
    if (active && reviewer?.retries && !active.flowRetried) {
      active.flowRetried = true;
      if (!sourceRetries) active.retries++;
      await save(origin, "native-refresh", active);
    }
    if (!active || (reviewed?.status === "passed" && main !== active.main)) {
      const previousHead = active?.head ?? delivery.candidateHead;
      let ancestor;
      try {
        ancestor = await git(["merge-base", main, previousHead]);
        if (
          (await git(["merge-base", source.mainBase ?? source.base, main])) !==
          (source.mainBase ?? source.base)
        )
          throw new Error("incompatible main");
      } catch {
        throw new QueueBlocked("current-main-incompatible");
      }
      if (ancestor !== main) {
        active = {
          main,
          previousHead,
          previousReview: reviewed?.id ?? evidence.reviewId,
          directory: resolve(origin, `refresh-${main}`),
          flowRetried: active?.flowRetried ?? false,
          retries: Math.max(delivery.retries, active?.retries ?? 0),
        };
        directory = active.directory;
        await mkdir(directory, { recursive: true });
        await save(origin, "native-refresh", active);
      }
    }
  }
  if (!active)
    return {
      status: "ready",
      config: delivery,
      evidence: { ...evidence, head: delivery.candidateHead },
      flowRetried: false,
    };

  if (!active.head) {
    if ((await git(["status", "--porcelain"])) !== "")
      throw new QueueBlocked("candidate-workspace-drift");
    const head = await git(["rev-parse", "HEAD"]);
    // A completed rebase can lose its response. Its new main ancestor reconciles it.
    if (
      head !== active.previousHead &&
      (await git(["merge-base", active.main, head])) !== active.main
    )
      throw new QueueBlocked("candidate-workspace-drift");
    active.head = head === active.previousHead ? await rebaseOnto(git, active.main) : head;
    await save(origin, "native-refresh", active);
  }
  const head = active.head;
  const refreshed: DeliveryConfig = { ...delivery, stateDirectory: directory, candidateHead: head };
  if (!published && !publishing && !complete) {
    const config: Config = {
      ...source,
      base: active.main,
      mainBase: active.main,
      stateDirectory: directory,
      reviewer: {
        ...source.reviewer,
        prompt: `${source.reviewer.prompt}\nThis is an independent DELTA review of native current-main integration from ${active.previousHead} onto ${active.main}, producing ${head}. Inherit source review ${active.previousReview} and original records at ${origin}. Inspect the old and new implementation diffs, changed semantic hunks and their direct callers, and execution evidence. A clean rebase does not establish semantic equivalence. Preserve every acceptance criterion; missing evidence remains a finding. Do not restart a full source sweep.`,
      },
    };
    let result;
    try {
      result = await reviewRefresh(config, native, pilot, origin);
    } catch (error) {
      if (error instanceof QueueBlocked && error.reason === "reviewer-failed")
        throw new QueueBlocked("refresh-review-failed", error.diagnostics);
      throw error;
    }
    if (result.status === "observing-reviewer") return { status: "observing-reviewer" };
    if (result.retries && !active.flowRetried) {
      active.flowRetried = true;
      if (!sourceRetries) active.retries++;
      await save(origin, "native-refresh", active);
    }
    // Fetch again: a moving or unavailable main must not let stale gates start.
    if ((await currentMain(git)) !== active.main) throw new QueueBlocked("current-main-moved");
  }
  const terminal = JSON.parse(await readFile(resolve(directory, "reviewer-terminal.json"), "utf8"));
  if (parseReview(terminal.summary, delivery.run, head).verdict !== "PASS")
    throw new QueueBlocked("refresh-review-failed");
  return {
    status: "ready",
    config: { ...refreshed, retries: Math.max(delivery.retries, active.retries) },
    evidence: { ...evidence, head, reviewId: terminal.id, stateDirectory: directory },
    flowRetried: active.flowRetried,
  };
}

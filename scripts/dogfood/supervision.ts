import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import * as queue from "./queue.ts";
import type { RepositoryAdapter } from "./repository-adapter.js";
import { resolveRouting } from "./routing.mjs";
// @ts-expect-error Node 24 executes this private TypeScript module directly.
import { GithubCommandFailure } from "./github-command-failure.ts";

const {
  continuationSlug,
  QueueBlocked,
  readQueueHistory,
  retainedPostMergeDelivery,
  retainedSourceFailure,
  prerequisiteSourceFailure,
  validateHistory,
  validateLoopExecutor,
} = queue;

type ActionableStopReason = import("./queue.js").ActionableStopReason;
type LoopConfig = import("./queue.js").LoopConfig;
type QueueParticipant = import("./queue.js").QueueParticipant;

const exec = promisify(execFile);
const ABSENT = Symbol("absent");
const SHA = /^[a-f0-9]{40}$/;

export interface SelectedIssue {
  cycle: number;
  key: string;
  number: number;
  base: string;
  planningRevision?: string;
  routing?: import("./routing.mjs").RoutingSelection;
}

export interface SupervisedCycle {
  selection: SelectedIssue;
  initialHistory: QueueParticipant[];
  prerequisite?: {
    declaration: import("./queue.js").Prerequisite;
    blocked: SelectedIssue;
    executor: string;
  };
}

export interface IssueObservation {
  state: "OPEN" | "CLOSED";
  key: string | undefined;
  labels: string[];
  comments: string[];
}

export interface SupervisionAdapter {
  prerequisiteOwners?(
    config: LoopConfig,
    blocked: SelectedIssue,
  ): Promise<"absent" | "live" | "unknown">;
  currentMain(config: LoopConfig, executingRoot: string): Promise<string>;
  issue(config: LoopConfig, number: number, purpose?: "learning-note"): Promise<IssueObservation>;
  removeReady(config: LoopConfig, number: number): Promise<void>;
  close(config: LoopConfig, number: number): Promise<void>;
  comment(config: LoopConfig, number: number, body: string): Promise<void>;
}

export function isItemStopReason(reason: string) {
  return (
    [
      "author-failed",
      "author-malformed",
      "operator-evidence-failed",
      "continuation-failed",
      "continuation-repair-not-authorized",
      "implementation-attempt-ceiling-exhausted",
      "reviewer-malformed",
      "exit-receipt-timeout",
      "launcher-failed",
      "rebase-conflict",
      "refresh-review-failed",
      "gate-correction-failed",
      "gate-correction-review-failed",
      "gate-correction-not-authorized",
      "conflict-resolution-failed",
      "conflict-resolution-exhausted",
      "conflict-resolution-scope-escape",
      "conflict-resolution-unsupported",
      "deploy-not-verified",
      "source-finding-location-outside-candidate",
    ].includes(reason) ||
    reason.startsWith("gate-retry-exhausted:") ||
    reason.startsWith("gate-correction-exhausted:") ||
    reason.startsWith("hosted-check-failed:") ||
    reason.startsWith("hosted-check-log-unavailable:")
  );
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validSelection(value: unknown, cycle: number): value is SelectedIssue {
  return (
    exactKeys(value, [
      "cycle",
      "key",
      "number",
      "base",
      ...(value && typeof value === "object" && Object.hasOwn(value, "planningRevision")
        ? ["planningRevision"]
        : []),
      ...(value && typeof value === "object" && Object.hasOwn(value, "routing") ? ["routing"] : []),
    ]) &&
    value.cycle === cycle &&
    /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value.key) &&
    Number.isSafeInteger(value.number) &&
    value.number > 0 &&
    SHA.test(value.base) &&
    (!Object.hasOwn(value, "planningRevision") || value.planningRevision === value.base)
  );
}

async function optionalRecord(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new QueueBlocked(`malformed-supervision-record:${name}`);
  }
}

async function record(directory: string, name: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(resolve(directory, `${name}.json`), bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(resolve(directory, `${name}.json`), "utf8")) !== bytes)
      throw new QueueBlocked(`conflicting-supervision-record:${name}`);
  }
}

async function completedItemStop(directory: string, cycle: number, selection: SelectedIssue) {
  for (let stop = 1; ; stop += 1) {
    const intent = await optionalRecord(directory, `cycle-${cycle}-stop-${stop}`);
    if (intent === ABSENT) return undefined;
    const completed = await optionalRecord(directory, `cycle-${cycle}-stop-${stop}-complete`);
    if (completed === ABSENT) return undefined;
    if (
      typeof intent?.reason !== "string" ||
      !exactKeys(completed, ["selection", "stop", "history"]) ||
      JSON.stringify(completed.selection) !== JSON.stringify(selection) ||
      completed.stop !== stop ||
      !Array.isArray(completed.history)
    )
      throw new QueueBlocked(`malformed-supervision-record:cycle-${cycle}-stop-${stop}-complete`);
    // Old author-failed completions were run notes, not parking receipts.
    if (intent.reason !== "author-failed" && isItemStopReason(intent.reason))
      return completed.history as QueueParticipant[];
  }
}

function stateDirectory(config: LoopConfig) {
  return resolve(config.stateRoot, config.run);
}

function supervisionDirectory(config: LoopConfig, cycle: SupervisedCycle) {
  return cycle.prerequisite
    ? resolve(stateDirectory(config), "prerequisite")
    : stateDirectory(config);
}

// ISS-187: observation only. The executor is Linux; an unavailable census or
// a still-existing worker with uncertain identity defers admission, never reclaims it.
export async function prerequisiteOwners(
  config: LoopConfig,
  blocked: SelectedIssue,
): Promise<"absent" | "live" | "unknown"> {
  try {
    if (process.platform !== "linux") return "unknown";
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
      let argv: string[];
      try {
        argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        return "unknown";
      }
      const entry = argv.findIndex((arg) => /(?:^|\/)supervise\.mjs$/.test(arg));
      if (entry < 0) continue;
      try {
        if ((await readlink(`/proc/${pid}/exe`)) !== process.execPath) continue;
        const cwd = await readlink(`/proc/${pid}/cwd`);
        const other = JSON.parse(await readFile(resolve(cwd, argv[entry + 1]!), "utf8"));
        if (other.run === config.run && resolve(other.stateRoot) === resolve(config.stateRoot))
          return "live";
      } catch {
        return "unknown";
      }
    }
    const observeWorkers = async (directory: string): Promise<"absent" | "live" | "unknown"> => {
      let rows;
      try {
        rows = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
        return "unknown";
      }
      for (const row of rows) {
        if (row.isDirectory()) {
          const state = await observeWorkers(resolve(directory, row.name));
          if (state !== "absent") return state;
        } else if (
          /^(author|reviewer)-intent\.json$/.test(row.name) &&
          (await optionalRecord(directory, row.name.replace("-intent.json", "-attempt"))) === ABSENT
        ) {
          return "unknown";
        } else if (
          /^(author|reviewer)-attempt\.json$/.test(row.name) ||
          /-process\.json$/.test(row.name)
        ) {
          const worker = JSON.parse(await readFile(resolve(directory, row.name), "utf8"));
          if (!Number.isSafeInteger(worker.pid) || worker.pid <= 0) return "unknown";
          try {
            const argv = (await readFile(`/proc/${worker.pid}/cmdline`, "utf8")).split("\0");
            const cwd = await readlink(`/proc/${worker.pid}/cwd`);
            const pinned = await optionalRecord(directory, "config");
            if (
              pinned !== ABSENT &&
              [pinned.config?.worktree, pinned.config?.reviewWorktree].includes(cwd) &&
              argv.some((arg) => arg === config.codexExecutable)
            )
              return "live";
            return "unknown";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
          }
        }
      }
      return "absent";
    };
    for (let number = 1; number <= config.attemptCeiling; number++) {
      const state = await observeWorkers(
        resolve(stateDirectory(config), `${blocked.key.toLowerCase()}-attempt-${number}`),
      );
      if (state !== "absent") return state;
    }
    return "absent";
  } catch {
    return "unknown";
  }
}

async function admitPrerequisite(
  config: LoopConfig,
  selected: SelectedIssue,
  initialHistory: QueueParticipant[],
  adapter: SupervisionAdapter,
  repository: RepositoryAdapter,
  validateExecutor: () => Promise<unknown>,
): Promise<SupervisedCycle> {
  const declaration = config.prerequisite!;
  const refuse = () => {
    throw new QueueBlocked("prerequisite-not-admitted");
  };
  if (
    declaration.blockedCycle !== selected.cycle ||
    declaration.blockedKey !== selected.key ||
    declaration.blockedNumber !== selected.number
  )
    refuse();
  const directory = stateDirectory(config);
  const intent = await optionalRecord(
    directory,
    `cycle-${selected.cycle}-stop-${declaration.stop}`,
  );
  const completed = await optionalRecord(
    directory,
    `cycle-${selected.cycle}-stop-${declaration.stop}-complete`,
  );
  if (
    intent === ABSENT ||
    completed === ABSENT ||
    isItemStopReason(intent.reason) ||
    JSON.stringify(intent.selection) !== JSON.stringify(selected) ||
    JSON.stringify(completed.selection) !== JSON.stringify(selected) ||
    completed.stop !== declaration.stop ||
    (await optionalRecord(directory, `cycle-${selected.cycle}-stop-${declaration.stop + 1}`)) !==
      ABSENT
  )
    refuse();
  const observed = await adapter.issue(config, selected.number);
  assertIssue(selected, observed);
  if (observed.state !== "OPEN" || observed.key !== selected.key) refuse();
  const owners = await (adapter.prerequisiteOwners ?? prerequisiteOwners)(config, selected);
  if (owners !== "absent") throw new QueueBlocked(`prerequisite-owner-${owners}`);
  const prior = await prerequisiteSourceFailure(config, {
    key: declaration.key,
    number: declaration.number,
    base: selected.base,
  });
  if (!prior) refuse();
  await validateExecutor();
  const base = await adapter.currentMain(config, config.stableExecutorRoot);
  if (!SHA.test(base)) throw new QueueBlocked("current-main-unavailable");
  const context = {
    repository: config.repository,
    executorRoot: config.stableExecutorRoot,
    planningRevision: base,
    gitExecutable: config.gitExecutable,
  };
  const candidates = await repository.selectCandidates(context);
  const candidate = candidates.find(
    (row) => row.key === declaration.key && row.number === declaration.number,
  );
  if (!candidate) refuse();
  const ready = await adapter.issue(config, declaration.number);
  assertIssue(declaration, ready);
  if (ready.state !== "OPEN" || ready.key !== declaration.key || !ready.labels.includes("ready"))
    refuse();
  const brief = await repository.issueContext({
    ...context,
    key: declaration.key,
    number: declaration.number,
  });
  const routing = resolveRouting(config.adapter, brief.routing, config.routingRows);
  const author = routing?.author[0] ?? config.author;
  const reviewer = routing?.reviewer[0] ?? config.reviewer;
  if (!author || !reviewer) throw new QueueBlocked("routing-row-unconfigured");
  if (author.model === reviewer.model) throw new QueueBlocked("routing-reviewer-not-independent");
  const executor = (
    await exec(config.gitExecutable, ["-C", config.stableExecutorRoot, "rev-parse", "HEAD"])
  ).stdout.trim();
  return {
    selection: { cycle: selected.cycle, ...candidate!, base, planningRevision: base },
    initialHistory,
    prerequisite: { declaration, blocked: selected, executor },
  };
}

export async function nextCycle(
  config: LoopConfig,
  executingRoot: string,
  adapter: SupervisionAdapter,
  repositoryAdapter: RepositoryAdapter,
  validateExecutor: () => Promise<unknown> = () => validateLoopExecutor(config, executingRoot),
): Promise<SupervisedCycle | undefined> {
  const directory = stateDirectory(config);
  const detourDirectory = resolve(directory, "prerequisite");
  const detour = (await optionalRecord(detourDirectory, "admission")) as
    SupervisedCycle | typeof ABSENT;
  let releasedHistory: QueueParticipant[] | undefined;
  if (detour !== ABSENT) {
    const completed = await optionalRecord(
      detourDirectory,
      `cycle-${detour.selection.cycle}-complete`,
    );
    if (completed === ABSENT) {
      if (JSON.stringify(config.prerequisite) !== JSON.stringify(detour.prerequisite!.declaration))
        throw new QueueBlocked("prerequisite-held");
      await validateExecutor();
      const head = (
        await exec(config.gitExecutable, ["-C", config.stableExecutorRoot, "rev-parse", "HEAD"])
      ).stdout.trim();
      if (head !== detour.prerequisite!.executor)
        throw new QueueBlocked("prerequisite-executor-moved");
      const failed = await retainedSourceFailure(config, detour.selection);
      if (failed && failed.attempts > 1) {
        // Observe terminal author FAIL before composition can project it into
        // another source attempt. Reuse its existing stop ordinal on restart.
        await reconcilePendingStop(config, detour, adapter, repositoryAdapter);
        let retainedStop: number | undefined;
        for (let stop = 1; ; stop++) {
          const intent = await optionalRecord(
            detourDirectory,
            `cycle-${detour.selection.cycle}-stop-${stop}`,
          );
          if (intent === ABSENT) break;
          if (intent.reason === "author-failed") {
            retainedStop = stop;
            break;
          }
        }
        await stopCycle(
          config,
          { ...detour, initialHistory: failed.history },
          "author-failed",
          failed.attempts,
          adapter,
          repositoryAdapter,
          failed.diagnostics,
          retainedStop,
        );
        throw new QueueBlocked("prerequisite-held");
      }
      const stoppedHistory = await completedItemStop(
        detourDirectory,
        detour.selection.cycle,
        detour.selection,
      );
      const observed = await adapter.issue(config, detour.selection.number);
      assertIssue(detour.selection, observed);
      if (stoppedHistory || observed.state === "CLOSED") {
        let history = stoppedHistory ?? detour.initialHistory;
        if (!stoppedHistory)
          for (let attempt = 2; attempt <= config.attemptCeiling; attempt++) {
            const current = await readQueueHistory({
              stateDirectory: resolve(
                directory,
                `${detour.selection.key.toLowerCase()}-attempt-${attempt}`,
              ),
              nativeLaunchCeiling: config.nativeLaunchCeiling,
              initialHistory: [],
            });
            if (current.length > history.length) history = current;
          }
        await record(detourDirectory, `cycle-${detour.selection.cycle}-complete`, {
          selection: detour.selection,
          history,
        });
        throw new QueueBlocked("prerequisite-held");
      }
      if (observed.state !== "OPEN") throw new QueueBlocked("issue-observation-unavailable");
      return detour;
    }
    const grant = config.blockedCycleResume;
    if (
      !grant ||
      grant.cycle !== detour.prerequisite!.blocked.cycle ||
      grant.authorityUrl === detour.prerequisite!.declaration.authorityUrl
    )
      throw new QueueBlocked("prerequisite-held");
    releasedHistory = completed.history;
  } else if (config.blockedCycleResume) throw new QueueBlocked("prerequisite-not-admitted");
  let cycle = 1;
  let declaration = config.prerequisite;
  let initialHistory: QueueParticipant[] = [];
  for (;;) {
    const selected = await optionalRecord(directory, `cycle-${cycle}-selected`);
    const completed = await optionalRecord(directory, `cycle-${cycle}-complete`);
    if (completed !== ABSENT) {
      if (
        selected === ABSENT ||
        !validSelection(selected, cycle) ||
        !exactKeys(completed, ["selection", "history"]) ||
        JSON.stringify(completed.selection) !== JSON.stringify(selected) ||
        !Array.isArray(completed.history)
      )
        throw new QueueBlocked(`malformed-supervision-record:cycle-${cycle}-complete`);
      validateHistory(completed.history, config.nativeLaunchCeiling);
      if (
        declaration?.blockedCycle === cycle &&
        ((await completedItemStop(directory, cycle, selected)) ||
          (await retainedSourceFailure(config, selected)))
      )
        declaration = undefined;
      initialHistory = completed.history;
      cycle += 1;
      continue;
    }
    if (selected !== ABSENT) {
      if (!validSelection(selected, cycle))
        throw new QueueBlocked(`malformed-supervision-record:cycle-${cycle}-selected`);
      if (releasedHistory && cycle === detourPrerequisiteCycle(detour))
        initialHistory = releasedHistory;
      const ordinaryFailure = declaration && (await retainedSourceFailure(config, selected));
      if (ordinaryFailure) declaration = undefined;
      if (declaration && !(await completedItemStop(directory, cycle, selected)))
        return admitPrerequisite(
          config,
          selected,
          initialHistory,
          adapter,
          repositoryAdapter,
          validateExecutor,
        );
      try {
        await validateExecutor();
      } catch (error) {
        // ISS-161: the caller has no active cycle until nextCycle returns. Report
        // executor rejection here, without reconciling any pending work stop.
        let stop = 1;
        while ((await optionalRecord(directory, `cycle-${cycle}-stop-${stop}`)) !== ABSENT)
          stop += 1;
        await stopCycle(
          config,
          { selection: selected, initialHistory },
          error instanceof QueueBlocked ? error.reason : "queue-internal-error",
          0,
          adapter,
          repositoryAdapter,
          error instanceof QueueBlocked ? error.diagnostics : undefined,
          stop,
        );
        throw error;
      }
      const stoppedHistory = await completedItemStop(directory, cycle, selected);
      if (stoppedHistory) {
        declaration = undefined;
        validateHistory(stoppedHistory, config.nativeLaunchCeiling);
        initialHistory = stoppedHistory;
        cycle += 1;
        continue;
      }
      // ISS-144: external closure supersedes workspace recovery and pending stops.
      const observed = await adapter.issue(config, selected.number);
      assertIssue(selected, observed);
      // Native merge/cleanup is not external closure: its repository hook may
      // still be pending, even when both worker worktrees have been removed.
      if (await retainedPostMergeDelivery(config, selected))
        return { selection: selected, initialHistory };
      if (observed.state === "CLOSED") {
        const slugs = Array.from(
          { length: config.attemptCeiling },
          (_, index) => `${selected.key.toLowerCase()}-attempt-${index + 1}`,
        );
        if (config.acceptedReplan && selected.key === config.acceptedReplan.issueKey) {
          const prior = await optionalRecord(
            config.acceptedReplan.priorAttemptDirectory,
            "attempt",
          );
          if (prior !== ABSENT) {
            validateHistory(prior.history, config.nativeLaunchCeiling);
            if (prior.history.length > initialHistory.length) initialHistory = prior.history;
          }
          slugs.push(continuationSlug(config.acceptedReplan));
        }
        // ISS-167: the integration's launches live beneath its retained attempt.
        if (config.integrationContinuation?.issueKey === selected.key)
          slugs.push(`${basename(config.integrationContinuation.attemptDirectory)}/integration`);
        // A removed grant cannot refund launches when external closure supersedes
        // admission. Discover the new lifecycle from its existing reservation only.
        for (const slug of [...slugs]) {
          const integration = `${slug}/integration`;
          if (
            (await optionalRecord(resolve(directory, integration), "spent-resolution")) !== ABSENT
          )
            slugs.push(integration, `${integration}/spent-resolution`);
        }
        for (const slug of slugs) {
          const history = await readQueueHistory({
            stateDirectory: resolve(directory, slug),
            nativeLaunchCeiling: config.nativeLaunchCeiling,
            initialHistory,
          });
          if (history.length >= initialHistory.length) initialHistory = history;
        }
        await record(directory, `cycle-${cycle}-complete`, {
          selection: selected,
          history: initialHistory,
        });
        cycle += 1;
        continue;
      }
      if (observed.state !== "OPEN") throw new QueueBlocked("issue-observation-unavailable");
      const failed = await retainedSourceFailure(config, selected);
      if (failed) {
        const current = { selection: selected, initialHistory: failed.history };
        let authorStop: number | undefined;
        // Finish pending notes, including an upgrade's later pilot stop. Replay the
        // original author marker even if its old run-scoped completion exists.
        for (let stop = 1; ; stop++) {
          const intent = await optionalRecord(directory, `cycle-${cycle}-stop-${stop}`);
          if (intent === ABSENT) break;
          if (intent.reason === "author-failed") {
            authorStop ??= stop;
            continue;
          }
          if ((await optionalRecord(directory, `cycle-${cycle}-stop-${stop}-complete`)) === ABSENT)
            await stopCycle(
              config,
              current,
              intent.reason,
              intent.attempts,
              adapter,
              repositoryAdapter,
              undefined,
              stop,
            );
        }
        await stopCycle(
          config,
          current,
          "author-failed",
          failed.attempts,
          adapter,
          repositoryAdapter,
          failed.diagnostics,
          authorStop,
        );
        initialHistory = failed.history;
        cycle += 1;
        continue;
      }
      return { selection: selected, initialHistory };
    }

    if (declaration) throw new QueueBlocked("prerequisite-not-admitted");
    const readMain = async () => {
      try {
        const main = await adapter.currentMain(config, config.stableExecutorRoot);
        if (!SHA.test(main)) throw new Error(`Invalid current main revision: ${String(main)}`);
        return main;
      } catch (error) {
        throw new QueueBlocked(
          "current-main-unavailable",
          error instanceof QueueBlocked ? (error.diagnostics ?? error.message) : String(error),
        );
      }
    };
    const planningRevision = config.adapter === "self" ? await readMain() : undefined;
    const candidates = await repositoryAdapter.selectCandidates({
      repository: config.repository,
      executorRoot: config.stableExecutorRoot,
      ...(planningRevision === undefined
        ? {}
        : { planningRevision, gitExecutable: config.gitExecutable }),
      ...(config.targetMilestone === undefined ? {} : { targetMilestone: config.targetMilestone }),
      ...(config.opsAdmission === undefined ? {} : { opsAdmission: config.opsAdmission }),
    });
    if (!Array.isArray(candidates)) throw new QueueBlocked("malformed-repository-candidates");
    const issue = candidates[0];
    if (!issue) return undefined;
    if (
      !exactKeys(issue, [
        "key",
        "number",
        ...(Object.hasOwn(issue, "routing") ? ["routing"] : []),
      ]) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(issue.key) ||
      !Number.isSafeInteger(issue.number) ||
      issue.number <= 0
    )
      throw new QueueBlocked("malformed-repository-candidates");
    let base;
    try {
      base = planningRevision ?? (await readMain());
    } catch (error) {
      const target = { cycle, ...issue };
      await postLearningNote(
        config,
        target,
        stopMessage(config, target, 0, "current-main-unavailable", 0),
        adapter,
      );
      throw error;
    }
    return {
      selection: {
        cycle,
        ...issue,
        base,
        ...(planningRevision === undefined ? {} : { planningRevision }),
      },
      initialHistory,
    };
  }
}

function detourPrerequisiteCycle(detour: SupervisedCycle | typeof ABSENT) {
  return detour === ABSENT ? undefined : detour.prerequisite!.blocked.cycle;
}

function assertIssue(selection: Pick<SelectedIssue, "key">, observed: IssueObservation) {
  if (observed.key !== undefined && observed.key !== selection.key)
    throw new QueueBlocked("selected-issue-identity-drift");
}

export async function persistCycle(config: LoopConfig, cycle: SupervisedCycle) {
  const directory = supervisionDirectory(config, cycle);
  await mkdir(directory, { recursive: true });
  if (cycle.prerequisite) await record(directory, "admission", cycle);
  await record(directory, `cycle-${cycle.selection.cycle}-selected`, cycle.selection);
}

export async function startCycle(
  config: LoopConfig,
  cycle: SupervisedCycle,
  adapter: SupervisionAdapter,
) {
  const observed = await adapter.issue(config, cycle.selection.number);
  assertIssue(cycle.selection, observed);
  if (observed.state === "CLOSED") return { status: "closed" as const };
  if (observed.labels.includes("ready")) {
    await adapter.removeReady(config, cycle.selection.number);
    const updated = await adapter.issue(config, cycle.selection.number);
    assertIssue(cycle.selection, updated);
    if (updated.state !== "OPEN" || updated.labels.includes("ready"))
      throw new QueueBlocked("working-label-state-unknown");
  }
  return { status: "working" as const };
}

export async function completeCycle(
  config: LoopConfig,
  cycle: SupervisedCycle,
  history: QueueParticipant[],
  adapter: SupervisionAdapter,
) {
  validateHistory(history, config.nativeLaunchCeiling);
  let observed = await adapter.issue(config, cycle.selection.number);
  assertIssue(cycle.selection, observed);
  if (observed.state === "OPEN") {
    await adapter.close(config, cycle.selection.number);
    observed = await adapter.issue(config, cycle.selection.number);
    assertIssue(cycle.selection, observed);
  }
  if (observed.state !== "CLOSED") throw new QueueBlocked("completed-issue-state-unknown");
  await record(supervisionDirectory(config, cycle), `cycle-${cycle.selection.cycle}-complete`, {
    selection: cycle.selection,
    history,
  });
}

type RecoveryContext = {
  runState: string;
  evidence: string;
  issue: number;
  cycle: number;
};

type RecoveryAction = (context: RecoveryContext) => string;

const stopRecoveryActions: Record<ActionableStopReason, RecoveryAction> = {
  "author-failed": ({ evidence }) =>
    `inspect the failed source author's terminal and trace under ${evidence}, resolve the reported blocker, and explicitly restore planning readiness before selecting this issue again`,
  "completed-issue-state-unknown": ({ issue }) =>
    `check PR delivery for issue #${issue} on GitHub; if the PR merged, close the issue by hand and restart so the cycle reconciles`,
  "issue-observation-unavailable": () =>
    "restore `gh` authentication or network access and restart",
  "selected-base-unavailable": ({ runState, cycle }) =>
    `open cycle-${cycle}-selected.json under ${runState}, fetch origin or otherwise restore its pinned base commit in the executor checkout, and restart`,
  "current-main-unavailable": ({ runState }) =>
    `check the stableExecutorRoot and gitExecutable fields in the loop config used to start this run, restore access to origin/main, inspect retained state under ${runState}, and restart`,
  "gate-retry-exhausted:typecheck": ({ evidence }) =>
    `inspect ${evidence} for the typecheck gate output, fix the reported type error, and rerun typecheck`,
  "gate-retry-exhausted:format:check": ({ evidence }) =>
    `inspect ${evidence} for the format gate output, format the reported files, and rerun format:check`,
  "reviewer-malformed": ({ evidence }) =>
    `inspect ${evidence} for the reviewer terminal, correct the verdict/findings/G0 shape, and restart`,
  "author-malformed": ({ evidence }) =>
    `inspect ${evidence} for the author trace, retained partial work and parse diagnostic, correct the verdict transport, and explicitly unpark after verification`,
  "exit-receipt-timeout": ({ evidence }) =>
    `inspect ${evidence} for the worker attempt and trace, restore the missing exit receipt, and restart`,
  "provider-unavailable": () =>
    "restore the subscription pool and its authentication helper, then restart the supervisor; the issue remains ready",
  "native-launch-ceiling-exhausted": ({ evidence }) =>
    `inspect ${evidence} and the nativeLaunchCeiling field, then start an authorized run with enough launch budget`,
  "implementation-attempt-ceiling-exhausted": ({ evidence }) =>
    `inspect ${evidence} and apply the final blocking findings before unparking the issue`,
};
function stopMessage(
  config: LoopConfig,
  selection: Pick<SelectedIssue, "cycle" | "key" | "number" | "routing">,
  stop: number,
  reason: string,
  attempts: number,
  diagnostics?: string,
  markerSuffix = "",
  history: QueueParticipant[] = [],
  routing = selection.routing,
) {
  const marker = `loop-stop:${config.run}:${selection.cycle}:${stop}${markerSuffix}`;
  const runState = resolve(config.stateRoot, config.run);
  const evidence = runState;
  const context = {
    runState,
    evidence,
    issue: selection.number,
    cycle: selection.cycle,
  };
  const exact = Object.hasOwn(stopRecoveryActions, reason)
    ? stopRecoveryActions[reason as ActionableStopReason]
    : undefined;
  const change =
    reason === "operator-evidence-required" || reason === "operator-evidence-authority"
      ? `retain the current candidate and author records, supply the declared exact-head host verification bundle, and resume this same run; no reviewer or new author is authorized until the evidence is accepted`
      : config.acceptedReplan
        ? "preserve this run and the original four attempts, propose rollback, and wait for Todd; do not start another corrective cycle or restart after a new loop defect without his decision"
        : exact
          ? exact(context)
          : `inspect ${evidence} for the stop reason ${reason}, correct the reported condition, and restart`;
  const count = `after ${attempts} implementation attempt${attempts === 1 ? "" : "s"}`;
  const detail = diagnostics?.trim();
  const placements = history
    .filter(
      (participant) =>
        participant.item.toLowerCase().startsWith(`${selection.key.toLowerCase()}:`) ||
        participant.item.toLowerCase().startsWith(`${selection.key.toLowerCase()}-`),
    )
    .map(({ role, routing, placement, rung, outcome }) => ({
      row: routing?.row ?? "unrecorded",
      review: routing?.review,
      role,
      model: placement?.model ?? "unrecorded",
      effort: placement?.effort,
      rung,
      outcome,
    }));
  const routingDetail = placements.length
    ? ` Routing and exact worker launches: ${JSON.stringify(placements)}.`
    : ` Routing: ${routing ? JSON.stringify(routing) : config.adapter === "self" ? "self" : "unresolved"}; no recorded author or reviewer launches.`;
  return {
    marker,
    body: `<!-- ${marker} --> The loop stopped on ${selection.key} because \`${reason}\` ${count}. A person should ${change}.${detail ? ` Diagnostic: ${JSON.stringify(detail)}.` : ""}${routingDetail}`,
  };
}

async function postLearningNote(
  config: LoopConfig,
  selection: Pick<SelectedIssue, "key" | "number">,
  note: { marker: string; body: string },
  adapter: SupervisionAdapter,
) {
  const observe = async () => {
    const observed = await adapter.issue(config, selection.number, "learning-note");
    assertIssue(selection, observed);
    if (observed.state !== "OPEN") throw new QueueBlocked("stopped-issue-state-unknown");
    const matching = observed.comments.filter((body) => body.includes(`<!-- ${note.marker} -->`));
    if (matching.length > 1) throw new QueueBlocked("duplicate-learning-note");
    return { observed, found: matching.length === 1 };
  };
  let current = await observe();
  if (current.found) return current.observed;
  for (let post = 0; ; post++) {
    let failure: GithubCommandFailure | undefined;
    try {
      await adapter.comment(config, selection.number, note.body);
    } catch (error) {
      // Only the owning CLI boundary supplies a command outcome. Unrelated
      // adapter exceptions retain their ordinary interruption semantics.
      if (!(error instanceof GithubCommandFailure)) throw error;
      failure = error;
    }
    // Even a failed response may have posted. Probe now, never reuse pre-post
    // absence. Only a proved pre-send failure permits one additional write.
    current = await observe();
    if (current.found) return current.observed;
    if (post === 0 && failure?.preSend) continue;
    throw new QueueBlocked("learning-note-state-unknown", failure?.message);
  }
}

export async function stopCycle(
  config: LoopConfig,
  cycle: SupervisedCycle,
  reason: string,
  attempts: number,
  adapter: SupervisionAdapter,
  repositoryAdapter: RepositoryAdapter,
  diagnostics?: string,
  retainedStop?: number,
) {
  validateHistory(cycle.initialHistory, config.nativeLaunchCeiling);
  const directory = supervisionDirectory(config, cycle);
  // A setup stop can have a selected row without having launched a worker yet.
  let routing = cycle.selection.routing;
  const slugs = config.acceptedReplan
    ? [continuationSlug(config.acceptedReplan)]
    : Array.from(
        { length: config.attemptCeiling },
        (_, index) => `${cycle.selection.key.toLowerCase()}-attempt-${index + 1}`,
      );
  for (const slug of slugs) {
    const attempt = await optionalRecord(resolve(stateDirectory(config), slug), "attempt");
    if (attempt !== ABSENT && attempt.routing) routing = attempt.routing;
  }
  let stop = retainedStop ?? 1;
  let intent: any;
  for (;;) {
    const current = await optionalRecord(directory, `cycle-${cycle.selection.cycle}-stop-${stop}`);
    const completed = await optionalRecord(
      directory,
      `cycle-${cycle.selection.cycle}-stop-${stop}-complete`,
    );
    if (current === ABSENT) {
      intent = {
        selection: cycle.selection,
        stop,
        reason,
        attempts,
        history: cycle.initialHistory,
        ...stopMessage(
          config,
          cycle.selection,
          stop,
          reason,
          attempts,
          diagnostics,
          "",
          cycle.initialHistory,
          routing,
        ),
      };
      await record(directory, `cycle-${cycle.selection.cycle}-stop-${stop}`, intent);
      break;
    }
    if (completed === ABSENT || retainedStop !== undefined) {
      intent = current;
      break;
    }
    stop += 1;
  }
  if (
    !exactKeys(intent, ["selection", "stop", "reason", "attempts", "history", "marker", "body"]) ||
    JSON.stringify(intent.selection) !== JSON.stringify(cycle.selection) ||
    intent.stop !== stop ||
    typeof intent.reason !== "string" ||
    !Number.isSafeInteger(intent.attempts) ||
    !Array.isArray(intent.history) ||
    typeof intent.marker !== "string" ||
    typeof intent.body !== "string"
  )
    throw new QueueBlocked(
      `malformed-supervision-record:cycle-${cycle.selection.cycle}-stop-${stop}`,
    );
  validateHistory(intent.history, config.nativeLaunchCeiling);
  const scope =
    isItemStopReason(intent.reason) &&
    (intent.reason !== "author-failed" || (await retainedSourceFailure(config, cycle.selection)))
      ? "item"
      : "run";

  let unpark: string | undefined;
  if (scope === "item") {
    try {
      unpark = await repositoryAdapter.park({
        repository: config.repository,
        number: cycle.selection.number,
        reason: intent.reason,
      });
    } catch (error) {
      if (!(error instanceof QueueBlocked)) throw error;
      await postLearningNote(
        config,
        cycle.selection,
        stopMessage(
          config,
          cycle.selection,
          stop,
          error.reason,
          intent.attempts,
          error.diagnostics,
          ":park",
          cycle.initialHistory,
          routing,
        ),
        adapter,
      );
      throw error;
    }
  }
  await postLearningNote(
    config,
    cycle.selection,
    {
      marker: intent.marker,
      body: `${intent.body}${unpark ? ` To unpark, ${unpark}.` : ""}`,
    },
    adapter,
  );
  await record(directory, `cycle-${cycle.selection.cycle}-stop-${stop}-complete`, {
    selection: cycle.selection,
    stop,
    history: intent.history,
  });
  if (scope === "item" && (intent.reason === "author-failed" || cycle.prerequisite))
    await record(directory, `cycle-${cycle.selection.cycle}-complete`, {
      selection: cycle.selection,
      history: cycle.initialHistory,
    });
  return scope;
}

export async function reconcilePendingStop(
  config: LoopConfig,
  cycle: SupervisedCycle,
  adapter: SupervisionAdapter,
  repositoryAdapter: RepositoryAdapter,
) {
  const directory = supervisionDirectory(config, cycle);
  for (let stop = 1; ; stop += 1) {
    const intent = await optionalRecord(directory, `cycle-${cycle.selection.cycle}-stop-${stop}`);
    if (intent === ABSENT) return undefined;
    const completed = await optionalRecord(
      directory,
      `cycle-${cycle.selection.cycle}-stop-${stop}-complete`,
    );
    if (completed !== ABSENT) continue;
    const scope = await stopCycle(
      config,
      { ...cycle, initialHistory: intent.history },
      intent.reason,
      intent.attempts,
      adapter,
      repositoryAdapter,
    );
    // ISS-157: finish the old learning note, then let native delivery admit the grant.
    // Completed notes already follow that path. The saved stop itself remains untouched.
    const grant = config.gateStopAuthorization;
    if (
      scope === "run" &&
      grant &&
      !config.acceptedReplan &&
      /^gate-(host-failed|attribution-unknown):.+$/.test(intent.reason)
    ) {
      const attempt = await optionalRecord(resolve(grant.stateDirectory, ".."), "attempt");
      const stopped = await optionalRecord(grant.stateDirectory, "gate-stop");
      if (
        attempt !== ABSENT &&
        stopped !== ABSENT &&
        attempt.run === config.run &&
        attempt.phase === "delivery" &&
        attempt.stateDirectory === grant.stateDirectory &&
        attempt.issue ===
          `https://github.com/${config.repository}/issues/${cycle.selection.number}` &&
        stopped.reason === intent.reason
      )
        return undefined;
    }
    return { scope, reason: intent.reason };
  }
}

async function run(executable: string, args: string[], cwd: string) {
  return exec(executable, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function repositorySupervisionAdapter(
  commands: { run: typeof run } = { run },
  pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): SupervisionAdapter {
  const gh = async (config: LoopConfig, args: string[]) =>
    (
      await commands.run(
        "gh",
        [...args, "--repo", `github.com/${config.repository}`],
        config.stableExecutorRoot,
      )
    ).stdout.trim();
  const observe: SupervisionAdapter["issue"] = async (config, number, purpose) => {
    let raw: string;
    for (let attempt = 0; ; attempt++) {
      try {
        raw = await gh(config, [
          "issue",
          "view",
          String(number),
          "--json",
          "number,body,state,labels,comments",
        ]);
        break;
      } catch (error) {
        const failure = new GithubCommandFailure(error);
        if (purpose === "learning-note" && failure.transport && attempt < 2) {
          await pause((attempt + 1) * 1000);
          continue;
        }
        throw new QueueBlocked(
          purpose === "learning-note"
            ? "learning-note-state-unknown"
            : "issue-observation-unavailable",
          purpose === "learning-note" ? failure.message : undefined,
        );
      }
    }
    try {
      const row = JSON.parse(raw);
      if (
        row?.number !== number ||
        typeof row.body !== "string" ||
        !["OPEN", "CLOSED"].includes(row.state) ||
        !Array.isArray(row.labels) ||
        !Array.isArray(row.comments) ||
        !row.labels.every((label: any) => typeof label?.name === "string") ||
        !row.comments.every((comment: any) => typeof comment?.body === "string")
      )
        throw new Error("malformed issue");
      return {
        state: row.state,
        key: /<!--\s*planning-key:\s*([^\s]+)\s*-->/.exec(row.body)?.[1],
        labels: row.labels.map((label: any) => label?.name),
        comments: row.comments.map((comment: any) => comment?.body),
      };
    } catch {
      throw new QueueBlocked("issue-observation-unavailable");
    }
  };
  return {
    async currentMain(config, repositoryRoot) {
      try {
        const main = "refs/remotes/origin/main";
        await run(
          config.gitExecutable,
          ["-C", repositoryRoot, "fetch", "--no-tags", "origin", `refs/heads/main:${main}`],
          repositoryRoot,
        );
        return (
          await run(config.gitExecutable, ["-C", repositoryRoot, "rev-parse", main], repositoryRoot)
        ).stdout.trim();
      } catch (error) {
        throw new QueueBlocked("current-main-unavailable", String(error));
      }
    },
    issue: observe,
    async removeReady(config, number) {
      await gh(config, ["issue", "edit", String(number), "--remove-label", "ready"]);
    },
    async close(config, number) {
      await gh(config, ["issue", "close", String(number)]);
    },
    async comment(config, number, body) {
      try {
        await gh(config, ["issue", "comment", String(number), "--body", body]);
      } catch (error) {
        throw new GithubCommandFailure(error);
      }
    },
  };
}

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  loadBoardSnapshot,
  planningKeyOf,
  validateBoardSnapshot,
  type BoardItem,
  type BoardSnapshot,
} from "../planning/board-check.mjs";
import {
  loadPlanningSnapshot,
  parseFrontmatter,
  validatePlanningSnapshot,
  type PlanningSnapshot,
} from "../planning/check.mjs";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, validateHistory } from "./queue.ts";

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
}

export interface SupervisedCycle {
  selection: SelectedIssue;
  initialHistory: QueueParticipant[];
}

export interface IssueObservation {
  state: "OPEN" | "CLOSED";
  key: string | undefined;
  labels: string[];
  comments: string[];
}

export interface SupervisionAdapter {
  board(repository: string): Promise<BoardSnapshot>;
  currentMain(config: LoopConfig, executingRoot: string): Promise<string>;
  issue(config: LoopConfig, number: number): Promise<IssueObservation>;
  removeReady(config: LoopConfig, number: number): Promise<void>;
  restoreReady(config: LoopConfig, number: number): Promise<void>;
  close(config: LoopConfig, number: number): Promise<void>;
  comment(config: LoopConfig, number: number, body: string): Promise<void>;
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
    exactKeys(value, ["cycle", "key", "number", "base"]) &&
    value.cycle === cycle &&
    /^ISS-\d{3}$/.test(value.key) &&
    Number.isSafeInteger(value.number) &&
    value.number > 0 &&
    SHA.test(value.base)
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

function registeredByKey(planning: PlanningSnapshot) {
  return new Map(planning.roadmap.issues.map((issue: any) => [issue.key, issue]));
}

function boardByKey(board: BoardSnapshot) {
  const open = new Map<string, BoardItem>();
  const closed = new Set<string>();
  for (const issue of board.issues) {
    const key = planningKeyOf(issue.body);
    if (!key) continue;
    if (issue.state === "CLOSED") closed.add(key);
    else open.set(key, issue);
  }
  return { open, closed };
}

export function selectReadyIssue(planning: PlanningSnapshot, board: BoardSnapshot) {
  validatePlanningSnapshot(planning);
  validateBoardSnapshot(planning, board);
  const registered = registeredByKey(planning);
  const observed = boardByKey(board);
  const earliest = planning.roadmap.milestones.find((milestone: any) =>
    planning.roadmap.issues.some(
      (issue: any) => issue.milestone === milestone.key && observed.open.has(issue.key),
    ),
  );
  if (!earliest) return undefined;

  for (const issue of planning.roadmap.issues
    .filter((candidate: any) => candidate.milestone === earliest.key)
    .sort((left: any, right: any) => left.key.localeCompare(right.key))) {
    const item = observed.open.get(issue.key);
    if (!item || !item.labels?.includes("ready")) continue;
    const registeredIssue = registered.get(issue.key) as any;
    const frontmatter = parseFrontmatter(planning.issueDrafts[issue.key]!, registeredIssue.file);
    const blockers = frontmatter.blocked_by ?? [];
    if (blockers.every((key: string) => observed.closed.has(key) && !observed.open.has(key)))
      return { key: issue.key, number: item.number };
  }
  return undefined;
}

function stateDirectory(config: LoopConfig) {
  return resolve(config.stateRoot, config.run);
}

export async function nextCycle(
  config: LoopConfig,
  executingRoot: string,
  adapter: SupervisionAdapter,
): Promise<SupervisedCycle | undefined> {
  const directory = stateDirectory(config);
  let cycle = 1;
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
      initialHistory = completed.history;
      cycle += 1;
      continue;
    }
    if (selected !== ABSENT) {
      if (!validSelection(selected, cycle))
        throw new QueueBlocked(`malformed-supervision-record:cycle-${cycle}-selected`);
      return { selection: selected, initialHistory };
    }

    const planning = await loadPlanningSnapshot(executingRoot);
    const board = await adapter.board(config.repository);
    const issue = selectReadyIssue(planning, board);
    if (!issue) return undefined;
    let base;
    try {
      base = await adapter.currentMain(config, executingRoot);
      if (!SHA.test(base)) throw new QueueBlocked("current-main-unavailable");
    } catch {
      const target = { cycle, ...issue };
      await postLearningNote(
        config,
        target,
        stopMessage(config, target, 0, "current-main-unavailable", 0),
        adapter,
      );
      throw new QueueBlocked("current-main-unavailable");
    }
    return {
      selection: { cycle, ...issue, base },
      initialHistory,
    };
  }
}

function assertIssue(selection: Pick<SelectedIssue, "key">, observed: IssueObservation) {
  if (observed.key !== selection.key) throw new QueueBlocked("selected-issue-identity-drift");
}

export async function persistCycle(config: LoopConfig, cycle: SupervisedCycle) {
  const directory = stateDirectory(config);
  await mkdir(directory, { recursive: true });
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
  await record(stateDirectory(config), `cycle-${cycle.selection.cycle}-complete`, {
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
  "reviewer-retry-exhausted": ({ evidence }) =>
    `inspect ${evidence} for the reviewer terminal, correct the verdict/findings/G0 shape, and restart`,
  "exit-receipt-timeout": ({ evidence }) =>
    `inspect ${evidence} for the worker attempt and trace, restore the missing exit receipt, and restart`,
  "native-launch-ceiling-exhausted": ({ evidence }) =>
    `inspect ${evidence} and the nativeLaunchCeiling field, then start an authorized run with enough launch budget`,
  "implementation-attempt-ceiling-exhausted": ({ evidence }) =>
    `inspect ${evidence}, apply the final blocking findings, and start an authorized implementation attempt`,
  "author-temp-unavailable": ({ evidence }) =>
    `restore host write access to the run's private author-temp directory under ${evidence}, and restart`,
  "author-offline-pnpm-unavailable": () =>
    "install or cache the exact packageManager pnpm version, or launch the loop with a matching installed npm_execpath, and restart",
};
function stopMessage(
  config: LoopConfig,
  selection: Pick<SelectedIssue, "cycle" | "key" | "number">,
  stop: number,
  reason: string,
  attempts: number,
  diagnostics?: string,
) {
  const marker = `loop-stop:${config.run}:${selection.cycle}:${stop}`;
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
  const change = exact
    ? exact(context)
    : `inspect ${evidence} for the stop reason ${reason}, correct the reported condition, and restart`;
  const count = `after ${attempts} implementation attempt${attempts === 1 ? "" : "s"}`;
  const detail = diagnostics?.trim().slice(0, 500);
  return {
    marker,
    body: `<!-- ${marker} --> The loop stopped on ${selection.key} because \`${reason}\` ${count}. A person should ${change}.${detail ? ` Diagnostic: ${JSON.stringify(detail)}.` : ""}`,
  };
}

async function postLearningNote(
  config: LoopConfig,
  selection: Pick<SelectedIssue, "key" | "number">,
  note: { marker: string; body: string },
  adapter: SupervisionAdapter,
) {
  let observed = await adapter.issue(config, selection.number);
  assertIssue(selection, observed);
  if (observed.state !== "OPEN") throw new QueueBlocked("stopped-issue-state-unknown");
  const matching = observed.comments.filter((body) => body.includes(`<!-- ${note.marker} -->`));
  if (matching.length > 1) throw new QueueBlocked("duplicate-learning-note");
  if (matching.length === 0) {
    await adapter.comment(config, selection.number, note.body);
    observed = await adapter.issue(config, selection.number);
    assertIssue(selection, observed);
    if (!observed.comments.some((body) => body.includes(`<!-- ${note.marker} -->`)))
      throw new QueueBlocked("learning-note-state-unknown");
  }
  return observed;
}

export async function stopCycle(
  config: LoopConfig,
  cycle: SupervisedCycle,
  reason: string,
  attempts: number,
  adapter: SupervisionAdapter,
  diagnostics?: string,
) {
  const directory = stateDirectory(config);
  let stop = 1;
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
        ...stopMessage(config, cycle.selection, stop, reason, attempts, diagnostics),
      };
      await record(directory, `cycle-${cycle.selection.cycle}-stop-${stop}`, intent);
      break;
    }
    if (completed === ABSENT) {
      intent = current;
      break;
    }
    stop += 1;
  }
  if (
    !exactKeys(intent, ["selection", "stop", "reason", "attempts", "marker", "body"]) ||
    JSON.stringify(intent.selection) !== JSON.stringify(cycle.selection) ||
    intent.stop !== stop ||
    typeof intent.reason !== "string" ||
    !Number.isSafeInteger(intent.attempts) ||
    typeof intent.marker !== "string" ||
    typeof intent.body !== "string"
  )
    throw new QueueBlocked(
      `malformed-supervision-record:cycle-${cycle.selection.cycle}-stop-${stop}`,
    );

  let observed = await postLearningNote(
    config,
    cycle.selection,
    { marker: intent.marker, body: intent.body },
    adapter,
  );
  if (!observed.labels.includes("ready")) {
    await adapter.restoreReady(config, cycle.selection.number);
    observed = await adapter.issue(config, cycle.selection.number);
    assertIssue(cycle.selection, observed);
    if (observed.state !== "OPEN" || !observed.labels.includes("ready"))
      throw new QueueBlocked("restored-label-state-unknown");
  }
  await record(directory, `cycle-${cycle.selection.cycle}-stop-${stop}-complete`, {
    selection: cycle.selection,
    stop,
  });
}

export async function reconcilePendingStop(
  config: LoopConfig,
  cycle: SupervisedCycle,
  adapter: SupervisionAdapter,
) {
  const directory = stateDirectory(config);
  for (let stop = 1; ; stop += 1) {
    const intent = await optionalRecord(directory, `cycle-${cycle.selection.cycle}-stop-${stop}`);
    if (intent === ABSENT) return false;
    const completed = await optionalRecord(
      directory,
      `cycle-${cycle.selection.cycle}-stop-${stop}-complete`,
    );
    if (completed !== ABSENT) continue;
    await stopCycle(config, cycle, intent.reason, intent.attempts, adapter);
    return true;
  }
}

async function run(executable: string, args: string[], cwd: string) {
  return exec(executable, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function repositorySupervisionAdapter(): SupervisionAdapter {
  const gh = async (config: LoopConfig, args: string[]) =>
    (
      await run(
        "gh",
        [...args, "--repo", `github.com/${config.repository}`],
        config.stableExecutorRoot,
      )
    ).stdout.trim();
  const observe = async (config: LoopConfig, number: number): Promise<IssueObservation> => {
    try {
      const row = JSON.parse(
        await gh(config, [
          "issue",
          "view",
          String(number),
          "--json",
          "number,body,state,labels,comments",
        ]),
      );
      if (
        row?.number !== number ||
        !["OPEN", "CLOSED"].includes(row.state) ||
        !Array.isArray(row.labels) ||
        !Array.isArray(row.comments)
      )
        throw new Error("malformed issue");
      return {
        state: row.state,
        key: planningKeyOf(row.body),
        labels: row.labels.map((label: any) => label?.name),
        comments: row.comments.map((comment: any) => comment?.body),
      };
    } catch {
      throw new QueueBlocked("issue-observation-unavailable");
    }
  };
  return {
    board: loadBoardSnapshot,
    async currentMain(config, executingRoot) {
      try {
        const main = "refs/remotes/origin/main";
        await run(
          config.gitExecutable,
          ["-C", executingRoot, "fetch", "--no-tags", "origin", `refs/heads/main:${main}`],
          executingRoot,
        );
        return (
          await run(config.gitExecutable, ["-C", executingRoot, "rev-parse", main], executingRoot)
        ).stdout.trim();
      } catch {
        throw new QueueBlocked("current-main-unavailable");
      }
    },
    issue: observe,
    async removeReady(config, number) {
      await gh(config, ["issue", "edit", String(number), "--remove-label", "ready"]);
    },
    async restoreReady(config, number) {
      await gh(config, ["issue", "edit", String(number), "--add-label", "ready"]);
    },
    async close(config, number) {
      await gh(config, ["issue", "close", String(number)]);
    },
    async comment(config, number, body) {
      await gh(config, ["issue", "comment", String(number), "--body", body]);
    },
  };
}

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
import { QueueBlocked, validateHistory, type LoopConfig, type QueueParticipant } from "./queue.ts";

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
  persisted: boolean;
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
      return { selection: selected, initialHistory, persisted: true };
    }

    const planning = await loadPlanningSnapshot(executingRoot);
    const board = await adapter.board(config.repository);
    const issue = selectReadyIssue(planning, board);
    if (!issue) return undefined;
    const base = await adapter.currentMain(config, executingRoot);
    if (!SHA.test(base)) throw new QueueBlocked("current-main-unavailable");
    return {
      selection: { cycle, ...issue, base },
      initialHistory,
      persisted: false,
    };
  }
}

function assertIssue(selection: SelectedIssue, observed: IssueObservation) {
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

const recovery = {
  completedIssue: ({ issue }: RecoveryContext) =>
    `check PR delivery for issue #${issue} on GitHub; if the PR merged, close the issue by hand and restart so the cycle reconciles`,
  issueObservation: () => "restore `gh` authentication or network access and restart",
  selectedBase: ({ runState, cycle }: RecoveryContext) =>
    `open cycle-${cycle}-selected.json under ${runState}, fetch origin or otherwise restore its pinned base commit in the executor checkout, and restart`,
  currentMain: ({ runState }: RecoveryContext) =>
    `check the stableExecutorRoot and gitExecutable fields in the loop config for ${runState}, restore access to origin/main, and restart`,
  typecheck: ({ evidence }: RecoveryContext) =>
    `open the saved typecheck gate record under ${evidence}, fix the reported type error, and rerun typecheck`,
  format: ({ evidence }: RecoveryContext) =>
    `open the saved format gate record under ${evidence}, format the reported files, and rerun format:check`,
  reviewer: ({ evidence }: RecoveryContext) =>
    `open the saved reviewer terminal under ${evidence}, correct the verdict to the required verdict/findings/G0 shape, and restart`,
  exitReceipt: ({ evidence }: RecoveryContext) =>
    `inspect the saved worker attempt and its trace path under ${evidence}, restore the missing exit receipt, and restart`,
  nativeCeiling: ({ evidence }: RecoveryContext) =>
    `inspect the participant records under ${evidence}/queue and the nativeLaunchCeiling field in the loop config, then start a newly authorized run with enough launch budget for the remaining work`,
  attemptCeiling: ({ evidence }: RecoveryContext) =>
    `open item-1-failed.json under ${evidence}/queue, apply the final recorded blocking findings, and start a newly authorized run`,
  config: ({ runState }: RecoveryContext) =>
    `inspect the loop config used to start this run, correct its reported field or restore the pinned stable executor state recorded under ${runState}, and restart`,
  queue: ({ evidence }: RecoveryContext) =>
    `inspect the newest retained queue record under ${evidence}/queue, correct its reported state mismatch, and restart`,
  setup: ({ evidence }: RecoveryContext) =>
    `inspect the setup and dependency records under ${evidence}/setup, correct the recorded worktree or offline dependency failure, and restart`,
  source: ({ evidence }: RecoveryContext) =>
    `inspect the source or repair candidate, history, and reviewer terminal records under ${evidence}/source and ${evidence}/repair, correct the recorded candidate or review-state mismatch, and restart`,
  delivery: ({ evidence }: RecoveryContext) =>
    `inspect the delivery, hosted-check, publication, merge, and cleanup records under ${evidence}/source and ${evidence}/repair, correct the reported GitHub or repository state, and restart`,
  issue: ({ issue }: RecoveryContext) =>
    `inspect issue #${issue} on GitHub, correct the reported issue or label state, and restart`,
} satisfies Record<string, RecoveryAction>;

const exactRecoveryRows: readonly (readonly [string, RecoveryAction])[] = [
  ["ambiguous-local-cleanup-branch", recovery.delivery],
  ["ambiguous-remote-cleanup-branch", recovery.delivery],
  ["author-failed", recovery.source],
  ["author-head-moved", recovery.source],
  ["author-is-delta-reviewer", recovery.source],
  ["author-is-reviewer", recovery.source],
  ["author-launch-identity-unknown-reconcile", recovery.source],
  ["author-wrong-head", recovery.source],
  ["candidate-as-executor-selection", recovery.source],
  ["candidate-attempt-unavailable", recovery.source],
  ["candidate-footprint-drift", recovery.source],
  ["candidate-head-moved", recovery.source],
  ["candidate-workspace-drift", recovery.source],
  ["changed-base", recovery.queue],
  ["ci-head-moved", recovery.queue],
  ["cleanup-dirty-worktree", recovery.setup],
  ["cleanup-head-drift", recovery.delivery],
  ["cleanup-outcome-unknown", recovery.delivery],
  ["cleanup-state-unknown", recovery.delivery],
  ["cleanup-target-drift", recovery.delivery],
  ["cleanup-unconfirmed-reconcile-before-retry", recovery.delivery],
  ["closed-finite-input-required", recovery.queue],
  ["closed-issue-delivery-incomplete", recovery.issue],
  ["closed-issue-without-delivery", recovery.issue],
  ["commit-result-unknown-reconcile", recovery.queue],
  ["completed-issue-state-unknown", recovery.completedIssue],
  ["completed-item-history-drift", recovery.queue],
  ["completed-repair-drift", recovery.source],
  ["conflated-main-and-repair-base", recovery.source],
  ["conflicting-delivery-config", recovery.delivery],
  ["conflicting-run-configuration", recovery.config],
  ["conflicting-staged-mutation", recovery.queue],
  ["controller-executor-mismatch", recovery.config],
  ["controller-executor-not-repository-root", recovery.config],
  ["controller-executor-revision-moved", recovery.config],
  ["controller-executor-unverified", recovery.config],
  ["controller-path-mismatch", recovery.config],
  ["current-main-unavailable", recovery.currentMain],
  ["delivery-identity-drift", recovery.delivery],
  ["delivery-repository-mismatch", recovery.delivery],
  ["delivery-repository-unverified", recovery.delivery],
  ["delivery-source-drift", recovery.delivery],
  ["delivery-source-head-drift", recovery.delivery],
  ["delivery-state-inside-checkout", recovery.delivery],
  ["delivery-state-unknown", recovery.delivery],
  ["delivery-worktree-family-mismatch", recovery.setup],
  ["delivery-worktree-overlap", recovery.setup],
  ["delta-participant-mismatch", recovery.source],
  ["delta-predecessor-mismatch", recovery.queue],
  ["delta-review-failed", recovery.source],
  ["delta-review-not-accepted", recovery.source],
  ["delta-workspace-not-clean-at-candidate", recovery.source],
  ["dependency-install-failed", recovery.setup],
  ["dependency-install-unknown", recovery.setup],
  ["dependency-state-drift:pilot", recovery.setup],
  ["dependency-state-drift:review", recovery.setup],
  ["dependency-state-drift:source", recovery.setup],
  ["dependency-state-unconfirmed:pilot", recovery.setup],
  ["dependency-state-unconfirmed:review", recovery.setup],
  ["dependency-state-unconfirmed:source", recovery.setup],
  ["dirty-author", recovery.source],
  ["dirty-controller-executor", recovery.config],
  ["dirty-pilot", recovery.queue],
  ["dirty-reviewer", recovery.source],
  ["dirty-setup-repository", recovery.setup],
  ["duplicate-learning-note", recovery.issue],
  ["duplicate-queue-item", recovery.queue],
  ["empty-ci-checks", recovery.delivery],
  ["empty-footprint", recovery.source],
  ["empty-hosted-checks", recovery.delivery],
  ["empty-prompt", recovery.queue],
  ["exit-receipt-timeout", recovery.exitReceipt],
  ["gate-correction-state-unknown", recovery.delivery],
  ["gate-failed:format:check", recovery.format],
  ["gate-failed:planning:board-check", recovery.delivery],
  ["gate-failed:planning:check", recovery.delivery],
  ["gate-failed:typecheck", recovery.typecheck],
  ["gate-retry-exhausted:format:check", recovery.format],
  ["gate-retry-exhausted:typecheck", recovery.typecheck],
  ["gate-retry-state-unknown", recovery.delivery],
  ["hosted-check-failed:Node 24 / macos-latest", recovery.delivery],
  ["hosted-check-failed:Node 24 / ubuntu-latest", recovery.delivery],
  ["hosted-check-failed:Node 24 / windows-latest", recovery.delivery],
  ["hosted-head-drift", recovery.delivery],
  ["hosted-observation-unavailable", recovery.delivery],
  ["implementation-attempt-ceiling-exhausted", recovery.attemptCeiling],
  ["incompatible-git", recovery.config],
  ["incomplete-check-prerequisites", recovery.delivery],
  ["incomplete-completed-delivery", recovery.delivery],
  ["incomplete-merge-prerequisites", recovery.delivery],
  ["incomplete-queue-reconciliation", recovery.queue],
  ["inconsistent-source-review-verdict", recovery.source],
  ["invalid-attempt-ceiling", recovery.config],
  ["invalid-attempt-identity", recovery.config],
  ["invalid-author", recovery.source],
  ["invalid-base", recovery.config],
  ["invalid-baseBranch", recovery.config],
  ["invalid-candidate-head", recovery.source],
  ["invalid-codexExecutable", recovery.config],
  ["invalid-controller-revision", recovery.config],
  ["invalid-controllerRevision", recovery.config],
  ["invalid-controllerRoot", recovery.config],
  ["invalid-exit-receipt-window", recovery.config],
  ["invalid-footprint", recovery.source],
  ["invalid-gitExecutable", recovery.config],
  ["invalid-issue", recovery.issue],
  ["invalid-native-launch-ceiling", recovery.config],
  ["invalid-owner", recovery.config],
  ["invalid-participant-identity", recovery.source],
  ["invalid-pilotRevision", recovery.config],
  ["invalid-pilotWorktree", recovery.config],
  ["invalid-queue-limit", recovery.config],
  ["invalid-repair-participant-identity", recovery.source],
  ["invalid-repository", recovery.config],
  ["invalid-repositoryRoot", recovery.config],
  ["invalid-required-checks", recovery.delivery],
  ["invalid-reviewWorktree", recovery.source],
  ["invalid-reviewer", recovery.source],
  ["invalid-run", recovery.config],
  ["invalid-selected-issue", recovery.issue],
  ["invalid-sourceBranch", recovery.source],
  ["invalid-sourceWorktree", recovery.source],
  ["invalid-stableExecutorRoot", recovery.config],
  ["invalid-stateDirectory", recovery.config],
  ["invalid-stateRoot", recovery.config],
  ["invalid-worktreeRoot", recovery.setup],
  ["invalid-worktree", recovery.setup],
  ["issue-observation-unavailable", recovery.issueObservation],
  ["item-review-history-mismatch", recovery.source],
  ["learning-note-state-unknown", recovery.issue],
  ["loop-roots-overlap", recovery.config],
  ["malformed-acceptance-criteria", recovery.queue],
  ["malformed-accepted-stage", recovery.queue],
  ["malformed-check", recovery.delivery],
  ["malformed-check:Node 24 / macos-latest", recovery.delivery],
  ["malformed-check:Node 24 / ubuntu-latest", recovery.delivery],
  ["malformed-check:Node 24 / windows-latest", recovery.delivery],
  ["malformed-cleanup-plan", recovery.delivery],
  ["malformed-cleanup-receipt", recovery.delivery],
  ["malformed-completed-delivery", recovery.delivery],
  ["malformed-completed-item", recovery.queue],
  ["malformed-delivery-completion", recovery.delivery],
  ["malformed-delivery-config", recovery.delivery],
  ["malformed-delivery-plan-authorization", recovery.delivery],
  ["malformed-delivery-plan-record", recovery.delivery],
  ["malformed-dependency-intent:pilot", recovery.setup],
  ["malformed-dependency-intent:review", recovery.setup],
  ["malformed-dependency-intent:source", recovery.setup],
  ["malformed-dependency-receipt:pilot", recovery.setup],
  ["malformed-dependency-receipt:review", recovery.setup],
  ["malformed-dependency-receipt:source", recovery.setup],
  ["malformed-draft-plan", recovery.queue],
  ["malformed-draft-policy", recovery.queue],
  ["malformed-exit-receipt-window", recovery.queue],
  ["malformed-failed-attempt", recovery.queue],
  ["malformed-gate-plan", recovery.delivery],
  ["malformed-gate-retry", recovery.delivery],
  ["malformed-gate-retry-stop", recovery.delivery],
  ["malformed-hosted-checks-record", recovery.delivery],
  ["malformed-local-cleanup-branch", recovery.delivery],
  ["malformed-loop-config", recovery.config],
  ["malformed-merge-policy", recovery.delivery],
  ["malformed-merge-receipt", recovery.delivery],
  ["malformed-participant-history", recovery.source],
  ["malformed-participant-usage", recovery.source],
  ["malformed-policy-plan", recovery.queue],
  ["malformed-publication-intent", recovery.delivery],
  ["malformed-publication-plan", recovery.delivery],
  ["malformed-publication-receipt", recovery.delivery],
  ["malformed-publication-refresh", recovery.delivery],
  ["malformed-queue-complete", recovery.queue],
  ["malformed-queue-config", recovery.config],
  ["malformed-queue-config-record", recovery.config],
  ["malformed-queue-item", recovery.queue],
  ["malformed-remote-cleanup-branch", recovery.delivery],
  ["malformed-repair-actor", recovery.source],
  ["malformed-repair-config", recovery.source],
  ["malformed-repair-failure-stage", recovery.source],
  ["malformed-repair-footprint", recovery.source],
  ["malformed-repair-paths", recovery.source],
  ["malformed-repair-record:repair-complete", recovery.source],
  ["malformed-required-checks", recovery.delivery],
  ["malformed-setup-config", recovery.setup],
  ["malformed-setup-stage", recovery.setup],
  ["malformed-source-failure-stage", recovery.source],
  ["malformed-source-finding", recovery.source],
  ["malformed-source-footprint", recovery.source],
  ["malformed-source-record", recovery.source],
  ["malformed-source-review-report", recovery.source],
  ["malformed-terminal", recovery.reviewer],
  ["malformed-worktree-intent:pilot", recovery.setup],
  ["malformed-worktree-intent:review", recovery.setup],
  ["malformed-worktree-intent:source", recovery.setup],
  ["malformed-worktree-receipt:pilot", recovery.setup],
  ["malformed-worktree-receipt:review", recovery.setup],
  ["malformed-worktree-receipt:source", recovery.setup],
  ["merge-head-drift", recovery.delivery],
  ["merge-outcome-unknown", recovery.delivery],
  ["merge-state-unknown", recovery.delivery],
  ["merge-unconfirmed-reconcile-before-retry", recovery.delivery],
  ["missing-candidate-commit", recovery.source],
  ["missing-or-duplicate-check:Node 24 / macos-latest", recovery.delivery],
  ["missing-or-duplicate-check:Node 24 / ubuntu-latest", recovery.delivery],
  ["missing-or-duplicate-check:Node 24 / windows-latest", recovery.delivery],
  ["native-launch-ceiling-exhausted", recovery.nativeCeiling],
  ["native-launch-identity-unknown-reconcile", recovery.queue],
  ["orphaned-delivery-plan-authorization", recovery.delivery],
  ["orphaned-repair-handoff", recovery.source],
  ["outside-footprint", recovery.source],
  ["overlapping-repair-paths", recovery.source],
  ["overlapping-setup-paths", recovery.setup],
  ["participant-attempt-unreserved", recovery.source],
  ["participant-context-drift", recovery.source],
  ["participant-history-drift", recovery.source],
  ["participant-history-gap", recovery.source],
  ["participant-history-truncated", recovery.source],
  ["participant-history-unobserved", recovery.source],
  ["participant-stage-history-mismatch", recovery.source],
  ["participant-terminal-drift", recovery.source],
  ["persisted-artifact-prefix-forbidden", recovery.queue],
  ["pilot-revision-moved", recovery.queue],
  ["planning-repository-mismatch", recovery.config],
  ["publication-branch-mismatch", recovery.delivery],
  ["publication-mismatch", recovery.delivery],
  ["publication-outcome-unknown", recovery.delivery],
  ["publication-refresh-lease-drift", recovery.delivery],
  ["publication-refresh-lease-unverified", recovery.delivery],
  ["publication-refresh-not-forward", recovery.delivery],
  ["publication-state-unknown", recovery.delivery],
  ["publication-target-drift", recovery.delivery],
  ["publication-unconfirmed-reconcile-before-retry", recovery.delivery],
  ["queue-adapter-config-drift", recovery.config],
  ["queue-base-drift", recovery.queue],
  ["queue-controller-drift", recovery.config],
  ["queue-cursor-gap", recovery.queue],
  ["queue-executor-drift", recovery.config],
  ["queue-hosted-check-drift", recovery.delivery],
  ["queue-internal-error", recovery.queue],
  ["queue-issue-drift", recovery.issue],
  ["queue-policy-drift", recovery.queue],
  ["queue-repository-drift", recovery.config],
  ["queue-run-drift", recovery.queue],
  ["queue-state-inside-checkout", recovery.delivery],
  ["queue-state-overlap", recovery.queue],
  ["queue-worktree-drift", recovery.setup],
  ["repair-admission-exhausted", recovery.source],
  ["repair-cannot-publish", recovery.source],
  ["repair-flow-state-unknown", recovery.source],
  ["repair-history-state-unknown", recovery.source],
  ["repair-review-state-unknown", recovery.source],
  ["repair-state-unknown", recovery.source],
  ["restored-label-state-unknown", recovery.issue],
  ["reused-participant-identity", recovery.source],
  ["reviewer-failed", recovery.source],
  ["reviewer-launch-identity-unknown-reconcile", recovery.source],
  ["reviewer-modified-worktree", recovery.setup],
  ["reviewer-retry-attempt-without-intent", recovery.source],
  ["reviewer-retry-exhausted", recovery.reviewer],
  ["reviewer-retry-intent-drift", recovery.source],
  ["reviewer-retry-launch-identity-unknown-reconcile", recovery.source],
  ["reviewer-retry-participant-mismatch", recovery.source],
  ["reviewer-retry-state-incomplete", recovery.source],
  ["reviewer-state-incomplete", recovery.source],
  ["reviewer-wrong-head", recovery.source],
  ["selected-base-unavailable", recovery.selectedBase],
  ["selected-issue-criteria-missing", recovery.issue],
  ["selected-issue-identity-drift", recovery.issue],
  ["selected-issue-title-missing", recovery.issue],
  ["selected-issue-unregistered", recovery.issue],
  ["selected-review-state-unknown", recovery.source],
  ["self-draft-target-missing", recovery.queue],
  ["self-planning-identity-mismatch", recovery.queue],
  ["setup-authority-head-drift", recovery.setup],
  ["setup-authority-unverified", recovery.setup],
  ["setup-dependency-failed", recovery.setup],
  ["setup-incomplete", recovery.setup],
  ["setup-path-inside-existing-checkout", recovery.setup],
  ["setup-path-overlaps-existing-checkout", recovery.setup],
  ["setup-repository-mismatch", recovery.setup],
  ["setup-root-not-directory", recovery.setup],
  ["setup-state-unknown", recovery.setup],
  ["source-branch-head-drift", recovery.source],
  ["source-branch-is-base", recovery.source],
  ["source-candidate-mismatch", recovery.source],
  ["source-cannot-publish", recovery.source],
  ["source-config-mismatch", recovery.source],
  ["source-finding-location-outside-candidate", recovery.source],
  ["source-flow-state-unknown", recovery.source],
  ["source-history-mismatch", recovery.source],
  ["source-participant-mismatch", recovery.source],
  ["source-review-git-state-unknown", recovery.source],
  ["source-review-not-accepted", recovery.source],
  ["source-review-not-fixable-failure", recovery.source],
  ["source-review-state-unknown", recovery.source],
  ["source-review-summary-out-of-bounds", recovery.source],
  ["source-terminal-mismatch", recovery.source],
  ["source-workspace-not-clean-at-candidate", recovery.source],
  ["state-inside-checkout", recovery.delivery],
  ["stopped-issue-state-unknown", recovery.issue],
  ["unauthorized-delivery", recovery.delivery],
  ["unauthorized-delivery-plan", recovery.delivery],
  ["unauthorized-queue", recovery.source],
  ["unauthorized-repair", recovery.source],
  ["unauthorized-setup", recovery.setup],
  ["unauthorized-source-review", recovery.source],
  ["unexpected-queue-state", recovery.queue],
  ["unexpected-repair-flow-status", recovery.source],
  ["unexpected-repair-status", recovery.source],
  ["unexpected-setup-state", recovery.setup],
  ["unexpected-source-flow-status", recovery.source],
  ["unowned-worktree:pilot", recovery.setup],
  ["unowned-worktree:review", recovery.setup],
  ["unowned-worktree:source", recovery.setup],
  ["unresolved-setup-path", recovery.setup],
  ["unresolved-setup-path-case", recovery.setup],
  ["unreviewed-delivery-source", recovery.delivery],
  ["unreviewed-pilot-selection", recovery.source],
  ["unstable-executor", recovery.config],
  ["unsupported-adapter-configuration", recovery.config],
  ["unsupported-repair-adapter", recovery.source],
  ["unsupported-self-delivery-policy", recovery.delivery],
  ["unsupported-self-merge-policy", recovery.delivery],
  ["usage", recovery.queue],
  ["typecheck-failed-after-retry", recovery.typecheck],
  ["working-label-state-unknown", recovery.issue],
  ["worktree-collision:pilot", recovery.setup],
  ["worktree-collision:review", recovery.setup],
  ["worktree-collision:source", recovery.setup],
  ["worktree-isolation", recovery.setup],
  ["worktree-must-be-repository-root", recovery.setup],
  ["worktree-state-drift:pilot", recovery.setup],
  ["worktree-state-drift:review", recovery.setup],
  ["worktree-state-drift:source", recovery.setup],
  ["worktree-state-unknown:pilot", recovery.setup],
  ["worktree-state-unknown:review", recovery.setup],
  ["worktree-state-unknown:source", recovery.setup],
  ["worktree-unconfirmed", recovery.setup],
  ["wrong-planning-repository", recovery.config],
  ["wrong-self-hosted-checks", recovery.delivery],
  ["wrong-self-issue", recovery.issue],
  ["wrong-self-repository", recovery.config],
];

export const stopRecoveryActions = new Map(exactRecoveryRows);

function stopMessage(
  config: LoopConfig,
  selection: SelectedIssue,
  stop: number,
  reason: string,
  attempts: number | "unavailable",
) {
  const safeReason = reason.replace(/`/g, "'");
  const marker = `loop-stop:${config.run}:${selection.cycle}:${stop}`;
  const runState = resolve(config.stateRoot, config.run);
  const evidence = resolve(runState, `${selection.key.toLowerCase()}-attempt-*`);
  const context = {
    runState,
    evidence,
    issue: selection.number,
    cycle: selection.cycle,
  };
  const exact = stopRecoveryActions.get(reason);
  const change = exact
    ? exact(context)
    : `inspect the newest retained queue/component record under ${evidence}, correct its reported command/state mismatch, and restart; this stop reason is unmapped`;
  const count =
    attempts === "unavailable"
      ? "with the implementation-attempt count unavailable in the retained state"
      : `after ${attempts} implementation attempt${attempts === 1 ? "" : "s"}`;
  return {
    marker,
    body: `<!-- ${marker} --> The loop stopped on ${selection.key} because \`${safeReason}\` ${count}. A person should ${change}.`,
  };
}

export async function stopCycle(
  config: LoopConfig,
  cycle: SupervisedCycle,
  reason: string,
  attempts: number | "unavailable",
  adapter: SupervisionAdapter,
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
        ...stopMessage(config, cycle.selection, stop, reason, attempts),
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
    !(Number.isSafeInteger(intent.attempts) || intent.attempts === "unavailable") ||
    typeof intent.marker !== "string" ||
    typeof intent.body !== "string"
  )
    throw new QueueBlocked(
      `malformed-supervision-record:cycle-${cycle.selection.cycle}-stop-${stop}`,
    );

  let observed = await adapter.issue(config, cycle.selection.number);
  assertIssue(cycle.selection, observed);
  if (observed.state !== "OPEN") throw new QueueBlocked("stopped-issue-state-unknown");
  const matching = observed.comments.filter((body) => body.includes(`<!-- ${intent.marker} -->`));
  if (matching.length > 1) throw new QueueBlocked("duplicate-learning-note");
  if (matching.length === 0) {
    await adapter.comment(config, cycle.selection.number, intent.body);
    observed = await adapter.issue(config, cycle.selection.number);
    assertIssue(cycle.selection, observed);
    if (!observed.comments.some((body) => body.includes(`<!-- ${intent.marker} -->`)))
      throw new QueueBlocked("learning-note-state-unknown");
  }
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
        await run(
          config.gitExecutable,
          ["-C", executingRoot, "fetch", "--no-tags", "origin", "refs/heads/main"],
          executingRoot,
        );
        return (
          await run(
            config.gitExecutable,
            ["-C", executingRoot, "rev-parse", "FETCH_HEAD"],
            executingRoot,
          )
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

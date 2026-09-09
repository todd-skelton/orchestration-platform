import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assertControllerExecutor, githubDeliveryAdapter } from "./delivery-adapter.mjs";
import {
  DeliveryBlocked,
  deliveryStep,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DeliveryPolicyAdapter,
} from "./delivery.mjs";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { codexAdapter } from "./dispatch-adapter.ts";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { step } from "./flow.ts";
import type { Adapter, Attempt, Config as SourceConfig, Role } from "./flow.js";
import { reviewedRepairAdapter } from "./repair-adapter.mjs";
import { repairStep, type RepairAdapter } from "./repair.mjs";
import {
  RepairBlocked,
  repairDigest,
  repairPolicy,
  type ParticipantHistory,
  type RepairConfig,
  type RepairPolicy,
} from "./repair-policy.mjs";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, queueDigest, validateHistory } from "./queue.ts";
import type {
  QueueAdapter,
  QueueConfig,
  QueueDeliveryResult,
  QueueItem,
  QueueParticipant,
  QueueRepairResult,
  QueueSourceResult,
  QueueUsage,
} from "./queue.js";
import { selfDeliveryPolicy } from "./self-delivery-policy.mjs";
import { gitSetupAdapter } from "./setup-adapter.mjs";
import { SetupBlocked, setupStep, type SetupAdapter } from "./setup.mjs";

const exec = promisify(execFile);
const ABSENT = Symbol("absent");
const SHA = /^[a-f0-9]{40}$/;

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new QueueBlocked(reason);
}

const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function outside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function canonicalSelectedPath(path: string) {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(await realpath(dirname(path)), basename(path));
  }
}

async function json(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch {
    throw new QueueBlocked(`malformed-component-record:${name}`);
  }
}

async function optional(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new QueueBlocked(`malformed-queue-record:${name}`);
  }
}

async function record(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(path, bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    demand((await readFile(path, "utf8")) === bytes, `conflicting-queue-record:${name}`);
  }
}

function unavailable(): QueueUsage["inputTokens"] {
  return { status: "unavailable" };
}

function measured(value: unknown, integer: boolean): QueueUsage["inputTokens"] {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    (!integer || Number.isSafeInteger(value))
    ? { status: "known", value }
    : unavailable();
}

export function queueUsage(value: unknown): QueueUsage {
  const canonical = (measure: unknown, integer: boolean) =>
    exactKeys(measure, ["status", "value"]) && measure.status === "known"
      ? measured(measure.value, integer)
      : unavailable();
  if (exactKeys(value, ["inputTokens", "outputTokens", "costUsd"]))
    return {
      inputTokens: canonical(value.inputTokens, true),
      outputTokens: canonical(value.outputTokens, true),
      costUsd: canonical(value.costUsd, false),
    };
  if (!object(value))
    return { inputTokens: unavailable(), outputTokens: unavailable(), costUsd: unavailable() };
  return {
    inputTokens: measured(value.input_tokens ?? value.inputTokens, true),
    outputTokens: measured(value.output_tokens ?? value.outputTokens, true),
    costUsd: measured(value.cost_usd ?? value.costUsd, false),
  };
}

function sameParticipantIdentity(left: QueueParticipant, right: QueueParticipant) {
  return (
    left.ordinal === right.ordinal &&
    left.id === right.id &&
    left.item === right.item &&
    left.stage === right.stage &&
    left.role === right.role &&
    left.outcome === right.outcome
  );
}

export interface RepositoryQueueAdapterOptions {
  native?: Adapter;
  setup?: SetupAdapter;
  repair?: RepairAdapter;
  delivery?: DeliveryAdapter;
  deliveryPolicy?: DeliveryPolicyAdapter;
  repairPolicy?: RepairPolicy;
  assertExecutor?: (config: DeliveryConfig, executingRoot: string) => Promise<void>;
}

function repairHistory(history: QueueParticipant[]): ParticipantHistory[] {
  return history.map((participant) => {
    const usage = participant.usage;
    return {
      ordinal: participant.ordinal,
      id: participant.id,
      role: participant.role,
      outcome: participant.outcome,
      usage:
        usage.inputTokens.status === "known" &&
        usage.outputTokens.status === "known" &&
        usage.costUsd.status === "known"
          ? {
              status: "known" as const,
              inputTokens: usage.inputTokens.value,
              outputTokens: usage.outputTokens.value,
              costUsd: usage.costUsd.value,
            }
          : { status: "unavailable" as const },
    };
  });
}

export function repositoryQueueAdapter(
  config: QueueConfig,
  options: RepositoryQueueAdapterOptions = {},
): QueueAdapter {
  const native = options.native ?? codexAdapter();
  const setupAdapter = options.setup ?? gitSetupAdapter();
  const deliveryAdapter = options.delivery ?? githubDeliveryAdapter();
  const deliveryPolicy = options.deliveryPolicy ?? selfDeliveryPolicy();
  const selectedRepairPolicy = options.repairPolicy ?? repairPolicy();
  const assertExecutor = options.assertExecutor ?? assertControllerExecutor;
  const state = config.stateDirectory;

  const readHistory = async () => {
    const history: QueueParticipant[] = [];
    let gap = false;
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const participant = await optional(state, `participant-${ordinal}-terminal`);
      if (participant === ABSENT) {
        gap = true;
        continue;
      }
      demand(!gap, "participant-history-gap");
      const normalized = {
        ...(participant as QueueParticipant),
        usage: queueUsage((participant as QueueParticipant).usage),
      };
      if (ordinal > config.initialHistory.length) {
        const [intent, attempt] = await Promise.all([
          optional(state, `participant-${ordinal}-intent`),
          optional(state, `participant-${ordinal}-attempt`),
        ]);
        demand(
          intent !== ABSENT &&
            attempt !== ABSENT &&
            intent.schemaVersion === "dogfood-bounded-queue-participant-intent/v1" &&
            attempt.schemaVersion === "dogfood-bounded-queue-participant/v1" &&
            intent.ordinal === ordinal &&
            attempt.ordinal === ordinal &&
            intent.item === normalized.item &&
            attempt.item === normalized.item &&
            intent.stage === normalized.stage &&
            attempt.stage === normalized.stage &&
            intent.role === normalized.role &&
            attempt.role === normalized.role &&
            attempt.id === normalized.id,
          "participant-history-unobserved",
        );
      }
      history.push(normalized);
    }
    validateHistory(history, config.nativeLaunchCeiling);
    return history;
  };

  const seedHistory = async () => {
    for (const participant of config.initialHistory) {
      const name = `participant-${participant.ordinal}-terminal`;
      const existing = await optional(state, name);
      if (existing === ABSENT)
        await record(state, name, { ...participant, usage: queueUsage(participant.usage) });
      else
        demand(
          object(existing) && sameParticipantIdentity(existing as QueueParticipant, participant),
          "participant-history-drift",
        );
    }
  };

  const nextOrdinal = async () => {
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const intent = await optional(state, `participant-${ordinal}-intent`);
      const terminal = await optional(state, `participant-${ordinal}-terminal`);
      if (intent === ABSENT && terminal === ABSENT) return ordinal;
      if (intent === ABSENT && terminal !== ABSENT) continue;
      const attempt = await optional(state, `participant-${ordinal}-attempt`);
      demand(attempt !== ABSENT, "native-launch-identity-unknown-reconcile");
    }
    throw new QueueBlocked("native-launch-ceiling-exhausted");
  };

  const boundedNative = (item: QueueItem, stage: "source" | "repair"): Adapter => ({
    ...native,
    async launch(role: Role, current: SourceConfig, prompt: string): Promise<Attempt> {
      const priorHistory = await readHistory();
      const ordinal = await nextOrdinal();
      const context = {
        schemaVersion: "dogfood-bounded-queue-participant-intent/v1",
        ordinal,
        item: item.id,
        issue: item.issue,
        stage,
        role,
        model: current[role].model,
        effort: current[role].effort,
      };
      await record(state, `participant-${ordinal}-intent`, context);
      const attempt = await native.launch(role, current, prompt);
      demand(
        typeof attempt.id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(attempt.id),
        "invalid-participant-identity",
      );
      demand(
        !priorHistory.some((participant) => participant.id === attempt.id),
        "reused-participant-identity",
      );
      await record(state, `participant-${ordinal}-attempt`, {
        schemaVersion: "dogfood-bounded-queue-participant/v1",
        ordinal,
        id: attempt.id,
        item: item.id,
        stage,
        role,
      });
      return attempt;
    },
  });

  const syncParticipants = async (
    item: QueueItem,
    stage: "source" | "repair",
    directory: string,
  ) => {
    for (const role of ["author", "reviewer"] as const) {
      const attempt = await optional(directory, `${role}-attempt`);
      if (attempt === ABSENT) continue;
      const terminal = await optional(directory, `${role}-terminal`);
      if (terminal === ABSENT || terminal.status === "running") continue;
      let matchedOrdinal: number | undefined;
      for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
        const saved = await optional(state, `participant-${ordinal}-attempt`);
        if (saved !== ABSENT && saved.id === attempt.id) {
          demand(
            saved.item === item.id && saved.stage === stage && saved.role === role,
            "participant-context-drift",
          );
          matchedOrdinal = ordinal;
          break;
        }
      }
      demand(matchedOrdinal !== undefined, "participant-attempt-unreserved");
      const participant: QueueParticipant = {
        ordinal: matchedOrdinal,
        id: attempt.id,
        item: item.id,
        stage,
        role,
        outcome:
          terminal.status === "passed"
            ? "passed"
            : terminal.status === "failed"
              ? "failed"
              : "unknown",
        usage: queueUsage(terminal.usage),
      };
      const existing = await optional(state, `participant-${matchedOrdinal}-terminal`);
      if (existing === ABSENT)
        await record(state, `participant-${matchedOrdinal}-terminal`, participant);
      else
        demand(
          sameParticipantIdentity(existing as QueueParticipant, participant),
          "participant-terminal-drift",
        );
    }
  };

  const acceptedPair = async (
    item: QueueItem,
    stage: "source" | "repair",
    reviewerOutcome: "passed" | "failed",
  ) => {
    const pair = (await readHistory()).filter(
      (participant) => participant.item === item.id && participant.stage === stage,
    );
    demand(
      pair.length === 2 &&
        pair[0]!.role === "author" &&
        pair[0]!.outcome === "passed" &&
        pair[1]!.role === "reviewer" &&
        pair[1]!.outcome === reviewerOutcome &&
        pair[0]!.id !== pair[1]!.id,
      "participant-stage-history-mismatch",
    );
  };

  const assertItem = (item: QueueItem) => {
    demand(
      item.issue === item.source.issue &&
        item.issue === item.setup.issue &&
        item.setup.run === item.source.run,
      "queue-issue-drift",
    );
    demand(item.base === item.source.base && item.base === item.setup.base, "queue-base-drift");
    demand(item.source.owner === config.authority.controller, "queue-controller-drift");
    demand(
      item.source.pilotRevision === config.controllerRevision,
      "candidate-as-executor-selection",
    );
    demand(
      item.setup.controllerRoot === config.controllerRoot &&
        item.setup.controllerRevision === config.controllerRevision &&
        item.setup.pilotRevision === config.controllerRevision &&
        item.setup.authority.controller === config.authority.controller,
      "queue-executor-drift",
    );
    demand(
      item.setup.sourceWorktree === item.source.worktree &&
        item.setup.reviewWorktree === item.source.reviewWorktree &&
        item.setup.pilotWorktree !== item.source.worktree &&
        item.setup.pilotWorktree !== item.source.reviewWorktree,
      "queue-worktree-drift",
    );
    demand(item.source.repository === item.setup.repository, "queue-repository-drift");
    demand(
      item.setup.authority.actions.includes("worktrees") &&
        item.repair.sourcePaths.every((sourcePath) =>
          item.source.allowedPaths.includes(sourcePath),
        ),
      "queue-policy-drift",
    );
    for (const actor of [item.repair.author, item.repair.reviewer])
      demand(
        exactKeys(actor, ["model", "effort", "promptFile"]) &&
          [actor.model, actor.effort].every(
            (value) => typeof value === "string" && value.length > 0,
          ) &&
          isAbsolute(actor.promptFile),
        "queue-policy-drift",
      );
    demand(
      JSON.stringify(item.delivery.requiredChecks) === JSON.stringify(item.source.requiredChecks),
      "queue-hosted-check-drift",
    );
  };

  const buildRepair = async (item: QueueItem): Promise<RepairConfig> => {
    const [pinned, candidate, authorAttempt, reviewerAttempt] = await Promise.all([
      json(item.source.stateDirectory, "config"),
      json(item.source.stateDirectory, "candidate"),
      json(item.source.stateDirectory, "author-attempt"),
      json(item.source.stateDirectory, "reviewer-attempt"),
    ]);
    demand(SHA.test(candidate.head), "source-candidate-mismatch");
    const history = await readHistory();
    const baseline = history.filter(
      (participant) => !(participant.item === item.id && participant.stage === "repair"),
    );
    demand(baseline.length + 2 <= config.nativeLaunchCeiling, "native-launch-ceiling-exhausted");
    const projected = repairHistory(baseline);
    const admission = {
      consumed: projected.length,
      ceiling: projected.length + 2,
      reservations: [
        { role: "author" as const, ordinal: projected.length + 1 },
        { role: "reviewer" as const, ordinal: projected.length + 2 },
      ] as [{ role: "author"; ordinal: number }, { role: "reviewer"; ordinal: number }],
    };
    const partial = {
      schemaVersion: "dogfood-repair-request/v1" as const,
      run: item.source.run,
      issue: item.issue,
      repository: item.source.repository,
      controllerRoot: config.controllerRoot,
      controllerRevision: config.controllerRevision,
      mainBase: item.base,
      repairBase: candidate.head,
      worktree: item.source.worktree,
      reviewWorktree: item.source.reviewWorktree,
      stateDirectory: item.repair.stateDirectory,
      sourceStateDirectory: item.source.stateDirectory,
      allowedPaths: item.source.allowedPaths,
      sourcePaths: item.repair.sourcePaths,
      acceptanceCriteria: item.repair.acceptanceCriteria,
      requiredChecks: item.source.requiredChecks,
      history: projected,
      implementationAttempts: item.implementationAttempt,
      implementationAttemptCeiling: 4,
      admission,
      author: item.repair.author,
      reviewer: item.repair.reviewer,
      adapter: item.source.adapter,
    };
    return {
      ...partial,
      authority: {
        schemaVersion: "dogfood-repair-authority/v1",
        controller: config.authority.controller,
        run: partial.run,
        issue: partial.issue,
        repository: partial.repository,
        controllerRoot: partial.controllerRoot,
        controllerRevision: partial.controllerRevision,
        mainBase: partial.mainBase,
        repairBase: partial.repairBase,
        worktree: partial.worktree,
        reviewWorktree: partial.reviewWorktree,
        stateDirectory: partial.stateDirectory,
        sourceStateDirectory: partial.sourceStateDirectory,
        allowedPaths: partial.allowedPaths,
        sourcePaths: partial.sourcePaths,
        acceptanceCriteria: partial.acceptanceCriteria,
        requiredChecks: partial.requiredChecks,
        source: {
          owner: item.source.owner,
          run: item.source.run,
          pilotRevision: item.source.pilotRevision,
          requiredChecks: item.source.requiredChecks,
          author: item.source.author,
          reviewer: item.source.reviewer,
          adapter: item.source.adapter,
          configFingerprint: pinned.fingerprint,
          candidateHead: candidate.head,
          authorAttempt: authorAttempt.id,
          reviewerAttempt: reviewerAttempt.id,
          reviewId: reviewerAttempt.id,
          disposition: "BLOCK_FIXABLE",
        },
        author: partial.author,
        reviewer: partial.reviewer,
        adapter: partial.adapter,
        implementationAttempts: partial.implementationAttempts,
        implementationAttemptCeiling: partial.implementationAttemptCeiling,
        admission,
        historyDigest: repairDigest(projected),
        actions: ["validate-source-review", "dispatch-author", "dispatch-delta-review"],
      },
    };
  };

  return {
    async assertAuthority(current) {
      demand(current === config, "queue-adapter-config-drift");
      const roots = await Promise.all(
        [
          config.controllerRoot,
          config.stateDirectory,
          ...config.items.flatMap((item) => [
            item.setup.stateDirectory,
            item.source.stateDirectory,
            item.repair.stateDirectory,
          ]),
        ].map((path) => realpath(path)),
      );
      demand(
        roots.every((root, index) =>
          roots.every((other, otherIndex) => index === otherIndex || outside(root, other)),
        ),
        "queue-state-overlap",
      );
      const controller = roots[0]!;
      const queueState = roots[1]!;
      const selectedRoots = await Promise.all(
        config.items
          .flatMap((item) => [
            item.setup.repositoryRoot,
            item.setup.controllerRoot,
            item.setup.pilotWorktree,
            item.setup.sourceWorktree,
            item.setup.reviewWorktree,
          ])
          .map(canonicalSelectedPath),
      );
      demand(
        outside(controller, queueState) &&
          outside(queueState, controller) &&
          selectedRoots.every((root) => outside(root, queueState) && outside(queueState, root)),
        "queue-state-inside-checkout",
      );
      const git = async (args: string[]) =>
        (
          await exec("git", ["-C", controller, ...args], {
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          })
        ).stdout.trim();
      try {
        demand(
          (await realpath(await git(["rev-parse", "--show-toplevel"]))) === controller,
          "controller-executor-not-repository-root",
        );
        demand(
          (await git(["rev-parse", "HEAD"])) === config.controllerRevision,
          "controller-executor-revision-moved",
        );
        demand((await git(["status", "--porcelain"])) === "", "dirty-controller-executor");
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked("controller-executor-unverified");
      }
      config.items.forEach(assertItem);
      await seedHistory();
      const authorityFingerprint = queueDigest({
        authority: config.authority,
        lineage: config.initialHistory.map(({ usage: _usage, ...identity }) => identity),
      });
      await record(state, "queue-adapter-authority", { fingerprint: authorityFingerprint });
    },
    history: readHistory,
    async setup(item) {
      assertItem(item);
      try {
        return await setupStep(item.setup, setupAdapter, config.controllerRoot);
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof SetupBlocked ? error.reason : "setup-state-unknown",
        );
      }
    },
    async source(item): Promise<QueueSourceResult> {
      assertItem(item);
      demand(
        (await optional(item.source.stateDirectory, "publication")) === ABSENT,
        "source-cannot-publish",
      );
      try {
        const result = await step(
          item.source,
          boundedNative(item, "source"),
          item.setup.pilotWorktree,
        );
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return { status: result.status };
        demand(result.status === "awaiting-publication", "unexpected-source-flow-status");
        await acceptedPair(item, "source", "passed");
        const [candidate, reviewer] = await Promise.all([
          json(item.source.stateDirectory, "candidate"),
          json(item.source.stateDirectory, "reviewer-attempt"),
        ]);
        return {
          status: "accepted",
          head: candidate.head,
          reviewId: reviewer.id,
          stateDirectory: item.source.stateDirectory,
        };
      } catch (error) {
        await syncParticipants(item, "source", item.source.stateDirectory);
        if (error instanceof QueueBlocked) throw error;
        const reason = error instanceof Error ? error.message : "";
        demand(reason === "reviewer-failed", "source-flow-state-unknown");
        const [candidate, reviewer, terminal] = await Promise.all([
          json(item.source.stateDirectory, "candidate"),
          json(item.source.stateDirectory, "reviewer-attempt"),
          json(item.source.stateDirectory, "reviewer-terminal"),
        ]);
        demand(
          terminal.status === "failed" &&
            terminal.id === reviewer.id &&
            terminal.head === candidate.head,
          "source-review-state-unknown",
        );
        await acceptedPair(item, "source", "failed");
        return { status: "fixable-review", head: candidate.head, reviewId: reviewer.id };
      }
    },
    async repair(item): Promise<QueueRepairResult> {
      assertItem(item);
      try {
        const repair = await buildRepair(item);
        const result = await repairStep(
          repair,
          options.repair ?? reviewedRepairAdapter(boundedNative(item, "repair")),
          selectedRepairPolicy,
        );
        await syncParticipants(item, "repair", item.repair.stateDirectory);
        if (result.status === "observing-author" || result.status === "observing-reviewer")
          return { status: result.status };
        demand(result.status === "awaiting-delivery", "unexpected-repair-status");
        await acceptedPair(item, "repair", "passed");
        const reviewer = await json(item.repair.stateDirectory, "reviewer-attempt");
        return {
          status: "accepted",
          head: result.head,
          reviewId: reviewer.id,
          stateDirectory: item.repair.stateDirectory,
        };
      } catch (error) {
        try {
          await syncParticipants(item, "repair", item.repair.stateDirectory);
        } catch (historyError) {
          if (historyError instanceof QueueBlocked) throw historyError;
          throw new QueueBlocked("repair-history-state-unknown");
        }
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof RepairBlocked ? error.reason : "repair-state-unknown",
        );
      }
    },
    async delivery(item, accepted): Promise<QueueDeliveryResult> {
      assertItem(item);
      const delivery: DeliveryConfig = {
        run: item.source.run,
        issue: item.issue,
        repository: item.source.repository,
        controllerRoot: config.controllerRoot,
        controllerRevision: config.controllerRevision,
        worktree: item.source.worktree,
        reviewWorktree: item.source.reviewWorktree,
        stateDirectory: accepted.stateDirectory,
        candidateHead: accepted.head,
        requiredChecks: item.delivery.requiredChecks,
        authority: {
          schemaVersion: "dogfood-delivery-authority/v1",
          controller: config.authority.controller,
          run: item.source.run,
          repository: item.source.repository,
          controllerRevision: config.controllerRevision,
          head: accepted.head,
          actions: ["gates", "mirror", "publish", "merge", "cleanup"],
        },
        policy: item.delivery.policy,
      };
      try {
        await assertExecutor(delivery, config.controllerRoot);
        const result = await deliveryStep(delivery, deliveryAdapter, deliveryPolicy);
        demand(
          result.head === accepted.head && result.reviewId === accepted.reviewId,
          "delivery-source-drift",
        );
        return result as QueueDeliveryResult;
      } catch (error) {
        if (error instanceof QueueBlocked) throw error;
        throw new QueueBlocked(
          error instanceof DeliveryBlocked ? error.reason : "delivery-state-unknown",
        );
      }
    },
  };
}

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type {
  DeliveryConfig,
  DeliveryPlan,
  DeliveryPolicyAdapter,
  DeliveryResult,
  DraftPlan,
  PublicationPlan,
} from "./delivery.js";

export interface RepositoryCandidate {
  key: string;
  number: number;
}

export interface RepositoryIssueContext {
  title: string;
  body: string;
  acceptanceCriteria: string[];
  rules: string;
}

export interface RepositoryAdapter {
  selectCandidates(input: {
    repository: string;
    executorRoot: string;
  }): Promise<RepositoryCandidate[]> | RepositoryCandidate[];
  issueContext(input: {
    repository: string;
    key: string;
    number: number;
    executorRoot: string;
  }): Promise<RepositoryIssueContext> | RepositoryIssueContext;
  branchName(input: {
    key: string;
    number: number;
    title: string;
    attempt: number;
  }): Promise<string> | string;
  pullRequest(input: {
    config: DeliveryConfig;
    gitExecutable: string;
  }): Promise<PublicationPlan> | PublicationPlan;
  requiredChecks(input: { repository: string }): Promise<string[]> | string[];
  park(input: { repository: string; number: number; reason: string }): Promise<string> | string;
  localGates?(input: { repository: string }): Promise<string[]> | string[];
  mergeMethod(input: { config: DeliveryConfig }): Promise<unknown> | unknown;
  afterMerge(input: {
    config: DeliveryConfig;
    delivery: Extract<DeliveryResult, { status: "complete" }>;
  }): Promise<void> | void;
  mirrorPlanning?(input: { config: DeliveryConfig }):
    | Promise<{
        gates: DeliveryPlan["gates"];
        drafts: DraftPlan[];
      }>
    | {
        gates: DeliveryPlan["gates"];
        drafts: DraftPlan[];
      };
}

function adapterName(value: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error("invalid-repository-adapter");
  return value;
}

export function validateRepositoryAdapter(value: unknown): asserts value is RepositoryAdapter {
  if (
    !value ||
    typeof value !== "object" ||
    [
      "selectCandidates",
      "issueContext",
      "branchName",
      "pullRequest",
      "requiredChecks",
      "park",
      "mergeMethod",
      "afterMerge",
    ].some((name) => typeof (value as Record<string, unknown>)[name] !== "function") ||
    (Object.hasOwn(value, "mirrorPlanning") &&
      typeof (value as Record<string, unknown>).mirrorPlanning !== "function") ||
    (Object.hasOwn(value, "localGates") &&
      typeof (value as Record<string, unknown>).localGates !== "function")
  )
    throw new Error("invalid-repository-adapter");
}

export async function loadRepositoryAdapter(name: string, root: string) {
  const loaded: unknown = await import(
    pathToFileURL(resolve(root, "adapters", `${adapterName(name)}.mjs`)).href
  );
  validateRepositoryAdapter(loaded);
  return loaded;
}

export function repositoryDeliveryPolicy(
  adapter: RepositoryAdapter,
  gitExecutable: string,
): DeliveryPolicyAdapter {
  return {
    async plan(config) {
      const publication = await adapter.pullRequest({ config, gitExecutable });
      const mergePolicy = await adapter.mergeMethod({ config });
      const localGates = adapter.localGates
        ? await adapter.localGates({ repository: config.repository })
        : [];
      const mirror = adapter.mirrorPlanning
        ? await adapter.mirrorPlanning({ config })
        : { gates: { beforeMirror: [], afterMirror: [] }, drafts: [] };
      return {
        gates: {
          beforeMirror: [...localGates, ...mirror.gates.beforeMirror],
          afterMirror: mirror.gates.afterMirror,
        },
        drafts: mirror.drafts,
        publication,
        mergePolicy,
        cleanup: {
          worktrees: [config.worktree, config.reviewWorktree],
          branch: publication.sourceBranch,
        },
      };
    },
  };
}

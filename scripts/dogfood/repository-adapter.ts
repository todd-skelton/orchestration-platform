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

export interface RepositoryAdapter {
  selectCandidates(input: {
    repository: string;
    planning: unknown;
    board: unknown;
  }): Promise<RepositoryCandidate[]> | RepositoryCandidate[];
  branchName(input: { key: string; attempt: number }): Promise<string> | string;
  pullRequest(input: {
    config: DeliveryConfig;
    gitExecutable: string;
  }): Promise<PublicationPlan> | PublicationPlan;
  requiredChecks(input: { repository: string }): Promise<string[]> | string[];
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
      "branchName",
      "pullRequest",
      "requiredChecks",
      "mergeMethod",
      "afterMerge",
    ].some((name) => typeof (value as Record<string, unknown>)[name] !== "function") ||
    (Object.hasOwn(value, "mirrorPlanning") &&
      typeof (value as Record<string, unknown>).mirrorPlanning !== "function")
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
      const mirror = adapter.mirrorPlanning
        ? await adapter.mirrorPlanning({ config })
        : { gates: { beforeMirror: [], afterMirror: [] }, drafts: [] };
      return {
        gates: mirror.gates,
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

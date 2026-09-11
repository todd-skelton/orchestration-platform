import type { DeliveryConfig, DeliveryPlan } from "../scripts/dogfood/delivery.js";
import type { RepositoryAdapter } from "../scripts/dogfood/repository-adapter.js";

export const selectCandidates: RepositoryAdapter["selectCandidates"];
export const branchName: RepositoryAdapter["branchName"];
export const pullRequest: RepositoryAdapter["pullRequest"];
export const requiredChecks: RepositoryAdapter["requiredChecks"];
export const mergeMethod: RepositoryAdapter["mergeMethod"];
export const afterMerge: RepositoryAdapter["afterMerge"];
export const mirrorPlanning: NonNullable<RepositoryAdapter["mirrorPlanning"]>;
export function candidateLineChanges(
  config: DeliveryConfig,
  gitExecutable: string,
): Promise<{
  total: { added: number; deleted: number };
  scripts: { added: number; deleted: number };
  test: { added: number; deleted: number };
}>;
export function selfPlanFromSnapshots(
  config: DeliveryConfig,
  planning: unknown,
  board: unknown,
  lineChanges: Awaited<ReturnType<typeof candidateLineChanges>>,
): DeliveryPlan;

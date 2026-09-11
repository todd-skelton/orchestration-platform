import type { RepositoryAdapter } from "../scripts/dogfood/repository-adapter.js";

export const selectCandidates: RepositoryAdapter["selectCandidates"];
export const issueContext: RepositoryAdapter["issueContext"];
export const branchName: RepositoryAdapter["branchName"];
export const pullRequest: RepositoryAdapter["pullRequest"];
export const requiredChecks: RepositoryAdapter["requiredChecks"];
export const localGates: NonNullable<RepositoryAdapter["localGates"]>;
export const mergeMethod: RepositoryAdapter["mergeMethod"];
export const afterMerge: RepositoryAdapter["afterMerge"];
export function dryRun(executorRoot?: string): Promise<{
  milestone: { id: string; number: number; title: string };
  issue: { key: string; number: number; title: string };
  branch: string;
  pullRequestTitle: string;
}>;

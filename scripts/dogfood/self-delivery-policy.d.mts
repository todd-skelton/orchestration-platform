import type { DeliveryConfig, DeliveryPlan, DeliveryPolicyAdapter } from "./delivery.mjs";

export interface LineChanges {
  total: { added: number; deleted: number };
  scripts: { added: number; deleted: number };
  test: { added: number; deleted: number };
}

export function candidateLineChanges(
  config: DeliveryConfig,
  gitExecutable: string,
): Promise<LineChanges>;

export function selfPlanFromSnapshots(
  config: DeliveryConfig,
  planning: unknown,
  board: unknown,
  lineChanges: LineChanges,
): DeliveryPlan;
export function selfDeliveryPolicy(gitExecutable?: string): DeliveryPolicyAdapter;

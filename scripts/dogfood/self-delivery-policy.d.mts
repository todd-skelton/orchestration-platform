import type { DeliveryConfig, DeliveryPlan, DeliveryPolicyAdapter } from "./delivery.mjs";

export function selfPlanFromSnapshots(
  config: DeliveryConfig,
  planning: unknown,
  board: unknown,
): DeliveryPlan;
export function selfDeliveryPolicy(): DeliveryPolicyAdapter;

import type { DeliveryAdapter, DeliveryConfig } from "./delivery.mjs";

export function assertControllerExecutor(
  config: DeliveryConfig,
  executingRoot: string,
): Promise<void>;

export function githubDeliveryAdapter(): DeliveryAdapter;

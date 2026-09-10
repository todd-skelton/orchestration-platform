import type { DeliveryAdapter, DeliveryConfig } from "./delivery.mjs";

export interface GithubDeliveryCommands {
  gh(config: DeliveryConfig, args: string[]): Promise<string>;
  ghJson(config: DeliveryConfig, args: string[]): Promise<unknown>;
}

export function assertControllerExecutor(
  config: DeliveryConfig,
  executingRoot: string,
  gitExecutable?: string,
): Promise<void>;

export function githubDeliveryAdapter(
  commands?: GithubDeliveryCommands,
  gitExecutable?: string,
): DeliveryAdapter;

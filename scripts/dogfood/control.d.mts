import type { observeSupervisor } from "./status.mjs";
export function controlLoop(
  configPath: string,
  action: string,
  observe?: typeof observeSupervisor,
): Promise<any>;

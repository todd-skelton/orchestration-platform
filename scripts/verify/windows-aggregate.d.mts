export const shards: Record<string, string>;
export function aggregate(options?: {
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  log?: (message: string) => void;
  pause?: (ms: number) => Promise<void>;
}): Promise<number>;

export type Shard = "refresh" | "queue" | "remainder";
export function parseShard(args: string[]): Shard | undefined;
export function partition(files: string[]): Record<Shard, string[]>;
export function validatePartition(full: string[], shards: Record<Shard, string[]>): void;
export function validateSelection(expected: string[], actual: string[]): void;
export function run(executable: string, args: string[], options?: { cwd?: string }): Promise<void>;
export function discover(filters?: string[], cwd?: string): Promise<string[]>;
export function bootstrap(
  args: string[],
  options?: {
    execute?: (executable: string, args: string[]) => Promise<unknown>;
    sourceStatus?: () => Promise<string>;
    list?: (filters?: string[]) => Promise<string[]>;
    launcher?: { executable: string; prefixArgs: string[] };
  },
): Promise<void>;

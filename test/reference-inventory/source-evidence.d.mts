export interface LiveSourceOptions {
  repository: string;
  commit: string;
  subtree: string;
}

export declare function extractSourceEvidence(options: LiveSourceOptions): Promise<unknown>;
export declare function parseLiveArguments(argv: string[]): LiveSourceOptions | undefined;

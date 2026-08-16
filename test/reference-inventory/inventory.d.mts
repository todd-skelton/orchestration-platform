export interface InventorySummary {
  artifactCount: number;
  entrypointCount: number;
  effectCandidateCount: number;
  unresolved: number;
}

export declare function loadInventory(root?: string): Promise<unknown>;
export declare function validateInventory(snapshot: unknown): InventorySummary;
export declare function compareLiveSource(
  snapshot: unknown,
  options: { repository: string; commit: string; subtree: string },
): Promise<unknown>;
export declare function runInventoryCli(argv: string[], root?: string): Promise<void>;

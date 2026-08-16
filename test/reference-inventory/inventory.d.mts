export interface InventorySummary {
  artifactCount: number;
  entrypointCount: number;
  effectCandidateCount: number;
  mutationGroupCount: number;
  sourcePathCount: number;
  unresolved: number;
}

export declare function loadInventory(root?: string): Promise<unknown>;
export declare function validateInventory(snapshot: unknown): InventorySummary;
export declare function compareLiveSource(
  snapshot: unknown,
  options: { repository: string; commit: string; subtree: string },
): Promise<unknown>;
export declare function runInventoryCli(argv: string[], root?: string): Promise<void>;
export declare const inventoryTestApi: Readonly<{
  aggregateRows(domain: string, rows: unknown[]): string;
  artifactSemanticEvidence(row: any): unknown;
  callsiteEvidence(row: any): unknown;
  entrypointEvidence(row: any): unknown;
  semanticCallsite(row: any, artifact: any): unknown;
}>;

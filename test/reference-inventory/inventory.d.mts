export interface InventorySummary {
  artifactCount: number;
  entrypointCount: number;
  effectCandidateCount: number;
  mutationGroupCount: number;
  sourcePathCount: number;
  sensitiveComponentCount: number;
  sensitiveTokenCount: number;
  unresolved: number;
}

export declare function loadInventory(root?: string): Promise<unknown>;
export declare function validateInventory(snapshot: unknown): InventorySummary;
export declare function compareLiveSource(
  snapshot: unknown,
  options: { repository: string; commit: string; subtree: string },
): Promise<unknown>;
export declare function buildPublicationFingerprints(snapshot: any): {
  census: any;
  rowDigests: Set<string>;
  chunkDigests: Set<string>;
  valueRowDigests: Set<string>;
  relationshipDigests: Set<string>;
  strongScalarDigests: Set<string>;
  streamRowDigests: Set<string>;
  streamRelationshipDigests: Set<string>;
  streamArities: Set<number>;
};
export declare function publicationStreamFingerprints(values: unknown[]): {
  scalarCount: number;
  streamRowDigest?: string;
  streamRelationshipDigests: string[];
  strongScalarDigests: string[];
};
export declare function publicationValueFingerprints(value: any): {
  valueRowDigest?: string;
  relationshipDigests: string[];
  strongScalarDigests: string[];
};
export declare function runInventoryCli(argv: string[], root?: string): Promise<void>;
export declare const inventoryTestApi: Readonly<{
  aggregateRows(domain: string, rows: unknown[]): string;
  artifactSemanticEvidence(row: any): unknown;
  callsiteEvidence(row: any): unknown;
  entrypointEvidence(row: any): unknown;
  semanticCallsite(row: any, artifact: any): unknown;
  buildPublicationFingerprints(snapshot: any): unknown;
  publicationValueFingerprints(value: any): {
    valueRowDigest?: string;
    relationshipDigests: string[];
    strongScalarDigests: string[];
  };
  publicationStreamFingerprints(values: unknown[]): {
    scalarCount: number;
    streamRowDigest?: string;
    streamRelationshipDigests: string[];
    strongScalarDigests: string[];
  };
}>;

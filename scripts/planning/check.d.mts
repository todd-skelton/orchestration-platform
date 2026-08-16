export interface PlanningSnapshot {
  roadmap: Record<string, any>;
  issueDrafts: Record<string, string>;
  epicDrafts: Record<string, string>;
  rootPackage: Record<string, any>;
  packageManifests: Record<string, Record<string, any>>;
}

export declare function parseFrontmatter(source: string, file: string): Record<string, any>;
export declare function verificationCommands(source: string): string[];
export declare function validatePlanningSnapshot(snapshot: PlanningSnapshot): void;
export declare function loadPlanningSnapshot(root?: string): Promise<PlanningSnapshot>;

export interface PlanningSnapshot {
  roadmap: Record<string, any>;
  issueDrafts: Record<string, string>;
}

export declare const PLANNING_REPOSITORY: string;
export declare function parseFrontmatter(source: string, file: string): Record<string, any>;
export declare function validatePlanningSnapshot(snapshot: PlanningSnapshot): void;
export declare function loadPlanningSnapshot(root?: string): Promise<PlanningSnapshot>;

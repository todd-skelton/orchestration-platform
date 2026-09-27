export interface WorkPreview {
  candidates: { key: string; number: number; url?: string }[];
  outstanding: { key: string; number: number; title?: string; reasons: string[]; url?: string }[];
  scope: unknown;
  planningRevision?: string | null;
}
export function observeSupervisor(
  configPath: string,
  procRoot?: string,
): Promise<{
  status: string;
  pid: number | null;
  diagnostic?: string;
}>;
export function previewWork(loop: unknown): Promise<WorkPreview>;
export function observeStatus(
  configPath: string,
  options?: {
    now?: number;
    supervisor?: typeof observeSupervisor;
    preview?: (loop: any) => Promise<WorkPreview>;
    publication?: (loop: any, publication: any, merge: any) => Promise<any>;
  },
): Promise<any>;
export function formatStatus(value: any): string;

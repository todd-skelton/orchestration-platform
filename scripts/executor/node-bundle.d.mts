export interface NodeBundle {
  version: string;
  archive: string;
  archiveSha256: string;
}
export function verifyNodeBundle(directory: string, bundle: NodeBundle): Promise<NodeBundle>;

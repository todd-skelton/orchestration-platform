export interface PnpmLauncher {
  executable: string;
  prefixArgs: string[];
}

export function resolvePnpmLauncher(npmExecpath?: string): Promise<PnpmLauncher>;

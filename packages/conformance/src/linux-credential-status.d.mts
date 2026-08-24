export interface LinuxCredentialStatusInput {
  readonly effectiveGid: number;
  readonly effectiveUid: number;
  readonly expectedGid: string;
  readonly expectedUid: string;
  readonly groups: readonly number[];
  readonly realGid: number;
  readonly realUid: number;
  readonly statusText: string;
}

export function verifyLinuxCredentialStatus(input: unknown): boolean;

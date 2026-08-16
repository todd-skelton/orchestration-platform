export declare function runRedaction(
  root?: string,
  live?: { repository: string; commit: string; subtree: string },
): Promise<unknown>;
export declare function runRedactionCli(argv: string[], root?: string): Promise<void>;

export declare const redactionTestApi: Readonly<{
  copiedSourceBytes(sourceTexts: string[], targetTexts: string[]): boolean;
  forbiddenDigest(value: string): string;
  textFindings(value: string, forbiddenDigests: Set<string>): string[];
  tokenCandidates(value: string): Set<string>;
  validatePackedFile(path: string, bytes: Buffer, forbiddenDigests: Set<string>): void;
}>;

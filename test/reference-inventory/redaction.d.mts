export declare function runRedaction(
  root?: string,
  live?: { repository: string; commit: string; subtree: string },
): Promise<unknown>;
export declare function runRedactionCli(argv: string[], root?: string): Promise<void>;

export declare const redactionTestApi: Readonly<{
  buildPathOracle(snapshot: any): any;
  buildPublicationOracle(snapshot: any): any;
  containsInventoryMaterial(value: string | Buffer, publicationOracle?: any): boolean;
  copiedSourceBytes(sourceTexts: string[], targetTexts: string[]): boolean;
  forbiddenDigest(value: string): string;
  pathDigest(domain: string, value: string): string;
  textFindings(value: string, forbiddenDigests: Set<string>, pathOracle?: any): string[];
  tokenCandidates(value: string): Set<string>;
  validatePackedFile(
    path: string,
    bytes: Buffer,
    forbiddenDigests: Set<string>,
    pathOracle?: any,
    publicationOracle?: any,
  ): void;
  validateBuiltText(
    text: string,
    forbiddenDigests: Set<string>,
    pathOracle?: any,
    artifactDigests?: string[],
    publicationOracle?: any,
  ): void;
}>;

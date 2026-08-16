export declare const packageContract: readonly (readonly [
  string,
  string,
  string,
  readonly string[],
])[];
export declare function loadBootstrapSnapshot(root?: string): Promise<any>;
export declare function validateBootstrapSnapshot(snapshot: any): Promise<void>;

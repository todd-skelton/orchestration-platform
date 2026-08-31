export interface NativeLockBuildFile {
  path: string;
  byteLength: string;
  sha256: string;
}
export interface NativeLockBuildNode {
  executablePath: string;
  version: string;
  modules: string;
  napi: string;
  architecture: string;
  platform: string;
}
export interface NativeLockBuildRequest {
  runnerTemp: string;
  artifactRoot: string;
  stableRoot: string;
  candidateRoot: string;
  stableRevision: string;
  candidateRevision: string;
  node: NativeLockBuildNode & { byteLength: string; sha256: string };
  stableSource: NativeLockBuildFile;
  candidateSource: NativeLockBuildFile;
  /** Complete reviewed build/fixture/loader census, with paths relative to stableRoot. */
  stableFiles: NativeLockBuildFile[];
  distribution: {
    archive: NativeLockBuildFile;
    shasums: NativeLockBuildFile;
    includeRoot: string;
    /** Complete extracted includeRoot census, with paths relative to includeRoot. */
    headers: NativeLockBuildFile[];
    importLibrary: NativeLockBuildFile | null;
  };
  /** Stable-host captured values only; null means an unavailable hosted prerequisite. */
  toolchain: {
    /** Canonical resolved hosted cc (Linux), clang (macOS), or cl.exe (Windows). */
    compilerPath: string;
    compilerVersion: string;
    sdkVersion: string;
    path: string[];
    include: string[];
    lib: string[];
    sdkRoot: string | null;
    systemRoot: string | null;
  } | null;
}
export interface NativeLockPreparedBuild {
  role: "STABLE_WITNESS" | "CANDIDATE_BINDING";
  revision: string;
  inputs: NativeLockBuildFile[] | null;
  argv: string[] | null;
  toolchain: { compilerPath: string; compilerVersion: string; sdkVersion: string } | null;
  outputs: NativeLockBuildFile[] | null;
  /** Always null here. This helper does not load or validate native behavior/ABI. */
  loaded: null;
  result: "BUILT" | "UNSUPPORTED" | "UNKNOWN";
}
export const nativeLockBuildRequiredInputs: readonly string[];
/** Private preparation result, not a complete diagnostic report or a native-property verdict. */
export function buildNativeLockExperiment(request: NativeLockBuildRequest): Promise<{
  node: Readonly<NativeLockBuildNode>;
  builds: NativeLockPreparedBuild[];
}>;

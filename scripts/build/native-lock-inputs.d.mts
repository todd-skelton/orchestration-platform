import type {
  NativeLockBuildFile,
  NativeLockBuildRequest,
  buildNativeLockExperiment,
} from "./native-lock-experiment.mjs";
import type { NativeLockHeaderCensus } from "./native-lock-headers.mjs";

/** Private stable observation data. Its shape and hashes do not authenticate its producer. */
export type NativeLockToolchainObservation =
  | {
      kind: "COMMAND";
      purpose: "COMPILER" | "SDK";
      executablePath: string;
      /** At most 64 strings of at most 4096 characters; never executed here. */
      argv: string[];
      cwd: string;
      /** Canonical nonnegative decimal <= 2147483647, or null when unavailable. */
      exitCode: string | null;
      /** Actual OS signal name or null; never present alongside an exit code. */
      signal: NodeJS.Signals | null;
      /** Only ENOENT/EACCES/EPERM may establish observed unavailability. */
      errorCode: string | null;
      /** Raw retained files relative to the capture record's directory, <= 8 MiB each. */
      stdout: NativeLockBuildFile;
      stderr: NativeLockBuildFile;
    }
  | {
      kind: "LOOKUP";
      purpose: "COMPILER" | "SDK";
      searchDirectories: string[];
      selectedPath: string | null;
      errorCode: string | null;
    };
export interface NativeLockToolchainCapture {
  platform: string;
  architecture: string;
  nodeVersion: string;
  state: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  toolchain: NativeLockBuildRequest["toolchain"];
  /**
   * At most two ordered observations, with unique COMPILER/SDK purposes.
   * AVAILABLE requires a successful retained COMPILER COMMAND tied to compilerPath;
   * LOOKUP cannot supply compiler-version evidence. Failed LOOKUP may prove absence.
   */
  observations: NativeLockToolchainObservation[];
}
export interface NativeLockInputRequest {
  /** Existing exclusive canonical directory outside both complete source roots. */
  runnerTemp: string;
  /** Authenticated by stable caller separately, never authenticated by these strings. */
  stableRevision: string;
  candidateRevision: string;
  /** Still-live root from the outer authenticated candidate consume callback. */
  candidateRoot: string;
  candidateFile: {
    path: "probes/portable-primitives/native/native-lock-candidate.c";
    byteLength: string;
    sha256Digest: string;
    executable: boolean;
  };
  /** Official exact-version provenance is an acquisition-step precondition. */
  distribution: {
    archivePath: string;
    shasumsPath: string;
    importLibraryPath: string | null;
  };
  /** Canonical JSON record path, <= 1 MiB. Null is missing evidence and refuses. */
  toolchainCapture: string | null;
}
export interface NativeLockPendingPreparation {
  /** Never accepted until the enclosing authenticated consume/delete returns ok:true. */
  status: "PENDING_CANDIDATE_CONSUME";
  buildRoot: string;
  /** Helper input/output paths remain buildRoot-relative, without silent rebasing. */
  buildPathPrefix: "build/";
  helper: Awaited<ReturnType<typeof buildNativeLockExperiment>>;
  extraction: NativeLockHeaderCensus;
  capture: NativeLockToolchainCapture;
  stableFiles: NativeLockBuildFile[];
  candidateFile: NativeLockInputRequest["candidateFile"];
  /** Sorted runnerTemp-relative actual retained bytes; no self-hashed census file. */
  retainedFiles: NativeLockBuildFile[];
}
/**
 * Uses exact enumerable data descriptors; proxies/accessors/extras refuse.
 * Requires protected executing bundle, stable acquisition/capture producer and
 * authenticated candidate caller. Returns pending private data, never authority.
 * Throws on malformed/unknown evidence or custody/cleanup failure; post-creation
 * errors preserve cause(s), conservative residualPaths and any helper result.
 * No addon loading, native case, acquisition/discovery or outer deletion here.
 */
export function prepareNativeLockBuild(
  input: NativeLockInputRequest,
): Promise<NativeLockPendingPreparation>;

import type {
  NativeLockHeaderDistribution,
  NativeLockHeaderEntry,
} from "./native-lock-distribution.mjs";
import type { NativeLockBuildFile } from "./native-lock-experiment.mjs";

export interface NativeLockHeaderMaterializationRequest {
  /** Actual retained archive bytes; parsed caller entries are never accepted. */
  archiveBytes: Uint8Array;
  /** Caller must bind this exact version to the stable process separately. */
  exactNodeVersion: string;
  runnerTemp: string;
  /** Absent immediate child of canonical runnerTemp, outside both source roots. */
  headerRoot: string;
  stableRoot: string;
  candidateRoot: string;
}
type ClassifiedEntry<T> = T extends NativeLockHeaderEntry ? Omit<T, "bytes"> : never;
export type NativeLockHeaderCensus = Readonly<{
  distribution: Readonly<
    Omit<NativeLockHeaderDistribution, "entries"> & {
      entries: readonly ClassifiedEntry<NativeLockHeaderEntry>[];
    }
  >;
  /** Complete include-relative file census, including configuration payloads. */
  headers: readonly Readonly<NativeLockBuildFile>[];
}>;
export type NativeLockHeaderMaterialization = NativeLockHeaderCensus &
  Readonly<{
    headerRoot: string;
    includeRoot: string;
    /** Full bounded readback against private payload/identity snapshots; failure poisons reuse. */
    revalidate(): Promise<NativeLockHeaderCensus>;
    /** Only removes unchanged owned entries; changed custody or extra contents refuse cleanup. */
    dispose(): Promise<void>;
  }>;
/** Private data preparation only; no provenance, stable authority, build or load attestation. */
export function materializeNativeLockHeaders(
  request: NativeLockHeaderMaterializationRequest,
): Promise<NativeLockHeaderMaterialization>;

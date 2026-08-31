/** Private preparation data; neither provenance nor extraction/build authority. */
export type NativeLockHeaderEntry = Readonly<{
  path: string;
  recordOffset: number;
  byteLength: number;
  sha256: string;
}> &
  (
    | Readonly<{ kind: "DIRECTORY" }>
    | Readonly<{
        kind: "HEADER" | "CONFIGURATION";
        headerPath: string;
        /** Independent mutable copy; coordinator must recheck bytes at use. */
        bytes: Uint8Array;
      }>
  );

export type NativeLockHeaderDistribution = Readonly<{
  version: string;
  archive: Readonly<{ path: string; byteLength: number; sha256: string }>;
  tar: Readonly<{
    byteLength: number;
    sha256: string;
    recordCount: number;
    payloadBytes: number;
    headerBytes: number;
    terminalZeroBytes: number;
  }>;
  entries: readonly NativeLockHeaderEntry[];
  longNames: readonly Readonly<{
    kind: "GNU_LONG_NAME";
    path: string;
    recordOffset: number;
    targetRecordOffset: number;
    byteLength: number;
    sha256: string;
  }>[];
}>;

/** Throws on malformed or unsupported retained data. No filesystem operations. */
export function readNativeLockHeaders(
  archiveBytes: unknown,
  exactNodeVersion: unknown,
): NativeLockHeaderDistribution;

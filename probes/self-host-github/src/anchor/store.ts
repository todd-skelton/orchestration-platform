import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  canonicalBytes,
  computeBootstrapVerifierAnchorDigest,
  isSha256,
  parseBootstrapVerifierAnchor,
  parseCanonicalContractBytes,
  verifierAnchorSchemaVersions,
  type BootstrapVerifierAnchor,
} from "../../../../packages/contracts/src/index.js";

/**
 * Canonical-path custody for the operator-retained anchor.
 *
 * The ledger fixes one location, `<state-root>/bootstrap/verifier-anchor.json`,
 * and states that the value and identity functions "do not construct, read, or
 * write it" (`docs/architecture/contract-decisions.md:7063-7065`); this module
 * is that construct/read/write helper and nothing else. It performs no
 * download, no checksum computation over a real release, no Sigstore/TUF work,
 * and admits no credential. A supplied path that is not the canonical one, a
 * `bootstrap` directory or anchor file that resolves somewhere else, and an
 * anchor whose recomputed identity is not the expected `Danchor` all refuse.
 */
export const verifierAnchorPathSegments = Object.freeze([
  "bootstrap",
  "verifier-anchor.json",
] as const);

type AnchorRefusal = { readonly ok: false; readonly issues: readonly string[] };
export type BootstrapVerifierAnchorFileResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly digest: string;
      readonly path: string;
      readonly value: BootstrapVerifierAnchor;
    }
  | AnchorRefusal;

function refused(...issues: readonly string[]): AnchorRefusal {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function absoluteNormalized(path: string): boolean {
  return isAbsolute(path) && resolve(path) === path;
}

/** Throws rather than guessing: an unusable state root has no canonical path. */
export function canonicalBootstrapVerifierAnchorPath(stateRoot: string): string {
  if (!absoluteNormalized(stateRoot)) throw new TypeError("stateRoot:absolute-normalized-required");
  return resolve(stateRoot, ...verifierAnchorPathSegments);
}

type AnchorLocation = { readonly ok: true; readonly path: string } | AnchorRefusal;

/**
 * Binds the caller-supplied path to the one canonical spelling under the
 * supplied state root, then resolves the real `bootstrap` directory the bytes
 * actually live in. The supplied path is compared in the caller's own namespace
 * so a state root reached through a symlinked parent keeps working; the
 * directory the bytes land in is compared against its own real path so a
 * redirected `bootstrap` cannot move the anchor to a custom root.
 */
async function anchorLocation(
  stateRoot: string,
  anchorPath: string,
  create: boolean,
): Promise<AnchorLocation> {
  if (!absoluteNormalized(stateRoot)) return refused("stateRoot:absolute-normalized-required");
  if (!absoluteNormalized(anchorPath)) return refused("anchorPath:absolute-normalized-required");
  if (anchorPath !== canonicalBootstrapVerifierAnchorPath(stateRoot))
    return refused("anchorPath:canonical-path-required");
  let realStateRoot: string;
  try {
    // `lstat` reports a symlink as a link, never as a directory, so this one
    // check also excludes a state root that is itself a link.
    const identity = await lstat(stateRoot);
    if (!identity.isDirectory()) return refused("stateRoot:directory-required");
    realStateRoot = await realpath(stateRoot);
  } catch {
    return refused("stateRoot:directory-required");
  }
  const directory = resolve(realStateRoot, verifierAnchorPathSegments[0]);
  if (create)
    try {
      await mkdir(directory);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return refused("anchorDirectory:unwritable");
    }
  try {
    // The link case is covered by the directory check above; the real-path
    // comparison additionally covers a directory-typed reparse point, which
    // `lstat` does report as an ordinary directory and which the repository
    // already treats as a distinct fact (`contract-decisions.md:2896`).
    const identity = await lstat(directory);
    if (!identity.isDirectory() || (await realpath(directory)) !== directory)
      return refused("anchorDirectory:custom-root-refused");
  } catch {
    return refused("anchorDirectory:custom-root-refused");
  }
  return { ok: true, path: resolve(directory, verifierAnchorPathSegments[1]) };
}

/**
 * Writes the anchor exactly once. The record is parsed before the filesystem is
 * touched, so a refused anchor creates neither the directory nor the file, and
 * the write is exclusive: replacing or re-timing an existing anchor is an
 * explicit operator removal, never a silent overwrite.
 */
export async function writeBootstrapVerifierAnchorFile(
  stateRoot: string,
  anchorPath: string,
  anchor: unknown,
): Promise<BootstrapVerifierAnchorFileResult> {
  const parsed = parseBootstrapVerifierAnchor(anchor);
  if (!parsed.ok) return refused(...parsed.issues);
  const location = await anchorLocation(stateRoot, anchorPath, true);
  if (!location.ok) return location;
  try {
    const identity = await lstat(location.path);
    return refused(
      identity.isSymbolicLink() ? "anchorFile:custom-root-refused" : "anchorFile:already-exists",
    );
  } catch {
    // Absent is the only accepted state; every other outcome refused above.
  }
  const bytes = canonicalBytes(parsed.value);
  try {
    await writeFile(location.path, bytes, { flag: "wx" });
  } catch (error) {
    return refused(
      errorCode(error) === "EEXIST" ? "anchorFile:already-exists" : "anchorFile:unwritable",
    );
  }
  return {
    ok: true,
    bytes,
    digest: computeBootstrapVerifierAnchorDigest(parsed.value),
    path: location.path,
    value: parsed.value,
  };
}

/**
 * Reads the anchor and binds it to the identity the caller already holds. The
 * expected digest is required: a reader with nothing to compare against cannot
 * distinguish the operator's anchor from a consistently substituted one, and
 * this helper refuses rather than reporting an unbound value.
 */
export async function readBootstrapVerifierAnchorFile(
  stateRoot: string,
  anchorPath: string,
  expectedDigest: string,
): Promise<BootstrapVerifierAnchorFileResult> {
  if (!isSha256(expectedDigest) || expectedDigest.length !== 64)
    return refused("expectedDigest:invalid");
  const location = await anchorLocation(stateRoot, anchorPath, false);
  if (!location.ok) return location;
  let bytes: Uint8Array;
  try {
    const identity = await lstat(location.path);
    if (identity.isSymbolicLink()) return refused("anchorFile:custom-root-refused");
    if (!identity.isFile()) return refused("anchorFile:unreadable");
    bytes = await readFile(location.path);
  } catch {
    return refused("anchorFile:unreadable");
  }
  // The registry entry owns the encoding grammar and the family validation; the
  // family parser is re-applied only to narrow the record to its own type,
  // rather than casting a whole tree across the boundary.
  const encoded = parseCanonicalContractBytes(verifierAnchorSchemaVersions[0], bytes);
  if (!encoded.ok) return refused(...encoded.issues);
  const parsed = parseBootstrapVerifierAnchor(encoded.value);
  if (!parsed.ok) return refused(...parsed.issues);
  const digest = computeBootstrapVerifierAnchorDigest(parsed.value);
  if (digest !== expectedDigest) return refused("anchor:digest-mismatch");
  return { ok: true, bytes, digest, path: location.path, value: parsed.value };
}

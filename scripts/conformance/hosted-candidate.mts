import type { BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  computeConformanceRecordDigest,
  parseConformanceCandidateSubject,
  sha256Bytes,
} from "../../packages/conformance/src/index.js";
import type { HostedCandidateSnapshot } from "./hosted-plan.mjs";

export type HostedCandidateSourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export type HostedCandidateSourceConsumer<T> = (
  sourceRoot: string,
  candidateSubject: unknown,
) => Promise<T>;

function refusal<T>(...issues: readonly string[]): HostedCandidateSourceResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function verifiedSnapshot(input: HostedCandidateSnapshot): HostedCandidateSnapshot | undefined {
  try {
    const subject = parseConformanceCandidateSubject(input.subject);
    if (!subject.ok) return undefined;
    if (
      computeConformanceRecordDigest("conformance-candidate-subject/v1", subject.value) !==
      input.digest
    )
      return undefined;
    const rows = subject.value.files as readonly Readonly<Record<string, unknown>>[];
    if (
      !Array.isArray(input.files) ||
      Object.getPrototypeOf(input.files) !== Array.prototype ||
      input.files.length !== rows.length
    )
      return undefined;
    const files: HostedCandidateSnapshot["files"][number][] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const source = input.files[index];
      const row = rows[index]!;
      if (
        !source ||
        source.path !== row.path ||
        source.executable !== row.executable ||
        !(source.bytes instanceof Uint8Array) ||
        Object.getPrototypeOf(source.bytes) !== Uint8Array.prototype ||
        String(source.bytes.byteLength) !== row.byteLength ||
        sha256Bytes(source.bytes) !== row.sha256Digest
      )
        return undefined;
      files.push(
        Object.freeze({
          bytes: Uint8Array.from(source.bytes),
          executable: source.executable,
          path: source.path,
        }),
      );
    }
    return Object.freeze({
      digest: input.digest,
      files: Object.freeze(files),
      subject: subject.value,
    });
  } catch {
    return undefined;
  }
}

export async function withHostedCandidateSource<T>(
  snapshotInput: HostedCandidateSnapshot,
  externalParentInput: string,
  stableRootInput: string,
  consume: HostedCandidateSourceConsumer<T>,
): Promise<HostedCandidateSourceResult<T>> {
  let sourceRoot: string | undefined;
  let sourceIdentity: BigIntStats | undefined;
  let result: HostedCandidateSourceResult<T> = refusal("candidate-source:preparation-refused");
  try {
    const snapshot = verifiedSnapshot(snapshotInput);
    if (
      !snapshot ||
      typeof externalParentInput !== "string" ||
      typeof stableRootInput !== "string" ||
      !isAbsolute(externalParentInput) ||
      !isAbsolute(stableRootInput) ||
      typeof consume !== "function"
    )
      return refusal("candidate-source:input-refused");
    const [parentIdentity, stableIdentity, externalParent, stableRoot] = await Promise.all([
      lstat(externalParentInput, { bigint: true }),
      lstat(stableRootInput, { bigint: true }),
      realpath(externalParentInput),
      realpath(stableRootInput),
    ]);
    if (
      !parentIdentity.isDirectory() ||
      parentIdentity.isSymbolicLink() ||
      !stableIdentity.isDirectory() ||
      stableIdentity.isSymbolicLink() ||
      within(stableRoot, externalParent) ||
      within(externalParent, stableRoot)
    )
      return refusal("candidate-source:separate-regular-parent-required");
    sourceRoot = await mkdtemp(resolve(externalParent, "orchestration-hosted-candidate-"));
    const createdIdentity = await lstat(sourceRoot, { bigint: true });
    if (!createdIdentity.isDirectory() || createdIdentity.isSymbolicLink())
      throw new TypeError("candidate-source:root-refused");
    for (const file of snapshot.files) {
      const destination = resolve(sourceRoot, ...file.path.split("/"));
      if (!within(sourceRoot, destination) || destination === sourceRoot)
        throw new TypeError("candidate-source:path-refused");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes, {
        flag: "wx",
        mode: file.executable ? 0o755 : 0o644,
      });
      const readBack = Uint8Array.from(await readFile(destination));
      if (
        readBack.byteLength !== file.bytes.byteLength ||
        sha256Bytes(readBack) !== sha256Bytes(file.bytes)
      )
        throw new TypeError("candidate-source:write-readback-mismatch");
    }
    sourceIdentity = await lstat(sourceRoot, { bigint: true });
    if (!sourceIdentity.isDirectory() || sourceIdentity.isSymbolicLink())
      throw new TypeError("candidate-source:root-moved-during-construction");
    try {
      result = { ok: true, value: await consume(sourceRoot, snapshot.subject) };
    } catch {
      result = refusal("candidate-source:consumer-failed");
    }
  } catch {
    result = refusal("candidate-source:preparation-refused");
  }
  if (sourceRoot && sourceIdentity)
    try {
      const current = await lstat(sourceRoot, { bigint: true });
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameIdentity(sourceIdentity, current)
      )
        return refusal("candidate-source:cleanup-ancestor-refused");
      await rm(sourceRoot, { recursive: true });
    } catch {
      return refusal("candidate-source:cleanup-refused");
    }
  return result;
}

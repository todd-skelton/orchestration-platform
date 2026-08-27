import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ContractRecord } from "@orchestration-platform/contracts";
import { parseConformanceCandidateSubject } from "./contracts.js";
import { readConformanceBundleFile } from "./manifest.js";

export type CandidateMaterializationResult =
  | { readonly ok: true; readonly subject: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

export type StableCandidateConsumer = (
  materializedRoot: string,
  subject: ContractRecord,
) => Promise<void>;

function refusal(...issues: readonly string[]): CandidateMaterializationResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function utf8Order(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function regularDirectoryIdentity(path: string): Promise<BigIntStats> {
  const identity = await lstat(path, { bigint: true });
  if (!identity.isDirectory() || identity.isSymbolicLink())
    throw new TypeError("candidate-root:regular-directory-required");
  return identity;
}

async function requireUnchangedDirectory(path: string, expected: BigIntStats): Promise<void> {
  if (!sameIdentity(await regularDirectoryIdentity(path), expected))
    throw new TypeError("candidate-root:directory-moved");
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new TypeError("candidate-root:cleanup-residue");
}

async function regularFileCensus(root: string): Promise<readonly string[]> {
  await regularDirectoryIdentity(root);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new TypeError("candidate-root:nonregular-entry-refused");
    if (!entry.isFile()) continue;
    const path = relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/");
    files.push(path);
    if (files.length > 65_536) throw new TypeError("candidate-root:file-limit-exceeded");
  }
  return Object.freeze(files.sort(utf8Order));
}

async function verifyMaterializedFiles(
  root: string,
  expectedFiles: readonly ContractRecord[],
  expectedPaths: readonly string[],
): Promise<void> {
  const paths = await regularFileCensus(root);
  if (
    paths.length !== expectedPaths.length ||
    paths.some((path, index) => path !== expectedPaths[index])
  )
    throw new TypeError("candidate-root:materialized-census-mismatch");
  for (let index = 0; index < expectedFiles.length; index += 1) {
    const expected = expectedFiles[index]!;
    const observed = await readConformanceBundleFile(root, expectedPaths[index]!);
    for (const field of ["byteLength", "path", "sha256Digest"] as const)
      if (observed.row[field] !== expected[field])
        throw new TypeError(`candidate-root:materialized-${field}-mismatch`);
  }
}

async function removeMaterializedRoot(
  materializedRoot: string,
  outputParent: string,
  outputIdentity: BigIntStats,
  materializedIdentity: BigIntStats,
  writtenFiles: readonly string[],
  createdDirectories: readonly string[],
): Promise<boolean> {
  try {
    await requireUnchangedDirectory(outputParent, outputIdentity);
    await requireUnchangedDirectory(materializedRoot, materializedIdentity);
    for (const path of [...writtenFiles].reverse()) await rm(path, { force: true });
    for (const path of [...createdDirectories].reverse()) await rmdir(path);
    await rmdir(materializedRoot);
    await requireUnchangedDirectory(outputParent, outputIdentity);
    for (const path of writtenFiles) await requireAbsent(path);
    for (const path of createdDirectories) await requireAbsent(path);
    await requireAbsent(materializedRoot);
    return true;
  } catch {
    return false;
  }
}

export async function consumeConformanceCandidateMaterialization(
  sourceRootInput: string,
  outputParentInput: string,
  subjectInput: unknown,
  consume: StableCandidateConsumer,
): Promise<CandidateMaterializationResult> {
  let materializedRoot: string | undefined;
  let realOutputParent: string | undefined;
  let outputIdentity: BigIntStats | undefined;
  let materializedIdentity: BigIntStats | undefined;
  const writtenFiles: string[] = [];
  const createdDirectories: string[] = [];
  try {
    const subject = parseConformanceCandidateSubject(subjectInput);
    if (!subject.ok) return refusal(...subject.issues);
    if (typeof consume !== "function") return refusal("candidate-root:stable-consumer-required");
    const sourceRoot = resolve(sourceRootInput);
    const outputParent = resolve(outputParentInput);
    const [sourceIdentity, observedOutputIdentity, realSourceRoot, observedRealOutputParent] =
      await Promise.all([
        regularDirectoryIdentity(sourceRoot),
        regularDirectoryIdentity(outputParent),
        realpath(sourceRoot),
        realpath(outputParent),
      ]);
    realOutputParent = observedRealOutputParent;
    outputIdentity = observedOutputIdentity;
    if (within(realSourceRoot, realOutputParent) || within(realOutputParent, realSourceRoot))
      return refusal("candidate-root:separate-regular-roots-required");
    const expectedFiles = subject.value.files as readonly ContractRecord[];
    const expectedPaths = expectedFiles.map((row) => String(row.path));
    const sourcePaths = await regularFileCensus(realSourceRoot);
    if (
      sourcePaths.length !== expectedPaths.length ||
      sourcePaths.some((path, index) => path !== expectedPaths[index])
    )
      return refusal("candidate-root:path-census-mismatch");
    await requireUnchangedDirectory(realSourceRoot, sourceIdentity);
    await requireUnchangedDirectory(realOutputParent, outputIdentity);
    materializedRoot = await mkdtemp(resolve(realOutputParent, "orchestration-candidate-"));
    if (!within(realOutputParent, await realpath(materializedRoot)))
      throw new TypeError("candidate-root:output-escaped");
    materializedIdentity = await regularDirectoryIdentity(materializedRoot);
    const created = new Set<string>();
    for (let index = 0; index < expectedFiles.length; index += 1) {
      await requireUnchangedDirectory(realOutputParent, outputIdentity);
      await requireUnchangedDirectory(materializedRoot, materializedIdentity);
      const expected = expectedFiles[index]!;
      const path = expectedPaths[index]!;
      const observed = await readConformanceBundleFile(realSourceRoot, path);
      for (const field of ["byteLength", "path", "sha256Digest"] as const)
        if (observed.row[field] !== expected[field])
          throw new TypeError(`candidate-root:source-${field}-mismatch`);
      const components = path.split("/");
      for (let depth = 1; depth < components.length; depth += 1) {
        const directory = resolve(materializedRoot, ...components.slice(0, depth));
        if (created.has(directory)) continue;
        await mkdir(directory);
        created.add(directory);
        createdDirectories.push(directory);
      }
      const destination = resolve(materializedRoot, ...components);
      writtenFiles.push(destination);
      await writeFile(destination, observed.bytes, {
        flag:
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        mode: expected.executable === true ? 0o755 : 0o644,
      });
    }
    await requireUnchangedDirectory(realOutputParent, outputIdentity);
    await requireUnchangedDirectory(materializedRoot, materializedIdentity);
    await verifyMaterializedFiles(materializedRoot, expectedFiles, expectedPaths);
    await consume(materializedRoot, subject.value);
    await requireUnchangedDirectory(realOutputParent, outputIdentity);
    await requireUnchangedDirectory(materializedRoot, materializedIdentity);
    await verifyMaterializedFiles(materializedRoot, expectedFiles, expectedPaths);
    const removed = await removeMaterializedRoot(
      materializedRoot,
      realOutputParent,
      outputIdentity,
      materializedIdentity,
      writtenFiles,
      createdDirectories,
    );
    materializedRoot = undefined;
    if (!removed) return refusal("candidate-root:cleanup-refused");
    return { ok: true, subject: subject.value };
  } catch {
    if (materializedRoot && realOutputParent && outputIdentity && materializedIdentity) {
      const removed = await removeMaterializedRoot(
        materializedRoot,
        realOutputParent,
        outputIdentity,
        materializedIdentity,
        writtenFiles,
        createdDirectories,
      );
      if (!removed) return refusal("candidate-root:cleanup-refused");
    } else if (materializedRoot && realOutputParent && outputIdentity) {
      try {
        await requireUnchangedDirectory(realOutputParent, outputIdentity);
        await rmdir(materializedRoot);
      } catch {
        return refusal("candidate-root:cleanup-refused");
      }
    }
    return refusal("candidate-root:unreadable-or-moved");
  }
}

import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { types as nodeTypes } from "node:util";
import { isContractRelativePath, type ContractRecord } from "@orchestration-platform/contracts";
import { parseConformanceBundleManifest, sha256Bytes } from "./contracts.js";

export type ConformanceBundleManifestResult =
  | { readonly ok: true; readonly value: ContractRecord }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): ConformanceBundleManifestResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function below(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`);
}

function utf8Order(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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

async function directoryChain(root: string, components: readonly string[]): Promise<BigIntStats[]> {
  const directories = [root];
  for (let index = 1; index < components.length; index += 1)
    directories.push(resolve(root, ...components.slice(0, index)));
  const identities: BigIntStats[] = [];
  for (const directory of directories) {
    const identity = await lstat(directory, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink())
      throw new TypeError("path:regular-directory-chain-required");
    identities.push(identity);
  }
  return identities;
}

function detachedPaths(input: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length === 0 ||
    input.length > 4096
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const expected = new Set([
    ...Array.from({ length: input.length }, (_, index) => String(index)),
    "length",
  ]);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).some((key) => !expected.has(key)) ||
    keys.length !== expected.size
  )
    return undefined;
  const values: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    )
      return undefined;
    values.push(descriptor.value);
  }
  return values;
}

async function fileRow(root: string, path: string): Promise<ContractRecord> {
  if (!isContractRelativePath(path)) throw new TypeError("path:invalid");
  const components = path.split("/");
  const absolute = resolve(root, ...components);
  if (!below(root, absolute)) throw new TypeError("path:outside-root");
  const directoriesBefore = await directoryChain(root, components);
  const pathBefore = await lstat(absolute, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink())
    throw new TypeError("path:regular-file-required");
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(absolute, constants.O_RDONLY | noFollow);
  let bytes: Uint8Array;
  try {
    const handleBefore = await handle.stat({ bigint: true });
    if (!handleBefore.isFile() || !sameIdentity(pathBefore, handleBefore))
      throw new TypeError("path:moved-before-read");
    bytes = Uint8Array.from(await handle.readFile());
    const handleAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    const directoriesAfter = await directoryChain(root, components);
    if (
      !handleAfter.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameIdentity(handleBefore, handleAfter) ||
      !sameIdentity(handleAfter, pathAfter) ||
      directoriesBefore.length !== directoriesAfter.length ||
      directoriesBefore.some(
        (identity, index) => !sameIdentity(identity, directoriesAfter[index]!),
      ) ||
      BigInt(bytes.byteLength) !== handleAfter.size
    )
      throw new TypeError("path:moved-during-read");
  } finally {
    await handle.close();
  }
  return Object.freeze({
    byteLength: String(bytes.byteLength),
    path,
    sha256Digest: sha256Bytes(bytes),
  });
}

export async function createConformanceBundleManifest(
  rootInput: string,
  pathsInput: readonly string[],
  purpose: "HARNESS" | "TEST_BUNDLE",
): Promise<ConformanceBundleManifestResult> {
  try {
    const root = resolve(rootInput);
    const paths = detachedPaths(pathsInput);
    if (!paths) return refusal("paths:census-refused");
    if (paths.some((path, index) => index > 0 && utf8Order(paths[index - 1]!, path) >= 0))
      return refusal("paths:order-refused");
    const files: ContractRecord[] = [];
    for (const path of paths) files.push(await fileRow(root, path));
    const manifest = Object.freeze({
      files: Object.freeze(files),
      purpose,
      schemaVersion: "conformance-bundle-manifest/v1",
    });
    const parsed = parseConformanceBundleManifest(manifest);
    return parsed.ok ? { ok: true, value: parsed.value } : refusal(...parsed.issues);
  } catch {
    return refusal("manifest:unreadable-or-moved");
  }
}

export async function verifyConformanceBundleManifest(
  root: string,
  manifestInput: unknown,
): Promise<ConformanceBundleManifestResult> {
  const manifest = parseConformanceBundleManifest(manifestInput);
  if (!manifest.ok) return refusal(...manifest.issues);
  const expectedFiles = manifest.value.files as readonly ContractRecord[];
  const observed = await createConformanceBundleManifest(
    root,
    expectedFiles.map((row) => String(row.path)),
    manifest.value.purpose as "HARNESS" | "TEST_BUNDLE",
  );
  if (!observed.ok) return observed;
  const observedFiles = observed.value.files as readonly ContractRecord[];
  for (let index = 0; index < expectedFiles.length; index += 1)
    for (const field of ["byteLength", "path", "sha256Digest"] as const)
      if (expectedFiles[index]?.[field] !== observedFiles[index]?.[field])
        return refusal(`files.${index}.${field}:mismatch`);
  return { ok: true, value: manifest.value };
}

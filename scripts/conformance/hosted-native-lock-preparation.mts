import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
// Narrow import on purpose: this module calls no ISS-022 selection, profile,
// capability or decision writer, and adds no public export or schema.
import { sha256Bytes } from "../../packages/conformance/src/contracts.js";
import type {
  NativeLockBuildFile,
  NativeLockPreparedBuild,
} from "../build/native-lock-experiment.mjs";
import {
  prepareNativeLockBuild,
  type NativeLockInputRequest,
  type NativeLockPendingPreparation,
} from "../build/native-lock-inputs.mjs";
import { withHostedCandidateSource } from "./hosted-candidate.mjs";
import {
  acquireHostedNativeLockInputs,
  type HostedNativeLockAcquisitionBoundary,
} from "./hosted-native-lock-acquisition.mjs";
import { hostedNativeLockAction } from "./hosted-native-lock-plan.mjs";
import type {
  HostedCandidateSnapshot,
  HostedCandidateSourceFile,
  HostedNativeLockPlanContext,
} from "./hosted-plan.mjs";

/**
 * Private hosted native-lock preparation transaction (ISS-048 stage-three
 * sub-slice 3.1). Given an authenticated hosted native-lock plan context and a
 * canonical runner temp it allocates the ledger's three sibling roots, calls
 * the landed acquisition owner, and then, inside the landed authenticated
 * candidate consume/delete window, calls the landed build-inputs preparation.
 *
 * It loads no addon, requires no `.node`, spawns no fixture, runs no case or
 * control, writes no report or archive member, reads no runner token, and calls
 * no provider. A `PENDING_CANDIDATE_CONSUME` preparation is private data, never
 * authority: only a later reviewed collector may accept it.
 *
 * Sub-slice 3.4 adds one bounded completion to this module and nothing else:
 * `completeHostedNativeLockLoadedMembers` fills each build's `loaded` member
 * from the ACTUAL post-load rehash of that role's `.node` output. The pre-load
 * guard `checkPreLoadBuildBinding` is unchanged and still requires every
 * `loaded` member to be null at preparation time, and no completion path may
 * take a `loaded` row from that pre-load hash. That completion still loads no
 * addon here: the load itself happens in the reviewed case-context seam, and
 * this function only rereads and rehashes the bytes afterwards.
 */

/** The one candidate source this transaction may ever compose build inputs for. */
export const hostedNativeLockCandidateSourcePath =
  "probes/portable-primitives/native/native-lock-candidate.c" as const;

/** Fixed leaf names of the ledger's three mutually external runner-temp roots. */
export const hostedNativeLockRootNames = Object.freeze({
  acquisition: "acquisition",
  case: "case",
  preparation: "preparation",
} as const);

const maximumArchiveEntries = 24000;
const maximumArchiveDepth = 24;

export interface HostedNativeLockPreparationRoots {
  /** Owned by the landed acquisition owner; never archived. */
  readonly acquisitionRoot: string;
  /** The archive root; its `build` child is the later case `artifactRoot`. */
  readonly archiveRoot: string;
  readonly artifactRoot: string;
  /** The `runnerTemp` a later slice hands to `createCaseContext`; empty here. */
  readonly caseRoot: string;
  readonly runnerTemp: string;
}

export interface HostedNativeLockPreparationInput {
  /** Authenticated candidate subject and bytes from the landed plan loader. */
  readonly candidate: HostedCandidateSnapshot;
  readonly context: HostedNativeLockPlanContext;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Canonical provider `runner.temp`, outside the stable source root. */
  readonly runnerTemp: string;
  readonly stableRoot: string;
}

export interface HostedNativeLockPreparationBoundary {
  /** The landed acquisition owner; substituted only by synthetic vectors. */
  readonly acquire?: typeof acquireHostedNativeLockInputs;
  /** Passed through unchanged to the acquisition owner. */
  readonly acquisition?: HostedNativeLockAcquisitionBoundary;
}

export type HostedNativeLockArchiveCensusResult =
  | { readonly ok: true; readonly files: readonly NativeLockBuildFile[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export type HostedNativeLockPreparationResult =
  | {
      readonly ok: true;
      readonly state: "AVAILABLE";
      readonly acquisitionFiles: readonly NativeLockBuildFile[];
      readonly archiveFiles: readonly NativeLockBuildFile[];
      readonly preparation: NativeLockPendingPreparation;
      readonly roots: HostedNativeLockPreparationRoots;
    }
  | {
      readonly ok: true;
      readonly state: "UNSUPPORTED" | "UNKNOWN";
      readonly acquisitionFiles: readonly NativeLockBuildFile[];
      readonly reason: string;
      readonly roots: HostedNativeLockPreparationRoots;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function issues(...values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function refusal(...values: readonly string[]): HostedNativeLockPreparationResult {
  return { ok: false, issues: issues(...values) };
}

function canonicalInput(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    isAbsolute(value) &&
    resolve(value) === value
  );
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function overlap(left: string, right: string): boolean {
  return within(left, right) || within(right, left);
}

async function canonicalDirectory(path: string): Promise<boolean> {
  const identity = await lstat(path, { bigint: true });
  return identity.isDirectory() && !identity.isSymbolicLink() && (await realpath(path)) === path;
}

function candidateSourceFiles(
  candidate: HostedCandidateSnapshot,
): readonly HostedCandidateSourceFile[] {
  const files: unknown = candidate?.files;
  return Array.isArray(files) ? (files as readonly HostedCandidateSourceFile[]) : [];
}

function candidateSubjectRow(
  candidate: HostedCandidateSnapshot,
): Readonly<{ byteLength: string; executable: boolean; sha256Digest: string }> | undefined {
  const files: unknown = (candidate as { subject?: { files?: unknown } } | undefined)?.subject
    ?.files;
  if (!Array.isArray(files)) return undefined;
  const rows = (files as readonly unknown[]).filter(
    (value): value is Readonly<Record<string, unknown>> =>
      typeof value === "object" &&
      value !== null &&
      (value as Readonly<Record<string, unknown>>).path === hostedNativeLockCandidateSourcePath,
  );
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    !row ||
    typeof row.byteLength !== "string" ||
    typeof row.executable !== "boolean" ||
    typeof row.sha256Digest !== "string"
  )
    return undefined;
  return Object.freeze({
    byteLength: row.byteLength,
    executable: row.executable,
    sha256Digest: row.sha256Digest,
  });
}

/**
 * Guard that later backs `WRONG_RANGE_OR_FLAGS`. Only the reviewed candidate
 * bytes the authenticated plan context pinned may become the compiled binding,
 * so a self-consistent substituted subject — one that could carry a different
 * lock range or flags — is refused before any build input is composed.
 */
export function checkCandidateSubjectBinding(
  context: HostedNativeLockPlanContext,
  candidate: HostedCandidateSnapshot,
): readonly string[] {
  const found: string[] = [];
  const digest: unknown = (candidate as { digest?: unknown } | undefined)?.digest;
  if (
    typeof digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(digest) ||
    digest !== context?.candidateSubjectDigest
  )
    found.push("native-lock-preparation:candidate-subject-substituted");
  const row = candidateSubjectRow(candidate);
  const file = candidateSourceFiles(candidate).find(
    (value) => value?.path === hostedNativeLockCandidateSourcePath,
  );
  if (
    !row ||
    !file ||
    !(file.bytes instanceof Uint8Array) ||
    file.executable !== row.executable ||
    String(file.bytes.byteLength) !== row.byteLength ||
    sha256Bytes(file.bytes) !== row.sha256Digest
  )
    found.push("native-lock-preparation:candidate-source-row-refused");
  return issues(...found);
}

/**
 * Guard that later backs the pre-load half of `BUILD_OR_LOADER_SUBSTITUTION`.
 * Preparation loads nothing, so every build row's `loaded` member must still be
 * null, and every declared build output must be exactly one retained, hashed
 * row of the builder's own sealed census.
 */
export function checkPreLoadBuildBinding(pending: NativeLockPendingPreparation): readonly string[] {
  const found: string[] = [];
  const retainedInput: unknown = pending?.retainedFiles;
  const retained = Array.isArray(retainedInput)
    ? (retainedInput as readonly NativeLockBuildFile[])
    : [];
  const sealed = new Map(retained.map((row) => [row.path, row] as const));
  const buildsInput: unknown = pending?.helper?.builds;
  const builds = Array.isArray(buildsInput)
    ? (buildsInput as NativeLockPendingPreparation["helper"]["builds"])
    : [];
  const prefix: unknown = pending?.buildPathPrefix;
  if (builds.length !== 2 || prefix !== "build/")
    found.push("native-lock-preparation:build-row-census-refused");
  for (const build of builds) {
    if (build?.loaded !== null) found.push("native-lock-preparation:loaded-before-collection");
    for (const output of build?.outputs ?? []) {
      const row = sealed.get(`${String(prefix)}${output.path}`);
      if (!row || row.byteLength !== output.byteLength || row.sha256 !== output.sha256)
        found.push("native-lock-preparation:build-output-substituted");
    }
  }
  return issues(...found);
}

/** The one `.node` output each build role may load. Never a caller's table. */
export const hostedNativeLockLoadedOutputNames = Object.freeze({
  CANDIDATE_BINDING: "native-lock-candidate.node",
  STABLE_WITNESS: "native-lock-witness.node",
} as const);

export type HostedNativeLockLoadedResult =
  | { readonly ok: true; readonly loaded: readonly (readonly NativeLockBuildFile[] | null)[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Complete each build's `loaded` member from the actual post-load rehash, in
 * the order the builds were given. A role that did not load keeps a null
 * member: null is honest missing evidence, never an invented row, and the
 * builder's own sealed `loaded: null` is never promoted into a completion.
 *
 * The row returned is built from bytes read here, after the load; the declared
 * pre-load output row is only compared against it, so a byte that changed
 * across the load is refused instead of being reported as loaded. This function
 * makes no native call, loads nothing and writes nothing.
 */
export async function completeHostedNativeLockLoadedMembers(
  artifactRoot: string,
  builds: readonly NativeLockPreparedBuild[],
  loadedRoles: readonly string[],
): Promise<HostedNativeLockLoadedResult> {
  try {
    if (!canonicalInput(artifactRoot) || !(await canonicalDirectory(artifactRoot)))
      return { ok: false, issues: issues("native-lock-preparation:artifact-root-refused") };
    const roles = Object.keys(hostedNativeLockLoadedOutputNames);
    if (
      !Array.isArray(builds) ||
      builds.length !== roles.length ||
      !Array.isArray(loadedRoles) ||
      new Set(loadedRoles).size !== loadedRoles.length ||
      loadedRoles.some((role) => !roles.includes(role))
    )
      return { ok: false, issues: issues("native-lock-preparation:loaded-request-refused") };
    const completed: (readonly NativeLockBuildFile[] | null)[] = [];
    const found: string[] = [];
    const rows: readonly NativeLockPreparedBuild[] = builds;
    for (const build of rows) {
      const name = hostedNativeLockLoadedOutputNames[build?.role];
      // The pre-load guard stays: preparation loaded nothing, so the member it
      // sealed must still be null and can never be the source of a completion.
      if (!name || build.loaded !== null) {
        found.push("native-lock-preparation:loaded-request-refused");
        completed.push(null);
        continue;
      }
      if (!loadedRoles.includes(build.role)) {
        completed.push(null);
        continue;
      }
      if (build.result !== "BUILT") {
        found.push("native-lock-preparation:loaded-without-built-row");
        completed.push(null);
        continue;
      }
      const declaredPath = `builds/${build.role}/${name}`;
      const declared = (build.outputs ?? []).filter((row) => row.path === declaredPath);
      const path = resolve(artifactRoot, "builds", build.role, name);
      const marker = await lstat(path, { bigint: true });
      if (declared.length !== 1 || !marker.isFile() || marker.isSymbolicLink()) {
        found.push("native-lock-preparation:loaded-output-refused");
        completed.push(null);
        continue;
      }
      const bytes = Uint8Array.from(await readFile(path));
      const row = Object.freeze({
        byteLength: String(bytes.byteLength),
        path: declaredPath,
        sha256: sha256Bytes(bytes),
      });
      if (row.byteLength !== declared[0]!.byteLength || row.sha256 !== declared[0]!.sha256) {
        found.push("native-lock-preparation:post-load-rehash-mismatch");
        completed.push(null);
        continue;
      }
      completed.push(Object.freeze([row]));
    }
    return found.length > 0
      ? { ok: false, issues: issues(...found) }
      : { ok: true, loaded: Object.freeze(completed) };
  } catch {
    return { ok: false, issues: issues("native-lock-preparation:loaded-unreadable") };
  }
}

/**
 * The census that supersedes the builder's sealed one. No control or case phase
 * has run in this slice, so the archive root's direct children must be exactly
 * `build` and `preparation`, the archive-relative mapping is the identity for
 * both prefixes, and the census must equal the sealed rows with no excess.
 */
export async function censusHostedNativeLockArchive(
  archiveRoot: string,
  sealed: readonly NativeLockBuildFile[],
): Promise<HostedNativeLockArchiveCensusResult> {
  try {
    if (!canonicalInput(archiveRoot) || !(await canonicalDirectory(archiveRoot)))
      return { ok: false, issues: issues("native-lock-preparation:archive-root-refused") };
    const expected = new Map<string, NativeLockBuildFile>();
    for (const row of sealed) {
      if (
        !row ||
        typeof row.path !== "string" ||
        !/^(?:build|preparation)\//.test(row.path) ||
        row.path.split("/").some((part) => !part || part === "." || part === "..") ||
        !/^(?:0|[1-9][0-9]*)$/.test(row.byteLength) ||
        !/^[0-9a-f]{64}$/.test(row.sha256) ||
        expected.has(row.path)
      )
        return { ok: false, issues: issues("native-lock-preparation:sealed-census-refused") };
      expected.set(row.path, row);
    }
    const children = (await readdir(archiveRoot)).sort();
    if (children.join("\0") !== "build\0preparation")
      return { ok: false, issues: issues("native-lock-preparation:archive-children-refused") };
    const observed: NativeLockBuildFile[] = [];
    const seen = new Set<string>();
    let count = 0;
    const visit = async (directory: string, prefix: string, depth: number): Promise<boolean> => {
      if (++count > maximumArchiveEntries || depth > maximumArchiveDepth) return false;
      if (!(await canonicalDirectory(directory))) return false;
      for (const child of await readdir(directory, { withFileTypes: true })) {
        if (++count > maximumArchiveEntries || child.isSymbolicLink()) return false;
        const path = resolve(directory, child.name);
        const name = `${prefix}/${child.name}`;
        if (relative(archiveRoot, path).split(sep).join("/") !== name) return false;
        if (child.isDirectory()) {
          if (![...expected.keys()].some((key) => key.startsWith(`${name}/`))) return false;
          if (!(await visit(path, name, depth + 1))) return false;
          continue;
        }
        const row = expected.get(name);
        if (!child.isFile() || !row || seen.has(name)) return false;
        const identity = await lstat(path, { bigint: true });
        if (!identity.isFile() || identity.isSymbolicLink()) return false;
        const bytes = Uint8Array.from(await readFile(path));
        if (String(bytes.byteLength) !== row.byteLength || sha256Bytes(bytes) !== row.sha256)
          return false;
        seen.add(name);
        observed.push(Object.freeze({ ...row }));
      }
      return true;
    };
    for (const child of children)
      if (!(await visit(resolve(archiveRoot, child), child, 0)))
        return { ok: false, issues: issues("native-lock-preparation:archive-census-refused") };
    if (seen.size !== expected.size)
      return { ok: false, issues: issues("native-lock-preparation:archive-census-refused") };
    return {
      ok: true,
      files: Object.freeze(
        observed.sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        ),
      ),
    };
  } catch {
    return { ok: false, issues: issues("native-lock-preparation:archive-unreadable") };
  }
}

type ConsumeOutcome =
  | {
      readonly ok: true;
      readonly archiveFiles: readonly NativeLockBuildFile[];
      readonly preparation: NativeLockPendingPreparation;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export async function prepareHostedNativeLockTransaction(
  input: HostedNativeLockPreparationInput,
  boundary: HostedNativeLockPreparationBoundary = {},
): Promise<HostedNativeLockPreparationResult> {
  try {
    const context = input?.context;
    if (
      !input ||
      typeof input !== "object" ||
      !context ||
      typeof context !== "object" ||
      context.action !== hostedNativeLockAction ||
      context.schemaVersion !== "hosted-native-lock-plan-context/v1" ||
      !/^[0-9a-f]{40}$/.test(context.candidateRevision) ||
      !/^[0-9a-f]{40}$/.test(context.workflowRevision) ||
      !/^[0-9a-f]{64}$/.test(context.candidateSubjectDigest) ||
      !input.candidate ||
      typeof input.candidate !== "object" ||
      !input.environment ||
      typeof input.environment !== "object" ||
      !canonicalInput(input.runnerTemp) ||
      !canonicalInput(input.stableRoot) ||
      !boundary ||
      typeof boundary !== "object"
    )
      return refusal("native-lock-preparation:input-refused");
    const runnerTemp = input.runnerTemp;
    const stableRoot = input.stableRoot;
    if (!(await canonicalDirectory(runnerTemp)) || !(await canonicalDirectory(stableRoot)))
      return refusal("native-lock-preparation:root-not-canonical");
    if (overlap(runnerTemp, stableRoot)) return refusal("native-lock-preparation:roots-overlap");
    const canonical: string[] = [];
    for (const name of [
      hostedNativeLockRootNames.acquisition,
      hostedNativeLockRootNames.preparation,
      hostedNativeLockRootNames.case,
    ]) {
      const declared = resolve(runnerTemp, name);
      try {
        await mkdir(declared, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      // A pre-placed link is resolved, never trusted: identity decides the roots.
      const root = await realpath(declared);
      if (!(await canonicalDirectory(root)) || dirname(root) !== runnerTemp)
        return refusal("native-lock-preparation:root-not-sibling");
      canonical.push(root);
    }
    const [acquisitionRoot, archiveRoot, caseRoot] = canonical as [string, string, string];
    if (
      canonical.some((left, index) =>
        canonical.some((right, other) => index !== other && overlap(left, right)),
      ) ||
      canonical.some((root) => overlap(root, stableRoot))
    )
      return refusal("native-lock-preparation:roots-overlap");
    const roots: HostedNativeLockPreparationRoots = Object.freeze({
      acquisitionRoot,
      archiveRoot,
      artifactRoot: resolve(archiveRoot, "build"),
      caseRoot,
      runnerTemp,
    });
    // Emptiness precondition, in root order. The case root is read exactly once
    // more, after the builder returns, and must still be empty in this slice.
    for (const root of canonical)
      if ((await readdir(root)).length !== 0)
        return refusal("native-lock-preparation:root-not-empty");
    const acquire = boundary.acquire ?? acquireHostedNativeLockInputs;
    const acquired = await acquire(
      { environment: input.environment, root: acquisitionRoot },
      boundary.acquisition,
    );
    if (!acquired || typeof acquired !== "object")
      return refusal("native-lock-preparation:acquisition-refused");
    if (!acquired.ok)
      return refusal("native-lock-preparation:acquisition-refused", ...acquired.issues);
    const acquisitionFiles = Object.freeze(acquired.retainedFiles.map((row) => ({ ...row })));
    // An unsupported or unknown acquisition never invokes preparation, and an
    // unknown capture is never taken as the unavailable branch.
    if (acquired.state !== "AVAILABLE")
      return { ok: true, state: acquired.state, acquisitionFiles, reason: acquired.reason, roots };
    // The ledger's external() rule: acquisition outputs stay in the acquisition
    // root and never lie inside the preparation root, case root or source root.
    for (const path of [
      acquired.archivePath,
      acquired.capturePath,
      acquired.shasumsPath,
      ...(acquired.importLibraryPath === null ? [] : [acquired.importLibraryPath]),
    ])
      if (
        !canonicalInput(path) ||
        path === acquisitionRoot ||
        !within(acquisitionRoot, path) ||
        within(archiveRoot, path) ||
        within(caseRoot, path) ||
        within(stableRoot, path)
      )
        return refusal("native-lock-preparation:acquisition-output-not-external");
    const consumed = await withHostedCandidateSource<ConsumeOutcome>(
      input.candidate,
      runnerTemp,
      stableRoot,
      async (candidateRoot) => {
        const binding = checkCandidateSubjectBinding(context, input.candidate);
        if (binding.length > 0) return { ok: false, issues: binding };
        const row = candidateSubjectRow(input.candidate);
        if (!row)
          return {
            ok: false,
            issues: issues("native-lock-preparation:candidate-source-row-refused"),
          };
        const request: NativeLockInputRequest = {
          runnerTemp: archiveRoot,
          stableRevision: context.workflowRevision,
          candidateRevision: context.candidateRevision,
          candidateRoot,
          candidateFile: {
            path: hostedNativeLockCandidateSourcePath,
            byteLength: row.byteLength,
            sha256Digest: row.sha256Digest,
            executable: row.executable,
          },
          distribution: {
            archivePath: acquired.archivePath,
            shasumsPath: acquired.shasumsPath,
            importLibraryPath: acquired.importLibraryPath,
          },
          toolchainCapture: acquired.capturePath,
        };
        // A throw here stays a throw: the landed owner still deletes the root.
        const preparation = await prepareNativeLockBuild(request);
        if (
          preparation?.status !== "PENDING_CANDIDATE_CONSUME" ||
          preparation.buildPathPrefix !== "build/" ||
          preparation.buildRoot !== roots.artifactRoot
        )
          return { ok: false, issues: issues("native-lock-preparation:pending-shape-refused") };
        const preLoad = checkPreLoadBuildBinding(preparation);
        if (preLoad.length > 0) return { ok: false, issues: preLoad };
        if ((await readdir(caseRoot)).length !== 0)
          return { ok: false, issues: issues("native-lock-preparation:case-root-not-empty") };
        const census = await censusHostedNativeLockArchive(archiveRoot, preparation.retainedFiles);
        if (!census.ok) return { ok: false, issues: census.issues };
        return { ok: true, archiveFiles: census.files, preparation };
      },
    );
    if (!consumed.ok)
      return refusal("native-lock-preparation:candidate-consume-refused", ...consumed.issues);
    if (!consumed.value.ok) return refusal(...consumed.value.issues);
    return {
      ok: true,
      state: "AVAILABLE",
      acquisitionFiles,
      archiveFiles: consumed.value.archiveFiles,
      preparation: consumed.value.preparation,
      roots,
    };
  } catch {
    return refusal("native-lock-preparation:unreadable");
  }
}

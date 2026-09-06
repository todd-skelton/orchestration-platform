import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
// Narrow imports on purpose: this module calls no ISS-022 selection, profile,
// capability or decision writer, adds no public export or schema, and touches
// neither the ordinary hosted observation module nor the landed GitHub
// observation-archive verifier.
import { canonicalJson } from "../../packages/contracts/src/index.js";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import { readConformanceBundleFileRow } from "../../packages/conformance/src/manifest.js";
import type { NativeLockBuildFile } from "../build/native-lock-experiment.mjs";
import {
  hostedNativeLockAction,
  hostedNativeLockCaseIds,
  hostedNativeLockControlIds,
  hostedNativeLockRunnerToken,
  hostedNativeLockSuiteId,
} from "./hosted-native-lock-plan.mjs";
import {
  hostedNativeLockSealedCensus,
  prepareHostedNativeLockTransaction,
  type HostedNativeLockPreparationResult,
} from "./hosted-native-lock-preparation.mjs";
import { loadHostedCandidateSnapshot, type HostedNativeLockPlanContext } from "./hosted-plan.mjs";

/**
 * Private hosted native-lock archive collector and single-OS observation entry
 * (ISS-048 stage-three sub-slice 3.5).
 *
 * It seals the one immutable per-OS diagnostic archive that the bounded
 * native-lock ledger's "Single-OS archive layout, roots, and the post-case
 * census" subsection defines, and it exposes the native-lock runner-token and
 * per-OS job entry PARALLEL to the ordinary hosted observation entry in
 * `./hosted-observation.mts`, which stays byte-identical, and to the landed
 * GitHub observation-archive verifier, which is neither read nor changed here.
 *
 * What the subsection fixes and this module implements, in its terms:
 *
 *   * the archive root IS the preparation root, and a retained file's
 *     archive-relative path is `relative(archiveRoot, P)` with `/` separators,
 *     with exactly one declared exception: a value beginning with the literal
 *     `build/transcripts/` loses its leading `build/`. There is no other
 *     rebasing, so the mapping lives in exactly two total, mutually inverse
 *     functions below and every derived row is round-tripped through both;
 *   * the retained-file census is DERIVED from the report, the builder's own
 *     sealed rows and the fixture actors, never from a caller-supplied list:
 *     the fixed control files come from the report's twelve control rows and
 *     the ledger's presence rules, the fixed transcript files come from each
 *     retained case row's actual child actors, and `build/case-diagnostics.json`
 *     is required exactly when the case phase ran and refused otherwise. No
 *     provider, revision or result fact is ever read out of a
 *     `controls/<id>/input.json`;
 *   * every sealed row must reappear in the second, post-case census with an
 *     identical archive-relative path, `byteLength` and `sha256`; the second
 *     census may exceed the first by exactly those three additions and by
 *     nothing else;
 *   * every retained file keeps its bytes and is hashed by the EXISTING
 *     artifact manifest machinery (`readConformanceBundleFileRow`), which
 *     re-reads the bytes under `O_NOFOLLOW` with a directory-chain identity
 *     check. No census digest ever substitutes for a retained file;
 *   * the closed bound is at most 8192 retained entries under
 *     `build/inputs/headers/`, at most 512 further retained entries, and at
 *     most 512 MiB of retained bytes. Exceeding it is a finding, never
 *     permission to drop bytes or to continue without the missing evidence;
 *   * the fixed-lock custody root is OUT of the archive: it must be external to
 *     the archive root, and no retained file may be named `native-lock`. The
 *     custody root is read from the report's own `custody` member, never from a
 *     caller.
 *
 * Two layout readings are recorded here so review can attack them directly.
 * First, the archive root is also the immutable output directory: the census is
 * taken "before the report is serialized", so sealing writes exactly one further
 * member, `report.json`, into the archive root and then re-reads it. Second, no
 * manifest file is written, because the subsection states that "the only archive
 * member outside those four prefixes is the report itself"; the archive manifest
 * is returned to the caller instead, and stage four's verifier re-reads and
 * re-validates the bytes rather than trusting any hash.
 *
 * The entry is reachable from no workflow and from no dispatch registration.
 * `scripts/conformance/hosted.mts` is not touched, `.github/workflows/` is not
 * touched, and no observer is registered, so
 * `runHostedNativeLockObservationEntry` validates the provider facts and then
 * refuses. Round 429's non-goal stands: stage three adds no workflow surface.
 *
 * It compiles nothing, downloads nothing, installs nothing, loads no addon,
 * requires no `.node`, spawns no fixture child, takes no OS lock, runs no case
 * or control itself, and calls no provider.
 */

/** The one further archive member, which the report itself occupies. */
export const hostedNativeLockArchiveReportPath = "report.json" as const;

/** The archive root's exact direct children at census time, in sorted order. */
export const hostedNativeLockArchiveChildren = Object.freeze([
  "build",
  "controls",
  "preparation",
] as const);

/** The four archive-relative prefixes every retained file begins with. */
export const hostedNativeLockArchivePrefixes = Object.freeze([
  "build/",
  "controls/",
  "preparation/",
  "transcripts/",
] as const);

/** The sole declared rebasing, stated once as a physical/archive prefix pair. */
export const hostedNativeLockTranscriptPrefix = "transcripts/" as const;
export const hostedNativeLockPhysicalTranscriptPrefix = "build/transcripts/" as const;

/** Fixed archive-relative paths and prefixes the subsection names literally. */
export const hostedNativeLockDiagnosticsPath = "build/case-diagnostics.json" as const;
export const hostedNativeLockHeaderPrefix = "build/inputs/headers/" as const;
export const hostedNativeLockControlPrefix = "controls/" as const;
export const hostedNativeLockCustodyLeafName = "native-lock" as const;

/** The closed child-actor vocabulary; `PARENT` retains no transcript file. */
export const hostedNativeLockChildActors = Object.freeze([
  "CONTENDER",
  "DEFAULT_CHILD",
  "HOLDER",
] as const);
export const hostedNativeLockTranscriptStreams = Object.freeze(["stderr", "stdout"] as const);

/** The ledger's four closed control arms, as the `result` to `refused` pairing. */
export const hostedNativeLockControlArms = Object.freeze({
  REFUSED: true,
  UNKNOWN: null,
  UNSUPPORTED: null,
  VIOLATED: false,
} as const);

/** The subsection's closed per-OS archive bound. All three refuse together. */
export const hostedNativeLockArchiveBound = Object.freeze({
  headerEntries: 8192,
  otherEntries: 512,
  totalBytes: 512 * 1024 * 1024,
} as const);

const maximumWalkEntries = 32768;
const maximumWalkDepth = 24;
const digestPattern = /^[0-9a-f]{64}$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/;
const positiveDecimalPattern = /^[1-9][0-9]*$/;
const revisionPattern = /^[0-9a-f]{40}$/;

const familyByRunnerOs = Object.freeze({
  Linux: "LINUX",
  Windows: "WINDOWS",
  macOS: "MACOS",
} as const);
const platformByFamily = Object.freeze({
  LINUX: "linux",
  MACOS: "darwin",
  WINDOWS: "win32",
} as const);

export type HostedNativeLockOperatingSystem = "LINUX" | "MACOS" | "WINDOWS";

export type HostedNativeLockArchiveResult =
  | {
      readonly ok: true;
      readonly archiveName: string;
      readonly files: readonly NativeLockBuildFile[];
      readonly reportPath: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export type HostedNativeLockObservationResult =
  | {
      readonly ok: true;
      readonly archive: Extract<HostedNativeLockArchiveResult, { readonly ok: true }>;
      readonly state: "AVAILABLE";
    }
  | { readonly ok: true; readonly reason: string; readonly state: "UNKNOWN" | "UNSUPPORTED" }
  | { readonly ok: false; readonly issues: readonly string[] };

function issues(...values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function refusal(...values: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
  return { ok: false, issues: issues(...values) };
}

function utf8Order(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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

async function canonicalDirectory(path: string): Promise<boolean> {
  const identity = await lstat(path, { bigint: true });
  return identity.isDirectory() && !identity.isSymbolicLink() && (await realpath(path)) === path;
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).slice().sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  return input as Readonly<Record<string, unknown>>;
}

/**
 * The archive-relative mapping and its inverse. These are the ONLY two places a
 * retained path changes prefix; every derived row is round-tripped through both,
 * so a row that would be silently rebased is refused instead of moved.
 */
export function hostedNativeLockArchivePath(physicalPath: string): string {
  return physicalPath.startsWith(hostedNativeLockPhysicalTranscriptPrefix)
    ? physicalPath.slice("build/".length)
    : physicalPath;
}

export function hostedNativeLockPhysicalPath(archivePath: string): string {
  return archivePath.startsWith(hostedNativeLockTranscriptPrefix)
    ? `build/${archivePath}`
    : archivePath;
}

/** The one immutable archive name of this attempt's per-OS observation job. */
export function hostedNativeLockArchiveName(
  runId: string,
  runAttempt: string,
  operatingSystem: HostedNativeLockOperatingSystem,
): string | undefined {
  if (
    typeof runId !== "string" ||
    !positiveDecimalPattern.test(runId) ||
    typeof runAttempt !== "string" ||
    !positiveDecimalPattern.test(runAttempt) ||
    !(operatingSystem in platformByFamily)
  )
    return undefined;
  return `iss022-native-lock-${runId}-${runAttempt}-${operatingSystem.toLowerCase()}`;
}

/** The registry's own per-OS job identifier. Never a caller-supplied string. */
export function hostedNativeLockObservationJobId(
  operatingSystem: HostedNativeLockOperatingSystem,
): string {
  return `${hostedNativeLockSuiteId}-${operatingSystem.toLowerCase()}`;
}

export interface HostedNativeLockObservedReport {
  readonly casePhaseRan: boolean;
  readonly cases: readonly Readonly<{
    readonly caseId: string;
    readonly childActors: readonly string[];
  }>[];
  readonly controls: readonly Readonly<{
    readonly controlId: string;
    readonly executed: boolean;
  }>[];
  readonly custody: Readonly<Record<string, unknown>>;
  readonly custodyRoot: string | null;
  readonly jobId: string;
  readonly operatingSystem: HostedNativeLockOperatingSystem;
  readonly runAttempt: string;
  readonly runId: string;
}

const reportMembers = Object.freeze([
  "builds",
  "cases",
  "controls",
  "coordinates",
  "custody",
  "experiment",
  "result",
]);
const coordinateMembers = Object.freeze([
  "architecture",
  "candidateRevision",
  "jobId",
  "nodeModulesVersion",
  "nodeNapiVersion",
  "nodeVersion",
  "operatingSystem",
  "repositoryId",
  "runAttempt",
  "runId",
  "workflowRevision",
]);
const custodyMembers = Object.freeze([
  "finalByteHex",
  "finalIdentity",
  "initialByteHex",
  "initialIdentity",
  "leafName",
  "rootPath",
]);
const eventMembers = Object.freeze(["actor", "data", "kind", "sequence"]);

/**
 * Structural read of the exact seven-member report, for census derivation only.
 * It weighs no evidence and consumes no result: the separate per-OS reducer owns
 * that. A short, reordered, open or malformed census refuses here, before any
 * path is derived from it.
 */
export function parseHostedNativeLockObservationReport(
  value: unknown,
):
  | { readonly ok: true; readonly value: HostedNativeLockObservedReport }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const report = exactRecord(value, reportMembers);
  if (!report) return refusal("native-lock-observation:report-census-refused");
  const coordinates = exactRecord(report.coordinates, coordinateMembers);
  const custody = exactRecord(report.custody, custodyMembers);
  if (!coordinates || !custody) return refusal("native-lock-observation:report-census-refused");
  const operatingSystem = coordinates.operatingSystem;
  if (
    typeof operatingSystem !== "string" ||
    !(operatingSystem in platformByFamily) ||
    typeof coordinates.runId !== "string" ||
    !positiveDecimalPattern.test(coordinates.runId) ||
    typeof coordinates.runAttempt !== "string" ||
    !positiveDecimalPattern.test(coordinates.runAttempt) ||
    typeof coordinates.candidateRevision !== "string" ||
    !revisionPattern.test(coordinates.candidateRevision) ||
    typeof coordinates.workflowRevision !== "string" ||
    !revisionPattern.test(coordinates.workflowRevision) ||
    coordinates.jobId !==
      hostedNativeLockObservationJobId(operatingSystem as HostedNativeLockOperatingSystem) ||
    custody.leafName !== hostedNativeLockCustodyLeafName ||
    !(custody.rootPath === null || typeof custody.rootPath === "string")
  )
    return refusal("native-lock-observation:report-coordinates-refused");
  const controlRows: unknown = report.controls;
  if (!Array.isArray(controlRows) || controlRows.length !== hostedNativeLockControlIds.length)
    return refusal("native-lock-observation:control-census-refused");
  const controls: { readonly controlId: string; readonly executed: boolean }[] = [];
  for (const [index, controlId] of hostedNativeLockControlIds.entries()) {
    const row = exactRecord(controlRows[index], ["controlId", "refused", "result"]);
    if (!row || row.controlId !== controlId)
      return refusal("native-lock-observation:control-census-refused");
    const result = row.result;
    if (
      typeof result !== "string" ||
      !Object.hasOwn(hostedNativeLockControlArms, result) ||
      hostedNativeLockControlArms[result as keyof typeof hostedNativeLockControlArms] !==
        row.refused
    )
      return refusal("native-lock-observation:control-arm-refused");
    controls.push(Object.freeze({ controlId, executed: row.refused !== null }));
  }
  const caseRows: unknown = report.cases;
  if (!Array.isArray(caseRows) || caseRows.length !== hostedNativeLockCaseIds.length)
    return refusal("native-lock-observation:case-census-refused");
  const cases: { readonly caseId: string; readonly childActors: readonly string[] }[] = [];
  for (const [index, caseId] of hostedNativeLockCaseIds.entries()) {
    const row = exactRecord(caseRows[index], ["caseId", "events", "result"]);
    const events: unknown = row?.events;
    if (!row || row.caseId !== caseId || !Array.isArray(events))
      return refusal("native-lock-observation:case-census-refused");
    const actors = new Set<string>();
    let defaultChildRetained = false;
    for (const entry of events) {
      const event = exactRecord(entry, eventMembers);
      const actor = event?.actor;
      if (typeof actor !== "string" || typeof event?.kind !== "string")
        return refusal("native-lock-observation:case-event-refused");
      if (actor === "PARENT") continue;
      if (!(hostedNativeLockChildActors as readonly string[]).includes(actor))
        return refusal("native-lock-observation:case-event-refused");
      actors.add(actor);
      // A `DEFAULT_CHILD` capture is retained exactly when its closure was
      // observed; the landed case context records a cleanup failure and retains
      // no transcript otherwise, so its transcript rows are derived from that
      // same fact rather than from the actor merely having been addressed.
      if (actor === "DEFAULT_CHILD" && event.kind === "CLOSE") defaultChildRetained = true;
    }
    if (!defaultChildRetained) actors.delete("DEFAULT_CHILD");
    cases.push(Object.freeze({ caseId, childActors: Object.freeze([...actors].sort()) }));
  }
  return {
    ok: true,
    value: Object.freeze({
      // The case phase ran exactly when the landed context reached `setup()`,
      // which is the only writer of the initial custody identity and the only
      // state in which `finalize()` — and therefore `case-diagnostics.json` —
      // can exist at all.
      casePhaseRan: custody.initialIdentity !== null,
      cases: Object.freeze(cases),
      controls: Object.freeze(controls),
      custody,
      custodyRoot: typeof custody.rootPath === "string" ? custody.rootPath : null,
      jobId: coordinates.jobId,
      operatingSystem: operatingSystem as HostedNativeLockOperatingSystem,
      runAttempt: coordinates.runAttempt,
      runId: coordinates.runId,
    }),
  };
}

export interface HostedNativeLockArchiveGates {
  readonly binding: (view: {
    readonly observed: readonly NativeLockBuildFile[];
    readonly sealed: ReadonlyMap<string, NativeLockBuildFile | null>;
  }) => readonly string[];
  readonly bound: (view: {
    readonly headerEntries: number;
    readonly otherEntries: number;
    readonly totalBytes: number;
  }) => readonly string[];
  readonly census: (view: {
    readonly expected: readonly string[];
    readonly observed: readonly string[];
  }) => readonly string[];
  readonly custodyRoot: (view: {
    readonly archiveRoot: string;
    readonly custodyRoot: string | null;
  }) => readonly string[];
  readonly diagnostics: (view: {
    readonly casePhaseRan: boolean;
    readonly custody: unknown;
    readonly present: boolean;
    readonly reportCustody: unknown;
  }) => readonly string[];
  readonly duplicates: (view: { readonly paths: readonly string[] }) => readonly string[];
  readonly hygiene: (view: {
    readonly rows: readonly Readonly<{
      readonly archivePath: string;
      readonly sealed: NativeLockBuildFile | null;
    }>[];
  }) => readonly string[];
  readonly links: (view: {
    readonly directory: boolean;
    readonly file: boolean;
    readonly symbolicLink: boolean;
  }) => readonly string[];
}

function hygienicArchivePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !isAbsolute(path) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") &&
    hostedNativeLockArchivePrefixes.some((prefix) => path.startsWith(prefix)) &&
    // The custody root's fixed leaf may never be copied or rehashed into the
    // archive; its evidence enters only as the report's `custody` member.
    path.split("/").at(-1) !== hostedNativeLockCustodyLeafName &&
    // Total and injective: the sole rebasing must survive a round trip in both
    // directions, so nothing is moved between prefixes by accident.
    hostedNativeLockArchivePath(hostedNativeLockPhysicalPath(path)) === path
  );
}

/**
 * The eight substitutable gates. They are substitutable ONLY so that a stable
 * test can delete exactly one at a time; `sealHostedNativeLockArchive` defaults
 * to this frozen table and no production path replaces one.
 */
const archiveGates: HostedNativeLockArchiveGates = {
  binding: (view) => {
    const found: string[] = [];
    const observed = new Map(view.observed.map((row) => [row.path, row] as const));
    for (const [path, sealed] of view.sealed) {
      if (sealed === null) continue;
      const row = observed.get(path);
      if (!row || row.byteLength !== sealed.byteLength || row.sha256 !== sealed.sha256)
        found.push("native-lock-observation:sealed-row-not-retained");
    }
    return issues(...found);
  },
  bound: (view) =>
    issues(
      ...(view.headerEntries > hostedNativeLockArchiveBound.headerEntries ||
      view.otherEntries > hostedNativeLockArchiveBound.otherEntries ||
      view.totalBytes > hostedNativeLockArchiveBound.totalBytes
        ? ["native-lock-observation:archive-over-bound"]
        : []),
    ),
  census: (view) => {
    const expected = new Set(view.expected);
    const observed = new Set(view.observed);
    const found: string[] = [];
    for (const path of expected)
      if (!observed.has(path)) found.push("native-lock-observation:retained-file-missing");
    for (const path of observed)
      if (!expected.has(path)) found.push("native-lock-observation:retained-file-extra");
    return issues(...found);
  },
  custodyRoot: (view) => {
    if (view.custodyRoot === null) return issues();
    return issues(
      ...(canonicalInput(view.custodyRoot) &&
      !within(view.archiveRoot, view.custodyRoot) &&
      !within(view.custodyRoot, view.archiveRoot)
        ? []
        : ["native-lock-observation:custody-root-not-external"]),
    );
  },
  diagnostics: (view) => {
    if (view.present !== view.casePhaseRan)
      return issues("native-lock-observation:case-diagnostics-presence-refused");
    if (!view.present) return issues();
    return issues(
      ...(canonicalJson(view.custody) === canonicalJson(view.reportCustody)
        ? []
        : ["native-lock-observation:case-diagnostics-custody-refused"]),
    );
  },
  duplicates: (view) =>
    issues(
      ...(new Set(view.paths).size === view.paths.length
        ? []
        : ["native-lock-observation:retained-path-duplicated"]),
    ),
  hygiene: (view) => {
    const found: string[] = [];
    for (const row of view.rows) {
      if (!hygienicArchivePath(row.archivePath))
        found.push("native-lock-observation:retained-path-refused");
      if (row.sealed === null) continue;
      if (
        !/^(?:build|preparation)\//.test(row.archivePath) ||
        row.archivePath.startsWith(hostedNativeLockPhysicalTranscriptPrefix) ||
        !decimalPattern.test(row.sealed.byteLength) ||
        !digestPattern.test(row.sealed.sha256)
      )
        found.push("native-lock-observation:sealed-census-refused");
    }
    return issues(...found);
  },
  links: (view) =>
    issues(
      ...(view.symbolicLink || !(view.directory || view.file)
        ? ["native-lock-observation:archive-entry-not-regular"]
        : []),
    ),
};

export const hostedNativeLockArchiveGates: HostedNativeLockArchiveGates =
  Object.freeze(archiveGates);

/**
 * Derive the finite retained-file census from the report, the builder's own
 * sealed rows and the fixture actors. Nothing here reads a caller-supplied file
 * list or a directory listing, and no fact is taken out of a control input file.
 */
export function deriveHostedNativeLockArchiveCensus(
  report: HostedNativeLockObservedReport,
  sealedFiles: readonly NativeLockBuildFile[],
  gates: HostedNativeLockArchiveGates = hostedNativeLockArchiveGates,
):
  | { readonly ok: true; readonly value: ReadonlyMap<string, NativeLockBuildFile | null> }
  | { readonly ok: false; readonly issues: readonly string[] } {
  if (!Array.isArray(sealedFiles)) return refusal("native-lock-observation:sealed-census-refused");
  const rows: { readonly archivePath: string; readonly sealed: NativeLockBuildFile | null }[] = [];
  for (const row of sealedFiles) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.path !== "string" ||
      typeof row.byteLength !== "string" ||
      typeof row.sha256 !== "string"
    )
      return refusal("native-lock-observation:sealed-census-refused");
    rows.push({ archivePath: row.path, sealed: Object.freeze({ ...row }) });
  }
  for (const row of report.controls) {
    const directory = `${hostedNativeLockControlPrefix}${row.controlId}`;
    // The ledger's presence rule, derived from the report's own arm: an
    // executed row retains both fixed files, an unavailable row retains its
    // `observation.json` and forbids its `input.json`.
    rows.push({ archivePath: `${directory}/observation.json`, sealed: null });
    if (row.executed) rows.push({ archivePath: `${directory}/input.json`, sealed: null });
  }
  for (const row of report.cases)
    for (const actor of row.childActors)
      for (const stream of hostedNativeLockTranscriptStreams)
        rows.push({
          archivePath: `${hostedNativeLockTranscriptPrefix}${row.caseId}/${actor}.${stream}`,
          sealed: null,
        });
  if (report.casePhaseRan)
    rows.push({ archivePath: hostedNativeLockDiagnosticsPath, sealed: null });
  const frozen = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  const found = [
    ...gates.hygiene({ rows: frozen }),
    ...gates.duplicates({ paths: frozen.map((row) => row.archivePath) }),
  ];
  if (found.length > 0) return refusal(...found);
  const census = new Map<string, NativeLockBuildFile | null>();
  for (const row of frozen) census.set(row.archivePath, row.sealed);
  return { ok: true, value: census };
}

async function walkArchive(
  archiveRoot: string,
  gates: HostedNativeLockArchiveGates,
): Promise<
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly issues: readonly string[] }
> {
  const children = (await readdir(archiveRoot)).sort();
  if (children.join("\0") !== [...hostedNativeLockArchiveChildren].join("\0"))
    return refusal("native-lock-observation:archive-children-refused");
  const paths: string[] = [];
  const found: string[] = [];
  let count = 0;
  const visit = async (directory: string, depth: number): Promise<boolean> => {
    if (depth > maximumWalkDepth) return false;
    for (const child of await readdir(directory, { withFileTypes: true })) {
      if (++count > maximumWalkEntries) return false;
      const path = resolve(directory, child.name);
      const physical = relative(archiveRoot, path).split(sep).join("/");
      if (physical.length === 0 || physical.split("/").includes("..")) return false;
      found.push(
        ...gates.links({
          directory: child.isDirectory(),
          file: child.isFile(),
          symbolicLink: child.isSymbolicLink(),
        }),
      );
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (!(await visit(path, depth + 1))) return false;
        continue;
      }
      if (!child.isFile()) continue;
      paths.push(hostedNativeLockArchivePath(physical));
    }
    return true;
  };
  for (const child of children)
    if (!(await visit(resolve(archiveRoot, child), 0)))
      return refusal("native-lock-observation:archive-walk-refused");
  found.push(...gates.duplicates({ paths }));
  return found.length > 0
    ? refusal(...found)
    : { ok: true, paths: Object.freeze([...paths].sort(utf8Order)) };
}

export interface HostedNativeLockArchiveInput {
  /** The archive root, which the subsection fixes as the preparation root. */
  readonly archiveRoot: string;
  /** The exact seven-member per-OS diagnostic report, still unserialized. */
  readonly report: unknown;
  /** The builder's own sealed `PENDING_CANDIDATE_CONSUME` census. */
  readonly sealedFiles: readonly NativeLockBuildFile[];
}

/**
 * Take the second, post-case census over the archive root, bind it to the
 * sealed preparation census, hash every retained file with the existing
 * artifact manifest machinery, and only then serialize the report into the
 * archive root as its one further member. A refusal here is a finding: no path
 * drops a retained byte, substitutes a hash for a file, or continues without
 * the missing evidence.
 */
export async function sealHostedNativeLockArchive(
  input: HostedNativeLockArchiveInput,
  gates: HostedNativeLockArchiveGates = hostedNativeLockArchiveGates,
): Promise<HostedNativeLockArchiveResult> {
  try {
    if (!input || typeof input !== "object" || !gates || typeof gates !== "object")
      return refusal("native-lock-observation:input-refused");
    const archiveRoot = input.archiveRoot;
    if (!canonicalInput(archiveRoot) || !(await canonicalDirectory(archiveRoot)))
      return refusal("native-lock-observation:archive-root-refused");
    const parsed = parseHostedNativeLockObservationReport(input.report);
    if (!parsed.ok) return parsed;
    const report = parsed.value;
    const archiveName = hostedNativeLockArchiveName(
      report.runId,
      report.runAttempt,
      report.operatingSystem,
    );
    if (archiveName === undefined) return refusal("native-lock-observation:archive-name-refused");
    const rootIssues = gates.custodyRoot({ archiveRoot, custodyRoot: report.custodyRoot });
    if (rootIssues.length > 0) return refusal(...rootIssues);
    const derived = deriveHostedNativeLockArchiveCensus(report, input.sealedFiles, gates);
    if (!derived.ok) return derived;
    const walked = await walkArchive(archiveRoot, gates);
    if (!walked.ok) return walked;
    // The `case-diagnostics.json` presence rule is weighed against what is
    // actually on disk, before the census difference, so that a file present
    // when the case phase never ran is refused as the presence violation it is
    // rather than as an anonymous extra member.
    const present = walked.paths.includes(hostedNativeLockDiagnosticsPath);
    let diagnosticsCustody: unknown = null;
    if (present) {
      try {
        const bytes = await readFile(
          resolve(archiveRoot, ...hostedNativeLockDiagnosticsPath.split("/")),
        );
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        diagnosticsCustody = (value as { readonly custody?: unknown } | null)?.custody ?? null;
      } catch {
        return refusal("native-lock-observation:case-diagnostics-unreadable");
      }
    }
    const diagnosticsIssues = gates.diagnostics({
      casePhaseRan: report.casePhaseRan,
      custody: diagnosticsCustody,
      present,
      reportCustody: report.custody,
    });
    if (diagnosticsIssues.length > 0) return refusal(...diagnosticsIssues);
    const expected = Object.freeze([...derived.value.keys()].sort(utf8Order));
    const censusIssues = gates.census({ expected, observed: walked.paths });
    if (censusIssues.length > 0) return refusal(...censusIssues);
    // Every retained file keeps its bytes and is re-read here through the
    // existing artifact manifest machinery. No census digest substitutes for a
    // retained file, and the archive-relative label is applied exactly once.
    const observed: NativeLockBuildFile[] = [];
    let headerEntries = 0;
    let otherEntries = 0;
    let totalBytes = 0;
    for (const archivePath of expected) {
      let row;
      try {
        row = await readConformanceBundleFileRow(
          archiveRoot,
          hostedNativeLockPhysicalPath(archivePath),
        );
      } catch {
        return refusal("native-lock-observation:retained-file-unreadable");
      }
      const file = Object.freeze({
        byteLength: String(row.byteLength),
        path: archivePath,
        sha256: String(row.sha256Digest),
      });
      observed.push(file);
      if (archivePath.startsWith(hostedNativeLockHeaderPrefix)) headerEntries += 1;
      else otherEntries += 1;
      totalBytes += Number(file.byteLength);
    }
    const boundIssues = gates.bound({ headerEntries, otherEntries, totalBytes });
    if (boundIssues.length > 0) return refusal(...boundIssues);
    const bindingIssues = gates.binding({ observed, sealed: derived.value });
    if (bindingIssues.length > 0) return refusal(...bindingIssues);
    // The census is complete, so the report may now be serialized into the
    // archive root as its one member outside the four retained prefixes.
    let reportBytes: Uint8Array;
    try {
      reportBytes = new TextEncoder().encode(canonicalJson(input.report));
    } catch {
      return refusal("native-lock-observation:report-unserializable");
    }
    const reportTarget = resolve(archiveRoot, hostedNativeLockArchiveReportPath);
    await writeFile(reportTarget, reportBytes, { flag: "wx", mode: 0o600 });
    if (
      (await readdir(archiveRoot)).sort().join("\0") !==
      [...hostedNativeLockArchiveChildren, hostedNativeLockArchiveReportPath].sort().join("\0")
    )
      return refusal("native-lock-observation:archive-output-refused");
    let reportRow;
    try {
      reportRow = await readConformanceBundleFileRow(
        archiveRoot,
        hostedNativeLockArchiveReportPath,
      );
    } catch {
      return refusal("native-lock-observation:archive-output-refused");
    }
    if (
      String(reportRow.byteLength) !== String(reportBytes.byteLength) ||
      Buffer.compare(Buffer.from(await readFile(reportTarget)), Buffer.from(reportBytes)) !== 0
    )
      return refusal("native-lock-observation:archive-output-refused");
    observed.push(
      Object.freeze({
        byteLength: String(reportRow.byteLength),
        path: hostedNativeLockArchiveReportPath,
        sha256: String(reportRow.sha256Digest),
      }),
    );
    return {
      ok: true,
      archiveName,
      files: Object.freeze(observed.sort((left, right) => utf8Order(left.path, right.path))),
      reportPath: hostedNativeLockArchiveReportPath,
    };
  } catch {
    return refusal("native-lock-observation:archive-unreadable");
  }
}

const contextFields = Object.freeze([
  "action",
  "candidateRevision",
  "candidateSubjectDigest",
  "caseCensusDigest",
  "controlCensusDigest",
  "event",
  "harnessBundleDigest",
  "prerequisiteCensusDigest",
  "protectedRefDigest",
  "providerRunDigest",
  "repository",
  "repositoryId",
  "requiredJobRegistryDigest",
  "runAttempt",
  "runId",
  "schemaVersion",
  "testBundleDigest",
  "vectorCensusDigest",
  "workflowPath",
  "workflowRef",
  "workflowRevision",
]);

/**
 * The authenticated native-lock plan context, parallel to — and never a
 * substitute for — `parseHostedObservationContext`. A context whose provider-run
 * digest does not recompute from its own parsed provider facts is refused.
 */
export function parseHostedNativeLockObservationContext(
  input: unknown,
): HostedNativeLockPlanContext | undefined {
  try {
    const record = exactRecord(input, contextFields);
    if (!record) return undefined;
    for (const field of [
      "candidateSubjectDigest",
      "caseCensusDigest",
      "controlCensusDigest",
      "harnessBundleDigest",
      "prerequisiteCensusDigest",
      "protectedRefDigest",
      "providerRunDigest",
      "requiredJobRegistryDigest",
      "testBundleDigest",
      "vectorCensusDigest",
    ] as const)
      if (typeof record[field] !== "string" || !digestPattern.test(record[field])) return undefined;
    if (
      record.action !== hostedNativeLockAction ||
      record.event !== "repository_dispatch" ||
      record.schemaVersion !== "hosted-native-lock-plan-context/v1" ||
      typeof record.candidateRevision !== "string" ||
      !revisionPattern.test(record.candidateRevision) ||
      typeof record.workflowRevision !== "string" ||
      !revisionPattern.test(record.workflowRevision) ||
      typeof record.repository !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.repository) ||
      typeof record.repositoryId !== "string" ||
      !positiveDecimalPattern.test(record.repositoryId) ||
      typeof record.runAttempt !== "string" ||
      !positiveDecimalPattern.test(record.runAttempt) ||
      typeof record.runId !== "string" ||
      !positiveDecimalPattern.test(record.runId) ||
      record.workflowPath !== ".github/workflows/conformance.yml" ||
      record.workflowRef !==
        `${record.repository}/.github/workflows/conformance.yml@refs/heads/main`
    )
      return undefined;
    const provider = parseGithubProviderRunContext({
      candidateRevision: record.candidateRevision,
      candidateSubjectDigest: record.candidateSubjectDigest,
      event: record.event,
      harnessBundleDigest: record.harnessBundleDigest,
      protectedRefDigest: record.protectedRefDigest,
      repositoryId: record.repositoryId,
      requiredJobRegistryDigest: record.requiredJobRegistryDigest,
      runAttempt: record.runAttempt,
      runId: record.runId,
      testBundleDigest: record.testBundleDigest,
      workflowPath: record.workflowPath,
      workflowRef: record.workflowRef,
      workflowRevision: record.workflowRevision,
    });
    if (!provider.ok || computeGithubProviderRunDigest(provider.value) !== record.providerRunDigest)
      return undefined;
    return Object.freeze({ ...record }) as unknown as HostedNativeLockPlanContext;
  } catch {
    return undefined;
  }
}

export function decodeHostedNativeLockObservationContext(
  input: string,
): HostedNativeLockPlanContext | undefined {
  try {
    if (typeof input !== "string" || !/^[A-Za-z0-9_-]+$/.test(input)) return undefined;
    const bytes = Buffer.from(input, "base64url");
    if (bytes.toString("base64url") !== input) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (canonicalJson(value) !== text) return undefined;
    return parseHostedNativeLockObservationContext(value);
  } catch {
    return undefined;
  }
}

export interface HostedNativeLockObservationInput {
  readonly candidateRoot: string;
  readonly context: unknown;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly jobId: string;
  readonly runnerTemp: string;
  readonly runnerToken: string;
  readonly stableRoot: string;
}

export interface HostedNativeLockObservationRequest {
  readonly context: HostedNativeLockPlanContext;
  readonly jobId: string;
  readonly operatingSystem: HostedNativeLockOperatingSystem;
  readonly preparation: Extract<
    HostedNativeLockPreparationResult,
    { readonly ok: true; readonly state: "AVAILABLE" }
  >;
}

export interface HostedNativeLockObservationEvidence {
  readonly report: unknown;
}

export interface HostedNativeLockObservationBoundary {
  /**
   * The landed per-OS report producer, `produceNativeLockReport`, lives in
   * `probes/portable-primitives/experiment/report.mjs`: a landed JavaScript
   * module with no declaration file, which this `.mts` cannot import without
   * adding one or changing the compiler configuration, both outside sub-slice
   * 3.5's exact six-file footprint. It therefore has NO default here, which is
   * also the strongest available guarantee that this entry is unreachable: with
   * no observer registered the entry validates the provider facts and then
   * refuses. Registering one belongs to the stage-four activation slice.
   */
  readonly observe?: (
    request: HostedNativeLockObservationRequest,
  ) => Promise<HostedNativeLockObservationEvidence>;
  /** The landed preparation transaction; substituted only by synthetic vectors. */
  readonly prepare?: typeof prepareHostedNativeLockTransaction;
}

/**
 * The per-OS native-lock observation job entry, parallel to the ordinary
 * `runHostedIss022Observation` and sharing no code path with it. It refuses a
 * wrong runner token, a wrong job identifier, a wrong OS family, and a context
 * whose provider-run digest does not recompute.
 */
export async function runHostedNativeLockObservation(
  input: HostedNativeLockObservationInput,
  boundary: HostedNativeLockObservationBoundary = {},
): Promise<HostedNativeLockObservationResult> {
  try {
    if (!input || typeof input !== "object" || !boundary || typeof boundary !== "object")
      return refusal("native-lock-observation:input-refused");
    const context = parseHostedNativeLockObservationContext(input.context);
    if (
      !context ||
      ![input.candidateRoot, input.runnerTemp, input.stableRoot].every(
        (path) => typeof path === "string" && isAbsolute(path),
      )
    )
      return refusal("native-lock-observation:context-refused");
    if (input.runnerToken !== hostedNativeLockRunnerToken)
      return refusal("native-lock-observation:runner-token-refused");
    const family =
      familyByRunnerOs[(input.environment?.RUNNER_OS ?? "") as keyof typeof familyByRunnerOs];
    if (!family || process.platform !== platformByFamily[family])
      return refusal("native-lock-observation:operating-system-refused");
    if (input.jobId !== hostedNativeLockObservationJobId(family))
      return refusal("native-lock-observation:job-identifier-refused");
    // Checked before any filesystem work, so an unregistered entry does nothing
    // at all: no root is resolved, no candidate is loaded, no root is allocated.
    const observe = boundary.observe;
    if (typeof observe !== "function")
      return refusal("native-lock-observation:observer-not-registered");
    const [candidateRoot, runnerTemp, stableRoot] = await Promise.all([
      realpath(input.candidateRoot),
      realpath(input.runnerTemp),
      realpath(input.stableRoot),
    ]);
    if (
      [candidateRoot, stableRoot].some(
        (root) => within(root, runnerTemp) || within(runnerTemp, root),
      ) ||
      within(candidateRoot, stableRoot) ||
      within(stableRoot, candidateRoot)
    )
      return refusal("native-lock-observation:root-separation-refused");
    const candidate = await loadHostedCandidateSnapshot(candidateRoot, context.candidateRevision);
    if (!candidate.ok || candidate.value.digest !== context.candidateSubjectDigest)
      return refusal("native-lock-observation:candidate-authority-refused");
    const prepared = await (boundary.prepare ?? prepareHostedNativeLockTransaction)({
      candidate: candidate.value,
      context,
      environment: input.environment,
      runnerTemp,
      stableRoot,
    });
    if (!prepared.ok) return refusal(...prepared.issues);
    if (prepared.state !== "AVAILABLE")
      return { ok: true, reason: prepared.reason, state: prepared.state };
    const evidence = await observe({
      context,
      jobId: input.jobId,
      operatingSystem: family,
      preparation: prepared,
    });
    if (!evidence || typeof evidence !== "object")
      return refusal("native-lock-observation:observation-refused");
    const parsed = parseHostedNativeLockObservationReport(evidence.report);
    if (!parsed.ok) return parsed;
    if (parsed.value.jobId !== input.jobId || parsed.value.operatingSystem !== family)
      return refusal("native-lock-observation:job-identifier-refused");
    if (parsed.value.runId !== context.runId || parsed.value.runAttempt !== context.runAttempt)
      return refusal("native-lock-observation:context-refused");
    // The sealed census comes from the builder's own return, never from the
    // observer: the second census binds to rows no caller could shape.
    const sealed = hostedNativeLockSealedCensus(prepared.preparation);
    if (!sealed.ok) return refusal(...sealed.issues);
    const archive = await sealHostedNativeLockArchive({
      archiveRoot: prepared.roots.archiveRoot,
      report: evidence.report,
      sealedFiles: sealed.files,
    });
    if (!archive.ok) return archive;
    return { ok: true, archive, state: "AVAILABLE" };
  } catch {
    return refusal("native-lock-observation:unreadable");
  }
}

export function hostedNativeLockEnvironmentMatchesContext(
  environment: Readonly<Record<string, string | undefined>>,
  context: HostedNativeLockPlanContext,
): boolean {
  return (
    environment.GITHUB_EVENT_NAME === context.event &&
    environment.GITHUB_REF === "refs/heads/main" &&
    environment.GITHUB_REF_PROTECTED === "true" &&
    environment.GITHUB_REPOSITORY === context.repository &&
    environment.GITHUB_REPOSITORY_ID === context.repositoryId &&
    environment.GITHUB_RUN_ATTEMPT === context.runAttempt &&
    environment.GITHUB_RUN_ID === context.runId &&
    environment.GITHUB_SHA === context.workflowRevision &&
    environment.GITHUB_WORKFLOW_REF === context.workflowRef &&
    environment.GITHUB_WORKFLOW_SHA === context.workflowRevision
  );
}

/**
 * The provider-side entry, parallel to `runHostedObservation`. It is registered
 * in no workflow and in no dispatch table: `scripts/conformance/hosted.mts`
 * still closes its mode set over the five ordinary modes, and
 * `.github/workflows/conformance.yml` still carries no native-lock job. With no
 * observer registered this refuses, which is sub-slice 3.5's fence rather than
 * an oversight.
 */
export async function runHostedNativeLockObservationEntry(
  boundary: HostedNativeLockObservationBoundary = {},
): Promise<void> {
  const context = decodeHostedNativeLockObservationContext(
    process.env.NATIVE_LOCK_PLAN_CONTEXT ?? "",
  );
  const candidateRoot = process.env.CANDIDATE_ROOT;
  const jobId = process.env.CONFORMANCE_JOB_ID;
  const runnerTemp = process.env.RUNNER_TEMP;
  const runnerToken = process.env.CONFORMANCE_RUNNER_TOKEN;
  if (
    !context ||
    !hostedNativeLockEnvironmentMatchesContext(process.env, context) ||
    !candidateRoot ||
    !jobId ||
    !runnerTemp ||
    !runnerToken
  )
    throw new Error("native-lock-observation:provider-context-refused");
  const result = await runHostedNativeLockObservation(
    {
      candidateRoot,
      context,
      environment: process.env,
      jobId,
      runnerTemp,
      runnerToken,
      stableRoot: process.cwd(),
    },
    boundary,
  );
  if (!result.ok) throw new Error(result.issues.join(","));
}

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/index.js";
import {
  computeGithubProviderRunDigest,
  parseGithubProviderRunContext,
} from "../../packages/conformance/src/github-actions/index.js";
import type { NativeLockBuildFile } from "../../scripts/build/native-lock-experiment.mjs";
import {
  decodeHostedNativeLockObservationContext,
  deriveHostedNativeLockArchiveCensus,
  hostedNativeLockArchiveBound,
  hostedNativeLockArchiveChildren,
  hostedNativeLockArchiveGates,
  hostedNativeLockArchiveName,
  hostedNativeLockArchivePath,
  hostedNativeLockArchivePrefixes,
  hostedNativeLockArchiveReportPath,
  hostedNativeLockChildActors,
  hostedNativeLockControlArms,
  hostedNativeLockDiagnosticsPath,
  hostedNativeLockObservationJobId,
  hostedNativeLockPhysicalPath,
  parseHostedNativeLockObservationContext,
  parseHostedNativeLockObservationReport,
  runHostedNativeLockObservation,
  runHostedNativeLockObservationEntry,
  sealHostedNativeLockArchive,
  type HostedNativeLockArchiveGates,
  type HostedNativeLockOperatingSystem,
} from "../../scripts/conformance/hosted-native-lock-observation.mjs";
import {
  hostedNativeLockCaseIds,
  hostedNativeLockControlIds,
  hostedNativeLockRunnerToken,
  hostedNativeLockSuiteId,
} from "../../scripts/conformance/hosted-native-lock-plan.mjs";
import { hostedNativeLockSealedCensus } from "../../scripts/conformance/hosted-native-lock-preparation.mjs";

/**
 * ISS-048 stage-three sub-slice 3.5. Nothing here compiles, downloads,
 * installs or loads a native binary, requires a `.node`, spawns a fixture
 * child, takes an OS lock, runs a case or a control, uploads anything, calls a
 * provider, or writes a workflow. Every archive below is a synthetic tree of
 * text files in a fresh temporary root, and every guard reached is a stable one.
 *
 * Two things are deliberately explicit, because both look like something the
 * ledger forbids and neither is:
 *
 *  1. Some fixture files are named `*.node`. They hold a few ASCII bytes, are
 *     never required, loaded, executed or committed, and exist only so the
 *     collector has retained bytes to re-read and hash.
 *  2. `sealHostedNativeLockArchive` returns `ok: true` here. That is the
 *     collector's arithmetic over a synthetic tree, never a native observation:
 *     the report it seals is hand-built diagnostic data, its `result` is
 *     `UNKNOWN`, and no path in this file reaches the landed report producer,
 *     the per-OS reducer, a case, a control, or a lock.
 *
 * Every temporary root is `realpath(await mkdtemp(...))`, because the hosted
 * macOS `tmpdir()` is the `/var` alias of `/private/var` and the hosted Windows
 * one is the `RUNNER~1` alias, and the collector's canonical-root contract
 * correctly refuses a non-canonical root (Decision #300 ruling A).
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
}, 120_000);

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const repository = "todd-skelton/orchestration-platform";
const workflowRef = `${repository}/.github/workflows/conformance.yml@refs/heads/main`;
const candidateRevision = "b".repeat(40);
const workflowRevision = "a".repeat(40);
const runId = "3";
const runAttempt = "2";

const localFamily = { darwin: "MACOS", linux: "LINUX", win32: "WINDOWS" }[
  process.platform as "darwin" | "linux" | "win32"
] as HostedNativeLockOperatingSystem;
const localRunnerOs = { LINUX: "Linux", MACOS: "macOS", WINDOWS: "Windows" }[localFamily];
const otherFamily: HostedNativeLockOperatingSystem = localFamily === "LINUX" ? "MACOS" : "LINUX";
const otherRunnerOs = { LINUX: "Linux", MACOS: "macOS", WINDOWS: "Windows" }[otherFamily];

const identityValue = Object.freeze({ device: "9", inode: "11", kind: "POSIX" });
const encode = (text: string) => new TextEncoder().encode(text);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function sealedRow(archivePath: string, text: string): NativeLockBuildFile {
  const bytes = encode(text);
  return { byteLength: String(bytes.byteLength), path: archivePath, sha256: sha256(bytes) };
}

function custodyOf(rootPath: string | null): Readonly<Record<string, unknown>> {
  return Object.freeze({
    finalByteHex: rootPath === null ? null : "41",
    finalIdentity: rootPath === null ? null : identityValue,
    initialByteHex: rootPath === null ? null : "41",
    initialIdentity: rootPath === null ? null : identityValue,
    leafName: "native-lock",
    rootPath,
  });
}

function controlRow(controlId: string, arm: keyof typeof hostedNativeLockControlArms) {
  return { controlId, refused: hostedNativeLockControlArms[arm], result: arm };
}

function caseRow(caseId: string, actors: readonly string[]) {
  const events: Record<string, unknown>[] = [];
  let sequence = 0;
  const emit = (actor: string, kind: string, data: unknown) =>
    events.push({ actor, data, kind, sequence: String(sequence++) });
  if (actors.length > 0) emit("PARENT", "COMMAND", { name: "READY" });
  for (const actor of actors) {
    emit(actor, "COMMAND", { name: "READY" });
    if (actor === "DEFAULT_CHILD") emit(actor, "CLOSE", { exitCode: "0", signal: null });
  }
  return { caseId, events, result: "UNKNOWN" };
}

function buildRow(role: string, revision: string) {
  return {
    argv: null,
    inputs: null,
    loaded: null,
    outputs: null,
    result: "UNKNOWN",
    revision,
    role,
    toolchain: null,
  };
}

interface ReportOptions {
  readonly arms?: readonly (keyof typeof hostedNativeLockControlArms)[];
  readonly actors?: ReadonlyMap<string, readonly string[]>;
  readonly custodyRoot?: string | null;
  readonly family?: HostedNativeLockOperatingSystem;
}

function makeReport(options: ReportOptions = {}): Record<string, unknown> {
  const family = options.family ?? localFamily;
  const arms =
    options.arms ??
    hostedNativeLockControlIds.map((_, index) =>
      index < 3 ? ("UNSUPPORTED" as const) : ("REFUSED" as const),
    );
  const actors =
    options.actors ?? new Map([[hostedNativeLockCaseIds[0]!, ["CONTENDER", "HOLDER"]]]);
  return {
    builds: [
      buildRow("STABLE_WITNESS", workflowRevision),
      buildRow("CANDIDATE_BINDING", candidateRevision),
    ],
    cases: hostedNativeLockCaseIds.map((caseId) => caseRow(caseId, actors.get(caseId) ?? [])),
    controls: hostedNativeLockControlIds.map((controlId, index) =>
      controlRow(controlId, arms[index] ?? "UNKNOWN"),
    ),
    coordinates: {
      architecture: "X64",
      candidateRevision,
      jobId: hostedNativeLockObservationJobId(family),
      nodeModulesVersion: "137",
      nodeNapiVersion: "10",
      nodeVersion: "v24.15.0",
      operatingSystem: family,
      repositoryId: "1",
      runAttempt,
      runId,
      workflowRevision,
    },
    custody: custodyOf(
      options.custodyRoot === undefined ? "/tmp/iss022-native-lock-xyz" : options.custodyRoot,
    ),
    experiment: "iss022-native-lock-experiment/v1",
    result: "UNKNOWN",
  };
}

interface Fixture {
  readonly archiveRoot: string;
  readonly contents: Map<string, string>;
  readonly report: Record<string, unknown>;
  readonly root: string;
  readonly sealed: NativeLockBuildFile[];
}

const baseSealedContents = Object.freeze({
  "build/builds/CANDIDATE_BINDING/native-lock-candidate.node": "candidate placeholder bytes\n",
  "build/builds/STABLE_WITNESS/native-lock-witness.node": "witness placeholder bytes\n",
  "build/inputs/headers/node/common.gypi": "gypi\n",
  "build/inputs/node/SHASUMS256.txt": "shasums\n",
  "preparation/toolchain.json": "{}\n",
} as const);

async function materialize(archiveRoot: string, contents: ReadonlyMap<string, string>) {
  for (const [physical, text] of contents) {
    const target = resolve(archiveRoot, ...physical.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, text, { encoding: "utf8", flag: "wx" });
  }
}

async function fixture(options: ReportOptions = {}): Promise<Fixture> {
  const root = await temporaryRoot("op-native-lock-archive-");
  const archiveRoot = resolve(root, "preparation");
  await mkdir(archiveRoot);
  const custodyRoot =
    options.custodyRoot === undefined
      ? resolve(root, "case", "iss022-native-lock-a1")
      : options.custodyRoot;
  const report = makeReport({ ...options, custodyRoot });
  const contents = new Map<string, string>();
  const sealed: NativeLockBuildFile[] = [];
  for (const [physical, text] of Object.entries(baseSealedContents)) {
    contents.set(physical, text);
    sealed.push(sealedRow(physical, text));
  }
  for (const row of report.controls as readonly { controlId: string; refused: boolean | null }[]) {
    contents.set(
      `controls/${row.controlId}/observation.json`,
      `{"controlId":"${row.controlId}"}\n`,
    );
    if (row.refused !== null) contents.set(`controls/${row.controlId}/input.json`, "{}\n");
  }
  for (const row of report.cases as readonly {
    caseId: string;
    events: readonly Record<string, unknown>[];
  }[])
    for (const actor of new Set(
      row.events
        .map((event) => String(event.actor))
        .filter((actor) => (hostedNativeLockChildActors as readonly string[]).includes(actor)),
    ))
      for (const stream of ["stderr", "stdout"])
        contents.set(`build/transcripts/${row.caseId}/${actor}.${stream}`, `${actor} ${stream}\n`);
  contents.set(
    hostedNativeLockDiagnosticsPath,
    canonicalJson({
      captures: [],
      cleanupFailures: [],
      custody: report.custody,
      setupCalls: [],
    }),
  );
  await materialize(archiveRoot, contents);
  return { archiveRoot, contents, report, root, sealed };
}

function sealInput(value: Fixture) {
  return { archiveRoot: value.archiveRoot, report: value.report, sealedFiles: value.sealed };
}

const emptyGate = () => Object.freeze([]) as readonly string[];

function gatesWithout(name: keyof HostedNativeLockArchiveGates): HostedNativeLockArchiveGates {
  return Object.freeze({
    ...hostedNativeLockArchiveGates,
    [name]: emptyGate,
  }) as unknown as HostedNativeLockArchiveGates;
}

function nativeContext(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const base = {
    action: "iss022_native_lock_experiment",
    candidateRevision,
    candidateSubjectDigest: "1".repeat(64),
    caseCensusDigest: "2".repeat(64),
    controlCensusDigest: "3".repeat(64),
    event: "repository_dispatch",
    harnessBundleDigest: "4".repeat(64),
    prerequisiteCensusDigest: "5".repeat(64),
    protectedRefDigest: "6".repeat(64),
    repository,
    repositoryId: "1",
    requiredJobRegistryDigest: "7".repeat(64),
    runAttempt,
    runId,
    schemaVersion: "hosted-native-lock-plan-context/v1",
    testBundleDigest: "8".repeat(64),
    vectorCensusDigest: "9".repeat(64),
    workflowPath: ".github/workflows/conformance.yml",
    workflowRef,
    workflowRevision,
  };
  const provider = parseGithubProviderRunContext({
    candidateRevision: base.candidateRevision,
    candidateSubjectDigest: base.candidateSubjectDigest,
    event: base.event,
    harnessBundleDigest: base.harnessBundleDigest,
    protectedRefDigest: base.protectedRefDigest,
    repositoryId: base.repositoryId,
    requiredJobRegistryDigest: base.requiredJobRegistryDigest,
    runAttempt: base.runAttempt,
    runId: base.runId,
    testBundleDigest: base.testBundleDigest,
    workflowPath: base.workflowPath,
    workflowRef: base.workflowRef,
    workflowRevision: base.workflowRevision,
  });
  if (!provider.ok) throw new Error(provider.issues.join(","));
  return {
    ...base,
    providerRunDigest: computeGithubProviderRunDigest(provider.value),
    ...overrides,
  };
}

async function entryInput(overrides: Readonly<Record<string, unknown>> = {}) {
  const root = await temporaryRoot("op-native-lock-entry-");
  const candidateRoot = resolve(root, "candidate");
  const runnerTemp = resolve(root, "temp");
  const stableRoot = resolve(root, "stable");
  await Promise.all([mkdir(candidateRoot), mkdir(runnerTemp), mkdir(stableRoot)]);
  return {
    candidateRoot,
    context: nativeContext(),
    environment: { RUNNER_OS: localRunnerOs },
    jobId: hostedNativeLockObservationJobId(localFamily),
    runnerTemp,
    runnerToken: hostedNativeLockRunnerToken,
    stableRoot,
    ...overrides,
  };
}

async function fileSymlinksAvailable(root: string): Promise<boolean> {
  const target = resolve(root, "symlink-probe-target");
  await writeFile(target, "probe\n", "utf8");
  try {
    await symlink(target, resolve(root, "symlink-probe-link"), "file");
    return true;
  } catch {
    return false;
  }
}

describe("ISS-048 per-OS diagnostic archive collector", () => {
  test("derives the finite retained census from the report, builds and fixtures and seals it", async () => {
    const value = await fixture();
    const sealedResult = await sealHostedNativeLockArchive(sealInput(value));
    expect(sealedResult.ok).toBe(true);
    if (!sealedResult.ok) return;
    expect(sealedResult.archiveName).toBe(
      `iss022-native-lock-${runId}-${runAttempt}-${localFamily.toLowerCase()}`,
    );
    expect(sealedResult.reportPath).toBe(hostedNativeLockArchiveReportPath);
    const paths = sealedResult.files.map((row) => row.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(paths);
    // Every physical member of the tree, mapped once, plus the report itself.
    expect(new Set(paths)).toEqual(
      new Set([
        ...[...value.contents.keys()].map(hostedNativeLockArchivePath),
        hostedNativeLockArchiveReportPath,
      ]),
    );
    // The fixed control paths follow the report's own arms: the three
    // unavailable rows keep only `observation.json`.
    for (const [index, controlId] of hostedNativeLockControlIds.entries()) {
      expect(paths).toContain(`controls/${controlId}/observation.json`);
      expect(paths.includes(`controls/${controlId}/input.json`)).toBe(index >= 3);
    }
    // The sole declared rebasing: `build/transcripts/` becomes `transcripts/`.
    expect(paths).toContain(`transcripts/${hostedNativeLockCaseIds[0]}/HOLDER.stdout`);
    expect(paths.some((path) => path.startsWith("build/transcripts/"))).toBe(false);
    expect(paths).toContain(hostedNativeLockDiagnosticsPath);
    // Retained bytes, never a substituted digest.
    for (const row of sealedResult.files) {
      const physical = hostedNativeLockPhysicalPath(row.path);
      const bytes = await readFile(resolve(value.archiveRoot, ...physical.split("/")));
      expect(row.byteLength).toBe(String(bytes.byteLength));
      expect(row.sha256).toBe(sha256(Uint8Array.from(bytes)));
    }
    // The report is serialized after the census as the archive's one further
    // member; the archive root's children are then exactly four.
    expect((await readdir(value.archiveRoot)).sort()).toEqual(
      [...hostedNativeLockArchiveChildren, hostedNativeLockArchiveReportPath].sort(),
    );
    expect(
      await readFile(resolve(value.archiveRoot, hostedNativeLockArchiveReportPath), "utf8"),
    ).toBe(canonicalJson(value.report));
    // Immutable: a second seal over the same root refuses rather than rewrites.
    expect(await sealHostedNativeLockArchive(sealInput(value))).toEqual({
      issues: ["native-lock-observation:archive-children-refused"],
      ok: false,
    });
  }, 120_000);

  test("refuses a missing control file", async () => {
    const value = await fixture();
    await rm(
      resolve(value.archiveRoot, "controls", hostedNativeLockControlIds[0]!, "observation.json"),
    );
    expect(await sealHostedNativeLockArchive(sealInput(value))).toEqual({
      issues: ["native-lock-observation:retained-file-missing"],
      ok: false,
    });
    const executed = await fixture();
    await rm(
      resolve(executed.archiveRoot, "controls", hostedNativeLockControlIds[11]!, "input.json"),
    );
    expect(await sealHostedNativeLockArchive(sealInput(executed))).toEqual({
      issues: ["native-lock-observation:retained-file-missing"],
      ok: false,
    });
  }, 60_000);

  test("refuses an extra file, including a control input on an unavailable row", async () => {
    const value = await fixture();
    await writeFile(resolve(value.archiveRoot, "preparation", "extra.txt"), "extra\n", "utf8");
    expect(await sealHostedNativeLockArchive(sealInput(value))).toEqual({
      issues: ["native-lock-observation:retained-file-extra"],
      ok: false,
    });
    // The ledger's presence rule: an unavailable row forbids its `input.json`.
    const forbidden = await fixture();
    await writeFile(
      resolve(forbidden.archiveRoot, "controls", hostedNativeLockControlIds[0]!, "input.json"),
      "{}\n",
      "utf8",
    );
    expect(await sealHostedNativeLockArchive(sealInput(forbidden))).toEqual({
      issues: ["native-lock-observation:retained-file-extra"],
      ok: false,
    });
  }, 60_000);

  test("refuses a retained path with a dot, parent, escaping or rebasing component", async () => {
    for (const path of [
      "build/../escape.txt",
      "build/./toolchain.json",
      "build//toolchain.json",
      "build\\toolchain.json",
      "/absolute/toolchain.json",
      "toolchain.json",
      "transcripts/x/HOLDER.stdout",
      "preparation/native-lock",
      "build/transcripts/NATIVE_UNRELATED_EXCLUSION/HOLDER.stdout",
    ]) {
      const value = await fixture();
      const result = await sealHostedNativeLockArchive({
        ...sealInput(value),
        sealedFiles: [...value.sealed, sealedRow(path, "x\n")],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.issues.some(
          (issue) =>
            issue === "native-lock-observation:retained-path-refused" ||
            issue === "native-lock-observation:sealed-census-refused",
        ),
      ).toBe(true);
    }
  }, 120_000);

  test("refuses a symlinked archive entry", async () => {
    // A junctioned directory needs no privilege on Windows and is the vector
    // the `links` gate owns on every OS.
    const junctioned = await fixture();
    const target = resolve(junctioned.root, "outside-empty");
    await mkdir(target);
    let junction = true;
    try {
      await symlink(
        target,
        resolve(junctioned.archiveRoot, "preparation", "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      junction = false;
    }
    expect(junction || process.platform === "win32").toBe(true);
    if (junction)
      expect(await sealHostedNativeLockArchive(sealInput(junctioned))).toEqual({
        issues: ["native-lock-observation:archive-entry-not-regular"],
        ok: false,
      });

    // A file symlink standing in for a retained file. Hosted Windows may refuse
    // to create one without privilege; that is skipped with a reason, never
    // silently passed.
    const linked = await fixture();
    if (await fileSymlinksAvailable(linked.root)) {
      const retained = resolve(linked.archiveRoot, "preparation", "toolchain.json");
      const replacement = resolve(linked.root, "toolchain-target.json");
      await writeFile(replacement, "{}\n", "utf8");
      await rm(retained);
      await symlink(replacement, retained, "file");
      expect(await sealHostedNativeLockArchive(sealInput(linked))).toEqual({
        issues: ["native-lock-observation:archive-entry-not-regular"],
        ok: false,
      });
    } else expect(process.platform).toBe("win32");
  }, 60_000);

  test("refuses a duplicated retained path", async () => {
    const value = await fixture();
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(value),
        sealedFiles: [...value.sealed, sealedRow("preparation/toolchain.json", "{}\n")],
      }),
    ).toEqual({ issues: ["native-lock-observation:retained-path-duplicated"], ok: false });
    // A derived control path colliding with a sealed row is the same refusal.
    const collided = await fixture();
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(collided),
        sealedFiles: [
          ...collided.sealed,
          {
            ...sealedRow("build/x", "{}\n"),
            path: `controls/${hostedNativeLockControlIds[0]}/observation.json`,
          },
        ],
      }),
    ).toEqual({ issues: ["native-lock-observation:retained-path-duplicated"], ok: false });
  }, 60_000);

  test("binds every sealed row to the post-case census byte for byte", async () => {
    const changed = await fixture();
    const [first, ...rest] = changed.sealed;
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(changed),
        sealedFiles: [{ ...first!, sha256: "0".repeat(64) }, ...rest],
      }),
    ).toEqual({ issues: ["native-lock-observation:sealed-row-not-retained"], ok: false });
    const resized = await fixture();
    const [head, ...tail] = resized.sealed;
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(resized),
        sealedFiles: [{ ...head!, byteLength: "1" }, ...tail],
      }),
    ).toEqual({ issues: ["native-lock-observation:sealed-row-not-retained"], ok: false });
  }, 60_000);

  test("refuses an archive over the closed bound", async () => {
    const value = await fixture();
    const extra: NativeLockBuildFile[] = [];
    const contents = new Map<string, string>();
    for (let index = 0; index <= hostedNativeLockArchiveBound.otherEntries; index += 1) {
      const path = `preparation/bulk/${index}.txt`;
      contents.set(path, "b\n");
      extra.push(sealedRow(path, "b\n"));
    }
    await materialize(value.archiveRoot, contents);
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(value),
        sealedFiles: [...value.sealed, ...extra],
      }),
    ).toEqual({ issues: ["native-lock-observation:archive-over-bound"], ok: false });
  }, 120_000);

  test("keeps the fixed-lock custody root out of the archive", async () => {
    const inside = await fixture({ custodyRoot: null });
    const report = makeReport({ custodyRoot: null });
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(inside),
        report: {
          ...report,
          custody: { ...custodyOf(resolve(inside.archiveRoot, "iss022-native-lock-a1")) },
        },
      }),
    ).toEqual({ issues: ["native-lock-observation:custody-root-not-external"], ok: false });
    // No retained file may carry the fixed leaf name either.
    const leaf = await fixture();
    await writeFile(resolve(leaf.archiveRoot, "preparation", "native-lock"), "A", "utf8");
    expect(
      await sealHostedNativeLockArchive({
        ...sealInput(leaf),
        sealedFiles: [...leaf.sealed, sealedRow("preparation/native-lock", "A")],
      }),
    ).toEqual({ issues: ["native-lock-observation:retained-path-refused"], ok: false });
  }, 60_000);

  test("applies the case-diagnostics presence and custody rules", async () => {
    // The case phase never ran, so the file is refused.
    const absent = await fixture({ custodyRoot: null });
    expect(await sealHostedNativeLockArchive(sealInput(absent))).toEqual({
      issues: ["native-lock-observation:case-diagnostics-presence-refused"],
      ok: false,
    });
    // The case phase ran, so the file is required exactly once.
    const missing = await fixture();
    await rm(resolve(missing.archiveRoot, ...hostedNativeLockDiagnosticsPath.split("/")));
    expect(await sealHostedNativeLockArchive(sealInput(missing))).toEqual({
      issues: ["native-lock-observation:case-diagnostics-presence-refused"],
      ok: false,
    });
    // A disagreeing custody refuses; no diagnostics fact may outrank the report.
    const disagreeing = await fixture();
    const target = resolve(disagreeing.archiveRoot, ...hostedNativeLockDiagnosticsPath.split("/"));
    const text = canonicalJson({
      captures: [],
      cleanupFailures: [],
      custody: custodyOf("/tmp/some-other-root"),
      setupCalls: [],
    });
    await writeFile(target, text, "utf8");
    const rebound = disagreeing.sealed;
    expect(
      await sealHostedNativeLockArchive({ ...sealInput(disagreeing), sealedFiles: rebound }),
    ).toEqual({ issues: ["native-lock-observation:case-diagnostics-custody-refused"], ok: false });
  }, 60_000);

  test("the per-OS half of MISSING_OR_MIXED_CENSUS is fully executable here", async () => {
    const report = makeReport();
    const controls = report.controls as Record<string, unknown>[];
    for (const mutate of [
      (rows: Record<string, unknown>[]) => rows.pop(),
      (rows: Record<string, unknown>[]) => rows.push({ ...rows[0]! }),
      (rows: Record<string, unknown>[]) => rows.reverse(),
      (rows: Record<string, unknown>[]) => (rows[5] = { ...rows[5]!, controlId: "OTHER" }),
      (rows: Record<string, unknown>[]) => (rows[5] = { ...rows[5]!, refused: null }),
      (rows: Record<string, unknown>[]) => (rows[0] = { ...rows[0]!, result: "REFUSED" }),
    ]) {
      const rows = controls.map((row) => ({ ...row }));
      mutate(rows);
      const parsed = parseHostedNativeLockObservationReport({ ...report, controls: rows });
      expect(parsed.ok).toBe(false);
    }
    const cases = report.cases as Record<string, unknown>[];
    for (const mutate of [
      (rows: Record<string, unknown>[]) => rows.pop(),
      (rows: Record<string, unknown>[]) => rows.reverse(),
      (rows: Record<string, unknown>[]) => (rows[0] = { ...rows[0]!, caseId: "OTHER" }),
    ]) {
      const rows = cases.map((row) => ({ ...row }));
      mutate(rows);
      expect(parseHostedNativeLockObservationReport({ ...report, cases: rows }).ok).toBe(false);
    }
    for (const open of [{ extra: true }, {}]) {
      const value: Record<string, unknown> = { ...report, ...open };
      if (Object.keys(open).length === 0) delete value.custody;
      expect(parseHostedNativeLockObservationReport(value).ok).toBe(false);
    }
  }, 60_000);

  test("derives transcript rows only for a retained case's actual child actors", async () => {
    const actors = new Map([
      [hostedNativeLockCaseIds[0]!, ["CONTENDER", "HOLDER"]],
      [hostedNativeLockCaseIds[2]!, ["DEFAULT_CHILD", "HOLDER"]],
    ]);
    const value = await fixture({ actors });
    const result = await sealHostedNativeLockArchive(sealInput(value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.files.map((row) => row.path);
    for (const actor of ["CONTENDER", "HOLDER"])
      for (const stream of ["stderr", "stdout"])
        expect(paths).toContain(`transcripts/${hostedNativeLockCaseIds[0]}/${actor}.${stream}`);
    expect(paths).toContain(`transcripts/${hostedNativeLockCaseIds[2]}/DEFAULT_CHILD.stdout`);
    expect(paths.some((path) => path.includes(`${hostedNativeLockCaseIds[1]}/`))).toBe(false);
    // A `DEFAULT_CHILD` addressed but never closed retained no capture, so it
    // retains no transcript row either.
    const report = makeReport({ actors });
    const rows = (report.cases as Record<string, unknown>[]).map((row) => ({ ...row }));
    rows[2] = {
      ...rows[2]!,
      events: (rows[2]!.events as Record<string, unknown>[]).filter(
        (event) => !(event.actor === "DEFAULT_CHILD" && event.kind === "CLOSE"),
      ),
    };
    const parsed = parseHostedNativeLockObservationReport({ ...report, cases: rows });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.cases[2]?.childActors).toEqual(["HOLDER"]);
  }, 60_000);

  test("the archive-relative mapping is total, injective and has one exception", () => {
    for (const path of [
      "build/inputs/node/node.tar.gz",
      "preparation/toolchain.json",
      "controls/BYPASS_LOCK/observation.json",
      "transcripts/NATIVE_NORMAL_RELEASE/HOLDER.stderr",
    ]) {
      expect(hostedNativeLockArchivePath(hostedNativeLockPhysicalPath(path))).toBe(path);
      expect(hostedNativeLockArchivePrefixes.some((prefix) => path.startsWith(prefix))).toBe(true);
    }
    expect(hostedNativeLockPhysicalPath("transcripts/A/HOLDER.stdout")).toBe(
      "build/transcripts/A/HOLDER.stdout",
    );
    expect(hostedNativeLockArchivePath("build/transcripts/A/HOLDER.stdout")).toBe(
      "transcripts/A/HOLDER.stdout",
    );
    expect(hostedNativeLockArchivePath("build/case-diagnostics.json")).toBe(
      "build/case-diagnostics.json",
    );
    expect(hostedNativeLockArchiveName("0", runAttempt, localFamily)).toBeUndefined();
    expect(
      hostedNativeLockArchiveName(runId, runAttempt, "OTHER" as HostedNativeLockOperatingSystem),
    ).toBeUndefined();
  });

  test("takes the sealed census from the builder's own return, never from a caller", () => {
    const rows = [sealedRow("build/inputs/node/SHASUMS256.txt", "shasums\n")];
    const pending = {
      buildPathPrefix: "build/",
      retainedFiles: rows,
      status: "PENDING_CANDIDATE_CONSUME",
    };
    expect(hostedNativeLockSealedCensus(pending as never)).toEqual({ files: rows, ok: true });
    for (const mutant of [
      { ...pending, status: "OTHER" },
      { ...pending, buildPathPrefix: "" },
      { ...pending, retainedFiles: [] },
      { ...pending, retainedFiles: [{ ...rows[0]!, path: "build/../x" }] },
      { ...pending, retainedFiles: [{ ...rows[0]!, path: "controls/x" }] },
      { ...pending, retainedFiles: [{ ...rows[0]!, sha256: "z".repeat(64) }] },
      { ...pending, retainedFiles: [{ ...rows[0]!, byteLength: "01" }] },
      { ...pending, retainedFiles: [rows[0]!, rows[0]!] },
    ])
      expect(hostedNativeLockSealedCensus(mutant as never)).toEqual({
        issues: ["native-lock-preparation:sealed-census-refused"],
        ok: false,
      });
  });

  test("refuses a non-canonical archive root", async () => {
    // Decision #300 ruling A. The hosted macOS `tmpdir()` is the `/var` alias of
    // `/private/var` and the hosted Windows one is the `RUNNER~1` alias, so the
    // canonical-root contract is exercised here in both directions: an alias
    // refuses, and the same tree under its canonical spelling seals.
    const value = await fixture();
    const alias = resolve(value.root, "alias");
    let linked = true;
    try {
      await symlink(value.root, alias, process.platform === "win32" ? "junction" : "dir");
    } catch {
      linked = false;
    }
    if (linked)
      expect(
        await sealHostedNativeLockArchive({
          ...sealInput(value),
          archiveRoot: resolve(alias, "preparation"),
        }),
      ).toEqual({ issues: ["native-lock-observation:archive-root-refused"], ok: false });
    else expect(process.platform).toBe("win32");
    const separator = process.platform === "win32" ? "\\" : "/";
    // The lowercased-spelling variant only exists on disk when the filesystem
    // is case-insensitive (Windows NTFS, and the default case-insensitive
    // APFS on hosted macOS runners): only then does the lowercased path
    // resolve to the same directory, letting `sealHostedNativeLockArchive`
    // take the `archive-root-refused` branch for it. On hosted Linux's
    // case-sensitive ext4 the lowercased path does not exist, so the module
    // correctly takes its unrelated `archive-unreadable` branch instead -- a
    // different, correct module outcome, not a defect (review receipt for
    // 92d92f2, BLOCKER 1). Probe once, against a path segment this fixture
    // created with a known-lowercase spelling ("preparation"), rather than
    // against the temporary root's own spelling: the root's `mkdtemp` suffix
    // is only mixed-case ~96% of the time, so probing it directly would
    // silently reintroduce the same flakiness this fix removes.
    let caseInsensitive: boolean;
    try {
      await lstat(resolve(value.root, "PREPARATION"));
      caseInsensitive = true;
    } catch {
      caseInsensitive = false;
    }
    if (!caseInsensitive)
      // Skipped with a reason, not a silent pass: a case-sensitive filesystem
      // is expected only on hosted Linux. If this ever held on Windows or
      // macOS it would mean the probe above is wrong, not that the skip is
      // safe.
      expect(process.platform).toBe("linux");
    const variants = [
      `${value.archiveRoot}${separator}.`,
      `${resolve(value.archiveRoot, "..", "preparation")}${separator}.`,
      value.archiveRoot.replace(
        /^([A-Za-z]):/,
        (_match, drive: string) => `${drive.toLowerCase()}:`,
      ),
      ...(caseInsensitive ? [value.archiveRoot.toLowerCase()] : []),
    ].filter((path, index, all) => path !== value.archiveRoot && all.indexOf(path) === index);
    for (const archiveRoot of variants)
      expect({
        archiveRoot,
        result: await sealHostedNativeLockArchive({ ...sealInput(value), archiveRoot }),
      }).toEqual({
        archiveRoot,
        result: { issues: ["native-lock-observation:archive-root-refused"], ok: false },
      });
    expect((await sealHostedNativeLockArchive(sealInput(value))).ok).toBe(true);
  }, 120_000);

  test("every new gate has a deletion mutant that is not tautological", async () => {
    // Each row: the gate, the defect its vector introduces, and the proof that
    // deleting exactly that gate accepts the defect.
    const vectors: readonly {
      readonly gate: keyof HostedNativeLockArchiveGates;
      readonly issue: string;
      readonly apply: (
        value: Fixture,
      ) => Promise<Parameters<typeof sealHostedNativeLockArchive>[0]>;
    }[] = [
      {
        apply: async (value) => {
          await writeFile(resolve(value.archiveRoot, "preparation", "native-lock"), "A", "utf8");
          return {
            ...sealInput(value),
            sealedFiles: [...value.sealed, sealedRow("preparation/native-lock", "A")],
          };
        },
        gate: "hygiene",
        issue: "native-lock-observation:retained-path-refused",
      },
      {
        apply: async (value) => ({
          ...sealInput(value),
          sealedFiles: [...value.sealed, sealedRow("preparation/toolchain.json", "{}\n")],
        }),
        gate: "duplicates",
        issue: "native-lock-observation:retained-path-duplicated",
      },
      {
        apply: async (value) => {
          await writeFile(
            resolve(value.archiveRoot, "preparation", "extra.txt"),
            "extra\n",
            "utf8",
          );
          return sealInput(value);
        },
        gate: "census",
        issue: "native-lock-observation:retained-file-extra",
      },
      {
        apply: async (value) => {
          const [first, ...rest] = value.sealed;
          return {
            ...sealInput(value),
            sealedFiles: [{ ...first!, sha256: "0".repeat(64) }, ...rest],
          };
        },
        gate: "binding",
        issue: "native-lock-observation:sealed-row-not-retained",
      },
      {
        apply: async (value) => {
          const extra: NativeLockBuildFile[] = [];
          const contents = new Map<string, string>();
          for (let index = 0; index <= hostedNativeLockArchiveBound.otherEntries; index += 1) {
            const path = `preparation/bulk/${index}.txt`;
            contents.set(path, "b\n");
            extra.push(sealedRow(path, "b\n"));
          }
          await materialize(value.archiveRoot, contents);
          return { ...sealInput(value), sealedFiles: [...value.sealed, ...extra] };
        },
        gate: "bound",
        issue: "native-lock-observation:archive-over-bound",
      },
      {
        apply: async (value) => {
          const target = resolve(value.root, "outside-empty");
          await mkdir(target);
          await symlink(
            target,
            resolve(value.archiveRoot, "preparation", "linked"),
            process.platform === "win32" ? "junction" : "dir",
          );
          return sealInput(value);
        },
        gate: "links",
        issue: "native-lock-observation:archive-entry-not-regular",
      },
      {
        apply: async (value) => {
          const custody = custodyOf(resolve(value.archiveRoot, "iss022-native-lock-a1"));
          // The diagnostics file follows the report's custody, so that deleting
          // the `custodyRoot` gate leaves no other gate holding this vector.
          await writeFile(
            resolve(value.archiveRoot, ...hostedNativeLockDiagnosticsPath.split("/")),
            canonicalJson({ captures: [], cleanupFailures: [], custody, setupCalls: [] }),
            "utf8",
          );
          return { ...sealInput(value), report: { ...value.report, custody } };
        },
        gate: "custodyRoot",
        issue: "native-lock-observation:custody-root-not-external",
      },
      {
        apply: async (value) => {
          await writeFile(
            resolve(value.archiveRoot, ...hostedNativeLockDiagnosticsPath.split("/")),
            canonicalJson({
              captures: [],
              cleanupFailures: [],
              custody: custodyOf("/tmp/some-other-root"),
              setupCalls: [],
            }),
            "utf8",
          );
          return sealInput(value);
        },
        gate: "diagnostics",
        issue: "native-lock-observation:case-diagnostics-custody-refused",
      },
    ];
    expect(vectors.map((row) => row.gate).sort()).toEqual(
      Object.keys(hostedNativeLockArchiveGates).sort(),
    );
    for (const vector of vectors) {
      const real = await fixture();
      expect(await sealHostedNativeLockArchive(await vector.apply(real))).toEqual({
        issues: [vector.issue],
        ok: false,
      });
      const deleted = await fixture();
      const result = await sealHostedNativeLockArchive(
        await vector.apply(deleted),
        gatesWithout(vector.gate),
      );
      expect({ gate: vector.gate, ok: result.ok }).toEqual({ gate: vector.gate, ok: true });
    }
  }, 300_000);
});

describe("ISS-048 native-lock single-OS observation entry", () => {
  test("refuses a wrong runner token", async () => {
    expect(
      await runHostedNativeLockObservation(
        await entryInput({ runnerToken: "ISS022_PORTABLE_PRIMITIVES" }),
      ),
    ).toEqual({ issues: ["native-lock-observation:runner-token-refused"], ok: false });
    expect(await runHostedNativeLockObservation(await entryInput({ runnerToken: "" }))).toEqual({
      issues: ["native-lock-observation:runner-token-refused"],
      ok: false,
    });
  }, 60_000);

  test("refuses a wrong job identifier", async () => {
    for (const jobId of [
      hostedNativeLockObservationJobId(otherFamily),
      `${hostedNativeLockSuiteId}-other`,
      "iss022-portable-primitives-linux",
      hostedNativeLockSuiteId,
    ])
      expect(await runHostedNativeLockObservation(await entryInput({ jobId }))).toEqual({
        issues: ["native-lock-observation:job-identifier-refused"],
        ok: false,
      });
  }, 60_000);

  test("refuses a wrong OS family", async () => {
    for (const environment of [{ RUNNER_OS: otherRunnerOs }, { RUNNER_OS: "Plan9" }, {}])
      expect(await runHostedNativeLockObservation(await entryInput({ environment }))).toEqual({
        issues: ["native-lock-observation:operating-system-refused"],
        ok: false,
      });
  }, 60_000);

  test("refuses a context whose provider-run digest does not recompute", async () => {
    for (const context of [
      nativeContext({ providerRunDigest: "0".repeat(64) }),
      nativeContext({ runId: "4" }),
      nativeContext({ candidateSubjectDigest: "f".repeat(64) }),
      nativeContext({ harnessBundleDigest: "f".repeat(64) }),
      nativeContext({ workflowRevision: "c".repeat(40) }),
    ]) {
      expect(parseHostedNativeLockObservationContext(context)).toBeUndefined();
      expect(await runHostedNativeLockObservation(await entryInput({ context }))).toEqual({
        issues: ["native-lock-observation:context-refused"],
        ok: false,
      });
    }
    // The unmutated context recomputes and is accepted.
    expect(parseHostedNativeLockObservationContext(nativeContext())).toBeDefined();
    expect(
      decodeHostedNativeLockObservationContext(
        Buffer.from(canonicalJson(nativeContext()), "utf8").toString("base64url"),
      ),
    ).toBeDefined();
    for (const encoded of ["", "not base64url!", Buffer.from("{}", "utf8").toString("base64url")])
      expect(decodeHostedNativeLockObservationContext(encoded)).toBeUndefined();
  }, 60_000);

  test("does nothing at all while no observer is registered", async () => {
    const input = await entryInput();
    expect(await runHostedNativeLockObservation(input)).toEqual({
      issues: ["native-lock-observation:observer-not-registered"],
      ok: false,
    });
    // The refusal precedes every filesystem step: no root was allocated.
    expect((await readdir(input.runnerTemp)).length).toBe(0);
    await expect(runHostedNativeLockObservationEntry()).rejects.toThrow(
      "native-lock-observation:provider-context-refused",
    );
  }, 60_000);

  test("is reachable from no workflow and from no dispatch registration", async () => {
    const workflowRoot = resolve(repositoryRoot, ".github/workflows");
    const workflows = (await readdir(workflowRoot)).sort();
    expect(workflows).toEqual(["bootstrap.yml", "conformance.yml"]);
    for (const name of workflows) {
      const text = await readFile(resolve(workflowRoot, name), "utf8");
      for (const token of [
        "hosted-native-lock-observation",
        "runHostedNativeLockObservation",
        "NATIVE_LOCK_PLAN_CONTEXT",
        "native-lock",
        hostedNativeLockRunnerToken,
        hostedNativeLockSuiteId,
        "iss022_native_lock_experiment",
      ])
        expect({ name, token, present: text.includes(token) }).toEqual({
          name,
          token,
          present: false,
        });
    }
    const dispatcher = await readFile(
      resolve(repositoryRoot, "scripts/conformance/hosted.mts"),
      "utf8",
    );
    expect(dispatcher).toContain(
      'const modes = new Set(["aggregate", "observation", "plan-finalize", "plan-select", "record"]);',
    );
    expect(dispatcher.includes("native-lock")).toBe(false);
  }, 60_000);

  test("the ordinary hosted observation entry and its six-file census stay byte-identical", async () => {
    const bytes = await readFile(
      resolve(repositoryRoot, "scripts/conformance/hosted-observation.mts"),
    );
    // The committed blob at the sub-slice 3.5 base, recomputed here without
    // invoking Git. `scripts/conformance/**` is `text eol=lf`, so the working
    // tree bytes equal the blob bytes on every OS.
    expect(bytes.byteLength).toBe(18780);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "0b54b98d279678e4eca3e29c21a8186ca31cc0fa6d1fc6ec8d65d0b7180a1dd9",
    );
    expect(
      createHash("sha1")
        .update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"), bytes]))
        .digest("hex"),
    ).toBe("03de18a9f157b751f20fc0f3373e8f3112f459f6");
    const text = bytes.toString("utf8");
    expect(text).toContain(
      '"environment\\0environment-record.json\\0raw-manifest.json\\0report\\0stderr\\0stdout"',
    );
    expect(text.includes("native-lock")).toBe(false);
    // The landed observation-archive verifier's own six-name census is likewise
    // untouched by this slice.
    const verifier = await readFile(
      resolve(repositoryRoot, "packages/conformance/src/github-artifacts.ts"),
      "utf8",
    );
    expect(verifier).toContain(
      '    "environment",\n    "environment-record.json",\n    "raw-manifest.json",\n    "report",\n    "stderr",\n    "stdout",\n',
    );
    expect(verifier.includes("native-lock")).toBe(false);
  }, 60_000);

  test("the derived census never reads a control input file", async () => {
    const value = await fixture();
    // Every control input file carries a hostile payload; the derivation must
    // still produce exactly the census the report's own arms imply.
    for (const controlId of hostedNativeLockControlIds.slice(3)) {
      await writeFile(
        resolve(value.archiveRoot, "controls", controlId, "input.json"),
        '{"runId":"99","result":"OBSERVED","refused":true}\n',
        "utf8",
      );
      const row = value.sealed;
      expect(row.some((entry) => entry.path.startsWith("controls/"))).toBe(false);
    }
    const parsed = parseHostedNativeLockObservationReport(value.report);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const derived = deriveHostedNativeLockArchiveCensus(parsed.value, value.sealed);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect([...derived.value.keys()].filter((path) => path.endsWith("/input.json")).length).toBe(9);
    expect(parsed.value.runId).toBe(runId);
    expect(parsed.value.jobId).toBe(hostedNativeLockObservationJobId(localFamily));
  }, 60_000);
});

import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hostedNativeLockControlIds } from "../../scripts/conformance/hosted-native-lock-plan.mjs";
import { hostedNativeLockCandidateSourcePath } from "../../scripts/conformance/hosted-native-lock-preparation.mjs";

/**
 * ISS-048 stage-three sub-slice 3.2. Synthetic captured inputs only. Nothing
 * here loads an addon, requires a `.node`, spawns a process, makes a native
 * call, runs a case, seals an archive, writes a report or workflow, or touches
 * anything outside one fresh temporary directory. Nothing here is executable
 * evidence outside the hosted three-OS bootstrap.
 *
 * `probes/portable-primitives/experiment/*.mjs` are landed JavaScript modules
 * with no declaration file, and `tsconfig.json` sets no `allowJs`, so `tsc`
 * reports TS7016 for each import below. Sub-slice 3.2's footprint may not add a
 * declaration file or change the compiler configuration, so every one of them
 * is suppressed once and immediately bound to a locally declared shape.
 */

type Arm = Readonly<{ refused: boolean | null; result: string }>;
type ControlRecord = Readonly<{ controlId: string; refused: boolean | null; result: string }>;
type Observation = Readonly<{
  archiveRelativeInputPath: string | null;
  controlId: string;
  deferredHalves: readonly string[];
  detail: string;
  evidence: string;
  executedHalf: string | null;
  guard: string | null;
  mutant: string | null;
  prerequisite: string | null;
  refused: boolean | null;
  result: string;
}>;
type Census = Readonly<{
  files: ReadonlyArray<Readonly<{ path: string; value: unknown }>>;
  observations: readonly Observation[];
  records: readonly ControlRecord[];
}>;
type Guards = Record<string, (...args: never[]) => unknown>;
type Prerequisites = Readonly<{ candidateBinding: string; custody: string; witness: string }>;
type ControlsModule = Readonly<{
  buildNativeLockControlCensus: (
    input: Readonly<{ prerequisites: Prerequisites }>,
    boundary?: Readonly<{ guards?: Partial<Guards> }>,
  ) => Census;
  checkNativeLockControlCensus: (
    records: unknown,
    presentPaths: readonly string[],
  ) => readonly string[];
  deriveNativeLockControlPrerequisiteArm: (
    prerequisites: unknown,
  ) => Readonly<{ arm: Arm; prerequisite: string }>;
  nativeLockControlArms: Readonly<Record<string, Arm>>;
  nativeLockControlGuards: Readonly<Guards>;
  nativeLockControlPaths: (controlId: string) => Readonly<{
    inputPath: string;
    observationPath: string;
  }>;
  nativeLockControlPrefix: string;
  nativeLockControlPrerequisiteFields: readonly string[];
  runNativeLockControlPhase: (
    archiveRoot: string,
    input: Readonly<{ prerequisites: Prerequisites }>,
    boundary?: Readonly<{ guards?: Partial<Guards> }>,
  ) => Promise<
    Readonly<{
      observations: readonly Observation[];
      records: readonly ControlRecord[];
      retained: readonly string[];
    }>
  >;
}>;
type FactsModule = Readonly<{
  record: (value: unknown, keys: readonly string[]) => Record<string, unknown>;
  refuse: () => never;
  sameIdentity: (left: unknown, right: unknown) => boolean;
}>;
type CaptureModule = Readonly<{
  retainCalls: (journal: unknown, actor: string, value: unknown) => unknown;
}>;
type ReductionModule = Readonly<{
  missingPrerequisites: readonly string[];
  reduceResults: (value: readonly string[]) => string;
}>;

// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as controlsSource from "../../probes/portable-primitives/experiment/controls.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as factsSource from "../../probes/portable-primitives/experiment/facts.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as captureSource from "../../probes/portable-primitives/experiment/capture.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as reductionSource from "../../probes/portable-primitives/experiment/reduction.mjs";

const controls: ControlsModule = controlsSource;
const facts: FactsModule = factsSource;
const capture: CaptureModule = captureSource;
const reduction: ReductionModule = reductionSource;

const {
  buildNativeLockControlCensus,
  checkNativeLockControlCensus,
  deriveNativeLockControlPrerequisiteArm,
  nativeLockControlArms,
  nativeLockControlPaths,
  nativeLockControlPrefix,
  runNativeLockControlPhase,
} = controls;
const { record, refuse, sameIdentity } = facts;

const available: Prerequisites = Object.freeze({
  candidateBinding: "AVAILABLE",
  custody: "AVAILABLE",
  witness: "AVAILABLE",
});
const witnessDependentIds = ["BYPASS_LOCK", "PREMATURE_UNLOCK", "RETAIN_AFTER_RELEASE"] as const;
const inspectionFields = ["nativeHandle", "identity", "nonInheritable", "errorCode"] as const;
const custodyFields = ["rootIdentity", "leafIdentity", "regularFile", "linkCount", "size"] as const;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const sorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

/**
 * The ledger's twelve-row table, pinned here so the module's positional
 * derivation from `hostedNativeLockControlIds` cannot silently re-associate a
 * guard with the wrong control. The module itself never re-types this list.
 */
const expectedRows = [
  { controlId: "BYPASS_LOCK", executable: false, guard: null, mutant: null },
  { controlId: "PREMATURE_UNLOCK", executable: false, guard: null, mutant: null },
  { controlId: "RETAIN_AFTER_RELEASE", executable: false, guard: null, mutant: null },
  {
    controlId: "INHERITABLE_FLAGS",
    executable: true,
    guard: "probes/portable-primitives/experiment/facts.mjs#requireInspection",
    mutant: "stable-inspection-read-back-non-inheritable-false",
  },
  {
    controlId: "INHERITED_IDENTITY",
    executable: true,
    guard: "probes/portable-primitives/experiment/facts.mjs#requireInspection(child)",
    mutant: "child-inspection-same-file-identity-with-claimed-non-inherit-flags",
  },
  {
    controlId: "WRONG_CUSTODY",
    executable: true,
    guard: "probes/portable-primitives/experiment/facts.mjs#requireCustody",
    mutant: "captured-barrier-leaf-identity-substituted",
  },
  {
    controlId: "WRONG_RANGE_OR_FLAGS",
    executable: true,
    guard: "scripts/conformance/hosted-native-lock-preparation.mts#checkCandidateSubjectBinding",
    mutant: "reviewed-call-and-compile-parameters-substituted",
  },
  {
    controlId: "BUILD_OR_LOADER_SUBSTITUTION",
    executable: true,
    guard: "scripts/conformance/hosted-native-lock-preparation.mts#checkPreLoadBuildBinding",
    mutant: "candidate-bytes-substituted-for-the-witness-output",
  },
  {
    controlId: "MALFORMED_OR_FORGED_FACTS",
    executable: true,
    guard: "probes/portable-primitives/experiment/capture.mjs#candidateReply",
    mutant: "pending-reply-carries-an-extra-candidate-verdict-member",
  },
  {
    controlId: "FALSE_DEATH_OR_RETRY",
    executable: true,
    guard: "probes/portable-primitives/experiment/reduction.mjs#reduceCaseTranscripts",
    mutant: "death-row-carries-two-post-death-lock-attempts",
  },
  {
    controlId: "MISSING_OR_MIXED_CENSUS",
    executable: true,
    guard: "probes/portable-primitives/experiment/reduction.mjs#reduceCaseTranscripts",
    mutant: "per-os-case-census-row-duplicated",
  },
  {
    controlId: "CAPABILITY_CONFUSION",
    executable: true,
    guard:
      "packages/conformance/src/iss022-profile.ts#parseIss022SuiteCoordinates;" +
      "packages/conformance/src/portable-primitives-decision.ts#parsePortablePrimitivesCapabilityDecisionCore;" +
      "packages/conformance/src/portable-primitives-publication.ts#checkPortablePrimitivesPublication",
    mutant: "experiment-report-and-observed-fed-to-profile-core-and-publication-parsers",
  },
] as const;

/**
 * One deletion mutant per landed guard, each a scratch copy of that guard's own
 * composition with exactly one gate removed, written from landed exports and
 * never from a copy of the deleted clause. `reduceCaseTranscripts` backs two
 * census rows, so deleting its transcript gate honestly violates both.
 */
const deletionMutants = [
  {
    gate: "requireInspection: parent read-back non-inheritance gate",
    violated: ["INHERITABLE_FLAGS"],
    guards: {
      parentInspection: (value: unknown, expected: unknown) => {
        const parsed = record(value, inspectionFields);
        if (
          parsed.errorCode !== "0" ||
          parsed.identity === null ||
          typeof parsed.nonInheritable !== "boolean"
        )
          refuse();
        if (!sameIdentity(parsed.identity, expected)) refuse();
        return parsed;
      },
    },
  },
  {
    gate: "requireInspection: child same-file identity gate",
    violated: ["INHERITED_IDENTITY"],
    guards: {
      childInspection: (value: unknown, expected: unknown, child: boolean) => {
        const parsed = record(value, inspectionFields);
        if (
          parsed.errorCode !== "0" ||
          parsed.identity === null ||
          typeof parsed.nonInheritable !== "boolean"
        )
          refuse();
        if (!child && (!sameIdentity(parsed.identity, expected) || parsed.nonInheritable !== true))
          refuse();
        return parsed;
      },
    },
  },
  {
    gate: "requireCustody: root and leaf native identity gate",
    violated: ["WRONG_CUSTODY"],
    guards: {
      custodyBarrier: (value: unknown) => {
        const parsed = record(value, custodyFields);
        if (
          parsed.rootIdentity === null ||
          parsed.leafIdentity === null ||
          parsed.regularFile !== true ||
          parsed.linkCount !== "1" ||
          parsed.size !== "1"
        )
          refuse();
        return parsed;
      },
    },
  },
  {
    gate: "checkCandidateSubjectBinding: authenticated candidate-subject digest gate",
    violated: ["WRONG_RANGE_OR_FLAGS"],
    guards: {
      candidateSubjectBinding: (_context: unknown, candidate: CandidateSnapshot) => {
        const found: string[] = [];
        const row = candidate.subject.files.find(
          (value) => value.path === hostedNativeLockCandidateSourcePath,
        );
        const file = candidate.files.find(
          (value) => value.path === hostedNativeLockCandidateSourcePath,
        );
        if (
          !row ||
          !file ||
          file.executable !== row.executable ||
          String(file.bytes.byteLength) !== row.byteLength ||
          sha256(file.bytes) !== row.sha256Digest
        )
          found.push("native-lock-preparation:candidate-source-row-refused");
        return sorted(found);
      },
    },
  },
  {
    gate: "checkPreLoadBuildBinding: retained build-output rehash gate",
    violated: ["BUILD_OR_LOADER_SUBSTITUTION"],
    guards: {
      preLoadBuildBinding: (pending: PendingPreparation) => {
        const found: string[] = [];
        const builds = pending.helper.builds;
        if (builds.length !== 2 || pending.buildPathPrefix !== "build/")
          found.push("native-lock-preparation:build-row-census-refused");
        for (const build of builds)
          if (build.loaded !== null) found.push("native-lock-preparation:loaded-before-collection");
        return sorted(found);
      },
    },
  },
  {
    gate: "candidateReply: closed pending-reply record and candidate verdict gate",
    violated: ["MALFORMED_OR_FORGED_FACTS"],
    guards: {
      pendingCandidateReply: (journal: unknown, actor: string, value: { facts: unknown }) =>
        capture.retainCalls(journal, actor, value.facts),
    },
  },
  {
    gate: "reduceCaseTranscripts: transcript and case-census gate",
    violated: ["FALSE_DEATH_OR_RETRY", "MISSING_OR_MIXED_CENSUS"],
    guards: {
      caseTranscriptReduction: (value: {
        cases: ReadonlyArray<{ caseId: string; result: string }>;
      }) => ({
        cases: value.cases.map((row) => ({
          caseId: row.caseId,
          transcriptResult: row.result,
          failures: [],
        })),
        failures: [],
        missingPrerequisites: reduction.missingPrerequisites,
        result: "UNKNOWN",
        transcriptResult: reduction.reduceResults(value.cases.map((row) => row.result)),
      }),
    },
  },
  {
    gate: "profile, core and publication parsers on the capability path",
    violated: ["CAPABILITY_CONFUSION"],
    guards: {
      suiteCoordinates: (input: unknown) => ({ ok: true, value: input }),
      capabilityDecisionCore: (input: unknown) => ({ ok: true, value: input }),
      publication: () => ({ ok: true, decision: "PASS" }),
    },
  },
] as const;

type CandidateSnapshot = Readonly<{
  files: ReadonlyArray<{ bytes: Uint8Array; executable: boolean; path: string }>;
  subject: Readonly<{
    files: ReadonlyArray<{
      byteLength: string;
      executable: boolean;
      path: string;
      sha256Digest: string;
    }>;
  }>;
}>;
type PendingPreparation = Readonly<{
  buildPathPrefix: string;
  helper: Readonly<{ builds: ReadonlyArray<{ loaded: unknown }> }>;
}>;

const resultOf = (records: readonly ControlRecord[], controlId: string): string | undefined =>
  records.find((row) => row.controlId === controlId)?.result;

describe("ISS-048 captured-input control census", () => {
  let temporary = "";

  beforeEach(async () => {
    temporary = await mkdtemp(resolve(tmpdir(), "iss048-controls-"));
  });
  afterEach(async () => {
    if (temporary) await rm(temporary, { force: true, recursive: true });
  });

  test("derives the twelve ordered rows and their fixed paths from the landed control ID list", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    expect(census.records.map((row) => row.controlId)).toEqual([...hostedNativeLockControlIds]);
    expect(expectedRows.map((row) => row.controlId)).toEqual([...hostedNativeLockControlIds]);
    for (const row of census.records)
      expect(Object.keys(row).sort()).toEqual(["controlId", "refused", "result"]);
    for (const controlId of hostedNativeLockControlIds)
      expect(nativeLockControlPaths(controlId)).toEqual({
        inputPath: `${nativeLockControlPrefix}${controlId}/input.json`,
        observationPath: `${nativeLockControlPrefix}${controlId}/observation.json`,
      });
    expect(() => nativeLockControlPaths("NOT_A_LANDED_CONTROL")).toThrow(
      "native-lock-fixture:refused",
    );
    expect(
      checkNativeLockControlCensus(
        census.records,
        census.files.map((file) => file.path),
      ),
    ).toEqual([]);
  });

  test("refuses every named mutant at the real guard and retains its replayable input", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    for (const [index, expected] of expectedRows.entries()) {
      const observation = census.observations[index]!;
      const label = expected.controlId;
      expect(observation.controlId, label).toBe(expected.controlId);
      expect(observation.guard, label).toBe(expected.guard);
      expect(observation.mutant, label).toBe(expected.mutant);
      if (!expected.executable) {
        expect(observation.refused, label).toBeNull();
        expect(observation.result, label).toBe("UNKNOWN");
        expect(observation.evidence, label).toBe("STABLE_PREREQUISITE_DERIVATION");
        expect(observation.archiveRelativeInputPath, label).toBeNull();
        continue;
      }
      expect(observation.refused, label).toBe(true);
      expect(observation.result, label).toBe("REFUSED");
      expect(observation.evidence, label).toBe("SYNTHETIC_STABLE_GUARD_REPLAY");
      // The honest counterpart of the same captured input reached the same
      // guard and was accepted, so the refusal is discrimination, not a
      // blanket rejection of everything the guard is handed.
      expect(observation.detail, label).toContain("honest counterpart accepted; mutant refused");
      expect(observation.archiveRelativeInputPath, label).toBe(
        nativeLockControlPaths(expected.controlId).inputPath,
      );
    }
    expect(census.observations.filter((row) => row.result === "REFUSED")).toHaveLength(9);
    expect(census.files).toHaveLength(21);
  });

  test("names the deferred stage-four half of every partially executed control", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    const deferred = Object.fromEntries(
      census.observations
        .filter((row) => row.deferredHalves.length > 0)
        .map((row) => [row.controlId, [row.executedHalf, [...row.deferredHalves]]]),
    );
    expect(deferred).toEqual({
      BUILD_OR_LOADER_SUBSTITUTION: [
        "PRE_LOAD_RETAINED_BYTE_REHASH",
        ["POST_LOAD_RETAINED_BYTE_REHASH"],
      ],
      MISSING_OR_MIXED_CENSUS: ["PER_OS_CASE_CENSUS", ["CROSS_OS_CENSUS", "CROSS_ATTEMPT_CENSUS"]],
    });
  });

  test("keeps every guard-deletion mutant discriminating", () => {
    const base = buildNativeLockControlCensus({ prerequisites: available });
    const covered = new Set<string>();
    for (const mutant of deletionMutants) {
      const mutated = buildNativeLockControlCensus(
        { prerequisites: available },
        { guards: mutant.guards as unknown as Partial<Guards> },
      );
      for (const controlId of mutant.violated) {
        covered.add(controlId);
        expect(resultOf(base.records, controlId), mutant.gate).toBe("REFUSED");
        expect(resultOf(mutated.records, controlId), mutant.gate).toBe("VIOLATED");
        const observation = mutated.observations.find((row) => row.controlId === controlId)!;
        expect(observation.refused, mutant.gate).toBe(false);
        expect(observation.detail, mutant.gate).toContain("mutant accepted");
        // An accepted mutant is an executed control, so it keeps both files.
        expect(observation.archiveRelativeInputPath, mutant.gate).not.toBeNull();
      }
      const untouched = mutated.records.filter(
        (row) => !(mutant.violated as readonly string[]).includes(row.controlId),
      );
      expect(
        untouched.every((row) => resultOf(base.records, row.controlId) === row.result),
        mutant.gate,
      ).toBe(true);
    }
    expect([...covered].sort()).toEqual(
      expectedRows
        .filter((row) => row.executable)
        .map((row) => row.controlId)
        .sort(),
    );
  });

  test("refuses every invalid arm pairing, including the per-OS result vocabulary", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    const present = census.files.map((file) => file.path);
    const valid = new Set(
      Object.values(nativeLockControlArms).map((arm) => `${String(arm.refused)}:${arm.result}`),
    );
    let refusedPairings = 0;
    for (const refusedValue of [true, false, null])
      for (const result of ["REFUSED", "VIOLATED", "UNSUPPORTED", "UNKNOWN", "OBSERVED"]) {
        const pairing = `${String(refusedValue)}:${result}`;
        if (valid.has(pairing)) continue;
        refusedPairings += 1;
        const records = census.records.map((row, index) =>
          index === 5 ? { ...row, refused: refusedValue, result } : row,
        );
        expect(checkNativeLockControlCensus(records, present), pairing).toEqual([
          "controls:arm-pairing-refused",
        ]);
      }
    expect(refusedPairings).toBe(11);
    expect(
      checkNativeLockControlCensus(
        census.records.map((row, index) =>
          index === 5 ? { controlId: row.controlId, refused: row.refused } : row,
        ),
        present,
      ),
    ).toEqual(["controls:row-census-refused"]);
  });

  test("refuses a missing row, a duplicate row and a reordered census", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    const present = census.files.map((file) => file.path);
    expect(checkNativeLockControlCensus(census.records.slice(0, -1), present)).toEqual([
      "controls:census-length-refused",
      "controls:census-order-refused",
    ]);
    const duplicated = census.records.map((row, index) => (index === 1 ? census.records[0]! : row));
    expect(checkNativeLockControlCensus(duplicated, present)).toEqual([
      "controls:census-order-refused",
    ]);
    const reordered = [...census.records];
    [reordered[4], reordered[5]] = [reordered[5]!, reordered[4]!];
    expect(checkNativeLockControlCensus(reordered, present)).toEqual([
      "controls:census-order-refused",
    ]);
    expect(
      checkNativeLockControlCensus(census.records, [...present, "controls/EXTRA/input.json"]),
    ).toEqual(["controls:extra-file-refused"]);
  });

  test("forbids an input file on an unavailable row and requires one on an executed row", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    const present = census.files.map((file) => file.path);
    for (const controlId of witnessDependentIds) {
      const paths = nativeLockControlPaths(controlId);
      expect(present).toContain(paths.observationPath);
      expect(present).not.toContain(paths.inputPath);
      expect(checkNativeLockControlCensus(census.records, [...present, paths.inputPath])).toEqual([
        "controls:input-file-forbidden",
      ]);
    }
    const executed = nativeLockControlPaths("WRONG_CUSTODY");
    expect(
      checkNativeLockControlCensus(
        census.records,
        present.filter((path) => path !== executed.inputPath),
      ),
    ).toEqual(["controls:input-file-required"]);
    expect(
      checkNativeLockControlCensus(
        census.records,
        present.filter((path) => path !== executed.observationPath),
      ),
    ).toEqual(["controls:observation-file-required"]);
  });

  test("keeps an unavailable witness from erasing an executable parser row", () => {
    const executable = expectedRows.filter((row) => row.executable).map((row) => row.controlId);
    for (const [prerequisites, expected] of [
      [{ ...available, witness: "UNSUPPORTED" }, "UNSUPPORTED"],
      [{ ...available, candidateBinding: "UNSUPPORTED" }, "UNSUPPORTED"],
      [{ ...available, custody: "UNSUPPORTED" }, "UNSUPPORTED"],
      [{ candidateBinding: "UNKNOWN", custody: "UNKNOWN", witness: "UNKNOWN" }, "UNKNOWN"],
      [available, "UNKNOWN"],
    ] as const) {
      const census = buildNativeLockControlCensus({ prerequisites });
      for (const controlId of witnessDependentIds)
        expect(resultOf(census.records, controlId), expected).toBe(expected);
      for (const controlId of executable)
        expect(resultOf(census.records, controlId), controlId).toBe("REFUSED");
      expect(census.files).toHaveLength(21);
    }
    // No prerequisite state can reach an executed arm for a witness-dependent
    // row: this slice adds no call-interception fixture.
    expect(deriveNativeLockControlPrerequisiteArm(available).arm.refused).toBeNull();
    expect(() =>
      deriveNativeLockControlPrerequisiteArm({ ...available, witness: "AVAILABLE_LATER" }),
    ).toThrow("native-lock-fixture:refused");
    expect(() => deriveNativeLockControlPrerequisiteArm({ witness: "AVAILABLE" })).toThrow(
      "native-lock-fixture:refused",
    );
  });

  test("labels no synthetic result as a native observation", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    for (const observation of census.observations) {
      expect(["STABLE_PREREQUISITE_DERIVATION", "SYNTHETIC_STABLE_GUARD_REPLAY"]).toContain(
        observation.evidence,
      );
      // The per-OS case and report vocabulary never appears as a control
      // result, and the control-local `REFUSED` word never leaves it.
      expect(["REFUSED", "VIOLATED", "UNSUPPORTED", "UNKNOWN"]).toContain(observation.result);
      expect(observation.result).not.toBe("OBSERVED");
      expect(Object.keys(observation)).not.toContain("facts");
      expect(Object.keys(observation)).not.toContain("events");
    }
    for (const row of census.records) expect(row.result).not.toBe("OBSERVED");
  });

  test("writes exactly the ledger's fixed control files under the archive root", async () => {
    const archiveRoot = resolve(temporary, "preparation");
    const phase = await runNativeLockControlPhase(archiveRoot, { prerequisites: available });
    expect(phase.records.map((row) => row.controlId)).toEqual([...hostedNativeLockControlIds]);
    expect(phase.retained).toHaveLength(21);
    for (const path of phase.retained) {
      expect(path.startsWith(nativeLockControlPrefix)).toBe(true);
      expect(
        path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
      ).toBe(true);
      const body = await readFile(resolve(archiveRoot, ...path.split("/")), "utf8");
      expect(body.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(body)).not.toThrow();
    }
    expect((await readdir(archiveRoot)).sort()).toEqual(["controls"]);
    expect((await readdir(resolve(archiveRoot, "controls"))).sort()).toEqual(
      [...hostedNativeLockControlIds].sort(),
    );
    for (const controlId of witnessDependentIds)
      expect(await readdir(resolve(archiveRoot, "controls", controlId))).toEqual([
        "observation.json",
      ]);
    expect((await readdir(resolve(archiveRoot, "controls", "WRONG_CUSTODY"))).sort()).toEqual([
      "input.json",
      "observation.json",
    ]);

    const observation: unknown = JSON.parse(
      await readFile(resolve(archiveRoot, "controls", "WRONG_CUSTODY", "observation.json"), "utf8"),
    );
    expect(observation).toMatchObject({
      controlId: "WRONG_CUSTODY",
      evidence: "SYNTHETIC_STABLE_GUARD_REPLAY",
      refused: true,
      result: "REFUSED",
    });

    // A second phase over the same root refuses rather than overwriting, and a
    // relative or non-canonical archive root never reaches the filesystem.
    await expect(
      runNativeLockControlPhase(archiveRoot, { prerequisites: available }),
    ).rejects.toThrow();
    await expect(
      runNativeLockControlPhase("controls", { prerequisites: available }),
    ).rejects.toThrow("native-lock-fixture:refused");
    await expect(
      runNativeLockControlPhase(`${temporary}/../${resolve(temporary).split(/[\\/]/).pop()}`, {
        prerequisites: available,
      }),
    ).rejects.toThrow("native-lock-fixture:refused");

    const other = resolve(temporary, "second");
    await expect(
      runNativeLockControlPhase(other, { prerequisites: {} as Prerequisites }),
    ).rejects.toThrow("native-lock-fixture:refused");
    expect(await readdir(temporary)).not.toContain("second");
  });
});
